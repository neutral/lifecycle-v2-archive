import type { Sha256 } from "../validation/canonical.js";
import type {
  FoundationCheckBinding,
  FoundationCheckSubjectSelector,
  FoundationRepositoryContract,
  FoundationRepositorySnapshotBasis,
} from "../repository/types.js";
import type { FoundationValidationResult } from "../validation/result.js";

export const FOUNDATION_KNOWLEDGE_KINDS = ["behavior", "assurance", "blueprint", "description", "check", "discipline"] as const;
export type FoundationKnowledgeKind = (typeof FOUNDATION_KNOWLEDGE_KINDS)[number];
export type FoundationKnowledgeStatus = "draft" | "current" | "superseded" | "retired";
export type FoundationRelationshipType = "refines" | "constrains" | "realizes" | "verified-by" | "depends-on" | "related-to";
export type FoundationEvidenceKind = "command" | "inspection" | "artifact" | "diff" | "analysis" | "mixed";

export type FoundationKnowledgeStructuralLimits = Readonly<{
  maximumFileBytes: number;
  maximumFrontMatterBytes: number;
  maximumJsonDepth: number;
  maximumJsonNodes: number;
  maximumObjectProperties: number;
  maximumArrayItems: number;
  maximumBodyLines: number;
  maximumHeadings: number;
  maximumHeadingBytes: number;
  maximumPathBytes: number;
}>;

export type FoundationSourceBinding = Readonly<{
  id: string;
  required: boolean;
  reference: string;
  revision: string | null;
  digest: Sha256 | null;
  role: "decision" | "research" | "policy" | "incident" | "atlas-context" | "external-standard" | "repository-reality" | "other";
}>;

export type FoundationDeclaredConflict = Readonly<{
  type: "assurance-limit" | "blueprint-constraint";
  target: string;
  localFact: string;
  targetFact: string;
}>;

/** One exact revision of an enduring Knowledge identity. */
export type FoundationKnowledgeRevisionIdentity = Readonly<{
  id: string;
  revision: number;
  sourceDigest: Sha256;
  semanticDigest: Sha256;
}>;

export type FoundationSupersession = FoundationKnowledgeRevisionIdentity;

/** The same exact revision can occur in each independently identified review basis. */
export type FoundationKnowledgeOccurrence = FoundationKnowledgeRevisionIdentity & Readonly<{
  basis: "base" | "integration-parent" | "candidate";
}>;

export type FoundationRelationship = Readonly<{
  type: FoundationRelationshipType;
  target: string;
  required: boolean;
  scope: string | null;
  rationale: string | null;
  extensions: Readonly<Record<string, unknown>>;
  canonicalValue: Readonly<Record<string, unknown>>;
}>;

export type FoundationBehaviorSpec = Readonly<{
  outcome: string;
  actors: readonly string[];
  conditions: readonly string[];
  included: readonly string[];
  excluded: readonly string[];
  examples: readonly string[];
  falsifiers: readonly string[];
}>;

export type FoundationAssuranceSpec = Readonly<{
  obligation: string;
  scope: readonly string[];
  failureModes: readonly string[];
  limits: readonly string[];
  degradation: readonly string[];
  falsifiers: readonly string[];
}>;

export type FoundationBlueprintSpec = Readonly<{
  decision: string;
  scope: readonly string[];
  components: readonly string[];
  constraints: readonly string[];
  interfaces: readonly string[];
  dataFlows: readonly string[];
  tradeoffs: readonly string[];
  evolution: readonly string[];
}>;

export type FoundationCoverageSelector = Readonly<{
  path: string;
  mode: "file" | "tree";
  role: "primary";
  exclude: readonly string[];
}>;

export type FoundationDescriptionSpec = Readonly<{
  responsibility: string;
  coverage: readonly FoundationCoverageSelector[];
  behavior: readonly string[];
  boundaries: readonly string[];
  invariants: readonly string[];
  dependencies: readonly string[];
  failure: readonly string[];
  rationale: readonly string[];
}>;

export type FoundationCheckSubject = FoundationCheckSubjectSelector;

