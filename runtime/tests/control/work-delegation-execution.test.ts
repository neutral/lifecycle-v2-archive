import assert from "node:assert/strict";
import test from "node:test";
import { compileFoundationCheckCellResourceSelectionV1 } from "../../src/foundation/check/execution-cell-v1.js";
import { compileControlRecordEvent, compileControlRecordRevision } from "../../src/foundation/control/model.js";
import type { ControlJsonObject, ControlRecordEvent } from "../../src/foundation/control/types.js";
import {
  readWorkDelegationExecution,
  workDelegationAgentAttemptMatches,
  workDelegationAgentSelectionMatches,
  workDelegationAgentSlot,
  workDelegationCheckSelectionMatches,
  workDelegationCheckSlot,
  type WorkDelegationAgentSlot,
  type WorkDelegationCheckSlot,
  type WorkDelegationExecutionReadStore,
} from "../../src/foundation/control/work-delegation-execution.js";
import { compileWorkDelegationReservation, WORK_DELEGATION_RESERVATION_SCHEMA } from "../../src/foundation/control/work-delegation.js";
import { FoundationError } from "../../src/foundation/error.js";
import { initialDeliveryState } from "../../src/foundation/process/delivery-state.js";
import { createFoundationCommandCheckBinding } from "../../src/foundation/repository/contract.js";
import { canonicalJson, digestCanonical } from "../../src/foundation/validation/canonical.js";
import { executionContractFixture } from "../support/execution-contract-fixture.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

// Exact event-byte and pure resource correspondence fixtures. The read double
// represents already verified Journal custody, not a real reduced history.
// These assertions establish no authority, SQLite/recovery race, allocation,
// provider, containment or at-most-once execution evidence. Authored UNRUN.
const activityId = "activity.reserved-review";
const occurredAt = "2026-09-06T22:00:00.000Z";
const initial = initialDeliveryState();
const identity = {
  schema: "lifecycle.control-record-store.v2" as const,
  storeId: "store.execution-binding", targetId: "target.execution-binding",
  processKind: "delivery" as const, processId: "delivery.execution-binding", createdAt: occurredAt,
};

function resources() {
  const contract = executionContractFixture("work-delegation-execution");
  const image = { ...contract.image, runnerContractDigest: digestCanonical({ runner: "contract" }), runnerImplementationDigest: digestCanonical({ runner: "implementation" }), toolInventoryDigest: digestCanonical({ tools: "inventory" }) };
  const binding = createFoundationCommandCheckBinding({
    id: "binding.focused", checkIds: ["check.focused"], subjectSelectors: [{ kind: "repository", selector: "." }],
    executable: { relativeTo: "execution-image", path: "node" }, args: ["--version"], cwd: ".", network: "none", timeoutMs: 1_000,
    allowedModalities: ["postcondition"], capabilityProfileId: null, environment: {}, resultParser: "exit-code-v1",
    implementationDigest: digestCanonical({ binding: "implementation" }), limitations: [],
  });
  const checkResources = compileFoundationCheckCellResourceSelectionV1({ binding, profile: contract.profile, image });
  const agent: WorkDelegationAgentSlot = {
    slotId: "slot.reviewer", purpose: "agent", role: "reviewer",
    selection: {
      providerDescriptor: { id: "descriptor.fixture", digest: digestCanonical({ descriptor: "fixture" }) },
      backendProfile: checkResources.backendProfile, image: contract.image,
      model: "model.fixture", reasoning: "high", wallTimeMs: 1_000,
      limits: { tokens: null, events: 100, outputBytes: 1_048_576, toolCalls: null, processes: 8, storageBytes: 1_048_576 },
    },
  };
  const check: WorkDelegationCheckSlot = {
    slotId: "slot.check", purpose: "check", phase: "final", selectionId: "selection.focused",
    definition: { id: "check.focused", revision: 2, sourceDigest: digestCanonical({ definition: "source", revision: 2 }), semanticDigest: digestCanonical({ definition: "semantic", revision: 2 }) },
    binding: { id: binding.id, digest: binding.digest }, ...checkResources,
    wallTimeMs: checkResources.limits.wallTimeMilliseconds,
  };
  return { agent, check, binding, checkResources };
}

