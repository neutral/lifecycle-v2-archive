import { randomBytes } from "node:crypto";
import type { ControlJsonObject } from "../control/types.js";
import { FoundationError } from "../error.js";
import {
  canonicalJson,
  digestCanonical,
  selfDigest,
  type Sha256,
} from "../validation/canonical.js";
import {
  parseFoundationExecutionObservation,
  type FoundationExecutionBackendProfileReferenceV1,
  type FoundationExecutionBackendProfileV1,
  type FoundationExecutionObservationV1,
  type FoundationExecutionOutputManifestV1,
  type FoundationExecutionSpecificationV1,
} from "./contracts.js";

declare const allocationKeyBrand: unique symbol;
declare const executionHandleBrand: unique symbol;

const MAXIMUM_BACKEND_RECLAMATION_BINDING_BYTES = 64 * 1024;

/** Private 256-bit allocation identity. It must never enter public facts. */
export type FoundationExecutionAllocationKey = string & {
  readonly [allocationKeyBrand]: true;
};

/** Opaque private coordinate. Only its owning Backend may interpret it. */
export type FoundationExecutionHandle = string & {
  readonly [executionHandleBrand]: true;
};

export type FoundationExecutionOutputEntryReaderV1 = Readonly<{
  path: string;
  byteLength: number;
  digest: Sha256;
  read(): AsyncIterable<Uint8Array>;
}>;

/**
 * Bounded path-free transport reader. Paths are normalized logical Manifest
 * paths; Backend, host, volume, and Cell coordinates are never exposed. The
 * Output owner streams and independently validates every declared byte.
 */
export type FoundationRetrievedExecutionOutputV1 = Readonly<{
  manifest: FoundationExecutionOutputManifestV1;
  carrierByteLength: number;
  entries(): AsyncIterable<FoundationExecutionOutputEntryReaderV1>;
}>;

/*
 * These execution contracts remain installation-private. Exported TypeScript
 * names let the private owners share one exact seam; they are not package,
 * protocol, CLI, TUI, or Delivery operations.
 */
type FoundationExecutionRetrievalOutcomeCoreV1 = Readonly<{
  schema: "lifecycle.execution-retrieval-outcome.private.v1";
  specificationDigest: Sha256;
  allocationIdentityDigest: Sha256;
  observationDigest: Sha256;
  factsDigest: Sha256;
}>;

export type FoundationExecutionRetrievalUnavailableReasonV1 =
  | "missing"
  | "partial"
  | "lost";

/** One closed physical retrieval result; it grants no workflow standing. */
export type FoundationExecutionRetrievalOutcomeV1 =
  | (FoundationExecutionRetrievalOutcomeCoreV1 & Readonly<{
      disposition: "complete";
      unavailableReason: null;
      output: FoundationRetrievedExecutionOutputV1;
    }>)
  | (FoundationExecutionRetrievalOutcomeCoreV1 & Readonly<{
      disposition: "unavailable";
      unavailableReason: FoundationExecutionRetrievalUnavailableReasonV1;
      output: null;
    }>);

type FoundationExecutionRetrievalCompilationV1 = Readonly<{
  specification: FoundationExecutionSpecificationV1;
  handle: FoundationExecutionHandle;
  observation: FoundationExecutionObservationV1;
}> & (
  | Readonly<{
      disposition: "complete";
      output: FoundationRetrievedExecutionOutputV1;
    }>
  | Readonly<{
      disposition: "unavailable";
      unavailableReason: FoundationExecutionRetrievalUnavailableReasonV1;
    }>
);

const RETRIEVAL_OUTCOME_KEYS = Object.freeze([
  "allocationIdentityDigest",
  "disposition",
  "factsDigest",
  "observationDigest",
  "output",
  "schema",
  "specificationDigest",
  "unavailableReason",
]);

function exactRetrievalOutcomeKeys(value: object): boolean {
  return Object.getOwnPropertySymbols(value).length === 0 &&
    canonicalJson(Object.getOwnPropertyNames(value).sort()) ===
      canonicalJson(RETRIEVAL_OUTCOME_KEYS);
}