export type FoundationCheckSpec = Readonly<{
  proposition: string;
  subjects: readonly FoundationCheckSubject[];
  evidenceKinds: readonly FoundationEvidenceKind[];
  requiredBindings: readonly string[];
  evaluation: Readonly<{
    pass: string;
    fail: string;
    indeterminate: string;
    notRun: string;
  }>;
  limits: readonly string[];
  freshness: Readonly<{
    subjectBinding: "exact";
    maximumAgeMs: number | null;
    environmentBinding: "exact" | "class" | "declared" | "none";
  }>;
  falsifiers: readonly string[];
}>;

export type FoundationDisciplineSpec = Readonly<{
  practice: string;
  appliesWhen: readonly string[];
  doesNotApplyWhen: readonly string[];
  guidance: readonly string[];
  verification: readonly string[];
}>;

export type FoundationKnowledgeSpec =
  | FoundationBehaviorSpec
  | FoundationAssuranceSpec
  | FoundationBlueprintSpec
  | FoundationDescriptionSpec
  | FoundationCheckSpec
  | FoundationDisciplineSpec;

export type FoundationKnowledgeFrontMatter = Readonly<{
  schema: "lifecycle.knowledge-record.v2";
  kind: FoundationKnowledgeKind;
  id: string;
  title: string;
  status: FoundationKnowledgeStatus;
  revision: number;
  supersedes: FoundationSupersession | null;
  summary: string;
  owners: readonly string[];
  sources: readonly FoundationSourceBinding[];
  relationships: readonly FoundationRelationship[];
  conflicts: readonly FoundationDeclaredConflict[];
  tags: readonly string[];
  spec: FoundationKnowledgeSpec;
  extensions: Readonly<Record<string, unknown>>;
  canonicalValue: Readonly<Record<string, unknown>>;
}>;

export type FoundationDisciplinePackRegistration = Readonly<{
  id: string;
  publisher: string;
  version: string;
  source: string;
  revision: string;
  manifestDigest: Sha256;
}>;

export type FoundationDisciplineAdoption = Readonly<{
  id: string;
  revision: number;
  path: string;
  sourceDigest: Sha256;
  semanticDigest: Sha256;
  packId: string;
}>;

export type FoundationDisciplineWorkType = Readonly<{
  id: string;
  title: string;
  description: string;
  disciplineIds: readonly string[];
}>;

export type FoundationDisciplineRegistry = Readonly<{
  schema: "lifecycle.discipline-registry.v1";
  packs: readonly FoundationDisciplinePackRegistration[];
  adoptions: readonly FoundationDisciplineAdoption[];
  workTypes: readonly FoundationDisciplineWorkType[];
  digest: Sha256;
}>;

export type FoundationMarkdownHeading = Readonly<{
  level: 1 | 2;
  text: string;
  line: number;
}>;

export type FoundationKnowledgeRecord = Readonly<{
  path: string;
  mode: "100644";
  objectId: string;
  sourceText: string;
  body: string;
  bodyNormalized: string;
  headings: readonly FoundationMarkdownHeading[];
  frontMatter: FoundationKnowledgeFrontMatter;
  sourceDigest: Sha256;
  semanticDigest: Sha256;
}>;

export type FoundationRelationshipEdge = Readonly<{
  source: string;
  sourceRevision: number;
  sourcePath: string;
  sourceSemanticDigest: Sha256;
  type: FoundationRelationshipType;
  target: string;
  targetRevision: number | null;
  targetStatus: FoundationKnowledgeStatus | null;
  targetSemanticDigest: Sha256 | null;
  required: boolean;
  scope: string | null;
  digest: Sha256;
}>;

export type FoundationKnowledgeSourceResolution = Readonly<{
  recordId: string;
  recordRevision: number;
  sourceId: string;
  required: boolean;
  reference: string;
  role: FoundationSourceBinding["role"];
  kind: "repository" | "atlas" | "external";
  locator: string | null;
  declaredRevision: string | null;
  declaredDigest: Sha256 | null;
  objectId: string | null;
  resolvedDigest: Sha256 | null;
  disposition: "resolved" | "retrieval-denied" | "missing" | "unreadable" | "digest-mismatch" | "revision-mismatch" | "role-mismatch";
}>;

export type FoundationKnowledgeConflictResult = Readonly<{
  type: "behavior-inclusion-exclusion" | "assurance-limit" | "blueprint-constraint";
  leftId: string;
  leftRevision: number;
  leftFact: string;
  rightId: string;
  rightRevision: number;
  rightFact: string;
  digest: Sha256;
}>;

