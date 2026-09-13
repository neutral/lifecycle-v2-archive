import { reviewRequiresMandateResolutionV1 } from "../evidence/review-classification-v1.js";
import { missingWorkBoundaryRequiredCheckPhase } from "./work-boundary.js";
import { FoundationError } from "../error.js";
import {
  canonicalJson,
  digestCanonical,
  sha256Bytes,
  type Sha256,
} from "../validation/canonical.js";
import { compareCodePoints, sortUniqueCodePoints } from "../validation/ordering.js";
import {
  bool,
  enumeration,
  knowledgeId,
  normalizedPath,
  opaqueId,
  text,
} from "../validation/value.js";
import type {
  ControlActor,
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordRevision,
  ControlRecordRelationshipTarget,
} from "./types.js";

export type AgentWorkProductSemanticObservation = Readonly<{
  activityId: string;
  editor: ControlActor;
  rawDigest: Sha256;
  rawByteLength: number;
  semanticMarkdown: string;
  semanticDigest: Sha256;
}>;

export const FOUNDATION_AGENT_WORK_PRODUCT_PARSER_PROFILE_ID =
  "lifecycle.agent-work-product-parser.v4" as const;
export const FOUNDATION_AGENT_WORK_PRODUCT_COMPILER_PROFILE_ID =
  "lifecycle.agent-work-product-compiler.v4" as const;
export const FOUNDATION_AGENT_WORK_PRODUCT_PARSE_RESULT_SCHEMA =
  "lifecycle.agent-work-product-parse-result.v6" as const;
export const FOUNDATION_AGENT_WORK_PRODUCT_FIXED_BINDINGS_SCHEMA =
  "lifecycle.agent-work-product-fixed-bindings.v6" as const;

export type AgentWorkProductRole = "reconnaissance" | "builder" | "reviewer";
export type AgentWorkProductDisposition = "complete" | "partial" | "blocked" | "no-product";
export type AgentWorkProductUncertainty = "none" | "bounded" | "material" | "unknown";
export type AgentWorkProductFailureClassification = "invalid-result" | "runtime-failure";
export type AgentWorkProductFailurePhase = "syntax" | "template" | "semantic" | "compiler";

export class AgentWorkProductSemanticError extends FoundationError {
  readonly classification: AgentWorkProductFailureClassification;
  readonly phase: AgentWorkProductFailurePhase;

  constructor(
    classification: AgentWorkProductFailureClassification,
    phase: AgentWorkProductFailurePhase,
    code: string,
    message: string,
    facts: Readonly<Record<string, unknown>> = {},
  ) {
    super(
      `lifecycle.agent-work-product.${classification === "invalid-result" ? "invalid" : "runtime"}.${code}`,
      message,
      { observedFacts: Object.freeze({ classification, phase, ...facts }) },
    );
    this.name = "AgentWorkProductSemanticError";
    this.classification = classification;
    this.phase = phase;
  }
}

function invalid(
  phase: Exclude<AgentWorkProductFailurePhase, "compiler">,
  code: string,
  message: string,
  facts: Readonly<Record<string, unknown>> = {},
): never {
  throw new AgentWorkProductSemanticError("invalid-result", phase, code, message, facts);
}

function runtimeFailure(
  code: string,
  message: string,
  facts: Readonly<Record<string, unknown>> = {},
): never {
  throw new AgentWorkProductSemanticError("runtime-failure", "compiler", code, message, facts);
}

export function agentWorkProductFailureClassification(
  error: unknown,
): AgentWorkProductFailureClassification | null {
  return error instanceof AgentWorkProductSemanticError ? error.classification : null;
}

type FragmentKind =
  | "claim"
  | "citation"
  | "limitation"
  | "condition"
  | "decision"
  | "effect"
  | "proposal"
  | "review";

type SourceFragment = Readonly<{
  localId: string;
  anchor: string;
  digest: Sha256;
  kind: FragmentKind;
}>;

type ParsedClaim = SourceFragment & Readonly<{
  kind: "claim";
  category: "completed" | "remaining" | "diagnosis" | "route" | "uncertainty" | "limitation";
  state: "proposed" | "observed" | "unknown";
  statement: string;
  knowledgeIds: readonly string[];
  evidenceIds: readonly string[];
  paths: readonly string[];
  uncertainty: AgentWorkProductUncertainty;
}>;

type ParsedCitation = SourceFragment & Readonly<{
  kind: "citation";
  subjectId: string;
  supportsClaimLocalIds: readonly string[];
}>;

type ParsedLimitation = SourceFragment & Readonly<{
  kind: "limitation";
  statement: string;
}>;

type ParsedBoundaryObject = SourceFragment & Readonly<{
  objectKind: "Objective" | "Mandate" | "Effect" | "Risk" | "Obligation" | "Artifact" | "Check" | "Proposition";
  fields: Readonly<Record<string, readonly string[]>>;
  narrative: string;
}>;

type ParsedMaterialCondition = SourceFragment & Readonly<{
  kind: "condition";
  conditionClass:
    | "meaning-ambiguity"
    | "mandate-falsifier"
    | "scope-change"
    | "effect-change"
    | "risk-change"
    | "architecture-conflict"
    | "assurance-conflict"
    | "director-tradeoff"
    | "missing-authority"
    | "missing-required-source"
    | "required-capability-unavailable"
    | "projection-closure-exceeded"
    | "no-honest-route";
  statement: string;
  falsifiedMandateIds: readonly string[];
  knowledgeIds: readonly string[];
  directorJudgmentRequired: boolean;
}>;

type ParsedBuilderProposal = Readonly<{
  proposal: "progress" | "ready-to-evaluate" | "material-condition" | "unable" | "no-product";
  remainingObligationIds: readonly string[];
  materialCondition: ParsedMaterialCondition | null;
  effects: readonly ParsedBoundaryObject[];
}>;

type ParsedReviewDecision = SourceFragment & Readonly<{
  kind: "decision";
  propositionId: string;
  disposition: "accepted" | "rejected" | "indeterminate" | "not-applicable";
  citationLocalIds: readonly string[];
  rationale: string;
  uncertainty: AgentWorkProductUncertainty;
  limitationLocalIds: readonly string[];
}>;

type ParsedApplicability = Readonly<{
  localId: string; anchor: string; digest: Sha256; kind: "decision";
  receiptId: string | null;
  disposition: "applicable" | "requires-readmission" | "insufficient" | "indeterminate";
  rationale: string; citationLocalIds: readonly string[];
}>;

type ParsedReview = Readonly<{
  mandateApplicability: ParsedApplicability;
  baselineApplicability: readonly ParsedApplicability[];
  mandateExcess: boolean;
  missingObligationIds: readonly string[];
  materialCondition: ParsedMaterialCondition | null;
  decisions: readonly ParsedReviewDecision[];
}>;

export type ParsedAgentWorkProduct = Readonly<{
  role: AgentWorkProductRole;
  profileId: string;
  normalizedMarkdown: string;
  disposition: AgentWorkProductDisposition;
  summary: string;
  summaryFragmentDigest: Sha256;
  uncertainty: AgentWorkProductUncertainty;
  uncertaintyFragmentDigest: Sha256;
  claims: readonly ParsedClaim[];
  citations: readonly ParsedCitation[];
  limitations: readonly ParsedLimitation[];
  noProductReason:
    | "missing-mandatory-input"
    | "conflicting-mandatory-input"
    | "inaccessible-required-material"
    | "unsupported-capability"
    | "context-bound-exceeded"
    | "output-bound-exceeded"
    | "no-honest-route"
    | "other-explicit"
    | null;
  reconnaissance: Readonly<{
    proposal: "work-boundary" | "preparation-condition" | "split-recommended" | "no-product";
    selection: Readonly<Record<string, readonly string[]>> | null;
    objects: readonly ParsedBoundaryObject[];
  }> | null;
  builder: ParsedBuilderProposal | null;
  review: ParsedReview | null;
}>;

export type AgentWorkProductTemplate = Readonly<{
  role: AgentWorkProductRole;
  profileId: string;
  title: string;
  sections: readonly string[];
  markdown: string;
  digest: Sha256;
}>;

export type AgentWorkProductCitationRegistryEntry = Readonly<{
  id: string;
  kind: "knowledge" | "source" | "projection" | "candidate" | "evidence" | "boundary";
  knowledgeIdentity: string | null;
  digest: Sha256;
  locator: string;
  authorityClass:
    | "repository-authored"
    | "runtime-observed"
    | "runtime-derived"
    | "agent-proposed"
    | "director-supplied"
    | "director-authenticated";
}>;

export type AgentWorkProductPropositionSet = Readonly<{
  schema: "lifecycle.proposition-set.v3";
  propositions: readonly Readonly<{
    id: string;
    [key: string]: ControlJsonValue;
  }>[];
}>;

export type AgentWorkProductCompilerInput = Readonly<{
  attempt: ControlRecordRevision;
  workspaceTemplateDigest: Sha256;
  observation: AgentWorkProductSemanticObservation;
  parsed: ParsedAgentWorkProduct;
  citationRegistry: readonly AgentWorkProductCitationRegistryEntry[];
  propositionSet?: AgentWorkProductPropositionSet | null;
}>;

export const FOUNDATION_AGENT_WORK_PRODUCT_VALIDATION_BASIS_MAXIMUM_BYTES = 8 * 1024 * 1024;

export const FOUNDATION_AGENT_WORK_PRODUCT_VALIDATION_BASIS_SCHEMA =
  "lifecycle.agent-work-product-validation-basis.v1" as const;

export type AgentWorkProductValidationCitationFact = Readonly<{
  id: string;
  kind: AgentWorkProductCitationRegistryEntry["kind"];
  knowledgeIdentity: string | null;
}>;

export type AgentWorkProductValidationBasis = Readonly<{
  schema: typeof FOUNDATION_AGENT_WORK_PRODUCT_VALIDATION_BASIS_SCHEMA;
  role: AgentWorkProductRole;
  bodyProfileId: string;
  templateDigest: Sha256;
  parserProfileId: typeof FOUNDATION_AGENT_WORK_PRODUCT_PARSER_PROFILE_ID;
  parserProfileDigest: Sha256;
  compilerProfileId: typeof FOUNDATION_AGENT_WORK_PRODUCT_COMPILER_PROFILE_ID;
  compilerProfileDigest: Sha256;
  citationRegistryDigest: Sha256;
  citationFacts: readonly AgentWorkProductValidationCitationFact[];
  propositionSetDigest: Sha256 | null;
  propositionIds: readonly string[];
  digest: Sha256;
}>;

export type AgentWorkProductValidationBasisInput = Readonly<{
  role: AgentWorkProductRole;
  templateDigest: Sha256;
  parserProfileId: string;
  parserProfileDigest: Sha256;
  compilerProfileId: string;
  compilerProfileDigest: Sha256;
  citationRegistryDigest: Sha256;
  citationRegistry: readonly AgentWorkProductCitationRegistryEntry[];
  propositionSetDigest: Sha256 | null;
  propositionSet?: AgentWorkProductPropositionSet | null;
}>;

export type AgentWorkProductValidationDiagnostic = Readonly<{
  code: string;
  phase: AgentWorkProductFailurePhase;
  correction: "correct-semantic-draft" | "stop-runtime-failure";
  line: number | null;
  subject: string | null;
  localHandle: string | null;
  expected: readonly string[];
}>;

export type AgentWorkProductValidationOutcome =
  | Readonly<{ status: "valid"; diagnostic: null }>
  | Readonly<{ status: "invalid-result"; diagnostic: AgentWorkProductValidationDiagnostic }>
  | Readonly<{ status: "runtime-failure"; diagnostic: AgentWorkProductValidationDiagnostic }>;

const COMMON_SECTIONS = Object.freeze([
  "Outcome",
  "Claims",
  "Citations",
  "Limitations",
] as const);

export const FOUNDATION_AGENT_WORK_PRODUCT_LOCAL_HANDLE_GUIDANCE =
  "Every semantic object definition has a local handle unique across the whole semantic.md, including different sections and item kinds. When present, Objective and Mandate define the fixed handles objective and mandate; do not reuse them for another object. Use distinct names such as claim-result, cite-result, obligation-result and check-result. Metadata such as Supports, Citation, Obligation, Check and Evidence artifact references an existing definition; repeating a reference is different from defining that handle again. When renaming a definition, update every reference to that object.";

export const FOUNDATION_AGENT_WORK_PRODUCT_REVIEW_GUIDANCE = [
  "A complete or partial Review judges every frozen Proposition exactly once, includes one Mandate Applicability block, and includes one Baseline Applicability block for every required original baseline Receipt, including an authorized not-run Receipt. Each Decision and applicability block requires at least one Citation local handle. Each Baseline Applicability block must cite its own exact original Receipt; a final Receipt cannot substitute for it.",
  "Mandate Applicability Disposition requires-readmission requires exactly one Material Condition block. The same requirement applies to baseline Disposition insufficient, Mandate excess true, any Missing obligation, or material overall or Decision Uncertainty. Include no Material Condition without such a finding. Explain the precise issue and lawful correction in its statement; a recommendation in prose alone does not supply this typed proposal. A rejected proposition alone does not establish a mandate change.",
  "Select the justified Condition class from the template. Falsified mandate, when present, names an exact admitted objective, direction, effect, risk, obligation, artifact, Check requirement or acceptance proposition identity, not the Work Boundary record identity or a new local handle. The mandate-falsifier class requires at least one such identity. Condition Knowledge, when present, names only identities selected by the active Work Boundary. Omit optional fields with no applicable identity; do not invent one.",
  "Define every referenced Citation under Citations: Subject uses the supplied frozen citation handle and Supports names at least one Claim local handle. A Claim Evidence field uses the exact supplied Evidence subject identity and requires that subject's supporting Citation. Preserve the original baseline, final Receipt and Candidate distinctions even when describing the same Check. Review is read-only: propose the Condition, do not modify the Candidate, requirement, Binding or Receipt. Runtime validation and Director readmission govern the subsequent resolution.",
  "A Decision's optional Limitation field references a Limitation definition under the Limitations section. A Claim with Category limitation is still a Claim and cannot satisfy that reference. Define a separate Limitation with its own unique handle, such as limit-final-check-unavailable, and reference that handle; or omit the optional Limitation field while preserving the supported claim and uncertainty. Do not reuse the Claim handle for the new Limitation.",
].join("\n\n");

const ROLE_PROFILES = Object.freeze({
  reconnaissance: Object.freeze({
    title: "Reconnaissance Work Product",
    roleSection: "Proposal",
  }),
  builder: Object.freeze({
    title: "Builder Work Product",
    roleSection: "Proposal",
  }),
  reviewer: Object.freeze({
    title: "Reviewer Work Product",
    roleSection: "Review",
  }),
} satisfies Readonly<Record<AgentWorkProductRole, Readonly<{ title: string; roleSection: string }>>>);

function profileId(role: AgentWorkProductRole): string {
  return `lifecycle.agent-work-product-body.${role}.v4`;
}

function commonTemplate(role: AgentWorkProductRole): string[] {
  return [
    "## Outcome",
    ...(role === "reconnaissance" ? [] : ["- Disposition: <complete | partial | blocked | no-product>"]),
    "- Uncertainty: <none | bounded | material | unknown>",
    "",
    "<bounded semantic summary>",
    "",
    "## Claims",
    "",
    "### Claim: claim-local-handle",
    "",
    "- Category: <completed | remaining | diagnosis | route | uncertainty | limitation>",
    "- State: <proposed | observed | unknown>",
    "- Uncertainty: <none | bounded | material | unknown>",
    "- Knowledge: <repeat only when present>",
    "",
    "<claim statement>",
    "",
    "## Citations",
    "",
    "### Citation: citation-local-handle",
    "",
    "- Subject: <exact Attempt-local citation identifier>",
    "- Supports: <claim-local-handle; repeat when needed>",
    "",
  ];
}

function reconnaissanceTemplate(): string[] {
  return [
    "## Proposal",
    "",
    "- Kind: <work-boundary | preparation-condition | split-recommended | no-product>",
    "- Capability profile: <registered builder capability profile identity>",
    "- Projection profile: <execution-standard-v1 | execution-large-v1>",
    "- Selected Knowledge: <repeat only when present>",
    "- Selected work type: <repeat only when helpful>",
    "",
    "### Objective",
    "",
    "<semantic interpretation of the fixed objective>",
    "",
    "### Mandate",
    "",
    "- Why now: <decision context>",
    "- Included: <repeat for each included outcome>",
    "",
    "<selected product meaning>",
    "",
    "### Obligation: obligation-local-handle",
    "",
    "- Kind: <behavior | assurance | blueprint | description | artifact | check | effect | risk | exclusion | acceptance>",
    "- Source: <selected Knowledge/source identity or the fixed mandate handle `mandate`; repeat only when present>",
    "- Severity: <required | diagnostic>",
    "",
    "<obligation statement>",
    "",
    "### Artifact: artifact-local-handle",
    "",
    "- Path: <normalized repository-relative path>",
    "- Role: <code | test | behavior | assurance | blueprint | description | check | documentation | external-source>",
    "- Must change: <true | false>",
    "- Obligation: <obligation-local-handle; repeat when needed>",
    "",
    "<artifact change rule>",
    "",
    "### Check: check-local-handle",
    "",
    "- Check Knowledge: <selected check Knowledge identity>",
    "- Binding: <registered binding identity; repeat when needed>",
    "- Modality: <precondition | repair-target | regression-guard | postcondition | diagnostic>",
    "- Obligation: <obligation-local-handle; repeat when needed>",
    "- Baseline required: <true | false; at least one Check must be true; a baseline-required postcondition records authorized not-run without baseline execution>",
    "- Final required: <true | false; at least one Check must be true>",
    "- Environment requirement: <repeat only when present>",
    "",
    "<Check purpose>",
    "",
    "### Proposition: proposition-local-handle",
    "",
    "- Evidence kind: <inspection | artifact | check | diff | analysis | mixed; repeat when needed>",
    "- Evidence artifact: <artifact-local-handle; repeat only when present>",
    "- Obligation: <obligation-local-handle; repeat when needed>",
    "- Check: <check-local-handle; omit when absent>",
    "",
    "<acceptance claim>",
  ];
}