function retrievalFacts(input: Readonly<{
  specificationDigest: Sha256;
  allocationIdentityDigest: Sha256;
  observationDigest: Sha256;
  disposition: FoundationExecutionRetrievalOutcomeV1["disposition"];
  unavailableReason: FoundationExecutionRetrievalUnavailableReasonV1 | null;
}>): Readonly<{
  schema: "lifecycle.execution-retrieval-outcome.private.v1";
  specificationDigest: Sha256;
  allocationIdentityDigest: Sha256;
  observationDigest: Sha256;
  disposition: FoundationExecutionRetrievalOutcomeV1["disposition"];
  unavailableReason: FoundationExecutionRetrievalUnavailableReasonV1 | null;
}> {
  return Object.freeze({
    schema: "lifecycle.execution-retrieval-outcome.private.v1" as const,
    specificationDigest: input.specificationDigest,
    allocationIdentityDigest: input.allocationIdentityDigest,
    observationDigest: input.observationDigest,
    disposition: input.disposition,
    unavailableReason: input.unavailableReason,
  });
}

function exactRetrievedOutputShape(value: unknown): value is FoundationRetrievedExecutionOutputV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.getOwnPropertySymbols(value).length !== 0 ||
      canonicalJson(Object.getOwnPropertyNames(value).sort()) !==
        canonicalJson(["carrierByteLength", "entries", "manifest"]) ||
      !Number.isSafeInteger((value as FoundationRetrievedExecutionOutputV1).carrierByteLength) ||
      (value as FoundationRetrievedExecutionOutputV1).carrierByteLength < 0 ||
      typeof (value as FoundationRetrievedExecutionOutputV1).entries !== "function") {
    return false;
  }
  const manifest = (value as FoundationRetrievedExecutionOutputV1).manifest;
  return manifest !== null && typeof manifest === "object" && !Array.isArray(manifest) &&
    typeof manifest.digest === "string" && /^sha256:[a-f0-9]{64}$/u.test(manifest.digest);
}

export function parseFoundationExecutionRetrievalOutcome(input: Readonly<{
  value: unknown;
  specification: FoundationExecutionSpecificationV1;
  handle: FoundationExecutionHandle;
}>): FoundationExecutionRetrievalOutcomeV1 {
  const { value } = input;
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      !exactRetrievalOutcomeKeys(value)) {
    throw new FoundationError(
      "lifecycle.execution.retrieval-outcome-invalid",
      "Execution retrieval outcome is not one exact closed private result",
    );
  }
  const record = value as Record<string, unknown>;
  const disposition = record.disposition;
  const unavailableReason = record.unavailableReason;
  if (record.schema !== "lifecycle.execution-retrieval-outcome.private.v1" ||
      record.specificationDigest !== input.specification.digest ||
      record.allocationIdentityDigest !==
        foundationExecutionAllocationIdentityDigest(input.handle) ||
      typeof record.observationDigest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(record.observationDigest) ||
      !((disposition === "complete" && unavailableReason === null &&
          exactRetrievedOutputShape(record.output) &&
          record.output.manifest.specificationDigest === input.specification.digest) ||
        (disposition === "unavailable" && record.output === null &&
          (unavailableReason === "missing" || unavailableReason === "partial" ||
            unavailableReason === "lost")))) {
    throw new FoundationError(
      "lifecycle.execution.retrieval-outcome-invalid",
      "Execution retrieval outcome substituted its exact subject or disposition",
    );
  }
  const facts = retrievalFacts({
    specificationDigest: input.specification.digest,
    allocationIdentityDigest: record.allocationIdentityDigest as Sha256,
    observationDigest: record.observationDigest as Sha256,
    disposition,
    unavailableReason: unavailableReason as FoundationExecutionRetrievalUnavailableReasonV1 | null,
  });
  if (record.factsDigest !== digestCanonical(facts)) {
    throw new FoundationError(
      "lifecycle.execution.retrieval-outcome-invalid",
      "Execution retrieval outcome failed its exact facts binding",
    );
  }
  return Object.freeze({
    ...facts,
    factsDigest: record.factsDigest as Sha256,
    output: disposition === "complete"
      ? record.output as FoundationRetrievedExecutionOutputV1
      : null,
  }) as FoundationExecutionRetrievalOutcomeV1;
}

