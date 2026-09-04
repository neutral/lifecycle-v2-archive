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
import type {
  FoundationAgentRoleControlContextV7,
  FoundationAgentRoleControlResultV7,
} from "./agent-operation-v7.js";
import { FOUNDATION_MATERIAL_CONDITION_RUNTIME_V7 } from "./control-coordinates-v7.js";

const CHECKPOINT_SCHEMA = "lifecycle.candidate-development-finalization-support.v1" as const;
const MAXIMUM_EVENTS = 100_000;

export type FoundationCandidateDevelopmentFinalizationV7Input =
  FoundationAgentRoleControlContextV7 & Readonly<{ runtimeId: string }>;

export type FoundationCandidateDevelopmentFinalizationV7Options = Readonly<{
  now?: () => string;
  retainCondition?: typeof retainMaterialCondition;
}>;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.candidate-development-finalization-v7.${code}`, message);
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

function sameReference(
  left: Readonly<{ id: string; revision: number; digest: string }> | ControlRecordRelationshipTarget,
  right: ControlRecordRevision,
): boolean {
  return left.id === right.recordId && left.revision === right.revision && left.digest === right.digest;
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

function conditionRequired(workProduct: ControlRecordRevision): boolean {
  const semantics = object(workProduct.payload.roleSemantics, "Builder role semantics");
  if (semantics.role !== "builder" || !Array.isArray(semantics.conditions)) {
    fail("work-product", "Candidate development requires exact builder role semantics");
  }
  if (semantics.conditions.length > 1) {
    fail("work-product", "Builder role semantics contain more than one Material Condition");
  }
  const proposal = string(semantics.proposal, "Builder proposal");
  if (
    (proposal === "material-condition") !== (semantics.conditions.length === 1) ||
    !["progress", "ready-to-evaluate", "material-condition", "unable", "no-product"].includes(proposal)
  ) fail("work-product", "Builder proposal and Material Condition semantics do not correspond");
  return proposal === "material-condition";
}

function events(input: FoundationCandidateDevelopmentFinalizationV7Input): readonly ControlRecordEvent[] {
  const result: ControlRecordEvent[] = [];
  let after = 0;
  for (;;) {
    const page = input.store.listEvents(after, 10_000);
    result.push(...page);
    if (result.length > MAXIMUM_EVENTS) fail("journal", "Candidate finalization exceeds the Journal bound");
    if (page.length < 10_000) return Object.freeze(result);
    after = page.at(-1)!.sequence;
  }
}

function retainedCondition(
  input: FoundationCandidateDevelopmentFinalizationV7Input,
): ControlRecordRevision | null {
  const selected = events(input).filter((event) =>
    event.eventKind === "material-condition-frozen" && event.payload.activityId === input.activityId
  );
  if (selected.length > 1) fail("journal", "Builder activity repeats its Material Condition");
  const event = selected[0];
  const current = input.store.state().subjects.materialCondition;
  if (event === undefined) {
    if (current !== null) fail("condition", "A different unresolved Material Condition is current");
    return null;
  }
  if (event.subject === null) fail("journal", "Material Condition event lacks its exact subject");
  const revision = input.store.getRevision(event.subject.recordId, event.subject.revision);
  if (
    revision === null || revision.recordKind !== "material-condition" ||
    revision.digest !== event.subject.digest || current === null ||
    !sameReference(current, revision) || input.workProduct === null ||
    !sameReference(relationship(revision, "reported-by", "agent-work-product"), input.workProduct) ||
    !sameReference(relationship(revision, "observed-in", "execution-receipt"), input.receipt) ||
    !sameReference(relationship(revision, "freezes", "candidate-revision"), input.resultCandidate) ||
    !sameReference(relationship(revision, "governed-by", "work-boundary"), input.boundary)
  ) fail("condition", "Retained Material Condition does not bind the exact builder facts");
  return revision;
}

function checkpoint(value: ControlJsonObject, activityId: string): string {
  if (
    Object.keys(value).sort().join("\0") !== ["activityId", "frozenAt", "schema"].sort().join("\0") ||
    value.schema !== CHECKPOINT_SCHEMA || value.activityId !== activityId
  ) fail("checkpoint", "Builder finalization checkpoint does not bind the exact activity");
  return controlTimestamp(string(value.frozenAt, "Material Condition freeze time"), "Material Condition freeze time");
}

function checkpointPayload(activityId: string, frozenAt: string): ControlJsonObject {
  return Object.freeze({ schema: CHECKPOINT_SCHEMA, activityId, frozenAt });
}

/**
 * Complete one bounded builder pass. Ordinary progress needs no extra Control
 * carrier. A proposed Material Condition freezes through the runtime rule and
 * stores its sampled time in the existing Agent support before retention, so
 * recovery cannot manufacture a new freeze fact.
 */
export async function finalizeCandidateDevelopmentV7(
  input: FoundationCandidateDevelopmentFinalizationV7Input,
  options: FoundationCandidateDevelopmentFinalizationV7Options = {},
): Promise<FoundationAgentRoleControlResultV7> {
  if (input.operation !== "delivery.continue" || input.role !== "builder") {
    fail("operation", "Candidate development finalization accepts only one exact builder activity");
  }
  if (input.workProduct === null) {
    if (input.support.current().checkpoint !== null) {
      fail("checkpoint", "A builder pass without a Work Product cannot retain role recovery support");
    }
    return Object.freeze({ outcome: "failed", controls: Object.freeze([]) });
  }
  if (
    !sameReference(relationship(input.workProduct, "result-of", "agent-attempt"), input.attempt) ||
    !sameReference(relationship(input.receipt, "observes-work-product", "agent-work-product"), input.workProduct) ||
    !sameReference(relationship(input.receipt, "observes-candidate", "candidate-revision"), input.resultCandidate) ||
    !sameReference(relationship(input.resultCandidate, "governed-by", "work-boundary"), input.boundary)
  ) fail("subject", "Builder finalization does not reproduce its exact observed Candidate chain");

  const required = conditionRequired(input.workProduct);
  const existing = retainedCondition(input);
  let support = input.support.current();
  if (!required) {
    if (existing !== null || support.checkpoint !== null) {
      fail("condition", "Ordinary Candidate progress cannot retain Material Condition support");
    }
    return Object.freeze({ outcome: "completed", controls: Object.freeze([]) });
  }
  if (existing !== null) {
    if (support.checkpoint !== null) {
      await input.support.step({
        mode: "checkpoint",
        expected: support.coordinate,
        checkpoint: null,
      });
    }
    return Object.freeze({ outcome: "completed", controls: Object.freeze([existing]) });
  }

  let frozenAt: string;
  if (support.checkpoint === null) {
    frozenAt = controlTimestamp(
      (options.now ?? (() => new Date().toISOString()))(),
      "Material Condition freeze time",
    );
    await input.support.step({
      mode: "checkpoint",
      expected: support.coordinate,
      checkpoint: checkpointPayload(
        controlIdentifier(input.activityId, "Builder activity identity"),
        frozenAt,
      ),
    });
    support = input.support.current();
    if (support.checkpoint === null) fail("checkpoint", "Builder freeze checkpoint was not retained");
    frozenAt = checkpoint(support.checkpoint, input.activityId);
  } else {
    frozenAt = checkpoint(support.checkpoint, input.activityId);
  }
  const condition = (options.retainCondition ?? retainMaterialCondition)({
    store: input.store,
    activityId: input.activityId,
    runtime: FOUNDATION_MATERIAL_CONDITION_RUNTIME_V7,
    frozenAt,
    runtimeId: input.runtimeId,
  }).revision;
  await input.support.step({ mode: "checkpoint", expected: support.coordinate, checkpoint: null });
  return Object.freeze({ outcome: "completed", controls: Object.freeze([condition]) });
}
