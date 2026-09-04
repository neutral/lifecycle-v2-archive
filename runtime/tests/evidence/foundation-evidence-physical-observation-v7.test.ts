import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  publishCandidateRevisionCarrierFromGitTree,
} from "../../src/foundation/candidate/carrier-binding.js";
import {
  importCandidateRevisionCarrierIntoRepository,
} from "../../src/foundation/candidate/carrier-import.js";
import {
  observeCandidateRevisionCarrierState,
  type CandidateRevisionCarrierAdmittedContext,
} from "../../src/foundation/candidate/carrier-state-observer.js";
import {
  openCandidateRevisionCarrier,
} from "../../src/foundation/candidate/carrier-store.js";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
} from "../../src/foundation/candidate/carrier-types.js";
import {
  FOUNDATION_PROVIDER_PROTOCOL,
  FOUNDATION_REPOSITORY_SCHEMA,
  FOUNDATION_SPECIFICATION_REVISION,
  FOUNDATION_WORK_BOUNDARY_PAYLOAD_SCHEMA,
} from "../../src/foundation/constants.js";
import { compileControlRecordRevision } from "../../src/foundation/control/model.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlJsonObject,
  type ControlRecordRelationship,
  type ControlRecordRevision,
} from "../../src/foundation/control/types.js";
import {
  createFoundationEvaluationEvidenceObservationOwnerV7,
  FOUNDATION_EVIDENCE_PHYSICAL_OBSERVER_V7,
  observeFoundationEvaluationEvidenceV7,
  observeFoundationReviewerProjectionCandidateV7,
  withFoundationReviewerProjectionCandidateRepositoryV7,
} from "../../src/foundation/evidence/physical-observation-v7.js";
import { FoundationError } from "../../src/foundation/error.js";
import type { FoundationEvaluationObservationContextV7 } from "../../src/foundation/process/evaluation-finalization-v7.js";
import { loadKnowledgeSet } from "../../src/foundation/knowledge/knowledge-set.js";
import { git, gitBytes } from "../../src/foundation/repository/git.js";
import { initializeRepository } from "../../src/foundation/repository/initialize.js";
import {
  bindRepositorySnapshot,
  loadRepositoryEpoch,
} from "../../src/foundation/repository/snapshot.js";
import type {
  FoundationGitTreeEntry,
  FoundationRepositoryContract,
} from "../../src/foundation/repository/types.js";
import {
  digestCanonical,
  sha256Bytes,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";
import { writeMinimalAtlas } from "../helpers/atlas-fixture.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

const SECRET = "evidence-physical-observation-test-secret-at-least-thirty-two-bytes";
const PUBLICATION_DIGEST = sha256Bytes("evidence-physical-observation-publication");
const DELIVERY = "delivery-evidence-physical-observation-v7";
const ACTIVITY = "activity-evidence-physical-observation-v7";
const CREATED = "2026-08-29T21:00:00.000Z";

async function write(root: string, path: string, contents: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), contents, "utf8");
}

function description(): string {
  const frontMatter = {
    schema: "lifecycle.knowledge-record.v1",
    kind: "description",
    id: "description.evidence-observer",
    title: "Evidence observer fixture",
    status: "current",
    revision: 1,
    supersedes: null,
    summary: "Own the governed implementation used by physical Evidence tests.",
    owners: ["founder"],
    sources: [],
    relationships: [],
    conflicts: [],
    tags: [],
    spec: {
      responsibility: "Own the physical Evidence fixture implementation.",
      coverage: [{ path: "src", mode: "tree", role: "primary", exclude: [] }],
      behavior: ["exposes one exact implementation value"],
      boundaries: ["contains no Delivery Control"],
      invariants: ["remains an ordinary tracked implementation"],
      dependencies: [],
      failure: ["the exact implementation subject cannot be reproduced"],
      rationale: ["one Description keeps the fixture explicit"],
    },
  };
  return `---\n${JSON.stringify(frontMatter, null, 2)}\n---\n\n# Evidence observer fixture\n\n## Responsibility\n\nOwn the fixture.\n\n## Behavior\n\nExpose one value.\n\n## Boundaries\n\nNo Delivery Control.\n\n## Rationale\n\nKeep the fixture bounded.\n`;
}

