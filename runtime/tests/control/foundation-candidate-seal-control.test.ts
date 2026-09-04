import assert from "node:assert/strict";
import test from "node:test";
import {
  retainCandidateSeal,
  type CandidateSealBoundaryReference,
  type CandidateSealCandidateReference,
  type CandidateSealObservation,
} from "../../src/foundation/control/candidate-seal.js";
import {
  compileControlRecordEvent,
  compileControlRecordRevision,
} from "../../src/foundation/control/model.js";
import { assertDeliveryControlRecordPayload } from "../../src/foundation/control/payload-registry.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlRecordRevision,
  type ControlRecordStoreAppend,
  type ControlRecordStoreIdentity,
} from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import type { ReducedDeliveryState } from "../../src/foundation/process/delivery-reducer.js";
import type { DeliveryOperation } from "../../src/foundation/process/delivery-state.js";
import { sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

const CREATED = "2026-08-29T18:00:00.000Z";
const PROCESS = "delivery-candidate-seal-compiler";
const RUNTIME = "foundation-runtime";

function digest(value: string) {
  return sha256Bytes(value);
}

const identity: ControlRecordStoreIdentity = Object.freeze({
  schema: CONTROL_RECORD_STORE_SCHEMA,
  storeId: "store-candidate-seal-compiler",
  targetId: "target-candidate-seal-compiler",
  processKind: "delivery",
  processId: PROCESS,
  createdAt: CREATED,
});

function boundaryRevision(id = "boundary-candidate-seal"): ControlRecordRevision {
  return compileControlRecordRevision(PROCESS, {
    recordId: id,
    recordKind: "work-boundary",
    revision: 1,
    producer: { kind: "runtime", id: RUNTIME },
    semanticAuthor: { kind: "runtime", id: RUNTIME },
    semanticAuthority: "runtime-derived",
    createdAt: CREATED,
    semanticMarkdown: "# Work Boundary\n",
    payload: { schema: "test.work-boundary" },
    relationships: [],
  });
}

function boundaryReference(revision: ControlRecordRevision): CandidateSealBoundaryReference {
  return Object.freeze({
    kind: "work-boundary",
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function candidateRevision(input: Readonly<{
  boundary: CandidateSealBoundaryReference;
}>): ControlRecordRevision {
  return compileControlRecordRevision(PROCESS, {
    recordId: "candidate-candidate-seal",
    recordKind: "candidate-revision",
    revision: 1,
    producer: { kind: "runtime", id: RUNTIME },
    semanticAuthor: { kind: "runtime", id: RUNTIME },
    semanticAuthority: "runtime-observed",
    createdAt: CREATED,
    semanticMarkdown: "# Candidate Revision\n",
    payload: validDeliveryControlPayload("candidate-revision"),
    relationships: [
      {
        relation: "governed-by",
        target: input.boundary,
      },
    ],
  });
}

function candidateReference(revision: ControlRecordRevision): CandidateSealCandidateReference {
  return Object.freeze({
    kind: "candidate-revision",
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function state(input: Readonly<{
  candidate: CandidateSealCandidateReference;
  boundary: CandidateSealBoundaryReference;
  activityOperation?: DeliveryOperation;
}>): ReducedDeliveryState {
  return Object.freeze({
    standing: "active",
    candidateCondition: "in-progress",
    activities: Object.freeze([
      Object.freeze({
        id: "activity-evaluate",
        operation: input.activityOperation ?? "delivery.evaluate",
        family: "agent" as const,
        stage: "started" as const,
        recovery: null,
      }),
    ]),
    subjects: Object.freeze({
      proposedBoundary: null,
      activeBoundary: Object.freeze({
        id: input.boundary.id,
        revision: input.boundary.revision,
        digest: input.boundary.digest,
      }),
      candidate: Object.freeze({
        id: input.candidate.id,
        revision: input.candidate.revision,
        digest: input.candidate.digest,
      }),
      materialCondition: null,
      seal: null,
      evidence: null,
      closure: null,
    }),
    journal: Object.freeze({ eventCount: 0, headDigest: null }),
    eligibleOperations: Object.freeze([]),
  });
}

function fakeStore(input: Readonly<{
  candidateBoundary?: CandidateSealBoundaryReference;
  stateCandidate?: CandidateSealCandidateReference;
  stateBoundary?: CandidateSealBoundaryReference;
  activityOperation?: DeliveryOperation;
}> = {}) {
  const selectedBoundaryRevision = boundaryRevision();
  const selectedBoundary = boundaryReference(selectedBoundaryRevision);
  const candidate = candidateRevision({
    boundary: input.candidateBoundary ?? selectedBoundary,
  });
  const selectedCandidate = candidateReference(candidate);
  const revisions = new Map<string, ControlRecordRevision>([
    [`${selectedBoundary.id}\u0000${selectedBoundary.revision}`, selectedBoundaryRevision],
    [`${selectedCandidate.id}\u0000${selectedCandidate.revision}`, candidate],
  ]);
  const appended: ControlRecordStoreAppend[] = [];
  let sequence = 0;
  let predecessorDigest = null as ReturnType<typeof digest> | null;
  const currentState = state({
    candidate: input.stateCandidate ?? selectedCandidate,
    boundary: input.stateBoundary ?? selectedBoundary,
    activityOperation: input.activityOperation,
  });
  const store = {
    identity,
    state() {
      return currentState;
    },
    getRevision(recordId: string, revision: number) {
      return revisions.get(`${recordId}\u0000${revision}`) ?? null;
    },
    append(value: ControlRecordStoreAppend) {
      appended.push(value);
      const revision = value.revision === undefined
        ? null
        : compileControlRecordRevision(identity.processId, value.revision);
      sequence += 1;
      const event = compileControlRecordEvent({
        storeId: identity.storeId,
        processId: identity.processId,
        sequence,
        predecessorDigest,
        event: value.event,
      });
      predecessorDigest = event.digest;
      if (revision !== null) {
        revisions.set(`${revision.recordId}\u0000${revision.revision}`, revision);
      }
      return Object.freeze({ revision, event });
    },
  } as unknown as ControlRecordStore;
  return Object.freeze({
    store,
    candidate: selectedCandidate,
    boundary: selectedBoundary,
    appended,
  });
}

const observation: CandidateSealObservation = Object.freeze({
  carrierIntegrity: "verified",
  carrierReconstruction: "verified",
  evaluationSubject: "established",
  candidateReobservation: "exact-match",
  untrackedProduct: "absent",
  controlExclusion: "verified",
  sealer: Object.freeze({
    implementationId: "runtime.candidate-sealer",
    implementationDigest: digest("candidate-sealer"),
    ruleSetId: "rules.candidate-seal",
    ruleSetDigest: digest("candidate-seal-rules"),
  }),
  limitations: Object.freeze(["Zulu limitation", "Alpha limitation", "Alpha limitation"]),
});

function retain(storeFixture: ReturnType<typeof fakeStore>) {
  return retainCandidateSeal({
    store: storeFixture.store,
    activityId: "activity-evaluate",
    candidate: storeFixture.candidate,
    boundary: storeFixture.boundary,
    observation,
    sealedAt: CREATED,
    runtimeId: RUNTIME,
  });
}

test("Candidate Seal compiler owns deterministic mechanics and one atomic finalization append", () => {
  const firstFixture = fakeStore();
  const first = retain(firstFixture);
  const second = retain(fakeStore());

  assert.match(first.revision.recordId, /^candidate-seal-[a-f0-9]{64}$/u);
  assert.match(first.event.eventId, /^event-candidate-sealed-[a-f0-9]{64}$/u);
  assert.equal(first.revision.recordId, second.revision.recordId);
  assert.equal(first.revision.digest, second.revision.digest);
  assert.equal(first.event.eventId, second.event.eventId);
  assert.equal(first.event.digest, second.event.digest);
  assert.equal(first.revision.recordKind, "candidate-seal");
  assert.equal(first.revision.revision, 1);
  assert.equal(first.revision.semanticAuthority, "runtime-observed");
  assert.deepEqual(first.revision.payload.limitations, ["Alpha limitation", "Zulu limitation"]);
  assert.deepEqual(
    first.revision.relationships.map(({ relation }) => relation),
    ["governed-by", "seals"],
  );
  assert.match(first.revision.semanticMarkdown, /Candidate Revision: candidate-candidate-seal revision 1/u);
  assert.match(first.revision.semanticMarkdown, /Carrier integrity: verified/u);
  assert.match(first.revision.semanticMarkdown, /Carrier reconstruction: verified/u);
  assert.match(first.revision.semanticMarkdown, /Candidate reobservation: exact-match/u);
  assert.equal(first.event.eventKind, "candidate-sealed");
  assert.deepEqual(first.event.payload, { activityId: "activity-evaluate" });
  assert.equal(firstFixture.appended.length, 1);
  assert.equal(firstFixture.appended[0]!.revision?.recordId, first.revision.recordId);
  assert.equal(firstFixture.appended[0]!.event.eventId, first.event.eventId);
  assertDeliveryControlRecordPayload(first.revision);
});

test("Candidate Seal compiler refuses stale Candidate and Work Boundary selections", () => {
  const staleCandidateFixture = fakeStore({
    stateCandidate: Object.freeze({
      kind: "candidate-revision",
      id: "candidate-candidate-seal",
      revision: 2,
      digest: digest("stale-candidate"),
    }),
  });
  assert.throws(
    () => retain(staleCandidateFixture),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.control-candidate-seal.candidate-current",
  );
  assert.equal(staleCandidateFixture.appended.length, 0);

  const staleBoundaryFixture = fakeStore({
    stateBoundary: Object.freeze({
      kind: "work-boundary",
      id: "boundary-stale",
      revision: 1,
      digest: digest("stale-boundary"),
    }),
  });
  assert.throws(
    () => retain(staleBoundaryFixture),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.control-candidate-seal.boundary-current",
  );
  assert.equal(staleBoundaryFixture.appended.length, 0);
});

test("Candidate Seal compiler refuses mismatched or non-evaluation subjects", () => {
  const otherBoundary = boundaryReference(boundaryRevision("boundary-other"));
  const mismatchedFixture = fakeStore({ candidateBoundary: otherBoundary });
  assert.throws(
    () => retain(mismatchedFixture),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.control-candidate-seal.candidate-boundary",
  );
  assert.equal(mismatchedFixture.appended.length, 0);

  const wrongActivityFixture = fakeStore({ activityOperation: "delivery.continue" });
  assert.throws(
    () => retain(wrongActivityFixture),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.control-candidate-seal.activity",
  );
  assert.equal(wrongActivityFixture.appended.length, 0);
});
