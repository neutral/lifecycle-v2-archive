import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { FoundationError } from "../error.js";
import { normalizedKnowledgePath } from "../knowledge/structural.js";
import { sha256Bytes, type Sha256 } from "../validation/canonical.js";
import { FOUNDATION_LOCAL_DRAFT_LIMITS } from "./limits.js";

export type FoundationLocalDraftFile = Readonly<{
  path: string;
  bytes: Buffer;
  sourceDigest: Sha256;
}>;

function failure(code: string, message: string): never {
  throw new FoundationError(`lifecycle.draft.${code}`, message);
}

function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mode === right.mode && left.nlink === right.nlink &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

/** Read only a caller-selected local file. No Git, target, Store, or backend is opened. */
export async function readFoundationLocalDraftFile(input: Readonly<{
  root: string;
  path: string;
  maximumBytes: number;
}>): Promise<FoundationLocalDraftFile> {
  const path = normalizedKnowledgePath(input.path, "Local draft path");
  if (!Number.isSafeInteger(input.maximumBytes) || input.maximumBytes < 1 || input.maximumBytes > FOUNDATION_LOCAL_DRAFT_LIMITS.maximumFileObservationBytes) {
    failure("limit", "Local draft read requires one supported positive byte bound");
  }
  try {
    // Resolve the explicitly selected root once; descendants may not redirect it.
    const root = await realpath(resolve(input.root));
    const parts = path.split("/");
    const directories: { path: string; state: BigIntStats }[] = [];
    let parent = root;
    for (const part of ["", ...parts.slice(0, -1)]) {
      if (part !== "") parent = join(parent, part);
      const state = await lstat(parent, { bigint: true });
      if (!state.isDirectory() || state.isSymbolicLink()) failure("path", "Local draft path must stay within regular directories of the selected root");
      directories.push({ path: parent, state });
    }
    const selected = join(parent, parts.at(-1)!);
    const before = await lstat(selected, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || (before.mode & 0o111n) !== 0n) {
      failure("file-mode", "Local draft input must be one non-executable regular file without links");
    }
    if (before.size > BigInt(input.maximumBytes)) failure("file-bound", `Local draft input exceeds ${input.maximumBytes} bytes`);
    const handle = await open(selected, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const opened = await handle.stat({ bigint: true });
      if (!sameFile(before, opened)) failure("file-changed", "Local draft input changed before reading; retry the same selection");
      const bytes = Buffer.alloc(input.maximumBytes + 1);
      let length = 0;
      while (length < bytes.byteLength) {
        const read = await handle.read(bytes, length, bytes.byteLength - length, length);
        if (read.bytesRead === 0) break;
        length += read.bytesRead;
      }
      if (length > input.maximumBytes) failure("file-bound", `Local draft input exceeds ${input.maximumBytes} bytes`);
      if (!sameFile(opened, await handle.stat({ bigint: true })) ||
          !sameFile(opened, await lstat(selected, { bigint: true })) || BigInt(length) !== opened.size) {
        failure("file-changed", "Local draft input changed while reading; retry the same selection");
      }
      for (const directory of directories) {
        const current = await lstat(directory.path, { bigint: true });
        if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== directory.state.dev || current.ino !== directory.state.ino) {
          failure("path-changed", "Local draft directory changed while reading; retry the same selection");
        }
      }
      if (await realpath(dirname(selected)) !== parent) failure("path-changed", "Local draft directory no longer matches its selected root");
      const observed = Buffer.from(bytes.subarray(0, length));
      return Object.freeze({ path, bytes: observed, sourceDigest: sha256Bytes(observed) });
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error instanceof FoundationError) throw error;
    // OS errors can contain private absolute paths. Only this fixed refusal crosses the CLI.
    failure("file-unavailable", "Selected local draft input is unavailable; restore the exact file and retry");
  }
}

export function decodeFoundationLocalDraftUtf8(file: FoundationLocalDraftFile): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(file.bytes);
  } catch {
    failure("utf8", "Selected local draft input must contain valid UTF-8 bytes");
  }
}
