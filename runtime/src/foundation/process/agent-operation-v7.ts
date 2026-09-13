import { compileFoundationAgentExecutionSelectionV1, parseFoundationAgentExecutionSelectionV1, type FoundationAgentExecutionSelectionV1 } from "../execution/agent-selection-v1.js";
import {
  readWorkDelegationExecution,
  workDelegationAgentSlot,
  workDelegationRetainedAgentSelectionMatches,
} from "../control/work-delegation-execution.js";
import type { WorkDelegationReservation } from "../control/work-delegation.js";
import { foundationUnallocatedExecutionRefusalV1, foundationExecutionAllocationKeyBindingDigest } from "../execution/backend.js";
import { compileAgentPreIntentRefusalAppend, compileDeliveryActivityCompletionAppend, type ControlActivityReadView } from "../control/activity.js";
import { createDeliveryReplay } from "./delivery-reducer.js";
import { prepareProjectionMaterialConditionV1 } from "../control/material-condition.js";
import type { FoundationMandatoryProjectionRefusalV1 } from "../projection/mandatory-refusal.js";
import { parseFoundationPreparationBasisBindingV7, type FoundationPreparationBasisBindingV7 } from "./preparation-basis-v7.js";
import { openFoundationDeliveryGitContextV1 } from "../repository/delivery-git-context.js";
import { FOUNDATION_DELIVERY_GIT_CONTEXT_PATHS_V1 } from "../repository/delivery-git-context-manifest.js";
import { readFile } from "node:fs/promises";
import { FOUNDATION_RUNTIME_PROTOCOL } from "../constants.js";
import {
  FOUNDATION_AGENT_EXECUTION_CELL_INPUT_V1,
  compileFoundationAgentCellInputV1,
  compileFoundationAgentCellSpecificationV1,
  type FoundationAgentCellActivityOwnerV1,
  type FoundationAgentCellImmutableEntryV1,
  type FoundationAgentCellImmutableSubjectV1,
  type FoundationAgentCellOperationResultV1,
  type FoundationAgentCellPersistenceBindingV1,
  type FoundationCompiledAgentCellInputV1,
} from "../attempt/execution-cell-v1.js";
import type { ProviderInputV4 } from "../attempt/provider-input-v4.js";
import { verifyProviderInputV4, PROVIDER_INPUT_SEMANTIC_BASIS_PATH } from "../attempt/provider-input-v4.js";
import {
  openCandidateRevisionCarrier,
} from "../candidate/carrier-store.js";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
} from "../candidate/carrier-types.js";
import {
  candidateRevisionCarrierVerifierFromWorkBoundary,
} from "../candidate/carrier-binding.js";
import {
  candidateOutputRejectionV1,
  parseCandidateOutputRejectionV1,
  type FoundationCandidateOutputRejectionV1,
} from "../candidate/carrier-state-observer.js";
import { compileFoundationBuilderRepairOutputV1, FOUNDATION_BUILDER_REPAIR_PURPOSES } from "../candidate/repair-output.js";
import type {
  FoundationPublishedCandidateOutputCarrierV1,
} from "../candidate/candidate-output-carrier.js";
import {
  abandonAgentWorkProduct,
  compileProviderEffectObservationAppend,
  type DeliveryActivityOutcome,
} from "../control/activity.js";
import {
  compileAgentAttemptAppend,
  type AgentAttemptExecutionPolicy,
  type AgentAttemptInvestment,
  type AgentAttemptOperation,
  type AgentAttemptRole,
} from "../control/agent-attempt.js";
import {
  agentWorkProductCompilerProfileDigest,
  agentWorkProductParserProfileDigest,
  createAgentWorkProductValidationBasis,
  FOUNDATION_AGENT_WORK_PRODUCT_COMPILER_PROFILE_ID,
  FOUNDATION_AGENT_WORK_PRODUCT_PARSER_PROFILE_ID,
  validateAgentWorkProductSemanticMarkdown,
  type AgentWorkProductValidationBasis,
  type AgentWorkProductPropositionSet,
} from "../control/agent-work-product-semantics.js";
import { finalizeAgentWorkProductSemanticBytes } from "../control/agent-work-product.js";
import {
  prepareCandidateRevisionRetention,
} from "../control/candidate-revision.js";
import {
  compileExecutionReceiptProviderFailureMaterial,
  retainExecutionReceipt,
  type ExecutionReceiptProviderObservation,
  type ExecutionReceiptRawMaterial,
  type ExecutionReceiptSubmissionDiagnostic,
  type ExecutionReceiptWorkspaceObservation,
} from "../control/execution-receipt.js";
import {
  compileAgentActivityOpening,
  compileDelegatedAgentActivityOpening,
  type CompiledAgentActivityOpening,
} from "../control/director-brief.js";
import {
  compileControlRecordEvent,
  compileControlRecordRevision,
  controlIdentifier,
  controlTimestamp,
  normalizeSemanticMarkdown,
} from "../control/model.js";
import type { ControlRecordStore } from "../control/store.js";
import type {
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordEvent,
  ControlRecordOperationSupportCoordinate,
  ControlRecordRevision,
  ControlRecordStoreAppend,
  ControlRecordStoreAppendResult,
} from "../control/types.js";
import { FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR } from "../repository/contract.js";
import type { FoundationProcessRuntimeConfigurationV7 } from "../installed-configuration-v7.js";
import type { FoundationCompiledProjection } from "../projection/types.js";
import {
  createFoundationActivityKernelCheckpointAdapterV7,
  finishFoundationActivityKernelV7,
  openFoundationActivityKernelV7,
  readFoundationActivityKernelV7,
  recoverFoundationActivityKernelV7,
  type FoundationActivityKernelCheckpointAdapterV7,
  type FoundationActivityKernelContextV7,
  type FoundationActivityKernelStandardDefinitionV7,
} from "./activity-kernel-v7.js";
import {
  createFoundationActivityChildCheckpointAdapterV7,
  narrowFoundationActivityChildCheckpointAdapterV7,
  type FoundationActivityChildCheckpointAdapterV7,
} from "./activity-child-checkpoint-v7.js";
import {
  commitPreparedCandidateRevisionThroughActivityV7,
} from "./candidate-revision-retention-v7.js";
import {
  createFoundationActivityExecutionCheckpointPersistenceV1,
} from "../execution/activity-checkpoint-persistence-v1.js";
import type {
  FoundationExecutionInputSetV1,
} from "../execution/input-set.js";
import type {
  FoundationExecutionOperationCheckpointCoordinateV1,
  FoundationExecutionOperationCheckpointV1,
  FoundationRetainedExecutionOperationCheckpointV1,
} from "../execution/operation-host.js";
import {
  parseFoundationExecutionOperationCheckpoint,
} from "../execution/operation-host.js";
import {
  executionObservationEstablishesContainment,
  type FoundationExecutionSpecificationV1,
} from "../execution/contracts.js";
import { reduceDeliveryEvents } from "./delivery-reducer.js";
import { FoundationError } from "../error.js";
import {
  canonicalJson,
  digestCanonical,
  selfDigest,
  sha256Bytes,
  type Sha256,
} from "../validation/canonical.js";
import {
  readFoundationAgentSemanticWorkspaceV1,
} from "../../util/agent-execution-cell-operation-v1.js";
import { compileFoundationInstalledAgentExecutionPolicyV1 } from "../execution/installed-agent-policy-v1.js";
import {
  compileFoundationInstalledAgentCellInputsV1,
  selectFoundationInstalledAgentProviderV1,
  type FoundationInstalledAgentRuntimeOpenerV1,
  type FoundationCompiledInstalledAgentCellInputsV1,
} from "../execution/installed-agent-runtime-v1.js";

export const FOUNDATION_AGENT_ACTIVITY_V7_PLAN_SCHEMA =
  "lifecycle.delivery-agent-activity-plan.v1" as const;
export const FOUNDATION_AGENT_ACTIVITY_V7_CHECKPOINT_SCHEMA =
  "lifecycle.delivery-agent-activity-checkpoint.v3" as const;

const MAXIMUM_ACTIVITY_EVENTS = 512;
const MAXIMUM_JOURNAL_EVENTS = 100_000;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export type FoundationAgentOperationV7 = Exclude<AgentAttemptOperation, "delivery.prepare">;
export type FoundationPreparationAgentOperationV7 = Extract<AgentAttemptOperation, "delivery.prepare">;
export type FoundationCommonAgentOperationV7 =
  | FoundationPreparationAgentOperationV7
  | FoundationAgentOperationV7;

type RevisionReference = Readonly<{
  id: string;
  revision: number;
  digest: Sha256;
}>;

type FoundationAgentOperationStageV7 =
  | "evaluation-opened"
  | "activity-opened"
  | "pre-intent-refused"
  | "attempt-retained"
  | "effect-intended"
  | "effect-observed"
  | "workspace-observed"
  | "candidate-observed"
  | "receipt-retained";

type AgentCellCoordinateV7 = Readonly<{
  effectDigest: Sha256;
  executableIdentity: Sha256;
}>;

type WorkspaceFinalization = Readonly<{
  workspace: ExecutionReceiptWorkspaceObservation;
  submissionTrigger: "clean-natural-completion" | null;
  workProduct: RevisionReference | null;
}>;

type AgentOperationOpeningFacts = Readonly<{
  agentId: string;
  runtimeId: string;
  directorId: string;
  submittedAt: string;
  startedAt: string;
  directorSubmissionRawDigest: Sha256;
  directorSubmissionRawByteLength: number;
  directorSemanticDigest: Sha256;
  directorSemanticByteLength: number;
  investment: AgentAttemptInvestment;
}>;

type AgentOperationPlan = Readonly<{
  preparationBasis?: FoundationPreparationBasisBindingV7;
  attemptCreatedAt: string;
  preDispatchStateDigest: Sha256;
  projection: Readonly<{
    id: string;
    class: "orientation" | "execution";
    profileId: string;
    digest: Sha256;
  }>;
  roleSubjectDigest: Sha256;
  capabilityProfile: Readonly<{ id: string; digest: Sha256 }>;
  capabilityDigest: Sha256;
  providerInput: Readonly<{
    manifestDigest: Sha256;
    bundleDigest: Sha256;
    roleBriefDigest: Sha256;
    templateProfileId: string;
    templateDigest: Sha256;
    contentInventoryDigest: Sha256;
    inputMaterialDigest: Sha256;
    citationRegistryDigest: Sha256;
    rootTokenSetDigest: Sha256;
  }>;
  evidenceSetDigest: Sha256 | null;
  propositionSetDigest: Sha256 | null;
}>;

export type AgentActivityPlan = Readonly<{
  schema: typeof FOUNDATION_AGENT_ACTIVITY_V7_PLAN_SCHEMA;
  role: AgentAttemptRole;
  brief: RevisionReference;
  boundary: RevisionReference | null;
  attemptedCandidate: RevisionReference | null;
  opening: AgentOperationOpeningFacts;
  executionPlan: AgentOperationPlan | null;
}>;

export type AgentActivityCheckpoint = Readonly<{
  schema: typeof FOUNDATION_AGENT_ACTIVITY_V7_CHECKPOINT_SCHEMA;
  coordinate: AgentCellCoordinateV7 | null;
  execution: FoundationExecutionOperationCheckpointV1 | null;
  executionSelection: FoundationAgentExecutionSelectionV1 | null;
  attempt: RevisionReference | null;
  seal: RevisionReference | null;
  promotedExecutionPlan: AgentOperationPlan | null;
  finalization: WorkspaceFinalization | null;
  resultCandidate: RevisionReference | null;
  candidateRejection: FoundationCandidateOutputRejectionV1 | null;
  receipt: RevisionReference | null;
  roleCheckpoint: ControlJsonObject | null;
}>;

type AgentOperationSupport = Readonly<{
  operation: FoundationCommonAgentOperationV7;
  role: AgentAttemptRole;
  activityId: string;
  stage: FoundationAgentOperationStageV7;
  coordinate: AgentCellCoordinateV7 | null;
  execution: FoundationExecutionOperationCheckpointV1 | null;
  executionSelection: FoundationAgentExecutionSelectionV1 | null;
  brief: RevisionReference;
  attempt: RevisionReference | null;
  boundary: RevisionReference | null;
  attemptedCandidate: RevisionReference | null;
  seal: RevisionReference | null;
  opening: AgentOperationOpeningFacts;
  plan: AgentOperationPlan | null;
  promotedExecutionPlan: AgentOperationPlan | null;
  finalization: WorkspaceFinalization | null;
  resultCandidate: RevisionReference | null;
  candidateRejection: FoundationCandidateOutputRejectionV1 | null;
  receipt: RevisionReference | null;
  roleCheckpoint: ControlJsonObject | null;
}>;

export type FoundationAgentOperationSupportV7 = AgentOperationSupport;

export type FoundationAgentActivityKernelInspectionV7 = Readonly<{
  support: FoundationAgentOperationSupportV7;
  coordinate: ControlRecordOperationSupportCoordinate;
}>;

export type FoundationAgentRoleCheckpointAdapterV7<
  Child extends ControlJsonObject = ControlJsonObject,
> = FoundationActivityChildCheckpointAdapterV7<
  AgentActivityPlan,
  AgentActivityCheckpoint,
  Child
>;

type FoundationAgentRoleControlCommonV7 = Readonly<{
  store: ControlRecordStore;
  activityId: string;
  brief: ControlRecordRevision;
  attempt: ControlRecordRevision;
  workProduct: ControlRecordRevision | null;
  receipt: ControlRecordRevision;
  support: FoundationAgentRoleCheckpointAdapterV7;
}>;

export type FoundationAgentRoleControlContextV7 = FoundationAgentRoleControlCommonV7 & Readonly<{
  boundary: ControlRecordRevision;
  attemptedCandidate: ControlRecordRevision;
  resultCandidate: ControlRecordRevision;
}> & (
  | Readonly<{operation:"delivery.continue";role:"builder";seal:null}>
  | Readonly<{operation:"delivery.evaluate";role:"reviewer";seal:ControlRecordRevision}>
  | Readonly<{operation:"delivery.revise" | "delivery.reaffirm";role:"reconnaissance";seal:null}>
);

export type FoundationAgentRoleControlResultV7 = Readonly<{
  outcome: DeliveryActivityOutcome;
  controls?: readonly ControlRecordRevision[];
}>;

export type FoundationAgentRoleControlFinalizerV7 = (
  input: FoundationAgentRoleControlContextV7,
) => Promise<FoundationAgentRoleControlResultV7>;

export type FoundationPreparationAgentRoleControlContextV7 = FoundationAgentRoleControlCommonV7 & Readonly<{
  operation: "delivery.prepare";
  role: "reconnaissance";
  boundary: null;
  attemptedCandidate: null;
  resultCandidate: null;
  seal: null;
}>;

export type FoundationPreparationAgentRoleControlFinalizerV7 = (
  input: FoundationPreparationAgentRoleControlContextV7,
) => Promise<FoundationAgentRoleControlResultV7>;

export type FoundationAgentOperationOpeningV7 = Readonly<{
  semanticMarkdown: string;
  submittedAt: string;
  startedAt: string;
  attemptCreatedAt: string;
  directorId: string;
  reservation?: WorkDelegationReservation;
}>;

export type FoundationReviewActivityOpeningV7 = Readonly<{
  semanticMarkdown: string;
  submittedAt: string;
  startedAt: string;
  directorId: string;
  reservation?: WorkDelegationReservation;
}>;

export type FoundationReviewActivityOpeningV7Input = Readonly<{
  store: ControlRecordStore;
  activityId: string;
  runtimeId: string;
  agentId: string;
  opening: FoundationReviewActivityOpeningV7;
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
  investment: AgentAttemptInvestment;
}>;

export type CompiledFoundationReviewActivityOpeningV7 = Readonly<{
  opening: CompiledAgentActivityOpening;
  plan: AgentActivityPlan;
  checkpoint: AgentActivityCheckpoint;
}>;

export type FoundationAgentOperationPreIntentContextV7 = Readonly<{
  store: ControlRecordStore;
  activityId: string;
  operation: FoundationAgentOperationV7;
  role: AgentAttemptRole;
  brief: ControlRecordRevision;
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
  seal: ControlRecordRevision | null;
  projection: FoundationCompiledProjection;
}>;

export type FoundationAgentOperationPreIntentRevalidatorV7 = (
  input: FoundationAgentOperationPreIntentContextV7,
) => void | Promise<void>;

export type FoundationPreparationAgentOperationPreIntentContextV7 = Readonly<{
  store: ControlRecordStore;
  activityId: string;
  operation: "delivery.prepare";
  role: "reconnaissance";
  brief: ControlRecordRevision;
  boundary: null;
  candidate: null;
  seal: null;
  projection: FoundationCompiledProjection;
}>;

export type FoundationPreparationAgentOperationPreIntentRevalidatorV7 = (
  input: FoundationPreparationAgentOperationPreIntentContextV7,
) => void | Promise<void>;

export type FoundationAgentOperationV7Input = Readonly<{
  store: ControlRecordStore;
  configuration: FoundationProcessRuntimeConfigurationV7;
  activityId: string;
  operation: FoundationAgentOperationV7;
  runtimeId: string;
  agentId: string;
  opening: FoundationAgentOperationOpeningV7;
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
  seal?: ControlRecordRevision | null;
  projection: FoundationCompiledProjection;
  providerInput: ProviderInputV4;
  /** Runtime-private canonical target repository used only to verify Carriers. */
  targetRepository: string;
  roleSubject: ControlJsonObject;
  capabilityProfile: Readonly<{ id: string; digest: Sha256 }>;
  investment: AgentAttemptInvestment;
  evidenceSetDigest: Sha256 | null;
  propositionSet: AgentWorkProductPropositionSet | null;
  revalidateBeforeIntent: FoundationAgentOperationPreIntentRevalidatorV7;
  finalizeRoleControl: FoundationAgentRoleControlFinalizerV7;
}>;

export type FoundationPreparationAgentOperationV7Input = Readonly<
  Omit<
    FoundationAgentOperationV7Input,
    | "operation"
    | "boundary"
    | "candidate"
    | "seal"
    | "revalidateBeforeIntent"
    | "finalizeRoleControl"
  > & Readonly<{
    operation: "delivery.prepare";
    preparationBasis: FoundationPreparationBasisBindingV7;
    boundary: null;
    candidate: null;
    seal?: null;
    revalidateBeforeIntent: FoundationPreparationAgentOperationPreIntentRevalidatorV7;
    finalizeRoleControl: FoundationPreparationAgentRoleControlFinalizerV7;
  }>
>;

type FoundationCommonAgentOperationV7Input =
  | FoundationPreparationAgentOperationV7Input
  | FoundationAgentOperationV7Input;

export type FoundationAgentOperationV7Result = Readonly<{
  activityId: string;
  operation: FoundationAgentOperationV7;
  outcome: DeliveryActivityOutcome;
  attempt: RevisionReference;
  workProduct: RevisionReference | null;
  candidate: RevisionReference;
  receipt: RevisionReference;
  controls: readonly RevisionReference[];
}>;

export type FoundationPreparationAgentOperationV7Result = Readonly<
  Omit<FoundationAgentOperationV7Result, "operation" | "candidate"> & Readonly<{
    operation: "delivery.prepare";
    candidate: null;
  }>
>;

type FoundationCommonAgentOperationV7Result =
  | FoundationPreparationAgentOperationV7Result
  | FoundationAgentOperationV7Result;

type AgentOperationOwners = Readonly<{
  now(): string;
  compileInstalled: typeof compileFoundationInstalledAgentCellInputsV1;
  openInstalled: FoundationInstalledAgentRuntimeOpenerV1;
  compileInput: typeof compileFoundationAgentCellInputV1;
  openCarrier: typeof openCandidateRevisionCarrier;
  readCarrierArtifact(path: string): Promise<Uint8Array>;
  finalizeWorkProduct: typeof finalizeAgentWorkProductSemanticBytes;
  abandonWorkProduct: typeof abandonAgentWorkProduct;
  carrierVerifier: typeof candidateRevisionCarrierVerifierFromWorkBoundary;
  retainReceipt: typeof retainExecutionReceipt;
}>;

export type FoundationAgentOperationV7Options = Partial<AgentOperationOwners>;

function fail(
  code: string,
  message: string,
  observedFacts: Readonly<Record<string, unknown>> = {},
): never {
  throw new FoundationError(`lifecycle.agent-operation-v7.${code}`, message, {
    observedFacts,
  });
}

function exactObject(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== "object") {
    fail("retained-fact", `${label} must be one exact object`);
  }
  return value as ControlJsonObject;
}

