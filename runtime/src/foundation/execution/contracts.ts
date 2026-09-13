import { FoundationError } from "../error.js";
import type { ControlJsonObject } from "../control/types.js";
import {
  canonicalJson,
  selfDigest,
  type Sha256,
} from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import { assertFoundationSchema } from "../validation/schema-engine.js";

export const FOUNDATION_EXECUTION_BACKEND_PROFILE_SCHEMA_ID =
  "urn:lifecycle:schema:execution-backend-profile:v1" as const;
export const FOUNDATION_EXECUTION_SPECIFICATION_SCHEMA_ID =
  "urn:lifecycle:schema:execution-specification:v1" as const;
export const FOUNDATION_EXECUTION_OBSERVATION_SCHEMA_ID =
  "urn:lifecycle:schema:execution-observation:v1" as const;

export type FoundationExecutionBackendProfileReferenceV1 = Readonly<{
  profileId:
    | "lifecycle.execution-backend-profile.docker-local.v1"
    | "lifecycle.execution-backend-profile.fault-injection.v1";
  profileDigest: Sha256;
  implementationDigest: Sha256;
}>;

/** Complete schema-validated profile; installed qualification has a separate owner. */
export type FoundationExecutionBackendProfileV1 = ControlJsonObject & Readonly<{
  schema: "lifecycle.execution-backend-profile.v1";
  profileId: FoundationExecutionBackendProfileReferenceV1["profileId"];
  backendKind: "docker-local" | "fault-injection";
  usage: "production" | "test-only";
  implementation: Readonly<{
    id: string;
    version: string;
    implementationDigest: Sha256;
    contractDigest: Sha256;
  }>;
  engineContract: Readonly<{
    kind: "docker-engine" | "deterministic-test-engine";
    compatibilityProfileId: string;
    compatibleVersion: string;
    contractDigest: Sha256;
  }>;
  platforms: readonly Readonly<{
    os: "linux";
    architecture: "amd64" | "arm64";
    variant: string | null;
  }>[];
  isolation:
    | Readonly<{
        mechanism: "oci-container";
        nonRootRunner: true;
        privileged: false;
        hostPidNamespace: false;
        hostNetworkNamespace: false;
        dockerSocket: false;
        canonicalRepositoryMount: false;
        runtimeCustodyMount: false;
        completeProcessBoundary: true;
        productionIsolationClaim: true;
      }>
    | Readonly<{
        mechanism: "deterministic-test-cell";
        modelsFailureSemantics: true;
        productionIsolationClaim: false;
      }>;
  lifecycleGuarantees: Readonly<{
    deterministicAllocation: true;
    oneCellPerSpecification: true;
    oneTimeDispatch: true;
    directObservation: true;
    monotonicCancellation: true;
    retrievalAfterContainment: true;
    retirementBeforeCompletion: true;
    reclamationAfterRetirement: true;
  }>;
  imagePolicy: Readonly<{
    immutableDigestRequired: true;
    mutableTagsAllowed: false;
    platformVerification: true;
    runnerAndToolInventoryVerification: true;
  }>;
  transferPolicy: Readonly<{
    inputModes: readonly ("bounded-archive" | "bounded-volume")[];
    outputModes: readonly ("bounded-archive" | "bounded-volume")[];
    contentValidation: "runtime-independent";
    physicalIdentityIsLogicalInput: false;
  }>;
  networkPolicy: Readonly<{
    providerControlPlaneModes: readonly ("none" | "fixed-service-channel")[];
    agentProductNetworkModes: readonly ("none" | "loopback" | "bounded-egress")[];
    separationRequired: true;
  }>;
  credentialPolicy: Readonly<{
    injectionModes: readonly ("none" | "fixed-runner" | "isolated-broker")[];
    agentAccess: false;
    outputDisclosure: false;
    diagnosticDisclosure: false;
  }>;
  limits: Readonly<{
    maximumWallTimeMilliseconds: number;
    maximumProcesses: number;
    maximumStorageBytes: number;
    maximumOutputEntries: number;
    maximumOutputBytes: number;
    maximumOutputEntryBytes: number;
    maximumEvents: number;
  }>;
  outputPolicy: Readonly<{
    manifestProfile: "lifecycle.execution-output-manifest.v1";
    allowedModeClasses: readonly ["regular", "executable"];
    linksAllowed: false;
    specialFilesAllowed: false;
    extraEntriesAllowed: false;
  }>;
  qualificationClaims: readonly Readonly<{
    claimId: string;
    evidenceDigest: Sha256;
  }>[];
  digest: Sha256;
}>;

