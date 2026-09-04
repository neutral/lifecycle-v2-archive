import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, readdir, realpath, rename, rmdir, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { FoundationError } from "../error.js";
import { canonicalJson, canonicalJsonLine, digestCanonical, selfDigest, sha256Bytes, type Sha256 } from "../validation/canonical.js";
import type {
  FoundationExecutionOutputStagingBindingV1,
  FoundationExecutionOutputStagingPlanV1,
  FoundationStagedExecutionOutputArtifactV1,
} from "./output-validation.js";

const STORE_DIRECTORY = "execution-output-store";
const STORE_VERSION = "v1";
const STAGING_DIRECTORY = "staging";
const BLOBS_DIRECTORY = "blobs";
const READ_CHUNK_BYTES = 64 * 1024;

export const FOUNDATION_EXECUTION_OUTPUT_STORE_LIMITS_V1 = Object.freeze({
  maximumArtifactCount: 4_096,
  maximumArtifactBytes: 512 * 1024 * 1024,
  maximumCarrierBytes: 1_024 * 1024 * 1024,
  maximumManifestBytes: 8 * 1024 * 1024,
  maximumDescriptorBytes: 8 * 1024 * 1024,
});

export type FoundationExecutionOutputStoreArtifactBindingV1 = FoundationExecutionOutputStagingBindingV1;
export type FoundationExecutionOutputStoreBlobBindingV1 = Readonly<{ byteLength: number; digest: Sha256 }>;

export type FoundationExecutionOutputStoreDescriptorV1 = Readonly<{
  schema: "lifecycle.execution-output-store-descriptor.v1";
  plan: FoundationExecutionOutputStagingPlanV1;
  manifest: FoundationExecutionOutputStoreBlobBindingV1;
  artifacts: readonly FoundationExecutionOutputStoreArtifactBindingV1[];
  artifactInventoryDigest: Sha256;
  digest: Sha256;
}>;

/** Fixed-size, locator-free selection retained only in private Activity support. */
export type FoundationExecutionOutputStoreBindingV1 = Readonly<{
  schema: "lifecycle.execution-output-store-binding.v1";
  descriptor: FoundationExecutionOutputStoreBlobBindingV1;
  digest: Sha256;
}>;

export type FoundationOpenedExecutionOutputStoreArtifactV1 = FoundationExecutionOutputStoreArtifactBindingV1 & Readonly<{
  read(): AsyncIterable<Uint8Array>;
}>;

export type FoundationOpenedExecutionOutputStoreBindingV1 = Readonly<{
  binding: FoundationExecutionOutputStoreBindingV1;
  descriptor: FoundationExecutionOutputStoreDescriptorV1;
  manifestBytes: Uint8Array;
  artifacts: readonly FoundationOpenedExecutionOutputStoreArtifactV1[];
}>;

export type FoundationExecutionOutputStoreTransactionV1 = Readonly<{
  stage(input: FoundationExecutionOutputStagingBindingV1 & Readonly<{
    bytes: AsyncIterable<Uint8Array>;
  }>): Promise<FoundationStagedExecutionOutputArtifactV1>;
  commit(): Promise<FoundationExecutionOutputStoreBindingV1>;
  abort(): Promise<void>;
}>;

export type FoundationExecutionOutputStoreV1 = Readonly<{
  begin(input: Readonly<{
    plan: FoundationExecutionOutputStagingPlanV1;
    manifestBytes: Uint8Array;
  }>): Promise<FoundationExecutionOutputStoreTransactionV1>;
  reopen(binding: FoundationExecutionOutputStoreBindingV1): Promise<FoundationOpenedExecutionOutputStoreBindingV1>;
}>;

