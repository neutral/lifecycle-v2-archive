import assert from "node:assert/strict";
import test from "node:test";
import { compileControlRecordRevision } from "../../src/foundation/control/model.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlJsonObject,
  type ControlRecordEvent,
  type ControlRecordRelationship,
  type ControlRecordRevision,
} from "../../src/foundation/control/types.js";
import type { FoundationInstalledRuntimeConfigurationV7 } from "../../src/foundation/installed-configuration-v7.js";
import type { FoundationKnowledgeSetResult } from "../../src/foundation/knowledge/types.js";
import type { FoundationProjectionCompilerInput } from "../../src/foundation/projection/compiler.js";
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
    semanticMarkdown: `# ${input.kind}\n`,
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

function basisFixture(): BasisFixture {
  const capabilityProfiles = defaultCapabilityProfiles();
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
      capabilityProfileId: "local-development-v1",
      orientationProjectionProfileId: "orientation-standard-v1",
      executionProjectionProfileId: "execution-standard-v1",
      providerDescriptorId: "codex-exec-standard-v6",
    }),
    digest: valueDigest("repository-contract"),
  } as unknown as FoundationRepositoryContract;
  const atlasFixture = minimalAtlasRepositoryState();
  const epoch: FoundationLoadedRepositoryEpoch = {
    repository: "/tmp/foundation-operation-context-v7-target",
    contract,
    epoch: Object.freeze({ ref: "refs/heads/main", commit: COMMIT, tree: TREE, objectFormat: "sha1" }),
    treeEntries: atlasFixture.treeEntries,
    productState: Object.freeze({ entries: Object.freeze([]), digest: valueDigest("product-state") }),
    atlasState: atlasFixture.atlasState,
    atlas: atlasFixture.atlas,
    worktree: Object.freeze({ dirty: false, modified: Object.freeze([]), untracked: Object.freeze([]), ignored: Object.freeze([]) }),
  };
  const knowledgeValidation = validation("knowledge");
  const knowledgeManifest = Object.freeze({
    digest: valueDigest("knowledge-set"),
    complete: true,
    valid: true,
    repository: Object.freeze({
      targetId: TARGET,
      commit: COMMIT,
      tree: TREE,
      objectFormat: "sha1",
      contractDigest: contract.digest,
      productStateDigest: epoch.productState.digest,
      atlasStateDigest: epoch.atlasState.digest,
      atlasResolutionDigest: epoch.atlas.resolution.digest,
      atlasNormalizedModelDigest: epoch.atlas.resolution.normalizedModelDigest,
      atlasResourceBindingsDigest: epoch.atlas.resolution.resourceBindingsDigest,
    }),
    coverage: Object.freeze([]),
  });
  const observation = {
    repository: Object.freeze({
      path: epoch.repository,
      contract,
      commit: COMMIT,
      tree: TREE,
      objectFormat: "sha1",
      productStateDigest: epoch.productState.digest,
      atlasStateDigest: epoch.atlasState.digest,
      atlasResolutionDigest: epoch.atlas.resolution.digest,
      atlasNormalizedModelDigest: epoch.atlas.resolution.normalizedModelDigest,
      atlasResourceBindingsDigest: epoch.atlas.resolution.resourceBindingsDigest,
    }),
    records: Object.freeze([]),
    currentRecords: Object.freeze([]),
    historicalRecords: Object.freeze([]),
    relationships: Object.freeze([]),
    coverage: Object.freeze([]),
    exemptions: Object.freeze([]),
    bindings: Object.freeze([]),
    sources: Object.freeze([]),
    conflicts: Object.freeze([]),
    validation: knowledgeValidation,
    manifest: knowledgeManifest,
    index: Object.freeze({}),
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
      commit: COMMIT,
      tree: TREE,
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
      knowledge: Object.freeze(selectedKnowledge),
      externalSources: Object.freeze(externalSources),
      capabilityProfile: Object.freeze({ id: capability.id, digest: capability.digest }),
      projectionProfile: Object.freeze({ id: projection.id, digest: projection.digest }),
    }),
  });
}

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

