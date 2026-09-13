import type { ControlRecordRevision } from "../control/types.js";
import type { ControlRecordStore } from "../control/store.js";
import { FoundationError } from "../error.js";
import { foundationMandatoryProjectionRefusalV1 } from "../projection/mandatory-refusal.js";
import type { FoundationProcessRuntimeConfigurationV7 } from "../installed-configuration-v7.js";
import {
  operateFoundationAgentActivityV7,
  settleFoundationUnallocatedBuilderV7,
  recoverFoundationAgentActivityV7,
  type FoundationAgentOperationOpeningV7,
  type FoundationAgentOperationPreIntentContextV7,
  type FoundationAgentOperationV7Input,
  type FoundationAgentOperationV7Options,
  type FoundationAgentOperationV7Result,
  type FoundationAgentRoleControlContextV7,
} from "./agent-operation-v7.js";
import {
  finalizeCandidateDevelopmentV7,
  type FoundationCandidateDevelopmentFinalizationV7Options,
} from "./candidate-development-finalization-v7.js";
import {
  compileFoundationFreshAgentOperationContextV7,
  compileFoundationRetainedAgentOperationContextV7,
  foundationAgentPreIntentMatchesContextV7,
  sameFoundationAgentOperationContextV7,
  type FoundationBuilderAgentOperationContextV7,
  type FoundationBoundaryResolutionAgentOperationContextV7,
  type FoundationFreshAgentOperationContextV7,
  type FoundationFreshAgentOperationContextV7Options,
  type FoundationRetainedAgentOperationContextV7,
} from "./operation-context-v7.js";
import {
  finalizeFoundationWorkBoundaryResolutionV7,
  type FoundationWorkBoundaryFinalizationV7Options,
} from "./work-boundary-finalization-v7.js";

export type FoundationCandidateAgentRuntimeOperationV7 =
  | "delivery.continue"
  | "delivery.revise"
  | "delivery.reaffirm";

export type FoundationFreshCandidateAgentRuntimeV7Input = Readonly<{
  target: string;
  store: ControlRecordStore;
  configuration: FoundationProcessRuntimeConfigurationV7;
  activityId: string;
  operation: FoundationCandidateAgentRuntimeOperationV7;
  runtimeId: string;
  agentId: string;
  opening: FoundationAgentOperationOpeningV7;
}>;

export type FoundationRecoverCandidateAgentRuntimeV7Input = Readonly<{
  target: string;
  store: ControlRecordStore;
  configuration: FoundationProcessRuntimeConfigurationV7;
  activityId: string;
  operation: FoundationCandidateAgentRuntimeOperationV7;
}>;

type BoundaryFinalizationOptions = Omit<
  FoundationWorkBoundaryFinalizationV7Options,
  "machineHome"
>;

export type FoundationCandidateAgentRuntimeV7Options = Readonly<{
  context?: FoundationFreshAgentOperationContextV7Options;
  agentOperation?: FoundationAgentOperationV7Options;
  candidateFinalization?: FoundationCandidateDevelopmentFinalizationV7Options;
  boundaryFinalization?: BoundaryFinalizationOptions;
  compileFreshContext?: typeof compileFoundationFreshAgentOperationContextV7;
  compileRetainedContext?: typeof compileFoundationRetainedAgentOperationContextV7;
  operateAgent?: typeof operateFoundationAgentActivityV7;
  recoverAgent?: typeof recoverFoundationAgentActivityV7;
  finalizeCandidate?: typeof finalizeCandidateDevelopmentV7;
  finalizeBoundary?: typeof finalizeFoundationWorkBoundaryResolutionV7;
}>;

type RuntimeContext = Readonly<{
  context: FoundationBuilderAgentOperationContextV7 | FoundationBoundaryResolutionAgentOperationContextV7;
  configuration: FoundationProcessRuntimeConfigurationV7;
  opening: FoundationAgentOperationOpeningV7;
  runtimeId: string;
  agentId: string;
}>;

type CandidateRuntimeOwners = Readonly<{
  compileFreshContext: typeof compileFoundationFreshAgentOperationContextV7;
  compileRetainedContext: typeof compileFoundationRetainedAgentOperationContextV7;
  operateAgent: typeof operateFoundationAgentActivityV7;
  recoverAgent: typeof recoverFoundationAgentActivityV7;
  finalizeCandidate: typeof finalizeCandidateDevelopmentV7;
  finalizeBoundary: typeof finalizeFoundationWorkBoundaryResolutionV7;
}>;

function fail(
  code: string,
  message: string,
  observedFacts: Readonly<Record<string, unknown>> = {},
): never {
  throw new FoundationError(`lifecycle.candidate-agent-runtime-v7.${code}`, message, {
    observedFacts,
  });
}