function journal(input: { manual?: boolean; prefixCount?: number; operation?: "delivery.evaluate" | "delivery.integrate" } = {}) {
  const events: ControlRecordEvent[] = [];
  const append = (eventKind: string, payload: ControlJsonObject) => {
    const event = compileControlRecordEvent({
      storeId: identity.storeId, processId: identity.processId,
      sequence: events.length + 1, predecessorDigest: events.at(-1)?.digest ?? null,
      event: { eventId: `event.fixture.${events.length + 1}`, eventKind, occurredAt, actor: { kind: "runtime", id: "runtime.fixture" }, payload },
    });
    events.push(event);
    return event;
  };
  for (let index = 0; index < (input.prefixCount ?? 2); index++) append("fixture-observed", { index });
  const selected = resources();
  const operation = input.operation ?? "delivery.evaluate";
  const reservation = compileWorkDelegationReservation({
    schema: WORK_DELEGATION_RESERVATION_SCHEMA, reservationId: "reservation.review",
    delegation: { kind: "work-delegation", id: "delegation.original", revision: 1, digest: digestCanonical({ delegation: "original" }) },
    activityId, operation,
    decision: { journalHead: { sequence: events.length, digest: events.at(-1)!.digest }, basisDigest: digestCanonical({ exact: "opening-basis" }), reason: operation === "delivery.evaluate" ? "evaluate-integrated-candidate" : "integrate-ready-candidate" },
    slots: operation === "delivery.evaluate" ? [selected.check, selected.agent] : [],
  });
  const opening = append("activity-started", { activityId, operation, ...(input.manual ? {} : { reservation }) });
  append("fixture-observed", { unrelated: true });
  const capturedHead = { eventCount: events.length, headDigest: events.at(-1)!.digest };
  const reads: Array<readonly [number, number]> = [];
  const store: WorkDelegationExecutionReadStore = {
    identity,
    state: () => ({ ...initial, journal: capturedHead }),
    listEvents(after = 0, limit = 1_000) { reads.push([after, limit]); return events.slice(after, after + limit); },
  };
  return { ...selected, events, append, opening, reservation, store, reads, capturedHead };
}

