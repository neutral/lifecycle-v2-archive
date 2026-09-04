import { cp, lstat, mkdir, readFile, readdir, realpath, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROTOCOL_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const WORKSPACE_ROOT = resolve(PROTOCOL_ROOT, "..");
const STAGING_ROOT = join(PROTOCOL_ROOT, "node_modules");
const MARKER_PATH = join(STAGING_ROOT, ".lifecycle-foundation-protocol-pack-staging.json");
const MARKER_SCHEMA = "lifecycle.foundation-protocol-package-staging.v1";
const DEPENDENCIES = Object.freeze([
  Object.freeze({ name: "@noble/hashes", version: "2.4.0", lockPath: "node_modules/@noble/hashes" }),
  Object.freeze({ name: "zod", version: "4.4.3", lockPath: "node_modules/zod" }),
]);

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
      throw new Error(`Refusing symbolic link in bundled protocol dependency: ${current}`);
    }
    if (!metadata.isDirectory()) continue;
    for (const entry of await readdir(current)) pending.push(join(current, entry));
  }
}

async function removeOwnedStaging() {
  if (!(await pathExists(STAGING_ROOT))) return;
  if (!(await pathExists(MARKER_PATH))) {
    if ((await readdir(STAGING_ROOT)).length === 0) return;
    throw new Error(`Refusing to remove unowned protocol dependency directory: ${STAGING_ROOT}`);
  }
  const marker = await readJson(MARKER_PATH);
  if (marker.schema !== MARKER_SCHEMA || marker.protocolRoot !== PROTOCOL_ROOT ||
      typeof marker.stagingRootExisted !== "boolean") {
    throw new Error(`Refusing invalid protocol dependency staging marker: ${MARKER_PATH}`);
  }
  for (const dependency of DEPENDENCIES) {
    await rm(join(STAGING_ROOT, dependency.name), { recursive: true, force: true });
  }
  const nobleScope = join(STAGING_ROOT, "@noble");
  if (await pathExists(nobleScope)) {
    if ((await readdir(nobleScope)).length !== 0) {
      throw new Error(`Refusing unexpected scoped dependency residue: ${nobleScope}`);
    }
    await rmdir(nobleScope);
  }
  await rm(MARKER_PATH, { force: false });
  if (marker.stagingRootExisted) {
    if ((await readdir(STAGING_ROOT)).length !== 0) {
      throw new Error(`Refusing unexpected protocol dependency staging residue: ${STAGING_ROOT}`);
    }
  } else {
    await rm(STAGING_ROOT, { recursive: true, force: false });
  }
}

async function prepare() {
  await removeOwnedStaging();
  const [protocolPackage, packageLock] = await Promise.all([
    readJson(join(PROTOCOL_ROOT, "package.json")),
    readJson(join(WORKSPACE_ROOT, "package-lock.json")),
  ]);
  const lockedProtocol = packageLock.packages?.["protocol"];
  if (packageLock.lockfileVersion !== 3 || lockedProtocol?.name !== protocolPackage.name ||
      lockedProtocol?.version !== protocolPackage.version) {
    throw new Error("Protocol package identity does not match package-lock.json");
  }
  const selectedDependencies = Object.fromEntries(DEPENDENCIES.map(({ name, version }) => [name, version]));
  const selectedNames = DEPENDENCIES.map(({ name }) => name);
  if (JSON.stringify(protocolPackage.dependencies) !== JSON.stringify(selectedDependencies) ||
      JSON.stringify(protocolPackage.bundledDependencies) !== JSON.stringify(selectedNames) ||
      JSON.stringify(lockedProtocol.dependencies) !== JSON.stringify(protocolPackage.dependencies) ||
      JSON.stringify(lockedProtocol.bundleDependencies) !== JSON.stringify(protocolPackage.bundledDependencies)) {
    throw new Error("Protocol bundled dependencies do not match the exact selected package set");
  }
  const canonicalDependencyRoot = await realpath(join(WORKSPACE_ROOT, "node_modules"));
  const sources = [];
  for (const dependency of DEPENDENCIES) {
    const lockedDependency = packageLock.packages?.[dependency.lockPath];
    if (
      lockedDependency?.version !== dependency.version ||
      typeof lockedDependency.integrity !== "string"
    ) {
      throw new Error(`Protocol dependency does not match package-lock.json: ${dependency.lockPath}`);
    }
    const source = join(WORKSPACE_ROOT, dependency.lockPath);
    const sourceMetadata = await lstat(source).catch(() => null);
    if (sourceMetadata === null || !sourceMetadata.isDirectory() || sourceMetadata.isSymbolicLink()) {
      throw new Error(`Installed protocol dependency must be one non-symbolic directory: ${dependency.lockPath}`);
    }
    const canonicalSource = await realpath(source);
    const dependencyRelative = relative(canonicalDependencyRoot, canonicalSource);
    if (dependencyRelative === ".." || dependencyRelative.startsWith(`..${sep}`) || isAbsolute(dependencyRelative)) {
      throw new Error(`Installed protocol dependency is outside workspace node_modules: ${dependency.lockPath}`);
    }
    const installedPackage = await readJson(join(canonicalSource, "package.json"));
    if (installedPackage.name !== dependency.name || installedPackage.version !== dependency.version) {
      throw new Error(`Installed protocol dependency does not match package-lock.json: ${dependency.lockPath}`);
    }
    await verifyNoSymlinks(canonicalSource);
    sources.push(Object.freeze({ dependency, canonicalSource }));
  }

  const stagingRootExisted = await pathExists(STAGING_ROOT);
  if (stagingRootExisted) {
    if ((await readdir(STAGING_ROOT)).length !== 0) {
      throw new Error(`Refusing non-empty unowned protocol dependency directory: ${STAGING_ROOT}`);
    }
  } else {
    await mkdir(STAGING_ROOT, { recursive: false, mode: 0o755 });
  }
  await writeFile(
    MARKER_PATH,
    `${JSON.stringify({ schema: MARKER_SCHEMA, protocolRoot: PROTOCOL_ROOT, stagingRootExisted })}\n`,
    { encoding: "utf8", mode: 0o600 },
  );
  try {
    for (const { dependency, canonicalSource } of sources) {
      const target = join(STAGING_ROOT, dependency.name);
      await mkdir(dirname(target), { recursive: true, mode: 0o755 });
      await cp(canonicalSource, target, {
        recursive: true,
        dereference: false,
        errorOnExist: true,
      });
    }
  } catch (error) {
    await removeOwnedStaging();
    throw error;
  }
}

const operation = process.argv[2];
if (operation === "prepare") await prepare();
else if (operation === "cleanup") await removeOwnedStaging();
else throw new Error("Expected prepare or cleanup operation");
