import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createFoundationRuntimeOperationRequest,
  type FoundationRuntimeExportRequest,
  type FoundationRuntimeInboxRequest,
  type FoundationRuntimeInspectRequest,
  type FoundationRuntimeDiffRequest,
  type FoundationRuntimeStatusRequest,
  type FoundationRuntimeValidateRequest,
  type FoundationRuntimeWatchRequest,
} from "@neutral/lifecycle-protocol";
import {
  createDeliveryControlRecordStore,
  listDeliveryControlRecordStores,
  openDeliveryControlRecordStoreReadOnly,
} from "../../src/foundation/control/delivery-custody.js";
import { attachRepository } from "../../src/foundation/repository/contract.js";
import { git } from "../../src/foundation/repository/git.js";
import { initializeRepository } from "../../src/foundation/repository/initialize.js";
import { createFoundationRuntimeReadSurface } from "../../src/foundation/runtime-read.js";
import { FOUNDATION_GENERATED_PUBLICATION_DIGEST } from
  "../../src/foundation/validation/generated-schemas.js";
import { writeMinimalAtlas } from "../helpers/atlas-fixture.js";

const OBSERVED_AT = "2026-08-29T09:00:00.000Z";

test("v10 read surface derives validation, status, inspection, export, and unchanged facts", async () => {
  const target = await mkdtemp(join(tmpdir(), "lifecycle-runtime-read-target-"));
  const machineHome = await mkdtemp(join(tmpdir(), "lifecycle-runtime-read-home-"));
  const deliveryId = "delivery-runtime-read";
  try {
    await git(target, ["init", "-b", "main"]);
    await git(target, ["config", "user.name", "Lifecycle Test"]);
    await git(target, ["config", "user.email", "lifecycle@example.invalid"]);
    await writeMinimalAtlas(target);
    await git(target, ["add", "--", "atlas"]);
    await git(target, ["commit", "-m", "Initialize target"]);
    const contract = await initializeRepository(target, {
      targetId: "target-runtime-read",
      founderPrincipal: "founder-runtime-read",
      home: machineHome,
      authoritySecret: "runtime-read-founder-secret-at-least-thirty-two-bytes",
      publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
      implementationRoots: [],
      stage: true,
    });
    await git(target, ["commit", "-m", "Initialize Lifecycle"]);
    const attachment = await attachRepository(target);
    const created = await createDeliveryControlRecordStore({
      machineHome,
      targetId: contract.targetId,
      deliveryId,
      createdAt: "2026-08-29T08:59:00.000Z",
      runtimeActorId: "foundation-runtime",
    });
    created.store.close();

    const surface = createFoundationRuntimeReadSurface({
      machineHome,
      now: () => OBSERVED_AT,
    });
    const validationRequest = createFoundationRuntimeOperationRequest({
      target,
      operation: "repository.validate",
      input: null,
    }) as FoundationRuntimeValidateRequest;
    const validation = await surface.execute(validationRequest);
    assert.equal(validation.status, "completed");
    assert.equal(validation.observation.repository.initialized, true);
    assert.equal(validation.observation.repository.valid, true);
    assert.equal(validation.observation.repository.repositoryContract, "lifecycle.repository.v15");
    assert.equal(
      validation.observation.repository.repositoryContractDigest,
      contract.digest,
    );
    assert.equal(validation.observation.repository.headCommit, attachment.headCommit);
    assert.equal(validation.observation.delivery, null);
    assert.equal(validation.value, null);
    assert.deepEqual(validation.changes, {
      repository: {
        changed: false,
        beforeCommit: attachment.headCommit,
        afterCommit: attachment.headCommit,
      },
      candidate: { changed: false, before: null, after: null },
      control: { advanced: false, beforeHead: null, afterHead: null },
    });

    const statusRequest = createFoundationRuntimeOperationRequest({
      target,
      deliveryId,
      operation: "delivery.status",
      input: null,
    }) as FoundationRuntimeStatusRequest;
    const status = await surface.execute(statusRequest);
    assert.equal(status.status, "completed");
    assert.equal(status.value, null);
    assert.equal(status.observation.delivery?.storeId, created.identity.storeId);
    assert.equal(status.observation.delivery?.processId, deliveryId);
    assert.equal(status.observation.delivery?.journal.eventCount, 1);
    assert.equal(status.observation.delivery?.storeDisposition.stage, "active");
    assert.equal(status.observation.delivery?.storeDisposition.integrity, "verified");
    assert.equal(status.observation.delivery?.recovery, null);
    assert.equal(status.changes.control.advanced, false);
    assert.equal(status.changes.control.beforeHead?.sequence, 1);
    assert.deepEqual(status.changes.control.afterHead, status.changes.control.beforeHead);

    const inspectRequest = createFoundationRuntimeOperationRequest({
      target,
      deliveryId,
      operation: "delivery.inspect",
      input: { kind: "events", afterSequence: 0, limit: 10 },
    }) as FoundationRuntimeInspectRequest;
    const inspection = await surface.execute(inspectRequest);
    assert.equal(inspection.status, "completed");
    const inspectionValue = inspection.value;
    if (inspectionValue === null || !("kind" in inspectionValue) || inspectionValue.kind !== "events") {
      throw new TypeError("Expected event inspection");
    }
    assert.equal(inspectionValue.events.length, 1);
    assert.equal(inspectionValue.events[0]?.eventKind, "delivery-created");
    assert.deepEqual(inspection.changes.control.afterHead, inspection.changes.control.beforeHead);

    const attemptViewRequest = createFoundationRuntimeOperationRequest({
      target,
      deliveryId,
      operation: "delivery.inspect",
      input: { kind: "attempt-view", selection: { kind: "latest-attempt" } },
    }) as FoundationRuntimeInspectRequest;
    const attemptView = await surface.execute(attemptViewRequest);
    assert.equal(attemptView.status, "completed");
    if (
      attemptView.value === null || !("kind" in attemptView.value) ||
      attemptView.value.kind !== "attempt-view"
    ) {
      throw new TypeError("Expected derived Attempt View inspection");
    }
    assert.equal(attemptView.value.view, null);
    assert.deepEqual(attemptView.changes.control.afterHead, attemptView.changes.control.beforeHead);

    const inboxRequest = createFoundationRuntimeOperationRequest({
      target,
      operation: "delivery.inbox",
      input: { afterDeliveryId: null, limit: 10 },
    }) as FoundationRuntimeInboxRequest;
    const inbox = await surface.execute(inboxRequest);
    assert.equal(inbox.status, "completed");
    if (inbox.value === null || !("kind" in inbox.value) || inbox.value.kind !== "inbox") {
      throw new TypeError("Expected Delivery Inbox");
    }
    assert.equal(inbox.value.view.rows.length, 1);
    const inboxRow = inbox.value.view.rows[0];
    assert.equal(inboxRow?.status, "available");
    if (inboxRow?.status !== "available") throw new TypeError("Expected available Inbox row");
    assert.equal(inboxRow.deliveryId, deliveryId);
    assert.equal(inboxRow.standing, "framing");
    assert.equal(inboxRow.generation.journal.headSequence, 1);

    const deliveryViewRequest = createFoundationRuntimeOperationRequest({
      target,
      deliveryId,
      operation: "delivery.inspect",
      input: { kind: "delivery-view" },
    }) as FoundationRuntimeInspectRequest;
    const deliveryView = await surface.execute(deliveryViewRequest);
    assert.equal(deliveryView.status, "completed");
    if (
      deliveryView.value === null || !("kind" in deliveryView.value) ||
      deliveryView.value.kind !== "delivery-view"
    ) throw new TypeError("Expected coherent Delivery View");
    assert.equal(deliveryView.value.view.generation.digest, inboxRow.generation.digest);
    assert.equal(deliveryView.value.view.nextPass.length, 4);
    assert.equal(deliveryView.value.view.controlFamilies.length, 12);

    const familyRequest = createFoundationRuntimeOperationRequest({
      target,
      deliveryId,
      operation: "delivery.inspect",
      input: { kind: "families" },
    }) as FoundationRuntimeInspectRequest;
    const families = await surface.execute(familyRequest);
    if (families.value === null || !("kind" in families.value) || families.value.kind !== "families") {
      throw new TypeError("Expected Control family index");
    }
    assert.equal(families.value.families.length, 12);
    assert.equal(families.value.generation.digest, deliveryView.value.view.generation.digest);

    const diffRequest = createFoundationRuntimeOperationRequest({
      target,
      deliveryId,
      operation: "delivery.diff",
      input: { subject: "candidate", maximumBytes: 4_096 },
    }) as FoundationRuntimeDiffRequest;
    const diff = await surface.execute(diffRequest);
    assert.equal(diff.status, "completed");
    if (diff.value === null || !("kind" in diff.value) || diff.value.kind !== "diff") {
      throw new TypeError("Expected Candidate diff result");
    }
    assert.equal(diff.value.view.currentness, "unavailable");
    assert.match(diff.value.view.unavailableReason ?? "", /No exact current Candidate/u);

    const watchRequest = createFoundationRuntimeOperationRequest({
      target,
      deliveryId,
      operation: "delivery.watch",
      input: {
        scope: "delivery",
        afterGeneration: deliveryView.value.view.generation.digest,
        timeoutMs: 0,
      },
    }) as FoundationRuntimeWatchRequest;
    const watched = await surface.execute(watchRequest);
    assert.equal(watched.status, "completed");
    if (watched.value === null || !("kind" in watched.value) || watched.value.kind !== "watch") {
      throw new TypeError("Expected watch result");
    }
    assert.equal(watched.value.changed, false);
    assert.equal(watched.value.delivery?.generation.digest, deliveryView.value.view.generation.digest);

    const exportRequest = createFoundationRuntimeOperationRequest({
      target,
      deliveryId,
      operation: "delivery.export",
      input: { format: "markdown", selection: { kind: "delivery" } },
    }) as FoundationRuntimeExportRequest;
    const exported = await surface.execute(exportRequest);
    assert.equal(exported.status, "completed");
    if (exported.value === null || !("format" in exported.value)) {
      throw new TypeError("Expected Markdown export");
    }
    assert.equal(exported.value.format, "markdown");
    assert.match(exported.value.content, /Derived inspection representation/u);
    assert.equal(exported.changes.repository.changed, false);
    assert.equal(exported.changes.candidate.changed, false);
    assert.equal(exported.changes.control.advanced, false);

    const retained = await openDeliveryControlRecordStoreReadOnly({
      machineHome,
      targetId: contract.targetId,
      deliveryId,
    });
    assert(retained !== null);
    assert.equal((await retained.store.verifyIntegrity()).eventCount, 1);
    retained.store.close();

    const secondDeliveryId = "delivery-runtime-read-z";
    const secondCreated = await createDeliveryControlRecordStore({
      machineHome,
      targetId: contract.targetId,
      deliveryId: secondDeliveryId,
      createdAt: "2026-08-29T08:59:01.000Z",
      runtimeActorId: "foundation-runtime",
    });
    secondCreated.store.close();
    const inboxFirstPage = await surface.execute(createFoundationRuntimeOperationRequest({
      target,
      operation: "delivery.inbox",
      input: { afterDeliveryId: null, limit: 1 },
    }) as FoundationRuntimeInboxRequest);
    if (
      inboxFirstPage.value === null || !("kind" in inboxFirstPage.value) ||
      inboxFirstPage.value.kind !== "inbox"
    ) throw new TypeError("Expected first Inbox page");
    assert.equal(inboxFirstPage.value.view.rows.length, 1);
    assert.equal(inboxFirstPage.value.view.rows[0]?.deliveryId, deliveryId);
    assert.equal(inboxFirstPage.value.view.nextAfterDeliveryId, deliveryId);
    const inboxSecondPage = await surface.execute(createFoundationRuntimeOperationRequest({
      target,
      operation: "delivery.inbox",
      input: { afterDeliveryId: deliveryId, limit: 1 },
    }) as FoundationRuntimeInboxRequest);
    if (
      inboxSecondPage.value === null || !("kind" in inboxSecondPage.value) ||
      inboxSecondPage.value.kind !== "inbox"
    ) throw new TypeError("Expected second Inbox page");
    assert.equal(inboxSecondPage.value.view.rows[0]?.deliveryId, secondDeliveryId);
    assert.equal(inboxSecondPage.value.view.nextAfterDeliveryId, null);

    const tailDeliveryId = "delivery-runtime-read-zz";
    const tailCreated = await createDeliveryControlRecordStore({
      machineHome,
      targetId: contract.targetId,
      deliveryId: tailDeliveryId,
      createdAt: "2026-08-29T08:59:02.000Z",
      runtimeActorId: "foundation-runtime",
    });
    tailCreated.store.close();
    const inboxAfterTail = await surface.execute(createFoundationRuntimeOperationRequest({
      target,
      operation: "delivery.inbox",
      input: { afterDeliveryId: null, limit: 1 },
    }) as FoundationRuntimeInboxRequest);
    if (
      inboxAfterTail.value === null || !("kind" in inboxAfterTail.value) ||
      inboxAfterTail.value.kind !== "inbox"
    ) throw new TypeError("Expected Inbox page after tail creation");
    assert.equal(inboxAfterTail.value.view.rows[0]?.deliveryId, deliveryId);
    assert.notEqual(inboxAfterTail.value.view.generation, inboxFirstPage.value.view.generation);
    const inboxWatchAfterTail = await surface.execute(createFoundationRuntimeOperationRequest({
      target,
      deliveryId: null,
      operation: "delivery.watch",
      input: {
        scope: "inbox",
        afterGeneration: inboxFirstPage.value.view.generation,
        timeoutMs: 0,
      },
    }) as FoundationRuntimeWatchRequest);
    if (
      inboxWatchAfterTail.value === null || !("kind" in inboxWatchAfterTail.value) ||
      inboxWatchAfterTail.value.kind !== "watch"
    ) throw new TypeError("Expected Inbox watch after tail creation");
    assert.equal(inboxWatchAfterTail.value.changed, true);
    assert.equal(inboxWatchAfterTail.value.generation, inboxAfterTail.value.view.generation);

    const isolatedInbox = await createFoundationRuntimeReadSurface({
      machineHome,
      now: () => OBSERVED_AT,
      owners: {
        openDeliveryStore: async (selection) => {
          const opened = await openDeliveryControlRecordStoreReadOnly(selection);
          if (opened === null || selection.deliveryId !== secondDeliveryId) return opened;
          let verifications = 0;
          const store = new Proxy(opened.store, {
            get(targetStore, property) {
              if (property === "verifyIntegrity") {
                return async () => {
                  const exact = await targetStore.verifyIntegrity();
                  verifications += 1;
                  return verifications === 2
                    ? { ...exact, eventCount: exact.eventCount + 1 }
                    : exact;
                };
              }
              const selected = Reflect.get(targetStore, property, targetStore) as unknown;
              return typeof selected === "function" ? selected.bind(targetStore) : selected;
            },
          });
          return { ...opened, store };
        },
      },
    }).execute(createFoundationRuntimeOperationRequest({
      target,
      operation: "delivery.inbox",
      input: { afterDeliveryId: null, limit: 10 },
    }) as FoundationRuntimeInboxRequest);
    if (
      isolatedInbox.value === null || !("kind" in isolatedInbox.value) ||
      isolatedInbox.value.kind !== "inbox"
    ) throw new TypeError("Expected isolated Inbox result");
    assert.equal(isolatedInbox.status, "completed");
    assert.deepEqual(
      isolatedInbox.value.view.rows.map(({ deliveryId: selected, status: rowStatus }) =>
        [selected, rowStatus]),
      [[deliveryId, "available"], [secondDeliveryId, "unavailable"], [tailDeliveryId, "available"]],
    );

    let registryReads = 0;
    const mixedRegistry = await createFoundationRuntimeReadSurface({
      machineHome,
      now: () => OBSERVED_AT,
      owners: {
        listDeliveryStores: async (selection) => {
          const exact = await listDeliveryControlRecordStores(selection);
          registryReads += 1;
          return registryReads === 2
            ? { ...exact, inventoryDigest: `sha256:${"e".repeat(64)}` as const }
            : exact;
        },
      },
    }).execute(createFoundationRuntimeOperationRequest({
      target,
      operation: "delivery.inbox",
      input: { afterDeliveryId: null, limit: 1 },
    }) as FoundationRuntimeInboxRequest);
    assert.equal(mixedRegistry.status, "refused");
    assert(mixedRegistry.diagnostics.some(({ code }) =>
      code === "lifecycle.runtime-read.inbox-registry-epoch-mixed"));
    const retainedSecond = await openDeliveryControlRecordStoreReadOnly({
      machineHome,
      targetId: contract.targetId,
      deliveryId: secondDeliveryId,
    });
    assert(retainedSecond !== null);
    assert.equal((await retainedSecond.store.verifyIntegrity()).eventCount, 1);
    retainedSecond.store.close();

    let repositoryObservations = 0;
    const movingEpoch = createFoundationRuntimeReadSurface({
      machineHome,
      now: () => OBSERVED_AT,
      owners: {
        observeRepository: async () => {
          repositoryObservations += 1;
          return {
            repository: repositoryObservations === 1
              ? validation.observation.repository
              : {
                  ...validation.observation.repository,
                  headCommit: "f".repeat(40),
                },
            diagnostics: validation.diagnostics,
          };
        },
      },
    });
    const mixed = await movingEpoch.execute(deliveryViewRequest);
    assert.equal(mixed.status, "refused");
    assert(mixed.diagnostics.some(({ code }) =>
      code === "lifecycle.runtime-read.repository-epoch-mixed"));
  } finally {
    await Promise.all([
      rm(target, { recursive: true, force: true }),
      rm(machineHome, { recursive: true, force: true }),
    ]);
  }
});

