import type { AgentAttemptInvestment } from "../control/agent-attempt.js";
import { FOUNDATION_DIRECTOR_BRIEF_PAYLOAD_SCHEMA } from "../constants.js";
import { controlIdentifier, normalizeSemanticMarkdown } from "../control/model.js";
import type { ControlRecordStore } from "../control/store.js";
import type { ControlJsonObject, ControlRecordRevision } from "../control/types.js";
import { FoundationError } from "../error.js";
import type { FoundationProcessRuntimeConfigurationV7 } from "../installed-configuration-v7.js";
import { assertRepositoryEpochUnmoved } from "../repository/git.js";
import { digestCanonical, sha256Bytes } from "../validation/canonical.js";
import {
  inspectFoundationAgentActivityV7,
  openFoundationAgentActivityV7,
  advanceFoundationPreparationAgentActivityV7,
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
  reopenFoundationPreparationBasisV7,
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
  reopenBasis: typeof reopenFoundationPreparationBasisV7;
  assertEpochUnmoved: typeof assertRepositoryEpochUnmoved;
}>;

export type FoundationPreparationRuntimeV7Options = Readonly<{
  context?: FoundationPreparationContextV7Options;
  agentOperation?: FoundationAgentOperationV7Options;
  boundaryFinalization: FoundationWorkBoundaryFinalizationV7Options;
  inspectAgentActivity?: typeof inspectFoundationAgentActivityV7;
  operateAgentActivity?: PreparationAgentOwner;
  recoverAgentActivity?: PreparationAgentOwner;
  reopenBasis?: typeof reopenFoundationPreparationBasisV7;
  assertEpochUnmoved?: typeof assertRepositoryEpochUnmoved;
}>;

export type FoundationFreshPreparationRuntimeV7Input = Readonly<{
  store: ControlRecordStore;
  configuration: FoundationProcessRuntimeConfigurationV7;
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
  configuration: FoundationProcessRuntimeConfigurationV7;
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
    reopenBasis: options.reopenBasis ?? reopenFoundationPreparationBasisV7,
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
    brief.recordKind !== "director-brief" ||
    brief.digest !== support.brief.digest ||
    brief.payload.schema !== FOUNDATION_DIRECTOR_BRIEF_PAYLOAD_SCHEMA ||
    brief.payload.inputProfile !== "delivery.prepare"
  ) {
    fail("retained-brief", "Preparation recovery does not resolve its exact Director Brief");
  }
  const scope = object(brief.payload.scope, "Retained Director Brief scope");
  if (digestCanonical(scope) !== digestCanonical({ kind: "activity", activityId: support.activityId })) {
    fail("retained-brief", "Preparation recovery requires its exact Activity-scoped Director Brief");
  }
  const semanticMarkdown = normalizeSemanticMarkdown(brief.semanticMarkdown);
  const submission = object(brief.payload.submission, "Retained Director Brief submission");
  if (
    semanticMarkdown !== brief.semanticMarkdown ||
    brief.payload.semanticMarkdownDigest !== sha256Bytes(semanticMarkdown) ||
    support.opening.directorSemanticDigest !== sha256Bytes(semanticMarkdown) ||
    support.opening.directorSemanticByteLength !== Buffer.byteLength(semanticMarkdown, "utf8") ||
    submission.rawDigest !== support.opening.directorSubmissionRawDigest ||
    submission.rawByteLength !== support.opening.directorSubmissionRawByteLength ||
    submission.normalizedByteLength !== support.opening.directorSemanticByteLength
  ) {
    fail("retained-brief", "Preparation recovery Director Brief differs from its retained opening facts");
  }
  // Raw Director bytes are intentionally not retained or reconstructed. The
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
    plan.propositionSetDigest !== null ||
    plan.preparationBasis?.basisDigest !== basis.digest ||
    plan.preparationBasis.snapshot.digest !== basis.snapshot.snapshot.digest
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
  configuration: FoundationProcessRuntimeConfigurationV7;
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
    preparationBasis: Object.freeze({ snapshot: basis.snapshot.snapshot, basisDigest: basis.digest }),
    runtimeId: controlIdentifier(input.runtimeId, "Preparation runtime identity"),
    agentId: controlIdentifier(input.agentId, "Preparation Agent identity"),
    opening: Object.freeze({
      semanticMarkdown: basis.semanticMarkdown,
      submittedAt: input.submittedAt,
      startedAt: input.startedAt,
      attemptCreatedAt: input.attemptCreatedAt,
      directorId: basis.epoch.contract.authority.principalId,
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
  const request = await freshPreparationRequest(input, options);
  if (input.store.state().activities.some(({ id }) => id === input.activityId)) {
    return await advanceFoundationPreparationAgentActivityV7(request, options.agentOperation);
  }
  return await owners(options).operateAgentActivity(request, options.agentOperation);
}

/** Pin exact context and retain the first Activity while Store custody is unpublished. */
export async function openFoundationPreparationRuntimeV7(input: FoundationFreshPreparationRuntimeV7Input, options: FoundationPreparationRuntimeV7Options): Promise<void> {
  openFoundationAgentActivityV7(await freshPreparationRequest(input, options));
}

async function freshPreparationRequest(input: FoundationFreshPreparationRuntimeV7Input, options: FoundationPreparationRuntimeV7Options): Promise<FoundationPreparationAgentOperationV7Input> {
  const runtimeOwners = owners(options);
  assertFoundationPreparationBasisV7(input.basis);
  assertPreparationCoordinate(input.store, input.basis);
  const basis = await runtimeOwners.reopenBasis({
    target: input.basis.epoch.repository,
    machineHome: input.configuration.machineHome,
    identity: input.store.identity,
    binding: Object.freeze({ snapshot: input.basis.snapshot.snapshot, basisDigest: input.basis.digest }),
    semanticMarkdown: input.basis.semanticMarkdown,
  }, options.context);
  const activityId = controlIdentifier(input.activityId, "Preparation activity identity");
  const investment = compileFoundationAgentInvestmentV7({
    store: input.store,
    activityId,
    operation: "delivery.prepare",
    configuration: input.configuration,
  });
  return preparationRequest({
    ...input,
    basis,
    activityId,
    investment,
    runtimeOwners,
    options,
  });
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
  const binding = support.plan?.preparationBasis;
  if (binding === undefined) fail("retained-plan", "Preparation recovery lacks its exact retained basis");
  const basis = await runtimeOwners.reopenBasis({
    target: input.target,
    machineHome: input.configuration.machineHome,
    identity: input.store.identity,
    binding,
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
