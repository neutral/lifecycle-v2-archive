import assert from "node:assert/strict";
import test from "node:test";
import { compileControlRecordEvent } from "../../src/foundation/control/model.js";
import type {
  ControlJsonObject,
  ControlRecordEvent,
  ControlRecordRelationship,
  ControlRecordRevision,
  ControlRecordEventSubject,
} from "../../src/foundation/control/types.js";
import { CONTROL_RECORD_REVISION_SCHEMA } from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import {
  DELIVERY_EVENT_KINDS,
  assertDeliveryEventPayload,
  deliveryEventDescriptor,
  deliveryEventDescriptors,
} from "../../src/foundation/process/delivery-event-registry.js";
import {
  DELIVERY_RECOVERY_STEPS,
  deliveryRecoveryDescriptor,
  deliveryRecoveryDescriptors,
} from "../../src/foundation/process/recovery-registry.js";
import {
  assertDeliveryReplayIntegrity,
  assertDeliveryReplaySealable,
  composeDeliveryStoreDisposition,
  createDeliveryReplay,
  reduceDeliveryEvents,
} from "../../src/foundation/process/delivery-reducer.js";
import {
  digestCanonical,
  sha256Bytes,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";

function subject(id: string, revision = 1): ControlRecordEventSubject {
  return Object.freeze({ recordId: id, revision, digest: sha256Bytes(`${id}-${revision}`) });
}

function effect(id: string): Sha256 {
  return sha256Bytes(`effect-${id}`);
}

function relationship(
  relation: string,
  kind: string,
  selected: ControlRecordEventSubject,
): ControlRecordRelationship {
  return Object.freeze({
    relation,
    target: Object.freeze({
      kind,
      id: selected.recordId,
      revision: selected.revision,
      digest: selected.digest,
    }),
  });
}

type RevisionFacts = Readonly<{
  payload?: ControlJsonObject;
  relationships?: readonly ControlRecordRelationship[];
}>;

function attemptFacts(
  brief: ControlRecordEventSubject,
  boundary: ControlRecordEventSubject | null = null,
  candidate: ControlRecordEventSubject | null = null,
  seal: ControlRecordEventSubject | null = null,
): RevisionFacts {
  return {
    relationships: [
      relationship("uses-brief", "founder-brief", brief),
      ...(boundary === null ? [] : [relationship("uses-boundary", "work-boundary", boundary)]),
      ...(candidate === null ? [] : [relationship("uses-candidate", "candidate-revision", candidate)]),
      ...(seal === null ? [] : [relationship("uses-seal", "candidate-seal", seal)]),
    ],
  };
}

function boundaryFacts(
  brief: ControlRecordEventSubject,
  workProduct: ControlRecordEventSubject,
  prior: ControlRecordEventSubject | null = null,
  condition: ControlRecordEventSubject | null = null,
  checks: readonly Readonly<{ id: string; baselineRequired: boolean; finalRequired: boolean }>[] = Object.freeze([
    Object.freeze({ id: "selection.default", baselineRequired: true, finalRequired: true }),
  ]),
): RevisionFacts {
  return {
    payload: {
      schema: "lifecycle.work-boundary-payload.v4",
      mandate: {
        checks: checks.map((check) => Object.freeze({ ...check })),
      },
    },
    relationships: [
      relationship("uses-brief", "founder-brief", brief),
      relationship("proposed-from", "agent-work-product", workProduct),
      ...(prior === null ? [] : [relationship("revises", "work-boundary", prior)]),
      ...(condition === null ? [] : [relationship("resolves", "material-condition", condition)]),
    ],
  };
}

function checkFacts(
  phase: "baseline" | "final",
  modality: "precondition" | "repair-target" | "regression-guard" | "postcondition" | "diagnostic",
  disposition: "pass" | "fail" | "indeterminate" | "not-run" | "unsupported" | "operational-error",
  relation: ControlRecordRelationship,
  selectionId = "selection.default",
): RevisionFacts {
  return {
    payload: {
      schema: "lifecycle.check-receipt-payload.v2",
      selectionId,
      phase,
      modality,
      disposition,
    },
    relationships: [relation],
  };
}

function candidateRevisionV2Payload(
  observation: "initialization" | "builder-successor" | "readmission-rebind",
): ControlJsonObject {
  return Object.freeze({
    schema: "lifecycle.candidate-revision-payload.v2",
    profileId: "lifecycle.candidate-revision.observation.v1",
    observation,
    candidateBaseCommit: "a".repeat(40),
    carrierManifest: Object.freeze({
      digest: sha256Bytes(`carrier:${observation}`),
      byteLength: 1024,
      mediaType: "application/vnd.lifecycle.candidate-revision-carrier-manifest+json",
      purpose: "candidate-revision-carrier-manifest",
    }),
    state: Object.freeze({
      tree: "b".repeat(40),
      candidateDigest: sha256Bytes(`candidate:${observation}`),
      productStateDigest: sha256Bytes(`product:${observation}`),
      knowledgeSetDigest: sha256Bytes(`knowledge:${observation}`),
      diffDigest: sha256Bytes(`diff:${observation}`),
      pathInventoryDigest: sha256Bytes(`paths:${observation}`),
      artifactSetDigest: sha256Bytes(`artifacts:${observation}`),
      descriptionCoverageDigest: sha256Bytes(`descriptions:${observation}`),
      unchangedFromPredecessor: true,
      changedSubjects: Object.freeze([]),
    }),
    observer: Object.freeze({
      implementationId: "candidate-observer-v1",
      implementationDigest: sha256Bytes("candidate-observer"),
    }),
    limitations: Object.freeze([]),
  });
}

function closurePayload(
  disposition: "accepted" | "no-ship",
  candidateTreatment: "integrated" | "abandoned" | "not-created",
  containment: "complete" | "incomplete" = "complete",
): ControlJsonObject {
  return Object.freeze({
    schema: "lifecycle.closure-payload.v4",
    disposition,
    candidateTreatment,
    terminalExecutions: Object.freeze({
      containment: Object.freeze({ classification: containment }),
      retirement: Object.freeze({ classification: "complete" }),
    }),
  });
}

function agentMaterialConditionFixture(input: Readonly<{
  activityId: string;
  conditionId: string;
  workProduct: ControlRecordEventSubject;
  receipt: ControlRecordEventSubject;
  candidate: ControlRecordEventSubject;
  boundary: ControlRecordEventSubject;
}>): Readonly<{ payload: ControlJsonObject; facts: RevisionFacts }> {
  const observedFactsDigest = sha256Bytes(`material-condition-facts:${input.conditionId}`);
  return Object.freeze({
    payload: Object.freeze({
      sourceKind: "agent-proposal",
      activityId: input.activityId,
      observedFactsDigest,
    }),
    facts: Object.freeze({
      payload: Object.freeze({
        conditionClass: "missing-required-source",
        source: Object.freeze({
          kind: "agent-proposal",
          conditionId: input.conditionId,
          fragmentDigest: sha256Bytes(`material-condition-fragment:${input.conditionId}`),
        }),
        observedFactsDigest,
      }),
      relationships: Object.freeze([
        relationship("reported-by", "agent-work-product", input.workProduct),
        relationship("observed-in", "execution-receipt", input.receipt),
        relationship("freezes", "candidate-revision", input.candidate),
        relationship("governed-by", "work-boundary", input.boundary),
      ]),
    }),
  });
}

class EventChain {
  readonly events: ControlRecordEvent[] = [];

  readonly revisions = new Map<string, ControlRecordRevision>();

  private revisionKey(selected: ControlRecordEventSubject): string {
    return `${selected.recordId}\u0000${selected.revision}\u0000${selected.digest}`;
  }

  readonly resolveRevision = (
    selected: ControlRecordEventSubject,
  ): ControlRecordRevision | null => this.revisions.get(this.revisionKey(selected)) ?? null;

  fork(): EventChain {
    const branch = new EventChain();
    branch.events.push(...this.events);
    for (const [key, revision] of this.revisions) branch.revisions.set(key, revision);
    return branch;
  }

  append(
    eventKind: string,
    payload: ControlJsonObject,
    selectedSubject: ControlRecordEventSubject | null = null,
    facts: RevisionFacts = {},
  ): ControlRecordEvent {
    const previous = this.events.at(-1) ?? null;
    const sequence = this.events.length + 1;
    let retainedPayload = payload;
    if (eventKind === "transaction-effect-observed") {
      const activityId = payload.activityId;
      const opening = this.events.find((event) =>
        event.eventKind === "activity-started" && event.payload.activityId === activityId);
      const outcome = payload.outcome as "applied" | "not-applied" | "indeterminate";
      const synthesizedFacts = opening?.payload.operation === "delivery.admit"
        ? Object.freeze({
            schema: "lifecycle.admission-effect-observation-facts.v2",
            outcome,
            disposition: outcome === "not-applied"
              ? Object.freeze({
                  outcome: "not-applied",
                  reason: "repository-basis-mismatch",
                  observedFactsDigest: sha256Bytes(`admission-repository-basis-${sequence}`),
                })
              : null,
            repositoryBasisDigest: outcome === "indeterminate"
              ? null
              : sha256Bytes(`admission-repository-basis-${sequence}`),
          })
        : opening?.payload.operation === "delivery.accept" && outcome === "applied"
          ? Object.freeze({
              schema: "lifecycle.terminal-acceptance-effect-observation.v1",
              ref: "refs/heads/main",
              commit: "a".repeat(40),
              tree: "b".repeat(40),
              objectFormat: "sha1",
              canonicalResultDigest: sha256Bytes(`terminal-canonical-result-${sequence}`),
            })
          : Object.freeze({
              schema: "lifecycle.terminal-repository-effect-observation.v1",
              ref: "refs/heads/main",
              commit: "a".repeat(40),
              tree: "b".repeat(40),
              objectFormat: "sha1",
            });
      const facts = payload.facts ?? synthesizedFacts;
      retainedPayload = Object.freeze({
        ...payload,
        facts,
        factsDigest: payload.factsDigest ?? digestCanonical(facts),
      });
    }
    const event = compileControlRecordEvent({
      storeId: "store-reducer-test",
      processId: "delivery-reducer-test",
      sequence,
      predecessorDigest: previous?.digest ?? null,
      event: {
        eventId: `event-${sequence}`,
        eventKind,
        occurredAt: "2026-08-29T08:00:00Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        subject: selectedSubject,
        payload: retainedPayload,
      },
    });
    this.events.push(event);
    if (selectedSubject !== null) {
      const key = this.revisionKey(selectedSubject);
      if (!this.revisions.has(key)) {
        const kind = deliveryEventDescriptor(eventKind).subjectKind;
        if (kind === null) throw new Error(`${eventKind} cannot synthesize a Control revision`);
        this.revisions.set(key, Object.freeze({
          schema: CONTROL_RECORD_REVISION_SCHEMA,
          processId: "delivery-reducer-test",
          recordId: selectedSubject.recordId,
          recordKind: kind,
          revision: selectedSubject.revision,
          producer: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
          semanticAuthor: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
          semanticAuthority: "runtime-derived",
          createdAt: "2026-08-29T08:00:00Z",
          semanticMarkdown: "Synthetic reducer fixture.\n",
          payload: Object.freeze(facts.payload ?? {}),
          relationships: Object.freeze(facts.relationships ?? []),
          digest: selectedSubject.digest,
        }));
      }
    }
    return event;
  }
}

function reduce(chain: EventChain) {
  return reduceDeliveryEvents(chain.events, chain.resolveRevision);
}

function copyRecordFactIntoEvent(
  chain: EventChain,
  eventKind: string,
  copiedPayload: ControlJsonObject,
): EventChain {
  const branch = chain.fork();
  const index = branch.events.findIndex((event) => event.eventKind === eventKind);
  if (index < 0) throw new Error(`Missing ${eventKind} fixture event`);
  const retained = branch.events[index]!;
  branch.events[index] = compileControlRecordEvent({
    storeId: retained.storeId,
    processId: retained.processId,
    sequence: retained.sequence,
    predecessorDigest: retained.predecessorDigest,
    event: {
      eventId: retained.eventId,
      eventKind: retained.eventKind,
      occurredAt: retained.occurredAt,
      actor: retained.actor,
      subject: retained.subject,
      payload: copiedPayload,
    },
  });
  return branch;
}

function prepare(
  chain: EventChain,
  activityId: string,
  suffix: string,
): Readonly<{
  attempt: ControlRecordEventSubject;
  boundary: ControlRecordEventSubject;
  baselineReceipt: ControlRecordEventSubject;
}> {
  const brief = subject(`brief-${suffix}`);
  chain.append("founder-brief-submitted", { activityId }, brief);
  const attempt = subject(`attempt-${suffix}`);
  const workProduct = subject(`work-product-${suffix}`);
  const boundary = subject(`boundary-${suffix}`);
  const receipt = subject(`receipt-${suffix}`);
  const baselineReceipt = subject(`baseline-check-${suffix}`);
  const providerEffect = effect(`provider-${suffix}`);
  chain.append("activity-started", { activityId, operation: "delivery.prepare" });
  chain.append("agent-attempt-prepared", { activityId }, attempt, attemptFacts(brief));
  chain.append("provider-effect-intended", { activityId, effectDigest: providerEffect }, attempt);
  chain.append(
    "provider-effect-observed",
    { activityId, effectDigest: providerEffect, outcome: "completed" },
    attempt,
  );
  chain.append("agent-work-product-submitted", { activityId }, workProduct);
  chain.append("execution-receipt-recorded", { activityId }, receipt);
  chain.append("work-boundary-finalized", { activityId }, boundary, boundaryFacts(brief, workProduct));
  chain.append(
    "check-receipt-recorded",
    { activityId },
    baselineReceipt,
    checkFacts(
      "baseline",
      "regression-guard",
      "pass",
      relationship("checks-boundary", "work-boundary", boundary),
    ),
  );
  chain.append("activity-completed", { activityId, outcome: "completed" });
  return Object.freeze({ attempt, boundary, baselineReceipt });
}

function code(expected: string): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    assert.equal((error as { code?: string }).code, `lifecycle.delivery-reducer.${expected}`);
    return true;
  };
}

