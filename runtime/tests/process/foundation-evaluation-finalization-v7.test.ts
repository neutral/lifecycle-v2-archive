import { evidenceFixtureV7, EVIDENCE_OBSERVATION_V7 } from "../helpers/evidence-fixture-v7.js";
import { retainEvidencePacket } from "../../src/foundation/control/evidence-packet.js";
import { retainMaterialCondition } from "../../src/foundation/control/material-condition.js";
import assert from "node:assert/strict";
import test from "node:test";
import { compileControlRecordEvent, compileControlRecordRevision } from "../../src/foundation/control/model.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlJsonObject,
  type ControlRecordEvent,
  type ControlRecordRelationship,
  type ControlRecordRevision,
} from "../../src/foundation/control/types.js";
import type {
  FoundationAgentRoleControlContextV7,
  FoundationAgentRoleCheckpointAdapterV7,
} from "../../src/foundation/process/agent-operation-v7.js";
import { FoundationError } from "../../src/foundation/error.js";
import {
  finalizeDeliveryEvaluationV7,
} from "../../src/foundation/process/evaluation-finalization-v7.js";
import { sha256Bytes, type Sha256 } from "../../src/foundation/validation/canonical.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

const PROCESS = "delivery-evaluation-finalization-v7";
const STORE = "store-evaluation-finalization-v7";
const ACTIVITY = "activity-evaluation-finalization-v7";
const CREATED = "2026-08-29T20:00:00.000Z";

function relationship(relation: string, target: ControlRecordRevision): ControlRecordRelationship {
  return Object.freeze({
    relation,
    target: Object.freeze({
      kind: target.recordKind,
      id: target.recordId,
      revision: target.revision,
      digest: target.digest,
    }),
  });
}

function revision(input: Readonly<{
  id: string;
  kind: string;
  payload: ControlJsonObject;
  relationships?: readonly ControlRecordRelationship[];
  authority?: "runtime-derived" | "runtime-observed" | "agent-proposed";
}>): ControlRecordRevision {
  const authority = input.authority ?? "runtime-derived";
  return compileControlRecordRevision(PROCESS, {
    recordId: input.id,
    recordKind: input.kind,
    revision: 1,
    producer: Object.freeze({ kind: "runtime", id: "runtime-v7" }),
    semanticAuthor: authority === "agent-proposed"
      ? Object.freeze({ kind: "agent", id: "reviewer-agent" })
      : Object.freeze({ kind: "runtime", id: "runtime-v7" }),
    semanticAuthority: authority,
    createdAt: CREATED,
    semanticMarkdown: `# ${input.kind}\n`,
    payload: input.payload,
    relationships: input.relationships ?? Object.freeze([]),
  });
}

