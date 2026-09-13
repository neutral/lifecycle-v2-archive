import { openFoundationDeliveryGitSnapshotV1 } from "../repository/delivery-git-basis.js";
import type { ControlRecordStoreIdentity } from "../control/types.js";
import type { FoundationPreparationBasisBindingV7 } from "./preparation-basis-v7.js";
import type {
  ProviderInputV4,
  ProviderInputV4Capability,
} from "../attempt/provider-input-v4.js";
import {
  compileProviderInputV4,
  verifyProviderInputV4,
} from "../attempt/provider-input-v4.js";
import { normalizeSemanticMarkdown } from "../control/model.js";
import type { ControlJsonObject } from "../control/types.js";
import { FoundationError } from "../error.js";
import { validateKnowledgeSet } from "../knowledge/knowledge-set.js";
import type {
  FoundationKnowledgeSet,
  FoundationKnowledgeSetResult,
} from "../knowledge/types.js";
import { compileKnowledgeProjection } from "../projection/compiler.js";
import { foundationMandatoryProjectionRefusalV1 } from "../projection/mandatory-refusal.js";
import { projectionRepositoryEpochDigest } from "../projection/request.js";
import type {
  FoundationCompiledProjection,
  FoundationOrientationProjectionRequest,
} from "../projection/types.js";
import {
  bindRepositorySnapshot,
  loadRepositoryEpoch,
} from "../repository/snapshot.js";
import type {
  FoundationLoadedRepositoryEpoch,
  FoundationLoadedRepositorySnapshot,
} from "../repository/types.js";
import { validateLoadedRepositorySnapshot } from "../repository/validate.js";
import {
  digestCanonical,
  sha256Bytes,
  type Sha256,
} from "../validation/canonical.js";
import type { FoundationValidationResult } from "../validation/result.js";
import {
  compileFoundationOrientationProjectionRequestV7,
  FOUNDATION_AGENT_ROOT_TOKEN_SET_DIGEST_V3,
} from "./operation-context-v7.js";

type PreparationContextOwnersV7 = Readonly<{
  openSnapshot: typeof openFoundationDeliveryGitSnapshotV1;
  loadRepositoryEpoch: typeof loadRepositoryEpoch;
  validateKnowledgeSet: typeof validateKnowledgeSet;
  compileKnowledgeProjection: typeof compileKnowledgeProjection;
  bindRepositorySnapshot: typeof bindRepositorySnapshot;
  validateLoadedRepositorySnapshot: typeof validateLoadedRepositorySnapshot;
}>;

export type FoundationPreparationContextV7Options = Partial<PreparationContextOwnersV7>;

/**
 * Exact repository and provider-input basis sampled before a Delivery Store is
 * created. The caller may refuse preparation without leaving a created-only
 * Store, then pass this same immutable value into the fresh execution owner.
 */
export type FoundationPreparationBasisV7 = Readonly<{
  semanticMarkdown: string;
  epoch: FoundationLoadedRepositoryEpoch;
  snapshot: FoundationLoadedRepositorySnapshot;
  repositoryValidation: FoundationValidationResult;
  knowledge: FoundationKnowledgeSet;
  request: FoundationOrientationProjectionRequest;
  projection: FoundationCompiledProjection;
  roleSubject: ControlJsonObject;
  capabilityProfile: Readonly<{ id: string; digest: Sha256 }>;
  providerCapability: ProviderInputV4Capability;
  providerInput: ProviderInputV4;
  digest: Sha256;
}>;

export type FoundationPreparationBasisV7Input = Readonly<{
  target: string;
  semanticMarkdown: string;
  observedAt?: string;
}>;

function fail(
  code: string,
  message: string,
  observedFacts: Readonly<Record<string, unknown>> = {},
): never {
  throw new FoundationError(`lifecycle.preparation-context-v7.${code}`, message, {
    observedFacts,
  });
}

