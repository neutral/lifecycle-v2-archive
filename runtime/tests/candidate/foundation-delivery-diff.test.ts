import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  FoundationDeliveryGenerationSchema,
  FoundationDeliveryStateSchema,
} from "@neutral/lifecycle-protocol";
import { compileDeliveryDiff } from "../../src/foundation/candidate/diff-view.js";
import {
  prepareCandidateRevisionCarrier,
  publishCandidateRevisionCarrier,
} from "../../src/foundation/candidate/carrier-store.js";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
} from "../../src/foundation/candidate/carrier-types.js";
import { compileControlRecordRevision } from "../../src/foundation/control/model.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import { git, gitBytes } from "../../src/foundation/repository/git.js";
import { selfDigest, sha256Bytes } from "../../src/foundation/validation/canonical.js";

test("Candidate diff returns one exact retained subject and a safe bounded truncation", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-delivery-diff-")));
  const repository = join(root, "target");
  const candidateRepository = join(root, "candidate-source");
  const machineHome = join(root, "machine-home");
  try {
    await mkdir(repository, { mode: 0o700 });
    await mkdir(candidateRepository, { mode: 0o700 });
    await mkdir(machineHome, { mode: 0o700 });
    await git(repository, ["init", "-b", "main"]);
    await git(repository, ["config", "user.name", "Lifecycle Test"]);
    await git(repository, ["config", "user.email", "lifecycle@example.invalid"]);
    await writeFile(join(repository, "product.txt"), "base\n", "utf8");
    await git(repository, ["add", "--", "product.txt"]);
    await git(repository, ["commit", "-m", "Base"]);
    const baseCommit = (await git(repository, ["rev-parse", "HEAD^{commit}"])).stdout.trim();
    const baseTree = (await git(repository, ["rev-parse", "HEAD^{tree}"])).stdout.trim();
    await git(candidateRepository, ["init", "-b", "candidate-source"]);
    await git(candidateRepository, [
      "-c", "protocol.file.allow=always", "fetch", "--no-tags", "--no-write-fetch-head",
      repository, baseCommit,
    ]);
    await git(candidateRepository, ["reset", "--hard", baseCommit]);
    await writeFile(
      join(candidateRepository, "product.txt"),
      `base\n${"changed line\n".repeat(512)}`,
      "utf8",
    );
    await git(candidateRepository, ["add", "--", "product.txt"]);
    const candidateTree = (await git(candidateRepository, ["write-tree"])).stdout.trim();
    const exactBytes = (await gitBytes(candidateRepository, [
      "diff", "--binary", "--full-index", "--no-color", "--no-ext-diff", "--no-renames",
      baseCommit, candidateTree, "--",
    ])).stdout;
    const exactDiffDigest = sha256Bytes(exactBytes);
    const published = await publishCandidateRevisionCarrier({
      machineHome,
      prepared: await prepareCandidateRevisionCarrier({
        machineHome,
        repository: candidateRepository,
        rootTree: candidateTree,
      }),
    });
    const manifestFileDigest = sha256Bytes(published.manifestBytes);
    const candidate = compileControlRecordRevision("delivery-diff", {
      recordId: "candidate-diff",
      recordKind: "candidate-revision",
      revision: 1,
      producer: { kind: "runtime", id: "foundation-runtime" },
      semanticAuthor: { kind: "runtime", id: "foundation-runtime" },
      semanticAuthority: "runtime-observed",
      createdAt: "2026-08-29T09:00:00.000Z",
      semanticMarkdown: "# Candidate\n\nExact immutable diff subject.\n",
      payload: {
        candidateBaseCommit: baseCommit,
        state: { tree: candidateTree, diffDigest: exactDiffDigest },
        carrierManifest: {
          digest: manifestFileDigest,
          byteLength: published.manifestBytes.byteLength,
          mediaType: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
          purpose: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
        },
      },
    });
    const candidateReference = {
      kind: "candidate-revision" as const,
      id: candidate.recordId,
      revision: candidate.revision,
      digest: candidate.digest,
    };
    const state = FoundationDeliveryStateSchema.parse({
      schema: "lifecycle.delivery-reduction.v2",
      storeId: "store-diff",
      processId: "delivery-diff",
      standing: "active",
      candidateCondition: "ready-for-work",
      activities: [],
      recovery: null,
      subjects: {
        proposedBoundary: null,
        activeBoundary: null,
        candidate: candidateReference,
        materialCondition: null,
        seal: null,
        evidence: null,
        closure: null,
      },
      journal: { eventCount: 0, headSequence: null, headDigest: null },
      storeDisposition: {
        stage: "active",
        integrity: "verified",
        sealSubjectDigest: null,
        archiveManifestDigest: null,
      },
      eligibleOperations: [],
    });
    const generationSource = {
      schema: "lifecycle.delivery-generation.v1" as const,
      storeId: state.storeId,
      processId: state.processId,
      journal: state.journal,
      storeDisposition: state.storeDisposition,
      repository: {
        headCommit: baseCommit,
        headTree: baseTree,
        repositoryContractDigest: sha256Bytes("repository-contract"),
      },
      activeOperation: null,
    };
    const generation = FoundationDeliveryGenerationSchema.parse({
      ...generationSource,
      digest: selfDigest(generationSource),
    });
    const store = {
      getRevision: (recordId: string, revision: number) =>
        recordId === candidate.recordId && revision === candidate.revision ? candidate : null,
      readRetainedFile: async (digest: string) => digest === manifestFileDigest
        ? Object.freeze({
            descriptor: Object.freeze({
              digest: manifestFileDigest,
              byteLength: published.manifestBytes.byteLength,
              mediaType: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
              purpose: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
            }),
            bytes: Uint8Array.from(published.manifestBytes),
          })
        : null,
    } as unknown as ControlRecordStore;

    const absentBefore = await git(repository, [
      "cat-file", "-e", `${candidateTree}^{tree}`,
    ], { allowFailure: true });
    assert.notEqual(absentBefore.exitCode, 0, "target Git must not own the Candidate tree");
    const targetObjectsBefore = (await git(repository, ["count-objects", "-v"])).stdout;

    const exact = await compileDeliveryDiff({
      machineHome,
      repository,
      store,
      state,
      generation,
      subject: "candidate",
      maximumBytes: exactBytes.byteLength + 1,
    });
    assert.equal(exact.currentness, "exact");
    assert.equal(exact.truncated, false);
    assert.equal(exact.exactDiffDigest, exactDiffDigest);
    assert.equal(exact.contentDigest, sha256Bytes(Buffer.from(exact.content ?? "", "utf8")));
    assert.equal(exact.byteLength, exactBytes.byteLength);

    const truncated = await compileDeliveryDiff({
      machineHome,
      repository,
      store,
      state,
      generation,
      subject: "candidate",
      maximumBytes: 128,
    });
    assert.equal(truncated.currentness, "exact");
    assert.equal(truncated.truncated, true);
    assert.equal(truncated.exactDiffDigest, exactDiffDigest);
    assert((truncated.content?.length ?? 0) > 0);
    assert(truncated.byteLength <= 128);

    const absentAfter = await git(repository, [
      "cat-file", "-e", `${candidateTree}^{tree}`,
    ], { allowFailure: true });
    assert.notEqual(absentAfter.exitCode, 0, "diff read must not import Candidate bytes into target Git");
    assert.equal((await git(repository, ["rev-parse", "HEAD^{commit}"])).stdout.trim(), baseCommit);
    assert.equal((await git(repository, ["status", "--porcelain=v1"])).stdout, "");
    assert.equal((await git(repository, ["count-objects", "-v"])).stdout, targetObjectsBefore);
    const verification = join(
      machineHome,
      "candidate-revision-carriers",
      "v1",
      "verification",
    );
    assert.deepEqual(await readdir(verification), [], "diff scratch must be removed after success");

    const artifactHex = published.manifest.carrierArtifact.digest.slice("sha256:".length);
    await rm(join(
      machineHome,
      "candidate-revision-carriers",
      "v1",
      "objects",
      artifactHex.slice(0, 2),
      `sha256-${artifactHex}`,
    ), { recursive: true, force: false });
    const unavailable = await compileDeliveryDiff({
      machineHome,
      repository,
      store,
      state,
      generation,
      subject: "candidate",
      maximumBytes: exactBytes.byteLength + 1,
    });
    assert.equal(unavailable.currentness, "unavailable");
    assert.match(unavailable.unavailableReason ?? "", /retained Candidate Revision Carrier/u);
    assert.equal(unavailable.content, null);
    assert.deepEqual(await readdir(verification), [], "failed diff read must not retain scratch");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
