import type { ExplorationClause } from "./bounded-explorer.js";

function property(
  id: string,
  owner: string,
  classification: string,
  statement: string,
): ExplorationClause {
  return Object.freeze({ id, owner, classification, statement });
}

/**
 * Derived verification properties for the reducer exploration.
 *
 * These identities route back to their normative owners; they are not an
 * alternate specification and cannot make an implementation/spec conflict
 * acceptable.
 */
export const deliveryProperties = Object.freeze({
  workDelegation: property(
    "LK.WORK-DELEGATION.SET-STOP",
    "spec-source/spec/ATTEMPT_VIEW.md#work-delegation",
    "safety",
    "Setting and stopping exact finite resource permission preserves admitted work topology and operation eligibility; Stop changes only the selected permission's stopped state and does not reset lifetime charges.",
  ),
  integrationOrdering: property(
    "LK.INTEGRATION.EXACT-SUBJECT", "spec-source/spec/DELIVERY.md#explicit-integration", "safety",
    "Only a constructed Assessment advances its exact source Candidate against its selected parent; changed context requires a Condition before completion, while conflict or invalidity preserves the Candidate and evaluation remains unavailable before successful integration.",
  ),
  candidateAbsence: property(
    "LK.CANDIDATE.ABSENCE",
    "spec-source/spec/DELIVERY.md#candidate-condition",
    "safety",
    "Candidate condition is absent exactly when no current Candidate Revision exists, including while another subject carries recovery.",
  ),
  candidateCondition: property(
    "LK.CANDIDATE.CONDITION",
    "spec-source/spec/DELIVERY.md#candidate-condition",
    "safety",
    "Candidate condition agrees with every modeled phase; in particular, a recoverable Candidate-touching Activity remains in-progress at its started or prepared stage and becomes terminal-recovery only after advancing beyond preparation when no stronger projection applies.",
  ),
  standingTopology: property(
    "LK.STANDING.TOPOLOGY",
    "spec-source/spec/DELIVERY.md#standing",
    "safety",
    "Standing agrees with the current Boundary and Candidate topology.",
  ),
  subjectTopology: property(
    "LK.SUBJECT.TOPOLOGY",
    "spec-source/spec/DELIVERY.md#current-subjects",
    "safety",
    "Every modeled current-subject presence agrees with its phase; in particular, a current Candidate never appears without a current admitted Boundary.",
  ),
  recoveryEligibility: property(
    "LK.RECOVERY.ELIGIBILITY",
    "spec-source/spec/DELIVERY.md#recovery",
    "safety",
    "A modeled recovery obligation retains its exact kind, resume step, and effect binding, exposes delivery.recover, and suppresses other operations.",
  ),
  activityTopology: property(
    "LK.ACTIVITY.TOPOLOGY",
    "spec-source/spec/DELIVERY.md#activities",
    "safety",
    "The scenario has exactly its expected active Activity count, operation, family, and stage.",
  ),
  operationEligibility: property(
    "LK.OPERATION.ELIGIBILITY",
    "spec-source/spec/DELIVERY.md#eligibility",
    "safety",
    "Each modeled phase exposes exactly its independently stated operations.",
  ),
  nonterminalProgress: property(
    "LK.PROGRESS.NO-ACCIDENTAL-SINK",
    "spec-source/spec/DELIVERY.md#eligibility",
    "bounded-deadlock-freedom",
    "A modeled nonterminal Journal head exposes at least one eligible operation.",
  ),
  boundedContinuation: property(
    "LK.PROGRESS.BOUNDED-CONTINUATION",
    "spec-source/spec/DELIVERY.md#productive-completeness",
    "bounded-conditional-progress",
    "Each declared feasible retained prefix reaches its exact productive Journal outcome within its stated finite supplied-response schedule; recovery eligibility and no-ship do not satisfy that outcome.",
  ),
  terminalOrdering: property(
    "LK.TERMINAL.ORDERING",
    "spec-source/spec/DELIVERY.md#finalization-and-recovery",
    "safety",
    "Closure is the final modeled Journal event and leaves no active Journal Activity or reducer-local operation.",
  ),
  journalCount: property(
    "LK.JOURNAL.COUNT",
    "spec-source/spec/CONTROL.md#event-source",
    "safety",
    "The derived Journal event count equals the exact replayed history length.",
  ),
  preparationRecovery: property(
    "LK.PREPARE.RECOVERY",
    "spec-source/spec/DELIVERY.md#delivery-creation-and-preparation",
    "safety",
    "Preparation recovery registration is accepted only at its exact current durable coordinate and preserves recover-only eligibility.",
  ),
  initialAdmissionOrdering: property(
    "LK.INITIAL-ADMISSION.ORDERING",
    "spec-source/spec/DELIVERY.md#transaction-activity",
    "safety",
    "Initial-admission authority, effect intent, effect observation, Candidate initialization, and completion are ordered.",
  ),
  noShipOrdering: property(
    "LK.NO-SHIP.ORDERING",
    "spec-source/spec/DELIVERY.md#transaction-activity",
    "safety",
    "No-ship intent precedes effect observation, and only an applied effect permits Closure.",
  ),
});