function relationship(relation: string, target: ControlRecordRevision): ControlRecordRelationship {
  return Object.freeze({
    relation,
    target: Object.freeze({
      kind: target.recordKind,
      id: target.recordId,
      revision: target.revision,
      digest: target.digest,
    }),
  });
}

function revision(input: Readonly<{
  id: string;
  kind: string;
  revision?: number;
  payload: ControlJsonObject;
  relationships?: readonly ControlRecordRelationship[];
}>): ControlRecordRevision {
  return compileControlRecordRevision(DELIVERY, {
    recordId: input.id,
    recordKind: input.kind,
    revision: input.revision ?? 1,
    producer: Object.freeze({ kind: "runtime", id: "runtime-v7" }),
    semanticAuthor: Object.freeze({ kind: "runtime", id: "runtime-v7" }),
    semanticAuthority: "runtime-observed",
    createdAt: CREATED,
    semanticMarkdown: `# ${input.kind}\n`,
    payload: input.payload,
    relationships: input.relationships ?? Object.freeze([]),
  });
}

type Fixture = Readonly<{
  target: string;
  machineHome: string;
  carrierArtifactRoot: string;
  carrierManifestBytes: Uint8Array;
  candidateTreeEntries: readonly FoundationGitTreeEntry[];
  contract: FoundationRepositoryContract;
  store: ControlRecordStore;
  boundary: ControlRecordRevision;
  candidateRevision: ControlRecordRevision;
  seal: ControlRecordRevision;
  context: FoundationEvaluationObservationContextV7;
}>;