function eventCode(expected: string): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    assert.equal((error as { code?: string }).code, `lifecycle.delivery-event.${expected}`);
    return true;
  };
}

test("one compact registry contains only Delivery durability and business boundaries", () => {
  assert.equal(DELIVERY_EVENT_KINDS.length, 22);
  assert.equal(deliveryEventDescriptors().length, DELIVERY_EVENT_KINDS.length);
  assert.equal(new Set(DELIVERY_EVENT_KINDS).size, DELIVERY_EVENT_KINDS.length);
  assert(!DELIVERY_EVENT_KINDS.includes("semantic-result-parsed" as never));
  assert(!DELIVERY_EVENT_KINDS.includes("role-result-compiled" as never));
  assert(!DELIVERY_EVENT_KINDS.includes("canonical-json-rendered" as never));
  assert.equal(deliveryRecoveryDescriptors().length, DELIVERY_RECOVERY_STEPS.length);
  assert.equal(new Set(DELIVERY_RECOVERY_STEPS).size, DELIVERY_RECOVERY_STEPS.length);
  assert.deepEqual(
    deliveryRecoveryDescriptor("candidate-observation", "candidate-revision-observed").next,
    { type: "event", eventKinds: ["candidate-revision-observed"] },
  );
  assert.deepEqual(
    deliveryRecoveryDescriptor("finalization", "agent-attempt-prepared").next,
    { type: "event", eventKinds: ["agent-attempt-prepared", "agent-pre-intent-refused"] },
  );
  assert.deepEqual(
    deliveryRecoveryDescriptor("finalization", "transaction-effect-intended").next,
    { type: "event", eventKinds: ["transaction-effect-intended"] },
  );
  assert.throws(
    () => deliveryRecoveryDescriptor("candidate-observation", "work-product-observation"),
    /Unsupported Delivery recovery obligation/u,
  );

  const copiedRecordFact = new EventChain();
  const invalid = copiedRecordFact.append("delivery-created", { disposition: "accepted" });
  assert.throws(() => assertDeliveryEventPayload(invalid), eventCode("payload"));

  const retiredAtlasDrift = copiedRecordFact.append(
    "material-condition-frozen",
    {
      sourceKind: "runtime-atlas-drift",
      activityId: null,
      observedFactsDigest: sha256Bytes("retired-runtime-atlas-drift"),
    },
    subject("retired-runtime-atlas-drift"),
  );
  assert.throws(() => assertDeliveryEventPayload(retiredAtlasDrift), eventCode("payload"));
});

test("pre-intent refusal abandons an Agent activity without an Attempt or Receipt", () => {
  const chain = new EventChain();
  chain.append("delivery-created", {});
  const activityId = "prepare-pre-intent-refused";
  const brief = subject("brief-pre-intent-refused");
  chain.append("founder-brief-submitted", { activityId }, brief);
  chain.append("activity-started", { activityId, operation: "delivery.prepare" });
  chain.append("agent-pre-intent-refused", {
    activityId,
    diagnosticCode: "lifecycle.repository.epoch-moved",
    refusalFactsDigest: sha256Bytes("pre-intent-refusal"),
  });

  let state = reduce(chain);
  assert.equal(state.activities.at(-1)?.stage, "finalizing");
  assert.deepEqual(state.activities.at(-1)?.recovery, {
    kind: "finalization",
    resumesAt: "activity-completed",
    exactEffectDigest: null,
  });
  chain.append("activity-completed", { activityId, outcome: "abandoned" });
  state = reduce(chain);
  assert.equal(state.activities.at(-1)?.stage, "completed");
  assert.equal(chain.events.some(({ eventKind }) => eventKind === "agent-attempt-prepared"), false);
  assert.equal(chain.events.some(({ eventKind }) => eventKind === "provider-effect-intended"), false);
});

test("incremental replay forks preserve an independent exact derived state", () => {
  const chain = new EventChain();
  chain.append("delivery-created", {});
  const brief = subject("brief-forkable-replay");
  chain.append(
    "founder-brief-submitted",
    { activityId: "prepare-forkable-replay" },
    brief,
  );
  chain.append(
    "activity-started",
    { activityId: "prepare-forkable-replay", operation: "delivery.prepare" },
  );

  const replay = createDeliveryReplay(chain.resolveRevision);
  for (const event of chain.events) replay.append(event);
  const branch = replay.fork();
  const attempt = subject("attempt-forkable-replay");
  branch.append(chain.append(
    "agent-attempt-prepared",
    { activityId: "prepare-forkable-replay" },
    attempt,
    attemptFacts(brief),
  ));

  assert.equal(replay.finish().journal.eventCount, 3);
  assert.equal(replay.finish().activities[0]?.stage, "started");
  assert.deepEqual(replay.finish().activities[0]?.recovery, {
    kind: "finalization",
    resumesAt: "agent-attempt-prepared",
    exactEffectDigest: null,
  });
  assert.equal(branch.finish().journal.eventCount, 4);
  assert.equal(branch.finish().activities[0]?.stage, "prepared");
  assert.deepEqual(branch.finish().activities[0]?.recovery, {
    kind: "finalization",
    resumesAt: "provider-effect-intended",
    exactEffectDigest: null,
  });
});

test("a missing Candidate remains absent during unrelated preparation recovery", () => {
  const chain = new EventChain();
  chain.append("delivery-created", {});
  const activityId = "prepare-candidate-absent-recovery";
  chain.append(
    "founder-brief-submitted",
    { activityId },
    subject("brief-candidate-absent-recovery"),
  );
  chain.append("activity-started", { activityId, operation: "delivery.prepare" });

  const state = reduce(chain);
  assert.equal(state.subjects.candidate, null);
  assert.equal(state.candidateCondition, "absent");
  assert.deepEqual(state.activities.at(-1)?.recovery, {
    kind: "finalization",
    resumesAt: "agent-attempt-prepared",
    exactEffectDigest: null,
  });
});

test("transaction opening and authority retention always expose their exact next recovery boundary", () => {
  const chain = new EventChain();
  chain.append("delivery-created", {});
  const { boundary, baselineReceipt } = prepare(chain, "prepare-recovery", "recovery");
  const activityId = "admit-recovery";
  chain.append("activity-started", { activityId, operation: "delivery.admit" });

  let state = reduce(chain);
  assert.deepEqual(state.eligibleOperations, ["delivery.recover"]);
  assert.deepEqual(state.activities.at(-1)?.recovery, {
    kind: "finalization",
    resumesAt: "founder-decision-authenticated",
    exactEffectDigest: null,
  });

  const decision = subject("decision-recovery");
  chain.append(
    "founder-decision-authenticated",
    { activityId },
    decision,
    {
      payload: { decision: "admit" },
      relationships: [
        relationship("selects-boundary", "work-boundary", boundary),
        relationship("selects-baseline-receipt", "check-receipt", baselineReceipt),
      ],
    },
  );
  state = reduce(chain);
  assert.deepEqual(state.eligibleOperations, ["delivery.recover"]);
  assert.deepEqual(state.activities.at(-1)?.recovery, {
    kind: "finalization",
    resumesAt: "transaction-effect-intended",
    exactEffectDigest: null,
  });

  const admissionEffect = effect("admit-recovery");
  chain.append(
    "transaction-effect-intended",
    { activityId, effectDigest: admissionEffect },
    decision,
  );
  chain.append(
    "transaction-effect-observed",
    { activityId, effectDigest: admissionEffect, outcome: "applied" },
    decision,
  );
  state = reduce(chain);
  assert.equal(state.subjects.activeBoundary?.digest, boundary.digest);
  assert.equal(state.subjects.proposedBoundary, null);
  assert.equal(state.subjects.candidate, null);
  assert.equal(state.standing, "active");
  assert.equal(state.candidateCondition, "absent");
  assert.deepEqual(state.eligibleOperations, ["delivery.recover"]);
  assert.deepEqual(state.activities.at(-1)?.recovery, {
    kind: "candidate-observation",
    resumesAt: "candidate-revision-observed",
    exactEffectDigest: null,
  });
});