const bindingRefusal = (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.work-delegation.execution-binding";

test("one captured retained opening binds typed slots despite later unrelated work and replacement", () => {
  const f = journal({ prefixCount: 1_001 });
  // A later append is outside the captured prefix. Current grant/accounting is
  // deliberately different; historical matching must not allocate or re-charge.
  f.append("fixture-observed", { later: true });
  const store: WorkDelegationExecutionReadStore = { ...f.store, state: () => ({
    ...initial, standing: "closed", journal: f.capturedHead,
    delegation: { admission: null, current: { reference: { id: "delegation.replaced", revision: 8, digest: digestCanonical({ delegation: "later" }) }, stopped: true }, charged: { operations: 100, agentAttempts: 100, reservedCellWallTimeMs: 100_000 } },
  }) };
  const before = canonicalJson(f.events);
  const selected = readWorkDelegationExecution({ store, activityId });
  assert.deepEqual(selected.opening, { eventId: f.opening.eventId, sequence: f.opening.sequence, digest: f.opening.digest });
  assert.deepEqual(selected.reservation, f.reservation);
  assert.deepEqual(f.reads, [[0, 1_000], [1_000, 3]]);
  assert.deepEqual(workDelegationAgentSlot(selected, "reviewer"), f.agent);
  assert.deepEqual(workDelegationCheckSlot(selected, f.check.selectionId, "final"), f.check);
  assert.throws(() => workDelegationAgentSlot(selected, "builder"), bindingRefusal);
  assert.throws(() => workDelegationAgentSlot(selected, "reconnaissance"), bindingRefusal);
  assert.throws(() => workDelegationCheckSlot(selected, "selection.other", "final"), bindingRefusal);
  assert.throws(() => workDelegationCheckSlot(selected, f.check.selectionId, "baseline"), bindingRefusal);
  assert.equal(canonicalJson(f.events), before);
});

test("ordinary work is explicit null; a missing delegated slot never falls back to it", () => {
  const f = journal({ manual: true });
  const selected = readWorkDelegationExecution({ store: f.store, activityId });
  assert.equal(selected.reservation, null);
  assert.equal(workDelegationAgentSlot(selected, "reviewer"), null);
  assert.equal(workDelegationCheckSlot(selected, f.check.selectionId, "final"), null);
  const integrated = journal({ operation: "delivery.integrate" });
  const zeroCells = readWorkDelegationExecution({ store: integrated.store, activityId });
  assert.ok(zeroCells.reservation);
  assert.throws(() => workDelegationAgentSlot(zeroCells, "reviewer"), bindingRefusal);
  assert.throws(() => workDelegationCheckSlot(zeroCells, f.check.selectionId, "final"), bindingRefusal);
});

test("missing, duplicate, substituted or incomplete opening observations refuse", () => {
  const f = journal();
  assert.throws(() => readWorkDelegationExecution({ store: f.store, activityId: "activity.absent" }), bindingRefusal);
  for (const change of [
    (page: readonly ControlRecordEvent[]) => page.slice(1),
    (page: readonly ControlRecordEvent[]) => [...page, page[0]!],
    (page: readonly ControlRecordEvent[]) => page.map((event, index) => index === 1 ? { ...event, sequence: 1 } : event),
    (page: readonly ControlRecordEvent[]) => page.map((event, index) => index === 1 ? { ...event, storeId: "store.other" } : event),
    (page: readonly ControlRecordEvent[]) => page.map((event, index) => index === 1 ? { ...event, processId: "delivery.other" } : event),
    (page: readonly ControlRecordEvent[]) => page.map((event, index) => index === 1 ? { ...event, predecessorDigest: digestCanonical({ wrong: "predecessor" }) } : event),
    (page: readonly ControlRecordEvent[]) => page.map(event => event.sequence === f.opening.sequence ? { ...event, eventKind: "fixture-observed" } : event),
  ]) {
    const store: WorkDelegationExecutionReadStore = { ...f.store, listEvents: (after, limit) => change(f.store.listEvents(after, limit)) };
    assert.throws(() => readWorkDelegationExecution({ store, activityId }), bindingRefusal);
  }
  const wrongHead: WorkDelegationExecutionReadStore = { ...f.store, state: () => ({ ...initial, journal: { ...f.capturedHead, headDigest: digestCanonical({ wrong: "head" }) } }) };
  assert.throws(() => readWorkDelegationExecution({ store: wrongHead, activityId }), bindingRefusal);
  const duplicate = journal();
  duplicate.append("activity-started", duplicate.opening.payload);
  const duplicateStore = { ...duplicate.store, state: () => ({ ...initial, journal: { eventCount: duplicate.events.length, headDigest: duplicate.events.at(-1)!.digest } }) };
  assert.throws(() => readWorkDelegationExecution({ store: duplicateStore, activityId }), bindingRefusal);
  for (const payload of [
    { ...f.opening.payload, reservation: null },
    { ...f.opening.payload, unexpected: true },
    { ...f.opening.payload, operation: "delivery.continue" },
    { ...f.opening.payload, reservation: { ...f.reservation, activityId: "activity.substituted" } },
    { ...f.opening.payload, reservation: { ...f.reservation, decision: { ...f.reservation.decision, journalHead: { ...f.reservation.decision.journalHead, sequence: 1 } } } },
    { ...f.opening.payload, reservation: { ...f.reservation, decision: { ...f.reservation.decision, journalHead: { ...f.reservation.decision.journalHead, digest: digestCanonical({ wrong: "reserved-prefix" }) } } } },
    { ...f.opening.payload, reservation: { ...f.reservation, charges: { ...f.reservation.charges, agentAttempts: 0 } } },
  ]) {
    const store: WorkDelegationExecutionReadStore = { ...f.store, listEvents: (after, limit) => f.store.listEvents(after, limit).map(event => event.sequence === f.opening.sequence ? { ...event, payload } : event) };
    assert.throws(() => readWorkDelegationExecution({ store, activityId }), FoundationError);
  }
});

test("Agent correspondence includes exact provider, Backend, Image and every Investment selection", () => {
  const { agent } = resources();
  const actual = {
    provider: { descriptorId: agent.selection.providerDescriptor.id, descriptorDigest: agent.selection.providerDescriptor.digest },
    execution: { backendProfile: agent.selection.backendProfile, image: agent.selection.image },
    investment: { model: agent.selection.model, reasoning: agent.selection.reasoning, wallTimeMs: agent.selection.wallTimeMs, limits: agent.selection.limits },
  };
  assert.equal(workDelegationAgentSelectionMatches(agent, actual), true);
  const other = digestCanonical({ substituted: "selection" });
  const variants = [
    { ...actual, provider: { ...actual.provider, descriptorId: "descriptor.other" } },
    { ...actual, provider: { ...actual.provider, descriptorDigest: other } },
    ...(["profileId", "profileDigest", "implementationDigest"] as const).map(key => ({ ...actual, execution: { ...actual.execution, backendProfile: { ...actual.execution.backendProfile, [key]: key === "profileId" ? "lifecycle.execution-backend-profile.docker-local.v1" as const : other } } })),
    { ...actual, execution: { ...actual.execution, image: { ...actual.execution.image, imageId: "image.other" } } },
    { ...actual, execution: { ...actual.execution, image: { ...actual.execution.image, imageDigest: other } } },
    { ...actual, investment: { ...actual.investment, model: "model.other" } },
    { ...actual, investment: { ...actual.investment, reasoning: "low" } },
    { ...actual, investment: { ...actual.investment, wallTimeMs: actual.investment.wallTimeMs + 1 } },
    ...(["tokens", "events", "outputBytes", "toolCalls", "processes", "storageBytes"] as const).map(key => ({ ...actual, investment: { ...actual.investment, limits: { ...actual.investment.limits, [key]: (actual.investment.limits[key] ?? 0) + 1 } } })),
  ];
  for (const changed of variants) assert.equal(workDelegationAgentSelectionMatches(agent, changed), false);
});

test("retained Attempt matching uses its selected payload schema and exact role", () => {
  const { agent } = resources();
  const fixture = validDeliveryControlPayload("agent-attempt");
  const payload = {
    ...fixture, activityId, role: "reviewer", operation: "delivery.evaluate",
    provider: { ...fixture.provider as ControlJsonObject, descriptorId: agent.selection.providerDescriptor.id, descriptorDigest: agent.selection.providerDescriptor.digest },
    execution: { ...fixture.execution as ControlJsonObject, backendProfile: agent.selection.backendProfile, image: agent.selection.image },
    investment: { ...fixture.investment as ControlJsonObject, model: agent.selection.model, reasoning: agent.selection.reasoning, wallTimeMs: agent.selection.wallTimeMs, limits: agent.selection.limits },
    input: { ...fixture.input as ControlJsonObject, evidenceSetDigest: digestCanonical({ evidence: "fixture" }), propositionSetDigest: digestCanonical({ propositions: "fixture" }) },
  };
  const revision = compileControlRecordRevision(identity.processId, {
    recordId: "attempt.exact-resources", recordKind: "agent-attempt", revision: 1,
    producer: { kind: "runtime", id: "runtime.fixture" }, semanticAuthor: { kind: "runtime", id: "runtime.fixture" }, semanticAuthority: "runtime-derived",
    createdAt: occurredAt, semanticMarkdown: "# Exact resource facts\n", payload, relationships: [],
  });
  assert.equal(workDelegationAgentAttemptMatches(agent, revision), true);
  const altered = (changed: ControlJsonObject) => compileControlRecordRevision(identity.processId, { ...revision, payload: changed });
  assert.equal(workDelegationAgentAttemptMatches(agent, altered({ ...payload, investment: { ...payload.investment, model: "model.other" } })), false);
  assert.equal(workDelegationAgentAttemptMatches(agent, altered({ ...payload, role: "builder", operation: "delivery.continue", input: { ...payload.input, propositionSetDigest: null } })), false);
  for (const malformed of [
    { ...payload, provider: { ...payload.provider, descriptorDigest: null } },
    { ...payload, investment: { ...payload.investment, limits: { ...payload.investment.limits, unknown: 1 } } },
    { ...payload, role: "builder" },
  ]) assert.throws(() => workDelegationAgentAttemptMatches(agent, altered(malformed)), FoundationError);
  assert.throws(() => workDelegationAgentAttemptMatches(agent, { ...revision, recordKind: "work-boundary" }), bindingRefusal);
});

test("Check correspondence preserves occurrence, selected use, Binding and complete effective limits", () => {
  const f = resources();
  const request = { selectionId: f.check.selectionId, phase: "final" as const, definition: f.check.definition, bindingId: f.binding.id, binding: f.binding };
  const actual = { request, resources: f.checkResources };
  assert.equal(workDelegationCheckSelectionMatches(f.check, actual), true);
  const other = digestCanonical({ substituted: "check" });
  const requests = [
    { ...request, selectionId: "selection.other" }, { ...request, phase: "baseline" as const },
    { ...request, definition: { ...request.definition, id: "check.other" } },
    { ...request, definition: { ...request.definition, revision: 3 } },
    { ...request, definition: { ...request.definition, sourceDigest: other } },
    { ...request, definition: { ...request.definition, semanticDigest: other } },
    { ...request, bindingId: "binding.other" },
    { ...request, binding: { ...request.binding, id: "binding.other" } },
    { ...request, binding: { ...request.binding, digest: other } },
  ];
  for (const changed of requests) assert.equal(workDelegationCheckSelectionMatches(f.check, { ...actual, request: changed }), false);
  for (const key of ["wallTimeMilliseconds", "processes", "storageBytes", "outputEntries", "outputBytes", "outputEntryBytes", "events"] as const) {
    assert.equal(workDelegationCheckSelectionMatches(f.check, { ...actual, resources: { ...actual.resources, limits: { ...actual.resources.limits, [key]: actual.resources.limits[key] + 1 } } }), false);
  }
  for (const key of ["profileId", "profileDigest", "implementationDigest"] as const) {
    const backendProfile = { ...actual.resources.backendProfile, [key]: key === "profileId" ? "lifecycle.execution-backend-profile.docker-local.v1" as const : other };
    assert.equal(workDelegationCheckSelectionMatches(f.check, { ...actual, resources: { ...actual.resources, backendProfile } }), false);
  }
  for (const image of [{ ...actual.resources.image, imageId: "image.other" }, { ...actual.resources.image, imageDigest: other }]) {
    assert.equal(workDelegationCheckSelectionMatches(f.check, { ...actual, resources: { ...actual.resources, image } }), false);
  }
});
