import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  realpath,
  readdir,
  rm,
  unlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { LifecycleError } from "../../errors.js";
import { throwIfProcessCancellationRequested } from "../../util/process.js";
import { FoundationError } from "../error.js";
import {
  git,
  resolveGitObjectFormat,
} from "../repository/git.js";
import type { FoundationGitObjectFormat } from "../repository/types.js";
import type { Sha256 } from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import {
  openCandidateRevisionCarrier,
  prepareCandidateRevisionCarrier,
  publishCandidateRevisionCarrier,
} from "./carrier-store.js";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
  type FoundationCandidateRevisionCarrierLimitsV1,
} from "./carrier-types.js";
import { inspectCandidateRevisionCarrierClosure } from "./git-object-closure.js";

const COMPILATION_OWNER_DIRECTORY = "candidate-revision-carrier-compilation";
const COMPILATION_OWNER_VERSION = "v1";
const COMPILATION_ROOT_PREFIX = "compile-";
const SOURCE_FILE = "retained-artifact";
const INDEX_INPUT_BATCH_BYTES = 1024 * 1024;
const INVALID = "lifecycle.candidate.output-carrier-invalid";
const UNAVAILABLE = "lifecycle.candidate.output-carrier-unavailable";
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

type PhysicalIdentity = Readonly<{
  device: bigint;
  inode: bigint;
}>;

type ExactDirectory = Readonly<{
  path: string;
  identity: PhysicalIdentity;
}>;

/** Candidate-owned structural view implemented by validated Candidate output. */
export type FoundationCandidateOutputCompleteTreeEntryV1 = Readonly<{
  candidateRepositoryPath: string;
  candidateGitMode: "100644" | "100755";
  byteLength: number;
  digest: Sha256;
  read(): AsyncIterable<Uint8Array>;
}>;

/** Closed complete tree. It is never applied as a delta over a predecessor. */
export type FoundationCandidateOutputCompleteTreeV1 = Readonly<{
  declaredRootPath: string;
  entries: readonly FoundationCandidateOutputCompleteTreeEntryV1[];
}>;

export type FoundationPublishedCandidateOutputCarrierV1 = Readonly<{
  objectFormat: FoundationGitObjectFormat;
  rootTree: string;
  manifestBytes: Uint8Array;
  manifestDigest: Sha256;
  objectInventoryDigest: Sha256;
  carrierArtifactDigest: Sha256;
}>;

type SnapshottedEntry = FoundationCandidateOutputCompleteTreeEntryV1;

type CompiledEntry = Readonly<{
  path: string;
  mode: "100644" | "100755";
  byteLength: number;
  objectId: string;
}>;

type CandidateOutputCarrierCompilationInput = Readonly<{
  machineHome: string;
  objectFormat: FoundationGitObjectFormat;
  candidateOutput: FoundationCandidateOutputCompleteTreeV1;
  limits?: FoundationCandidateRevisionCarrierLimitsV1;
}>;

type CandidateOutputCarrierCompilationDependencies = Readonly<{
  gitCommand: typeof git;
  resolveObjectFormat: typeof resolveGitObjectFormat;
  inspectClosure: typeof inspectCandidateRevisionCarrierClosure;
  prepareCarrier: typeof prepareCandidateRevisionCarrier;
  publishCarrier: typeof publishCandidateRevisionCarrier;
  openCarrier: typeof openCandidateRevisionCarrier;
}>;

const INSTALLED_COMPILATION_DEPENDENCIES: CandidateOutputCarrierCompilationDependencies =
Object.freeze({
  gitCommand: git,
  resolveObjectFormat: resolveGitObjectFormat,
  inspectClosure: inspectCandidateRevisionCarrierClosure,
  prepareCarrier: prepareCandidateRevisionCarrier,
  publishCarrier: publishCandidateRevisionCarrier,
  openCarrier: openCandidateRevisionCarrier,
});

class CandidateOutputInvalidError extends FoundationError {
  constructor(message: string, observedFacts?: Readonly<Record<string, unknown>>) {
    super(INVALID, message, { observedFacts });
  }
}

function invalid(
  message: string,
  observedFacts?: Readonly<Record<string, unknown>>,
): never {
  throw new CandidateOutputInvalidError(message, observedFacts);
}

