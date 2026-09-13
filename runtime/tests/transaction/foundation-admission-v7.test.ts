import { receiveFoundationAuthorityCredential } from "../../src/foundation/repository/authority.js";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  CandidateRevisionState,
} from "../../src/foundation/control/candidate-revision.js";
import { retainCandidateRevision } from "../../src/foundation/control/candidate-revision.js";
import { compileControlRecordRevision } from "../../src/foundation/control/model.js";
import {
  openControlRecordStore,
  type ControlRecordStore,
} from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlJsonObject,
  type ControlJsonValue,
  type ControlRecordRelationship,
  type ControlRecordRevision,
  type ControlRecordRevisionInput,
  type ControlRecordStoreIdentity,
} from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import { createFoundationAuthority } from "../../src/foundation/repository/authority.js";
import type { FoundationRepositoryContract } from "../../src/foundation/repository/types.js";
import {
  admitDeliveryV7,
  recoverAdmissionV7,
  type FoundationAdmissionRepositoryObservationV7,
  type FoundationAdmissionV7Options,
} from "../../src/foundation/transaction/admission-v7.js";
import { digestCanonical, sha256Bytes, type Sha256 } from "../../src/foundation/validation/canonical.js";
import {
  publishTestCandidateCarrier,
  testCandidateCarrierManifestBytes,
  testCandidateCarrierVerifier,
} from "../support/candidate-revision-carrier-fixture.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

const RUNTIME = "foundation-runtime";
const SECRET = "admission-v7-authority-secret-with-sufficient-entropy";
const BASE_COMMIT = "a".repeat(40);
const BASE_TREE = "b".repeat(40);

function digest(value: string): Sha256 {
  return sha256Bytes(value);
}

function identity(suffix: string): ControlRecordStoreIdentity {
  return Object.freeze({
    schema: CONTROL_RECORD_STORE_SCHEMA,
    storeId: `store-admission-v7-${suffix}`,
    targetId: `target-admission-v7-${suffix}`,
    processKind: "delivery",
    processId: `delivery-admission-v7-${suffix}`,
    createdAt: "2026-08-29T17:00:00.000Z",
  });
}

function relationship(
  relation: string,
  kind: string,
  revision: ControlRecordRevision,
): ControlRecordRelationship {
  return Object.freeze({
    relation,
    target: Object.freeze({
      kind,
      id: revision.recordId,
      revision: revision.revision,
      digest: revision.digest,
    }),
  });
}

function revisionInput(input: Readonly<{
  store: ControlRecordStore;
  recordId: string;
  recordKind: string;
  revision?: number;
  createdAt: string;
  semanticAuthor: "director" | "agent" | "runtime";
  semanticAuthority: "director-supplied" | "agent-proposed" | "runtime-derived" | "runtime-observed";
  payload: ControlJsonObject;
  relationships?: readonly ControlRecordRelationship[];
}>): ControlRecordRevisionInput {
  return Object.freeze({
    recordId: input.recordId,
    recordKind: input.recordKind,
    revision: input.revision ?? 1,
    producer: Object.freeze({ kind: "runtime", id: RUNTIME }),
    semanticAuthor: Object.freeze({ kind: input.semanticAuthor, id: `${input.semanticAuthor}-test` }),
    semanticAuthority: input.semanticAuthority,
    createdAt: input.createdAt,
    semanticMarkdown: `# ${input.recordKind}\n\nAdmission v7 operated-path fixture.\n`,
    payload: input.payload,
    relationships: Object.freeze([...(input.relationships ?? [])]),
  });
}

function appendRevision(input: Readonly<{
  store: ControlRecordStore;
  revision: ControlRecordRevisionInput;
  eventKind: string;
  eventId: string;
  activityId: string;
  eventPayload?: ControlJsonObject;
}>): ControlRecordRevision {
  const compiled = compileControlRecordRevision(input.store.identity.processId, input.revision);
  const retained = input.store.append({
    revision: input.revision,
    event: Object.freeze({
      eventId: input.eventId,
      eventKind: input.eventKind,
      occurredAt: input.revision.createdAt,
      actor: Object.freeze({ kind: "runtime" as const, id: RUNTIME }),
      subject: Object.freeze({
        recordId: compiled.recordId,
        revision: compiled.revision,
        digest: compiled.digest,
      }),
      payload: Object.freeze({ activityId: input.activityId, ...(input.eventPayload ?? {}) }),
    }),
  });
  assert(retained.revision !== null);
  return retained.revision;
}

function repositoryBasis(contractDigest: Sha256) {
  return Object.freeze({
    repositorySnapshotDigest: digest("repository-snapshot"),
    canonicalCommit: BASE_COMMIT,
    canonicalTree: BASE_TREE,
    productStateDigest: digest("product-state"),
    atlasStateDigest: digest("atlas-state"),
    atlasResolutionDigest: digest("atlas-resolution"),
    atlasNormalizedModelDigest: digest("atlas-normalized-model"),
    atlasResourceBindingsDigest: digest("atlas-resource-bindings"),
    repositoryContractDigest: contractDigest,
    knowledgeSetDigest: digest("knowledge-set"),
    checkBindingSetDigest: digest("check-binding-set"),
  });
}

function boundaryPayload(targetId: string, contractDigest: Sha256): ControlJsonObject {
  const payload = validDeliveryControlPayload("work-boundary");
  const basis = payload.basis as ControlJsonObject;
  return Object.freeze({
    ...payload,
    targetId,
    basis: Object.freeze({
      ...basis,
      productBaseCommit: BASE_COMMIT,
      productBaseTree: BASE_TREE,
      productStateDigest: digest("product-state"),
      atlasStateDigest: digest("atlas-state"),
      atlasResolutionDigest: digest("atlas-resolution"),
      atlasNormalizedModelDigest: digest("atlas-normalized-model"),
      atlasResourceBindingsDigest: digest("atlas-resource-bindings"),
      repositoryContractDigest: contractDigest,
      knowledgeSetDigest: digest("knowledge-set"),
      repositorySnapshotDigest: digest("repository-snapshot"),
    }),
  });
}

function compileTestCandidateState(input: Readonly<{
  tree: string;
  productStateDigest: Sha256;
  knowledgeSetDigest: Sha256;
  diffDigest: Sha256;
  pathInventoryDigest: Sha256;
  descriptionCoverageDigest: Sha256;
  unchangedFromPredecessor: boolean;
  changedSubjects: CandidateRevisionState["changedSubjects"];
}>): CandidateRevisionState {
  const artifactSetDigest = input.productStateDigest;
  const candidateDigest = digestCanonical({
    schema: "lifecycle.delivery-candidate-state.v1",
    candidateBaseCommit: BASE_COMMIT,
    tree: input.tree,
    productStateDigest: input.productStateDigest,
    knowledgeSetDigest: input.knowledgeSetDigest,
    diffDigest: input.diffDigest,
    pathInventoryDigest: input.pathInventoryDigest,
    artifactSetDigest,
    descriptionCoverageDigest: input.descriptionCoverageDigest,
    changedSubjects: input.changedSubjects,
  });
  return Object.freeze({
    ...input,
    candidateDigest,
    artifactSetDigest,
  });
}

function availableState(suffix: string): CandidateRevisionState {
  return compileTestCandidateState({
    tree: digest(`candidate-tree-${suffix}`).slice("sha256:".length, "sha256:".length + 40),
    productStateDigest: digest(`candidate-product-${suffix}`),
    knowledgeSetDigest: digest(`candidate-knowledge-${suffix}`),
    diffDigest: digest(`candidate-diff-${suffix}`),
    pathInventoryDigest: digest(`candidate-paths-${suffix}`),
    descriptionCoverageDigest: digest(`candidate-description-${suffix}`),
    unchangedFromPredecessor: false,
    changedSubjects: Object.freeze([]),
  });
}

function timeOwner(start = "2026-08-29T19:00:00.000Z"): () => string {
  let time = Date.parse(start);
  return () => new Date(time += 1_000).toISOString();
}

type Fixture = Readonly<{
  workspace: string;
  storeRoot: string;
  authorityHome: string;
  identity: ControlRecordStoreIdentity;
  store: ControlRecordStore;
  contract: FoundationRepositoryContract;
  repository: FoundationAdmissionRepositoryObservationV7;
  candidateState: CandidateRevisionState;
  boundary: ControlRecordRevision;
  baselineReceipt: ControlRecordRevision;
}>;

