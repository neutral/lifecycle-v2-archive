import { FoundationSemanticMarkdownSchema } from "@neutral/lifecycle-protocol";
import type { ProviderInputV4Capability, ProviderInputV4 } from "../attempt/provider-input-v4.js";
import { compileProviderInputV4 } from "../attempt/provider-input-v4.js";
import type { AgentAttemptInvestment, AgentAttemptRole } from "../control/agent-attempt.js";
import {
  agentWorkProductCompilerProfileDigest,
  agentWorkProductParserProfileDigest,
  FOUNDATION_AGENT_WORK_PRODUCT_COMPILER_PROFILE_ID,
  FOUNDATION_AGENT_WORK_PRODUCT_PARSER_PROFILE_ID,
} from "../control/agent-work-product-semantics.js";
import { normalizeSemanticMarkdown, controlIdentifier } from "../control/model.js";
import { assertDeliveryControlRecordPayload } from "../control/payload-registry.js";
import type { ControlRecordStore } from "../control/store.js";
import type {
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordEvent,
  ControlRecordRelationshipTarget,
  ControlRecordRevision,
} from "../control/types.js";
import { FOUNDATION_SPECIFICATION_REVISION } from "../constants.js";
import { FoundationError } from "../error.js";
import { withFoundationReviewerProjectionCandidateRepositoryV7 } from "../evidence/physical-observation-v7.js";
import { validateKnowledgeSet } from "../knowledge/knowledge-set.js";
import type {
  FoundationKnowledgeSet,
  FoundationKnowledgeSetResult,
  FoundationKnowledgeSourceResolution,
} from "../knowledge/types.js";
import { compileKnowledgeProjection } from "../projection/compiler.js";
import { atlasResourceSourceId } from "../projection/source-context.js";
import type { FoundationReviewerProjectionObservation } from "../projection/execution.js";
import {
  parseProjectionRequest,
  projectionRepositoryEpochDigest,
} from "../projection/request.js";
import type {
  FoundationCompiledProjection,
  FoundationExecutionProjectionCore,
  FoundationExecutionProjectionRequest,
  FoundationExecutionProjectionSubject,
  FoundationOrientationProjectionRequest,
  FoundationProjectionCandidateBasis,
  FoundationProjectionKnowledgeRoot,
  FoundationProjectionRequest,
  FoundationProjectionSourceRoot,
} from "../projection/types.js";
import { pathWithin } from "../repository/product-state.js";
import {
  assertRepositoryEpochUnmoved,
  canonicalRepository,
  exactTreeEntries,
  resolveAttachedEpoch,
} from "../repository/git.js";
import {
  bindHistoricalRepositorySnapshot,
  loadRepositoryEpochAtCommit,
} from "../repository/snapshot.js";
import type {
  FoundationCapabilityProfile,
  FoundationGitObjectFormat,
  FoundationGitTreeEntry,
  FoundationLoadedRepositoryEpoch,
  FoundationLoadedRepositorySnapshot,
} from "../repository/types.js";
import { FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR } from "../repository/contract.js";
import {
  validateLoadedHistoricalRepositorySnapshot,
} from "../repository/validate.js";
import {
  canonicalJson,
  canonicalPrettyJson,
  digestCanonical,
  selfDigest,
  sha256Bytes,
  type Sha256,
} from "../validation/canonical.js";
import { compareCodePoints, sortUniqueCodePoints } from "../validation/ordering.js";
import type { FoundationValidationResult } from "../validation/result.js";
import type { FoundationInstalledRuntimeConfigurationV7 } from "../installed-configuration-v7.js";
import {
  compileFoundationAgentEvidenceSetFromProjectionSourcesV7,
  compileFoundationReviewerPropositionSetV7,
  type FoundationAgentEvidenceSetCompilationV7,
  type FoundationAgentPropositionSetCompilationV7,
} from "./agent-context-v7.js";
import {
  inspectFoundationAgentActivityV7,
  type FoundationAgentOperationSupportV7,
  type FoundationAgentOperationV7,
} from "./agent-operation-v7.js";

const PROVIDER_TIMEOUT_MS = 30 * 60 * 1_000;
const MAXIMUM_CURRENT_RECORDS = 10_000;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export const FOUNDATION_AGENT_ROOT_TOKEN_SET_DIGEST_V3 = digestCanonical(Object.freeze({
  schema: "lifecycle.agent-root-token-set.v3",
  tokens: Object.freeze(["input-bundle", "semantic-workspace"]),
}));

type CurrentReference = Readonly<{
  id: string;
  revision: number;
  digest: Sha256;
}>;

type ExactOperationSubjects = Readonly<{
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
  seal: ControlRecordRevision | null;
  materialCondition: ControlRecordRevision | null;
}>;

type RepositoryObservation = Readonly<{
  epoch: FoundationLoadedRepositoryEpoch;
  knowledgeResult: FoundationKnowledgeSetResult;
}>;

type AdmittedRepositoryBasis = Readonly<{
  productBaseCommit: string;
  productBaseTree: string;
  productStateDigest: Sha256;
  atlasStateDigest: Sha256;
  atlasResolutionDigest: Sha256;
  atlasNormalizedModelDigest: Sha256;
  atlasResourceBindingsDigest: Sha256;
  repositoryContractDigest: Sha256;
  knowledgeSetDigest: Sha256;
  repositorySnapshotDigest: Sha256;
}>;

type ExecutionRepositoryBasis = RepositoryObservation & Readonly<{
  snapshot: FoundationLoadedRepositorySnapshot;
  repositoryValidation: FoundationValidationResult;
  knowledge: FoundationKnowledgeSet;
}>;

type CurrentRawRepositoryTree = Readonly<{
  repository: string;
  ref: string;
  commit: string;
  tree: string;
  objectFormat: FoundationGitObjectFormat;
  treeEntries: readonly FoundationGitTreeEntry[];
}>;

async function loadCurrentRawRepositoryTree(target: string): Promise<CurrentRawRepositoryTree> {
  const repository = await canonicalRepository(target);
  const epoch = await resolveAttachedEpoch(repository);
  const treeEntries = await exactTreeEntries(repository, epoch.tree, epoch.objectFormat);
  await assertRepositoryEpochUnmoved(repository, epoch);
  return Object.freeze({ repository, ...epoch, treeEntries });
}

type OperationContextOwnersV7 = Readonly<{
  loadRepositoryEpochAtCommit: typeof loadRepositoryEpochAtCommit;
  loadCurrentRawRepositoryTree: typeof loadCurrentRawRepositoryTree;
  validateKnowledgeSet: typeof validateKnowledgeSet;
  bindHistoricalRepositorySnapshot: typeof bindHistoricalRepositorySnapshot;
  validateLoadedHistoricalRepositorySnapshot: typeof validateLoadedHistoricalRepositorySnapshot;
  compileKnowledgeProjection: typeof compileKnowledgeProjection;
  withReviewerCandidateRepository: typeof withFoundationReviewerProjectionCandidateRepositoryV7;
  inspectAgentActivity: typeof inspectFoundationAgentActivityV7;
}>;

export type FoundationFreshAgentOperationContextV7Options = Partial<OperationContextOwnersV7>;

export type FoundationFreshAgentOperationContextV7Input = Readonly<{
  target: string;
  store: ControlRecordStore;
  configuration: FoundationInstalledRuntimeConfigurationV7;
  activityId: string;
  operation: FoundationAgentOperationV7;
  semanticMarkdown: string;
  reviewerObservation?: FoundationReviewerProjectionObservation | null;
  observedAt?: string;
}>;

export type FoundationFreshAgentOperationContextV7 = Readonly<{
  activityId: string;
  operation: FoundationAgentOperationV7;
  role: AgentAttemptRole;
  semanticMarkdown: string;
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
  /** Candidate Seal bound as an Agent Attempt relationship; reviewer only. */
  attemptSeal: ControlRecordRevision | null;
  /** Current reducer Seal, including a prior review Seal during boundary resolution. */
  seal: ControlRecordRevision | null;
  materialCondition: ControlRecordRevision | null;
  epoch: FoundationLoadedRepositoryEpoch;
  /** Execution-only repository authority; Orientation binds the epoch directly. */
  snapshot: FoundationLoadedRepositorySnapshot | null;
  /** Execution-only successful repository validation. */
  repositoryValidation: FoundationValidationResult | null;
  /** A usable Knowledge Set when the observation is complete and valid. */
  knowledge: FoundationKnowledgeSet | null;
  request: FoundationProjectionRequest;
  subject: FoundationExecutionProjectionSubject | null;
  projection: FoundationCompiledProjection;
  roleSubject: ControlJsonObject;
  capabilityProfile: Readonly<{ id: string; digest: Sha256 }>;
  providerCapability: ProviderInputV4Capability;
  providerInput: ProviderInputV4;
  evidenceSet: FoundationAgentEvidenceSetCompilationV7 | null;
  propositionSet: FoundationAgentPropositionSetCompilationV7 | null;
  investment: AgentAttemptInvestment;
  rootTokenSetDigest: Sha256;
}>;

export type FoundationRetainedAgentOperationContextV7Input = Readonly<{
  target: string;
  store: ControlRecordStore;
  configuration: FoundationInstalledRuntimeConfigurationV7;
  activityId: string;
  operation: FoundationAgentOperationV7;
  reviewerObservation?: FoundationReviewerProjectionObservation | null;
  observedAt?: string;
}>;

export type FoundationUnpromotedReviewAgentOperationContextV7Input = Readonly<{
  target: string;
  store: ControlRecordStore;
  configuration: FoundationInstalledRuntimeConfigurationV7;
  activityId: string;
  reviewerObservation: FoundationReviewerProjectionObservation;
  observedAt?: string;
}>;

export type FoundationUnpromotedReviewAgentOperationContextV7 =
  FoundationFreshAgentOperationContextV7 & Readonly<{
    operation: "delivery.evaluate";
    role: "reviewer";
    configuration: FoundationInstalledRuntimeConfigurationV7;
    opening: Readonly<{
      agentId: string;
      runtimeId: string;
      founderId: string;
      submittedAt: string;
      startedAt: string;
    }>;
    brief: ControlRecordRevision;
  }>;

export type FoundationRetainedAgentOperationContextV7 =
  FoundationFreshAgentOperationContextV7 & Readonly<{
    opening: Readonly<{
      agentId: string;
      runtimeId: string;
      founderId: string;
      submittedAt: string;
      startedAt: string;
      attemptCreatedAt: string;
    }>;
    brief: ControlRecordRevision;
    attempt: ControlRecordRevision | null;
    /** Current physical installation with the retained provider selection restored. */
    configuration: FoundationInstalledRuntimeConfigurationV7;
    boundaryResolutionBasis: Readonly<{
      snapshot: FoundationLoadedRepositorySnapshot;
      knowledge: FoundationKnowledgeSet;
      projection: FoundationCompiledProjection;
    }> | null;
  }>;

