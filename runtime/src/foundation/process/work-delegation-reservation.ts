import { selectFoundationAgentAttemptPolicyV7 } from "../attempt/investment-policy-v7.js";
import { compileFoundationCheckCellResourceSelectionV1 } from "../check/execution-cell-v1.js";
import type { FoundationCheckCellRuntimeV1 } from "../check/execution-cell-v1.js";
import type { AgentAttemptInvestment } from "../control/agent-attempt.js";
import type { ControlRecordStore } from "../control/store.js";
import type { ControlRecordRevision } from "../control/types.js";
import {
  WORK_DELEGATION_RESERVATION_SCHEMA,
  assessWorkDelegationAllowance,
  compileWorkDelegationReservation,
  parseWorkDelegationPayload,
  type WorkDelegationAgentSelection,
  type WorkDelegationExecutionSlot,
  type WorkDelegationOperation,
  type WorkDelegationReservation,
} from "../control/work-delegation.js";
import { controlIdentifier, controlTimestamp } from "../control/model.js";
import { FoundationError } from "../error.js";
import {
  compileFoundationInstalledAgentCellInputsV1,
  selectFoundationInstalledAgentProviderV1,
} from "../execution/installed-agent-runtime-v1.js";
import { compileFoundationInstalledAgentExecutionPolicyV1 } from "../execution/installed-agent-policy-v1.js";
import { selectFoundationInstalledCheckResourcesV1 } from "../execution/installed-check-runtime-v1.js";
import type { FoundationProcessRuntimeConfigurationV7 } from "../installed-configuration-v7.js";
import type { FoundationRepositoryContract } from "../repository/types.js";
import { canonicalJson, digestCanonical, type Sha256 } from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import { deliveryWorkDecisionBasisDigest } from "./delivery-state.js";
import { finalCheckSelections } from "./evaluation-preparation-v7.js";

type AgentResources = Pick<AgentAttemptInvestment, "model" | "reasoning" | "wallTimeMs" | "limits">;

/** Deterministic substitutions stay at the installed resource seam. */
export type WorkDelegationReservationOwners = Readonly<{
  compileAgent: typeof compileFoundationInstalledAgentCellInputsV1;
  checkResources: typeof selectFoundationInstalledCheckResourcesV1;
}>;

function fail(reason: string): never {
  throw new FoundationError("lifecycle.work-delegation.reservation-context",
    "A work reservation requires a fresh justified operation and its exact retained resources", {
      observedFacts: Object.freeze({ reason }),
    });
}

function resolveAgentResources(
  configuration: FoundationProcessRuntimeConfigurationV7,
  investment: AgentResources,
  compileAgent: typeof compileFoundationInstalledAgentCellInputsV1,
): WorkDelegationAgentSelection {
  // Model and limits have the grant's lifetime. Physical installation must
  // still supply its exact descriptor, Backend and Image before opening.
  const selected = Object.freeze({ ...configuration, model: investment.model, reasoning: investment.reasoning });
  const compiled = compileAgent({ configuration: selected,
    provider: selectFoundationInstalledAgentProviderV1(selected), investment,
    executionPolicy: compileFoundationInstalledAgentExecutionPolicyV1().executionPolicy });
  const { provider, profile, image } = compiled.installed;
  return Object.freeze({
    providerDescriptor: Object.freeze({ id: provider.descriptorId, digest: provider.descriptorDigest }),
    backendProfile: Object.freeze({ profileId: profile.profileId, profileDigest: profile.digest,
      implementationDigest: profile.implementation.implementationDigest }),
    image: Object.freeze({ imageId: image.imageId, imageDigest: image.imageDigest }),
    model: investment.model, reasoning: investment.reasoning,
    wallTimeMs: investment.wallTimeMs, limits: investment.limits,
  });
}

/** Resolve current choices for an explicit new grant; this allocates nothing. */
export function selectWorkDelegationAgentResources(input: Readonly<{
  configuration: FoundationProcessRuntimeConfigurationV7;
  operation: "delivery.continue" | "delivery.evaluate";
}>, options: Pick<Partial<WorkDelegationReservationOwners>, "compileAgent"> = {}): WorkDelegationAgentSelection {
  return resolveAgentResources(input.configuration, selectFoundationAgentAttemptPolicyV7(input),
    options.compileAgent ?? compileFoundationInstalledAgentCellInputsV1);
}

type Reference = Readonly<{ id: string; revision: number; digest: Sha256 }>;

function exactRevision(store: ControlRecordStore, selected: Reference, kind: string): ControlRecordRevision {
  const revision = store.getRevision(selected.id, selected.revision);
  if (revision === null || revision.recordKind !== kind || revision.recordId !== selected.id ||
      revision.revision !== selected.revision || revision.digest !== selected.digest ||
      revision.processId !== store.identity.processId) fail("retained-subject");
  return revision;
}

