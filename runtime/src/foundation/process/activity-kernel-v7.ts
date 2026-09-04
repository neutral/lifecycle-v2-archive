import {
  compileDeliveryActivityCompletionAppend,
  compileTransactionEffectIntentAppend,
  compileTransactionEffectObservationAppend,
  recordDeliveryActivityRecovery,
  type DeliveryActivityOutcome,
  type DeliveryMutableOperation,
  type TransactionEffectOutcome,
} from "../control/activity.js";
import {
  canonicalControlJsonObject,
  compileControlRecordEvent,
  compileControlRecordRevision,
  controlIdentifier,
  controlTimestamp,
} from "../control/model.js";
import type { ControlRecordStore } from "../control/store.js";
import type {
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordEvent,
  ControlRecordFile,
  ControlRecordFileInput,
  ControlRecordOperationSupport,
  ControlRecordOperationSupportCoordinate,
  ControlRecordStoreAppend,
  ControlRecordStoreAppendResult,
} from "../control/types.js";
import { FoundationError } from "../error.js";
import {
  reduceDeliveryEvents,
  type ReducedDeliveryState,
} from "./delivery-reducer.js";
import {
  deliveryRecoveryDescriptor,
  type DeliveryRecoveryDescriptor,
} from "./recovery-registry.js";
import {
  assertFoundationTransactionObservationFactsV7,
  foundationTransactionObservationFactsDigestV7,
  parseFoundationTransactionObservationFactsV7,
  type FoundationTransactionDecisionKindV7,
  type FoundationTransactionObservationFactsV7,
} from "./transaction-observation-facts-v7.js";
import {
  canonicalJson,
  digestCanonical,
  type Sha256,
} from "../validation/canonical.js";

export const FOUNDATION_ACTIVITY_KERNEL_V7_SUPPORT_KIND =
  "delivery-activity-kernel-v7" as const;
export const FOUNDATION_ACTIVITY_KERNEL_V7_SUPPORT_SCHEMA =
  "lifecycle.delivery-activity-kernel-support.v1" as const;

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const MAXIMUM_PLAN_BYTES = 512 * 1024;
const MAXIMUM_CHECKPOINT_BYTES = 256 * 1024;
const MAXIMUM_COMPLETION_BYTES = 16 * 1024;
const MAXIMUM_JOURNAL_EVENTS = 100_000;
const MAXIMUM_RECOVERY_PASSES = 32;
const MAXIMUM_RECOVERY_JOURNAL_ADVANCE = 512;
const MAXIMUM_RECOVERY_SUPPORT_ADVANCE = 256;
const MAXIMUM_TRANSACTION_OBSERVATIONS = 64;

/**
 * These member names unambiguously denote machine-local physical custody.
 * The kernel does not inspect slash-containing strings: repository-relative
 * semantic paths are legitimate operation facts and string heuristics would
 * only create false assurance. Operation definitions remain responsible for
 * their exact durable schema and any additional physical-coordinate refusal.
 */
const PHYSICAL_COORDINATE_MEMBERS = new Set([
  "absolutePath",
  "custodyRoot",
  "cwd",
  "executablePath",
  "machineHome",
  "repositoryRoot",
  "residuePath",
  "socketPath",
  "workspaceRoot",
]);

export type FoundationActivityKernelStandardDefinitionV7<
  Plan extends ControlJsonObject = ControlJsonObject,
  Checkpoint extends ControlJsonObject = ControlJsonObject,
> = Readonly<{
  id: string;
  digest: Sha256;
  operation: Exclude<DeliveryMutableOperation, "delivery.accept" | "delivery.no-ship">;
  terminal: false;
  parsePlan(value: ControlJsonObject): Plan;
  parseCheckpoint(value: ControlJsonObject): Checkpoint;
}>;

export type FoundationActivityKernelTerminalDefinitionV7<
  Plan extends ControlJsonObject = ControlJsonObject,
  Checkpoint extends ControlJsonObject = ControlJsonObject,
> = Readonly<{
  id: string;
  digest: Sha256;
  operation: "delivery.accept" | "delivery.no-ship";
  terminal: true;
  parsePlan(value: ControlJsonObject): Plan;
  parseCheckpoint(value: ControlJsonObject): Checkpoint;
}>;

export type FoundationActivityKernelDefinitionV7<
  Plan extends ControlJsonObject = ControlJsonObject,
  Checkpoint extends ControlJsonObject = ControlJsonObject,
> =
  | FoundationActivityKernelStandardDefinitionV7<Plan, Checkpoint>
  | FoundationActivityKernelTerminalDefinitionV7<Plan, Checkpoint>;

type KernelValue<Value extends ControlJsonObject> = Readonly<{
  value: Value;
  digest: Sha256;
}>;

export type FoundationActivityKernelCompletionV7 = Readonly<{
  mode: "activity-completed" | "terminal-operation-append";
  outcome: DeliveryActivityOutcome;
  completedAt: string;
  operationEventKind: string | null;
  operationAppendDigest: Sha256 | null;
  digest: Sha256;
}>;

export type FoundationActivityKernelEnvelopeV7<
  Plan extends ControlJsonObject = ControlJsonObject,
  Checkpoint extends ControlJsonObject = ControlJsonObject,
> = Readonly<{
  schema: typeof FOUNDATION_ACTIVITY_KERNEL_V7_SUPPORT_SCHEMA;
  activityId: string;
  operation: DeliveryMutableOperation;
  definition: Readonly<{ id: string; digest: Sha256 }>;
  plan: KernelValue<Plan>;
  checkpoint: KernelValue<Checkpoint> | null;
  completion: FoundationActivityKernelCompletionV7 | null;
}>;

export type FoundationActivityKernelContextV7<
  Plan extends ControlJsonObject = ControlJsonObject,
  Checkpoint extends ControlJsonObject = ControlJsonObject,
> = Readonly<{
  support: ControlRecordOperationSupport;
  coordinate: ControlRecordOperationSupportCoordinate;
  envelope: FoundationActivityKernelEnvelopeV7<Plan, Checkpoint>;
  activity: ReducedDeliveryState["activities"][number];
  recovery: NonNullable<ReducedDeliveryState["activities"][number]["recovery"]>;
  descriptor: DeliveryRecoveryDescriptor;
  journal: ReducedDeliveryState["journal"];
}>;

export type FoundationActivityKernelCheckpointCommitV7 =
  | Readonly<{
      mode: "support-only";
      expected: ControlRecordOperationSupportCoordinate;
      checkpoint: ControlJsonObject | null;
    }>
  | Readonly<{
      mode: "append";
      expected: ControlRecordOperationSupportCoordinate;
      checkpoint: ControlJsonObject | null;
      append: ControlRecordStoreAppend;
    }>
  | Readonly<{
      mode: "ordered-appends";
      expected: ControlRecordOperationSupportCoordinate;
      checkpoint: ControlJsonObject | null;
      appends: readonly [ControlRecordStoreAppend, ...ControlRecordStoreAppend[]];
    }>;

export type FoundationActivityKernelCheckpointFileCommitV7 = Readonly<{
  expected: ControlRecordOperationSupportCoordinate;
  checkpoint: ControlJsonObject | null;
  append: ControlRecordStoreAppend;
  files: readonly ControlRecordFileInput[];
}>;

export type FoundationActivityKernelCheckpointResultV7<
  Plan extends ControlJsonObject = ControlJsonObject,
  Checkpoint extends ControlJsonObject = ControlJsonObject,
> = Readonly<{
  context: FoundationActivityKernelContextV7<Plan, Checkpoint>;
  append: ControlRecordStoreAppendResult | null;
  files: readonly ControlRecordFile[];
}>;

export type FoundationActivityKernelCheckpointAdapterV7<
  Plan extends ControlJsonObject = ControlJsonObject,
  Checkpoint extends ControlJsonObject = ControlJsonObject,
