import { receiveFoundationAuthorityCredential } from "../../src/foundation/repository/authority.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { compileControlRecordRevision } from "../../src/foundation/control/model.js";
import { foundationIntegrationValidationFactsDigestV1, resolveFailedIntegrationCorrectionV1 } from "../../src/foundation/control/integration-assessment.js";
import type {
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordRevision,
} from "../../src/foundation/control/types.js";
import { loadKnowledgeSet } from "../../src/foundation/knowledge/knowledge-set.js";
import { knowledgeOccurrence, knowledgeOccurrenceItemId } from "../../src/foundation/knowledge/identity.js";
import { parseKnowledgeRecord } from "../../src/foundation/knowledge/records.js";
import type { FoundationSupersession } from "../../src/foundation/knowledge/types.js";
import { ProjectionByteInventoryBuilder } from "../../src/foundation/projection/content.js";
import { compileKnowledgeProjection } from "../../src/foundation/projection/compiler.js";
import { foundationRepositorySourceMaterials } from "../../src/foundation/projection/source-context.js";
import { compileExecution } from "../../src/foundation/projection/execution.js";
import { verifyCompiledProjection } from "../../src/foundation/projection/verification.js";
import {
  parseProjectionRequest,
  projectionRepositoryEpochDigest,
} from "../../src/foundation/projection/request.js";
import type {
  FoundationExecutionProjectionRequest,
  FoundationExecutionProjectionSubject,
} from "../../src/foundation/projection/types.js";
import { buildAtlasState } from "../../src/foundation/repository/atlas-state.js";
import { exactTreeEntries, git, objectBlobBytes } from "../../src/foundation/repository/git.js";
import { initializeRepository } from "../../src/foundation/repository/initialize.js";
import { buildProductState } from "../../src/foundation/repository/product-state.js";
import type {
  FoundationLoadedRepositoryEpoch,
  FoundationLoadedRepositorySnapshot,
} from "../../src/foundation/repository/types.js";
import {
  canonicalJson,
  digestCanonical,
  selfDigest,
  sha256Bytes,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";
import { DiagnosticCollector } from "../../src/foundation/validation/result.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";
import {
  foundationDisciplineAdoptionFixture,
  TEST_DISCIPLINE_ID,
  TEST_DISCIPLINE_PATH,
} from "../helpers/foundation-discipline-fixture.js";
import { minimalResolvedAtlas, writeMinimalAtlas } from "../helpers/atlas-fixture.js";

const PUBLICATION = sha256Bytes("projection-control-publication");
const PROCESS = "delivery.projection-control";
const CREATED = "2026-08-29T20:00:00.000Z";

function description(options: Readonly<{
  revision?: number;
  status?: "current" | "superseded";
  supersedes?: FoundationSupersession;
}> = {}): string {
  const frontMatter = {
    schema: "lifecycle.knowledge-record.v2",
    kind: "description",
    id: "description.projection-control",
    title: "Projection control fixture",
    status: options.status ?? "current",
    revision: options.revision ?? 1,
    supersedes: options.supersedes ?? null,
    summary: "Own the governed external-source fixture used by reviewer Projection tests.",
    owners: ["director"],
    sources: [],
    relationships: [],
    conflicts: [],
    tags: [],
    spec: {
      responsibility: "Own the reviewer Projection fixture.",
      coverage: [{
        path: "docs/external-source.md",
        mode: "file",
        role: "primary",
        exclude: [],
      }],
      behavior: ["exposes one exact external-source value"],
      boundaries: ["contains no Delivery Control"],
      invariants: ["remains ordinary tracked product content"],
      dependencies: [],
      failure: ["the exact external-source value cannot be reproduced"],
      rationale: ["one Description keeps reviewer coverage explicit"],
    },
  };
  return `---\n${JSON.stringify(frontMatter, null, 2)}\n---\n\n# Projection control fixture\n\n## Responsibility\n\nOwn the fixture.\n\n## Behavior\n\nExpose one value.\n\n## Boundaries\n\nNo Delivery Control.\n\n## Rationale\n\nKeep the fixture bounded.\n`;
}

async function write(root: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content, "utf8");
}

function object(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError(`${label} is not one Control object`);
  }
  return value as ControlJsonObject;
}

