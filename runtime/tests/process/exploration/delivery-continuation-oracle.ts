import type { ExplorationFinding } from "./bounded-explorer.js";
import type { DeliveryObservation, DeliveryOracleModel } from "./delivery-oracle.js";
import { deliveryProperties } from "./delivery-properties.js";

type ExactSubject = Readonly<{ id: string; revision: number; digest: string }>;

export type DeliveryContinuationGoal = Readonly<{
  boundary: ExactSubject;
  assessment: ExactSubject;
  candidate: ExactSubject;
  seal: ExactSubject;
  evidence: ExactSubject;
}>;

export function continuationModel(completedResponses: number, responseCount: number): DeliveryOracleModel {
  return Object.freeze({
    kind: "progression",
    phase: completedResponses === responseCount ? "productive-goal" : `response-${completedResponses}`,
    candidatePresent: true,
  });
}

function sameSubject(actual: ExactSubject | null, expected: ExactSubject): boolean {
  return actual !== null && actual.id === expected.id && actual.revision === expected.revision &&
    actual.digest === expected.digest;
}

/**
 * This oracle owns only a finite Journal continuation claim. Supplied response
 * order and the final exact subjects are authored independently of reduction.
 * Knowledge bytes, Projection capacity, provider custody and disk restart are
 * exercised by the connected Runtime tests, not by these partial records.
 */
export function continuationFindings(input: Readonly<{
  model: DeliveryOracleModel;
  observation: DeliveryObservation;
  completedResponses: number;
  expectedEventKinds: readonly string[];
  goal: DeliveryContinuationGoal;
}>): readonly ExplorationFinding[] {
  const { model, observation, expectedEventKinds, goal } = input;
  const findings: ExplorationFinding[] = [];
  const fail = (id: string, summary: string, details: Readonly<Record<string, unknown>>) => {
    findings.push(Object.freeze({
      id, signature: `${id}/${model.phase}`,
      propertyId: deliveryProperties.boundedContinuation.id,
      classification: "bounded-continuation-mismatch", summary, details,
    }));
  };
  if (observation.journal.eventCount !== expectedEventKinds.length ||
    observation.eventKinds.length !== expectedEventKinds.length ||
    observation.eventKinds.some((kind, index) => kind !== expectedEventKinds[index])) {
    fail("continuation.response-not-retained", "A supplied response did not advance the exact declared Journal prefix.", {
      completedResponses: input.completedResponses,
      expectedEventKinds, observedEventKinds: observation.eventKinds,
      observedEventCount: observation.journal.eventCount,
    });
  }
  if (observation.standing !== "closed" && observation.eligibleOperations.length === 0) {
    findings.push(Object.freeze({
      id: "progress.nonterminal-operation-sink", signature: `progress.nonterminal-operation-sink/${model.phase}`,
      propertyId: deliveryProperties.nonterminalProgress.id,
      classification: "confirmed-normative-violation",
    }));
  }
  if (observation.subjects.closure !== null || observation.eventKinds.includes("closure-recorded")) {
    fail("continuation.terminal-escape", "Terminal abandonment cannot discharge a declared productive continuation.", {});
  }
  if (model.phase !== "productive-goal") return Object.freeze(findings);

  const active = observation.activities.filter(({ stage }) => stage !== "completed");
  const expectedOperations = ["delivery.accept", "delivery.integrate", "delivery.no-ship"];
  if (observation.standing !== "decision-ready" || observation.candidateCondition !== "ready-for-decision" ||
    active.length !== 0 || observation.activities.some(({ recovery }) => recovery !== null) ||
    !sameSubject(observation.subjects.activeBoundary, goal.boundary) ||
    !sameSubject(observation.subjects.integrationAssessment, goal.assessment) ||
    !sameSubject(observation.subjects.candidate, goal.candidate) ||
    !sameSubject(observation.subjects.seal, goal.seal) ||
    !sameSubject(observation.subjects.evidence, goal.evidence) ||
    observation.subjects.proposedBoundary !== null || observation.subjects.materialCondition !== null ||
    [...observation.eligibleOperations].sort().join(",") !== expectedOperations.join(",")) {
    fail("continuation.productive-goal-not-reached", "The complete supplied response schedule did not establish the exact renewed evaluation outcome.", {
      expected: goal, standing: observation.standing, candidateCondition: observation.candidateCondition,
      subjects: observation.subjects, activeActivities: active, eligibleOperations: observation.eligibleOperations,
    });
  }
  return Object.freeze(findings);
}
