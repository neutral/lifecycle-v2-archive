import { isDeepStrictEqual } from "node:util";

import { compileControlRecordEvent } from "../../../src/foundation/control/model.js";
import {
  CONTROL_RECORD_REVISION_SCHEMA,
  type ControlJsonObject,
  type ControlRecordEvent,
  type ControlRecordEventSubject,
  type ControlRecordRelationship,
  type ControlRecordRevision,
} from "../../../src/foundation/control/types.js";
import {
  assertDeliveryReplaySealable,
  createDeliveryReplay,
  reduceDeliveryEvents,
  type IncrementalDeliveryReplay,
  type ReducedDeliveryState,
} from "../../../src/foundation/process/delivery-reducer.js";
import {
  digestCanonical,
  sha256Bytes,
  type Sha256,
} from "../../../src/foundation/validation/canonical.js";

const DEFAULT_STORE_ID = "store-bounded-exploration";
const DEFAULT_PROCESS_ID = "delivery-bounded-exploration";
const DEFAULT_OCCURRED_AT = "2026-09-02T08:00:00Z";

export function subject(id: string, revision = 1): ControlRecordEventSubject {
  return Object.freeze({
    recordId: id,
    revision,
    digest: sha256Bytes(`${id}-${revision}`),
  });
}

export function effect(id: string): Sha256 {
  return sha256Bytes(`effect-${id}`);
}

export function relationship(
  relation: string,
  kind: string,
  selected: ControlRecordEventSubject,
): ControlRecordRelationship {
  return Object.freeze({
    relation,
    target: Object.freeze({
      kind,
      id: selected.recordId,
      revision: selected.revision,
      digest: selected.digest,
    }),
  });
}

export type RevisionFacts = Readonly<{
  recordKind?: string;
  payload?: ControlJsonObject;
  relationships?: readonly ControlRecordRelationship[];
}>;

export function attemptFacts(
  brief: ControlRecordEventSubject,
  boundary: ControlRecordEventSubject | null = null,
  candidate: ControlRecordEventSubject | null = null,
  seal: ControlRecordEventSubject | null = null,
): RevisionFacts {
  return Object.freeze({
    recordKind: "agent-attempt",
    relationships: Object.freeze([
      relationship("uses-brief", "founder-brief", brief),
      ...(boundary === null ? [] : [relationship("uses-boundary", "work-boundary", boundary)]),
      ...(candidate === null
        ? []
        : [relationship("uses-candidate", "candidate-revision", candidate)]),
      ...(seal === null ? [] : [relationship("uses-seal", "candidate-seal", seal)]),
    ]),
  });
}

export function boundaryFacts(
  brief: ControlRecordEventSubject,
  workProduct: ControlRecordEventSubject,
  prior: ControlRecordEventSubject | null = null,
  condition: ControlRecordEventSubject | null = null,
  checks: readonly Readonly<{
    id: string;
    baselineRequired: boolean;
    finalRequired: boolean;
  }>[] = Object.freeze([
    Object.freeze({ id: "selection.default", baselineRequired: true, finalRequired: true }),
  ]),
): RevisionFacts {
  return Object.freeze({
    recordKind: "work-boundary",
    payload: Object.freeze({
      schema: "lifecycle.work-boundary-payload.v4",
      mandate: Object.freeze({
        checks: Object.freeze(checks.map((check) => Object.freeze({ ...check }))),
      }),
    }),
    relationships: Object.freeze([
      relationship("uses-brief", "founder-brief", brief),
      relationship("proposed-from", "agent-work-product", workProduct),
      ...(prior === null ? [] : [relationship("revises", "work-boundary", prior)]),
      ...(condition === null
        ? []
        : [relationship("resolves", "material-condition", condition)]),
    ]),
  });
}

export function checkFacts(
  phase: "baseline" | "final",
  modality:
    | "precondition"
    | "repair-target"
    | "regression-guard"
    | "postcondition"
    | "diagnostic",
  disposition:
    | "pass"
    | "fail"
    | "indeterminate"
    | "not-run"
    | "unsupported"
    | "operational-error",
  selectedRelationship: ControlRecordRelationship,
  selectionId = "selection.default",
): RevisionFacts {
  return Object.freeze({
    recordKind: "check-receipt",
    payload: Object.freeze({
      schema: "lifecycle.check-receipt-payload.v2",
      selectionId,
      phase,
      modality,
      disposition,
    }),
    relationships: Object.freeze([selectedRelationship]),
  });
}

