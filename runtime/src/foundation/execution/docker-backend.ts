import { FoundationError } from "../error.js";
import {
  canonicalJson,
  digestCanonical,
  selfDigest,
  type Sha256,
} from "../validation/canonical.js";
import {
  compileFoundationExecutionRetrievalOutcome,
  compileExecutionReclamationObservation,
  compileExecutionReclamationBinding,
  assertFoundationExecutionAllocationKey,
  foundationExecutionAllocationKeyBindingDigest,
  parseExecutionReclamationBinding,
  parseExecutionReclamationObligation,
  privateFoundationExecutionHandle,
  type FoundationExecutionAllocationKey,
  type FoundationExecutionBackend,
  type FoundationExecutionHandle,
  type FoundationExecutionRetrievalOutcomeV1,
  type FoundationExecutionRetrievalUnavailableReasonV1,
  type FoundationExecutionReclamationBindingV1,
  type FoundationExecutionReclamationObligationV1,
  type FoundationExecutionReclamationObservationV1,
  type FoundationRetrievedExecutionOutputV1,
} from "./backend.js";
import {
  executionObservationEstablishesContainment,
  parseFoundationExecutionBackendProfile,
  parseFoundationExecutionObservation,
  parseFoundationExecutionSpecification,
  type FoundationExecutionBackendProfileV1,
  type FoundationExecutionObservationV1,
  type FoundationExecutionSpecificationV1,
  type FoundationExecutionTerminalObservationV1,
} from "./contracts.js";

const DOCKER_PROFILE_ID =
  "lifecycle.execution-backend-profile.docker-local.v1" as const;
const CELL_RUNNER_CONTRACT_ID = "lifecycle.execution-cell-runner.v1" as const;
const DOCKER_CELL_LABEL_PREFIX = "io.lifecycle.execution-cell.v1";
const MAXIMUM_DISCOVERY_RESULTS = 2;

const LABELS = Object.freeze({
  owner: `${DOCKER_CELL_LABEL_PREFIX}.owner`,
  allocationKeyDigest: `${DOCKER_CELL_LABEL_PREFIX}.allocation-key-digest`,
  specificationDigest: `${DOCKER_CELL_LABEL_PREFIX}.specification-digest`,
  profileId: `${DOCKER_CELL_LABEL_PREFIX}.profile-id`,
  profileDigest: `${DOCKER_CELL_LABEL_PREFIX}.profile-digest`,
  implementationDigest: `${DOCKER_CELL_LABEL_PREFIX}.implementation-digest`,
  imageDigest: `${DOCKER_CELL_LABEL_PREFIX}.image-digest`,
  inputSetDigest: `${DOCKER_CELL_LABEL_PREFIX}.input-set-digest`,
  outputContractDigest: `${DOCKER_CELL_LABEL_PREFIX}.output-contract-digest`,
  runnerContractDigest: `${DOCKER_CELL_LABEL_PREFIX}.runner-contract-digest`,
});

type DockerArchitecture = "amd64" | "arm64";
type DockerTransferMode = "bounded-archive" | "bounded-volume";

export type FoundationDockerEngineDescriptionV1 = Readonly<{
  schema: "lifecycle.docker-engine-description.private.v1";
  engineIdentityDigest: Sha256;
  contractDigest: Sha256;
  compatibilityProfileId: string;
  compatibleVersion: string;
  platform: Readonly<{
    os: "linux";
    architecture: DockerArchitecture;
    variant: string | null;
  }>;
}>;

export type FoundationDockerImageObservationV1 = Readonly<{
  schema: "lifecycle.docker-image-observation.private.v1";
  imageId: string;
  imageDigest: Sha256;
  platform: Readonly<{
    os: "linux";
    architecture: DockerArchitecture;
    variant: string | null;
  }>;
  immutableReference: true;
  nonRootRunner: true;
  runnerContractId: typeof CELL_RUNNER_CONTRACT_ID;
  runnerContractDigest: Sha256;
  runnerAndToolInventoryVerified: true;
}>;

export type FoundationDockerCellConfigurationV1 = Readonly<{
  schema: "lifecycle.docker-cell-configuration.private.v1";
  image: Readonly<{
    imageId: string;
    imageDigest: Sha256;
  }>;
  runner: FoundationExecutionSpecificationV1["runner"];
  inputSetDigest: Sha256;
  outputContractDigest: Sha256;
  environment: FoundationExecutionSpecificationV1["environment"];
  capabilities: FoundationExecutionSpecificationV1["capabilities"];
  networkPolicy: FoundationExecutionSpecificationV1["networkPolicy"];
  credentialPolicy: FoundationExecutionSpecificationV1["credentialPolicy"];
  limits: FoundationExecutionSpecificationV1["limits"];
  transport: Readonly<{
    input: DockerTransferMode;
    output: DockerTransferMode;
    pathFreeRuntimeInterface: true;
  }>;
  security: Readonly<{
    nonRootRunner: true;
    privileged: false;
    hostPidNamespace: false;
    hostNetworkNamespace: false;
    dockerSocket: false;
    canonicalRepositoryMount: false;
    runtimeCustodyMount: false;
    hostPathMounts: false;
    restartPolicy: "no";
    rootFilesystem: "read-only";
    addedCapabilities: readonly [];
    noNewPrivileges: true;
    outerSeccomp:
      | "docker-default"
      | "unconfined-for-nested-codex-restricted-read";
    innerAgentToolSandbox:
      | "not-applicable"
      | "codex-restricted-read-networkless-v1";
  }>;
  digest: Sha256;
}>;

export type FoundationDockerCellCreateRequestV1 = Readonly<{
  schema: "lifecycle.docker-cell-create-request.private.v1";
  allocationName: string;
  labels: Readonly<Record<string, string>>;
  specification: FoundationExecutionSpecificationV1;
  configuration: FoundationDockerCellConfigurationV1;
}>;

export type FoundationDockerCellDirectObservationV1 = Readonly<{
  observationSequence: number;
  observedAt: string;
  dispatchMarker: "not-consumed" | "consumed" | "ambiguous";
  processState: "not-started" | "running" | "terminal" | "ambiguous";
  terminal: FoundationExecutionTerminalObservationV1 | null;
  containmentFacts: FoundationExecutionObservationV1["containmentFacts"];
  output: FoundationExecutionObservationV1["output"];
  resourceFacts: FoundationExecutionObservationV1["resourceFacts"];
}>;

export type FoundationDockerCellInspectionV1 = Readonly<{
  schema: "lifecycle.docker-cell-inspection.private.v1";
  cellId: string;
  engineIdentityDigest: Sha256;
  labels: Readonly<Record<string, string>>;
  configuration: FoundationDockerCellConfigurationV1;
  direct: FoundationDockerCellDirectObservationV1;
}>;

