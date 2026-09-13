import { foundationDisciplineAdoptionFixture, TEST_DISCIPLINE_ID, TEST_DISCIPLINE_WORK_TYPE_ID } from "../helpers/foundation-discipline-fixture.js";
import { createEmptyDisciplineRegistry } from "../../src/foundation/knowledge/discipline-registry.js";
import { resolveWorkBoundaryResolutionSnapshotV1 } from "../../src/foundation/control/work-boundary.js";
import assert from "node:assert/strict";
import test from "node:test";
import { compileControlRecordRevision } from "../../src/foundation/control/model.js";
import { foundationIntegrationValidationFactsDigestV1 } from "../../src/foundation/control/integration-assessment.js";
import { FoundationError } from "../../src/foundation/error.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import { compileWorkDelegationReservation, WORK_DELEGATION_RESERVATION_SCHEMA } from "../../src/foundation/control/work-delegation.js";
import {
  CONTROL_RECORD_EVENT_SCHEMA,
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlJsonObject,
  type ControlRecordEvent,
  type ControlRecordRelationship,
  type ControlRecordRevision,
} from "../../src/foundation/control/types.js";
import type { FoundationInstalledRuntimeConfigurationV7 } from "../../src/foundation/installed-configuration-v7.js";
import type { FoundationKnowledgeSetResult } from "../../src/foundation/knowledge/types.js";
import type { FoundationProjectionCompilerInput } from "../../src/foundation/projection/compiler.js";
import { compileExecutionProjectionSourceRoots } from "../../src/foundation/projection/execution-source-roots.js";
import type {
  FoundationExecutionProjectionRequest,
  FoundationOrientationProjectionRequest,
} from "../../src/foundation/projection/types.js";
import {
  compileFoundationAgentInvestmentV7,
  compileFoundationExecutionProjectionRequestV7,
  compileFoundationExecutionProjectionSubjectV7,
  compileFoundationFreshAgentOperationContextV7,
  compileFoundationRetainedAgentOperationContextV7,
} from "../../src/foundation/process/operation-context-v7.js";
import { atlasResourceSourceId } from "../../src/foundation/projection/source-context.js";
import type {
  FoundationAgentOperationSupportV7,
} from "../../src/foundation/process/agent-operation-v7.js";
import {
  createRepositoryContract,
  defaultCapabilityProfiles,
  defaultProjectionProfiles,
} from "../../src/foundation/repository/contract.js";
import type {
  FoundationLoadedRepositoryEpoch,
  FoundationLoadedRepositorySnapshot,
  FoundationRepositoryContract,
} from "../../src/foundation/repository/types.js";
import type { FoundationValidationResult } from "../../src/foundation/validation/result.js";
import {
  digestCanonical,
  selfDigest,
  sha256Bytes,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";
import { foundationAttemptProjectionFixture } from "../helpers/foundation-attempt-projection-fixture.js";
import { FOUNDATION_ATLAS_SELECTION } from "../../src/foundation/atlas/selection.js";
import { minimalAtlasRepositoryState } from "../helpers/atlas-fixture.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

const TARGET = "foundation-attempt-projection-fixture";
const PROCESS = "delivery-operation-context-v7";
const CREATED = "2026-08-29T21:00:00.000Z";
const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);

function valueDigest(label: string): Sha256 {
  return sha256Bytes(`operation-context-v7:${label}`);
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
  semanticMarkdown?: string;
  payload: ControlJsonObject;
  relationships?: readonly ControlRecordRelationship[];
}>): ControlRecordRevision {
  return compileControlRecordRevision(PROCESS, {
    recordId: input.id,
    recordKind: input.kind,
    revision: input.revision ?? 1,
    producer: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
    semanticAuthor: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
    semanticAuthority: "runtime-derived",
    createdAt: CREATED,
    semanticMarkdown: input.semanticMarkdown ?? `# ${input.kind}\n`,
    payload: input.payload,
    relationships: input.relationships ?? Object.freeze([]),
  });
}

function validation(label: string): FoundationValidationResult {
  return {
    complete: true,
    valid: true,
    digest: valueDigest(`${label}-validation`),
    diagnostics: Object.freeze([]),
  } as unknown as FoundationValidationResult;
}

type BasisFixture = Readonly<{
  epoch: FoundationLoadedRepositoryEpoch;
  snapshot: FoundationLoadedRepositorySnapshot;
  repositoryValidation: FoundationValidationResult;
  knowledgeResult: FoundationKnowledgeSetResult;
}>;

function basisFixture(withDiscipline = false, selectedCommit = COMMIT, selectedTree = TREE, parentCapabilityId?: string, orientationProfileId = "orientation-standard-v1"): BasisFixture {
  const defaults = defaultCapabilityProfiles();
  const capabilityProfiles = parentCapabilityId === undefined ? defaults : Object.freeze({
    [parentCapabilityId]: Object.freeze({ ...defaults["local-development-v1"]!, id: parentCapabilityId,
      digest: valueDigest(`parent-capability-${parentCapabilityId}`) }),
  });
  const projectionProfiles = defaultProjectionProfiles();
  const contract = {
    targetId: TARGET,
    generation: 1,
    canonicalBranch: "refs/heads/main",
    sourcePolicy: Object.freeze({ repository: "exact-bound-tree", externalLocal: "denied", network: "denied" }),
    atlas: Object.freeze({
      root: "atlas",
      entrypoint: "atlas/atlas.md",
      readOnly: true,
      selection: FOUNDATION_ATLAS_SELECTION,
    }),
    productState: Object.freeze({
      roots: Object.freeze(["src"]),
      exclusions: Object.freeze([]),
      governedImplementationRoots: Object.freeze(["src"]),
      coverageExemptions: Object.freeze([]),
    }),
    capabilityProfiles,
    projectionProfiles,
    defaults: Object.freeze({
      capabilityProfileId: parentCapabilityId ?? "local-development-v1",
      orientationProjectionProfileId: orientationProfileId,
      executionProjectionProfileId: "execution-standard-v1",
      providerDescriptorId: "codex-exec-standard-v7",
    }),
    digest: valueDigest("repository-contract"),
  } as unknown as FoundationRepositoryContract;
  const atlasFixture = minimalAtlasRepositoryState();
  const epoch: FoundationLoadedRepositoryEpoch = {
    repository: "/tmp/foundation-operation-context-v7-target",
    contract,
    epoch: Object.freeze({ ref: "refs/heads/main", commit: selectedCommit, tree: selectedTree, objectFormat: "sha1" }),
    treeEntries: atlasFixture.treeEntries,
    productState: Object.freeze({ entries: Object.freeze([]), digest: valueDigest("product-state") }),
    atlasState: atlasFixture.atlasState,
    atlas: atlasFixture.atlas,
    worktree: Object.freeze({ dirty: false, modified: Object.freeze([]), untracked: Object.freeze([]), ignored: Object.freeze([]) }),
  };
  const knowledgeValidation = validation("knowledge");
  const adopted = withDiscipline ? foundationDisciplineAdoptionFixture(createRepositoryContract({
    targetId: TARGET,
    canonicalBranch: "refs/heads/main",
    authority: { principalId: "director", keyId: "director-key", publicKey: `ed25519:${Buffer.alloc(32, 7).toString("base64")}` },
    publicationDigest: valueDigest("publication"),
  })) : null;
  const disciplineRegistry = adopted?.registry ?? createEmptyDisciplineRegistry();
  const knowledgeManifest = Object.freeze({
    digest: valueDigest("knowledge-set"),
    complete: true,
    valid: true,
    repository: Object.freeze({
      targetId: TARGET,
      commit: selectedCommit,
      tree: selectedTree,
      objectFormat: "sha1",
      contractDigest: contract.digest,
      productStateDigest: epoch.productState.digest,
      atlasStateDigest: epoch.atlasState.digest,
      atlasResolutionDigest: epoch.atlas.resolution.digest,
      atlasNormalizedModelDigest: epoch.atlas.resolution.normalizedModelDigest,
      atlasResourceBindingsDigest: epoch.atlas.resolution.resourceBindingsDigest,
    }),
    coverage: Object.freeze([]),
    disciplineRegistry,
  });
  const observation = {
    repository: Object.freeze({
      path: epoch.repository,
      contract,
      commit: selectedCommit,
      tree: selectedTree,
      objectFormat: "sha1",
      productStateDigest: epoch.productState.digest,
      atlasStateDigest: epoch.atlasState.digest,
      atlasResolutionDigest: epoch.atlas.resolution.digest,
      atlasNormalizedModelDigest: epoch.atlas.resolution.normalizedModelDigest,
      atlasResourceBindingsDigest: epoch.atlas.resolution.resourceBindingsDigest,
    }),
    records: Object.freeze(adopted === null ? [] : [adopted.record]),
    currentRecords: Object.freeze(adopted === null ? [] : [adopted.record]),
    historicalRecords: Object.freeze([]),
    relationships: Object.freeze([]),
    coverage: Object.freeze([]),
    exemptions: Object.freeze([]),
    bindings: Object.freeze([]),
    sources: Object.freeze([]),
    conflicts: Object.freeze([]),
    disciplineRegistry,
    validation: knowledgeValidation,
    manifest: knowledgeManifest,
    index: Object.freeze({
      byIdentityRevision: new Map(),
      revisionsByIdentity: new Map(),
      currentByIdentity: new Map(adopted === null ? [] : [[TEST_DISCIPLINE_ID, adopted.record]]),
      outgoingByIdentity: new Map(),
      incomingByIdentity: new Map(),
      coverageByPath: new Map(),
      coveredPathsByDescription: new Map(),
      bindingsByCheck: new Map(),
      sourcesByIdentityRevision: new Map(),
    }),
  } as unknown as NonNullable<FoundationKnowledgeSetResult["knowledgeSet"]>;
  const knowledgeResult: FoundationKnowledgeSetResult = Object.freeze({
    validation: knowledgeValidation,
    observation,
    knowledgeSet: observation,
  });
  const snapshot: FoundationLoadedRepositorySnapshot = Object.freeze({
    ...epoch,
    snapshot: Object.freeze({
      targetId: TARGET,
      commit: selectedCommit,
      tree: selectedTree,
      objectFormat: "sha1",
      contractDigest: contract.digest,
      productStateDigest: epoch.productState.digest,
      atlasStateDigest: epoch.atlasState.digest,
      atlasResolutionDigest: epoch.atlas.resolution.digest,
      atlasNormalizedModelDigest: epoch.atlas.resolution.normalizedModelDigest,
      atlasResourceBindingsDigest: epoch.atlas.resolution.resourceBindingsDigest,
      knowledgeSetDigest: knowledgeManifest.digest,
      digest: valueDigest("repository-snapshot"),
    }),
  });
  return Object.freeze({
    epoch,
    snapshot,
    repositoryValidation: validation("repository"),
    knowledgeResult,
  });
}

function boundary(basis: BasisFixture, externalSources: readonly ControlJsonObject[] = Object.freeze([])): ControlRecordRevision {
  const source = validDeliveryControlPayload("work-boundary");
  const sourceBasis = source.basis as ControlJsonObject;
  const selectedKnowledge = source.knowledge;
  if (!Array.isArray(selectedKnowledge)) throw new TypeError("Work Boundary fixture lacks Knowledge");
  const capability = basis.snapshot.contract.capabilityProfiles["local-development-v1"]!;
  const projection = basis.snapshot.contract.projectionProfiles["execution-standard-v1"]!;
  return revision({
    id: "work-boundary-operation-context",
    kind: "work-boundary",
    payload: Object.freeze({
      ...source,
      targetId: TARGET,
      basis: Object.freeze({
        ...sourceBasis,
        productBaseCommit: COMMIT,
        productBaseTree: TREE,
        productStateDigest: basis.snapshot.snapshot.productStateDigest,
        atlasStateDigest: basis.snapshot.snapshot.atlasStateDigest,
        atlasResolutionDigest: basis.snapshot.snapshot.atlasResolutionDigest,
        atlasNormalizedModelDigest: basis.snapshot.snapshot.atlasNormalizedModelDigest,
        atlasResourceBindingsDigest: basis.snapshot.snapshot.atlasResourceBindingsDigest,
        repositoryContractDigest: basis.snapshot.snapshot.contractDigest,
        knowledgeSetDigest: basis.snapshot.snapshot.knowledgeSetDigest,
        repositorySnapshotDigest: basis.snapshot.snapshot.digest,
      }),
      knowledge: Object.freeze([
        ...selectedKnowledge,
        ...basis.knowledgeResult.knowledgeSet!.disciplineRegistry.adoptions.map(({ id, revision, sourceDigest, semanticDigest }) =>
          Object.freeze({ id, revision, sourceDigest, semanticDigest })),
      ]),
      disciplines: Object.freeze({
        registryDigest: basis.knowledgeResult.knowledgeSet!.disciplineRegistry.digest,
        workTypeIds: Object.freeze(basis.knowledgeResult.knowledgeSet!.disciplineRegistry.workTypes.map(({ id }) => id)),
        records: Object.freeze(basis.knowledgeResult.knowledgeSet!.disciplineRegistry.adoptions.map(({ id, revision, sourceDigest, semanticDigest }) =>
          Object.freeze({ id, revision, sourceDigest, semanticDigest }))),
      }),
      externalSources: Object.freeze(externalSources),
      capabilityProfile: Object.freeze({ id: capability.id, digest: capability.digest }),
      projectionProfile: Object.freeze({ id: projection.id, digest: projection.digest }),
    }),
  });
}

