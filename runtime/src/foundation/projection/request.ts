import { FOUNDATION_SPECIFICATION_REVISION } from "../constants.js";
import { FoundationError } from "../error.js";
import { FOUNDATION_ATLAS_SELECTION } from "../atlas/selection.js";
import type { FoundationKnowledgeObservation, FoundationKnowledgeSet } from "../knowledge/types.js";
import type { FoundationLoadedRepositoryEpoch, FoundationLoadedRepositorySnapshot, FoundationProjectionProfile } from "../repository/types.js";
import { compiledKnowledgeManifestMatches } from "../repository/snapshot.js";
import { canonicalJson, digestCanonical, selfDigest, sha256Bytes } from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import type { FoundationValidationResult } from "../validation/result.js";
import { validationResultDigest } from "../validation/result.js";
import { assertFoundationSchema } from "../validation/schema-engine.js";
import {
  array,
  bool,
  enumeration,
  exactKeys,
  gitObject,
  integer,
  nullable,
  object,
  opaqueId,
  sha256,
  text,
} from "../validation/value.js";
import type {
  FoundationExecutionProjectionRequest,
  FoundationExecutionProjectionSubject,
  FoundationOrientationProjectionRequest,
  FoundationProjectionBasis,
  FoundationProjectionCandidateBasis,
  FoundationProjectionControlReference,
  FoundationProjectionRequest,
} from "./types.js";

const REQUEST_KEYS = [
  "schema",
  "class",
  "role",
  "specificationRevision",
  "target",
  "repository",
  "atlas",
  "knowledge",
  "profile",
  "subject",
  "features",
  "retrieval",
  "digest",
] as const;

function profile(value: unknown): FoundationProjectionProfile {
  const source = object(value, "lifecycle.projection.request-invalid", "Projection profile");
  exactKeys(source, ["id", "maximumMandatoryItems", "maximumMandatoryBytes", "maximumItemBytes", "maximumReachableItems", "maximumReachableBytes", "maximumSourceBytes", "maximumRelationshipDepth", "digest"], [], "lifecycle.projection.request-invalid", "Projection profile");
  const result: FoundationProjectionProfile = Object.freeze({
    id: opaqueId(source.id, "Projection profile identity"),
    maximumMandatoryItems: integer(source.maximumMandatoryItems, "Maximum mandatory items", 1, 100_000),
    maximumMandatoryBytes: integer(source.maximumMandatoryBytes, "Maximum mandatory bytes", 1, 256 * 1024 * 1024),
    maximumItemBytes: integer(source.maximumItemBytes, "Maximum item bytes", 1, 256 * 1024 * 1024),
    maximumReachableItems: integer(source.maximumReachableItems, "Maximum reachable items", 0, 1_000_000),
    maximumReachableBytes: integer(source.maximumReachableBytes, "Maximum reachable bytes", 0, 1024 * 1024 * 1024),
    maximumSourceBytes: integer(source.maximumSourceBytes, "Maximum source bytes", 0, 256 * 1024 * 1024),
    maximumRelationshipDepth: integer(source.maximumRelationshipDepth, "Maximum relationship depth", 1, 256),
    digest: sha256(source.digest, "Projection profile digest"),
  });
  if (selfDigest(result as unknown as Record<string, unknown>) !== result.digest) {
    throw new FoundationError("lifecycle.projection.basis-mismatch", "Projection profile digest does not bind its seven exact bounds");
  }
  return result;
}

function controlReference<Kind extends string>(
  value: unknown,
  expectedKind: Kind,
): FoundationProjectionControlReference<Kind> {
  const source = object(value, "lifecycle.projection.request-invalid", "Control reference");
  exactKeys(
    source,
    ["kind", "id", "revision", "digest"],
    [],
    "lifecycle.projection.request-invalid",
    "Control reference",
  );
  const kind = opaqueId(source.kind, "Control reference kind");
  if (kind !== expectedKind) {
    throw new FoundationError(
      "lifecycle.projection.request-invalid",
      `Control reference kind ${kind} does not equal ${expectedKind}`,
    );
  }
  return Object.freeze({
    kind: expectedKind,
    id: opaqueId(source.id, "Control reference identity"),
    revision: integer(source.revision, "Control reference revision", 1),
    digest: sha256(source.digest, "Control reference digest"),
  });
}

