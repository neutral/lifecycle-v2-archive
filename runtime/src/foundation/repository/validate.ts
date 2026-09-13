import { valid, validRange } from "semver";
import { RUNTIME_VERSION } from "../../version.js";
import { FOUNDATION_ATLAS_PROCESSOR, FOUNDATION_ATLAS_SELECTION } from "../atlas/selection.js";
import {
  FOUNDATION_INTERFACE_PROTOCOL,
  FOUNDATION_PROVIDER_PROTOCOL,
  FOUNDATION_REPOSITORY_SCHEMA,
  FOUNDATION_REPOSITORY_SCHEMA_VERSION,
  FOUNDATION_RUNTIME_PROTOCOL,
  FOUNDATION_SPECIFICATION_ID,
  FOUNDATION_SPECIFICATION_REVISION,
  FOUNDATION_SPECIFICATION_STATUS,
} from "../constants.js";
import { FoundationError } from "../error.js";
import type { FoundationKnowledgeSet } from "../knowledge/types.js";
import { validateKnowledgeSet } from "../knowledge/knowledge-set.js";
import type { FoundationValidationResult } from "../validation/result.js";
import {
  DiagnosticCollector,
  foundationValidationImplementation,
  validationResultDigest,
} from "../validation/result.js";
import { canonicalJson, digestCanonical, selfDigest, type Sha256 } from "../validation/canonical.js";
import {
  FOUNDATION_GENERATED_PUBLICATION_DIGEST,
  FOUNDATION_GENERATED_SPECIFICATION_REVISION,
} from "../validation/generated-schemas.js";
import { compareCodePoints } from "../validation/ordering.js";
import { assertFoundationSchema } from "../validation/schema-engine.js";
import { assertRepositoryEpochUnmoved, resolveAttachedEpoch } from "./git.js";
import {
  defaultCapabilityProfiles,
  defaultProjectionProfiles,
  installedProviderDescriptors,
  FOUNDATION_REPOSITORY_EXTENSION_SELECTION,
  FOUNDATION_REPOSITORY_PROFILE_SELECTION,
  FOUNDATION_REPOSITORY_SCHEMA_SELECTION,
} from "./contract.js";
import {
  authoritativeWorktreeState,
  bindRepositorySnapshot,
  compiledKnowledgeManifestDigest,
  compiledKnowledgeManifestMatches,
  loadRepositoryEpoch,
} from "./snapshot.js";
import { pathWithin } from "./product-state.js";
import type {
  FoundationAuthoritativeWorktreeState,
  FoundationLoadedRepositorySnapshot,
  FoundationProviderDescriptor,
  FoundationRepositorySnapshotBasis,
} from "./types.js";

const REPOSITORY_PROFILE = "repository-v9" as const;
const STAGES = ["repository-epoch", "repository-contract", "control", "product-state", "atlas", "knowledge", "repository-snapshot"] as const;
const MAXIMUM_DIAGNOSTIC_PATHS = 256;

export type FoundationRepositoryValidationSupport = Readonly<{
  publicationDigest: Sha256;
  runtimeVersion: string;
  providerDescriptors: Readonly<Record<string, FoundationProviderDescriptor>>;
  capabilityProfiles: Readonly<Record<string, Sha256>>;
  projectionProfiles: Readonly<Record<string, Sha256>>;
}>;

export type FoundationRepositoryValidationOptions = Readonly<{
  knowledge: FoundationKnowledgeSet;
  observedAt?: string;
}>;

function profileDigests(values: Readonly<Record<string, Readonly<{ digest: Sha256 }>>>): Readonly<Record<string, Sha256>> {
  return Object.freeze(Object.fromEntries(
    Object.entries(values)
      .sort(([left], [right]) => compareCodePoints(left, right))
      .map(([id, value]) => [id, value.digest]),
  ));
}

/** The exact repository selections implemented by the current foundation build. */
export function currentRepositoryValidationSupport(): FoundationRepositoryValidationSupport {
  return Object.freeze({
    publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
    runtimeVersion: RUNTIME_VERSION,
    providerDescriptors: installedProviderDescriptors(),
    capabilityProfiles: profileDigests(defaultCapabilityProfiles()),
    projectionProfiles: profileDigests(defaultProjectionProfiles()),
  });
}

function add(
  collector: DiagnosticCollector,
  stage: (typeof STAGES)[number],
  code: string,
  message: string,
  facts: Record<string, unknown> = {},
  path: string | null = null,
): void {
  collector.add({ stage, code, message, facts, path });
}

function pathFacts(values: readonly string[]): Readonly<{ count: number; paths: readonly string[]; truncated: boolean }> {
  return Object.freeze({
    count: values.length,
    paths: Object.freeze(values.slice(0, MAXIMUM_DIAGNOSTIC_PATHS)),
    truncated: values.length > MAXIMUM_DIAGNOSTIC_PATHS,
  });
}