function builderTemplate(): string[] {
  return [
    "## Proposal",
    "",
    "- Kind: <progress | ready-to-evaluate | material-condition | unable>",
    "- Remaining obligation: <exact obligation identity; repeat only when present>",
    "",
    "### Material Condition: condition-local-handle",
    "",
    "- Condition class: <meaning-ambiguity | mandate-falsifier | scope-change | effect-change | risk-change | architecture-conflict | assurance-conflict | director-tradeoff | missing-authority | missing-required-source | required-capability-unavailable | projection-closure-exceeded | no-honest-route>",
    "- Falsified mandate: <exact admitted mandate identity; repeat only when present>",
    "- Knowledge: <exact Knowledge identity; repeat only when present>",
    "",
    "<material condition statement>",
    "",
    "### Effect: effect-local-handle",
    "",
    "- Kind: <local-read | local-write | network-request | external-mutation | notification | publication | spend | deployment | other>",
    "- Trigger: <effect trigger>",
    "- Target: <effect target>",
    "- Reversibility: <read-only | reversible | compensatable | irreversible>",
    "",
    "<proposed effect summary>",
  ];
}

function reviewerTemplate(): string[] {
  return [
    "## Review",
    "",
    "- Mandate excess: <true | false>",
    "- Missing obligation: <exact obligation identity; repeat only when present>",
    "",
    "### Mandate Applicability: mandate-applicability-local-handle",
    "",
    "- Disposition: <applicable | requires-readmission | indeterminate>",
    "- Citation: <citation-local-handle; repeat when needed>",
    "",
    "<explain the admitted mandate against the exact integration parent and result>",
    "",
    "### Baseline Applicability: baseline-applicability-local-handle",
    "",
    "- Receipt: <exact original baseline Receipt identity; one block for every required baseline Receipt>",
    "- Disposition: <applicable | insufficient | indeterminate>",
    "- Citation: <citation-local-handle; repeat when needed>",
    "",
    "<explain this original baseline's applicability to the exact integration parent and result>",
    "",
    "### Material Condition: condition-local-handle",
    "",
    "- Condition class: <meaning-ambiguity | mandate-falsifier | scope-change | effect-change | risk-change | architecture-conflict | assurance-conflict | director-tradeoff | missing-authority | missing-required-source | required-capability-unavailable | projection-closure-exceeded | no-honest-route>",
    "- Falsified mandate: <exact admitted mandate identity; repeat only when present>",
    "- Knowledge: <exact Knowledge identity; repeat only when present>",
    "",
    "<material condition statement>",
    "",
    "### Decision: decision-local-handle",
    "",
    "- Proposition: <exact-proposition-identity>",
    "- Disposition: <accepted | rejected | indeterminate | not-applicable>",
    "- Citation: <citation-local-handle; repeat when needed>",
    "- Uncertainty: <none | bounded | material | unknown>",
    "- Limitation: <limitation-local-handle; repeat only when present>",
    "",
    "<decision rationale>",
  ];
}

export function renderAgentWorkProductTemplate(role: AgentWorkProductRole): AgentWorkProductTemplate {
  const profile = ROLE_PROFILES[role];
  const roleLines = role === "reconnaissance"
    ? reconnaissanceTemplate()
    : role === "builder"
      ? builderTemplate()
      : reviewerTemplate();
  const markdown = `# ${profile.title}\n\n${[...commonTemplate(role), ...roleLines].join("\n")}\n`;
  return Object.freeze({
    role,
    profileId: profileId(role),
    title: profile.title,
    sections: Object.freeze([...COMMON_SECTIONS, profile.roleSection]),
    markdown,
    digest: sha256Bytes(markdown),
  });
}

type Section = Readonly<{ label: string; headingLine: number; endLine: number }>;
type Block = Readonly<{
  headingLine: number;
  endLine: number;
  localId: string;
  captures: Readonly<Record<string, string>>;
  digest: Sha256;
}>;
type MetadataRule = Readonly<{ label: string; required: boolean; repeated: boolean }>;
type ParsedMetadata = Readonly<{
  fields: Readonly<Record<string, readonly string[]>>;
  narrative: string | null;
}>;

const LOCAL_ID_SOURCE = "[a-z][a-z0-9]*(?:-[a-z0-9]+)*";
const CLAIM_HEADING = new RegExp(`^### Claim: (?<localId>${LOCAL_ID_SOURCE}) \\{#(?<anchor>${LOCAL_ID_SOURCE})\\}$`, "u");
const CITATION_HEADING = new RegExp(`^### Citation: (?<localId>${LOCAL_ID_SOURCE}) \\{#(?<anchor>${LOCAL_ID_SOURCE})\\}$`, "u");
const LIMITATION_HEADING = new RegExp(`^### Limitation: (?<localId>${LOCAL_ID_SOURCE}) \\{#(?<anchor>${LOCAL_ID_SOURCE})\\}$`, "u");
const BOUNDARY_HEADING = new RegExp(
  `^### (?:(?<singletonKind>Objective|Mandate) \\{#(?<singletonAnchor>objective|mandate)\\}|(?<objectKind>Effect|Risk|Obligation|Artifact|Check|Proposition): (?<localId>${LOCAL_ID_SOURCE}) \\{#(?<anchor>${LOCAL_ID_SOURCE})\\})$`,
  "u",
);
const BUILDER_HEADING = new RegExp(
  `^### (?<builderKind>Material Condition|Effect): (?<localId>${LOCAL_ID_SOURCE}) \\{#(?<anchor>${LOCAL_ID_SOURCE})\\}$`,
  "u",
);
const REVIEW_HEADING = new RegExp(
  `^### (?<reviewKind>Decision|Material Condition|Mandate Applicability|Baseline Applicability): (?<localId>${LOCAL_ID_SOURCE}) \\{#(?<anchor>${LOCAL_ID_SOURCE})\\}$`,
  "u",
);

const OUTCOME_RECONNAISSANCE_RULES = Object.freeze([
  { label: "Uncertainty", required: true, repeated: false },
  { label: "No-product reason", required: false, repeated: false },
] satisfies readonly MetadataRule[]);
const OUTCOME_RULES = Object.freeze([
  { label: "Disposition", required: true, repeated: false },
  { label: "Uncertainty", required: true, repeated: false },
  { label: "No-product reason", required: false, repeated: false },
] satisfies readonly MetadataRule[]);

const CLAIM_RULES = Object.freeze([
  { label: "Category", required: true, repeated: false },
  { label: "State", required: true, repeated: false },
  { label: "Uncertainty", required: true, repeated: false },
  { label: "Knowledge", required: false, repeated: true },
  { label: "Evidence", required: false, repeated: true },
  { label: "Path", required: false, repeated: true },
] satisfies readonly MetadataRule[]);
const CITATION_RULES = Object.freeze([
  { label: "Subject", required: true, repeated: false },
  { label: "Supports", required: true, repeated: true },
] satisfies readonly MetadataRule[]);
const BOUNDARY_SELECTION_RULES = Object.freeze([
  { label: "Kind", required: true, repeated: false },
  { label: "Capability profile", required: false, repeated: false },
  { label: "Projection profile", required: false, repeated: false },
  { label: "Selected Knowledge", required: false, repeated: true },
  { label: "Selected work type", required: false, repeated: true },
  { label: "Selected source", required: false, repeated: true },
] satisfies readonly MetadataRule[]);
const MANDATE_RULES = Object.freeze([
  { label: "Why now", required: true, repeated: false },
  { label: "Included", required: true, repeated: true },
  { label: "Excluded", required: false, repeated: true },
  { label: "Authority fact", required: false, repeated: true },
  { label: "Chosen tradeoff", required: false, repeated: true },
  { label: "Assumption", required: false, repeated: true },
  { label: "Falsifier", required: false, repeated: true },
] satisfies readonly MetadataRule[]);
const EFFECT_RULES = Object.freeze([
  { label: "Kind", required: true, repeated: false },
  { label: "Trigger", required: true, repeated: false },
  { label: "Target", required: true, repeated: false },
  { label: "Reversibility", required: true, repeated: false },
] satisfies readonly MetadataRule[]);
const RISK_RULES = Object.freeze([
  { label: "Effect", required: false, repeated: true },
  { label: "Treatment", required: true, repeated: false },
  { label: "Evidence artifact", required: false, repeated: true },
  { label: "Proposition", required: false, repeated: true },
] satisfies readonly MetadataRule[]);
const OBLIGATION_RULES = Object.freeze([
  { label: "Kind", required: true, repeated: false },
  { label: "Source", required: false, repeated: true },
  { label: "Required evidence artifact", required: false, repeated: true },
  { label: "Severity", required: true, repeated: false },
] satisfies readonly MetadataRule[]);
const ARTIFACT_RULES = Object.freeze([
  { label: "Path", required: true, repeated: false },
  { label: "Role", required: true, repeated: false },
  { label: "Must change", required: true, repeated: false },
  { label: "Obligation", required: true, repeated: true },
] satisfies readonly MetadataRule[]);
const CHECK_RULES = Object.freeze([
  { label: "Check Knowledge", required: true, repeated: false },
  { label: "Binding", required: true, repeated: true },
  { label: "Modality", required: true, repeated: false },
  { label: "Obligation", required: true, repeated: true },
  { label: "Baseline required", required: true, repeated: false },
  { label: "Final required", required: true, repeated: false },
  { label: "Environment requirement", required: false, repeated: true },
] satisfies readonly MetadataRule[]);
const PROPOSITION_RULES = Object.freeze([
  { label: "Evidence kind", required: true, repeated: true },
  { label: "Evidence artifact", required: false, repeated: true },
  { label: "Obligation", required: true, repeated: true },
  { label: "Effect", required: false, repeated: true },
  { label: "Risk", required: false, repeated: true },
  { label: "Path", required: false, repeated: false },
  { label: "Check", required: false, repeated: false },
  { label: "Not applicable condition", required: false, repeated: false },
] satisfies readonly MetadataRule[]);
const BUILDER_SELECTION_RULES = Object.freeze([
  { label: "Kind", required: true, repeated: false },
  { label: "Remaining obligation", required: false, repeated: true },
] satisfies readonly MetadataRule[]);
const CONDITION_RULES = Object.freeze([
  { label: "Condition class", required: true, repeated: false },
  { label: "Falsified mandate", required: false, repeated: true },
  { label: "Knowledge", required: false, repeated: true },
] satisfies readonly MetadataRule[]);
const REVIEW_RULES = Object.freeze([
  { label: "Mandate excess", required: true, repeated: false },
  { label: "Missing obligation", required: false, repeated: true },
] satisfies readonly MetadataRule[]);
const APPLICABILITY_RULES = Object.freeze([
  { label: "Disposition", required: true, repeated: false },
  { label: "Citation", required: true, repeated: true },
] satisfies readonly MetadataRule[]);
const BASELINE_APPLICABILITY_RULES = Object.freeze([
  { label: "Receipt", required: true, repeated: false },
  ...APPLICABILITY_RULES,
] satisfies readonly MetadataRule[]);
const REVIEW_DECISION_RULES = Object.freeze([
  { label: "Proposition", required: true, repeated: false },
  { label: "Disposition", required: true, repeated: false },
  { label: "Citation", required: true, repeated: true },
  { label: "Uncertainty", required: true, repeated: false },
  { label: "Limitation", required: false, repeated: true },
] satisfies readonly MetadataRule[]);

const FORBIDDEN_MECHANICS = new Set([
  "Activity",
  "Attempt",
  "Authority",
  "Candidate",
  "Complete",
  "Compiler",
  "Digest",
  "Identity",
  "Invocation",
  "Kind",
  "Locator",
  "Order",
  "Process",
  "Projection digest",
  "Revision",
  "Role",
  "Subject digest",
]);

const TOKEN_METADATA_FIELDS = new Set([
  "Baseline required",
  "Binding",
  "Capability profile",
  "Category",
  "Check",
  "Check Knowledge",
  "Citation",
  "Condition class",
  "Disposition",
  "Effect",
  "Evidence",
  "Evidence artifact",
  "Evidence kind",
  "Falsified mandate",
  "Final required",
  "Kind",
  "Knowledge",
  "Limitation",
  "Mandate excess",
  "Missing obligation",
  "Modality",
  "Must change",
  "Obligation",
  "Path",
  "Projection profile",
  "Proposition",
  "Remaining obligation",
  "Receipt",
  "Reversibility",
  "Risk",
  "Role",
  "Selected Knowledge",
  "Selected work type",
  "Selected source",
  "Severity",
  "Source",
  "State",
  "Subject",
  "Supports",
  "Treatment",
  "Uncertainty",
]);

const CITATION_KINDS = Object.freeze([
  "knowledge",
  "source",
  "projection",
  "candidate",
  "evidence",
  "boundary",
] as const);

function causeCode(error: unknown): string {
  return error !== null && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : "runtime.unexpected";
}

function asText(value: string, label: string): string {
  try {
    return text(value, label, 16_384);
  } catch (error) {
    invalid("semantic", "text", `${label} is outside its bounded text domain`, { causeCode: causeCode(error) });
  }
}

function runtimeId(value: unknown, label: string): string {
  try {
    return opaqueId(value, label);
  } catch (error) {
    runtimeFailure("context-invalid", `${label} is not one exact runtime identity`, {
      causeCode: causeCode(error),
    });
  }
}

function runtimeLocator(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > 8_192 ||
    /[\u0000-\u0020\u007f-\u009f]/u.test(value)
  ) {
    runtimeFailure("context-invalid", `${label} must be one bounded URI-reference token`);
  }
  return value;
}

function asId(value: string, label: string): string {
  try {
    return opaqueId(semanticToken(value), label);
  } catch (error) {
    invalid("semantic", "identity", `${label} is not one valid identity`, { causeCode: causeCode(error) });
  }
}

function asKnowledgeId(value: string, label: string): string {
  try {
    return knowledgeId(semanticToken(value), label);
  } catch (error) {
    invalid("semantic", "knowledge-identity", `${label} is not one valid Knowledge identity`, {
      causeCode: causeCode(error),
    });
  }
}

function asPath(value: string, label: string): string {
  try {
    return normalizedPath(semanticToken(value), label);
  } catch (error) {
    invalid("semantic", "path", `${label} is not one normalized repository-relative path`, {
      causeCode: causeCode(error),
    });
  }
}

function asBoolean(value: string, label: string): boolean {
  const token = semanticToken(value);
  try {
    return bool(token === "true" ? true : token === "false" ? false : token, label);
  } catch (error) {
    invalid("semantic", "boolean", `${label} must be exactly true or false`, { causeCode: causeCode(error) });
  }
}

function asEnum<const Values extends readonly string[]>(
  value: string,
  label: string,
  values: Values,
): Values[number] {
  const token = semanticToken(value);
  try {
    return enumeration(token, label, values);
  } catch (error) {
    invalid("semantic", "enumeration", `${label} uses an unsupported value`, {
      causeCode: causeCode(error),
      value: token,
    });
  }
}

function localIds(values: readonly string[], label: string): readonly string[] {
  const pattern = new RegExp(`^${LOCAL_ID_SOURCE}$`, "u");
  return Object.freeze(values.map((value) => {
    const token = semanticToken(value);
    if (!pattern.test(token)) invalid("semantic", "local-reference", `${label} contains an invalid local handle`);
    return token;
  }));
}