test("execution Discipline selection freezes exact adopted guidance without expanding Work Types", () => {
  const basis = basisFixture();
  const originalKnowledge = basis.knowledgeResult.knowledgeSet!;
  const adopted = foundationDisciplineAdoptionFixture(createRepositoryContract({
    targetId: TARGET,
    canonicalBranch: "refs/heads/main",
    authority: { principalId: "director", keyId: "director-key", publicKey: `ed25519:${Buffer.alloc(32, 7).toString("base64")}` },
    publicationDigest: valueDigest("publication"),
  }));
  const knowledge = Object.freeze({
    ...originalKnowledge,
    disciplineRegistry: adopted.registry,
    index: Object.freeze({ ...originalKnowledge.index, currentByIdentity: new Map([[TEST_DISCIPLINE_ID, adopted.record]]) }),
  });
  const exact = Object.freeze({
    id: TEST_DISCIPLINE_ID,
    revision: adopted.record.frontMatter.revision,
    sourceDigest: adopted.record.sourceDigest,
    semanticDigest: adopted.record.semanticDigest,
  });
  const selection = Object.freeze({
    registryDigest: adopted.registry.digest,
    workTypeIds: Object.freeze([TEST_DISCIPLINE_WORK_TYPE_ID]),
    records: Object.freeze([exact]),
  });
  const originalBoundary = boundary(basis);
  const selectedBoundary = revision({
    id: originalBoundary.recordId,
    kind: "work-boundary",
    payload: Object.freeze({ ...originalBoundary.payload, knowledge: Object.freeze([{ ...exact }]), disciplines: selection }),
  });
  const request = compileFoundationExecutionProjectionRequestV7({
    snapshot: basis.snapshot,
    repositoryValidation: basis.repositoryValidation,
    knowledge,
    boundary: selectedBoundary,
    candidate: candidate(selectedBoundary),
    seal: null,
    role: "builder",
  });
  const compile = (payload: ControlJsonObject, suppliedKnowledge = knowledge) => compileFoundationExecutionProjectionSubjectV7({
    snapshot: basis.snapshot,
    knowledge: suppliedKnowledge,
    boundary: revision({ id: selectedBoundary.recordId, kind: "work-boundary", payload: JSON.parse(JSON.stringify(payload)) as ControlJsonObject }),
    request,
    role: "builder",
  });
  const selected = compile(selectedBoundary.payload);
  assert.deepEqual(selected.core.disciplines.records, [{
    ...exact, title: adopted.record.frontMatter.title, summary: adopted.record.frontMatter.summary, path: adopted.record.path,
  }]);
  assert.deepEqual(selected.core.disciplines.workTypeIds, [TEST_DISCIPLINE_WORK_TYPE_ID]);
  const discoveryOnly = compile({
    ...selectedBoundary.payload,
    knowledge: [],
    disciplines: { ...selection, records: [] },
  });
  assert.deepEqual(discoveryOnly.knowledgeRoots, []);
  assert.deepEqual(discoveryOnly.core.disciplines.records, []);
  assert.deepEqual(discoveryOnly.core.obligations, selected.core.obligations);
  assert.deepEqual(discoveryOnly.core.propositions, selected.core.propositions);
  const mutations: readonly ControlJsonObject[] = [
    { ...selection, registryDigest: valueDigest("wrong-registry") },
    { ...selection, workTypeIds: ["unknown-work-type"] },
    { ...selection, records: [{ ...exact, revision: exact.revision + 1 }] },
    { ...selection, records: [{ ...exact, sourceDigest: valueDigest("wrong-source") }] },
    { ...selection, records: [{ ...exact, semanticDigest: valueDigest("wrong-semantic") }] },
    { ...selection, records: [] },
    { ...selection, records: [exact, exact] },
  ];
  for (const disciplines of mutations) assert.throws(
    () => compile({ ...selectedBoundary.payload, disciplines }),
    (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.operation-context-v7.discipline",
  );
  assert.throws(() => compile({
    ...selectedBoundary.payload,
    knowledge: [{ ...exact, sourceDigest: valueDigest("different-selected-source") }],
  }), /exactly the Discipline subset/u);
  assert.throws(() => compile(selectedBoundary.payload, {
    ...knowledge, disciplineRegistry: { ...adopted.registry, digest: valueDigest("later-registry") },
  }), /exact admitted registry/u);
  assert.deepEqual(compile(selectedBoundary.payload).core.disciplines, selected.core.disciplines);
});

test("execution subject retains an exact selected Atlas Resource as a source anchor", () => {
  const basis = basisFixture();
  const resource = Object.freeze({
    id: "architecture",
    uri: "sources/architecture.md",
    title: "Target architecture",
    "media-type": "text/markdown",
  });
  const binding = Object.freeze({
    resourceId: resource.id,
    uri: resource.uri,
    path: "atlas/sources/architecture.md",
    mode: "100644" as const,
    objectId: "c".repeat(40),
    byteDigest: valueDigest("atlas-resource-architecture"),
    disposition: "resolved" as const,
  });
  const atlas = Object.freeze({
    ...basis.snapshot.atlas,
    model: Object.freeze({
      ...basis.snapshot.atlas.model,
      atlas: Object.freeze({ ...basis.snapshot.atlas.model.atlas, resources: Object.freeze([resource]) }),
    }),
    resolution: Object.freeze({
      ...basis.snapshot.atlas.resolution,
      resourceBindings: Object.freeze([binding]),
      resourceBindingsDigest: digestCanonical([binding]),
    }),
  });
  const snapshot = Object.freeze({ ...basis.snapshot, atlas });
  const selectedBasis = Object.freeze({ ...basis, snapshot });
  const sourceId = atlasResourceSourceId(atlas.model.atlas.id, resource.id);
  const selectedBoundary = boundary(selectedBasis, [Object.freeze({
    ownerKind: "atlas",
    ownerId: sourceId,
    sourceId,
    revision: binding.objectId,
    digest: binding.byteDigest,
  })]);
  const knowledge = basis.knowledgeResult.knowledgeSet;
  if (knowledge === null) assert.fail("fixture Knowledge Set is absent");
  const request = compileFoundationExecutionProjectionRequestV7({
    snapshot,
    repositoryValidation: basis.repositoryValidation,
    knowledge,
    boundary: selectedBoundary,
    candidate: candidate(selectedBoundary),
    seal: null,
    role: "builder",
  });
  const subject = compileFoundationExecutionProjectionSubjectV7({
    snapshot,
    knowledge,
    boundary: selectedBoundary,
    request,
    role: "builder",
  });
  const extracted = compileExecutionProjectionSourceRoots({
    boundary: selectedBoundary,
    knowledge,
    snapshot,
  });

  assert.deepEqual(subject.sourceRoots, extracted);
  assert.deepEqual(subject.sourceRoots, [Object.freeze({
    owner: "source-anchor",
    sourceId,
    reference: binding.path,
    revision: binding.objectId,
    digest: binding.byteDigest,
    authority: "atlas",
    required: true,
    reason: "selected-by-active-work-boundary",
  })]);
});

test("execution source-root projection preserves Knowledge selection, ordering, empty, and refusal semantics", () => {
  const basis = basisFixture();
  const baseKnowledge = basis.knowledgeResult.knowledgeSet;
  if (baseKnowledge === null) assert.fail("fixture Knowledge Set is absent");
  const sources = Object.freeze([
    Object.freeze({
      recordId: "behavior.zulu",
      recordRevision: 3,
      sourceId: "source.zulu",
      required: false,
      reference: "https://example.invalid/zulu",
      role: "research" as const,
      kind: "external" as const,
      locator: null,
      declaredRevision: "revision-zulu",
      declaredDigest: valueDigest("source-zulu"),
      objectId: null,
      resolvedDigest: valueDigest("source-zulu"),
      disposition: "resolved" as const,
    }),
    Object.freeze({
      recordId: "behavior.alpha",
      recordRevision: 1,
      sourceId: "source.alpha",
      required: true,
      reference: "https://example.invalid/alpha",
      role: "policy" as const,
      kind: "external" as const,
      locator: null,
      declaredRevision: null,
      declaredDigest: valueDigest("source-alpha"),
      objectId: null,
      resolvedDigest: valueDigest("source-alpha"),
      disposition: "resolved" as const,
    }),
  ]);
  const knowledge = Object.freeze({ ...baseKnowledge, sources });

  assert.deepEqual(compileExecutionProjectionSourceRoots({
    boundary: boundary(basis),
    knowledge,
    snapshot: basis.snapshot,
  }), []);

  const selectedBoundary = boundary(basis, sources.map((source) => Object.freeze({
    ownerKind: "informational-source",
    ownerId: source.sourceId,
    sourceId: source.sourceId,
    revision: source.declaredRevision,
    digest: source.resolvedDigest!,
  })));
  const roots = compileExecutionProjectionSourceRoots({
    boundary: selectedBoundary,
    knowledge,
    snapshot: basis.snapshot,
  });
  assert.deepEqual(roots, [
    Object.freeze({
      owner: "knowledge",
      recordId: "behavior.alpha",
      recordRevision: 1,
      sourceId: "source.alpha",
      reference: "https://example.invalid/alpha",
      revision: null,
      digest: valueDigest("source-alpha"),
      authority: "informational-source",
      required: true,
      reason: "selected-by-active-work-boundary",
    }),
    Object.freeze({
      owner: "knowledge",
      recordId: "behavior.zulu",
      recordRevision: 3,
      sourceId: "source.zulu",
      reference: "https://example.invalid/zulu",
      revision: "revision-zulu",
      digest: valueDigest("source-zulu"),
      authority: "informational-source",
      required: false,
      reason: "selected-by-active-work-boundary",
    }),
  ]);

  const missingBoundary = boundary(basis, [Object.freeze({
    ownerKind: "informational-source",
    ownerId: "source.missing",
    sourceId: "source.missing",
    revision: null,
    digest: valueDigest("source-missing"),
  })]);
  assert.throws(
    () => compileExecutionProjectionSourceRoots({
      boundary: missingBoundary,
      knowledge,
      snapshot: basis.snapshot,
    }),
    (error: unknown) => {
      assert(error instanceof FoundationError);
      assert.equal(error.code, "lifecycle.operation-context-v7.source");
      assert.deepEqual(error.observedFacts, {
        knowledgeMatches: 0,
        atlasResourceMatches: 0,
      });
      return true;
    },
  );
});

function candidate(selectedBoundary: ControlRecordRevision): ControlRecordRevision {
  const source = validDeliveryControlPayload("candidate-revision");
  const state = source.state as ControlJsonObject;
  return revision({
    id: "candidate-operation-context",
    kind: "candidate-revision",
    payload: Object.freeze({
      ...source,
      candidateBaseCommit: COMMIT,
      state: Object.freeze({
        ...state,
        tree: TREE,
        candidateDigest: valueDigest("candidate-state"),
        productStateDigest: valueDigest("candidate-product-state"),
        knowledgeSetDigest: valueDigest("candidate-knowledge"),
        diffDigest: valueDigest("candidate-diff"),
        pathInventoryDigest: valueDigest("candidate-paths"),
        artifactSetDigest: valueDigest("candidate-artifacts"),
        descriptionCoverageDigest: valueDigest("candidate-coverage"),
      }),
    }),
    relationships: Object.freeze([relationship("governed-by", selectedBoundary)]),
  });
}

function materialCondition(
  selectedBoundary: ControlRecordRevision,
  selectedCandidate: ControlRecordRevision,
): ControlRecordRevision {
  return revision({
    id: "material-condition-operation-context",
    kind: "material-condition",
    payload: validDeliveryControlPayload("material-condition"),
    relationships: Object.freeze([
      relationship("freezes", selectedCandidate),
      relationship("governed-by", selectedBoundary),
    ]),
  });
}

function candidateSeal(
  selectedBoundary: ControlRecordRevision,
  selectedCandidate: ControlRecordRevision,
): ControlRecordRevision {
  return revision({
    id: "seal-operation-context",
    kind: "candidate-seal",
    payload: validDeliveryControlPayload("candidate-seal"),
    relationships: Object.freeze([
      relationship("seals", selectedCandidate),
      relationship("governed-by", selectedBoundary),
    ]),
  });
}

function storeFor(input: Readonly<{
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
  condition?: ControlRecordRevision | null;
  seal?: ControlRecordRevision | null;
  retainedPredecessors?: readonly ControlRecordRevision[];
  integrationAssessment?: ControlRecordRevision | null;
  operation: "delivery.continue" | "delivery.revise";
}>): ControlRecordStore {
  const revisions = Object.freeze([
    input.boundary,
    input.candidate,
    ...(input.integrationAssessment == null ? [] : [input.integrationAssessment]),
    ...(input.condition === undefined || input.condition === null ? [] : [input.condition]),
    ...(input.seal === undefined || input.seal === null ? [] : [input.seal]),
  ]);
  const retained = new Map([
    ...(input.retainedPredecessors ?? []),
    ...revisions,
  ].map((value) => [`${value.recordId}\0${value.revision}`, value]));
  const ref = (value: ControlRecordRevision) => Object.freeze({
    id: value.recordId,
    revision: value.revision,
    digest: value.digest,
  });
  return {
    identity: Object.freeze({
      schema: CONTROL_RECORD_STORE_SCHEMA,
      storeId: "store-operation-context-v7",
      targetId: TARGET,
      processKind: "delivery",
      processId: PROCESS,
      createdAt: CREATED,
    }),
    getRevision(recordId: string, selectedRevision: number): ControlRecordRevision | null {
      return retained.get(`${recordId}\0${selectedRevision}`) ?? null;
    },
    listEvents(): readonly ControlRecordEvent[] {
      return Object.freeze([]);
    },
    listCurrentRevisions(query: Readonly<{
      recordKinds: readonly string[];
      afterRecordId?: string | null;
      limit?: number;
    }>): readonly ControlRecordRevision[] {
      const after = query.afterRecordId ?? "";
      return Object.freeze(revisions
        .filter((value) => query.recordKinds.includes(value.recordKind) && value.recordId > after)
        .sort((left, right) => left.recordId.localeCompare(right.recordId))
        .slice(0, query.limit ?? 100));
    },
    state() {
      return Object.freeze({
        standing: input.operation === "delivery.continue" ? "active" as const : "boundary-paused" as const,
        candidateCondition: input.operation === "delivery.continue"
          ? input.seal == null ? "ready-for-work" as const : "sealed-under-evaluation" as const
          : "paused-for-boundary" as const,
        activities: Object.freeze([]),
        subjects: Object.freeze({
          integrationAssessment: input.integrationAssessment == null ? null : ref(input.integrationAssessment),
          proposedBoundary: null,
          activeBoundary: ref(input.boundary),
          candidate: ref(input.candidate),
          materialCondition: input.condition === undefined || input.condition === null
            ? null
            : ref(input.condition),
          seal: input.seal === undefined || input.seal === null ? null : ref(input.seal),
          evidence: null,
          closure: null,
        }),
        journal: Object.freeze({ eventCount: 0, headDigest: null }),
        eligibleOperations: Object.freeze([input.operation]),
      });
    },
  } as unknown as ControlRecordStore;
}

function configuration(): FoundationInstalledRuntimeConfigurationV7 {
  return Object.freeze({
    machineHome: "/tmp/lifecycle-machine-home",
    installationId: `installation.lifecycle.${"1".repeat(64)}`,
    codexHome: "/tmp/lifecycle-machine-home/codex-exec-home",
    model: "gpt-foundation-test",
    reasoning: "high",
    specificationRevision: "lifecycle.foundation.1.0.0-rc.17",
    publicationDigest: valueDigest("publication"),
  });
}

function retainedStoreFor(input: Readonly<{
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
  currentCandidate?: ControlRecordRevision;
  brief: ControlRecordRevision;
  activityId: string;
  operation?: "delivery.continue" | "delivery.revise";
  condition?: ControlRecordRevision | null;
  seal?: ControlRecordRevision | null;
  extraRevisions?: readonly ControlRecordRevision[];
  events: readonly ControlRecordEvent[];
}>): ControlRecordStore {
  const operation = input.operation ?? "delivery.continue";
  const condition = input.condition ?? null;
  const revisions = Object.freeze([
    input.boundary,
    input.candidate,
    ...(input.currentCandidate === undefined ? [] : [input.currentCandidate]),
    input.brief,
    ...(condition === null ? [] : [condition]),
    ...(input.seal === undefined || input.seal === null ? [] : [input.seal]),
    ...(input.extraRevisions ?? []),
  ]);
  const retained = new Map(revisions.map((value) => [`${value.recordId}\0${value.revision}`, value]));
  const ref = (value: ControlRecordRevision) => Object.freeze({
    id: value.recordId,
    revision: value.revision,
    digest: value.digest,
  });
  return {
    identity: Object.freeze({
      schema: CONTROL_RECORD_STORE_SCHEMA,
      storeId: "store-operation-context-v7",
      targetId: TARGET,
      processKind: "delivery",
      processId: PROCESS,
      createdAt: CREATED,
    }),
    getRevision(recordId: string, selectedRevision: number): ControlRecordRevision | null {
      return retained.get(`${recordId}\0${selectedRevision}`) ?? null;
    },
    listCurrentRevisions(query: Readonly<{
      recordKinds: readonly string[];
      afterRecordId?: string | null;
      limit?: number;
    }>): readonly ControlRecordRevision[] {
      const after = query.afterRecordId ?? "";
      return Object.freeze(revisions
        .filter((value) => query.recordKinds.includes(value.recordKind) && value.recordId > after)
        .sort((left, right) => left.recordId.localeCompare(right.recordId))
        .slice(0, query.limit ?? 100));
    },
    listEvents(afterSequence = 0, limit = 1_000): readonly ControlRecordEvent[] {
      return Object.freeze(input.events.filter(({ sequence }) => sequence > afterSequence).slice(0, limit));
    },
    state() {
      return Object.freeze({
        standing: operation === "delivery.continue" && condition === null ? "active" as const : "boundary-paused" as const,
        candidateCondition: operation === "delivery.continue" && condition === null
          ? "in-progress" as const
          : "paused-for-boundary" as const,
        activities: Object.freeze([Object.freeze({
          id: input.activityId,
          operation,
          family: "agent" as const,
          stage: "started" as const,
          outcome: null,
        })]),
        subjects: Object.freeze({
          integrationAssessment: null,
          proposedBoundary: null,
          activeBoundary: ref(input.boundary),
          candidate: ref(input.currentCandidate ?? input.candidate),
          materialCondition: condition === null ? null : ref(condition),
          seal: input.seal === undefined || input.seal === null ? null : ref(input.seal),
          evidence: null,
          closure: null,
        }),
        journal: Object.freeze({
          eventCount: input.events.length,
          headDigest: input.events.at(-1)?.digest ?? null,
        }),
        eligibleOperations: Object.freeze([]),
      });
    },
  } as unknown as ControlRecordStore;
}

function retainedBrief(input: Readonly<{
  semanticMarkdown: string;
  rawMarkdown: string;
  activityId: string;
  operation?: "delivery.continue" | "delivery.revise";
}>): ControlRecordRevision {
  const operation = input.operation ?? "delivery.continue";
  const source = validDeliveryControlPayload("director-brief");
  return compileControlRecordRevision(PROCESS, {
    recordId: `director-brief-${input.activityId}`,
    recordKind: "director-brief",
    revision: 1,
    producer: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
    semanticAuthor: Object.freeze({ kind: "director", id: "director-operation-context" }),
    semanticAuthority: "director-supplied",
    createdAt: "2026-08-29T21:10:00.000Z",
    semanticMarkdown: input.semanticMarkdown,
    payload: Object.freeze({
      ...source,
      schema: "lifecycle.director-brief-payload.v2",
      scope: Object.freeze({ kind: "activity", activityId: input.activityId }),
      inputProfile: operation,
      templateProfileId: operation === "delivery.continue"
        ? "director-brief.direction-v1"
        : "director-brief.resolution-v1",
      semanticMarkdownDigest: sha256Bytes(input.semanticMarkdown),
      submission: Object.freeze({
        rawDigest: sha256Bytes(input.rawMarkdown),
        rawByteLength: Buffer.byteLength(input.rawMarkdown, "utf8"),
        normalizedByteLength: Buffer.byteLength(input.semanticMarkdown, "utf8"),
      }),
    }),
    relationships: Object.freeze([]),
  });
}

function retainedActivityEvents(input: Readonly<{
  activityId: string;
  brief: ControlRecordRevision;
  submittedAt: string;
  startedAt: string;
  operation?: "delivery.continue" | "delivery.revise";
}>): readonly ControlRecordEvent[] {
  const operation = input.operation ?? "delivery.continue";
  const values = [
    Object.freeze({
      schema: CONTROL_RECORD_EVENT_SCHEMA,
      storeId: "store-operation-context-v7",
      processId: PROCESS,
      eventId: `event-brief-${input.activityId}`,
      sequence: 1,
      eventKind: "director-brief-submitted",
      occurredAt: input.submittedAt,
      actor: Object.freeze({ kind: "runtime" as const, id: "foundation-runtime" }),
      subject: Object.freeze({
        recordId: input.brief.recordId,
        revision: input.brief.revision,
        digest: input.brief.digest,
      }),
      payload: Object.freeze({ activityId: input.activityId }),
      predecessorDigest: null,
      digest: valueDigest(`event-brief-${input.activityId}`),
    }),
    Object.freeze({
      schema: CONTROL_RECORD_EVENT_SCHEMA,
      storeId: "store-operation-context-v7",
      processId: PROCESS,
      eventId: `event-start-${input.activityId}`,
      sequence: 2,
      eventKind: "activity-started",
      occurredAt: input.startedAt,
      actor: Object.freeze({ kind: "runtime" as const, id: "foundation-runtime" }),
      subject: null,
      payload: Object.freeze({ activityId: input.activityId, operation }),
      predecessorDigest: valueDigest(`event-brief-${input.activityId}`),
      digest: valueDigest(`event-start-${input.activityId}`),
    }),
  ];
  return Object.freeze(values as readonly ControlRecordEvent[]);
}

function compilerOptions(
  basis: BasisFixture,
  role: "builder" | "reconnaissance",
  overrides: Readonly<{
    knowledgeResult?: FoundationKnowledgeSetResult;
    observeAgentWorkProducts?: (recordIds: readonly string[]) => void;
  }> = {},
) {
  return Object.freeze({
    async openDeliveryGitBasis(input: { boundary: ControlRecordRevision }) {
      const selectedBasis = input.boundary.payload.basis as ControlJsonObject;
      assert.equal(selectedBasis.productBaseCommit, basis.epoch.epoch.commit);
      const knowledge = overrides.knowledgeResult ?? basis.knowledgeResult;
      return {
        repository: basis.epoch.repository,
        loaded: basis.snapshot,
        knowledge: knowledge.observation,
        knowledgeValidation: knowledge.validation,
      };
    },
    async validateLoadedRepositorySnapshot() { return basis.repositoryValidation; },
    async bindHistoricalRepositorySnapshot() { return basis.snapshot; },
    async validateLoadedHistoricalRepositorySnapshot() { return basis.repositoryValidation; },
    async compileKnowledgeProjection(input: FoundationProjectionCompilerInput) {
      if ("agentWorkProducts" in input && input.agentWorkProducts !== undefined) {
        overrides.observeAgentWorkProducts?.(
          input.agentWorkProducts.map(({ workProduct }) => workProduct.recordId),
        );
      }
      const request = input.request as FoundationExecutionProjectionRequest | FoundationOrientationProjectionRequest;
      if (role === "reconnaissance") {
        if (request.class !== "orientation") throw new TypeError("expected orientation request");
        assert.equal("snapshot" in input.repository, false, "Orientation receives the exact Epoch carrier even when reopened from retained Snapshot custody");
        const unsigned = Object.freeze({
          kind: "orientation" as const,
          objective: request.subject.objective,
          objectiveDigest: request.subject.objectiveDigest,
          atlasStateDigest: request.atlas.stateDigest,
          knowledgeObservationDigest: request.knowledge.knowledgeObservationDigest,
          knowledgeSetDigest: request.knowledge.knowledgeSetDigest,
        });
        const subject = Object.freeze({ ...unsigned, digest: selfDigest(unsigned) });
        return Object.freeze({
          validation: validation("compiled-orientation"),
          projection: foundationAttemptProjectionFixture(subject, {
            orientationProfile: request.profile,
            orientationRepository: Object.freeze({
              commit: request.repository.commit,
              tree: request.repository.tree,
              objectFormat: request.repository.objectFormat,
              repositoryEpochDigest: request.repository.repositoryEpochDigest,
              productStateDigest: request.repository.productStateDigest,
              repositoryContractDigest: request.repository.repositoryContractDigest,
              atlasResolutionDigest: request.atlas.resolutionDigest,
              atlasNormalizedModelDigest: request.atlas.normalizedModelDigest,
              atlasResourceBindingsDigest: request.atlas.resourceBindingsDigest,
            }),
          }),
        });
      }
      if (request.class !== "execution" || request.role !== "builder" || request.subject.candidate === null) {
        throw new TypeError("expected builder request");
      }
      const unsigned = Object.freeze({
        kind: "builder" as const,
        boundary: Object.freeze({ ...request.subject.workBoundary }),
        candidate: Object.freeze({
          baseCommit: request.subject.candidate.baseCommit,
          revision: request.subject.candidate.revision,
          currentDigest: request.subject.candidate.stateDigest,
          carrierManifestDigest: request.subject.candidate.carrierManifestDigest,
          sealedTree: null,
          sealDigest: null,
          diffDigest: null,
        }),
        evidence: Object.freeze({ items: Object.freeze([]) }),
      });
      const subject = Object.freeze({ ...unsigned, digest: selfDigest(unsigned) });
      const selectedCapability = basis.snapshot.contract.capabilityProfiles["local-development-v1"]!;
      return Object.freeze({
        validation: validation("compiled-execution"),
        projection: foundationAttemptProjectionFixture(subject, {
          capability: Object.freeze({
            profileId: selectedCapability.id,
            profileDigest: selectedCapability.digest,
          }),
          executionRepository: Object.freeze({
            tree: request.repository.tree,
            objectFormat: request.repository.objectFormat,
            repositoryEpochDigest: request.repository.repositoryEpochDigest,
            productStateDigest: request.repository.productStateDigest,
            repositoryContractDigest: request.repository.repositoryContractDigest,
            repositorySnapshotDigest: request.repository.repositorySnapshotDigest!,
            repositoryValidationDigest: request.repository.validationDigest!,
            atlasStateDigest: request.atlas.stateDigest,
            atlasResolutionDigest: request.atlas.resolutionDigest,
            atlasNormalizedModelDigest: request.atlas.normalizedModelDigest,
            atlasResourceBindingsDigest: request.atlas.resourceBindingsDigest,
            knowledgeObservationDigest: request.knowledge.knowledgeObservationDigest,
            knowledgeSetDigest: request.knowledge.knowledgeSetDigest!,
            knowledgeValidationDigest: request.knowledge.knowledgeValidationDigest,
          }),
        }),
      });
    },
  });
}

test("fresh continue context derives execution, capability, Evidence, Provider Input, and Investment", async () => {
  const basis = basisFixture();
  const selectedBoundary = boundary(basis);
  const selectedCandidate = candidate(selectedBoundary);
  const store = storeFor({
    boundary: selectedBoundary,
    candidate: selectedCandidate,
    operation: "delivery.continue",
  });
  const context = await compileFoundationFreshAgentOperationContextV7({
    target: basis.epoch.repository,
    store,
    configuration: configuration(),
    activityId: "activity-continue-operation-context",
    operation: "delivery.continue",
    semanticMarkdown: "# Continue\n\nFocus the next bounded pass.\n",
  }, compilerOptions(basis, "builder"));

  assert.equal(context.role, "builder");
  assert.equal(context.request.class, "execution");
  assert.equal(context.snapshot.snapshot.digest, basis.snapshot.snapshot.digest);
  assert.equal(context.repositoryValidation.valid, true);
  assert.equal(context.knowledge.manifest.digest, basis.knowledgeResult.knowledgeSet!.manifest.digest);
  assert.equal(context.subject.core.objective, "Make the bounded demonstration change.");
  assert.deepEqual(context.subject.core.obligations[0], {
    id: "obligation.1",
    kind: "check",
    statement: "The required demonstration check passes.",
    sourceIds: ["check.demo"],
    requiredEvidenceIds: ["artifact.1"],
  });
  assert.deepEqual(context.subject.core.checks[0], {
    id: "selection.check.demo",
    checkId: "check.demo",
    bindingIds: ["binding.check.demo"],
    modality: "precondition",
    purpose: "Establish the admitted baseline and final result.",
  });
  assert.equal(context.providerCapability.candidateWrites, true);
  assert.equal(context.providerInput.operation, "delivery.continue");
  assert.equal(context.providerInput.role, "builder");
  assert.equal(
    context.providerInput.directorDirection.markdown,
    "# Continue\n\nFocus the next bounded pass.\n",
  );
  assert.equal(
    context.providerInput.inputMaterial.directorDirectionDigest,
    context.providerInput.directorDirection.digest,
  );
  assert.equal(context.evidenceSet.subject.items.length, 0);
  assert.equal(context.propositionSet, null);
  assert.equal(context.investment.rationale, "fresh-candidate-development");
  const { digest: _investmentDigest, ...investmentValue } = context.investment;
  assert.equal(
    context.investment.digest,
    digestCanonical(investmentValue),
  );
  assert.equal(
    context.roleSubject.directorDirectionDigest,
    sha256Bytes("# Continue\n\nFocus the next bounded pass.\n"),
  );
});

test("fresh correction compiles a builder context while a prior evaluation Seal remains current", async () => {
  const basis = basisFixture();
  const selectedBoundary = boundary(basis);
  const selectedCandidate = candidate(selectedBoundary);
  const seal = candidateSeal(selectedBoundary, selectedCandidate);
  const context = await compileFoundationFreshAgentOperationContextV7({
    target: basis.epoch.repository,
    store: storeFor({
      boundary: selectedBoundary,
      candidate: selectedCandidate,
      seal,
      operation: "delivery.continue",
    }),
    configuration: configuration(),
    activityId: "activity-correction-after-evaluation",
    operation: "delivery.continue",
    semanticMarkdown: "# Correct\n\nRepair the evaluated result under the same mandate.\n",
  }, compilerOptions(basis, "builder"));

  assert.equal(context.role, "builder");
  assert.equal(context.seal, seal);
  assert.equal(context.attemptSeal, null);
  assert.equal(context.roleSubject.seal, null);
  assert.equal(context.providerCapability.candidateWrites, true);
  assert.equal(context.subject.workBoundary.digest, selectedBoundary.digest);
});

test("builder correction reopens the failed attempted parent while retaining admitted context and Capability", async () => {
  const basis = basisFixture();
  const selectedBoundary = boundary(basis);
  const selectedCandidate = candidate(selectedBoundary);
  const parentValue = { ...basis.snapshot.snapshot, commit: "c".repeat(40) };
  const parentSnapshot = { ...parentValue, digest: selfDigest(parentValue) };
  const failed = revision({ id: "integration-failed-correction", kind: "integration-assessment", payload: {
    schema: "lifecycle.integration-assessment-payload.v1", profileId: "lifecycle.integration-assessment.foundation-v1",
    canonicalParent: parentSnapshot,
    mergeRule: { id: "lifecycle.integration.three-way.v2", implementationId: "lifecycle.integration.git-merge-tree.v1", implementationDigest: valueDigest("merge") },
    outcome: "conflicted", conflicts: [{ path: "src/output.txt", kind: "content" }],
    validation: { complete: false, valid: false, diagnosticCodes: [], factsDigest: valueDigest("conflict") },
    contextualApplicability: { disposition: "unchanged", changes: [] }, assessedAt: CREATED, limitations: [],
  }, relationships: [relationship("governed-by", selectedBoundary), relationship("integrates", selectedCandidate)] });
  const defaultOptions = compilerOptions(basis, "builder");
  let reopened = 0;
  const context = await compileFoundationFreshAgentOperationContextV7({ target: basis.epoch.repository,
    store: storeFor({ boundary: selectedBoundary, candidate: selectedCandidate, integrationAssessment: failed, operation: "delivery.continue" }),
    configuration: configuration(), activityId: "activity-correct-failed-parent", operation: "delivery.continue", semanticMarkdown: "# Resolve the conflict\n",
  }, { ...defaultOptions, async openDeliveryGitSnapshot(input) {
    reopened += 1;
    assert.deepEqual(input.snapshot, parentSnapshot);
    return { repository: "/retained-attempted-parent", loaded: { ...basis.snapshot, snapshot: parentSnapshot },
      knowledge: basis.knowledgeResult.observation, knowledgeValidation: basis.knowledgeResult.validation };
  }, async compileKnowledgeProjection(input) {
    if (!("failedIntegration" in input)) assert.fail("builder lost failed integration correction inputs");
    assert.equal(input.failedIntegration?.correction.assessment.digest, failed.digest);
    assert.equal(input.failedIntegration?.correction.sourceCandidate.digest, selectedCandidate.digest);
    assert.equal(input.failedIntegration?.parent.loaded.snapshot.digest, parentSnapshot.digest);
    assert.equal(input.integrationParent, undefined, "attempted P cannot become governing reviewer context");
    return defaultOptions.compileKnowledgeProjection(input);
  } });
  assert.equal(reopened, 1);
  assert.equal(context.epoch.epoch.commit, COMMIT);
  assert.equal(context.request.repository.commit, COMMIT);
  assert.equal(context.providerCapability.candidateWrites, true);
  assert.equal(context.capabilityProfile.digest, (selectedBoundary.payload.capabilityProfile as ControlJsonObject).digest);
});

test("execution reopens exact admitted context without observing the current canonical epoch", async () => {
  const basis = basisFixture();
  const selectedBoundary = boundary(basis);
  const selectedCandidate = candidate(selectedBoundary);
  const currentRaw = Object.freeze({
    repository: basis.epoch.repository,
    ...basis.epoch.epoch,
    treeEntries: basis.epoch.treeEntries,
  });
  const baseOptions = compilerOptions(basis, "builder");
  let currentLoads = 0;
  let admittedCommit: string | null = null;
  let compiledAtlasStateDigest: Sha256 | null = null;
  const context = await compileFoundationFreshAgentOperationContextV7({
    target: basis.epoch.repository,
    store: storeFor({
      boundary: selectedBoundary,
      candidate: selectedCandidate,
      operation: "delivery.continue",
    }),
    configuration: configuration(),
    activityId: "activity-continue-after-external-atlas-change",
    operation: "delivery.continue",
    semanticMarkdown: "# Continue\n\nUse the Atlas context admitted with this Delivery.\n",
  }, Object.freeze({
    ...baseOptions,
    async loadRepositoryEpoch() {
      throw new TypeError("Active execution must not resolve the current Atlas");
    },
    async loadCurrentRawRepositoryTree() {
      currentLoads += 1;
      return currentRaw;
    },
    async openDeliveryGitBasis(input: { boundary: ControlRecordRevision }) {
      admittedCommit = String((input.boundary.payload.basis as ControlJsonObject).productBaseCommit);
      return baseOptions.openDeliveryGitBasis(input);
    },
    async compileKnowledgeProjection(input: FoundationProjectionCompilerInput) {
      const request = input.request as FoundationExecutionProjectionRequest;
      compiledAtlasStateDigest = request.atlas.stateDigest;
      return baseOptions.compileKnowledgeProjection(input);
    },
  }));

  assert.equal(currentLoads, 0, "execution must not sample unrelated current canonical state");
  assert.equal(admittedCommit, COMMIT);
  assert.equal(context.epoch.epoch.commit, COMMIT);
  assert.equal(context.request.atlas.stateDigest, basis.epoch.atlasState.digest);
  assert.equal(compiledAtlasStateDigest, basis.epoch.atlasState.digest);
  assert.equal(currentRaw.commit, COMMIT);
  assert.equal(currentRaw.tree, TREE);
});

test("execution retains admitted context across Atlas-only canonical movement", async () => {
  const basis = basisFixture();
  const selectedBoundary = boundary(basis);
  const selectedCandidate = candidate(selectedBoundary);
  const currentRaw = Object.freeze({
    repository: basis.epoch.repository,
    ...basis.epoch.epoch,
    commit: "c".repeat(40),
    tree: "d".repeat(40),
    treeEntries: Object.freeze(basis.epoch.treeEntries.filter(({ path }) =>
      path !== "atlas" && !path.startsWith("atlas/"))),
  });

  const context = await compileFoundationFreshAgentOperationContextV7({
      target: basis.epoch.repository,
      store: storeFor({
        boundary: selectedBoundary,
        candidate: selectedCandidate,
        operation: "delivery.continue",
      }),
      configuration: configuration(),
      activityId: "activity-atlas-only-canonical-movement",
      operation: "delivery.continue",
      semanticMarkdown: "# Continue\n\nContinue only at the admitted branch coordinate.\n",
    }, Object.freeze({
      ...compilerOptions(basis, "builder"),
      async loadRepositoryEpoch() {
        throw new TypeError("Active execution must not resolve the current Atlas");
      },
      async loadCurrentRawRepositoryTree() { return currentRaw; },
    }));
  assert.equal(context.epoch.epoch.commit, COMMIT);
  assert.equal(context.epoch.epoch.tree, TREE);
  assert.notEqual(context.epoch.epoch.commit, currentRaw.commit);
  assert.equal(context.request.atlas.stateDigest, basis.epoch.atlasState.digest);
});

test("execution refuses a substituted historical Atlas reproduction", async () => {
  const basis = basisFixture();
  const selectedBoundary = boundary(basis);
  const selectedCandidate = candidate(selectedBoundary);
  const substitutedEpoch = Object.freeze({
    ...basis.epoch,
    atlasState: Object.freeze({
      ...basis.epoch.atlasState,
      digest: valueDigest("substituted-historical-atlas-state"),
    }),
  });

  await assert.rejects(
    compileFoundationFreshAgentOperationContextV7({
      target: basis.epoch.repository,
      store: storeFor({
        boundary: selectedBoundary,
        candidate: selectedCandidate,
        operation: "delivery.continue",
      }),
      configuration: configuration(),
      activityId: "activity-substituted-historical-atlas",
      operation: "delivery.continue",
      semanticMarkdown: "# Continue\n\nUse only the admitted Atlas context.\n",
    }, Object.freeze({
      ...compilerOptions(basis, "builder"),
      async openDeliveryGitBasis(input: { boundary: ControlRecordRevision }) {
        const retained = await compilerOptions(basis, "builder").openDeliveryGitBasis(input);
        return { ...retained, loaded: { ...basis.snapshot, ...substitutedEpoch } };
      },
    })),
    (error: unknown) => error instanceof Error && "code" in error &&
      error.code === "lifecycle.operation-context-v7.admitted-repository",
  );
});

test("execution retains admitted context across canonical product movement", async () => {
  const basis = basisFixture();
  const selectedBoundary = boundary(basis);
  const selectedCandidate = candidate(selectedBoundary);
  const currentRaw = Object.freeze({
    repository: basis.epoch.repository,
    ...basis.epoch.epoch,
    commit: "e".repeat(40),
    tree: "f".repeat(40),
    treeEntries: Object.freeze([
      ...basis.epoch.treeEntries,
      Object.freeze({
        path: "README.md",
        mode: "100644",
        type: "blob",
        objectId: "9".repeat(40),
      }),
    ]),
  });

  const context = await compileFoundationFreshAgentOperationContextV7({
      target: basis.epoch.repository,
      store: storeFor({
        boundary: selectedBoundary,
        candidate: selectedCandidate,
        operation: "delivery.continue",
      }),
      configuration: configuration(),
      activityId: "activity-canonical-product-drift",
      operation: "delivery.continue",
      semanticMarkdown: "# Continue\n\nContinue only from the admitted product basis.\n",
    }, Object.freeze({
      ...compilerOptions(basis, "builder"),
      async loadRepositoryEpoch() {
        throw new TypeError("Active execution must not resolve the current Atlas");
      },
      async loadCurrentRawRepositoryTree() { return currentRaw; },
    }));
  assert.equal(context.epoch.epoch.commit, COMMIT);
  assert.equal(context.epoch.epoch.tree, TREE);
  assert.notEqual(context.epoch.epoch.commit, currentRaw.commit);
  assert.equal(context.request.atlas.stateDigest, basis.epoch.atlasState.digest);
});

test("fresh continue context compiles from a post-readmission Candidate rebind", async () => {
  const basis = basisFixture();
  const priorBoundary = boundary(basis);
  const priorCandidate = candidate(priorBoundary);
  const successorBoundary = revision({
    id: priorBoundary.recordId,
    kind: "work-boundary",
    revision: priorBoundary.revision + 1,
    payload: priorBoundary.payload,
    relationships: Object.freeze([relationship("revises", priorBoundary)]),
  });
  const reboundCandidate = revision({
    id: priorCandidate.recordId,
    kind: "candidate-revision",
    revision: priorCandidate.revision + 1,
    payload: Object.freeze({
      ...priorCandidate.payload,
      observation: "readmission-rebind",
    }),
    relationships: Object.freeze([
      relationship("governed-by", successorBoundary),
      relationship("revises", priorCandidate),
    ]),
  });
  const store = storeFor({
    boundary: successorBoundary,
    candidate: reboundCandidate,
    retainedPredecessors: Object.freeze([priorBoundary, priorCandidate]),
    operation: "delivery.continue",
  });

  const context = await compileFoundationFreshAgentOperationContextV7({
    target: basis.epoch.repository,
    store,
    configuration: configuration(),
    activityId: "activity-post-readmission-continue",
    operation: "delivery.continue",
    semanticMarkdown: "# Continue\n\nWork from the newly readmitted mandate.\n",
  }, compilerOptions(basis, "builder"));

  assert.equal(context.boundary.revision, successorBoundary.revision);
  assert.equal(context.candidate.revision, reboundCandidate.revision);
  assert.equal(context.providerInput.role, "builder");
  assert.equal(context.providerInput.operation, "delivery.continue");
});

for (const orientationProfileId of ["orientation-standard-v1", "orientation-large-v1"]) {
test(`fresh revise context binds the exact Material Condition into read-only orientation (${orientationProfileId})`, async () => {
  const basis = basisFixture(true, COMMIT, TREE, undefined, orientationProfileId);
  const selectedBoundary = boundary(basis);
  const selectedCandidate = candidate(selectedBoundary);
  const originalCondition = materialCondition(selectedBoundary, selectedCandidate);
  const conditionStatement = "The governing Knowledge interpretation needs an explicit Director choice.";
  const condition = revision({ id: originalCondition.recordId, kind: originalCondition.recordKind,
    payload: originalCondition.payload, relationships: originalCondition.relationships,
    semanticMarkdown: `# Material Condition\n\n## Runtime conclusion\n\nThe retained mandate is paused.\n\n## Agent proposal\n\n> ${conditionStatement}\n` });
  const store = storeFor({
    boundary: selectedBoundary,
    candidate: selectedCandidate,
    condition,
    operation: "delivery.revise",
  });
  let admittedLoads = 0;
  const baseOptions = compilerOptions(basis, "reconnaissance");
  const context = await compileFoundationFreshAgentOperationContextV7({
    target: basis.epoch.repository,
    store,
    configuration: configuration(),
    activityId: "activity-revise-operation-context",
    operation: "delivery.revise",
    semanticMarkdown: "# Resolve Boundary\n\nRevise the mandate around the retained condition.\n",
  }, Object.freeze({
    ...baseOptions,
    async loadRepositoryEpoch() {
      throw new TypeError("Boundary resolution must not resolve current Atlas");
    },
    async openDeliveryGitBasis(input: { boundary: ControlRecordRevision }) {
      admittedLoads += 1;
      return baseOptions.openDeliveryGitBasis(input);
    },
  }));

  assert.equal(context.role, "reconnaissance");
  assert.equal(admittedLoads, 1);
  assert.equal(context.epoch.epoch.commit, COMMIT);
  assert.equal(context.request.class, "orientation");
  assert.equal(context.request.profile.id, orientationProfileId);
  const objectiveLines = context.request.subject.objective.split("\n");
  const factStart = objectiveLines.findIndex((line) => line.startsWith("    {"));
  assert.notEqual(factStart, -1);
  const objectiveFacts = JSON.parse(
    objectiveLines.slice(factStart).map((line) => line.slice(4)).join("\n"),
  ) as ControlJsonObject;
  assert.deepEqual(objectiveFacts, {
    operation: "delivery.revise",
    activeBoundary: {
      kind: selectedBoundary.recordKind,
      id: selectedBoundary.recordId,
      revision: selectedBoundary.revision,
      digest: selectedBoundary.digest,
    },
    governingBoundaryContext: {
      basis: selectedBoundary.payload.basis,
      mandate: selectedBoundary.payload.mandate,
      knowledge: selectedBoundary.payload.knowledge,
      disciplines: selectedBoundary.payload.disciplines,
      externalSources: selectedBoundary.payload.externalSources,
      capabilityProfile: selectedBoundary.payload.capabilityProfile,
      executionProjectionProfile: selectedBoundary.payload.projectionProfile,
      relationships: selectedBoundary.relationships,
    },
    frozenMaterialCondition: {
      kind: condition.recordKind,
      id: condition.recordId,
      revision: condition.revision,
      digest: condition.digest,
    },
    frozenConditionContext: {
      semanticMarkdown: condition.semanticMarkdown,
      payload: condition.payload,
      relationships: condition.relationships,
    },
    currentCandidate: {
      kind: selectedCandidate.recordKind,
      id: selectedCandidate.recordId,
      revision: selectedCandidate.revision,
      digest: selectedCandidate.digest,
    },
    directorRationale: "# Resolve Boundary\n\nRevise the mandate around the retained condition.\n",
    directorRationaleDigest: sha256Bytes(
      "# Resolve Boundary\n\nRevise the mandate around the retained condition.\n",
    ),
  });
  assert.equal(
    context.request.subject.objectiveDigest,
    sha256Bytes(context.request.subject.objective),
  );
  assert.match(context.providerInput.roleBrief.markdown, /Revise the mandate around the retained condition\./u);
  const brief = context.providerInput.roleBrief.markdown;
  assert(brief.includes(conditionStatement), "Resolution receives the actual attributed Condition statement, not only its reference");
  assert(brief.includes(TEST_DISCIPLINE_ID), "The governing adopted Discipline identity reaches the provider");
  assert(brief.includes("execution-standard-v1"), "The admitted execution selection remains distinct from either Orientation profile");
  assert.match(brief, /Knowledge and Discipline entries are the governing selections/u);
  const governing = objectiveFacts.governingBoundaryContext as ControlJsonObject;
  assert((governing.knowledge as readonly unknown[]).length > 0);
  assert(((governing.disciplines as ControlJsonObject).records as readonly unknown[]).length > 0);
  for (const [key, value] of Object.entries(selectedBoundary.payload.mandate as ControlJsonObject)) {
    assert.deepEqual((governing.mandate as ControlJsonObject)[key], value, `Resolution preserves the complete governing mandate field ${key}`);
  }
  assert.equal(context.providerInput.directorDirection.markdown,
    "# Resolve Boundary\n\nRevise the mandate around the retained condition.\n", "Runtime context does not replace the exact Director rationale");
  assert.equal(context.providerCapability.candidateWrites, false);
  assert.equal(context.providerInput.operation, "delivery.revise");
  assert.equal(context.evidenceSet, null);
  assert.equal(context.propositionSet, null);
  assert.equal(context.investment.rationale, "fresh-boundary-revision-reconnaissance");
  assert.deepEqual(context.roleSubject.materialCondition, {
    kind: "material-condition",
    id: condition.recordId,
    revision: condition.revision,
    digest: condition.digest,
  });
});
}

test("Boundary resolution retains the current Process Seal without binding a reviewer Attempt Seal", async () => {
  const basis = basisFixture();
  const selectedBoundary = boundary(basis);
  const selectedCandidate = candidate(selectedBoundary);
  const selectedSeal = revision({
    id: "seal-before-boundary-resolution",
    kind: "candidate-seal",
    payload: validDeliveryControlPayload("candidate-seal"),
    relationships: Object.freeze([
      relationship("seals", selectedCandidate),
      relationship("governed-by", selectedBoundary),
    ]),
  });
  const condition = materialCondition(selectedBoundary, selectedCandidate);
  const context = await compileFoundationFreshAgentOperationContextV7({
    target: basis.epoch.repository,
    store: storeFor({
      boundary: selectedBoundary,
      candidate: selectedCandidate,
      seal: selectedSeal,
      condition,
      operation: "delivery.revise",
    }),
    configuration: configuration(),
    activityId: "activity-resolve-after-sealed-review",
    operation: "delivery.revise",
    semanticMarkdown: "# Resolve Boundary\n\nResolve the condition identified during review.\n",
  }, compilerOptions(basis, "reconnaissance"));

  assert.equal(context.role, "reconnaissance");
  assert.equal(context.seal, selectedSeal);
  assert.equal(context.attemptSeal, null);
  assert.equal(context.materialCondition, condition);
  assert.equal(context.subject, null);
  assert.equal(context.providerCapability.candidateWrites, false);
  assert.deepEqual(context.roleSubject.seal, {
    kind: "candidate-seal",
    id: selectedSeal.recordId,
    revision: selectedSeal.revision,
    digest: selectedSeal.digest,
  });
});

test("runtime Projection Condition resolves through bounded Orientation at W without compiling failed reviewer closure", async () => {
  const basis = basisFixture();
  const selectedBoundary = boundary(basis);
  const selectedCandidate = candidate(selectedBoundary);
  const seal = candidateSeal(selectedBoundary, selectedCandidate);
  const profile = basis.snapshot.contract.projectionProfiles["execution-standard-v1"]!;
  const source = { kind: "projection-compilation", requestDigest: valueDigest("impossible-review-request"),
    profile: { id: profile.id, digest: profile.digest }, compiler: { id: "compiler", version: "1", digest: valueDigest("compiler") },
    measurement: { kind: "mandatory-item", category: "source", id: "source.large", locator: "src/large.ts", objectId: "d".repeat(40),
      observedBytes: profile.maximumItemBytes + 1, maximumItemBytes: profile.maximumItemBytes }, refusalFactsDigest: valueDigest("measured-refusal") };
  const condition = revision({ id: "condition-runtime-projection", kind: "material-condition",
    payload: { ...validDeliveryControlPayload("material-condition"), conditionClass: "projection-closure-exceeded", source },
    relationships: [relationship("freezes", selectedCandidate), relationship("governed-by", selectedBoundary), relationship("observed-in", seal)] });
  const store = storeFor({ boundary: selectedBoundary, candidate: selectedCandidate, seal, condition, operation: "delivery.revise" });
  assert.deepEqual(resolveWorkBoundaryResolutionSnapshotV1({ store, boundary: selectedBoundary, materialCondition: condition }), basis.snapshot.snapshot);
  const options = compilerOptions(basis, "reconnaissance");
  let orientation = 0;
  const context = await compileFoundationFreshAgentOperationContextV7({ target: basis.epoch.repository, store, configuration: configuration(),
    activityId: "activity-resolve-runtime-projection", operation: "delivery.revise", semanticMarkdown: "# Reduce mandatory scope\n" }, {
    ...options, async compileKnowledgeProjection(input) {
      const request = input.request as FoundationOrientationProjectionRequest;
      assert.equal(request.class, "orientation");
      assert.match(request.subject.objective, /projection-compilation/);
      assert.match(request.subject.objective, /impossible-review-request|source.large/);
      assert(request.subject.objective.includes(source.refusalFactsDigest));
      orientation += 1;
      return options.compileKnowledgeProjection(input);
    },
  });
  assert.equal(orientation, 1);
  assert.equal(context.providerCapability.candidateWrites, false);
  assert.equal(context.request.repository.commit, COMMIT);
  const otherCandidate = revision({ id: "candidate-other-projection-condition", kind: "candidate-revision", payload: selectedCandidate.payload,
    relationships: [relationship("governed-by", selectedBoundary)] });
  const wrongSeal = revision({ id: seal.recordId, kind: "candidate-seal", payload: seal.payload,
    relationships: [relationship("seals", otherCandidate), relationship("governed-by", selectedBoundary)] });
  const wrongCondition = revision({ id: condition.recordId, kind: "material-condition", payload: condition.payload,
    relationships: [relationship("freezes", selectedCandidate), relationship("governed-by", selectedBoundary), relationship("observed-in", wrongSeal)] });
  assert.throws(() => resolveWorkBoundaryResolutionSnapshotV1({ boundary: selectedBoundary, materialCondition: wrongCondition,
    store: storeFor({ boundary: selectedBoundary, candidate: selectedCandidate, seal: wrongSeal, condition: wrongCondition, operation: "delivery.revise" }) }),
    /exact frozen Candidate, Seal, and governing Boundary/);
});

test("boundary-resolution Orientation compiles an invalid Knowledge observation without a Snapshot", async () => {
  const basis = basisFixture();
  const invalidKnowledgeValidation = Object.freeze({
    ...basis.knowledgeResult.validation,
    complete: false,
    valid: false,
    digest: valueDigest("invalid-knowledge-validation"),
  });
  const invalidObservation = Object.freeze({
    ...basis.knowledgeResult.observation,
    validation: invalidKnowledgeValidation,
    manifest: Object.freeze({
      ...basis.knowledgeResult.observation.manifest,
      complete: false,
      valid: false,
      digest: valueDigest("invalid-knowledge-observation"),
    }),
  });
  const invalidKnowledgeResult: FoundationKnowledgeSetResult = Object.freeze({
    validation: invalidKnowledgeValidation,
    observation: invalidObservation,
    knowledgeSet: null,
  });
  const selectedBoundary = boundary(basis);
  const selectedCandidate = candidate(selectedBoundary);
  const condition = materialCondition(selectedBoundary, selectedCandidate);
  const context = await compileFoundationFreshAgentOperationContextV7({
    target: basis.epoch.repository,
    store: storeFor({
      boundary: selectedBoundary,
      candidate: selectedCandidate,
      condition,
      operation: "delivery.revise",
    }),
    configuration: configuration(),
    activityId: "activity-revise-invalid-knowledge",
    operation: "delivery.revise",
    semanticMarkdown: "# Resolve Boundary\n\nAccount for the observed Knowledge failure.\n",
  }, compilerOptions(basis, "reconnaissance", {
    knowledgeResult: invalidKnowledgeResult,
  }));

  assert.equal(context.request.class, "orientation");
  assert.equal(context.request.knowledge.complete, false);
  assert.equal(context.request.knowledge.valid, false);
  assert.equal(context.request.knowledge.knowledgeSetDigest, null);
  assert.equal(
    context.request.knowledge.knowledgeObservationDigest,
    invalidObservation.manifest.digest,
  );
  assert.equal(context.snapshot, null);
  assert.equal(context.repositoryValidation, null);
  assert.equal(context.knowledge, null);
  assert.equal(context.projection.manifest.class, "orientation");
});

test("fresh Investment binds complete builder Output capacity and keeps semantic-only allocations bounded", () => {
  const basis = basisFixture();
  const selectedBoundary = boundary(basis);
  const selectedCandidate = candidate(selectedBoundary);
  const store = storeFor({
    boundary: selectedBoundary,
    candidate: selectedCandidate,
    operation: "delivery.continue",
  });
  const first = compileFoundationAgentInvestmentV7({
    store,
    activityId: "activity-investment-alpha",
    operation: "delivery.continue",
    configuration: configuration(),
  });
  const repeated = compileFoundationAgentInvestmentV7({
    store,
    activityId: "activity-investment-alpha",
    operation: "delivery.continue",
    configuration: configuration(),
  });
  const second = compileFoundationAgentInvestmentV7({
    store,
    activityId: "activity-investment-beta",
    operation: "delivery.continue",
    configuration: configuration(),
  });
  assert.deepEqual(first, repeated);
  assert.equal(first.wallTimeMs, 30 * 60 * 1_000);
  assert.deepEqual(first.limits, {
    tokens: null,
    events: 10_000,
    outputBytes: 256 * 1024 * 1024,
    toolCalls: null,
    processes: 128,
    storageBytes: 256 * 1024 * 1024,
  });
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.digest, second.digest);
  for (const operation of ["delivery.prepare", "delivery.evaluate", "delivery.revise", "delivery.reaffirm"] as const) {
    const semanticOnly = compileFoundationAgentInvestmentV7({
      store,
      activityId: `activity-investment-${operation.slice("delivery.".length)}`,
      operation,
      configuration: configuration(),
    });
    assert.equal(semanticOnly.limits.outputBytes, 1024 * 1024);
    assert.equal(semanticOnly.limits.processes, 128);
    assert.equal(semanticOnly.limits.storageBytes, first.limits.storageBytes);
  }
});

