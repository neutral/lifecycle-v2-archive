import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const TUI_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const WORKSPACE_ROOT = resolve(TUI_ROOT, "../..");
const STAGING_ROOT = join(TUI_ROOT, "node_modules");
const MARKER_PATH = join(STAGING_ROOT, ".lifecycle-foundation-tui-pack-staging.json");
const MARKER_SCHEMA = "lifecycle.foundation-tui-package-staging.v1";
const PROTOCOL_NAME = "@neutral/lifecycle-protocol";
const PROTOCOL_LOCK_PATH = "node_modules/@neutral/lifecycle-protocol";
const PROTOCOL_WORKSPACE_PATH = "protocol";
const NATIVE_PREFIX = "@opentui/core-";
const EXPECTED_NON_NATIVE = new Map([
  ["@neutral/lifecycle-protocol", "1.0.0"],
  ["@noble/hashes", "2.4.0"],
  ["@opentui/core", "0.5.9"],
  ["ansi-regex", "6.3.0"],
  ["bun-ffi-structs", "0.3.1"],
  ["diff", "9.0.0"],
  ["emoji-regex", "10.6.0"],
  ["get-east-asian-width", "1.6.0"],
  ["marked", "17.0.1"],
  ["string-width", "7.2.0"],
  ["strip-ansi", "7.1.2"],
  ["typescript", "5.8.3"],
  ["web-tree-sitter", "0.25.10"],
  ["zod", "4.4.3"],
]);

async function exists(path) {
  try { await lstat(path); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}
async function readJson(path) { return JSON.parse(await readFile(path, "utf8")); }
function sorted(value) { return Object.fromEntries(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b))); }
function equalRecord(left, right) { return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right)); }

function hostLibc() {
  if (process.platform !== "linux") return null;
  let glibcVersionRuntime;
  try { glibcVersionRuntime = process.report?.getReport()?.header?.glibcVersionRuntime; }
  catch { glibcVersionRuntime = undefined; }
  return glibcVersionRuntime === true || (typeof glibcVersionRuntime === "string" && glibcVersionRuntime.length > 0)
    ? "glibc"
    : "musl";
}

function expectedNativePackage() {
  const libcSuffix = hostLibc() === "musl" ? "-musl" : "";
  return `${NATIVE_PREFIX}${process.platform}-${process.arch}${libcSuffix}`;
}

function expectedNativeLibrary() {
  const selected = { darwin: "libopentui.dylib", linux: "libopentui.so", win32: "opentui.dll" }[process.platform];
  if (selected === undefined) throw new Error(`Unsupported OpenTUI packaging platform: ${process.platform}`);
  return selected;
}

function packageNameFromLockPath(lockPath) {
  const parts = lockPath.split("/");
  const index = parts.lastIndexOf("node_modules");
  if (index < 0 || index === parts.length - 1) throw new Error(`Invalid package-lock path: ${lockPath}`);
  return parts[index + 1].startsWith("@") ? `${parts[index + 1]}/${parts[index + 2]}` : parts[index + 1];
}

function resolveLocked(packages, requesterPath, dependencyName) {
  let base = requesterPath;
  for (;;) {
    const candidate = join(base, "node_modules", dependencyName).split(sep).join("/");
    if (packages[candidate] !== undefined) return candidate;
    const parent = dirname(base);
    if (parent === base || base === "." || base === "") break;
    base = parent === "." ? "" : parent;
  }
  const root = join("node_modules", dependencyName).split(sep).join("/");
  return packages[root] === undefined ? null : root;
}

async function verifyNoSymlinks(root) {
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) throw new Error(`Refusing symlink in bundled TUI dependency: ${current}`);
    if (!metadata.isDirectory()) continue;
    for (const entry of await readdir(current)) if (entry !== "node_modules") pending.push(join(current, entry));
  }
}

