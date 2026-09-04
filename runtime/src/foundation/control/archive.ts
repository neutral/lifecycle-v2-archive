import { lstat, open, readFile, readdir, rename } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { FoundationError } from "../error.js";
import { atomicWrite, ensureDirectory } from "../support/filesystem.js";
import {
  canonicalJson,
  canonicalPrettyJson,
  sha256Bytes,
  type Sha256,
} from "../validation/canonical.js";
import { assertFoundationSchema } from "../validation/schema-engine.js";
import { parseStrictJson } from "../validation/strict-json.js";
import { controlTimestamp } from "./model.js";
import {
  type ControlRecordStore,
  controlRecordStorePaths,
  openControlRecordStore,
} from "./store.js";
import {
  CONTROL_RECORD_STORE_ARCHIVE_SCHEMA,
  type ControlRecordFile,
  type ControlRecordStoreArchiveManifest,
  type ControlRecordStoreIdentity,
} from "./types.js";

const ARCHIVE_MANIFEST_FILENAME = "archive-manifest.json";
const MAXIMUM_STORE_ROOT_BYTES = 16 * 1024 * 1024 * 1024;
const MAXIMUM_ARCHIVE_MANIFEST_BYTES = 2 * 1024 * 1024;
const ARCHIVE_SCHEMA_ID = "urn:lifecycle:schema:control-record-store-archive:v1";