async function createFixture(suffix: string): Promise<Fixture> {
  const workspace = await mkdtemp(join(tmpdir(), `lifecycle-admission-v7-${suffix}-`));
  const storeRoot = join(workspace, "store");
  const authorityHome = join(workspace, "authority");
  const selectedIdentity = identity(suffix);
  const authority = await createFoundationAuthority(
    authorityHome,
    selectedIdentity.targetId,
    receiveFoundationAuthorityCredential(SECRET, "initialize"),
    "director:admission-v7",
  );
  const contractDigest = digest(`contract-${suffix}`);
  const contract = Object.freeze({
    targetId: selectedIdentity.targetId,
    digest: contractDigest,
    authority,
  }) as unknown as FoundationRepositoryContract;
  const store = await openControlRecordStore({
    root: storeRoot,
    identity: selectedIdentity,
    create: true,
  });
  store.append({
    event: Object.freeze({
      eventId: `event-delivery-created-${suffix}`,
      eventKind: "delivery-created",
      occurredAt: "2026-08-29T18:00:00.000Z",
      actor: Object.freeze({ kind: "runtime" as const, id: RUNTIME }),
      payload: Object.freeze({}),
    }),
  });
  const activityId = `prepare-admission-v7-${suffix}`;
  const brief = appendRevision({
    store,
    revision: revisionInput({
      store,
      recordId: `brief-admission-v7-${suffix}`,
      recordKind: "director-brief",
      createdAt: "2026-08-29T18:00:01.000Z",
      semanticAuthor: "director",
      semanticAuthority: "director-supplied",
      payload: { ...validDeliveryControlPayload("director-brief"), scope: { kind: "activity", activityId: activityId } },
    }),
    eventKind: "director-brief-submitted",
    eventId: `event-brief-admission-v7-${suffix}`,
    activityId,
  });
  store.append({
    event: Object.freeze({
      eventId: `event-prepare-started-admission-v7-${suffix}`,
      eventKind: "activity-started",
      occurredAt: "2026-08-29T18:00:02.000Z",
      actor: Object.freeze({ kind: "runtime" as const, id: RUNTIME }),
      payload: Object.freeze({ activityId, operation: "delivery.prepare" }),
    }),
  });
  const attemptPayload = validDeliveryControlPayload("agent-attempt");
  const attempt = appendRevision({
    store,
    revision: revisionInput({
      store,
      recordId: `attempt-admission-v7-${suffix}`,
      recordKind: "agent-attempt",
      createdAt: "2026-08-29T18:00:03.000Z",
      semanticAuthor: "runtime",
      semanticAuthority: "runtime-derived",
      payload: Object.freeze({ ...attemptPayload, activityId }),
      relationships: Object.freeze([relationship("uses-brief", "director-brief", brief)]),
    }),
    eventKind: "agent-attempt-prepared",
    eventId: `event-attempt-admission-v7-${suffix}`,
    activityId,
  });
  const providerEffect = digest(`provider-effect-${suffix}`);
  store.append({ event: {
    eventId: `event-provider-intended-admission-v7-${suffix}`,
    eventKind: "provider-effect-intended",
    occurredAt: "2026-08-29T18:00:04.000Z",
    actor: { kind: "runtime", id: RUNTIME },
    subject: { recordId: attempt.recordId, revision: attempt.revision, digest: attempt.digest },
    payload: { activityId, effectDigest: providerEffect },
  } });
  store.append({ event: {
    eventId: `event-provider-observed-admission-v7-${suffix}`,
    eventKind: "provider-effect-observed",
    occurredAt: "2026-08-29T18:00:05.000Z",
    actor: { kind: "runtime", id: RUNTIME },
    subject: { recordId: attempt.recordId, revision: attempt.revision, digest: attempt.digest },
    payload: { activityId, effectDigest: providerEffect, outcome: "completed" },
  } });
  const workProduct = appendRevision({
    store,
    revision: revisionInput({
      store,
      recordId: `work-product-admission-v7-${suffix}`,
      recordKind: "agent-work-product",
      createdAt: "2026-08-29T18:00:06.000Z",
      semanticAuthor: "agent",
      semanticAuthority: "agent-proposed",
      payload: validDeliveryControlPayload("agent-work-product"),
      relationships: Object.freeze([relationship("result-of", "agent-attempt", attempt)]),
    }),
    eventKind: "agent-work-product-submitted",
    eventId: `event-work-product-admission-v7-${suffix}`,
    activityId,
  });
  const receiptPayload = validDeliveryControlPayload("execution-receipt");
  appendRevision({
    store,
    revision: revisionInput({
      store,
      recordId: `receipt-admission-v7-${suffix}`,
      recordKind: "execution-receipt",
      createdAt: "2026-08-29T18:00:07.000Z",
      semanticAuthor: "runtime",
      semanticAuthority: "runtime-observed",
      payload: Object.freeze({ ...receiptPayload, activityId }),
      relationships: Object.freeze([
        relationship("observes-attempt", "agent-attempt", attempt),
        relationship("observes-work-product", "agent-work-product", workProduct),
      ]),
    }),
    eventKind: "execution-receipt-recorded",
    eventId: `event-receipt-admission-v7-${suffix}`,
    activityId,
  });
  const boundary = appendRevision({
    store,
    revision: revisionInput({
      store,
      recordId: `boundary-admission-v7-${suffix}`,
      recordKind: "work-boundary",
      createdAt: "2026-08-29T18:00:08.000Z",
      semanticAuthor: "runtime",
      semanticAuthority: "runtime-derived",
      payload: boundaryPayload(selectedIdentity.targetId, contractDigest),
      relationships: Object.freeze([
        relationship("uses-brief", "director-brief", brief),
        relationship("proposed-from", "agent-work-product", workProduct),
      ]),
    }),
    eventKind: "work-boundary-finalized",
    eventId: `event-boundary-admission-v7-${suffix}`,
    activityId,
  });
  const checkPayload = validDeliveryControlPayload("check-receipt");
  const baselineReceipt = appendRevision({
    store,
    revision: revisionInput({
      store,
      recordId: `baseline-admission-v7-${suffix}`,
      recordKind: "check-receipt",
      createdAt: "2026-08-29T18:00:09.000Z",
      semanticAuthor: "runtime",
      semanticAuthority: "runtime-observed",
      payload: Object.freeze({ ...checkPayload, rawMaterials: Object.freeze([]) }),
      relationships: Object.freeze([relationship("checks-boundary", "work-boundary", boundary)]),
    }),
    eventKind: "check-receipt-recorded",
    eventId: `event-baseline-admission-v7-${suffix}`,
    activityId,
  });
  store.append({ event: {
    eventId: `event-prepare-completed-admission-v7-${suffix}`,
    eventKind: "activity-completed",
    occurredAt: "2026-08-29T18:00:10.000Z",
    actor: { kind: "runtime", id: RUNTIME },
    payload: { activityId, outcome: "completed" },
  } });
  const basis = repositoryBasis(contractDigest);
  const repository = Object.freeze({
    repository: `/synthetic/repository/${suffix}`,
    contract,
    basis,
  });
  return Object.freeze({
    workspace,
    storeRoot,
    authorityHome,
    identity: selectedIdentity,
    store,
    contract,
    repository,
    candidateState: compileTestCandidateState({
      tree: BASE_TREE,
      productStateDigest: digest("product-state"),
      knowledgeSetDigest: digest("knowledge-set"),
      diffDigest: sha256Bytes(new Uint8Array()),
      pathInventoryDigest: digest(`candidate-paths-${suffix}`),
      descriptionCoverageDigest: digest(`candidate-description-${suffix}`),
      unchangedFromPredecessor: true,
      changedSubjects: Object.freeze([]),
    }),
    boundary,
    baselineReceipt,
  });
}

function options(
  fixture: Fixture,
  overrides: Partial<FoundationAdmissionV7Options> = {},
): FoundationAdmissionV7Options {
  return Object.freeze({
    now: timeOwner(),
    withDeliveryLock: async (_selection, operation, action) => {
      assert.equal(operation, "delivery-admit");
      return action();
    },
    observeRepository: async (_target, _observedAt, historicalCommit) => {
      assert.equal(historicalCommit, fixture.repository.basis.canonicalCommit);
      return fixture.repository;
    },
    publishCandidateCarrier: async (input) => await publishTestCandidateCarrier({
      ...input,
      pathInventoryDigest: fixture.candidateState.pathInventoryDigest,
    }),
    carrierVerifier: async () =>
      testCandidateCarrierVerifier(fixture.candidateState),
    ...overrides,
  });
}

