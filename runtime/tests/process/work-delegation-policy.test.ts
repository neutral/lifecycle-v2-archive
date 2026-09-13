import assert from "node:assert/strict";
import test from "node:test";
import type { FoundationAttemptView } from "../../src/foundation/control/attempt-view.js";
import { foundationIntegrationValidationFactsDigestV1 } from "../../src/foundation/control/integration-assessment.js";
import { compileControlRecordEvent, compileControlRecordRevision } from "../../src/foundation/control/model.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import type { ControlJsonObject, ControlRecordEvent, ControlRecordRevision, ControlRecordRelationship } from "../../src/foundation/control/types.js";
import { WORK_DELEGATION_POLICY_DIGEST, WORK_DELEGATION_POLICY_ID } from "../../src/foundation/control/work-delegation.js";
import { FoundationError } from "../../src/foundation/error.js";
import { initialDeliveryState } from "../../src/foundation/process/delivery-state.js";
import type { ReducedDeliveryState } from "../../src/foundation/process/delivery-reducer.js";
import { compileWorkDelegationDecision } from "../../src/foundation/process/work-delegation-policy.js";
import { digestCanonical } from "../../src/foundation/validation/canonical.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

// These finite policy tests supply an explicit verified-state
// read double and selected Attempt View owner results; they do not pretend this
// abbreviated Journal is a reducible Runtime history. Payload shapes, exact
// event bytes and Integration lineage still use their real owners. Connected
// Builder/Store tests separately cover ordinary effects, reservations and reopen.
const time = "2026-09-06T22:00:00.000Z";
const d = (value: string) => digestCanonical({ policyFixture: value });
const reference = (value: ControlRecordRevision) => ({ kind: value.recordKind, id: value.recordId, revision: value.revision, digest: value.digest });

