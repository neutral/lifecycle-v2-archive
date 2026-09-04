import { createDeliveryActivityId } from "../control/activity.js";
import { controlIdentifier, controlTimestamp } from "../control/model.js";
import type { ControlRecordRevision } from "../control/types.js";
import type { ControlRecordStore } from "../control/store.js";
import { FoundationError } from "../error.js";
import type { FoundationInstalledRuntimeConfigurationV7 } from "../installed-configuration-v7.js";
import type { FoundationRepositoryContract } from "../repository/types.js";
import { canonicalJson } from "../validation/canonical.js";
import {
  createFoundationEvaluationEvidenceObservationOwnerV7,
  observeFoundationReviewerProjectionCandidateV7,
} from "../evidence/physical-observation-v7.js";
import {
  advancePromotedFoundationReviewAgentActivityV7,
  inspectFoundationAgentActivityKernelV7,
  promoteFoundationReviewAgentActivityV7,
  type FoundationAgentOperationV7Input,
  type FoundationAgentOperationV7Options,
  type FoundationAgentOperationV7Result,
  type FoundationAgentOperationPreIntentContextV7,
} from "./agent-operation-v7.js";
import {
  finalizeDeliveryEvaluationV7,
  type FoundationEvaluationFinalizationV7Options,
} from "./evaluation-finalization-v7.js";
import {
  prepareDeliveryEvaluationV7,
  recoverDeliveryEvaluationPreparationV7,
  type FoundationEvaluationPreparationV7Options,
} from "./evaluation-preparation-v7.js";
import {
  compileFoundationAgentInvestmentV7,
  compileFoundationRetainedAgentOperationContextV7,
  compileFoundationUnpromotedReviewAgentOperationContextV7,
  type FoundationFreshAgentOperationContextV7Options,
  type FoundationRetainedAgentOperationContextV7,
  type FoundationUnpromotedReviewAgentOperationContextV7,
} from "./operation-context-v7.js";

type ReviewContext =
  | FoundationUnpromotedReviewAgentOperationContextV7
  | FoundationRetainedAgentOperationContextV7;

type EvaluationRuntimeOwners = Readonly<{
  prepare: typeof prepareDeliveryEvaluationV7;
  recoverPreparation: typeof recoverDeliveryEvaluationPreparationV7;
  inspect: typeof inspectFoundationAgentActivityKernelV7;
  observeReviewer: typeof observeFoundationReviewerProjectionCandidateV7;
  compileUnpromoted: typeof compileFoundationUnpromotedReviewAgentOperationContextV7;
  compileRetained: typeof compileFoundationRetainedAgentOperationContextV7;
  promote: typeof promoteFoundationReviewAgentActivityV7;
  advance: typeof advancePromotedFoundationReviewAgentActivityV7;
}>;

export type FoundationEvaluationRuntimeV7Options = Readonly<{
  now?: () => string;
  createActivityId?: () => string;
  preparation?: FoundationEvaluationPreparationV7Options;
  context?: FoundationFreshAgentOperationContextV7Options;
  agentOperation?: FoundationAgentOperationV7Options;
  finalization?: FoundationEvaluationFinalizationV7Options;
  owners?: Partial<EvaluationRuntimeOwners>;
}>;

export type FoundationFreshEvaluationRuntimeV7Input = Readonly<{
  target: string;
  store: ControlRecordStore;
  contract: FoundationRepositoryContract;
  configuration: FoundationInstalledRuntimeConfigurationV7;
  semanticMarkdown: string;
  founderId: string;
  agentId: string;
  runtimeId: string;
}>;

export type FoundationRecoverEvaluationRuntimeV7Input = Readonly<{
  target: string;
  store: ControlRecordStore;
  contract: FoundationRepositoryContract;
  configuration: FoundationInstalledRuntimeConfigurationV7;
  activityId: string;
  runtimeId: string;
}>;

