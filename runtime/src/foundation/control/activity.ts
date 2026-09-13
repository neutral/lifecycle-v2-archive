import { randomUUID } from "node:crypto";
import { FoundationError } from "../error.js";
import type {
  ReducedDeliveryState,
} from "../process/delivery-reducer.js";
import type {
  DeliveryOperation,
  DeliveryRecoveryObligation,
} from "../process/delivery-state.js";
import {
  assertFoundationTransactionObservationFactsV7,
  parseFoundationTransactionObservationFactsV7,
  type FoundationTransactionDecisionKindV7,
  type FoundationTransactionObservationFactsV7,
} from "../process/transaction-observation-facts-v7.js";
import { digestCanonical, type Sha256 } from "../validation/canonical.js";
import {
  controlIdentifier,
  controlTimestamp,
} from "./model.js";
import type { ControlRecordStore } from "./store.js";
import { parseWorkDelegationReservation, type WorkDelegationReservation } from "./work-delegation.js";
import type {
  ControlJsonObject,
  ControlRecordEvent,
  ControlRecordStoreAppend,
  ControlRecordRevision,
} from "./types.js";

export type DeliveryMutableOperation = Exclude<DeliveryOperation, "delivery.recover">;
export type ProviderEffectOutcome = "completed" | "failed" | "not-started";
export type TransactionEffectOutcome = "applied" | "not-applied" | "indeterminate";
export type DeliveryActivityOutcome = "completed" | "failed" | "abandoned";

