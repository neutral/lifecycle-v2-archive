import {
  FOUNDATION_PROVIDER_PROTOCOL,
  FOUNDATION_REPOSITORY_SCHEMA,
  FOUNDATION_SPECIFICATION_REVISION,
  FOUNDATION_WORK_BOUNDARY_PAYLOAD_SCHEMA,
} from "../constants.js";
import type { ControlRecordStore } from "../control/store.js";
import type { ControlJsonObject, ControlJsonValue, ControlRecordRevision } from "../control/types.js";
import type { WorkBoundaryRepositoryBasis } from "../control/work-boundary.js";
import { FoundationError } from "../error.js";
import { validateKnowledgeSet } from "../knowledge/knowledge-set.js";
import type { FoundationKnowledgeSet, FoundationKnowledgeSetResult } from "../knowledge/types.js";
import {
  bindHistoricalRepositorySnapshot,
  loadRepositoryEpochAtCommit,
} from "../repository/snapshot.js";
import type {
  FoundationLoadedRepositoryEpoch,
  FoundationLoadedRepositorySnapshot,
  FoundationRepositorySnapshot,
} from "../repository/types.js";
import { canonicalJson, digestCanonical, type Sha256 } from "../validation/canonical.js";

const GIT_OBJECT = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const BASIS_KEYS = Object.freeze([
  "specificationRevision",
  "repositoryContract",
  "providerAdapter",
  "productBaseCommit",
  "productBaseTree",
  "productStateDigest",
  "atlasStateDigest",
  "atlasResolutionDigest",
  "atlasNormalizedModelDigest",
  "atlasResourceBindingsDigest",
  "repositoryContractDigest",
  "knowledgeSetDigest",
  "repositorySnapshotDigest",
] as const);

type QueryControlStore = Pick<ControlRecordStore, "identity" | "state" | "getRevision">;

export type FoundationDeliveryQueryRepositoryBasis = Readonly<WorkBoundaryRepositoryBasis & {
  specificationRevision: typeof FOUNDATION_SPECIFICATION_REVISION;
  repositoryContract: typeof FOUNDATION_REPOSITORY_SCHEMA;
  providerAdapter: typeof FOUNDATION_PROVIDER_PROTOCOL;
}>;

export type FoundationDeliveryQueryBasisOwners = Readonly<{
  loadRepositoryEpochAtCommit: (
    target: string,
    commit: string,
  ) => Promise<FoundationLoadedRepositoryEpoch>;
  validateKnowledgeSet: (
    loaded: FoundationLoadedRepositoryEpoch,
  ) => Promise<FoundationKnowledgeSetResult>;
  bindHistoricalRepositorySnapshot: (
    loaded: FoundationLoadedRepositoryEpoch,
    knowledge: FoundationKnowledgeSet,
  ) => Promise<FoundationLoadedRepositorySnapshot>;
}>;

export type FoundationDeliveryQueryBasis = Readonly<{
  boundaryRole: "proposed" | "active";
  boundary: ControlRecordRevision;
  basis: FoundationDeliveryQueryRepositoryBasis;
  knowledge: FoundationKnowledgeSet;
  repository: FoundationLoadedRepositorySnapshot;
}>;

const DEFAULT_OWNERS: FoundationDeliveryQueryBasisOwners = Object.freeze({
  loadRepositoryEpochAtCommit,
  validateKnowledgeSet,
  bindHistoricalRepositorySnapshot,
});

function fail(
  code: string,
  message: string,
  observedFacts: Readonly<Record<string, unknown>> = {},
): never {
  throw new FoundationError(`lifecycle.delivery-query-basis.${code}`, message, {
    observedFacts,
  });
}

function object(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    fail("basis-invalid", `${label} must be one exact object`);
  }
  return value as ControlJsonObject;
}

function exactKeys(value: ControlJsonObject, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    fail("basis-invalid", `${label} must contain exactly its current Foundation fields`, {
      actual,
      expected: required,
    });
  }
}

function exactString(value: ControlJsonValue | undefined, expected: string, label: string): string {
  if (value !== expected) {
    fail("basis-invalid", `${label} does not select the current Foundation coordinate`, {
      actual: value ?? null,
      expected,
    });
  }
  return expected;
}

function gitObject(value: ControlJsonValue | undefined, label: string): string {
  if (typeof value !== "string" || !GIT_OBJECT.test(value)) {
    fail("basis-invalid", `${label} must be one exact full Git object identity`);
  }
  return value;
}

