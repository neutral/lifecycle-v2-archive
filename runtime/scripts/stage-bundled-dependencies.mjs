import { createHash } from "node:crypto";
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
const ATLAS_VALIDATOR_NAME = "atlas-reference-validator";
const ATLAS_VALIDATOR_LOCK_PATH = "node_modules/atlas-reference-validator";
const ATLAS_VALIDATOR_VENDOR_ROOT = "third-party/atlas-reference-validator";
const ATLAS_VALIDATOR_PACKAGE_PATH = `${ATLAS_VALIDATOR_VENDOR_ROOT}/package`;
const ATLAS_VALIDATOR_DEPENDENCY_ROOT = `${ATLAS_VALIDATOR_VENDOR_ROOT}/node_modules`;
const ATLAS_VALIDATOR_PROVENANCE_SCHEMA = "lifecycle.third-party-source.v1";
const ATLAS_VALIDATOR_PROCESSOR_REVISION = "2c7a78540ac30138218b12803f1c045cee8b109a";
const ATLAS_VALIDATOR_SPECIFICATION_REVISION = "2c7a78540ac30138218b12803f1c045cee8b109a";
const ATLAS_VALIDATOR_TREE = "b265413a6a0f19c727701489b700669d774bb6e1";
const ATLAS_VALIDATOR_INVENTORY_DIGEST = "sha256:623f5b625c8fc377fb833f6195066147a087c646434ceff8614de434d86de76e";
const ATLAS_VALIDATOR_IMPLEMENTATION_DIGEST = "sha256:7432f9d49b9efdc828fbbc573fa32f395def8e201c628d7741ba56b2acf230be";
const ATLAS_VALIDATOR_PROVENANCE_DIGEST = "sha256:bd436f42e7e5633f0687bcb137c9153b85e8f5adcea0be170abb91488600946a";
const ATLAS_VALIDATOR_LICENSE_DIGEST = "sha256:a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499";
const ATLAS_VALIDATOR_DISTRIBUTION = Object.freeze(["README.md", "bin", "package.json", "schemas", "src"]);

function sortedEntries(value) {
  return Object.fromEntries(Object.entries(value ?? {}).sort(([left], [right]) => left.localeCompare(right)));
}

function assertEqualRecord(left, right, message) {
  if (JSON.stringify(sortedEntries(left)) !== JSON.stringify(sortedEntries(right))) {
    throw new Error(message);
  }
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) throw new Error("Third-party provenance contains a non-canonical number");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw new Error(`Third-party provenance contains unsupported ${typeof value}`);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function selfDigest(value, field = "digest") {
  const subject = { ...value };
  delete subject[field];
  return sha256(canonicalJson(subject));
}

