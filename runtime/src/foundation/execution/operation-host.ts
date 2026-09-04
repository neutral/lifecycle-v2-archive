import { FoundationError } from "../error.js";
import type { ControlJsonObject } from "../control/types.js";
import {
  canonicalJson,
  digestCanonical,
  selfDigest,
  type Sha256,
} from "../validation/canonical.js";
import {
  assertFoundationExecutionAllocationKey,
  compileExecutionReclamationObligation,
  createFoundationExecutionAllocationKey,
  parseFoundationExecutionRetrievalOutcome,
  parseExecutionReclamationBinding,
  parseExecutionReclamationObligation,
  privateFoundationExecutionHandle,
  type FoundationExecutionAllocationKey,
  type FoundationExecutionBackend,
  type FoundationExecutionHandle,
  type FoundationExecutionReclamationBindingV1,
  type FoundationExecutionReclamationObligationV1,
  type FoundationRetrievedExecutionOutputV1,
} from "./backend.js";
import {
  executionObservationEstablishesContainment,
  parseFoundationExecutionBackendProfile,
  parseFoundationExecutionObservation,
  parseFoundationExecutionSpecification,
  type FoundationExecutionBackendProfileReferenceV1,
  type FoundationExecutionObservationV1,
  type FoundationExecutionSpecificationV1,
} from "./contracts.js";
import {
  classifyFoundationExecutionOutputValidationFailure,
  reopenFoundationValidatedExecutionOutput,
  validateFoundationExecutionOutput,
  type FoundationValidatedExecutionOutputV1,
} from "./output-validation.js";
import {
  parseFoundationExecutionOutputStoreBindingV1,
  type FoundationExecutionOutputStoreBindingV1,
  type FoundationExecutionOutputStoreV1,
} from "./output-store-v1.js";

export const FOUNDATION_EXECUTION_OPERATION_CHECKPOINT_SCHEMA =
  "lifecycle.execution-operation-checkpoint.private.v2" as const;

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const CANONICAL_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAXIMUM_TERMINAL_COMPLETION_BYTES = 64 * 1024;

export type FoundationExecutionContainmentFactV1 = Readonly<{
  schema: "lifecycle.execution-containment.private.v1";
  observationDigest: Sha256;
  establishedAt: string;
  backendEffectObserved: boolean;
  digest: Sha256;
}>;

/**
 * Owner-interpreted terminal facts captured after Containment through a
 * retrieval that carries no dispatch authority. The execution host binds and
 * reopens the opaque value but never derives provider, Check, or Process
 * meaning from it.
 */
export type FoundationExecutionTerminalCompletionFactV1 =
  | Readonly<{
      schema: "lifecycle.execution-terminal-completion.private.v1";
      specificationDigest: Sha256;
      observationDigest: Sha256;
      capturedAt: string;
      disposition: "observed";
      value: ControlJsonObject;
      valueDigest: Sha256;
      failureFactsDigest: null;
      digest: Sha256;
    }>
  | Readonly<{
      schema: "lifecycle.execution-terminal-completion.private.v1";
      specificationDigest: Sha256;
      observationDigest: Sha256;
      capturedAt: string;
      disposition: "invalid";
      value: null;
      valueDigest: null;
      failureFactsDigest: Sha256;
      digest: Sha256;
    }>;

export type FoundationExecutionOutputFactV1 = Readonly<{
  schema: "lifecycle.execution-output-fact.private.v1";
  observationDigest: Sha256;
  disposition: FoundationExecutionObservationV1["output"]["disposition"];
  manifestDigest: Sha256 | null;
  carrierByteLength: number | null;
  validation: "not-applicable" | "valid" | "invalid" | "unavailable";
  validatedAt: string | null;
  runnerDigest: Sha256 | null;
  artifactInventoryDigest: Sha256 | null;
  outputStoreBinding: FoundationExecutionOutputStoreBindingV1 | null;
  failureFactsDigest: Sha256 | null;
  digest: Sha256;
}>;

export type FoundationExecutionRetirementFactV1 = Readonly<{
  schema: "lifecycle.execution-retirement.private.v1";
  specificationDigest: Sha256;
  retiredAt: string;
  finalObservationDigest: Sha256;
  containmentDigest: Sha256;
  terminalCompletionDigest: Sha256 | null;
  outputDigest: Sha256;
  dispatchAuthorityConsumed: boolean;
  retirementCheckpointDigest: Sha256;
  reclamationBinding: FoundationExecutionReclamationBindingV1;
  reclamationObligation: FoundationExecutionReclamationObligationV1;
  digest: Sha256;
}>;

/**
 * Activity-private physical facts. Their presence cannot select an operation,
 * authorize execution, or advance Delivery. In particular, this value has no
 * owner-local phase or stage member: the sole Delivery reducer interprets it
 * only under an already selected Activity recovery coordinate.
 */
export type FoundationExecutionOperationCheckpointV1 = Readonly<{
  schema: typeof FOUNDATION_EXECUTION_OPERATION_CHECKPOINT_SCHEMA;
  specificationDigest: Sha256;
  backendProfile: FoundationExecutionBackendProfileReferenceV1;
  openedAt: string;
  allocationKey: FoundationExecutionAllocationKey;
  handle: FoundationExecutionHandle | null;
  dispatchAuthorityConsumedAt: string | null;
  containmentRequestedAt: string | null;
  observation: FoundationExecutionObservationV1 | null;
  containment: FoundationExecutionContainmentFactV1 | null;
  terminalCompletion: FoundationExecutionTerminalCompletionFactV1 | null;
  output: FoundationExecutionOutputFactV1 | null;
  retirement: FoundationExecutionRetirementFactV1 | null;
  digest: Sha256;
}>;

export type FoundationExecutionOperationCheckpointCoordinateV1 = Readonly<{
  revision: number;
  checkpointDigest: Sha256;
  /** Opaque exact-owner/state binding interpreted only by checkpoint persistence. */
  persistenceDigest: Sha256;
}>;

export type FoundationRetainedExecutionOperationCheckpointV1 = Readonly<{
  coordinate: FoundationExecutionOperationCheckpointCoordinateV1;
  checkpoint: FoundationExecutionOperationCheckpointV1;
}>;

/**
 * Durable private compare-and-swap seam. An Activity-kernel adapter can own
 * this contract without teaching the execution host about Journal or Process
 * meaning. A write that commits and then loses its response remains visible to
 * the next `read` and is never guessed from process memory.
 */
export interface FoundationExecutionOperationCheckpointPersistenceV1 {
  read(
    specificationDigest: Sha256,
  ): Promise<FoundationRetainedExecutionOperationCheckpointV1 | null>;

  compareExchange(input: Readonly<{
    specificationDigest: Sha256;
    expected: FoundationExecutionOperationCheckpointCoordinateV1 | null;
    checkpoint: FoundationExecutionOperationCheckpointV1;
  }>): Promise<FoundationRetainedExecutionOperationCheckpointV1>;
}

export type FoundationExecutionOperationClockV1 = Readonly<{
  now(): string;
}>;

export type FoundationExecutionOwnerOutputValidationV1 = (
  input: Readonly<{
    specification: FoundationExecutionSpecificationV1;
    output: FoundationValidatedExecutionOutputV1;
  }>,
) => Promise<Readonly<{ disposition: "valid" | "invalid" }>>;

/**
 * Exact owner observation over a separately retrieved, already-contained
 * Carrier. Its returned JSON is opaque to the host and grants no dispatch,
 * workflow, or authoring authority.
 */
export type FoundationExecutionOwnerTerminalCompletionResultV1 =
  | Readonly<{
      disposition: "observed";
      value: ControlJsonObject;
    }>
  | Readonly<{
      disposition: "invalid";
      failureFactsDigest: Sha256;
    }>;

export type FoundationExecutionOwnerTerminalCompletionV1 = (
  input: Readonly<{
    specification: FoundationExecutionSpecificationV1;
    expectedManifestDigest: Sha256;
    output: FoundationRetrievedExecutionOutputV1;
  }>,
) => Promise<FoundationExecutionOwnerTerminalCompletionResultV1>;

/**
 * Optional exact-owner boundary used when the owning Activity must atomically
 * coordinate dispatch consumption with another durable fact. The host supplies
 * the only two legal checkpoint successors after its final direct readiness
 * observation. The owner commits exactly one; `refused` is already inert and
 * contained and therefore never enters Backend dispatch.
 */
export type FoundationExecutionPreDispatchCommitV1 = (
  input: Readonly<{
    specification: FoundationExecutionSpecificationV1;
    current: FoundationRetainedExecutionOperationCheckpointV1;
    dispatchCheckpoint: FoundationExecutionOperationCheckpointV1;
    refusalCheckpoint: FoundationExecutionOperationCheckpointV1;
  }>,
) => Promise<
  | Readonly<{
      disposition: "dispatch";
      retained: FoundationRetainedExecutionOperationCheckpointV1;
    }>
  | Readonly<{
      disposition: "refused";
      retained: FoundationRetainedExecutionOperationCheckpointV1;
    }>
>;