function digest(value: ControlJsonValue | undefined, label: string): Sha256 {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail("basis-invalid", `${label} must be one lowercase SHA-256 digest`);
  }
  return value as Sha256;
}

function retainedBasis(boundary: ControlRecordRevision): FoundationDeliveryQueryRepositoryBasis {
  if (
    boundary.payload.schema !== FOUNDATION_WORK_BOUNDARY_PAYLOAD_SCHEMA ||
    boundary.payload.profileId !== "lifecycle.work-boundary.foundation-v1"
  ) {
    fail("basis-invalid", "Selected Work Boundary does not use the current Foundation payload profile");
  }
  const source = object(boundary.payload.basis, "Work Boundary repository basis");
  exactKeys(source, BASIS_KEYS, "Work Boundary repository basis");
  return Object.freeze({
    specificationRevision: exactString(
      source.specificationRevision,
      FOUNDATION_SPECIFICATION_REVISION,
      "Work Boundary specification revision",
    ) as typeof FOUNDATION_SPECIFICATION_REVISION,
    repositoryContract: exactString(
      source.repositoryContract,
      FOUNDATION_REPOSITORY_SCHEMA,
      "Work Boundary repository contract",
    ) as typeof FOUNDATION_REPOSITORY_SCHEMA,
    providerAdapter: exactString(
      source.providerAdapter,
      FOUNDATION_PROVIDER_PROTOCOL,
      "Work Boundary Provider Adapter",
    ) as typeof FOUNDATION_PROVIDER_PROTOCOL,
    productBaseCommit: gitObject(source.productBaseCommit, "Work Boundary product base commit"),
    productBaseTree: gitObject(source.productBaseTree, "Work Boundary product base tree"),
    productStateDigest: digest(source.productStateDigest, "Work Boundary Product State digest"),
    atlasStateDigest: digest(source.atlasStateDigest, "Work Boundary Atlas State digest"),
    atlasResolutionDigest: digest(source.atlasResolutionDigest, "Work Boundary Atlas Resolution digest"),
    atlasNormalizedModelDigest: digest(
      source.atlasNormalizedModelDigest,
      "Work Boundary Atlas normalized-model digest",
    ),
    atlasResourceBindingsDigest: digest(
      source.atlasResourceBindingsDigest,
      "Work Boundary Atlas Resource-bindings digest",
    ),
    repositoryContractDigest: digest(
      source.repositoryContractDigest,
      "Work Boundary Repository Contract digest",
    ),
    knowledgeSetDigest: digest(source.knowledgeSetDigest, "Work Boundary Knowledge Set digest"),
    repositorySnapshotDigest: digest(
      source.repositorySnapshotDigest,
      "Work Boundary Repository Snapshot digest",
    ),
  });
}

function selectedBoundary(store: QueryControlStore): Readonly<{
  role: "proposed" | "active";
  revision: ControlRecordRevision;
}> {
  const state = store.state();
  const selected = state.subjects.proposedBoundary ?? state.subjects.activeBoundary;
  if (selected === null) {
    fail("boundary-absent", "Delivery has no proposed or active Work Boundary to query");
  }
  const revision = store.getRevision(selected.id, selected.revision);
  if (
    revision === null ||
    revision.processId !== store.identity.processId ||
    revision.recordKind !== "work-boundary" ||
    revision.recordId !== selected.id ||
    revision.revision !== selected.revision ||
    revision.digest !== selected.digest
  ) {
    fail("boundary-substituted", "Derived Delivery state does not resolve one exact retained Work Boundary", {
      selected,
      retained: revision === null ? null : {
        processId: revision.processId,
        recordKind: revision.recordKind,
        recordId: revision.recordId,
        revision: revision.revision,
        digest: revision.digest,
      },
    });
  }
  if (revision.payload.targetId !== store.identity.targetId) {
    fail("boundary-substituted", "Selected Work Boundary targets another repository identity");
  }
  return Object.freeze({
    role: state.subjects.proposedBoundary === null ? "active" : "proposed",
    revision,
  });
}

function actualEpochBasis(loaded: FoundationLoadedRepositoryEpoch) {
  return Object.freeze({
    productBaseCommit: loaded.epoch.commit,
    productBaseTree: loaded.epoch.tree,
    productStateDigest: loaded.productState.digest,
    atlasStateDigest: loaded.atlasState.digest,
    atlasResolutionDigest: loaded.atlas.resolution.digest,
    atlasNormalizedModelDigest: loaded.atlas.resolution.normalizedModelDigest,
    atlasResourceBindingsDigest: loaded.atlas.resolution.resourceBindingsDigest,
    repositoryContractDigest: loaded.contract.digest,
  });
}