function fail(
  code: string,
  message: string,
  observedFacts: Readonly<Record<string, unknown>> = {},
): never {
  throw new FoundationError(`lifecycle.evaluation-runtime-v7.${code}`, message, { observedFacts });
}

function selectedOwners(options: FoundationEvaluationRuntimeV7Options): EvaluationRuntimeOwners {
  return Object.freeze({
    prepare: options.owners?.prepare ?? prepareDeliveryEvaluationV7,
    recoverPreparation: options.owners?.recoverPreparation ?? recoverDeliveryEvaluationPreparationV7,
    inspect: options.owners?.inspect ?? inspectFoundationAgentActivityKernelV7,
    observeReviewer: options.owners?.observeReviewer ?? observeFoundationReviewerProjectionCandidateV7,
    compileUnpromoted:
      options.owners?.compileUnpromoted ?? compileFoundationUnpromotedReviewAgentOperationContextV7,
    compileRetained: options.owners?.compileRetained ?? compileFoundationRetainedAgentOperationContextV7,
    promote: options.owners?.promote ?? promoteFoundationReviewAgentActivityV7,
    advance: options.owners?.advance ?? advancePromotedFoundationReviewAgentActivityV7,
  });
}

function currentRevision(
  store: ControlRecordStore,
  selected: Readonly<{ id: string; revision: number; digest: string }> | null,
  kind: string,
  label: string,
): ControlRecordRevision {
  if (selected === null) fail("current-subject", `${label} is absent from the evaluation coordinate`);
  const revision = store.getRevision(selected.id, selected.revision);
  if (revision === null || revision.recordKind !== kind || revision.digest !== selected.digest) {
    fail("current-subject", `${label} does not resolve one exact retained ${kind}`);
  }
  return revision;
}

function currentSubjects(store: ControlRecordStore): Readonly<{
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
  seal: ControlRecordRevision;
}> {
  const state = store.state();
  return Object.freeze({
    boundary: currentRevision(store, state.subjects.activeBoundary, "work-boundary", "Active Work Boundary"),
    candidate: currentRevision(store, state.subjects.candidate, "candidate-revision", "Current Candidate"),
    seal: currentRevision(store, state.subjects.seal, "candidate-seal", "Current Candidate Seal"),
  });
}

function contextOpening(
  context: ReviewContext,
  attemptCreatedAt: string,
): FoundationAgentOperationV7Input["opening"] {
  return Object.freeze({
    semanticMarkdown: context.semanticMarkdown,
    submittedAt: context.opening.submittedAt,
    startedAt: context.opening.startedAt,
    attemptCreatedAt,
    founderId: context.opening.founderId,
  });
}

function sameRevision(left: ControlRecordRevision, right: ControlRecordRevision): boolean {
  return left.recordId === right.recordId && left.revision === right.revision &&
    left.digest === right.digest && canonicalJson(left) === canonicalJson(right);
}

function assertRevalidatedContext(
  expected: FoundationAgentOperationPreIntentContextV7,
  observed: FoundationRetainedAgentOperationContextV7,
): void {
  if (
    expected.activityId !== observed.activityId || expected.operation !== "delivery.evaluate" ||
    observed.operation !== "delivery.evaluate" || observed.role !== "reviewer" ||
    !sameRevision(expected.boundary, observed.boundary) ||
    !sameRevision(expected.candidate, observed.candidate) ||
    expected.seal === null || observed.attemptSeal === null ||
    !sameRevision(expected.seal, observed.attemptSeal) ||
    expected.projection.manifest.digest !== observed.projection.manifest.digest ||
    canonicalJson(expected.projection.manifest.basis) !== canonicalJson(observed.projection.manifest.basis)
  ) {
    fail("pre-intent-drift", "Reviewer pre-intent basis differs from the exact promoted execution plan");
  }
}