function repositorySnapshotSubject(loaded: FoundationLoadedRepositorySnapshot): Record<string, unknown> {
  return {
    targetId: loaded.snapshot.targetId,
    commit: loaded.snapshot.commit,
    tree: loaded.snapshot.tree,
    objectFormat: loaded.snapshot.objectFormat,
    contractDigest: loaded.snapshot.contractDigest,
    productStateDigest: loaded.snapshot.productStateDigest,
    atlasStateDigest: loaded.snapshot.atlasStateDigest,
    atlasResolutionDigest: loaded.snapshot.atlasResolutionDigest,
    atlasNormalizedModelDigest: loaded.snapshot.atlasNormalizedModelDigest,
    atlasResourceBindingsDigest: loaded.snapshot.atlasResourceBindingsDigest,
    knowledgeSetDigest: loaded.snapshot.knowledgeSetDigest,
  };
}

function assertSupportConfiguration(support: FoundationRepositoryValidationSupport): void {
  if ((FOUNDATION_GENERATED_SPECIFICATION_REVISION as string) !== FOUNDATION_SPECIFICATION_REVISION) {
    throw new FoundationError("foundation.repository.support", "Installed schema and runtime specification revisions disagree");
  }
  if (!/^sha256:[a-f0-9]{64}$/u.test(support.publicationDigest)) {
    throw new FoundationError("foundation.repository.support", "Repository validation support requires one publication SHA-256 digest");
  }
  if (valid(support.runtimeVersion) === null) {
    throw new FoundationError("foundation.repository.support", "Repository validation support requires one exact runtime SemVer");
  }
  if (Object.keys(support.providerDescriptors).length === 0) {
    throw new FoundationError("foundation.repository.support", "Repository validation support requires at least one complete Provider Descriptor");
  }
  for (const [id, descriptor] of Object.entries(support.providerDescriptors)) {
    if (
      id !== descriptor.id ||
      descriptor.schema !== "lifecycle.provider-descriptor.v7" ||
      descriptor.adapter.protocol !== FOUNDATION_PROVIDER_PROTOCOL ||
      validRange(descriptor.provider.compatibleVersion) === null ||
      selfDigest(descriptor.adapter, "implementationDigest") !== descriptor.adapter.implementationDigest ||
      selfDigest(descriptor) !== descriptor.digest
    ) {
      throw new FoundationError("foundation.repository.support", `Provider Descriptor support entry ${id || "<empty>"} is invalid`);
    }
    assertFoundationSchema("urn:lifecycle:schema:provider-descriptor:v7", descriptor, `installed-provider:${id}`);
  }
  for (const [kind, values] of [["Capability", support.capabilityProfiles], ["Projection", support.projectionProfiles]] as const) {
    for (const [id, digest] of Object.entries(values)) {
      if (!id || !/^sha256:[a-f0-9]{64}$/u.test(digest)) {
        throw new FoundationError("foundation.repository.support", `${kind} support entry ${id || "<empty>"} is invalid`);
      }
    }
  }
}