function unavailableCarrierVerifier(): NonNullable<FoundationAdmissionV7Options["carrierVerifier"]> {
  return async () => async () => {
    throw new FoundationError(
      "lifecycle.candidate.carrier-state-unavailable",
      "Candidate Carrier is temporarily unavailable",
    );
  };
}

async function initialInput(fixture: Fixture) {
  return Object.freeze({
    target: fixture.repository.repository,
    machineHome: join(fixture.workspace, "machine"),
    store: fixture.store,
    authorityHome: fixture.authorityHome,
    authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
    runtimeId: RUNTIME,
  });
}

function appendEvent(input: Readonly<{
  store: ControlRecordStore;
  eventId: string;
  eventKind: string;
  occurredAt: string;
  activityId: string;
  payload?: ControlJsonObject;
  subject?: ControlRecordRevision | null;
}>): void {
  input.store.append({ event: Object.freeze({
    eventId: input.eventId,
    eventKind: input.eventKind,
    occurredAt: input.occurredAt,
    actor: Object.freeze({ kind: "runtime" as const, id: RUNTIME }),
    subject: input.subject === undefined || input.subject === null
      ? null
      : Object.freeze({
          recordId: input.subject.recordId,
          revision: input.subject.revision,
          digest: input.subject.digest,
        }),
    payload: Object.freeze({ activityId: input.activityId, ...(input.payload ?? {}) }),
  }) });
}

function appendAgentOpening(input: Readonly<{
  fixture: Fixture;
  activityId: string;
  operation: "delivery.continue" | "delivery.revise";
  suffix: string;
  startedAt: string;
  attemptAt: string;
  briefAt: string;
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
}>): Readonly<{ brief: ControlRecordRevision; attempt: ControlRecordRevision }> {
  const brief = appendRevision({
    store: input.fixture.store,
    revision: revisionInput({
      store: input.fixture.store,
      recordId: `brief-${input.suffix}`,
      recordKind: "director-brief",
      createdAt: input.briefAt,
      semanticAuthor: "director",
      semanticAuthority: "director-supplied",
      payload: { ...validDeliveryControlPayload("director-brief"), scope: { kind: "activity", activityId: input.activityId } },
    }),
    eventKind: "director-brief-submitted",
    eventId: `event-brief-${input.suffix}`,
    activityId: input.activityId,
  });
  appendEvent({
    store: input.fixture.store,
    eventId: `event-started-${input.suffix}`,
    eventKind: "activity-started",
    occurredAt: input.startedAt,
    activityId: input.activityId,
    payload: Object.freeze({ operation: input.operation }),
  });
  const attemptPayload = validDeliveryControlPayload("agent-attempt");
  const attempt = appendRevision({
    store: input.fixture.store,
    revision: revisionInput({
      store: input.fixture.store,
      recordId: `attempt-${input.suffix}`,
      recordKind: "agent-attempt",
      createdAt: input.attemptAt,
      semanticAuthor: "runtime",
      semanticAuthority: "runtime-derived",
      payload: Object.freeze({
        ...attemptPayload,
        activityId: input.activityId,
        operation: input.operation,
        role: input.operation === "delivery.continue" ? "builder" : "reconnaissance",
        input: Object.freeze({
          ...(attemptPayload.input as ControlJsonObject),
          evidenceSetDigest: input.operation === "delivery.continue"
            ? digest(`evidence-set-${input.suffix}`)
            : null,
        }),
      }),
      relationships: Object.freeze([
        relationship("uses-brief", "director-brief", brief),
        relationship("uses-boundary", "work-boundary", input.boundary),
        relationship("uses-candidate", "candidate-revision", input.candidate),
      ]),
    }),
    eventKind: "agent-attempt-prepared",
    eventId: `event-attempt-${input.suffix}`,
    activityId: input.activityId,
  });
  return Object.freeze({ brief, attempt });
}

function appendProviderAndWorkProduct(input: Readonly<{
  fixture: Fixture;
  activityId: string;
  suffix: string;
  attempt: ControlRecordRevision;
  intendedAt: string;
  observedAt: string;
  productAt: string;
}>): ControlRecordRevision {
  const effectDigest = digest(`provider-${input.suffix}`);
  appendEvent({
    store: input.fixture.store,
    eventId: `event-provider-intended-${input.suffix}`,
    eventKind: "provider-effect-intended",
    occurredAt: input.intendedAt,
    activityId: input.activityId,
    subject: input.attempt,
    payload: Object.freeze({ effectDigest }),
  });
  appendEvent({
    store: input.fixture.store,
    eventId: `event-provider-observed-${input.suffix}`,
    eventKind: "provider-effect-observed",
    occurredAt: input.observedAt,
    activityId: input.activityId,
    subject: input.attempt,
    payload: Object.freeze({ effectDigest, outcome: "completed" }),
  });
  return appendRevision({
    store: input.fixture.store,
    revision: revisionInput({
      store: input.fixture.store,
      recordId: `work-product-${input.suffix}`,
      recordKind: "agent-work-product",
      createdAt: input.productAt,
      semanticAuthor: "agent",
      semanticAuthority: "agent-proposed",
      payload: validDeliveryControlPayload("agent-work-product"),
      relationships: Object.freeze([relationship("result-of", "agent-attempt", input.attempt)]),
    }),
    eventKind: "agent-work-product-submitted",
    eventId: `event-work-product-${input.suffix}`,
    activityId: input.activityId,
  });
}

function appendExecutionReceipt(input: Readonly<{
  fixture: Fixture;
  activityId: string;
  suffix: string;
  occurredAt: string;
  attempt: ControlRecordRevision;
  workProduct: ControlRecordRevision;
  candidate?: ControlRecordRevision;
}>): ControlRecordRevision {
  const payload = validDeliveryControlPayload("execution-receipt");
  return appendRevision({
    store: input.fixture.store,
    revision: revisionInput({
      store: input.fixture.store,
      recordId: `receipt-${input.suffix}`,
      recordKind: "execution-receipt",
      createdAt: input.occurredAt,
      semanticAuthor: "runtime",
      semanticAuthority: "runtime-observed",
      payload: Object.freeze({ ...payload, activityId: input.activityId }),
      relationships: Object.freeze([
        relationship("observes-attempt", "agent-attempt", input.attempt),
        relationship("observes-work-product", "agent-work-product", input.workProduct),
        ...(input.candidate === undefined
          ? []
          : [relationship("observes-candidate", "candidate-revision", input.candidate)]),
      ]),
    }),
    eventKind: "execution-receipt-recorded",
    eventId: `event-receipt-${input.suffix}`,
    activityId: input.activityId,
  });
}