function exactClosedObject(
  value: ControlJsonValue | undefined,
  keys: readonly string[],
  label: string,
): ControlJsonObject {
  const selected = exactObject(value, label);
  if (Object.keys(selected).sort().join("\0") !== [...keys].sort().join("\0")) {
    fail("operation-support", `${label} does not have its exact closed shape`);
  }
  return selected;
}

function exactString(value: ControlJsonValue | undefined, label: string): string {
  if (typeof value !== "string") fail("retained-fact", `${label} must be one exact string`);
  return value;
}

function exactDigest(value: ControlJsonValue | undefined, label: string): Sha256 {
  const selected = exactString(value, label);
  if (!SHA256_PATTERN.test(selected)) fail("retained-fact", `${label} must be one SHA-256 digest`);
  return selected as Sha256;
}

function nullableDigest(value: ControlJsonValue | undefined, label: string): Sha256 | null {
  return value === null ? null : exactDigest(value, label);
}

function nonnegativeInteger(value: ControlJsonValue | undefined, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail("retained-fact", `${label} must be one nonnegative safe integer`);
  }
  return value as number;
}

function nullableNonnegativeInteger(
  value: ControlJsonValue | undefined,
  label: string,
): number | null {
  return value === null ? null : nonnegativeInteger(value, label);
}

function investmentValue(
  value: ControlJsonValue | undefined,
  label: string,
): AgentAttemptInvestment {
  const selected = exactClosedObject(
    value,
    ["id", "digest", "model", "reasoning", "wallTimeMs", "limits", "rationale"],
    label,
  );
  const limits = exactClosedObject(
    selected.limits,
    ["tokens", "events", "outputBytes", "toolCalls", "processes", "storageBytes"],
    `${label} limits`,
  );
  const result: AgentAttemptInvestment = Object.freeze({
    id: controlIdentifier(exactString(selected.id, `${label} identity`), `${label} identity`),
    digest: exactDigest(selected.digest, `${label} digest`),
    model: exactString(selected.model, `${label} model`),
    reasoning: exactString(selected.reasoning, `${label} reasoning`),
    wallTimeMs: nonnegativeInteger(selected.wallTimeMs, `${label} wall time`),
    limits: Object.freeze({
      tokens: nullableNonnegativeInteger(limits.tokens, `${label} token limit`),
      events: nullableNonnegativeInteger(limits.events, `${label} event limit`),
      outputBytes: nullableNonnegativeInteger(limits.outputBytes, `${label} output limit`),
      toolCalls: nullableNonnegativeInteger(limits.toolCalls, `${label} tool-call limit`),
      processes: nullableNonnegativeInteger(limits.processes, `${label} process limit`),
      storageBytes: nullableNonnegativeInteger(limits.storageBytes, `${label} storage limit`),
    }),
    rationale: exactString(selected.rationale, `${label} rationale`),
  });
  const { digest, ...subject } = result;
  if (digestCanonical(subject) !== digest) {
    fail("operation-support", `${label} does not reproduce its self-digest`);
  }
  return result;
}

function openingValue(value: ControlJsonValue | undefined): AgentOperationOpeningFacts {
  const selected = exactClosedObject(value, [
    "agentId", "runtimeId", "directorId", "submittedAt", "startedAt",
    "directorSubmissionRawDigest", "directorSubmissionRawByteLength",
    "directorSemanticDigest", "directorSemanticByteLength", "investment",
  ], "Agent operation opening facts");
  return Object.freeze({
    agentId: controlIdentifier(exactString(selected.agentId, "Agent identity"), "Agent identity"),
    runtimeId: controlIdentifier(exactString(selected.runtimeId, "Runtime identity"), "Runtime identity"),
    directorId: controlIdentifier(exactString(selected.directorId, "Director identity"), "Director identity"),
    submittedAt: controlTimestamp(exactString(selected.submittedAt, "Director Brief time"), "Director Brief time"),
    startedAt: controlTimestamp(exactString(selected.startedAt, "Activity start time"), "Activity start time"),
    directorSubmissionRawDigest: exactDigest(
      selected.directorSubmissionRawDigest,
      "Director submission raw digest",
    ),
    directorSubmissionRawByteLength: nonnegativeInteger(
      selected.directorSubmissionRawByteLength,
      "Director submission byte length",
    ),
    directorSemanticDigest: exactDigest(selected.directorSemanticDigest, "Director semantic digest"),
    directorSemanticByteLength: nonnegativeInteger(
      selected.directorSemanticByteLength,
      "Director semantic byte length",
    ),
    investment: investmentValue(selected.investment, "Agent operation Investment"),
  });
}

function planValue(value: ControlJsonValue | undefined): AgentOperationPlan {
  const selected = exactClosedObject(value, [
    "attemptCreatedAt", "preDispatchStateDigest", "projection", "roleSubjectDigest",
    "capabilityProfile", "capabilityDigest", "providerInput", "evidenceSetDigest",
    "propositionSetDigest",
    ...(value !== null && typeof value === "object" && !Array.isArray(value) && "preparationBasis" in value ? ["preparationBasis"] : []),
  ], "Agent operation plan");
  const projection = exactClosedObject(
    selected.projection,
    ["id", "class", "profileId", "digest"],
    "Agent operation planned Projection",
  );
  const projectionClass = exactString(projection.class, "Agent operation Projection class");
  if (projectionClass !== "orientation" && projectionClass !== "execution") {
    fail("operation-support", "Agent operation plan has an unsupported Projection class");
  }
  const capabilityProfile = exactClosedObject(
    selected.capabilityProfile,
    ["id", "digest"],
    "Agent operation planned Capability Profile",
  );
  const providerInput = exactClosedObject(selected.providerInput, [
    "manifestDigest", "bundleDigest", "roleBriefDigest", "templateProfileId",
    "templateDigest", "contentInventoryDigest", "inputMaterialDigest",
    "citationRegistryDigest", "rootTokenSetDigest",
  ], "Agent operation planned provider input");
  return Object.freeze({
    ...(selected.preparationBasis === undefined ? {} : { preparationBasis: parseFoundationPreparationBasisBindingV7(exactObject(selected.preparationBasis, "Preparation basis")) }),
    attemptCreatedAt: controlTimestamp(
      exactString(selected.attemptCreatedAt, "Agent Attempt creation time"),
      "Agent Attempt creation time",
    ),
    preDispatchStateDigest: exactDigest(selected.preDispatchStateDigest, "Pre-dispatch state"),
    projection: Object.freeze({
      id: controlIdentifier(exactString(projection.id, "Projection identity"), "Projection identity"),
      class: projectionClass,
      profileId: controlIdentifier(
        exactString(projection.profileId, "Projection profile identity"),
        "Projection profile identity",
      ),
      digest: exactDigest(projection.digest, "Projection digest"),
    }),
    roleSubjectDigest: exactDigest(selected.roleSubjectDigest, "Role-subject digest"),
    capabilityProfile: Object.freeze({
      id: controlIdentifier(
        exactString(capabilityProfile.id, "Capability Profile identity"),
        "Capability Profile identity",
      ),
      digest: exactDigest(capabilityProfile.digest, "Capability Profile digest"),
    }),
    capabilityDigest: exactDigest(selected.capabilityDigest, "Materialized capability digest"),
    providerInput: Object.freeze({
      manifestDigest: exactDigest(providerInput.manifestDigest, "Provider-input manifest digest"),
      bundleDigest: exactDigest(providerInput.bundleDigest, "Provider-input bundle digest"),
      roleBriefDigest: exactDigest(providerInput.roleBriefDigest, "Role Brief digest"),
      templateProfileId: controlIdentifier(
        exactString(providerInput.templateProfileId, "Semantic template profile"),
        "Semantic template profile",
      ),
      templateDigest: exactDigest(providerInput.templateDigest, "Semantic template digest"),
      contentInventoryDigest: exactDigest(
        providerInput.contentInventoryDigest,
        "Provider content-inventory digest",
      ),
      inputMaterialDigest: exactDigest(providerInput.inputMaterialDigest, "Provider input-material digest"),
      citationRegistryDigest: exactDigest(
        providerInput.citationRegistryDigest,
        "Citation-registry digest",
      ),
      rootTokenSetDigest: exactDigest(providerInput.rootTokenSetDigest, "Root-token-set digest"),
    }),
    evidenceSetDigest: nullableDigest(selected.evidenceSetDigest, "Evidence-set digest"),
    propositionSetDigest: nullableDigest(selected.propositionSetDigest, "Proposition-set digest"),
  });
}

function referenceValue(value: ControlJsonValue | undefined, label: string): RevisionReference {
  const selected = exactClosedObject(value, ["id", "revision", "digest"], label);
  if (!Number.isSafeInteger(selected.revision) || (selected.revision as number) < 1) {
    fail("operation-support", `${label} revision must be one positive integer`);
  }
  return Object.freeze({
    id: controlIdentifier(exactString(selected.id, `${label} identity`), `${label} identity`),
    revision: selected.revision as number,
    digest: exactDigest(selected.digest, `${label} digest`),
  });
}

