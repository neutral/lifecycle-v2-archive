import type { FoundationKnowledgeKind } from "../knowledge/types.js";
import type {
  FoundationCapabilityProfile,
  FoundationCheckBinding,
  FoundationProjectionProfile,
} from "../repository/types.js";
import type { Sha256 } from "../validation/canonical.js";
import type { FoundationValidationResult } from "../validation/result.js";

export const FOUNDATION_PROJECTION_CLASSES = ["orientation", "execution"] as const;
export type FoundationProjectionClass = (typeof FOUNDATION_PROJECTION_CLASSES)[number];

export const FOUNDATION_PROJECTION_ROLES = ["reconnaissance", "builder", "reviewer"] as const;
export type FoundationProjectionRole = (typeof FOUNDATION_PROJECTION_ROLES)[number];

export const FOUNDATION_STANDARD_PROJECTION_PROFILES = [
  "orientation-standard-v1",
  "execution-standard-v1",
  "execution-large-v1",
] as const;
export type FoundationStandardProjectionProfile = (typeof FOUNDATION_STANDARD_PROJECTION_PROFILES)[number];

export type FoundationProjectionCompilerIdentity = Readonly<{
  id: string;
  version: string;
  digest: Sha256;
}>;

export type FoundationProjectionTargetBasis = Readonly<{
  id: string;
  generation: number;
}>;

export type FoundationProjectionAtlasBasis = Readonly<{
  root: string;
  entrypoint: string;
  specificationRevision: string;
  processorRevision: string;
  stateDigest: Sha256;
  resolutionDigest: Sha256;
  normalizedModelDigest: Sha256;
  resourceBindingsDigest: Sha256;
  complete: true;
  valid: true;
}>;

export type FoundationProjectionBoundaryIdentity = Readonly<{
  kind: "work-boundary";
  id: string;
  revision: number;
  digest: Sha256;
}>;

export type FoundationProjectionBoundaryBasis = FoundationProjectionBoundaryIdentity;

/**
 * Public request binding for one exact retained Control revision.
 */
export type FoundationProjectionControlReference<Kind extends string> = Readonly<{
  kind: Kind;
  id: string;
  revision: number;
  digest: Sha256;
}>;

export type FoundationProjectionCandidateBasis = Readonly<{
  baseCommit: string;
  revision: FoundationProjectionControlReference<"candidate-revision">;
  stateDigest: Sha256;
  carrierManifestDigest: Sha256;
  sealedTree: string | null;
  seal: FoundationProjectionControlReference<"candidate-seal"> | null;
}>;

export type FoundationProjectionBasis = Readonly<{
  requestDigest: Sha256;
  target: FoundationProjectionTargetBasis;
  commit: string;
  tree: string;
  objectFormat: "sha1" | "sha256";
  repositoryEpochDigest: Sha256;
  productStateDigest: Sha256;
  repositoryContractDigest: Sha256;
  repositorySnapshotDigest: Sha256 | null;
  repositoryValidationDigest: Sha256 | null;
  atlas: FoundationProjectionAtlasBasis;
  knowledgeObservationDigest: Sha256;
  knowledgeSetDigest: Sha256 | null;
  knowledgeValidationDigest: Sha256;
  workBoundary: FoundationProjectionBoundaryBasis | null;
  candidate: FoundationProjectionCandidateBasis | null;
}>;

export type FoundationProjectionCondition = Readonly<{
  code: string;
  severity: "error" | "warning" | "information";
  detail: string;
  sourceIds: readonly string[];
}>;

export type FoundationOrientationProjectionCore = Readonly<{
  class: "orientation";
  objective: string;
  purpose: string;
  conditions: readonly FoundationProjectionCondition[];
  knowledgeIndex: FoundationProjectionKnowledgeIndex;
  coverageIndex: FoundationProjectionCoverageIndex;
  bindingIndex: FoundationProjectionBindingIndex;
  capabilityIndex: FoundationProjectionCapabilityIndex;
  profileIndex: FoundationProjectionProfileIndex;
  retrievalIndex: FoundationProjectionRetrievalIndex;
  indexDigest: Sha256;
}>;