> = Readonly<{
  current(): FoundationActivityKernelContextV7<Plan, Checkpoint>;
  commit(
    input: FoundationActivityKernelCheckpointCommitV7,
  ): FoundationActivityKernelCheckpointResultV7<Plan, Checkpoint>;
  commitWithFiles(
    input: FoundationActivityKernelCheckpointFileCommitV7,
  ): Promise<FoundationActivityKernelCheckpointResultV7<Plan, Checkpoint>>;
}>;

export type FoundationActivityKernelRecoveryStepV7<Result> =
  | Readonly<{ status: "continue" }>
  | Readonly<{ status: "deferred"; value: Result }>
  | Readonly<{ status: "settled"; value: Result }>;

export type FoundationActivityKernelTransactionObservationV7<
  Checkpoint extends ControlJsonObject,
> = Readonly<{
  outcome: TransactionEffectOutcome;
  facts: FoundationTransactionObservationFactsV7;
  checkpoint: Checkpoint | null;
}>;

export type FoundationActivityKernelRetainedTransactionObservationV7<
  Checkpoint extends ControlJsonObject,
> = FoundationActivityKernelTransactionObservationV7<Checkpoint> & Readonly<{
  factsDigest: Sha256;
}>;

/**
 * Bind the current private Activity support generation for read invalidation
 * without allowing a read-model owner to inspect or own support mechanics.
 * The returned digest is never a recovery coordinate or public field.
 */
export function foundationActivitySupportBindingDigestV7(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
}>): Sha256 | null {
  const activityId = controlIdentifier(input.activityId, "Activity kernel identity");
  const support = input.store.getOperationSupport(activityId);
  if (support === null) return null;
  if (
    support.activityId !== activityId ||
    support.storeId !== input.store.identity.storeId ||
    support.processId !== input.store.identity.processId ||
    support.supportKind !== FOUNDATION_ACTIVITY_KERNEL_V7_SUPPORT_KIND ||
    support.payloadDigest !== digestCanonical(support.payload)
  ) {
    fail(
      "support-binding",
      "Activity support cannot supply one exact private read-invalidation binding",
    );
  }
  return digestCanonical({
    schema: "lifecycle.delivery-read-support-binding.private.v1",
    storeId: support.storeId,
    processId: support.processId,
    activityId: support.activityId,
    supportKind: support.supportKind,
    generation: support.generation,
    payloadDigest: support.payloadDigest,
  });
}

export type FoundationActivityKernelTransactionStepV7<
  Plan extends ControlJsonObject,
  Checkpoint extends ControlJsonObject,
> =
  | Readonly<{
      status: "not-applicable";
      context: FoundationActivityKernelContextV7<Plan, Checkpoint>;
      outcome: TransactionEffectOutcome | null;
    }>
  | Readonly<{
      status: "continue";
      eventKind: "transaction-effect-intended" | "transaction-effect-observed";
      context: FoundationActivityKernelContextV7<Plan, Checkpoint>;
      observation: FoundationActivityKernelRetainedTransactionObservationV7<Checkpoint> | null;
    }>
  | Readonly<{
      status: "deferred";
      eventKind: "transaction-effect-observed";
      context: FoundationActivityKernelContextV7<Plan, Checkpoint>;
      observation: FoundationActivityKernelRetainedTransactionObservationV7<Checkpoint>;
    }>;

function fail(
  code: string,
  message: string,
  observedFacts: Readonly<Record<string, unknown>> = {},
): never {
  throw new FoundationError(`lifecycle.activity-kernel-v7.${code}`, message, {
    observedFacts,
  });
}

function object(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== "object") {
    fail("support-shape", `${label} must be one exact object`);
  }
  return value as ControlJsonObject;
}

function exactMembers(
  value: ControlJsonObject,
  members: readonly string[],
  label: string,
): void {
  if (Object.keys(value).sort().join("\0") !== [...members].sort().join("\0")) {
    fail("support-shape", `${label} does not have its exact closed shape`);
  }
}

function text(value: ControlJsonValue | undefined, label: string): string {
  if (typeof value !== "string") fail("support-shape", `${label} must be one exact string`);
  return value;
}

function digest(value: ControlJsonValue | undefined, label: string): Sha256 {
  const selected = text(value, label);
  if (!SHA256_PATTERN.test(selected)) {
    fail("support-digest", `${label} must be one lowercase SHA-256 digest`);
  }
  return selected as Sha256;
}

function nullableText(value: ControlJsonValue | undefined, label: string): string | null {
  return value === null ? null : text(value, label);
}

function nullableDigest(value: ControlJsonValue | undefined, label: string): Sha256 | null {
  return value === null ? null : digest(value, label);
}

function canonicalObject(
  value: ControlJsonObject,
  label: string,
  maximumBytes: number,
): ControlJsonObject {
  const canonical = canonicalControlJsonObject(value, label);
  if (Buffer.byteLength(canonical, "utf8") > maximumBytes) {
    fail("support-bound", `${label} exceeds its kernel byte bound`);
  }
  return deepFreeze(JSON.parse(canonical) as ControlJsonObject);
}

function deepFreeze<Value extends ControlJsonValue>(value: Value): Value {
  if (value !== null && typeof value === "object") {
    const pending: object[] = [value];
    while (pending.length > 0) {
      const current = pending.pop()!;
      for (const member of Array.isArray(current) ? current : Object.values(current)) {
        if (member !== null && typeof member === "object" && !Object.isFrozen(member)) {
          pending.push(member);
        }
      }
      Object.freeze(current);
    }
  }
  return value;
}

function assertPathFreeMembers(value: ControlJsonObject, label: string): void {
  const pending: Array<Readonly<{ value: ControlJsonValue; coordinate: string }>> = [
    Object.freeze({ value, coordinate: label }),
  ];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.value === null || typeof current.value !== "object") continue;
    if (Array.isArray(current.value)) {
      current.value.forEach((member, index) => pending.push(Object.freeze({
        value: member,
        coordinate: `${current.coordinate}[${index}]`,
      })));
      continue;
    }
    for (const [key, member] of Object.entries(current.value)) {
      if (PHYSICAL_COORDINATE_MEMBERS.has(key)) {
        fail(
          "physical-coordinate",
          `${current.coordinate}.${key} is machine-local physical custody, not durable activity support`,
        );
      }
      pending.push(Object.freeze({ value: member, coordinate: `${current.coordinate}.${key}` }));
    }
  }
}

function definitionIdentity(
  definition: FoundationActivityKernelDefinitionV7,
): Readonly<{ id: string; digest: Sha256 }> {
  const id = controlIdentifier(definition.id, "Activity definition identity");
  if (!SHA256_PATTERN.test(definition.digest)) {
    fail("definition", "Activity definition digest must be one lowercase SHA-256 digest");
  }
  if (
    definition.terminal !== (
      definition.operation === "delivery.accept" || definition.operation === "delivery.no-ship"
    )
  ) {
    fail("definition", "Only acceptance and no-ship definitions use terminal completion");
  }
  return Object.freeze({ id, digest: definition.digest });
}

function parsedDurableValue<Value extends ControlJsonObject>(input: Readonly<{
  value: ControlJsonObject;
  label: string;
  maximumBytes: number;
  parse(value: ControlJsonObject): Value;
}>): Value {
  const canonical = canonicalObject(input.value, input.label, input.maximumBytes);
  const parsed = input.parse(canonical);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") {
    fail("definition-parser", `${input.label} parser did not return one JSON object`);
  }
  const exact = canonicalObject(parsed, `${input.label} parser result`, input.maximumBytes);
  if (canonicalJson(exact) !== canonicalJson(canonical)) {
    fail("definition-parser", `${input.label} parser must validate without rewriting retained facts`);
  }
  assertPathFreeMembers(exact, input.label);
  return exact as Value;
}

function kernelValue<Value extends ControlJsonObject>(
  value: Value,
): KernelValue<Value> {
  return Object.freeze({ value, digest: digestCanonical(value) });
}

