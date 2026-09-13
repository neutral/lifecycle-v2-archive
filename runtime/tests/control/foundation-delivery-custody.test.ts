import assert from "node:assert/strict";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { FoundationError } from "../../src/foundation/error.js";
import {
  archiveDeliveryControlRecordStore,
  createDeliveryControlRecordStore,
  listDeliveryControlRecordStores,
  openDeliveryControlRecordStore,
  openDeliveryControlRecordStoreReadOnly,
  type DeliveryCustodyCreationStage,
} from "../../src/foundation/control/delivery-custody.js";
import { compileControlRecordRevision } from "../../src/foundation/control/model.js";
import { openAgentActivity } from "../../src/foundation/control/director-brief.js";
import type {
  ControlJsonObject,
  ControlRecordRevision,
  ControlRecordRevisionInput,
} from "../../src/foundation/control/types.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import { digestCanonical, sha256Bytes } from "../../src/foundation/validation/canonical.js";

const RUNTIME_ACTOR = "foundation-runtime";
const CREATED_AT = "2026-08-29T12:00:00.000Z";

function segment(value: string): string {
  return `sha256-${sha256Bytes(value).slice("sha256:".length)}`;
}

function roots(home: string, targetId: string, deliveryId: string) {
  const registry = join(home, "control-record-stores");
  const target = segment(targetId);
  const delivery = segment(deliveryId);
  return Object.freeze({
    registry,
    activeArea: join(registry, "active"),
    activeTarget: join(registry, "active", target),
    archiveTarget: join(registry, "archive", target),
    stagingTarget: join(registry, "staging", target),
    active: join(registry, "active", target, delivery),
    archive: join(registry, "archive", target, delivery),
    staging: join(registry, "staging", target, delivery),
  });
}

function custodyCode(suffix: string): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    assert(error instanceof FoundationError);
    assert.equal(error.code, `lifecycle.control-record-store.custody-${suffix}`);
    return true;
  };
}

async function create(home: string, targetId: string, deliveryId: string) {
  return createDeliveryControlRecordStore({
    machineHome: home,
    targetId,
    deliveryId,
    createdAt: CREATED_AT,
    runtimeActorId: RUNTIME_ACTOR,
  });
}

