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
import { finalizeCandidateDevelopmentV7 } from "../../src/foundation/process/candidate-development-finalization-v7.js";
import { sha256Bytes, type Sha256 } from "../../src/foundation/validation/canonical.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

const PROCESS = "delivery-candidate-finalization-v7";
const STORE = "store-candidate-finalization-v7";
const ACTIVITY = "activity-candidate-finalization-v7";
const CREATED = "2026-08-29T21:00:00.000Z";

function relation(relation: string, target: ControlRecordRevision): ControlRecordRelationship {
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
    revision: input.kind === "candidate-revision" && input.id.endsWith("result") ? 2 : 1,
    producer: Object.freeze({ kind: "runtime", id: "runtime-v7" }),
    semanticAuthor: authority === "agent-proposed"
      ? Object.freeze({ kind: "agent", id: "builder-agent" })
      : Object.freeze({ kind: "runtime", id: "runtime-v7" }),
    semanticAuthority: authority,
    createdAt: CREATED,
    semanticMarkdown: `# ${input.kind}\n`,
    payload: input.payload,
    relationships: input.relationships ?? Object.freeze([]),
  });
}

function reference(value: ControlRecordRevision) {
  return Object.freeze({ id: value.recordId, revision: value.revision, digest: value.digest });
}

function fixture(proposal: "absent" | "progress" | "material-condition") {
  const candidatePayload = validDeliveryControlPayload("candidate-revision");
  const boundary = revision({
    id: "work-boundary-candidate-finalization",
    kind: "work-boundary",
    payload: validDeliveryControlPayload("work-boundary"),
  });
  const attempted = revision({
    id: "candidate-revision-candidate-attempted",
    kind: "candidate-revision",
    payload: candidatePayload,
    relationships: Object.freeze([relation("governed-by", boundary)]),
  });
  const brief = revision({
    id: "founder-brief-candidate-finalization",
    kind: "founder-brief",
    payload: Object.freeze({ schema: "lifecycle.founder-brief-payload.v1" }),
  });
  const attempt = revision({
    id: "agent-attempt-candidate-finalization",
    kind: "agent-attempt",
    payload: Object.freeze({
      ...validDeliveryControlPayload("agent-attempt"),
      activityId: ACTIVITY,
      operation: "delivery.continue",
      role: "builder",
      invocationId: "invocation-candidate-finalization-v7",
    }),
    relationships: Object.freeze([
      relation("uses-brief", brief),
      relation("uses-boundary", boundary),
      relation("uses-candidate", attempted),
    ]),
  });
  const result = revision({
    id: "candidate-revision-candidate-result",
    kind: "candidate-revision",
    payload: Object.freeze({
      ...candidatePayload,
      observation: "builder-successor",
      state: Object.freeze({
        ...(candidatePayload.state as ControlJsonObject),
        tree: "c".repeat(40),
        candidateDigest: sha256Bytes("candidate-finalization-successor"),
        unchangedFromPredecessor: false,
        changedSubjects: Object.freeze([Object.freeze({
          path: "src/result.ts",
          change: "modified",
          beforeDigest: sha256Bytes("candidate-finalization-before"),
          afterDigest: sha256Bytes("candidate-finalization-after"),
        })]),
      }),
    }),
    relationships: Object.freeze([
      relation("revises", attempted),
      relation("governed-by", boundary),
      relation("result-of", attempt),
    ]),
  });
  const workProduct = proposal === "absent"
    ? null
    : revision({
        id: "agent-work-product-candidate-finalization",
        kind: "agent-work-product",
        authority: "agent-proposed",
        payload: Object.freeze({
          schema: "lifecycle.agent-work-product-payload.v2",
          role: "builder",
          roleSemantics: Object.freeze({
            role: "builder",
            proposal,
            conditions: proposal === "material-condition"
              ? Object.freeze([Object.freeze({ id: "condition.builder" })])
              : Object.freeze([]),
          }),
        }),
        relationships: Object.freeze([relation("result-of", attempt)]),
      });
  const receipt = revision({
    id: "execution-receipt-candidate-finalization",
    kind: "execution-receipt",
    authority: "runtime-observed",
    payload: Object.freeze({
      ...validDeliveryControlPayload("execution-receipt"),
      activityId: ACTIVITY,
      role: "builder",
    }),
    relationships: Object.freeze([
      relation("observes-attempt", attempt),
      relation("observes-candidate", result),
      ...(workProduct === null ? [] : [relation("observes-work-product", workProduct)]),
    ]),
  });
  const condition = workProduct === null
    ? null
    : revision({
        id: "material-condition-candidate-finalization",
        kind: "material-condition",
        payload: Object.freeze({
          schema: "lifecycle.material-condition-payload.v1",
          source: Object.freeze({
            kind: "agent-proposal",
            conditionId: "condition.material",
            fragmentDigest: sha256Bytes("condition.material"),
          }),
          observedFactsDigest: sha256Bytes("candidate-material-condition-facts"),
        }),
        relationships: Object.freeze([
          relation("reported-by", workProduct),
          relation("observed-in", receipt),
          relation("freezes", result),
          relation("governed-by", boundary),
        ]),
      });
  const retained = new Map<string, ControlRecordRevision>();
  for (const value of [boundary, attempted, result, brief, attempt, workProduct, receipt]) {
    if (value !== null) retained.set(`${value.recordId}\0${value.revision}`, value);
  }
  const journal: ControlRecordEvent[] = [];
  let predecessorDigest: Sha256 | null = null;
  let currentCondition: ControlRecordRevision | null = null;
  const appendCondition = () => {
    if (condition === null) throw new Error("condition fixture is absent");
    retained.set(`${condition.recordId}\0${condition.revision}`, condition);
    currentCondition = condition;
    const event = compileControlRecordEvent({
      storeId: STORE,
      processId: PROCESS,
      sequence: journal.length + 1,
      predecessorDigest,
      event: {
        eventId: `event-material-condition-${journal.length + 1}`,
        eventKind: "material-condition-frozen",
        occurredAt: CREATED,
        actor: Object.freeze({ kind: "runtime", id: "runtime-v7" }),
        subject: Object.freeze({
          recordId: condition.recordId,
          revision: condition.revision,
          digest: condition.digest,
        }),
        payload: Object.freeze({
          sourceKind: "agent-proposal",
          activityId: ACTIVITY,
          observedFactsDigest: condition.payload.observedFactsDigest!,
        }),
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
      targetId: "target-candidate-finalization-v7",
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
        candidateCondition: currentCondition === null ? "in-progress" as const : "boundary-resolution" as const,
        activities: Object.freeze([]),
        subjects: Object.freeze({
          proposedBoundary: null,
          activeBoundary: reference(boundary),
          candidate: reference(result),
          materialCondition: currentCondition === null ? null : reference(currentCondition),
          seal: null,
          evidence: null,
          closure: null,
        }),
        journal: Object.freeze({ eventCount: journal.length, headDigest: predecessorDigest }),
        eligibleOperations: Object.freeze([]),
      });
    },
  } as unknown as ControlRecordStore;

  let generation = 1;
  let checkpoint: ControlJsonObject | null = null;
  let failClear = false;
  const coordinate = () => Object.freeze({ generation, payloadDigest: sha256Bytes(`support-${generation}`) });
  type Step = Parameters<FoundationAgentRoleCheckpointAdapterV7["step"]>[0];
  const current = () => Object.freeze({ coordinate: coordinate(), checkpoint });
  const support = Object.freeze({
    current,
    async step(update: Step) {
      assert.deepEqual(update.expected, coordinate());
      if (update.checkpoint === null && failClear) {
        failClear = false;
        throw new Error("simulated loss after Material Condition retention");
      }
      checkpoint = update.checkpoint;
      generation += 1;
      return Object.freeze({
        view: current(),
        append: null,
        files: Object.freeze([]),
      });
    },
  }) as unknown as FoundationAgentRoleCheckpointAdapterV7;
  const context: FoundationAgentRoleControlContextV7 = Object.freeze({
    store,
    activityId: ACTIVITY,
    operation: "delivery.continue",
    role: "builder",
    brief,
    attempt,
    boundary,
    attemptedCandidate: attempted,
    resultCandidate: result,
    seal: null,
    workProduct,
    receipt,
    support,
  });
  return {
    context,
    condition,
    appendCondition,
    failNextClear() { failClear = true; },
    checkpoint: () => checkpoint,
  };
}