async function copyProtocol(source, target) {
  const packageValue = await readJson(join(source, "package.json"));
  if (packageValue.name !== PROTOCOL_NAME || packageValue.version !== "1.0.0" ||
      packageValue.private !== true || packageValue.type !== "module" ||
      !equalRecord(packageValue.dependencies, { "@noble/hashes": "2.4.0", zod: "4.4.3" }) ||
      JSON.stringify(packageValue.files) !== JSON.stringify(["dist/src"]) ||
      packageValue.main !== "./dist/src/foundation.js" ||
      packageValue.types !== "./dist/src/foundation.d.ts" ||
      JSON.stringify(packageValue.exports) !== JSON.stringify({
        ".": { types: "./dist/src/foundation.d.ts", default: "./dist/src/foundation.js" },
      }) ||
      JSON.stringify(packageValue.engines) !== JSON.stringify({ node: ">=24.14.0" }) ||
      JSON.stringify(packageValue.bundledDependencies) !== JSON.stringify(["@noble/hashes", "zod"])) {
    throw new Error("Workspace protocol is not the exact packable interface-v10 surface");
  }
  const distribution = join(source, "dist", "src");
  const metadata = await lstat(distribution).catch(() => null);
  if (metadata === null || !metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Build the protocol before packing the TUI");
  }
  await verifyNoSymlinks(distribution);
  await mkdir(target, { recursive: false, mode: 0o755 });
  await cp(join(source, "package.json"), join(target, "package.json"), { errorOnExist: true });
  await mkdir(join(target, "dist"), { recursive: false, mode: 0o755 });
  await cp(distribution, join(target, "dist", "src"), { recursive: true, dereference: false, errorOnExist: true });
}

async function removeOwnedStaging() {
  if (!(await exists(STAGING_ROOT))) return;
  if (!(await exists(MARKER_PATH))) {
    if ((await readdir(STAGING_ROOT)).length === 0) { await rm(STAGING_ROOT, { recursive: true }); return; }
    throw new Error(`Refusing unowned TUI dependency directory: ${STAGING_ROOT}`);
  }
  const marker = await readJson(MARKER_PATH);
  if (marker.schema !== MARKER_SCHEMA || marker.tuiRoot !== TUI_ROOT) throw new Error("Invalid TUI dependency staging marker");
  await rm(STAGING_ROOT, { recursive: true, force: false });
}

