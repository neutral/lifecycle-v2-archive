import { createHash } from "node:crypto";
import { FoundationError } from "../error.js";
import {
  canonicalJson,
  canonicalJsonLine,
  digestCanonical,
  selfDigest,
  type Sha256,
} from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import { assertFoundationSchema } from "../validation/schema-engine.js";
import type {
  FoundationExecutionOutputEntryReaderV1,
  FoundationRetrievedExecutionOutputV1,
} from "./backend.js";
import {
  parseFoundationExecutionBackendProfile,
  parseFoundationExecutionSpecification,
  type FoundationExecutionBackendProfileV1,
  type FoundationExecutionOutputPurposeV1,
  type FoundationExecutionOutputManifestEntryV1,
  type FoundationExecutionOutputManifestV1,
  type FoundationExecutionSpecificationV1,
} from "./contracts.js";
import { parseFoundationExecutionOutputStoreBindingV1 } from "./output-store-v1.js";
import type {
  FoundationExecutionOutputStoreBindingV1,
  FoundationExecutionOutputStoreDescriptorV1,
  FoundationExecutionOutputStoreV1,
} from "./output-store-v1.js";

const EXECUTION_OUTPUT_MANIFEST_SCHEMA_ID =
  "urn:lifecycle:schema:execution-output-manifest:v1";
const VALIDATED_ARTIFACT_READ_CHUNK_BYTES = 64 * 1024;
const OUTPUT_PURPOSES_BY_OWNER = Object.freeze({
  "agent-attempt": new Set([
    "candidate-output",
    "agent-work-product",
    "raw-provider-output",
    "operational-artifact",
  ]),
  check: new Set([
    "check-proof",
    "raw-check-output",
    "operational-artifact",
  ]),
} as const);

type FoundationValidatedExecutionOutputArtifactCommonV1 = Readonly<{
  path: string;
  entryKind: "file";
  mediaType: string;
  modeClass: FoundationExecutionOutputManifestEntryV1["modeClass"];
  byteLength: number;
  digest: Sha256;
  /** Reopens immutable verified bytes; each yielded chunk is a fresh copy. */
  read(): AsyncIterable<Uint8Array>;
}>;

export type FoundationValidatedCandidateOutputArtifactV1 =
  FoundationValidatedExecutionOutputArtifactCommonV1 & Readonly<{
    purpose: "candidate-output";
    /** Exact repository path after stripping the one declared Candidate root. */
    candidateRepositoryPath: string;
    candidateGitMode: "100644" | "100755";
  }>;

export type FoundationValidatedNonCandidateOutputArtifactV1 =
  FoundationValidatedExecutionOutputArtifactCommonV1 & Readonly<{
    purpose: Exclude<FoundationExecutionOutputPurposeV1, "candidate-output">;
    candidateRepositoryPath: null;
    candidateGitMode: null;
  }>;

export type FoundationValidatedExecutionOutputArtifactV1 =
  | FoundationValidatedCandidateOutputArtifactV1
  | FoundationValidatedNonCandidateOutputArtifactV1;

/** Closed complete successor repository tree, never a changed-path delta. */
export type FoundationValidatedCandidateOutputV1 = Readonly<{
  declaredRootPath: string;
  entries: readonly FoundationValidatedCandidateOutputArtifactV1[];
}>;

export type FoundationValidatedExecutionOutputV1 = Readonly<{
  manifest: FoundationExecutionOutputManifestV1;
  carrierByteLength: number;
  artifacts: readonly FoundationValidatedExecutionOutputArtifactV1[];
  candidateOutput: FoundationValidatedCandidateOutputV1 | null;
}>;

export type FoundationValidatedExecutionOutputResultV1 = Readonly<{
  output: FoundationValidatedExecutionOutputV1;
  outputStoreBinding: FoundationExecutionOutputStoreBindingV1;
}>;

export type FoundationExecutionOutputStagingPlanV1 = Readonly<{
  manifestDigest: Sha256;
  carrierByteLength: number;
  artifactCount: number;
}>;

export type FoundationExecutionOutputStagingBindingV1 = Readonly<{
  artifactIndex: number;
  bindingDigest: Sha256;
  byteLength: number;
  digest: Sha256;
}>;

/**
 * Provisional, locator-free byte reader returned by the Runtime's private
 * staging owner. The reader is available before commit for independent replay
 * validation and remains immutable and reopenable after commit.
 */
export type FoundationStagedExecutionOutputArtifactV1 =
  FoundationExecutionOutputStagingBindingV1 & Readonly<{
    read(): AsyncIterable<Uint8Array>;
  }>;

/**
 * Private bounded byte staging. `stage` must consume the supplied stream before
 * resolving. `commit` publishes one closed Store binding after immutable blobs
 * are available. A rejected commit leaves its exact remaining provisional
 * inventory abortable; unselected content-addressed blobs have no standing.
 */
export type FoundationExecutionOutputStagingTransactionV1 = Readonly<{
  stage(input: FoundationExecutionOutputStagingBindingV1 & Readonly<{
    bytes: AsyncIterable<Uint8Array>;
  }>): Promise<FoundationStagedExecutionOutputArtifactV1>;
  commit(): Promise<FoundationExecutionOutputStoreBindingV1>;
  abort(): Promise<void>;
}>;

