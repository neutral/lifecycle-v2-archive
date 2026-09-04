#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  opendir,
  readFile,
  readlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCHEMA = "lifecycle.execution-image-tool-inventory.private.v1";
const CODEX_NAME = "@openai/codex";
const CODEX_VERSION = "0.151.0";
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SHA512 = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;
const ARCHITECTURES = Object.freeze({
  amd64: Object.freeze({
    lockPath: "node_modules/@openai/codex-linux-x64",
    packageName: "@openai/codex-linux-x64",
    packageVersion: "0.151.0-linux-x64",
  }),
  arm64: Object.freeze({
    lockPath: "node_modules/@openai/codex-linux-arm64",
    packageName: "@openai/codex-linux-arm64",
    packageVersion: "0.151.0-linux-arm64",
  }),
});
const LOCK_PACKAGE_PATHS = Object.freeze([
  "",
  "node_modules/@openai/codex",
  "node_modules/@openai/codex-darwin-arm64",
  "node_modules/@openai/codex-darwin-x64",
  "node_modules/@openai/codex-linux-arm64",
  "node_modules/@openai/codex-linux-x64",
  "node_modules/@openai/codex-win32-arm64",
  "node_modules/@openai/codex-win32-x64",
]);
const REQUIRED_PATHS = Object.freeze([
  "bin/codex",
  "bin/codex-code-mode-host",
  "codex-package.json",
  "codex-path/codex-linux-sandbox",
  "codex-path/rg",
  "codex-resources/bwrap",
  "codex-resources/zsh/bin/zsh",
  "runner-contract.private.json",
  "bin/execution-cell-runner",
]);
const EXECUTABLE_PATHS = new Set([
  "bin/codex",
  "bin/codex-code-mode-host",
  "codex-path/rg",
  "codex-resources/bwrap",
  "codex-resources/zsh/bin/zsh",
  "bin/execution-cell-runner",
]);
const RUNNER_PATH = "bin/execution-cell-runner";
const CONTRACT_PATH = "runner-contract.private.json";
const GENERATED_INVENTORY_PATH = "tool-inventory.json";

function fail(message) {
  throw new Error(`Execution Image tool inventory verification failed: ${message}`);
}