function fixture() {
  const identity = { schema: "lifecycle.control-record-store.v2" as const, storeId: "store.policy", processId: "delivery.policy",
    processKind: "delivery" as const, targetId: "target.integration-fixture", createdAt: time };
  const records = new Map<string, ControlRecordRevision>();
  const events: ControlRecordEvent[] = [];
  const views = new Map<string, FoundationAttemptView>();
  let state: ReducedDeliveryState = { ...initialDeliveryState(), standing: "active", candidateCondition: "ready-for-work",
    eligibleOperations: ["delivery.continue", "delivery.integrate", "delivery.evaluate"] };
  let pending = false;
  const record = (kind: Parameters<typeof validDeliveryControlPayload>[0], id: string, payload: ControlJsonObject = validDeliveryControlPayload(kind),
    relationships: readonly ControlRecordRelationship[] = [], revision = 1) => {
    const value = compileControlRecordRevision(identity.processId, { recordId: id, recordKind: kind, revision,
      semanticMarkdown: `# ${kind}\n\nPolicy observation fixture.\n`, payload, relationships,
      producer: { kind: "runtime", id: "runtime.policy" }, semanticAuthor: { kind: "runtime", id: "runtime.policy" },
      semanticAuthority: "runtime-derived", createdAt: time });
    records.set(`${id}:${revision}`, value); return value;
  };
  const event = (kind: string, payload: ControlJsonObject, subject: ControlRecordRevision | null = null) => {
    const value = compileControlRecordEvent({ storeId: identity.storeId, processId: identity.processId, sequence: events.length + 1,
      predecessorDigest: events.at(-1)?.digest ?? null, event: { eventId: `event.policy.${events.length + 1}`, eventKind: kind, occurredAt: time,
        actor: { kind: "runtime", id: "runtime.policy" }, payload,
        ...(subject === null ? {} : { subject: { recordId: subject.recordId, revision: subject.revision, digest: subject.digest } }) } });
    events.push(value); state = { ...state, journal: { eventCount: events.length, headDigest: value.digest } }; return value;
  };
  const boundary = record("work-boundary", "boundary.policy");
  let candidate = record("candidate-revision", "candidate.policy", validDeliveryControlPayload("candidate-revision"), [{ relation: "governed-by", target: reference(boundary) }]);
  const admission = record("director-decision", "admission.policy");
  event("transaction-effect-observed", { activityId: "activity.admit" }, admission);
  const selected = { providerDescriptor: { id: "descriptor.policy", digest: d("descriptor") },
    backendProfile: { profileId: "lifecycle.execution-backend-profile.docker-local.v1", profileDigest: d("profile"), implementationDigest: d("implementation") },
    image: { imageId: "image.policy", imageDigest: d("image") }, model: "model.policy", reasoning: "high", wallTimeMs: 1_000,
    limits: { tokens: null, events: 10, outputBytes: 4096, toolCalls: null, processes: 4, storageBytes: 4096 } };
  const grant = record("work-delegation", "delegation.policy", {
    schema: "lifecycle.work-delegation.v2", boundary: reference(boundary), admission: reference(admission), replaces: null,
    policy: { id: WORK_DELEGATION_POLICY_ID, digest: WORK_DELEGATION_POLICY_DIGEST },
    allowedOperations: ["delivery.continue", "delivery.evaluate", "delivery.integrate"],
    directions: { continue: { kind: "director-brief", id: "brief.builder", revision: 1, digest: d("brief.builder") }, evaluate: { kind: "director-brief", id: "brief.reviewer", revision: 1, digest: d("brief.reviewer") } },
    agentSelections: { builder: structuredClone(selected), reviewer: structuredClone(selected) }, ceilings: { operations: 100, agentAttempts: 100, reservedCellWallTimeMs: 100_000 },
    expiresAt: null, stopPolicy: "finish-reserved-operation",
  });
  state = { ...state, subjects: { ...state.subjects, activeBoundary: reference(boundary), candidate: reference(candidate) },
    delegation: { admission: reference(admission), current: { reference: reference(grant), stopped: false }, charged: { operations: 0, agentAttempts: 0, reservedCellWallTimeMs: 0 } } };
  const store = { identity, state: () => state, listEvents: (after = 0, limit = 1000) => events.slice(after, after + limit),
    getRevision: (id: string, revision: number) => records.get(`${id}:${revision}`) ?? null,
    getWorkDelegationStopRequest: () => pending ? {} : null,
  } as unknown as ControlRecordStore;
  const decide = () => compileWorkDelegationDecision({ store, physical: { disposition: "active", archiveManifestDigest: null }, observedAt: time }, {
    compileAttemptView: input => views.get(input.selection.kind === "attempt" ? input.selection.attemptId : "") ?? null,
  });
  const settle = (activityId: string, operation: "delivery.continue" | "delivery.evaluate" | "delivery.integrate") => {
    event("activity-completed", { activityId }); state = { ...state, activities: [...state.activities,
      { id: activityId, operation, family: operation === "delivery.integrate" ? "integration" : "agent", stage: "completed", recovery: null }] };
  };
  const agent = (operation: "delivery.continue" | "delivery.evaluate", input: { proposal?: string; changed?: boolean; invalid?: boolean; providerFailed?: boolean; candidateInvalid?: boolean } = {}) => {
    const activityId = `activity.agent.${views.size}`;
    event("activity-started", { activityId, operation });
    const raw = validDeliveryControlPayload("agent-attempt");
    const attempt = record("agent-attempt", `attempt.${views.size}`, { ...raw, activityId, operation, role: operation === "delivery.continue" ? "builder" : "reviewer",
      input: { ...(raw.input as ControlJsonObject), evidenceSetDigest: d("evidence-input"), propositionSetDigest: operation === "delivery.evaluate" ? d("propositions") : null } },
    [{ relation: "uses-boundary", target: reference(boundary) }, { relation: "uses-candidate", target: reference(candidate) }]);
    event("agent-attempt-prepared", { activityId }, attempt);
    const old = candidate;
    if (operation === "delivery.continue" && !input.invalid && !input.candidateInvalid) {
      candidate = record("candidate-revision", old.recordId, { ...old.payload, observation: "builder-successor",
        state: { ...(old.payload.state as ControlJsonObject), tree: input.changed ? "c".repeat(40) : (old.payload.state as ControlJsonObject).tree!, unchangedFromPredecessor: !input.changed } },
      [{ relation: "governed-by", target: reference(boundary) }, { relation: "revises", target: reference(old) }], old.revision + 1);
      state = { ...state, subjects: { ...state.subjects, candidate: reference(candidate), seal: null, evidence: null } };
    }
    const view = {
      complete: true, coordinate: { attempt: reference(attempt) },
      attemptContract: { activityId, operation, boundary: reference(boundary), candidate: reference(old) },
      providerExecution: { effect: { outcome: input.providerFailed ? "failed" : "completed" } },
      agentSemantics: { workProduct: input.invalid || input.providerFailed ? null : { kind: "agent-work-product", id: `work.${views.size}`, revision: 1, digest: d(`work.${views.size}`) },
        roleSemantics: { role: operation === "delivery.continue" ? "builder" : "reviewer", proposal: input.proposal ?? "progress" },
        submissionDiagnostics: { diagnostic: input.invalid ? { code: "lifecycle.agent-work-product.invalid.local-reference", stage: "semantic", factsDigest: d("invalid") } : null,
          parserDisposition: "valid", compilerDisposition: input.invalid ? "invalid-result" : "retained" } },
      candidateTransition: { successorDisposition: input.candidateInvalid ? "invalid" : "promoted", successor: { revision: reference(candidate) }, contentDisposition: input.changed ? "changed" : "unchanged", failureFactsDigest: input.candidateInvalid ? d("candidate-invalid") : null },
      processAndProof: { checks: [], obligations: [] },
    } as unknown as FoundationAttemptView;
    views.set(attempt.recordId, view); settle(activityId, operation); return view;
  };
  const integrate = (outcome: "constructed" | "invalid" = "constructed") => {
    const activityId = `activity.integrate.${events.length}`;
    event("activity-started", { activityId, operation: "delivery.integrate" });
    const raw = validDeliveryControlPayload("integration-assessment");
    const assessment = record("integration-assessment", `integration.${events.length}`, { ...raw, outcome,
      validation: { complete: true, valid: outcome === "constructed", diagnosticCodes: outcome === "invalid" ? ["lifecycle.knowledge.invalid"] : [],
        factsDigest: foundationIntegrationValidationFactsDigestV1({ manifestFileDigest: (candidate.payload.carrierManifest as ControlJsonObject).digest as `sha256:${string}`, state: candidate.payload.state, observer: candidate.payload.observer }) } },
    [{ relation: "governed-by", target: reference(boundary) }, { relation: "integrates", target: reference(candidate) }]);
    event("integration-assessed", { activityId }, assessment);
    if (outcome === "constructed") candidate = record("candidate-revision", candidate.recordId, { ...candidate.payload, observation: "integration-successor" },
      [{ relation: "governed-by", target: reference(boundary) }, { relation: "revises", target: reference(candidate) }, { relation: "integrated-from", target: reference(assessment) }], candidate.revision + 1);
    state = { ...state, subjects: { ...state.subjects, candidate: reference(candidate), integrationAssessment: reference(assessment) } };
    settle(activityId, "delivery.integrate"); return assessment;
  };
  const evidence = (view: FoundationAttemptView, options: { readiness?: string; check?: string; rejected?: boolean } = {}) => {
    const seal = record("candidate-seal", "seal.policy");
    assert.ok(view.agentSemantics.workProduct);
    const packet = record("evidence-packet", "packet.policy", { ...validDeliveryControlPayload("evidence-packet"), readiness: options.readiness ?? "correctable" },
      [{ relation: "governed-by", target: reference(boundary) }, { relation: "evaluates", target: reference(candidate) },
        { relation: "uses-seal", target: reference(seal) }, { relation: "uses-review", target: view.agentSemantics.workProduct }]);
    state = { ...state, subjects: { ...state.subjects, seal: reference(seal), evidence: reference(packet) } };
    views.set(view.coordinate.attempt.id, { ...view, processAndProof: { ...view.processAndProof,
      checks: options.check === undefined ? [] : [{ final: { disposition: options.check } }],
      obligations: options.rejected || options.check === "fail" ? [{ standing: options.rejected ? "review-rejected" : "check-failed" }] : [],
    } } as unknown as FoundationAttemptView);
    return packet;
  };
  return { decide, store, records, events, views, agent, integrate, evidence, grant, boundary, get candidate() { return candidate; },
    state: () => state, changeState: (changed: ReducedDeliveryState) => { state = changed; }, stop: () => { pending = true; },
    replaceGrant() { const replacement = record("work-delegation", grant.recordId, { ...grant.payload, replaces: reference(grant) }, [], 2);
      state = { ...state, delegation: { ...state.delegation, current: { reference: reference(replacement), stopped: false } } }; },
  };
}