type ExplicitAgentOperationContextV7Input = Readonly<{
  target: string;
  machineHome: string;
  store: ControlRecordStore;
  activityId: string;
  operation: FoundationAgentOperationV7;
  semanticMarkdown: string;
  subjects: ExactOperationSubjects;
  investment: AgentAttemptInvestment;
  reviewerObservation: FoundationReviewerProjectionObservation | null;
  observedAt?: string;
  excludedWorkProductActivityId: string | null;
}>;

function fail(
  code: string,
  message: string,
  observedFacts: Readonly<Record<string, unknown>> = {},
): never {
  throw new FoundationError(`lifecycle.operation-context-v7.${code}`, message, {
    observedFacts,
  });
}

function object(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== "object") {
    fail("retained-fact", `${label} must be one exact object`);
  }
  return value as ControlJsonObject;
}

function array(value: ControlJsonValue | undefined, label: string): readonly ControlJsonValue[] {
  if (!Array.isArray(value)) fail("retained-fact", `${label} must be one exact array`);
  return value;
}

function string(value: ControlJsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    fail("retained-fact", `${label} must be bounded normalized text`);
  }
  return value;
}

function nullableString(value: ControlJsonValue | undefined, label: string): string | null {
  return value === null ? null : string(value, label);
}

function boolean(value: ControlJsonValue | undefined, label: string): boolean {
  if (typeof value !== "boolean") fail("retained-fact", `${label} must be one exact boolean`);
  return value;
}

function integer(value: ControlJsonValue | undefined, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    fail("retained-fact", `${label} must be one positive safe integer`);
  }
  return value as number;
}

function digest(value: ControlJsonValue | undefined, label: string): Sha256 {
  const selected = string(value, label);
  if (!SHA256_PATTERN.test(selected)) fail("retained-fact", `${label} must be one SHA-256 digest`);
  return selected as Sha256;
}

function strings(value: ControlJsonValue | undefined, label: string): readonly string[] {
  const selected = array(value, label).map((entry, index) => string(entry, `${label}[${index}]`));
  if (
    new Set(selected).size !== selected.length ||
    selected.some((entry, index) => entry !== [...selected].sort(compareCodePoints)[index])
  ) fail("retained-fact", `${label} must already be sorted and unique`);
  return Object.freeze(selected);
}

