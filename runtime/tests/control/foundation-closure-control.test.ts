import assert from "node:assert/strict";
import test from "node:test";
import {
  retainClosure,
  type ClosureCanonicalResult,
} from "../../src/foundation/control/closure.js";
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
  type ControlRecordRelationship,
  type ControlRecordRevision,
  type ControlRecordStoreAppend,
  type ControlRecordStoreIdentity,
} from "../../src/foundation/control/types.js";
import type { ReducedDeliveryState } from "../../src/foundation/process/delivery-reducer.js";
import { digestCanonical, sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

const RUNTIME = "foundation-runtime";
const OBSERVED = "2026-08-29T21:00:00.000Z";
const CLOSED = "2026-08-29T21:00:01.000Z";
const ACTIVITY = "activity-terminal";

const identity: ControlRecordStoreIdentity = Object.freeze({
  schema: CONTROL_RECORD_STORE_SCHEMA,
  storeId: "store-closure",
  targetId: "target-closure",
  processKind: "delivery",
  processId: "delivery-closure",
  createdAt: "2026-08-29T20:00:00.000Z",
});

function digest(value: string) {
  return sha256Bytes(value);
}

function relationship(
  relation: string,
  target: ControlRecordRevision,
): ControlRecordRelationship {
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
  payload?: ControlJsonObject;
  relationships?: readonly ControlRecordRelationship[];
}>): ControlRecordRevision {
  return compileControlRecordRevision(identity.processId, {
    recordId: input.id,
    recordKind: input.kind,
    revision: 1,
    producer: { kind: "runtime", id: RUNTIME },
    semanticAuthor: { kind: "runtime", id: RUNTIME },
    semanticAuthority: "runtime-derived",
    createdAt: identity.createdAt,
    semanticMarkdown: `# ${input.kind}\n`,
    payload: input.payload ?? {},
    relationships: input.relationships ?? [],
  });
}

function transactionEvents(
  decision: ControlRecordRevision,
  options: Readonly<{
    canonicalResult?: ClosureCanonicalResult;
    observationFacts?: ControlJsonObject;
    preIntentRefusalActivityIds?: readonly string[];
  }> = {},
): readonly ControlRecordEvent[] {
  type EventInput = Readonly<{
    eventId: string;
    eventKind: string;
    occurredAt: string;
    payload: ControlJsonObject;
    subject: ControlRecordEvent["subject"];
  }>;
  const effectDigest = digest("terminal-effect");
  const repositoryFacts = Object.freeze({
    schema: "lifecycle.terminal-repository-effect-observation.v1",
    ref: "refs/heads/main",
    commit: "a".repeat(40),
    tree: "b".repeat(40),
    objectFormat: "sha1",
  });
  const facts = options.observationFacts ?? (
    decision.payload.decision === "accept" && options.canonicalResult !== undefined
      ? Object.freeze({
          schema: "lifecycle.terminal-acceptance-effect-observation.v1",
          ref: "refs/heads/main",
          commit: options.canonicalResult.commit,
          tree: options.canonicalResult.tree,
          objectFormat: "sha1",
          canonicalResultDigest: digestCanonical(options.canonicalResult),
        })
      : repositoryFacts
  );
  const decisionSubject = Object.freeze({
    recordId: decision.recordId,
    revision: decision.revision,
    digest: decision.digest,
  });
  const refusalInputs: readonly EventInput[] = (options.preIntentRefusalActivityIds ?? []).map(
    (activityId, index) => ({
      eventId: `event-pre-intent-refused-${index + 1}`,
      eventKind: "agent-pre-intent-refused",
      occurredAt: "2026-08-29T20:59:57.000Z",
      payload: Object.freeze({
        activityId,
        diagnosticCode: "provider-input-invalid",
        refusalFactsDigest: digest(`pre-intent-refusal-${index + 1}`),
      }),
      subject: null,
    }),
  );
  const inputs: readonly EventInput[] = [
    ...refusalInputs,
    {
      eventId: "event-decision",
      eventKind: "founder-decision-authenticated",
      occurredAt: "2026-08-29T20:59:58.000Z",
      payload: Object.freeze({ activityId: ACTIVITY }),
      subject: decisionSubject,
    },
    {
      eventId: "event-transaction-intent",
      eventKind: "transaction-effect-intended",
      occurredAt: "2026-08-29T20:59:59.000Z",
      payload: Object.freeze({ activityId: ACTIVITY, effectDigest }),
      subject: decisionSubject,
    },
    {
      eventId: "event-transaction-observed",
      eventKind: "transaction-effect-observed",
      occurredAt: OBSERVED,
      payload: Object.freeze({
        activityId: ACTIVITY,
        effectDigest,
        outcome: "applied",
        facts,
        factsDigest: digestCanonical(facts),
      }),
      subject: decisionSubject,
    },
  ];
  const events: ControlRecordEvent[] = [];
  for (const input of inputs) {
    events.push(compileControlRecordEvent({
      storeId: identity.storeId,
      processId: identity.processId,
      sequence: events.length + 1,
      predecessorDigest: events.at(-1)?.digest ?? null,
      event: {
        ...input,
        actor: { kind: "runtime", id: RUNTIME },
      },
    }));
  }
  return Object.freeze(events);
}

