import assert from "node:assert/strict";
import test from "node:test";
import {
  retainCandidateRevision,
  type CandidateRevisionAttemptReference,
  type CandidateRevisionCarrierVerifier,
  type CandidateRevisionReference,
  type CandidateRevisionState,
} from "../../src/foundation/control/candidate-revision.js";
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
  type ControlRecordFile,
  type ControlRecordRevision,
  type ControlRecordStoreAppend,
  type ControlRecordStoreAppendWithFiles,
  type ControlRecordStoreIdentity,
} from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import {
  digestCanonical,
  sha256Bytes,
} from "../../src/foundation/validation/canonical.js";
import { testCandidateCarrierManifestBytes } from "../support/candidate-revision-carrier-fixture.js";
import { foundationIntegrationValidationFactsDigestV1, parseFoundationIntegrationAssessmentPayloadV1, prepareIntegrationAssessmentRetentionV1 } from "../../src/foundation/control/integration-assessment.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";
import { selfDigest } from "../../src/foundation/validation/canonical.js";
import type { ControlJsonObject } from "../../src/foundation/control/types.js";

const CREATED = "2026-08-29T16:00:00.000Z";
const RUNTIME = "foundation-runtime";
const PROCESS = "delivery-candidate-compiler";
const BASE_COMMIT = "a".repeat(40);
const BASE_TREE = "b".repeat(40);

function digest(value: string) {
  return sha256Bytes(value);
}

const BASE_PRODUCT_STATE_DIGEST = digest("product-base");
const BASE_KNOWLEDGE_SET_DIGEST = digest("knowledge-base");
const CARRIER_OBSERVER = Object.freeze({
  implementationId: "candidate-carrier-observer-v1",
  implementationDigest: digest("candidate-carrier-observer-v1"),
});

function boundaryRevision(input: Readonly<{
  revision: number;
  createdAt: string;
}>): ControlRecordRevision {
  return compileControlRecordRevision(PROCESS, {
    recordId: "boundary-candidate-compiler",
    recordKind: "work-boundary",
    revision: input.revision,
    producer: { kind: "runtime", id: RUNTIME },
    semanticAuthor: { kind: "runtime", id: RUNTIME },
    semanticAuthority: "runtime-derived",
    createdAt: input.createdAt,
    semanticMarkdown: "# Work Boundary\n",
    payload: {
      basis: {
        productBaseCommit: BASE_COMMIT,
        productBaseTree: BASE_TREE,
        productStateDigest: BASE_PRODUCT_STATE_DIGEST,
        knowledgeSetDigest: BASE_KNOWLEDGE_SET_DIGEST,
      },
    },
    relationships: [],
  });
}

const retainedBoundary = boundaryRevision({ revision: 1, createdAt: CREATED });
const retainedSuccessorBoundary = boundaryRevision({
  revision: 2,
  createdAt: "2026-08-29T16:00:00.500Z",
});

function fakeStore() {
  const identity: ControlRecordStoreIdentity = Object.freeze({
    schema: CONTROL_RECORD_STORE_SCHEMA,
    storeId: "store-candidate-compiler",
    targetId: "target-candidate-compiler",
    processKind: "delivery",
    processId: PROCESS,
    createdAt: CREATED,
  });
  const revisions = new Map<string, ControlRecordRevision>();
  revisions.set(
    `${retainedBoundary.recordId}\u0000${retainedBoundary.revision}`,
    retainedBoundary,
  );
  revisions.set(
    `${retainedSuccessorBoundary.recordId}\u0000${retainedSuccessorBoundary.revision}`,
    retainedSuccessorBoundary,
  );
  const files = new Map<string, ControlRecordFile>();
  const stages: string[] = [];
  let sequence = 0;
  let predecessorDigest = null as ReturnType<typeof digest> | null;

  function append(input: ControlRecordStoreAppend) {
    const revision = input.revision === undefined
      ? null
      : compileControlRecordRevision(identity.processId, input.revision);
    if (revision !== null) revisions.set(`${revision.recordId}\u0000${revision.revision}`, revision);
    sequence += 1;
    const event = compileControlRecordEvent({
      storeId: identity.storeId,
      processId: identity.processId,
      sequence,
      predecessorDigest,
      event: input.event,
    });
    predecessorDigest = event.digest;
    return Object.freeze({ revision, event });
  }

  const store = {
    identity,
    getRevision(recordId: string, revision: number) {
      return revisions.get(`${recordId}\u0000${revision}`) ?? null;
    },
    listRetainedFiles() {
      return Object.freeze([...files.values()]);
    },
    append,
    async appendWithFiles(input: ControlRecordStoreAppendWithFiles) {
      stages.push("append");
      const retainedFiles = input.files.map((file) => {
        const descriptor = compileControlRecordFile(file);
        const existing = files.get(descriptor.digest);
        if (existing === undefined) files.set(descriptor.digest, descriptor);
        else assert.deepEqual(descriptor, existing, "one manifest digest must preserve file metadata");
        return descriptor;
      });
      return Object.freeze({
        files: Object.freeze(retainedFiles),
        appends: Object.freeze(input.appends.map(append)),
      });
    },
  } as unknown as ControlRecordStore;
  return { store, revisions, files, stages } as const;
}