function checkpointValue<Checkpoint extends ControlJsonObject>(
  definition: FoundationActivityKernelDefinitionV7<ControlJsonObject, Checkpoint>,
  value: ControlJsonObject | null,
): KernelValue<Checkpoint> | null {
  if (value === null) return null;
  return kernelValue(parsedDurableValue({
    value,
    label: "Activity checkpoint",
    maximumBytes: MAXIMUM_CHECKPOINT_BYTES,
    parse: definition.parseCheckpoint,
  }));
}

function completionDigest(
  value: Omit<FoundationActivityKernelCompletionV7, "digest">,
): Sha256 {
  return digestCanonical(value);
}

function completionValue(input: Readonly<{
  mode: FoundationActivityKernelCompletionV7["mode"];
  outcome: DeliveryActivityOutcome;
  completedAt: string;
  operationEventKind: string | null;
  operationAppendDigest: Sha256 | null;
}>): FoundationActivityKernelCompletionV7 {
  const facts = Object.freeze({
    mode: input.mode,
    outcome: input.outcome,
    completedAt: controlTimestamp(input.completedAt, "Activity completion time"),
    operationEventKind: input.operationEventKind,
    operationAppendDigest: input.operationAppendDigest,
  });
  canonicalObject(facts, "Activity completion facts", MAXIMUM_COMPLETION_BYTES);
  return Object.freeze({ ...facts, digest: completionDigest(facts) });
}

function envelopeObject(
  envelope: FoundationActivityKernelEnvelopeV7,
): ControlJsonObject {
  return Object.freeze({
    schema: envelope.schema,
    activityId: envelope.activityId,
    operation: envelope.operation,
    definition: envelope.definition,
    plan: envelope.plan,
    checkpoint: envelope.checkpoint,
    completion: envelope.completion,
  });
}

function parseCompletion(value: ControlJsonValue | undefined): FoundationActivityKernelCompletionV7 | null {
  if (value === null) return null;
  const selected = canonicalObject(
    object(value, "Activity completion facts"),
    "Activity completion facts",
    MAXIMUM_COMPLETION_BYTES,
  );
  exactMembers(selected, [
    "mode",
    "outcome",
    "completedAt",
    "operationEventKind",
    "operationAppendDigest",
    "digest",
  ], "Activity completion facts");
  const mode = text(selected.mode, "Activity completion mode");
  const outcome = text(selected.outcome, "Activity completion outcome");
  if (mode !== "activity-completed" && mode !== "terminal-operation-append") {
    fail("support-shape", "Activity completion has an unsupported mode");
  }
  if (outcome !== "completed" && outcome !== "failed" && outcome !== "abandoned") {
    fail("support-shape", "Activity completion has an unsupported outcome");
  }
  const completedAt = controlTimestamp(
    text(selected.completedAt, "Activity completion time"),
    "Activity completion time",
  );
  const operationEventKindValue = nullableText(
    selected.operationEventKind,
    "Activity completion operation event kind",
  );
  const operationEventKind = operationEventKindValue === null
    ? null
    : controlIdentifier(
        operationEventKindValue,
        "Activity completion operation event kind",
      );
  const operationAppendDigest = nullableDigest(
    selected.operationAppendDigest,
    "Activity completion operation append digest",
  );
  if (
    (mode === "activity-completed" && (
      operationEventKind !== null || operationAppendDigest !== null
    )) ||
    (mode === "terminal-operation-append" && (
      operationEventKind === null || operationAppendDigest === null
    ))
  ) {
    fail("support-shape", "Activity completion mode does not match its operation append binding");
  }
  const facts = Object.freeze({
    mode,
    outcome,
    completedAt,
    operationEventKind,
    operationAppendDigest,
  });
  const retainedDigest = digest(selected.digest, "Activity completion digest");
  if (completionDigest(facts) !== retainedDigest) {
    fail("support-digest", "Activity completion digest does not reproduce its exact facts");
  }
  return Object.freeze({ ...facts, digest: retainedDigest });
}

function parseKernelValue<Value extends ControlJsonObject>(input: Readonly<{
  value: ControlJsonValue | undefined;
  label: string;
  maximumBytes: number;
  parse(value: ControlJsonObject): Value;
}>): KernelValue<Value> {
  const selected = object(input.value, input.label);
  exactMembers(selected, ["digest", "value"], input.label);
  const value = parsedDurableValue({
    value: object(selected.value, `${input.label} value`),
    label: `${input.label} value`,
    maximumBytes: input.maximumBytes,
    parse: input.parse,
  });
  const retainedDigest = digest(selected.digest, `${input.label} digest`);
  if (digestCanonical(value) !== retainedDigest) {
    fail("support-digest", `${input.label} digest does not reproduce its exact value`);
  }
  return Object.freeze({ value, digest: retainedDigest });
}

function parseEnvelope<Plan extends ControlJsonObject, Checkpoint extends ControlJsonObject>(
  support: ControlRecordOperationSupport,
  definition: FoundationActivityKernelDefinitionV7<Plan, Checkpoint>,
): FoundationActivityKernelEnvelopeV7<Plan, Checkpoint> {
  if (support.supportKind !== FOUNDATION_ACTIVITY_KERNEL_V7_SUPPORT_KIND) {
    fail("support-kind", "Activity support is not owned by the common Activity kernel");
  }
  const payload = support.payload;
  exactMembers(payload, [
    "schema",
    "activityId",
    "operation",
    "definition",
    "plan",
    "checkpoint",
    "completion",
  ], "Activity kernel support");
  if (payload.schema !== FOUNDATION_ACTIVITY_KERNEL_V7_SUPPORT_SCHEMA) {
    fail("support-schema", "Activity kernel support has an unsupported schema");
  }
  const activityId = controlIdentifier(
    text(payload.activityId, "Activity kernel support identity"),
    "Activity kernel support identity",
  );
  const operation = text(payload.operation, "Activity kernel operation");
  const exactDefinition = definitionIdentity(definition);
  const retainedDefinition = object(payload.definition, "Activity definition binding");
  exactMembers(retainedDefinition, ["id", "digest"], "Activity definition binding");
  if (
    text(retainedDefinition.id, "Activity definition identity") !== exactDefinition.id ||
    digest(retainedDefinition.digest, "Activity definition digest") !== exactDefinition.digest ||
    operation !== definition.operation
  ) {
    fail("definition-substitution", "Activity support does not bind the exact selected definition");
  }
  const plan = parseKernelValue({
    value: payload.plan,
    label: "Activity plan",
    maximumBytes: MAXIMUM_PLAN_BYTES,
    parse: definition.parsePlan,
  });
  const checkpoint = payload.checkpoint === null
    ? null
    : parseKernelValue({
        value: payload.checkpoint,
        label: "Activity checkpoint",
        maximumBytes: MAXIMUM_CHECKPOINT_BYTES,
        parse: definition.parseCheckpoint,
      });
  const completion = parseCompletion(payload.completion);
  return Object.freeze({
    schema: FOUNDATION_ACTIVITY_KERNEL_V7_SUPPORT_SCHEMA,
    activityId,
    operation: definition.operation,
    definition: exactDefinition,
    plan,
    checkpoint,
    completion,
  });
}

function coordinate(
  support: ControlRecordOperationSupport,
): ControlRecordOperationSupportCoordinate {
  return Object.freeze({
    generation: support.generation,
    payloadDigest: support.payloadDigest,
  });
}

/**
 * Observe only the public-safe common-kernel coordinate for one live Activity
 * support generation. Callers cannot read or interpret the retained payload.
 */
export function inspectFoundationActivityKernelCoordinateV7(
  store: ControlRecordStore,
  activityId: string,
): ControlRecordOperationSupportCoordinate | null {
  const selected = store.getOperationSupport(controlIdentifier(activityId, "Activity kernel identity"));
  return selected === null ? null : coordinate(selected);
}

