import assert from "node:assert/strict";
import test from "node:test";
import {
  WORK_DELEGATION_POLICY_DIGEST,
  WORK_DELEGATION_POLICY_ID,
  WORK_DELEGATION_RESERVATION_SCHEMA,
  WORK_DELEGATION_SCHEMA,
  addWorkDelegationAccounting,
  assessWorkDelegationAllowance,
  compileWorkDelegationReservation,
  parseWorkDelegationPayload,
  parseWorkDelegationReservation,
  type WorkDelegationAgentSelection,
  type WorkDelegationExecutionSlot,
  type WorkDelegationOperation,
  type WorkDelegationPayload,
  type WorkDelegationReference,
  type WorkDelegationReservation,
} from "../../src/foundation/control/work-delegation.js";
import { FoundationError } from "../../src/foundation/error.js";
import { canonicalJson, digestCanonical } from "../../src/foundation/validation/canonical.js";

// Pure owner fixtures: exact internally consistent references, no retained Store,
// physical resources, provider execution, currentness or authority claim.
function reference<Kind extends string>(kind: Kind, id: string, revision = 1): WorkDelegationReference<Kind> {
  return { kind, id, revision, digest: digestCanonical({ kind, id, revision }) };
}

function agent(role: "builder" | "reviewer"): WorkDelegationAgentSelection {
  return {
    providerDescriptor: { id: "descriptor.codex", digest: digestCanonical({ descriptor: "codex" }) },
    backendProfile: { profileId: "lifecycle.execution-backend-profile.fault-injection.v1", profileDigest: digestCanonical({ backend: "test-only" }), implementationDigest: digestCanonical({ implementation: "test-only" }) },
    image: { imageId: "image.execution", imageDigest: digestCanonical({ image: "execution" }) },
    model: "model.fixture", reasoning: "high", wallTimeMs: 1_000,
    limits: { tokens: null, events: 10_000, outputBytes: role === "builder" ? 268_435_456 : 1_048_576, toolCalls: null, processes: 128, storageBytes: 268_435_456 },
  };
}

function grant(): WorkDelegationPayload {
  return {
    schema: WORK_DELEGATION_SCHEMA,
    boundary: reference("work-boundary", "boundary.current"),
    admission: reference("director-decision", "decision.admission"),
    replaces: null,
    policy: { id: WORK_DELEGATION_POLICY_ID, digest: WORK_DELEGATION_POLICY_DIGEST },
    allowedOperations: ["delivery.continue", "delivery.evaluate", "delivery.integrate"],
    directions: { continue: reference("director-brief", "brief.builder"), evaluate: reference("director-brief", "brief.reviewer") },
    agentSelections: { builder: agent("builder"), reviewer: agent("reviewer") },
    ceilings: { operations: 6, agentAttempts: 4, reservedCellWallTimeMs: 10_000 },
    expiresAt: null, stopPolicy: "finish-reserved-operation",
  };
}

function check(index = 0): Extract<WorkDelegationExecutionSlot, { purpose: "check" }> {
  const suffix = index.toString().padStart(4, "0");
  return {
    slotId: `slot.check.${suffix}`, purpose: "check", phase: "final", selectionId: `selection.check.${suffix}`,
    definition: { id: "check.definition.focused", revision: 2, sourceDigest: digestCanonical({ source: "focused", revision: 2 }), semanticDigest: digestCanonical({ semantics: "focused", revision: 2 }) },
    binding: { id: "binding.focused", digest: digestCanonical({ binding: "focused" }) },
    backendProfile: agent("reviewer").backendProfile, image: agent("reviewer").image, wallTimeMs: 2_000,
    limits: { wallTimeMilliseconds: 2_000, processes: 8, storageBytes: 268_435_456, outputEntries: 32, outputBytes: 1_048_576, outputEntryBytes: 1_048_576, events: 1_024 },
  };
}