export function candidateRevisionV2Payload(
  observation: "initialization" | "builder-successor" | "readmission-rebind",
): ControlJsonObject {
  return Object.freeze({
    schema: "lifecycle.candidate-revision-payload.v2",
    profileId: "lifecycle.candidate-revision.observation.v1",
    observation,
    candidateBaseCommit: "a".repeat(40),
    carrierManifest: Object.freeze({
      digest: sha256Bytes(`carrier:${observation}`),
      byteLength: 1024,
      mediaType: "application/vnd.lifecycle.candidate-revision-carrier-manifest+json",
      purpose: "candidate-revision-carrier-manifest",
    }),
    state: Object.freeze({
      tree: "b".repeat(40),
      candidateDigest: sha256Bytes(`candidate:${observation}`),
      productStateDigest: sha256Bytes(`product:${observation}`),
      knowledgeSetDigest: sha256Bytes(`knowledge:${observation}`),
      diffDigest: sha256Bytes(`diff:${observation}`),
      pathInventoryDigest: sha256Bytes(`paths:${observation}`),
      artifactSetDigest: sha256Bytes(`artifacts:${observation}`),
      descriptionCoverageDigest: sha256Bytes(`descriptions:${observation}`),
      unchangedFromPredecessor: true,
      changedSubjects: Object.freeze([]),
    }),
    observer: Object.freeze({
      implementationId: "candidate-observer-v1",
      implementationDigest: sha256Bytes("candidate-observer"),
    }),
    limitations: Object.freeze([]),
  });
}

export function closurePayload(
  disposition: "accepted" | "no-ship",
  candidateTreatment: "integrated" | "abandoned" | "not-created",
  containment: "complete" | "incomplete" = "complete",
): ControlJsonObject {
  return Object.freeze({
    schema: "lifecycle.closure-payload.v4",
    disposition,
    candidateTreatment,
    terminalExecutions: Object.freeze({
      containment: Object.freeze({ classification: containment }),
      retirement: Object.freeze({ classification: "complete" }),
    }),
  });
}

function revisionKey(selected: ControlRecordEventSubject): string {
  return `${selected.recordId}\u0000${selected.revision}\u0000${selected.digest}`;
}

function transactionObservationFacts(
  events: readonly ControlRecordEvent[],
  payload: ControlJsonObject,
  sequence: number,
): ControlJsonObject {
  const activityId = payload.activityId;
  const opening = events.find((event) =>
    event.eventKind === "activity-started" && event.payload.activityId === activityId);
  const outcome = payload.outcome as "applied" | "not-applied" | "indeterminate";

  if (opening?.payload.operation === "delivery.admit") {
    return Object.freeze({
      schema: "lifecycle.admission-effect-observation-facts.v2",
      outcome,
      disposition: outcome === "not-applied"
        ? Object.freeze({
            outcome: "not-applied",
            reason: "repository-basis-mismatch",
            observedFactsDigest: sha256Bytes(`admission-repository-basis-${sequence}`),
          })
        : null,
      repositoryBasisDigest: outcome === "indeterminate"
        ? null
        : sha256Bytes(`admission-repository-basis-${sequence}`),
    });
  }

  if (opening?.payload.operation === "delivery.accept" && outcome === "applied") {
    return Object.freeze({
      schema: "lifecycle.terminal-acceptance-effect-observation.v1",
      ref: "refs/heads/main",
      commit: "a".repeat(40),
      tree: "b".repeat(40),
      objectFormat: "sha1",
      canonicalResultDigest: sha256Bytes(`terminal-canonical-result-${sequence}`),
    });
  }

  return Object.freeze({
    schema: "lifecycle.terminal-repository-effect-observation.v1",
    ref: "refs/heads/main",
    commit: "a".repeat(40),
    tree: "b".repeat(40),
    objectFormat: "sha1",
  });
}

export type EventChainOptions = Readonly<{
  storeId?: string;
  processId?: string;
  occurredAt?: string;
}>;

/** Mutable only inside a fork; every explorer transition receives a fresh fork. */
export class EventChain {
  readonly storeId: string;

  readonly processId: string;

  readonly occurredAt: string;

  readonly events: ControlRecordEvent[] = [];

  readonly revisions = new Map<string, ControlRecordRevision>();