export type FoundationDockerCellDiscoveryV1 = Readonly<{
  cells: readonly FoundationDockerCellInspectionV1[];
  truncated: boolean;
}>;

export type FoundationDockerOutputRetrievalV1 =
  | Readonly<{
      schema: "lifecycle.docker-output-retrieval.private.v1";
      disposition: "complete";
      unavailableReason: null;
      output: FoundationRetrievedExecutionOutputV1;
    }>
  | Readonly<{
      schema: "lifecycle.docker-output-retrieval.private.v1";
      disposition: "unavailable";
      unavailableReason: FoundationExecutionRetrievalUnavailableReasonV1;
      output: null;
    }>;

/**
 * Narrow private adapter over one already selected Docker Engine, immutable
 * image installation, fixed Cell runner, and bounded input/output transport.
 *
 * This contract deliberately does not pretend that the Engine API alone owns
 * the runner or transfer implementation. A production driver must implement
 * those owners and return direct normalized facts; this Backend never falls
 * back to a Runtime-host process or accepts a host path as transport.
 */
export interface FoundationDockerEngineDriverV1 {
  describe(): Promise<FoundationDockerEngineDescriptionV1>;
  inspectImage(input: Readonly<{
    imageId: string;
    imageDigest: Sha256;
    runnerContractId: typeof CELL_RUNNER_CONTRACT_ID;
    runnerContractDigest: Sha256;
  }>): Promise<FoundationDockerImageObservationV1>;
  findCells(input: Readonly<{
    labels: Readonly<Record<string, string>>;
    maximumResults: typeof MAXIMUM_DISCOVERY_RESULTS;
  }>): Promise<FoundationDockerCellDiscoveryV1>;
  inspectCell(cellId: string): Promise<FoundationDockerCellInspectionV1 | null>;
  createCell(request: FoundationDockerCellCreateRequestV1): Promise<void>;
  consumeDispatch(cellId: string): Promise<"consumed" | "already-consumed" | "ambiguous">;
  startCell(cellId: string): Promise<void>;
  cancelCell(cellId: string): Promise<void>;
  retrieveOutput(input: Readonly<{
    cellId: string;
    specificationDigest: Sha256;
    inputSetDigest: Sha256;
    imageDigest: Sha256;
    outputContractDigest: Sha256;
    runnerContractDigest: Sha256;
    maximumEntries: number;
    maximumBytes: number;
    maximumEntryBytes: number;
  }>): Promise<FoundationDockerOutputRetrievalV1>;
  removeCell(input: Readonly<{
    cellId: string;
    specificationDigest: Sha256;
  }>): Promise<"removed" | "missing" | "remaining" | "integrity-refusal">;
}

export type FoundationDockerExecutionBindingV1 = Readonly<{
  specification: FoundationExecutionSpecificationV1;
  allocationKeyDigest: Sha256;
  /** Exact Docker Engine selected when the allocation was created. */
  engineIdentityDigest: Sha256;
  dispatchAuthorityConsumed: boolean;
  /** Highest exact Execution Observation sequence already retained by Runtime support. */
  retainedObservationSequence: number | null;
  /** Null before Retirement; otherwise the exact Runtime Retirement coordinate. */
  retirementCheckpointDigest: Sha256 | null;
}>;

/** Durable Runtime operation support supplies this after Backend restart. */
export type FoundationDockerExecutionBindingResolverV1 = (
  handle: FoundationExecutionHandle,
) => Promise<FoundationDockerExecutionBindingV1 | null>;

type ResolvedBinding = {
  specification: FoundationExecutionSpecificationV1;
  allocationKeyDigest: Sha256;
  engineIdentityDigest: Sha256;
  dispatchAuthorityConsumed: boolean;
  retainedObservationSequence: number | null;
  retirementCheckpointDigest: Sha256 | null;
};

type CachedBinding = ResolvedBinding & {
  /** Volatile one-process capability; never reconstructed from durable binding. */
  sameInstanceDispatchEntryAvailable: boolean;
};

type DockerReclamationBinding = Readonly<{
  schema: "lifecycle.docker-reclamation-binding.private.v1";
  engineIdentityDigest: Sha256;
  allocationKeyDigest: Sha256;
}>;

function fail(code: string, message: string, retryable = false): never {
  throw new FoundationError(`lifecycle.execution.docker-backend.${code}`, message, {
    retryable,
  });
}

function isSha256(value: unknown): value is Sha256 {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  return Object.getOwnPropertySymbols(value).length === 0 &&
    canonicalJson(Object.getOwnPropertyNames(value).sort()) ===
      canonicalJson([...expected].sort());
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}

function parseExecutionBinding(
  value: unknown,
  profile: FoundationExecutionBackendProfileV1,
): ResolvedBinding {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      !exactKeys(value, [
        "specification",
        "allocationKeyDigest",
        "engineIdentityDigest",
        "dispatchAuthorityConsumed",
        "retainedObservationSequence",
        "retirementCheckpointDigest",
      ])) {
    fail("binding-invalid", "Docker Execution binding is not one exact closed Runtime fact");
  }
  const record = value as Record<string, unknown>;
  if (!isSha256(record.allocationKeyDigest) ||
      !isSha256(record.engineIdentityDigest) ||
      typeof record.dispatchAuthorityConsumed !== "boolean" ||
      !(record.retainedObservationSequence === null ||
        (Number.isSafeInteger(record.retainedObservationSequence) &&
          (record.retainedObservationSequence as number) >= 1)) ||
      !(record.retirementCheckpointDigest === null ||
        isSha256(record.retirementCheckpointDigest))) {
    fail("binding-invalid", "Docker Execution binding is incomplete or invalid");
  }
  return {
    specification: parseSpecification(
      record.specification as FoundationExecutionSpecificationV1,
      profile,
    ),
    allocationKeyDigest: record.allocationKeyDigest,
    engineIdentityDigest: record.engineIdentityDigest,
    dispatchAuthorityConsumed: record.dispatchAuthorityConsumed,
    retainedObservationSequence: record.retainedObservationSequence as number | null,
    retirementCheckpointDigest: record.retirementCheckpointDigest as Sha256 | null,
  };
}

function parseDockerReclamationBinding(
  value: FoundationExecutionReclamationBindingV1["backendBinding"],
): DockerReclamationBinding {
  if (!exactKeys(value, ["allocationKeyDigest", "engineIdentityDigest", "schema"]) ||
      value.schema !== "lifecycle.docker-reclamation-binding.private.v1" ||
      !isSha256(value.engineIdentityDigest) || !isSha256(value.allocationKeyDigest)) {
    fail("reclamation-binding", "Docker Reclamation binding is invalid or substituted");
  }
  return Object.freeze({
    schema: value.schema,
    engineIdentityDigest: value.engineIdentityDigest,
    allocationKeyDigest: value.allocationKeyDigest,
  });
}