async function seedReadmissionProposal(
  fixture: Fixture,
  candidate: ControlRecordRevision,
): Promise<Readonly<{
  candidate: ControlRecordRevision;
  condition: ControlRecordRevision;
  successor: ControlRecordRevision;
  baselineReceipt: ControlRecordRevision;
  candidateState: CandidateRevisionState;
}>> {
  const continueId = "continue-readmission";
  const continuation = appendAgentOpening({
    fixture,
    activityId: continueId,
    operation: "delivery.continue",
    suffix: "continue-readmission",
    briefAt: "2026-08-29T20:00:01.000Z",
    startedAt: "2026-08-29T20:00:02.000Z",
    attemptAt: "2026-08-29T20:00:03.000Z",
    boundary: fixture.boundary,
    candidate,
  });
  const continuationProduct = appendProviderAndWorkProduct({
    fixture,
    activityId: continueId,
    suffix: "continue-readmission",
    attempt: continuation.attempt,
    intendedAt: "2026-08-29T20:00:04.000Z",
    observedAt: "2026-08-29T20:00:05.000Z",
    productAt: "2026-08-29T20:00:06.000Z",
  });
  const nextState = availableState("readmission-continuing");
  const nextCandidate = (await retainCandidateRevision({
    store: fixture.store,
    activityId: continueId,
    observation: "builder-successor",
    candidateBaseCommit: BASE_COMMIT,
    carrierManifestBytes: testCandidateCarrierManifestBytes(
      nextState.tree,
      nextState.pathInventoryDigest,
    ),
    verifyCarrier: testCandidateCarrierVerifier(nextState),
    boundary: Object.freeze({
      kind: "work-boundary",
      id: fixture.boundary.recordId,
      revision: fixture.boundary.revision,
      digest: fixture.boundary.digest,
    }),
    predecessor: Object.freeze({
      kind: "candidate-revision",
      id: candidate.recordId,
      revision: candidate.revision,
      digest: candidate.digest,
    }),
    builderAttempt: Object.freeze({
      kind: "agent-attempt",
      id: continuation.attempt.recordId,
      revision: continuation.attempt.revision,
      digest: continuation.attempt.digest,
    }),
    observedAt: "2026-08-29T20:00:07.000Z",
    runtimeId: RUNTIME,
  })).revision;
  const continuationReceipt = appendExecutionReceipt({
    fixture,
    activityId: continueId,
    suffix: "continue-readmission",
    occurredAt: "2026-08-29T20:00:08.000Z",
    attempt: continuation.attempt,
    workProduct: continuationProduct,
    candidate: nextCandidate,
  });
  const conditionPayload = validDeliveryControlPayload("material-condition");
  const condition = appendRevision({
    store: fixture.store,
    revision: revisionInput({
      store: fixture.store,
      recordId: "condition-readmission",
      recordKind: "material-condition",
      createdAt: "2026-08-29T20:00:09.000Z",
      semanticAuthor: "runtime",
      semanticAuthority: "runtime-derived",
      payload: conditionPayload,
      relationships: Object.freeze([
        relationship("reported-by", "agent-work-product", continuationProduct),
        relationship("observed-in", "execution-receipt", continuationReceipt),
        relationship("freezes", "candidate-revision", nextCandidate),
        relationship("governed-by", "work-boundary", fixture.boundary),
      ]),
    }),
    eventKind: "material-condition-frozen",
    eventId: "event-condition-readmission",
    activityId: continueId,
    eventPayload: Object.freeze({
      sourceKind: "agent-proposal",
      observedFactsDigest: conditionPayload.observedFactsDigest!,
    }),
  });
  appendEvent({
    store: fixture.store,
    eventId: "event-complete-continue-readmission",
    eventKind: "activity-completed",
    occurredAt: "2026-08-29T20:00:10.000Z",
    activityId: continueId,
    payload: Object.freeze({ outcome: "completed" }),
  });

  const reviseId = "revise-readmission";
  const revision = appendAgentOpening({
    fixture,
    activityId: reviseId,
    operation: "delivery.revise",
    suffix: "revise-readmission",
    briefAt: "2026-08-29T20:01:01.000Z",
    startedAt: "2026-08-29T20:01:02.000Z",
    attemptAt: "2026-08-29T20:01:03.000Z",
    boundary: fixture.boundary,
    candidate: nextCandidate,
  });
  const revisionProduct = appendProviderAndWorkProduct({
    fixture,
    activityId: reviseId,
    suffix: "revise-readmission",
    attempt: revision.attempt,
    intendedAt: "2026-08-29T20:01:04.000Z",
    observedAt: "2026-08-29T20:01:05.000Z",
    productAt: "2026-08-29T20:01:06.000Z",
  });
  appendExecutionReceipt({
    fixture,
    activityId: reviseId,
    suffix: "revise-readmission",
    occurredAt: "2026-08-29T20:01:07.000Z",
    attempt: revision.attempt,
    workProduct: revisionProduct,
  });
  const payload = boundaryPayload(fixture.identity.targetId, fixture.contract.digest);
  const successor = appendRevision({
    store: fixture.store,
    revision: revisionInput({
      store: fixture.store,
      recordId: fixture.boundary.recordId,
      recordKind: "work-boundary",
      revision: fixture.boundary.revision + 1,
      createdAt: "2026-08-29T20:01:08.000Z",
      semanticAuthor: "runtime",
      semanticAuthority: "runtime-derived",
      payload: Object.freeze({
        ...payload,
        proposalKind: "revision",
        resolution: Object.freeze({
          kind: "revise",
          rationaleDigest: digest("readmission-rationale"),
          changedMandateFields: Object.freeze(["/mandate/direction"]),
        }),
      }),
      relationships: Object.freeze([
        relationship("uses-brief", "director-brief", revision.brief),
        relationship("proposed-from", "agent-work-product", revisionProduct),
        relationship("revises", "work-boundary", fixture.boundary),
        relationship("resolves", "material-condition", condition),
      ]),
    }),
    eventKind: "work-boundary-finalized",
    eventId: "event-boundary-readmission",
    activityId: reviseId,
  });
  const checkPayload = validDeliveryControlPayload("check-receipt");
  const baselineReceipt = appendRevision({
    store: fixture.store,
    revision: revisionInput({
      store: fixture.store,
      recordId: "baseline-readmission",
      recordKind: "check-receipt",
      createdAt: "2026-08-29T20:01:09.000Z",
      semanticAuthor: "runtime",
      semanticAuthority: "runtime-observed",
      payload: Object.freeze({ ...checkPayload, rawMaterials: Object.freeze([]) }),
      relationships: Object.freeze([relationship("checks-boundary", "work-boundary", successor)]),
    }),
    eventKind: "check-receipt-recorded",
    eventId: "event-baseline-readmission",
    activityId: reviseId,
  });
  appendEvent({
    store: fixture.store,
    eventId: "event-complete-revise-readmission",
    eventKind: "activity-completed",
    occurredAt: "2026-08-29T20:01:10.000Z",
    activityId: reviseId,
    payload: Object.freeze({ outcome: "completed" }),
  });
  return Object.freeze({
    candidate: nextCandidate,
    condition,
    successor,
    baselineReceipt,
    candidateState: nextState,
  });
}

