import { createDeliveryActivityId } from "../control/activity.js";
import { readWorkDelegationExecution } from "../control/work-delegation-execution.js";
import { compileWorkDelegationStopAppend } from "../control/work-delegation-stop.js";
import { addWorkDelegationAccounting, parseWorkDelegationPayload,
  type WorkDelegationOperation, type WorkDelegationReservation } from "../control/work-delegation.js";
import { controlIdentifier, controlTimestamp } from "../control/model.js";
import type { DeliveryControlPhysicalDisposition } from "../control/public-view.js";
import type { ControlRecordStore } from "../control/store.js";
import type { ControlRecordRevision } from "../control/types.js";
import { FoundationError } from "../error.js";
import type { FoundationProcessRuntimeConfigurationV7 } from "../installed-configuration-v7.js";
import type { FoundationRepositoryContract } from "../repository/types.js";
import { canonicalJson } from "../validation/canonical.js";
import { compileWorkDelegationDecision, type WorkDelegationDecision,
  type WorkDelegationStopReason } from "./work-delegation-policy.js";
import { compileWorkDelegationReservationForDecision,
  type WorkDelegationReservationOwners } from "./work-delegation-reservation.js";

export type WorkDelegationRuntimeObservation = Readonly<{
  physical: DeliveryControlPhysicalDisposition;
  contract: FoundationRepositoryContract;
  configuration: FoundationProcessRuntimeConfigurationV7;
}>;

export type WorkDelegationRuntimeDispatch = Readonly<{
  activityId: string;
  reservation: WorkDelegationReservation;
  startedAt: string;
  observation: WorkDelegationRuntimeObservation;
}> & (
  | Readonly<{ operation: "delivery.integrate"; standingBrief: null }>
  | Readonly<{ operation: "delivery.continue" | "delivery.evaluate"; standingBrief: ControlRecordRevision }>
);

type Stage = "observation" | "stop" | "decision" | "reservation" | "direction" | "dispatch" | "settlement";
export type WorkDelegationRuntimeDiagnostic = Readonly<{
  stage: Stage;
  code: string;
  retryable: boolean;
}>;
export type WorkDelegationRuntimeResult = Readonly<{
  /** Count only exact charged Activities observed fully settled by this call. */
  completedOperations: number;
  latestActivity: Readonly<{ activityId: string; operation: WorkDelegationOperation }> | null;
  stopReason: WorkDelegationStopReason;
  /** Last policy observation, not a substitute for a fresh public Delivery read. */
  decision: WorkDelegationDecision | null;
  diagnostic: WorkDelegationRuntimeDiagnostic | null;
}>;

export type WorkDelegationRuntimeInput = Readonly<{
  store: ControlRecordStore;
  runtimeId: string;
  /** Refresh through the existing mutation owner while its Delivery lock is held. */
  observe(): Promise<WorkDelegationRuntimeObservation>;
  /**
   * Invoke one existing operation owner without taking another Delivery lock.
   * Its installed resources must finish their ordinary finally/close lifetime
   * before this callback returns or throws. Agent owners compile the original
   * standing Brief plus this reservation into their existing atomic opening.
   */
  dispatch(input: WorkDelegationRuntimeDispatch): Promise<Readonly<{
    activityId: string;
    operation: WorkDelegationOperation;
  }>>;
}>;

export type WorkDelegationRuntimeOptions = Readonly<{
  now?: () => string;
  createActivityId?: (operation: WorkDelegationOperation) => string;
  reservationOwners?: Partial<WorkDelegationReservationOwners>;
  /** Owner-local observation seam; the fixed policy itself is not replaceable. */
  policyOwners?: Parameters<typeof compileWorkDelegationDecision>[1];
}>;

function fail(reason: string): never {
  throw new FoundationError("lifecycle.work-delegation.runtime-binding",
    "Foreground work must preserve its exact reserved operation and settled custody", {
      observedFacts: Object.freeze({ reason }),
    });
}

