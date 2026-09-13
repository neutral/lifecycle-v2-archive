import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { FoundationError } from "../../src/foundation/error.js";
import {
  archiveControlRecordStore,
  openArchivedControlRecordStore,
} from "../../src/foundation/control/archive.js";
import {
  compileControlRecordEvent,
  compileControlRecordRevision,
} from "../../src/foundation/control/model.js";
import {
  compileControlRecordFile,
  controlRecordStorePaths,
  openControlRecordStore,
  type ControlRecordStore,
} from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlJsonObject,
  type ControlRecordFileInput,
  type ControlRecordRevision,
  type ControlRecordRevisionInput,
  type ControlRecordStoreAppend,
  type ControlRecordStoreIdentity,
} from "../../src/foundation/control/types.js";
import {
  canonicalJson,
  digestCanonical,
  sha256Bytes,
} from "../../src/foundation/validation/canonical.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

function identity(suffix = "one"): ControlRecordStoreIdentity {
  return Object.freeze({
    schema: CONTROL_RECORD_STORE_SCHEMA,
    storeId: `store-${suffix}`,
    targetId: `target-${suffix}`,
    processKind: "delivery",
    processId: `delivery-${suffix}`,
    createdAt: "2026-08-29T01:00:00.000Z",
  });
}

function validExecutionReceiptPayload(): ControlJsonObject {
  const payload = validDeliveryControlPayload("execution-receipt");
  const provider = payload.provider;
  assert(provider !== null && typeof provider === "object" && !Array.isArray(provider));
  return Object.freeze({
    ...payload,
    provider: Object.freeze({
      ...provider,
      installedIdentityDigest: sha256Bytes("installed-provider-executable"),
      observedExecutableIdentity: null,
    }),
  });
}

function code(expected: string): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    assert(error instanceof FoundationError);
    assert.equal(error.code, `lifecycle.control-record-store.${expected}`);
    return true;
  };
}

function reducerCode(expected: string): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    assert(error instanceof FoundationError);
    assert.equal(error.code, `lifecycle.delivery-reducer.${expected}`);
    return true;
  };
}

function schemaCode(error: unknown): boolean {
  assert(error instanceof FoundationError);
  assert.equal(error.code, "lifecycle.schema.invalid");
  return true;
}

function appendFinalizedRevision(
  store: ControlRecordStore,
  revision: ControlRecordRevisionInput,
  eventId: string,
  eventKind: string,
  activityId = eventId,
): ControlRecordRevision {
  const compiled = compileControlRecordRevision(store.identity.processId, revision);
  const retained = store.append({
    revision,
    event: {
      eventId,
      eventKind,
      occurredAt: revision.createdAt,
      actor: { kind: "runtime", id: "foundation-runtime" },
      subject: {
        recordId: compiled.recordId,
        revision: compiled.revision,
        digest: compiled.digest,
      },
      payload: { activityId },
    },
  });
  assert(retained.revision !== null);
  return retained.revision;
}

function activityOpeningBatch(
  store: ControlRecordStore,
  suffix: string,
): Readonly<{
  activityId: string;
  attempt: ControlRecordRevision;
  brief: ControlRecordRevision;
  effectDigest: ReturnType<typeof sha256Bytes>;
  items: readonly ControlRecordStoreAppend[];
}> {
  const activityId = `prepare-batch-${suffix}`;
  const briefInput: ControlRecordRevisionInput = Object.freeze({
    recordId: `brief-batch-${suffix}`,
    recordKind: "director-brief",
    revision: 1,
    producer: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
    semanticAuthor: Object.freeze({ kind: "director", id: `director-${suffix}` }),
    semanticAuthority: "director-supplied",
    createdAt: "2026-08-29T04:00:01.000Z",
    semanticMarkdown: "# Director Brief\n\nOpen one exact activity.\n",
    payload: { ...validDeliveryControlPayload("director-brief"), scope: { kind: "activity", activityId: activityId } },
  });
  const brief = compileControlRecordRevision(store.identity.processId, briefInput);
  const attemptInput: ControlRecordRevisionInput = Object.freeze({
    recordId: `attempt-batch-${suffix}`,
    recordKind: "agent-attempt",
    revision: 1,
    producer: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
    semanticAuthor: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
    semanticAuthority: "runtime-derived",
    createdAt: "2026-08-29T04:00:03.000Z",
    semanticMarkdown: "# Agent Attempt\n\nPrepare one exact provider invocation.\n",
    payload: Object.freeze({
      ...validDeliveryControlPayload("agent-attempt"),
      activityId,
    }),
    relationships: Object.freeze([{
      relation: "uses-brief",
      target: Object.freeze({
        kind: brief.recordKind,
        id: brief.recordId,
        revision: brief.revision,
        digest: brief.digest,
      }),
    }]),
  });
  const attempt = compileControlRecordRevision(store.identity.processId, attemptInput);
  const effectDigest = sha256Bytes(`provider-effect-batch-${suffix}`);
  const items: readonly ControlRecordStoreAppend[] = Object.freeze([{
    revision: briefInput,
    event: Object.freeze({
      eventId: `event-brief-batch-${suffix}`,
      eventKind: "director-brief-submitted",
      occurredAt: briefInput.createdAt,
      actor: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
      subject: Object.freeze({
        recordId: brief.recordId,
        revision: brief.revision,
        digest: brief.digest,
      }),
      payload: Object.freeze({ activityId }),
    }),
  }, {
    event: Object.freeze({
      eventId: `event-activity-started-batch-${suffix}`,
      eventKind: "activity-started",
      occurredAt: "2026-08-29T04:00:02.000Z",
      actor: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
      payload: Object.freeze({ activityId, operation: "delivery.prepare" }),
    }),
  }, {
    revision: attemptInput,
    event: Object.freeze({
      eventId: `event-attempt-batch-${suffix}`,
      eventKind: "agent-attempt-prepared",
      occurredAt: attemptInput.createdAt,
      actor: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
      subject: Object.freeze({
        recordId: attempt.recordId,
        revision: attempt.revision,
        digest: attempt.digest,
      }),
      payload: Object.freeze({ activityId }),
    }),
  }, {
    event: Object.freeze({
      eventId: `event-provider-intended-batch-${suffix}`,
      eventKind: "provider-effect-intended",
      occurredAt: "2026-08-29T04:00:04.000Z",
      actor: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
      subject: Object.freeze({
        recordId: attempt.recordId,
        revision: attempt.revision,
        digest: attempt.digest,
      }),
      payload: Object.freeze({ activityId, effectDigest }),
    }),
  }]);
  return Object.freeze({ activityId, attempt, brief, effectDigest, items });
}

function prepareFailedAgentActivity(
  store: ControlRecordStore,
  suffix: string,
): Readonly<{ activityId: string; attempt: ControlRecordRevision }> {
  const activityId = `prepare-${suffix}`;
  store.append({
    event: {
      eventId: `event-delivery-created-${suffix}`,
      eventKind: "delivery-created",
      occurredAt: "2026-08-29T03:00:01.000Z",
      actor: { kind: "runtime", id: "foundation-runtime" },
      payload: {},
    },
  });
  const brief = appendFinalizedRevision(store, {
    recordId: `brief-${suffix}`,
    recordKind: "director-brief",
    revision: 1,
    producer: { kind: "runtime", id: "foundation-runtime" },
    semanticAuthor: { kind: "director", id: `director-${suffix}` },
    semanticAuthority: "director-supplied",
    createdAt: "2026-08-29T03:00:02.000Z",
    semanticMarkdown: "# Director Brief\n\nExercise adjacent-file custody.\n",
    payload: { ...validDeliveryControlPayload("director-brief"), scope: { kind: "activity", activityId: activityId } },
  }, `event-brief-${suffix}`, "director-brief-submitted", activityId);
  store.append({
    event: {
      eventId: `event-activity-started-${suffix}`,
      eventKind: "activity-started",
      occurredAt: "2026-08-29T03:00:03.000Z",
      actor: { kind: "runtime", id: "foundation-runtime" },
      payload: { activityId, operation: "delivery.prepare" },
    },
  });
  const attempt = appendFinalizedRevision(store, {
    recordId: `attempt-${suffix}`,
    recordKind: "agent-attempt",
    revision: 1,
    producer: { kind: "runtime", id: "foundation-runtime" },
    semanticAuthor: { kind: "runtime", id: "foundation-runtime" },
    semanticAuthority: "runtime-derived",
    createdAt: "2026-08-29T03:00:04.000Z",
    semanticMarkdown: "# Agent Attempt\n\nObserve one failed provider boundary.\n",
    payload: Object.freeze({
      ...validDeliveryControlPayload("agent-attempt"),
      activityId,
    }),
    relationships: [{
      relation: "uses-brief",
      target: {
        kind: brief.recordKind,
        id: brief.recordId,
        revision: brief.revision,
        digest: brief.digest,
      },
    }],
  }, `event-attempt-${suffix}`, "agent-attempt-prepared", activityId);
  const effectDigest = sha256Bytes(`provider-effect-${suffix}`);
  store.append({
    event: {
      eventId: `event-provider-intended-${suffix}`,
      eventKind: "provider-effect-intended",
      occurredAt: "2026-08-29T03:00:05.000Z",
      actor: { kind: "runtime", id: "foundation-runtime" },
      subject: { recordId: attempt.recordId, revision: attempt.revision, digest: attempt.digest },
      payload: { activityId, effectDigest },
    },
  });
  store.append({
    event: {
      eventId: `event-provider-observed-${suffix}`,
      eventKind: "provider-effect-observed",
      occurredAt: "2026-08-29T03:00:06.000Z",
      actor: { kind: "runtime", id: "foundation-runtime" },
      subject: { recordId: attempt.recordId, revision: attempt.revision, digest: attempt.digest },
      payload: { activityId, effectDigest, outcome: "failed" },
    },
  });
  store.append({
    event: {
      eventId: `event-work-product-abandoned-${suffix}`,
      eventKind: "agent-work-product-abandoned",
      occurredAt: "2026-08-29T03:00:07.000Z",
      actor: { kind: "runtime", id: "foundation-runtime" },
      subject: { recordId: attempt.recordId, revision: attempt.revision, digest: attempt.digest },
      payload: { activityId },
    },
  });
  return Object.freeze({ activityId, attempt });
}

