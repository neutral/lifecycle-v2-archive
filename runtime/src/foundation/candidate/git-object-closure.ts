import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { TextDecoder } from "node:util";
import { FoundationError } from "../error.js";
import {
  git,
  gitBytes,
  resolveGitObjectFormat,
} from "../repository/git.js";
import type { FoundationGitObjectFormat } from "../repository/types.js";
import type { Sha256 } from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_FORMAT,
  type FoundationCandidateRevisionCarrierArtifactV1,
  type FoundationCandidateRevisionCarrierLimitsV1,
  type FoundationCandidateRevisionCarrierManifestV1,
  type FoundationCandidateRevisionCarrierObjectV1,
  type FoundationCandidateRevisionCarrierTreeEntryV1,
} from "./carrier-types.js";

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const TREE_LISTING_BYTE_BOUND = 256 * 1024 * 1024;
const COPY_BUFFER_BYTES = 1024 * 1024;

type DirectTreeEntry = Readonly<{
  mode: string;
  objectType: "blob" | "tree" | "commit";
  objectId: string;
  name: string;
}>;

export type FoundationCandidateRevisionCarrierClosureV1 = Readonly<{
  objectFormat: FoundationGitObjectFormat;
  rootTree: string;
  objectInventory: readonly FoundationCandidateRevisionCarrierObjectV1[];
  treeEntries: readonly FoundationCandidateRevisionCarrierTreeEntryV1[];
}>;

function invalid(message: string, observedFacts?: unknown): never {
  throw new FoundationError("lifecycle.candidate.carrier-invalid", message, {
    observedFacts,
  });
}

function exactObjectId(
  value: string,
  objectFormat: FoundationGitObjectFormat,
  label: string,
): string {
  const length = objectFormat === "sha1" ? 40 : 64;
  if (!new RegExp(`^[a-f0-9]{${length}}$`, "u").test(value)) {
    invalid(`${label} is not one exact ${objectFormat} Git object identity`, {
      value,
    });
  }
  return value;
}

