import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  FOUNDATION_ACTIVITY_KERNEL_V7_SUPPORT_KIND,
  advanceFoundationActivityKernelTransactionEffectV7,
  advanceFoundationActivityKernelV7,
  createFoundationActivityKernelCheckpointAdapterV7,
  finishFoundationActivityKernelV7,
  finishFoundationTerminalActivityKernelV7,
  openFoundationActivityKernelV7,
  readFoundationActivityKernelV7,
  recoverFoundationActivityKernelV7,
  type FoundationActivityKernelStandardDefinitionV7,
  type FoundationActivityKernelTerminalDefinitionV7,
} from "../../src/foundation/process/activity-kernel-v7.js";
import {
  compileControlRecordEvent,
  compileControlRecordRevision,
} from "../../src/foundation/control/model.js";
import {
  openControlRecordStore,
  type ControlRecordStore,
} from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_FILE_SCHEMA,
  CONTROL_RECORD_OPERATION_SUPPORT_SCHEMA,
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlJsonObject,
  type ControlRecordEvent,
  type ControlRecordFile,
  type ControlRecordOperationSupport,
  type ControlRecordOperationSupportCoordinate,
  type ControlRecordOperationSupportMutation,
  type ControlRecordStoreAppend,
  type ControlRecordStoreIdentity,
  type ControlRecordStoreOperationBatch,
  type ControlRecordStoreOperationBatchResult,
  type ControlRecordStoreOperationBatchWithFiles,
  type ControlRecordStoreOperationBatchWithFilesResult,
  type ControlRecordRevisionInput,
  type ControlRecordRevision,
} from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import type { ReducedDeliveryState } from "../../src/foundation/process/delivery-reducer.js";
import type {
  DeliveryActivity,
  DeliveryRecoveryObligation,
} from "../../src/foundation/process/delivery-state.js";
import {
  FOUNDATION_TERMINAL_REPOSITORY_OBSERVATION_FACTS_V1,
  type FoundationTerminalRepositoryObservationFactsV1,
} from "../../src/foundation/process/transaction-observation-facts-v7.js";
import {
  canonicalJson,
  digestCanonical,
  sha256Bytes,
} from "../../src/foundation/validation/canonical.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

const CREATED = "2026-08-29T20:00:00.000Z";
const COMPLETED = "2026-08-29T20:00:10.000Z";
const ACTIVITY = "activity-kernel-v7";
const RUNTIME = "foundation-runtime";

function terminalFacts(seed: string): FoundationTerminalRepositoryObservationFactsV1 {
  return Object.freeze({
    schema: FOUNDATION_TERMINAL_REPOSITORY_OBSERVATION_FACTS_V1,
    ref: `refs/heads/${seed}`,
    commit: "a".repeat(40),
    tree: "b".repeat(40),
    objectFormat: "sha1",
  });
}

const identity: ControlRecordStoreIdentity = Object.freeze({
  schema: CONTROL_RECORD_STORE_SCHEMA,
  storeId: "store-activity-kernel-v7",
  targetId: "target-activity-kernel-v7",
  processKind: "delivery",
  processId: "delivery-activity-kernel-v7",
  createdAt: CREATED,
});

const standardDefinition: FoundationActivityKernelStandardDefinitionV7 = Object.freeze({
  id: "foundation.continue.activity.v1",
  digest: sha256Bytes("foundation.continue.activity.v1"),
  operation: "delivery.continue",
  terminal: false,
  parsePlan(value) {
    if (value.schema !== "example.plan.v1") throw new Error("invalid plan");
    return value;
  },
  parseCheckpoint(value) {
    if (value.schema !== "example.checkpoint.v1") throw new Error("invalid checkpoint");
    return value;
  },
});

const terminalDefinition: FoundationActivityKernelTerminalDefinitionV7 = Object.freeze({
  id: "foundation.no-ship.activity.v1",
  digest: sha256Bytes("foundation.no-ship.activity.v1"),
  operation: "delivery.no-ship",
  terminal: true,
  parsePlan(value) {
    if (value.schema !== "example.terminal-plan.v1") throw new Error("invalid terminal plan");
    return value;
  },
  parseCheckpoint(value) {
    if (value.schema !== "example.checkpoint.v1") throw new Error("invalid checkpoint");
    return value;
  },
});

const prepareDefinition: FoundationActivityKernelStandardDefinitionV7 = Object.freeze({
  id: "foundation.prepare.activity.v1",
  digest: sha256Bytes("foundation.prepare.activity.v1"),
  operation: "delivery.prepare",
  terminal: false,
  parsePlan(value) {
    if (value.schema !== "example.prepare-plan.v1") throw new Error("invalid plan");
    return value;
  },
  parseCheckpoint(value) {
    if (value.schema !== "example.checkpoint.v1") throw new Error("invalid checkpoint");
    return value;
  },
});

const reviseDefinition: FoundationActivityKernelStandardDefinitionV7 = Object.freeze({
  ...standardDefinition,
  id: "foundation.revise.activity.v1",
  digest: sha256Bytes("foundation.revise.activity.v1"),
  operation: "delivery.revise",
});

function activity(
  operation: DeliveryActivity["operation"],
  recovery: DeliveryRecoveryObligation,
): DeliveryActivity {
  return Object.freeze({
    id: ACTIVITY,
    operation,
    family: operation === "delivery.no-ship" ? "transaction" : "agent",
    stage: "started",
    recovery,
  });
}

function recovery(
  kind: DeliveryRecoveryObligation["kind"],
  resumesAt: DeliveryRecoveryObligation["resumesAt"],
): DeliveryRecoveryObligation {
  return Object.freeze({ kind, resumesAt, exactEffectDigest: null });
}

function operationCoordinate(
  support: ControlRecordOperationSupport,
): ControlRecordOperationSupportCoordinate {
  return Object.freeze({
    generation: support.generation,
    payloadDigest: support.payloadDigest,
  });
}