function failureClass(error: unknown): "filesystem" | "foundation" | "interrupted" | "runtime" {
  if (error instanceof LifecycleError && [
    "command.interrupted",
    "runtime.interrupted",
  ].includes(error.code)) return "interrupted";
  if (error instanceof FoundationError) return "foundation";
  const code = error instanceof Error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
  return typeof code === "string" && /^[A-Z0-9_]+$/u.test(code)
    ? "filesystem"
    : "runtime";
}

function sanitizePrivateFailure(error: unknown): never {
  if (error instanceof CandidateOutputInvalidError) throw error;
  const selectedClass = failureClass(error);
  throw new FoundationError(
    UNAVAILABLE,
    selectedClass === "interrupted"
      ? "Candidate output Carrier compilation was interrupted"
      : "Candidate output Carrier compilation could not be completed",
    {
      retryable: selectedClass === "interrupted",
      observedFacts: { failureClass: selectedClass },
    },
  );
}

function identity(state: BigIntStats): PhysicalIdentity {
  return Object.freeze({
    device: state.dev,
    inode: state.ino,
  });
}

function sameIdentity(
  state: BigIntStats,
  expected: PhysicalIdentity,
): boolean {
  return state.dev === expected.device && state.ino === expected.inode;
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function exactDirectory(
  path: string,
  expectedMode?: number,
): Promise<ExactDirectory> {
  const selected = resolve(path);
  const [physical, state] = await Promise.all([
    realpath(selected),
    lstat(selected, { bigint: true }),
  ]);
  const effectiveUid = process.geteuid?.() ?? process.getuid?.();
  if (
    physical !== selected ||
    state.isSymbolicLink() ||
    !state.isDirectory() ||
    (expectedMode !== undefined && Number(state.mode & 0o7777n) !== expectedMode) ||
    (effectiveUid !== undefined && state.uid !== BigInt(effectiveUid))
  ) {
    throw new Error("Candidate output compiler directory is not one exact private directory");
  }
  return Object.freeze({ path: selected, identity: identity(state) });
}

async function ensurePrivateDirectory(
  path: string,
  parent: string,
): Promise<ExactDirectory> {
  let created = false;
  try {
    await mkdir(path, { mode: 0o700 });
    created = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  if (created) {
    await chmod(path, 0o700);
    await syncDirectory(parent);
  }
  return await exactDirectory(path, 0o700);
}

async function assertExactDirectory(
  directory: ExactDirectory,
  expectedMode = 0o700,
): Promise<void> {
  const [physical, state] = await Promise.all([
    realpath(directory.path),
    lstat(directory.path, { bigint: true }),
  ]);
  const effectiveUid = process.geteuid?.() ?? process.getuid?.();
  if (
    physical !== directory.path ||
    state.isSymbolicLink() ||
    !state.isDirectory() ||
    Number(state.mode & 0o7777n) !== expectedMode ||
    (effectiveUid !== undefined && state.uid !== BigInt(effectiveUid)) ||
    !sameIdentity(state, directory.identity)
  ) {
    throw new Error("Candidate output compiler directory identity changed");
  }
}

async function createCompilationRoot(machineHome: string): Promise<Readonly<{
  parent: ExactDirectory;
  root: ExactDirectory;
}>> {
  const home = await exactDirectory(machineHome);
  const owner = await ensurePrivateDirectory(
    join(home.path, COMPILATION_OWNER_DIRECTORY),
    home.path,
  );
  await assertExactDirectory(owner);
  const parent = await ensurePrivateDirectory(
    join(owner.path, COMPILATION_OWNER_VERSION),
    owner.path,
  );
  await assertExactDirectory(parent);
  const rootPath = await mkdtemp(join(parent.path, COMPILATION_ROOT_PREFIX));
  await chmod(rootPath, 0o700);
  await syncDirectory(parent.path);
  const root = await exactDirectory(rootPath, 0o700);
  await assertExactDirectory(parent);
  if ((await readdir(root.path)).length !== 0) {
    throw new Error("Candidate output compiler root was not created empty");
  }
  return Object.freeze({ parent, root });
}

async function removeCompilationRoot(custody: Readonly<{
  parent: ExactDirectory;
  root: ExactDirectory;
}>): Promise<void> {
  await assertExactDirectory(custody.parent);
  await assertExactDirectory(custody.root);
  await rm(custody.root.path, { recursive: true, force: false });
  try {
    await lstat(custody.root.path);
    throw new Error("Candidate output compiler root remained after removal");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await syncDirectory(custody.parent.path);
}

function selectedLimits(
  limits?: FoundationCandidateRevisionCarrierLimitsV1,
): FoundationCandidateRevisionCarrierLimitsV1 {
  return limits ?? FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1;
}

function operationalObjectId(
  value: string,
  objectFormat: FoundationGitObjectFormat,
  label: string,
): string {
  const length = objectFormat === "sha1" ? 40 : 64;
  if (!new RegExp(`^[a-f0-9]{${length}}$`, "u").test(value)) {
    throw new Error(`${label} is not one exact ${objectFormat} Git object identity`);
  }
  return value;
}

function validateRepositoryPath(
  path: string,
  limits: FoundationCandidateRevisionCarrierLimitsV1,
): readonly string[] {
  const segments = path.split("/");
  if (
    path.length === 0 ||
    path.normalize("NFC") !== path ||
    Buffer.byteLength(path, "utf8") > limits.maximumRepositoryPathBytes ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("?") ||
    path.includes("#") ||
    /%2f|%5c/iu.test(path) ||
    /[\u0000-\u001f\u007f]/u.test(path) ||
    segments.some((segment) =>
      segment.length === 0 ||
      segment === "." ||
      segment === ".." ||
      segment.toLowerCase() === ".git") ||
    segments.length - 1 > limits.maximumTreeDepth
  ) {
    invalid("Candidate output contains an invalid repository path");
  }
  return Object.freeze(segments);
}

function snapshotCandidateOutput(
  candidateOutput: FoundationCandidateOutputCompleteTreeV1,
  limits: FoundationCandidateRevisionCarrierLimitsV1,
): readonly SnapshottedEntry[] {
  if (
    candidateOutput === null ||
    typeof candidateOutput !== "object" ||
    typeof candidateOutput.declaredRootPath !== "string" ||
    !Array.isArray(candidateOutput.entries)
  ) {
    invalid("Candidate output is not one validated complete tree");
  }
  if (
    candidateOutput.entries.length < 1 ||
    candidateOutput.entries.length > limits.maximumTreeEntries
  ) {
    invalid("Candidate output file inventory is outside its exact bound");
  }

  const paths = new Set<string>();
  const aliases = new Set<string>();
  let aggregateBytes = 0;
  let priorPath: string | null = null;
  const entries = candidateOutput.entries.map((raw, index) => {
    let path: string;
    let mode: "100644" | "100755";
    let byteLength: number;
    let digest: Sha256;
    let read: () => AsyncIterable<Uint8Array>;
    try {
      path = raw.candidateRepositoryPath;
      mode = raw.candidateGitMode;
      byteLength = raw.byteLength;
      digest = raw.digest;
      read = raw.read;
    } catch {
      invalid("Candidate output entry metadata could not be observed exactly once");
    }
    if (typeof path !== "string") invalid("Candidate output entry path is invalid");
    validateRepositoryPath(path, limits);
    if (mode !== "100644" && mode !== "100755") {
      invalid("Candidate output entry mode is not one supported Git file mode");
    }
    if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
      invalid("Candidate output entry byte length is not one safe nonnegative integer");
    }
    if (typeof digest !== "string" || !SHA256.test(digest)) {
      invalid("Candidate output entry digest is not one lowercase SHA-256 digest");
    }
    if (typeof read !== "function") {
      invalid("Candidate output entry does not expose one retained byte reader");
    }
    if (index > 0 && priorPath !== null && compareCodePoints(priorPath, path) >= 0) {
      invalid("Candidate output entries are not strictly repository-path ordered");
    }
    priorPath = path;
    const alias = path.normalize("NFC").toLowerCase();
    if (paths.has(path) || aliases.has(alias)) {
      invalid("Candidate output contains one duplicate or aliased repository path");
    }
    paths.add(path);
    aliases.add(alias);
    aggregateBytes += byteLength;
    if (!Number.isSafeInteger(aggregateBytes) ||
        aggregateBytes > limits.maximumAggregateObjectBytes) {
      invalid("Candidate output aggregate file bytes exceed their exact bound");
    }
    return Object.freeze({
      candidateRepositoryPath: path,
      candidateGitMode: mode,
      byteLength,
      digest,
      read: read.bind(raw),
    });
  });

  for (const path of paths) {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      if (paths.has(segments.slice(0, index).join("/"))) {
        invalid("Candidate output inventories one file as another file's directory");
      }
    }
  }
  return Object.freeze(entries);
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  bytes: Buffer,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(
      bytes,
      offset,
      bytes.byteLength - offset,
      null,
    );
    if (result.bytesWritten < 1) {
      throw new Error("Candidate output compiler file write made no progress");
    }
    offset += result.bytesWritten;
  }
}