export type FoundationExecutionImageReferenceV1 = Readonly<{
  imageId: string;
  imageDigest: Sha256;
}>;

export type FoundationExecutionInputSetReferenceV1 = Readonly<{
  profileId: "lifecycle.execution-input-set.v2";
  digest: Sha256;
}>;

export type FoundationExecutionOutputPurposeV1 =
  | "candidate-output"
  | "agent-work-product"
  | "check-proof"
  | "raw-provider-output"
  | "raw-check-output"
  | "operational-artifact";

/**
 * One logical Carrier boundary. A builder's sole `candidate-output` root is
 * optional because a terminal failure may produce no successor. When present,
 * it denotes one complete successor repository tree, never a delta.
 */
export type FoundationExecutionDeclaredOutputRootV1 = Readonly<{
  path: string;
  purpose: FoundationExecutionOutputPurposeV1;
  required: boolean;
  allowedModeClasses: readonly ("regular" | "executable")[];
  maximumEntries: number;
  maximumBytes: number;
}>;

/** Complete schema-validated Specification retained across the Backend seam. */
export type FoundationExecutionSpecificationV1 = ControlJsonObject & Readonly<{
  schema: "lifecycle.execution-specification.v1";
  owner:
    | Readonly<{
        kind: "agent-attempt";
        activityId: string;
        attempt: Readonly<{
          kind: "agent-attempt";
          id: string;
          revision: number;
          digest: Sha256;
        }>;
      }>
    | Readonly<{
        kind: "check";
        activityId: string;
        selectionId: string;
        phase: "baseline" | "final";
        ownerSubjectDigest: Sha256;
      }>;
  backendProfile: FoundationExecutionBackendProfileReferenceV1;
  image: FoundationExecutionImageReferenceV1;
  inputSet: FoundationExecutionInputSetReferenceV1;
  operation:
    | Readonly<{
        kind: "agent-attempt";
        role: "reconnaissance" | "builder" | "reviewer";
        providerDescriptorDigest: Sha256;
        adapterImplementationDigest: Sha256;
      }>
    | Readonly<{
        kind: "check";
        phase: "baseline" | "final";
        selectionId: string;
        definitionDigest: Sha256;
        bindingDigest: Sha256;
        runnerImplementationDigest: Sha256;
        parserImplementationDigest: Sha256;
      }>;
  runner: Readonly<{
    contractId: "lifecycle.execution-cell-runner.v1";
    contractDigest: Sha256;
    operationId: string;
    argumentsDigest: Sha256;
  }>;
  environment: readonly Readonly<{
    name: string;
    source: "fixed-runtime" | "input-set" | "credential-injection";
    bindingDigest: Sha256;
  }>[];
  capabilities: Readonly<{
    capabilityProfileDigest: Sha256;
    candidateWrites: boolean;
    temporaryWrites: boolean;
    subprocesses: "none" | "repository-toolchain";
    externalEffects: boolean;
    dockerDaemonAccess: false;
  }>;
  networkPolicy: Readonly<{
    agentProductNetwork: "none" | "loopback" | "bounded-egress";
    agentPolicyDigest: Sha256;
    providerControlPlane: "none" | "fixed-service-channel";
    providerPolicyDigest: Sha256 | null;
    separationRequired: true;
  }>;
  credentialPolicy: Readonly<{
    mode: "none" | "fixed-runner" | "isolated-broker";
    bindings: readonly Readonly<{ id: string; policyDigest: Sha256 }>[];
    agentAccess: false;
    outputDisclosure: false;
  }>;
  limits: Readonly<{
    wallTimeMilliseconds: number;
    processes: number;
    storageBytes: number;
    outputEntries: number;
    outputBytes: number;
    outputEntryBytes: number;
    events: number;
  }>;
  outputContract: Readonly<{
    manifestProfile: "lifecycle.execution-output-manifest.v1";
    declaredOutputRoots: readonly FoundationExecutionDeclaredOutputRootV1[];
    allowedModeClasses: readonly ["regular", "executable"];
    extraEntriesAllowed: false;
    digest: Sha256;
  }>;
  terminalPolicy: Readonly<{
    directObservationRequired: true;
    containmentRequired: true;
    retrievalAfterContainment: true;
    retirementRequired: true;
    reclamation: "asynchronous-private";
  }>;
  digest: Sha256;
}>;