function reference(revision: ControlRecordRevision): RevisionReference {
  return Object.freeze({
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function sameReference(left: RevisionReference, right: ControlRecordRevision): boolean {
  return left.id === right.recordId && left.revision === right.revision && left.digest === right.digest;
}

function submissionDiagnosticValue(
  value: ControlJsonValue | undefined,
): ExecutionReceiptSubmissionDiagnostic | null {
  if (value === null) return null;
  const selected = exactClosedObject(
    value,
    ["code", "stage", "factsDigest"],
    "Agent operation submission diagnostic",
  );
  const code = exactString(selected.code, "Submission diagnostic code");
  if (code.length > 160 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(code)) {
    fail("operation-support", "Submission diagnostic code is outside its bounded identity domain");
  }
  const stage = exactString(selected.stage, "Submission diagnostic stage");
  if (!(stage === "syntax" || stage === "template" || stage === "semantic" || stage === "compiler")) {
    fail("operation-support", "Submission diagnostic stage is unsupported");
  }
  return Object.freeze({
    code,
    stage,
    factsDigest: exactDigest(selected.factsDigest, "Submission diagnostic facts"),
  });
}

function workspaceObservation(value: ControlJsonValue | undefined): ExecutionReceiptWorkspaceObservation {
  const selected = exactObject(value, "Agent operation workspace observation");
  if (selected.availability === "unavailable") {
    const unavailable = exactClosedObject(
      selected,
      ["availability", "failureFactsDigest", "submissionDiagnostic"],
      "Unavailable Agent operation workspace observation",
    );
    if (unavailable.submissionDiagnostic !== null) {
      fail("operation-support", "Unavailable workspace cannot retain a semantic submission diagnostic");
    }
    return Object.freeze({
      availability: "unavailable",
      failureFactsDigest: exactDigest(unavailable.failureFactsDigest, "Workspace failure facts"),
      submissionDiagnostic: null,
    });
  }
  const available = exactClosedObject(selected, [
    "availability", "rawByteLength", "workspaceRawDigest", "semanticMarkdownDigest",
    "parseResultDigest", "failureFactsDigest", "submissionDiagnostic", "fixedBindingSubjectDigest",
    "parserDisposition", "compilerDisposition",
  ], "Available Agent operation workspace observation");
  if (
    available.availability !== "available" ||
    !Number.isSafeInteger(available.rawByteLength) || (available.rawByteLength as number) < 0 ||
    (available.rawByteLength as number) > 1024 * 1024 ||
    !["valid", "invalid", "not-run"].includes(available.parserDisposition as string) ||
    !["retained", "invalid-result", "runtime-failure", "not-run"].includes(
      available.compilerDisposition as string,
    )
  ) fail("operation-support", "Available workspace observation is invalid");
  const failureFactsDigest = nullableDigest(available.failureFactsDigest, "Workspace failure digest");
  const submissionDiagnostic = submissionDiagnosticValue(available.submissionDiagnostic);
  if (
    (failureFactsDigest === null) !== (submissionDiagnostic === null) ||
    (submissionDiagnostic !== null && submissionDiagnostic.factsDigest !== failureFactsDigest)
  ) {
    fail("operation-support", "Workspace failure and submission diagnostic facts differ");
  }
  return Object.freeze({
    availability: "available",
    rawByteLength: available.rawByteLength as number,
    workspaceRawDigest: exactDigest(available.workspaceRawDigest, "Workspace raw digest"),
    semanticMarkdownDigest: nullableDigest(available.semanticMarkdownDigest, "Workspace semantic digest"),
    parseResultDigest: nullableDigest(available.parseResultDigest, "Workspace parse-result digest"),
    failureFactsDigest,
    submissionDiagnostic,
    fixedBindingSubjectDigest: nullableDigest(
      available.fixedBindingSubjectDigest,
      "Workspace fixed-binding digest",
    ),
    parserDisposition: available.parserDisposition as "valid" | "invalid" | "not-run",
    compilerDisposition: available.compilerDisposition as
      "retained" | "invalid-result" | "runtime-failure" | "not-run",
  });
}

function finalizationValue(value: ControlJsonValue | undefined): WorkspaceFinalization | null {
  if (value === null) return null;
  const selected = exactClosedObject(
    value,
    ["workspace", "submissionTrigger", "workProduct"],
    "Agent operation workspace finalization",
  );
  if (selected.submissionTrigger !== null && selected.submissionTrigger !== "clean-natural-completion") {
    fail("operation-support", "Agent operation submission trigger is invalid");
  }
  const workspace = workspaceObservation(selected.workspace);
  const workProduct = selected.workProduct === null
    ? null
    : referenceValue(selected.workProduct, "Agent operation Work Product");
  if (
    (workProduct !== null) !== (
      workspace.availability === "available" && workspace.compilerDisposition === "retained"
    ) ||
    (selected.submissionTrigger !== null && workspace.availability !== "available")
  ) fail("operation-support", "Workspace and Work Product support facts are inconsistent");
  return Object.freeze({
    workspace,
    submissionTrigger: selected.submissionTrigger,
    workProduct,
  });
}

function expectedRole(operation: FoundationCommonAgentOperationV7): AgentAttemptRole {
  return operation === "delivery.continue"
    ? "builder"
    : operation === "delivery.evaluate"
      ? "reviewer"
      : "reconnaissance";
}

function expectedProjectionClass(
  operation: FoundationCommonAgentOperationV7,
): "orientation" | "execution" {
  return operation === "delivery.continue" || operation === "delivery.evaluate"
    ? "execution"
    : "orientation";
}

function propositionSetDigest(
  role: AgentAttemptRole,
  value: AgentWorkProductPropositionSet | null,
): Sha256 | null {
  if (role !== "reviewer") {
    if (value !== null) fail("proposition-set", "Only reviewer operation accepts a proposition set");
    return null;
  }
  if (
    value === null || value.schema !== "lifecycle.proposition-set.v3" ||
    !Array.isArray(value.propositions) || value.propositions.length > 4_096
  ) fail("proposition-set", "Reviewer operation requires one bounded typed proposition set");
  const ids = value.propositions.map((proposition, index) => {
    if (proposition === null || Array.isArray(proposition) || typeof proposition !== "object") {
      fail("proposition-set", `Reviewer proposition ${index} is not one exact object`);
    }
    return controlIdentifier(proposition.id, `Reviewer proposition ${index} identity`);
  });
  const ordered = [...ids].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  if (new Set(ids).size !== ids.length || ids.some((id, index) => id !== ordered[index])) {
    fail("proposition-set", "Reviewer proposition identities must be unique and canonically ordered");
  }
  return digestCanonical(value);
}

function operationValue(value: string): FoundationCommonAgentOperationV7 {
  if (
    value !== "delivery.prepare" && value !== "delivery.continue" && value !== "delivery.evaluate" &&
    value !== "delivery.revise" && value !== "delivery.reaffirm"
  ) fail("operation", "Agent operation owner does not operate Delivery transactions");
  return value;
}

function parseAgentActivityPlan(
  value: ControlJsonObject,
  operation: FoundationCommonAgentOperationV7,
): AgentActivityPlan {
  const selected = exactClosedObject(value, [
    "schema", "role", "brief", "boundary", "attemptedCandidate", "opening", "executionPlan",
  ], "Agent activity plan");
  const role = exactString(selected.role, "Agent activity role");
  if (selected.schema !== FOUNDATION_AGENT_ACTIVITY_V7_PLAN_SCHEMA ||
      !["builder", "reviewer", "reconnaissance"].includes(role)) {
    fail("activity-plan", "Agent activity plan has an unsupported schema or role");
  }
  const executionPlan = selected.executionPlan === null ? null : planValue(selected.executionPlan);
  const boundary = selected.boundary === null
    ? null
    : referenceValue(selected.boundary, "Agent activity Boundary");
  const attemptedCandidate = selected.attemptedCandidate === null
    ? null
    : referenceValue(selected.attemptedCandidate, "Agent activity Candidate");
  if (
    role !== expectedRole(operation) ||
    (operation === "delivery.prepare") !== (boundary === null && attemptedCandidate === null) ||
    (operation !== "delivery.prepare" && (boundary === null || attemptedCandidate === null)) ||
    (operation === "delivery.evaluate") !== (executionPlan === null) ||
    (operation === "delivery.prepare") !== (executionPlan?.preparationBasis !== undefined)
  ) {
    fail("activity-plan", "Agent activity plan does not match its exact operation subjects and role");
  }
  return Object.freeze({
    schema: FOUNDATION_AGENT_ACTIVITY_V7_PLAN_SCHEMA,
    role: role as AgentAttemptRole,
    brief: referenceValue(selected.brief, "Agent activity Director Brief"),
    boundary,
    attemptedCandidate,
    opening: openingValue(selected.opening),
    executionPlan,
  });
}

function parseAgentActivityCheckpoint(
  value: ControlJsonObject,
  operation: FoundationCommonAgentOperationV7,
): AgentActivityCheckpoint {
  const selected = exactClosedObject(value, [
    "schema", "coordinate", "execution", "executionSelection", "attempt", "seal", "promotedExecutionPlan", "finalization",
    "resultCandidate", "candidateRejection", "receipt", "roleCheckpoint",
  ], "Agent activity checkpoint");
  if (selected.schema !== FOUNDATION_AGENT_ACTIVITY_V7_CHECKPOINT_SCHEMA) {
    fail("activity-checkpoint", "Agent activity checkpoint has an unsupported schema");
  }
  const result = Object.freeze({
    schema: FOUNDATION_AGENT_ACTIVITY_V7_CHECKPOINT_SCHEMA,
    coordinate: selected.coordinate === null
      ? null
      : (() => {
          const coordinate = exactClosedObject(
            selected.coordinate,
            ["effectDigest", "executableIdentity"],
            "Agent Cell coordinate",
          );
          return Object.freeze({
            effectDigest: exactDigest(coordinate.effectDigest, "Agent Cell effect digest"),
            executableIdentity: exactDigest(
              coordinate.executableIdentity,
              "Agent Cell executable identity",
            ),
          });
        })(),
    executionSelection: selected.executionSelection === null ? null : parseFoundationAgentExecutionSelectionV1(exactObject(selected.executionSelection,"Agent retained execution selection")),
    execution: selected.execution === null
      ? null
      : (() => {
          const execution = exactObject(selected.execution, "Agent Execution checkpoint");
          if (
            execution.schema !== "lifecycle.execution-operation-checkpoint.private.v2" ||
            !SHA256_PATTERN.test(String(execution.digest)) ||
            execution.digest !== selfDigest(execution, "digest")
          ) fail("activity-checkpoint", "Agent Execution checkpoint is not one exact self-bound value");
          return execution as FoundationExecutionOperationCheckpointV1;
        })(),
    attempt: selected.attempt === null
      ? null
      : referenceValue(selected.attempt, "Agent activity Attempt"),
    seal: selected.seal === null
      ? null
      : referenceValue(selected.seal, "Agent activity Seal"),
    promotedExecutionPlan: selected.promotedExecutionPlan === null
      ? null
      : planValue(selected.promotedExecutionPlan),
    finalization: finalizationValue(selected.finalization),
    resultCandidate: selected.resultCandidate === null
      ? null
      : referenceValue(selected.resultCandidate, "Agent activity result Candidate"),
    candidateRejection: selected.candidateRejection === null
      ? null : parseCandidateOutputRejectionV1(selected.candidateRejection),
    receipt: selected.receipt === null
      ? null
      : referenceValue(selected.receipt, "Agent activity Receipt"),
    roleCheckpoint: selected.roleCheckpoint === null
      ? null
      : exactObject(selected.roleCheckpoint, "Role-control recovery checkpoint"),
  });
  if (result.candidateRejection !== null && (operation !== "delivery.continue" ||
      result.resultCandidate !== null || result.finalization === null || result.attempt === null)) {
    fail("activity-checkpoint", "Candidate rejection requires one finalized builder output without a successor");
  }
  if ((result.execution !== null || result.attempt !== null) && result.executionSelection === null) fail("activity-checkpoint", "Allocated Agent recovery requires its retained execution selection");
  if ((result.coordinate === null) !== (result.execution === null)) {
    fail("activity-checkpoint", "Agent Cell coordinate and Execution checkpoint must coexist");
  }
  if (
    result.coordinate !== null && result.execution !== null &&
    result.coordinate.effectDigest !== result.execution.specificationDigest
  ) {
    fail("activity-checkpoint", "Agent Cell coordinate selects another Execution Specification");
  }
  if (
    operation === "delivery.prepare" && (
      result.seal !== null || result.promotedExecutionPlan !== null ||
      result.resultCandidate !== null
    )
  ) fail("activity-checkpoint", "Preparation support cannot retain Candidate or Seal facts");
  return result;
}

function agentActivityDefinition(
  operation: FoundationCommonAgentOperationV7,
): FoundationActivityKernelStandardDefinitionV7<AgentActivityPlan, AgentActivityCheckpoint> {
  const id = `foundation.agent.${operation.slice("delivery.".length)}.activity.v1`;
  const identity = Object.freeze({
    schema: "lifecycle.agent-activity-definition.v1",
    id,
    operation,
    role: expectedRole(operation),
    projectionClass: expectedProjectionClass(operation),
    planSchema: FOUNDATION_AGENT_ACTIVITY_V7_PLAN_SCHEMA,
    checkpointSchema: FOUNDATION_AGENT_ACTIVITY_V7_CHECKPOINT_SCHEMA,
    provider: Object.freeze({
      id: FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR.id,
      digest: FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR.digest,
    }),
    authoring: Object.freeze({
      parserProfileId: FOUNDATION_AGENT_WORK_PRODUCT_PARSER_PROFILE_ID,
      parserProfileDigest: agentWorkProductParserProfileDigest(),
      compilerProfileId: FOUNDATION_AGENT_WORK_PRODUCT_COMPILER_PROFILE_ID,
      compilerProfileDigest: agentWorkProductCompilerProfileDigest(),
      submissionPolicy: "explicit-or-clean-natural-completion",
    }),
  });
  return Object.freeze({
    id,
    digest: digestCanonical(identity),
    operation,
    terminal: false,
    parsePlan: (value) => parseAgentActivityPlan(value, operation),
    parseCheckpoint: (value) => parseAgentActivityCheckpoint(value, operation),
  });
}

const FOUNDATION_AGENT_ACTIVITY_DEFINITIONS_V7 = Object.freeze({
  "delivery.prepare": agentActivityDefinition("delivery.prepare"),
  "delivery.continue": agentActivityDefinition("delivery.continue"),
  "delivery.evaluate": agentActivityDefinition("delivery.evaluate"),
  "delivery.revise": agentActivityDefinition("delivery.revise"),
  "delivery.reaffirm": agentActivityDefinition("delivery.reaffirm"),
});

function definitionFor(
  operation: FoundationCommonAgentOperationV7,
): FoundationActivityKernelStandardDefinitionV7<AgentActivityPlan, AgentActivityCheckpoint> {
  return FOUNDATION_AGENT_ACTIVITY_DEFINITIONS_V7[operation];
}

function derivedAgentStage(
  context: FoundationActivityKernelContextV7<AgentActivityPlan, AgentActivityCheckpoint>,
  checkpoint: AgentActivityCheckpoint,
): FoundationAgentOperationStageV7 {
  switch (context.recovery.resumesAt) {
    case "candidate-sealed":
      return "evaluation-opened";
    case "evaluation-checks":
      return checkpoint.promotedExecutionPlan === null ? "evaluation-opened" : "activity-opened";
    case "agent-attempt-prepared":
      return "activity-opened";
    case "provider-effect-intended":
      return "attempt-retained";
    case "provider-effect-observed":
      return "effect-intended";
    case "work-product-observation":
      return checkpoint.finalization === null ? "effect-observed" : "workspace-observed";
    case "candidate-revision-observed":
      return checkpoint.finalization === null ? "effect-observed" : "workspace-observed";
    case "execution-receipt-recorded":
      if (checkpoint.finalization === null) return "effect-observed";
      if (checkpoint.receipt !== null) return "receipt-retained";
      if (context.envelope.plan.value.role === "builder" && checkpoint.resultCandidate !== null) {
        return "candidate-observed";
      }
      return "workspace-observed";
    case "work-boundary-finalized":
    case "baseline-checks":
    case "activity-finalization":
    case "activity-completed":
      if (checkpoint.attempt === null && context.activity.stage === "finalizing") {
        return "pre-intent-refused";
      }
      if (checkpoint.finalization === null) return "effect-observed";
      if (checkpoint.receipt !== null) return "receipt-retained";
      if (context.envelope.plan.value.role === "builder" && checkpoint.resultCandidate !== null) {
        return "candidate-observed";
      }
      return "workspace-observed";
    default:
      fail("recovery-coordinate", "Agent activity has an unsupported reducer recovery coordinate", {
        resumesAt: context.recovery.resumesAt,
      });
  }
}

function supportFromContext(
  context: FoundationActivityKernelContextV7<AgentActivityPlan, AgentActivityCheckpoint>,
): AgentOperationSupport {
  const plan = context.envelope.plan.value;
  const checkpointValue = context.envelope.checkpoint?.value;
  if (checkpointValue === undefined) {
    fail("activity-checkpoint", "Agent activity requires one operation-owned checkpoint object");
  }
  const executionPlan = plan.executionPlan ?? checkpointValue.promotedExecutionPlan;
  if ((plan.role === "reviewer") !== (plan.executionPlan === null) ||
      (checkpointValue.promotedExecutionPlan !== null && plan.role !== "reviewer")) {
    fail("activity-checkpoint", "Agent execution plan placement differs from its immutable role plan");
  }
  return Object.freeze({
    operation: operationValue(context.activity.operation),
    role: plan.role,
    activityId: context.activity.id,
    stage: derivedAgentStage(context, checkpointValue),
    coordinate: checkpointValue.coordinate,
    execution: checkpointValue.execution,
    executionSelection: checkpointValue.executionSelection,
    brief: plan.brief,
    attempt: checkpointValue.attempt,
    boundary: plan.boundary,
    attemptedCandidate: plan.attemptedCandidate,
    seal: checkpointValue.seal,
    opening: plan.opening,
    plan: executionPlan,
    promotedExecutionPlan: checkpointValue.promotedExecutionPlan,
    finalization: checkpointValue.finalization,
    resultCandidate: checkpointValue.resultCandidate,
    candidateRejection: checkpointValue.candidateRejection,
    receipt: checkpointValue.receipt,
    roleCheckpoint: checkpointValue.roleCheckpoint,
  });
}

function readAgentContext(
  store: ControlRecordStore,
  activityId: string,
  operation: FoundationCommonAgentOperationV7,
): FoundationActivityKernelContextV7<AgentActivityPlan, AgentActivityCheckpoint> {
  return readFoundationActivityKernelV7({
    store,
    activityId,
    definition: definitionFor(operation),
  });
}

/** Read the operation view derived from the kernel envelope and reducer. */
export function inspectFoundationAgentActivityV7(
  store: ControlRecordStore,
  activityId: string,
  operation: FoundationCommonAgentOperationV7,
): FoundationAgentOperationSupportV7 {
  return inspectFoundationAgentActivityKernelV7(store, activityId, operation).support;
}

/** Read one coherent operation view and its exact common-kernel coordinate. */
export function inspectFoundationAgentActivityKernelV7(
  store: ControlRecordStore,
  activityId: string,
  operation: FoundationCommonAgentOperationV7,
): FoundationAgentActivityKernelInspectionV7 {
  const context = readAgentContext(store, activityId, operation);
  return Object.freeze({
    support: supportFromContext(context),
    coordinate: context.coordinate,
  });
}

function checkpointPayload(support: AgentOperationSupport): AgentActivityCheckpoint {
  return Object.freeze({
    schema: FOUNDATION_AGENT_ACTIVITY_V7_CHECKPOINT_SCHEMA,
    coordinate: support.coordinate,
    execution: support.execution,
    executionSelection: support.executionSelection,
    attempt: support.attempt,
    seal: support.seal,
    promotedExecutionPlan: support.promotedExecutionPlan,
    finalization: support.finalization,
    resultCandidate: support.resultCandidate,
    candidateRejection: support.candidateRejection,
    receipt: support.receipt,
    roleCheckpoint: support.roleCheckpoint,
  });
}

function retainedRevision(
  store: ControlRecordStore,
  selected: RevisionReference,
  kind: string,
): ControlRecordRevision {
  const revision = store.getRevision(selected.id, selected.revision);
  if (revision === null || revision.recordKind !== kind || revision.digest !== selected.digest) {
    fail("operation-support", `Agent operation support does not resolve its exact ${kind}`);
  }
  return revision;
}

function retainedAttemptReference(support: AgentOperationSupport): RevisionReference {
  if (support.attempt === null) {
    fail("operation-support", "Agent operation has not retained its Attempt boundary");
  }
  return support.attempt;
}

function retainedCellCoordinate(support: AgentOperationSupport): AgentCellCoordinateV7 {
  if (support.coordinate === null) {
    fail("operation-support", "Agent operation has not retained its Execution Cell coordinate");
  }
  return support.coordinate;
}

function retainedOperationPlan(support: AgentOperationSupport): AgentOperationPlan {
  if (support.plan === null) {
    fail("operation-support", "Evaluation opening has not been promoted to an Agent plan");
  }
  return support.plan;
}

function operationOwners(options: FoundationAgentOperationV7Options): AgentOperationOwners {
  return Object.freeze({
    now: options.now ?? (() => new Date().toISOString()),
    compileInstalled:
      options.compileInstalled ?? compileFoundationInstalledAgentCellInputsV1,
    openInstalled: options.openInstalled ?? (async () => fail(
      "execution-backend-unavailable",
      "Agent execution requires the installed execution owner",
    )),
    compileInput: options.compileInput ?? compileFoundationAgentCellInputV1,
    openCarrier: options.openCarrier ?? openCandidateRevisionCarrier,
    readCarrierArtifact: options.readCarrierArtifact ?? (async (path) => Uint8Array.from(await readFile(path))),
    finalizeWorkProduct:
      options.finalizeWorkProduct ?? finalizeAgentWorkProductSemanticBytes,
    abandonWorkProduct: options.abandonWorkProduct ?? abandonAgentWorkProduct,
    carrierVerifier:
      options.carrierVerifier ?? candidateRevisionCarrierVerifierFromWorkBoundary,
    retainReceipt: options.retainReceipt ?? retainExecutionReceipt,
  });
}

function allActivityEvents(store: ControlRecordStore, activityId: string): readonly ControlRecordEvent[] {
  const events: ControlRecordEvent[] = [];
  let cursor = 0;
  for (;;) {
    const page = store.listEvents(cursor, 10_000);
    for (const event of page) {
      if (event.payload.activityId === activityId) events.push(event);
    }
    if (page.length < 10_000) break;
    cursor = page.at(-1)!.sequence;
    if (events.length > MAXIMUM_ACTIVITY_EVENTS) {
      fail("journal-bound", "Agent activity event inventory exceeds its fixed bound");
    }
  }
  if (events.length > MAXIMUM_ACTIVITY_EVENTS) {
    fail("journal-bound", "Agent activity event inventory exceeds its fixed bound");
  }
  return Object.freeze(events);
}

function retainedPreIntentRefusal(
  store: ControlRecordStore,
  activityId: string,
): Readonly<{ diagnosticCode: string; refusalFactsDigest: Sha256 }> {
  const selected = allActivityEvents(store, activityId).filter(({ eventKind }) =>
    eventKind === "agent-pre-intent-refused");
  if (selected.length !== 1 || selected[0]!.subject !== null) {
    fail("pre-intent-refusal", "Agent refusal recovery requires one exact subjectless refusal event");
  }
  const payload = exactClosedObject(
    selected[0]!.payload,
    ["activityId", "diagnosticCode", "refusalFactsDigest", "resolution"],
    "Agent pre-intent refusal payload",
  );
  if (payload.activityId !== activityId) {
    fail("pre-intent-refusal", "Agent refusal event names a different activity");
  }
  return Object.freeze({
    diagnosticCode: controlIdentifier(
      exactString(payload.diagnosticCode, "Agent refusal diagnostic code"),
      "Agent refusal diagnostic code",
    ),
    refusalFactsDigest: exactDigest(payload.refusalFactsDigest, "Agent refusal facts digest"),
  });
}

function optionalSubject(
  store: ControlRecordStore,
  activityId: string,
  eventKind: string,
  recordKind: string,
): ControlRecordRevision | null {
  const matches = allActivityEvents(store, activityId).filter((event) => event.eventKind === eventKind);
  if (matches.length > 1) fail("journal", `Agent activity repeats ${eventKind}`);
  if (matches.length === 0) return null;
  const subject = matches[0]!.subject;
  if (subject === null) fail("journal", `${eventKind} omits its exact subject`);
  const revision = store.getRevision(subject.recordId, subject.revision);
  if (revision === null || revision.recordKind !== recordKind || revision.digest !== subject.digest) {
    fail("journal", `${eventKind} does not resolve one exact ${recordKind}`);
  }
  return revision;
}

function hasActivityEvent(store: ControlRecordStore, activityId: string, eventKind: string): boolean {
  return allActivityEvents(store, activityId).some((event) => event.eventKind === eventKind);
}

function sampleTime(store: ControlRecordStore, owners: AgentOperationOwners, label: string): string {
  const selected = controlTimestamp(owners.now(), label);
  const head = store.listEvents(Math.max(0, store.state().journal.eventCount - 1), 1)[0] ?? null;
  if (head === null || Date.parse(selected) >= Date.parse(head.occurredAt)) return selected;
  return head.occurredAt;
}

function allJournalEvents(store: ControlRecordStore): readonly ControlRecordEvent[] {
  const events: ControlRecordEvent[] = [];
  let cursor = 0;
  for (;;) {
    const page = store.listEvents(cursor, 10_000);
    events.push(...page);
    if (events.length > MAXIMUM_JOURNAL_EVENTS) {
      fail("journal-bound", "Agent opening cannot replay a Journal beyond its fixed bound");
    }
    if (page.length < 10_000) return Object.freeze(events);
    cursor = page.at(-1)!.sequence;
  }
}

function prospectivePreDispatchStateDigest(
  store: ControlRecordStore,
  opening: CompiledAgentActivityOpening,
): Sha256 {
  const events = [...allJournalEvents(store)];
  let sequence = store.state().journal.eventCount;
  let predecessorDigest = store.state().journal.headDigest;
  for (const append of opening.appends) {
    const event = compileControlRecordEvent({
      storeId: store.identity.storeId,
      processId: store.identity.processId,
      sequence: sequence += 1,
      predecessorDigest,
      event: append.event,
    });
    events.push(event);
    predecessorDigest = event.digest;
  }
  const state = reduceDeliveryEvents(events, (subject) => {
    if (
      subject.recordId === opening.revision.recordId &&
      subject.revision === opening.revision.revision &&
      subject.digest === opening.revision.digest
    ) return opening.revision;
    return store.getRevision(subject.recordId, subject.revision);
  });
  return digestCanonical(state);
}

function operationOpeningFacts(
  input: FoundationCommonAgentOperationV7Input,
  opening: Readonly<{
    rawDigest: Sha256;
    rawByteLength: number;
    normalizedDigest: Sha256;
    normalizedByteLength: number;
  }>,
): AgentOperationOpeningFacts {
  return Object.freeze({
    agentId: controlIdentifier(input.agentId, "Agent identity"),
    runtimeId: controlIdentifier(input.runtimeId, "Runtime identity"),
    directorId: controlIdentifier(input.opening.directorId, "Director identity"),
    submittedAt: controlTimestamp(input.opening.submittedAt, "Director Brief time"),
    startedAt: controlTimestamp(input.opening.startedAt, "Activity start time"),
    directorSubmissionRawDigest: opening.rawDigest,
    directorSubmissionRawByteLength: opening.rawByteLength,
    directorSemanticDigest: opening.normalizedDigest,
    directorSemanticByteLength: opening.normalizedByteLength,
    investment: Object.freeze({
      ...input.investment,
      limits: Object.freeze({ ...input.investment.limits }),
    }),
  });
}

function reviewOpeningFacts(
  input: FoundationReviewActivityOpeningV7Input,
  opening: CompiledAgentActivityOpening,
): AgentOperationOpeningFacts {
  return Object.freeze({
    agentId: controlIdentifier(input.agentId, "Agent identity"),
    runtimeId: controlIdentifier(input.runtimeId, "Runtime identity"),
    directorId: controlIdentifier(input.opening.directorId, "Director identity"),
    submittedAt: controlTimestamp(input.opening.submittedAt, "Director Brief time"),
    startedAt: controlTimestamp(input.opening.startedAt, "Activity start time"),
    directorSubmissionRawDigest: opening.rawDigest,
    directorSubmissionRawByteLength: opening.rawByteLength,
    directorSemanticDigest: opening.normalizedDigest,
    directorSemanticByteLength: opening.normalizedByteLength,
    investment: Object.freeze({
      ...input.investment,
      limits: Object.freeze({ ...input.investment.limits }),
    }),
  });
}

function assertReviewActivityOpening(input: FoundationReviewActivityOpeningV7Input): void {
  const activityId = controlIdentifier(input.activityId, "Review activity identity");
  const state = input.store.state();
  if (
    state.activities.some(({ id }) => id === activityId) ||
    !state.eligibleOperations.includes("delivery.evaluate")
  ) fail("evaluation-opening", "Review opening identity or operation eligibility is not exact");
  if (
    input.boundary.recordKind !== "work-boundary" ||
    input.candidate.recordKind !== "candidate-revision" ||
    state.subjects.activeBoundary === null ||
    !sameReference(state.subjects.activeBoundary, input.boundary) ||
    state.subjects.candidate === null ||
    !sameReference(state.subjects.candidate, input.candidate)
  ) fail("evaluation-opening", "Review opening does not bind the exact eligible Candidate subjects");
  // The reducer permits reevaluation after failed or correctable review. Its
  // prior Process Seal remains historical; preparation creates this Activity's Seal.
  const { digest: investmentDigest, ...investmentValue } = input.investment;
  if (digestCanonical(investmentValue) !== investmentDigest) {
    fail("investment", "Review opening Investment does not reproduce its exact digest");
  }
}

function compileRequestedAgentActivityOpening(input: Parameters<typeof compileAgentActivityOpening>[0] & Readonly<{
  reservation?: WorkDelegationReservation;
}>): CompiledAgentActivityOpening {
  if (input.reservation === undefined) return compileAgentActivityOpening(input);
  if (input.operation !== "delivery.continue" && input.operation !== "delivery.evaluate") {
    fail("delegation-opening", "A Work Delegation can open only builder or reviewer Agent work");
  }
  const opening = compileDelegatedAgentActivityOpening({ ...input, operation: input.operation, reservation: input.reservation });
  if (opening.revision.createdAt !== input.submittedAt || opening.revision.semanticAuthor.id !== input.directorId ||
      opening.revision.semanticMarkdown !== normalizeSemanticMarkdown(input.semanticMarkdown)) {
    fail("delegation-opening", "Delegated work must reuse the original supplied direction and submission time");
  }
  return opening;
}

/**
 * Compile, but do not retain, the immutable evaluation Brief/activity opening
 * and its immutable common-kernel plan. The evaluation-preparation owner must
 * open the kernel with these appends and the operation-owned checkpoint before
 * it seals or checks the Candidate.
 */
export function compileFoundationReviewActivityOpeningV7(
  input: FoundationReviewActivityOpeningV7Input,
): CompiledFoundationReviewActivityOpeningV7 {
  assertReviewActivityOpening(input);
  const opening = compileRequestedAgentActivityOpening({
    store: input.store,
    activityId: input.activityId,
    operation: "delivery.evaluate",
    semanticMarkdown: input.opening.semanticMarkdown,
    submittedAt: input.opening.submittedAt,
    startedAt: input.opening.startedAt,
    directorId: input.opening.directorId,
    runtimeId: input.runtimeId,
    ...(input.opening.reservation === undefined ? {} : { reservation: input.opening.reservation }),
  });
  const plan: AgentActivityPlan = Object.freeze({
    schema: FOUNDATION_AGENT_ACTIVITY_V7_PLAN_SCHEMA,
    role: "reviewer",
    brief: reference(opening.revision),
    boundary: reference(input.boundary),
    attemptedCandidate: reference(input.candidate),
    opening: reviewOpeningFacts(input, opening),
    executionPlan: null,
  });
  const checkpoint: AgentActivityCheckpoint = Object.freeze({
    schema: FOUNDATION_AGENT_ACTIVITY_V7_CHECKPOINT_SCHEMA,
    coordinate: null,
    execution: null,
    executionSelection: null,
    attempt: null,
    seal: null,
    promotedExecutionPlan: null,
    finalization: null,
    resultCandidate: null,
    candidateRejection: null,
    receipt: null,
    roleCheckpoint: null,
  });
  return Object.freeze({ opening, plan, checkpoint });
}

/** Atomically retain the compiled evaluation opening in the common kernel. */
export function openFoundationReviewAgentActivityV7(
  store: ControlRecordStore,
  activityId: string,
  compiled: CompiledFoundationReviewActivityOpeningV7,
): ControlRecordOperationSupportCoordinate {
  const retained = openFoundationActivityKernelV7({
    store,
    activityId,
    definition: definitionFor("delivery.evaluate"),
    plan: compiled.plan,
    checkpoint: compiled.checkpoint,
    appends: compiled.opening.appends,
  });
  return retained.coordinate;
}

function operationPlan(
  input: FoundationCommonAgentOperationV7Input,
  preDispatchStateDigest: Sha256,
): AgentOperationPlan {
  return Object.freeze({
    ...(input.operation === "delivery.prepare" ? { preparationBasis: input.preparationBasis } : {}),
    attemptCreatedAt: controlTimestamp(input.opening.attemptCreatedAt, "Agent Attempt creation time"),
    preDispatchStateDigest,
    projection: Object.freeze({
      id: input.projection.manifest.projectionId,
      class: input.projection.manifest.class,
      profileId: input.projection.manifest.profile,
      digest: input.projection.manifest.digest,
    }),
    roleSubjectDigest: digestCanonical(input.roleSubject),
    capabilityProfile: Object.freeze({ ...input.capabilityProfile }),
    capabilityDigest: digestCanonical(input.providerInput.capability),
    providerInput: Object.freeze({
      manifestDigest: input.providerInput.manifestDigest,
      bundleDigest: input.providerInput.bundleDigest,
      roleBriefDigest: input.providerInput.roleBrief.digest,
      templateProfileId: input.providerInput.semanticTemplate.profileId,
      templateDigest: input.providerInput.semanticTemplate.digest,
      contentInventoryDigest: input.providerInput.contentInventoryDigest,
      inputMaterialDigest: input.providerInput.inputMaterialDigest,
      citationRegistryDigest: input.providerInput.citationRegistryDigest,
      rootTokenSetDigest: input.providerInput.rootTokenSetDigest,
    }),
    evidenceSetDigest: input.evidenceSetDigest,
    propositionSetDigest: propositionSetDigest(expectedRole(input.operation), input.propositionSet),
  });
}

function activity(
  store: ControlRecordStore,
  activityId: string,
): ReturnType<ControlRecordStore["state"]>["activities"][number] {
  const selected = store.state().activities.filter(({ id }) => id === activityId);
  if (selected.length !== 1 || selected[0]!.family !== "agent" || selected[0]!.stage === "completed") {
    fail("activity", "Agent operation owner requires one exact incomplete Agent activity");
  }
  return selected[0]!;
}

function sameRetainedReference(
  left: RevisionReference,
  right: Readonly<{ id: string; revision: number; digest: Sha256 }>,
): boolean {
  return left.id === right.id && left.revision === right.revision && left.digest === right.digest;
}

function sameOptionalReference(
  left: RevisionReference | null,
  right: ControlRecordRevision | null,
): boolean {
  return left === null
    ? right === null
    : right !== null && sameReference(left, right);
}

function assertInput(
  input: FoundationCommonAgentOperationV7Input,
  retainedSupport?: AgentOperationSupport,
): AgentAttemptRole {
  const operation = operationValue(input.operation);
  const role = expectedRole(operation);
  const activityId = controlIdentifier(input.activityId, "Agent operation activity identity");
  if (retainedSupport === undefined) {
    if (
      input.store.state().activities.some(({ id }) => id === activityId) ||
      !input.store.state().eligibleOperations.includes(operation)
    ) fail("activity", "Fresh Agent operation identity or eligibility is not exact");
  } else {
    const current = activity(input.store, activityId);
    if (current.operation !== operation) fail("activity", "Agent operation differs from its retained activity");
    const brief = retainedRevision(input.store, retainedSupport.brief, "director-brief");
    if (brief.payload.inputProfile !== operation) {
      fail("brief", "Agent operation support does not bind its exact operation Director Brief");
    }
  }
  const state = input.store.state();
  const seal = input.seal ?? null;
  if (input.operation === "delivery.prepare") {
    if (
      input.boundary !== null || input.candidate !== null || seal !== null ||
      state.subjects.activeBoundary !== null || state.subjects.candidate !== null ||
      state.subjects.seal !== null || (retainedSupport !== undefined && (
        retainedSupport.boundary !== null || retainedSupport.attemptedCandidate !== null ||
        retainedSupport.seal !== null || retainedSupport.resultCandidate !== null
      ))
    ) fail("subject", "Fresh preparation cannot bind admitted Candidate lifecycle subjects");
  } else {
    const retainedCandidateBeforeSupport =
      retainedSupport?.role === "builder" && retainedSupport.resultCandidate === null
        ? optionalSubject(
            input.store,
            input.activityId,
            "candidate-revision-observed",
            "candidate-revision",
          )
        : null;
    const expectedCurrentCandidate = retainedSupport?.resultCandidate ??
      (retainedCandidateBeforeSupport === null
        ? reference(input.candidate)
        : reference(retainedCandidateBeforeSupport));
    if (
      input.boundary.recordKind !== "work-boundary" ||
      input.candidate.recordKind !== "candidate-revision" ||
      state.subjects.activeBoundary === null || !sameReference(state.subjects.activeBoundary, input.boundary) ||
      state.subjects.candidate === null ||
      !sameRetainedReference(expectedCurrentCandidate, state.subjects.candidate)
    ) fail("subject", "Agent operation Boundary or Candidate is not the exact reducer-selected subject");
    if (
      (role === "reviewer") !== (seal !== null) ||
      (seal !== null && (
        seal.recordKind !== "candidate-seal" || state.subjects.seal === null ||
        !sameReference(state.subjects.seal, seal)
      ))
    ) fail("subject", "Only reviewer operation requires the exact current Candidate Seal");
  }
  if (
    input.projection.manifest.role !== role || input.providerInput.role !== role ||
    input.projection.manifest.class !== expectedProjectionClass(operation) ||
    input.providerInput.operation !== operation ||
    input.providerInput.projectionDigest !== input.projection.manifest.digest ||
    input.providerInput.roleSubjectDigest !== digestCanonical(input.roleSubject) ||
    input.providerInput.rootTokenSetDigest !== rootTokenSetDigest()
  ) fail("provider-input", "Projection, role subject, and provider input do not reproduce one Agent operation");
  if (
    input.providerInput.capability.candidateWrites !== (role === "builder")
  ) fail("capability", "Only a builder receives Candidate write capability and terminal observation");
  if (
    (role === "reconnaissance") !== (input.evidenceSetDigest === null) ||
    (input.evidenceSetDigest !== null && !SHA256_PATTERN.test(input.evidenceSetDigest))
  ) fail("evidence-subject", "Agent operation Evidence and proposition subjects do not match its role");
  propositionSetDigest(role, input.propositionSet);
  const { digest: investmentDigest, ...investmentValue } = input.investment;
  if (digestCanonical(investmentValue) !== investmentDigest) {
    fail("investment", "Agent operation Investment does not reproduce its exact digest");
  }
  if (!SHA256_PATTERN.test(input.capabilityProfile.digest)) {
    fail("capability", "Agent operation Capability Profile digest is invalid");
  }
  return role;
}

function rootTokenSetDigest(): Sha256 {
  return digestCanonical(Object.freeze({
    schema: "lifecycle.agent-root-token-set.v3",
    tokens: Object.freeze(["input-bundle", "semantic-workspace"]),
  }));
}

type AgentKernelAdapter = FoundationActivityKernelCheckpointAdapterV7<
  AgentActivityPlan,
  AgentActivityCheckpoint
>;

function agentKernelAdapter(
  store: ControlRecordStore,
  activityId: string,
  operation: FoundationCommonAgentOperationV7,
): AgentKernelAdapter {
  return createFoundationActivityKernelCheckpointAdapterV7({
    store,
    activityId,
    definition: definitionFor(operation),
  });
}

export type FoundationAgentRoleCheckpointScopeV7 =
  | "review-preparation"
  | "role-finalization";

/** Focus the Agent activity's sole role-owned recovery slot. */
export function createFoundationAgentRoleCheckpointAdapterV7<
  Child extends ControlJsonObject,
>(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  operation: FoundationCommonAgentOperationV7;
  scope: FoundationAgentRoleCheckpointScopeV7;
  parseCheckpoint(value: ControlJsonObject): Child;
}>): FoundationAgentRoleCheckpointAdapterV7<Child> {
  const parent = agentKernelAdapter(input.store, input.activityId, input.operation);
  return createFoundationActivityChildCheckpointAdapterV7({
    parent,
    lens: Object.freeze({
      get: (checkpoint: AgentActivityCheckpoint) => checkpoint.roleCheckpoint,
      set: (checkpoint: AgentActivityCheckpoint, child: Child | null) => Object.freeze({
        ...checkpoint,
        roleCheckpoint: child,
      }),
      parse: input.parseCheckpoint,
    }),
    assertContext(context, checkpoint) {
      const support = supportFromContext(context);
      if (input.scope === "review-preparation") {
        if (
          input.operation !== "delivery.evaluate" || support.operation !== "delivery.evaluate" ||
          support.role !== "reviewer" || support.stage !== "evaluation-opened" ||
          support.plan !== null || support.seal !== null || checkpoint.promotedExecutionPlan !== null
        ) {
          fail(
            "evaluation-preparation",
            "Review preparation support is not the exact unpromoted evaluation checkpoint",
          );
        }
        return;
      }
      if (support.stage !== "receipt-retained") {
        fail("role-support", "Role control may retain recovery facts only at Receipt finalization");
      }
    },
  });
}

export function narrowFoundationAgentRoleCheckpointAdapterV7<
  Child extends ControlJsonObject,
>(
  adapter: FoundationAgentRoleCheckpointAdapterV7,
  parseCheckpoint: (value: ControlJsonObject) => Child,
): FoundationAgentRoleCheckpointAdapterV7<Child> {
  return narrowFoundationActivityChildCheckpointAdapterV7({
    adapter,
    parse: parseCheckpoint,
  });
}

function commitMilestone(input: Readonly<{
  adapter: AgentKernelAdapter;
  context: FoundationActivityKernelContextV7<AgentActivityPlan, AgentActivityCheckpoint>;
  append: ControlRecordStoreAppend;
  support: AgentOperationSupport;
}>): Readonly<{
  context: FoundationActivityKernelContextV7<AgentActivityPlan, AgentActivityCheckpoint>;
  support: AgentOperationSupport;
  revision: ControlRecordRevision | null;
}> {
  const committed = input.adapter.commit({
    mode: "append",
    expected: input.context.coordinate,
    checkpoint: checkpointPayload(input.support),
    append: input.append,
  });
  if (committed.append === null) {
    fail("operation-support", "Agent operation milestone did not retain its exact atomic postcondition");
  }
  return Object.freeze({
    context: committed.context,
    support: supportFromContext(committed.context),
    revision: committed.append.revision,
  });
}

function replaceSupport(
  adapter: AgentKernelAdapter,
  context: FoundationActivityKernelContextV7<AgentActivityPlan, AgentActivityCheckpoint>,
  support: AgentOperationSupport,
): Readonly<{
  context: FoundationActivityKernelContextV7<AgentActivityPlan, AgentActivityCheckpoint>;
  support: AgentOperationSupport;
}> {
  const committed = adapter.commit({
    mode: "support-only",
    expected: context.coordinate,
    checkpoint: checkpointPayload(support),
  });
  return Object.freeze({
    context: committed.context,
    support: supportFromContext(committed.context),
  });
}

function providerOutcome(
  terminal: ExecutionReceiptProviderObservation,
): "completed" | "failed" | "not-started" {
  if (terminal.outcome === "natural-return" || terminal.outcome === "invalid-result") {
    return "completed";
  }
  return terminal.productiveStarted ? "failed" : "not-started";
}

function candidateSuccessorDisposition(
  support: AgentOperationSupport,
  result: FoundationAgentCellOperationResultV1,
): "promoted" | "not-produced" | "unavailable" | "invalid" | null {
  if (support.operation !== "delivery.continue") {
    if (result.candidate.disposition !== "not-applicable" || support.resultCandidate !== null) {
      fail("candidate", "Only a builder activity can finalize Candidate successor output");
    }
    return null;
  }
  // Provider completion and semantic submission do not decide Candidate progress.
  // A valid published Carrier and its retained successor must agree before Receipt creation.
  if (support.candidateRejection !== null) {
    if (support.resultCandidate !== null || result.candidate.disposition !== "valid" ||
        support.candidateRejection.manifestFileDigest !== sha256Bytes(result.candidate.carrier.manifestBytes) ||
        support.candidateRejection.candidateTree !== result.candidate.carrier.rootTree) {
      fail("candidate", "Retained Candidate rejection differs from its exact published output");
    }
    return "invalid";
  }
  switch (result.candidate.disposition) {
    case "valid":
      if (support.resultCandidate === null) {
        fail("candidate", "Valid builder output lacks its durably selected Candidate successor");
      }
      return "promoted";
    case "invalid":
    case "unavailable":
      if (support.resultCandidate !== null) {
        fail("candidate", "Unvalidated builder output cannot select a Candidate successor");
      }
      return result.candidate.disposition === "invalid"
        ? "invalid"
        : result.receiptFacts.execution.output.availability === "not-produced"
          ? "not-produced"
          : "unavailable";
    case "not-applicable":
      return fail("candidate", "Builder activity cannot omit its Candidate output disposition");
  }
}

function workProductFailureDiagnostic(input: Readonly<{
  error: unknown;
  classification: "invalid-result" | "runtime-failure";
  phase: "syntax" | "template" | "semantic" | "compiler";
}>): ExecutionReceiptSubmissionDiagnostic {
  if (!(input.error instanceof FoundationError)) {
    fail("work-product-diagnostic", "Work Product rejection lacks one exact semantic error code");
  }
  const subject = Object.freeze({
    schema: "lifecycle.agent-work-product-failure-facts.v1",
    classification: input.classification,
    phase: input.phase,
    code: input.error.code,
  });
  return Object.freeze({
    code: input.error.code,
    stage: input.phase,
    factsDigest: digestCanonical(subject),
  });
}

function availableWorkspace(
  observation: Readonly<{
    rawDigest: Sha256;
    rawByteLength: number;
    semanticDigest: Sha256 | null;
  }>,
  workProduct: ControlRecordRevision | null,
  failure: Readonly<{
    diagnostic: ExecutionReceiptSubmissionDiagnostic;
    parserDisposition: "valid" | "invalid";
    compilerDisposition: "invalid-result" | "runtime-failure" | "not-run";
    parseResultDigest: Sha256 | null;
    fixedBindingSubjectDigest: Sha256 | null;
  }> | null,
): ExecutionReceiptWorkspaceObservation {
  if (workProduct !== null) {
    return Object.freeze({
      availability: "available",
      rawByteLength: observation.rawByteLength,
      workspaceRawDigest: observation.rawDigest,
      semanticMarkdownDigest: observation.semanticDigest,
      parseResultDigest: exactDigest(workProduct.payload.parseResultDigest, "Work Product parse result"),
      failureFactsDigest: null,
      submissionDiagnostic: null,
      fixedBindingSubjectDigest: exactDigest(
        workProduct.payload.fixedBindingSubjectDigest,
        "Work Product fixed binding",
      ),
      parserDisposition: "valid",
      compilerDisposition: "retained",
    });
  }
  if (failure !== null) {
    return Object.freeze({
      availability: "available",
      rawByteLength: observation.rawByteLength,
      workspaceRawDigest: observation.rawDigest,
      semanticMarkdownDigest: observation.semanticDigest,
      parseResultDigest: failure.parseResultDigest,
      failureFactsDigest: failure.diagnostic.factsDigest,
      submissionDiagnostic: failure.diagnostic,
      fixedBindingSubjectDigest: failure.fixedBindingSubjectDigest,
      parserDisposition: failure.parserDisposition,
      compilerDisposition: failure.compilerDisposition,
    });
  }
  return Object.freeze({
    availability: "available",
    rawByteLength: observation.rawByteLength,
    workspaceRawDigest: observation.rawDigest,
    semanticMarkdownDigest: observation.semanticDigest,
    parseResultDigest: null,
    failureFactsDigest: null,
    submissionDiagnostic: null,
    fixedBindingSubjectDigest: null,
    parserDisposition: "not-run",
    compilerDisposition: "not-run",
  });
}

function unavailableWorkspace(
  result: FoundationAgentCellOperationResultV1,
): ExecutionReceiptWorkspaceObservation {
  return Object.freeze({
    availability: "unavailable",
    failureFactsDigest: digestCanonical(Object.freeze({
      schema: "lifecycle.agent-semantic-output-unavailable-facts.v1",
      semanticDisposition: result.semantic.disposition,
      outputValidation: result.terminal.outputValidation,
      observationDigest: result.terminal.observationDigest,
      outputDigest: result.terminal.outputDigest,
    })),
    submissionDiagnostic: null,
  });
}

function workProductDisposition(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  attempt: ControlRecordRevision;
}>): Readonly<{ kind: "submitted"; revision: ControlRecordRevision } | { kind: "abandoned" }> | null {
  const submitted = optionalSubject(
    input.store,
    input.activityId,
    "agent-work-product-submitted",
    "agent-work-product",
  );
  const abandoned = hasActivityEvent(input.store, input.activityId, "agent-work-product-abandoned");
  if (submitted !== null && abandoned) fail("work-product", "Activity has two Work Product dispositions");
  if (submitted !== null) {
    const targets = submitted.relationships.filter(({ relation }) => relation === "result-of");
    if (
      targets.length !== 1 || targets[0]!.target.id !== input.attempt.recordId ||
      targets[0]!.target.revision !== input.attempt.revision ||
      targets[0]!.target.digest !== input.attempt.digest
    ) fail("work-product", "Retained Work Product does not bind the exact Attempt");
    return Object.freeze({ kind: "submitted", revision: submitted });
  }
  return abandoned ? Object.freeze({ kind: "abandoned" as const }) : null;
}

async function finalizeCellWorkProduct(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  attempt: ControlRecordRevision;
  providerInput: ProviderInputV4;
  propositionSet: AgentWorkProductPropositionSet | null;
  provider: ExecutionReceiptProviderObservation;
  result: FoundationAgentCellOperationResultV1;
  owners: AgentOperationOwners;
  agentId: string;
  runtimeId: string;
}>): Promise<WorkspaceFinalization> {
  const prior = workProductDisposition(input);
  const abandon = (at: string): void => {
    if (prior?.kind === "submitted") {
      fail("work-product", "Retained Work Product cannot become abandonment during recovery");
    }
    if (prior === null) {
      input.owners.abandonWorkProduct({
        store: input.store,
        activityId: input.activityId,
        abandonedAt: at,
        runtimeId: input.runtimeId,
      });
    }
  };
  let workProduct: ControlRecordRevision | null = null;
  let workspace: ExecutionReceiptWorkspaceObservation;
  const artifact = input.result.semantic.artifact;
  const eligible = artifact !== null && input.provider.outcome === "natural-return" &&
    input.provider.firstTrigger === "natural-return";
  if (artifact !== null) {
    const reopened = await readFoundationAgentSemanticWorkspaceV1({
      artifact,
      maximumBytes: 1024 * 1024,
    });
    let semanticDigest: Sha256 | null = null;
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(reopened.bytes);
      semanticDigest = sha256Bytes(normalizeSemanticMarkdown(decoded));
    } catch {
      // Invalid UTF-8 remains exact observed bytes and cannot become semantic truth.
    }
    const observed = Object.freeze({
      rawDigest: reopened.digest,
      rawByteLength: reopened.byteLength,
      semanticDigest,
    });
    let failure: Parameters<typeof availableWorkspace>[2] = null;
    if (eligible) {
      const submittedAt = prior?.kind === "submitted"
        ? prior.revision.createdAt
        : sampleTime(input.store, input.owners, "Agent Work Product submission time");
      const submitted = await input.owners.finalizeWorkProduct({
        store: input.store,
        activityId: input.activityId,
        editor: Object.freeze({ kind: "agent" as const, id: input.agentId }),
        templateDigest: input.providerInput.semanticTemplate.digest,
        semanticBytes: reopened.bytes,
        attempt: reference(input.attempt),
        citationRegistry: input.providerInput.citationRegistry,
        propositionSet: input.propositionSet,
        submittedAt,
        runtimeId: input.runtimeId,
      });
      const actual = submitted.status === "retained"
        ? Object.freeze({ rawDigest: submitted.rawDigest, rawByteLength: submitted.rawByteLength })
        : submitted.observation;
      if (actual.rawDigest !== observed.rawDigest || actual.rawByteLength !== observed.rawByteLength) {
        fail("workspace-drift", "Semantic workspace changed after provider terminal observation");
      }
      if (submitted.status === "retained") {
        if (input.result.semantic.disposition !== "valid") {
          fail("semantic-disposition", "Cell-invalid semantic output unexpectedly retained a Work Product");
        }
        if (prior?.kind === "abandoned" || (prior?.kind === "submitted" && prior.revision.digest !== submitted.revision.digest)) {
          fail("work-product", "Recovered Work Product differs from retained disposition");
        }
        workProduct = submitted.revision;
      } else {
        if (prior?.kind === "submitted") fail("work-product", "Recovered refusal conflicts with retained Work Product");
        failure = Object.freeze({
          diagnostic: workProductFailureDiagnostic(submitted),
          parserDisposition: submitted.parseResultDigest === null ? "invalid" : "valid",
          compilerDisposition: submitted.parseResultDigest === null ? "not-run" : submitted.classification,
          parseResultDigest: submitted.parseResultDigest,
          fixedBindingSubjectDigest: submitted.fixedBindingSubjectDigest,
        });
        abandon(submittedAt);
      }
    } else {
      abandon(sampleTime(input.store, input.owners, "Agent Work Product abandonment time"));
    }
    workspace = availableWorkspace(observed, workProduct, failure);
  } else {
    abandon(sampleTime(input.store, input.owners, "Agent Work Product abandonment time"));
    workspace = unavailableWorkspace(input.result);
  }
  return Object.freeze({
    workspace,
    submissionTrigger: eligible ? "clean-natural-completion" : null,
    workProduct: workProduct === null ? null : reference(workProduct),
  });
}

