import {
  type EvidencePacketArtifactObservation,
  type EvidencePacketDescriptionObservation,
  type EvidencePacketDiagnostic,
  type EvidencePacketObservation,
  retainEvidencePacket,
} from "../control/evidence-packet.js";
import { retainMaterialCondition } from "../control/material-condition.js";
import { controlIdentifier, controlTimestamp } from "../control/model.js";
import type {
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordEvent,
  ControlRecordRelationshipTarget,
  ControlRecordRevision,
} from "../control/types.js";
import { FoundationError } from "../error.js";
import {
  canonicalJson,
  type Sha256,
} from "../validation/canonical.js";
import type {
  FoundationAgentRoleControlContextV7,
  FoundationAgentRoleControlResultV7,
} from "./agent-operation-v7.js";
import {
  FOUNDATION_EVIDENCE_RULE_SET_V7,
  FOUNDATION_EVIDENCE_VALIDATOR_V7,
  FOUNDATION_MATERIAL_CONDITION_RUNTIME_V7,
} from "./control-coordinates-v7.js";

export {
  FOUNDATION_EVIDENCE_RULE_SET_V7,
  FOUNDATION_EVIDENCE_VALIDATOR_V7,
} from "./control-coordinates-v7.js";

const CHECKPOINT_SCHEMA = "lifecycle.evaluation-finalization-support.v1" as const;
const MAXIMUM_EVENTS = 100_000;

export type FoundationEvaluationPhysicalObservationV7 = Readonly<{
  artifacts: readonly EvidencePacketArtifactObservation[];
  descriptionCoverage: readonly EvidencePacketDescriptionObservation[];
  reviewerSubjectDisposition: "exact-read-only" | "mutated" | "indeterminate";
  nonReadyDisposition?: "correctable" | "no-ship-recommended";
  diagnostics?: readonly EvidencePacketDiagnostic[];
}>;

export type FoundationEvaluationObservationContextV7 = Readonly<{
  store: FoundationAgentRoleControlContextV7["store"];
  activityId: string;
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
  seal: ControlRecordRevision;
  attempt: ControlRecordRevision;
  workProduct: ControlRecordRevision;
  receipt: ControlRecordRevision;
}>;

export type FoundationEvaluationObservationOwnerV7 = (
  input: FoundationEvaluationObservationContextV7,
) => Promise<FoundationEvaluationPhysicalObservationV7>;

export type FoundationEvaluationFinalizationV7Input =
  FoundationAgentRoleControlContextV7 & Readonly<{
    runtimeId: string;
    observeEvidence: FoundationEvaluationObservationOwnerV7;
  }>;

export type FoundationEvaluationFinalizationV7Options = Readonly<{
  now?: () => string;
  retainCondition?: typeof retainMaterialCondition;
  retainEvidence?: typeof retainEvidencePacket;
}>;

type EvaluationCheckpoint = Readonly<{
  schema: typeof CHECKPOINT_SCHEMA;
  activityId: string;
  observation: EvidencePacketObservation;
  conditionRequired: boolean;
  condition: RevisionReference | null;
}>;