  readonly resolveRevision = (
    selected: ControlRecordEventSubject,
  ): ControlRecordRevision | null => this.revisions.get(revisionKey(selected)) ?? null;

  constructor(options: EventChainOptions = {}) {
    this.storeId = options.storeId ?? DEFAULT_STORE_ID;
    this.processId = options.processId ?? DEFAULT_PROCESS_ID;
    this.occurredAt = options.occurredAt ?? DEFAULT_OCCURRED_AT;
  }

  fork(): EventChain {
    const branch = new EventChain({
      storeId: this.storeId,
      processId: this.processId,
      occurredAt: this.occurredAt,
    });
    branch.events.push(...this.events);
    for (const [key, revision] of this.revisions) branch.revisions.set(key, revision);
    return branch;
  }

  append(
    eventKind: string,
    payload: ControlJsonObject,
    selectedSubject: ControlRecordEventSubject | null = null,
    facts: RevisionFacts = {},
  ): ControlRecordEvent {
    const previous = this.events.at(-1) ?? null;
    const sequence = this.events.length + 1;
    let retainedPayload = payload;

    if (eventKind === "transaction-effect-observed") {
      const observedFacts = payload.facts ??
        transactionObservationFacts(this.events, payload, sequence);
      if (observedFacts === null || typeof observedFacts !== "object" ||
          Array.isArray(observedFacts)) {
        throw new TypeError("Transaction observation facts must be an object");
      }
      retainedPayload = Object.freeze({
        ...payload,
        facts: observedFacts,
        factsDigest: payload.factsDigest ?? digestCanonical(observedFacts),
      });
    }

    const event = compileControlRecordEvent({
      storeId: this.storeId,
      processId: this.processId,
      sequence,
      predecessorDigest: previous?.digest ?? null,
      event: {
        eventId: `event-${sequence}`,
        eventKind,
        occurredAt: this.occurredAt,
        actor: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
        subject: selectedSubject,
        payload: retainedPayload,
      },
    });
    this.events.push(event);

    if (selectedSubject !== null) {
      const key = revisionKey(selectedSubject);
      if (!this.revisions.has(key)) {
        // The fixture supplies recordKind explicitly. It does not infer it from
        // the product event registry, which is part of the explored system.
        const recordKind = facts.recordKind;
        if (typeof recordKind !== "string" || recordKind.length === 0) {
          throw new TypeError(
            `${eventKind} must supply facts.recordKind when it finalizes a new revision`,
          );
        }
        this.revisions.set(key, Object.freeze({
          schema: CONTROL_RECORD_REVISION_SCHEMA,
          processId: this.processId,
          recordId: selectedSubject.recordId,
          recordKind,
          revision: selectedSubject.revision,
          producer: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
          semanticAuthor: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
          semanticAuthority: "runtime-derived",
          createdAt: this.occurredAt,
          semanticMarkdown: "Synthetic bounded-exploration fixture.\n",
          payload: Object.freeze(facts.payload ?? {}),
          relationships: Object.freeze(facts.relationships ?? []),
          digest: selectedSubject.digest,
        }));
      }
    }

    return event;
  }
}

export type PreparedDelivery = Readonly<{
  activityId: string;
  brief: ControlRecordEventSubject;
  attempt: ControlRecordEventSubject;
  providerEffect: Sha256;
  workProduct: ControlRecordEventSubject;
  receipt: ControlRecordEventSubject;
  boundary: ControlRecordEventSubject;
  baselineReceipt: ControlRecordEventSubject;
}>;