function owners(options: FoundationCandidateAgentRuntimeV7Options): CandidateRuntimeOwners {
  return Object.freeze({
    compileFreshContext: options.compileFreshContext ?? compileFoundationFreshAgentOperationContextV7,
    compileRetainedContext: options.compileRetainedContext ?? compileFoundationRetainedAgentOperationContextV7,
    operateAgent: options.operateAgent ?? operateFoundationAgentActivityV7,
    recoverAgent: options.recoverAgent ?? recoverFoundationAgentActivityV7,
    finalizeCandidate: options.finalizeCandidate ?? finalizeCandidateDevelopmentV7,
    finalizeBoundary: options.finalizeBoundary ?? finalizeFoundationWorkBoundaryResolutionV7,
  });
}

function sameRevision(left: ControlRecordRevision, right: ControlRecordRevision): boolean {
  return left.recordKind === right.recordKind && left.recordId === right.recordId &&
    left.revision === right.revision && left.digest === right.digest;
}

function assertOperationContext(
  context: FoundationFreshAgentOperationContextV7,
  operation: FoundationCandidateAgentRuntimeOperationV7,
): asserts context is FoundationBuilderAgentOperationContextV7 | FoundationBoundaryResolutionAgentOperationContextV7 {
  if (
    context.operation !== operation
  ) fail("context", "Agent context does not reproduce the selected Candidate operation");
}

function assertPreIntentContext(
  expected: FoundationFreshAgentOperationContextV7,
  actual: FoundationAgentOperationPreIntentContextV7,
): void {
  if (!foundationAgentPreIntentMatchesContextV7(expected, actual)) {
    fail("pre-intent-substitution", "Provider pre-intent subjects differ from the compiled operation context");
  }
}

function assertRecompiledContext(
  expected: FoundationFreshAgentOperationContextV7,
  actual: FoundationRetainedAgentOperationContextV7,
): void {
  if (!sameFoundationAgentOperationContextV7(expected, actual)) {
    fail(
      "pre-intent-substitution",
      "Recompiled Agent subjects differ from the immutable Activity plan before provider intent",
    );
  }
}

function boundaryFinalizationOptions(
  configuration: FoundationProcessRuntimeConfigurationV7,
  options: FoundationCandidateAgentRuntimeV7Options,
): FoundationWorkBoundaryFinalizationV7Options {
  return Object.freeze({
    machineHome: configuration.machineHome,
    ...(options.boundaryFinalization?.now === undefined
      ? {} : { now: options.boundaryFinalization.now }),
    ...(options.boundaryFinalization?.retainBoundary === undefined
      ? {} : { retainBoundary: options.boundaryFinalization.retainBoundary }),
    ...(options.boundaryFinalization?.checkOperation === undefined
      ? {} : { checkOperation: options.boundaryFinalization.checkOperation }),
    ...(options.boundaryFinalization?.checkCellOperator === undefined
      ? {} : { checkCellOperator: options.boundaryFinalization.checkCellOperator }),
  });
}

async function retainedResolutionBasis(input: Readonly<{
  target: string;
  store: ControlRecordStore;
  configuration: FoundationProcessRuntimeConfigurationV7;
  context: FoundationFreshAgentOperationContextV7;
  owners: CandidateRuntimeOwners;
  options: FoundationCandidateAgentRuntimeV7Options;
}>): Promise<NonNullable<FoundationRetainedAgentOperationContextV7["boundaryResolutionBasis"]>> {
  if (input.context.operation !== "delivery.revise" && input.context.operation !== "delivery.reaffirm") {
    fail("finalization", "Only Boundary resolution can compile a resolution finalization basis");
  }
  const retained = await input.owners.compileRetainedContext({
    target: input.target,
    store: input.store,
    configuration: input.configuration,
    activityId: input.context.activityId,
    operation: input.context.operation,
  }, input.options.context);
  if (
    retained.boundaryResolutionBasis === null ||
    !sameRevision(retained.boundary, input.context.boundary) ||
    !sameRevision(retained.candidate, input.context.candidate) ||
    retained.projection.manifest.digest !== input.context.projection.manifest.digest
  ) fail("finalization-basis", "Retained Boundary resolution basis differs from the Agent operation");
  return retained.boundaryResolutionBasis;
}