test("initial admission publishes the frozen Boundary base as its first Carrier", async () => {
  const fixture = await createFixture("historical-candidate-base");
  try {
    const currentAtlasBasis = Object.freeze({
      ...fixture.repository.basis,
      repositorySnapshotDigest: digest("current-atlas-snapshot"),
      canonicalCommit: "c".repeat(40),
      canonicalTree: "d".repeat(40),
      productStateDigest: digest("current-atlas-product-state"),
      atlasStateDigest: digest("current-atlas-state"),
      atlasResolutionDigest: digest("current-atlas-resolution"),
      atlasNormalizedModelDigest: digest("current-atlas-model"),
      atlasResourceBindingsDigest: digest("current-atlas-resources"),
    });
    const observedCommits: string[] = [];
    let publishedSource: Readonly<{ repository: string; rootTree: string }> | null = null;
    const admitted = await admitDeliveryV7(await initialInput(fixture), options(fixture, {
      observeRepository: async (_target, _observedAt, historicalCommit) => {
        observedCommits.push(historicalCommit);
        return historicalCommit === BASE_COMMIT
          ? fixture.repository
          : Object.freeze({ ...fixture.repository, basis: currentAtlasBasis });
      },
      publishCandidateCarrier: async (input) => {
        publishedSource = Object.freeze({
          repository: input.repository,
          rootTree: input.rootTree,
        });
        return await publishTestCandidateCarrier({
          ...input,
          pathInventoryDigest: fixture.candidateState.pathInventoryDigest,
        });
      },
    }));
    assert.equal(admitted.status, "completed");
    assert.deepEqual(publishedSource, {
      repository: fixture.repository.repository,
      rootTree: BASE_TREE,
    });
    assert.equal(observedCommits.length > 0, true);
    assert.deepEqual([...new Set(observedCommits)], [BASE_COMMIT]);
    assert(admitted.candidate !== null);
    const candidate = fixture.store.getRevision(admitted.candidate.id, admitted.candidate.revision);
    assert(candidate !== null);
    assert.equal(candidate.payload.candidateBaseCommit, BASE_COMMIT);
    const decisionEvent = fixture.store.listEvents(0, 10_000).find((event) =>
      event.eventKind === "director-decision-authenticated" &&
      event.payload.activityId === admitted.activityId);
    assert(decisionEvent?.subject !== null && decisionEvent?.subject !== undefined);
    const decision = fixture.store.getRevision(
      decisionEvent.subject.recordId,
      decisionEvent.subject.revision,
    );
    assert(decision !== null);
    const subject = decision.payload.subject as ControlJsonObject;
    assert.equal(
      (subject.repository as ControlJsonObject).canonicalCommit,
      BASE_COMMIT,
    );
  } finally {
    fixture.store.close();
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test("admission recovers every durable Activity boundary after Store close and reopen", async () => {
  for (const stage of [
    "opening-committed",
    "transaction-effect-intended",
    "transaction-effect-observed",
    "candidate-revision-observed",
    "activity-completed",
  ] as const) {
    const fixture = await createFixture(`fault-${stage}`);
    try {
      const retainedFileCountBeforeAdmission = fixture.store.listRetainedFiles().length;
      let candidatePublicationCount = 0;
      let candidateCarrierVerificationCount = 0;
      const candidateOwners: FoundationAdmissionV7Options = Object.freeze({
        publishCandidateCarrier: async (input) => {
          candidatePublicationCount += 1;
          return await publishTestCandidateCarrier({
            ...input,
            pathInventoryDigest: fixture.candidateState.pathInventoryDigest,
          });
        },
        carrierVerifier: async () => {
          candidateCarrierVerificationCount += 1;
          return testCandidateCarrierVerifier(fixture.candidateState);
        },
      });
      await assert.rejects(admitDeliveryV7(await initialInput(fixture), options(fixture, {
        ...candidateOwners,
        onStage: (selected) => {
          if (selected === stage) throw new Error(`${stage} fault`);
        },
      })), new RegExp(`${stage} fault`, "u"));
      const activity = fixture.store.state().activities.find(({ operation }) =>
        operation === "delivery.admit");
      assert(activity !== undefined);
      if (stage === "transaction-effect-observed" || stage === "activity-completed") {
        assert.equal(fixture.store.state().subjects.activeBoundary?.digest, fixture.boundary.digest);
        assert.equal(fixture.store.state().subjects.proposedBoundary, null);
      }
      const candidateAlreadyRetained =
        stage === "candidate-revision-observed" || stage === "activity-completed";
      assert.equal(candidatePublicationCount, candidateAlreadyRetained ? 1 : 0);
      assert.equal(candidateCarrierVerificationCount, candidateAlreadyRetained ? 1 : 0);

      let retainedCandidateReferenceAtFault:
        Readonly<{ id: string; revision: number; digest: Sha256 }> | null = null;
      if (stage === "candidate-revision-observed") {
        const support = fixture.store.getOperationSupport(activity.id);
        assert(support !== null);
        const checkpoint = (
          (support.payload.checkpoint as ControlJsonObject).value as ControlJsonObject
        );
        assert.deepEqual(checkpoint, {
          schema: "lifecycle.runtime-admission-checkpoint.v3",
          candidateFailures: [],
          disposition: null,
        });
        const candidateEvents = fixture.store.listEvents(0, 10_000).filter((event) =>
          event.eventKind === "candidate-revision-observed" &&
          event.payload.activityId === activity.id);
        assert.equal(candidateEvents.length, 1);
        const candidateEvent = candidateEvents[0]!;
        assert(candidateEvent.subject !== null);
        const candidate = fixture.store.getRevision(
          candidateEvent.subject.recordId,
          candidateEvent.subject.revision,
        );
        assert(candidate !== null);
        assert.equal(candidate.digest, candidateEvent.subject.digest);
        retainedCandidateReferenceAtFault = Object.freeze({
          id: candidate.recordId,
          revision: candidate.revision,
          digest: candidate.digest,
        });
        assert.deepEqual(fixture.store.state().subjects.candidate, retainedCandidateReferenceAtFault);
        const manifest = candidate.payload.carrierManifest as ControlJsonObject;
        const retainedManifest = await fixture.store.readRetainedFile(manifest.digest as Sha256);
        assert(retainedManifest !== null);
        assert.deepEqual({
          digest: retainedManifest.descriptor.digest,
          byteLength: retainedManifest.descriptor.byteLength,
          mediaType: retainedManifest.descriptor.mediaType,
          purpose: retainedManifest.descriptor.purpose,
        }, manifest);
        assert.deepEqual(
          [...retainedManifest.bytes],
          [...testCandidateCarrierManifestBytes(
            fixture.candidateState.tree,
            fixture.candidateState.pathInventoryDigest,
          )],
        );
        assert.equal(
          fixture.store.listRetainedFiles().length,
          retainedFileCountBeforeAdmission + 1,
        );
      }
      fixture.store.close();
      const reopened = await openControlRecordStore({
        root: fixture.storeRoot,
        identity: fixture.identity,
        create: false,
      });
      const recovered = await recoverAdmissionV7({
        target: fixture.repository.repository,
        machineHome: join(fixture.workspace, "machine"),
        store: reopened,
        runtimeId: RUNTIME,
        activityId: activity.id,
      }, options(fixture, {
        ...candidateOwners,
        now: timeOwner("2026-08-29T20:00:00.000Z"),
      }));
      assert.equal(recovered.status, "completed");
      assert.equal(reopened.getOperationSupport(activity.id), null);
      assert.equal(reopened.state().subjects.activeBoundary?.digest, fixture.boundary.digest);
      assert.equal(candidatePublicationCount, 1);
      assert.equal(candidateCarrierVerificationCount, 1);
      const candidateEvents = reopened.listEvents(0, 10_000).filter((event) =>
        event.eventKind === "candidate-revision-observed" &&
        event.payload.activityId === activity.id);
      assert.equal(candidateEvents.length, 1);
      const candidateEvent = candidateEvents[0]!;
      assert(candidateEvent.subject !== null);
      const candidate = reopened.getRevision(
        candidateEvent.subject.recordId,
        candidateEvent.subject.revision,
      );
      assert(candidate !== null);
      assert.equal(candidate.digest, candidateEvent.subject.digest);
      const candidateReference = Object.freeze({
        id: candidate.recordId,
        revision: candidate.revision,
        digest: candidate.digest,
      });
      assert.deepEqual(reopened.state().subjects.candidate, candidateReference);
      assert.deepEqual(recovered.candidate, candidateReference);
      if (retainedCandidateReferenceAtFault !== null) {
        assert.deepEqual(candidateReference, retainedCandidateReferenceAtFault);
      }
      const manifest = candidate.payload.carrierManifest as ControlJsonObject;
      const retainedManifest = await reopened.readRetainedFile(manifest.digest as Sha256);
      assert(retainedManifest !== null);
      assert.deepEqual({
        digest: retainedManifest.descriptor.digest,
        byteLength: retainedManifest.descriptor.byteLength,
        mediaType: retainedManifest.descriptor.mediaType,
        purpose: retainedManifest.descriptor.purpose,
      }, manifest);
      assert.deepEqual(
        [...retainedManifest.bytes],
        [...testCandidateCarrierManifestBytes(
          fixture.candidateState.tree,
          fixture.candidateState.pathInventoryDigest,
        )],
      );
      assert.equal(reopened.listRetainedFiles().length, retainedFileCountBeforeAdmission + 1);
      reopened.close();
    } finally {
      try { fixture.store.close(); } catch { /* already closed */ }
      await rm(fixture.workspace, { recursive: true, force: true });
    }
  }
});

test("admission recovery rejects substituted support and forged retained authority", async () => {
  for (const variant of ["support", "checkpoint-schema", "signature"] as const) {
    const fixture = await createFixture(`forgery-${variant}`);
    try {
      await assert.rejects(admitDeliveryV7(await initialInput(fixture), options(fixture, {
        onStage: (stage) => {
          if (stage === "opening-committed") throw new Error("retain opening");
        },
      })), /retain opening/u);
      const activity = fixture.store.state().activities.find(({ operation }) =>
        operation === "delivery.admit");
      assert(activity !== undefined);
      const retained = fixture.store.getOperationSupport(activity.id);
      assert(retained !== null);
      if (variant === "support") {
        const payload = structuredClone(retained.payload) as Record<string, ControlJsonValue>;
        const planBinding = payload.plan as ControlJsonObject;
        const plan = planBinding.value as ControlJsonObject;
        const substituted = Object.freeze({ ...plan, targetId: "target-substituted" });
        payload.plan = Object.freeze({
          value: substituted,
          digest: digestCanonical(substituted),
        });
        fixture.store.putOperationSupport({
          activityId: activity.id,
          supportKind: retained.supportKind,
          payload,
          expected: { generation: retained.generation, payloadDigest: retained.payloadDigest },
        });
        await assert.rejects(recoverAdmissionV7({
          target: fixture.repository.repository,
          machineHome: join(fixture.workspace, "machine"),
          store: fixture.store,
          runtimeId: RUNTIME,
          activityId: activity.id,
        }, options(fixture)), (error: unknown) => error instanceof FoundationError &&
          error.code === "lifecycle.admission-v7.support-substitution");
      } else if (variant === "checkpoint-schema") {
        const payload = structuredClone(retained.payload) as Record<string, ControlJsonValue>;
        const checkpointBinding = payload.checkpoint as ControlJsonObject;
        const checkpoint = checkpointBinding.value as ControlJsonObject;
        const substituted = Object.freeze({
          ...checkpoint,
          schema: "lifecycle.runtime-admission-checkpoint.v1",
        });
        payload.checkpoint = Object.freeze({
          value: substituted,
          digest: digestCanonical(substituted),
        });
        fixture.store.putOperationSupport({
          activityId: activity.id,
          supportKind: retained.supportKind,
          payload,
          expected: { generation: retained.generation, payloadDigest: retained.payloadDigest },
        });
        await assert.rejects(recoverAdmissionV7({
          target: fixture.repository.repository,
          machineHome: join(fixture.workspace, "machine"),
          store: fixture.store,
          runtimeId: RUNTIME,
          activityId: activity.id,
        }, options(fixture)), (error: unknown) => error instanceof FoundationError &&
          error.code === "lifecycle.admission-v7.support");
      } else {
        const forged = new Proxy(fixture.store, {
          get(target, property) {
            if (property === "getRevision") {
              return (recordId: string, revision: number) => {
                const selected = target.getRevision(recordId, revision);
                if (selected?.recordKind !== "director-decision") return selected;
                const payload = structuredClone(selected.payload) as Record<string, ControlJsonValue>;
                const authentication = payload.authentication as ControlJsonObject;
                const signature = String(authentication.signature);
                const body = signature.slice("ed25519:".length);
                payload.authentication = Object.freeze({
                  ...authentication,
                  signature: `ed25519:${body.startsWith("A") ? "B" : "A"}${body.slice(1)}`,
                });
                return Object.freeze({ ...selected, payload });
              };
            }
            const value = Reflect.get(target, property, target) as unknown;
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        await assert.rejects(recoverAdmissionV7({
          target: fixture.repository.repository,
          machineHome: join(fixture.workspace, "machine"),
          store: forged,
          runtimeId: RUNTIME,
          activityId: activity.id,
        }, options(fixture, {
          now: timeOwner("2026-08-29T20:00:00.000Z"),
        })), (error: unknown) => error instanceof FoundationError &&
          error.code === "lifecycle.authority.signature");
      }
    } finally {
      fixture.store.close();
      await rm(fixture.workspace, { recursive: true, force: true });
    }
  }
});

test("deterministic Candidate Carrier invalid and unavailable facts remain recoverable", async () => {
  for (const availability of ["invalid", "unavailable"] as const) {
    const fixture = await createFixture(`candidate-${availability}`);
    try {
      const failureCode = `lifecycle.candidate.carrier-state-${availability}`;
      const outcome = await admitDeliveryV7(await initialInput(fixture), options(fixture, {
        carrierVerifier: async () => async () => {
          throw new FoundationError(
            failureCode,
            `Candidate Carrier is deterministically ${availability}`,
          );
        },
      }));
      assert.equal(outcome.status, "recovery-required");
      assert.equal(outcome.transactionOutcome, "applied");
      const support = fixture.store.getOperationSupport(outcome.activityId);
      assert(support !== null);
      assert.equal(JSON.stringify(support.payload).includes(join(fixture.workspace, "machine")), false);
      const checkpoint = ((support.payload.checkpoint as ControlJsonObject).value as ControlJsonObject);
      assert.equal("candidateCustody" in checkpoint, false);
      assert.deepEqual(checkpoint.candidateFailures, [{
        index: 1,
        observedAt: (checkpoint.candidateFailures as readonly ControlJsonObject[])[0]!.observedAt,
        availability,
        failureFactsDigest: digestCanonical({
          schema: "lifecycle.admission-candidate-failure.v1",
          failureCode,
        }),
      }]);
      const recovered = await recoverAdmissionV7({
        target: fixture.repository.repository,
        machineHome: join(fixture.workspace, "machine"),
        store: fixture.store,
        runtimeId: RUNTIME,
        activityId: outcome.activityId,
      }, options(fixture, { now: timeOwner("2026-08-29T20:00:00.000Z") }));
      assert.equal(recovered.status, "completed");
    } finally {
      fixture.store.close();
      await rm(fixture.workspace, { recursive: true, force: true });
    }
  }
});

test("incomplete Candidate Carrier observation propagates without a terminal failure fact", async () => {
  const fixture = await createFixture("candidate-observation-incomplete");
  try {
    await assert.rejects(
      admitDeliveryV7(await initialInput(fixture), options(fixture, {
        carrierVerifier: async () => async () => {
          throw new FoundationError(
            "lifecycle.candidate.carrier-state-observation-incomplete",
            "Candidate Carrier observation was interrupted",
          );
        },
      })),
      (error: unknown) => error instanceof FoundationError &&
        error.code === "lifecycle.candidate.carrier-state-observation-incomplete",
    );
    const activity = fixture.store.state().activities.find(({ operation }) =>
      operation === "delivery.admit");
    assert(activity !== undefined);
    assert.notEqual(activity.stage, "completed");
    assert.equal(activity.recovery?.resumesAt, "candidate-revision-observed");
    const support = fixture.store.getOperationSupport(activity.id);
    assert(support !== null);
    const checkpoint = ((support.payload.checkpoint as ControlJsonObject).value as ControlJsonObject);
    assert.deepEqual(checkpoint.candidateFailures, []);
    assert.equal(fixture.store.listEvents(0, 10_000).some((event) =>
      event.eventKind === "candidate-revision-observed" &&
      event.payload.activityId === activity.id), false);
    assert.equal(fixture.store.listEvents(0, 10_000).some((event) =>
      event.eventKind === "activity-completed" &&
      event.payload.activityId === activity.id), false);
  } finally {
    fixture.store.close();
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test("admission recovery rejects stale Candidate failure chronology", async () => {
  for (const variant of ["non-monotonic", "before-transaction"] as const) {
    const fixture = await createFixture(`candidate-failure-time-${variant}`);
    try {
      const pending = await admitDeliveryV7(await initialInput(fixture), options(fixture, {
        carrierVerifier: unavailableCarrierVerifier(),
      }));
      assert.equal(pending.status, "recovery-required");
      const deferred = await recoverAdmissionV7({
        target: fixture.repository.repository,
        machineHome: join(fixture.workspace, "machine"),
        store: fixture.store,
        runtimeId: RUNTIME,
        activityId: pending.activityId,
      }, options(fixture, {
        now: timeOwner("2026-08-29T21:00:00.000Z"),
        carrierVerifier: unavailableCarrierVerifier(),
      }));
      assert.equal(deferred.status, "recovery-required");

      const retained = fixture.store.getOperationSupport(pending.activityId);
      assert(retained !== null);
      const payload = structuredClone(retained.payload) as Record<string, ControlJsonValue>;
      const checkpointBinding = payload.checkpoint as ControlJsonObject;
      const checkpoint = checkpointBinding.value as ControlJsonObject;
      const failures = structuredClone(
        checkpoint.candidateFailures as readonly ControlJsonObject[],
      ) as ControlJsonObject[];
      assert.equal(failures.length, 2);
      if (variant === "non-monotonic") {
        failures[1] = Object.freeze({
          ...failures[1],
          observedAt: failures[0]!.observedAt!,
        });
      } else {
        failures[0] = Object.freeze({
          ...failures[0],
          observedAt: "2020-01-01T00:00:00.000Z",
        });
      }
      const substituted = Object.freeze({
        ...checkpoint,
        candidateFailures: Object.freeze(failures),
      });
      payload.checkpoint = Object.freeze({
        value: substituted,
        digest: digestCanonical(substituted),
      });
      fixture.store.putOperationSupport({
        activityId: pending.activityId,
        supportKind: retained.supportKind,
        payload,
        expected: { generation: retained.generation, payloadDigest: retained.payloadDigest },
      });

      await assert.rejects(recoverAdmissionV7({
        target: fixture.repository.repository,
        machineHome: join(fixture.workspace, "machine"),
        store: fixture.store,
        runtimeId: RUNTIME,
        activityId: pending.activityId,
      }, options(fixture)), (error: unknown) => error instanceof FoundationError &&
        error.code === "lifecycle.admission-v7.support-stage");
    } finally {
      fixture.store.close();
      await rm(fixture.workspace, { recursive: true, force: true });
    }
  }
});

test("Candidate observation exhaustion fails with the explicit retained bound", async () => {
  const fixture = await createFixture("candidate-observation-bound");
  try {
    const pending = await admitDeliveryV7(await initialInput(fixture), options(fixture, {
      carrierVerifier: unavailableCarrierVerifier(),
    }));
    assert.equal(pending.status, "recovery-required");
    const retryOptions = options(fixture, {
      now: timeOwner("2026-08-29T21:00:00.000Z"),
      carrierVerifier: unavailableCarrierVerifier(),
    });
    for (let index = 1; index < 8; index += 1) {
      const deferred = await recoverAdmissionV7({
        target: fixture.repository.repository,
        machineHome: join(fixture.workspace, "machine"),
        store: fixture.store,
        runtimeId: RUNTIME,
        activityId: pending.activityId,
      }, retryOptions);
      assert.equal(deferred.status, "recovery-required");
    }
    const retained = fixture.store.getOperationSupport(pending.activityId);
    assert(retained !== null);
    const checkpoint = (
      (retained.payload.checkpoint as ControlJsonObject).value as ControlJsonObject
    );
    assert.equal((checkpoint.candidateFailures as readonly unknown[]).length, 8);
    await assert.rejects(recoverAdmissionV7({
      target: fixture.repository.repository,
      machineHome: join(fixture.workspace, "machine"),
      store: fixture.store,
      runtimeId: RUNTIME,
      activityId: pending.activityId,
    }, retryOptions), (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.admission-v7.observation-bound");
  } finally {
    fixture.store.close();
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test("repository-basis not-applied retains exact disposition before failed completion", async () => {
  const fixture = await createFixture("not-applied");
  try {
    let observation = 0;
    const changedBasis = Object.freeze({
      ...fixture.repository.basis,
      canonicalCommit: "f".repeat(40),
    });
    await assert.rejects(admitDeliveryV7(await initialInput(fixture), options(fixture, {
      observeRepository: async () => {
        observation += 1;
        return observation === 1
          ? fixture.repository
          : Object.freeze({ ...fixture.repository, basis: changedBasis });
      },
      publishCandidateCarrier: async () => {
        throw new Error("not-applied admission cannot publish a Candidate Carrier");
      },
      onStage: (stage) => {
        if (stage === "transaction-effect-observed") throw new Error("inspect disposition");
      },
    })), /inspect disposition/u);
    const activity = fixture.store.state().activities.find(({ operation }) =>
      operation === "delivery.admit");
    assert(activity !== undefined);
    const support = fixture.store.getOperationSupport(activity.id);
    assert(support !== null);
    const checkpoint = ((support.payload.checkpoint as ControlJsonObject).value as ControlJsonObject);
    assert.deepEqual(checkpoint.disposition, {
      outcome: "not-applied",
      reason: "repository-basis-mismatch",
      observedFactsDigest: digestCanonical(changedBasis),
    });
    assert.equal(fixture.store.state().subjects.proposedBoundary?.digest, fixture.boundary.digest);
    assert.equal(fixture.store.state().subjects.activeBoundary, null);
    assert.equal(fixture.store.state().subjects.candidate, null);
    const recovered = await recoverAdmissionV7({
      target: fixture.repository.repository,
      machineHome: join(fixture.workspace, "machine"),
      store: fixture.store,
      runtimeId: RUNTIME,
      activityId: activity.id,
    }, options(fixture, { now: timeOwner("2026-08-29T20:00:00.000Z") }));
    assert.equal(recovered.status, "failed");
    assert.equal(recovered.transactionOutcome, "not-applied");
    assert.equal(fixture.store.getOperationSupport(activity.id), null);
    assert.equal(fixture.store.state().subjects.proposedBoundary?.digest, fixture.boundary.digest);
    assert.equal(fixture.store.state().subjects.candidate, null);
  } finally {
    fixture.store.close();
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test("readmit rebinds byte-identical Candidate state to the successor Boundary", async () => {
  const fixture = await createFixture("readmit");
  try {
    const initial = await admitDeliveryV7(await initialInput(fixture), options(fixture));
    assert.equal(initial.status, "completed");
    assert(initial.candidate !== null);
    const initialCandidate = fixture.store.getRevision(
      initial.candidate.id,
      initial.candidate.revision,
    );
    assert(initialCandidate !== null);
    const prepared = await seedReadmissionProposal(fixture, initialCandidate);
    assert.equal(fixture.store.state().standing, "awaiting-readmission");
    assert.equal(fixture.store.state().subjects.activeBoundary?.digest, fixture.boundary.digest);
    assert.equal(fixture.store.state().subjects.proposedBoundary?.digest, prepared.successor.digest);
    assert.equal(fixture.store.state().subjects.materialCondition?.digest, prepared.condition.digest);
    assert.equal(fixture.store.state().subjects.candidate?.digest, prepared.candidate.digest);

    const historicalObservations: string[] = [];
    const readmitted = await admitDeliveryV7(await initialInput(fixture), options(fixture, {
      now: timeOwner("2026-08-29T21:00:00.000Z"),
      observeRepository: async (_target, _observedAt, historicalCommit) => {
        historicalObservations.push(historicalCommit);
        return fixture.repository;
      },
      publishCandidateCarrier: async () => {
        throw new Error("Readmission must reuse the retained Candidate Carrier");
      },
      carrierVerifier: async () =>
        testCandidateCarrierVerifier(prepared.candidateState),
    }));
    assert.equal(readmitted.status, "completed");
    assert.equal(readmitted.decisionKind, "readmit");
    assert.equal(historicalObservations.length > 0, true);
    assert.deepEqual([...new Set(historicalObservations)], [BASE_COMMIT]);
    assert.deepEqual(readmitted.candidate, {
      id: prepared.candidate.recordId,
      revision: prepared.candidate.revision + 1,
      digest: fixture.store.state().subjects.candidate?.digest,
    });
    assert.equal(fixture.store.state().subjects.activeBoundary?.digest, prepared.successor.digest);
    assert.equal(fixture.store.state().subjects.proposedBoundary, null);
    assert.equal(fixture.store.state().subjects.materialCondition, null);
    assert.notEqual(fixture.store.state().subjects.candidate?.digest, prepared.candidate.digest);
    const rebound = fixture.store.getRevision(
      prepared.candidate.recordId,
      prepared.candidate.revision + 1,
    );
    assert(rebound !== null);
    assert.equal(rebound.payload.observation, "readmission-rebind");
    assert.equal(
      rebound.payload.candidateBaseCommit,
      prepared.candidate.payload.candidateBaseCommit,
    );
    assert.deepEqual(rebound.payload.state, prepared.candidate.payload.state);
    assert.deepEqual(rebound.relationships, [
      relationship("governed-by", "work-boundary", prepared.successor),
      relationship("revises", "candidate-revision", prepared.candidate),
    ]);
    const decisionEvent = fixture.store.listEvents(0, 10_000).find((event) =>
      event.eventKind === "director-decision-authenticated" &&
      event.payload.activityId === readmitted.activityId);
    assert(decisionEvent?.subject !== null && decisionEvent?.subject !== undefined);
    const decision = fixture.store.getRevision(
      decisionEvent.subject.recordId,
      decisionEvent.subject.revision,
    );
    assert(decision !== null);
    assert.deepEqual(decision.relationships.map(({ relation }) => relation), [
      "continues-from-boundary",
      "resolves",
      "selects-baseline-receipt",
      "selects-boundary",
      "selects-candidate",
    ]);
  } finally {
    fixture.store.close();
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test("readmit recovery completes only after the exact Candidate rebind was retained", async () => {
  const fixture = await createFixture("readmit-rebind-recovery");
  try {
    const initial = await admitDeliveryV7(await initialInput(fixture), options(fixture));
    assert(initial.candidate !== null);
    const initialCandidate = fixture.store.getRevision(
      initial.candidate.id,
      initial.candidate.revision,
    );
    assert(initialCandidate !== null);
    const prepared = await seedReadmissionProposal(fixture, initialCandidate);

    await assert.rejects(admitDeliveryV7(await initialInput(fixture), options(fixture, {
      now: timeOwner("2026-08-29T21:00:00.000Z"),
      carrierVerifier: async () =>
        testCandidateCarrierVerifier(prepared.candidateState),
      onStage: (stage) => {
        if (stage === "candidate-revision-observed") throw new Error("lost readmission rebind return");
      },
    })), /lost readmission rebind return/u);

    const activity = fixture.store.state().activities.find((value) =>
      value.operation === "delivery.admit" && value.stage !== "completed");
    assert(activity !== undefined);
    assert.deepEqual(activity.recovery, {
      kind: "finalization",
      resumesAt: "activity-completed",
      exactEffectDigest: null,
    });
    const reboundReference = fixture.store.state().subjects.candidate;
    assert(reboundReference !== null);
    assert.equal(reboundReference.id, prepared.candidate.recordId);
    assert.equal(reboundReference.revision, prepared.candidate.revision + 1);
    assert.equal(fixture.store.listEvents(0, 10_000).filter((event) =>
      event.eventKind === "candidate-revision-observed" &&
      event.payload.activityId === activity.id).length, 1);

    const recovered = await recoverAdmissionV7({
      target: fixture.repository.repository,
      machineHome: join(fixture.workspace, "machine"),
      store: fixture.store,
      runtimeId: RUNTIME,
      activityId: activity.id,
    }, options(fixture, {
      now: timeOwner("2026-08-29T22:00:00.000Z"),
      carrierVerifier: async () => {
        throw new Error("Completed rebind recovery must not reopen the Carrier twice");
      },
    }));
    assert.equal(recovered.status, "completed");
    assert.deepEqual(recovered.candidate, reboundReference);
    assert.equal(fixture.store.listEvents(0, 10_000).filter((event) =>
      event.eventKind === "candidate-revision-observed" &&
      event.payload.activityId === activity.id).length, 1);
  } finally {
    fixture.store.close();
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test("readmit Carrier mismatch leaves the applied rebind recoverable without a successor", async () => {
  const fixture = await createFixture("readmit-mismatch");
  try {
    const initial = await admitDeliveryV7(await initialInput(fixture), options(fixture));
    assert(initial.candidate !== null);
    const initialCandidate = fixture.store.getRevision(
      initial.candidate.id,
      initial.candidate.revision,
    );
    assert(initialCandidate !== null);
    const prepared = await seedReadmissionProposal(fixture, initialCandidate);
    const pending = await admitDeliveryV7(await initialInput(fixture), options(fixture, {
      now: timeOwner("2026-08-29T21:00:00.000Z"),
      carrierVerifier: async () => async () => {
        throw new FoundationError(
          "lifecycle.candidate.carrier-state-invalid",
          "Candidate Carrier does not reproduce the retained readmission state",
        );
      },
    }));
    assert.equal(pending.status, "recovery-required");
    assert.equal(pending.transactionOutcome, "applied");
    const activity = fixture.store.state().activities.find((value) =>
      value.operation === "delivery.admit" && value.stage !== "completed");
    assert(activity !== undefined);
    const support = fixture.store.getOperationSupport(activity.id);
    assert(support !== null);
    const checkpoint = ((support.payload.checkpoint as ControlJsonObject).value as ControlJsonObject);
    assert.equal(checkpoint.disposition, null);
    assert.deepEqual(checkpoint.candidateFailures, [{
      index: 1,
      observedAt: (checkpoint.candidateFailures as readonly ControlJsonObject[])[0]!.observedAt,
      availability: "invalid",
      failureFactsDigest: digestCanonical({
        schema: "lifecycle.admission-candidate-failure.v1",
        failureCode: "lifecycle.candidate.carrier-state-invalid",
      }),
    }]);
    assert.equal(fixture.store.state().subjects.activeBoundary?.digest, prepared.successor.digest);
    assert.equal(fixture.store.state().subjects.proposedBoundary, null);
    assert.equal(fixture.store.state().subjects.materialCondition, null);
    assert.equal(fixture.store.state().subjects.candidate?.digest, prepared.candidate.digest);
    const recovered = await recoverAdmissionV7({
      target: fixture.repository.repository,
      machineHome: join(fixture.workspace, "machine"),
      store: fixture.store,
      runtimeId: RUNTIME,
      activityId: activity.id,
    }, options(fixture, {
      now: timeOwner("2026-08-29T22:00:00.000Z"),
      carrierVerifier: async () => testCandidateCarrierVerifier(prepared.candidateState),
    }));
    assert.equal(recovered.status, "completed");
    assert.equal(fixture.store.state().subjects.candidate?.revision, prepared.candidate.revision + 1);
  } finally {
    fixture.store.close();
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test("readmit Candidate unavailability remains recovery and preserves its exact failure fact", async () => {
  const fixture = await createFixture("readmit-unavailable");
  try {
    const initial = await admitDeliveryV7(await initialInput(fixture), options(fixture));
    assert(initial.candidate !== null);
    const initialCandidate = fixture.store.getRevision(
      initial.candidate.id,
      initial.candidate.revision,
    );
    assert(initialCandidate !== null);
    const prepared = await seedReadmissionProposal(fixture, initialCandidate);
    const firstFailureCode = "lifecycle.candidate.carrier-state-unavailable";
    const failureFactsDigest = digestCanonical({
      schema: "lifecycle.admission-candidate-failure.v1",
      failureCode: firstFailureCode,
    });
    const pending = await admitDeliveryV7(await initialInput(fixture), options(fixture, {
      now: timeOwner("2026-08-29T21:00:00.000Z"),
      carrierVerifier: unavailableCarrierVerifier(),
    }));
    assert.equal(pending.status, "recovery-required");
    assert.equal(pending.transactionOutcome, "applied");
    const support = fixture.store.getOperationSupport(pending.activityId);
    assert(support !== null);
    assert.equal(
      fixture.store.state().activities.find(({ id }) => id === pending.activityId)?.recovery?.resumesAt,
      "candidate-revision-observed",
    );
    const checkpoint = ((support.payload.checkpoint as ControlJsonObject).value as ControlJsonObject);
    assert.deepEqual(checkpoint.candidateFailures, [{
      index: 1,
      observedAt: (checkpoint.candidateFailures as readonly ControlJsonObject[])[0]!.observedAt,
      availability: "unavailable",
      failureFactsDigest,
    }]);
    const firstObservation = fixture.store.listEvents(0, 10_000).filter((event) =>
      event.eventKind === "transaction-effect-observed" &&
      event.payload.activityId === pending.activityId).at(-1)!;
    assert.equal(firstObservation.payload.factsDigest, digestCanonical({
      schema: "lifecycle.admission-effect-observation-facts.v2",
      outcome: "applied",
      disposition: null,
      repositoryBasisDigest: digestCanonical(fixture.repository.basis),
    }));
    const deferred = await recoverAdmissionV7({
      target: fixture.repository.repository,
      machineHome: join(fixture.workspace, "machine"),
      store: fixture.store,
      runtimeId: RUNTIME,
      activityId: pending.activityId,
    }, options(fixture, {
      now: timeOwner("2026-08-29T22:00:00.000Z"),
      carrierVerifier: unavailableCarrierVerifier(),
    }));
    assert.equal(deferred.status, "recovery-required");
    const deferredSupport = fixture.store.getOperationSupport(pending.activityId);
    assert(deferredSupport !== null);
    const deferredCheckpoint = (
      (deferredSupport.payload.checkpoint as ControlJsonObject).value as ControlJsonObject
    );
    assert.equal("effectObservations" in deferredCheckpoint, false);
    assert.equal("times" in deferredCheckpoint, false);
    const failures = deferredCheckpoint.candidateFailures as readonly ControlJsonObject[];
    assert.equal(failures.length, 2);
    assert.equal(failures[1]!.failureFactsDigest, failureFactsDigest);
    const observations = fixture.store.listEvents(0, 10_000).filter((event) =>
      event.eventKind === "transaction-effect-observed" &&
      event.payload.activityId === pending.activityId);
    assert.equal(observations.length, 1);
    assert.match(observations[0]!.payload.factsDigest as string, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(
      fixture.store.state().activities.find(({ id }) => id === pending.activityId)?.recovery?.resumesAt,
      "candidate-revision-observed",
    );

    const recovered = await recoverAdmissionV7({
      target: fixture.repository.repository,
      machineHome: join(fixture.workspace, "machine"),
      store: fixture.store,
      runtimeId: RUNTIME,
      activityId: pending.activityId,
    }, options(fixture, {
      now: timeOwner("2026-08-29T23:00:00.000Z"),
      carrierVerifier: async () =>
        testCandidateCarrierVerifier(prepared.candidateState),
    }));
    assert.equal(recovered.status, "completed");
    assert.equal(fixture.store.state().subjects.activeBoundary?.digest, prepared.successor.digest);
    assert.equal(fixture.store.state().subjects.candidate?.id, prepared.candidate.recordId);
    assert.equal(
      fixture.store.state().subjects.candidate?.revision,
      prepared.candidate.revision + 1,
    );
    assert.notEqual(fixture.store.state().subjects.candidate?.digest, prepared.candidate.digest);
  } finally {
    fixture.store.close();
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});
