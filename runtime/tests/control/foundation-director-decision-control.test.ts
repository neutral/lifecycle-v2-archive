import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  FoundationAuthorizationReviewSelectorSchema,
  FoundationDeliveryGenerationSchema,
} from "@neutral/lifecycle-protocol";
import {
  compileAuthorizationReviewCore,
  compileDirectorDecisionOpening as compileOpeningWithSigner,
  type DirectorDecisionRepositoryBasis,
} from "../../src/foundation/control/director-decision.js";
import {
  compileControlRecordEvent,
  compileControlRecordRevision,
} from "../../src/foundation/control/model.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlJsonObject,
  type ControlRecordEvent,
  type ControlRecordRevision,
  type ControlRecordStoreAppend,
  type ControlRecordStoreIdentity,
} from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import { compileFoundationAuthorizationReviewInspection } from "../../src/foundation/read-model/authorization-inspection.js";
import {
  createFoundationAuthority,
  receiveFoundationAuthorityCredential,
  assertFoundationAuthorityCredential,
  discardFoundationAuthorityCredential,
  authenticateDirectorDecisionOpening as compileDirectorDecisionOpening,
} from "../../src/foundation/repository/authority.js";
import type {
  FoundationLoadedRepositorySnapshot,
  FoundationRepositoryContract,
} from "../../src/foundation/repository/types.js";
import type { ReducedDeliveryState } from "../../src/foundation/process/delivery-reducer.js";
import {
  digestCanonical,
  sha256Bytes,
} from "../../src/foundation/validation/canonical.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";
import { retainEvidencePacket } from "../../src/foundation/control/evidence-packet.js";
import { evidenceFixtureV7, EVIDENCE_OBSERVATION_V7 } from "../helpers/evidence-fixture-v7.js";

const CREATED = "2026-08-29T18:00:00.000Z";
const AUTHORIZED = "2026-08-29T18:00:02.000Z";
const VERIFIED = "2026-08-29T18:00:03.000Z";
const TARGET = "target-director-decision";
const PROCESS = "delivery-director-decision";
const ACTIVITY = "activity-director-decision";
const RUNTIME = "foundation-runtime";
const SECRET = "correct horse battery staple authority secret";

function digest(value: string) {
  return sha256Bytes(value);
}

const repository: DirectorDecisionRepositoryBasis = Object.freeze({
  repositorySnapshotDigest: digest("snapshot"),
  canonicalCommit: "a".repeat(40),
  canonicalTree: "b".repeat(40),
  productStateDigest: digest("product"),
  atlasStateDigest: digest("atlas"),
  atlasResolutionDigest: digest("atlas-resolution"),
  atlasNormalizedModelDigest: digest("atlas-normalized-model"),
  atlasResourceBindingsDigest: digest("atlas-resource-bindings"),
  repositoryContractDigest: digest("contract"),
  knowledgeSetDigest: digest("knowledge"),
  checkBindingSetDigest: digest("checks"),
});

type StateSubject = Readonly<{ id: string; revision: number; digest: ReturnType<typeof digest> }>;

function retainedRevision(kind: string, value: StateSubject): ControlRecordRevision {
  const payload = validDeliveryControlPayload(kind as Parameters<typeof validDeliveryControlPayload>[0]);
  const exactPayload = kind === "work-boundary"
    ? Object.freeze({
        ...payload,
        targetId: TARGET,
        basis: Object.freeze({
          ...(payload.basis as ControlJsonObject),
          productBaseCommit: repository.canonicalCommit,
          productBaseTree: repository.canonicalTree,
          productStateDigest: repository.productStateDigest,
          atlasStateDigest: repository.atlasStateDigest,
          atlasResolutionDigest: repository.atlasResolutionDigest,
          atlasNormalizedModelDigest: repository.atlasNormalizedModelDigest,
          atlasResourceBindingsDigest: repository.atlasResourceBindingsDigest,
          repositoryContractDigest: repository.repositoryContractDigest,
          knowledgeSetDigest: repository.knowledgeSetDigest,
          repositorySnapshotDigest: repository.repositorySnapshotDigest,
        }),
      })
    : payload;
  return Object.freeze({
    schema: "lifecycle.control-record-revision.v2",
    processId: PROCESS,
    recordId: value.id,
    recordKind: kind,
    revision: value.revision,
    producer: Object.freeze({ kind: "runtime", id: RUNTIME }),
    semanticAuthor: Object.freeze({ kind: "runtime", id: RUNTIME }),
    semanticAuthority: "runtime-derived",
    createdAt: CREATED,
    semanticMarkdown: `# ${kind}\n`,
    payload: exactPayload,
    relationships: Object.freeze([]),
    digest: value.digest,
  });
}

