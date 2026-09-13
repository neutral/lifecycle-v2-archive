import assert from "node:assert/strict";
import test from "node:test";
import {
  abandonAgentWorkProduct,
  completeDeliveryActivity,
  createDeliveryActivityId,
  intendProviderEffect,
  intendTransactionEffect,
  observeProviderEffect,
  observeTransactionEffect,
  recordDeliveryActivityRecovery,
  startDeliveryActivity,
} from "../../src/foundation/control/activity.js";
import {
  compileControlRecordEvent,
  compileControlRecordRevision,
} from "../../src/foundation/control/model.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import { FoundationError } from "../../src/foundation/error.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlRecordEvent,
  type ControlRecordRevision,
  type ControlRecordStoreAppend,
  type ControlRecordStoreIdentity,
} from "../../src/foundation/control/types.js";
import type { ReducedDeliveryState } from "../../src/foundation/process/delivery-reducer.js";
import type { DeliveryActivity } from "../../src/foundation/process/delivery-state.js";
import { digestCanonical, sha256Bytes } from "../../src/foundation/validation/canonical.js";

const CREATED = "2026-08-29T20:00:00.000Z";
const RUNTIME = "foundation-runtime";
const ACTIVITY = "activity-control-mechanics";

function digest(value: string) {
  return sha256Bytes(value);
}

const identity: ControlRecordStoreIdentity = Object.freeze({
  schema: CONTROL_RECORD_STORE_SCHEMA,
  storeId: "store-control-activity",
  targetId: "target-control-activity",
  processKind: "delivery",
  processId: "delivery-control-activity",
  createdAt: CREATED,
});

function revision(
  kind: "agent-attempt" | "director-decision",
  decision: "admit" | "readmit" | "accept" | "no-ship" = "no-ship",
): ControlRecordRevision {
  return compileControlRecordRevision(identity.processId, {
    recordId: `${kind}-activity-subject`,
    recordKind: kind,
    revision: 1,
    producer: { kind: "runtime", id: RUNTIME },
    semanticAuthor: kind === "director-decision"
      ? { kind: "director", id: "director" }
      : { kind: "runtime", id: RUNTIME },
    semanticAuthority: kind === "director-decision" ? "director-authenticated" : "runtime-derived",
    createdAt: CREATED,
    semanticMarkdown: `# ${kind}\n`,
    payload: kind === "director-decision" ? { decision } : {},
    relationships: [],
  });
}

function journalEvent(input: Readonly<{
  sequence: number;
  predecessor: ControlRecordEvent | null;
  eventKind: string;
  payload: Record<string, string>;
  selected?: ControlRecordRevision | null;
}>): ControlRecordEvent {
  return compileControlRecordEvent({
    storeId: identity.storeId,
    processId: identity.processId,
    sequence: input.sequence,
    predecessorDigest: input.predecessor?.digest ?? null,
    event: {
      eventId: `fixture-event-${input.sequence}`,
      eventKind: input.eventKind,
      occurredAt: CREATED,
      actor: { kind: "runtime", id: RUNTIME },
      subject: input.selected === undefined || input.selected === null
        ? null
        : {
            recordId: input.selected.recordId,
            revision: input.selected.revision,
            digest: input.selected.digest,
          },
      payload: input.payload,
    },
  });
}

function state(input: Readonly<{
  activity?: DeliveryActivity | null;
  eligible?: ReducedDeliveryState["eligibleOperations"];
  head?: ControlRecordEvent | null;
}>): ReducedDeliveryState {
  return Object.freeze({
    standing: "framing",
    candidateCondition: "absent",
    activities: input.activity === undefined || input.activity === null
      ? Object.freeze([])
      : Object.freeze([input.activity]),
    subjects: Object.freeze({
      integrationAssessment: null,
      proposedBoundary: null,
      activeBoundary: null,
      candidate: null,
      materialCondition: null,
      seal: null,
      evidence: null,
      closure: null,
    }),
    delegation: { admission: null, current: null, charged: { operations: 0, agentAttempts: 0, reservedCellWallTimeMs: 0 } },
    journal: Object.freeze({
      eventCount: input.head?.sequence ?? 0,
      headDigest: input.head?.digest ?? null,
    }),
    eligibleOperations: input.eligible ?? Object.freeze(["delivery.recover"]),
  });
}