export function compileFoundationExecutionRetrievalOutcome(
  input: FoundationExecutionRetrievalCompilationV1,
): FoundationExecutionRetrievalOutcomeV1 {
  const observation = parseFoundationExecutionObservation({
    value: input.observation,
    specification: input.specification,
  });
  const observedDisposition = observation.output.disposition;
  const unavailableReason = input.disposition === "complete" ? null : input.unavailableReason;
  const directUnavailableReason = observedDisposition === "missing"
    ? "missing" as const
    : observedDisposition === "partial"
      ? "partial" as const
      : observedDisposition === "unavailable"
        ? "lost" as const
        : null;
  if (input.disposition === "complete") {
    if (observedDisposition !== "complete" || !exactRetrievedOutputShape(input.output) ||
        input.output.manifest.digest !== observation.output.manifestDigest ||
        input.output.carrierByteLength !== observation.output.carrierByteLength) {
      throw new FoundationError(
        "lifecycle.execution.retrieval-outcome-invalid",
        "Complete retrieval transport differs from its exact source observation",
      );
    }
  } else if (observedDisposition !== "complete" &&
      directUnavailableReason !== input.unavailableReason) {
    throw new FoundationError(
      "lifecycle.execution.retrieval-outcome-invalid",
      "Unavailable retrieval reason differs from its exact source observation",
    );
  }
  const facts = retrievalFacts({
    specificationDigest: input.specification.digest,
    allocationIdentityDigest: foundationExecutionAllocationIdentityDigest(input.handle),
    observationDigest: observation.digest,
    disposition: input.disposition,
    unavailableReason,
  });
  return parseFoundationExecutionRetrievalOutcome({
    value: Object.freeze({
      ...facts,
      factsDigest: digestCanonical(facts),
      output: input.disposition === "complete" ? input.output : null,
    }),
    specification: input.specification,
    handle: input.handle,
  });
}

export type FoundationExecutionReclamationObservationV1 = Readonly<{
  schema: "lifecycle.execution-reclamation-observation.private.v1";
  specificationDigest: Sha256;
  obligationDigest: Sha256;
  observedAt: string;
  disposition: "reclaimed" | "remaining" | "integrity-refusal";
  factsDigest: Sha256;
  digest: Sha256;
}>;

/**
 * Backend-neutral, installation-private carrier for the exact physical facts
 * required after the owning Activity support has been disposed. The Runtime
 * validates the envelope; only the selected Backend interprets
 * `backendBinding`.
 */
export type FoundationExecutionReclamationBindingV1 = Readonly<{
  schema: "lifecycle.execution-reclamation-binding.private.v1";
  specificationDigest: Sha256;
  backendProfile: FoundationExecutionBackendProfileReferenceV1;
  handle: FoundationExecutionHandle;
  allocationIdentityDigest: Sha256;
  retirementCheckpointDigest: Sha256;
  dispatchAuthorityConsumed: boolean;
  backendBinding: ControlJsonObject;
  backendBindingDigest: Sha256;
  digest: Sha256;
}>;

/**
 * Immutable Runtime-created handoff from durable Retirement to private
 * Reclamation. Raw allocation keys and Handles never enter the obligation.
 */
export type FoundationExecutionReclamationObligationV1 = Readonly<{
  schema: "lifecycle.execution-reclamation-obligation.private.v1";
  specificationDigest: Sha256;
  backendProfile: FoundationExecutionBackendProfileReferenceV1;
  allocationIdentityDigest: Sha256;
  retirementCheckpointDigest: Sha256;
  reclamationBindingDigest: Sha256;
  digest: Sha256;
}>;

/**
 * Runtime-private physical adapter. It owns no Delivery operation, authority,
 * Candidate meaning, Evidence meaning, Process state, or Retirement decision.
 */
export interface FoundationExecutionBackend {
  readonly profile: FoundationExecutionBackendProfileV1;

  allocate(
    specification: FoundationExecutionSpecificationV1,
    allocationKey: FoundationExecutionAllocationKey,
  ): Promise<FoundationExecutionHandle>;

  /** Physically at-most-once. Durable dispatch authority is owned by Activity. */
  dispatch(handle: FoundationExecutionHandle): Promise<FoundationExecutionObservationV1>;

  observe(handle: FoundationExecutionHandle): Promise<FoundationExecutionObservationV1>;

  cancel(handle: FoundationExecutionHandle): Promise<FoundationExecutionObservationV1>;

  retrieve(
    handle: FoundationExecutionHandle,
    sourceObservation: FoundationExecutionObservationV1,
  ): Promise<FoundationExecutionRetrievalOutcomeV1>;