function sameCoordinate(
  left: ControlRecordOperationSupportCoordinate,
  right: ControlRecordOperationSupportCoordinate,
): boolean {
  return left.generation === right.generation && left.payloadDigest === right.payloadDigest;
}

function exactOpenActivity(
  state: ReducedDeliveryState,
  activityId: string,
  operation: DeliveryMutableOperation,
): Readonly<{
  activity: ReducedDeliveryState["activities"][number];
  recovery: NonNullable<ReducedDeliveryState["activities"][number]["recovery"]>;
  descriptor: DeliveryRecoveryDescriptor;
}> {
  const matches = state.activities.filter(({ id }) => id === activityId);
  if (matches.length !== 1 || matches[0]!.stage === "completed") {
    fail("activity", "Activity support requires one exact incomplete reducer activity");
  }
  const activity = matches[0]!;
  if (activity.operation !== operation || activity.recovery === null) {
    fail("activity", "Activity support differs from the exact reducer operation or recovery");
  }
  const descriptor = deliveryRecoveryDescriptor(
    activity.recovery.kind,
    activity.recovery.resumesAt,
  );
  return Object.freeze({ activity, recovery: activity.recovery, descriptor });
}

/**
 * Read one live kernel support generation and cross-check it against the sole
 * reducer-derived activity stage and registered recovery descriptor.
 */
export function readFoundationActivityKernelV7<
  Plan extends ControlJsonObject,
  Checkpoint extends ControlJsonObject,
>(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  definition: FoundationActivityKernelDefinitionV7<Plan, Checkpoint>;
}>): FoundationActivityKernelContextV7<Plan, Checkpoint> {
  const activityId = controlIdentifier(input.activityId, "Activity kernel identity");
  const support = input.store.getOperationSupport(activityId);
  if (support === null) fail("support", "Activity has no live common-kernel support");
  if (
    support.storeId !== input.store.identity.storeId ||
    support.processId !== input.store.identity.processId ||
    support.activityId !== activityId
  ) {
    fail("support-scope", "Activity support does not bind the exact Store, Process, and activity");
  }
  const envelope = parseEnvelope(support, input.definition);
  if (envelope.activityId !== activityId) {
    fail("support-scope", "Activity support payload names a different activity");
  }
  const state = input.store.state();
  const exact = exactOpenActivity(state, activityId, input.definition.operation);
  if (envelope.completion !== null) {
    if (
      envelope.completion.mode === "activity-completed" &&
      (exact.descriptor.next.type !== "event" ||
        !exact.descriptor.next.eventKinds.includes("activity-completed"))
    ) {
      fail("completion-coordinate", "Standard completion no longer matches reducer recovery");
    }
    if (envelope.completion.mode === "terminal-operation-append") {
      if (!input.definition.terminal || exact.descriptor.next.type !== "event" ||
        !exact.descriptor.next.eventKinds.includes(envelope.completion.operationEventKind!)) {
        fail("completion-coordinate", "Terminal completion no longer matches reducer recovery");
      }
    }
  }
  return Object.freeze({
    support,
    coordinate: coordinate(support),
    envelope,
    activity: exact.activity,
    recovery: exact.recovery,
    descriptor: exact.descriptor,
    journal: state.journal,
  });
}

function openingActivity(
  appends: readonly ControlRecordStoreAppend[],
  activityId: string,
  operation: DeliveryMutableOperation,
): void {
  const openings = appends.filter(({ event }) =>
    event.eventKind === "activity-started" && event.payload.activityId === activityId);
  if (
    openings.length !== 1 ||
    openings[0]!.event.payload.operation !== operation
  ) {
    fail("opening", "Activity opening must contain one exact matching activity-started append");
  }
}

/** Atomically retain operation-owned opening appends and the one kernel envelope. */
export function openFoundationActivityKernelV7<
  Plan extends ControlJsonObject,
  Checkpoint extends ControlJsonObject,
>(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  definition: FoundationActivityKernelDefinitionV7<Plan, Checkpoint>;
  plan: ControlJsonObject;
  checkpoint?: ControlJsonObject | null;
  appends: readonly ControlRecordStoreAppend[];
}>): FoundationActivityKernelContextV7<Plan, Checkpoint> {
  const activityId = controlIdentifier(input.activityId, "Activity kernel identity");
  const selectedDefinition = definitionIdentity(input.definition);
  openingActivity(input.appends, activityId, input.definition.operation);
  const plan = kernelValue(parsedDurableValue({
    value: input.plan,
    label: "Activity plan",
    maximumBytes: MAXIMUM_PLAN_BYTES,
    parse: input.definition.parsePlan,
  }));
  const checkpoint = checkpointValue(input.definition, input.checkpoint ?? null);
  const envelope: FoundationActivityKernelEnvelopeV7<Plan, Checkpoint> = Object.freeze({
    schema: FOUNDATION_ACTIVITY_KERNEL_V7_SUPPORT_SCHEMA,
    activityId,
    operation: input.definition.operation,
    definition: selectedDefinition,
    plan,
    checkpoint,
    completion: null,
  });
  const committed = input.store.commitOperationBatch({
    appends: Object.freeze([...input.appends]),
    supportMutations: Object.freeze([Object.freeze({
      action: "put" as const,
      value: Object.freeze({
        activityId,
        supportKind: FOUNDATION_ACTIVITY_KERNEL_V7_SUPPORT_KIND,
        payload: envelopeObject(envelope),
        expected: null,
      }),
    })]),
  });
  const retained = committed.supportMutations[0]?.support;
  if (retained === null || retained === undefined) {
    fail("opening", "Activity opening did not retain one exact kernel support generation");
  }
  return readFoundationActivityKernelV7({
    store: input.store,
    activityId,
    definition: input.definition,
  });
}

function nextEnvelope<Plan extends ControlJsonObject, Checkpoint extends ControlJsonObject>(
  context: FoundationActivityKernelContextV7<Plan, Checkpoint>,
  checkpoint: KernelValue<Checkpoint> | null,
  completion = context.envelope.completion,
): FoundationActivityKernelEnvelopeV7<Plan, Checkpoint> {
  return Object.freeze({ ...context.envelope, checkpoint, completion });
}

function assertCheckpointAppend(
  context: FoundationActivityKernelContextV7,
  append: ControlRecordStoreAppend,
): void {
  if (append.event.payload.activityId !== context.activity.id) {
    fail(
      "checkpoint-activity",
      "Checkpoint append does not belong to the exact kernel-owned activity",
    );
  }
  if (append.event.eventKind === "activity-completed" || append.event.eventKind === "closure-recorded") {
    fail("completion-owner", "Only the kernel completion functions may finish an activity");
  }
  if (
    context.descriptor.next.type !== "event" ||
    !context.descriptor.next.eventKinds.includes(append.event.eventKind)
  ) {
    fail(
      "checkpoint-coordinate",
      "Checkpoint append is not a legal next event at the exact reducer recovery coordinate",
    );
  }
}

/**
 * Create the sole generic support adapter. Synchronous support/append commits
 * mirror the synchronous Store primitives used by semantic finalizers. File
 * custody is necessarily asynchronous and remains one separately named atomic
 * files-plus-append-plus-support operation.
 */
export function createFoundationActivityKernelCheckpointAdapterV7<
  Plan extends ControlJsonObject,
  Checkpoint extends ControlJsonObject,