function candidateStateDigest(candidate: ControlRecordRevision): Sha256 | null {
  if (candidate.payload.schema !== "lifecycle.candidate-revision-payload.v3") {
    fail("candidate", "Candidate Revision does not use the current reconstructible payload");
  }
  const state = exactObject(candidate.payload.state, "Candidate state");
  return exactDigest(state.candidateDigest, "Candidate logical digest");
}

function candidateBaseCommit(candidate: ControlRecordRevision): string {
  const value = exactString(candidate.payload.candidateBaseCommit, "Candidate immutable base");
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(value)) {
    fail("candidate", "Candidate immutable base is not one full Git object identity");
  }
  return value;
}

function runtimeCoordinates(runtimeId: string, operation: FoundationCommonAgentOperationV7) {
  return Object.freeze({
    implementationId: runtimeId,
    implementationDigest: digestCanonical(Object.freeze({
      id: runtimeId,
      runtimeProtocol: FOUNDATION_RUNTIME_PROTOCOL,
      owner: "agent-operation-v7",
    })),
    ruleSetId: `foundation-${operation.slice("delivery.".length)}-agent-operation-v7`,
    ruleSetDigest: digestCanonical(Object.freeze({
      schema: "lifecycle.agent-operation-rule-set.v1",
      operation,
      eventOrder: Object.freeze([
        "agent-attempt-prepared",
        "provider-effect-intended",
        "provider-effect-observed",
        "work-product-observation",
        ...(operation === "delivery.continue" ? ["candidate-revision-observed"] : []),
        "execution-receipt-recorded",
        "activity-finalization",
      ]),
    })),
  });
}