async function fixture(options: Readonly<{
  directoryArtifact?: boolean;
  candidateChange?: "modified" | "deleted";
  readmissionRebind?: boolean;
}> = {}): Promise<Fixture> {
  const target = await mkdtemp(join(tmpdir(), "lifecycle-evidence-observer-target-"));
  const authorityHome = await mkdtemp(join(tmpdir(), "lifecycle-evidence-observer-authority-"));
  const machineHome = await mkdtemp(join(tmpdir(), "lifecycle-evidence-observer-home-"));
  await chmod(machineHome, 0o700);
  await git(target, ["init", "-b", "main"]);
  await git(target, ["config", "user.name", "Lifecycle Test"]);
  await git(target, ["config", "user.email", "lifecycle@example.invalid"]);
  await writeMinimalAtlas(target);
  await write(target, ".gitignore", "node_modules/\n");
  await git(target, ["add", "--", "atlas", ".gitignore"]);
  await git(target, ["commit", "-m", "Initialize target"]);
  await initializeRepository(target, {
    targetId: "evidence-observer-target",
    founderPrincipal: "founder",
    home: authorityHome,
    authoritySecret: SECRET,
    publicationDigest: PUBLICATION_DIGEST,
    implementationRoots: ["src"],
    stage: true,
  });
  await write(target, "src/current.ts", "export const current = 1;\n");
  await write(target, "src/_source.desc.md", description());
  await git(target, ["add", "--", "."]);
  await git(target, ["commit", "-m", "Create governed Candidate base"]);
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
    "lifecycle-evidence-observer-source-",
  ));
  await git(target, [
    "clone",
    "--no-local",
    "--no-hardlinks",
    target,
    candidateSourceRoot,
  ]);
  if (options.candidateChange === "deleted") {
    await rm(join(candidateSourceRoot, "src"), { recursive: true });
  } else {
    await writeFile(join(candidateSourceRoot, "src/current.ts"), "export const current = 2;\n", "utf8");
  }
  await git(candidateSourceRoot, ["add", "-A", "--", "."]);
  const rootTree = (await git(candidateSourceRoot, ["write-tree"])).stdout.trim();
  const carrier = await publishCandidateRevisionCarrierFromGitTree({
    machineHome,
    repository: candidateSourceRoot,
    rootTree,
  });
  const observed = await observeCandidateRevisionCarrierState({
    machineHome,
    manifestBytes: carrier.manifestBytes,
    admitted,
    predecessor: null,
  });
  const openedCarrier = await openCandidateRevisionCarrier({
    machineHome,
    manifestBytes: carrier.manifestBytes,
  });
  const carrierManifest = Object.freeze({
    digest: sha256Bytes(carrier.manifestBytes),
    byteLength: carrier.manifestBytes.byteLength,
    mediaType: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
    purpose: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
  });

  const boundary = revision({
    id: "work-boundary-evidence-observer",
    kind: "work-boundary",
    payload: Object.freeze({
      schema: FOUNDATION_WORK_BOUNDARY_PAYLOAD_SCHEMA,
      profileId: "lifecycle.work-boundary.foundation-v1",
      targetId: loaded.contract.targetId,
      basis: Object.freeze({
        specificationRevision: FOUNDATION_SPECIFICATION_REVISION,
        repositoryContract: FOUNDATION_REPOSITORY_SCHEMA,
        providerAdapter: FOUNDATION_PROVIDER_PROTOCOL,
        productBaseCommit: loaded.epoch.commit,
        productBaseTree: loaded.epoch.tree,
        productStateDigest: loaded.productState.digest,
        atlasStateDigest: loaded.atlasState.digest,
        atlasResolutionDigest: loaded.atlas.resolution.digest,
        atlasNormalizedModelDigest: loaded.atlas.resolution.normalizedModelDigest,
        atlasResourceBindingsDigest: loaded.atlas.resolution.resourceBindingsDigest,
        repositoryContractDigest: loaded.contract.digest,
        knowledgeSetDigest: snapshot.snapshot.knowledgeSetDigest,
        repositorySnapshotDigest: snapshot.snapshot.digest,
      }),
      mandate: Object.freeze({
        artifacts: Object.freeze([
          Object.freeze({
            id: "artifact.description",
            path: "src/_source.desc.md",
            role: "description",
            mustChange: false,
            obligationIds: Object.freeze(["obligation.description"]),
          }),
          Object.freeze({
            id: "artifact.source",
            path: "src/current.ts",
            role: "code",
            mustChange: true,
            obligationIds: Object.freeze(["obligation.source"]),
          }),
          ...(options.directoryArtifact ? [Object.freeze({
            id: "artifact.source-tree",
            path: "src",
            role: "code",
            mustChange: true,
            obligationIds: Object.freeze(["obligation.source-tree"]),
          })] : []),
        ]),
      }),
    }),
  });
  const predecessorCandidateRevision = revision({
    id: "candidate-revision-evidence-observer",
    kind: "candidate-revision",
    payload: Object.freeze({
      ...validDeliveryControlPayload("candidate-revision"),
      observation: options.readmissionRebind ? "builder-successor" : "initialization",
      candidateBaseCommit: loaded.epoch.commit,
      carrierManifest,
      state: observed.state as unknown as ControlJsonObject,
    }),
    relationships: Object.freeze([relationship("governed-by", boundary)]),
  });
  const candidateRevision = options.readmissionRebind
    ? revision({
        id: predecessorCandidateRevision.recordId,
        kind: "candidate-revision",
        revision: predecessorCandidateRevision.revision + 1,
        payload: Object.freeze({
          ...predecessorCandidateRevision.payload,
          observation: "readmission-rebind",
        }),
        relationships: Object.freeze([
          relationship("governed-by", boundary),
          relationship("revises", predecessorCandidateRevision),
        ]),
      })
    : predecessorCandidateRevision;
  const seal = revision({
    id: "candidate-seal-evidence-observer",
    kind: "candidate-seal",
    payload: Object.freeze({
      schema: "lifecycle.candidate-seal-payload.v2",
      carrierIntegrity: "verified",
      carrierReconstruction: "verified",
      evaluationSubject: "established",
      candidateReobservation: "exact-match",
      untrackedProduct: "absent",
      controlExclusion: "verified",
    }),
    relationships: Object.freeze([
      relationship("seals", candidateRevision),
      relationship("governed-by", boundary),
    ]),
  });
  const attempt = revision({
    id: "agent-attempt-evidence-observer",
    kind: "agent-attempt",
    payload: Object.freeze({
      ...validDeliveryControlPayload("agent-attempt"),
      activityId: "activity-evaluate-evidence-observer",
      operation: "delivery.evaluate",
      role: "reviewer",
      invocationId: "invocation-evaluate-evidence-observer",
    }),
  });
  const workProduct = revision({
    id: "agent-work-product-evidence-observer",
    kind: "agent-work-product",
    payload: Object.freeze({ schema: "lifecycle.agent-work-product-payload.v2" }),
  });
  const receipt = revision({
    id: "execution-receipt-evidence-observer",
    kind: "execution-receipt",
    payload: Object.freeze({
      ...validDeliveryControlPayload("execution-receipt"),
      activityId: "activity-evaluate-evidence-observer",
      role: "reviewer",
    }),
  });
  const retained = new Map([
    boundary,
    predecessorCandidateRevision,
    candidateRevision,
    seal,
    attempt,
    workProduct,
    receipt,
  ].map((value) => [`${value.recordId}\u0000${value.revision}`, value] as const));
  const journalHead = sha256Bytes("evidence-observer-journal-head");
  await rm(candidateSourceRoot, { recursive: true, force: true });
  const store = {
    identity: Object.freeze({
      schema: CONTROL_RECORD_STORE_SCHEMA,
      storeId: "store-evidence-physical-observation-v7",
      targetId: loaded.contract.targetId,
      processKind: "delivery",
      processId: DELIVERY,
      createdAt: CREATED,
    }),
    getRevision(id: string, selectedRevision: number) {
      return retained.get(`${id}\u0000${selectedRevision}`) ?? null;
    },
    async readRetainedFile(selected: Sha256) {
      return selected === carrierManifest.digest
        ? Object.freeze({
            descriptor: Object.freeze({
              ...carrierManifest,
              createdAt: CREATED,
            }),
            bytes: Uint8Array.from(carrier.manifestBytes),
          })
        : null;
    },
    state() {
      return Object.freeze({
        standing: "active" as const,
        candidateCondition: "under-evaluation" as const,
        activities: Object.freeze([]),
        subjects: Object.freeze({
          proposedBoundary: null,
          activeBoundary: Object.freeze(referenceValue(boundary)),
          candidate: Object.freeze(referenceValue(candidateRevision)),
          materialCondition: null,
          seal: Object.freeze(referenceValue(seal)),
          evidence: null,
          closure: null,
        }),
        journal: Object.freeze({ eventCount: 1, headDigest: journalHead }),
        eligibleOperations: Object.freeze([]),
      });
    },
  } as unknown as ControlRecordStore;
  const context: FoundationEvaluationObservationContextV7 = Object.freeze({
    store,
    activityId: ACTIVITY,
    boundary,
    candidate: candidateRevision,
    seal,
    attempt,
    workProduct,
    receipt,
  });
  return Object.freeze({
    target,
    machineHome,
    carrierArtifactRoot: dirname(openedCarrier.artifactPath),
    carrierManifestBytes: Uint8Array.from(carrier.manifestBytes),
    candidateTreeEntries: observed.treeEntries,
    contract: loaded.contract,
    store,
    boundary,
    candidateRevision,
    seal,
    context,
  });
}