export type FoundationExecutionTerminalObservationV1 = Readonly<{
  finishedAt: string;
  reason: "exited" | "cancelled" | "timed-out" | "backend-failure" | "parent-loss" | "unknown";
  exitCode: number | null;
  signal: string | null;
  runnerDisposition: "completed" | "refused" | "incomplete" | "unavailable" | "unknown";
}>;

export type FoundationExecutionObservationV1 = Readonly<{
  schema: "lifecycle.execution-observation.v1";
  specificationDigest: Sha256;
  backendProfile: FoundationExecutionBackendProfileReferenceV1;
  imageDigest: Sha256;
  inputSetDigest: Sha256;
  observationSequence: number;
  observedAt: string;
  allocationState: "absent" | "allocated" | "ambiguous" | "unavailable";
  dispatchState: "not-observed" | "accepted" | "start-observed" | "terminal-observed" | "ambiguous";
  processState: "not-observed" | "not-started" | "running" | "terminal" | "ambiguous";
  terminal: FoundationExecutionTerminalObservationV1 | null;
  containmentFacts: Readonly<{
    rootProcess: "not-started" | "terminal" | "running" | "unverified";
    descendants: "absent" | "present" | "unverified";
    writers: "absent" | "present" | "unverified";
    credentials: "revoked" | "active" | "unverified" | "not-injected";
    providerChannel: "unreachable" | "reachable" | "unverified" | "not-granted";
    outputMutation: "impossible" | "possible" | "unverified";
  }>;
  output: Readonly<{
    disposition: "not-produced" | "complete" | "missing" | "partial" | "unavailable" | "ambiguous";
    manifestDigest: Sha256 | null;
    carrierByteLength: number | null;
  }>;
  resourceFacts: Readonly<{
    wallTimeMilliseconds: number | null;
    cpuTimeMilliseconds: number | null;
    peakMemoryBytes: number | null;
    storageBytes: number | null;
    outputBytes: number | null;
    eventCount: number | null;
    limitBreaches: readonly (
      | "wall-time"
      | "processes"
      | "storage"
      | "output-entries"
      | "output-bytes"
      | "output-entry-bytes"
      | "events"
    )[];
  }>;
  digest: Sha256;
}>;

export type FoundationExecutionOutputManifestEntryV1 = Readonly<{
  path: string;
  entryKind: "file";
  purpose: FoundationExecutionOutputPurposeV1;
  mediaType: string;
  modeClass: "regular" | "executable";
  byteLength: number;
  digest: Sha256;
}>;

/** The output owner validates this Manifest; the Backend only transports it. */
export type FoundationExecutionOutputManifestV1 = Readonly<{
  schema: "lifecycle.execution-output-manifest.v1";
  specificationDigest: Sha256;
  inputSetDigest: Sha256;
  imageDigest: Sha256;
  outputContractDigest: Sha256;
  runnerDigest: Sha256;
  completedAt: string;
  entries: readonly FoundationExecutionOutputManifestEntryV1[];
  entryCount: number;
  aggregateByteLength: number;
  entryInventoryDigest: Sha256;
  digest: Sha256;
}>;

function invalid(message: string, observedFacts?: unknown): never {
  throw new FoundationError("lifecycle.execution.contract-invalid", message, { observedFacts });
}