function candidate(value: unknown): FoundationProjectionCandidateBasis {
  const source = object(value, "lifecycle.projection.request-invalid", "Candidate basis");
  exactKeys(source, ["baseCommit", "revision", "stateDigest", "carrierManifestDigest", "sealedTree", "seal"], [], "lifecycle.projection.request-invalid", "Candidate basis");
  return Object.freeze({
    baseCommit: gitObject(source.baseCommit, "Candidate base commit"),
    revision: controlReference(source.revision, "candidate-revision"),
    stateDigest: sha256(source.stateDigest, "Candidate state digest"),
    carrierManifestDigest: sha256(source.carrierManifestDigest, "Candidate Carrier manifest digest"),
    sealedTree: nullable(source.sealedTree, (entry) => gitObject(entry, "Candidate sealed tree")),
    seal: nullable(source.seal, (entry) => controlReference(entry, "candidate-seal")),
  });
}

export function parseProjectionRequest(value: unknown): FoundationProjectionRequest {
  assertFoundationSchema("urn:lifecycle:schema:projection-request:v4", value, "projection-request");
  const source = object(value, "lifecycle.projection.request-invalid", "Projection request");
  exactKeys(source, REQUEST_KEYS, [], "lifecycle.projection.request-invalid", "Projection request");
  if (source.schema !== "lifecycle.projection-request.v4") {
    throw new FoundationError("lifecycle.projection.request-invalid", "Projection request schema must be lifecycle.projection-request.v4");
  }
  const requestClass = enumeration(source.class, "Projection class", ["orientation", "execution"] as const);
  const role = enumeration(source.role, "Projection role", ["reconnaissance", "builder", "reviewer"] as const);
  const target = object(source.target, "lifecycle.projection.request-invalid", "Projection target");
  exactKeys(target, ["id", "generation"], [], "lifecycle.projection.request-invalid", "Projection target");
  const repository = object(source.repository, "lifecycle.projection.request-invalid", "Projection repository basis");
  exactKeys(repository, ["commit", "tree", "objectFormat", "repositoryEpochDigest", "productStateDigest", "repositoryContractDigest", "repositorySnapshotDigest", "validationDigest", "complete", "valid"], [], "lifecycle.projection.request-invalid", "Projection repository basis");
  const atlas = object(source.atlas, "lifecycle.projection.request-invalid", "Projection Atlas basis");
  exactKeys(atlas, ["root", "entrypoint", "specificationRevision", "processorRevision", "stateDigest", "resolutionDigest", "normalizedModelDigest", "resourceBindingsDigest", "complete", "valid"], [], "lifecycle.projection.request-invalid", "Projection Atlas basis");
  const knowledge = object(source.knowledge, "lifecycle.projection.request-invalid", "Projection Knowledge basis");
  exactKeys(knowledge, ["knowledgeObservationDigest", "knowledgeSetDigest", "knowledgeValidationDigest", "complete", "valid"], [], "lifecycle.projection.request-invalid", "Projection Knowledge basis");
  const features = object(source.features, "lifecycle.projection.request-invalid", "Projection features");
  exactKeys(features, ["historical", "reachable"], [], "lifecycle.projection.request-invalid", "Projection features");
  const retrieval = object(source.retrieval, "lifecycle.projection.request-invalid", "Projection retrieval policy");
  exactKeys(retrieval, ["externalLocal", "network", "authoritySubjectDigest", "sources"], [], "lifecycle.projection.request-invalid", "Projection retrieval policy");
  const retrievalSources = array(retrieval.sources, "Projection retrieval sources", 0, 2048).map((entry, index) => {
    const source = object(entry, "lifecycle.projection.request-invalid", `Projection retrieval source ${index}`);
    exactKeys(source, ["reference", "revision", "digest"], [], "lifecycle.projection.request-invalid", `Projection retrieval source ${index}`);
    return Object.freeze({
      reference: text(source.reference, `Projection retrieval source ${index} reference`, 8192),
      revision: opaqueId(source.revision, `Projection retrieval source ${index} revision`),
      digest: sha256(source.digest, `Projection retrieval source ${index} digest`),
    });
  });
  for (let index = 1; index < retrievalSources.length; index += 1) {
    const prior = retrievalSources[index - 1]!;
    const current = retrievalSources[index]!;
    if (compareCodePoints(`${prior.reference}\0${prior.revision}\0${prior.digest}`, `${current.reference}\0${current.revision}\0${current.digest}`) >= 0) {
      throw new FoundationError("lifecycle.projection.request-invalid", "Projection retrieval sources must be unique and deterministically ordered");
    }
  }
  const selectedProfile = profile(source.profile);
  const common = {
    schema: "lifecycle.projection-request.v4" as const,
    specificationRevision: opaqueId(source.specificationRevision, "Specification revision"),
    target: Object.freeze({ id: opaqueId(target.id, "Target identity"), generation: integer(target.generation, "Target generation", 1) }),
    repository: Object.freeze({
      commit: gitObject(repository.commit, "Repository commit"),
      tree: gitObject(repository.tree, "Repository tree"),
      objectFormat: enumeration(repository.objectFormat, "Repository object format", ["sha1", "sha256"] as const),
      repositoryEpochDigest: sha256(repository.repositoryEpochDigest, "Repository Epoch digest"),
      productStateDigest: sha256(repository.productStateDigest, "Product State digest"),
      repositoryContractDigest: sha256(repository.repositoryContractDigest, "Repository contract digest"),
      repositorySnapshotDigest: nullable(repository.repositorySnapshotDigest, (entry) => sha256(entry, "Repository Snapshot digest")),
      validationDigest: nullable(repository.validationDigest, (entry) => sha256(entry, "Repository validation digest")),
      complete: nullable(repository.complete, (entry) => bool(entry, "Repository validation completeness")),
      valid: nullable(repository.valid, (entry) => bool(entry, "Repository validation validity")),
    }),
    atlas: Object.freeze({
      root: text(atlas.root, "Atlas root", 4096),
      entrypoint: text(atlas.entrypoint, "Atlas entrypoint", 4096),
      specificationRevision: enumeration(atlas.specificationRevision, "Atlas specification revision", [FOUNDATION_ATLAS_SELECTION.specificationRevision] as const),
      processorRevision: enumeration(atlas.processorRevision, "Atlas processor revision", [FOUNDATION_ATLAS_SELECTION.processorRevision] as const),
      stateDigest: sha256(atlas.stateDigest, "Atlas State digest"),
      resolutionDigest: sha256(atlas.resolutionDigest, "Atlas Resolution digest"),
      normalizedModelDigest: sha256(atlas.normalizedModelDigest, "Atlas normalized-model digest"),
      resourceBindingsDigest: sha256(atlas.resourceBindingsDigest, "Atlas Resource bindings digest"),
      complete: (() => { if (atlas.complete !== true) throw new FoundationError("lifecycle.projection.request-invalid", "Projection requires complete Atlas resolution"); return true as const; })(),
      valid: (() => { if (atlas.valid !== true) throw new FoundationError("lifecycle.projection.request-invalid", "Projection requires valid Atlas resolution"); return true as const; })(),
    }),
    knowledge: Object.freeze({
      knowledgeObservationDigest: sha256(knowledge.knowledgeObservationDigest, "Knowledge observation digest"),
      knowledgeSetDigest: nullable(knowledge.knowledgeSetDigest, (entry) => sha256(entry, "Knowledge Set digest")),
      knowledgeValidationDigest: sha256(knowledge.knowledgeValidationDigest, "Knowledge validation digest"),
      complete: bool(knowledge.complete, "Knowledge validation completeness"),
      valid: bool(knowledge.valid, "Knowledge validation validity"),
    }),
    profile: selectedProfile,
    features: Object.freeze({ historical: bool(features.historical, "Historical feature"), reachable: bool(features.reachable, "Reachable feature") }),
    retrieval: Object.freeze({
      externalLocal: enumeration(retrieval.externalLocal, "External-local retrieval", ["denied", "authorized"] as const),
      network: enumeration(retrieval.network, "Network retrieval", ["denied", "authorized"] as const),
      authoritySubjectDigest: nullable(retrieval.authoritySubjectDigest, (entry) => sha256(entry, "Retrieval authority subject digest")),
      sources: Object.freeze(retrievalSources),
    }),
    digest: sha256(source.digest, "Projection request digest"),
  };
  if (common.repository.objectFormat === "sha1" && (common.repository.commit.length !== 40 || common.repository.tree.length !== 40)) {
    throw new FoundationError("lifecycle.projection.basis-mismatch", "SHA-1 repository bases require 40-character commit and tree identities");
  }
  if (common.repository.objectFormat === "sha256" && (common.repository.commit.length !== 64 || common.repository.tree.length !== 64)) {
    throw new FoundationError("lifecycle.projection.basis-mismatch", "SHA-256 repository bases require 64-character commit and tree identities");
  }
  if (common.retrieval.externalLocal === "denied" && common.retrieval.network === "denied") {
    if (common.retrieval.authoritySubjectDigest !== null || common.retrieval.sources.length > 0) {
      throw new FoundationError("lifecycle.projection.request-invalid", "Denied external retrieval requires null authority and no external source revisions");
    }
  } else if (common.retrieval.authoritySubjectDigest === null) {
    throw new FoundationError("lifecycle.projection.request-invalid", "Authorized external retrieval requires an authority subject digest");
  }

  const subject = object(source.subject, "lifecycle.projection.request-invalid", "Projection subject");
  let result: FoundationProjectionRequest;
  if (requestClass === "orientation") {
    exactKeys(subject, ["class", "objective", "objectiveDigest"], [], "lifecycle.projection.request-invalid", "Orientation subject");
    if (subject.class !== "orientation" || role !== "reconnaissance" || selectedProfile.id !== "orientation-standard-v1") {
      throw new FoundationError("lifecycle.projection.request-invalid", "Orientation requires reconnaissance and orientation-standard-v1");
    }
    if (common.repository.repositorySnapshotDigest !== null || common.repository.validationDigest !== null ||
        common.repository.complete !== null || common.repository.valid !== null) {
      throw new FoundationError("lifecycle.projection.basis-mismatch", "Orientation binds a Repository Epoch and carries no Snapshot or repository-v7 result");
    }
    result = Object.freeze({
      ...common,
      class: "orientation",
      role: "reconnaissance",
      subject: (() => {
        const objective = text(subject.objective, "Founder objective", 16_384);
        const objectiveDigest = sha256(subject.objectiveDigest, "Founder objective digest");
        if (sha256Bytes(Buffer.from(objective, "utf8")) !== objectiveDigest) {
          throw new FoundationError("lifecycle.projection.request-invalid", "Founder objective digest does not bind the exact UTF-8 objective");
        }
        return Object.freeze({ class: "orientation" as const, objective, objectiveDigest });
      })(),
    }) as FoundationOrientationProjectionRequest;
  } else {
    exactKeys(subject, ["class", "workBoundary", "candidate"], [], "lifecycle.projection.request-invalid", "Execution subject");
    const boundary = object(subject.workBoundary, "lifecycle.projection.request-invalid", "Work Boundary basis");
    exactKeys(boundary, ["kind", "id", "revision", "digest"], [], "lifecycle.projection.request-invalid", "Work Boundary basis");
    if (subject.class !== "execution" || role === "reconnaissance" || !["execution-standard-v1", "execution-large-v1"].includes(selectedProfile.id)) {
      throw new FoundationError("lifecycle.projection.request-invalid", "Execution requires an execution role and complete execution profile");
    }
    if (common.repository.repositorySnapshotDigest === null || common.repository.validationDigest === null ||
        common.repository.complete !== true || common.repository.valid !== true ||
        common.knowledge.knowledgeSetDigest === null || !common.knowledge.complete || !common.knowledge.valid) {
      throw new FoundationError("lifecycle.projection.basis-mismatch", "Execution requires a complete valid Snapshot, repository-v7 result, and Knowledge Set");
    }
    const candidateBasis = nullable(subject.candidate, candidate);
    const objectIdentityLength = common.repository.objectFormat === "sha1" ? 40 : 64;
    if (candidateBasis !== null && (candidateBasis.baseCommit.length !== objectIdentityLength ||
        (candidateBasis.sealedTree !== null && candidateBasis.sealedTree.length !== objectIdentityLength))) {
      throw new FoundationError("lifecycle.projection.basis-mismatch", "Candidate Git identities must use the bound repository object format");
    }
    if (role === "builder" && (candidateBasis === null || candidateBasis.sealedTree !== null)) {
      throw new FoundationError("lifecycle.projection.boundary-invalid", "Builder Projection requires one unsealed candidate basis");
    }
    if (role === "reviewer" && candidateBasis?.sealedTree == null) {
      throw new FoundationError("lifecycle.projection.boundary-invalid", "Reviewer Projection requires one sealed candidate tree");
    }
    if (role === "builder" && candidateBasis!.seal !== null) {
      throw new FoundationError("lifecycle.projection.boundary-invalid", "Builder Projection cannot bind a Candidate Seal");
    }
    if (role === "reviewer" && candidateBasis!.seal === null) {
      throw new FoundationError("lifecycle.projection.reviewer-seal", "Reviewer Projection requires the complete Candidate Seal");
    }
    result = Object.freeze({
      ...common,
      class: "execution",
      role,
      subject: Object.freeze({
        class: "execution",
        workBoundary: Object.freeze({
          kind: "work-boundary" as const,
          id: opaqueId(boundary.id, "Work Boundary identity"),
          revision: integer(boundary.revision, "Work Boundary revision", 1),
          digest: sha256(boundary.digest, "Work Boundary digest"),
        }),
        candidate: candidateBasis,
      }),
    }) as FoundationExecutionProjectionRequest;
  }
  if ((common.knowledge.complete && common.knowledge.valid) !== (common.knowledge.knowledgeSetDigest !== null)) {
    throw new FoundationError("lifecycle.projection.knowledge-invalid", "Knowledge Set digest is present exactly when the observation is complete and valid");
  }
  if (common.knowledge.valid && !common.knowledge.complete) {
    throw new FoundationError("lifecycle.projection.knowledge-invalid", "Knowledge validation cannot be valid when it is incomplete");
  }
  if (selfDigest(source) !== result.digest) {
    throw new FoundationError("lifecycle.projection.request-invalid", "Projection request digest does not bind the exact request");
  }
  return result;
}