const boundary = Object.freeze({
  kind: "work-boundary" as const,
  id: retainedBoundary.recordId,
  revision: retainedBoundary.revision,
  digest: retainedBoundary.digest,
});

const successorBoundary = Object.freeze({
  kind: "work-boundary" as const,
  id: retainedSuccessorBoundary.recordId,
  revision: retainedSuccessorBoundary.revision,
  digest: retainedSuccessorBoundary.digest,
});

const builderAttempt: CandidateRevisionAttemptReference = Object.freeze({
  kind: "agent-attempt",
  id: "attempt-candidate-compiler",
  revision: 1,
  digest: digest("builder-attempt"),
});

function candidateDigest(state: Omit<CandidateRevisionState, "candidateDigest">) {
  const changedSubjects = [...state.changedSubjects].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return digestCanonical({
    schema: "lifecycle.delivery-candidate-state.v1",
    candidateBaseCommit: BASE_COMMIT,
    tree: state.tree,
    productStateDigest: state.productStateDigest,
    knowledgeSetDigest: state.knowledgeSetDigest,
    diffDigest: state.diffDigest,
    pathInventoryDigest: state.pathInventoryDigest,
    artifactSetDigest: state.artifactSetDigest,
    descriptionCoverageDigest: state.descriptionCoverageDigest,
    changedSubjects,
  });
}

function withCandidateDigest(
  state: Omit<CandidateRevisionState, "candidateDigest">,
): CandidateRevisionState {
  return Object.freeze({
    ...state,
    candidateDigest: candidateDigest(state),
  });
}

function state(unchangedFromPredecessor: boolean): CandidateRevisionState {
  const initial = unchangedFromPredecessor;
  const changedSubjects = initial
    ? Object.freeze([])
    : Object.freeze([
      Object.freeze({
        path: "src/a.ts",
        change: "added" as const,
        beforeDigest: null,
        afterDigest: digest("a-after"),
      }),
      Object.freeze({
        path: "src/z.ts",
        change: "modified" as const,
        beforeDigest: digest("z-before"),
        afterDigest: digest("z-after"),
      }),
    ]);
  const stateWithoutCandidateDigest = Object.freeze({
    tree: initial ? BASE_TREE : "c".repeat(40),
    productStateDigest: initial ? BASE_PRODUCT_STATE_DIGEST : digest("product-successor"),
    knowledgeSetDigest: initial ? BASE_KNOWLEDGE_SET_DIGEST : digest("knowledge-successor"),
    diffDigest: initial ? sha256Bytes(new Uint8Array()) : digest("diff-successor"),
    pathInventoryDigest: initial ? digest("paths-base") : digest("paths-successor"),
    artifactSetDigest: initial ? BASE_PRODUCT_STATE_DIGEST : digest("product-successor"),
    descriptionCoverageDigest: initial ? digest("coverage-base") : digest("coverage-successor"),
    changedSubjects,
  });
  return withCandidateDigest({
    ...stateWithoutCandidateDigest,
    unchangedFromPredecessor,
  });
}