type FakeStore = Readonly<{
  store: ControlRecordStore;
  calls: string[];
  setActivity(value: DeliveryActivity): void;
  failNextDelete(): void;
}>;

function fakeStore(): FakeStore {
  const calls: string[] = [];
  const events: ControlRecordEvent[] = [];
  const revisions = new Map<string, ControlRecordRevision>();
  let selectedActivity: DeliveryActivity | null = null;
  let support: ControlRecordOperationSupport | null = null;
  let shouldFailDelete = false;

  function state(): ReducedDeliveryState {
    const head = events.at(-1) ?? null;
    return Object.freeze({
      standing: "active" as const,
      candidateCondition: "terminal-recovery" as const,
      activities: selectedActivity === null
        ? Object.freeze([])
        : Object.freeze([selectedActivity]),
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
        eventCount: head?.sequence ?? 0,
        headDigest: head?.digest ?? null,
      }),
      eligibleOperations: Object.freeze(["delivery.recover"] as const),
    });
  }

  function retainedSupport(
    activityId: string,
    supportKind: string,
    payload: ControlJsonObject,
    expected: ControlRecordOperationSupportCoordinate | null,
  ): ControlRecordOperationSupport {
    if (activityId !== ACTIVITY) throw new Error("unexpected activity");
    if (expected === null) {
      if (support !== null) throw new Error("support exists");
    } else {
      assert(support !== null);
      assert.deepEqual(operationCoordinate(support), expected);
    }
    support = Object.freeze({
      schema: CONTROL_RECORD_OPERATION_SUPPORT_SCHEMA,
      storeId: identity.storeId,
      processId: identity.processId,
      activityId,
      supportKind,
      generation: expected === null ? 1 : expected.generation + 1,
      payload,
      payloadDigest: sha256Bytes(canonicalJson(payload)),
    });
    return support;
  }

  function applyEvent(append: ControlRecordStoreAppend): ControlRecordEvent {
    const prior = events.at(-1) ?? null;
    const event = compileControlRecordEvent({
      storeId: identity.storeId,
      processId: identity.processId,
      sequence: (prior?.sequence ?? 0) + 1,
      predecessorDigest: prior?.digest ?? null,
      event: append.event,
    });
    events.push(event);
    if (event.eventKind === "activity-started") {
      const operation = event.payload.operation as DeliveryActivity["operation"];
      selectedActivity = activity(
        operation,
        recovery(
          "finalization",
          operation === "delivery.no-ship"
            ? "director-decision-authenticated"
            : "agent-attempt-prepared",
        ),
      );
    } else if (event.eventKind === "director-decision-authenticated") {
      assert(selectedActivity !== null);
      selectedActivity = Object.freeze({
        ...selectedActivity,
        recovery: recovery("finalization", "transaction-effect-intended"),
      });
    } else if (event.eventKind === "transaction-effect-intended") {
      assert(selectedActivity !== null);
      selectedActivity = Object.freeze({
        ...selectedActivity,
        stage: "effect-intended",
        recovery: Object.freeze({
          kind: "transaction" as const,
          resumesAt: "transaction-effect-observed" as const,
          exactEffectDigest: event.payload.effectDigest as ReturnType<typeof sha256Bytes>,
        }),
      });
    } else if (event.eventKind === "transaction-effect-observed") {
      assert(selectedActivity !== null);
      selectedActivity = event.payload.outcome === "indeterminate"
        ? selectedActivity
        : Object.freeze({
            ...selectedActivity,
            stage: event.payload.outcome === "applied" ? "effect-observed" : "finalizing",
            recovery: recovery(
              "finalization",
              event.payload.outcome === "applied"
                ? "transaction-finalization"
                : "activity-completed",
            ),
          });
    } else if (event.eventKind === "agent-attempt-prepared") {
      assert(selectedActivity !== null);
      selectedActivity = Object.freeze({
        ...selectedActivity,
        stage: "prepared",
        recovery: recovery("finalization", "provider-effect-intended"),
      });
    } else if (event.eventKind === "provider-effect-intended") {
      assert(selectedActivity !== null);
      selectedActivity = Object.freeze({
        ...selectedActivity,
        stage: "effect-intended",
        recovery: Object.freeze({
          kind: "provider",
          resumesAt: "provider-effect-observed",
          exactEffectDigest: event.payload.effectDigest as ReturnType<typeof sha256Bytes>,
        }),
      });
    } else if (event.eventKind === "activity-completed" || event.eventKind === "closure-recorded") {
      assert(selectedActivity !== null);
      selectedActivity = Object.freeze({
        ...selectedActivity,
        stage: "completed",
        recovery: null,
      });
    }
    return event;
  }

  function applyMutation(mutation: ControlRecordOperationSupportMutation) {
    if (mutation.action === "put") {
      const value = retainedSupport(
        mutation.value.activityId,
        mutation.value.supportKind,
        mutation.value.payload,
        mutation.value.expected,
      );
      return Object.freeze({ action: "put" as const, activityId: ACTIVITY, support: value });
    }
    assert(support !== null);
    assert.deepEqual(operationCoordinate(support), mutation.expected);
    support = null;
    return Object.freeze({ action: "delete" as const, activityId: ACTIVITY, support: null });
  }

  function commit(input: ControlRecordStoreOperationBatch): ControlRecordStoreOperationBatchResult {
    calls.push(input.supportMutations[0]?.action === "delete" ? "batch-delete" : "batch-put");
    if (shouldFailDelete && input.supportMutations.some(({ action }) => action === "delete")) {
      shouldFailDelete = false;
      throw new Error("simulated crash before atomic completion");
    }
    const appends = input.appends.map((append) => {
      const revision = append.revision === undefined
        ? null
        : compileControlRecordRevision(identity.processId, append.revision);
      if (revision !== null) {
        revisions.set(`${revision.recordId}\u0000${revision.revision}`, revision);
      }
      return Object.freeze({ revision, event: applyEvent(append) });
    });
    const mutations = input.supportMutations.map(applyMutation);
    return Object.freeze({
      appends: Object.freeze(appends),
      supportMutations: Object.freeze(mutations),
    });
  }

  const store = {
    identity,
    state,
    getOperationSupport(activityId: string) {
      return activityId === ACTIVITY ? support : null;
    },
    putOperationSupport(input: Readonly<{
      activityId: string;
      supportKind: string;
      payload: ControlJsonObject;
      expected: ControlRecordOperationSupportCoordinate | null;
    }>) {
      calls.push("support-only");
      return retainedSupport(
        input.activityId,
        input.supportKind,
        input.payload,
        input.expected,
      );
    },
    commitOperationBatch: commit,
    async commitOperationBatchWithFiles(
      input: ControlRecordStoreOperationBatchWithFiles,
    ): Promise<ControlRecordStoreOperationBatchWithFilesResult> {
      calls.push("files");
      const result = commit({
        appends: input.appends,
        supportMutations: input.supportMutations,
      });
      const files: readonly ControlRecordFile[] = Object.freeze(input.files.map((file) => Object.freeze({
        schema: CONTROL_RECORD_FILE_SCHEMA,
        digest: sha256Bytes(file.bytes),
        byteLength: file.bytes.byteLength,
        mediaType: file.mediaType,
        purpose: file.purpose,
        createdAt: file.createdAt,
      })));
      return Object.freeze({ ...result, files });
    },
    listEvents(afterSequence = 0, limit = 100) {
      return events.filter(({ sequence }) => sequence > afterSequence).slice(0, limit);
    },
    append(append: ControlRecordStoreAppend) {
      const revision = append.revision === undefined
        ? null
        : compileControlRecordRevision(identity.processId, append.revision);
      if (revision !== null) {
        revisions.set(`${revision.recordId}\u0000${revision.revision}`, revision);
      }
      return Object.freeze({ revision, event: applyEvent(append) });
    },
    getRevision(recordId: string, revision: number) {
      return revisions.get(`${recordId}\u0000${revision}`) ?? null;
    },
  } as unknown as ControlRecordStore;

  return Object.freeze({
    store,
    calls,
    setActivity(value: DeliveryActivity) {
      selectedActivity = value;
    },
    failNextDelete() {
      shouldFailDelete = true;
    },
  });
}

