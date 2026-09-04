import type { AgentAttemptInvestment } from "../control/agent-attempt.js";
import { controlIdentifier, normalizeSemanticMarkdown } from "../control/model.js";
import type { ControlRecordStore } from "../control/store.js";
import type { ControlJsonObject, ControlRecordRevision } from "../control/types.js";
import { FoundationError } from "../error.js";
import type { FoundationInstalledRuntimeConfigurationV7 } from "../installed-configuration-v7.js";
import { assertRepositoryEpochUnmoved } from "../repository/git.js";
import { digestCanonical, sha256Bytes } from "../validation/canonical.js";
import {
  inspectFoundationAgentActivityV7,
  operateFoundationAgentActivityV7,
  recoverFoundationAgentActivityV7,
  type FoundationAgentOperationSupportV7,
  type FoundationAgentOperationV7Options,
  type FoundationPreparationAgentOperationV7Input,
  type FoundationPreparationAgentOperationV7Result,
  type FoundationPreparationAgentOperationPreIntentContextV7,
  type FoundationPreparationAgentRoleControlContextV7,
} from "./agent-operation-v7.js";
import { compileFoundationAgentInvestmentV7 } from "./operation-context-v7.js";
import {
  assertFoundationPreparationBasisV7,
  preflightFoundationPreparationBasisV7,
  type FoundationPreparationBasisV7,
  type FoundationPreparationContextV7Options,
} from "./preparation-context-v7.js";
import {
  finalizeFoundationInitialWorkBoundaryV7,
  type FoundationWorkBoundaryFinalizationV7Options,
} from "./work-boundary-finalization-v7.js";

type PreparationAgentOwner = (
  input: FoundationPreparationAgentOperationV7Input,
  options?: FoundationAgentOperationV7Options,
) => Promise<FoundationPreparationAgentOperationV7Result>;

type PreparationRuntimeOwnersV7 = Readonly<{
  inspectAgentActivity: typeof inspectFoundationAgentActivityV7;
  operateAgentActivity: PreparationAgentOwner;
  recoverAgentActivity: PreparationAgentOwner;
  preflightBasis: typeof preflightFoundationPreparationBasisV7;
  assertEpochUnmoved: typeof assertRepositoryEpochUnmoved;
}>;

export type FoundationPreparationRuntimeV7Options = Readonly<{
  context?: FoundationPreparationContextV7Options;
  agentOperation?: FoundationAgentOperationV7Options;
  boundaryFinalization: FoundationWorkBoundaryFinalizationV7Options;
  inspectAgentActivity?: typeof inspectFoundationAgentActivityV7;
  operateAgentActivity?: PreparationAgentOwner;
  recoverAgentActivity?: PreparationAgentOwner;
  preflightBasis?: typeof preflightFoundationPreparationBasisV7;
  assertEpochUnmoved?: typeof assertRepositoryEpochUnmoved;
}>;

export type FoundationFreshPreparationRuntimeV7Input = Readonly<{
  store: ControlRecordStore;
  configuration: FoundationInstalledRuntimeConfigurationV7;
  activityId: string;
  runtimeId: string;
  agentId: string;
  submittedAt: string;
  startedAt: string;
  attemptCreatedAt: string;
  basis: FoundationPreparationBasisV7;
}>;

export type FoundationRecoveredPreparationRuntimeV7Input = Readonly<{
  target: string;
  store: ControlRecordStore;
  configuration: FoundationInstalledRuntimeConfigurationV7;
  activityId: string;
  runtimeId: string;
  observedAt?: string;
}>;

function fail(
  code: string,
  message: string,
  observedFacts: Readonly<Record<string, unknown>> = {},
): never {
  throw new FoundationError(`lifecycle.preparation-runtime-v7.${code}`, message, {
    observedFacts,
  });
}

