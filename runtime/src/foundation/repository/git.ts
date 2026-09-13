import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { TextDecoder } from "node:util";
import { FoundationError } from "../error.js";
import { runCommand, runCommandBytes, type CommandBytesResult, type CommandResult } from "../../util/process.js";
import type { FoundationGitObjectFormat, FoundationGitTreeEntry, FoundationRepositoryEpoch } from "./types.js";

const GIT = "/usr/bin/git";
const BASE = [
  "-c", "core.hooksPath=/dev/null",
  "-c", "core.fsmonitor=false",
  "-c", "core.attributesFile=/dev/null",
  "-c", "core.pager=",
] as const;
const MAXIMUM_TREE_INVENTORY_BYTES = 256 * 1024 * 1024;
const MAXIMUM_TREE_ENTRIES = 1_000_000;
const MAXIMUM_REPOSITORY_PATH_BYTES = 4096;
// Preserve a leading BOM as U+FEFF. Path identity is exact, and strict JSON
// must see (and reject) a BOM rather than having the decoder erase it.
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function compareCodePoints(left: string, right: string): number {
  const leftPoints = [...left];
  const rightPoints = [...right];
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const leftPoint = leftPoints[index]!.codePointAt(0)!;
    const rightPoint = rightPoints[index]!.codePointAt(0)!;
    if (leftPoint !== rightPoint) return leftPoint - rightPoint;
  }
  return leftPoints.length - rightPoints.length;
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return UTF8.decode(bytes);
  } catch (error) {
    throw new FoundationError("lifecycle.path.invalid", `${label} is not valid UTF-8`, {
      observedFacts: { cause: error instanceof Error ? error.message : String(error) },
    });
  }
}

function validateRepositoryPath(path: string, byteLength: number): void {
  if (
    byteLength === 0 ||
    byteLength > MAXIMUM_REPOSITORY_PATH_BYTES ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("?") ||
    path.includes("#") ||
    /%2f|%5c/u.test(path.toLowerCase()) ||
    path.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
  ) {
    throw new FoundationError("lifecycle.path.invalid", `Git tree contains an invalid repository path: ${path}`, {
      observedFacts: { byteLength, path },
    });
  }
}

function parseObjectFormat(value: string): FoundationGitObjectFormat {
  const format = value.trim();
  if (format !== "sha1" && format !== "sha256") {
    throw new FoundationError("lifecycle.repository.object-format", `Unsupported Git object format ${format || "<empty>"}`);
  }
  return format;
}

function parseObjectId(value: string, format: FoundationGitObjectFormat, label: string): string {
  const length = format === "sha1" ? 40 : 64;
  if (!new RegExp(`^[a-f0-9]{${length}}$`, "u").test(value)) {
    throw new FoundationError("lifecycle.repository.object-id", `${label} is not one ${format} object identity`, {
      observedFacts: { value },
    });
  }
  return value;
}

function parseNulPaths(bytes: Buffer, label: string, maximumBytes = 128 * 1024 * 1024): readonly string[] {
  if (bytes.byteLength > maximumBytes) {
    throw new FoundationError("lifecycle.repository.inventory-bound", `${label} exceeds its byte bound`);
  }
  if (bytes.byteLength === 0) return Object.freeze([]);
  if (bytes.at(-1) !== 0) {
    throw new FoundationError("lifecycle.repository.inventory", `${label} is not terminated by NUL`);
  }
  const paths: string[] = [];
  let offset = 0;
  while (offset < bytes.byteLength) {
    const end = bytes.indexOf(0, offset);
    if (end <= offset) throw new FoundationError("lifecycle.repository.inventory", `${label} contains an empty or unterminated entry`);
    const pathBytes = bytes.subarray(offset, end);
    const path = decodeUtf8(pathBytes, `${label} path`);
    validateRepositoryPath(path, pathBytes.byteLength);
    paths.push(path);
    if (paths.length > MAXIMUM_TREE_ENTRIES) throw new FoundationError("lifecycle.repository.inventory-bound", `${label} exceeds its entry bound`);
    offset = end + 1;
  }
  return Object.freeze(paths.sort(compareCodePoints));
}

