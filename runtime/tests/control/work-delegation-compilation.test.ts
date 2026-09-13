import assert from "node:assert/strict";
import test from "node:test";
import { FOUNDATION_SEMANTIC_MARKDOWN_MAXIMUM_BYTES } from "@neutral/lifecycle-protocol";
import {
  compileWorkDelegation,
  type WorkDelegationCompilationInput,
  type WorkDelegationCompilationStore,
} from "../../src/foundation/control/work-delegation-compilation.js";
import { compileControlRecordRevision } from "../../src/foundation/control/model.js";
import { CONTROL_RECORD_STORE_SCHEMA, type ControlRecordRevision } from "../../src/foundation/control/types.js";
import { parseWorkDelegationPayload, type WorkDelegationAgentSelection } from "../../src/foundation/control/work-delegation.js";
import { compileWorkDelegationStopRequest } from "../../src/foundation/control/work-delegation-stop.js";
import { FoundationError } from "../../src/foundation/error.js";
import type { ReducedDeliveryState } from "../../src/foundation/process/delivery-reducer.js";
import { initialDeliveryState } from "../../src/foundation/process/delivery-state.js";
import { digestCanonical, sha256Bytes } from "../../src/foundation/validation/canonical.js";

// Compiler-boundary fixtures only: the map models already-reduced retained
// custody. Revisions/digests and submitted Briefs use real Control owners. These
// assertions do not establish SQLite atomic append, reducer replay, authentication,
// execution, stop races or productive continuation. All are authored UNRUN.
const submittedAt = "2026-09-06T20:00:00.000Z";
const directorId = "director.fixture";
const runtimeId = "runtime.fixture";

function ref(revision: ControlRecordRevision) {
  return { id: revision.recordId, revision: revision.revision, digest: revision.digest };
}

function fixture() {
  const identity = {
    schema: CONTROL_RECORD_STORE_SCHEMA, storeId: "store.delegation.compiler", targetId: "target.delegation.compiler",
    processKind: "delivery" as const, processId: "delivery.delegation.compiler", createdAt: submittedAt,
  };
  const boundary = compileControlRecordRevision(identity.processId, {
    recordId: "boundary.active", recordKind: "work-boundary", revision: 1,
    producer: { kind: "runtime", id: runtimeId }, semanticAuthor: { kind: "agent", id: "agent.fixture" },
    semanticAuthority: "agent-proposed", createdAt: submittedAt, semanticMarkdown: "Exact admitted mandate.\n",
    payload: {}, relationships: [],
  });
  const admission = compileControlRecordRevision(identity.processId, {
    recordId: "decision.applied-admission", recordKind: "director-decision", revision: 1,
    producer: { kind: "runtime", id: runtimeId }, semanticAuthor: { kind: "director", id: directorId },
    semanticAuthority: "director-authenticated", createdAt: submittedAt, semanticMarkdown: "Admit this mandate.\n",
    payload: { decision: "admit" }, relationships: [{ relation: "selects-boundary", target: { kind: "work-boundary", ...ref(boundary) } }],
  });
  const records = new Map([boundary, admission].map(value => [`${value.recordId}:${value.revision}`, value]));
  const state: ReducedDeliveryState = {
    ...initialDeliveryState(), standing: "active", candidateCondition: "ready-for-work",
    subjects: { ...initialDeliveryState().subjects, activeBoundary: ref(boundary) },
    delegation: { admission: ref(admission), current: null, charged: { operations: 0, agentAttempts: 0, reservedCellWallTimeMs: 0 } },
    journal: { eventCount: 21, headDigest: digestCanonical({ exactHead: 21 }) },
    eligibleOperations: ["delivery.continue", "delivery.no-ship"],
  };
  const reads: string[] = [];
  let stateReads = 0;
  const store: WorkDelegationCompilationStore = {
    identity,
    state() { stateReads++; return state; },
    getRevision(id, revision) { reads.push(`${id}:${revision}`); return records.get(`${id}:${revision}`) ?? null; },
  };
  return { store, state, boundary, admission, records, reads, stateReads: () => stateReads };
}