test("no-ship hard-cuts a current Candidate to abandoned", () => {
  const chain = new EventChain();
  chain.append("delivery-created", {});
  const prepared = prepare(chain, "prepare-abandoned", "abandoned");
  const candidate = subject("candidate-abandoned");
  const admissionDecision = subject("decision-admit-abandoned");
  const admissionEffect = effect("admit-abandoned");
  chain.append(
    "activity-started",
    { activityId: "admit-abandoned", operation: "delivery.admit" },
  );
  chain.append(
    "founder-decision-authenticated",
    { activityId: "admit-abandoned" },
    admissionDecision,
    {
      payload: { decision: "admit" },
      relationships: [
        relationship("selects-boundary", "work-boundary", prepared.boundary),
        relationship("selects-baseline-receipt", "check-receipt", prepared.baselineReceipt),
      ],
    },
  );
  chain.append(
    "transaction-effect-intended",
    { activityId: "admit-abandoned", effectDigest: admissionEffect },
    admissionDecision,
  );
  chain.append(
    "transaction-effect-observed",
    { activityId: "admit-abandoned", effectDigest: admissionEffect, outcome: "applied" },
    admissionDecision,
  );
  chain.append(
    "candidate-revision-observed",
    { activityId: "admit-abandoned" },
    candidate,
    {
      payload: candidateRevisionV2Payload("initialization"),
      relationships: [
        relationship("governed-by", "work-boundary", prepared.boundary),
      ],
    },
  );
  chain.append(
    "activity-completed",
    { activityId: "admit-abandoned", outcome: "completed" },
  );

  const noShipDecision = subject("decision-no-ship-abandoned");
  const noShipEffect = effect("no-ship-abandoned");
  chain.append(
    "activity-started",
    { activityId: "no-ship-abandoned", operation: "delivery.no-ship" },
  );
  chain.append(
    "founder-decision-authenticated",
    { activityId: "no-ship-abandoned" },
    noShipDecision,
    {
      payload: { decision: "no-ship" },
      relationships: [
        relationship("selects-boundary", "work-boundary", prepared.boundary),
        relationship("selects-candidate", "candidate-revision", candidate),
      ],
    },
  );
  chain.append(
    "transaction-effect-intended",
    { activityId: "no-ship-abandoned", effectDigest: noShipEffect },
    noShipDecision,
  );
  chain.append(
    "transaction-effect-observed",
    { activityId: "no-ship-abandoned", effectDigest: noShipEffect, outcome: "applied" },
    noShipDecision,
  );
  chain.append(
    "closure-recorded",
    { activityId: "no-ship-abandoned" },
    subject("closure-no-ship-abandoned"),
    {
      payload: closurePayload("no-ship", "abandoned"),
      relationships: [
        relationship("closes-with", "founder-decision", noShipDecision),
        relationship("governed-by", "work-boundary", prepared.boundary),
        relationship("abandons-candidate", "candidate-revision", candidate),
      ],
    },
  );

  const state = reduce(chain);
  assert.equal(state.standing, "closed");
  assert.equal(state.candidateCondition, "abandoned");
  assert.equal(
    composeDeliveryStoreDisposition(state, "active-unsealed").candidateCondition,
    "abandoned",
  );
  assert.equal(
    composeDeliveryStoreDisposition(state, "sealed-unarchived").candidateCondition,
    "abandoned",
  );
  assert.equal(
    composeDeliveryStoreDisposition(state, "archived-verified").candidateCondition,
    "abandoned",
  );
});

test("a non-reconstructible predecessor Candidate payload cannot become current or ready for work", () => {
  const chain = new EventChain();
  chain.append("delivery-created", {});
  const { boundary, baselineReceipt } = prepare(
    chain,
    "prepare-candidate-unavailable",
    "candidate-unavailable",
  );
  const activityId = "admit-candidate-unavailable";
  const decision = subject("decision-candidate-unavailable");
  const transactionEffect = effect("admit-candidate-unavailable");
  chain.append("activity-started", { activityId, operation: "delivery.admit" });
  chain.append(
    "founder-decision-authenticated",
    { activityId },
    decision,
    {
      payload: { decision: "admit" },
      relationships: [
        relationship("selects-boundary", "work-boundary", boundary),
        relationship("selects-baseline-receipt", "check-receipt", baselineReceipt),
      ],
    },
  );
  chain.append(
    "transaction-effect-intended",
    { activityId, effectDigest: transactionEffect },
    decision,
  );
  chain.append(
    "transaction-effect-observed",
    { activityId, effectDigest: transactionEffect, outcome: "applied" },
    decision,
  );
  chain.append(
    "candidate-revision-observed",
    { activityId },
    subject("candidate-unavailable"),
    {
      payload: {
        availability: "unavailable",
        failureFactsDigest: sha256Bytes("candidate-unavailable-observation"),
      },
      relationships: [relationship("governed-by", "work-boundary", boundary)],
    },
  );
  assert.throws(() => reduce(chain), code("candidate-payload"));
});

test("a determinate not-applied admission proceeds directly to failed activity completion", () => {
  const chain = new EventChain();
  chain.append("delivery-created", {});
  const { boundary, baselineReceipt } = prepare(chain, "prepare-not-applied", "not-applied");
  const activityId = "admit-not-applied";
  const decision = subject("decision-not-applied");
  const transactionEffect = effect("admission-not-applied");
  chain.append("activity-started", { activityId, operation: "delivery.admit" });
  chain.append(
    "founder-decision-authenticated",
    { activityId },
    decision,
    {
      payload: { decision: "admit" },
      relationships: [
        relationship("selects-boundary", "work-boundary", boundary),
        relationship("selects-baseline-receipt", "check-receipt", baselineReceipt),
      ],
    },
  );
  chain.append(
    "transaction-effect-intended",
    { activityId, effectDigest: transactionEffect },
    decision,
  );
  const substitutedFacts = chain.fork();
  substitutedFacts.append(
    "transaction-effect-observed",
    {
      activityId,
      effectDigest: transactionEffect,
      outcome: "applied",
      facts: Object.freeze({
        schema: "lifecycle.terminal-repository-effect-observation.v1",
        ref: "refs/heads/main",
        commit: "a".repeat(40),
        tree: "b".repeat(40),
        objectFormat: "sha1",
      }),
    },
    decision,
  );
  assert.throws(() => reduce(substitutedFacts), (error: unknown) =>
    error instanceof FoundationError &&
    error.code === "lifecycle.transaction-observation-facts-v7.operation");
  chain.append(
    "transaction-effect-observed",
    { activityId, effectDigest: transactionEffect, outcome: "not-applied" },
    decision,
  );

  let state = reduce(chain);
  assert.deepEqual(state.activities.at(-1)?.recovery, {
    kind: "finalization",
    resumesAt: "activity-completed",
    exactEffectDigest: null,
  });
  assert.equal(state.subjects.proposedBoundary?.digest, boundary.digest);
  assert.equal(state.subjects.candidate, null);

  chain.append("activity-completed", { activityId, outcome: "failed" });
  state = reduce(chain);
  assert.equal(state.standing, "awaiting-admission");
  assert.equal(state.activities.at(-1)?.stage, "completed");
  assert.equal(state.subjects.proposedBoundary?.digest, boundary.digest);
  assert.equal(state.subjects.candidate, null);
});

test("terminal failed completion requires one exact determinate not-applied observation", () => {
  const chain = new EventChain();
  chain.append("delivery-created", {});
  const { boundary } = prepare(chain, "prepare-terminal-not-applied", "terminal-not-applied");
  const activityId = "no-ship-not-applied";
  const decision = subject("decision-no-ship-not-applied");
  const transactionEffect = effect("no-ship-not-applied");
  chain.append("activity-started", { activityId, operation: "delivery.no-ship" });
  chain.append(
    "founder-decision-authenticated",
    { activityId },
    decision,
    {
      payload: { decision: "no-ship" },
      relationships: [relationship("selects-boundary", "work-boundary", boundary)],
    },
  );
  chain.append(
    "transaction-effect-intended",
    { activityId, effectDigest: transactionEffect },
    decision,
  );

  const beforeObservation = chain.fork();
  beforeObservation.append("activity-completed", { activityId, outcome: "failed" });
  assert.throws(() => reduce(beforeObservation), code("order"));

  const indeterminate = chain.fork();
  indeterminate.append(
    "transaction-effect-observed",
    { activityId, effectDigest: transactionEffect, outcome: "indeterminate" },
    decision,
  );
  indeterminate.append("activity-completed", { activityId, outcome: "failed" });
  assert.throws(() => reduce(indeterminate), code("order"));

  const applied = chain.fork();
  applied.append(
    "transaction-effect-observed",
    { activityId, effectDigest: transactionEffect, outcome: "applied" },
    decision,
  );
  applied.append("activity-completed", { activityId, outcome: "failed" });
  assert.throws(() => reduce(applied), code("order"));

  chain.append(
    "transaction-effect-observed",
    { activityId, effectDigest: transactionEffect, outcome: "not-applied" },
    decision,
  );
  let state = reduce(chain);
  assert.deepEqual(state.activities.at(-1)?.recovery, {
    kind: "finalization",
    resumesAt: "activity-completed",
    exactEffectDigest: null,
  });
  chain.append("activity-completed", { activityId, outcome: "failed" });
  state = reduce(chain);
  assert.equal(state.activities.at(-1)?.stage, "completed");
  assert.equal(state.activities.at(-1)?.recovery, null);
  assert.equal(state.subjects.closure, null);
});

