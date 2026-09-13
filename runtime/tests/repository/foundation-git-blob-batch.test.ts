import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { materializeAtlasState } from "../../src/foundation/atlas/materialization.js";
import { FoundationError } from "../../src/foundation/error.js";
import {
  exactBlobSizes,
  git,
  objectBlobBatchBytes,
  objectBlobBytes,
  parseGitBlobBatchResult,
  parseGitBlobSizeResult,
} from "../../src/foundation/repository/git.js";
import { digestCanonical } from "../../src/foundation/validation/canonical.js";
import type { CommandBytesResult } from "../../src/util/process.js";

function blobId(bytes: Buffer, format: "sha1" | "sha256"): string {
  return createHash(format).update(`blob ${bytes.byteLength}\0`, "ascii").update(bytes).digest("hex");
}

function framed(objectId: string, bytes: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`${objectId} blob ${bytes.byteLength}\n`, "ascii"), bytes, Buffer.from("\n")]);
}

function result(stdout: Buffer, overrides: Partial<CommandBytesResult> = {}): CommandBytesResult {
  return { stdout, stderr: "private synthetic diagnostic", stderrBytes: Buffer.from("private synthetic diagnostic"),
    exitCode: 0, signal: null, stdoutTruncated: false, stderrTruncated: false, timedOut: false, ...overrides };
}

function failure(code?: string): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    assert(error instanceof FoundationError);
    if (code !== undefined) assert.equal(error.code, code);
    assert(!JSON.stringify(error).includes("private synthetic diagnostic"));
    return true;
  };
}

test("Git batch reads exact binary and empty blobs under SHA1 and SHA256 without retaining later observations", async (context) => {
  // Two real independent Git repositories; exact raw payloads include NUL,
  // newline, invalid UTF-8 and header-shaped bytes. No provider or Control.
  for (const format of ["sha1", "sha256"] as const) {
    const repository = await mkdtemp(join(tmpdir(), "lifecycle-git-blob-batch-"));
    context.after(() => rm(repository, { recursive: true, force: true }));
    await git(repository, ["init", `--object-format=${format}`, "-b", "main"]);
    const payloads = [Buffer.alloc(0), Buffer.from([0, 10, 255, 13, 0]), Buffer.from("header blob 9\nbody\n")];
    const ids: string[] = [];
    for (const [index, bytes] of payloads.entries()) {
      const path = join(repository, `${index}.bin`);
      await writeFile(path, bytes);
      const id = (await git(repository, ["hash-object", "-w", "--", path])).stdout.trim();
      assert.equal(id, blobId(bytes, format));
      ids.push(id);
    }
    const selected = [ids[2]!, ids[0]!, ids[1]!, ids[1]!];
    const total = payloads[2]!.byteLength + payloads[1]!.byteLength * 2;
    const observed = await objectBlobBatchBytes(repository, selected, 64, total);
    assert.equal(observed.size, 3);
    for (const [index, id] of ids.entries()) {
      assert.deepEqual(observed.get(id), payloads[index]);
      assert.deepEqual(observed.get(id), await objectBlobBytes(repository, id, 64));
    }
    await assert.rejects(objectBlobBatchBytes(repository, selected, 64, total - 1), failure("lifecycle.repository.blob-bound"));
    await assert.rejects(objectBlobBatchBytes(repository, selected, 4, total), failure("lifecycle.repository.blob-bound"));
    const missing = "f".repeat(format === "sha1" ? 40 : 64);
    await assert.rejects(objectBlobBatchBytes(repository, [missing], 64, 64), failure("lifecycle.projection.content-digest"));
    await git(repository, ["add", "--", "."]);
    const tree = (await git(repository, ["write-tree"])).stdout.trim();
    await assert.rejects(exactBlobSizes(repository, [tree]), failure("lifecycle.projection.content-digest"));
    await assert.rejects(objectBlobBatchBytes(repository, [`${ids[0]}\n${ids[1]}`], 64, 64), failure("lifecycle.repository.object-id"));

    // A prior successful read cannot hide later loss of the same required blob.
    const lost = ids[1]!;
    await rm(join(repository, ".git", "objects", lost.slice(0, 2), lost.slice(2)));
    await assert.rejects(objectBlobBatchBytes(repository, [lost], 64, 64), failure("lifecycle.projection.content-digest"));
  }
  assert.equal((await objectBlobBatchBytes("/not-opened-for-empty-selection", [], 1, 1)).size, 0);
});