function freezeJson<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}

function exactJson<T>(value: unknown): T {
  return freezeJson(JSON.parse(canonicalJson(value)) as T);
}

function assertSelfDigest(value: Readonly<{ digest: Sha256 }>, label: string): void {
  if (value.digest !== selfDigest(value as unknown as Record<string, unknown>)) {
    invalid(`${label} self-digest does not match its exact canonical value`);
  }
}

function sameBackendReference(
  left: FoundationExecutionBackendProfileReferenceV1,
  right: FoundationExecutionBackendProfileReferenceV1,
): boolean {
  return left.profileId === right.profileId &&
    left.profileDigest === right.profileDigest &&
    left.implementationDigest === right.implementationDigest;
}

function assertStrictlyOrdered<T>(
  values: readonly T[],
  identity: (value: T) => string,
  label: string,
): void {
  for (let index = 1; index < values.length; index += 1) {
    if (compareCodePoints(identity(values[index - 1]!), identity(values[index]!)) >= 0) {
      invalid(`${label} is not strictly code-point ordered`, { index });
    }
  }
}

function assertSpecificationRestrictions(
  specification: FoundationExecutionSpecificationV1,
  profile: FoundationExecutionBackendProfileV1,
): void {
  const limits = [
    ["wall time", specification.limits.wallTimeMilliseconds, profile.limits.maximumWallTimeMilliseconds],
    ["processes", specification.limits.processes, profile.limits.maximumProcesses],
    ["storage bytes", specification.limits.storageBytes, profile.limits.maximumStorageBytes],
    ["output entries", specification.limits.outputEntries, profile.limits.maximumOutputEntries],
    ["output bytes", specification.limits.outputBytes, profile.limits.maximumOutputBytes],
    ["output entry bytes", specification.limits.outputEntryBytes, profile.limits.maximumOutputEntryBytes],
    ["events", specification.limits.events, profile.limits.maximumEvents],
  ] as const;
  for (const [name, selected, maximum] of limits) {
    if (selected > maximum) {
      invalid(`Execution Specification ${name} limit exceeds its Backend Profile`, {
        maximum,
        selected,
      });
    }
  }
  if (!profile.networkPolicy.agentProductNetworkModes.includes(
    specification.networkPolicy.agentProductNetwork,
  ) || !profile.networkPolicy.providerControlPlaneModes.includes(
    specification.networkPolicy.providerControlPlane,
  )) {
    invalid("Execution Specification network policy is not permitted by its Backend Profile");
  }
  if (!profile.credentialPolicy.injectionModes.includes(specification.credentialPolicy.mode)) {
    invalid("Execution Specification credential policy is not permitted by its Backend Profile");
  }
  if (specification.outputContract.manifestProfile !== profile.outputPolicy.manifestProfile ||
      specification.outputContract.extraEntriesAllowed !== profile.outputPolicy.extraEntriesAllowed ||
      specification.outputContract.allowedModeClasses.some(
        (mode) => !profile.outputPolicy.allowedModeClasses.includes(mode),
      )) {
    invalid("Execution Specification output transport is not permitted by its Backend Profile");
  }
  if (specification.limits.outputEntryBytes > specification.limits.outputBytes ||
      specification.outputContract.declaredOutputRoots.some((root) =>
        root.maximumEntries > specification.limits.outputEntries ||
        root.maximumBytes > specification.limits.outputBytes ||
        root.allowedModeClasses.some(
          (mode) => !profile.outputPolicy.allowedModeClasses.includes(mode),
        )
      )) {
    invalid("Execution Specification declared output bounds exceed its effective limits");
  }
}