async function reviewerObservation(
  input: Readonly<{
    store: ControlRecordStore;
    subjects: ReturnType<typeof currentSubjects>;
    machineHome: string;
    targetRepository: string;
    contract: FoundationRepositoryContract;
  }>,
  owners: EvaluationRuntimeOwners,
) {
  return await owners.observeReviewer({
    store: input.store,
    boundary: input.subjects.boundary,
    candidateRevision: input.subjects.candidate,
    seal: input.subjects.seal,
    machineHome: input.machineHome,
    targetRepository: input.targetRepository,
    contract: input.contract,
  });
}

function reviewerRequest(input: Readonly<{
  target: string;
  store: ControlRecordStore;
  runtimeId: string;
  context: ReviewContext;
  attemptCreatedAt: string;
  contract: FoundationRepositoryContract;
  options: FoundationEvaluationRuntimeV7Options;
  owners: EvaluationRuntimeOwners;
}>): FoundationAgentOperationV7Input & Readonly<{ operation: "delivery.evaluate" }> {
  if (input.context.attemptSeal === null || input.context.evidenceSet === null ||
      input.context.propositionSet === null) {
    fail("review-context", "Evaluation reviewer context lacks its exact Seal, Evidence, or propositions");
  }
  const configuration = "configuration" in input.context
    ? input.context.configuration
    : fail("review-context", "Evaluation reviewer context lacks retained provider configuration");
  const opening = contextOpening(input.context, input.attemptCreatedAt);
  return Object.freeze({
    store: input.store,
    configuration,
    targetRepository: input.target,
    activityId: input.context.activityId,
    operation: "delivery.evaluate",
    runtimeId: input.runtimeId,
    agentId: input.context.opening.agentId,
    opening,
    boundary: input.context.boundary,
    candidate: input.context.candidate,
    seal: input.context.attemptSeal,
    projection: input.context.projection,
    providerInput: input.context.providerInput,
    roleSubject: input.context.roleSubject,
    capabilityProfile: input.context.capabilityProfile,
    investment: input.context.investment,
    evidenceSetDigest: input.context.evidenceSet.digest,
    propositionSet: input.context.propositionSet.subject,
    revalidateBeforeIntent: async (expected) => {
      const subjects = currentSubjects(input.store);
      const observation = await reviewerObservation({
        store: input.store,
        subjects,
        machineHome: configuration.machineHome,
        targetRepository: input.target,
        contract: input.contract,
      }, input.owners);
      const observed = await input.owners.compileRetained({
        target: input.target,
        store: input.store,
        configuration,
        activityId: input.context.activityId,
        operation: "delivery.evaluate",
        reviewerObservation: observation,
      }, input.options.context);
      assertRevalidatedContext(expected, observed);
    },
    finalizeRoleControl: async (control) => await finalizeDeliveryEvaluationV7({
      ...control,
      runtimeId: input.runtimeId,
      observeEvidence: createFoundationEvaluationEvidenceObservationOwnerV7({
        machineHome: configuration.machineHome,
        targetRepository: input.target,
        contract: input.contract,
      }),
    }, input.options.finalization),
  });
}