function diagnostic(error: unknown, stage: Stage): WorkDelegationRuntimeDiagnostic {
  // Keep caught messages, paths, provider output, arbitrary facts and change
  // assertions out of this bounded internal observation. Public projection is
  // still owned by the caller, including unknown operation outcomes.
  const known = error instanceof FoundationError && error.code.length <= 160 &&
    !/[\r\n\u2028\u2029]/u.test(error.code) && /^lifecycle\.[a-z0-9._:-]+$/u.test(error.code);
  return Object.freeze({ stage,
    code: known ? error.code : "lifecycle.work-delegation.runtime-interrupted",
    retryable: known && error.retryable });
}

function reservationStop(error: unknown): WorkDelegationStopReason {
  if (!(error instanceof FoundationError) || error.code !== "lifecycle.work-delegation.reservation-context") {
    return "observation-unavailable";
  }
  const facts = error.observedFacts;
  if (facts === null || typeof facts !== "object" || Array.isArray(facts) ||
      Object.keys(facts).length !== 1 || !("reason" in facts)) return "observation-unavailable";
  switch (facts.reason) {
    case "operations-exhausted": case "agent-attempts-exhausted": case "cell-wall-time-exhausted": return "allowance-exhausted";
    case "expired": return "delegation-expired";
    case "operation-not-delegated": return "operation-not-delegated";
    default: return "observation-unavailable";
  }
}

/** Resolve bytes only; the existing Agent opening owner validates their scope and original provenance. */
function standingBrief(store: ControlRecordStore, reservation: WorkDelegationReservation): ControlRecordRevision {
  const selected = reservation.delegation;
  const grant = store.getRevision(selected.id, selected.revision);
  if (grant === null || grant.recordKind !== "work-delegation" || grant.digest !== selected.digest ||
      grant.processId !== store.identity.processId) fail("delegation");
  const payload = parseWorkDelegationPayload(grant.payload);
  const selectedBrief = reservation.operation === "delivery.continue" ? payload.directions.continue : payload.directions.evaluate;
  const brief = selectedBrief === null ? null : store.getRevision(selectedBrief.id, selectedBrief.revision);
  if (brief === null || selectedBrief === null || brief.recordKind !== "director-brief" ||
      brief.digest !== selectedBrief.digest || brief.processId !== store.identity.processId) fail("standing-direction");
  return brief;
}

function unsettled(store: ControlRecordStore): WorkDelegationStopReason | null {
  const activities = store.state().activities;
  if (activities.some(activity => activity.recovery !== null)) return "recovery-required";
  return activities.some(activity => activity.stage !== "completed") ? "operation-in-progress" : null;
}

/**
 * Run only in the foreground under one already-held Delivery operation lock
 * and one open, verified Store. The normal operation owners retain all effects,
 * reservations and recovery. There is no runner cursor, scheduler or recovery
 * dispatch, and no authority-bearing operation can enter this dispatcher.
 *
 * Each successful iteration adds exactly one immutable operation charge under
 * the fixed grant's finite lifetime ceiling. A changed grant, missing opening,
 * unresolved Activity or ambiguous callback return ends this call.
 */