/** Runtime-private storage mechanism; it exposes no physical locator. */
export type FoundationExecutionOutputStagingV1 = Readonly<{
  begin(input: Readonly<{
    plan: FoundationExecutionOutputStagingPlanV1,
    manifestBytes: Uint8Array;
  }>): Promise<FoundationExecutionOutputStagingTransactionV1>;
}>;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.execution.output-validation.${code}`, message);
}

const DETERMINISTIC_EXECUTION_OUTPUT_REFUSAL_CODE_VALUES = Object.freeze([
  "lifecycle.schema.invalid",
  "lifecycle.execution.output-validation.aggregate-count",
  "lifecycle.execution.output-validation.aggregate-limit",
  "lifecycle.execution.output-validation.binding",
  "lifecycle.execution.output-validation.byte-digest",
  "lifecycle.execution.output-validation.candidate-path",
  "lifecycle.execution.output-validation.candidate-writes",
  "lifecycle.execution.output-validation.carrier-bytes",
  "lifecycle.execution.output-validation.chunk",
  "lifecycle.execution.output-validation.duplicate-entry",
  "lifecycle.execution.output-validation.entry-binding",
  "lifecycle.execution.output-validation.entry-count",
  "lifecycle.execution.output-validation.entry-limit",
  "lifecycle.execution.output-validation.entry-order",
  "lifecycle.execution.output-validation.entry-reader",
  "lifecycle.execution.output-validation.extra-entry",
  "lifecycle.execution.output-validation.inventory-digest",
  "lifecycle.execution.output-validation.limit",
  "lifecycle.execution.output-validation.manifest-digest",
  "lifecycle.execution.output-validation.mode",
  "lifecycle.execution.output-validation.owner-semantic",
  "lifecycle.execution.output-validation.oversized-chunk",
  "lifecycle.execution.output-validation.path",
  "lifecycle.execution.output-validation.path-alias",
  "lifecycle.execution.output-validation.purpose",
  "lifecycle.execution.output-validation.required-root",
  "lifecycle.execution.output-validation.root",
  "lifecycle.execution.output-validation.root-limit",
] as const);

type FoundationDeterministicExecutionOutputRefusalCodeV1 =
  (typeof DETERMINISTIC_EXECUTION_OUTPUT_REFUSAL_CODE_VALUES)[number];

const AUTHORITATIVE_UNAVAILABLE_EXECUTION_OUTPUT_CODE =
  "lifecycle.execution.output-validation.partial" as const;

const DETERMINISTIC_EXECUTION_OUTPUT_REFUSAL_CODES = new Set<string>(
  DETERMINISTIC_EXECUTION_OUTPUT_REFUSAL_CODE_VALUES,
);

export type FoundationExecutionOutputValidationFailureClassificationV1 =
  | Readonly<{
      disposition: "invalid";
      code: FoundationDeterministicExecutionOutputRefusalCodeV1;
      diagnosticsDigest: Sha256 | null;
    }>
  | Readonly<{
      disposition: "unavailable";
      code: typeof AUTHORITATIVE_UNAVAILABLE_EXECUTION_OUTPUT_CODE;
      diagnosticsDigest: Sha256 | null;
    }>
  | Readonly<{ disposition: "recoverable" }>;

/**
 * Closed private classification for finalization. Exact deterministic Carrier
 * or Manifest refusals become `invalid`; an exact short read becomes
 * `unavailable`; Store, staging, unknown stream, and other unknown failures
 * remain recoverable.
 */
export function classifyFoundationExecutionOutputValidationFailure(
  error: unknown,
): FoundationExecutionOutputValidationFailureClassificationV1 {
  if (!(error instanceof FoundationError)) {
    return Object.freeze({ disposition: "recoverable" });
  }
  const diagnosticsDigest = error.diagnostics.length === 0
    ? null
    : digestCanonical(error.diagnostics);
  if (error.code === AUTHORITATIVE_UNAVAILABLE_EXECUTION_OUTPUT_CODE) {
    return Object.freeze({
      disposition: "unavailable",
      code: AUTHORITATIVE_UNAVAILABLE_EXECUTION_OUTPUT_CODE,
      diagnosticsDigest,
    });
  }
  if (!DETERMINISTIC_EXECUTION_OUTPUT_REFUSAL_CODES.has(error.code)) {
    return Object.freeze({ disposition: "recoverable" });
  }
  return Object.freeze({
    disposition: "invalid",
    code: error.code as FoundationDeterministicExecutionOutputRefusalCodeV1,
    diagnosticsDigest,
  });
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}

function exactManifest(value: unknown): FoundationExecutionOutputManifestV1 {
  assertFoundationSchema(
    EXECUTION_OUTPUT_MANIFEST_SCHEMA_ID,
    value,
    "Execution Output Manifest",
  );
  const manifest = deepFreeze(
    JSON.parse(canonicalJson(value)) as FoundationExecutionOutputManifestV1,
  );
  if (manifest.digest !== selfDigest(manifest as unknown as Record<string, unknown>)) {
    fail("manifest-digest", "Execution Output Manifest self-digest does not match its exact value");
  }
  return manifest;
}

function assertDigest(value: unknown, label: string): asserts value is Sha256 {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    fail("binding", `${label} is not one lowercase SHA-256 digest`);
  }
}

function safeAdd(left: number, right: number, label: string): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) {
    fail("limit", `${label} exceeds the safe integer domain`);
  }
  return total;
}

function sameKeys(value: object, expected: readonly string[]): boolean {
  if (Object.getOwnPropertySymbols(value).length !== 0) return false;
  const keys = Object.getOwnPropertyNames(value).sort(compareCodePoints);
  return canonicalJson(keys) === canonicalJson([...expected].sort(compareCodePoints));
}

function boundMethod<T extends (...args: never[]) => unknown>(
  owner: object,
  name: string,
  label: string,
): T {
  let selected: unknown;
  try {
    selected = (owner as Record<string, unknown>)[name];
  } catch {
    fail("staging", `${label} could not be observed exactly once`);
  }
  if (typeof selected !== "function") {
    fail("staging", `${label} is not callable`);
  }
  return selected.bind(owner) as T;
}

function stagingBegin(
  value: FoundationExecutionOutputStagingV1,
): FoundationExecutionOutputStagingV1["begin"] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("staging", "Execution Output staging owner is unavailable");
  }
  return boundMethod(value, "begin", "Execution Output staging begin");
}

type StagingTransactionSnapshot = Readonly<{
  stage: FoundationExecutionOutputStagingTransactionV1["stage"];
  commit: FoundationExecutionOutputStagingTransactionV1["commit"];
  abort: FoundationExecutionOutputStagingTransactionV1["abort"];
}>;

function stagingTransaction(
  value: FoundationExecutionOutputStagingTransactionV1,
): StagingTransactionSnapshot {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("staging", "Execution Output staging did not return one private transaction");
  }
  return Object.freeze({
    stage: boundMethod<FoundationExecutionOutputStagingTransactionV1["stage"]>(
      value,
      "stage",
      "Execution Output staging write",
    ),
    commit: boundMethod<FoundationExecutionOutputStagingTransactionV1["commit"]>(
      value,
      "commit",
      "Execution Output staging commit",
    ),
    abort: boundMethod<FoundationExecutionOutputStagingTransactionV1["abort"]>(
      value,
      "abort",
      "Execution Output staging abort",
    ),
  });
}

function canonicalManifestBytes(manifest: FoundationExecutionOutputManifestV1): Uint8Array {
  return Uint8Array.from(Buffer.from(canonicalJsonLine(manifest), "utf8"));
}

function parseCanonicalManifestBytes(bytes: unknown): FoundationExecutionOutputManifestV1 {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1) {
    fail("staging-store-manifest", "Execution Output Store did not reopen Manifest bytes");
  }
  const text = Buffer.from(bytes).toString("utf8");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    fail("staging-store-manifest", "Reopened Execution Output Manifest is not JSON");
  }
  const canonical = Buffer.from(canonicalJsonLine(value), "utf8");
  if (!Buffer.from(bytes).equals(canonical)) {
    fail("staging-store-manifest", "Reopened Execution Output Manifest is not canonical JSON");
  }
  return exactManifest(value);
}

function reopenedStoreSnapshot(
  value: unknown,
  selectedBinding: FoundationExecutionOutputStoreBindingV1,
): Readonly<{
  descriptor: FoundationExecutionOutputStoreDescriptorV1;
  manifestBytes: Uint8Array;
  artifacts: readonly unknown[];
}> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      !sameKeys(value, ["artifacts", "binding", "descriptor", "manifestBytes"])) {
    fail("staging-store-reopen", "Execution Output Store reopened a non-closed value");
  }
  const opened = value as Record<string, unknown>;
  const reopenedBinding = parseFoundationExecutionOutputStoreBindingV1(opened.binding);
  if (canonicalJson(reopenedBinding) !== canonicalJson(selectedBinding)) {
    fail("staging-store-reopen", "Execution Output Store reopened another binding");
  }
  if (!(opened.manifestBytes instanceof Uint8Array) || !Array.isArray(opened.artifacts) ||
      opened.descriptor === null || typeof opened.descriptor !== "object" ||
      Array.isArray(opened.descriptor)) {
    fail("staging-store-reopen", "Execution Output Store reopened incomplete content");
  }
  return Object.freeze({
    descriptor: opened.descriptor as FoundationExecutionOutputStoreDescriptorV1,
    manifestBytes: Uint8Array.from(opened.manifestBytes),
    artifacts: Object.freeze([...opened.artifacts]),
  });
}

function transportSnapshot(
  output: FoundationRetrievedExecutionOutputV1,
): FoundationRetrievedExecutionOutputV1 {
  if (output === null || typeof output !== "object" || Array.isArray(output) ||
      !sameKeys(output, ["carrierByteLength", "entries", "manifest"])) {
    fail("transport", "Retrieved Execution Output is not one exact closed transport reader");
  }
  let carrierByteLength: number;
  let manifest: FoundationExecutionOutputManifestV1;
  let entries: () => AsyncIterable<FoundationExecutionOutputEntryReaderV1>;
  try {
    carrierByteLength = output.carrierByteLength;
    manifest = output.manifest;
    entries = output.entries;
  } catch {
    fail("transport", "Retrieved Execution Output metadata could not be observed exactly once");
  }
  if (typeof entries !== "function") {
    fail("transport", "Retrieved Execution Output entry reader is not callable");
  }
  return Object.freeze({
    carrierByteLength,
    manifest,
    entries: entries.bind(output),
  });
}

function readerSnapshot(value: unknown): FoundationExecutionOutputEntryReaderV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      !sameKeys(value, ["byteLength", "digest", "path", "read"])) {
    fail("entry-reader", "Execution Output entry reader is not one exact closed object");
  }
  const reader = value as FoundationExecutionOutputEntryReaderV1;
  let path: string;
  let byteLength: number;
  let digest: Sha256;
  let read: () => AsyncIterable<Uint8Array>;
  try {
    path = reader.path;
    byteLength = reader.byteLength;
    digest = reader.digest;
    read = reader.read;
  } catch {
    fail(
      "entry-reader-interrupted",
      "Execution Output entry reader metadata could not be observed exactly once",
    );
  }
  if (typeof path !== "string" ||
      !Number.isSafeInteger(byteLength) || byteLength < 0 ||
      typeof digest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(digest) ||
      typeof read !== "function") {
    fail("entry-reader", "Execution Output entry reader metadata is invalid");
  }
  return Object.freeze({
    path,
    byteLength,
    digest,
    read: read.bind(reader),
  });
}

function assertPath(path: string, aliases: Set<string>, paths: Set<string>): void {
  if (Buffer.byteLength(path, "utf8") > 4096 || path.includes("?") || path.includes("#") ||
      /%2f|%5c/iu.test(path)) {
    fail("path", "Execution Output entry path violates portable repository-path rules");
  }
  const alias = path.normalize("NFC").toLowerCase();
  if (aliases.has(alias)) {
    fail("path-alias", "Execution Output entry paths contain a case or normalization alias");
  }
  aliases.add(alias);
  paths.add(path);
}

function candidateRepositoryPath(entryPath: string, declaredRootPath: string): string {
  const prefix = `${declaredRootPath}/`;
  if (!entryPath.startsWith(prefix)) {
    fail(
      "candidate-path",
      "Candidate output entries must be files strictly below the one declared Candidate root",
    );
  }
  const repositoryPath = entryPath.slice(prefix.length);
  if (repositoryPath.length === 0 || Buffer.byteLength(repositoryPath, "utf8") > 4096 ||
      repositoryPath.startsWith("/") || repositoryPath.includes("\\") ||
      repositoryPath.includes("//") || repositoryPath.includes("?") ||
      repositoryPath.includes("#") || /%2f|%5c/iu.test(repositoryPath) ||
      repositoryPath.split("/").some((part) => part === "" || part === "." || part === "..")) {
    fail(
      "candidate-path",
      "Candidate output does not map to one nonempty normalized repository path",
    );
  }
  return repositoryPath;
}

function candidateOutputRootPath(
  specification: FoundationExecutionSpecificationV1,
): string | null {
  const roots = specification.outputContract.declaredOutputRoots.filter(
    ({ purpose }) => purpose === "candidate-output",
  );
  if (roots.length === 0) return null;
  if (roots.length !== 1) {
    fail(
      "candidate-writes",
      "Candidate output does not bind one exact complete-tree root",
    );
  }
  return roots[0]!.path;
}

function assertNoPathPrefixCollisions(paths: ReadonlySet<string>): void {
  for (const path of paths) {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      if (paths.has(segments.slice(0, index).join("/"))) {
        fail("path-alias", "Execution Output inventories a file as another file's directory");
      }
    }
  }
}

function assertManifestBindings(
  manifest: FoundationExecutionOutputManifestV1,
  specification: FoundationExecutionSpecificationV1,
  runnerDigest: Sha256,
): void {
  if (manifest.specificationDigest !== specification.digest ||
      manifest.inputSetDigest !== specification.inputSet.digest ||
      manifest.imageDigest !== specification.image.imageDigest ||
      manifest.outputContractDigest !== specification.outputContract.digest ||
      manifest.runnerDigest !== runnerDigest) {
    fail(
      "binding",
      "Execution Output Manifest does not bind the exact Specification, Input Set, Image, output contract, and runner",
    );
  }
}

type RootCounters = { entries: number; bytes: number };

function assertPurposeOwner(
  purpose: FoundationExecutionOutputManifestEntryV1["purpose"],
  specification: FoundationExecutionSpecificationV1,
): void {
  if (!OUTPUT_PURPOSES_BY_OWNER[specification.owner.kind].has(purpose)) {
    fail("purpose", "Execution Output purpose does not belong to the selected operation owner");
  }
  if (purpose === "candidate-output" &&
      (!specification.capabilities.candidateWrites ||
        specification.owner.kind !== "agent-attempt" ||
        specification.operation.kind !== "agent-attempt" ||
        specification.operation.role !== "builder")) {
    fail("candidate-writes", "Candidate output requires an exact builder Candidate-write capability");
  }
}

function validateManifestInventory(
  manifest: FoundationExecutionOutputManifestV1,
  specification: FoundationExecutionSpecificationV1,
  profile: FoundationExecutionBackendProfileV1,
): void {
  const candidateRootPath = candidateOutputRootPath(specification);
  const maximumEntries = Math.min(
    specification.limits.outputEntries,
    profile.limits.maximumOutputEntries,
  );
  const maximumBytes = Math.min(
    specification.limits.outputBytes,
    profile.limits.maximumOutputBytes,
  );
  if (manifest.entries.length > maximumEntries || manifest.entryCount > maximumEntries) {
    fail("entry-limit", "Execution Output Manifest exceeds its effective entry limit");
  }
  if (manifest.aggregateByteLength > maximumBytes) {
    fail("aggregate-limit", "Execution Output Manifest exceeds its effective byte limit");
  }
  if (manifest.entryCount !== manifest.entries.length) {
    fail("entry-count", "Execution Output Manifest entry count does not match its inventory");
  }
  if (manifest.entryInventoryDigest !== digestCanonical(manifest.entries)) {
    fail("inventory-digest", "Execution Output Manifest inventory digest does not match its entries");
  }

  const aliases = new Set<string>();
  const paths = new Set<string>();
  const counters: RootCounters[] = specification.outputContract.declaredOutputRoots
    .map(() => ({ entries: 0, bytes: 0 }));
  let aggregate = 0;
  for (let index = 0; index < manifest.entries.length; index += 1) {
    const entry = manifest.entries[index]!;
    if (index > 0 && compareCodePoints(manifest.entries[index - 1]!.path, entry.path) >= 0) {
      fail("entry-order", "Execution Output Manifest entries are not strictly path ordered");
    }
    assertPath(entry.path, aliases, paths);
    aggregate = safeAdd(aggregate, entry.byteLength, "Execution Output aggregate bytes");
    if (entry.byteLength > specification.limits.outputEntryBytes ||
        entry.byteLength > profile.limits.maximumOutputEntryBytes) {
      fail("entry-limit", "Execution Output entry exceeds its effective per-stream byte limit");
    }
    if (!specification.outputContract.allowedModeClasses.includes(entry.modeClass) ||
        !profile.outputPolicy.allowedModeClasses.includes(entry.modeClass)) {
      fail("mode", "Execution Output entry mode is not selected by the output policies");
    }
    assertPurposeOwner(entry.purpose, specification);
    const matchingRoots = specification.outputContract.declaredOutputRoots
      .map((root, rootIndex) => ({ root, rootIndex }))
      .filter(({ root }) => entry.path === root.path || entry.path.startsWith(`${root.path}/`));
    if (matchingRoots.length !== 1) {
      fail("root", "Execution Output entry does not match exactly one declared output root");
    }
    const { root, rootIndex } = matchingRoots[0]!;
    if (entry.purpose !== root.purpose) {
      fail("purpose", "Execution Output entry purpose differs from its declared output root");
    }
    if (!root.allowedModeClasses.includes(entry.modeClass)) {
      fail("mode", "Execution Output entry mode is not allowed by its declared output root");
    }
    if (entry.purpose === "candidate-output") {
      if (candidateRootPath === null || root.path !== candidateRootPath) {
        fail("candidate-writes", "Candidate output differs from its exact declared root");
      }
      candidateRepositoryPath(entry.path, candidateRootPath);
    }
    const counter = counters[rootIndex]!;
    counter.entries += 1;
    counter.bytes = safeAdd(counter.bytes, entry.byteLength, "Declared output root bytes");
    if (counter.entries > root.maximumEntries || counter.bytes > root.maximumBytes) {
      fail("root-limit", "Execution Output entry exceeds its declared output-root bounds");
    }
  }
  assertNoPathPrefixCollisions(paths);
  if (aggregate !== manifest.aggregateByteLength) {
    fail("aggregate-count", "Execution Output Manifest aggregate bytes do not match its entries");
  }
  for (let index = 0; index < specification.outputContract.declaredOutputRoots.length; index += 1) {
    const root = specification.outputContract.declaredOutputRoots[index]!;
    assertPurposeOwner(root.purpose, specification);
    if (root.required && counters[index]!.entries === 0) {
      fail("required-root", "Execution Output omits one required declared output root");
    }
  }
}

type SourceValidationState = {
  opened: boolean;
  complete: boolean;
  observedBytes: number;
  failure: FoundationError | null;
};

function outputFailure(code: string, message: string): FoundationError {
  return new FoundationError(`lifecycle.execution.output-validation.${code}`, message);
}

async function* validatedSourceChunks(input: Readonly<{
  reader: FoundationExecutionOutputEntryReaderV1;
  entry: FoundationExecutionOutputManifestEntryV1;
  remainingAggregateBytes: number;
  state: SourceValidationState;
}>): AsyncIterable<Uint8Array> {
  const { reader, entry, state } = input;
  if (state.opened) {
    const failure = outputFailure(
      "staging-consumption",
      "Execution Output staging attempted to consume one source stream more than once",
    );
    state.failure = failure;
    throw failure;
  }
  state.opened = true;
  const hash = createHash("sha256");
  let stream: AsyncIterable<Uint8Array>;
  try {
    stream = reader.read();
  } catch {
    const failure = outputFailure("stream", "Execution Output entry stream could not be opened");
    state.failure = failure;
    throw failure;
  }
  if (stream === null || typeof stream !== "object" ||
      typeof stream[Symbol.asyncIterator] !== "function") {
    const failure = outputFailure(
      "stream",
      "Execution Output entry reader did not return an asynchronous byte stream",
    );
    state.failure = failure;
    throw failure;
  }
  try {
    for await (const chunk of stream) {
      if (!(chunk instanceof Uint8Array)) {
        throw outputFailure("chunk", "Execution Output entry stream yielded a non-byte chunk");
      }
      if (chunk.byteLength === 0) {
        throw outputFailure("chunk", "Execution Output entry stream yielded an empty chunk");
      }
      if (chunk.byteLength > entry.byteLength - state.observedBytes ||
          chunk.byteLength > input.remainingAggregateBytes - state.observedBytes) {
        throw outputFailure(
          "oversized-chunk",
          "Execution Output entry stream exceeded its declared byte bounds",
        );
      }
      for (let offset = 0; offset < chunk.byteLength;
        offset += VALIDATED_ARTIFACT_READ_CHUNK_BYTES) {
        const exact = Uint8Array.from(chunk.subarray(
          offset,
          Math.min(chunk.byteLength, offset + VALIDATED_ARTIFACT_READ_CHUNK_BYTES),
        ));
        hash.update(exact);
        state.observedBytes = safeAdd(
          state.observedBytes,
          exact.byteLength,
          "Observed Execution Output entry bytes",
        );
        yield exact;
      }
    }
    if (state.observedBytes !== entry.byteLength) {
      throw outputFailure(
        "partial",
        "Execution Output entry stream ended before its declared byte length",
      );
    }
    const observedDigest = `sha256:${hash.digest("hex")}` as Sha256;
    if (observedDigest !== entry.digest) {
      throw outputFailure(
        "byte-digest",
        "Execution Output entry bytes do not match their declared digest",
      );
    }
    state.complete = true;
  } catch (error) {
    const failure = error instanceof FoundationError
      ? error
      : outputFailure("stream", "Execution Output entry stream ended with an operational failure");
    state.failure = failure;
    throw failure;
  }
}

function stagedArtifactSnapshot(
  value: FoundationStagedExecutionOutputArtifactV1,
  expected: FoundationExecutionOutputStagingBindingV1,
): FoundationStagedExecutionOutputArtifactV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      !sameKeys(value, ["artifactIndex", "bindingDigest", "byteLength", "digest", "read"])) {
    fail("staging-binding", "Execution Output staging returned a non-closed artifact binding");
  }
  let artifactIndex: number;
  let bindingDigest: Sha256;
  let byteLength: number;
  let digest: Sha256;
  let read: () => AsyncIterable<Uint8Array>;
  try {
    artifactIndex = value.artifactIndex;
    bindingDigest = value.bindingDigest;
    byteLength = value.byteLength;
    digest = value.digest;
    read = value.read;
  } catch {
    fail("staging-binding", "Execution Output staged artifact could not be observed exactly once");
  }
  if (artifactIndex !== expected.artifactIndex || bindingDigest !== expected.bindingDigest ||
      byteLength !== expected.byteLength || digest !== expected.digest || typeof read !== "function") {
    fail("staging-binding", "Execution Output staged artifact substituted its exact byte binding");
  }
  return Object.freeze({
    artifactIndex,
    bindingDigest,
    byteLength,
    digest,
    read: read.bind(value),
  });
}

async function* verifiedStagedChunks(
  staged: FoundationStagedExecutionOutputArtifactV1,
  entry: FoundationExecutionOutputManifestEntryV1,
): AsyncIterable<Uint8Array> {
  let stream: AsyncIterable<Uint8Array>;
  try {
    stream = staged.read();
  } catch {
    fail("staging-replay", "Execution Output staged artifact could not be reopened");
  }
  if (stream === null || typeof stream !== "object" ||
      typeof stream[Symbol.asyncIterator] !== "function") {
    fail("staging-replay", "Execution Output staged artifact did not reopen as a byte stream");
  }
  const hash = createHash("sha256");
  let observed = 0;
  try {
    for await (const chunk of stream) {
      if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0) {
        fail("staging-replay", "Execution Output staged artifact yielded an invalid byte chunk");
      }
      if (chunk.byteLength > entry.byteLength - observed) {
        fail("staging-substitution", "Execution Output staged artifact exceeded its exact byte length");
      }
      for (let offset = 0; offset < chunk.byteLength;
        offset += VALIDATED_ARTIFACT_READ_CHUNK_BYTES) {
        const exact = Uint8Array.from(chunk.subarray(
          offset,
          Math.min(chunk.byteLength, offset + VALIDATED_ARTIFACT_READ_CHUNK_BYTES),
        ));
        hash.update(exact);
        observed = safeAdd(observed, exact.byteLength, "Reopened Execution Output artifact bytes");
        yield exact;
      }
    }
  } catch (error) {
    if (error instanceof FoundationError) throw error;
    fail("staging-replay", "Execution Output staged artifact replay failed operationally");
  }
  if (observed !== entry.byteLength ||
      `sha256:${hash.digest("hex")}` !== entry.digest) {
    fail("staging-substitution", "Execution Output staged artifact bytes changed after validation");
  }
}

function validatedArtifact(
  entry: FoundationExecutionOutputManifestEntryV1,
  staged: FoundationStagedExecutionOutputArtifactV1,
  candidateRootPath: string | null,
): FoundationValidatedExecutionOutputArtifactV1 {
  const common = {
    ...entry,
    read() {
      return verifiedStagedChunks(staged, entry);
    },
  };
  if (entry.purpose === "candidate-output") {
    if (candidateRootPath === null) {
      fail("candidate-writes", "Candidate output lacks its exact declared root");
    }
    return Object.freeze({
      ...common,
      purpose: "candidate-output" as const,
      candidateRepositoryPath: candidateRepositoryPath(entry.path, candidateRootPath),
      candidateGitMode: entry.modeClass === "regular" ? "100644" as const : "100755" as const,
    });
  }
  return Object.freeze({
    ...common,
    purpose: entry.purpose,
    candidateRepositoryPath: null,
    candidateGitMode: null,
  }) as FoundationValidatedNonCandidateOutputArtifactV1;
}

function validatedCandidateOutput(
  candidateRootPath: string | null,
  artifacts: readonly FoundationValidatedExecutionOutputArtifactV1[],
): FoundationValidatedCandidateOutputV1 | null {
  const entries = artifacts.filter(
    (artifact): artifact is FoundationValidatedCandidateOutputArtifactV1 =>
      artifact.purpose === "candidate-output",
  );
  if (candidateRootPath === null) {
    if (entries.length !== 0) {
      fail("candidate-writes", "Candidate output exists without one exact declared root");
    }
    return null;
  }
  if (entries.length === 0) return null;
  return Object.freeze({
    declaredRootPath: candidateRootPath,
    entries: Object.freeze(entries),
  });
}

function stagingBindingFor(
  entry: FoundationExecutionOutputManifestEntryV1,
  artifactIndex: number,
): FoundationExecutionOutputStagingBindingV1 {
  return Object.freeze({
    artifactIndex,
    bindingDigest: digestCanonical(entry),
    byteLength: entry.byteLength,
    digest: entry.digest,
  });
}

async function stageEntryBytes(input: Readonly<{
  transaction: StagingTransactionSnapshot;
  reader: FoundationExecutionOutputEntryReaderV1;
  entry: FoundationExecutionOutputManifestEntryV1;
  candidateRootPath: string | null;
  artifactIndex: number;
  remainingAggregateBytes: number;
}>): Promise<Readonly<{
  artifact: FoundationValidatedExecutionOutputArtifactV1;
  byteLength: number;
}>> {
  const { reader, entry } = input;
  if (reader.path !== entry.path || reader.byteLength !== entry.byteLength ||
      reader.digest !== entry.digest) {
    fail("entry-binding", "Execution Output entry reader does not bind its exact Manifest entry");
  }
  const binding = stagingBindingFor(entry, input.artifactIndex);
  const state: SourceValidationState = {
    opened: false,
    complete: false,
    observedBytes: 0,
    failure: null,
  };
  let stagedValue: FoundationStagedExecutionOutputArtifactV1;
  try {
    stagedValue = await input.transaction.stage(Object.freeze({
      ...binding,
      bytes: validatedSourceChunks({
        reader,
        entry,
        remainingAggregateBytes: input.remainingAggregateBytes,
        state,
      }),
    }));
  } catch (error) {
    if (state.failure !== null) throw state.failure;
    if (error instanceof FoundationError) throw error;
    fail("staging-write", "Execution Output private staging failed while consuming bytes");
  }
  if (state.failure !== null) throw state.failure;
  if (!state.complete) {
    fail("staging-consumption", "Execution Output staging resolved before consuming the exact source stream");
  }
  const staged = stagedArtifactSnapshot(stagedValue, binding);
  for await (const _chunk of verifiedStagedChunks(staged, entry)) {
    // Complete replay is required before this artifact can join the commit.
  }
  return Object.freeze({
    artifact: validatedArtifact(entry, staged, input.candidateRootPath),
    byteLength: state.observedBytes,
  });
}

/**
 * Independently validates one contained, retrieved Output Carrier. This is a
 * private byte boundary only; it owns no Delivery state, retry, or promotion.
 */
export async function validateFoundationExecutionOutput(input: Readonly<{
  output: FoundationRetrievedExecutionOutputV1;
  specification: FoundationExecutionSpecificationV1;
  backendProfile: FoundationExecutionBackendProfileV1;
  runnerDigest: Sha256;
  staging: FoundationExecutionOutputStagingV1;
}>): Promise<FoundationValidatedExecutionOutputResultV1> {
  const output = transportSnapshot(input.output);
  assertDigest(input.runnerDigest, "Expected execution runner digest");
  const profile = parseFoundationExecutionBackendProfile(input.backendProfile);
  const specification = parseFoundationExecutionSpecification({
    value: input.specification,
    backendProfile: profile,
    image: input.specification.image,
    inputSet: input.specification.inputSet,
  });
  const candidateRootPath = candidateOutputRootPath(specification);
  const manifest = exactManifest(output.manifest);
  assertManifestBindings(manifest, specification, input.runnerDigest);
  validateManifestInventory(manifest, specification, profile);
  if (!Number.isSafeInteger(output.carrierByteLength) ||
      output.carrierByteLength < 0 ||
      output.carrierByteLength !== manifest.aggregateByteLength ||
      output.carrierByteLength > specification.limits.outputBytes ||
      output.carrierByteLength > profile.limits.maximumOutputBytes) {
    fail("carrier-bytes", "Execution Output Carrier byte count is invalid or exceeds its bounds");
  }

  let readers: AsyncIterable<FoundationExecutionOutputEntryReaderV1>;
  try {
    readers = output.entries();
  } catch {
    fail("transport", "Execution Output Carrier entry stream could not be opened");
  }
  if (readers === null || typeof readers !== "object" ||
      typeof readers[Symbol.asyncIterator] !== "function") {
    fail("transport", "Execution Output Carrier did not return an asynchronous entry stream");
  }

  const begin = stagingBegin(input.staging);
  let transaction: StagingTransactionSnapshot;
  try {
    transaction = stagingTransaction(await begin(Object.freeze({
      plan: Object.freeze({
        manifestDigest: manifest.digest,
        carrierByteLength: manifest.aggregateByteLength,
        artifactCount: manifest.entryCount,
      }),
      manifestBytes: canonicalManifestBytes(manifest),
    })));
  } catch (error) {
    if (error instanceof FoundationError) throw error;
    fail("staging-begin", "Execution Output private staging could not begin");
  }

  const artifacts: FoundationValidatedExecutionOutputArtifactV1[] = [];
  const observedPaths = new Set<string>();
  let observedBytes = 0;
  let index = 0;
  let commitResolved = false;
  try {
    for await (const rawReader of readers) {
      if (index >= manifest.entries.length) {
        fail("extra-entry", "Execution Output Carrier contains an entry absent from its Manifest");
      }
      const reader = readerSnapshot(rawReader);
      if (observedPaths.has(reader.path)) {
        fail("duplicate-entry", "Execution Output Carrier repeats one entry reader");
      }
      observedPaths.add(reader.path);
      const validated = await stageEntryBytes({
        transaction,
        reader,
        entry: manifest.entries[index]!,
        candidateRootPath,
        artifactIndex: index,
        remainingAggregateBytes: manifest.aggregateByteLength - observedBytes,
      });
      observedBytes = safeAdd(observedBytes, validated.byteLength, "Observed Output Carrier bytes");
      artifacts.push(validated.artifact);
      index += 1;
    }
    if (index !== manifest.entries.length) {
      fail("missing-entry", "Execution Output Carrier omits one or more Manifest entries");
    }
    if (observedBytes !== manifest.aggregateByteLength ||
        observedBytes !== output.carrierByteLength) {
      fail("carrier-bytes", "Observed Execution Output bytes do not match the complete Carrier inventory");
    }
    let outputStoreBinding: FoundationExecutionOutputStoreBindingV1;
    try {
      const committed = await transaction.commit();
      commitResolved = true;
      outputStoreBinding = parseFoundationExecutionOutputStoreBindingV1(committed);
    } catch (error) {
      if (error instanceof FoundationError) throw error;
      fail("staging-commit", "Execution Output private staging could not commit verified bytes");
    }
    return Object.freeze({
      output: Object.freeze({
        manifest,
        carrierByteLength: observedBytes,
        artifacts: Object.freeze(artifacts),
        candidateOutput: validatedCandidateOutput(candidateRootPath, artifacts),
      }),
      outputStoreBinding,
    });
  } catch (error) {
    const failure = error instanceof FoundationError
      ? error
      : outputFailure("transport", "Execution Output Carrier validation failed operationally");
    if (commitResolved) throw failure;
    try {
      await transaction.abort();
    } catch {
      fail(
        "staging-abort",
        "Execution Output private staging could not revoke provisional bytes after failure",
      );
    }
    throw failure;
  }
}

/**
 * Reconstructs one previously committed validated Output from private Store
 * bytes. This recovery boundary never observes or retrieves from a Backend.
 */
export async function reopenFoundationValidatedExecutionOutput(input: Readonly<{
  outputStore: FoundationExecutionOutputStoreV1;
  outputStoreBinding: FoundationExecutionOutputStoreBindingV1;
  specification: FoundationExecutionSpecificationV1;
  backendProfile: FoundationExecutionBackendProfileV1;
  runnerDigest: Sha256;
}>): Promise<FoundationValidatedExecutionOutputResultV1> {
  assertDigest(input.runnerDigest, "Expected execution runner digest");
  const profile = parseFoundationExecutionBackendProfile(input.backendProfile);
  const specification = parseFoundationExecutionSpecification({
    value: input.specification,
    backendProfile: profile,
    image: input.specification.image,
    inputSet: input.specification.inputSet,
  });
  const candidateRootPath = candidateOutputRootPath(specification);
  const outputStoreBinding = parseFoundationExecutionOutputStoreBindingV1(
    input.outputStoreBinding,
  );
  const reopen = boundMethod<FoundationExecutionOutputStoreV1["reopen"]>(
    input.outputStore,
    "reopen",
    "Execution Output Store reopen",
  );
  let reopenedValue: unknown;
  try {
    reopenedValue = await reopen(outputStoreBinding);
  } catch (error) {
    if (error instanceof FoundationError) throw error;
    fail("staging-store-reopen", "Execution Output Store reopen failed operationally");
  }
  const reopened = reopenedStoreSnapshot(reopenedValue, outputStoreBinding);
  const manifest = parseCanonicalManifestBytes(reopened.manifestBytes);
  assertManifestBindings(manifest, specification, input.runnerDigest);
  validateManifestInventory(manifest, specification, profile);

  const expectedPlan = Object.freeze({
    manifestDigest: manifest.digest,
    carrierByteLength: manifest.aggregateByteLength,
    artifactCount: manifest.entryCount,
  });
  if (canonicalJson(reopened.descriptor.plan) !== canonicalJson(expectedPlan)) {
    fail(
      "staging-store-plan",
      "Execution Output Store descriptor does not bind the exact Manifest plan",
    );
  }
  if (reopened.descriptor.artifacts.length !== manifest.entries.length ||
      reopened.artifacts.length !== manifest.entries.length) {
    fail(
      "staging-store-artifacts",
      "Execution Output Store artifact count differs from the Manifest",
    );
  }

  const artifacts: FoundationValidatedExecutionOutputArtifactV1[] = [];
  for (let index = 0; index < manifest.entries.length; index += 1) {
    const entry = manifest.entries[index]!;
    const expected = stagingBindingFor(entry, index);
    if (canonicalJson(reopened.descriptor.artifacts[index]) !== canonicalJson(expected)) {
      fail(
        "staging-store-artifacts",
        "Execution Output Store descriptor substituted one Manifest artifact",
      );
    }
    const staged = stagedArtifactSnapshot(
      reopened.artifacts[index] as FoundationStagedExecutionOutputArtifactV1,
      expected,
    );
    for await (const _chunk of verifiedStagedChunks(staged, entry)) {
      // Complete replay is required before recovered bytes regain validated standing.
    }
    artifacts.push(validatedArtifact(entry, staged, candidateRootPath));
  }

  return Object.freeze({
    output: Object.freeze({
      manifest,
      carrierByteLength: manifest.aggregateByteLength,
      artifacts: Object.freeze(artifacts),
      candidateOutput: validatedCandidateOutput(candidateRootPath, artifacts),
    }),
    outputStoreBinding,
  });
}