  /**
   * Snapshot exact physical Reclamation facts against a Runtime-selected
   * Retirement coordinate. This creates no Retirement authority or Process
   * transition and must be deterministic for the same exact allocation.
   */
  createReclamationBinding(input: Readonly<{
    specification: FoundationExecutionSpecificationV1;
    handle: FoundationExecutionHandle;
    retirementCheckpointDigest: Sha256;
    dispatchAuthorityConsumed: boolean;
  }>): Promise<FoundationExecutionReclamationBindingV1>;

  reclaim(
    specification: FoundationExecutionSpecificationV1,
    binding: FoundationExecutionReclamationBindingV1,
    obligation: FoundationExecutionReclamationObligationV1,
  ): Promise<FoundationExecutionReclamationObservationV1>;
}

export function createFoundationExecutionAllocationKey(): FoundationExecutionAllocationKey {
  return `allocation-v1:${randomBytes(32).toString("hex")}` as FoundationExecutionAllocationKey;
}

export function assertFoundationExecutionAllocationKey(
  value: unknown,
): asserts value is FoundationExecutionAllocationKey {
  if (typeof value !== "string" || !/^allocation-v1:[a-f0-9]{64}$/u.test(value)) {
    throw new FoundationError(
      "lifecycle.execution.allocation-key-invalid",
      "Execution allocation key is not one exact private 256-bit value",
    );
  }
}

/** Canonical private binding retained without exposing the allocation key. */
export function foundationExecutionAllocationKeyBindingDigest(
  allocationKey: FoundationExecutionAllocationKey,
): Sha256 {
  assertFoundationExecutionAllocationKey(allocationKey);
  return digestCanonical({
    schema: "lifecycle.execution-allocation-key-binding.private.v1",
    allocationKey,
  });
}

/** Backend implementations alone may create opaque handles. */
export function privateFoundationExecutionHandle(value: string): FoundationExecutionHandle {
  if (!/^execution-handle-v1:[a-f0-9]{64}$/u.test(value)) {
    throw new FoundationError(
      "lifecycle.execution.handle-invalid",
      "Execution Backend produced an invalid opaque Handle",
    );
  }
  return value as FoundationExecutionHandle;
}

export function foundationExecutionAllocationIdentityDigest(
  handle: FoundationExecutionHandle,
): Sha256 {
  privateFoundationExecutionHandle(handle);
  return digestCanonical({
    schema: "lifecycle.execution-allocation-identity.private.v1",
    handle,
  });
}

function exactPrivateJsonObject(value: unknown): ControlJsonObject {
  let bytes: string;
  try {
    bytes = canonicalJson(value);
  } catch {
    throw new FoundationError(
      "lifecycle.execution.reclamation-binding-invalid",
      "Execution Reclamation backend binding is not canonical JSON",
    );
  }
  if (Buffer.byteLength(bytes, "utf8") > MAXIMUM_BACKEND_RECLAMATION_BINDING_BYTES) {
    throw new FoundationError(
      "lifecycle.execution.reclamation-binding-invalid",
      "Execution Reclamation backend binding exceeds its private byte bound",
    );
  }
  const parsed = JSON.parse(bytes) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new FoundationError(
      "lifecycle.execution.reclamation-binding-invalid",
      "Execution Reclamation backend binding is not one JSON object",
    );
  }
  const freeze = (selected: unknown): void => {
    if (selected === null || typeof selected !== "object" || Object.isFrozen(selected)) return;
    for (const child of Object.values(selected)) freeze(child);
    Object.freeze(selected);
  };
  freeze(parsed);
  return parsed as ControlJsonObject;
}