function fileReceiptAppend(
  store: ControlRecordStore,
  activity: Readonly<{ activityId: string; attempt: ControlRecordRevision }>,
  suffix: string,
  file: ControlRecordFileInput,
  createdAt = "2026-08-29T03:00:08.000Z",
): Readonly<{
  descriptor: ReturnType<typeof compileControlRecordFile>;
  revision: ControlRecordRevisionInput;
  append: ControlRecordStoreAppend;
}> {
  const descriptor = compileControlRecordFile(file);
  const revision: ControlRecordRevisionInput = Object.freeze({
    recordId: `receipt-${suffix}`,
    recordKind: "execution-receipt",
    revision: 1,
    producer: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
    semanticAuthor: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
    semanticAuthority: "runtime-observed",
    createdAt,
    semanticMarkdown: "# Execution Receipt\n\nBind exact retained provider material.\n",
    payload: Object.freeze({
      ...validExecutionReceiptPayload(),
      activityId: activity.activityId,
      rawMaterials: Object.freeze([Object.freeze({
        availability: "retained",
        reference: Object.freeze({
          digest: descriptor.digest,
          byteLength: descriptor.byteLength,
          mediaType: descriptor.mediaType,
          purpose: descriptor.purpose,
        }),
      })]),
    }),
    relationships: Object.freeze([{
      relation: "observes-attempt",
      target: Object.freeze({
        kind: activity.attempt.recordKind,
        id: activity.attempt.recordId,
        revision: activity.attempt.revision,
        digest: activity.attempt.digest,
      }),
    }]),
  });
  const compiled = compileControlRecordRevision(store.identity.processId, revision);
  return Object.freeze({
    descriptor,
    revision,
    append: Object.freeze({
      revision,
      event: Object.freeze({
        eventId: `event-receipt-${suffix}`,
        eventKind: "execution-receipt-recorded",
        occurredAt: createdAt,
        actor: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
        subject: Object.freeze({
          recordId: compiled.recordId,
          revision: compiled.revision,
          digest: compiled.digest,
        }),
        payload: Object.freeze({ activityId: activity.activityId }),
      }),
    }),
  });
}

test("common Control values reject unbounded typed payloads before retention", () => {
  assert.throws(() => compileControlRecordEvent({
    storeId: "store-bounds",
    processId: "delivery-bounds",
    sequence: 1,
    predecessorDigest: null,
    event: {
      eventId: "event-bounds",
      eventKind: "delivery-created",
      occurredAt: "2026-08-29T00:00:00Z",
      actor: { kind: "runtime", id: "foundation-runtime" },
      payload: { oversized: "x".repeat(64 * 1024) },
    },
  }), code("json-bounds"));

  assert.throws(() => compileControlRecordRevision("delivery-bounds", {
    recordId: "brief-bounds",
    recordKind: "director-brief",
    revision: 1,
    producer: { kind: "runtime", id: "foundation-runtime" },
    semanticAuthor: { kind: "director", id: "director-bounds" },
    semanticAuthority: "director-supplied",
    createdAt: "2026-08-29T00:00:00Z",
    semanticMarkdown: "# Director Brief\n\nBound the input.\n",
    payload: { oversized: "x".repeat(2 * 1024 * 1024) },
  }), code("json-bounds"));

  const mutablePayload = { nested: { value: "before" }, list: ["one"] };
  const immutableRevision = compileControlRecordRevision("delivery-immutable-value", {
    recordId: "brief-immutable-value",
    recordKind: "director-brief",
    revision: 1,
    producer: { kind: "runtime", id: "foundation-runtime" },
    semanticAuthor: { kind: "director", id: "director-immutable-value" },
    semanticAuthority: "director-supplied",
    createdAt: "2026-08-29T00:00:01Z",
    semanticMarkdown: "# Director Brief\n\nRetain immutable values.\n",
    payload: mutablePayload,
  });
  mutablePayload.nested.value = "after";
  mutablePayload.list.push("two");
  assert.deepEqual(immutableRevision.payload, {
    list: ["one"],
    nested: { value: "before" },
  });
  assert(Object.isFrozen(immutableRevision.payload));
  assert(Object.isFrozen(immutableRevision.payload.nested));
  assert(Object.isFrozen(immutableRevision.payload.list));
});