function owners(options: FoundationPreparationContextV7Options): PreparationContextOwnersV7 {
  return Object.freeze({
    openSnapshot: options.openSnapshot ?? openFoundationDeliveryGitSnapshotV1,
    loadRepositoryEpoch: options.loadRepositoryEpoch ?? loadRepositoryEpoch,
    validateKnowledgeSet: options.validateKnowledgeSet ?? validateKnowledgeSet,
    compileKnowledgeProjection: options.compileKnowledgeProjection ?? compileKnowledgeProjection,
    bindRepositorySnapshot: options.bindRepositorySnapshot ?? bindRepositorySnapshot,
    validateLoadedRepositorySnapshot:
      options.validateLoadedRepositorySnapshot ?? validateLoadedRepositorySnapshot,
  });
}

function preparationCapability(epoch: FoundationLoadedRepositoryEpoch): Readonly<{
  profile: Readonly<{ id: string; digest: Sha256 }>;
  materialized: ProviderInputV4Capability;
}> {
  const profile = epoch.contract.capabilityProfiles[epoch.contract.defaults.capabilityProfileId];
  if (profile === undefined) {
    fail("capability", "Default Capability Profile is unavailable");
  }
  if (profile.network.mode === "bounded-egress") {
    fail(
      "capability",
      "The selected Foundation Docker execution profile does not support Agent product egress",
    );
  }
  return Object.freeze({
    profile: Object.freeze({ id: profile.id, digest: profile.digest }),
    materialized: Object.freeze({
      candidateWrites: false,
      temporaryWrites: profile.temporaryWrites,
      subprocesses: profile.subprocesses,
      network: profile.network.mode,
      credentials: profile.credentials,
      // Preparation preserves the repository-selected external-effects set.
      // The provider host remains responsible for enforcing that exact set.
      externalEffects: Object.freeze([...profile.externalEffects]),
    }),
  });
}

function preparationRoleSubject(input: Readonly<{
  semanticMarkdown: string;
  epoch: FoundationLoadedRepositoryEpoch;
  knowledge: FoundationKnowledgeSet;
}>): ControlJsonObject {
  return Object.freeze({
    schema: "lifecycle.orientation-role-subject.v3",
    objectiveDigest: sha256Bytes(input.semanticMarkdown),
    repositoryEpochDigest: projectionRepositoryEpochDigest(input.epoch),
    atlasStateDigest: input.epoch.atlasState.digest,
    atlasResolutionDigest: input.epoch.atlas.resolution.digest,
    atlasNormalizedModelDigest: input.epoch.atlas.resolution.normalizedModelDigest,
    atlasResourceBindingsDigest: input.epoch.atlas.resolution.resourceBindingsDigest,
    knowledgeObservationDigest: input.knowledge.manifest.digest,
  });
}

function basisDigest(input: Omit<FoundationPreparationBasisV7, "digest">): Sha256 {
  return digestCanonical(Object.freeze({
    schema: "lifecycle.preparation-basis.v1",
    targetId: input.epoch.contract.targetId,
    repositoryEpochDigest: projectionRepositoryEpochDigest(input.epoch),
    snapshotDigest: input.snapshot.snapshot.digest,
    repositoryValidationDigest: input.repositoryValidation.digest,
    knowledgeSetDigest: input.knowledge.manifest.digest,
    requestDigest: input.request.digest,
    projectionDigest: input.projection.manifest.digest,
    semanticMarkdownDigest: sha256Bytes(input.semanticMarkdown),
    roleSubjectDigest: digestCanonical(input.roleSubject),
    capabilityProfile: input.capabilityProfile,
    capabilityDigest: digestCanonical(input.providerCapability),
    providerInputManifestDigest: input.providerInput.manifestDigest,
    providerInputBundleDigest: input.providerInput.bundleDigest,
  }));
}