export type FoundationCoverageEntry = Readonly<{
  path: string;
  mode: "100644" | "100755";
  objectId: string;
  descriptionId: string;
  descriptionRevision: number;
  selectorPath: string;
  selectorMode: "file" | "tree";
}>;

export type FoundationCoverageExemptionResult = Readonly<{
  path: string;
  reason: string;
  matched: boolean;
}>;

export type FoundationKnowledgeSetManifest = Readonly<{
  schema: "lifecycle.knowledge-set.v2";
  specificationRevision: string;
  profile: "knowledge-set-v2";
  repository: FoundationRepositorySnapshotBasis;
  disciplineRegistry: FoundationDisciplineRegistry;
  records: readonly Readonly<{
    kind: FoundationKnowledgeKind;
    id: string;
    status: FoundationKnowledgeStatus;
    revision: number;
    path: string;
    sourceDigest: Sha256;
    semanticDigest: Sha256;
  }>[];
  relationships: readonly FoundationRelationshipEdge[];
  sources: readonly FoundationKnowledgeSourceResolution[];
  conflicts: readonly FoundationKnowledgeConflictResult[];
  coverage: readonly Readonly<{
    path: string;
    descriptionId: string;
    descriptionRevision: number;
    selectorPath: string;
    selectorMode: "file" | "tree";
  }>[];
  exemptions: readonly FoundationCoverageExemptionResult[];
  bindings: readonly Readonly<{
    checkId: string;
    bindingId: string;
    bindingDigest: Sha256;
  }>[];
  complete: boolean;
  valid: boolean;
  digest: Sha256;
}>;

export type FoundationKnowledgeIndex = Readonly<{
  byIdentityRevision: ReadonlyMap<string, FoundationKnowledgeRecord>;
  revisionsByIdentity: ReadonlyMap<string, readonly FoundationKnowledgeRecord[]>;
  currentByIdentity: ReadonlyMap<string, FoundationKnowledgeRecord>;
  outgoingByIdentity: ReadonlyMap<string, readonly FoundationRelationshipEdge[]>;
  incomingByIdentity: ReadonlyMap<string, readonly FoundationRelationshipEdge[]>;
  coverageByPath: ReadonlyMap<string, FoundationCoverageEntry>;
  coveredPathsByDescription: ReadonlyMap<string, readonly FoundationCoverageEntry[]>;
  bindingsByCheck: ReadonlyMap<string, readonly FoundationCheckBinding[]>;
  sourcesByIdentityRevision: ReadonlyMap<string, readonly FoundationKnowledgeSourceResolution[]>;
}>;

/** Deterministic exact observation retained even when Knowledge is not usable. */
export type FoundationKnowledgeObservation = Readonly<{
  repository: Readonly<{
    path: string;
    contract: FoundationRepositoryContract;
    commit: string;
    tree: string;
    objectFormat: "sha1" | "sha256";
    productStateDigest: Sha256;
    atlasStateDigest: Sha256;
    atlasResolutionDigest: Sha256;
    atlasNormalizedModelDigest: Sha256;
    atlasResourceBindingsDigest: Sha256;
  }>;
  records: readonly FoundationKnowledgeRecord[];
  currentRecords: readonly FoundationKnowledgeRecord[];
  historicalRecords: readonly FoundationKnowledgeRecord[];
  disciplineRegistry: FoundationDisciplineRegistry;
  relationships: readonly FoundationRelationshipEdge[];
  coverage: readonly FoundationCoverageEntry[];
  exemptions: readonly FoundationCoverageExemptionResult[];
  bindings: readonly Readonly<{ checkId: string; binding: FoundationCheckBinding }>[];
  sources: readonly FoundationKnowledgeSourceResolution[];
  conflicts: readonly FoundationKnowledgeConflictResult[];
  validation: FoundationValidationResult;
  manifest: FoundationKnowledgeSetManifest;
  index: FoundationKnowledgeIndex;
}>;

/** A complete valid Knowledge observation admitted for authoritative execution use. */
export type FoundationKnowledgeSet = FoundationKnowledgeObservation;

export type FoundationKnowledgeSetResult = Readonly<{
  validation: FoundationValidationResult;
  observation: FoundationKnowledgeObservation;
  knowledgeSet: FoundationKnowledgeSet | null;
}>;