function assertSpecificationConsistency(
  specification: FoundationExecutionSpecificationV1,
): void {
  if (specification.owner.kind !== specification.operation.kind) {
    invalid("Execution Specification owner and operation kinds do not match");
  }
  if (specification.owner.kind === "agent-attempt" &&
      specification.operation.kind === "agent-attempt") {
    const expectedOperationId = `agent-attempt.${specification.operation.role}`;
    if (specification.runner.operationId !== expectedOperationId) {
      invalid("Execution Specification runner operation does not match its Agent Attempt role", {
        expectedOperationId,
        observedOperationId: specification.runner.operationId,
      });
    }
  }
  if (specification.owner.kind === "check" && specification.operation.kind === "check" &&
      specification.owner.selectionId !== specification.operation.selectionId) {
    invalid("Execution Specification Check owner and operation select different subjects");
  }
  if (specification.owner.kind === "check" && specification.operation.kind === "check" &&
      specification.runner.operationId !== "check.execute") {
    invalid("Execution Specification runner operation does not select the exact Check operation", {
      expectedOperationId: "check.execute",
      observedOperationId: specification.runner.operationId,
    });
  }
  if (specification.credentialPolicy.mode === "none" &&
      specification.environment.some(({ source }) => source === "credential-injection")) {
    invalid("Execution Specification cannot source environment from disabled credential injection");
  }

  const candidateOutputRoots = specification.outputContract.declaredOutputRoots.filter(
    ({ purpose }) => purpose === "candidate-output",
  );
  const purposes = new Set(
    specification.outputContract.declaredOutputRoots.map(({ purpose }) => purpose),
  );
  const declaresCandidateOutput = candidateOutputRoots.length > 0;
  if (declaresCandidateOutput !== specification.capabilities.candidateWrites) {
    invalid("Execution Specification Candidate output and Candidate-write capability disagree");
  }
  if (declaresCandidateOutput &&
      (candidateOutputRoots.length !== 1 || candidateOutputRoots[0]!.required !== false)) {
    invalid(
      "Execution Specification Candidate output must be one exact optional complete-tree root",
    );
  }
  if (specification.operation.kind === "agent-attempt") {
    const isBuilder = specification.operation.role === "builder";
    if (specification.capabilities.candidateWrites !== isBuilder) {
      invalid(
        "Execution Specification must grant Candidate writes exactly to a builder Agent Attempt",
      );
    }
    if (purposes.has("check-proof") || purposes.has("raw-check-output")) {
      invalid("Execution Specification Agent Attempt declares Check-owned output");
    }
  } else {
    if (specification.capabilities.candidateWrites) {
      invalid("Execution Specification Check cannot receive Candidate-write capability");
    }
    if (purposes.has("candidate-output") || purposes.has("agent-work-product") ||
        purposes.has("raw-provider-output")) {
      invalid("Execution Specification Check declares Agent Attempt-owned output");
    }
  }
}

function executionObservationCombinationProblem(
  observation: FoundationExecutionObservationV1,
  specification?: FoundationExecutionSpecificationV1,
): string | null {
  const expectedRootProcess = observation.processState === "not-started"
    ? "not-started"
    : observation.processState === "running"
      ? "running"
      : observation.processState === "terminal"
        ? "terminal"
        : "unverified";
  if (observation.containmentFacts.rootProcess !== expectedRootProcess) {
    return "Execution Observation process and root-process facts disagree";
  }

  if (observation.processState === "not-started") {
    if (observation.allocationState !== "allocated" ||
        (observation.dispatchState !== "not-observed" &&
          observation.dispatchState !== "accepted")) {
      return "Execution Observation not-started fact lacks one directly observed allocated pre-start boundary";
    }
    if (observation.output.disposition !== "not-produced") {
      return "Execution Observation not-started process cannot report produced output";
    }
  } else if (observation.processState === "running") {
    if (observation.allocationState !== "allocated" ||
        observation.dispatchState !== "start-observed") {
      return "Execution Observation running process lacks an allocated start observation";
    }
  } else if (observation.processState === "terminal") {
    if (observation.dispatchState !== "terminal-observed") {
      return "Execution Observation terminal process lacks a terminal dispatch observation";
    }
  } else if (observation.processState === "ambiguous" &&
      observation.allocationState !== "ambiguous" &&
      observation.dispatchState !== "ambiguous") {
    return "Execution Observation ambiguous process lacks an ambiguous allocation or dispatch fact";
  }

  if (observation.terminal !== null && observation.terminal.finishedAt > observation.observedAt) {
    return "Execution Observation terminal time is later than its observation time";
  }

  if (observation.output.disposition === "complete" &&
      (observation.output.manifestDigest === null ||
        observation.output.carrierByteLength === null)) {
    return "Execution Observation complete output lacks one complete Manifest binding";
  }
  if ((observation.output.manifestDigest === null) !==
      (observation.output.carrierByteLength === null)) {
    return "Execution Observation output availability, Manifest digest, and byte length are not joined";
  }

  if (specification?.credentialPolicy.mode === "none" &&
      observation.containmentFacts.credentials !== "not-injected" &&
      observation.containmentFacts.credentials !== "unverified") {
    return "Execution Observation reports injected credentials excluded by its Specification";
  }
  if (specification?.networkPolicy.providerControlPlane === "none" &&
      observation.containmentFacts.providerChannel !== "not-granted" &&
      observation.containmentFacts.providerChannel !== "unverified") {
    return "Execution Observation reports a provider channel excluded by its Specification";
  }
  return null;
}

