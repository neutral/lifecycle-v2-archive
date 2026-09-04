import assert from "node:assert/strict";
import test from "node:test";
import { FOUNDATION_TUI_PHASES, deriveFoundationTuiJourney } from "../src/domain/journey.js";
import { testDelivery, testObservation } from "./support/protocol-v10.js";

test("the persistent seven-step journey derives orientation from v10 Delivery standing", () => {
  assert.deepEqual(FOUNDATION_TUI_PHASES.map(({ id }) => id), ["setup", "frame", "admit", "work", "resolve", "prove", "close"]);
  const cases = [
    ["framing", "frame"], ["awaiting-admission", "admit"], ["active", "work"],
    ["boundary-paused", "resolve"], ["awaiting-readmission", "resolve"],
    ["decision-ready", "close"], ["closed", "close"],
  ] as const;
  for (const [standing, phase] of cases) {
    const journey = deriveFoundationTuiJourney(testObservation({ delivery: testDelivery({ standing }) }));
    assert.equal(journey.currentPhase, phase);
    assert.equal(journey.exactState, standing);
    assert.equal(journey.rail.filter(({ current }) => current).length, 1);
  }
});

test("active operation facts place work, resolution, proof, and terminal activity in their journey phase", () => {
  const cases = [
    ["delivery.continue", "work"],
    ["delivery.evaluate", "prove"],
    ["delivery.revise", "resolve"],
    ["delivery.reaffirm", "resolve"],
    ["delivery.accept", "close"],
  ] as const;
  for (const [operation, expected] of cases) {
    const delivery = testDelivery({
      standing: operation === "delivery.accept" ? "decision-ready" : "active",
      activities: [{ id: `activity-${operation}`, operation, family: operation === "delivery.accept" ? "transaction" : "agent", stage: "started" }],
    });
    const journey = deriveFoundationTuiJourney(testObservation({ delivery }));
    assert.equal(journey.currentPhase, expected);
    assert.equal(journey.phaseBasis, "activity");
    assert.equal(journey.attentionOwner, "runtime");
  }
});

test("Founder decisions name the Founder as the attention owner", () => {
  for (const standing of ["awaiting-admission", "awaiting-readmission", "decision-ready"] as const) {
    const journey = deriveFoundationTuiJourney(testObservation({ delivery: testDelivery({ standing }) }));
    assert.equal(journey.activity, "founder-decision");
    assert.equal(journey.attentionOwner, "founder");
  }
});

test("Frame exists before Delivery and recovery remains an exact runtime fact", () => {
  assert.equal(deriveFoundationTuiJourney(testObservation({ delivery: null })).currentPhase, "frame");
  assert.equal(deriveFoundationTuiJourney(testObservation({ initialized: false, delivery: null })).currentPhase, "setup");
  const recovery = deriveFoundationTuiJourney(testObservation({ delivery: testDelivery({
    standing: "active", recovery: { scope: "activity", activityId: "attempt-v10", kind: "provider", resumesAt: "provider-effect-observed", exactEffectDigest: testDelivery().journal.headDigest },
  }) }));
  assert.equal(recovery.activity, "recovery");
  assert.equal(recovery.attentionOwner, "runtime");
  assert.match(recovery.stateExplanation, /provider-effect-observed/u);
});

test("admission initialization and Store disposition remain orthogonal journey facts", () => {
  const admission = deriveFoundationTuiJourney(testObservation({ delivery: testDelivery({
    standing: "active",
    candidatePresent: false,
    candidateCondition: "absent",
    eligibleOperations: ["delivery.recover"],
    activities: [{
      id: "admit-awaiting-candidate",
      operation: "delivery.admit",
      family: "transaction",
      stage: "effect-observed",
    }],
    recovery: {
      scope: "activity",
      activityId: "admit-awaiting-candidate",
      kind: "candidate-observation",
      resumesAt: "candidate-revision-observed",
      exactEffectDigest: null,
    },
  }) }));
  assert.equal(admission.currentPhase, "admit");
  assert.equal(admission.exactState, "active");
  assert.equal(admission.activity, "recovery");
  assert.equal(admission.attentionOwner, "runtime");

  const storeRecovery = deriveFoundationTuiJourney(testObservation({ delivery: testDelivery({
    standing: "closed",
    candidateCondition: "accepted",
    eligibleOperations: ["delivery.recover"],
    recovery: {
      scope: "store-disposition",
      activityId: null,
      kind: "finalization",
      resumesAt: "store-archive",
      exactEffectDigest: null,
    },
  }) }));
  assert.equal(storeRecovery.currentPhase, "close");
  assert.equal(storeRecovery.phaseBasis, "recovery");
  assert.equal(storeRecovery.activity, "recovery");
  assert.equal(storeRecovery.attentionOwner, "runtime");
});