test("preparation binds its planned Brief and publishes only a checked completed proposal", () => {
  const missingBrief = new EventChain();
  missingBrief.append("delivery-created", {});
  missingBrief.append("activity-started", { activityId: "prepare-missing", operation: "delivery.prepare" });
  assert.throws(() => reduce(missingBrief), code("order"));

  const mismatchedBrief = new EventChain();
  mismatchedBrief.append("delivery-created", {});
  mismatchedBrief.append(
    "founder-brief-submitted",
    { activityId: "prepare-planned" },
    subject("brief-planned"),
  );
  mismatchedBrief.append("activity-started", { activityId: "prepare-other", operation: "delivery.prepare" });
  assert.throws(() => reduce(mismatchedBrief), code("order"));

  const unchecked = new EventChain();
  unchecked.append("delivery-created", {});
  const brief = subject("brief-unchecked");
  unchecked.append("founder-brief-submitted", { activityId: "prepare-unchecked" }, brief);
  const attempt = subject("attempt-unchecked");
  const providerEffect = effect("provider-unchecked");
  const boundary = subject("boundary-unchecked");
  const workProduct = subject("work-product-unchecked");
  unchecked.append("activity-started", { activityId: "prepare-unchecked", operation: "delivery.prepare" });
  unchecked.append(
    "agent-attempt-prepared",
    { activityId: "prepare-unchecked" },
    attempt,
    attemptFacts(brief),
  );
  unchecked.append(
    "provider-effect-intended",
    { activityId: "prepare-unchecked", effectDigest: providerEffect },
    attempt,
  );
  unchecked.append(
    "provider-effect-observed",
    { activityId: "prepare-unchecked", effectDigest: providerEffect, outcome: "completed" },
    attempt,
  );
  unchecked.append(
    "agent-work-product-submitted",
    { activityId: "prepare-unchecked" },
    workProduct,
  );
  unchecked.append(
    "execution-receipt-recorded",
    { activityId: "prepare-unchecked" },
    subject("receipt-unchecked"),
  );
  unchecked.append(
    "work-boundary-finalized",
    { activityId: "prepare-unchecked" },
    boundary,
    boundaryFacts(brief, workProduct),
  );
  let state = reduce(unchecked);
  assert.equal(state.subjects.proposedBoundary, null);
  assert.equal(state.standing, "framing");
  const conflict = unchecked.fork();
  conflict.append(
    "check-receipt-recorded",
    { activityId: "prepare-unchecked" },
    { recordId: "check-conflict", revision: 1, digest: sha256Bytes("check-conflict-one") },
    checkFacts(
      "baseline",
      "regression-guard",
      "pass",
      relationship("checks-boundary", "work-boundary", boundary),
    ),
  );
  conflict.append(
    "check-receipt-recorded",
    { activityId: "prepare-unchecked" },
    { recordId: "check-conflict", revision: 1, digest: sha256Bytes("check-conflict-two") },
    checkFacts(
      "baseline",
      "regression-guard",
      "pass",
      relationship("checks-boundary", "work-boundary", boundary),
    ),
  );
  assert.throws(() => reduce(conflict), code("corruption"));
  const failedBaseline = unchecked.fork();
  failedBaseline.append(
    "check-receipt-recorded",
    { activityId: "prepare-unchecked" },
    subject("baseline-check-failed"),
    checkFacts(
      "baseline",
      "regression-guard",
      "fail",
      relationship("checks-boundary", "work-boundary", boundary),
    ),
  );
  failedBaseline.append("activity-completed", { activityId: "prepare-unchecked", outcome: "completed" });
  assert.throws(() => reduce(failedBaseline), code("order"));

  const legalRepairTarget = unchecked.fork();
  legalRepairTarget.append(
    "check-receipt-recorded",
    { activityId: "prepare-unchecked" },
    subject("baseline-check-repair-target"),
    checkFacts(
      "baseline",
      "repair-target",
      "fail",
      relationship("checks-boundary", "work-boundary", boundary),
    ),
  );
  legalRepairTarget.append(
    "activity-completed",
    { activityId: "prepare-unchecked", outcome: "completed" },
  );
  assert.equal(reduce(legalRepairTarget).standing, "awaiting-admission");

  const legalPostcondition = unchecked.fork();
  legalPostcondition.append(
    "check-receipt-recorded",
    { activityId: "prepare-unchecked" },
    subject("baseline-check-postcondition"),
    checkFacts(
      "baseline",
      "postcondition",
      "not-run",
      relationship("checks-boundary", "work-boundary", boundary),
    ),
  );
  legalPostcondition.append(
    "activity-completed",
    { activityId: "prepare-unchecked", outcome: "completed" },
  );
  assert.equal(reduce(legalPostcondition).standing, "awaiting-admission");

  unchecked.append("activity-completed", { activityId: "prepare-unchecked", outcome: "completed" });
  assert.throws(() => reduce(unchecked), code("order"));

  const failedAfterBoundary = failedBaseline.fork();
  failedAfterBoundary.events.pop();
  failedAfterBoundary.append(
    "activity-completed",
    { activityId: "prepare-unchecked", outcome: "failed" },
  );
  state = reduce(failedAfterBoundary);
  assert.equal(state.subjects.proposedBoundary, null);
  assert.deepEqual(state.eligibleOperations, ["delivery.no-ship"]);

  const decision = subject("decision-failed-boundary-no-ship");
  failedAfterBoundary.append(
    "activity-started",
    { activityId: "no-ship-failed-boundary", operation: "delivery.no-ship" },
  );
  const sparseDecision = failedAfterBoundary.fork();
  sparseDecision.append(
    "founder-decision-authenticated",
    { activityId: "no-ship-failed-boundary" },
    subject("decision-sparse-failed-boundary"),
    { payload: { decision: "no-ship" } },
  );
  assert.throws(() => reduce(sparseDecision), code("reference"));
  failedAfterBoundary.append(
    "founder-decision-authenticated",
    { activityId: "no-ship-failed-boundary" },
    decision,
    {
      payload: { decision: "no-ship" },
      relationships: [relationship("selects-boundary", "work-boundary", boundary)],
    },
  );
  const transactionEffect = effect("failed-boundary-no-ship");
  failedAfterBoundary.append(
    "transaction-effect-intended",
    { activityId: "no-ship-failed-boundary", effectDigest: transactionEffect },
    decision,
  );
  failedAfterBoundary.append(
    "transaction-effect-observed",
    {
      activityId: "no-ship-failed-boundary",
      effectDigest: transactionEffect,
      outcome: "applied",
    },
    decision,
  );
  const sparseClosure = failedAfterBoundary.fork();
  sparseClosure.append(
    "closure-recorded",
    { activityId: "no-ship-failed-boundary" },
    subject("closure-sparse-failed-boundary"),
    {
      payload: closurePayload("no-ship", "not-created"),
      relationships: [relationship("closes-with", "founder-decision", decision)],
    },
  );
  assert.throws(() => reduce(sparseClosure), code("reference"));
  failedAfterBoundary.append(
    "closure-recorded",
    { activityId: "no-ship-failed-boundary" },
    subject("closure-failed-boundary"),
    {
      payload: closurePayload("no-ship", "not-created"),
      relationships: [
        relationship("closes-with", "founder-decision", decision),
        relationship("governed-by", "work-boundary", boundary),
      ],
    },
  );
  assert.equal(reduce(failedAfterBoundary).standing, "closed");
});

test("baseline recovery requires every and only each required boundary Check selection", () => {
  const chain = new EventChain();
  const activityId = "prepare-multiple-checks";
  const brief = subject("brief-multiple-checks");
  const attempt = subject("attempt-multiple-checks");
  const workProduct = subject("work-product-multiple-checks");
  const boundary = subject("boundary-multiple-checks");
  const providerEffect = effect("provider-multiple-checks");
  const boundaryRelation = relationship("checks-boundary", "work-boundary", boundary);

  chain.append("delivery-created", {});
  chain.append("founder-brief-submitted", { activityId }, brief);
  chain.append("activity-started", { activityId, operation: "delivery.prepare" });
  chain.append("agent-attempt-prepared", { activityId }, attempt, attemptFacts(brief));
  chain.append(
    "provider-effect-intended",
    { activityId, effectDigest: providerEffect },
    attempt,
  );
  chain.append(
    "provider-effect-observed",
    { activityId, effectDigest: providerEffect, outcome: "completed" },
    attempt,
  );
  chain.append("agent-work-product-submitted", { activityId }, workProduct);
  chain.append("execution-receipt-recorded", { activityId }, subject("receipt-multiple-checks"));
  chain.append(
    "work-boundary-finalized",
    { activityId },
    boundary,
    boundaryFacts(brief, workProduct, null, null, [
      { id: "selection.required-one", baselineRequired: true, finalRequired: true },
      { id: "selection.optional", baselineRequired: false, finalRequired: false },
      { id: "selection.required-two", baselineRequired: true, finalRequired: false },
    ]),
  );

  chain.append(
    "check-receipt-recorded",
    { activityId },
    subject("check-required-one"),
    checkFacts("baseline", "regression-guard", "pass", boundaryRelation, "selection.required-one"),
  );
  let state = reduce(chain);
  assert.deepEqual(state.activities.at(-1)?.recovery, {
    kind: "finalization",
    resumesAt: "baseline-checks",
    exactEffectDigest: null,
  });

  const subsetCompletion = chain.fork();
  subsetCompletion.append("activity-completed", { activityId, outcome: "completed" });
  assert.throws(() => reduce(subsetCompletion), code("order"));

  const optional = chain.fork();
  optional.append(
    "check-receipt-recorded",
    { activityId },
    subject("check-optional"),
    checkFacts("baseline", "diagnostic", "pass", boundaryRelation, "selection.optional"),
  );
  assert.throws(() => reduce(optional), code("baseline-selection"));

  const duplicate = chain.fork();
  duplicate.append(
    "check-receipt-recorded",
    { activityId },
    subject("check-required-one-duplicate"),
    checkFacts("baseline", "regression-guard", "pass", boundaryRelation, "selection.required-one"),
  );
  assert.throws(() => reduce(duplicate), code("duplicate"));

  chain.append(
    "check-receipt-recorded",
    { activityId },
    subject("check-required-two"),
    checkFacts("baseline", "regression-guard", "pass", boundaryRelation, "selection.required-two"),
  );
  state = reduce(chain);
  assert.deepEqual(state.activities.at(-1)?.recovery, {
    kind: "finalization",
    resumesAt: "activity-completed",
    exactEffectDigest: null,
  });
  chain.append("activity-completed", { activityId, outcome: "completed" });
  assert.equal(reduce(chain).standing, "awaiting-admission");
});