function fakeStore(input: Readonly<{
  state: ReducedDeliveryState;
  events?: readonly ControlRecordEvent[];
  revisions?: readonly ControlRecordRevision[];
}>) {
  const events = [...(input.events ?? [])];
  const revisions = new Map(
    (input.revisions ?? []).map((value) => [`${value.recordId}\u0000${value.revision}`, value]),
  );
  const store = {
    identity,
    state: () => input.state,
    listEvents(afterSequence: number, limit: number) {
      return events.filter(({ sequence }) => sequence > afterSequence).slice(0, limit);
    },
    getRevision(recordId: string, selectedRevision: number) {
      return revisions.get(`${recordId}\u0000${selectedRevision}`) ?? null;
    },
    append(value: ControlRecordStoreAppend) {
      const previous = events.at(-1) ?? null;
      const event = compileControlRecordEvent({
        storeId: identity.storeId,
        processId: identity.processId,
        sequence: (previous?.sequence ?? 0) + 1,
        predecessorDigest: previous?.digest ?? null,
        event: value.event,
      });
      events.push(event);
      return Object.freeze({ revision: null, event });
    },
  } as unknown as ControlRecordStore;
  return Object.freeze({ store, events });
}

function deliveryActivity(input: Partial<DeliveryActivity> & Pick<DeliveryActivity, "family" | "stage">): DeliveryActivity {
  return Object.freeze({
    id: ACTIVITY,
    operation: input.family === "agent" ? "delivery.prepare" : "delivery.no-ship",
    recovery: null,
    ...input,
  });
}

test("activity opening has one fresh runtime identity and deterministic event mechanics", () => {
  const firstId = createDeliveryActivityId("delivery.no-ship");
  const secondId = createDeliveryActivityId("delivery.no-ship");
  assert.match(firstId, /^activity-no-ship-[a-f0-9-]{36}$/u);
  assert.notEqual(firstId, secondId);
  const store = fakeStore({
    state: state({ eligible: Object.freeze(["delivery.no-ship"]) }),
  });
  const event = startDeliveryActivity({
    store: store.store,
    activityId: ACTIVITY,
    operation: "delivery.no-ship",
    startedAt: CREATED,
    runtimeId: RUNTIME,
  });
  assert.equal(event.eventKind, "activity-started");
  assert.deepEqual(event.payload, { activityId: ACTIVITY, operation: "delivery.no-ship" });
  assert.match(event.eventId, /^event-activity-started-[a-f0-9]{64}$/u);
});

test("standalone activity opening refuses an Agent operation", () => {
  const store = fakeStore({
    state: state({ eligible: Object.freeze(["delivery.prepare"]) }),
  });
  assert.throws(() => startDeliveryActivity({
    store: store.store,
    activityId: ACTIVITY,
    operation: "delivery.prepare",
    startedAt: CREATED,
    runtimeId: RUNTIME,
  }), /Brief and activity opening atomically/u);
});