function fakeStore(input: Readonly<{
  operation: "delivery.admit" | "delivery.accept" | "delivery.no-ship";
  standing: ReducedDeliveryState["standing"];
  subjects?: Partial<ReducedDeliveryState["subjects"]>;
  revisions?: readonly ControlRecordRevision[];
  historicalBoundary?: StateSubject;
}>) {
  const identity: ControlRecordStoreIdentity = Object.freeze({
    schema: CONTROL_RECORD_STORE_SCHEMA,
    storeId: "store-director-decision",
    targetId: TARGET,
    processKind: "delivery",
    processId: PROCESS,
    createdAt: CREATED,
  });
  const first = compileControlRecordEvent({
    storeId: identity.storeId,
    processId: identity.processId,
    sequence: 1,
    predecessorDigest: null,
    event: {
      eventId: "event-delivery-created",
      eventKind: "delivery-created",
      occurredAt: CREATED,
      actor: { kind: "runtime", id: RUNTIME },
      subject: null,
      payload: {},
    },
  });
  const events: ControlRecordEvent[] = [first];
  if (input.historicalBoundary !== undefined) {
    events.push(compileControlRecordEvent({
      storeId: identity.storeId,
      processId: identity.processId,
      sequence: 2,
      predecessorDigest: first.digest,
      event: {
        eventId: "event-work-boundary-finalized",
        eventKind: "work-boundary-finalized",
        occurredAt: "2026-08-29T18:00:00.500Z",
        actor: { kind: "runtime", id: RUNTIME },
        subject: {
          recordId: input.historicalBoundary.id,
          revision: input.historicalBoundary.revision,
          digest: input.historicalBoundary.digest,
        },
        payload: { activityId: "activity-completed-preparation" },
      },
    }));
  }
  const head = events.at(-1)!;
  const subjects = Object.freeze({
    integrationAssessment: null,
    proposedBoundary: null,
    activeBoundary: null,
    candidate: null,
    materialCondition: null,
    seal: null,
    evidence: null,
    closure: null,
    ...input.subjects,
  });
  const state: ReducedDeliveryState = Object.freeze({
    standing: input.standing,
    candidateCondition: subjects.candidate === null ? "absent" : "ready-for-decision",
    activities: Object.freeze([]),
    subjects,
    delegation: { admission: null, current: null, charged: { operations: 0, agentAttempts: 0, reservedCellWallTimeMs: 0 } },
    journal: Object.freeze({ eventCount: events.length, headDigest: head.digest }),
    eligibleOperations: Object.freeze([input.operation]),
  });
  const revisions = new Map<string, ControlRecordRevision>(
    (input.revisions ?? []).map((value) => [`${value.recordId}\u0000${value.revision}`, value]),
  );
  const store = {
    identity,
    state: () => state,
    listEvents(afterSequence: number, limit: number) {
      return events.filter(({ sequence }) => sequence > afterSequence).slice(0, limit);
    },
    getRevision(recordId: string, revision: number) {
      return revisions.get(`${recordId}\u0000${revision}`) ?? null;
    },
    append(value: ControlRecordStoreAppend) {
      const revision = value.revision === undefined
        ? null
        : compileControlRecordRevision(identity.processId, value.revision);
      if (revision !== null) revisions.set(`${revision.recordId}\u0000${revision.revision}`, revision);
      const event = compileControlRecordEvent({
        storeId: identity.storeId,
        processId: identity.processId,
        sequence: events.length + 1,
        predecessorDigest: events.at(-1)?.digest ?? null,
        event: value.event,
      });
      events.push(event);
      return Object.freeze({ revision, event });
    },
  } as unknown as ControlRecordStore;
  return store;
}

async function authorityFixture(secret = SECRET, targetId = TARGET, principalId = "director:demo") {
  const home = await mkdtemp(join(tmpdir(), "lifecycle-director-decision-"));
  const authority = await createFoundationAuthority(home, targetId, receiveFoundationAuthorityCredential(secret, "initialize"), principalId);
  const contract = Object.freeze({
    targetId,
    digest: repository.repositoryContractDigest,
    authority,
    checkBindings: Object.freeze([]),
  }) as unknown as FoundationRepositoryContract;
  return { home, contract } as const;
}

