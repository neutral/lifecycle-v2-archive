import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  FoundationDeliveryGenerationSchema,
  type FoundationRepositoryObservation,
} from "@neutral/lifecycle-protocol";
import { compileDeliveryInboxRow } from "../../src/foundation/control/delivery-inbox.js";
import {
  exportDeliveryControl,
  inspectDeliveryControl,
} from "../../src/foundation/control/inspection.js";
import {
  compileDeliveryGeneration,
  deliveryLabel,
} from "../../src/foundation/control/delivery-view.js";
import { compileControlRecordRevision } from "../../src/foundation/control/model.js";
import { publicDeliveryState } from "../../src/foundation/control/public-view.js";
import { openControlRecordStore, type ControlRecordStore } from "../../src/foundation/control/store.js";
import { CONTROL_RECORD_STORE_SCHEMA } from "../../src/foundation/control/types.js";
import { selfDigest, sha256Bytes } from "../../src/foundation/validation/canonical.js";

test("Delivery labels select the initial Director Brief profile independently of later direction ordering", () => {
  const initial = { payload: { inputProfile: "delivery.prepare" }, semanticMarkdown: "# Objective\n\nMake nil error classification safe.\n" };
  const direction = { payload: { inputProfile: "delivery.continue" }, semanticMarkdown: "# Direction\n\nCorrect the current implementation.\n" };
  for (const revisions of [[initial, direction], [direction, initial]]) {
    const store = { identity: { processId: "delivery-label" }, listCurrentRevisions: () => revisions } as unknown as ControlRecordStore;
    assert.equal(deliveryLabel(store), "Make nil error classification safe.");
  }
  const noInitialBrief = { identity: { processId: "delivery-label" }, listCurrentRevisions: () => [direction] } as unknown as ControlRecordStore;
  assert.equal(deliveryLabel(noInitialBrief), "Delivery delivery-label", "a later direction cannot substitute for absent initial intent");
});

test("Delivery labels prefer an authored opening title without adopting later section headings", () => {
  const cases = [
    ["# Preserve failure classification across joined errors\n\nDevelop the smallest change to the error classifier.\n", "Preserve failure classification across joined errors"],
    ["\n# Preserve Go error identity\n\nKeep wrapped errors inspectable.\n", "Preserve Go error identity"],
    ["# Objective\n\nKeep nil error classification safe.\n\n## Implementation\n\nUpdate the classifier.\n", "Keep nil error classification safe."],
    ["Keep nil error classification safe.\n\n# Implementation details\n", "Keep nil error classification safe."],
    ["# Director Brief\n\n## Scope\n\nKeep nil error classification safe.\n", "Keep nil error classification safe."],
    ["# Objective\n\n## Implementation\n", "Delivery delivery-label"],
    [`# ${"A".repeat(200)}\n\nKeep the complete Brief available.\n`, "A".repeat(160)],
  ] as const;
  for (const [semanticMarkdown, expected] of cases) {
    const brief = { payload: { inputProfile: "delivery.prepare" }, semanticMarkdown };
    const store = { identity: { processId: "delivery-label" }, listCurrentRevisions: () => [brief] } as unknown as ControlRecordStore;
    assert.equal(deliveryLabel(store), expected, semanticMarkdown);
    assert.equal(brief.semanticMarkdown, semanticMarkdown, "a navigation label cannot rewrite the retained Brief");
  }
});