function semanticToken(value: string): string {
  const match = value.match(/^`(?<token>[^`\n]+)`$/u);
  return match?.groups?.token ?? value;
}

function sortedIds(values: readonly string[], label: string): readonly string[] {
  return Object.freeze(sortUniqueCodePoints(values.map((value, index) => asId(value, `${label}[${index}]`))));
}

function sourceLines(markdown: string): readonly string[] {
  if (Buffer.byteLength(markdown, "utf8") > 1024 * 1024) {
    invalid("syntax", "file-bound", "Agent semantic Markdown exceeds its 1048576-byte bound");
  }
  if (markdown.startsWith("\uFEFF")) {
    invalid("syntax", "byte-order-mark", "Agent semantic Markdown contains a forbidden UTF-8 byte-order mark");
  }
  if (!markdown.endsWith("\n") || markdown.endsWith("\n\n")) {
    invalid("syntax", "final-newline", "Semantic Markdown must end with exactly one LF");
  }
  const lines = markdown.split("\n");
  if (lines.length - 1 > 32_768) {
    invalid("syntax", "line-bound", "Agent semantic Markdown exceeds its 32768-line bound");
  }
  let headingCount = 0;
  for (const [index, line] of lines.entries()) {
    if (line === "---") invalid("template", "delimiter", "Agent semantic Markdown cannot contain a front-matter delimiter", { line: index + 1 });
    if (line.includes("\t") || / +$/u.test(line)) {
      invalid("template", "whitespace", "Agent semantic Markdown forbids tabs and trailing spaces", { line: index + 1 });
    }
    if (/^#{4,}(?: |$)/u.test(line)) {
      invalid("template", "heading-depth", "Agent semantic Markdown permits only its level-one through level-three template headings", { line: index + 1 });
    }
    if (/^#{1,3} /u.test(line)) {
      headingCount += 1;
      if (Buffer.byteLength(line, "utf8") > 4_096) {
        invalid("syntax", "heading-bound", "Agent semantic Markdown contains an oversized heading", { line: index + 1 });
      }
    }
  }
  if (headingCount > 16_384) {
    invalid("syntax", "heading-bound", "Agent semantic Markdown exceeds its 16384-heading bound");
  }
  return Object.freeze(lines);
}

function normalizeDraftAnchors(lines: readonly string[]): readonly string[] {
  const repeatable = new RegExp(
    `^### (?<kind>Claim|Citation|Limitation|Effect|Risk|Obligation|Artifact|Check|Proposition|Material Condition|Decision|Mandate Applicability|Baseline Applicability): (?<localId>${LOCAL_ID_SOURCE})$`,
    "u",
  );
  const definitions = new Map<string, number>();
  return Object.freeze(lines.map((line, index) => {
    if (/^### .*\{#[^}]+\}$/u.test(line)) {
      invalid("template", "agent-anchor", "Agent semantic Markdown cannot author fragment anchors", { line: index + 1 });
    }
    const repeated = line.match(repeatable);
    const localId = repeated?.groups?.localId ?? (line === "### Objective" ? "objective" : line === "### Mandate" ? "mandate" : null);
    if (localId !== null) {
      const firstLine = definitions.get(localId);
      if (firstLine !== undefined) invalid("semantic", "duplicate-local-identity", "Agent Work Product defines the same local handle more than once", {
        line: index + 1, localHandle: localId, firstLine,
      });
      definitions.set(localId, index + 1);
      return `${line} {#${localId}}`;
    }
    return line;
  }));
}