function validateContractSelection(
  loaded: FoundationLoadedRepositorySnapshot,
  support: FoundationRepositoryValidationSupport,
  collector: DiagnosticCollector,
): void {
  const contract = loaded.contract;
  const mismatches: Record<string, unknown> = {};
  if (contract.$schema !== FOUNDATION_REPOSITORY_SCHEMA || contract.schemaVersion !== FOUNDATION_REPOSITORY_SCHEMA_VERSION) {
    mismatches.repositorySchema = { actual: contract.$schema, actualVersion: contract.schemaVersion, expected: FOUNDATION_REPOSITORY_SCHEMA, expectedVersion: FOUNDATION_REPOSITORY_SCHEMA_VERSION };
  }
  if (contract.specification.id !== FOUNDATION_SPECIFICATION_ID ||
      contract.specification.revision !== FOUNDATION_SPECIFICATION_REVISION ||
      contract.specification.status !== FOUNDATION_SPECIFICATION_STATUS) {
    mismatches.specification = {
      actualId: contract.specification.id,
      actualRevision: contract.specification.revision,
      actualStatus: contract.specification.status,
      expectedId: FOUNDATION_SPECIFICATION_ID,
      expectedRevision: FOUNDATION_SPECIFICATION_REVISION,
      expectedStatus: FOUNDATION_SPECIFICATION_STATUS,
    };
  }
  if (contract.specification.publicationDigest !== support.publicationDigest) {
    mismatches.publicationDigest = { actual: contract.specification.publicationDigest, expected: support.publicationDigest };
  }
  if (
    contract.runtime.compatible !== FOUNDATION_RUNTIME_PROTOCOL ||
    contract.runtime.interface !== FOUNDATION_INTERFACE_PROTOCOL
  ) {
    mismatches.runtime = {
      actual: contract.runtime,
      expected: {
        compatible: FOUNDATION_RUNTIME_PROTOCOL,
        interface: FOUNDATION_INTERFACE_PROTOCOL,
      },
    };
  }
  const providerDescriptor = support.providerDescriptors[contract.provider.defaultDescriptorId];
  if (
    contract.provider.protocol !== FOUNDATION_PROVIDER_PROTOCOL ||
    contract.defaults.providerDescriptorId !== contract.provider.defaultDescriptorId ||
    providerDescriptor === undefined ||
    providerDescriptor.digest !== contract.provider.defaultDescriptorDigest
  ) {
    mismatches.provider = {
      actual: contract.provider,
      defaultDescriptorId: contract.defaults.providerDescriptorId,
      expectedProtocol: FOUNDATION_PROVIDER_PROTOCOL,
      installedDescriptorDigest: providerDescriptor?.digest ?? null,
    };
  }
  if (
    canonicalJson(contract.selections.schemas) !== canonicalJson(FOUNDATION_REPOSITORY_SCHEMA_SELECTION) ||
    canonicalJson(contract.selections.profiles) !== canonicalJson(FOUNDATION_REPOSITORY_PROFILE_SELECTION) ||
    contract.selections.controlStore !== "lifecycle.control-record-store.v2" ||
    contract.selections.controlLifecycleProfile !== "foundation-delivery-control-lifecycle-v7" ||
    contract.selections.controlRecordRevision !== "lifecycle.control-record-revision.v2" ||
    contract.selections.controlRecordEvent !== "lifecycle.control-record-event.v6" ||
    contract.selections.controlReferencedFile !== "lifecycle.control-record-file.v1" ||
    contract.selections.controlStoreSeal !== "lifecycle.control-record-store-seal.v1" ||
    contract.selections.controlStoreArchive !== "lifecycle.control-record-store-archive.v1" ||
    contract.selections.deliveryReduction !== "lifecycle.delivery-reduction.v5" ||
    contract.selections.candidateRevisionCarrierManifest !== "lifecycle.candidate-revision-carrier-manifest.v1" ||
    contract.selections.executionBackendProfile !== "lifecycle.execution-backend-profile.docker-local.v1" ||
    contract.selections.executionCellRunner !== "lifecycle.execution-cell-runner.v1" ||
    contract.selections.executionSpecification !== "lifecycle.execution-specification.v1" ||
    contract.selections.executionInputSet !== "lifecycle.execution-input-set.v2" ||
    contract.selections.executionImage !== "lifecycle.execution-image.v1" ||
    contract.selections.executionObservation !== "lifecycle.execution-observation.v1" ||
    contract.selections.executionOutputManifest !== "lifecycle.execution-output-manifest.v1" ||
    canonicalJson(contract.selections.extensions) !== canonicalJson(FOUNDATION_REPOSITORY_EXTENSION_SELECTION)
  ) {
    mismatches.selections = {
      actual: contract.selections,
      expected: {
        schemas: FOUNDATION_REPOSITORY_SCHEMA_SELECTION,
        profiles: FOUNDATION_REPOSITORY_PROFILE_SELECTION,
        controlStore: "lifecycle.control-record-store.v2",
        controlLifecycleProfile: "foundation-delivery-control-lifecycle-v7",
        controlRecordRevision: "lifecycle.control-record-revision.v2",
        controlRecordEvent: "lifecycle.control-record-event.v6",
        controlReferencedFile: "lifecycle.control-record-file.v1",
        controlStoreSeal: "lifecycle.control-record-store-seal.v1",
        controlStoreArchive: "lifecycle.control-record-store-archive.v1",
        deliveryReduction: "lifecycle.delivery-reduction.v5",
        candidateRevisionCarrierManifest: "lifecycle.candidate-revision-carrier-manifest.v1",
        executionBackendProfile: "lifecycle.execution-backend-profile.docker-local.v1",
        executionCellRunner: "lifecycle.execution-cell-runner.v1",
        executionSpecification: "lifecycle.execution-specification.v1",
        executionInputSet: "lifecycle.execution-input-set.v2",
        executionImage: "lifecycle.execution-image.v1",
        executionObservation: "lifecycle.execution-observation.v1",
        executionOutputManifest: "lifecycle.execution-output-manifest.v1",
        extensions: FOUNDATION_REPOSITORY_EXTENSION_SELECTION,
      },
    };
  }
  if (contract.sourcePolicy.repository !== "exact-bound-tree" || contract.sourcePolicy.externalLocal !== "denied" || contract.sourcePolicy.network !== "denied") {
    mismatches.sourcePolicy = { actual: contract.sourcePolicy, expected: { repository: "exact-bound-tree", externalLocal: "denied", network: "denied" } };
  }

  const unsupportedCapabilities = Object.values(contract.capabilityProfiles)
    .filter((profile) => support.capabilityProfiles[profile.id] !== profile.digest)
    .map((profile) => ({ id: profile.id, contractDigest: profile.digest, implementationDigest: support.capabilityProfiles[profile.id] ?? null }));
  const unsupportedProjections = Object.values(contract.projectionProfiles)
    .filter((profile) => support.projectionProfiles[profile.id] !== profile.digest)
    .map((profile) => ({ id: profile.id, contractDigest: profile.digest, implementationDigest: support.projectionProfiles[profile.id] ?? null }));
  if (unsupportedCapabilities.length > 0) mismatches.capabilityProfiles = unsupportedCapabilities;
  if (unsupportedProjections.length > 0) mismatches.projectionProfiles = unsupportedProjections;

  if (Object.keys(mismatches).length > 0) {
    add(
      collector,
      "repository-contract",
      "lifecycle.repository.contract-invalid",
      "Repository contract selects a publication, schema, runtime, or profile unsupported by this validator",
      mismatches,
      ".lifecycle/repository.json",
    );
  }
}