test("derives bounded public inspection and Markdown export from one exact Store", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "lifecycle-control-inspection-"));
  try {
    const identity = Object.freeze({
      schema: CONTROL_RECORD_STORE_SCHEMA,
      storeId: "store-inspection",
      targetId: "target-inspection",
      processKind: "delivery" as const,
      processId: "delivery-inspection",
      createdAt: "2026-08-29T08:00:00.000Z",
    });
    const store = await openControlRecordStore({
      root: join(workspace, "store"),
      identity,
      create: true,
    });
    store.append({
      event: {
        eventId: "event-delivery-created-inspection",
        eventKind: "delivery-created",
        occurredAt: identity.createdAt,
        actor: { kind: "runtime", id: "foundation-runtime" },
        payload: {},
      },
    });
    const briefInput = Object.freeze({
      recordId: "brief-inspection",
      recordKind: "director-brief",
      revision: 1,
      producer: Object.freeze({ kind: "runtime" as const, id: "foundation-runtime" }),
      semanticAuthor: Object.freeze({ kind: "director" as const, id: "director-inspection" }),
      semanticAuthority: "director-supplied" as const,
      createdAt: "2026-08-29T08:00:01.000Z",
      semanticMarkdown: "# Objective\n\nInspect one exact Delivery.\n",
      payload: Object.freeze({
        schema: "lifecycle.director-brief-payload.v2",
        scope: { kind: "activity", activityId: "activity-inspection" },
        inputProfile: "delivery.prepare",
        templateProfileId: "director-brief.prepare-v1",
        semanticMarkdownDigest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        submission: Object.freeze({
          rawDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
          rawByteLength: 128,
          normalizedByteLength: 128,
        }),
      }),
    });
    const brief = compileControlRecordRevision(identity.processId, briefInput);
    store.append({
      revision: briefInput,
      event: {
        eventId: "event-director-brief-inspection",
        eventKind: "director-brief-submitted",
        occurredAt: briefInput.createdAt,
        actor: { kind: "runtime", id: "foundation-runtime" },
        subject: { recordId: brief.recordId, revision: brief.revision, digest: brief.digest },
        payload: { activityId: "activity-inspection" },
      },
    });

    const physical = Object.freeze({ disposition: "active" as const, archiveManifestDigest: null });
    assert.equal(deliveryLabel(store), "Inspect one exact Delivery.");
    const state = publicDeliveryState(store, physical);
    assert.equal(state.schema, "lifecycle.delivery-reduction.v5");
    assert.equal(state.storeId, identity.storeId);
    assert.equal(state.journal.eventCount, 2);
    assert.deepEqual(state.eligibleOperations, ["delivery.prepare"]);
    assert.equal(state.storeDisposition.stage, "active");

    const summary = inspectDeliveryControl(store, physical, { kind: "summary" });
    assert.equal(summary.kind, "summary");
    assert.equal(summary.state.processId, identity.processId);

    const events = inspectDeliveryControl(store, physical, {
      kind: "events",
      afterSequence: 0,
      limit: 1,
    });
    assert.equal(events.kind, "events");
    assert.equal(events.events.length, 1);
    assert.equal(events.nextAfterSequence, 1);

    const dossier = inspectDeliveryControl(store, physical, {
      kind: "dossier",
      dossier: "frame",
      afterRecordId: null,
      limit: 10,
    });
    assert.equal(dossier.kind, "dossier");
    assert.equal(dossier.records.length, 1);
    assert.equal(dossier.records[0]?.recordId, brief.recordId);
    assert.equal(dossier.nextAfterRecordId, null);

    const record = inspectDeliveryControl(store, physical, {
      kind: "record",
      reference: {
        kind: "director-brief",
        id: brief.recordId,
        revision: brief.revision,
        digest: brief.digest,
      },
    });
    assert.equal(record.kind, "record");
    assert.equal(record.record.semanticMarkdown, brief.semanticMarkdown);

    const exported = exportDeliveryControl(store, physical, {
      format: "markdown",
      selection: {
        kind: "record",
        reference: {
          kind: "director-brief",
          id: brief.recordId,
          revision: brief.revision,
          digest: brief.digest,
        },
      },
    });
    assert.match(exported.content, /Derived inspection representation/u);
    assert.match(exported.content, /Inspect one exact Delivery\./u);
    assert.equal(exported.byteLength, Buffer.byteLength(exported.content, "utf8"));

    const repository = {
      headCommit: "a".repeat(40),
      headTree: "b".repeat(40),
      repositoryContractDigest: sha256Bytes("inspection-contract"),
    };
    const firstGeneration = compileDeliveryGeneration({ store, physical, repository });
    const firstFamilies = inspectDeliveryControl(store, physical, { kind: "families" }, {
      generation: firstGeneration,
    });
    assert.equal(firstFamilies.kind, "families");
    assert.equal(firstFamilies.generation.digest, firstGeneration.digest);
    store.append({
      event: {
        eventId: "event-activity-inspection",
        eventKind: "activity-started",
        occurredAt: "2026-08-29T08:00:02.000Z",
        actor: { kind: "runtime", id: "foundation-runtime" },
        payload: { activityId: "activity-inspection", operation: "delivery.prepare" },
      },
    });
    const secondGeneration = compileDeliveryGeneration({ store, physical, repository });
    const secondFamilies = inspectDeliveryControl(store, physical, { kind: "families" }, {
      generation: secondGeneration,
    });
    assert.equal(secondFamilies.kind, "families");
    assert.equal(secondFamilies.generation.digest, secondGeneration.digest);
    assert.notEqual(secondFamilies.generation.digest, firstFamilies.generation.digest);
    store.close();
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("public and Inbox read models expose an archived no-ship Candidate as abandoned", () => {
  const candidate = Object.freeze({
    id: "candidate-abandoned",
    revision: 1,
    digest: sha256Bytes("candidate-abandoned"),
  });
  const closure = Object.freeze({
    id: "closure-no-ship",
    revision: 1,
    digest: sha256Bytes("closure-no-ship"),
  });
  const journalDigest = sha256Bytes("journal-no-ship");
  const state = Object.freeze({
    standing: "closed" as const,
    candidateCondition: "abandoned" as const,
    activities: Object.freeze([]),
    subjects: Object.freeze({
      integrationAssessment: null,
      proposedBoundary: null,
      activeBoundary: null,
      candidate,
      materialCondition: null,
      seal: null,
      evidence: null,
      closure,
    }),
    delegation: { admission: null, current: null, charged: { operations: 0, agentAttempts: 0, reservedCellWallTimeMs: 0 } },
    journal: Object.freeze({ eventCount: 1, headDigest: journalDigest }),
    eligibleOperations: Object.freeze([]),
  });
  const seal = Object.freeze({
    schema: "lifecycle.control-record-store-seal.v1",
    closure: Object.freeze({
      recordId: closure.id,
      revision: closure.revision,
      digest: closure.digest,
    }),
    head: Object.freeze({ sequence: 1, digest: journalDigest }),
    logicalInventoryDigest: sha256Bytes("logical-inventory"),
    sealedAt: "2026-08-29T12:00:00.000Z",
  });
  const store = Object.freeze({
    identity: Object.freeze({
      storeId: "store-abandoned",
      processId: "delivery-abandoned",
    }),
    state: () => state,
    getSeal: () => seal,
    getWorkDelegationStopRequest: () => null,
    getRevision: () => null,
    listCurrentRevisions: () => Object.freeze([]),
    listEvents: () => Object.freeze([]),
  }) as unknown as ControlRecordStore;
  const physical = Object.freeze({
    disposition: "archived" as const,
    archiveManifestDigest: sha256Bytes("archive-no-ship"),
  });
  const publicState = publicDeliveryState(store, physical);
  assert.equal(publicState.candidateCondition, "abandoned");
  assert.equal(publicState.storeDisposition.stage, "archived");

  const sealedRecovery = publicDeliveryState(store, {
    disposition: "active",
    archiveManifestDigest: null,
  });
  assert.equal(sealedRecovery.standing, "closed");
  assert.equal(sealedRecovery.candidateCondition, "abandoned");
  assert.deepEqual(sealedRecovery.eligibleOperations, ["delivery.recover"]);
  assert.deepEqual(sealedRecovery.recovery, {
    scope: "store-disposition",
    activityId: null,
    kind: "finalization",
    resumesAt: "store-archive",
    exactEffectDigest: null,
  });

  const unsealedStore = Object.freeze({
    ...store,
    getSeal: () => null,
  }) as unknown as ControlRecordStore;
  const unsealedRecovery = publicDeliveryState(unsealedStore, {
    disposition: "active",
    archiveManifestDigest: null,
  });
  assert.equal(unsealedRecovery.standing, "closed");
  assert.equal(unsealedRecovery.candidateCondition, "abandoned");
  assert.deepEqual(unsealedRecovery.eligibleOperations, ["delivery.recover"]);
  assert.deepEqual(unsealedRecovery.recovery, {
    scope: "store-disposition",
    activityId: null,
    kind: "finalization",
    resumesAt: "store-seal",
    exactEffectDigest: null,
  });

  const inbox = compileDeliveryInboxRow({
    store,
    physical,
    repository: Object.freeze({
      headCommit: "a".repeat(40),
      headTree: "b".repeat(40),
      repositoryContractDigest: sha256Bytes("repository-contract"),
    }) as FoundationRepositoryObservation,
    state: publicState,
  });
  assert.equal(inbox.status, "available");
  if (inbox.status !== "available") throw new TypeError("Expected one available Inbox row");
  assert.equal(inbox.candidateCondition, "abandoned");
});

test("Control family and revision pages stay byte-bounded around large semantic records", () => {
  const identity = Object.freeze({
    schema: CONTROL_RECORD_STORE_SCHEMA,
    storeId: "store-bounded-inspection",
    targetId: "target-bounded-inspection",
    processKind: "delivery" as const,
    processId: "delivery-bounded-inspection",
    createdAt: "2026-08-29T08:00:00.000Z",
  });
  const largeRevision = (recordId: string, revision: number, marker: string) =>
    compileControlRecordRevision(identity.processId, {
      recordId,
      recordKind: "director-brief",
      revision,
      producer: { kind: "runtime", id: "foundation-runtime" },
      semanticAuthor: { kind: "director", id: "director-inspection" },
      semanticAuthority: "director-supplied",
      createdAt: `2026-08-29T08:00:0${revision}.000Z`,
      semanticMarkdown: marker.repeat(900 * 1024),
      payload: { padding: marker.repeat(700 * 1024) },
    });
  const first = largeRevision("brief-large-a", 1, "a");
  const second = largeRevision("brief-large-b", 1, "b");
  const secondRevision = largeRevision("brief-large-a", 2, "c");
  const current = [first, second];
  const revisions = [first, secondRevision];
  const fakeStore = {
    listCurrentRevisions(input: Parameters<ControlRecordStore["listCurrentRevisions"]>[0]) {
      const after = input.afterRecordId ?? "";
      return Object.freeze(current.filter(({ recordId }) => recordId > after).slice(0, input.limit ?? 100));
    },
    listRevisions(input: Parameters<ControlRecordStore["listRevisions"]>[0]) {
      const after = input.afterRevision ?? 0;
      return Object.freeze(revisions.filter(({ revision }) => revision > after).slice(0, input.limit ?? 100));
    },
  } as unknown as ControlRecordStore;
  const physical = Object.freeze({ disposition: "active" as const, archiveManifestDigest: null });
  const generationSource = {
    schema: "lifecycle.delivery-generation.v1" as const,
    storeId: identity.storeId,
    processId: identity.processId,
    journal: { eventCount: 0, headSequence: null, headDigest: null },
    storeDisposition: {
      stage: "active" as const,
      integrity: "verified" as const,
      sealSubjectDigest: null,
      archiveManifestDigest: null,
    },
    repository: {
      headCommit: "a".repeat(40),
      headTree: "b".repeat(40),
      repositoryContractDigest: sha256Bytes("bounded-inspection-contract"),
    },
    activeOperation: null,
  };
  const generation = FoundationDeliveryGenerationSchema.parse({
    ...generationSource,
    digest: selfDigest(generationSource),
  });
  const context = { generation };

  const familyFirst = inspectDeliveryControl(fakeStore, physical, {
    kind: "family",
    recordKind: "director-brief",
    afterRecordId: null,
    limit: 200,
  }, context);
  assert.equal(familyFirst.kind, "family");
  assert.deepEqual(familyFirst.records.map(({ recordId }) => recordId), [first.recordId]);
  assert.equal(familyFirst.nextAfterRecordId, first.recordId);
  const familySecond = inspectDeliveryControl(fakeStore, physical, {
    kind: "family",
    recordKind: "director-brief",
    afterRecordId: familyFirst.nextAfterRecordId,
    limit: 200,
  }, context);
  assert.equal(familySecond.kind, "family");
  assert.deepEqual(familySecond.records.map(({ recordId }) => recordId), [second.recordId]);
  assert.equal(familySecond.nextAfterRecordId, null);

  const revisionFirst = inspectDeliveryControl(fakeStore, physical, {
    kind: "revisions",
    recordId: first.recordId,
    afterRevision: 0,
    limit: 200,
  }, context);
  assert.equal(revisionFirst.kind, "revisions");
  assert.deepEqual(revisionFirst.records.map(({ revision }) => revision), [1]);
  assert.equal(revisionFirst.nextAfterRevision, 1);
  const revisionSecond = inspectDeliveryControl(fakeStore, physical, {
    kind: "revisions",
    recordId: first.recordId,
    afterRevision: revisionFirst.nextAfterRevision ?? 0,
    limit: 200,
  }, context);
  assert.equal(revisionSecond.kind, "revisions");
  assert.deepEqual(revisionSecond.records.map(({ revision }) => revision), [2]);
  assert.equal(revisionSecond.nextAfterRevision, null);
});