export type FoundationProjectionKnowledgeIndex = Readonly<{
  records: readonly Readonly<{
    id: string;
    kind: FoundationKnowledgeKind;
    revision: number;
    title: string;
    summary: string;
    owners: readonly string[];
    path: string;
    sourceDigest: Sha256;
    semanticDigest: Sha256;
  }>[];
  relationships: readonly Readonly<{
    sourceId: string;
    type: "refines" | "constrains" | "realizes" | "verified-by" | "depends-on" | "related-to";
    targetId: string;
    required: boolean;
    scope: string | null;
  }>[];
  digest: Sha256;
}>;

export type FoundationProjectionCoverageIndex = Readonly<{
  implementationRoots: readonly string[];
  exemptions: readonly Readonly<{ path: string; reason: string; matched: boolean }>[];
  entries: readonly Readonly<{
    path: string;
    descriptionId: string;
    descriptionRevision: number;
    selectorPath: string;
    selectorMode: "file" | "tree";
  }>[];
  summary: Readonly<{
    governedImplementationItems: number;
    coveredItems: number;
    missingItems: number;
    ambiguousItems: number;
    exemptionItems: number;
  }>;
  digest: Sha256;
}>;

export type FoundationProjectionBindingIndex = Readonly<{
  entries: readonly Readonly<{
    id: string;
    binding: FoundationCheckBinding;
    checkIds: readonly string[];
    evidenceKinds: readonly ("command" | "inspection" | "artifact" | "diff" | "analysis" | "mixed")[];
    capabilityProfileId: string | null;
    digest: Sha256;
  }>[];
  digest: Sha256;
}>;

export type FoundationProjectionCapabilityIndex = Readonly<{
  entries: readonly Readonly<{ id: string; profile: FoundationCapabilityProfile; digest: Sha256 }>[];
  digest: Sha256;
}>;

export type FoundationProjectionProfileIndex = Readonly<{
  entries: readonly FoundationProjectionProfile[];
  digest: Sha256;
}>;

export type FoundationProjectionRetrievalIndex = Readonly<{
  entries: readonly Readonly<{
    handle: string;
    id: string;
    kind: string;
    digest: Sha256;
    byteLength: number;
    availability: "mounted" | "resolver" | "inaccessible";
  }>[];
  digest: Sha256;
}>;

export type FoundationProjectionObligation = Readonly<{
  id: string;
  kind: "behavior" | "assurance" | "blueprint" | "description" | "artifact" | "check" | "effect" | "risk" | "exclusion" | "acceptance";
  statement: string;
  sourceIds: readonly string[];
  requiredEvidenceIds: readonly string[];
}>;

export type FoundationProjectionArtifact = Readonly<{
  id: string;
  path: string;
  role: "code" | "test" | "behavior" | "assurance" | "blueprint" | "description" | "check" | "documentation" | "external-source";
  mustChange: boolean;
}>;

export type FoundationProjectionEffect = Readonly<{
  id: string;
  kind: "local-read" | "local-write" | "network-request" | "external-mutation" | "notification" | "publication" | "spend" | "deployment" | "other";
  summary: string;
  trigger: string;
  target: string;
  reversibility: "read-only" | "reversible" | "compensatable" | "irreversible";
}>;

export type FoundationProjectionRisk = Readonly<{
  id: string;
  statement: string;
  effectIds: readonly string[];
  treatment: "eliminate" | "mitigate" | "accept";
}>;

export type FoundationProjectionCheckSelection = Readonly<{
  id: string;
  checkId: string;
  bindingIds: readonly string[];
  modality: "precondition" | "repair-target" | "regression-guard" | "postcondition" | "diagnostic";
  purpose: string;
}>;

export type FoundationProjectionProposition = Readonly<{
  id: string;
  claim: string;
  evidenceKinds: readonly ("inspection" | "artifact" | "check" | "diff" | "analysis" | "mixed")[];
  evidenceIds: readonly string[];
  obligationIds: readonly string[];
  effectIds: readonly string[];
  riskIds: readonly string[];
  path: string | null;
  checkId: string | null;
  allowNotApplicable: boolean;
  notApplicableCondition: string | null;
}>;

export type FoundationProjectionCapabilityBinding = Readonly<{
  profileId: string;
  profileDigest: Sha256;
}>;