function assertSupportInput(
  input: FoundationCommonAgentOperationV7Input,
  support: AgentOperationSupport,
): void {
  const role = expectedRole(input.operation);
  const opening = support.opening;
  const plan = retainedOperationPlan(support);
  const normalized = normalizeSemanticMarkdown(input.opening.semanticMarkdown);
  const derivedPropositionSetDigest = propositionSetDigest(role, input.propositionSet);
  if (
    support.activityId !== input.activityId || support.operation !== input.operation ||
    support.role !== role ||
    !sameOptionalReference(support.boundary, input.boundary) ||
    !sameOptionalReference(support.attemptedCandidate, input.candidate) ||
    ((input.seal ?? null) === null) !== (support.seal === null) ||
    (support.seal !== null && !sameReference(support.seal, input.seal!)) ||
    opening.agentId !== input.agentId || opening.runtimeId !== input.runtimeId ||
    opening.directorId !== input.opening.directorId ||
    opening.submittedAt !== input.opening.submittedAt ||
    opening.startedAt !== input.opening.startedAt ||
    plan.attemptCreatedAt !== input.opening.attemptCreatedAt ||
    opening.directorSemanticDigest !== sha256Bytes(normalized) ||
    opening.directorSemanticByteLength !== Buffer.byteLength(normalized, "utf8") ||
    plan.projection.id !== input.projection.manifest.projectionId ||
    plan.projection.class !== input.projection.manifest.class ||
    plan.projection.class !== expectedProjectionClass(input.operation) ||
    plan.projection.profileId !== input.projection.manifest.profile ||
    plan.projection.digest !== input.projection.manifest.digest ||
    plan.roleSubjectDigest !== digestCanonical(input.roleSubject) ||
    plan.capabilityProfile.id !== input.capabilityProfile.id ||
    plan.capabilityProfile.digest !== input.capabilityProfile.digest ||
    plan.capabilityDigest !== digestCanonical(input.providerInput.capability) ||
    digestCanonical(opening.investment) !== digestCanonical(input.investment) ||
    plan.providerInput.manifestDigest !== input.providerInput.manifestDigest ||
    plan.providerInput.bundleDigest !== input.providerInput.bundleDigest ||
    plan.providerInput.roleBriefDigest !== input.providerInput.roleBrief.digest ||
    plan.providerInput.templateProfileId !== input.providerInput.semanticTemplate.profileId ||
    plan.providerInput.templateDigest !== input.providerInput.semanticTemplate.digest ||
    plan.providerInput.contentInventoryDigest !== input.providerInput.contentInventoryDigest ||
    plan.providerInput.inputMaterialDigest !== input.providerInput.inputMaterialDigest ||
    plan.providerInput.citationRegistryDigest !== input.providerInput.citationRegistryDigest ||
    plan.providerInput.rootTokenSetDigest !== input.providerInput.rootTokenSetDigest ||
    plan.evidenceSetDigest !== input.evidenceSetDigest ||
    plan.propositionSetDigest !== derivedPropositionSetDigest
  ) fail("operation-support", "Agent operation inputs do not reproduce retained support");

  verifyProviderInputV4(input.providerInput, input.projection);
  const brief = retainedRevision(input.store, support.brief, "director-brief");
  const submission = exactClosedObject(
    brief.payload.submission,
    ["rawDigest", "rawByteLength", "normalizedByteLength"],
    "Retained Director Brief submission",
  );
  const events = allActivityEvents(input.store, input.activityId);
  const delegated = readWorkDelegationExecution({ store: input.store, activityId: input.activityId });
  const briefEvents = delegated.reservation === null
    ? events.filter(({ eventKind }) => eventKind === "director-brief-submitted")
    : allJournalEvents(input.store).filter(event => event.eventKind === "director-brief-submitted" &&
      event.subject?.recordId === brief.recordId && event.subject.revision === brief.revision && event.subject.digest === brief.digest);
  const expectedScope = delegated.reservation === null ? { kind: "activity", activityId: input.activityId }
    : { kind: "delegation", delegationId: delegated.reservation.delegation.id,
        delegationRevision: delegated.reservation.delegation.revision, operation: input.operation };
  const starts = events.filter(({ eventKind }) => eventKind === "activity-started");
  if (
    canonicalJson(brief.payload.scope) !== canonicalJson(expectedScope) ||
    (input.opening.reservation !== undefined && canonicalJson(input.opening.reservation) !== canonicalJson(delegated.reservation)) ||
    brief.payload.inputProfile !== input.operation || brief.createdAt !== opening.submittedAt ||
    brief.semanticAuthor.kind !== "director" || brief.semanticAuthor.id !== opening.directorId ||
    brief.semanticMarkdown !== normalized ||
    brief.payload.semanticMarkdownDigest !== opening.directorSemanticDigest ||
    submission.rawDigest !== opening.directorSubmissionRawDigest ||
    submission.rawByteLength !== opening.directorSubmissionRawByteLength ||
    submission.normalizedByteLength !== opening.directorSemanticByteLength ||
    briefEvents.length !== 1 || briefEvents[0]!.occurredAt !== opening.submittedAt ||
    starts.length !== 1 || starts[0]!.occurredAt !== opening.startedAt
  ) fail("opening-binding", "Retained Director Brief and activity opening differ from their checkpoint");
}

type AgentExecutionPolicySelection = Readonly<{
  executionPolicy: AgentAttemptExecutionPolicy;
  subjects: readonly FoundationAgentCellImmutableSubjectV1[];
}>;

function canonicalBytes(value: unknown): Uint8Array {
  return Uint8Array.from(Buffer.from(`${canonicalJson(value)}\n`, "utf8"));
}

function immutableSubject(input: Readonly<{
  kind: FoundationAgentCellImmutableSubjectV1["subject"]["kind"];
  id: string;
  revision?: number | null;
  digest: Sha256;
  bytes: Uint8Array;
  candidateBinding?: FoundationAgentCellImmutableSubjectV1["candidateBinding"];
}>): FoundationAgentCellImmutableSubjectV1 {
  return Object.freeze({
    subject: Object.freeze({
      kind: input.kind,
      id: input.id,
      revision: input.revision ?? null,
      digest: input.digest,
    }),
    bytes: Uint8Array.from(input.bytes),
    candidateBinding: input.candidateBinding ?? null,
  });
}

function immutableEntry(input: Readonly<{
  path: string;
  purpose: FoundationAgentCellImmutableEntryV1["plan"]["purpose"];
  mediaType: string;
  modeClass: "regular" | "executable";
  sourceSubjectDigest: Sha256;
  bytes: Uint8Array;
}>): FoundationAgentCellImmutableEntryV1 {
  return Object.freeze({
    plan: Object.freeze({
      path: input.path,
      purpose: input.purpose,
      mediaType: input.mediaType,
      modeClass: input.modeClass,
      sourceSubjectDigest: input.sourceSubjectDigest,
    }),
    bytes: Uint8Array.from(input.bytes),
  });
}

function retainedAgentExecutionPolicies(selection:FoundationAgentExecutionSelectionV1):AgentExecutionPolicySelection {
  return Object.freeze({executionPolicy:selection.compiled.executionPolicy,
    subjects:Object.freeze(selection.policySubjects.map(({id,digest,value}) => immutableSubject({kind:"policy",id,digest,bytes:canonicalBytes(value)})))});
}

function selectAgentExecution(input:Readonly<{request:FoundationCommonAgentOperationV7Input;owners:AgentOperationOwners}>):FoundationAgentExecutionSelectionV1 {
  const policies = compileFoundationInstalledAgentExecutionPolicyV1();
  const execution = input.request.configuration.execution;
  if (execution === undefined) fail("execution-backend-unavailable","Agent execution requires one installed Execution Image with Agent provider support");
  const compiled = input.owners.compileInstalled({configuration:input.request.configuration,
    provider:selectFoundationInstalledAgentProviderV1(input.request.configuration),investment:input.request.investment,executionPolicy:policies.executionPolicy});
  return compileFoundationAgentExecutionSelectionV1({compiled,image:execution.image,
    providerDescriptor:FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR as unknown as ControlJsonObject,policies});
}

function assertDelegatedAgentExecution(input: Readonly<{
  request: FoundationCommonAgentOperationV7Input;
  selection: FoundationAgentExecutionSelectionV1;
}>): void {
  const binding = readWorkDelegationExecution({ store: input.request.store, activityId: input.request.activityId });
  const slot = workDelegationAgentSlot(binding, expectedRole(input.request.operation));
  if (slot !== null && !workDelegationRetainedAgentSelectionMatches(slot, {
    selection: input.selection, investment: input.request.investment,
  })) {
    fail("delegation-execution-selection", "Agent execution differs from its exact reserved resources; restore that selection before continuing");
  }
}

type CandidateCellInput = Readonly<{
  subjects: readonly FoundationAgentCellImmutableSubjectV1[];
  entries: readonly FoundationAgentCellImmutableEntryV1[];
}>;

async function candidateCellInput(input: Readonly<{
  request: FoundationCommonAgentOperationV7Input;
  support: AgentOperationSupport;
  owners: AgentOperationOwners;
}>): Promise<CandidateCellInput> {
  if (input.support.attemptedCandidate === null) {
    return Object.freeze({ subjects: Object.freeze([]), entries: Object.freeze([]) });
  }
  const candidate = retainedRevision(
    input.request.store,
    input.support.attemptedCandidate,
    "candidate-revision",
  );
  if (candidate.payload.schema !== "lifecycle.candidate-revision-payload.v3") {
    fail("candidate", "Agent input Candidate is not reconstructible Carrier-backed state");
  }
  const carrierReference = exactClosedObject(
    candidate.payload.carrierManifest,
    ["digest", "byteLength", "mediaType", "purpose"],
    "Candidate Carrier manifest reference",
  );
  const manifestDigest = exactDigest(
    carrierReference.digest,
    "Candidate Carrier manifest digest",
  );
  const retained = await input.request.store.readRetainedFile(manifestDigest);
  if (
    retained === null || retained.descriptor.byteLength !== carrierReference.byteLength ||
    retained.descriptor.mediaType !== carrierReference.mediaType ||
    retained.descriptor.purpose !== carrierReference.purpose
  ) fail("candidate-carrier", "Candidate Carrier manifest cannot be reopened exactly");
  const opened = await input.owners.openCarrier({
    machineHome: input.request.configuration.machineHome,
    manifestBytes: retained.bytes,
    limits: FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
  });
  if (
    opened.manifestBytes.byteLength !== retained.bytes.byteLength ||
    sha256Bytes(opened.manifestBytes) !== manifestDigest
  ) fail("candidate-carrier", "Candidate Carrier Store reopened another manifest");
  const artifactBytes = await input.owners.readCarrierArtifact(opened.artifactPath);
  if (
    artifactBytes.byteLength !== opened.manifest.carrierArtifact.byteLength ||
    sha256Bytes(artifactBytes) !== opened.manifest.carrierArtifact.digest
  ) fail("candidate-carrier", "Candidate Carrier artifact differs from its exact manifest");
  const state = exactObject(candidate.payload.state, "Candidate state");
  if (exactString(state.tree, "Candidate tree") !== opened.manifest.rootTree) {
    fail("candidate-carrier", "Candidate state and Carrier root tree differ");
  }
  const gitContext = await openFoundationDeliveryGitContextV1({
    machineHome: input.request.configuration.machineHome, repository: input.request.targetRepository,
    store: input.request.store, candidate,
  });
  const gitContextDigest = sha256Bytes(gitContext.manifestBytes);
  return Object.freeze({
    subjects: Object.freeze([
      immutableSubject({ kind: "delivery-git-context", id: `${candidate.recordId}.git-context`, revision: candidate.revision, digest: gitContextDigest, bytes: gitContext.manifestBytes }),
      immutableSubject({
        kind: "candidate-revision",
        id: candidate.recordId,
        revision: candidate.revision,
        digest: candidate.digest,
        bytes: canonicalBytes(candidate),
        candidateBinding: Object.freeze({
          carrierManifestFileDigest: manifestDigest,
          rootTree: opened.manifest.rootTree,
        }),
      }),
      immutableSubject({
        kind: "candidate-revision-carrier-manifest",
        id: `${candidate.recordId}.carrier-manifest`,
        revision: candidate.revision,
        digest: manifestDigest,
        bytes: retained.bytes,
      }),
    ]),
    entries: Object.freeze([
      immutableEntry({ path: FOUNDATION_DELIVERY_GIT_CONTEXT_PATHS_V1.manifest, purpose: "operation-input", mediaType: "application/json", modeClass: "regular", sourceSubjectDigest: gitContextDigest, bytes: gitContext.manifestBytes }),
      immutableEntry({ path: FOUNDATION_DELIVERY_GIT_CONTEXT_PATHS_V1.artifact, purpose: "operation-input", mediaType: "application/octet-stream", modeClass: "regular", sourceSubjectDigest: gitContextDigest, bytes: gitContext.artifactBytes }),
      immutableEntry({
        path: FOUNDATION_AGENT_EXECUTION_CELL_INPUT_V1.candidateManifestPath,
        purpose: "operation-input",
        mediaType: "application/json",
        modeClass: "regular",
        sourceSubjectDigest: manifestDigest,
        bytes: retained.bytes,
      }),
      immutableEntry({
        path: FOUNDATION_AGENT_EXECUTION_CELL_INPUT_V1.candidateArtifactPath,
        purpose: "candidate-carrier-artifact",
        mediaType: "application/octet-stream",
        modeClass: "regular",
        sourceSubjectDigest: manifestDigest,
        bytes: artifactBytes,
      }),
    ]),
  });
}

async function compileAgentCellInput(input: Readonly<{
  request: FoundationCommonAgentOperationV7Input;
  support: AgentOperationSupport;
  owners: AgentOperationOwners;
  installed: FoundationCompiledInstalledAgentCellInputsV1;
  policies: AgentExecutionPolicySelection;
}>): Promise<FoundationCompiledAgentCellInputV1> {
  const plan = retainedOperationPlan(input.support);
  const brief = retainedRevision(input.request.store, input.support.brief, "director-brief");
  const candidate = await candidateCellInput(input);
  const roleBriefBytes = Uint8Array.from(Buffer.from(input.request.providerInput.roleBrief.markdown, "utf8"));
  const templateBytes = Uint8Array.from(Buffer.from(
    input.request.providerInput.semanticTemplate.markdown,
    "utf8",
  ));
  const providerContents = input.request.providerInput.contents.map((content) => {
    if (content.path === FOUNDATION_AGENT_EXECUTION_CELL_INPUT_V1.roleBriefPath) {
      return immutableEntry({
        path: content.path,
        purpose: "role-brief",
        mediaType: "text/markdown; charset=utf-8",
        modeClass: "regular",
        sourceSubjectDigest: plan.providerInput.roleBriefDigest,
        bytes: content.bytes,
      });
    }
    if (content.path === PROVIDER_INPUT_SEMANTIC_BASIS_PATH) {
      return immutableEntry({
        path: content.path,
        purpose: "operation-input",
        mediaType: "application/json",
        modeClass: "regular",
        sourceSubjectDigest: plan.roleSubjectDigest,
        bytes: content.bytes,
      });
    }
    return immutableEntry({
      path: content.path,
      purpose: "projection",
      mediaType: "application/octet-stream",
      modeClass: "regular",
      sourceSubjectDigest: plan.projection.digest,
      bytes: content.bytes,
    });
  });
  const selection = input.support.executionSelection;
  if (selection === null) fail("execution-selection","Agent Input Set requires its retained execution selection");
  const execution = {image:selection.image};
  const subjects = Object.freeze([
    immutableSubject({
      kind: "projection",
      id: plan.projection.id,
      digest: plan.projection.digest,
      bytes: canonicalBytes(input.request.projection.manifest),
    }),
    immutableSubject({
      kind: "role-subject",
      id: `role-subject-${plan.roleSubjectDigest.slice("sha256:".length)}`,
      digest: plan.roleSubjectDigest,
      bytes: canonicalBytes(input.request.roleSubject),
    }),
    immutableSubject({
      kind: "director-direction",
      id: brief.recordId,
      revision: brief.revision,
      digest: brief.digest,
      bytes: canonicalBytes(brief),
    }),
    immutableSubject({
      kind: "role-brief",
      id: "lifecycle.agent-role-brief.v1",
      digest: plan.providerInput.roleBriefDigest,
      bytes: roleBriefBytes,
    }),
    immutableSubject({
      kind: "semantic-template",
      id: plan.providerInput.templateProfileId,
      digest: plan.providerInput.templateDigest,
      bytes: templateBytes,
    }),
    immutableSubject({
      kind: "capability-profile",
      id: plan.capabilityProfile.id,
      digest: plan.capabilityProfile.digest,
      bytes: canonicalBytes(Object.freeze({
        id: plan.capabilityProfile.id,
        digest: plan.capabilityProfile.digest,
        effectiveGrant: input.request.providerInput.capability,
      })),
    }),
    immutableSubject({
      kind: "provider-descriptor",
      id: input.installed.installed.provider.descriptorId,
      digest: input.installed.installed.provider.descriptorDigest,
      bytes: canonicalBytes(selection.providerDescriptor),
    }),
    immutableSubject({
      kind: "investment",
      id: input.request.investment.id,
      digest: input.request.investment.digest,
      bytes: canonicalBytes(input.request.investment),
    }),
    ...input.policies.subjects,
    immutableSubject({
      kind: "runner",
      id: execution.image.runnerContractId,
      digest: input.installed.installed.image.runnerContractDigest,
      bytes: canonicalBytes(Object.freeze({
        contractId: execution.image.runnerContractId,
        contractDigest: execution.image.runnerContractDigest,
        implementationDigest: execution.image.runnerImplementationDigest,
        toolInventoryDigest: execution.image.toolInventoryDigest,
      })),
    }),
    ...candidate.subjects,
  ]);
  const entries = Object.freeze([
    ...providerContents,
    immutableEntry({
      path: FOUNDATION_AGENT_EXECUTION_CELL_INPUT_V1.semanticTemplatePath,
      purpose: "semantic-template",
      mediaType: "text/markdown; charset=utf-8",
      modeClass: "regular",
      sourceSubjectDigest: plan.providerInput.templateDigest,
      bytes: templateBytes,
    }),
    ...candidate.entries,
  ]);
  return await input.owners.compileInput({
    store: input.request.store,
    activityId: input.request.activityId,
    role: input.support.role,
    ownerSubjectDigest: plan.roleSubjectDigest,
    inputMaterialDigest: plan.providerInput.inputMaterialDigest,
    subjects,
    entries,
    runnerContractDigest: input.installed.installed.image.runnerContractDigest,
    toolInventoryDigest: input.installed.installed.image.toolInventoryDigest,
  });
}