test("read-only selection never creates absent registry or custody directories", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifecycle-delivery-custody-read-only-"));
  const targetId = "target.read-only";
  const deliveryId = "delivery.read-only";
  const layout = roots(home, targetId, deliveryId);
  try {
    assert.equal(await openDeliveryControlRecordStoreReadOnly({
      machineHome: home,
      targetId,
      deliveryId,
    }), null);
    assert.deepEqual(await readdir(home), []);

    await assert.rejects(openDeliveryControlRecordStore({
      machineHome: home,
      targetId,
      deliveryId,
      readOnly: true,
    }), custodyCode("selection"));
    assert.deepEqual(await readdir(home), []);

    await mkdir(layout.registry, { mode: 0o700 });
    assert.equal(await openDeliveryControlRecordStoreReadOnly({
      machineHome: home,
      targetId,
      deliveryId,
    }), null);
    assert.deepEqual(await readdir(layout.registry), []);

    await mkdir(join(layout.registry, "active"), { mode: 0o700 });
    await assert.rejects(openDeliveryControlRecordStoreReadOnly({
      machineHome: home,
      targetId,
      deliveryId,
    }), custodyCode("layout"));
    assert.deepEqual(await readdir(layout.registry), ["active"]);

    await mkdir(join(layout.registry, "archive"), { mode: 0o700 });
    await mkdir(join(layout.registry, "staging"), { mode: 0o700 });
    assert.equal(await openDeliveryControlRecordStoreReadOnly({
      machineHome: home,
      targetId,
      deliveryId,
    }), null);
    assert.deepEqual(await readdir(join(layout.registry, "active")), []);
    assert.deepEqual(await readdir(join(layout.registry, "archive")), []);
    assert.deepEqual(await readdir(join(layout.registry, "staging")), []);

    await mkdir(layout.activeTarget, { mode: 0o700 });
    await assert.rejects(openDeliveryControlRecordStoreReadOnly({
      machineHome: home,
      targetId,
      deliveryId,
    }), custodyCode("layout"));
    await assert.rejects(readdir(layout.archiveTarget));
    await assert.rejects(readdir(layout.stagingTarget));
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("custody reopens and lists physical version 3, and refuses versions 1 and 2 without rewriting them", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifecycle-delivery-custody-version-"));
  const selection = { machineHome: home, targetId: "target.version", deliveryId: "delivery.version" };
  try {
    const created = await create(home, selection.targetId, selection.deliveryId);
    const database = created.store.paths.database;
    const identity = created.identity;
    const events = created.store.listEvents();
    created.store.close();

    const observed = new DatabaseSync(database, { readOnly: true });
    try {
      assert.equal(observed.prepare("PRAGMA application_id").get()?.application_id, 0x4c435253);
      assert.equal(observed.prepare("PRAGMA user_version").get()?.user_version, 3);
    } finally { observed.close(); }

    for (const open of [openDeliveryControlRecordStore, openDeliveryControlRecordStoreReadOnly]) {
      const reopened = await open(selection);
      assert(reopened !== null);
      try {
        assert.equal(reopened.disposition, "active");
        assert.deepEqual(reopened.identity, identity);
        assert.deepEqual(reopened.store.listEvents(), events);
      } finally { reopened.store.close(); }
    }
    assert.deepEqual((await listDeliveryControlRecordStores(selection)).deliveries, [{ identity, disposition: "active" }]);

    // Only the retired physical discriminator changes; no predecessor Store
    // schema or compatibility implementation is supplied by this invalid case.
    for (const predecessorVersion of [1, 2]) {
      const substituted = new DatabaseSync(database);
      try { substituted.exec(`PRAGMA user_version = ${predecessorVersion}`); }
      finally { substituted.close(); }
      const refusedBytes = await readFile(database);
      for (const open of [openDeliveryControlRecordStore, openDeliveryControlRecordStoreReadOnly]) {
        await assert.rejects(open(selection), custodyCode("metadata"));
      }
      await assert.rejects(listDeliveryControlRecordStores(selection), custodyCode("metadata"));
      assert.deepEqual(await readFile(database), refusedBytes);
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

async function payload(kind: string): Promise<ControlJsonObject> {
  const bytes = await readFile(new URL(
    `../../../../spec-source/examples/${kind}-payload-structural-valid/subject.json`,
    import.meta.url,
  ));
  return JSON.parse(bytes.toString("utf8")) as ControlJsonObject;
}

function appendRevision(
  store: ControlRecordStore,
  revision: ControlRecordRevisionInput,
  eventId: string,
  eventKind: string,
  activityId: string,
): ControlRecordRevision {
  const compiled = compileControlRecordRevision(store.identity.processId, revision);
  const appended = store.append({
    revision,
    event: {
      eventId,
      eventKind,
      occurredAt: revision.createdAt,
      actor: { kind: "runtime", id: RUNTIME_ACTOR },
      subject: {
        recordId: compiled.recordId,
        revision: compiled.revision,
        digest: compiled.digest,
      },
      payload: { activityId },
    },
  });
  assert(appended.revision !== null);
  return appended.revision;
}

async function closeEarlyNoShip(store: ControlRecordStore): Promise<void> {
  const prepareActivity = "activity.prepare";
  const { revision: brief } = openAgentActivity({
    store,
    activityId: prepareActivity,
    operation: "delivery.prepare",
    directorId: "director.demo",
    runtimeId: RUNTIME_ACTOR,
    submittedAt: "2026-08-29T12:00:01.000Z",
    startedAt: "2026-08-29T12:00:02.000Z",
    semanticMarkdown: "# Director Brief\n\nAttempt one bounded preparation.\n",
  });
  const attempt = appendRevision(store, {
    recordId: "attempt.prepare",
    recordKind: "agent-attempt",
    revision: 1,
    producer: { kind: "runtime", id: RUNTIME_ACTOR },
    semanticAuthor: { kind: "runtime", id: RUNTIME_ACTOR },
    semanticAuthority: "runtime-derived",
    createdAt: "2026-08-29T12:00:03.000Z",
    semanticMarkdown: "# Agent Attempt\n\nObserve a not-started provider boundary.\n",
    payload: await payload("agent-attempt"),
    relationships: [{
      relation: "uses-brief",
      target: { kind: brief.recordKind, id: brief.recordId, revision: brief.revision, digest: brief.digest },
    }],
  }, "event.attempt.prepare", "agent-attempt-prepared", prepareActivity);
  const providerEffect = `sha256:${"0".repeat(64)}` as const;
  store.append({ event: {
    eventId: "event.provider-intended.prepare",
    eventKind: "provider-effect-intended",
    occurredAt: "2026-08-29T12:00:04.000Z",
    actor: { kind: "runtime", id: RUNTIME_ACTOR },
    subject: { recordId: attempt.recordId, revision: attempt.revision, digest: attempt.digest },
    payload: { activityId: prepareActivity, effectDigest: providerEffect },
  } });
  store.append({ event: {
    eventId: "event.provider-observed.prepare",
    eventKind: "provider-effect-observed",
    occurredAt: "2026-08-29T12:00:05.000Z",
    actor: { kind: "runtime", id: RUNTIME_ACTOR },
    subject: { recordId: attempt.recordId, revision: attempt.revision, digest: attempt.digest },
    payload: { activityId: prepareActivity, effectDigest: providerEffect, outcome: "not-started" },
  } });
  store.append({ event: {
    eventId: "event.work-product-abandoned.prepare",
    eventKind: "agent-work-product-abandoned",
    occurredAt: "2026-08-29T12:00:06.000Z",
    actor: { kind: "runtime", id: RUNTIME_ACTOR },
    subject: { recordId: attempt.recordId, revision: attempt.revision, digest: attempt.digest },
    payload: { activityId: prepareActivity },
  } });
  appendRevision(store, {
    recordId: "receipt.prepare",
    recordKind: "execution-receipt",
    revision: 1,
    producer: { kind: "runtime", id: RUNTIME_ACTOR },
    semanticAuthor: { kind: "runtime", id: RUNTIME_ACTOR },
    semanticAuthority: "runtime-observed",
    createdAt: "2026-08-29T12:00:07.000Z",
    semanticMarkdown: "# Execution Receipt\n\nThe provider did not start.\n",
    payload: await payload("execution-receipt"),
    relationships: [{
      relation: "observes-attempt",
      target: {
        kind: attempt.recordKind,
        id: attempt.recordId,
        revision: attempt.revision,
        digest: attempt.digest,
      },
    }],
  }, "event.receipt.prepare", "execution-receipt-recorded", prepareActivity);
  store.append({ event: {
    eventId: "event.completed.prepare",
    eventKind: "activity-completed",
    occurredAt: "2026-08-29T12:00:08.000Z",
    actor: { kind: "runtime", id: RUNTIME_ACTOR },
    payload: { activityId: prepareActivity, outcome: "failed" },
  } });

  const noShipActivity = "activity.no-ship";
  store.append({ event: {
    eventId: "event.activity.no-ship",
    eventKind: "activity-started",
    occurredAt: "2026-08-29T12:00:09.000Z",
    actor: { kind: "runtime", id: RUNTIME_ACTOR },
    payload: { activityId: noShipActivity, operation: "delivery.no-ship" },
  } });
  const decision = appendRevision(store, {
    recordId: "decision.no-ship",
    recordKind: "director-decision",
    revision: 1,
    producer: { kind: "runtime", id: RUNTIME_ACTOR },
    semanticAuthor: { kind: "director", id: "director.demo" },
    semanticAuthority: "director-authenticated",
    createdAt: "2026-08-29T12:00:10.000Z",
    semanticMarkdown: "# Director Decision\n\nDo not ship this Delivery.\n",
    payload: await payload("director-decision"),
  }, "event.decision.no-ship", "director-decision-authenticated", noShipActivity);
  const transactionEffect = `sha256:${"1".repeat(64)}` as const;
  const transactionFacts = Object.freeze({
    schema: "lifecycle.terminal-repository-effect-observation.v1",
    ref: "refs/heads/main",
    commit: "a".repeat(40),
    tree: "b".repeat(40),
    objectFormat: "sha1",
  });
  store.append({ event: {
    eventId: "event.transaction-intended.no-ship",
    eventKind: "transaction-effect-intended",
    occurredAt: "2026-08-29T12:00:11.000Z",
    actor: { kind: "runtime", id: RUNTIME_ACTOR },
    subject: { recordId: decision.recordId, revision: decision.revision, digest: decision.digest },
    payload: { activityId: noShipActivity, effectDigest: transactionEffect },
  } });
  store.append({ event: {
    eventId: "event.transaction-observed.no-ship",
    eventKind: "transaction-effect-observed",
    occurredAt: "2026-08-29T12:00:12.000Z",
    actor: { kind: "runtime", id: RUNTIME_ACTOR },
    subject: { recordId: decision.recordId, revision: decision.revision, digest: decision.digest },
    payload: {
      activityId: noShipActivity,
      effectDigest: transactionEffect,
      outcome: "applied",
      facts: transactionFacts,
      factsDigest: digestCanonical(transactionFacts),
    },
  } });
  const closureInput: ControlRecordRevisionInput = {
    recordId: "closure.no-ship",
    recordKind: "closure",
    revision: 1,
    producer: { kind: "runtime", id: RUNTIME_ACTOR },
    semanticAuthor: { kind: "runtime", id: RUNTIME_ACTOR },
    semanticAuthority: "runtime-derived",
    createdAt: "2026-08-29T12:00:13.000Z",
    semanticMarkdown: "# Closure\n\nThe Delivery closed without a Candidate.\n",
    payload: await payload("closure"),
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
  const closure = compileControlRecordRevision(store.identity.processId, closureInput);
  store.append({
    revision: closureInput,
    event: {
      eventId: "event.closure.no-ship",
      eventKind: "closure-recorded",
      occurredAt: closureInput.createdAt,
      actor: { kind: "runtime", id: RUNTIME_ACTOR },
      subject: { recordId: closure.recordId, revision: closure.revision, digest: closure.digest },
      payload: { activityId: noShipActivity },
    },
  });
  await store.seal({
    closure: { recordId: closure.recordId, revision: closure.revision, digest: closure.digest },
    sealedAt: "2026-08-29T12:00:14.000Z",
  });
}

test("staged creation survives every durable crash boundary without exposing an empty active Store", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifecycle-delivery-custody-crash-"));
  try {
    const stages: readonly DeliveryCustodyCreationStage[] = [
      "staging-ready",
      "store-created",
      "delivery-created",
      "published",
    ];
    for (const [index, interruptedStage] of stages.entries()) {
      const deliveryId = `delivery.crash-${index}`;
      let interrupted = false;
      await assert.rejects(createDeliveryControlRecordStore({
        machineHome: home,
        targetId: "target.crash",
        deliveryId,
        createdAt: CREATED_AT,
        runtimeActorId: RUNTIME_ACTOR,
        onStage(stage) {
          if (!interrupted && stage === interruptedStage) {
            interrupted = true;
            throw new Error(`interrupt after ${stage}`);
          }
        },
      }), /interrupt after/u);
      assert.equal(interrupted, true);

      if (interruptedStage === "published") {
        const retained = await openDeliveryControlRecordStore({
          machineHome: home,
          targetId: "target.crash",
          deliveryId,
        });
        assert.equal(retained.store.listEvents().length, 1);
        retained.store.close();
      } else {
        await assert.rejects(openDeliveryControlRecordStore({
          machineHome: home,
          targetId: "target.crash",
          deliveryId,
        }), custodyCode("staging"));
      }

      const retried = await create(home, "target.crash", deliveryId);
      assert.equal(retried.disposition, "active");
      assert.deepEqual(retried.store.listEvents().map(({ eventKind }) => eventKind), ["delivery-created"]);
      retried.store.close();
    }
    const retained = await listDeliveryControlRecordStores({
      machineHome: home,
      targetId: "target.crash",
    });
    assert.equal(retained.deliveries.length, stages.length);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("parallel Deliveries resolve exactly and list bounded identities without physical paths", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifecycle-delivery-custody-parallel-"));
  try {
    const [first, second] = await Promise.all([
      create(home, "target.parallel", "delivery.alpha"),
      create(home, "target.parallel", "delivery.beta"),
    ]);
    first.store.close();
    second.store.close();

    const firstPage = await listDeliveryControlRecordStores({
      machineHome: home,
      targetId: "target.parallel",
      limit: 1,
    });
    assert.deepEqual(firstPage.deliveries.map(({ identity }) => identity.processId), ["delivery.alpha"]);
    assert.equal(firstPage.nextAfterDeliveryId, "delivery.alpha");
    assert.equal("path" in firstPage.deliveries[0]!, false);
    const secondPage = await listDeliveryControlRecordStores({
      machineHome: home,
      targetId: "target.parallel",
      afterDeliveryId: firstPage.nextAfterDeliveryId ?? undefined,
      limit: 1,
    });
    assert.deepEqual(secondPage.deliveries.map(({ identity }) => identity.processId), ["delivery.beta"]);
    assert.equal(secondPage.nextAfterDeliveryId, null);

    const selected = await openDeliveryControlRecordStore({
      machineHome: home,
      targetId: "target.parallel",
      deliveryId: "delivery.beta",
    });
    assert.equal(selected.identity.processId, "delivery.beta");
    selected.store.close();
    await assert.rejects(openDeliveryControlRecordStore({
      machineHome: home,
      targetId: "target.parallel",
      deliveryId: "delivery.absent",
    }), custodyCode("selection"));

    const layout = roots(home, "target.parallel", "delivery.alpha");
    for (const entry of await readdir(layout.activeArea)) assert.match(entry, /^sha256-[a-f0-9]{64}$/u);
    for (const entry of await readdir(layout.activeTarget)) {
      assert.match(entry, /^sha256-[a-f0-9]{64}$/u);
      assert.equal(entry.includes("alpha"), false);
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("sealed Delivery archives through the recoverable archive owner and resolves read-only", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifecycle-delivery-custody-archive-"));
  try {
    const created = await create(home, "target.archive", "delivery.archive");
    await closeEarlyNoShip(created.store);
    created.store.close();
    const archivedAt = "2026-08-29T12:00:15.000Z";
    const archived = await archiveDeliveryControlRecordStore({
      machineHome: home,
      targetId: "target.archive",
      deliveryId: "delivery.archive",
      archivedAt,
    });
    assert.equal(archived.disposition, "archived");
    assert.match(archived.manifestDigest, /^sha256:[a-f0-9]{64}$/u);

    const opened = await openDeliveryControlRecordStore({
      machineHome: home,
      targetId: "target.archive",
      deliveryId: "delivery.archive",
    });
    assert.equal(opened.disposition, "archived");
    assert.equal(opened.archiveManifestDigest, archived.manifestDigest);
    assert.equal(opened.store.readOnly, true);
    assert.equal(opened.store.getSeal() === null, false);
    opened.store.close();
    const listed = await listDeliveryControlRecordStores({
      machineHome: home,
      targetId: "target.archive",
    });
    assert.deepEqual(listed.deliveries.map(({ identity, disposition }) => ({
      deliveryId: identity.processId,
      disposition,
    })), [{ deliveryId: "delivery.archive", disposition: "archived" }]);

    const retried = await archiveDeliveryControlRecordStore({
      machineHome: home,
      targetId: "target.archive",
      deliveryId: "delivery.archive",
      archivedAt,
    });
    assert.equal(retried.manifestDigest, archived.manifestDigest);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("custody refuses mode, owner, symlink, unsupported, duplicate, wrong-identity, and staging ambiguity", async () => {
  const homes: string[] = [];
  const fresh = async (suffix: string): Promise<string> => {
    const home = await mkdtemp(join(tmpdir(), `lifecycle-delivery-custody-${suffix}-`));
    homes.push(home);
    return home;
  };
  try {
    const modeHome = await fresh("mode");
    (await create(modeHome, "target.mode", "delivery.mode")).store.close();
    await chmod(roots(modeHome, "target.mode", "delivery.mode").active, 0o755);
    await assert.rejects(openDeliveryControlRecordStore({
      machineHome: modeHome,
      targetId: "target.mode",
      deliveryId: "delivery.mode",
    }), custodyCode("layout"));

    const ownerHome = await fresh("owner");
    (await create(ownerHome, "target.owner", "delivery.owner")).store.close();
    const originalGeteuid = process.geteuid;
    Object.defineProperty(process, "geteuid", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: () => (originalGeteuid?.() ?? 0) + 1,
    });
    try {
      await assert.rejects(openDeliveryControlRecordStore({
        machineHome: ownerHome,
        targetId: "target.owner",
        deliveryId: "delivery.owner",
      }), custodyCode("layout"));
    } finally {
      Object.defineProperty(process, "geteuid", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: originalGeteuid,
      });
    }

    const symlinkHome = await fresh("symlink");
    (await create(symlinkHome, "target.symlink", "delivery.symlink")).store.close();
    const symlinkLayout = roots(symlinkHome, "target.symlink", "delivery.symlink");
    const retainedRoot = `${symlinkLayout.active}-retained`;
    await rename(symlinkLayout.active, retainedRoot);
    await symlink(retainedRoot, symlinkLayout.active);
    await assert.rejects(openDeliveryControlRecordStore({
      machineHome: symlinkHome,
      targetId: "target.symlink",
      deliveryId: "delivery.symlink",
    }), custodyCode("layout"));

    const unsupportedHome = await fresh("unsupported");
    (await create(unsupportedHome, "target.unsupported", "delivery.unsupported")).store.close();
    await writeFile(join(roots(unsupportedHome, "target.unsupported", "delivery.unsupported").activeArea, "rogue"), "x");
    await assert.rejects(listDeliveryControlRecordStores({
      machineHome: unsupportedHome,
      targetId: "target.unsupported",
    }), custodyCode("layout"));

    const duplicateHome = await fresh("duplicate");
    (await create(duplicateHome, "target.duplicate", "delivery.duplicate")).store.close();
    const duplicateLayout = roots(duplicateHome, "target.duplicate", "delivery.duplicate");
    await cp(duplicateLayout.active, duplicateLayout.archive, { recursive: true, errorOnExist: true });
    await assert.rejects(openDeliveryControlRecordStore({
      machineHome: duplicateHome,
      targetId: "target.duplicate",
      deliveryId: "delivery.duplicate",
    }), custodyCode("conflict"));

    const wrongHome = await fresh("wrong");
    (await create(wrongHome, "target.wrong", "delivery.original")).store.close();
    const original = roots(wrongHome, "target.wrong", "delivery.original");
    const substituted = roots(wrongHome, "target.wrong", "delivery.substituted");
    await rename(original.active, substituted.active);
    await assert.rejects(openDeliveryControlRecordStore({
      machineHome: wrongHome,
      targetId: "target.wrong",
      deliveryId: "delivery.substituted",
    }), custodyCode("selection"));

    const stagingHome = await fresh("staging");
    (await create(stagingHome, "target.staging", "delivery.staging")).store.close();
    const stagingLayout = roots(stagingHome, "target.staging", "delivery.staging");
    await mkdir(stagingLayout.staging, { mode: 0o700 });
    await assert.rejects(openDeliveryControlRecordStore({
      machineHome: stagingHome,
      targetId: "target.staging",
      deliveryId: "delivery.staging",
    }), custodyCode("staging"));
  } finally {
    await Promise.all(homes.map((home) => rm(home, { recursive: true, force: true })));
  }
});


test("a refused first opening discards only its provably empty unpublished Store", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifecycle-unpublished-prepare-"));
  const targetId = "target.unpublished-preparation";
  const deliveryId = "delivery.unpublished-preparation";
  const layout = roots(home, targetId, deliveryId);
  const refused = new Error("exact retained basis is unavailable before first opening");
  try {
    await assert.rejects(createDeliveryControlRecordStore({
      machineHome: home, targetId, deliveryId, createdAt: CREATED_AT, runtimeActorId: RUNTIME_ACTOR,
      initializeBeforePublication: async (store) => {
        assert.equal(store.state().activities.length, 0);
        assert.equal(store.hasRetainedOperationSupport(), false);
        assert.equal((await readdir(layout.activeTarget)).length, 0);
        throw refused;
      },
    }), (error) => error === refused);
    assert.deepEqual(await readdir(layout.stagingTarget), []);
    assert.deepEqual(await readdir(layout.activeTarget), []);
    assert.equal(await openDeliveryControlRecordStoreReadOnly({ machineHome: home, targetId, deliveryId }), null);
    const retry = await create(home, targetId, deliveryId);
    retry.store.close();
  } finally { await rm(home, { recursive: true, force: true }); }
});