function normalizedReclamationBinding(
  value: unknown,
  specification: FoundationExecutionSpecificationV1,
): FoundationExecutionReclamationBindingV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new FoundationError(
      "lifecycle.execution.reclamation-binding-invalid",
      "Execution Reclamation binding is not one exact closed object",
    );
  }
  let record: Record<string, unknown>;
  try {
    record = JSON.parse(canonicalJson(value)) as Record<string, unknown>;
  } catch {
    throw new FoundationError(
      "lifecycle.execution.reclamation-binding-invalid",
      "Execution Reclamation binding is not canonical JSON",
    );
  }
  const expected = [
    "allocationIdentityDigest",
    "backendBinding",
    "backendBindingDigest",
    "backendProfile",
    "digest",
    "dispatchAuthorityConsumed",
    "handle",
    "retirementCheckpointDigest",
    "schema",
    "specificationDigest",
  ];
  const backendProfile = record.backendProfile;
  if (canonicalJson(Object.keys(record).sort()) !== canonicalJson(expected) ||
      record.schema !== "lifecycle.execution-reclamation-binding.private.v1" ||
      record.specificationDigest !== specification.digest ||
      backendProfile === null || typeof backendProfile !== "object" ||
      Array.isArray(backendProfile) ||
      canonicalJson(backendProfile) !== canonicalJson(specification.backendProfile) ||
      typeof record.handle !== "string" ||
      typeof record.retirementCheckpointDigest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(record.retirementCheckpointDigest) ||
      typeof record.dispatchAuthorityConsumed !== "boolean") {
    throw new FoundationError(
      "lifecycle.execution.reclamation-binding-invalid",
      "Execution Reclamation binding does not select its exact Specification and Retirement",
    );
  }
  const handle = privateFoundationExecutionHandle(record.handle);
  const backendBinding = exactPrivateJsonObject(record.backendBinding);
  const backendBindingDigest = digestCanonical(backendBinding);
  if (record.allocationIdentityDigest !== foundationExecutionAllocationIdentityDigest(handle) ||
      record.backendBindingDigest !== backendBindingDigest ||
      record.digest !== selfDigest(record, "digest")) {
    throw new FoundationError(
      "lifecycle.execution.reclamation-binding-invalid",
      "Execution Reclamation binding substituted its exact physical facts",
    );
  }
  return Object.freeze({
    schema: "lifecycle.execution-reclamation-binding.private.v1" as const,
    specificationDigest: specification.digest,
    backendProfile: specification.backendProfile,
    handle,
    allocationIdentityDigest: record.allocationIdentityDigest as Sha256,
    retirementCheckpointDigest: record.retirementCheckpointDigest as Sha256,
    dispatchAuthorityConsumed: record.dispatchAuthorityConsumed,
    backendBinding,
    backendBindingDigest,
    digest: record.digest as Sha256,
  });
}

export function compileExecutionReclamationBinding(input: Readonly<{
  specification: FoundationExecutionSpecificationV1;
  handle: FoundationExecutionHandle;
  retirementCheckpointDigest: Sha256;
  dispatchAuthorityConsumed: boolean;
  backendBinding: ControlJsonObject;
}>): FoundationExecutionReclamationBindingV1 {
  const handle = privateFoundationExecutionHandle(input.handle);
  if (!/^sha256:[a-f0-9]{64}$/u.test(input.retirementCheckpointDigest) ||
      typeof input.dispatchAuthorityConsumed !== "boolean") {
    throw new FoundationError(
      "lifecycle.execution.reclamation-binding-invalid",
      "Execution Reclamation binding requires exact Runtime Retirement facts",
    );
  }
  const backendBinding = exactPrivateJsonObject(input.backendBinding);
  const subject = Object.freeze({
    schema: "lifecycle.execution-reclamation-binding.private.v1" as const,
    specificationDigest: input.specification.digest,
    backendProfile: input.specification.backendProfile,
    handle,
    allocationIdentityDigest: foundationExecutionAllocationIdentityDigest(handle),
    retirementCheckpointDigest: input.retirementCheckpointDigest,
    dispatchAuthorityConsumed: input.dispatchAuthorityConsumed,
    backendBinding,
    backendBindingDigest: digestCanonical(backendBinding),
  });
  return normalizedReclamationBinding(
    Object.freeze({ ...subject, digest: selfDigest(subject) }),
    input.specification,
  );
}

export function parseExecutionReclamationBinding(
  value: unknown,
  specification: FoundationExecutionSpecificationV1,
  expected?: Readonly<{
    handle: FoundationExecutionHandle;
    retirementCheckpointDigest: Sha256;
    dispatchAuthorityConsumed: boolean;
  }>,
): FoundationExecutionReclamationBindingV1 {
  const binding = normalizedReclamationBinding(value, specification);
  if (expected !== undefined && (binding.handle !== expected.handle ||
      binding.retirementCheckpointDigest !== expected.retirementCheckpointDigest ||
      binding.dispatchAuthorityConsumed !== expected.dispatchAuthorityConsumed)) {
    throw new FoundationError(
      "lifecycle.execution.reclamation-binding-invalid",
      "Execution Reclamation binding selects another allocation or Retirement",
    );
  }
  return binding;
}