function invalidValidation(result: FoundationValidationResult, profileId: string, subjectDigest: string): boolean {
  return result.profile !== profileId || !result.complete || !result.valid || result.subject.digest !== subjectDigest || result.digest !== validationResultDigest(result);
}

export function assertExecutionProjectionRequestBasis(options: {
  request: FoundationExecutionProjectionRequest;
  loaded: FoundationLoadedRepositorySnapshot;
  repositoryValidation: FoundationValidationResult;
  knowledge: FoundationKnowledgeSet;
}): void {
  const { request, loaded, repositoryValidation, knowledge } = options;
  const actualRepository = {
    commit: loaded.snapshot.commit,
    tree: loaded.snapshot.tree,
    objectFormat: loaded.snapshot.objectFormat,
    repositoryEpochDigest: projectionRepositoryEpochDigest(loaded),
    productStateDigest: loaded.snapshot.productStateDigest,
    repositoryContractDigest: loaded.snapshot.contractDigest,
    repositorySnapshotDigest: loaded.snapshot.digest,
    validationDigest: repositoryValidation.digest,
    complete: repositoryValidation.complete,
    valid: repositoryValidation.valid,
  };
  const expectedTarget = { id: loaded.contract.targetId, generation: loaded.contract.generation };
  const actualAtlas = {
    root: loaded.contract.atlas.root,
    entrypoint: loaded.contract.atlas.entrypoint,
    specificationRevision: loaded.contract.atlas.selection.specificationRevision,
    processorRevision: loaded.contract.atlas.selection.processorRevision,
    stateDigest: loaded.snapshot.atlasStateDigest,
    resolutionDigest: loaded.snapshot.atlasResolutionDigest,
    normalizedModelDigest: loaded.snapshot.atlasNormalizedModelDigest,
    resourceBindingsDigest: loaded.atlas.resolution.resourceBindingsDigest,
    complete: true as const,
    valid: true as const,
  };
  const actualKnowledge = {
    knowledgeObservationDigest: knowledge.manifest.digest,
    knowledgeSetDigest: knowledge.manifest.digest,
    knowledgeValidationDigest: knowledge.validation.digest,
    complete: knowledge.validation.complete,
    valid: knowledge.validation.valid,
  };
  if (
    request.specificationRevision !== FOUNDATION_SPECIFICATION_REVISION ||
    canonicalJson(request.target) !== canonicalJson(expectedTarget) ||
    canonicalJson(request.repository) !== canonicalJson(actualRepository) ||
    canonicalJson(request.atlas) !== canonicalJson(actualAtlas) ||
    canonicalJson(request.knowledge) !== canonicalJson(actualKnowledge) ||
    request.repository.repositorySnapshotDigest !== loaded.snapshot.digest ||
    knowledge.repository.path !== loaded.repository ||
    knowledge.manifest.repository.targetId !== loaded.snapshot.targetId ||
    knowledge.manifest.repository.contractDigest !== loaded.snapshot.contractDigest ||
    knowledge.manifest.repository.objectFormat !== loaded.snapshot.objectFormat ||
    knowledge.manifest.repository.productStateDigest !== loaded.snapshot.productStateDigest ||
    knowledge.manifest.repository.atlasStateDigest !== loaded.snapshot.atlasStateDigest ||
    knowledge.manifest.repository.atlasResolutionDigest !== loaded.snapshot.atlasResolutionDigest ||
    knowledge.manifest.repository.atlasNormalizedModelDigest !== loaded.snapshot.atlasNormalizedModelDigest ||
    repositoryValidation.schema !== "lifecycle.validation-result.v1" ||
    repositoryValidation.specificationRevision !== FOUNDATION_SPECIFICATION_REVISION ||
    repositoryValidation.publicationDigest !== loaded.contract.specification.publicationDigest ||
    repositoryValidation.subject.kind !== "repository" ||
    repositoryValidation.subject.id !== loaded.contract.targetId ||
    repositoryValidation.subject.revision !== loaded.contract.generation ||
    repositoryValidation.subject.locator !== null ||
    knowledge.validation.schema !== "lifecycle.validation-result.v1" ||
    knowledge.validation.specificationRevision !== FOUNDATION_SPECIFICATION_REVISION ||
    knowledge.validation.publicationDigest !== loaded.contract.specification.publicationDigest ||
    knowledge.validation.subject.kind !== "repository-knowledge" ||
    knowledge.validation.subject.id !== loaded.contract.targetId ||
    knowledge.validation.subject.revision !== knowledge.manifest.repository.commit ||
    knowledge.validation.subject.locator !== null ||
    invalidValidation(repositoryValidation, "repository-v7", loaded.snapshot.digest) ||
    invalidValidation(knowledge.validation, "knowledge-set-v1", knowledge.manifest.digest)
  ) {
    throw new FoundationError("lifecycle.projection.basis-mismatch", "Projection request, Repository Snapshot, and Knowledge Set do not identify one exact validated epoch", {
      observedFacts: {
        actualAtlas,
        actualKnowledge,
        actualRepository,
        expectedTarget,
        requestAtlas: request.atlas,
        requestKnowledge: request.knowledge,
        requestRepository: request.repository,
        requestTarget: request.target,
      },
    });
  }
  const registered = loaded.contract.projectionProfiles[request.profile.id];
  if (registered === undefined || canonicalJson(registered) !== canonicalJson(request.profile)) {
    throw new FoundationError("lifecycle.projection.basis-mismatch", "Projection request does not carry the exact registered profile and seven bounds");
  }
  if (request.retrieval.externalLocal !== loaded.contract.sourcePolicy.externalLocal || request.retrieval.network !== loaded.contract.sourcePolicy.network) {
    throw new FoundationError("lifecycle.projection.external-denied", "Projection request exceeds the repository source policy");
  }
}