test("Git batch decoder rejects every truncated prefix, substituted payload and ambiguous terminal result", (context) => {
  // Finite mutation domain: both Git formats, every strict prefix of two raw
  // frames, and named identity/type/size/delimiter/order/terminal mutations.
  // Oracle: successful bytes exactly equal the independently hashed payloads;
  // all selected mutations must refuse without exposing captured stderr.
  let truncatedPrefixes = 0;
  for (const format of ["sha1", "sha256"] as const) {
    const left = Buffer.from([0, 10, 255, 65]);
    const right = Buffer.from("other\n");
    const leftId = blobId(left, format);
    const rightId = blobId(right, format);
    const expected = [{ objectId: leftId, byteLength: left.byteLength }, { objectId: rightId, byteLength: right.byteLength }];
    const leftFrame = framed(leftId, left);
    const rightFrame = framed(rightId, right);
    const bytes = Buffer.concat([leftFrame, rightFrame]);
    const parsed = parseGitBlobBatchResult(result(bytes), expected);
    assert.deepEqual(parsed.get(leftId), left);
    assert.deepEqual(parsed.get(rightId), right);
    for (let length = 0; length < bytes.byteLength; length += 1) {
      assert.throws(() => parseGitBlobBatchResult(result(bytes.subarray(0, length)), expected), failure());
      truncatedPrefixes += 1;
    }
    const mutations = [
      { name: "unrequested object", bytes: Buffer.concat([framed("a".repeat(leftId.length), left), rightFrame]) },
      { name: "wrong type", bytes: Buffer.from(bytes.toString("latin1").replace(" blob ", " tree "), "latin1") },
      { name: "wrong size", bytes: Buffer.from(bytes.toString("latin1").replace(" blob 4\n", " blob 5\n"), "latin1") },
      { name: "noncanonical size", bytes: Buffer.from(bytes.toString("latin1").replace(" blob 4\n", " blob 04\n"), "latin1") },
      { name: "same-size corrupt payload", bytes: Buffer.concat([framed(leftId, Buffer.from([0, 10, 255, 66])), rightFrame]) },
      { name: "missing object", bytes: Buffer.from(`${leftId} missing\n`) },
      { name: "reordered objects", bytes: Buffer.concat([rightFrame, leftFrame]) },
      { name: "duplicate object", bytes: Buffer.concat([leftFrame, leftFrame]) },
      { name: "wrong delimiter", bytes: Buffer.concat([leftFrame.subarray(0, -1), Buffer.from([0]), rightFrame]) },
      { name: "trailing data", bytes: Buffer.concat([bytes, Buffer.from("x")]) },
    ];
    for (const mutation of mutations) {
      assert.throws(() => parseGitBlobBatchResult(result(mutation.bytes), expected), failure(), `${format}: ${mutation.name}`);
    }
    for (const disposition of [
      { stdoutTruncated: true }, { stderrTruncated: true }, { timedOut: true }, { exitCode: 1 }, { signal: "SIGTERM" as const },
    ]) {
      assert.throws(() => parseGitBlobBatchResult(result(bytes, disposition), expected), failure());
    }
    assert.throws(() => parseGitBlobBatchResult(result(bytes), [expected[0]!, expected[0]!]), failure());
    assert.throws(() => parseGitBlobBatchResult(result(bytes), [{ objectId: leftId, byteLength: Number.MAX_SAFE_INTEGER }]), failure());
  }
  context.diagnostic(JSON.stringify({ property: "exact requested raw blob bytes or refusal", formats: ["sha1", "sha256"],
    truncatedPrefixes, namedMutationsPerFormat: 10, terminalMutationsPerFormat: 5, seeds: null,
    exclusions: ["large Git repositories", "concurrent Engine or provider effects", "operated installation qualification"] }));
});