test("validation reports an uninitialized target without inventing repository facts", async () => {
  const target = await mkdtemp(join(tmpdir(), "lifecycle-runtime-read-uninitialized-"));
  const machineHome = await mkdtemp(join(tmpdir(), "lifecycle-runtime-read-empty-home-"));
  try {
    const request = createFoundationRuntimeOperationRequest({
      target,
      operation: "repository.validate",
      input: null,
    }) as FoundationRuntimeValidateRequest;
    const result = await createFoundationRuntimeReadSurface({
      machineHome,
      now: () => OBSERVED_AT,
    }).execute(request);
    assert.equal(result.status, "completed");
    assert.equal(result.targetId, null);
    assert.equal(result.observation.repository.initialized, false);
    assert.equal(result.observation.repository.valid, false);
    assert.equal(result.observation.repository.repositoryContract, null);
    assert.equal(result.observation.repository.headCommit, null);
    assert(result.diagnostics.some(({ severity }) => severity === "error"));
    assert.deepEqual(result.changes, {
      repository: { changed: false, beforeCommit: null, afterCommit: null },
      candidate: { changed: false, before: null, after: null },
      control: { advanced: false, beforeHead: null, afterHead: null },
    });
  } finally {
    await Promise.all([
      rm(target, { recursive: true, force: true }),
      rm(machineHome, { recursive: true, force: true }),
    ]);
  }
});