export function assertOrientationProjectionRequestBasis(options: {
  request: FoundationOrientationProjectionRequest;
  loaded: FoundationLoadedRepositoryEpoch;
  knowledge: FoundationKnowledgeObservation;
}): void {
  const { request, loaded, knowledge } = options;
  const actualRepository = {
    commit: loaded.epoch.commit,
    tree: loaded.epoch.tree,
    objectFormat: loaded.epoch.objectFormat,
    repositoryEpochDigest: projectionRepositoryEpochDigest(loaded),
    productStateDigest: loaded.productState.digest,
    repositoryContractDigest: loaded.contract.digest,
    repositorySnapshotDigest: null,
    validationDigest: null,
    complete: null,
    valid: null,
  };
  const actualKnowledge = {
    knowledgeObservationDigest: knowledge.manifest.digest,
    knowledgeSetDigest: knowledge.validation.complete && knowledge.validation.valid ? knowledge.manifest.digest : null,
    knowledgeValidationDigest: knowledge.validation.digest,
    complete: knowledge.validation.complete,
    valid: knowledge.validation.valid,
  };
  const actualTarget = { id: loaded.contract.targetId, generation: loaded.contract.generation };
  const actualAtlas = {
    root: loaded.contract.atlas.root,
    entrypoint: loaded.contract.atlas.entrypoint,
    specificationRevision: loaded.contract.atlas.selection.specificationRevision,
    processorRevision: loaded.contract.atlas.selection.processorRevision,
    stateDigest: loaded.atlasState.digest,
    resolutionDigest: loaded.atlas.resolution.digest,
    normalizedModelDigest: loaded.atlas.resolution.normalizedModelDigest,
    resourceBindingsDigest: loaded.atlas.resolution.resourceBindingsDigest,
    complete: true as const,
    valid: true as const,
  };
  if (request.specificationRevision !== FOUNDATION_SPECIFICATION_REVISION ||
      canonicalJson(request.target) !== canonicalJson(actualTarget) ||
      canonicalJson(request.repository) !== canonicalJson(actualRepository) ||
      canonicalJson(request.atlas) !== canonicalJson(actualAtlas) ||
      canonicalJson(request.knowledge) !== canonicalJson(actualKnowledge) ||
      knowledge.repository.path !== loaded.repository ||
      canonicalJson(knowledge.manifest.repository) !== canonicalJson({
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
      }) ||
      knowledge.repository.commit !== loaded.epoch.commit ||
      knowledge.repository.tree !== loaded.epoch.tree ||
      knowledge.repository.objectFormat !== loaded.epoch.objectFormat ||
      knowledge.repository.contract.digest !== loaded.contract.digest ||
      knowledge.repository.productStateDigest !== loaded.productState.digest ||
      knowledge.repository.atlasStateDigest !== loaded.atlasState.digest ||
      knowledge.repository.atlasResolutionDigest !== loaded.atlas.resolution.digest ||
      knowledge.repository.atlasNormalizedModelDigest !== loaded.atlas.resolution.normalizedModelDigest ||
      knowledge.repository.atlasResourceBindingsDigest !== loaded.atlas.resolution.resourceBindingsDigest ||
      knowledge.validation.profile !== "knowledge-set-v1" ||
      knowledge.validation.schema !== "lifecycle.validation-result.v1" ||
      knowledge.validation.specificationRevision !== FOUNDATION_SPECIFICATION_REVISION ||
      knowledge.validation.subject.kind !== "repository-knowledge" ||
      knowledge.validation.subject.id !== loaded.contract.targetId ||
      knowledge.validation.subject.locator !== null ||
      knowledge.validation.subject.digest !== knowledge.manifest.digest ||
      knowledge.validation.subject.revision !== loaded.epoch.commit ||
      knowledge.validation.publicationDigest !== loaded.contract.specification.publicationDigest ||
      !compiledKnowledgeManifestMatches(knowledge) ||
      knowledge.validation.digest !== validationResultDigest(knowledge.validation)) {
    throw new FoundationError("lifecycle.projection.basis-mismatch", "Orientation request does not bind the exact Repository Epoch and partial Knowledge observation");
  }
  const registered = loaded.contract.projectionProfiles[request.profile.id];
  if (registered === undefined || canonicalJson(registered) !== canonicalJson(request.profile)) {
    throw new FoundationError("lifecycle.projection.basis-mismatch", "Orientation request does not carry the exact registered profile and seven bounds");
  }
  if (request.retrieval.externalLocal !== loaded.contract.sourcePolicy.externalLocal || request.retrieval.network !== loaded.contract.sourcePolicy.network) {
    throw new FoundationError("lifecycle.projection.external-denied", "Orientation request exceeds the repository source policy");
  }
}