function parseDockerOutputRetrieval(value: unknown): FoundationDockerOutputRetrievalV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      !exactKeys(value, ["disposition", "output", "schema", "unavailableReason"])) {
    fail("output-retrieval", "Docker output transport returned a malformed result");
  }
  const record = value as Record<string, unknown>;
  if (record.schema !== "lifecycle.docker-output-retrieval.private.v1" ||
      !((record.disposition === "complete" && record.unavailableReason === null &&
          record.output !== null && typeof record.output === "object" &&
          !Array.isArray(record.output)) ||
        (record.disposition === "unavailable" && record.output === null &&
          (record.unavailableReason === "missing" || record.unavailableReason === "partial" ||
            record.unavailableReason === "lost")))) {
    fail("output-retrieval", "Docker output transport substituted its exact result");
  }
  return Object.freeze({
    schema: "lifecycle.docker-output-retrieval.private.v1" as const,
    disposition: record.disposition,
    unavailableReason: record.unavailableReason,
    output: record.output,
  }) as FoundationDockerOutputRetrievalV1;
}

function exactIsoTime(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

function cellIdFromHandle(handle: FoundationExecutionHandle): string {
  if (!/^execution-handle-v1:[a-f0-9]{64}$/u.test(handle)) {
    fail("handle", "Docker Execution Handle is not one exact private Cell coordinate");
  }
  return handle.slice("execution-handle-v1:".length);
}

function handleFromCellId(cellId: string): FoundationExecutionHandle {
  if (!/^[a-f0-9]{64}$/u.test(cellId)) {
    fail("handle", "Docker Engine returned an invalid private Cell coordinate");
  }
  return privateFoundationExecutionHandle(`execution-handle-v1:${cellId}`);
}

function labelsFor(
  specification: FoundationExecutionSpecificationV1,
  keyDigest: Sha256,
): Readonly<Record<string, string>> {
  return Object.freeze({
    [LABELS.owner]: "lifecycle-runtime",
    [LABELS.allocationKeyDigest]: keyDigest,
    [LABELS.specificationDigest]: specification.digest,
    [LABELS.profileId]: specification.backendProfile.profileId,
    [LABELS.profileDigest]: specification.backendProfile.profileDigest,
    [LABELS.implementationDigest]: specification.backendProfile.implementationDigest,
    [LABELS.imageDigest]: specification.image.imageDigest,
    [LABELS.inputSetDigest]: specification.inputSet.digest,
    [LABELS.outputContractDigest]: specification.outputContract.digest,
    [LABELS.runnerContractDigest]: specification.runner.contractDigest,
  });
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function configurationFor(
  specification: FoundationExecutionSpecificationV1,
  profile: FoundationExecutionBackendProfileV1,
): FoundationDockerCellConfigurationV1 {
  const input = profile.transferPolicy.inputModes.includes("bounded-archive")
    ? "bounded-archive"
    : profile.transferPolicy.inputModes[0];
  const output = profile.transferPolicy.outputModes.includes("bounded-archive")
    ? "bounded-archive"
    : profile.transferPolicy.outputModes[0];
  if (input === undefined || output === undefined) {
    fail("profile", "Docker Backend Profile has no exact bounded transfer mode");
  }
  const subject = Object.freeze({
    schema: "lifecycle.docker-cell-configuration.private.v1" as const,
    image: specification.image,
    runner: specification.runner,
    inputSetDigest: specification.inputSet.digest,
    outputContractDigest: specification.outputContract.digest,
    environment: specification.environment,
    capabilities: specification.capabilities,
    networkPolicy: specification.networkPolicy,
    credentialPolicy: specification.credentialPolicy,
    limits: specification.limits,
    transport: Object.freeze({
      input,
      output,
      pathFreeRuntimeInterface: true as const,
    }),
    security: Object.freeze({
      nonRootRunner: true as const,
      privileged: false as const,
      hostPidNamespace: false as const,
      hostNetworkNamespace: false as const,
      dockerSocket: false as const,
      canonicalRepositoryMount: false as const,
      runtimeCustodyMount: false as const,
      hostPathMounts: false as const,
      restartPolicy: "no" as const,
      rootFilesystem: "read-only" as const,
      addedCapabilities: Object.freeze([]) as readonly [],
      noNewPrivileges: true as const,
      outerSeccomp: specification.owner.kind === "agent-attempt"
        ? "unconfined-for-nested-codex-restricted-read" as const
        : "docker-default" as const,
      innerAgentToolSandbox: specification.owner.kind === "agent-attempt"
        ? "codex-restricted-read-networkless-v1" as const
        : "not-applicable" as const,
    }),
  });
  return Object.freeze({ ...subject, digest: selfDigest(subject) });
}

function allocationName(keyDigest: Sha256): string {
  return `lifecycle-execution-${keyDigest.slice("sha256:".length)}`;
}

function assertEngineDescription(
  value: FoundationDockerEngineDescriptionV1,
  profile: FoundationExecutionBackendProfileV1,
): void {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      !exactKeys(value, [
        "schema",
        "engineIdentityDigest",
        "contractDigest",
        "compatibilityProfileId",
        "compatibleVersion",
        "platform",
      ]) ||
      value.schema !== "lifecycle.docker-engine-description.private.v1" ||
      !isSha256(value.engineIdentityDigest) ||
      value.contractDigest !== profile.engineContract.contractDigest ||
      value.compatibilityProfileId !== profile.engineContract.compatibilityProfileId ||
      value.compatibleVersion !== profile.engineContract.compatibleVersion ||
      value.platform === null || typeof value.platform !== "object" ||
      !profile.platforms.some((platform) => sameJson(platform, value.platform))) {
    fail("engine", "Docker Engine does not match the selected Backend Profile");
  }
}

function assertImageObservation(
  value: FoundationDockerImageObservationV1,
  specification: FoundationExecutionSpecificationV1,
  profile: FoundationExecutionBackendProfileV1,
): void {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      !exactKeys(value, [
        "schema",
        "imageId",
        "imageDigest",
        "platform",
        "immutableReference",
        "nonRootRunner",
        "runnerContractId",
        "runnerContractDigest",
        "runnerAndToolInventoryVerified",
      ]) ||
      value.schema !== "lifecycle.docker-image-observation.private.v1" ||
      value.imageId !== specification.image.imageId ||
      value.imageDigest !== specification.image.imageDigest ||
      value.immutableReference !== true ||
      value.nonRootRunner !== true ||
      value.runnerContractId !== CELL_RUNNER_CONTRACT_ID ||
      value.runnerContractDigest !== specification.runner.contractDigest ||
      value.runnerAndToolInventoryVerified !== true ||
      !profile.platforms.some((platform) => sameJson(platform, value.platform))) {
    fail("image", "Docker Engine did not prove the exact immutable Execution Image and runner");
  }
}