export function prepareSuccessful(
  chain: EventChain,
  options: Readonly<{
    suffix?: string;
    activityId?: string;
    brief?: ControlRecordEventSubject;
    attempt?: ControlRecordEventSubject;
    workProduct?: ControlRecordEventSubject;
    receipt?: ControlRecordEventSubject;
    boundary?: ControlRecordEventSubject;
    baselineReceipt?: ControlRecordEventSubject;
    providerEffect?: Sha256;
  }> = {},
): PreparedDelivery {
  const suffix = options.suffix ?? "successful";
  const activityId = options.activityId ?? `prepare-${suffix}`;
  const brief = options.brief ?? subject(`brief-${suffix}`);
  const attempt = options.attempt ?? subject(`attempt-${suffix}`);
  const workProduct = options.workProduct ?? subject(`work-product-${suffix}`);
  const receipt = options.receipt ?? subject(`receipt-${suffix}`);
  const boundary = options.boundary ?? subject(`boundary-${suffix}`);
  const baselineReceipt = options.baselineReceipt ?? subject(`baseline-check-${suffix}`);
  const providerEffect = options.providerEffect ?? effect(`provider-${suffix}`);

  chain.append("founder-brief-submitted", { activityId }, brief, {
    recordKind: "founder-brief",
  });
  chain.append("activity-started", { activityId, operation: "delivery.prepare" });
  chain.append("agent-attempt-prepared", { activityId }, attempt, attemptFacts(brief));
  chain.append(
    "provider-effect-intended",
    { activityId, effectDigest: providerEffect },
    attempt,
  );
  chain.append(
    "provider-effect-observed",
    { activityId, effectDigest: providerEffect, outcome: "completed" },
    attempt,
  );
  chain.append("agent-work-product-submitted", { activityId }, workProduct, {
    recordKind: "agent-work-product",
  });
  chain.append("execution-receipt-recorded", { activityId }, receipt, {
    recordKind: "execution-receipt",
  });
  chain.append(
    "work-boundary-finalized",
    { activityId },
    boundary,
    boundaryFacts(brief, workProduct),
  );
  chain.append(
    "check-receipt-recorded",
    { activityId },
    baselineReceipt,
    checkFacts(
      "baseline",
      "regression-guard",
      "pass",
      relationship("checks-boundary", "work-boundary", boundary),
    ),
  );
  chain.append("activity-completed", { activityId, outcome: "completed" });

  return Object.freeze({
    activityId,
    brief,
    attempt,
    providerEffect,
    workProduct,
    receipt,
    boundary,
    baselineReceipt,
  });
}

export type AdmittedDelivery = Readonly<{
  activityId: string;
  decision: ControlRecordEventSubject;
  transactionEffect: Sha256;
  candidate: ControlRecordEventSubject;
  boundary: ControlRecordEventSubject;
  baselineReceipt: ControlRecordEventSubject;
}>;

export function admitSuccessful(
  chain: EventChain,
  prepared: PreparedDelivery,
  options: Readonly<{
    suffix?: string;
    activityId?: string;
    decision?: ControlRecordEventSubject;
    transactionEffect?: Sha256;
    candidate?: ControlRecordEventSubject;
  }> = {},
): AdmittedDelivery {
  const suffix = options.suffix ?? "successful";
  const activityId = options.activityId ?? `admit-${suffix}`;
  const decision = options.decision ?? subject(`decision-admit-${suffix}`);
  const transactionEffect = options.transactionEffect ?? effect(`admit-${suffix}`);
  const candidate = options.candidate ?? subject(`candidate-${suffix}`);

  chain.append("activity-started", { activityId, operation: "delivery.admit" });
  chain.append(
    "founder-decision-authenticated",
    { activityId },
    decision,
    {
      recordKind: "founder-decision",
      payload: Object.freeze({ decision: "admit" }),
      relationships: Object.freeze([
        relationship("selects-boundary", "work-boundary", prepared.boundary),
        relationship("selects-baseline-receipt", "check-receipt", prepared.baselineReceipt),
      ]),
    },
  );
  chain.append(
    "transaction-effect-intended",
    { activityId, effectDigest: transactionEffect },
    decision,
  );
  chain.append(
    "transaction-effect-observed",
    { activityId, effectDigest: transactionEffect, outcome: "applied" },
    decision,
  );
  chain.append(
    "candidate-revision-observed",
    { activityId },
    candidate,
    {
      recordKind: "candidate-revision",
      payload: candidateRevisionV2Payload("initialization"),
      relationships: Object.freeze([
        relationship("governed-by", "work-boundary", prepared.boundary),
      ]),
    },
  );
  chain.append("activity-completed", { activityId, outcome: "completed" });

  return Object.freeze({
    activityId,
    decision,
    transactionEffect,
    candidate,
    boundary: prepared.boundary,
    baselineReceipt: prepared.baselineReceipt,
  });
}

class DeliveryReducerFixtureError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "DeliveryReducerFixtureError";
  }
}

function fixtureFailure(message: string, cause?: unknown): never {
  throw new DeliveryReducerFixtureError(message, cause);
}

type ReplayAccepted = Readonly<{
  kind: "accepted";
  processedEvents: number;
  state: ReducedDeliveryState;
  terminalState: ReducedDeliveryState | null;
}>;