function sectionsFor(role: AgentWorkProductRole, lines: readonly string[]): ReadonlyMap<string, Section> {
  const profile = ROLE_PROFILES[role];
  if (lines[0] !== `# ${profile.title}`) {
    invalid("template", "title", "Agent Work Product title does not match the Attempt-selected role");
  }
  const found: Array<Readonly<{ label: string; line: number }>> = [];
  for (let index = 1; index < lines.length - 1; index += 1) {
    const line = lines[index]!;
    if (/^#(?: |$)/u.test(line)) invalid("template", "title-repeat", "Agent Work Product contains another level-one heading", { line: index + 1 });
    if (/^## /u.test(line)) found.push(Object.freeze({ label: line.slice(3), line: index }));
    else if (/^##(?:#|$)/u.test(line) && !/^### /u.test(line)) {
      invalid("template", "heading", "Agent Work Product section headings must use exact level-two ATX syntax", { line: index + 1 });
    }
  }
  const supported = new Set<string>([...COMMON_SECTIONS, profile.roleSection]);
  for (const { label, line } of found) {
    if (!supported.has(label)) {
      invalid("template", "sections", `Agent Work Product contains unsupported section ${label}`, { line: line + 1 });
    }
  }
  if (new Set(found.map(({ label }) => label)).size !== found.length) {
    invalid("template", "sections", "Agent Work Product repeats a section");
  }
  const firstSectionLine = found[0]?.line ?? lines.length;
  if (lines.slice(1, firstSectionLine).some((line) => line !== "")) {
    invalid("template", "title-prefix", "Only blank lines may separate the title from the first section");
  }
  return new Map(found.map((entry, index) => [entry.label, Object.freeze({
    label: entry.label,
    headingLine: entry.line,
    endLine: found[index + 1]?.line ?? lines.length,
  })]));
}

function sectionBody(lines: readonly string[], section: Section): readonly string[] {
  return Object.freeze(lines.slice(section.headingLine + 1, section.endLine));
}

function sectionDigest(lines: readonly string[], section: Section): Sha256 {
  const value = lines.slice(section.headingLine, section.endLine).join("\n");
  return sha256Bytes(value.endsWith("\n") ? value : `${value}\n`);
}

function blocks(
  lines: readonly string[],
  section: Section,
  pattern: RegExp,
  label: string,
): Readonly<{ prefix: readonly string[]; values: readonly Block[] }> {
  const headings: number[] = [];
  for (let index = section.headingLine + 1; index < section.endLine; index += 1) {
    if (/^### /u.test(lines[index]!)) headings.push(index);
  }
  if (headings.length === 0) {
    const body = sectionBody(lines, section);
    if (body.some((line) => line !== "")) {
      invalid("template", "empty-section", `${label} without items must be empty`);
    }
    return Object.freeze({ prefix: body, values: Object.freeze([]) });
  }
  const result = headings.map((headingLine, index): Block => {
    const match = lines[headingLine]!.match(pattern);
    if (match?.groups === undefined) {
      invalid("template", "item-heading", `${label} item heading does not match its exact anchored grammar`, {
        line: headingLine + 1,
      });
    }
    const localId = match.groups.localId ?? match.groups.singletonKind?.toLowerCase();
    const anchor = match.groups.anchor ?? match.groups.singletonAnchor;
    if (localId === undefined || anchor !== localId) {
      invalid("template", "item-heading", `${label} item anchor does not match its local handle`, {
        line: headingLine + 1,
      });
    }
    const endLine = headings[index + 1] ?? section.endLine;
    return Object.freeze({
      headingLine,
      endLine,
      localId,
      captures: Object.freeze({ ...match.groups }) as Readonly<Record<string, string>>,
      digest: (() => {
        const value = lines.slice(headingLine, endLine).join("\n");
        return sha256Bytes(value.endsWith("\n") ? value : `${value}\n`);
      })(),
    });
  });
  return Object.freeze({
    prefix: Object.freeze(lines.slice(section.headingLine + 1, headings[0])),
    values: Object.freeze(result),
  });
}

function parseMetadata(
  lines: readonly string[],
  block: Readonly<{ headingLine: number; endLine: number }>,
  rules: readonly MetadataRule[],
  label: string,
  narrativeRequired: boolean,
): ParsedMetadata {
  const body = lines.slice(block.headingLine + 1, block.endLine);
  let start = 0;
  while (body[start] === "") start += 1;
  let cursor = start;
  const metadataLines: string[] = [];
  if (rules.length > 0) {
    while (cursor < body.length) {
      const line = body[cursor]!;
      if (line === "") {
        cursor += 1;
        continue;
      }
      if (!line.startsWith("- ")) break;
      metadataLines.push(line);
      cursor += 1;
    }
  }
  const narrativeLines = body.slice(cursor);
  while (narrativeLines[0] === "") narrativeLines.shift();
  while (narrativeLines.at(-1) === "") narrativeLines.pop();
  const ruleIndex = new Map(rules.map((rule, index) => [rule.label, index]));
  const fields = new Map<string, string[]>();
  for (const line of metadataLines) {
    const match = line.match(/^- (?<label>No-product reason|[A-Za-z][A-Za-z ]*): (?<value>.+)$/u);
    const field = match?.groups?.label;
    const value = match?.groups?.value;
    if (field !== undefined && FORBIDDEN_MECHANICS.has(field) && !ruleIndex.has(field)) {
      invalid("semantic", "mechanics-authored", `${label} authors runtime-owned field ${field}`, { field });
    }
    const index = field === undefined ? undefined : ruleIndex.get(field);
    if (field === undefined || value === undefined || index === undefined || value !== value.trim()) {
      invalid("template", "metadata", `${label} contains an unsupported metadata line`);
    }
    const rule = rules[index]!;
    const values = fields.get(field) ?? [];
    if (!rule.repeated && values.length > 0) invalid("template", "metadata-repeat", `${label} repeats ${field}`);
    values.push(TOKEN_METADATA_FIELDS.has(field) ? semanticToken(value) : value);
    fields.set(field, values);
  }
  for (const rule of rules) {
    if (rule.required && !fields.has(rule.label)) invalid("template", "metadata-missing", `${label} is missing ${rule.label}`);
  }
  const narrative = narrativeLines.length === 0 ? null : narrativeLines.join("\n");
  if (narrativeRequired && narrative === null) {
    invalid("semantic", "narrative", `${label} requires one bounded nonempty narrative`);
  }
  if (!narrativeRequired && narrative !== null) invalid("template", "narrative-forbidden", `${label} does not accept narrative text`);
  if (narrative !== null) asText(narrative, `${label} narrative`);
  return Object.freeze({
    fields: Object.freeze(Object.fromEntries([...fields].map(([key, values]) => {
      const rule = rules[ruleIndex.get(key)!]!;
      return [key, Object.freeze(rule.repeated ? sortUniqueCodePoints(values) : values)];
    }))),
    narrative,
  });
}

function one(metadata: ParsedMetadata, field: string): string {
  return metadata.fields[field]![0]!;
}

function many(metadata: ParsedMetadata, field: string): readonly string[] {
  return metadata.fields[field] ?? Object.freeze([]);
}

function boundedCollection(count: number, maximum: number, label: string): void {
  if (count > maximum) {
    invalid("semantic", "collection-bound", `${label} exceeds its ${maximum}-item semantic bound`, {
      count,
      maximum,
    });
  }
}

function sortedLocalValues<T extends Readonly<{ localId: string }>>(values: readonly T[]): readonly T[] {
  return Object.freeze([...values].sort((left, right) => compareCodePoints(left.localId, right.localId)));
}

function parseClaims(lines: readonly string[], section: Section): readonly ParsedClaim[] {
  const parsed = blocks(lines, section, CLAIM_HEADING, "Claims");
  if (parsed.prefix.some((line) => line !== "")) {
    invalid("template", "collection-prefix", "Claims cannot contain text outside a Claim item");
  }
  boundedCollection(parsed.values.length, 4_096, "Claims");
  return sortedLocalValues(parsed.values.map((block): ParsedClaim => {
    const metadata = parseMetadata(lines, block, CLAIM_RULES, `Claim ${block.localId}`, true);
    return Object.freeze({
      localId: block.localId,
      anchor: block.localId,
      digest: block.digest,
      kind: "claim",
      category: asEnum(one(metadata, "Category"), "Claim category", [
        "completed", "remaining", "diagnosis", "route", "uncertainty", "limitation",
      ] as const),
      state: asEnum(one(metadata, "State"), "Claim state", ["proposed", "observed", "unknown"] as const),
      statement: metadata.narrative!,
      knowledgeIds: Object.freeze(sortUniqueCodePoints(many(metadata, "Knowledge").map((value, index) =>
        asKnowledgeId(value, `Claim Knowledge[${index}]`)))),
      evidenceIds: sortedIds(many(metadata, "Evidence"), "Claim Evidence"),
      paths: Object.freeze(sortUniqueCodePoints(many(metadata, "Path").map((value, index) =>
        asPath(value, `Claim path[${index}]`)))),
      uncertainty: asEnum(one(metadata, "Uncertainty"), "Claim uncertainty", [
        "none", "bounded", "material", "unknown",
      ] as const),
    });
  }));
}

function parseCitations(lines: readonly string[], section: Section): readonly ParsedCitation[] {
  const parsed = blocks(lines, section, CITATION_HEADING, "Citations");
  if (parsed.prefix.some((line) => line !== "")) {
    invalid("template", "collection-prefix", "Citations cannot contain text outside a Citation item");
  }
  boundedCollection(parsed.values.length, 4_096, "Citations");
  return sortedLocalValues(parsed.values.map((block): ParsedCitation => {
    const metadata = parseMetadata(lines, block, CITATION_RULES, `Citation ${block.localId}`, false);
    return Object.freeze({
      localId: block.localId,
      anchor: block.localId,
      digest: block.digest,
      kind: "citation",
      subjectId: asId(one(metadata, "Subject"), "Citation subject"),
      supportsClaimLocalIds: localIds(many(metadata, "Supports"), "Citation supports"),
    });
  }));
}

function parseLimitations(lines: readonly string[], section: Section): readonly ParsedLimitation[] {
  const parsed = blocks(lines, section, LIMITATION_HEADING, "Limitations");
  if (parsed.prefix.some((line) => line !== "")) {
    invalid("template", "collection-prefix", "Limitations cannot contain text outside a Limitation item");
  }
  boundedCollection(parsed.values.length, 1_024, "Limitations");
  return sortedLocalValues(parsed.values.map((block): ParsedLimitation => {
    const metadata = parseMetadata(lines, block, [], `Limitation ${block.localId}`, true);
    return Object.freeze({
      localId: block.localId,
      anchor: block.localId,
      digest: block.digest,
      kind: "limitation",
      statement: metadata.narrative!,
    });
  }));
}

function parseBoundary(
  lines: readonly string[],
  section: Section,
): ParsedAgentWorkProduct["reconnaissance"] {
  const childHeadingCount = lines.slice(section.headingLine + 1, section.endLine)
    .filter((line) => /^### /u.test(line)).length;
  if (childHeadingCount === 0) {
    const proposalMetadata = parseMetadata(
      lines,
      { headingLine: section.headingLine, endLine: section.endLine },
      BOUNDARY_SELECTION_RULES,
      "Reconnaissance Proposal",
      false,
    );
    const proposal = asEnum(one(proposalMetadata, "Kind"), "Reconnaissance proposal", [
      "work-boundary", "preparation-condition", "split-recommended", "no-product",
    ] as const);
    if (proposal === "work-boundary") {
      invalid("semantic", "work-boundary-incomplete", "A work-boundary proposal requires complete Work Boundary semantic objects");
    }
    if (["Capability profile", "Projection profile", "Selected Knowledge", "Selected work type", "Selected source"]
      .some((field) => many(proposalMetadata, field).length > 0)) {
      invalid("semantic", "reconnaissance-selection", "Only a work-boundary proposal can select execution subjects or profiles");
    }
    return Object.freeze({ proposal, selection: null, objects: Object.freeze([]) });
  }
  const parsed = blocks(lines, section, BOUNDARY_HEADING, "Work Boundary Semantics");
  boundedCollection(parsed.values.length, 4_096, "Work Boundary semantic objects");
  const selection = parseMetadata(
    lines,
    { headingLine: section.headingLine, endLine: parsed.values[0]!.headingLine },
    BOUNDARY_SELECTION_RULES,
    "Work Boundary selection",
    false,
  );
  const proposal = asEnum(one(selection, "Kind"), "Reconnaissance proposal", [
    "work-boundary", "preparation-condition", "split-recommended", "no-product",
  ] as const);
  if (proposal !== "work-boundary") {
    invalid("semantic", "work-boundary-correspondence", "Only a work-boundary proposal can carry Work Boundary semantic objects");
  }
  if (many(selection, "Capability profile").length !== 1 || many(selection, "Projection profile").length !== 1) {
    invalid("semantic", "work-boundary-selection", "A work-boundary proposal requires one capability and one Projection profile");
  }
  const objects = sortedLocalValues(parsed.values.map((block): ParsedBoundaryObject => {
    const objectKind = asEnum(block.captures.objectKind ?? block.captures.singletonKind!, "Work Boundary object kind", [
      "Objective", "Mandate", "Effect", "Risk", "Obligation", "Artifact", "Check", "Proposition",
    ] as const);
    const rules = objectKind === "Mandate" ? MANDATE_RULES
      : objectKind === "Effect" ? EFFECT_RULES
        : objectKind === "Risk" ? RISK_RULES
          : objectKind === "Obligation" ? OBLIGATION_RULES
            : objectKind === "Artifact" ? ARTIFACT_RULES
              : objectKind === "Check" ? CHECK_RULES
                : objectKind === "Proposition" ? PROPOSITION_RULES
                  : Object.freeze([]);
    const metadata = parseMetadata(lines, block, rules, `${objectKind} ${block.localId}`, true);
    return Object.freeze({
      localId: block.localId,
      anchor: block.localId,
      digest: block.digest,
      kind: objectKind === "Effect" ? "effect" : "proposal",
      objectKind,
      fields: metadata.fields,
      narrative: metadata.narrative!,
    });
  }));
  const counts = new Map<string, number>();
  for (const object of objects) counts.set(object.objectKind, (counts.get(object.objectKind) ?? 0) + 1);
  if (counts.get("Objective") !== 1 || counts.get("Mandate") !== 1) {
    invalid("semantic", "work-boundary-cardinality", "Work Boundary semantics require exactly one Objective and one Mandate");
  }
  if ((counts.get("Obligation") ?? 0) === 0 || (counts.get("Artifact") ?? 0) === 0 || (counts.get("Check") ?? 0) === 0 ||
      (counts.get("Proposition") ?? 0) === 0) {
    invalid("semantic", "work-boundary-incomplete", "Work Boundary semantics require an obligation, artifact, Check, and proposition");
  }
  return Object.freeze({ proposal, selection: selection.fields, objects });
}

function parseBuilder(
  lines: readonly string[],
  section: Section,
  disposition: AgentWorkProductDisposition,
): ParsedBuilderProposal {
  const childHeadingCount = lines.slice(section.headingLine + 1, section.endLine)
    .filter((line) => /^### /u.test(line)).length;
  if (childHeadingCount === 0) {
    const selection = parseMetadata(
      lines,
      { headingLine: section.headingLine, endLine: section.endLine },
      BUILDER_SELECTION_RULES,
      "Builder Proposal selection",
      false,
    );
    const proposal = asEnum(one(selection, "Kind"), "Builder proposal", [
      "progress", "ready-to-evaluate", "material-condition", "unable",
    ] as const);
    if (proposal === "material-condition") {
      invalid("semantic", "material-condition-correspondence", "A material-condition proposal requires its exact semantic object");
    }
    if (disposition === "no-product") {
      invalid("semantic", "builder-proposal", "A no-product disposition cannot carry a Builder Proposal");
    }
    return Object.freeze({
      proposal,
      remainingObligationIds: sortedIds(many(selection, "Remaining obligation"), "Remaining obligation"),
      materialCondition: null,
      effects: Object.freeze([]),
    });
  }
  const parsed = blocks(lines, section, BUILDER_HEADING, "Builder Proposal");
  boundedCollection(parsed.values.length, 4_096, "Builder Proposal semantic objects");
  const selection = parseMetadata(
    lines,
    { headingLine: section.headingLine, endLine: parsed.values[0]!.headingLine },
    BUILDER_SELECTION_RULES,
    "Builder Proposal selection",
    false,
  );
  const proposal = asEnum(one(selection, "Kind"), "Builder proposal", [
    "progress", "ready-to-evaluate", "material-condition", "unable",
  ] as const);
  if (disposition === "no-product") invalid("semantic", "builder-proposal", "A no-product disposition cannot carry a Builder Proposal");
  let materialCondition: ParsedMaterialCondition | null = null;
  const effects: ParsedBoundaryObject[] = [];
  for (const raw of parsed.values) {
    const localId = raw.localId;
    if (raw.captures.builderKind === "Material Condition") {
      if (materialCondition !== null) invalid("semantic", "material-condition-cardinality", "Builder Proposal permits at most one Material Condition");
      materialCondition = parseMaterialCondition(lines, raw);
    } else if (raw.captures.builderKind === "Effect") {
      const metadata = parseMetadata(lines, raw, EFFECT_RULES, `Effect ${localId}`, true);
      effects.push(Object.freeze({
        localId,
        anchor: localId,
        digest: raw.digest,
        kind: "effect",
        objectKind: "Effect",
        fields: metadata.fields,
        narrative: metadata.narrative!,
      }));
    } else {
      invalid("template", "builder-item", "Builder Proposal accepts only Material Condition and Effect items");
    }
  }
  if ((proposal === "material-condition") !== (materialCondition !== null)) {
    invalid("semantic", "material-condition-correspondence", "Builder material-condition proposal and semantic object must be present together");
  }
  return Object.freeze({
    proposal,
    remainingObligationIds: sortedIds(many(selection, "Remaining obligation"), "Remaining obligation"),
    materialCondition,
    effects: sortedLocalValues(effects),
  });
}

function parseMaterialCondition(
  lines: readonly string[],
  block: Block,
): ParsedMaterialCondition {
  const metadata = parseMetadata(lines, block, CONDITION_RULES, "Material Condition", true);
  return Object.freeze({
    localId: block.localId,
    anchor: block.localId,
    digest: block.digest,
    kind: "condition",
    conditionClass: asEnum(one(metadata, "Condition class"), "Material Condition class", [
      "meaning-ambiguity", "mandate-falsifier", "scope-change", "effect-change", "risk-change",
      "architecture-conflict", "assurance-conflict", "director-tradeoff", "missing-authority",
      "missing-required-source", "required-capability-unavailable", "projection-closure-exceeded",
      "no-honest-route",
    ] as const),
    statement: metadata.narrative!,
    falsifiedMandateIds: sortedIds(many(metadata, "Falsified mandate"), "Falsified mandate"),
    knowledgeIds: Object.freeze(sortUniqueCodePoints(many(metadata, "Knowledge").map((value, index) =>
      asKnowledgeId(value, `Material Condition Knowledge[${index}]`)))),
    directorJudgmentRequired: true,
  });
}

function parseReview(
  lines: readonly string[],
  section: Section,
  disposition: AgentWorkProductDisposition,
  overallUncertainty: AgentWorkProductUncertainty,
): ParsedReview | null {
  const parsed = blocks(lines, section, REVIEW_HEADING, "Review");
  if (parsed.values.length === 0) {
    if (disposition === "complete" || disposition === "partial") {
      invalid("semantic", "review", "A complete or partial reviewer Work Product requires proposition decisions");
    }
    return null;
  }
  boundedCollection(parsed.values.length, 4_096, "Review decisions");
  if (disposition === "blocked" || disposition === "no-product") {
    invalid("semantic", "review-correspondence", "A blocked or no-product reviewer Work Product cannot carry decisions");
  }
  const review = parseMetadata(
    lines,
    { headingLine: section.headingLine, endLine: parsed.values[0]!.headingLine },
    REVIEW_RULES,
    "Review",
    false,
  );
  let materialCondition: ParsedMaterialCondition | null = null;
  const decisions: ParsedReviewDecision[] = [];
  let mandateApplicability: ParsedApplicability | null = null;
  const baselineApplicability: ParsedApplicability[] = [];
  for (const block of parsed.values) {
    if (block.captures.reviewKind === "Material Condition") {
      if (materialCondition !== null) {
        invalid("semantic", "material-condition-cardinality", "Review permits at most one Material Condition");
      }
      materialCondition = parseMaterialCondition(lines, block);
      continue;
    }
    if (block.captures.reviewKind === "Mandate Applicability" || block.captures.reviewKind === "Baseline Applicability") {
      const baseline = block.captures.reviewKind === "Baseline Applicability";
      const metadata = parseMetadata(lines, block, baseline ? BASELINE_APPLICABILITY_RULES : APPLICABILITY_RULES, block.captures.reviewKind, true);
      const value: ParsedApplicability = Object.freeze({
        localId: block.localId, anchor: block.localId, digest: block.digest, kind: "decision",
        receiptId: baseline ? asId(one(metadata, "Receipt"), "Baseline Receipt") : null,
        disposition: asEnum(one(metadata, "Disposition"), "Integration applicability", baseline
          ? ["applicable", "insufficient", "indeterminate"] as const
          : ["applicable", "requires-readmission", "indeterminate"] as const),
        rationale: metadata.narrative!, citationLocalIds: localIds(many(metadata, "Citation"), "Applicability citations"),
      });
      if (baseline) baselineApplicability.push(value);
      else {
        if (mandateApplicability !== null) invalid("semantic", "review", "Review repeats mandate applicability");
        mandateApplicability = value;
      }
      continue;
    }
    const metadata = parseMetadata(lines, block, REVIEW_DECISION_RULES, `Review Decision ${block.localId}`, true);
    decisions.push(Object.freeze({
      localId: block.localId,
      anchor: block.localId,
      digest: block.digest,
      kind: "decision",
      propositionId: asId(one(metadata, "Proposition"), "Review proposition"),
      disposition: asEnum(one(metadata, "Disposition"), "Review decision disposition", [
        "accepted", "rejected", "indeterminate", "not-applicable",
      ] as const),
      citationLocalIds: localIds(many(metadata, "Citation"), "Review decision citations"),
      rationale: metadata.narrative!,
      uncertainty: asEnum(one(metadata, "Uncertainty"), "Review decision uncertainty", [
        "none", "bounded", "material", "unknown",
      ] as const),
      limitationLocalIds: localIds(many(metadata, "Limitation"), "Review decision limitations"),
    }));
  }
  if (decisions.length === 0) {
    invalid("semantic", "review", "A complete or partial reviewer Work Product requires proposition decisions");
  }
  const sortedDecisions = sortedLocalValues(decisions);
  if (new Set(sortedDecisions.map(({ propositionId }) => propositionId)).size !== sortedDecisions.length) {
    invalid("semantic", "review-duplicate", "Review repeats a proposition decision");
  }
  if (mandateApplicability === null) invalid("semantic", "review", "Review requires one explicit mandate applicability judgment");
  if (new Set(baselineApplicability.map(({ receiptId }) => receiptId)).size !== baselineApplicability.length) {
    invalid("semantic", "review-duplicate", "Review repeats a baseline applicability judgment");
  }
  const mandateExcess = asBoolean(one(review, "Mandate excess"), "Review mandate excess");
  const missingObligationIds = sortedIds(many(review, "Missing obligation"), "Missing obligation");
  const requiresCondition = reviewRequiresMandateResolutionV1({mandateApplicability, baselineApplicability,
    mandateExcess, missingObligationIds, overallUncertainty, judgments:sortedDecisions});
  if (requiresCondition !== (materialCondition !== null)) {
    invalid(
      "semantic",
      "material-condition-correspondence",
      "Material review findings and a proposed Material Condition must be present together",
    );
  }
  return Object.freeze({
    mandateApplicability,
    baselineApplicability: Object.freeze(baselineApplicability.sort((a, b) => compareCodePoints(a.receiptId!, b.receiptId!))),
    mandateExcess,
    missingObligationIds,
    materialCondition,
    decisions: sortedDecisions,
  });
}

const NO_PRODUCT_REASONS = Object.freeze([
  "missing-mandatory-input",
  "conflicting-mandatory-input",
  "inaccessible-required-material",
  "unsupported-capability",
  "context-bound-exceeded",
  "output-bound-exceeded",
  "no-honest-route",
  "other-explicit",
] as const);

function canonicalNarrativeLines(value: string): string[] {
  const result: string[] = [];
  for (const line of value.split("\n")) {
    if (line === "" && result.at(-1) === "") continue;
    result.push(line);
  }
  while (result[0] === "") result.shift();
  while (result.at(-1) === "") result.pop();
  return result;
}

function canonicalMetadataLines(
  fields: Readonly<Record<string, readonly string[]>>,
  rules: readonly MetadataRule[],
): string[] {
  const result: string[] = [];
  for (const rule of rules) {
    const values = fields[rule.label] ?? [];
    const normalized = rule.repeated ? sortUniqueCodePoints(values) : values;
    for (const value of normalized) result.push(`- ${rule.label}: ${value}`);
  }
  return result;
}

function canonicalBlock(
  heading: string,
  fields: Readonly<Record<string, readonly string[]>>,
  rules: readonly MetadataRule[],
  narrative: string | null,
): string[] {
  const metadata = canonicalMetadataLines(fields, rules);
  const result = [heading];
  if (metadata.length > 0) result.push("", ...metadata);
  if (narrative !== null) result.push("", ...canonicalNarrativeLines(narrative));
  return result;
}

function joinedBlocks(values: readonly string[][]): string[] {
  return values.flatMap((value, index) => index === 0 ? value : ["", ...value]);
}

function conditionFields(value: ParsedMaterialCondition): Readonly<Record<string, readonly string[]>> {
  return Object.freeze({
    "Condition class": Object.freeze([value.conditionClass]),
    "Falsified mandate": value.falsifiedMandateIds,
    Knowledge: value.knowledgeIds,
  });
}

function boundaryRules(kind: ParsedBoundaryObject["objectKind"]): readonly MetadataRule[] {
  return kind === "Mandate" ? MANDATE_RULES
    : kind === "Effect" ? EFFECT_RULES
      : kind === "Risk" ? RISK_RULES
        : kind === "Obligation" ? OBLIGATION_RULES
          : kind === "Artifact" ? ARTIFACT_RULES
            : kind === "Check" ? CHECK_RULES
              : kind === "Proposition" ? PROPOSITION_RULES
                : Object.freeze([]);
}

function renderNormalizedAgentWorkProduct(parsed: ParsedAgentWorkProduct): string {
  const sections: Array<Readonly<{ label: string; lines: string[] }>> = [];
  const outcomeFields: Readonly<Record<string, readonly string[]>> = Object.freeze({
    ...(parsed.role === "reconnaissance"
      ? {}
      : { Disposition: Object.freeze([parsed.disposition]) }),
    Uncertainty: Object.freeze([parsed.uncertainty]),
    ...(parsed.noProductReason === null
      ? {}
      : { "No-product reason": Object.freeze([parsed.noProductReason]) }),
  });
  sections.push(Object.freeze({
    label: "Outcome",
    lines: [
      ...canonicalMetadataLines(
        outcomeFields,
        parsed.role === "reconnaissance" ? OUTCOME_RECONNAISSANCE_RULES : OUTCOME_RULES,
      ),
      "",
      ...canonicalNarrativeLines(parsed.summary),
    ],
  }));
  if (parsed.claims.length > 0) {
    sections.push(Object.freeze({
      label: "Claims",
      lines: joinedBlocks(parsed.claims.map((value) => canonicalBlock(
        `### Claim: ${value.localId} {#${value.localId}}`,
        Object.freeze({
          Category: Object.freeze([value.category]),
          State: Object.freeze([value.state]),
          Uncertainty: Object.freeze([value.uncertainty]),
          Knowledge: value.knowledgeIds,
          Evidence: value.evidenceIds,
          Path: value.paths,
        }),
        CLAIM_RULES,
        value.statement,
      ))),
    }));
  }
  if (parsed.citations.length > 0) {
    sections.push(Object.freeze({
      label: "Citations",
      lines: joinedBlocks(parsed.citations.map((value) => canonicalBlock(
        `### Citation: ${value.localId} {#${value.localId}}`,
        Object.freeze({
          Subject: Object.freeze([value.subjectId]),
          Supports: Object.freeze(sortUniqueCodePoints(value.supportsClaimLocalIds)),
        }),
        CITATION_RULES,
        null,
      ))),
    }));
  }
  if (parsed.limitations.length > 0) {
    sections.push(Object.freeze({
      label: "Limitations",
      lines: joinedBlocks(parsed.limitations.map((value) => canonicalBlock(
        `### Limitation: ${value.localId} {#${value.localId}}`,
        Object.freeze({}),
        Object.freeze([]),
        value.statement,
      ))),
    }));
  }
  if (parsed.role === "reconnaissance") {
    const value = parsed.reconnaissance!;
    const selection = value.selection ?? Object.freeze({ Kind: Object.freeze([value.proposal]) });
    const order = new Map([
      ["Objective", 0], ["Mandate", 1], ["Effect", 2], ["Risk", 3],
      ["Obligation", 4], ["Artifact", 5], ["Check", 6], ["Proposition", 7],
    ]);
    const objects = [...value.objects].sort((left, right) =>
      (order.get(left.objectKind)! - order.get(right.objectKind)!) || compareCodePoints(left.localId, right.localId));
    const objectLines = joinedBlocks(objects.map((object) => canonicalBlock(
      object.objectKind === "Objective" || object.objectKind === "Mandate"
        ? `### ${object.objectKind} {#${object.localId}}`
        : `### ${object.objectKind}: ${object.localId} {#${object.localId}}`,
      object.fields,
      boundaryRules(object.objectKind),
      object.narrative,
    )));
    sections.push(Object.freeze({
      label: "Proposal",
      lines: [
        ...canonicalMetadataLines(selection, BOUNDARY_SELECTION_RULES),
        ...(objectLines.length === 0 ? [] : ["", ...objectLines]),
      ],
    }));
  } else if (parsed.role === "builder" && parsed.builder!.proposal !== "no-product") {
    const value = parsed.builder!;
    const blocks: string[][] = [];
    if (value.materialCondition !== null) {
      blocks.push(canonicalBlock(
        `### Material Condition: ${value.materialCondition.localId} {#${value.materialCondition.localId}}`,
        conditionFields(value.materialCondition),
        CONDITION_RULES,
        value.materialCondition.statement,
      ));
    }
    for (const effect of value.effects) {
      blocks.push(canonicalBlock(
        `### Effect: ${effect.localId} {#${effect.localId}}`,
        effect.fields,
        EFFECT_RULES,
        effect.narrative,
      ));
    }
    sections.push(Object.freeze({
      label: "Proposal",
      lines: [
        ...canonicalMetadataLines(Object.freeze({
          Kind: Object.freeze([value.proposal]),
          "Remaining obligation": value.remainingObligationIds,
        }), BUILDER_SELECTION_RULES),
        ...(blocks.length === 0 ? [] : ["", ...joinedBlocks(blocks)]),
      ],
    }));
  } else if (parsed.role === "reviewer" && parsed.review !== null) {
    const value = parsed.review;
    const blocks: string[][] = [];
    if (value.materialCondition !== null) {
      blocks.push(canonicalBlock(
        `### Material Condition: ${value.materialCondition.localId} {#${value.materialCondition.localId}}`,
        conditionFields(value.materialCondition),
        CONDITION_RULES,
        value.materialCondition.statement,
      ));
    }
    for (const applicability of [value.mandateApplicability, ...value.baselineApplicability]) {
      const baseline = applicability.receiptId !== null;
      blocks.push(canonicalBlock(
        `### ${baseline ? "Baseline" : "Mandate"} Applicability: ${applicability.localId} {#${applicability.localId}}`,
        Object.freeze({ ...(baseline ? { Receipt: Object.freeze([applicability.receiptId!]) } : {}),
          Disposition: Object.freeze([applicability.disposition]), Citation: applicability.citationLocalIds }),
        baseline ? BASELINE_APPLICABILITY_RULES : APPLICABILITY_RULES, applicability.rationale,
      ));
    }
    for (const decision of value.decisions) {
      blocks.push(canonicalBlock(
        `### Decision: ${decision.localId} {#${decision.localId}}`,
        Object.freeze({
          Proposition: Object.freeze([decision.propositionId]),
          Disposition: Object.freeze([decision.disposition]),
          Citation: Object.freeze(sortUniqueCodePoints(decision.citationLocalIds)),
          Uncertainty: Object.freeze([decision.uncertainty]),
          Limitation: Object.freeze(sortUniqueCodePoints(decision.limitationLocalIds)),
        }),
        REVIEW_DECISION_RULES,
        decision.rationale,
      ));
    }
    sections.push(Object.freeze({
      label: "Review",
      lines: [
        ...canonicalMetadataLines(Object.freeze({
          "Mandate excess": Object.freeze([String(value.mandateExcess)]),
          "Missing obligation": value.missingObligationIds,
        }), REVIEW_RULES),
        ...(blocks.length === 0 ? [] : ["", ...joinedBlocks(blocks)]),
      ],
    }));
  }
  const lines = [`# ${ROLE_PROFILES[parsed.role].title}`];
  for (const section of sections) lines.push("", `## ${section.label}`, "", ...section.lines);
  return `${lines.join("\n")}\n`;
}

export function parseAgentWorkProductSemanticMarkdown(
  role: AgentWorkProductRole,
  semanticMarkdown: string,
): ParsedAgentWorkProduct {
  const observedLines = sourceLines(semanticMarkdown);
  const draftLines = normalizeDraftAnchors(observedLines);
  const provisional = parseNormalizedAgentWorkProduct(
    role,
    draftLines,
    draftLines.join("\n"),
  );
  const normalizedMarkdown = renderNormalizedAgentWorkProduct(provisional);
  return parseNormalizedAgentWorkProduct(role, sourceLines(normalizedMarkdown), normalizedMarkdown);
}

function parseNormalizedAgentWorkProduct(
  role: AgentWorkProductRole,
  lines: readonly string[],
  normalizedMarkdown: string,
): ParsedAgentWorkProduct {
  const sections = sectionsFor(role, lines);
  const required = (label: string): Section => sections.get(label) ??
    invalid("template", "section", `Agent Work Product is missing ${label}`);
  const reconnaissance = role === "reconnaissance"
    ? parseBoundary(lines, required("Proposal"))
    : null;
  const outcomeSection = required("Outcome");
  const outcome = parseMetadata(
    lines,
    { headingLine: outcomeSection.headingLine, endLine: outcomeSection.endLine },
    role === "reconnaissance" ? OUTCOME_RECONNAISSANCE_RULES : OUTCOME_RULES,
    "Outcome",
    true,
  );
  const disposition = role === "reconnaissance"
    ? ({
        "work-boundary": "complete",
        "preparation-condition": "blocked",
        "split-recommended": "partial",
        "no-product": "no-product",
      } as const)[reconnaissance!.proposal]
    : asEnum(one(outcome, "Disposition"), `${role} disposition`, [
        "complete", "partial", "blocked", "no-product",
      ] as const);
  const uncertainty = asEnum(one(outcome, "Uncertainty"), "Work Product uncertainty", [
    "none", "bounded", "material", "unknown",
  ] as const);
  const noProductValues = many(outcome, "No-product reason");
  const noProductReason = noProductValues.length === 0
    ? disposition === "no-product"
      ? invalid("semantic", "no-product-reason", "A no-product disposition requires an exact No-product reason")
      : null
    : disposition === "no-product"
      ? asEnum(noProductValues[0]!, "No-product reason", NO_PRODUCT_REASONS)
      : invalid("semantic", "no-product-reason", "Only no-product can carry a No-product reason");
  const claimsSection = sections.get("Claims");
  const citationsSection = sections.get("Citations");
  const limitationsSection = sections.get("Limitations");
  const roleSection = sections.get(ROLE_PROFILES[role].roleSection);
  const builder = role !== "builder"
    ? null
    : disposition === "no-product"
      ? roleSection === undefined
        ? Object.freeze({
            proposal: "no-product" as const,
            remainingObligationIds: Object.freeze([]),
            materialCondition: null,
            effects: Object.freeze([]),
          })
        : invalid("semantic", "builder-proposal", "A no-product builder Work Product must omit Proposal")
      : parseBuilder(lines, roleSection ?? required("Proposal"), disposition);
  const review = role !== "reviewer"
    ? null
    : roleSection === undefined
      ? disposition === "blocked" || disposition === "no-product"
        ? null
        : invalid("semantic", "review", "A complete or partial reviewer Work Product requires Review")
      : parseReview(lines, roleSection, disposition, uncertainty);
  const parsed = Object.freeze({
    role,
    profileId: profileId(role),
    normalizedMarkdown,
    disposition,
    summary: outcome.narrative!,
    summaryFragmentDigest: sectionDigest(lines, outcomeSection),
    uncertainty,
    uncertaintyFragmentDigest: sectionDigest(lines, outcomeSection),
    claims: claimsSection === undefined ? Object.freeze([]) : parseClaims(lines, claimsSection),
    citations: citationsSection === undefined ? Object.freeze([]) : parseCitations(lines, citationsSection),
    limitations: limitationsSection === undefined ? Object.freeze([]) : parseLimitations(lines, limitationsSection),
    noProductReason,
    reconnaissance,
    builder,
    review,
  });
  return parsed;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== "object") runtimeFailure("attempt", `${label} is not one object`);
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") runtimeFailure("attempt", `${label} is not one string`);
  return value;
}

function digestValue(value: unknown, label: string): Sha256 {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) runtimeFailure("attempt", `${label} is not one SHA-256 digest`);
  return value as Sha256;
}

function nullableDigest(value: unknown, label: string): Sha256 | null {
  return value === null ? null : digestValue(value, label);
}

function attemptBindings(attempt: ControlRecordRevision): Readonly<{
  activityId: string;
  invocationId: string;
  role: AgentWorkProductRole;
  roleSubjectDigest: Sha256;
  projectionDigest: Sha256;
  boundary: ControlRecordRelationshipTarget | null;
  candidate: ControlRecordRelationshipTarget | null;
  evidenceSetDigest: Sha256 | null;
  propositionSetDigest: Sha256 | null;
  citationRegistryDigest: Sha256;
  templateDigest: Sha256;
  parserProfileId: string;
  parserProfileDigest: Sha256;
  compilerProfileId: string;
  compilerProfileDigest: Sha256;
}> {
  if (attempt.recordKind !== "agent-attempt" || attempt.revision !== 1) {
    runtimeFailure("attempt", "Agent Work Product compiler requires one exact retained Agent Attempt revision");
  }
  const payload = object(attempt.payload, "Agent Attempt payload");
  if (payload.schema !== "lifecycle.agent-attempt-payload.v3") runtimeFailure("attempt", "Agent Attempt payload schema is not current");
  const role = asEnum(stringValue(payload.role, "Agent Attempt role"), "Agent Attempt role", [
    "reconnaissance", "builder", "reviewer",
  ] as const);
  const projection = object(payload.projection, "Agent Attempt Projection");
  const authoring = object(payload.authoring, "Agent Attempt authoring");
  const input = object(payload.input, "Agent Attempt input");
  const relationship = (relation: string): ControlRecordRelationshipTarget | null => {
    const matches = attempt.relationships.filter((value) => value.relation === relation);
    if (matches.length > 1) runtimeFailure("attempt", `Agent Attempt repeats ${relation}`);
    return matches[0]?.target ?? null;
  };
  return Object.freeze({
    activityId: stringValue(payload.activityId, "Agent Attempt activity identity"),
    invocationId: stringValue(payload.invocationId, "Agent Attempt invocation identity"),
    role,
    roleSubjectDigest: digestValue(payload.roleSubjectDigest, "Agent Attempt role-subject digest"),
    projectionDigest: digestValue(projection.digest, "Agent Attempt Projection digest"),
    boundary: relationship("uses-boundary"),
    candidate: relationship("uses-candidate"),
    evidenceSetDigest: nullableDigest(input.evidenceSetDigest, "Agent Attempt Evidence-set digest"),
    propositionSetDigest: nullableDigest(input.propositionSetDigest, "Agent Attempt proposition-set digest"),
    citationRegistryDigest: digestValue(input.citationRegistryDigest, "Agent Attempt citation-registry digest"),
    templateDigest: digestValue(authoring.templateDigest, "Agent Attempt template digest"),
    parserProfileId: stringValue(authoring.parserProfileId, "Agent Attempt parser profile"),
    parserProfileDigest: digestValue(authoring.parserProfileDigest, "Agent Attempt parser profile digest"),
    compilerProfileId: stringValue(authoring.compilerProfileId, "Agent Attempt compiler profile"),
    compilerProfileDigest: digestValue(authoring.compilerProfileDigest, "Agent Attempt compiler profile digest"),
  });
}

const PARSER_PROFILE_DIGEST = digestCanonical(Object.freeze({
  id: FOUNDATION_AGENT_WORK_PRODUCT_PARSER_PROFILE_ID,
  version: 4,
  input: "governed-body-only-markdown",
  roles: Object.freeze(["builder", "reconnaissance", "reviewer"]),
  maximumBytes: 1024 * 1024,
  maximumLines: 32_768,
  maximumHeadings: 16_384,
  maximumHeadingBytes: 4_096,
  setOrdering: "unicode-code-point",
  exactSetDuplicates: "collapsed",
  sectionOrder: "nonsemantic",
  metadataOrder: "nonsemantic",
  blankLines: "nonsemantic",
  anchors: "runtime-injected",
}));
const COMPILER_PROFILE_DIGEST = digestCanonical(Object.freeze({
  id: FOUNDATION_AGENT_WORK_PRODUCT_COMPILER_PROFILE_ID,
  version: 4,
  output: "lifecycle.agent-work-product-payload.v5",
  identity: "canonical-semantic-value",
  ordering: "unicode-code-point",
  knowledgeCitations: "frozen-enduring-identity-and-exact-occurrence",
}));

export function agentWorkProductParserProfileDigest(): Sha256 {
  return PARSER_PROFILE_DIGEST;
}

export function agentWorkProductCompilerProfileDigest(): Sha256 {
  return COMPILER_PROFILE_DIGEST;
}

function semanticId(prefix: string, value: unknown): string {
  return `${prefix}:${digestCanonical(value).slice("sha256:".length)}`;
}

function exactCitationKnowledgeIdentity(value: unknown, kind: string, label: string): string | null {
  if (kind !== "knowledge") {
    if (value !== null) runtimeFailure("citation-registry", `${label} cannot map non-Knowledge to a Knowledge identity`);
    return null;
  }
  try {
    return knowledgeId(value, label);
  } catch (error) {
    runtimeFailure("citation-registry", `${label} must bind one enduring Knowledge identity`, { causeCode: causeCode(error) });
  }
}

function exactRegistry(
  entries: readonly AgentWorkProductCitationRegistryEntry[],
  expectedDigest: Sha256,
): readonly AgentWorkProductCitationRegistryEntry[] {
  if (!Array.isArray(entries)) runtimeFailure("citation-registry", "Attempt citation registry is not one entry array");
  const result = entries.map((entry, index): AgentWorkProductCitationRegistryEntry => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      runtimeFailure("citation-registry", `Attempt citation registry entry ${index} is not one exact object`);
    }
    const raw = entry as Readonly<Record<string, unknown>>;
    exactRuntimeKeys(raw, ["id", "kind", "knowledgeIdentity", "digest", "locator", "authorityClass"], `Attempt citation registry entry ${index}`);
    const kind = raw.kind;
    if (typeof kind !== "string" || !CITATION_KINDS.includes(kind as typeof CITATION_KINDS[number])) {
      runtimeFailure("citation-registry", `Attempt citation registry entry ${index} has an unsupported kind`);
    }
    const authorityClass = raw.authorityClass;
    const authorityClasses = [
      "repository-authored", "runtime-observed", "runtime-derived", "agent-proposed",
      "director-supplied", "director-authenticated",
    ] as const;
    if (typeof authorityClass !== "string" || !authorityClasses.includes(authorityClass as typeof authorityClasses[number])) {
      runtimeFailure("citation-registry", `Attempt citation registry entry ${index} has an unsupported authority class`);
    }
    return Object.freeze({
      id: runtimeId(raw.id, `Citation registry[${index}] identity`),
      kind: kind as AgentWorkProductCitationRegistryEntry["kind"],
      knowledgeIdentity: exactCitationKnowledgeIdentity(raw.knowledgeIdentity, kind, `Citation registry[${index}] Knowledge identity`),
      digest: digestValue(raw.digest, `Citation registry[${index}] digest`),
      locator: runtimeLocator(raw.locator, `Citation registry[${index}] locator`),
      authorityClass: authorityClass as AgentWorkProductCitationRegistryEntry["authorityClass"],
    });
  }).sort((left, right) => compareCodePoints(left.id, right.id));
  if (new Set(result.map(({ id }) => id)).size !== result.length) runtimeFailure("citation-registry", "Attempt citation registry repeats an identity");
  const knowledgeDigests = new Map<string, Set<Sha256>>();
  for (const entry of result) {
    if (entry.knowledgeIdentity === null) continue;
    const digests = knowledgeDigests.get(entry.knowledgeIdentity) ?? new Set<Sha256>();
    digests.add(entry.digest);
    knowledgeDigests.set(entry.knowledgeIdentity, digests);
  }
  for (const entry of result) {
    if (entry.id === entry.knowledgeIdentity && knowledgeDigests.get(entry.knowledgeIdentity)!.size !== 1) {
      runtimeFailure("citation-registry", "Attempt citation registry gives an ambiguous Knowledge identity an unqualified alias");
    }
  }
  const subject = Object.freeze({
    schema: "lifecycle.attempt-citation-registry.v3",
    items: Object.freeze(result),
  });
  if (digestCanonical(subject) !== expectedDigest) runtimeFailure("citation-registry", "Attempt citation registry does not reproduce its frozen digest");
  return Object.freeze(result);
}

function exactPropositions(
  value: AgentWorkProductPropositionSet | null | undefined,
  expectedDigest: Sha256 | null,
): readonly string[] {
  if (expectedDigest === null) {
    if (value !== undefined && value !== null) runtimeFailure("proposition-set", "Non-reviewer Attempt cannot carry a proposition set");
    return Object.freeze([]);
  }
  if (
    value === undefined ||
    value === null ||
    typeof value !== "object" ||
    value.schema !== "lifecycle.proposition-set.v3" ||
    !Array.isArray(value.propositions)
  ) {
    runtimeFailure("proposition-set", "Reviewer compilation requires its exact frozen proposition set");
  }
  if (value.propositions.length > 4_096) {
    runtimeFailure("proposition-set", "Reviewer proposition set exceeds its 4096-item runtime bound");
  }
  const exact = value.propositions.map((proposition, index) => {
    if (proposition === null || typeof proposition !== "object" || Array.isArray(proposition)) {
      runtimeFailure("proposition-set", `Reviewer proposition ${index} is not one exact object`);
    }
    return Object.freeze({
      ...proposition,
      id: runtimeId(proposition.id, `Proposition set[${index}] identity`),
    });
  });
  const propositions = exact.sort((left, right) => compareCodePoints(left.id, right.id));
  const ids = propositions.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) runtimeFailure("proposition-set", "Reviewer proposition set repeats an identity");
  const subject = Object.freeze({ schema: value.schema, propositions: Object.freeze(propositions) });
  if (digestCanonical(subject) !== expectedDigest) runtimeFailure("proposition-set", "Reviewer proposition set does not reproduce its frozen digest");
  return Object.freeze(ids);
}