async function advanceEvaluation(input: Readonly<{
  target: string;
  store: ControlRecordStore;
  contract: FoundationRepositoryContract;
  configuration: FoundationInstalledRuntimeConfigurationV7;
  activityId: string;
  runtimeId: string;
  preparationComplete?: boolean;
}>, options: FoundationEvaluationRuntimeV7Options): Promise<FoundationAgentOperationV7Result> {
  const owners = selectedOwners(options);
  let inspection = owners.inspect(input.store, input.activityId, "delivery.evaluate");
  let support = inspection.support;
  if (support.opening.runtimeId !== input.runtimeId) {
    fail("runtime", "Evaluation recovery runtime differs from the exact retained opening");
  }
  if (support.stage === "evaluation-opened" && input.preparationComplete !== true) {
    const prepared = await owners.recoverPreparation({
      target: input.target,
      machineHome: input.configuration.machineHome,
      store: input.store,
      contract: input.contract,
      activityId: input.activityId,
      runtimeId: input.runtimeId,
    }, options.preparation);
    if (prepared.activityId !== input.activityId) {
      fail("preparation", "Recovered evaluation preparation returned a different activity identity");
    }
    inspection = owners.inspect(input.store, input.activityId, "delivery.evaluate");
    support = inspection.support;
  }

  const subjects = currentSubjects(input.store);
  const observation = await reviewerObservation({
    store: input.store,
    subjects,
    machineHome: input.configuration.machineHome,
    targetRepository: input.target,
    contract: input.contract,
  }, owners);

  let context: ReviewContext;
  let attemptCreatedAt: string;
  if (support.stage === "evaluation-opened") {
    context = await owners.compileUnpromoted({
      target: input.target,
      store: input.store,
      configuration: input.configuration,
      activityId: input.activityId,
      reviewerObservation: observation,
    }, options.context);
    attemptCreatedAt = controlTimestamp(
      (options.now ?? (() => new Date().toISOString()))(),
      "Reviewer Attempt creation time",
    );
    const request = reviewerRequest({
      ...input,
      context,
      attemptCreatedAt,
      options,
      owners,
    });
    owners.promote(request, inspection.coordinate);
    inspection = owners.inspect(input.store, input.activityId, "delivery.evaluate");
    return await owners.advance(
      request,
      inspection.coordinate,
      options.agentOperation,
    );
  }

  context = await owners.compileRetained({
    target: input.target,
    store: input.store,
    configuration: input.configuration,
    activityId: input.activityId,
    operation: "delivery.evaluate",
    reviewerObservation: observation,
  }, options.context);
  attemptCreatedAt = context.opening.attemptCreatedAt;
  const request = reviewerRequest({
    ...input,
    context,
    attemptCreatedAt,
    options,
    owners,
  });
  return await owners.advance(
    request,
    inspection.coordinate,
    options.agentOperation,
  );
}

/** Open, prepare, promote, execute, and finalize one fresh exact evaluation. */
export async function evaluateDeliveryV7(
  input: FoundationFreshEvaluationRuntimeV7Input,
  options: FoundationEvaluationRuntimeV7Options = {},
): Promise<FoundationAgentOperationV7Result> {
  const owners = selectedOwners(options);
  const activityId = controlIdentifier(
    (options.createActivityId ?? (() => createDeliveryActivityId("delivery.evaluate")))(),
    "Evaluation activity identity",
  );
  const investment = compileFoundationAgentInvestmentV7({
    store: input.store,
    activityId,
    operation: "delivery.evaluate",
    configuration: input.configuration,
  });
  const prepared = await owners.prepare({
    target: input.target,
    machineHome: input.configuration.machineHome,
    store: input.store,
    contract: input.contract,
    semanticMarkdown: input.semanticMarkdown,
    founderId: input.founderId,
    agentId: input.agentId,
    investment,
    runtimeId: input.runtimeId,
  }, Object.freeze({
    ...options.preparation,
    createActivityId: () => activityId,
  }));
  if (prepared.activityId !== activityId) {
    fail("preparation", "Fresh evaluation preparation returned a different activity identity");
  }
  return await advanceEvaluation({ ...input, activityId, preparationComplete: true }, options);
}

/**
 * Recover one exact evaluation. Unpromoted preparation resumes Seal/Checks;
 * promoted support resumes the retained Agent coordinate and never dispatches
 * a replacement provider operation.
 */
export async function recoverDeliveryEvaluationV7(
  input: FoundationRecoverEvaluationRuntimeV7Input,
  options: FoundationEvaluationRuntimeV7Options = {},
): Promise<FoundationAgentOperationV7Result> {
  return await advanceEvaluation({
    ...input,
    activityId: controlIdentifier(input.activityId, "Evaluation recovery activity identity"),
  }, options);
}