export async function runWorkDelegation(input: WorkDelegationRuntimeInput,
  options: WorkDelegationRuntimeOptions = {}): Promise<WorkDelegationRuntimeResult> {
  const runtimeId = controlIdentifier(input.runtimeId, "Delegation Runtime identity");
  const now = () => controlTimestamp((options.now ?? (() => new Date().toISOString()))(), "Delegation observation time");
  const createActivityId = options.createActivityId ?? createDeliveryActivityId;
  let completedOperations = 0;
  let latestActivity: WorkDelegationRuntimeResult["latestActivity"] = null;
  let decision: WorkDelegationDecision | null = null;
  let stage: Stage = "observation";
  const selectedGrant = input.store.state().delegation.current?.reference ?? null;
  const finish = (stopReason: WorkDelegationStopReason, failure: WorkDelegationRuntimeDiagnostic | null = null): WorkDelegationRuntimeResult =>
    Object.freeze({ completedOperations, latestActivity, stopReason, decision, diagnostic: failure });
  const foldStop = () => {
    if (unsettled(input.store) !== null) return;
    const request = input.store.getWorkDelegationStopRequest();
    if (request === null) return;
    // No pending-file exception or direct SQL bypass. Store.append owns the
    // exact request match, single-writer transaction and final custody guard.
    input.store.append(compileWorkDelegationStopAppend({ request, runtimeId, stoppedAt: now() }));
  };

  for (;;) {
    try {
      stage = "observation";
      const observation = await input.observe();
      if (observation.contract.targetId !== input.store.identity.targetId) fail("target");
      if (observation.physical.disposition !== "active") return finish("closed");
      if (observation.physical.archiveManifestDigest !== null || input.store.getSeal() !== null) fail("physical-disposition");
      stage = "stop";
      foldStop();
      stage = "decision";
      decision = compileWorkDelegationDecision({ store: input.store, physical: observation.physical, observedAt: now() }, options.policyOwners);
      if (decision.kind === "stop") return finish(decision.reason);
      if (canonicalJson(input.store.state().delegation.current?.reference ?? null) !== canonicalJson(selectedGrant)) {
        return finish("delegation-required");
      }
      const operation = decision.operation;
      stage = "reservation";
      const activityId = controlIdentifier(createActivityId(operation), "Delegated Activity identity");
      const reservation = compileWorkDelegationReservationForDecision({ store: input.store,
        contract: observation.contract, configuration: observation.configuration,
        activityId, observedAt: now(), decision }, options.reservationOwners);
      const before = input.store.state();
      if (before.activities.some(activity => activity.id === activityId)) fail("reused-activity");
      const priorActivities = new Set(before.activities.map(activity => activity.id));
      const expectedCharge = addWorkDelegationAccounting(before.delegation.charged, reservation.charges);
      stage = "direction";
      const common = { activityId, reservation, observation, startedAt: now() };
      const dispatch: WorkDelegationRuntimeDispatch = operation === "delivery.integrate"
        ? Object.freeze({ ...common, operation, standingBrief: null })
        : Object.freeze({ ...common, operation, standingBrief: standingBrief(input.store, reservation) });
      let returned: Awaited<ReturnType<WorkDelegationRuntimeInput["dispatch"]>> | null = null;
      let dispatchFailure: WorkDelegationRuntimeDiagnostic | null = null;
      stage = "dispatch";
      try { returned = await input.dispatch(dispatch); }
      catch (error) { dispatchFailure = diagnostic(error, stage); }

      stage = "settlement";
      const after = input.store.state();
      const created = after.activities.filter(activity => !priorActivities.has(activity.id));
      if (created.length === 0 && dispatchFailure !== null) {
        stage = "stop"; foldStop();
        return finish(unsettled(input.store) ?? "observation-unavailable", dispatchFailure);
      }
      if (created.length !== 1 || created[0]!.id !== activityId || created[0]!.operation !== operation) fail("activity");
      const execution = readWorkDelegationExecution({ store: input.store, activityId });
      if (execution.operation !== operation || canonicalJson(execution.reservation) !== canonicalJson(reservation) ||
          canonicalJson(after.delegation.charged) !== canonicalJson(expectedCharge)) fail("opening-charge");
      latestActivity = Object.freeze({ activityId, operation });
      const pending = unsettled(input.store);
      if (pending !== null) return finish(pending, dispatchFailure ?? diagnostic(undefined, stage));
      completedOperations += 1;
      stage = "stop"; foldStop();
      if (dispatchFailure !== null) return finish("observation-unavailable", dispatchFailure);
      stage = "settlement";
      if (returned === null || returned.activityId !== activityId || returned.operation !== operation) fail("returned-activity");
      // Only the next fresh owner observation/policy decision can authorize
      // another reservation. A successful callback alone cannot do so.
    } catch (error) {
      const reason = stage === "reservation" ? reservationStop(error) : "observation-unavailable";
      return finish(reason, diagnostic(error, stage));
    }
  }
}