test("fixed policy starts useful labor, advances exact readiness, and never equates eligibility or unchanged bytes with proof", () => {
  const f = fixture();
  assert.equal(f.decide().reason, "develop-candidate");
  f.agent("delivery.continue", { changed: true }); assert.equal(f.decide().reason, "develop-candidate");
  f.agent("delivery.continue", { proposal: "ready-to-evaluate" }); assert.equal(f.decide().reason, "integrate-ready-candidate");
  f.integrate(); assert.equal(f.decide().reason, "evaluate-integrated-candidate");
  const g = fixture(); g.agent("delivery.continue"); assert.equal(g.decide().reason, "repeated-unchanged-result");
  const decision = f.decide(); assert.equal(decision.journalHead.digest, f.state().journal.headDigest);
});

test("invalid authoring permits one exact correction, while new IDs and grant replacement do not reset unchanged failure", () => {
  const f = fixture(); f.agent("delivery.continue", { invalid: true });
  assert.equal(f.decide().reason, "correct-in-scope-findings");
  f.replaceGrant(); f.agent("delivery.continue", { invalid: true });
  assert.equal(f.decide().reason, "repeated-unchanged-result");
  const g = fixture(); g.agent("delivery.continue", { providerFailed: true });
  assert.equal(g.decide().reason, "operational-failure");
  const h = fixture(); h.agent("delivery.continue", { candidateInvalid: true });
  assert.equal(h.decide().reason, "correct-in-scope-findings");
  h.agent("delivery.continue", { candidateInvalid: true }); assert.equal(h.decide().reason, "repeated-unchanged-result");
});