function verifier(
  stages: string[],
  selectedState: CandidateRevisionState,
  expectedManifest: Uint8Array = testCandidateCarrierManifestBytes(
    selectedState.tree,
    selectedState.pathInventoryDigest,
  ),
): CandidateRevisionCarrierVerifier {
  return async (input) => {
    stages.push("verify");
    assert.deepEqual(Buffer.from(input.manifestBytes), Buffer.from(expectedManifest));
    return Object.freeze({
      manifestFileDigest: sha256Bytes(input.manifestBytes),
      state: selectedState,
      observer: CARRIER_OBSERVER,
    });
  };
}

function initialInput(store: ControlRecordStore, stages: string[], selectedState = state(true)) {
  const manifestBytes = testCandidateCarrierManifestBytes(
    selectedState.tree,
    selectedState.pathInventoryDigest,
  );
  return Object.freeze({
    store,
    activityId: "activity-admit",
    observation: "initialization" as const,
    candidateBaseCommit: BASE_COMMIT,
    carrierManifestBytes: manifestBytes,
    verifyCarrier: verifier(stages, selectedState, manifestBytes),
    limitations: ["none", "none"],
    boundary,
    observedAt: CREATED,
    runtimeId: RUNTIME,
  });
}

test("Candidate integration refuses a different verified Carrier than its exact Assessment observed", async () => {
  for (const substitute of [false, true]) {
    const fixture = fakeStore();
    const initial = await retainCandidateRevision(initialInput(fixture.store, fixture.stages));
    const constructedState = state(false);
    const constructedBytes = testCandidateCarrierManifestBytes(constructedState.tree, constructedState.pathInventoryDigest);
    const payload = validDeliveryControlPayload("integration-assessment");
    const parent = { ...(payload.canonicalParent as ControlJsonObject), targetId: fixture.store.identity.targetId,
      commit: BASE_COMMIT, tree: BASE_TREE };
    const assessment = prepareIntegrationAssessmentRetentionV1({
      store: fixture.store, activityId: "activity-integration", boundary: retainedBoundary,
      sourceCandidate: initial.revision, runtimeId: RUNTIME,
      payload: parseFoundationIntegrationAssessmentPayloadV1({ ...payload,
        canonicalParent: { ...parent, digest: selfDigest(parent) },
        validation: { complete: true, valid: true, diagnosticCodes: [],
          factsDigest: foundationIntegrationValidationFactsDigestV1({ manifestFileDigest: sha256Bytes(constructedBytes), state: constructedState, observer: CARRIER_OBSERVER }) },
        assessedAt: "2026-08-29T16:00:01.000Z",
      }),
    });
    fixture.store.append(assessment.append);
    const selectedState = substitute ? withCandidateDigest({ ...constructedState, tree: "d".repeat(40) }) : constructedState;
    const selectedBytes = testCandidateCarrierManifestBytes(selectedState.tree, selectedState.pathInventoryDigest);
    const retain = () => retainCandidateRevision({
      store: fixture.store, activityId: "activity-integration", observation: "integration-successor",
      candidateBaseCommit: BASE_COMMIT, carrierManifestBytes: selectedBytes,
      verifyCarrier: verifier(fixture.stages, selectedState, selectedBytes), boundary,
      predecessor: { kind: "candidate-revision", id: initial.revision.recordId, revision: initial.revision.revision, digest: initial.revision.digest },
      integrationAssessment: { kind: "integration-assessment", id: assessment.revision.recordId, revision: assessment.revision.revision, digest: assessment.revision.digest },
      observedAt: "2026-08-29T16:00:01.000Z", runtimeId: RUNTIME,
    });
    if (substitute) {
      await assert.rejects(retain, (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.control-candidate-revision.integration");
      assert.equal(fixture.files.size, 1);
      assert.equal(fixture.store.getRevision(initial.revision.recordId, 2), null);
    } else {
      const retained = await retain();
      assert.equal(retained.revision.revision, 2);
      assert.equal(retained.revision.payload.observation, "integration-successor");
    }
  }
});

test("Candidate compiler verifies and atomically retains complete current state and Carrier manifest", async () => {
  const { store, files, stages } = fakeStore();
  const retained = await retainCandidateRevision(initialInput(store, stages));
  const manifestBytes = testCandidateCarrierManifestBytes(
    state(true).tree,
    state(true).pathInventoryDigest,
  );

  assert.deepEqual(stages, ["verify", "append"]);
  assert.match(retained.revision.recordId, /^candidate-[a-f0-9]{64}$/u);
  assert.equal(retained.revision.recordKind, "candidate-revision");
  assert.equal(retained.revision.revision, 1);
  assert.equal(retained.revision.semanticAuthority, "runtime-observed");
  assert.equal(retained.revision.payload.schema, "lifecycle.candidate-revision-payload.v3");
  assert.equal("availability" in retained.revision.payload, false);
  assert.equal("failureFactsDigest" in retained.revision.payload, false);
  assert.deepEqual(retained.revision.payload.observer, CARRIER_OBSERVER);
  assert.deepEqual(retained.revision.payload.limitations, ["none"]);
  assert.deepEqual(
    (retained.revision.payload.state as { changedSubjects: readonly { path: string }[] }).changedSubjects
      .map(({ path }) => path),
    [],
  );
  assert.deepEqual(retained.revision.payload.carrierManifest, {
    digest: sha256Bytes(manifestBytes),
    byteLength: manifestBytes.byteLength,
    mediaType: "application/vnd.lifecycle.candidate-revision-carrier-manifest+json",
    purpose: "candidate-revision-carrier-manifest",
  });
  assert.deepEqual(retained.revision.relationships.map(({ relation }) => relation), ["governed-by"]);
  assert.equal(retained.event.eventKind, "candidate-revision-observed");
  assert.deepEqual(retained.event.payload, { activityId: "activity-admit" });
  assert.deepEqual(files.get(retained.carrierManifest.digest), retained.carrierManifest);
  assert.doesNotMatch(retained.revision.semanticMarkdown, /Availability/u);
});

test("Candidate compiler advances through a builder-successor bound to its exact Attempt", async () => {
  const fixture = fakeStore();
  const initial = await retainCandidateRevision(initialInput(fixture.store, fixture.stages));
  const predecessor: CandidateRevisionReference = Object.freeze({
    kind: "candidate-revision",
    id: initial.revision.recordId,
    revision: initial.revision.revision,
    digest: initial.revision.digest,
  });
  const nextState = state(false);
  const successor = await retainCandidateRevision({
    ...initialInput(fixture.store, fixture.stages, nextState),
    activityId: "activity-continue",
    observation: "builder-successor",
    predecessor,
    builderAttempt,
    observedAt: "2026-08-29T16:00:01.000Z",
  });
  assert.equal(successor.revision.recordId, initial.revision.recordId);
  assert.equal(successor.revision.revision, 2);
  assert.deepEqual(
    successor.revision.relationships.map(({ relation }) => relation),
    ["governed-by", "result-of", "revises"],
  );

  await assert.rejects(retainCandidateRevision({
    ...initialInput(fixture.store, fixture.stages, nextState),
    activityId: "activity-drift",
    observation: "builder-successor",
    candidateBaseCommit: "c".repeat(40),
    predecessor,
    builderAttempt,
    observedAt: "2026-08-29T16:00:02.000Z",
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-candidate-revision.base");

  await assert.rejects(retainCandidateRevision({
    ...initialInput(fixture.store, fixture.stages, nextState),
    activityId: "activity-no-attempt",
    observation: "builder-successor",
    predecessor,
    observedAt: "2026-08-29T16:00:02.000Z",
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-candidate-revision.builder-attempt");
});

test("Candidate readmission preserves byte-identical state and Carrier binding", async () => {
  const fixture = fakeStore();
  const initial = await retainCandidateRevision(initialInput(fixture.store, fixture.stages));
  const predecessor: CandidateRevisionReference = Object.freeze({
    kind: "candidate-revision",
    id: initial.revision.recordId,
    revision: initial.revision.revision,
    digest: initial.revision.digest,
  });

  const initialState = state(true);
  const {
    candidateDigest: _candidateDigest,
    ...initialStateWithoutCandidateDigest
  } = initialState;
  await assert.rejects(retainCandidateRevision({
    ...initialInput(fixture.store, fixture.stages),
    activityId: "activity-readmit-mutated",
    observation: "readmission-rebind",
    verifyCarrier: verifier(fixture.stages, withCandidateDigest({
      ...initialStateWithoutCandidateDigest,
      descriptionCoverageDigest: digest("mutated-coverage"),
    })),
    boundary: successorBoundary,
    predecessor,
    observedAt: "2026-08-29T16:00:01.000Z",
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-candidate-revision.rebind");

  const changedCarrier = testCandidateCarrierManifestBytes(
    initialState.tree,
    digest("different-carrier-artifact"),
  );
  await assert.rejects(retainCandidateRevision({
    ...initialInput(fixture.store, fixture.stages),
    activityId: "activity-readmit-changed-carrier",
    observation: "readmission-rebind",
    carrierManifestBytes: changedCarrier,
    verifyCarrier: verifier(fixture.stages, initialState, changedCarrier),
    boundary: successorBoundary,
    predecessor,
    observedAt: "2026-08-29T16:00:01.000Z",
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-candidate-revision.rebind");

  await assert.rejects(retainCandidateRevision({
    ...initialInput(fixture.store, fixture.stages),
    activityId: "activity-readmit-same-boundary",
    observation: "readmission-rebind",
    boundary,
    predecessor,
    observedAt: "2026-08-29T16:00:01.000Z",
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-candidate-revision.rebind-boundary");

  const rebound = await retainCandidateRevision({
    ...initialInput(fixture.store, fixture.stages),
    activityId: "activity-readmit",
    observation: "readmission-rebind",
    boundary: successorBoundary,
    predecessor,
    observedAt: "2026-08-29T16:00:01.000Z",
  });
  assert.equal(rebound.revision.recordId, initial.revision.recordId);
  assert.equal(rebound.revision.revision, initial.revision.revision + 1);
  assert.equal(rebound.revision.payload.candidateBaseCommit, initial.revision.payload.candidateBaseCommit);
  assert.deepEqual(rebound.revision.payload.state, initial.revision.payload.state);
  assert.deepEqual(rebound.revision.payload.carrierManifest, initial.revision.payload.carrierManifest);
  assert.equal(rebound.carrierManifest.createdAt, initial.carrierManifest.createdAt);
  assert.equal(rebound.revision.payload.observation, "readmission-rebind");
  assert.deepEqual(
    rebound.revision.relationships.map(({ relation }) => relation),
    ["governed-by", "revises"],
  );
});

test("Candidate readmission preserves a changed predecessor's historical state fact", async () => {
  const fixture = fakeStore();
  const initial = await retainCandidateRevision(initialInput(fixture.store, fixture.stages));
  const initialReference: CandidateRevisionReference = Object.freeze({
    kind: "candidate-revision",
    id: initial.revision.recordId,
    revision: initial.revision.revision,
    digest: initial.revision.digest,
  });
  const changedState = state(false);
  const changed = await retainCandidateRevision({
    ...initialInput(fixture.store, fixture.stages, changedState),
    activityId: "activity-builder-changed",
    observation: "builder-successor",
    predecessor: initialReference,
    builderAttempt,
    observedAt: "2026-08-29T16:00:01.000Z",
  });
  const changedReference: CandidateRevisionReference = Object.freeze({
    kind: "candidate-revision",
    id: changed.revision.recordId,
    revision: changed.revision.revision,
    digest: changed.revision.digest,
  });
  const replayedState = Object.freeze({
    ...changedState,
    // Fresh Carrier replay sees content equal to its immediate input. The
    // rebind must nevertheless preserve the predecessor Revision's complete
    // byte-identical historical state as required by Control.
    unchangedFromPredecessor: true,
  });
  const manifestBytes = testCandidateCarrierManifestBytes(
    changedState.tree,
    changedState.pathInventoryDigest,
  );
  const rebound = await retainCandidateRevision({
    ...initialInput(fixture.store, fixture.stages, changedState),
    activityId: "activity-readmit-changed",
    observation: "readmission-rebind",
    carrierManifestBytes: manifestBytes,
    verifyCarrier: verifier(fixture.stages, replayedState, manifestBytes),
    boundary: successorBoundary,
    predecessor: changedReference,
    observedAt: "2026-08-29T16:00:02.000Z",
  });

  assert.deepEqual(rebound.revision.payload.state, changed.revision.payload.state);
  assert.deepEqual(
    rebound.revision.payload.carrierManifest,
    changed.revision.payload.carrierManifest,
  );
});

test("Candidate compiler refuses invalid Carrier verification before append", async () => {
  const fixture = fakeStore();
  const selectedState = state(true);
  const {
    candidateDigest: _selectedCandidateDigest,
    ...selectedStateWithoutCandidateDigest
  } = selectedState;
  const substitutedRootState = withCandidateDigest({
    ...selectedStateWithoutCandidateDigest,
    tree: "c".repeat(40),
  });
  let invalidManifestVerifierCalled = false;
  await assert.rejects(retainCandidateRevision({
    ...initialInput(fixture.store, fixture.stages, selectedState),
    carrierManifestBytes: Buffer.from('{"schema":"not-a-carrier-manifest"}', "utf8"),
    verifyCarrier: async () => {
      invalidManifestVerifierCalled = true;
      throw new Error("invalid manifest must refuse before physical verification");
    },
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-candidate-revision.carrier-manifest");
  assert.equal(invalidManifestVerifierCalled, false);

  await assert.rejects(retainCandidateRevision({
    ...initialInput(fixture.store, fixture.stages, selectedState),
    verifyCarrier: async (input) => Object.freeze({
      manifestFileDigest: sha256Bytes(input.manifestBytes),
      state: substitutedRootState,
      observer: CARRIER_OBSERVER,
    }),
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-candidate-revision.carrier-subject");
  assert.deepEqual(fixture.stages, []);

  await assert.rejects(retainCandidateRevision({
    ...initialInput(fixture.store, fixture.stages, selectedState),
    verifyCarrier: async () => Object.freeze({
      manifestFileDigest: digest("different-manifest"),
      state: selectedState,
      observer: CARRIER_OBSERVER,
    }),
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-candidate-revision.carrier-manifest");
  assert.deepEqual(fixture.stages, []);

  await assert.rejects(retainCandidateRevision({
    ...initialInput(fixture.store, fixture.stages, selectedState),
    verifyCarrier: async (input) => {
      input.manifestBytes[0] = input.manifestBytes[0]! ^ 0xff;
      return Object.freeze({
        manifestFileDigest: sha256Bytes(testCandidateCarrierManifestBytes(
          selectedState.tree,
          selectedState.pathInventoryDigest,
        )),
        state: selectedState,
        observer: CARRIER_OBSERVER,
      });
    },
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-candidate-revision.carrier-manifest");
  assert.deepEqual(fixture.stages, []);
});

test("Candidate compiler refuses ambiguous changed-subject facts reproduced from the Carrier", async () => {
  const fixture = fakeStore();
  const selectedState = state(false);
  await assert.rejects(retainCandidateRevision({
    ...initialInput(fixture.store, fixture.stages, selectedState),
    verifyCarrier: verifier(fixture.stages, {
      ...selectedState,
      changedSubjects: [
        ...selectedState.changedSubjects,
        { ...selectedState.changedSubjects[0]! },
      ],
    }),
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-candidate-revision.changed-subject");
  assert.deepEqual(fixture.stages, ["verify"]);
});

test("Candidate compiler refuses every locally detectable cross-state substitution", async () => {
  const inventedDigestFixture = fakeStore();
  await assert.rejects(retainCandidateRevision({
    ...initialInput(inventedDigestFixture.store, inventedDigestFixture.stages),
    verifyCarrier: verifier(inventedDigestFixture.stages, {
      ...state(true),
      candidateDigest: digest("invented-candidate-digest"),
    }),
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-candidate-revision.state-digest");
  assert.deepEqual(inventedDigestFixture.stages, ["verify"]);

  const artifactFixture = fakeStore();
  const initialState = state(true);
  const {
    candidateDigest: _initialCandidateDigest,
    ...initialWithoutCandidateDigest
  } = initialState;
  await assert.rejects(retainCandidateRevision({
    ...initialInput(artifactFixture.store, artifactFixture.stages),
    verifyCarrier: verifier(artifactFixture.stages, withCandidateDigest({
      ...initialWithoutCandidateDigest,
      artifactSetDigest: digest("substituted-artifact-set"),
    })),
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-candidate-revision.artifact-set");
  assert.deepEqual(artifactFixture.stages, ["verify"]);

  const boundaryFixture = fakeStore();
  await assert.rejects(retainCandidateRevision({
    ...initialInput(boundaryFixture.store, boundaryFixture.stages),
    verifyCarrier: verifier(boundaryFixture.stages, withCandidateDigest({
      ...initialWithoutCandidateDigest,
      knowledgeSetDigest: digest("substituted-initial-knowledge"),
    })),
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-candidate-revision.initial-state");
  assert.deepEqual(boundaryFixture.stages, ["verify"]);

  const subjectFixture = fakeStore();
  const successorState = state(false);
  await assert.rejects(retainCandidateRevision({
    ...initialInput(subjectFixture.store, subjectFixture.stages, successorState),
    verifyCarrier: verifier(subjectFixture.stages, {
      ...successorState,
      changedSubjects: [{
        path: "src/invalid.ts",
        change: "modified",
        beforeDigest: null,
        afterDigest: digest("invalid-after"),
      }],
    }),
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-candidate-revision.changed-subject");
  assert.deepEqual(subjectFixture.stages, ["verify"]);
});

test("Candidate compiler retains Carrier-reproduced state as its sole Candidate state", async () => {
  const fixture = fakeStore();
  const carrierState = state(true);
  const retained = await retainCandidateRevision(
    initialInput(fixture.store, fixture.stages, carrierState),
  );
  assert.deepEqual(retained.revision.payload.state, carrierState);
  assert.deepEqual(retained.revision.payload.observer, CARRIER_OBSERVER);
  assert.deepEqual(fixture.stages, ["verify", "append"]);
});

test("Candidate compiler derives builder unchanged standing from its retained predecessor", async () => {
  const fixture = fakeStore();
  const initial = await retainCandidateRevision(initialInput(fixture.store, fixture.stages));
  const predecessor: CandidateRevisionReference = Object.freeze({
    kind: "candidate-revision",
    id: initial.revision.recordId,
    revision: initial.revision.revision,
    digest: initial.revision.digest,
  });
  const changedState = state(false);
  await assert.rejects(retainCandidateRevision({
    ...initialInput(fixture.store, fixture.stages, {
      ...changedState,
      unchangedFromPredecessor: true,
    }),
    activityId: "activity-false-unchanged",
    observation: "builder-successor",
    predecessor,
    builderAttempt,
    observedAt: "2026-08-29T16:00:01.000Z",
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-candidate-revision.predecessor-comparison");
  assert.deepEqual(fixture.stages, ["verify", "append", "verify"]);
});

test("Candidate compiler reopens the Carrier on an exact retention replay", async () => {
  const fixture = fakeStore();
  const selectedState = state(true);
  let verifications = 0;
  const verifyCarrier: CandidateRevisionCarrierVerifier = async (input) => {
    verifications += 1;
    return Object.freeze({
      manifestFileDigest: sha256Bytes(input.manifestBytes),
      state: verifications === 1
        ? selectedState
        : Object.freeze({
            ...selectedState,
            pathInventoryDigest: digest("changed-replay-path-inventory"),
          }),
      observer: CARRIER_OBSERVER,
    });
  };
  const selected = {
    ...initialInput(fixture.store, fixture.stages, selectedState),
    verifyCarrier,
  };
  await retainCandidateRevision(selected);
  await assert.rejects(retainCandidateRevision(selected), (error: unknown) =>
    error instanceof FoundationError &&
    error.code === "lifecycle.control-candidate-revision.state-digest");
  assert.equal(verifications, 2);
  assert.deepEqual(fixture.stages, ["append"]);
});
