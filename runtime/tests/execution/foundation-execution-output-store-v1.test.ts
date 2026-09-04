import assert from "node:assert/strict";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { FoundationError } from "../../src/foundation/error.js";
import {
  createFoundationExecutionOutputStoreV1,
  type FoundationExecutionOutputStoreArtifactBindingV1,
  type FoundationExecutionOutputStoreBindingV1,
  type FoundationExecutionOutputStoreV1,
} from "../../src/foundation/execution/output-store-v1.js";
import type { FoundationExecutionOutputStagingPlanV1 } from
  "../../src/foundation/execution/output-validation.js";
import {
  canonicalJson,
  canonicalJsonLine,
  digestCanonical,
  selfDigest,
  sha256Bytes,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";

const STORE_ROOT = join("execution-output-store", "v1");
const STAGING_ROOT = join(STORE_ROOT, "staging");
const BLOBS_ROOT = join(STORE_ROOT, "blobs");

type FileFixture = Readonly<{
  binding: FoundationExecutionOutputStoreArtifactBindingV1;
  bytes: Uint8Array;
}>;

function file(index: number, contents: string): FileFixture {
  const bytes = Uint8Array.from(Buffer.from(contents, "utf8"));
  return Object.freeze({
    bytes,
    binding: Object.freeze({
      artifactIndex: index,
      bindingDigest: digestCanonical({ index, path: `output/${index}.txt` }),
      byteLength: bytes.byteLength,
      digest: sha256Bytes(bytes),
    }),
  });
}

function manifest() {
  const subject = {
    schema: "lifecycle.execution-output-manifest.v1",
    specificationDigest: sha256Bytes("specification"),
    entries: [{ path: "output/0.txt" }],
  };
  const value = Object.freeze({ ...subject, digest: selfDigest(subject) });
  return Object.freeze({
    value,
    bytes: Uint8Array.from(Buffer.from(canonicalJsonLine(value), "utf8")),
  });
}

function plan(files: readonly FileFixture[], manifestDigest: Sha256): FoundationExecutionOutputStagingPlanV1 {
  return Object.freeze({
    manifestDigest,
    carrierByteLength: files.reduce((sum, selected) => sum + selected.bytes.byteLength, 0),
    artifactCount: files.length,
  });
}

async function home(t: TestContext): Promise<string> {
  const selected = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-output-store-v1-")));
  t.after(async () => await rm(selected, { recursive: true, force: true }));
  return selected;
}

async function* chunks(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  const width = Math.max(1, Math.floor(bytes.byteLength / 2));
  for (let offset = 0; offset < bytes.byteLength; offset += width) {
    yield Uint8Array.from(bytes.subarray(offset, Math.min(bytes.byteLength, offset + width)));
  }
}

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of stream) { chunks.push(Uint8Array.from(chunk)); length += chunk.byteLength; }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function publish(store: FoundationExecutionOutputStoreV1, files: readonly FileFixture[]) {
  const selectedManifest = manifest();
  const transaction = await store.begin({
    plan: plan(files, selectedManifest.value.digest),
    manifestBytes: selectedManifest.bytes,
  });
  const staged = [];
  for (const selected of files) {
    staged.push(await transaction.stage(Object.freeze({
      ...selected.binding,
      bytes: chunks(selected.bytes),
    })));
  }
  const binding = await transaction.commit();
  assert.deepEqual(await transaction.commit(), binding);
  return Object.freeze({ binding, staged: Object.freeze(staged), manifest: selectedManifest });
}

function blobPath(machineHome: string, selectedDigest: Sha256): string {
  const hexadecimal = selectedDigest.slice("sha256:".length);
  return join(machineHome, BLOBS_ROOT, hexadecimal.slice(0, 2), `sha256-${hexadecimal}.blob`);
}

async function transactionRoot(machineHome: string): Promise<string> {
  const parent = join(machineHome, STAGING_ROOT);
  const selected = (await readdir(parent)).filter((entry) => entry.startsWith("transaction-"));
  assert.equal(selected.length, 1);
  return join(parent, selected[0]!);
}

async function assertCode(action: () => Promise<unknown>, suffix: string): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof FoundationError);
    assert.equal(error.code, `lifecycle.execution.output-store.${suffix}`);
    return true;
  });
}

test("publishes a fixed-size binding and reopens descriptor, Manifest, and bytes after restart", async (t) => {
  const machineHome = await home(t);
  const files = [file(0, "candidate bytes\n"), file(1, "provider observation\n")];
  const published = await publish(createFoundationExecutionOutputStoreV1({ machineHome }), files);

  assert.deepEqual(Object.keys(published.binding).sort(), ["descriptor", "digest", "schema"]);
  assert.ok(canonicalJson(published.binding).length < 512);
  assert.doesNotMatch(canonicalJson(published.binding), /(?:artifactIndex|manifestDigest|\/tmp|\/private|docker|handle)/u);
  assert.equal(published.binding.digest, selfDigest(published.binding as unknown as Record<string, unknown>));

  const restarted = createFoundationExecutionOutputStoreV1({ machineHome });
  const opened = await restarted.reopen(published.binding);
  assert.deepEqual(opened.manifestBytes, published.manifest.bytes);
  assert.equal(opened.descriptor.plan.manifestDigest, published.manifest.value.digest);
  assert.deepEqual(opened.descriptor.artifacts, files.map(({ binding }) => binding));
  for (let index = 0; index < files.length; index += 1) {
    assert.deepEqual(await collect(opened.artifacts[index]!.read()), files[index]!.bytes);
    assert.deepEqual(await collect(published.staged[index]!.read()), files[index]!.bytes);
  }
});

