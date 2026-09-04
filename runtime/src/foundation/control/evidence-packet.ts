import { FoundationError } from "../error.js";
import {
  digestCanonical,
  type Sha256,
} from "../validation/canonical.js";
import { sortUniqueCodePoints } from "../validation/ordering.js";
import { assertDeliveryControlRecordPolicy } from "./kind-registry.js";
import {
  compileControlRecordRevision,
  controlIdentifier,
  controlTimestamp,
} from "./model.js";
import { assertDeliveryControlRecordPayload } from "./payload-registry.js";
import type { ControlRecordStore } from "./store.js";
import type {
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordEvent,
  ControlRecordRelationship,
  ControlRecordRelationshipTarget,
  ControlRecordRevision,
} from "./types.js";

export type EvidencePacketReadiness =
  | "acceptance-ready"
  | "correctable"
  | "revision-required"
  | "no-ship-recommended";

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
  state: "satisfied" | "failed" | "indeterminate" | "not-applicable";
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
  state: "satisfied" | "failed" | "indeterminate" | "not-applicable";
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
  nonReadyDisposition?: "correctable" | "no-ship-recommended";
  diagnostics?: readonly EvidencePacketDiagnostic[];
  ruleSet: Readonly<{ id: string; digest: Sha256 }>;
  validator: Readonly<{ id: string; digest: Sha256 }>;
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

type BoundaryFacts = Readonly<{
  checks: readonly CheckSelection[];
  obligations: readonly BoundaryObligation[];
  artifacts: readonly BoundaryArtifact[];
  propositions: readonly BoundaryProposition[];
}>;

