import assert from "node:assert/strict";
import test from "node:test";
import {
  collectRetainedEvidenceVerificationInputV7,
  retainEvidencePacket,
  verifyRetainedAcceptanceV7,
  verifyRetainedEvidencePacketV7,
} from "../../src/foundation/control/evidence-packet.js";
import { compileControlRecordEvent, compileControlRecordRevision } from "../../src/foundation/control/model.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import { assertDeliveryControlRecordPayload } from "../../src/foundation/control/payload-registry.js";
import type { ControlJsonObject } from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import { evidenceFixtureV7 as fixture, EVIDENCE_OBSERVATION_V7 as observation } from "../helpers/evidence-fixture-v7.js";
const ACTIVITY = "activity-evaluate";
const RUNTIME = "foundation-runtime";
test("Evidence Packet compiler derives the complete exact evaluation join and readiness", () => {
  const firstFixture = fixture();
  const first = retainEvidencePacket({
    store: firstFixture.store,
    activityId: ACTIVITY,
    observation,
    runtimeId: RUNTIME,
  });
  const second = retainEvidencePacket({
    store: fixture().store,
    activityId: ACTIVITY,
    observation,
    runtimeId: RUNTIME,
  });

  assert.equal(first.revision.recordKind, "evidence-packet");
  assert.equal(first.revision.semanticAuthority, "runtime-derived");
  assert.equal(first.revision.payload.readiness, "acceptance-ready");
  assert.equal(first.revision.recordId, second.revision.recordId);
  assert.equal(first.revision.digest, second.revision.digest);
  assert.equal(first.event.eventId, second.event.eventId);
  assert.equal(first.event.eventKind, "evidence-packet-finalized");
  assert.deepEqual(first.event.payload, { activityId: ACTIVITY });
  assert.deepEqual(
    first.revision.relationships.map(({ relation }) => relation),
    ["evaluates", "governed-by", "uses-check", "uses-check", "uses-review", "uses-review-receipt", "uses-seal"],
  );
  assert.equal((first.revision.payload.receiptUse as readonly unknown[]).length, 2);
  assert.equal((first.revision.payload.propositionDecisions as readonly unknown[]).length, 1);
  assert.equal((first.revision.payload.obligations as readonly ControlJsonObject[])[0]!.state, "satisfied");
  assert.equal(firstFixture.appended.length, 1);
  assertDeliveryControlRecordPayload(first.revision);
});