test("failed integration corrects its exact source and cannot repeat an unchanged merge as progress", () => {
  const f = fixture(); f.integrate("invalid"); assert.equal(f.decide().reason, "correct-in-scope-findings");
  f.agent("delivery.continue", { proposal: "ready-to-evaluate" }); assert.equal(f.decide().reason, "repeated-unchanged-result");
  const g = fixture(); g.integrate("invalid"); g.agent("delivery.continue", { changed: true, proposal: "ready-to-evaluate" });
  assert.equal(g.decide().reason, "integrate-ready-candidate");
});

test("invalid independent review gets one new evaluation, without labeling its failure as rejected Product", () => {
  const f = fixture(); f.integrate(); f.agent("delivery.evaluate", { invalid: true });
  assert.equal(f.decide().reason, "evaluate-integrated-candidate");
  f.replaceGrant(); f.agent("delivery.evaluate", { invalid: true });
  assert.equal(f.decide().reason, "repeated-unchanged-result");
});

test("exact reviewer or final Check findings justify repair but unsupported proof and substituted joins do not", () => {
  for (const options of [{ rejected: true }, { check: "fail" }]) {
    const f = fixture(); f.integrate(); const view = f.agent("delivery.evaluate"); f.evidence(view, options);
    assert.equal(f.decide().reason, "correct-in-scope-findings");
    f.agent("delivery.continue", { proposal: "ready-to-evaluate" }); assert.equal(f.decide().reason, "repeated-unchanged-result");
  }
  for (const [options, reason] of [
    [{ check: "unsupported", rejected: true }, "unresolved-proof"],
    [{ readiness: "no-ship-recommended" }, "director-decision-required"],
    [{ readiness: "acceptance-ready" }, "acceptance-required"],
    [{}, "unresolved-proof"],
  ] as const) { const f = fixture(); f.integrate(); f.evidence(f.agent("delivery.evaluate"), options); assert.equal(f.decide().reason, reason); }
  const f = fixture(); f.integrate(); const packet = f.evidence(f.agent("delivery.evaluate"), { rejected: true });
  f.records.set(`${packet.recordId}:1`, { ...packet, relationships: packet.relationships.map(link => link.relation === "uses-review"
    ? { ...link, target: { ...link.target, digest: d("other-review") } } : link) });
  assert.equal(f.decide().reason, "unresolved-proof");
});

