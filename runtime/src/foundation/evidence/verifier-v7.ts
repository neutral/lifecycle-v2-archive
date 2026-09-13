import {
  assessFoundationEvidenceV1,
  type FoundationEvidenceAssessmentInputV1,
  type FoundationEvidenceRequirementsV1,
  type FoundationEvidenceReviewFactsV1,
  type FoundationEvidenceIndependenceFactsV1,
  type FoundationEvidenceCheckFactsV1,
} from "./assessment-v1.js";
import type { EvidencePacketArtifactObservation, EvidencePacketDescriptionObservation, EvidencePacketDiagnostic } from "./assessment-v1.js";
export type { EvidencePacketArtifactObservation, EvidencePacketDescriptionObservation, EvidencePacketDiagnostic } from "./assessment-v1.js";
import { FOUNDATION_EVIDENCE_RULE_SET_V7, FOUNDATION_EVIDENCE_VALIDATOR_V7 } from "./coordinates-v7.js";
import { resolveCandidateIntegrationProvenanceV1, type FoundationIntegrationRevisionLookupV1 } from "../control/integration-assessment.js";
import { FoundationError } from "../error.js";
import {
  canonicalJson,
  digestCanonical,
  type Sha256,
} from "../validation/canonical.js";
import { sortUniqueCodePoints } from "../validation/ordering.js";
import { assertDeliveryControlRecordPolicy } from "../control/kind-registry.js";
import {
  compileControlRecordEvent,
  compileControlRecordRevision,
  controlIdentifier,
  controlTimestamp,
} from "../control/model.js";
import { assertDeliveryControlRecordPayload } from "../control/payload-registry.js";
import { CONTROL_RECORD_EVENT_SCHEMA, CONTROL_RECORD_REVISION_SCHEMA } from "../control/types.js";
import type {
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordEvent,
  ControlRecordRelationship,
  ControlRecordRelationshipTarget,
  ControlRecordRevision,
} from "../control/types.js";

export type EvidencePacketReadiness =
  | "acceptance-ready"
  | "correctable"
  | "revision-required"
  | "no-ship-recommended";

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

type BoundaryFacts = FoundationEvidenceRequirementsV1;
type CheckSelection = BoundaryFacts["checks"][number];
type BoundaryObligation = BoundaryFacts["obligations"][number];
type BoundaryArtifact = BoundaryFacts["artifacts"][number];
type BoundaryProposition = BoundaryFacts["propositions"][number];

type RetainedCheck = Readonly<{
  revision: ControlRecordRevision;
  phase: CheckPhase;
  modality: CheckModality;
  disposition: CheckDisposition;
  selectionId: string;
  finishedAt: string | null;
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
  snapshot: EvidenceSnapshot,
  event: ControlRecordEvent,
  kind: string,
): ControlRecordRevision {
  if (event.subject === null) fail("journal", `${event.eventKind} lacks its required subject`);
  const revision = retainedRevision(snapshot, event.subject.recordId, event.subject.revision);
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
  snapshot: EvidenceSnapshot,
  kind: string,
  reference: Readonly<{ id: string; revision: number; digest: Sha256 }> | null,
): ControlRecordRevision {
  if (reference === null) fail("standing", `Evidence compilation requires one current ${kind}`);
  const revision = retainedRevision(snapshot, reference.id, reference.revision);
  if (revision === null || revision.recordKind !== kind || revision.digest !== reference.digest) {
    fail("standing", `Current ${kind} does not resolve to one exact retained revision`);
  }
  return revision;
}