function referenceValue(value: ControlRecordRevision): Readonly<{
  id: string;
  revision: number;
  digest: Sha256;
}> {
  return Object.freeze({ id: value.recordId, revision: value.revision, digest: value.digest });
}

async function physicalState(value: Fixture): Promise<Readonly<{
  verificationEntries: readonly string[];
  targetHead: string;
  targetStatus: string;
  targetIndex: Buffer;
  targetRefs: string;
}>> {
  const [
    targetHead,
    targetStatus,
    targetIndex,
    targetRefs,
  ] = await Promise.all([
    git(value.target, ["rev-parse", "HEAD"]),
    git(value.target, ["status", "--porcelain=v1", "--untracked-files=all"]),
    gitBytes(value.target, ["ls-files", "--stage", "-z"]),
    git(value.target, ["for-each-ref", "--format=%(refname)%00%(objectname)"]),
  ]);
  return Object.freeze({
    verificationEntries: Object.freeze(await readdir(join(
      value.machineHome,
      "candidate-revision-carriers",
      "v1",
      "verification",
    ))),
    targetHead: targetHead.stdout,
    targetStatus: targetStatus.stdout,
    targetIndex: targetIndex.stdout,
    targetRefs: targetRefs.stdout,
  });
}

test("reviewer Projection observation reproduces one exact sealed Candidate without mutation", async () => {
  const value = await fixture();
  const before = await physicalState(value);
  const observed = await observeFoundationReviewerProjectionCandidateV7({
    store: value.store,
    boundary: value.boundary,
    candidateRevision: value.candidateRevision,
    seal: value.seal,
    machineHome: value.machineHome,
    targetRepository: value.target,
    contract: value.contract,
  });
  assert.equal(observed.candidate.digest, value.candidateRevision.digest);
  assert.equal(observed.seal.digest, value.seal.digest);
  assert.equal(observed.knowledge.manifest.digest, (value.candidateRevision.payload.state as ControlJsonObject).knowledgeSetDigest);
  assert.equal(observed.diff.digest, (value.candidateRevision.payload.state as ControlJsonObject).diffDigest);
  assert.equal(sha256Bytes(observed.diff.bytes), observed.diff.digest);
  assert.equal(observed.treeEntries.some(({ path }) => path === "src/current.ts"), true);
  assert.deepEqual(await physicalState(value), before);
});

