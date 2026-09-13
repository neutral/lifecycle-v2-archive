import assert from "node:assert/strict";
import test from "node:test";
import {
  FoundationControlEventSchema,
  FoundationDeliveryStateSchema,
  FoundationWorkDelegationReservationSchema,
  selfDigestFoundationCarrier,
} from "../src/foundation.js";

// Structural/public decoding assertions only. No retained grant, replay,
// resource allocation, automatic progression or stop transaction is exercised.
const sha = (value: string) => `sha256:${value.repeat(64)}` as const;
const at = "2026-09-06T20:00:00.000Z";
const ref = { kind: "work-delegation" as const, id: "delegation.one", revision: 2, digest: sha("a") };
const subject = { recordId: ref.id, revision: ref.revision, digest: ref.digest };
const base = {
  schema: "lifecycle.control-record-event.v6" as const, storeId: "store.one", processId: "delivery.one",
  sequence: 5, eventId: "event.one", occurredAt: at, actor: { kind: "runtime" as const, id: "runtime.one" },
  predecessorDigest: sha("b"),
};
const withDigest = <T extends Readonly<Record<string, unknown>>>(value: T) => ({ ...value, digest: selfDigestFoundationCarrier(value) });
function reservation() {
  return {
    schema: "lifecycle.work-delegation-reservation.v1" as const, reservationId: "reservation.one", delegation: ref,
    activityId: "activity.one", operation: "delivery.integrate" as const,
    decision: { journalHead: { sequence: 4, digest: base.predecessorDigest }, basisDigest: sha("c"), reason: "integrate-ready-candidate" as const },
    charges: { operations: 1 as const, agentAttempts: 0, reservedCellWallTimeMs: 0 }, slots: [],
  };
}
function opening() {
  return { ...base, eventKind: "activity-started" as const, subject: null,
    payload: { activityId: "activity.one", operation: "delivery.integrate" as const, reservation: reservation() } };
}

test("standing and ordinary Brief events have disjoint scopes; grant and stop events retain exact subjects", () => {
  const ordinary = { ...base, eventKind: "director-brief-submitted", subject, payload: { activityId: "activity.one" } };
  const standing = { ...ordinary, payload: { delegationId: ref.id, delegationRevision: ref.revision, operation: "delivery.continue" } };
  for (const value of [ordinary, standing, { ...base, eventKind: "work-delegation-set", subject, payload: {} }]) {
    assert.deepEqual(FoundationControlEventSchema.parse(withDigest(value)), withDigest(value));
  }
  for (const payload of [
    { ...standing.payload, activityId: "activity.one" },
    { ...standing.payload, operation: "delivery.revise" },
    { ...standing.payload, delegationRevision: 0 },
  ]) assert.equal(FoundationControlEventSchema.safeParse(withDigest({ ...standing, payload })).success, false);
  const stopped = { ...base, eventKind: "work-delegation-stopped", subject,
    payload: { requestDigest: sha("d"), requestedBy: "director.one", requestedAt: at } };
  assert.deepEqual(FoundationControlEventSchema.parse(withDigest(stopped)), withDigest(stopped));
  for (const value of [
    { ...stopped, subject: null },
    { ...stopped, payload: { ...stopped.payload, requestedAt: "2026-09-06T20:00:01.000Z" } },
    { ...stopped, payload: { ...stopped.payload, requestDigest: `${sha("d")}\n` } },
    { ...stopped, payload: { ...stopped.payload, requestedBy: "director.one\n" } },
    { ...stopped, payload: { ...stopped.payload, cancellationCompleted: true } },
  ]) assert.equal(FoundationControlEventSchema.safeParse(withDigest(value)).success, false);
});

test("reserved openings bind exact Activity, operation and immediately preceding Journal head", () => {
  const value = opening();
  assert.deepEqual(FoundationControlEventSchema.parse(withDigest(value)), withDigest(value));
  const manual = { ...value, payload: { activityId: value.payload.activityId, operation: value.payload.operation } };
  assert.deepEqual(FoundationControlEventSchema.parse(withDigest(manual)), withDigest(manual));
  const selected = value.payload.reservation;
  for (const changed of [
    null,
    { ...selected, activityId: "activity.other" },
    { ...selected, delegation: { ...ref, kind: "director-decision" } },
    { ...selected, decision: { ...selected.decision, journalHead: { ...selected.decision.journalHead, sequence: 3 } } },
    { ...selected, decision: { ...selected.decision, journalHead: { ...selected.decision.journalHead, digest: sha("e") } } },
    { ...selected, charges: { ...selected.charges, operations: 0 } },
    { ...selected, charges: { ...selected.charges, reservedCellWallTimeMs: 1 } },
    { ...selected, unselectedPolicy: "refund-unused-time" },
  ]) assert.equal(FoundationControlEventSchema.safeParse(withDigest({ ...value, payload: { ...value.payload, reservation: changed } })).success, false);
  assert.equal(FoundationControlEventSchema.safeParse(withDigest({ ...value, payload: { ...value.payload, operation: "delivery.evaluate" } })).success, false);
});

