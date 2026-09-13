import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DIRECTOR_BRIEF_OPERATIONS,
  DIRECTOR_BRIEF_TEMPLATE_PROFILE_BY_OPERATION,
  openAgentActivity,
} from "../../src/foundation/control/director-brief.js";
import { openControlRecordStore } from "../../src/foundation/control/store.js";
import { CONTROL_RECORD_STORE_SCHEMA } from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import { sha256Bytes } from "../../src/foundation/validation/canonical.js";

async function storeAt(root: string, suffix: string) {
  const createdAt = "2026-08-29T14:00:00.000Z";
  const store = await openControlRecordStore({
    root: join(root, `store-${suffix}`),
    create: true,
    identity: {
      schema: CONTROL_RECORD_STORE_SCHEMA,
      storeId: `store-director-brief-${suffix}`,
      targetId: `target-director-brief-${suffix}`,
      processKind: "delivery",
      processId: `delivery-director-brief-${suffix}`,
      createdAt,
    },
  });
  return { store, createdAt } as const;
}

function appendDeliveryCreated(
  store: Awaited<ReturnType<typeof storeAt>>["store"],
  occurredAt: string,
  suffix: string,
): void {
  store.append({
    event: {
      eventId: `event-delivery-created-${suffix}`,
      eventKind: "delivery-created",
      occurredAt,
      actor: { kind: "runtime", id: "foundation-runtime" },
      payload: {},
    },
  });
}

