import { FoundationError } from "../error.js";
import { canonicalJson, digestCanonical, type Sha256 } from "../validation/canonical.js";
import { sortUniqueCodePoints } from "../validation/ordering.js";
import { FOUNDATION_EVIDENCE_RULE_SET_V7, FOUNDATION_EVIDENCE_VALIDATOR_V7 } from "./coordinates-v7.js";
import { reviewRequiresMandateResolutionV1 } from "./review-classification-v1.js";

type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;

type JsonObject = Readonly<{
  [key: string]: JsonValue;
}>;

export type EvidencePacketArtifactObservation = Readonly<{
  artifactId: string;
  fileKind: "file" | "directory" | "symlink" | "submodule" | "absent";
  existence: "present" | "absent";
  change: "added" | "modified" | "deleted" | "unchanged" | "not-applicable" | "indeterminate";
  contentDigest: Sha256 | null;
  manifestDigest: Sha256 | null;
  schemaValidation: "valid" | "invalid" | "not-required" | "indeterminate";
  semanticValidation: "valid" | "invalid" | "not-required" | "indeterminate";
  limitationIds?: readonly string[];
}>;

export type EvidencePacketDescriptionObservation = Readonly<{
  path: string;
  descriptionId: string | null;
  selector: string | null;
  ownership: "exact" | "missing" | "ambiguous" | "excluded" | "indeterminate";
  implementationChange: "changed" | "unchanged" | "absent";
  descriptionChange: "changed" | "unchanged" | "absent";
  exclusionChange: "none" | "new" | "widened" | "narrowed";
  obligationIds: readonly string[];
}>;

export type EvidencePacketDiagnostic = Readonly<{
  code: string;
  stage: string;
  factsDigest: Sha256;
}>;

export type EvidencePacketObservation = Readonly<{
  evaluatedAt: string;
  artifacts: readonly EvidencePacketArtifactObservation[];
  descriptionCoverage: readonly EvidencePacketDescriptionObservation[];
  reviewerSubjectDisposition: "exact-read-only" | "mutated" | "indeterminate";
  diagnostics?: readonly EvidencePacketDiagnostic[];
  ruleSet: Readonly<{
    id: string;
    digest: Sha256;
  }>;
  validator: Readonly<{
    id: string;
    digest: Sha256;
  }>;
}>;

type ExactReference = Readonly<{
  kind: string;
  id: string;
  revision: number;
  digest: Sha256;
}>;

type CheckPhase = "baseline" | "final";

type CheckModality = "precondition" | "repair-target" | "regression-guard" | "postcondition" | "diagnostic";

type CheckDisposition = "pass" | "fail" | "indeterminate" | "not-run" | "unsupported" | "operational-error";

type CheckSelection = Readonly<{
  id: string;
  definition: Readonly<{
    id: string;
    revision: number;
    sourceDigest: Sha256;
    semanticDigest: Sha256;
  }>;
  bindings: readonly Readonly<{
    id: string;
    digest: Sha256;
    implementationDigest: Sha256;
  }>[];
  modality: CheckModality;
  baselineRequired: boolean;
  finalRequired: boolean;
  obligationIds: readonly string[];
  environmentRequirements: readonly string[];
}>;

type BoundaryObligation = Readonly<{
  id: string;
  severity: "required" | "diagnostic";
  requiredEvidenceArtifactIds: readonly string[];
  propositionIds: readonly string[];
}>;

type BoundaryArtifact = Readonly<{
  id: string;
  path: string;
  mustChange: boolean;
  obligationIds: readonly string[];
}>;

type BoundaryProposition = Readonly<{
  id: string;
  obligationIds: readonly string[];
  allowNotApplicable: boolean;
  notApplicableCondition: string | null;
}>;

export type FoundationEvidenceRequirementsV1 = Readonly<{
  checks: readonly CheckSelection[];
  obligations: readonly BoundaryObligation[];
  artifacts: readonly BoundaryArtifact[];
  propositions: readonly BoundaryProposition[];
}>;

export type FoundationEvidenceCheckFactsV1 = Readonly<{
  reference: ExactReference;
  proofSubject: ExactReference;
  phase: CheckPhase;
  modality: CheckModality;
  disposition: CheckDisposition;
  selectionId: string;
  allocation: "not-allocated" | "allocated";
  notRunAuthorization: "baseline-postcondition" | "upstream-condition" | null;
  startedAt: string | null;
  finishedAt: string | null;
  definition: CheckSelection["definition"];
  binding: CheckSelection["bindings"][number];
  requestedConditions: readonly string[];
}>;

type ReviewJudgment = Readonly<{
  id: string;
  propositionId: string;
  disposition: "accepted" | "rejected" | "indeterminate" | "not-applicable";
  citationIds: readonly string[];
  inspectedSubjectIds: readonly string[];
  uncertainty: "none" | "bounded" | "material" | "unknown";
  limitationIds: readonly string[];
  fragmentDigest: Sha256;
}>;

type ApplicabilityJudgment = Readonly<{
  disposition: "applicable" | "requires-readmission" | "insufficient" | "indeterminate";
  citationIds: readonly string[];
  rationale: string;
  fragmentDigest: Sha256;
}>;