type CompiledAgentCellOperation = Readonly<{
  policies: AgentExecutionPolicySelection;
  installed: FoundationCompiledInstalledAgentCellInputsV1;
  input: FoundationCompiledAgentCellInputV1;
  attempt: ReturnType<typeof compileAgentAttemptAppend>;
  specification: FoundationExecutionSpecificationV1;
  validationBasis: AgentWorkProductValidationBasis;
}>;

async function compileAgentCellOperation(input: Readonly<{
  request: FoundationCommonAgentOperationV7Input;
  support: AgentOperationSupport;
  owners: AgentOperationOwners;
}>): Promise<CompiledAgentCellOperation> {
  const plan = retainedOperationPlan(input.support);
  const selection = input.support.executionSelection;
  if (selection === null) fail("execution-selection","Agent execution requires one retained selection before allocation");
  assertDelegatedAgentExecution({ request: input.request, selection });
  const policies = retainedAgentExecutionPolicies(selection);
  const installed = selection.compiled;
  const validationBasis = createAgentWorkProductValidationBasis({
    role: input.support.role,
    templateDigest: plan.providerInput.templateDigest,
    parserProfileId: FOUNDATION_AGENT_WORK_PRODUCT_PARSER_PROFILE_ID,
    parserProfileDigest: agentWorkProductParserProfileDigest(),
    compilerProfileId: FOUNDATION_AGENT_WORK_PRODUCT_COMPILER_PROFILE_ID,
    compilerProfileDigest: agentWorkProductCompilerProfileDigest(),
    citationRegistryDigest: plan.providerInput.citationRegistryDigest,
    citationRegistry: input.request.providerInput.citationRegistry,
    propositionSetDigest: plan.propositionSetDigest,
    propositionSet: input.request.propositionSet,
  });
  if (canonicalJson(validationBasis) !== canonicalJson(input.request.providerInput.validationBasis)) {
    fail("semantic-basis-binding", "Provider-visible semantic basis differs from the exact retained Attempt inputs");
  }
  const compiledInput = await compileAgentCellInput({
    ...input,
    installed,
    policies,
  });
  const attempt = compileAgentAttemptAppend({
    store: input.request.store,
    activityId: input.request.activityId,
    operation: input.request.operation,
    role: input.support.role,
    createdAt: plan.attemptCreatedAt,
    preDispatchStateDigest: plan.preDispatchStateDigest,
    runtimeId: input.support.opening.runtimeId,
    projection: Object.freeze({
      id: plan.projection.id,
      profileId: plan.projection.profileId,
      digest: plan.projection.digest,
    }),
    roleSubject: input.request.roleSubject,
    capability: Object.freeze({
      profileId: plan.capabilityProfile.id,
      profileDigest: plan.capabilityProfile.digest,
      effectiveGrantDigest: plan.capabilityDigest,
    }),
    investment: input.support.opening.investment,
    provider: installed.installed.provider,
    execution: Object.freeze({
      backendProfile: Object.freeze({
        profileId: installed.installed.profile.profileId,
        profileDigest: installed.installed.profile.digest,
        implementationDigest:
          installed.installed.profile.implementation.implementationDigest,
      }),
      image: Object.freeze({
        imageId: installed.installed.image.imageId,
        imageDigest: installed.installed.image.imageDigest,
      }),
      inputSet: Object.freeze({
        profileId: "lifecycle.execution-input-set.v2" as const,
        digest: compiledInput.inputSet.digest,
      }),
    }),
    authoring: Object.freeze({
      roleBriefDigest: plan.providerInput.roleBriefDigest,
      templateProfileId: plan.providerInput.templateProfileId,
      templateDigest: plan.providerInput.templateDigest,
      parserProfileId: FOUNDATION_AGENT_WORK_PRODUCT_PARSER_PROFILE_ID,
      parserProfileDigest: agentWorkProductParserProfileDigest(),
      compilerProfileId: FOUNDATION_AGENT_WORK_PRODUCT_COMPILER_PROFILE_ID,
      compilerProfileDigest: agentWorkProductCompilerProfileDigest(),
      submissionPolicy: "explicit-or-clean-natural-completion",
    }),
    input: Object.freeze({
      contentInventoryDigest: compiledInput.inputSet.contentInventoryDigest,
      inputMaterialDigest: compiledInput.inputSet.inputMaterialDigest,
      citationRegistryDigest: plan.providerInput.citationRegistryDigest,
      evidenceSetDigest: plan.evidenceSetDigest,
      propositionSetDigest: plan.propositionSetDigest,
    }),
    executionPolicy: installed.executionPolicy,
    adjacentFilePurposes: Object.freeze([
      "raw-provider-output",
      ...(input.support.role === "builder" ? FOUNDATION_BUILDER_REPAIR_PURPOSES : []),
    ]),
    brief: Object.freeze({ kind: "director-brief", ...input.support.brief }),
    boundary: input.support.boundary === null
      ? null
      : Object.freeze({ kind: "work-boundary", ...input.support.boundary }),
    candidate: input.support.attemptedCandidate === null
      ? null
      : Object.freeze({ kind: "candidate-revision", ...input.support.attemptedCandidate }),
    seal: input.support.seal === null
      ? null
      : Object.freeze({ kind: "candidate-seal", ...input.support.seal }),
  });
  const specification = compileFoundationAgentCellSpecificationV1({
    store: input.request.store,
    activityId: input.request.activityId,
    attempt,
    compiledInput,
    installed: installed.installed,
  });
  return Object.freeze({
    policies,
    installed,
    input: compiledInput,
    attempt,
    specification,
    validationBasis,
  });
}

function assertRetainedAttempt(
  store: ControlRecordStore,
  support: AgentOperationSupport,
  compiled: CompiledAgentCellOperation,
): void {
  if (support.attempt === null) return;
  const retained = retainedRevision(store, support.attempt, "agent-attempt");
  if (canonicalJson(retained) !== canonicalJson(compiled.attempt.revision)) {
    fail("attempt-binding", "Recovered Agent Attempt differs from the exact recompiled Cell subject");
  }
  if (
    support.coordinate === null || support.execution === null ||
    support.coordinate.executableIdentity !==
      compiled.installed.installed.provider.installedIdentityDigest ||
    support.execution.backendProfile.profileId !==
      compiled.installed.installed.profile.profileId ||
    support.execution.backendProfile.profileDigest !==
      compiled.installed.installed.profile.digest ||
    support.execution.backendProfile.implementationDigest !==
      compiled.installed.installed.profile.implementation.implementationDigest
  ) fail("attempt-binding", "Recovered Agent Cell support differs from its exact installed Attempt");
}