function reference(value: ControlRecordRevision | null) {
  return value === null ? null : Object.freeze({
    id: value.recordId,
    revision: value.revision,
    digest: value.digest,
  });
}

function fakeStore(input: Readonly<{
  operation: "delivery.accept" | "delivery.no-ship";
  revisions: readonly ControlRecordRevision[];
  decision: ControlRecordRevision;
  boundary?: ControlRecordRevision | null;
  candidate?: ControlRecordRevision | null;
  seal?: ControlRecordRevision | null;
  evidence?: ControlRecordRevision | null;
  canonicalResult?: ClosureCanonicalResult;
  observationFacts?: ControlJsonObject;
  events?: readonly ControlRecordEvent[];
}>) {
  const events = [...(input.events ?? transactionEvents(input.decision, {
    canonicalResult: input.canonicalResult,
    observationFacts: input.observationFacts,
  }))];
  const revisions = new Map(input.revisions.map((value) => [
    `${value.recordId}\u0000${value.revision}`,
    value,
  ]));
  const state: ReducedDeliveryState = Object.freeze({
    standing: input.operation === "delivery.accept" ? "decision-ready" : "active",
    candidateCondition: input.candidate === undefined || input.candidate === null
      ? "absent"
      : "terminal-recovery",
    activities: Object.freeze([Object.freeze({
      id: ACTIVITY,
      operation: input.operation,
      family: "transaction" as const,
      stage: "effect-observed" as const,
      recovery: Object.freeze({
        kind: "finalization" as const,
        resumesAt: "transaction-finalization" as const,
        exactEffectDigest: null,
      }),
    })]),
    subjects: Object.freeze({
      proposedBoundary: null,
      activeBoundary: reference(input.boundary ?? null),
      candidate: reference(input.candidate ?? null),
      materialCondition: null,
      seal: reference(input.seal ?? null),
      evidence: reference(input.evidence ?? null),
      closure: null,
    }),
    journal: Object.freeze({
      eventCount: events.length,
      headDigest: events.at(-1)?.digest ?? null,
    }),
    eligibleOperations: Object.freeze(["delivery.recover"] as const),
  });
  let appendedRevision: ControlRecordRevision | null = null;
  const store = {
    identity,
    state: () => state,
    listEvents(afterSequence: number, limit: number) {
      return events.filter(({ sequence }) => sequence > afterSequence).slice(0, limit);
    },
    getRevision(recordId: string, selectedRevision: number) {
      return revisions.get(`${recordId}\u0000${selectedRevision}`) ?? null;
    },
    append(value: ControlRecordStoreAppend) {
      appendedRevision = value.revision === undefined
        ? null
        : compileControlRecordRevision(identity.processId, value.revision);
      const prior = events.at(-1) ?? null;
      const event = compileControlRecordEvent({
        storeId: identity.storeId,
        processId: identity.processId,
        sequence: (prior?.sequence ?? 0) + 1,
        predecessorDigest: prior?.digest ?? null,
        event: value.event,
      });
      events.push(event);
      return Object.freeze({ revision: appendedRevision, event });
    },
  } as unknown as ControlRecordStore;
  return Object.freeze({ store, events, appended: () => appendedRevision });
}