function reservationInput(operation: WorkDelegationOperation, checks: readonly WorkDelegationExecutionSlot[] = [check()]): Omit<WorkDelegationReservation, "charges"> {
  const slots: readonly WorkDelegationExecutionSlot[] = operation === "delivery.integrate" ? []
    : operation === "delivery.continue" ? [{ slotId: "slot.builder", purpose: "agent", role: "builder", selection: agent("builder") }]
    : [...checks, { slotId: "slot.reviewer", purpose: "agent", role: "reviewer", selection: agent("reviewer") }];
  return {
    schema: WORK_DELEGATION_RESERVATION_SCHEMA,
    reservationId: "reservation.activity", delegation: reference("work-delegation", "delegation.current"),
    activityId: "activity.fresh", operation,
    decision: { journalHead: { sequence: 12, digest: digestCanonical({ head: 12 }) }, basisDigest: digestCanonical({ current: "exact-operation-basis" }), reason: operation === "delivery.integrate" ? "integrate-ready-candidate" : operation === "delivery.continue" ? "develop-candidate" : "evaluate-integrated-candidate" },
    slots,
  };
}

const zero = Object.freeze({ operations: 0, agentAttempts: 0, reservedCellWallTimeMs: 0 });
const observedAt = "2026-09-06T15:00:00.000Z";
const invalid = (error: unknown): boolean => error instanceof FoundationError && error.code === "lifecycle.work-delegation.invalid";

test("integrate-only delegation permits zero Agent and Cell-time allowance", () => {
  const selected: WorkDelegationPayload = { ...grant(), allowedOperations: ["delivery.integrate"], directions: { continue: null, evaluate: null }, agentSelections: { builder: null, reviewer: null }, ceilings: { operations: 1, agentAttempts: 0, reservedCellWallTimeMs: 0 } };
  assert.deepEqual(parseWorkDelegationPayload(selected), selected);
  const reservation = compileWorkDelegationReservation(reservationInput("delivery.integrate"));
  assert.deepEqual(reservation.charges, { operations: 1, agentAttempts: 0, reservedCellWallTimeMs: 0 });
  const allowance = assessWorkDelegationAllowance({ delegation: selected, accounting: zero, reservation, observedAt, stopped: false });
  assert.equal(allowance.allowed, true);
  assert.deepEqual(allowance.prospective, reservation.charges);
  assert.equal(assessWorkDelegationAllowance({ delegation: selected, accounting: reservation.charges, reservation, observedAt, stopped: false }).reason, "operations-exhausted");
});

test("Continue and Evaluate reserve every exact potential Cell without a usage refund", () => {
  const continued = compileWorkDelegationReservation(reservationInput("delivery.continue"));
  const evaluated = compileWorkDelegationReservation(reservationInput("delivery.evaluate", [check(0), check(1)]));
  assert.deepEqual(continued.charges, { operations: 1, agentAttempts: 1, reservedCellWallTimeMs: 1_000 });
  assert.deepEqual(evaluated.charges, { operations: 1, agentAttempts: 1, reservedCellWallTimeMs: 5_000 });
  assert.deepEqual(parseWorkDelegationReservation(evaluated), evaluated);
  assert.equal(evaluated.slots.length, 3);
  assert.deepEqual(evaluated.slots[0], check(0));
  assert.deepEqual(evaluated.slots[1], check(1));
  const retained = addWorkDelegationAccounting(continued.charges, evaluated.charges);
  assert.deepEqual(retained, { operations: 2, agentAttempts: 2, reservedCellWallTimeMs: 6_000 });
  assert.deepEqual(addWorkDelegationAccounting(retained, zero), retained);
  assert.throws(() => parseWorkDelegationReservation({ ...evaluated, charges: { ...evaluated.charges, reservedCellWallTimeMs: 1_000 } }), invalid);
});

test("replacement allowance uses supplied lifetime totals, safe sums, and exact cap edges", () => {
  const reservation = compileWorkDelegationReservation(reservationInput("delivery.continue"));
  const accounting = { operations: 4, agentAttempts: 3, reservedCellWallTimeMs: 5_000 };
  const replacement = { ...grant(), replaces: reference("work-delegation", "delegation.current"), ceilings: { operations: 5, agentAttempts: 4, reservedCellWallTimeMs: 6_000 } };
  const input = { delegation: replacement, accounting, reservation, observedAt, stopped: false };
  assert.equal(assessWorkDelegationAllowance(input).allowed, true);
  assert.deepEqual(assessWorkDelegationAllowance(input).charged, accounting);
  for (const [field, reason] of [
    ["operations", "operations-exhausted"],
    ["agentAttempts", "agent-attempts-exhausted"],
    ["reservedCellWallTimeMs", "cell-wall-time-exhausted"],
  ] as const) {
    const ceilings = { ...replacement.ceilings, [field]: replacement.ceilings[field] - 1 };
    assert.equal(assessWorkDelegationAllowance({ ...input, delegation: { ...replacement, ceilings } }).reason, reason);
  }
  for (const field of ["operations", "agentAttempts", "reservedCellWallTimeMs"] as const) {
    assert.throws(() => addWorkDelegationAccounting({ ...zero, [field]: Number.MAX_SAFE_INTEGER }, { ...zero, [field]: 1 }), invalid);
    assert.throws(() => addWorkDelegationAccounting(zero, { ...zero, [field]: -1 }), invalid);
  }
  assert.deepEqual(accounting, { operations: 4, agentAttempts: 3, reservedCellWallTimeMs: 5_000 });
});

