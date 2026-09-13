import { createEmptyDisciplineRegistry } from "../../src/foundation/knowledge/discipline-registry.js";
import { foundationDisciplineAdoptionFixture } from "../helpers/foundation-discipline-fixture.js";
import type { FoundationAtlasNormalizedModel } from "../../src/foundation/atlas/types.js";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileControlRecordRevision } from "../../src/foundation/control/model.js";
import type { ControlJsonObject, ControlRecordRevision } from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import { buildRelationshipEdges } from "../../src/foundation/knowledge/relationships.js";
import { buildDescriptionCoverage } from "../../src/foundation/knowledge/coverage.js";
import type {
  FoundationKnowledgeIndex,
  FoundationKnowledgeSet,
} from "../../src/foundation/knowledge/types.js";
import { parseKnowledgeRecord } from "../../src/foundation/knowledge/records.js";
import { compareFoundationIntegrationContextV1 } from "../../src/foundation/projection/integration-context.js";
import { compileExecution } from "../../src/foundation/projection/execution.js";
import { seedSubject } from "../../src/foundation/projection/execution-closure.js";
import { ProjectionByteInventoryBuilder } from "../../src/foundation/projection/content.js";
import { compileAtlasProjection } from "../../src/foundation/projection/atlas.js";
import {
  atlasPointRecordKey,
  planAtlasExecutionClosure,
} from "../../src/foundation/projection/atlas-execution-closure.js";
import { parseProjectionRequest } from "../../src/foundation/projection/request.js";
import { bindFoundationMandatoryProjectionRefusalV1 } from "../../src/foundation/projection/mandatory-refusal.js";
import { atlasResourceSourceId } from "../../src/foundation/projection/source-context.js";
import type {
  FoundationExecutionProjectionRequest,
  FoundationExecutionProjectionSubject,
} from "../../src/foundation/projection/types.js";
import { compileFoundationExecutionProjectionSubjectV7 } from "../../src/foundation/process/operation-context-v7.js";
import { createRepositoryContract } from "../../src/foundation/repository/contract.js";
import { git } from "../../src/foundation/repository/git.js";
import { commandCheckBinding } from "../../src/foundation/repository/initialize.js";
import type { FoundationLoadedRepositorySnapshot } from "../../src/foundation/repository/types.js";
import { digestCanonical, selfDigest, sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { DiagnosticCollector } from "../../src/foundation/validation/result.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";
import { minimalAtlasRepositoryState } from "../helpers/atlas-fixture.js";

const COMMIT = "1".repeat(40);
const TREE = "2".repeat(40);
const PUBLICATION = sha256Bytes("projection-execution-publication");

const SECTIONS = {
  behavior: ["Meaning", "Boundaries", "Examples", "Rationale"],
  assurance: ["Obligation", "Failure Model", "Limits", "Rationale"],
  check: ["Proposition", "Evaluation", "Evidence", "Limits"],
} as const;

function spec(kind: keyof typeof SECTIONS): Record<string, unknown> {
  if (kind === "behavior") return {
    outcome: "The exact selected behavior is implemented.",
    actors: ["director"],
    conditions: [],
    included: ["selected result"],
    excluded: ["unselected result"],
    examples: ["one exact result"],
    falsifiers: ["selected result is absent"],
  };
  if (kind === "assurance") return {
    obligation: "The selected result remains bounded.",
    scope: ["selected result"],
    failureModes: ["unbounded result"],
    limits: ["one exact repository epoch"],
    degradation: [],
    falsifiers: ["bound is exceeded"],
  };
  return {
    proposition: "The selected result is present.",
    subjects: [{ kind: "candidate", selector: "selected-result" }],
    evidenceKinds: ["command"],
    requiredBindings: ["selected-result-check"],
    evaluation: { pass: "result is present", fail: "result is absent", indeterminate: "subject unavailable", notRun: "not executed" },
    limits: ["one exact subject"],
    freshness: { subjectBinding: "exact", maximumAgeMs: null, environmentBinding: "exact" },
    falsifiers: ["result is absent"],
  };
}

function document(options: {
  kind: keyof typeof SECTIONS;
  id: string;
  title: string;
  relationships: readonly Readonly<{ type: string; target: string; required: boolean }>[];
}): Buffer {
  const frontMatter = {
    schema: "lifecycle.knowledge-record.v2",
    kind: options.kind,
    id: options.id,
    title: options.title,
    status: "current",
    revision: 1,
    supersedes: null,
    summary: `${options.title} summary.`,
    owners: ["director"],
    sources: [],
    relationships: options.relationships,
    conflicts: [],
    tags: [],
    spec: spec(options.kind),
  };
  return Buffer.from(`---\n${JSON.stringify(frontMatter, null, 2)}\n---\n\n# ${options.title}\n\n${SECTIONS[options.kind].map((section) => `## ${section}\n\n${section} details.`).join("\n\n")}\n`, "utf8");
}

function fixture(): Readonly<{
  loaded: FoundationLoadedRepositorySnapshot;
  knowledge: FoundationKnowledgeSet;
  request: FoundationExecutionProjectionRequest;
  subject: FoundationExecutionProjectionSubject;
  workBoundary: ControlRecordRevision;
}> {
  const binding = commandCheckBinding({
    id: "selected-result-check",
    checkIds: ["check.selected-result"],
    subjectSelectors: [{ kind: "candidate", selector: "selected-result" }],
    executable: { relativeTo: "execution-image", path: "usr/bin/true" },
  });
  const contract = createRepositoryContract({
    targetId: "projection-execution-target",
    canonicalBranch: "refs/heads/main",
    authority: { principalId: "director", keyId: "director-key", publicKey: `ed25519:${Buffer.alloc(32, 7).toString("base64")}` },
    publicationDigest: PUBLICATION,
    implementationRoots: [],
    checkBindings: { [binding.id]: binding },
  });
  const inputs = [
    { path: "records/behavior/selected-result.md", objectId: "4".repeat(40), bytes: document({ kind: "behavior", id: "behavior.selected-result", title: "Selected result", relationships: [{ type: "verified-by", target: "check.selected-result", required: true }] }) },
    { path: "records/assurance/selected-result.md", objectId: "5".repeat(40), bytes: document({ kind: "assurance", id: "assurance.selected-result", title: "Selected result bound", relationships: [{ type: "constrains", target: "behavior.selected-result", required: true }, { type: "verified-by", target: "check.selected-result", required: true }] }) },
    { path: "records/checks/selected-result.md", objectId: "6".repeat(40), bytes: document({ kind: "check", id: "check.selected-result", title: "Selected result check", relationships: [] }) },
  ];
  const records = inputs.map((input) => parseKnowledgeRecord({ ...input, mode: "100644", contract }));
  const current = new Map(records.map((record) => [record.frontMatter.id, record]));
  const revisions = new Map(records.map((record) => [record.frontMatter.id, Object.freeze([record])]));
  const relationshipCollector = new DiagnosticCollector();
  const relationships = buildRelationshipEdges({
    records,
    revisionsByIdentity: revisions,
    currentByIdentity: current,
    collector: relationshipCollector,
    limits: contract.knowledge.limits,
  });
  assert.equal(relationshipCollector.diagnostics.length, 0);
  const outgoing = new Map<string, typeof relationships>();
  const incoming = new Map<string, typeof relationships>();
  for (const record of records) {
    outgoing.set(record.frontMatter.id, Object.freeze(relationships.filter((edge) => edge.source === record.frontMatter.id)));
    incoming.set(record.frontMatter.id, Object.freeze(relationships.filter((edge) => edge.target === record.frontMatter.id)));
  }
  const atlasFixture = minimalAtlasRepositoryState();
  const atlasStateDigest = atlasFixture.atlasState.digest;
  const atlas = atlasFixture.atlas;
  const repositoryBasis = {
    targetId: contract.targetId,
    commit: COMMIT,
    tree: TREE,
    objectFormat: "sha1" as const,
    contractDigest: contract.digest,
    productStateDigest: digestCanonical([]),
    atlasStateDigest,
    atlasResolutionDigest: atlas.resolution.digest,
    atlasNormalizedModelDigest: atlas.resolution.normalizedModelDigest,
    atlasResourceBindingsDigest: atlas.resolution.resourceBindingsDigest,
  };
  const manifestBase = {
    schema: "lifecycle.knowledge-set.v2" as const,
    specificationRevision: contract.specification.revision,
    profile: "knowledge-set-v2" as const,
    repository: repositoryBasis,
    disciplineRegistry: createEmptyDisciplineRegistry(),
    records: records.map((record) => ({
      kind: record.frontMatter.kind,
      id: record.frontMatter.id,
      status: record.frontMatter.status,
      revision: record.frontMatter.revision,
      path: record.path,
      sourceDigest: record.sourceDigest,
      semanticDigest: record.semanticDigest,
    })),
    relationships,
    sources: [],
    conflicts: [],
    coverage: [],
    exemptions: [],
    bindings: [{ checkId: "check.selected-result", bindingId: binding.id, bindingDigest: binding.digest }],
    complete: true,
    valid: true,
  };
  const manifest = Object.freeze({ ...manifestBase, digest: selfDigest(manifestBase as unknown as Record<string, unknown>) });
  const validation = new DiagnosticCollector().result({
    profile: "knowledge-set-v2",
    publicationDigest: contract.specification.publicationDigest,
    subjectKind: "repository-knowledge",
    subjectId: contract.targetId,
    subjectDigest: manifest.digest,
    subjectRevision: COMMIT,
    stages: ["manifest"],
  });
  const index: FoundationKnowledgeIndex = Object.freeze({
    byIdentityRevision: new Map(records.map((record) => [`${record.frontMatter.id}\0${record.frontMatter.revision}`, record])),
    revisionsByIdentity: revisions,
    currentByIdentity: current,
    outgoingByIdentity: outgoing,
    incomingByIdentity: incoming,
    coverageByPath: new Map(),
    coveredPathsByDescription: new Map(),
    bindingsByCheck: new Map([["check.selected-result", Object.freeze([binding])]]),
    sourcesByIdentityRevision: new Map(),
  });
  const knowledge: FoundationKnowledgeSet = Object.freeze({
    repository: Object.freeze({
      path: "/unread-projection-fixture",
      contract,
      commit: COMMIT,
      tree: TREE,
      objectFormat: "sha1",
      productStateDigest: repositoryBasis.productStateDigest,
      atlasStateDigest: repositoryBasis.atlasStateDigest,
      atlasResolutionDigest: repositoryBasis.atlasResolutionDigest,
      atlasNormalizedModelDigest: repositoryBasis.atlasNormalizedModelDigest,
      atlasResourceBindingsDigest: repositoryBasis.atlasResourceBindingsDigest,
    }),
    records: Object.freeze(records),
    currentRecords: Object.freeze(records),
    historicalRecords: Object.freeze([]),
    disciplineRegistry: manifest.disciplineRegistry,
    relationships,
    coverage: Object.freeze([]),
    exemptions: Object.freeze([]),
    bindings: Object.freeze([{ checkId: "check.selected-result", binding }]),
    sources: Object.freeze([]),
    conflicts: Object.freeze([]),
    validation,
    manifest,
    index,
  });
  const snapshotBase = { ...repositoryBasis, knowledgeSetDigest: manifest.digest };
  const loaded: FoundationLoadedRepositorySnapshot = Object.freeze({
    repository: "/unread-projection-fixture",
    contract,
    epoch: Object.freeze({ ref: contract.canonicalBranch, commit: COMMIT, tree: TREE, objectFormat: "sha1" }),
    treeEntries: atlasFixture.treeEntries,
    productState: Object.freeze({ entries: Object.freeze([]), digest: repositoryBasis.productStateDigest }),
    atlasState: atlasFixture.atlasState,
    atlas,
    worktree: Object.freeze({ dirty: false, modified: Object.freeze([]), untracked: Object.freeze([]), ignored: Object.freeze([]) }),
    snapshot: Object.freeze({ ...snapshotBase, digest: digestCanonical(snapshotBase) }),
  });
  const behavior = current.get("behavior.selected-result")!;
  const selectedCheck = current.get("check.selected-result")!;
  const capability = loaded.contract.capabilityProfiles[loaded.contract.defaults.capabilityProfileId]!;
  const profile = contract.projectionProfiles["execution-standard-v1"]!;
  const workBoundaryPayload = validDeliveryControlPayload("work-boundary");
  const workBoundaryMandate = workBoundaryPayload.mandate as ControlJsonObject;
  const workBoundaryDirection = workBoundaryMandate.direction as ControlJsonObject;
  const directionId = String(workBoundaryDirection.id);
  const workBoundary = compileControlRecordRevision("delivery.projection-execution", {
    recordId: "boundary.selected-result",
    recordKind: "work-boundary",
    revision: 1,
    producer: Object.freeze({ kind: "runtime", id: "runtime.projection-execution" }),
    semanticAuthor: Object.freeze({ kind: "runtime", id: "runtime.projection-execution" }),
    semanticAuthority: "runtime-derived",
    createdAt: "2026-08-22T00:00:00.000Z",
    semanticMarkdown: "# Work Boundary\n\nThe exact selected result is admitted.\n",
    payload: Object.freeze({
      ...workBoundaryPayload,
      targetId: contract.targetId,
      disciplines: Object.freeze({ registryDigest: knowledge.disciplineRegistry.digest, workTypeIds: Object.freeze([]), records: Object.freeze([]) }),
      basis: Object.freeze({
        specificationRevision: contract.specification.revision,
        repositoryContract: "lifecycle.repository.v22",
        providerAdapter: "lifecycle.provider-adapter.v7",
        productBaseCommit: COMMIT,
        productBaseTree: TREE,
        productStateDigest: repositoryBasis.productStateDigest,
        atlasStateDigest: repositoryBasis.atlasStateDigest,
        atlasResolutionDigest: repositoryBasis.atlasResolutionDigest,
        atlasNormalizedModelDigest: repositoryBasis.atlasNormalizedModelDigest,
        atlasResourceBindingsDigest: repositoryBasis.atlasResourceBindingsDigest,
        repositoryContractDigest: contract.digest,
        knowledgeSetDigest: manifest.digest,
        repositorySnapshotDigest: loaded.snapshot.digest,
      }),
      knowledge: Object.freeze([behavior, selectedCheck].map((record) => Object.freeze({
        id: record.frontMatter.id,
        revision: record.frontMatter.revision,
        sourceDigest: record.sourceDigest,
        semanticDigest: record.semanticDigest,
      }))),
      externalSources: Object.freeze([]),
      capabilityProfile: Object.freeze({ id: capability.id, digest: capability.digest }),
      projectionProfile: Object.freeze({ id: profile.id, digest: profile.digest }),
      mandate: Object.freeze({
        ...workBoundaryMandate,
        obligations: Object.freeze([Object.freeze({
          id: "obligation.selected-result",
          kind: "behavior",
          statement: "Selected result exists.",
          sourceIds: Object.freeze([behavior.frontMatter.id, directionId]),
          requiredEvidenceArtifactIds: Object.freeze([]),
          severity: "required",
          propositionIds: Object.freeze(["proposition.selected-result"]),
          fragmentDigest: sha256Bytes("obligation.selected-result"),
        })]),
        artifacts: Object.freeze([Object.freeze({
          id: "artifact.selected-result",
          path: behavior.path,
          role: "behavior",
          mustChange: false,
          obligationIds: Object.freeze(["obligation.selected-result"]),
          changeRule: "The exact selected Behavior remains the governed meaning source.",
          fragmentDigest: sha256Bytes("artifact.selected-result"),
        })]),
        checks: Object.freeze([Object.freeze({
          id: "selection.selected-result",
          definition: Object.freeze({
            id: selectedCheck.frontMatter.id,
            revision: selectedCheck.frontMatter.revision,
            sourceDigest: selectedCheck.sourceDigest,
            semanticDigest: selectedCheck.semanticDigest,
          }),
          bindings: Object.freeze([Object.freeze({
            id: binding.id,
            digest: binding.digest,
            implementationDigest: binding.implementationDigest,
          })]),
          modality: "postcondition",
          purpose: "Establish the selected result.",
          baselineRequired: true,
          finalRequired: true,
          obligationIds: Object.freeze(["obligation.selected-result"]),
          environmentRequirements: Object.freeze([]),
          fragmentDigest: sha256Bytes("selection.selected-result"),
        })]),
        acceptancePropositions: Object.freeze([Object.freeze({
          id: "proposition.selected-result",
          claim: "Selected result exists.",
          evidenceKinds: Object.freeze(["check"]),
          evidenceArtifactIds: Object.freeze([]),
          obligationIds: Object.freeze(["obligation.selected-result"]),
          effectIds: Object.freeze([]),
          riskIds: Object.freeze([]),
          path: null,
          checkId: "selection.selected-result",
          allowNotApplicable: false,
          notApplicableCondition: null,
          fragmentDigest: sha256Bytes("proposition.selected-result"),
        })]),
      }),
    }),
    relationships: Object.freeze([
      Object.freeze({
        relation: "uses-brief",
        target: Object.freeze({
          kind: "director-brief",
          id: "brief.projection-execution",
          revision: 1,
          digest: sha256Bytes("brief.projection-execution"),
        }),
      }),
      Object.freeze({
        relation: "proposed-from",
        target: Object.freeze({
          kind: "agent-work-product",
          id: "work-product.projection-execution",
          revision: 1,
          digest: sha256Bytes("work-product.projection-execution"),
        }),
      }),
    ]),
  });
  const boundaryDigest = workBoundary.digest;
  const candidateDigest = sha256Bytes("candidate");
  const requestBase = {
    schema: "lifecycle.projection-request.v5" as const,
    class: "execution" as const,
    role: "builder" as const,
    specificationRevision: contract.specification.revision,
    target: Object.freeze({ id: contract.targetId, generation: contract.generation }),
    repository: Object.freeze({
      commit: COMMIT,
      tree: TREE,
      objectFormat: "sha1" as const,
      repositoryEpochDigest: digestCanonical(repositoryBasis),
      productStateDigest: repositoryBasis.productStateDigest,
      repositoryContractDigest: contract.digest,
      repositorySnapshotDigest: loaded.snapshot.digest,
      validationDigest: sha256Bytes("repository-validation"),
      complete: true,
      valid: true,
    }),
    atlas: Object.freeze({
      root: contract.atlas.root,
      entrypoint: contract.atlas.entrypoint,
      specificationRevision: contract.atlas.selection.specificationRevision,
      processorRevision: contract.atlas.selection.processorRevision,
      stateDigest: repositoryBasis.atlasStateDigest,
      resolutionDigest: repositoryBasis.atlasResolutionDigest,
      normalizedModelDigest: repositoryBasis.atlasNormalizedModelDigest,
      resourceBindingsDigest: atlas.resolution.resourceBindingsDigest,
      complete: true,
      valid: true,
    }),
    knowledge: Object.freeze({
      knowledgeObservationDigest: manifest.digest,
      knowledgeSetDigest: manifest.digest,
      knowledgeValidationDigest: validation.digest,
      complete: true,
      valid: true,
    }),
    profile,
    subject: Object.freeze({
      class: "execution" as const,
      workBoundary: Object.freeze({
        kind: "work-boundary" as const,
        id: "boundary.selected-result",
        revision: 1,
        digest: boundaryDigest,
      }),
      candidate: Object.freeze({
        baseCommit: COMMIT,
        revision: Object.freeze({
          kind: "candidate-revision" as const,
          id: "candidate.selected-result",
          revision: 1,
          digest: sha256Bytes("candidate.selected-result"),
        }),
        stateDigest: candidateDigest,
        carrierManifestDigest: sha256Bytes("candidate.selected-result.carrier-manifest"),
        sealedTree: null,
        seal: null,
        integration: null,
      }),
    }),
    features: Object.freeze({ historical: false, reachable: false }),
    retrieval: Object.freeze({ externalLocal: "denied" as const, network: "denied" as const, authoritySubjectDigest: null, sources: Object.freeze([]) }),
  };
  const parsedRequest = parseProjectionRequest(Object.freeze({
    ...requestBase,
    digest: selfDigest(requestBase as unknown as Record<string, unknown>),
  }));
  assert.equal(parsedRequest.class, "execution");
  const request = parsedRequest;
  const subject = compileFoundationExecutionProjectionSubjectV7({
    snapshot: loaded,
    knowledge,
    boundary: workBoundary,
    request,
    role: "builder",
  });
  return Object.freeze({ loaded, knowledge, request, subject, workBoundary });
}

test("Execution Projection closes selected meaning through constraints, Checks, and exact Bindings deterministically", async () => {
  const value = fixture();
  const first = await compileExecution({ ...value, inventory: new ProjectionByteInventoryBuilder() });
  const second = await compileExecution({ ...value, inventory: new ProjectionByteInventoryBuilder() });
  assert.deepEqual(first, second);
  const capability = value.loaded.contract.capabilityProfiles[value.loaded.contract.defaults.capabilityProfileId]!;
  assert.deepEqual(value.subject.core.capability, { profileId: capability.id, profileDigest: capability.digest });
  const boundaryDirectionId = String(
    ((value.workBoundary.payload.mandate as ControlJsonObject).direction as ControlJsonObject).id,
  );
  assert.deepEqual(value.subject.core.obligations[0]?.sourceIds, [
    "behavior.selected-result",
    boundaryDirectionId,
  ]);
  assert.deepEqual(value.subject.core.propositions, [{
    id: "proposition.selected-result",
    claim: "Selected result exists.",
    evidenceKinds: ["check"],
    evidenceIds: [],
    obligationIds: ["obligation.selected-result"],
    effectIds: [],
    riskIds: [],
    path: null,
    checkId: "selection.selected-result",
    allowNotApplicable: false,
    notApplicableCondition: null,
  }]);
  assert.deepEqual(first.mandatory.map((item) => item.sourceIdentity), [
    "behavior.selected-result",
    "assurance.selected-result",
    "check.selected-result",
  ]);
  assert.deepEqual(first.sources, []);
  assert.equal(first.bindings.length, 1);
  assert.deepEqual(first.bindings[0]?.checkIds, ["check.selected-result"]);
  assert.deepEqual(first.bindings[0]?.compatibleCheckIds, ["check.selected-result"]);
  assert.equal(first.bindings[0]?.binding.digest, value.loaded.contract.checkBindings["selected-result-check"]?.digest);
  assert.equal(first.omission.mandatoryOmissions, 0);
  assert.equal(first.unresolved.length, 0);
});

test("directory Artifact closure resolves descendants and keeps unchanged ownership applicable as files appear or disappear", () => {
  const value = fixture();
  const contract = { ...value.loaded.contract, productState: {
    ...value.loaded.contract.productState, governedImplementationRoots: ["src"],
  } };
  const description = (id: string, path: string, exclude: string[] = []) => {
    const fields = {
      schema: "lifecycle.knowledge-record.v2", kind: "description", id,
      title: id, status: "current", revision: 1, supersedes: null,
      summary: "Own the exact descendant files.", owners: ["director"],
      sources: [], relationships: [], conflicts: [], tags: [],
      spec: { responsibility: "Own these source files.",
        coverage: [{ path, mode: "tree", role: "primary", exclude }],
        behavior: ["bounded result"], boundaries: ["selected files"],
        invariants: ["exact ownership"], dependencies: [], failure: ["wrong result"], rationale: ["one owner"] },
    };
    return parseKnowledgeRecord({ path: `_${id}.desc.md`, mode: "100644", objectId: "d".repeat(40), contract,
      bytes: Buffer.from(`---\n${JSON.stringify(fields, null, 2)}\n---\n\n# ${id}\n\n## Responsibility\n\nOwn these files.\n\n## Behavior\n\nBounded result.\n\n## Boundaries\n\nSelected files.\n\n## Rationale\n\nOne owner.\n`) });
  };
  const owners = [description("description.feature", "src/feature", ["src/feature/nested"]),
    description("description.nested", "src/feature/nested"), description("description.adjacent", "src/adjacent")];
  const currentRecords = [...value.knowledge.currentRecords, ...owners];
  const knowledge = { ...value.knowledge, records: currentRecords, currentRecords,
    index: { ...value.knowledge.index, currentByIdentity: new Map(currentRecords.map((record) => [record.frontMatter.id, record])) } };
  const entries = ["src/adjacent/other.ts", "src/feature/a.ts", "src/feature/nested/b.ts"].map((path) => ({
    path, role: "governed-implementation" as const, mode: "100644" as const, objectId: "e".repeat(40),
  }));
  const loaded = { ...value.loaded, contract, productState: { entries, digest: digestCanonical(entries) } };
  const subject = { ...value.subject, implementationRoots: [], core: { ...value.subject.core,
    requiredArtifacts: [{ id: "artifact.feature", path: "src/feature", role: "code" as const, mustChange: true }] } };
  const selected = seedSubject({ loaded, knowledge, subject, boundary: value.workBoundary });
  assert.deepEqual([...selected.implementationReasons], [
    ["src/feature/a.ts", ["required-artifact:artifact.feature"]],
    ["src/feature/nested/b.ts", ["required-artifact:artifact.feature"]],
  ]);
  assert.deepEqual(selected.seeds.filter(({ reason }) => reason.startsWith("description-coverage:")), [
    { id: "description.feature", reason: "description-coverage:src/feature/a.ts" },
    { id: "description.nested", reason: "description-coverage:src/feature/nested/b.ts" },
  ]);
  const missingOwner = { ...knowledge, currentRecords: currentRecords.filter((record) => record !== owners[1]) };
  assert.throws(() => seedSubject({ loaded, knowledge: missingOwner, subject, boundary: value.workBoundary }),
    (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.projection.description-missing");
  const ambiguous = { ...knowledge, currentRecords: [...currentRecords, description("description.duplicate", "src/feature/nested")] };
  assert.throws(() => seedSubject({ loaded, knowledge: ambiguous, subject, boundary: value.workBoundary }),
    (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.projection.description-ambiguous");
  const exactFile = { ...subject, core: { ...subject.core, requiredArtifacts: [
    { ...subject.core.requiredArtifacts[0]!, path: "src/feature/a.ts" },
  ] } };
  assert.deepEqual([...seedSubject({ loaded, knowledge, subject: exactFile, boundary: value.workBoundary }).implementationReasons.keys()],
    ["src/feature/a.ts"]);

  const emptyEntries = entries.filter(({ path }) => path.startsWith("src/adjacent/"));
  const empty = { ...loaded, productState: { entries: emptyEntries, digest: digestCanonical(emptyEntries) },
    treeEntries: [...loaded.treeEntries, { path: owners[0]!.path, mode: "100644", type: "blob" as const, objectId: "d".repeat(40) }] };
  assert(!empty.treeEntries.some(({ path }) => path === "src/feature" || path.startsWith("src/feature/")));
  const future = seedSubject({ loaded: empty, knowledge, subject, boundary: value.workBoundary });
  assert.deepEqual([...future.implementationReasons], []);
  assert.deepEqual(future.seeds.filter(({ reason }) => reason.startsWith("required-artifact-tree:")), [
    { id: "description.feature", reason: "required-artifact-tree:src/feature" },
  ]);
  for (const [selectedKnowledge, code] of [
    [{ ...knowledge, currentRecords: currentRecords.filter((record) => record !== owners[0]) }, "description-missing"],
    [{ ...knowledge, currentRecords: [...currentRecords, description("description.duplicate-tree", "src/feature")] }, "description-ambiguous"],
    [{ ...knowledge, currentRecords: [...currentRecords, description("description.parent", "src")] }, "description-ambiguous"],
    [{ ...knowledge, currentRecords: [...currentRecords.filter((record) => record !== owners[0]),
      description("description.excluding-parent", "src", ["src/feature"])] }, "description-missing"],
  ] as const) {
    assert.throws(() => seedSubject({ loaded: empty, knowledge: selectedKnowledge, subject, boundary: value.workBoundary }),
      (error: unknown) => error instanceof FoundationError && error.code === `lifecycle.projection.${code}`);
  }
  const excludedParent = { ...knowledge, currentRecords: [...currentRecords,
    description("description.excluding-parent", "src", ["src/feature"])] };
  assert.deepEqual(seedSubject({ loaded: empty, knowledge: excludedParent, subject, boundary: value.workBoundary }).seeds,
    future.seeds);
  // A real node at the same path still requires file coverage; a tree selector
  // cannot authorize it merely because the Product State inventory omits it.
  const occupied = { ...empty, treeEntries: [...empty.treeEntries,
    { path: "src/feature", mode: "100644", type: "blob" as const, objectId: "f".repeat(40) }] };
  assert.throws(() => seedSubject({ loaded: occupied, knowledge, subject, boundary: value.workBoundary }),
    (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.projection.description-missing");

  const mandate = value.workBoundary.payload.mandate as ControlJsonObject;
  const artifact = (mandate.artifacts as readonly ControlJsonObject[])[0]!;
  const boundary = compileControlRecordRevision(value.workBoundary.processId, { ...value.workBoundary,
    payload: { ...value.workBoundary.payload, mandate: { ...mandate,
      artifacts: [{ ...artifact, id: "artifact.feature", path: "src/feature", role: "code" }],
    } },
  });
  const measuredContext = (paths: readonly string[], selectedOwners = owners,
    selectedContract = contract, objectId = "e".repeat(40)) => {
    const implementation = paths.map((path) => ({ path, role: "governed-implementation" as const,
      mode: "100644" as const, objectId }));
    const treeEntries = [...value.loaded.treeEntries, ...implementation.map((entry) => ({ ...entry, type: "blob" as const }))];
    const collector = new DiagnosticCollector();
    const observed = buildDescriptionCoverage({ contract: selectedContract, treeEntries,
      currentDescriptions: selectedOwners, collector });
    const records = [...value.knowledge.currentRecords, ...selectedOwners];
    const manifest = { ...value.knowledge.manifest, coverage: observed.coverage.map(({ mode: _mode, objectId: _objectId, ...entry }) => entry),
      exemptions: observed.exemptions };
    return { diagnostics: collector.diagnostics, context: {
      loaded: { ...value.loaded, contract: selectedContract, treeEntries,
        productState: { entries: implementation, digest: digestCanonical(implementation) },
        snapshot: { ...value.loaded.snapshot, contractDigest: selectedContract.digest } },
      knowledge: { ...value.knowledge, records, currentRecords: records, ...observed, manifest,
        index: { ...value.knowledge.index, currentByIdentity: new Map(records.map((record) => [record.frontMatter.id, record])) } },
    } };
  };
  const absent = measuredContext([]);
  const present = measuredContext(["src/feature/a.ts"]);
  for (const measured of [absent, present]) {
    assert.deepEqual(measured.diagnostics.filter(({ severity }) => severity === "error"), []);
  }
  assert.deepEqual(absent.context.knowledge.manifest.coverage, []);
  assert.equal(present.context.knowledge.manifest.coverage[0]?.descriptionId, "description.feature");
  const compare = (admitted: typeof absent.context, parent: typeof absent.context) =>
    compareFoundationIntegrationContextV1({ boundary, admitted, parent });
  assert.deepEqual(compare(absent.context, present.context), { disposition: "unchanged", changes: [] });
  assert.deepEqual(compare(present.context, absent.context), { disposition: "unchanged", changes: [] });
  assert.deepEqual(compare(present.context, measuredContext(["src/feature/a.ts"], owners, contract, "f".repeat(40)).context),
    { disposition: "unchanged", changes: [] });

  for (const changedOwner of [description("description.replacement", "src/feature", ["src/feature/nested"]),
    description("description.feature", "src/feature", ["src/feature/nested", "src/feature/other"])]) {
    const changed = measuredContext(["src/feature/a.ts"], [changedOwner, ...owners.slice(1)]);
    assert.deepEqual(changed.diagnostics.filter(({ severity }) => severity === "error"), []);
    const result = compare(absent.context, changed.context);
    assert.equal(result.disposition, "requires-readmission");
    assert.deepEqual(result.changes.map(({ subject }) => subject), ["knowledge-closure"]);
  }
  for (const [selectedOwners, code] of [
    [owners.slice(1), "coverage-missing"],
    [[...owners, description("description.duplicate", "src/feature")], "coverage-ambiguous"],
  ] as const) {
    const invalid = measuredContext(["src/feature/a.ts"], [...selectedOwners]);
    assert(invalid.diagnostics.some(({ code: observed }) => observed === `lifecycle.description.${code}`));
    assert.equal(compare(absent.context, invalid.context).disposition, "requires-readmission");
  }

  const exemptBase = { ...contract, productState: { ...contract.productState,
    coverageExemptions: [{ path: "src/feature/generated", reason: "Externally generated files." }] } };
  const exemptContract = { ...exemptBase, digest: selfDigest(exemptBase) };
  const beforeExemptFile = measuredContext([], owners, exemptContract);
  const afterExemptFile = measuredContext(["src/feature/a.ts", "src/feature/generated/code.ts"], owners, exemptContract);
  assert.equal(beforeExemptFile.context.knowledge.exemptions[0]?.matched, false);
  assert.equal(afterExemptFile.context.knowledge.exemptions[0]?.matched, true);
  assert.deepEqual(compare(beforeExemptFile.context, afterExemptFile.context), { disposition: "unchanged", changes: [] });
  assert(compare(absent.context, beforeExemptFile.context).changes.some(({ subject }) => subject === "repository-contract"));
});

test("Execution Projection distinguishes absent Knowledge outputs from required governing inputs", async () => {
  const value = fixture();
  const path = "records/behavior/future.md";
  for (const mustChange of [false, true]) {
    const core = { ...value.subject.core, requiredArtifacts: [...value.subject.core.requiredArtifacts,
      { id: "artifact.future", path, role: "behavior" as const, mustChange }].sort((left, right) => left.id.localeCompare(right.id)) };
    const body = { ...value.subject, core };
    const subject = { ...body, subjectDigest: digestCanonical(body) };
    const actual = await compileExecution({ ...value, subject, inventory: new ProjectionByteInventoryBuilder() });
    assert.deepEqual(actual.mandatory.map(({ sourceIdentity }) => sourceIdentity),
      ["behavior.selected-result", "assurance.selected-result", "check.selected-result"]);
    assert.equal(actual.unresolved.length, 0);
    const occupied = { ...value.loaded, treeEntries: [...value.loaded.treeEntries,
      { path, mode: "100644", type: "blob" as const, objectId: "a".repeat(40) }] };
    await assert.rejects(compileExecution({ ...value, loaded: occupied, subject, inventory: new ProjectionByteInventoryBuilder() }),
      (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.projection.root-unresolved");
    const missingBody = { ...subject, knowledgeRoots: [...subject.knowledgeRoots,
      { ...subject.knowledgeRoots[0]!, id: "behavior.future" }].sort((left, right) => left.id.localeCompare(right.id)) };
    await assert.rejects(compileExecution({ ...value, subject: { ...missingBody, subjectDigest: digestCanonical(missingBody) },
      inventory: new ProjectionByteInventoryBuilder() }),
    (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.projection.root-unresolved");
  }
});

test("Knowledge Artifact closure keeps retained superseded output nongoverning while the selected successor supplies meaning", () => {
  const value = fixture();
  const original = value.knowledge.currentRecords.find(({ frontMatter }) => frontMatter.id === "behavior.selected-result")!;
  const parse = (path: string, sourceText: string) => parseKnowledgeRecord({ path, mode: "100644", objectId: "b".repeat(40),
    bytes: Buffer.from(sourceText), contract: value.loaded.contract });
  const prior = parse(original.path, original.sourceText.replace('"status": "current"', '"status": "superseded"'));
  const successorFields = { ...JSON.parse(original.sourceText.split("---\n")[1]!), revision: 2, supersedes: { id: prior.frontMatter.id, revision: prior.frontMatter.revision,
    sourceDigest: prior.sourceDigest, semanticDigest: prior.semanticDigest } };
  const successor = parse("records/behavior/selected-result-r2.md", `---\n${JSON.stringify(successorFields, null, 2)}\n---\n${original.body}`);
  const currentRecords = value.knowledge.currentRecords.map((record) => record === original ? successor : record);
  const knowledge = { ...value.knowledge, records: [...currentRecords, prior], currentRecords, historicalRecords: [prior],
    index: { ...value.knowledge.index, currentByIdentity: new Map(currentRecords.map((record) => [record.frontMatter.id, record])) } };
  const selected = seedSubject({ loaded: value.loaded, knowledge, subject: value.subject, boundary: value.workBoundary, currentRoots: true });
  assert(selected.seeds.some(({ id }) => id === successor.frontMatter.id));
  assert(!selected.seeds.some(({ reason }) => reason === "required-artifact:artifact.selected-result"));
});

test("Execution Projection carries only the normalized Atlas root without an exact Boundary Atlas source", () => {
  const value = fixture();
  const rootOnly = Object.freeze({ id: "root-only", uri: "sources/root-only.md", title: "Root-only Resource" });
  const model = Object.freeze({
    ...value.loaded.atlas.model,
    atlas: Object.freeze({
      ...value.loaded.atlas.model.atlas,
      resources: Object.freeze([rootOnly]),
      content: Object.freeze([Object.freeze({ resource: rootOnly.id })]),
    }),
  });
  const loaded = Object.freeze({
    ...value.loaded,
    atlas: Object.freeze({ ...value.loaded.atlas, model }),
  });
  const inventory = new ProjectionByteInventoryBuilder();
  const compiled = compileAtlasProjection({
    loaded,
    inventory,
    mode: "execution",
    selectedResourceIds: new Set(["absent-resource"]),
  });
  const plan = planAtlasExecutionClosure({
    loaded,
    selectedResourceIds: new Set(["absent-resource"]),
  });
  const atlas = compiled.items;

  assert.deepEqual(atlas.map(({ unitKind, unitId, mapId, pointId, recordKind }) => ({
    unitKind,
    unitId,
    mapId,
    pointId,
    recordKind,
  })), [
    { unitKind: "atlas", unitId: "target", mapId: null, pointId: null, recordKind: null },
  ]);
  assert.equal(atlas[0]?.sourcePath, "atlas/atlas.md");
  assert.equal(inventory.entries().length, 1);
  assert.deepEqual([...compiled.resourceIds], []);
  assert.deepEqual([...plan.mapIds], []);
  assert.deepEqual([...plan.pointIds], []);
  assert.deepEqual([...plan.pointRecordKeys], []);
  assert.deepEqual([...plan.resourceIds], []);
  assert(atlas.every(({ useLimit }) => useLimit !== null && /read-only|Atlas-authored|preserved exactly/u.test(useLimit)));
});

test("Orientation Atlas closure follows only root navigation while retaining complete navigated membership", () => {
  const value = fixture();
  const baseMap = value.loaded.atlas.model.maps[0]!;
  const basePoint = value.loaded.atlas.model.points[0]!;
  const baseRecord = basePoint.records[0]!;
  const shared = Object.freeze({ id: "shared", uri: "sources/shared.md", title: "Shared Resource" });
  const contextRecord = Object.freeze({
    ...baseRecord,
    kind: "context" as const,
    map: baseMap.id,
    path: "maps/project/points/cross-map.md",
    content: Object.freeze([Object.freeze({ resource: shared.id })]),
  });
  const crossMapAnchor = Object.freeze({
    ...baseRecord,
    map: "secondary",
    path: "maps/secondary/points/cross-map.md",
    content: Object.freeze([Object.freeze({ resource: shared.id })]),
  });
  const crossMapPoint = Object.freeze({
    ...basePoint,
    id: "cross-map",
    primaryMap: "secondary",
    anchorPath: crossMapAnchor.path,
    records: Object.freeze([crossMapAnchor, contextRecord]),
  });
  const unrelatedAnchor = Object.freeze({
    ...baseRecord,
    map: "secondary",
    path: "maps/secondary/points/unrelated.md",
    content: Object.freeze([Object.freeze({ resource: shared.id })]),
  });
  const unrelatedPoint = Object.freeze({
    ...basePoint,
    id: "unrelated",
    primaryMap: "secondary",
    anchorPath: unrelatedAnchor.path,
    records: Object.freeze([unrelatedAnchor]),
  });
  const projectMap = Object.freeze({
    ...baseMap,
    content: Object.freeze([Object.freeze({ resource: shared.id })]),
    pointIds: Object.freeze([basePoint.id, crossMapPoint.id]),
    anchorPointIds: Object.freeze([basePoint.id]),
    contextPointIds: Object.freeze([crossMapPoint.id]),
  });
  const secondaryMap = Object.freeze({
    ...baseMap,
    id: "secondary",
    path: "maps/secondary/map.md",
    content: Object.freeze([Object.freeze({ resource: shared.id })]),
    pointIds: Object.freeze([crossMapPoint.id, unrelatedPoint.id]),
    anchorPointIds: Object.freeze([crossMapPoint.id, unrelatedPoint.id]),
    contextPointIds: Object.freeze([]),
  });
  const model = Object.freeze({
    ...value.loaded.atlas.model,
    atlas: Object.freeze({
      ...value.loaded.atlas.model.atlas,
      resources: Object.freeze([shared]),
      content: Object.freeze([Object.freeze({ resource: shared.id })]),
    }),
    maps: Object.freeze([projectMap, secondaryMap]),
    points: Object.freeze([basePoint, crossMapPoint, unrelatedPoint]),
    relatedMaps: Object.freeze([Object.freeze({
      maps: Object.freeze([baseMap.id, secondaryMap.id] as const),
      pointIds: Object.freeze([crossMapPoint.id]),
    })]),
  });
  const loaded = Object.freeze({
    ...value.loaded,
    atlas: Object.freeze({ ...value.loaded.atlas, model }),
  });
  const compiled = compileAtlasProjection({
    loaded,
    inventory: new ProjectionByteInventoryBuilder(),
    mode: "orientation",
  });

  assert.deepEqual(
    compiled.items.filter(({ unitKind }) => unitKind === "map").map(({ unitId }) => unitId),
    [baseMap.id],
  );
  assert.deepEqual(
    compiled.items
      .filter(({ unitKind }) => unitKind === "point-anchor" || unitKind === "point-context")
      .map(({ unitKind, pointId, mapId }) => ({ unitKind, pointId, mapId })),
    [
      { unitKind: "point-anchor", pointId: crossMapPoint.id, mapId: secondaryMap.id },
      { unitKind: "point-anchor", pointId: basePoint.id, mapId: baseMap.id },
      { unitKind: "point-context", pointId: crossMapPoint.id, mapId: baseMap.id },
    ],
  );
  assert.deepEqual([...compiled.resourceIds], [shared.id]);
  assert.equal(compiled.items.some(({ pointId }) => pointId === unrelatedPoint.id), false);
});

test("Execution Atlas selection closes only through exact normalized Resource identities", () => {
  const value = fixture();
  const architecture = Object.freeze({ id: "architecture", uri: "sources/architecture.md", title: "Architecture" });
  const unrelated = Object.freeze({ id: "unrelated", uri: "sources/unrelated.md", title: "Unrelated" });
  const model = Object.freeze({
    ...value.loaded.atlas.model,
    atlas: Object.freeze({
      ...value.loaded.atlas.model.atlas,
      resources: Object.freeze([architecture, unrelated]),
    }),
    maps: Object.freeze(value.loaded.atlas.model.maps.map((map) => Object.freeze({
      ...map,
      content: Object.freeze([Object.freeze({ resource: "architecture" })]),
    }))),
    points: Object.freeze(value.loaded.atlas.model.points.map((point) => Object.freeze({
      ...point,
      records: Object.freeze(point.records.map((record) => Object.freeze({
        ...record,
        content: Object.freeze([Object.freeze({ resource: "architecture" })]),
      }))),
    }))),
  });
  const loaded = Object.freeze({
    ...value.loaded,
    atlas: Object.freeze({ ...value.loaded.atlas, model }),
  });
  const inventory = new ProjectionByteInventoryBuilder();
  const compiled = compileAtlasProjection({
    loaded,
    inventory,
    mode: "execution",
    selectedResourceIds: new Set(["architecture"]),
  });
  const sourceRoot = Object.freeze({
    owner: "source-anchor" as const,
    sourceId: atlasResourceSourceId(model.atlas.id, architecture.id),
    reference: "atlas/sources/architecture.md",
    revision: "3".repeat(40),
    digest: sha256Bytes("architecture-resource"),
    authority: "atlas" as const,
    required: true,
    reason: "selected-by-active-work-boundary",
  });
  const viaSourceRoot = compileAtlasProjection({
    loaded,
    inventory: new ProjectionByteInventoryBuilder(),
    mode: "execution",
    sourceRoots: Object.freeze([sourceRoot]),
  });
  const plan = planAtlasExecutionClosure({
    loaded,
    sourceRoots: Object.freeze([sourceRoot]),
  });

  assert.deepEqual(compiled.items.map(({ unitKind, unitId }) => ({ unitKind, unitId })), [
    { unitKind: "atlas", unitId: "target" },
    { unitKind: "map", unitId: "project" },
    { unitKind: "point-anchor", unitId: "project-scope:project" },
    { unitKind: "resource", unitId: "architecture" },
  ]);
  assert.deepEqual(viaSourceRoot, compiled);
  assert.deepEqual([...plan.mapIds], ["project"]);
  assert.deepEqual([...plan.pointIds], ["project-scope"]);
  assert.deepEqual([...plan.pointRecordKeys], [
    atlasPointRecordKey(model.points[0]!, model.points[0]!.records[0]!),
  ]);
  assert.deepEqual([...plan.resourceIds], [architecture.id]);
  assert.deepEqual([...compiled.resourceIds], ["architecture"]);
  assert.equal(compiled.items.some(({ unitId }) => unitId === "unrelated"), false);
});

test("Execution Atlas context closure includes the identity anchor and that anchor's exact Resource targets", () => {
  const value = fixture();
  const baseMap = value.loaded.atlas.model.maps[0]!;
  const basePoint = value.loaded.atlas.model.points[0]!;
  const baseRecord = basePoint.records[0]!;
  const contextSeed = Object.freeze({ id: "context-seed", uri: "sources/context.md", title: "Context seed" });
  const anchorSource = Object.freeze({ id: "anchor-source", uri: "sources/anchor.md", title: "Anchor source" });
  const anchor = Object.freeze({
    ...baseRecord,
    kind: "anchor" as const,
    map: baseMap.id,
    content: Object.freeze([Object.freeze({ resource: anchorSource.id })]),
    references: Object.freeze([]),
  });
  const context = Object.freeze({
    ...baseRecord,
    kind: "context" as const,
    map: "secondary",
    path: `maps/secondary/points/${basePoint.id}.md`,
    content: Object.freeze([Object.freeze({ resource: contextSeed.id })]),
    references: Object.freeze([]),
  });
  const secondaryMap = Object.freeze({
    ...baseMap,
    id: "secondary",
    path: "maps/secondary/map.md",
    content: Object.freeze([]),
    references: Object.freeze([]),
    areas: Object.freeze([]),
    pointIds: Object.freeze([basePoint.id]),
    anchorPointIds: Object.freeze([]),
    contextPointIds: Object.freeze([basePoint.id]),
  });
  const model = Object.freeze({
    ...value.loaded.atlas.model,
    atlas: Object.freeze({
      ...value.loaded.atlas.model.atlas,
      resources: Object.freeze([anchorSource, contextSeed]),
      content: Object.freeze([]),
      references: Object.freeze([]),
    }),
    maps: Object.freeze([
      Object.freeze({ ...baseMap, content: Object.freeze([]), references: Object.freeze([]) }),
      secondaryMap,
    ]),
    points: Object.freeze([
      Object.freeze({
        ...basePoint,
        anchorPath: anchor.path,
        records: Object.freeze([anchor, context]),
      }),
    ]),
  });
  const loaded = Object.freeze({
    ...value.loaded,
    atlas: Object.freeze({ ...value.loaded.atlas, model }),
  });
  const compiled = compileAtlasProjection({
    loaded,
    inventory: new ProjectionByteInventoryBuilder(),
    mode: "execution",
    selectedResourceIds: new Set([contextSeed.id]),
  });
  const plan = planAtlasExecutionClosure({
    loaded,
    selectedResourceIds: new Set([contextSeed.id]),
  });

  assert.deepEqual(compiled.items.map(({ unitKind, unitId }) => ({ unitKind, unitId })), [
    { unitKind: "atlas", unitId: "target" },
    { unitKind: "map", unitId: "project" },
    { unitKind: "map", unitId: "secondary" },
    { unitKind: "point-anchor", unitId: `${basePoint.id}:project` },
    { unitKind: "point-context", unitId: `${basePoint.id}:secondary` },
    { unitKind: "resource", unitId: anchorSource.id },
    { unitKind: "resource", unitId: contextSeed.id },
  ]);
  assert.deepEqual([...plan.mapIds].sort(), [baseMap.id, secondaryMap.id].sort());
  assert.deepEqual([...plan.pointIds], [basePoint.id]);
  assert.deepEqual([...plan.pointRecordKeys].sort(), [
    atlasPointRecordKey(basePoint, anchor),
    atlasPointRecordKey(basePoint, context),
  ].sort());
  assert.deepEqual([...plan.resourceIds].sort(), [anchorSource.id, contextSeed.id].sort());
  assert.deepEqual([...compiled.resourceIds].sort(), [anchorSource.id, contextSeed.id]);
});

test("Atlas maintenance Checks and publication profiles require an exact orientation selector", () => {
  const value = fixture();
  const check = Object.freeze({
    id: "atlas.check.currentness",
    title: "Currentness",
    summary: "Check current Atlas meaning.",
    status: "active" as const,
    level: "required" as const,
    appliesTo: Object.freeze(["atlas"]),
    path: ".checks/currentness.md",
    extensions: Object.freeze({}),
    body: "# Currentness\n",
  });
  const profile = Object.freeze({
    id: "atlas.publication.internal",
    title: "Internal",
    summary: "One exact publication allowlist.",
    path: ".publication/internal.md",
    selection: Object.freeze({
      atlas: true,
      maps: Object.freeze([]),
      points: Object.freeze([]),
      resources: Object.freeze([]),
      checks: Object.freeze([]),
    }),
    extensions: Object.freeze({}),
    body: "# Internal\n",
  });
  const model = Object.freeze({
    ...value.loaded.atlas.model,
    checks: Object.freeze([check]),
    publicationProfiles: Object.freeze([profile]),
  });
  const loaded = Object.freeze({
    ...value.loaded,
    atlas: Object.freeze({ ...value.loaded.atlas, model }),
  });

  const ordinary = compileAtlasProjection({
    loaded,
    inventory: new ProjectionByteInventoryBuilder(),
    mode: "orientation",
  });
  assert.equal(ordinary.items.some(({ unitKind }) =>
    unitKind === "check" || unitKind === "publication-profile"), false);

  const selected = compileAtlasProjection({
    loaded,
    inventory: new ProjectionByteInventoryBuilder(),
    mode: "orientation",
    selectedCheckIds: new Set([check.id]),
    selectedPublicationProfileIds: new Set([profile.id]),
  });
  assert(selected.items.some(({ unitKind, unitId }) => unitKind === "check" && unitId === check.id));
  assert(selected.items.some(({ unitKind, unitId }) =>
    unitKind === "publication-profile" && unitId === profile.id));
  assert.throws(
    () => compileAtlasProjection({
      loaded,
      inventory: new ProjectionByteInventoryBuilder(),
      mode: "execution",
      selectedCheckIds: new Set([check.id]),
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.projection.atlas-selection",
  );
});

test("Execution Projection requires one exact repository-registered Capability Profile", async () => {
  const value = fixture();
  const registered = value.loaded.contract.capabilityProfiles[value.loaded.contract.defaults.capabilityProfileId]!;
  for (const capability of [
    Object.freeze({ profileId: "unregistered-capability", profileDigest: registered.digest }),
    Object.freeze({ profileId: registered.id, profileDigest: sha256Bytes("wrong-capability-digest") }),
  ]) {
    const core = Object.freeze({ ...value.subject.core, capability });
    const subjectBase = { ...value.subject, core };
    const subject = Object.freeze({
      ...subjectBase,
      subjectDigest: digestCanonical(subjectBase),
    }) as FoundationExecutionProjectionSubject;
    await assert.rejects(
      compileExecution({ ...value, subject, inventory: new ProjectionByteInventoryBuilder() }),
      (error: unknown) => error instanceof Error && "code" in error &&
        error.code === "lifecycle.projection.basis-mismatch",
    );
  }
});

test("Projection requests refuse the unselected acceptance-support role at the schema boundary", () => {
  const value = fixture();
  const { digest: _requestDigest, ...prior } = value.request;
  const requestBase = Object.freeze({ ...prior, role: "acceptance-support" as const });
  const request = Object.freeze({
    ...requestBase,
    digest: selfDigest(requestBase as unknown as Record<string, unknown>),
  });
  assert.throws(
    () => parseProjectionRequest(request),
    (error: unknown) => error instanceof Error && "code" in error &&
      error.code === "lifecycle.schema.invalid" &&
      error.message.includes("urn:lifecycle:schema:projection-request:v5"),
  );
});

test("Execution Projection propositions are unique and code-point ordered by identity", async () => {
  const value = fixture();
  const first = value.subject.core.propositions[0]!;
  const second = Object.freeze({ ...first, id: "proposition.zzz" });
  for (const propositions of [
    Object.freeze([second, first]),
    Object.freeze([first, first]),
  ]) {
    const core = Object.freeze({ ...value.subject.core, propositions });
    const subjectBase = { ...value.subject, core };
    const subject = Object.freeze({
      ...subjectBase,
      subjectDigest: digestCanonical(subjectBase),
    }) as FoundationExecutionProjectionSubject;
    await assert.rejects(
      compileExecution({ ...value, subject, inventory: new ProjectionByteInventoryBuilder() }),
      (error: unknown) => error instanceof Error && "code" in error &&
        error.code === "lifecycle.projection.order-invalid",
    );
  }
});

test("Execution Projection rejects a stale or missing exact Knowledge root", async () => {
  const value = fixture();
  const staleBase = {
    ...value.subject,
    knowledgeRoots: value.subject.knowledgeRoots.map((root) => ({ ...root, sourceDigest: sha256Bytes("stale") })),
  };
  const stale = Object.freeze({ ...staleBase, subjectDigest: digestCanonical(staleBase) }) as FoundationExecutionProjectionSubject;
  await assert.rejects(
    compileExecution({ ...value, subject: stale, inventory: new ProjectionByteInventoryBuilder() }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "lifecycle.projection.root-unresolved",
  );
});

test("Execution Projection rejects a substituted fixed-mandate obligation source", async () => {
  const value = fixture();
  const obligation = value.subject.core.obligations[0]!;
  const core = Object.freeze({
    ...value.subject.core,
    obligations: Object.freeze([Object.freeze({
      ...obligation,
      sourceIds: Object.freeze(["behavior.selected-result", "semantic.substituted-mandate"]),
    })]),
  });
  const subjectBase = { ...value.subject, core };
  const subject = Object.freeze({
    ...subjectBase,
    subjectDigest: digestCanonical(subjectBase),
  }) as FoundationExecutionProjectionSubject;

  await assert.rejects(
    compileExecution({
      ...value,
      subject,
      inventory: new ProjectionByteInventoryBuilder(),
    }),
    (error: unknown) => error instanceof Error && "code" in error &&
      error.code === "lifecycle.projection.root-unresolved",
  );
});

test("Execution Projection rejects a source root that collides with the fixed mandate", async () => {
  const value = fixture();
  const boundaryDirectionId = String(
    ((value.workBoundary.payload.mandate as ControlJsonObject).direction as ControlJsonObject).id,
  );
  const subjectBase = {
    ...value.subject,
    sourceRoots: Object.freeze([Object.freeze({
      owner: "source-anchor" as const,
      sourceId: boundaryDirectionId,
      reference: "sources/colliding-mandate.md",
      revision: "collision-1",
      digest: sha256Bytes("colliding-mandate-source"),
      authority: "informational-source" as const,
      required: true,
      reason: "collision witness",
    })]),
  };
  const subject = Object.freeze({
    ...subjectBase,
    subjectDigest: digestCanonical(subjectBase),
  }) as FoundationExecutionProjectionSubject;

  await assert.rejects(
    compileExecution({
      ...value,
      subject,
      inventory: new ProjectionByteInventoryBuilder(),
    }),
    (error: unknown) => {
      assert(error instanceof FoundationError);
      assert.equal(error.code, "lifecycle.projection.root-unresolved");
      assert.deepEqual(error.observedFacts, {
        obligationId: "obligation.selected-result",
        sourceId: boundaryDirectionId,
        knowledgeMatches: 0,
        sourceMatches: 1,
        fixedMandateMatches: 1,
      });
      return true;
    },
  );
});

test("Execution Projection requires mandatory sources to cite the exact current record revision", async () => {
  const value = fixture();
  const staleBase = {
    ...value.subject,
    sourceRoots: Object.freeze([Object.freeze({
      owner: "knowledge" as const,
      recordId: "behavior.selected-result",
      recordRevision: 2,
      sourceId: "design-source",
      reference: "records/sources/design.md",
      revision: "revision-1",
      digest: sha256Bytes("design-source"),
      authority: "informational-source" as const,
      required: true,
      reason: "selected design source",
    })]),
  };
  const stale = Object.freeze({ ...staleBase, subjectDigest: digestCanonical(staleBase) }) as FoundationExecutionProjectionSubject;
  await assert.rejects(
    compileExecution({ ...value, subject: stale, inventory: new ProjectionByteInventoryBuilder() }),
    (error: unknown) => {
      assert(error instanceof Error && "code" in error && "observedFacts" in error);
      assert.equal(error.code, "lifecycle.projection.source-stale");
      assert.deepEqual(error.observedFacts, {
        recordId: "behavior.selected-result",
        sourceId: "design-source",
        declaredRecordRevision: 2,
        currentRecordRevision: 1,
      });
      return true;
    },
  );
});

test("Execution Projection enumerates optional current provenance sources in Tier 3", async () => {
  const value = fixture();
  const declaredDigest = sha256Bytes("unavailable-provenance");
  const source = Object.freeze({
    recordId: "behavior.selected-result",
    recordRevision: 1,
    sourceId: "optional-provenance",
    required: false,
    reference: "https://example.invalid/provenance",
    role: "research" as const,
    kind: "external" as const,
    locator: null,
    declaredRevision: "revision-1",
    declaredDigest,
    objectId: null,
    resolvedDigest: null,
    disposition: "retrieval-denied" as const,
  });
  const knowledge = Object.freeze({ ...value.knowledge, sources: Object.freeze([source]) });
  const compiled = await compileExecution({ ...value, knowledge, inventory: new ProjectionByteInventoryBuilder() });
  const provenance = compiled.reachable.filter((item) => item.category === "provenance-source");
  assert.equal(provenance.length, 1);
  assert.equal(provenance[0]?.kind, "research");
  assert.equal(provenance[0]?.sourceRevision, "revision-1");
  assert.equal(provenance[0]?.digest, declaredDigest);
  assert.equal(provenance[0]?.retrieval, "inaccessible");
  assert.equal(provenance[0]?.mountedPath, null);
  assert.equal(provenance[0]?.byteLength, 0);
  const category = compiled.omission.categories.find((entry) => entry.category === "provenance-source");
  assert.deepEqual(category?.before, { items: 1, bytes: 0 });
  assert.deepEqual(category?.after, { items: 1, bytes: 0 });
  assert.deepEqual(category?.omitted, { items: 0, bytes: 0 });
});

test("Execution Projection labels implementation Git blobs as text only after strict UTF-8 validation", async () => {
  const value = fixture();
  const root = await mkdtemp(join(tmpdir(), "lifecycle-projection-implementation-presentation-"));
  await git(root, ["init", "-b", "main"]);
  await mkdir(join(root, "src"), { recursive: true });
  const textBytes = Buffer.from("export const selected = true;\n", "utf8");
  const binaryBytes = Buffer.from([0xff, 0x00, 0x61]);
  await writeFile(join(root, "src", "selected.ts"), textBytes);
  await writeFile(join(root, "src", "opaque.bin"), binaryBytes);
  const textObject = (await git(root, ["hash-object", "-w", "src/selected.ts"])).stdout.trim();
  const binaryObject = (await git(root, ["hash-object", "-w", "src/opaque.bin"])).stdout.trim();
  const implementationEntries = Object.freeze([
    Object.freeze({ path: "src/opaque.bin", mode: "100644" as const, type: "blob" as const, objectId: binaryObject }),
    Object.freeze({ path: "src/selected.ts", mode: "100644" as const, type: "blob" as const, objectId: textObject }),
  ]);
  const productEntries = Object.freeze(implementationEntries.map((entry) => Object.freeze({
    path: entry.path,
    mode: entry.mode,
    objectId: entry.objectId,
    role: "governed-implementation" as const,
  })));
  const loaded = Object.freeze({
    ...value.loaded,
    repository: root,
    treeEntries: Object.freeze([...value.loaded.treeEntries, ...implementationEntries]),
    productState: Object.freeze({ entries: productEntries, digest: digestCanonical(productEntries) }),
  });
  const knowledge = Object.freeze({
    ...value.knowledge,
    exemptions: Object.freeze([Object.freeze({ path: "src", reason: "presentation fixture", matched: true })]),
  });
  const subjectBase = {
    ...value.subject,
    implementationRoots: Object.freeze([Object.freeze({ path: "src", reason: "selected implementation" })]),
  };
  const subject = Object.freeze({ ...subjectBase, subjectDigest: digestCanonical(subjectBase) }) as FoundationExecutionProjectionSubject;
  const compiled = await compileExecution({ ...value, loaded, knowledge, subject, inventory: new ProjectionByteInventoryBuilder() });
  const text = compiled.implementation.find((item) => item.path === "src/selected.ts");
  const binary = compiled.implementation.find((item) => item.path === "src/opaque.bin");
  assert.equal(text?.presentationHint, "source");
  assert.equal(text?.content.encoding, "utf-8");
  assert.equal(binary?.presentationHint, "binary");
  assert.equal(binary?.content.encoding, "binary");
});

test("Execution Projection strictly decodes resolved sources and globally scopes semantic identities", async () => {
  const value = fixture();
  const root = await mkdtemp(join(tmpdir(), "lifecycle-projection-source-presentation-"));
  await git(root, ["init", "-b", "main"]);
  const textBytes = Buffer.from("Exact source context.\n", "utf8");
  const binaryBytes = Buffer.from([0xff, 0x00, 0x62]);
  await writeFile(join(root, "text-source.txt"), textBytes);
  await writeFile(join(root, "binary-source.bin"), binaryBytes);
  const textObject = (await git(root, ["hash-object", "-w", "text-source.txt"])).stdout.trim();
  const binaryObject = (await git(root, ["hash-object", "-w", "binary-source.bin"])).stdout.trim();
  const sources = Object.freeze([
    Object.freeze({
      recordId: "behavior.selected-result",
      recordRevision: 1,
      sourceId: "text-source",
      required: true,
      reference: "text-source.txt",
      role: "repository-reality" as const,
      kind: "repository" as const,
      locator: "text-source.txt",
      declaredRevision: textObject,
      declaredDigest: sha256Bytes(textBytes),
      objectId: textObject,
      resolvedDigest: sha256Bytes(textBytes),
      disposition: "resolved" as const,
    }),
    Object.freeze({
      recordId: "assurance.selected-result",
      recordRevision: 1,
      sourceId: "text-source",
      required: true,
      reference: "binary-source.bin",
      role: "repository-reality" as const,
      kind: "repository" as const,
      locator: "binary-source.bin",
      declaredRevision: binaryObject,
      declaredDigest: sha256Bytes(binaryBytes),
      objectId: binaryObject,
      resolvedDigest: sha256Bytes(binaryBytes),
      disposition: "resolved" as const,
    }),
  ]);
  const knowledge = Object.freeze({ ...value.knowledge, sources });
  const loaded = Object.freeze({ ...value.loaded, repository: root });
  const compiled = await compileExecution({ ...value, loaded, knowledge, inventory: new ProjectionByteInventoryBuilder() });
  const text = compiled.sources.find((item) => item.reference === "text-source.txt");
  const binary = compiled.sources.find((item) => item.reference === "binary-source.bin");
  assert.equal(text?.presentationHint, "plain-text");
  assert.equal(text?.content.encoding, "utf-8");
  const textSubjectId = `source.subject.${digestCanonical({
    recordId: "behavior.selected-result",
    recordRevision: 1,
    sourceId: "text-source",
  }).slice("sha256:".length)}`;
  const binarySubjectId = `source.subject.${digestCanonical({
    recordId: "assurance.selected-result",
    recordRevision: 1,
    sourceId: "text-source",
  }).slice("sha256:".length)}`;
  assert.deepEqual(text?.semantic, {
    class: "source",
    subjectId: textSubjectId,
    subjectDigest: sha256Bytes(textBytes),
    evidenceKind: null,
  });
  assert.equal(binary?.presentationHint, "binary");
  assert.equal(binary?.content.encoding, "binary");
  assert.deepEqual(binary?.semantic, {
    class: "source",
    subjectId: binarySubjectId,
    subjectDigest: sha256Bytes(binaryBytes),
    evidenceKind: null,
  });
  assert.notEqual(textSubjectId, binarySubjectId);
});

test("Execution Projection translates an oversized mandatory Git source to the Projection bound error with exact facts", async () => {
  const value = fixture();
  const root = await mkdtemp(join(tmpdir(), "lifecycle-projection-oversized-source-"));
  await git(root, ["init", "-b", "main"]);
  const maximumItemBytes = value.request.profile.maximumItemBytes;
  const sourceBytes = Buffer.alloc(maximumItemBytes + 1, 0x61);
  await writeFile(join(root, "source.bin"), sourceBytes);
  const objectId = (await git(root, ["hash-object", "-w", "source.bin"])).stdout.trim();
  const source = Object.freeze({
    recordId: "behavior.selected-result",
    recordRevision: 1,
    sourceId: "mandatory-source",
    required: true,
    reference: "source.bin",
    role: "repository-reality" as const,
    kind: "repository" as const,
    locator: "source.bin",
    declaredRevision: objectId,
    declaredDigest: sha256Bytes(sourceBytes),
    objectId,
    resolvedDigest: sha256Bytes(sourceBytes),
    disposition: "resolved" as const,
  });
  const knowledge = Object.freeze({ ...value.knowledge, sources: Object.freeze([source]) });
  const loaded = Object.freeze({ ...value.loaded, repository: root });
  await assert.rejects(
    compileExecution({ ...value, loaded, knowledge, inventory: new ProjectionByteInventoryBuilder() }),
    (error: unknown) => {
      assert(error instanceof FoundationError);
      assert.equal(error.code, "lifecycle.projection.mandatory-too-large");
      assert.deepEqual(error.observedFacts, {
        kind: "mandatory-item",
        category: "source",
        id: "behavior.selected-result:mandatory-source",
        locator: "source.bin",
        objectId,
        observedBytes: maximumItemBytes + 1,
        maximumItemBytes,
        profile: value.request.profile.id,
      });
      const refusal = bindFoundationMandatoryProjectionRefusalV1(error, value.request);
      assert(refusal !== null);
      assert.equal(refusal.requestDigest, value.request.digest);
      assert.equal(refusal.measurement.kind, "mandatory-item");
      assert.equal("mandatoryItems" in refusal.measurement, false);
      assert.equal(bindFoundationMandatoryProjectionRefusalV1(new FoundationError(error.code, error.message,
        { observedFacts: error.observedFacts }), value.request), null);
      return true;
    },
  );
});


test("Integration compares selected governing closure independently from unrelated parent Snapshot movement", () => {
  const value = fixture();
  const admitted = { loaded: value.loaded, knowledge: value.knowledge };
  const compare = (parent: typeof admitted) => compareFoundationIntegrationContextV1({ boundary: value.workBoundary, admitted, parent });
  assert.deepEqual(compare(admitted), { disposition: "unchanged", changes: [] });
  const moved = { ...value.loaded, snapshot: { ...value.loaded.snapshot, commit: "e".repeat(40),
    knowledgeSetDigest: sha256Bytes("unrelated-knowledge-change"), digest: sha256Bytes("new-complete-snapshot") } };
  assert.deepEqual(compare({ ...admitted, loaded: moved }), { disposition: "unchanged", changes: [] });
  const selected = value.knowledge.currentRecords.find(({ frontMatter }) => frontMatter.kind === "assurance")!;
  const changed = { ...selected, sourceDigest: sha256Bytes("changed-inverse-required-assurance") };
  const changedKnowledge = { ...value.knowledge,
    currentRecords: value.knowledge.currentRecords.map((record) => record === selected ? changed : record),
    index: { ...value.knowledge.index, currentByIdentity: new Map([...value.knowledge.index.currentByIdentity].map(([id, record]) => [id, record === selected ? changed : record])) } };
  const changedResult = compare({ loaded: moved, knowledge: changedKnowledge });
  assert.equal(changedResult.disposition, "requires-readmission");
  assert.deepEqual(changedResult.changes.map(({ subject }) => subject), ["knowledge-closure"]);
  const missing = { ...value.knowledge, index: { ...value.knowledge.index,
    currentByIdentity: new Map([...value.knowledge.index.currentByIdentity].filter(([id]) => id !== "behavior.selected-result")) } };
  const missingResult = compare({ ...admitted, knowledge: missing });
  assert.equal(missingResult.disposition, "requires-readmission");
  assert.ok(missingResult.changes.some(({ subject }) => subject === "knowledge-closure"));
});

function integrationAtlasFixture() {
  const value = fixture();
  const resource = { id: "architecture", uri: "sources/architecture.md", title: "Architecture" };
  const unrelated = { id: "catalogue-only", uri: "sources/unrelated.md", title: "Unselected" };
  const base = value.loaded.atlas.model;
  const model: FoundationAtlasNormalizedModel = {
    ...base,
    atlas: { ...base.atlas, resources: [resource, unrelated] },
    maps: base.maps.map((map) => ({ ...map, content: [{ resource: resource.id }] })),
    points: base.points.map((point) => ({ ...point,
      records: point.records.map((record) => ({ ...record, content: [{ resource: resource.id }] })) })),
  };
  const bindings = model.atlas.resources.map(({ id, uri }) => ({ resourceId: id, uri, path: `atlas/${uri}`,
    mode: "100644" as const, objectId: "4".repeat(40), byteDigest: sha256Bytes(id), disposition: "resolved" as const }));
  const loaded = { ...value.loaded, atlas: { ...value.loaded.atlas, model,
    resolution: { ...value.loaded.atlas.resolution, resourceBindings: bindings } } };
  const sourceId = atlasResourceSourceId(base.atlas.id, resource.id);
  const boundary = compileControlRecordRevision(value.workBoundary.processId, { ...value.workBoundary,
    payload: { ...value.workBoundary.payload, externalSources: [{ sourceId, ownerKind: "atlas", ownerId: sourceId,
      revision: "4".repeat(40), digest: sha256Bytes(resource.id) }] } });
  const admitted = { loaded, knowledge: value.knowledge };
  const compare = (parentLoaded: FoundationLoadedRepositorySnapshot) => compareFoundationIntegrationContextV1({
    boundary, admitted, parent: { ...admitted, loaded: parentLoaded },
  });
  const withModel = (next: FoundationAtlasNormalizedModel) => ({ ...loaded, atlas: { ...loaded.atlas, model: next } });
  return { loaded, model, compare, withModel };
}

test("Integration preserves admitted applicability across Atlas discovery and unselected Resource changes", () => {
  const { loaded, model, compare, withModel } = integrationAtlasFixture();
  assert.deepEqual(compare(loaded), { disposition: "unchanged", changes: [] });
  const discovery = { ...model,
    atlas: { ...model.atlas, navigation: [{ title: "Reorganized routes", maps: [model.maps[0]!.id] }],
      resources: model.atlas.resources.map((resource) => resource.id === "catalogue-only"
        ? { ...resource, title: "New discovery description", uri: "sources/elsewhere.md" } : resource) },
    maps: model.maps.map((map) => ({ ...map, pointIds: [...map.pointIds, "unselected-point"],
      anchorPointIds: [...map.anchorPointIds, "unselected-point"] })),
    points: [...model.points, { ...model.points[0]!, id: "unselected-point",
      anchorPath: "maps/project/points/unselected.md", relations: [], incomingRelations: [],
      records: model.points[0]!.records.map((record) => ({ ...record, path: "maps/project/points/unselected.md", content: [], references: [] })) }],
  };
  const changed = withModel(discovery);
  const parent = { ...changed, atlasState: { ...changed.atlasState, digest: sha256Bytes("different full Atlas State") },
    atlas: { ...changed.atlas, resolution: { ...changed.atlas.resolution,
      normalizedModelDigest: digestCanonical(discovery), resourceBindings: changed.atlas.resolution.resourceBindings.map((binding) =>
        binding.resourceId === "catalogue-only" ? { ...binding, byteDigest: sha256Bytes("changed unselected bytes") } : binding) } } };
  assert.deepEqual(compare(parent), { disposition: "unchanged", changes: [] });
  // Exact Projection bytes retain the complete root catalogue and Map indexes.
  const before = compileAtlasProjection({ loaded, mode: "execution", selectedResourceIds: new Set(["architecture"]), inventory: new ProjectionByteInventoryBuilder() });
  const after = compileAtlasProjection({ loaded: parent, mode: "execution", selectedResourceIds: new Set(["architecture"]), inventory: new ProjectionByteInventoryBuilder() });
  assert.notDeepEqual(before.items.map(({ normalizedDigest }) => normalizedDigest), after.items.map(({ normalizedDigest }) => normalizedDigest));
});

test("Integration refuses changed or missing governing Atlas semantics and selected Resource bindings", () => {
  const { loaded, model, compare, withModel } = integrationAtlasFixture();
  const models: readonly FoundationAtlasNormalizedModel[] = [
    { ...model, atlas: { ...model.atlas, body: "Changed governing project context." } },
    { ...model, maps: model.maps.map((map) => ({ ...map, question: "A different governing question?" })) },
    { ...model, points: model.points.map((point) => ({ ...point, title: "Changed conceptual identity meaning" })) },
    { ...model, points: model.points.map((point) => ({ ...point,
      records: point.records.map((record) => ({ ...record, references: [{ role: "supporting" as const, resource: "catalogue-only" }] })) })) },
    { ...model, atlas: { ...model.atlas, resources: model.atlas.resources.filter(({ id }) => id !== "architecture") },
      maps: model.maps.map((map) => ({ ...map, content: [] })),
      points: model.points.map((point) => ({ ...point, records: point.records.map((record) => ({ ...record, content: [] })) })) },
  ];
  for (const changed of models) {
    const result = compare(withModel(changed));
    assert.equal(result.disposition, "requires-readmission");
    assert.ok(result.changes.some(({ subject }) => subject === "atlas"));
  }
  for (const bindings of [loaded.atlas.resolution.resourceBindings.filter(({ resourceId }) => resourceId !== "architecture"),
    loaded.atlas.resolution.resourceBindings.map((binding) => binding.resourceId === "architecture"
      ? { ...binding, byteDigest: sha256Bytes("different governing Resource bytes") } : binding)]) {
    const result = compare({ ...loaded, atlas: { ...loaded.atlas, resolution: { ...loaded.atlas.resolution, resourceBindings: bindings } } });
    assert.equal(result.disposition, "requires-readmission");
    assert.ok(result.changes.some(({ subject }) => subject === "atlas"));
  }
});

test("Integration binds selected Discipline adoption and publisher provenance independently of Work Type discovery", () => {
  const value = fixture();
  const discipline = foundationDisciplineAdoptionFixture(value.loaded.contract);
  const record = discipline.record;
  const reference = { id: record.frontMatter.id, revision: record.frontMatter.revision,
    sourceDigest: record.sourceDigest, semanticDigest: record.semanticDigest };
  const knowledge = { ...value.knowledge, disciplineRegistry: discipline.registry,
    currentRecords: [...value.knowledge.currentRecords, record],
    index: { ...value.knowledge.index, currentByIdentity: new Map([...value.knowledge.index.currentByIdentity, [record.frontMatter.id, record]]) } };
  const boundary = compileControlRecordRevision(value.workBoundary.processId, { ...value.workBoundary,
    payload: { ...value.workBoundary.payload, knowledge: [...value.workBoundary.payload.knowledge as readonly ControlJsonObject[], reference],
      disciplines: { registryDigest: discipline.registry.digest, workTypeIds: [], records: [{ ...reference }] } } });
  const admitted = { loaded: value.loaded, knowledge };
  const compare = (registry: typeof discipline.registry) => compareFoundationIntegrationContextV1({ boundary, admitted,
    parent: { ...admitted, knowledge: { ...knowledge, disciplineRegistry: registry } } });
  assert.deepEqual(compare(discipline.registry), { disposition: "unchanged", changes: [] });
  const discovery = { ...discipline.registry, digest: sha256Bytes("new Registry"), workTypes: [],
    adoptions: [...discipline.registry.adoptions, { ...discipline.registry.adoptions[0]!, id: "discipline.unselected", packId: "unselected" }],
    packs: [...discipline.registry.packs, { ...discipline.registry.packs[0]!, id: "unselected", publisher: "other.publisher" }] };
  assert.deepEqual(compare(discovery), { disposition: "unchanged", changes: [] });
  for (const registry of [
    { ...discipline.registry, adoptions: [] },
    { ...discipline.registry, packs: [] },
    { ...discipline.registry, packs: discipline.registry.packs.map((pack) => ({ ...pack, revision: "different publisher revision" })) },
    { ...discipline.registry, adoptions: discipline.registry.adoptions.map((adoption) => ({ ...adoption, sourceDigest: sha256Bytes("changed exact adopted bytes") })) },
  ]) {
    const result = compare(registry);
    assert.equal(result.disposition, "requires-readmission");
    assert.deepEqual(result.changes.map(({ subject }) => subject), ["discipline-registry"]);
  }
});
