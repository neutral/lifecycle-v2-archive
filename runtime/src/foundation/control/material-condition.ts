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

export const MATERIAL_CONDITION_CLASSES = Object.freeze([
  "meaning-ambiguity",
  "mandate-falsifier",
  "scope-change",
  "effect-change",
  "risk-change",
  "architecture-conflict",
  "assurance-conflict",
  "founder-tradeoff",
  "missing-authority",
  "missing-required-source",
  "required-capability-unavailable",
  "projection-closure-exceeded",
  "no-honest-route",
] as const);

export type MaterialConditionClass = typeof MATERIAL_CONDITION_CLASSES[number];

const MATERIAL_CONDITION_RULE_SET = Object.freeze({
  schema: "lifecycle.material-condition-rule-set.v1",
  id: "lifecycle.material-condition-freeze-rules.v1",
  sources: Object.freeze([
    Object.freeze({
      kind: "agent-proposal",
      recordKind: "agent-work-product",
      roles: Object.freeze(["builder", "reviewer"]),
      conditionCount: 1,
      founderJudgmentRequired: true,
    }),
  ]),
  joins: Object.freeze([
    "exact-agent-attempt",
    "exact-execution-receipt",
    "current-candidate-revision",
    "active-work-boundary",
    "exact-source-fragment",
    "admitted-mandate-and-knowledge-identities",
  ]),
  conditionClasses: MATERIAL_CONDITION_CLASSES,
});

export const MATERIAL_CONDITION_RULE_SET_ID = MATERIAL_CONDITION_RULE_SET.id;
export const MATERIAL_CONDITION_RULE_SET_DIGEST = digestCanonical(MATERIAL_CONDITION_RULE_SET);

type RuntimeCoordinates = Readonly<{
  implementationId: string;
  implementationDigest: Sha256;
}>;