function assertKnowledgeUsable(result: FoundationKnowledgeSetResult): FoundationKnowledgeSet {
  if (
    result.knowledgeSet === null ||
    !result.validation.complete ||
    !result.validation.valid ||
    !result.observation.manifest.complete ||
    !result.observation.manifest.valid
  ) {
    fail("knowledge", "Preparation requires one complete valid Knowledge Set", {
      validationDigest: result.validation.digest,
      diagnostics: result.validation.diagnostics.map(({ code }) => code),
    });
  }
  return result.knowledgeSet;
}

/**
 * Observe and validate the complete preparation basis before Store creation.
 * This function performs no Control mutation and retains no recovery support.
 */
export async function preflightFoundationPreparationBasisV7(
  input: FoundationPreparationBasisV7Input,
  options: FoundationPreparationContextV7Options = {},
): Promise<FoundationPreparationBasisV7> {
  const selected = owners(options);
  const semanticMarkdown = normalizeSemanticMarkdown(input.semanticMarkdown);
  const epoch = await selected.loadRepositoryEpoch(input.target);
  const knowledgeResult = await selected.validateKnowledgeSet(epoch);
  const request = compileFoundationOrientationProjectionRequestV7({
    epoch,
    knowledge: knowledgeResult,
    semanticMarkdown,
  });
  const compiled = await selected.compileKnowledgeProjection(Object.freeze({
    request,
    repository: epoch,
    knowledge: knowledgeResult,
    ...(input.observedAt === undefined ? {} : { observedAt: input.observedAt }),
  }));
  if (
    compiled.projection === null ||
    !compiled.validation.complete ||
    !compiled.validation.valid
  ) {
    const mandatoryRefusal = foundationMandatoryProjectionRefusalV1(compiled);
    if (mandatoryRefusal !== null) throw mandatoryRefusal.error;
    fail("projection", "Orientation Projection did not compile completely and validly", {
      validationDigest: compiled.validation.digest,
      diagnostics: compiled.validation.diagnostics.map(({ code }) => code),
    });
  }
  const knowledge = assertKnowledgeUsable(knowledgeResult);
  const snapshot = await selected.bindRepositorySnapshot(epoch, knowledge);
  const repositoryValidation = await selected.validateLoadedRepositorySnapshot(snapshot, {
    knowledge,
  });
  if (!repositoryValidation.complete || !repositoryValidation.valid) {
    fail("repository", "Preparation requires one complete valid repository Snapshot", {
      validationDigest: repositoryValidation.digest,
      diagnostics: repositoryValidation.diagnostics.map(({ code }) => code),
    });
  }

  const roleSubject = preparationRoleSubject({ semanticMarkdown, epoch, knowledge });
  const capability = preparationCapability(epoch);
  const providerInput = compileProviderInputV4({
    projection: compiled.projection,
    operation: "delivery.prepare",
    roleSubjectDigest: digestCanonical(roleSubject),
    rootTokenSetDigest: FOUNDATION_AGENT_ROOT_TOKEN_SET_DIGEST_V3,
    capability: capability.materialized,
    directorSemanticMarkdown: semanticMarkdown,
  });
  const value = Object.freeze({
    semanticMarkdown,
    epoch,
    snapshot,
    repositoryValidation,
    knowledge,
    request,
    projection: compiled.projection,
    roleSubject,
    capabilityProfile: capability.profile,
    providerCapability: capability.materialized,
    providerInput,
  });
  return Object.freeze({ ...value, digest: basisDigest(value) });
}