function failureCode(error: unknown, fallback: string): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") return error.code;
  return fallback;
}

function validateNoTrackedControl(
  loaded: FoundationLoadedRepositorySnapshot,
  collector: DiagnosticCollector,
): void {
  const paths = loaded.treeEntries
    .filter((entry) => pathWithin(entry.path, "records/control"))
    .map(({ path }) => path)
    .sort(compareCodePoints);
  if (paths.length === 0) return;
  add(
    collector,
    "control",
    "lifecycle.repository.epoch-mixed",
    "Repository v22 forbids repository-visible Delivery Control; Control Record Stores remain off HEAD in runtime custody",
    pathFacts(paths),
  );
}

function validateEpochAndSnapshot(
  loaded: FoundationLoadedRepositorySnapshot,
  worktree: FoundationAuthoritativeWorktreeState,
  collector: DiagnosticCollector,
): void {
  const mismatches: Record<string, unknown> = {};
  if (loaded.epoch.ref !== loaded.contract.canonicalBranch) {
    mismatches.branch = { actual: loaded.epoch.ref, expected: loaded.contract.canonicalBranch };
  }
  if (loaded.snapshot.targetId !== loaded.contract.targetId) mismatches.targetId = { actual: loaded.snapshot.targetId, expected: loaded.contract.targetId };
  if (loaded.snapshot.commit !== loaded.epoch.commit) mismatches.commit = { actual: loaded.snapshot.commit, expected: loaded.epoch.commit };
  if (loaded.snapshot.tree !== loaded.epoch.tree) mismatches.tree = { actual: loaded.snapshot.tree, expected: loaded.epoch.tree };
  if (loaded.snapshot.objectFormat !== loaded.epoch.objectFormat) mismatches.objectFormat = { actual: loaded.snapshot.objectFormat, expected: loaded.epoch.objectFormat };
  if (loaded.snapshot.contractDigest !== loaded.contract.digest) mismatches.contractDigest = { actual: loaded.snapshot.contractDigest, expected: loaded.contract.digest };
  if (loaded.snapshot.digest !== digestCanonical(repositorySnapshotSubject(loaded))) {
    mismatches.snapshotDigest = { actual: loaded.snapshot.digest, expected: digestCanonical(repositorySnapshotSubject(loaded)) };
  }
  if (Object.keys(mismatches).length > 0) {
    add(collector, "repository-epoch", "lifecycle.repository.epoch-mixed", "Repository snapshot does not describe one exact loaded epoch", mismatches);
  }

  if (worktree.modified.length > 0) {
    add(
      collector,
      "repository-epoch",
      "lifecycle.source.unbound",
      "Tracked authoritative worktree bytes differ from the exact canonical repository subject",
      { modified: pathFacts(worktree.modified) },
    );
  }
  if (worktree.untracked.length > 0 || worktree.ignored.length > 0) {
    add(
      collector,
      "repository-epoch",
      "lifecycle.repository.untracked-authority",
      "Untracked or ignored material appears below an authoritative repository root",
      { ignored: pathFacts(worktree.ignored), untracked: pathFacts(worktree.untracked) },
    );
  }
}