export function foundationGitEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith("GIT_") && !key.startsWith("LIFECYCLE_")) clean[key] = value;
  }
  return {
    ...clean,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_LFS_SKIP_SMUDGE: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    ...extra,
  };
}

export async function git(
  repository: string,
  args: readonly string[],
  options: {
    allowFailure?: boolean;
    timeoutMs?: number;
    maxStdoutBytes?: number;
    maxStderrBytes?: number;
    input?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<CommandResult> {
  return await runCommand(GIT, [...BASE, ...args], {
    cwd: repository,
    env: foundationGitEnvironment(options.env),
    allowFailure: options.allowFailure,
    timeoutMs: options.timeoutMs ?? 30_000,
    maxStdoutBytes: options.maxStdoutBytes ?? 16 * 1024 * 1024,
    maxStderrBytes: options.maxStderrBytes ?? 1024 * 1024,
    input: options.input,
  });
}

export async function gitBytes(
  repository: string,
  args: readonly string[],
  options: {
    allowFailure?: boolean;
    timeoutMs?: number;
    maxStdoutBytes?: number;
    maxStderrBytes?: number;
    input?: string | Buffer;
    env?: NodeJS.ProcessEnv;
  } = {},
): Promise<CommandBytesResult> {
  return await runCommandBytes(GIT, [...BASE, ...args], {
    cwd: repository,
    env: foundationGitEnvironment(options.env),
    allowFailure: options.allowFailure,
    timeoutMs: options.timeoutMs ?? 30_000,
    maxStdoutBytes: options.maxStdoutBytes ?? 64 * 1024 * 1024,
    maxStderrBytes: options.maxStderrBytes ?? 1024 * 1024,
    input: options.input,
  });
}

export async function canonicalRepository(path: string): Promise<string> {
  let root: string;
  try {
    root = (await git(resolve(path), ["rev-parse", "--show-toplevel"])).stdout.trim();
  } catch (error) {
    throw new FoundationError("lifecycle.repository.not-git", "Target must be one attached Git repository", { observedFacts: { path, cause: error instanceof Error ? error.message : String(error) } });
  }
  const physical = await realpath(root);
  const metadata = await stat(physical);
  if (!metadata.isDirectory() || physical !== resolve(root)) {
    throw new FoundationError("lifecycle.repository.physical", "Repository root must be one canonical physical directory");
  }
  return physical;
}

export async function attachedHead(repository: string): Promise<{ commit: string; tree: string; branch: string }> {
  const [commit, tree, branch] = await Promise.all([
    git(repository, ["rev-parse", "HEAD"]),
    git(repository, ["rev-parse", "HEAD^{tree}"]),
    git(repository, ["symbolic-ref", "--quiet", "HEAD"], { allowFailure: true }),
  ]);
  if (branch.exitCode !== 0 || !branch.stdout.trim().startsWith("refs/heads/")) {
    throw new FoundationError("lifecycle.repository.detached", "Lifecycle requires an attached local branch");
  }
  return { commit: commit.stdout.trim(), tree: tree.stdout.trim(), branch: branch.stdout.trim() };
}

export async function resolveGitObjectFormat(repository: string): Promise<FoundationGitObjectFormat> {
  const result = await git(repository, ["rev-parse", "--show-object-format=storage"]);
  return parseObjectFormat(result.stdout);
}

export async function resolveAttachedEpoch(repository: string): Promise<FoundationRepositoryEpoch> {
  const branchResult = await git(repository, ["symbolic-ref", "--quiet", "HEAD"], { allowFailure: true });
  const branch = branchResult.stdout.trim();
  if (branchResult.exitCode !== 0 || !branch.startsWith("refs/heads/")) {
    throw new FoundationError("lifecycle.repository.detached", "Lifecycle requires an attached local branch");
  }
  const objectFormat = await resolveGitObjectFormat(repository);
  const commitResult = await git(repository, ["rev-parse", "--verify", "--end-of-options", `${branch}^{commit}`]);
  const commit = parseObjectId(commitResult.stdout.trim(), objectFormat, `${branch} commit`);
  const treeResult = await git(repository, ["rev-parse", "--verify", "--end-of-options", `${commit}^{tree}`]);
  const tree = parseObjectId(treeResult.stdout.trim(), objectFormat, `${branch} tree`);
  return Object.freeze({ ref: branch, commit, tree, objectFormat });
}

export async function assertRepositoryEpochUnmoved(repository: string, expected: FoundationRepositoryEpoch): Promise<void> {
  let observed: FoundationRepositoryEpoch;
  try {
    observed = await resolveAttachedEpoch(repository);
  } catch (error) {
    throw new FoundationError("lifecycle.repository.epoch-mixed", "Canonical repository epoch could not be re-resolved after observation", {
      observedFacts: { expected, cause: error instanceof Error ? error.message : String(error) },
    });
  }
  if (
    observed.ref !== expected.ref ||
    observed.commit !== expected.commit ||
    observed.tree !== expected.tree ||
    observed.objectFormat !== expected.objectFormat
  ) {
    throw new FoundationError("lifecycle.repository.epoch-mixed", "Canonical repository epoch moved while it was being observed", {
      observedFacts: { expected, observed },
    });
  }
}

export async function assertClean(repository: string): Promise<void> {
  const status = await git(repository, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status.stdout.length > 0) {
    throw new FoundationError("lifecycle.repository.dirty", "Canonical target worktree must be clean", { observedFacts: { status: status.stdout.slice(0, 16_384) } });
  }
}

export async function gitCommonDirectory(repository: string): Promise<string> {
  const result = await git(repository, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return await realpath(result.stdout.trim());
}

export async function trackedFiles(repository: string, commit = "HEAD"): Promise<readonly string[]> {
  return (await trackedEntries(repository, commit)).map((entry) => entry.path);
}

export function parseGitTreeInventory(bytes: Buffer, objectFormat: FoundationGitObjectFormat): readonly FoundationGitTreeEntry[] {
  if (bytes.byteLength > MAXIMUM_TREE_INVENTORY_BYTES) {
    throw new FoundationError("lifecycle.repository.inventory-bound", "Git tree inventory exceeds its byte bound");
  }
  if (bytes.byteLength === 0) return Object.freeze([]);
  if (bytes.at(-1) !== 0) {
    throw new FoundationError("lifecycle.repository.inventory", "Git tree inventory is not terminated by NUL");
  }
  const entries: FoundationGitTreeEntry[] = [];
  let offset = 0;
  while (offset < bytes.byteLength) {
    const end = bytes.indexOf(0, offset);
    if (end <= offset) throw new FoundationError("lifecycle.repository.inventory", "Git tree inventory contains an empty or unterminated entry");
    const line = bytes.subarray(offset, end);
    const tab = line.indexOf(0x09);
    if (tab <= 0 || tab === line.byteLength - 1) {
      throw new FoundationError("lifecycle.repository.inventory", "Git tree inventory contains an invalid entry");
    }
    const headerBytes = line.subarray(0, tab);
    if (headerBytes.some((byte) => byte > 0x7f)) throw new FoundationError("lifecycle.repository.inventory", "Git tree entry header is not ASCII");
    const match = /^(\d{6}) (blob|commit) ([a-f0-9]+)$/u.exec(headerBytes.toString("ascii"));
    if (match === null) throw new FoundationError("lifecycle.repository.inventory", "Git tree inventory contains an invalid header");
    const pathBytes = line.subarray(tab + 1);
    const path = decodeUtf8(pathBytes, "Git tree path");
    validateRepositoryPath(path, pathBytes.byteLength);
    entries.push(Object.freeze({
      mode: match[1]!,
      type: match[2]!,
      objectId: parseObjectId(match[3]!, objectFormat, `Git tree object for ${path}`),
      path,
    }));
    if (entries.length > MAXIMUM_TREE_ENTRIES) throw new FoundationError("lifecycle.repository.inventory-bound", "Git tree inventory exceeds its entry bound");
    offset = end + 1;
  }
  entries.sort((left, right) => compareCodePoints(left.path, right.path));
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1]!.path === entries[index]!.path) throw new FoundationError("lifecycle.repository.inventory", `Git tree repeats path ${entries[index]!.path}`);
  }
  return Object.freeze(entries);
}