/**
 * Compile complete slots for one policy decision without retaining an Activity,
 * spending allowance or touching an execution backend. Normal opening repeats
 * currentness/stop checks and makes the one atomic charge.
 */
export function compileWorkDelegationReservationForDecision(input: Readonly<{
  store: ControlRecordStore;
  contract: FoundationRepositoryContract;
  configuration: FoundationProcessRuntimeConfigurationV7;
  activityId: string;
  observedAt: string;
  decision: Readonly<{
    operation: WorkDelegationOperation;
    reason: WorkDelegationReservation["decision"]["reason"];
    basisDigest: Sha256;
    journalHead: WorkDelegationReservation["decision"]["journalHead"];
  }>;
}>, options: Partial<WorkDelegationReservationOwners> = {}): WorkDelegationReservation {
  const activityId = controlIdentifier(input.activityId, "Delegated Activity identity");
  const observedAt = controlTimestamp(input.observedAt, "Delegated work observation time");
  const state = input.store.state();
  const current = state.delegation.current;
  if (state.standing === "closed" || state.subjects.materialCondition !== null ||
      state.subjects.activeBoundary === null || state.delegation.admission === null ||
      state.activities.some(activity => activity.stage !== "completed" || activity.recovery !== null) ||
      current === null || current.stopped || input.store.getWorkDelegationStopRequest() !== null ||
      state.journal.eventCount !== input.decision.journalHead.sequence ||
      state.journal.headDigest !== input.decision.journalHead.digest ||
      deliveryWorkDecisionBasisDigest(state) !== input.decision.basisDigest ||
      !state.eligibleOperations.includes(input.decision.operation)) fail("currentness");
  const revision = exactRevision(input.store, current.reference, "work-delegation");
  const grant = parseWorkDelegationPayload(revision.payload);
  if (canonicalJson(grant.boundary) !== canonicalJson({ kind: "work-boundary", ...state.subjects.activeBoundary }) ||
      canonicalJson(grant.admission) !== canonicalJson({ kind: "director-decision", ...state.delegation.admission })) {
    fail("governing-admission");
  }
  const slots: WorkDelegationExecutionSlot[] = [];
  if (input.decision.operation !== "delivery.integrate") {
    const role = input.decision.operation === "delivery.continue" ? "builder" : "reviewer";
    const selection = grant.agentSelections[role];
    if (selection === null) fail("operation-not-delegated");
    const resolved = resolveAgentResources(input.configuration, selection,
      options.compileAgent ?? compileFoundationInstalledAgentCellInputsV1);
    if (canonicalJson(resolved) !== canonicalJson(selection)) fail("installed-selection-unavailable");
    slots.push(Object.freeze({ slotId: `slot-agent-${role}`, purpose: "agent", role, selection }));
  }
  if (input.decision.operation === "delivery.evaluate") {
    const boundary = exactRevision(input.store, state.subjects.activeBoundary, "work-boundary");
    if (input.contract.targetId !== input.store.identity.targetId) fail("target");
    const basis = boundary.payload.basis;
    if (basis === null || typeof basis !== "object" || Array.isArray(basis) ||
        !("repositoryContractDigest" in basis) || basis.repositoryContractDigest !== input.contract.digest) fail("repository-contract");
    const selected: Pick<FoundationCheckCellRuntimeV1, "profile" | "image"> =
      (options.checkResources ?? selectFoundationInstalledCheckResourcesV1)(input.configuration);
    for (const check of finalCheckSelections(boundary, input.contract)) {
      const resources = compileFoundationCheckCellResourceSelectionV1({ binding: check.binding, ...selected });
      slots.push(Object.freeze({ slotId: `slot-check-${digestCanonical({ selectionId: check.id }).slice(7)}`,
        purpose: "check", phase: "final", selectionId: check.id, definition: check.definition,
        binding: Object.freeze({ id: check.bindingId, digest: check.binding.digest }),
        backendProfile: resources.backendProfile, image: resources.image,
        wallTimeMs: resources.limits.wallTimeMilliseconds, limits: resources.limits }));
    }
  }
  const reservation = compileWorkDelegationReservation({ schema: WORK_DELEGATION_RESERVATION_SCHEMA,
    reservationId: `reservation-${digestCanonical({ storeId: input.store.identity.storeId,
      processId: input.store.identity.processId, activityId }).slice(7)}`,
    delegation: { kind: "work-delegation", ...current.reference }, activityId,
    operation: input.decision.operation,
    decision: { journalHead: input.decision.journalHead, basisDigest: input.decision.basisDigest, reason: input.decision.reason },
    slots: Object.freeze(slots.sort((left, right) => compareCodePoints(left.slotId, right.slotId))) });
  const allowance = assessWorkDelegationAllowance({ delegation: grant, accounting: state.delegation.charged,
    reservation, observedAt, stopped: current.stopped });
  if (!allowance.allowed) fail(allowance.reason);
  return reservation;
}