test("failed fresh preparation can only terminate no-ship", () => {
  const chain = new EventChain();
  chain.append("delivery-created", {});
  const brief = subject("brief-failed");
  chain.append("founder-brief-submitted", { activityId: "prepare-failed" }, brief);
  const attempt = subject("attempt-failed");
  const providerEffect = effect("provider-failed");
  chain.append("activity-started", { activityId: "prepare-failed", operation: "delivery.prepare" });
  chain.append(
    "agent-attempt-prepared",
    { activityId: "prepare-failed" },
    attempt,
    attemptFacts(brief),
  );
  chain.append(
    "provider-effect-intended",
    { activityId: "prepare-failed", effectDigest: providerEffect },
    attempt,
  );
  chain.append(
    "provider-effect-observed",
    { activityId: "prepare-failed", effectDigest: providerEffect, outcome: "failed" },
    attempt,
  );
  chain.append("agent-work-product-abandoned", { activityId: "prepare-failed" }, attempt);
  chain.append(
    "execution-receipt-recorded",
    { activityId: "prepare-failed" },
    subject("receipt-failed"),
  );
  chain.append("activity-completed", { activityId: "prepare-failed", outcome: "failed" });

  let state = reduce(chain);
  assert.equal(state.standing, "framing");
  assert.equal(state.candidateCondition, "absent");
  assert.deepEqual(state.eligibleOperations, ["delivery.no-ship"]);

  const repeated = chain.fork();
  repeated.append(
    "founder-brief-submitted",
    { activityId: "prepare-repeated" },
    subject("brief-repeated"),
  );
  repeated.append(
    "activity-started",
    { activityId: "prepare-repeated", operation: "delivery.prepare" },
  );
  assert.throws(() => reduce(repeated), code("eligibility"));

  const decision = subject("decision-failed-no-ship");
  const transactionEffect = effect("failed-no-ship");
  chain.append("activity-started", { activityId: "no-ship-failed", operation: "delivery.no-ship" });
  chain.append(
    "founder-decision-authenticated",
    { activityId: "no-ship-failed" },
    decision,
    { payload: { decision: "no-ship" } },
  );
  chain.append(
    "transaction-effect-intended",
    { activityId: "no-ship-failed", effectDigest: transactionEffect },
    decision,
  );
  const indeterminate = chain.fork();
  indeterminate.append(
    "transaction-effect-observed",
    { activityId: "no-ship-failed", effectDigest: transactionEffect, outcome: "indeterminate" },
    decision,
  );
  state = reduce(indeterminate);
  assert.deepEqual(state.activities.at(-1)?.recovery, {
    kind: "transaction",
    resumesAt: "transaction-effect-observed",
    exactEffectDigest: transactionEffect,
  });
  indeterminate.append("activity-recovery-recorded", {
    activityId: "no-ship-failed",
    kind: "transaction",
    resumesAt: "transaction-effect-observed",
    exactEffectDigest: transactionEffect,
  });
  indeterminate.append(
    "transaction-effect-observed",
    { activityId: "no-ship-failed", effectDigest: transactionEffect, outcome: "applied" },
    decision,
  );
  state = reduce(indeterminate);
  assert.equal(state.activities.at(-1)?.recovery?.resumesAt, "transaction-finalization");
  chain.append(
    "transaction-effect-observed",
    { activityId: "no-ship-failed", effectDigest: transactionEffect, outcome: "applied" },
    decision,
  );
  const prematureCompletion = chain.fork();
  prematureCompletion.append(
    "activity-completed",
    { activityId: "no-ship-failed", outcome: "completed" },
  );
  assert.throws(() => reduce(prematureCompletion), code("order"));

  const incompleteCleanup = chain.fork();
  incompleteCleanup.append(
    "closure-recorded",
    { activityId: "no-ship-failed" },
    subject("closure-incomplete-cleanup"),
    {
      payload: closurePayload("no-ship", "not-created", "incomplete"),
      relationships: [relationship("closes-with", "founder-decision", decision)],
    },
  );
  assert.throws(() => reduce(incompleteCleanup), code("order"));

  chain.append(
    "closure-recorded",
    { activityId: "no-ship-failed" },
    subject("closure-failed-no-ship"),
    {
      payload: closurePayload("no-ship", "not-created"),
      relationships: [relationship("closes-with", "founder-decision", decision)],
    },
  );

  state = reduce(chain);
  assert.equal(state.standing, "closed");
  assert.equal(state.candidateCondition, "absent");
  assert.deepEqual(state.eligibleOperations, []);
  assert.equal(state.activities.at(-1)?.stage, "completed");
  assert.equal(
    assertDeliveryReplayIntegrity(chain.events, chain.resolveRevision).journal.headDigest,
    state.journal.headDigest,
  );
  assert.equal(
    assertDeliveryReplaySealable(chain.events, chain.resolveRevision).subjects.closure?.digest,
    state.subjects.closure?.digest,
  );
  const incremental = createDeliveryReplay(chain.resolveRevision);
  for (const event of chain.events) incremental.append(event);
  assert.deepEqual(incremental.finish(), state);
  assert.equal(incremental.assertSealable().journal.headDigest, state.journal.headDigest);
  assert.equal(state.journal.headDigest, chain.events.at(-1)?.digest);
  const unsealed = composeDeliveryStoreDisposition(state, "active-unsealed");
  assert.equal(unsealed.candidateCondition, "absent");
  assert.deepEqual(unsealed.eligibleOperations, ["delivery.recover"]);
  const sealed = composeDeliveryStoreDisposition(state, "sealed-unarchived");
  assert.equal(sealed.candidateCondition, "absent");
  assert.deepEqual(sealed.eligibleOperations, ["delivery.recover"]);

  const afterClosure = chain.fork();
  afterClosure.append(
    "activity-completed",
    { activityId: "no-ship-failed", outcome: "completed" },
  );
  assert.throws(() => reduce(afterClosure), code("terminal"));
});

test("deterministic Work Boundary refusal completes preparation without a proposal", () => {
  const chain = new EventChain();
  chain.append("delivery-created", {});
  const brief = subject("brief-boundary-refusal");
  chain.append("founder-brief-submitted", { activityId: "prepare-boundary-refusal" }, brief);
  const attempt = subject("attempt-boundary-refusal");
  const providerEffect = effect("provider-boundary-refusal");
  chain.append(
    "activity-started",
    { activityId: "prepare-boundary-refusal", operation: "delivery.prepare" },
  );
  chain.append(
    "agent-attempt-prepared",
    { activityId: "prepare-boundary-refusal" },
    attempt,
    attemptFacts(brief),
  );
  chain.append(
    "provider-effect-intended",
    { activityId: "prepare-boundary-refusal", effectDigest: providerEffect },
    attempt,
  );
  chain.append(
    "provider-effect-observed",
    {
      activityId: "prepare-boundary-refusal",
      effectDigest: providerEffect,
      outcome: "completed",
    },
    attempt,
  );
  const workProduct = subject("work-product-boundary-refusal");
  chain.append(
    "agent-work-product-submitted",
    { activityId: "prepare-boundary-refusal" },
    workProduct,
  );
  chain.append(
    "execution-receipt-recorded",
    { activityId: "prepare-boundary-refusal" },
    subject("receipt-boundary-refusal"),
  );
  assert.deepEqual(reduce(chain).activities.at(-1)?.recovery, {
    kind: "finalization",
    resumesAt: "work-boundary-finalized",
    exactEffectDigest: null,
  });

  const invalidCompleted = chain.fork();
  invalidCompleted.append(
    "activity-completed",
    { activityId: "prepare-boundary-refusal", outcome: "completed" },
  );
  assert.throws(() => reduce(invalidCompleted), code("order"));

  chain.append(
    "activity-completed",
    { activityId: "prepare-boundary-refusal", outcome: "failed" },
  );
  const state = reduce(chain);
  assert.equal(state.standing, "framing");
  assert.equal(state.subjects.proposedBoundary, null);
  assert.deepEqual(state.eligibleOperations, ["delivery.no-ship"]);
});