type StorePaths = Readonly<{ staging: string; blobs: string }>;
type BlobFacts = FoundationExecutionOutputStoreBlobBindingV1;
type BlobState = { name: string; facts: BlobFacts; published: boolean };
type ArtifactState = BlobState & {
  binding: FoundationExecutionOutputStoreArtifactBindingV1;
  cleanupFacts: BlobFacts | null;
  staged: boolean;
};

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.execution.output-store.${code}`, message);
}

function record(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  return Object.getOwnPropertySymbols(value).length === 0 &&
    canonicalJson(Object.getOwnPropertyNames(value).sort()) === canonicalJson([...expected].sort());
}

function digest(value: unknown, label: string): asserts value is Sha256 {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    fail("binding", `${label} is not one lowercase SHA-256 digest`);
  }
}

function integer(value: unknown, label: string, minimum: number, maximum: number): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail("binding", `${label} is outside its exact bounded integer domain`);
  }
}

function parsePlan(value: FoundationExecutionOutputStagingPlanV1): FoundationExecutionOutputStagingPlanV1 {
  const limits = FOUNDATION_EXECUTION_OUTPUT_STORE_LIMITS_V1;
  if (!record(value) || !exactKeys(value, ["artifactCount", "carrierByteLength", "manifestDigest"])) {
    fail("plan", "Execution Output plan is not one exact closed value");
  }
  digest(value.manifestDigest, "Execution Output Manifest digest");
  integer(value.artifactCount, "Execution Output artifact count", 0, limits.maximumArtifactCount);
  integer(value.carrierByteLength, "Execution Output carrier bytes", 0, limits.maximumCarrierBytes);
  if (value.artifactCount === 0 && value.carrierByteLength !== 0) {
    fail("plan", "An empty Execution Output inventory cannot declare bytes");
  }
  return Object.freeze({ ...value });
}

function parseArtifact(
  value: FoundationExecutionOutputStagingBindingV1,
  plan: FoundationExecutionOutputStagingPlanV1,
): FoundationExecutionOutputStoreArtifactBindingV1 {
  if (!record(value) || !exactKeys(value, ["artifactIndex", "bindingDigest", "byteLength", "digest"]) ||
      plan.artifactCount === 0) {
    fail("binding", "Execution Output artifact binding is not one exact closed value");
  }
  integer(value.artifactIndex, "Execution Output artifact index", 0, plan.artifactCount - 1);
  integer(value.byteLength, "Execution Output artifact bytes", 0, Math.min(
    FOUNDATION_EXECUTION_OUTPUT_STORE_LIMITS_V1.maximumArtifactBytes,
    plan.carrierByteLength,
  ));
  digest(value.bindingDigest, "Execution Output artifact binding digest");
  digest(value.digest, "Execution Output artifact digest");
  return Object.freeze({ ...value });
}

function parseBlob(value: unknown, label: string, maximum: number): BlobFacts {
  if (!record(value) || !exactKeys(value, ["byteLength", "digest"])) {
    fail("binding", `${label} is not one exact blob binding`);
  }
  integer(value.byteLength, `${label} bytes`, 1, maximum);
  digest(value.digest, `${label} digest`);
  return Object.freeze({ byteLength: value.byteLength, digest: value.digest });
}

function compileDescriptor(
  plan: FoundationExecutionOutputStagingPlanV1,
  manifest: BlobFacts,
  artifacts: readonly FoundationExecutionOutputStoreArtifactBindingV1[],
): FoundationExecutionOutputStoreDescriptorV1 {
  const subject = Object.freeze({
    schema: "lifecycle.execution-output-store-descriptor.v1" as const,
    plan,
    manifest,
    artifacts,
    artifactInventoryDigest: digestCanonical(artifacts),
  });
  return Object.freeze({ ...subject, digest: selfDigest(subject) });
}

function parseDescriptor(value: unknown): FoundationExecutionOutputStoreDescriptorV1 {
  if (!record(value) || !exactKeys(value, [
    "artifactInventoryDigest", "artifacts", "digest", "manifest", "plan", "schema",
  ]) || value.schema !== "lifecycle.execution-output-store-descriptor.v1" || !Array.isArray(value.artifacts)) {
    fail("binding", "Execution Output descriptor is not one exact closed value");
  }
  const plan = parsePlan(value.plan as FoundationExecutionOutputStagingPlanV1);
  const manifest = parseBlob(
    value.manifest,
    "Execution Output Manifest blob",
    FOUNDATION_EXECUTION_OUTPUT_STORE_LIMITS_V1.maximumManifestBytes,
  );
  digest(value.artifactInventoryDigest, "Execution Output artifact inventory digest");
  digest(value.digest, "Execution Output descriptor digest");
  const artifacts = Object.freeze(value.artifacts.map((artifact) => parseArtifact(artifact, plan)));
  if (artifacts.length !== plan.artifactCount || artifacts.some((artifact, index) => artifact.artifactIndex !== index) ||
      artifacts.reduce((sum, artifact) => sum + artifact.byteLength, 0) !== plan.carrierByteLength) {
    fail("binding", "Execution Output descriptor artifact inventory does not match its plan");
  }
  const exact = compileDescriptor(plan, manifest, artifacts);
  if (exact.artifactInventoryDigest !== value.artifactInventoryDigest || exact.digest !== value.digest) {
    fail("binding", "Execution Output descriptor digest changed");
  }
  return exact;
}

function compileBinding(descriptor: BlobFacts): FoundationExecutionOutputStoreBindingV1 {
  const subject = Object.freeze({ schema: "lifecycle.execution-output-store-binding.v1" as const, descriptor });
  return Object.freeze({ ...subject, digest: selfDigest(subject) });
}

export function parseFoundationExecutionOutputStoreBindingV1(
  value: unknown,
): FoundationExecutionOutputStoreBindingV1 {
  if (!record(value) || !exactKeys(value, ["descriptor", "digest", "schema"]) ||
      value.schema !== "lifecycle.execution-output-store-binding.v1") {
    fail("binding", "Execution Output Store binding is not one exact closed value");
  }
  digest(value.digest, "Execution Output Store binding digest");
  const exact = compileBinding(parseBlob(
    value.descriptor,
    "Execution Output descriptor blob",
    FOUNDATION_EXECUTION_OUTPUT_STORE_LIMITS_V1.maximumDescriptorBytes,
  ));
  if (exact.digest !== value.digest) fail("binding", "Execution Output Store binding digest changed");
  return exact;
}

function canonicalBytes(bytesValue: Uint8Array, maximum: number, label: string): Readonly<{
  bytes: Uint8Array;
  value: unknown;
  facts: BlobFacts;
}> {
  if (!(bytesValue instanceof Uint8Array) || bytesValue.byteLength < 1 || bytesValue.byteLength > maximum) {
    fail("binding", `${label} bytes exceed their exact private bound`);
  }
  const bytes = Uint8Array.from(bytesValue);
  const text = Buffer.from(bytes).toString("utf8");
  let value: unknown;
  try { value = JSON.parse(text); } catch { fail("binding", `${label} is not JSON`); }
  if (canonicalJsonLine(value) !== text) fail("binding", `${label} is not canonical JSON`);
  return Object.freeze({
    bytes,
    value,
    facts: Object.freeze({ byteLength: bytes.byteLength, digest: sha256Bytes(bytes) }),
  });
}

function effectiveUserId(): bigint | null {
  const uid = process.geteuid?.() ?? process.getuid?.();
  return uid === undefined ? null : BigInt(uid);
}

async function exactDirectory(path: string, label: string): Promise<void> {
  const requested = resolve(path);
  let physical: string;
  let state: Awaited<ReturnType<typeof lstat>>;
  try { [physical, state] = await Promise.all([realpath(requested), lstat(requested, { bigint: true })]); }
  catch { fail("custody", `${label} is unavailable`); }
  const uid = effectiveUserId();
  if (physical !== requested || state.isSymbolicLink() || !state.isDirectory() ||
      Number(state.mode & 0o7777n) !== 0o700 || (uid !== null && state.uid !== uid)) {
    fail("custody", `${label} is not one exact owned private directory`);
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | (constants.O_NOFOLLOW ?? 0));
  try { await handle.sync(); } finally { await handle.close(); }
}

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function ensureDirectory(path: string, label: string): Promise<string> {
  const selected = resolve(path);
  let created = false;
  try { await mkdir(selected, { mode: 0o700 }); created = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  if (created) { await chmod(selected, 0o700); await syncDirectory(dirname(selected)); }
  await exactDirectory(selected, label);
  return selected;
}

async function ensurePaths(machineHome: string): Promise<StorePaths> {
  const home = resolve(machineHome);
  await exactDirectory(home, "Lifecycle machine home");
  const store = await ensureDirectory(join(home, STORE_DIRECTORY), "Execution Output Store");
  const root = await ensureDirectory(join(store, STORE_VERSION), "Execution Output Store version");
  return Object.freeze({
    staging: await ensureDirectory(join(root, STAGING_DIRECTORY), "Execution Output staging root"),
    blobs: await ensureDirectory(join(root, BLOBS_DIRECTORY), "Execution Output blob root"),
  });
}

async function openPaths(machineHome: string): Promise<StorePaths> {
  const home = resolve(machineHome);
  const root = join(home, STORE_DIRECTORY, STORE_VERSION);
  const paths = Object.freeze({ staging: join(root, STAGING_DIRECTORY), blobs: join(root, BLOBS_DIRECTORY) });
  for (const [path, label] of [
    [home, "Lifecycle machine home"],
    [join(home, STORE_DIRECTORY), "Execution Output Store"],
    [root, "Execution Output Store version"],
    [paths.staging, "Execution Output staging root"],
    [paths.blobs, "Execution Output blob root"],
  ] as const) await exactDirectory(path, label);
  return paths;
}

function blobLocation(paths: StorePaths, blobDigest: Sha256): Readonly<{ shard: string; blob: string }> {
  const hexadecimal = blobDigest.slice("sha256:".length);
  const shard = join(paths.blobs, hexadecimal.slice(0, 2));
  return Object.freeze({ shard, blob: join(shard, `sha256-${hexadecimal}.blob`) });
}

async function* verifiedFile(path: string, expected: BlobFacts, label: string): AsyncIterable<Uint8Array> {
  let handle: Awaited<ReturnType<typeof open>>;
  try { handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch { fail("unavailable", `${label} is unavailable`); }
  const hash = createHash("sha256");
  let observed = 0;
  try {
    const state = await handle.stat({ bigint: true });
    const uid = effectiveUserId();
    if (!state.isFile() || Number(state.mode & 0o7777n) !== 0o400 || state.nlink !== 1n ||
        state.size !== BigInt(expected.byteLength) || (uid !== null && state.uid !== uid)) {
      fail("substitution", `${label} is not one exact owned private blob`);
    }
    const buffer = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, Math.max(1, expected.byteLength)));
    while (observed < expected.byteLength) {
      const read = await handle.read(buffer, 0, Math.min(buffer.byteLength, expected.byteLength - observed), observed);
      if (read.bytesRead <= 0) fail("substitution", `${label} ended early`);
      const chunk = Uint8Array.from(buffer.subarray(0, read.bytesRead));
      observed += chunk.byteLength;
      hash.update(chunk);
      yield chunk;
    }
  } finally { await handle.close(); }
  if (observed !== expected.byteLength || `sha256:${hash.digest("hex")}` !== expected.digest) {
    fail("substitution", `${label} bytes do not match their content coordinate`);
  }
}

async function verifyFile(path: string, facts: BlobFacts, label: string): Promise<void> {
  for await (const _chunk of verifiedFile(path, facts, label)) { /* complete replay */ }
}

async function* verifiedBlob(paths: StorePaths, facts: BlobFacts): AsyncIterable<Uint8Array> {
  await exactDirectory(paths.blobs, "Execution Output blob root");
  const location = blobLocation(paths, facts.digest);
  await exactDirectory(location.shard, "Execution Output blob shard");
  yield* verifiedFile(location.blob, facts, "Execution Output blob");
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

async function reopen(machineHome: string, selected: FoundationExecutionOutputStoreBindingV1):
Promise<FoundationOpenedExecutionOutputStoreBindingV1> {
  const binding = parseFoundationExecutionOutputStoreBindingV1(selected);
  const paths = await openPaths(machineHome);
  const descriptorBytes = await collect(verifiedBlob(paths, binding.descriptor));
  const parsedDescriptor = canonicalBytes(
    descriptorBytes,
    FOUNDATION_EXECUTION_OUTPUT_STORE_LIMITS_V1.maximumDescriptorBytes,
    "Execution Output descriptor",
  );
  const descriptor = parseDescriptor(parsedDescriptor.value);
  const manifestBytes = await collect(verifiedBlob(paths, descriptor.manifest));
  const manifest = canonicalBytes(
    manifestBytes,
    FOUNDATION_EXECUTION_OUTPUT_STORE_LIMITS_V1.maximumManifestBytes,
    "Execution Output Manifest",
  );
  if (!record(manifest.value) || manifest.value.digest !== descriptor.plan.manifestDigest) {
    fail("binding", "Execution Output Manifest does not bind the selected semantic Manifest");
  }
  const artifacts = Object.freeze(descriptor.artifacts.map((artifact) => Object.freeze({
    ...artifact,
    async *read(): AsyncIterable<Uint8Array> { yield* verifiedBlob(paths, artifact); },
  })));
  for (const artifact of artifacts) for await (const _chunk of artifact.read()) { /* complete replay */ }
  return Object.freeze({ binding, descriptor, manifestBytes: Uint8Array.from(manifest.bytes), artifacts });
}

async function writeAll(handle: Awaited<ReturnType<typeof open>>, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = await handle.write(bytes, offset, bytes.byteLength - offset, null);
    if (written.bytesWritten <= 0) fail("write", "Execution Output staging made no progress");
    offset += written.bytesWritten;
  }
}

async function writeKnown(root: string, name: string, bytes: Uint8Array): Promise<BlobState> {
  const handle = await open(
    join(root, name),
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try { await writeAll(handle, bytes); await handle.sync(); await handle.chmod(0o400); }
  finally { await handle.close(); }
  await syncDirectory(root);
  return { name, facts: Object.freeze({ byteLength: bytes.byteLength, digest: sha256Bytes(bytes) }), published: false };
}

class OutputTransaction {
  readonly #paths: StorePaths;
  readonly #plan: FoundationExecutionOutputStagingPlanV1;
  readonly #root: string;
  readonly #manifest: BlobState;
  readonly #artifacts: ArtifactState[] = [];
  #descriptor: BlobState | null = null;
  #state: "open" | "poisoned" | "committed" | "aborted" = "open";
  #busy = false;
  #binding: FoundationExecutionOutputStoreBindingV1 | null = null;
  #plannedBytes = 0;

  private constructor(paths: StorePaths, plan: FoundationExecutionOutputStagingPlanV1, root: string, manifest: BlobState) {
    this.#paths = paths;
    this.#plan = plan;
    this.#root = root;
    this.#manifest = manifest;
  }

  static async create(paths: StorePaths, plan: FoundationExecutionOutputStagingPlanV1, manifestBytes: Uint8Array):
  Promise<OutputTransaction> {
    const root = join(paths.staging, `transaction-${randomUUID()}`);
    await mkdir(root, { mode: 0o700 });
    await chmod(root, 0o700);
    await syncDirectory(paths.staging);
    await exactDirectory(root, "Execution Output transaction root");
    return new OutputTransaction(paths, plan, root, await writeKnown(root, "manifest.json", manifestBytes));
  }

  facade(): FoundationExecutionOutputStoreTransactionV1 {
    return Object.freeze({ stage: this.stage.bind(this), commit: this.commit.bind(this), abort: this.abort.bind(this) });
  }

  #enter(operation: string, allowPoisoned = false): void {
    if (this.#busy || this.#state === "committed" || this.#state === "aborted" ||
        (this.#state === "poisoned" && !allowPoisoned)) {
      fail("transaction", `Execution Output transaction cannot ${operation} from its current condition`);
    }
    this.#busy = true;
  }

  #remaining(): BlobState[] {
    return [this.#manifest, ...this.#artifacts, ...(this.#descriptor === null ? [] : [this.#descriptor])]
      .filter((blob) => !blob.published);
  }

  async #assertInventory(): Promise<void> {
    await exactDirectory(this.#root, "Execution Output transaction root");
    if (canonicalJson((await readdir(this.#root)).sort()) !==
        canonicalJson(this.#remaining().map((blob) => blob.name).sort())) {
      fail("inventory", "Execution Output transaction contains unknown provisional entries");
    }
  }

  async #publish(blob: BlobState): Promise<void> {
    const location = blobLocation(this.#paths, blob.facts.digest);
    await ensureDirectory(location.shard, "Execution Output blob shard");
    if (blob.published) { await verifyFile(location.blob, blob.facts, "Execution Output blob"); return; }
    const provisional = join(this.#root, blob.name);
    await verifyFile(provisional, blob.facts, "Execution Output provisional blob");
    if (await exists(location.blob)) {
      await verifyFile(location.blob, blob.facts, "Execution Output blob");
      await unlink(provisional);
      blob.published = true;
      await syncDirectory(this.#root);
    } else {
      await rename(provisional, location.blob);
      blob.published = true;
      await syncDirectory(location.shard);
      await verifyFile(location.blob, blob.facts, "Execution Output blob");
    }
  }

  async stage(input: FoundationExecutionOutputStagingBindingV1 & Readonly<{
    bytes: AsyncIterable<Uint8Array>;
  }>): Promise<FoundationStagedExecutionOutputArtifactV1> {
    this.#enter("stage");
    try {
      if (!record(input) || !exactKeys(input, ["artifactIndex", "bindingDigest", "byteLength", "bytes", "digest"])) {
        fail("binding", "Execution Output stage input is not one exact closed value");
      }
      const binding = parseArtifact(Object.freeze({
        artifactIndex: input.artifactIndex,
        bindingDigest: input.bindingDigest,
        byteLength: input.byteLength,
        digest: input.digest,
      }), this.#plan);
      if (binding.artifactIndex !== this.#artifacts.length || input.bytes === null || typeof input.bytes !== "object" ||
          typeof input.bytes[Symbol.asyncIterator] !== "function") {
        fail("binding", "Execution Output artifacts must be staged once in exact Manifest order");
      }
      this.#plannedBytes += binding.byteLength;
      if (!Number.isSafeInteger(this.#plannedBytes) || this.#plannedBytes > this.#plan.carrierByteLength) {
        fail("limit", "Execution Output artifacts exceed the carrier plan");
      }
      await this.#assertInventory();
      const name = `artifact-${binding.artifactIndex.toString(10).padStart(8, "0")}.blob`;
      const handle = await open(
        join(this.#root, name),
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      const artifact: ArtifactState = { name, binding, facts: binding, cleanupFacts: null, staged: false, published: false };
      this.#artifacts.push(artifact);
      const hash = createHash("sha256");
      let observed = 0;
      let known = true;
      let actualDigest: Sha256 | null = null;
      try {
        for await (const raw of input.bytes) {
          if (!(raw instanceof Uint8Array) || raw.byteLength === 0 || raw.byteLength > binding.byteLength - observed) {
            fail("stream", "Execution Output artifact stream exceeds its exact byte contract");
          }
          const chunk = Uint8Array.from(raw);
          try { await writeAll(handle, chunk); } catch (error) { known = false; throw error; }
          observed += chunk.byteLength;
          hash.update(chunk);
        }
        actualDigest = `sha256:${hash.digest("hex")}`;
        artifact.cleanupFacts = Object.freeze({ byteLength: observed, digest: actualDigest });
        await handle.sync();
        await handle.chmod(0o400);
        if (observed !== binding.byteLength || actualDigest !== binding.digest) {
          fail("stream", "Execution Output artifact bytes do not match their exact binding");
        }
        artifact.staged = true;
      } catch (error) {
        this.#state = "poisoned";
        if (known && actualDigest === null) {
          actualDigest = `sha256:${hash.digest("hex")}`;
          artifact.cleanupFacts = Object.freeze({ byteLength: observed, digest: actualDigest });
        }
        await handle.sync().catch(() => undefined);
        await handle.chmod(0o400).catch(() => undefined);
        if (error instanceof FoundationError) throw error;
        fail("stream", "Execution Output artifact staging failed operationally");
      } finally { await handle.close(); }
      await syncDirectory(this.#root);
      const transaction = this;
      return Object.freeze({
        ...binding,
        async *read(): AsyncIterable<Uint8Array> { yield* transaction.read(binding); },
      });
    } catch (error) {
      if (this.#state === "open") this.#state = "poisoned";
      if (error instanceof FoundationError) throw error;
      fail("stage", "Execution Output staging failed operationally");
    } finally { this.#busy = false; }
  }

  async *read(binding: FoundationExecutionOutputStoreArtifactBindingV1): AsyncIterable<Uint8Array> {
    const artifact = this.#artifacts[binding.artifactIndex];
    if (artifact === undefined || canonicalJson(artifact.binding) !== canonicalJson(binding) || !artifact.staged ||
        this.#state === "aborted") fail("transaction", "Execution Output staged reader is unavailable");
    if (artifact.published || this.#state === "committed") {
      yield* verifiedBlob(this.#paths, binding);
    } else {
      await exactDirectory(this.#root, "Execution Output transaction root");
      yield* verifiedFile(join(this.#root, artifact.name), binding, "Execution Output provisional artifact");
    }
  }

  async commit(): Promise<FoundationExecutionOutputStoreBindingV1> {
    if (this.#state === "committed" && this.#binding !== null) return this.#binding;
    this.#enter("commit");
    try {
      if (this.#artifacts.length !== this.#plan.artifactCount || this.#plannedBytes !== this.#plan.carrierByteLength ||
          this.#artifacts.some((artifact) => !artifact.staged)) {
        fail("inventory", "Execution Output transaction does not match its exact plan");
      }
      await this.#assertInventory();
      for (const artifact of this.#artifacts) await this.#publish(artifact);
      await this.#publish(this.#manifest);
      const descriptor = compileDescriptor(
        this.#plan,
        this.#manifest.facts,
        Object.freeze(this.#artifacts.map((artifact) => artifact.binding)),
      );
      const descriptorBytes = Uint8Array.from(Buffer.from(canonicalJsonLine(descriptor), "utf8"));
      if (descriptorBytes.byteLength > FOUNDATION_EXECUTION_OUTPUT_STORE_LIMITS_V1.maximumDescriptorBytes) {
        fail("limit", "Execution Output descriptor exceeds its exact private bound");
      }
      const facts = Object.freeze({ byteLength: descriptorBytes.byteLength, digest: sha256Bytes(descriptorBytes) });
      if (this.#descriptor === null) this.#descriptor = await writeKnown(this.#root, "descriptor.json", descriptorBytes);
      else if (canonicalJson(this.#descriptor.facts) !== canonicalJson(facts)) {
        fail("substitution", "Execution Output descriptor changed during retry");
      }
      await this.#publish(this.#descriptor);
      if ((await readdir(this.#root)).length !== 0) fail("inventory", "Execution Output staging is not empty");
      await rmdir(this.#root);
      await syncDirectory(this.#paths.staging);
      this.#binding = compileBinding(this.#descriptor.facts);
      this.#state = "committed";
      return this.#binding;
    } catch (error) {
      if (error instanceof FoundationError) throw error;
      fail("publication", "Execution Output publication failed operationally");
    } finally { this.#busy = false; }
  }

  async abort(): Promise<void> {
    if (this.#state === "aborted") return;
    this.#enter("abort", true);
    try {
      await this.#assertInventory();
      const remaining = this.#remaining();
      const facts = remaining.map((blob) => "binding" in blob ? (blob as ArtifactState).cleanupFacts : blob.facts);
      if (facts.some((selected) => selected === null)) {
        fail("inventory", "Execution Output abort lacks exact provisional byte facts");
      }
      for (let index = 0; index < remaining.length; index += 1) {
        await verifyFile(join(this.#root, remaining[index]!.name), facts[index]!, "Execution Output provisional blob");
      }
      for (const blob of remaining) await unlink(join(this.#root, blob.name));
      await syncDirectory(this.#root);
      await rmdir(this.#root);
      await syncDirectory(this.#paths.staging);
      this.#state = "aborted";
    } catch (error) {
      if (error instanceof FoundationError) throw error;
      fail("abort", "Execution Output transaction could not abort exactly");
    } finally { this.#busy = false; }
  }
}

/** Blob existence has no Process standing; only a retained private binding selects bytes. */
export function createFoundationExecutionOutputStoreV1(input: Readonly<{
  machineHome: string;
}>): FoundationExecutionOutputStoreV1 {
  if (!record(input) || !exactKeys(input, ["machineHome"]) || typeof input.machineHome !== "string" ||
      input.machineHome.length === 0) {
    fail("configuration", "Execution Output Store configuration is not one exact closed value");
  }
  const machineHome = resolve(input.machineHome);
  return Object.freeze({
    async begin(beginInput) {
      try {
        if (!record(beginInput) || !exactKeys(beginInput, ["manifestBytes", "plan"])) {
          fail("binding", "Execution Output Store begin input is not one exact closed value");
        }
        const plan = parsePlan(beginInput.plan);
        const manifest = canonicalBytes(
          beginInput.manifestBytes,
          FOUNDATION_EXECUTION_OUTPUT_STORE_LIMITS_V1.maximumManifestBytes,
          "Execution Output Manifest",
        );
        if (!record(manifest.value) || manifest.value.digest !== plan.manifestDigest) {
          fail("binding", "Execution Output Manifest bytes do not match the staging plan");
        }
        return (await OutputTransaction.create(await ensurePaths(machineHome), plan, manifest.bytes)).facade();
      } catch (error) {
        if (error instanceof FoundationError) throw error;
        fail("begin", "Execution Output Store could not begin private staging");
      }
    },
    async reopen(binding) {
      try { return await reopen(machineHome, binding); }
      catch (error) {
        if (error instanceof FoundationError) throw error;
        fail("reopen", "Execution Output Store could not reopen private bytes");
      }
    },
  });
}