test("stop, inclusive expiry and exact installed selection constrain prospective allowance", () => {
  const reservation = compileWorkDelegationReservation(reservationInput("delivery.continue"));
  const input = { delegation: grant(), accounting: zero, reservation, observedAt, stopped: false };
  assert.equal(assessWorkDelegationAllowance({ ...input, stopped: true }).reason, "stopped");
  assert.equal(assessWorkDelegationAllowance({ ...input, delegation: { ...grant(), expiresAt: observedAt } }).reason, "expired");
  assert.equal(assessWorkDelegationAllowance({ ...input, delegation: { ...grant(), expiresAt: "2026-09-06T15:00:00.001Z" } }).allowed, true);
  for (const selected of [
    { ...agent("builder"), model: "model.substituted" },
    { ...agent("builder"), reasoning: "low" },
    { ...agent("builder"), wallTimeMs: 999 },
    { ...agent("builder"), image: { ...agent("builder").image, imageDigest: digestCanonical({ image: "substituted" }) } },
    { ...agent("builder"), limits: { ...agent("builder").limits, processes: 127 } },
  ]) {
    const substituted = compileWorkDelegationReservation({ ...reservationInput("delivery.continue"), slots: [{ slotId: "slot.builder", purpose: "agent", role: "builder", selection: selected }] });
    assert.equal(assessWorkDelegationAllowance({ ...input, reservation: substituted }).reason, "selection-mismatch");
  }
  const integrationOnly: WorkDelegationPayload = { ...grant(), allowedOperations: ["delivery.integrate"], directions: { continue: null, evaluate: null }, agentSelections: { builder: null, reviewer: null } };
  assert.equal(assessWorkDelegationAllowance({ ...input, delegation: integrationOnly }).reason, "operation-not-delegated");
});

test("closed grant and reservation shapes reject representative identity, slot and charge mutations", () => {
  const selected = grant();
  const invalidGrants: readonly unknown[] = [
    { ...selected, extra: true },
    { ...selected, allowedOperations: ["delivery.accept"] },
    { ...selected, allowedOperations: ["delivery.evaluate", "delivery.continue"] },
    { ...selected, allowedOperations: ["delivery.continue", "delivery.continue"] },
    { ...selected, policy: { ...selected.policy, digest: digestCanonical({ policy: "substituted" }) } },
    { ...selected, directions: { ...selected.directions, continue: null } },
    { ...selected, agentSelections: { ...selected.agentSelections, builder: null } },
    { ...selected, ceilings: { ...selected.ceilings, agentAttempts: 0 } },
    { ...selected, boundary: reference("candidate-revision", "candidate.foreign") },
    { ...selected, boundary: { ...selected.boundary, digest: `${selected.boundary.digest}\n` } },
    { ...selected, boundary: { ...selected.boundary, id: `${selected.boundary.id}\n` } },
  ];
  for (const value of invalidGrants) assert.throws(() => parseWorkDelegationPayload(value), invalid);
  const original = reservationInput("delivery.evaluate");
  const reviewer = original.slots[1]!;
  const malformed: readonly unknown[] = [
    { ...original, slots: [reviewer, check()] },
    { ...original, slots: [check(), { ...check(), slotId: "slot.check.0001" }, reviewer] },
    { ...original, slots: [{ ...check(), definition: { id: "check.wrong", digest: digestCanonical({ wrong: "Control-like-reference" }) } }, reviewer] },
    { ...original, slots: [{ ...check(), phase: "baseline" }, reviewer] },
    { ...original, slots: [{ ...check(), definition: { ...check().definition, id: "description.wrong-kind" } }, reviewer] },
    { ...original, slots: [{ ...check(), definition: { ...check().definition, semanticDigest: `${check().definition.semanticDigest}\n` } }, reviewer] },
    { ...original, slots: [{ ...check(), limits: { ...check().limits, wallTimeMilliseconds: 1_999 } }, reviewer] },
    { ...original, slots: [check()] },
    { ...original, slots: [check(), { ...reviewer, role: "builder" }] },
    { ...original, decision: { ...original.decision, reason: "develop-candidate" } },
  ];
  for (const value of malformed) assert.throws(() => compileWorkDelegationReservation(value as Omit<WorkDelegationReservation, "charges">), invalid);
  const exact = compileWorkDelegationReservation(original);
  assert.throws(() => parseWorkDelegationReservation({ ...exact, charges: { ...exact.charges, operations: 0 } }), invalid);
  assert.deepEqual(parseWorkDelegationReservation(exact), exact);
});

