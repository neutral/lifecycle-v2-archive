import type { ExplorationFinding } from "./bounded-explorer.js";
import type { DeliveryOracle, DeliveryOracleModel } from "./delivery-oracle.js";
import { deliveryProperties } from "./delivery-properties.js";

// Product-free finite oracle: one admitted, settled seed, one exact permission,
// and its exact Stop. Replacement, reservations, concurrency and physical work
// remain covered by their separate owner tests, not this three-prefix course.
export const workDelegationOracle: DeliveryOracle = Object.freeze({
  id: "work-delegation-set-stop",
  clauses: Object.freeze([deliveryProperties.workDelegation, deliveryProperties.subjectTopology,
    deliveryProperties.operationEligibility, deliveryProperties.journalCount]),
  bounds: Object.freeze({ maxDepth: 3, maxNodes: 8, maxTransitions: 16 }),
  requiredCoverage: Object.freeze({
    phases: Object.freeze(["absent", "granted", "stopped"]),
    acceptedCommands: Object.freeze(["set", "stop"]),
    eventKinds: Object.freeze(["delivery-created", "director-decision-authenticated", "work-delegation-set", "work-delegation-stopped"]),
    seedEventKinds: Object.freeze(["delivery-created", "director-decision-authenticated"]),
    generatedEventKinds: Object.freeze(["work-delegation-set", "work-delegation-stopped"]),
    recoveryCoordinates: Object.freeze([]),
  }),
  initialModel: Object.freeze({
    kind: "progression", phase: "absent", candidatePresent: true,
    profile: Object.freeze({
      standing: "active", candidateCondition: "ready-for-work", recovery: null,
      activeActivityCount: 0,
      subjects: Object.freeze({ proposedBoundary: false, activeBoundary: true,
        integrationAssessment: false, candidate: true, materialCondition: false,
        seal: false, evidence: false, closure: false }),
      eligibleOperations: Object.freeze(["delivery.continue", "delivery.integrate", "delivery.no-ship"]),
    }),
  }),
  commands: Object.freeze([
    Object.freeze({ id: "set", expectation(model: DeliveryOracleModel) {
      return model.phase === "absent"
        ? { kind: "accepted" as const, next: { ...model, phase: "granted" } }
        : { kind: "refused" as const, classes: ["lifecycle.delivery-reducer.duplicate"] };
    } }),
    Object.freeze({ id: "stop", expectation(model: DeliveryOracleModel) {
      return model.phase === "granted"
        ? { kind: "accepted" as const, next: { ...model, phase: "stopped" } }
        : { kind: "refused" as const, classes: ["lifecycle.delivery-reducer.delegation-stop"] };
    } }),
  ]),
});

type Reference = Readonly<{ id: string; revision: number; digest: string }>;
type DelegationObservation = Readonly<{
  current: Readonly<{ reference: Reference; stopped: boolean }> | null;
  charged: Readonly<{ operations: number; agentAttempts: number; reservedCellWallTimeMs: number }>;
}>;

export function workDelegationFindings(
  model: DeliveryOracleModel,
  observed: DelegationObservation,
  expectedReference: Reference,
): readonly ExplorationFinding[] {
  const current = observed.current;
  const currentMatches = model.phase === "absent" ? current === null
    : current !== null && current.reference.id === expectedReference.id &&
      current.reference.revision === expectedReference.revision &&
      current.reference.digest === expectedReference.digest && current.stopped === (model.phase === "stopped");
  if (currentMatches && observed.charged.operations === 0 && observed.charged.agentAttempts === 0 &&
      observed.charged.reservedCellWallTimeMs === 0) return [];
  return [{ id: "work-delegation.exact-set-stop", propertyId: deliveryProperties.workDelegation.id,
    classification: "confirmed-normative-violation", phase: model.phase,
    expectedReference, observed,
    message: "The exact resource permission, Stop state or unchanged lifetime charges differ from the independent phase." }];
}