function acceptedFixture() {
  const candidatePayload = validDeliveryControlPayload("candidate-revision");
  const boundary = revision({
    id: "boundary-one",
    kind: "work-boundary",
    payload: Object.freeze({
      basis: Object.freeze({
        productBaseCommit: "0".repeat(40),
        productBaseTree: "0".repeat(40),
      }),
    }),
  });
  const candidate = revision({
    id: "candidate-one",
    kind: "candidate-revision",
    payload: Object.freeze({
      ...candidatePayload,
      candidateBaseCommit: "0".repeat(40),
      state: Object.freeze({
        ...(candidatePayload.state as ControlJsonObject),
        tree: "1".repeat(40),
        candidateDigest: digest("candidate"),
        productStateDigest: digest("product-state"),
        knowledgeSetDigest: digest("knowledge-set"),
      }),
    }),
  });
  const seal = revision({ id: "seal-one", kind: "candidate-seal" });
  const evidence = revision({ id: "evidence-one", kind: "evidence-packet" });
  const decision = revision({
    id: "decision-accept",
    kind: "founder-decision",
    payload: { decision: "accept" },
    relationships: [
      relationship("selects-boundary", boundary),
      relationship("selects-candidate", candidate),
      relationship("selects-seal", seal),
      relationship("selects-evidence", evidence),
    ],
  });
  const canonical: ClosureCanonicalResult = Object.freeze({
    parentCommit: "0".repeat(40),
    parentTree: "0".repeat(40),
    commit: "2".repeat(40),
    tree: "1".repeat(40),
    candidateDigest: digest("candidate"),
    productStateDigest: digest("product-state"),
    knowledgeSetDigest: digest("knowledge-set"),
  });
  return Object.freeze({ boundary, candidate, seal, evidence, decision, canonical });
}

const runtime = Object.freeze({
  implementationId: "runtime.delivery-closure",
  implementationDigest: digest("closure-runtime"),
  ruleSetId: "rules.delivery-closure",
  ruleSetDigest: digest("closure-rules"),
});

const terminalExecutions = Object.freeze({
  terminalExecutionSetDigest: digest("terminal-execution-set"),
  executionCount: 2,
  containment: Object.freeze({
    classification: "complete" as const,
    factsDigest: digest("terminal-containment"),
  }),
  retirement: Object.freeze({
    classification: "complete" as const,
    factsDigest: digest("terminal-retirement"),
  }),
});

const reclamationHandoff = Object.freeze({
  obligationSetDigest: digest("terminal-reclamation-obligations"),
  obligationCount: 2,
});

const terminalFacts = Object.freeze({ terminalExecutions, reclamationHandoff });

test("Closure refuses fewer Reclamation obligations than terminal executions", () => {
  const decision = revision({
    id: "decision-no-ship-count-mismatch",
    kind: "founder-decision",
    payload: { decision: "no-ship" },
  });
  const store = fakeStore({
    operation: "delivery.no-ship",
    revisions: [decision],
    decision,
  });
  assert.throws(() => retainClosure({
    store: store.store,
    activityId: ACTIVITY,
    canonicalResult: null,
    terminalExecutions,
    reclamationHandoff: Object.freeze({
      ...reclamationHandoff,
      obligationCount: terminalExecutions.executionCount - 1,
    }),
    runtime,
    terminalAt: CLOSED,
    runtimeId: RUNTIME,
  }), /exactly one Reclamation obligation per terminal execution and pre-intent refusal/u);
});