test("Director authorization review is deterministic, immutable, self-digested, and non-authorizing", async (context) => {
  const fixture = await authorityFixture();
  context.after(async () => rm(fixture.home, { recursive: true, force: true }));
  const store = fakeStore({ operation: "delivery.no-ship", standing: "framing" });
  const beforeState = digestCanonical(store.state());
  const beforeEvents = store.listEvents(0, 100).map(({ digest: eventDigest }) => eventDigest);
  const input = Object.freeze({
    store,
    operation: "delivery.no-ship" as const,
    semanticMarkdown: "# No ship\n\nThere is no coherent delivery to continue.\n\n",
    repository,
    contract: fixture.contract,
  });

  const first = compileAuthorizationReviewCore(input);
  const second = compileAuthorizationReviewCore(input);
  const { authorizationReviewDigest, ...reviewBody } = first;

  assert.deepEqual(second, first);
  assert.equal(authorizationReviewDigest, digestCanonical(reviewBody));
  assert.equal(first.semanticMarkdown, "# No ship\n\nThere is no coherent delivery to continue.\n");
  assert.equal(first.semanticDigest, sha256Bytes(first.semanticMarkdown));
  assert.equal(
    first.consequence,
    "Close the Delivery without changing canonical Product State.",
  );
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.journalHead), true);
  assert.equal(Object.isFrozen(first.repository), true);
  assert.equal(Object.isFrozen(first.selectedControl), true);
  assert.equal(Object.isFrozen(first.coordinates), true);
  assert.equal(Object.isFrozen(first.authority), true);
  for (const forbidden of [
    "activityId",
    "decisionId",
    "authorizedAt",
    "expiresAt",
    "nonce",
    "signature",
    "challenge",
    "subject",
    "subjectDigest",
  ]) {
    assert.equal(Object.hasOwn(first, forbidden), false, `${forbidden} must not enter review`);
  }
  assert.equal(JSON.stringify(first).includes(SECRET), false);
  assert.equal(digestCanonical(store.state()), beforeState);
  assert.deepEqual(
    store.listEvents(0, 100).map(({ digest: eventDigest }) => eventDigest),
    beforeEvents,
  );
});