function parseSpecification(
  specification: FoundationExecutionSpecificationV1,
  profile: FoundationExecutionBackendProfileV1,
): FoundationExecutionSpecificationV1 {
  const parsed = parseFoundationExecutionSpecification({
    value: specification,
    backendProfile: profile,
    image: specification.image,
    inputSet: specification.inputSet,
  });
  if (parsed.backendProfile.profileId !== DOCKER_PROFILE_ID) {
    fail("profile", "Docker Backend refuses a non-Docker Execution Specification");
  }
  return parsed;
}

function assertInspectionShape(inspection: FoundationDockerCellInspectionV1): void {
  const direct = inspection.direct;
  if (inspection === null || typeof inspection !== "object" || Array.isArray(inspection) ||
      !exactKeys(inspection, [
        "schema",
        "cellId",
        "engineIdentityDigest",
        "labels",
        "configuration",
        "direct",
      ]) ||
      inspection.schema !== "lifecycle.docker-cell-inspection.private.v1" ||
      !/^[a-f0-9]{64}$/u.test(inspection.cellId) ||
      !isSha256(inspection.engineIdentityDigest) ||
      direct === null || typeof direct !== "object" || Array.isArray(direct) ||
      !Number.isSafeInteger(direct.observationSequence) || direct.observationSequence < 1 ||
      !exactIsoTime(direct.observedAt) ||
      !["not-consumed", "consumed", "ambiguous"].includes(direct.dispatchMarker) ||
      !["not-started", "running", "terminal", "ambiguous"].includes(direct.processState)) {
    fail("observation", "Docker Engine returned one malformed direct Cell observation");
  }
}

