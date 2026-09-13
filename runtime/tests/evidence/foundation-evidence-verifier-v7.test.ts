import assert from "node:assert/strict";
import test from "node:test";
import { retainEvidencePacket } from "../../src/foundation/control/evidence-packet.js";
import { compileControlRecordEvent, compileControlRecordRevision } from "../../src/foundation/control/model.js";
import { assertDeliveryControlRecordPayload } from "../../src/foundation/control/payload-registry.js";
import type { ControlJsonObject, ControlRecordEvent, ControlRecordRevision } from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import {
  verifyFoundationAcceptanceV7,
  resolveFoundationEvidenceObservationSubjectV7,
  verifyFoundationEvidenceV7,
  type FoundationAcceptanceDirectorSubjectV7,
  type FoundationAcceptanceVerificationInputV7,
  type FoundationEvidenceReferenceV7,
  type FoundationEvidenceVerificationInputV7,
} from "../../src/foundation/evidence/verifier-v7.js";
import { sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { evidenceFixtureV7, EVIDENCE_OBSERVATION_V7 } from "../helpers/evidence-fixture-v7.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

function reference(revision: ControlRecordRevision): FoundationEvidenceReferenceV7 {
  return Object.freeze({ id: revision.recordId, revision: revision.revision, digest: revision.digest });
}

function rechain(evidence: FoundationEvidenceVerificationInputV7, events: readonly ControlRecordEvent[]) {
  const result: ControlRecordEvent[] = [];
  for (const event of events) result.push(compileControlRecordEvent({
    storeId: evidence.identity.storeId,
    processId: evidence.identity.processId,
    sequence: result.length + 1,
    predecessorDigest: result.at(-1)?.digest ?? null,
    event,
  }));
  return Object.freeze(result);
}

function inputs(
  fixture = evidenceFixtureV7(),
  observationSubject?: FoundationEvidenceVerificationInputV7["observationSubject"],
) {
  const evidence: FoundationEvidenceVerificationInputV7 = Object.freeze({
    identity: fixture.identity,
    evaluationActivityId: fixture.activityId,
    selected: fixture.selected,
    events: Object.freeze([...fixture.events]),
    revisions: Object.freeze([...fixture.revisions.values()]),
    observationSubject: observationSubject ?? resolveFoundationEvidenceObservationSubjectV7({store:fixture.store,subjects:fixture.selected}),
    observation: EVIDENCE_OBSERVATION_V7,
  });
  return { fixture, evidence };
}

function retainedInputs() {
  const { fixture, evidence } = inputs();
  const { revision: packet } = retainEvidencePacket({
    store: fixture.store,
    activityId: fixture.activityId,
    observation: EVIDENCE_OBSERVATION_V7,
    runtimeId: "foundation-runtime",
  });
  const boundary = evidence.revisions.find(({ recordKind }) => recordKind === "work-boundary")!;
  const parentCommit = (boundary.payload.basis as ControlJsonObject).productBaseCommit;
  assert.equal(typeof parentCommit, "string");
  const acceptance: FoundationAcceptanceVerificationInputV7 = Object.freeze({
    evidence,
    packet,
    current: Object.freeze({ ...fixture.selected, evidence: reference(packet) }),
    parentCommit: parentCommit as string,
  });
  return { fixture, evidence, acceptance };
}

function directorSubject(input: FoundationAcceptanceVerificationInputV7): FoundationAcceptanceDirectorSubjectV7 {
  return Object.freeze({
    targetId: input.evidence.identity.targetId,
    storeId: input.evidence.identity.storeId,
    processId: input.evidence.identity.processId,
    operation: "delivery.accept",
    decision: "accept",
    repository: Object.freeze({ canonicalCommit: input.parentCommit }),
    selectedControl: Object.freeze([
      { relation: "selects-boundary", target: { kind: "work-boundary", ...input.evidence.selected.boundary } },
      { relation: "selects-candidate", target: { kind: "candidate-revision", ...input.evidence.selected.candidate } },
      { relation: "selects-seal", target: { kind: "candidate-seal", ...input.evidence.selected.seal } },
      { relation: "selects-evidence", target: { kind: "evidence-packet", ...reference(input.packet) } },
    ]),
  });
}

function expectRefusal(input: FoundationAcceptanceVerificationInputV7, code: string) {
  const result = verifyFoundationAcceptanceV7(input);
  assert.equal(result.status, "not-justified");
  if (result.status !== "not-justified") assert.fail("Invalid justification was accepted");
  assert.equal(result.reason.code, code);
  return result.reason;
}

test("Evidence interpretation derives repeatable support from immutable values without retaining Control", () => {
  const { fixture, evidence } = inputs();
  const before = JSON.stringify(evidence);
  const first = verifyFoundationEvidenceV7(evidence);
  const independent = verifyFoundationEvidenceV7(structuredClone(evidence));
  assert.equal(first.readiness, "acceptance-ready");
  assert.equal((first.payload.obligations as readonly ControlJsonObject[])[0]!.state, "satisfied");
  assert.deepEqual(independent, first);
  assert.equal(JSON.stringify(evidence), before);
  assert.equal(fixture.appended.length, 0);
});

test("Foundation provenance establishes review context separation from exact historical provider observations", () => {
  const {evidence} = inputs();
  const currentAttempt = evidence.revisions.find((value) => value.recordKind === "agent-attempt" && value.payload.role === "reviewer")!;
  const currentReceipt = evidence.revisions.find((value) => value.recordKind === "execution-receipt")!;
  const activityId = "activity.prior-builder";
  const builderAttempt = compileControlRecordRevision(currentAttempt.processId, {...currentAttempt,
    recordId:"attempt.prior-builder",payload:{...currentAttempt.payload,activityId,operation:"delivery.continue",role:"builder",
      input:{...currentAttempt.payload.input as ControlJsonObject,propositionSetDigest:null}},
    relationships:currentAttempt.relationships.filter(({relation}) => relation !== "uses-seal"),
  });
  assertDeliveryControlRecordPayload(builderAttempt);
  const sample = validDeliveryControlPayload("execution-receipt");
  const receiptEvent = evidence.events.find((event) => event.eventKind === "execution-receipt-recorded")!;
  for (const [session, expected] of [["provider-session-review","reused"],["different-provider-session","fresh"],[null,"fresh"]] as const) {
    const builderReceipt = compileControlRecordRevision(currentReceipt.processId, {...currentReceipt,
      recordId:"receipt.prior-builder",payload:{...sample,activityId,role:"builder",
        candidate:{input:(currentReceipt.payload.candidate as ControlJsonObject).input!,successorDisposition:"not-produced",successor:null,contentDisposition:null},
        provider:{...sample.provider as ControlJsonObject,sessionId:session}},
      relationships:[{relation:"observes-attempt",target:{kind:"agent-attempt",...reference(builderAttempt)}}],
    });
    assertDeliveryControlRecordPayload(builderReceipt);
    assert.equal(builderReceipt.payload.productiveExecutionStarted, false);
    assert.equal((builderReceipt.payload.candidate as ControlJsonObject).successorDisposition, "not-produced");
    const priorEvent = {...receiptEvent,eventId:"event.prior-builder-receipt",payload:{activityId},
      occurredAt:evidence.events[1]!.occurredAt,
      subject:{recordId:builderReceipt.recordId,revision:1,digest:builderReceipt.digest}};
    const selected = {...evidence,revisions:[...evidence.revisions,builderAttempt,builderReceipt],
      events:rechain(evidence,[...evidence.events.slice(0,2),priorEvent,...evidence.events.slice(2)])};
    const result = verifyFoundationEvidenceV7(selected);
    const independence = (result.payload.reviewerIndependence as readonly ControlJsonObject[])[0]!;
    assert.equal(independence.providerSession,expected);
    assert.equal(independence.state,expected === "fresh" ? "satisfied" : "failed");
    assert.equal(independence.attemptId,currentAttempt.recordId);
    assert.equal(independence.receiptId,currentReceipt.recordId);
    assert.equal(result.readiness,expected === "fresh" ? "acceptance-ready" : "correctable");
  }
  const unknownReceipt = compileControlRecordRevision(currentReceipt.processId,{...currentReceipt,
    payload:{...currentReceipt.payload,provider:{...currentReceipt.payload.provider as ControlJsonObject,sessionId:null}}});
  const unknown = {...evidence,revisions:evidence.revisions.map((value) => value === currentReceipt ? unknownReceipt : value),
    events:rechain(evidence,evidence.events.map((event) => event === receiptEvent ? {...event,
      subject:{recordId:unknownReceipt.recordId,revision:1,digest:unknownReceipt.digest}} : event))};
  const unknownResult = verifyFoundationEvidenceV7(unknown);
  const uncertainty = (unknownResult.payload.reviewerIndependence as readonly ControlJsonObject[])[0]!;
  assert.equal(uncertainty.providerSession,"indeterminate");
  assert.equal(uncertainty.state,"satisfied");
  assert.equal(unknownResult.readiness,"acceptance-ready");
});

test("Fresh reviewer construction refuses rehashed execution, input and provider substitutions", () => {
  const { evidence } = inputs();
  const receipt = evidence.revisions.find((value) => value.recordKind === "execution-receipt")!;
  const receiptEvent = evidence.events.find((event) => event.subject?.digest === receipt.digest)!;
  const substitutions: readonly Readonly<{ group: string; field: string; nested?: string; value: string }>[] = [
    { group: "execution", nested: "backendProfile", field: "profileDigest", value: sha256Bytes("another-profile") },
    { group: "execution", nested: "backendProfile", field: "implementationDigest", value: sha256Bytes("another-backend") },
    { group: "execution", nested: "image", field: "imageId", value: "another-image" },
    { group: "execution", nested: "image", field: "imageDigest", value: sha256Bytes("another-image") },
    { group: "execution", nested: "inputSet", field: "digest", value: sha256Bytes("another-input-set") },
    { group: "inputBindings", field: "roleBriefDigest", value: sha256Bytes("another-role-brief") },
    { group: "inputBindings", field: "contentInventoryDigest", value: sha256Bytes("another-inventory") },
    { group: "inputBindings", field: "inputMaterialDigest", value: sha256Bytes("another-material") },
    { group: "provider", field: "descriptorId", value: "another-descriptor" },
    { group: "provider", field: "descriptorDigest", value: sha256Bytes("another-descriptor") },
    { group: "provider", field: "installedIdentityDigest", value: sha256Bytes("another-installed-provider") },
    { group: "provider", field: "observedExecutableIdentity", value: sha256Bytes("another-observed-provider") },
    { group: "provider", field: "model", value: "another-model" },
  ];
  for (const { group, nested, field, value } of substitutions) {
    const original = receipt.payload[group] as ControlJsonObject;
    const substituted = nested === undefined ? { ...original, [field]: value }
      : { ...original, [nested]: { ...original[nested] as ControlJsonObject, [field]: value } };
    const changed = compileControlRecordRevision(receipt.processId, {
      ...receipt,
      payload: { ...receipt.payload, [group]: substituted },
    });
    assertDeliveryControlRecordPayload(changed);
    const input = {
      ...evidence,
      revisions: evidence.revisions.map((revision) => revision === receipt ? changed : revision),
      events: rechain(evidence, evidence.events.map((event) => event === receiptEvent
        ? { ...event, subject: { recordId: changed.recordId, revision: changed.revision, digest: changed.digest } }
        : event)),
    };
    assert.throws(() => verifyFoundationEvidenceV7(input),
      (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.control-evidence-packet.review-construction",
      `${group}.${nested === undefined ? "" : `${nested}.`}${field}`);
  }
  assert.equal(verifyFoundationEvidenceV7(evidence).readiness, "acceptance-ready");
});

test("Acceptance justification remains historical and distinguishes absent authority from matching subject values", () => {
  const { fixture, evidence, acceptance } = retainedInputs();
  const before = verifyFoundationEvidenceV7(evidence);
  fixture.completeEvaluation();
  assert.deepEqual(verifyFoundationEvidenceV7(evidence), before);
  assert.equal(fixture.store.state().activities.length, 0);
  assert.equal(fixture.events.length, evidence.events.length + 2);

  const unsigned = verifyFoundationAcceptanceV7(acceptance);
  assert.equal(unsigned.status, "justified");
  if (unsigned.status !== "justified") assert.fail("Exact justification was refused");
  assert.equal(unsigned.directorSubject, "not-supplied");
  const matched = verifyFoundationAcceptanceV7({ ...acceptance, directorDecisionSubject: directorSubject(acceptance) });
  assert.equal(matched.status, "justified");
  if (matched.status !== "justified") assert.fail("Exact Director subject did not match");
  assert.equal(matched.directorSubject, "matches");
  assert.equal(fixture.appended.length, 2);
});

test("Evidence refuses cross-Process records, mismatched observations, and unsupported exact rules", () => {
  const { evidence } = inputs();
  assert.throws(() => verifyFoundationEvidenceV7({
    ...evidence,
    identity: { ...evidence.identity, processId: "another-delivery" },
  }), (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.control-evidence-packet.relationship");
  assert.throws(() => verifyFoundationEvidenceV7({
    ...evidence,
    observationSubject: { ...evidence.observationSubject, candidate: { ...evidence.selected.candidate, digest: sha256Bytes("another-candidate") } },
  }), (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.evidence.observation-subject");
  assert.throws(() => verifyFoundationEvidenceV7({
    ...evidence,
    observation: { ...evidence.observation, ruleSet: { ...evidence.observation.ruleSet, digest: sha256Bytes("another-rule") } },
  }), (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.evidence.unsupported-verifier");
});

test("Integration provenance cannot substitute another target's internally valid parent Snapshot", () => {
  const original = inputs().evidence;
  const invalidFixture = evidenceFixtureV7({ integrationParentTargetId: "target-other" });
  assert.throws(() => inputs(invalidFixture),
    (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.integration.assessment-invalid");
  const { fixture, evidence } = inputs(invalidFixture, {
      ...original.observationSubject,
      boundary: invalidFixture.selected.boundary,
      candidate: invalidFixture.selected.candidate,
      seal: invalidFixture.selected.seal,
    });
  for (const revision of evidence.revisions) assertDeliveryControlRecordPayload(revision);
  assert.throws(() => verifyFoundationEvidenceV7(evidence),
    (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.integration.assessment-invalid");
  assert.equal(fixture.appended.length, 0);
});

test("Rehashed integrated Candidate state or observer cannot replace its Assessment's validated facts", () => {
  const { evidence: original } = inputs();
  const candidate = original.revisions.find((value) => value.digest === original.selected.candidate.digest)!;
  const substitutions: readonly ControlJsonObject[] = [
    { state: { ...(candidate.payload.state as ControlJsonObject), productStateDigest: sha256Bytes("another-state") } },
    { observer: { ...(candidate.payload.observer as ControlJsonObject), implementationDigest: sha256Bytes("another-observer") } },
  ];
  for (const integrationCandidatePayload of substitutions) {
    const invalidFixture = evidenceFixtureV7({ integrationCandidatePayload });
    assert.throws(() => inputs(invalidFixture),
      (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.integration.assessment-invalid");
    const { fixture, evidence } = inputs(invalidFixture, {
      ...original.observationSubject,
      boundary: invalidFixture.selected.boundary,
      candidate: invalidFixture.selected.candidate,
      seal: invalidFixture.selected.seal,
    });
    for (const revision of evidence.revisions) assertDeliveryControlRecordPayload(revision);
    assert.notEqual(evidence.selected.candidate.digest, original.selected.candidate.digest);
    assert.throws(() => verifyFoundationEvidenceV7(evidence),
      (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.integration.assessment-invalid");
    assert.equal(fixture.appended.length, 0);
  }
});

test("A structurally valid Packet cannot supply its own derived ledger or override physical observations", () => {
  const { acceptance } = retainedInputs();
  const propositions = acceptance.packet.payload.propositionDecisions as readonly ControlJsonObject[];
  const altered = compileControlRecordRevision(acceptance.packet.processId, {
    ...acceptance.packet,
    payload: { ...acceptance.packet.payload, propositionDecisions: propositions.map((entry, index) => index === 0
      ? { ...entry, fragmentDigest: sha256Bytes("unsupported-review-fragment") } : entry) },
  });
  assertDeliveryControlRecordPayload(altered);
  expectRefusal({ ...acceptance, packet: altered, current: { ...acceptance.current, evidence: reference(altered) } },
    "lifecycle.evidence.packet-mismatch");

  const changedFacts: FoundationEvidenceVerificationInputV7 = {
    ...acceptance.evidence,
    observation: { ...acceptance.evidence.observation, artifacts: acceptance.evidence.observation.artifacts.map((entry) => ({ ...entry, semanticValidation: "invalid" })) },
  };
  assert.equal(verifyFoundationEvidenceV7(changedFacts).readiness, "correctable");
  expectRefusal({ ...acceptance, evidence: changedFacts }, "lifecycle.evidence.packet-mismatch");
});

test("Readable Packet Markdown changes preserve justification while selecting a new exact Packet", () => {
  const { acceptance } = retainedInputs();
  const original = verifyFoundationAcceptanceV7(acceptance);
  assert.equal(original.status, "justified");
  if (original.status !== "justified") assert.fail("Exact baseline justification was refused");
  const rewritten = compileControlRecordRevision(acceptance.packet.processId, {
    ...acceptance.packet,
    semanticMarkdown: "# Evaluation Evidence\n\nThe required obligations are satisfied for the exact sealed Candidate.\n",
  });
  assertDeliveryControlRecordPayload(rewritten);
  assert.notEqual(rewritten.digest, acceptance.packet.digest);
  const result = verifyFoundationAcceptanceV7({
    ...acceptance,
    packet: rewritten,
    current: { ...acceptance.current, evidence: reference(rewritten) },
  });
  assert.equal(result.status, "justified");
  if (result.status !== "justified") assert.fail("Readable Markdown changed exact Evidence justification");
  assert.deepEqual(result.evidence, original.evidence);
  assert.deepEqual(result.acceptanceSubject, { ...original.acceptanceSubject, evidence: reference(rewritten) });
  assert.equal(result.directorSubject, "not-supplied");
});

test("An Artifact cannot remain satisfied when its observed schema validation failed", () => {
  const { evidence } = inputs();
  assert.equal(verifyFoundationEvidenceV7(evidence).readiness, "acceptance-ready");
  const observation = {
    ...evidence.observation,
    artifacts: evidence.observation.artifacts.map((entry) => ({ ...entry, schemaValidation: "invalid" as const })),
  };
  const result = verifyFoundationEvidenceV7({ ...evidence, observation });
  assert.equal(result.readiness, "correctable");
  assert.equal((result.payload.artifacts as readonly ControlJsonObject[])[0]!.state, "failed");
});

test("Description coverage cannot remain satisfied when exact ownership is missing", () => {
  const { evidence } = inputs();
  const description = Object.freeze({
    path: "src/evidence.ts",
    descriptionId: "description.evidence",
    selector: "#evidence",
    ownership: "exact" as const,
    implementationChange: "changed" as const,
    descriptionChange: "changed" as const,
    exclusionChange: "none" as const,
    obligationIds: Object.freeze([]),
  });
  const observation = { ...evidence.observation, descriptionCoverage: [description] };
  assert.equal(verifyFoundationEvidenceV7({ ...evidence, observation }).readiness, "acceptance-ready");
  const result = verifyFoundationEvidenceV7({
    ...evidence,
    observation: { ...observation, descriptionCoverage: [{ ...description, ownership: "missing" }] },
  });
  assert.equal(result.readiness, "correctable");
  assert.equal((result.payload.descriptionCoverage as readonly ControlJsonObject[])[0]!.state, "failed");
});

test("A truthfully non-ready Packet cannot justify acceptance", () => {
  const { fixture, evidence } = inputs();
  const observation = { ...EVIDENCE_OBSERVATION_V7, artifacts: EVIDENCE_OBSERVATION_V7.artifacts.map((entry) => ({ ...entry, semanticValidation: "invalid" as const })) };
  const packet = retainEvidencePacket({ store: fixture.store, activityId: fixture.activityId, observation, runtimeId: "foundation-runtime" }).revision;
  const boundary = evidence.revisions.find(({ recordKind }) => recordKind === "work-boundary")!;
  expectRefusal({
    evidence: { ...evidence, observation }, packet,
    current: { ...fixture.selected, evidence: reference(packet) },
    parentCommit: (boundary.payload.basis as ControlJsonObject).productBaseCommit as string,
  }, "lifecycle.evidence.not-ready");
});

test("Acceptance rejects currentness and Director-subject substitutions without changing historical meaning", () => {
  const { acceptance } = retainedInputs();
  const sourceMeaning = verifyFoundationEvidenceV7(acceptance.evidence);
  for (const [name, code] of [
    ["boundary", "superseded-boundary"], ["candidate", "wrong-candidate"],
    ["seal", "wrong-seal"], ["evidence", "wrong-evidence"],
  ] as const) {
    const selected = acceptance.current[name]!;
    const substituted = { ...selected, digest: sha256Bytes(`substituted-${name}`) };
    const reason = expectRefusal({ ...acceptance, current: { ...acceptance.current, [name]: substituted } }, `lifecycle.evidence.${code}`);
    const expected = reason.expected as FoundationEvidenceReferenceV7;
    assert.deepEqual({ id: expected.id, revision: expected.revision, digest: expected.digest }, selected);
    assert.deepEqual(reason.observed, substituted);
  }
  expectRefusal({ ...acceptance, current: { ...acceptance.current, materialCondition: { id: "condition-current", revision: 1, digest: sha256Bytes("condition-current") } } },
    "lifecycle.evidence.current-material-condition");
  expectRefusal({ ...acceptance, parentCommit: "f".repeat(40) }, "lifecycle.evidence.stale-parent");
  for (const subject of [
    { ...directorSubject(acceptance), operation: "delivery.no-ship", decision: "no-ship" },
    { ...directorSubject(acceptance), targetId: "another-target" },
  ]) expectRefusal({ ...acceptance, directorDecisionSubject: subject }, "lifecycle.evidence.wrong-director-subject");
  assert.deepEqual(verifyFoundationEvidenceV7(acceptance.evidence), sourceMeaning);
});

test("Recomputed event hashes cannot replace required evaluation provenance", () => {
  const { evidence } = inputs();
  // Finite omission corpus. Re-chain every remaining event so the oracle
  // exercises required Evidence provenance rather than only hash integrity.
  for (const omitted of ["activity-started", "provider-effect-intended", "provider-effect-observed"] as const) {
    const remaining = evidence.events.filter((event) => !(event.eventKind === omitted && event.payload.activityId === evidence.evaluationActivityId));
    assert.equal(remaining.length, evidence.events.length - 1, `fixture contains one ${omitted}`);
    const events: ControlRecordEvent[] = [];
    for (const event of remaining) events.push(compileControlRecordEvent({
      storeId: evidence.identity.storeId, processId: evidence.identity.processId,
      sequence: events.length + 1, predecessorDigest: events.at(-1)?.digest ?? null, event,
    }));
    assert.throws(() => verifyFoundationEvidenceV7({ ...evidence, events }),
      (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.control-evidence-packet.journal", omitted);
  }
});

test("A passing final Check for another sealed Candidate cannot support the selected Candidate", () => {
  const { fixture, evidence } = inputs();
  assert.equal(verifyFoundationEvidenceV7(evidence).readiness, "acceptance-ready");
  const candidate = evidence.revisions.find(({ recordKind }) => recordKind === "candidate-revision")!;
  const seal = evidence.revisions.find(({ recordKind }) => recordKind === "candidate-seal")!;
  const finalCheck = evidence.revisions.find((revision) => revision.recordKind === "check-receipt" && revision.payload.phase === "final")!;
  const anotherCandidate = compileControlRecordRevision(evidence.identity.processId, {
    ...candidate,
    recordId: "candidate-another-evidence",
  });
  const anotherSeal = compileControlRecordRevision(evidence.identity.processId, {
    ...seal,
    recordId: "candidate-seal-another-evidence",
    relationships: seal.relationships.map((entry) => entry.relation === "seals"
      ? { relation: entry.relation, target: { kind: "candidate-revision", ...reference(anotherCandidate) } } : entry),
  });
  const anotherCheck = compileControlRecordRevision(evidence.identity.processId, {
    ...finalCheck,
    recordId: "check-receipt-another-candidate",
    relationships: [{ relation: "checks-seal", target: { kind: "candidate-seal", ...reference(anotherSeal) } }],
  });
  for (const revision of [anotherCandidate, anotherSeal, anotherCheck]) assertDeliveryControlRecordPayload(revision);
  assert.equal(anotherCheck.payload.disposition, "pass");
  const events: ControlRecordEvent[] = [];
  for (const event of evidence.events) events.push(compileControlRecordEvent({
    storeId: evidence.identity.storeId,
    processId: evidence.identity.processId,
    sequence: events.length + 1,
    predecessorDigest: events.at(-1)?.digest ?? null,
    event: event.subject?.recordId === finalCheck.recordId ? {
      ...event,
      subject: { recordId: anotherCheck.recordId, revision: anotherCheck.revision, digest: anotherCheck.digest },
    } : event,
  }));
  // Both subjects and their complete relationships remain in the inventory;
  // the re-chained evaluation now cites the passing Check for the other Seal.
  assert.throws(() => verifyFoundationEvidenceV7({
    ...evidence,
    revisions: [...evidence.revisions, anotherCandidate, anotherSeal, anotherCheck],
    events,
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-evidence-packet.relationship" &&
    error.message === "check-receipt checks-seal does not bind the exact candidate-seal revision");
  assert.equal(fixture.appended.length, 0);
});

test("Recomputed hashes cannot place Evidence before its required observations or reverse event time", () => {
  const { fixture, evidence } = inputs();
  const received = evidence.events.at(-1)!;
  assert.equal(received.eventKind, "execution-receipt-recorded");
  const prior = evidence.events.at(-2)!;
  const earlierEventTime = new Date(Date.parse(prior.occurredAt) - 1_000).toISOString();
  const reversed = rechain(evidence, evidence.events.map((event) => event === received
    ? { ...event, occurredAt: earlierEventTime } : event));
  const earlierEvaluation = new Date(Date.parse(received.occurredAt) - 1_000).toISOString();
  for (const altered of [
    { ...evidence, events: reversed },
    { ...evidence, observation: { ...evidence.observation, evaluatedAt: earlierEvaluation } },
  ]) assert.throws(() => verifyFoundationEvidenceV7(altered),
    (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.control-evidence-packet.journal");
  assert.equal(fixture.appended.length, 0);
});

test("Later recovery coordination does not reinterpret the retained Evidence evaluation time", () => {
  const { fixture, evidence } = inputs();
  const expected = verifyFoundationEvidenceV7(evidence);
  const recovery = compileControlRecordEvent({
    storeId: evidence.identity.storeId,
    processId: evidence.identity.processId,
    sequence: evidence.events.length + 1,
    predecessorDigest: evidence.events.at(-1)!.digest,
    event: {
      eventId: "event-later-evaluation-recovery",
      eventKind: "activity-recovery-recorded",
      occurredAt: new Date(Date.parse(evidence.observation.evaluatedAt) + 1_000).toISOString(),
      actor: { kind: "runtime", id: "foundation-runtime" },
      subject: null,
      payload: { activityId: evidence.evaluationActivityId, kind: "finalization", resumesAt: "activity-finalization", exactEffectDigest: null },
    },
  });
  const actual = verifyFoundationEvidenceV7({ ...evidence, events: [...evidence.events, recovery] });
  assert.deepEqual(actual, expected);
  assert.equal(actual.payload.evaluatedAt, evidence.observation.evaluatedAt);
  assert.equal(fixture.appended.length, 0);
});

test("Packet creation may follow evaluation but cannot precede its evaluated facts", () => {
  const { acceptance } = retainedInputs();
  const evaluatedAt = Date.parse(acceptance.evidence.observation.evaluatedAt);
  const at = (offset: number) => compileControlRecordRevision(acceptance.packet.processId, {
    ...acceptance.packet,
    createdAt: new Date(evaluatedAt + offset).toISOString(),
  });
  const delayed = at(1_000);
  assertDeliveryControlRecordPayload(delayed);
  assert.equal(verifyFoundationAcceptanceV7({ ...acceptance, packet: delayed,
    current: { ...acceptance.current, evidence: reference(delayed) } }).status, "justified");
  const premature = at(-1_000);
  assertDeliveryControlRecordPayload(premature);
  expectRefusal({ ...acceptance, packet: premature, current: { ...acceptance.current, evidence: reference(premature) } },
    "lifecycle.evidence.packet-mismatch");
});

test("Reviewer Receipt payload bindings must agree with its exact retained relationships", () => {
  const { fixture, evidence } = inputs();
  const receipt = evidence.revisions.find(({ recordKind }) => recordKind === "execution-receipt")!;
  const workProduct = receipt.payload.workProduct as ControlJsonObject;
  const workProductReference = workProduct.reference as ControlJsonObject;
  const candidate = receipt.payload.candidate as ControlJsonObject;
  const candidateInput = candidate.input as ControlJsonObject;
  const substitutions: readonly (readonly [string, ControlJsonObject])[] = [
    ["reviewer role", { ...receipt.payload, role: "builder",
      candidate: { ...candidate, successorDisposition: "not-produced" } }],
    ["submitted Work Product", { ...receipt.payload, workProduct: { ...workProduct,
      reference: { ...workProductReference, digest: sha256Bytes("another-submitted-work-product") } } }],
    ["input Candidate carrier", { ...receipt.payload, candidate: { ...candidate,
      input: { ...candidateInput, carrierManifestDigest: sha256Bytes("another-candidate-carrier") } } }],
  ];
  for (const [name, payload] of substitutions) {
    const altered = compileControlRecordRevision(receipt.processId, { ...receipt, payload });
    assertDeliveryControlRecordPayload(altered);
    const events = rechain(evidence, evidence.events.map((event) => event.subject?.recordId === receipt.recordId
      ? { ...event, subject: { recordId: altered.recordId, revision: altered.revision, digest: altered.digest } } : event));
    assert.throws(() => verifyFoundationEvidenceV7({
      ...evidence,
      revisions: evidence.revisions.map((revision) => revision === receipt ? altered : revision),
      events,
    }), (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.control-evidence-packet.review-receipt", name);
  }
  assert.equal(fixture.appended.length, 0);
});


test("Recompilation cannot erase unsupported or noncanonical retained envelope values", () => {
  const { evidence, acceptance } = retainedInputs();
  const revision = evidence.revisions[0]!;
  // Fixed corpus: one marker, one omitted envelope key, one normalized text value,
  // and one omitted actor key. Each supplied original digest stays unchanged.
  const revisionMutations: readonly ControlRecordRevision[] = [
    { ...revision, schema: "invalid-envelope-marker" as ControlRecordRevision["schema"] },
    { ...revision, unownedEnvelopeField: "must-not-be-ignored" } as ControlRecordRevision,
    { ...revision, semanticMarkdown: revision.semanticMarkdown.replaceAll("\n", "\r\n") },
    { ...revision, producer: { ...revision.producer, unownedActorField: "must-not-be-ignored" } } as ControlRecordRevision,
  ];
  for (const changed of revisionMutations) {
    assert.throws(() => verifyFoundationEvidenceV7({
      ...evidence, revisions: [changed, ...evidence.revisions.slice(1)],
    }), (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.control-evidence-packet.relationship");
  }
  const event = evidence.events[0]!;
  const eventMutations: readonly ControlRecordEvent[] = [
    { ...event, schema: "invalid-envelope-marker" as ControlRecordEvent["schema"] },
    { ...event, unownedEnvelopeField: "must-not-be-ignored" } as ControlRecordEvent,
    { ...event, actor: { ...event.actor, unownedActorField: "must-not-be-ignored" } } as ControlRecordEvent,
  ];
  for (const changed of eventMutations) {
    assert.throws(() => verifyFoundationEvidenceV7({
      ...evidence, events: [changed, ...evidence.events.slice(1)],
    }), (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.control-evidence-packet.journal");
  }
  const packet = acceptance.packet;
  const packetMutations: readonly ControlRecordRevision[] = [
    { ...packet, schema: "invalid-envelope-marker" as ControlRecordRevision["schema"] },
    { ...packet, unownedEnvelopeField: "must-not-be-ignored" } as ControlRecordRevision,
    { ...packet, semanticMarkdown: packet.semanticMarkdown.replaceAll("\n", "\r\n") },
    { ...packet, producer: { ...packet.producer, unownedActorField: "must-not-be-ignored" } } as ControlRecordRevision,
  ];
  for (const changed of packetMutations) {
    expectRefusal({ ...acceptance, packet: changed }, "lifecycle.evidence.packet-mismatch");
  }
});

function withReviewSemantics(
  evidence: FoundationEvidenceVerificationInputV7,
  mutate: (semantics: ControlJsonObject) => ControlJsonObject,
  mutateCitations?: (citations: readonly ControlJsonObject[]) => readonly ControlJsonObject[],
): FoundationEvidenceVerificationInputV7 {
  const prior = evidence.revisions.find((value) => value.recordKind === "agent-work-product" && value.payload.role === "reviewer")!;
  const product = compileControlRecordRevision(prior.processId, { ...prior,
    payload: { ...prior.payload, roleSemantics: mutate(prior.payload.roleSemantics as ControlJsonObject),
      citations: mutateCitations?.(prior.payload.citations as readonly ControlJsonObject[]) ?? prior.payload.citations! } });
  assertDeliveryControlRecordPayload(product);
  const priorReceipt = evidence.revisions.find((value) => value.recordKind === "execution-receipt")!;
  const receipt = compileControlRecordRevision(priorReceipt.processId, { ...priorReceipt,
    payload: { ...priorReceipt.payload, workProduct: { ...(priorReceipt.payload.workProduct as ControlJsonObject),
      reference: { kind: product.recordKind, ...reference(product) } } },
    relationships: priorReceipt.relationships.map((edge) => edge.relation === "observes-work-product"
      ? { ...edge, target: { kind: product.recordKind, ...reference(product) } } : edge),
  });
  assertDeliveryControlRecordPayload(receipt);
  const replacements = new Map([[product.recordId, product], [receipt.recordId, receipt]]);
  return { ...evidence, revisions: evidence.revisions.map((value) => replacements.get(value.recordId) ?? value),
    events: rechain(evidence, evidence.events.map((event) => {
      const replacement = event.subject === null ? undefined : replacements.get(event.subject.recordId);
      return replacement === undefined ? event : { ...event, subject: { recordId: replacement.recordId,
        revision: replacement.revision, digest: replacement.digest } };
    })) };
}

test("Integration applicability is exact review meaning, independently gating an otherwise passing Evidence packet", () => {
  const { evidence, fixture } = inputs();
  const baseline = evidence.revisions.find((value) => value.recordKind === "check-receipt" && value.payload.phase === "baseline")!;
  const ready = verifyFoundationEvidenceV7(evidence);
  const applicability = ready.payload.integrationApplicability as ControlJsonObject;
  assert.equal((applicability.mandate as ControlJsonObject).disposition, "applicable");
  assert.deepEqual((applicability.baselines as readonly ControlJsonObject[]).map(({ receiptId }) => receiptId), [baseline.recordId]);
  for (const name of ["mandate", "baseline"] as const) {
    const changed = withReviewSemantics(evidence, (semantics) => name === "mandate"
      ? { ...semantics, mandateApplicability: { ...(semantics.mandateApplicability as ControlJsonObject), disposition: "indeterminate" } }
      : { ...semantics, baselineApplicability: (semantics.baselineApplicability as readonly ControlJsonObject[]).map((item) => ({ ...item, disposition: "indeterminate" })) });
    assert.equal(verifyFoundationEvidenceV7(changed).readiness, "correctable", `${name} applicability independently blocks acceptance`);
  }
  for (const baselineApplicability of [[], [{ receiptId: "check-receipt-another", disposition: "applicable", rationale: "Substituted baseline.",
    citationIds: ["citation.final-check"], fragmentDigest: sha256Bytes("wrong-baseline") }]]) {
    assert.throws(() => verifyFoundationEvidenceV7(withReviewSemantics(evidence, (semantics) => ({ ...semantics, baselineApplicability }))),
      (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.control-evidence-packet.review");
  }
  assert.throws(() => verifyFoundationEvidenceV7(withReviewSemantics(evidence, (semantics) => ({ ...semantics,
    baselineApplicability: (semantics.baselineApplicability as readonly ControlJsonObject[]).map((item) => ({ ...item, disposition: "insufficient" })) }))),
    (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.control-evidence-packet.material-condition");
  assert.throws(() => verifyFoundationEvidenceV7(withReviewSemantics(evidence, (semantics) => semantics,
    (citations) => citations.map((citation) => citation.subjectId === baseline.recordId
      ? { ...citation, subjectDigest: sha256Bytes("another-original-baseline") } : citation))),
    (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.control-evidence-packet.review");
  assert.equal(fixture.appended.length, 0);
});