type ReplayRefused = Readonly<{
  kind: "refused";
  processedEvents: number | null;
  error: unknown;
  state: ReducedDeliveryState | null;
  terminalState: ReducedDeliveryState | null;
}>;

type ReplayOutcome = ReplayAccepted | ReplayRefused;

function sameReducerState(
  left: ReducedDeliveryState,
  right: ReducedDeliveryState,
): boolean {
  return isDeepStrictEqual(left, right);
}

function expectedHeadDigest(
  events: readonly ControlRecordEvent[],
  processedEvents: number,
): Sha256 | null {
  return processedEvents === 0 ? null : events[processedEvents - 1]!.digest;
}

function assertExactJournal(
  mode: string,
  state: ReducedDeliveryState,
  events: readonly ControlRecordEvent[],
  processedEvents: number,
): void {
  const expectedHead = expectedHeadDigest(events, processedEvents);
  if (
    state.journal.eventCount !== processedEvents ||
    state.journal.headDigest !== expectedHead
  ) {
    fixtureFailure(
      `${mode} returned Journal ${state.journal.eventCount}/${state.journal.headDigest ?? "null"}; ` +
        `expected ${processedEvents}/${expectedHead ?? "null"}`,
    );
  }
}

function assertSameReducerState(
  label: string,
  left: ReducedDeliveryState,
  right: ReducedDeliveryState,
): void {
  if (!sameReducerState(left, right)) {
    fixtureFailure(`${label} produced different reduced Delivery states`);
  }
}

function assertIncrementalSealable(
  mode: string,
  replay: IncrementalDeliveryReplay,
  state: ReducedDeliveryState,
): ReducedDeliveryState {
  let sealed: ReducedDeliveryState;
  try {
    sealed = replay.assertSealable();
  } catch (error) {
    fixtureFailure(`${mode} accepted terminal Closure but rejected sealability`, error);
  }
  assertSameReducerState(`${mode} sealability`, state, sealed);
  return sealed;
}

function continueIncrementalReplay(
  mode: string,
  replay: IncrementalDeliveryReplay,
  events: readonly ControlRecordEvent[],
  start: number,
  startingState: ReducedDeliveryState,
  startingTerminalState: ReducedDeliveryState | null,
): ReplayOutcome {
  let state = startingState;
  let terminalState = startingTerminalState;
  let processedEvents = start;

  for (let index = start; index < events.length; index += 1) {
    const event = events[index]!;
    try {
      replay.append(event);
      processedEvents = index + 1;
      state = replay.finish();
    } catch (error) {
      if (error instanceof DeliveryReducerFixtureError) throw error;
      return Object.freeze({
        kind: "refused",
        processedEvents,
        error,
        state,
        terminalState,
      });
    }
    assertExactJournal(mode, state, events, processedEvents);
    if (state.subjects.closure !== null) {
      terminalState = assertIncrementalSealable(mode, replay, state);
    }
  }

  return Object.freeze({
    kind: "accepted",
    processedEvents,
    state,
    terminalState,
  });
}

function incrementalOutcome(
  mode: string,
  events: readonly ControlRecordEvent[],
  resolveRevision: EventChain["resolveRevision"],
): ReplayOutcome {
  const replay = createDeliveryReplay(resolveRevision);
  const initialState = replay.finish();
  assertExactJournal(mode, initialState, events, 0);
  return continueIncrementalReplay(mode, replay, events, 0, initialState, null);
}

function forkPrefixLength(eventCount: number, processedEvents: number): number {
  const comparablePrefix = Math.min(eventCount, processedEvents);
  return comparablePrefix <= 1 ? 0 : Math.floor(comparablePrefix / 2);
}

function forkedOutcome(
  events: readonly ControlRecordEvent[],
  resolveRevision: EventChain["resolveRevision"],
  prefixLength: number,
): ReplayOutcome {
  const parent = createDeliveryReplay(resolveRevision);
  const initialState = parent.finish();
  assertExactJournal("fork parent", initialState, events, 0);
  const prefix = continueIncrementalReplay(
    "fork parent",
    parent,
    events.slice(0, prefixLength),
    0,
    initialState,
    null,
  );
  if (prefix.kind === "refused") return prefix;

  const retainedParentState = prefix.state;
  const retainedParentTerminalState = prefix.terminalState;
  const branch = parent.fork();
  const outcome = continueIncrementalReplay(
    "fork branch",
    branch,
    events,
    prefixLength,
    retainedParentState,
    retainedParentTerminalState,
  );
  const parentAfterBranch = parent.finish();
  assertExactJournal("fork parent after branch", parentAfterBranch, events, prefixLength);
  assertSameReducerState(
    "Forked intermediate-prefix parent isolation",
    retainedParentState,
    parentAfterBranch,
  );
  return outcome;
}