function selection(): WorkDelegationAgentSelection {
  return {
    providerDescriptor: { id: "descriptor.fixture", digest: digestCanonical({ descriptor: "fixture" }) },
    backendProfile: { profileId: "lifecycle.execution-backend-profile.fault-injection.v1", profileDigest: digestCanonical({ profile: "fixture" }), implementationDigest: digestCanonical({ implementation: "fixture" }) },
    image: { imageId: "image.fixture", imageDigest: digestCanonical({ image: "fixture" }) },
    model: "model.fixture", reasoning: "high", wallTimeMs: 1_000,
    limits: { tokens: null, events: 10_000, outputBytes: 1_048_576, toolCalls: null, processes: 128, storageBytes: 268_435_456 },
  };
}

function input(store: WorkDelegationCompilationStore): WorkDelegationCompilationInput {
  return {
    store, directorId, runtimeId, submittedAt,
    semanticMarkdown: "# Work allowance\n\nSpend only this bounded allowance under the admitted mandate.\n",
    allowedOperations: ["delivery.continue", "delivery.evaluate", "delivery.integrate"],
    directions: { continue: "# Builder direction\n\nComplete the admitted repair.\n\n", evaluate: "# Reviewer direction\n\nAssess the exact sealed result.\n" },
    agentSelections: { builder: selection(), reviewer: selection() },
    ceilings: { operations: 6, agentAttempts: 4, reservedCellWallTimeMs: 10_000 }, expiresAt: null,
  };
}

function refuses(reason: string) {
  return (error: unknown): boolean => error instanceof FoundationError &&
    error.code === "lifecycle.work-delegation.invalid" &&
    (error.observedFacts as { reason?: unknown } | undefined)?.reason === reason;
}

test("a grant compiles exact standing Briefs before its set event without retaining or changing authority", () => {
  const f = fixture();
  const selected = input(f.store);
  const before = JSON.stringify({ state: f.state, records: [...f.records] });
  const result = compileWorkDelegation(selected);
  assert.equal(f.stateReads(), 1);
  assert.deepEqual(f.reads, [`${f.boundary.recordId}:1`, `${f.admission.recordId}:1`]);
  assert.deepEqual(result.expectedHead, { sequence: 21, digest: f.state.journal.headDigest });
  assert.deepEqual(result.appends.map(append => append.event.eventKind), ["director-brief-submitted", "director-brief-submitted", "work-delegation-set"]);
  assert.equal(result.appends.some(append => Object.hasOwn(append.event.payload, "reservation")), false);
  assert.match(result.revision.recordId, /^work-delegation-[a-f0-9]{64}$/u);
  assert.equal(result.revision.revision, 1);
  assert.equal(result.revision.semanticAuthority, "director-supplied");
  assert.deepEqual(result.revision.semanticAuthor, { kind: "director", id: directorId });
  assert.deepEqual(result.payload.boundary, { kind: "work-boundary", ...ref(f.boundary) });
  assert.deepEqual(result.payload.admission, { kind: "director-decision", ...ref(f.admission) });
  assert.deepEqual(parseWorkDelegationPayload(result.revision.payload), result.payload);
  assert.equal(result.payload.replaces, null);
  assert.equal(result.revision.relationships.some(link => link.relation === "revises"), false);
  for (const [operation, brief] of [["delivery.continue", result.standingBriefs.continue], ["delivery.evaluate", result.standingBriefs.evaluate]] as const) {
    assert.ok(brief);
    const key = operation === "delivery.continue" ? "continue" : "evaluate";
    const direction = selected.directions[key]!;
    assert.equal(brief.compiled.semanticAuthority, "director-supplied");
    assert.deepEqual(brief.compiled.semanticAuthor, result.revision.semanticAuthor);
    assert.equal(brief.semantic.rawDigest, sha256Bytes(direction));
    assert.equal(brief.semantic.rawByteLength, Buffer.byteLength(direction, "utf8"));
    assert.equal(brief.compiled.semanticMarkdown, direction.trimEnd() + "\n");
    assert.deepEqual(brief.compiled.payload.scope, { kind: "delegation", delegationId: result.revision.recordId, delegationRevision: 1, operation });
    assert.deepEqual(result.payload.directions[key], { kind: "director-brief", ...ref(brief.compiled) });
    assert.ok(result.revision.relationships.some(link => link.relation === "uses-brief" && link.target.digest === brief.compiled.digest));
  }
  assert.deepEqual(result.appends.at(-1)!.event.subject, { recordId: result.revision.recordId, revision: 1, digest: result.revision.digest });
  assert.deepEqual(result.appends.at(-1)!.event.payload, {});
  assert.equal(JSON.stringify({ state: f.state, records: [...f.records] }), before);
  assert.deepEqual(compileWorkDelegation(selected), result);
});