export type FoundationExecutionProjectionCore = Readonly<{
  class: "execution";
  objective: string;
  selectedMeaning: string;
  included: readonly string[];
  excluded: readonly string[];
  assumptions: readonly string[];
  falsifiers: readonly string[];
  obligations: readonly FoundationProjectionObligation[];
  requiredArtifacts: readonly FoundationProjectionArtifact[];
  effects: readonly FoundationProjectionEffect[];
  risks: readonly FoundationProjectionRisk[];
  checks: readonly FoundationProjectionCheckSelection[];
  propositions: readonly FoundationProjectionProposition[];
  capability: FoundationProjectionCapabilityBinding;
  capabilitySummary: string;
  prohibitedEffects: readonly string[];
  materialConditionPolicy: string;
  completionReturnRules: readonly string[];
  requestDigest: Sha256;
  workBoundaryDigest: Sha256;
}>;

/** Exact authenticated citation supplied by the later Work Boundary parser. */
export type FoundationProjectionKnowledgeRoot = Readonly<{
  id: string;
  revision: number;
  sourceDigest: Sha256;
  semanticDigest: Sha256;
  reason: string;
}>;

export type FoundationProjectionSourceRoot =
  | Readonly<{
    owner: "knowledge";
    recordId: string;
    recordRevision: number;
    sourceId: string;
    reference: string;
    revision: string | null;
    digest: Sha256;
    authority: "atlas" | "informational-source" | "repository-reality";
    required: boolean;
    reason: string;
  }>
  | Readonly<{
    owner: "source-anchor";
    sourceId: string;
    reference: string;
    revision: string | null;
    digest: Sha256;
    authority: "atlas" | "informational-source" | "repository-reality";
    required: boolean;
    reason: string;
  }>;

/**
 * The exact, already-authenticated execution data subject consumed here.
 * This is deliberately not a Work Boundary parser or validity claim.
 */
export type FoundationExecutionProjectionSubject = Readonly<{
  workBoundary: FoundationProjectionBoundaryBasis;
  core: FoundationExecutionProjectionCore;
  knowledgeRoots: readonly FoundationProjectionKnowledgeRoot[];
  implementationRoots: readonly Readonly<{ path: string; reason: string }>[];
  sourceRoots: readonly FoundationProjectionSourceRoot[];
  candidate: FoundationProjectionCandidateBasis | null;
  subjectDigest: Sha256;
}>;

export type FoundationProjectionRequestRepositoryBasis = Readonly<{
  commit: string;
  tree: string;
  objectFormat: "sha1" | "sha256";
  repositoryEpochDigest: Sha256;
  productStateDigest: Sha256;
  repositoryContractDigest: Sha256;
  repositorySnapshotDigest: Sha256 | null;
  validationDigest: Sha256 | null;
  complete: boolean | null;
  valid: boolean | null;
}>;

export type FoundationProjectionRequestRetrieval = Readonly<{
  externalLocal: "denied" | "authorized";
  network: "denied" | "authorized";
  authoritySubjectDigest: Sha256 | null;
  sources: readonly Readonly<{ reference: string; revision: string; digest: Sha256 }>[];
}>;

type FoundationProjectionRequestCommon = Readonly<{
  schema: "lifecycle.projection-request.v4";
  specificationRevision: string;
  target: FoundationProjectionTargetBasis;
  repository: FoundationProjectionRequestRepositoryBasis;
  atlas: FoundationProjectionAtlasBasis;
  knowledge: Readonly<{
    knowledgeObservationDigest: Sha256;
    knowledgeSetDigest: Sha256 | null;
    knowledgeValidationDigest: Sha256;
    complete: boolean;
    valid: boolean;
  }>;
  profile: FoundationProjectionProfile;
  features: Readonly<{ historical: boolean; reachable: boolean }>;
  retrieval: FoundationProjectionRequestRetrieval;
  digest: Sha256;
}>;

export type FoundationOrientationProjectionRequest = Readonly<FoundationProjectionRequestCommon & {
  class: "orientation";
  role: "reconnaissance";
  subject: Readonly<{ class: "orientation"; objective: string; objectiveDigest: Sha256 }>;
}>;

export type FoundationExecutionProjectionRequest = Readonly<FoundationProjectionRequestCommon & {
  class: "execution";
  role: "builder" | "reviewer";
  subject: Readonly<{
    class: "execution";
    workBoundary: FoundationProjectionBoundaryIdentity;
    candidate: FoundationProjectionCandidateBasis | null;
  }>;
}>;