test("operation support is store-bound, canonical, CAS-updated, and outside logical identity", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "lifecycle-control-record-store-support-"));
  try {
    const selectedIdentity = identity("support");
    const root = join(workspace, "store");
    const store = await openControlRecordStore({ root, identity: selectedIdentity, create: true });
    const inventoryBefore = store.logicalInventoryDigest();
    const mutablePayload = {
      stage: "prepared",
      attempt: { id: "attempt-support", inputs: ["projection", "brief"] },
    };
    const created = store.putOperationSupport({
      activityId: "activity-support",
      supportKind: "provider-operation",
      payload: mutablePayload,
      expected: null,
    });
    mutablePayload.stage = "changed-by-caller";
    mutablePayload.attempt.inputs.push("ambient");

    assert.equal(created.storeId, selectedIdentity.storeId);
    assert.equal(created.processId, selectedIdentity.processId);
    assert.equal(created.generation, 1);
    assert.equal(created.payloadDigest, sha256Bytes(canonicalJson(created.payload)));
    assert.deepEqual(created.payload, {
      attempt: { id: "attempt-support", inputs: ["projection", "brief"] },
      stage: "prepared",
    });
    assert(Object.isFrozen(created.payload));
    assert(Object.isFrozen(created.payload.attempt));
    assert.equal(store.logicalInventoryDigest(), inventoryBefore);
    assert.deepEqual(store.getOperationSupport("activity-support"), created);
    assert.throws(() => store.putOperationSupport({
      activityId: "activity-support",
      supportKind: "provider-operation",
      payload: { stage: "duplicate-create" },
      expected: null,
    }), code("operation-support-cas"));
    assert.throws(() => store.putOperationSupport({
      activityId: "activity-support",
      supportKind: "transaction-operation",
      payload: { stage: "wrong-kind" },
      expected: { generation: created.generation, payloadDigest: created.payloadDigest },
    }), code("operation-support-cas"));

    const supportMarker = "runtime-support-locator-7e70207384a94d48a5c769d42eef3dab";
    const updated = store.putOperationSupport({
      activityId: "activity-support",
      supportKind: "provider-operation",
      payload: {
        stage: "effect-intended",
        effectDigest: sha256Bytes("provider-effect"),
        recoveryLocator: supportMarker,
      },
      expected: { generation: created.generation, payloadDigest: created.payloadDigest },
    });
    assert.equal(updated.generation, 2);
    assert.notEqual(updated.payloadDigest, created.payloadDigest);
    assert.equal(store.logicalInventoryDigest(), inventoryBefore);
    assert.throws(() => store.deleteOperationSupport("activity-support", {
      generation: created.generation,
      payloadDigest: created.payloadDigest,
    }), code("operation-support-cas"));
    assert.deepEqual(await store.verifyIntegrity(), {
      integrity: "ok",
      eventCount: 0,
      recordCount: 0,
      revisionCount: 0,
      referencedFileCount: 0,
      headDigest: null,
    });
    store.close();

    const reopened = await openControlRecordStore({ root, identity: selectedIdentity, create: false });
    assert.deepEqual(reopened.getOperationSupport("activity-support"), updated);
    assert.deepEqual(reopened.deleteOperationSupport("activity-support", {
      generation: updated.generation,
      payloadDigest: updated.payloadDigest,
    }), updated);
    assert.equal(reopened.getOperationSupport("activity-support"), null);
    assert.equal(reopened.logicalInventoryDigest(), inventoryBefore);
    assert.equal((await reopened.verifyIntegrity()).integrity, "ok");
    reopened.close();
    assert.equal(
      (await readFile(controlRecordStorePaths(root).database)).includes(Buffer.from(supportMarker)),
      false,
      "disposed operation-support payload bytes must not survive in SQLite free space",
    );

    const readOnly = await openControlRecordStore({
      root,
      identity: selectedIdentity,
      create: false,
      readOnly: true,
    });
    assert.throws(() => readOnly.putOperationSupport({
      activityId: "activity-read-only",
      supportKind: "provider-operation",
      payload: {},
      expected: null,
    }), code("read-only"));
    readOnly.close();
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("operation-support integrity detects payload substitution", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "lifecycle-control-record-store-support-integrity-"));
  try {
    const selectedIdentity = identity("support-integrity");
    const root = join(workspace, "store");
    const store = await openControlRecordStore({ root, identity: selectedIdentity, create: true });
    store.putOperationSupport({
      activityId: "activity-support-integrity",
      supportKind: "provider-operation",
      payload: { stage: "prepared" },
      expected: null,
    });
    store.close();

    const db = new DatabaseSync(controlRecordStorePaths(root).database);
    const exactUpdate = db.prepare(`
      SELECT sql FROM sqlite_schema WHERE name = 'operation_support_exact_update'
    `).get() as Readonly<{ sql: string }>;
    db.exec("DROP TRIGGER operation_support_exact_update");
    db.prepare(`
      UPDATE operation_support SET payload_json = ? WHERE activity_id = ?
    `).run(canonicalJson({ stage: "substituted" }), "activity-support-integrity");
    db.exec(exactUpdate.sql);
    db.close();

    await assert.rejects(openControlRecordStore({
      root,
      identity: selectedIdentity,
      create: false,
    }), code("operation-support-integrity"));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("operation batches recover atomically across every fault stage and restart", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "lifecycle-control-operation-batch-fault-"));
  try {
    const stages = Object.freeze([
      "appends-resolved",
      "support-resolved",
      "committed",
    ] as const);
    for (const [index, interruptedStage] of stages.entries()) {
      const selectedIdentity = identity(`operation-batch-fault-${index}`);
      const root = join(workspace, `store-${index}`);
      const store = await openControlRecordStore({ root, identity: selectedIdentity, create: true });
      store.append({
        event: {
          eventId: `event-delivery-created-operation-batch-${index}`,
          eventKind: "delivery-created",
          occurredAt: "2026-08-29T04:00:00.000Z",
          actor: { kind: "runtime", id: "foundation-runtime" },
          payload: {},
        },
      });
      const opening = activityOpeningBatch(store, `operation-batch-${index}`);
      const supportMutation = Object.freeze({
        action: "put" as const,
        value: Object.freeze({
          activityId: opening.activityId,
          supportKind: "provider-operation",
          payload: Object.freeze({ stage: "attempt-prepared", checkpoint: `checkpoint-${index}` }),
          expected: null,
        }),
      });
      assert.throws(() => store.commitOperationBatch({
        supportMutations: [supportMutation],
        appends: opening.items.slice(0, 3),
        onStage(stage) {
          if (stage === interruptedStage) throw new Error(`interrupt after ${stage}`);
        },
      }), new RegExp(`interrupt after ${interruptedStage}`, "u"));
      store.close();

      const reopened = await openControlRecordStore({
        root,
        identity: selectedIdentity,
        create: false,
      });
      if (interruptedStage === "committed") {
        assert.equal(reopened.listEvents().length, 4);
        assert.equal(reopened.getOperationSupport(opening.activityId)?.generation, 1);
      } else {
        assert.equal(reopened.listEvents().length, 1);
        assert.equal(reopened.getOperationSupport(opening.activityId), null);
      }
      const recovered = reopened.commitOperationBatch({
        supportMutations: [supportMutation],
        appends: opening.items.slice(0, 3),
      });
      assert.equal(recovered.supportMutations[0]?.support?.generation, 1);
      assert.deepEqual(
        recovered.appends.map(({ event }) => event.eventId),
        opening.items.slice(0, 3).map(({ event }) => event.eventId),
      );
      assert.deepEqual(reopened.commitOperationBatch({
        supportMutations: [supportMutation],
        appends: opening.items.slice(0, 3),
      }), recovered);
      reopened.close();
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("operation batches bind intent, observation, and disposal to exact Journal facts", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "lifecycle-control-operation-batch-lifecycle-"));
  try {
    const selectedIdentity = identity("operation-batch-lifecycle");
    const root = join(workspace, "store");
    const store = await openControlRecordStore({ root, identity: selectedIdentity, create: true });
    store.append({
      event: {
        eventId: "event-delivery-created-operation-lifecycle",
        eventKind: "delivery-created",
        occurredAt: "2026-08-29T04:00:00.000Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        payload: {},
      },
    });
    const opening = activityOpeningBatch(store, "operation-lifecycle");
    const initial = store.commitOperationBatch({
      supportMutations: [{
        action: "put",
        value: {
          activityId: opening.activityId,
          supportKind: "provider-operation",
          payload: { stage: "attempt-prepared" },
          expected: null,
        },
      }],
      appends: opening.items.slice(0, 3),
    });
    const preparedSupport = initial.supportMutations[0]?.support;
    assert(preparedSupport !== null && preparedSupport !== undefined);

    const intended = store.commitOperationBatch({
      supportMutations: [{
        action: "put",
        value: {
          activityId: opening.activityId,
          supportKind: "provider-operation",
          payload: { stage: "effect-intended", effectDigest: opening.effectDigest },
          expected: {
            generation: preparedSupport.generation,
            payloadDigest: preparedSupport.payloadDigest,
          },
        },
      }],
      appends: [opening.items[3]!],
    });
    const intendedSupport = intended.supportMutations[0]?.support;
    assert(intendedSupport !== null && intendedSupport !== undefined);
    assert.equal(intendedSupport.generation, 2);

    const observedAppend: ControlRecordStoreAppend = Object.freeze({
      event: Object.freeze({
        eventId: "event-provider-observed-operation-lifecycle",
        eventKind: "provider-effect-observed",
        occurredAt: "2026-08-29T04:00:05.000Z",
        actor: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
        subject: Object.freeze({
          recordId: opening.attempt.recordId,
          revision: opening.attempt.revision,
          digest: opening.attempt.digest,
        }),
        payload: Object.freeze({
          activityId: opening.activityId,
          effectDigest: opening.effectDigest,
          outcome: "failed",
        }),
      }),
    });
    const observed = store.commitOperationBatch({
      supportMutations: [{
        action: "put",
        value: {
          activityId: opening.activityId,
          supportKind: "provider-operation",
          payload: { stage: "effect-observed", outcome: "failed" },
          expected: {
            generation: intendedSupport.generation,
            payloadDigest: intendedSupport.payloadDigest,
          },
        },
      }],
      appends: [observedAppend],
    });
    const observedSupport = observed.supportMutations[0]?.support;
    assert(observedSupport !== null && observedSupport !== undefined);
    assert.equal(observedSupport.generation, 3);

    store.append({
      event: {
        eventId: "event-work-product-abandoned-operation-lifecycle",
        eventKind: "agent-work-product-abandoned",
        occurredAt: "2026-08-29T04:00:06.000Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        subject: {
          recordId: opening.attempt.recordId,
          revision: opening.attempt.revision,
          digest: opening.attempt.digest,
        },
        payload: { activityId: opening.activityId },
      },
    });
    appendFinalizedRevision(store, {
      recordId: "receipt-operation-lifecycle",
      recordKind: "execution-receipt",
      revision: 1,
      producer: { kind: "runtime", id: "foundation-runtime" },
      semanticAuthor: { kind: "runtime", id: "foundation-runtime" },
      semanticAuthority: "runtime-observed",
      createdAt: "2026-08-29T04:00:07.000Z",
      semanticMarkdown: "# Execution Receipt\n\nThe failed provider outcome was observed.\n",
      payload: Object.freeze({
        ...validExecutionReceiptPayload(),
        activityId: opening.activityId,
      }),
      relationships: [{
        relation: "observes-attempt",
        target: {
          kind: opening.attempt.recordKind,
          id: opening.attempt.recordId,
          revision: opening.attempt.revision,
          digest: opening.attempt.digest,
        },
      }],
    }, "event-receipt-operation-lifecycle", "execution-receipt-recorded", opening.activityId);

    const completionAppend: ControlRecordStoreAppend = Object.freeze({
      event: Object.freeze({
        eventId: "event-activity-completed-operation-lifecycle",
        eventKind: "activity-completed",
        occurredAt: "2026-08-29T04:00:08.000Z",
        actor: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
        payload: Object.freeze({ activityId: opening.activityId, outcome: "failed" }),
      }),
    });
    const completionInput = Object.freeze({
      supportMutations: Object.freeze([Object.freeze({
        action: "delete" as const,
        activityId: opening.activityId,
        expected: Object.freeze({
          generation: observedSupport.generation,
          payloadDigest: observedSupport.payloadDigest,
        }),
      })]),
      appends: Object.freeze([completionAppend]),
    });
    const completed = store.commitOperationBatch(completionInput);
    assert.equal(completed.supportMutations[0]?.support, null);
    assert.equal(store.getOperationSupport(opening.activityId), null);
    assert.deepEqual(store.commitOperationBatch(completionInput), completed);
    store.close();

    const reopened = await openControlRecordStore({ root, identity: selectedIdentity, create: false });
    assert.equal(reopened.getOperationSupport(opening.activityId), null);
    assert.deepEqual(reopened.commitOperationBatch(completionInput), completed);
    assert.throws(() => reopened.putOperationSupport({
      activityId: opening.activityId,
      supportKind: "provider-operation",
      payload: { stage: "illegally-reopened" },
      expected: null,
    }), code("operation-support-cas"));
    assert.equal((await reopened.verifyIntegrity()).integrity, "ok");
    reopened.close();
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("operation batches refuse split support and Journal postconditions", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "lifecycle-control-operation-batch-partial-"));
  try {
    const supportFirstIdentity = identity("operation-batch-support-first");
    const supportFirst = await openControlRecordStore({
      root: join(workspace, "support-first"),
      identity: supportFirstIdentity,
      create: true,
    });
    supportFirst.append({
      event: {
        eventId: "event-delivery-created-support-first",
        eventKind: "delivery-created",
        occurredAt: "2026-08-29T04:00:00.000Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        payload: {},
      },
    });
    const supportFirstOpening = activityOpeningBatch(supportFirst, "support-first");
    const supportMutation = Object.freeze({
      action: "put" as const,
      value: Object.freeze({
        activityId: supportFirstOpening.activityId,
        supportKind: "provider-operation",
        payload: Object.freeze({ stage: "attempt-prepared" }),
        expected: null,
      }),
    });
    supportFirst.putOperationSupport(supportMutation.value);
    assert.throws(() => supportFirst.commitOperationBatch({
      supportMutations: [supportMutation],
      appends: supportFirstOpening.items.slice(0, 3),
    }), code("operation-batch-partial"));
    assert.equal(supportFirst.listEvents().length, 1);
    assert.equal(supportFirst.getOperationSupport(supportFirstOpening.activityId)?.generation, 1);
    supportFirst.close();

    const appendsFirstIdentity = identity("operation-batch-appends-first");
    const appendsFirstRoot = join(workspace, "appends-first");
    const appendsFirst = await openControlRecordStore({
      root: appendsFirstRoot,
      identity: appendsFirstIdentity,
      create: true,
    });
    appendsFirst.append({
      event: {
        eventId: "event-delivery-created-appends-first",
        eventKind: "delivery-created",
        occurredAt: "2026-08-29T04:00:00.000Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        payload: {},
      },
    });
    const appendsFirstOpening = activityOpeningBatch(appendsFirst, "appends-first");
    appendsFirst.appendBatch(appendsFirstOpening.items.slice(0, 3));
    appendsFirst.close();

    const reopened = await openControlRecordStore({
      root: appendsFirstRoot,
      identity: appendsFirstIdentity,
      create: false,
    });
    assert.throws(() => reopened.commitOperationBatch({
      supportMutations: [{
        action: "put",
        value: {
          activityId: appendsFirstOpening.activityId,
          supportKind: "provider-operation",
          payload: { stage: "attempt-prepared" },
          expected: null,
        },
      }],
      appends: appendsFirstOpening.items.slice(0, 3),
    }), code("operation-batch-partial"));
    assert.equal(reopened.getOperationSupport(appendsFirstOpening.activityId), null);
    assert.equal(reopened.listEvents().length, 4);
    reopened.close();
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("retains immutable revisions and one append-only logical event chain", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "lifecycle-control-record-store-"));
  try {
    const selectedIdentity = identity();
    const store = await openControlRecordStore({
      root: join(workspace, "active", "delivery-one"),
      identity: selectedIdentity,
      create: true,
    });
    const created = store.append({
      event: {
        eventId: "event-delivery-created",
        eventKind: "delivery-created",
        occurredAt: "2026-08-29T01:00:00.000Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        payload: {},
      },
    });
    const firstInput = Object.freeze({
      recordId: "brief-one",
      recordKind: "director-brief",
      revision: 1,
      producer: Object.freeze({ kind: "runtime" as const, id: "foundation-runtime" }),
      semanticAuthor: Object.freeze({ kind: "director" as const, id: "director-one" }),
      semanticAuthority: "director-supplied" as const,
      createdAt: "2026-08-29T01:00:01.000Z",
      semanticMarkdown: "# Objective\r\n\r\nBuild the exact thing.\r\n\r\n",
      payload: { ...validDeliveryControlPayload("director-brief"), scope: { kind: "activity", activityId: "activity-one" } },
      relationships: Object.freeze([]),
    });
    const compiledFirst = compileControlRecordRevision(selectedIdentity.processId, firstInput);
    const first = store.append({
      revision: firstInput,
      event: {
        eventId: "event-one",
        eventKind: "director-brief-submitted",
        occurredAt: "2026-08-29T01:00:01.000Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        subject: {
          recordId: compiledFirst.recordId,
          revision: compiledFirst.revision,
          digest: compiledFirst.digest,
        },
        payload: { activityId: "activity-one" },
      },
    });
    assert.equal(first.revision?.semanticMarkdown, "# Objective\n\nBuild the exact thing.\n");
    assert.equal(first.event.sequence, 2);
    assert.equal(first.event.predecessorDigest, created.event.digest);

    const retried = store.append({
      revision: firstInput,
      event: {
        eventId: "event-one",
        eventKind: "director-brief-submitted",
        occurredAt: "2026-08-29T01:00:01.000Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        subject: {
          recordId: compiledFirst.recordId,
          revision: compiledFirst.revision,
          digest: compiledFirst.digest,
        },
        payload: { activityId: "activity-one" },
      },
    });
    assert.equal(retried.event.digest, first.event.digest);
    assert.equal(store.listEvents().length, 2);

    const started = store.append({
      event: {
        eventId: "event-activity-started",
        eventKind: "activity-started",
        occurredAt: "2026-08-29T01:00:01.500Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        payload: { activityId: "activity-one", operation: "delivery.prepare" },
      },
    });

    const secondInput = Object.freeze({
      recordId: "attempt-one",
      recordKind: "agent-attempt",
      revision: 1,
      producer: Object.freeze({ kind: "runtime" as const, id: "foundation-runtime" }),
      semanticAuthor: Object.freeze({ kind: "runtime" as const, id: "foundation-runtime" }),
      semanticAuthority: "runtime-derived" as const,
      createdAt: "2026-08-29T01:00:02.000Z",
      semanticMarkdown: "# Agent Attempt\n\nPrepare the exact bounded invocation.\n",
      payload: Object.freeze({
        ...validDeliveryControlPayload("agent-attempt"),
        activityId: "activity-one",
      }),
      relationships: Object.freeze([{
        relation: "uses-brief",
        target: {
          kind: "director-brief",
          id: compiledFirst.recordId,
          revision: compiledFirst.revision,
          digest: compiledFirst.digest,
        },
      }]),
    });
    const compiledSecond = compileControlRecordRevision(selectedIdentity.processId, secondInput);
    const second = store.append({
      revision: secondInput,
      event: {
        eventId: "event-two",
        eventKind: "agent-attempt-prepared",
        occurredAt: "2026-08-29T01:00:02.000Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        subject: {
          recordId: compiledSecond.recordId,
          revision: compiledSecond.revision,
          digest: compiledSecond.digest,
        },
        payload: { activityId: "activity-one" },
      },
    });
    assert.equal(second.event.sequence, 4);
    assert.equal(second.event.predecessorDigest, started.event.digest);
    assert.equal(store.getRevision("brief-one", 1)?.digest, compiledFirst.digest);
    assert.equal(store.getRevision("attempt-one", 1)?.relationships[0]?.relation, "uses-brief");
    assert.deepEqual(await store.verifyIntegrity(), {
      integrity: "ok",
      eventCount: 4,
      recordCount: 2,
      revisionCount: 2,
      referencedFileCount: 0,
      headDigest: second.event.digest,
    });
    store.checkpoint();
    store.close();

    const storePaths = controlRecordStorePaths(join(workspace, "active", "delivery-one"));
    assert.equal(Number((await lstat(storePaths.root, { bigint: true })).mode & 0o7777n), 0o700);
    assert.equal(Number((await lstat(storePaths.database, { bigint: true })).mode & 0o7777n), 0o600);

    const reopened = await openControlRecordStore({
      root: storePaths.root,
      identity: selectedIdentity,
      create: false,
      readOnly: true,
    });
    assert.equal(reopened.listEvents().length, 4);
    assert.equal((await reopened.verifyIntegrity()).headDigest, second.event.digest);
    reopened.close();

    const unsupported = join(storePaths.root, "unsupported-entry");
    await writeFile(unsupported, "not part of the store\n", { mode: 0o600 });
    await assert.rejects(openControlRecordStore({
      root: storePaths.root,
      identity: selectedIdentity,
      create: false,
      readOnly: true,
    }), code("physical-layout"));
    await rm(unsupported);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("appendBatch opens an activity atomically and retries only the exact retained sequence", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "lifecycle-control-record-store-batch-"));
  try {
    const selectedIdentity = identity("batch");
    const root = join(workspace, "store");
    const store = await openControlRecordStore({
      root,
      identity: selectedIdentity,
      create: true,
    });
    const created = store.append({
      event: {
        eventId: "event-delivery-created-batch",
        eventKind: "delivery-created",
        occurredAt: "2026-08-29T04:00:00.000Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        payload: {},
      },
    });
    const opening = activityOpeningBatch(store, "exact");
    const retained = store.appendBatch(opening.items);

    assert.deepEqual(retained.map(({ event }) => event.sequence), [2, 3, 4, 5]);
    assert.deepEqual(retained.map(({ event }) => event.predecessorDigest), [
      created.event.digest,
      retained[0]?.event.digest,
      retained[1]?.event.digest,
      retained[2]?.event.digest,
    ]);
    assert.equal(retained[0]?.revision?.digest, opening.brief.digest);
    assert.equal(retained[1]?.revision, null);
    assert.equal(retained[2]?.revision?.digest, opening.attempt.digest);
    assert.equal(retained[3]?.revision, null);
    assert.deepEqual(store.state().activities, [{
      id: opening.activityId,
      operation: "delivery.prepare",
      family: "agent",
      stage: "effect-intended",
      recovery: {
        kind: "provider",
        resumesAt: "provider-effect-observed",
        exactEffectDigest: opening.effectDigest,
      },
    }]);

    const retried = store.appendBatch(opening.items);
    assert.deepEqual(
      retried.map(({ event }) => event.digest),
      retained.map(({ event }) => event.digest),
    );
    assert.equal(store.listEvents().length, 5);

    assert.throws(() => store.appendBatch(Object.freeze([
      opening.items[1]!,
      opening.items[0]!,
      opening.items[2]!,
      opening.items[3]!,
    ])), code("batch-order"));
    const conflictingLast = Object.freeze({
      ...opening.items[3]!,
      event: Object.freeze({
        ...opening.items[3]!.event,
        occurredAt: "2026-08-29T04:00:04.500Z",
      }),
    });
    assert.throws(() => store.appendBatch(Object.freeze([
      opening.items[0]!,
      opening.items[1]!,
      opening.items[2]!,
      conflictingLast,
    ])), code("event-conflict"));
    assert.throws(() => store.appendBatch(Object.freeze([
      opening.items[0]!,
      opening.items[0]!,
    ])), code("batch-conflict"));
    assert.throws(() => store.appendBatch([]), code("batch-bound"));
    assert.equal(store.listEvents().length, 5);
    store.close();

    const reopened = await openControlRecordStore({
      root,
      identity: selectedIdentity,
      create: false,
    });
    const retriedAfterRestart = reopened.appendBatch(opening.items);
    assert.deepEqual(
      retriedAfterRestart.map(({ event }) => event.digest),
      retained.map(({ event }) => event.digest),
    );
    assert.deepEqual(reopened.state().activities, [{
      id: opening.activityId,
      operation: "delivery.prepare",
      family: "agent",
      stage: "effect-intended",
      recovery: {
        kind: "provider",
        resumesAt: "provider-effect-observed",
        exactEffectDigest: opening.effectDigest,
      },
    }]);
    reopened.close();
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("appendBatch refuses an ambiguous partially retained boundary", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "lifecycle-control-record-store-partial-batch-"));
  try {
    const selectedIdentity = identity("partial-batch");
    const store = await openControlRecordStore({
      root: join(workspace, "store"),
      identity: selectedIdentity,
      create: true,
    });
    store.append({
      event: {
        eventId: "event-delivery-created-partial-batch",
        eventKind: "delivery-created",
        occurredAt: "2026-08-29T04:00:00.000Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        payload: {},
      },
    });
    const opening = activityOpeningBatch(store, "partial");
    store.append(opening.items[0]!);

    assert.throws(() => store.appendBatch(opening.items), code("batch-partial"));
    assert.deepEqual(
      store.listEvents().map(({ eventKind }) => eventKind),
      ["delivery-created", "director-brief-submitted"],
    );
    assert.equal(store.getRevision(opening.brief.recordId, 1)?.digest, opening.brief.digest);
    assert.equal(store.getRevision(opening.attempt.recordId, 1), null);
    assert.equal(store.state().activities.length, 0);
    store.close();
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("appendBatch rolls back staged rows and live replay after a late reducer refusal", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "lifecycle-control-record-store-batch-rollback-"));
  try {
    const selectedIdentity = identity("batch-rollback");
    const root = join(workspace, "store");
    const store = await openControlRecordStore({
      root,
      identity: selectedIdentity,
      create: true,
    });
    store.append({
      event: {
        eventId: "event-delivery-created-batch-rollback",
        eventKind: "delivery-created",
        occurredAt: "2026-08-29T04:00:00.000Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        payload: {},
      },
    });
    const stateBefore = store.state();
    const opening = activityOpeningBatch(store, "rollback");
    const illegalLateEvent: ControlRecordStoreAppend = Object.freeze({
      event: Object.freeze({
        eventId: "event-activity-started-without-brief-batch-rollback",
        eventKind: "activity-started",
        occurredAt: "2026-08-29T04:00:02.500Z",
        actor: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
        payload: Object.freeze({
          activityId: "prepare-without-brief-batch-rollback",
          operation: "delivery.prepare",
        }),
      }),
    });

    assert.throws(() => store.appendBatch(Object.freeze([
      opening.items[0]!,
      opening.items[1]!,
      illegalLateEvent,
    ])), reducerCode("order"));
    assert.deepEqual(store.state(), stateBefore, "a failed fork must not publish into live replay");
    assert.equal(store.getRevision(opening.brief.recordId, 1), null);
    assert.equal(store.listEvents().length, 1);
    store.close();

    const reopened = await openControlRecordStore({
      root,
      identity: selectedIdentity,
      create: false,
      readOnly: true,
    });
    assert.equal(reopened.getRevision(opening.brief.recordId, 1), null);
    assert.equal(reopened.listEvents().length, 1);
    assert.deepEqual(reopened.state(), stateBefore, "SQLite rollback must survive reopen");
    reopened.close();
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("rejects revision gaps, identity reuse, and unretained event subjects", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "lifecycle-control-record-store-refusal-"));
  try {
    const selectedIdentity = identity("refusal");
    const store = await openControlRecordStore({
      root: join(workspace, "store"),
      identity: selectedIdentity,
      create: true,
    });
    const invalidRevision = {
      recordId: "candidate-refusal",
      recordKind: "candidate-revision",
      revision: 2,
      producer: { kind: "runtime" as const, id: "foundation-runtime" },
      semanticAuthor: { kind: "runtime" as const, id: "foundation-runtime" },
      semanticAuthority: "runtime-observed" as const,
      createdAt: "2026-08-29T02:00:00.000Z",
      semanticMarkdown: "# Candidate Revision\n\nRefuse gaps.\n",
      payload: validDeliveryControlPayload("candidate-revision"),
      relationships: [{
        relation: "governed-by",
        target: {
          kind: "work-boundary",
          id: "missing-boundary",
          revision: 1,
          digest: sha256Bytes("missing-boundary"),
        },
      }],
    };
    const compiled = compileControlRecordRevision(selectedIdentity.processId, invalidRevision);
    assert.throws(() => store.append({
      revision: invalidRevision,
      event: {
        eventId: "event-gap",
        eventKind: "candidate-revision-observed",
        occurredAt: "2026-08-29T02:00:00.000Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        subject: { recordId: compiled.recordId, revision: compiled.revision, digest: compiled.digest },
        payload: { activityId: "activity-gap" },
      },
    }), code("candidate-carrier-file-required"));
    assert.equal(store.listEvents().length, 0);

    assert.throws(() => store.append({
      event: {
        eventId: "event-orphan",
        eventKind: "provider-effect-observed",
        occurredAt: "2026-08-29T02:00:01.000Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        subject: {
          recordId: "missing-record",
          revision: 1,
          digest: sha256Bytes("missing"),
        },
        payload: {
          activityId: "activity-orphan",
          effectDigest: sha256Bytes("orphan-effect"),
          outcome: "failed",
        },
      },
    }), code("event-subject"));
    assert.equal(store.listEvents().length, 0);

    const briefInput: ControlRecordRevisionInput = {
      recordId: "brief-refusal",
      recordKind: "director-brief",
      revision: 1,
      producer: { kind: "runtime", id: "foundation-runtime" },
      semanticAuthor: { kind: "director", id: "director-refusal" },
      semanticAuthority: "director-supplied",
      createdAt: "2026-08-29T02:00:02.000Z",
      semanticMarkdown: "# Director Brief\n\nExercise exact refusals.\n",
      payload: { ...validDeliveryControlPayload("director-brief"), scope: { kind: "activity", activityId: "event-brief-refusal" } },
    };
    assert.throws(
      () => appendFinalizedRevision(
        store,
        briefInput,
        "event-brief-refusal",
        "director-brief-submitted",
      ),
      reducerCode("order"),
      "a semantically illegal first event must roll back its revision and event",
    );
    assert.equal(store.listEvents().length, 0);
    assert.equal(store.getRevision(briefInput.recordId, briefInput.revision), null);

    store.append({
      event: {
        eventId: "event-delivery-created-refusal",
        eventKind: "delivery-created",
        occurredAt: "2026-08-29T02:00:01.500Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        payload: {},
      },
    });
    const invalidPayloadBrief = {
      ...briefInput,
      recordId: "brief-invalid-payload",
      payload: {},
    };
    assert.throws(
      () => appendFinalizedRevision(
        store,
        invalidPayloadBrief,
        "event-brief-invalid-payload",
        "director-brief-submitted",
      ),
      schemaCode,
    );
    assert.equal(store.getRevision(invalidPayloadBrief.recordId, 1), null);
    assert.equal(store.listEvents().length, 1);
    const brief = appendFinalizedRevision(
      store,
      briefInput,
      "event-brief-refusal",
      "director-brief-submitted",
    );
    const nullTargetAttempt = {
      recordId: "attempt-null-target",
      recordKind: "agent-attempt",
      revision: 1,
      producer: { kind: "runtime" as const, id: "foundation-runtime" },
      semanticAuthor: { kind: "runtime" as const, id: "foundation-runtime" },
      semanticAuthority: "runtime-derived" as const,
      createdAt: "2026-08-29T02:00:03.000Z",
      semanticMarkdown: "# Agent Attempt\n\nRefuse a floating relationship.\n",
      payload: validDeliveryControlPayload("agent-attempt"),
      relationships: [{
        relation: "uses-brief",
        target: {
          kind: brief.recordKind,
          id: brief.recordId,
          revision: null,
          digest: brief.digest,
        },
      }],
    };
    assert.throws(() => compileControlRecordRevision(
      selectedIdentity.processId,
      nullTargetAttempt as unknown as ControlRecordRevisionInput,
    ), code("relationship"));

    const wrongFinalizationAttempt = {
      ...nullTargetAttempt,
      recordId: "attempt-wrong-finalization",
      createdAt: "2026-08-29T02:00:04.000Z",
      relationships: [{
        relation: "uses-brief",
        target: {
          kind: brief.recordKind,
          id: brief.recordId,
          revision: brief.revision,
          digest: brief.digest,
        },
      }],
    };
    const compiledWrongFinalization = compileControlRecordRevision(
      selectedIdentity.processId,
      wrongFinalizationAttempt,
    );
    assert.throws(() => store.append({
      revision: wrongFinalizationAttempt,
      event: {
        eventId: "event-wrong-finalization",
        eventKind: "provider-effect-observed",
        occurredAt: wrongFinalizationAttempt.createdAt,
        actor: { kind: "runtime", id: "foundation-runtime" },
        subject: {
          recordId: compiledWrongFinalization.recordId,
          revision: compiledWrongFinalization.revision,
          digest: compiledWrongFinalization.digest,
        },
        payload: {
          activityId: "activity-wrong-finalization",
          effectDigest: sha256Bytes("wrong-finalization-effect"),
          outcome: "failed",
        },
      },
    }), code("revision-finalization"));
    assert.throws(() => store.append({
      event: {
        eventId: "event-wrong-subject-kind",
        eventKind: "candidate-revision-observed",
        occurredAt: "2026-08-29T02:00:05.000Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        subject: { recordId: brief.recordId, revision: brief.revision, digest: brief.digest },
        payload: { activityId: "activity-wrong-subject" },
      },
    }), code("event-subject-kind"));
    assert.equal(store.listEvents().length, 2);
    assert.equal((await store.verifyIntegrity()).eventCount, 2);
    store.close();

    await assert.rejects(openControlRecordStore({
      root: join(workspace, "store"),
      identity: identity("different"),
      create: false,
    }), code("metadata"));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("appendWithFiles retains only exact Receipt-owned bytes and retries idempotently", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "lifecycle-control-record-store-files-"));
  try {
    const selectedIdentity = identity("files");
    const root = join(workspace, "store");
    const store = await openControlRecordStore({ root, identity: selectedIdentity, create: true });
    assert.equal("retainFile" in store, false, "free-standing file retention is not an available seam");
    const activity = prepareFailedAgentActivity(store, "files");
    const file = Object.freeze({
      bytes: Buffer.from("bounded provider evidence\n", "utf8"),
      mediaType: "text/plain",
      purpose: "provider-observation",
      createdAt: "2026-08-29T03:00:00.000Z",
    });
    const receipt = fileReceiptAppend(store, activity, "files", file);
    assert.equal(receipt.descriptor.digest, sha256Bytes(file.bytes));

    const retained = await store.appendWithFiles({ files: [file], appends: [receipt.append] });
    assert.deepEqual(retained.files, [receipt.descriptor]);
    assert.equal(retained.appends[0]?.revision?.recordId, receipt.revision.recordId);
    const repeated = await store.appendWithFiles({ files: [file], appends: [receipt.append] });
    assert.deepEqual(repeated, retained);
    assert.equal((await store.verifyIntegrity()).referencedFileCount, 1);
    assert.deepEqual(store.listRetainedFiles(), [receipt.descriptor]);
    const reopenedBytesBeforeRestart = await store.readRetainedFile(receipt.descriptor.digest);
    assert.deepEqual(reopenedBytesBeforeRestart?.descriptor, receipt.descriptor);
    assert.deepEqual(
      Buffer.from(reopenedBytesBeforeRestart?.bytes ?? new Uint8Array()),
      Buffer.from(file.bytes),
    );

    const conflictingFile = Object.freeze({ ...file, purpose: "different-purpose" });
    const conflictingReceipt = fileReceiptAppend(
      store,
      activity,
      "files-conflict",
      conflictingFile,
      "2026-08-29T03:00:09.000Z",
    );
    await assert.rejects(store.appendWithFiles({
      files: [conflictingFile],
      appends: [conflictingReceipt.append],
    }), code("file-conflict"));
    assert.deepEqual(store.listRetainedFiles(), [receipt.descriptor]);
    store.close();

    const restarted = await openControlRecordStore({
      root,
      identity: selectedIdentity,
      create: false,
      readOnly: true,
    });
    const reopenedBytesAfterRestart = await restarted.readRetainedFile(
      receipt.descriptor.digest,
    );
    assert.deepEqual(reopenedBytesAfterRestart?.descriptor, receipt.descriptor);
    assert.deepEqual(
      Buffer.from(reopenedBytesAfterRestart?.bytes ?? new Uint8Array()),
      Buffer.from(file.bytes),
    );
    assert.equal(
      await restarted.readRetainedFile(sha256Bytes("absent retained file")),
      null,
    );
    restarted.close();

    const carrier = join(
      controlRecordStorePaths(root).files,
      `sha256-${receipt.descriptor.digest.slice("sha256:".length)}`,
    );
    await writeFile(carrier, Buffer.from("tampered\n", "utf8"));
    await assert.rejects(
      openControlRecordStore({ root, identity: selectedIdentity, create: false }),
      code("file-integrity"),
    );

    const unboundStore = await openControlRecordStore({
      root: join(workspace, "unbound-store"),
      identity: identity("unbound-file"),
      create: true,
    });
    const unboundFile = Object.freeze({
      bytes: Buffer.from("unbound adjacent material\n", "utf8"),
      mediaType: "text/plain",
      purpose: "provider-observation",
      createdAt: "2026-08-29T03:01:00.000Z",
    });
    await assert.rejects(unboundStore.appendWithFiles({
      files: [unboundFile],
      appends: [{
        event: {
          eventId: "event-unbound-file",
          eventKind: "delivery-created",
          occurredAt: "2026-08-29T03:01:00.000Z",
          actor: { kind: "runtime", id: "foundation-runtime" },
          payload: {},
        },
      }],
    }), code("file-unbound"));
    assert.deepEqual(await readdir(controlRecordStorePaths(join(workspace, "unbound-store")).files), []);
    assert.equal((await unboundStore.verifyIntegrity()).referencedFileCount, 0);
    unboundStore.close();
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("file operation batch atomically retains bytes, Receipt, and exact support CAS", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "lifecycle-control-record-store-file-support-"));
  try {
    const selectedIdentity = identity("file-support");
    const root = join(workspace, "store");
    const store = await openControlRecordStore({ root, identity: selectedIdentity, create: true });
    const activity = prepareFailedAgentActivity(store, "file-support");
    const support = store.putOperationSupport({
      activityId: activity.activityId,
      supportKind: "agent-operation",
      payload: Object.freeze({ stage: "observed" }),
      expected: null,
    });
    const file = Object.freeze({
      bytes: Buffer.from("exact check stdout\n", "utf8"),
      mediaType: "text/plain",
      purpose: "stdout",
      createdAt: "2026-08-29T03:00:08.000Z",
    });
    const receipt = fileReceiptAppend(store, activity, "file-support", file);
    const input = Object.freeze({
      files: Object.freeze([file]),
      appends: Object.freeze([receipt.append]),
      supportMutations: Object.freeze([Object.freeze({
        action: "put" as const,
        value: Object.freeze({
          activityId: activity.activityId,
          supportKind: "agent-operation",
          payload: Object.freeze({ stage: "receipt-retained" }),
          expected: Object.freeze({
            generation: support.generation,
            payloadDigest: support.payloadDigest,
          }),
        }),
      })]),
    });
    let supportInterleavingBlocked = false;
    await assert.rejects(
      store.commitOperationBatchWithFiles(Object.freeze({
        ...input,
        onStage: (stage) => {
          if (stage === "carrier-durable") {
            assert.throws(
              () => store.putOperationSupport({
                activityId: activity.activityId,
                supportKind: "agent-operation",
                payload: Object.freeze({ stage: "interleaved" }),
                expected: Object.freeze({
                  generation: support.generation,
                  payloadDigest: support.payloadDigest,
                }),
              }),
              (error: unknown) => error instanceof FoundationError &&
                error.code === "lifecycle.control-record-store.file-batch-conflict",
            );
            supportInterleavingBlocked = true;
          }
          if (stage === "append-committed") throw new Error("lost file operation return");
        },
      })),
      /lost file operation return/u,
    );
    assert.equal(supportInterleavingBlocked, true);
    assert.equal(store.getOperationSupport(activity.activityId)?.payload.stage, "receipt-retained");
    assert.equal(store.getRevision(receipt.revision.recordId, 1)?.recordKind, "execution-receipt");

    const retried = await store.commitOperationBatchWithFiles(input);
    assert.equal(retried.files[0]?.digest, sha256Bytes(file.bytes));
    assert.equal(retried.appends[0]?.revision?.recordId, receipt.revision.recordId);
    assert.equal(retried.supportMutations[0]?.support?.payload.stage, "receipt-retained");
    const carrier = join(
      controlRecordStorePaths(root).files,
      `sha256-${sha256Bytes(file.bytes).slice("sha256:".length)}`,
    );
    assert.deepEqual(await readFile(carrier), file.bytes);
    assert.equal((await store.verifyIntegrity()).referencedFileCount, 1);
    store.close();
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("appendWithFiles resumes every durable custody crash stage and blocks sealing while pending", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "lifecycle-control-record-store-file-crash-"));
  try {
    const stages = Object.freeze([
      "pending-recorded",
      "carrier-durable",
      "descriptor-recorded",
      "append-committed",
      "pending-cleaned",
    ] as const);
    for (const [index, interruptedStage] of stages.entries()) {
      const selectedIdentity = identity(`file-crash-${index}`);
      const root = join(workspace, `store-${index}`);
      const store = await openControlRecordStore({ root, identity: selectedIdentity, create: true });
      const activity = prepareFailedAgentActivity(store, `file-crash-${index}`);
      const file = Object.freeze({
        bytes: Buffer.from(`crash-stage-${index}\n`, "utf8"),
        mediaType: "text/plain",
        purpose: "provider-observation",
        createdAt: "2026-08-29T03:00:00.000Z",
      });
      const receipt = fileReceiptAppend(store, activity, `file-crash-${index}`, file);
      const inventoryBeforeCustody = store.logicalInventoryDigest();
      let interrupted = false;
      await assert.rejects(store.appendWithFiles({
        files: [file],
        appends: [receipt.append],
        onStage(stage) {
          if (!interrupted && stage === interruptedStage) {
            interrupted = true;
            throw new Error(`interrupt after ${stage}`);
          }
        },
      }), /interrupt after/u);
      assert.equal(interrupted, true);
      store.close();

      const recovered = await openControlRecordStore({
        root,
        identity: selectedIdentity,
        create: false,
      });
      assert.equal((await recovered.verifyIntegrity()).eventCount >= 7, true);
      const custodyPending = interruptedStage !== "pending-cleaned";
      if (custodyPending) {
        assert.throws(() => recovered.append(receipt.append), code("file-batch-conflict"));
        assert.throws(() => recovered.appendBatch([receipt.append]), code("file-batch-conflict"));
        const conflictingFile = Object.freeze({
          ...file,
          bytes: Buffer.from(`conflicting-crash-stage-${index}\n`, "utf8"),
        });
        const conflictingReceipt = fileReceiptAppend(
          recovered,
          activity,
          `file-crash-conflict-${index}`,
          conflictingFile,
        );
        await assert.rejects(recovered.appendWithFiles({
          files: [conflictingFile],
          appends: [conflictingReceipt.append],
        }), code("file-batch-conflict"));
        await assert.rejects(recovered.seal({
          closure: { recordId: "missing", revision: 1, digest: sha256Bytes("missing") },
          sealedAt: "2026-08-29T03:00:10.000Z",
        }), code("seal-pending-files"));
      }
      if (
        interruptedStage === "pending-recorded" ||
        interruptedStage === "carrier-durable" ||
        interruptedStage === "descriptor-recorded"
      ) {
        assert.deepEqual(recovered.listRetainedFiles(), []);
        assert.equal(recovered.logicalInventoryDigest(), inventoryBeforeCustody);
      } else {
        assert.deepEqual(recovered.listRetainedFiles(), [receipt.descriptor]);
      }
      const inventoryBeforeRecovery = recovered.logicalInventoryDigest();
      const completed = await recovered.appendWithFiles({ files: [file], appends: [receipt.append] });
      assert.deepEqual(completed.files, [receipt.descriptor]);
      assert.equal((await recovered.verifyIntegrity()).referencedFileCount, 1);
      assert.deepEqual(recovered.listRetainedFiles(), [receipt.descriptor]);
      if (interruptedStage === "append-committed" || interruptedStage === "pending-cleaned") {
        assert.equal(recovered.logicalInventoryDigest(), inventoryBeforeRecovery);
      }
      recovered.close();
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("deterministic append failure removes only newly pending file custody", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "lifecycle-control-record-store-file-cleanup-"));
  try {
    const selectedIdentity = identity("file-cleanup");
    const root = join(workspace, "store");
    const store = await openControlRecordStore({ root, identity: selectedIdentity, create: true });
    const activity = prepareFailedAgentActivity(store, "file-cleanup");
    const retainedInput = Object.freeze({
      bytes: Buffer.from("preexisting provider evidence\n", "utf8"),
      mediaType: "text/plain",
      purpose: "provider-observation",
      createdAt: "2026-08-29T03:00:00.000Z",
    });
    const firstReceipt = fileReceiptAppend(store, activity, "file-cleanup-first", retainedInput);
    await store.appendWithFiles({ files: [retainedInput], appends: [firstReceipt.append] });

    const newInput = Object.freeze({
      bytes: Buffer.from("new pending provider evidence\n", "utf8"),
      mediaType: "text/plain",
      purpose: "provider-observation",
      createdAt: "2026-08-29T03:00:09.000Z",
    });
    const newDescriptor = compileControlRecordFile(newInput);
    const invalidRevision: ControlRecordRevisionInput = Object.freeze({
      ...firstReceipt.revision,
      recordId: "receipt-file-cleanup-invalid",
      createdAt: "2026-08-29T03:00:09.000Z",
      payload: Object.freeze({
        ...firstReceipt.revision.payload,
        rawMaterials: Object.freeze([retainedInput, newInput].map((selected) => {
          const descriptor = compileControlRecordFile(selected);
          return Object.freeze({
            availability: "retained",
            reference: Object.freeze({
              digest: descriptor.digest,
              byteLength: descriptor.byteLength,
              mediaType: descriptor.mediaType,
              purpose: descriptor.purpose,
            }),
          });
        })),
      }),
    });
    const compiledInvalid = compileControlRecordRevision(store.identity.processId, invalidRevision);
    await assert.rejects(store.appendWithFiles({
      files: [retainedInput, newInput],
      appends: [{
        revision: invalidRevision,
        event: {
          eventId: "event-receipt-file-cleanup-invalid",
          eventKind: "execution-receipt-recorded",
          occurredAt: invalidRevision.createdAt,
          actor: { kind: "runtime", id: "foundation-runtime" },
          subject: {
            recordId: compiledInvalid.recordId,
            revision: compiledInvalid.revision,
            digest: compiledInvalid.digest,
          },
          payload: { activityId: activity.activityId },
        },
      }],
    }), reducerCode("duplicate"));

    assert.deepEqual(store.listRetainedFiles(), [firstReceipt.descriptor]);
    assert.equal(store.getRevision(invalidRevision.recordId, 1), null);
    assert.equal((await store.verifyIntegrity()).referencedFileCount, 1);
    const names = await readdir(controlRecordStorePaths(root).files);
    assert.deepEqual(names, [`sha256-${firstReceipt.descriptor.digest.slice("sha256:".length)}`]);
    assert.equal(names.includes(`sha256-${newDescriptor.digest.slice("sha256:".length)}`), false);
    store.close();
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("pending file integrity rejects a temporary and durable carrier for one entry", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "lifecycle-control-record-store-file-integrity-"));
  try {
    const selectedIdentity = identity("file-integrity");
    const root = join(workspace, "store");
    const store = await openControlRecordStore({ root, identity: selectedIdentity, create: true });
    const activity = prepareFailedAgentActivity(store, "file-integrity");
    const file = Object.freeze({
      bytes: Buffer.from("pending file integrity\n", "utf8"),
      mediaType: "text/plain",
      purpose: "provider-observation",
      createdAt: "2026-08-29T03:00:00.000Z",
    });
    const receipt = fileReceiptAppend(store, activity, "file-integrity", file);
    await assert.rejects(store.appendWithFiles({
      files: [file],
      appends: [receipt.append],
      onStage(stage) {
        if (stage === "carrier-durable") throw new Error("interrupt with durable carrier");
      },
    }), /interrupt with durable carrier/u);
    store.close();

    const paths = controlRecordStorePaths(root);
    const db = new DatabaseSync(paths.database);
    const pending = db.prepare(`
      SELECT batch_digest FROM pending_file_batches WHERE singleton = 1
    `).get() as Readonly<{ batch_digest: string }>;
    db.close();
    const temporaryName = [
      ".pending-file-",
      pending.batch_digest.slice("sha256:".length),
      "-",
      receipt.descriptor.digest.slice("sha256:".length),
      ".tmp",
    ].join("");
    await writeFile(join(paths.drafts, temporaryName), file.bytes, { mode: 0o600 });
    await assert.rejects(openControlRecordStore({
      root,
      identity: selectedIdentity,
      create: false,
    }), code("pending-file-integrity"));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("SQLite guards refuse mutation and opening reapplies the closed event descriptor", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "lifecycle-control-record-store-immutable-"));
  try {
    const selectedIdentity = identity("immutable");
    const root = join(workspace, "store");
    const store = await openControlRecordStore({ root, identity: selectedIdentity, create: true });
    const created = store.append({
      event: {
        eventId: "event-delivery-created-immutable",
        eventKind: "delivery-created",
        occurredAt: "2026-08-29T04:00:00.000Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        payload: {},
      },
    });
    const revisionInput = {
      recordId: "brief-immutable",
      recordKind: "director-brief",
      revision: 1,
      producer: { kind: "runtime" as const, id: "foundation-runtime" },
      semanticAuthor: { kind: "director" as const, id: "director-immutable" },
      semanticAuthority: "director-supplied" as const,
      createdAt: "2026-08-29T04:00:00.000Z",
      semanticMarkdown: "# Objective\n\nStay immutable.\n",
      payload: { ...validDeliveryControlPayload("director-brief"), scope: { kind: "activity", activityId: "activity-immutable" } },
    };
    const revision = compileControlRecordRevision(selectedIdentity.processId, revisionInput);
    store.append({
      revision: revisionInput,
      event: {
        eventId: "event-immutable",
        eventKind: "director-brief-submitted",
        occurredAt: "2026-08-29T04:00:00.000Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        subject: { recordId: revision.recordId, revision: 1, digest: revision.digest },
        payload: { activityId: "activity-immutable" },
      },
    });
    store.checkpoint();
    store.close();

    const db = new DatabaseSync(controlRecordStorePaths(root).database);
    assert.throws(() => db.exec("UPDATE record_revisions SET semantic_markdown = 'changed'"), /immutable/u);
    assert.throws(() => db.exec("DELETE FROM journal_events"), /immutable/u);
    const tamperedEvent = compileControlRecordEvent({
      storeId: selectedIdentity.storeId,
      processId: selectedIdentity.processId,
      sequence: 2,
      predecessorDigest: created.event.digest,
      event: {
        eventId: "event-immutable",
        eventKind: "candidate-revision-observed",
        occurredAt: "2026-08-29T04:00:00.000Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        subject: { recordId: revision.recordId, revision: 1, digest: revision.digest },
        payload: { activityId: "activity-immutable" },
      },
    });
    const immutableTrigger = db.prepare(`
      SELECT sql FROM sqlite_schema WHERE name = 'journal_events_immutable_update'
    `).get() as Readonly<{ sql: string }>;
    db.exec("DROP TRIGGER journal_events_immutable_update");
    db.prepare(`
      UPDATE journal_events SET event_kind = ?, digest = ? WHERE event_id = ?
    `).run(tamperedEvent.eventKind, tamperedEvent.digest, tamperedEvent.eventId);
    db.exec(immutableTrigger.sql);
    db.close();

    await assert.rejects(openControlRecordStore({
      root,
      identity: selectedIdentity,
      create: false,
      readOnly: true,
    }), code("event-subject-kind"));

    const schemaTamper = new DatabaseSync(controlRecordStorePaths(root).database);
    schemaTamper.exec("DROP TRIGGER referenced_files_immutable_delete");
    schemaTamper.close();
    await assert.rejects(openControlRecordStore({
      root,
      identity: selectedIdentity,
      create: false,
      readOnly: true,
    }), code("database-schema"));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("seals one exact Closure inventory and atomically archives the complete store off HEAD", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "lifecycle-control-record-store-archive-"));
  try {
    const selectedIdentity = identity("archive");
    const activeParent = join(workspace, "active");
    const archiveParent = join(workspace, "archive");
    const activeRoot = join(activeParent, "delivery-archive");
    const store = await openControlRecordStore({ root: activeRoot, identity: selectedIdentity, create: true });
    const terminalSupportInput = Object.freeze({
      bytes: Buffer.from("terminal support\n", "utf8"),
      mediaType: "text/plain",
      purpose: "terminal-observation",
      createdAt: "2026-08-29T05:00:00Z",
    });
    const terminalSupport = compileControlRecordFile(terminalSupportInput);
    store.append({
      event: {
        eventId: "event-delivery-created-archive",
        eventKind: "delivery-created",
        occurredAt: "2026-08-29T05:00:00Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        payload: {},
      },
    });
    const prepareActivity = "prepare-archive";
    const brief = appendFinalizedRevision(store, {
      recordId: "brief-archive",
      recordKind: "director-brief",
      revision: 1,
      producer: { kind: "runtime", id: "foundation-runtime" },
      semanticAuthor: { kind: "director", id: "director-archive" },
      semanticAuthority: "director-supplied",
      createdAt: "2026-08-29T05:00:01Z",
      semanticMarkdown: "# Director Brief\n\nAttempt one bounded reconnaissance pass.\n",
      payload: { ...validDeliveryControlPayload("director-brief"), scope: { kind: "activity", activityId: prepareActivity } },
    }, "event-brief-archive", "director-brief-submitted", prepareActivity);
    store.append({
      event: {
        eventId: "event-prepare-started-archive",
        eventKind: "activity-started",
        occurredAt: "2026-08-29T05:00:02Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        payload: { activityId: prepareActivity, operation: "delivery.prepare" },
      },
    });
    const attempt = appendFinalizedRevision(store, {
      recordId: "attempt-archive",
      recordKind: "agent-attempt",
      revision: 1,
      producer: { kind: "runtime", id: "foundation-runtime" },
      semanticAuthor: { kind: "runtime", id: "foundation-runtime" },
      semanticAuthority: "runtime-derived",
      createdAt: "2026-08-29T05:00:03Z",
      semanticMarkdown: "# Agent Attempt\n\nPrepare the boundary proposal.\n",
      payload: Object.freeze({
        ...validDeliveryControlPayload("agent-attempt"),
        activityId: prepareActivity,
      }),
      relationships: [{
        relation: "uses-brief",
        target: { kind: brief.recordKind, id: brief.recordId, revision: brief.revision, digest: brief.digest },
      }],
    }, "event-attempt-archive", "agent-attempt-prepared", prepareActivity);
    const providerEffect = sha256Bytes("provider-effect-archive");
    store.append({
      event: {
        eventId: "event-provider-intended-archive",
        eventKind: "provider-effect-intended",
        occurredAt: "2026-08-29T05:00:04Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        subject: { recordId: attempt.recordId, revision: attempt.revision, digest: attempt.digest },
        payload: { activityId: prepareActivity, effectDigest: providerEffect },
      },
    });
    store.append({
      event: {
        eventId: "event-provider-observed-archive",
        eventKind: "provider-effect-observed",
        occurredAt: "2026-08-29T05:00:05Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        subject: { recordId: attempt.recordId, revision: attempt.revision, digest: attempt.digest },
        payload: { activityId: prepareActivity, effectDigest: providerEffect, outcome: "failed" },
      },
    });
    store.append({
      event: {
        eventId: "event-work-product-abandoned-archive",
        eventKind: "agent-work-product-abandoned",
        occurredAt: "2026-08-29T05:00:06Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        subject: { recordId: attempt.recordId, revision: attempt.revision, digest: attempt.digest },
        payload: { activityId: prepareActivity },
      },
    });
    const archiveReceiptInput: ControlRecordRevisionInput = {
      recordId: "receipt-archive",
      recordKind: "execution-receipt",
      revision: 1,
      producer: { kind: "runtime", id: "foundation-runtime" },
      semanticAuthor: { kind: "runtime", id: "foundation-runtime" },
      semanticAuthority: "runtime-observed",
      createdAt: "2026-08-29T05:00:07Z",
      semanticMarkdown: "# Execution Receipt\n\nThe failed provider outcome was observed.\n",
      payload: Object.freeze({
        ...validExecutionReceiptPayload(),
        activityId: prepareActivity,
        rawMaterials: Object.freeze([Object.freeze({
          availability: "retained",
          reference: Object.freeze({
            digest: terminalSupport.digest,
            byteLength: terminalSupport.byteLength,
            mediaType: terminalSupport.mediaType,
            purpose: terminalSupport.purpose,
          }),
        })]),
      }),
      relationships: [{
        relation: "observes-attempt",
        target: { kind: attempt.recordKind, id: attempt.recordId, revision: attempt.revision, digest: attempt.digest },
      }],
    };
    const archiveReceipt = compileControlRecordRevision(
      store.identity.processId,
      archiveReceiptInput,
    );
    await store.appendWithFiles({
      files: [terminalSupportInput],
      appends: [{
        revision: archiveReceiptInput,
        event: {
          eventId: "event-receipt-archive",
          eventKind: "execution-receipt-recorded",
          occurredAt: archiveReceiptInput.createdAt,
          actor: { kind: "runtime", id: "foundation-runtime" },
          subject: {
            recordId: archiveReceipt.recordId,
            revision: archiveReceipt.revision,
            digest: archiveReceipt.digest,
          },
          payload: { activityId: prepareActivity },
        },
      }],
    });
    store.append({
      event: {
        eventId: "event-prepare-completed-archive",
        eventKind: "activity-completed",
        occurredAt: "2026-08-29T05:00:08Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        payload: { activityId: prepareActivity, outcome: "failed" },
      },
    });

    const noShipActivity = "no-ship-archive";
    store.append({
      event: {
        eventId: "event-no-ship-started-archive",
        eventKind: "activity-started",
        occurredAt: "2026-08-29T05:00:09Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        payload: { activityId: noShipActivity, operation: "delivery.no-ship" },
      },
    });
    const decision = appendFinalizedRevision(store, {
      recordId: "decision-archive",
      recordKind: "director-decision",
      revision: 1,
      producer: { kind: "runtime", id: "foundation-runtime" },
      semanticAuthor: { kind: "director", id: "director-archive" },
      semanticAuthority: "director-authenticated",
      createdAt: "2026-08-29T05:00:10Z",
      semanticMarkdown: "# Director Decision\n\nNo-ship is authenticated.\n",
      payload: validDeliveryControlPayload("director-decision"),
    }, "event-decision-archive", "director-decision-authenticated", noShipActivity);
    const transactionEffect = sha256Bytes("transaction-effect-archive");
    const transactionFacts = Object.freeze({
      schema: "lifecycle.terminal-repository-effect-observation.v1",
      ref: "refs/heads/main",
      commit: "a".repeat(40),
      tree: "b".repeat(40),
      objectFormat: "sha1",
    });
    store.append({
      event: {
        eventId: "event-transaction-intended-archive",
        eventKind: "transaction-effect-intended",
        occurredAt: "2026-08-29T05:00:11Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        subject: { recordId: decision.recordId, revision: decision.revision, digest: decision.digest },
        payload: { activityId: noShipActivity, effectDigest: transactionEffect },
      },
    });
    store.append({
      event: {
        eventId: "event-transaction-observed-archive",
        eventKind: "transaction-effect-observed",
        occurredAt: "2026-08-29T05:00:12Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        subject: { recordId: decision.recordId, revision: decision.revision, digest: decision.digest },
        payload: {
          activityId: noShipActivity,
          effectDigest: transactionEffect,
          outcome: "applied",
          facts: transactionFacts,
          factsDigest: digestCanonical(transactionFacts),
        },
      },
    });
    const closureInput = {
      recordId: "closure-archive",
      recordKind: "closure",
      revision: 1,
      producer: { kind: "runtime" as const, id: "foundation-runtime" },
      semanticAuthor: { kind: "runtime" as const, id: "foundation-runtime" },
      semanticAuthority: "runtime-derived" as const,
      createdAt: "2026-08-29T05:00:13Z",
      semanticMarkdown: "# Delivery Closure\n\nThe Delivery closed no-ship.\n",
      payload: validDeliveryControlPayload("closure"),
      relationships: [{
        relation: "closes-with",
        target: {
          kind: decision.recordKind,
          id: decision.recordId,
          revision: decision.revision,
          digest: decision.digest,
        },
      }],
    };
    const closure = compileControlRecordRevision(selectedIdentity.processId, closureInput);
    const appended = store.append({
      revision: closureInput,
      event: {
        eventId: "event-closure-archive",
        eventKind: "closure-recorded",
        occurredAt: "2026-08-29T05:00:13Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        subject: { recordId: closure.recordId, revision: closure.revision, digest: closure.digest },
        payload: { activityId: noShipActivity },
      },
    });
    const liveSupport = store.putOperationSupport({
      activityId: noShipActivity,
      supportKind: "transaction-operation",
      payload: { stage: "cleanup-pending" },
      expected: null,
    });
    const inventoryWithSupport = store.logicalInventoryDigest();
    await assert.rejects(store.seal({
      closure: { recordId: closure.recordId, revision: closure.revision, digest: closure.digest },
      sealedAt: "2026-08-29T05:00:14Z",
    }), code("seal-operation-support"));
    assert.equal(store.logicalInventoryDigest(), inventoryWithSupport);
    store.deleteOperationSupport(noShipActivity, {
      generation: liveSupport.generation,
      payloadDigest: liveSupport.payloadDigest,
    });
    const seal = await store.seal({
      closure: { recordId: closure.recordId, revision: closure.revision, digest: closure.digest },
      sealedAt: "2026-08-29T05:00:14Z",
    });
    assert.equal(seal.head.digest, appended.event.digest);
    assert.equal(seal.logicalInventoryDigest, store.logicalInventoryDigest());
    assert.deepEqual(await store.seal({
      closure: { recordId: closure.recordId, revision: closure.revision, digest: closure.digest },
      sealedAt: "2026-08-29T05:00:14Z",
    }), seal);
    assert.throws(() => store.putOperationSupport({
      activityId: "late-activity",
      supportKind: "provider-operation",
      payload: {},
      expected: null,
    }), code("sealed"));
    assert.throws(() => store.deleteOperationSupport(noShipActivity, {
      generation: liveSupport.generation,
      payloadDigest: liveSupport.payloadDigest,
    }), code("sealed"));
    assert.throws(() => store.append({
      event: {
        eventId: "event-after-closure",
        eventKind: "activity-started",
        occurredAt: "2026-08-29T05:00:08Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        payload: { activityId: "late-activity", operation: "delivery.continue" },
      },
    }), code("sealed"));
    await assert.rejects(store.appendWithFiles({
      files: [terminalSupportInput],
      appends: [{
        revision: archiveReceiptInput,
        event: {
          eventId: "event-receipt-archive",
          eventKind: "execution-receipt-recorded",
          occurredAt: archiveReceiptInput.createdAt,
          actor: { kind: "runtime", id: "foundation-runtime" },
          subject: {
            recordId: archiveReceipt.recordId,
            revision: archiveReceipt.revision,
            digest: archiveReceipt.digest,
          },
          payload: { activityId: prepareActivity },
        },
      }],
    }), code("sealed"));
    store.close();

    const activePaths = controlRecordStorePaths(activeRoot);
    const leftoverDraft = join(activePaths.drafts, "leftover-draft");
    await writeFile(leftoverDraft, "unfinished\n", { mode: 0o600 });
    await assert.rejects(archiveControlRecordStore({
      activeRoot,
      archiveParent,
      identity: selectedIdentity,
      archivedAt: "2026-08-29T05:00:15Z",
    }), code("seal-drafts"));
    await rm(leftoverDraft);
    const duplicateMarkdown = join(activeRoot, "closure.md");
    await writeFile(duplicateMarkdown, "# Duplicate\n", { mode: 0o600 });
    await assert.rejects(archiveControlRecordStore({
      activeRoot,
      archiveParent,
      identity: selectedIdentity,
      archivedAt: "2026-08-29T05:00:15Z",
    }), code("archive-layout"));
    await rm(duplicateMarkdown);

    const archived = await archiveControlRecordStore({
      activeRoot,
      archiveParent,
      identity: selectedIdentity,
      archivedAt: "2026-08-29T05:00:15Z",
    });
    await assert.rejects(lstat(activeRoot), (error: unknown) =>
      (error as NodeJS.ErrnoException).code === "ENOENT");
    assert.equal((await lstat(archived.archiveRoot)).isDirectory(), true);
    assert.equal(archived.manifest.seal.logicalInventoryDigest, seal.logicalInventoryDigest);
    assert.equal(
      sha256Bytes(await readFile(join(archived.archiveRoot, "archive-manifest.json"))),
      archived.manifestDigest,
    );
    const openedArchive = await openArchivedControlRecordStore({
      archiveRoot: archived.archiveRoot,
      identity: selectedIdentity,
      archivedAt: "2026-08-29T05:00:15Z",
    });
    assert.equal(openedArchive.store.readOnly, true);
    assert.equal(openedArchive.store.archiveLayout, true);
    assert.equal(openedArchive.store.logicalInventoryDigest(), seal.logicalInventoryDigest);
    openedArchive.store.close();

    await rename(archived.archiveRoot, activeRoot);
    const resumedPreparedArchive = await archiveControlRecordStore({
      activeRoot,
      archiveParent,
      identity: selectedIdentity,
      archivedAt: "2026-08-29T05:00:15Z",
    });
    assert.equal(resumedPreparedArchive.archiveRoot, archived.archiveRoot);
    assert.equal(resumedPreparedArchive.manifestDigest, archived.manifestDigest);

    const retriedArchive = await archiveControlRecordStore({
      activeRoot,
      archiveParent,
      identity: selectedIdentity,
      archivedAt: "2026-08-29T05:00:15Z",
    });
    assert.equal(retriedArchive.archiveRoot, archived.archiveRoot);
    assert.equal(retriedArchive.manifestDigest, archived.manifestDigest);
    await assert.rejects(archiveControlRecordStore({
      activeRoot,
      archiveParent,
      identity: selectedIdentity,
      archivedAt: "2026-08-29T05:00:16Z",
    }), code("archive-conflict"));
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
