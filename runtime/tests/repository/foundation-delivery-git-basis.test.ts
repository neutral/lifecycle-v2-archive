import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { FOUNDATION_PROVIDER_PROTOCOL, FOUNDATION_REPOSITORY_SCHEMA, FOUNDATION_SPECIFICATION_REVISION } from "../../src/foundation/constants.js";
import { compileControlRecordRevision } from "../../src/foundation/control/model.js";
import { foundationIntegrationValidationFactsDigestV1, prepareIntegrationAssessmentRetentionV1 } from "../../src/foundation/control/integration-assessment.js";
import { deriveCandidateRevisionCarrierAdmittedContext } from "../../src/foundation/candidate/carrier-observation-context.js";
import { candidateRevisionCarrierVerifier, publishCandidateRevisionCarrierFromGitTree } from "../../src/foundation/candidate/carrier-binding.js";
import { observeCandidateRevisionCarrierState } from "../../src/foundation/candidate/carrier-state-observer.js";
import { foundationIntegrationMergeRuleV1 } from "../../src/foundation/candidate/integration-merge.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import type { ControlRecordRevision } from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import { loadKnowledgeSet } from "../../src/foundation/knowledge/knowledge-set.js";
import { receiveFoundationAuthorityCredential } from "../../src/foundation/repository/authority.js";
import { openFoundationDeliveryGitBasisV1, retainFoundationDeliveryGitCommitV1 } from "../../src/foundation/repository/delivery-git-basis.js";
import { git, gitCommonDirectory } from "../../src/foundation/repository/git.js";
import { assertIndependentGitRepository } from "../../src/foundation/repository/independent-git.js";
import { initializeRepository } from "../../src/foundation/repository/initialize.js";
import { bindRepositorySnapshot, loadRepositoryEpoch } from "../../src/foundation/repository/snapshot.js";
import { FOUNDATION_GENERATED_PUBLICATION_DIGEST } from "../../src/foundation/validation/generated-schemas.js";
import { sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { writeMinimalAtlas } from "../helpers/atlas-fixture.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

async function fixture(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-delivery-git-basis-")));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const target = join(root, "target");
  const home = join(root, "machine");
  await mkdir(target);
  await mkdir(home, { mode: 0o700 });
  await chmod(home, 0o700);
  await git(target, ["init", "-b", "main"]);
  await git(target, ["config", "user.name", "Lifecycle Test"]);
  await git(target, ["config", "user.email", "lifecycle@example.invalid"]);
  await writeMinimalAtlas(target);
  await git(target, ["add", "--", "atlas"]);
  await git(target, ["commit", "-m", "Author target context"]);
  const firstCommit = (await git(target, ["rev-parse", "HEAD"])).stdout.trim();
  await initializeRepository(target, {
    home,
    targetId: "git-basis-target",
    authorityCredential: receiveFoundationAuthorityCredential("git-basis-disposable-test-credential-only", "initialize"),
    publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
  });
  await git(target, ["commit", "-m", "Initialize exact target"]);
  await git(target, ["tag", "ambient-tag"]);
  const epoch = await loadRepositoryEpoch(target);
  const loaded = await bindRepositorySnapshot(epoch, await loadKnowledgeSet(epoch));
  const basis = {
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
    knowledgeSetDigest: loaded.snapshot.knowledgeSetDigest,
    repositorySnapshotDigest: loaded.snapshot.digest,
  };
  const boundary = compileControlRecordRevision("git-basis-delivery", {
    recordId: "git-basis-boundary", recordKind: "work-boundary", revision: 1,
    producer: { kind: "runtime", id: "runtime" }, semanticAuthor: { kind: "agent", id: "preparer" },
    semanticAuthority: "agent-proposed", createdAt: "2026-09-05T00:00:00.000Z",
    semanticMarkdown: "# Exact retained governing basis\n", relationships: [],
    payload: { ...validDeliveryControlPayload("work-boundary"), targetId: loaded.contract.targetId, basis },
  });
  // This seam supplies the Store's already-validated exact revision. Journal
  // legality and authorization remain the Control and Process owners' tests.
  const storeFor = (selected: ControlRecordRevision, processId = "git-basis-delivery") => Object.freeze({
    identity: Object.freeze({ targetId: loaded.contract.targetId, storeId: `${processId}-store`, processId }),
    getRevision: (id: string, revision: number) => id === selected.recordId && revision === selected.revision ? selected : null,
  }) as unknown as ControlRecordStore;
  const store = storeFor(boundary);
  const input = { machineHome: home, repository: target, store, boundary };
  return { root, target, home, firstCommit, loaded, basis, boundary, store, storeFor, input };
}

test("retained governing context stays usable after canonical movement, dirt, and garbage collection", async (t) => {
  const value = await fixture(t);
  const retained = await openFoundationDeliveryGitBasisV1(value.input);
  assert.notEqual(retained.repository, value.target);
  assert.equal(retained.loaded.snapshot.digest, value.loaded.snapshot.digest);
  assert.equal(retained.knowledge.manifest.digest, value.loaded.snapshot.knowledgeSetDigest);
  assert.equal(JSON.stringify(retained.loaded.snapshot).includes(value.home), false);
  assert.equal(JSON.stringify(retained.knowledge.manifest).includes(value.home), false);
  await assertIndependentGitRepository(retained.repository);
  assert.equal((await git(retained.repository, ["rev-list", "--count", "HEAD"])).stdout.trim(), "2");
  assert.equal((await git(retained.repository, ["cat-file", "-t", value.firstCommit])).stdout.trim(), "commit");

  await writeFile(join(value.target, "atlas/atlas.md"), "uncommitted canonical drift\n");
  assert.equal((await openFoundationDeliveryGitBasisV1(value.input)).repository, retained.repository);
  await git(value.target, ["checkout", "--orphan", "unrelated"]);
  await git(value.target, ["rm", "-rf", "--", "."]);
  await writeFile(join(value.target, "unrelated.txt"), "later canonical branch\n");
  await git(value.target, ["add", "--", "unrelated.txt"]);
  await git(value.target, ["commit", "-m", "Unrelated canonical replacement"]);
  await git(value.target, ["branch", "-D", "main"]);
  await git(value.target, ["tag", "-d", "ambient-tag"]);
  await git(value.target, ["reflog", "expire", "--expire=now", "--all"]);
  await git(value.target, ["gc", "--prune=now"]);
  assert.notEqual((await git(value.target, ["cat-file", "-e", value.loaded.epoch.commit], { allowFailure: true })).exitCode, 0);
  assert.equal((await openFoundationDeliveryGitBasisV1(value.input)).loaded.snapshot.digest, retained.loaded.snapshot.digest);
  assert.match(await readFile(join(retained.repository, "atlas/atlas.md"), "utf8"), /"type": "atlas"/u);
});

test("two Deliveries retain independent exact Git state without source refs, remotes, alternates, or hardlinks", async (t) => {
  const value = await fixture(t);
  const first = await openFoundationDeliveryGitBasisV1(value.input);
  const secondBoundary = compileControlRecordRevision("second-delivery", value.boundary);
  const secondStore = value.storeFor(secondBoundary, "second-delivery");
  const second = await openFoundationDeliveryGitBasisV1({ ...value.input, store: secondStore, boundary: secondBoundary });
  assert.notEqual(first.repository, second.repository);
  assert.notEqual(await gitCommonDirectory(first.repository), await gitCommonDirectory(second.repository));
  for (const retained of [first, second]) {
    assert.equal((await git(retained.repository, ["remote"])).stdout, "");
    assert.equal((await git(retained.repository, ["tag", "--list"])).stdout, "");
    await assert.rejects(stat(join(retained.repository, ".git/objects/info/alternates")), { code: "ENOENT" });
    await assert.rejects(stat(join(retained.repository, ".git/hooks")), { code: "ENOENT" });
    let inspectedObjects = 0;
    for (const entry of await readdir(join(retained.repository, ".git/objects/pack"))) {
      assert.equal((await stat(join(retained.repository, ".git/objects/pack", entry))).nlink, 1);
      inspectedObjects += 1;
    }
    for (const directory of await readdir(join(retained.repository, ".git/objects"))) {
      if (!/^[a-f0-9]{2}$/u.test(directory)) continue;
      for (const object of await readdir(join(retained.repository, ".git/objects", directory))) {
        assert.equal((await stat(join(retained.repository, ".git/objects", directory, object))).nlink, 1);
        inspectedObjects += 1;
      }
    }
    assert(inspectedObjects > 0);
  }
  await writeFile(join(first.repository, "first-only.txt"), "private disposable tool state\n");
  await assert.rejects(stat(join(second.repository, "first-only.txt")), { code: "ENOENT" });
});

test("retained support cannot replace the explicit commit, tree, or governing digest", async (t) => {
  const value = await fixture(t);
  const retained = await openFoundationDeliveryGitBasisV1(value.input);
  const changed = compileControlRecordRevision(value.boundary.processId, {
    ...value.boundary,
    payload: { ...value.boundary.payload, basis: { ...value.basis, knowledgeSetDigest: sha256Bytes("wrong Knowledge") } },
  });
  await assert.rejects(openFoundationDeliveryGitBasisV1({ ...value.input, store: value.storeFor(changed), boundary: changed }),
    (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.repository.git-basis-invalid");
  await assert.rejects(retainFoundationDeliveryGitCommitV1({
    machineHome: value.home, repository: value.target, identity: value.store.identity,
    commit: value.loaded.epoch.commit, tree: "a".repeat(value.loaded.epoch.tree.length),
    canonicalBranch: value.loaded.contract.canonicalBranch,
  }), (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.repository.git-basis-invalid");
  await git(retained.repository, ["update-ref", value.loaded.contract.canonicalBranch, value.firstCommit]);
  await assert.rejects(openFoundationDeliveryGitBasisV1(value.input),
    (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.repository.git-basis-invalid");
  assert.equal((await git(retained.repository, ["rev-parse", "HEAD"])).stdout.trim(), value.firstCommit);
});

test("application P controls physical contribution and protection while W retains its original B context", async (t) => {
  const value = await fixture(t);
  const atlasPath = join(value.target, "atlas/atlas.md");
  await writeFile(atlasPath, `${await readFile(atlasPath, "utf8")}\n<!-- Later Director-maintained Atlas source. -->\n`);
  await git(value.target, ["add", "--", "atlas/atlas.md"]);
  await git(value.target, ["commit", "-m", "Advance canonical Atlas outside Delivery"]);
  const parentEpoch = await loadRepositoryEpoch(value.target);
  const parent = await bindRepositorySnapshot(parentEpoch, await loadKnowledgeSet(parentEpoch));
  assert.notEqual(parent.atlasState.digest, value.loaded.atlasState.digest);
  const planned = await deriveCandidateRevisionCarrierAdmittedContext({ ...value.input, integrationParent: parent.snapshot });
  assert.equal(planned.epoch.commit, parent.epoch.commit);
  assert.equal(planned.governing.snapshot.commit, value.loaded.epoch.commit);
  const carrier = await publishCandidateRevisionCarrierFromGitTree({
    machineHome: value.home, repository: value.target, rootTree: parent.epoch.tree,
  });
  const observed = await candidateRevisionCarrierVerifier({
    machineHome: value.home, admitted: planned, predecessor: null,
  })({ manifestBytes: carrier.manifestBytes });
  assert.deepEqual(observed.state.changedSubjects, []);

  const reference = (revision: ControlRecordRevision) => ({
    kind: revision.recordKind, id: revision.recordId, revision: revision.revision, digest: revision.digest,
  });
  const candidate = compileControlRecordRevision(value.boundary.processId, {
    ...value.boundary, recordId: "continuing-candidate", recordKind: "candidate-revision",
    semanticAuthority: "runtime-observed", semanticAuthor: { kind: "runtime", id: "runtime" },
    payload: { ...validDeliveryControlPayload("candidate-revision"), observation: "initialization", candidateBaseCommit: value.loaded.epoch.commit },
    relationships: [{ relation: "governed-by", target: reference(value.boundary) }],
  });
  const records = [value.boundary, candidate];
  const store = Object.freeze({
    identity: value.store.identity,
    getRevision: (id: string, revision: number) => records.find((item) => item.recordId === id && item.revision === revision) ?? null,
  }) as unknown as ControlRecordStore;
  const assessment = prepareIntegrationAssessmentRetentionV1({
    store, activityId: "exact-integration", boundary: value.boundary, sourceCandidate: candidate, runtimeId: "runtime",
    payload: {
      schema: "lifecycle.integration-assessment-payload.v1", profileId: "lifecycle.integration-assessment.foundation-v1",
      canonicalParent: parent.snapshot, mergeRule: await foundationIntegrationMergeRuleV1(), outcome: "constructed", conflicts: [],
      validation: { complete: true, valid: true, diagnosticCodes: [], factsDigest: foundationIntegrationValidationFactsDigestV1(observed) },
      contextualApplicability: { disposition: "requires-readmission", changes: [{
        subject: "atlas", admittedDigest: value.loaded.atlasState.digest, parentDigest: parent.atlasState.digest,
      }] },
      assessedAt: "2026-09-05T00:00:01.000Z", limitations: [],
    },
  }).revision;
  records.push(assessment);
  const assessed = await deriveCandidateRevisionCarrierAdmittedContext({ ...value.input, store, integrationAssessment: assessment });
  assert.equal(assessed.epoch.commit, parent.epoch.commit);
  const integrated = compileControlRecordRevision(candidate.processId, {
    ...candidate, revision: 2, createdAt: "2026-09-05T00:00:02.000Z",
    payload: { ...candidate.payload, observation: "integration-successor", candidateBaseCommit: parent.epoch.commit,
      state: observed.state, observer: observed.observer,
      carrierManifest: { digest: observed.manifestFileDigest, byteLength: carrier.manifestBytes.byteLength,
        mediaType: "application/vnd.lifecycle.candidate-revision-carrier-manifest+json", purpose: "candidate-revision-carrier-manifest" } },
    relationships: [
      { relation: "governed-by", target: reference(value.boundary) },
      { relation: "revises", target: reference(candidate) },
      { relation: "integrated-from", target: reference(assessment) },
    ],
  });
  records.push(integrated);
  const builder = compileControlRecordRevision(candidate.processId, {
    ...integrated, revision: 3, createdAt: "2026-09-05T00:00:03.000Z", payload: { ...integrated.payload, observation: "builder-successor" },
    relationships: [
      { relation: "governed-by", target: reference(value.boundary) },
      { relation: "revises", target: reference(integrated) },
    ],
  });
  records.push(builder);
  const inherited = await deriveCandidateRevisionCarrierAdmittedContext({ ...value.input, store, candidate: builder });
  assert.equal(inherited.epoch.commit, parent.epoch.commit);
  assert.equal(inherited.governing.snapshot.commit, value.loaded.epoch.commit);

  await writeFile(atlasPath, `${await readFile(atlasPath, "utf8")}\n<!-- Delivery-authored mutation is prohibited. -->\n`);
  await git(value.target, ["add", "--", "atlas/atlas.md"]);
  const invalidTree = (await git(value.target, ["write-tree"])).stdout.trim();
  const invalidCarrier = await publishCandidateRevisionCarrierFromGitTree({
    machineHome: value.home, repository: value.target, rootTree: invalidTree,
  });
  await assert.rejects(observeCandidateRevisionCarrierState({
    machineHome: value.home, manifestBytes: invalidCarrier.manifestBytes, admitted: inherited, predecessor: null,
  }), (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.candidate.carrier-state-invalid" && error.message.includes("Atlas"));
});

test("Delivery work branch and exact Git history survive disposable Attempts while provider commits remain local", async (t) => {
  const value = await fixture(t);
  const { openFoundationDeliveryGitContextV1 } = await import("../../src/foundation/repository/delivery-git-context.js");
  const { materializeFoundationAgentGitContextV1, materializeFoundationAgentCandidateInputV1,
    exportFoundationAgentProductFilesV1 } = await import("../../src/util/execution-cell-runner-v1.js");
  const { openCandidateRevisionCarrier } = await import("../../src/foundation/candidate/carrier-store.js");
  const { canonicalJson } = await import("../../src/foundation/validation/canonical.js");
  const files = new Map<string, { descriptor: Record<string, unknown>; bytes: Uint8Array }>();
  const records = [value.boundary];
  const store = { identity: value.store.identity,
    getRevision: (id: string, revision: number) => records.find((item) => item.recordId === id && item.revision === revision) ?? null,
    readRetainedFile: async (digest: string) => files.get(digest) ?? null,
  } as unknown as ControlRecordStore;
  const ref = (revision: ControlRecordRevision) => ({ kind: revision.recordKind, id: revision.recordId, revision: revision.revision, digest: revision.digest });
  const candidateAt = async (tree: string, previous?: ControlRecordRevision, assessment?: ControlRecordRevision) => {
    const carrier = await publishCandidateRevisionCarrierFromGitTree({ machineHome: value.home, repository: value.target, rootTree: tree });
    const descriptor = { digest: sha256Bytes(carrier.manifestBytes), byteLength: carrier.manifestBytes.byteLength,
      mediaType: "application/vnd.lifecycle.candidate-revision-carrier-manifest+json", purpose: "candidate-revision-carrier-manifest" };
    files.set(descriptor.digest, { descriptor, bytes: carrier.manifestBytes });
    const sample = validDeliveryControlPayload("candidate-revision");
    const candidate = compileControlRecordRevision(value.boundary.processId, {
      ...value.boundary, recordId: "work-candidate", recordKind: "candidate-revision", revision: (previous?.revision ?? 0) + 1,
      createdAt: new Date(Date.parse(value.boundary.createdAt) + ((previous?.revision ?? 0) + 1) * 1000).toISOString(),
      semanticAuthority: "runtime-observed", semanticAuthor: { kind: "runtime", id: "runtime" },
      payload: { ...sample, observation: assessment ? "integration-successor" : previous ? "builder-successor" : "initialization",
        candidateBaseCommit: assessment ? (assessment.payload.canonicalParent as Record<string, unknown>).commit as string : previous?.payload.candidateBaseCommit ?? value.loaded.epoch.commit,
        carrierManifest: descriptor, state: { ...(sample.state as Record<string, never>), tree } },
      relationships: [{ relation: "governed-by", target: ref(value.boundary) },
        ...(previous ? [{ relation: "revises", target: ref(previous) }] : []),
        ...(assessment ? [{ relation: "integrated-from", target: ref(assessment) }] : [])],
    });
    records.push(candidate);
    return { candidate, carrier };
  };
  const initial = await candidateAt(value.loaded.epoch.tree);
  const first = await openFoundationDeliveryGitContextV1({ ...value.input, store, candidate: initial.candidate });
  assert.equal((await git(first.repository, ["symbolic-ref", "HEAD"])).stdout.trim(), first.manifest.branch);
  assert.equal((await git(first.repository, ["rev-list", "--count", first.manifest.tipCommit])).stdout.trim(), "3");
  assert.equal((await git(first.repository, ["tag", "--list"])).stdout, "");
  assert.equal((await git(first.repository, ["remote"])).stdout, "");

  // Resolution uses the same physical runner materializer as builder/reviewer,
  // while its separate named permission profile and Output contract remain read-only.
  const resolutionInput = join(value.root, "resolution-input");
  await mkdir(join(resolutionInput, "candidate"), { recursive: true });
  const openedCarrier = await openCandidateRevisionCarrier({ machineHome: value.home, manifestBytes: initial.carrier.manifestBytes });
  await writeFile(join(resolutionInput, "candidate/carrier-manifest.json"), initial.carrier.manifestBytes);
  await writeFile(join(resolutionInput, "candidate/carrier.pack"), await readFile(openedCarrier.artifactPath));
  await writeFile(join(resolutionInput, "candidate/git-context.json"), first.manifestBytes);
  await writeFile(join(resolutionInput, "candidate/git-context.pack"), first.artifactBytes);
  const resolutionSubjects = [
    { kind: "candidate-revision", id: initial.candidate.recordId, revision: initial.candidate.revision, digest: initial.candidate.digest },
    { kind: "candidate-revision-carrier-manifest", id: "frozen-carrier", revision: null, digest: sha256Bytes(initial.carrier.manifestBytes) },
    { kind: "delivery-git-context", id: "frozen-history", revision: null, digest: sha256Bytes(first.manifestBytes) },
  ];
  const resolutionWork = join(value.root, "resolution-work");
  await mkdir(resolutionWork);
  const frozen = await materializeFoundationAgentCandidateInputV1({
    role: "reconnaissance", inputRoot: resolutionInput, workingRoot: resolutionWork,
    maximumBytes: 64 * 1024 * 1024, inputSet: { subjects: resolutionSubjects },
  });
  assert(frozen !== null);
  await assertIndependentGitRepository(frozen);
  assert.equal((await git(frozen, ["symbolic-ref", "HEAD"])).stdout.trim(), first.manifest.branch);
  assert.equal((await git(frozen, ["rev-parse", "HEAD^{tree}"])).stdout.trim(), first.manifest.rootTree);
  assert.equal(await readFile(join(frozen, "atlas/atlas.md"), "utf8"), await readFile(join(value.target, "atlas/atlas.md"), "utf8"));
  for (const kind of ["candidate-revision", "candidate-revision-carrier-manifest"]) {
    const workingRoot = join(value.root, `resolution-wrong-${kind}`);
    await mkdir(workingRoot);
    await assert.rejects(materializeFoundationAgentCandidateInputV1({
      role: "reconnaissance", inputRoot: resolutionInput, workingRoot, maximumBytes: 64 * 1024 * 1024,
      inputSet: { subjects: resolutionSubjects.map((subject) => subject.kind === kind
        ? { ...subject, digest: sha256Bytes(`wrong-${kind}`) } : subject) },
    }), /(?:Delivery Git context differs|Candidate Carrier differs) from its exact/);
  }
  assert.equal(await materializeFoundationAgentCandidateInputV1({
    role: "reconnaissance", inputRoot: join(value.root, "initial-prepare-no-candidate"),
    workingRoot: join(value.root, "initial-prepare-work"), maximumBytes: 64 * 1024 * 1024, inputSet: { subjects: [] },
  }), null);

  const cell = async (name: string, selected: typeof first, carrier: typeof initial.carrier) => {
    const inputRoot = join(value.root, `${name}-input`);
    const repository = join(value.root, name);
    await mkdir(join(inputRoot, "candidate"), { recursive: true });
    await mkdir(repository);
    await writeFile(join(inputRoot, "candidate/git-context.json"), selected.manifestBytes);
    await writeFile(join(inputRoot, "candidate/git-context.pack"), selected.artifactBytes);
    await writeFile(join(inputRoot, "candidate/carrier-manifest.json"), carrier.manifestBytes);
    await materializeFoundationAgentGitContextV1({ inputRoot, repository, maximumBytes: 64 * 1024 * 1024,
      inputSet: { subjects: [
        { kind: "candidate-revision", id: selected.manifest.candidate.recordId, revision: selected.manifest.candidate.revision, digest: selected.manifest.candidate.digest },
        { kind: "delivery-git-context", id: "git-context", revision: selected.manifest.candidate.revision, digest: sha256Bytes(selected.manifestBytes) },
      ] },
    });
    return repository;
  };
  const attempt1 = await cell("attempt1", first, initial.carrier);
  await assertIndependentGitRepository(attempt1);
  assert.equal((await git(attempt1, ["rev-parse", "HEAD"])).stdout.trim(), first.manifest.tipCommit);
  assert.equal((await git(attempt1, ["symbolic-ref", "HEAD"])).stdout.trim(), first.manifest.branch);
  await writeFile(join(attempt1, "ordinary.txt"), "builder result\n");
  await git(attempt1, ["add", "--", "ordinary.txt"]);
  await git(attempt1, ["-c", "user.name=Provider Tool", "-c", "user.email=tool@example.invalid", "commit", "-m", "Disposable provider work"]);
  const providerCommit = (await git(attempt1, ["rev-parse", "HEAD"])).stdout.trim();
  const output = join(value.root, "product-output");
  const exported = await exportFoundationAgentProductFilesV1({ repository: attempt1, destination: output, maximumBytes: 64 * 1024 * 1024 });
  assert(exported.entries.some(({ path }) => path === "ordinary.txt"));
  assert.equal(exported.entries.some(({ path }) => path === ".git" || path.startsWith(".git/")), false);
  await assert.rejects(stat(join(output, ".git")), { code: "ENOENT" });
  assert.equal(await readFile(join(output, "ordinary.txt"), "utf8"), "builder result\n");
  await rm(attempt1, { recursive: true, force: true });
  const replay = await openFoundationDeliveryGitContextV1({ ...value.input, store, candidate: initial.candidate });
  assert.equal(replay.repository, first.repository);
  assert.equal(canonicalJson(replay.manifest), canonicalJson(first.manifest));
  assert.deepEqual(replay.artifactBytes, first.artifactBytes);
  const attempt2 = await cell("attempt2", replay, initial.carrier);
  assert.equal((await git(attempt2, ["rev-parse", "HEAD"])).stdout.trim(), first.manifest.tipCommit);
  assert.notEqual((await git(attempt2, ["cat-file", "-e", providerCommit], { allowFailure: true })).exitCode, 0);
  await assert.rejects(stat(join(attempt2, ".git/objects/info/alternates")), { code: "ENOENT" });
  for (const entry of await readdir(join(attempt2, ".git/objects/pack"))) assert.equal((await stat(join(attempt2, ".git/objects/pack", entry))).nlink, 1);

  await writeFile(join(value.target, "result.txt"), "exact retained builder tree\n");
  await git(value.target, ["add", "--", "result.txt"]);
  const resultTree = (await git(value.target, ["write-tree"])).stdout.trim();
  const successor = await candidateAt(resultTree, initial.candidate);
  const next = await openFoundationDeliveryGitContextV1({ ...value.input, store, candidate: successor.candidate });
  assert.equal(next.repository, first.repository);
  assert.equal(next.manifest.branch, first.manifest.branch);
  assert.equal((await git(next.repository, ["rev-parse", `${next.manifest.tipCommit}^`])).stdout.trim(), first.manifest.tipCommit);
  assert.equal(next.manifest.rootTree, resultTree);
  // Tool branch movement cannot choose the next operation's immutable subject.
  await git(next.repository, ["update-ref", next.manifest.branch, value.firstCommit]);
  const exactAgain = await openFoundationDeliveryGitContextV1({ ...value.input, store, candidate: successor.candidate });
  assert.equal(exactAgain.manifest.tipCommit, next.manifest.tipCommit);
  assert.equal((await git(next.repository, ["rev-parse", "HEAD"])).stdout.trim(), next.manifest.tipCommit);

  await git(value.target, ["reset", "--hard", value.loaded.epoch.commit]);
  await writeFile(join(value.target, "upstream.txt"), "another Delivery's canonical contribution\n");
  await git(value.target, ["add", "--", "upstream.txt"]);
  await git(value.target, ["commit", "-m", "Independent upstream advancement"]);
  const parentEpoch = await loadRepositoryEpoch(value.target);
  const parent = await bindRepositorySnapshot(parentEpoch, await loadKnowledgeSet(parentEpoch));
  await writeFile(join(value.target, "result.txt"), "exact retained builder tree\n");
  await git(value.target, ["add", "--", "result.txt"]);
  const integratedTree = (await git(value.target, ["write-tree"])).stdout.trim();
  const integratedCarrier = await publishCandidateRevisionCarrierFromGitTree({ machineHome: value.home, repository: value.target, rootTree: integratedTree });
  const integratedSample = validDeliveryControlPayload("candidate-revision");
  const assessment = prepareIntegrationAssessmentRetentionV1({
    store, activityId: "work-history-integration", boundary: value.boundary, sourceCandidate: successor.candidate, runtimeId: "runtime",
    payload: { schema: "lifecycle.integration-assessment-payload.v1", profileId: "lifecycle.integration-assessment.foundation-v1",
      canonicalParent: parent.snapshot, mergeRule: await foundationIntegrationMergeRuleV1(), outcome: "constructed", conflicts: [],
      validation: { complete: true, valid: true, diagnosticCodes: [], factsDigest: foundationIntegrationValidationFactsDigestV1({
        manifestFileDigest: sha256Bytes(integratedCarrier.manifestBytes),
        state: { ...(integratedSample.state as Record<string, never>), tree: integratedTree }, observer: integratedSample.observer }) },
      contextualApplicability: { disposition: "unchanged", changes: [] }, assessedAt: "2026-09-05T00:00:03.000Z", limitations: [] },
  }).revision;
  records.push(assessment);
  const integrated = await candidateAt(integratedTree, successor.candidate, assessment);
  const integrationHistory = await openFoundationDeliveryGitContextV1({ ...value.input, store, candidate: integrated.candidate });
  assert.equal(integrationHistory.manifest.branch, first.manifest.branch);
  assert.equal(integrationHistory.repository, first.repository);
  assert.deepEqual((await git(integrationHistory.repository, ["show", "-s", "--format=%P", integrationHistory.manifest.tipCommit])).stdout.trim().split(" "), [next.manifest.tipCommit, parent.epoch.commit]);
  const integratedCell = await cell("integrated-attempt", integrationHistory, integrated.carrier);
  assert.equal(await readFile(join(integratedCell, "result.txt"), "utf8"), "exact retained builder tree\n");
  assert.equal(await readFile(join(integratedCell, "upstream.txt"), "utf8"), "another Delivery's canonical contribution\n");
  assert.equal((await git(integratedCell, ["merge-base", "--is-ancestor", value.loaded.epoch.commit, "HEAD"])).exitCode, 0);
  assert.equal((await git(integratedCell, ["merge-base", "--is-ancestor", parent.epoch.commit, "HEAD"])).exitCode, 0);

  const postIntegration = await candidateAt(integratedTree, integrated.candidate);
  const continued = await openFoundationDeliveryGitContextV1({ ...value.input, store, candidate: postIntegration.candidate });
  assert.equal(continued.manifest.branch, first.manifest.branch);
  assert.equal((await git(continued.repository, ["rev-parse", `${continued.manifest.tipCommit}^`])).stdout.trim(), integrationHistory.manifest.tipCommit);
  assert.equal(continued.manifest.rootTree, integratedTree);

  const secondBoundary = compileControlRecordRevision("second-work-delivery", value.boundary);
  const secondCandidate = compileControlRecordRevision(secondBoundary.processId, { ...initial.candidate,
    relationships: [{ relation: "governed-by", target: ref(secondBoundary) }] });
  const secondStore = { ...store, identity: { ...store.identity, processId: secondBoundary.processId, storeId: "second-work-store" },
    getRevision: (id: string, revision: number) => [secondBoundary, secondCandidate].find((record) => record.recordId === id && record.revision === revision) ?? null,
  } as unknown as ControlRecordStore;
  const other = await openFoundationDeliveryGitContextV1({ ...value.input, store: secondStore, candidate: secondCandidate });
  assert.notEqual(other.repository, first.repository);
  assert.notEqual(other.manifest.branch, first.manifest.branch);
  assert.notEqual(await gitCommonDirectory(other.repository), await gitCommonDirectory(first.repository));
  assert.equal((await git(other.repository, ["merge-base", "--is-ancestor", next.manifest.tipCommit, "HEAD"], { allowFailure: true })).exitCode !== 0, true);

});

test("Code and Context inspection retain W(B) while reopening P-to-I files and sources after canonical GC", async (t) => {
  const value = await fixture(t);
  const { FoundationDeliveryGenerationSchema, createFoundationCodeSelection } = await import("@neutral/lifecycle-protocol");
  const { publicObservedDeliveryState } = await import("../../src/foundation/control/public-view.js");
  const { reduceDeliveryEvents } = await import("../../src/foundation/process/delivery-reducer.js");
  const { EventChain, prepareSuccessful, admitSuccessful, subject, relationship } = await import("../process/exploration/delivery-reducer-fixture.js");
  const { compileFoundationContextInspection } = await import("../../src/foundation/read-model/context-inspection-runtime.js");
  const { compileFoundationDeliveryQueryBasis } = await import("../../src/foundation/read-model/delivery-query-basis.js");
  const { gitBytes } = await import("../../src/foundation/repository/git.js");
  const { selfDigest } = await import("../../src/foundation/validation/canonical.js");
  const ref = (record: ControlRecordRevision) => ({ kind: record.recordKind, id: record.recordId, revision: record.revision, digest: record.digest });
  const eventSubject = (record: ControlRecordRevision) => ({ recordId: record.recordId, revision: record.revision, digest: record.digest });
  const brief = subject("inspection-brief"), workProduct = subject("inspection-work-product");
  const boundary = compileControlRecordRevision(value.boundary.processId, { ...value.boundary,
    relationships: [relationship("uses-brief", "director-brief", brief), relationship("proposed-from", "agent-work-product", workProduct)] });
  const before = "upstream application parent\n";
  const after = "upstream application parent\nDelivery contribution\n";
  await writeFile(join(value.target, "product.txt"), before);
  await writeFile(join(value.target, "upstream.txt"), "unrelated upstream contribution\n");
  await git(value.target, ["add", "--", "product.txt", "upstream.txt"]);
  await git(value.target, ["commit", "-m", "Observe application parent P"]);
  const parentEpoch = await loadRepositoryEpoch(value.target);
  const parent = await bindRepositorySnapshot(parentEpoch, await loadKnowledgeSet(parentEpoch));
  await writeFile(join(value.target, "product.txt"), after);
  await git(value.target, ["add", "--", "product.txt"]);
  const tree = (await git(value.target, ["write-tree"])).stdout.trim();
  const carrier = await publishCandidateRevisionCarrierFromGitTree({ machineHome: value.home, repository: value.target, rootTree: tree });
  const descriptor = { digest: sha256Bytes(carrier.manifestBytes), byteLength: carrier.manifestBytes.byteLength,
    mediaType: "application/vnd.lifecycle.candidate-revision-carrier-manifest+json", purpose: "candidate-revision-carrier-manifest" };
  const sample = validDeliveryControlPayload("candidate-revision");
  const candidateState = { ...(sample.state as Record<string, never>), tree,
    diffDigest: sha256Bytes((await gitBytes(value.target, ["diff", "--binary", "--full-index", "--no-color", "--no-ext-diff", "--no-renames", parent.epoch.commit, tree, "--"])).stdout),
    changedSubjects: [{ path: "product.txt", change: "modified", beforeDigest: sha256Bytes(before), afterDigest: sha256Bytes(after) }] };
  const source = compileControlRecordRevision(boundary.processId, { ...boundary,
    recordId: "inspection-candidate", recordKind: "candidate-revision", semanticAuthority: "runtime-observed",
    semanticAuthor: { kind: "runtime", id: "runtime" },
    payload: { ...sample, observation: "initialization", candidateBaseCommit: value.loaded.epoch.commit },
    relationships: [{ relation: "governed-by", target: ref(boundary) }] });
  const records = [boundary, source];
  const chain = new EventChain({ storeId: value.store.identity.storeId, processId: value.store.identity.processId });
  // Control finalization is supplied by an explicit synthetic Journal course.
  // Exact selection replay, Git custody, complete Snapshot reproduction, Carrier
  // import, inspection routing and public parsing are real; this is not a Store
  // persistence or authenticated operation scenario.
  const store = { identity: value.store.identity,
    state: () => reduceDeliveryEvents(chain.events, (selected) => store.getRevision(selected.recordId, selected.revision)),
    getRevision: (id: string, revision: number) => records.find((record) => record.recordId === id && record.revision === revision) ??
      [...chain.revisions.values()].find((record) => record.recordId === id && record.revision === revision) ?? null,
    listEvents: (afterSequence = 0, limit = 256) => chain.events.filter(event => event.sequence > afterSequence).slice(0, limit),
    readRetainedFile: async (digest: string) => digest === descriptor.digest ? { descriptor, bytes: carrier.manifestBytes } : null,
  } as unknown as ControlRecordStore;
  const assessment = prepareIntegrationAssessmentRetentionV1({ store, activityId: "inspection-integration", boundary,
    sourceCandidate: source, runtimeId: "runtime", payload: {
      schema: "lifecycle.integration-assessment-payload.v1", profileId: "lifecycle.integration-assessment.foundation-v1",
      canonicalParent: parent.snapshot, mergeRule: await foundationIntegrationMergeRuleV1(), outcome: "constructed", conflicts: [],
      validation: { complete: true, valid: true, diagnosticCodes: [], factsDigest: foundationIntegrationValidationFactsDigestV1({
        manifestFileDigest: descriptor.digest, state: candidateState, observer: sample.observer }) },
      contextualApplicability: { disposition: "unchanged", changes: [] }, assessedAt: "2026-09-05T00:00:01.000Z", limitations: [],
    } }).revision;
  records.push(assessment);
  const candidate = compileControlRecordRevision(source.processId, { ...source, revision: 2,
    payload: { ...sample, observation: "integration-successor", candidateBaseCommit: parent.epoch.commit,
      carrierManifest: descriptor, state: candidateState },
    relationships: [{ relation: "governed-by", target: ref(boundary) }, { relation: "revises", target: ref(source) },
      { relation: "integrated-from", target: ref(assessment) }] });
  records.push(candidate);
  chain.append("delivery-created", {});
  const prepared = prepareSuccessful(chain, { brief, workProduct, boundary: eventSubject(boundary) });
  const baseline = chain.resolveRevision(prepared.baselineReceipt)!;
  records.push({ ...baseline, payload: { ...baseline.payload, selectionId: "selection.check.demo", modality: "precondition" } });
  admitSuccessful(chain, prepared, { candidate: eventSubject(source) });
  chain.append("activity-started", { activityId: "inspection-integration", operation: "delivery.integrate" });
  chain.append("integration-assessed", { activityId: "inspection-integration" }, eventSubject(assessment),
    { recordKind: assessment.recordKind, payload: assessment.payload, relationships: assessment.relationships });
  chain.append("candidate-revision-observed", { activityId: "inspection-integration" }, eventSubject(candidate),
    { recordKind: candidate.recordKind, payload: candidate.payload, relationships: candidate.relationships });
  chain.append("activity-completed", { activityId: "inspection-integration", outcome: "completed" });
  const state = publicObservedDeliveryState({ identity: store.identity, state: store.state(), seal: null,
    physical: { disposition: "active", archiveManifestDigest: null } });
  assert.equal(state.standing, "active");
  assert.deepEqual(state.subjects.activeBoundary, ref(boundary));
  assert.deepEqual(state.subjects.candidate, ref(candidate));
  assert.deepEqual(state.subjects.integrationAssessment, ref(assessment));
  const generationValue = { schema: "lifecycle.delivery-generation.v1", storeId: state.storeId, processId: state.processId,
    journal: state.journal, storeDisposition: state.storeDisposition,
    repository: { headCommit: parent.epoch.commit, headTree: parent.epoch.tree, repositoryContractDigest: parent.contract.digest }, activeOperation: null };
  const generation = FoundationDeliveryGenerationSchema.parse({ ...generationValue, digest: selfDigest(generationValue) });
  const common = { machineHome: value.home, target: value.target, store, state, generation };
  const query = await compileFoundationDeliveryQueryBasis(common);
  assert.equal(query.repository.snapshot.commit, value.loaded.epoch.commit);
  const selection = createFoundationCodeSelection({ targetId: store.identity.targetId, storeId: store.identity.storeId,
    processId: store.identity.processId, origin: { sequence: chain.events.length, digest: chain.events.at(-1)!.digest },
    subject: "candidate", boundary: { ...ref(boundary), kind: "work-boundary" },
    candidate: { ...ref(candidate), kind: "candidate-revision" }, seal: null });
  const indexSelector = { kind: "code-index" as const, selection, subject: "candidate" as const, afterCursor: null, limit: 10 };
  const index = await compileFoundationContextInspection({ ...common, selector: indexSelector });
  assert(index.kind === "code-index" && index.status === "available");
  assert.equal(index.basis.context.repository.canonicalCommit, value.loaded.epoch.commit);
  assert.deepEqual(index.basis.before, { commit: parent.epoch.commit, tree: parent.epoch.tree });
  assert.deepEqual(index.files.map(({ path }) => path), ["product.txt"]);

  await git(value.target, ["reset", "--hard", parent.epoch.commit]);
  await git(value.target, ["checkout", "--orphan", "unrelated"]);
  await writeFile(join(value.target, "replacement.txt"), "unrelated history\n");
  await git(value.target, ["add", "--", "replacement.txt"]);
  await git(value.target, ["commit", "-m", "Replace canonical history"]);
  await git(value.target, ["branch", "-M", "main"]);
  await git(value.target, ["tag", "-d", "ambient-tag"]);
  await git(value.target, ["reflog", "expire", "--expire=now", "--all"]);
  await git(value.target, ["gc", "--prune=now"]);
  for (const commit of [value.loaded.epoch.commit, parent.epoch.commit]) {
    assert.notEqual((await git(value.target, ["cat-file", "-e", commit], { allowFailure: true })).exitCode, 0);
  }
  const rewritten = await loadRepositoryEpoch(value.target);
  assert.equal(rewritten.contract.targetId, store.identity.targetId);
  const resumedGenerationValue = { ...generationValue,
    repository: { headCommit: rewritten.epoch.commit, headTree: rewritten.epoch.tree, repositoryContractDigest: rewritten.contract.digest } };
  const resumedGeneration = FoundationDeliveryGenerationSchema.parse({ ...resumedGenerationValue, digest: selfDigest(resumedGenerationValue) });
  const resumed = { ...common, generation: resumedGeneration };
  assert.equal((await compileFoundationDeliveryQueryBasis(common)).repository.snapshot.digest, query.repository.snapshot.digest);
  const resumedIndex = await compileFoundationContextInspection({ ...resumed, selector: indexSelector });
  assert(resumedIndex.kind === "code-index" && resumedIndex.status === "available");
  assert.equal(resumedIndex.basis.context.repository.canonicalCommit, value.loaded.epoch.commit);
  assert.deepEqual(resumedIndex.basis.before, index.basis.before);
  assert.deepEqual(resumedIndex.files.map(({ cursor: _cursor, ...file }) => file), index.files.map(({ cursor: _cursor, ...file }) => file));
  const file = await compileFoundationContextInspection({ ...resumed, selector: { kind: "code-file", selection,
    subject: "candidate", fileCursor: resumedIndex.files[0]!.cursor, maximumDiffBytes: 4096 } });
  assert(file.kind === "code-file" && file.status === "available");
  assert.equal(file.difference.disposition, "available");
  assert.match(file.difference.content ?? "", /Delivery contribution/u);
  for (const [source, expected] of [[file.beforeSource, before], [file.afterSource, after]] as const) {
    assert.equal(source.status, "available");
    if (source.status !== "available") throw new Error("Expected exact Code source");
    const response = await compileFoundationContextInspection({ ...resumed, selector: { kind: "source",
      reference: source.reference, startByte: 0, maximumBytes: 4096 } });
    assert.equal(response.kind, "source");
    if (response.kind !== "source") throw new Error("Expected exact Source response");
    assert.equal(response.content, expected);
  }
});

test("full Git history inventory above 4 MiB reaches an independent Cell within its selected storage bound", async (t) => {
  const value = await fixture(t);
  const historyCommits = 50_000;
  const commands: string[] = [];
  for (let index = 0; index < historyCommits; index += 1) {
    const message = `Selected history ${index}\n`;
    commands.push(`commit refs/heads/main\ncommitter Lifecycle Test <lifecycle@example.invalid> ${1_780_000_000 + index} +0000\ndata ${Buffer.byteLength(message)}\n${message}${index === 0 ? `from ${value.loaded.epoch.commit}\n` : ""}\n`);
  }
  await git(value.target, ["fast-import", "--quiet"], { input: commands.join(""), timeoutMs: 120_000 });
  await git(value.target, ["reset", "--hard", "HEAD"]);
  const epoch = await loadRepositoryEpoch(value.target);
  const loaded = await bindRepositorySnapshot(epoch, await loadKnowledgeSet(epoch));
  const snapshot = loaded.snapshot;
  const boundary = compileControlRecordRevision(value.boundary.processId, { ...value.boundary,
    payload: { ...value.boundary.payload, basis: { ...value.basis,
      productBaseCommit: snapshot.commit, productBaseTree: snapshot.tree, productStateDigest: snapshot.productStateDigest,
      atlasStateDigest: snapshot.atlasStateDigest, atlasResolutionDigest: snapshot.atlasResolutionDigest,
      atlasNormalizedModelDigest: snapshot.atlasNormalizedModelDigest, atlasResourceBindingsDigest: snapshot.atlasResourceBindingsDigest,
      repositoryContractDigest: snapshot.contractDigest, knowledgeSetDigest: snapshot.knowledgeSetDigest,
      repositorySnapshotDigest: snapshot.digest } } });
  const carrier = await publishCandidateRevisionCarrierFromGitTree({ machineHome: value.home, repository: value.target, rootTree: snapshot.tree });
  const descriptor = { digest: sha256Bytes(carrier.manifestBytes), byteLength: carrier.manifestBytes.byteLength,
    mediaType: "application/vnd.lifecycle.candidate-revision-carrier-manifest+json", purpose: "candidate-revision-carrier-manifest" };
  const sample = validDeliveryControlPayload("candidate-revision");
  const candidate = compileControlRecordRevision(boundary.processId, { ...boundary,
    recordId: "large-history-candidate", recordKind: "candidate-revision", semanticAuthority: "runtime-observed",
    semanticAuthor: { kind: "runtime", id: "runtime" },
    payload: { ...sample, observation: "initialization", candidateBaseCommit: snapshot.commit,
      state: { ...(sample.state as Record<string, never>), tree: snapshot.tree }, carrierManifest: descriptor },
    relationships: [{ relation: "governed-by", target: { kind: "work-boundary", id: boundary.recordId, revision: boundary.revision, digest: boundary.digest } }] });
  const store = { identity: value.store.identity,
    getRevision: (id: string, revision: number) => [boundary, candidate].find((record) => record.recordId === id && record.revision === revision) ?? null,
    readRetainedFile: async (digest: string) => digest === descriptor.digest ? { descriptor, bytes: carrier.manifestBytes } : null,
  } as unknown as ControlRecordStore;
  const { openFoundationDeliveryGitContextV1 } = await import("../../src/foundation/repository/delivery-git-context.js");
  const { FOUNDATION_DELIVERY_GIT_CONTEXT_MAXIMUM_BYTES_V1 } = await import("../../src/foundation/repository/delivery-git-context-manifest.js");
  const { materializeFoundationAgentGitContextV1 } = await import("../../src/util/execution-cell-runner-v1.js");
  const context = await openFoundationDeliveryGitContextV1({ ...value.input, store, candidate });
  assert(context.manifestBytes.byteLength > 4 * 1024 * 1024);
  assert(context.manifestBytes.byteLength < FOUNDATION_DELIVERY_GIT_CONTEXT_MAXIMUM_BYTES_V1);
  assert(context.manifest.objectCount > historyCommits);
  const inputRoot = join(value.root, "large-history-input");
  const repository = join(value.root, "large-history-cell");
  await mkdir(join(inputRoot, "candidate"), { recursive: true });
  await mkdir(repository);
  await writeFile(join(inputRoot, "candidate/git-context.json"), context.manifestBytes);
  await writeFile(join(inputRoot, "candidate/git-context.pack"), context.artifactBytes);
  await writeFile(join(inputRoot, "candidate/carrier-manifest.json"), carrier.manifestBytes);
  const input = { inputRoot, repository, maximumBytes: 64 * 1024 * 1024,
    inputSet: { subjects: [
      { kind: "candidate-revision", id: candidate.recordId, revision: candidate.revision, digest: candidate.digest },
      { kind: "delivery-git-context", id: "large-history", revision: candidate.revision, digest: sha256Bytes(context.manifestBytes) },
    ] } };
  await materializeFoundationAgentGitContextV1(input);
  await assertIndependentGitRepository(repository);
  assert.equal((await git(repository, ["rev-parse", "HEAD"])).stdout.trim(), context.manifest.tipCommit);
  assert.equal((await git(repository, ["rev-list", "--count", "HEAD"])).stdout.trim(), String(historyCommits + 3));
  assert.equal((await git(repository, ["symbolic-ref", "HEAD"])).stdout.trim(), context.manifest.branch);
  // The larger inventory ceiling never overrides an operation's lower storage selection.
  await assert.rejects(materializeFoundationAgentGitContextV1({ ...input, maximumBytes: 4 * 1024 * 1024 }), /Delivery Git context is not one bounded regular file/u);
});