export async function exactTreeEntries(repository: string, treeish: string, objectFormat?: FoundationGitObjectFormat): Promise<readonly FoundationGitTreeEntry[]> {
  const format = objectFormat ?? await resolveGitObjectFormat(repository);
  const result = await gitBytes(repository, ["ls-tree", "-r", "-z", "--full-tree", treeish], {
    maxStdoutBytes: MAXIMUM_TREE_INVENTORY_BYTES,
  });
  if (result.stdoutTruncated) throw new FoundationError("lifecycle.repository.inventory-bound", "Git tree inventory exceeds its byte bound");
  return parseGitTreeInventory(result.stdout, format);
}

export async function trackedEntries(repository: string, commit = "HEAD"): Promise<readonly { mode: string; type: string; object: string; path: string }[]> {
  return (await exactTreeEntries(repository, commit)).map((entry) => ({
    mode: entry.mode,
    type: entry.type,
    object: entry.objectId,
    path: entry.path,
  }));
}

export async function worktreePathInventory(repository: string): Promise<Readonly<{
  modified: readonly string[];
  untracked: readonly string[];
  ignored: readonly string[];
}>> {
  const [modifiedResult, untrackedResult, ignoredResult] = await Promise.all([
    gitBytes(repository, ["diff", "HEAD", "--name-only", "-z", "--"], { maxStdoutBytes: 128 * 1024 * 1024 }),
    gitBytes(repository, ["ls-files", "--others", "--exclude-standard", "-z", "--"], { maxStdoutBytes: 128 * 1024 * 1024 }),
    gitBytes(repository, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--"], { maxStdoutBytes: 128 * 1024 * 1024 }),
  ]);
  for (const result of [modifiedResult, untrackedResult, ignoredResult]) {
    if (result.stdoutTruncated) throw new FoundationError("lifecycle.repository.inventory-bound", "Worktree path inventory exceeds its byte bound");
  }
  return Object.freeze({
    modified: parseNulPaths(modifiedResult.stdout, "Modified worktree inventory"),
    untracked: parseNulPaths(untrackedResult.stdout, "Untracked worktree inventory"),
    ignored: parseNulPaths(ignoredResult.stdout, "Ignored worktree inventory"),
  });
}

export async function blobBytes(repository: string, commit: string, path: string, maximumBytes = 4 * 1024 * 1024): Promise<Buffer> {
  const result = await gitBytes(repository, ["show", `${commit}:${path}`], { maxStdoutBytes: maximumBytes + 1, allowFailure: true });
  if (result.stdout.byteLength > maximumBytes || result.stdoutTruncated) {
    throw new FoundationError("lifecycle.repository.blob-bound", `Tracked blob exceeds the ${maximumBytes}-byte bound: ${path}`);
  }
  if (result.exitCode !== 0) throw new FoundationError("lifecycle.repository.blob-missing", `Required tracked blob is unavailable: ${path}`);
  return result.stdout;
}

export async function objectBlobBytes(
  repository: string,
  objectId: string,
  maximumBytes = 4 * 1024 * 1024,
  timeoutMs = 30_000,
): Promise<Buffer> {
  const result = await gitBytes(repository, ["cat-file", "blob", objectId], {
    maxStdoutBytes: maximumBytes + 1,
    allowFailure: true,
    timeoutMs,
  });
  if (result.timedOut) {
    throw new FoundationError("lifecycle.repository.blob-timeout", "Tracked blob read exceeded its time bound");
  }
  if (result.stdout.byteLength > maximumBytes || result.stdoutTruncated) {
    throw new FoundationError("lifecycle.repository.blob-bound", `Tracked blob ${objectId} exceeds the ${maximumBytes}-byte bound`);
  }
  if (result.exitCode !== 0) throw new FoundationError("lifecycle.repository.blob-missing", `Required tracked blob is unavailable: ${objectId}`);
  return result.stdout;
}

export async function exactBlobSizes(
  repository: string,
  objectIds: readonly string[],
  timeoutMs = 30_000,
): Promise<ReadonlyMap<string, number>> {
  const unique = [...new Set(objectIds)].sort();
  if (unique.length === 0) return new Map();
  if (unique.length > MAXIMUM_TREE_ENTRIES) {
    throw new FoundationError("lifecycle.repository.blob-bound", "Exact Git blob inventory exceeds its object-count bound");
  }
  for (const objectId of unique) {
    parseObjectId(objectId, objectId.length === 40 ? "sha1" : "sha256", "Inventoried blob");
  }
  const result = await git(repository, ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], {
    allowFailure: true,
    input: `${unique.join("\n")}\n`,
    maxStdoutBytes: Math.max(1024, unique.length * 160),
    timeoutMs,
  });
  return parseGitBlobSizeResult(result, unique);
}