type InstalledAuthoringBindings = Readonly<{
  role: AgentWorkProductRole;
  templateDigest: Sha256;
  parserProfileId: string;
  parserProfileDigest: Sha256;
  compilerProfileId: string;
  compilerProfileDigest: Sha256;
}>;

function runtimeRole(value: unknown, label: string): AgentWorkProductRole {
  if (value !== "reconnaissance" && value !== "builder" && value !== "reviewer") {
    runtimeFailure("context-invalid", `${label} is not one installed Agent Work Product role`);
  }
  return value;
}

function assertInstalledAuthoringBindings(bindings: InstalledAuthoringBindings): void {
  if (
    renderAgentWorkProductTemplate(bindings.role).digest !== bindings.templateDigest ||
    bindings.parserProfileId !== FOUNDATION_AGENT_WORK_PRODUCT_PARSER_PROFILE_ID ||
    bindings.parserProfileDigest !== PARSER_PROFILE_DIGEST ||
    bindings.compilerProfileId !== FOUNDATION_AGENT_WORK_PRODUCT_COMPILER_PROFILE_ID ||
    bindings.compilerProfileDigest !== COMPILER_PROFILE_DIGEST
  ) {
    runtimeFailure("profile", "Semantic validation does not bind the exact installed authoring profiles and template");
  }
}