export type FoundationExecutionOperationHostDependenciesV1 = Readonly<{
  backend: FoundationExecutionBackend;
  checkpoints: FoundationExecutionOperationCheckpointPersistenceV1;
  clock: FoundationExecutionOperationClockV1;
  outputStore: FoundationExecutionOutputStoreV1;
  /** Owner semantics run after byte validation but before `valid` is retained. */
  validateOwnerOutput?: FoundationExecutionOwnerOutputValidationV1;
  /** Owner terminal facts are captured independently before Carrier validation. */
  observeTerminalCompletion?: FoundationExecutionOwnerTerminalCompletionV1;
  /** Exact owner-atomic alternative to the default dispatch-consumption CAS. */
  commitPreDispatch?: FoundationExecutionPreDispatchCommitV1;
  createAllocationKey?: () => FoundationExecutionAllocationKey;
}>;

/** A private fact result, not a Cell workflow or Process state. */
export type FoundationExecutionOperationAdvanceV1 = Readonly<{
  retained: FoundationRetainedExecutionOperationCheckpointV1;
  validatedOutput: FoundationValidatedExecutionOutputV1 | null;
}>;

function fail(
  code: string,
  message: string,
  observedFacts: Readonly<Record<string, unknown>> = {},
): never {
  throw new FoundationError(`lifecycle.execution.operation-host.${code}`, message, {
    operationalStateChanged: code === "backend-interrupted" ||
      code === "containment-ambiguous" || code === "containment-unavailable" ||
      code === "persistence",
    observedFacts,
  });
}

/**
 * A non-retryable Backend diagnostic is a complete refusal fact, not an
 * interrupted allocation. Preserve that exact diagnostic so recovery cannot
 * misrepresent an integrity refusal (for example, a duplicate allocation) as
 * an unknown result. Retryable, state-changing, and non-Foundation failures
 * remain interruption-shaped because their allocation result is not known.
 */
function isDeterministicBackendRefusal(error: unknown): error is FoundationError {
  return error instanceof FoundationError &&
    !error.retryable &&
    !error.operationalStateChanged;
}

function exactKeys(value: object, expected: readonly string[], label: string): void {
  if (Object.getOwnPropertySymbols(value).length !== 0 ||
      canonicalJson(Object.getOwnPropertyNames(value).sort()) !==
        canonicalJson([...expected].sort())) {
    fail("checkpoint-shape", `${label} is not one exact closed object`);
  }
}

function exactJson<Value>(value: Value): Value {
  const exact = JSON.parse(canonicalJson(value)) as Value;
  const pending: object[] = [];
  if (exact !== null && typeof exact === "object") pending.push(exact as object);
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const child of Object.values(current)) {
      if (child !== null && typeof child === "object" && !Object.isFrozen(child)) {
        pending.push(child);
      }
    }
    Object.freeze(current);
  }
  return exact;
}

function digest(value: unknown, label: string): Sha256 {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail("checkpoint-shape", `${label} is not one lowercase SHA-256 digest`);
  }
  return value as Sha256;
}

function nullableDigest(value: unknown, label: string): Sha256 | null {
  return value === null ? null : digest(value, label);
}

function canonicalTime(value: unknown, label: string): string {
  if (typeof value !== "string" || !CANONICAL_TIME_PATTERN.test(value) ||
      Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail("clock", `${label} is not one canonical UTC millisecond timestamp`);
  }
  return value;
}

function sameBackendReference(
  left: FoundationExecutionBackendProfileReferenceV1,
  right: FoundationExecutionBackendProfileReferenceV1,
): boolean {
  return left.profileId === right.profileId &&
    left.profileDigest === right.profileDigest &&
    left.implementationDigest === right.implementationDigest;
}

function backendReference(
  specification: FoundationExecutionSpecificationV1,
): FoundationExecutionBackendProfileReferenceV1 {
  return Object.freeze({ ...specification.backendProfile });
}

function validateSpecification(
  value: FoundationExecutionSpecificationV1,
  backend: FoundationExecutionBackend,
): FoundationExecutionSpecificationV1 {
  const profile = parseFoundationExecutionBackendProfile(backend.profile);
  const specification = parseFoundationExecutionSpecification({
    value,
    backendProfile: profile,
    image: value.image,
    inputSet: value.inputSet,
  });
  const selected = Object.freeze({
    profileId: profile.profileId,
    profileDigest: profile.digest,
    implementationDigest: profile.implementation.implementationDigest,
  });
  if (!sameBackendReference(specification.backendProfile, selected)) {
    fail(
      "backend-substitution",
      "Execution Backend does not implement the exact Profile selected by the Specification",
    );
  }
  return specification;
}

function checkpointSubject(
  value: Omit<FoundationExecutionOperationCheckpointV1, "digest">,
): FoundationExecutionOperationCheckpointV1 {
  return exactJson({ ...value, digest: selfDigest(value) });
}

function containmentSubject(input: Readonly<{
  observation: FoundationExecutionObservationV1;
  establishedAt: string;
  backendEffectObserved: boolean;
}>): FoundationExecutionContainmentFactV1 {
  const subject = Object.freeze({
    schema: "lifecycle.execution-containment.private.v1" as const,
    observationDigest: input.observation.digest,
    establishedAt: input.establishedAt,
    backendEffectObserved: input.backendEffectObserved,
  });
  return Object.freeze({ ...subject, digest: selfDigest(subject) });
}

function artifactInventoryDigest(
  output: FoundationValidatedExecutionOutputV1,
): Sha256 {
  return digestCanonical(output.artifacts.map((artifact) => Object.freeze({
    path: artifact.path,
    entryKind: artifact.entryKind,
    purpose: artifact.purpose,
    mediaType: artifact.mediaType,
    modeClass: artifact.modeClass,
    candidateRepositoryPath: artifact.candidateRepositoryPath,
    candidateGitMode: artifact.candidateGitMode,
    byteLength: artifact.byteLength,
    digest: artifact.digest,
  })));
}

function outputSubject(input: Readonly<{
  observation: FoundationExecutionObservationV1;
  validation: FoundationExecutionOutputFactV1["validation"];
  validatedAt: string | null;
  runnerDigest: Sha256 | null;
  artifactInventoryDigest: Sha256 | null;
  outputStoreBinding: FoundationExecutionOutputStoreBindingV1 | null;
  failureFactsDigest: Sha256 | null;
}>): FoundationExecutionOutputFactV1 {
  const subject = Object.freeze({
    schema: "lifecycle.execution-output-fact.private.v1" as const,
    observationDigest: input.observation.digest,
    disposition: input.observation.output.disposition,
    manifestDigest: input.observation.output.manifestDigest,
    carrierByteLength: input.observation.output.carrierByteLength,
    validation: input.validation,
    validatedAt: input.validatedAt,
    runnerDigest: input.runnerDigest,
    artifactInventoryDigest: input.artifactInventoryDigest,
    outputStoreBinding: input.outputStoreBinding,
    failureFactsDigest: input.failureFactsDigest,
  });
  return Object.freeze({ ...subject, digest: selfDigest(subject) });
}

function terminalCompletionSubject(input: Readonly<{
  specification: FoundationExecutionSpecificationV1;
  observation: FoundationExecutionObservationV1;
  capturedAt: string;
  result: FoundationExecutionOwnerTerminalCompletionResultV1;
}>): FoundationExecutionTerminalCompletionFactV1 {
  let result: FoundationExecutionOwnerTerminalCompletionResultV1;
  try {
    const exact = exactJson(input.result) as unknown as Record<string, unknown>;
    if (exact.disposition === "observed") {
      exactKeys(exact, ["disposition", "value"], "Execution owner terminal completion");
      if (exact.value === null || typeof exact.value !== "object" || Array.isArray(exact.value) ||
          Buffer.byteLength(canonicalJson(exact.value), "utf8") >
            MAXIMUM_TERMINAL_COMPLETION_BYTES) {
        fail(
          "owner-terminal-completion",
          "Execution owner terminal completion is not one bounded JSON object",
        );
      }
      result = Object.freeze({
        disposition: "observed" as const,
        value: exact.value as ControlJsonObject,
      });
    } else if (exact.disposition === "invalid") {
      exactKeys(
        exact,
        ["disposition", "failureFactsDigest"],
        "Execution owner terminal completion",
      );
      result = Object.freeze({
        disposition: "invalid" as const,
        failureFactsDigest: digest(
          exact.failureFactsDigest,
          "Execution owner terminal-completion failure facts",
        ),
      });
    } else {
      fail(
        "owner-terminal-completion",
        "Execution owner terminal completion has no exact disposition",
      );
    }
  } catch (error) {
    if (error instanceof FoundationError &&
        error.code === "lifecycle.execution.operation-host.owner-terminal-completion") {
      throw error;
    }
    fail(
      "owner-terminal-completion",
      "Execution owner terminal completion is not one bounded JSON object",
    );
  }
  const subject = Object.freeze({
    schema: "lifecycle.execution-terminal-completion.private.v1" as const,
    specificationDigest: input.specification.digest,
    observationDigest: input.observation.digest,
    capturedAt: input.capturedAt,
    disposition: result.disposition,
    value: result.disposition === "observed" ? result.value : null,
    valueDigest: result.disposition === "observed" ? digestCanonical(result.value) : null,
    failureFactsDigest: result.disposition === "invalid" ? result.failureFactsDigest : null,
  });
  return Object.freeze({
    ...subject,
    digest: selfDigest(subject),
  }) as FoundationExecutionTerminalCompletionFactV1;
}

/**
 * Compile only typed final Carrier facts. Runtime staging failures and unknown
 * exceptions remain recoverable and never become evidence merely because they
 * were thrown.
 */
