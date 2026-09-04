import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const RUNTIME_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const WORKSPACE_ROOT = resolve(RUNTIME_ROOT, "..");
const STAGING_ROOT = join(RUNTIME_ROOT, "node_modules");
const MARKER_PATH = join(STAGING_ROOT, ".lifecycle-foundation-pack-staging.json");
const MARKER_SCHEMA = "lifecycle.foundation-package-staging.v1";
const WORKSPACE_PROTOCOL_NAME = "@neutral/lifecycle-protocol";
const WORKSPACE_PROTOCOL_LOCK_PATH = "node_modules/@neutral/lifecycle-protocol";
const WORKSPACE_PROTOCOL_PACKAGE_PATH = "protocol";

function sortedEntries(value) {
  return Object.fromEntries(Object.entries(value ?? {}).sort(([left], [right]) => left.localeCompare(right)));
}

function assertEqualRecord(left, right, message) {
  if (JSON.stringify(sortedEntries(left)) !== JSON.stringify(sortedEntries(right))) {
    throw new Error(message);
  }
}

function packageNameFromLockPath(lockPath) {
  const segments = lockPath.split("/");
  const nodeModulesIndex = segments.lastIndexOf("node_modules");
  if (nodeModulesIndex < 0 || nodeModulesIndex === segments.length - 1) {
    throw new Error(`Invalid package-lock package path: ${lockPath}`);
  }
  const first = segments[nodeModulesIndex + 1];
  return first.startsWith("@") ? `${first}/${segments[nodeModulesIndex + 2]}` : first;
}

function resolveLockedDependency(packages, requesterPath, dependencyName) {
  let base = requesterPath;
  for (;;) {
    const candidate = join(base, "node_modules", dependencyName).split(sep).join("/");
    if (packages[candidate] !== undefined) return candidate;
    const parent = dirname(base);
    if (parent === base || base === "." || base === "") break;
    base = parent === "." ? "" : parent;
  }
  const rootCandidate = join("node_modules", dependencyName).split(sep).join("/");
  return packages[rootCandidate] === undefined ? null : rootCandidate;
}

function stagingPathForLockPath(lockPath) {
  if (!lockPath.startsWith("node_modules/")) {
    throw new Error(`Runtime production dependency is not hoisted beneath workspace node_modules: ${lockPath}`);
  }
  return join(RUNTIME_ROOT, lockPath);
}