test("integrate-only permission retains no invented Agent direction or Cell allowance", () => {
  const f = fixture();
  const result = compileWorkDelegation({ ...input(f.store), allowedOperations: ["delivery.integrate"], directions: { continue: null, evaluate: null }, agentSelections: { builder: null, reviewer: null }, ceilings: { operations: 1, agentAttempts: 0, reservedCellWallTimeMs: 0 } });
  assert.equal(result.appends.length, 1);
  assert.deepEqual(result.standingBriefs, { continue: null, evaluate: null });
  assert.deepEqual(result.payload.ceilings, { operations: 1, agentAttempts: 0, reservedCellWallTimeMs: 0 });
  assert.deepEqual(result.revision.relationships.map(link => link.relation), ["uses-admission", "uses-boundary"]);
});

test("explicit replacement keeps one lineage and lifetime charges across a changed admission", () => {
  const f = fixture();
  const first = compileWorkDelegation(input(f.store));
  f.records.set(`${first.revision.recordId}:1`, first.revision);
  const priorBytes = JSON.stringify(first);
  const boundary = compileControlRecordRevision(f.store.identity.processId, { ...f.boundary, revision: 2, semanticMarkdown: "Explicitly readmitted complete mandate.\n" });
  const admission = compileControlRecordRevision(f.store.identity.processId, { ...f.admission, recordId: "decision.applied-readmission", payload: { decision: "readmit" }, relationships: [{ relation: "selects-boundary", target: { kind: "work-boundary", ...ref(boundary) } }] });
  for (const value of [boundary, admission]) f.records.set(`${value.recordId}:${value.revision}`, value);
  const charged = { operations: 3, agentAttempts: 2, reservedCellWallTimeMs: 4_000 };
  const state: ReducedDeliveryState = { ...f.state, subjects: { ...f.state.subjects, activeBoundary: ref(boundary) }, delegation: { admission: ref(admission), current: { reference: ref(first.revision), stopped: true }, charged } };
  const selected = input({ ...f.store, state: () => state });
  const second = compileWorkDelegation({ ...selected, directions: { ...selected.directions, continue: "New explicitly supplied standing direction.\n" }, ceilings: charged });
  assert.equal(second.revision.recordId, first.revision.recordId);
  assert.equal(second.revision.revision, 2);
  assert.deepEqual(second.payload.replaces, { kind: "work-delegation", ...ref(first.revision) });
  assert.deepEqual(second.revision.relationships.find(link => link.relation === "revises")?.target, second.payload.replaces);
  assert.deepEqual(second.payload.boundary, { kind: "work-boundary", ...ref(boundary) });
  assert.deepEqual(second.payload.admission, { kind: "director-decision", ...ref(admission) });
  assert.deepEqual(second.charged, charged);
  assert.notEqual(second.standingBriefs.continue!.compiled.recordId, first.standingBriefs.continue!.compiled.recordId);
  assert.equal(JSON.stringify(first), priorBytes);
  for (const field of ["operations", "agentAttempts", "reservedCellWallTimeMs"] as const) {
    assert.throws(() => compileWorkDelegation({ ...selected, ceilings: { ...charged, [field]: charged[field] - 1 } }), refuses("lifetime-ceiling"));
  }
});

test("only a settled active admission can compile, and an unconsumed stop cannot be replaced", () => {
  const f = fixture();
  const states: readonly ReducedDeliveryState[] = [
    { ...f.state, standing: "closed" },
    { ...f.state, subjects: { ...f.state.subjects, closure: ref(f.boundary) } },
    { ...f.state, subjects: { ...f.state.subjects, activeBoundary: null } },
    { ...f.state, delegation: { ...f.state.delegation, admission: null } },
    { ...f.state, subjects: { ...f.state.subjects, materialCondition: ref(f.boundary) } },
    { ...f.state, activities: [{ id: "activity.running", operation: "delivery.continue", family: "agent", stage: "effect-intended", recovery: null }] },
    { ...f.state, activities: [{ id: "activity.recovery", operation: "delivery.continue", family: "agent", stage: "completed", recovery: { kind: "finalization", resumesAt: "activity-completed", exactEffectDigest: null } }] },
    { ...f.state, journal: { eventCount: 0, headDigest: null } },
  ];
  for (const state of states) assert.throws(() => compileWorkDelegation(input({ ...f.store, state: () => state })), refuses("currentness"));
  const first = compileWorkDelegation(input(f.store));
  const request = compileWorkDelegationStopRequest({ storeId: f.store.identity.storeId, processId: f.store.identity.processId, delegation: { kind: "work-delegation", ...ref(first.revision) }, requestedBy: directorId, requestedAt: submittedAt });
  assert.throws(() => compileWorkDelegation(input({ ...f.store, getWorkDelegationStopRequest: () => request })), refuses("pending-stop"));
});