test("reviewer Candidate repository scope is removed on success and preserves callback failure", async () => {
  const value = await fixture();
  const before = await physicalState(value);
  const candidateState = value.candidateRevision.payload.state as ControlJsonObject;
  let successRepository = "";
  const candidateDigest = await withFoundationReviewerProjectionCandidateRepositoryV7({
    store: value.store,
    boundary: value.boundary,
    candidateRevision: value.candidateRevision,
    seal: value.seal,
    machineHome: value.machineHome,
    targetRepository: value.target,
    contract: value.contract,
  }, async (repository, observation) => {
    successRepository = repository;
    assert.equal(
      (await git(repository, ["cat-file", "-t", String(candidateState.tree)])).stdout.trim(),
      "tree",
    );
    assert.equal(observation.candidate.digest, value.candidateRevision.digest);
    assert((await readdir(join(
      value.machineHome,
      "candidate-revision-carriers",
      "v1",
      "verification",
    ))).length > 0);
    return observation.candidate.digest;
  });
  assert.equal(candidateDigest, value.candidateRevision.digest);
  await assert.rejects(lstat(successRepository), { code: "ENOENT" });
  assert.deepEqual(await physicalState(value), before);

  const callbackFailure = new Error("exact reviewer repository callback failure");
  let failedRepository = "";
  await assert.rejects(
    withFoundationReviewerProjectionCandidateRepositoryV7({
      store: value.store,
      boundary: value.boundary,
      candidateRevision: value.candidateRevision,
      seal: value.seal,
      machineHome: value.machineHome,
      targetRepository: value.target,
      contract: value.contract,
    }, async (repository) => {
      failedRepository = repository;
      throw callbackFailure;
    }),
    (error: unknown) => error === callbackFailure,
  );
  await assert.rejects(lstat(failedRepository), { code: "ENOENT" });
  assert.deepEqual(await physicalState(value), before);
});