async function writeRetainedArtifact(input: Readonly<{
  root: ExactDirectory;
  entry: SnapshottedEntry;
  objectFormat: FoundationGitObjectFormat;
}>): Promise<Readonly<{
  path: string;
  identity: PhysicalIdentity;
  objectId: string;
}>> {
  await assertExactDirectory(input.root);
  const path = join(input.root.path, SOURCE_FILE);
  const handle = await open(
    path,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_WRONLY |
      (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  let fileIdentity: PhysicalIdentity;
  try {
    const initial = await handle.stat({ bigint: true });
    fileIdentity = identity(initial);
    const contentHash = createHash("sha256");
    const objectHash = createHash(input.objectFormat);
    objectHash.update(Buffer.from(`blob ${input.entry.byteLength}\0`, "utf8"));
    let observedBytes = 0;
    let bytes: AsyncIterable<Uint8Array>;
    try {
      bytes = input.entry.read();
    } catch {
      throw new Error("Candidate output retained artifact could not be reopened");
    }
    if (bytes === null || typeof bytes !== "object" ||
        typeof bytes[Symbol.asyncIterator] !== "function") {
      invalid("Candidate output retained artifact is not one asynchronous byte stream");
    }
    for await (const rawChunk of bytes) {
      throwIfProcessCancellationRequested();
      if (!(rawChunk instanceof Uint8Array) || rawChunk.byteLength === 0) {
        invalid("Candidate output retained artifact yielded one invalid byte chunk");
      }
      const nextBytes = observedBytes + rawChunk.byteLength;
      if (!Number.isSafeInteger(nextBytes) || nextBytes > input.entry.byteLength) {
        invalid("Candidate output retained artifact exceeds its declared byte length");
      }
      const chunk = Buffer.from(rawChunk);
      await writeAll(handle, chunk);
      contentHash.update(chunk);
      objectHash.update(chunk);
      observedBytes = nextBytes;
    }
    throwIfProcessCancellationRequested();
    if (observedBytes !== input.entry.byteLength) {
      invalid("Candidate output retained artifact is shorter than its declared byte length");
    }
    const digest = `sha256:${contentHash.digest("hex")}` as Sha256;
    if (digest !== input.entry.digest) {
      invalid("Candidate output retained artifact bytes differ from their validated digest");
    }
    await handle.chmod(0o600);
    await handle.sync();
    const final = await handle.stat({ bigint: true });
    const effectiveUid = process.geteuid?.() ?? process.getuid?.();
    if (
      !final.isFile() ||
      final.isSymbolicLink() ||
      final.nlink !== 1n ||
      final.size !== BigInt(input.entry.byteLength) ||
      Number(final.mode & 0o7777n) !== 0o600 ||
      (effectiveUid !== undefined && final.uid !== BigInt(effectiveUid)) ||
      !sameIdentity(final, fileIdentity)
    ) {
      throw new Error("Candidate output compiler file identity changed while streaming");
    }
    return Object.freeze({
      path,
      identity: fileIdentity,
      objectId: objectHash.digest("hex"),
    });
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function assertExactSourceFile(input: Readonly<{
  path: string;
  identity: PhysicalIdentity;
  byteLength: number;
}>): Promise<void> {
  const [physical, state] = await Promise.all([
    realpath(input.path),
    lstat(input.path, { bigint: true }),
  ]);
  const effectiveUid = process.geteuid?.() ?? process.getuid?.();
  if (
    physical !== input.path ||
    state.isSymbolicLink() ||
    !state.isFile() ||
    state.nlink !== 1n ||
    state.size !== BigInt(input.byteLength) ||
    Number(state.mode & 0o7777n) !== 0o600 ||
    (effectiveUid !== undefined && state.uid !== BigInt(effectiveUid)) ||
    !sameIdentity(state, input.identity)
  ) {
    throw new Error("Candidate output compiler source file identity changed");
  }
}

async function removeExactSourceFile(input: Readonly<{
  path: string;
  identity: PhysicalIdentity;
  byteLength: number;
}>): Promise<void> {
  await assertExactSourceFile(input);
  await unlink(input.path);
  try {
    await lstat(input.path);
    throw new Error("Candidate output compiler source file remained after removal");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function writeGitBlob(input: Readonly<{
  repository: string;
  root: ExactDirectory;
  entry: SnapshottedEntry;
  objectFormat: FoundationGitObjectFormat;
  timeoutMs: number;
  gitCommand: typeof git;
}>): Promise<CompiledEntry> {
  const source = await writeRetainedArtifact({
    root: input.root,
    entry: input.entry,
    objectFormat: input.objectFormat,
  });
  try {
    await assertExactSourceFile({
      path: source.path,
      identity: source.identity,
      byteLength: input.entry.byteLength,
    });
    const written = await input.gitCommand(input.repository, [
      "hash-object",
      "-w",
      "--no-filters",
      "--",
      source.path,
    ], {
      allowFailure: true,
      maxStdoutBytes: 128,
      maxStderrBytes: 4 * 1024,
      timeoutMs: input.timeoutMs,
    });
    const objectId = written.stdout.trim();
    if (
      written.exitCode !== 0 ||
      written.stdoutTruncated ||
      written.stderrTruncated ||
      written.timedOut ||
      operationalObjectId(objectId, input.objectFormat, "Compiled Candidate blob") !== source.objectId
    ) {
      throw new Error("Git did not retain the exact Candidate output blob");
    }
    const [type, size] = await Promise.all([
      input.gitCommand(input.repository, ["cat-file", "-t", objectId], {
        allowFailure: true,
        maxStdoutBytes: 32,
        maxStderrBytes: 4 * 1024,
        timeoutMs: input.timeoutMs,
      }),
      input.gitCommand(input.repository, ["cat-file", "-s", objectId], {
        allowFailure: true,
        maxStdoutBytes: 64,
        maxStderrBytes: 4 * 1024,
        timeoutMs: input.timeoutMs,
      }),
    ]);
    if (
      type.exitCode !== 0 ||
      type.stdout.trim() !== "blob" ||
      type.stdoutTruncated ||
      type.stderrTruncated ||
      type.timedOut ||
      size.exitCode !== 0 ||
      size.stdout.trim() !== String(input.entry.byteLength) ||
      size.stdoutTruncated ||
      size.stderrTruncated ||
      size.timedOut
    ) {
      throw new Error("Compiled Candidate output blob could not be independently reopened");
    }
    return Object.freeze({
      path: input.entry.candidateRepositoryPath,
      mode: input.entry.candidateGitMode,
      byteLength: input.entry.byteLength,
      objectId,
    });
  } finally {
    await removeExactSourceFile({
      path: source.path,
      identity: source.identity,
      byteLength: input.entry.byteLength,
    });
  }
}

async function populateGitIndex(input: Readonly<{
  repository: string;
  entries: readonly CompiledEntry[];
  timeoutMs: number;
  gitCommand: typeof git;
}>): Promise<void> {
  let batch = "";
  let batchBytes = 0;
  const flush = async (): Promise<void> => {
    if (batchBytes === 0) return;
    const result = await input.gitCommand(input.repository, ["update-index", "-z", "--index-info"], {
      allowFailure: true,
      input: batch,
      maxStdoutBytes: 32,
      maxStderrBytes: 4 * 1024,
      timeoutMs: input.timeoutMs,
    });
    if (
      result.exitCode !== 0 ||
      result.stdout.length !== 0 ||
      result.stdoutTruncated ||
      result.stderrTruncated ||
      result.timedOut
    ) {
      throw new Error("Git could not retain the exact Candidate output inventory");
    }
    batch = "";
    batchBytes = 0;
  };
  for (const entry of input.entries) {
    const record = `${entry.mode} ${entry.objectId}\t${entry.path}\0`;
    const recordBytes = Buffer.byteLength(record, "utf8");
    if (batchBytes > 0 && batchBytes + recordBytes > INDEX_INPUT_BATCH_BYTES) {
      await flush();
    }
    batch += record;
    batchBytes += recordBytes;
  }
  await flush();
}

async function compileRootTree(input: Readonly<{
  repository: string;
  objectFormat: FoundationGitObjectFormat;
  entries: readonly SnapshottedEntry[];
  root: ExactDirectory;
  limits: FoundationCandidateRevisionCarrierLimitsV1;
  dependencies: CandidateOutputCarrierCompilationDependencies;
}>): Promise<Readonly<{
  rootTree: string;
  compiledEntries: readonly CompiledEntry[];
}>> {
  await input.dependencies.gitCommand(input.repository, [
    "init",
    "-b",
    "candidate-output",
    `--object-format=${input.objectFormat}`,
    ".",
  ], {
    maxStdoutBytes: 4 * 1024,
    maxStderrBytes: 4 * 1024,
    timeoutMs: input.limits.commandTimeoutMs,
  });
  if (await input.dependencies.resolveObjectFormat(input.repository) !== input.objectFormat) {
    throw new Error("Candidate output compiler Git object format differs from its selection");
  }
  const compiledEntries: CompiledEntry[] = [];
  for (const entry of input.entries) {
    throwIfProcessCancellationRequested();
    compiledEntries.push(await writeGitBlob({
      repository: input.repository,
      root: input.root,
      entry,
      objectFormat: input.objectFormat,
      timeoutMs: input.limits.commandTimeoutMs,
      gitCommand: input.dependencies.gitCommand,
    }));
  }
  await populateGitIndex({
    repository: input.repository,
    entries: compiledEntries,
    timeoutMs: input.limits.commandTimeoutMs,
    gitCommand: input.dependencies.gitCommand,
  });
  const tree = await input.dependencies.gitCommand(input.repository, ["write-tree"], {
    allowFailure: true,
    maxStdoutBytes: 128,
    maxStderrBytes: 4 * 1024,
    timeoutMs: input.limits.commandTimeoutMs,
  });
  if (
    tree.exitCode !== 0 ||
    tree.stdoutTruncated ||
    tree.stderrTruncated ||
    tree.timedOut
  ) {
    throw new Error("Git could not compile the exact Candidate output tree");
  }
  return Object.freeze({
    rootTree: operationalObjectId(
      tree.stdout.trim(),
      input.objectFormat,
      "Candidate output root tree",
    ),
    compiledEntries: Object.freeze(compiledEntries),
  });
}

function assertCompiledClosure(input: Readonly<{
  compiledEntries: readonly CompiledEntry[];
  closureEntries: readonly Readonly<{
    path: string;
    mode: "100644" | "100755";
    byteLength: number;
    objectId: string;
  }>[];
}>): void {
  if (input.compiledEntries.length !== input.closureEntries.length) {
    throw new Error("Compiled Candidate tree differs from its complete output inventory");
  }
  for (let index = 0; index < input.compiledEntries.length; index += 1) {
    const compiled = input.compiledEntries[index]!;
    const reopened = input.closureEntries[index]!;
    if (
      compiled.path !== reopened.path ||
      compiled.mode !== reopened.mode ||
      compiled.byteLength !== reopened.byteLength ||
      compiled.objectId !== reopened.objectId
    ) {
      throw new Error("Compiled Candidate tree substituted one output entry");
    }
  }
}

async function compileAndPublish(input: Readonly<{
  machineHome: string;
  objectFormat: FoundationGitObjectFormat;
  entries: readonly SnapshottedEntry[];
  custody: Readonly<{ parent: ExactDirectory; root: ExactDirectory }>;
  limits: FoundationCandidateRevisionCarrierLimitsV1;
  dependencies: CandidateOutputCarrierCompilationDependencies;
}>): Promise<FoundationPublishedCandidateOutputCarrierV1> {
  const compiled = await compileRootTree({
    repository: input.custody.root.path,
    objectFormat: input.objectFormat,
    entries: input.entries,
    root: input.custody.root,
    limits: input.limits,
    dependencies: input.dependencies,
  });
  const closure = await input.dependencies.inspectClosure({
    repository: input.custody.root.path,
    rootTree: compiled.rootTree,
    expectedObjectFormat: input.objectFormat,
    limits: input.limits,
  });
  assertCompiledClosure({
    compiledEntries: compiled.compiledEntries,
    closureEntries: closure.treeEntries,
  });
  const prepared = await input.dependencies.prepareCarrier({
    machineHome: input.machineHome,
    repository: input.custody.root.path,
    rootTree: compiled.rootTree,
    limits: input.limits,
  });
  const published = await input.dependencies.publishCarrier({
    machineHome: input.machineHome,
    prepared,
    limits: input.limits,
  });
  const reopened = await input.dependencies.openCarrier({
    machineHome: input.machineHome,
    manifestBytes: published.manifestBytes,
    limits: input.limits,
  });
  if (
    reopened.manifest.rootTree !== compiled.rootTree ||
    reopened.manifest.objectFormat !== input.objectFormat ||
    reopened.manifest.digest !== published.manifest.digest ||
    !Buffer.from(reopened.manifestBytes).equals(Buffer.from(published.manifestBytes))
  ) {
    throw new Error("Published Candidate Revision Carrier did not independently reopen exactly");
  }
  return Object.freeze({
    objectFormat: input.objectFormat,
    rootTree: reopened.manifest.rootTree,
    manifestBytes: Uint8Array.from(reopened.manifestBytes),
    manifestDigest: reopened.manifest.digest,
    objectInventoryDigest: reopened.manifest.objectInventoryDigest,
    carrierArtifactDigest: reopened.manifest.carrierArtifact.digest,
  });
}

/**
 * Compile one independently validated complete Candidate output into a durable
 * Carrier. The private compiler repository has no Candidate or Process standing.
 */
async function compileCandidateRevisionCarrierFromCandidateOutput(
  input: CandidateOutputCarrierCompilationInput,
  dependencies: CandidateOutputCarrierCompilationDependencies,
): Promise<FoundationPublishedCandidateOutputCarrierV1> {
  let custody: Readonly<{ parent: ExactDirectory; root: ExactDirectory }> | null = null;
  let output: FoundationPublishedCandidateOutputCarrierV1 | null = null;
  let failure: unknown = null;
  try {
    throwIfProcessCancellationRequested();
    if (input.objectFormat !== "sha1" && input.objectFormat !== "sha256") {
      invalid("Candidate output selects an unsupported Git object format");
    }
    const limits = selectedLimits(input.limits);
    const entries = snapshotCandidateOutput(input.candidateOutput, limits);
    custody = await createCompilationRoot(input.machineHome);
    output = await compileAndPublish({
      machineHome: input.machineHome,
      objectFormat: input.objectFormat,
      entries,
      custody,
      limits,
      dependencies,
    });
  } catch (error) {
    failure = error;
  }

  if (custody !== null) {
    try {
      await removeCompilationRoot(custody);
    } catch (error) {
      sanitizePrivateFailure(error);
    }
  }
  if (failure !== null) sanitizePrivateFailure(failure);
  if (output === null) {
    sanitizePrivateFailure(new Error("Candidate output compiler returned no stable result"));
  }
  return output;
}

export async function publishCandidateRevisionCarrierFromCandidateOutput(
  input: CandidateOutputCarrierCompilationInput,
): Promise<FoundationPublishedCandidateOutputCarrierV1> {
  return await compileCandidateRevisionCarrierFromCandidateOutput(
    input,
    INSTALLED_COMPILATION_DEPENDENCIES,
  );
}

/** @internal Focused dependency seam for Candidate compiler failure classification. */
export function createCandidateOutputCarrierPublisherForTesting(
  overrides: Partial<CandidateOutputCarrierCompilationDependencies>,
): (
  input: CandidateOutputCarrierCompilationInput,
) => Promise<FoundationPublishedCandidateOutputCarrierV1> {
  const dependencies = Object.freeze({
    ...INSTALLED_COMPILATION_DEPENDENCIES,
    ...overrides,
  });
  return async (input) => await compileCandidateRevisionCarrierFromCandidateOutput(
    input,
    dependencies,
  );
}