>(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  definition: FoundationActivityKernelDefinitionV7<Plan, Checkpoint>;
}>): FoundationActivityKernelCheckpointAdapterV7<Plan, Checkpoint> {
  const activityId = controlIdentifier(input.activityId, "Activity kernel identity");
  const prepare = (mutation: Readonly<{
    expected: ControlRecordOperationSupportCoordinate;
    checkpoint: ControlJsonObject | null;
  }>): Readonly<{
    current: FoundationActivityKernelContextV7<Plan, Checkpoint>;
    put: Readonly<{
      action: "put";
      value: Readonly<{
        activityId: string;
        supportKind: typeof FOUNDATION_ACTIVITY_KERNEL_V7_SUPPORT_KIND;
        payload: ControlJsonObject;
        expected: ControlRecordOperationSupportCoordinate;
      }>;
    }>;
  }> => {
    const current = readFoundationActivityKernelV7({ ...input, activityId });
    if (!sameCoordinate(current.coordinate, mutation.expected)) {
      fail("checkpoint-cas", "Checkpoint update does not name the exact support generation");
    }
    if (current.envelope.completion !== null) {
      fail("checkpoint-completion", "A checkpoint cannot change after completion is sampled");
    }
    const checkpoint = checkpointValue(input.definition, mutation.checkpoint);
    const envelope = nextEnvelope(current, checkpoint);
    return Object.freeze({
      current,
      put: Object.freeze({
        action: "put" as const,
        value: Object.freeze({
          activityId,
          supportKind: FOUNDATION_ACTIVITY_KERNEL_V7_SUPPORT_KIND,
          payload: envelopeObject(envelope),
          expected: current.coordinate,
        }),
      }),
    });
  };
  const result = (
    current: FoundationActivityKernelContextV7<Plan, Checkpoint>,
    append: ControlRecordStoreAppendResult | null,
    files: readonly ControlRecordFile[],
  ): FoundationActivityKernelCheckpointResultV7<Plan, Checkpoint> => {
    const next = readFoundationActivityKernelV7({ ...input, activityId });
    if (next.envelope.plan.digest !== current.envelope.plan.digest) {
      fail("plan-mutation", "Checkpoint update changed the immutable operation plan");
    }
    return Object.freeze({ context: next, append, files });
  };
  return Object.freeze({
    current: () => readFoundationActivityKernelV7({ ...input, activityId }),
    commit(
      mutation: FoundationActivityKernelCheckpointCommitV7,
    ): FoundationActivityKernelCheckpointResultV7<Plan, Checkpoint> {
      const prepared = prepare(mutation);
      let appendResult: ControlRecordStoreAppendResult | null = null;
      if (mutation.mode === "support-only") {
        input.store.putOperationSupport(prepared.put.value);
      } else {
        const appends = mutation.mode === "append"
          ? Object.freeze([mutation.append])
          : Object.freeze([...mutation.appends]);
        assertCheckpointAppend(prepared.current, appends[0]!);
        const committed = input.store.commitOperationBatch({
          appends,
          supportMutations: Object.freeze([prepared.put]),
        });
        appendResult = committed.appends[0] ?? null;
      }
      return result(prepared.current, appendResult, Object.freeze([]));
    },
    async commitWithFiles(
      mutation: FoundationActivityKernelCheckpointFileCommitV7,
    ): Promise<FoundationActivityKernelCheckpointResultV7<Plan, Checkpoint>> {
      const prepared = prepare(mutation);
      assertCheckpointAppend(prepared.current, mutation.append);
      if (mutation.files.length < 1) {
        fail("checkpoint-files", "A file-bound checkpoint must supply at least one file");
      }
      const committed = await input.store.commitOperationBatchWithFiles({
        files: Object.freeze([...mutation.files]),
        appends: Object.freeze([mutation.append]),
        supportMutations: Object.freeze([prepared.put]),
      });
      return result(
        prepared.current,
        committed.appends[0] ?? null,
        committed.files,
      );
    },
  });
}

function transactionActivityEvents(
  store: ControlRecordStore,
  activityId: string,
): Readonly<{
  intents: readonly ControlRecordEvent[];
  observations: readonly ControlRecordEvent[];
}> {
  const events = allEvents(store).filter((event) => event.payload.activityId === activityId);
  return Object.freeze({
    intents: Object.freeze(events.filter(({ eventKind }) =>
      eventKind === "transaction-effect-intended")),
    observations: Object.freeze(events.filter(({ eventKind }) =>
      eventKind === "transaction-effect-observed")),
  });
}

function transactionActivityDecisionKind(
  store: ControlRecordStore,
  activityId: string,
): FoundationTransactionDecisionKindV7 {
  const decisions = allEvents(store).filter((event) =>
    event.eventKind === "founder-decision-authenticated" &&
    event.payload.activityId === activityId);
  const selected = decisions.length === 1 ? decisions[0]!.subject : null;
  if (selected === null) {
    fail("transaction-decision", "Transaction activity lacks one exact Founder Decision subject");
  }
  const revision = store.getRevision(selected.recordId, selected.revision);
  if (
    revision === null ||
    revision.recordKind !== "founder-decision" ||
    revision.digest !== selected.digest
  ) {
    fail("transaction-decision", "Transaction activity Founder Decision does not resolve exactly");
  }
  const decision = revision.payload.decision;
  if (
    decision !== "admit" && decision !== "readmit" &&
    decision !== "accept" && decision !== "no-ship"
  ) {
    fail("transaction-decision", "Transaction activity Founder Decision kind is unsupported");
  }
  return decision;
}

function assertTransactionJournalCoordinate(input: Readonly<{
  store: ControlRecordStore;
  context: FoundationActivityKernelContextV7;
  effectDigest: Sha256;
  maximumObservations: number | null;
}>): Readonly<{ observationCount: number }> {
  const retained = transactionActivityEvents(input.store, input.context.activity.id);
  const decisionKind = transactionActivityDecisionKind(
    input.store,
    input.context.activity.id,
  );
  if (input.context.recovery.resumesAt === "transaction-effect-intended") {
    if (
      input.context.recovery.exactEffectDigest !== null ||
      retained.intents.length !== 0 || retained.observations.length !== 0
    ) {
      fail("transaction-coordinate", "Transaction intent differs from its exact Journal coordinate");
    }
    return Object.freeze({ observationCount: 0 });
  }
  if (
    input.context.recovery.resumesAt !== "transaction-effect-observed" ||
    input.context.recovery.exactEffectDigest !== input.effectDigest ||
    retained.intents.length !== 1 ||
    retained.intents[0]!.payload.effectDigest !== input.effectDigest
  ) {
    fail("transaction-coordinate", "Transaction observation differs from its exact intended effect");
  }
  if (
    input.maximumObservations !== null &&
    retained.observations.length >= input.maximumObservations
  ) {
    fail("transaction-observation-bound", "Transaction observation reached its fixed retained bound", {
      activityId: input.context.activity.id,
      observationCount: retained.observations.length,
      maximumObservations: input.maximumObservations,
    });
  }
  for (const observation of retained.observations) {
    if (
      observation.payload.effectDigest !== input.effectDigest ||
      observation.payload.outcome !== "indeterminate"
    ) {
      fail(
        "transaction-coordinate",
        "Transaction retry history differs from its exact indeterminate Journal observations",
      );
    }
    assertFoundationTransactionObservationFactsV7({
      operation: input.context.activity.operation,
      decisionKind,
      outcome: observation.payload.outcome as TransactionEffectOutcome,
      facts: observation.payload.facts,
      factsDigest: observation.payload.factsDigest,
    });
  }
  return Object.freeze({ observationCount: retained.observations.length });
}

function retainedTransactionOutcome(input: Readonly<{
  store: ControlRecordStore;
  context: FoundationActivityKernelContextV7;
  effectDigest: Sha256;
  maximumObservations: number | null;
}>): TransactionEffectOutcome | null {
  if (input.context.activity.family !== "transaction") return null;
  const retained = transactionActivityEvents(input.store, input.context.activity.id);
  const decisionKind = transactionActivityDecisionKind(
    input.store,
    input.context.activity.id,
  );
  if (retained.intents.length === 0 && retained.observations.length === 0) return null;
  if (
    retained.intents.length !== 1 ||
    retained.intents[0]!.payload.effectDigest !== input.effectDigest ||
    (input.maximumObservations !== null &&
      retained.observations.length > input.maximumObservations)
  ) {
    fail("transaction-coordinate", "Transaction history differs from its exact intended effect");
  }
  for (let index = 0; index < retained.observations.length; index += 1) {
    const observation = retained.observations[index]!;
    if (
      observation.payload.effectDigest !== input.effectDigest ||
      (index < retained.observations.length - 1 &&
        observation.payload.outcome !== "indeterminate")
    ) {
      fail("transaction-coordinate", "Transaction history contains a non-exact observation sequence");
    }
    assertFoundationTransactionObservationFactsV7({
      operation: input.context.activity.operation,
      decisionKind,
      outcome: observation.payload.outcome as TransactionEffectOutcome,
      facts: observation.payload.facts,
      factsDigest: observation.payload.factsDigest,
    });
  }
  const outcome = retained.observations.at(-1)?.payload.outcome;
  return outcome === undefined ? null : outcome as TransactionEffectOutcome;
}

