import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDeliveryControlRecordPolicy,
  DELIVERY_CONTROL_RECORD_KINDS,
  deliveryControlRecordPolicies,
  deliveryControlRecordPolicy,
} from "../../src/foundation/control/kind-registry.js";
import { compileControlRecordRevision } from "../../src/foundation/control/model.js";
import type {
  DeliveryActivity,
  DeliveryCandidateCondition,
  DeliveryCurrentSubjects,
  DeliveryStanding,
  DeliveryState,
} from "../../src/foundation/process/delivery-state.js";
import {
  DELIVERY_OPERATIONS,
  deliveryOperationDescriptors,
  eligibleDeliveryOperations,
} from "../../src/foundation/process/operation-registry.js";
import { sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

const DIGEST = sha256Bytes("control-policy-test");

function subjects(input: Partial<DeliveryCurrentSubjects> = {}): DeliveryCurrentSubjects {
  return Object.freeze({
    integrationAssessment: null,
    proposedBoundary: null,
    activeBoundary: null,
    candidate: null,
    materialCondition: null,
    seal: null,
    evidence: null,
    closure: null,
    ...input,
  });
}

function reference(id: string): Readonly<{ id: string; revision: number; digest: typeof DIGEST }> {
  return Object.freeze({ id, revision: 1, digest: DIGEST });
}

function state(input: Readonly<{
  standing: DeliveryStanding;
  candidateCondition?: DeliveryCandidateCondition;
  activities?: readonly DeliveryActivity[];
  subjects?: DeliveryCurrentSubjects;
}>): DeliveryState {
  return Object.freeze({
    standing: input.standing,
    candidateCondition: input.candidateCondition ?? "absent",
    activities: Object.freeze(input.activities ?? []),
    subjects: input.subjects ?? subjects(),
    delegation: Object.freeze({ admission: null, current: null,
      charged: Object.freeze({ operations: 0, agentAttempts: 0, reservedCellWallTimeMs: 0 }) }),
    journal: Object.freeze({ eventCount: 0, headDigest: null }),
  });
}

function activity(input: Partial<DeliveryActivity> = {}): DeliveryActivity {
  return Object.freeze({
    id: "activity-one",
    operation: "delivery.prepare",
    family: "agent",
    stage: "started",
    recovery: null,
    ...input,
  });
}

test("one closed Control-family registry owns the complete Delivery record lifecycle", () => {
  assert.deepEqual(DELIVERY_CONTROL_RECORD_KINDS, [
    "director-brief",
    "work-delegation",
    "agent-attempt",
    "agent-work-product",
    "execution-receipt",
    "candidate-revision",
    "integration-assessment",
    "work-boundary",
    "material-condition",
    "director-decision",
    "candidate-seal",
    "check-receipt",
    "evidence-packet",
    "closure",
  ]);
  const policies = deliveryControlRecordPolicies();
  assert.equal(policies.length, DELIVERY_CONTROL_RECORD_KINDS.length);
  assert.equal(new Set(policies.map((policy) => policy.kind)).size, policies.length);
  assert.equal(new Set(policies.map((policy) => policy.payloadSchemaId)).size, policies.length);
  assert.deepEqual(
    Object.fromEntries(policies.map((policy) => [policy.kind, policy.payloadSchemaId])),
    {
      "director-brief": "urn:lifecycle:schema:director-brief-payload:v2",
      "work-delegation": "urn:lifecycle:schema:work-delegation-payload:v2",
      "agent-attempt": "urn:lifecycle:schema:agent-attempt-payload:v3",
      "agent-work-product": "urn:lifecycle:schema:agent-work-product-payload:v5",
      "execution-receipt": "urn:lifecycle:schema:execution-receipt-payload:v3",
      "candidate-revision": "urn:lifecycle:schema:candidate-revision-payload:v3",
      "integration-assessment": "urn:lifecycle:schema:integration-assessment-payload:v1",
      "work-boundary": "urn:lifecycle:schema:work-boundary-payload:v6",
      "material-condition": "urn:lifecycle:schema:material-condition-payload:v4",
      "director-decision": "urn:lifecycle:schema:director-decision-payload:v5",
      "candidate-seal": "urn:lifecycle:schema:candidate-seal-payload:v2",
      "check-receipt": "urn:lifecycle:schema:check-receipt-payload:v3",
      "evidence-packet": "urn:lifecycle:schema:evidence-packet-payload:v2",
      closure: "urn:lifecycle:schema:closure-payload:v6",
    },
  );
  assert(policies.every((policy) => policy.retention === "archive-with-delivery"));
  assert.equal(deliveryControlRecordPolicy("agent-work-product").editor, "assigned-agent");
  assert.equal(deliveryControlRecordPolicy("agent-work-product").editWindow, "provider-active");
  assert.equal(deliveryControlRecordPolicy("candidate-revision").revisionMode, "successive");
  const delegation = deliveryControlRecordPolicy("work-delegation");
  assert.equal(delegation.semanticAuthority, "director-supplied");
  assert.equal(delegation.semanticAuthor, "director");
  assert.equal(delegation.revisionMode, "successive");
  assert.equal(delegation.finalizationEvent, "work-delegation-set");
  assert.deepEqual(delegation.relationships.map(({ relation }) => relation),
    ["uses-boundary", "uses-admission", "uses-brief", "revises"]);
  assert.deepEqual(
    deliveryControlRecordPolicy("candidate-revision").relationships.map(({ relation }) => relation),
    ["revises", "governed-by", "result-of", "integrated-from"],
  );
  assert.deepEqual(
    deliveryControlRecordPolicy("agent-attempt").relationships.map(({ relation }) => relation),
    ["uses-brief", "uses-boundary", "uses-candidate", "uses-seal"],
  );
  assert.deepEqual(
    deliveryControlRecordPolicy("work-boundary").relationships.map(({ relation }) => relation),
    ["uses-brief", "proposed-from", "revises", "resolves"],
  );
  assert(!DELIVERY_CONTROL_RECORD_KINDS.includes("attempt-assessment" as never));
  assert(!DELIVERY_CONTROL_RECORD_KINDS.includes("work-boundary-proposal" as never));
  assert(!DELIVERY_CONTROL_RECORD_KINDS.includes("delivery-control-index" as never));
});

test("Control-family policy validates producer, authority, edit result, and relationship shape", () => {
  const attemptDigest = sha256Bytes("attempt-one");
  const valid = compileControlRecordRevision("delivery-policy", {
    recordId: "work-product-one",
    recordKind: "agent-work-product",
    revision: 1,
    producer: { kind: "runtime", id: "foundation-runtime" },
    semanticAuthor: { kind: "agent", id: "agent-one" },
    semanticAuthority: "agent-proposed",
    createdAt: "2026-08-29T06:00:00Z",
    semanticMarkdown: "# Reconnaissance\n\nA bounded semantic proposal.\n",
    payload: validDeliveryControlPayload("agent-work-product"),
    relationships: [{
      relation: "result-of",
      target: { kind: "agent-attempt", id: "attempt-one", revision: 1, digest: attemptDigest },
    }],
  });
  assert.doesNotThrow(() => assertDeliveryControlRecordPolicy(valid));

  const wrongProducer = compileControlRecordRevision("delivery-policy", {
    ...valid,
    producer: { kind: "agent", id: "agent-one" },
  });
  assert.throws(
    () => assertDeliveryControlRecordPolicy(wrongProducer),
    (error: unknown) => (error as { code?: string }).code === "lifecycle.control-record-policy.producer",
  );

  const missingAttempt = compileControlRecordRevision("delivery-policy", {
    ...valid,
    relationships: [],
  });
  assert.throws(
    () => assertDeliveryControlRecordPolicy(missingAttempt),
    (error: unknown) => (error as { code?: string }).code === "lifecycle.control-record-policy.relationship-cardinality",
  );
});

test("one operation registry derives eligibility from orthogonal standing, activity, and subjects", () => {
  assert.deepEqual(DELIVERY_OPERATIONS, [
    "delivery.prepare",
    "delivery.admit",
    "delivery.continue",
    "delivery.integrate",
    "delivery.evaluate",
    "delivery.revise",
    "delivery.reaffirm",
    "delivery.accept",
    "delivery.no-ship",
    "delivery.recover",
  ]);
  assert.equal(deliveryOperationDescriptors().length, DELIVERY_OPERATIONS.length);

  assert.deepEqual(eligibleDeliveryOperations(state({ standing: "framing" })), ["delivery.prepare"]);
  assert.deepEqual(eligibleDeliveryOperations(state({ standing: "awaiting-admission" })), [
    "delivery.admit",
    "delivery.no-ship",
  ]);
  assert.deepEqual(eligibleDeliveryOperations(state({
    standing: "framing",
    activities: [activity({ stage: "completed" })],
  })), ["delivery.no-ship"]);
  assert.deepEqual(eligibleDeliveryOperations(state({
    standing: "framing",
    activities: [activity()],
  })), []);

  const candidate = reference("candidate-one");
  const activeSubjects = subjects({
    activeBoundary: reference("boundary-one"),
    candidate,
  });
  assert.deepEqual(eligibleDeliveryOperations(state({
    standing: "active",
    candidateCondition: "ready-for-work",
    subjects: activeSubjects,
  })), ["delivery.continue", "delivery.integrate", "delivery.no-ship"]);
  assert.deepEqual(eligibleDeliveryOperations(state({ standing: "active", candidateCondition: "ready-for-work",
    subjects: activeSubjects }), { candidateIntegrated: true }), ["delivery.continue", "delivery.integrate", "delivery.evaluate", "delivery.no-ship"]);
  assert.deepEqual(eligibleDeliveryOperations(state({
    standing: "active",
    candidateCondition: "in-progress",
    subjects: activeSubjects,
    activities: [activity({ operation: "delivery.continue" })],
  })), []);
  assert.deepEqual(eligibleDeliveryOperations(state({
    standing: "active",
    candidateCondition: "terminal-recovery",
    subjects: activeSubjects,
    activities: [activity({
      operation: "delivery.continue",
      recovery: { kind: "provider", resumesAt: "provider-effect-observed", exactEffectDigest: DIGEST },
    })],
  })), ["delivery.recover"]);
  assert.deepEqual(eligibleDeliveryOperations(state({
    standing: "boundary-paused",
    candidateCondition: "paused-for-boundary",
    subjects: subjects({
      ...activeSubjects,
      materialCondition: reference("condition-one"),
    }),
  })), ["delivery.revise", "delivery.reaffirm", "delivery.no-ship"]);
  assert.deepEqual(eligibleDeliveryOperations(state({
    standing: "awaiting-readmission",
    candidateCondition: "paused-for-boundary",
    subjects: subjects({
      ...activeSubjects,
      proposedBoundary: reference("boundary-two"),
      materialCondition: reference("condition-one"),
    }),
  })), ["delivery.admit", "delivery.no-ship"]);
  assert.deepEqual(eligibleDeliveryOperations(state({
    standing: "decision-ready",
    candidateCondition: "ready-for-decision",
    subjects: subjects({
      ...activeSubjects,
      seal: reference("seal-one"),
      evidence: reference("evidence-one"),
    }),
  })), ["delivery.integrate", "delivery.accept", "delivery.no-ship"]);
  assert.deepEqual(eligibleDeliveryOperations(state({
    standing: "closed",
    candidateCondition: "accepted",
    subjects: subjects({ closure: reference("closure-one") }),
  })), []);
});