function harness(input: Readonly<{
  withWorkProduct: boolean;
  withCondition?: boolean;
  withReceiptCandidateSuccessor?: boolean;
  substituteReceiptCandidate?: boolean;
  substituteReceiptCarrier?: boolean;
}>) {
  const boundary = revision({
    id: "work-boundary-evaluation-finalization",
    kind: "work-boundary",
    payload: validDeliveryControlPayload("work-boundary"),
  });
  const candidate = revision({
    id: "candidate-revision-evaluation-finalization",
    kind: "candidate-revision",
    payload: validDeliveryControlPayload("candidate-revision"),
    relationships: Object.freeze([relationship("governed-by", boundary)]),
  });
  const seal = revision({
    id: "candidate-seal-evaluation-finalization",
    kind: "candidate-seal",
    payload: validDeliveryControlPayload("candidate-seal"),
    relationships: Object.freeze([
      relationship("seals", candidate),
      relationship("governed-by", boundary),
    ]),
  });
  const brief = revision({
    id: "director-brief-evaluation-finalization",
    kind: "director-brief",
    payload: Object.freeze({ schema: "lifecycle.director-brief-payload.v2", scope: { kind: "activity", activityId: ACTIVITY } }),
  });
  const attempt = revision({
    id: "agent-attempt-evaluation-finalization",
    kind: "agent-attempt",
    payload: Object.freeze({
      ...validDeliveryControlPayload("agent-attempt"),
      activityId: ACTIVITY,
      operation: "delivery.evaluate",
      role: "reviewer",
      invocationId: "invocation-evaluation-finalization-v7",
    }),
    relationships: Object.freeze([
      relationship("uses-brief", brief),
      relationship("uses-boundary", boundary),
      relationship("uses-candidate", candidate),
      relationship("uses-seal", seal),
    ]),
  });
  const workProduct = input.withWorkProduct
    ? revision({
        id: "agent-work-product-evaluation-finalization",
        kind: "agent-work-product",
        authority: "agent-proposed",
        payload: Object.freeze({
          schema: "lifecycle.agent-work-product-payload.v5",
          role: "reviewer",
          roleSemantics: Object.freeze({
            role: "reviewer",
            conditions: input.withCondition
              ? Object.freeze([Object.freeze({ id: "condition.material" })])
              : Object.freeze([]),
          }),
        }),
        relationships: Object.freeze([relationship("result-of", attempt)]),
      })
    : null;
  const receipt = revision({
    id: "execution-receipt-evaluation-finalization",
    kind: "execution-receipt",
    authority: "runtime-observed",
    payload: Object.freeze({
      ...validDeliveryControlPayload("execution-receipt"),
      activityId: ACTIVITY,
      role: "reviewer",
      candidate: Object.freeze({
        input: Object.freeze({
          revision: Object.freeze({
            kind: "candidate-revision",
            ...reference(candidate),
            ...(input.substituteReceiptCandidate
              ? { digest: sha256Bytes("substituted-reviewer-input-candidate") }
              : {}),
          }),
          carrierManifestDigest: input.substituteReceiptCarrier
            ? sha256Bytes("substituted-reviewer-input-carrier")
            : (candidate.payload.carrierManifest as ControlJsonObject).digest!,
        }),
        successorDisposition: null,
        successor: null,
        contentDisposition: null,
      }),
    }),
    relationships: Object.freeze([
      relationship("observes-attempt", attempt),
      ...(input.withReceiptCandidateSuccessor
        ? [relationship("observes-candidate", candidate)]
        : []),
      ...(workProduct === null ? [] : [relationship("observes-work-product", workProduct)]),
    ]),
  });
  const evidence = revision({
    id: "evidence-packet-evaluation-finalization",
    kind: "evidence-packet",
    payload: Object.freeze({
      schema: "lifecycle.evidence-packet-payload.v2",
      readiness: "acceptance-ready",
    }),
    relationships: Object.freeze([
      relationship("governed-by", boundary),
      relationship("evaluates", candidate),
      relationship("uses-seal", seal),
      ...(workProduct === null ? [] : [relationship("uses-review", workProduct)]),
      relationship("uses-review-receipt", receipt),
    ]),
  });
  const condition = workProduct === null
    ? null
    : revision({
        id: "material-condition-evaluation-finalization",
        kind: "material-condition",
        payload: Object.freeze({
          schema: "lifecycle.material-condition-payload.v4",
          source: Object.freeze({
            kind: "agent-proposal",
            conditionId: "condition.material",
            fragmentDigest: sha256Bytes("condition.material"),
          }),
          observedFactsDigest: sha256Bytes("evaluation-material-condition-facts"),
        }),
        relationships: Object.freeze([
          relationship("reported-by", workProduct),
          relationship("observed-in", receipt),
          relationship("freezes", candidate),
          relationship("governed-by", boundary),
        ]),
      });
  const retained = new Map<string, ControlRecordRevision>();
  for (const value of [boundary, candidate, seal, brief, attempt, workProduct, receipt]) {
    if (value !== null) retained.set(`${value.recordId}\0${value.revision}`, value);
  }
  const journal: ControlRecordEvent[] = [];
  let currentEvidence: ControlRecordRevision | null = null;
  let currentCondition: ControlRecordRevision | null = null;
  let predecessorDigest: Sha256 | null = null;
  const appendEvent = (eventKind: string, subject: ControlRecordRevision): ControlRecordEvent => {
    retained.set(`${subject.recordId}\0${subject.revision}`, subject);
    const event = compileControlRecordEvent({
      storeId: STORE,
      processId: PROCESS,
      sequence: journal.length + 1,
      predecessorDigest,
      event: {
        eventId: `event-${eventKind}-${journal.length + 1}`,
        eventKind,
        occurredAt: CREATED,
        actor: Object.freeze({ kind: "runtime", id: "runtime-v7" }),
        subject: Object.freeze({
          recordId: subject.recordId,
          revision: subject.revision,
          digest: subject.digest,
        }),
        payload: eventKind === "material-condition-frozen"
          ? Object.freeze({
              sourceKind: "agent-proposal",
              activityId: ACTIVITY,
              observedFactsDigest: subject.payload.observedFactsDigest!,
            })
          : Object.freeze({ activityId: ACTIVITY }),
      },
    });
    predecessorDigest = event.digest;
    journal.push(event);
    return event;
  };
  const store = {
    identity: Object.freeze({
      schema: CONTROL_RECORD_STORE_SCHEMA,
      storeId: STORE,
      targetId: "target-evaluation-finalization-v7",
      processKind: "delivery",
      processId: PROCESS,
      createdAt: CREATED,
    }),
    getRevision(recordId: string, selectedRevision: number) {
      return retained.get(`${recordId}\0${selectedRevision}`) ?? null;
    },
    listEvents(after = 0, limit = 1_000) {
      return Object.freeze(journal.filter(({ sequence }) => sequence > after).slice(0, limit));
    },
    state() {
      return Object.freeze({
        standing: "active" as const,
        candidateCondition: currentEvidence === null ? "under-evaluation" as const : "decision-ready" as const,
        activities: Object.freeze([]),
        subjects: Object.freeze({
          integrationAssessment: null,
          proposedBoundary: null,
          activeBoundary: Object.freeze(reference(boundary)),
          candidate: Object.freeze(reference(candidate)),
          materialCondition: currentCondition === null ? null : Object.freeze(reference(currentCondition)),
          seal: Object.freeze(reference(seal)),
          evidence: currentEvidence === null ? null : Object.freeze(reference(currentEvidence)),
          closure: null,
        }),
        delegation: { admission: null, current: null, charged: { operations: 0, agentAttempts: 0, reservedCellWallTimeMs: 0 } },
        journal: Object.freeze({ eventCount: journal.length, headDigest: predecessorDigest }),
        eligibleOperations: Object.freeze([]),
      });
    },
  } as unknown as ControlRecordStore;

  let generation = 1;
  let checkpoint: ControlJsonObject | null = null;
  let failClearOnce = false;
  const coordinate = () => Object.freeze({
    generation,
    payloadDigest: sha256Bytes(`support-${generation}`),
  });
  type Step = Parameters<FoundationAgentRoleCheckpointAdapterV7["step"]>[0];
  const current = () => Object.freeze({ coordinate: coordinate(), checkpoint });
  const support = Object.freeze({
    current,
    async step(update: Step) {
      assert.deepEqual(update.expected, coordinate());
      if (update.checkpoint === null && failClearOnce) {
        failClearOnce = false;
        throw new Error("simulated loss after Evidence retention");
      }
      checkpoint = update.checkpoint;
      generation += 1;
      return Object.freeze({ view: current(), append: null, files: Object.freeze([]) });
    },
  }) as unknown as FoundationAgentRoleCheckpointAdapterV7;

  const context: FoundationAgentRoleControlContextV7 = Object.freeze({
    store,
    activityId: ACTIVITY,
    operation: "delivery.evaluate",
    role: "reviewer",
    brief,
    attempt,
    boundary,
    attemptedCandidate: candidate,
    resultCandidate: candidate,
    seal,
    workProduct,
    receipt,
    support,
  });
  return {
    context,
    evidence,
    condition,
    appendEvidence() {
      currentEvidence = evidence;
      return appendEvent("evidence-packet-finalized", evidence);
    },
    appendCondition() {
      if (condition === null) throw new Error("condition fixture is absent");
      currentCondition = condition;
      return appendEvent("material-condition-frozen", condition);
    },
    failNextClear() { failClearOnce = true; },
    checkpoint: () => checkpoint,
  };
}