/** Bind the complete size response to the exact ordered request inventory. */
export function parseGitBlobSizeResult(result: CommandResult, unique: readonly string[]): ReadonlyMap<string, number> {
  if (result.exitCode !== 0 || result.signal !== null || result.timedOut || result.stdoutTruncated || result.stderrTruncated || !result.stdout.endsWith("\n")) {
    throw new FoundationError("lifecycle.projection.content-digest", "Git exact object-size inventory did not complete");
  }
  const lines = result.stdout.slice(0, -1).split("\n");
  if (lines.length !== unique.length) {
    throw new FoundationError("lifecycle.projection.content-digest", "Git returned an incomplete exact object-size inventory");
  }
  const values = new Map<string, number>();
  for (const [index, line] of lines.entries()) {
    const match = /^([a-f0-9]{40}|[a-f0-9]{64}) blob (0|[1-9][0-9]*)$/u.exec(line);
    if (match === null || match[1] !== unique[index]) {
      throw new FoundationError("lifecycle.projection.content-digest", "Projection input names a missing or non-blob Git object", {
        observedFacts: { objectId: unique[index] },
      });
    }
    const size = Number(match[2]);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new FoundationError("lifecycle.projection.content-digest", "Git blob size is not one nonnegative safe integer");
    }
    values.set(match[1]!, size);
  }
  return values;
}