type AgentWorkProductValidationBasisSubject = Omit<AgentWorkProductValidationBasis, "digest">;

function validationBasisSubject(
  value: AgentWorkProductValidationBasisSubject,
): AgentWorkProductValidationBasisSubject {
  return Object.freeze({
    schema: value.schema,
    role: value.role,
    bodyProfileId: value.bodyProfileId,
    templateDigest: value.templateDigest,
    parserProfileId: value.parserProfileId,
    parserProfileDigest: value.parserProfileDigest,
    compilerProfileId: value.compilerProfileId,
    compilerProfileDigest: value.compilerProfileDigest,
    citationRegistryDigest: value.citationRegistryDigest,
    citationFacts: Object.freeze(value.citationFacts.map((entry) => Object.freeze({
      id: entry.id,
      kind: entry.kind,
      knowledgeIdentity: entry.knowledgeIdentity,
    }))),
    propositionSetDigest: value.propositionSetDigest,
    propositionIds: Object.freeze([...value.propositionIds]),
  });
}

/**
 * Compile the full frozen Attempt inputs into the compact durable basis used by
 * the Runtime's final post-Containment validation. Full registry and
 * proposition values are verified here; only the facts needed by semantic
 * compilation cross into the Provider Operation support envelope.
 */
export function createAgentWorkProductValidationBasis(
  input: AgentWorkProductValidationBasisInput,
): AgentWorkProductValidationBasis {
  const role = runtimeRole(input.role, "Semantic validation role");
  const bindings = Object.freeze({
    role,
    templateDigest: digestValue(input.templateDigest, "Semantic validation template digest"),
    parserProfileId: stringValue(input.parserProfileId, "Semantic validation parser profile"),
    parserProfileDigest: digestValue(input.parserProfileDigest, "Semantic validation parser profile digest"),
    compilerProfileId: stringValue(input.compilerProfileId, "Semantic validation compiler profile"),
    compilerProfileDigest: digestValue(input.compilerProfileDigest, "Semantic validation compiler profile digest"),
  });
  assertInstalledAuthoringBindings(bindings);
  const citationRegistryDigest = digestValue(
    input.citationRegistryDigest,
    "Semantic validation citation-registry digest",
  );
  const registry = exactRegistry(input.citationRegistry, citationRegistryDigest);
  const propositionSetDigest = nullableDigest(
    input.propositionSetDigest,
    "Semantic validation proposition-set digest",
  );
  const propositionIds = exactPropositions(input.propositionSet, propositionSetDigest);
  const subject = validationBasisSubject(Object.freeze({
    schema: FOUNDATION_AGENT_WORK_PRODUCT_VALIDATION_BASIS_SCHEMA,
    role,
    bodyProfileId: profileId(role),
    templateDigest: bindings.templateDigest,
    parserProfileId: FOUNDATION_AGENT_WORK_PRODUCT_PARSER_PROFILE_ID,
    parserProfileDigest: PARSER_PROFILE_DIGEST,
    compilerProfileId: FOUNDATION_AGENT_WORK_PRODUCT_COMPILER_PROFILE_ID,
    compilerProfileDigest: COMPILER_PROFILE_DIGEST,
    citationRegistryDigest,
    citationFacts: Object.freeze(registry.map(({ id, kind, knowledgeIdentity }) => Object.freeze({ id, kind, knowledgeIdentity }))),
    propositionSetDigest,
    propositionIds,
  }));
  return Object.freeze({ ...subject, digest: digestCanonical(subject) });
}

function exactRuntimeKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    runtimeFailure("validation-basis", `${label} does not have its exact closed shape`);
  }
}

export function parseAgentWorkProductValidationBasis(value: unknown): AgentWorkProductValidationBasis {
  const raw = object(value, "Semantic validation basis");
  exactRuntimeKeys(raw, [
    "schema", "role", "bodyProfileId", "templateDigest", "parserProfileId",
    "parserProfileDigest", "compilerProfileId", "compilerProfileDigest",
    "citationRegistryDigest", "citationFacts", "propositionSetDigest",
    "propositionIds", "digest",
  ], "Semantic validation basis");
  if (raw.schema !== FOUNDATION_AGENT_WORK_PRODUCT_VALIDATION_BASIS_SCHEMA) {
    runtimeFailure("validation-basis", "Semantic validation basis schema is not current");
  }
  const role = runtimeRole(raw.role, "Semantic validation basis role");
  const citationValues = raw.citationFacts;
  if (!Array.isArray(citationValues) || citationValues.length > 16_384) {
    runtimeFailure("validation-basis", "Semantic validation citation facts exceed their bounded array domain");
  }
  const citationFacts = citationValues.map((value, index): AgentWorkProductValidationCitationFact => {
    const entry = object(value, `Semantic validation citation fact ${index}`);
    exactRuntimeKeys(entry, ["id", "kind", "knowledgeIdentity"], `Semantic validation citation fact ${index}`);
    const kind = entry.kind;
    if (typeof kind !== "string" || !CITATION_KINDS.includes(kind as typeof CITATION_KINDS[number])) {
      runtimeFailure("validation-basis", `Semantic validation citation fact ${index} has an unsupported kind`);
    }
    return Object.freeze({
      id: runtimeId(entry.id, `Semantic validation citation fact ${index} identity`),
      kind: kind as AgentWorkProductCitationRegistryEntry["kind"],
      knowledgeIdentity: exactCitationKnowledgeIdentity(entry.knowledgeIdentity, kind, `Semantic validation citation fact ${index} Knowledge identity`),
    });
  });
  const sortedCitationFacts = [...citationFacts].sort((left, right) => compareCodePoints(left.id, right.id));
  if (
    new Set(citationFacts.map(({ id }) => id)).size !== citationFacts.length ||
    citationFacts.some(({ id }, index) => id !== sortedCitationFacts[index]!.id)
  ) {
    runtimeFailure("validation-basis", "Semantic validation citation facts are not exact sorted unique identities");
  }
  const propositionValues = raw.propositionIds;
  if (!Array.isArray(propositionValues) || propositionValues.length > 4_096) {
    runtimeFailure("validation-basis", "Semantic validation proposition identities exceed their bounded array domain");
  }
  const propositionIds = propositionValues.map((value, index) =>
    runtimeId(value, `Semantic validation proposition ${index} identity`));
  const sortedPropositionIds = [...propositionIds].sort(compareCodePoints);
  if (
    new Set(propositionIds).size !== propositionIds.length ||
    propositionIds.some((id, index) => id !== sortedPropositionIds[index])
  ) {
    runtimeFailure("validation-basis", "Semantic validation proposition identities are not sorted and unique");
  }
  const propositionSetDigest = nullableDigest(
    raw.propositionSetDigest,
    "Semantic validation basis proposition-set digest",
  );
  if (propositionSetDigest === null && propositionIds.length !== 0) {
    runtimeFailure("validation-basis", "Semantic validation proposition binding is internally inconsistent");
  }
  const subject = validationBasisSubject(Object.freeze({
    schema: FOUNDATION_AGENT_WORK_PRODUCT_VALIDATION_BASIS_SCHEMA,
    role,
    bodyProfileId: stringValue(raw.bodyProfileId, "Semantic validation body profile"),
    templateDigest: digestValue(raw.templateDigest, "Semantic validation basis template digest"),
    parserProfileId: stringValue(raw.parserProfileId, "Semantic validation basis parser profile") as typeof FOUNDATION_AGENT_WORK_PRODUCT_PARSER_PROFILE_ID,
    parserProfileDigest: digestValue(raw.parserProfileDigest, "Semantic validation basis parser profile digest"),
    compilerProfileId: stringValue(raw.compilerProfileId, "Semantic validation basis compiler profile") as typeof FOUNDATION_AGENT_WORK_PRODUCT_COMPILER_PROFILE_ID,
    compilerProfileDigest: digestValue(raw.compilerProfileDigest, "Semantic validation basis compiler profile digest"),
    citationRegistryDigest: digestValue(raw.citationRegistryDigest, "Semantic validation basis citation-registry digest"),
    citationFacts: Object.freeze(citationFacts),
    propositionSetDigest,
    propositionIds: Object.freeze(propositionIds),
  }));
  assertInstalledAuthoringBindings(subject);
  if (subject.bodyProfileId !== profileId(role)) {
    runtimeFailure("validation-basis", "Semantic validation body profile does not match its role");
  }
  const digest = digestValue(raw.digest, "Semantic validation basis digest");
  if (digestCanonical(subject) !== digest) {
    runtimeFailure("validation-basis", "Semantic validation basis does not reproduce its durable digest");
  }
  return Object.freeze({ ...subject, digest });
}

type CompiledFragment = Readonly<{ id: string; kind: FragmentKind; anchor: string; digest: Sha256 }>;
type IdMaps = Readonly<{
  claims: ReadonlyMap<string, string>;
  limitations: ReadonlyMap<string, string>;
  semantic: ReadonlyMap<string, string>;
  definitionKinds: ReadonlyMap<string, FragmentKind>;
}>;

function assignIntrinsicIds(parsed: ParsedAgentWorkProduct): IdMaps {
  const assign = <T extends Readonly<{ localId: string }>>(
    values: readonly T[],
    prefix: string,
    subject: (value: T) => unknown,
  ): Map<string, string> => {
    const byLocal = new Map<string, string>();
    const byId = new Set<string>();
    for (const value of values) {
      const normalized = subject(value);
      const id = semanticId(prefix, normalized);
      if (byId.has(id)) invalid("semantic", "duplicate-semantic-object", `${prefix} semantic objects are exact duplicates`);
      byId.add(id);
      byLocal.set(value.localId, id);
    }
    return byLocal;
  };
  const claims = assign(parsed.claims, "claim", (value) => Object.freeze({
    category: value.category,
    state: value.state,
    statement: value.statement,
    knowledgeIds: value.knowledgeIds,
    evidenceIds: value.evidenceIds,
    paths: value.paths,
    uncertainty: value.uncertainty,
  }));
  const limitations = assign(parsed.limitations, "limitation", (value) => Object.freeze({ statement: value.statement }));
  const semanticValues = [
    ...(parsed.reconnaissance?.objects ?? []),
    ...(parsed.builder?.materialCondition === null || parsed.builder === null ? [] : [parsed.builder.materialCondition]),
    ...(parsed.builder?.effects ?? []),
    ...(parsed.review?.materialCondition === null || parsed.review === null ? [] : [parsed.review.materialCondition]),
    ...(parsed.review?.decisions ?? []),
    ...(parsed.review === null ? [] : [parsed.review.mandateApplicability, ...parsed.review.baselineApplicability]),
  ];
  const semantic = assign(semanticValues, "semantic", (value) => {
    if ("objectKind" in value) return Object.freeze({ objectKind: value.objectKind, fields: value.fields, narrative: value.narrative });
    if (value.kind === "condition") return Object.freeze({
      conditionClass: value.conditionClass,
      statement: value.statement,
      falsifiedMandateIds: value.falsifiedMandateIds,
      knowledgeIds: value.knowledgeIds,
      directorJudgmentRequired: value.directorJudgmentRequired,
    });
    if ("receiptId" in value) return Object.freeze({ receiptId: value.receiptId, disposition: value.disposition, rationale: value.rationale });
    return Object.freeze({
      propositionId: value.propositionId,
      disposition: value.disposition,
      rationale: value.rationale,
      uncertainty: value.uncertainty,
    });
  });
  const definitionKinds = new Map<string, FragmentKind>([
    ...parsed.claims, ...parsed.citations, ...parsed.limitations, ...semanticValues,
  ].map((value) => [value.localId, value.kind]));
  return Object.freeze({ claims, limitations, semantic, definitionKinds });
}

type LocalReferenceKind = "claim" | "citation" | "limitation";

function resolveLocal(values: readonly string[], map: ReadonlyMap<string, string>, label: string,
  reference?: Readonly<{ expectedKind: LocalReferenceKind; definitionKinds: ReadonlyMap<string, FragmentKind> }>,
): readonly string[] {
  return Object.freeze(sortUniqueCodePoints(values.map((value) => map.get(value) ??
    invalid("semantic", "local-reference", `${label} names absent local handle ${value}`, reference === undefined ? {} : {
      localHandle: value,
      expectedKind: reference.expectedKind,
      actualKind: reference.definitionKinds.get(value) ?? "absent",
    }))));
}

function citedKnowledgeIdentities(
  citationIds: ReadonlySet<string>,
  registry: ReadonlyMap<string, AgentWorkProductValidationCitationFact>,
): ReadonlySet<string> {
  const identities = new Set<string>();
  for (const citationId of citationIds) {
    const identity = registry.get(citationId)?.knowledgeIdentity;
    if (identity !== undefined && identity !== null) identities.add(identity);
  }
  return identities;
}