function reference(value: ControlRecordRevision) {
  return Object.freeze({ id: value.recordId, revision: value.revision, digest: value.digest });
}

function observation() {
  return Object.freeze({
    artifacts: Object.freeze([]),
    descriptionCoverage: Object.freeze([]),
    reviewerSubjectDisposition: "exact-read-only" as const,
  });
}

function verifiedHarness(materialReview?: "mandate" | "baseline") {
  const base = evidenceFixtureV7(materialReview === undefined ? {} : {materialReview});
  const supportHarness = harness({withWorkProduct:true});
  const byKind = (kind:string, role?:string) => {
    const value = [...base.revisions.values()].find((item) => item.recordKind === kind && (role === undefined || item.payload.role === role));
    assert.ok(value); return value;
  };
  const candidate = base.store.getRevision(base.selected.candidate.id,base.selected.candidate.revision)!;
  const context: FoundationAgentRoleControlContextV7 = {
    store:base.store,activityId:base.activityId,operation:"delivery.evaluate",role:"reviewer",
    brief:byKind("director-brief"),attempt:byKind("agent-attempt","reviewer"),boundary:byKind("work-boundary"),
    attemptedCandidate:candidate,resultCandidate:candidate,seal:byKind("candidate-seal"),
    workProduct:byKind("agent-work-product","reviewer"),receipt:byKind("execution-receipt"),support:supportHarness.context.support,
  };
  const calls = {condition:0,evidence:0};
  const owners = {
    now:() => EVIDENCE_OBSERVATION_V7.evaluatedAt,
    retainCondition:((input) => {
      calls.condition += 1;
      // Semantic diagnosis and its observation checkpoint exist while no frozen response exists yet.
      assert.equal(base.store.state().subjects.materialCondition,null);
      assert.notEqual(supportHarness.checkpoint(),null);
      return retainMaterialCondition(input);
    }) as typeof retainMaterialCondition,
    retainEvidence:((input) => {calls.evidence += 1; return retainEvidencePacket(input);}) as typeof retainEvidencePacket,
  };
  return {context,calls,owners,checkpoint:supportHarness.checkpoint,failNextClear:supportHarness.failNextClear};
}