function finalOutputValidationFailure(input: Readonly<{
  error: unknown;
  observation: FoundationExecutionObservationV1;
}>): Readonly<{
  validation: "invalid" | "unavailable";
  failureFactsDigest: Sha256;
}> | null {
  const classification = classifyFoundationExecutionOutputValidationFailure(input.error);
  if (classification.disposition === "recoverable") return null;
  return Object.freeze({
    validation: classification.disposition,
    failureFactsDigest: digestCanonical({
      schema: "lifecycle.execution-output-validation-failure.private.v1",
      observationDigest: input.observation.digest,
      manifestDigest: input.observation.output.manifestDigest,
      carrierByteLength: input.observation.output.carrierByteLength,
      validation: classification.disposition,
      code: classification.code,
      diagnosticsDigest: classification.diagnosticsDigest,
    }),
  });
}

function directOutputUnavailabilityFactsDigest(
  observation: FoundationExecutionObservationV1,
): Sha256 {
  return digestCanonical({
    schema: "lifecycle.execution-output-unavailability.private.v1",
    observationDigest: observation.digest,
    disposition: observation.output.disposition,
  });
}

function hostContainment(input: Readonly<{
  observation: FoundationExecutionObservationV1;
  dispatchAuthorityConsumed: boolean;
}>): Readonly<{ established: boolean; backendEffectObserved: boolean }> {
  /*
   * Authority consumption precedes Backend entry. A crash in that exact window
   * permanently exhausts dispatch but can later be proved safe by a direct
   * same-allocation allocated/not-observed/not-started observation. Missing,
   * unavailable, or ambiguous facts never take this route.
   */
  const backendEffectObserved = input.observation.dispatchState !== "not-observed";
  if (backendEffectObserved && !input.dispatchAuthorityConsumed) {
    return Object.freeze({ established: false, backendEffectObserved });
  }
  return Object.freeze({
    established: executionObservationEstablishesContainment(
      input.observation,
      input.dispatchAuthorityConsumed,
    ),
    backendEffectObserved,
  });
}

function isDirectPreDispatchAbsence(
  observation: FoundationExecutionObservationV1,
): boolean {
  return observation.allocationState === "absent" &&
    observation.dispatchState === "not-observed" &&
    observation.processState === "not-observed" &&
    observation.terminal === null &&
    observation.output.disposition === "not-produced" &&
    observation.output.manifestDigest === null &&
    observation.output.carrierByteLength === null &&
    executionObservationEstablishesContainment(observation, false);
}

function isDirectPreDispatchReadiness(
  observation: FoundationExecutionObservationV1,
): boolean {
  return observation.allocationState === "allocated" &&
    observation.dispatchState === "not-observed" &&
    observation.processState === "not-started" &&
    observation.terminal === null &&
    observation.output.disposition === "not-produced" &&
    observation.output.manifestDigest === null &&
    observation.output.carrierByteLength === null &&
    executionObservationEstablishesContainment(observation, false);
}

function parseContainment(input: Readonly<{
  value: unknown;
  checkpoint: Readonly<{
    openedAt: string;
    dispatchAuthorityConsumedAt: string | null;
    containmentRequestedAt: string | null;
    observation: FoundationExecutionObservationV1 | null;
  }>;
}>): FoundationExecutionContainmentFactV1 | null {
  if (input.value === null) return null;
  if (typeof input.value !== "object" || Array.isArray(input.value)) {
    fail("checkpoint-shape", "Execution Containment fact is not one exact object");
  }
  const value = exactJson(input.value) as unknown as Record<string, unknown>;
  exactKeys(value, [
    "backendEffectObserved",
    "digest",
    "establishedAt",
    "observationDigest",
    "schema",
  ], "Execution Containment fact");
  const establishedAt = canonicalTime(value.establishedAt, "Execution Containment time");
  const observationDigest = digest(value.observationDigest, "Execution Containment observation");
  if (value.schema !== "lifecycle.execution-containment.private.v1" ||
      typeof value.backendEffectObserved !== "boolean" ||
      value.digest !== selfDigest(value, "digest") ||
      establishedAt < input.checkpoint.openedAt || input.checkpoint.observation === null ||
      establishedAt < input.checkpoint.observation.observedAt ||
      (input.checkpoint.dispatchAuthorityConsumedAt === null &&
        input.checkpoint.containmentRequestedAt === null &&
        !isDirectPreDispatchAbsence(input.checkpoint.observation)) ||
      observationDigest !== input.checkpoint.observation.digest) {
    fail("checkpoint-substitution", "Execution Containment does not bind its exact direct observation");
  }
  const interpreted = hostContainment({
    observation: input.checkpoint.observation,
    dispatchAuthorityConsumed: input.checkpoint.dispatchAuthorityConsumedAt !== null,
  });
  if (!interpreted.established ||
      interpreted.backendEffectObserved !== value.backendEffectObserved) {
    fail("checkpoint-substitution", "Execution Containment is not established by its bound direct facts");
  }
  return value as unknown as FoundationExecutionContainmentFactV1;
}

function parseTerminalCompletion(input: Readonly<{
  value: unknown;
  specification: FoundationExecutionSpecificationV1;
  containment: FoundationExecutionContainmentFactV1;
  observation: FoundationExecutionObservationV1;
}>): FoundationExecutionTerminalCompletionFactV1 {
  if (input.value === null || typeof input.value !== "object" || Array.isArray(input.value)) {
    fail("checkpoint-shape", "Execution terminal completion is not one exact object");
  }
  const value = exactJson(input.value) as unknown as Record<string, unknown>;
  exactKeys(value, [
    "capturedAt",
    "digest",
    "disposition",
    "failureFactsDigest",
    "observationDigest",
    "schema",
    "specificationDigest",
    "value",
    "valueDigest",
  ], "Execution terminal completion");
  const capturedAt = canonicalTime(value.capturedAt, "Execution terminal-completion time");
  const observationDigest = digest(
    value.observationDigest,
    "Execution terminal-completion observation",
  );
  const valueDigest = nullableDigest(
    value.valueDigest,
    "Execution terminal-completion value",
  );
  const failureFactsDigest = nullableDigest(
    value.failureFactsDigest,
    "Execution terminal-completion failure facts",
  );
  const observed = value.disposition === "observed";
  const invalid = value.disposition === "invalid";
  if ((!observed && !invalid) ||
      (observed && (value.value === null || typeof value.value !== "object" ||
        Array.isArray(value.value) || valueDigest === null || failureFactsDigest !== null ||
        Buffer.byteLength(canonicalJson(value.value), "utf8") >
          MAXIMUM_TERMINAL_COMPLETION_BYTES ||
        valueDigest !== digestCanonical(value.value))) ||
      (invalid && (value.value !== null || valueDigest !== null || failureFactsDigest === null)) ||
      value.schema !== "lifecycle.execution-terminal-completion.private.v1" ||
      value.specificationDigest !== input.specification.digest ||
      input.observation.output.disposition !== "complete" ||
      observationDigest !== input.observation.digest ||
      observationDigest !== input.containment.observationDigest ||
      capturedAt < input.containment.establishedAt ||
      value.digest !== selfDigest(value, "digest")) {
    fail(
      "checkpoint-substitution",
      "Execution terminal completion does not bind its exact contained observation",
    );
  }
  return value as unknown as FoundationExecutionTerminalCompletionFactV1;
}

function parseOutput(input: Readonly<{
  value: unknown;
  containment: FoundationExecutionContainmentFactV1 | null;
  observation: FoundationExecutionObservationV1 | null;
}>): FoundationExecutionOutputFactV1 | null {
  if (input.value === null) return null;
  if (typeof input.value !== "object" || Array.isArray(input.value)) {
    fail("checkpoint-shape", "Execution Output fact is not one exact object");
  }
  const value = exactJson(input.value) as unknown as Record<string, unknown>;
  exactKeys(value, [
    "artifactInventoryDigest",
    "carrierByteLength",
    "digest",
    "disposition",
    "failureFactsDigest",
    "manifestDigest",
    "observationDigest",
    "outputStoreBinding",
    "runnerDigest",
    "schema",
    "validation",
    "validatedAt",
  ], "Execution Output fact");
  const observationDigest = digest(value.observationDigest, "Execution Output observation");
  const manifestDigest = nullableDigest(value.manifestDigest, "Execution Output Manifest");
  const runnerDigest = nullableDigest(value.runnerDigest, "Execution Output runner");
  const inventoryDigest = nullableDigest(
    value.artifactInventoryDigest,
    "Execution Output artifact inventory",
  );
  const failureFactsDigest = nullableDigest(
    value.failureFactsDigest,
    "Execution Output failure facts",
  );
  let outputStoreBinding: FoundationExecutionOutputStoreBindingV1 | null = null;
  if (value.outputStoreBinding !== null) {
    try {
      outputStoreBinding = parseFoundationExecutionOutputStoreBindingV1(
        value.outputStoreBinding,
      );
    } catch {
      fail("checkpoint-substitution", "Execution Output Store binding is invalid");
    }
  }
  const validatedAt = value.validatedAt === null
    ? null
    : canonicalTime(value.validatedAt, "Execution Output validation time");
  const complete = value.disposition === "complete";
  const valid = complete && value.validation === "valid";
  const invalid = complete && value.validation === "invalid";
  const unavailable = value.validation === "unavailable" &&
    (complete || value.disposition === "missing" || value.disposition === "partial" ||
      value.disposition === "unavailable");
  const notApplicable = value.disposition === "not-produced" &&
    value.validation === "not-applicable";
  if (value.schema !== "lifecycle.execution-output-fact.private.v1" ||
      value.digest !== selfDigest(value, "digest") || input.containment === null ||
      input.observation === null || observationDigest !== input.containment.observationDigest ||
      observationDigest !== input.observation.digest ||
      value.disposition !== input.observation.output.disposition ||
      manifestDigest !== input.observation.output.manifestDigest ||
      value.carrierByteLength !== input.observation.output.carrierByteLength ||
      (!valid && !invalid && !unavailable && !notApplicable) ||
      (valid && (manifestDigest === null || validatedAt === null || runnerDigest === null ||
        inventoryDigest === null || outputStoreBinding === null || failureFactsDigest !== null)) ||
      (invalid && (manifestDigest === null || validatedAt === null || runnerDigest === null ||
        inventoryDigest !== null || outputStoreBinding !== null || failureFactsDigest === null)) ||
      (unavailable && (validatedAt !== null || runnerDigest !== null || inventoryDigest !== null ||
        outputStoreBinding !== null || failureFactsDigest === null)) ||
      (notApplicable && (validatedAt !== null || runnerDigest !== null || inventoryDigest !== null ||
        outputStoreBinding !== null || failureFactsDigest !== null)) ||
      (validatedAt !== null && validatedAt < input.containment.establishedAt) ||
      value.disposition === "ambiguous") {
    fail("checkpoint-substitution", "Execution Output fact does not bind one exact final disposition");
  }
  return value as unknown as FoundationExecutionOutputFactV1;
}