function isExactReclamationObligationEnvelope(
  value: unknown,
): value is FoundationExecutionReclamationObligationV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as unknown as Record<string, unknown>;
  const backendProfile = record.backendProfile;
  if (backendProfile === null || typeof backendProfile !== "object" ||
      Array.isArray(backendProfile)) return false;
  const profile = backendProfile as Record<string, unknown>;
  const sha = (candidate: unknown): boolean =>
    typeof candidate === "string" && /^sha256:[a-f0-9]{64}$/u.test(candidate);
  return canonicalJson(Object.keys(record).sort()) === canonicalJson([
    "allocationIdentityDigest",
    "backendProfile",
    "digest",
    "reclamationBindingDigest",
    "retirementCheckpointDigest",
    "schema",
    "specificationDigest",
  ]) && canonicalJson(Object.keys(profile).sort()) === canonicalJson([
    "implementationDigest",
    "profileDigest",
    "profileId",
  ]) && record.schema === "lifecycle.execution-reclamation-obligation.private.v1" &&
    (profile.profileId === "lifecycle.execution-backend-profile.docker-local.v1" ||
      profile.profileId === "lifecycle.execution-backend-profile.fault-injection.v1") &&
    sha(record.specificationDigest) && sha(record.allocationIdentityDigest) &&
    sha(record.retirementCheckpointDigest) && sha(record.reclamationBindingDigest) &&
    sha(profile.profileDigest) &&
    sha(profile.implementationDigest) && record.digest === selfDigest(record, "digest");
}

export function compileExecutionReclamationObligation(input: Readonly<{
  specification: FoundationExecutionSpecificationV1;
  handle: FoundationExecutionHandle;
  retirementCheckpointDigest: Sha256;
  reclamationBinding: FoundationExecutionReclamationBindingV1;
}>): FoundationExecutionReclamationObligationV1 {
  if (!/^sha256:[a-f0-9]{64}$/u.test(input.retirementCheckpointDigest)) {
    throw new FoundationError(
      "lifecycle.execution.reclamation-obligation-invalid",
      "Execution Reclamation Obligation requires one exact Retirement checkpoint digest",
    );
  }
  const binding = parseExecutionReclamationBinding(
    input.reclamationBinding,
    input.specification,
    {
      handle: input.handle,
      retirementCheckpointDigest: input.retirementCheckpointDigest,
      dispatchAuthorityConsumed: input.reclamationBinding.dispatchAuthorityConsumed,
    },
  );
  const subject = Object.freeze({
    schema: "lifecycle.execution-reclamation-obligation.private.v1" as const,
    specificationDigest: input.specification.digest,
    backendProfile: input.specification.backendProfile,
    allocationIdentityDigest: foundationExecutionAllocationIdentityDigest(input.handle),
    retirementCheckpointDigest: input.retirementCheckpointDigest,
    reclamationBindingDigest: binding.digest,
  });
  return Object.freeze({
    ...subject,
    digest: selfDigest(subject),
  });
}

export function parseExecutionReclamationObligation(
  value: unknown,
  specification: FoundationExecutionSpecificationV1,
  bindingInput: FoundationExecutionReclamationBindingV1,
): FoundationExecutionReclamationObligationV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new FoundationError(
      "lifecycle.execution.reclamation-obligation-invalid",
      "Execution Reclamation Obligation is not one exact closed object",
    );
  }
  const normalized = JSON.parse(canonicalJson(value)) as Record<string, unknown>;
  const keys = Object.keys(normalized).sort();
  const expected = [
    "allocationIdentityDigest",
    "backendProfile",
    "digest",
    "reclamationBindingDigest",
    "retirementCheckpointDigest",
    "schema",
    "specificationDigest",
  ];
  const backendProfileValue = normalized.backendProfile;
  const backendProfile = backendProfileValue !== null &&
      typeof backendProfileValue === "object" && !Array.isArray(backendProfileValue)
    ? backendProfileValue as Record<string, unknown>
    : null;
  const backendProfileKeys = backendProfile === null ? [] : Object.keys(backendProfile).sort();
  const expectedBackendProfileKeys = [
    "implementationDigest",
    "profileDigest",
    "profileId",
  ];
  const binding = normalizedReclamationBinding(bindingInput, specification);
  if (canonicalJson(keys) !== canonicalJson(expected) ||
      normalized.schema !== "lifecycle.execution-reclamation-obligation.private.v1" ||
      normalized.specificationDigest !== specification.digest ||
      normalized.allocationIdentityDigest !== binding.allocationIdentityDigest ||
      typeof normalized.retirementCheckpointDigest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(normalized.retirementCheckpointDigest) ||
      normalized.retirementCheckpointDigest !== binding.retirementCheckpointDigest ||
      normalized.reclamationBindingDigest !== binding.digest ||
      backendProfile === null ||
      canonicalJson(backendProfileKeys) !== canonicalJson(expectedBackendProfileKeys) ||
      backendProfile.profileId !== specification.backendProfile.profileId ||
      backendProfile.profileDigest !== specification.backendProfile.profileDigest ||
      backendProfile.implementationDigest !== specification.backendProfile.implementationDigest ||
      normalized.digest !== selfDigest(normalized, "digest")) {
    throw new FoundationError(
      "lifecycle.execution.reclamation-obligation-invalid",
      "Execution Reclamation Obligation does not bind its exact retired allocation",
    );
  }
  const frozenProfile = Object.freeze(backendProfile) as FoundationExecutionBackendProfileReferenceV1;
  return Object.freeze({
    ...normalized,
    backendProfile: frozenProfile,
  }) as FoundationExecutionReclamationObligationV1;
}

