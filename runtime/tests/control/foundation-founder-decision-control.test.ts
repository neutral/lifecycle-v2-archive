import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  compileFounderAuthorizationReviewCore,
  compileFounderDecisionOpening,
  type FounderDecisionRepositoryBasis,
} from "../../src/foundation/control/founder-decision.js";
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
import {
  createFoundationAuthority,
} from "../../src/foundation/repository/authority.js";
import type { FoundationRepositoryContract } from "../../src/foundation/repository/types.js";
import type { ReducedDeliveryState } from "../../src/foundation/process/delivery-reducer.js";
import {
  digestCanonical,
  sha256Bytes,
} from "../../src/foundation/validation/canonical.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

const CREATED = "2026-08-29T18:00:00.000Z";
const AUTHORIZED = "2026-08-29T18:00:02.000Z";
const VERIFIED = "2026-08-29T18:00:03.000Z";
const TARGET = "target-founder-decision";
const PROCESS = "delivery-founder-decision";
const ACTIVITY = "activity-founder-decision";
const RUNTIME = "foundation-runtime";
const SECRET = "correct horse battery staple authority secret";

function digest(value: string) {
  return sha256Bytes(value);
}

const repository: FounderDecisionRepositoryBasis = Object.freeze({
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
    schema: "lifecycle.control-record-revision.v1",
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
    storeId: "store-founder-decision",
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

async function authorityFixture() {
  const home = await mkdtemp(join(tmpdir(), "lifecycle-founder-decision-"));
  const authority = await createFoundationAuthority(home, TARGET, SECRET, "founder:demo");
  const contract = Object.freeze({
    targetId: TARGET,
    digest: repository.repositoryContractDigest,
    authority,
    checkBindings: Object.freeze([]),
  }) as unknown as FoundationRepositoryContract;
  return { home, contract } as const;
}

test("Founder authorization review is deterministic, immutable, self-digested, and non-authorizing", async (context) => {
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

  const first = compileFounderAuthorizationReviewCore(input);
  const second = compileFounderAuthorizationReviewCore(input);
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

test("Founder authorization review digest changes with every reviewed authority basis", async (context) => {
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
      principalId: "founder:alternate",
    }),
  }) as FoundationRepositoryContract;
  const variants = [
    compileFounderAuthorizationReviewCore(baseInput),
    compileFounderAuthorizationReviewCore({
      ...baseInput,
      semanticMarkdown: "# No ship\n\nStop this different Delivery consequence.\n",
    }),
    compileFounderAuthorizationReviewCore({
      ...baseInput,
      store: fakeStore({ operation: "delivery.no-ship", standing: "active" }),
    }),
    compileFounderAuthorizationReviewCore({
      ...baseInput,
      store: fakeStore({
        operation: "delivery.no-ship",
        standing: "framing",
        historicalBoundary: boundary,
        revisions: [retainedRevision("work-boundary", boundary)],
      }),
    }),
    compileFounderAuthorizationReviewCore({
      ...baseInput,
      repository: Object.freeze({
        ...repository,
        canonicalCommit: "c".repeat(40),
        productStateDigest: digest("changed-product-state"),
      }),
    }),
    compileFounderAuthorizationReviewCore({
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
  assert.equal(variants[5]!.authority.principalId, "founder:alternate");
});

test("Founder authorization review refuses a Store basis that changes during derivation", async (context) => {
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

  assert.throws(() => compileFounderAuthorizationReviewCore({
    store: changingStore,
    operation: "delivery.no-ship",
    semanticMarkdown: "# No ship\n\nRefuse a moving review basis.\n",
    repository,
    contract: fixture.contract,
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-founder-decision.stale-review");
  assert.equal(stateReads, 2);
});

test("signed Founder Decision subject exactly projects the reviewed core plus authentication mechanics", async (context) => {
  const fixture = await authorityFixture();
  context.after(async () => rm(fixture.home, { recursive: true, force: true }));
  const store = fakeStore({ operation: "delivery.no-ship", standing: "framing" });
  const semanticMarkdown = "# No ship\n\nReconnaissance did not establish a coherent boundary.\n";
  const reviewed = compileFounderAuthorizationReviewCore({
    store,
    operation: "delivery.no-ship",
    semanticMarkdown,
    repository,
    contract: fixture.contract,
  });
  const retained = await compileFounderDecisionOpening({
    store,
    activityId: ACTIVITY,
    operation: "delivery.no-ship",
    semanticMarkdown,
    repository,
    contract: fixture.contract,
    authorityHome: fixture.home,
    authoritySecret: SECRET,
    startedAt: "2026-08-29T18:00:01.000Z",
    authorizedAt: AUTHORIZED,
    expiresAt: null,
    nonce: "nonce-reviewed-founder-decision",
    verifiedAt: VERIFIED,
    runtimeId: RUNTIME,
  });

  assert.deepEqual(retained.authorizationReview, reviewed);
  assert.deepEqual(retained.subject, {
    schema: "lifecycle.founder-decision-subject.v3",
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
    nonce: "nonce-reviewed-founder-decision",
    candidateDisposition: reviewed.candidateDisposition,
  });
  assert.notEqual(
    retained.authorizationReview.authorizationReviewDigest,
    retained.revision.payload.subjectDigest,
  );
});

test("Founder Decision compiler signs and retains exact early no-ship authority", async (context) => {
  const fixture = await authorityFixture();
  context.after(async () => rm(fixture.home, { recursive: true, force: true }));
  const retained = await compileFounderDecisionOpening({
    store: fakeStore({ operation: "delivery.no-ship", standing: "framing" }),
    activityId: ACTIVITY,
    operation: "delivery.no-ship",
    semanticMarkdown: "# No ship\n\nReconnaissance did not establish a coherent boundary.\n",
    repository,
    contract: fixture.contract,
    authorityHome: fixture.home,
    authoritySecret: SECRET,
    startedAt: "2026-08-29T18:00:01.000Z",
    authorizedAt: AUTHORIZED,
    expiresAt: null,
    nonce: "nonce-founder-decision",
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
  assert.equal(retained.revision.semanticAuthority, "founder-authenticated");
  assert.equal(retained.decisionAppend.event.eventKind, "founder-decision-authenticated");
});

test("Founder Decision no-ship retains the latest established Boundary after failed preparation", async (context) => {
  const fixture = await authorityFixture();
  context.after(async () => rm(fixture.home, { recursive: true, force: true }));
  const boundary = Object.freeze({
    id: "boundary-failed-preparation",
    revision: 1,
    digest: digest("failed-preparation-boundary"),
  });
  const retained = await compileFounderDecisionOpening({
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
    authoritySecret: SECRET,
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

test("Founder Decision no-ship authenticates its established historical Boundary regardless of later repository movement", async (context) => {
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
  const retained = await compileFounderDecisionOpening({
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
    authoritySecret: SECRET,
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

test("Founder Decision no-ship still refuses a selected Boundary for another target", async (context) => {
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
  await assert.rejects(compileFounderDecisionOpening({
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
    authoritySecret: SECRET,
    startedAt: "2026-08-29T18:00:01.000Z",
    authorizedAt: AUTHORIZED,
    expiresAt: null,
    nonce: "nonce-wrong-target-no-ship",
    verifiedAt: VERIFIED,
    runtimeId: RUNTIME,
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-founder-decision.boundary");
});

test("Founder Decision compiler derives the complete acceptance Control selection", async (context) => {
  const fixture = await authorityFixture();
  context.after(async () => rm(fixture.home, { recursive: true, force: true }));
  const boundary = Object.freeze({ id: "boundary-current", revision: 1, digest: digest("boundary") });
  const candidate = Object.freeze({ id: "candidate-current", revision: 3, digest: digest("candidate") });
  const seal = Object.freeze({ id: "seal-current", revision: 1, digest: digest("seal") });
  const evidence = Object.freeze({ id: "evidence-current", revision: 1, digest: digest("evidence") });
  const store = fakeStore({
    operation: "delivery.accept",
    standing: "decision-ready",
    subjects: { activeBoundary: boundary, candidate, seal, evidence },
    revisions: [
      retainedRevision("work-boundary", boundary),
      retainedRevision("candidate-revision", candidate),
      retainedRevision("candidate-seal", seal),
      retainedRevision("evidence-packet", evidence),
    ],
  });
  const retained = await compileFounderDecisionOpening({
    store,
    activityId: ACTIVITY,
    operation: "delivery.accept",
    semanticMarkdown: "# Accept\n\nAccept the exact evidenced Candidate.\n",
    repository,
    contract: fixture.contract,
    authorityHome: fixture.home,
    authoritySecret: SECRET,
    startedAt: "2026-08-29T18:00:01.000Z",
    authorizedAt: AUTHORIZED,
    expiresAt: "2026-08-29T19:00:00.000Z",
    nonce: "nonce-accept-decision",
    verifiedAt: VERIFIED,
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

test("Founder Decision acceptance authenticates the exact historical Boundary basis", async (context) => {
  const fixture = await authorityFixture();
  context.after(async () => rm(fixture.home, { recursive: true, force: true }));
  const boundary = Object.freeze({ id: "boundary-historical", revision: 1, digest: digest("boundary-historical") });
  const candidate = Object.freeze({ id: "candidate-historical", revision: 3, digest: digest("candidate-historical") });
  const seal = Object.freeze({ id: "seal-historical", revision: 1, digest: digest("seal-historical") });
  const evidence = Object.freeze({ id: "evidence-historical", revision: 1, digest: digest("evidence-historical") });
  const retained = await compileFounderDecisionOpening({
    store: fakeStore({
      operation: "delivery.accept",
      standing: "decision-ready",
      subjects: { activeBoundary: boundary, candidate, seal, evidence },
      revisions: [
        retainedRevision("work-boundary", boundary),
        retainedRevision("candidate-revision", candidate),
        retainedRevision("candidate-seal", seal),
        retainedRevision("evidence-packet", evidence),
      ],
    }),
    activityId: ACTIVITY,
    operation: "delivery.accept",
    semanticMarkdown: "# Accept\n\nAccept the exact Candidate from the admitted repository basis.\n",
    repository: Object.freeze({ ...repository, atlasStateDigest: digest("later-atlas") }),
    contract: fixture.contract,
    authorityHome: fixture.home,
    authoritySecret: SECRET,
    startedAt: "2026-08-29T18:00:01.000Z",
    authorizedAt: AUTHORIZED,
    expiresAt: null,
    nonce: "nonce-historical-basis-accept",
    verifiedAt: VERIFIED,
    runtimeId: RUNTIME,
  });
  assert.equal(retained.subject.repository.atlasStateDigest, repository.atlasStateDigest);
  assert.equal(retained.subject.repository.canonicalCommit, repository.canonicalCommit);
});

test("Founder Decision compiler refuses a mismatched repository trust basis before signing", async (context) => {
  const fixture = await authorityFixture();
  context.after(async () => rm(fixture.home, { recursive: true, force: true }));
  await assert.rejects(compileFounderDecisionOpening({
    store: fakeStore({ operation: "delivery.no-ship", standing: "framing" }),
    activityId: ACTIVITY,
    operation: "delivery.no-ship",
    semanticMarkdown: "# No ship\n\nStop without a Candidate.\n",
    repository: { ...repository, repositoryContractDigest: digest("wrong-contract") },
    contract: fixture.contract,
    authorityHome: fixture.home,
    authoritySecret: SECRET,
    startedAt: "2026-08-29T18:00:01.000Z",
    authorizedAt: AUTHORIZED,
    expiresAt: null,
    nonce: "nonce-wrong-repository",
    verifiedAt: VERIFIED,
    runtimeId: RUNTIME,
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-founder-decision.repository");
});