function assertEpochBasis(
  expected: FoundationDeliveryQueryRepositoryBasis,
  loaded: FoundationLoadedRepositoryEpoch,
  targetId: string,
): void {
  const actual = actualEpochBasis(loaded);
  if (
    loaded.contract.targetId !== targetId ||
    expected.productBaseCommit !== actual.productBaseCommit ||
    expected.productBaseTree !== actual.productBaseTree ||
    expected.productStateDigest !== actual.productStateDigest ||
    expected.atlasStateDigest !== actual.atlasStateDigest ||
    expected.atlasResolutionDigest !== actual.atlasResolutionDigest ||
    expected.atlasNormalizedModelDigest !== actual.atlasNormalizedModelDigest ||
    expected.atlasResourceBindingsDigest !== actual.atlasResourceBindingsDigest ||
    expected.repositoryContractDigest !== actual.repositoryContractDigest
  ) {
    fail("repository-basis-mismatch", "Historical repository epoch does not reproduce the Work Boundary basis", {
      actual: { targetId: loaded.contract.targetId, ...actual },
      expected: { targetId, ...expected },
    });
  }
}

function assertKnowledgeBasis(
  expected: FoundationDeliveryQueryRepositoryBasis,
  loaded: FoundationLoadedRepositoryEpoch,
  result: FoundationKnowledgeSetResult,
): FoundationKnowledgeSet {
  const knowledge = result.knowledgeSet;
  if (
    knowledge === null ||
    !result.validation.complete ||
    !result.validation.valid ||
    !knowledge.validation.complete ||
    !knowledge.validation.valid ||
    canonicalJson(result.validation) !== canonicalJson(knowledge.validation)
  ) {
    fail("knowledge-invalid", "Historical Work Boundary Knowledge does not reproduce one complete valid result", {
      complete: result.validation.complete,
      valid: result.validation.valid,
      knowledgeSetPresent: knowledge !== null,
    });
  }
  const actualRepository = {
    targetId: knowledge.manifest.repository.targetId,
    commit: knowledge.manifest.repository.commit,
    tree: knowledge.manifest.repository.tree,
    objectFormat: knowledge.manifest.repository.objectFormat,
    contractDigest: knowledge.manifest.repository.contractDigest,
    productStateDigest: knowledge.manifest.repository.productStateDigest,
    atlasStateDigest: knowledge.manifest.repository.atlasStateDigest,
    atlasResolutionDigest: knowledge.manifest.repository.atlasResolutionDigest,
    atlasNormalizedModelDigest: knowledge.manifest.repository.atlasNormalizedModelDigest,
    atlasResourceBindingsDigest: knowledge.manifest.repository.atlasResourceBindingsDigest,
  };
  const expectedRepository = {
    targetId: loaded.contract.targetId,
    commit: loaded.epoch.commit,
    tree: loaded.epoch.tree,
    objectFormat: loaded.epoch.objectFormat,
    contractDigest: loaded.contract.digest,
    productStateDigest: loaded.productState.digest,
    atlasStateDigest: loaded.atlasState.digest,
    atlasResolutionDigest: loaded.atlas.resolution.digest,
    atlasNormalizedModelDigest: loaded.atlas.resolution.normalizedModelDigest,
    atlasResourceBindingsDigest: loaded.atlas.resolution.resourceBindingsDigest,
  };
  const actualKnowledgeRepository = {
    targetId: knowledge.repository.contract.targetId,
    commit: knowledge.repository.commit,
    tree: knowledge.repository.tree,
    objectFormat: knowledge.repository.objectFormat,
    contractDigest: knowledge.repository.contract.digest,
    productStateDigest: knowledge.repository.productStateDigest,
    atlasStateDigest: knowledge.repository.atlasStateDigest,
    atlasResolutionDigest: knowledge.repository.atlasResolutionDigest,
    atlasNormalizedModelDigest: knowledge.repository.atlasNormalizedModelDigest,
    atlasResourceBindingsDigest: knowledge.repository.atlasResourceBindingsDigest,
  };
  if (
    knowledge.repository.path !== loaded.repository ||
    canonicalJson(actualKnowledgeRepository) !== canonicalJson(expectedRepository) ||
    canonicalJson(actualRepository) !== canonicalJson(expectedRepository) ||
    knowledge.manifest.digest !== expected.knowledgeSetDigest
  ) {
    fail("knowledge-basis-mismatch", "Historical Knowledge does not bind the exact Work Boundary repository basis", {
      actualRepository,
      actualKnowledgeRepository,
      actualKnowledgeSetDigest: knowledge.manifest.digest,
      expectedRepository,
      expectedKnowledgeSetDigest: expected.knowledgeSetDigest,
    });
  }
  return knowledge;
}