test("Director Brief compilation owns normalization and atomically opens its Agent activity", async () => {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-director-brief-"));
  try {
    const { store, createdAt } = await storeAt(root, "prepare");
    appendDeliveryCreated(store, createdAt, "prepare");
    const rawMarkdown = "# Director Brief\n\nReconnoiter this exact objective.\n\n\n";
    const normalizedMarkdown = "# Director Brief\n\nReconnoiter this exact objective.\n";
    const input = {
      store,
      activityId: "activity-prepare-one",
      operation: "delivery.prepare" as const,
      semanticMarkdown: rawMarkdown,
      submittedAt: "2026-08-29T14:00:01.000Z",
      startedAt: "2026-08-29T14:00:02.000Z",
      directorId: "director-one",
      runtimeId: "foundation-runtime",
    };
    const submitted = openAgentActivity(input);

    assert.match(submitted.revision.recordId, /^director-brief-[a-f0-9]{64}$/u);
    assert.match(submitted.briefEvent.eventId, /^event-director-brief-submitted-[a-f0-9]{64}$/u);
    assert.equal(submitted.revision.revision, 1);
    assert.equal(submitted.revision.recordKind, "director-brief");
    assert.equal(submitted.revision.semanticMarkdown, normalizedMarkdown);
    assert.deepEqual(submitted.revision.producer, { kind: "runtime", id: "foundation-runtime" });
    assert.deepEqual(submitted.revision.semanticAuthor, { kind: "director", id: "director-one" });
    assert.equal(submitted.revision.semanticAuthority, "director-supplied");
    assert.deepEqual(submitted.revision.relationships, []);
    assert.deepEqual(submitted.revision.payload, {
      schema: "lifecycle.director-brief-payload.v2",
      scope: { kind: "activity", activityId: input.activityId },
      inputProfile: "delivery.prepare",
      templateProfileId: "director-brief.prepare-v1",
      semanticMarkdownDigest: sha256Bytes(normalizedMarkdown),
      submission: {
        rawDigest: sha256Bytes(rawMarkdown),
        rawByteLength: Buffer.byteLength(rawMarkdown, "utf8"),
        normalizedByteLength: Buffer.byteLength(normalizedMarkdown, "utf8"),
      },
    });
    assert.equal(submitted.rawDigest, sha256Bytes(rawMarkdown));
    assert.equal(submitted.rawByteLength, Buffer.byteLength(rawMarkdown, "utf8"));
    assert.equal(submitted.normalizedDigest, sha256Bytes(normalizedMarkdown));
    assert.equal(submitted.normalizedByteLength, Buffer.byteLength(normalizedMarkdown, "utf8"));
    assert.equal(submitted.briefEvent.eventKind, "director-brief-submitted");
    assert.deepEqual(submitted.briefEvent.payload, { activityId: input.activityId });
    assert.deepEqual(submitted.briefEvent.subject, {
      recordId: submitted.revision.recordId,
      revision: submitted.revision.revision,
      digest: submitted.revision.digest,
    });
    assert.equal(submitted.briefEvent.sequence, 2);
    assert.equal(submitted.activityEvent.sequence, 3);
    assert.equal(submitted.activityEvent.eventKind, "activity-started");
    assert.deepEqual(submitted.activityEvent.payload, {
      activityId: input.activityId,
      operation: input.operation,
    });
    assert.equal(store.listEvents().length, 3);
    assert.equal(store.listCurrentRevisions({ recordKinds: ["director-brief"] }).length, 1);
    assert.equal(store.state().journal.eventCount, 3);
    assert.deepEqual(store.state().eligibleOperations, ["delivery.recover"]);
    assert.equal(store.state().activities[0]?.id, input.activityId);
    store.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Director Brief profiles cover exactly the five agent operations", () => {
  assert.deepEqual(DIRECTOR_BRIEF_OPERATIONS, [
    "delivery.prepare",
    "delivery.continue",
    "delivery.evaluate",
    "delivery.revise",
    "delivery.reaffirm",
  ]);
  assert.deepEqual(DIRECTOR_BRIEF_TEMPLATE_PROFILE_BY_OPERATION, {
    "delivery.prepare": "director-brief.prepare-v1",
    "delivery.continue": "director-brief.direction-v1",
    "delivery.evaluate": "director-brief.direction-v1",
    "delivery.revise": "director-brief.resolution-v1",
    "delivery.reaffirm": "director-brief.resolution-v1",
  });
});

test("Director Brief compilation refuses non-public input and illegal Journal order without residue", async () => {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-director-brief-refusal-"));
  try {
    const invalid = await storeAt(root, "invalid");
    appendDeliveryCreated(invalid.store, invalid.createdAt, "invalid");
    assert.throws(() => openAgentActivity({
      store: invalid.store,
      activityId: "activity-invalid",
      operation: "delivery.prepare",
      semanticMarkdown: "---\n{\"runtime\":\"mechanics\"}\n---\n",
      submittedAt: "2026-08-29T14:00:01.000Z",
      startedAt: "2026-08-29T14:00:02.000Z",
      directorId: "director-one",
      runtimeId: "foundation-runtime",
    }), (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.control-director-brief.semantic-markdown");
    assert.throws(() => openAgentActivity({
      store: invalid.store,
      activityId: "activity-no-ship",
      operation: "delivery.no-ship" as never,
      semanticMarkdown: "Do not ship.\n",
      submittedAt: "2026-08-29T14:00:01.000Z",
      startedAt: "2026-08-29T14:00:02.000Z",
      directorId: "director-one",
      runtimeId: "foundation-runtime",
    }), (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.control-director-brief.operation");
    assert.equal(invalid.store.listEvents().length, 1);
    assert.equal(invalid.store.listCurrentRevisions({ recordKinds: ["director-brief"] }).length, 0);
    invalid.store.close();

    const outOfOrder = await storeAt(root, "order");
    assert.throws(() => openAgentActivity({
      store: outOfOrder.store,
      activityId: "activity-out-of-order",
      operation: "delivery.prepare",
      semanticMarkdown: "# Director Brief\n\nStart only after Delivery creation.\n",
      submittedAt: "2026-08-29T14:00:01.000Z",
      startedAt: "2026-08-29T14:00:02.000Z",
      directorId: "director-one",
      runtimeId: "foundation-runtime",
    }), (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.delivery-reducer.order");
    assert.equal(outOfOrder.store.listEvents().length, 0);
    assert.equal(outOfOrder.store.listCurrentRevisions({ recordKinds: ["director-brief"] }).length, 0);
    outOfOrder.store.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