function batchOutcome(chain: EventChain): ReplayOutcome {
  try {
    const state = reduceDeliveryEvents(chain.events, chain.resolveRevision);
    assertExactJournal("batch replay", state, chain.events, chain.events.length);
    let terminalState: ReducedDeliveryState | null = null;
    if (state.subjects.closure !== null) {
      try {
        terminalState = assertDeliveryReplaySealable(chain.events, chain.resolveRevision);
      } catch (error) {
        fixtureFailure("Batch replay accepted terminal Closure but rejected sealability", error);
      }
      assertSameReducerState("Batch replay sealability", state, terminalState);
    }
    return Object.freeze({
      kind: "accepted",
      processedEvents: chain.events.length,
      state,
      terminalState,
    });
  } catch (error) {
    if (error instanceof DeliveryReducerFixtureError) throw error;
    return Object.freeze({
      kind: "refused",
      processedEvents: null,
      error,
      state: null,
      terminalState: null,
    });
  }
}

function codedFailure(error: unknown): Readonly<{
  code: string;
  name: string;
  message: string;
}> | null {
  if (
    error === null || typeof error !== "object" ||
    typeof (error as { code?: unknown }).code !== "string" ||
    (error as { code: string }).code.length === 0
  ) {
    return null;
  }
  return Object.freeze({
    code: (error as { code: string }).code,
    name: error instanceof Error ? error.name : "",
    message: error instanceof Error ? error.message : String(error),
  });
}

function assertRefusalAgreement(
  batch: ReplayRefused,
  incremental: ReplayRefused,
  forked: ReplayRefused,
): void {
  const batchFailure = codedFailure(batch.error);
  const incrementalFailure = codedFailure(incremental.error);
  const forkedFailure = codedFailure(forked.error);
  if (
    batchFailure === null || incrementalFailure === null || forkedFailure === null ||
    !isDeepStrictEqual(batchFailure, incrementalFailure) ||
    !isDeepStrictEqual(batchFailure, forkedFailure)
  ) {
    fixtureFailure(
      "Batch, incremental, and forked-prefix reducer refusals did not agree on one coded failure",
      batch.error,
    );
  }
  if (incremental.processedEvents !== forked.processedEvents) {
    fixtureFailure(
      "Incremental and forked-prefix reducer refusals occurred after different Journal prefixes",
    );
  }
}

function assertRefusalPrefixAgreement(
  chain: EventChain,
  incremental: ReplayRefused,
  forked: ReplayRefused,
): void {
  if (
    incremental.processedEvents === null ||
    incremental.state === null ||
    forked.state === null
  ) {
    fixtureFailure("Agreed reducer refusals did not retain their last valid Journal prefix");
  }
  const prefixEvents = chain.events.slice(0, incremental.processedEvents);
  let batchPrefix: ReducedDeliveryState;
  try {
    batchPrefix = reduceDeliveryEvents(prefixEvents, chain.resolveRevision);
  } catch (error) {
    fixtureFailure("Batch replay rejected the prefix accepted by both incremental modes", error);
  }
  assertExactJournal(
    "batch refusal prefix",
    batchPrefix,
    prefixEvents,
    prefixEvents.length,
  );
  assertSameReducerState(
    "Batch and incremental refusal prefix",
    batchPrefix,
    incremental.state,
  );
  assertSameReducerState(
    "Batch and forked-prefix refusal state",
    batchPrefix,
    forked.state,
  );
}