test("Git batch preflight refuses incomplete, substituted and unbounded size inventories", () => {
  const ids = ["a".repeat(40), "b".repeat(40)];
  const stdout = `${ids[0]} blob 0\n${ids[1]} blob 4\n`;
  const healthy = { stdout, stderr: "private synthetic diagnostic", exitCode: 0, signal: null };
  assert.deepEqual([...parseGitBlobSizeResult(healthy, ids)], [[ids[0], 0], [ids[1], 4]]);
  for (const substituted of [
    stdout.slice(0, -1),
    stdout.split("\n").slice(0, 1).join("\n") + "\n",
    `${ids[1]} blob 4\n${ids[0]} blob 0\n`,
    stdout.replace(ids[1]!, ids[0]!),
    stdout.replace(" blob 4", " blob 04"),
    stdout.replace(" blob 4", " tree 4"),
    stdout.replace(" blob 4", " blob 9007199254740992"),
    stdout.replace(`${ids[1]} blob 4`, `${ids[1]} missing`),
    stdout + `${ids[1]} blob 4\n`,
  ]) {
    assert.throws(() => parseGitBlobSizeResult({ ...healthy, stdout: substituted }, ids), failure("lifecycle.projection.content-digest"));
  }
  for (const disposition of [
    { stdoutTruncated: true }, { stderrTruncated: true }, { timedOut: true }, { exitCode: 1 }, { signal: "SIGTERM" as const },
  ]) {
    assert.throws(() => parseGitBlobSizeResult({ ...healthy, ...disposition }, ids), failure("lifecycle.projection.content-digest"));
  }
});

test("Atlas materialization keeps exact paths and per-path raw bounds with batched Git blobs", async (context) => {
  const repository = await mkdtemp(join(tmpdir(), "lifecycle-atlas-batch-"));
  context.after(() => rm(repository, { recursive: true, force: true }));
  await git(repository, ["init", "-b", "main"]);
  const bytes = Buffer.from("same raw Atlas source\n");
  const objectId = (await git(repository, ["hash-object", "-w", "--stdin"], { input: bytes.toString("utf8") })).stdout.trim();
  const entries = [{ path: "atlas/atlas.md", mode: "100644" as const, objectId },
    { path: "atlas/context/repeated.md", mode: "100644" as const, objectId }];
  const materialized = await materializeAtlasState(repository, { entries, digest: digestCanonical(entries) }, "atlas/atlas.md");
  try {
    assert.deepEqual(await readFile(materialized.entrypoint), bytes);
    assert.deepEqual(await readFile(join(materialized.root, entries[1]!.path)), bytes);
  } finally { await materialized.cleanup(); }

  const invalidEntries = [{ ...entries[0]!, path: "../outside.md" }];
  await assert.rejects(materializeAtlasState(repository, { entries: invalidEntries, digest: digestCanonical(invalidEntries) }, "atlas/atlas.md"),
    failure("lifecycle.atlas.binding-invalid"));
  const executableEntries = [{ ...entries[0]!, mode: "100755" as "100644" }];
  await assert.rejects(materializeAtlasState(repository, { entries: executableEntries, digest: digestCanonical(executableEntries) }, "atlas/atlas.md"),
    failure("lifecycle.atlas.binding-invalid"));

  const maximum = 16 * 1024 * 1024;
  const largePath = join(repository, "large.bin");
  await writeFile(largePath, Buffer.alloc(maximum));
  const largeId = (await git(repository, ["hash-object", "-w", "--", largePath])).stdout.trim();
  const repeated = Array.from({ length: 17 }, (_, index) => ({ path: `atlas/${index}.md`, mode: "100644" as const, objectId: largeId }));
  await assert.rejects(materializeAtlasState(repository, { entries: repeated, digest: digestCanonical(repeated) }, "atlas/0.md"),
    failure("lifecycle.atlas.processing-incomplete"));
  await writeFile(largePath, Buffer.alloc(maximum + 1));
  const oversizedId = (await git(repository, ["hash-object", "-w", "--", largePath])).stdout.trim();
  const oversized = [{ path: "atlas/atlas.md", mode: "100644" as const, objectId: oversizedId }];
  await assert.rejects(materializeAtlasState(repository, { entries: oversized, digest: digestCanonical(oversized) }, "atlas/atlas.md"),
    failure("lifecycle.atlas.processing-incomplete"));
});