test("identical retry converges and byte-identical blob replacement remains valid", async (t) => {
  const machineHome = await home(t);
  const files = [file(0, "same semantic bytes\n")];
  const first = await publish(createFoundationExecutionOutputStoreV1({ machineHome }), files);
  const second = await publish(createFoundationExecutionOutputStoreV1({ machineHome }), files);
  assert.deepEqual(second.binding, first.binding);

  const artifact = blobPath(machineHome, files[0]!.binding.digest);
  const replacement = `${artifact}.replacement`;
  await copyFile(artifact, replacement);
  await chmod(replacement, 0o400);
  await unlink(artifact);
  await copyFile(replacement, artifact);
  await chmod(artifact, 0o400);
  await unlink(replacement);
  assert.deepEqual(
    await collect((await createFoundationExecutionOutputStoreV1({ machineHome }).reopen(first.binding)).artifacts[0]!.read()),
    files[0]!.bytes,
  );
});

test("wrong bytes and relaxed private roots fail closed", async (t) => {
  const machineHome = await home(t);
  const files = [file(0, "trusted bytes\n")];
  const { binding } = await publish(createFoundationExecutionOutputStoreV1({ machineHome }), files);
  const artifact = blobPath(machineHome, files[0]!.binding.digest);
  await chmod(artifact, 0o600);
  await writeFile(artifact, Buffer.from("changed bytes\n", "utf8"));
  await chmod(artifact, 0o400);
  await assertCode(
    () => createFoundationExecutionOutputStoreV1({ machineHome }).reopen(binding),
    "substitution",
  );

  const otherHome = await home(t);
  const other = await publish(createFoundationExecutionOutputStoreV1({ machineHome: otherHome }), files);
  await chmod(join(otherHome, STORE_ROOT), 0o755);
  await assertCode(
    () => createFoundationExecutionOutputStoreV1({ machineHome: otherHome }).reopen(other.binding),
    "custody",
  );
});

test("interrupted multi-blob publication retries to the same descriptor binding", async (t) => {
  const machineHome = await home(t);
  const files = [file(0, "first output\n"), file(1, "second distinct output\n")];
  assert.notEqual(files[0]!.binding.digest.slice(7, 9), files[1]!.binding.digest.slice(7, 9));
  const selectedManifest = manifest();
  const store = createFoundationExecutionOutputStoreV1({ machineHome });
  const transaction = await store.begin({
    plan: plan(files, selectedManifest.value.digest),
    manifestBytes: selectedManifest.bytes,
  });
  for (const selected of files) {
    await transaction.stage(Object.freeze({ ...selected.binding, bytes: chunks(selected.bytes) }));
  }
  const blockedShard = join(machineHome, BLOBS_ROOT, files[1]!.binding.digest.slice(7, 9));
  await mkdir(blockedShard, { mode: 0o500 });
  await chmod(blockedShard, 0o500);
  await assertCode(() => transaction.commit(), "custody");
  assert.equal((await lstat(blobPath(machineHome, files[0]!.binding.digest))).isFile(), true);
  await chmod(blockedShard, 0o700);
  const binding = await transaction.commit();
  assert.deepEqual(await transaction.commit(), binding);
  assert.deepEqual(await collect((await store.reopen(binding)).artifacts[1]!.read()), files[1]!.bytes);
});

test("abort deletes only an exact known provisional inventory and refuses ambiguity", async (t) => {
  const machineHome = await home(t);
  const selectedManifest = manifest();
  const selected = file(0, "expected bytes\n");
  const store = createFoundationExecutionOutputStoreV1({ machineHome });
  const transaction = await store.begin({
    plan: plan([selected], selectedManifest.value.digest),
    manifestBytes: selectedManifest.bytes,
  });
  await assertCode(
    () => transaction.stage(Object.freeze({
      ...selected.binding,
      bytes: chunks(Uint8Array.from(Buffer.from("wrong___bytes\n", "utf8"))),
    })),
    "stream",
  );
  await transaction.abort();
  assert.deepEqual(await readdir(join(machineHome, STAGING_ROOT)), []);

  const second = await store.begin({
    plan: plan([selected], selectedManifest.value.digest),
    manifestBytes: selectedManifest.bytes,
  });
  await second.stage(Object.freeze({ ...selected.binding, bytes: chunks(selected.bytes) }));
  const root = await transactionRoot(machineHome);
  await writeFile(join(root, "unknown"), "ambiguous", { mode: 0o400 });
  await assertCode(() => second.abort(), "inventory");
  assert.equal((await lstat(root)).isDirectory(), true);
});

test("Manifest and checkpoint binding substitutions are rejected before replay", async (t) => {
  const machineHome = await home(t);
  const files = [file(0, "one\n")];
  const selectedManifest = manifest();
  const store = createFoundationExecutionOutputStoreV1({ machineHome });
  await assertCode(
    () => store.begin({
      plan: plan(files, sha256Bytes("another-manifest")),
      manifestBytes: selectedManifest.bytes,
    }),
    "binding",
  );
  const published = await publish(store, files);
  const changed = JSON.parse(canonicalJson(published.binding)) as FoundationExecutionOutputStoreBindingV1;
  (changed as { descriptor: { byteLength: number; digest: Sha256 } }).descriptor.digest =
    sha256Bytes("substituted-descriptor");
  await assertCode(() => store.reopen(changed), "binding");
});