function stagingLockPathForSourceLockPath(sourceLockPath) {
  if (sourceLockPath.startsWith("node_modules/")) return sourceLockPath;
  throw new Error(`Runtime package assembly refuses dependency outside an exact install root: ${sourceLockPath}`);
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function verifyNoSymlinks(root) {
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Refusing symbolic link in installed production dependency: ${current}`);
    }
    if (!metadata.isDirectory()) continue;
    for (const entry of await readdir(current)) {
      if (entry === "node_modules") continue;
      pending.push(join(current, entry));
    }
  }
}

async function copyWorkspaceProtocol(source, target) {
  const packageValue = await readJson(join(source, "package.json"));
  if (packageValue.name !== WORKSPACE_PROTOCOL_NAME || packageValue.version !== "1.0.0" ||
      JSON.stringify(packageValue.dependencies) !== JSON.stringify({ "@noble/hashes": "2.4.0", zod: "4.4.3" }) ||
      JSON.stringify(packageValue.files) !== JSON.stringify(["dist/src"]) ||
      packageValue.main !== "./dist/src/foundation.js" ||
      packageValue.types !== "./dist/src/foundation.d.ts" ||
      JSON.stringify(packageValue.bundledDependencies) !== JSON.stringify(["@noble/hashes", "zod"])) {
    throw new Error("Workspace protocol package surface is not the exact packable Foundation surface");
  }
  const distribution = join(source, "dist", "src");
  const distributionMetadata = await lstat(distribution).catch(() => null);
  if (distributionMetadata === null || !distributionMetadata.isDirectory() || distributionMetadata.isSymbolicLink()) {
    throw new Error("Workspace protocol distribution is unavailable; build the protocol before packing the runtime");
  }
  await verifyNoSymlinks(distribution);
  await mkdir(target, { recursive: false, mode: 0o755 });
  await cp(join(source, "package.json"), join(target, "package.json"), { errorOnExist: true });
  await mkdir(join(target, "dist"), { recursive: false, mode: 0o755 });
  await cp(distribution, join(target, "dist", "src"), {
    recursive: true,
    dereference: false,
    errorOnExist: true,
  });
}

async function removeOwnedStaging() {
  if (!(await pathExists(STAGING_ROOT))) return;
  if (!(await pathExists(MARKER_PATH))) {
    throw new Error(`Refusing to remove unowned runtime dependency directory: ${STAGING_ROOT}`);
  }
  const marker = await readJson(MARKER_PATH);
  if (marker.schema !== MARKER_SCHEMA || marker.runtimeRoot !== RUNTIME_ROOT) {
    throw new Error(`Refusing invalid runtime dependency staging marker: ${MARKER_PATH}`);
  }
  await rm(STAGING_ROOT, { recursive: true, force: false });
}

async function prepare() {
  await removeOwnedStaging();

  const runtimePackage = await readJson(join(RUNTIME_ROOT, "package.json"));
  const packageLock = await readJson(join(WORKSPACE_ROOT, "package-lock.json"));
  if (packageLock.lockfileVersion !== 3 || typeof packageLock.packages !== "object") {
    throw new Error("Runtime package assembly requires package-lock format 3");
  }
  const lockedRuntime = packageLock.packages.runtime;
  if (lockedRuntime?.name !== runtimePackage.name || lockedRuntime?.version !== runtimePackage.version) {
    throw new Error("Runtime package identity does not match package-lock.json");
  }
  assertEqualRecord(
    lockedRuntime.dependencies,
    runtimePackage.dependencies,
    "Runtime production dependencies do not match package-lock.json",
  );
  const directNames = Object.keys(runtimePackage.dependencies ?? {}).sort();
  const bundledNames = [...(runtimePackage.bundledDependencies ?? [])].sort();
  if (JSON.stringify(directNames) !== JSON.stringify(bundledNames)) {
    throw new Error("Every runtime production dependency must be declared as bundled");
  }
  if (JSON.stringify(bundledNames) !== JSON.stringify([...(lockedRuntime.bundleDependencies ?? [])].sort())) {
    throw new Error("Runtime bundled dependencies do not match package-lock.json");
  }

  const closure = new Map();
  const visit = (requesterPath, dependencyName) => {
    const sourceLockPath = resolveLockedDependency(packageLock.packages, requesterPath, dependencyName);
    if (sourceLockPath === null) {
      throw new Error(`Missing locked production dependency ${dependencyName} required by ${requesterPath}`);
    }
    const lockPath = stagingLockPathForSourceLockPath(sourceLockPath);
    const existing = closure.get(lockPath);
    if (existing !== undefined) {
      if (existing.sourceLockPath !== sourceLockPath || existing.name !== dependencyName) {
        throw new Error(`Runtime dependency target ${lockPath} resolves to inconsistent package sources`);
      }
      return;
    }
    const entry = packageLock.packages[sourceLockPath];
    let dependencyEntry = entry;
    let workspacePackagePath = null;
    let workspaceKind = null;
    if (entry.link === true) {
      if (dependencyName === WORKSPACE_PROTOCOL_NAME && lockPath === WORKSPACE_PROTOCOL_LOCK_PATH &&
          entry.resolved === WORKSPACE_PROTOCOL_PACKAGE_PATH) {
        workspacePackagePath = WORKSPACE_PROTOCOL_PACKAGE_PATH;
        workspaceKind = "protocol";
      } else {
        throw new Error(`Runtime package assembly refuses linked production dependency ${lockPath}`);
      }
      dependencyEntry = packageLock.packages[workspacePackagePath];
      if (dependencyEntry?.name !== dependencyName) {
        throw new Error(`Workspace dependency link does not resolve to its exact locked package identity: ${dependencyName}`);
      }
    }
    closure.set(lockPath, Object.freeze({
      name: dependencyName,
      version: dependencyEntry.version,
      sourceLockPath,
      workspacePackagePath,
      workspaceKind,
    }));
    const childRequesterPath = workspacePackagePath ?? sourceLockPath;
    for (const childName of Object.keys(dependencyEntry.dependencies ?? {}).sort()) visit(childRequesterPath, childName);
    for (const childName of Object.keys(dependencyEntry.optionalDependencies ?? {}).sort()) {
      if (resolveLockedDependency(packageLock.packages, childRequesterPath, childName) !== null) visit(childRequesterPath, childName);
    }
  };
  for (const dependencyName of directNames) visit("runtime", dependencyName);

  const records = [];
  const canonicalDependencyRoot = await realpath(join(WORKSPACE_ROOT, "node_modules"));
  for (const [lockPath, locked] of [...closure.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const source = locked.workspacePackagePath === null
      ? join(WORKSPACE_ROOT, locked.sourceLockPath)
      : join(WORKSPACE_ROOT, locked.workspacePackagePath);
    const sourceMetadata = await lstat(source).catch(() => null);
    if (sourceMetadata === null || !sourceMetadata.isDirectory() || sourceMetadata.isSymbolicLink()) {
      throw new Error(`Installed production dependency must be one non-symbolic directory: ${lockPath}`);
    }
    const canonicalSource = await realpath(source).catch(() => null);
    if (locked.workspacePackagePath === null) {
      const dependencyRelative = canonicalSource === null ? null : relative(canonicalDependencyRoot, canonicalSource);
      if (
        dependencyRelative === null ||
        dependencyRelative === ".." ||
        dependencyRelative.startsWith(`..${sep}`) ||
        isAbsolute(dependencyRelative)
      ) {
        throw new Error(`Installed production dependency is missing or outside its exact dependency root: ${locked.sourceLockPath}`);
      }
    } else {
      const expectedWorkspaceSource = await realpath(join(WORKSPACE_ROOT, locked.workspacePackagePath));
      if (canonicalSource !== expectedWorkspaceSource) {
        throw new Error(`Workspace dependency does not resolve to its exact package root: ${locked.name}`);
      }
    }
    const installedPackage = await readJson(join(canonicalSource, "package.json"));
    const expectedName = packageNameFromLockPath(lockPath);
    if (
      installedPackage.name !== expectedName ||
      installedPackage.name !== locked.name ||
      installedPackage.version !== locked.version
    ) {
      throw new Error(`Installed production dependency does not match package-lock.json: ${lockPath}`);
    }
    if (locked.workspacePackagePath === null) await verifyNoSymlinks(canonicalSource);
    records.push(Object.freeze({
      lockPath,
      source: canonicalSource,
      workspacePackagePath: locked.workspacePackagePath,
      workspaceKind: locked.workspaceKind,
    }));
  }

  await mkdir(STAGING_ROOT, { recursive: false, mode: 0o755 });
  await writeFile(
    MARKER_PATH,
    `${JSON.stringify({ schema: MARKER_SCHEMA, runtimeRoot: RUNTIME_ROOT })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  try {
    for (const record of records) {
      const target = stagingPathForLockPath(record.lockPath);
      await mkdir(dirname(target), { recursive: true, mode: 0o755 });
      if (record.workspacePackagePath === null) {
        await cp(record.source, target, {
          recursive: true,
          dereference: false,
          errorOnExist: true,
          filter: (source) => source === record.source || !relative(record.source, source).split(sep).includes("node_modules"),
        });
      } else if (record.workspaceKind === "protocol") {
        await copyWorkspaceProtocol(record.source, target);
      } else {
        throw new Error(`Runtime package assembly has an unsupported workspace dependency kind: ${record.workspaceKind}`);
      }
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