type SourceCondition = Readonly<{
  sourceRole: "builder" | "reviewer";
  id: string;
  conditionClass: MaterialConditionClass;
  statement: string;
  falsifiedMandateIds: readonly string[];
  knowledgeIds: readonly string[];
  founderJudgmentRequired: true;
  fragmentDigest: Sha256;
}>;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.control-material-condition.${code}`, message);
}

function object(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    fail("retained-fact", `${label} is not one exact object`);
  }
  return value as ControlJsonObject;
}

function string(value: ControlJsonValue | undefined, label: string): string {
  if (typeof value !== "string") fail("retained-fact", `${label} is not one exact string`);
  return value;
}

function digest(value: ControlJsonValue | undefined, label: string): Sha256 {
  const exact = string(value, label);
  if (!/^sha256:[a-f0-9]{64}$/u.test(exact)) {
    fail("retained-fact", `${label} is not one lowercase SHA-256 digest`);
  }
  return exact as Sha256;
}

function stringArray(value: ControlJsonValue | undefined, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    fail("retained-fact", `${label} is not one exact string array`);
  }
  return Object.freeze([...value] as string[]);
}

function exactReference(revision: ControlRecordRevision): ControlRecordRelationshipTarget {
  return Object.freeze({
    kind: revision.recordKind,
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function sameReference(
  left: ControlRecordRelationshipTarget,
  right: ControlRecordRelationshipTarget,
): boolean {
  return left.kind === right.kind && left.id === right.id &&
    left.revision === right.revision && left.digest === right.digest;
}

function relationshipTarget(
  revision: ControlRecordRevision,
  relation: string,
  expectedKind: string,
): ControlRecordRelationshipTarget {
  const matches = revision.relationships.filter((item) => item.relation === relation);
  if (matches.length !== 1 || matches[0]!.target.kind !== expectedKind) {
    fail(
      "relationship",
      `${revision.recordKind} must have exactly one ${relation} relationship to ${expectedKind}`,
    );
  }
  return matches[0]!.target;
}

function relationshipTargets(
  revision: ControlRecordRevision,
  relation: string,
  expectedKind: string,
): readonly ControlRecordRelationshipTarget[] {
  const matches = revision.relationships
    .filter((item) => item.relation === relation)
    .map(({ target }) => target);
  if (matches.some(({ kind }) => kind !== expectedKind)) {
    fail("relationship", `${relation} must target only ${expectedKind}`);
  }
  return Object.freeze(matches);
}

function retainedTarget(
  store: ControlRecordStore,
  target: ControlRecordRelationshipTarget,
  label: string,
): ControlRecordRevision {
  const revision = store.getRevision(target.id, target.revision);
  if (
    revision === null || revision.recordKind !== target.kind ||
    revision.digest !== target.digest
  ) {
    fail("relationship", `${label} does not resolve one exact retained revision`);
  }
  return revision;
}

function retainedEventSubject(
  store: ControlRecordStore,
  event: ControlRecordEvent,
  expectedKind: string,
): ControlRecordRevision {
  if (event.subject === null) fail("journal", `${event.eventKind} has no retained subject`);
  const revision = store.getRevision(event.subject.recordId, event.subject.revision);
  if (
    revision === null || revision.recordKind !== expectedKind ||
    revision.digest !== event.subject.digest
  ) {
    fail("journal", `${event.eventKind} does not bind one exact retained ${expectedKind}`);
  }
  return revision;
}

function allEvents(store: ControlRecordStore): readonly ControlRecordEvent[] {
  const result: ControlRecordEvent[] = [];
  let cursor = 0;
  for (;;) {
    const page = store.listEvents(cursor, 10_000);
    result.push(...page);
    if (page.length < 10_000) return Object.freeze(result);
    cursor = page.at(-1)!.sequence;
    if (result.length > 100_000) fail("journal", "Material Condition lookup exceeds the Journal bound");
  }
}

function oneActivityEvent(
  events: readonly ControlRecordEvent[],
  activityId: string,
  eventKind: string,
): ControlRecordEvent {
  const matches = events.filter((event) =>
    event.eventKind === eventKind && event.payload.activityId === activityId
  );
  if (matches.length !== 1) {
    fail("journal", `Activity must have exactly one ${eventKind} event`);
  }
  return matches[0]!;
}

function retainedCurrentSubject(
  store: ControlRecordStore,
  expectedKind: string,
  value: Readonly<{ id: string; revision: number; digest: Sha256 }> | null,
  label: string,
): ControlRecordRevision {
  if (value === null) fail("currentness", `${label} is absent`);
  const revision = store.getRevision(value.id, value.revision);
  if (
    revision === null || revision.recordKind !== expectedKind ||
    revision.digest !== value.digest
  ) {
    fail("currentness", `${label} does not resolve one exact retained ${expectedKind}`);
  }
  return revision;
}

function exactConditionClass(
  value: string,
): MaterialConditionClass {
  if (!MATERIAL_CONDITION_CLASSES.includes(value as MaterialConditionClass)) {
    fail("condition-class", "Agent Material Condition has no installed runtime condition class");
  }
  return value as MaterialConditionClass;
}

function sourceCondition(workProduct: ControlRecordRevision): SourceCondition {
  if (workProduct.payload.schema !== "lifecycle.agent-work-product-payload.v2") {
    fail("work-product", "Material Condition source is not a current Agent Work Product");
  }
  const sourceRole = string(workProduct.payload.role, "Source Work Product role");
  if (sourceRole !== "builder" && sourceRole !== "reviewer") {
    fail("work-product", "Only builder or reviewer Work Product semantics can propose a Material Condition");
  }
  const semantics = object(workProduct.payload.roleSemantics, "Source Work Product role semantics");
  if (semantics.role !== sourceRole) {
    fail("work-product", "Material Condition source role and typed semantics disagree");
  }
  if (sourceRole === "builder" && semantics.proposal !== "material-condition") {
    fail("work-product", "Builder Work Product does not propose one Material Condition");
  }
  if (sourceRole === "reviewer") {
    const uncertainty = object(workProduct.payload.uncertainty, "Reviewer Work Product uncertainty");
    const missing = stringArray(semantics.missingObligationIds, "Reviewer missing-obligation identities");
    const judgments = semantics.judgments;
    if (!Array.isArray(judgments)) fail("work-product", "Reviewer judgments are not one exact array");
    const materialFinding = semantics.mandateExcess === true || missing.length > 0 ||
      uncertainty.level === "material" || judgments.some((value) =>
        object(value, "Reviewer judgment").uncertainty === "material");
    if (!materialFinding) {
      fail("work-product", "Reviewer Material Condition lacks one exact material review finding");
    }
  }
  if (!Array.isArray(semantics.conditions) || semantics.conditions.length !== 1) {
    fail("work-product", "Source Work Product must contain exactly one Material Condition proposal");
  }
  const condition = object(semantics.conditions[0], "Agent Material Condition proposal");
  if (condition.founderJudgmentRequired !== true) {
    fail("work-product", "A Process-frozen Material Condition must require Founder judgment");
  }
  const id = controlIdentifier(string(condition.id, "Source Material Condition identity"), "Source Material Condition identity");
  const conditionClass = exactConditionClass(string(
    condition.conditionClass,
    "Source Material Condition class",
  ));
  const statement = string(condition.statement, "Source Material Condition statement");
  const fragmentDigest = digest(condition.fragmentDigest, "Source Material Condition fragment digest");
  const falsifiedMandateIds = Object.freeze(sortUniqueCodePoints(
    stringArray(condition.falsifiedMandateIds, "Source falsified-mandate identities")
      .map((value) => controlIdentifier(value, "Source falsified-mandate identity")),
  ));
  const knowledgeIds = Object.freeze(sortUniqueCodePoints(
    stringArray(condition.knowledgeIds, "Source Material Condition Knowledge identities")
      .map((value) => controlIdentifier(value, "Source Material Condition Knowledge identity")),
  ));
  if (conditionClass === "mandate-falsifier" && falsifiedMandateIds.length === 0) {
    fail("condition-reference", "A mandate-falsifier must name at least one admitted mandate identity");
  }
  const body = object(workProduct.payload.body, "Agent Work Product body binding");
  if (!Array.isArray(body.fragments)) fail("work-product", "Agent Work Product omits its fragment inventory");
  const fragments = body.fragments.filter((value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    return value.id === id && value.kind === "condition";
  });
  if (fragments.length !== 1 || object(fragments[0], "Source Material Condition fragment").digest !== fragmentDigest) {
    fail("work-product", "Source Material Condition does not bind one exact retained body fragment");
  }
  return Object.freeze({
    sourceRole,
    id,
    conditionClass,
    statement,
    falsifiedMandateIds,
    knowledgeIds,
    founderJudgmentRequired: true,
    fragmentDigest,
  });
}

function mandateIdentities(boundary: ControlRecordRevision): ReadonlySet<string> {
  const mandate = object(boundary.payload.mandate, "Active Work Boundary mandate");
  const identities = new Set<string>();
  const addObject = (value: ControlJsonValue, label: string): void => {
    identities.add(controlIdentifier(string(object(value, label).id, `${label} identity`), `${label} identity`));
  };
  addObject(mandate.objective!, "Work Boundary objective");
  addObject(mandate.direction!, "Work Boundary direction");
  for (const field of [
    "effects",
    "risks",
    "obligations",
    "artifacts",
    "checks",
    "acceptancePropositions",
  ] as const) {
    const values = mandate[field];
    if (!Array.isArray(values)) fail("boundary", `Active Work Boundary mandate ${field} is not one exact array`);
    for (const [index, value] of values.entries()) addObject(value, `Work Boundary ${field}[${index}]`);
  }
  return identities;
}

function assertConditionReferences(
  condition: SourceCondition,
  boundary: ControlRecordRevision,
): void {
  const admittedMandateIds = mandateIdentities(boundary);
  for (const id of condition.falsifiedMandateIds) {
    if (!admittedMandateIds.has(id)) {
      fail("condition-reference", `Agent Material Condition names unadmitted mandate identity ${id}`);
    }
  }
  const knowledge = boundary.payload.knowledge;
  if (!Array.isArray(knowledge)) fail("boundary", "Active Work Boundary Knowledge selection is not one exact array");
  const admittedKnowledgeIds = new Set(knowledge.map((value, index) =>
    controlIdentifier(
      string(object(value, `Work Boundary Knowledge[${index}]`).id, `Work Boundary Knowledge[${index}] identity`),
      `Work Boundary Knowledge[${index}] identity`,
    )
  ));
  for (const id of condition.knowledgeIds) {
    if (!admittedKnowledgeIds.has(id)) {
      fail("condition-reference", `Agent Material Condition names Knowledge outside the active Boundary: ${id}`);
    }
  }
}

function normalizedLimitations(
  workProduct: ControlRecordRevision,
  candidate: ControlRecordRevision,
): readonly string[] {
  const result: string[] = [];
  const workProductLimitations = workProduct.payload.limitations;
  if (!Array.isArray(workProductLimitations)) {
    fail("work-product", "Agent Work Product limitations are not one exact array");
  }
  for (const [index, value] of workProductLimitations.entries()) {
    const statement = string(
      object(value, `Agent Work Product limitation[${index}]`).statement,
      `Agent Work Product limitation[${index}] statement`,
    ).replace(/\s+/gu, " ").trim();
    if (statement.length > 0) result.push(statement);
  }
  for (const value of stringArray(candidate.payload.limitations, "Candidate Revision limitations")) {
    const normalized = value.replace(/\s+/gu, " ").trim();
    if (normalized.length > 0) result.push(normalized);
  }
  return Object.freeze(sortUniqueCodePoints(result));
}

function recordIdentity(
  store: ControlRecordStore,
  sourceIdentity: string,
  observedFactsDigest: Sha256,
): string {
  const suffix = digestCanonical({
    recordKind: "material-condition",
    storeId: store.identity.storeId,
    processId: store.identity.processId,
    sourceIdentity,
    observedFactsDigest,
    ruleSetDigest: MATERIAL_CONDITION_RULE_SET_DIGEST,
  }).slice("sha256:".length);
  return `material-condition-${suffix}`;
}

function eventIdentity(store: ControlRecordStore, recordId: string): string {
  const suffix = digestCanonical({
    eventKind: "material-condition-frozen",
    storeId: store.identity.storeId,
    processId: store.identity.processId,
    recordId,
  }).slice("sha256:".length);
  return `event-material-condition-frozen-${suffix}`;
}

function semanticMarkdown(input: Readonly<{
  condition: SourceCondition;
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
}>): string {
  const quotedProposal = input.condition.statement
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .map((line) => `> ${line}`);
  return [
    "# Material Condition",
    "",
    "## Runtime conclusion",
    "",
    `- Condition class: ${input.condition.conditionClass}`,
    "- Productive work blocked: yes",
    `- Active Work Boundary: ${input.boundary.recordId} revision ${input.boundary.revision}`,
    `- Current Candidate Revision: ${input.candidate.recordId} revision ${input.candidate.revision}`,
    "",
    "The installed rule freezes productive work until Founder-governed boundary resolution.",
    "",
    "## Agent proposal",
    "",
    `Source proposal ${input.condition.id} (agent-proposed):`,
    "",
    ...quotedProposal,
    "",
  ].join("\n");
}

/**
 * Compile and atomically retain one runtime-derived Process freeze from the
 * exact current builder or reviewer activity. The Agent proposes semantics;
 * the installed rule, retained joins, and reducer currentness establish the freeze.
 */
export function retainMaterialCondition(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  runtime: RuntimeCoordinates;
  frozenAt: string;
  runtimeId: string;
}>): Readonly<{ revision: ControlRecordRevision; event: ControlRecordEvent }> {
  const activityId = controlIdentifier(input.activityId, "Material Condition activity identity");
  const frozenAt = controlTimestamp(input.frozenAt, "Material Condition freeze time");
  const implementationId = controlIdentifier(
    input.runtime.implementationId,
    "Material Condition runtime implementation identity",
  );
  if (!/^sha256:[a-f0-9]{64}$/u.test(input.runtime.implementationDigest)) {
    fail("runtime", "Material Condition runtime implementation digest is invalid");
  }

  const state = input.store.state();
  const activities = state.activities.filter(({ id }) => id === activityId);
  if (activities.length !== 1) fail("activity", "Material Condition activity is not exact and current");
  const activity = activities[0]!;
  if (
    activity.family !== "agent" ||
    (activity.operation !== "delivery.continue" && activity.operation !== "delivery.evaluate") ||
    activity.stage !== "finalizing"
  ) {
    fail("activity", "Material Condition can freeze only at an exact builder or reviewer finalization boundary");
  }
  if (
    state.subjects.materialCondition === null &&
    (activity.recovery?.kind !== "finalization" || activity.recovery.resumesAt !== "activity-finalization")
  ) {
    fail("activity", "Material Condition is not the exact next legal activity finalization");
  }

  const boundary = retainedCurrentSubject(
    input.store,
    "work-boundary",
    state.subjects.activeBoundary,
    "Active Work Boundary",
  );
  const candidate = retainedCurrentSubject(
    input.store,
    "candidate-revision",
    state.subjects.candidate,
    "Current Candidate Revision",
  );
  if (boundary.payload.schema !== "lifecycle.work-boundary-payload.v4") {
    fail("boundary", "Active Work Boundary payload schema is not current");
  }
  if (candidate.payload.schema !== "lifecycle.candidate-revision-payload.v2") {
    fail("candidate", "Current Candidate Revision payload schema is not current");
  }

  const events = allEvents(input.store);
  const workProductEvent = oneActivityEvent(events, activityId, "agent-work-product-submitted");
  const receiptEvent = oneActivityEvent(events, activityId, "execution-receipt-recorded");
  const workProduct = retainedEventSubject(input.store, workProductEvent, "agent-work-product");
  const receipt = retainedEventSubject(input.store, receiptEvent, "execution-receipt");
  if (Date.parse(frozenAt) < Date.parse(receiptEvent.occurredAt)) {
    fail("time", "Material Condition cannot predate its Execution Receipt");
  }

  const condition = sourceCondition(workProduct);
  const expectedRole = activity.operation === "delivery.continue" ? "builder" : "reviewer";
  if (condition.sourceRole !== expectedRole) {
    fail("work-product", "Material Condition source role does not match the exact Delivery operation");
  }
  assertConditionReferences(condition, boundary);

  const attemptTarget = relationshipTarget(workProduct, "result-of", "agent-attempt");
  const attempt = retainedTarget(input.store, attemptTarget, "Source Agent Attempt");
  if (attempt.payload.role !== expectedRole || attempt.payload.activityId !== activityId) {
    fail("attempt", "Material Condition source does not belong to this exact Agent activity");
  }
  if (!sameReference(relationshipTarget(attempt, "uses-boundary", "work-boundary"), exactReference(boundary))) {
    fail("relationship", "Source Agent Attempt does not use the active Work Boundary");
  }
  const attemptedCandidate = relationshipTarget(attempt, "uses-candidate", "candidate-revision");
  let candidateEvent: ControlRecordEvent | null = null;
  if (expectedRole === "builder") {
    candidateEvent = oneActivityEvent(events, activityId, "candidate-revision-observed");
    const observedCandidate = retainedEventSubject(input.store, candidateEvent, "candidate-revision");
    if (!sameReference(exactReference(candidate), exactReference(observedCandidate))) {
      fail("currentness", "Builder activity did not observe the exact current Candidate Revision");
    }
    if (!sameReference(relationshipTarget(candidate, "revises", "candidate-revision"), attemptedCandidate)) {
      fail("relationship", "Current Candidate Revision does not advance the exact attempted Candidate");
    }
  } else {
    const candidateEvents = events.filter((event) =>
      event.eventKind === "candidate-revision-observed" && event.payload.activityId === activityId);
    if (candidateEvents.length !== 0) {
      fail("journal", "Reviewer activity cannot create a Candidate Revision observation");
    }
    if (!sameReference(attemptedCandidate, exactReference(candidate))) {
      fail("relationship", "Reviewer Agent Attempt does not use the exact current Candidate Revision");
    }
    const sealTarget = relationshipTarget(attempt, "uses-seal", "candidate-seal");
    const seal = retainedTarget(input.store, sealTarget, "Reviewer Candidate Seal");
    if (!sameReference(relationshipTarget(seal, "seals", "candidate-revision"), exactReference(candidate))) {
      fail("relationship", "Reviewer Candidate Seal does not select the exact current Candidate Revision");
    }
  }
  if (!sameReference(relationshipTarget(candidate, "governed-by", "work-boundary"), exactReference(boundary))) {
    fail("relationship", "Current Candidate Revision is not governed by the active Work Boundary");
  }
  if (
    receipt.payload.schema !== "lifecycle.execution-receipt-payload.v3" ||
    receipt.payload.activityId !== activityId
  ) {
    fail("receipt", "Execution Receipt is not the exact current activity Receipt");
  }
  const workspace = object(receipt.payload.workspace, "Execution Receipt workspace observation");
  const workProductBinding = object(receipt.payload.workProduct, "Execution Receipt Work Product binding");
  const candidateBinding = object(receipt.payload.candidate, "Execution Receipt Candidate binding");
  const containment = object(receipt.payload.containment, "Execution Receipt Containment");
  const retirement = object(receipt.payload.retirement, "Execution Receipt Retirement");
  if (
    workspace.compilerDisposition !== "retained" || workProductBinding.disposition !== "submitted" ||
    containment.classification !== "contained" || retirement.classification !== "retired"
  ) {
    fail("receipt", "Execution Receipt does not establish retained Work Product and Candidate facts");
  }
  if (!sameReference(relationshipTarget(receipt, "observes-attempt", "agent-attempt"), exactReference(attempt))) {
    fail("relationship", "Execution Receipt does not observe the exact source Agent Attempt");
  }
  if (!sameReference(relationshipTarget(receipt, "observes-work-product", "agent-work-product"), exactReference(workProduct))) {
    fail("relationship", "Execution Receipt does not observe the exact source Work Product");
  }
  const observedCandidate = relationshipTargets(receipt, "observes-candidate", "candidate-revision");
  if (expectedRole === "builder") {
    if (
      observedCandidate.length !== 1 || !sameReference(observedCandidate[0]!, exactReference(candidate)) ||
      candidateBinding.successorDisposition !== "promoted"
    ) {
      fail("relationship", "Builder Execution Receipt does not observe the exact promoted Candidate successor");
    }
  } else if (observedCandidate.length !== 0 || candidateBinding.successor !== null) {
    fail("relationship", "Reviewer Execution Receipt cannot observe a Candidate successor");
  }

  const observedFactsDigest = digestCanonical(Object.freeze({
    schema: "lifecycle.material-condition-observed-facts.v1",
    activityId,
    workProduct: exactReference(workProduct),
    workProductEvent: Object.freeze({ sequence: workProductEvent.sequence, digest: workProductEvent.digest }),
    receipt: exactReference(receipt),
    receiptEvent: Object.freeze({ sequence: receiptEvent.sequence, digest: receiptEvent.digest }),
    candidate: exactReference(candidate),
    candidateEvent: candidateEvent === null
      ? null
      : Object.freeze({ sequence: candidateEvent.sequence, digest: candidateEvent.digest }),
    boundary: exactReference(boundary),
    sourceCondition: condition,
  }));
  const payload: ControlJsonObject = Object.freeze({
    schema: "lifecycle.material-condition-payload.v1",
    profileId: "lifecycle.material-condition.foundation-v1",
    conditionClass: condition.conditionClass,
    source: Object.freeze({
      kind: "agent-proposal",
      conditionId: condition.id,
      fragmentDigest: condition.fragmentDigest,
    }),
    observedFactsDigest,
    blocking: true,
    ruleSet: Object.freeze({
      id: MATERIAL_CONDITION_RULE_SET_ID,
      digest: MATERIAL_CONDITION_RULE_SET_DIGEST,
      implementationId,
      implementationDigest: input.runtime.implementationDigest,
    }),
    limitations: normalizedLimitations(workProduct, candidate),
  });
  const recordId = recordIdentity(input.store, activityId, observedFactsDigest);
  const relationships: readonly ControlRecordRelationship[] = Object.freeze([
    Object.freeze({ relation: "reported-by", target: exactReference(workProduct) }),
    Object.freeze({ relation: "observed-in", target: exactReference(receipt) }),
    Object.freeze({ relation: "freezes", target: exactReference(candidate) }),
    Object.freeze({ relation: "governed-by", target: exactReference(boundary) }),
  ]);
  const revisionInput = Object.freeze({
    recordId,
    recordKind: "material-condition",
    revision: 1,
    producer: Object.freeze({ kind: "runtime" as const, id: input.runtimeId }),
    semanticAuthor: Object.freeze({ kind: "runtime" as const, id: input.runtimeId }),
    semanticAuthority: "runtime-derived" as const,
    createdAt: frozenAt,
    semanticMarkdown: semanticMarkdown({ condition, boundary, candidate }),
    payload,
    relationships,
  });
  const compiled = compileControlRecordRevision(input.store.identity.processId, revisionInput);
  assertDeliveryControlRecordPolicy(compiled);
  assertDeliveryControlRecordPayload(compiled);
  if (state.subjects.materialCondition !== null && (
    state.subjects.materialCondition.id !== compiled.recordId ||
    state.subjects.materialCondition.revision !== compiled.revision ||
    state.subjects.materialCondition.digest !== compiled.digest
  )) {
    fail("currentness", "Delivery already has a different current Material Condition");
  }
  const retained = input.store.append({
    revision: revisionInput,
    event: {
      eventId: eventIdentity(input.store, recordId),
      eventKind: "material-condition-frozen",
      occurredAt: frozenAt,
      actor: { kind: "runtime", id: input.runtimeId },
      subject: { recordId: compiled.recordId, revision: compiled.revision, digest: compiled.digest },
      payload: {
        sourceKind: "agent-proposal",
        activityId,
        observedFactsDigest,
      },
    },
  });
  if (retained.revision === null) fail("retention", "Material Condition revision was not retained");
  return Object.freeze({ revision: retained.revision, event: retained.event });
}