function owners(options: FoundationPreparationRuntimeV7Options): PreparationRuntimeOwnersV7 {
  return Object.freeze({
    inspectAgentActivity: options.inspectAgentActivity ?? inspectFoundationAgentActivityV7,
    operateAgentActivity: options.operateAgentActivity ?? (
      async (input, selected) => await operateFoundationAgentActivityV7(input, selected)
    ),
    recoverAgentActivity: options.recoverAgentActivity ?? (
      async (input, selected) => await recoverFoundationAgentActivityV7(input, selected)
    ),
    preflightBasis: options.preflightBasis ?? preflightFoundationPreparationBasisV7,
    assertEpochUnmoved: options.assertEpochUnmoved ?? assertRepositoryEpochUnmoved,
  });
}

function object(value: unknown, label: string): ControlJsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    fail("retained-brief", `${label} must be one exact object`);
  }
  return value as ControlJsonObject;
}

function assertPreparationCoordinate(
  store: ControlRecordStore,
  basis: FoundationPreparationBasisV7,
): void {
  const state = store.state();
  if (
    store.identity.targetId !== basis.epoch.contract.targetId ||
    state.subjects.activeBoundary !== null ||
    state.subjects.candidate !== null ||
    state.subjects.seal !== null ||
    state.subjects.materialCondition !== null
  ) {
    fail(
      "coordinate",
      "Preparation requires the exact pre-admission Delivery coordinate and preflight target",
    );
  }
}

function exactRetainedPreparationBrief(
  store: ControlRecordStore,
  support: FoundationAgentOperationSupportV7,
): ControlRecordRevision {
  const brief = store.getRevision(support.brief.id, support.brief.revision);
  if (
    brief === null ||
    brief.processId !== store.identity.processId ||
    brief.recordKind !== "founder-brief" ||
    brief.digest !== support.brief.digest ||
    brief.payload.schema !== "lifecycle.founder-brief-payload.v1" ||
    brief.payload.inputProfile !== "delivery.prepare"
  ) {
    fail("retained-brief", "Preparation recovery does not resolve its exact Founder Brief");
  }
  const semanticMarkdown = normalizeSemanticMarkdown(brief.semanticMarkdown);
  const submission = object(brief.payload.submission, "Retained Founder Brief submission");
  if (
    semanticMarkdown !== brief.semanticMarkdown ||
    brief.payload.semanticMarkdownDigest !== sha256Bytes(semanticMarkdown) ||
    support.opening.founderSemanticDigest !== sha256Bytes(semanticMarkdown) ||
    support.opening.founderSemanticByteLength !== Buffer.byteLength(semanticMarkdown, "utf8") ||
    submission.rawDigest !== support.opening.founderSubmissionRawDigest ||
    submission.rawByteLength !== support.opening.founderSubmissionRawByteLength ||
    submission.normalizedByteLength !== support.opening.founderSemanticByteLength
  ) {
    fail("retained-brief", "Preparation recovery Founder Brief differs from its retained opening facts");
  }
  // Raw Founder bytes are intentionally not retained or reconstructed. The
  // normalized semantic Markdown is the only input rehydrated for recovery.
  return brief;
}