async function prepare() {
  await removeOwnedStaging();
  const [tuiPackage, packageLock] = await Promise.all([
    readJson(join(TUI_ROOT, "package.json")),
    readJson(join(WORKSPACE_ROOT, "package-lock.json")),
  ]);
  const lockedTui = packageLock.packages?.["clients/tui"];
  if (packageLock.lockfileVersion !== 3 || lockedTui?.name !== tuiPackage.name || lockedTui?.version !== tuiPackage.version ||
      !equalRecord(lockedTui.dependencies, tuiPackage.dependencies)) {
    throw new Error("TUI package identity or production dependencies do not match package-lock.json");
  }
  const direct = Object.keys(tuiPackage.dependencies ?? {}).sort();
  const bundled = [...(tuiPackage.bundledDependencies ?? [])].sort();
  if (JSON.stringify(direct) !== JSON.stringify(bundled) ||
      JSON.stringify(bundled) !== JSON.stringify([...(lockedTui.bundleDependencies ?? [])].sort())) {
    throw new Error("Every TUI production dependency must be exact and bundled in package-lock.json");
  }

  const closure = new Map();
  const visit = async (requesterPath, dependencyName, optional = false) => {
    const lockPath = resolveLocked(packageLock.packages, requesterPath, dependencyName);
    if (lockPath === null) {
      if (optional) return;
      throw new Error(`Missing locked TUI dependency ${dependencyName} required by ${requesterPath}`);
    }
    const raw = packageLock.packages[lockPath];
    let entry = raw;
    let workspacePath = null;
    if (raw.link === true) {
      if (dependencyName !== PROTOCOL_NAME || lockPath !== PROTOCOL_LOCK_PATH || raw.resolved !== PROTOCOL_WORKSPACE_PATH) {
        throw new Error(`TUI packing refuses linked dependency ${lockPath}`);
      }
      entry = packageLock.packages[PROTOCOL_WORKSPACE_PATH];
      workspacePath = PROTOCOL_WORKSPACE_PATH;
    }
    const physicalPath = join(WORKSPACE_ROOT, workspacePath ?? lockPath);
    if (optional && !(await exists(physicalPath))) return;
    if (closure.has(lockPath)) return;
    if (workspacePath === null && typeof entry.integrity !== "string") throw new Error(`Locked registry dependency lacks integrity: ${lockPath}`);
    closure.set(lockPath, { name: dependencyName, version: entry.version, workspacePath });
    for (const child of Object.keys(entry.dependencies ?? {}).sort()) await visit(lockPath, child);
    for (const child of Object.keys(entry.optionalDependencies ?? {}).sort()) await visit(lockPath, child, true);
    for (const child of Object.keys(entry.peerDependencies ?? {}).sort()) {
      await visit(lockPath, child, entry.peerDependenciesMeta?.[child]?.optional === true);
    }
  };
  for (const name of direct) await visit("clients/tui", name);

  const records = [];
  const dependencyRoot = await realpath(join(WORKSPACE_ROOT, "node_modules"));
  const protocolRoot = await realpath(join(WORKSPACE_ROOT, PROTOCOL_WORKSPACE_PATH));
  for (const [lockPath, locked] of [...closure.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const source = join(WORKSPACE_ROOT, locked.workspacePath ?? lockPath);
    const metadata = await lstat(source).catch(() => null);
    if (metadata === null || !metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error(`Installed dependency is not one real directory: ${lockPath}`);
    const canonical = await realpath(source);
    if (locked.workspacePath === null) {
      const selected = relative(dependencyRoot, canonical);
      if (selected === ".." || selected.startsWith(`..${sep}`) || isAbsolute(selected)) throw new Error(`Dependency escapes workspace node_modules: ${lockPath}`);
    } else if (canonical !== protocolRoot) throw new Error("Protocol workspace link does not resolve exactly");
    const installed = await readJson(join(canonical, "package.json"));
    if (installed.name !== packageNameFromLockPath(lockPath) || installed.name !== locked.name || installed.version !== locked.version) {
      throw new Error(`Installed dependency differs from package-lock.json: ${lockPath}`);
    }
    if (locked.workspacePath === null) await verifyNoSymlinks(canonical);
    records.push({ lockPath, source: canonical, name: installed.name, version: installed.version, workspacePath: locked.workspacePath, packageValue: installed });
  }

  const native = records.filter(({ name }) => name.startsWith(NATIVE_PREFIX));
  if (native.length !== 1) throw new Error(`TUI package requires exactly one physically installed OpenTUI native package; observed ${native.length}`);
  const nativePackage = native[0];
  const libc = hostLibc();
  const declaredLibc = nativePackage.packageValue.libc ?? [];
  if (nativePackage.name !== expectedNativePackage() || nativePackage.version !== "0.5.9" ||
      !nativePackage.packageValue.os?.includes(process.platform) || !nativePackage.packageValue.cpu?.includes(process.arch) ||
      (libc === "musl" ? JSON.stringify(declaredLibc) !== JSON.stringify(["musl"]) : declaredLibc.length !== 0)) {
    throw new Error(`Installed OpenTUI native package does not match ${process.platform}-${process.arch}`);
  }
  const nativeLibrary = await lstat(join(nativePackage.source, expectedNativeLibrary())).catch(() => null);
  if (nativeLibrary === null || !nativeLibrary.isFile() || nativeLibrary.isSymbolicLink() || nativeLibrary.size <= 0) {
    throw new Error("Installed OpenTUI native package lacks its exact regular native library");
  }
  const nonNativeRecords = records.filter(({ name }) => !name.startsWith(NATIVE_PREFIX));
  const observed = new Map(nonNativeRecords.map(({ name, version }) => [name, version]));
  if (observed.size !== nonNativeRecords.length) throw new Error("TUI production closure contains duplicate package identities");
  if (JSON.stringify([...observed].sort()) !== JSON.stringify([...EXPECTED_NON_NATIVE].sort())) {
    throw new Error(`TUI production closure changed: ${JSON.stringify([...observed].sort())}`);
  }

  await mkdir(STAGING_ROOT, { recursive: false, mode: 0o755 });
  await writeFile(MARKER_PATH, `${JSON.stringify({ schema: MARKER_SCHEMA, tuiRoot: TUI_ROOT, native: nativePackage.name })}\n`, { encoding: "utf8", mode: 0o600 });
  try {
    for (const record of records) {
      const target = join(TUI_ROOT, record.lockPath);
      await mkdir(dirname(target), { recursive: true, mode: 0o755 });
      if (record.workspacePath === null) {
        await cp(record.source, target, {
          recursive: true, dereference: false, errorOnExist: true,
          filter: (source) => source === record.source || !relative(record.source, source).split(sep).includes("node_modules"),
        });
      } else await copyProtocol(record.source, target);
    }
  } catch (error) {
    await rm(STAGING_ROOT, { recursive: true, force: true });
    throw error;
  }
}

const operation = process.argv[2];
if (operation === "prepare") await prepare();
else if (operation === "cleanup") await removeOwnedStaging();
else throw new Error("Expected prepare or cleanup operation");