/** Retain or reopen the exact initial basis without consulting live canonical state. */
export async function reopenFoundationPreparationBasisV7(
  input: Readonly<{
    target: string;
    machineHome: string;
    identity: Pick<ControlRecordStoreIdentity, "targetId" | "storeId" | "processId">;
    binding: FoundationPreparationBasisBindingV7;
    semanticMarkdown: string;
    observedAt?: string;
  }>,
  options: FoundationPreparationContextV7Options = {},
): Promise<FoundationPreparationBasisV7> {
  const selected = owners(options);
  const retained = await selected.openSnapshot({
    machineHome: input.machineHome,
    repository: input.target,
    identity: input.identity,
    snapshot: input.binding.snapshot,
  });
  const { snapshot: _snapshot, ...epoch } = retained.loaded;
  const basis = await preflightFoundationPreparationBasisV7({
    target: retained.repository,
    semanticMarkdown: input.semanticMarkdown,
    ...(input.observedAt === undefined ? {} : { observedAt: input.observedAt }),
  }, {
    ...options,
    loadRepositoryEpoch: async () => Object.freeze(epoch),
    validateKnowledgeSet: async () => Object.freeze({
      knowledgeSet: retained.knowledge,
      observation: retained.knowledge,
      validation: retained.knowledgeValidation,
    }),
  });
  if (basis.digest !== input.binding.basisDigest ||
      basis.snapshot.snapshot.digest !== input.binding.snapshot.digest ||
      basis.epoch.contract.targetId !== input.identity.targetId) {
    fail("basis", "Reopened preparation context differs from its exact retained basis");
  }
  return basis;
}

/** Verify that a supplied preflight value still reproduces every exact binding. */
export function assertFoundationPreparationBasisV7(
  basis: FoundationPreparationBasisV7,
): void {
  const semanticMarkdown = normalizeSemanticMarkdown(basis.semanticMarkdown);
  const roleSubject = preparationRoleSubject({
    semanticMarkdown,
    epoch: basis.epoch,
    knowledge: basis.knowledge,
  });
  const capability = preparationCapability(basis.epoch);
  if (
    semanticMarkdown !== basis.semanticMarkdown ||
    basis.snapshot.repository !== basis.epoch.repository ||
    basis.snapshot.contract.digest !== basis.epoch.contract.digest ||
    basis.snapshot.epoch.ref !== basis.epoch.epoch.ref ||
    basis.snapshot.epoch.commit !== basis.epoch.epoch.commit ||
    basis.snapshot.epoch.tree !== basis.epoch.epoch.tree ||
    basis.snapshot.epoch.objectFormat !== basis.epoch.epoch.objectFormat ||
    basis.snapshot.snapshot.knowledgeSetDigest !== basis.knowledge.manifest.digest ||
    !basis.repositoryValidation.complete ||
    !basis.repositoryValidation.valid ||
    basis.request.class !== "orientation" ||
    basis.request.role !== "reconnaissance" ||
    basis.request.subject.objective !== semanticMarkdown ||
    basis.request.subject.objectiveDigest !== sha256Bytes(semanticMarkdown) ||
    basis.request.repository.repositoryEpochDigest !== projectionRepositoryEpochDigest(basis.epoch) ||
    basis.request.knowledge.knowledgeObservationDigest !== basis.knowledge.manifest.digest ||
    basis.projection.manifest.class !== "orientation" ||
    basis.projection.manifest.role !== "reconnaissance" ||
    basis.projection.manifest.basis.requestDigest !== basis.request.digest ||
    digestCanonical(roleSubject) !== digestCanonical(basis.roleSubject) ||
    capability.profile.id !== basis.capabilityProfile.id ||
    capability.profile.digest !== basis.capabilityProfile.digest ||
    digestCanonical(capability.materialized) !== digestCanonical(basis.providerCapability) ||
    basis.providerInput.operation !== "delivery.prepare" ||
    basis.providerInput.projectionDigest !== basis.projection.manifest.digest ||
    basis.providerInput.roleSubjectDigest !== digestCanonical(basis.roleSubject) ||
    basis.providerInput.rootTokenSetDigest !== FOUNDATION_AGENT_ROOT_TOKEN_SET_DIGEST_V3 ||
    basis.providerInput.directorDirection.markdown !== semanticMarkdown ||
    basis.digest !== basisDigest(basis)
  ) {
    fail("basis", "Preparation basis no longer reproduces its exact preflight bindings");
  }
  verifyProviderInputV4(basis.providerInput, basis.projection);
}