function compileBoundary(
  parsed: NonNullable<ParsedAgentWorkProduct["reconnaissance"]>,
  claims: readonly ParsedClaim[],
  ids: IdMaps,
  registry: ReadonlyMap<string, AgentWorkProductValidationCitationFact>,
  citedSubjectIds: ReadonlySet<string>,
): ControlJsonObject {
  if (parsed.selection === null) {
    const conditionIds = parsed.proposal === "no-product"
      ? Object.freeze([])
      : Object.freeze(sortUniqueCodePoints(claims
          .filter(({ category }) => category === "diagnosis" || category === "uncertainty" || category === "limitation")
          .map(({ localId }) => ids.claims.get(localId)!)));
    const decisionIds = parsed.proposal === "no-product"
      ? Object.freeze([])
      : Object.freeze(sortUniqueCodePoints(claims
          .filter(({ category }) => category === "route")
          .map(({ localId }) => ids.claims.get(localId)!)));
    if (parsed.proposal === "preparation-condition" && conditionIds.length === 0) {
      invalid("semantic", "preparation-condition", "A preparation-condition proposal requires one typed diagnosis, uncertainty, or limitation Claim");
    }
    if (parsed.proposal === "split-recommended" && decisionIds.length === 0) {
      invalid("semantic", "split-recommendation", "A split-recommended proposal requires one typed route Claim");
    }
    return Object.freeze({
      role: "reconnaissance",
      proposal: parsed.proposal,
      conditionIds,
      decisionIds,
      effectIds: Object.freeze([]),
      workBoundary: null,
    });
  }
  const group = (kind: ParsedBoundaryObject["objectKind"]): ParsedBoundaryObject[] =>
    parsed.objects.filter((value) => value.objectKind === kind);
  const objectId = (value: ParsedBoundaryObject): string => ids.semantic.get(value.localId)!;
  const localObjects = new Map(parsed.objects.map((value) => [value.localId, objectId(value)]));
  const selection = parsed.selection;
  const field = (value: ParsedBoundaryObject, label: string): readonly string[] => value.fields[label] ?? Object.freeze([]);
  const single = (value: ParsedBoundaryObject, label: string): string => field(value, label)[0]!;
  const objective = group("Objective")[0]!;
  const mandate = group("Mandate")[0]!;
  const effects = group("Effect").map((value) => Object.freeze({
    id: objectId(value),
    kind: asEnum(single(value, "Kind"), "Boundary Effect kind", [
      "local-read", "local-write", "network-request", "external-mutation", "notification",
      "publication", "spend", "deployment", "other",
    ] as const),
    summary: value.narrative,
    trigger: asText(single(value, "Trigger"), "Boundary Effect trigger"),
    target: asText(single(value, "Target"), "Boundary Effect target"),
    reversibility: asEnum(single(value, "Reversibility"), "Boundary Effect reversibility", [
      "read-only", "reversible", "compensatable", "irreversible",
    ] as const),
    fragmentDigest: value.digest,
  }));
  const risks = group("Risk").map((value) => Object.freeze({
    id: objectId(value),
    statement: value.narrative,
    effectIds: resolveLocal(field(value, "Effect"), localObjects, "Boundary Risk effects"),
    treatment: asEnum(single(value, "Treatment"), "Boundary Risk treatment", ["eliminate", "mitigate", "accept"] as const),
    evidenceArtifactIds: resolveLocal(field(value, "Evidence artifact"), localObjects, "Boundary Risk Evidence artifacts"),
    propositionIds: resolveLocal(field(value, "Proposition"), localObjects, "Boundary Risk propositions"),
    fragmentDigest: value.digest,
  }));
  const selectedExternal = new Set([
    ...(selection["Selected Knowledge"] ?? []),
    ...(selection["Selected source"] ?? []),
  ]);
  const obligationBases = group("Obligation").map((value) => Object.freeze({
    id: objectId(value),
    kind: asEnum(single(value, "Kind"), "Boundary Obligation kind", [
      "behavior", "assurance", "blueprint", "description", "artifact", "check", "effect", "risk", "exclusion", "acceptance",
    ] as const),
    statement: value.narrative,
    sourceIds: Object.freeze(sortUniqueCodePoints(field(value, "Source").map((source) => {
      if (source === mandate.localId) {
        if (selectedExternal.has(source)) {
          return invalid(
            "semantic",
            "work-boundary-source",
            `Boundary Obligation source ${source} is ambiguous between a selected source and the fixed mandate`,
          );
        }
        return objectId(mandate);
      }
      if (selectedExternal.has(source)) return source;
      return invalid(
        "semantic",
        "work-boundary-source",
        `Boundary Obligation source ${source} is not selected Knowledge, a selected source, or the fixed mandate`,
      );
    }))),
    requiredEvidenceArtifactIds: resolveLocal(field(value, "Required evidence artifact"), localObjects, "Required Evidence artifacts"),
    severity: asEnum(single(value, "Severity"), "Boundary Obligation severity", ["required", "diagnostic"] as const),
    fragmentDigest: value.digest,
  }));
  const artifacts = group("Artifact").map((value) => Object.freeze({
    id: objectId(value),
    path: asPath(single(value, "Path"), "Boundary Artifact path"),
    role: asEnum(single(value, "Role"), "Boundary Artifact role", [
      "code", "test", "behavior", "assurance", "blueprint", "description", "check", "documentation", "external-source",
    ] as const),
    mustChange: asBoolean(single(value, "Must change"), "Boundary Artifact must-change"),
    obligationIds: resolveLocal(field(value, "Obligation"), localObjects, "Boundary Artifact obligations"),
    changeRule: value.narrative,
    fragmentDigest: value.digest,
  }));
  const checks = group("Check").map((value) => Object.freeze({
    id: objectId(value),
    checkKnowledgeId: asKnowledgeId(single(value, "Check Knowledge"), "Boundary Check Knowledge"),
    bindingIds: sortedIds(field(value, "Binding"), "Boundary Check bindings"),
    modality: asEnum(single(value, "Modality"), "Boundary Check modality", [
      "precondition", "repair-target", "regression-guard", "postcondition", "diagnostic",
    ] as const),
    purpose: value.narrative,
    obligationIds: resolveLocal(field(value, "Obligation"), localObjects, "Boundary Check obligations"),
    baselineRequired: asBoolean(single(value, "Baseline required"), "Boundary Check baseline required"),
    finalRequired: asBoolean(single(value, "Final required"), "Boundary Check final required"),
    environmentRequirements: Object.freeze(sortUniqueCodePoints(field(value, "Environment requirement").map((entry) => asText(entry, "Environment requirement")))),
    fragmentDigest: value.digest,
  }));
  const missingCheckPhase = missingWorkBoundaryRequiredCheckPhase(checks);
  if (missingCheckPhase !== null) {
    invalid("semantic", "work-boundary-coverage", `A Work Boundary requires at least one ${missingCheckPhase}-required Check`);
  }
  const propositions = group("Proposition").map((value) => {
    const notApplicableValue = field(value, "Not applicable condition")[0];
    const notApplicableCondition = notApplicableValue === undefined
      ? null
      : asText(notApplicableValue, "Not applicable condition");
    const pathValue = field(value, "Path")[0];
    const checkValue = field(value, "Check")[0];
    return Object.freeze({
      id: objectId(value),
      claim: value.narrative,
      evidenceKinds: Object.freeze(sortUniqueCodePoints(field(value, "Evidence kind").map((entry) => asEnum(entry, "Evidence kind", [
        "inspection", "artifact", "check", "diff", "analysis", "mixed",
      ] as const)))),
      evidenceArtifactIds: resolveLocal(field(value, "Evidence artifact"), localObjects, "Proposition Evidence artifacts"),
      obligationIds: resolveLocal(field(value, "Obligation"), localObjects, "Proposition obligations"),
      effectIds: resolveLocal(field(value, "Effect"), localObjects, "Proposition effects"),
      riskIds: resolveLocal(field(value, "Risk"), localObjects, "Proposition risks"),
      path: pathValue === undefined ? null : asPath(pathValue, "Proposition path"),
      checkId: checkValue === undefined ? null : resolveLocal([checkValue], localObjects, "Proposition Check")[0]!,
      allowNotApplicable: notApplicableCondition !== null,
      notApplicableCondition,
      fragmentDigest: value.digest,
    });
  });
  const obligations = obligationBases.map((obligation) => Object.freeze({
    ...obligation,
    propositionIds: Object.freeze(sortUniqueCodePoints(propositions
      .filter(({ obligationIds }) => obligationIds.includes(obligation.id))
      .map(({ id }) => id))),
  }));
  const sorted = <T extends Readonly<{ id: string }>>(values: readonly T[]): readonly T[] =>
    Object.freeze([...values].sort((left, right) => compareCodePoints(left.id, right.id)));
  const selectedKnowledgeIds = Object.freeze(sortUniqueCodePoints((selection["Selected Knowledge"] ?? []).map((value, index) =>
    asKnowledgeId(value, `Selected Knowledge[${index}]`))));
  const selectedWorkTypeIds = Object.freeze(sortUniqueCodePoints((selection["Selected work type"] ?? []).map((value, index) =>
    asId(value, `Selected work type[${index}]`))));
  const selectedSourceIds = sortedIds(selection["Selected source"] ?? [], "Selected source");
  if (selectedKnowledgeIds.length === 0) {
    invalid("semantic", "work-boundary-selection", "Complete Work Boundary semantics require at least one selected Knowledge subject");
  }
  const citedKnowledge = citedKnowledgeIdentities(citedSubjectIds, registry);
  for (const id of selectedKnowledgeIds) {
    const subject = registry.get(id);
    if (subject?.kind !== "knowledge" || subject.knowledgeIdentity !== id) {
      invalid("semantic", "work-boundary-selection", `Selected Knowledge ${id} is not exact Knowledge in the frozen citation registry`);
    }
    if (!citedKnowledge.has(id)) {
      invalid("semantic", "selection-citation", `Selected Knowledge ${id} lacks one exact supporting citation`);
    }
  }
  for (const id of selectedSourceIds) {
    const subject = registry.get(id);
    if (subject?.kind !== "source") {
      invalid("semantic", "work-boundary-selection", `Selected source ${id} is not an exact source in the frozen citation registry`);
    }
    if (!citedSubjectIds.has(id)) {
      invalid("semantic", "selection-citation", `Selected source ${id} lacks one exact supporting citation`);
    }
  }
  const selectedKnowledge = new Set(selectedKnowledgeIds);
  for (const check of checks) {
    if (!selectedKnowledge.has(check.checkKnowledgeId)) {
      invalid("semantic", "work-boundary-check-selection", `Boundary Check ${check.id} names unselected Check Knowledge ${check.checkKnowledgeId}`);
    }
  }
  for (const obligation of obligations) {
    if (obligation.severity === "required" && obligation.propositionIds.length === 0) {
      invalid("semantic", "work-boundary-coverage", `Required Boundary Obligation ${obligation.id} has no acceptance proposition`);
    }
  }
  for (const effect of effects) {
    if (!propositions.some(({ effectIds }) => effectIds.includes(effect.id))) {
      invalid("semantic", "work-boundary-coverage", `Boundary Effect ${effect.id} has no acceptance proposition`);
    }
  }
  for (const risk of risks) {
    if (!propositions.some(({ riskIds }) => riskIds.includes(risk.id))) {
      invalid("semantic", "work-boundary-coverage", `Boundary Risk ${risk.id} has no acceptance proposition`);
    }
  }
  for (const artifact of artifacts) {
    const directlyCovered = propositions.some(({ evidenceArtifactIds }) => evidenceArtifactIds.includes(artifact.id));
    const indirectlyCovered = obligations.some((obligation) =>
      obligation.requiredEvidenceArtifactIds.includes(artifact.id) && obligation.propositionIds.length > 0);
    if (!directlyCovered && !indirectlyCovered) {
      invalid("semantic", "work-boundary-coverage", `Boundary Artifact ${artifact.id} is not assessable through an acceptance proposition`);
    }
  }
  for (const id of selectedKnowledgeIds) {
    const [kind] = id.split(".");
    if (
      (kind === "behavior" || kind === "assurance") &&
      !obligations.some((obligation) =>
        obligation.kind === kind && obligation.severity === "required" && obligation.sourceIds.includes(id))
    ) {
      invalid("semantic", "work-boundary-coverage", `Selected ${kind} Knowledge ${id} lacks one required sourced obligation`);
    }
    if (kind === "check") {
      const matching = checks.filter(({ checkKnowledgeId }) => checkKnowledgeId === id);
      if (matching.length !== 1) {
        invalid("semantic", "work-boundary-coverage", `Selected Check Knowledge ${id} requires one exact Boundary Check`, {
          observed: matching.length,
        });
      }
    }
  }
  for (const check of checks) {
    if (!propositions.some(({ checkId }) => checkId === check.id)) {
      invalid("semantic", "work-boundary-coverage", `Boundary Check ${check.id} is not covered by one acceptance proposition`);
    }
  }
  return Object.freeze({
    role: "reconnaissance",
    proposal: "work-boundary",
    conditionIds: Object.freeze(sortUniqueCodePoints(risks.map(({ id }) => id))),
    decisionIds: Object.freeze(sortUniqueCodePoints(propositions.map(({ id }) => id))),
    effectIds: Object.freeze(sortUniqueCodePoints(effects.map(({ id }) => id))),
    workBoundary: Object.freeze({
      selectedKnowledgeIds,
      selectedWorkTypeIds,
      selectedSourceIds,
      capabilityProfileId: asId(singleField(selection, "Capability profile"), "Capability Profile"),
      projectionProfile: asEnum(singleField(selection, "Projection profile"), "Projection profile", [
        "execution-standard-v1", "execution-large-v1",
      ] as const),
      objective: Object.freeze({ id: objectId(objective), interpretation: objective.narrative, fragmentDigest: objective.digest }),
      mandate: Object.freeze({
        id: objectId(mandate),
        selectedMeaning: mandate.narrative,
        whyNow: asText(single(mandate, "Why now"), "Boundary why-now"),
        included: Object.freeze(sortUniqueCodePoints(field(mandate, "Included").map((entry) => asText(entry, "Boundary included")))),
        excluded: Object.freeze(sortUniqueCodePoints(field(mandate, "Excluded").map((entry) => asText(entry, "Boundary excluded")))),
        authorityFacts: Object.freeze(sortUniqueCodePoints(field(mandate, "Authority fact").map((entry) => asText(entry, "Boundary authority fact")))),
        chosenTradeoffs: Object.freeze(sortUniqueCodePoints(field(mandate, "Chosen tradeoff").map((entry) => asText(entry, "Boundary tradeoff")))),
        assumptions: Object.freeze(sortUniqueCodePoints(field(mandate, "Assumption").map((entry) => asText(entry, "Boundary assumption")))),
        falsifiers: Object.freeze(sortUniqueCodePoints(field(mandate, "Falsifier").map((entry) => asText(entry, "Boundary falsifier")))),
        fragmentDigest: mandate.digest,
      }),
      effects: sorted(effects),
      risks: sorted(risks),
      obligations: sorted(obligations),
      artifacts: sorted(artifacts),
      checks: sorted(checks),
      propositions: sorted(propositions),
    }),
  });
}

function singleField(fields: Readonly<Record<string, readonly string[]>>, label: string): string {
  return fields[label]![0]!;
}

function compileMaterialCondition(
  parsed: ParsedMaterialCondition | null,
  ids: IdMaps,
): ControlJsonObject | null {
  return parsed === null ? null : Object.freeze({
    id: ids.semantic.get(parsed.localId)!,
    conditionClass: parsed.conditionClass,
    statement: parsed.statement,
    falsifiedMandateIds: parsed.falsifiedMandateIds,
    knowledgeIds: parsed.knowledgeIds,
    directorJudgmentRequired: parsed.directorJudgmentRequired,
    fragmentDigest: parsed.digest,
  });
}

function compileBuilder(parsed: ParsedBuilderProposal, ids: IdMaps): ControlJsonObject {
  const effects = parsed.effects.map((value) => Object.freeze({
    id: ids.semantic.get(value.localId)!,
    kind: asEnum(singleField(value.fields, "Kind"), "Builder Effect kind", [
      "local-read", "local-write", "network-request", "external-mutation", "notification",
      "publication", "spend", "deployment", "other",
    ] as const),
    summary: value.narrative,
    trigger: asText(singleField(value.fields, "Trigger"), "Builder Effect trigger"),
    target: asText(singleField(value.fields, "Target"), "Builder Effect target"),
    reversibility: asEnum(singleField(value.fields, "Reversibility"), "Builder Effect reversibility", [
      "read-only", "reversible", "compensatable", "irreversible",
    ] as const),
    fragmentDigest: value.digest,
  })).sort((left, right) => compareCodePoints(left.id, right.id));
  const condition = compileMaterialCondition(parsed.materialCondition, ids);
  return Object.freeze({
    role: "builder",
    proposal: parsed.proposal,
    conditions: condition === null ? Object.freeze([]) : Object.freeze([condition]),
    effects: Object.freeze(effects),
    remainingObligationIds: parsed.remainingObligationIds,
  });
}

function compileReview(
  parsed: ParsedReview | null,
  ids: IdMaps,
  citationIds: ReadonlyMap<string, string>,
  citationSubjectIds: ReadonlyMap<string, string>,
  propositionIds: readonly string[],
): ControlJsonObject {
  if (parsed === null) return Object.freeze({
    role: "reviewer",
    judgments: Object.freeze([]),
    mandateApplicability: Object.freeze({ disposition: "indeterminate", rationale: "No reviewer judgment was supplied.", citationIds: Object.freeze([]), fragmentDigest: digestCanonical(null) }),
    baselineApplicability: Object.freeze([]),
    mandateExcess: false,
    missingObligationIds: Object.freeze([]),
    conditions: Object.freeze([]),
  });
  const observed = [...parsed.decisions.map(({ propositionId }) => propositionId)].sort(compareCodePoints);
  if (canonicalJson(observed) !== canonicalJson([...propositionIds].sort(compareCodePoints))) {
    invalid("semantic", "review-coverage", "Reviewer Work Product must judge every and only frozen proposition exactly once");
  }
  const judgments = parsed.decisions.map((decision) => Object.freeze({
    id: ids.semantic.get(decision.localId)!,
    propositionId: decision.propositionId,
    disposition: decision.disposition,
    citationIds: resolveLocal(decision.citationLocalIds, citationIds, "Review decision citations",
      { expectedKind: "citation", definitionKinds: ids.definitionKinds }),
    inspectedSubjectIds: resolveLocal(
      decision.citationLocalIds,
      citationSubjectIds,
      "Review decision inspected subjects",
    ),
    rationale: decision.rationale,
    uncertainty: decision.uncertainty,
    limitationIds: resolveLocal(decision.limitationLocalIds, ids.limitations, "Review decision limitations",
      { expectedKind: "limitation", definitionKinds: ids.definitionKinds }),
    fragmentDigest: decision.digest,
  })).sort((left, right) => compareCodePoints(left.propositionId, right.propositionId));
  return Object.freeze({
    role: "reviewer",
    judgments: Object.freeze(judgments),
    mandateApplicability: Object.freeze({ disposition: parsed.mandateApplicability.disposition,
      rationale: parsed.mandateApplicability.rationale,
      citationIds: resolveLocal(parsed.mandateApplicability.citationLocalIds, citationIds, "Mandate applicability citations",
        { expectedKind: "citation", definitionKinds: ids.definitionKinds }),
      fragmentDigest: parsed.mandateApplicability.digest }),
    baselineApplicability: Object.freeze(parsed.baselineApplicability.map((value) => Object.freeze({
      receiptId: value.receiptId!, disposition: value.disposition, rationale: value.rationale,
      citationIds: resolveLocal(value.citationLocalIds, citationIds, "Baseline applicability citations",
        { expectedKind: "citation", definitionKinds: ids.definitionKinds }), fragmentDigest: value.digest,
    }))),
    mandateExcess: parsed.mandateExcess,
    missingObligationIds: parsed.missingObligationIds,
    conditions: parsed.materialCondition === null
      ? Object.freeze([])
      : Object.freeze([compileMaterialCondition(parsed.materialCondition, ids)!]),
  });
}

type AgentWorkProductSemanticCitation = Readonly<{
  localId: string;
  id: string;
  subjectId: string;
  subjectKind: AgentWorkProductCitationRegistryEntry["kind"];
  claimIds: readonly string[];
  identitySubject: ControlJsonObject;
  fragmentDigest: Sha256;
}>;