function fail(code: string, message: string, observedFacts?: unknown): never {
  throw new FoundationError(`lifecycle.control-record-store.${code}`, message, { observedFacts });
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function databaseFacts(path: string): Promise<Readonly<{
  byteLength: number;
  retrievalDigest: Sha256;
}>> {
  const state = await lstat(path, { bigint: true });
  if (!state.isFile() || state.isSymbolicLink() || state.nlink !== 1n) {
    fail("archive-database", "Archive database must be one canonical regular file");
  }
  const bytes = await readFile(path);
  return Object.freeze({
    byteLength: bytes.byteLength,
    retrievalDigest: sha256Bytes(bytes),
  });
}

async function fileInventory(
  filesRoot: string,
  descriptors: readonly ControlRecordFile[],
): Promise<ControlRecordStoreArchiveManifest["files"]> {
  const entries = (await readdir(filesRoot)).sort();
  const expectedNames = descriptors.map(({ digest }) =>
    `sha256-${digest.slice("sha256:".length)}`);
  if (
    entries.length !== expectedNames.length ||
    entries.some((entry, index) => entry !== expectedNames[index])
  ) {
    fail("archive-file", "Archive files directory does not equal the retained descriptor inventory");
  }
  const files = [];
  for (const descriptor of descriptors) {
    const filename = `sha256-${descriptor.digest.slice("sha256:".length)}`;
    const path = join(filesRoot, filename);
    const state = await lstat(path, { bigint: true });
    if (!state.isFile() || state.isSymbolicLink() || state.nlink !== 1n) {
      fail("archive-file", `Archive file ${filename} is not one canonical regular file`);
    }
    const bytes = await readFile(path);
    const digest = sha256Bytes(bytes);
    if (
      digest !== descriptor.digest ||
      bytes.byteLength !== descriptor.byteLength ||
      filename !== `sha256-${digest.slice("sha256:".length)}`
    ) {
      fail("archive-file", `Archive file ${filename} does not match its content address`);
    }
    files.push(Object.freeze({
      filename,
      reference: Object.freeze({
        digest: descriptor.digest,
        byteLength: descriptor.byteLength,
        mediaType: descriptor.mediaType,
        purpose: descriptor.purpose,
      }),
    }));
  }
  return Object.freeze(files);
}

async function exactRootEntries(root: string, allowed: readonly string[]): Promise<void> {
  const entries = (await readdir(root)).sort();
  const expected = [...allowed].sort();
  if (
    entries.length !== expected.length ||
    entries.some((entry, index) => entry !== expected[index])
  ) {
    fail(
      "archive-layout",
      "Control Record Store root contains entries outside the exact archive protocol",
      { entries, expected },
    );
  }
}

export function controlRecordStoreArchiveDirectoryName(
  identity: ControlRecordStoreIdentity,
): string {
  return `sha256-${sha256Bytes(identity.processId).slice("sha256:".length)}`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function readArchiveManifest(
  root: string,
): Promise<Readonly<{
  bytes: Buffer;
  digest: Sha256;
  manifest: ControlRecordStoreArchiveManifest;
}>> {
  const path = join(root, ARCHIVE_MANIFEST_FILENAME);
  const state = await lstat(path, { bigint: true });
  if (
    !state.isFile() ||
    state.isSymbolicLink() ||
    state.nlink !== 1n ||
    Number(state.mode & 0o7777n) !== 0o600 ||
    state.size > BigInt(MAXIMUM_ARCHIVE_MANIFEST_BYTES)
  ) {
    fail("archive-manifest", "Archive manifest must be one bounded mode-0600 canonical regular file");
  }
  const bytes = await readFile(path);
  const parsed = parseStrictJson(bytes.toString("utf8"), {
    source: ARCHIVE_MANIFEST_FILENAME,
  });
  assertFoundationSchema(ARCHIVE_SCHEMA_ID, parsed, ARCHIVE_MANIFEST_FILENAME);
  const manifest = parsed as ControlRecordStoreArchiveManifest;
  const canonicalBytes = Buffer.from(canonicalPrettyJson(manifest), "utf8");
  if (!bytes.equals(canonicalBytes)) {
    fail("archive-manifest", "Archive manifest bytes are not the exact canonical representation");
  }
  return Object.freeze({ bytes, digest: sha256Bytes(bytes), manifest });
}

function assertExpectedArchive(
  manifest: ControlRecordStoreArchiveManifest,
  identity: ControlRecordStoreIdentity,
  archivedAt: string | undefined,
): void {
  if (canonicalJson(manifest.store) !== canonicalJson(identity)) {
    fail("archive-identity", "Archive manifest does not bind the selected exact Control Record Store");
  }
  controlTimestamp(manifest.archivedAt, "Control Record Store archive time");
  if (archivedAt !== undefined && manifest.archivedAt !== archivedAt) {
    fail("archive-conflict", "Archive retry changes the retained archive time");
  }
}

export async function openArchivedControlRecordStore(input: Readonly<{
  archiveRoot: string;
  identity: ControlRecordStoreIdentity;
  archivedAt?: string;
}>): Promise<Readonly<{
  store: ControlRecordStore;
  manifest: ControlRecordStoreArchiveManifest;
  manifestDigest: Sha256;
}>> {
  const archiveRoot = resolve(input.archiveRoot);
  const paths = controlRecordStorePaths(archiveRoot);
  await exactRootEntries(archiveRoot, [
    basename(paths.database),
    basename(paths.files),
    basename(paths.drafts),
    ARCHIVE_MANIFEST_FILENAME,
  ]);
  const retained = await readArchiveManifest(archiveRoot);
  assertExpectedArchive(retained.manifest, input.identity, input.archivedAt);
  const database = await databaseFacts(paths.database);
  if (
    retained.manifest.database.filename !== basename(paths.database) ||
    retained.manifest.database.byteLength !== database.byteLength ||
    retained.manifest.database.retrievalDigest !== database.retrievalDigest
  ) {
    fail("archive-database", "Archived SQLite retrieval bytes do not match the archive manifest");
  }
  const store = await openControlRecordStore({
    root: archiveRoot,
    identity: input.identity,
    create: false,
    readOnly: true,
    archiveLayout: true,
  });
  try {
    const files = await fileInventory(paths.files, store.listRetainedFiles());
    if (canonicalJson(files) !== canonicalJson(retained.manifest.files)) {
      fail("archive-file", "Archived adjacent-file inventory does not match the archive manifest");
    }
    const completeByteLength = database.byteLength +
      files.reduce((total, file) => total + file.reference.byteLength, 0) +
      retained.bytes.byteLength;
    if (completeByteLength > MAXIMUM_STORE_ROOT_BYTES) {
      fail("archive-limit", "Control Record Store archive exceeds the complete-root byte limit", {
        completeByteLength,
        maximumByteLength: MAXIMUM_STORE_ROOT_BYTES,
      });
    }
    const seal = store.getSeal();
    if (
      seal === null ||
      canonicalJson(seal) !== canonicalJson(retained.manifest.seal) ||
      store.logicalInventoryDigest() !== seal.logicalInventoryDigest
    ) {
      fail("archive-inventory", "Archive manifest does not bind the exact sealed logical inventory");
    }
  } catch (error) {
    store.close();
    throw error;
  }
  return Object.freeze({
    store,
    manifest: retained.manifest,
    manifestDigest: retained.digest,
  });
}

async function inspectArchivedControlRecordStore(input: Readonly<{
  archiveRoot: string;
  identity: ControlRecordStoreIdentity;
  archivedAt: string;
}>): Promise<Readonly<{
  manifest: ControlRecordStoreArchiveManifest;
  manifestDigest: Sha256;
}>> {
  const opened = await openArchivedControlRecordStore(input);
  opened.store.close();
  return Object.freeze({
    manifest: opened.manifest,
    manifestDigest: opened.manifestDigest,
  });
}

export async function archiveControlRecordStore(input: Readonly<{
  activeRoot: string;
  archiveParent: string;
  identity: ControlRecordStoreIdentity;
  archivedAt: string;
}>): Promise<Readonly<{
  archiveRoot: string;
  manifest: ControlRecordStoreArchiveManifest;
  manifestDigest: Sha256;
}>> {
  const activeRoot = resolve(input.activeRoot);
  const archiveParent = resolve(input.archiveParent);
  if (dirname(activeRoot) === activeRoot || activeRoot === archiveParent) {
    fail("archive-layout", "Archive requires one bounded active store and distinct archive parent");
  }
  const archiveRelative = relative(activeRoot, archiveParent);
  if (
    archiveRelative === "" ||
    (!archiveRelative.startsWith(`..${sep}`) && archiveRelative !== ".." && !isAbsolute(archiveRelative))
  ) {
    fail("archive-layout", "Archive parent cannot be inside the active Control Record Store");
  }
  controlTimestamp(input.archivedAt, "Control Record Store archive time");
  await ensureDirectory(archiveParent, 0o700);

  const archiveRoot = join(archiveParent, controlRecordStoreArchiveDirectoryName(input.identity));
  const activeExists = await pathExists(activeRoot);
  const archiveExists = await pathExists(archiveRoot);
  if (archiveExists) {
    if (activeExists) {
      fail("archive-conflict", "Active and archived roots both exist for one exact Delivery");
    }
    const retained = await inspectArchivedControlRecordStore({
      archiveRoot,
      identity: input.identity,
      archivedAt: input.archivedAt,
    });
    return Object.freeze({ archiveRoot, ...retained });
  }
  if (!activeExists) {
    fail("archive-layout", "Neither the active nor exact archived Control Record Store exists");
  }

  const activePaths = controlRecordStorePaths(activeRoot);
  const baseEntries = Object.freeze([
    basename(activePaths.database),
    basename(activePaths.files),
    basename(activePaths.drafts),
  ]);
  const activeEntries = (await readdir(activeRoot)).sort();
  const preparedEntries = [...baseEntries, ARCHIVE_MANIFEST_FILENAME].sort();
  const isPrepared = activeEntries.length === preparedEntries.length &&
    activeEntries.every((entry, index) => entry === preparedEntries[index]);
  if (!isPrepared) {
    await exactRootEntries(activeRoot, baseEntries);
    const store = await openControlRecordStore({
      root: activeRoot,
      identity: input.identity,
      create: false,
      readOnly: true,
    });
    let seal;
    let retainedFileDescriptors: readonly ControlRecordFile[];
    try {
      const initialDraftEntries = await readdir(activePaths.drafts);
      if (initialDraftEntries.length > 0) {
        fail(
          "archive-drafts",
          "A Control Record Store with governed authoring workspaces cannot be archived",
          initialDraftEntries,
        );
      }
      seal = store.getSeal();
      if (seal === null) fail("archive-unsealed", "Only a sealed Control Record Store can be archived");
      if (store.logicalInventoryDigest() !== seal.logicalInventoryDigest) {
        fail("archive-inventory", "Store seal does not match the exact logical inventory");
      }
      retainedFileDescriptors = store.listRetainedFiles();
    } finally {
      store.close();
    }

    const draftEntries = await readdir(activePaths.drafts);
    if (draftEntries.length > 0) {
      fail("archive-drafts", "A Control Record Store with governed authoring workspaces cannot be archived", draftEntries);
    }
    await exactRootEntries(activeRoot, baseEntries);
    await syncFile(activePaths.database);
    const files = await fileInventory(activePaths.files, retainedFileDescriptors);
    for (const file of files) await syncFile(join(activePaths.files, file.filename));
    await syncDirectory(activePaths.files);
    await syncDirectory(activePaths.drafts);
    const database = await databaseFacts(activePaths.database);
    const manifest: ControlRecordStoreArchiveManifest = Object.freeze({
      schema: CONTROL_RECORD_STORE_ARCHIVE_SCHEMA,
      store: input.identity,
      seal,
      database: Object.freeze({
        filename: "control-record-store.sqlite",
        byteLength: database.byteLength,
        retrievalDigest: database.retrievalDigest,
      }),
      files,
      archivedAt: input.archivedAt,
    });
    const manifestBytes = canonicalPrettyJson(manifest);
    const completeByteLength = database.byteLength +
      files.reduce((total, file) => total + file.reference.byteLength, 0) +
      Buffer.byteLength(manifestBytes, "utf8");
    if (completeByteLength > MAXIMUM_STORE_ROOT_BYTES) {
      fail("archive-limit", "Control Record Store archive exceeds the complete-root byte limit", {
        completeByteLength,
        maximumByteLength: MAXIMUM_STORE_ROOT_BYTES,
      });
    }
    await atomicWrite(join(activeRoot, ARCHIVE_MANIFEST_FILENAME), manifestBytes, 0o600);
    await exactRootEntries(activeRoot, preparedEntries);
    await syncDirectory(activeRoot);
  }

  const prepared = await inspectArchivedControlRecordStore({
    archiveRoot: activeRoot,
    identity: input.identity,
    archivedAt: input.archivedAt,
  });
  try {
    await rename(activeRoot, archiveRoot);
    await syncDirectory(dirname(activeRoot));
    await syncDirectory(archiveParent);
  } catch (error) {
    if (!await pathExists(activeRoot) && await pathExists(archiveRoot)) {
      const retained = await inspectArchivedControlRecordStore({
        archiveRoot,
        identity: input.identity,
        archivedAt: input.archivedAt,
      });
      return Object.freeze({ archiveRoot, ...retained });
    }
    throw error;
  }
  const retained = await inspectArchivedControlRecordStore({
    archiveRoot,
    identity: input.identity,
    archivedAt: input.archivedAt,
  });
  if (retained.manifestDigest !== prepared.manifestDigest) {
    fail("archive-manifest", "Retained archive manifest bytes changed during archive movement");
  }
  return Object.freeze({ archiveRoot, ...retained });
}