function reference(revision: ControlRecordRevision): ControlJsonObject {
  return Object.freeze({
    kind: revision.recordKind,
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function sameReference(
  left: CurrentReference | ControlRecordRelationshipTarget | null,
  right: ControlRecordRevision,
): boolean {
  return left !== null && left.id === right.recordId && left.revision === right.revision &&
    left.digest === right.digest;
}

function exactRelationship(
  revision: ControlRecordRevision,
  relation: string,
  expected: ControlRecordRevision,
  label: string,
): void {
  const matches = revision.relationships.filter(({ relation: selected }) => selected === relation);
  if (matches.length !== 1 || matches[0]!.target.kind !== expected.recordKind ||
      !sameReference(matches[0]!.target, expected)) {
    fail("relationship", `${label} must bind the exact current ${expected.recordKind}`);
  }
}

function exactCurrentRevision(
  store: ControlRecordStore,
  selected: CurrentReference | null,
  expectedKind: string,
  label: string,
): ControlRecordRevision {
  if (selected === null) fail("current-subject", `${label} is absent from derived Delivery state`);
  const revision = store.getRevision(selected.id, selected.revision);
  if (
    revision === null || revision.processId !== store.identity.processId ||
    revision.recordKind !== expectedKind || revision.digest !== selected.digest
  ) fail("current-subject", `${label} does not resolve one exact retained ${expectedKind} revision`);
  assertDeliveryControlRecordPayload(revision);
  return revision;
}

function roleFor(operation: FoundationAgentOperationV7): AgentAttemptRole {
  switch (operation) {
    case "delivery.continue": return "builder";
    case "delivery.evaluate": return "reviewer";
    case "delivery.revise":
    case "delivery.reaffirm": return "reconnaissance";
    default: return fail("operation", "Operation context selected an unsupported Delivery operation");
  }
}

function normalizedFounderMarkdown(value: string): string {
  const parsed = FoundationSemanticMarkdownSchema.safeParse(value);
  if (!parsed.success) {
    fail("semantic-markdown", "Operation context requires body-only public semantic Markdown");
  }
  return normalizeSemanticMarkdown(parsed.data);
}

function exactOperationSubjects(
  store: ControlRecordStore,
  activityId: string,
  operation: FoundationAgentOperationV7,
): ExactOperationSubjects {
  const state = store.state();
  const currentActivity = state.activities.filter(({ id }) => id === activityId);
  if (operation === "delivery.evaluate") {
    if (
      currentActivity.length !== 1 || currentActivity[0]!.operation !== operation ||
      currentActivity[0]!.family !== "agent" || currentActivity[0]!.stage === "completed"
    ) {
      fail(
        "operation-coordinate",
        "Reviewer context requires the exact already-opened evaluation activity",
      );
    }
  } else if (
    currentActivity.length !== 0 || !state.eligibleOperations.includes(operation)
  ) {
    fail(
      "operation-coordinate",
      "Fresh Agent context requires one unused activity identity and exact operation eligibility",
    );
  }
  const boundary = exactCurrentRevision(
    store,
    state.subjects.activeBoundary,
    "work-boundary",
    "Active Work Boundary",
  );
  const candidate = exactCurrentRevision(
    store,
    state.subjects.candidate,
    "candidate-revision",
    "Current Candidate",
  );
  exactRelationship(candidate, "governed-by", boundary, "Current Candidate");
  const seal = state.subjects.seal === null
    ? null
    : exactCurrentRevision(store, state.subjects.seal, "candidate-seal", "Current Candidate Seal");
  const materialCondition = state.subjects.materialCondition === null
    ? null
    : exactCurrentRevision(
        store,
        state.subjects.materialCondition,
        "material-condition",
        "Current Material Condition",
      );
  if (seal !== null) {
    exactRelationship(seal, "seals", candidate, "Current Candidate Seal");
    exactRelationship(seal, "governed-by", boundary, "Current Candidate Seal");
  }
  if (materialCondition !== null) {
    exactRelationship(materialCondition, "freezes", candidate, "Current Material Condition");
    exactRelationship(materialCondition, "governed-by", boundary, "Current Material Condition");
  }
  if (operation === "delivery.continue" && (seal !== null || materialCondition !== null)) {
    fail("operation-coordinate", "Candidate development requires an unsealed, unpaused Candidate");
  }
  if (operation === "delivery.evaluate" && (seal === null || materialCondition !== null)) {
    fail("operation-coordinate", "Reviewer context requires the exact sealed, unpaused Candidate");
  }
  if (
    (operation === "delivery.revise" || operation === "delivery.reaffirm") &&
    materialCondition === null
  ) fail("operation-coordinate", "Boundary resolution requires the exact current Material Condition");
  return Object.freeze({ boundary, candidate, seal, materialCondition });
}

function resolvedOwners(options: FoundationFreshAgentOperationContextV7Options): OperationContextOwnersV7 {
  return Object.freeze({
    loadRepositoryEpochAtCommit:
      options.loadRepositoryEpochAtCommit ?? loadRepositoryEpochAtCommit,
    loadCurrentRawRepositoryTree:
      options.loadCurrentRawRepositoryTree ?? loadCurrentRawRepositoryTree,
    validateKnowledgeSet: options.validateKnowledgeSet ?? validateKnowledgeSet,
    bindHistoricalRepositorySnapshot:
      options.bindHistoricalRepositorySnapshot ?? bindHistoricalRepositorySnapshot,
    validateLoadedHistoricalRepositorySnapshot:
      options.validateLoadedHistoricalRepositorySnapshot ?? validateLoadedHistoricalRepositorySnapshot,
    compileKnowledgeProjection: options.compileKnowledgeProjection ?? compileKnowledgeProjection,
    withReviewerCandidateRepository:
      options.withReviewerCandidateRepository ??
      withFoundationReviewerProjectionCandidateRepositoryV7,
    inspectAgentActivity: options.inspectAgentActivity ?? inspectFoundationAgentActivityV7,
  });
}

function admittedRepositoryBasis(boundary: ControlRecordRevision): AdmittedRepositoryBasis {
  const basis = object(boundary.payload.basis, "Active Work Boundary basis");
  return Object.freeze({
    productBaseCommit: string(basis.productBaseCommit, "Work Boundary product-base commit"),
    productBaseTree: string(basis.productBaseTree, "Work Boundary product-base tree"),
    productStateDigest: digest(basis.productStateDigest, "Work Boundary Product State digest"),
    atlasStateDigest: digest(basis.atlasStateDigest, "Work Boundary Atlas State digest"),
    atlasResolutionDigest: digest(
      basis.atlasResolutionDigest,
      "Work Boundary Atlas Resolution digest",
    ),
    atlasNormalizedModelDigest: digest(
      basis.atlasNormalizedModelDigest,
      "Work Boundary Atlas normalized-model digest",
    ),
    atlasResourceBindingsDigest: digest(
      basis.atlasResourceBindingsDigest,
      "Work Boundary Atlas Resource-bindings digest",
    ),
    repositoryContractDigest: digest(
      basis.repositoryContractDigest,
      "Work Boundary repository-contract digest",
    ),
    knowledgeSetDigest: digest(basis.knowledgeSetDigest, "Work Boundary Knowledge Set digest"),
    repositorySnapshotDigest: digest(
      basis.repositorySnapshotDigest,
      "Work Boundary Repository Snapshot digest",
    ),
  });
}

async function admittedRepositoryObservation(
  target: string,
  store: ControlRecordStore,
  boundary: ControlRecordRevision,
  owners: OperationContextOwnersV7,
): Promise<RepositoryObservation> {
  const admitted = admittedRepositoryBasis(boundary);
  const epoch = await owners.loadRepositoryEpochAtCommit(target, admitted.productBaseCommit);
  const current = await owners.loadCurrentRawRepositoryTree(target);
  if (
    epoch.contract.targetId !== store.identity.targetId ||
    epoch.epoch.commit !== admitted.productBaseCommit ||
    epoch.epoch.tree !== admitted.productBaseTree ||
    epoch.productState.digest !== admitted.productStateDigest ||
    epoch.atlasState.digest !== admitted.atlasStateDigest ||
    epoch.atlas.resolution.digest !== admitted.atlasResolutionDigest ||
    epoch.atlas.resolution.normalizedModelDigest !== admitted.atlasNormalizedModelDigest ||
    epoch.atlas.resolution.resourceBindingsDigest !== admitted.atlasResourceBindingsDigest ||
    epoch.contract.digest !== admitted.repositoryContractDigest
  ) {
    fail(
      "admitted-repository",
      "Historical repository reproduction differs from the active Work Boundary basis",
      {
        admitted,
        observed: {
          targetId: epoch.contract.targetId,
          productBaseCommit: epoch.epoch.commit,
          productBaseTree: epoch.epoch.tree,
          productStateDigest: epoch.productState.digest,
          atlasStateDigest: epoch.atlasState.digest,
          atlasResolutionDigest: epoch.atlas.resolution.digest,
          atlasNormalizedModelDigest: epoch.atlas.resolution.normalizedModelDigest,
          atlasResourceBindingsDigest: epoch.atlas.resolution.resourceBindingsDigest,
          repositoryContractDigest: epoch.contract.digest,
        },
      },
    );
  }
  if (
    current.repository !== epoch.repository ||
    current.ref !== epoch.contract.canonicalBranch ||
    current.objectFormat !== epoch.epoch.objectFormat ||
    current.commit !== admitted.productBaseCommit ||
    current.tree !== admitted.productBaseTree
  ) {
    fail(
      "repository-drift",
      "The active-Delivery branch lease requires the exact admitted canonical commit and tree",
      {
        expectedRef: epoch.contract.canonicalBranch,
        expectedCommit: admitted.productBaseCommit,
        expectedTree: admitted.productBaseTree,
        expectedObjectFormat: epoch.epoch.objectFormat,
        observedRef: current.ref,
        observedCommit: current.commit,
        observedTree: current.tree,
        observedObjectFormat: current.objectFormat,
      },
    );
  }
  const knowledgeResult = await owners.validateKnowledgeSet(epoch);
  if (
    knowledgeResult.validation.complete && knowledgeResult.validation.valid &&
    knowledgeResult.observation.manifest.digest !== admitted.knowledgeSetDigest
  ) {
    fail(
      "admitted-repository",
      "Historical Knowledge reproduction differs from the active Work Boundary basis",
      {
        expectedKnowledgeSetDigest: admitted.knowledgeSetDigest,
        observedKnowledgeSetDigest: knowledgeResult.observation.manifest.digest,
      },
    );
  }
  return Object.freeze({ epoch, knowledgeResult });
}

async function executionRepositoryBasis(
  observation: RepositoryObservation,
  boundary: ControlRecordRevision,
  owners: OperationContextOwnersV7,
): Promise<ExecutionRepositoryBasis> {
  const { epoch, knowledgeResult } = observation;
  const knowledge = knowledgeResult.knowledgeSet;
  if (
    knowledge === null || !knowledgeResult.validation.complete || !knowledgeResult.validation.valid
  ) {
    fail("knowledge", "Agent operation requires one complete valid Knowledge Set", {
      validationDigest: knowledgeResult.validation.digest,
      diagnostics: knowledgeResult.validation.diagnostics.map(({ code }) => code),
    });
  }
  const snapshot = await owners.bindHistoricalRepositorySnapshot(epoch, knowledge);
  const admitted = admittedRepositoryBasis(boundary);
  if (snapshot.snapshot.digest !== admitted.repositorySnapshotDigest) {
    fail(
      "admitted-repository",
      "Historical Repository Snapshot reproduction differs from the active Work Boundary basis",
      {
        expectedRepositorySnapshotDigest: admitted.repositorySnapshotDigest,
        observedRepositorySnapshotDigest: snapshot.snapshot.digest,
      },
    );
  }
  const repositoryValidation = await owners.validateLoadedHistoricalRepositorySnapshot(snapshot, {
    knowledge,
  });
  if (!repositoryValidation.complete || !repositoryValidation.valid) {
    fail("repository", "Agent operation requires one complete valid repository snapshot", {
      validationDigest: repositoryValidation.digest,
      diagnostics: repositoryValidation.diagnostics.map(({ code }) => code),
    });
  }
  return Object.freeze({ epoch, snapshot, repositoryValidation, knowledgeResult, knowledge });
}

function boundaryResolutionObjective(input: Readonly<{
  operation: "delivery.revise" | "delivery.reaffirm";
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
  materialCondition: ControlRecordRevision;
  founderRationale: string;
}>): string {
  const founderRationale = normalizedFounderMarkdown(input.founderRationale);
  const facts = Object.freeze({
    operation: input.operation,
    activeBoundary: reference(input.boundary),
    frozenMaterialCondition: reference(input.materialCondition),
    currentCandidate: reference(input.candidate),
    founderRationale,
    founderRationaleDigest: sha256Bytes(founderRationale),
  });
  const factBlock = canonicalPrettyJson(facts)
    .trimEnd()
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
  return normalizedFounderMarkdown(
    `# Boundary Resolution Objective\n\n` +
    `Resolve the frozen Delivery boundary from these exact runtime-derived facts.\n\n` +
    `${factBlock}\n`,
  );
}

export function compileFoundationOrientationProjectionRequestV7(input: Readonly<{
  epoch: FoundationLoadedRepositoryEpoch;
  knowledge: FoundationKnowledgeSetResult;
  semanticMarkdown: string;
}>): FoundationOrientationProjectionRequest {
  const profile = input.epoch.contract.projectionProfiles[
    input.epoch.contract.defaults.orientationProjectionProfileId
  ];
  if (profile === undefined || profile.id !== "orientation-standard-v1") {
    fail("projection-profile", "Default Orientation Projection profile is unavailable or unsupported");
  }
  if (
    input.epoch.contract.sourcePolicy.externalLocal !== "denied" ||
    input.epoch.contract.sourcePolicy.network !== "denied"
  ) fail("retrieval", "Foundation Agent operations have no external retrieval authority");
  const semanticMarkdown = normalizedFounderMarkdown(input.semanticMarkdown);
  const observation = input.knowledge.observation;
  const base = Object.freeze({
    schema: "lifecycle.projection-request.v4" as const,
    class: "orientation" as const,
    role: "reconnaissance" as const,
    specificationRevision: FOUNDATION_SPECIFICATION_REVISION,
    target: Object.freeze({ id: input.epoch.contract.targetId, generation: input.epoch.contract.generation }),
    repository: Object.freeze({
      commit: input.epoch.epoch.commit,
      tree: input.epoch.epoch.tree,
      objectFormat: input.epoch.epoch.objectFormat,
      repositoryEpochDigest: projectionRepositoryEpochDigest(input.epoch),
      productStateDigest: input.epoch.productState.digest,
      repositoryContractDigest: input.epoch.contract.digest,
      repositorySnapshotDigest: null,
      validationDigest: null,
      complete: null,
      valid: null,
    }),
    atlas: Object.freeze({
      root: input.epoch.contract.atlas.root,
      entrypoint: input.epoch.contract.atlas.entrypoint,
      specificationRevision: input.epoch.contract.atlas.selection.specificationRevision,
      processorRevision: input.epoch.contract.atlas.selection.processorRevision,
      stateDigest: input.epoch.atlasState.digest,
      resolutionDigest: input.epoch.atlas.resolution.digest,
      normalizedModelDigest: input.epoch.atlas.resolution.normalizedModelDigest,
      resourceBindingsDigest: input.epoch.atlas.resolution.resourceBindingsDigest,
      complete: true as const,
      valid: true as const,
    }),
    knowledge: Object.freeze({
      knowledgeObservationDigest: observation.manifest.digest,
      knowledgeSetDigest: observation.validation.complete && observation.validation.valid
        ? observation.manifest.digest
        : null,
      knowledgeValidationDigest: observation.validation.digest,
      complete: observation.validation.complete,
      valid: observation.validation.valid,
    }),
    profile,
    subject: Object.freeze({
      class: "orientation" as const,
      objective: semanticMarkdown,
      objectiveDigest: sha256Bytes(semanticMarkdown),
    }),
    features: Object.freeze({ historical: true, reachable: true }),
    retrieval: Object.freeze({
      externalLocal: "denied" as const,
      network: "denied" as const,
      authoritySubjectDigest: null,
      sources: Object.freeze([]),
    }),
  });
  const request = Object.freeze({ ...base, digest: selfDigest(base) });
  const parsed = parseProjectionRequest(request);
  if (parsed.class !== "orientation") fail("projection", "Orientation request parsed as execution");
  return parsed;
}

function candidateBasis(
  candidate: ControlRecordRevision,
  seal: ControlRecordRevision | null,
  role: "builder" | "reviewer",
): FoundationProjectionCandidateBasis {
  const state = object(candidate.payload.state, "Current Candidate state");
  const carrierManifest = object(candidate.payload.carrierManifest, "Candidate Carrier manifest binding");
  const baseCommit = string(candidate.payload.candidateBaseCommit, "Candidate immutable base commit");
  const stateDigest = digest(state.candidateDigest, "Candidate state digest");
  const revision = Object.freeze({
    kind: "candidate-revision" as const,
    id: candidate.recordId,
    revision: candidate.revision,
    digest: candidate.digest,
  });
  const carrierManifestDigest = digest(
    carrierManifest.digest,
    "Candidate Carrier manifest digest",
  );
  if (role === "builder") {
    if (seal !== null) fail("candidate", "Builder Candidate basis cannot carry a Candidate Seal");
    return Object.freeze({
      baseCommit,
      revision,
      stateDigest,
      carrierManifestDigest,
      sealedTree: null,
      seal: null,
    });
  }
  if (seal === null) fail("candidate", "Reviewer Candidate basis requires a Candidate Seal");
  return Object.freeze({
    baseCommit,
    revision,
    stateDigest,
    carrierManifestDigest,
    sealedTree: string(state.tree, "Sealed Candidate tree"),
    seal: Object.freeze({
      kind: "candidate-seal",
      id: seal.recordId,
      revision: seal.revision,
      digest: seal.digest,
    }),
  });
}

function executionProfile(
  snapshot: FoundationLoadedRepositorySnapshot,
  boundary: ControlRecordRevision,
) {
  const selected = object(boundary.payload.projectionProfile, "Work Boundary Projection Profile");
  const id = string(selected.id, "Work Boundary Projection Profile identity");
  const profile = snapshot.contract.projectionProfiles[id];
  if (
    profile === undefined || profile.digest !== digest(
      selected.digest,
      "Work Boundary Projection Profile digest",
    ) || (profile.id !== "execution-standard-v1" && profile.id !== "execution-large-v1")
  ) fail("projection-profile", "Work Boundary does not select one exact execution Projection profile");
  return profile;
}

export function compileFoundationExecutionProjectionRequestV7(input: Readonly<{
  snapshot: FoundationLoadedRepositorySnapshot;
  repositoryValidation: FoundationValidationResult;
  knowledge: FoundationKnowledgeSet;
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
  seal: ControlRecordRevision | null;
  role: "builder" | "reviewer";
}>): FoundationExecutionProjectionRequest {
  const profile = executionProfile(input.snapshot, input.boundary);
  const candidate = candidateBasis(input.candidate, input.seal, input.role);
  const base = Object.freeze({
    schema: "lifecycle.projection-request.v4" as const,
    class: "execution" as const,
    role: input.role,
    specificationRevision: FOUNDATION_SPECIFICATION_REVISION,
    target: Object.freeze({
      id: input.snapshot.contract.targetId,
      generation: input.snapshot.contract.generation,
    }),
    repository: Object.freeze({
      commit: input.snapshot.snapshot.commit,
      tree: input.snapshot.snapshot.tree,
      objectFormat: input.snapshot.snapshot.objectFormat,
      repositoryEpochDigest: projectionRepositoryEpochDigest(input.snapshot),
      productStateDigest: input.snapshot.snapshot.productStateDigest,
      repositoryContractDigest: input.snapshot.snapshot.contractDigest,
      repositorySnapshotDigest: input.snapshot.snapshot.digest,
      validationDigest: input.repositoryValidation.digest,
      complete: input.repositoryValidation.complete,
      valid: input.repositoryValidation.valid,
    }),
    atlas: Object.freeze({
      root: input.snapshot.contract.atlas.root,
      entrypoint: input.snapshot.contract.atlas.entrypoint,
      specificationRevision: input.snapshot.contract.atlas.selection.specificationRevision,
      processorRevision: input.snapshot.contract.atlas.selection.processorRevision,
      stateDigest: input.snapshot.snapshot.atlasStateDigest,
      resolutionDigest: input.snapshot.snapshot.atlasResolutionDigest,
      normalizedModelDigest: input.snapshot.snapshot.atlasNormalizedModelDigest,
      resourceBindingsDigest: input.snapshot.atlas.resolution.resourceBindingsDigest,
      complete: true as const,
      valid: true as const,
    }),
    knowledge: Object.freeze({
      knowledgeObservationDigest: input.knowledge.manifest.digest,
      knowledgeSetDigest: input.knowledge.manifest.digest,
      knowledgeValidationDigest: input.knowledge.validation.digest,
      complete: input.knowledge.validation.complete,
      valid: input.knowledge.validation.valid,
    }),
    profile,
    subject: Object.freeze({
      class: "execution" as const,
      workBoundary: Object.freeze({
        kind: "work-boundary" as const,
        id: input.boundary.recordId,
        revision: input.boundary.revision,
        digest: input.boundary.digest,
      }),
      candidate,
    }),
    features: Object.freeze({ historical: false, reachable: false }),
    retrieval: Object.freeze({
      externalLocal: "denied" as const,
      network: "denied" as const,
      authoritySubjectDigest: null,
      sources: Object.freeze([]),
    }),
  });
  const request = Object.freeze({ ...base, digest: selfDigest(base) });
  const parsed = parseProjectionRequest(request);
  if (parsed.class !== "execution") fail("projection", "Execution request parsed as orientation");
  return parsed;
}

function authorityForSource(
  source: FoundationKnowledgeSourceResolution,
): "atlas" | "informational-source" | "repository-reality" {
  return source.kind === "atlas" ? "atlas"
    : source.kind === "repository" ? "repository-reality"
      : "informational-source";
}

function sourceRoots(
  boundary: ControlRecordRevision,
  knowledge: FoundationKnowledgeSet,
  snapshot: FoundationLoadedRepositorySnapshot,
): readonly FoundationProjectionSourceRoot[] {
  const selected = array(boundary.payload.externalSources, "Work Boundary external sources");
  return Object.freeze(selected.map((value, index) => {
    const source = object(value, `Work Boundary external source[${index}]`);
    const sourceId = string(source.sourceId, `Work Boundary external source[${index}] identity`);
    const revision = nullableString(source.revision, `Work Boundary external source[${index}] revision`);
    const selectedDigest = digest(source.digest, `Work Boundary external source[${index}] digest`);
    const ownerKind = string(source.ownerKind, `Work Boundary external source[${index}] owner kind`);
    const ownerId = string(source.ownerId, `Work Boundary external source[${index}] owner identity`);
    const matches = knowledge.sources.filter((candidate) =>
      candidate.sourceId === sourceId && candidate.declaredRevision === revision &&
      (candidate.resolvedDigest ?? candidate.declaredDigest) === selectedDigest &&
      authorityForSource(candidate) === ownerKind);
    const atlasResourceMatches = ownerKind !== "atlas" ? [] : snapshot.atlas.model.atlas.resources.flatMap((resource) => {
      const materialId = atlasResourceSourceId(snapshot.atlas.model.atlas.id, resource.id);
      const binding = snapshot.atlas.resolution.resourceBindings.find(({ resourceId }) => resourceId === resource.id);
      return materialId === sourceId && materialId === ownerId && binding?.disposition === "resolved" &&
          binding.path !== null && binding.objectId === revision && binding.byteDigest === selectedDigest
        ? [Object.freeze({ resource, binding, materialId })]
        : [];
    });
    if (matches.length + atlasResourceMatches.length !== 1) {
      fail("source", `Work Boundary external source ${sourceId} does not resolve one exact Knowledge source`, {
        knowledgeMatches: matches.length,
        atlasResourceMatches: atlasResourceMatches.length,
      });
    }
    const atlasResource = atlasResourceMatches[0];
    if (atlasResource !== undefined) {
      return Object.freeze({
        owner: "source-anchor" as const,
        sourceId: atlasResource.materialId,
        reference: atlasResource.binding.path!,
        revision: atlasResource.binding.objectId,
        digest: selectedDigest,
        authority: "atlas" as const,
        required: true,
        reason: "selected-by-active-work-boundary",
      });
    }
    const match = matches[0]!;
    return Object.freeze({
      owner: "knowledge" as const,
      recordId: match.recordId,
      recordRevision: match.recordRevision,
      sourceId: match.sourceId,
      reference: match.reference,
      revision: match.declaredRevision,
      digest: selectedDigest,
      authority: authorityForSource(match),
      required: match.required,
      reason: "selected-by-active-work-boundary",
    });
  }).sort((left, right) => compareCodePoints(
    left.owner === "knowledge"
      ? `knowledge\0${left.recordId}\0${left.recordRevision}\0${left.sourceId}`
      : `source-anchor\0${left.sourceId}`,
    right.owner === "knowledge"
      ? `knowledge\0${right.recordId}\0${right.recordRevision}\0${right.sourceId}`
      : `source-anchor\0${right.sourceId}`,
  )));
}

function exactObjects(value: ControlJsonValue | undefined, label: string): readonly ControlJsonObject[] {
  return Object.freeze(array(value, label).map((item, index) => object(item, `${label}[${index}]`)));
}

function obligation(value: ControlJsonObject): FoundationExecutionProjectionCore["obligations"][number] {
  return Object.freeze({
    id: string(value.id, "Work Boundary Obligation identity"),
    kind: string(value.kind, "Work Boundary Obligation kind") as
      FoundationExecutionProjectionCore["obligations"][number]["kind"],
    statement: string(value.statement, "Work Boundary Obligation statement"),
    sourceIds: strings(value.sourceIds, "Work Boundary Obligation sources"),
    requiredEvidenceIds: strings(
      value.requiredEvidenceArtifactIds,
      "Work Boundary Obligation Evidence artifacts",
    ),
  });
}

function artifact(value: ControlJsonObject): FoundationExecutionProjectionCore["requiredArtifacts"][number] {
  return Object.freeze({
    id: string(value.id, "Work Boundary Artifact identity"),
    path: string(value.path, "Work Boundary Artifact path"),
    role: string(value.role, "Work Boundary Artifact role") as
      FoundationExecutionProjectionCore["requiredArtifacts"][number]["role"],
    mustChange: boolean(value.mustChange, "Work Boundary Artifact must-change"),
  });
}

function effect(value: ControlJsonObject): FoundationExecutionProjectionCore["effects"][number] {
  return Object.freeze({
    id: string(value.id, "Work Boundary Effect identity"),
    kind: string(value.kind, "Work Boundary Effect kind") as
      FoundationExecutionProjectionCore["effects"][number]["kind"],
    summary: string(value.summary, "Work Boundary Effect summary"),
    trigger: string(value.trigger, "Work Boundary Effect trigger"),
    target: string(value.target, "Work Boundary Effect target"),
    reversibility: string(value.reversibility, "Work Boundary Effect reversibility") as
      FoundationExecutionProjectionCore["effects"][number]["reversibility"],
  });
}

function risk(value: ControlJsonObject): FoundationExecutionProjectionCore["risks"][number] {
  return Object.freeze({
    id: string(value.id, "Work Boundary Risk identity"),
    statement: string(value.statement, "Work Boundary Risk statement"),
    effectIds: strings(value.effectIds, "Work Boundary Risk effects"),
    treatment: string(value.treatment, "Work Boundary Risk treatment") as
      FoundationExecutionProjectionCore["risks"][number]["treatment"],
  });
}

function check(value: ControlJsonObject): FoundationExecutionProjectionCore["checks"][number] {
  const definition = object(value.definition, "Work Boundary Check definition");
  const bindings = exactObjects(value.bindings, "Work Boundary Check bindings");
  return Object.freeze({
    id: string(value.id, "Work Boundary Check identity"),
    checkId: string(definition.id, "Work Boundary Check definition identity"),
    bindingIds: Object.freeze(bindings.map((binding) =>
      string(binding.id, "Work Boundary Check Binding identity"))),
    modality: string(value.modality, "Work Boundary Check modality") as
      FoundationExecutionProjectionCore["checks"][number]["modality"],
    purpose: string(value.purpose, "Work Boundary Check purpose"),
  });
}

function proposition(value: ControlJsonObject): FoundationExecutionProjectionCore["propositions"][number] {
  return Object.freeze({
    id: string(value.id, "Work Boundary Proposition identity"),
    claim: string(value.claim, "Work Boundary Proposition claim"),
    evidenceKinds: strings(value.evidenceKinds, "Work Boundary Proposition Evidence kinds") as
      FoundationExecutionProjectionCore["propositions"][number]["evidenceKinds"],
    evidenceIds: strings(
      value.evidenceArtifactIds,
      "Work Boundary Proposition Evidence artifacts",
    ),
    obligationIds: strings(value.obligationIds, "Work Boundary Proposition obligations"),
    effectIds: strings(value.effectIds, "Work Boundary Proposition effects"),
    riskIds: strings(value.riskIds, "Work Boundary Proposition risks"),
    path: nullableString(value.path, "Work Boundary Proposition path"),
    checkId: nullableString(value.checkId, "Work Boundary Proposition Check"),
    allowNotApplicable: boolean(
      value.allowNotApplicable,
      "Work Boundary Proposition not-applicable permission",
    ),
    notApplicableCondition: nullableString(
      value.notApplicableCondition,
      "Work Boundary Proposition not-applicable condition",
    ),
  });
}

export function compileFoundationExecutionProjectionSubjectV7(input: Readonly<{
  snapshot: FoundationLoadedRepositorySnapshot;
  knowledge: FoundationKnowledgeSet;
  boundary: ControlRecordRevision;
  request: FoundationExecutionProjectionRequest;
  role: "builder" | "reviewer";
}>): FoundationExecutionProjectionSubject {
  const mandate = object(input.boundary.payload.mandate, "Work Boundary mandate");
  const direction = object(mandate.direction, "Work Boundary direction");
  const objective = object(mandate.objective, "Work Boundary objective");
  const selectedCapability = object(
    input.boundary.payload.capabilityProfile,
    "Work Boundary Capability Profile",
  );
  const capability = Object.freeze({
    profileId: string(selectedCapability.id, "Work Boundary Capability Profile identity"),
    profileDigest: digest(selectedCapability.digest, "Work Boundary Capability Profile digest"),
  });
  const core: FoundationExecutionProjectionCore = Object.freeze({
    class: "execution",
    objective: string(objective.interpretation, "Work Boundary objective interpretation"),
    selectedMeaning: string(direction.selectedMeaning, "Work Boundary selected meaning"),
    included: strings(direction.included, "Work Boundary included outcomes"),
    excluded: strings(direction.excluded, "Work Boundary excluded outcomes"),
    assumptions: strings(direction.assumptions, "Work Boundary assumptions"),
    falsifiers: strings(direction.falsifiers, "Work Boundary falsifiers"),
    obligations: Object.freeze(exactObjects(mandate.obligations, "Work Boundary obligations").map(obligation)),
    requiredArtifacts: Object.freeze(exactObjects(mandate.artifacts, "Work Boundary artifacts").map(artifact)),
    effects: Object.freeze(exactObjects(mandate.effects, "Work Boundary effects").map(effect)),
    risks: Object.freeze(exactObjects(mandate.risks, "Work Boundary risks").map(risk)),
    checks: Object.freeze(exactObjects(mandate.checks, "Work Boundary checks").map(check)),
    propositions: Object.freeze(
      exactObjects(mandate.acceptancePropositions, "Work Boundary propositions").map(proposition),
    ),
    capability,
    capabilitySummary: input.role === "builder"
      ? "The builder receives the exact admitted Candidate-write subset of the selected Capability Profile."
      : "The reviewer receives a read-only Candidate and no authority to change product or acceptance state.",
    prohibitedEffects: Object.freeze(sortUniqueCodePoints(input.role === "builder"
      ? ["change canonical repository", "claim acceptance authority", "expand admitted Work Boundary"]
      : ["change Candidate", "change canonical repository", "claim acceptance authority"])),
    materialConditionPolicy: input.role === "builder"
      ? "Return a typed Material Condition when the admitted mandate cannot continue exactly."
      : "Report mandate excess or a missing obligation through exact proposition decisions.",
    completionReturnRules: Object.freeze(input.role === "builder"
      ? ["Return only the exact bounded proposal facts from this invocation."]
      : ["Return exactly one decision for every projected acceptance proposition."]),
    requestDigest: input.request.digest,
    workBoundaryDigest: input.boundary.digest,
  });
  const knowledgeRoots: readonly FoundationProjectionKnowledgeRoot[] = Object.freeze(
    exactObjects(input.boundary.payload.knowledge, "Work Boundary Knowledge").map((value) =>
      Object.freeze({
        id: string(value.id, "Work Boundary Knowledge identity"),
        revision: integer(value.revision, "Work Boundary Knowledge revision"),
        sourceDigest: digest(value.sourceDigest, "Work Boundary Knowledge source digest"),
        semanticDigest: digest(value.semanticDigest, "Work Boundary Knowledge semantic digest"),
        reason: "selected-by-active-work-boundary",
      })),
  );
  const implementationRoots = Object.freeze(
    exactObjects(mandate.artifacts, "Work Boundary artifacts")
      .filter((value) => ["code", "test", "documentation"].includes(
        string(value.role, "Work Boundary Artifact role"),
      ))
      .filter((value) => input.snapshot.contract.productState.governedImplementationRoots.some((root) =>
        pathWithin(string(value.path, "Work Boundary Artifact path"), root)))
      .map((value) => Object.freeze({
        path: string(value.path, "Work Boundary Artifact path"),
        reason: string(value.changeRule, "Work Boundary Artifact change rule"),
      }))
      .sort((left, right) => compareCodePoints(left.path, right.path)),
  );
  const unsigned = Object.freeze({
    workBoundary: Object.freeze({
      kind: "work-boundary" as const,
      id: input.boundary.recordId,
      revision: input.boundary.revision,
      digest: input.boundary.digest,
    }),
    core,
    knowledgeRoots,
    implementationRoots,
    sourceRoots: sourceRoots(input.boundary, input.knowledge, input.snapshot),
    candidate: input.request.subject.candidate,
  });
  return Object.freeze({ ...unsigned, subjectDigest: digestCanonical(unsigned) });
}

function allCurrentRevisions(
  store: ControlRecordStore,
  recordKinds: readonly string[],
): readonly ControlRecordRevision[] {
  const values: ControlRecordRevision[] = [];
  let cursor: string | null = null;
  for (;;) {
    const page = store.listCurrentRevisions({ recordKinds, afterRecordId: cursor, limit: 1_000 });
    values.push(...page);
    if (values.length > MAXIMUM_CURRENT_RECORDS) {
      fail("evidence-bound", `Agent Evidence exceeds the ${MAXIMUM_CURRENT_RECORDS}-record bound`);
    }
    if (page.length < 1_000) return Object.freeze(values);
    cursor = page.at(-1)!.recordId;
  }
}

function relationshipTarget(
  revision: ControlRecordRevision,
  relation: string,
  expectedKind: string,
): ControlRecordRelationshipTarget | null {
  const matches = revision.relationships.filter(({ relation: selected }) => selected === relation);
  if (matches.length !== 1 || matches[0]!.target.kind !== expectedKind) return null;
  return matches[0]!.target;
}

function applicableWorkProducts(
  store: ControlRecordStore,
  boundary: ControlRecordRevision,
  excludedActivityId: string | null = null,
): readonly Readonly<{ workProduct: ControlRecordRevision; attempt: ControlRecordRevision }>[] {
  const values: Array<Readonly<{ workProduct: ControlRecordRevision; attempt: ControlRecordRevision }>> = [];
  for (const workProduct of allCurrentRevisions(store, ["agent-work-product"])) {
    const attemptTarget = relationshipTarget(workProduct, "result-of", "agent-attempt");
    if (attemptTarget === null) continue;
    const attempt = store.getRevision(attemptTarget.id, attemptTarget.revision);
    if (
      attempt === null || attempt.recordKind !== "agent-attempt" ||
      attempt.digest !== attemptTarget.digest || attempt.payload.role !== "builder" ||
      (excludedActivityId !== null && attempt.payload.activityId === excludedActivityId)
    ) continue;
    const boundaryTarget = relationshipTarget(attempt, "uses-boundary", "work-boundary");
    if (boundaryTarget !== null && sameReference(boundaryTarget, boundary)) {
      values.push(Object.freeze({ workProduct, attempt }));
    }
  }
  return Object.freeze(values.sort((left, right) =>
    compareCodePoints(left.workProduct.recordId, right.workProduct.recordId)));
}

function applicableCheckReceipts(
  store: ControlRecordStore,
  seal: ControlRecordRevision | null,
): readonly ControlRecordRevision[] {
  if (seal === null) return Object.freeze([]);
  return Object.freeze(allCurrentRevisions(store, ["check-receipt"])
    .filter((receipt) => {
      const target = relationshipTarget(receipt, "checks-seal", "candidate-seal");
      return receipt.payload.phase === "final" && target !== null && sameReference(target, seal);
    })
    .sort((left, right) => compareCodePoints(left.recordId, right.recordId)));
}

export function materializeFoundationAgentCapabilityV7(input: Readonly<{
  boundary: ControlRecordRevision;
  repository: Pick<FoundationLoadedRepositoryEpoch, "contract">;
  role: AgentAttemptRole;
}>): Readonly<{
  profile: Readonly<{ id: string; digest: Sha256 }>;
  materialized: ProviderInputV4Capability;
}> {
  const selected = object(input.boundary.payload.capabilityProfile, "Work Boundary Capability Profile");
  const id = string(selected.id, "Work Boundary Capability Profile identity");
  const profile: FoundationCapabilityProfile | undefined = input.repository.contract.capabilityProfiles[id];
  const selectedDigest = digest(selected.digest, "Work Boundary Capability Profile digest");
  if (profile === undefined || profile.id !== id || profile.digest !== selectedDigest) {
    fail("capability", "Work Boundary does not select one exact repository Capability Profile");
  }
  if (input.role === "builder" && !profile.candidateWrites) {
    fail("capability", "Builder operation requires the selected Capability Profile to permit Candidate writes");
  }
  if (profile.network.mode === "bounded-egress") {
    fail(
      "capability",
      "The selected Foundation Docker execution profile does not support Agent product egress",
    );
  }
  const materialized: ProviderInputV4Capability = Object.freeze({
    candidateWrites: input.role === "builder",
    temporaryWrites: profile.temporaryWrites,
    subprocesses: profile.subprocesses,
    network: profile.network.mode,
    credentials: profile.credentials,
    externalEffects: input.role === "builder" ? profile.externalEffects : Object.freeze([]),
  });
  return Object.freeze({
    profile: Object.freeze({ id: profile.id, digest: profile.digest }),
    materialized,
  });
}

export function compileFoundationAgentInvestmentV7(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  operation: FoundationAgentOperationV7 | "delivery.prepare";
  configuration: FoundationInstalledRuntimeConfigurationV7;
}>): AgentAttemptInvestment {
  const activityId = controlIdentifier(input.activityId, "Agent Investment activity identity");
  const rationale: Readonly<Record<FoundationAgentOperationV7 | "delivery.prepare", string>> = Object.freeze({
    "delivery.prepare": "fresh-reconnaissance",
    "delivery.continue": "fresh-candidate-development",
    "delivery.evaluate": "fresh-independent-review",
    "delivery.revise": "fresh-boundary-revision-reconnaissance",
    "delivery.reaffirm": "fresh-boundary-reaffirmation-reconnaissance",
  });
  const value = Object.freeze({
    id: `investment-${digestCanonical({
      schema: "lifecycle.agent-investment-identity.v1",
      storeId: input.store.identity.storeId,
      processId: input.store.identity.processId,
      activityId,
      operation: input.operation,
    }).slice("sha256:".length)}`,
    model: input.configuration.model,
    reasoning: input.configuration.reasoning,
    wallTimeMs: PROVIDER_TIMEOUT_MS,
    limits: Object.freeze({
      tokens: null,
      events: 10_000,
      outputBytes: 1024 * 1024,
      toolCalls: null,
      processes: 64,
      storageBytes: 256 * 1024 * 1024,
    }),
    rationale: rationale[input.operation],
  });
  return Object.freeze({ ...value, digest: digestCanonical(value) });
}

export function compileFoundationAgentRoleSubjectV7(input: Readonly<{
  operation: FoundationAgentOperationV7;
  role: AgentAttemptRole;
  semanticMarkdown: string;
  projection: FoundationCompiledProjection;
  repositoryEpochDigest: Sha256;
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
  seal: ControlRecordRevision | null;
  materialCondition: ControlRecordRevision | null;
  evidenceSetDigest: Sha256 | null;
  propositionSetDigest: Sha256 | null;
}>): ControlJsonObject {
  const semanticMarkdown = normalizedFounderMarkdown(input.semanticMarkdown);
  return Object.freeze({
    schema: "lifecycle.agent-role-subject.v3",
    operation: input.operation,
    role: input.role,
    founderDirectionDigest: sha256Bytes(semanticMarkdown),
    repositoryEpochDigest: input.repositoryEpochDigest,
    projectionDigest: input.projection.manifest.digest,
    boundary: reference(input.boundary),
    candidate: reference(input.candidate),
    seal: input.seal === null ? null : reference(input.seal),
    materialCondition: input.materialCondition === null ? null : reference(input.materialCondition),
    evidenceSetDigest: input.evidenceSetDigest,
    propositionSetDigest: input.propositionSetDigest,
  });
}

function assertCompiledProjection(
  projection: FoundationCompiledProjection,
  operation: FoundationAgentOperationV7,
): void {
  const role = roleFor(operation);
  const expectedClass = role === "reconnaissance" ? "orientation" : "execution";
  if (projection.manifest.role !== role || projection.manifest.class !== expectedClass) {
    fail("projection", "Compiled Projection does not match the selected operation role");
  }
}

function retainedRevision(
  store: ControlRecordStore,
  selected: Readonly<{ id: string; revision: number; digest: Sha256 }>,
  kind: string,
  label: string,
): ControlRecordRevision {
  const revision = store.getRevision(selected.id, selected.revision);
  if (
    revision === null || revision.processId !== store.identity.processId ||
    revision.recordKind !== kind || revision.digest !== selected.digest
  ) fail("retained-subject", `${label} does not resolve one exact retained ${kind} revision`);
  assertDeliveryControlRecordPayload(revision);
  return revision;
}

function allJournalEvents(store: ControlRecordStore): readonly ControlRecordEvent[] {
  const values: ControlRecordEvent[] = [];
  let after = 0;
  for (;;) {
    const page = store.listEvents(after, 10_000);
    values.push(...page);
    if (values.length > 100_000) {
      fail("journal-bound", "Retained Agent context cannot inspect a Journal beyond its fixed bound");
    }
    if (page.length < 10_000) return Object.freeze(values);
    after = page.at(-1)!.sequence;
  }
}

function activityEvents(
  store: ControlRecordStore,
  activityId: string,
): readonly ControlRecordEvent[] {
  return Object.freeze(allJournalEvents(store).filter((event) =>
    event.payload.activityId === activityId));
}

function exactRetainedBrief(
  store: ControlRecordStore,
  support: FoundationAgentOperationSupportV7,
): ControlRecordRevision {
  const brief = retainedRevision(store, support.brief, "founder-brief", "Retained Founder Brief");
  const submission = object(brief.payload.submission, "Retained Founder Brief submission");
  const normalized = normalizedFounderMarkdown(brief.semanticMarkdown);
  const semanticDigest = sha256Bytes(normalized);
  const normalizedBytes = Buffer.byteLength(normalized, "utf8");
  const events = activityEvents(store, support.activityId);
  const submitted = events.filter(({ eventKind }) => eventKind === "founder-brief-submitted");
  const started = events.filter(({ eventKind }) => eventKind === "activity-started");
  if (
    brief.payload.schema !== "lifecycle.founder-brief-payload.v1" ||
    brief.payload.inputProfile !== support.operation ||
    brief.semanticMarkdown !== normalized ||
    brief.payload.semanticMarkdownDigest !== semanticDigest ||
    submission.rawDigest !== support.opening.founderSubmissionRawDigest ||
    submission.rawByteLength !== support.opening.founderSubmissionRawByteLength ||
    submission.normalizedByteLength !== normalizedBytes ||
    support.opening.founderSemanticDigest !== semanticDigest ||
    support.opening.founderSemanticByteLength !== normalizedBytes ||
    brief.createdAt !== support.opening.submittedAt ||
    brief.semanticAuthor.kind !== "founder" ||
    brief.semanticAuthor.id !== support.opening.founderId ||
    submitted.length !== 1 || submitted[0]!.occurredAt !== support.opening.submittedAt ||
    submitted[0]!.subject === null ||
    submitted[0]!.subject.recordId !== brief.recordId ||
    submitted[0]!.subject.revision !== brief.revision ||
    submitted[0]!.subject.digest !== brief.digest ||
    submitted[0]!.actor.kind !== "runtime" ||
    submitted[0]!.actor.id !== support.opening.runtimeId ||
    started.length !== 1 || started[0]!.occurredAt !== support.opening.startedAt ||
    started[0]!.subject !== null || started[0]!.payload.operation !== support.operation ||
    started[0]!.actor.kind !== "runtime" || started[0]!.actor.id !== support.opening.runtimeId
  ) {
    fail(
      "retained-brief",
      "Retained Founder Brief normalized semantics and opening facts do not reproduce one activity",
    );
  }
  // The raw submission is intentionally not retained. Its digest and byte
  // length are compared as retained facts; normalized Markdown is never
  // misrepresented as a reconstruction of those discarded bytes.
  return brief;
}

function retainedOperationSubjects(
  store: ControlRecordStore,
  support: FoundationAgentOperationSupportV7,
): ExactOperationSubjects {
  if (support.boundary === null || support.attemptedCandidate === null) {
    fail("retained-subject", "Admitted Agent activity lacks its retained Boundary or Candidate");
  }
  const boundary = retainedRevision(
    store,
    support.boundary,
    "work-boundary",
    "Retained Agent Work Boundary",
  );
  const candidate = retainedRevision(
    store,
    support.attemptedCandidate,
    "candidate-revision",
    "Retained attempted Candidate",
  );
  exactRelationship(candidate, "governed-by", boundary, "Retained attempted Candidate");
  const state = store.state();
  if (state.subjects.activeBoundary === null || !sameReference(state.subjects.activeBoundary, boundary)) {
    fail("retained-subject", "Retained Agent Work Boundary is no longer the reducer-selected Boundary");
  }
  const currentCandidate = exactCurrentRevision(
    store,
    state.subjects.candidate,
    "candidate-revision",
    "Current Candidate",
  );
  const expectedCurrent = support.resultCandidate === null
    ? candidate
    : retainedRevision(
        store,
        support.resultCandidate,
        "candidate-revision",
        "Retained result Candidate",
      );
  if (!sameReference(state.subjects.candidate, expectedCurrent)) {
    fail("retained-subject", "Reducer-selected Candidate differs from the retained Agent coordinate");
  }
  exactRelationship(currentCandidate, "governed-by", boundary, "Current Candidate");
  const currentSeal = state.subjects.seal === null
    ? null
    : exactCurrentRevision(store, state.subjects.seal, "candidate-seal", "Current Candidate Seal");
  const materialCondition = state.subjects.materialCondition === null
    ? null
    : exactCurrentRevision(
        store,
        state.subjects.materialCondition,
        "material-condition",
        "Current Material Condition",
      );
  let seal: ControlRecordRevision | null = currentSeal;
  if (support.role === "reviewer") {
    if (support.seal === null) fail("retained-subject", "Reviewer activity has no retained Candidate Seal");
    seal = retainedRevision(store, support.seal, "candidate-seal", "Retained review Candidate Seal");
    if (currentSeal === null || !sameReference(state.subjects.seal, seal)) {
      fail("retained-subject", "Retained review Seal is no longer reducer-selected");
    }
  } else if (support.seal !== null) {
    fail("retained-subject", "Only review may retain an Agent Attempt Candidate Seal");
  }
  if (seal !== null) {
    exactRelationship(seal, "seals", candidate, "Retained Candidate Seal");
    exactRelationship(seal, "governed-by", boundary, "Retained Candidate Seal");
  }
  if (materialCondition !== null) {
    exactRelationship(materialCondition, "freezes", candidate, "Current Material Condition");
    exactRelationship(materialCondition, "governed-by", boundary, "Current Material Condition");
  }
  if (support.role === "builder" && (seal !== null || materialCondition !== null)) {
    fail("retained-subject", "Builder recovery requires an unsealed, unpaused Candidate basis");
  }
  if (support.role === "reviewer" && (seal === null || materialCondition !== null)) {
    fail("retained-subject", "Reviewer recovery requires the exact sealed, unpaused Candidate basis");
  }
  if (support.role === "reconnaissance" && materialCondition === null) {
    fail("retained-subject", "Boundary-resolution recovery requires the exact Material Condition");
  }
  return Object.freeze({ boundary, candidate, seal, materialCondition });
}

function assertAttemptRelationship(
  attempt: ControlRecordRevision,
  relation: string,
  kind: string,
  expected: ControlRecordRevision,
): void {
  const matches = attempt.relationships.filter(({ relation: selected }) => selected === relation);
  if (
    matches.length !== 1 || matches[0]!.target.kind !== kind ||
    !sameReference(matches[0]!.target, expected)
  ) fail("retained-attempt", `Retained Agent Attempt does not bind exact ${relation}`);
}

function exactRetainedAttempt(
  store: ControlRecordStore,
  support: FoundationAgentOperationSupportV7,
  brief: ControlRecordRevision,
  context: FoundationFreshAgentOperationContextV7,
): ControlRecordRevision | null {
  if (support.plan === null) fail("retained-plan", "Agent activity has no retained execution plan");
  const plan = support.plan;
  const attempt = support.attempt === null
    ? null
    : retainedRevision(store, support.attempt, "agent-attempt", "Retained Agent Attempt");
  const projection = context.projection.manifest;
  const providerInput = context.providerInput;
  const evidenceSetDigest = context.evidenceSet?.digest ?? null;
  const propositionSetDigest = context.propositionSet?.digest ?? null;
  if (
    plan.projection.id !== projection.projectionId ||
    plan.projection.class !== projection.class ||
    plan.projection.profileId !== projection.profile ||
    plan.projection.digest !== projection.digest ||
    plan.roleSubjectDigest !== digestCanonical(context.roleSubject) ||
    plan.capabilityProfile.id !== context.capabilityProfile.id ||
    plan.capabilityProfile.digest !== context.capabilityProfile.digest ||
    plan.capabilityDigest !== digestCanonical(context.providerCapability) ||
    plan.providerInput.manifestDigest !== providerInput.manifestDigest ||
    plan.providerInput.bundleDigest !== providerInput.bundleDigest ||
    plan.providerInput.roleBriefDigest !== providerInput.roleBrief.digest ||
    plan.providerInput.templateProfileId !== providerInput.semanticTemplate.profileId ||
    plan.providerInput.templateDigest !== providerInput.semanticTemplate.digest ||
    plan.providerInput.contentInventoryDigest !== providerInput.contentInventoryDigest ||
    plan.providerInput.inputMaterialDigest !== providerInput.inputMaterialDigest ||
    plan.providerInput.citationRegistryDigest !== providerInput.citationRegistryDigest ||
    plan.providerInput.rootTokenSetDigest !== providerInput.rootTokenSetDigest ||
    plan.evidenceSetDigest !== evidenceSetDigest ||
    plan.propositionSetDigest !== propositionSetDigest ||
    digestCanonical(support.opening.investment) !== digestCanonical(context.investment)
  ) fail("retained-plan", "Recompiled Agent context differs from its immutable activity plan");
  if (attempt === null) return null;
  const attemptProjection = object(attempt.payload.projection, "Retained Agent Attempt Projection");
  const attemptCapability = object(attempt.payload.capability, "Retained Agent Attempt capability");
  const attemptInvestment = object(attempt.payload.investment, "Retained Agent Attempt Investment");
  const provider = object(attempt.payload.provider, "Retained Agent Attempt provider");
  const execution = object(attempt.payload.execution, "Retained Agent Attempt execution");
  const backendProfile = object(
    execution.backendProfile,
    "Retained Agent Attempt Backend Profile",
  );
  const image = object(execution.image, "Retained Agent Attempt Execution Image");
  const inputSet = object(execution.inputSet, "Retained Agent Attempt Input Set");
  const executionPolicy = object(
    attempt.payload.executionPolicy,
    "Retained Agent Attempt execution policy",
  );
  const authoring = object(attempt.payload.authoring, "Retained Agent Attempt authoring");
  const attemptInput = object(attempt.payload.input, "Retained Agent Attempt input");
  const expectedInvocationId = `provider-invocation-${digestCanonical({
    recordKind: "agent-attempt",
    storeId: store.identity.storeId,
    processId: store.identity.processId,
    activityId: support.activityId,
  }).slice("sha256:".length)}`;
  if (
    attempt.payload.schema !== "lifecycle.agent-attempt-payload.v3" ||
    attempt.payload.activityId !== support.activityId ||
    attempt.payload.invocationId !== expectedInvocationId ||
    attempt.payload.operation !== support.operation || attempt.payload.role !== support.role ||
    attempt.producer.kind !== "runtime" || attempt.producer.id !== support.opening.runtimeId ||
    attempt.semanticAuthor.kind !== "runtime" ||
    attempt.semanticAuthor.id !== support.opening.runtimeId ||
    attempt.createdAt !== plan.attemptCreatedAt ||
    attempt.payload.preDispatchStateDigest !== plan.preDispatchStateDigest ||
    attempt.payload.roleSubjectDigest !== plan.roleSubjectDigest ||
    attemptProjection.id !== plan.projection.id ||
    attemptProjection.profileId !== plan.projection.profileId ||
    attemptProjection.digest !== plan.projection.digest ||
    attemptCapability.profileId !== plan.capabilityProfile.id ||
    attemptCapability.profileDigest !== plan.capabilityProfile.digest ||
    attemptCapability.effectiveGrantDigest !== plan.capabilityDigest ||
    digestCanonical(attemptInvestment) !== digestCanonical(support.opening.investment) ||
    provider.descriptorId !== FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR.id ||
    provider.descriptorDigest !== FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR.digest ||
    provider.adapter !== "lifecycle.provider-adapter.v6" ||
    provider.executableIdentityClass !==
      FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR.provider.executableIdentityClass ||
    support.coordinate === null || provider.installedIdentityDigest !== support.coordinate.executableIdentity ||
    support.execution === null ||
    support.execution.specificationDigest !== support.coordinate.effectDigest ||
    backendProfile.profileId !== support.execution.backendProfile.profileId ||
    backendProfile.profileDigest !== support.execution.backendProfile.profileDigest ||
    backendProfile.implementationDigest !==
      support.execution.backendProfile.implementationDigest ||
    typeof image.imageId !== "string" || image.imageId.length === 0 ||
    !/^sha256:[a-f0-9]{64}$/u.test(String(image.imageDigest)) ||
    inputSet.profileId !== "lifecycle.execution-input-set.v1" ||
    !/^sha256:[a-f0-9]{64}$/u.test(String(inputSet.digest)) ||
    Object.keys(executionPolicy).sort().join("\0") !== [
      "cancellationPolicyDigest",
      "containmentPolicyDigest",
      "parentLossPolicyDigest",
      "recoveryPolicyDigest",
      "retirementPolicyDigest",
    ].sort().join("\0") ||
    Object.values(executionPolicy).some((value) =>
      typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) ||
    new Set(Object.values(executionPolicy)).size !== 5 ||
    authoring.roleBriefDigest !== plan.providerInput.roleBriefDigest ||
    authoring.templateProfileId !== plan.providerInput.templateProfileId ||
    authoring.templateDigest !== plan.providerInput.templateDigest ||
    authoring.parserProfileId !== FOUNDATION_AGENT_WORK_PRODUCT_PARSER_PROFILE_ID ||
    authoring.parserProfileDigest !== agentWorkProductParserProfileDigest() ||
    authoring.compilerProfileId !== FOUNDATION_AGENT_WORK_PRODUCT_COMPILER_PROFILE_ID ||
    authoring.compilerProfileDigest !== agentWorkProductCompilerProfileDigest() ||
    authoring.submissionPolicy !== "explicit-or-clean-natural-completion" ||
    !/^sha256:[a-f0-9]{64}$/u.test(String(attemptInput.contentInventoryDigest)) ||
    attemptInput.inputMaterialDigest !== plan.providerInput.inputMaterialDigest ||
    attemptInput.citationRegistryDigest !== plan.providerInput.citationRegistryDigest ||
    attemptInput.evidenceSetDigest !== plan.evidenceSetDigest ||
    attemptInput.propositionSetDigest !== plan.propositionSetDigest
  ) fail("retained-attempt", "Retained Agent Attempt differs from its exact context bindings");
  const expectedRelationshipCount = context.attemptSeal === null ? 3 : 4;
  if (attempt.relationships.length !== expectedRelationshipCount) {
    fail("retained-attempt", "Retained Agent Attempt has an unexpected relationship set");
  }
  assertAttemptRelationship(attempt, "uses-brief", "founder-brief", brief);
  assertAttemptRelationship(attempt, "uses-boundary", "work-boundary", context.boundary);
  assertAttemptRelationship(attempt, "uses-candidate", "candidate-revision", context.candidate);
  if (context.attemptSeal !== null) {
    assertAttemptRelationship(attempt, "uses-seal", "candidate-seal", context.attemptSeal);
  }
  return attempt;
}

async function compileExplicitAgentOperationContextV7(
  input: ExplicitAgentOperationContextV7Input,
  options: FoundationFreshAgentOperationContextV7Options = {},
): Promise<FoundationFreshAgentOperationContextV7> {
  const activityId = controlIdentifier(input.activityId, "Agent operation activity identity");
  const operation = input.operation;
  const role = roleFor(operation);
  const semanticMarkdown = normalizedFounderMarkdown(input.semanticMarkdown);
  const subjects = input.subjects;
  const owners = resolvedOwners(options);
  const repository = await admittedRepositoryObservation(
    input.target,
    input.store,
    subjects.boundary,
    owners,
  );
  let snapshot: FoundationLoadedRepositorySnapshot | null = null;
  let repositoryValidation: FoundationValidationResult | null = null;
  let knowledge: FoundationKnowledgeSet | null =
    repository.knowledgeResult.validation.complete && repository.knowledgeResult.validation.valid
      ? repository.knowledgeResult.knowledgeSet
      : null;
  let request: FoundationProjectionRequest;
  let subject: FoundationExecutionProjectionSubject | null;
  let projection: FoundationCompiledProjection;
  if (role === "reconnaissance") {
    if (
      (operation !== "delivery.revise" && operation !== "delivery.reaffirm") ||
      subjects.materialCondition === null
    ) fail("operation-coordinate", "Reconnaissance context requires one exact boundary-resolution basis");
    const objective = boundaryResolutionObjective({
      operation,
      boundary: subjects.boundary,
      candidate: subjects.candidate,
      materialCondition: subjects.materialCondition,
      founderRationale: semanticMarkdown,
    });
    request = compileFoundationOrientationProjectionRequestV7({
      epoch: repository.epoch,
      knowledge: repository.knowledgeResult,
      semanticMarkdown: objective,
    });
    const compiled = await owners.compileKnowledgeProjection(Object.freeze({
      request,
      repository: repository.epoch,
      knowledge: repository.knowledgeResult,
      ...(input.observedAt === undefined ? {} : { observedAt: input.observedAt }),
    }));
    if (compiled.projection === null || !compiled.validation.complete || !compiled.validation.valid) {
      fail("projection", "Orientation Projection did not compile completely and validly", {
        validationDigest: compiled.validation.digest,
        diagnostics: compiled.validation.diagnostics.map(({ code }) => code),
      });
    }
    subject = null;
    projection = compiled.projection;
  } else {
    const reviewerObservation = input.reviewerObservation;
    if ((role === "reviewer") !== (reviewerObservation !== null)) {
      fail("reviewer-observation", "Only reviewer context requires one exact sealed Candidate observation");
    }
    const basis = await executionRepositoryBasis(repository, subjects.boundary, owners);
    snapshot = basis.snapshot;
    repositoryValidation = basis.repositoryValidation;
    knowledge = basis.knowledge;
    const executionRequest = compileFoundationExecutionProjectionRequestV7({
      snapshot: basis.snapshot,
      repositoryValidation: basis.repositoryValidation,
      knowledge: basis.knowledge,
      boundary: subjects.boundary,
      candidate: subjects.candidate,
      seal: role === "reviewer" ? subjects.seal : null,
      role,
    });
    request = executionRequest;
    const executionSubject = compileFoundationExecutionProjectionSubjectV7({
      snapshot: basis.snapshot,
      knowledge: basis.knowledge,
      boundary: subjects.boundary,
      request: executionRequest,
      role,
    });
    subject = executionSubject;
    const checkReceipts = role === "reviewer"
      ? applicableCheckReceipts(input.store, subjects.seal)
      : Object.freeze([]);
    const agentWorkProducts = applicableWorkProducts(
      input.store,
      subjects.boundary,
      input.excludedWorkProductActivityId,
    );
    const compile = async (
      candidateObservation: FoundationReviewerProjectionObservation | null,
      candidateObjectRepository: string | null,
    ) => await owners.compileKnowledgeProjection(Object.freeze({
        request: executionRequest,
        repository: basis.snapshot,
        repositoryValidation: basis.repositoryValidation,
        knowledge: basis.knowledge,
        subject: executionSubject,
        workBoundary: subjects.boundary,
        candidateObservation,
        candidateObjectRepository,
        checkReceipts,
        agentWorkProducts,
        ...(input.observedAt === undefined ? {} : { observedAt: input.observedAt }),
      }));
    const compiled = role === "reviewer"
      ? await owners.withReviewerCandidateRepository({
          machineHome: input.machineHome,
          targetRepository: input.target,
          store: input.store,
          boundary: subjects.boundary,
          candidateRevision: subjects.candidate,
          seal: subjects.seal!,
          contract: basis.snapshot.contract,
        }, async (candidateObjectRepository, scopedObservation) => {
          if (
            reviewerObservation === null ||
            canonicalJson(reviewerObservation.seal) !== canonicalJson(scopedObservation.seal) ||
            canonicalJson(reviewerObservation.candidate) !== canonicalJson(scopedObservation.candidate) ||
            canonicalJson(reviewerObservation.treeEntries) !== canonicalJson(scopedObservation.treeEntries) ||
            reviewerObservation.knowledge.manifest.digest !== scopedObservation.knowledge.manifest.digest ||
            reviewerObservation.knowledge.validation.digest !== scopedObservation.knowledge.validation.digest ||
            reviewerObservation.diff.digest !== scopedObservation.diff.digest ||
            sha256Bytes(reviewerObservation.diff.bytes) !== sha256Bytes(scopedObservation.diff.bytes)
          ) {
            fail(
              "reviewer-observation",
              "Reviewer Projection scope differs from its exact precompiled Candidate observation",
            );
          }
          return await compile(scopedObservation, candidateObjectRepository);
        })
      : await compile(null, null);
    if (compiled.projection === null || !compiled.validation.complete || !compiled.validation.valid) {
      fail("projection", "Execution Projection did not compile completely and validly", {
        validationDigest: compiled.validation.digest,
        diagnostics: compiled.validation.diagnostics.map(({ code }) => code),
      });
    }
    projection = compiled.projection;
  }
  assertCompiledProjection(projection, operation);
  const evidenceSet = role === "reconnaissance"
    ? null
    : compileFoundationAgentEvidenceSetFromProjectionSourcesV7({
        store: input.store,
        sources: projection.manifest.sources,
      });
  const propositionSet = role === "reviewer"
    ? compileFoundationReviewerPropositionSetV7({
        store: input.store,
        boundary: subjects.boundary,
      })
    : null;
  const capability = materializeFoundationAgentCapabilityV7({
    boundary: subjects.boundary,
    repository: repository.epoch,
    role,
  });
  const roleSubject = compileFoundationAgentRoleSubjectV7({
    operation,
    role,
    semanticMarkdown,
    projection,
    repositoryEpochDigest: projectionRepositoryEpochDigest(repository.epoch),
    boundary: subjects.boundary,
    candidate: subjects.candidate,
    seal: subjects.seal,
    materialCondition: subjects.materialCondition,
    evidenceSetDigest: evidenceSet?.digest ?? null,
    propositionSetDigest: propositionSet?.digest ?? null,
  });
  const providerInput = compileProviderInputV4({
    projection,
    operation,
    roleSubjectDigest: digestCanonical(roleSubject),
    rootTokenSetDigest: FOUNDATION_AGENT_ROOT_TOKEN_SET_DIGEST_V3,
    capability: capability.materialized,
    founderSemanticMarkdown: semanticMarkdown,
  });
  const investment = input.investment;
  return Object.freeze({
    activityId,
    operation,
    role,
    semanticMarkdown,
    boundary: subjects.boundary,
    candidate: subjects.candidate,
    attemptSeal: role === "reviewer" ? subjects.seal : null,
    seal: subjects.seal,
    materialCondition: subjects.materialCondition,
    epoch: repository.epoch,
    snapshot,
    repositoryValidation,
    knowledge,
    request,
    subject,
    projection,
    roleSubject,
    capabilityProfile: capability.profile,
    providerCapability: capability.materialized,
    providerInput,
    evidenceSet,
    propositionSet,
    investment,
    rootTokenSetDigest: FOUNDATION_AGENT_ROOT_TOKEN_SET_DIGEST_V3,
  });
}

/**
 * Compile every deterministic typed input required by one fresh v7 Agent
 * operation. Evaluation calls this only after its activity is atomically open
 * and the exact Candidate Seal and final Check observations are retained.
 */
export async function compileFoundationFreshAgentOperationContextV7(
  input: FoundationFreshAgentOperationContextV7Input,
  options: FoundationFreshAgentOperationContextV7Options = {},
): Promise<FoundationFreshAgentOperationContextV7> {
  const activityId = controlIdentifier(input.activityId, "Agent operation activity identity");
  const subjects = exactOperationSubjects(input.store, activityId, input.operation);
  const investment = compileFoundationAgentInvestmentV7({
    store: input.store,
    activityId,
    operation: input.operation,
    configuration: input.configuration,
  });
  return compileExplicitAgentOperationContextV7({
    target: input.target,
    machineHome: input.configuration.machineHome,
    store: input.store,
    activityId,
    operation: input.operation,
    semanticMarkdown: input.semanticMarkdown,
    subjects,
    investment,
    reviewerObservation: input.reviewerObservation ?? null,
    ...(input.observedAt === undefined ? {} : { observedAt: input.observedAt }),
    excludedWorkProductActivityId: null,
  }, options);
}

/**
 * Compile the reviewer input after Seal and final-Check preparation but before
 * the same evaluation Activity is promoted to an Agent execution plan. The
 * immutable opening supplies Founder semantics and Investment, so restart does
 * not sample installed model or reasoning defaults again.
 */
export async function compileFoundationUnpromotedReviewAgentOperationContextV7(
  input: FoundationUnpromotedReviewAgentOperationContextV7Input,
  options: FoundationFreshAgentOperationContextV7Options = {},
): Promise<FoundationUnpromotedReviewAgentOperationContextV7> {
  const activityId = controlIdentifier(input.activityId, "Unpromoted review activity identity");
  const owners = resolvedOwners(options);
  const support = owners.inspectAgentActivity(input.store, activityId, "delivery.evaluate");
  if (
    support.activityId !== activityId || support.operation !== "delivery.evaluate" ||
    support.role !== "reviewer" || support.stage !== "evaluation-opened" ||
    support.plan !== null || support.attempt !== null || support.seal !== null
  ) {
    fail(
      "unpromoted-review",
      "Reviewer context requires the exact unpromoted evaluation opening",
    );
  }
  const { digest: investmentDigest, ...investmentSubject } = support.opening.investment;
  if (digestCanonical(investmentSubject) !== investmentDigest) {
    fail("retained-investment", "Retained reviewer Investment does not reproduce its exact digest");
  }
  const brief = exactRetainedBrief(input.store, support);
  const subjects = exactOperationSubjects(input.store, activityId, "delivery.evaluate");
  const context = await compileExplicitAgentOperationContextV7({
    target: input.target,
    machineHome: input.configuration.machineHome,
    store: input.store,
    activityId,
    operation: "delivery.evaluate",
    semanticMarkdown: brief.semanticMarkdown,
    subjects,
    investment: support.opening.investment,
    reviewerObservation: input.reviewerObservation,
    ...(input.observedAt === undefined ? {} : { observedAt: input.observedAt }),
    excludedWorkProductActivityId: activityId,
  }, options);
  return Object.freeze({
    ...context,
    operation: "delivery.evaluate",
    role: "reviewer",
    configuration: Object.freeze({
      ...input.configuration,
      model: context.investment.model,
      reasoning: context.investment.reasoning,
    }),
    opening: Object.freeze({
      agentId: support.opening.agentId,
      runtimeId: support.opening.runtimeId,
      founderId: support.opening.founderId,
      submittedAt: support.opening.submittedAt,
      startedAt: support.opening.startedAt,
    }),
    brief,
  });
}

/**
 * Rehydrate deterministic Agent input from the immutable activity plan and
 * retained Control records. Installed model/reasoning defaults are deliberately
 * absent: the original Investment remains the sole execution selection.
 */
export async function compileFoundationRetainedAgentOperationContextV7(
  input: FoundationRetainedAgentOperationContextV7Input,
  options: FoundationFreshAgentOperationContextV7Options = {},
): Promise<FoundationRetainedAgentOperationContextV7> {
  const activityId = controlIdentifier(input.activityId, "Retained Agent activity identity");
  const owners = resolvedOwners(options);
  const support = owners.inspectAgentActivity(input.store, activityId, input.operation);
  if (
    support.activityId !== activityId || support.operation !== input.operation ||
    support.role !== roleFor(input.operation)
  ) {
    fail("retained-activity", "Retained Agent activity differs from the requested coordinate");
  }
  if (support.plan === null) {
    fail("retained-plan", "Retained Agent activity has not established its immutable execution plan");
  }
  const { digest: investmentDigest, ...investmentSubject } = support.opening.investment;
  if (digestCanonical(investmentSubject) !== investmentDigest) {
    fail("retained-investment", "Retained Agent Investment does not reproduce its exact digest");
  }
  const brief = exactRetainedBrief(input.store, support);
  const subjects = retainedOperationSubjects(input.store, support);
  const context = await compileExplicitAgentOperationContextV7({
    target: input.target,
    machineHome: input.configuration.machineHome,
    store: input.store,
    activityId,
    operation: input.operation,
    semanticMarkdown: brief.semanticMarkdown,
    subjects,
    investment: support.opening.investment,
    reviewerObservation: input.reviewerObservation ?? null,
    ...(input.observedAt === undefined ? {} : { observedAt: input.observedAt }),
    excludedWorkProductActivityId: activityId,
  }, options);
  const attempt = exactRetainedAttempt(input.store, support, brief, context);
  let boundaryResolutionBasis: FoundationRetainedAgentOperationContextV7["boundaryResolutionBasis"] = null;
  if (support.role === "reconnaissance" && context.knowledge !== null) {
    const snapshot = await owners.bindHistoricalRepositorySnapshot(context.epoch, context.knowledge);
    const repositoryValidation = await owners.validateLoadedHistoricalRepositorySnapshot(snapshot, {
      knowledge: context.knowledge,
    });
    if (!repositoryValidation.complete || !repositoryValidation.valid) {
      fail("retained-finalization-basis", "Boundary-resolution finalization Snapshot is not complete and valid", {
        validationDigest: repositoryValidation.digest,
        diagnostics: repositoryValidation.diagnostics.map(({ code }) => code),
      });
    }
    const admitted = admittedRepositoryBasis(context.boundary);
    if (
      snapshot.snapshot.digest !== admitted.repositorySnapshotDigest ||
      snapshot.snapshot.targetId !== input.store.identity.targetId ||
      snapshot.epoch.commit !== context.epoch.epoch.commit ||
      snapshot.epoch.tree !== context.epoch.epoch.tree ||
      snapshot.snapshot.contractDigest !== context.epoch.contract.digest ||
      snapshot.snapshot.knowledgeSetDigest !== context.knowledge.manifest.digest ||
      context.projection.manifest.basis.commit !== snapshot.epoch.commit ||
      context.projection.manifest.basis.tree !== snapshot.epoch.tree ||
      context.projection.manifest.basis.repositoryContractDigest !== snapshot.contract.digest ||
      context.projection.manifest.basis.knowledgeSetDigest !== snapshot.snapshot.knowledgeSetDigest
    ) fail("retained-finalization-basis", "Boundary-resolution finalization basis is not exact");
    boundaryResolutionBasis = Object.freeze({
      snapshot,
      knowledge: context.knowledge,
      projection: context.projection,
    });
  }
  return Object.freeze({
    ...context,
    configuration: Object.freeze({
      ...input.configuration,
      model: context.investment.model,
      reasoning: context.investment.reasoning,
    }),
    opening: Object.freeze({
      agentId: support.opening.agentId,
      runtimeId: support.opening.runtimeId,
      founderId: support.opening.founderId,
      submittedAt: support.opening.submittedAt,
      startedAt: support.opening.startedAt,
      attemptCreatedAt: support.plan.attemptCreatedAt,
    }),
    brief,
    attempt,
    boundaryResolutionBasis,
  });
}