function absenceObservation(
  specification: FoundationExecutionSpecificationV1,
  dispatchAuthorityConsumed: boolean,
  sequence: number,
  observedAt: string,
): FoundationExecutionObservationV1 {
  const ambiguous = dispatchAuthorityConsumed;
  const subject = {
    schema: "lifecycle.execution-observation.v1" as const,
    specificationDigest: specification.digest,
    backendProfile: specification.backendProfile,
    imageDigest: specification.image.imageDigest,
    inputSetDigest: specification.inputSet.digest,
    observationSequence: sequence,
    observedAt,
    allocationState: ambiguous ? "ambiguous" as const : "absent" as const,
    dispatchState: ambiguous ? "ambiguous" as const : "not-observed" as const,
    processState: ambiguous ? "ambiguous" as const : "not-observed" as const,
    terminal: null,
    containmentFacts: ambiguous
      ? {
          rootProcess: "unverified" as const,
          descendants: "unverified" as const,
          writers: "unverified" as const,
          credentials: "unverified" as const,
          providerChannel: "unverified" as const,
          outputMutation: "unverified" as const,
        }
      : {
          rootProcess: "unverified" as const,
          descendants: "absent" as const,
          writers: "absent" as const,
          credentials: "not-injected" as const,
          providerChannel: "not-granted" as const,
          outputMutation: "impossible" as const,
        },
    output: {
      disposition: ambiguous ? "ambiguous" as const : "not-produced" as const,
      manifestDigest: null,
      carrierByteLength: null,
    },
    resourceFacts: {
      wallTimeMilliseconds: null,
      cpuTimeMilliseconds: null,
      peakMemoryBytes: null,
      storageBytes: null,
      outputBytes: null,
      eventCount: null,
      limitBreaches: Object.freeze([]),
    },
  };
  return Object.freeze({ ...subject, digest: selfDigest(subject) });
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

function observationFromInspection(
  inspection: FoundationDockerCellInspectionV1,
  binding: CachedBinding,
): FoundationExecutionObservationV1 {
  const { specification } = binding;
  const direct = inspection.direct;
  if (!binding.dispatchAuthorityConsumed && direct.dispatchMarker !== "not-consumed") {
    fail("dispatch-integrity", "Docker Cell reports dispatch outside the Runtime-owned boundary");
  }
  let dispatchState: FoundationExecutionObservationV1["dispatchState"];
  let processState: FoundationExecutionObservationV1["processState"] = direct.processState;
  if (direct.dispatchMarker === "ambiguous" || direct.processState === "ambiguous") {
    dispatchState = "ambiguous";
    processState = "ambiguous";
  } else if (direct.processState === "terminal") {
    if (direct.dispatchMarker !== "consumed") {
      fail("observation", "Docker Cell terminal state lacks the exact consumed dispatch marker");
    }
    dispatchState = "terminal-observed";
  } else if (direct.processState === "running") {
    if (direct.dispatchMarker !== "consumed") {
      fail("observation", "Docker Cell running state lacks the exact consumed dispatch marker");
    }
    dispatchState = "start-observed";
  } else {
    dispatchState = direct.dispatchMarker === "consumed" ? "accepted" : "not-observed";
  }
  const subject = {
    schema: "lifecycle.execution-observation.v1" as const,
    specificationDigest: specification.digest,
    backendProfile: specification.backendProfile,
    imageDigest: specification.image.imageDigest,
    inputSetDigest: specification.inputSet.digest,
    observationSequence: direct.observationSequence,
    observedAt: direct.observedAt,
    allocationState: "allocated" as const,
    dispatchState,
    processState,
    terminal: processState === "terminal" ? direct.terminal : null,
    containmentFacts: direct.containmentFacts,
    output: direct.output,
    resourceFacts: direct.resourceFacts,
  };
  return Object.freeze({ ...subject, digest: selfDigest(subject) });
}

function snapshotRetrievedOutput(
  output: FoundationRetrievedExecutionOutputV1,
  specification: FoundationExecutionSpecificationV1,
  expectedManifestDigest: Sha256,
  expectedCarrierByteLength: number,
): FoundationRetrievedExecutionOutputV1 {
  if (output === null || typeof output !== "object" || Array.isArray(output) ||
      !exactKeys(output, ["manifest", "carrierByteLength", "entries"])) {
    fail("output", "Docker output transport is not one exact bounded path-free carrier");
  }
  let manifestValue: unknown;
  let carrierByteLength: number;
  let entriesMethod: () => ReturnType<FoundationRetrievedExecutionOutputV1["entries"]>;
  try {
    manifestValue = output.manifest;
    carrierByteLength = output.carrierByteLength;
    entriesMethod = output.entries;
  } catch {
    fail("output", "Docker output transport metadata is not stable and readable");
  }
  if (typeof entriesMethod !== "function" ||
      !Number.isSafeInteger(carrierByteLength) || carrierByteLength < 0 ||
      carrierByteLength > specification.limits.outputBytes ||
      carrierByteLength !== expectedCarrierByteLength) {
    fail("output", "Docker output transport is not one exact bounded path-free carrier");
  }
  const manifest = deepFreeze(
    JSON.parse(canonicalJson(manifestValue)) as FoundationRetrievedExecutionOutputV1["manifest"],
  );
  if (manifest.digest !== selfDigest(manifest as unknown as Record<string, unknown>) ||
      manifest.digest !== expectedManifestDigest ||
      manifest.specificationDigest !== specification.digest ||
      manifest.inputSetDigest !== specification.inputSet.digest ||
      manifest.imageDigest !== specification.image.imageDigest ||
      manifest.outputContractDigest !== specification.outputContract.digest ||
      manifest.entryCount !== manifest.entries.length ||
      manifest.entryCount > specification.limits.outputEntries ||
      manifest.aggregateByteLength !== carrierByteLength ||
      manifest.aggregateByteLength > specification.limits.outputBytes) {
    fail("output", "Docker output Manifest does not bind the exact contained execution");
  }
  const entries = entriesMethod.bind(output);
  return Object.freeze({
    manifest,
    carrierByteLength,
    async *entries() {
      let index = 0;
      for await (const value of entries()) {
        if (index >= manifest.entries.length || value === null || typeof value !== "object" ||
            Array.isArray(value) ||
            !exactKeys(value, ["path", "byteLength", "digest", "read"])) {
          fail("output", "Docker output transport returned an undeclared entry reader");
        }
        let path: string;
        let byteLength: number;
        let entryDigest: Sha256;
        let readMethod: () => ReturnType<typeof value.read>;
        try {
          path = value.path;
          byteLength = value.byteLength;
          entryDigest = value.digest;
          readMethod = value.read;
        } catch {
          fail("output", "Docker output entry metadata is not stable and readable");
        }
        if (typeof readMethod !== "function") {
          fail("output", "Docker output entry reader is not callable");
        }
        const declared = manifest.entries[index]!;
        if (path !== declared.path || byteLength !== declared.byteLength ||
            entryDigest !== declared.digest || byteLength > specification.limits.outputEntryBytes) {
          fail("output", "Docker output entry reader does not bind its exact Manifest entry");
        }
        const read = readMethod.bind(value);
        yield Object.freeze({
          path,
          byteLength,
          digest: entryDigest,
          async *read() {
            let bytes = 0;
            for await (const chunk of read()) {
              if (!(chunk instanceof Uint8Array) || (chunk.byteLength === 0 && byteLength !== 0)) {
                fail("output", "Docker output entry yielded one invalid byte chunk");
              }
              bytes += chunk.byteLength;
              if (!Number.isSafeInteger(bytes) || bytes > byteLength ||
                  bytes > specification.limits.outputEntryBytes) {
                fail("output", "Docker output entry exceeded its exact byte bound");
              }
              yield Uint8Array.from(chunk);
            }
            if (bytes !== byteLength) {
              fail("output", "Docker output entry ended before its declared byte length");
            }
          },
        });
        index += 1;
      }
      if (index !== manifest.entries.length) {
        fail("output", "Docker output transport omitted one declared Manifest entry");
      }
    },
  });
}

class DockerExecutionBackend implements FoundationExecutionBackend {
  readonly profile: FoundationExecutionBackendProfileV1;
  readonly #driver: FoundationDockerEngineDriverV1;
  readonly #engine: FoundationDockerEngineDescriptionV1;
  readonly #resolveBinding: FoundationDockerExecutionBindingResolverV1;
  readonly #now: () => string;
  readonly #bindings = new Map<FoundationExecutionHandle, CachedBinding>();
  readonly #previous = new Map<FoundationExecutionHandle, FoundationExecutionObservationV1>();
  #absenceSequence = 0;

  constructor(input: Readonly<{
    profile: FoundationExecutionBackendProfileV1;
    driver: FoundationDockerEngineDriverV1;
    engine: FoundationDockerEngineDescriptionV1;
    resolveBinding: FoundationDockerExecutionBindingResolverV1;
    now: () => string;
  }>) {
    this.profile = input.profile;
    this.#driver = input.driver;
    this.#engine = input.engine;
    this.#resolveBinding = input.resolveBinding;
    this.#now = input.now;
  }

  async #assertBoundEngine(binding: CachedBinding): Promise<void> {
    let current: FoundationDockerEngineDescriptionV1;
    try {
      current = await this.#driver.describe();
    } catch {
      fail("engine-unavailable", "Docker Engine identity could not be refreshed", true);
    }
    assertEngineDescription(current, this.profile);
    if (current.engineIdentityDigest !== binding.engineIdentityDigest) {
      fail(
        "engine-substitution",
        "Docker Engine does not match the allocation's exact retained Engine identity",
      );
    }
  }

  async #binding(
    handle: FoundationExecutionHandle,
    refreshDurable = false,
  ): Promise<CachedBinding> {
    const cached = this.#bindings.get(handle);
    if (cached !== undefined && !refreshDurable) {
      await this.#assertBoundEngine(cached);
      return cached;
    }
    let value: FoundationDockerExecutionBindingV1 | null;
    try {
      value = await this.#resolveBinding(handle);
    } catch {
      fail("binding-unavailable", "Docker Execution binding could not be refreshed", true);
    }
    const resolved = value === null ? null : parseExecutionBinding(value, this.profile);
    if (resolved === null) {
      fail(
        refreshDurable ? "binding-unavailable" : "handle",
        "Docker Execution Handle has no exact Runtime-owned operation binding",
        refreshDurable,
      );
    }
    if (cached !== undefined) {
      if (!sameJson(cached.specification, resolved.specification) ||
          cached.allocationKeyDigest !== resolved.allocationKeyDigest ||
          cached.engineIdentityDigest !== resolved.engineIdentityDigest ||
          (cached.dispatchAuthorityConsumed && !resolved.dispatchAuthorityConsumed) ||
          (cached.retainedObservationSequence !== null &&
            (resolved.retainedObservationSequence === null ||
              resolved.retainedObservationSequence < cached.retainedObservationSequence)) ||
          (cached.retirementCheckpointDigest !== null &&
            cached.retirementCheckpointDigest !== resolved.retirementCheckpointDigest)) {
        fail("binding-substitution", "Docker Execution binding changed an immutable retained fact");
      }
      await this.#assertBoundEngine(cached);
      cached.dispatchAuthorityConsumed = resolved.dispatchAuthorityConsumed;
      cached.retainedObservationSequence = resolved.retainedObservationSequence;
      cached.retirementCheckpointDigest = resolved.retirementCheckpointDigest;
      return cached;
    }
    const reopened: CachedBinding = {
      ...resolved,
      sameInstanceDispatchEntryAvailable: false,
    };
    await this.#assertBoundEngine(reopened);
    this.#bindings.set(handle, reopened);
    return reopened;
  }

  async #discover(labels: Readonly<Record<string, string>>): Promise<readonly FoundationDockerCellInspectionV1[]> {
    const result = await this.#driver.findCells({ labels, maximumResults: MAXIMUM_DISCOVERY_RESULTS });
    if (result === null || typeof result !== "object" || Array.isArray(result) ||
        !exactKeys(result, ["cells", "truncated"]) || !Array.isArray(result.cells) ||
        typeof result.truncated !== "boolean" || result.truncated ||
        result.cells.length >= MAXIMUM_DISCOVERY_RESULTS) {
      fail("allocation-ambiguous", "Docker Engine allocation discovery is ambiguous", true);
    }
    for (const inspection of result.cells) assertInspectionShape(inspection);
    return result.cells;
  }

  async #assertExactInspection(
    inspection: FoundationDockerCellInspectionV1,
    binding: CachedBinding,
    expectedCellId?: string,
  ): Promise<void> {
    assertInspectionShape(inspection);
    const expectedLabels = labelsFor(binding.specification, binding.allocationKeyDigest);
    const expectedConfiguration = configurationFor(binding.specification, this.profile);
    if ((expectedCellId !== undefined && inspection.cellId !== expectedCellId) ||
        inspection.engineIdentityDigest !== binding.engineIdentityDigest ||
        !sameJson(inspection.labels, expectedLabels) ||
        !sameJson(inspection.configuration, expectedConfiguration)) {
      fail("allocation-substitution", "Docker Cell does not match its exact allocation binding");
    }
    const byKey = await this.#discover({
      [LABELS.owner]: "lifecycle-runtime",
      [LABELS.allocationKeyDigest]: binding.allocationKeyDigest,
    });
    const bySpecification = await this.#discover({
      [LABELS.owner]: "lifecycle-runtime",
      [LABELS.specificationDigest]: binding.specification.digest,
    });
    if (byKey.length !== 1 || bySpecification.length !== 1 ||
        byKey[0]!.cellId !== inspection.cellId ||
        bySpecification[0]!.cellId !== inspection.cellId) {
      fail("allocation-duplicate", "Docker allocation key or Specification selects another Cell");
    }
  }

  async #inspection(
    handle: FoundationExecutionHandle,
    binding: CachedBinding,
  ): Promise<FoundationDockerCellInspectionV1 | null> {
    const cellId = cellIdFromHandle(handle);
    const inspection = await this.#driver.inspectCell(cellId);
    if (inspection === null) return null;
    await this.#assertExactInspection(inspection, binding, cellId);
    return inspection;
  }

  #validatedObservation(
    handle: FoundationExecutionHandle,
    binding: CachedBinding,
    observation: FoundationExecutionObservationV1,
  ): FoundationExecutionObservationV1 {
    const previous = this.#previous.get(handle) ?? null;
    const sequenceFloor = Math.max(
      previous?.observationSequence ?? 0,
      binding.retainedObservationSequence ?? 0,
    );
    if (observation.observationSequence <= sequenceFloor) {
      fail(
        "observation-sequence",
        "Docker Execution Observation does not advance its exact retained sequence",
      );
    }
    const parsed = parseFoundationExecutionObservation({
      value: observation,
      specification: binding.specification,
      previous,
    });
    this.#previous.set(handle, parsed);
    return parsed;
  }

  async allocate(
    specificationInput: FoundationExecutionSpecificationV1,
    allocationKey: FoundationExecutionAllocationKey,
  ): Promise<FoundationExecutionHandle> {
    assertFoundationExecutionAllocationKey(allocationKey);
    const specification = parseSpecification(specificationInput, this.profile);
    const keyDigest = foundationExecutionAllocationKeyBindingDigest(allocationKey);
    const exactLabels = labelsFor(specification, keyDigest);
    const byKey = await this.#discover({
      [LABELS.owner]: "lifecycle-runtime",
      [LABELS.allocationKeyDigest]: keyDigest,
    });
    const bySpecification = await this.#discover({
      [LABELS.owner]: "lifecycle-runtime",
      [LABELS.specificationDigest]: specification.digest,
    });
    if (byKey.length === 1) {
      const existing = byKey[0]!;
      if (bySpecification.length !== 1 || bySpecification[0]!.cellId !== existing.cellId) {
        fail("allocation-substitution", "Docker allocation key is bound to another Specification");
      }
      if (existing.direct.dispatchMarker !== "not-consumed" ||
          existing.direct.processState !== "not-started") {
        fail(
          "allocation-dispatched",
          "Docker allocation replay cannot adopt a Cell after the Runtime dispatch boundary",
        );
      }
      const handle = handleFromCellId(existing.cellId);
      const binding: CachedBinding = {
        specification,
        allocationKeyDigest: keyDigest,
        engineIdentityDigest: this.#engine.engineIdentityDigest,
        dispatchAuthorityConsumed: false,
        retainedObservationSequence: null,
        retirementCheckpointDigest: null,
        sameInstanceDispatchEntryAvailable: true,
      };
      await this.#assertExactInspection(existing, binding);
      this.#bindings.set(handle, binding);
      return handle;
    }
    if (bySpecification.length !== 0) {
      fail("allocation-duplicate", "Docker Specification already has another allocation");
    }
    const image = await this.#driver.inspectImage({
      imageId: specification.image.imageId,
      imageDigest: specification.image.imageDigest,
      runnerContractId: CELL_RUNNER_CONTRACT_ID,
      runnerContractDigest: specification.runner.contractDigest,
    });
    assertImageObservation(image, specification, this.profile);
    const configuration = configurationFor(specification, this.profile);
    await this.#driver.createCell(Object.freeze({
      schema: "lifecycle.docker-cell-create-request.private.v1" as const,
      allocationName: allocationName(keyDigest),
      labels: exactLabels,
      specification,
      configuration,
    }));
    const created = await this.#discover({
      [LABELS.owner]: "lifecycle-runtime",
      [LABELS.allocationKeyDigest]: keyDigest,
    });
    if (created.length !== 1) {
      fail("allocation-unavailable", "Docker Cell creation has no one exact observable result", true);
    }
    const handle = handleFromCellId(created[0]!.cellId);
    const binding: CachedBinding = {
      specification,
      allocationKeyDigest: keyDigest,
      engineIdentityDigest: this.#engine.engineIdentityDigest,
      dispatchAuthorityConsumed: false,
      retainedObservationSequence: null,
      retirementCheckpointDigest: null,
      sameInstanceDispatchEntryAvailable: true,
    };
    await this.#assertExactInspection(created[0]!, binding);
    this.#bindings.set(handle, binding);
    return handle;
  }

  async dispatch(handle: FoundationExecutionHandle): Promise<FoundationExecutionObservationV1> {
    const binding = await this.#binding(handle, true);
    if (binding.retirementCheckpointDigest !== null) {
      fail("retired", "Docker Cell dispatch is refused after Runtime Retirement");
    }
    if (!binding.sameInstanceDispatchEntryAvailable) {
      fail("redispatch", "Docker Cell dispatch authority was already consumed");
    }
    if (!binding.dispatchAuthorityConsumed) {
      fail("dispatch-authority", "Docker Cell dispatch lacks durable Runtime authority consumption");
    }
    binding.sameInstanceDispatchEntryAvailable = false;
    const inspection = await this.#inspection(handle, binding);
    if (inspection === null) {
      fail("allocation-unavailable", "Docker Cell is absent before dispatch", true);
    }
    const consumed = await this.#driver.consumeDispatch(inspection.cellId);
    if (consumed === "already-consumed") {
      fail("redispatch", "Docker Cell dispatch marker was already consumed");
    }
    if (consumed !== "consumed") {
      fail("dispatch-ambiguous", "Docker Cell dispatch marker is ambiguous", true);
    }
    await this.#driver.startCell(inspection.cellId);
    return await this.observe(handle);
  }

  async observe(handle: FoundationExecutionHandle): Promise<FoundationExecutionObservationV1> {
    const binding = await this.#binding(handle);
    const inspection = await this.#inspection(handle, binding);
    if (inspection === null) {
      const observedAt = this.#now();
      if (!exactIsoTime(observedAt)) fail("clock", "Docker Backend clock is invalid");
      this.#absenceSequence += 1;
      const previousSequence = Math.max(
        this.#previous.get(handle)?.observationSequence ?? 0,
        binding.retainedObservationSequence ?? 0,
      );
      return this.#validatedObservation(
        handle,
        binding,
        absenceObservation(
          binding.specification,
          binding.dispatchAuthorityConsumed,
          Math.max(previousSequence + 1, this.#absenceSequence),
          observedAt,
        ),
      );
    }
    const observation = this.#validatedObservation(
      handle,
      binding,
      observationFromInspection(inspection, binding),
    );
    if (!binding.dispatchAuthorityConsumed &&
        binding.retirementCheckpointDigest === null &&
        isDirectPreDispatchReadiness(observation)) {
      binding.sameInstanceDispatchEntryAvailable = true;
    }
    return observation;
  }

  async cancel(handle: FoundationExecutionHandle): Promise<FoundationExecutionObservationV1> {
    const binding = await this.#binding(handle);
    const inspection = await this.#inspection(handle, binding);
    if (inspection === null) return await this.observe(handle);
    await this.#driver.cancelCell(inspection.cellId);
    return await this.observe(handle);
  }

  async retrieve(
    handle: FoundationExecutionHandle,
    sourceObservation: FoundationExecutionObservationV1,
  ): Promise<FoundationExecutionRetrievalOutcomeV1> {
    const binding = await this.#binding(handle, true);
    const source = parseFoundationExecutionObservation({
      value: sourceObservation,
      specification: binding.specification,
    });
    if (binding.retainedObservationSequence !== source.observationSequence) {
      fail("retrieval-source", "Docker retrieval source is not the exact retained observation");
    }
    if (!executionObservationEstablishesContainment(
      source,
      binding.dispatchAuthorityConsumed,
    )) {
      fail("containment-required", "Docker output retrieval requires retained Containment");
    }
    if (source.output.disposition !== "complete" ||
        source.output.manifestDigest === null || source.output.carrierByteLength === null) {
      fail("output-not-applicable", "Docker output retrieval requires retained complete output");
    }
    const inspection = await this.#inspection(handle, binding);
    if (inspection === null) {
      fail("retrieval-source-changed", "Docker Cell changed after the retained observation", true);
    }
    const current = parseFoundationExecutionObservation({
      value: observationFromInspection(inspection, binding),
      specification: binding.specification,
    });
    const sourceBasis = Object.freeze({
      allocationState: source.allocationState,
      dispatchState: source.dispatchState,
      processState: source.processState,
      terminal: source.terminal,
      containmentFacts: source.containmentFacts,
      output: source.output,
    });
    const currentBasis = Object.freeze({
      allocationState: current.allocationState,
      dispatchState: current.dispatchState,
      processState: current.processState,
      terminal: current.terminal,
      containmentFacts: current.containmentFacts,
      output: current.output,
    });
    if (current.observationSequence < source.observationSequence ||
        (current.observationSequence === source.observationSequence &&
          current.digest !== source.digest) ||
        canonicalJson(currentBasis) !== canonicalJson(sourceBasis) ||
        !executionObservationEstablishesContainment(
          current,
          binding.dispatchAuthorityConsumed,
        )) {
      fail(
        "retrieval-source-changed",
        "Docker Cell changed after the retained output observation",
        true,
      );
    }
    const transport = parseDockerOutputRetrieval(await this.#driver.retrieveOutput({
      cellId: inspection.cellId,
      specificationDigest: binding.specification.digest,
      inputSetDigest: binding.specification.inputSet.digest,
      imageDigest: binding.specification.image.imageDigest,
      outputContractDigest: binding.specification.outputContract.digest,
      runnerContractDigest: binding.specification.runner.contractDigest,
      maximumEntries: binding.specification.limits.outputEntries,
      maximumBytes: binding.specification.limits.outputBytes,
      maximumEntryBytes: binding.specification.limits.outputEntryBytes,
    }));
    if (transport.disposition === "unavailable") {
      return compileFoundationExecutionRetrievalOutcome({
        specification: binding.specification,
        handle,
        observation: source,
        disposition: "unavailable",
        unavailableReason: transport.unavailableReason,
      });
    }
    const output = snapshotRetrievedOutput(
      transport.output,
      binding.specification,
      source.output.manifestDigest,
      source.output.carrierByteLength,
    );
    return compileFoundationExecutionRetrievalOutcome({
      specification: binding.specification,
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
    const specification = parseSpecification(input.specification, this.profile);
    const binding = await this.#binding(input.handle, true);
    if (!sameJson(binding.specification, specification) ||
        binding.dispatchAuthorityConsumed !== input.dispatchAuthorityConsumed ||
        (binding.retirementCheckpointDigest !== null &&
          binding.retirementCheckpointDigest !== input.retirementCheckpointDigest)) {
      fail("reclamation-binding", "Docker Reclamation binding substituted retained Runtime facts");
    }
    return compileExecutionReclamationBinding({
      specification,
      handle: input.handle,
      retirementCheckpointDigest: input.retirementCheckpointDigest,
      dispatchAuthorityConsumed: input.dispatchAuthorityConsumed,
      backendBinding: Object.freeze({
        schema: "lifecycle.docker-reclamation-binding.private.v1" as const,
        engineIdentityDigest: binding.engineIdentityDigest,
        allocationKeyDigest: binding.allocationKeyDigest,
      }),
    });
  }

  async reclaim(
    specificationInput: FoundationExecutionSpecificationV1,
    bindingInput: FoundationExecutionReclamationBindingV1,
    obligationInput: FoundationExecutionReclamationObligationV1,
  ): Promise<FoundationExecutionReclamationObservationV1> {
    const specification = parseSpecification(specificationInput, this.profile);
    const retained = parseExecutionReclamationBinding(bindingInput, specification);
    const physical = parseDockerReclamationBinding(retained.backendBinding);
    const binding: CachedBinding = {
      specification,
      allocationKeyDigest: physical.allocationKeyDigest,
      engineIdentityDigest: physical.engineIdentityDigest,
      dispatchAuthorityConsumed: retained.dispatchAuthorityConsumed,
      retainedObservationSequence: null,
      retirementCheckpointDigest: retained.retirementCheckpointDigest,
      sameInstanceDispatchEntryAvailable: false,
    };
    await this.#assertBoundEngine(binding);
    const obligation = parseExecutionReclamationObligation(
      obligationInput,
      specification,
      retained,
    );
    const handle = retained.handle;
    const cellId = cellIdFromHandle(handle);
    let disposition: FoundationExecutionReclamationObservationV1["disposition"];
    const inspection = await this.#driver.inspectCell(cellId);
    if (inspection === null) {
      try {
        const byKey = await this.#discover({
          [LABELS.owner]: "lifecycle-runtime",
          [LABELS.allocationKeyDigest]: binding.allocationKeyDigest,
        });
        const bySpecification = await this.#discover({
          [LABELS.owner]: "lifecycle-runtime",
          [LABELS.specificationDigest]: binding.specification.digest,
        });
        if (byKey.length !== 0 || bySpecification.length !== 0) {
          disposition = "integrity-refusal";
        } else {
          // A lost controller may have removed the Cell and its Reclamation
          // anchor while an exact dispatch marker remains. Absence from public
          // Cell discovery is therefore not sufficient Reclamation evidence.
          const removed = await this.#driver.removeCell({
            cellId,
            specificationDigest: binding.specification.digest,
          });
          if (removed === "integrity-refusal") {
            disposition = "integrity-refusal";
          } else if (removed === "remaining") {
            disposition = "remaining";
          } else {
            const after = await this.#driver.inspectCell(cellId);
            const afterByKey = await this.#discover({
              [LABELS.owner]: "lifecycle-runtime",
              [LABELS.allocationKeyDigest]: binding.allocationKeyDigest,
            });
            const afterBySpecification = await this.#discover({
              [LABELS.owner]: "lifecycle-runtime",
              [LABELS.specificationDigest]: binding.specification.digest,
            });
            disposition = after === null && afterByKey.length === 0 &&
                afterBySpecification.length === 0
              ? "reclaimed"
              : "integrity-refusal";
          }
        }
      } catch (error) {
        if (error instanceof FoundationError &&
            error.code.endsWith("allocation-ambiguous")) {
          disposition = "integrity-refusal";
        } else {
          throw error;
        }
      }
    } else {
      try {
        await this.#assertExactInspection(inspection, binding, cellId);
        const observation = observationFromInspection(inspection, binding);
        if (!executionObservationEstablishesContainment(
          observation,
          binding.dispatchAuthorityConsumed,
        )) {
          disposition = "integrity-refusal";
        } else {
          const removed = await this.#driver.removeCell({
            cellId,
            specificationDigest: binding.specification.digest,
          });
          if (removed === "integrity-refusal") {
            disposition = "integrity-refusal";
          } else if (removed === "remaining") {
            disposition = "remaining";
          } else {
            const after = await this.#driver.inspectCell(cellId);
            const byKey = await this.#discover({
              [LABELS.owner]: "lifecycle-runtime",
              [LABELS.allocationKeyDigest]: binding.allocationKeyDigest,
            });
            const bySpecification = await this.#discover({
              [LABELS.owner]: "lifecycle-runtime",
              [LABELS.specificationDigest]: binding.specification.digest,
            });
            disposition = after === null && byKey.length === 0 && bySpecification.length === 0
              ? "reclaimed"
              : "integrity-refusal";
          }
        }
      } catch (error) {
        if (error instanceof FoundationError &&
            (error.code.endsWith("allocation-substitution") ||
              error.code.endsWith("allocation-duplicate") ||
              error.code.endsWith("allocation-ambiguous"))) {
          disposition = "integrity-refusal";
        } else {
          throw error;
        }
      }
    }
    const observedAt = this.#now();
    if (!exactIsoTime(observedAt)) fail("clock", "Docker Backend clock is invalid");
    const factsDigest = digestCanonical({
      schema: "lifecycle.docker-reclamation-facts.private.v1",
      engineIdentityDigest: binding.engineIdentityDigest,
      allocationIdentityDigest: retained.allocationIdentityDigest,
      disposition,
    });
    return compileExecutionReclamationObservation({
      obligation,
      observedAt,
      disposition,
      factsDigest,
    });
  }
}

export async function createFoundationDockerExecutionBackend(input: Readonly<{
  profile: FoundationExecutionBackendProfileV1;
  driver: FoundationDockerEngineDriverV1;
  resolveBinding?: FoundationDockerExecutionBindingResolverV1;
  now?: () => string;
}>): Promise<FoundationExecutionBackend> {
  const profile = parseFoundationExecutionBackendProfile(input.profile);
  if (profile.profileId !== DOCKER_PROFILE_ID || profile.backendKind !== "docker-local" ||
      profile.usage !== "production" || profile.engineContract.kind !== "docker-engine" ||
      profile.isolation.mechanism !== "oci-container") {
    fail("profile", "Docker Backend requires the exact production Docker-local Profile");
  }
  const engine = await input.driver.describe();
  assertEngineDescription(engine, profile);
  return new DockerExecutionBackend({
    profile,
    driver: input.driver,
    engine,
    resolveBinding: input.resolveBinding ?? (async () => null),
    now: input.now ?? (() => new Date().toISOString()),
  });
}