test("valid useful output survives a separately reported provider failure", () => {
  const f = fixture(); const view = f.agent("delivery.continue", { changed: true });
  f.views.set(view.coordinate.attempt.id, { ...view, providerExecution: { ...view.providerExecution, effect: { ...view.providerExecution.effect, outcome: "failed" } } });
  assert.equal(f.decide().reason, "develop-candidate");
  const physical = fixture(); const output = physical.agent("delivery.continue", { changed: true });
  physical.views.set(output.coordinate.attempt.id, { ...output,
    agentSemantics: { ...output.agentSemantics, workProduct: null },
    providerExecution: { ...output.providerExecution, effect: { ...output.providerExecution.effect, outcome: "failed" } },
  });
  assert.equal(physical.decide().reason, "develop-candidate", "Actual changed promoted bytes justify fresh labor without fabricating semantic readiness");
  physical.agent("delivery.continue", { providerFailed: true });
  assert.equal(physical.decide().reason, "operational-failure", "Failed execution with no new physical progress cannot keep renewing work");
});

test("stop, cap, readmission, exact recovery and acceptance are distinct from productive choices", () => {
  for (const [reason, transform] of [
    ["closed", (s: ReducedDeliveryState) => ({ ...s, standing: "closed" as const })],
    ["acceptance-required", (s: ReducedDeliveryState) => ({ ...s, standing: "decision-ready" as const })],
    ["admission-required", (s: ReducedDeliveryState) => ({ ...s, delegation: { ...s.delegation, admission: { id: "new.admission", revision: 1, digest: d("new-admission") } } })],
    ["allowance-exhausted", (s: ReducedDeliveryState) => ({ ...s, delegation: { ...s.delegation, charged: { operations: 100, agentAttempts: 1, reservedCellWallTimeMs: 1000 } } })],
    ["material-condition", (s: ReducedDeliveryState) => ({ ...s, subjects: { ...s.subjects, materialCondition: { id: "condition", revision: 1, digest: d("condition") } } })],
    ["recovery-required", (s: ReducedDeliveryState) => ({ ...s, activities: [{ id: "activity.pending", operation: "delivery.continue" as const, family: "agent" as const, stage: "started" as const, recovery: { kind: "finalization" as const, resumesAt: "agent-attempt-prepared" as const, exactEffectDigest: null } }] })],
  ] as const) { const f = fixture(); f.changeState(transform(f.state())); assert.equal(f.decide().reason, reason); }
  const stopped = fixture(); stopped.stop(); assert.equal(stopped.decide().reason, "delegation-stopped");
  const corrupt = fixture(); corrupt.events[0] = { ...corrupt.events[0]!, predecessorDigest: d("forged") };
  assert.throws(() => corrupt.decide(), (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.work-delegation.policy-binding");
});