function ordered(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(ordered);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])]));
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(ordered(value), null, 2)}\n`, "utf8");
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function exactKeys(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    fail(`${label} does not have its exact closed shape`);
  }
}

function exactText(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    fail(`${label} is not exact text`);
  }
  return value;
}

function exactDigest(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) fail(`${label} is not one SHA-256 digest`);
  return value;
}

function exactIntegrity(value, label) {
  if (typeof value !== "string" || !SHA512.test(value)) fail(`${label} is not one SHA-512 integrity`);
  return value;
}

function exactArchitecture(value) {
  if (!Object.hasOwn(ARCHITECTURES, value)) fail("architecture is not amd64 or arm64");
  return value;
}

async function exactLockSelection(packageLockPath, architecture) {
  const bytes = await readFile(resolve(packageLockPath));
  let lock;
  try {
    lock = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("Codex package lock is not JSON");
  }
  exactKeys(lock, ["name", "version", "lockfileVersion", "requires", "packages"], "Codex package lock");
  if (lock.name !== "@neutral/lifecycle-execution-image-codex" || lock.version !== "1.0.0" ||
      lock.lockfileVersion !== 3 || lock.requires !== true ||
      lock.packages === null || typeof lock.packages !== "object" || Array.isArray(lock.packages)) {
    fail("Codex package lock does not identify the exact private lock graph");
  }
  if (JSON.stringify(Object.keys(lock.packages).sort()) !== JSON.stringify([...LOCK_PACKAGE_PATHS].sort())) {
    fail("Codex package lock contains an unexpected or missing package");
  }
  const root = lock.packages[""];
  exactKeys(root, ["name", "version", "dependencies"], "Codex package lock root");
  exactKeys(root.dependencies, [CODEX_NAME], "Codex package lock root dependencies");
  if (root.name !== lock.name || root.version !== lock.version ||
      root.dependencies[CODEX_NAME] !== CODEX_VERSION) {
    fail("Codex package lock root does not select the exact Codex version");
  }
  const common = lock.packages["node_modules/@openai/codex"];
  if (common === null || typeof common !== "object" || Array.isArray(common) ||
      common.version !== CODEX_VERSION || common.name !== undefined ||
      !exactIntegrity(common.integrity, "Codex common package integrity")) {
    fail("Codex package lock common package is invalid");
  }
  const selected = ARCHITECTURES[architecture];
  const platform = lock.packages[selected.lockPath];
  if (platform === null || typeof platform !== "object" || Array.isArray(platform) ||
      platform.name !== CODEX_NAME || platform.version !== selected.packageVersion ||
      platform.optional !== true || JSON.stringify(platform.os) !== JSON.stringify(["linux"]) ||
      !Array.isArray(platform.cpu) || platform.cpu.length !== 1 ||
      (architecture === "amd64" ? platform.cpu[0] !== "x64" : platform.cpu[0] !== "arm64")) {
    fail("Codex package lock platform package is invalid");
  }
  return Object.freeze({
    integrity: exactIntegrity(common.integrity, "Codex common package integrity"),
    name: CODEX_NAME,
    platformIntegrity: exactIntegrity(platform.integrity, "Codex platform package integrity"),
    platformPackage: selected.packageName,
    platformVersion: selected.packageVersion,
    version: CODEX_VERSION,
  });
}

async function observedEntries(rootPath) {
  const root = resolve(rootPath);
  const entries = [];
  const directories = [root];
  while (directories.length > 0) {
    const directory = directories.pop();
    const opened = await opendir(directory);
    const children = [];
    for await (const child of opened) children.push(child.name);
    children.sort();
    for (const name of children) {
      const absolute = join(directory, name);
      const path = relative(root, absolute).split(sep).join("/");
      if (path === GENERATED_INVENTORY_PATH) continue;
      const status = await lstat(absolute);
      if (status.isDirectory() && !status.isSymbolicLink()) {
        directories.push(absolute);
        continue;
      }
      if (status.isFile() && !status.isSymbolicLink()) {
        const bytes = await readFile(absolute);
        entries.push(Object.freeze({
          byteLength: bytes.byteLength,
          digest: digest(bytes),
          kind: "regular",
          mode: (status.mode & 0o777).toString(8).padStart(4, "0"),
          path: `/opt/lifecycle/${path}`,
          role: path === RUNNER_PATH
            ? "runner"
            : path === CONTRACT_PATH ? "runner-contract" : "codex-vendor",
        }));
        continue;
      }
      if (status.isSymbolicLink()) {
        entries.push(Object.freeze({
          kind: "symlink",
          path: `/opt/lifecycle/${path}`,
          role: "codex-vendor",
          target: await readlink(absolute),
        }));
        continue;
      }
      fail(`retained path ${path} is not a regular file, directory, or symbolic link`);
    }
  }
  entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const observed = entries.map((entry) => entry.path.slice("/opt/lifecycle/".length)).sort();
  if (JSON.stringify(observed) !== JSON.stringify([...REQUIRED_PATHS].sort())) {
    fail("retained tree differs from the fixed Codex, runner, and contract inventory");
  }
  return entries;
}

async function normalizeRetainedModes(rootPath) {
  const root = resolve(rootPath);
  for (const path of REQUIRED_PATHS) {
    const absolute = join(root, path);
    const status = await lstat(absolute);
    if (status.isSymbolicLink()) continue;
    if (!status.isFile()) fail(`retained path ${path} is not one regular file`);
    await chmod(absolute, EXECUTABLE_PATHS.has(path) ? 0o555 : 0o444);
  }
}

function validateEntry(entry, index) {
  const label = `inventory entry ${index}`;
  if (entry?.kind === "regular") {
    exactKeys(entry, ["byteLength", "digest", "kind", "mode", "path", "role"], label);
    if (!Number.isSafeInteger(entry.byteLength) || entry.byteLength < 0) fail(`${label} byte length is invalid`);
    exactDigest(entry.digest, `${label} digest`);
    if (entry.mode !== "0444" && entry.mode !== "0555") fail(`${label} mode is invalid`);
  } else if (entry?.kind === "symlink") {
    exactKeys(entry, ["kind", "path", "role", "target"], label);
    exactText(entry.target, `${label} target`);
  } else {
    fail(`${label} kind is invalid`);
  }
  const path = exactText(entry.path, `${label} path`);
  if (!path.startsWith("/opt/lifecycle/") || path.includes("\\") || path.includes("\0") ||
      path.split("/").some((part) => part === "." || part === "..")) {
    fail(`${label} path is not one exact image path`);
  }
  const relativePath = path.slice("/opt/lifecycle/".length);
  if (!REQUIRED_PATHS.includes(relativePath)) fail(`${label} path is outside the fixed inventory`);
  const expectedRole = relativePath === RUNNER_PATH
    ? "runner"
    : relativePath === CONTRACT_PATH ? "runner-contract" : "codex-vendor";
  if (entry.role !== expectedRole) fail(`${label} role is invalid`);
  if (entry.kind === "regular" &&
      entry.mode !== (EXECUTABLE_PATHS.has(relativePath) ? "0555" : "0444")) {
    fail(`${label} mode differs from its fixed role`);
  }
  if (entry.kind === "symlink" &&
      (relativePath !== "codex-path/codex-linux-sandbox" || entry.target !== "../bin/codex")) {
    fail(`${label} symbolic-link target is invalid`);
  }
}

function validateInventory(inventory, expectedArchitecture, lockSelection) {
  exactKeys(inventory, ["codexPackage", "entries", "platform", "schema"], "tool inventory");
  if (inventory.schema !== SCHEMA) fail("tool inventory schema is invalid");
  exactKeys(inventory.platform, ["architecture", "os"], "tool inventory platform");
  if (inventory.platform.os !== "linux" || inventory.platform.architecture !== expectedArchitecture) {
    fail("tool inventory platform differs from the selected image platform");
  }
  exactKeys(inventory.codexPackage, [
    "integrity", "name", "platformIntegrity", "platformPackage", "platformVersion", "version",
  ], "tool inventory Codex package");
  if (JSON.stringify(inventory.codexPackage) !== JSON.stringify(lockSelection)) {
    fail("tool inventory Codex package differs from the checked-in integrity lock");
  }
  if (!Array.isArray(inventory.entries) || inventory.entries.length !== REQUIRED_PATHS.length) {
    fail("tool inventory entries are not the exact fixed inventory");
  }
  inventory.entries.forEach(validateEntry);
  const paths = inventory.entries.map((entry) => entry.path);
  if (JSON.stringify(paths) !== JSON.stringify([...paths].sort()) || new Set(paths).size !== paths.length) {
    fail("tool inventory entries are not uniquely sorted by image path");
  }
}

export async function generateToolInventory({ architecture, packageLockPath, rootPath }) {
  const selectedArchitecture = exactArchitecture(architecture);
  const lockSelection = await exactLockSelection(packageLockPath, selectedArchitecture);
  const inventory = Object.freeze({
    codexPackage: lockSelection,
    entries: await observedEntries(rootPath),
    platform: Object.freeze({ architecture: selectedArchitecture, os: "linux" }),
    schema: SCHEMA,
  });
  validateInventory(inventory, selectedArchitecture, lockSelection);
  return canonicalBytes(inventory);
}

export async function verifyToolInventory({
  architecture,
  expectedCodexDigest,
  expectedContractDigest,
  expectedInventoryDigest,
  expectedRunnerDigest,
  inventoryPath,
  packageLockPath,
  rootPath,
}) {
  const selectedArchitecture = exactArchitecture(architecture);
  const inventoryStatus = await lstat(resolve(inventoryPath));
  if (!inventoryStatus.isFile() || inventoryStatus.isSymbolicLink()) {
    fail("tool inventory carrier is not one regular file");
  }
  const inventoryBytes = await readFile(resolve(inventoryPath));
  let inventory;
  try {
    inventory = JSON.parse(inventoryBytes.toString("utf8"));
  } catch {
    fail("tool inventory is not JSON");
  }
  if (!inventoryBytes.equals(canonicalBytes(inventory))) fail("tool inventory bytes are not canonical sorted JSON");
  const lockSelection = await exactLockSelection(packageLockPath, selectedArchitecture);
  validateInventory(inventory, selectedArchitecture, lockSelection);
  const observed = await observedEntries(rootPath);
  if (JSON.stringify(observed) !== JSON.stringify(inventory.entries)) {
    fail("retained filesystem tree differs from the exact tool inventory");
  }
  const inventoryDigest = digest(inventoryBytes);
  if (expectedInventoryDigest !== undefined &&
      exactDigest(expectedInventoryDigest, "selected tool inventory digest") !== inventoryDigest) {
    fail("selected tool inventory digest differs from the inventory bytes");
  }
  const byPath = new Map(inventory.entries.map((entry) => [entry.path, entry]));
  const exactExpectedEntryDigest = (path, expected, label) => {
    const entry = byPath.get(path);
    if (entry?.kind !== "regular" ||
        exactDigest(expected, `selected ${label} digest`) !== entry.digest) {
      fail(`selected ${label} digest differs from the retained bytes`);
    }
  };
  exactExpectedEntryDigest("/opt/lifecycle/bin/codex", expectedCodexDigest, "Codex executable");
  exactExpectedEntryDigest("/opt/lifecycle/bin/execution-cell-runner", expectedRunnerDigest, "runner");
  exactExpectedEntryDigest(
    "/opt/lifecycle/runner-contract.private.json",
    expectedContractDigest,
    "runner contract",
  );
  return Object.freeze({ inventoryDigest });
}

async function main() {
  const arguments_ = process.argv.slice(2);
  if (arguments_[0] === "generate" && arguments_.length === 6) {
    if (arguments_[5] !== "--normalize-modes") fail("generate requires --normalize-modes acknowledgement");
    await normalizeRetainedModes(arguments_[3]);
    const bytes = await generateToolInventory({
      architecture: arguments_[1],
      packageLockPath: arguments_[2],
      rootPath: arguments_[3],
    });
    const output = resolve(arguments_[4]);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, bytes, { flag: "wx", mode: 0o444 });
    process.stdout.write(`${JSON.stringify({ digest: digest(bytes), output })}\n`);
    return;
  }
  if (arguments_[0] === "verify" && arguments_.length === 9) {
    const result = await verifyToolInventory({
      architecture: arguments_[1],
      inventoryPath: arguments_[2],
      rootPath: arguments_[3],
      packageLockPath: arguments_[4],
      expectedInventoryDigest: arguments_[5],
      expectedCodexDigest: arguments_[6],
      expectedRunnerDigest: arguments_[7],
      expectedContractDigest: arguments_[8],
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  fail("usage: tool-inventory generate <architecture> <package-lock> <root> <output> --normalize-modes | verify <architecture> <inventory> <root> <package-lock> <inventory-digest> <codex-digest> <runner-digest> <contract-digest>");
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