function retirementCore(input: Readonly<{
  specificationDigest: Sha256;
  retiredAt: string;
  finalObservationDigest: Sha256;
  containmentDigest: Sha256;
  terminalCompletionDigest: Sha256 | null;
  outputDigest: Sha256;
  dispatchAuthorityConsumed: boolean;
}>): Readonly<{
  schema: "lifecycle.execution-retirement-core.private.v1";
  specificationDigest: Sha256;
  retiredAt: string;
  finalObservationDigest: Sha256;
  containmentDigest: Sha256;
  terminalCompletionDigest: Sha256 | null;
  outputDigest: Sha256;
  dispatchAuthorityConsumed: boolean;
}> {
  return Object.freeze({
    schema: "lifecycle.execution-retirement-core.private.v1" as const,
    ...input,
  });
}

function parseRetirement(input: Readonly<{
  value: unknown;
  specification: FoundationExecutionSpecificationV1;
  handle: FoundationExecutionHandle | null;
  dispatchAuthorityConsumedAt: string | null;
  observation: FoundationExecutionObservationV1 | null;
  containment: FoundationExecutionContainmentFactV1 | null;
  terminalCompletion: FoundationExecutionTerminalCompletionFactV1 | null;
  output: FoundationExecutionOutputFactV1 | null;
}>): FoundationExecutionRetirementFactV1 | null {
  if (input.value === null) return null;
  if (typeof input.value !== "object" || Array.isArray(input.value)) {
    fail("checkpoint-shape", "Execution Retirement fact is not one exact object");
  }
  const value = exactJson(input.value) as unknown as Record<string, unknown>;
  exactKeys(value, [
    "containmentDigest",
    "digest",
    "dispatchAuthorityConsumed",
    "finalObservationDigest",
    "outputDigest",
    "reclamationBinding",
    "reclamationObligation",
    "retiredAt",
    "retirementCheckpointDigest",
    "schema",
    "specificationDigest",
    "terminalCompletionDigest",
  ], "Execution Retirement fact");
  const retiredAt = canonicalTime(value.retiredAt, "Execution Retirement time");
  const finalObservationDigest = digest(
    value.finalObservationDigest,
    "Execution Retirement observation",
  );
  const containmentDigest = digest(value.containmentDigest, "Execution Retirement Containment");
  const terminalCompletionDigest = nullableDigest(
    value.terminalCompletionDigest,
    "Execution Retirement terminal completion",
  );
  const expectedTerminalCompletionDigest = input.terminalCompletion?.digest ?? null;
  const outputDigest = digest(value.outputDigest, "Execution Retirement Output");
  const retirementCheckpointDigest = digest(
    value.retirementCheckpointDigest,
    "Execution Retirement checkpoint",
  );
  if (value.schema !== "lifecycle.execution-retirement.private.v1" ||
      value.specificationDigest !== input.specification.digest ||
      typeof value.dispatchAuthorityConsumed !== "boolean" ||
      value.dispatchAuthorityConsumed !== (input.dispatchAuthorityConsumedAt !== null) ||
      input.handle === null || input.observation === null || input.containment === null ||
      input.output === null || finalObservationDigest !== input.observation.digest ||
      containmentDigest !== input.containment.digest || outputDigest !== input.output.digest ||
      terminalCompletionDigest !== expectedTerminalCompletionDigest ||
      retiredAt < input.containment.establishedAt ||
      (input.terminalCompletion !== null &&
        retiredAt < input.terminalCompletion.capturedAt) ||
      (input.output.validatedAt !== null && retiredAt < input.output.validatedAt) ||
      retirementCheckpointDigest !== digestCanonical(retirementCore({
        specificationDigest: input.specification.digest,
        retiredAt,
        finalObservationDigest,
        containmentDigest,
        terminalCompletionDigest,
        outputDigest,
        dispatchAuthorityConsumed: value.dispatchAuthorityConsumed,
      })) || value.digest !== selfDigest(value, "digest")) {
    fail("checkpoint-substitution", "Execution Retirement does not bind its exact terminal facts");
  }
  const binding = parseExecutionReclamationBinding(
    value.reclamationBinding,
    input.specification,
    {
      handle: input.handle,
      retirementCheckpointDigest,
      dispatchAuthorityConsumed: value.dispatchAuthorityConsumed,
    },
  );
  parseExecutionReclamationObligation(
    value.reclamationObligation,
    input.specification,
    binding,
  );
  const obligation = value.reclamationObligation as unknown as FoundationExecutionReclamationObligationV1;
  if (obligation.retirementCheckpointDigest !== retirementCheckpointDigest) {
    fail("checkpoint-substitution", "Execution Retirement selects another Reclamation handoff");
  }
  return value as unknown as FoundationExecutionRetirementFactV1;
}

export function parseFoundationExecutionOperationCheckpoint(input: Readonly<{
  value: unknown;
  specification: FoundationExecutionSpecificationV1;
  backend: FoundationExecutionBackend;
}>): FoundationExecutionOperationCheckpointV1 {
  const specification = validateSpecification(input.specification, input.backend);
  if (input.value === null || typeof input.value !== "object" || Array.isArray(input.value)) {
    fail("checkpoint-shape", "Execution operation checkpoint is not one exact object");
  }
  const value = exactJson(input.value) as unknown as Record<string, unknown>;
  exactKeys(value, [
    "allocationKey",
    "backendProfile",
    "containment",
    "containmentRequestedAt",
    "digest",
    "dispatchAuthorityConsumedAt",
    "handle",
    "observation",
    "openedAt",
    "output",
    "retirement",
    "schema",
    "specificationDigest",
    "terminalCompletion",
  ], "Execution operation checkpoint");
  if (value.schema !== FOUNDATION_EXECUTION_OPERATION_CHECKPOINT_SCHEMA ||
      value.specificationDigest !== specification.digest ||
      value.digest !== selfDigest(value, "digest")) {
    fail("checkpoint-substitution", "Execution checkpoint does not bind its exact Specification");
  }
  const backendProfile = value.backendProfile;
  if (backendProfile === null || typeof backendProfile !== "object" ||
      Array.isArray(backendProfile)) {
    fail("checkpoint-shape", "Execution checkpoint Backend Profile is not one exact object");
  }
  exactKeys(backendProfile, [
    "implementationDigest",
    "profileDigest",
    "profileId",
  ], "Execution checkpoint Backend Profile");
  if (!sameBackendReference(
    backendProfile as FoundationExecutionBackendProfileReferenceV1,
    specification.backendProfile,
  )) {
    fail("backend-substitution", "Execution checkpoint selects another Backend Profile");
  }
  const openedAt = canonicalTime(value.openedAt, "Execution checkpoint opening time");
  assertFoundationExecutionAllocationKey(value.allocationKey);
  const handle = value.handle === null
    ? null
    : privateFoundationExecutionHandle(String(value.handle));
  const dispatchAuthorityConsumedAt = value.dispatchAuthorityConsumedAt === null
    ? null
    : canonicalTime(value.dispatchAuthorityConsumedAt, "Execution dispatch-consumption time");
  const containmentRequestedAt = value.containmentRequestedAt === null
    ? null
    : canonicalTime(value.containmentRequestedAt, "Execution containment-request time");
  if ((dispatchAuthorityConsumedAt !== null && dispatchAuthorityConsumedAt < openedAt) ||
      (containmentRequestedAt !== null && containmentRequestedAt < openedAt) ||
      (handle === null && (dispatchAuthorityConsumedAt !== null ||
        containmentRequestedAt !== null || value.observation !== null ||
        value.containment !== null || value.terminalCompletion !== null ||
        value.output !== null || value.retirement !== null))) {
    fail("checkpoint-order", "Execution checkpoint facts are not causally ordered");
  }
  const observation = value.observation === null
    ? null
    : parseFoundationExecutionObservation({
        value: value.observation,
        specification,
      });
  if (observation !== null && dispatchAuthorityConsumedAt === null &&
      !isDirectPreDispatchReadiness(observation) &&
      !isDirectPreDispatchAbsence(observation)) {
    fail("checkpoint-order", "Execution checkpoint observes a Backend effect without consumed authority");
  }
  const containment = parseContainment({
    value: value.containment,
    checkpoint: {
      openedAt,
      dispatchAuthorityConsumedAt,
      containmentRequestedAt,
      observation,
    },
  });
  const terminalCompletion = value.terminalCompletion === null
    ? null
    : containment === null || observation === null
      ? fail(
          "checkpoint-order",
          "Execution terminal completion cannot precede direct Containment",
        )
      : parseTerminalCompletion({
          value: value.terminalCompletion,
          specification,
          containment,
          observation,
        });
  const output = parseOutput({
    value: value.output,
    containment,
    observation,
  });
  parseRetirement({
    value: value.retirement,
    specification,
    handle,
    dispatchAuthorityConsumedAt,
    observation,
    containment,
    terminalCompletion,
    output,
  });
  return value as unknown as FoundationExecutionOperationCheckpointV1;
}

