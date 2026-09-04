import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { generateToolInventory, verifyToolInventory } from "./tool-inventory.mjs";

const executionImageRoot = dirname(fileURLToPath(import.meta.url));
const packageLockPath = join(executionImageRoot, "package-lock.json");
const regularPaths = [
  "bin/codex",
  "bin/codex-code-mode-host",
  "bin/execution-cell-runner",
  "codex-package.json",
  "codex-path/rg",
  "codex-resources/bwrap",
  "codex-resources/zsh/bin/zsh",
  "runner-contract.private.json",
];
const executablePaths = new Set(regularPaths.filter((path) =>
  path !== "codex-package.json" && path !== "runner-contract.private.json"));

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-tool-inventory-"));
  for (const path of regularPaths) {
    const absolute = join(root, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, `fixture:${path}\n`);
    await chmod(absolute, executablePaths.has(path) ? 0o555 : 0o444);
  }
  await symlink("../bin/codex", join(root, "codex-path/codex-linux-sandbox"));
  const bytes = await generateToolInventory({ architecture: "amd64", packageLockPath, rootPath: root });
  const inventoryPath = join(root, "tool-inventory.json");
  await writeFile(inventoryPath, bytes, { mode: 0o444 });
  const inventory = JSON.parse(bytes.toString("utf8"));
  const byPath = new Map(inventory.entries.map((entry) => [entry.path, entry]));
  return {
    bytes,
    inventoryPath,
    root,
    selected: {
      codex: byPath.get("/opt/lifecycle/bin/codex").digest,
      contract: byPath.get("/opt/lifecycle/runner-contract.private.json").digest,
      inventory: digest(bytes),
      runner: byPath.get("/opt/lifecycle/bin/execution-cell-runner").digest,
    },
  };
}

async function verify(value) {
  return await verifyToolInventory({
    architecture: "amd64",
    expectedCodexDigest: value.selected.codex,
    expectedContractDigest: value.selected.contract,
    expectedInventoryDigest: value.selected.inventory,
    expectedRunnerDigest: value.selected.runner,
    inventoryPath: value.inventoryPath,
    packageLockPath,
    rootPath: value.root,
  });
}

test("inventory binds every retained file and symbolic link", async () => {
  const value = await fixture();
  try {
    assert.deepEqual(await verify(value), { inventoryDigest: value.selected.inventory });
  } finally {
    await rm(value.root, { recursive: true, force: true });
  }
});

test("inventory rejects changed, extra, and substituted retained paths", async (context) => {
  await context.test("changed bytes", async () => {
    const value = await fixture();
    try {
      await chmod(join(value.root, "bin/codex"), 0o755);
      await writeFile(join(value.root, "bin/codex"), "substituted\n");
      await chmod(join(value.root, "bin/codex"), 0o555);
      await assert.rejects(verify(value), /retained filesystem tree differs/u);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });
  await context.test("extra file", async () => {
    const value = await fixture();
    try {
      await writeFile(join(value.root, "extra"), "extra\n");
      await assert.rejects(verify(value), /fixed Codex, runner, and contract inventory/u);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });
  await context.test("wrong symlink", async () => {
    const value = await fixture();
    try {
      await rm(join(value.root, "codex-path/codex-linux-sandbox"));
      await symlink("../bin/codex-code-mode-host", join(value.root, "codex-path/codex-linux-sandbox"));
      await assert.rejects(verify(value), /retained filesystem tree differs/u);
    } finally {
      await rm(value.root, { recursive: true, force: true });
    }
  });
});

test("checked inventories are canonical, platform-specific, and lock-bound", async () => {
  for (const architecture of ["amd64", "arm64"]) {
    const bytes = await readFile(join(executionImageRoot, `tool-inventory.linux-${architecture}.json`));
    const value = JSON.parse(bytes.toString("utf8"));
    assert.equal(value.schema, "lifecycle.execution-image-tool-inventory.private.v1");
    assert.deepEqual(value.platform, { architecture, os: "linux" });
    assert.equal(value.codexPackage.version, "0.151.0");
    assert.equal(value.entries.length, 9);
    assert.equal(bytes.at(-1), 0x0a);
    assert.deepEqual(value.entries.map((entry) => entry.path),
      [...value.entries.map((entry) => entry.path)].sort());
  }
});

test("Docker build consumes only locked inputs and tracked runner source", async () => {
  const [dockerfile, dockerignore] = await Promise.all([
    readFile(join(executionImageRoot, "Dockerfile.agent-cell"), "utf8"),
    readFile(resolve(executionImageRoot, "../.dockerignore"), "utf8"),
  ]);
  assert.doesNotMatch(dockerfile, /npm install(?:\s|\\)/u);
  assert.match(dockerfile, /npm ci --ignore-scripts/u);
  assert.match(dockerfile, /COPY src\/util\/execution-cell-runner-v1\.ts/u);
  assert.doesNotMatch(dockerfile, /COPY dist\//u);
  assert.equal(dockerfile.match(/test "\$\(node --version\)" = "v24\.14\.0"/gu)?.length, 3);
  assert.match(dockerfile, /\^\[0-9\]\[A-Za-z0-9\.\+:~-\]\{0,159\}\$/u);
  assert.match(dockerignore, /!src\/util\/execution-cell-runner-v1\.ts/u);
  assert.doesNotMatch(dockerignore, /!dist\//u);
});