test("reviewer Candidate repository scope refuses retained Carrier substitution after use", async () => {
  const value = await fixture();
  let operationCompleted = false;
  await assert.rejects(
    withFoundationReviewerProjectionCandidateRepositoryV7({
      store: value.store,
      boundary: value.boundary,
      candidateRevision: value.candidateRevision,
      seal: value.seal,
      machineHome: value.machineHome,
      targetRepository: value.target,
      contract: value.contract,
    }, async (repository, observation) => {
      assert.equal(
        (await git(repository, ["cat-file", "-t", observation.treeEntries[0]!.objectId]))
          .stdout.trim(),
        observation.treeEntries[0]!.type,
      );
      await rm(value.carrierArtifactRoot, { recursive: true, force: false });
      operationCompleted = true;
    }),
    (error: unknown) => {
      assert.equal(operationCompleted, true);
      assert(error instanceof FoundationError);
      assert.equal(
        error.code,
        "lifecycle.evidence-physical-observation-v7.reviewer-projection",
      );
      assert.equal(
        (error.observedFacts as Readonly<Record<string, unknown>>).causeCode,
        "lifecycle.candidate.carrier-state-unavailable",
      );
      const serialized = JSON.stringify(error.toJSON());
      assert.equal(serialized.includes(value.target), false);
      assert.equal(serialized.includes(value.machineHome), false);
      return true;
    },
  );
  assert.deepEqual(await readdir(join(
    value.machineHome,
    "candidate-revision-carriers",
    "v1",
    "verification",
  )), []);
});

test("reviewer Projection accepts a readmission rebind's historical predecessor fact", async () => {
  const value = await fixture({ readmissionRebind: true });
  assert.equal(
    (value.candidateRevision.payload.state as ControlJsonObject).unchangedFromPredecessor,
    false,
  );
  const observed = await observeFoundationReviewerProjectionCandidateV7({
    store: value.store,
    boundary: value.boundary,
    candidateRevision: value.candidateRevision,
    seal: value.seal,
    machineHome: value.machineHome,
    targetRepository: value.target,
    contract: value.contract,
  });
  assert.equal(observed.candidate.digest, value.candidateRevision.digest);
  assert.equal(observed.seal.digest, value.seal.digest);
});

test("Evidence observation derives deterministic artifact, Description, and read-only reviewer facts", async () => {
  const value = await fixture();
  const owner = createFoundationEvaluationEvidenceObservationOwnerV7({
    machineHome: value.machineHome,
    targetRepository: value.target,
    contract: value.contract,
  });
  const observed = await owner(value.context);
  assert.equal(observed.reviewerSubjectDisposition, "exact-read-only");
  assert.equal(observed.diagnostics, undefined);
  assert.deepEqual(observed.artifacts.map(({ artifactId }) => artifactId), [
    "artifact.description",
    "artifact.source",
  ]);
  assert.deepEqual(observed.artifacts[0], {
    artifactId: "artifact.description",
    fileKind: "file",
    existence: "present",
    change: "unchanged",
    contentDigest: sha256Bytes(description()),
    manifestDigest: null,
    schemaValidation: "valid",
    semanticValidation: "valid",
    limitationIds: [],
    state: "satisfied",
  });
  assert.deepEqual(observed.artifacts[1], {
    artifactId: "artifact.source",
    fileKind: "file",
    existence: "present",
    change: "modified",
    contentDigest: sha256Bytes("export const current = 2;\n"),
    manifestDigest: null,
    schemaValidation: "not-required",
    semanticValidation: "not-required",
    limitationIds: [],
    state: "satisfied",
  });
  assert.equal(observed.descriptionCoverage.length, 1);
  assert.deepEqual(observed.descriptionCoverage[0], {
    path: "src/current.ts",
    descriptionId: "description.evidence-observer",
    selector: observed.descriptionCoverage[0]!.selector,
    ownership: "exact",
    implementationChange: "changed",
    descriptionChange: "unchanged",
    exclusionChange: "none",
    obligationIds: ["obligation.source"],
    state: "satisfied",
  });
  assert.match(observed.descriptionCoverage[0]!.selector!, /^description-selector\.[a-f0-9]{64}$/u);
  assert.match(FOUNDATION_EVIDENCE_PHYSICAL_OBSERVER_V7.implementationDigest, /^sha256:[a-f0-9]{64}$/u);
});