function eventAppend(
  eventKind: string,
  payload: ControlJsonObject,
  occurredAt = CREATED,
): ControlRecordStoreAppend {
  return Object.freeze({
    event: Object.freeze({
      eventId: `event-${eventKind}-${digestCanonical(payload).slice("sha256:".length)}`,
      eventKind,
      occurredAt,
      actor: Object.freeze({ kind: "runtime" as const, id: RUNTIME }),
      payload,
    }),
  });
}

function openingAppend(operation: DeliveryActivity["operation"]): ControlRecordStoreAppend {
  return eventAppend("activity-started", Object.freeze({ activityId: ACTIVITY, operation }));
}

function openStandard(selected: FakeStore) {
  return openFoundationActivityKernelV7({
    store: selected.store,
    activityId: ACTIVITY,
    definition: standardDefinition,
    plan: Object.freeze({ schema: "example.plan.v1", subjectDigest: sha256Bytes("subject") }),
    appends: Object.freeze([openingAppend("delivery.continue")]),
  });
}

function openTransaction(selected: FakeStore) {
  openFoundationActivityKernelV7({
    store: selected.store,
    activityId: ACTIVITY,
    definition: terminalDefinition,
    plan: Object.freeze({ schema: "example.terminal-plan.v1", disposition: "no-ship" }),
    checkpoint: Object.freeze({ schema: "example.checkpoint.v1", attempt: 0 }),
    appends: Object.freeze([openingAppend("delivery.no-ship")]),
  });
  const decisionInput: ControlRecordRevisionInput = Object.freeze({
    recordId: "decision-activity-kernel-v7",
    recordKind: "director-decision",
    revision: 1,
    producer: Object.freeze({ kind: "runtime", id: RUNTIME }),
    semanticAuthor: Object.freeze({ kind: "director", id: "director" }),
    semanticAuthority: "director-authenticated",
    createdAt: CREATED,
    semanticMarkdown: "# Director Decision\n\nDo not ship this Delivery.\n",
    payload: validDeliveryControlPayload("director-decision"),
  });
  const decision = compileControlRecordRevision(identity.processId, decisionInput);
  selected.store.append(Object.freeze({
    revision: decisionInput,
    event: Object.freeze({
      eventId: "event-director-decision-activity-kernel-v7",
      eventKind: "director-decision-authenticated",
      occurredAt: CREATED,
      actor: Object.freeze({ kind: "runtime" as const, id: RUNTIME }),
      subject: Object.freeze({
        recordId: decision.recordId,
        revision: decision.revision,
        digest: decision.digest,
      }),
      payload: Object.freeze({ activityId: ACTIVITY }),
    }),
  }));
  return readFoundationActivityKernelV7({
    store: selected.store,
    activityId: ACTIVITY,
    definition: terminalDefinition,
  });
}

function transactionAdapter(selected: FakeStore) {
  return createFoundationActivityKernelCheckpointAdapterV7({
    store: selected.store,
    activityId: ACTIVITY,
    definition: terminalDefinition,
  });
}

test("the kernel opens one closed stage-free envelope atomically", () => {
  const selected = fakeStore();
  const opened = openStandard(selected);
  assert.deepEqual(selected.calls, ["batch-put"]);
  assert.equal(opened.support.supportKind, FOUNDATION_ACTIVITY_KERNEL_V7_SUPPORT_KIND);
  assert.equal(opened.recovery.resumesAt, "agent-attempt-prepared");
  assert.equal(opened.envelope.plan.digest, digestCanonical(opened.envelope.plan.value));
  assert.equal("stage" in opened.support.payload, false);
  assert.equal("recovery" in opened.support.payload, false);
  assert.deepEqual(Object.keys(opened.support.payload).sort(), [
    "activityId",
    "checkpoint",
    "completion",
    "definition",
    "operation",
    "plan",
    "schema",
  ]);
});

