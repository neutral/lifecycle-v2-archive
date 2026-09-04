import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  dirname,
  join,
} from "node:path";
import test from "node:test";
import {
  publishCandidateRevisionCarrierFromGitTree,
} from "../../src/foundation/candidate/carrier-binding.js";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
} from "../../src/foundation/candidate/carrier-types.js";
import {
  observeCandidateRevisionCarrierState,
  type CandidateRevisionCarrierAdmittedContext,
} from "../../src/foundation/candidate/carrier-state-observer.js";
import {
  FOUNDATION_DELIVERY_CANDIDATE_SEALER_V1,
  sealDeliveryCandidate,
} from "../../src/foundation/candidate/sealer.js";
import {
  FOUNDATION_PROVIDER_PROTOCOL,
  FOUNDATION_REPOSITORY_SCHEMA,
  FOUNDATION_SPECIFICATION_REVISION,
  FOUNDATION_WORK_BOUNDARY_PAYLOAD_SCHEMA,
} from "../../src/foundation/constants.js";
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
  type ControlRecordStoreIdentity,
} from "../../src/foundation/control/types.js";
import type { CandidateRevisionState } from "../../src/foundation/control/candidate-revision.js";
import { FoundationError } from "../../src/foundation/error.js";
import { loadKnowledgeSet } from "../../src/foundation/knowledge/knowledge-set.js";
import type { ReducedDeliveryState } from "../../src/foundation/process/delivery-reducer.js";
import { git } from "../../src/foundation/repository/git.js";
import { initializeRepository } from "../../src/foundation/repository/initialize.js";
import {
  bindRepositorySnapshot,
  loadRepositoryEpoch,
} from "../../src/foundation/repository/snapshot.js";
import type {
  FoundationLoadedRepositoryEpoch,
  FoundationLoadedRepositorySnapshot,
  FoundationRepositoryContract,
} from "../../src/foundation/repository/types.js";
import { sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { writeMinimalAtlas } from "../helpers/atlas-fixture.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

const CREATED = "2026-08-29T19:00:00.000Z";
const DELIVERY = "delivery-candidate-sealer";
const SECRET = "candidate-sealer-test-secret-at-least-thirty-two-bytes";

async function write(root: string, path: string, contents: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), contents, "utf8");
}

function description(): string {
  const header = {
    schema: "lifecycle.knowledge-record.v1",
    kind: "description",
    id: "description.candidate-sealer",
    title: "Candidate sealer fixture",
    status: "current",
    revision: 1,
    supersedes: null,
    summary: "Own the complete Candidate sealer fixture source tree.",
    owners: ["founder"],
    sources: [],
    relationships: [],
    conflicts: [],
    tags: [],
    spec: {
      responsibility: "Own the Candidate sealer fixture source tree.",
      coverage: [{ path: "src", mode: "tree", role: "primary", exclude: [] }],
      behavior: ["exposes exact fixture values"],
      boundaries: ["contains no Delivery Control"],
      invariants: ["remains ordinary tracked source"],
      dependencies: [],
      failure: ["an observed source path is missing or substituted"],
      rationale: ["one Description owns the fixture tree"],
    },
  };
  return `---\n${JSON.stringify(header, null, 2)}\n---\n\n# Candidate sealer fixture\n\n## Responsibility\n\nOwn the source fixture.\n\n## Behavior\n\nExpose exact values.\n\n## Boundaries\n\nNo Delivery Control.\n\n## Rationale\n\nKeep the test bounded.\n`;
}

type Fixture = Readonly<{
  target: string;
  machineHome: string;
  candidateSourceRoot: string;
  admitted: CandidateRevisionCarrierAdmittedContext;
  contract: FoundationRepositoryContract;
  loaded: FoundationLoadedRepositoryEpoch;
  snapshot: FoundationLoadedRepositorySnapshot;
}>;