test("current references cannot resolve another process, family, revision or digest", () => {
  for (const target of ["boundary", "admission"] as const) {
    for (const mutate of [
      (_: ControlRecordRevision) => null,
      (value: ControlRecordRevision) => ({ ...value, processId: "delivery.substituted" }),
      (value: ControlRecordRevision) => ({ ...value, recordKind: "candidate-revision" }),
      (value: ControlRecordRevision) => ({ ...value, recordId: "record.substituted" }),
      (value: ControlRecordRevision) => ({ ...value, revision: 2 }),
      (value: ControlRecordRevision) => ({ ...value, digest: digestCanonical({ substituted: true }) }),
    ]) {
      const f = fixture();
      const selected = f[target];
      const store: WorkDelegationCompilationStore = { ...f.store, getRevision: (id, revision) => id === selected.recordId ? mutate(selected) : f.store.getRevision(id, revision) };
      assert.throws(() => compileWorkDelegation(input(store)), refuses("retained-subject"));
    }
  }
});

test("resource provenance must match the applied admission, without signing another Decision", () => {
  const f = fixture();
  assert.throws(() => compileWorkDelegation({ ...input(f.store), directorId: "director.other" }), refuses("director"));
  const mutations: readonly Partial<ControlRecordRevision>[] = [
    { semanticAuthor: { kind: "agent", id: directorId } },
    { semanticAuthority: "director-supplied" },
    { payload: { decision: "accept" } },
    { relationships: [] },
    { relationships: [{ relation: "selects-boundary", target: { kind: "work-boundary", ...ref(f.boundary), revision: 2 } }] },
    { relationships: [{ relation: "selects-boundary", target: { kind: "candidate-revision", ...ref(f.boundary) } }] },
  ];
  for (const mutation of mutations) {
    const altered = compileControlRecordRevision(f.store.identity.processId, { ...f.admission, ...mutation });
    const state = { ...f.state, delegation: { ...f.state.delegation, admission: ref(altered) } };
    const store: WorkDelegationCompilationStore = { ...f.store, state: () => state, getRevision: (id, revision) => id === altered.recordId ? altered : f.store.getRevision(id, revision) };
    assert.throws(() => compileWorkDelegation(input(store)), refuses("admission"));
  }
});

test("expiry is inclusive and invalid authoring or operation inputs leave no partial batch", () => {
  const f = fixture();
  const selected = input(f.store);
  assert.throws(() => compileWorkDelegation({ ...selected, expiresAt: submittedAt }), refuses("expired"));
  assert.equal(compileWorkDelegation({ ...selected, expiresAt: "2026-09-06T20:00:00.001Z" }).payload.expiresAt, "2026-09-06T20:00:00.001Z");
  for (const mutation of [
    { allowedOperations: ["delivery.accept"] },
    { allowedOperations: ["delivery.evaluate", "delivery.continue"] },
    { allowedOperations: ["delivery.continue", "delivery.continue"] },
    { directions: { continue: null, evaluate: selected.directions.evaluate } },
    { agentSelections: { builder: null, reviewer: selected.agentSelections.reviewer } },
    { semanticMarkdown: "---\n{}\n---\n" },
    { semanticMarkdown: "x".repeat(FOUNDATION_SEMANTIC_MARKDOWN_MAXIMUM_BYTES + 1) },
    { directions: { ...selected.directions, continue: "Not public CRLF input.\r\n" } },
    { directions: { ...selected.directions, evaluate: "bad\u0000direction" } },
  ]) {
    assert.throws(() => compileWorkDelegation({ ...selected, ...mutation } as WorkDelegationCompilationInput), FoundationError);
  }
  assert.equal(f.records.size, 2);
  assert.equal(f.state.journal.eventCount, 21);
  assert.deepEqual(f.state.delegation.charged, { operations: 0, agentAttempts: 0, reservedCellWallTimeMs: 0 });
});