export type FoundationProjectionRequest = FoundationOrientationProjectionRequest | FoundationExecutionProjectionRequest;

export type FoundationProjectionPresentationHint = "markdown" | "json" | "source" | "diff" | "plain-text" | "binary";

export type FoundationProjectionContentLocator = Readonly<
  | { mode: "inline"; mediaType: string; encoding: "utf-8"; text: string; byteLength: number; digest: Sha256 }
  | { mode: "mounted"; mediaType: string; encoding: "utf-8" | "binary"; path: string; byteLength: number; digest: Sha256; scope: "projection-bundle"; readOnly: true }
>;

export type FoundationProjectionMandatoryItem = Readonly<{
  id: string;
  itemDigest: Sha256;
  category: "knowledge";
  sourceIdentity: string;
  kind: FoundationKnowledgeKind | "implementation" | "binding" | "source" | null;
  authority: "product-knowledge" | "atlas" | "repository-reality" | "check-binding" | "informational-source";
  locator: string;
  revision: number | string | null;
  sourceDigest: Sha256;
  semanticDigest: Sha256 | null;
  inclusionReasons: readonly string[];
  relationshipPaths: readonly (readonly string[])[];
  content: FoundationProjectionContentLocator;
  presentationHint: FoundationProjectionPresentationHint;
  useLimit: string | null;
}>;

export type FoundationProjectionAtlasItem = Readonly<{
  id: string;
  itemDigest: Sha256;
  unitKind: "atlas" | "map" | "point-anchor" | "point-context" | "resource" | "check" | "publication-profile";
  unitId: string;
  atlasId: string;
  mapId: string | null;
  pointId: string | null;
  recordKind: "anchor" | "context" | null;
  sourcePath: string;
  normalizedDigest: Sha256;
  inclusionReasons: readonly string[];
  presentationHint: FoundationProjectionPresentationHint;
  content: FoundationProjectionContentLocator;
  useLimit: string | null;
}>;

export type FoundationProjectionImplementationItem = Readonly<{
  id: string;
  itemDigest: Sha256;
  path: string;
  artifactKind: "code" | "test" | "configuration" | "documentation" | "other";
  digest: Sha256;
  descriptionIds: readonly string[];
  inclusionReasons: readonly string[];
  presentationHint: FoundationProjectionPresentationHint;
  content: FoundationProjectionContentLocator;
  useLimit: string | null;
}>;

export type FoundationProjectionBindingItem = Readonly<{
  id: string;
  itemDigest: Sha256;
  binding: FoundationCheckBinding;
  checkIds: readonly string[];
  compatibleCheckIds: readonly string[];
  bindingDigest: Sha256;
  evidenceKinds: readonly ("command" | "inspection" | "artifact" | "diff" | "analysis" | "mixed")[];
  inclusionReasons: readonly string[];
  presentationHint: FoundationProjectionPresentationHint;
  content: FoundationProjectionContentLocator;
  useLimit: string | null;
}>;

export type FoundationProjectionSourceItem = Readonly<{
  id: string;
  itemDigest: Sha256;
  reference: string;
  revision: string | null;
  digest: Sha256;
  authority: "atlas" | "informational-source" | "repository-reality" |
    "runtime-authenticated-fact" | "agent-proposed-claim";
  semantic: Readonly<{
    class: "source" | "candidate" | "evidence";
    subjectId: string;
    subjectDigest: Sha256;
    evidenceKind:
      | "check-receipt"
      | "agent-work-product"
      | "evidence-artifact-observation"
      | "evidence-description-coverage"
      | "evidence-receipt-reuse"
      | "evidence-invalidation"
      | null;
  }>;
  inclusionReasons: readonly string[];
  presentationHint: FoundationProjectionPresentationHint;
  content: FoundationProjectionContentLocator;
  useLimit: string | null;
}>;

export type FoundationProjectionReachableItem = Readonly<{
  handle: string;
  id: string;
  category: FoundationProjectionReachableCategory;
  kind: string;
  summary: string;
  sourceRevision: string | null;
  digest: Sha256;
  byteLength: number;
  retrieval: "mounted" | "resolver" | "inaccessible";
  mountedPath: string | null;
}>;