test("the complete delegated opening keeps the Control 64-KiB bound without dropping slots", () => {
  const small = compileWorkDelegationReservation(reservationInput("delivery.evaluate"));
  const smallOpening = { activityId: small.activityId, operation: small.operation, reservation: small };
  assert.ok(Buffer.byteLength(canonicalJson(smallOpening), "utf8") < 65_536);
  const checks = Array.from({ length: 128 }, (_, index) => check(index));
  const large = reservationInput("delivery.evaluate", checks);
  const charges = { operations: 1, agentAttempts: 1, reservedCellWallTimeMs: 257_000 };
  assert.ok(Buffer.byteLength(canonicalJson({ activityId: large.activityId, operation: large.operation, reservation: { ...large, charges } }), "utf8") > 65_536);
  assert.throws(() => compileWorkDelegationReservation(large), (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.work-delegation.resource-limit" && error.operationalStateChanged === false && error.repositoryChanged === false);
  assert.equal(large.slots.length, 129);
});

test("canonical opening capacity accepts exactly 65,536 bytes and refuses one more", () => {
  const size = (value: Omit<WorkDelegationReservation, "charges">): number => Buffer.byteLength(canonicalJson({
    activityId: value.activityId, operation: value.operation,
    reservation: { ...value, charges: { operations: 1, agentAttempts: 1, reservedCellWallTimeMs: (value.slots.length - 1) * 2_000 + 1_000 } },
  }), "utf8");
  let selected = reservationInput("delivery.evaluate");
  for (let count = 2; count <= 128; count += 1) {
    const next = reservationInput("delivery.evaluate", Array.from({ length: count }, (_, index) => check(index)));
    if (size(next) > 65_536) break;
    selected = next;
  }
  // Fill capacity through existing bounded ASCII IDs only; no arbitrary
  // padding field, altered Control limit or omitted Check selection.
  let remaining = 65_536 - size(selected);
  const idPadding = Math.min(remaining, 511 - selected.reservationId.length);
  selected = { ...selected, reservationId: `${selected.reservationId}${"x".repeat(idPadding)}` };
  remaining -= idPadding;
  const first = selected.slots[0]!;
  assert.equal(first.purpose, "check");
  if (first.purpose !== "check") throw new Error("Expected the retained fixture Check slot");
  const bindingPadding = Math.min(remaining, 512 - first.binding.id.length);
  const imagePadding = remaining - bindingPadding;
  assert.ok(imagePadding <= 512 - first.image.imageId.length);
  selected = { ...selected, slots: [{ ...first, binding: { ...first.binding, id: `${first.binding.id}${"x".repeat(bindingPadding)}` }, image: { ...first.image, imageId: `${first.image.imageId}${"x".repeat(imagePadding)}` } }, ...selected.slots.slice(1)] };
  assert.equal(size(selected), 65_536);
  const compiled = compileWorkDelegationReservation(selected);
  assert.equal(compiled.slots.length, selected.slots.length);
  const overflow = { ...selected, reservationId: `${selected.reservationId}x` };
  assert.ok(overflow.reservationId.length <= 512);
  assert.equal(size(overflow), 65_537);
  assert.throws(() => compileWorkDelegationReservation(overflow), (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.work-delegation.resource-limit");
});