test("public Authorization Review inspection binds the read generation without authorizing", async (context) => {
  const fixture = await authorityFixture();
  context.after(async () => rm(fixture.home, { recursive: true, force: true }));
  const store = fakeStore({ operation: "delivery.no-ship", standing: "framing" });
  const reduced = store.state();
  const head = store.listEvents(0, 100).at(-1)!;
  const generationSubject = Object.freeze({
    schema: "lifecycle.delivery-generation.v1" as const,
    storeId: store.identity.storeId,
    processId: store.identity.processId,
    journal: Object.freeze({
      eventCount: reduced.journal.eventCount,
      headSequence: reduced.journal.eventCount,
      headDigest: head.digest,
    }),
    storeDisposition: Object.freeze({
      stage: "active" as const,
      integrity: "verified" as const,
      sealSubjectDigest: null,
      archiveManifestDigest: null,
    }),
    repository: Object.freeze({
      headCommit: repository.canonicalCommit,
      headTree: repository.canonicalTree,
      repositoryContractDigest: repository.repositoryContractDigest,
    }),
    activeOperation: null,
  });
  const generation = FoundationDeliveryGenerationSchema.parse({
    ...generationSubject,
    digest: digestCanonical({
      schema: "lifecycle.delivery-read-generation-token.v1",
      publicSubject: generationSubject,
      operationSupportBindingDigest: null,
    }),
  });
  const currentRepository = Object.freeze({
    contract: fixture.contract,
    epoch: Object.freeze({
      commit: repository.canonicalCommit,
      tree: repository.canonicalTree,
    }),
    productState: Object.freeze({ digest: repository.productStateDigest }),
    atlasState: Object.freeze({ digest: repository.atlasStateDigest }),
    atlas: Object.freeze({ resolution: Object.freeze({
      digest: repository.atlasResolutionDigest,
      normalizedModelDigest: repository.atlasNormalizedModelDigest,
      resourceBindingsDigest: repository.atlasResourceBindingsDigest,
    }) }),
    snapshot: Object.freeze({
      digest: repository.repositorySnapshotDigest,
      knowledgeSetDigest: repository.knowledgeSetDigest,
    }),
  }) as unknown as FoundationLoadedRepositorySnapshot;
  const selector = FoundationAuthorizationReviewSelectorSchema.parse({
    kind: "authorization-review",
    expectedGeneration: generation.digest,
    operation: "delivery.no-ship",
    input: Object.freeze({
      semanticMarkdown: "# No ship\n\nThere is no coherent delivery to continue.\n",
    }),
  });
  const stateBefore = digestCanonical(store.state());
  const eventsBefore = store.listEvents(0, 100).map(({ digest: eventDigest }) => eventDigest);
  const result = compileFoundationAuthorizationReviewInspection({
    store,
    generation,
    selector,
    query: null,
    currentRepository,
  });
  assert.equal(result.generation.digest, generation.digest);
  assert.equal(result.review.operation, "delivery.no-ship");
  assert.equal(result.review.decision, "no-ship");
  assert.equal(digestCanonical(store.state()), stateBefore);
  assert.deepEqual(
    store.listEvents(0, 100).map(({ digest: eventDigest }) => eventDigest),
    eventsBefore,
  );
  assert.throws(() => compileFoundationAuthorizationReviewInspection({
    store,
    generation,
    selector: { ...selector, expectedGeneration: digest("stale-generation") },
    query: null,
    currentRepository,
  }), (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.read-model.generation-stale");
});

test("Director authorization review digest changes with every reviewed authority basis", async (context) => {
  const fixture = await authorityFixture();
  context.after(async () => rm(fixture.home, { recursive: true, force: true }));
  const baseInput = Object.freeze({
    store: fakeStore({ operation: "delivery.no-ship", standing: "framing" }),
    operation: "delivery.no-ship" as const,
    semanticMarkdown: "# No ship\n\nStop this Delivery.\n",
    repository,
    contract: fixture.contract,
  });
  const boundary = Object.freeze({
    id: "boundary-authorization-review",
    revision: 1,
    digest: digest("boundary-authorization-review"),
  });
  const changedPrincipalContract = Object.freeze({
    ...fixture.contract,
    authority: Object.freeze({
      ...fixture.contract.authority,
      principalId: "director:alternate",
    }),
  }) as FoundationRepositoryContract;
  const variants = [
    compileAuthorizationReviewCore(baseInput),
    compileAuthorizationReviewCore({
      ...baseInput,
      semanticMarkdown: "# No ship\n\nStop this different Delivery consequence.\n",
    }),
    compileAuthorizationReviewCore({
      ...baseInput,
      store: fakeStore({ operation: "delivery.no-ship", standing: "active" }),
    }),
    compileAuthorizationReviewCore({
      ...baseInput,
      store: fakeStore({
        operation: "delivery.no-ship",
        standing: "framing",
        historicalBoundary: boundary,
        revisions: [retainedRevision("work-boundary", boundary)],
      }),
    }),
    compileAuthorizationReviewCore({
      ...baseInput,
      repository: Object.freeze({
        ...repository,
        canonicalCommit: "c".repeat(40),
        productStateDigest: digest("changed-product-state"),
      }),
    }),
    compileAuthorizationReviewCore({
      ...baseInput,
      contract: changedPrincipalContract,
    }),
  ];

  assert.equal(
    new Set(variants.map(({ authorizationReviewDigest }) => authorizationReviewDigest)).size,
    variants.length,
  );
  assert.equal(variants[1]!.semanticDigest === variants[0]!.semanticDigest, false);
  assert.equal(variants[2]!.reducerFactsDigest === variants[0]!.reducerFactsDigest, false);
  assert.equal(variants[3]!.selectedControl.length, 1);
  assert.equal(variants[4]!.repository.productStateDigest, digest("changed-product-state"));
  assert.equal(variants[5]!.authority.principalId, "director:alternate");
});

test("Director authorization review refuses a Store basis that changes during derivation", async (context) => {
  const fixture = await authorityFixture();
  context.after(async () => rm(fixture.home, { recursive: true, force: true }));
  const store = fakeStore({ operation: "delivery.no-ship", standing: "framing" });
  let stateReads = 0;
  const changingStore = new Proxy(store, {
    get(target, property, receiver) {
      if (property !== "state") return Reflect.get(target, property, receiver);
      return () => {
        const state = target.state();
        stateReads += 1;
        return stateReads === 1 ? state : Object.freeze({ ...state, standing: "active" as const });
      };
    },
  });

  assert.throws(() => compileAuthorizationReviewCore({
    store: changingStore,
    operation: "delivery.no-ship",
    semanticMarkdown: "# No ship\n\nRefuse a moving review basis.\n",
    repository,
    contract: fixture.contract,
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-director-decision.stale-review");
  assert.equal(stateReads, 2);
});

for (const principalId of ["human:director", "agent:director"]) {
test(`Director ${principalId} authenticates the exact reviewed subject through authority custody`, async (context) => {
  const fixture = await authorityFixture(SECRET, TARGET, principalId);
  context.after(async () => rm(fixture.home, { recursive: true, force: true }));
  const store = fakeStore({ operation: "delivery.no-ship", standing: "framing" });
  const semanticMarkdown = "# No ship\n\nReconnaissance did not establish a coherent boundary.\n";
  const reviewed = compileAuthorizationReviewCore({
    store,
    operation: "delivery.no-ship",
    semanticMarkdown,
    repository,
    contract: fixture.contract,
  });
  const retained = await compileDirectorDecisionOpening({
    store,
    activityId: ACTIVITY,
    operation: "delivery.no-ship",
    semanticMarkdown,
    repository,
    contract: fixture.contract,
    authorityHome: fixture.home,
    authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
    startedAt: "2026-08-29T18:00:01.000Z",
    authorizedAt: AUTHORIZED,
    expiresAt: null,
    nonce: "nonce-reviewed-director-decision",
    verifiedAt: VERIFIED,
    runtimeId: RUNTIME,
  });

  assert.deepEqual(retained.authorizationReview, reviewed);
  assert.equal(retained.subject.principalId, principalId);
  assert.equal(retained.acceptanceBasis, null);
  assert.deepEqual(retained.subject, {
    schema: "lifecycle.director-decision-subject.v4",
    targetId: reviewed.targetId,
    storeId: reviewed.storeId,
    processId: reviewed.processId,
    activityId: ACTIVITY,
    operation: reviewed.operation,
    decisionId: retained.revision.recordId,
    decision: reviewed.decision,
    decisionSemanticDigest: reviewed.semanticDigest,
    journalHead: reviewed.journalHead,
    reducerFactsDigest: reviewed.reducerFactsDigest,
    repository: reviewed.repository,
    selectedControl: reviewed.selectedControl,
    coordinates: reviewed.coordinates,
    principalId: reviewed.authority.principalId,
    keyId: reviewed.authority.keyId,
    algorithm: reviewed.authority.algorithm,
    authorizedAt: AUTHORIZED,
    expiresAt: null,
    nonce: "nonce-reviewed-director-decision",
    candidateDisposition: reviewed.candidateDisposition,
  });
  assert.notEqual(
    retained.authorizationReview.authorizationReviewDigest,
    retained.revision.payload.subjectDigest,
  );
});
}

test("Director Decision compiler signs and retains exact early no-ship authority", async (context) => {
  const fixture = await authorityFixture();
  context.after(async () => rm(fixture.home, { recursive: true, force: true }));
  const retained = await compileDirectorDecisionOpening({
    store: fakeStore({ operation: "delivery.no-ship", standing: "framing" }),
    activityId: ACTIVITY,
    operation: "delivery.no-ship",
    semanticMarkdown: "# No ship\n\nReconnaissance did not establish a coherent boundary.\n",
    repository,
    contract: fixture.contract,
    authorityHome: fixture.home,
    authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
    startedAt: "2026-08-29T18:00:01.000Z",
    authorizedAt: AUTHORIZED,
    expiresAt: null,
    nonce: "nonce-director-decision",
    verifiedAt: VERIFIED,
    runtimeId: RUNTIME,
  });

  assert.equal(retained.subject.decision, "no-ship");
  assert.equal(retained.subject.candidateDisposition, "no-candidate");
  assert.deepEqual(retained.subject.selectedControl, []);
  assert.equal(
    retained.subject.coordinates.transactionRules,
    "lifecycle.delivery-transaction-rules.v1",
  );
  assert.match(
    String((retained.revision.payload.authentication as { signature: string }).signature),
    /^ed25519:[A-Za-z0-9_-]{86}$/u,
  );
  assert.equal(retained.revision.semanticAuthority, "director-authenticated");
  assert.equal(retained.decisionAppend.event.eventKind, "director-decision-authenticated");
});

test("Director Decision no-ship retains the latest established Boundary after failed preparation", async (context) => {
  const fixture = await authorityFixture();
  context.after(async () => rm(fixture.home, { recursive: true, force: true }));
  const boundary = Object.freeze({
    id: "boundary-failed-preparation",
    revision: 1,
    digest: digest("failed-preparation-boundary"),
  });
  const retained = await compileDirectorDecisionOpening({
    store: fakeStore({
      operation: "delivery.no-ship",
      standing: "framing",
      historicalBoundary: boundary,
      revisions: [retainedRevision("work-boundary", boundary)],
    }),
    activityId: ACTIVITY,
    operation: "delivery.no-ship",
    semanticMarkdown: "# No ship\n\nThe established boundary cannot proceed.\n",
    repository,
    contract: fixture.contract,
    authorityHome: fixture.home,
    authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
    startedAt: "2026-08-29T18:00:01.000Z",
    authorizedAt: AUTHORIZED,
    expiresAt: null,
    nonce: "nonce-failed-preparation-no-ship",
    verifiedAt: VERIFIED,
    runtimeId: RUNTIME,
  });

  assert.deepEqual(retained.subject.selectedControl, [{
    relation: "selects-boundary",
    target: {
      kind: "work-boundary",
      id: boundary.id,
      revision: boundary.revision,
      digest: boundary.digest,
    },
  }]);
  assert.deepEqual(retained.revision.relationships.map(({ relation }) => relation), [
    "selects-boundary",
  ]);
});

test("Director Decision no-ship authenticates its established historical Boundary regardless of later repository movement", async (context) => {
  const fixture = await authorityFixture();
  context.after(async () => rm(fixture.home, { recursive: true, force: true }));
  const boundary = Object.freeze({
    id: "boundary-before-repository-movement",
    revision: 1,
    digest: digest("boundary-before-repository-movement"),
  });
  const currentRepository = Object.freeze({
    ...repository,
    repositorySnapshotDigest: digest("snapshot-after-repository-movement"),
    canonicalCommit: "c".repeat(40),
    canonicalTree: "d".repeat(40),
    atlasStateDigest: digest("atlas-state-after-movement"),
    atlasResolutionDigest: digest("atlas-resolution-after-movement"),
    atlasNormalizedModelDigest: digest("atlas-model-after-movement"),
    atlasResourceBindingsDigest: digest("atlas-resources-after-movement"),
  });
  const retained = await compileDirectorDecisionOpening({
    store: fakeStore({
      operation: "delivery.no-ship",
      standing: "framing",
      historicalBoundary: boundary,
      revisions: [retainedRevision("work-boundary", boundary)],
    }),
    activityId: ACTIVITY,
    operation: "delivery.no-ship",
    semanticMarkdown: "# No ship\n\nClose after separately managed Atlas changed.\n",
    repository: currentRepository,
    contract: fixture.contract,
    authorityHome: fixture.home,
    authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
    startedAt: "2026-08-29T18:00:01.000Z",
    authorizedAt: AUTHORIZED,
    expiresAt: null,
    nonce: "nonce-repository-movement-no-ship",
    verifiedAt: VERIFIED,
    runtimeId: RUNTIME,
  });

  assert.deepEqual(retained.subject.repository, Object.freeze({
    ...repository,
    checkBindingSetDigest: digestCanonical(fixture.contract.checkBindings),
  }));
  assert.deepEqual(retained.subject.selectedControl, [{
    relation: "selects-boundary",
    target: {
      kind: "work-boundary",
      id: boundary.id,
      revision: boundary.revision,
      digest: boundary.digest,
    },
  }]);
});

test("Director Decision no-ship still refuses a selected Boundary for another target", async (context) => {
  const fixture = await authorityFixture();
  context.after(async () => rm(fixture.home, { recursive: true, force: true }));
  const boundary = Object.freeze({
    id: "boundary-wrong-target",
    revision: 1,
    digest: digest("boundary-wrong-target"),
  });
  const exact = retainedRevision("work-boundary", boundary);
  const wrongTarget = Object.freeze({
    ...exact,
    payload: Object.freeze({ ...exact.payload, targetId: "target-substitution" }),
  });
  await assert.rejects(compileDirectorDecisionOpening({
    store: fakeStore({
      operation: "delivery.no-ship",
      standing: "framing",
      historicalBoundary: boundary,
      revisions: [wrongTarget],
    }),
    activityId: ACTIVITY,
    operation: "delivery.no-ship",
    semanticMarkdown: "# No ship\n\nRefuse a substituted historical Boundary.\n",
    repository,
    contract: fixture.contract,
    authorityHome: fixture.home,
    authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
    startedAt: "2026-08-29T18:00:01.000Z",
    authorizedAt: AUTHORIZED,
    expiresAt: null,
    nonce: "nonce-wrong-target-no-ship",
    verifiedAt: VERIFIED,
    runtimeId: RUNTIME,
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-director-decision.boundary");
});

function acceptanceFixture() {
  const boundary = retainedRevision("work-boundary", { id: "basis", revision: 1, digest: digest("basis") });
  const fixture = evidenceFixtureV7({ boundaryBasis: boundary.payload.basis as ControlJsonObject });
  retainEvidencePacket({
    store: fixture.store,
    activityId: fixture.activityId,
    observation: EVIDENCE_OBSERVATION_V7,
    runtimeId: RUNTIME,
  });
  fixture.completeEvaluation();
  return fixture;
}

test("Director Decision compiler derives the complete acceptance Control selection", async (context) => {
  const fixture = await authorityFixture(SECRET, "target-evidence-packet");
  context.after(async () => rm(fixture.home, { recursive: true, force: true }));
  const { store } = acceptanceFixture();
  const retained = await compileDirectorDecisionOpening({
    store,
    activityId: ACTIVITY,
    operation: "delivery.accept",
    semanticMarkdown: "# Accept\n\nAccept the exact evidenced Candidate.\n",
    repository,
    contract: fixture.contract,
    authorityHome: fixture.home,
    authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
    startedAt: "2026-08-29T18:00:22.000Z",
    authorizedAt: "2026-08-29T18:00:23.000Z",
    expiresAt: "2026-08-29T19:00:00.000Z",
    nonce: "nonce-accept-decision",
    verifiedAt: "2026-08-29T18:00:24.000Z",
    runtimeId: RUNTIME,
  });

  assert.equal(retained.subject.decision, "accept");
  assert.equal(retained.subject.repository.canonicalCommit, repository.canonicalCommit);
  assert.deepEqual(
    retained.subject.selectedControl.map(({ target: selected }) => selected.kind),
    ["work-boundary", "candidate-revision", "evidence-packet", "candidate-seal"],
  );
  assert.deepEqual(
    retained.revision.relationships.map(({ relation }) => relation),
    ["selects-boundary", "selects-candidate", "selects-evidence", "selects-seal"],
  );
});

test("Director Decision acceptance authenticates the exact historical Boundary basis", async (context) => {
  const fixture = await authorityFixture(SECRET, "target-evidence-packet");
  context.after(async () => rm(fixture.home, { recursive: true, force: true }));
  const retained = await compileDirectorDecisionOpening({
    store: acceptanceFixture().store,
    activityId: ACTIVITY,
    operation: "delivery.accept",
    semanticMarkdown: "# Accept\n\nAccept the exact Candidate from the admitted repository basis.\n",
    repository: Object.freeze({ ...repository, atlasStateDigest: digest("later-atlas") }),
    contract: fixture.contract,
    authorityHome: fixture.home,
    authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
    startedAt: "2026-08-29T18:00:22.000Z",
    authorizedAt: "2026-08-29T18:00:23.000Z",
    expiresAt: null,
    nonce: "nonce-historical-basis-accept",
    verifiedAt: "2026-08-29T18:00:24.000Z",
    runtimeId: RUNTIME,
  });
  assert.equal(retained.acceptanceBasis?.status,"justified");
  assert.equal(retained.acceptanceBasis?.directorSubject,"matches");
  assert.equal(retained.acceptanceBasis?.acceptanceSubject.parentCommit,retained.subject.repository.canonicalCommit);
  assert.equal(Object.hasOwn(retained.revision.payload,"acceptanceBasis"),false);
  assert.equal(Object.hasOwn(retained.subject,"acceptanceBasis"),false);
  assert.equal(retained.subject.repository.atlasStateDigest, repository.atlasStateDigest);
  assert.equal(retained.subject.repository.canonicalCommit, repository.canonicalCommit);
});

test("Acceptance subject construction rechecks exact current subjects after the review gate and before signing", async (context) => {
  const authority = await authorityFixture(SECRET, "target-evidence-packet");
  context.after(async () => rm(authority.home, { recursive: true, force: true }));
  for (const subject of ["candidate", "seal", "materialCondition"] as const) {
    const fixture = acceptanceFixture();
    let state = fixture.store.state();
    const store = Object.assign(Object.create(fixture.store) as ControlRecordStore, { state: () => state });
    let signerCalls = 0;
    let reviewCalls = 0;
    await assert.rejects(compileOpeningWithSigner({
      store,
      activityId: ACTIVITY,
      operation: "delivery.accept",
      semanticMarkdown: "# Accept\n\nAccept the exact evidenced Candidate.\n",
      repository,
      contract: authority.contract,
      startedAt: "2026-08-29T18:00:22.000Z",
      authorizedAt: "2026-08-29T18:00:23.000Z",
      expiresAt: null,
      nonce: `nonce-changed-${subject}`,
      verifiedAt: "2026-08-29T18:00:24.000Z",
      runtimeId: RUNTIME,
      beforeAuthenticate: async () => {
        reviewCalls += 1;
        state = Object.freeze({
          ...state,
          subjects: Object.freeze({
            ...state.subjects,
            [subject]: Object.freeze({ id: `changed-${subject}`, revision: 1, digest: digest(`changed-${subject}`) }),
          }),
        });
      },
      authenticateSubject: async () => {
        signerCalls += 1;
        throw new Error("Substituted acceptance subjects must never reach the signer");
      },
    }), (error: unknown) => error instanceof FoundationError && error.code ===
      (subject === "materialCondition" ? "lifecycle.evidence.current-material-condition" : `lifecycle.evidence.wrong-${subject}`));
    assert.equal(reviewCalls, 1, subject);
    assert.equal(signerCalls, 0, subject);
    assert.equal(fixture.appended.length, 2, "Only the fixture Evidence and completion exist");
  }
});

test("Director Decision compiler refuses a mismatched repository trust basis before signing", async (context) => {
  const fixture = await authorityFixture();
  context.after(async () => rm(fixture.home, { recursive: true, force: true }));
  await assert.rejects(compileDirectorDecisionOpening({
    store: fakeStore({ operation: "delivery.no-ship", standing: "framing" }),
    activityId: ACTIVITY,
    operation: "delivery.no-ship",
    semanticMarkdown: "# No ship\n\nStop without a Candidate.\n",
    repository: { ...repository, repositoryContractDigest: digest("wrong-contract") },
    contract: fixture.contract,
    authorityHome: fixture.home,
    authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
    startedAt: "2026-08-29T18:00:01.000Z",
    authorizedAt: AUTHORIZED,
    expiresAt: null,
    nonce: "nonce-wrong-repository",
    verifiedAt: VERIFIED,
    runtimeId: RUNTIME,
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-director-decision.repository");
});


test("Director custody authenticates once with exact secret bytes and hides unavailable key custody", async (context) => {
  const secret = `${SECRET}\n`;
  const fixture = await authorityFixture(secret);
  context.after(async () => rm(fixture.home, { recursive: true, force: true }));
  const store = fakeStore({ operation: "delivery.no-ship", standing: "framing" });
  const input = {
    store,
    activityId: ACTIVITY,
    operation: "delivery.no-ship" as const,
    semanticMarkdown: "# No ship\n\nClose the exact unadmitted Delivery.\n",
    repository,
    contract: fixture.contract,
    authorityHome: fixture.home,
    startedAt: "2026-08-29T18:00:01.000Z",
    authorizedAt: AUTHORIZED,
    expiresAt: null,
    nonce: "nonce-custody-exact-secret",
    verifiedAt: VERIFIED,
    runtimeId: RUNTIME,
  };
  const wrongPurpose = receiveFoundationAuthorityCredential(secret, "initialize");
  await assert.rejects(compileDirectorDecisionOpening({ ...input, authorityCredential: wrongPurpose }), /exact purpose/u);
  discardFoundationAuthorityCredential(wrongPurpose);
  const trimmed = receiveFoundationAuthorityCredential(secret.trimEnd(), "director-decision");
  await assert.rejects(compileDirectorDecisionOpening({ ...input, authorityCredential: trimmed }), /cannot unlock/u);
  assert.throws(() => assertFoundationAuthorityCredential(trimmed, "director-decision"), /live credential/u);
  const credential = receiveFoundationAuthorityCredential(secret, "director-decision");
  assert.equal(Object.isFrozen(credential), true);
  assert.equal(Object.getPrototypeOf(credential), null);
  assert.deepEqual(Reflect.ownKeys(credential), []);
  assert.equal(JSON.stringify(credential), "{}");
  const signed = await compileDirectorDecisionOpening({ ...input, authorityCredential: credential });
  assert.equal(signed.subject.operation, "delivery.no-ship");
  assert.throws(() => assertFoundationAuthorityCredential(credential, "director-decision"), /live credential/u);
  await assert.rejects(compileDirectorDecisionOpening({ ...input, authorityCredential: credential }), /live credential/u);
  const missingHome = join(fixture.home, "missing-private-key-root");
  await assert.rejects(compileDirectorDecisionOpening({
    ...input,
    authorityHome: missingHome,
    authorityCredential: receiveFoundationAuthorityCredential(secret, "director-decision"),
  }), (error: unknown) => {
    assert.ok(error instanceof FoundationError);
    assert.equal(error.code, "lifecycle.authority.private-key");
    assert.equal(error.observedFacts, undefined);
    assert.equal(JSON.stringify(error).includes(missingHome), false);
    assert.equal(JSON.stringify(error).includes(secret), false);
    return true;
  });
});