function validateProductAndAtlas(loaded: FoundationLoadedRepositorySnapshot, collector: DiagnosticCollector): void {
  const productDigest = digestCanonical(loaded.productState.entries);
  const productPaths = loaded.productState.entries.map((entry) => entry.path);
  const sortedProductPaths = [...productPaths].sort(compareCodePoints);
  const productMismatch = productDigest !== loaded.productState.digest ||
    loaded.snapshot.productStateDigest !== loaded.productState.digest ||
    canonicalJson(productPaths) !== canonicalJson(sortedProductPaths) ||
    new Set(productPaths).size !== productPaths.length;
  if (productMismatch) {
    add(collector, "product-state", "lifecycle.repository.product-state", "Product State entries, order, or digest do not match the loaded repository snapshot", {
      actualDigest: loaded.productState.digest,
      expectedDigest: productDigest,
      snapshotDigest: loaded.snapshot.productStateDigest,
    });
  }

  const atlasDigest = digestCanonical(loaded.atlasState.entries);
  const atlasPaths = loaded.atlasState.entries.map((entry) => entry.path);
  const productAtlasEntries = loaded.productState.entries
    .filter((entry) => entry.role === "atlas")
    .map(({ path, mode, objectId }) => ({ path, mode, objectId }));
  const atlasMismatch = atlasDigest !== loaded.atlasState.digest ||
    loaded.snapshot.atlasStateDigest !== loaded.atlasState.digest ||
    !loaded.atlasState.entries.some((entry) => entry.path === loaded.contract.atlas.entrypoint) ||
    canonicalJson(loaded.atlasState.entries) !== canonicalJson(productAtlasEntries) ||
    canonicalJson(atlasPaths) !== canonicalJson([...atlasPaths].sort(compareCodePoints)) ||
    new Set(atlasPaths).size !== atlasPaths.length;
  if (atlasMismatch) {
    add(collector, "atlas", "lifecycle.atlas.binding-invalid", "Atlas state entries, entrypoint, order, or digest do not match Product State", {
      actualDigest: loaded.atlasState.digest,
      expectedDigest: atlasDigest,
      snapshotDigest: loaded.snapshot.atlasStateDigest,
      entrypoint: loaded.contract.atlas.entrypoint,
    });
  }

  const resolution = loaded.atlas.resolution;
  const validationResult = loaded.atlas.validationResult;
  const model = loaded.atlas.model;
  const atlasResolutionFacts: Record<string, unknown> = {};
  const expectedResolutionDigest = selfDigest(resolution, "digest");
  const expectedResourceBindingsDigest = digestCanonical(resolution.resourceBindings);
  const expectedValidationResultDigest = digestCanonical(validationResult);
  const expectedNormalizedModelDigest = digestCanonical(model);
  if (canonicalJson(loaded.contract.atlas.selection) !== canonicalJson(FOUNDATION_ATLAS_SELECTION)) {
    atlasResolutionFacts.contractSelection = {
      actual: loaded.contract.atlas.selection,
      expected: FOUNDATION_ATLAS_SELECTION,
    };
  }
  if (canonicalJson(resolution.selection) !== canonicalJson(loaded.contract.atlas.selection)) {
    atlasResolutionFacts.resolutionSelection = {
      actual: resolution.selection,
      expected: loaded.contract.atlas.selection,
    };
  }
  if (resolution.atlasStateDigest !== loaded.atlasState.digest) {
    atlasResolutionFacts.atlasStateDigest = {
      actual: resolution.atlasStateDigest,
      expected: loaded.atlasState.digest,
    };
  }
  if (
    loaded.snapshot.atlasResolutionDigest !== resolution.digest ||
    loaded.snapshot.atlasNormalizedModelDigest !== resolution.normalizedModelDigest ||
    loaded.snapshot.atlasResourceBindingsDigest !== resolution.resourceBindingsDigest
  ) {
    atlasResolutionFacts.snapshot = {
      actualResolutionDigest: loaded.snapshot.atlasResolutionDigest,
      actualNormalizedModelDigest: loaded.snapshot.atlasNormalizedModelDigest,
      actualResourceBindingsDigest: loaded.snapshot.atlasResourceBindingsDigest,
      expectedResolutionDigest: resolution.digest,
      expectedNormalizedModelDigest: resolution.normalizedModelDigest,
      expectedResourceBindingsDigest: resolution.resourceBindingsDigest,
    };
  }
  if (resolution.resourceBindingsDigest !== expectedResourceBindingsDigest) {
    atlasResolutionFacts.resourceBindingsDigest = {
      actual: resolution.resourceBindingsDigest,
      expected: expectedResourceBindingsDigest,
    };
  }
  if (resolution.externalValidationResultDigest !== expectedValidationResultDigest) {
    atlasResolutionFacts.externalValidationResultDigest = {
      actual: resolution.externalValidationResultDigest,
      expected: expectedValidationResultDigest,
    };
  }
  if (
    resolution.normalizedModelDigest !== expectedNormalizedModelDigest ||
    validationResult.normalized === undefined ||
    digestCanonical(validationResult.normalized) !== expectedNormalizedModelDigest
  ) {
    atlasResolutionFacts.normalizedModelDigest = {
      actual: resolution.normalizedModelDigest,
      expected: expectedNormalizedModelDigest,
      validationResultNormalizedDigest: validationResult.normalized === undefined
        ? null
        : digestCanonical(validationResult.normalized),
    };
  }
  if (
    resolution.schema !== "lifecycle.atlas-resolution.v2" ||
    !resolution.complete ||
    !resolution.valid ||
    !validationResult.complete ||
    !validationResult.valid ||
    validationResult.profile !== FOUNDATION_ATLAS_SELECTION.validationProfile ||
    validationResult.specificationRevision !== FOUNDATION_ATLAS_SELECTION.specificationRevision ||
    model.format !== FOUNDATION_ATLAS_SELECTION.authoredFormat
  ) {
    atlasResolutionFacts.outcome = {
      resolutionSchema: resolution.schema,
      resolutionComplete: resolution.complete,
      resolutionValid: resolution.valid,
      validationComplete: validationResult.complete,
      validationValid: validationResult.valid,
      validationProfile: validationResult.profile,
      specificationRevision: validationResult.specificationRevision,
      authoredFormat: model.format,
    };
  }
  if (canonicalJson(resolution.processor) !== canonicalJson(FOUNDATION_ATLAS_PROCESSOR)) {
    atlasResolutionFacts.processor = {
      actual: resolution.processor,
      expected: FOUNDATION_ATLAS_PROCESSOR,
    };
  }
  if (resolution.digest !== expectedResolutionDigest) {
    atlasResolutionFacts.resolutionDigest = {
      actual: resolution.digest,
      expected: expectedResolutionDigest,
    };
  }
  try {
    assertFoundationSchema("urn:lifecycle:schema:atlas-resolution:v2", resolution, "Atlas Resolution");
  } catch (error) {
    atlasResolutionFacts.schema = {
      cause: error instanceof Error ? error.message : String(error),
    };
  }
  if (Object.keys(atlasResolutionFacts).length > 0) {
    add(
      collector,
      "atlas",
      "lifecycle.atlas.resolution-invalid",
      "Atlas Resolution, normalized model, processor identity, and repository basis must describe one exact complete valid result",
      atlasResolutionFacts,
    );
  }
}