function assertTerminalSealabilityAgreement(
  chain: EventChain,
  batch: ReplayOutcome,
  incremental: ReplayOutcome,
  forked: ReplayOutcome,
): void {
  if (
    (incremental.terminalState === null) !== (forked.terminalState === null)
  ) {
    fixtureFailure("Incremental and forked-prefix replays disagreed on terminal Closure");
  }
  const terminalState = incremental.terminalState;
  if (terminalState === null || forked.terminalState === null) return;
  assertSameReducerState(
    "Incremental and forked-prefix terminal Closure",
    terminalState,
    forked.terminalState,
  );

  const closureIndex = chain.events.findIndex((event) =>
    event.eventKind === "closure-recorded" &&
    event.subject?.digest === terminalState.subjects.closure?.digest);
  if (closureIndex < 0) {
    fixtureFailure("A terminal reducer state has no exact Closure Journal event");
  }
  const terminalEvents = chain.events.slice(0, closureIndex + 1);
  let batchSealed: ReducedDeliveryState;
  if (batch.kind === "accepted") {
    if (batch.terminalState === null) {
      fixtureFailure("Batch replay did not retain accepted terminal Closure sealability");
    }
    batchSealed = batch.terminalState;
  } else {
    try {
      batchSealed = assertDeliveryReplaySealable(terminalEvents, chain.resolveRevision);
    } catch (error) {
      fixtureFailure("Batch replay disagreed with terminal Closure sealability", error);
    }
  }
  assertExactJournal("batch sealability", batchSealed, terminalEvents, terminalEvents.length);
  assertSameReducerState("Batch and incremental terminal Closure", batchSealed, terminalState);
  if (batch.kind === "accepted") {
    assertSameReducerState("Batch reduction and sealability", batch.state, batchSealed);
  }
}

export function reduceChain(chain: EventChain): ReducedDeliveryState {
  const batch = batchOutcome(chain);
  const incremental = incrementalOutcome(
    "incremental replay",
    chain.events,
    chain.resolveRevision,
  );
  const forked = forkedOutcome(
    chain.events,
    chain.resolveRevision,
    forkPrefixLength(
      chain.events.length,
      incremental.processedEvents ?? 0,
    ),
  );

  if (batch.kind !== incremental.kind || batch.kind !== forked.kind) {
    fixtureFailure("Batch, incremental, and forked-prefix reducer outcomes disagree");
  }

  assertTerminalSealabilityAgreement(chain, batch, incremental, forked);

  if (batch.kind === "refused") {
    if (incremental.kind !== "refused" || forked.kind !== "refused") {
      fixtureFailure("Reducer refusal comparison lost an agreed replay outcome");
    }
    assertRefusalAgreement(batch, incremental, forked);
    assertRefusalPrefixAgreement(chain, incremental, forked);
    throw batch.error;
  }

  if (incremental.kind !== "accepted" || forked.kind !== "accepted") {
    fixtureFailure("Reducer acceptance comparison lost an agreed replay outcome");
  }
  assertSameReducerState("Batch and incremental replay", batch.state, incremental.state);
  assertSameReducerState("Batch and forked-prefix replay", batch.state, forked.state);
  return batch.state;
}

function normalizeSubject(selected: ReducedDeliveryState["subjects"]["candidate"]): Readonly<{
  id: string;
  revision: number;
  digest: Sha256;
}> | null {
  return selected === null
    ? null
    : Object.freeze({ id: selected.id, revision: selected.revision, digest: selected.digest });
}

function normalizeRecovery(
  recovery: ReducedDeliveryState["activities"][number]["recovery"],
): Readonly<{
  kind: string;
  resumesAt: string;
  exactEffectDigest: Sha256 | null;
}> | null {
  return recovery === null
    ? null
    : Object.freeze({
        kind: recovery.kind,
        resumesAt: recovery.resumesAt,
        exactEffectDigest: recovery.exactEffectDigest,
      });
}

export function normalizeReducerState(state: ReducedDeliveryState) {
  return Object.freeze({
    standing: state.standing,
    candidateCondition: state.candidateCondition,
    activities: Object.freeze(state.activities.map((activity) => Object.freeze({
      id: activity.id,
      operation: activity.operation,
      family: activity.family,
      stage: activity.stage,
      recovery: normalizeRecovery(activity.recovery),
    }))),
    subjects: Object.freeze({
      proposedBoundary: normalizeSubject(state.subjects.proposedBoundary),
      activeBoundary: normalizeSubject(state.subjects.activeBoundary),
      candidate: normalizeSubject(state.subjects.candidate),
      materialCondition: normalizeSubject(state.subjects.materialCondition),
      seal: normalizeSubject(state.subjects.seal),
      evidence: normalizeSubject(state.subjects.evidence),
      closure: normalizeSubject(state.subjects.closure),
    }),
    eligibleOperations: Object.freeze([...state.eligibleOperations]),
  });
}

export type NormalizedReducerState = ReturnType<typeof normalizeReducerState>;