async function fixture(): Promise<Fixture> {
  const target = await mkdtemp(join(tmpdir(), "lifecycle-candidate-sealer-target-"));
  const authorityHome = await mkdtemp(join(tmpdir(), "lifecycle-candidate-sealer-authority-"));
  const machineHome = await mkdtemp(join(tmpdir(), "lifecycle-candidate-sealer-home-"));
  await chmod(machineHome, 0o700);
  await git(target, ["init", "-b", "main"]);
  await git(target, ["config", "user.name", "Lifecycle Test"]);
  await git(target, ["config", "user.email", "lifecycle@example.invalid"]);
  await writeMinimalAtlas(target);
  await git(target, ["add", "--", "atlas"]);
  await git(target, ["commit", "-m", "Initialize target"]);
  await initializeRepository(target, {
    targetId: "candidate-sealer-target",
    founderPrincipal: "founder",
    home: authorityHome,
    authoritySecret: SECRET,
    publicationDigest: sha256Bytes("candidate-sealer-publication"),
    implementationRoots: ["src"],
    stage: true,
  });
  await write(target, "src/current.ts", "export const current = 1;\n");
  await write(target, "src/_source.desc.md", description());
  await git(target, ["add", "--", "."]);
  await git(target, ["commit", "-m", "Create Candidate base"]);
  const loaded = await loadRepositoryEpoch(target);
  const knowledge = await loadKnowledgeSet(loaded);
  const snapshot = await bindRepositorySnapshot(loaded, knowledge);
  const admitted: CandidateRevisionCarrierAdmittedContext = Object.freeze({
    repository: loaded.repository,
    contract: loaded.contract,
    epoch: loaded.epoch,
    productStateDigest: loaded.productState.digest,
    knowledgeSetDigest: snapshot.snapshot.knowledgeSetDigest,
    atlasState: loaded.atlasState,
    atlas: loaded.atlas,
  });
  const candidateSourceRoot = await mkdtemp(join(
    tmpdir(),
    "lifecycle-candidate-sealer-source-",
  ));
  await git(target, [
    "clone",
    "--no-local",
    "--no-hardlinks",
    target,
    candidateSourceRoot,
  ]);
  return Object.freeze({
    target,
    machineHome,
    candidateSourceRoot,
    admitted,
    contract: loaded.contract,
    loaded,
    snapshot,
  });
}