type RetainedCheck = Readonly<{
  revision: ControlRecordRevision;
  phase: CheckPhase;
  modality: CheckModality;
  disposition: CheckDisposition;
  selectionId: string;
  finishedAt: string | null;
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

type EvaluationRecords = Readonly<{
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
  seal: ControlRecordRevision;
  attempt: ControlRecordRevision;
  workProduct: ControlRecordRevision;
  executionReceipt: ControlRecordRevision;
  materialCondition: ControlRecordRevision | null;
  baselineChecks: readonly RetainedCheck[];
  finalChecks: readonly RetainedCheck[];
  allEvents: readonly ControlRecordEvent[];
}>;

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)[^\u0000-\u001f\u007f]+$/u;
const SINGLE_LINE_PATTERN = /^[^\u0000-\u001f\u007f-\u009f\u2028\u2029]+$/u;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.control-evidence-packet.${code}`, message);
}

function object(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== "object") {
    fail("retained-fact", `${label} must be one exact retained object`);
  }
  return value as ControlJsonObject;
}

function array(value: ControlJsonValue | undefined, label: string): readonly ControlJsonValue[] {
  if (!Array.isArray(value)) fail("retained-fact", `${label} must be one exact retained array`);
  return value;
}

function string(value: ControlJsonValue | undefined, label: string): string {
  if (typeof value !== "string") fail("retained-fact", `${label} must be retained text`);
  return value;
}

function boolean(value: ControlJsonValue | undefined, label: string): boolean {
  if (typeof value !== "boolean") fail("retained-fact", `${label} must be one retained boolean`);
  return value;
}

function positiveInteger(value: ControlJsonValue | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    fail("retained-fact", `${label} must be one positive safe integer`);
  }
  return value;
}

function digest(value: ControlJsonValue | undefined, label: string): Sha256 {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail("retained-fact", `${label} must be one lowercase SHA-256 digest`);
  }
  return value as Sha256;
}

function id(value: string, label: string): string {
  const normalized = controlIdentifier(value, label);
  if (Buffer.byteLength(normalized, "utf8") > 512) fail("bound", `${label} exceeds its bound`);
  return normalized;
}

function singleLine(value: string, label: string): string {
  if (
    value.length < 1 ||
    Buffer.byteLength(value, "utf8") > 4_096 ||
    !SINGLE_LINE_PATTERN.test(value)
  ) fail("observation", `${label} must be one bounded printable line`);
  return value;
}

function sortedIds(values: readonly string[], label: string, maximum = 4_096): readonly string[] {
  if (values.length > maximum) fail("bound", `${label} exceeds its item bound`);
  return Object.freeze(sortUniqueCodePoints(values.map((value) => id(value, label))));
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactReference(revision: ControlRecordRevision): ExactReference {
  return Object.freeze({
    kind: revision.recordKind,
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function sameReference(
  left: Readonly<{ id: string; revision: number; digest: Sha256 }> | null,
  right: Readonly<{ id: string; revision: number; digest: Sha256 }>,
): boolean {
  return left !== null &&
    left.id === right.id &&
    left.revision === right.revision &&
    left.digest === right.digest;
}

function relationshipTargets(
  revision: ControlRecordRevision,
  relation: string,
  targetKind: string,
): readonly ControlRecordRelationshipTarget[] {
  const targets = revision.relationships
    .filter((item) => item.relation === relation)
    .map(({ target }) => {
      if (target.kind !== targetKind) {
        fail("relationship", `${revision.recordKind} ${relation} must target ${targetKind}`);
      }
      return target;
    });
  return Object.freeze(targets);
}

function oneRelationship(
  revision: ControlRecordRevision,
  relation: string,
  targetKind: string,
): ControlRecordRelationshipTarget {
  const targets = relationshipTargets(revision, relation, targetKind);
  if (targets.length !== 1) {
    fail("relationship", `${revision.recordKind} requires exactly one ${relation} relationship`);
  }
  return targets[0]!;
}

function assertRelationship(
  revision: ControlRecordRevision,
  relation: string,
  target: ControlRecordRevision,
): void {
  if (!sameReference(oneRelationship(revision, relation, target.recordKind), exactReference(target))) {
    fail("relationship", `${revision.recordKind} ${relation} does not bind the exact ${target.recordKind} revision`);
  }
}

function retainedSubject(
  store: ControlRecordStore,
  event: ControlRecordEvent,
  kind: string,
): ControlRecordRevision {
  if (event.subject === null) fail("journal", `${event.eventKind} lacks its required subject`);
  const revision = store.getRevision(event.subject.recordId, event.subject.revision);
  if (
    revision === null ||
    revision.recordKind !== kind ||
    revision.digest !== event.subject.digest
  ) fail("journal", `${event.eventKind} does not bind one exact retained ${kind} revision`);
  return revision;
}

function activityId(event: ControlRecordEvent): string | null {
  const value = event.payload.activityId;
  return typeof value === "string" ? value : null;
}

function allEvents(store: ControlRecordStore): readonly ControlRecordEvent[] {
  const events: ControlRecordEvent[] = [];
  let after = 0;
  for (;;) {
    const page = store.listEvents(after, 10_000);
    events.push(...page);
    if (page.length < 10_000) break;
    after = page.at(-1)!.sequence;
  }
  const state = store.state();
  if (
    events.length !== state.journal.eventCount ||
    (events.at(-1)?.digest ?? null) !== state.journal.headDigest
  ) fail("journal", "Evidence compilation did not observe the exact current Journal head");
  return Object.freeze(events);
}

function uniqueEvent(
  events: readonly ControlRecordEvent[],
  kind: string,
  required: boolean,
): ControlRecordEvent | null {
  const matches = events.filter((event) => event.eventKind === kind);
  if (matches.length > 1 || (required && matches.length !== 1)) {
    fail("journal", `Evaluation activity must have ${required ? "exactly" : "at most"} one ${kind} event`);
  }
  return matches[0] ?? null;
}

function exactCurrentRevision(
  store: ControlRecordStore,
  kind: string,
  reference: Readonly<{ id: string; revision: number; digest: Sha256 }> | null,
): ControlRecordRevision {
  if (reference === null) fail("standing", `Evidence compilation requires one current ${kind}`);
  const revision = store.getRevision(reference.id, reference.revision);
  if (revision === null || revision.recordKind !== kind || revision.digest !== reference.digest) {
    fail("standing", `Current ${kind} does not resolve to one exact retained revision`);
  }
  return revision;
}

function parseCheck(revision: ControlRecordRevision): RetainedCheck {
  if (revision.payload.schema !== "lifecycle.check-receipt-payload.v2") {
    fail("check", "Evidence compilation encountered a non-Foundation Check Receipt payload");
  }
  const phase = string(revision.payload.phase, "Check Receipt phase");
  const modality = string(revision.payload.modality, "Check Receipt modality");
  const disposition = string(revision.payload.disposition, "Check Receipt disposition");
  if (!(phase === "baseline" || phase === "final")) fail("check", "Check Receipt phase is unsupported");
  if (!(["precondition", "repair-target", "regression-guard", "postcondition", "diagnostic"] as const).includes(modality as CheckModality)) {
    fail("check", "Check Receipt modality is unsupported");
  }
  if (!(["pass", "fail", "indeterminate", "not-run", "unsupported", "operational-error"] as const).includes(disposition as CheckDisposition)) {
    fail("check", "Check Receipt disposition is unsupported");
  }
  const finished = revision.payload.finishedAt;
  if (finished !== null && typeof finished !== "string") fail("check", "Check Receipt finish time is invalid");
  return Object.freeze({
    revision,
    phase,
    modality: modality as CheckModality,
    disposition: disposition as CheckDisposition,
    selectionId: id(string(revision.payload.selectionId, "Check selection identity"), "Check selection identity"),
    finishedAt: finished,
  });
}

function evaluationRecords(store: ControlRecordStore, exactActivityId: string): EvaluationRecords {
  const state = store.state();
  const activity = state.activities.find(({ id: candidate }) => candidate === exactActivityId);
  if (
    activity === undefined ||
    activity.operation !== "delivery.evaluate" ||
    activity.family !== "agent" ||
    activity.stage !== "finalizing" ||
    state.subjects.evidence !== null
  ) fail("activity", "Evidence Packet compilation requires one exact unfinalized evaluation activity");

  const boundary = exactCurrentRevision(store, "work-boundary", state.subjects.activeBoundary);
  const candidate = exactCurrentRevision(store, "candidate-revision", state.subjects.candidate);
  const seal = exactCurrentRevision(store, "candidate-seal", state.subjects.seal);
  assertRelationship(seal, "governed-by", boundary);
  assertRelationship(seal, "seals", candidate);

  const events = allEvents(store);
  const evaluationEvents = events.filter((event) => activityId(event) === exactActivityId);
  const attempt = retainedSubject(store, uniqueEvent(evaluationEvents, "agent-attempt-prepared", true)!, "agent-attempt");
  const workProduct = retainedSubject(store, uniqueEvent(evaluationEvents, "agent-work-product-submitted", true)!, "agent-work-product");
  const executionReceipt = retainedSubject(store, uniqueEvent(evaluationEvents, "execution-receipt-recorded", true)!, "execution-receipt");
  const sealFromEvent = retainedSubject(store, uniqueEvent(evaluationEvents, "candidate-sealed", true)!, "candidate-seal");
  if (!sameReference(exactReference(sealFromEvent), exactReference(seal))) {
    fail("journal", "Evaluation activity did not seal the exact current Candidate Seal");
  }

  if (
    attempt.payload.schema !== "lifecycle.agent-attempt-payload.v3" ||
    attempt.payload.activityId !== exactActivityId ||
    attempt.payload.operation !== "delivery.evaluate" ||
    attempt.payload.role !== "reviewer"
  ) fail("review", "Evaluation Agent Attempt is not one exact reviewer invocation");
  assertRelationship(attempt, "uses-boundary", boundary);
  assertRelationship(attempt, "uses-candidate", candidate);
  assertRelationship(attempt, "uses-seal", seal);
  const attemptInput = object(attempt.payload.input, "Reviewer Attempt input");
  digest(attemptInput.evidenceSetDigest, "Reviewer evidence-set digest");
  digest(attemptInput.propositionSetDigest, "Reviewer proposition-set digest");

  if (
    workProduct.payload.schema !== "lifecycle.agent-work-product-payload.v2" ||
    workProduct.payload.role !== "reviewer"
  ) fail("review", "Evaluation Work Product is not one reviewer Work Product");
  assertRelationship(workProduct, "result-of", attempt);

  if (
    executionReceipt.payload.schema !== "lifecycle.execution-receipt-payload.v3" ||
    executionReceipt.payload.activityId !== exactActivityId ||
    executionReceipt.payload.productiveExecutionStarted !== true
  ) fail("review-receipt", "Reviewer Execution Receipt does not establish productive execution");
  assertRelationship(executionReceipt, "observes-attempt", attempt);
  assertRelationship(executionReceipt, "observes-work-product", workProduct);
  if (relationshipTargets(executionReceipt, "observes-candidate", "candidate-revision").length !== 0) {
    fail("review-receipt", "Reviewer Execution Receipt cannot observe a Candidate successor");
  }
  const providerEffect = object(executionReceipt.payload.providerEffect, "Reviewer provider effect");
  const workspace = object(executionReceipt.payload.workspace, "Reviewer semantic workspace");
  const execution = object(executionReceipt.payload.execution, "Reviewer execution");
  const output = object(execution.output, "Reviewer execution output");
  const workProductBinding = object(executionReceipt.payload.workProduct, "Reviewer Work Product binding");
  const candidateBinding = object(executionReceipt.payload.candidate, "Reviewer Candidate binding");
  const candidateInput = object(candidateBinding.input, "Reviewer input Candidate binding");
  const candidateInputRevision = object(
    candidateInput.revision,
    "Reviewer input Candidate Revision",
  );
  const containment = object(executionReceipt.payload.containment, "Reviewer Execution Containment");
  const retirement = object(executionReceipt.payload.retirement, "Reviewer Execution Retirement");
  if (
    providerEffect.outcome !== "completed" ||
    workspace.availability !== "available" ||
    workspace.parserDisposition !== "valid" ||
    workspace.compilerDisposition !== "retained" ||
    workProductBinding.disposition !== "submitted" ||
    output.availability !== "retrieved" ||
    !sameReference(
      {
        id: string(candidateInputRevision.id, "Reviewer input Candidate identity"),
        revision: positiveInteger(
          candidateInputRevision.revision,
          "Reviewer input Candidate revision",
        ),
        digest: digest(candidateInputRevision.digest, "Reviewer input Candidate digest"),
      },
      exactReference(candidate),
    ) || candidateBinding.successor !== null ||
    containment.classification !== "contained" || retirement.classification !== "retired"
  ) fail("review-receipt", "Reviewer Execution Receipt does not prove one valid contained submission");

  const materialEvent = uniqueEvent(evaluationEvents, "material-condition-frozen", false);
  const materialCondition = state.subjects.materialCondition === null
    ? null
    : exactCurrentRevision(store, "material-condition", state.subjects.materialCondition);
  if ((materialEvent === null) !== (materialCondition === null)) {
    fail("material-condition", "Evaluation Material Condition does not match the exact current Delivery subject");
  }
  if (materialCondition !== null) {
    const eventCondition = retainedSubject(store, materialEvent!, "material-condition");
    if (!sameReference(exactReference(eventCondition), exactReference(materialCondition))) {
      fail("material-condition", "Evaluation froze a different Material Condition from the current Delivery subject");
    }
    assertRelationship(materialCondition, "reported-by", workProduct);
    assertRelationship(materialCondition, "observed-in", executionReceipt);
    assertRelationship(materialCondition, "freezes", candidate);
    assertRelationship(materialCondition, "governed-by", boundary);
  }

  const finalChecks = evaluationEvents
    .filter((event) => event.eventKind === "check-receipt-recorded")
    .map((event) => parseCheck(retainedSubject(store, event, "check-receipt")));
  for (const check of finalChecks) {
    if (check.phase !== "final") fail("check", "Evaluation activity retained a non-final Check Receipt");
    assertRelationship(check.revision, "checks-seal", seal);
  }

  const baselineChecks = events
    .filter((event) => event.eventKind === "check-receipt-recorded")
    .map((event) => parseCheck(retainedSubject(store, event, "check-receipt")))
    .filter((check) => check.phase === "baseline" && relationshipTargets(
      check.revision,
      "checks-boundary",
      "work-boundary",
    ).some((target) => sameReference(target, exactReference(boundary))));
  for (const check of baselineChecks) assertRelationship(check.revision, "checks-boundary", boundary);

  return Object.freeze({
    boundary,
    candidate,
    seal,
    attempt,
    workProduct,
    executionReceipt,
    materialCondition,
    baselineChecks: Object.freeze(baselineChecks),
    finalChecks: Object.freeze(finalChecks),
    allEvents: events,
  });
}

function exactStringArray(value: ControlJsonValue | undefined, label: string): readonly string[] {
  return Object.freeze(array(value, label).map((item) => string(item, label)));
}

function boundaryFacts(revision: ControlRecordRevision): BoundaryFacts {
  if (revision.payload.schema !== "lifecycle.work-boundary-payload.v4") {
    fail("boundary", "Evidence compilation requires one Foundation Work Boundary payload");
  }
  const mandate = object(revision.payload.mandate, "Work Boundary mandate");
  const checks = Object.freeze(array(mandate.checks, "Work Boundary checks").map((value): CheckSelection => {
    const check = object(value, "Work Boundary Check selection");
    const definition = object(check.definition, "Check Definition reference");
    const bindings = Object.freeze(array(check.bindings, "Check Binding selection").map((item) => {
      const binding = object(item, "Check Binding reference");
      return Object.freeze({
        id: id(string(binding.id, "Check Binding identity"), "Check Binding identity"),
        digest: digest(binding.digest, "Check Binding digest"),
        implementationDigest: digest(binding.implementationDigest, "Check Binding implementation digest"),
      });
    }));
    if (bindings.length < 1) fail("boundary", "Each Check selection requires at least one exact Binding");
    const modality = string(check.modality, "Check modality") as CheckModality;
    if (!(["precondition", "repair-target", "regression-guard", "postcondition", "diagnostic"] as const).includes(modality)) {
      fail("boundary", "Work Boundary Check modality is unsupported");
    }
    return Object.freeze({
      id: id(string(check.id, "Check selection identity"), "Check selection identity"),
      definition: Object.freeze({
        id: id(string(definition.id, "Check Definition identity"), "Check Definition identity"),
        revision: positiveInteger(definition.revision, "Check Definition revision"),
        sourceDigest: digest(definition.sourceDigest, "Check Definition source digest"),
        semanticDigest: digest(definition.semanticDigest, "Check Definition semantic digest"),
      }),
      bindings,
      modality,
      baselineRequired: boolean(check.baselineRequired, "Check baseline requirement"),
      finalRequired: boolean(check.finalRequired, "Check final requirement"),
      obligationIds: sortedIds(exactStringArray(check.obligationIds, "Check obligation identities"), "Check obligation identity"),
      environmentRequirements: Object.freeze(sortUniqueCodePoints(
        exactStringArray(check.environmentRequirements, "Check environment requirements"),
      )),
    });
  }));
  const obligations = Object.freeze(array(mandate.obligations, "Work Boundary obligations").map((value): BoundaryObligation => {
    const obligation = object(value, "Work Boundary obligation");
    const severity = string(obligation.severity, "Obligation severity");
    if (!(severity === "required" || severity === "diagnostic")) fail("boundary", "Obligation severity is unsupported");
    return Object.freeze({
      id: id(string(obligation.id, "Obligation identity"), "Obligation identity"),
      severity,
      requiredEvidenceArtifactIds: sortedIds(
        exactStringArray(obligation.requiredEvidenceArtifactIds, "Required Evidence artifact identities"),
        "Required Evidence artifact identity",
      ),
      propositionIds: sortedIds(
        exactStringArray(obligation.propositionIds, "Obligation proposition identities"),
        "Obligation proposition identity",
      ),
    });
  }));
  const artifacts = Object.freeze(array(mandate.artifacts, "Work Boundary artifacts").map((value): BoundaryArtifact => {
    const artifact = object(value, "Work Boundary artifact");
    return Object.freeze({
      id: id(string(artifact.id, "Boundary artifact identity"), "Boundary artifact identity"),
      path: string(artifact.path, "Boundary artifact path"),
      mustChange: boolean(artifact.mustChange, "Boundary artifact change requirement"),
      obligationIds: sortedIds(exactStringArray(artifact.obligationIds, "Artifact obligation identities"), "Artifact obligation identity"),
    });
  }));
  const propositions = Object.freeze(array(mandate.acceptancePropositions, "Work Boundary propositions").map((value): BoundaryProposition => {
    const proposition = object(value, "Work Boundary proposition");
    const notApplicableCondition = proposition.notApplicableCondition;
    if (notApplicableCondition !== null && typeof notApplicableCondition !== "string") {
      fail("boundary", "Proposition not-applicable condition is invalid");
    }
    return Object.freeze({
      id: id(string(proposition.id, "Proposition identity"), "Proposition identity"),
      obligationIds: sortedIds(exactStringArray(proposition.obligationIds, "Proposition obligation identities"), "Proposition obligation identity"),
      allowNotApplicable: boolean(proposition.allowNotApplicable, "Proposition not-applicable permission"),
      notApplicableCondition,
    });
  }));
  for (const [label, values] of [
    ["Check", checks.map(({ id: value }) => value)],
    ["obligation", obligations.map(({ id: value }) => value)],
    ["artifact", artifacts.map(({ id: value }) => value)],
    ["proposition", propositions.map(({ id: value }) => value)],
  ] as const) {
    if (new Set(values).size !== values.length) fail("boundary", `Work Boundary repeats a ${label} identity`);
  }
  return Object.freeze({ checks, obligations, artifacts, propositions });
}

function checkMatchesSelection(check: RetainedCheck, selection: CheckSelection): void {
  if (check.selectionId !== selection.id || check.modality !== selection.modality) {
    fail("check", "Check Receipt does not reproduce its exact Work Boundary selection");
  }
  const definition = object(check.revision.payload.definition, "Check Receipt Definition");
  if (
    definition.id !== selection.definition.id ||
    definition.revision !== selection.definition.revision ||
    definition.sourceDigest !== selection.definition.sourceDigest ||
    definition.semanticDigest !== selection.definition.semanticDigest
  ) fail("check", "Check Receipt substitutes its selected Check Definition");
  const binding = object(check.revision.payload.binding, "Check Receipt Binding");
  if (!selection.bindings.some((candidate) =>
    binding.id === candidate.id &&
    binding.digest === candidate.digest &&
    binding.implementationDigest === candidate.implementationDigest
  )) fail("check", "Check Receipt substitutes its selected Check Binding");
  const environment = object(check.revision.payload.environment, "Check Receipt environment");
  const requested = Object.freeze(sortUniqueCodePoints(exactStringArray(
    environment.requested,
    "Check Receipt requested conditions",
  )));
  if (digestCanonical(requested) !== digestCanonical(selection.environmentRequirements)) {
    fail("check", "Check Receipt requested conditions differ from its exact Work Boundary selection");
  }
}

function legalBaseline(check: RetainedCheck): boolean {
  if (check.phase !== "baseline") return false;
  if (check.modality === "precondition" || check.modality === "regression-guard") {
    return check.disposition === "pass";
  }
  if (check.modality === "repair-target") {
    return check.disposition === "pass" || check.disposition === "fail";
  }
  if (check.modality === "postcondition") return check.disposition === "not-run";
  return true;
}

function legalFinal(check: RetainedCheck): boolean {
  return check.phase === "final" &&
    (check.modality === "diagnostic" || check.disposition === "pass");
}

function localId(prefix: string, value: ControlJsonObject): string {
  return `${prefix}.${digestCanonical(value).slice("sha256:".length)}`;
}

function receiptLedgers(
  facts: BoundaryFacts,
  records: EvaluationRecords,
  evaluatedAt: string,
): Readonly<{
  entries: readonly ControlJsonObject[];
  usedChecks: readonly RetainedCheck[];
  completeAndLegal: boolean;
}> {
  const evaluatedMs = Date.parse(evaluatedAt);
  const byCoordinate = new Map<string, RetainedCheck>();
  for (const check of [...records.baselineChecks, ...records.finalChecks]) {
    const key = `${check.phase}\u0000${check.selectionId}`;
    if (byCoordinate.has(key)) fail("check", `Evidence has more than one ${check.phase} Receipt for ${check.selectionId}`);
    byCoordinate.set(key, check);
  }
  const selections = new Map(facts.checks.map((selection) => [selection.id, selection]));
  for (const check of byCoordinate.values()) {
    const selection = selections.get(check.selectionId);
    if (selection === undefined) fail("check", `Check Receipt selects unknown boundary Check ${check.selectionId}`);
    checkMatchesSelection(check, selection);
  }

  let completeAndLegal = true;
  const entries: ControlJsonObject[] = [];
  for (const selection of facts.checks) {
    for (const phase of ["baseline", "final"] as const) {
      const check = byCoordinate.get(`${phase}\u0000${selection.id}`) ?? null;
      const required = phase === "baseline" ? selection.baselineRequired : selection.finalRequired;
      if (check === null && required) completeAndLegal = false;
      if (check !== null && !(phase === "baseline" ? legalBaseline(check) : legalFinal(check))) {
        if (required || selection.modality !== "diagnostic") completeAndLegal = false;
      }
      let ageMs: number | null = null;
      let freshness: "fresh" | "stale" | "not-applicable" | "indeterminate";
      if (check === null) {
        freshness = required ? "indeterminate" : "not-applicable";
      } else if (check.finishedAt === null) {
        freshness = "indeterminate";
        completeAndLegal = false;
      } else {
        const finishedMs = Date.parse(controlTimestamp(check.finishedAt, "Check Receipt finish time"));
        ageMs = evaluatedMs - finishedMs;
        if (ageMs < 0) {
          freshness = "stale";
          completeAndLegal = false;
        } else {
          freshness = "fresh";
        }
      }
      const value: ControlJsonObject = Object.freeze({
        id: localId("receipt-use", Object.freeze({ checkId: selection.id, phase })),
        checkId: selection.id,
        phase,
        receiptId: check?.revision.recordId ?? null,
        use: check === null ? required ? "missing" : "excluded" : "executed",
        freshness,
        subjectEquivalence: check === null ? "indeterminate" : "exact",
        ageMs,
        maximumAgeMs: null,
        reasonCode: check === null
          ? required ? "required-receipt-missing" : "receipt-not-required"
          : freshness === "stale" ? "receipt-finished-after-evaluation"
            : phase === "baseline" ? legalBaseline(check) ? "baseline-receipt-current" : "baseline-disposition-illegal"
              : legalFinal(check) ? "final-receipt-current" : "final-disposition-illegal",
        provenance: "runtime-derived",
      });
      entries.push(value);
    }
  }
  return Object.freeze({
    entries: Object.freeze(entries.sort((left, right) => compareCodePoints(
      string(left.id, "Receipt-use identity"),
      string(right.id, "Receipt-use identity"),
    ))),
    usedChecks: Object.freeze([...byCoordinate.values()].sort((left, right) =>
      compareCodePoints(left.revision.recordId, right.revision.recordId))),
    completeAndLegal,
  });
}

function reviewJudgments(
  workProduct: ControlRecordRevision,
  facts: BoundaryFacts,
): Readonly<{
  judgments: readonly ReviewJudgment[];
  mandateExcess: boolean;
  missingObligationIds: readonly string[];
  overallUncertainty: "none" | "bounded" | "material" | "unknown";
}> {
  const semantics = object(workProduct.payload.roleSemantics, "Reviewer role semantics");
  if (semantics.role !== "reviewer") fail("review", "Reviewer Work Product lacks reviewer role semantics");
  const citations = array(workProduct.payload.citations, "Reviewer citations").map((value) => {
    const citation = object(value, "Reviewer citation");
    return Object.freeze({
      id: id(string(citation.id, "Citation identity"), "Citation identity"),
      subjectId: id(string(citation.subjectId, "Citation subject identity"), "Citation subject identity"),
    });
  });
  const citationById = new Map(citations.map((citation) => [citation.id, citation]));
  if (citationById.size !== citations.length) fail("review", "Reviewer Work Product repeats a citation identity");
  const judgments = array(semantics.judgments, "Reviewer judgments").map((value): ReviewJudgment => {
    const judgment = object(value, "Reviewer judgment");
    const citationIds = sortedIds(exactStringArray(judgment.citationIds, "Judgment citation identities"), "Judgment citation identity");
    if (citationIds.length < 1) fail("review", "Every reviewer judgment requires at least one exact citation");
    const derivedSubjects = sortedIds(citationIds.map((citationId) => {
      const citation = citationById.get(citationId);
      if (citation === undefined) fail("review", `Reviewer judgment cites unknown citation ${citationId}`);
      return citation.subjectId;
    }), "Inspected subject identity");
    const retainedSubjects = sortedIds(
      exactStringArray(judgment.inspectedSubjectIds, "Judgment inspected subject identities"),
      "Judgment inspected subject identity",
    );
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
  if (byProposition.size !== judgments.length) fail("review", "Reviewer Work Product repeats a proposition judgment");
  if (
    judgments.length !== facts.propositions.length ||
    facts.propositions.some(({ id: propositionId }) => !byProposition.has(propositionId))
  ) fail("review", "Reviewer Work Product does not judge every exact Work Boundary proposition once");
  const uncertainty = object(workProduct.payload.uncertainty, "Reviewer overall uncertainty");
  const overall = string(uncertainty.level, "Reviewer overall uncertainty level");
  if (!(["none", "bounded", "material", "unknown"] as const).includes(overall as ReviewJudgment["uncertainty"])) {
    fail("review", "Reviewer overall uncertainty is unsupported");
  }
  return Object.freeze({
    judgments: Object.freeze(judgments.sort((left, right) => compareCodePoints(
      left.propositionId,
      right.propositionId,
    ))),
    mandateExcess: boolean(semantics.mandateExcess, "Reviewer mandate-excess result"),
    missingObligationIds: sortedIds(
      exactStringArray(semantics.missingObligationIds, "Reviewer missing-obligation identities"),
      "Reviewer missing-obligation identity",
    ),
    overallUncertainty: overall as ReviewJudgment["uncertainty"],
  });
}

function propositionLedger(
  workProduct: ControlRecordRevision,
  facts: BoundaryFacts,
  review: ReturnType<typeof reviewJudgments>,
): readonly ControlJsonObject[] {
  const propositions = new Map(facts.propositions.map((value) => [value.id, value]));
  return Object.freeze(review.judgments.map((judgment): ControlJsonObject => {
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
      reviewWorkProductId: workProduct.recordId,
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

function artifactLedger(
  observations: readonly EvidencePacketArtifactObservation[],
  facts: BoundaryFacts,
  candidate: ControlRecordRevision,
  checks: readonly RetainedCheck[],
): readonly ControlJsonObject[] {
  if (observations.length > 4_096) fail("bound", "Artifact observations exceed the Evidence profile");
  const byId = new Map(observations.map((value) => [value.artifactId, value]));
  if (
    byId.size !== observations.length ||
    observations.length !== facts.artifacts.length ||
    facts.artifacts.some(({ id: artifactId }) => !byId.has(artifactId))
  ) fail("artifact", "Artifact observations must cover every exact Work Boundary artifact once");
  return Object.freeze(facts.artifacts.map((artifact): ControlJsonObject => {
    const observation = byId.get(artifact.id)!;
    if (
      observation.existence === "absent" && observation.fileKind !== "absent" ||
      observation.existence === "present" && observation.fileKind === "absent" ||
      observation.fileKind === "directory" && observation.contentDigest !== null ||
      observation.fileKind !== "directory" && observation.manifestDigest !== null
    ) fail("artifact", `Artifact observation ${artifact.id} has incoherent physical facts`);
    if (artifact.mustChange && !["added", "modified", "deleted"].includes(observation.change)) {
      if (observation.state === "satisfied") {
        fail("artifact", `Artifact ${artifact.id} cannot satisfy mustChange without one exact change`);
      }
    }
    const sourceRecordIds = sortedIds([
      candidate.recordId,
      ...checks.filter((check) => {
        const selection = facts.checks.find(({ id: selectionId }) => selectionId === check.selectionId);
        return selection?.obligationIds.some((obligationId) => artifact.obligationIds.includes(obligationId)) === true;
      }).map(({ revision }) => revision.recordId),
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
      limitations: sortedIds(observation.limitationIds ?? [], "Artifact limitation identity", 1_024),
      state: observation.state,
      provenance: "runtime-observed",
    });
  }).sort((left, right) => compareCodePoints(
    string(left.id, "Artifact ledger identity"),
    string(right.id, "Artifact ledger identity"),
  )));
}

function descriptionLedger(
  observations: readonly EvidencePacketDescriptionObservation[],
  facts: BoundaryFacts,
  candidate: ControlRecordRevision,
): readonly ControlJsonObject[] {
  if (observations.length > 4_096) fail("bound", "Description observations exceed the Evidence profile");
  const seen = new Set<string>();
  const obligationIds = new Set(facts.obligations.map(({ id: obligationId }) => obligationId));
  return Object.freeze(observations.map((observation): ControlJsonObject => {
    if (!PATH_PATTERN.test(observation.path) || observation.path.length > 4_096) {
      fail("description", "Description observation path is not one normalized relative path");
    }
    if (seen.has(observation.path)) fail("description", `Description coverage repeats path ${observation.path}`);
    seen.add(observation.path);
    const selectedObligations = sortedIds(observation.obligationIds, "Description obligation identity");
    if (selectedObligations.some((obligationId) => !obligationIds.has(obligationId))) {
      fail("description", "Description observation cites an obligation outside the exact Work Boundary");
    }
    if (observation.descriptionId !== null) id(observation.descriptionId, "Description identity");
    if (observation.selector !== null) singleLine(observation.selector, "Description selector");
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
      sourceRecordIds: Object.freeze([candidate.recordId]),
      state: observation.state,
      provenance: "runtime-observed",
    });
  }).sort((left, right) => compareCodePoints(
    string(left.id, "Description ledger identity"),
    string(right.id, "Description ledger identity"),
  )));
}

function reviewerIndependence(
  store: ControlRecordStore,
  records: EvaluationRecords,
  subjectDisposition: EvidencePacketObservation["reviewerSubjectDisposition"],
): readonly ControlJsonObject[] {
  const attemptCapability = object(records.attempt.payload.capability, "Reviewer Attempt capability");
  const projection = object(records.attempt.payload.projection, "Reviewer Attempt Projection");
  const receiptProvider = object(records.executionReceipt.payload.provider, "Reviewer Receipt provider");
  const reviewerSession = receiptProvider.sessionId;
  let providerSession: "fresh" | "reused" | "indeterminate" = "indeterminate";
  if (typeof reviewerSession === "string") {
    const priorBuilderSessions = records.allEvents
      .filter((event) => event.eventKind === "execution-receipt-recorded" && event.sequence < records.allEvents.at(-1)!.sequence)
      .map((event) => {
        if (event.subject === null) return null;
        const revision = store.getRevision(event.subject.recordId, event.subject.revision);
        return revision !== null && revision.digest === event.subject.digest ? revision : null;
      })
      .filter((revision): revision is ControlRecordRevision => revision !== null)
      .filter((revision) => {
        const attemptTarget = relationshipTargets(revision, "observes-attempt", "agent-attempt")[0];
        if (attemptTarget === undefined) return false;
        const attempt = store.getRevision(attemptTarget.id, attemptTarget.revision);
        if (
          attempt === null ||
          attempt.recordKind !== attemptTarget.kind ||
          attempt.digest !== attemptTarget.digest
        ) fail("relationship", "Prior Execution Receipt has an invalid Attempt relationship");
        return attempt?.payload.role === "builder";
      })
      .map((revision) => object(revision.payload.provider, "Prior builder Receipt provider").sessionId)
      .filter((value): value is string => typeof value === "string");
    providerSession = priorBuilderSessions.includes(reviewerSession) ? "reused" : "fresh";
  }
  const state = providerSession === "fresh" && subjectDisposition === "exact-read-only"
    ? "satisfied"
    : providerSession === "reused" || subjectDisposition === "mutated"
      ? "failed"
      : "indeterminate";
  return Object.freeze([Object.freeze({
    id: localId("independence", Object.freeze({ ruleId: "rule.independent-review.standard-v1" })),
    ruleId: "rule.independent-review.standard-v1",
    attemptId: records.attempt.recordId,
    workProductId: records.workProduct.recordId,
    receiptId: records.executionReceipt.recordId,
    capabilityDigest: digest(attemptCapability.profileDigest, "Reviewer capability profile digest"),
    projectionDigest: digest(projection.digest, "Reviewer Projection digest"),
    providerSession,
    subjectDisposition,
    state,
    provenance: "runtime-derived",
  })]);
}

function invalidationLedger(records: EvaluationRecords, checks: readonly RetainedCheck[]): readonly ControlJsonObject[] {
  const entries: ControlJsonObject[] = [];
  const push = (
    subject: ControlRecordRevision,
    dependencyClass: string,
    currentInputId: string,
  ) => entries.push(Object.freeze({
    id: localId("invalidation", Object.freeze({
      subjectRecordId: subject.recordId,
      dependencyClass,
      currentInputId,
    })),
    subjectRecordId: subject.recordId,
    dependencyClass,
    currentInputId,
    causeIds: Object.freeze([]),
    state: "current",
    reasonCode: "exact-input-current",
    provenance: "runtime-derived",
  }));
  push(records.seal, "candidate", records.candidate.recordId);
  push(records.seal, "boundary", records.boundary.recordId);
  for (const check of checks) {
    push(
      check.revision,
      check.phase === "baseline" ? "boundary" : "candidate",
      check.phase === "baseline" ? records.boundary.recordId : records.seal.recordId,
    );
  }
  push(records.workProduct, "reviewer-subject", records.seal.recordId);
  push(records.executionReceipt, "reviewer-subject", records.attempt.recordId);
  return Object.freeze(entries.sort((left, right) => compareCodePoints(
    string(left.id, "Invalidation identity"),
    string(right.id, "Invalidation identity"),
  )));
}

function obligationLedger(input: Readonly<{
  facts: BoundaryFacts;
  receiptEntries: readonly ControlJsonObject[];
  propositions: readonly ControlJsonObject[];
  artifacts: readonly ControlJsonObject[];
  descriptions: readonly ControlJsonObject[];
  review: ReturnType<typeof reviewJudgments>;
}>): readonly ControlJsonObject[] {
  const receiptByCheck = new Map<string, ControlJsonObject[]>();
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
  return Object.freeze(input.facts.obligations.map((obligation): ControlJsonObject => {
    const checkSelections = input.facts.checks.filter(({ obligationIds }) => obligationIds.includes(obligation.id));
    const receipts = checkSelections.flatMap((selection) =>
      (receiptByCheck.get(selection.id) ?? []).filter((entry) => {
        const phase = entry.phase;
        return phase === "baseline"
          ? selection.baselineRequired
          : phase === "final" ? selection.finalRequired : false;
      }));
    const propositionEntries = obligation.propositionIds.map((propositionId) => propositions.get(propositionId)).filter(
      (value): value is ControlJsonObject => value !== undefined,
    );
    const artifactEntries = obligation.requiredEvidenceArtifactIds.map((artifactId) => artifacts.get(artifactId)).filter(
      (value): value is ControlJsonObject => value !== undefined,
    );
    const descriptionEntries = input.descriptions.filter((entry) =>
      exactStringArray(entry.obligationIds, "Description obligation identities").includes(obligation.id));
    let state: "satisfied" | "failed" | "indeterminate" | "missing" | "not-applicable" | "stale" | "unsupported";
    let reasonCode: string;
    if (missing.has(obligation.id)) {
      state = "missing";
      reasonCode = "reviewer-reported-obligation-missing";
    } else if (artifactEntries.length !== obligation.requiredEvidenceArtifactIds.length || propositionEntries.length !== obligation.propositionIds.length) {
      state = "missing";
      reasonCode = "required-evidence-entry-missing";
    } else {
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
      } else if (values.some(({ state: value }) => value === "missing")) {
        state = "missing";
        reasonCode = "evidence-missing";
      } else if (values.some(({ state: value }) => value === "stale")) {
        state = "stale";
        reasonCode = "evidence-stale";
      } else if (values.some(({ state: value }) => value === "unsupported")) {
        state = "unsupported";
        reasonCode = "evidence-unsupported";
      } else if (values.some(({ state: value }) => value === "indeterminate")) {
        state = "indeterminate";
        reasonCode = "evidence-indeterminate";
      } else if (values.length === 0 && obligation.severity === "diagnostic") {
        state = "not-applicable";
        reasonCode = "diagnostic-obligation-not-applicable";
      } else if (values.length === 0) {
        state = "missing";
        reasonCode = "obligation-has-no-evidence-route";
      } else {
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
  }).sort((left, right) => compareCodePoints(
    string(left.id, "Obligation state identity"),
    string(right.id, "Obligation state identity"),
  )));
}

function uncertaintyLevel(input: Readonly<{
  review: ReturnType<typeof reviewJudgments>;
  obligations: readonly ControlJsonObject[];
  independence: readonly ControlJsonObject[];
}>): Readonly<{ level: "none" | "bounded" | "material" | "unknown"; itemIds: readonly string[] }> {
  const items: string[] = [];
  for (const judgment of input.review.judgments) {
    if (judgment.uncertainty !== "none") items.push(judgment.id);
  }
  for (const obligation of input.obligations) {
    if (obligation.state !== "satisfied" && obligation.state !== "not-applicable") {
      items.push(string(obligation.id, "Obligation-state identity"));
    }
  }
  for (const entry of input.independence) {
    if (entry.state !== "satisfied") items.push(string(entry.id, "Independence identity"));
  }
  const judgmentLevels = input.review.judgments.map(({ uncertainty }) => uncertainty);
  const level = input.review.mandateExcess || input.review.missingObligationIds.length > 0 ||
      input.review.overallUncertainty === "material" || judgmentLevels.includes("material")
    ? "material"
    : input.review.overallUncertainty === "unknown" || judgmentLevels.includes("unknown") ||
        input.obligations.some(({ state }) => ["indeterminate", "missing", "stale", "unsupported"].includes(String(state))) ||
        input.independence.some(({ state }) => state === "indeterminate")
      ? "unknown"
      : input.review.overallUncertainty === "bounded" || judgmentLevels.includes("bounded")
        ? "bounded"
        : "none";
  return Object.freeze({ level, itemIds: sortedIds(items, "Uncertainty item identity") });
}

function readiness(input: Readonly<{
  store: ControlRecordStore;
  receiptComplete: boolean;
  propositions: readonly ControlJsonObject[];
  obligations: readonly ControlJsonObject[];
  artifacts: readonly ControlJsonObject[];
  descriptions: readonly ControlJsonObject[];
  independence: readonly ControlJsonObject[];
  diagnostics: readonly EvidencePacketDiagnostic[];
  review: ReturnType<typeof reviewJudgments>;
  nonReadyDisposition: "correctable" | "no-ship-recommended";
}>): EvidencePacketReadiness {
  const reviewRequiresMaterial = input.review.mandateExcess ||
    input.review.missingObligationIds.length > 0 ||
    input.review.overallUncertainty === "material" ||
    input.review.judgments.some(({ uncertainty }) => uncertainty === "material");
  if (reviewRequiresMaterial && input.store.state().subjects.materialCondition === null) {
    fail("material-condition", "Material review findings require the exact frozen Material Condition before Packet finalization");
  }
  const material = input.store.state().subjects.materialCondition !== null || reviewRequiresMaterial;
  if (material) return "revision-required";
  const ready = input.receiptComplete &&
    input.review.overallUncertainty !== "unknown" &&
    input.propositions.every((entry) => entry.validation === "valid") &&
    input.obligations.every((entry) => entry.state === "satisfied" || entry.state === "not-applicable") &&
    input.artifacts.every((entry) => entry.state === "satisfied") &&
    input.descriptions.every((entry) => entry.state === "satisfied" || entry.state === "not-applicable") &&
    input.independence.every((entry) => entry.state === "satisfied") &&
    input.diagnostics.length === 0;
  return ready ? "acceptance-ready" : input.nonReadyDisposition;
}

function relationships(records: EvaluationRecords, checks: readonly RetainedCheck[]): readonly ControlRecordRelationship[] {
  const relationship = (relation: string, revision: ControlRecordRevision): ControlRecordRelationship => Object.freeze({
    relation,
    target: exactReference(revision),
  });
  return Object.freeze([
    relationship("governed-by", records.boundary),
    relationship("evaluates", records.candidate),
    relationship("uses-seal", records.seal),
    ...checks.map((check) => relationship("uses-check", check.revision)),
    relationship("uses-review", records.workProduct),
    relationship("uses-review-receipt", records.executionReceipt),
  ]);
}

function identities(store: ControlRecordStore, activityId: string): Readonly<{ recordId: string; eventId: string }> {
  const suffix = digestCanonical({
    recordKind: "evidence-packet",
    storeId: store.identity.storeId,
    processId: store.identity.processId,
    activityId,
  }).slice("sha256:".length);
  return Object.freeze({
    recordId: `evidence-packet-${suffix}`,
    eventId: `event-evidence-packet-finalized-${suffix}`,
  });
}

function semanticMarkdown(input: Readonly<{
  readiness: EvidencePacketReadiness;
  records: EvaluationRecords;
  obligations: readonly ControlJsonObject[];
  uncertainty: Readonly<{ level: string; itemIds: readonly string[] }>;
}>): string {
  const unresolved = input.obligations.filter((entry) =>
    entry.state !== "satisfied" && entry.state !== "not-applicable");
  const lines = [
    "# Evidence Packet",
    "",
    `- Readiness: ${input.readiness}`,
    `- Work Boundary: ${input.records.boundary.recordId} revision ${input.records.boundary.revision}`,
    `- Candidate Revision: ${input.records.candidate.recordId} revision ${input.records.candidate.revision}`,
    `- Candidate Seal: ${input.records.seal.recordId}`,
    `- Reviewer Work Product: ${input.records.workProduct.recordId}`,
    `- Uncertainty: ${input.uncertainty.level}`,
    `- Unresolved obligations: ${unresolved.length}`,
  ];
  if (unresolved.length > 0) {
    lines.push("", "## Unresolved obligations", "", ...unresolved.map((entry) =>
      `- ${String(entry.obligationId)}: ${String(entry.state)} (${String(entry.reasonCode)})`));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Compile and atomically retain the complete runtime-derived Evidence Packet
 * for one exact evaluation. The caller supplies only physical observations and
 * installed evaluator coordinates that cannot be recovered from Control; all
 * Control subjects, ledgers, references, identities, and readiness are derived.
 */
export function retainEvidencePacket(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  observation: EvidencePacketObservation;
  runtimeId: string;
}>): Readonly<{
  revision: ControlRecordRevision;
  event: ControlRecordEvent;
}> {
  const exactActivityId = id(input.activityId, "Evidence Packet activity identity");
  const evaluatedAt = controlTimestamp(input.observation.evaluatedAt, "Evidence evaluation time");
  const ruleSet = Object.freeze({
    id: id(input.observation.ruleSet.id, "Evidence rule-set identity"),
    digest: digest(input.observation.ruleSet.digest, "Evidence rule-set digest"),
  });
  const validator = Object.freeze({
    id: id(input.observation.validator.id, "Evidence validator identity"),
    digest: digest(input.observation.validator.digest, "Evidence validator digest"),
  });
  const diagnostics = Object.freeze((input.observation.diagnostics ?? []).map((diagnostic) => Object.freeze({
    code: id(diagnostic.code, "Evidence diagnostic code"),
    stage: id(diagnostic.stage, "Evidence diagnostic stage"),
    factsDigest: digest(diagnostic.factsDigest, "Evidence diagnostic facts digest"),
  })).sort((left, right) => compareCodePoints(
    `${left.code}\u0000${left.stage}\u0000${left.factsDigest}`,
    `${right.code}\u0000${right.stage}\u0000${right.factsDigest}`,
  )));
  if (diagnostics.length > 1_024) fail("bound", "Evidence diagnostics exceed the profile");
  if (new Set(diagnostics.map((value) => digestCanonical(value))).size !== diagnostics.length) {
    fail("diagnostic", "Evidence diagnostics repeat one exact diagnostic");
  }

  const stateDigestBefore = digestCanonical(input.store.state());
  {
    const records = evaluationRecords(input.store, exactActivityId);
    const boundary = boundaryFacts(records.boundary);
    const receipt = receiptLedgers(boundary, records, evaluatedAt);
    const review = reviewJudgments(records.workProduct, boundary);
    const propositions = propositionLedger(records.workProduct, boundary, review);
    const artifacts = artifactLedger(
      input.observation.artifacts,
      boundary,
      records.candidate,
      receipt.usedChecks,
    );
    const descriptions = descriptionLedger(
      input.observation.descriptionCoverage,
      boundary,
      records.candidate,
    );
    const independence = reviewerIndependence(
      input.store,
      records,
      input.observation.reviewerSubjectDisposition,
    );
    const invalidations = invalidationLedger(records, receipt.usedChecks);
    const obligations = obligationLedger({
      facts: boundary,
      receiptEntries: receipt.entries,
      propositions,
      artifacts,
      descriptions,
      review,
    });
    const uncertainty = uncertaintyLevel({ review, obligations, independence });
    const derivedReadiness = readiness({
      store: input.store,
      receiptComplete: receipt.completeAndLegal,
      propositions,
      obligations,
      artifacts,
      descriptions,
      independence,
      diagnostics,
      review,
      nonReadyDisposition: input.observation.nonReadyDisposition ?? "correctable",
    });
    const payload: ControlJsonObject = Object.freeze({
      schema: "lifecycle.evidence-packet-payload.v1",
      profileId: "lifecycle.evidence-packet.foundation-v1",
      ruleSet,
      evaluatedAt,
      artifacts,
      descriptionCoverage: descriptions,
      receiptUse: receipt.entries,
      invalidations,
      reviewerIndependence: independence,
      propositionDecisions: propositions,
      obligations,
      diagnostics,
      uncertainty,
      validator,
      readiness: derivedReadiness,
    });
    const identity = identities(input.store, exactActivityId);
    const revisionInput = Object.freeze({
      recordId: identity.recordId,
      recordKind: "evidence-packet",
      revision: 1,
      producer: Object.freeze({ kind: "runtime" as const, id: input.runtimeId }),
      semanticAuthor: Object.freeze({ kind: "runtime" as const, id: input.runtimeId }),
      semanticAuthority: "runtime-derived" as const,
      createdAt: evaluatedAt,
      semanticMarkdown: semanticMarkdown({
        readiness: derivedReadiness,
        records,
        obligations,
        uncertainty,
      }),
      payload,
      relationships: relationships(records, receipt.usedChecks),
    });
    const compiled = compileControlRecordRevision(input.store.identity.processId, revisionInput);
    assertDeliveryControlRecordPolicy(compiled);
    assertDeliveryControlRecordPayload(compiled);

    if (digestCanonical(input.store.state()) !== stateDigestBefore) {
      fail("state-race", "Evidence subjects changed during compilation");
    }
    const retained = input.store.append({
      revision: revisionInput,
      event: {
        eventId: identity.eventId,
        eventKind: "evidence-packet-finalized",
        occurredAt: evaluatedAt,
        actor: { kind: "runtime", id: input.runtimeId },
        subject: {
          recordId: compiled.recordId,
          revision: compiled.revision,
          digest: compiled.digest,
        },
        payload: { activityId: exactActivityId },
      },
    });
    if (retained.revision === null) fail("retention", "Evidence Packet revision was not retained");
    return Object.freeze({ revision: retained.revision, event: retained.event });
  }
}