async function agentRequest(input: Readonly<{
  target: string;
  store: ControlRecordStore;
  runtime: RuntimeContext;
  owners: CandidateRuntimeOwners;
  options: FoundationCandidateAgentRuntimeV7Options;
}>): Promise<FoundationAgentOperationV7Input> {
  const { context } = input.runtime;
  const revalidateBeforeIntent = async (actual: FoundationAgentOperationPreIntentContextV7): Promise<void> => {
    assertPreIntentContext(context, actual);
    const reopened = await input.owners.compileRetainedContext({
      target: input.target,
      store: input.store,
      configuration: input.runtime.configuration,
      activityId: context.activityId,
      operation: context.operation,
    }, input.options.context);
    assertRecompiledContext(context, reopened);
  };
  const finalizeRoleControl = async (
    roleContext: FoundationAgentRoleControlContextV7,
  ) => {
    if (context.operation === "delivery.continue") {
      return await input.owners.finalizeCandidate({
        ...roleContext,
        runtimeId: input.runtime.runtimeId,
      }, input.options.candidateFinalization);
    }
    const basis = await retainedResolutionBasis({
      target: input.target,
      store: input.store,
      configuration: input.runtime.configuration,
      context,
      owners: input.owners,
      options: input.options,
    });
    return await input.owners.finalizeBoundary(
      roleContext,
      basis,
      boundaryFinalizationOptions(input.runtime.configuration, input.options),
    );
  };
  return Object.freeze({
    store: input.store,
    configuration: input.runtime.configuration,
    targetRepository: input.target,
    activityId: context.activityId,
    operation: context.operation,
    runtimeId: input.runtime.runtimeId,
    agentId: input.runtime.agentId,
    opening: input.runtime.opening,
    boundary: context.boundary,
    candidate: context.candidate,
    seal: null,
    projection: context.projection,
    providerInput: context.providerInput,
    roleSubject: context.roleSubject,
    capabilityProfile: context.capabilityProfile,
    investment: context.investment,
    evidenceSetDigest: context.evidenceSet?.digest ?? null,
    propositionSet: null,
    revalidateBeforeIntent,
    finalizeRoleControl,
  });
}

/** Open and run one fresh Candidate development or Boundary-resolution activity. */
export async function operateFoundationCandidateAgentRuntimeV7(
  input: FoundationFreshCandidateAgentRuntimeV7Input,
  options: FoundationCandidateAgentRuntimeV7Options = {},
): Promise<FoundationAgentOperationV7Result> {
  const selected = owners(options);
  let context: FoundationFreshAgentOperationContextV7;
  try {
  context = await selected.compileFreshContext({
    target: input.target,
    store: input.store,
    configuration: input.configuration,
    activityId: input.activityId,
    operation: input.operation,
    semanticMarkdown: input.opening.semanticMarkdown,
    ...(input.opening.reservation === undefined ? {} : { reservation: input.opening.reservation }),
  }, options.context);
  } catch (error) {
    const refusal = foundationMandatoryProjectionRefusalV1(error);
    if (input.operation !== "delivery.continue" || refusal === null) throw error;
    settleFoundationUnallocatedBuilderV7({ store: input.store, activityId: input.activityId, runtimeId: input.runtimeId,
      opening: input.opening, refusal, now: options.agentOperation?.now ?? (() => new Date().toISOString()) });
  }
  assertOperationContext(context, input.operation);
  const request = await agentRequest({
    target: input.target,
    store: input.store,
    runtime: Object.freeze({
      context,
      configuration: input.opening.reservation === undefined ? input.configuration : Object.freeze({
        ...input.configuration, model: context.investment.model, reasoning: context.investment.reasoning,
      }),
      opening: input.opening,
      runtimeId: input.runtimeId,
      agentId: input.agentId,
    }),
    owners: selected,
    options,
  });
  return await selected.operateAgent(request, options.agentOperation);
}

/** Recover only one exact retained Candidate development or Boundary-resolution activity. */
export async function recoverFoundationCandidateAgentRuntimeV7(
  input: FoundationRecoverCandidateAgentRuntimeV7Input,
  options: FoundationCandidateAgentRuntimeV7Options = {},
): Promise<FoundationAgentOperationV7Result> {
  const selected = owners(options);
  const retained = await selected.compileRetainedContext({
    target: input.target,
    store: input.store,
    configuration: input.configuration,
    activityId: input.activityId,
    operation: input.operation,
  }, options.context);
  assertOperationContext(retained, input.operation);
  const request = await agentRequest({
    target: input.target,
    store: input.store,
    runtime: Object.freeze({
      context: retained,
      configuration: retained.configuration,
      opening: Object.freeze({
        semanticMarkdown: retained.semanticMarkdown,
        submittedAt: retained.opening.submittedAt,
        startedAt: retained.opening.startedAt,
        attemptCreatedAt: retained.opening.attemptCreatedAt,
        directorId: retained.opening.directorId,
      }),
      runtimeId: retained.opening.runtimeId,
      agentId: retained.opening.agentId,
    }),
    owners: selected,
    options,
  });
  return await selected.recoverAgent(request, options.agentOperation);
}