test("A proven fresh reviewer with missing session telemetry retains a schema-valid ready Packet", () => {
  const value = fixture({ reviewerSession: null });
  const { revision } = retainEvidencePacket({
    store: value.store, activityId: ACTIVITY, observation, runtimeId: RUNTIME,
  });
  assert.equal(revision.payload.readiness, "acceptance-ready");
  const independence = revision.payload.reviewerIndependence as readonly ControlJsonObject[];
  assert.equal(independence[0]!.providerSession, "indeterminate");
  assert.equal(independence[0]!.state, "satisfied");
  assertDeliveryControlRecordPayload(revision);
  assert.equal(verifyRetainedEvidencePacketV7({ store: value.store, packet: revision }).readiness, "acceptance-ready");

  const contradicted = compileControlRecordRevision(revision.processId, {
    ...revision,
    payload: { ...revision.payload, reviewerIndependence: independence.map((entry) => ({ ...entry, providerSession: "reused" })) },
  });
  assert.throws(() => assertDeliveryControlRecordPayload(contradicted),
    (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.schema.invalid");
});

test("acceptance-ready Packet structure distinguishes an authorized baseline from an absent Receipt", () => {
  // Structural scope only: these ledger mutations do not establish authorization
  // or provenance. Assessment and connected Runtime cases check those owners.
  const { revision } = retainEvidencePacket({
    store: fixture().store, activityId: ACTIVITY, observation, runtimeId: RUNTIME,
  });
  const entries = revision.payload.receiptUse as readonly ControlJsonObject[];
  const baseline = entries.find((entry) => entry.phase === "baseline")!;
  const authorized: ControlJsonObject = { ...baseline, use: "excluded", freshness: "not-applicable",
    subjectEquivalence: "exact", ageMs: null, maximumAgeMs: null, reasonCode: "baseline-postcondition-not-run" };
  const withEntry = (entry: ControlJsonObject) => compileControlRecordRevision(revision.processId, {
    ...revision, payload: { ...revision.payload,
      receiptUse: entries.map((value) => value.id === baseline.id ? entry : value) },
  });
  assert.doesNotThrow(() => assertDeliveryControlRecordPayload(withEntry(authorized)));
  assert.doesNotThrow(() => assertDeliveryControlRecordPayload(withEntry({ ...baseline,
    receiptId: null, use: "excluded", freshness: "not-applicable", subjectEquivalence: "indeterminate",
    ageMs: null, maximumAgeMs: null, reasonCode: "receipt-not-required" })),
  "An ordinary excluded phase still has no Receipt");
  const mutations: readonly Readonly<{ fault: string; change: ControlJsonObject }>[] = [
    { fault: "missing retained Receipt", change: { receiptId: null } },
    { fault: "final phase", change: { phase: "final" } },
    { fault: "different exclusion reason", change: { reasonCode: "receipt-not-required" } },
    { fault: "equivalent rather than exact subject", change: { subjectEquivalence: "proven-equivalent" } },
    { fault: "indeterminate subject", change: { subjectEquivalence: "indeterminate" } },
    { fault: "invented elapsed age", change: { ageMs: 0 } },
    { fault: "invented temporal reuse bound", change: { maximumAgeMs: 0 } },
    { fault: "fresh temporal claim", change: { freshness: "fresh" } },
    { fault: "executed claim with invented freshness", change: { use: "executed", freshness: "fresh", ageMs: 0 } },
    { fault: "reused claim with invented freshness", change: { use: "reused", freshness: "fresh", ageMs: 0 } },
  ];
  for (const { fault, change } of mutations) {
    assert.throws(() => assertDeliveryControlRecordPayload(withEntry({ ...authorized, ...change })),
      (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.schema.invalid", fault);
  }
});

test("Evidence Packet compiler refuses a reviewer Attempt without the exact Seal binding", () => {
  const value = fixture({ includeSealBinding: false });
  assert.throws(
    () => retainEvidencePacket({ store: value.store, activityId: ACTIVITY, observation, runtimeId: RUNTIME }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.control-evidence-packet.relationship",
  );
  assert.equal(value.appended.length, 0);
});

test("Evidence Packet compiler independently rederives inspected subjects from citations", () => {
  const value = fixture({ inspectedSubjectIds: ["candidate-evidence"] });
  assert.throws(
    () => retainEvidencePacket({ store: value.store, activityId: ACTIVITY, observation, runtimeId: RUNTIME }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.control-evidence-packet.review",
  );
  assert.equal(value.appended.length, 0);
});

test("Evidence Packet compiler retains incomplete Check coverage as correctable truth", () => {
  const value = retainEvidencePacket({
    store: fixture({ includeFinalCheck: false }).store,
    activityId: ACTIVITY,
    observation,
    runtimeId: RUNTIME,
  });
  assert.equal(value.revision.payload.readiness, "correctable");
  const receiptUse = value.revision.payload.receiptUse as readonly ControlJsonObject[];
  const missing = receiptUse.find((entry) => entry.phase === "final");
  assert.equal(missing?.use, "missing");
  assert.equal(missing?.receiptId, null);
});

test("Evidence Packet compiler derives revision-required only from retained material truth", () => {
  const value = retainEvidencePacket({
    store: fixture({ materialCondition: true }).store,
    activityId: ACTIVITY,
    observation,
    runtimeId: RUNTIME,
  });
  assert.equal(value.revision.payload.readiness, "revision-required");
});


test("Retained Evidence reopens historical interpretation after completion while live finalization remains closed", () => {
  const value = fixture();
  const { revision: packet } = retainEvidencePacket({
    store: value.store, activityId: ACTIVITY, observation, runtimeId: RUNTIME,
  });
  const originalPrefixLength = value.events.length - 1;
  value.completeEvaluation();
  const appendedBefore = value.appended.length;
  const collected = collectRetainedEvidenceVerificationInputV7({ store: value.store, packet });
  assert.equal(collected.events.length, originalPrefixLength);
  assert.equal(collected.observation.evaluatedAt, observation.evaluatedAt);
  assert.equal(verifyRetainedEvidencePacketV7({ store: value.store, packet }).readiness, "acceptance-ready");
  const subjects = value.store.state().subjects;
  const boundary = value.store.getRevision(value.selected.boundary.id, value.selected.boundary.revision)!;
  const result = verifyRetainedAcceptanceV7({
    store: value.store,
    packet,
    current: { boundary: subjects.activeBoundary, candidate: subjects.candidate, seal: subjects.seal,
      evidence: subjects.evidence, materialCondition: subjects.materialCondition },
    parentCommit: (boundary.payload.basis as ControlJsonObject).productBaseCommit as string,
  });
  assert.equal(result.status, "justified");
  assert.equal(result.directorSubject, "not-supplied");
  assert.equal(value.appended.length, appendedBefore);
  assert.throws(() => retainEvidencePacket({ store: value.store, activityId: ACTIVITY, observation, runtimeId: RUNTIME }),
    (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.control-evidence-packet.activity");
  assert.throws(() => verifyRetainedEvidencePacketV7({ store: value.store, packet,
    observation: { subject: { ...collected.observationSubject,
      candidate: { ...value.selected.candidate, revision: value.selected.candidate.revision + 1 } }, facts: observation },
  }), (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.evidence.observation-subject");
  assert.equal(value.appended.length, appendedBefore);
});


test("Retained Evidence finalization follows Packet construction without requiring equal timestamps", () => {
  const value = fixture();
  const { revision: packet, event } = retainEvidencePacket({
    store: value.store, activityId: ACTIVITY, observation, runtimeId: RUNTIME,
  });
  const storeAtFinalization = (occurredAt: string): ControlRecordStore => {
    const finalization = compileControlRecordEvent({
      storeId: value.identity.storeId, processId: value.identity.processId,
      sequence: event.sequence, predecessorDigest: event.predecessorDigest,
      event: { ...event, occurredAt },
    });
    const events = [...value.events.slice(0, -1), finalization];
    const store = Object.create(value.store) as ControlRecordStore;
    Object.defineProperties(store, {
      listEvents: { value: (afterSequence = 0, limit = 10_000) => events.filter((item) => item.sequence > afterSequence).slice(0, limit) },
      state: { value: () => ({ ...value.store.state(), journal: { eventCount: events.length, headDigest: finalization.digest } }) },
    });
    return store;
  };
  const tooEarly = new Date(Date.parse(packet.createdAt) - 1).toISOString();
  assert.throws(() => verifyRetainedEvidencePacketV7({ store: storeAtFinalization(tooEarly), packet }),
    (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.control-evidence-packet.journal" &&
      error.message.includes("finalization precedes construction"));
  const later = new Date(Date.parse(packet.createdAt) + 1_000).toISOString();
  assert.equal(verifyRetainedEvidencePacketV7({ store: storeAtFinalization(later), packet }).readiness, "acceptance-ready");
});