type RevisionReference = Readonly<{
  id: string;
  revision: number;
  digest: Sha256;
}>;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.evaluation-finalization-v7.${code}`, message);
}

function object(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== "object") {
    fail("retained-fact", `${label} must be one exact object`);
  }
  return value as ControlJsonObject;
}

function string(value: ControlJsonValue | undefined, label: string): string {
  if (typeof value !== "string") fail("retained-fact", `${label} must be one exact string`);
  return value;
}

function boolean(value: ControlJsonValue | undefined, label: string): boolean {
  if (typeof value !== "boolean") fail("retained-fact", `${label} must be one exact boolean`);
  return value;
}

function digest(value: ControlJsonValue | undefined, label: string): Sha256 {
  const selected = string(value, label);
  if (!/^sha256:[a-f0-9]{64}$/u.test(selected)) {
    fail("retained-fact", `${label} must be one lowercase SHA-256 digest`);
  }
  return selected as Sha256;
}

function exactKeys(value: ControlJsonObject, keys: readonly string[], label: string): void {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    fail("retained-fact", `${label} does not have its exact closed shape`);
  }
}

function reference(revision: ControlRecordRevision): RevisionReference {
  return Object.freeze({
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function parseReference(value: ControlJsonValue | undefined, label: string): RevisionReference {
  const selected = object(value, label);
  exactKeys(selected, ["id", "revision", "digest"], label);
  if (!Number.isSafeInteger(selected.revision) || (selected.revision as number) < 1) {
    fail("retained-fact", `${label} revision must be one positive integer`);
  }
  return Object.freeze({
    id: controlIdentifier(string(selected.id, `${label} identity`), `${label} identity`),
    revision: selected.revision as number,
    digest: digest(selected.digest, `${label} digest`),
  });
}

function parseCandidateBindingReference(
  value: ControlJsonValue | undefined,
  label: string,
): RevisionReference {
  const selected = object(value, label);
  exactKeys(selected, ["kind", "id", "revision", "digest"], label);
  if (selected.kind !== "candidate-revision") {
    fail("candidate", `${label} kind must be candidate-revision`);
  }
  if (!Number.isSafeInteger(selected.revision) || (selected.revision as number) < 1) {
    fail("candidate", `${label} revision must be one positive integer`);
  }
  return Object.freeze({
    id: controlIdentifier(string(selected.id, `${label} identity`), `${label} identity`),
    revision: selected.revision as number,
    digest: digest(selected.digest, `${label} digest`),
  });
}

function sameReference(
  left: RevisionReference | ControlRecordRelationshipTarget,
  right: ControlRecordRevision,
): boolean {
  return left.id === right.recordId && left.revision === right.revision && left.digest === right.digest;
}

function exactRetained(
  input: FoundationEvaluationFinalizationV7Input,
  supplied: ControlRecordRevision,
  kind: string,
  label: string,
): ControlRecordRevision {
  const retained = input.store.getRevision(supplied.recordId, supplied.revision);
  if (
    retained === null || retained.processId !== input.store.identity.processId ||
    retained.recordKind !== kind || retained.digest !== supplied.digest ||
    canonicalJson(retained) !== canonicalJson(supplied)
  ) {
    fail("subject", `${label} does not reproduce one exact retained ${kind} revision`);
  }
  return retained;
}

function relationship(
  revision: ControlRecordRevision,
  relation: string,
  kind: string,
): ControlRecordRelationshipTarget {
  const selected = revision.relationships.filter(({ relation: candidate }) => candidate === relation);
  if (selected.length !== 1 || selected[0]!.target.kind !== kind) {
    fail("relationship", `${revision.recordKind} requires one exact ${relation} relationship to ${kind}`);
  }
  return selected[0]!.target;
}

function assertReviewerReceiptCandidate(
  receipt: ControlRecordRevision,
  candidate: ControlRecordRevision,
): void {
  if (receipt.relationships.some(({ relation }) => relation === "observes-candidate")) {
    fail("relationship", "Reviewer Execution Receipt must not bind a Candidate successor");
  }
  const binding = object(receipt.payload.candidate, "Reviewer Execution Receipt Candidate binding");
  exactKeys(
    binding,
    ["input", "successorDisposition", "successor", "contentDisposition"],
    "Reviewer Execution Receipt Candidate binding",
  );
  const input = object(binding.input, "Reviewer Execution Receipt input Candidate binding");
  exactKeys(
    input,
    ["revision", "carrierManifestDigest"],
    "Reviewer Execution Receipt input Candidate binding",
  );
  const carrier = object(candidate.payload.carrierManifest, "Evaluated Candidate Carrier manifest");
  if (
    receipt.payload.role !== "reviewer" ||
    !sameReference(
      parseCandidateBindingReference(
        input.revision,
        "Reviewer Execution Receipt input Candidate",
      ),
      candidate,
    ) ||
    digest(
      input.carrierManifestDigest,
      "Reviewer Execution Receipt input Candidate Carrier manifest digest",
    ) !== digest(carrier.digest, "Evaluated Candidate Carrier manifest digest") ||
    binding.successorDisposition !== null || binding.successor !== null ||
    binding.contentDisposition !== null
  ) {
    fail("candidate", "Reviewer Execution Receipt does not bind the exact input Candidate");
  }
}

function events(input: FoundationEvaluationFinalizationV7Input): readonly ControlRecordEvent[] {
  const result: ControlRecordEvent[] = [];
  let after = 0;
  for (;;) {
    const page = input.store.listEvents(after, 10_000);
    result.push(...page);
    if (result.length > MAXIMUM_EVENTS) fail("journal", "Evaluation finalization exceeds the Journal bound");
    if (page.length < 10_000) return Object.freeze(result);
    after = page.at(-1)!.sequence;
  }
}

function retainedActivitySubject(
  input: FoundationEvaluationFinalizationV7Input,
  all: readonly ControlRecordEvent[],
  eventKind: string,
  recordKind: string,
): ControlRecordRevision | null {
  const selected = all.filter((event) =>
    event.eventKind === eventKind && event.payload.activityId === input.activityId
  );
  if (selected.length > 1) fail("journal", `Evaluation repeats ${eventKind}`);
  const event = selected[0];
  if (event === undefined) return null;
  if (event.subject === null) fail("journal", `${eventKind} lacks its exact retained subject`);
  const revision = input.store.getRevision(event.subject.recordId, event.subject.revision);
  if (
    revision === null || revision.recordKind !== recordKind ||
    revision.digest !== event.subject.digest
  ) fail("journal", `${eventKind} does not resolve one exact retained ${recordKind}`);
  return revision;
}

function conditionRequired(workProduct: ControlRecordRevision): boolean {
  const semantics = object(workProduct.payload.roleSemantics, "Reviewer role semantics");
  if (semantics.role !== "reviewer" || !Array.isArray(semantics.conditions)) {
    fail("work-product", "Evaluation finalization requires exact reviewer role semantics");
  }
  if (semantics.conditions.length > 1) {
    fail("work-product", "Reviewer role semantics contain more than one Material Condition");
  }
  return semantics.conditions.length === 1;
}

function completeObservation(
  physical: FoundationEvaluationPhysicalObservationV7,
  evaluatedAt: string,
): EvidencePacketObservation {
  return Object.freeze({
    evaluatedAt,
    artifacts: Object.freeze([...physical.artifacts]),
    descriptionCoverage: Object.freeze([...physical.descriptionCoverage]),
    reviewerSubjectDisposition: physical.reviewerSubjectDisposition,
    ...(physical.nonReadyDisposition === undefined
      ? {}
      : { nonReadyDisposition: physical.nonReadyDisposition }),
    ...(physical.diagnostics === undefined
      ? {}
      : { diagnostics: Object.freeze([...physical.diagnostics]) }),
    ruleSet: FOUNDATION_EVIDENCE_RULE_SET_V7,
    validator: FOUNDATION_EVIDENCE_VALIDATOR_V7,
  });
}

function checkpointPayload(value: EvaluationCheckpoint): ControlJsonObject {
  return Object.freeze({
    schema: value.schema,
    activityId: value.activityId,
    observation: value.observation as unknown as ControlJsonObject,
    conditionRequired: value.conditionRequired,
    condition: value.condition === null ? null : Object.freeze({ ...value.condition }),
  });
}

function parseCheckpoint(
  value: ControlJsonObject,
  activityId: string,
): EvaluationCheckpoint {
  exactKeys(value, ["schema", "activityId", "observation", "conditionRequired", "condition"], "Evaluation checkpoint");
  if (value.schema !== CHECKPOINT_SCHEMA || value.activityId !== activityId) {
    fail("checkpoint", "Evaluation checkpoint does not bind the exact activity");
  }
  const observation = object(value.observation, "Evaluation Evidence observation");
  const observationKeys = [
    "evaluatedAt", "artifacts", "descriptionCoverage", "reviewerSubjectDisposition",
    "ruleSet", "validator",
  ];
  const allowedObservationKeys = new Set([...observationKeys, "nonReadyDisposition", "diagnostics"]);
  if (
    observationKeys.some((key) => !(key in observation)) ||
    Object.keys(observation).some((key) => !allowedObservationKeys.has(key))
  ) fail("checkpoint", "Evaluation Evidence observation does not have its exact bounded shape");
  controlTimestamp(string(observation.evaluatedAt, "Evidence evaluation time"), "Evidence evaluation time");
  if (!Array.isArray(observation.artifacts) || !Array.isArray(observation.descriptionCoverage)) {
    fail("checkpoint", "Evaluation Evidence observation inventories must be exact arrays");
  }
  if (
    observation.reviewerSubjectDisposition !== "exact-read-only" &&
    observation.reviewerSubjectDisposition !== "mutated" &&
    observation.reviewerSubjectDisposition !== "indeterminate"
  ) fail("checkpoint", "Evaluation reviewer-subject disposition is invalid");
  if (
    observation.nonReadyDisposition !== undefined &&
    observation.nonReadyDisposition !== "correctable" &&
    observation.nonReadyDisposition !== "no-ship-recommended"
  ) fail("checkpoint", "Evaluation non-ready disposition is invalid");
  if (observation.diagnostics !== undefined && !Array.isArray(observation.diagnostics)) {
    fail("checkpoint", "Evaluation diagnostics must be one exact array");
  }
  const ruleSet = object(observation.ruleSet, "Evidence rule set");
  const validator = object(observation.validator, "Evidence validator");
  if (
    canonicalJson(ruleSet) !== canonicalJson(FOUNDATION_EVIDENCE_RULE_SET_V7) ||
    canonicalJson(validator) !== canonicalJson(FOUNDATION_EVIDENCE_VALIDATOR_V7)
  ) fail("checkpoint", "Evaluation checkpoint substituted its installed Evidence mechanics");
  const condition = value.condition === null
    ? null
    : parseReference(value.condition, "Evaluation Material Condition");
  return Object.freeze({
    schema: CHECKPOINT_SCHEMA,
    activityId,
    observation: observation as unknown as EvidencePacketObservation,
    conditionRequired: boolean(value.conditionRequired, "Evaluation condition requirement"),
    condition,
  });
}

function assertInputSubjects(input: FoundationEvaluationFinalizationV7Input): Readonly<{
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
  seal: ControlRecordRevision;
  attempt: ControlRecordRevision;
  workProduct: ControlRecordRevision | null;
  receipt: ControlRecordRevision;
}> {
  if (input.operation !== "delivery.evaluate" || input.role !== "reviewer" || input.seal === null) {
    fail("operation", "Evaluation finalization accepts only one exact reviewer activity and Candidate Seal");
  }
  const boundary = exactRetained(input, input.boundary, "work-boundary", "Active Work Boundary");
  const candidate = exactRetained(input, input.resultCandidate, "candidate-revision", "Evaluated Candidate");
  const attemptedCandidate = exactRetained(
    input,
    input.attemptedCandidate,
    "candidate-revision",
    "Reviewer attempted Candidate",
  );
  if (canonicalJson(candidate) !== canonicalJson(attemptedCandidate)) {
    fail("candidate", "Reviewer finalization cannot replace the exact sealed Candidate");
  }
  const seal = exactRetained(input, input.seal, "candidate-seal", "Candidate Seal");
  const attempt = exactRetained(input, input.attempt, "agent-attempt", "Reviewer Attempt");
  const receipt = exactRetained(input, input.receipt, "execution-receipt", "Reviewer Receipt");
  const workProduct = input.workProduct === null
    ? null
    : exactRetained(input, input.workProduct, "agent-work-product", "Reviewer Work Product");
  assertReviewerReceiptCandidate(receipt, candidate);
  const state = input.store.state();
  if (
    state.subjects.activeBoundary === null || state.subjects.candidate === null ||
    state.subjects.seal === null ||
    !sameReference(state.subjects.activeBoundary, boundary) ||
    !sameReference(state.subjects.candidate, candidate) ||
    !sameReference(state.subjects.seal, seal) ||
    !sameReference(relationship(seal, "governed-by", "work-boundary"), boundary) ||
    !sameReference(relationship(seal, "seals", "candidate-revision"), candidate) ||
    !sameReference(relationship(attempt, "uses-boundary", "work-boundary"), boundary) ||
    !sameReference(relationship(attempt, "uses-candidate", "candidate-revision"), candidate) ||
    !sameReference(relationship(attempt, "uses-seal", "candidate-seal"), seal) ||
    !sameReference(relationship(receipt, "observes-attempt", "agent-attempt"), attempt)
  ) fail("subject", "Evaluation finalization subjects do not reproduce the exact current proof chain");
  if (workProduct !== null && (
    !sameReference(relationship(workProduct, "result-of", "agent-attempt"), attempt) ||
    !sameReference(relationship(receipt, "observes-work-product", "agent-work-product"), workProduct)
  )) fail("subject", "Reviewer Work Product and Receipt do not reproduce their exact Attempt chain");
  return Object.freeze({ boundary, candidate, seal, attempt, workProduct, receipt });
}

function assertRetainedEvidence(
  input: FoundationEvaluationFinalizationV7Input,
  evidence: ControlRecordRevision,
  subjects: ReturnType<typeof assertInputSubjects>,
): void {
  const current = input.store.state().subjects.evidence;
  if (
    current === null || !sameReference(current, evidence) ||
    !sameReference(relationship(evidence, "governed-by", "work-boundary"), subjects.boundary) ||
    !sameReference(relationship(evidence, "evaluates", "candidate-revision"), subjects.candidate) ||
    !sameReference(relationship(evidence, "uses-seal", "candidate-seal"), subjects.seal) ||
    subjects.workProduct === null ||
    !sameReference(relationship(evidence, "uses-review", "agent-work-product"), subjects.workProduct) ||
    !sameReference(relationship(evidence, "uses-review-receipt", "execution-receipt"), subjects.receipt)
  ) fail("evidence", "Retained Evidence Packet does not bind the exact evaluation subjects");
}

function retainedCondition(
  input: FoundationEvaluationFinalizationV7Input,
  all: readonly ControlRecordEvent[],
): ControlRecordRevision | null {
  const condition = retainedActivitySubject(
    input,
    all,
    "material-condition-frozen",
    "material-condition",
  );
  const current = input.store.state().subjects.materialCondition;
  if ((condition === null) !== (current === null)) {
    fail("condition", "Evaluation Material Condition differs from the current Delivery subject");
  }
  if (condition !== null && !sameReference(current!, condition)) {
    fail("condition", "Evaluation retained a different current Material Condition");
  }
  if (condition !== null) {
    if (
      input.workProduct === null ||
      !sameReference(relationship(condition, "reported-by", "agent-work-product"), input.workProduct) ||
      !sameReference(relationship(condition, "observed-in", "execution-receipt"), input.receipt) ||
      !sameReference(relationship(condition, "freezes", "candidate-revision"), input.resultCandidate) ||
      !sameReference(relationship(condition, "governed-by", "work-boundary"), input.boundary)
    ) fail("condition", "Evaluation Material Condition does not bind the exact reviewer facts");
  }
  return condition;
}

/**
 * Finalize one exact reviewer activity. Physical Evidence observations are
 * sampled once into the Agent activity's machine-custodied recovery support;
 * Control identities, relationships, readiness, and retained Markdown remain
 * runtime-derived. A retry either continues that exact observation or proves
 * the already-retained Evidence Packet—it never asks the Agent to reconstruct
 * protocol mechanics.
 */
export async function finalizeDeliveryEvaluationV7(
  input: FoundationEvaluationFinalizationV7Input,
  options: FoundationEvaluationFinalizationV7Options = {},
): Promise<FoundationAgentRoleControlResultV7> {
  const subjects = assertInputSubjects(input);
  if (subjects.workProduct === null) {
    if (input.support.current().checkpoint !== null) {
      fail("checkpoint", "An evaluation without a Work Product cannot retain Evidence recovery support");
    }
    return Object.freeze({ outcome: "failed", controls: Object.freeze([]) });
  }
  const all = events(input);
  const existingEvidence = retainedActivitySubject(
    input,
    all,
    "evidence-packet-finalized",
    "evidence-packet",
  );
  const existingCondition = retainedCondition(input, all);
  if (existingEvidence !== null) {
    assertRetainedEvidence(input, existingEvidence, subjects);
    const retainedSupport = input.support.current();
    if (retainedSupport.checkpoint !== null) {
      await input.support.step({
        mode: "checkpoint",
        expected: retainedSupport.coordinate,
        checkpoint: null,
      });
    }
    return Object.freeze({
      outcome: "completed",
      controls: Object.freeze([
        ...(existingCondition === null ? [] : [existingCondition]),
        existingEvidence,
      ]),
    });
  }

  const required = conditionRequired(subjects.workProduct);
  let support = input.support.current();
  let checkpoint: EvaluationCheckpoint;
  if (support.checkpoint === null) {
    const observedAt = controlTimestamp(
      (options.now ?? (() => new Date().toISOString()))(),
      "Evidence evaluation time",
    );
    const physical = await input.observeEvidence(Object.freeze({
      store: input.store,
      activityId: input.activityId,
      boundary: subjects.boundary,
      candidate: subjects.candidate,
      seal: subjects.seal,
      attempt: subjects.attempt,
      workProduct: subjects.workProduct,
      receipt: subjects.receipt,
    }));
    checkpoint = Object.freeze({
      schema: CHECKPOINT_SCHEMA,
      activityId: input.activityId,
      observation: completeObservation(physical, observedAt),
      conditionRequired: required,
      condition: null,
    });
    await input.support.step({
      mode: "checkpoint",
      expected: support.coordinate,
      checkpoint: checkpointPayload(checkpoint),
    });
    support = input.support.current();
    if (support.checkpoint === null) fail("checkpoint", "Evaluation observation checkpoint was not retained");
    checkpoint = parseCheckpoint(support.checkpoint, input.activityId);
  } else {
    checkpoint = parseCheckpoint(support.checkpoint, input.activityId);
    if (checkpoint.conditionRequired !== required) {
      fail("checkpoint", "Evaluation checkpoint changed its Material Condition requirement");
    }
  }

  let condition = existingCondition;
  if (required) {
    if (condition === null) {
      condition = (options.retainCondition ?? retainMaterialCondition)({
        store: input.store,
        activityId: input.activityId,
        runtime: FOUNDATION_MATERIAL_CONDITION_RUNTIME_V7,
        frozenAt: checkpoint.observation.evaluatedAt,
        runtimeId: input.runtimeId,
      }).revision;
    }
    if (checkpoint.condition === null) {
      checkpoint = Object.freeze({ ...checkpoint, condition: reference(condition) });
      await input.support.step({
        mode: "checkpoint",
        expected: support.coordinate,
        checkpoint: checkpointPayload(checkpoint),
      });
      support = input.support.current();
      if (support.checkpoint === null) fail("checkpoint", "Material Condition checkpoint was not retained");
      checkpoint = parseCheckpoint(support.checkpoint, input.activityId);
    } else if (!sameReference(checkpoint.condition, condition)) {
      fail("checkpoint", "Evaluation checkpoint substituted its retained Material Condition");
    }
  } else if (condition !== null || checkpoint.condition !== null) {
    fail("condition", "Evaluation retained a Material Condition without matching reviewer semantics");
  }

  const evidence = (options.retainEvidence ?? retainEvidencePacket)({
    store: input.store,
    activityId: input.activityId,
    observation: checkpoint.observation,
    runtimeId: input.runtimeId,
  }).revision;
  assertRetainedEvidence(input, evidence, subjects);
  await input.support.step({ mode: "checkpoint", expected: support.coordinate, checkpoint: null });
  return Object.freeze({
    outcome: "completed",
    controls: Object.freeze([...(condition === null ? [] : [condition]), evidence]),
  });
}