test("Agent and Check reservation slots preserve the declared operation role and closed resource dimensions", () => {
  const backendProfile = { profileId: "lifecycle.execution-backend-profile.docker-local.v1", profileDigest: sha("1"), implementationDigest: sha("2") };
  const image = { imageId: "image.one", imageDigest: sha("3") };
  const agent = { slotId: "slot.reviewer", purpose: "agent", role: "reviewer", selection: {
    providerDescriptor: { id: "descriptor.one", digest: sha("4") }, backendProfile, image,
    model: "model.one", reasoning: "high", wallTimeMs: 1_000,
    limits: { tokens: null, events: 1_000, outputBytes: 1_048_576, toolCalls: null, processes: 128, storageBytes: 268_435_456 },
  } };
  const check = { slotId: "slot.check", purpose: "check", phase: "final", selectionId: "check.selection",
    definition: { id: "check.definition.one", revision: 1, sourceDigest: sha("5"), semanticDigest: sha("6") },
    binding: { id: "binding.one", digest: sha("7") }, backendProfile, image, wallTimeMs: 2_000,
    limits: { wallTimeMilliseconds: 2_000, processes: 32, storageBytes: 268_435_456,
      outputEntries: 32, outputBytes: 1_048_576, outputEntryBytes: 1_048_576, events: 1_024 },
  };
  const evaluated = { ...reservation(), operation: "delivery.evaluate", decision: { ...reservation().decision, reason: "evaluate-integrated-candidate" },
    charges: { operations: 1, agentAttempts: 1, reservedCellWallTimeMs: 3_000 }, slots: [check, agent] };
  assert.deepEqual(FoundationWorkDelegationReservationSchema.parse(evaluated), evaluated);
  const continued = { ...evaluated, operation: "delivery.continue", decision: { ...evaluated.decision, reason: "correct-in-scope-findings" },
    charges: { ...evaluated.charges, reservedCellWallTimeMs: 1_000 }, slots: [{ ...agent, role: "builder" }] };
  assert.deepEqual(FoundationWorkDelegationReservationSchema.parse(continued), continued);
  for (const value of [
    { ...evaluated, slots: [check, { ...agent, role: "builder" }] },
    { ...evaluated, slots: [check] },
    { ...evaluated, slots: [check, agent, agent] },
    { ...evaluated, slots: [{ ...check, phase: "baseline" }, agent] },
    { ...evaluated, slots: [{ ...check, limits: { ...check.limits, hostProcesses: 32 } }, agent] },
    { ...continued, slots: [check, ...continued.slots] },
    { ...continued, slots: [{ ...agent, role: "builder", selection: { ...agent.selection, limits: { ...agent.selection.limits, processes: 0 } } }] },
  ]) assert.equal(FoundationWorkDelegationReservationSchema.safeParse(value).success, false);
});

test("public reduction retains typed admission and stopped grant without resetting lifetime charges", () => {
  const delegation = { admission: { ...ref, kind: "director-decision", id: "decision.one" }, current: { reference: ref, stopped: true },
    charged: { operations: 3, agentAttempts: 2, reservedCellWallTimeMs: 6_000 } };
  const state = { schema: "lifecycle.delivery-reduction.v5", storeId: base.storeId, processId: base.processId,
    standing: "active", candidateCondition: "ready-for-work", activities: [], recovery: null,
    subjects: { proposedBoundary: null, activeBoundary: null, integrationAssessment: null, candidate: null,
      materialCondition: null, seal: null, evidence: null, closure: null }, delegation,
    journal: { eventCount: 4, headSequence: 4, headDigest: base.predecessorDigest },
    storeDisposition: { stage: "active", integrity: "verified", sealSubjectDigest: null, archiveManifestDigest: null }, eligibleOperations: [] };
  assert.deepEqual(FoundationDeliveryStateSchema.parse(state).delegation, delegation);
  for (const changed of [
    undefined,
    { ...delegation, admission: ref },
    { ...delegation, current: { reference: delegation.admission, stopped: false } },
    { ...delegation, charged: { ...delegation.charged, operations: -1 } },
    { ...delegation, charged: { ...delegation.charged, agentAttempts: Number.MAX_SAFE_INTEGER + 1 } },
    { ...delegation, pendingStop: true },
  ]) assert.equal(FoundationDeliveryStateSchema.safeParse({ ...state, delegation: changed }).success, false);
});
