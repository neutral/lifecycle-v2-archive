import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  FOUNDER_BRIEF_OPERATIONS,
  FOUNDER_BRIEF_TEMPLATE_PROFILE_BY_OPERATION,
  openAgentActivity,
} from "../../src/foundation/control/founder-brief.js";
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
      storeId: `store-founder-brief-${suffix}`,
      targetId: `target-founder-brief-${suffix}`,
      processKind: "delivery",
      processId: `delivery-founder-brief-${suffix}`,
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

test("Founder Brief compilation owns normalization and atomically opens its Agent activity", async () => {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-founder-brief-"));
  try {
    const { store, createdAt } = await storeAt(root, "prepare");
    appendDeliveryCreated(store, createdAt, "prepare");
    const rawMarkdown = "# Founder Brief\n\nReconnoiter this exact objective.\n\n\n";
    const normalizedMarkdown = "# Founder Brief\n\nReconnoiter this exact objective.\n";
    const input = {
      store,
      activityId: "activity-prepare-one",
      operation: "delivery.prepare" as const,
      semanticMarkdown: rawMarkdown,
      submittedAt: "2026-08-29T14:00:01.000Z",
      startedAt: "2026-08-29T14:00:02.000Z",
      founderId: "founder-one",
      runtimeId: "foundation-runtime",
    };
    const submitted = openAgentActivity(input);

    assert.match(submitted.revision.recordId, /^founder-brief-[a-f0-9]{64}$/u);
    assert.match(submitted.briefEvent.eventId, /^event-founder-brief-submitted-[a-f0-9]{64}$/u);
    assert.equal(submitted.revision.revision, 1);
    assert.equal(submitted.revision.recordKind, "founder-brief");
    assert.equal(submitted.revision.semanticMarkdown, normalizedMarkdown);
    assert.deepEqual(submitted.revision.producer, { kind: "runtime", id: "foundation-runtime" });
    assert.deepEqual(submitted.revision.semanticAuthor, { kind: "founder", id: "founder-one" });
    assert.equal(submitted.revision.semanticAuthority, "founder-supplied");
    assert.deepEqual(submitted.revision.relationships, []);
    assert.deepEqual(submitted.revision.payload, {
      schema: "lifecycle.founder-brief-payload.v1",
      inputProfile: "delivery.prepare",
      templateProfileId: "founder-brief.prepare-v1",
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
    assert.equal(submitted.briefEvent.eventKind, "founder-brief-submitted");
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
    assert.equal(store.listCurrentRevisions({ recordKinds: ["founder-brief"] }).length, 1);
    assert.equal(store.state().journal.eventCount, 3);
    assert.deepEqual(store.state().eligibleOperations, ["delivery.recover"]);
    assert.equal(store.state().activities[0]?.id, input.activityId);
    store.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Founder Brief profiles cover exactly the five agent operations", () => {
  assert.deepEqual(FOUNDER_BRIEF_OPERATIONS, [
    "delivery.prepare",
    "delivery.continue",
    "delivery.evaluate",
    "delivery.revise",
    "delivery.reaffirm",
  ]);
  assert.deepEqual(FOUNDER_BRIEF_TEMPLATE_PROFILE_BY_OPERATION, {
    "delivery.prepare": "founder-brief.prepare-v1",
    "delivery.continue": "founder-brief.direction-v1",
    "delivery.evaluate": "founder-brief.direction-v1",
    "delivery.revise": "founder-brief.resolution-v1",
    "delivery.reaffirm": "founder-brief.resolution-v1",
  });
});

test("Founder Brief compilation refuses non-public input and illegal Journal order without residue", async () => {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-founder-brief-refusal-"));
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
      founderId: "founder-one",
      runtimeId: "foundation-runtime",
    }), (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.control-founder-brief.semantic-markdown");
    assert.throws(() => openAgentActivity({
      store: invalid.store,
      activityId: "activity-no-ship",
      operation: "delivery.no-ship" as never,
      semanticMarkdown: "Do not ship.\n",
      submittedAt: "2026-08-29T14:00:01.000Z",
      startedAt: "2026-08-29T14:00:02.000Z",
      founderId: "founder-one",
      runtimeId: "foundation-runtime",
    }), (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.control-founder-brief.operation");
    assert.equal(invalid.store.listEvents().length, 1);
    assert.equal(invalid.store.listCurrentRevisions({ recordKinds: ["founder-brief"] }).length, 0);
    invalid.store.close();

    const outOfOrder = await storeAt(root, "order");
    assert.throws(() => openAgentActivity({
      store: outOfOrder.store,
      activityId: "activity-out-of-order",
      operation: "delivery.prepare",
      semanticMarkdown: "# Founder Brief\n\nStart only after Delivery creation.\n",
      submittedAt: "2026-08-29T14:00:01.000Z",
      startedAt: "2026-08-29T14:00:02.000Z",
      founderId: "founder-one",
      runtimeId: "foundation-runtime",
    }), (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.delivery-reducer.order");
    assert.equal(outOfOrder.store.listEvents().length, 0);
    assert.equal(outOfOrder.store.listCurrentRevisions({ recordKinds: ["founder-brief"] }).length, 0);
    outOfOrder.store.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