test("replay carries one fresh preparation and one Candidate through acceptance", () => {
  const chain = new EventChain();
  chain.append("delivery-created", {});

  const briefOne = subject("brief-one");
  chain.append("founder-brief-submitted", { activityId: "prepare-one" }, briefOne);
  chain.append("activity-started", { activityId: "prepare-one", operation: "delivery.prepare" });
  let state = reduce(chain);
  assert.deepEqual(state.activities.map(({ id }) => id), ["prepare-one"]);
  assert.deepEqual(state.eligibleOperations, ["delivery.recover"]);
  assert.deepEqual(state.activities[0]?.recovery, {
    kind: "finalization",
    resumesAt: "agent-attempt-prepared",
    exactEffectDigest: null,
  });

  const attemptOne = subject("attempt-one");
  const effectOne = effect("provider-one");
  const boundaryOne = subject("boundary-one");
  const workProductOne = subject("work-product-one");
  const baselineCheck = subject("baseline-check-one");
  chain.append(
    "agent-attempt-prepared",
    { activityId: "prepare-one" },
    attemptOne,
    attemptFacts(briefOne),
  );
  chain.append(
    "provider-effect-intended",
    { activityId: "prepare-one", effectDigest: effectOne },
    attemptOne,
  );
  chain.append(
    "provider-effect-observed",
    { activityId: "prepare-one", effectDigest: effectOne, outcome: "completed" },
    attemptOne,
  );
  chain.append("agent-work-product-submitted", { activityId: "prepare-one" }, workProductOne);
  chain.append("execution-receipt-recorded", { activityId: "prepare-one" }, subject("receipt-one"));
  chain.append(
    "work-boundary-finalized",
    { activityId: "prepare-one" },
    boundaryOne,
    boundaryFacts(briefOne, workProductOne),
  );
  state = reduce(chain);
  assert.equal(state.subjects.proposedBoundary, null);
  assert.equal(state.standing, "framing");
  chain.append(
    "check-receipt-recorded",
    { activityId: "prepare-one" },
    baselineCheck,
    checkFacts(
      "baseline",
      "regression-guard",
      "pass",
      relationship("checks-boundary", "work-boundary", boundaryOne),
    ),
  );
  chain.append("activity-completed", { activityId: "prepare-one", outcome: "completed" });

  state = reduce(chain);
  assert.equal(state.standing, "awaiting-admission");
  assert.equal(state.subjects.proposedBoundary?.digest, boundaryOne.digest);
  assert.deepEqual(state.eligibleOperations, ["delivery.admit", "delivery.no-ship"]);

  const admissionDecision = subject("decision-admit");
  const admissionEffect = effect("admission");
  const candidateOne = subject("candidate", 1);
  chain.append("activity-started", { activityId: "admit-one", operation: "delivery.admit" });
  chain.append(
    "founder-decision-authenticated",
    { activityId: "admit-one" },
    admissionDecision,
    {
      payload: { decision: "admit" },
      relationships: [
        relationship("selects-boundary", "work-boundary", boundaryOne),
        relationship("selects-baseline-receipt", "check-receipt", baselineCheck),
      ],
    },
  );
  chain.append(
    "transaction-effect-intended",
    { activityId: "admit-one", effectDigest: admissionEffect },
    admissionDecision,
  );
  chain.append(
    "transaction-effect-observed",
    { activityId: "admit-one", effectDigest: admissionEffect, outcome: "applied" },
    admissionDecision,
  );
  chain.append(
    "candidate-revision-observed",
    { activityId: "admit-one" },
    candidateOne,
    {
      payload: candidateRevisionV2Payload("initialization"),
      relationships: [relationship("governed-by", "work-boundary", boundaryOne)],
    },
  );
  chain.append("activity-completed", { activityId: "admit-one", outcome: "completed" });

  state = reduce(chain);
  assert.equal(state.standing, "active");
  assert.equal(state.candidateCondition, "ready-for-work");
  assert.deepEqual(state.eligibleOperations, ["delivery.continue", "delivery.evaluate", "delivery.no-ship"]);

  const progressBranch = chain.fork();
  const progressBrief = subject("brief-progress-branch");
  const progressAttempt = subject("attempt-progress-branch");
  const progressEffect = effect("progress-branch");
  const progressWorkProduct = subject("work-product-progress-branch");
  const progressCandidate = subject("candidate", 2);
  progressBranch.append("founder-brief-submitted", { activityId: "progress-branch" }, progressBrief);
  progressBranch.append("activity-started", { activityId: "progress-branch", operation: "delivery.continue" });
  progressBranch.append(
    "agent-attempt-prepared",
    { activityId: "progress-branch" },
    progressAttempt,
    attemptFacts(progressBrief, boundaryOne, candidateOne),
  );
  progressBranch.append(
    "provider-effect-intended",
    { activityId: "progress-branch", effectDigest: progressEffect },
    progressAttempt,
  );
  progressBranch.append(
    "provider-effect-observed",
    { activityId: "progress-branch", effectDigest: progressEffect, outcome: "completed" },
    progressAttempt,
  );
  progressBranch.append(
    "agent-work-product-submitted",
    { activityId: "progress-branch" },
    progressWorkProduct,
    { payload: { roleSemantics: { role: "builder", proposal: "progress" } } },
  );
  progressBranch.append(
    "candidate-revision-observed",
    { activityId: "progress-branch" },
    progressCandidate,
    {
      payload: candidateRevisionV2Payload("builder-successor"),
      relationships: [
        relationship("revises", "candidate-revision", candidateOne),
        relationship("governed-by", "work-boundary", boundaryOne),
        relationship("result-of", "agent-attempt", progressAttempt),
      ],
    },
  );
  progressBranch.append(
    "execution-receipt-recorded",
    { activityId: "progress-branch" },
    subject("receipt-progress-branch"),
  );
  progressBranch.append("activity-completed", { activityId: "progress-branch", outcome: "completed" });
  const progressed = reduce(progressBranch);
  assert.equal(progressed.standing, "active");
  assert.equal(progressed.candidateCondition, "ready-for-work");
  assert.equal(progressed.subjects.candidate?.revision, 2);

  const conditionBranch = chain.fork();
  const conditionAttempt = subject("attempt-condition-branch");
  const conditionEffect = effect("condition-branch");
  const conditionCandidate = subject("candidate", 2);
  const continuingCandidatePayload = candidateRevisionV2Payload("builder-successor");
  const continuingCandidateState = continuingCandidatePayload.state as ControlJsonObject;
  const conditionBrief = subject("brief-condition-branch");
  conditionBranch.append(
    "founder-brief-submitted",
    { activityId: "condition-branch" },
    conditionBrief,
  );
  conditionBranch.append(
    "activity-started",
    { activityId: "condition-branch", operation: "delivery.continue" },
  );
  conditionBranch.append(
    "agent-attempt-prepared",
    { activityId: "condition-branch" },
    conditionAttempt,
    attemptFacts(conditionBrief, boundaryOne, candidateOne),
  );
  conditionBranch.append(
    "provider-effect-intended",
    { activityId: "condition-branch", effectDigest: conditionEffect },
    conditionAttempt,
  );
  conditionBranch.append(
    "provider-effect-observed",
    { activityId: "condition-branch", effectDigest: conditionEffect, outcome: "completed" },
    conditionAttempt,
  );
  const conditionWorkProduct = subject("work-product-condition-branch");
  conditionBranch.append(
    "agent-work-product-submitted",
    { activityId: "condition-branch" },
    conditionWorkProduct,
    { payload: { roleSemantics: { role: "builder", proposal: "material-condition" } } },
  );
  conditionBranch.append(
    "candidate-revision-observed",
    { activityId: "condition-branch" },
    conditionCandidate,
    {
      payload: continuingCandidatePayload,
      relationships: [
        relationship("revises", "candidate-revision", candidateOne),
        relationship("governed-by", "work-boundary", boundaryOne),
        relationship("result-of", "agent-attempt", conditionAttempt),
      ],
    },
  );
  const beforeConditionReceipt = conditionBranch.fork();
  const conditionReceipt = subject("receipt-condition-branch");
  const prematureCondition = agentMaterialConditionFixture({
    activityId: "condition-branch",
    conditionId: "condition.before-receipt",
    workProduct: conditionWorkProduct,
    receipt: conditionReceipt,
    candidate: conditionCandidate,
    boundary: boundaryOne,
  });
  beforeConditionReceipt.append(
    "material-condition-frozen",
    prematureCondition.payload,
    subject("condition-before-receipt"),
    prematureCondition.facts,
  );
  assert.throws(() => reduce(beforeConditionReceipt), code("order"));
  conditionBranch.append(
    "execution-receipt-recorded",
    { activityId: "condition-branch" },
    conditionReceipt,
  );
  const missingCondition = conditionBranch.fork();
  missingCondition.append("activity-completed", { activityId: "condition-branch", outcome: "completed" });
  assert.throws(() => reduce(missingCondition), code("order"));
  const condition = subject("condition-after-receipt");
  const retainedCondition = agentMaterialConditionFixture({
    activityId: "condition-branch",
    conditionId: "condition.after-receipt",
    workProduct: conditionWorkProduct,
    receipt: conditionReceipt,
    candidate: conditionCandidate,
    boundary: boundaryOne,
  });
  conditionBranch.append(
    "material-condition-frozen",
    retainedCondition.payload,
    condition,
    retainedCondition.facts,
  );
  conditionBranch.append("activity-completed", { activityId: "condition-branch", outcome: "completed" });
  assert.equal(reduce(conditionBranch).standing, "boundary-paused");

  const resolutionBrief = subject("brief-resolution-branch");
  const resolutionAttempt = subject("attempt-resolution-branch");
  const resolutionEffect = effect("resolution-branch");
  const resolutionWorkProduct = subject("work-product-resolution-branch");
  const successorBoundary = subject("boundary-one", 2);
  const successorBaseline = subject("baseline-check-successor");
  conditionBranch.append(
    "founder-brief-submitted",
    { activityId: "resolution-branch" },
    resolutionBrief,
  );
  conditionBranch.append(
    "activity-started",
    { activityId: "resolution-branch", operation: "delivery.reaffirm" },
  );
  conditionBranch.append(
    "agent-attempt-prepared",
    { activityId: "resolution-branch" },
    resolutionAttempt,
    attemptFacts(resolutionBrief, boundaryOne, conditionCandidate),
  );
  conditionBranch.append(
    "provider-effect-intended",
    { activityId: "resolution-branch", effectDigest: resolutionEffect },
    resolutionAttempt,
  );
  conditionBranch.append(
    "provider-effect-observed",
    { activityId: "resolution-branch", effectDigest: resolutionEffect, outcome: "completed" },
    resolutionAttempt,
  );
  conditionBranch.append(
    "agent-work-product-submitted",
    { activityId: "resolution-branch" },
    resolutionWorkProduct,
  );
  conditionBranch.append(
    "execution-receipt-recorded",
    { activityId: "resolution-branch" },
    subject("receipt-resolution-branch"),
  );
  conditionBranch.append(
    "work-boundary-finalized",
    { activityId: "resolution-branch" },
    successorBoundary,
    boundaryFacts(resolutionBrief, resolutionWorkProduct, boundaryOne, condition),
  );
  conditionBranch.append(
    "check-receipt-recorded",
    { activityId: "resolution-branch" },
    successorBaseline,
    checkFacts(
      "baseline",
      "regression-guard",
      "pass",
      relationship("checks-boundary", "work-boundary", successorBoundary),
    ),
  );
  conditionBranch.append(
    "activity-completed",
    { activityId: "resolution-branch", outcome: "completed" },
  );
  assert.equal(reduce(conditionBranch).standing, "awaiting-readmission");

  const validReadmitBranch = conditionBranch.fork();
  const validReadmitDecision = subject("decision-readmit");
  const validReadmitEffect = effect("readmit");
  const reboundCandidate = subject("candidate", 3);
  validReadmitBranch.append(
    "activity-started",
    { activityId: "readmit", operation: "delivery.admit" },
  );
  validReadmitBranch.append(
    "founder-decision-authenticated",
    { activityId: "readmit" },
    validReadmitDecision,
    {
      payload: { decision: "readmit" },
      relationships: [
        relationship("selects-boundary", "work-boundary", successorBoundary),
        relationship("selects-baseline-receipt", "check-receipt", successorBaseline),
        relationship("continues-from-boundary", "work-boundary", boundaryOne),
        relationship("resolves", "material-condition", condition),
        relationship("selects-candidate", "candidate-revision", conditionCandidate),
      ],
    },
  );
  validReadmitBranch.append(
    "transaction-effect-intended",
    { activityId: "readmit", effectDigest: validReadmitEffect },
    validReadmitDecision,
  );
  validReadmitBranch.append(
    "transaction-effect-observed",
    {
      activityId: "readmit",
      effectDigest: validReadmitEffect,
      outcome: "applied",
      facts: Object.freeze({
        schema: "lifecycle.admission-effect-observation-facts.v2",
        outcome: "applied",
        disposition: null,
        repositoryBasisDigest: sha256Bytes("readmit-repository-basis"),
      }),
    },
    validReadmitDecision,
  );
  assert.deepEqual(reduce(validReadmitBranch).activities.at(-1)?.recovery, {
    kind: "candidate-observation",
    resumesAt: "candidate-revision-observed",
    exactEffectDigest: null,
  });
  const prematureReadmitCompletion = validReadmitBranch.fork();
  prematureReadmitCompletion.append(
    "activity-completed",
    { activityId: "readmit", outcome: "completed" },
  );
  assert.throws(() => reduce(prematureReadmitCompletion), code("order"));
  const mutatedReadmitRebind = validReadmitBranch.fork();
  mutatedReadmitRebind.append(
    "candidate-revision-observed",
    { activityId: "readmit" },
    reboundCandidate,
    {
      payload: Object.freeze({
        ...continuingCandidatePayload,
        observation: "readmission-rebind",
        state: Object.freeze({
          ...continuingCandidateState,
          candidateDigest: sha256Bytes("mutated-readmission-candidate"),
        }),
      }),
      relationships: [
        relationship("revises", "candidate-revision", conditionCandidate),
        relationship("governed-by", "work-boundary", successorBoundary),
      ],
    },
  );
  assert.throws(() => reduce(mutatedReadmitRebind), code("record-payload"));
  const staleBoundaryReadmitRebind = validReadmitBranch.fork();
  staleBoundaryReadmitRebind.append(
    "candidate-revision-observed",
    { activityId: "readmit" },
    reboundCandidate,
    {
      payload: Object.freeze({
        ...continuingCandidatePayload,
        observation: "readmission-rebind",
      }),
      relationships: [
        relationship("revises", "candidate-revision", conditionCandidate),
        relationship("governed-by", "work-boundary", boundaryOne),
      ],
    },
  );
  assert.throws(() => reduce(staleBoundaryReadmitRebind), code("reference"));
  validReadmitBranch.append(
    "candidate-revision-observed",
    { activityId: "readmit" },
    reboundCandidate,
    {
      payload: Object.freeze({
        ...continuingCandidatePayload,
        observation: "readmission-rebind",
      }),
      relationships: [
        relationship("revises", "candidate-revision", conditionCandidate),
        relationship("governed-by", "work-boundary", successorBoundary),
      ],
    },
  );
  validReadmitBranch.append(
    "activity-completed",
    { activityId: "readmit", outcome: "completed" },
  );
  const readmittedState = reduce(validReadmitBranch);
  assert.equal(readmittedState.standing, "active");
  assert.deepEqual(readmittedState.subjects.activeBoundary, {
    id: successorBoundary.recordId,
    revision: successorBoundary.revision,
    digest: successorBoundary.digest,
  });
  assert.deepEqual(readmittedState.subjects.candidate, {
    id: reboundCandidate.recordId,
    revision: reboundCandidate.revision,
    digest: reboundCandidate.digest,
  });
  assert.equal(readmittedState.subjects.materialCondition, null);

  const readmitDecision = subject("decision-readmit-without-custody");
  const readmitEffect = effect("readmit-without-custody");
  conditionBranch.append(
    "activity-started",
    { activityId: "readmit-without-custody", operation: "delivery.admit" },
  );
  conditionBranch.append(
    "founder-decision-authenticated",
    { activityId: "readmit-without-custody" },
    readmitDecision,
    {
      payload: { decision: "readmit" },
      relationships: [
        relationship("selects-boundary", "work-boundary", successorBoundary),
        relationship("selects-baseline-receipt", "check-receipt", successorBaseline),
        relationship("continues-from-boundary", "work-boundary", boundaryOne),
        relationship("resolves", "material-condition", condition),
        relationship("selects-candidate", "candidate-revision", conditionCandidate),
      ],
    },
  );
  conditionBranch.append(
    "transaction-effect-intended",
    { activityId: "readmit-without-custody", effectDigest: readmitEffect },
    readmitDecision,
  );
  conditionBranch.append(
    "transaction-effect-observed",
    {
      activityId: "readmit-without-custody",
      effectDigest: readmitEffect,
      outcome: "applied",
      facts: Object.freeze({
        schema: "lifecycle.admission-effect-observation-facts.v2",
        outcome: "applied",
        disposition: null,
        repositoryBasisDigest: sha256Bytes("readmit-repository-basis"),
      }),
    },
    readmitDecision,
  );
  assert.deepEqual(reduce(conditionBranch).activities.at(-1)?.recovery, {
    kind: "candidate-observation",
    resumesAt: "candidate-revision-observed",
    exactEffectDigest: null,
  });

  const builderAttempt = subject("attempt-builder");
  const builderEffect = effect("builder");
  const builderBrief = subject("brief-builder");
  chain.append("founder-brief-submitted", { activityId: "work-one" }, builderBrief);
  chain.append("activity-started", { activityId: "work-one", operation: "delivery.continue" });
  state = reduce(chain);
  assert.equal(state.candidateCondition, "in-progress");
  assert.deepEqual(state.eligibleOperations, ["delivery.recover"]);
  chain.append(
    "agent-attempt-prepared",
    { activityId: "work-one" },
    builderAttempt,
    attemptFacts(builderBrief, boundaryOne, candidateOne),
  );
  state = reduce(chain);
  assert.equal(state.candidateCondition, "in-progress");
  assert.deepEqual(state.eligibleOperations, ["delivery.recover"]);
  chain.append(
    "provider-effect-intended",
    { activityId: "work-one", effectDigest: builderEffect },
    builderAttempt,
  );
  state = reduce(chain);
  assert.equal(state.candidateCondition, "terminal-recovery");
  assert.deepEqual(state.eligibleOperations, ["delivery.recover"]);
  chain.append("activity-recovery-recorded", {
    activityId: "work-one",
    kind: "provider",
    resumesAt: "provider-effect-observed",
    exactEffectDigest: builderEffect,
  });
  chain.append(
    "provider-effect-observed",
    { activityId: "work-one", effectDigest: builderEffect, outcome: "failed" },
    builderAttempt,
  );
  chain.append("agent-work-product-abandoned", { activityId: "work-one" }, builderAttempt);
  const prematureReceipt = chain.fork();
  prematureReceipt.append(
    "execution-receipt-recorded",
    { activityId: "work-one" },
    subject("receipt-before-candidate"),
  );
  prematureReceipt.append(
    "activity-completed",
    { activityId: "work-one", outcome: "failed" },
  );
  const noSuccessor = reduce(prematureReceipt);
  assert.equal(noSuccessor.subjects.candidate?.digest, candidateOne.digest);
  assert.equal(noSuccessor.candidateCondition, "ready-for-work");

  const lateCandidate = prematureReceipt.fork();
  lateCandidate.events.pop();
  lateCandidate.append(
    "candidate-revision-observed",
    { activityId: "work-one" },
    subject("candidate", 2),
    {
      payload: candidateRevisionV2Payload("builder-successor"),
      relationships: [
        relationship("revises", "candidate-revision", candidateOne),
        relationship("governed-by", "work-boundary", boundaryOne),
        relationship("result-of", "agent-attempt", builderAttempt),
      ],
    },
  );
  assert.throws(() => reduce(lateCandidate), code("order"));
  const candidateTwo = subject("candidate", 2);
  chain.append(
    "candidate-revision-observed",
    { activityId: "work-one" },
    candidateTwo,
    {
      payload: candidateRevisionV2Payload("builder-successor"),
      relationships: [
        relationship("revises", "candidate-revision", candidateOne),
        relationship("governed-by", "work-boundary", boundaryOne),
        relationship("result-of", "agent-attempt", builderAttempt),
      ],
    },
  );
  chain.append("execution-receipt-recorded", { activityId: "work-one" }, subject("receipt-builder"));
  chain.append("activity-completed", { activityId: "work-one", outcome: "failed" });

  const seal = subject("seal-one");
  const finalCheck = subject("check-one");
  const reviewerAttempt = subject("attempt-reviewer");
  const reviewerEffect = effect("reviewer");
  const reviewWorkProduct = subject("work-product-review");
  const reviewReceipt = subject("receipt-review");
  const reviewerBrief = subject("brief-reviewer");
  chain.append("founder-brief-submitted", { activityId: "evaluate-one" }, reviewerBrief);
  chain.append("activity-started", { activityId: "evaluate-one", operation: "delivery.evaluate" });
  assert.deepEqual(reduce(chain).activities.at(-1)?.recovery, {
    kind: "finalization",
    resumesAt: "candidate-sealed",
    exactEffectDigest: null,
  });
  chain.append(
    "candidate-sealed",
    { activityId: "evaluate-one" },
    seal,
    {
      relationships: [
        relationship("seals", "candidate-revision", candidateTwo),
        relationship("governed-by", "work-boundary", boundaryOne),
      ],
    },
  );
  state = reduce(chain);
  assert.equal(state.activities.at(-1)?.stage, "finalizing");
  assert.deepEqual(state.activities.at(-1)?.recovery, {
    kind: "finalization",
    resumesAt: "evaluation-checks",
    exactEffectDigest: null,
  });
  const reviewerBeforeChecks = chain.fork();
  reviewerBeforeChecks.append(
    "agent-attempt-prepared",
    { activityId: "evaluate-one" },
    reviewerAttempt,
    attemptFacts(reviewerBrief, boundaryOne, candidateTwo, seal),
  );
  assert.throws(() => reduce(reviewerBeforeChecks), code("order"));
  chain.append(
    "check-receipt-recorded",
    { activityId: "evaluate-one" },
    finalCheck,
    checkFacts(
      "final",
      "regression-guard",
      "pass",
      relationship("checks-seal", "candidate-seal", seal),
    ),
  );
  chain.append(
    "agent-attempt-prepared",
    { activityId: "evaluate-one" },
    reviewerAttempt,
    attemptFacts(reviewerBrief, boundaryOne, candidateTwo, seal),
  );
  chain.append(
    "provider-effect-intended",
    { activityId: "evaluate-one", effectDigest: reviewerEffect },
    reviewerAttempt,
  );
  chain.append(
    "provider-effect-observed",
    { activityId: "evaluate-one", effectDigest: reviewerEffect, outcome: "completed" },
    reviewerAttempt,
  );
  chain.append("agent-work-product-submitted", { activityId: "evaluate-one" }, reviewWorkProduct);
  chain.append("execution-receipt-recorded", { activityId: "evaluate-one" }, reviewReceipt);

  const materialEvaluation = chain.fork();
  const reviewCondition = subject("condition-review");
  const reviewConditionFixture = agentMaterialConditionFixture({
    activityId: "evaluate-one",
    conditionId: "condition.review",
    workProduct: reviewWorkProduct,
    receipt: reviewReceipt,
    candidate: candidateTwo,
    boundary: boundaryOne,
  });
  materialEvaluation.append(
    "material-condition-frozen",
    reviewConditionFixture.payload,
    reviewCondition,
    reviewConditionFixture.facts,
  );
  assert.deepEqual(reduce(materialEvaluation).activities.at(-1)?.recovery, {
    kind: "finalization",
    resumesAt: "activity-finalization",
    exactEffectDigest: null,
  });
  materialEvaluation.append(
    "evidence-packet-finalized",
    { activityId: "evaluate-one" },
    subject("evidence-revision-required"),
    {
      payload: { readiness: "revision-required" },
      relationships: [
        relationship("governed-by", "work-boundary", boundaryOne),
        relationship("evaluates", "candidate-revision", candidateTwo),
        relationship("uses-seal", "candidate-seal", seal),
        relationship("uses-check", "check-receipt", baselineCheck),
        relationship("uses-check", "check-receipt", finalCheck),
        relationship("uses-review", "agent-work-product", reviewWorkProduct),
        relationship("uses-review-receipt", "execution-receipt", reviewReceipt),
      ],
    },
  );
  materialEvaluation.append(
    "activity-completed",
    { activityId: "evaluate-one", outcome: "completed" },
  );
  const materialState = reduce(materialEvaluation);
  assert.equal(materialState.standing, "boundary-paused");
  assert.equal(materialState.candidateCondition, "paused-for-boundary");
  assert.deepEqual(materialState.eligibleOperations, [
    "delivery.revise",
    "delivery.reaffirm",
    "delivery.no-ship",
  ]);

  const failingFinal = chain.fork();
  const failedFinalCheck = subject("check-final-repair-target-failed");
  failingFinal.append(
    "check-receipt-recorded",
    { activityId: "evaluate-one" },
    failedFinalCheck,
    checkFacts(
      "final",
      "repair-target",
      "fail",
      relationship("checks-seal", "candidate-seal", seal),
    ),
  );
  failingFinal.append(
    "evidence-packet-finalized",
    { activityId: "evaluate-one" },
    subject("evidence-illegal-ready"),
    {
      payload: { readiness: "acceptance-ready" },
      relationships: [
        relationship("governed-by", "work-boundary", boundaryOne),
        relationship("evaluates", "candidate-revision", candidateTwo),
        relationship("uses-seal", "candidate-seal", seal),
        relationship("uses-check", "check-receipt", baselineCheck),
        relationship("uses-check", "check-receipt", finalCheck),
        relationship("uses-check", "check-receipt", failedFinalCheck),
        relationship("uses-review", "agent-work-product", reviewWorkProduct),
        relationship("uses-review-receipt", "execution-receipt", reviewReceipt),
      ],
    },
  );
  assert.throws(() => reduce(failingFinal), code("order"));

  const evidence = subject("evidence-one");
  chain.append(
    "evidence-packet-finalized",
    { activityId: "evaluate-one" },
    evidence,
    {
      payload: { readiness: "acceptance-ready" },
      relationships: [
        relationship("governed-by", "work-boundary", boundaryOne),
        relationship("evaluates", "candidate-revision", candidateTwo),
        relationship("uses-seal", "candidate-seal", seal),
        relationship("uses-check", "check-receipt", baselineCheck),
        relationship("uses-check", "check-receipt", finalCheck),
        relationship("uses-review", "agent-work-product", reviewWorkProduct),
        relationship("uses-review-receipt", "execution-receipt", reviewReceipt),
      ],
    },
  );
  chain.append("activity-completed", { activityId: "evaluate-one", outcome: "completed" });

  state = reduce(chain);
  assert.equal(state.standing, "decision-ready");
  assert.equal(state.candidateCondition, "ready-for-decision");
  assert.deepEqual(state.eligibleOperations, ["delivery.accept", "delivery.no-ship"]);

  const acceptDecision = subject("decision-accept");
  const acceptEffect = effect("accept");
  chain.append("activity-started", { activityId: "accept-one", operation: "delivery.accept" });
  chain.append(
    "founder-decision-authenticated",
    { activityId: "accept-one" },
    acceptDecision,
    {
      payload: { decision: "accept" },
      relationships: [
        relationship("selects-boundary", "work-boundary", boundaryOne),
        relationship("selects-candidate", "candidate-revision", candidateTwo),
        relationship("selects-seal", "candidate-seal", seal),
        relationship("selects-evidence", "evidence-packet", evidence),
      ],
    },
  );
  chain.append(
    "transaction-effect-intended",
    { activityId: "accept-one", effectDigest: acceptEffect },
    acceptDecision,
  );
  chain.append(
    "transaction-effect-observed",
    { activityId: "accept-one", effectDigest: acceptEffect, outcome: "applied" },
    acceptDecision,
  );
  chain.append(
    "closure-recorded",
    { activityId: "accept-one" },
    subject("closure-one"),
    {
      payload: closurePayload("accepted", "integrated"),
      relationships: [
        relationship("closes-with", "founder-decision", acceptDecision),
        relationship("governed-by", "work-boundary", boundaryOne),
        relationship("accepts-candidate", "candidate-revision", candidateTwo),
        relationship("accepts-evidence", "evidence-packet", evidence),
      ],
    },
  );

  state = reduce(chain);
  assert.equal(state.standing, "closed");
  assert.equal(state.candidateCondition, "accepted");
  assert.deepEqual(state.eligibleOperations, []);
  assert.equal(state.journal.eventCount, chain.events.length);
  assert.equal(state.journal.headDigest, chain.events.at(-1)?.digest);
  assert.equal(state.activities.at(-1)?.stage, "completed");
  const unsealed = composeDeliveryStoreDisposition(state, "active-unsealed");
  assert.equal(unsealed.candidateCondition, "accepted");
  assert.deepEqual(unsealed.eligibleOperations, ["delivery.recover"]);
  assert.equal(unsealed.standing, state.standing);
  assert.deepEqual(unsealed.activities, state.activities);
  assert.deepEqual(unsealed.subjects, state.subjects);
  assert.deepEqual(unsealed.journal, state.journal);
  const sealed = composeDeliveryStoreDisposition(state, "sealed-unarchived");
  assert.equal(sealed.candidateCondition, "accepted");
  assert.deepEqual(sealed.eligibleOperations, ["delivery.recover"]);
  assert.equal(sealed.standing, state.standing);
  assert.deepEqual(sealed.activities, state.activities);
  assert.deepEqual(sealed.subjects, state.subjects);
  assert.deepEqual(sealed.journal, state.journal);
  const archived = composeDeliveryStoreDisposition(state, "archived-verified");
  assert.equal(archived.candidateCondition, "accepted");
  assert.deepEqual(archived.eligibleOperations, []);

  const copiedRecordFacts: readonly Readonly<{
    eventKind: string;
    payload: ControlJsonObject;
  }>[] = [
    {
      eventKind: "candidate-revision-observed",
      payload: { activityId: "admit-one", boundaryDigest: boundaryOne.digest },
    },
    {
      eventKind: "candidate-sealed",
      payload: {
        activityId: "evaluate-one",
        candidateDigest: candidateOne.digest,
        boundaryDigest: boundaryOne.digest,
      },
    },
    {
      eventKind: "check-receipt-recorded",
      payload: {
        activityId: "prepare-one",
        checkSubjectDigest: boundaryOne.digest,
        outcome: "failed",
      },
    },
    {
      eventKind: "evidence-packet-finalized",
      payload: {
        activityId: "evaluate-one",
        readiness: "correctable",
        sealDigest: boundaryOne.digest,
      },
    },
    {
      eventKind: "founder-decision-authenticated",
      payload: { activityId: "admit-one", selectedDigest: boundaryOne.digest },
    },
    {
      eventKind: "closure-recorded",
      payload: { activityId: "accept-one", disposition: "no-ship" },
    },
  ];
  for (const copied of copiedRecordFacts) {
    assert.throws(
      () => reduce(copyRecordFactIntoEvent(chain, copied.eventKind, copied.payload)),
      eventCode("payload"),
    );
  }
});

