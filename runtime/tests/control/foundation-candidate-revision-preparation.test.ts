import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareCandidateRevisionRetention,
  type CandidateRevisionCarrierVerifier,
  type CandidateRevisionState,
} from "../../src/foundation/control/candidate-revision.js";
import {
  commitPreparedCandidateRevisionThroughActivityV7,
} from "../../src/foundation/process/candidate-revision-retention-v7.js";
import type {
  FoundationActivityKernelCheckpointAdapterV7,
  FoundationActivityKernelContextV7,
} from "../../src/foundation/process/activity-kernel-v7.js";
import {
  compileControlRecordEvent,
  compileControlRecordRevision,
} from "../../src/foundation/control/model.js";
import {
  compileControlRecordFile,
  type ControlRecordStore,
} from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlRecordEvent,
  type ControlRecordFile,
  type ControlRecordRevision,
  type ControlRecordStoreAppend,
  type ControlRecordStoreAppendWithFiles,
  type ControlRecordStoreIdentity,
} from "../../src/foundation/control/types.js";
import {
  canonicalJson,
  digestCanonical,
  sha256Bytes,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";
import { testCandidateCarrierManifestBytes } from "../support/candidate-revision-carrier-fixture.js";

const CREATED = "2026-08-30T10:00:00.000Z";
const PROCESS = "delivery-candidate-preparation";
const RUNTIME = "foundation-runtime";
const BASE_COMMIT = "a".repeat(40);
const BASE_TREE = "b".repeat(40);
const PRODUCT_STATE = sha256Bytes("prepared-product-state");
const KNOWLEDGE_SET = sha256Bytes("prepared-knowledge-set");
const PATH_INVENTORY = sha256Bytes("prepared-path-inventory");

function candidateState(): CandidateRevisionState {
  const facts = Object.freeze({
    tree: BASE_TREE,
    productStateDigest: PRODUCT_STATE,
    knowledgeSetDigest: KNOWLEDGE_SET,
    diffDigest: sha256Bytes(new Uint8Array()),
    pathInventoryDigest: PATH_INVENTORY,
    artifactSetDigest: PRODUCT_STATE,
    descriptionCoverageDigest: sha256Bytes("prepared-description-coverage"),
    unchangedFromPredecessor: true,
    changedSubjects: Object.freeze([]),
  });
  return Object.freeze({
    ...facts,
    candidateDigest: digestCanonical({
      schema: "lifecycle.delivery-candidate-state.v1",
      candidateBaseCommit: BASE_COMMIT,
      tree: facts.tree,
      productStateDigest: facts.productStateDigest,
      knowledgeSetDigest: facts.knowledgeSetDigest,
      diffDigest: facts.diffDigest,
      pathInventoryDigest: facts.pathInventoryDigest,
      artifactSetDigest: facts.artifactSetDigest,
      descriptionCoverageDigest: facts.descriptionCoverageDigest,
      changedSubjects: facts.changedSubjects,
    }),
  });
}

function boundaryRevision(): ControlRecordRevision {
  return compileControlRecordRevision(PROCESS, {
    recordId: "boundary-candidate-preparation",
    recordKind: "work-boundary",
    revision: 1,
    producer: { kind: "runtime", id: RUNTIME },
    semanticAuthor: { kind: "runtime", id: RUNTIME },
    semanticAuthority: "runtime-derived",
    createdAt: CREATED,
    semanticMarkdown: "# Work Boundary\n",
    payload: {
      basis: {
        productBaseCommit: BASE_COMMIT,
        productBaseTree: BASE_TREE,
        productStateDigest: PRODUCT_STATE,
        knowledgeSetDigest: KNOWLEDGE_SET,
      },
    },
    relationships: [],
  });
}

type Fixture = Readonly<{
  store: ControlRecordStore;
  revisions: Map<string, ControlRecordRevision>;
  files: Map<Sha256, ControlRecordFile>;
  events: ControlRecordEvent[];
  commits: ControlRecordStoreAppendWithFiles[];
}>;

function fakeStore(): Fixture {
  const identity: ControlRecordStoreIdentity = Object.freeze({
    schema: CONTROL_RECORD_STORE_SCHEMA,
    storeId: "store-candidate-preparation",
    targetId: "target-candidate-preparation",
    processKind: "delivery",
    processId: PROCESS,
    createdAt: CREATED,
  });
  const revisions = new Map<string, ControlRecordRevision>();
  const boundary = boundaryRevision();
  revisions.set(`${boundary.recordId}\0${boundary.revision}`, boundary);
  const files = new Map<Sha256, ControlRecordFile>();
  const events: ControlRecordEvent[] = [];
  const commits: ControlRecordStoreAppendWithFiles[] = [];
  let predecessorDigest: Sha256 | null = null;

  const append = (input: ControlRecordStoreAppend) => {
    const revision = input.revision === undefined
      ? null
      : compileControlRecordRevision(identity.processId, input.revision);
    const event = compileControlRecordEvent({
      storeId: identity.storeId,
      processId: identity.processId,
      sequence: events.length + 1,
      predecessorDigest,
      event: input.event,
    });
    if (revision !== null) {
      revisions.set(`${revision.recordId}\0${revision.revision}`, revision);
    }
    events.push(event);
    predecessorDigest = event.digest;
    return Object.freeze({ revision, event });
  };

  const store = {
    identity,
    getRevision(recordId: string, revision: number) {
      return revisions.get(`${recordId}\0${revision}`) ?? null;
    },
    listRetainedFiles() {
      return Object.freeze([...files.values()]);
    },
    async appendWithFiles(input: ControlRecordStoreAppendWithFiles) {
      commits.push(input);
      const retainedFiles = input.files.map((file) => {
        const descriptor = compileControlRecordFile(file);
        const existing = files.get(descriptor.digest);
        if (existing === undefined) files.set(descriptor.digest, descriptor);
        else assert.equal(canonicalJson(existing), canonicalJson(descriptor));
        return descriptor;
      });
      return Object.freeze({
        files: Object.freeze(retainedFiles),
        appends: Object.freeze(input.appends.map(append)),
      });
    },
  } as unknown as ControlRecordStore;
  return Object.freeze({ store, revisions, files, events, commits });
}

function selectedInput(fixture: Fixture, verifications: string[]) {
  const state = candidateState();
  const manifestBytes = testCandidateCarrierManifestBytes(
    state.tree,
    state.pathInventoryDigest,
  );
  const verifyCarrier: CandidateRevisionCarrierVerifier = async ({ manifestBytes: selected }) => {
    verifications.push("verified");
    assert.deepEqual(Buffer.from(selected), Buffer.from(manifestBytes));
    return Object.freeze({
      manifestFileDigest: sha256Bytes(selected),
      state,
      observer: Object.freeze({
        implementationId: "candidate-preparation-observer-v1",
        implementationDigest: sha256Bytes("candidate-preparation-observer-v1"),
      }),
    });
  };
  const boundary = boundaryRevision();
  return Object.freeze({
    store: fixture.store,
    activityId: "activity-candidate-preparation",
    observation: "initialization" as const,
    candidateBaseCommit: BASE_COMMIT,
    carrierManifestBytes: manifestBytes,
    verifyCarrier,
    limitations: Object.freeze(["none", "none"]),
    boundary: Object.freeze({
      kind: "work-boundary" as const,
      id: boundary.recordId,
      revision: boundary.revision,
      digest: boundary.digest,
    }),
    observedAt: CREATED,
    runtimeId: RUNTIME,
  });
}

test("Candidate Revision preparation validates exact facts without changing the Store", async () => {
  const fixture = fakeStore();
  const verifications: string[] = [];
  const beforeRevisions = fixture.revisions.size;
  const prepared = await prepareCandidateRevisionRetention(
    selectedInput(fixture, verifications),
  );

  assert.deepEqual(verifications, ["verified"]);
  assert.equal(fixture.commits.length, 0);
  assert.equal(fixture.files.size, 0);
  assert.equal(fixture.events.length, 0);
  assert.equal(fixture.revisions.size, beforeRevisions);
  assert.equal(prepared.files.length, 1);
  assert.equal(prepared.append.revision?.recordKind, "candidate-revision");
  assert.equal(prepared.append.event.eventKind, "candidate-revision-observed");
  assert.equal(
    canonicalJson(compileControlRecordRevision(
      fixture.store.identity.processId,
      prepared.append.revision!,
    )),
    canonicalJson(prepared.expected.revision),
  );
  assert.equal(
    compileControlRecordFile(prepared.files[0]).digest,
    prepared.expected.carrierManifest.digest,
  );
  assert.equal(canonicalJson(prepared.append.event), canonicalJson(prepared.expected.event));
});

test("the Activity file checkpoint atomically retains a prepared Candidate Revision", async () => {
  const fixture = fakeStore();
  const prepared = await prepareCandidateRevisionRetention(
    selectedInput(fixture, []),
  );
  const expected = Object.freeze({
    generation: 7,
    payloadDigest: sha256Bytes("candidate-activity-generation-7"),
  });
  const checkpoint = Object.freeze({
    schema: "lifecycle.test.candidate-revision-checkpoint.v1",
    phase: "candidate-retained",
  });
  const context = Object.freeze({ marker: "advanced-activity-context" }) as unknown as
    FoundationActivityKernelContextV7;
  const activityCalls: unknown[] = [];
  const activity = Object.freeze({
    current() {
      return context;
    },
    commit() {
      throw new Error("Candidate retention must use the file-bound Activity commit");
    },
    async commitWithFiles(input: Parameters<FoundationActivityKernelCheckpointAdapterV7["commitWithFiles"]>[0]) {
      activityCalls.push(input);
      const committed = await fixture.store.appendWithFiles({
        files: input.files,
        appends: Object.freeze([input.append]),
      });
      return Object.freeze({
        context,
        append: committed.appends[0] ?? null,
        files: committed.files,
      });
    },
  }) as FoundationActivityKernelCheckpointAdapterV7;

  const committed = await commitPreparedCandidateRevisionThroughActivityV7({
    activity,
    expected,
    checkpoint,
    prepared,
  });

  assert.equal(activityCalls.length, 1);
  assert.equal(committed.context, context);
  assert.equal(
    canonicalJson(committed.retained.carrierManifest),
    canonicalJson(prepared.expected.carrierManifest),
  );
  assert.equal(
    canonicalJson(committed.retained.revision),
    canonicalJson(prepared.expected.revision),
  );
  assert.equal(committed.retained.event.eventKind, "candidate-revision-observed");
  assert.deepEqual(activityCalls[0], {
    expected,
    checkpoint,
    append: prepared.append,
    files: prepared.files,
  });
  assert.equal(
    fixture.files.has(prepared.expected.carrierManifest.digest),
    true,
  );
  assert.equal(
    fixture.revisions.has(
      `${prepared.expected.revision.recordId}\0${prepared.expected.revision.revision}`,
    ),
    true,
  );
  assert.equal(fixture.events[0]!.eventKind, prepared.expected.event.eventKind);
});

test("the Activity retention finalizer refuses a substituted commit result", async () => {
  const fixture = fakeStore();
  const prepared = await prepareCandidateRevisionRetention(selectedInput(fixture, []));
  const activity = Object.freeze({
    current() {
      throw new Error("not used");
    },
    commit() {
      throw new Error("not used");
    },
    async commitWithFiles() {
      return Object.freeze({
        context: Object.freeze({}) as unknown as FoundationActivityKernelContextV7,
        append: null,
        files: Object.freeze([]),
      });
    },
  }) as FoundationActivityKernelCheckpointAdapterV7;

  await assert.rejects(
    commitPreparedCandidateRevisionThroughActivityV7({
      activity,
      expected: Object.freeze({
        generation: 1,
        payloadDigest: sha256Bytes("substituted-activity-generation"),
      }),
      checkpoint: null,
      prepared,
    }),
    /did not retain one exact prepared append and file/u,
  );
});