function parseCoordinate(value: unknown): FoundationExecutionOperationCheckpointCoordinateV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("persistence-substitution", "Execution checkpoint coordinate is not one exact object");
  }
  const exact = exactJson(value) as unknown as Record<string, unknown>;
  exactKeys(
    exact,
    ["checkpointDigest", "persistenceDigest", "revision"],
    "Execution checkpoint coordinate",
  );
  const checkpointDigest = digest(exact.checkpointDigest, "Execution checkpoint coordinate digest");
  const persistenceDigest = digest(
    exact.persistenceDigest,
    "Execution checkpoint persistence binding",
  );
  if (!Number.isSafeInteger(exact.revision) || Number(exact.revision) < 1) {
    fail("persistence-substitution", "Execution checkpoint coordinate has an invalid revision");
  }
  return Object.freeze({
    revision: Number(exact.revision),
    checkpointDigest,
    persistenceDigest,
  });
}

function parseRetained(input: Readonly<{
  value: unknown;
  specification: FoundationExecutionSpecificationV1;
  backend: FoundationExecutionBackend;
}>): FoundationRetainedExecutionOperationCheckpointV1 {
  if (input.value === null || typeof input.value !== "object" || Array.isArray(input.value)) {
    fail("persistence-substitution", "Execution checkpoint persistence returned no retained value");
  }
  const exact = exactJson(input.value) as unknown as Record<string, unknown>;
  exactKeys(exact, ["checkpoint", "coordinate"], "Retained Execution checkpoint");
  const checkpoint = parseFoundationExecutionOperationCheckpoint({
    value: exact.checkpoint,
    specification: input.specification,
    backend: input.backend,
  });
  const coordinate = parseCoordinate(exact.coordinate);
  if (coordinate.checkpointDigest !== checkpoint.digest) {
    fail("persistence-substitution", "Execution checkpoint coordinate selects another value");
  }
  return Object.freeze({ coordinate, checkpoint });
}

function laterTime(
  clock: FoundationExecutionOperationClockV1,
  lowerBound: string,
  label: string,
): string {
  let value: unknown;
  try {
    value = clock.now();
  } catch {
    fail("clock", `${label} could not be sampled`);
  }
  const selected = canonicalTime(value, label);
  if (selected < lowerBound) fail("clock", `${label} regresses behind retained execution time`);
  return selected;
}

function latestRuntimeTime(
  checkpoint: FoundationExecutionOperationCheckpointV1,
): string {
  return [
    checkpoint.openedAt,
    checkpoint.dispatchAuthorityConsumedAt,
    checkpoint.containmentRequestedAt,
    checkpoint.observation?.observedAt ?? null,
    checkpoint.containment?.establishedAt ?? null,
    checkpoint.terminalCompletion?.capturedAt ?? null,
    checkpoint.output?.validatedAt ?? null,
    checkpoint.retirement?.retiredAt ?? null,
  ].reduce<string>((latest, value) => value !== null && value > latest ? value : latest,
    checkpoint.openedAt);
}

function revisedCheckpoint(
  checkpoint: FoundationExecutionOperationCheckpointV1,
  changes: Partial<Omit<FoundationExecutionOperationCheckpointV1, "digest">>,
): FoundationExecutionOperationCheckpointV1 {
  const { digest: _digest, ...subject } = checkpoint;
  return checkpointSubject(Object.freeze({ ...subject, ...changes }));
}

export class FoundationExecutionOperationHostV1 {
  readonly #backend: FoundationExecutionBackend;
  readonly #checkpoints: FoundationExecutionOperationCheckpointPersistenceV1;
  readonly #clock: FoundationExecutionOperationClockV1;
  readonly #outputStore: FoundationExecutionOutputStoreV1;
  readonly #validateOwnerOutput: FoundationExecutionOwnerOutputValidationV1 | null;
  readonly #observeTerminalCompletion: FoundationExecutionOwnerTerminalCompletionV1 | null;
  readonly #commitPreDispatch: FoundationExecutionPreDispatchCommitV1 | null;
  readonly #createAllocationKey: () => FoundationExecutionAllocationKey;