test("provider mechanics derive the exact Attempt subject and recovery coordinate", () => {
  const attempt = revision("agent-attempt");
  const prepared = journalEvent({
    sequence: 1,
    predecessor: null,
    eventKind: "agent-attempt-prepared",
    payload: { activityId: ACTIVITY },
    selected: attempt,
  });
  const effect = digest("provider-effect");
  const intentStore = fakeStore({
    state: state({
      activity: deliveryActivity({ family: "agent", stage: "prepared" }),
      head: prepared,
    }),
    events: [prepared],
    revisions: [attempt],
  });
  const intended = intendProviderEffect({
    store: intentStore.store,
    activityId: ACTIVITY,
    effectDigest: effect,
    intendedAt: CREATED,
    runtimeId: RUNTIME,
  });
  assert.deepEqual(intended.subject, {
    recordId: attempt.recordId,
    revision: attempt.revision,
    digest: attempt.digest,
  });

  const observationStore = fakeStore({
    state: state({
      activity: deliveryActivity({
        family: "agent",
        stage: "effect-intended",
        recovery: { kind: "provider", resumesAt: "provider-effect-observed", exactEffectDigest: effect },
      }),
      head: intended,
    }),
    events: [prepared, intended],
    revisions: [attempt],
  });
  const observed = observeProviderEffect({
    store: observationStore.store,
    activityId: ACTIVITY,
    effectDigest: effect,
    outcome: "completed",
    observedAt: CREATED,
    runtimeId: RUNTIME,
  });
  assert.equal(observed.eventKind, "provider-effect-observed");
  assert.equal(observed.subject?.recordId, attempt.recordId);

  const abandonStore = fakeStore({
    state: state({
      activity: deliveryActivity({
        family: "agent",
        stage: "effect-observed",
        recovery: { kind: "finalization", resumesAt: "work-product-observation", exactEffectDigest: effect },
      }),
      head: observed,
    }),
    events: [prepared, intended, observed],
    revisions: [attempt],
  });
  const abandoned = abandonAgentWorkProduct({
    store: abandonStore.store,
    activityId: ACTIVITY,
    abandonedAt: CREATED,
    runtimeId: RUNTIME,
  });
  assert.equal(abandoned.eventKind, "agent-work-product-abandoned");
  assert.equal(abandoned.subject?.digest, attempt.digest);
});

test("transaction mechanics retain exact authority and allow determinate recovery after uncertainty", () => {
  const decision = revision("director-decision");
  const authenticated = journalEvent({
    sequence: 1,
    predecessor: null,
    eventKind: "director-decision-authenticated",
    payload: { activityId: ACTIVITY },
    selected: decision,
  });
  const effect = digest("transaction-effect");
  const intentStore = fakeStore({
    state: state({
      activity: deliveryActivity({ family: "transaction", stage: "started" }),
      head: authenticated,
    }),
    events: [authenticated],
    revisions: [decision],
  });
  const intended = intendTransactionEffect({
    store: intentStore.store,
    activityId: ACTIVITY,
    effectDigest: effect,
    intendedAt: CREATED,
    runtimeId: RUNTIME,
  });
  const recovery = Object.freeze({
    kind: "transaction" as const,
    resumesAt: "transaction-effect-observed" as const,
    exactEffectDigest: effect,
  });
  const observeStore = fakeStore({
    state: state({
      activity: deliveryActivity({ family: "transaction", stage: "effect-intended", recovery }),
      head: intended,
    }),
    events: [authenticated, intended],
    revisions: [decision],
  });
  const indeterminate = observeTransactionEffect({
    store: observeStore.store,
    activityId: ACTIVITY,
    effectDigest: effect,
    outcome: "indeterminate",
    facts: Object.freeze({
      schema: "lifecycle.terminal-effect-failure.v1",
      stage: "no-ship-non-integration",
      code: "observation-unavailable",
    }),
    observedAt: CREATED,
    runtimeId: RUNTIME,
  });
  assert.equal(indeterminate.subject?.recordId, decision.recordId);
  assert.equal(indeterminate.payload.outcome, "indeterminate");
  assert.equal(indeterminate.payload.factsDigest, digestCanonical(indeterminate.payload.facts));

  const recoveryStore = fakeStore({
    state: state({
      activity: deliveryActivity({ family: "transaction", stage: "effect-intended", recovery }),
      head: indeterminate,
    }),
    events: [authenticated, intended, indeterminate],
    revisions: [decision],
  });
  const recoveryEvent = recordDeliveryActivityRecovery({
    store: recoveryStore.store,
    activityId: ACTIVITY,
    recordedAt: CREATED,
    runtimeId: RUNTIME,
  });
  assert.deepEqual(recoveryEvent.payload, {
    activityId: ACTIVITY,
    kind: "transaction",
    resumesAt: "transaction-effect-observed",
    exactEffectDigest: effect,
  });
  assert.equal(recordDeliveryActivityRecovery({
    store: recoveryStore.store,
    activityId: ACTIVITY,
    recordedAt: CREATED,
    runtimeId: RUNTIME,
  }), recoveryEvent);
});