test("directory artifacts bind an exact manifest, descendant change, and Description obligations", async () => {
  const value = await fixture({ directoryArtifact: true });
  const before = await physicalState(value);
  const observed = await observeFoundationEvaluationEvidenceV7({
    ...value.context,
    machineHome: value.machineHome,
    targetRepository: value.target,
    contract: value.contract,
  });
  const directory = observed.artifacts.find(({ artifactId }) =>
    artifactId === "artifact.source-tree");
  assert.notEqual(directory, undefined);
  const expectedManifestDigest = digestCanonical(value.candidateTreeEntries
    .filter(({ path }) => path.startsWith("src/"))
    .map(({ path, mode, type, objectId }) => Object.freeze({
      path: path.slice("src/".length),
      mode,
      type,
      objectId,
    })));
  assert.deepEqual(directory, {
    artifactId: "artifact.source-tree",
    fileKind: "directory",
    existence: "present",
    change: "modified",
    contentDigest: null,
    manifestDigest: expectedManifestDigest,
    schemaValidation: "not-required",
    semanticValidation: "not-required",
    limitationIds: [],
    state: "satisfied",
  });
  assert.deepEqual(observed.descriptionCoverage[0]!.obligationIds, [
    "obligation.source",
    "obligation.source-tree",
  ]);
  assert.deepEqual(await physicalState(value), before);
});

test("deleted directory artifacts report deletion rather than unchanged absence", async () => {
  const value = await fixture({ directoryArtifact: true, candidateChange: "deleted" });
  const observed = await observeFoundationEvaluationEvidenceV7({
    ...value.context,
    machineHome: value.machineHome,
    targetRepository: value.target,
    contract: value.contract,
  });
  const directory = observed.artifacts.find(({ artifactId }) =>
    artifactId === "artifact.source-tree");
  assert.equal(directory?.fileKind, "absent");
  assert.equal(directory?.existence, "absent");
  assert.equal(directory?.change, "deleted");
  assert.equal(directory?.state, "failed");
});

test("Carrier-based Evidence ignores mutable canonical checkout bytes", async () => {
  const value = await fixture();
  await writeFile(join(value.target, "src/current.ts"), "export const current = 3;\n", "utf8");
  const observed = await observeFoundationEvaluationEvidenceV7({
    ...value.context,
    machineHome: value.machineHome,
    targetRepository: value.target,
    contract: value.contract,
  });
  assert.equal(observed.reviewerSubjectDisposition, "exact-read-only");
  assert.equal(observed.artifacts.find(({ artifactId }) => artifactId === "artifact.source")!.contentDigest,
    sha256Bytes("export const current = 2;\n"));
  assert.equal(observed.diagnostics, undefined);
  assert.deepEqual(await readdir(join(
    value.machineHome,
    "candidate-revision-carriers",
    "v1",
    "verification",
  )), []);
});

test("missing Carrier refuses Evidence without falling back to cached Git objects", async () => {
  const value = await fixture();
  const state = value.candidateRevision.payload.state as ControlJsonObject;
  await importCandidateRevisionCarrierIntoRepository({
    machineHome: value.machineHome,
    manifestBytes: value.carrierManifestBytes,
    repository: value.target,
    expectedRootTree: String(state.tree),
  });
  assert.equal(
    (await git(value.target, ["cat-file", "-t", String(state.tree)])).stdout.trim(),
    "tree",
    "the canonical Git database deliberately retains a coincidental Candidate object cache",
  );
  await rm(value.carrierArtifactRoot, { recursive: true, force: false });
  for (const operation of [
    () => observeFoundationEvaluationEvidenceV7({
      ...value.context,
      machineHome: value.machineHome,
      targetRepository: value.target,
      contract: value.contract,
    }),
    () => observeFoundationReviewerProjectionCandidateV7({
      store: value.store,
      boundary: value.boundary,
      candidateRevision: value.candidateRevision,
      seal: value.seal,
      machineHome: value.machineHome,
      targetRepository: value.target,
      contract: value.contract,
    }),
  ]) {
    await assert.rejects(operation, (error: unknown) => {
      assert(error instanceof FoundationError);
      assert.match(error.code, /^lifecycle\.evidence-physical-observation-v7\./u);
      const serialized = JSON.stringify(error.toJSON());
      assert.equal(serialized.includes(value.target), false);
      assert.equal(serialized.includes(value.machineHome), false);
      return true;
    });
  }
});