export function assertExecutionProjectionSubject(
  request: FoundationExecutionProjectionRequest,
  subject: FoundationExecutionProjectionSubject | null,
): asserts subject is FoundationExecutionProjectionSubject {
  if (subject === null ||
      canonicalJson(subject.workBoundary) !== canonicalJson(request.subject.workBoundary) ||
      canonicalJson(subject.candidate) !== canonicalJson(request.subject.candidate) ||
      subject.core.class !== "execution" ||
      subject.core.requestDigest !== request.digest ||
      subject.core.workBoundaryDigest !== subject.workBoundary.digest) {
    throw new FoundationError("lifecycle.projection.boundary-invalid", "Execution Projection requires the exact authenticated data subject for the requested Work Boundary and candidate");
  }
  const { subjectDigest: _digest, ...digestSubject } = subject;
  if (digestCanonical(digestSubject) !== subject.subjectDigest) {
    throw new FoundationError("lifecycle.projection.boundary-invalid", "Execution data subject digest does not bind its exact published carriers and roots");
  }
}

export function projectionBasis(request: FoundationProjectionRequest): FoundationProjectionBasis {
  const workBoundary = request.class === "execution" ? request.subject.workBoundary : null;
  const candidateBasis = request.class === "execution" ? request.subject.candidate : null;
  return Object.freeze({
    requestDigest: request.digest,
    target: request.target,
    commit: request.repository.commit,
    tree: request.repository.tree,
    objectFormat: request.repository.objectFormat,
    repositoryEpochDigest: request.repository.repositoryEpochDigest,
    productStateDigest: request.repository.productStateDigest,
    repositoryContractDigest: request.repository.repositoryContractDigest,
    repositorySnapshotDigest: request.repository.repositorySnapshotDigest,
    repositoryValidationDigest: request.repository.validationDigest,
    atlas: request.atlas,
    knowledgeObservationDigest: request.knowledge.knowledgeObservationDigest,
    knowledgeSetDigest: request.knowledge.knowledgeSetDigest,
    knowledgeValidationDigest: request.knowledge.knowledgeValidationDigest,
    workBoundary,
    candidate: candidateBasis,
  });
}

export function projectionRepositoryEpochDigest(loaded: FoundationLoadedRepositoryEpoch): ReturnType<typeof digestCanonical> {
  return digestCanonical({
    targetId: loaded.contract.targetId,
    commit: loaded.epoch.commit,
    tree: loaded.epoch.tree,
    objectFormat: loaded.epoch.objectFormat,
    contractDigest: loaded.contract.digest,
    productStateDigest: loaded.productState.digest,
    atlasStateDigest: loaded.atlasState.digest,
  });
}