function validateKnowledgeBasis(
  loaded: FoundationLoadedRepositorySnapshot,
  knowledge: FoundationKnowledgeSet,
  collector: DiagnosticCollector,
): void {
  const validation = knowledge.validation;
  const manifest = knowledge.manifest;
  const facts: Record<string, unknown> = {};
  if (validation.profile !== "knowledge-set-v2") facts.profile = { actual: validation.profile, expected: "knowledge-set-v2" };
  const expectedImplementation = foundationValidationImplementation(
    loaded.contract.selections.profiles,
    loaded.contract.selections.extensions,
  );
  if (canonicalJson(validation.implementation) !== canonicalJson(expectedImplementation)) {
    facts.implementation = {
      actual: validation.implementation,
      expected: expectedImplementation,
    };
  }
  if (
    validation.subject.kind !== "repository-knowledge" ||
    validation.subject.id !== loaded.contract.targetId ||
    validation.subject.revision !== loaded.epoch.commit ||
    validation.subject.locator !== null
  ) {
    facts.subject = {
      actual: validation.subject,
      expected: {
        kind: "repository-knowledge",
        id: loaded.contract.targetId,
        revision: loaded.epoch.commit,
        locator: null,
        digest: manifest.digest,
      },
    };
  }
  if (!validation.complete || !validation.valid) facts.outcome = { complete: validation.complete, valid: validation.valid, validationDigest: validation.digest };
  if (validation.digest !== validationResultDigest(validation)) facts.validationDigest = { actual: validation.digest, expected: validationResultDigest(validation) };
  if (manifest.schema !== "lifecycle.knowledge-set.v2" || manifest.profile !== "knowledge-set-v2") facts.manifestKind = { actualSchema: manifest.schema, actualProfile: manifest.profile };
  if (!manifest.complete || !manifest.valid) facts.manifestOutcome = { complete: manifest.complete, valid: manifest.valid };
  if (!compiledKnowledgeManifestMatches(knowledge)) facts.manifestDigest = { actual: manifest.digest, expected: compiledKnowledgeManifestDigest(knowledge) };
  if (validation.subject.digest !== manifest.digest) facts.subjectDigest = { actual: validation.subject.digest, expected: manifest.digest };
  if (loaded.snapshot.knowledgeSetDigest !== manifest.digest) facts.snapshotDigest = { actual: loaded.snapshot.knowledgeSetDigest, expected: manifest.digest };
  if (validation.publicationDigest !== loaded.contract.specification.publicationDigest) facts.publicationDigest = { actual: validation.publicationDigest, expected: loaded.contract.specification.publicationDigest };
  const expectedRepository: FoundationRepositorySnapshotBasis = {
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
  if (canonicalJson(manifest.repository) !== canonicalJson(expectedRepository)) {
    facts.repositoryBasis = { actual: manifest.repository, expected: expectedRepository };
  }
  if (Object.keys(facts).length > 0) {
    add(collector, "knowledge", "lifecycle.repository.knowledge-invalid", "Repository validation requires one complete valid Knowledge Set bound to the same publication and snapshot", facts);
  }
}

function result(
  collector: DiagnosticCollector,
  options: {
    support: FoundationRepositoryValidationSupport;
    subjectId: string;
    subjectDigest: Sha256 | null;
    subjectRevision: number | null;
    observedAt?: string;
    complete?: boolean;
    stageCompleteness?: Partial<Record<(typeof STAGES)[number], boolean>>;
    counts?: { tree: number; product: number; atlas: number };
  },
): FoundationValidationResult {
  return collector.result({
    profile: REPOSITORY_PROFILE,
    publicationDigest: options.support.publicationDigest,
    subjectKind: "repository",
    subjectId: options.subjectId,
    subjectDigest: options.subjectDigest,
    subjectRevision: options.subjectRevision,
    subjectLocator: null,
    stages: STAGES.map((id) => ({
      id,
      complete: options.stageCompleteness?.[id] ?? options.complete ?? true,
    })),
    limits: {
      maximumTreeEntries: 1_000_000,
      maximumDiagnosticPaths: MAXIMUM_DIAGNOSTIC_PATHS,
      observedTreeEntries: options.counts?.tree ?? 0,
      observedProductStateEntries: options.counts?.product ?? 0,
      observedAtlasStateEntries: options.counts?.atlas ?? 0,
    },
    implementation: foundationValidationImplementation(
      FOUNDATION_REPOSITORY_PROFILE_SELECTION,
      FOUNDATION_REPOSITORY_EXTENSION_SELECTION,
    ),
    observedAt: options.observedAt,
  });
}

async function validateLoadedRepositorySnapshotWithGuard(
  loaded: FoundationLoadedRepositorySnapshot,
  options: FoundationRepositoryValidationOptions,
  attachedEpochGuard: Awaited<ReturnType<typeof resolveAttachedEpoch>>,
): Promise<FoundationValidationResult> {
  const support = currentRepositoryValidationSupport();
  assertSupportConfiguration(support);
  const collector = new DiagnosticCollector();
  validateContractSelection(loaded, support, collector);
  validateNoTrackedControl(loaded, collector);
  validateProductAndAtlas(loaded, collector);
  validateKnowledgeBasis(loaded, options.knowledge, collector);
  let epochComplete = true;
  let epochMovementReported = false;
  let worktree = loaded.worktree;
  const observeEpoch = async (): Promise<void> => {
    try {
      await assertRepositoryEpochUnmoved(loaded.repository, attachedEpochGuard);
    } catch (error) {
      const failure = error instanceof FoundationError ? error : null;
      if (!epochMovementReported) {
        epochMovementReported = true;
        add(collector, "repository-epoch", "lifecycle.repository.epoch-mixed", "Canonical repository epoch moved during repository validation", {
          originalCode: failure?.code ?? "runtime.unexpected",
        });
      }
    }
  };
  await observeEpoch();
  try {
    worktree = await authoritativeWorktreeState(loaded.repository, loaded.contract);
  } catch (error) {
    epochComplete = false;
    const failure = error instanceof FoundationError ? error : null;
    add(collector, "repository-epoch", "lifecycle.repository.inventory", "Authoritative worktree state could not be re-inventoried at repository result emission", {
      originalCode: failure?.code ?? "runtime.unexpected",
    });
  }
  await observeEpoch();
  validateEpochAndSnapshot(loaded, worktree, collector);
  return result(collector, {
    support,
    subjectId: loaded.contract.targetId,
    subjectDigest: loaded.snapshot.digest,
    subjectRevision: loaded.contract.generation,
    observedAt: options.observedAt,
    stageCompleteness: { "repository-epoch": epochComplete },
    counts: { tree: loaded.treeEntries.length, product: loaded.productState.entries.length, atlas: loaded.atlasState.entries.length },
  });
}

/** Validate one exact current attached repository snapshot against its Knowledge basis. */
export async function validateLoadedRepositorySnapshot(
  loaded: FoundationLoadedRepositorySnapshot,
  options: FoundationRepositoryValidationOptions,
): Promise<FoundationValidationResult> {
  return validateLoadedRepositorySnapshotWithGuard(loaded, options, loaded.epoch);
}

/**
 * Validate one immutable historical snapshot while independently guarding the
 * currently attached canonical epoch against movement.
 */
export async function validateLoadedHistoricalRepositorySnapshot(
  loaded: FoundationLoadedRepositorySnapshot,
  options: FoundationRepositoryValidationOptions,
): Promise<FoundationValidationResult> {
  const attachedEpochGuard = await resolveAttachedEpoch(loaded.repository);
  return validateLoadedRepositorySnapshotWithGuard(
    loaded,
    options,
    attachedEpochGuard,
  );
}

function failureStage(code: string): (typeof STAGES)[number] {
  if (code.includes("knowledge")) return "knowledge";
  if (code.includes("atlas")) return "atlas";
  if (code.includes("product-state") || code.includes("path.")) return "product-state";
  if (code.includes("control")) return "control";
  if (code.includes("contract") || code.includes("selection") || code.includes("schema")) return "repository-contract";
  if (code.includes("snapshot")) return "repository-snapshot";
  return "repository-epoch";
}

function incompleteStages(stage: (typeof STAGES)[number]): Partial<Record<(typeof STAGES)[number], boolean>> {
  const failureIndex = STAGES.indexOf(stage);
  return Object.fromEntries(STAGES.map((id, index) => [id, index < failureIndex])) as Partial<Record<(typeof STAGES)[number], boolean>>;
}

function incompleteRepositoryResult(options: {
  collector: DiagnosticCollector;
  stage: (typeof STAGES)[number];
  subjectId: string;
  subjectRevision: number | null;
  observedAt?: string;
  counts?: { tree: number; product: number; atlas: number };
}): FoundationValidationResult {
  const support = currentRepositoryValidationSupport();
  assertSupportConfiguration(support);
  return result(options.collector, {
    support,
    subjectId: options.subjectId,
    subjectDigest: null,
    subjectRevision: options.subjectRevision,
    observedAt: options.observedAt,
    stageCompleteness: incompleteStages(options.stage),
    counts: options.counts,
  });
}

function addTypedFailure(
  collector: DiagnosticCollector,
  error: unknown,
  fallbackStage: (typeof STAGES)[number],
): (typeof STAGES)[number] {
  const code = failureCode(error, "lifecycle.repository.epoch-mixed");
  const stage = code === "lifecycle.repository.epoch-mixed" && !(error instanceof FoundationError)
    ? fallbackStage
    : failureStage(code);
  add(
    collector,
    stage,
    code.startsWith("lifecycle.") ? code : "lifecycle.repository.epoch-mixed",
    error instanceof Error ? error.message : "Repository observation failed before one exact snapshot could be produced",
    { failureCode: code },
  );
  return stage;
}

/** Compose exact loading, Knowledge compilation, snapshot binding, and repository-v9 validation for one path. */
export async function validateRepository(
  path: string,
  options: Readonly<{ observedAt?: string }> = {},
): Promise<FoundationValidationResult> {
  let epoch;
  try {
    epoch = await loadRepositoryEpoch(path);
  } catch (error) {
    const collector = new DiagnosticCollector();
    const stage = addTypedFailure(collector, error, "repository-epoch");
    return incompleteRepositoryResult({
      collector,
      stage,
      subjectId: "unresolved-repository",
      subjectRevision: null,
      observedAt: options.observedAt,
    });
  }

  let knowledgeResult;
  try {
    knowledgeResult = await validateKnowledgeSet(epoch);
  } catch (error) {
    const collector = new DiagnosticCollector();
    const stage = addTypedFailure(collector, error, "knowledge");
    return incompleteRepositoryResult({
      collector,
      stage,
      subjectId: epoch.contract.targetId,
      subjectRevision: epoch.contract.generation,
      observedAt: options.observedAt,
      counts: { tree: epoch.treeEntries.length, product: epoch.productState.entries.length, atlas: epoch.atlasState.entries.length },
    });
  }

  if (knowledgeResult.knowledgeSet === null || !knowledgeResult.validation.complete || !knowledgeResult.validation.valid) {
    const collector = new DiagnosticCollector();
    add(collector, "knowledge", "lifecycle.repository.knowledge-invalid", "Repository snapshot requires one complete valid compiled Knowledge Set", {
      complete: knowledgeResult.validation.complete,
      diagnosticCodes: [...new Set(knowledgeResult.validation.diagnostics.map(({ code }) => code))].sort(compareCodePoints),
      valid: knowledgeResult.validation.valid,
      validationDigest: knowledgeResult.validation.digest,
    });
    return incompleteRepositoryResult({
      collector,
      stage: knowledgeResult.validation.complete ? "repository-snapshot" : "knowledge",
      subjectId: epoch.contract.targetId,
      subjectRevision: epoch.contract.generation,
      observedAt: options.observedAt,
      counts: { tree: epoch.treeEntries.length, product: epoch.productState.entries.length, atlas: epoch.atlasState.entries.length },
    });
  }

  let loaded;
  try {
    loaded = await bindRepositorySnapshot(epoch, knowledgeResult.knowledgeSet);
  } catch (error) {
    const collector = new DiagnosticCollector();
    const stage = addTypedFailure(collector, error, "repository-snapshot");
    return incompleteRepositoryResult({
      collector,
      stage,
      subjectId: epoch.contract.targetId,
      subjectRevision: epoch.contract.generation,
      observedAt: options.observedAt,
      counts: { tree: epoch.treeEntries.length, product: epoch.productState.entries.length, atlas: epoch.atlasState.entries.length },
    });
  }
  return await validateLoadedRepositorySnapshot(loaded, {
    knowledge: knowledgeResult.knowledgeSet,
    observedAt: options.observedAt,
  });
}