function assertRetainedPlan(
  support: FoundationAgentOperationSupportV7,
  basis: FoundationPreparationBasisV7,
): void {
  const plan = support.plan;
  if (
    support.operation !== "delivery.prepare" ||
    support.role !== "reconnaissance" ||
    support.boundary !== null ||
    support.attemptedCandidate !== null ||
    support.seal !== null ||
    support.resultCandidate !== null ||
    plan === null ||
    plan.projection.id !== basis.projection.manifest.projectionId ||
    plan.projection.class !== "orientation" ||
    plan.projection.profileId !== basis.projection.manifest.profile ||
    plan.projection.digest !== basis.projection.manifest.digest ||
    plan.roleSubjectDigest !== digestCanonical(basis.roleSubject) ||
    plan.capabilityProfile.id !== basis.capabilityProfile.id ||
    plan.capabilityProfile.digest !== basis.capabilityProfile.digest ||
    plan.capabilityDigest !== digestCanonical(basis.providerCapability) ||
    plan.providerInput.manifestDigest !== basis.providerInput.manifestDigest ||
    plan.providerInput.bundleDigest !== basis.providerInput.bundleDigest ||
    plan.providerInput.roleBriefDigest !== basis.providerInput.roleBrief.digest ||
    plan.providerInput.templateProfileId !== basis.providerInput.semanticTemplate.profileId ||
    plan.providerInput.templateDigest !== basis.providerInput.semanticTemplate.digest ||
    plan.providerInput.contentInventoryDigest !== basis.providerInput.contentInventoryDigest ||
    plan.providerInput.inputMaterialDigest !== basis.providerInput.inputMaterialDigest ||
    plan.providerInput.citationRegistryDigest !== basis.providerInput.citationRegistryDigest ||
    plan.providerInput.rootTokenSetDigest !== basis.providerInput.rootTokenSetDigest ||
    plan.evidenceSetDigest !== null ||
    plan.propositionSetDigest !== null
  ) {
    fail("retained-plan", "Preparation recovery does not reproduce its immutable Agent plan");
  }
  const { digest, ...investment } = support.opening.investment;
  if (digestCanonical(investment) !== digest) {
    fail("retained-investment", "Preparation recovery Investment does not reproduce its exact digest");
  }
}

function assertPreIntentContext(
  input: FoundationPreparationAgentOperationPreIntentContextV7,
  expected: Readonly<{
    store: ControlRecordStore;
    activityId: string;
    projectionDigest: string;
  }>,
): void {
  if (
    input.store !== expected.store ||
    input.activityId !== expected.activityId ||
    input.operation !== "delivery.prepare" ||
    input.role !== "reconnaissance" ||
    input.boundary !== null ||
    input.candidate !== null ||
    input.seal !== null ||
    input.projection.manifest.digest !== expected.projectionDigest
  ) {
    fail("pre-intent", "Preparation pre-intent revalidation received a substituted Agent context");
  }
}

function assertFinalizationContext(
  input: FoundationPreparationAgentRoleControlContextV7,
  expected: Readonly<{ store: ControlRecordStore; activityId: string }>,
): void {
  if (
    input.store !== expected.store ||
    input.activityId !== expected.activityId ||
    input.operation !== "delivery.prepare" ||
    input.role !== "reconnaissance" ||
    input.boundary !== null ||
    input.attemptedCandidate !== null ||
    input.resultCandidate !== null ||
    input.seal !== null
  ) {
    fail("finalization", "Preparation finalization received a substituted Agent context");
  }
}

function preparationRequest(input: Readonly<{
  store: ControlRecordStore;
  configuration: FoundationInstalledRuntimeConfigurationV7;
  activityId: string;
  runtimeId: string;
  agentId: string;
  submittedAt: string;
  startedAt: string;
  attemptCreatedAt: string;
  investment: AgentAttemptInvestment;
  basis: FoundationPreparationBasisV7;
  runtimeOwners: PreparationRuntimeOwnersV7;
  options: FoundationPreparationRuntimeV7Options;
}>): FoundationPreparationAgentOperationV7Input {
  const activityId = controlIdentifier(input.activityId, "Preparation activity identity");
  const basis = input.basis;
  return Object.freeze({
    store: input.store,
    configuration: input.configuration,
    targetRepository: basis.epoch.repository,
    activityId,
    operation: "delivery.prepare",
    runtimeId: controlIdentifier(input.runtimeId, "Preparation runtime identity"),
    agentId: controlIdentifier(input.agentId, "Preparation Agent identity"),
    opening: Object.freeze({
      semanticMarkdown: basis.semanticMarkdown,
      submittedAt: input.submittedAt,
      startedAt: input.startedAt,
      attemptCreatedAt: input.attemptCreatedAt,
      founderId: basis.epoch.contract.authority.principalId,
    }),
    boundary: null,
    candidate: null,
    seal: null,
    projection: basis.projection,
    providerInput: basis.providerInput,
    roleSubject: basis.roleSubject,
    capabilityProfile: basis.capabilityProfile,
    investment: input.investment,
    evidenceSetDigest: null,
    propositionSet: null,
    revalidateBeforeIntent: async (context) => {
      assertPreIntentContext(context, {
        store: input.store,
        activityId,
        projectionDigest: basis.projection.manifest.digest,
      });
      await input.runtimeOwners.assertEpochUnmoved(basis.epoch.repository, basis.epoch.epoch);
    },
    finalizeRoleControl: async (context) => {
      assertFinalizationContext(context, { store: input.store, activityId });
      return await finalizeFoundationInitialWorkBoundaryV7(context, Object.freeze({
        snapshot: basis.snapshot,
        knowledge: basis.knowledge,
        projection: basis.projection,
      }), input.options.boundaryFinalization);
    },
  });
}