type ExactBlobSize = Readonly<{ objectId: string; byteLength: number }>;

function blobBatchLength(expected: readonly ExactBlobSize[]): number {
  if (expected.length > MAXIMUM_TREE_ENTRIES) {
    throw new FoundationError("lifecycle.repository.blob-bound", "Exact Git blob batch exceeds its object-count bound");
  }
  const seen = new Set<string>();
  let length = 0;
  for (const { objectId, byteLength } of expected) {
    parseObjectId(objectId, objectId.length === 40 ? "sha1" : "sha256", "Batch blob");
    if (seen.has(objectId) || !Number.isSafeInteger(byteLength) || byteLength < 0) {
      throw new FoundationError("lifecycle.repository.blob-missing", "Exact Git blob batch has an ambiguous expected inventory");
    }
    seen.add(objectId);
    length += Buffer.byteLength(`${objectId} blob ${byteLength}\n`, "ascii") + byteLength + 1;
    if (!Number.isSafeInteger(length) || length >= Number.MAX_SAFE_INTEGER) {
      throw new FoundationError("lifecycle.repository.blob-bound", "Exact Git blob batch exceeds its byte bound");
    }
  }
  return length;
}

/** Parse exactly the requested Git framing and verify each raw blob identity. */
export function parseGitBlobBatchResult(
  result: CommandBytesResult,
  expected: readonly ExactBlobSize[],
): ReadonlyMap<string, Buffer> {
  const maximumBytes = blobBatchLength(expected);
  if (result.timedOut) {
    throw new FoundationError("lifecycle.repository.blob-timeout", "Tracked blob batch read exceeded its time bound");
  }
  if (result.stdoutTruncated || result.stdout.byteLength > maximumBytes) {
    throw new FoundationError("lifecycle.repository.blob-bound", "Tracked blob batch exceeds its exact byte bound");
  }
  if (result.exitCode !== 0 || result.signal !== null || result.stderrTruncated) {
    throw new FoundationError("lifecycle.repository.blob-missing", "Required tracked blob batch is unavailable");
  }
  const blobs = new Map<string, Buffer>();
  let offset = 0;
  for (const { objectId, byteLength } of expected) {
    const header = Buffer.from(`${objectId} blob ${byteLength}\n`, "ascii");
    const start = offset + header.byteLength;
    const end = start + byteLength;
    if (!result.stdout.subarray(offset, start).equals(header) || end >= result.stdout.byteLength || result.stdout[end] !== 10) {
      throw new FoundationError("lifecycle.repository.blob-missing", "Git returned a missing, substituted, or incomplete blob batch");
    }
    const bytes = result.stdout.subarray(start, end);
    const digest = createHash(objectId.length === 40 ? "sha1" : "sha256")
      .update(`blob ${byteLength}\0`, "ascii").update(bytes).digest("hex");
    if (digest !== objectId) {
      throw new FoundationError("lifecycle.repository.blob-missing", "Git blob batch payload does not match its exact object identity");
    }
    blobs.set(objectId, bytes);
    offset = end + 1;
  }
  if (offset !== result.stdout.byteLength) {
    throw new FoundationError("lifecycle.repository.blob-missing", "Git blob batch contains trailing or unrequested data");
  }
  return blobs;
}