test("Closure permits an additional obligation for an undispatched pre-intent allocation", () => {
  const decision = revision({
    id: "decision-no-ship-pre-intent-allocation",
    kind: "founder-decision",
    payload: { decision: "no-ship" },
  });
  const store = fakeStore({
    operation: "delivery.no-ship",
    revisions: [decision],
    decision,
    events: transactionEvents(decision, {
      preIntentRefusalActivityIds: ["activity-pre-intent-refused"],
    }),
  });
  const retained = retainClosure({
    store: store.store,
    activityId: ACTIVITY,
    canonicalResult: null,
    terminalExecutions,
    reclamationHandoff: Object.freeze({
      ...reclamationHandoff,
      obligationCount: terminalExecutions.executionCount + 1,
    }),
    runtime,
    terminalAt: CLOSED,
    runtimeId: RUNTIME,
  });
  assert.equal(
    (retained.revision.payload.reclamationHandoff as ControlJsonObject).obligationCount,
    terminalExecutions.executionCount + 1,
  );
});

test("Closure refuses an unexplained extra Reclamation obligation", () => {
  const decision = revision({
    id: "decision-no-ship-unexplained-reclamation",
    kind: "founder-decision",
    payload: { decision: "no-ship" },
  });
  const store = fakeStore({
    operation: "delivery.no-ship",
    revisions: [decision],
    decision,
  });
  assert.throws(() => retainClosure({
    store: store.store,
    activityId: ACTIVITY,
    canonicalResult: null,
    terminalExecutions,
    reclamationHandoff: Object.freeze({
      ...reclamationHandoff,
      obligationCount: terminalExecutions.executionCount + 1,
    }),
    runtime,
    terminalAt: CLOSED,
    runtimeId: RUNTIME,
  }), /exactly one Reclamation obligation per terminal execution and pre-intent refusal/u);
});

test("Closure derives exact acceptance authority, subjects, result, and terminal execution facts", () => {
  const fixture = acceptedFixture();
  const store = fakeStore({
    operation: "delivery.accept",
    revisions: [fixture.boundary, fixture.candidate, fixture.seal, fixture.evidence, fixture.decision],
    decision: fixture.decision,
    boundary: fixture.boundary,
    candidate: fixture.candidate,
    seal: fixture.seal,
    evidence: fixture.evidence,
    canonicalResult: fixture.canonical,
  });
  const retained = retainClosure({
    store: store.store,
    activityId: ACTIVITY,
    canonicalResult: fixture.canonical,
    ...terminalFacts,
    runtime,
    terminalAt: CLOSED,
    runtimeId: RUNTIME,
  });
  assert.equal(retained.revision.payload.disposition, "accepted");
  assert.equal(retained.revision.payload.candidateTreatment, "integrated");
  assert.equal((retained.revision.payload.canonicalResult as ControlJsonObject).commit, fixture.canonical.commit);
  const transaction = retained.revision.payload.transaction as ControlJsonObject;
  assert.equal(
    transaction.observationFactsSchema,
    "lifecycle.terminal-acceptance-effect-observation.v1",
  );
  assert.equal(transaction.canonicalResultDigest, digestCanonical(fixture.canonical));
  assert.equal(transaction.observationFactsDigest, store.events[2]!.payload.factsDigest);
  assert.deepEqual(retained.revision.payload.terminalExecutions, terminalExecutions);
  assert.deepEqual(retained.revision.payload.reclamationHandoff, reclamationHandoff);
  assert.deepEqual(retained.revision.relationships.map(({ relation }) => relation), [
    "accepts-candidate",
    "accepts-evidence",
    "closes-with",
    "governed-by",
  ]);
  assert.equal(retained.event.eventKind, "closure-recorded");
  assert.equal(store.events.at(-1)?.digest, retained.event.digest);
});

