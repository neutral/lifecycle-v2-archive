import assert from "node:assert/strict";
import test from "node:test";
import {
  MATERIAL_CONDITION_CLASSES,
  MATERIAL_CONDITION_RULE_SET_DIGEST,
  MATERIAL_CONDITION_RULE_SET_ID,
  retainMaterialCondition,
} from "../../src/foundation/control/material-condition.js";
import {
  compileControlRecordEvent,
  compileControlRecordRevision,
} from "../../src/foundation/control/model.js";
import { assertDeliveryControlRecordPayload } from "../../src/foundation/control/payload-registry.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlJsonObject,
  type ControlRecordEvent,
  type ControlRecordEventInput,
  type ControlRecordRevision,
  type ControlRecordRevisionInput,
  type ControlRecordStoreAppend,
  type ControlRecordStoreIdentity,
} from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import type { ReducedDeliveryState } from "../../src/foundation/process/delivery-reducer.js";
import {
  sha256Bytes,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

const CREATED = "2026-08-29T20:00:00.000Z";
const FROZEN = "2026-08-29T20:00:04.000Z";
const ACTIVITY = "activity-continue-material-condition";
const RUNTIME = "foundation-runtime";

function digest(value: string): Sha256 {
  return sha256Bytes(value);
}

function reference(revision: ControlRecordRevision) {
  return Object.freeze({
    kind: revision.recordKind,
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function subject(revision: ControlRecordRevision) {
  return Object.freeze({
    recordId: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function revisionInput(input: Readonly<{
  id: string;
  kind: string;
  payload: ControlJsonObject;
  relationships?: ControlRecordRevisionInput["relationships"];
}>): ControlRecordRevisionInput {
  const agentAuthored = input.kind === "agent-work-product";
  return Object.freeze({
    recordId: input.id,
    recordKind: input.kind,
    revision: 1,
    producer: { kind: "runtime" as const, id: RUNTIME },
    semanticAuthor: agentAuthored
      ? { kind: "agent" as const, id: "builder-one" }
      : { kind: "runtime" as const, id: RUNTIME },
    semanticAuthority: agentAuthored ? "agent-proposed" : "runtime-observed",
    createdAt: CREATED,
    semanticMarkdown: `# ${input.kind}\n`,
    payload: input.payload,
    relationships: input.relationships,
  });
}

function fixture(
  conditionClass = "scope-change",
  sourceRole: "builder" | "reviewer" = "builder",
) {
  const operation = sourceRole === "builder" ? "delivery.continue" : "delivery.evaluate";
  const identity: ControlRecordStoreIdentity = Object.freeze({
    schema: CONTROL_RECORD_STORE_SCHEMA,
    storeId: "store-material-condition",
    targetId: "target-material-condition",
    processKind: "delivery",
    processId: "delivery-material-condition",
    createdAt: CREATED,
  });
  const revisions = new Map<string, ControlRecordRevision>();
  const events: ControlRecordEvent[] = [];
  let predecessorDigest: Sha256 | null = null;
  let appendCalls = 0;
  const retain = (input: ControlRecordRevisionInput): ControlRecordRevision => {
    const revision = compileControlRecordRevision(identity.processId, input);
    revisions.set(`${revision.recordId}\u0000${revision.revision}`, revision);
    return revision;
  };
  const event = (input: ControlRecordEventInput): ControlRecordEvent => {
    const compiled = compileControlRecordEvent({
      storeId: identity.storeId,
      processId: identity.processId,
      sequence: events.length + 1,
      predecessorDigest,
      event: input,
    });
    predecessorDigest = compiled.digest;
    events.push(compiled);
    return compiled;
  };

  const boundary = retain(revisionInput({
    id: "boundary-one",
    kind: "work-boundary",
    payload: Object.freeze({
      schema: "lifecycle.work-boundary-payload.v4",
      knowledge: Object.freeze([Object.freeze({ id: "check.demo" })]),
      mandate: Object.freeze({
        objective: Object.freeze({ id: "objective.one" }),
        direction: Object.freeze({ id: "direction.one" }),
        effects: Object.freeze([]),
        risks: Object.freeze([]),
        obligations: Object.freeze([Object.freeze({ id: "obligation.one" })]),
        artifacts: Object.freeze([]),
        checks: Object.freeze([]),
        acceptancePropositions: Object.freeze([]),
      }),
    }),
  }));
  const candidatePayload = validDeliveryControlPayload("candidate-revision");
  const priorCandidate = retain(revisionInput({
    id: "candidate-one",
    kind: "candidate-revision",
    payload: Object.freeze({
      ...candidatePayload,
      limitations: Object.freeze(sourceRole === "reviewer"
        ? ["Candidate observation is bounded."]
        : []),
    }),
    relationships: [{ relation: "governed-by", target: reference(boundary) }],
  }));
  const seal = sourceRole === "reviewer"
    ? retain(revisionInput({
        id: "seal-reviewer-one",
        kind: "candidate-seal",
        payload: validDeliveryControlPayload("candidate-seal"),
        relationships: [
          { relation: "seals", target: reference(priorCandidate) },
          { relation: "governed-by", target: reference(boundary) },
        ],
      }))
    : null;
  const attempt = retain(revisionInput({
    id: `attempt-${sourceRole}-one`,
    kind: "agent-attempt",
    payload: Object.freeze({
      schema: "lifecycle.agent-attempt-payload.v3",
      activityId: ACTIVITY,
      role: sourceRole,
    }),
    relationships: [
      { relation: "uses-boundary", target: reference(boundary) },
      { relation: "uses-candidate", target: reference(priorCandidate) },
      ...(seal === null ? [] : [{ relation: "uses-seal", target: reference(seal) }]),
    ],
  }));
  const candidate = sourceRole === "builder"
    ? retain({
        ...revisionInput({
          id: "candidate-one",
          kind: "candidate-revision",
          payload: Object.freeze({
            ...candidatePayload,
            observation: "builder-successor",
            state: Object.freeze({
              ...(candidatePayload.state as ControlJsonObject),
              tree: "c".repeat(40),
              candidateDigest: digest("candidate-successor"),
              unchangedFromPredecessor: false,
              changedSubjects: Object.freeze([Object.freeze({
                path: "src/result.ts",
                change: "modified",
                beforeDigest: digest("candidate-result-before"),
                afterDigest: digest("candidate-result-after"),
              })]),
            }),
            limitations: Object.freeze(["Candidate observation is bounded."]),
          }),
          relationships: [
            { relation: "governed-by", target: reference(boundary) },
            { relation: "revises", target: reference(priorCandidate) },
            { relation: "result-of", target: reference(attempt) },
          ],
        }),
        revision: 2,
      })
    : priorCandidate;
  const fragmentDigest = digest("condition-fragment");
  const workProduct = retain(revisionInput({
    id: `work-product-${sourceRole}-one`,
    kind: "agent-work-product",
    payload: Object.freeze({
      schema: "lifecycle.agent-work-product-payload.v2",
      role: sourceRole,
      uncertainty: Object.freeze({ level: sourceRole === "reviewer" ? "material" : "bounded" }),
      limitations: Object.freeze([Object.freeze({
        id: "limitation.one",
        statement: "One bounded\nsource limitation.",
        fragmentDigest: digest("limitation"),
      })]),
      roleSemantics: Object.freeze({
        role: sourceRole,
        ...(sourceRole === "builder"
          ? { proposal: "material-condition" }
          : {
              judgments: Object.freeze([]),
              mandateExcess: true,
              missingObligationIds: Object.freeze([]),
            }),
        conditions: Object.freeze([Object.freeze({
          id: "condition.scope-change",
          conditionClass,
          statement: "The requested outcome exceeds the admitted scope.",
          falsifiedMandateIds: Object.freeze(["objective.one"]),
          knowledgeIds: Object.freeze(["check.demo"]),
          founderJudgmentRequired: true,
          fragmentDigest,
        })]),
      }),
      body: Object.freeze({
        fragments: Object.freeze([Object.freeze({
          id: "condition.scope-change",
          kind: "condition",
          anchor: "condition-scope-change",
          digest: fragmentDigest,
        })]),
      }),
    }),
    relationships: [{ relation: "result-of", target: reference(attempt) }],
  }));
  const receipt = retain(revisionInput({
    id: "receipt-builder-one",
    kind: "execution-receipt",
    payload: Object.freeze({
      schema: "lifecycle.execution-receipt-payload.v3",
      activityId: ACTIVITY,
      workspace: Object.freeze({
        compilerDisposition: "retained",
      }),
      workProduct: Object.freeze({ disposition: "submitted" }),
      candidate: sourceRole === "builder"
        ? Object.freeze({ successorDisposition: "promoted", successor: Object.freeze({}) })
        : Object.freeze({ successorDisposition: null, successor: null }),
      containment: Object.freeze({ classification: "contained" }),
      retirement: Object.freeze({ classification: "retired" }),
    }),
    relationships: [
      { relation: "observes-attempt", target: reference(attempt) },
      { relation: "observes-work-product", target: reference(workProduct) },
      ...(sourceRole === "builder"
        ? [{ relation: "observes-candidate", target: reference(candidate) }]
        : []),
    ],
  }));
  event({
    eventId: "event-work-product",
    eventKind: "agent-work-product-submitted",
    occurredAt: "2026-08-29T20:00:01.000Z",
    actor: { kind: "runtime", id: RUNTIME },
    subject: subject(workProduct),
    payload: { activityId: ACTIVITY },
  });
  if (sourceRole === "builder") {
    event({
      eventId: "event-candidate",
      eventKind: "candidate-revision-observed",
      occurredAt: "2026-08-29T20:00:02.000Z",
      actor: { kind: "runtime", id: RUNTIME },
      subject: subject(candidate),
      payload: { activityId: ACTIVITY },
    });
  }
  event({
    eventId: "event-receipt",
    eventKind: "execution-receipt-recorded",
    occurredAt: "2026-08-29T20:00:03.000Z",
    actor: { kind: "runtime", id: RUNTIME },
    subject: subject(receipt),
    payload: { activityId: ACTIVITY },
  });
  const state: ReducedDeliveryState = Object.freeze({
    standing: "active",
    candidateCondition: "in-progress",
    activities: Object.freeze([Object.freeze({
      id: ACTIVITY,
      operation,
      family: "agent",
      stage: "finalizing",
      recovery: Object.freeze({
        kind: "finalization",
        resumesAt: "activity-finalization",
        exactEffectDigest: null,
      }),
    })]),
    subjects: Object.freeze({
      proposedBoundary: null,
      activeBoundary: Object.freeze({ id: boundary.recordId, revision: 1, digest: boundary.digest }),
      candidate: Object.freeze({
        id: candidate.recordId,
        revision: candidate.revision,
        digest: candidate.digest,
      }),
      materialCondition: null,
      seal: seal === null
        ? null
        : Object.freeze({ id: seal.recordId, revision: seal.revision, digest: seal.digest }),
      evidence: null,
      closure: null,
    }),
    journal: Object.freeze({ eventCount: events.length, headDigest: events.at(-1)!.digest }),
    eligibleOperations: Object.freeze([]),
  });
  const store = {
    identity,
    getRevision(recordId: string, revision: number) {
      return revisions.get(`${recordId}\u0000${revision}`) ?? null;
    },
    listEvents(afterSequence = 0, limit = 1_000) {
      return Object.freeze(events.filter(({ sequence }) => sequence > afterSequence).slice(0, limit));
    },
    state() {
      return state;
    },
    append(input: ControlRecordStoreAppend) {
      appendCalls += 1;
      const revision = input.revision === undefined
        ? null
        : compileControlRecordRevision(identity.processId, input.revision);
      if (revision !== null) {
        assertDeliveryControlRecordPayload(revision);
        revisions.set(`${revision.recordId}\u0000${revision.revision}`, revision);
      }
      return Object.freeze({ revision, event: event(input.event) });
    },
  } as unknown as ControlRecordStore;
  return { store, appendCalls: () => appendCalls } as const;
}

test("Material Condition compiler freezes exact builder facts under one installed rule", () => {
  const { store, appendCalls } = fixture();
  const retained = retainMaterialCondition({
    store,
    activityId: ACTIVITY,
    runtime: {
      implementationId: "runtime.material-condition-compiler",
      implementationDigest: digest("material-condition-compiler"),
    },
    frozenAt: FROZEN,
    runtimeId: RUNTIME,
  });

  assert.equal(appendCalls(), 1);
  assert.match(retained.revision.recordId, /^material-condition-[a-f0-9]{64}$/u);
  assert.equal(retained.revision.recordKind, "material-condition");
  assert.equal(retained.revision.semanticAuthority, "runtime-derived");
  assert.equal(retained.revision.payload.conditionClass, "scope-change");
  assert.deepEqual(retained.revision.payload.source, {
    kind: "agent-proposal",
    conditionId: "condition.scope-change",
    fragmentDigest: digest("condition-fragment"),
  });
  assert.equal(retained.revision.payload.observedFactsDigest?.toString().startsWith("sha256:"), true);
  assert.deepEqual(retained.revision.payload.ruleSet, {
    id: MATERIAL_CONDITION_RULE_SET_ID,
    digest: MATERIAL_CONDITION_RULE_SET_DIGEST,
    implementationId: "runtime.material-condition-compiler",
    implementationDigest: digest("material-condition-compiler"),
  });
  assert.deepEqual(retained.revision.payload.limitations, [
    "Candidate observation is bounded.",
    "One bounded source limitation.",
  ]);
  assert.deepEqual(retained.revision.relationships.map(({ relation }) => relation), [
    "freezes",
    "governed-by",
    "observed-in",
    "reported-by",
  ]);
  assert.equal(retained.event.eventKind, "material-condition-frozen");
  assert.deepEqual(retained.event.payload, {
    sourceKind: "agent-proposal",
    activityId: ACTIVITY,
    observedFactsDigest: retained.revision.payload.observedFactsDigest,
  });
  assert.match(retained.revision.semanticMarkdown, /Source proposal .* \(agent-proposed\)/u);
});

test("Material Condition compiler freezes exact reviewer facts without inventing a Candidate revision", () => {
  const { store, appendCalls } = fixture("scope-change", "reviewer");
  const retained = retainMaterialCondition({
    store,
    activityId: ACTIVITY,
    runtime: {
      implementationId: "runtime.material-condition-compiler",
      implementationDigest: digest("material-condition-compiler"),
    },
    frozenAt: FROZEN,
    runtimeId: RUNTIME,
  });

  assert.equal(appendCalls(), 1);
  assert.equal(retained.revision.payload.conditionClass, "scope-change");
  assert.deepEqual(retained.revision.payload.limitations, [
    "Candidate observation is bounded.",
    "One bounded source limitation.",
  ]);
  assert.equal(retained.event.eventKind, "material-condition-frozen");
  assert.match(retained.revision.semanticMarkdown, /Source proposal .* \(agent-proposed\)/u);
});

test("Material Condition compiler refuses classes outside the shared closed vocabulary", () => {
  assert.equal(MATERIAL_CONDITION_CLASSES.includes("founder-tradeoff"), true);
  assert.equal(
    (MATERIAL_CONDITION_CLASSES as readonly string[]).includes("incompatible-product-state-drift"),
    false,
  );
  assert.equal(
    (MATERIAL_CONDITION_CLASSES as readonly string[]).includes("incompatible-atlas-drift"),
    false,
  );
  const { store, appendCalls } = fixture("unclassified-condition");
  assert.throws(
    () => retainMaterialCondition({
      store,
      activityId: ACTIVITY,
      runtime: {
        implementationId: "runtime.material-condition-compiler",
        implementationDigest: digest("material-condition-compiler"),
      },
      frozenAt: FROZEN,
      runtimeId: RUNTIME,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.control-material-condition.condition-class",
  );
  assert.equal(appendCalls(), 0);
});