function reference(revision: ControlRecordRevision) {
  return Object.freeze({
    kind: revision.recordKind,
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function revision(input: Readonly<{
  id: string;
  kind:
    | "work-boundary"
    | "integration-assessment"
    | "candidate-revision"
    | "candidate-seal"
    | "check-receipt"
    | "agent-attempt"
    | "agent-work-product";
  revision?: number;
  markdown: string;
  payload: ControlJsonObject;
  relationships: readonly Readonly<{
    relation: string;
    target: Readonly<{ kind: string; id: string; revision: number; digest: Sha256 }>;
  }>[];
}>): ControlRecordRevision {
  return compileControlRecordRevision(PROCESS, {
    recordId: input.id,
    recordKind: input.kind,
    revision: input.revision ?? 1,
    producer: Object.freeze({ kind: "runtime", id: "runtime.projection-control" }),
    semanticAuthor: input.kind === "agent-work-product"
      ? Object.freeze({ kind: "agent" as const, id: "agent.projection-control" })
      : Object.freeze({ kind: "runtime" as const, id: "runtime.projection-control" }),
    semanticAuthority: input.kind === "agent-work-product"
      ? "agent-proposed"
      : input.kind === "work-boundary" || input.kind === "agent-attempt"
        ? "runtime-derived"
        : "runtime-observed",
    createdAt: CREATED,
    semanticMarkdown: input.markdown,
    payload: input.payload,
    relationships: input.relationships,
  });
}

for (const knowledgeChange of ["unchanged", "revised"] as const) {
test(`reviewer Projection resolves exact v7 Control values and preserves ${knowledgeChange} Knowledge occurrences`, async () => {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-projection-control-"));
  const candidateRoot = await mkdtemp(join(tmpdir(), "lifecycle-projection-control-candidate-"));
  const home = await mkdtemp(join(tmpdir(), "lifecycle-projection-control-home-"));
  try {
    await git(root, ["init", "-b", "main"]);
    await git(root, ["config", "user.name", "Lifecycle Test"]);
    await git(root, ["config", "user.email", "lifecycle@example.invalid"]);
    await writeMinimalAtlas(root);
    await write(root, "docs/external-source.md", "# Base external source\n");
    await git(root, ["add", "--", "atlas", "docs/external-source.md"]);
    await git(root, ["commit", "-m", "Create target"]);
    const contract = await initializeRepository(root, {
      targetId: "projection-control-target",
      directorPrincipal: "director",
      home,
      authorityCredential: receiveFoundationAuthorityCredential("projection-control-secret-at-least-thirty-two-bytes", "initialize"),
      publicationDigest: PUBLICATION,
      implementationRoots: ["docs"],
      stage: true,
    });
    await write(root, "docs/_source.desc.md", description());
    await git(root, ["add", "--", "docs/_source.desc.md"]);
    await git(root, ["commit", "-m", "Attach Lifecycle Foundation"]);
    const adopted = foundationDisciplineAdoptionFixture(contract);
    await write(root, TEST_DISCIPLINE_PATH, adopted.document);
    await write(root, "records/disciplines/registry.json", adopted.registryDocument);
    await git(root, ["add", "--", TEST_DISCIPLINE_PATH, "records/disciplines/registry.json"]);
    await git(root, ["commit", "-m", "Adopt focused Go review Discipline"]);
    const commit = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
    const tree = (await git(root, ["rev-parse", "HEAD^{tree}"])).stdout.trim();
    const treeEntries = await exactTreeEntries(root, tree, "sha1");
    const productState = buildProductState(contract, treeEntries);
    const atlasState = buildAtlasState(contract, treeEntries);
    const epoch: FoundationLoadedRepositoryEpoch = Object.freeze({
      repository: root,
      contract,
      epoch: Object.freeze({ ref: contract.canonicalBranch, commit, tree, objectFormat: "sha1" }),
      treeEntries,
      productState,
      atlasState,
      atlas: minimalResolvedAtlas(atlasState.digest),
      worktree: Object.freeze({
        dirty: false,
        modified: Object.freeze([]),
        untracked: Object.freeze([]),
        ignored: Object.freeze([]),
      }),
    });
    const baseKnowledge = await loadKnowledgeSet(epoch);
    assert.equal(baseKnowledge.validation.complete, true);
    assert.equal(baseKnowledge.validation.valid, true);
    const discipline = baseKnowledge.index.currentByIdentity.get(TEST_DISCIPLINE_ID);
    if (discipline === undefined) assert.fail("adopted Discipline is absent from reviewer Knowledge");
    const disciplineFact = Object.freeze({
      id: discipline.frontMatter.id,
      revision: discipline.frontMatter.revision,
      sourceDigest: discipline.sourceDigest,
      semanticDigest: discipline.semanticDigest,
    });
    const selectedDiscipline = Object.freeze({
      ...disciplineFact,
      title: discipline.frontMatter.title,
      summary: discipline.frontMatter.summary,
      path: discipline.path,
    });
    const snapshotBase = {
      targetId: contract.targetId,
      commit,
      tree,
      objectFormat: "sha1" as const,
      contractDigest: contract.digest,
      productStateDigest: productState.digest,
      atlasStateDigest: atlasState.digest,
      atlasResolutionDigest: epoch.atlas.resolution.digest,
      atlasNormalizedModelDigest: epoch.atlas.resolution.normalizedModelDigest,
      atlasResourceBindingsDigest: epoch.atlas.resolution.resourceBindingsDigest,
      knowledgeSetDigest: baseKnowledge.manifest.digest,
    };
    const loaded: FoundationLoadedRepositorySnapshot = Object.freeze({
      ...epoch,
      snapshot: Object.freeze({ ...snapshotBase, digest: digestCanonical(snapshotBase) }),
    });

    const repositoryValidation = new DiagnosticCollector().result({
      profile: "repository-v9",
      publicationDigest: contract.specification.publicationDigest,
      subjectKind: "repository",
      subjectId: contract.targetId,
      subjectDigest: loaded.snapshot.digest,
      subjectRevision: contract.generation,
      stages: ["snapshot"],
    });
    const boundaryPayload = validDeliveryControlPayload("work-boundary");
    const boundary = revision({
      id: "boundary.projection-control",
      kind: "work-boundary",
      markdown: "# Work Boundary\n\nReview the exact sealed Candidate.\n",
      payload: Object.freeze({
        ...boundaryPayload,
        targetId: contract.targetId,
        knowledge: Object.freeze([Object.freeze({ ...disciplineFact })]),
        disciplines: Object.freeze({ registryDigest: baseKnowledge.disciplineRegistry.digest, workTypeIds: Object.freeze([]), records: Object.freeze([Object.freeze({ ...disciplineFact })]) }),
        basis: Object.freeze({
          specificationRevision: contract.specification.revision,
          repositoryContract: "lifecycle.repository.v22",
          providerAdapter: "lifecycle.provider-adapter.v7",
          productBaseCommit: loaded.snapshot.commit,
          productBaseTree: loaded.snapshot.tree,
          productStateDigest: loaded.snapshot.productStateDigest,
          atlasStateDigest: loaded.snapshot.atlasStateDigest,
          atlasResolutionDigest: loaded.snapshot.atlasResolutionDigest,
          atlasNormalizedModelDigest: loaded.snapshot.atlasNormalizedModelDigest,
          atlasResourceBindingsDigest: loaded.snapshot.atlasResourceBindingsDigest,
          repositoryContractDigest: loaded.snapshot.contractDigest,
          knowledgeSetDigest: baseKnowledge.manifest.digest,
          repositorySnapshotDigest: loaded.snapshot.digest,
        }),
      }),
      relationships: Object.freeze([
        Object.freeze({
          relation: "uses-brief",
          target: Object.freeze({
            kind: "director-brief",
            id: "brief.projection-control",
            revision: 1,
            digest: sha256Bytes("brief.projection-control"),
          }),
        }),
        Object.freeze({
          relation: "proposed-from",
          target: Object.freeze({
            kind: "agent-work-product",
            id: "work-product.projection-control",
            revision: 1,
            digest: sha256Bytes("work-product.projection-control"),
          }),
        }),
      ]),
    });

    await git(root, ["commit", "--allow-empty", "-m", "Record admission"]);
    const candidateBaseCommit = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
    const parentBasis = { ...snapshotBase, commit: candidateBaseCommit };
    const parentLoaded = { ...loaded, epoch: { ...loaded.epoch, commit: candidateBaseCommit },
      snapshot: { ...parentBasis, digest: digestCanonical(parentBasis) } };

    await git(candidateRoot, ["init", "-b", "candidate"]);
    await git(candidateRoot, ["config", "user.name", "Lifecycle Test"]);
    await git(candidateRoot, ["config", "user.email", "lifecycle@example.invalid"]);
    await git(candidateRoot, ["fetch", "--no-tags", root, candidateBaseCommit]);
    await git(candidateRoot, ["checkout", "--detach", candidateBaseCommit]);
    const priorSourceEntry = treeEntries.find(({ path }) => path === "docs/external-source.md")!;
    const priorSource = await objectBlobBytes(root, priorSourceEntry.objectId);
    const candidateSource = "# Candidate external source\n\nThe admitted reference changed.\n";
    await write(candidateRoot, "docs/external-source.md", candidateSource);
    const changedKnowledge: { path: string; change: "added" | "modified"; beforeDigest: Sha256 | null; afterDigest: Sha256 }[] = [];
    if (knowledgeChange === "revised") {
      const historicalPath = "docs/_source-r1.desc.md";
      const historicalText = description({ status: "superseded" });
      await write(candidateRoot, historicalPath, historicalText);
      const historical = parseKnowledgeRecord({
        path: historicalPath,
        mode: "100644",
        objectId: (await git(candidateRoot, ["hash-object", "--", historicalPath])).stdout.trim(),
        bytes: Buffer.from(historicalText),
        contract,
      });
      const revisedText = description({ revision: 2, supersedes: {
        id: historical.frontMatter.id,
        revision: 1,
        sourceDigest: historical.sourceDigest,
        semanticDigest: historical.semanticDigest,
      } });
      await write(candidateRoot, "docs/_source.desc.md", revisedText);
      changedKnowledge.push({ path: historicalPath, change: "added", beforeDigest: null, afterDigest: historical.sourceDigest }, {
        path: "docs/_source.desc.md", change: "modified", beforeDigest: sha256Bytes(description()), afterDigest: sha256Bytes(revisedText),
      });
    }
    await git(candidateRoot, ["add", "--", "docs"]);
    const sealedTree = (await git(candidateRoot, ["write-tree"])).stdout.trim();
    const candidateEntries = await exactTreeEntries(candidateRoot, sealedTree, "sha1");
    assert.notEqual(
      (await git(root, ["cat-file", "-e", `${sealedTree}^{tree}`], { allowFailure: true })).exitCode,
      0,
      "the canonical admitted repository must not contain the provisional Candidate tree",
    );
    const candidateProductState = buildProductState(contract, candidateEntries);
    const candidateAtlasState = buildAtlasState(contract, candidateEntries);
    const candidateEpoch: FoundationLoadedRepositoryEpoch = Object.freeze({
      ...epoch,
      repository: candidateRoot,
      epoch: Object.freeze({
        ...epoch.epoch,
        commit: candidateBaseCommit,
        tree: sealedTree,
      }),
      treeEntries: candidateEntries,
      productState: candidateProductState,
      atlasState: candidateAtlasState,
      atlas: epoch.atlas,
    });
    const candidateKnowledge = await loadKnowledgeSet(candidateEpoch);
    assert.equal(candidateKnowledge.validation.complete, true);
    assert.equal(candidateKnowledge.validation.valid, true);
    const diffBytes = Buffer.from((await git(candidateRoot, [
      "diff",
      "--binary",
      "--full-index",
      "--no-color",
      "--no-ext-diff",
      "--no-renames",
      candidateBaseCommit,
      sealedTree,
      "--",
    ])).stdout, "utf8");
    const changedSubjects = Object.freeze([...changedKnowledge.map((entry) => Object.freeze(entry)), Object.freeze({
      path: "docs/external-source.md",
      change: "modified" as const,
      beforeDigest: sha256Bytes(priorSource),
      afterDigest: sha256Bytes(candidateSource),
    })]);
    const pathInventoryDigest = digestCanonical(candidateEntries.map((entry) => Object.freeze({
      path: entry.path,
      mode: entry.mode,
      type: entry.type,
      objectId: entry.objectId,
    })));
    const diffDigest = sha256Bytes(diffBytes);
    const artifactSetDigest = digestCanonical(candidateProductState.entries);
    const descriptionCoverageDigest = digestCanonical(candidateKnowledge.manifest.coverage);
    const candidateDigest = digestCanonical({
      schema: "lifecycle.delivery-candidate-state.v1",
      candidateBaseCommit,
      tree: sealedTree,
      productStateDigest: candidateProductState.digest,
      knowledgeSetDigest: candidateKnowledge.manifest.digest,
      diffDigest,
      pathInventoryDigest,
      artifactSetDigest,
      descriptionCoverageDigest,
      changedSubjects,
    });
    const candidatePayload = Object.freeze({
      ...validDeliveryControlPayload("candidate-revision"),
      observation: "builder-successor",
      candidateBaseCommit,
      state: Object.freeze({
        tree: sealedTree,
        candidateDigest,
        productStateDigest: candidateProductState.digest,
        knowledgeSetDigest: candidateKnowledge.manifest.digest,
        diffDigest,
        pathInventoryDigest,
        artifactSetDigest,
        descriptionCoverageDigest,
        unchangedFromPredecessor: false,
        changedSubjects,
      }),
    });
    const sourceCandidate = revision({ id: "candidate.projection-control", kind: "candidate-revision", revision: 1,
      markdown: "# Source Candidate\n", payload: { ...validDeliveryControlPayload("candidate-revision"), candidateBaseCommit: commit },
      relationships: [{ relation: "governed-by", target: reference(boundary) }] });
    const assessment = revision({ id: "integration.projection-control", kind: "integration-assessment",
      markdown: "# Integration Assessment\n", payload: {
        schema: "lifecycle.integration-assessment-payload.v1", profileId: "lifecycle.integration-assessment.foundation-v1",
        canonicalParent: parentLoaded.snapshot,
        mergeRule: { id: "lifecycle.integration.three-way.v2", implementationId: "lifecycle.integration.git-merge-tree.v1", implementationDigest: sha256Bytes("merge") },
        outcome: "constructed", conflicts: [], validation: { complete: true, valid: true, diagnosticCodes: [],
          factsDigest: foundationIntegrationValidationFactsDigestV1({
            manifestFileDigest: ((candidatePayload as ControlJsonObject).carrierManifest as ControlJsonObject).digest as `sha256:${string}`,
            state: candidatePayload.state, observer: (candidatePayload as ControlJsonObject).observer }) },
        contextualApplicability: { disposition: "unchanged", changes: [] }, assessedAt: CREATED, limitations: [],
      }, relationships: [{ relation: "governed-by", target: reference(boundary) }, { relation: "integrates", target: reference(sourceCandidate) }] });
    const candidate = revision({
      id: "candidate.projection-control",
      kind: "candidate-revision",
      revision: 2,
      markdown: "# Candidate Revision\n\nThe Candidate contains one changed admitted external source.\n",
      payload: candidatePayload,
      relationships: Object.freeze([
        Object.freeze({
          relation: "revises",
          target: Object.freeze({
            kind: "candidate-revision",
            id: "candidate.projection-control",
            revision: 1,
            digest: sha256Bytes("candidate.projection-control.initial"),
          }),
        }),
        Object.freeze({ relation: "governed-by", target: reference(boundary) }),
        Object.freeze({
          relation: "result-of",
          target: Object.freeze({
            kind: "agent-attempt",
            id: "attempt.projection-control.builder",
            revision: 1,
            digest: sha256Bytes("attempt.projection-control.builder"),
          }),
        }),
      ]),
    });
    const candidateCarrierManifestDigest = object(
      candidate.payload.carrierManifest,
      "Candidate Carrier manifest binding",
    ).digest as Sha256;
    const seal = revision({
      id: "seal.projection-control",
      kind: "candidate-seal",
      markdown: "# Candidate Seal\n\nThe exact Candidate Revision is frozen for evaluation.\n",
      payload: validDeliveryControlPayload("candidate-seal"),
      relationships: Object.freeze([
        Object.freeze({ relation: "seals", target: reference(candidate) }),
        Object.freeze({ relation: "governed-by", target: reference(boundary) }),
      ]),
    });

    const profile = contract.projectionProfiles["execution-standard-v1"]!;
    const capability = contract.capabilityProfiles[contract.defaults.capabilityProfileId]!;
    const requestBase = {
      schema: "lifecycle.projection-request.v5" as const,
      class: "execution" as const,
      role: "reviewer" as const,
      specificationRevision: contract.specification.revision,
      target: Object.freeze({ id: contract.targetId, generation: contract.generation }),
      repository: Object.freeze({
        commit: loaded.snapshot.commit,
        tree: loaded.snapshot.tree,
        objectFormat: loaded.snapshot.objectFormat,
        repositoryEpochDigest: projectionRepositoryEpochDigest(epoch),
        productStateDigest: loaded.snapshot.productStateDigest,
        repositoryContractDigest: loaded.snapshot.contractDigest,
        repositorySnapshotDigest: loaded.snapshot.digest,
        validationDigest: repositoryValidation.digest,
        complete: true,
        valid: true,
      }),
      atlas: Object.freeze({
        root: contract.atlas.root,
        entrypoint: contract.atlas.entrypoint,
        specificationRevision: contract.atlas.selection.specificationRevision,
        processorRevision: contract.atlas.selection.processorRevision,
        stateDigest: loaded.snapshot.atlasStateDigest,
        resolutionDigest: loaded.snapshot.atlasResolutionDigest,
        normalizedModelDigest: loaded.snapshot.atlasNormalizedModelDigest,
        resourceBindingsDigest: loaded.atlas.resolution.resourceBindingsDigest,
        complete: true,
        valid: true,
      }),
      knowledge: Object.freeze({
        knowledgeObservationDigest: baseKnowledge.manifest.digest,
        knowledgeSetDigest: baseKnowledge.manifest.digest,
        knowledgeValidationDigest: baseKnowledge.validation.digest,
        complete: true,
        valid: true,
      }),
      profile,
      subject: Object.freeze({
        class: "execution" as const,
        workBoundary: Object.freeze({
          kind: "work-boundary" as const,
          id: boundary.recordId,
          revision: boundary.revision,
          digest: boundary.digest,
        }),
        candidate: Object.freeze({
          baseCommit: candidateBaseCommit,
          revision: Object.freeze({
            kind: "candidate-revision" as const,
            id: candidate.recordId,
            revision: candidate.revision,
            digest: candidate.digest,
          }),
          stateDigest: candidateDigest,
          carrierManifestDigest: candidateCarrierManifestDigest,
          integration: Object.freeze({
            assessment: { ...reference(assessment), kind: "integration-assessment" as const },
            sourceCandidate: { ...reference(sourceCandidate), kind: "candidate-revision" as const },
            canonicalParent: parentLoaded.snapshot,
          }),
          sealedTree,
          seal: Object.freeze({
            kind: "candidate-seal" as const,
            id: seal.recordId,
            revision: seal.revision,
            digest: seal.digest,
          }),
        }),
      }),
      features: Object.freeze({ historical: false, reachable: false }),
      retrieval: Object.freeze({
        externalLocal: "denied" as const,
        network: "denied" as const,
        authoritySubjectDigest: null,
        sources: Object.freeze([]),
      }),
    };
    const request: FoundationExecutionProjectionRequest = Object.freeze({
      ...requestBase,
      digest: selfDigest(requestBase),
    });
    const parsedRequest = parseProjectionRequest(request);
    assert.equal(parsedRequest.class, "execution");
    assert.deepEqual(parsedRequest.subject.workBoundary, Object.freeze({
      kind: "work-boundary",
      id: boundary.recordId,
      revision: boundary.revision,
      digest: boundary.digest,
    }));
    assert.equal(parsedRequest.subject.candidate?.seal?.revision, seal.revision);
    const predecessorSeal = Object.freeze({
      kind: "candidate-seal" as const,
      id: seal.recordId,
      digest: seal.digest,
    });
    const predecessorCandidate = Object.freeze({
      ...requestBase.subject.candidate,
      seal: predecessorSeal,
    });
    const predecessorSubject = Object.freeze({
      ...requestBase.subject,
      candidate: predecessorCandidate,
    });
    const predecessorRequestBase = Object.freeze({
      ...requestBase,
      subject: predecessorSubject,
    });
    assert.throws(() => parseProjectionRequest(Object.freeze({
      ...predecessorRequestBase,
      digest: selfDigest(predecessorRequestBase),
    })));
    const core = Object.freeze({
      class: "execution" as const,
      objective: "Review the sealed external source.",
      selectedMeaning: "Review only the exact sealed result.",
      included: Object.freeze(["sealed external source"]),
      excluded: Object.freeze(["candidate writes"]),
      assumptions: Object.freeze([]),
      falsifiers: Object.freeze(["changed path omitted"]),
      disciplines: Object.freeze({
        registryDigest: baseKnowledge.disciplineRegistry.digest,
        workTypeIds: Object.freeze([]),
        records: Object.freeze([selectedDiscipline]),
      }),
      obligations: Object.freeze([Object.freeze({
        id: "obligation-projection-control",
        kind: "artifact" as const,
        statement: "The exact sealed external source remains present.",
        sourceIds: Object.freeze([]),
        requiredEvidenceIds: Object.freeze(["artifact-projection-control"]),
      })]),
      requiredArtifacts: Object.freeze([Object.freeze({
        id: "artifact-projection-control",
        path: "docs/external-source.md",
        role: "external-source" as const,
        mustChange: true,
      }), ...(knowledgeChange === "revised" ? [Object.freeze({
        id: "artifact-description",
        path: "docs/_source.desc.md",
        role: "documentation" as const,
        mustChange: true,
      })] : [])]),
      effects: Object.freeze([]),
      risks: Object.freeze([]),
      checks: Object.freeze([]),
      propositions: Object.freeze([Object.freeze({
        id: "proposition-projection-control",
        claim: "The exact sealed external source is present.",
        evidenceKinds: Object.freeze(["artifact" as const]),
        evidenceIds: Object.freeze(["artifact-projection-control"]),
        obligationIds: Object.freeze(["obligation-projection-control"]),
        effectIds: Object.freeze([]),
        riskIds: Object.freeze([]),
        path: "docs/external-source.md",
        checkId: null,
        allowNotApplicable: false,
        notApplicableCondition: null,
      })]),
      capability: Object.freeze({ profileId: capability.id, profileDigest: capability.digest }),
      capabilitySummary: "Read-only reviewer capability.",
      prohibitedEffects: Object.freeze(["candidate writes", "canonical motion"]),
      materialConditionPolicy: "Return an indeterminate decision when exact evidence is absent.",
      completionReturnRules: Object.freeze(["Return one exact decision per proposition."]),
      requestDigest: request.digest,
      workBoundaryDigest: boundary.digest,
    });
    const repositoryAnchor = (await foundationRepositorySourceMaterials({ loaded, maximumItemBytes: profile.maximumItemBytes,
      sourceIds: new Set(["source.repository-context"]) }))[0]!;
    const subjectBase = {
      workBoundary: Object.freeze({
        ...request.subject.workBoundary,
      }),
      core,
      knowledgeRoots: Object.freeze([Object.freeze({ ...disciplineFact, reason: "selected advisory Discipline" })]),
      implementationRoots: Object.freeze(knowledgeChange === "revised" ? [Object.freeze({
        path: "docs/_source.desc.md",
        reason: "selected Description edit",
      })] : []),
      sourceRoots: Object.freeze([{ owner: "source-anchor" as const, sourceId: repositoryAnchor.id,
        reference: repositoryAnchor.reference, revision: repositoryAnchor.revision, digest: repositoryAnchor.digest,
        authority: repositoryAnchor.authority, required: true, reason: "exact repository context" }]),
      candidate: request.subject.candidate,
    };
    const subject: FoundationExecutionProjectionSubject = Object.freeze({
      ...subjectBase,
      subjectDigest: digestCanonical(subjectBase),
    });

    const mandate = object(boundary.payload.mandate, "Work Boundary mandate");
    const selection = (mandate.checks as readonly ControlJsonObject[])[0]!;
    if (typeof selection.id !== "string" || typeof selection.modality !== "string") {
      throw new TypeError("Work Boundary Check selection is not typed text");
    }
    const selectedDefinition = object(selection.definition, "Work Boundary Check definition");
    if (!Array.isArray(selection.bindings) || selection.bindings.length === 0) {
      throw new TypeError("Work Boundary Check selection has no Binding");
    }
    const selectedBinding = object(selection.bindings[0], "Work Boundary Check Binding");
    const receiptPayload = Object.freeze({
      ...validDeliveryControlPayload("check-receipt"),
      selectionId: selection.id,
      definition: selectedDefinition,
      binding: selectedBinding,
      phase: "final",
      modality: selection.modality,
    });
    const receipt = revision({
      id: "receipt.projection-control",
      kind: "check-receipt",
      markdown: "# Check Receipt\n\nThe selected final Check passed.\n",
      payload: receiptPayload,
      relationships: Object.freeze([
        Object.freeze({ relation: "checks-seal", target: reference(seal) }),
      ]),
    });
    const evidenceAttempt = revision({
      id: "attempt.projection-control-evidence",
      kind: "agent-attempt",
      markdown: "# Agent Attempt\n\nOne exact prior builder Attempt.\n",
      payload: validDeliveryControlPayload("agent-attempt"),
      relationships: Object.freeze([
        Object.freeze({
          relation: "uses-brief",
          target: Object.freeze({
            kind: "director-brief",
            id: "brief.projection-control-evidence",
            revision: 1,
            digest: sha256Bytes("brief.projection-control-evidence"),
          }),
        }),
        Object.freeze({ relation: "uses-boundary", target: reference(boundary) }),
        Object.freeze({ relation: "uses-candidate", target: reference(candidate) }),
      ]),
    });
    const evidenceWorkProduct = revision({
      id: "work-product.projection-control-evidence",
      kind: "agent-work-product",
      markdown: "# Builder Work Product\n\nOne exact prior Agent proposal.\n",
      payload: validDeliveryControlPayload("agent-work-product"),
      relationships: Object.freeze([
        Object.freeze({ relation: "result-of", target: reference(evidenceAttempt) }),
      ]),
    });
    await assert.rejects(
      compileExecution({
        request,
        loaded,
        knowledge: baseKnowledge,
        subject,
        workBoundary: boundary,
        candidateObservation: Object.freeze({
          seal,
          candidate,
          treeEntries: candidateEntries,
          knowledge: candidateKnowledge,
          diff: Object.freeze({ digest: diffDigest, bytes: diffBytes }),
        }),
        inventory: new ProjectionByteInventoryBuilder(),
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "lifecycle.projection.reviewer-seal");
        return true;
      },
    );
    const executionInput = {
      request,
      loaded,
      knowledge: baseKnowledge,
      subject,
      workBoundary: boundary,
      candidateObservation: Object.freeze({
        seal,
        candidate,
        treeEntries: candidateEntries,
        knowledge: candidateKnowledge,
        diff: Object.freeze({ digest: diffDigest, bytes: diffBytes }),
      }),
      candidateObjectRepository: candidateRoot,
      integrationParent: { loaded: parentLoaded, knowledge: baseKnowledge },
      integrationRecords: { assessment, sourceCandidate },
      checkReceipts: Object.freeze([receipt]),
      agentWorkProducts: Object.freeze([Object.freeze({
        attempt: evidenceAttempt,
        workProduct: evidenceWorkProduct,
      })]),
    };
    const compiled = await compileExecution({ ...executionInput, inventory: new ProjectionByteInventoryBuilder() });
    // The execution owner preserves all occurrences; the common compiler must
    // also accept that result through its independent completed-value verifier.
    const complete = await compileKnowledgeProjection({
      ...executionInput,
      repository: loaded,
      repositoryValidation,
    });
    assert.equal(complete.validation.complete, true);
    assert.equal(complete.validation.valid, true, canonicalJson(complete.validation.diagnostics));
    if (complete.projection === null) assert.fail("Reviewer Projection did not complete");
    verifyCompiledProjection(complete.projection);

    const repositoryAnchors = compiled.sources.filter(({ reference }) => reference === repositoryAnchor.reference);
    if (knowledgeChange === "unchanged") {
      const failed = revision({ id: "integration.failed", kind: "integration-assessment", markdown: "# Conflicted integration\n",
        payload: { ...assessment.payload, outcome: "conflicted", conflicts: [
          { path: "docs/external-source.md", kind: "content" }, { path: "docs/missing.md", kind: "modify-delete" },
        ], validation: { complete: false, valid: false, diagnosticCodes: [], factsDigest: sha256Bytes("conflict-facts") } },
        relationships: [{ relation: "governed-by", target: reference(boundary) }, { relation: "integrates", target: reference(candidate) }] });
      const corrected = (predecessor: ControlRecordRevision) => revision({ id: predecessor.recordId, kind: "candidate-revision",
        revision: predecessor.revision + 1, markdown: "# Ordinary correction\n", payload: { ...predecessor.payload, observation: "builder-successor" },
        relationships: [{ relation: "governed-by", target: reference(boundary) }, { relation: "revises", target: reference(predecessor) }] });
      const firstCorrection = corrected(candidate);
      const secondCorrection = corrected(firstCorrection);
      const nextBoundary = revision({ id: boundary.recordId, kind: "work-boundary", revision: boundary.revision + 1,
        markdown: "# Readmitted Boundary\n", payload: boundary.payload, relationships: boundary.relationships });
      const retained = new Map([boundary, nextBoundary, candidate, firstCorrection, secondCorrection, failed, assessment]
        .map((record) => [`${record.recordId}\0${record.revision}`, record]));
      const store = { identity: { targetId: contract.targetId, storeId: "correction-test", processId: PROCESS },
        getRevision: (id: string, selectedRevision: number) => retained.get(`${id}\0${selectedRevision}`) ?? null };
      const correction = resolveFailedIntegrationCorrectionV1({ store, assessment: reference(failed), boundary, candidate: secondCorrection });
      assert(correction !== null);
      assert.deepEqual(correction.candidateLineage.map(({ revision }) => revision), [4, 3, 2]);
      assert.equal(resolveFailedIntegrationCorrectionV1({ store, assessment: reference(assessment), boundary, candidate: secondCorrection }), null);
      assert.equal(resolveFailedIntegrationCorrectionV1({ store, assessment: reference(failed), boundary: nextBoundary, candidate: secondCorrection }), null);
      const broken = revision({ id: firstCorrection.recordId, kind: "candidate-revision", revision: 3, markdown: "# Broken base\n",
        payload: { ...firstCorrection.payload, candidateBaseCommit: "f".repeat(40) }, relationships: firstCorrection.relationships });
      assert.throws(() => resolveFailedIntegrationCorrectionV1({ store: { ...store,
        getRevision: (id, selectedRevision) => selectedRevision === 3 && id === broken.recordId ? broken : store.getRevision(id, selectedRevision) },
        assessment: reference(failed), boundary, candidate: broken }), /application base/);
      const builderBase = { ...request, role: "builder" as const, subject: { ...request.subject, candidate: {
        ...request.subject.candidate!, revision: { ...reference(secondCorrection), kind: "candidate-revision" as const }, sealedTree: null, seal: null } } };
      const builderRequest = { ...builderBase, digest: selfDigest(builderBase) };
      const builderSubject = { ...subject, core: { ...subject.core, requestDigest: builderRequest.digest } };
      const correctionOptions = { request: builderRequest, loaded, knowledge: baseKnowledge, subject: builderSubject, workBoundary: boundary,
        failedIntegration: { correction, parent: { loaded: parentLoaded, knowledge: baseKnowledge } } };
      const correctionProjection = await compileExecution({ ...correctionOptions, inventory: new ProjectionByteInventoryBuilder() });
      const inputs = correctionProjection.sources.filter(({ reference }) => reference.startsWith("candidate:integration-correction:"));
      assert.equal(inputs.length, 4, "only A, source C, complete conflict paths, and the one present P blob are mandatory");
      assert.equal(inputs.filter(({ authority }) => authority === "runtime-authenticated-fact").length, 3);
      for (const input of inputs) {
        assert.equal(input.semantic.class, input.authority === "runtime-authenticated-fact" ? "candidate" : "source");
      }
      const bytesFor = (reference: string) => {
        const item = inputs.find((item) => item.reference === reference)!;
        const content = item.content;
        assert.equal(content.mode, "mounted");
        if (content.mode !== "mounted") assert.fail("correction input is not mounted");
        const entry = correctionProjection.inventory.find(({ path }) => path === content.path)!;
        return Buffer.from(entry.bytes, "base64").toString("utf8");
      };
      const paths = JSON.parse(bytesFor("candidate:integration-correction:parent-paths"));
      assert.equal(paths.completeConflictPaths, true);
      assert.deepEqual(paths.paths.map(({ path, disposition }: { path: string; disposition: string }) => [path, disposition]),
        [["docs/external-source.md", "entry"], ["docs/missing.md", "absent"]]);
      assert.deepEqual(paths.entries.map(({ path }: { path: string }) => path), ["docs/external-source.md"]);
      assert.equal(bytesFor(paths.entries[0].sourceReference), priorSource.toString("utf8"));
      assert.equal(inputs.find(({ reference }) => reference === paths.entries[0].sourceReference)!.authority, "repository-reality");
      const admittedIds = new Set(baseKnowledge.currentRecords.map((record) => knowledgeOccurrenceItemId(knowledgeOccurrence(record, "base"))));
      assert.equal(correctionProjection.mandatory.every(({ id }) => admittedIds.has(id)), true,
        "attempted P does not become governing Knowledge");
      const replay = await compileExecution({ ...correctionOptions, inventory: new ProjectionByteInventoryBuilder() });
      assert.deepEqual(replay.sources, correctionProjection.sources);
      await assert.rejects(compileExecution({ ...correctionOptions, failedIntegration: { correction,
        parent: { loaded: { ...parentLoaded, snapshot: loaded.snapshot }, knowledge: baseKnowledge } }, inventory: new ProjectionByteInventoryBuilder() }),
        /exact complete retained attempted parent/);
    }
    assert.equal(repositoryAnchors.length, 2);
    assert.equal(new Set(repositoryAnchors.map(({ id }) => id)).size, 2, "admitted and parent source anchors keep distinct occurrences");
    assert.equal(new Set(compiled.sources.map(({ id }) => id)).size, compiled.sources.length);
    const integrationFacts = compiled.sources.filter(({ reference }) => reference.startsWith("candidate:integration-"));
    assert.equal(integrationFacts.length, 2);
    assert.deepEqual(integrationFacts.map(({ semantic }) => semantic.subjectId).sort(), [assessment.recordId, sourceCandidate.recordId].sort());
    const descriptions = compiled.mandatory.filter(({ sourceIdentity }) =>
      sourceIdentity === "description.projection-control");
    assert.equal(descriptions.length, 3);
    const admittedDescription = baseKnowledge.currentRecords.find(({ frontMatter }) => frontMatter.id === "description.projection-control")!;
    const candidateDescription = candidateKnowledge.currentRecords.find(({ frontMatter }) => frontMatter.id === "description.projection-control")!;
    const admittedItem = descriptions.find(({ id }) => id === knowledgeOccurrenceItemId(knowledgeOccurrence(admittedDescription, "base")))!;
    const parentItem = descriptions.find(({ id }) => id === knowledgeOccurrenceItemId(knowledgeOccurrence(admittedDescription, "integration-parent")))!;
    assert(parentItem);
    assert.notEqual(parentItem.id, admittedItem.id);
    assert.equal(parentItem.sourceDigest, admittedDescription.sourceDigest);
    const candidateItem = descriptions.find(({ id }) => id === knowledgeOccurrenceItemId(knowledgeOccurrence(candidateDescription, "candidate")))!;
    assert(admittedItem.inclusionReasons.includes(
      "description-coverage:docs/external-source.md",
    ));
    assert(!admittedItem.inclusionReasons.includes("candidate-coverage:docs/external-source.md"));
    assert(candidateItem.inclusionReasons.includes(
      "candidate-coverage:docs/external-source.md",
    ));
    assert.equal(admittedItem.revision, 1);
    assert.equal(candidateItem.revision, knowledgeChange === "revised" ? 2 : 1);
    assert.equal(admittedItem.sourceDigest, admittedDescription.sourceDigest);
    assert.equal(candidateItem.sourceDigest, candidateDescription.sourceDigest);
    assert.equal(admittedItem.sourceDigest === candidateItem.sourceDigest, knowledgeChange === "unchanged");
    assert(compiled.implementation.every(({ path }) => !path.endsWith(".desc.md")));
    if (knowledgeChange === "revised") {
      assert(admittedItem.inclusionReasons.includes("required-artifact:artifact-description"));
      assert(admittedItem.inclusionReasons.includes("work-boundary:selected Description edit"));
    }
    for (const item of descriptions) {
      assert.equal(item.content.mode, "mounted");
      if (item.content.mode !== "mounted") assert.fail("Expected mounted Knowledge bytes");
      const path = item.content.path;
      const bytes = Buffer.from(compiled.inventory.find((entry) => entry.path === path)!.bytes, "base64");
      assert.equal(sha256Bytes(bytes), item.sourceDigest);
    }

    const disciplineItem = compiled.mandatory.find(({ sourceIdentity }) => sourceIdentity === TEST_DISCIPLINE_ID);
    assert(disciplineItem !== undefined);
    assert.equal(disciplineItem.authority, "discipline-guidance");
    assert.match(disciplineItem.useLimit ?? "", /Admitted basis occurrence.*Advisory Discipline/u);
    assert.equal(disciplineItem.content.mode, "mounted");
    if (disciplineItem.content.mode !== "mounted") assert.fail("Reviewer Discipline was not mounted");
    const disciplinePath = disciplineItem.content.path;
    const disciplineBytes = compiled.inventory.find(({ path }) => path === disciplinePath);
    assert(disciplineBytes !== undefined);
    assert.equal(Buffer.from(disciplineBytes.bytes, "base64").toString("utf8"), discipline.sourceText);
    const disciplineOccurrences = complete.projection.manifest.mandatory.filter(
      ({ sourceIdentity }) => sourceIdentity === TEST_DISCIPLINE_ID,
    );
    const expectedOccurrenceIds = ["base", "integration-parent", "candidate"].map((basis) =>
      knowledgeOccurrenceItemId(knowledgeOccurrence(discipline, basis as "base" | "integration-parent" | "candidate")),
    );
    assert.deepEqual(disciplineOccurrences.map(({ id }) => id).sort(), [...expectedOccurrenceIds].sort());
    for (const item of disciplineOccurrences) {
      assert.equal(item.authority, "discipline-guidance");
      assert.equal(item.sourceDigest, discipline.sourceDigest);
      assert.equal(item.semanticDigest, discipline.semanticDigest);
    }
    const admittedDisciplineId = expectedOccurrenceIds[0]!;
    const manifest = complete.projection.manifest;
    if (manifest.core.class !== "execution") assert.fail("Reviewer requires an execution core");
    const refusal = (changed: typeof manifest, expectedCode = "lifecycle.projection.discipline-invalid") => {
      const changedProjection = { ...complete.projection!, manifest: { ...changed, digest: selfDigest(changed) } };
      assert.throws(() => verifyCompiledProjection(changedProjection),
        (error: unknown) => (error as { code?: string }).code === expectedCode);
    };
    // Equal Candidate/parent bytes cannot stand in for the admitted occurrence.
    refusal({ ...manifest, mandatory: manifest.mandatory.filter(({ id }) => id !== admittedDisciplineId) });
    for (const changed of [
      { ...selectedDiscipline, revision: selectedDiscipline.revision + 1 },
      { ...selectedDiscipline, sourceDigest: sha256Bytes("another adopted source") },
      { ...selectedDiscipline, semanticDigest: sha256Bytes("another adopted meaning") },
      { ...selectedDiscipline, path: "records/disciplines/another.md" },
    ]) {
      refusal({ ...manifest, core: { ...manifest.core, disciplines: { ...manifest.core.disciplines, records: [changed] } } });
    }
    refusal({ ...manifest, mandatory: manifest.mandatory.map((item) => item.id === admittedDisciplineId
      ? { ...item, authority: "product-knowledge" as const } : item) }, "lifecycle.schema.invalid");
    // Refusal leaves the original exact result usable; no occurrence is retired.
    verifyCompiledProjection(complete.projection);

    const candidateDiff = compiled.sources.find(({ reference: selected }) =>
      selected === "candidate:sealed-diff");
    const candidateArtifacts = compiled.sources.find(({ reference: selected }) =>
      selected === "candidate:artifact-set");
    const sealSource = compiled.sources.find(({ reference: selected }) =>
      selected === `candidate:candidate-seal:${seal.recordId}`);
    const receiptSource = compiled.sources.find(({ reference: selected }) =>
      selected === `evidence:check-receipt:${receipt.recordId}`);
    const workProductSource = compiled.sources.find(({ reference: selected }) =>
      selected === `evidence:agent-work-product:${evidenceWorkProduct.recordId}`);
    assert(candidateDiff !== undefined);
    assert(candidateArtifacts !== undefined);
    assert(sealSource !== undefined);
    assert(receiptSource !== undefined);
    assert(workProductSource !== undefined);
    assert.equal(candidateDiff.semantic.subjectDigest, diffDigest);
    assert.equal(candidateArtifacts.semantic.subjectDigest, artifactSetDigest);
    assert.equal(sealSource.digest, seal.digest);
    assert.equal(sealSource.revision, seal.digest);
    assert.equal(receiptSource.digest, receipt.digest);
    assert.equal(receiptSource.revision, receipt.digest);
    assert.equal(workProductSource.digest, evidenceWorkProduct.digest);
    assert.equal(workProductSource.semantic.evidenceKind, "agent-work-product");
    assert.equal(workProductSource.semantic.subjectDigest, evidenceWorkProduct.digest);
    assert.equal(workProductSource.authority, "agent-proposed-claim");
    assert.equal(sealSource.content.mode, "mounted");
    assert.equal(receiptSource.content.mode, "mounted");
    assert.equal(workProductSource.content.mode, "mounted");
    if (sealSource.content.mode !== "mounted") throw new TypeError("Candidate Seal view was not mounted");
    if (receiptSource.content.mode !== "mounted") throw new TypeError("Check Receipt view was not mounted");
    const sealPath = sealSource.content.path;
    const receiptPath = receiptSource.content.path;
    const mountedSeal = compiled.inventory.find(({ path }) => path === sealPath)!;
    const mountedReceipt = compiled.inventory.find(({ path }) => path === receiptPath)!;
    const sealMarkdown = Buffer.from(mountedSeal.bytes, "base64").toString("utf8");
    const receiptMarkdown = Buffer.from(mountedReceipt.bytes, "base64").toString("utf8");
    assert.match(sealMarkdown, /^---\n\{/u);
    assert.match(sealMarkdown, /"recordKind": "candidate-seal"/u);
    assert.match(sealMarkdown, /# Candidate Seal/u);
    assert.match(receiptMarkdown, /"payload": \{/u);
    assert.match(receiptMarkdown, /"disposition": "pass"/u);
    assert.match(receiptMarkdown, /# Check Receipt/u);
    assert.notEqual(sha256Bytes(Buffer.from(receiptMarkdown, "utf8")), receipt.digest);
    assert.equal(canonicalJson(candidate.payload.state), canonicalJson(candidatePayload.state));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(candidateRoot, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});
}