export type FoundationEvidenceReviewFactsV1 = Readonly<{
  reference: ExactReference;
  subject: FoundationEvidenceAssessmentInputV1["subject"];
  citations: readonly Readonly<{
    id: string;
    subjectId: string;
    subjectDigest: Sha256;
    subjectKind: string;
  }>[];
  mandateApplicability: ApplicabilityJudgment;
  baselineApplicability: readonly (ApplicabilityJudgment & Readonly<{
    receiptId: string;
  }>)[];
  judgments: readonly ReviewJudgment[];
  mandateExcess: boolean;
  missingObligationIds: readonly string[];
  overallUncertainty: ReviewJudgment["uncertainty"];
}>;

/** Established context provenance, not a provider-session claim or a satisfaction verdict. */
export type FoundationEvidenceIndependenceFactsV1 = Readonly<{
  contextSeparation: "distinct" | "shared" | "unobserved";
}>;

/** Conditional semantic justification. Input custody and authenticity belong to the calling provenance adapter. */
export type FoundationEvidenceAssessmentInputV1 = Readonly<{
  subject: Readonly<{
    boundary: ExactReference;
    candidate: ExactReference;
    seal: ExactReference;
    integration: ExactReference;
    parent: Readonly<{
      commit: string;
      tree: string;
      snapshotDigest: Sha256;
    }>;
  }>;
  requirements: FoundationEvidenceRequirementsV1;
  checks: readonly FoundationEvidenceCheckFactsV1[];
  review: FoundationEvidenceReviewFactsV1;
  independence: FoundationEvidenceIndependenceFactsV1;
  observationSubject: FoundationEvidenceAssessmentInputV1["subject"];
  observation: EvidencePacketObservation;
}>;

type BoundaryFacts = FoundationEvidenceRequirementsV1;

type RetainedCheck = FoundationEvidenceCheckFactsV1;

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

const PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)[^\u0000-\u001f\u007f]+$/u;