function repositorySnapshotDigest(snapshot: FoundationRepositorySnapshot): Sha256 {
  return digestCanonical({
    targetId: snapshot.targetId,
    commit: snapshot.commit,
    tree: snapshot.tree,
    objectFormat: snapshot.objectFormat,
    contractDigest: snapshot.contractDigest,
    productStateDigest: snapshot.productStateDigest,
    atlasStateDigest: snapshot.atlasStateDigest,
    atlasResolutionDigest: snapshot.atlasResolutionDigest,
    atlasNormalizedModelDigest: snapshot.atlasNormalizedModelDigest,
    atlasResourceBindingsDigest: snapshot.atlasResourceBindingsDigest,
    knowledgeSetDigest: snapshot.knowledgeSetDigest,
  });
}

function assertSnapshotBasis(
  expected: FoundationDeliveryQueryRepositoryBasis,
  loaded: FoundationLoadedRepositoryEpoch,
  snapshot: FoundationLoadedRepositorySnapshot,
): void {
  const actual = snapshot.snapshot;
  const exact = {
    targetId: loaded.contract.targetId,
    commit: loaded.epoch.commit,
    tree: loaded.epoch.tree,
    objectFormat: loaded.epoch.objectFormat,
    contractDigest: expected.repositoryContractDigest,
    productStateDigest: expected.productStateDigest,
    atlasStateDigest: expected.atlasStateDigest,
    atlasResolutionDigest: expected.atlasResolutionDigest,
    atlasNormalizedModelDigest: expected.atlasNormalizedModelDigest,
    atlasResourceBindingsDigest: expected.atlasResourceBindingsDigest,
    knowledgeSetDigest: expected.knowledgeSetDigest,
  };
  const actualSubject = {
    targetId: actual.targetId,
    commit: actual.commit,
    tree: actual.tree,
    objectFormat: actual.objectFormat,
    contractDigest: actual.contractDigest,
    productStateDigest: actual.productStateDigest,
    atlasStateDigest: actual.atlasStateDigest,
    atlasResolutionDigest: actual.atlasResolutionDigest,
    atlasNormalizedModelDigest: actual.atlasNormalizedModelDigest,
    atlasResourceBindingsDigest: actual.atlasResourceBindingsDigest,
    knowledgeSetDigest: actual.knowledgeSetDigest,
  };
  if (
    snapshot.repository !== loaded.repository ||
    canonicalJson(actualSubject) !== canonicalJson(exact) ||
    actual.digest !== repositorySnapshotDigest(actual) ||
    actual.digest !== expected.repositorySnapshotDigest
  ) {
    fail("snapshot-basis-mismatch", "Bound historical Repository Snapshot does not reproduce the Work Boundary basis", {
      actual: { ...actualSubject, digest: actual.digest },
      expected: { ...exact, digest: expected.repositorySnapshotDigest },
    });
  }
}

/**
 * Reopen the immutable repository, Atlas, and Knowledge basis selected by the
 * current proposed-or-active Work Boundary. This compiler intentionally adds
 * no live-branch continuity requirement: the historical repository loader
 * owns the attached-epoch guards needed to reopen immutable Git authority.
 */
export async function compileFoundationDeliveryQueryBasis(input: Readonly<{
  target: string;
  store: QueryControlStore;
  owners?: FoundationDeliveryQueryBasisOwners;
}>): Promise<FoundationDeliveryQueryBasis> {
  const owners = input.owners ?? DEFAULT_OWNERS;
  const selected = selectedBoundary(input.store);
  const boundary = selected.revision;
  const basis = retainedBasis(boundary);
  const loaded = await owners.loadRepositoryEpochAtCommit(input.target, basis.productBaseCommit);
  assertEpochBasis(basis, loaded, input.store.identity.targetId);
  const knowledge = assertKnowledgeBasis(
    basis,
    loaded,
    await owners.validateKnowledgeSet(loaded),
  );
  const bound = await owners.bindHistoricalRepositorySnapshot(loaded, knowledge);
  assertSnapshotBasis(basis, loaded, bound);
  const repository = Object.freeze({ ...loaded, snapshot: bound.snapshot });
  return Object.freeze({
    boundaryRole: selected.role,
    boundary,
    basis,
    knowledge,
    repository,
  });
}