type AgentWorkProductSemanticCompilation = Readonly<{
  ids: IdMaps;
  citations: readonly AgentWorkProductSemanticCitation[];
  roleSemantics: ControlJsonObject;
}>;

type AgentWorkProductCitationIdentity = (
  subject: AgentWorkProductValidationCitationFact,
  claimIds: readonly string[],
) => ControlJsonObject;

/**
 * One semantic compiler core serves both private basis validation and final
 * retention. The caller supplies only how a citation identity is materialized:
 * validation uses id/kind facts, while retention adds the frozen registry's
 * exact digest, locator, and authority fields.
 */
function compileAgentWorkProductSemanticsCore(
  parsed: ParsedAgentWorkProduct,
  registry: ReadonlyMap<string, AgentWorkProductValidationCitationFact>,
  propositionIds: readonly string[],
  citationIdentity: AgentWorkProductCitationIdentity,
): AgentWorkProductSemanticCompilation {
  const ids = assignIntrinsicIds(parsed);
  const citationIdByLocal = new Map<string, string>();
  const citationSubjectIdByLocal = new Map<string, string>();
  const citationIds = new Set<string>();
  const citations: AgentWorkProductSemanticCitation[] = [];
  for (const citation of parsed.citations) {
    const subject = registry.get(citation.subjectId);
    if (subject === undefined) {
      invalid("semantic", "citation-subject", `Citation ${citation.localId} names an item outside the frozen registry`);
    }
    const claimIds = resolveLocal(citation.supportsClaimLocalIds, ids.claims, `Citation ${citation.localId} claims`,
      { expectedKind: "claim", definitionKinds: ids.definitionKinds });
    if (claimIds.length === 0) {
      invalid("semantic", "citation-claims", `Citation ${citation.localId} must support at least one claim`);
    }
    const identitySubject = citationIdentity(subject, claimIds);
    const id = semanticId("citation", identitySubject);
    if (citationIds.has(id)) {
      invalid("semantic", "duplicate-semantic-object", "Citations contain an exact duplicate");
    }
    citationIds.add(id);
    citationIdByLocal.set(citation.localId, id);
    citationSubjectIdByLocal.set(citation.localId, subject.id);
    citations.push(Object.freeze({
      localId: citation.localId,
      id,
      subjectId: subject.id,
      subjectKind: subject.kind,
      claimIds,
      identitySubject,
      fragmentDigest: citation.digest,
    }));
  }
  const citedSubjectsByClaim = new Map<string, Set<string>>();
  for (const citation of parsed.citations) {
    for (const localClaimId of citation.supportsClaimLocalIds) {
      const subjects = citedSubjectsByClaim.get(localClaimId) ?? new Set<string>();
      subjects.add(citation.subjectId);
      citedSubjectsByClaim.set(localClaimId, subjects);
    }
  }
  for (const claim of parsed.claims) {
    const support = citedSubjectsByClaim.get(claim.localId) ?? new Set<string>();
    const supportedKnowledge = citedKnowledgeIdentities(support, registry);
    for (const subjectId of claim.knowledgeIds) {
      if (!supportedKnowledge.has(subjectId)) {
        invalid("semantic", "claim-support", `Claim ${claim.localId} names Knowledge ${subjectId} without its exact supporting citation`,
          { localHandle: claim.localId, subject: subjectId, subjectKind: "knowledge" });
      }
    }
    for (const subjectId of claim.evidenceIds) {
      if (registry.get(subjectId)?.kind !== "evidence" || !support.has(subjectId)) {
        invalid("semantic", "claim-support", `Claim ${claim.localId} names Evidence ${subjectId} without its exact supporting citation`,
          { localHandle: claim.localId, subject: subjectId, subjectKind: "evidence" });
      }
    }
  }
  const roleSemantics = parsed.role === "reconnaissance"
    ? compileBoundary(
        parsed.reconnaissance!,
        parsed.claims,
        ids,
        registry,
        new Set(parsed.citations.map(({ subjectId }) => subjectId)),
      )
    : parsed.role === "builder"
      ? compileBuilder(parsed.builder!, ids)
      : compileReview(
          parsed.review,
          ids,
          citationIdByLocal,
          citationSubjectIdByLocal,
          propositionIds,
        );
  return Object.freeze({
    ids,
    citations: Object.freeze(citations),
    roleSemantics,
  });
}

const SAFE_VALIDATION_DIAGNOSTIC_CODE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/u;

function semanticValidationDiagnostic(
  error: unknown,
  draftBasis: AgentWorkProductValidationBasis | null = null,
): AgentWorkProductValidationDiagnostic {
  if (error instanceof AgentWorkProductSemanticError) {
    const observed: Readonly<Record<string, unknown>> = error.observedFacts !== null &&
      typeof error.observedFacts === "object"
      ? error.observedFacts as Readonly<Record<string, unknown>>
      : Object.freeze({});
    const line = Number.isSafeInteger(observed.line) && (observed.line as number) >= 1 &&
      (observed.line as number) <= 32_768
      ? observed.line as number
      : null;
    const safeCode = Buffer.byteLength(error.code, "utf8") <= 160 &&
      SAFE_VALIDATION_DIAGNOSTIC_CODE.test(error.code)
      ? error.code
      : "lifecycle.agent-work-product.runtime.diagnostic-code";
    // Local correction may name only bounded grammar handles and matching
    // identities already present in the supplied compact basis. Durable
    // submission diagnostics retain their smaller existing projection.
    const correctionHandle = (value: unknown): string | null =>
      typeof value === "string" && Buffer.byteLength(value, "utf8") <= 160 &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value) ? value : null;
    const claimSupport = draftBasis !== null &&
      safeCode === "lifecycle.agent-work-product.invalid.claim-support";
    const duplicateHandle = draftBasis !== null &&
      safeCode === "lifecycle.agent-work-product.invalid.duplicate-local-identity";
    const localReference = draftBasis !== null &&
      safeCode === "lifecycle.agent-work-product.invalid.local-reference" &&
      typeof observed.expectedKind === "string" &&
      ["claim", "citation", "limitation"].includes(observed.expectedKind) &&
      typeof observed.actualKind === "string" &&
      ["claim", "citation", "limitation", "condition", "decision", "effect", "proposal", "review", "absent"].includes(observed.actualKind);
    const subject = claimSupport ? correctionHandle(observed.subject) : null;
    const expected = localReference
      ? [`definition-kind:${String(observed.expectedKind)}`, `observed-kind:${String(observed.actualKind)}`]
      : subject === null ? [] : draftBasis!.citationFacts
      .filter((fact) => observed.subjectKind === "knowledge"
        ? fact.kind === "knowledge" && fact.knowledgeIdentity === subject
        : fact.kind === "evidence" && fact.id === subject)
      .map(({ id }) => id).slice(0, 32);
    return Object.freeze({
      code: safeCode,
      phase: error.phase,
      correction: error.classification === "invalid-result"
        ? "correct-semantic-draft" as const
        : "stop-runtime-failure" as const,
      line,
      subject,
      localHandle: claimSupport || duplicateHandle || localReference ? correctionHandle(observed.localHandle) : null,
      expected: Object.freeze(expected),
    });
  }
  return Object.freeze({
    code: "lifecycle.agent-work-product.runtime.validation-callback",
    phase: "compiler" as const,
    correction: "stop-runtime-failure" as const,
    line: null,
    subject: null,
    localHandle: null,
    expected: Object.freeze([]),
  });
}

/**
 * Validate agent-authored Markdown against one compact immutable basis.
 * Both local advisory inspection and independent post-Containment validation
 * use this owner. Local correction can additionally expose typed handles and
 * matching supplied-basis citation identities, never prose or source locators.
 * A successful local result does not establish final submission validity.
 */
export function validateAgentWorkProductSemanticMarkdown(
  basis: unknown,
  semanticMarkdown: string,
  diagnosticScope: "submission" | "local-draft" = "submission",
): AgentWorkProductValidationOutcome {
  let exactBasis: AgentWorkProductValidationBasis | null = null;
  try {
    exactBasis = parseAgentWorkProductValidationBasis(basis);
    const parsed = parseAgentWorkProductSemanticMarkdown(exactBasis.role, semanticMarkdown);
    const registry = new Map(exactBasis.citationFacts.map((entry) => [entry.id, entry]));
    compileAgentWorkProductSemanticsCore(
      parsed,
      registry,
      exactBasis.propositionIds,
      (subject, claimIds) => Object.freeze({
        subjectId: subject.id,
        subjectKind: subject.kind,
        claimIds,
      }),
    );
    return Object.freeze({ status: "valid" as const, diagnostic: null });
  } catch (error) {
    const diagnostic = semanticValidationDiagnostic(error, diagnosticScope === "local-draft" ? exactBasis : null);
    return error instanceof AgentWorkProductSemanticError && error.classification === "invalid-result"
      ? Object.freeze({ status: "invalid-result" as const, diagnostic })
      : Object.freeze({ status: "runtime-failure" as const, diagnostic });
  }
}

function fixedTarget(value: ControlRecordRelationshipTarget | null): ControlJsonValue {
  return value === null ? null : Object.freeze({ id: value.id, revision: value.revision, digest: value.digest });
}

type AgentWorkProductAttemptBindings = ReturnType<typeof attemptBindings>;

export type AgentWorkProductCompilationDigests = Readonly<{
  parseResultDigest: Sha256;
  fixedBindingSubjectDigest: Sha256;
}>;

function compilationContext(input: AgentWorkProductCompilerInput): Readonly<{
  bindings: AgentWorkProductAttemptBindings;
  digests: AgentWorkProductCompilationDigests;
}> {
  const bindings = attemptBindings(input.attempt);
  if (bindings.role !== input.parsed.role) runtimeFailure("binding", "Parsed Work Product role differs from its Agent Attempt");
  if (input.observation.activityId !== bindings.activityId) {
    runtimeFailure("binding", "Governed workspace activity differs from its Agent Attempt");
  }
  if (input.observation.editor.kind !== "agent") {
    runtimeFailure("binding", "Agent Work Product observation is not authored through an Agent workspace");
  }
  if (input.workspaceTemplateDigest !== bindings.templateDigest) {
    runtimeFailure("template", "Governed workspace does not bind the exact installed Attempt template");
  }
  assertInstalledAuthoringBindings(bindings);
  if (input.observation.semanticDigest !== sha256Bytes(input.observation.semanticMarkdown)) {
    runtimeFailure("observation", "Governed workspace semantic digest does not reproduce its normalized Markdown");
  }
  const normalizedParserValue = input.parsed as unknown as ControlJsonObject;
  const parseResultDigest = digestCanonical(Object.freeze({
    schema: FOUNDATION_AGENT_WORK_PRODUCT_PARSE_RESULT_SCHEMA,
    attempt: Object.freeze({ id: input.attempt.recordId, revision: input.attempt.revision, digest: input.attempt.digest }),
    role: bindings.role,
    templateDigest: bindings.templateDigest,
    workspaceRawDigest: input.observation.rawDigest,
    semanticMarkdownDigest: input.observation.semanticDigest,
    normalized: normalizedParserValue,
  }));
  const fixedBindingSubjectDigest = digestCanonical(Object.freeze({
    schema: FOUNDATION_AGENT_WORK_PRODUCT_FIXED_BINDINGS_SCHEMA,
    processId: input.attempt.processId,
    activityId: bindings.activityId,
    attempt: Object.freeze({ id: input.attempt.recordId, revision: input.attempt.revision, digest: input.attempt.digest }),
    invocationId: bindings.invocationId,
    role: bindings.role,
    roleSubjectDigest: bindings.roleSubjectDigest,
    projectionDigest: bindings.projectionDigest,
    boundary: fixedTarget(bindings.boundary),
    candidate: fixedTarget(bindings.candidate),
    evidenceSetDigest: bindings.evidenceSetDigest,
    propositionSetDigest: bindings.propositionSetDigest,
    citationRegistryDigest: bindings.citationRegistryDigest,
    templateDigest: bindings.templateDigest,
    parserProfileDigest: bindings.parserProfileDigest,
    compilerProfileDigest: bindings.compilerProfileDigest,
  }));
  return Object.freeze({
    bindings,
    digests: Object.freeze({ parseResultDigest, fixedBindingSubjectDigest }),
  });
}

/**
 * Derive the parser and frozen-binding subjects before role compilation. A
 * later semantic compiler refusal can therefore be recorded truthfully without
 * manufacturing a Work Product or losing the exact valid parse provenance.
 */
export function agentWorkProductCompilationDigests(
  input: AgentWorkProductCompilerInput,
): AgentWorkProductCompilationDigests {
  return compilationContext(input).digests;
}

export function compileAgentWorkProductPayload(input: AgentWorkProductCompilerInput): ControlJsonObject {
  const { bindings, digests } = compilationContext(input);
  const registry = exactRegistry(input.citationRegistry, bindings.citationRegistryDigest);
  const propositionIds = exactPropositions(input.propositionSet, bindings.propositionSetDigest);
  const registryById = new Map(registry.map((entry) => [entry.id, entry]));
  const semantic = compileAgentWorkProductSemanticsCore(
    input.parsed,
    registryById,
    propositionIds,
    (subject, claimIds) => {
      const exact = registryById.get(subject.id)!;
      return Object.freeze({
        subjectId: exact.id,
        subjectKind: exact.kind,
        subjectDigest: exact.digest,
        locator: exact.locator,
        authorityClass: exact.authorityClass,
        claimIds,
      });
    },
  );
  const { ids } = semantic;
  const claims = input.parsed.claims.map((claim) => Object.freeze({
    id: ids.claims.get(claim.localId)!,
    category: claim.category,
    state: claim.state,
    statement: claim.statement,
    knowledgeIds: claim.knowledgeIds,
    evidenceIds: claim.evidenceIds,
    paths: claim.paths,
    uncertainty: claim.uncertainty,
    fragmentDigest: claim.digest,
  })).sort((left, right) => compareCodePoints(left.id, right.id));
  const citations = Object.freeze(semantic.citations.map((citation) => Object.freeze({
    id: citation.id,
    ...citation.identitySubject,
    fragmentDigest: citation.fragmentDigest,
  })).sort((left, right) => compareCodePoints(String(left.id), String(right.id))));
  const limitations = input.parsed.limitations.map((limitation) => Object.freeze({
    id: ids.limitations.get(limitation.localId)!,
    statement: limitation.statement,
    fragmentDigest: limitation.digest,
  })).sort((left, right) => compareCodePoints(left.id, right.id));
  const fragments: CompiledFragment[] = [];
  const addFragment = (localId: string, id: string, kind: FragmentKind, digest: Sha256): void => {
    fragments.push(Object.freeze({ id, kind, anchor: localId, digest }));
  };
  for (const claim of input.parsed.claims) addFragment(claim.localId, ids.claims.get(claim.localId)!, "claim", claim.digest);
  for (const citation of semantic.citations) addFragment(citation.localId, citation.id, "citation", citation.fragmentDigest);
  for (const limitation of input.parsed.limitations) addFragment(limitation.localId, ids.limitations.get(limitation.localId)!, "limitation", limitation.digest);
  for (const value of [
    ...(input.parsed.reconnaissance?.objects ?? []),
    ...(input.parsed.builder?.materialCondition === null || input.parsed.builder === null ? [] : [input.parsed.builder.materialCondition]),
    ...(input.parsed.builder?.effects ?? []),
    ...(input.parsed.review?.materialCondition === null || input.parsed.review === null ? [] : [input.parsed.review.materialCondition]),
    ...(input.parsed.review?.decisions ?? []),
    ...(input.parsed.review === null ? [] : [input.parsed.review.mandateApplicability, ...input.parsed.review.baselineApplicability]),
  ]) addFragment(value.localId, ids.semantic.get(value.localId)!, value.kind, value.digest);
  if (fragments.length > 16_384) {
    invalid("semantic", "collection-bound", "Agent Work Product addressable fragments exceed the 16384-item bound");
  }
  fragments.sort((left, right) => compareCodePoints(left.id, right.id));
  return Object.freeze({
    schema: "lifecycle.agent-work-product-payload.v5",
    profileId: profileId(bindings.role),
    role: bindings.role,
    disposition: input.parsed.disposition,
    summary: Object.freeze({ text: input.parsed.summary, fragmentDigest: input.parsed.summaryFragmentDigest }),
    uncertainty: Object.freeze({ level: input.parsed.uncertainty, fragmentDigest: input.parsed.uncertaintyFragmentDigest }),
    claims: Object.freeze(claims),
    citations,
    limitations: Object.freeze(limitations),
    noProductReason: input.parsed.noProductReason,
    roleSemantics: semantic.roleSemantics,
    parseResultDigest: digests.parseResultDigest,
    fixedBindingSubjectDigest: digests.fixedBindingSubjectDigest,
    body: Object.freeze({
      profileId: profileId(bindings.role),
      digest: sha256Bytes(input.parsed.normalizedMarkdown),
      fragments: Object.freeze(fragments),
    }),
  });
}