function exactKeys(value, expected, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${label} has an unsupported shape`);
  }
}

function sourceMode(metadata) {
  return (metadata.mode & 0o777).toString(8).padStart(6, "0");
}

function distributionFile(path, distribution) {
  return distribution.some((entry) => path === entry || path.startsWith(`${entry}/`));
}

async function regularFileInventory(root) {
  const files = [];
  const visit = async (directory, relativeRoot = "") => {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const source = join(directory, entry.name);
      const child = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
      const metadata = await lstat(source);
      if (metadata.isSymbolicLink()) throw new Error(`Vendored Atlas validator contains a symbolic link: ${child}`);
      if (metadata.isDirectory()) await visit(source, child);
      else if (metadata.isFile()) files.push(child);
      else throw new Error(`Vendored Atlas validator contains an unsupported entry: ${child}`);
    }
  };
  await visit(root);
  return files;
}

async function verifyVendoredAtlasValidator(source) {
  const vendorRoot = dirname(source);
  const provenancePath = join(vendorRoot, "PROVENANCE.json");
  const licensePath = join(vendorRoot, "LICENSE");
  for (const [label, path] of [["package", source], ["provenance", provenancePath], ["license", licensePath]]) {
    const metadata = await lstat(path);
    const expectedDirectory = label === "package";
    if (metadata.isSymbolicLink() || (expectedDirectory ? !metadata.isDirectory() : !metadata.isFile()) ||
        (!expectedDirectory && sourceMode(metadata) !== "000644")) {
      throw new Error(`Vendored Atlas validator ${label} carrier has an unsupported type or mode`);
    }
  }
  const provenance = await readJson(provenancePath);
  exactKeys(provenance, [
    "schema", "name", "version", "license", "upstream", "upstreamPath",
    "processorRevision", "specificationRevision", "upstreamTree", "upstreamInventoryDigest",
    "noLocalPatches", "distribution", "implementationDigest", "files", "digest",
  ], "Vendored Atlas validator provenance");
  if (
    provenance.schema !== ATLAS_VALIDATOR_PROVENANCE_SCHEMA ||
    provenance.name !== ATLAS_VALIDATOR_NAME ||
    provenance.version !== "0.8.0" ||
    provenance.license !== "CC0-1.0" ||
    provenance.upstream !== "https://github.com/neutral/atlas-dev" ||
    provenance.upstreamPath !== "plugin/validator" ||
    provenance.processorRevision !== ATLAS_VALIDATOR_PROCESSOR_REVISION ||
    provenance.specificationRevision !== ATLAS_VALIDATOR_SPECIFICATION_REVISION ||
    provenance.upstreamTree !== ATLAS_VALIDATOR_TREE ||
    provenance.upstreamInventoryDigest !== ATLAS_VALIDATOR_INVENTORY_DIGEST ||
    provenance.noLocalPatches !== true ||
    JSON.stringify(provenance.distribution) !== JSON.stringify(ATLAS_VALIDATOR_DISTRIBUTION) ||
    provenance.implementationDigest !== ATLAS_VALIDATOR_IMPLEMENTATION_DIGEST ||
    provenance.digest !== ATLAS_VALIDATOR_PROVENANCE_DIGEST ||
    selfDigest(provenance) !== provenance.digest
  ) {
    throw new Error("Vendored Atlas validator provenance differs from the exact selected source");
  }
  if (!Array.isArray(provenance.files) || provenance.files.length === 0) {
    throw new Error("Vendored Atlas validator provenance lacks its source inventory");
  }
  const paths = [];
  for (const record of provenance.files) {
    exactKeys(record, ["path", "mode", "byteLength", "sha256"], "Vendored Atlas validator file record");
    if (
      typeof record.path !== "string" || record.path.length === 0 || record.path.startsWith("/") ||
      record.path.includes("\\") || record.path.split("/").some((part) => part.length === 0 || part === "." || part === "..") ||
      !/^000(?:644|755)$/u.test(record.mode) ||
      !Number.isSafeInteger(record.byteLength) || record.byteLength < 0 ||
      !/^sha256:[a-f0-9]{64}$/u.test(record.sha256)
    ) {
      throw new Error(`Vendored Atlas validator provenance contains an invalid file record: ${record.path ?? "<unknown>"}`);
    }
    paths.push(record.path);
  }
  if (new Set(paths).size !== paths.length || JSON.stringify(paths) !== JSON.stringify([...paths].sort())) {
    throw new Error("Vendored Atlas validator provenance paths must be unique and ordered");
  }
  const actualPaths = await regularFileInventory(source);
  if (JSON.stringify(actualPaths) !== JSON.stringify(paths)) {
    throw new Error("Vendored Atlas validator source inventory differs from provenance");
  }
  for (const record of provenance.files) {
    const target = join(source, record.path);
    const metadata = await lstat(target);
    const bytes = await readFile(target);
    if (sourceMode(metadata) !== record.mode || metadata.size !== record.byteLength || sha256(bytes) !== record.sha256) {
      throw new Error(`Vendored Atlas validator file differs from provenance: ${record.path}`);
    }
  }
  const distributionRecords = provenance.files.filter((record) => distributionFile(record.path, provenance.distribution));
  if (sha256(canonicalJson(distributionRecords)) !== provenance.implementationDigest) {
    throw new Error("Vendored Atlas validator implementation digest does not bind its distribution inventory");
  }
  const packageValue = await readJson(join(source, "package.json"));
  const expectedPackage = {
    name: ATLAS_VALIDATOR_NAME,
    version: "0.8.0",
    description: "Reference validator for Atlas format 1",
    private: true,
    type: "module",
    license: "CC0-1.0",
    bin: { "atlas-validate": "bin/atlas-validate.mjs" },
    exports: { ".": "./src/index.mjs" },
    files: ["README.md", "bin", "schemas", "src"],
    scripts: { test: "node --test tests/*.test.mjs" },
    dependencies: { "@hyperjump/uri": "1.3.5", ajv: "8.20.0", "markdown-it": "14.3.0" },
    engines: { node: ">=22.23.2" },
  };
  if (canonicalJson(packageValue) !== canonicalJson(expectedPackage)) {
    throw new Error("Vendored Atlas validator package metadata differs from the selected source");
  }
  if (sha256(await readFile(licensePath)) !== ATLAS_VALIDATOR_LICENSE_DIGEST) {
    throw new Error("Vendored Atlas validator license differs from the exact CC0 source");
  }
  return Object.freeze({ provenance, provenancePath, licensePath });
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
  const vendoredPrefix = `${ATLAS_VALIDATOR_DEPENDENCY_ROOT}/`;
  if (sourceLockPath.startsWith(vendoredPrefix)) {
    return `${ATLAS_VALIDATOR_LOCK_PATH}/node_modules/${sourceLockPath.slice(vendoredPrefix.length)}`;
  }
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

async function copyVendoredAtlasValidator(source, target) {
  const verified = await verifyVendoredAtlasValidator(source);
  await mkdir(target, { recursive: false, mode: 0o755 });
  for (const relativePath of verified.provenance.distribution) {
    const sourcePath = join(source, relativePath);
    const targetPath = join(target, relativePath);
    await mkdir(dirname(targetPath), { recursive: true, mode: 0o755 });
    await cp(sourcePath, targetPath, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
    });
  }
  await cp(verified.licensePath, join(target, "LICENSE"), { errorOnExist: true });
  await cp(verified.provenancePath, join(target, "PROVENANCE.json"), { errorOnExist: true });

  const stagedPaths = await regularFileInventory(target);
  const expectedPaths = [
    "LICENSE",
    "PROVENANCE.json",
    ...verified.provenance.files
      .filter((record) => distributionFile(record.path, verified.provenance.distribution))
      .map((record) => record.path),
  ].sort();
  if (JSON.stringify(stagedPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error("Staged Atlas validator distribution differs from its exact provenance selection");
  }
  for (const record of verified.provenance.files.filter((candidate) =>
    distributionFile(candidate.path, verified.provenance.distribution))) {
    const stagedPath = join(target, record.path);
    const metadata = await lstat(stagedPath);
    const bytes = await readFile(stagedPath);
    if (sourceMode(metadata) !== record.mode || metadata.size !== record.byteLength || sha256(bytes) !== record.sha256) {
      throw new Error(`Staged Atlas validator file differs from provenance: ${record.path}`);
    }
  }
  for (const [name, sourcePath] of [
    ["LICENSE", verified.licensePath],
    ["PROVENANCE.json", verified.provenancePath],
  ]) {
    const stagedPath = join(target, name);
    const metadata = await lstat(stagedPath);
    if (
      sourceMode(metadata) !== "000644" ||
      !(await readFile(stagedPath)).equals(await readFile(sourcePath))
    ) {
      throw new Error(`Staged Atlas validator ${name} differs from its exact source carrier`);
    }
  }
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
      } else if (dependencyName === ATLAS_VALIDATOR_NAME && lockPath === ATLAS_VALIDATOR_LOCK_PATH &&
          entry.resolved === ATLAS_VALIDATOR_PACKAGE_PATH) {
        workspacePackagePath = ATLAS_VALIDATOR_PACKAGE_PATH;
        workspaceKind = "vendored-atlas-validator";
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
  const canonicalAtlasDependencyRoot = await realpath(join(WORKSPACE_ROOT, ATLAS_VALIDATOR_DEPENDENCY_ROOT));
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
      const selectedDependencyRoot = locked.sourceLockPath.startsWith(`${ATLAS_VALIDATOR_DEPENDENCY_ROOT}/`)
        ? canonicalAtlasDependencyRoot
        : canonicalDependencyRoot;
      const dependencyRelative = canonicalSource === null ? null : relative(selectedDependencyRoot, canonicalSource);
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
      name: locked.name,
      version: locked.version,
      sourceLockPath: locked.sourceLockPath,
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
      } else if (record.workspaceKind === "vendored-atlas-validator") {
        await copyVendoredAtlasValidator(record.source, target);
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