function storeFor(input: Readonly<{
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
  condition?: ControlRecordRevision | null;
  retainedPredecessors?: readonly ControlRecordRevision[];
  operation: "delivery.continue" | "delivery.revise";
}>): ControlRecordStore {
  const revisions = Object.freeze([
    input.boundary,
    input.candidate,
    ...(input.condition === undefined || input.condition === null ? [] : [input.condition]),
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
          ? "ready-for-work" as const
          : "paused-for-boundary" as const,
        activities: Object.freeze([]),
        subjects: Object.freeze({
          proposedBoundary: null,
          activeBoundary: ref(input.boundary),
          candidate: ref(input.candidate),
          materialCondition: input.condition === undefined || input.condition === null
            ? null
            : ref(input.condition),
          seal: null,
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
    specificationRevision: "lifecycle.foundation.1.0.0-rc.10",
    publicationDigest: valueDigest("publication"),
  });
}

function retainedStoreFor(input: Readonly<{
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
  brief: ControlRecordRevision;
  activityId: string;
  operation?: "delivery.continue" | "delivery.revise";
  condition?: ControlRecordRevision | null;
  extraRevisions?: readonly ControlRecordRevision[];
  events: readonly ControlRecordEvent[];
}>): ControlRecordStore {
  const operation = input.operation ?? "delivery.continue";
  const condition = input.condition ?? null;
  const revisions = Object.freeze([
    input.boundary,
    input.candidate,
    input.brief,
    ...(condition === null ? [] : [condition]),
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
        standing: operation === "delivery.continue" ? "active" as const : "boundary-paused" as const,
        candidateCondition: operation === "delivery.continue"
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
          proposedBoundary: null,
          activeBoundary: ref(input.boundary),
          candidate: ref(input.candidate),
          materialCondition: condition === null ? null : ref(condition),
          seal: null,
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
  const source = validDeliveryControlPayload("founder-brief");
  return compileControlRecordRevision(PROCESS, {
    recordId: `founder-brief-${input.activityId}`,
    recordKind: "founder-brief",
    revision: 1,
    producer: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
    semanticAuthor: Object.freeze({ kind: "founder", id: "founder-operation-context" }),
    semanticAuthority: "founder-supplied",
    createdAt: "2026-08-29T21:10:00.000Z",
    semanticMarkdown: input.semanticMarkdown,
    payload: Object.freeze({
      ...source,
      inputProfile: operation,
      templateProfileId: operation === "delivery.continue"
        ? "founder-brief.direction-v1"
        : "founder-brief.resolution-v1",
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
      schema: "lifecycle.control-record-event.v2" as const,
      storeId: "store-operation-context-v7",
      processId: PROCESS,
      eventId: `event-brief-${input.activityId}`,
      sequence: 1,
      eventKind: "founder-brief-submitted",
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
      schema: "lifecycle.control-record-event.v2" as const,
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
    rejectSnapshotBinding?: boolean;
    observeAgentWorkProducts?: (recordIds: readonly string[]) => void;
  }> = {},
) {
  return Object.freeze({
    async loadRepositoryEpoch() { return basis.epoch; },
    async loadRepositoryEpochAtCommit(_target: string, commit: string) {
      assert.equal(commit, basis.epoch.epoch.commit);
      return basis.epoch;
    },
    async loadCurrentRawRepositoryTree() {
      return Object.freeze({
        repository: basis.epoch.repository,
        ...basis.epoch.epoch,
        treeEntries: basis.epoch.treeEntries,
      });
    },
    async validateKnowledgeSet() { return overrides.knowledgeResult ?? basis.knowledgeResult; },
    async bindRepositorySnapshot() {
      if (overrides.rejectSnapshotBinding === true) {
        throw new TypeError("Orientation must not bind a Repository Snapshot");
      }
      return basis.snapshot;
    },
    async bindHistoricalRepositorySnapshot() { return basis.snapshot; },
    async validateLoadedRepositorySnapshot() { return basis.repositoryValidation; },
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
  assert.equal(context.subject?.core.objective, "Make the bounded demonstration change.");
  assert.deepEqual(context.subject?.core.obligations[0], {
    id: "obligation.1",
    kind: "check",
    statement: "The required demonstration check passes.",
    sourceIds: ["check.demo"],
    requiredEvidenceIds: ["artifact.1"],
  });
  assert.deepEqual(context.subject?.core.checks[0], {
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
    context.providerInput.founderDirection.markdown,
    "# Continue\n\nFocus the next bounded pass.\n",
  );
  assert.equal(
    context.providerInput.inputMaterial.founderDirectionDigest,
    context.providerInput.founderDirection.digest,
  );
  assert.equal(context.evidenceSet?.subject.items.length, 0);
  assert.equal(context.propositionSet, null);
  assert.equal(context.investment.rationale, "fresh-candidate-development");
  const { digest: _investmentDigest, ...investmentValue } = context.investment;
  assert.equal(
    context.investment.digest,
    digestCanonical(investmentValue),
  );
  assert.equal(
    context.roleSubject.founderDirectionDigest,
    sha256Bytes("# Continue\n\nFocus the next bounded pass.\n"),
  );
});

test("execution reopens admitted Atlas without resolving current Atlas at the frozen branch coordinate", async () => {
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
    async loadRepositoryEpochAtCommit(_target: string, commit: string) {
      admittedCommit = commit;
      return basis.epoch;
    },
    async compileKnowledgeProjection(input: FoundationProjectionCompilerInput) {
      const request = input.request as FoundationExecutionProjectionRequest;
      compiledAtlasStateDigest = request.atlas.stateDigest;
      return baseOptions.compileKnowledgeProjection(input);
    },
  }));

  assert.equal(currentLoads, 1, "execution observes only the raw frozen-branch coordinate");
  assert.equal(admittedCommit, COMMIT);
  assert.equal(context.epoch.epoch.commit, COMMIT);
  assert.equal(context.request.atlas.stateDigest, basis.epoch.atlasState.digest);
  assert.equal(compiledAtlasStateDigest, basis.epoch.atlasState.digest);
  assert.equal(currentRaw.commit, COMMIT);
  assert.equal(currentRaw.tree, TREE);
});

test("execution refuses Atlas-only canonical movement from the admitted branch coordinate", async () => {
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

  await assert.rejects(
    compileFoundationFreshAgentOperationContextV7({
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
    })),
    (error: unknown) => error instanceof Error && "code" in error &&
      error.code === "lifecycle.operation-context-v7.repository-drift",
  );
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
      async loadRepositoryEpochAtCommit() { return substitutedEpoch; },
    })),
    (error: unknown) => error instanceof Error && "code" in error &&
      error.code === "lifecycle.operation-context-v7.admitted-repository",
  );
});

test("execution also refuses canonical movement outside Atlas", async () => {
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

  await assert.rejects(
    compileFoundationFreshAgentOperationContextV7({
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
    })),
    (error: unknown) => error instanceof Error && "code" in error &&
      error.code === "lifecycle.operation-context-v7.repository-drift",
  );
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

test("fresh revise context binds the exact Material Condition into read-only orientation", async () => {
  const basis = basisFixture();
  const selectedBoundary = boundary(basis);
  const selectedCandidate = candidate(selectedBoundary);
  const condition = materialCondition(selectedBoundary, selectedCandidate);
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
    async loadRepositoryEpochAtCommit(_target: string, commit: string) {
      assert.equal(commit, COMMIT);
      admittedLoads += 1;
      return basis.epoch;
    },
  }));

  assert.equal(context.role, "reconnaissance");
  assert.equal(admittedLoads, 1);
  assert.equal(context.epoch.epoch.commit, COMMIT);
  assert.equal(context.request.class, "orientation");
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
    frozenMaterialCondition: {
      kind: condition.recordKind,
      id: condition.recordId,
      revision: condition.revision,
      digest: condition.digest,
    },
    currentCandidate: {
      kind: selectedCandidate.recordKind,
      id: selectedCandidate.recordId,
      revision: selectedCandidate.revision,
      digest: selectedCandidate.digest,
    },
    founderRationale: "# Resolve Boundary\n\nRevise the mandate around the retained condition.\n",
    founderRationaleDigest: sha256Bytes(
      "# Resolve Boundary\n\nRevise the mandate around the retained condition.\n",
    ),
  });
  assert.equal(
    context.request.subject.objectiveDigest,
    sha256Bytes(context.request.subject.objective),
  );
  assert.match(context.providerInput.roleBrief.markdown, /Revise the mandate around the retained condition\./u);
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
    rejectSnapshotBinding: true,
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