function sameExecutionCoordinate(
  left: FoundationExecutionOperationCheckpointCoordinateV1 | null,
  right: FoundationExecutionOperationCheckpointCoordinateV1 | null,
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function assertAgentCellPersistenceBinding(input: Readonly<{
  binding: FoundationAgentCellPersistenceBindingV1;
  store: ControlRecordStore;
  activityId: string;
  attempt: ControlRecordRevision;
  inputSetDigest: Sha256;
  specificationDigest: Sha256;
}>): void {
  const subject = Object.freeze({
    storeId: input.store.identity.storeId,
    processId: input.store.identity.processId,
    activityId: input.activityId,
    attempt: Object.freeze({
      id: input.attempt.recordId,
      revision: input.attempt.revision,
      digest: input.attempt.digest,
    }),
    inputSetDigest: input.inputSetDigest,
    specificationDigest: input.specificationDigest,
  });
  const expected = Object.freeze({ ...subject, digest: digestCanonical(subject) });
  if (canonicalJson(input.binding) !== canonicalJson(expected)) {
    fail("cell-owner-binding", "Agent Cell persistence substituted its exact Activity subject");
  }
}

function retainedAppendResult(
  store: ControlRecordStore,
  activityId: string,
  append: ControlRecordStoreAppend,
): ControlRecordStoreAppendResult {
  const matches = allActivityEvents(store, activityId).filter(({ eventId }) =>
    eventId === append.event.eventId);
  if (matches.length !== 1) {
    fail("cell-owner-append", "Atomic Agent Cell owner did not retain one exact append event");
  }
  const event = matches[0]!;
  if (
    event.eventKind !== append.event.eventKind || event.occurredAt !== append.event.occurredAt ||
    canonicalJson(event.actor) !== canonicalJson(append.event.actor) ||
    canonicalJson(event.subject) !== canonicalJson(append.event.subject ?? null) ||
    canonicalJson(event.payload) !== canonicalJson(append.event.payload)
  ) fail("cell-owner-append", "Atomic Agent Cell owner retained another append event");
  if (append.revision === undefined) return Object.freeze({ revision: null, event });
  if (event.subject === null) {
    fail("cell-owner-append", "Atomic Agent Cell revision append lacks its exact event subject");
  }
  const revision = store.getRevision(event.subject.recordId, event.subject.revision);
  if (revision === null || revision.digest !== event.subject.digest) {
    fail("cell-owner-append", "Atomic Agent Cell revision append does not resolve exactly");
  }
  return Object.freeze({ revision, event });
}

function createAgentCellActivityOwner(input: Readonly<{
  request: FoundationCommonAgentOperationV7Input;
  support: AgentOperationSupport;
  context: FoundationActivityKernelContextV7<AgentActivityPlan, AgentActivityCheckpoint>;
  adapter: AgentKernelAdapter;
  compiled: CompiledAgentCellOperation;
}>): FoundationAgentCellActivityOwnerV1 {
  const specification = input.compiled.specification;
  const executableIdentity = input.compiled.installed.installed.provider.installedIdentityDigest;
  const attemptReference = reference(input.compiled.attempt.revision);
  const child: FoundationActivityChildCheckpointAdapterV7<
    AgentActivityPlan,
    AgentActivityCheckpoint,
    FoundationExecutionOperationCheckpointV1
  > = createFoundationActivityChildCheckpointAdapterV7({
    parent: input.adapter,
    lens: Object.freeze({
      get: (checkpoint: AgentActivityCheckpoint) => checkpoint.execution,
      set: (
        checkpoint: AgentActivityCheckpoint,
        execution: FoundationExecutionOperationCheckpointV1 | null,
      ) => Object.freeze({
        ...checkpoint,
        coordinate: execution === null
          ? null
          : Object.freeze({
              effectDigest: specification.digest,
              executableIdentity,
            }),
        execution,
      }),
      parse: (value: ControlJsonObject) => parseFoundationExecutionOperationCheckpoint({
        value,
        specification,
        backendProfile: input.compiled.installed.installed.profile,
      }),
    }),
    assertContext(context, checkpoint) {
      const support = supportFromContext(context);
      if (
        support.activityId !== input.request.activityId ||
        support.operation !== input.request.operation ||
        (checkpoint.attempt !== null && !sameRetainedReference(checkpoint.attempt, {
          id: attemptReference.id,
          revision: attemptReference.revision,
          digest: attemptReference.digest,
        })) ||
        (checkpoint.coordinate !== null && (
          checkpoint.coordinate.effectDigest !== specification.digest ||
          checkpoint.coordinate.executableIdentity !== executableIdentity
        ))
      ) fail("cell-owner-context", "Agent Cell child substituted its exact Activity checkpoint");
    },
  });
  const persistence = createFoundationActivityExecutionCheckpointPersistenceV1({
    context: input.context,
    child,
    specificationDigest: specification.digest,
  });

  const assertBinding = (binding: FoundationAgentCellPersistenceBindingV1): void =>
    assertAgentCellPersistenceBinding({
      binding,
      store: input.request.store,
      activityId: input.request.activityId,
      attempt: input.compiled.attempt.revision,
      inputSetDigest: input.compiled.input.inputSet.digest,
      specificationDigest: specification.digest,
    });

  const exactCurrent = async (
    expected: FoundationExecutionOperationCheckpointCoordinateV1 | null,
  ): Promise<FoundationRetainedExecutionOperationCheckpointV1 | null> => {
    const retained = await persistence.read(specification.digest);
    if (!sameExecutionCoordinate(retained?.coordinate ?? null, expected)) {
      fail("cell-owner-cas", "Agent Cell owner received another execution support coordinate");
    }
    return retained;
  };

  return Object.freeze({
    async read(binding) {
      assertBinding(binding);
      return await persistence.read(specification.digest);
    },
    async commitSupport(mutation) {
      assertBinding(mutation.binding);
      await exactCurrent(mutation.expected);
      return await persistence.compareExchange({
        specificationDigest: specification.digest,
        expected: mutation.expected,
        checkpoint: mutation.checkpoint,
      });
    },
    async ownerCommitDispatch(mutation) {
      assertBinding(mutation.binding);
      const current = await exactCurrent(mutation.expected);
      if (
        current === null || current.checkpoint.dispatchAuthorityConsumedAt !== null ||
        mutation.checkpoint.dispatchAuthorityConsumedAt === null ||
        canonicalJson(mutation.attempt) !== canonicalJson(input.compiled.attempt) ||
        canonicalJson(mutation.appends[0]) !== canonicalJson(input.compiled.attempt.append)
      ) fail("cell-owner-dispatch", "Agent Cell dispatch commit substituted its exact null-to-consumed boundary");
      const selected = child.current();
      const support = supportFromContext(selected.context);
      if (support.attempt !== null || support.stage !== "activity-opened") {
        fail("cell-owner-dispatch", "Agent Cell dispatch commit does not own the pre-Attempt Activity boundary");
      }
      const nextSupport: AgentOperationSupport = Object.freeze({
        ...support,
        coordinate: Object.freeze({
          effectDigest: specification.digest,
          executableIdentity,
        }),
        execution: mutation.checkpoint,
        attempt: attemptReference,
      });
      input.adapter.commit({
        mode: "ordered-appends",
        expected: selected.coordinate,
        checkpoint: checkpointPayload(nextSupport),
        appends: mutation.appends,
      });
      const retained = await persistence.read(specification.digest);
      if (
        retained === null || retained.checkpoint.digest !== mutation.checkpoint.digest ||
        canonicalJson(retained.checkpoint) !== canonicalJson(mutation.checkpoint)
      ) fail("cell-owner-dispatch", "Agent Cell dispatch commit reopened another execution checkpoint");
      return Object.freeze({
        retained,
        appends: Object.freeze([
          retainedAppendResult(input.request.store, input.request.activityId, mutation.appends[0]),
          retainedAppendResult(input.request.store, input.request.activityId, mutation.appends[1]),
        ] as const),
      });
    },
    async ownerCommitPreIntentRefusal(mutation) {
      assertBinding(mutation.binding);
      const current = await exactCurrent(mutation.expected);
      if (
        current === null || current.checkpoint.dispatchAuthorityConsumedAt !== null ||
        mutation.checkpoint.dispatchAuthorityConsumedAt !== null ||
        mutation.checkpoint.containment === null || mutation.checkpoint.observation === null
      ) fail("cell-owner-refusal", "Agent Cell refusal is not one inert pre-intent terminal checkpoint");
      const selected = child.current();
      const support = supportFromContext(selected.context);
      if (support.attempt !== null || support.stage !== "activity-opened") {
        fail("cell-owner-refusal", "Agent Cell refusal does not own the pre-Attempt Activity boundary");
      }
      const nextSupport: AgentOperationSupport = Object.freeze({
        ...support,
        coordinate: Object.freeze({
          effectDigest: specification.digest,
          executableIdentity,
        }),
        execution: mutation.checkpoint,
      });
      input.adapter.commit({
        mode: "append",
        expected: selected.coordinate,
        checkpoint: checkpointPayload(nextSupport),
        append: mutation.append,
      });
      const retained = await persistence.read(specification.digest);
      if (
        retained === null || retained.checkpoint.digest !== mutation.checkpoint.digest ||
        canonicalJson(retained.checkpoint) !== canonicalJson(mutation.checkpoint)
      ) fail("cell-owner-refusal", "Agent Cell refusal reopened another execution checkpoint");
      return Object.freeze({
        retained,
        append: retainedAppendResult(
          input.request.store,
          input.request.activityId,
          mutation.append,
        ),
      });
    },
  });
}

async function retainBuilderCandidate(input: Readonly<{
  request: FoundationAgentOperationV7Input;
  owners: AgentOperationOwners;
  support: AgentOperationSupport;
  adapter: AgentKernelAdapter;
  context: FoundationActivityKernelContextV7<AgentActivityPlan, AgentActivityCheckpoint>;
  carrier: FoundationPublishedCandidateOutputCarrierV1;
}>): Promise<Readonly<{
  context: FoundationActivityKernelContextV7<AgentActivityPlan, AgentActivityCheckpoint>;
  revision: ControlRecordRevision;
}>> {
  if (input.request.boundary === null || input.request.candidate === null) {
    fail("candidate", "Builder Candidate successor lacks its admitted Boundary or predecessor");
  }
  const attempt = retainedRevision(
    input.request.store,
    retainedAttemptReference(input.support),
    "agent-attempt",
  );
  const predecessorDigest = candidateStateDigest(input.request.candidate);
  if (predecessorDigest === null) {
    fail("candidate", "Builder Candidate predecessor lacks its exact logical state digest");
  }
  const prepared = await prepareCandidateRevisionRetention({
    store: input.request.store,
    activityId: input.request.activityId,
    observation: "builder-successor",
    candidateBaseCommit: candidateBaseCommit(input.request.candidate),
    carrierManifestBytes: input.carrier.manifestBytes,
    verifyCarrier: await input.owners.carrierVerifier({
      machineHome: input.request.configuration.machineHome,
      repository: input.request.targetRepository,
      store: input.request.store,
      boundary: input.request.boundary,
      candidate: input.request.candidate,
      predecessor: Object.freeze({ candidateDigest: predecessorDigest }),
    }),
    boundary: Object.freeze({ kind: "work-boundary", ...reference(input.request.boundary) }),
    predecessor: Object.freeze({ kind: "candidate-revision", ...reference(input.request.candidate) }),
    builderAttempt: Object.freeze({ kind: "agent-attempt", ...reference(attempt) }),
    observedAt: sampleTime(
      input.request.store,
      input.owners,
      "Builder Candidate observation time",
    ),
    runtimeId: input.support.opening.runtimeId,
  });
  const nextSupport: AgentOperationSupport = Object.freeze({
    ...input.support,
    resultCandidate: reference(prepared.expected.revision),
  });
  const committed = await commitPreparedCandidateRevisionThroughActivityV7({
    activity: input.adapter,
    expected: input.context.coordinate,
    checkpoint: checkpointPayload(nextSupport),
    prepared,
  });
  return Object.freeze({
    context: committed.context,
    revision: committed.retained.revision,
  });
}

async function revalidateAgentCellPreIntent(input: Readonly<{
  request: FoundationCommonAgentOperationV7Input;
  owners: AgentOperationOwners;
  adapter: AgentKernelAdapter;
  compiled: CompiledAgentCellOperation;
  attempt: ControlRecordRevision;
  inputSet: FoundationExecutionInputSetV1;
  specification: FoundationExecutionSpecificationV1;
}>): Promise<void> {
  let support = supportFromContext(input.adapter.current());
  assertInput(input.request, support);
  assertSupportInput(input.request, support);
  if (
    canonicalJson(input.attempt) !== canonicalJson(input.compiled.attempt.revision) ||
    canonicalJson(input.inputSet) !== canonicalJson(input.compiled.input.inputSet) ||
    canonicalJson(input.specification) !== canonicalJson(input.compiled.specification)
  ) fail("pre-intent-binding", "Agent Cell pre-intent callback substituted its exact compiled inputs");
  const reproduced = await compileAgentCellOperation({
    request: input.request,
    support,
    owners: input.owners,
  });
  if (
    canonicalJson(reproduced.attempt.revision) !== canonicalJson(input.compiled.attempt.revision) ||
    canonicalJson(reproduced.input.inputSet) !== canonicalJson(input.compiled.input.inputSet) ||
    canonicalJson(reproduced.specification) !== canonicalJson(input.compiled.specification)
  ) fail("pre-intent-binding", "Agent inputs changed before exact dispatch authority consumption");
  support = supportFromContext(input.adapter.current());
  assertInput(input.request, support);
  assertSupportInput(input.request, support);
  const common = Object.freeze({
    store: input.request.store,
    activityId: input.request.activityId,
    brief: retainedRevision(input.request.store, support.brief, "director-brief"),
    projection: input.request.projection,
  });
  if (input.request.operation === "delivery.prepare") {
    await input.request.revalidateBeforeIntent(Object.freeze({
      ...common,
      operation: "delivery.prepare" as const,
      role: "reconnaissance" as const,
      boundary: null,
      candidate: null,
      seal: null,
    }));
    return;
  }
  if (support.boundary === null || support.attemptedCandidate === null) {
    fail("pre-intent-binding", "Admitted Agent Cell lost its exact Boundary or Candidate");
  }
  await input.request.revalidateBeforeIntent(Object.freeze({
    ...common,
    operation: input.request.operation,
    role: support.role,
    boundary: retainedRevision(input.request.store, support.boundary, "work-boundary"),
    candidate: retainedRevision(
      input.request.store,
      support.attemptedCandidate,
      "candidate-revision",
    ),
    seal: support.seal === null
      ? null
      : retainedRevision(input.request.store, support.seal, "candidate-seal"),
  }));
}

async function operateCompiledAgentCell(input: Readonly<{
  request: FoundationCommonAgentOperationV7Input;
  owners: AgentOperationOwners;
  adapter: AgentKernelAdapter;
  context: FoundationActivityKernelContextV7<AgentActivityPlan, AgentActivityCheckpoint>;
  support: AgentOperationSupport;
  compiled: CompiledAgentCellOperation;
}>): Promise<FoundationAgentCellOperationResultV1> {
  if (input.support.executionSelection === null) fail("execution-selection","Agent execution lost its selected Image resource");
  assertDelegatedAgentExecution({ request: input.request, selection: input.support.executionSelection });
  const opened = await input.owners.openInstalled({
    installed: input.compiled.installed.installed,
    image:input.support.executionSelection.image,
    investment: Object.freeze({
      model: input.request.investment.model,
      reasoning: input.request.investment.reasoning,
    }),
    now: input.owners.now,
  });
  try {
    if (canonicalJson(opened.installed) !== canonicalJson(input.compiled.installed.installed)) {
      fail("installed-substitution", "Opened Agent runtime selected another installed Cell");
    }
    const activityOwner = createAgentCellActivityOwner({
      request: input.request,
      support: input.support,
      context: input.context,
      adapter: input.adapter,
      compiled: input.compiled,
    });
    const result = await opened.operate({
      store: input.request.store,
      activityId: input.request.activityId,
      attempt: input.compiled.attempt,
      compiledInput: input.compiled.input,
      installed: input.compiled.installed.installed,
      activityOwner,
      revalidateBeforeIntent: async ({ attempt, inputSet, specification }) =>
        await revalidateAgentCellPreIntent({
          request: input.request,
          owners: input.owners,
          adapter: input.adapter,
          compiled: input.compiled,
          attempt,
          inputSet,
          specification,
        }),
      validateSemanticOutput: async ({ attempt, inputSet, specification, artifact }) => {
        if (
          canonicalJson(attempt) !== canonicalJson(input.compiled.attempt.revision) ||
          canonicalJson(inputSet) !== canonicalJson(input.compiled.input.inputSet) ||
          canonicalJson(specification) !== canonicalJson(input.compiled.specification)
        ) fail("semantic-binding", "Agent final semantic validation received another Cell subject");
        const semantic = await readFoundationAgentSemanticWorkspaceV1({
          artifact,
          maximumBytes: 1024 * 1024,
        });
        let markdown: string;
        try {
          markdown = new TextDecoder("utf-8", { fatal: true }).decode(semantic.bytes);
        } catch {
          return Object.freeze({ disposition: "invalid" as const });
        }
        const validation = validateAgentWorkProductSemanticMarkdown(
          input.compiled.validationBasis,
          markdown,
        );
        return Object.freeze({
          disposition: validation.status === "valid" ? "valid" as const : "invalid" as const,
        });
      },
    });
    if (
      canonicalJson(result.specification) !== canonicalJson(input.compiled.specification) ||
      canonicalJson(result.inputSet) !== canonicalJson(input.compiled.input.inputSet)
    ) fail("cell-result-binding", "Agent Cell returned another Specification or Input Set");
    if (!result.preIntentRefused && result.receiptFacts.provider === null) {
      fail(
        "provider-terminal-observation",
        "Dispatched Agent Cell did not return its trusted provider terminal observation",
      );
    }
    return result;
  } finally {
    opened.close();
  }
}

function assertTerminalCellResult(
  support: AgentOperationSupport,
  result: FoundationAgentCellOperationResultV1,
): void {
  if (result.preIntentRefused) {
    fail("cell-result-binding", "Pre-intent refusal cannot be validated as dispatched Cell output");
  }
  const execution = support.execution;
  const coordinate = retainedCellCoordinate(support);
  const terminalStage = support.stage === "effect-intended" ||
    support.stage === "effect-observed" || support.stage === "workspace-observed" ||
    support.stage === "candidate-observed";
  if (
    !terminalStage || execution === null || execution.handle === null ||
    execution.dispatchAuthorityConsumedAt === null || execution.observation === null ||
    execution.containment === null || execution.output === null || execution.retirement === null ||
    execution.specificationDigest !== result.specification.digest ||
    coordinate.effectDigest !== result.specification.digest ||
    execution.observation.digest !== result.terminal.observationDigest ||
    execution.containment.digest !== result.terminal.containmentDigest ||
    execution.output.digest !== result.terminal.outputDigest ||
    execution.output.validation !== result.terminal.outputValidation ||
    execution.retirement.digest !== result.terminal.retirementDigest ||
    execution.retirement.reclamationObligation.digest !==
      result.terminal.reclamationObligationDigest ||
    result.receiptFacts.execution.specificationDigest !== result.specification.digest ||
    result.receiptFacts.execution.observationDigest !== execution.observation.digest ||
    result.receiptFacts.containment.factsDigest !== execution.containment.digest ||
    result.receiptFacts.retirement.factsDigest !== execution.retirement.digest ||
    result.receiptFacts.retirement.residualFactsDigest !==
      execution.retirement.reclamationObligation.digest
  ) {
    fail(
      "cell-result-binding",
      "Agent Cell result does not reproduce its exact consumed, contained, retired Activity checkpoint",
    );
  }
}

function assertTerminalPreIntentRefusal(
  support: AgentOperationSupport,
  result: FoundationAgentCellOperationResultV1,
): void {
  const execution = support.execution;
  const coordinate = retainedCellCoordinate(support);
  if (
    !result.preIntentRefused || support.stage !== "pre-intent-refused" ||
    support.attempt !== null || execution === null || execution.handle === null ||
    execution.dispatchAuthorityConsumedAt !== null ||
    execution.observation === null ||
    (execution.containmentRequestedAt === null && (
      execution.observation.allocationState !== "absent" ||
      execution.observation.dispatchState !== "not-observed" ||
      execution.observation.processState !== "not-observed" ||
      execution.observation.terminal !== null ||
      execution.observation.output.disposition !== "not-produced" ||
      !executionObservationEstablishesContainment(execution.observation, false)
    )) ||
    execution.containment === null || execution.output === null || execution.retirement === null ||
    execution.output.validation !== "not-applicable" ||
    execution.retirement.dispatchAuthorityConsumed !== false ||
    coordinate.effectDigest !== result.specification.digest ||
    execution.specificationDigest !== result.specification.digest ||
    execution.observation.digest !== result.terminal.observationDigest ||
    execution.containment.digest !== result.terminal.containmentDigest ||
    execution.output.digest !== result.terminal.outputDigest ||
    execution.retirement.digest !== result.terminal.retirementDigest ||
    execution.retirement.reclamationObligation.digest !==
      result.terminal.reclamationObligationDigest ||
    result.terminal.outputValidation !== "not-applicable" ||
    result.validatedOutput !== null || result.providerResult !== null ||
    result.receiptFacts.provider !== null ||
    result.receiptFacts.execution.specificationDigest !== result.specification.digest ||
    result.receiptFacts.execution.observationDigest !== execution.observation.digest ||
    result.receiptFacts.execution.output.availability !== "not-produced" ||
    result.receiptFacts.containment.factsDigest !== execution.containment.digest ||
    result.receiptFacts.retirement.factsDigest !== execution.retirement.digest ||
    result.receiptFacts.retirement.residualFactsDigest !==
      execution.retirement.reclamationObligation.digest
  ) {
    fail(
      "pre-intent-refusal",
      "Agent refusal did not reach its exact contained, retired, reclamation-bound Cell checkpoint",
    );
  }
}

function hasOnlyUnallocatedExecution(support: AgentOperationSupport): boolean {
  const execution = support.execution;
  return support.attempt === null && support.executionSelection !== null &&
    support.coordinate !== null && execution !== null &&
    support.coordinate.effectDigest === execution.specificationDigest &&
    execution.handle === null && execution.dispatchAuthorityConsumedAt === null &&
    execution.containmentRequestedAt === null && execution.observation === null &&
    execution.containment === null && execution.terminalCompletion === null &&
    execution.output === null && execution.retirement === null &&
    support.finalization === null && support.receipt === null && support.roleCheckpoint === null;
}

function controlResults(
  store: ControlRecordStore,
  revisions: readonly ControlRecordRevision[],
): readonly RevisionReference[] {
  const result: RevisionReference[] = [];
  const seen = new Set<string>();
  for (const revision of revisions) {
    const retained = store.getRevision(revision.recordId, revision.revision);
    if (retained === null || retained.digest !== revision.digest) {
      fail("role-control", "Role finalizer returned an unretained Control revision");
    }
    const key = `${revision.recordId}\0${revision.revision}\0${revision.digest}`;
    if (seen.has(key)) fail("role-control", "Role finalizer repeats one Control revision");
    seen.add(key);
    result.push(reference(revision));
  }
  return Object.freeze(result);
}

async function advance(input: Readonly<{
  request: FoundationCommonAgentOperationV7Input;
  owners: AgentOperationOwners;
  context: FoundationActivityKernelContextV7<AgentActivityPlan, AgentActivityCheckpoint>;
}>): Promise<FoundationCommonAgentOperationV7Result> {
  const store = input.request.store;
  const adapter = agentKernelAdapter(
    store,
    input.request.activityId,
    input.request.operation,
  );
  let kernelContext = input.context;
  let support = supportFromContext(kernelContext);
  if (support.stage === "evaluation-opened") {
    fail(
      "evaluation-preparation",
      "Evaluation opening must be promoted after its exact Seal and final Checks are retained",
    );
  }
  const finishRefusal = (): never => {
    const refusal = retainedPreIntentRefusal(store, input.request.activityId);
    finishFoundationActivityKernelV7({
      store,
      activityId: input.request.activityId,
      definition: definitionFor(input.request.operation),
      runtimeId: support.opening.runtimeId,
      outcome: "abandoned",
      sampleCompletedAt: () => sampleTime(
        store,
        input.owners,
        "Pre-intent refusal completion time",
      ),
    });
    throw new FoundationError(
      refusal.diagnosticCode,
      "Agent activity was abandoned at its retained pre-intent refusal",
      { retryable: true, observedFacts: { refusalFactsDigest: refusal.refusalFactsDigest } },
    );
  };
  assertSupportInput(input.request, support);
  // A lost refusal/completion response resumes the retained subjectless event,
  // never another allocation attempt or a replacement execution selection.
  if (support.stage === "pre-intent-refused" && hasOnlyUnallocatedExecution(support)) {
    finishRefusal();
  }
  let cellResult: FoundationAgentCellOperationResultV1 | null = null;
  let compiled: CompiledAgentCellOperation | null = null;
  if (support.stage !== "receipt-retained") {
    if (support.executionSelection === null) {
      if (support.execution !== null || support.attempt !== null) fail("execution-selection","Recovery cannot replace a missing allocated execution selection");
      const executionSelection = selectAgentExecution({ request: input.request, owners: input.owners });
      assertDelegatedAgentExecution({ request: input.request, selection: executionSelection });
      const nextSupport = Object.freeze({...support,executionSelection});
      kernelContext = adapter.commit({mode:"support-only",expected:kernelContext.coordinate,checkpoint:checkpointPayload(nextSupport)}).context;
      support = supportFromContext(kernelContext);
    }
    compiled = await compileAgentCellOperation({
      request: input.request,
      support,
      owners: input.owners,
    });
    assertRetainedAttempt(store, support, compiled);
    try {
      cellResult = await operateCompiledAgentCell({
        request: input.request,
        owners: input.owners,
        adapter,
        context: kernelContext,
        support,
        compiled,
      });
    } catch (error) {
      const refusal = foundationUnallocatedExecutionRefusalV1(error);
      if (refusal === null) throw error;
      kernelContext = adapter.current();
      support = supportFromContext(kernelContext);
      if (support.stage !== "activity-opened" || !hasOnlyUnallocatedExecution(support) ||
          support.execution!.specificationDigest !== compiled.specification.digest ||
          refusal.specificationDigest !== compiled.specification.digest ||
          refusal.allocationKeyDigest !== foundationExecutionAllocationKeyBindingDigest(support.execution!.allocationKey)) {
        throw error;
      }
      const retained = commitMilestone({
        adapter,
        context: kernelContext,
        support,
        append: compileAgentPreIntentRefusalAppend({
          store,
          activityId: input.request.activityId,
          runtimeId: support.opening.runtimeId,
          refusedAt: sampleTime(store, input.owners, "Unallocated image refusal time"),
          diagnosticCode: refusal.diagnosticCode,
          refusalFactsDigest: refusal.refusalFactsDigest,
          resolution: "none",
        }),
      });
      kernelContext = retained.context;
      support = retained.support;
      return finishRefusal();
    }
    kernelContext = adapter.current();
    support = supportFromContext(kernelContext);
    if (cellResult.preIntentRefused) {
      if (support.stage !== "pre-intent-refused" || support.attempt !== null) {
        fail("pre-intent-refusal", "Agent Cell refusal did not retain its exact subjectless boundary");
      }
      assertTerminalPreIntentRefusal(support, cellResult);
      finishRefusal();
    }
    assertTerminalCellResult(support, cellResult);
    assertRetainedAttempt(store, support, compiled);
  }

  if (support.stage === "attempt-retained") {
    fail(
      "pre-intent-split",
      "Agent Attempt cannot be retained separately from atomic dispatch-authority consumption",
    );
  }
  if (cellResult !== null && support.stage === "effect-intended") {
    const provider = cellResult.receiptFacts.provider;
    if (provider === null) {
      fail("provider-terminal-observation", "Dispatched Agent Cell lacks trusted provider facts");
    }
    const coordinate = retainedCellCoordinate(support);
    const observed = commitMilestone({
      adapter,
      context: kernelContext,
      append: compileProviderEffectObservationAppend({
        store,
        activityId: input.request.activityId,
        effectDigest: coordinate.effectDigest,
        outcome: providerOutcome(provider),
        observedAt: sampleTime(store, input.owners, "Provider effect observation time"),
        runtimeId: support.opening.runtimeId,
      }),
      support,
    });
    kernelContext = observed.context;
    support = observed.support;
  }

  if (cellResult !== null && support.stage === "effect-observed") {
    const provider = cellResult.receiptFacts.provider;
    if (provider === null || compiled === null) {
      fail("provider-terminal-observation", "Work Product finalization lacks exact Agent Cell facts");
    }
    const finalization = await finalizeCellWorkProduct({
      store,
      activityId: input.request.activityId,
      attempt: retainedRevision(store, retainedAttemptReference(support), "agent-attempt"),
      providerInput: input.request.providerInput,
      propositionSet: input.request.propositionSet,
      provider,
      result: cellResult,
      owners: input.owners,
      agentId: support.opening.agentId,
      runtimeId: support.opening.runtimeId,
    });
    const replaced = replaceSupport(adapter, kernelContext, Object.freeze({
      ...support,
      finalization,
    }));
    kernelContext = replaced.context;
    support = replaced.support;
  }

  if (
    cellResult !== null && support.stage === "workspace-observed" &&
    input.request.operation === "delivery.continue" &&
    cellResult.candidate.disposition === "valid" && support.candidateRejection === null
  ) {
    try {
      const candidate = await retainBuilderCandidate({
        request: input.request,
        owners: input.owners,
        support,
        adapter,
        context: kernelContext,
        carrier: cellResult.candidate.carrier,
      });
      kernelContext = candidate.context;
      support = supportFromContext(candidate.context);
    } catch (error) {
      const rejected = candidateOutputRejectionV1(error);
      if (rejected === null) throw error;
      if (input.request.candidate === null ||
          rejected.manifestFileDigest !== sha256Bytes(cellResult.candidate.carrier.manifestBytes) ||
          rejected.candidateTree !== cellResult.candidate.carrier.rootTree ||
          rejected.applicationBaseCommit !== candidateBaseCommit(input.request.candidate)) {
        fail("candidate", "Candidate owner rejection substituted its exact attempted subjects");
      }
      const retained = replaceSupport(adapter, kernelContext, Object.freeze({ ...support, candidateRejection: rejected }));
      kernelContext = retained.context;
      support = retained.support;
    }
  }

  if (
    cellResult !== null &&
    (support.stage === "workspace-observed" || support.stage === "candidate-observed")
  ) {
    if (support.finalization === null || compiled === null) {
      fail("operation-support", "Receipt finalization lacks exact Agent Cell workspace facts");
    }
    const provider = cellResult.receiptFacts.provider;
    if (provider === null) {
      fail("provider-terminal-observation", "Receipt finalization lacks trusted provider facts");
    }
    const existing = optionalSubject(
      store,
      input.request.activityId,
      "execution-receipt-recorded",
      "execution-receipt",
    );
    const receipt = await input.owners.retainReceipt({
      store,
      activityId: input.request.activityId,
      provider,
      submissionTrigger: support.finalization.submissionTrigger,
      execution: cellResult.receiptFacts.execution,
      workspace: support.finalization.workspace,
      candidateSuccessorDisposition: candidateSuccessorDisposition(support, cellResult),
      rawMaterials: (() => {
        const materials: ExecutionReceiptRawMaterial[] = [];
        if (cellResult.providerFailureDiagnostic.disposition === "available") {
          materials.push(compileExecutionReceiptProviderFailureMaterial({
            store, bytes: cellResult.providerFailureDiagnostic.bytes,
            createdAt: support.execution!.retirement!.retiredAt,
          }));
        } else if (cellResult.providerFailureDiagnostic.disposition === "invalid") {
          materials.push(Object.freeze({ availability: "not-retained" as const,
            purpose: "raw-provider-output" }));
        }
        if (support.candidateRejection !== null) {
          if (input.request.boundary === null || input.request.candidate === null || cellResult.candidate.disposition !== "valid") {
            fail("candidate", "Retained repair output lost its exact builder input");
          }
          materials.push(...compileFoundationBuilderRepairOutputV1({ store, attempt: retainedRevision(store, retainedAttemptReference(support), "agent-attempt"),
            boundary: input.request.boundary, candidate: input.request.candidate,
            rejection: support.candidateRejection, manifestBytes: cellResult.candidate.carrier.manifestBytes,
            createdAt: support.execution!.retirement!.retiredAt,
          }));
        }
        return Object.freeze(materials);
      })(),
      containment: cellResult.receiptFacts.containment,
      retirement: cellResult.receiptFacts.retirement,
      runtime: runtimeCoordinates(support.opening.runtimeId, input.request.operation),
      recordedAt: existing?.createdAt ??
        sampleTime(store, input.owners, "Execution Receipt time"),
      runtimeId: support.opening.runtimeId,
    });
    if (existing !== null && existing.digest !== receipt.revision.digest) {
      fail("receipt", "Recovered Execution Receipt differs from its exact retained revision");
    }
    const replaced = replaceSupport(adapter, kernelContext, Object.freeze({
      ...support,
      receipt: reference(receipt.revision),
    }));
    kernelContext = replaced.context;
    support = replaced.support;
  }

  if (support.stage !== "receipt-retained" || support.finalization === null || support.receipt === null) {
    fail("operation-support", "Agent operation did not reach exact Receipt finalization");
  }
  const attemptedCandidate = support.attemptedCandidate === null
    ? null
    : retainedRevision(store, support.attemptedCandidate, "candidate-revision");
  const resultCandidate = support.resultCandidate === null
    ? attemptedCandidate
    : retainedRevision(store, support.resultCandidate, "candidate-revision");
  const workProduct = support.finalization.workProduct === null
    ? null
    : retainedRevision(store, support.finalization.workProduct, "agent-work-product");
  const refreshRoleSupport = (): void => {
    kernelContext = adapter.current();
    support = supportFromContext(kernelContext);
  };
  const roleSupport = createFoundationAgentRoleCheckpointAdapterV7({
    store,
    activityId: input.request.activityId,
    operation: input.request.operation,
    scope: "role-finalization",
    parseCheckpoint: (value) => value,
  });
  const commonFinalization = Object.freeze({
    store,
    activityId: input.request.activityId,
    brief: retainedRevision(store, support.brief, "director-brief"),
    attempt: retainedRevision(store, retainedAttemptReference(support), "agent-attempt"),
    workProduct,
    receipt: retainedRevision(store, support.receipt, "execution-receipt"),
    support: roleSupport,
  });
  const finalized = input.request.operation === "delivery.prepare"
    ? await input.request.finalizeRoleControl(Object.freeze({
        ...commonFinalization,
        operation: "delivery.prepare",
        role: "reconnaissance",
        boundary: null,
        attemptedCandidate: null,
        resultCandidate: null,
        seal: null,
      }))
    : await (() => {
        if (support.boundary === null || attemptedCandidate === null || resultCandidate === null) {
          fail("operation-support", "Admitted role finalization lost its Boundary or Candidate subject");
        }
        const admitted = Object.freeze({
          ...commonFinalization,
          boundary: retainedRevision(store, support.boundary, "work-boundary"),
          attemptedCandidate, resultCandidate,
        });
        if (input.request.operation === "delivery.evaluate") {
          if (support.role !== "reviewer" || support.seal === null) fail("operation-support", "Review finalization lost its exact role or Seal");
          return input.request.finalizeRoleControl(Object.freeze({...admitted,
            operation:"delivery.evaluate",role:"reviewer",seal:retainedRevision(store,support.seal,"candidate-seal")}));
        }
        if (support.seal !== null) fail("operation-support", "Non-review finalization cannot select an Attempt Seal");
        if (input.request.operation === "delivery.continue") {
          if (support.role !== "builder") fail("operation-support", "Candidate finalization lost its builder role");
          return input.request.finalizeRoleControl(Object.freeze({...admitted,operation:"delivery.continue",role:"builder",seal:null}));
        }
        if (support.role !== "reconnaissance") fail("operation-support", "Boundary resolution lost its reconnaissance role");
        return input.request.finalizeRoleControl(Object.freeze({...admitted,operation:input.request.operation,role:"reconnaissance",seal:null}));
      })();
  refreshRoleSupport();
  if (support.roleCheckpoint !== null) {
    fail("role-support", "Role finalization cannot complete with retained recovery work outstanding");
  }
  const controls = controlResults(store, finalized.controls ?? Object.freeze([]));
  const current = activity(store, input.request.activityId);
  const directBuilderCompletion =
    current.operation === "delivery.continue" && workProduct !== null &&
    current.recovery?.kind === "finalization" &&
    current.recovery.resumesAt === "activity-finalization";
  const deterministicBoundaryRefusal =
    finalized.outcome !== "completed" &&
    (
      current.operation === "delivery.prepare" || current.operation === "delivery.revise" ||
      current.operation === "delivery.reaffirm"
    ) &&
    current.recovery?.kind === "finalization" &&
    current.recovery.resumesAt === "work-boundary-finalized";
  if (
    !directBuilderCompletion && !deterministicBoundaryRefusal && (
      current.recovery?.kind !== "finalization" ||
      current.recovery.resumesAt !== "activity-completed"
    )
  ) {
    fail("role-control", "Role finalization did not reach the exact activity-completion boundary", {
      resumesAt: current.recovery?.resumesAt ?? null,
    });
  }
  finishFoundationActivityKernelV7({
    store,
    activityId: input.request.activityId,
    definition: definitionFor(input.request.operation),
    runtimeId: support.opening.runtimeId,
    outcome: finalized.outcome,
    sampleCompletedAt: () => sampleTime(store, input.owners, "Agent activity completion time"),
  });
  const commonResult = Object.freeze({
    activityId: input.request.activityId,
    outcome: finalized.outcome,
    attempt: retainedAttemptReference(support),
    workProduct: support.finalization.workProduct,
    receipt: support.receipt,
    controls,
  });
  if (input.request.operation === "delivery.prepare") {
    if (resultCandidate !== null) fail("candidate", "Preparation manufactured a Candidate result");
    return Object.freeze({ ...commonResult, operation: "delivery.prepare", candidate: null });
  }
  if (resultCandidate === null) fail("candidate", "Admitted Agent operation lost its Candidate result");
  return Object.freeze({
    ...commonResult,
    operation: input.request.operation,
    candidate: reference(resultCandidate),
  });
}

function retainedContextAt(
  store: ControlRecordStore,
  activityId: string,
  operation: FoundationAgentOperationV7,
  expected: ControlRecordOperationSupportCoordinate,
): FoundationActivityKernelContextV7<AgentActivityPlan, AgentActivityCheckpoint> {
  const retained = readAgentContext(store, activityId, operation);
  if (
    retained.coordinate.generation !== expected.generation ||
    retained.coordinate.payloadDigest !== expected.payloadDigest
  ) fail("operation-support", "Agent operation support coordinate was substituted");
  return retained;
}

/**
 * Promote the same immutable evaluation support row only after the evaluation
 * owner has retained the exact Seal and final Checks. This CAS freezes the
 * reviewer Attempt time and complete path-free Agent plan; it creates no
 * Control record and cannot manufacture evaluation facts.
 */
export function promoteFoundationReviewAgentActivityV7(
  input: FoundationAgentOperationV7Input & Readonly<{ operation: "delivery.evaluate" }>,
  expected: ControlRecordOperationSupportCoordinate,
): FoundationActivityKernelContextV7<AgentActivityPlan, AgentActivityCheckpoint>["support"] {
  const context = retainedContextAt(
    input.store,
    input.activityId,
    "delivery.evaluate",
    expected,
  );
  const support = supportFromContext(context);
  if (
    support.operation !== "delivery.evaluate" || support.role !== "reviewer" ||
    support.stage !== "evaluation-opened" || support.plan !== null || support.seal !== null ||
    support.roleCheckpoint !== null
  ) fail("evaluation-promotion", "Only the exact pre-review opening can become a reviewer Agent plan");
  const seal = input.seal ?? null;
  if (seal === null) fail("evaluation-promotion", "Reviewer promotion requires the retained Candidate Seal");
  const plan = operationPlan(input, digestCanonical(input.store.state()));
  const journalHead = input.store.listEvents(
    Math.max(0, input.store.state().journal.eventCount - 1),
    1,
  )[0] ?? null;
  if (journalHead !== null && Date.parse(plan.attemptCreatedAt) < Date.parse(journalHead.occurredAt)) {
    fail("evaluation-promotion", "Reviewer Attempt time precedes retained evaluation preparation");
  }
  const promoted: AgentOperationSupport = Object.freeze({
    ...support,
    seal: reference(seal),
    plan,
    promotedExecutionPlan: plan,
  });
  assertInput(input, promoted);
  assertSupportInput(input, promoted);
  const updated = agentKernelAdapter(
    input.store,
    input.activityId,
    "delivery.evaluate",
  ).commit({
    mode: "support-only",
    expected,
    checkpoint: checkpointPayload(promoted),
  });
  const retained = supportFromContext(updated.context);
  if (retained.stage !== "activity-opened" || retained.plan === null) {
    fail("evaluation-promotion", "Reviewer promotion did not retain its exact Agent checkpoint");
  }
  return updated.context.support;
}

/** Advance only an already-promoted reviewer support coordinate. */
export async function advancePromotedFoundationReviewAgentActivityV7(
  input: FoundationAgentOperationV7Input & Readonly<{ operation: "delivery.evaluate" }>,
  expected: ControlRecordOperationSupportCoordinate,
  options: FoundationAgentOperationV7Options = {},
): Promise<FoundationAgentOperationV7Result> {
  const owners = operationOwners(options);
  const context = retainedContextAt(
    input.store,
    input.activityId,
    "delivery.evaluate",
    expected,
  );
  const support = supportFromContext(context);
  if (support.operation !== "delivery.evaluate" || support.stage === "evaluation-opened") {
    fail("evaluation-promotion", "Reviewer advancement requires one exact promoted Agent plan");
  }
  assertInput(input, support);
  const result = await advance({ request: input, owners, context });
  if (result.operation === "delivery.prepare") {
    fail("evaluation-promotion", "Reviewer advancement returned a preparation result");
  }
  return result;
}

/**
 * Atomically open one independently funded Agent activity and its path-free
 * planning checkpoint, then advance only that exact plan. No provider dispatch
 * API is present in this owner.
 */
export function operateFoundationAgentActivityV7(
  input: FoundationPreparationAgentOperationV7Input,
  options?: FoundationAgentOperationV7Options,
): Promise<FoundationPreparationAgentOperationV7Result>;
export function operateFoundationAgentActivityV7(
  input: FoundationAgentOperationV7Input,
  options?: FoundationAgentOperationV7Options,
): Promise<FoundationAgentOperationV7Result>;
export async function operateFoundationAgentActivityV7(
  input: FoundationCommonAgentOperationV7Input,
  options: FoundationAgentOperationV7Options = {},
): Promise<FoundationCommonAgentOperationV7Result> {
  openFoundationAgentActivityV7(input);
  return await advance({ request: input, owners: operationOwners(options), context: readAgentContext(input.store, input.activityId, input.operation) });
}

/** Retain an Agent opening without allocating or advancing execution. */
export function openFoundationAgentActivityV7(input: FoundationCommonAgentOperationV7Input): void {
  if (input.operation === "delivery.evaluate") {
    fail(
      "evaluation-opening",
      "Evaluation must open before sealing and promote that same support after final Checks",
    );
  }
  const role = assertInput(input);
  const opening = compileRequestedAgentActivityOpening({
    store: input.store,
    activityId: input.activityId,
    operation: input.operation,
    semanticMarkdown: input.opening.semanticMarkdown,
    submittedAt: input.opening.submittedAt,
    startedAt: input.opening.startedAt,
    directorId: input.opening.directorId,
    runtimeId: input.runtimeId,
    ...(input.opening.reservation === undefined ? {} : { reservation: input.opening.reservation }),
  });
  const plan = operationPlan(input, prospectivePreDispatchStateDigest(input.store, opening));
  const openingFacts = operationOpeningFacts(input, opening);
  const activityPlan: AgentActivityPlan = Object.freeze({
    schema: FOUNDATION_AGENT_ACTIVITY_V7_PLAN_SCHEMA,
    role,
    brief: reference(opening.revision),
    boundary: input.boundary === null ? null : reference(input.boundary),
    attemptedCandidate: input.candidate === null ? null : reference(input.candidate),
    opening: openingFacts,
    executionPlan: plan,
  });
  const checkpoint: AgentActivityCheckpoint = Object.freeze({
    schema: FOUNDATION_AGENT_ACTIVITY_V7_CHECKPOINT_SCHEMA,
    coordinate: null,
    execution: null,
    executionSelection: null,
    attempt: null,
    seal: input.seal === undefined || input.seal === null ? null : reference(input.seal),
    promotedExecutionPlan: null,
    finalization: null,
    resultCandidate: null,
    candidateRejection: null,
    receipt: null,
    roleCheckpoint: null,
  });
  openFoundationActivityKernelV7({
    store: input.store,
    activityId: input.activityId,
    definition: definitionFor(input.operation),
    plan: activityPlan,
    checkpoint,
    appends: opening.appends,
  });
  if (digestCanonical(input.store.state()) !== plan.preDispatchStateDigest) {
    fail("opening-state", "Atomic Agent opening does not reproduce its frozen reducer coordinate");
  }
}

/** Continue a staged preparation opening without manufacturing a recovery invocation. */
export async function advanceFoundationPreparationAgentActivityV7(input: FoundationPreparationAgentOperationV7Input, options: FoundationAgentOperationV7Options = {}): Promise<FoundationPreparationAgentOperationV7Result> {
  const context = readAgentContext(input.store, input.activityId, input.operation);
  assertInput(input, supportFromContext(context));
  const result = await advance({ request: input, owners: operationOwners(options), context });
  if (result.operation !== "delivery.prepare") fail("operation", "Preparation returned another operation");
  return result;
}


/** Resume only the exact retained Agent operation; this path has no redispatch primitive. */
export function recoverFoundationAgentActivityV7(
  input: FoundationPreparationAgentOperationV7Input,
  options?: FoundationAgentOperationV7Options,
): Promise<FoundationPreparationAgentOperationV7Result>;
export function recoverFoundationAgentActivityV7(
  input: FoundationAgentOperationV7Input,
  options?: FoundationAgentOperationV7Options,
): Promise<FoundationAgentOperationV7Result>;
export async function recoverFoundationAgentActivityV7(
  input: FoundationCommonAgentOperationV7Input,
  options: FoundationAgentOperationV7Options = {},
): Promise<FoundationCommonAgentOperationV7Result> {
  const owners = operationOwners(options);
  const context = readAgentContext(input.store, input.activityId, input.operation);
  const support = supportFromContext(context);
  if (support.stage === "evaluation-opened") {
    fail(
      "evaluation-preparation",
      "Pre-review evaluation recovery belongs to the Seal and final-Checks owner",
    );
  }
  assertInput(input, support);
  return await recoverFoundationActivityKernelV7({
    store: input.store,
    activityId: input.activityId,
    definition: definitionFor(input.operation),
    runtimeId: input.runtimeId,
    now: () => support.stage === "activity-opened" && support.plan !== null
      ? support.plan.attemptCreatedAt
      : sampleTime(input.store, owners, "Agent operation recovery time"),
    resume: async ({ context: retained }) => Object.freeze({
      status: "settled" as const,
      value: await advance({ request: input, owners, context: retained }),
    }),
  });
}

/** Conclude a measured reviewer refusal only after prior Check child custody is clear. */
export function settleFoundationUnallocatedBuilderV7(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  runtimeId: string;
  opening: FoundationAgentOperationOpeningV7;
  refusal: FoundationMandatoryProjectionRefusalV1;
  now(): string;
}>): never {
  // Reuse the actual reducer and append compilers over the prospective course.
  // No Activity or private execution support becomes observable before the one commit.
  const events: ControlRecordEvent[] = [];
  const revisions = new Map<string, ControlRecordRevision>();
  const getRevision = (id: string, revision: number) => revisions.get(`${id}\0${revision}`) ?? input.store.getRevision(id, revision);
  const replay = createDeliveryReplay(({ recordId, revision }) => getRevision(recordId, revision));
  const head = input.store.state().journal;
  while (events.length < head.eventCount) {
    const page = input.store.listEvents(events.at(-1)?.sequence ?? 0, Math.min(1_000, head.eventCount - events.length));
    if (page.length === 0) fail("pre-intent-refusal", "Builder refusal cannot reopen its exact Journal prefix");
    for (const event of page) { replay.append(event); events.push(event); }
  }
  if (replay.finish().journal.headDigest !== head.headDigest) fail("pre-intent-refusal", "Builder refusal Journal prefix changed");
  const view: ControlActivityReadView = { identity: input.store.identity, state: () => replay.finish(), getRevision,
    listEvents: (after = 0, limit = 1_000) => events.filter(({ sequence }) => sequence > after).slice(0, limit) };
  const appends: ControlRecordStoreAppend[] = [];
  const eventFor = (append: ControlRecordStoreAppend) => compileControlRecordEvent({ storeId: input.store.identity.storeId,
    processId: input.store.identity.processId, sequence: events.length + 1, predecessorDigest: events.at(-1)?.digest ?? null, event: append.event });
  const preview = (append: ControlRecordStoreAppend) => {
    if (append.revision != null) {
      const revision = compileControlRecordRevision(input.store.identity.processId, append.revision);
      revisions.set(`${revision.recordId}\0${revision.revision}`, revision);
    }
    const event = eventFor(append);
    replay.append(event); events.push(event); appends.push(append);
  };
  const opening = compileRequestedAgentActivityOpening({ store: input.store, activityId: input.activityId, operation: "delivery.continue",
    runtimeId: input.runtimeId, directorId: input.opening.directorId, semanticMarkdown: input.opening.semanticMarkdown,
    submittedAt: input.opening.submittedAt, startedAt: input.opening.startedAt,
    ...(input.opening.reservation === undefined ? {} : { reservation: input.opening.reservation }) });
  for (const append of opening.appends) preview(append);
  const refusedAt = controlTimestamp(input.now(), "Builder compilation refusal time");
  const refusal = compileAgentPreIntentRefusalAppend({ store: view, activityId: input.activityId, runtimeId: input.runtimeId,
    refusedAt, diagnosticCode: input.refusal.error.code, refusalFactsDigest: input.refusal.refusalFactsDigest, resolution: "projection-condition-required" });
  const condition = prepareProjectionMaterialConditionV1({ store: view, activityId: input.activityId, runtimeId: input.runtimeId,
    frozenAt: refusedAt, refusal: input.refusal, refusalEvent: eventFor(refusal) });
  preview(refusal);
  preview(condition.append);
  preview(compileDeliveryActivityCompletionAppend({ store: view, activityId: input.activityId, runtimeId: input.runtimeId,
    outcome: "abandoned", completedAt: controlTimestamp(input.now(), "Builder refusal completion time") }));
  input.store.appendBatch(Object.freeze(appends));
  throw new FoundationError(input.refusal.error.code, "Builder compilation was refused and its exact Material Condition requires boundary resolution", {
    operationalStateChanged: true, observedFacts: { refusalFactsDigest: input.refusal.refusalFactsDigest },
  });
}