test("Closure supports truthful no-ship before any Boundary or Candidate exists", () => {
  const decision = revision({
    id: "decision-no-ship",
    kind: "founder-decision",
    payload: { decision: "no-ship" },
  });
  const store = fakeStore({
    operation: "delivery.no-ship",
    revisions: [decision],
    decision,
  });
  const retained = retainClosure({
    store: store.store,
    activityId: ACTIVITY,
    canonicalResult: null,
    ...terminalFacts,
    runtime,
    terminalAt: CLOSED,
    runtimeId: RUNTIME,
  });
  assert.equal(retained.revision.payload.disposition, "no-ship");
  assert.equal(retained.revision.payload.candidateTreatment, "not-created");
  assert.equal(retained.revision.payload.nonIntegrationVerified, true);
  const transaction = retained.revision.payload.transaction as ControlJsonObject;
  assert.equal(
    transaction.observationFactsSchema,
    "lifecycle.terminal-repository-effect-observation.v1",
  );
  assert.equal(transaction.canonicalResultDigest, null);
  assert.equal(transaction.observationFactsDigest, store.events[2]!.payload.factsDigest);
  assert.deepEqual(retained.revision.relationships.map(({ relation }) => relation), ["closes-with"]);
});

test("Closure abandons the exact Candidate without claiming physical deletion", () => {
  const boundary = revision({ id: "boundary-no-ship", kind: "work-boundary" });
  const candidate = revision({ id: "candidate-no-ship", kind: "candidate-revision" });
  const decision = revision({
    id: "decision-no-ship-candidate",
    kind: "founder-decision",
    payload: { decision: "no-ship" },
    relationships: [
      relationship("selects-boundary", boundary),
      relationship("selects-candidate", candidate),
    ],
  });
  const input = {
    activityId: ACTIVITY,
    canonicalResult: null,
    runtime,
    terminalAt: CLOSED,
    runtimeId: RUNTIME,
  } as const;

  const store = fakeStore({
    operation: "delivery.no-ship",
    revisions: [boundary, candidate, decision],
    decision,
    boundary,
    candidate,
  });
  const retained = retainClosure({
    ...input,
    store: store.store,
    ...terminalFacts,
  });
  assert.equal(retained.revision.payload.candidateTreatment, "abandoned");
  assert.equal(retained.revision.payload.nonIntegrationVerified, true);
  assert.deepEqual(retained.revision.relationships.map(({ relation }) => relation), [
    "abandons-candidate",
    "closes-with",
    "governed-by",
  ]);
});

test("Closure refuses a canonical result that differs from the exact Candidate Revision", () => {
  const fixture = acceptedFixture();
  const store = fakeStore({
    operation: "delivery.accept",
    revisions: [fixture.boundary, fixture.candidate, fixture.seal, fixture.evidence, fixture.decision],
    decision: fixture.decision,
    boundary: fixture.boundary,
    candidate: fixture.candidate,
    seal: fixture.seal,
    evidence: fixture.evidence,
    canonicalResult: fixture.canonical,
  });
  assert.throws(() => retainClosure({
    store: store.store,
    activityId: ACTIVITY,
    canonicalResult: { ...fixture.canonical, tree: "3".repeat(40) },
    ...terminalFacts,
    runtime,
    terminalAt: CLOSED,
    runtimeId: RUNTIME,
  }), /does not reproduce the exact selected Candidate Revision/u);

  assert.throws(() => retainClosure({
    store: store.store,
    activityId: ACTIVITY,
    canonicalResult: { ...fixture.canonical, parentCommit: "4".repeat(40) },
    ...terminalFacts,
    runtime,
    terminalAt: CLOSED,
    runtimeId: RUNTIME,
  }), /does not reproduce the exact selected Candidate Revision/u);

  assert.throws(() => retainClosure({
    store: store.store,
    activityId: ACTIVITY,
    canonicalResult: { ...fixture.canonical, parentTree: "5".repeat(40) },
    ...terminalFacts,
    runtime,
    terminalAt: CLOSED,
    runtimeId: RUNTIME,
  }), /does not reproduce the exact selected Candidate Revision/u);
});