function assertExecutionObservationConsistency(
  observation: FoundationExecutionObservationV1,
  specification: FoundationExecutionSpecificationV1,
  previous: FoundationExecutionObservationV1 | null,
): void {
  const problem = executionObservationCombinationProblem(observation, specification);
  if (problem !== null) invalid(problem);
  if (previous === null) return;
  const previousProblem = executionObservationCombinationProblem(previous, specification);
  if (previousProblem !== null) invalid(`Previous ${previousProblem}`);
  if (observation.observedAt < previous.observedAt) {
    invalid("Execution Observation time regresses", {
      previousObservedAt: previous.observedAt,
      observedAt: observation.observedAt,
    });
  }

  const dispatchRank = new Map<FoundationExecutionObservationV1["dispatchState"], number>([
    ["not-observed", 0],
    ["accepted", 1],
    ["start-observed", 2],
    ["terminal-observed", 3],
  ]);
  const previousDispatchRank = dispatchRank.get(previous.dispatchState);
  const observedDispatchRank = dispatchRank.get(observation.dispatchState);
  if (previousDispatchRank !== undefined && observation.dispatchState === "ambiguous") {
    invalid("Execution Observation loses an already observed dispatch milestone to ambiguity");
  }
  if (previousDispatchRank !== undefined && observedDispatchRank !== undefined &&
      observedDispatchRank < previousDispatchRank) {
    invalid("Execution Observation dispatch standing regresses");
  }

  const processRank = new Map<FoundationExecutionObservationV1["processState"], number>([
    ["not-started", 0],
    ["running", 1],
    ["terminal", 2],
  ]);
  const previousProcessRank = processRank.get(previous.processState);
  const observedProcessRank = processRank.get(observation.processState);
  if (previousProcessRank !== undefined && observedProcessRank !== undefined &&
      observedProcessRank < previousProcessRank) {
    invalid("Execution Observation process standing regresses");
  }
  if (previous.terminal !== null) {
    if (observation.terminal === null) {
      invalid("Execution Observation loses an already observed terminal fact");
    }
    if (canonicalJson(previous.terminal) !== canonicalJson(observation.terminal)) {
      invalid("Execution Observation changes an already observed terminal fact");
    }
  }
  if (previous.output.disposition === "complete") {
    if (observation.output.disposition === "complete") {
      if (observation.output.manifestDigest !== previous.output.manifestDigest ||
          observation.output.carrierByteLength !== previous.output.carrierByteLength) {
        invalid("Execution Observation changes an already complete output binding");
      }
    } else if (observation.output.disposition !== "unavailable" &&
        observation.output.disposition !== "ambiguous") {
      invalid("Execution Observation complete output regresses to an incompatible disposition");
    }
  }

  const directContainmentFacts = [
    ["descendants", previous.containmentFacts.descendants,
      observation.containmentFacts.descendants, ["absent"]],
    ["writers", previous.containmentFacts.writers,
      observation.containmentFacts.writers, ["absent"]],
    ["credentials", previous.containmentFacts.credentials,
      observation.containmentFacts.credentials, ["revoked", "not-injected"]],
    ["providerChannel", previous.containmentFacts.providerChannel,
      observation.containmentFacts.providerChannel, ["unreachable", "not-granted"]],
    ["outputMutation", previous.containmentFacts.outputMutation,
      observation.containmentFacts.outputMutation, ["impossible"]],
  ] as const;
  /*
   * A directly inert allocation can become productive only by crossing the
   * later consumed dispatch boundary. Its pre-dispatch absence facts therefore
   * are not terminal monotonic facts. Once Backend effect entry is observed,
   * direct safe facts cannot regress to an unsafe contradictory value.
   */
  if (previous.dispatchState !== "not-observed") {
    for (const [field, prior, current, safeValues] of directContainmentFacts) {
      if (
        (safeValues as readonly string[]).includes(prior) &&
        current !== prior && current !== "unverified"
      ) {
        invalid(`Execution Observation contradicts an already direct ${field} Containment fact`, {
          current,
          previous: prior,
        });
      }
    }
  }
}