  constructor(dependencies: FoundationExecutionOperationHostDependenciesV1) {
    this.#backend = dependencies.backend;
    this.#checkpoints = dependencies.checkpoints;
    this.#clock = dependencies.clock;
    this.#outputStore = dependencies.outputStore;
    this.#validateOwnerOutput = dependencies.validateOwnerOutput ?? null;
    this.#observeTerminalCompletion = dependencies.observeTerminalCompletion ?? null;
    this.#commitPreDispatch = dependencies.commitPreDispatch ?? null;
    this.#createAllocationKey = dependencies.createAllocationKey ??
      createFoundationExecutionAllocationKey;
    parseFoundationExecutionBackendProfile(this.#backend.profile);
  }

  async read(
    specificationValue: FoundationExecutionSpecificationV1,
  ): Promise<FoundationRetainedExecutionOperationCheckpointV1 | null> {
    const specification = validateSpecification(specificationValue, this.#backend);
    let value: FoundationRetainedExecutionOperationCheckpointV1 | null;
    try {
      value = await this.#checkpoints.read(specification.digest);
    } catch {
      fail("persistence", "Execution checkpoint could not be read");
    }
    return value === null ? null : parseRetained({
      value,
      specification,
      backend: this.#backend,
    });
  }

  async #commit(input: Readonly<{
    specification: FoundationExecutionSpecificationV1;
    current: FoundationRetainedExecutionOperationCheckpointV1 | null;
    checkpoint: FoundationExecutionOperationCheckpointV1;
  }>): Promise<FoundationRetainedExecutionOperationCheckpointV1> {
    let value: FoundationRetainedExecutionOperationCheckpointV1;
    try {
      value = await this.#checkpoints.compareExchange({
        specificationDigest: input.specification.digest,
        expected: input.current?.coordinate ?? null,
        checkpoint: input.checkpoint,
      });
    } catch {
      fail("persistence", "Execution checkpoint durable compare-and-swap failed");
    }
    const retained = parseRetained({
      value,
      specification: input.specification,
      backend: this.#backend,
    });
    const revisionAdvanced = input.current === null ||
      retained.coordinate.revision === input.current.coordinate.revision + 1;
    if (!revisionAdvanced ||
        retained.checkpoint.digest !== input.checkpoint.digest ||
        canonicalJson(retained.checkpoint) !== canonicalJson(input.checkpoint)) {
      fail("persistence-substitution", "Execution persistence committed another checkpoint value");
    }
    return retained;
  }

  async open(
    specificationValue: FoundationExecutionSpecificationV1,
  ): Promise<FoundationRetainedExecutionOperationCheckpointV1> {
    const specification = validateSpecification(specificationValue, this.#backend);
    const existing = await this.read(specification);
    if (existing !== null) return existing;
    let allocationKey: FoundationExecutionAllocationKey;
    try {
      allocationKey = this.#createAllocationKey();
      assertFoundationExecutionAllocationKey(allocationKey);
    } catch {
      fail("allocation-key", "Execution operation could not create one exact allocation key");
    }
    const openedAt = laterTime(this.#clock, "0000-01-01T00:00:00.000Z", "Execution opening time");
    const checkpoint = checkpointSubject(Object.freeze({
      schema: FOUNDATION_EXECUTION_OPERATION_CHECKPOINT_SCHEMA,
      specificationDigest: specification.digest,
      backendProfile: backendReference(specification),
      openedAt,
      allocationKey,
      handle: null,
      dispatchAuthorityConsumedAt: null,
      containmentRequestedAt: null,
      observation: null,
      containment: null,
      terminalCompletion: null,
      output: null,
      retirement: null,
    }));
    return this.#commit({ specification, current: null, checkpoint });
  }

  async #recordObservation(input: Readonly<{
    specification: FoundationExecutionSpecificationV1;
    current: FoundationRetainedExecutionOperationCheckpointV1;
    value: FoundationExecutionObservationV1;
  }>): Promise<FoundationRetainedExecutionOperationCheckpointV1> {
    const checkpoint = input.current.checkpoint;
    const observation = parseFoundationExecutionObservation({
      value: input.value,
      specification: input.specification,
      previous: checkpoint.observation,
    });
    if (checkpoint.dispatchAuthorityConsumedAt === null &&
        !isDirectPreDispatchReadiness(observation) &&
        !isDirectPreDispatchAbsence(observation)) {
      fail("backend-substitution", "Backend reported productive execution without consumed dispatch authority");
    }
    const interpreted = hostContainment({
      observation,
      dispatchAuthorityConsumed: checkpoint.dispatchAuthorityConsumedAt !== null,
    });
    const retainedTime = latestRuntimeTime(checkpoint);
    const containment = interpreted.established
      ? containmentSubject({
          observation,
          establishedAt: laterTime(
            this.#clock,
            observation.observedAt > retainedTime
              ? observation.observedAt
              : retainedTime,
            "Execution Containment time",
          ),
          backendEffectObserved: interpreted.backendEffectObserved,
        })
      : null;
    const next = revisedCheckpoint(checkpoint, { observation, containment });
    const retained = await this.#commit({
      specification: input.specification,
      current: input.current,
      checkpoint: next,
    });
    if (observation.allocationState === "ambiguous" ||
        observation.dispatchState === "ambiguous" ||
        observation.processState === "ambiguous" ||
        observation.output.disposition === "ambiguous") {
      fail("containment-ambiguous", "Execution requires recovery because direct Backend facts are ambiguous", {
        observationDigest: observation.digest,
      });
    }
    if (observation.allocationState === "unavailable" ||
        (observation.processState === "not-observed" && containment === null)) {
      fail("containment-unavailable", "Execution requires recovery because direct Containment facts are unavailable", {
        observationDigest: observation.digest,
      });
    }
    return retained;
  }

  async #allocate(input: Readonly<{
    specification: FoundationExecutionSpecificationV1;
    current: FoundationRetainedExecutionOperationCheckpointV1;
  }>): Promise<FoundationRetainedExecutionOperationCheckpointV1> {
    let rawHandle: FoundationExecutionHandle;
    try {
      rawHandle = await this.#backend.allocate(
        input.specification,
        input.current.checkpoint.allocationKey,
      );
    } catch (error) {
      if (isDeterministicBackendRefusal(error)) throw error;
      fail("backend-interrupted", "Execution allocation was interrupted; reopen its exact allocation key");
    }
    const handle = privateFoundationExecutionHandle(String(rawHandle));
    let rawObservation: FoundationExecutionObservationV1;
    try {
      rawObservation = await this.#backend.observe(handle);
    } catch {
      fail("backend-interrupted", "Execution allocation could not be directly observed");
    }
    const observation = parseFoundationExecutionObservation({
      value: rawObservation,
      specification: input.specification,
    });
    if (observation.dispatchState !== "not-observed" ||
        observation.processState !== "not-started" || observation.terminal !== null) {
      fail("backend-substitution", "Execution allocation was not one exact nonrunning Cell");
    }
    return this.#commit({
      specification: input.specification,
      current: input.current,
      checkpoint: revisedCheckpoint(input.current.checkpoint, {
        handle,
        observation,
        containment: null,
      }),
    });
  }

  async #requestContainment(input: Readonly<{
    specification: FoundationExecutionSpecificationV1;
    current: FoundationRetainedExecutionOperationCheckpointV1;
  }>): Promise<FoundationRetainedExecutionOperationCheckpointV1> {
    const requestedAt = laterTime(
      this.#clock,
      latestRuntimeTime(input.current.checkpoint),
      "Execution Containment-request time",
    );
    return this.#commit({
      specification: input.specification,
      current: input.current,
      checkpoint: revisedCheckpoint(input.current.checkpoint, {
        containmentRequestedAt: requestedAt,
      }),
    });
  }

  async #dispatch(input: Readonly<{
    specification: FoundationExecutionSpecificationV1;
    current: FoundationRetainedExecutionOperationCheckpointV1;
  }>): Promise<FoundationRetainedExecutionOperationCheckpointV1> {
    const handle = input.current.checkpoint.handle;
    if (handle === null) fail("checkpoint-order", "Execution cannot dispatch before allocation");
    let readinessValue: FoundationExecutionObservationV1;
    try {
      readinessValue = await this.#backend.observe(handle);
    } catch {
      fail("backend-interrupted", "Execution could not be directly observed before dispatch consumption");
    }
    const readiness = parseFoundationExecutionObservation({
      value: readinessValue,
      specification: input.specification,
      previous: input.current.checkpoint.observation,
    });
    if (isDirectPreDispatchAbsence(readiness)) {
      return this.#recordObservation({
        specification: input.specification,
        current: input.current,
        value: readiness,
      });
    }
    if (!isDirectPreDispatchReadiness(readiness)) {
      const retained = await this.#recordObservation({
        specification: input.specification,
        current: input.current,
        value: readiness,
      });
      fail(
        "dispatch-readiness",
        "Execution dispatch requires one exact allocated, inert, directly observed Cell",
        { observationDigest: retained.checkpoint.observation?.digest ?? null },
      );
    }
    const retainedTime = latestRuntimeTime(input.current.checkpoint);
    const consumedAt = laterTime(
      this.#clock,
      readiness.observedAt > retainedTime
        ? readiness.observedAt
        : retainedTime,
      "Execution dispatch-consumption time",
    );
    const dispatchCheckpoint = revisedCheckpoint(input.current.checkpoint, {
      dispatchAuthorityConsumedAt: consumedAt,
      observation: readiness,
    });
    const refusalCheckpoint = revisedCheckpoint(input.current.checkpoint, {
      containmentRequestedAt: consumedAt,
      observation: readiness,
      containment: containmentSubject({
        observation: readiness,
        establishedAt: consumedAt,
        backendEffectObserved: false,
      }),
    });
    let consumed: FoundationRetainedExecutionOperationCheckpointV1;
    if (this.#commitPreDispatch === null) {
      consumed = await this.#commit({
        specification: input.specification,
        current: input.current,
        checkpoint: dispatchCheckpoint,
      });
    } else {
      let decision: Awaited<ReturnType<FoundationExecutionPreDispatchCommitV1>>;
      try {
        decision = await this.#commitPreDispatch({
          specification: input.specification,
          current: input.current,
          dispatchCheckpoint,
          refusalCheckpoint,
        });
      } catch {
        fail("persistence", "Execution pre-dispatch owner boundary could not be committed");
      }
      if (decision === null || typeof decision !== "object" ||
          Object.keys(decision).length !== 2 ||
          (decision.disposition !== "dispatch" && decision.disposition !== "refused")) {
        fail("persistence-substitution", "Execution pre-dispatch owner returned an invalid decision");
      }
      const expected = decision.disposition === "dispatch"
        ? dispatchCheckpoint
        : refusalCheckpoint;
      consumed = parseRetained({
        value: decision.retained,
        specification: input.specification,
        backend: this.#backend,
      });
      const reopened = await this.read(input.specification);
      if (reopened === null ||
          canonicalJson(consumed) !== canonicalJson(reopened) ||
          canonicalJson(consumed.checkpoint) !== canonicalJson(expected)) {
        fail("persistence-substitution", "Execution pre-dispatch owner committed another checkpoint");
      }
      consumed = reopened;
      if (decision.disposition === "refused") return consumed;
    }
    let observation: FoundationExecutionObservationV1;
    try {
      observation = await this.#backend.dispatch(handle);
    } catch {
      fail("backend-interrupted", "Execution dispatch result was lost; redispatch is permanently refused", {
        checkpointDigest: consumed.checkpoint.digest,
      });
    }
    return this.#recordObservation({
      specification: input.specification,
      current: consumed,
      value: observation,
    });
  }

  async #observeOrCancel(input: Readonly<{
    specification: FoundationExecutionSpecificationV1;
    current: FoundationRetainedExecutionOperationCheckpointV1;
  }>): Promise<FoundationRetainedExecutionOperationCheckpointV1> {
    const handle = input.current.checkpoint.handle;
    if (handle === null) fail("checkpoint-order", "Execution cannot be observed before allocation");
    let observation: FoundationExecutionObservationV1;
    try {
      observation = input.current.checkpoint.containmentRequestedAt === null
        ? await this.#backend.observe(handle)
        : await this.#backend.cancel(handle);
    } catch {
      fail("backend-interrupted", "Execution observation or cancellation was interrupted");
    }
    return this.#recordObservation({
      specification: input.specification,
      current: input.current,
      value: observation,
    });
  }

  async #captureTerminalCompletion(input: Readonly<{
    specification: FoundationExecutionSpecificationV1;
    current: FoundationRetainedExecutionOperationCheckpointV1;
  }>): Promise<FoundationRetainedExecutionOperationCheckpointV1> {
    const checkpoint = input.current.checkpoint;
    const handle = checkpoint.handle;
    const observation = checkpoint.observation;
    if (this.#observeTerminalCompletion === null || handle === null ||
        observation === null || checkpoint.containment === null ||
        checkpoint.terminalCompletion !== null || checkpoint.output !== null ||
        observation.output.disposition !== "complete") {
      fail(
        "checkpoint-order",
        "Execution terminal completion requires one contained complete Carrier before output finalization",
      );
    }
    let retrieved;
    try {
      retrieved = parseFoundationExecutionRetrievalOutcome({
        value: await this.#backend.retrieve(handle, observation),
        specification: input.specification,
        handle,
      });
    } catch {
      fail(
        "backend-interrupted",
        "Execution terminal-completion retrieval was interrupted",
      );
    }
    if (retrieved.observationDigest !== observation.digest) {
      fail(
        "terminal-completion-unavailable",
        "Contained execution terminal retrieval substituted its exact observation",
        {
          observationDigest: observation.digest,
          retrievalFactsDigest: retrieved.factsDigest,
        },
      );
    }
    if (retrieved.disposition === "unavailable") {
      const output = outputSubject({
        observation,
        validation: "unavailable",
        validatedAt: null,
        runnerDigest: null,
        artifactInventoryDigest: null,
        outputStoreBinding: null,
        failureFactsDigest: retrieved.factsDigest,
      });
      return this.#commit({
        specification: input.specification,
        current: input.current,
        checkpoint: revisedCheckpoint(checkpoint, { output }),
      });
    }
    if (retrieved.output.manifest.digest !== observation.output.manifestDigest ||
        retrieved.output.carrierByteLength !== observation.output.carrierByteLength) {
      fail(
        "terminal-completion-unavailable",
        "Contained execution lacks one exact retrievable owner terminal completion",
        {
          observationDigest: observation.digest,
          retrievalFactsDigest: retrieved.factsDigest,
        },
      );
    }
    let ownerResult: FoundationExecutionOwnerTerminalCompletionResultV1;
    try {
      ownerResult = await this.#observeTerminalCompletion({
        specification: input.specification,
        expectedManifestDigest: observation.output.manifestDigest,
        output: retrieved.output,
      });
    } catch (error) {
      if (error instanceof FoundationError) throw error;
      fail(
        "owner-terminal-completion",
        "Execution owner could not establish one exact terminal completion",
      );
    }
    const terminalCompletion = terminalCompletionSubject({
      specification: input.specification,
      observation,
      capturedAt: laterTime(
        this.#clock,
        latestRuntimeTime(checkpoint),
        "Execution terminal-completion time",
      ),
      result: ownerResult,
    });
    return this.#commit({
      specification: input.specification,
      current: input.current,
      checkpoint: revisedCheckpoint(checkpoint, { terminalCompletion }),
    });
  }

  async #validateOutput(input: Readonly<{
    specification: FoundationExecutionSpecificationV1;
    current: FoundationRetainedExecutionOperationCheckpointV1;
    runnerDigest: Sha256;
  }>): Promise<Readonly<{
    output: FoundationValidatedExecutionOutputV1 | null;
    fact: FoundationExecutionOutputFactV1;
  }>> {
    const checkpoint = input.current.checkpoint;
    const handle = checkpoint.handle;
    const observation = checkpoint.observation;
    if (handle === null || observation === null || checkpoint.containment === null ||
        observation.output.disposition !== "complete" ||
        (this.#observeTerminalCompletion !== null && checkpoint.terminalCompletion === null)) {
      fail("checkpoint-order", "Execution Output cannot be retrieved before complete Containment facts");
    }
    digest(input.runnerDigest, "Execution runner digest");
    let retrieved;
    try {
      retrieved = parseFoundationExecutionRetrievalOutcome({
        value: await this.#backend.retrieve(handle, observation),
        specification: input.specification,
        handle,
      });
      if (retrieved.observationDigest !== observation.digest) {
        fail(
          "backend-interrupted",
          "Contained Execution Output retrieval did not bind its retained source observation",
        );
      }
    } catch {
      fail("backend-interrupted", "Contained Execution Output retrieval was interrupted");
    }
    if (retrieved.disposition === "unavailable") {
      return Object.freeze({
        output: null,
        fact: outputSubject({
          observation,
          validation: "unavailable",
          validatedAt: null,
          runnerDigest: null,
          artifactInventoryDigest: null,
          outputStoreBinding: null,
          failureFactsDigest: retrieved.factsDigest,
        }),
      });
    }
    if (retrieved.output.manifest.digest !== observation.output.manifestDigest ||
        retrieved.output.carrierByteLength !== observation.output.carrierByteLength) {
      fail(
        "backend-substitution",
        "Retrieved Execution Output differs from its retained direct observation",
        {
          observationDigest: observation.digest,
          retrievalFactsDigest: retrieved.factsDigest,
          retrievedManifestDigest: retrieved.output.manifest.digest,
          retrievedCarrierByteLength: retrieved.output.carrierByteLength,
        },
      );
    }
    const validated = await validateFoundationExecutionOutput({
      output: retrieved.output,
      specification: input.specification,
      backendProfile: this.#backend.profile,
      runnerDigest: input.runnerDigest,
      staging: this.#outputStore,
    });
    const output = validated.output;
    if (this.#validateOwnerOutput !== null) {
      const ownerValidation = await this.#validateOwnerOutput({
        specification: input.specification,
        output,
      });
      if (ownerValidation === null || typeof ownerValidation !== "object" ||
          Object.keys(ownerValidation).length !== 1 ||
          (ownerValidation.disposition !== "valid" && ownerValidation.disposition !== "invalid")) {
        fail("owner-output-validator", "Execution owner output validator returned an invalid result");
      }
      if (ownerValidation.disposition === "invalid") {
        throw new FoundationError(
          "lifecycle.execution.output-validation.owner-semantic",
          "Execution Output failed its exact owner semantic contract",
        );
      }
    }
    const fact = outputSubject({
      observation,
      validation: "valid",
      validatedAt: laterTime(
        this.#clock,
        latestRuntimeTime(checkpoint),
        "Execution Output validation time",
      ),
      runnerDigest: input.runnerDigest,
      artifactInventoryDigest: artifactInventoryDigest(output),
      outputStoreBinding: validated.outputStoreBinding,
      failureFactsDigest: null,
    });
    return Object.freeze({ output, fact });
  }

  async #finalizeOutput(input: Readonly<{
    specification: FoundationExecutionSpecificationV1;
    current: FoundationRetainedExecutionOperationCheckpointV1;
    runnerDigest: Sha256;
  }>): Promise<FoundationExecutionOperationAdvanceV1> {
    const checkpoint = input.current.checkpoint;
    const observation = checkpoint.observation;
    if (checkpoint.containment === null || observation === null) {
      fail("checkpoint-order", "Execution Output disposition requires direct Containment");
    }
    if (observation.output.disposition === "ambiguous") {
      fail("containment-ambiguous", "Ambiguous output cannot become a final execution disposition");
    }
    if (observation.output.disposition === "complete") {
      if (checkpoint.terminalCompletion?.disposition === "invalid") {
        const finalOutput = outputSubject({
          observation,
          validation: "invalid",
          validatedAt: laterTime(
            this.#clock,
            latestRuntimeTime(checkpoint),
            "Execution terminal-completion refusal time",
          ),
          runnerDigest: input.runnerDigest,
          artifactInventoryDigest: null,
          outputStoreBinding: null,
          failureFactsDigest: checkpoint.terminalCompletion.failureFactsDigest,
        });
        const retained = await this.#commit({
          specification: input.specification,
          current: input.current,
          checkpoint: revisedCheckpoint(checkpoint, { output: finalOutput }),
        });
        return Object.freeze({ retained, validatedOutput: null });
      }
      try {
        const validated = await this.#validateOutput(input);
        const retained = await this.#commit({
          specification: input.specification,
          current: input.current,
          checkpoint: revisedCheckpoint(checkpoint, { output: validated.fact }),
        });
        return Object.freeze({ retained, validatedOutput: validated.output });
      } catch (error) {
        if (error instanceof FoundationError &&
            error.code === "lifecycle.execution.operation-host.backend-interrupted") {
          // Once an owner terminal fact is durable, its exact contained source
          // observation must remain stable. Re-observing here would replace
          // observation and Containment while leaving the retained terminal
          // fact bound to their predecessor. Retry the non-dispatching
          // retrieval against that same retained observation instead.
          if (checkpoint.terminalCompletion !== null) throw error;
          const retained = await this.#observeOrCancel({
            specification: input.specification,
            current: input.current,
          });
          return Object.freeze({ retained, validatedOutput: null });
        }
        const finalFailure = finalOutputValidationFailure({
          error,
          observation,
        });
        if (finalFailure === null) throw error;
        const finalOutput = outputSubject({
          observation,
          validation: finalFailure.validation,
          validatedAt: finalFailure.validation === "invalid"
            ? laterTime(
              this.#clock,
              latestRuntimeTime(checkpoint),
              "Execution Output validation-refusal time",
            )
            : null,
          runnerDigest: finalFailure.validation === "invalid" ? input.runnerDigest : null,
          artifactInventoryDigest: null,
          outputStoreBinding: null,
          failureFactsDigest: finalFailure.failureFactsDigest,
        });
        const retained = await this.#commit({
          specification: input.specification,
          current: input.current,
          checkpoint: revisedCheckpoint(checkpoint, { output: finalOutput }),
        });
        return Object.freeze({ retained, validatedOutput: null });
      }
    }
    const unavailable = observation.output.disposition === "missing" ||
      observation.output.disposition === "partial" ||
      observation.output.disposition === "unavailable";
    const retained = await this.#commit({
      specification: input.specification,
      current: input.current,
      checkpoint: revisedCheckpoint(checkpoint, {
        output: outputSubject({
          observation,
          validation: unavailable ? "unavailable" : "not-applicable",
          validatedAt: null,
          runnerDigest: null,
          artifactInventoryDigest: null,
          outputStoreBinding: null,
          failureFactsDigest: unavailable
            ? directOutputUnavailabilityFactsDigest(observation)
            : null,
        }),
      }),
    });
    return Object.freeze({ retained, validatedOutput: null });
  }

  async #reopenValidatedOutput(input: Readonly<{
    specification: FoundationExecutionSpecificationV1;
    current: FoundationRetainedExecutionOperationCheckpointV1;
    runnerDigest: Sha256;
  }>): Promise<FoundationExecutionOperationAdvanceV1> {
    const expected = input.current.checkpoint.output;
    if (expected === null || expected.disposition !== "complete" ||
        expected.validation !== "valid") {
      return Object.freeze({ retained: input.current, validatedOutput: null });
    }
    if (expected.runnerDigest !== input.runnerDigest) {
      fail("output-substitution", "Execution recovery selected another runner identity");
    }
    if (expected.outputStoreBinding === null) {
      fail("checkpoint-substitution", "Validated Execution Output lacks its retained Store binding");
    }
    const reopened = await reopenFoundationValidatedExecutionOutput({
      outputStore: this.#outputStore,
      outputStoreBinding: expected.outputStoreBinding,
      specification: input.specification,
      backendProfile: this.#backend.profile,
      runnerDigest: input.runnerDigest,
    });
    const output = reopened.output;
    if (canonicalJson(reopened.outputStoreBinding) !== canonicalJson(expected.outputStoreBinding) ||
        output.manifest.digest !== expected.manifestDigest ||
        output.carrierByteLength !== expected.carrierByteLength ||
        artifactInventoryDigest(output) !== expected.artifactInventoryDigest) {
      fail("output-substitution", "Recovered Execution Output differs from its retained validation fact");
    }
    if (this.#validateOwnerOutput !== null) {
      const ownerValidation = await this.#validateOwnerOutput({
        specification: input.specification,
        output,
      });
      if (ownerValidation?.disposition !== "valid" || Object.keys(ownerValidation).length !== 1) {
        fail("output-substitution", "Recovered Execution Output no longer satisfies its owner semantics");
      }
    }
    return Object.freeze({ retained: input.current, validatedOutput: output });
  }

  /**
   * Advance at most one private recovery boundary. The returned checkpoint
   * facts are interpreted by the already selected Activity owner; this method
   * neither chooses nor completes a Delivery operation.
   */
  async advance(input: Readonly<{
    specification: FoundationExecutionSpecificationV1;
    runnerDigest: Sha256;
    requestContainment?: boolean;
  }>): Promise<FoundationExecutionOperationAdvanceV1> {
    const specification = validateSpecification(input.specification, this.#backend);
    digest(input.runnerDigest, "Execution runner digest");
    let current = await this.read(specification);
    if (current === null) {
      current = await this.open(specification);
      return Object.freeze({ retained: current, validatedOutput: null });
    }
    const checkpoint = current.checkpoint;
    if (checkpoint.output?.disposition === "complete" &&
        checkpoint.output.validation === "valid") {
      // Retirement makes the Backend allocation permanently non-dispatchable;
      // it does not make the independently retained Output Store bytes
      // unavailable to the owner that still has to commit its Receipt. This
      // recovery path reopens only those exact validated bytes and performs no
      // Backend operation.
      return this.#reopenValidatedOutput({
        specification,
        current,
        runnerDigest: input.runnerDigest,
      });
    }
    if (checkpoint.retirement !== null) {
      return Object.freeze({ retained: current, validatedOutput: null });
    }
    if (checkpoint.handle === null) {
      const retained = await this.#allocate({ specification, current });
      return Object.freeze({ retained, validatedOutput: null });
    }
    if (input.requestContainment === true && checkpoint.containmentRequestedAt === null &&
        checkpoint.containment === null) {
      const retained = await this.#requestContainment({ specification, current });
      return Object.freeze({ retained, validatedOutput: null });
    }
    if (checkpoint.containment === null && checkpoint.containmentRequestedAt === null &&
        checkpoint.observation?.processState === "terminal") {
      const retained = await this.#requestContainment({ specification, current });
      return Object.freeze({ retained, validatedOutput: null });
    }
    if (checkpoint.containment === null) {
      const retained = checkpoint.dispatchAuthorityConsumedAt === null &&
          checkpoint.containmentRequestedAt === null
        ? await this.#dispatch({ specification, current })
        : await this.#observeOrCancel({ specification, current });
      return Object.freeze({ retained, validatedOutput: null });
    }
    if (checkpoint.output === null && checkpoint.observation?.output.disposition === "ambiguous") {
      const retained = await this.#observeOrCancel({ specification, current });
      return Object.freeze({ retained, validatedOutput: null });
    }
    if (checkpoint.output === null && checkpoint.terminalCompletion === null &&
        this.#observeTerminalCompletion !== null &&
        checkpoint.observation?.output.disposition === "complete") {
      const retained = await this.#captureTerminalCompletion({ specification, current });
      return Object.freeze({ retained, validatedOutput: null });
    }
    if (checkpoint.output === null) {
      return this.#finalizeOutput({
        specification,
        current,
        runnerDigest: input.runnerDigest,
      });
    }
    return Object.freeze({ retained: current, validatedOutput: null });
  }

  /**
   * Persist Runtime-owned Retirement after output disposition is durably
   * final. The Activity owner may still reopen exact validated Output Store
   * bytes to finish its Receipt after interruption. This creates the immutable
   * Reclamation obligation but performs no physical Reclamation and appends no
   * event.
   */
  async retire(
    specificationValue: FoundationExecutionSpecificationV1,
  ): Promise<FoundationRetainedExecutionOperationCheckpointV1> {
    const specification = validateSpecification(specificationValue, this.#backend);
    const current = await this.read(specification);
    if (current === null) fail("checkpoint-order", "Execution cannot retire before opening");
    const checkpoint = current.checkpoint;
    if (checkpoint.retirement !== null) return current;
    if (checkpoint.handle === null || checkpoint.observation === null ||
        checkpoint.containment === null || checkpoint.output === null) {
      fail("checkpoint-order", "Execution cannot retire before Containment and final output disposition");
    }
    const terminalCompletionPermitted = this.#observeTerminalCompletion !== null &&
      checkpoint.observation.output.disposition === "complete";
    const terminalCompletionRequired = terminalCompletionPermitted &&
      checkpoint.output.validation !== "unavailable";
    if ((terminalCompletionRequired && checkpoint.terminalCompletion === null) ||
        (!terminalCompletionPermitted && checkpoint.terminalCompletion !== null)) {
      fail(
        "checkpoint-order",
        "Execution Retirement does not bind the exact owner terminal-completion requirement",
      );
    }
    const retiredAt = laterTime(
      this.#clock,
      latestRuntimeTime(checkpoint),
      "Execution Retirement time",
    );
    const core = retirementCore({
      specificationDigest: specification.digest,
      retiredAt,
      finalObservationDigest: checkpoint.observation.digest,
      containmentDigest: checkpoint.containment.digest,
      terminalCompletionDigest: checkpoint.terminalCompletion?.digest ?? null,
      outputDigest: checkpoint.output.digest,
      dispatchAuthorityConsumed: checkpoint.dispatchAuthorityConsumedAt !== null,
    });
    const retirementCheckpointDigest = digestCanonical(core);
    let rawReclamationBinding: FoundationExecutionReclamationBindingV1;
    try {
      rawReclamationBinding = await this.#backend.createReclamationBinding({
        specification,
        handle: checkpoint.handle,
        retirementCheckpointDigest,
        dispatchAuthorityConsumed: checkpoint.dispatchAuthorityConsumedAt !== null,
      });
    } catch {
      fail(
        "backend-interrupted",
        "Execution Reclamation binding could not be recovered from the selected Backend",
      );
    }
    let reclamationBinding: FoundationExecutionReclamationBindingV1;
    try {
      reclamationBinding = parseExecutionReclamationBinding(
        rawReclamationBinding,
        specification,
        {
          handle: checkpoint.handle,
          retirementCheckpointDigest,
          dispatchAuthorityConsumed: checkpoint.dispatchAuthorityConsumedAt !== null,
        },
      );
    } catch {
      fail(
        "backend-substitution",
        "Execution Backend returned another Reclamation binding",
      );
    }
    const reclamationObligation = compileExecutionReclamationObligation({
      specification,
      handle: checkpoint.handle,
      retirementCheckpointDigest,
      reclamationBinding,
    });
    const retirementSubject = Object.freeze({
      schema: "lifecycle.execution-retirement.private.v1" as const,
      specificationDigest: specification.digest,
      retiredAt,
      finalObservationDigest: checkpoint.observation.digest,
      containmentDigest: checkpoint.containment.digest,
      terminalCompletionDigest: checkpoint.terminalCompletion?.digest ?? null,
      outputDigest: checkpoint.output.digest,
      dispatchAuthorityConsumed: checkpoint.dispatchAuthorityConsumedAt !== null,
      retirementCheckpointDigest,
      reclamationBinding,
      reclamationObligation,
    });
    const retirement = Object.freeze({
      ...retirementSubject,
      digest: selfDigest(retirementSubject),
    });
    return this.#commit({
      specification,
      current,
      checkpoint: revisedCheckpoint(checkpoint, { retirement }),
    });
  }
}