const SINGLE_LINE_PATTERN = /^[^\u0000-\u001f\u007f-\u009f\u2028\u2029]+$/u;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.control-evidence-packet.${code}`, message);
}

function array(value: JsonValue | undefined, label: string): readonly JsonValue[] {
  if (!Array.isArray(value)) {
    fail("retained-fact", `${label} must be one exact retained array`);
  }
  return value;
}

function string(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string") {
    fail("retained-fact", `${label} must be retained text`);
  }
  return value;
}

function boolean(value: JsonValue | undefined, label: string): boolean {
  if (typeof value !== "boolean") {
    fail("retained-fact", `${label} must be one retained boolean`);
  }
  return value;
}

function positiveInteger(value: JsonValue | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    fail("retained-fact", `${label} must be one positive safe integer`);
  }
  return value;
}

function digest(value: JsonValue | undefined, label: string): Sha256 {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail("retained-fact", `${label} must be one lowercase SHA-256 digest`);
  }
  return value as Sha256;
}

function id(value: string, label: string): string {
  const normalized = value;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(normalized)) {
    fail("identity", `${label} is not an exact identity`);
  }
  if (Buffer.byteLength(normalized, "utf8") > 512) {
    fail("bound", `${label} exceeds its bound`);
  }
  return normalized;
}

function singleLine(value: string, label: string): string {
  if (value.length < 1 ||
    Buffer.byteLength(value, "utf8") > 4096 ||
    !SINGLE_LINE_PATTERN.test(value)) {
    fail("observation", `${label} must be one bounded printable line`);
  }
  return value;
}

function sortedIds(values: readonly string[], label: string, maximum = 4096): readonly string[] {
  if (values.length > maximum) {
    fail("bound", `${label} exceeds its item bound`);
  }
  return Object.freeze(sortUniqueCodePoints(values.map((value) => id(value, label))));
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function timestamp(value: string, label: string): string {
  const parsed = new Date(value);
  const canonical = Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : null;
  if (canonical === null || (value !== canonical && value !== canonical.replace(/\.000Z$/u, "Z"))) {
    fail("time", `${label} is not an exact UTC timestamp`);
  }
  return value;
}

function exactStringArray(value: JsonValue | undefined, label: string): readonly string[] {
  return array(value, label).map((item) => string(item, label));
}

function checkMatchesSelection(check: RetainedCheck, selection: CheckSelection): void {
  if (check.selectionId !== selection.id || check.modality !== selection.modality) {
    fail("check", "Check Receipt does not reproduce its exact Work Boundary selection");
  }
  const definition = check.definition;
  if (definition.id !== selection.definition.id ||
    definition.revision !== selection.definition.revision ||
    definition.sourceDigest !== selection.definition.sourceDigest ||
    definition.semanticDigest !== selection.definition.semanticDigest) {
    fail("check", "Check Receipt substitutes its selected Check Definition");
  }
  const binding = check.binding;
  if (!selection.bindings.some((candidate) => binding.id === candidate.id &&
    binding.digest === candidate.digest &&
    binding.implementationDigest === candidate.implementationDigest)) {
    fail("check", "Check Receipt substitutes its selected Check Binding");
  }
  const requested = Object.freeze(sortUniqueCodePoints(exactStringArray(check.requestedConditions, "Check Receipt requested conditions")));
  if (digestCanonical(requested) !== digestCanonical(selection.environmentRequirements)) {
    fail("check", "Check Receipt requested conditions differ from its exact Work Boundary selection");
  }
}

/** Exact semantic authorization shared by Evidence assessment and read presentation. */
export function isFoundationAuthorizedBaselinePostconditionV1(check: Readonly<{
  phase: unknown;
  modality: unknown;
  disposition: unknown;
  notRunAuthorization: unknown;
  allocation: unknown;
  startedAt: unknown;
  finishedAt: unknown;
}>): boolean {
  return check.phase === "baseline" && check.modality === "postcondition" &&
    check.disposition === "not-run" && check.notRunAuthorization === "baseline-postcondition" &&
    check.allocation === "not-allocated" && check.startedAt === null && check.finishedAt === null;
}

function legalBaseline(check: RetainedCheck): boolean {
  if (check.phase !== "baseline") {
    return false;
  }
  if (check.modality === "precondition" || check.modality === "regression-guard") {
    return check.disposition === "pass";
  }
  if (check.modality === "repair-target") {
    return check.disposition === "pass" || check.disposition === "fail";
  }
  if (check.modality === "postcondition") {
    return isFoundationAuthorizedBaselinePostconditionV1(check);
  }
  return true;
}

function legalFinal(check: RetainedCheck): boolean {
  return check.phase === "final" &&
    (check.modality === "diagnostic" || check.disposition === "pass");
}

function localId(prefix: string, value: JsonObject): string {
  return `${prefix}.${digestCanonical(value).slice("sha256:".length)}`;
}

function receiptLedgers(facts: BoundaryFacts, checks: readonly RetainedCheck[], evaluatedAt: string): Readonly<{
  entries: readonly JsonObject[];
  usedChecks: readonly RetainedCheck[];
  completeAndLegal: boolean;
}> {
  const evaluatedMs = Date.parse(evaluatedAt);
  const byCoordinate = new Map<string, RetainedCheck>();
  for (const check of checks) {
    const key = `${check.phase}\u0000${check.selectionId}`;
    if (byCoordinate.has(key)) {
      fail("check", `Evidence has more than one ${check.phase} Receipt for ${check.selectionId}`);
    }
    byCoordinate.set(key, check);
  }
  const selections = new Map(facts.checks.map((selection) => [selection.id, selection]));
  for (const check of byCoordinate.values()) {
    const selection = selections.get(check.selectionId);
    if (selection === undefined) {
      fail("check", `Check Receipt selects unknown boundary Check ${check.selectionId}`);
    }
    checkMatchesSelection(check, selection);
  }
  let completeAndLegal = true;
  const entries: JsonObject[] = [];
  for (const selection of facts.checks) {
    for (const phase of ["baseline", "final"] as const) {
      const check = byCoordinate.get(`${phase}\u0000${selection.id}`) ?? null;
      const required = phase === "baseline" ? selection.baselineRequired : selection.finalRequired;
      if (check === null && required) {
        completeAndLegal = false;
      }
      if (check !== null && !(phase === "baseline" ? legalBaseline(check) : legalFinal(check))) {
        if (required || selection.modality !== "diagnostic") {
          completeAndLegal = false;
        }
      }
      let ageMs: number | null = null;
      let freshness: "fresh" | "stale" | "not-applicable" | "indeterminate";
      const authorizedNonExecution = check !== null && isFoundationAuthorizedBaselinePostconditionV1(check);
      if (check === null) {
        freshness = required ? "indeterminate" : "not-applicable";
      }
      else if (authorizedNonExecution) {
        // This exact Receipt establishes permitted baseline non-execution. It
        // supplies no execution timestamp or temporally reusable result.
        freshness = "not-applicable";
      }
      else if (check.finishedAt === null) {
        freshness = "indeterminate";
        completeAndLegal = false;
      }
      else {
        const finishedMs = Date.parse(timestamp(check.finishedAt, "Check Receipt finish time"));
        ageMs = evaluatedMs - finishedMs;
        if (ageMs < 0) {
          freshness = "stale";
          completeAndLegal = false;
        }
        else {
          freshness = "fresh";
        }
      }
      const value: JsonObject = Object.freeze({
        id: localId("receipt-use", Object.freeze({ checkId: selection.id, phase })),
        checkId: selection.id,
        phase,
        receiptId: check?.reference.id ?? null,
        use: check === null ? required ? "missing" : "excluded" : authorizedNonExecution ? "excluded" : "executed",
        freshness,
        subjectEquivalence: check === null ? "indeterminate" : "exact",
        ageMs,
        maximumAgeMs: null,
        reasonCode: check === null
          ? required ? "required-receipt-missing" : "receipt-not-required"
          : authorizedNonExecution ? "baseline-postcondition-not-run"
            : freshness === "stale" ? "receipt-finished-after-evaluation"
            : phase === "baseline" ? legalBaseline(check) ? "baseline-receipt-current" : "baseline-disposition-illegal"
              : legalFinal(check) ? "final-receipt-current" : "final-disposition-illegal",
        provenance: "runtime-derived",
      });
      entries.push(value);
    }
  }
  return Object.freeze({
    entries: Object.freeze(entries.sort((left, right) => compareCodePoints(string(left.id, "Receipt-use identity"), string(right.id, "Receipt-use identity")))),
    usedChecks: Object.freeze([...byCoordinate.values()].sort((left, right) => compareCodePoints(left.reference.id, right.reference.id))),
    completeAndLegal,
  });
}

function reviewJudgments(review: FoundationEvidenceReviewFactsV1, facts: BoundaryFacts, checks: readonly RetainedCheck[]): Readonly<{
  mandateApplicability: JsonObject;
  baselineApplicability: readonly JsonObject[];
  judgments: readonly ReviewJudgment[];
  mandateExcess: boolean;
  missingObligationIds: readonly string[];
  overallUncertainty: "none" | "bounded" | "material" | "unknown";
}> {
  const semantics = review;
  const citations = review.citations.map((citation) => {
    return Object.freeze({
      id: id(string(citation.id, "Citation identity"), "Citation identity"),
      subjectId: id(string(citation.subjectId, "Citation subject identity"), "Citation subject identity"),
      subjectDigest: digest(citation.subjectDigest, "Citation exact subject digest"),
      subjectKind: string(citation.subjectKind, "Citation subject kind"),
    });
  });
  for (const citation of citations) {
    const check = checks.find(({ reference }) => reference.id === citation.subjectId);
    if (check !== undefined && (citation.subjectKind !== "evidence" || citation.subjectDigest !== check.reference.digest)) {
      fail("review", "Reviewer citation substitutes its exact Check observation");
    }
  }
  const citationById = new Map(citations.map((citation) => [citation.id, citation]));
  if (citationById.size !== citations.length) {
    fail("review", "Reviewer Work Product repeats a citation identity");
  }
  const applicability = (item: ApplicabilityJudgment & Readonly<{
    receiptId?: string;
  }>, baseline: boolean): JsonObject => {
    const disposition = string(item.disposition, "Applicability disposition");
    if (!(baseline ? ["applicable", "insufficient", "indeterminate"] : ["applicable", "requires-readmission", "indeterminate"]).includes(disposition)) {
      fail("review", "Integration applicability disposition is unsupported");
    }
    string(item.rationale, "Applicability rationale");
    const citationIds = sortedIds(exactStringArray(item.citationIds, "Applicability citation identities"), "Applicability citation identity");
    if (citationIds.length === 0 || citationIds.some((id) => !citationById.has(id))) {
      fail("review", "Integration applicability requires exact resolved citations");
    }
    const receiptId = baseline ? id(string(item.receiptId, "Baseline applicability Receipt"), "Baseline applicability Receipt") : null;
    const baselineReceipt = receiptId === null ? null : checks.find((check) => check.phase === "baseline" && check.reference.id === receiptId)?.reference;
    if (receiptId !== null && (baselineReceipt == null || !citationIds.some((id) => {
      const citation = citationById.get(id)!;
      return citation.subjectId === receiptId && citation.subjectKind === "evidence" && citation.subjectDigest === baselineReceipt.digest;
    }))) {
      fail("review", "Baseline applicability must cite its exact original Receipt");
    }
    return Object.freeze({
      ...(receiptId === null ? {} : { receiptId }), disposition,
      fragmentDigest: digest(item.fragmentDigest, "Applicability fragment digest")
    });
  };
  const mandateApplicability = applicability(semantics.mandateApplicability!, false);
  const baselineApplicability = semantics.baselineApplicability
    .map((item) => applicability(item, true)).sort((a, b) => compareCodePoints(String(a.receiptId), String(b.receiptId)));
  const requiredBaselineIds = checks.filter((check) => check.phase === "baseline" &&
    facts.checks.some((selection) => selection.id === check.selectionId && selection.baselineRequired))
    .map((check) => check.reference.id).sort(compareCodePoints);
  if (canonicalJson(baselineApplicability.map(({ receiptId }) => receiptId)) !== canonicalJson(requiredBaselineIds)) {
    fail("review", "Integration review must judge every and only exact required original baseline Receipt once");
  }
  const judgments = semantics.judgments.map((judgment): ReviewJudgment => {
    const citationIds = sortedIds(exactStringArray(judgment.citationIds, "Judgment citation identities"), "Judgment citation identity");
    if (citationIds.length < 1) {
      fail("review", "Every reviewer judgment requires at least one exact citation");
    }
    const derivedSubjects = sortedIds(citationIds.map((citationId) => {
      const citation = citationById.get(citationId);
      if (citation === undefined) {
        fail("review", `Reviewer judgment cites unknown citation ${citationId}`);
      }
      return citation.subjectId;
    }), "Inspected subject identity");
    const retainedSubjects = sortedIds(exactStringArray(judgment.inspectedSubjectIds, "Judgment inspected subject identities"), "Judgment inspected subject identity");
    if (digestCanonical(derivedSubjects) !== digestCanonical(retainedSubjects)) {
      fail("review", "Reviewer judgment inspected subjects do not reproduce its exact resolved citations");
    }
    const disposition = string(judgment.disposition, "Reviewer disposition");
    const uncertainty = string(judgment.uncertainty, "Reviewer uncertainty");
    if (!(["accepted", "rejected", "indeterminate", "not-applicable"] as const).includes(disposition as ReviewJudgment["disposition"])) {
      fail("review", "Reviewer disposition is unsupported");
    }
    if (!(["none", "bounded", "material", "unknown"] as const).includes(uncertainty as ReviewJudgment["uncertainty"])) {
      fail("review", "Reviewer uncertainty is unsupported");
    }
    return Object.freeze({
      id: id(string(judgment.id, "Reviewer judgment identity"), "Reviewer judgment identity"),
      propositionId: id(string(judgment.propositionId, "Judgment proposition identity"), "Judgment proposition identity"),
      disposition: disposition as ReviewJudgment["disposition"],
      citationIds,
      inspectedSubjectIds: retainedSubjects,
      uncertainty: uncertainty as ReviewJudgment["uncertainty"],
      limitationIds: sortedIds(exactStringArray(judgment.limitationIds, "Judgment limitation identities"), "Judgment limitation identity"),
      fragmentDigest: digest(judgment.fragmentDigest, "Judgment fragment digest"),
    });
  });
  const byProposition = new Map(judgments.map((judgment) => [judgment.propositionId, judgment]));
  if (byProposition.size !== judgments.length) {
    fail("review", "Reviewer Work Product repeats a proposition judgment");
  }
  if (judgments.length !== facts.propositions.length ||
    facts.propositions.some(({ id: propositionId }) => !byProposition.has(propositionId))) {
    fail("review", "Reviewer Work Product does not judge every exact Work Boundary proposition once");
  }
  const overall = string(review.overallUncertainty, "Reviewer overall uncertainty level");
  if (!(["none", "bounded", "material", "unknown"] as const).includes(overall as ReviewJudgment["uncertainty"])) {
    fail("review", "Reviewer overall uncertainty is unsupported");
  }
  return Object.freeze({
    mandateApplicability,
    baselineApplicability: Object.freeze(baselineApplicability),
    judgments: Object.freeze(judgments.sort((left, right) => compareCodePoints(left.propositionId, right.propositionId))),
    mandateExcess: boolean(semantics.mandateExcess, "Reviewer mandate-excess result"),
    missingObligationIds: sortedIds(exactStringArray(semantics.missingObligationIds, "Reviewer missing-obligation identities"), "Reviewer missing-obligation identity"),
    overallUncertainty: overall as ReviewJudgment["uncertainty"],
  });
}

function propositionLedger(workProduct: ExactReference, facts: BoundaryFacts, review: ReturnType<typeof reviewJudgments>): readonly JsonObject[] {
  const propositions = new Map(facts.propositions.map((value) => [value.id, value]));
  return Object.freeze(review.judgments.map((judgment): JsonObject => {
    const proposition = propositions.get(judgment.propositionId)!;
    const legalNotApplicable = judgment.disposition === "not-applicable" &&
      proposition.allowNotApplicable && proposition.notApplicableCondition !== null;
    const acceptedWithVisibleLimits = judgment.disposition === "accepted" &&
      (judgment.uncertainty === "none" || judgment.uncertainty === "bounded");
    const validation = legalNotApplicable || acceptedWithVisibleLimits
      ? "valid"
      : judgment.disposition === "indeterminate" || judgment.uncertainty === "unknown"
        ? "indeterminate"
        : "invalid";
    return Object.freeze({
      id: localId("proposition-decision", Object.freeze({ propositionId: proposition.id })),
      propositionId: proposition.id,
      reviewerDisposition: judgment.disposition,
      reviewWorkProductId: workProduct.id,
      fragmentDigest: judgment.fragmentDigest,
      citationIds: judgment.citationIds,
      inspectedSubjectIds: judgment.inspectedSubjectIds,
      limitationIds: judgment.limitationIds,
      uncertainty: judgment.uncertainty,
      provenance: "agent-proposed",
      validation,
    });
  }));
}

function artifactLedger(observations: readonly EvidencePacketArtifactObservation[], facts: BoundaryFacts, candidate: ExactReference, checks: readonly RetainedCheck[]): readonly JsonObject[] {
  if (observations.length > 4096) {
    fail("bound", "Artifact observations exceed the Evidence profile");
  }
  const byId = new Map(observations.map((value) => [value.artifactId, value]));
  if (byId.size !== observations.length ||
    observations.length !== facts.artifacts.length ||
    facts.artifacts.some(({ id: artifactId }) => !byId.has(artifactId))) {
    fail("artifact", "Artifact observations must cover every exact Work Boundary artifact once");
  }
  return Object.freeze(facts.artifacts.map((artifact): JsonObject => {
    const observation = byId.get(artifact.id)!;
    if (observation.existence === "absent" && observation.fileKind !== "absent" ||
      observation.existence === "present" && observation.fileKind === "absent" ||
      observation.fileKind === "directory" && observation.contentDigest !== null ||
      observation.fileKind !== "directory" && observation.manifestDigest !== null) {
      fail("artifact", `Artifact observation ${artifact.id} has incoherent physical facts`);
    }
    if (observation.contentDigest !== null) {
      digest(observation.contentDigest, "Artifact content digest");
    }
    if (observation.manifestDigest !== null) {
      digest(observation.manifestDigest, "Artifact manifest digest");
    }
    const state = observation.schemaValidation === "indeterminate" || observation.semanticValidation === "indeterminate" ||
      (artifact.mustChange && observation.change === "indeterminate")
      ? "indeterminate"
      : observation.existence === "present" && ["file", "directory"].includes(observation.fileKind) &&
        (observation.fileKind === "file" ? observation.contentDigest !== null : observation.manifestDigest !== null) &&
        ["valid", "not-required"].includes(observation.schemaValidation) &&
        ["valid", "not-required"].includes(observation.semanticValidation) &&
        (!artifact.mustChange || ["added", "modified"].includes(observation.change)) ? "satisfied" : "failed";
    const sourceRecordIds = sortedIds([
      candidate.id,
      ...checks.filter((check) => {
        const selection = facts.checks.find(({ id: selectionId }) => selectionId === check.selectionId);
        return selection?.obligationIds.some((obligationId) => artifact.obligationIds.includes(obligationId)) === true;
      }).map(({ reference }) => reference.id),
    ], "Artifact source record identity");
    return Object.freeze({
      id: localId("artifact-ledger", Object.freeze({ artifactId: artifact.id })),
      artifactId: artifact.id,
      path: artifact.path,
      fileKind: observation.fileKind,
      existence: observation.existence,
      change: observation.change,
      contentDigest: observation.contentDigest,
      manifestDigest: observation.manifestDigest,
      schemaValidation: observation.schemaValidation,
      semanticValidation: observation.semanticValidation,
      obligationIds: artifact.obligationIds,
      sourceRecordIds,
      limitations: sortedIds(observation.limitationIds ?? [], "Artifact limitation identity", 1024),
      state,
      provenance: "runtime-observed",
    });
  }).sort((left, right) => compareCodePoints(string(left.id, "Artifact ledger identity"), string(right.id, "Artifact ledger identity"))));
}

function descriptionLedger(observations: readonly EvidencePacketDescriptionObservation[], facts: BoundaryFacts, candidate: ExactReference): readonly JsonObject[] {
  if (observations.length > 4096) {
    fail("bound", "Description observations exceed the Evidence profile");
  }
  const seen = new Set<string>();
  const obligationIds = new Set(facts.obligations.map(({ id: obligationId }) => obligationId));
  return Object.freeze(observations.map((observation): JsonObject => {
    if (!PATH_PATTERN.test(observation.path) || observation.path.length > 4096) {
      fail("description", "Description observation path is not one normalized relative path");
    }
    if (seen.has(observation.path)) {
      fail("description", `Description coverage repeats path ${observation.path}`);
    }
    seen.add(observation.path);
    const selectedObligations = sortedIds(observation.obligationIds, "Description obligation identity");
    if (selectedObligations.some((obligationId) => !obligationIds.has(obligationId))) {
      fail("description", "Description observation cites an obligation outside the exact Work Boundary");
    }
    if (observation.descriptionId !== null) {
      id(observation.descriptionId, "Description identity");
    }
    if (observation.selector !== null) {
      singleLine(observation.selector, "Description selector");
    }
    const state = observation.ownership === "indeterminate" ? "indeterminate"
      : observation.ownership === "excluded" ? "not-applicable"
        : observation.ownership === "exact" && observation.descriptionId !== null && observation.selector !== null &&
          observation.descriptionChange !== "absent" ? "satisfied" : "failed";
    return Object.freeze({
      id: localId("description-ledger", Object.freeze({ path: observation.path })),
      path: observation.path,
      descriptionId: observation.descriptionId,
      selector: observation.selector,
      ownership: observation.ownership,
      implementationChange: observation.implementationChange,
      descriptionChange: observation.descriptionChange,
      exclusionChange: observation.exclusionChange,
      obligationIds: selectedObligations,
      sourceRecordIds: Object.freeze([candidate.id]),
      state,
      provenance: "runtime-observed",
    });
  }).sort((left, right) => compareCodePoints(string(left.id, "Description ledger identity"), string(right.id, "Description ledger identity"))));
}

function reviewerIndependence(input: FoundationEvidenceAssessmentInputV1): readonly JsonObject[] {
  const contextSeparation = input.independence.contextSeparation;
  if (!["distinct", "shared", "unobserved"].includes(contextSeparation)) {
    fail("independence", "Independent review requires one established context-separation fact");
  }
  const subjectDisposition = input.observation.reviewerSubjectDisposition;
  const state = contextSeparation === "distinct" && subjectDisposition === "exact-read-only" ? "satisfied"
    : contextSeparation === "shared" || subjectDisposition === "mutated" ? "failed" : "indeterminate";
  return Object.freeze([Object.freeze({
    id: localId("independence", Object.freeze({ ruleId: "rule.independent-review.standard-v1" })),
    ruleId: "rule.independent-review.standard-v1",
    contextSeparation,
    subjectDisposition,
    state,
  })]);
}

function obligationLedger(input: Readonly<{
  facts: BoundaryFacts;
  receiptEntries: readonly JsonObject[];
  propositions: readonly JsonObject[];
  artifacts: readonly JsonObject[];
  descriptions: readonly JsonObject[];
  review: ReturnType<typeof reviewJudgments>;
}>): readonly JsonObject[] {
  const receiptByCheck = new Map<string, JsonObject[]>();
  for (const entry of input.receiptEntries) {
    const checkId = string(entry.checkId, "Receipt-use Check identity");
    const list = receiptByCheck.get(checkId) ?? [];
    list.push(entry);
    receiptByCheck.set(checkId, list);
  }
  const propositions = new Map(input.propositions.map((entry) => [
    string(entry.propositionId, "Proposition-decision proposition identity"),
    entry,
  ]));
  const artifacts = new Map(input.artifacts.map((entry) => [
    string(entry.artifactId, "Artifact-ledger artifact identity"),
    entry,
  ]));
  const missing = new Set(input.review.missingObligationIds);
  return Object.freeze(input.facts.obligations.map((obligation): JsonObject => {
    const checkSelections = input.facts.checks.filter(({ obligationIds }) => obligationIds.includes(obligation.id));
    const receipts = checkSelections.flatMap((selection) => (receiptByCheck.get(selection.id) ?? []).filter((entry) => {
      const phase = entry.phase;
      return phase === "baseline"
        ? selection.baselineRequired
        : phase === "final" ? selection.finalRequired : false;
    }));
    const propositionEntries = obligation.propositionIds.map((propositionId) => propositions.get(propositionId)).filter((value): value is JsonObject => value !== undefined);
    const artifactEntries = obligation.requiredEvidenceArtifactIds.map((artifactId) => artifacts.get(artifactId)).filter((value): value is JsonObject => value !== undefined);
    const descriptionEntries = input.descriptions.filter((entry) => exactStringArray(entry.obligationIds, "Description obligation identities").includes(obligation.id));
    let state: "satisfied" | "failed" | "indeterminate" | "missing" | "not-applicable" | "stale" | "unsupported";
    let reasonCode: string;
    if (missing.has(obligation.id)) {
      state = "missing";
      reasonCode = "reviewer-reported-obligation-missing";
    }
    else if (artifactEntries.length !== obligation.requiredEvidenceArtifactIds.length || propositionEntries.length !== obligation.propositionIds.length) {
      state = "missing";
      reasonCode = "required-evidence-entry-missing";
    }
    else {
      const values = [
        ...receipts.map((entry) => ({
          kind: "receipt",
          state: entry.use === "missing" ? "missing"
            : entry.freshness === "stale" ? "stale"
              : entry.freshness === "indeterminate" ? "indeterminate"
                : string(entry.reasonCode, "Receipt-use reason").includes("illegal") ? "failed" : "satisfied",
        })),
        ...propositionEntries.map((entry) => ({
          kind: "proposition",
          state: entry.validation === "valid" ? "satisfied"
            : entry.validation === "indeterminate" ? "indeterminate" : "failed",
        })),
        ...artifactEntries.map((entry) => ({ kind: "artifact", state: string(entry.state, "Artifact state") })),
        ...descriptionEntries.map((entry) => ({ kind: "description", state: string(entry.state, "Description state") })),
      ];
      if (values.some(({ state: value }) => value === "failed")) {
        state = "failed";
        reasonCode = "evidence-failed";
      }
      else if (values.some(({ state: value }) => value === "missing")) {
        state = "missing";
        reasonCode = "evidence-missing";
      }
      else if (values.some(({ state: value }) => value === "stale")) {
        state = "stale";
        reasonCode = "evidence-stale";
      }
      else if (values.some(({ state: value }) => value === "unsupported")) {
        state = "unsupported";
        reasonCode = "evidence-unsupported";
      }
      else if (values.some(({ state: value }) => value === "indeterminate")) {
        state = "indeterminate";
        reasonCode = "evidence-indeterminate";
      }
      else if (values.length === 0 && obligation.severity === "diagnostic") {
        state = "not-applicable";
        reasonCode = "diagnostic-obligation-not-applicable";
      }
      else if (values.length === 0) {
        state = "missing";
        reasonCode = "obligation-has-no-evidence-route";
      }
      else {
        state = "satisfied";
        reasonCode = "evidence-satisfied";
      }
    }
    return Object.freeze({
      id: localId("obligation-state", Object.freeze({ obligationId: obligation.id })),
      obligationId: obligation.id,
      state,
      checkIds: Object.freeze(checkSelections.map(({ id: checkId }) => checkId).sort()),
      receiptIds: sortedIds(receipts
        .map((entry) => entry.receiptId)
        .filter((value): value is string => typeof value === "string"), "Obligation Receipt identity"),
      propositionDecisionIds: sortedIds(propositionEntries.map((entry) => string(entry.id, "Proposition decision identity")), "Proposition decision identity"),
      artifactLedgerIds: sortedIds(artifactEntries.map((entry) => string(entry.id, "Artifact ledger identity")), "Artifact ledger identity"),
      reasonCode,
      provenance: "runtime-derived",
    });
  }).sort((left, right) => compareCodePoints(string(left.id, "Obligation state identity"), string(right.id, "Obligation state identity"))));
}

function uncertaintyLevel(input: Readonly<{
  review: ReturnType<typeof reviewJudgments>;
  obligations: readonly JsonObject[];
  independence: readonly JsonObject[];
}>): Readonly<{
  level: "none" | "bounded" | "material" | "unknown";
  itemIds: readonly string[];
}> {
  const items: string[] = [];
  for (const judgment of input.review.judgments) {
    if (judgment.uncertainty !== "none") {
      items.push(judgment.id);
    }
  }
  for (const obligation of input.obligations) {
    if (obligation.state !== "satisfied" && obligation.state !== "not-applicable") {
      items.push(string(obligation.id, "Obligation-state identity"));
    }
  }
  for (const entry of input.independence) {
    if (entry.state !== "satisfied") {
      items.push(string(entry.id, "Independence identity"));
    }
  }
  const judgmentLevels = input.review.judgments.map(({ uncertainty }) => uncertainty);
  const level = reviewRequiresMandateResolutionV1(input.review)
    ? "material"
    : input.review.mandateApplicability.disposition === "indeterminate" ||
      input.review.baselineApplicability.some(({ disposition }) => disposition === "indeterminate") || input.review.overallUncertainty === "unknown" || judgmentLevels.includes("unknown") ||
      input.obligations.some(({ state }) => ["indeterminate", "missing", "stale", "unsupported"].includes(String(state))) ||
      input.independence.some(({ state }) => state === "indeterminate")
      ? "unknown"
      : input.review.overallUncertainty === "bounded" || judgmentLevels.includes("bounded")
        ? "bounded"
        : "none";
  return Object.freeze({ level, itemIds: sortedIds(items, "Uncertainty item identity") });
}

function assertReference(value: ExactReference): void {
  id(value.kind, "Evidence source kind");
  id(value.id, "Evidence source identity");
  positiveInteger(value.revision, "Evidence source revision");
  digest(value.digest, "Evidence source digest");
}

function sameReference(left: ExactReference, right: ExactReference): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

export function assessFoundationEvidenceV1(input: FoundationEvidenceAssessmentInputV1) {
  for (const name of ["boundary", "candidate", "seal"] as const) {
    assertReference(input.subject[name]);
    if (!sameReference(input.subject[name], input.observationSubject[name]) ||
      !sameReference(input.subject[name], input.review.subject[name])) {
      fail("subject", "Evidence facts select different exact subjects");
    }
  }
  if (canonicalJson(input.review.subject) !== canonicalJson(input.subject)) {
    fail("subject", "Review applicability selects another exact integration subject");
  }
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(input.subject.parent.commit) ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(input.subject.parent.tree)) {
    fail("subject", "Integration parent has an invalid Git coordinate");
  }
  digest(input.subject.parent.snapshotDigest, "Integration parent Snapshot");
  if (!sameReference(input.observationSubject.integration, input.subject.integration) ||
    canonicalJson(input.observationSubject.parent) !== canonicalJson(input.subject.parent)) {
    fail("subject", "Physical Evidence facts select another exact integration comparison basis");
  }
  for (const source of [input.subject.integration, input.review.reference])
    assertReference(source);
  for (const check of input.checks) {
    assertReference(check.reference);
    if (!sameReference(check.proofSubject, input.subject[check.phase === "baseline" ? "boundary" : "seal"])) {
      fail("check", "Check observation selects a different exact proof subject");
    }
  }
  if (canonicalJson(input.observation.ruleSet) !== canonicalJson(FOUNDATION_EVIDENCE_RULE_SET_V7) ||
    canonicalJson(input.observation.validator) !== canonicalJson(FOUNDATION_EVIDENCE_VALIDATOR_V7)) {
    fail("selection", "Evidence assessment selects unsupported semantic rules");
  }
  for (const values of [input.requirements.checks, input.requirements.obligations, input.requirements.artifacts, input.requirements.propositions]) {
    if (values.length > 4096 || new Set(values.map(({ id }) => id)).size !== values.length) {
      fail("bound", "Evidence requirements repeat identities or exceed the selected bound");
    }
    values.forEach((value) => id(value.id, "Evidence requirement identity"));
  }
  if (input.checks.length > 8192 || input.review.citations.length > 4096 || input.review.judgments.length > 4096 ||
    input.review.baselineApplicability.length > 4096) {
    fail("bound", "Evidence observations exceed selected bounds");
  }
  const diagnostics = input.observation.diagnostics ?? [];
  if (diagnostics.length > 1024 || new Set(diagnostics.map((value) => digestCanonical(value))).size !== diagnostics.length) {
    fail("diagnostic", "Evidence diagnostics repeat or exceed the selected bound");
  }
  for (const diagnostic of diagnostics) {
    id(diagnostic.code, "Evidence diagnostic");
    id(diagnostic.stage, "Evidence diagnostic stage");
    digest(diagnostic.factsDigest, "Evidence diagnostic facts");
  }
  const facts = input.requirements;
  const receipt = receiptLedgers(facts, input.checks, timestamp(input.observation.evaluatedAt, "Evidence assessment time"));
  const review = reviewJudgments(input.review, facts, receipt.usedChecks);
  const propositions = propositionLedger(input.review.reference, facts, review);
  const artifacts = artifactLedger(input.observation.artifacts, facts, input.subject.candidate, receipt.usedChecks);
  const descriptions = descriptionLedger(input.observation.descriptionCoverage, facts, input.subject.candidate);
  const independence = reviewerIndependence(input);
  const obligations = obligationLedger({ facts, receiptEntries: receipt.entries, propositions, artifacts, descriptions, review });
  const uncertainty = uncertaintyLevel({ review, obligations, independence });
  const requiresMandateResolution = reviewRequiresMandateResolutionV1(review);
  const supported = review.mandateApplicability.disposition === "applicable" &&
    review.baselineApplicability.every(({ disposition }) => disposition === "applicable") && receipt.completeAndLegal &&
    review.overallUncertainty !== "unknown" && propositions.every((entry) => entry.validation === "valid") &&
    obligations.every((entry) => entry.state === "satisfied" || entry.state === "not-applicable") &&
    artifacts.every((entry) => entry.state === "satisfied") &&
    descriptions.every((entry) => entry.state === "satisfied" || entry.state === "not-applicable") &&
    independence.every((entry) => entry.state === "satisfied") && (input.observation.diagnostics ?? []).length === 0;
  const disposition = requiresMandateResolution ? "mandate-resolution-required" as const : supported ? "supported" as const
    : uncertainty.level === "unknown" ? "indeterminate" as const : "unmet" as const;
  return Object.freeze({
    disposition,
    requiresMandateResolution,
    artifacts,
    descriptions,
    receiptUse: receipt.entries,
    mandateApplicability: review.mandateApplicability,
    baselineApplicability: review.baselineApplicability,
    independence,
    propositions,
    obligations,
    uncertainty,
  });
}

export type FoundationEvidenceAssessmentV1 = ReturnType<typeof assessFoundationEvidenceV1>;