/** Conclude a measured reviewer refusal only after prior Check child custody is clear. */
export function settleFoundationUnallocatedReviewV7(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  runtimeId: string;
  refusal: FoundationMandatoryProjectionRefusalV1 | null;
  now(): string;
}>): never {
  const context = readAgentContext(input.store, input.activityId, "delivery.evaluate");
  const support = supportFromContext(context);
  if (support.plan !== null || support.attempt !== null || support.execution !== null ||
      support.roleCheckpoint !== null || support.receipt !== null ||
      support.opening.runtimeId !== input.runtimeId) {
    fail("pre-intent-refusal", "Unallocated review settlement requires no Agent execution and no outstanding Check child custody");
  }
  if (support.stage === "evaluation-opened") {
    if (input.refusal === null) fail("pre-intent-refusal", "Fresh review settlement requires the exact measured compiler refusal");
    const refusedAt = controlTimestamp(input.now(), "Reviewer compilation refusal time");
    const append = compileAgentPreIntentRefusalAppend({
      store: input.store, activityId: input.activityId, runtimeId: input.runtimeId, refusedAt,
      diagnosticCode: input.refusal.error.code, refusalFactsDigest: input.refusal.refusalFactsDigest, resolution: "projection-condition-required",
    });
    const state = input.store.state();
    const refusalEvent = compileControlRecordEvent({
      storeId: input.store.identity.storeId, processId: input.store.identity.processId,
      sequence: state.journal.eventCount + 1, predecessorDigest: state.journal.headDigest,
      event: append.event,
    });
    const condition = prepareProjectionMaterialConditionV1({
      store: input.store, activityId: input.activityId, runtimeId: input.runtimeId,
      refusal: input.refusal, refusalEvent, frozenAt: refusedAt,
    });
    input.store.appendBatch(Object.freeze([append, condition.append]));
  } else if (support.stage !== "pre-intent-refused" || input.store.state().subjects.materialCondition === null) {
    fail("pre-intent-refusal", "Review refusal continuation lacks its exact frozen compilation Condition");
  }
  const refusal = retainedPreIntentRefusal(input.store, input.activityId);
  finishFoundationActivityKernelV7({
    store: input.store, activityId: input.activityId, runtimeId: input.runtimeId,
    definition: definitionFor("delivery.evaluate"), outcome: "abandoned", sampleCompletedAt: input.now,
  });
  throw new FoundationError(refusal.diagnosticCode, "Reviewer compilation was refused and its exact Material Condition requires boundary resolution", {
    observedFacts: { refusalFactsDigest: refusal.refusalFactsDigest },
  });
}