function decodeTreeName(bytes: Buffer, label: string): string {
  let value: string;
  try {
    value = UTF8.decode(bytes);
  } catch (error) {
    invalid(`${label} is not exact UTF-8`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (
    bytes.byteLength === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("?") ||
    value.includes("#") ||
    /%2f|%5c/u.test(value.toLowerCase()) ||
    value.toLowerCase() === ".git"
  ) {
    invalid(`${label} is not a valid materializable repository path segment`, {
      name: value,
    });
  }
  return value;
}

function parseDirectTree(
  bytes: Buffer,
  objectFormat: FoundationGitObjectFormat,
): readonly DirectTreeEntry[] {
  if (bytes.byteLength > TREE_LISTING_BYTE_BOUND) {
    invalid("Candidate Revision Carrier tree listing exceeds its byte bound");
  }
  if (bytes.byteLength === 0) return Object.freeze([]);
  if (bytes.at(-1) !== 0) {
    invalid("Candidate Revision Carrier tree listing is not NUL terminated");
  }
  const entries: DirectTreeEntry[] = [];
  const names = new Set<string>();
  let offset = 0;
  while (offset < bytes.byteLength) {
    const end = bytes.indexOf(0, offset);
    if (end <= offset) invalid("Candidate Revision Carrier tree contains an empty or unterminated entry");
    const line = bytes.subarray(offset, end);
    const tab = line.indexOf(0x09);
    if (tab <= 0 || tab === line.byteLength - 1) {
      invalid("Candidate Revision Carrier tree contains a malformed entry");
    }
    const headerBytes = line.subarray(0, tab);
    if (headerBytes.some((byte) => byte > 0x7f)) {
      invalid("Candidate Revision Carrier tree entry header is not ASCII");
    }
    const match = /^(\d{6}) (blob|tree|commit) ([a-f0-9]+)$/u.exec(
      headerBytes.toString("ascii"),
    );
    if (match === null) invalid("Candidate Revision Carrier tree entry header is malformed");
    const name = decodeTreeName(line.subarray(tab + 1), "Candidate Revision Carrier tree entry name");
    if (names.has(name)) {
      invalid("Candidate Revision Carrier tree repeats one entry name", { name });
    }
    names.add(name);
    entries.push(Object.freeze({
      mode: match[1]!,
      objectType: match[2]! as DirectTreeEntry["objectType"],
      objectId: exactObjectId(match[3]!, objectFormat, `Git object for ${name}`),
      name,
    }));
    offset = end + 1;
  }
  return Object.freeze(entries.sort((left, right) => compareCodePoints(left.name, right.name)));
}

async function directTreeEntries(
  repository: string,
  objectFormat: FoundationGitObjectFormat,
  tree: string,
  cache: Map<string, readonly DirectTreeEntry[]>,
  limits: FoundationCandidateRevisionCarrierLimitsV1,
): Promise<readonly DirectTreeEntry[]> {
  const cached = cache.get(tree);
  if (cached !== undefined) return cached;
  const result = await gitBytes(repository, ["ls-tree", "-z", "--full-name", tree], {
    allowFailure: true,
    maxStdoutBytes: TREE_LISTING_BYTE_BOUND,
    timeoutMs: limits.commandTimeoutMs,
  });
  if (result.exitCode !== 0 || result.stdoutTruncated || result.timedOut) {
    invalid("Candidate Revision Carrier tree could not be parsed exactly", {
      tree,
      exitCode: result.exitCode,
      timedOut: result.timedOut ?? false,
      truncated: result.stdoutTruncated ?? false,
    });
  }
  const entries = parseDirectTree(result.stdout, objectFormat);
  if (entries.length === 0) {
    invalid("Candidate Revision Carrier contains an empty reachable tree", {
      tree,
    });
  }
  cache.set(tree, entries);
  return entries;
}

async function objectFacts(
  repository: string,
  objectFormat: FoundationGitObjectFormat,
  expected: ReadonlyMap<string, "blob" | "tree">,
  limits: FoundationCandidateRevisionCarrierLimitsV1,
): Promise<readonly FoundationCandidateRevisionCarrierObjectV1[]> {
  const objectIds = [...expected.keys()].sort();
  if (objectIds.length < 1 || objectIds.length > limits.maximumObjects) {
    invalid("Candidate Revision Carrier object closure is outside its object-count bound", {
      maximumObjects: limits.maximumObjects,
      objectCount: objectIds.length,
    });
  }
  const maximumOutputBytes = Math.min(
    Number.MAX_SAFE_INTEGER,
    objectIds.length * ((objectFormat === "sha1" ? 40 : 64) + 32) + 1,
  );
  const result = await git(repository, [
    "cat-file",
    "--batch-check=%(objectname) %(objecttype) %(objectsize)",
  ], {
    allowFailure: true,
    input: `${objectIds.join("\n")}\n`,
    maxStdoutBytes: maximumOutputBytes,
    timeoutMs: limits.commandTimeoutMs,
  });
  if (result.exitCode !== 0 || result.stdoutTruncated || result.timedOut) {
    invalid("Candidate Revision Carrier object closure could not be inspected exactly", {
      exitCode: result.exitCode,
      timedOut: result.timedOut ?? false,
      truncated: result.stdoutTruncated ?? false,
    });
  }
  const lines = result.stdout.endsWith("\n")
    ? result.stdout.slice(0, -1).split("\n")
    : result.stdout.split("\n");
  if (lines.length !== objectIds.length) {
    invalid("Candidate Revision Carrier object inspection returned an ambiguous inventory", {
      expected: objectIds.length,
      observed: lines.length,
    });
  }
  let aggregateObjectBytes = 0;
  const inventory = lines.map((line, index) => {
    const match = /^([a-f0-9]+) (blob|tree) ([0-9]+)$/u.exec(line);
    const expectedId = objectIds[index]!;
    const expectedType = expected.get(expectedId)!;
    if (
      match === null ||
      exactObjectId(match[1]!, objectFormat, "Inspected Git object") !== expectedId ||
      match[2] !== expectedType
    ) {
      invalid("Candidate Revision Carrier object inspection disagrees with its tree closure", {
        expectedId,
        expectedType,
        observed: line,
      });
    }
    const byteLength = Number(match[3]!);
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
      invalid("Candidate Revision Carrier object payload byte length is not a safe integer", {
        objectId: expectedId,
        value: match[3],
      });
    }
    aggregateObjectBytes += byteLength;
    if (
      !Number.isSafeInteger(aggregateObjectBytes) ||
      aggregateObjectBytes > limits.maximumAggregateObjectBytes
    ) {
      invalid("Candidate Revision Carrier aggregate object bytes exceed their bound", {
        maximumAggregateObjectBytes: limits.maximumAggregateObjectBytes,
      });
    }
    return Object.freeze({
      objectId: expectedId,
      objectType: expectedType,
      byteLength,
    });
  });
  return Object.freeze(inventory);
}

export async function inspectCandidateRevisionCarrierClosure(input: Readonly<{
  repository: string;
  rootTree: string;
  limits: FoundationCandidateRevisionCarrierLimitsV1;
  expectedObjectFormat?: FoundationGitObjectFormat;
}>): Promise<FoundationCandidateRevisionCarrierClosureV1> {
  const objectFormat = await resolveGitObjectFormat(input.repository);
  if (input.expectedObjectFormat !== undefined && input.expectedObjectFormat !== objectFormat) {
    invalid("Candidate Revision Carrier Git object format changed across inspection", {
      expected: input.expectedObjectFormat,
      observed: objectFormat,
    });
  }
  const rootTree = exactObjectId(input.rootTree, objectFormat, "Candidate Revision Carrier root tree");
  const rootType = await git(input.repository, ["cat-file", "-t", rootTree], {
    allowFailure: true,
    timeoutMs: input.limits.commandTimeoutMs,
  });
  if (rootType.exitCode !== 0 || rootType.stdout.trim() !== "tree") {
    invalid("Candidate Revision Carrier root identity is unavailable or is not a tree", {
      rootTree,
      observedType: rootType.stdout.trim() || null,
    });
  }

  const expected = new Map<string, "blob" | "tree">([[rootTree, "tree"]]);
  const treeCache = new Map<string, readonly DirectTreeEntry[]>();
  const fileEntries: Omit<FoundationCandidateRevisionCarrierTreeEntryV1, "byteLength">[] = [];
  const paths = new Set<string>();
  const pending: Array<Readonly<{
    tree: string;
    prefix: string;
    depth: number;
    ancestors: ReadonlySet<string>;
  }>> = [Object.freeze({ tree: rootTree, prefix: "", depth: 0, ancestors: new Set([rootTree]) })];
  let observedTreeEntries = 0;

  while (pending.length > 0) {
    const occurrence = pending.pop()!;
    if (occurrence.depth > input.limits.maximumTreeDepth) {
      invalid("Candidate Revision Carrier tree exceeds its depth bound", {
        maximumTreeDepth: input.limits.maximumTreeDepth,
      });
    }
    const entries = await directTreeEntries(
      input.repository,
      objectFormat,
      occurrence.tree,
      treeCache,
      input.limits,
    );
    for (const entry of entries) {
      observedTreeEntries += 1;
      if (observedTreeEntries > input.limits.maximumTreeEntries) {
        invalid("Candidate Revision Carrier tree exceeds its entry bound", {
          maximumTreeEntries: input.limits.maximumTreeEntries,
        });
      }
      const path = occurrence.prefix === "" ? entry.name : `${occurrence.prefix}/${entry.name}`;
      if (Buffer.byteLength(path, "utf8") > input.limits.maximumRepositoryPathBytes) {
        invalid("Candidate Revision Carrier path exceeds its byte bound", {
          maximumRepositoryPathBytes: input.limits.maximumRepositoryPathBytes,
          path,
        });
      }
      if (paths.has(path)) {
        invalid("Candidate Revision Carrier tree resolves one path more than once", { path });
      }
      paths.add(path);

      const allowed = entry.mode === "040000" && entry.objectType === "tree"
        ? "tree"
        : (entry.mode === "100644" || entry.mode === "100755") && entry.objectType === "blob"
          ? "blob"
          : null;
      if (allowed === null) {
        invalid("Candidate Revision Carrier tree contains an unsupported mode or object type", {
          mode: entry.mode,
          objectId: entry.objectId,
          objectType: entry.objectType,
          path,
        });
      }
      const priorType = expected.get(entry.objectId);
      if (priorType !== undefined && priorType !== allowed) {
        invalid("Candidate Revision Carrier object is referenced with conflicting types", {
          objectId: entry.objectId,
          priorType,
          selectedType: allowed,
        });
      }
      expected.set(entry.objectId, allowed);
      if (expected.size > input.limits.maximumObjects) {
        invalid("Candidate Revision Carrier object closure exceeds its object-count bound", {
          maximumObjects: input.limits.maximumObjects,
        });
      }

      if (allowed === "tree") {
        if (occurrence.ancestors.has(entry.objectId)) {
          invalid("Candidate Revision Carrier tree contains a recursive tree reference", {
            objectId: entry.objectId,
            path,
          });
        }
        pending.push(Object.freeze({
          tree: entry.objectId,
          prefix: path,
          depth: occurrence.depth + 1,
          ancestors: new Set([...occurrence.ancestors, entry.objectId]),
        }));
      } else {
        fileEntries.push(Object.freeze({
          path,
          objectId: entry.objectId,
          mode: entry.mode as "100644" | "100755",
        }));
      }
    }
  }

  const objectInventory = await objectFacts(
    input.repository,
    objectFormat,
    expected,
    input.limits,
  );
  const sizes = new Map(objectInventory.map(({ objectId, byteLength }) => [objectId, byteLength]));
  const treeEntries = fileEntries
    .map((entry) => Object.freeze({
      ...entry,
      byteLength: sizes.get(entry.objectId)!,
    }))
    .sort((left, right) => compareCodePoints(left.path, right.path));
  return Object.freeze({
    objectFormat,
    rootTree,
    objectInventory,
    treeEntries: Object.freeze(treeEntries),
  });
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

export async function buildCandidateRevisionCarrierPack(input: Readonly<{
  repository: string;
  stagingRoot: string;
  closure: FoundationCandidateRevisionCarrierClosureV1;
  limits: FoundationCandidateRevisionCarrierLimitsV1;
}>): Promise<Readonly<{
  artifactPath: string;
  artifact: FoundationCandidateRevisionCarrierArtifactV1;
}>> {
  await chmod(input.stagingRoot, 0o700);
  const initialEntries = await readdir(input.stagingRoot);
  if (initialEntries.length !== 0) {
    invalid("Candidate Revision Carrier staging root was not created empty", {
      entries: initialEntries.sort(),
    });
  }
  const packBase = join(input.stagingRoot, `objects-${randomUUID()}`);
  const objectIds = input.closure.objectInventory.map(({ objectId }) => objectId);
  const packed = await git(input.repository, [
    "-c",
    "pack.writeReverseIndex=false",
    "pack-objects",
    "--no-revs",
    "--no-thin",
    "--no-reuse-delta",
    "--no-reuse-object",
    "--window=0",
    "--depth=0",
    "--threads=1",
    "--compression=0",
    "--index-version=2",
    "--no-write-bitmap-index",
    packBase,
  ], {
    allowFailure: true,
    input: `${objectIds.join("\n")}\n`,
    maxStdoutBytes: 1024,
    timeoutMs: input.limits.commandTimeoutMs,
  });
  const packHash = packed.stdout.trim();
  const hashLength = input.closure.objectFormat === "sha1" ? 40 : 64;
  if (
    packed.exitCode !== 0 ||
    packed.stdoutTruncated ||
    packed.timedOut ||
    !new RegExp(`^[a-f0-9]{${hashLength}}$`, "u").test(packHash)
  ) {
    invalid("Candidate Revision Carrier pack could not be built exactly", {
      exitCode: packed.exitCode,
      output: packHash.slice(0, 128),
      timedOut: packed.timedOut ?? false,
      truncated: packed.stdoutTruncated ?? false,
    });
  }
  const generatedPack = `${packBase}-${packHash}.pack`;
  const generatedIndex = `${packBase}-${packHash}.idx`;
  const artifactPath = join(input.stagingRoot, "carrier.pack");
  await rename(generatedPack, artifactPath);
  await rm(generatedIndex, { force: true });
  await chmod(artifactPath, 0o600);
  const entries = await readdir(input.stagingRoot);
  if (entries.length !== 1 || entries[0] !== "carrier.pack") {
    invalid("Candidate Revision Carrier pack preparation left an ambiguous staging inventory", {
      entries: entries.sort(),
    });
  }
  await syncFile(artifactPath);
  await syncDirectory(input.stagingRoot);
  const facts = await readCandidateRevisionCarrierArtifact({
    artifactPath,
    maximumBytes: input.limits.maximumCarrierArtifactBytes,
  });
  return Object.freeze({
    artifactPath,
    artifact: Object.freeze({
      format: FOUNDATION_CANDIDATE_REVISION_CARRIER_FORMAT,
      byteLength: facts.byteLength,
      digest: facts.digest,
    }),
  });
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  bytes: Buffer,
  length: number,
): Promise<void> {
  let offset = 0;
  while (offset < length) {
    const result = await handle.write(bytes, offset, length - offset, null);
    if (result.bytesWritten < 1) invalid("Candidate Revision Carrier artifact copy made no progress");
    offset += result.bytesWritten;
  }
}

export async function readCandidateRevisionCarrierArtifact(input: Readonly<{
  artifactPath: string;
  maximumBytes: number;
  copyPath?: string;
}>): Promise<Readonly<{
  byteLength: number;
  digest: Sha256;
}>> {
  const source = await open(
    input.artifactPath,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  ).catch((error: unknown) => invalid("Candidate Revision Carrier artifact cannot be opened exactly", {
    cause: error instanceof Error ? error.message : String(error),
  }));
  let destination: Awaited<ReturnType<typeof open>> | null = null;
  try {
    const state = await source.stat({ bigint: true });
    const effectiveUid = process.geteuid?.() ?? process.getuid?.();
    if (
      !state.isFile() ||
      state.isSymbolicLink() ||
      state.nlink !== 1n ||
      Number(state.mode & 0o7777n) !== 0o600 ||
      (effectiveUid !== undefined && state.uid !== BigInt(effectiveUid))
    ) {
      invalid("Candidate Revision Carrier artifact is not one private regular file");
    }
    const expectedBytes = Number(state.size);
    if (
      !Number.isSafeInteger(expectedBytes) ||
      expectedBytes < 1 ||
      expectedBytes > input.maximumBytes
    ) {
      invalid("Candidate Revision Carrier artifact is outside its byte bound", {
        byteLength: state.size.toString(),
        maximumBytes: input.maximumBytes,
      });
    }
    if (input.copyPath !== undefined) {
      destination = await open(input.copyPath, "wx", 0o600);
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    let byteLength = 0;
    for (;;) {
      const result = await source.read(buffer, 0, buffer.byteLength, null);
      if (result.bytesRead === 0) break;
      byteLength += result.bytesRead;
      if (byteLength > input.maximumBytes || byteLength > expectedBytes) {
        invalid("Candidate Revision Carrier artifact changed or exceeded its byte bound while opening");
      }
      hash.update(buffer.subarray(0, result.bytesRead));
      if (destination !== null) await writeAll(destination, buffer, result.bytesRead);
    }
    if (byteLength !== expectedBytes) {
      invalid("Candidate Revision Carrier artifact changed while it was being opened", {
        expectedBytes,
        observedBytes: byteLength,
      });
    }
    if (destination !== null) {
      await destination.chmod(0o600);
      await destination.sync();
    }
    return Object.freeze({
      byteLength,
      digest: `sha256:${hash.digest("hex")}` as Sha256,
    });
  } finally {
    await destination?.close().catch(() => undefined);
    await source.close().catch(() => undefined);
  }
}

function sameInventory(
  left: readonly FoundationCandidateRevisionCarrierObjectV1[],
  right: readonly FoundationCandidateRevisionCarrierObjectV1[],
): boolean {
  return left.length === right.length && left.every((descriptor, index) => {
    const selected = right[index];
    return selected !== undefined &&
      selected.objectId === descriptor.objectId &&
      selected.objectType === descriptor.objectType &&
      selected.byteLength === descriptor.byteLength;
  });
}

async function packHeader(path: string): Promise<Readonly<{
  version: number;
  objectCount: number;
}>> {
  const handle = await open(path, "r");
  try {
    const bytes = Buffer.alloc(12);
    const result = await handle.read(bytes, 0, bytes.byteLength, 0);
    if (result.bytesRead !== bytes.byteLength || bytes.subarray(0, 4).toString("ascii") !== "PACK") {
      invalid("Candidate Revision Carrier artifact is not one complete Git pack");
    }
    return Object.freeze({
      version: bytes.readUInt32BE(4),
      objectCount: bytes.readUInt32BE(8),
    });
  } finally {
    await handle.close();
  }
}

async function allPackedObjects(
  repository: string,
  objectFormat: FoundationGitObjectFormat,
  limits: FoundationCandidateRevisionCarrierLimitsV1,
): Promise<readonly FoundationCandidateRevisionCarrierObjectV1[]> {
  const maximumOutputBytes = Math.min(
    Number.MAX_SAFE_INTEGER,
    limits.maximumObjects * ((objectFormat === "sha1" ? 40 : 64) + 32) + 1,
  );
  const result = await git(repository, [
    "cat-file",
    "--batch-all-objects",
    "--batch-check=%(objectname) %(objecttype) %(objectsize)",
  ], {
    allowFailure: true,
    maxStdoutBytes: maximumOutputBytes,
    timeoutMs: limits.commandTimeoutMs,
  });
  if (result.exitCode !== 0 || result.stdoutTruncated || result.timedOut) {
    invalid("Candidate Revision Carrier pack inventory cannot be enumerated exactly", {
      exitCode: result.exitCode,
      timedOut: result.timedOut ?? false,
      truncated: result.stdoutTruncated ?? false,
    });
  }
  const lines = result.stdout === ""
    ? []
    : (result.stdout.endsWith("\n") ? result.stdout.slice(0, -1) : result.stdout).split("\n");
  if (lines.length > limits.maximumObjects) {
    invalid("Candidate Revision Carrier pack exceeds its object-count bound");
  }
  const inventory = lines.map((line) => {
    const match = /^([a-f0-9]+) (blob|tree) ([0-9]+)$/u.exec(line);
    if (match === null) {
      invalid("Candidate Revision Carrier pack contains an unsupported or malformed object", {
        observed: line.slice(0, 256),
      });
    }
    const byteLength = Number(match[3]!);
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
      invalid("Candidate Revision Carrier pack reports an unsafe object payload length");
    }
    return Object.freeze({
      objectId: exactObjectId(match[1]!, objectFormat, "Packed Git object"),
      objectType: match[2]! as "blob" | "tree",
      byteLength,
    });
  });
  inventory.sort((left, right) => compareCodePoints(left.objectId, right.objectId));
  for (let index = 1; index < inventory.length; index += 1) {
    if (inventory[index - 1]!.objectId === inventory[index]!.objectId) {
      invalid("Candidate Revision Carrier pack repeats one object identity");
    }
  }
  return Object.freeze(inventory);
}

export async function withVerifiedCandidateRevisionCarrierRepository<T>(input: Readonly<{
  artifactPath: string;
  manifest: FoundationCandidateRevisionCarrierManifestV1;
  verificationParent: string;
  limits: FoundationCandidateRevisionCarrierLimitsV1;
  operation: (
    repository: string,
    closure: FoundationCandidateRevisionCarrierClosureV1,
  ) => Promise<T>;
}>): Promise<T> {
  const verificationParent = resolve(input.verificationParent);
  let physicalParent: string;
  let parentState: Awaited<ReturnType<typeof lstat>>;
  try {
    [physicalParent, parentState] = await Promise.all([
      realpath(verificationParent),
      lstat(verificationParent),
    ]);
  } catch (error) {
    invalid("Candidate Revision Carrier verification parent is unavailable", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  const effectiveUid = process.geteuid?.() ?? process.getuid?.();
  if (
    physicalParent !== verificationParent ||
    parentState.isSymbolicLink() ||
    !parentState.isDirectory() ||
    (parentState.mode & 0o7777) !== 0o700 ||
    (effectiveUid !== undefined && parentState.uid !== effectiveUid)
  ) {
    invalid("Candidate Revision Carrier verification parent is not one exact private directory");
  }
  const scratch = await mkdtemp(join(input.verificationParent, "carrier-open-"));
  await chmod(scratch, 0o700);
  try {
    const repository = join(scratch, "repository.git");
    await mkdir(repository, { mode: 0o700 });
    await git(repository, ["init", "--bare", `--object-format=${input.manifest.objectFormat}`, "."], {
      timeoutMs: input.limits.commandTimeoutMs,
    });
    const packDirectory = join(repository, "objects", "pack");
    const copiedPack = join(packDirectory, "carrier.pack");
    const facts = await readCandidateRevisionCarrierArtifact({
      artifactPath: input.artifactPath,
      maximumBytes: input.limits.maximumCarrierArtifactBytes,
      copyPath: copiedPack,
    });
    if (
      facts.byteLength !== input.manifest.carrierArtifact.byteLength ||
      facts.digest !== input.manifest.carrierArtifact.digest
    ) {
      invalid("Candidate Revision Carrier artifact bytes do not match their manifest", {
        declared: input.manifest.carrierArtifact,
        observed: facts,
      });
    }
    const header = await packHeader(copiedPack);
    if (header.version !== 2 || header.objectCount !== input.manifest.objectCount) {
      invalid("Candidate Revision Carrier artifact header does not match its manifest", {
        declaredObjectCount: input.manifest.objectCount,
        observedObjectCount: header.objectCount,
        packVersion: header.version,
      });
    }
    const indexed = await git(repository, [
      "-c",
      "pack.writeReverseIndex=false",
      "index-pack",
      "--strict",
      "--index-version=2",
      copiedPack,
    ], {
      allowFailure: true,
      maxStdoutBytes: 1024,
      timeoutMs: input.limits.commandTimeoutMs,
    });
    if (indexed.exitCode !== 0 || indexed.stdoutTruncated || indexed.timedOut) {
      invalid("Candidate Revision Carrier artifact failed independent Git pack validation", {
        exitCode: indexed.exitCode,
        timedOut: indexed.timedOut ?? false,
        truncated: indexed.stdoutTruncated ?? false,
      });
    }
    const packEntries = (await readdir(packDirectory)).sort();
    if (packEntries.length !== 2 || packEntries[0] !== "carrier.idx" || packEntries[1] !== "carrier.pack") {
      invalid("Candidate Revision Carrier verification produced an ambiguous pack inventory", {
        entries: packEntries,
      });
    }
    const packedInventory = await allPackedObjects(
      repository,
      input.manifest.objectFormat,
      input.limits,
    );
    if (!sameInventory(packedInventory, input.manifest.objectInventory)) {
      invalid("Candidate Revision Carrier artifact does not contain exactly its declared object inventory");
    }
    const closure = await inspectCandidateRevisionCarrierClosure({
      repository,
      rootTree: input.manifest.rootTree,
      expectedObjectFormat: input.manifest.objectFormat,
      limits: input.limits,
    });
    if (!sameInventory(closure.objectInventory, input.manifest.objectInventory)) {
      invalid("Candidate Revision Carrier artifact inventory is not the exact root-tree closure");
    }
    return await input.operation(repository, closure);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export async function verifyCandidateRevisionCarrierArtifact(input: Readonly<{
  artifactPath: string;
  manifest: FoundationCandidateRevisionCarrierManifestV1;
  verificationParent: string;
  limits: FoundationCandidateRevisionCarrierLimitsV1;
}>): Promise<FoundationCandidateRevisionCarrierClosureV1> {
  return await withVerifiedCandidateRevisionCarrierRepository({
    ...input,
    operation: async (_repository, closure) => closure,
  });
}