test("candidate finalization fails a builder pass without a Work Product", async () => {
  const value = fixture("absent");
  const result = await finalizeCandidateDevelopmentV7({ ...value.context, runtimeId: "runtime-v7" });
  assert.equal(result.outcome, "failed");
  assert.deepEqual(result.controls, []);
});

test("candidate finalization completes ordinary progress without manufacturing another Control record", async () => {
  const value = fixture("progress");
  const result = await finalizeCandidateDevelopmentV7({ ...value.context, runtimeId: "runtime-v7" });
  assert.equal(result.outcome, "completed");
  assert.deepEqual(result.controls, []);
  assert.equal(value.checkpoint(), null);
});

test("candidate finalization resumes an exact Material Condition without resampling its time", async () => {
  const value = fixture("material-condition");
  let retained = 0;
  const options = Object.freeze({
    now: () => "2026-08-29T21:01:00.000Z",
    retainCondition: ((input) => {
      retained += 1;
      assert.equal(input.frozenAt, "2026-08-29T21:01:00.000Z");
      return Object.freeze({ revision: value.condition!, event: value.appendCondition() });
    }) as NonNullable<Parameters<typeof finalizeCandidateDevelopmentV7>[1]>["retainCondition"],
  });
  value.failNextClear();
  await assert.rejects(
    () => finalizeCandidateDevelopmentV7({ ...value.context, runtimeId: "runtime-v7" }, options),
    /simulated loss after Material Condition retention/u,
  );
  assert.notEqual(value.checkpoint(), null);
  assert.equal(retained, 1);

  const recovered = await finalizeCandidateDevelopmentV7(
    { ...value.context, runtimeId: "runtime-v7" },
    options,
  );
  assert.equal(recovered.outcome, "completed");
  assert.deepEqual(recovered.controls?.map(({ recordKind }) => recordKind), ["material-condition"]);
  assert.equal(value.checkpoint(), null);
  assert.equal(retained, 1);
});