export type FoundationProjectionReachableCategory =
  | "related-knowledge"
  | "atlas-context"
  | "provenance-source"
  | "historical-revision"
  | "neighboring-description"
  | "unaffected-implementation";

export type FoundationProjectionConflict = Readonly<{
  id: string;
  code: string;
  severity: "error" | "warning" | "information";
  recordIds: readonly string[];
  detail: string;
}>;

export type FoundationProjectionUnresolved = Readonly<{
  id: string;
  code: string;
  required: boolean;
  reference: string;
  detail: string;
}>;

export type FoundationProjectionCountPair = Readonly<{ items: number; bytes: number }>;

export type FoundationProjectionOmissionCategory = Readonly<{
  category: FoundationProjectionReachableCategory;
  before: FoundationProjectionCountPair;
  after: FoundationProjectionCountPair;
  omitted: FoundationProjectionCountPair;
  omittedIds: readonly string[];
  enumerationComplete: true;
}>;

export type FoundationProjectionOmission = Readonly<{
  profile: string;
  profileDigest: Sha256;
  bounds: Readonly<Pick<FoundationProjectionProfile,
    "maximumMandatoryItems" | "maximumMandatoryBytes" | "maximumItemBytes" | "maximumReachableItems" | "maximumReachableBytes" | "maximumSourceBytes" | "maximumRelationshipDepth">>;
  eligibleCategories: readonly FoundationProjectionReachableCategory[];
  categories: readonly FoundationProjectionOmissionCategory[];
  policy: "category-code-point-prefix-v1";
  mandatoryOmissions: 0;
}>;

export type FoundationKnowledgeProjection = Readonly<{
  schema: "lifecycle.knowledge-projection.v4";
  projectionId: string;
  class: FoundationProjectionClass;
  role: FoundationProjectionRole;
  profile: FoundationStandardProjectionProfile;
  profileDigest: Sha256;
  compiler: FoundationProjectionCompilerIdentity;
  specificationRevision: string;
  basis: FoundationProjectionBasis;
  core: FoundationOrientationProjectionCore | FoundationExecutionProjectionCore;
  atlas: readonly FoundationProjectionAtlasItem[];
  mandatory: readonly FoundationProjectionMandatoryItem[];
  implementation: readonly FoundationProjectionImplementationItem[];
  bindings: readonly FoundationProjectionBindingItem[];
  sources: readonly FoundationProjectionSourceItem[];
  reachable: readonly FoundationProjectionReachableItem[];
  conflicts: readonly FoundationProjectionConflict[];
  unresolved: readonly FoundationProjectionUnresolved[];
  omission: FoundationProjectionOmission;
  counts: Readonly<{
    coreBytes: number;
    atlas: FoundationProjectionCountPair;
    mandatory: FoundationProjectionCountPair;
    implementation: FoundationProjectionCountPair;
    bindings: FoundationProjectionCountPair;
    sources: FoundationProjectionCountPair;
    reachable: FoundationProjectionCountPair;
    conflicts: number;
    unresolved: number;
    totalBytes: number;
  }>;
  digest: Sha256;
}>;

export type FoundationProjectionByteInventoryEntry = Readonly<{
  tier: "mandatory" | "reachable";
  key: string;
  path: string;
  digest: Sha256;
  byteLength: number;
  encoding: "base64";
  bytes: string;
}>;

export type FoundationProjectionCacheKey = Readonly<{
  specificationRevision: string;
  compilerDigest: Sha256;
  class: FoundationProjectionClass;
  role: FoundationProjectionRole;
  profile: FoundationStandardProjectionProfile;
  basis: FoundationProjectionBasis;
  profileBoundsDigest: Sha256;
  requestSubjectDigest: Sha256;
  retrievalPolicyDigest: Sha256;
  digest: Sha256;
}>;

export type FoundationCompiledProjection = Readonly<{
  manifest: FoundationKnowledgeProjection;
  inventory: readonly FoundationProjectionByteInventoryEntry[];
  cacheKey: FoundationProjectionCacheKey;
}>;

export type FoundationProjectionResult = Readonly<{
  validation: FoundationValidationResult;
  projection: FoundationCompiledProjection | null;
}>;