export function compileExecutionReclamationObservation(input: Readonly<{
  obligation: FoundationExecutionReclamationObligationV1;
  observedAt: string;
  disposition: FoundationExecutionReclamationObservationV1["disposition"];
  factsDigest: Sha256;
}>): FoundationExecutionReclamationObservationV1 {
  if (!isExactReclamationObligationEnvelope(input.obligation)) {
    throw new FoundationError(
      "lifecycle.execution.reclamation-invalid",
      "Execution Reclamation Observation requires one exact Reclamation Obligation",
    );
  }
  const subject = Object.freeze({
    schema: "lifecycle.execution-reclamation-observation.private.v1" as const,
    specificationDigest: input.obligation.specificationDigest,
    obligationDigest: input.obligation.digest,
    observedAt: input.observedAt,
    disposition: input.disposition,
    factsDigest: input.factsDigest,
  });
  return Object.freeze({
    ...subject,
    digest: selfDigest(subject),
  });
}

export function parseExecutionReclamationObservation(
  value: unknown,
  specification: FoundationExecutionSpecificationV1,
  obligation: FoundationExecutionReclamationObligationV1,
): FoundationExecutionReclamationObservationV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new FoundationError(
      "lifecycle.execution.reclamation-invalid",
      "Execution Reclamation Observation is not one exact closed object",
    );
  }
  const normalized = JSON.parse(canonicalJson(value)) as Record<string, unknown>;
  const keys = Object.keys(normalized).sort();
  const expected = [
    "digest",
    "disposition",
    "factsDigest",
    "obligationDigest",
    "observedAt",
    "schema",
    "specificationDigest",
  ];
  if (canonicalJson(keys) !== canonicalJson(expected) ||
      normalized.schema !== "lifecycle.execution-reclamation-observation.private.v1" ||
      normalized.specificationDigest !== specification.digest ||
      !isExactReclamationObligationEnvelope(obligation) ||
      obligation.specificationDigest !== specification.digest ||
      obligation.backendProfile.profileId !== specification.backendProfile.profileId ||
      obligation.backendProfile.profileDigest !== specification.backendProfile.profileDigest ||
      obligation.backendProfile.implementationDigest !==
        specification.backendProfile.implementationDigest ||
      normalized.obligationDigest !== obligation.digest ||
      !(normalized.disposition === "reclaimed" || normalized.disposition === "remaining" ||
        normalized.disposition === "integrity-refusal") ||
      typeof normalized.factsDigest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(normalized.factsDigest) ||
      typeof normalized.observedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(normalized.observedAt) ||
      Number.isNaN(Date.parse(normalized.observedAt)) ||
      new Date(normalized.observedAt).toISOString() !== normalized.observedAt ||
      normalized.digest !== selfDigest(normalized, "digest")) {
    throw new FoundationError(
      "lifecycle.execution.reclamation-invalid",
      "Execution Reclamation Observation does not bind one exact result for its Specification",
    );
  }
  return Object.freeze(normalized) as FoundationExecutionReclamationObservationV1;
}