test("evaluation finalization completes a missing reviewer Work Product as failed without sampling Evidence", async () => {
  const value = harness({ withWorkProduct: false });
  let observed = false;
  const result = await finalizeDeliveryEvaluationV7({
    ...value.context,
    runtimeId: "runtime-v7",
    observeEvidence: async () => {
      observed = true;
      return observation();
    },
  });
  assert.equal(result.outcome, "failed");
  assert.deepEqual(result.controls, []);
  assert.equal(observed, false);
});

test("evaluation finalization checkpoints physical observations and derives one Evidence Packet", async () => {
  const value = verifiedHarness();
  assert.equal(
    value.context.receipt.relationships.some(({ relation }) => relation === "observes-candidate"),
    false,
  );
  const calls = value.calls;
  let observed = 0;
  const input = {
    ...value.context,
    runtimeId: "runtime-v7",
    observeEvidence: async () => {
      observed += 1;
      return EVIDENCE_OBSERVATION_V7;
    },
  };
  const first = await finalizeDeliveryEvaluationV7(input, value.owners);
  assert.equal(first.outcome, "completed");
  assert.deepEqual(first.controls?.map(({ recordKind }) => recordKind), ["evidence-packet"]);
  assert.equal(observed, 1);
  assert.equal(calls.condition, 0);
  assert.equal(calls.evidence, 1);
  assert.equal(value.checkpoint(), null);

  const replay = await finalizeDeliveryEvaluationV7(input, value.owners);
  assert.equal(replay.outcome, "completed");
  assert.equal(observed, 1);
  assert.equal(calls.evidence, 1);
});