test("a real Control Store commits opening facts and support in one reducer-valid batch", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "lifecycle-activity-kernel-v7-"));
  try {
    const selectedIdentity = Object.freeze({
      ...identity,
      storeId: "store-activity-kernel-v7-integration",
      processId: "delivery-activity-kernel-v7-integration",
    });
    const store = await openControlRecordStore({
      root: join(workspace, "store"),
      identity: selectedIdentity,
      create: true,
    });
    store.append({
      event: {
        eventId: "event-delivery-created-activity-kernel-v7",
        eventKind: "delivery-created",
        occurredAt: CREATED,
        actor: { kind: "runtime", id: RUNTIME },
        payload: {},
      },
    });
    const briefInput: ControlRecordRevisionInput = Object.freeze({
      recordId: "brief-activity-kernel-v7",
      recordKind: "director-brief",
      revision: 1,
      producer: Object.freeze({ kind: "runtime", id: RUNTIME }),
      semanticAuthor: Object.freeze({ kind: "director", id: "director" }),
      semanticAuthority: "director-supplied",
      createdAt: "2026-08-29T20:00:01.000Z",
      semanticMarkdown: "# Director Brief\n\nOpen one kernel-owned preparation activity.\n",
      payload: { ...validDeliveryControlPayload("director-brief"), scope: { kind: "activity", activityId: ACTIVITY } },
    });
    const brief = compileControlRecordRevision(store.identity.processId, briefInput);
    const opened = openFoundationActivityKernelV7({
      store,
      activityId: ACTIVITY,
      definition: prepareDefinition,
      plan: Object.freeze({
        schema: "example.prepare-plan.v1",
        repositoryEpochDigest: sha256Bytes("repository-epoch"),
      }),
      appends: Object.freeze([Object.freeze({
        revision: briefInput,
        event: Object.freeze({
          eventId: "event-director-brief-activity-kernel-v7",
          eventKind: "director-brief-submitted",
          occurredAt: briefInput.createdAt,
          actor: Object.freeze({ kind: "runtime" as const, id: RUNTIME }),
          subject: Object.freeze({
            recordId: brief.recordId,
            revision: brief.revision,
            digest: brief.digest,
          }),
          payload: Object.freeze({ activityId: ACTIVITY }),
        }),
      }), Object.freeze({
        event: Object.freeze({
          eventId: "event-activity-started-activity-kernel-v7",
          eventKind: "activity-started",
          occurredAt: "2026-08-29T20:00:02.000Z",
          actor: Object.freeze({ kind: "runtime" as const, id: RUNTIME }),
          payload: Object.freeze({
            activityId: ACTIVITY,
            operation: "delivery.prepare",
          }),
        }),
      })]),
    });
    assert.equal(opened.recovery.resumesAt, "agent-attempt-prepared");
    assert.equal(store.listEvents().length, 3);
    assert.equal(store.getOperationSupport(ACTIVITY)?.generation, 1);
    store.close();
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("definitions validate durable plans without normalization or physical custody", () => {
  const selected = fakeStore();
  assert.throws(() => openFoundationActivityKernelV7({
    store: selected.store,
    activityId: ACTIVITY,
    definition: standardDefinition,
    plan: Object.freeze({ schema: "example.plan.v1", workspaceRoot: "/private/runtime" }),
    appends: Object.freeze([openingAppend("delivery.continue")]),
  }), /machine-local physical custody/u);

  const rewriting = Object.freeze({
    ...standardDefinition,
    parsePlan() {
      return Object.freeze({ schema: "example.plan.v1", rewritten: true });
    },
  });
  assert.throws(() => openFoundationActivityKernelV7({
    store: selected.store,
    activityId: ACTIVITY,
    definition: rewriting,
    plan: Object.freeze({ schema: "example.plan.v1", original: true }),
    appends: Object.freeze([openingAppend("delivery.continue")]),
  }), /validate without rewriting/u);
});

test("every access rejects definition and reducer substitution", () => {
  const selected = fakeStore();
  openStandard(selected);
  const substituted = Object.freeze({
    ...standardDefinition,
    digest: sha256Bytes("substituted-definition"),
  });
  assert.throws(() => readFoundationActivityKernelV7({
    store: selected.store,
    activityId: ACTIVITY,
    definition: substituted,
  }), /exact selected definition/u);
  selected.setActivity(Object.freeze({
    ...activity("delivery.continue", recovery("finalization", "agent-attempt-prepared")),
    operation: "delivery.evaluate",
  }));
  assert.throws(() => readFoundationActivityKernelV7({
    store: selected.store,
    activityId: ACTIVITY,
    definition: standardDefinition,
  }), /exact reducer operation or recovery/u);
});

test("one checkpoint adapter selects support, append, and file-bound commits", async () => {
  const selected = fakeStore();
  const opened = openStandard(selected);
  const adapter = createFoundationActivityKernelCheckpointAdapterV7({
    store: selected.store,
    activityId: ACTIVITY,
    definition: standardDefinition,
  });
  const supportOnly = adapter.commit({
    mode: "support-only",
    expected: opened.coordinate,
    checkpoint: Object.freeze({ schema: "example.checkpoint.v1", fact: "planned" }),
  });
  assert.equal(supportOnly.context.coordinate.generation, 2);
  assert.equal(supportOnly.context.envelope.plan.digest, opened.envelope.plan.digest);

  const prepared = adapter.commit({
    mode: "append",
    expected: supportOnly.context.coordinate,
    checkpoint: Object.freeze({ schema: "example.checkpoint.v1", fact: "attempt" }),
    append: eventAppend("agent-attempt-prepared", Object.freeze({ activityId: ACTIVITY })),
  });
  assert.equal(prepared.context.recovery.resumesAt, "provider-effect-intended");

  const effectDigest = sha256Bytes("provider-effect");
  const intended = await adapter.commitWithFiles({
    expected: prepared.context.coordinate,
    checkpoint: Object.freeze({ schema: "example.checkpoint.v1", fact: "intent" }),
    append: eventAppend("provider-effect-intended", Object.freeze({
      activityId: ACTIVITY,
      effectDigest,
    })),
    files: Object.freeze([Object.freeze({
      bytes: new TextEncoder().encode("bounded output\n"),
      mediaType: "text/plain",
      purpose: "check-output",
      createdAt: CREATED,
    })]),
  });
  assert.equal(intended.context.recovery.resumesAt, "provider-effect-observed");
  assert.equal(intended.files.length, 1);
  assert.deepEqual(selected.calls, [
    "batch-put",
    "support-only",
    "batch-put",
    "files",
    "batch-put",
  ]);
});

test("a checkpoint cannot advance by appending another activity's event", () => {
  const selected = fakeStore();
  const opened = openStandard(selected);
  const adapter = createFoundationActivityKernelCheckpointAdapterV7({
    store: selected.store,
    activityId: ACTIVITY,
    definition: standardDefinition,
  });
  assert.throws(() => adapter.commit({
    mode: "append",
    expected: opened.coordinate,
    checkpoint: Object.freeze({ schema: "example.checkpoint.v1", fact: "substituted" }),
    append: eventAppend("agent-attempt-prepared", Object.freeze({
      activityId: "activity-substituted-kernel-v7",
    })),
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.activity-kernel-v7.checkpoint-activity");
  assert.deepEqual(adapter.current().coordinate, opened.coordinate);
});

test("the transaction step atomically binds intent, observation facts, and semantic checkpoint", async () => {
  const selected = fakeStore();
  const opened = openTransaction(selected);
  const adapter = transactionAdapter(selected);
  const effectDigest = sha256Bytes("kernel-transaction-effect");
  const intended = await advanceFoundationActivityKernelTransactionEffectV7({
    store: selected.store,
    context: opened,
    checkpoint: adapter,
    effectDigest,
    runtimeId: RUNTIME,
    sampleIntendedAt: () => "2026-08-29T20:00:01.000Z",
    sampleObservedAt: () => "2026-08-29T20:00:02.000Z",
    async observe() {
      throw new Error("intent must not observe the physical effect");
    },
  });
  assert.equal(intended.status, "continue");
  assert.equal(intended.eventKind, "transaction-effect-intended");
  assert.deepEqual(intended.context.envelope.checkpoint?.value, {
    schema: "example.checkpoint.v1",
    attempt: 0,
  });
  assert.equal(intended.context.coordinate.generation, opened.coordinate.generation + 1);

  const facts = terminalFacts("kernel-observation-facts");
  const factsDigest = digestCanonical(facts);
  const observed = await advanceFoundationActivityKernelTransactionEffectV7({
    store: selected.store,
    context: intended.context,
    checkpoint: adapter,
    effectDigest,
    runtimeId: RUNTIME,
    sampleIntendedAt: () => "2026-08-29T20:00:03.000Z",
    sampleObservedAt: (index) => {
      assert.equal(index, 1);
      return "2026-08-29T20:00:02.000Z";
    },
    async observe({ checkpoint, observationIndex }) {
      assert.deepEqual(checkpoint, { schema: "example.checkpoint.v1", attempt: 0 });
      return Object.freeze({
        outcome: "applied" as const,
        facts,
        checkpoint: Object.freeze({
          schema: "example.checkpoint.v1",
          attempt: observationIndex,
        }),
      });
    },
  });
  assert.equal(observed.status, "continue");
  assert.equal(observed.eventKind, "transaction-effect-observed");
  assert.equal(observed.observation?.factsDigest, factsDigest);
  assert.deepEqual(observed.context.envelope.checkpoint?.value, {
    schema: "example.checkpoint.v1",
    attempt: 1,
  });
  const event = selected.store.listEvents().at(-1)!;
  assert.deepEqual(event.payload, {
    activityId: ACTIVITY,
    effectDigest,
    outcome: "applied",
    facts,
    factsDigest,
  });
  const completedCoordinate = await advanceFoundationActivityKernelTransactionEffectV7({
    store: selected.store,
    context: observed.context,
    checkpoint: adapter,
    effectDigest,
    runtimeId: RUNTIME,
    sampleIntendedAt: () => COMPLETED,
    sampleObservedAt: () => COMPLETED,
    async observe() {
      throw new Error("a determinate observation must not be sampled again");
    },
  });
  assert.equal(completedCoordinate.status, "not-applicable");
  assert.equal(completedCoordinate.outcome, "applied");
});

test("the transaction step defers uncertainty, retries exactly, and enforces substitution and bounds", async () => {
  const selected = fakeStore();
  const opened = openTransaction(selected);
  const adapter = transactionAdapter(selected);
  const effectDigest = sha256Bytes("kernel-retry-effect");
  const intended = await advanceFoundationActivityKernelTransactionEffectV7({
    store: selected.store,
    context: opened,
    checkpoint: adapter,
    effectDigest,
    runtimeId: RUNTIME,
    maximumObservations: 2,
    sampleIntendedAt: () => "2026-08-29T20:00:01.000Z",
    sampleObservedAt: () => "2026-08-29T20:00:02.000Z",
    async observe() {
      throw new Error("intent must not observe");
    },
  });
  assert.equal(intended.status, "continue");
  const firstFacts = terminalFacts("kernel-retry-facts-one");
  const firstFactsDigest = digestCanonical(firstFacts);
  const deferred = await advanceFoundationActivityKernelTransactionEffectV7({
    store: selected.store,
    context: intended.context,
    checkpoint: adapter,
    effectDigest,
    runtimeId: RUNTIME,
    maximumObservations: 2,
    sampleIntendedAt: () => COMPLETED,
    sampleObservedAt: (index) => {
      assert.equal(index, 1);
      return "2026-08-29T20:00:02.000Z";
    },
    async observe() {
      return Object.freeze({
        outcome: "indeterminate" as const,
        facts: firstFacts,
        checkpoint: Object.freeze({ schema: "example.checkpoint.v1", attempt: 1 }),
      });
    },
  });
  assert.equal(deferred.status, "deferred");
  assert.equal(deferred.observation.factsDigest, firstFactsDigest);

  await assert.rejects(advanceFoundationActivityKernelTransactionEffectV7({
    store: selected.store,
    context: deferred.context,
    checkpoint: adapter,
    effectDigest: sha256Bytes("substituted-effect"),
    runtimeId: RUNTIME,
    maximumObservations: 3,
    sampleIntendedAt: () => COMPLETED,
    sampleObservedAt: () => COMPLETED,
    async observe() {
      throw new Error("substitution must fail before physical observation");
    },
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.activity-kernel-v7.transaction-coordinate");

  const secondFacts = terminalFacts("kernel-retry-facts-two");
  const secondFactsDigest = digestCanonical(secondFacts);
  const recovered = await advanceFoundationActivityKernelTransactionEffectV7({
    store: selected.store,
    context: deferred.context,
    checkpoint: adapter,
    effectDigest,
    runtimeId: RUNTIME,
    maximumObservations: 2,
    sampleIntendedAt: () => COMPLETED,
    sampleObservedAt: (index) => {
      assert.equal(index, 2);
      return "2026-08-29T20:00:03.000Z";
    },
    async observe() {
      return Object.freeze({
        outcome: "applied" as const,
        facts: secondFacts,
        checkpoint: Object.freeze({ schema: "example.checkpoint.v1", attempt: 2 }),
      });
    },
  });
  assert.equal(recovered.status, "continue");
  const observations = selected.store.listEvents().filter((event) =>
    event.eventKind === "transaction-effect-observed");
  assert.deepEqual(observations.map(({ payload }) => payload.facts), [
    firstFacts,
    secondFacts,
  ]);
  assert.deepEqual(observations.map(({ payload }) => payload.factsDigest), [
    firstFactsDigest,
    secondFactsDigest,
  ]);
  await assert.rejects(advanceFoundationActivityKernelTransactionEffectV7({
    store: selected.store,
    context: deferred.context,
    checkpoint: adapter,
    effectDigest,
    runtimeId: RUNTIME,
    maximumObservations: 3,
    sampleIntendedAt: () => COMPLETED,
    sampleObservedAt: () => COMPLETED,
    async observe() {
      throw new Error("stale coordinates must fail before physical observation");
    },
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.activity-kernel-v7.transaction-coordinate");

  const bounded = fakeStore();
  const boundedOpened = openTransaction(bounded);
  const boundedAdapter = transactionAdapter(bounded);
  const boundedIntent = await advanceFoundationActivityKernelTransactionEffectV7({
    store: bounded.store,
    context: boundedOpened,
    checkpoint: boundedAdapter,
    effectDigest,
    runtimeId: RUNTIME,
    maximumObservations: 1,
    sampleIntendedAt: () => "2026-08-29T20:00:01.000Z",
    sampleObservedAt: () => "2026-08-29T20:00:02.000Z",
    async observe() {
      throw new Error("intent must not observe");
    },
  });
  assert.equal(boundedIntent.status, "continue");
  const boundedDeferred = await advanceFoundationActivityKernelTransactionEffectV7({
    store: bounded.store,
    context: boundedIntent.context,
    checkpoint: boundedAdapter,
    effectDigest,
    runtimeId: RUNTIME,
    maximumObservations: 1,
    sampleIntendedAt: () => COMPLETED,
    sampleObservedAt: () => "2026-08-29T20:00:02.000Z",
    async observe() {
      return Object.freeze({
        outcome: "indeterminate" as const,
        facts: firstFacts,
        checkpoint: Object.freeze({ schema: "example.checkpoint.v1", attempt: 1 }),
      });
    },
  });
  assert.equal(boundedDeferred.status, "deferred");
  await assert.rejects(advanceFoundationActivityKernelTransactionEffectV7({
    store: bounded.store,
    context: boundedDeferred.context,
    checkpoint: boundedAdapter,
    effectDigest,
    runtimeId: RUNTIME,
    maximumObservations: 1,
    sampleIntendedAt: () => COMPLETED,
    sampleObservedAt: () => COMPLETED,
    async observe() {
      throw new Error("the fixed bound must fail before physical observation");
    },
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.activity-kernel-v7.transaction-observation-bound");
});

test("a transaction can retain bounded-per-invocation waiting without a cumulative dead end", async () => {
  const selected = fakeStore();
  const opened = openTransaction(selected);
  const adapter = transactionAdapter(selected);
  const effectDigest = sha256Bytes("kernel-open-ended-waiting-effect");
  const intended = await advanceFoundationActivityKernelTransactionEffectV7({
    store: selected.store,
    context: opened,
    checkpoint: adapter,
    effectDigest,
    runtimeId: RUNTIME,
    maximumObservations: null,
    sampleIntendedAt: () => "2026-08-29T20:00:01.000Z",
    sampleObservedAt: () => "2026-08-29T20:00:02.000Z",
    async observe() {
      throw new Error("intent must not observe");
    },
  });
  assert.equal(intended.status, "continue");

  let current = intended.context;
  for (let index = 1; index <= 65; index += 1) {
    const observedAt = new Date(Date.UTC(2026, 7, 29, 20, 0, index + 1)).toISOString();
    const deferred = await advanceFoundationActivityKernelTransactionEffectV7({
      store: selected.store,
      context: current,
      checkpoint: adapter,
      effectDigest,
      runtimeId: RUNTIME,
      maximumObservations: null,
      sampleIntendedAt: () => COMPLETED,
      sampleObservedAt: (observationIndex) => {
        assert.equal(observationIndex, index);
        return observedAt;
      },
      async observe() {
        return Object.freeze({
          outcome: "indeterminate" as const,
          facts: terminalFacts(`kernel-open-wait-${index}`),
          checkpoint: Object.freeze({
            schema: "example.checkpoint.v1",
            attempt: index,
          }),
        });
      },
    });
    assert.equal(deferred.status, "deferred");
    current = deferred.context;
  }
  assert.equal(selected.store.listEvents().filter(({ eventKind }) =>
    eventKind === "transaction-effect-observed").length, 65);
  assert.deepEqual(current.envelope.checkpoint?.value, {
    schema: "example.checkpoint.v1",
    attempt: 65,
  });
});

test("standard completion follows any reducer coordinate that admits activity-completed", () => {
  const selected = fakeStore();
  openFoundationActivityKernelV7({
    store: selected.store,
    activityId: ACTIVITY,
    definition: reviseDefinition,
    plan: Object.freeze({ schema: "example.plan.v1", subjectDigest: sha256Bytes("subject") }),
    appends: Object.freeze([openingAppend("delivery.revise")]),
  });
  selected.setActivity(Object.freeze({
    ...activity("delivery.revise", recovery("finalization", "work-boundary-finalized")),
    stage: "finalizing",
  }));
  selected.failNextDelete();
  let samples = 0;
  assert.throws(() => finishFoundationActivityKernelV7({
    store: selected.store,
    activityId: ACTIVITY,
    definition: reviseDefinition,
    runtimeId: RUNTIME,
    outcome: "failed",
    sampleCompletedAt() {
      samples += 1;
      return COMPLETED;
    },
  }), /simulated crash/u);
  assert.equal(samples, 1);
  const checkpointed = readFoundationActivityKernelV7({
    store: selected.store,
    activityId: ACTIVITY,
    definition: reviseDefinition,
  });
  assert.equal(checkpointed.envelope.completion?.completedAt, COMPLETED);

  const event = finishFoundationActivityKernelV7({
    store: selected.store,
    activityId: ACTIVITY,
    definition: reviseDefinition,
    runtimeId: RUNTIME,
    outcome: "failed",
    sampleCompletedAt() {
      samples += 1;
      return "2026-08-29T20:00:11.000Z";
    },
  });
  assert.equal(samples, 1, "recovery reuses the retained completion time");
  assert.equal(event.occurredAt, COMPLETED);
  assert.equal(selected.store.getOperationSupport(ACTIVITY), null);
  assert.deepEqual(selected.calls.slice(-3), ["support-only", "batch-delete", "batch-delete"]);
});

test("a terminal definition uses failed event completion only at an admitting coordinate", () => {
  const admitted = fakeStore();
  openFoundationActivityKernelV7({
    store: admitted.store,
    activityId: ACTIVITY,
    definition: terminalDefinition,
    plan: Object.freeze({ schema: "example.terminal-plan.v1", disposition: "no-ship" }),
    appends: Object.freeze([openingAppend("delivery.no-ship")]),
  });
  admitted.setActivity(Object.freeze({
    ...activity("delivery.no-ship", recovery("finalization", "activity-completed")),
    stage: "finalizing",
  }));
  const completed = finishFoundationActivityKernelV7({
    store: admitted.store,
    activityId: ACTIVITY,
    definition: terminalDefinition,
    runtimeId: RUNTIME,
    outcome: "failed",
    sampleCompletedAt: () => COMPLETED,
  });
  assert.equal(completed.payload.outcome, "failed");
  assert.equal(admitted.store.getOperationSupport(ACTIVITY), null);

  const closureOnly = fakeStore();
  openFoundationActivityKernelV7({
    store: closureOnly.store,
    activityId: ACTIVITY,
    definition: terminalDefinition,
    plan: Object.freeze({ schema: "example.terminal-plan.v1", disposition: "no-ship" }),
    appends: Object.freeze([openingAppend("delivery.no-ship")]),
  });
  closureOnly.setActivity(Object.freeze({
    ...activity("delivery.no-ship", recovery("finalization", "transaction-finalization")),
    stage: "effect-observed",
  }));
  assert.throws(() => finishFoundationActivityKernelV7({
    store: closureOnly.store,
    activityId: ACTIVITY,
    definition: terminalDefinition,
    runtimeId: RUNTIME,
    outcome: "failed",
    sampleCompletedAt: () => COMPLETED,
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-activity.completion");
  assert.notEqual(closureOnly.store.getOperationSupport(ACTIVITY), null);
});

test("terminal completion refuses before changing support when reducer completion cannot be proved", () => {
  const selected = fakeStore();
  openFoundationActivityKernelV7({
    store: selected.store,
    activityId: ACTIVITY,
    definition: terminalDefinition,
    plan: Object.freeze({ schema: "example.terminal-plan.v1", disposition: "no-ship" }),
    appends: Object.freeze([openingAppend("delivery.no-ship")]),
  });
  selected.setActivity(Object.freeze({
    ...activity("delivery.no-ship", recovery("finalization", "transaction-finalization")),
    stage: "effect-observed",
  }));
  assert.throws(() => finishFoundationTerminalActivityKernelV7({
    store: selected.store,
    activityId: ACTIVITY,
    definition: terminalDefinition,
    outcome: "completed",
    sampleCompletedAt: () => COMPLETED,
    compileOperationAppend: (_context, completedAt) => eventAppend(
      "closure-recorded",
      Object.freeze({ activityId: ACTIVITY }),
      completedAt,
    ),
  }), (error: unknown) => {
    assert(error instanceof FoundationError);
    assert.equal(error.code, "lifecycle.delivery-reducer.order");
    return true;
  });
  const retained = readFoundationActivityKernelV7({
    store: selected.store,
    activityId: ACTIVITY,
    definition: terminalDefinition,
  });
  assert.equal(retained.envelope.completion, null);
  assert.notEqual(selected.store.getOperationSupport(ACTIVITY), null);
});

test("recovery may defer only after durable progress with exact live support", async () => {
  const selected = fakeStore();
  const opened = openStandard(selected);
  const value = await recoverFoundationActivityKernelV7({
    store: selected.store,
    activityId: ACTIVITY,
    definition: standardDefinition,
    runtimeId: RUNTIME,
    now: () => COMPLETED,
    async resume({ context, checkpoint }) {
      assert.equal(context.envelope.plan.digest, opened.envelope.plan.digest);
      checkpoint.commit({
        mode: "support-only",
        expected: context.coordinate,
        checkpoint: Object.freeze({
          schema: "example.checkpoint.v1",
          disposition: "retry-later",
        }),
      });
      return Object.freeze({
        status: "deferred" as const,
        value: Object.freeze({ status: "recovery-required" as const }),
      });
    },
  });
  assert.deepEqual(value, { status: "recovery-required" });
  const retained = readFoundationActivityKernelV7({
    store: selected.store,
    activityId: ACTIVITY,
    definition: standardDefinition,
  });
  assert.equal(retained.activity.stage, "started");
  assert.equal(retained.envelope.plan.digest, opened.envelope.plan.digest);
  assert.deepEqual(retained.envelope.checkpoint?.value, {
    schema: "example.checkpoint.v1",
    disposition: "retry-later",
  });
  assert.notEqual(selected.store.getOperationSupport(ACTIVITY), null);
});

test("recovery rejects deferral without operation progress", async () => {
  const selected = fakeStore();
  openStandard(selected);
  await assert.rejects(recoverFoundationActivityKernelV7({
    store: selected.store,
    activityId: ACTIVITY,
    definition: standardDefinition,
    runtimeId: RUNTIME,
    now: () => COMPLETED,
    async resume() {
      return Object.freeze({ status: "deferred" as const, value: "retry-later" });
    },
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.activity-kernel-v7.recovery-no-progress");
});

test("recovery records the reducer coordinate and rejects a retry without progress", async () => {
  const selected = fakeStore();
  openStandard(selected);
  let observedPlan: ControlJsonObject | null = null;
  await assert.rejects(recoverFoundationActivityKernelV7({
    store: selected.store,
    activityId: ACTIVITY,
    definition: standardDefinition,
    runtimeId: RUNTIME,
    now: () => COMPLETED,
    maximumPasses: 2,
    async resume({ context }) {
      observedPlan = context.envelope.plan.value;
      return Object.freeze({ status: "continue" as const });
    },
  }), (error: unknown) => {
    assert(error instanceof FoundationError);
    assert.equal(error.code, "lifecycle.activity-kernel-v7.recovery-no-progress");
    assert.deepEqual(error.observedFacts, {
      activityId: ACTIVITY,
      operation: "delivery.continue",
      recovery: {
        kind: "finalization",
        resumesAt: "agent-attempt-prepared",
        exactEffectDigest: null,
      },
      passes: 1,
      journalAdvance: 1,
      supportAdvance: 0,
    });
    return true;
  });
  assert.deepEqual(observedPlan, {
    schema: "example.plan.v1",
    subjectDigest: sha256Bytes("subject"),
  });
  const diagnostic = selected.store.listEvents().at(-1)!;
  assert.equal(diagnostic.eventKind, "activity-recovery-recorded");
  assert.deepEqual(diagnostic.payload, {
    activityId: ACTIVITY,
    kind: "finalization",
    resumesAt: "agent-attempt-prepared",
    exactEffectDigest: null,
  });
});

test("fresh progression emits no recovery diagnostic and shares no-progress enforcement", async () => {
  const deferredStore = fakeStore();
  openStandard(deferredStore);
  const value = await advanceFoundationActivityKernelV7({
    store: deferredStore.store,
    activityId: ACTIVITY,
    definition: standardDefinition,
    runtimeId: RUNTIME,
    async advance({ context, checkpoint }) {
      checkpoint.commit({
        mode: "support-only",
        expected: context.coordinate,
        checkpoint: Object.freeze({
          schema: "example.checkpoint.v1",
          disposition: "fresh-retry-later",
        }),
      });
      return Object.freeze({
        status: "deferred" as const,
        value: Object.freeze({ status: "recovery-required" as const }),
      });
    },
  });
  assert.deepEqual(value, { status: "recovery-required" });
  assert.equal(
    deferredStore.store.listEvents().some(({ eventKind }) =>
      eventKind === "activity-recovery-recorded"),
    false,
  );

  const stalledStore = fakeStore();
  openStandard(stalledStore);
  await assert.rejects(advanceFoundationActivityKernelV7({
    store: stalledStore.store,
    activityId: ACTIVITY,
    definition: standardDefinition,
    runtimeId: RUNTIME,
    async advance() {
      return Object.freeze({ status: "continue" as const });
    },
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.activity-kernel-v7.recovery-no-progress");
});

test("fresh and recovered progression reject false settlement through one common bound", async () => {
  const fresh = fakeStore();
  openStandard(fresh);
  await assert.rejects(advanceFoundationActivityKernelV7({
    store: fresh.store,
    activityId: ACTIVITY,
    definition: standardDefinition,
    runtimeId: RUNTIME,
    async advance() {
      return Object.freeze({ status: "settled" as const, value: "invalid" });
    },
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.activity-kernel-v7.recovery-settlement");

  const recovered = fakeStore();
  openStandard(recovered);
  await assert.rejects(recoverFoundationActivityKernelV7({
    store: recovered.store,
    activityId: ACTIVITY,
    definition: standardDefinition,
    runtimeId: RUNTIME,
    now: () => COMPLETED,
    async resume() {
      return Object.freeze({ status: "settled" as const, value: "invalid" });
    },
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.activity-kernel-v7.recovery-settlement");
  assert.equal(
    recovered.store.listEvents().at(-1)?.eventKind,
    "activity-recovery-recorded",
  );
});