export function parseFoundationExecutionBackendProfile(
  value: unknown,
): FoundationExecutionBackendProfileV1 {
  assertFoundationSchema(
    FOUNDATION_EXECUTION_BACKEND_PROFILE_SCHEMA_ID,
    value,
    "Execution Backend Profile",
  );
  const profile = exactJson<FoundationExecutionBackendProfileV1>(value);
  assertSelfDigest(profile, "Execution Backend Profile");
  assertStrictlyOrdered(profile.platforms, canonicalJson, "Execution Backend Profile platforms");
  assertStrictlyOrdered(
    profile.qualificationClaims,
    ({ claimId }) => claimId,
    "Execution Backend Profile qualification claims",
  );
  return profile;
}

export function parseFoundationExecutionSpecification(input: Readonly<{
  value: unknown;
  backendProfile: FoundationExecutionBackendProfileV1;
  image: FoundationExecutionImageReferenceV1;
  inputSet: FoundationExecutionInputSetReferenceV1;
}>): FoundationExecutionSpecificationV1 {
  const profile = parseFoundationExecutionBackendProfile(input.backendProfile);
  assertFoundationSchema(
    FOUNDATION_EXECUTION_SPECIFICATION_SCHEMA_ID,
    input.value,
    "Execution Specification",
  );
  const specification = exactJson<FoundationExecutionSpecificationV1>(input.value);
  assertSelfDigest(specification, "Execution Specification");
  const expectedBackend = Object.freeze({
    profileId: profile.profileId,
    profileDigest: profile.digest,
    implementationDigest: profile.implementation.implementationDigest,
  });
  if (!sameBackendReference(specification.backendProfile, expectedBackend) ||
      specification.image.imageId !== input.image.imageId ||
      specification.image.imageDigest !== input.image.imageDigest ||
      specification.inputSet.profileId !== input.inputSet.profileId ||
      specification.inputSet.digest !== input.inputSet.digest) {
    invalid("Execution Specification does not bind its exact Backend Profile, implementation, Image, and Input Set");
  }
  assertStrictlyOrdered(
    specification.environment,
    ({ name }) => name,
    "Execution Specification environment",
  );
  assertStrictlyOrdered(
    specification.outputContract.declaredOutputRoots,
    ({ path }) => path,
    "Execution Specification declared output roots",
  );
  const roots = specification.outputContract.declaredOutputRoots;
  for (let index = 0; index < roots.length; index += 1) {
    for (let other = index + 1; other < roots.length; other += 1) {
      const left = roots[index]!.path;
      const right = roots[other]!.path;
      if (right.startsWith(`${left}/`) || left.startsWith(`${right}/`)) {
        invalid("Execution Specification declared output roots overlap", { index, other });
      }
    }
  }
  if (specification.outputContract.digest !== selfDigest(
    specification.outputContract as unknown as Record<string, unknown>,
  )) {
    invalid("Execution Specification output-contract digest does not match its exact value");
  }
  assertSpecificationConsistency(specification);
  assertSpecificationRestrictions(specification, profile);
  return specification;
}