test("Investment identity is stable for recovery reconstruction and distinct per activity", () => {
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
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.digest, second.digest);
});

test("retained context rehydrates normalized Brief semantics and preserves the original Investment", async () => {
  const basis = basisFixture();
  const selectedBoundary = boundary(basis);
  const selectedCandidate = candidate(selectedBoundary);
  const activityId = "activity-retained-operation-context";
  const semanticMarkdown = "# Continue\n\nRecover the exact bounded pass.\n";
  const rawMarkdown = "# Continue\r\n\r\nRecover the exact bounded pass.\r\n";
  const fresh = await compileFoundationFreshAgentOperationContextV7({
    target: basis.epoch.repository,
    store: storeFor({
      boundary: selectedBoundary,
      candidate: selectedCandidate,
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
      founderId: "founder-operation-context",
      submittedAt,
      startedAt,
      founderSubmissionRawDigest: sha256Bytes(rawMarkdown),
      founderSubmissionRawByteLength: Buffer.byteLength(rawMarkdown, "utf8"),
      founderSemanticDigest: sha256Bytes(semanticMarkdown),
      founderSemanticByteLength: Buffer.byteLength(semanticMarkdown, "utf8"),
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
  assert.equal(retained.configuration.model, retained.investment.model);
  assert.equal(retained.configuration.reasoning, retained.investment.reasoning);
  assert.equal(retained.opening.attemptCreatedAt, executionPlan.attemptCreatedAt);
  assert.equal(retained.brief.digest, brief.digest);
  assert.equal(retained.attempt, null);
  assert.equal(retained.boundaryResolutionBasis, null);
  assert.deepEqual(observedWorkProducts, [priorWorkProduct.recordId]);

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

test("retained boundary resolution derives the exact Snapshot basis required by finalization", async () => {
  const basis = basisFixture();
  const selectedBoundary = boundary(basis);
  const selectedCandidate = candidate(selectedBoundary);
  const condition = materialCondition(selectedBoundary, selectedCandidate);
  const activityId = "activity-retained-resolution-context";
  const semanticMarkdown = "# Resolve Boundary\n\nRevise the frozen mandate exactly.\n";
  const fresh = await compileFoundationFreshAgentOperationContextV7({
    target: basis.epoch.repository,
    store: storeFor({
      boundary: selectedBoundary,
      candidate: selectedCandidate,
      condition,
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
      founderId: "founder-operation-context",
      submittedAt,
      startedAt,
      founderSubmissionRawDigest: sha256Bytes(semanticMarkdown),
      founderSubmissionRawByteLength: Buffer.byteLength(semanticMarkdown, "utf8"),
      founderSemanticDigest: sha256Bytes(semanticMarkdown),
      founderSemanticByteLength: Buffer.byteLength(semanticMarkdown, "utf8"),
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
  assert.equal(retained.boundaryResolutionBasis.snapshot.snapshot.digest, basis.snapshot.snapshot.digest);
  assert.equal(
    retained.boundaryResolutionBasis.knowledge.manifest.digest,
    basis.knowledgeResult.knowledgeSet?.manifest.digest,
  );
  assert.equal(retained.boundaryResolutionBasis.projection.manifest.digest, fresh.projection.manifest.digest);
  assert.equal(retained.snapshot, null, "Orientation remains epoch-based runtime input");
});