export type AgentPreIntentRefusalFacts = Readonly<{
  diagnosticCode: string;
  refusalFactsDigest: Sha256;
}>;
export type ControlActivityReadView = Pick<ControlRecordStore, "identity" | "state" | "getRevision" | "listEvents">;

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.control-activity.${code}`, message);
}

function digest(value: Sha256, label: string): Sha256 {
  if (!SHA256_PATTERN.test(value)) fail("digest", `${label} must be one lowercase SHA-256 digest`);
  return value;
}

function activity(
  store: Pick<ControlActivityReadView, "state">,
  activityId: string,
): ReducedDeliveryState["activities"][number] {
  const id = controlIdentifier(activityId, "Delivery activity identity");
  const value = store.state().activities.find((candidate) => candidate.id === id);
  if (value === undefined || value.stage === "completed") {
    fail("activity", "Control event requires one exact incomplete Delivery activity");
  }
  return value;
}

function allEvents(store: Pick<ControlActivityReadView, "listEvents">): readonly ControlRecordEvent[] {
  const events: ControlRecordEvent[] = [];
  let cursor = 0;
  for (;;) {
    const page = store.listEvents(cursor, 10_000);
    events.push(...page);
    if (page.length < 10_000) return Object.freeze(events);
    cursor = page.at(-1)!.sequence;
    if (events.length > 100_000) fail("journal", "Activity event lookup exceeds the Journal bound");
  }
}

function exactActivitySubject(
  store: ControlRecordStore,
  activityId: string,
  eventKind: "agent-attempt-prepared" | "director-decision-authenticated",
  recordKind: "agent-attempt" | "director-decision",
): ControlRecordRevision {
  const matches = allEvents(store).filter((event) =>
    event.eventKind === eventKind && event.payload.activityId === activityId);
  if (matches.length !== 1 || matches[0]!.subject === null) {
    fail("subject", `Activity does not have one exact ${eventKind} subject`);
  }
  const selected = matches[0]!.subject!;
  const revision = store.getRevision(selected.recordId, selected.revision);
  if (
    revision === null ||
    revision.recordKind !== recordKind ||
    revision.digest !== selected.digest
  ) {
    fail("subject", `${eventKind} does not resolve to one exact retained ${recordKind}`);
  }
  return revision;
}

function subject(revision: ControlRecordRevision): Readonly<{
  recordId: string;
  revision: number;
  digest: Sha256;
}> {
  return Object.freeze({
    recordId: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function transactionDecisionKind(
  revision: ControlRecordRevision,
): FoundationTransactionDecisionKindV7 {
  const selected = revision.payload.decision;
  if (
    selected !== "admit" && selected !== "readmit" &&
    selected !== "accept" && selected !== "no-ship"
  ) {
    fail("transaction-decision", "Transaction activity Decision has an unsupported kind");
  }
  return selected;
}

function eventIdentity(
  store: Pick<ControlActivityReadView, "identity">,
  eventKind: string,
  activityId: string,
  discriminator: ControlJsonObject = Object.freeze({}),
): string {
  const suffix = digestCanonical({
    eventKind,
    storeId: store.identity.storeId,
    processId: store.identity.processId,
    activityId,
    discriminator,
  }).slice("sha256:".length);
  return `event-${eventKind}-${suffix}`;
}

function compileAppend(input: Readonly<{
  store: Pick<ControlActivityReadView, "identity">;
  eventKind: string;
  activityId: string;
  occurredAt: string;
  runtimeId: string;
  payload: ControlJsonObject;
  revision?: ControlRecordRevision | null;
  discriminator?: ControlJsonObject;
}>): ControlRecordStoreAppend {
  const activityId = controlIdentifier(input.activityId, "Delivery activity identity");
  const occurredAt = controlTimestamp(input.occurredAt, `${input.eventKind} time`);
  const runtimeId = controlIdentifier(input.runtimeId, "Delivery runtime identity");
  return Object.freeze({
    event: {
      eventId: eventIdentity(
        input.store,
        input.eventKind,
        activityId,
        input.discriminator,
      ),
      eventKind: input.eventKind,
      occurredAt,
      actor: { kind: "runtime", id: runtimeId },
      subject: input.revision === undefined || input.revision === null
        ? null
        : subject(input.revision),
      payload: input.payload,
    },
  });
}

function append(input: Parameters<typeof compileAppend>[0] & Readonly<{ store: ControlRecordStore }>): ControlRecordEvent {
  return input.store.append(compileAppend(input)).event;
}

/** Create the sole irreducibly fresh identity before one funded activity. */
export function createDeliveryActivityId(operation: DeliveryMutableOperation): string {
  const segment = operation.slice("delivery.".length);
  return `activity-${segment}-${randomUUID()}`;
}

/**
 * Compile, but do not retain, one eligible activity opening. The Director Brief
 * owner uses this to place an agent Brief and its activity opening in one
 * SQLite transaction; transaction activities retain this append directly.
 */
export function compileDeliveryActivityStartAppend(input: Readonly<{
  store: Pick<ControlRecordStore, "identity" | "state">;
  activityId: string;
  operation: DeliveryMutableOperation;
  startedAt: string;
  runtimeId: string;
  reservation?: WorkDelegationReservation;
}>): ControlRecordStoreAppend {
  const activityId = controlIdentifier(input.activityId, "Delivery activity identity");
  const startedAt = controlTimestamp(input.startedAt, "activity-started time");
  const runtimeId = controlIdentifier(input.runtimeId, "Delivery runtime identity");
  if (!input.store.state().eligibleOperations.includes(input.operation)) {
    fail("eligibility", `${input.operation} is not eligible at the exact Journal head`);
  }
  const reservation = input.reservation === undefined ? null : parseWorkDelegationReservation(input.reservation);
  if (reservation !== null && (reservation.activityId !== activityId || reservation.operation !== input.operation)) {
    fail("reservation", "The opening must bind its exact reserved Activity and operation");
  }
  return Object.freeze({
    event: Object.freeze({
      eventId: eventIdentity(input.store, "activity-started", activityId),
      eventKind: "activity-started",
      occurredAt: startedAt,
      actor: Object.freeze({ kind: "runtime" as const, id: runtimeId }),
      subject: null,
      payload: reservation === null ? Object.freeze({ activityId, operation: input.operation })
        : Object.freeze({ activityId, operation: input.operation, reservation }),
    }),
  });
}

/** Append one eligible transaction activity opening; agent opening is Brief-atomic. */
export function startDeliveryActivity(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  operation: DeliveryMutableOperation;
  startedAt: string;
  runtimeId: string;
}>): ControlRecordEvent {
  if (
    input.operation === "delivery.prepare" || input.operation === "delivery.continue" ||
    input.operation === "delivery.evaluate" || input.operation === "delivery.revise" ||
    input.operation === "delivery.reaffirm"
  ) {
    fail(
      "agent-opening",
      "Agent activities must retain their Director Brief and activity opening atomically",
    );
  }
  return input.store.append(compileDeliveryActivityStartAppend(input)).event;
}

/** Retain the exact reducer-derived recovery coordinate, never caller prose. */
export function recordDeliveryActivityRecovery(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  recordedAt: string;
  runtimeId: string;
}>): ControlRecordEvent {
  const current = activity(input.store, input.activityId);
  const recovery = current.recovery;
  if (recovery === null) fail("recovery", "Delivery activity has no exact recovery obligation");
  const payload = Object.freeze({
    activityId: current.id,
    kind: recovery.kind,
    resumesAt: recovery.resumesAt,
    exactEffectDigest: recovery.exactEffectDigest,
  });
  const last = allEvents(input.store).at(-1) ?? null;
  if (
    last?.eventKind === "activity-recovery-recorded" &&
    digestCanonical(last.payload) === digestCanonical(payload)
  ) {
    return last;
  }
  return append({
    store: input.store,
    eventKind: "activity-recovery-recorded",
    activityId: current.id,
    occurredAt: input.recordedAt,
    runtimeId: input.runtimeId,
    payload,
    discriminator: Object.freeze({ journalHead: input.store.state().journal.headDigest }),
  });
}

export type IntendProviderEffectInput = Readonly<{
  store: ControlRecordStore;
  activityId: string;
  effectDigest: Sha256;
  intendedAt: string;
  runtimeId: string;
}>;

export function compileProviderEffectIntentAppend(
  input: IntendProviderEffectInput,
): ControlRecordStoreAppend {
  const current = activity(input.store, input.activityId);
  if (current.family !== "agent" || current.stage !== "prepared") {
    fail("provider-intent", "Provider intent requires one exact prepared Agent Attempt");
  }
  const effectDigest = digest(input.effectDigest, "Provider effect digest");
  const attempt = exactActivitySubject(
    input.store,
    current.id,
    "agent-attempt-prepared",
    "agent-attempt",
  );
  return compileAppend({
    store: input.store,
    eventKind: "provider-effect-intended",
    activityId: current.id,
    occurredAt: input.intendedAt,
    runtimeId: input.runtimeId,
    revision: attempt,
    payload: { activityId: current.id, effectDigest },
  });
}

/**
 * Compile provider intent beside, and immediately after, the still-unretained
 * Agent Attempt. The ordered Store batch is the only owner allowed to use this
 * form: reducer replay proves that the preceding item finalizes this exact
 * Attempt before accepting the intent.
 */
export function compileProviderEffectIntentBesideAttemptAppend(input: Readonly<
  IntendProviderEffectInput & { attempt: ControlRecordRevision }
>): ControlRecordStoreAppend {
  const current = activity(input.store, input.activityId);
  const preAttemptStage = current.operation === "delivery.evaluate" ? "finalizing" : "started";
  const preAttemptStep = current.operation === "delivery.evaluate"
    ? "evaluation-checks"
    : "agent-attempt-prepared";
  if (
    current.family !== "agent" || current.stage !== preAttemptStage ||
    current.recovery?.kind !== "finalization" ||
    current.recovery.resumesAt !== preAttemptStep ||
    input.attempt.recordKind !== "agent-attempt" ||
    input.attempt.payload.activityId !== current.id
  ) {
    fail("provider-intent", "Atomic provider intent requires the exact unretained Agent Attempt boundary");
  }
  const effectDigest = digest(input.effectDigest, "Provider effect digest");
  return compileAppend({
    store: input.store,
    eventKind: "provider-effect-intended",
    activityId: current.id,
    occurredAt: input.intendedAt,
    runtimeId: input.runtimeId,
    revision: input.attempt,
    payload: { activityId: current.id, effectDigest },
  });
}

/** Record a pre-intent refusal without manufacturing an Agent Attempt. */
export function compileAgentPreIntentRefusalAppend(input: Readonly<{
  store: ControlActivityReadView;
  activityId: string;
  refusedAt: string;
  runtimeId: string;
  diagnosticCode: string;
  refusalFactsDigest: Sha256;
  resolution?: "none" | "projection-condition-required";
}>): ControlRecordStoreAppend {
  const current = activity(input.store, input.activityId);
  const preAttemptStage = current.operation === "delivery.evaluate" ? "finalizing" : "started";
  const preAttemptStep = current.operation === "delivery.evaluate"
    ? "evaluation-checks"
    : "agent-attempt-prepared";
  if (
    current.family !== "agent" || current.stage !== preAttemptStage ||
    current.recovery?.kind !== "finalization" ||
    current.recovery.resumesAt !== preAttemptStep
  ) {
    fail("pre-intent-refusal", "Pre-intent refusal requires an opened Agent activity with no Attempt or effect intent");
  }
  const diagnosticCode = controlIdentifier(input.diagnosticCode, "Pre-intent refusal diagnostic code");
  const refusalFactsDigest = digest(input.refusalFactsDigest, "Pre-intent refusal facts digest");
  const resolution = input.resolution ?? "none";
  if (resolution !== "none" && (resolution !== "projection-condition-required" ||
      (current.operation !== "delivery.evaluate" && current.operation !== "delivery.continue") ||
      diagnosticCode !== "lifecycle.projection.mandatory-too-large")) {
    fail("pre-intent-refusal", "Projection resolution requires an exact measured builder or reviewer refusal");
  }
  return compileAppend({
    store: input.store,
    eventKind: "agent-pre-intent-refused",
    activityId: current.id,
    occurredAt: input.refusedAt,
    runtimeId: input.runtimeId,
    payload: Object.freeze({ activityId: current.id, diagnosticCode, refusalFactsDigest, resolution }),
    discriminator: Object.freeze({ diagnosticCode, refusalFactsDigest, resolution }),
  });
}

export function intendProviderEffect(input: IntendProviderEffectInput): ControlRecordEvent {
  return input.store.append(compileProviderEffectIntentAppend(input)).event;
}

export type ObserveProviderEffectInput = Readonly<{
  store: ControlRecordStore;
  activityId: string;
  effectDigest: Sha256;
  outcome: ProviderEffectOutcome;
  observedAt: string;
  runtimeId: string;
}>;

export function compileProviderEffectObservationAppend(
  input: ObserveProviderEffectInput,
): ControlRecordStoreAppend {
  const current = activity(input.store, input.activityId);
  const effectDigest = digest(input.effectDigest, "Provider effect digest");
  if (
    current.family !== "agent" ||
    current.recovery?.kind !== "provider" ||
    current.recovery.resumesAt !== "provider-effect-observed" ||
    current.recovery.exactEffectDigest !== effectDigest
  ) {
    fail("provider-observation", "Provider observation does not resume the exact intended effect");
  }
  const attempt = exactActivitySubject(
    input.store,
    current.id,
    "agent-attempt-prepared",
    "agent-attempt",
  );
  return compileAppend({
    store: input.store,
    eventKind: "provider-effect-observed",
    activityId: current.id,
    occurredAt: input.observedAt,
    runtimeId: input.runtimeId,
    revision: attempt,
    payload: { activityId: current.id, effectDigest, outcome: input.outcome },
  });
}

export function observeProviderEffect(input: ObserveProviderEffectInput): ControlRecordEvent {
  return input.store.append(compileProviderEffectObservationAppend(input)).event;
}

export function abandonAgentWorkProduct(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  abandonedAt: string;
  runtimeId: string;
}>): ControlRecordEvent {
  const current = activity(input.store, input.activityId);
  if (
    current.family !== "agent" ||
    current.recovery?.kind !== "finalization" ||
    current.recovery.resumesAt !== "work-product-observation"
  ) {
    fail("work-product", "Work Product abandonment requires the exact open authoring disposition");
  }
  const attempt = exactActivitySubject(
    input.store,
    current.id,
    "agent-attempt-prepared",
    "agent-attempt",
  );
  return append({
    store: input.store,
    eventKind: "agent-work-product-abandoned",
    activityId: current.id,
    occurredAt: input.abandonedAt,
    runtimeId: input.runtimeId,
    revision: attempt,
    payload: { activityId: current.id },
  });
}

export function compileTransactionEffectIntentAppend(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  effectDigest: Sha256;
  intendedAt: string;
  runtimeId: string;
}>): ControlRecordStoreAppend {
  const current = activity(input.store, input.activityId);
  if (current.family !== "transaction" || current.stage !== "started") {
    fail("transaction-intent", "Transaction intent requires one exact authenticated transaction activity");
  }
  const effectDigest = digest(input.effectDigest, "Transaction effect digest");
  const decision = exactActivitySubject(
    input.store,
    current.id,
    "director-decision-authenticated",
    "director-decision",
  );
  return compileAppend({
    store: input.store,
    eventKind: "transaction-effect-intended",
    activityId: current.id,
    occurredAt: input.intendedAt,
    runtimeId: input.runtimeId,
    revision: decision,
    payload: { activityId: current.id, effectDigest },
  });
}

export function intendTransactionEffect(
  input: Parameters<typeof compileTransactionEffectIntentAppend>[0],
): ControlRecordEvent {
  return input.store.append(compileTransactionEffectIntentAppend(input)).event;
}

export function compileTransactionEffectObservationAppend(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  effectDigest: Sha256;
  outcome: TransactionEffectOutcome;
  facts: FoundationTransactionObservationFactsV7;
  observedAt: string;
  runtimeId: string;
}>): ControlRecordStoreAppend {
  const current = activity(input.store, input.activityId);
  const effectDigest = digest(input.effectDigest, "Transaction effect digest");
  if (
    current.family !== "transaction" ||
    current.recovery?.kind !== "transaction" ||
    current.recovery.resumesAt !== "transaction-effect-observed" ||
    current.recovery.exactEffectDigest !== effectDigest
  ) {
    fail("transaction-observation", "Transaction observation does not resume the exact intended effect");
  }
  const facts = parseFoundationTransactionObservationFactsV7(input.facts);
  const factsDigest = digestCanonical(facts);
  const decision = exactActivitySubject(
    input.store,
    current.id,
    "director-decision-authenticated",
    "director-decision",
  );
  assertFoundationTransactionObservationFactsV7({
    operation: current.operation,
    decisionKind: transactionDecisionKind(decision),
    outcome: input.outcome,
    facts,
    factsDigest,
  });
  return compileAppend({
    store: input.store,
    eventKind: "transaction-effect-observed",
    activityId: current.id,
    occurredAt: input.observedAt,
    runtimeId: input.runtimeId,
    revision: decision,
    payload: {
      activityId: current.id,
      effectDigest,
      outcome: input.outcome,
      facts,
      factsDigest,
    },
    discriminator: Object.freeze({
      journalHead: input.store.state().journal.headDigest,
      factsDigest,
    }),
  });
}

export function observeTransactionEffect(
  input: Parameters<typeof compileTransactionEffectObservationAppend>[0],
): ControlRecordEvent {
  return input.store.append(compileTransactionEffectObservationAppend(input)).event;
}

export type CompleteDeliveryActivityInput = Readonly<{
  store: ControlRecordStore;
  activityId: string;
  outcome: DeliveryActivityOutcome;
  completedAt: string;
  runtimeId: string;
}>;

export function compileDeliveryActivityCompletionAppend(
  input: Omit<CompleteDeliveryActivityInput, "store"> & Readonly<{ store: ControlActivityReadView }>,
): ControlRecordStoreAppend {
  const current = activity(input.store, input.activityId);
  const recovery: DeliveryRecoveryObligation | null = current.recovery;
  const deterministicBoundaryRefusal = input.outcome !== "completed" &&
    current.family === "agent" &&
    (
      current.operation === "delivery.prepare" ||
      current.operation === "delivery.revise" ||
      current.operation === "delivery.reaffirm"
    ) &&
    recovery?.kind === "finalization" &&
    recovery.resumesAt === "work-boundary-finalized";
  let directContinueFinalization = false;
  if (
    current.family === "agent" && current.operation === "delivery.continue" &&
    recovery?.kind === "finalization" && recovery.resumesAt === "activity-finalization"
  ) {
    const submissions = allEvents(input.store).filter((event) =>
      event.eventKind === "agent-work-product-submitted" &&
      event.payload.activityId === current.id);
    if (submissions.length !== 1 || submissions[0]!.subject === null) {
      fail("completion", "Continue completion requires one exact Agent Work Product event");
    }
    const subject = submissions[0]!.subject!;
    const retained = input.store.getRevision(subject.recordId, subject.revision);
    if (
      retained === null || retained.recordKind !== "agent-work-product" ||
      retained.digest !== subject.digest
    ) fail("completion", "Continue completion cannot resolve its exact Agent Work Product");
    const semantics = retained.payload.roleSemantics;
    if (semantics === null || Array.isArray(semantics) || typeof semantics !== "object") {
      fail("completion", "Continue completion requires exact builder role semantics");
    }
    const selected = semantics as ControlJsonObject;
    directContinueFinalization =
      selected.role === "builder" && selected.proposal !== "material-condition";
  }
  if (!deterministicBoundaryRefusal && !directContinueFinalization && (
    recovery?.kind !== "finalization" ||
    recovery.resumesAt !== "activity-completed"
  )) {
    fail("completion", "Activity completion requires its exact reducer-derived finalization coordinate");
  }
  return compileAppend({
    store: input.store,
    eventKind: "activity-completed",
    activityId: current.id,
    occurredAt: input.completedAt,
    runtimeId: input.runtimeId,
    payload: { activityId: current.id, outcome: input.outcome },
  });
}

export function completeDeliveryActivity(input: CompleteDeliveryActivityInput): ControlRecordEvent {
  return input.store.append(compileDeliveryActivityCompletionAppend(input)).event;
}