/**
 * Advance one reducer-selected transaction intent or observation boundary.
 * The Journal is the sole authority for intent and observation history; the
 * operation checkpoint carries only physical or semantic facts not represented
 * by those events.
 */
export async function advanceFoundationActivityKernelTransactionEffectV7<
  Plan extends ControlJsonObject,
  Checkpoint extends ControlJsonObject,
>(input: Readonly<{
  store: ControlRecordStore;
  context: FoundationActivityKernelContextV7<Plan, Checkpoint>;
  checkpoint: FoundationActivityKernelCheckpointAdapterV7<Plan, Checkpoint>;
  effectDigest: Sha256;
  runtimeId: string;
  maximumObservations?: number | null;
  sampleIntendedAt(): string;
  sampleObservedAt(observationIndex: number): string;
  observe(input: Readonly<{
    context: FoundationActivityKernelContextV7<Plan, Checkpoint>;
    checkpoint: Checkpoint | null;
    observedAt: string;
    observationIndex: number;
  }>): Promise<FoundationActivityKernelTransactionObservationV7<Checkpoint>>;
  onCommitted?(input: Readonly<{
    eventKind: "transaction-effect-intended" | "transaction-effect-observed";
    context: FoundationActivityKernelContextV7<Plan, Checkpoint>;
    observation: FoundationActivityKernelRetainedTransactionObservationV7<Checkpoint> | null;
  }>): void | Promise<void>;
}>): Promise<FoundationActivityKernelTransactionStepV7<Plan, Checkpoint>> {
  const effectDigest = digest(input.effectDigest, "Transaction effect digest");
  const maximumObservations = input.maximumObservations === null
    ? null
    : boundedPositiveInteger(
        input.maximumObservations,
        8,
        MAXIMUM_TRANSACTION_OBSERVATIONS,
        "Maximum transaction observations",
      );
  if (
    input.context.activity.family !== "transaction" ||
    !(
      input.context.recovery.resumesAt === "transaction-effect-intended" ||
      input.context.recovery.resumesAt === "transaction-effect-observed"
    )
  ) {
    return Object.freeze({
      status: "not-applicable" as const,
      context: input.context,
      outcome: retainedTransactionOutcome({
        store: input.store,
        context: input.context,
        effectDigest,
        maximumObservations,
      }),
    });
  }
  const journal = assertTransactionJournalCoordinate({
    store: input.store,
    context: input.context,
    effectDigest,
    maximumObservations,
  });
  if (input.context.recovery.resumesAt === "transaction-effect-intended") {
    const committed = input.checkpoint.commit({
      mode: "append",
      expected: input.context.coordinate,
      checkpoint: input.context.envelope.checkpoint?.value ?? null,
      append: compileTransactionEffectIntentAppend({
        store: input.store,
        activityId: input.context.activity.id,
        effectDigest,
        intendedAt: controlTimestamp(
          input.sampleIntendedAt(),
          "Transaction effect intent time",
        ),
        runtimeId: input.runtimeId,
      }),
    });
    await input.onCommitted?.({
      eventKind: "transaction-effect-intended",
      context: committed.context,
      observation: null,
    });
    return Object.freeze({
      status: "continue" as const,
      eventKind: "transaction-effect-intended" as const,
      context: committed.context,
      observation: null,
    });
  }
  const observationIndex = journal.observationCount + 1;
  const observedAt = controlTimestamp(
    input.sampleObservedAt(observationIndex),
    "Transaction effect observation time",
  );
  const observation = await input.observe({
    context: input.context,
    checkpoint: input.context.envelope.checkpoint?.value ?? null,
    observedAt,
    observationIndex,
  });
  const facts = parseFoundationTransactionObservationFactsV7(observation.facts);
  const factsDigest = foundationTransactionObservationFactsDigestV7(facts);
  const committed = input.checkpoint.commit({
    mode: "append",
    expected: input.context.coordinate,
    checkpoint: observation.checkpoint,
    append: compileTransactionEffectObservationAppend({
      store: input.store,
      activityId: input.context.activity.id,
      effectDigest,
      outcome: observation.outcome,
      facts,
      observedAt,
      runtimeId: input.runtimeId,
    }),
  });
  const exactObservation = Object.freeze({ ...observation, facts, factsDigest });
  await input.onCommitted?.({
    eventKind: "transaction-effect-observed",
    context: committed.context,
    observation: exactObservation,
  });
  return observation.outcome === "indeterminate"
    ? Object.freeze({
        status: "deferred" as const,
        eventKind: "transaction-effect-observed" as const,
        context: committed.context,
        observation: exactObservation,
      })
    : Object.freeze({
        status: "continue" as const,
        eventKind: "transaction-effect-observed" as const,
        context: committed.context,
        observation: exactObservation,
      });
}

function putCompletion<Plan extends ControlJsonObject, Checkpoint extends ControlJsonObject>(
  store: ControlRecordStore,
  context: FoundationActivityKernelContextV7<Plan, Checkpoint>,
  completion: FoundationActivityKernelCompletionV7,
): void {
  store.putOperationSupport({
    activityId: context.activity.id,
    supportKind: FOUNDATION_ACTIVITY_KERNEL_V7_SUPPORT_KIND,
    payload: envelopeObject(nextEnvelope(
      context,
      context.envelope.checkpoint,
      completion,
    )),
    expected: context.coordinate,
  });
}

function completionEvent(
  store: ControlRecordStore,
  activityId: string,
): ControlRecordEvent | null {
  const matches = allEvents(store).filter((event) =>
    event.eventKind === "activity-completed" && event.payload.activityId === activityId);
  if (matches.length > 1) fail("completion", "Activity has repeated completion events");
  return matches[0] ?? null;
}

function assertCompletionTimeAtJournalHead(
  store: ControlRecordStore,
  completedAt: string,
): void {
  const head = allEvents(store).at(-1) ?? null;
  if (head !== null && Date.parse(completedAt) < Date.parse(head.occurredAt)) {
    fail(
      "completion-time",
      "Activity completion time cannot precede the exact Journal head",
    );
  }
}

function completedActivity(
  store: ControlRecordStore,
  activityId: string,
  operation: DeliveryMutableOperation,
): ReducedDeliveryState["activities"][number] | null {
  const matches = store.state().activities.filter(({ id }) => id === activityId);
  if (matches.length !== 1 || matches[0]!.operation !== operation) return null;
  return matches[0]!.stage === "completed" ? matches[0]! : null;
}

/**
 * Sample standard completion exactly once, retain that time in support, then
 * atomically append activity-completed and dispose the exact support row.
 */
export function finishFoundationActivityKernelV7<
  Plan extends ControlJsonObject,
  Checkpoint extends ControlJsonObject,