test("replay fails closed on invalid order, concurrency, chain, and exact references", () => {
  const open = new EventChain();
  open.append("delivery-created", {});
  assert.throws(
    () => assertDeliveryReplaySealable(open.events, open.resolveRevision),
    code("seal"),
  );
  assert.throws(
    () => composeDeliveryStoreDisposition(reduce(open), "sealed-unarchived"),
    code("store-disposition"),
  );

  const eventValidIllegalClosure = open.fork();
  eventValidIllegalClosure.append(
    "closure-recorded",
    { activityId: "missing-terminal-activity" },
    subject("closure-without-transaction"),
    { payload: closurePayload("no-ship", "not-created") },
  );
  assert.throws(
    () => assertDeliveryReplayIntegrity(
      eventValidIllegalClosure.events,
      eventValidIllegalClosure.resolveRevision,
    ),
    code("activity"),
  );

  const order = new EventChain();
  order.append("delivery-created", {});
  const orderBrief = subject("brief-order");
  order.append("founder-brief-submitted", { activityId: "prepare-order" }, orderBrief);
  order.append("activity-started", { activityId: "prepare-order", operation: "delivery.prepare" });
  const attempt = subject("attempt-order");
  order.append(
    "agent-attempt-prepared",
    { activityId: "prepare-order" },
    attempt,
    attemptFacts(orderBrief),
  );
  assert.throws(
    () => {
      const invalid = order.fork();
      invalid.append(
        "provider-effect-observed",
        { activityId: "prepare-order", effectDigest: effect("missing-intent"), outcome: "completed" },
        attempt,
      );
      reduce(invalid);
    },
    code("reference"),
  );

  const exclusive = new EventChain();
  exclusive.append("delivery-created", {});
  const { boundary, baselineReceipt } = prepare(exclusive, "prepare-only", "only");
  const decision = subject("decision-exclusive");
  const admissionEffect = effect("exclusive-admit");
  exclusive.append("activity-started", { activityId: "admit-exclusive", operation: "delivery.admit" });
  exclusive.append(
    "founder-decision-authenticated",
    { activityId: "admit-exclusive" },
    decision,
    {
      payload: { decision: "admit" },
      relationships: [
        relationship("selects-boundary", "work-boundary", boundary),
        relationship("selects-baseline-receipt", "check-receipt", baselineReceipt),
      ],
    },
  );
  exclusive.append(
    "transaction-effect-intended",
    { activityId: "admit-exclusive", effectDigest: admissionEffect },
    decision,
  );
  exclusive.append(
    "transaction-effect-observed",
    { activityId: "admit-exclusive", effectDigest: admissionEffect, outcome: "applied" },
    decision,
  );
  exclusive.append(
    "candidate-revision-observed",
    { activityId: "admit-exclusive" },
    subject("candidate-exclusive"),
    {
      payload: candidateRevisionV2Payload("initialization"),
      relationships: [relationship("governed-by", "work-boundary", boundary)],
    },
  );
  exclusive.append("activity-completed", { activityId: "admit-exclusive", outcome: "completed" });
  const workABrief = subject("brief-work-a");
  const workBBrief = subject("brief-work-b");
  exclusive.append("founder-brief-submitted", { activityId: "work-a" }, workABrief);
  exclusive.append("founder-brief-submitted", { activityId: "work-b" }, workBBrief);
  exclusive.append("activity-started", { activityId: "work-a", operation: "delivery.continue" });
  exclusive.append("activity-started", { activityId: "work-b", operation: "delivery.continue" });
  assert.throws(() => reduce(exclusive), code("eligibility"));

  const fork = new EventChain();
  fork.append("delivery-created", {});
  fork.append("founder-brief-submitted", { activityId: "prepare-fork" }, subject("brief-fork"));
  fork.append("activity-started", { activityId: "prepare-fork", operation: "delivery.prepare" });
  const second = fork.events[1]!;
  fork.events[1] = compileControlRecordEvent({
    storeId: second.storeId,
    processId: second.processId,
    sequence: second.sequence,
    predecessorDigest: effect("wrong-predecessor"),
    event: {
      eventId: second.eventId,
      eventKind: second.eventKind,
      occurredAt: second.occurredAt,
      actor: second.actor,
      subject: second.subject,
      payload: second.payload,
    },
  });
  assert.throws(() => reduce(fork), code("sequence"));
});