test("Delivery status remains available from raw repository identity when the moved commit has invalid Atlas", async () => {
  const target = await mkdtemp(join(tmpdir(), "lifecycle-runtime-read-invalid-atlas-"));
  const machineHome = await mkdtemp(join(tmpdir(), "lifecycle-runtime-read-invalid-atlas-home-"));
  const deliveryId = "delivery-runtime-read-invalid-atlas";
  try {
    await git(target, ["init", "-b", "main"]);
    await git(target, ["config", "user.name", "Lifecycle Test"]);
    await git(target, ["config", "user.email", "lifecycle@example.invalid"]);
    await writeMinimalAtlas(target);
    await git(target, ["add", "--", "atlas"]);
    await git(target, ["commit", "-m", "Initialize target"]);
    const contract = await initializeRepository(target, {
      targetId: "target-runtime-read-invalid-atlas",
      founderPrincipal: "founder-runtime-read-invalid-atlas",
      home: machineHome,
      authoritySecret: "runtime-read-invalid-atlas-secret-at-least-thirty-two-bytes",
      publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
      implementationRoots: [],
      stage: true,
    });
    await git(target, ["commit", "-m", "Initialize Lifecycle"]);
    const created = await createDeliveryControlRecordStore({
      machineHome,
      targetId: contract.targetId,
      deliveryId,
      createdAt: "2026-08-29T08:59:00.000Z",
      runtimeActorId: "foundation-runtime",
    });
    created.store.close();

    await writeFile(join(target, "atlas/atlas.md"), "invalid current Atlas\n", "utf8");
    await git(target, ["add", "--", "atlas/atlas.md"]);
    await git(target, ["commit", "-m", "Move branch to invalid Atlas"]);
    const movedCommit = (await git(target, ["rev-parse", "HEAD"])).stdout.trim();
    const result = await createFoundationRuntimeReadSurface({
      machineHome,
      now: () => OBSERVED_AT,
    }).execute(createFoundationRuntimeOperationRequest({
      target,
      deliveryId,
      operation: "delivery.status",
      input: null,
    }) as FoundationRuntimeStatusRequest);

    assert.equal(result.status, "completed");
    assert.equal(result.observation.repository.initialized, true);
    assert.equal(result.observation.repository.valid, false);
    assert.equal(result.observation.repository.targetId, contract.targetId);
    assert.equal(result.observation.repository.headCommit, movedCommit);
    assert.notEqual(result.observation.repository.headTree, null);
    assert.equal(result.observation.repository.atlas, null);
    assert.equal(result.observation.delivery?.processId, deliveryId);
    assert(result.diagnostics.some(({ severity }) => severity === "error"));
  } finally {
    await Promise.all([
      rm(target, { recursive: true, force: true }),
      rm(machineHome, { recursive: true, force: true }),
    ]);
  }
});