>(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  definition: FoundationActivityKernelDefinitionV7<Plan, Checkpoint>;
  runtimeId: string;
  outcome: DeliveryActivityOutcome;
  sampleCompletedAt(): string;
}>): ControlRecordEvent {
  const activityId = controlIdentifier(input.activityId, "Activity kernel identity");
  const alreadyCompleted = completedActivity(
    input.store,
    activityId,
    input.definition.operation,
  );
  if (alreadyCompleted !== null && input.store.getOperationSupport(activityId) === null) {
    const retained = completionEvent(input.store, activityId);
    if (retained === null || retained.payload.outcome !== input.outcome) {
      fail("completion-retry", "Completed activity does not reproduce the requested outcome");
    }
    return retained;
  }
  let current = readFoundationActivityKernelV7({ ...input, activityId });
  if (
    current.descriptor.next.type !== "event" ||
    !current.descriptor.next.eventKinds.includes("activity-completed")
  ) {
    fail("completion-coordinate", "Standard completion is not legal at the exact reducer recovery coordinate");
  }
  if (current.envelope.completion === null) {
    const completion = completionValue({
      mode: "activity-completed",
      outcome: input.outcome,
      completedAt: input.sampleCompletedAt(),
      operationEventKind: null,
      operationAppendDigest: null,
    });
    assertCompletionTimeAtJournalHead(input.store, completion.completedAt);
    putCompletion(input.store, current, completion);
    current = readFoundationActivityKernelV7({ ...input, activityId });
  }
  const completion = current.envelope.completion!;
  if (completion.mode !== "activity-completed" || completion.outcome !== input.outcome) {
    fail("completion-substitution", "Retained completion differs from the requested standard completion");
  }
  assertCompletionTimeAtJournalHead(input.store, completion.completedAt);
  const append = compileDeliveryActivityCompletionAppend({
    store: input.store,
    activityId,
    outcome: completion.outcome,
    completedAt: completion.completedAt,
    runtimeId: input.runtimeId,
  });
  const committed = input.store.commitOperationBatch({
    appends: Object.freeze([append]),
    supportMutations: Object.freeze([Object.freeze({
      action: "delete" as const,
      activityId,
      expected: current.coordinate,
    })]),
  });
  const event = committed.appends[0]?.event;
  if (
    event === undefined || event.eventKind !== "activity-completed" ||
    input.store.getOperationSupport(activityId) !== null ||
    completedActivity(input.store, activityId, input.definition.operation) === null
  ) {
    fail("completion-postcondition", "Standard completion did not produce its exact terminal postcondition");
  }
  return event;
}

function allEvents(store: ControlRecordStore): readonly ControlRecordEvent[] {
  const values: ControlRecordEvent[] = [];
  let after = 0;
  for (;;) {
    const page = store.listEvents(after, 10_000);
    values.push(...page);
    if (values.length > MAXIMUM_JOURNAL_EVENTS) {
      fail("journal-bound", "Activity kernel Journal lookup exceeds its bound");
    }
    if (page.length < 10_000) return Object.freeze(values);
    after = page.at(-1)!.sequence;
  }
}

function preflightOperationAppend(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  operation: "delivery.accept" | "delivery.no-ship";
  append: ControlRecordStoreAppend;
}>): void {
  const events = [...allEvents(input.store)];
  const prior = events.at(-1) ?? null;
  const revision = input.append.revision === undefined
    ? null
    : compileControlRecordRevision(
        input.store.identity.processId,
        input.append.revision,
      );
  const event = compileControlRecordEvent({
    storeId: input.store.identity.storeId,
    processId: input.store.identity.processId,
    sequence: (prior?.sequence ?? 0) + 1,
    predecessorDigest: prior?.digest ?? null,
    event: input.append.event,
  });
  events.push(event);
  const state = reduceDeliveryEvents(events, (reference) => {
    if (
      revision !== null && revision.recordId === reference.recordId &&
      revision.revision === reference.revision && revision.digest === reference.digest
    ) return revision;
    return input.store.getRevision(reference.recordId, reference.revision);
  });
  const selected = state.activities.filter(({ id }) => id === input.activityId);
  if (
    selected.length !== 1 || selected[0]!.operation !== input.operation ||
    selected[0]!.stage !== "completed" || selected[0]!.recovery !== null
  ) {
    fail("terminal-proof", "Operation append does not prove reducer completion of the exact activity");
  }
}

/**
 * Terminal definitions finish with one operation-owned append (Closure in the
 * current Delivery model). The kernel binds the exact compiled append before
 * retention and preflights the full reducer so support cannot be deleted by an
 * append that leaves the activity incomplete.
 */
export function finishFoundationTerminalActivityKernelV7<
  Plan extends ControlJsonObject,
  Checkpoint extends ControlJsonObject,
>(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  definition: FoundationActivityKernelTerminalDefinitionV7<Plan, Checkpoint>;
  outcome: DeliveryActivityOutcome;
  sampleCompletedAt(): string;
  compileOperationAppend(
    context: FoundationActivityKernelContextV7<Plan, Checkpoint>,
    completedAt: string,
  ): ControlRecordStoreAppend;
}>): ControlRecordStoreAppendResult {
  const activityId = controlIdentifier(input.activityId, "Activity kernel identity");
  const alreadyCompleted = completedActivity(
    input.store,
    activityId,
    input.definition.operation,
  );
  if (alreadyCompleted !== null && input.store.getOperationSupport(activityId) === null) {
    fail(
      "terminal-retry",
      "Terminal completion is already retained; its operation owner must resolve the retained result",
    );
  }
  let current = readFoundationActivityKernelV7({ ...input, activityId });
  let append: ControlRecordStoreAppend;
  if (input.outcome !== "completed") {
    fail("terminal-outcome", "A terminal Closure definition completes only with outcome completed");
  }
  if (current.envelope.completion === null) {
    const completedAt = controlTimestamp(
      input.sampleCompletedAt(),
      "Terminal activity completion time",
    );
    append = input.compileOperationAppend(current, completedAt);
    if (append.event.occurredAt !== completedAt) {
      fail("terminal-time", "Terminal operation append must use the sampled completion time");
    }
    if (
      current.descriptor.next.type !== "event" ||
      !current.descriptor.next.eventKinds.includes(append.event.eventKind)
    ) {
      fail("terminal-coordinate", "Terminal operation append is not legal at reducer recovery");
    }
    assertCompletionTimeAtJournalHead(input.store, completedAt);
    preflightOperationAppend({
      store: input.store,
      activityId,
      operation: input.definition.operation,
      append,
    });
    const completion = completionValue({
      mode: "terminal-operation-append",
      outcome: input.outcome,
      completedAt,
      operationEventKind: append.event.eventKind,
      operationAppendDigest: digestCanonical(append),
    });
    putCompletion(input.store, current, completion);
    current = readFoundationActivityKernelV7({ ...input, activityId });
  }
  const completion = current.envelope.completion!;
  if (completion.mode !== "terminal-operation-append" || completion.outcome !== input.outcome) {
    fail("completion-substitution", "Retained completion differs from the requested terminal completion");
  }
  append = input.compileOperationAppend(current, completion.completedAt);
  if (
    append.event.occurredAt !== completion.completedAt ||
    append.event.eventKind !== completion.operationEventKind ||
    digestCanonical(append) !== completion.operationAppendDigest
  ) {
    fail("terminal-substitution", "Recompiled terminal append differs from its retained completion binding");
  }
  preflightOperationAppend({
    store: input.store,
    activityId,
    operation: input.definition.operation,
    append,
  });
  const committed = input.store.commitOperationBatch({
    appends: Object.freeze([append]),
    supportMutations: Object.freeze([Object.freeze({
      action: "delete" as const,
      activityId,
      expected: current.coordinate,
    })]),
  });
  const result = committed.appends[0];
  if (
    result === undefined || input.store.getOperationSupport(activityId) !== null ||
    completedActivity(input.store, activityId, input.definition.operation) === null
  ) {
    fail("terminal-postcondition", "Terminal operation append did not produce exact reducer completion");
  }
  return result;
}

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > maximum) {
    fail("recovery-bound", `${label} must be between 1 and ${maximum}`);
  }
  return selected;
}

function recoveryFacts(
  context: FoundationActivityKernelContextV7,
  passes: number,
  journalAdvance: number,
  supportAdvance: number,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    activityId: context.activity.id,
    operation: context.activity.operation,
    recovery: Object.freeze({
      kind: context.recovery.kind,
      resumesAt: context.recovery.resumesAt,
      exactEffectDigest: context.recovery.exactEffectDigest,
    }),
    passes,
    journalAdvance,
    supportAdvance,
  });
}