/**
 * Run fresh preparation against an already-open, created Delivery Store. Store
 * creation deliberately remains with the mutation composition owner.
 */
export async function operateFoundationPreparationRuntimeV7(
  input: FoundationFreshPreparationRuntimeV7Input,
  options: FoundationPreparationRuntimeV7Options,
): Promise<FoundationPreparationAgentOperationV7Result> {
  const runtimeOwners = owners(options);
  assertFoundationPreparationBasisV7(input.basis);
  assertPreparationCoordinate(input.store, input.basis);
  const activityId = controlIdentifier(input.activityId, "Preparation activity identity");
  const investment = compileFoundationAgentInvestmentV7({
    store: input.store,
    activityId,
    operation: "delivery.prepare",
    configuration: input.configuration,
  });
  return await runtimeOwners.operateAgentActivity(preparationRequest({
    ...input,
    activityId,
    investment,
    runtimeOwners,
    options,
  }), options.agentOperation);
}

/** Rehydrate and resume only the exact retained preparation Activity. */
export async function recoverFoundationPreparationRuntimeV7(
  input: FoundationRecoveredPreparationRuntimeV7Input,
  options: FoundationPreparationRuntimeV7Options,
): Promise<FoundationPreparationAgentOperationV7Result> {
  const runtimeOwners = owners(options);
  const activityId = controlIdentifier(input.activityId, "Preparation recovery activity identity");
  const support = runtimeOwners.inspectAgentActivity(input.store, activityId, "delivery.prepare");
  const brief = exactRetainedPreparationBrief(input.store, support);
  const basis = await runtimeOwners.preflightBasis({
    target: input.target,
    semanticMarkdown: brief.semanticMarkdown,
    ...(input.observedAt === undefined ? {} : { observedAt: input.observedAt }),
  }, options.context);
  assertFoundationPreparationBasisV7(basis);
  assertPreparationCoordinate(input.store, basis);
  assertRetainedPlan(support, basis);
  if (support.opening.runtimeId !== input.runtimeId) {
    fail("runtime", "Preparation recovery runtime identity differs from its retained opening");
  }
  const configuration = Object.freeze({
    ...input.configuration,
    model: support.opening.investment.model,
    reasoning: support.opening.investment.reasoning,
  });
  const plan = support.plan!;
  return await runtimeOwners.recoverAgentActivity(preparationRequest({
    store: input.store,
    configuration,
    activityId,
    runtimeId: support.opening.runtimeId,
    agentId: support.opening.agentId,
    submittedAt: support.opening.submittedAt,
    startedAt: support.opening.startedAt,
    attemptCreatedAt: plan.attemptCreatedAt,
    investment: support.opening.investment,
    basis,
    runtimeOwners,
    options,
  }), options.agentOperation);
}
