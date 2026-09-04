import { randomBytes } from "node:crypto";
import { FoundationError } from "../../src/foundation/error.js";
import {
  assertFoundationExecutionAllocationKey,
  compileFoundationExecutionRetrievalOutcome,
  compileExecutionReclamationBinding,
  compileExecutionReclamationObservation,
  foundationExecutionAllocationKeyBindingDigest,
  parseExecutionReclamationBinding,
  parseExecutionReclamationObligation,
  parseExecutionReclamationObservation,
  privateFoundationExecutionHandle,
  type FoundationExecutionAllocationKey,
  type FoundationExecutionBackend,
  type FoundationExecutionHandle,
  type FoundationExecutionRetrievalOutcomeV1,
  type FoundationExecutionReclamationBindingV1,
  type FoundationExecutionReclamationObligationV1,
  type FoundationExecutionReclamationObservationV1,
  type FoundationRetrievedExecutionOutputV1,
} from "../../src/foundation/execution/backend.js";
import {
  executionObservationEstablishesContainment,
  parseFoundationExecutionObservation,
  parseFoundationExecutionSpecification,
  type FoundationExecutionBackendProfileV1,
  type FoundationExecutionObservationV1,
  type FoundationExecutionSpecificationV1,
  type FoundationExecutionTerminalObservationV1,
  type FoundationExecutionOutputManifestV1,
} from "../../src/foundation/execution/contracts.js";
import {
  canonicalJson,
  digestCanonical,
  selfDigest,
  sha256Bytes,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";
import { assertFoundationSchema } from "../../src/foundation/validation/schema-engine.js";

export type InMemoryExecutionFaultPoint =
  | "allocate-before-create"
  | "allocate-after-create-before-return"
  | "dispatch-before-start"
  | "dispatch-after-start-before-return"
  | "observe-unavailable"
  | "observe-ambiguous"
  | "cancel-before-containment"
  | "cancel-after-containment-before-return"
  | "retrieve-before-read"
  | "retrieve-after-read-before-return"
  | "reclaim-before-removal"
  | "reclaim-after-removal-before-return";

type StoredOutput = Readonly<{
  manifest: FoundationExecutionOutputManifestV1;
  carrierByteLength: number;
  files: readonly Readonly<{ path: string; bytes: Uint8Array }>[];
}>;

type Cell = {
  readonly allocationKey: FoundationExecutionAllocationKey;
  readonly specification: FoundationExecutionSpecificationV1;
  readonly handle: FoundationExecutionHandle;
  dispatched: boolean;
  dispatchEntryDigest: Sha256 | null;
  started: boolean;
  terminal: FoundationExecutionTerminalObservationV1 | null;
  observationSequence: number;
  lastObservation: FoundationExecutionObservationV1 | null;
  productiveStarts: number;
  output: StoredOutput | null;
  reclamationObligation: FoundationExecutionReclamationObligationV1 | null;
};

type MissingAllocation = {
  readonly allocationKey: FoundationExecutionAllocationKey;
  readonly specification: FoundationExecutionSpecificationV1;
  readonly handle: FoundationExecutionHandle;
  readonly dispatched: boolean;
  readonly dispatchEntryDigest: Sha256 | null;
  observationSequence: number;
  lastObservation: FoundationExecutionObservationV1 | null;
  readonly productiveStarts: number;
};

type ReclamationTombstone = Readonly<{
  allocationKey: FoundationExecutionAllocationKey;
  specification: FoundationExecutionSpecificationV1;
  handle: FoundationExecutionHandle;
  binding: FoundationExecutionReclamationBindingV1;
  obligation: FoundationExecutionReclamationObligationV1;
  observation: FoundationExecutionReclamationObservationV1;
  productiveStarts: number;
}>;

type ProfileBinding = Readonly<{
  profileId: FoundationExecutionBackendProfileV1["profileId"];
  digest: Sha256;
  implementationDigest: Sha256;
}>;

type SnapshotOutput = Readonly<{
  manifest: FoundationExecutionOutputManifestV1;
  carrierByteLength: number;
  files: readonly Readonly<{ path: string; bytesBase64: string }>[];
}>;

type SnapshotAllocation = Readonly<{
  allocationKey: string;
  specification: FoundationExecutionSpecificationV1;
  handle: string;
  dispatched: boolean;
  dispatchEntryDigest: Sha256 | null;
  started: boolean;
  terminal: FoundationExecutionTerminalObservationV1 | null;
  observationSequence: number;
  lastObservation: FoundationExecutionObservationV1 | null;
  productiveStarts: number;
  output: SnapshotOutput | null;
  reclamationObligation: FoundationExecutionReclamationObligationV1 | null;
}>;

type SnapshotMissingAllocation = Readonly<{
  allocationKey: string;
  specification: FoundationExecutionSpecificationV1;
  handle: string;
  dispatched: boolean;
  dispatchEntryDigest: Sha256 | null;
  observationSequence: number;
  lastObservation: FoundationExecutionObservationV1 | null;
  productiveStarts: number;
}>;

type SnapshotTombstone = Readonly<{
  allocationKey: string;
  specification: FoundationExecutionSpecificationV1;
  handle: string;
  binding: FoundationExecutionReclamationBindingV1;
  obligation: FoundationExecutionReclamationObligationV1;
  observation: FoundationExecutionReclamationObservationV1;
  productiveStarts: number;
}>;

export type InMemoryExecutionBackendSnapshotV1 = Readonly<{
  schema: "lifecycle.execution-test-engine-snapshot.private.v1";
  engineSecret: string;
  profileBinding: ProfileBinding | null;
  clock: number;
  heldOpenSpecificationDigests: readonly Sha256[];
  allocations: readonly SnapshotAllocation[];
  missingAllocations: readonly SnapshotMissingAllocation[];
  reclamationTombstones: readonly SnapshotTombstone[];
  digest: Sha256;
}>;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.execution.test-backend.${code}`, message, {
    operationalStateChanged: code === "interrupted",
  });
}

function freezeJson<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

function assertClosedObject(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      canonicalJson(Object.keys(value).sort()) !== canonicalJson([...expectedKeys].sort())) {
    fail("snapshot", `${label} is not one exact closed object`);
  }
}

function assertSha256OrNull(value: unknown, label: string): void {
  if (value !== null && (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value))) {
    fail("snapshot", `${label} is not null or one exact digest`);
  }
}

function assertCanonicalTime(value: unknown, label: string): void {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
      Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail("snapshot", `${label} is not one canonical time`);
  }
}

function assertSnapshotTerminal(value: unknown): void {
  if (value === null) return;
  assertClosedObject(
    value,
    ["exitCode", "finishedAt", "reason", "runnerDisposition", "signal"],
    "Execution test-engine snapshot terminal observation",
  );
  assertCanonicalTime(value.finishedAt, "Execution test-engine terminal completion");
  if (!(value.reason === "exited" || value.reason === "cancelled" ||
      value.reason === "timed-out" || value.reason === "backend-failure" ||
      value.reason === "parent-loss" || value.reason === "unknown") ||
      !(value.runnerDisposition === "completed" || value.runnerDisposition === "refused" ||
        value.runnerDisposition === "incomplete" || value.runnerDisposition === "unavailable" ||
        value.runnerDisposition === "unknown") ||
      !(value.exitCode === null || (Number.isInteger(value.exitCode) &&
        Number(value.exitCode) >= -2_147_483_648 && Number(value.exitCode) <= 2_147_483_647)) ||
      !(value.signal === null || (typeof value.signal === "string" &&
        /^[A-Z0-9]{1,64}$/u.test(value.signal)))) {
    fail("snapshot", "Execution test-engine snapshot terminal observation is invalid");
  }
}

function assertSnapshotOutput(value: unknown): void {
  if (value === null) return;
  assertClosedObject(
    value,
    ["carrierByteLength", "files", "manifest"],
    "Execution test-engine snapshot Output",
  );
  if (!Number.isSafeInteger(value.carrierByteLength) || Number(value.carrierByteLength) < 0 ||
      !Array.isArray(value.files)) {
    fail("snapshot", "Execution test-engine snapshot Output bounds are invalid");
  }
  assertFoundationSchema(
    "urn:lifecycle:schema:execution-output-manifest:v1",
    value.manifest,
    "Execution test-engine snapshot Output Manifest",
  );
  for (const file of value.files) {
    assertClosedObject(
      file,
      ["bytesBase64", "path"],
      "Execution test-engine snapshot Output entry",
    );
    if (typeof file.path !== "string" || typeof file.bytesBase64 !== "string") {
      fail("snapshot", "Execution test-engine snapshot Output entry is invalid");
    }
  }
}

function parseSnapshot(value: unknown): InMemoryExecutionBackendSnapshotV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("snapshot", "Execution test-engine snapshot is not one exact object");
  }
  const normalized = JSON.parse(canonicalJson(value)) as unknown;
  assertClosedObject(normalized, [
    "allocations",
    "clock",
    "digest",
    "engineSecret",
    "heldOpenSpecificationDigests",
    "missingAllocations",
    "profileBinding",
    "reclamationTombstones",
    "schema",
  ], "Execution test-engine snapshot");
  if (normalized.schema !== "lifecycle.execution-test-engine-snapshot.private.v1" ||
      typeof normalized.engineSecret !== "string" ||
      !/^[a-f0-9]{64}$/u.test(normalized.engineSecret) ||
      !Number.isSafeInteger(normalized.clock) || Number(normalized.clock) < 0 ||
      !Array.isArray(normalized.allocations) || !Array.isArray(normalized.missingAllocations) ||
      !Array.isArray(normalized.reclamationTombstones) ||
      !Array.isArray(normalized.heldOpenSpecificationDigests)) {
    fail("snapshot", "Execution test-engine snapshot root values are invalid");
  }
  assertSha256OrNull(normalized.digest, "Execution test-engine snapshot digest");
  if (normalized.profileBinding !== null) {
    assertClosedObject(
      normalized.profileBinding,
      ["digest", "implementationDigest", "profileId"],
      "Execution test-engine snapshot Backend Profile binding",
    );
    assertSha256OrNull(
      normalized.profileBinding.digest,
      "Execution test-engine snapshot Backend Profile digest",
    );
    assertSha256OrNull(
      normalized.profileBinding.implementationDigest,
      "Execution test-engine snapshot Backend implementation digest",
    );
    if (typeof normalized.profileBinding.profileId !== "string") {
      fail("snapshot", "Execution test-engine snapshot Backend Profile id is invalid");
    }
  }
  for (const digest of normalized.heldOpenSpecificationDigests) {
    assertSha256OrNull(digest, "Execution test-engine held-open Specification digest");
  }
  for (const allocation of normalized.allocations) {
    assertClosedObject(allocation, [
      "allocationKey",
      "dispatched",
      "dispatchEntryDigest",
      "handle",
      "lastObservation",
      "observationSequence",
      "output",
      "productiveStarts",
      "reclamationObligation",
      "specification",
      "started",
      "terminal",
    ], "Execution test-engine snapshot allocation");
    if (typeof allocation.allocationKey !== "string" || typeof allocation.handle !== "string" ||
        typeof allocation.dispatched !== "boolean" || typeof allocation.started !== "boolean" ||
        !Number.isSafeInteger(allocation.observationSequence) ||
        Number(allocation.observationSequence) < 0 ||
        !(allocation.productiveStarts === 0 || allocation.productiveStarts === 1) ||
        (allocation.lastObservation !== null &&
          (typeof allocation.lastObservation !== "object" ||
            Array.isArray(allocation.lastObservation))) ||
        allocation.specification === null || typeof allocation.specification !== "object" ||
        Array.isArray(allocation.specification)) {
      fail("snapshot", "Execution test-engine snapshot allocation values are invalid");
    }
    assertSha256OrNull(
      allocation.dispatchEntryDigest,
      "Execution test-engine snapshot dispatch-entry digest",
    );
    if (allocation.reclamationObligation !== null &&
        (typeof allocation.reclamationObligation !== "object" ||
          Array.isArray(allocation.reclamationObligation))) {
      fail("snapshot", "Execution test-engine snapshot Reclamation Obligation is invalid");
    }
    assertSnapshotTerminal(allocation.terminal);
    assertSnapshotOutput(allocation.output);
  }
  for (const missing of normalized.missingAllocations) {
    assertClosedObject(missing, [
      "allocationKey",
      "dispatched",
      "dispatchEntryDigest",
      "handle",
      "lastObservation",
      "observationSequence",
      "productiveStarts",
      "specification",
    ], "Execution test-engine snapshot missing allocation");
    if (typeof missing.allocationKey !== "string" || typeof missing.handle !== "string" ||
        typeof missing.dispatched !== "boolean" ||
        !Number.isSafeInteger(missing.observationSequence) ||
        Number(missing.observationSequence) < 0 ||
        !(missing.productiveStarts === 0 || missing.productiveStarts === 1) ||
        (missing.lastObservation !== null &&
          (typeof missing.lastObservation !== "object" || Array.isArray(missing.lastObservation))) ||
        missing.specification === null || typeof missing.specification !== "object" ||
        Array.isArray(missing.specification)) {
      fail("snapshot", "Execution test-engine snapshot missing-allocation values are invalid");
    }
    assertSha256OrNull(
      missing.dispatchEntryDigest,
      "Execution test-engine missing dispatch-entry digest",
    );
  }
  for (const tombstone of normalized.reclamationTombstones) {
    assertClosedObject(tombstone, [
      "allocationKey",
      "binding",
      "handle",
      "obligation",
      "observation",
      "productiveStarts",
      "specification",
    ], "Execution test-engine snapshot Reclamation tombstone");
    if (typeof tombstone.allocationKey !== "string" || typeof tombstone.handle !== "string" ||
        !(tombstone.productiveStarts === 0 || tombstone.productiveStarts === 1) ||
        tombstone.binding === null || typeof tombstone.binding !== "object" ||
        Array.isArray(tombstone.binding) ||
        tombstone.specification === null || typeof tombstone.specification !== "object" ||
        Array.isArray(tombstone.specification) ||
        tombstone.obligation === null || typeof tombstone.obligation !== "object" ||
        Array.isArray(tombstone.obligation) ||
        tombstone.observation === null || typeof tombstone.observation !== "object" ||
        Array.isArray(tombstone.observation)) {
      fail("snapshot", "Execution test-engine snapshot Reclamation tombstone is invalid");
    }
  }
  const snapshot = normalized as unknown as InMemoryExecutionBackendSnapshotV1;
  if (snapshot.digest !== selfDigest(snapshot as unknown as Record<string, unknown>)) {
    fail("snapshot", "Execution test-engine snapshot digest is invalid");
  }
  return freezeJson(snapshot);
}

function sameProfile(
  profile: FoundationExecutionBackendProfileV1,
  specification: FoundationExecutionSpecificationV1,
): boolean {
  return specification.backendProfile.profileId === profile.profileId &&
    specification.backendProfile.profileDigest === profile.digest &&
    specification.backendProfile.implementationDigest ===
      profile.implementation.implementationDigest;
}

function physicalDispatchEntryDigest(
  allocationKey: FoundationExecutionAllocationKey,
  specificationDigest: Sha256,
  handle: FoundationExecutionHandle,
): Sha256 {
  return digestCanonical({
    schema: "lifecycle.execution-test-dispatch-entry.private.v1",
    allocationKey,
    specificationDigest,
    handle,
  });
}

function assertObservationFitsRetainedFacts(input: Readonly<{
  observation: FoundationExecutionObservationV1 | null;
  dispatched: boolean;
  productiveStarts: number;
  terminal: FoundationExecutionTerminalObservationV1 | null;
  output: StoredOutput | null | undefined;
  clock: number;
}>): void {
  const observation = input.observation;
  if (observation === null) return;
  const observedDispatch = observation.dispatchState !== "not-observed" &&
    observation.dispatchState !== "ambiguous";
  const observedStart = observation.dispatchState === "start-observed" ||
    observation.dispatchState === "terminal-observed" ||
    observation.processState === "running" || observation.processState === "terminal";
  if ((observedDispatch && !input.dispatched) ||
      (observedStart && input.productiveStarts !== 1) ||
      observation.allocationState === "absent" ||
      Date.parse(observation.observedAt) > input.clock) {
    fail("snapshot", "Execution test-engine Observation exceeds retained physical facts");
  }
  if (observation.terminal !== null &&
      (input.terminal === null || canonicalJson(observation.terminal) !== canonicalJson(input.terminal))) {
    fail("snapshot", "Execution test-engine terminal Observation differs from retained completion");
  }
  if (input.output !== undefined && observation.output.disposition === "complete" &&
      (input.output === null ||
        observation.output.manifestDigest !== input.output.manifest.digest ||
        observation.output.carrierByteLength !== input.output.carrierByteLength)) {
    fail("snapshot", "Execution test-engine Output Observation differs from retained Output");
  }
}

function assertStrictSnapshotOrder<T>(
  values: readonly T[],
  identity: (value: T) => string,
  label: string,
): void {
  for (let index = 1; index < values.length; index += 1) {
    if (identity(values[index - 1]!) >= identity(values[index]!)) {
      fail("snapshot", `${label} is not strictly ordered`);
    }
  }
}

function validateStoredOutput(
  specification: FoundationExecutionSpecificationV1,
  output: StoredOutput,
): StoredOutput {
  if (output.manifest.specificationDigest !== specification.digest ||
      output.manifest.inputSetDigest !== specification.inputSet.digest ||
      output.manifest.imageDigest !== specification.image.imageDigest ||
      output.manifest.outputContractDigest !== specification.outputContract.digest ||
      output.manifest.digest !== selfDigest(
        output.manifest as unknown as Record<string, unknown>,
      ) || output.manifest.entryCount !== output.manifest.entries.length ||
      output.files.length !== output.manifest.entries.length ||
      !Number.isSafeInteger(output.carrierByteLength) || output.carrierByteLength < 0 ||
      output.carrierByteLength > specification.limits.outputBytes ||
      output.files.length > specification.limits.outputEntries) {
    fail("output", "Test Backend Output Carrier does not bind its exact Specification and Manifest");
  }
  const files = output.files.map((file, index) => {
    const entry = output.manifest.entries[index]!;
    if (file.path !== entry.path || file.bytes.byteLength !== entry.byteLength ||
        file.bytes.byteLength > specification.limits.outputEntryBytes ||
        sha256Bytes(file.bytes) !== entry.digest) {
      fail("output", "Test Backend Output Carrier bytes differ from their exact Manifest entry");
    }
    return Object.freeze({ path: file.path, bytes: Uint8Array.from(file.bytes) });
  });
  return Object.freeze({
    manifest: output.manifest,
    carrierByteLength: output.carrierByteLength,
    files: Object.freeze(files),
  });
}

async function collectOutput(
  specification: FoundationExecutionSpecificationV1,
  output: FoundationRetrievedExecutionOutputV1,
): Promise<StoredOutput> {
  const files: Array<Readonly<{ path: string; bytes: Uint8Array }>> = [];
  let index = 0;
  for await (const reader of output.entries()) {
    const entry = output.manifest.entries[index];
    if (entry === undefined || reader.path !== entry.path ||
        reader.byteLength !== entry.byteLength || reader.digest !== entry.digest) {
      fail("output", "Test Backend Output reader differs from its exact Manifest inventory");
    }
    const chunks: Uint8Array[] = [];
    let byteLength = 0;
    for await (const chunk of reader.read()) {
      byteLength += chunk.byteLength;
      if (byteLength > specification.limits.outputEntryBytes || byteLength > entry.byteLength) {
        fail("output", "Test Backend Output reader exceeded its exact entry bound");
      }
      chunks.push(Uint8Array.from(chunk));
    }
    const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    files.push(Object.freeze({ path: reader.path, bytes }));
    index += 1;
  }
  if (index !== output.manifest.entries.length) {
    fail("output", "Test Backend Output reader omitted one or more Manifest entries");
  }
  return validateStoredOutput(specification, Object.freeze({
    manifest: output.manifest,
    carrierByteLength: output.carrierByteLength,
    files: Object.freeze(files),
  }));
}

function outputReader(
  output: StoredOutput,
  interruptAfterFirstChunk: (() => void) | null,
): FoundationRetrievedExecutionOutputV1 {
  return Object.freeze({
    manifest: output.manifest,
    carrierByteLength: output.carrierByteLength,
    async *entries() {
      for (let index = 0; index < output.files.length; index += 1) {
        const file = output.files[index]!;
        const entry = output.manifest.entries[index]!;
        yield Object.freeze({
          path: file.path,
          byteLength: file.bytes.byteLength,
          digest: entry.digest,
          async *read() {
            const splitAt = Math.max(1, Math.floor(file.bytes.byteLength / 2));
            yield Uint8Array.from(file.bytes.subarray(0, splitAt));
            if (interruptAfterFirstChunk !== null) interruptAfterFirstChunk();
            if (splitAt < file.bytes.byteLength) {
              yield Uint8Array.from(file.bytes.subarray(splitAt));
            }
          },
        });
      }
    },
  });
}

function snapshotOutput(output: StoredOutput | null): SnapshotOutput | null {
  if (output === null) return null;
  return Object.freeze({
    manifest: output.manifest,
    carrierByteLength: output.carrierByteLength,
    files: Object.freeze(output.files.map((file) => Object.freeze({
      path: file.path,
      bytesBase64: Buffer.from(file.bytes).toString("base64"),
    }))),
  });
}

function reloadOutput(
  specification: FoundationExecutionSpecificationV1,
  output: SnapshotOutput | null,
): StoredOutput | null {
  if (output === null) return null;
  const files = output.files.map((file) => {
    const bytes = Buffer.from(file.bytesBase64, "base64");
    if (bytes.toString("base64") !== file.bytesBase64) {
      fail("snapshot", "Execution test-engine snapshot contains noncanonical Output bytes");
    }
    return Object.freeze({ path: file.path, bytes });
  });
  return validateStoredOutput(specification, Object.freeze({
    manifest: output.manifest,
    carrierByteLength: output.carrierByteLength,
    files: Object.freeze(files),
  }));
}

function parseSnapshotSpecification(
  value: FoundationExecutionSpecificationV1,
  profile: FoundationExecutionBackendProfileV1,
): FoundationExecutionSpecificationV1 {
  return parseFoundationExecutionSpecification({
    value,
    backendProfile: profile,
    image: value.image,
    inputSet: value.inputSet,
  });
}

/** Shared physical test engine. Facades and snapshot reloads are distinct. */
export class InMemoryExecutionBackendEngine {
  readonly #secret: string;
  readonly #byKey = new Map<FoundationExecutionAllocationKey, Cell>();
  readonly #byHandle = new Map<FoundationExecutionHandle, Cell>();
  readonly #missingByKey = new Map<FoundationExecutionAllocationKey, MissingAllocation>();
  readonly #missingByHandle = new Map<FoundationExecutionHandle, MissingAllocation>();
  readonly #tombstonesByKey = new Map<FoundationExecutionAllocationKey, ReclamationTombstone>();
  readonly #tombstonesByHandle = new Map<FoundationExecutionHandle, ReclamationTombstone>();
  readonly #keyBySpecification = new Map<Sha256, FoundationExecutionAllocationKey>();
  readonly #faults = new Map<InMemoryExecutionFaultPoint, number>();
  readonly #heldOpen = new Set<Sha256>();
  readonly #remainingOnce = new Set<FoundationExecutionHandle>();
  readonly #integrityRefusalOnce = new Set<FoundationExecutionHandle>();
  #profileBinding: ProfileBinding | null = null;
  #clock = Date.parse("2026-09-01T00:00:00.000Z");

  constructor(secret = randomBytes(32).toString("hex")) {
    if (!/^[a-f0-9]{64}$/u.test(secret)) fail("snapshot", "Test Backend engine secret is invalid");
    this.#secret = secret;
  }

  static reload(
    snapshotValue: unknown,
    profile: FoundationExecutionBackendProfileV1,
  ): InMemoryExecutionBackendEngine {
    const snapshot = parseSnapshot(snapshotValue);
    const engine = new InMemoryExecutionBackendEngine(snapshot.engineSecret);
    engine.#clock = snapshot.clock;
    engine.facade(profile);
    if (snapshot.profileBinding === null ||
        snapshot.profileBinding.profileId !== engine.#profileBinding!.profileId ||
        snapshot.profileBinding.digest !== engine.#profileBinding!.digest ||
        snapshot.profileBinding.implementationDigest !==
          engine.#profileBinding!.implementationDigest) {
      fail("snapshot", "Execution test-engine snapshot Backend Profile binding differs");
    }
    assertStrictSnapshotOrder(
      snapshot.heldOpenSpecificationDigests,
      (digest) => digest,
      "Execution test-engine held-open Specification digests",
    );
    assertStrictSnapshotOrder(
      snapshot.allocations,
      ({ handle }) => handle,
      "Execution test-engine allocations",
    );
    assertStrictSnapshotOrder(
      snapshot.missingAllocations,
      ({ handle }) => handle,
      "Execution test-engine missing allocations",
    );
    assertStrictSnapshotOrder(
      snapshot.reclamationTombstones,
      ({ handle }) => handle,
      "Execution test-engine Reclamation tombstones",
    );
    for (const digest of snapshot.heldOpenSpecificationDigests) engine.#heldOpen.add(digest);
    for (const value of snapshot.allocations) {
      const allocationKey = value.allocationKey as FoundationExecutionAllocationKey;
      assertFoundationExecutionAllocationKey(allocationKey);
      const specification = parseSnapshotSpecification(value.specification, profile);
      const handle = privateFoundationExecutionHandle(value.handle);
      if (handle !== engine.makeHandle(allocationKey, specification.digest)) {
        fail("snapshot", "Execution test-engine snapshot Handle binding is invalid");
      }
      const expectedDispatchEntryDigest = physicalDispatchEntryDigest(
        allocationKey,
        specification.digest,
        handle,
      );
      if (value.dispatched !== (value.dispatchEntryDigest !== null) ||
          (value.dispatchEntryDigest !== null &&
            value.dispatchEntryDigest !== expectedDispatchEntryDigest) ||
          (value.started && !value.dispatched) ||
          (value.terminal !== null && !value.started) ||
          value.productiveStarts !== (value.started ? 1 : 0) ||
          (value.terminal !== null && Date.parse(value.terminal.finishedAt) > snapshot.clock) ||
          (value.reclamationObligation !== null &&
            value.started && value.terminal === null)) {
        fail("snapshot", "Execution test-engine allocation physical facts are inconsistent");
      }
      const lastObservation = value.lastObservation === null ? null :
        parseFoundationExecutionObservation({
          value: value.lastObservation,
          specification,
        });
      if (value.observationSequence !== (lastObservation?.observationSequence ?? 0)) {
        fail("snapshot", "Execution test-engine snapshot observation sequence is invalid");
      }
      const output = reloadOutput(specification, value.output);
      let reclamationObligation: FoundationExecutionReclamationObligationV1 | null = null;
      if (value.reclamationObligation !== null) {
        const retirementCheckpointDigest = value.reclamationObligation.retirementCheckpointDigest;
        if (typeof retirementCheckpointDigest !== "string" ||
            !/^sha256:[a-f0-9]{64}$/u.test(retirementCheckpointDigest)) {
          fail("snapshot", "Execution test-engine Reclamation Retirement is invalid");
        }
        const binding = engine.compileReclamationBinding({
          allocationKey,
          specification,
          handle,
          retirementCheckpointDigest,
          dispatchAuthorityConsumed: value.dispatched,
        });
        reclamationObligation = parseExecutionReclamationObligation(
          value.reclamationObligation,
          specification,
          binding,
        );
      }
      if (reclamationObligation !== null &&
          (lastObservation === null || !executionObservationEstablishesContainment(
            lastObservation,
            value.dispatched,
          ))) {
        fail("snapshot", "Execution test-engine Reclamation binding lacks retained Containment");
      }
      assertObservationFitsRetainedFacts({
        observation: lastObservation,
        dispatched: value.dispatched,
        productiveStarts: value.productiveStarts,
        terminal: value.terminal,
        output,
        clock: snapshot.clock,
      });
      engine.registerCell({
        allocationKey,
        specification,
        handle,
        dispatched: value.dispatched,
        dispatchEntryDigest: value.dispatchEntryDigest,
        started: value.started,
        terminal: value.terminal,
        observationSequence: value.observationSequence,
        lastObservation,
        productiveStarts: value.productiveStarts,
        output,
        reclamationObligation,
      });
    }
    for (const value of snapshot.missingAllocations) {
      const allocationKey = value.allocationKey as FoundationExecutionAllocationKey;
      assertFoundationExecutionAllocationKey(allocationKey);
      const specification = parseSnapshotSpecification(value.specification, profile);
      const handle = privateFoundationExecutionHandle(value.handle);
      if (handle !== engine.makeHandle(allocationKey, specification.digest)) {
        fail("snapshot", "Execution test-engine missing-allocation Handle binding is invalid");
      }
      const expectedDispatchEntryDigest = physicalDispatchEntryDigest(
        allocationKey,
        specification.digest,
        handle,
      );
      if (value.dispatched !== (value.dispatchEntryDigest !== null) ||
          (value.dispatchEntryDigest !== null &&
            value.dispatchEntryDigest !== expectedDispatchEntryDigest) ||
          (value.productiveStarts === 1 && !value.dispatched)) {
        fail("snapshot", "Execution test-engine missing-allocation facts are inconsistent");
      }
      const lastObservation = value.lastObservation === null ? null :
        parseFoundationExecutionObservation({ value: value.lastObservation, specification });
      if (value.observationSequence !== (lastObservation?.observationSequence ?? 0)) {
        fail("snapshot", "Execution test-engine missing-allocation sequence is invalid");
      }
      assertObservationFitsRetainedFacts({
        observation: lastObservation,
        dispatched: value.dispatched,
        productiveStarts: value.productiveStarts,
        terminal: lastObservation?.terminal ?? null,
        output: undefined,
        clock: snapshot.clock,
      });
      engine.registerMissing({
        allocationKey,
        specification,
        handle,
        dispatched: value.dispatched,
        dispatchEntryDigest: value.dispatchEntryDigest,
        observationSequence: value.observationSequence,
        lastObservation,
        productiveStarts: value.productiveStarts,
      });
    }
    for (const value of snapshot.reclamationTombstones) {
      const allocationKey = value.allocationKey as FoundationExecutionAllocationKey;
      assertFoundationExecutionAllocationKey(allocationKey);
      const specification = parseSnapshotSpecification(value.specification, profile);
      const handle = privateFoundationExecutionHandle(value.handle);
      if (handle !== engine.makeHandle(allocationKey, specification.digest)) {
        fail("snapshot", "Execution test-engine Reclamation Handle binding is invalid");
      }
      const binding = parseExecutionReclamationBinding(
        value.binding,
        specification,
      );
      if (binding.handle !== handle) {
        fail("snapshot", "Execution test-engine Reclamation binding selects another Handle");
      }
      engine.assertReclamationBinding(binding, allocationKey);
      const obligation = parseExecutionReclamationObligation(
        value.obligation,
        specification,
        binding,
      );
      const observation = parseExecutionReclamationObservation(
        value.observation,
        specification,
        obligation,
      );
      if (observation.disposition !== "reclaimed" ||
          Date.parse(observation.observedAt) > snapshot.clock) {
        fail("snapshot", "Execution test-engine tombstone is not reclaimed");
      }
      engine.registerTombstone({
        allocationKey,
        specification,
        handle,
        binding,
        obligation,
        observation,
        productiveStarts: value.productiveStarts,
      });
    }
    for (const digest of engine.#heldOpen) {
      if (!engine.#keyBySpecification.has(digest) ||
          engine.#missingByKey.has(engine.#keyBySpecification.get(digest)!) ||
          engine.#tombstonesByKey.has(engine.#keyBySpecification.get(digest)!)) {
        fail("snapshot", "Execution test-engine held-open subject is not one active allocation");
      }
    }
    return engine;
  }

  facade(profile: FoundationExecutionBackendProfileV1): InMemoryExecutionBackend {
    if (profile.profileId !== "lifecycle.execution-backend-profile.fault-injection.v1" ||
        profile.backendKind !== "fault-injection" || profile.usage !== "test-only") {
      fail("profile", "In-memory test Backend refuses a non-test Backend Profile");
    }
    const selected = Object.freeze({
      profileId: profile.profileId,
      digest: profile.digest,
      implementationDigest: profile.implementation.implementationDigest,
    });
    if (this.#profileBinding !== null && canonicalJson(this.#profileBinding) !== canonicalJson(selected)) {
      fail("profile", "In-memory test engine is already bound to another exact Backend Profile");
    }
    this.#profileBinding ??= selected;
    return new InMemoryExecutionBackend(this, profile);
  }

  snapshot(): InMemoryExecutionBackendSnapshotV1 {
    const allocations = [...this.#byHandle.values()]
      .sort((left, right) => left.handle < right.handle ? -1 : left.handle > right.handle ? 1 : 0)
      .map((cell) => Object.freeze({
        allocationKey: cell.allocationKey,
        specification: cell.specification,
        handle: cell.handle,
        dispatched: cell.dispatched,
        dispatchEntryDigest: cell.dispatchEntryDigest,
        started: cell.started,
        terminal: cell.terminal,
        observationSequence: cell.observationSequence,
        lastObservation: cell.lastObservation,
        productiveStarts: cell.productiveStarts,
        output: snapshotOutput(cell.output),
        reclamationObligation: cell.reclamationObligation,
      }));
    const missingAllocations = [...this.#missingByHandle.values()]
      .sort((left, right) => left.handle < right.handle ? -1 : left.handle > right.handle ? 1 : 0)
      .map((missing) => Object.freeze({
        allocationKey: missing.allocationKey,
        specification: missing.specification,
        handle: missing.handle,
        dispatched: missing.dispatched,
        dispatchEntryDigest: missing.dispatchEntryDigest,
        observationSequence: missing.observationSequence,
        lastObservation: missing.lastObservation,
        productiveStarts: missing.productiveStarts,
      }));
    const reclamationTombstones = [...this.#tombstonesByHandle.values()]
      .sort((left, right) => left.handle < right.handle ? -1 : left.handle > right.handle ? 1 : 0)
      .map((tombstone) => Object.freeze({
        allocationKey: tombstone.allocationKey,
        specification: tombstone.specification,
        handle: tombstone.handle,
        binding: tombstone.binding,
        obligation: tombstone.obligation,
        observation: tombstone.observation,
        productiveStarts: tombstone.productiveStarts,
      }));
    const subject = {
      schema: "lifecycle.execution-test-engine-snapshot.private.v1" as const,
      engineSecret: this.#secret,
      profileBinding: this.#profileBinding,
      clock: this.#clock,
      heldOpenSpecificationDigests: [...this.#heldOpen].sort(),
      allocations,
      missingAllocations,
      reclamationTombstones,
    };
    return freezeJson(JSON.parse(canonicalJson({
      ...subject,
      digest: selfDigest(subject),
    })) as InMemoryExecutionBackendSnapshotV1);
  }

  armFault(point: InMemoryExecutionFaultPoint): void {
    this.#faults.set(point, (this.#faults.get(point) ?? 0) + 1);
  }

  holdOpen(specificationDigest: Sha256): void {
    this.#heldOpen.add(specificationDigest);
  }

  reportParentLoss(specificationDigest: Sha256): void {
    const key = this.#keyBySpecification.get(specificationDigest);
    const cell = key === undefined ? undefined : this.#byKey.get(key);
    if (cell === undefined || cell.specification.digest !== specificationDigest ||
        !cell.started || cell.terminal !== null) {
      fail("parent-loss", "Test Backend cannot report parent loss outside one running exact Cell");
    }
    this.finish(cell, "parent-loss");
  }

  async provideOutput(
    specification: FoundationExecutionSpecificationV1,
    output: FoundationRetrievedExecutionOutputV1,
  ): Promise<void> {
    const key = this.#keyBySpecification.get(specification.digest);
    const cell = key === undefined ? undefined : this.#byKey.get(key);
    if (cell === undefined || cell.specification.digest !== specification.digest) {
      fail("output", "Test Backend cannot attach output before exact allocation");
    }
    cell.output = await collectOutput(specification, output);
  }

  productiveStartCount(specificationDigest: Sha256): number {
    const key = this.#keyBySpecification.get(specificationDigest);
    if (key === undefined) return 0;
    return this.#byKey.get(key)?.productiveStarts ??
      this.#missingByKey.get(key)?.productiveStarts ??
      this.#tombstonesByKey.get(key)?.productiveStarts ?? 0;
  }

  reportReclamationRemainingOnce(handle: FoundationExecutionHandle): void {
    this.activeCell(handle);
    this.#remainingOnce.add(handle);
  }

  reportReclamationIntegrityRefusalOnce(handle: FoundationExecutionHandle): void {
    this.activeCell(handle);
    this.#integrityRefusalOnce.add(handle);
  }

  removePhysicalAllocationWithoutObservation(handle: FoundationExecutionHandle): void {
    const cell = this.activeCell(handle);
    if (cell.reclamationObligation !== null) {
      fail("snapshot", "Test Backend cannot bypass an exact Reclamation binding");
    }
    this.#byHandle.delete(handle);
    this.#byKey.delete(cell.allocationKey);
    this.#keyBySpecification.delete(cell.specification.digest);
    cell.output = null;
    this.#heldOpen.delete(cell.specification.digest);
    this.registerMissing({
      allocationKey: cell.allocationKey,
      specification: cell.specification,
      handle: cell.handle,
      dispatched: cell.dispatched,
      dispatchEntryDigest: cell.dispatchEntryDigest,
      observationSequence: cell.observationSequence,
      lastObservation: cell.lastObservation,
      productiveStarts: cell.productiveStarts,
    });
  }

  consume(point: InMemoryExecutionFaultPoint): boolean {
    const count = this.#faults.get(point) ?? 0;
    if (count === 0) return false;
    if (count === 1) this.#faults.delete(point);
    else this.#faults.set(point, count - 1);
    return true;
  }

  interrupted(): never {
    fail("interrupted", "Deterministic test Backend interrupted at an armed physical boundary");
  }

  now(): string {
    this.#clock += 1;
    return new Date(this.#clock).toISOString();
  }

  reclamationBinding(input: Readonly<{
    specification: FoundationExecutionSpecificationV1;
    handle: FoundationExecutionHandle;
    retirementCheckpointDigest: Sha256;
    dispatchAuthorityConsumed: boolean;
  }>): FoundationExecutionReclamationBindingV1 {
    const cell = this.activeCell(input.handle);
    if (cell.specification.digest !== input.specification.digest ||
        (cell.dispatched && !input.dispatchAuthorityConsumed)) {
      fail("reclamation-binding", "Test Backend Reclamation binding substituted retained facts");
    }
    return this.compileReclamationBinding({
      ...input,
      allocationKey: cell.allocationKey,
    });
  }

  private compileReclamationBinding(input: Readonly<{
    specification: FoundationExecutionSpecificationV1;
    handle: FoundationExecutionHandle;
    retirementCheckpointDigest: Sha256;
    dispatchAuthorityConsumed: boolean;
    allocationKey: FoundationExecutionAllocationKey;
  }>): FoundationExecutionReclamationBindingV1 {
    return compileExecutionReclamationBinding({
      ...input,
      backendBinding: Object.freeze({
        schema: "lifecycle.execution-test-reclamation-binding.private.v1",
        engineIdentityDigest: digestCanonical({
          schema: "lifecycle.execution-test-engine-identity.private.v1",
          engineSecret: this.#secret,
        }),
        allocationKeyDigest: foundationExecutionAllocationKeyBindingDigest(input.allocationKey),
      }),
    });
  }

  assertReclamationBinding(
    binding: FoundationExecutionReclamationBindingV1,
    allocationKey: FoundationExecutionAllocationKey,
  ): void {
    const value = binding.backendBinding;
    assertClosedObject(value, [
      "allocationKeyDigest",
      "engineIdentityDigest",
      "schema",
    ], "Execution test-engine Reclamation binding");
    if (value.schema !== "lifecycle.execution-test-reclamation-binding.private.v1" ||
        value.engineIdentityDigest !== digestCanonical({
          schema: "lifecycle.execution-test-engine-identity.private.v1",
          engineSecret: this.#secret,
        }) ||
        value.allocationKeyDigest !==
          foundationExecutionAllocationKeyBindingDigest(allocationKey)) {
      fail("reclamation-binding", "Test Backend Reclamation binding selected another allocation");
    }
  }

  activeCell(handle: FoundationExecutionHandle): Cell {
    const cell = this.#byHandle.get(handle);
    if (cell !== undefined) return cell;
    if (this.#tombstonesByHandle.has(handle)) {
      fail("reclaimed", "Execution allocation was physically reclaimed");
    }
    if (this.#missingByHandle.has(handle)) {
      fail("allocation-ambiguous", "Execution allocation is missing after its retained binding");
    }
    fail("handle", "Execution Handle is unknown to this Backend");
  }

  missing(handle: FoundationExecutionHandle): MissingAllocation | null {
    return this.#missingByHandle.get(handle) ?? null;
  }

  tombstone(handle: FoundationExecutionHandle): ReclamationTombstone | null {
    return this.#tombstonesByHandle.get(handle) ?? null;
  }

  allocate(
    specification: FoundationExecutionSpecificationV1,
    allocationKey: FoundationExecutionAllocationKey,
  ): Cell {
    assertFoundationExecutionAllocationKey(allocationKey);
    const existing = this.#byKey.get(allocationKey);
    if (existing !== undefined) {
      if (existing.specification.digest !== specification.digest) {
        fail("substitution", "Execution allocation key is already bound to another Specification");
      }
      return existing;
    }
    if (this.#missingByKey.has(allocationKey)) {
      fail("allocation-ambiguous", "Execution allocation key has a missing physical allocation");
    }
    if (this.#tombstonesByKey.has(allocationKey)) {
      fail("reclaimed", "Execution allocation key was permanently reclaimed");
    }
    const existingKey = this.#keyBySpecification.get(specification.digest);
    if (existingKey !== undefined) {
      fail("duplicate", "Execution Specification already has another retained allocation binding");
    }
    if (this.consume("allocate-before-create")) this.interrupted();
    const cell: Cell = {
      allocationKey,
      specification,
      handle: this.makeHandle(allocationKey, specification.digest),
      dispatched: false,
      dispatchEntryDigest: null,
      started: false,
      terminal: null,
      observationSequence: 0,
      lastObservation: null,
      productiveStarts: 0,
      output: null,
      reclamationObligation: null,
    };
    this.registerCell(cell);
    if (this.consume("allocate-after-create-before-return")) this.interrupted();
    return cell;
  }

  finish(cell: Cell, reason: "exited" | "cancelled" | "parent-loss"): void {
    if (cell.terminal !== null) return;
    cell.terminal = Object.freeze({
      finishedAt: this.now(),
      reason,
      exitCode: reason === "exited" ? 0 : null,
      signal: null,
      runnerDisposition: reason === "exited" ? "completed" : "incomplete",
    });
  }

  start(cell: Cell): void {
    if (cell.started) return;
    cell.started = true;
    cell.productiveStarts += 1;
    if (!this.#heldOpen.has(cell.specification.digest)) this.finish(cell, "exited");
  }

  observation(
    cell: Cell,
    override: "unavailable" | "ambiguous" | null = null,
  ): FoundationExecutionObservationV1 {
    cell.observationSequence += 1;
    const unavailable = override === "unavailable";
    const ambiguous = override === "ambiguous";
    const uncertain = unavailable || ambiguous;
    const terminal = cell.terminal;
    const running = cell.started && cell.terminal === null && !unavailable && !ambiguous;
    const completeOutput = !uncertain && terminal !== null && cell.output !== null;
    const subject = {
      schema: "lifecycle.execution-observation.v1" as const,
      specificationDigest: cell.specification.digest,
      backendProfile: cell.specification.backendProfile,
      imageDigest: cell.specification.image.imageDigest,
      inputSetDigest: cell.specification.inputSet.digest,
      observationSequence: cell.observationSequence,
      observedAt: this.now(),
      allocationState: unavailable ? "unavailable" as const :
        ambiguous ? "ambiguous" as const : "allocated" as const,
      dispatchState: cell.terminal !== null ? "terminal-observed" as const :
          cell.started ? "start-observed" as const :
            cell.dispatched ? "accepted" as const :
              ambiguous ? "ambiguous" as const : "not-observed" as const,
      processState: terminal !== null ? "terminal" as const :
        ambiguous ? "ambiguous" as const :
        unavailable ? "not-observed" as const :
          running ? "running" as const : "not-started" as const,
      terminal,
      containmentFacts: uncertain
        ? Object.freeze({
            rootProcess: terminal === null ? "unverified" as const : "terminal" as const,
            descendants: "unverified" as const,
            writers: "unverified" as const,
            credentials: "unverified" as const,
            providerChannel: "unverified" as const,
            outputMutation: "unverified" as const,
          })
        : running
          ? Object.freeze({
              rootProcess: "running" as const,
              descendants: "present" as const,
              writers: "present" as const,
              credentials: cell.specification.credentialPolicy.mode === "none"
                ? "not-injected" as const : "active" as const,
              providerChannel: cell.specification.networkPolicy.providerControlPlane === "none"
                ? "not-granted" as const : "reachable" as const,
              outputMutation: "possible" as const,
            })
          : Object.freeze({
              rootProcess: terminal === null ? "not-started" as const : "terminal" as const,
              descendants: "absent" as const,
              writers: "absent" as const,
              credentials: cell.specification.credentialPolicy.mode === "none"
                ? "not-injected" as const : "revoked" as const,
              providerChannel: cell.specification.networkPolicy.providerControlPlane === "none"
                ? "not-granted" as const : "unreachable" as const,
              outputMutation: "impossible" as const,
            }),
      output: Object.freeze({
        disposition: unavailable ? "unavailable" as const :
          ambiguous ? "ambiguous" as const :
            completeOutput ? "complete" as const : "not-produced" as const,
        manifestDigest: completeOutput ? cell.output!.manifest.digest : null,
        carrierByteLength: completeOutput ? cell.output!.carrierByteLength : null,
      }),
      resourceFacts: Object.freeze({
        wallTimeMilliseconds: null,
        cpuTimeMilliseconds: null,
        peakMemoryBytes: null,
        storageBytes: null,
        outputBytes: completeOutput ? cell.output!.manifest.aggregateByteLength : null,
        eventCount: null,
        limitBreaches: Object.freeze([]),
      }),
    };
    const observation = parseFoundationExecutionObservation({
      value: Object.freeze({ ...subject, digest: selfDigest(subject) }),
      specification: cell.specification,
      previous: cell.lastObservation,
    });
    cell.lastObservation = observation;
    return observation;
  }

  missingObservation(missing: MissingAllocation): FoundationExecutionObservationV1 {
    missing.observationSequence += 1;
    const previousTerminal = missing.lastObservation?.terminal ?? null;
    const previousDispatch = missing.lastObservation?.dispatchState;
    const dispatchState = previousDispatch !== undefined && previousDispatch !== "ambiguous"
      ? previousDispatch
      : missing.productiveStarts > 0
        ? "start-observed" as const
        : missing.dispatched
          ? "accepted" as const
          : "not-observed" as const;
    const subject = {
      schema: "lifecycle.execution-observation.v1" as const,
      specificationDigest: missing.specification.digest,
      backendProfile: missing.specification.backendProfile,
      imageDigest: missing.specification.image.imageDigest,
      inputSetDigest: missing.specification.inputSet.digest,
      observationSequence: missing.observationSequence,
      observedAt: this.now(),
      allocationState: "ambiguous" as const,
      dispatchState,
      processState: previousTerminal === null ? "ambiguous" as const : "terminal" as const,
      terminal: previousTerminal,
      containmentFacts: Object.freeze({
        rootProcess: previousTerminal === null ? "unverified" as const : "terminal" as const,
        descendants: "unverified" as const,
        writers: "unverified" as const,
        credentials: "unverified" as const,
        providerChannel: "unverified" as const,
        outputMutation: "unverified" as const,
      }),
      output: Object.freeze({
        disposition: "ambiguous" as const,
        manifestDigest: null,
        carrierByteLength: null,
      }),
      resourceFacts: Object.freeze({
        wallTimeMilliseconds: null,
        cpuTimeMilliseconds: null,
        peakMemoryBytes: null,
        storageBytes: null,
        outputBytes: null,
        eventCount: null,
        limitBreaches: Object.freeze([]),
      }),
    };
    const observation = parseFoundationExecutionObservation({
      value: Object.freeze({ ...subject, digest: selfDigest(subject) }),
      specification: missing.specification,
      previous: missing.lastObservation,
    });
    missing.lastObservation = observation;
    return observation;
  }

  completeReclamation(
    cell: Cell,
    binding: FoundationExecutionReclamationBindingV1,
    obligation: FoundationExecutionReclamationObligationV1,
    observation: FoundationExecutionReclamationObservationV1,
  ): void {
    this.#byHandle.delete(cell.handle);
    this.#byKey.delete(cell.allocationKey);
    this.#keyBySpecification.delete(cell.specification.digest);
    this.#heldOpen.delete(cell.specification.digest);
    cell.output = null;
    this.#remainingOnce.delete(cell.handle);
    this.#integrityRefusalOnce.delete(cell.handle);
    this.registerTombstone(Object.freeze({
      allocationKey: cell.allocationKey,
      specification: cell.specification,
      handle: cell.handle,
      binding,
      obligation,
      observation,
      productiveStarts: cell.productiveStarts,
    }));
  }

  consumeRemaining(handle: FoundationExecutionHandle): boolean {
    return this.#remainingOnce.delete(handle);
  }

  consumeIntegrityRefusal(handle: FoundationExecutionHandle): boolean {
    return this.#integrityRefusalOnce.delete(handle);
  }

  private makeHandle(
    allocationKey: FoundationExecutionAllocationKey,
    specificationDigest: Sha256,
  ): FoundationExecutionHandle {
    return privateFoundationExecutionHandle(
      digestCanonical({
        engineSecret: this.#secret,
        allocationKey,
        specificationDigest,
      }).replace("sha256:", "execution-handle-v1:"),
    );
  }

  private registerCell(cell: Cell): void {
    this.assertUnique(cell.allocationKey, cell.handle, cell.specification.digest);
    this.#byKey.set(cell.allocationKey, cell);
    this.#byHandle.set(cell.handle, cell);
    this.#keyBySpecification.set(cell.specification.digest, cell.allocationKey);
  }

  private registerMissing(missing: MissingAllocation): void {
    this.assertUnique(missing.allocationKey, missing.handle, missing.specification.digest);
    this.#missingByKey.set(missing.allocationKey, missing);
    this.#missingByHandle.set(missing.handle, missing);
    this.#keyBySpecification.set(missing.specification.digest, missing.allocationKey);
  }

  private registerTombstone(tombstone: ReclamationTombstone): void {
    this.assertUnique(
      tombstone.allocationKey,
      tombstone.handle,
      tombstone.specification.digest,
    );
    this.#tombstonesByKey.set(tombstone.allocationKey, tombstone);
    this.#tombstonesByHandle.set(tombstone.handle, tombstone);
    this.#keyBySpecification.set(tombstone.specification.digest, tombstone.allocationKey);
  }

  private assertUnique(
    allocationKey: FoundationExecutionAllocationKey,
    handle: FoundationExecutionHandle,
    specificationDigest: Sha256,
  ): void {
    if (this.#byKey.has(allocationKey) || this.#missingByKey.has(allocationKey) ||
        this.#tombstonesByKey.has(allocationKey) || this.#byHandle.has(handle) ||
        this.#missingByHandle.has(handle) || this.#tombstonesByHandle.has(handle) ||
        this.#keyBySpecification.has(specificationDigest)) {
      fail("snapshot", "Execution test-engine snapshot contains a duplicate allocation binding");
    }
  }
}

export class InMemoryExecutionBackend implements FoundationExecutionBackend {
  constructor(
    readonly engine: InMemoryExecutionBackendEngine,
    readonly profile: FoundationExecutionBackendProfileV1,
  ) {}

  async allocate(
    specification: FoundationExecutionSpecificationV1,
    allocationKey: FoundationExecutionAllocationKey,
  ): Promise<FoundationExecutionHandle> {
    if (!sameProfile(this.profile, specification)) {
      fail("binding", "Execution Specification does not bind this Backend Profile");
    }
    return this.engine.allocate(specification, allocationKey).handle;
  }

  async dispatch(handle: FoundationExecutionHandle): Promise<FoundationExecutionObservationV1> {
    const cell = this.engine.activeCell(handle);
    if (cell.dispatched) {
      fail("redispatch", "Execution dispatch authority was already consumed; observe the exact Handle");
    }
    cell.dispatchEntryDigest = physicalDispatchEntryDigest(
      cell.allocationKey,
      cell.specification.digest,
      cell.handle,
    );
    cell.dispatched = true;
    if (this.engine.consume("dispatch-before-start")) this.engine.interrupted();
    this.engine.start(cell);
    if (this.engine.consume("dispatch-after-start-before-return")) this.engine.interrupted();
    return this.engine.observation(cell);
  }

  async observe(handle: FoundationExecutionHandle): Promise<FoundationExecutionObservationV1> {
    if (this.engine.tombstone(handle) !== null) {
      fail("reclaimed", "Execution allocation was physically reclaimed");
    }
    const missing = this.engine.missing(handle);
    if (missing !== null) return this.engine.missingObservation(missing);
    const cell = this.engine.activeCell(handle);
    if (this.engine.consume("observe-unavailable")) {
      return this.engine.observation(cell, "unavailable");
    }
    if (this.engine.consume("observe-ambiguous")) {
      return this.engine.observation(cell, "ambiguous");
    }
    return this.engine.observation(cell);
  }

  async cancel(handle: FoundationExecutionHandle): Promise<FoundationExecutionObservationV1> {
    const cell = this.engine.activeCell(handle);
    if (cell.started && cell.terminal === null) {
      if (this.engine.consume("cancel-before-containment")) this.engine.interrupted();
      this.engine.finish(cell, "cancelled");
      if (this.engine.consume("cancel-after-containment-before-return")) this.engine.interrupted();
    }
    return this.engine.observation(cell);
  }

  async retrieve(
    handle: FoundationExecutionHandle,
    sourceObservation: FoundationExecutionObservationV1,
  ): Promise<FoundationExecutionRetrievalOutcomeV1> {
    const cell = this.engine.activeCell(handle);
    const source = parseFoundationExecutionObservation({
      value: sourceObservation,
      specification: cell.specification,
    });
    if (cell.lastObservation?.digest !== source.digest) {
      fail("retrieve-source", "Execution retrieval source was not the exact retained observation");
    }
    if (!executionObservationEstablishesContainment(source, cell.dispatched) ||
        cell.terminal === null) {
      fail("retrieve", "Execution Output cannot be retrieved outside exact Containment");
    }
    if (source.output.disposition !== "complete" || cell.output === null ||
        source.output.manifestDigest !== cell.output.manifest.digest ||
        source.output.carrierByteLength !== cell.output.carrierByteLength) {
      fail("retrieve", "Execution retrieval is not applicable without complete observed output");
    }
    if (this.engine.consume("retrieve-before-read")) this.engine.interrupted();
    const output = outputReader(cell.output, () => {
      if (this.engine.consume("retrieve-after-read-before-return")) {
        this.engine.interrupted();
      }
    });
    return compileFoundationExecutionRetrievalOutcome({
      specification: cell.specification,
      handle,
      observation: source,
      disposition: "complete",
      output,
    });
  }

  async createReclamationBinding(input: Readonly<{
    specification: FoundationExecutionSpecificationV1;
    handle: FoundationExecutionHandle;
    retirementCheckpointDigest: Sha256;
    dispatchAuthorityConsumed: boolean;
  }>): Promise<FoundationExecutionReclamationBindingV1> {
    if (!sameProfile(this.profile, input.specification)) {
      fail("binding", "Execution Specification does not bind this Backend Profile");
    }
    return this.engine.reclamationBinding(input);
  }

  async reclaim(
    specificationValue: FoundationExecutionSpecificationV1,
    bindingValue: FoundationExecutionReclamationBindingV1,
    obligationValue: FoundationExecutionReclamationObligationV1,
  ): Promise<FoundationExecutionReclamationObservationV1> {
    if (!sameProfile(this.profile, specificationValue)) {
      fail("binding", "Execution Specification does not bind this Backend Profile");
    }
    const binding = parseExecutionReclamationBinding(bindingValue, specificationValue);
    const handle = binding.handle;
    const tombstone = this.engine.tombstone(handle);
    if (tombstone !== null) {
      this.engine.assertReclamationBinding(binding, tombstone.allocationKey);
      if (binding.digest !== tombstone.binding.digest) {
        fail("reclamation-binding", "Reclaimed allocation is bound to another physical binding");
      }
      const obligation = parseExecutionReclamationObligation(
        obligationValue,
        tombstone.specification,
        binding,
      );
      if (obligation.digest !== tombstone.obligation.digest) {
        fail("reclamation-obligation", "Reclaimed allocation is bound to another obligation");
      }
      return parseExecutionReclamationObservation(
        tombstone.observation,
        tombstone.specification,
        obligation,
      );
    }
    const cell = this.engine.activeCell(handle);
    if (cell.specification.digest !== specificationValue.digest) {
      fail("reclamation-binding", "Execution Reclamation selected another Specification");
    }
    if (cell.dispatched && !binding.dispatchAuthorityConsumed) {
      fail(
        "reclamation-binding",
        "Execution Reclamation binding contradicts the physical dispatch entry",
      );
    }
    this.engine.assertReclamationBinding(binding, cell.allocationKey);
    const obligation = parseExecutionReclamationObligation(
      obligationValue,
      cell.specification,
      binding,
    );
    if (cell.reclamationObligation !== null &&
        cell.reclamationObligation.digest !== obligation.digest) {
      fail("reclamation-obligation", "Execution allocation is already bound to another obligation");
    }
    const observed = this.engine.observation(cell);
    if (!executionObservationEstablishesContainment(observed, cell.dispatched)) {
      fail("reclaim", "Execution allocation cannot be reclaimed before physical Containment");
    }
    cell.reclamationObligation ??= obligation;
    if (this.engine.consumeIntegrityRefusal(handle)) {
      return compileExecutionReclamationObservation({
        obligation,
        observedAt: this.engine.now(),
        disposition: "integrity-refusal",
        factsDigest: digestCanonical({
          obligationDigest: obligation.digest,
          allocationIdentityDigest: obligation.allocationIdentityDigest,
          physicalIdentityMatched: false,
        }),
      });
    }
    if (this.engine.consumeRemaining(handle)) {
      return compileExecutionReclamationObservation({
        obligation,
        observedAt: this.engine.now(),
        disposition: "remaining",
        factsDigest: digestCanonical({
          obligationDigest: obligation.digest,
          allocationIdentityDigest: obligation.allocationIdentityDigest,
          physicalAllocationPresent: true,
        }),
      });
    }
    if (this.engine.consume("reclaim-before-removal")) this.engine.interrupted();
    const reclaimed = compileExecutionReclamationObservation({
      obligation,
      observedAt: this.engine.now(),
      disposition: "reclaimed",
      factsDigest: digestCanonical({
        obligationDigest: obligation.digest,
        allocationIdentityDigest: obligation.allocationIdentityDigest,
        physicalAllocationAbsent: true,
      }),
    });
    this.engine.completeReclamation(cell, binding, obligation, reclaimed);
    if (this.engine.consume("reclaim-after-removal-before-return")) this.engine.interrupted();
    return reclaimed;
  }
}