type FoundationActivityKernelProgressInputV7<
  Plan extends ControlJsonObject,
  Checkpoint extends ControlJsonObject,
  Result,
> = Readonly<{
  store: ControlRecordStore;
  activityId: string;
  definition: FoundationActivityKernelDefinitionV7<Plan, Checkpoint>;
  runtimeId: string;
  now?: () => string;
  recordRecovery: boolean;
  maximumPasses?: number;
  maximumJournalAdvance?: number;
  maximumSupportAdvance?: number;
  step(input: Readonly<{
    context: FoundationActivityKernelContextV7<Plan, Checkpoint>;
    checkpoint: FoundationActivityKernelCheckpointAdapterV7<Plan, Checkpoint>;
    pass: number;
  }>): Promise<FoundationActivityKernelRecoveryStepV7<Result>>;
}>;

async function progressFoundationActivityKernelV7<
  Plan extends ControlJsonObject,
  Checkpoint extends ControlJsonObject,
  Result,
>(input: FoundationActivityKernelProgressInputV7<Plan, Checkpoint, Result>): Promise<Result> {
  const maximumPasses = boundedPositiveInteger(
    input.maximumPasses,
    16,
    MAXIMUM_RECOVERY_PASSES,
    "Maximum recovery passes",
  );
  const maximumJournalAdvance = boundedPositiveInteger(
    input.maximumJournalAdvance,
    128,
    MAXIMUM_RECOVERY_JOURNAL_ADVANCE,
    "Maximum recovery Journal advance",
  );
  const maximumSupportAdvance = boundedPositiveInteger(
    input.maximumSupportAdvance,
    64,
    MAXIMUM_RECOVERY_SUPPORT_ADVANCE,
    "Maximum recovery support advance",
  );
  const adapter = createFoundationActivityKernelCheckpointAdapterV7(input);
  const initial = adapter.current();
  const initialJournalCount = initial.journal.eventCount;
  const initialSupportGeneration = initial.coordinate.generation;
  const exactPlanDigest = initial.envelope.plan.digest;
  let latest = initial;
  for (let pass = 1; pass <= maximumPasses; pass += 1) {
    if (latest.envelope.plan.digest !== exactPlanDigest) {
      fail("recovery-plan", "Recovery cannot replace or resample the retained activity plan");
    }
    if (input.recordRecovery) {
      if (input.now === undefined) {
        fail("recovery-time", "Recovery progression requires one exact diagnostic clock");
      }
      recordDeliveryActivityRecovery({
        store: input.store,
        activityId: latest.activity.id,
        recordedAt: latest.envelope.completion?.completedAt ??
          controlTimestamp(input.now(), "Activity recovery diagnostic time"),
        runtimeId: input.runtimeId,
      });
    }
    const before = adapter.current();
    const step = await input.step({ context: before, checkpoint: adapter, pass });
    const state = input.store.state();
    const afterActivity = state.activities.find(({ id }) => id === latest.activity.id);
    const afterSupport = input.store.getOperationSupport(latest.activity.id);
    const journalAdvance = state.journal.eventCount - initialJournalCount;
    const supportAdvance = (afterSupport?.generation ?? before.coordinate.generation) -
      initialSupportGeneration;
    if (journalAdvance > maximumJournalAdvance || supportAdvance > maximumSupportAdvance) {
      fail(
        "recovery-progress-bound",
        "Activity recovery exceeded its bounded durable progress",
        recoveryFacts(before, pass, journalAdvance, supportAdvance),
      );
    }
    if (step.status === "settled") {
      if (afterActivity?.stage !== "completed" || afterSupport !== null) {
        fail(
          "recovery-settlement",
          "Recovery reported settlement without completed reducer state and disposed support",
          recoveryFacts(before, pass, journalAdvance, supportAdvance),
        );
      }
      return step.value;
    }
    if (afterActivity?.stage === "completed" || afterSupport === null) {
      fail(
        step.status === "deferred" ? "recovery-deferral" : "recovery-result",
        step.status === "deferred"
          ? "Recovery deferred after completing the activity or disposing its support"
          : "Recovery completed durably but did not return its settled result",
        recoveryFacts(before, pass, journalAdvance, supportAdvance),
      );
    }
    latest = adapter.current();
    if (latest.envelope.plan.digest !== exactPlanDigest) {
      fail(
        "recovery-plan",
        "Recovery cannot replace or resample the retained activity plan",
        recoveryFacts(latest, pass, journalAdvance, supportAdvance),
      );
    }
    if (
      latest.journal.headDigest === before.journal.headDigest &&
      sameCoordinate(latest.coordinate, before.coordinate)
    ) {
      fail(
        "recovery-no-progress",
        "Recovery pass made no durable Journal or checkpoint progress",
        recoveryFacts(latest, pass, journalAdvance, supportAdvance),
      );
    }
    if (step.status === "deferred") {
      if (latest.envelope.completion !== null) {
        fail(
          "recovery-deferral",
          "Recovery cannot defer after sampling immutable completion facts",
          recoveryFacts(latest, pass, journalAdvance, supportAdvance),
        );
      }
      return step.value;
    }
  }
  const state = input.store.state();
  fail(
    "recovery-pass-bound",
    "Activity recovery exhausted its bounded pass count",
    recoveryFacts(
      latest,
      maximumPasses,
      state.journal.eventCount - initialJournalCount,
      latest.coordinate.generation - initialSupportGeneration,
    ),
  );
}

/**
 * Progress a freshly opened activity one reducer-selected durable step per
 * pass. Unlike recovery this path emits no recovery diagnostic; plan, Journal,
 * support-generation, settlement, and no-progress invariants are identical.
 */
export async function advanceFoundationActivityKernelV7<
  Plan extends ControlJsonObject,
  Checkpoint extends ControlJsonObject,
  Result,
>(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  definition: FoundationActivityKernelDefinitionV7<Plan, Checkpoint>;
  runtimeId: string;
  maximumPasses?: number;
  maximumJournalAdvance?: number;
  maximumSupportAdvance?: number;
  advance(input: Readonly<{
    context: FoundationActivityKernelContextV7<Plan, Checkpoint>;
    checkpoint: FoundationActivityKernelCheckpointAdapterV7<Plan, Checkpoint>;
    pass: number;
  }>): Promise<FoundationActivityKernelRecoveryStepV7<Result>>;
}>): Promise<Result> {
  return progressFoundationActivityKernelV7({
    ...input,
    recordRecovery: false,
    step: input.advance,
  });
}

/**
 * Resume operation-owned physical logic from retained plan/checkpoint values.
 * The wrapper records only the reducer's exact recovery fact, rejects a pass
 * with no durable progress, and bounds total passes, Journal motion, and
 * support generations. A durably progressing pass may return one deferred
 * result while the exact activity and support remain live. It has no plan
 * sampler or caller-supplied stage.
 */
export async function recoverFoundationActivityKernelV7<
  Plan extends ControlJsonObject,
  Checkpoint extends ControlJsonObject,
  Result,
>(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  definition: FoundationActivityKernelDefinitionV7<Plan, Checkpoint>;
  runtimeId: string;
  now(): string;
  maximumPasses?: number;
  maximumJournalAdvance?: number;
  maximumSupportAdvance?: number;
  resume(input: Readonly<{
    context: FoundationActivityKernelContextV7<Plan, Checkpoint>;
    checkpoint: FoundationActivityKernelCheckpointAdapterV7<Plan, Checkpoint>;
    pass: number;
  }>): Promise<FoundationActivityKernelRecoveryStepV7<Result>>;
}>): Promise<Result> {
  return progressFoundationActivityKernelV7({
    ...input,
    recordRecovery: true,
    step: input.resume,
  });
}