export function parseFoundationExecutionObservation(input: Readonly<{
  value: unknown;
  specification: FoundationExecutionSpecificationV1;
  previous?: FoundationExecutionObservationV1 | null;
}>): FoundationExecutionObservationV1 {
  assertFoundationSchema(
    FOUNDATION_EXECUTION_OBSERVATION_SCHEMA_ID,
    input.value,
    "Execution Observation",
  );
  const observation = exactJson<FoundationExecutionObservationV1>(input.value);
  assertSelfDigest(observation, "Execution Observation");
  const specification = input.specification;
  if (observation.specificationDigest !== specification.digest ||
      !sameBackendReference(observation.backendProfile, specification.backendProfile) ||
      observation.imageDigest !== specification.image.imageDigest ||
      observation.inputSetDigest !== specification.inputSet.digest) {
    invalid("Execution Observation does not bind its exact Specification, Backend Profile, Image, and Input Set");
  }
  const previous = input.previous ?? null;
  assertExecutionObservationConsistency(observation, specification, previous);
  if (previous !== null) {
    if (previous.specificationDigest !== specification.digest ||
        !sameBackendReference(previous.backendProfile, specification.backendProfile) ||
        previous.imageDigest !== specification.image.imageDigest ||
        previous.inputSetDigest !== specification.inputSet.digest) {
      invalid("Previous Execution Observation does not bind the same exact execution subject");
    }
    if (observation.observationSequence <= previous.observationSequence) {
      invalid("Execution Observation sequence is not monotonically increasing", {
        previousSequence: previous.observationSequence,
        observedSequence: observation.observationSequence,
      });
    }
  }
  return observation;
}

/**
 * Runtime interpretation of direct facts; it grants no authority or Delivery
 * transition. Consumed dispatch authority can precede Backend method entry. In
 * that exact crash window, an allocated/not-observed/not-started observation
 * with complete direct containment facts establishes inertness without
 * restoring or consuming dispatch authority again.
 */
export function executionObservationEstablishesContainment(
  observation: FoundationExecutionObservationV1,
  dispatchAuthorityConsumed: boolean,
): boolean {
  if (executionObservationCombinationProblem(observation) !== null ||
      observation.allocationState === "ambiguous" ||
      observation.allocationState === "unavailable" ||
      observation.dispatchState === "ambiguous" ||
      observation.processState === "ambiguous" ||
      (dispatchAuthorityConsumed && observation.allocationState === "absent")) {
    return false;
  }
  const absentBeforeDispatch = !dispatchAuthorityConsumed &&
    observation.allocationState === "absent" &&
    observation.dispatchState === "not-observed" &&
    observation.processState === "not-observed" &&
    observation.terminal === null &&
    observation.containmentFacts.rootProcess === "unverified" &&
    observation.output.disposition === "not-produced" &&
    observation.output.manifestDigest === null &&
    observation.output.carrierByteLength === null;
  const processContained = absentBeforeDispatch
    ? true
    : observation.processState === "terminal"
      ? dispatchAuthorityConsumed &&
        observation.terminal !== null &&
        observation.dispatchState === "terminal-observed" &&
        observation.containmentFacts.rootProcess === "terminal"
      : observation.processState === "not-started" &&
        observation.terminal === null &&
        observation.containmentFacts.rootProcess === "not-started" &&
        (dispatchAuthorityConsumed
          ? observation.dispatchState === "accepted" ||
            observation.dispatchState === "not-observed"
          : observation.dispatchState === "not-observed");
  return processContained &&
    observation.containmentFacts.descendants === "absent" &&
    observation.containmentFacts.writers === "absent" &&
    (observation.containmentFacts.credentials === "revoked" ||
      observation.containmentFacts.credentials === "not-injected") &&
    (observation.containmentFacts.providerChannel === "unreachable" ||
      observation.containmentFacts.providerChannel === "not-granted") &&
    observation.containmentFacts.outputMutation === "impossible";
}