test("evaluation finalization refuses a reviewer Candidate successor edge or substituted input", async () => {
  for (const { value, code } of [
    {
      value: harness({ withWorkProduct: true, withReceiptCandidateSuccessor: true }),
      code: "lifecycle.evaluation-finalization-v7.relationship",
    },
    {
      value: harness({ withWorkProduct: true, substituteReceiptCandidate: true }),
      code: "lifecycle.evaluation-finalization-v7.candidate",
    },
    {
      value: harness({ withWorkProduct: true, substituteReceiptCarrier: true }),
      code: "lifecycle.evaluation-finalization-v7.candidate",
    },
  ]) {
    await assert.rejects(
      () => finalizeDeliveryEvaluationV7({
        ...value.context,
        runtimeId: "runtime-v7",
        observeEvidence: async () => observation(),
      }),
      (error: unknown) => error instanceof FoundationError && error.code === code,
    );
  }
});

test("evaluation finalization resumes after Evidence retention without resampling observations", async () => {
  const value = verifiedHarness("mandate");
  const calls = value.calls;
  let observed = 0;
  const input = {
    ...value.context,
    runtimeId: "runtime-v7",
    observeEvidence: async () => {
      observed += 1;
      return EVIDENCE_OBSERVATION_V7;
    },
  };
  value.failNextClear();
  await assert.rejects(
    () => finalizeDeliveryEvaluationV7(input, value.owners),
    /simulated loss after Evidence retention/u,
  );
  assert.notEqual(value.checkpoint(), null);
  assert.equal(observed, 1);
  assert.equal(calls.condition, 1);
  assert.equal(calls.evidence, 1);

  const recovered = await finalizeDeliveryEvaluationV7(input, value.owners);
  assert.equal(recovered.outcome, "completed");
  assert.deepEqual(recovered.controls?.map(({ recordKind }) => recordKind), [
    "material-condition",
    "evidence-packet",
  ]);
  assert.equal(value.checkpoint(), null);
  assert.equal(observed, 1);
  assert.equal(calls.condition, 1);
  assert.equal(calls.evidence, 1);
});

test("baseline insufficiency is assessed before its exact Material Condition is retained", async () => {
  const value = verifiedHarness("baseline");
  const result = await finalizeDeliveryEvaluationV7({...value.context,runtimeId:"runtime-v7",observeEvidence:async () => EVIDENCE_OBSERVATION_V7},value.owners);
  assert.equal(result.outcome,"completed");
  assert.deepEqual(result.controls?.map(({recordKind}) => recordKind),["material-condition","evidence-packet"]);
  assert.equal(result.controls?.at(-1)?.payload.readiness,"revision-required");
  assert.deepEqual(value.calls,{condition:1,evidence:1});
});

test("recovery after the Condition reaction reuses the checkpointed diagnosis and completes Packet retention", async () => {
  const value = verifiedHarness("mandate");
  let observations = 0;
  const input = {...value.context,runtimeId:"runtime-v7",observeEvidence:async () => {observations += 1;return EVIDENCE_OBSERVATION_V7;}};
  await assert.rejects(finalizeDeliveryEvaluationV7(input,{...value.owners,
    retainEvidence:() => {throw new Error("interruption after Condition reaction");},
  }),/interruption after Condition reaction/u);
  assert.notEqual(value.context.store.state().subjects.materialCondition,null);
  assert.equal(value.context.store.state().subjects.evidence,null);
  assert.equal(value.calls.condition,1);
  const result = await finalizeDeliveryEvaluationV7(input,value.owners);
  assert.equal(result.outcome,"completed");
  assert.equal(observations,1);
  assert.equal(value.calls.condition,1);
  assert.equal(value.calls.evidence,1);
  assert.equal(result.controls?.at(-1)?.payload.readiness,"revision-required");
});
