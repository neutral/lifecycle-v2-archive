import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createFoundationCodeSelection,
  FoundationCodeFileSelectorSchema,
  FoundationCodeIndexSelectorSchema,
  FoundationDeliveryStateSchema,
} from "@neutral/lifecycle-protocol";
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
import { FoundationError } from "../../src/foundation/error.js";
import {
  compileFoundationCodeFile,
  compileFoundationCodeIndex,
  resolveFoundationCodeInspectionSource,
} from "../../src/foundation/read-model/code-inspection.js";
import type { FoundationDeliveryQueryBasis } from "../../src/foundation/read-model/delivery-query-basis.js";
import { exactTreeEntries, git, gitBytes } from "../../src/foundation/repository/git.js";
import type { FoundationLoadedRepositorySnapshot } from "../../src/foundation/repository/types.js";
import { sha256Bytes } from "../../src/foundation/validation/canonical.js";

test("each Code request opens one exact Candidate Carrier for facts, selection, and content", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-code-inspection-")));
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
    const beforeContent = "base\n";
    const afterContent = "base\nchanged café\n";
    const magicPath = ":(glob)**";
    const magicBeforeContent = "magic base\n";
    const magicAfterContent = "magic base\nmagic changed\n";
    await writeFile(join(repository, "product.txt"), beforeContent, "utf8");
    await writeFile(join(repository, magicPath), magicBeforeContent, "utf8");
    await git(repository, ["add", "-A"]);
    await git(repository, ["commit", "-m", "Base"]);
    const baseCommit = (await git(repository, ["rev-parse", "HEAD^{commit}"])).stdout.trim();
    const baseTree = (await git(repository, ["rev-parse", "HEAD^{tree}"])).stdout.trim();
    await git(candidateRepository, ["init", "-b", "candidate-source"]);
    await git(candidateRepository, [
      "-c", "protocol.file.allow=always", "fetch", "--no-tags", "--no-write-fetch-head",
      repository, baseCommit,
    ]);
    await git(candidateRepository, ["reset", "--hard", baseCommit]);
    await writeFile(join(candidateRepository, "product.txt"), afterContent, "utf8");
    await writeFile(join(candidateRepository, magicPath), magicAfterContent, "utf8");
    await git(candidateRepository, ["add", "-A"]);
    const candidateTree = (await git(candidateRepository, ["write-tree"])).stdout.trim();
    const exactDiff = (await gitBytes(candidateRepository, [
      "diff", "--binary", "--full-index", "--no-color", "--no-ext-diff", "--no-renames",
      baseCommit, candidateTree, "--",
    ])).stdout;
    const published = await publishCandidateRevisionCarrier({
      machineHome,
      prepared: await prepareCandidateRevisionCarrier({
        machineHome,
        repository: candidateRepository,
        rootTree: candidateTree,
      }),
    });
    const manifestDigest = sha256Bytes(published.manifestBytes);
    const basis = Object.freeze({
      specificationRevision: "lifecycle.foundation.1.0.0-rc.17" as const,
      repositoryContract: "lifecycle.repository.v22" as const,
      providerAdapter: "lifecycle.provider-adapter.v7" as const,
      productBaseCommit: baseCommit,
      productBaseTree: baseTree,
      productStateDigest: sha256Bytes("product-state"),
      atlasStateDigest: sha256Bytes("atlas-state"),
      atlasResolutionDigest: sha256Bytes("atlas-resolution"),
      atlasNormalizedModelDigest: sha256Bytes("atlas-model"),
      atlasResourceBindingsDigest: sha256Bytes("atlas-resources"),
      repositoryContractDigest: sha256Bytes("repository-contract"),
      knowledgeSetDigest: sha256Bytes("knowledge-set"),
      repositorySnapshotDigest: sha256Bytes("repository-snapshot"),
    });
    const boundary = compileControlRecordRevision("code-inspection-process", {
      recordId: "boundary-code-inspection",
      recordKind: "work-boundary",
      revision: 1,
      producer: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
      semanticAuthor: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
      semanticAuthority: "runtime-derived",
      createdAt: "2026-09-04T13:00:00.000Z",
      semanticMarkdown: "# Boundary\n",
      payload: Object.freeze({
        schema: "lifecycle.work-boundary-payload.v6",
        profileId: "lifecycle.work-boundary.foundation-v3",
        basis,
        knowledge: Object.freeze([]),
      }),
    });
    const candidate = compileControlRecordRevision("code-inspection-process", {
      recordId: "candidate-code-inspection",
      recordKind: "candidate-revision",
      revision: 1,
      producer: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
      semanticAuthor: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
      semanticAuthority: "runtime-observed",
      createdAt: "2026-09-04T13:01:00.000Z",
      semanticMarkdown: "# Candidate\n",
      payload: Object.freeze({
        observation: "initialization",
        candidateBaseCommit: baseCommit,
        state: Object.freeze({
          tree: candidateTree,
          candidateDigest: sha256Bytes("candidate-state"),
          productStateDigest: sha256Bytes("candidate-product-state"),
          knowledgeSetDigest: basis.knowledgeSetDigest,
          diffDigest: sha256Bytes(exactDiff),
          pathInventoryDigest: sha256Bytes("candidate-path-inventory"),
          artifactSetDigest: sha256Bytes("candidate-product-state"),
          descriptionCoverageDigest: sha256Bytes("candidate-description-coverage"),
          unchangedFromPredecessor: false,
          changedSubjects: Object.freeze([Object.freeze({
            path: magicPath,
            change: "modified",
            beforeDigest: sha256Bytes(magicBeforeContent),
            afterDigest: sha256Bytes(magicAfterContent),
          }), Object.freeze({
            path: "product.txt",
            change: "modified",
            beforeDigest: sha256Bytes(beforeContent),
            afterDigest: sha256Bytes(afterContent),
          })]),
        }),
        carrierManifest: Object.freeze({
          digest: manifestDigest,
          byteLength: published.manifestBytes.byteLength,
          mediaType: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
          purpose: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
        }),
      }),
      relationships: Object.freeze([Object.freeze({
        relation: "governed-by",
        target: Object.freeze({
          kind: "work-boundary",
          id: boundary.recordId,
          revision: boundary.revision,
          digest: boundary.digest,
        }),
      })]),
    });
    const boundaryReference = Object.freeze({
      kind: "work-boundary" as const,
      id: boundary.recordId,
      revision: boundary.revision,
      digest: boundary.digest,
    });
    const candidateReference = Object.freeze({
      kind: "candidate-revision" as const,
      id: candidate.recordId,
      revision: candidate.revision,
      digest: candidate.digest,
    });
    const state = FoundationDeliveryStateSchema.parse({
      schema: "lifecycle.delivery-reduction.v5",
    delegation: { admission: null, current: null, charged: { operations: 0, agentAttempts: 0, reservedCellWallTimeMs: 0 } },
      storeId: "store-code-inspection",
      processId: "code-inspection-process",
      standing: "active",
      candidateCondition: "ready-for-work",
      activities: [],
      recovery: null,
      subjects: {
        integrationAssessment: null,
        proposedBoundary: null,
        activeBoundary: boundaryReference,
        candidate: candidateReference,
        materialCondition: null,
        seal: null,
        evidence: null,
        closure: null,
      },
      journal: { eventCount: 1, headSequence: 1, headDigest: sha256Bytes("journal") },
      storeDisposition: {
        stage: "active",
        integrity: "verified",
        sealSubjectDigest: null,
        archiveManifestDigest: null,
      },
      eligibleOperations: [],
    });
    const selection = createFoundationCodeSelection({
      targetId: "target-code-inspection", storeId: state.storeId, processId: state.processId,
      origin: { sequence: 1, digest: state.journal.headDigest! },
      subject: "candidate", boundary: boundaryReference, candidate: candidateReference, seal: null,
    });
    let carrierManifestReads = 0;
    let corruptManifest = false;
    // Each verified repository preparation first requests this retained manifest.
    // Count that existing owner boundary while the real Git Carrier work runs.
    async function withOneCarrierOpening<T>(operation: () => Promise<T>): Promise<T> {
      const previousReads = carrierManifestReads;
      try {
        return await operation();
      } finally {
        assert.equal(carrierManifestReads - previousReads, 1, "one Carrier opening per request");
      }
    }
    const store = Object.freeze({
      identity: Object.freeze({
        targetId: "target-code-inspection",
        storeId: state.storeId,
        processId: state.processId,
      }),
      getRevision: (recordId: string, revision: number) =>
        recordId === candidate.recordId && revision === candidate.revision
          ? candidate
          : recordId === boundary.recordId && revision === boundary.revision
            ? boundary
            : null,
      readRetainedFile: async (selectedDigest: string) => {
        carrierManifestReads += 1;
        const bytes = Uint8Array.from(published.manifestBytes);
        if (corruptManifest) bytes[0] = bytes[0]! ^ 1;
        return selectedDigest === manifestDigest
          ? Object.freeze({
            descriptor: Object.freeze({
              digest: manifestDigest,
              byteLength: published.manifestBytes.byteLength,
              mediaType: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
              purpose: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
            }),
            bytes,
          })
          : null;
      },
    }) as unknown as ControlRecordStore;
    const repositorySnapshot = Object.freeze({
      repository,
      contract: Object.freeze({ targetId: "target-code-inspection", checkBindings: Object.freeze({}) }),
      epoch: Object.freeze({ commit: baseCommit, tree: baseTree, objectFormat: "sha1" }),
      treeEntries: await exactTreeEntries(repository, baseCommit, "sha1"),
    }) as unknown as FoundationLoadedRepositorySnapshot;
    const query = Object.freeze({
      boundaryRole: "active",
      boundary,
      basis,
      knowledge: Object.freeze({ records: Object.freeze([]) }),
      repository: repositorySnapshot,
    }) as unknown as FoundationDeliveryQueryBasis;

    const index = await withOneCarrierOpening(() => compileFoundationCodeIndex({
      machineHome,
      repository,
      store,
      query,
      selector: FoundationCodeIndexSelectorSchema.parse({
        kind: "code-index",
        selection,
        subject: "candidate",
        afterCursor: null,
        limit: 10,
      }),
    }));
    assert.equal(index.status, "available");
    if (index.status !== "available") return;
    assert.equal(index.files.length, 2);
    const productRow = index.files.find(({ path }) => path === "product.txt");
    const magicRow = index.files.find(({ path }) => path === magicPath);
    assert(productRow !== undefined);
    assert(magicRow !== undefined);
    assert.equal(productRow.change, "modified");

    const fileInput = {
      machineHome,
      repository,
      store,
      query,
      selector: FoundationCodeFileSelectorSchema.parse({
        kind: "code-file",
        selection,
        subject: "candidate",
        fileCursor: productRow.cursor,
        maximumDiffBytes: 4096,
      }),
    };
    const file = await withOneCarrierOpening(() => compileFoundationCodeFile(fileInput));
    assert.equal(file.status, "available");
    if (file.status !== "available") return;
    assert.deepEqual(file.basis, index.basis);
    assert.deepEqual(file.file, productRow);
    assert.equal(file.beforeSource.status, "available");
    assert.equal(file.afterSource.status, "available");
    assert.equal(file.difference.disposition, "available");
    if (file.difference.disposition === "available") {
      assert.match(file.difference.content, /\+changed café/u);
      assert.doesNotMatch(file.difference.content, /magic changed/u);
    }
    if (
      file.beforeSource.status !== "available" ||
      file.afterSource.status !== "available"
    ) return;
    const beforeReference = file.beforeSource.reference;
    const afterReference = file.afterSource.reference;
    const before = await withOneCarrierOpening(() => resolveFoundationCodeInspectionSource({
      machineHome,
      repository,
      store,
      query,
      reference: beforeReference,
    }));
    const after = await withOneCarrierOpening(() => resolveFoundationCodeInspectionSource({
      machineHome,
      repository,
      store,
      query,
      reference: afterReference,
    }));
    assert.equal(Buffer.from(before ?? []).toString("utf8"), beforeContent);
    assert.equal(Buffer.from(after ?? []).toString("utf8"), afterContent);
    assert.equal(
      await withOneCarrierOpening(() => resolveFoundationCodeInspectionSource({
        machineHome,
        repository,
        store,
        query,
        reference: { ...afterReference, path: "substituted.txt" },
      })),
      null,
    );
    assert.equal(
      await withOneCarrierOpening(() => resolveFoundationCodeInspectionSource({
        machineHome,
        repository,
        store,
        query,
        reference: {
          ...afterReference,
          subject: { ...afterReference.subject, digest: sha256Bytes("another-candidate") },
        },
      })),
      null,
    );
    await assert.rejects(
      () => withOneCarrierOpening(() => compileFoundationCodeFile({
        ...fileInput,
        selector: { ...fileInput.selector, fileCursor: sha256Bytes("another-code-basis") },
      })),
      (error: unknown) => error instanceof FoundationError &&
        error.code === "lifecycle.context-inspection.code-cursor-substituted",
    );
    corruptManifest = true;
    await assert.rejects(
      () => withOneCarrierOpening(() => compileFoundationCodeFile(fileInput)),
      (error: unknown) => error instanceof FoundationError &&
        error.code === "lifecycle.context-inspection.code-carrier-invalid",
    );
    corruptManifest = false;
    // The refusal neither poisons a later read nor installs a reusable verdict.
    assert.deepEqual(await withOneCarrierOpening(() => compileFoundationCodeFile(fileInput)), file);

    const magicFile = await withOneCarrierOpening(() => compileFoundationCodeFile({
      machineHome,
      repository,
      store,
      query,
      selector: FoundationCodeFileSelectorSchema.parse({
        kind: "code-file",
        selection,
        subject: "candidate",
        fileCursor: magicRow.cursor,
        maximumDiffBytes: 4096,
      }),
    }));
    assert.equal(magicFile.status, "available");
    if (magicFile.status === "available") {
      assert.equal(magicFile.difference.disposition, "available");
      if (magicFile.difference.disposition === "available") {
        assert.match(magicFile.difference.content, /magic changed/u);
        assert.doesNotMatch(magicFile.difference.content, /changed café/u);
      }
    }

    const verification = join(machineHome, "candidate-revision-carriers", "v1", "verification");
    assert.deepEqual(await readdir(verification), []);
    const artifactHex = published.manifest.carrierArtifact.digest.slice("sha256:".length);
    await rm(join(
      machineHome,
      "candidate-revision-carriers",
      "v1",
      "objects",
      artifactHex.slice(0, 2),
      `sha256-${artifactHex}`,
    ), { recursive: true, force: false });
    const unavailable = await withOneCarrierOpening(() => compileFoundationCodeIndex({
      machineHome,
      repository,
      store,
      query,
      selector: FoundationCodeIndexSelectorSchema.parse({
        kind: "code-index",
        selection,
        subject: "candidate",
        afterCursor: null,
        limit: 10,
      }),
    }));
    assert.equal(unavailable.status, "unavailable");
    if (unavailable.status === "unavailable") {
      assert.equal(unavailable.reason, "candidate-carrier-unavailable");
    }
    const unavailableFile = await withOneCarrierOpening(() => compileFoundationCodeFile(fileInput));
    assert.equal(unavailableFile.status, "unavailable");
    if (unavailableFile.status === "unavailable") {
      assert.equal(unavailableFile.reason, "candidate-carrier-unavailable");
    }
    assert.equal(await withOneCarrierOpening(() => resolveFoundationCodeInspectionSource({
      machineHome,
      repository,
      store,
      query,
      reference: afterReference,
    })), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