test("delegated Investment uses the reserved role allocation independently of installed defaults", () => {
  const basis = basisFixture();
  const selectedBoundary = boundary(basis);
  const store = storeFor({ boundary: selectedBoundary, candidate: candidate(selectedBoundary), operation: "delivery.continue" });
  for (const [operation, role] of [["delivery.continue", "builder"], ["delivery.evaluate", "reviewer"]] as const) {
    const activityId = `activity-reserved-${role}`;
    const selection = {
      providerDescriptor: { id: "descriptor.fixture", digest: valueDigest("descriptor") },
      backendProfile: { profileId: "lifecycle.execution-backend-profile.fault-injection.v1" as const, profileDigest: valueDigest("profile"), implementationDigest: valueDigest("implementation") },
      image: { imageId: "image.fixture", imageDigest: valueDigest("image") },
      model: "reserved-model", reasoning: "reserved-reasoning", wallTimeMs: 123_000,
      limits: { tokens: null, events: 512, outputBytes: 8192, toolCalls: null, processes: 64, storageBytes: 16_777_216 },
    };
    const reservation = compileWorkDelegationReservation({
      schema: WORK_DELEGATION_RESERVATION_SCHEMA, reservationId: `reservation.${role}`,
      delegation: { kind: "work-delegation", id: "delegation.fixture", revision: 1, digest: valueDigest("delegation") },
      activityId, operation,
      decision: { journalHead: { sequence: 5, digest: valueDigest("journal") }, basisDigest: valueDigest("basis"), reason: role === "builder" ? "develop-candidate" : "evaluate-integrated-candidate" },
      slots: [{ slotId: `slot.${role}`, purpose: "agent", role, selection }],
    });
    const compiled = compileFoundationAgentInvestmentV7({ store, activityId, operation, configuration: configuration(), reservation });
    const { digest: selectedDigest, id: _id, rationale, ...allocation } = compiled;
    const { providerDescriptor: _provider, backendProfile: _backend, image: _image, ...expected } = selection;
    assert.deepEqual(allocation, expected);
    assert.equal(rationale, role === "builder" ? "delegated-candidate-development" : "delegated-independent-review");
    const { digest: _digest, ...subject } = compiled;
    assert.equal(selectedDigest, digestCanonical(subject));
    assert.deepEqual(compileFoundationAgentInvestmentV7({ store, activityId, operation, configuration: { model: "later-default", reasoning: "low" }, reservation }), compiled);
    for (const changed of [
      { activityId: "activity.other", operation },
      { activityId, operation: "delivery.revise" as const },
    ]) assert.throws(() => compileFoundationAgentInvestmentV7({ store, ...changed, configuration: configuration(), reservation }),
      (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.operation-context-v7.reserved-investment");
  }
});

test("retained context preserves exact Discipline selection, normalized Brief semantics, and original Investment", async () => {
  const basis = basisFixture(true);
  const selectedBoundary = boundary(basis);
  const selectedCandidate = candidate(selectedBoundary);
  const seal = candidateSeal(selectedBoundary, selectedCandidate);
  const activityId = "activity-retained-operation-context";
  const semanticMarkdown = "# Continue\n\nRecover the exact bounded pass.\n";
  const rawMarkdown = "# Continue\r\n\r\nRecover the exact bounded pass.\r\n";
  const fresh = await compileFoundationFreshAgentOperationContextV7({
    target: basis.epoch.repository,
    store: storeFor({
      boundary: selectedBoundary,
      candidate: selectedCandidate,
      seal,
      operation: "delivery.continue",
    }),
    configuration: configuration(),
    activityId,
    operation: "delivery.continue",
    semanticMarkdown,
  }, compilerOptions(basis, "builder"));
  const brief = retainedBrief({ semanticMarkdown, rawMarkdown, activityId });
  const submittedAt = brief.createdAt;
  const startedAt = "2026-08-29T21:11:00.000Z";
  const retainedInvestmentValue = Object.freeze({
    ...fresh.investment,
    model: "retained-model-before-installed-default-change",
    reasoning: "retained-reasoning-before-installed-default-change",
    wallTimeMs: 123_000,
    limits: Object.freeze({ ...fresh.investment.limits, events: 500, outputBytes: 8192, processes: 64 }),
  });
  const { digest: _discardedInvestmentDigest, ...retainedInvestmentSubject } = retainedInvestmentValue;
  const retainedInvestment = Object.freeze({
    ...retainedInvestmentValue,
    digest: digestCanonical(retainedInvestmentSubject),
  });
  const ref = (value: ControlRecordRevision) => Object.freeze({
    id: value.recordId,
    revision: value.revision,
    digest: value.digest,
  });
  const executionPlan = Object.freeze({
    attemptCreatedAt: "2026-08-29T21:12:00.000Z",
    preDispatchStateDigest: valueDigest("retained-pre-dispatch"),
    projection: Object.freeze({
      id: fresh.projection.manifest.projectionId,
      class: fresh.projection.manifest.class,
      profileId: fresh.projection.manifest.profile,
      digest: fresh.projection.manifest.digest,
    }),
    roleSubjectDigest: digestCanonical(fresh.roleSubject),
    capabilityProfile: fresh.capabilityProfile,
    capabilityDigest: digestCanonical(fresh.providerCapability),
    providerInput: Object.freeze({
      manifestDigest: fresh.providerInput.manifestDigest,
      bundleDigest: fresh.providerInput.bundleDigest,
      roleBriefDigest: fresh.providerInput.roleBrief.digest,
      templateProfileId: fresh.providerInput.semanticTemplate.profileId,
      templateDigest: fresh.providerInput.semanticTemplate.digest,
      contentInventoryDigest: fresh.providerInput.contentInventoryDigest,
      inputMaterialDigest: fresh.providerInput.inputMaterialDigest,
      citationRegistryDigest: fresh.providerInput.citationRegistryDigest,
      rootTokenSetDigest: fresh.providerInput.rootTokenSetDigest,
    }),
    evidenceSetDigest: fresh.evidenceSet?.digest ?? null,
    propositionSetDigest: null,
  });
  const support = Object.freeze({
    operation: "delivery.continue" as const,
    role: "builder" as const,
    activityId,
    stage: "activity-opened" as const,
    coordinate: null,
    brief: ref(brief),
    attempt: null,
    boundary: ref(selectedBoundary),
    attemptedCandidate: ref(selectedCandidate),
    seal: null,
    opening: Object.freeze({
      agentId: "agent-operation-context",
      runtimeId: "foundation-runtime",
      directorId: "director-operation-context",
      submittedAt,
      startedAt,
      directorSubmissionRawDigest: sha256Bytes(rawMarkdown),
      directorSubmissionRawByteLength: Buffer.byteLength(rawMarkdown, "utf8"),
      directorSemanticDigest: sha256Bytes(semanticMarkdown),
      directorSemanticByteLength: Buffer.byteLength(semanticMarkdown, "utf8"),
      investment: retainedInvestment,
    }),
    plan: executionPlan,
    promotedExecutionPlan: null,
    finalization: null,
    candidateObservationFailureDigest: null,
    resultCandidate: null,
    receipt: null,
    roleCheckpoint: null,
  }) as unknown as FoundationAgentOperationSupportV7;
  const priorAttempt = revision({
    id: "agent-attempt-prior-context",
    kind: "agent-attempt",
    payload: Object.freeze({
      ...validDeliveryControlPayload("agent-attempt"),
      activityId: "activity-prior-operation-context",
      role: "builder",
    }),
    relationships: Object.freeze([relationship("uses-boundary", selectedBoundary)]),
  });
  const priorWorkProduct = revision({
    id: "agent-work-product-prior-context",
    kind: "agent-work-product",
    payload: validDeliveryControlPayload("agent-work-product"),
    relationships: Object.freeze([relationship("result-of", priorAttempt)]),
  });
  const recoveringAttempt = revision({
    id: "agent-attempt-recovering-context",
    kind: "agent-attempt",
    payload: Object.freeze({
      ...validDeliveryControlPayload("agent-attempt"),
      activityId,
      role: "builder",
    }),
    relationships: Object.freeze([relationship("uses-boundary", selectedBoundary)]),
  });
  const recoveringWorkProduct = revision({
    id: "agent-work-product-recovering-context",
    kind: "agent-work-product",
    payload: validDeliveryControlPayload("agent-work-product"),
    relationships: Object.freeze([relationship("result-of", recoveringAttempt)]),
  });
  const retainedStore = retainedStoreFor({
    boundary: selectedBoundary,
    candidate: selectedCandidate,
    seal,
    brief,
    activityId,
    extraRevisions: Object.freeze([
      priorAttempt,
      priorWorkProduct,
      recoveringAttempt,
      recoveringWorkProduct,
    ]),
    events: retainedActivityEvents({ activityId, brief, submittedAt, startedAt }),
  });
  let observedWorkProducts: readonly string[] = Object.freeze([]);
  const options = Object.freeze({
    ...compilerOptions(basis, "builder", {
      observeAgentWorkProducts(recordIds) { observedWorkProducts = recordIds; },
    }),
    inspectAgentActivity() { return support; },
  });
  const retained = await compileFoundationRetainedAgentOperationContextV7({
    target: basis.epoch.repository,
    store: retainedStore,
    configuration: Object.freeze({
      ...configuration(),
      model: "changed-installed-default",
      reasoning: "changed-installed-reasoning",
    }),
    activityId,
    operation: "delivery.continue",
  }, options);

  assert.equal(retained.semanticMarkdown, semanticMarkdown);
  assert.equal(retained.investment.model, "retained-model-before-installed-default-change");
  assert.equal(retained.investment.reasoning, "retained-reasoning-before-installed-default-change");
  assert.equal(retained.investment.wallTimeMs, 123_000);
  assert.equal(fresh.investment.limits.processes, 128);
  assert.equal(retained.investment.limits.processes, 64);
  assert.deepEqual(retained.investment.limits, retainedInvestment.limits);
  if (retained.role !== "builder" || fresh.role !== "builder") assert.fail("Retained correction must use builder context");
  assert.deepEqual(retained.subject.core.disciplines, fresh.subject.core.disciplines);
  assert.deepEqual(retained.subject.core.disciplines.workTypeIds, [TEST_DISCIPLINE_WORK_TYPE_ID]);
  assert.equal(retained.subject.core.disciplines.records[0]?.id, TEST_DISCIPLINE_ID);
  assert.equal(retained.configuration.model, retained.investment.model);
  assert.equal(retained.configuration.reasoning, retained.investment.reasoning);
  assert.equal(retained.opening.attemptCreatedAt, executionPlan.attemptCreatedAt);
  assert.equal(retained.brief.digest, brief.digest);
  assert.equal(retained.attempt, null);
  assert.equal(retained.seal, seal);
  assert.equal(retained.attemptSeal, null);
  assert.equal(retained.boundaryResolutionBasis, null);
  assert.deepEqual(observedWorkProducts, [priorWorkProduct.recordId]);

  const successor = revision({
    id: selectedCandidate.recordId,
    kind: "candidate-revision",
    revision: selectedCandidate.revision + 1,
    payload: Object.freeze({ ...selectedCandidate.payload, observation: "builder-successor" }),
    relationships: Object.freeze([
      relationship("governed-by", selectedBoundary),
      relationship("revises", selectedCandidate),
      relationship("result-of", recoveringAttempt),
    ]),
  });
  const afterSuccessor = await compileFoundationRetainedAgentOperationContextV7({
    target: basis.epoch.repository,
    store: retainedStoreFor({
      boundary: selectedBoundary,
      candidate: selectedCandidate,
      currentCandidate: successor,
      brief,
      activityId,
      events: retainedActivityEvents({ activityId, brief, submittedAt, startedAt }),
    }),
    configuration: configuration(),
    activityId,
    operation: "delivery.continue",
  }, Object.freeze({
    ...compilerOptions(basis, "builder"),
    inspectAgentActivity() {
      return Object.freeze({ ...support, resultCandidate: ref(successor) });
    },
  }));
  assert.equal(afterSuccessor.seal, null);
  assert.equal(afterSuccessor.candidate, selectedCandidate, "Recovery keeps the attempted input Revision");
  assert.deepEqual(afterSuccessor.roleSubject, retained.roleSubject);
  assert.equal(afterSuccessor.providerInput.manifestDigest, retained.providerInput.manifestDigest);

  const frozenCondition = materialCondition(selectedBoundary, successor);
  const precedingEvents = retainedActivityEvents({ activityId, brief, submittedAt, startedAt });
  const frozenEvent: ControlRecordEvent = Object.freeze({
    ...precedingEvents[1]!,
    eventId: "event-condition-before-interruption",
    sequence: 3,
    eventKind: "material-condition-frozen",
    occurredAt: "2026-08-29T21:20:00.000Z",
    subject: Object.freeze({
      recordId: frozenCondition.recordId,
      revision: frozenCondition.revision,
      digest: frozenCondition.digest,
    }),
    payload: Object.freeze({
      activityId,
      sourceKind: "agent-proposal",
      observedFactsDigest: frozenCondition.payload.observedFactsDigest!,
    }),
    predecessorDigest: precedingEvents[1]!.digest,
    digest: valueDigest("condition-before-interruption"),
  });
  const interruptedStore = (frozen: readonly ControlRecordEvent[]) => retainedStoreFor({
    boundary: selectedBoundary,
    candidate: selectedCandidate,
    currentCandidate: successor,
    condition: frozenCondition,
    brief,
    activityId,
    events: Object.freeze([...precedingEvents, ...frozen]),
  });
  const reopenAfterCondition = (store: ControlRecordStore) => compileFoundationRetainedAgentOperationContextV7({
    target: basis.epoch.repository,
    store,
    configuration: configuration(),
    activityId,
    operation: "delivery.continue",
  }, Object.freeze({
    ...compilerOptions(basis, "builder"),
    inspectAgentActivity() {
      return Object.freeze({ ...support, resultCandidate: ref(successor) });
    },
  }));
  const pausedStore = interruptedStore([frozenEvent]);
  const afterCondition = await reopenAfterCondition(pausedStore);
  assert.equal(afterCondition.materialCondition, null, "Retained Attempt input predates its own condition");
  assert.deepEqual(afterCondition.roleSubject, retained.roleSubject);
  assert.equal(afterCondition.providerInput.manifestDigest, retained.providerInput.manifestDigest);
  assert.deepEqual(pausedStore.state().subjects.materialCondition, ref(frozenCondition));
  assert.equal(pausedStore.state().standing, "boundary-paused");
  assert.equal(pausedStore.state().candidateCondition, "paused-for-boundary");

  for (const unrelated of [
    [],
    [Object.freeze({ ...frozenEvent, payload: Object.freeze({ ...frozenEvent.payload, activityId: "another-activity" }) })],
    [Object.freeze({ ...frozenEvent, subject: Object.freeze({ ...frozenEvent.subject!, digest: valueDigest("another-condition") }) })],
    [frozenEvent, Object.freeze({
      ...frozenEvent,
      eventId: "duplicate-condition",
      sequence: frozenEvent.sequence + 1,
      predecessorDigest: frozenEvent.digest,
      digest: valueDigest("duplicate-condition-before-interruption"),
    })],
  ]) {
    await assert.rejects(reopenAfterCondition(interruptedStore(unrelated)),
      (error: unknown) => error instanceof FoundationError &&
        error.code === "lifecycle.operation-context-v7.retained-subject");
  }

  const substitutedSupport = Object.freeze({
    ...support,
    plan: Object.freeze({
      ...executionPlan,
      projection: Object.freeze({
        ...executionPlan.projection,
        digest: valueDigest("substituted-retained-projection"),
      }),
    }),
  }) as unknown as FoundationAgentOperationSupportV7;
  await assert.rejects(
    compileFoundationRetainedAgentOperationContextV7({
      target: basis.epoch.repository,
      store: retainedStore,
      configuration: configuration(),
      activityId,
      operation: "delivery.continue",
    }, Object.freeze({
      ...compilerOptions(basis, "builder"),
      inspectAgentActivity() { return substitutedSupport; },
    })),
    (error: unknown) => error instanceof Error &&
      "code" in error && error.code === "lifecycle.operation-context-v7.retained-plan",
  );
});

for (const orientationProfileId of ["orientation-standard-v1", "orientation-large-v1"]) {
test(`retained boundary resolution derives the exact Snapshot basis required by finalization (${orientationProfileId})`, async () => {
  const basis = basisFixture(false, COMMIT, TREE, undefined, orientationProfileId);
  const selectedBoundary = boundary(basis);
  const selectedCandidate = candidate(selectedBoundary);
  const condition = materialCondition(selectedBoundary, selectedCandidate);
  const selectedSeal = revision({
    id: "seal-retained-before-resolution",
    kind: "candidate-seal",
    payload: validDeliveryControlPayload("candidate-seal"),
    relationships: Object.freeze([
      relationship("seals", selectedCandidate),
      relationship("governed-by", selectedBoundary),
    ]),
  });
  const activityId = "activity-retained-resolution-context";
  const semanticMarkdown = "# Resolve Boundary\n\nRevise the frozen mandate exactly.\n";
  const fresh = await compileFoundationFreshAgentOperationContextV7({
    target: basis.epoch.repository,
    store: storeFor({
      boundary: selectedBoundary,
      candidate: selectedCandidate,
      condition,
      seal: selectedSeal,
      operation: "delivery.revise",
    }),
    configuration: configuration(),
    activityId,
    operation: "delivery.revise",
    semanticMarkdown,
  }, compilerOptions(basis, "reconnaissance"));
  const brief = retainedBrief({
    semanticMarkdown,
    rawMarkdown: semanticMarkdown,
    activityId,
    operation: "delivery.revise",
  });
  const submittedAt = brief.createdAt;
  const startedAt = "2026-08-29T21:11:00.000Z";
  const ref = (value: ControlRecordRevision) => Object.freeze({
    id: value.recordId,
    revision: value.revision,
    digest: value.digest,
  });
  const executionPlan = Object.freeze({
    attemptCreatedAt: "2026-08-29T21:12:00.000Z",
    preDispatchStateDigest: valueDigest("retained-resolution-pre-dispatch"),
    projection: Object.freeze({
      id: fresh.projection.manifest.projectionId,
      class: fresh.projection.manifest.class,
      profileId: fresh.projection.manifest.profile,
      digest: fresh.projection.manifest.digest,
    }),
    roleSubjectDigest: digestCanonical(fresh.roleSubject),
    capabilityProfile: fresh.capabilityProfile,
    capabilityDigest: digestCanonical(fresh.providerCapability),
    providerInput: Object.freeze({
      manifestDigest: fresh.providerInput.manifestDigest,
      bundleDigest: fresh.providerInput.bundleDigest,
      roleBriefDigest: fresh.providerInput.roleBrief.digest,
      templateProfileId: fresh.providerInput.semanticTemplate.profileId,
      templateDigest: fresh.providerInput.semanticTemplate.digest,
      contentInventoryDigest: fresh.providerInput.contentInventoryDigest,
      inputMaterialDigest: fresh.providerInput.inputMaterialDigest,
      citationRegistryDigest: fresh.providerInput.citationRegistryDigest,
      rootTokenSetDigest: fresh.providerInput.rootTokenSetDigest,
    }),
    evidenceSetDigest: null,
    propositionSetDigest: null,
  });
  const support = Object.freeze({
    operation: "delivery.revise" as const,
    role: "reconnaissance" as const,
    activityId,
    stage: "activity-opened" as const,
    coordinate: null,
    brief: ref(brief),
    attempt: null,
    boundary: ref(selectedBoundary),
    attemptedCandidate: ref(selectedCandidate),
    seal: null,
    opening: Object.freeze({
      agentId: "agent-operation-context",
      runtimeId: "foundation-runtime",
      directorId: "director-operation-context",
      submittedAt,
      startedAt,
      directorSubmissionRawDigest: sha256Bytes(semanticMarkdown),
      directorSubmissionRawByteLength: Buffer.byteLength(semanticMarkdown, "utf8"),
      directorSemanticDigest: sha256Bytes(semanticMarkdown),
      directorSemanticByteLength: Buffer.byteLength(semanticMarkdown, "utf8"),
      investment: fresh.investment,
    }),
    plan: executionPlan,
    promotedExecutionPlan: null,
    finalization: null,
    candidateObservationFailureDigest: null,
    resultCandidate: null,
    receipt: null,
    roleCheckpoint: null,
  }) as unknown as FoundationAgentOperationSupportV7;
  const retainedStore = retainedStoreFor({
    boundary: selectedBoundary,
    candidate: selectedCandidate,
    brief,
    activityId,
    operation: "delivery.revise",
    condition,
    seal: selectedSeal,
    events: retainedActivityEvents({
      activityId,
      brief,
      submittedAt,
      startedAt,
      operation: "delivery.revise",
    }),
  });
  const retained = await compileFoundationRetainedAgentOperationContextV7({
    target: basis.epoch.repository,
    store: retainedStore,
    configuration: configuration(),
    activityId,
    operation: "delivery.revise",
  }, Object.freeze({
    ...compilerOptions(basis, "reconnaissance"),
    inspectAgentActivity() { return support; },
  }));

  assert(retained.boundaryResolutionBasis !== null);
  assert.equal(fresh.request.profile.id, orientationProfileId);
  assert.equal(retained.request.profile.id, orientationProfileId);
  assert.equal(retained.request.profile.digest, fresh.request.profile.digest);
  assert.equal(retained.projection.manifest.profile, orientationProfileId);
  assert.equal(retained.boundaryResolutionBasis.snapshot.snapshot.digest, basis.snapshot.snapshot.digest);
  assert.equal(
    retained.boundaryResolutionBasis.knowledge.manifest.digest,
    basis.knowledgeResult.knowledgeSet?.manifest.digest,
  );
  assert.equal(retained.boundaryResolutionBasis.projection.manifest.digest, fresh.projection.manifest.digest);
  assert.equal(retained.snapshot, null, "Orientation remains epoch-based runtime input");
  assert.equal(retained.seal, selectedSeal);
  assert.equal(retained.attemptSeal, null, "The retained Process Seal is not a reviewer Attempt binding");
});
}

for (const parentCapabilityId of ["local-development-v1", "parent-development-v1"]) {
test(`integration resolution uses P context and proposed ${parentCapabilityId} while retaining the admitted grant`, async () => {
  const admitted = basisFixture();
  const rawParent = basisFixture(false, "c".repeat(40), "d".repeat(40), parentCapabilityId);
  const snapshot = { ...rawParent.snapshot.snapshot, digest: selfDigest(rawParent.snapshot.snapshot) };
  const parent = { ...rawParent, snapshot: { ...rawParent.snapshot, snapshot } };
  const selectedBoundary = boundary(admitted);
  const source = candidate(selectedBoundary);
  const applicability = { disposition: "requires-readmission", changes: [{ subject: "atlas",
    admittedDigest: valueDigest("admitted-context"), parentDigest: valueDigest("parent-context") }] };
  const assessment = revision({ id: "integration-resolution-context", kind: "integration-assessment", payload: {
    schema: "lifecycle.integration-assessment-payload.v1", profileId: "lifecycle.integration-assessment.foundation-v1",
    canonicalParent: snapshot, mergeRule: { id: "lifecycle.integration.three-way.v2", implementationId: "fixture-merge", implementationDigest: valueDigest("merge") },
    outcome: "constructed", conflicts: [], validation: { complete: true, valid: true, diagnosticCodes: [],
      factsDigest: foundationIntegrationValidationFactsDigestV1({
        manifestFileDigest: (source.payload.carrierManifest as ControlJsonObject).digest as Sha256,
        state: source.payload.state, observer: source.payload.observer,
      }) },
    contextualApplicability: applicability, assessedAt: CREATED, limitations: [],
  }, relationships: [relationship("governed-by", selectedBoundary), relationship("integrates", source)] });
  const integrated = revision({ id: source.recordId, kind: "candidate-revision", revision: 2,
    payload: { ...source.payload, observation: "integration-successor", candidateBaseCommit: snapshot.commit },
    relationships: [relationship("governed-by", selectedBoundary), relationship("revises", source), relationship("integrated-from", assessment)] });
  const condition = revision({ id: "condition-integration-context", kind: "material-condition",
    payload: { ...validDeliveryControlPayload("material-condition"), conditionClass: "integration-context-change",
      source: { kind: "integration-assessment" }, observedFactsDigest: digestCanonical(applicability) },
    relationships: [relationship("governed-by", selectedBoundary), relationship("freezes", integrated), relationship("reported-by", assessment)] });
  const store = storeFor({ boundary: selectedBoundary, candidate: integrated, condition, operation: "delivery.revise",
    retainedPredecessors: [source, assessment] });
  let parentOpens = 0;
  let admittedOpens = 0;
  const context = await compileFoundationFreshAgentOperationContextV7({ target: admitted.epoch.repository, store,
    configuration: configuration(), activityId: "activity-integration-resolution", operation: "delivery.revise",
    semanticMarkdown: "# Resolve the integration context\n\nSelect the exact frozen parent context.\n",
  }, {
    ...compilerOptions(parent, "reconnaissance"),
    async openDeliveryGitBasis() {
      admittedOpens += 1;
      return { repository: admitted.epoch.repository, loaded: admitted.snapshot, knowledge: admitted.knowledgeResult.observation,
        knowledgeValidation: admitted.knowledgeResult.validation };
    },
    async openDeliveryGitSnapshot(input) {
      parentOpens += 1;
      assert.deepEqual(input.snapshot, snapshot);
      return { repository: parent.epoch.repository, loaded: parent.snapshot, knowledge: parent.knowledgeResult.observation,
        knowledgeValidation: parent.knowledgeResult.validation };
    },
  });
  assert.equal(parentOpens, 1);
  assert.equal(admittedOpens, 1, "Admitted context is reopened only to materialize the existing grant");
  assert.deepEqual(context.capabilityProfile, selectedBoundary.payload.capabilityProfile);
  assert.equal(context.providerCapability.candidateWrites, false);
  assert.deepEqual(context.providerCapability.externalEffects, []);
  assert.notEqual(context.capabilityProfile.digest, parent.epoch.contract.capabilityProfiles[parentCapabilityId]!.digest);
  if (context.request.class !== "orientation") throw new Error("Expected a resolution Orientation");
  assert.match(context.request.subject.objective, new RegExp(parentCapabilityId));
  assert.equal(context.epoch.epoch.commit, snapshot.commit);
  assert.equal(context.request.repository.commit, snapshot.commit);
  assert.equal(context.boundary, selectedBoundary);
  assert.equal(context.candidate, integrated);
  assert.equal(context.materialCondition, condition);
  assert.equal((context.boundary.payload.basis as ControlJsonObject).productBaseCommit, COMMIT);
  assert.equal(context.role, "reconnaissance");
});

}