/**
 * Observe sizes first, then retrieve one bounded exact batch. Repeated object
 * selections still consume the caller's per-occurrence aggregate byte budget.
 * No result survives this call as a repository observation or semantic cache.
 */
export async function objectBlobBatchBytes(
  repository: string,
  objectIds: readonly string[],
  maximumFileBytes: number,
  maximumTotalBytes: number,
  timeoutMs = 30_000,
): Promise<ReadonlyMap<string, Buffer>> {
  if (objectIds.length > MAXIMUM_TREE_ENTRIES ||
      ![maximumFileBytes, maximumTotalBytes, timeoutMs].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new FoundationError("lifecycle.repository.blob-bound", "Exact Git blob batch has invalid read bounds");
  }
  for (const objectId of objectIds) {
    parseObjectId(objectId, objectId.length === 40 ? "sha1" : "sha256", "Batch blob");
  }
  const unique = [...new Set(objectIds)].sort();
  if (unique.length === 0) return new Map();
  const sizes = await exactBlobSizes(repository, unique, timeoutMs);
  if (sizes.size !== unique.length || unique.some((objectId) => !sizes.has(objectId))) {
    throw new FoundationError("lifecycle.repository.blob-missing", "Git returned a substituted exact blob-size inventory");
  }
  let totalBytes = 0;
  for (const objectId of objectIds) {
    const byteLength = sizes.get(objectId)!;
    totalBytes += byteLength;
    if (byteLength > maximumFileBytes || !Number.isSafeInteger(totalBytes) || totalBytes > maximumTotalBytes) {
      throw new FoundationError("lifecycle.repository.blob-bound", "Tracked blob batch exceeds its per-file or aggregate byte bound");
    }
  }
  const expected = unique.map((objectId) => Object.freeze({ objectId, byteLength: sizes.get(objectId)! }));
  const result = await gitBytes(repository, ["cat-file", "--batch"], {
    allowFailure: true,
    input: `${unique.join("\n")}\n`,
    maxStdoutBytes: blobBatchLength(expected) + 1,
    timeoutMs,
  });
  return parseGitBlobBatchResult(result, expected);
}

/** Read one exact path difference without granting a caller arbitrary Git commands. */
export async function exactFileDifferenceBytes(input: Readonly<{
  repository: string;
  before: string;
  after: string;
  path: string;
  maximumBytes: number;
}>): Promise<CommandBytesResult> {
  const format = await resolveGitObjectFormat(input.repository);
  parseObjectId(input.before, format, "Difference before object");
  parseObjectId(input.after, format, "Difference after object");
  validateRepositoryPath(input.path, Buffer.byteLength(input.path, "utf8"));
  return gitBytes(input.repository, [
    "diff", "--binary", "--full-index", "--no-color", "--no-ext-diff", "--no-renames",
    input.before, input.after, "--", input.path,
  ], {
    allowFailure: true,
    env: Object.freeze({ GIT_LITERAL_PATHSPECS: "1" }),
    maxStdoutBytes: input.maximumBytes + 1,
    timeoutMs: 120_000,
  });
}