function parseCheck(revision: ControlRecordRevision): RetainedCheck {
  if (revision.payload.schema !== "lifecycle.check-receipt-payload.v3") {
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

function evaluationRecords(snapshot: EvidenceSnapshot, exactActivityId: string): EvaluationRecords {
  const selected = snapshot.input.selected;
  const boundary = exactCurrentRevision(snapshot, "work-boundary", selected.boundary);
  const candidate = exactCurrentRevision(snapshot, "candidate-revision", selected.candidate);
  const seal = exactCurrentRevision(snapshot, "candidate-seal", selected.seal);
  assertRelationship(seal, "governed-by", boundary);
  assertRelationship(seal, "seals", candidate);
  assertRelationship(candidate, "governed-by", boundary);
  if (boundary.payload.targetId !== snapshot.input.identity.targetId) {
    fail("boundary", "Evidence Work Boundary belongs to a different target");
  }
  if (seal.payload.carrierIntegrity !== "verified" || seal.payload.carrierReconstruction !== "verified" ||
      seal.payload.evaluationSubject !== "established" || seal.payload.candidateReobservation !== "exact-match" ||
      seal.payload.untrackedProduct !== "absent" || seal.payload.controlExclusion !== "verified") {
    fail("standing", "Evidence Candidate Seal does not establish the exact sealed physical subject");
  }

  const events = snapshot.input.events;
  const evaluationEvents = events.filter((event) => activityId(event) === exactActivityId);
  const started = uniqueEvent(evaluationEvents, "activity-started", true)!;
  const sealed = uniqueEvent(evaluationEvents, "candidate-sealed", true)!;
  const prepared = uniqueEvent(evaluationEvents, "agent-attempt-prepared", true)!;
  const intended = uniqueEvent(evaluationEvents, "provider-effect-intended", true)!;
  const observed = uniqueEvent(evaluationEvents, "provider-effect-observed", true)!;
  const submitted = uniqueEvent(evaluationEvents, "agent-work-product-submitted", true)!;
  const received = uniqueEvent(evaluationEvents, "execution-receipt-recorded", true)!;
  const milestones = [started, sealed, prepared, intended, observed, submitted, received];
  if (started.payload.operation !== "delivery.evaluate" || started.subject !== null ||
      milestones.some((event, index) => index > 0 && event.sequence <= milestones[index - 1]!.sequence) ||
      evaluationEvents.some((event) => event.eventKind === "check-receipt-recorded" &&
        (event.sequence <= sealed.sequence || event.sequence >= prepared.sequence))) {
    fail("journal", "Evidence requires the ordered exact evaluation opening, Seal, Checks, reviewer execution, and receipt provenance");
  }
  const attempt = retainedSubject(snapshot, prepared, "agent-attempt");
  const workProduct = retainedSubject(snapshot, submitted, "agent-work-product");
  const executionReceipt = retainedSubject(snapshot, received, "execution-receipt");
  const sealFromEvent = retainedSubject(snapshot, sealed, "candidate-seal");
  for (const event of [intended, observed]) {
    if (!sameReference(exactReference(retainedSubject(snapshot, event, "agent-attempt")), exactReference(attempt))) {
      fail("journal", "Reviewer provider milestones do not bind the exact Agent Attempt");
    }
  }
  const effectDigest = digest(intended.payload.effectDigest, "Reviewer provider intent digest");
  if (observed.payload.effectDigest !== effectDigest || observed.payload.outcome !== "completed" ||
      object(executionReceipt.payload.providerEffect, "Reviewer provider effect").effectDigest !== effectDigest) {
    fail("journal", "Reviewer provider observation and Receipt do not bind the exact completed intended effect");
  }
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
    workProduct.payload.schema !== "lifecycle.agent-work-product-payload.v5" ||
    workProduct.payload.role !== "reviewer"
  ) fail("review", "Evaluation Work Product is not one reviewer Work Product");
  assertRelationship(workProduct, "result-of", attempt);

  if (
    executionReceipt.payload.schema !== "lifecycle.execution-receipt-payload.v3" ||
    executionReceipt.payload.activityId !== exactActivityId ||
    executionReceipt.payload.role !== "reviewer" ||
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
    canonicalJson(candidateInputRevision) !== canonicalJson(exactReference(candidate)) ||
    candidateInput.carrierManifestDigest !== object(candidate.payload.carrierManifest, "Candidate Carrier manifest").digest ||
    canonicalJson(workProductBinding.reference) !== canonicalJson(exactReference(workProduct)) ||
    candidateBinding.successor !== null ||
    containment.classification !== "contained" || retirement.classification !== "retired"
  ) fail("review-receipt", "Reviewer Execution Receipt does not prove one valid contained submission");

  const materialEvent = uniqueEvent(evaluationEvents, "material-condition-frozen", false);
  // Evaluation time binds the evidence observations, not later recovery coordination.
  const requiredMilestones = [...milestones,
    ...evaluationEvents.filter((event) => event.eventKind === "check-receipt-recorded"),
    ...(materialEvent === null ? [] : [materialEvent])];
  if (requiredMilestones.some((event) => Date.parse(event.occurredAt) > Date.parse(snapshot.input.observation.evaluatedAt))) {
    fail("journal", "Evidence evaluation time precedes a required retained observation milestone");
  }
  const materialCondition = selected.materialCondition === null
    ? null
    : exactCurrentRevision(snapshot, "material-condition", selected.materialCondition);
  if ((materialEvent === null) !== (materialCondition === null)) {
    fail("material-condition", "Evaluation Material Condition does not match the exact current Delivery subject");
  }
  if (materialCondition !== null) {
    const eventCondition = retainedSubject(snapshot, materialEvent!, "material-condition");
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
    .map((event) => parseCheck(retainedSubject(snapshot, event, "check-receipt")));
  for (const check of finalChecks) {
    if (check.phase !== "final") fail("check", "Evaluation activity retained a non-final Check Receipt");
    assertRelationship(check.revision, "checks-seal", seal);
  }

  const baselineChecks = events
    .filter((event) => event.eventKind === "check-receipt-recorded")
    .map((event) => parseCheck(retainedSubject(snapshot, event, "check-receipt")))
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
  if (revision.payload.schema !== "lifecycle.work-boundary-payload.v6") {
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

/**
 * The selected Execution owner constructs a fresh Cell, empty provider home,
 * ephemeral invocation and closed reviewer inputs. It validates the immutable
 * Specification, Input Set and runner before retaining this trusted Receipt.
 * Recheck the values duplicated in Control here; runner bytes are not present
 * in this synchronous closure and are not rederived from current defaults.
 */
function reviewerIndependenceFacts(
  snapshot: EvidenceSnapshot,
  records: EvaluationRecords,
) {
  const attempt = records.attempt.payload;
  const receipt = records.executionReceipt.payload;
  const attemptCapability = object(attempt.capability, "Reviewer Attempt capability");
  const projection = object(attempt.projection, "Reviewer Attempt Projection");
  const attemptExecution = object(attempt.execution, "Reviewer Attempt execution");
  const receiptExecution = object(receipt.execution, "Reviewer Receipt execution");
  for (const field of ["backendProfile", "image", "inputSet"] as const) {
    if (canonicalJson(attemptExecution[field]) !== canonicalJson(receiptExecution[field])) {
      fail("review-construction", `Reviewer Receipt substitutes the selected ${field}`);
    }
  }
  const authoring = object(attempt.authoring, "Reviewer Attempt authoring");
  const attemptInput = object(attempt.input, "Reviewer Attempt input");
  const receiptInput = object(receipt.inputBindings, "Reviewer Receipt input bindings");
  if (receiptInput.roleBriefDigest !== authoring.roleBriefDigest ||
      receiptInput.contentInventoryDigest !== attemptInput.contentInventoryDigest ||
      receiptInput.inputMaterialDigest !== attemptInput.inputMaterialDigest) {
    fail("review-construction", "Reviewer Receipt substitutes its exact curated inputs");
  }
  const attemptProvider = object(attempt.provider, "Reviewer Attempt provider");
  const receiptProvider = object(receipt.provider, "Reviewer Receipt provider");
  for (const field of ["descriptorId", "descriptorDigest", "adapter", "installedIdentityDigest"] as const) {
    if (attemptProvider[field] !== receiptProvider[field]) {
      fail("review-construction", `Reviewer Receipt substitutes the selected provider ${field}`);
    }
  }
  if (receiptProvider.observedExecutableIdentity !== attemptProvider.installedIdentityDigest ||
      receiptProvider.model !== object(attempt.investment, "Reviewer Attempt Investment").model) {
    fail("review-construction", "Reviewer Receipt does not reproduce the selected provider invocation");
  }
  const reviewerReceiptEvent = records.allEvents.find((event) =>
    event.eventKind === "execution-receipt-recorded" &&
    event.subject?.recordId === records.executionReceipt.recordId &&
    event.subject.digest === records.executionReceipt.digest)!;
  const priorBuilderSessions = records.allEvents
    .filter((event) => event.eventKind === "execution-receipt-recorded" && event.sequence < reviewerReceiptEvent.sequence)
    .map((event) => {
      if (event.subject === null) return null;
      const revision = retainedRevision(snapshot, event.subject.recordId, event.subject.revision);
      return revision !== null && revision.digest === event.subject.digest ? revision : null;
    })
    .filter((revision): revision is ControlRecordRevision => revision !== null)
    .filter((revision) => {
      const target = relationshipTargets(revision, "observes-attempt", "agent-attempt")[0];
      if (target === undefined) return false;
      const priorAttempt = retainedRevision(snapshot, target.id, target.revision);
      if (priorAttempt === null || priorAttempt.recordKind !== target.kind || priorAttempt.digest !== target.digest) {
        fail("relationship", "Prior Execution Receipt has an invalid Attempt relationship");
      }
      return priorAttempt.payload.role === "builder";
    })
    .map((revision) => object(revision.payload.provider, "Prior builder Receipt provider").sessionId)
    .filter((value): value is string => typeof value === "string");
  const reviewerSession = receiptProvider.sessionId;
  const providerSession = typeof reviewerSession !== "string" ? "indeterminate" as const
    : priorBuilderSessions.includes(reviewerSession) ? "reused" as const : "fresh" as const;
  const semantic: FoundationEvidenceIndependenceFactsV1 = Object.freeze({
    // Missing telemetry does not contradict the established fresh construction.
    contextSeparation: providerSession === "reused" ? "shared" : "distinct",
  });
  return Object.freeze({
    semantic,
    providerSession,
    attempt: exactReference(records.attempt),
    receipt: exactReference(records.executionReceipt),
    capabilityDigest: digest(attemptCapability.profileDigest, "Reviewer capability profile digest"),
    projectionDigest: digest(projection.digest, "Reviewer Projection digest"),
  });
}

function localId(prefix: string, value: ControlJsonObject): string {
  return `${prefix}.${digestCanonical(value).slice("sha256:".length)}`;
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


export type FoundationEvidenceReferenceV7 = Readonly<{ id: string; revision: number; digest: Sha256 }>;
export type EvidencePacketPhysicalObservation = Omit<EvidencePacketObservation, "evaluatedAt" | "ruleSet" | "validator" | "nonReadyDisposition">;
export type FoundationEvidenceObservationSubjectV7 = Readonly<{
  boundary: FoundationEvidenceReferenceV7;
  candidate: FoundationEvidenceReferenceV7;
  seal: FoundationEvidenceReferenceV7;
  integration: FoundationEvidenceReferenceV7;
  parent: Readonly<{commit:string;tree:string;snapshotDigest:Sha256}>;
}>;

/** Resolve the immutable physical comparison basis; this does not itself observe product facts. */
export function resolveFoundationEvidenceObservationSubjectV7(input: Readonly<{
  store: FoundationIntegrationRevisionLookupV1;
  subjects: Pick<FoundationEvidenceObservationSubjectV7,"boundary" | "candidate" | "seal">;
}>): FoundationEvidenceObservationSubjectV7 {
  const candidate = input.store.getRevision(input.subjects.candidate.id,input.subjects.candidate.revision);
  if (candidate === null || candidate.recordKind !== "candidate-revision" || candidate.digest !== input.subjects.candidate.digest) {
    fail("observation-subject", "Physical Evidence basis requires its exact Candidate revision");
  }
  const integration = resolveCandidateIntegrationProvenanceV1({store:input.store,candidate});
  if (integration === null) fail("observation-subject", "Physical Evidence basis requires exact integration provenance");
  return Object.freeze({boundary:input.subjects.boundary,candidate:input.subjects.candidate,seal:input.subjects.seal,
    integration:Object.freeze({id:integration.assessment.recordId,revision:integration.assessment.revision,digest:integration.assessment.digest}),
    parent:Object.freeze({commit:integration.canonicalParent.commit,tree:integration.canonicalParent.tree,snapshotDigest:integration.canonicalParent.digest}),
  });
}

export type FoundationEvidenceSubjectObservationV7 = Readonly<{
  subject: FoundationEvidenceObservationSubjectV7;
  facts: EvidencePacketPhysicalObservation;
}>;
export type FoundationEvidenceVerificationInputV7 = Readonly<{
  identity: Readonly<{ targetId: string; storeId: string; processId: string }>;
  evaluationActivityId: string;
  selected: Readonly<{
    boundary: FoundationEvidenceReferenceV7;
    candidate: FoundationEvidenceReferenceV7;
    seal: FoundationEvidenceReferenceV7;
    materialCondition: FoundationEvidenceReferenceV7 | null;
  }>;
  /** Complete exact historical prefix immediately before Packet finalization. */
  events: readonly ControlRecordEvent[];
  /** Closed immutable revision inventory for that prefix and its relationships. */
  revisions: readonly ControlRecordRevision[];
  /** Owner-observed physical facts; retained observations are not a fresh physical proof. */
  observationSubject: FoundationEvidenceObservationSubjectV7;
  observation: EvidencePacketObservation;
}>;
export type FoundationEvidenceVerificationResultV7 = Readonly<{
  readiness: EvidencePacketReadiness;
  payload: ControlJsonObject;
  relationships: readonly ControlRecordRelationship[];
  semanticMarkdown: string;
}>;
type EvidenceSnapshot = Readonly<{
  input: FoundationEvidenceVerificationInputV7;
  revisions: ReadonlyMap<string, ControlRecordRevision>;
}>;
function retainedRevision(snapshot: EvidenceSnapshot, id: string, revision: number): ControlRecordRevision | null {
  return snapshot.revisions.get(`${id}\0${revision}`) ?? null;
}
function evidenceSnapshot(input: FoundationEvidenceVerificationInputV7): EvidenceSnapshot {
  const revisions = new Map<string, ControlRecordRevision>();
  for (const revision of input.revisions) {
    const key = `${revision.recordId}\0${revision.revision}`;
    if (revisions.has(key)) fail("relationship", "Evidence revision inventory repeats an exact coordinate");
    const compiled = compileControlRecordRevision(input.identity.processId, revision);
    if (revision.schema !== CONTROL_RECORD_REVISION_SCHEMA || revision.processId !== input.identity.processId ||
        canonicalJson(compiled) !== canonicalJson(revision)) {
      fail("relationship", "Evidence revision bytes do not reproduce their retained digest");
    }
    assertDeliveryControlRecordPolicy(revision);
    assertDeliveryControlRecordPayload(revision);
    revisions.set(key, revision);
  }
  for (const revision of revisions.values()) {
    for (const { target } of revision.relationships) {
      const retained = revisions.get(`${target.id}\0${target.revision}`);
      if (retained === undefined || retained.recordKind !== target.kind || retained.digest !== target.digest) {
        fail("relationship", "Evidence revision inventory does not close every exact Control relationship");
      }
    }
  }
  let predecessor: Sha256 | null = null;
  let precedingTime: number | null = null;
  input.events.forEach((event, index) => {
    const occurredAt = Date.parse(controlTimestamp(event.occurredAt, "Evidence provenance event time"));
    const compiled = compileControlRecordEvent({ storeId: input.identity.storeId, processId: input.identity.processId,
      sequence: index + 1, predecessorDigest: predecessor, event });
    if (event.schema !== CONTROL_RECORD_EVENT_SCHEMA || (precedingTime !== null && occurredAt < precedingTime) ||
      event.sequence !== index + 1 || event.storeId !== input.identity.storeId ||
      event.processId !== input.identity.processId || event.predecessorDigest !== predecessor ||
      canonicalJson(compiled) !== canonicalJson(event)) {
      fail("journal", "Evidence provenance is not one complete exact historical event prefix");
    }
    if (event.subject !== null) {
      const retained = revisions.get(`${event.subject.recordId}\0${event.subject.revision}`);
      if (retained === undefined || retained.digest !== event.subject.digest) {
        fail("journal", "Evidence provenance does not resolve every exact retained event subject");
      }
    }
    predecessor = event.digest;
    precedingTime = occurredAt;
  });
  if (input.events.length === 0) fail("journal", "Evidence provenance requires its exact historical event prefix");
  return Object.freeze({ input, revisions });
}

/** Validate Foundation provenance, then assess its exact facts without performing effects. */
function prepareEvidenceAssessment(input: FoundationEvidenceVerificationInputV7) {
  const snapshot = evidenceSnapshot(input);
  for (const name of ["boundary", "candidate", "seal"] as const) {
    if (!sameReference(input.observationSubject[name], input.selected[name])) {
      throw new FoundationError("lifecycle.evidence.observation-subject", "Physical observations select a different Evidence subject", {
        observedFacts: { subject: name, expected: input.selected[name], observed: input.observationSubject[name] },
      });
    }
  }
  const exactActivityId = id(input.evaluationActivityId, "Evidence evaluation provenance identity");
  if (canonicalJson(input.observation.ruleSet) !== canonicalJson(FOUNDATION_EVIDENCE_RULE_SET_V7) ||
      canonicalJson(input.observation.validator) !== canonicalJson(FOUNDATION_EVIDENCE_VALIDATOR_V7)) {
    throw new FoundationError("lifecycle.evidence.unsupported-verifier", "Evidence selects an unsupported rule set or validator");
  }
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

  const records = evaluationRecords(snapshot, exactActivityId);
  const boundary = boundaryFacts(records.boundary);
  const integration = resolveCandidateIntegrationProvenanceV1({
    store: { identity: input.identity, getRevision: (id, revision) => snapshot.revisions.get(`${id}\0${revision}`) ?? null },
    candidate: records.candidate,
  });
  if (integration === null) throw new FoundationError("lifecycle.evidence.integration-required", "Evidence requires the sealed Candidate's exact integration provenance");
  const subject = Object.freeze({boundary:exactReference(records.boundary), candidate:exactReference(records.candidate), seal:exactReference(records.seal),
    integration:exactReference(integration.assessment),parent:Object.freeze({commit:integration.canonicalParent.commit,tree:integration.canonicalParent.tree,snapshotDigest:integration.canonicalParent.digest})});
  const semantics = object(records.workProduct.payload.roleSemantics, "Reviewer semantics");
  const review: FoundationEvidenceReviewFactsV1 = Object.freeze({
    reference: exactReference(records.workProduct), subject,
    citations: records.workProduct.payload.citations as unknown as FoundationEvidenceReviewFactsV1["citations"],
    mandateApplicability: semantics.mandateApplicability as unknown as FoundationEvidenceReviewFactsV1["mandateApplicability"],
    baselineApplicability: semantics.baselineApplicability as unknown as FoundationEvidenceReviewFactsV1["baselineApplicability"],
    judgments: semantics.judgments as unknown as FoundationEvidenceReviewFactsV1["judgments"],
    mandateExcess: boolean(semantics.mandateExcess, "Reviewer mandate excess"),
    missingObligationIds: exactStringArray(semantics.missingObligationIds, "Reviewer missing obligations"),
    overallUncertainty: object(records.workProduct.payload.uncertainty, "Reviewer uncertainty").level as FoundationEvidenceReviewFactsV1["overallUncertainty"],
  });
  const checks = Object.freeze([...records.baselineChecks, ...records.finalChecks].sort((a,b) => compareCodePoints(a.revision.recordId,b.revision.recordId)));
  const independenceProvenance = reviewerIndependenceFacts(snapshot,records);
  const facts: FoundationEvidenceAssessmentInputV1 = Object.freeze({
    subject, requirements:boundary, review,
    checks:Object.freeze(checks.map((check): FoundationEvidenceCheckFactsV1 => Object.freeze({
      reference:exactReference(check.revision),
      proofSubject:oneRelationship(check.revision, check.phase === "baseline" ? "checks-boundary" : "checks-seal", check.phase === "baseline" ? "work-boundary" : "candidate-seal"),
      phase:check.phase, modality:check.modality, disposition:check.disposition, selectionId:check.selectionId, finishedAt:check.finishedAt,
      allocation:object(check.revision.payload.execution,"Check execution").allocation as FoundationEvidenceCheckFactsV1["allocation"],
      notRunAuthorization:check.revision.payload.notRunAuthorization === null ? null
        : object(check.revision.payload.notRunAuthorization,"Check non-execution authorization").kind as FoundationEvidenceCheckFactsV1["notRunAuthorization"],
      startedAt:check.revision.payload.startedAt as FoundationEvidenceCheckFactsV1["startedAt"],
      definition:check.revision.payload.definition as unknown as FoundationEvidenceCheckFactsV1["definition"],
      binding:check.revision.payload.binding as unknown as FoundationEvidenceCheckFactsV1["binding"],
      requestedConditions:exactStringArray(object(check.revision.payload.environment,"Check environment").requested,"Check requested conditions"),
    }))),
    independence:independenceProvenance.semantic,
    observationSubject:Object.freeze({boundary:{kind:"work-boundary",...input.observationSubject.boundary},candidate:{kind:"candidate-revision",...input.observationSubject.candidate},seal:{kind:"candidate-seal",...input.observationSubject.seal},
      integration:{kind:"integration-assessment",...input.observationSubject.integration},parent:input.observationSubject.parent}),
    observation: input.observation,
  });
  return Object.freeze({records,checks,integration,evaluatedAt,ruleSet,validator,diagnostics,independenceProvenance,assessment:assessFoundationEvidenceV1(facts)});
}

/** Mandatory Foundation provenance validation followed by semantic assessment, before retaining the required Delivery response. */
export function assessFoundationEvaluationEvidenceV7(input: FoundationEvidenceVerificationInputV7) {
  return prepareEvidenceAssessment(input).assessment;
}

export function verifyFoundationEvidenceV7(input: FoundationEvidenceVerificationInputV7): FoundationEvidenceVerificationResultV7 {
  const {records,checks,integration,evaluatedAt,ruleSet,validator,diagnostics,independenceProvenance,assessment} = prepareEvidenceAssessment(input);
  if (assessment.requiresMandateResolution && records.materialCondition === null) {
    fail("material-condition", "Material review findings require the exact frozen Material Condition before Packet finalization");
  }
  const derivedReadiness: EvidencePacketReadiness = records.materialCondition !== null || assessment.requiresMandateResolution
    ? "revision-required" : assessment.disposition === "supported" ? "acceptance-ready" : input.observation.nonReadyDisposition ?? "correctable";
  const payload: ControlJsonObject = Object.freeze({
    schema: "lifecycle.evidence-packet-payload.v2",
    profileId: "lifecycle.evidence-packet.foundation-v2",
    ruleSet, evaluatedAt,
    artifacts:assessment.artifacts, descriptionCoverage:assessment.descriptions, receiptUse:assessment.receiptUse,
    integrationApplicability:Object.freeze({assessment:exactReference(integration.assessment),mandate:assessment.mandateApplicability,baselines:assessment.baselineApplicability}),
    invalidations:invalidationLedger(records,checks),
    reviewerIndependence: Object.freeze(assessment.independence.map((entry) => Object.freeze({
      id:entry.id!,ruleId:entry.ruleId!,state:entry.state!,
      subjectDisposition:entry.subjectDisposition!,
      attemptId:independenceProvenance.attempt.id,workProductId:records.workProduct.recordId,
      receiptId:independenceProvenance.receipt.id,
      capabilityDigest:independenceProvenance.capabilityDigest,projectionDigest:independenceProvenance.projectionDigest,
      providerSession:independenceProvenance.providerSession,provenance:"runtime-derived",
    }))),
    propositionDecisions:assessment.propositions, obligations:assessment.obligations,
    diagnostics, uncertainty:assessment.uncertainty, validator, readiness:derivedReadiness,
  });
  return Object.freeze({readiness:derivedReadiness,payload,relationships:relationships(records,checks),
    semanticMarkdown:semanticMarkdown({readiness:derivedReadiness,records,obligations:assessment.obligations,uncertainty:assessment.uncertainty})});
}

export type FoundationAcceptanceCurrentSubjectsV7 = Readonly<{
  boundary: FoundationEvidenceReferenceV7 | null;
  candidate: FoundationEvidenceReferenceV7 | null;
  seal: FoundationEvidenceReferenceV7 | null;
  evidence: FoundationEvidenceReferenceV7 | null;
  materialCondition: FoundationEvidenceReferenceV7 | null;
}>;
/** The authority owner authenticates this subject separately; matching it is not authentication. */
export type FoundationAcceptanceDirectorSubjectV7 = Readonly<{
  targetId: string;
  storeId: string;
  processId: string;
  operation: string;
  decision: string;
  repository: Readonly<{ canonicalCommit: string }>;
  selectedControl: readonly ControlRecordRelationship[];
}>;
export type FoundationAcceptanceVerificationInputV7 = Readonly<{
  evidence: FoundationEvidenceVerificationInputV7;
  packet: ControlRecordRevision;
  /** Explicit reducer-selected currentness, independently supplied by the caller. */
  current: FoundationAcceptanceCurrentSubjectsV7;
  parentCommit: string;
  directorDecisionSubject?: FoundationAcceptanceDirectorSubjectV7 | undefined;
}>;
export type FoundationAcceptanceInvalidReasonV7 = Readonly<{
  code: string;
  message: string;
  expected?: unknown;
  observed?: unknown;
}>;
export type FoundationAcceptanceVerificationResultV7 =
  | Readonly<{ status: "justified"; evidence: FoundationEvidenceVerificationResultV7;
      acceptanceSubject: Pick<FoundationEvidenceObservationSubjectV7,"boundary" | "candidate" | "seal"> & Readonly<{ evidence: FoundationEvidenceReferenceV7; parentCommit: string }>;
      directorSubject: "not-supplied" | "matches" }>
  | Readonly<{ status: "not-justified"; reason: FoundationAcceptanceInvalidReasonV7 }>;

/** Compare the complete recomputation with retained bytes, including derived ledgers. */
export function assertFoundationEvidencePacketV7(
  input: FoundationEvidenceVerificationInputV7,
  packet: ControlRecordRevision,
  result: FoundationEvidenceVerificationResultV7,
): void {
  if (packet.schema !== CONTROL_RECORD_REVISION_SCHEMA) {
    throw new FoundationError("lifecycle.evidence.packet-mismatch", "Retained Evidence Packet uses an unsupported record envelope", {
      observedFacts: { expected: CONTROL_RECORD_REVISION_SCHEMA, observed: packet.schema },
    });
  }
  assertDeliveryControlRecordPolicy(packet);
  assertDeliveryControlRecordPayload(packet);
  const actual = compileControlRecordRevision(input.identity.processId, packet);
  const expected = compileControlRecordRevision(input.identity.processId, {
    ...packet,
    payload: result.payload,
    relationships: result.relationships,
    // Markdown remains part of the exact Packet identity; prose rendering is not acceptance proof.
  });
  if (packet.recordKind !== "evidence-packet" || packet.processId !== input.identity.processId ||
      canonicalJson(actual) !== canonicalJson(packet) || expected.digest !== packet.digest ||
      Date.parse(packet.createdAt) < Date.parse(input.observation.evaluatedAt)) {
    throw new FoundationError("lifecycle.evidence.packet-mismatch", "Retained Evidence Packet differs from its exact semantic recomputation", {
      observedFacts: { expected: expected.digest, observed: packet.digest },
    });
  }
}

/** Pure acceptance justification. This grants no authority and performs no effects. */
export function verifyFoundationAcceptanceV7(
  input: FoundationAcceptanceVerificationInputV7,
): FoundationAcceptanceVerificationResultV7 {
  const invalid = (code: string, message: string, expected?: unknown, observed?: unknown): FoundationAcceptanceVerificationResultV7 =>
    Object.freeze({ status: "not-justified", reason: Object.freeze({ code: `lifecycle.evidence.${code}`, message,
      ...(expected === undefined ? {} : { expected }), ...(observed === undefined ? {} : { observed }) }) });
  try {
    const evidence = verifyFoundationEvidenceV7(input.evidence);
    assertFoundationEvidencePacketV7(input.evidence, input.packet, evidence);
    const selected = input.evidence.selected;
    const comparisons = [
      ["boundary", "superseded-boundary", selected.boundary],
      ["candidate", "wrong-candidate", selected.candidate],
      ["seal", "wrong-seal", selected.seal],
      ["evidence", "wrong-evidence", exactReference(input.packet)],
    ] as const;
    for (const [name, code, reference] of comparisons) {
      if (!sameReference(input.current[name], reference)) {
        return invalid(code, `Acceptance requires the exact currently selected ${name}`, reference, input.current[name]);
      }
    }
    if (input.current.materialCondition !== null) {
      return invalid("current-material-condition", "Acceptance is suspended by the current Material Condition", null, input.current.materialCondition);
    }
    const candidate = input.evidence.revisions.find((revision) => sameReference(selected.candidate, exactReference(revision)))!;
    const integration = resolveCandidateIntegrationProvenanceV1({
      store: {
        identity: input.evidence.identity,
        getRevision: (id, revision) => input.evidence.revisions.find((item) => item.recordId === id && item.revision === revision) ?? null,
      },
      candidate,
    });
    if (integration === null) {
      return invalid("integration-required", "Acceptance requires the current Candidate's explicit integration provenance");
    }
    const requiredParent = integration.canonicalParent.commit;
    if (input.parentCommit !== requiredParent || candidate.payload.candidateBaseCommit !== requiredParent) {
      return invalid("stale-parent", "Acceptance requires the exact integration parent selected by the current Candidate lineage", requiredParent,
        { parentCommit: input.parentCommit, candidateBaseCommit: candidate.payload.candidateBaseCommit });
    }
    if (evidence.readiness !== "acceptance-ready") {
      return invalid("not-ready", "Recomputed Evidence does not justify acceptance", "acceptance-ready", evidence.readiness);
    }
    const subject = input.directorDecisionSubject;
    if (subject !== undefined) {
      const expected = Object.freeze({ targetId: input.evidence.identity.targetId,
        storeId: input.evidence.identity.storeId, processId: input.evidence.identity.processId,
        operation: "delivery.accept", decision: "accept",
        parentCommit: requiredParent,
        selectedControl: comparisons.map(([name, , reference]) => ({
          relation: `selects-${name}`,
          target: { kind: name === "boundary" ? "work-boundary" : name === "candidate" ? "candidate-revision" : name === "seal" ? "candidate-seal" : "evidence-packet",
            id: reference.id, revision: reference.revision, digest: reference.digest },
        })),
      });
      const selectedControl = [...subject.selectedControl].sort((left, right) => compareCodePoints(left.relation, right.relation));
      const observed = { targetId: subject.targetId, storeId: subject.storeId, processId: subject.processId,
        operation: subject.operation, decision: subject.decision, parentCommit: subject.repository.canonicalCommit,
        selectedControl };
      const sortedExpected = { ...expected, selectedControl: [...expected.selectedControl].sort((left, right) => compareCodePoints(left.relation, right.relation)) };
      if (canonicalJson(observed) !== canonicalJson(sortedExpected)) {
        return invalid("wrong-director-subject", "Director Decision does not select this exact acceptance subject", sortedExpected, observed);
      }
    }
    return Object.freeze({ status: "justified", evidence,
      acceptanceSubject: Object.freeze({ boundary: selected.boundary, candidate: selected.candidate, seal: selected.seal,
        evidence: Object.freeze({ id: input.packet.recordId, revision: input.packet.revision, digest: input.packet.digest }), parentCommit: requiredParent }),
      directorSubject: subject === undefined ? "not-supplied" : "matches" });
  } catch (error) {
    if (!(error instanceof FoundationError)) throw error;
    return Object.freeze({ status: "not-justified", reason: Object.freeze({ code: error.code, message: error.message,
      ...(error.observedFacts === undefined ? {} : { observed: error.observedFacts }) }) });
  }
}