function ref(revision: ControlRecordRevision) {
  return Object.freeze({
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function fakeStore(input: Readonly<{
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
  history?: readonly ControlRecordRevision[];
  carrierManifest: Readonly<{
    descriptor: ControlRecordFile;
    bytes: Uint8Array;
  }>;
}>): Readonly<{ store: ControlRecordStore; appended: ControlRecordStoreAppend[] }> {
  const identity: ControlRecordStoreIdentity = Object.freeze({
    schema: CONTROL_RECORD_STORE_SCHEMA,
    storeId: "store-candidate-sealer",
    targetId: "candidate-sealer-target",
    processKind: "delivery",
    processId: DELIVERY,
    createdAt: CREATED,
  });
  const revisions = new Map<string, ControlRecordRevision>();
  for (const revision of [
    ...(input.history ?? []),
    input.boundary,
    input.candidate,
  ]) {
    revisions.set(`${revision.recordId}\u0000${revision.revision}`, revision);
  }
  const appended: ControlRecordStoreAppend[] = [];
  let sequence = 0;
  let predecessorDigest: ReturnType<typeof sha256Bytes> | null = null;
  const state: ReducedDeliveryState = Object.freeze({
    standing: "active",
    candidateCondition: "in-progress",
    activities: Object.freeze([Object.freeze({
      id: "activity-evaluate",
      operation: "delivery.evaluate" as const,
      family: "agent" as const,
      stage: "started" as const,
      recovery: null,
    })]),
    subjects: Object.freeze({
      proposedBoundary: null,
      activeBoundary: ref(input.boundary),
      candidate: ref(input.candidate),
      materialCondition: null,
      seal: null,
      evidence: null,
      closure: null,
    }),
    journal: Object.freeze({ eventCount: 0, headDigest: null }),
    eligibleOperations: Object.freeze([]),
  });
  const store = {
    identity,
    state: () => state,
    getRevision(recordId: string, revision: number) {
      return revisions.get(`${recordId}\u0000${revision}`) ?? null;
    },
    async readRetainedFile(digest: ReturnType<typeof sha256Bytes>) {
      return digest === input.carrierManifest.descriptor.digest
        ? Object.freeze({
            descriptor: input.carrierManifest.descriptor,
            bytes: Uint8Array.from(input.carrierManifest.bytes),
          })
        : null;
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
      if (revision !== null) revisions.set(`${revision.recordId}\u0000${revision.revision}`, revision);
      return Object.freeze({ revision, event });
    },
  } as unknown as ControlRecordStore;
  return Object.freeze({ store, appended });
}

type BoundaryArtifact = Readonly<{
  id: string;
  path: string;
  role: string;
  mustChange: boolean;
}>;

const CURRENT_SOURCE_ARTIFACT: BoundaryArtifact = Object.freeze({
  id: "artifact-current-source",
  path: "src/current.ts",
  role: "code",
  mustChange: true,
});

function boundary(
  value: Fixture,
  artifact: BoundaryArtifact = CURRENT_SOURCE_ARTIFACT,
): ControlRecordRevision {
  return compileControlRecordRevision(DELIVERY, {
    recordId: "boundary-candidate-sealer",
    recordKind: "work-boundary",
    revision: 1,
    producer: { kind: "runtime", id: "foundation-runtime" },
    semanticAuthor: { kind: "runtime", id: "foundation-runtime" },
    semanticAuthority: "runtime-derived",
    createdAt: CREATED,
    semanticMarkdown: "# Work Boundary\n",
    payload: {
      schema: FOUNDATION_WORK_BOUNDARY_PAYLOAD_SCHEMA,
      profileId: "lifecycle.work-boundary.foundation-v1",
      targetId: value.contract.targetId,
      basis: {
        specificationRevision: FOUNDATION_SPECIFICATION_REVISION,
        repositoryContract: FOUNDATION_REPOSITORY_SCHEMA,
        providerAdapter: FOUNDATION_PROVIDER_PROTOCOL,
        productBaseCommit: value.loaded.epoch.commit,
        productBaseTree: value.loaded.epoch.tree,
        productStateDigest: value.loaded.productState.digest,
        atlasStateDigest: value.loaded.atlasState.digest,
        atlasResolutionDigest: value.loaded.atlas.resolution.digest,
        atlasNormalizedModelDigest: value.loaded.atlas.resolution.normalizedModelDigest,
        atlasResourceBindingsDigest: value.loaded.atlas.resolution.resourceBindingsDigest,
        repositoryContractDigest: value.contract.digest,
        knowledgeSetDigest: value.snapshot.snapshot.knowledgeSetDigest,
        repositorySnapshotDigest: value.snapshot.snapshot.digest,
      },
      mandate: {
        artifacts: [artifact],
      },
    },
    relationships: [],
  });
}

function candidateRevision(
  selectedBoundary: ControlRecordRevision,
  state: CandidateRevisionState,
  candidateBaseCommit: string,
  carrierManifest: ControlRecordFile,
): ControlRecordRevision {
  return compileControlRecordRevision(DELIVERY, {
    recordId: "candidate-candidate-sealer",
    recordKind: "candidate-revision",
    revision: 1,
    producer: { kind: "runtime", id: "foundation-runtime" },
    semanticAuthor: { kind: "runtime", id: "foundation-runtime" },
    semanticAuthority: "runtime-observed",
    createdAt: CREATED,
    semanticMarkdown: "# Candidate Revision\n",
    payload: {
      ...validDeliveryControlPayload("candidate-revision"),
      candidateBaseCommit,
      carrierManifest: {
        digest: carrierManifest.digest,
        byteLength: carrierManifest.byteLength,
        mediaType: carrierManifest.mediaType,
        purpose: carrierManifest.purpose,
      },
      state,
    },
    relationships: [{
      relation: "governed-by",
      target: { kind: "work-boundary", ...ref(selectedBoundary) },
    }],
  });
}

async function retainedFixture(
  input: Fixture,
  artifact: BoundaryArtifact = CURRENT_SOURCE_ARTIFACT,
): Promise<Readonly<{
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
  store: ControlRecordStore;
  appended: ControlRecordStoreAppend[];
}>> {
  const selectedBoundary = boundary(input, artifact);
  await git(input.candidateSourceRoot, ["add", "-A", "--", "."]);
  const rootTree = (await git(input.candidateSourceRoot, ["write-tree"])).stdout.trim();
  const published = await publishCandidateRevisionCarrierFromGitTree({
    machineHome: input.machineHome,
    repository: input.candidateSourceRoot,
    rootTree,
  });
  const observed = await observeCandidateRevisionCarrierState({
    machineHome: input.machineHome,
    manifestBytes: published.manifestBytes,
    admitted: input.admitted,
    predecessor: null,
  });
  const carrierManifest = compileControlRecordFile({
    bytes: published.manifestBytes,
    mediaType: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
    purpose: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
    createdAt: CREATED,
  });
  const candidate = candidateRevision(
    selectedBoundary,
    observed.state,
    input.loaded.epoch.commit,
    carrierManifest,
  );
  await rm(input.candidateSourceRoot, { recursive: true, force: true });
  return Object.freeze({ boundary: selectedBoundary, candidate, ...fakeStore({
    boundary: selectedBoundary,
    candidate,
    carrierManifest: Object.freeze({
      descriptor: carrierManifest,
      bytes: published.manifestBytes,
    }),
  }) });
}

test("Candidate sealer reproduces the current revision and retains one exact Seal", async () => {
  const value = await fixture();
  await writeFile(join(value.candidateSourceRoot, "src/current.ts"), "export const current = 2;\n", "utf8");
  const retained = await retainedFixture(value);
  const result = await sealDeliveryCandidate({
    store: retained.store,
    activityId: "activity-evaluate",
    machineHome: value.machineHome,
    targetRepository: value.target,
    contract: value.contract,
    sealedAt: CREATED,
    runtimeId: "foundation-runtime",
  });
  assert.equal(result.revision.recordKind, "candidate-seal");
  assert.equal(result.event.eventKind, "candidate-sealed");
  assert.equal(result.revision.payload.schema, "lifecycle.candidate-seal-payload.v2");
  assert.equal(result.revision.payload.carrierIntegrity, "verified");
  assert.equal(result.revision.payload.carrierReconstruction, "verified");
  assert.equal(Object.hasOwn(result.revision.payload, "writeFreeze"), false);
  assert.equal(result.revision.payload.sealer instanceof Object, true);
  assert.equal(
    (result.revision.payload.sealer as { implementationId: string }).implementationId,
    FOUNDATION_DELIVERY_CANDIDATE_SEALER_V1.id,
  );
  assert.equal(retained.appended.length, 1);
});

test("Candidate sealer preserves a readmission rebind's historical predecessor fact", async () => {
  const value = await fixture();
  await writeFile(join(value.candidateSourceRoot, "src/current.ts"), "export const current = 2;\n", "utf8");
  const retained = await retainedFixture(value);
  assert.equal(retained.candidate.payload.state instanceof Object, true);
  assert.equal(
    (retained.candidate.payload.state as { unchangedFromPredecessor: boolean })
      .unchangedFromPredecessor,
    false,
  );

  const successorBoundary = compileControlRecordRevision(DELIVERY, {
    recordId: retained.boundary.recordId,
    recordKind: "work-boundary",
    revision: retained.boundary.revision + 1,
    producer: retained.boundary.producer,
    semanticAuthor: retained.boundary.semanticAuthor,
    semanticAuthority: retained.boundary.semanticAuthority,
    createdAt: "2026-08-29T19:00:01.000Z",
    semanticMarkdown: retained.boundary.semanticMarkdown,
    payload: retained.boundary.payload,
    relationships: retained.boundary.relationships,
  });
  const rebound = compileControlRecordRevision(DELIVERY, {
    recordId: retained.candidate.recordId,
    recordKind: "candidate-revision",
    revision: retained.candidate.revision + 1,
    producer: retained.candidate.producer,
    semanticAuthor: retained.candidate.semanticAuthor,
    semanticAuthority: retained.candidate.semanticAuthority,
    createdAt: "2026-08-29T19:00:01.000Z",
    semanticMarkdown: retained.candidate.semanticMarkdown,
    payload: {
      ...retained.candidate.payload,
      observation: "readmission-rebind",
    },
    relationships: [{
      relation: "governed-by",
      target: { kind: "work-boundary", ...ref(successorBoundary) },
    }, {
      relation: "revises",
      target: { kind: "candidate-revision", ...ref(retained.candidate) },
    }],
  });
  const carrierReference = retained.candidate.payload.carrierManifest as {
    digest: ReturnType<typeof sha256Bytes>;
  };
  const carrierManifest = await retained.store.readRetainedFile(
    carrierReference.digest,
  );
  assert.notEqual(carrierManifest, null);
  if (carrierManifest === null) throw new Error("Candidate Carrier fixture must be retained");
  const reboundStore = fakeStore({
    boundary: successorBoundary,
    candidate: rebound,
    history: [retained.boundary, retained.candidate],
    carrierManifest,
  });

  const result = await sealDeliveryCandidate({
    store: reboundStore.store,
    activityId: "activity-evaluate",
    machineHome: value.machineHome,
    targetRepository: value.target,
    contract: value.contract,
    sealedAt: "2026-08-29T19:00:02.000Z",
    runtimeId: "foundation-runtime",
  });
  assert.equal(result.revision.recordKind, "candidate-seal");
  assert.equal(result.revision.payload.carrierReconstruction, "verified");
});

test("Candidate sealer authorizes a required directory's descendants but no adjacent path", async (t) => {
  const directoryArtifact: BoundaryArtifact = Object.freeze({
    id: "artifact-feature-tree",
    path: "src/feature",
    role: "code",
    mustChange: true,
  });

  await t.test("directory descendants", async () => {
    const value = await fixture();
    await write(value.candidateSourceRoot, "src/feature/current.ts", "export const feature = 1;\n");
    await write(value.candidateSourceRoot, "src/feature/nested/proof.ts", "export const proof = true;\n");
    const retained = await retainedFixture(value, directoryArtifact);
    const result = await sealDeliveryCandidate({
      store: retained.store,
      activityId: "activity-evaluate",
      machineHome: value.machineHome,
      targetRepository: value.target,
      contract: value.contract,
      sealedAt: CREATED,
      runtimeId: "foundation-runtime",
    });
    assert.equal(result.revision.recordKind, "candidate-seal");
  });

  await t.test("adjacent changed path", async () => {
    const value = await fixture();
    await write(value.candidateSourceRoot, "src/feature/current.ts", "export const feature = 1;\n");
    await writeFile(join(value.candidateSourceRoot, "src/current.ts"), "export const current = 2;\n", "utf8");
    const retained = await retainedFixture(value, directoryArtifact);
    await assert.rejects(sealDeliveryCandidate({
      store: retained.store,
      activityId: "activity-evaluate",
      machineHome: value.machineHome,
      targetRepository: value.target,
      contract: value.contract,
      sealedAt: CREATED,
      runtimeId: "foundation-runtime",
    }), (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.candidate-sealer.path-unauthorized");
  });
});

test("Candidate sealer uses Carrier continuity and Carrier observation rejects Atlas changes", async (t) => {
  await t.test("discarded authoring source", async () => {
    const value = await fixture();
    await writeFile(join(value.candidateSourceRoot, "src/current.ts"), "export const current = 2;\n", "utf8");
    const retained = await retainedFixture(value);
    await writeFile(join(value.target, "src/current.ts"), "export const unrelated = 3;\n", "utf8");
    const result = await sealDeliveryCandidate({
      store: retained.store,
      activityId: "activity-evaluate",
      machineHome: value.machineHome,
      targetRepository: value.target,
      contract: value.contract,
      sealedAt: CREATED,
      runtimeId: "foundation-runtime",
    });
    assert.equal(result.revision.payload.carrierReconstruction, "verified");
  });

  await t.test("read-only Atlas mutation", async () => {
    const value = await fixture();
    await writeFile(join(value.candidateSourceRoot, "src/current.ts"), "export const current = 2;\n", "utf8");
    await writeFile(join(value.candidateSourceRoot, "atlas/atlas.md"), "# Substituted Atlas\n", "utf8");
    await git(value.candidateSourceRoot, ["add", "-A", "--", "."]);
    const rootTree = (await git(value.candidateSourceRoot, ["write-tree"])).stdout.trim();
    const published = await publishCandidateRevisionCarrierFromGitTree({
      machineHome: value.machineHome,
      repository: value.candidateSourceRoot,
      rootTree,
    });
    await assert.rejects(observeCandidateRevisionCarrierState({
      machineHome: value.machineHome,
      manifestBytes: published.manifestBytes,
      admitted: value.admitted,
      predecessor: null,
    }), (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.candidate.carrier-state-invalid" &&
      error.message.includes("Atlas"));
  });
});