test("accepted Closure requires exact final acceptance facts bound to its canonical result", () => {
  const fixture = acceptedFixture();
  const common = {
    operation: "delivery.accept" as const,
    revisions: [fixture.boundary, fixture.candidate, fixture.seal, fixture.evidence, fixture.decision],
    decision: fixture.decision,
    boundary: fixture.boundary,
    candidate: fixture.candidate,
    seal: fixture.seal,
    evidence: fixture.evidence,
  };
  const closure = (store: ControlRecordStore) => retainClosure({
    store,
    activityId: ACTIVITY,
    canonicalResult: fixture.canonical,
    ...terminalFacts,
    runtime,
    terminalAt: CLOSED,
    runtimeId: RUNTIME,
  });

  const generic = fakeStore(common);
  assert.throws(
    () => closure(generic.store),
    /Applied acceptance requires its exact canonical-result digest/u,
  );

  const missingDigest = fakeStore({
    ...common,
    observationFacts: Object.freeze({
      schema: "lifecycle.terminal-acceptance-effect-observation.v1",
      ref: "refs/heads/main",
      commit: fixture.canonical.commit,
      tree: fixture.canonical.tree,
      objectFormat: "sha1",
    }),
  });
  assert.throws(
    () => closure(missingDigest.store),
    /must contain exactly canonicalResultDigest/u,
  );

  const mismatched = fakeStore({
    ...common,
    observationFacts: Object.freeze({
      schema: "lifecycle.terminal-acceptance-effect-observation.v1",
      ref: "refs/heads/main",
      commit: fixture.canonical.commit,
      tree: fixture.canonical.tree,
      objectFormat: "sha1",
      canonicalResultDigest: digest("different-canonical-result"),
    }),
  });
  assert.throws(
    () => closure(mismatched.store),
    /differs from the final immutable applied observation/u,
  );
});

test("Closure payload schema preserves the acceptance observation binding", () => {
  const fixture = acceptedFixture();
  const store = fakeStore({
    operation: "delivery.accept",
    revisions: [fixture.boundary, fixture.candidate, fixture.seal, fixture.evidence, fixture.decision],
    decision: fixture.decision,
    boundary: fixture.boundary,
    candidate: fixture.candidate,
    seal: fixture.seal,
    evidence: fixture.evidence,
    canonicalResult: fixture.canonical,
  });
  const retained = retainClosure({
    store: store.store,
    activityId: ACTIVITY,
    canonicalResult: fixture.canonical,
    ...terminalFacts,
    runtime,
    terminalAt: CLOSED,
    runtimeId: RUNTIME,
  }).revision;
  const transaction = retained.payload.transaction as ControlJsonObject;
  for (const invalidTransaction of [
    {
      ...transaction,
      observationFactsSchema: "lifecycle.terminal-repository-effect-observation.v1",
    },
    { ...transaction, canonicalResultDigest: null },
  ]) {
    const invalid = compileControlRecordRevision(identity.processId, {
      recordId: "closure-invalid-observation-binding",
      recordKind: "closure",
      revision: 1,
      producer: retained.producer,
      semanticAuthor: retained.semanticAuthor,
      semanticAuthority: retained.semanticAuthority,
      createdAt: retained.createdAt,
      semanticMarkdown: retained.semanticMarkdown,
      payload: Object.freeze({
        ...retained.payload,
        transaction: Object.freeze(invalidTransaction),
      }),
      relationships: retained.relationships,
    });
    assert.throws(() => assertDeliveryControlRecordPayload(invalid));
  }
});