test("the transaction compiler rejects retired physical Candidate facts", () => {
  const decision = revision("director-decision", "admit");
  const authenticated = journalEvent({
    sequence: 1,
    predecessor: null,
    eventKind: "director-decision-authenticated",
    payload: { activityId: ACTIVITY },
    selected: decision,
  });
  const effect = digest("forged-initial-admission-effect");
  const intended = journalEvent({
    sequence: 2,
    predecessor: authenticated,
    eventKind: "transaction-effect-intended",
    payload: { activityId: ACTIVITY, effectDigest: effect },
    selected: decision,
  });
  const store = fakeStore({
    state: state({
      activity: deliveryActivity({
        operation: "delivery.admit",
        family: "transaction",
        stage: "effect-intended",
        recovery: {
          kind: "transaction",
          resumesAt: "transaction-effect-observed",
          exactEffectDigest: effect,
        },
      }),
      head: intended,
    }),
    events: [authenticated, intended],
    revisions: [decision],
  });
  assert.throws(() => observeTransactionEffect({
    store: store.store,
    activityId: ACTIVITY,
    effectDigest: effect,
    outcome: "applied",
    facts: Object.freeze({
      schema: "lifecycle.admission-effect-observation-facts.v2",
      outcome: "applied",
      disposition: null,
      repositoryBasisDigest: digest("forged-initial-admission-basis"),
      candidateCustody: Object.freeze({
        candidateId: "candidate-forged-initial-admission",
        targetId: identity.targetId,
        deliveryId: identity.processId,
        baseCommit: "a".repeat(40),
        physicalIdentityDigest: digest("forged-initial-admission-custody"),
      }),
      candidateFailure: null,
    }),
    observedAt: CREATED,
    runtimeId: RUNTIME,
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.transaction-observation-facts-v7.shape");
});

test("activity completion only emits the exact reducer-selected final milestone", () => {
  const store = fakeStore({
    state: state({
      activity: deliveryActivity({
        family: "agent",
        stage: "finalizing",
        recovery: { kind: "finalization", resumesAt: "activity-completed", exactEffectDigest: null },
      }),
    }),
  });
  const event = completeDeliveryActivity({
    store: store.store,
    activityId: ACTIVITY,
    outcome: "failed",
    completedAt: CREATED,
    runtimeId: RUNTIME,
  });
  assert.equal(event.eventKind, "activity-completed");
  assert.deepEqual(event.payload, { activityId: ACTIVITY, outcome: "failed" });
});

test("deterministic Work Boundary refusal can complete an agent activity unsuccessfully", () => {
  const store = fakeStore({
    state: state({
      activity: deliveryActivity({
        family: "agent",
        stage: "finalizing",
        recovery: { kind: "finalization", resumesAt: "work-boundary-finalized", exactEffectDigest: null },
      }),
    }),
  });
  const event = completeDeliveryActivity({
    store: store.store,
    activityId: ACTIVITY,
    outcome: "failed",
    completedAt: CREATED,
    runtimeId: RUNTIME,
  });
  assert.deepEqual(event.payload, { activityId: ACTIVITY, outcome: "failed" });

  assert.throws(() => completeDeliveryActivity({
    store: store.store,
    activityId: ACTIVITY,
    outcome: "completed",
    completedAt: CREATED,
    runtimeId: RUNTIME,
  }), /exact reducer-derived finalization coordinate/u);
});
