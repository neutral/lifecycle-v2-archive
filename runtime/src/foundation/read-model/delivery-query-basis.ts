import {
  FOUNDATION_PROVIDER_PROTOCOL,
  FOUNDATION_REPOSITORY_SCHEMA,
  FOUNDATION_SPECIFICATION_REVISION,
  FOUNDATION_WORK_BOUNDARY_PAYLOAD_SCHEMA,
} from "../constants.js";
import type { ControlRecordStore } from "../control/store.js";
import type { ControlJsonObject, ControlJsonValue, ControlRecordRevision } from "../control/types.js";
import type {
  WorkBoundaryReference,
  WorkBoundaryRepositoryBasis,
} from "../control/work-boundary.js";
import { FoundationError } from "../error.js";
import type { FoundationKnowledgeSet, FoundationKnowledgeSetResult } from "../knowledge/types.js";
import { openFoundationDeliveryGitBasisV1 } from "../repository/delivery-git-basis.js";
import type {
  FoundationLoadedRepositoryEpoch,
  FoundationLoadedRepositorySnapshot,
  FoundationRepositorySnapshot,
} from "../repository/types.js";
import { canonicalJson, digestCanonical, type Sha256 } from "../validation/canonical.js";
import type { FoundationContextSelection } from "@neutral/lifecycle-protocol";
import { resolveFoundationInspectionSelection } from "./inspection-selection.js";

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

export type FoundationDeliveryQueryBoundaryReference = WorkBoundaryReference<"work-boundary">;

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
    boundary.payload.profileId !== "lifecycle.work-boundary.foundation-v3"
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
  return retainedBoundary(store, {
    role: state.subjects.proposedBoundary === null ? "active" : "proposed",
    reference: selected,
  });
}

function sameBoundaryReference(
  left: Readonly<{ id: string; revision: number; digest: Sha256 }> | null,
  right: FoundationDeliveryQueryBoundaryReference,
): boolean {
  return left !== null &&
    left.id === right.id &&
    left.revision === right.revision &&
    left.digest === right.digest;
}

function selectedBoundaryReference(
  store: QueryControlStore,
  reference: FoundationDeliveryQueryBoundaryReference,
): Readonly<{
  role: "proposed" | "active";
  revision: ControlRecordRevision;
}> {
  if (reference.kind !== "work-boundary") {
    fail("boundary-substituted", "Requested Boundary reference must have kind work-boundary", {
      requested: reference,
    });
  }
  const state = store.state();
  const proposed = sameBoundaryReference(state.subjects.proposedBoundary, reference);
  const active = sameBoundaryReference(state.subjects.activeBoundary, reference);
  if (proposed === active) {
    fail("boundary-substituted", "Requested Work Boundary does not select exactly one current Boundary", {
      requested: reference,
      proposedBoundary: state.subjects.proposedBoundary,
      activeBoundary: state.subjects.activeBoundary,
    });
  }
  return retainedBoundary(store, {
    role: proposed ? "proposed" : "active",
    reference,
  });
}

function retainedBoundary(
  store: QueryControlStore,
  selected: Readonly<{
    role: "proposed" | "active";
    reference: Readonly<{ id: string; revision: number; digest: Sha256 }>;
  }>,
): Readonly<{
  role: "proposed" | "active";
  revision: ControlRecordRevision;
}> {
  const reference = selected.reference;
  const revision = store.getRevision(reference.id, reference.revision);
  if (
    revision === null ||
    revision.processId !== store.identity.processId ||
    revision.recordKind !== "work-boundary" ||
    revision.recordId !== reference.id ||
    revision.revision !== reference.revision ||
    revision.digest !== reference.digest
  ) {
    fail("boundary-substituted", "Derived Delivery state does not resolve one exact retained Work Boundary", {
      selected: reference,
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
    role: selected.role,
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
  result: Pick<FoundationKnowledgeSetResult, "knowledgeSet" | "validation">,
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

async function compileSelectedDeliveryQueryBasis(input: Readonly<{
  machineHome: string;
  target: string;
  store: QueryControlStore;
  selected: Readonly<{
    role: "proposed" | "active";
    revision: ControlRecordRevision;
  }>;
  owners?: FoundationDeliveryQueryBasisOwners;
}>): Promise<FoundationDeliveryQueryBasis> {
  const boundary = input.selected.revision;
  const basis = retainedBasis(boundary);
  const retained = input.owners === undefined
    ? await openFoundationDeliveryGitBasisV1({ machineHome: input.machineHome, repository: input.target,
        store: input.store, boundary })
    : null;
  const loaded = retained?.loaded ?? await input.owners!.loadRepositoryEpochAtCommit(input.target, basis.productBaseCommit);
  assertEpochBasis(basis, loaded, input.store.identity.targetId);
  const knowledge = assertKnowledgeBasis(
    basis,
    loaded,
    retained === null ? await input.owners!.validateKnowledgeSet(loaded)
      : { knowledgeSet: retained.knowledge, validation: retained.knowledgeValidation },
  );
  const bound = retained?.loaded ?? await input.owners!.bindHistoricalRepositorySnapshot(loaded, knowledge);
  assertSnapshotBasis(basis, loaded, bound);
  const repository = Object.freeze({ ...loaded, snapshot: bound.snapshot });
  return Object.freeze({
    boundaryRole: input.selected.role,
    boundary,
    basis,
    knowledge,
    repository,
  });
}

/**
 * Reopen the immutable repository, Atlas, and Knowledge basis selected by the
 * current proposed Work Boundary, or the active Boundary when no proposal is
 * current. Runtime custody reopens the selected history independently of live
 * canonical HEAD, checkout content, and later canonical garbage collection.
 */
export async function compileFoundationDeliveryQueryBasis(input: Readonly<{
  machineHome: string;
  target: string;
  store: QueryControlStore;
  owners?: FoundationDeliveryQueryBasisOwners;
}>): Promise<FoundationDeliveryQueryBasis> {
  return compileSelectedDeliveryQueryBasis({
    ...input,
    selected: selectedBoundary(input.store),
  });
}

/** Reopen an exact current Boundary, or a provenance-verified retained inspection Boundary. */
export async function compileFoundationDeliveryQueryBasisForBoundaryReference(input: Readonly<{
  machineHome: string;
  target: string;
  store: QueryControlStore;
  boundary: FoundationDeliveryQueryBoundaryReference;
  inspectionSelection?: FoundationContextSelection;
  owners?: FoundationDeliveryQueryBasisOwners;
}>): Promise<FoundationDeliveryQueryBasis> {
  const selected = input.inspectionSelection === undefined
    ? selectedBoundaryReference(input.store, input.boundary)
    : (() => {
        if (!("listEvents" in input.store) || typeof input.store.listEvents !== "function") {
          fail("boundary-substituted", "Historical inspection requires the retained Journal owner");
        }
        resolveFoundationInspectionSelection(input.store as ControlRecordStore, input.inspectionSelection);
        if (canonicalJson(input.boundary) !== canonicalJson(input.inspectionSelection.boundary.reference)) {
          fail("boundary-substituted", "Requested Boundary differs from its historical inspection selection");
        }
        return retainedBoundary(input.store, input.inspectionSelection.boundary);
      })();
  return compileSelectedDeliveryQueryBasis({
    machineHome: input.machineHome,
    target: input.target,
    store: input.store,
    owners: input.owners,
    selected,
  });
}
