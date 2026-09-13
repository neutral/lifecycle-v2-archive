import { foundationProjectionConditionObservedFactsDigestV1 } from "../control/projection-condition-facts.js";
import {
  addWorkDelegationAccounting,
  assessWorkDelegationAllowance,
  parseWorkDelegationPayload,
  parseWorkDelegationReservation,
  WORK_DELEGATION_OPERATIONS,
  type WorkDelegationAccounting,
  type WorkDelegationPayload,
  type WorkDelegationReservation,
} from "../control/work-delegation.js";
import { compileWorkDelegationStopRequest } from "../control/work-delegation-stop.js";
import { workDelegationAgentAttemptMatches } from "../control/work-delegation-execution.js";
import { FoundationError } from "../error.js";
import { compileControlRecordEvent } from "../control/model.js";
import type {
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordEvent,
  ControlRecordRevision,
  ControlRecordEventSubject,
} from "../control/types.js";
import { foundationIntegratedCandidateFactsDigestV1, parseFoundationIntegrationAssessmentPayloadV1 } from "../control/integration-assessment.js";
import { canonicalJson, digestCanonical, type Sha256 } from "../validation/canonical.js";
import {
  assertDeliveryEventEnvelope,
  deliveryEventSubject,
  resolveDeliveryEventSubject,
  type DeliveryRecordRevisionResolver,
  type DeliveryEventKind,
} from "./delivery-event-registry.js";
import {
  type DeliveryActivity,
  type DeliveryActivityFamily,
  type DeliveryActivityStage,
  type DeliveryCandidateCondition,
  type DeliveryCurrentSubjects,
  type DeliveryOperation,
  type DeliveryRecoveryObligation,
  type DeliveryStanding,
  type DeliveryState,
  deliveryWorkDecisionBasisDigest,
} from "./delivery-state.js";
import {
  deliveryOperationDescriptor,
  eligibleDeliveryOperations,
} from "./operation-registry.js";
import {
  deliveryRecoveryDescriptor,
  type DeliveryRecoveryStep,
} from "./recovery-registry.js";
import { assertFoundationTransactionObservationFactsV7 } from
  "./transaction-observation-facts-v7.js";

type SubjectReference = NonNullable<DeliveryCurrentSubjects["candidate"]>;

type ProviderOutcome = "completed" | "failed" | "not-started";
type TransactionOutcome = "applied" | "not-applied" | "indeterminate";
type CompletionOutcome = "completed" | "failed" | "abandoned";
type EvidenceReadiness =
  | "acceptance-ready"
  | "correctable"
  | "revision-required"
  | "no-ship-recommended";
type DirectorDecision = "admit" | "readmit" | "accept" | "no-ship";
type CheckPhase = "baseline" | "final";
type CheckModality =
  | "precondition"
  | "repair-target"
  | "regression-guard"
  | "postcondition"
  | "diagnostic";
type CheckDisposition =
  | "pass"
  | "fail"
  | "indeterminate"
  | "not-run"
  | "unsupported"
  | "operational-error";

type ReplayActivity = {
  id: string;
  operation: DeliveryOperation;
  family: DeliveryActivityFamily;
  originStanding: DeliveryStanding;
  stage: DeliveryActivityStage;
  recovery: DeliveryRecoveryObligation | null;
  brief: SubjectReference | null;
  attempt: SubjectReference | null;
  providerEffectDigest: Sha256 | null;
  providerOutcome: ProviderOutcome | null;
  preIntentRefusal: ControlRecordEvent | null;
  workProduct: SubjectReference | null;
  workProductAbandoned: boolean;
  candidate: SubjectReference | null;
  integrationAssessment: SubjectReference | null;
  receipt: SubjectReference | null;
  boundary: SubjectReference | null;
  materialCondition: SubjectReference | null;
  seal: SubjectReference | null;
  checks: Array<Readonly<{
    reference: SubjectReference;
    selectionId: string;
    phase: CheckPhase;
    modality: CheckModality;
    disposition: CheckDisposition;
  }>>;
  evidence: SubjectReference | null;
  evidenceReadiness: EvidenceReadiness | null;
  decision: SubjectReference | null;
  decisionKind: DirectorDecision | null;
  transactionEffectDigest: Sha256 | null;
  transactionOutcome: TransactionOutcome | null;
  closure: SubjectReference | null;
  completionOutcome: CompletionOutcome | null;
  reservation: WorkDelegationReservation | null;
};

type MutableSubjects = {
  proposedBoundary: SubjectReference | null;
  activeBoundary: SubjectReference | null;
  candidate: SubjectReference | null;
  integrationAssessment: SubjectReference | null;
  materialCondition: SubjectReference | null;
  seal: SubjectReference | null;
  evidence: SubjectReference | null;
  closure: SubjectReference | null;
};

type Replay = {
  resolveRevision: DeliveryRecordRevisionResolver;
  created: boolean;
  storeId: string | null;
  processId: string | null;
  lastEvent: ControlRecordEvent | null;
  lastOccurredAt: number | null;
  eventIds: Set<string>;
  finalizedSubjects: Set<string>;
  recordKinds: Map<string, string>;
  recordRevisions: Map<string, Sha256>;
  plannedBriefs: Map<string, SubjectReference>;
  activities: Map<string, ReplayActivity>;
  subjects: MutableSubjects;
  evidenceReadiness: EvidenceReadiness | null;
  closureDisposition: "accepted" | "no-ship" | null;
  candidateIntegrated: boolean;
  activeAdmission: SubjectReference | null;
  delegation: Readonly<{ reference: SubjectReference; payload: WorkDelegationPayload; stopped: boolean }> | null;
  delegatedCharges: WorkDelegationAccounting;
  standingBriefs: Map<string, SubjectReference>;
};

export type ReducedDeliveryState = DeliveryState & Readonly<{
  eligibleOperations: readonly DeliveryOperation[];
}>;

export type DeliveryStoreDisposition =
  | "active-unsealed"
  | "sealed-unarchived"
  | "archived-verified";

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.delivery-reducer.${code}`, message);
}

function freshReplay(resolveRevision: DeliveryRecordRevisionResolver): Replay {
  return {
    resolveRevision,
    created: false,
    storeId: null,
    processId: null,
    lastEvent: null,
    lastOccurredAt: null,
    eventIds: new Set<string>(),
    finalizedSubjects: new Set<string>(),
    recordKinds: new Map<string, string>(),
    recordRevisions: new Map<string, Sha256>(),
    plannedBriefs: new Map<string, SubjectReference>(),
    activities: new Map<string, ReplayActivity>(),
    subjects: {
      proposedBoundary: null,
      activeBoundary: null,
      candidate: null,
      integrationAssessment: null,
      materialCondition: null,
      seal: null,
      evidence: null,
      closure: null,
    },
    evidenceReadiness: null,
    closureDisposition: null,
    candidateIntegrated: false,
    activeAdmission: null,
    delegation: null,
    delegatedCharges: Object.freeze({ operations: 0, agentAttempts: 0, reservedCellWallTimeMs: 0 }),
    standingBriefs: new Map(),
  };
}

function clonedReference(value: SubjectReference | null): SubjectReference | null {
  return value === null ? null : Object.freeze({ ...value });
}

function clonedActivity(activity: ReplayActivity): ReplayActivity {
  return {
    ...activity,
    recovery: activity.recovery === null
      ? null
      : Object.freeze({ ...activity.recovery }),
    brief: clonedReference(activity.brief),
    attempt: clonedReference(activity.attempt),
    workProduct: clonedReference(activity.workProduct),
    candidate: clonedReference(activity.candidate),
    integrationAssessment: clonedReference(activity.integrationAssessment),
    receipt: clonedReference(activity.receipt),
    boundary: clonedReference(activity.boundary),
    materialCondition: clonedReference(activity.materialCondition),
    seal: clonedReference(activity.seal),
    checks: activity.checks.map((check) => Object.freeze({
      ...check,
      reference: clonedReference(check.reference)!,
    })),
    evidence: clonedReference(activity.evidence),
    decision: clonedReference(activity.decision),
    closure: clonedReference(activity.closure),
  };
}

function clonedReplay(replay: Replay): Replay {
  return {
    resolveRevision: replay.resolveRevision,
    created: replay.created,
    storeId: replay.storeId,
    processId: replay.processId,
    lastEvent: replay.lastEvent,
    lastOccurredAt: replay.lastOccurredAt,
    eventIds: new Set(replay.eventIds),
    finalizedSubjects: new Set(replay.finalizedSubjects),
    recordKinds: new Map(replay.recordKinds),
    recordRevisions: new Map(replay.recordRevisions),
    plannedBriefs: new Map(
      [...replay.plannedBriefs].map(([activityId, brief]) => [
        activityId,
        clonedReference(brief)!,
      ]),
    ),
    activities: new Map(
      [...replay.activities].map(([activityId, activity]) => [
        activityId,
        clonedActivity(activity),
      ]),
    ),
    subjects: {
      proposedBoundary: clonedReference(replay.subjects.proposedBoundary),
      activeBoundary: clonedReference(replay.subjects.activeBoundary),
      candidate: clonedReference(replay.subjects.candidate),
      integrationAssessment: clonedReference(replay.subjects.integrationAssessment),
      materialCondition: clonedReference(replay.subjects.materialCondition),
      seal: clonedReference(replay.subjects.seal),
      evidence: clonedReference(replay.subjects.evidence),
      closure: clonedReference(replay.subjects.closure),
    },
    evidenceReadiness: replay.evidenceReadiness,
    closureDisposition: replay.closureDisposition,
    candidateIntegrated: replay.candidateIntegrated,
    activeAdmission: clonedReference(replay.activeAdmission),
    delegation: replay.delegation === null ? null : Object.freeze({ ...replay.delegation,
      reference: clonedReference(replay.delegation.reference)! }),
    delegatedCharges: replay.delegatedCharges,
    standingBriefs: new Map(replay.standingBriefs),
  };
}

function exactPayload(event: ControlRecordEvent, keys: readonly string[]): ControlJsonObject {
  const actual = Object.keys(event.payload).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(
      "payload",
      `${event.eventKind} payload must contain exactly ${expected.length === 0 ? "no fields" : expected.join(", ")}`,
    );
  }
  return event.payload;
}

function field(payload: ControlJsonObject, name: string): ControlJsonValue {
  const value = payload[name];
  if (value === undefined) fail("payload", `Delivery event payload omits ${name}`);
  return value;
}

function stringField(payload: ControlJsonObject, name: string): string {
  const value = field(payload, name);
  if (typeof value !== "string") fail("payload", `Delivery event payload ${name} must be a string`);
  return value;
}

function identifierField(payload: ControlJsonObject, name: string): string {
  const value = stringField(payload, name);
  if (!ID_PATTERN.test(value) || Buffer.byteLength(value, "utf8") > 512) {
    fail("payload", `Delivery event payload ${name} must be one bounded opaque identity`);
  }
  return value;
}

function digestField(payload: ControlJsonObject, name: string): Sha256 {
  const value = stringField(payload, name);
  if (!SHA256_PATTERN.test(value)) {
    fail("payload", `Delivery event payload ${name} must be one lowercase SHA-256 digest`);
  }
  return value as Sha256;
}

function nullableDigestField(payload: ControlJsonObject, name: string): Sha256 | null {
  const value = field(payload, name);
  if (value === null) return null;
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail("payload", `Delivery event payload ${name} must be null or one lowercase SHA-256 digest`);
  }
  return value as Sha256;
}

function enumField<const T extends readonly string[]>(
  payload: ControlJsonObject,
  name: string,
  values: T,
): T[number] {
  const value = stringField(payload, name);
  if (!values.includes(value)) {
    fail("payload", `Delivery event payload ${name} has unsupported value ${value}`);
  }
  return value as T[number];
}

function reference(subject: ControlRecordEventSubject): SubjectReference {
  return Object.freeze({
    id: subject.recordId,
    revision: subject.revision,
    digest: subject.digest,
  });
}

function sameReference(left: SubjectReference, right: SubjectReference): boolean {
  return left.id === right.id && left.revision === right.revision && left.digest === right.digest;
}

function assertReference(
  referenceValue: SubjectReference | null,
  expected: SubjectReference | null,
  label: string,
): SubjectReference {
  if (referenceValue === null || expected === null || !sameReference(referenceValue, expected)) {
    fail("reference", `${label} does not bind the exact current Control record subject`);
  }
  return referenceValue;
}

function registerFinalizedSubject(
  replay: Replay,
  event: ControlRecordEvent,
  kind: string,
): ControlRecordRevision {
  if (replay.processId === null) {
    fail("order", `${event.eventKind} cannot precede Delivery creation`);
  }
  const resolved = resolveDeliveryEventSubject(
    event,
    replay.processId,
    replay.resolveRevision,
  );
  if (resolved.recordKind !== kind) {
    fail("reference", `${event.eventKind} cannot finalize ${resolved.recordKind} as ${kind}`);
  }
  const value = reference(deliveryEventSubject(event));
  const existingKind = replay.recordKinds.get(value.id);
  if (existingKind !== undefined && existingKind !== kind) {
    fail("reference", `Control record ${value.id} is rebound from ${existingKind} to ${kind}`);
  }
  replay.recordKinds.set(value.id, kind);
  const revisionKey = `${value.id}\u0000${value.revision}`;
  const retainedDigest = replay.recordRevisions.get(revisionKey);
  if (retainedDigest !== undefined && retainedDigest !== value.digest) {
    fail(
      "corruption",
      `Control record ${value.id} revision ${value.revision} is rebound to different bytes`,
    );
  }
  replay.recordRevisions.set(revisionKey, value.digest);
  const key = `${kind}\u0000${value.id}\u0000${value.revision}\u0000${value.digest}`;
  if (replay.finalizedSubjects.has(key)) {
    fail("duplicate", `${kind} ${value.id} revision ${value.revision} is finalized more than once`);
  }
  replay.finalizedSubjects.add(key);
  return resolved;
}

function retainedReference(revision: ControlRecordRevision): SubjectReference {
  return Object.freeze({
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function recordEnumField<const T extends readonly string[]>(
  revision: ControlRecordRevision,
  name: string,
  values: T,
): T[number] {
  const value = revision.payload[name];
  if (typeof value !== "string" || !values.includes(value)) {
    fail(
      "record-payload",
      `${revision.recordKind} ${revision.recordId} payload ${name} has an unsupported value`,
    );
  }
  return value as T[number];
}

function recordIdentifierField(revision: ControlRecordRevision, name: string): string {
  const value = revision.payload[name];
  if (
    typeof value !== "string" || !ID_PATTERN.test(value) ||
    Buffer.byteLength(value, "utf8") > 512
  ) {
    fail(
      "record-payload",
      `${revision.recordKind} ${revision.recordId} payload ${name} must be one bounded opaque identity`,
    );
  }
  return value;
}

function recordObject(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("record-payload", `${label} must be one object`);
  }
  return value as ControlJsonObject;
}

function recordArray(value: ControlJsonValue | undefined, label: string): readonly ControlJsonValue[] {
  if (!Array.isArray(value)) fail("record-payload", `${label} must be one array`);
  return value;
}

function nestedIdentifier(value: ControlJsonValue | undefined, label: string): string {
  if (
    typeof value !== "string" || !ID_PATTERN.test(value) ||
    Buffer.byteLength(value, "utf8") > 512
  ) {
    fail("record-payload", `${label} must be one bounded opaque identity`);
  }
  return value;
}

function requiredCheckSelectionIds(
  replay: Replay,
  selected: SubjectReference | null,
  requirement: "baselineRequired" | "finalRequired",
  label: string,
): ReadonlySet<string> {
  if (selected === null || replay.processId === null) {
    fail("order", `${label} has no exact Work Boundary`);
  }
  const revision = replay.resolveRevision(Object.freeze({
    recordId: selected.id,
    revision: selected.revision,
    digest: selected.digest,
  }));
  if (
    revision === null || revision.processId !== replay.processId ||
    revision.recordKind !== "work-boundary" || revision.recordId !== selected.id ||
    revision.revision !== selected.revision || revision.digest !== selected.digest
  ) {
    fail("reference", `${label} cannot resolve the exact Work Boundary`);
  }
  const mandate = recordObject(revision.payload.mandate, "Work Boundary mandate");
  const checks = recordArray(mandate.checks, "Work Boundary mandate Checks");
  const seen = new Set<string>();
  const required = new Set<string>();
  for (const value of checks) {
    const check = recordObject(value, "Work Boundary Check selection");
    const selectionId = nestedIdentifier(check.id, "Work Boundary Check selection identity");
    if (seen.has(selectionId)) {
      fail("record-payload", `Work Boundary repeats Check selection ${selectionId}`);
    }
    seen.add(selectionId);
    if (typeof check[requirement] !== "boolean") {
      fail(
        "record-payload",
        `Work Boundary Check selection ${selectionId} ${requirement} must be boolean`,
      );
    }
    if (check[requirement]) required.add(selectionId);
  }
  if (required.size === 0) {
    fail("record-payload", `Work Boundary requires at least one ${requirement} Check selection`);
  }
  return required;
}

function baselineSelectionIds(
  replay: Replay,
  activity: ReplayActivity,
): ReadonlySet<string> {
  return requiredCheckSelectionIds(
    replay,
    activity.boundary,
    "baselineRequired",
    `Activity ${activity.id} baseline Checks`,
  );
}

function finalSelectionIds(replay: Replay, activity: ReplayActivity): ReadonlySet<string> {
  return requiredCheckSelectionIds(
    replay,
    replay.subjects.activeBoundary,
    "finalRequired",
    `Activity ${activity.id} final Checks`,
  );
}

function assertOnlyRelationships(
  revision: ControlRecordRevision,
  allowed: readonly string[],
): void {
  const unexpected = revision.relationships.find(({ relation }) => !allowed.includes(relation));
  if (unexpected !== undefined) {
    fail(
      "record-relationship",
      `${revision.recordKind} ${revision.recordId} cannot carry ${unexpected.relation}`,
    );
  }
}

function relationshipReferences(
  revision: ControlRecordRevision,
  relation: string,
  targetKind: string,
): readonly SubjectReference[] {
  const matches = revision.relationships.filter((candidate) => candidate.relation === relation);
  return Object.freeze(matches.map(({ target }) => {
    if (target.kind !== targetKind || target.revision === null) {
      fail(
        "record-relationship",
        `${revision.recordKind} ${revision.recordId} relationship ${relation} must select one exact ${targetKind} revision`,
      );
    }
    return Object.freeze({ id: target.id, revision: target.revision, digest: target.digest });
  }));
}

function requiredRelationship(
  revision: ControlRecordRevision,
  relation: string,
  targetKind: string,
): SubjectReference {
  const matches = relationshipReferences(revision, relation, targetKind);
  if (matches.length !== 1) {
    fail(
      "record-relationship",
      `${revision.recordKind} ${revision.recordId} requires exactly one ${relation} relationship`,
    );
  }
  return matches[0]!;
}

function optionalRelationship(
  revision: ControlRecordRevision,
  relation: string,
  targetKind: string,
): SubjectReference | null {
  const matches = relationshipReferences(revision, relation, targetKind);
  if (matches.length > 1) {
    fail(
      "record-relationship",
      `${revision.recordKind} ${revision.recordId} permits at most one ${relation} relationship`,
    );
  }
  return matches[0] ?? null;
}

function assertAbsentRelationship(referenceValue: SubjectReference | null, label: string): void {
  if (referenceValue !== null) {
    fail("record-relationship", `${label} is not legal for this Control record variant`);
  }
}

function currentEstablishedBoundary(replay: Replay): SubjectReference | null {
  if (replay.subjects.activeBoundary !== null) return replay.subjects.activeBoundary;
  if (replay.subjects.proposedBoundary !== null) return replay.subjects.proposedBoundary;
  const finalized = [...replay.activities.values()]
    .reverse()
    .find(({ boundary }) => boundary !== null);
  return finalized?.boundary ?? null;
}

function legalBaselineReceipt(check: ReplayActivity["checks"][number]): boolean {
  if (check.phase !== "baseline") return false;
  switch (check.modality) {
    case "precondition":
      return check.disposition === "pass";
    case "repair-target":
      return check.disposition === "pass" || check.disposition === "fail";
    case "regression-guard":
      return check.disposition === "pass";
    case "postcondition":
      return check.disposition === "not-run";
    case "diagnostic":
      return true;
  }
}

function legalAcceptanceReceipt(check: ReplayActivity["checks"][number]): boolean {
  return check.phase === "final" &&
    (check.modality === "diagnostic" || check.disposition === "pass");
}

function baselineChecksForBoundary(
  replay: Replay,
  boundary: SubjectReference | null,
): readonly ReplayActivity["checks"][number][] {
  if (boundary === null) return Object.freeze([]);
  const owner = [...replay.activities.values()].find(({ boundary: selected }) =>
    selected !== null && sameReference(selected, boundary));
  return Object.freeze(owner?.checks.filter(({ phase }) => phase === "baseline") ?? []);
}

function assertExactActivitySubject(event: ControlRecordEvent, expected: SubjectReference | null): void {
  if (expected === null) fail("reference", `${event.eventKind} has no retained activity subject to bind`);
  const actual = reference(deliveryEventSubject(event));
  if (!sameReference(actual, expected)) {
    fail("reference", `${event.eventKind} does not bind the exact retained activity subject`);
  }
}

function publicActivity(activity: ReplayActivity): DeliveryActivity {
  return Object.freeze({
    id: activity.id,
    operation: activity.operation,
    family: activity.family,
    stage: activity.stage,
    recovery: activity.recovery === null ? null : Object.freeze({ ...activity.recovery }),
  });
}

function currentStanding(replay: Replay): DeliveryStanding {
  if (replay.subjects.closure !== null) return "closed";
  if (replay.subjects.materialCondition !== null && replay.subjects.proposedBoundary !== null) {
    return "awaiting-readmission";
  }
  if (replay.subjects.materialCondition !== null) return "boundary-paused";
  if (replay.evidenceReadiness === "acceptance-ready") return "decision-ready";
  if (replay.subjects.activeBoundary !== null) return "active";
  if (replay.subjects.proposedBoundary !== null) return "awaiting-admission";
  return "framing";
}

function currentCandidateCondition(replay: Replay): DeliveryCandidateCondition {
  if (replay.subjects.closure !== null) {
    if (replay.subjects.candidate === null) return "absent";
    return replay.closureDisposition === "accepted" ? "accepted" : "abandoned";
  }
  if (replay.subjects.candidate === null) return "absent";
  const activeCandidateActivity = [...replay.activities.values()].find((activity) =>
    activity.stage !== "completed" && activity.operation !== "delivery.prepare");
  if ([...replay.activities.values()].some((activity) =>
    activity.stage !== "completed" && activity.recovery !== null &&
    !(
      activity === activeCandidateActivity &&
      (activity.stage === "started" || activity.stage === "prepared")
    ))) {
    return "terminal-recovery";
  }
  if (replay.subjects.materialCondition !== null) return "paused-for-boundary";
  if (activeCandidateActivity?.operation === "delivery.integrate") return "in-progress";
  if (replay.evidenceReadiness === "acceptance-ready") return "ready-for-decision";
  if (activeCandidateActivity?.operation === "delivery.evaluate" && replay.subjects.seal !== null) {
    return "sealed-under-evaluation";
  }
  if (activeCandidateActivity !== undefined) return "in-progress";
  if (
    replay.evidenceReadiness === "correctable" ||
    replay.evidenceReadiness === "no-ship-recommended"
  ) {
    return "needs-correction";
  }
  if (replay.subjects.seal !== null && replay.subjects.evidence === null) {
    return "sealed-under-evaluation";
  }
  return "ready-for-work";
}

function stateFromReplay(replay: Replay): DeliveryState {
  const activities = Object.freeze([...replay.activities.values()].map(publicActivity));
  const subjects: DeliveryCurrentSubjects = Object.freeze({ ...replay.subjects });
  return Object.freeze({
    standing: currentStanding(replay),
    candidateCondition: currentCandidateCondition(replay),
    activities,
    subjects,
    delegation: Object.freeze({
      admission: clonedReference(replay.activeAdmission),
      current: replay.delegation === null ? null : Object.freeze({
        reference: clonedReference(replay.delegation.reference)!, stopped: replay.delegation.stopped,
      }),
      charged: replay.delegatedCharges,
    }),
    journal: Object.freeze({
      eventCount: replay.lastEvent?.sequence ?? 0,
      headDigest: replay.lastEvent?.digest ?? null,
    }),
  });
}

function reducedState(replay: Replay): ReducedDeliveryState {
  const state = stateFromReplay(replay);
  return Object.freeze({
    ...state,
    eligibleOperations: eligibleDeliveryOperations(state, { candidateIntegrated: replay.candidateIntegrated }),
  });
}

function activityFor(replay: Replay, payload: ControlJsonObject): ReplayActivity {
  const activityId = identifierField(payload, "activityId");
  const activity = replay.activities.get(activityId);
  if (activity === undefined) fail("activity", `Delivery event names unknown activity ${activityId}`);
  if (activity.stage === "completed") fail("activity", `Delivery activity ${activityId} is already complete`);
  return activity;
}

function recovery(
  kind: DeliveryRecoveryObligation["kind"],
  resumesAt: DeliveryRecoveryStep,
  exactEffectDigest: Sha256 | null,
): DeliveryRecoveryObligation {
  deliveryRecoveryDescriptor(kind, resumesAt);
  return Object.freeze({ kind, resumesAt, exactEffectDigest });
}

function assertAgentActivity(activity: ReplayActivity, eventKind: DeliveryEventKind): void {
  if (activity.family !== "agent") {
    fail("activity", `${eventKind} requires an agent activity`);
  }
}

function assertTransactionActivity(activity: ReplayActivity, eventKind: DeliveryEventKind): void {
  if (activity.family !== "transaction") {
    fail("activity", `${eventKind} requires a transaction activity`);
  }
}

function assertCoreAgentTerminal(activity: ReplayActivity): void {
  if (activity.attempt === null || activity.providerOutcome === null) {
    fail("order", `Agent activity ${activity.id} has not reached a provider observation`);
  }
  if (activity.workProduct === null && !activity.workProductAbandoned) {
    fail("order", `Agent activity ${activity.id} has no submitted or abandoned work product`);
  }
}

function assertWorkProductOpen(activity: ReplayActivity): void {
  if (activity.workProduct !== null || activity.workProductAbandoned) {
    fail("duplicate", `Agent activity ${activity.id} already has a terminal work-product disposition`);
  }
}

function verifyEnvelope(replay: Replay, event: ControlRecordEvent, expectedSequence: number): void {
  assertDeliveryEventEnvelope(event);
  const reproduced = compileControlRecordEvent({
    storeId: event.storeId,
    processId: event.processId,
    sequence: event.sequence,
    predecessorDigest: event.predecessorDigest,
    event: {
      eventId: event.eventId,
      eventKind: event.eventKind,
      occurredAt: event.occurredAt,
      actor: event.actor,
      subject: event.subject,
      payload: event.payload,
    },
  });
  if (reproduced.schema !== event.schema || reproduced.digest !== event.digest) {
    fail("corruption", `Delivery event ${event.eventId} does not reproduce its retained digest`);
  }
  if (event.sequence !== expectedSequence) {
    fail("sequence", `Delivery replay expected event sequence ${expectedSequence}, received ${event.sequence}`);
  }
  if (replay.lastEvent === null) {
    if (event.predecessorDigest !== null) fail("sequence", "First Delivery event names a predecessor");
    replay.storeId = event.storeId;
    replay.processId = event.processId;
  } else {
    if (event.storeId !== replay.storeId || event.processId !== replay.processId) {
      fail("scope", "Delivery replay crosses its retained store or Process identity");
    }
    if (event.predecessorDigest !== replay.lastEvent.digest) {
      fail("sequence", `Delivery event ${event.eventId} does not bind the exact preceding event`);
    }
  }
  if (replay.eventIds.has(event.eventId)) fail("duplicate", `Delivery event ${event.eventId} is repeated`);
  const occurredAt = new Date(event.occurredAt).valueOf();
  if (replay.lastOccurredAt !== null && occurredAt < replay.lastOccurredAt) {
    fail("time", `Delivery event ${event.eventId} precedes the prior durable event time`);
  }
  replay.eventIds.add(event.eventId);
  replay.lastOccurredAt = occurredAt;
}

function submitDirectorBrief(replay: Replay, event: ControlRecordEvent): void {
  if (Object.hasOwn(event.payload, "delegationId")) {
    const payload = exactPayload(event, ["delegationId", "delegationRevision", "operation"]);
    const brief = registerFinalizedSubject(replay, event, "director-brief");
    assertOnlyRelationships(brief, []);
    const scope = recordObject(brief.payload.scope, "Standing Director Brief scope");
    const expected = { kind: "delegation", ...payload };
    if (canonicalJson(scope) !== canonicalJson(expected) || brief.payload.inputProfile !== payload.operation) {
      fail("delegation-brief", "Standing direction does not bind its exact delegation and operation");
    }
    const key = canonicalJson(payload);
    if (replay.standingBriefs.has(key)) fail("delegation-brief", "A delegation operation has duplicate standing direction");
    replay.standingBriefs.set(key, retainedReference(brief));
    return;
  }
  const payload = exactPayload(event, ["activityId"]);
  const activityId = identifierField(payload, "activityId");
  if (replay.activities.has(activityId)) {
    fail("order", `Director Brief for ${activityId} must be finalized before the activity starts`);
  }
  if (replay.plannedBriefs.has(activityId)) {
    fail("duplicate", `Planned agent activity ${activityId} already has a Director Brief`);
  }
  const briefRevision = registerFinalizedSubject(replay, event, "director-brief");
  assertOnlyRelationships(briefRevision, []);
  if (canonicalJson(briefRevision.payload.scope) !== canonicalJson({ kind: "activity", activityId })) {
    fail("brief-scope", "Director Brief must bind its exact Activity scope");
  }
  replay.plannedBriefs.set(activityId, retainedReference(briefRevision));
}

function exactDelegationRevision(replay: Replay, selected: SubjectReference, kind: string): ControlRecordRevision {
  const revision = replay.resolveRevision({ recordId: selected.id, revision: selected.revision, digest: selected.digest });
  if (revision === null || revision.processId !== replay.processId || revision.recordKind !== kind ||
      revision.recordId !== selected.id || revision.revision !== selected.revision || revision.digest !== selected.digest) {
    fail("delegation-subject", "Delegated work requires its exact retained subjects");
  }
  return revision;
}

function setWorkDelegation(replay: Replay, event: ControlRecordEvent): void {
  exactPayload(event, []);
  if (replay.subjects.activeBoundary === null || replay.activeAdmission === null ||
      replay.subjects.materialCondition !== null || [...replay.activities.values()].some(activity => activity.stage !== "completed")) {
    fail("delegation-currentness", "Resource delegation requires settled work under an active admitted mandate");
  }
  const revision = registerFinalizedSubject(replay, event, "work-delegation");
  const grant = parseWorkDelegationPayload(revision.payload);
  assertOnlyRelationships(revision, ["uses-boundary", "uses-admission", "uses-brief", "revises"]);
  assertReference(grant.boundary, replay.subjects.activeBoundary, "Delegation Boundary");
  assertReference(grant.admission, replay.activeAdmission, "Delegation admission");
  assertReference(requiredRelationship(revision, "uses-boundary", "work-boundary"), grant.boundary, "Delegation Boundary relationship");
  assertReference(requiredRelationship(revision, "uses-admission", "director-decision"), grant.admission, "Delegation admission relationship");
  const admission = exactDelegationRevision(replay, replay.activeAdmission, "director-decision");
  if (revision.semanticAuthor.id !== admission.semanticAuthor.id) {
    fail("delegation-author", "Resource direction must preserve the admitted Director's supplied provenance");
  }
  const previous = replay.delegation?.reference ?? null;
  const previousRelationship = optionalRelationship(revision, "revises", "work-delegation");
  if (previous === null) {
    if (grant.replaces !== null || previousRelationship !== null) {
      fail("delegation-revision", "Initial resource permission cannot replace an absent delegation");
    }
  } else {
    assertReference(grant.replaces, previous, "Delegation replacement");
    assertReference(previousRelationship, previous, "Delegation replacement relationship");
  }
  if (previous !== null && (revision.recordId !== previous.id || revision.revision !== previous.revision + 1)) {
    fail("delegation-revision", "Resource replacement must advance the same exact delegation lineage");
  }
  if (grant.expiresAt !== null && Date.parse(grant.expiresAt) <= Date.parse(event.occurredAt)) {
    fail("delegation-expiry", "New resource permission must not already be expired");
  }
  for (const field of ["operations", "agentAttempts", "reservedCellWallTimeMs"] as const) {
    if (grant.ceilings[field] < replay.delegatedCharges[field]) {
      fail("delegation-accounting", "A resource replacement cannot erase already reserved work");
    }
  }
  const directions = revision.relationships.filter(link => link.relation === "uses-brief");
  const selectedDirections = [grant.directions.continue, grant.directions.evaluate].filter(value => value !== null);
  if (directions.length !== selectedDirections.length) fail("delegation-brief", "Resource direction relationships differ from the selected standing Briefs");
  for (const [operation, selected] of [["delivery.continue", grant.directions.continue], ["delivery.evaluate", grant.directions.evaluate]] as const) {
    if (selected === null) continue;
    const key = canonicalJson({ delegationId: revision.recordId, delegationRevision: revision.revision, operation });
    assertReference(replay.standingBriefs.get(key) ?? null, selected, "Delegation standing Brief");
    const brief = exactDelegationRevision(replay, selected, "director-brief");
    if (brief.semanticAuthor.id !== revision.semanticAuthor.id ||
        !directions.some(link => link.target.id === selected.id && link.target.revision === selected.revision && link.target.digest === selected.digest)) {
      fail("delegation-brief", "Standing direction must preserve its exact Director and selected relationship");
    }
    replay.standingBriefs.delete(key);
  }
  replay.delegation = Object.freeze({ reference: retainedReference(revision), payload: grant, stopped: false });
}

function stopWorkDelegation(replay: Replay, event: ControlRecordEvent): void {
  const payload = exactPayload(event, ["requestDigest", "requestedAt", "requestedBy"]);
  const grant = replay.delegation;
  if (grant === null || grant.stopped || [...replay.activities.values()].some(activity => activity.stage !== "completed")) {
    fail("delegation-stop", "A settled stop must identify one current delegation after its reserved work settles");
  }
  assertReference(reference(deliveryEventSubject(event)), grant.reference, "Stopped delegation");
  const revision = exactDelegationRevision(replay, grant.reference, "work-delegation");
  if (payload.requestedBy !== revision.semanticAuthor.id ||
      Date.parse(stringField(payload, "requestedAt")) < Date.parse(revision.createdAt) ||
      Date.parse(stringField(payload, "requestedAt")) > Date.parse(event.occurredAt)) {
    fail("delegation-stop", "A stop must retain the exact Director's earlier request");
  }
  const request = compileWorkDelegationStopRequest({ storeId: event.storeId, processId: event.processId,
    delegation: { kind: "work-delegation", ...grant.reference },
    requestedAt: stringField(payload, "requestedAt"), requestedBy: stringField(payload, "requestedBy") });
  if (payload.requestDigest !== request.digest) fail("delegation-stop", "A stopped delegation must reproduce its exact request digest");
  replay.delegation = Object.freeze({ ...grant, stopped: true });
}

function assertReservedChecks(replay: Replay, reservation: WorkDelegationReservation): void {
  if (reservation.operation !== "delivery.evaluate") return;
  if (replay.subjects.activeBoundary === null) fail("delegation-checks", "Delegated evaluation requires its active Boundary");
  const boundary = exactDelegationRevision(replay, replay.subjects.activeBoundary, "work-boundary");
  const mandate = recordObject(boundary.payload.mandate, "Reserved evaluation mandate");
  const required = recordArray(mandate.checks, "Reserved evaluation Checks")
    .map(value => recordObject(value, "Reserved Check selection"))
    .filter(selection => selection.finalRequired === true);
  const slots = reservation.slots.filter(slot => slot.purpose === "check");
  if (slots.length !== required.length) fail("delegation-checks", "Evaluation must reserve every required final Check exactly once");
  for (const selection of required) {
    const slot = slots.find(value => value.selectionId === selection.id);
    if (slot === undefined || canonicalJson(slot.definition) !== canonicalJson(selection.definition)) {
      fail("delegation-checks", "Reserved Check must bind its exact admitted Definition occurrence");
    }
    if (!recordArray(selection.bindings, "Admitted Check Bindings").some(value => {
      const binding = recordObject(value, "Admitted Check Binding");
      // The reservation carries the exact Binding reference. The admitted
      // value additionally carries its implementation digest; the Check owner
      // verifies that complete installed mechanism before allocation.
      return binding.id === slot.binding.id && binding.digest === slot.binding.digest;
    })) {
      fail("delegation-checks", "Reserved Check must use an admitted exact Binding");
    }
  }
}

function startActivity(replay: Replay, event: ControlRecordEvent): void {
  const payload = exactPayload(event, Object.hasOwn(event.payload, "reservation")
    ? ["activityId", "operation", "reservation"] : ["activityId", "operation"]);
  const activityId = identifierField(payload, "activityId");
  if (replay.activities.has(activityId)) fail("duplicate", `Delivery activity ${activityId} is repeated`);
  const operation = stringField(payload, "operation");
  const descriptor = deliveryOperationDescriptor(operation);
  if (descriptor.operation === "delivery.recover") {
    fail("activity", "Recovery resumes an exact retained activity; it cannot create a second activity");
  }
  const reservation = Object.hasOwn(payload, "reservation") ? parseWorkDelegationReservation(payload.reservation) : null;
  let brief = replay.plannedBriefs.get(activityId) ?? null;
  const state = stateFromReplay(replay);
  if (reservation !== null) {
    const grant = replay.delegation;
    if (grant === null || reservation.activityId !== activityId || reservation.operation !== descriptor.operation ||
        replay.subjects.materialCondition !== null || brief !== null) {
      fail("delegation-reservation", "Delegated opening must use its exact current resource permission and standing direction");
    }
    assertReference(reservation.delegation, grant.reference, "Reserved delegation");
    assertReference(grant.payload.boundary, replay.subjects.activeBoundary, "Reserved Boundary");
    assertReference(grant.payload.admission, replay.activeAdmission, "Reserved admission");
    if (reservation.decision.journalHead.sequence !== replay.lastEvent?.sequence ||
        reservation.decision.journalHead.digest !== replay.lastEvent?.digest ||
        reservation.decision.basisDigest !== deliveryWorkDecisionBasisDigest(state)) {
      fail("delegation-basis", "A work reservation must bind the exact preceding settled facts");
    }
    if ([...replay.activities.values()].some(activity => activity.reservation?.reservationId === reservation.reservationId)) {
      fail("delegation-reservation", "A work reservation cannot finance another Activity");
    }
    assertReservedChecks(replay, reservation);
    const allowance = assessWorkDelegationAllowance({ delegation: grant.payload,
      accounting: replay.delegatedCharges, reservation, observedAt: event.occurredAt, stopped: grant.stopped });
    if (!allowance.allowed) fail("delegation-allowance", `Work reservation is outside its retained allowance: ${allowance.reason}`);
    brief = reservation.operation === "delivery.continue" ? grant.payload.directions.continue
      : reservation.operation === "delivery.evaluate" ? grant.payload.directions.evaluate : null;
  } else if (replay.delegation !== null && !replay.delegation.stopped &&
      replay.subjects.activeBoundary !== null && replay.activeAdmission !== null &&
      sameReference(replay.delegation.payload.boundary, replay.subjects.activeBoundary) &&
      sameReference(replay.delegation.payload.admission, replay.activeAdmission) &&
      WORK_DELEGATION_OPERATIONS.includes(descriptor.operation as WorkDelegationReservation["operation"])) {
    fail("delegation-reservation", "An active work allowance cannot be bypassed with an uncharged productive opening");
  }
  if (descriptor.activity === "agent" && brief === null) {
    fail("order", `Agent activity ${activityId} requires its exact finalized Director Brief`);
  }
  if (descriptor.activity !== "agent" && brief !== null) {
    fail("activity", `Director Brief ${brief.id} is planned for an agent activity, not ${descriptor.operation}`);
  }
  if (!eligibleDeliveryOperations(state, { candidateIntegrated: replay.candidateIntegrated }).includes(descriptor.operation)) {
    fail("eligibility", `${descriptor.operation} is not eligible in the current Delivery state`);
  }
  if (descriptor.activity === "recovery") fail("activity", "Recovery cannot start a new Activity");
  const family: DeliveryActivityFamily = descriptor.activity;
  replay.activities.set(activityId, {
    id: activityId,
    operation: descriptor.operation,
    family,
    originStanding: state.standing,
    stage: "started",
    recovery: family === "agent"
      ? descriptor.operation === "delivery.evaluate"
        ? recovery("finalization", "candidate-sealed", null)
        : recovery("finalization", "agent-attempt-prepared", null)
      : family === "integration"
        ? recovery("finalization", "integration-assessed", null)
        : recovery("finalization", "director-decision-authenticated", null),
    brief,
    attempt: null,
    providerEffectDigest: null,
    providerOutcome: null,
    preIntentRefusal: null,
    workProduct: null,
    workProductAbandoned: false,
    candidate: null,
    integrationAssessment: null,
    receipt: null,
    boundary: null,
    materialCondition: null,
    seal: null,
    checks: [],
    evidence: null,
    evidenceReadiness: null,
    decision: null,
    decisionKind: null,
    transactionEffectDigest: null,
    transactionOutcome: null,
    closure: null,
    completionOutcome: null,
    reservation,
  });
  if (reservation !== null) replay.delegatedCharges = addWorkDelegationAccounting(replay.delegatedCharges, reservation.charges);
  replay.plannedBriefs.delete(activityId);
}

function recordRecovery(replay: Replay, event: ControlRecordEvent): void {
  const payload = exactPayload(event, ["activityId", "exactEffectDigest", "kind", "resumesAt"]);
  const activity = activityFor(replay, payload);
  if (activity.recovery === null) {
    fail("recovery", `Delivery activity ${activity.id} has no exact recovery obligation`);
  }
  const kind = enumField(payload, "kind", ["provider", "candidate-observation", "transaction", "finalization"] as const);
  const resumesAt = identifierField(payload, "resumesAt");
  const recoveryDescriptor = deliveryRecoveryDescriptor(kind, resumesAt);
  const exactEffectDigest = nullableDigestField(payload, "exactEffectDigest");
  if (
    activity.recovery.kind !== kind ||
    activity.recovery.resumesAt !== recoveryDescriptor.resumesAt ||
    activity.recovery.exactEffectDigest !== exactEffectDigest
  ) {
    fail("recovery", `Recovery does not resume the exact retained obligation for activity ${activity.id}`);
  }
}

function refuseAgentBeforeIntent(replay: Replay, event: ControlRecordEvent): void {
  const payload = exactPayload(event, ["activityId", "diagnosticCode", "refusalFactsDigest", "resolution"]);
  const activity = activityFor(replay, payload);
  assertAgentActivity(activity, "agent-pre-intent-refused");
  const preAttemptStage = activity.operation === "delivery.evaluate" ? "finalizing" : "started";
  const preAttemptStep = activity.operation === "delivery.evaluate"
    ? "evaluation-checks"
    : "agent-attempt-prepared";
  if (
    event.subject !== null || activity.stage !== preAttemptStage || activity.attempt !== null ||
    activity.providerEffectDigest !== null || activity.providerOutcome !== null ||
    activity.workProduct !== null || activity.workProductAbandoned || activity.receipt !== null ||
    activity.recovery?.kind !== "finalization" ||
    activity.recovery.resumesAt !== preAttemptStep ||
    activity.recovery.exactEffectDigest !== null
  ) {
    fail("order", `Agent activity ${activity.id} is not at the exact pre-intent refusal boundary`);
  }
  const diagnosticCode = identifierField(payload, "diagnosticCode");
  digestField(payload, "refusalFactsDigest");
  const resolution = enumField(payload, "resolution", ["none", "projection-condition-required"] as const);
  if (resolution === "projection-condition-required" && ((activity.operation !== "delivery.evaluate" && activity.operation !== "delivery.continue") ||
      diagnosticCode !== "lifecycle.projection.mandatory-too-large")) {
    fail("order", "Only an exact measured builder or reviewer refusal can require a Projection Condition");
  }
  activity.preIntentRefusal = event;
  activity.stage = "finalizing";
  activity.recovery = recovery("finalization",
    resolution === "projection-condition-required"
      ? "activity-finalization" : "activity-completed", null);
}

function prepareAttempt(replay: Replay, event: ControlRecordEvent): void {
  const payload = exactPayload(event, ["activityId"]);
  const activity = activityFor(replay, payload);
  assertAgentActivity(activity, "agent-attempt-prepared");
  if (activity.preIntentRefusal !== null) {
    fail("order", `Agent activity ${activity.id} cannot prepare an Attempt after pre-intent refusal`);
  }
  if (activity.attempt !== null || activity.providerEffectDigest !== null) {
    fail("order", `Agent activity ${activity.id} already has a prepared Attempt`);
  }
  const attemptRevision = registerFinalizedSubject(replay, event, "agent-attempt");
  if (activity.reservation !== null) {
    const slot = activity.reservation.slots.find(slot => slot.purpose === "agent");
    if (slot === undefined || slot.purpose !== "agent" || !workDelegationAgentAttemptMatches(slot, attemptRevision)) {
      fail("delegation-attempt", "The prepared Attempt must reproduce its reserved Agent resource selection");
    }
  }
  assertOnlyRelationships(attemptRevision, ["uses-brief", "uses-boundary", "uses-candidate", "uses-seal"]);
  assertReference(
    requiredRelationship(attemptRevision, "uses-brief", "director-brief"),
    activity.brief,
    "Agent Attempt Director Brief",
  );
  const usesBoundary = optionalRelationship(attemptRevision, "uses-boundary", "work-boundary");
  const usesCandidate = optionalRelationship(
    attemptRevision,
    "uses-candidate",
    "candidate-revision",
  );
  const usesSeal = optionalRelationship(attemptRevision, "uses-seal", "candidate-seal");
  if (activity.operation === "delivery.prepare") {
    assertAbsentRelationship(usesBoundary, "Preparation Attempt Work Boundary");
    assertAbsentRelationship(usesCandidate, "Preparation Attempt Candidate");
    assertAbsentRelationship(usesSeal, "Preparation Attempt Candidate Seal");
  } else {
    assertReference(usesBoundary, replay.subjects.activeBoundary, "Agent Attempt active Work Boundary");
    assertReference(usesCandidate, replay.subjects.candidate, "Agent Attempt current Candidate");
    if (activity.operation === "delivery.evaluate") {
      const required = finalSelectionIds(replay, activity);
      const received = new Set(activity.checks
        .filter(({ phase }) => phase === "final")
        .map(({ selectionId }) => selectionId));
      if (
        activity.seal === null ||
        activity.recovery?.kind !== "finalization" ||
        activity.recovery.resumesAt !== "evaluation-checks" ||
        ![...required].every((selectionId) => received.has(selectionId))
      ) {
        fail(
          "order",
          "Reviewer Attempt requires the exact Candidate Seal and complete required final Check set",
        );
      }
      assertReference(usesSeal, replay.subjects.seal, "Reviewer Attempt current Candidate Seal");
    } else {
      assertAbsentRelationship(usesSeal, "Non-reviewer Agent Attempt Candidate Seal");
    }
  }
  activity.attempt = retainedReference(attemptRevision);
  activity.stage = "prepared";
  activity.recovery = recovery("finalization", "provider-effect-intended", null);
}

function intendProviderEffect(replay: Replay, event: ControlRecordEvent): void {
  const payload = exactPayload(event, ["activityId", "effectDigest"]);
  const activity = activityFor(replay, payload);
  assertAgentActivity(activity, "provider-effect-intended");
  assertExactActivitySubject(event, activity.attempt);
  if (activity.attempt === null || activity.providerEffectDigest !== null) {
    fail("order", `Agent activity ${activity.id} is not ready for one provider effect intent`);
  }
  const effectDigest = digestField(payload, "effectDigest");
  activity.providerEffectDigest = effectDigest;
  activity.stage = "effect-intended";
  activity.recovery = recovery("provider", "provider-effect-observed", effectDigest);
}

function observeProviderEffect(replay: Replay, event: ControlRecordEvent): void {
  const payload = exactPayload(event, ["activityId", "effectDigest", "outcome"]);
  const activity = activityFor(replay, payload);
  assertAgentActivity(activity, "provider-effect-observed");
  assertExactActivitySubject(event, activity.attempt);
  const effectDigest = digestField(payload, "effectDigest");
  if (activity.providerEffectDigest === null || activity.providerEffectDigest !== effectDigest) {
    fail("reference", `Provider observation does not bind the exact effect for activity ${activity.id}`);
  }
  if (activity.providerOutcome !== null) fail("duplicate", `Agent activity ${activity.id} already observed its provider effect`);
  activity.providerOutcome = enumField(payload, "outcome", ["completed", "failed", "not-started"] as const);
  activity.stage = "effect-observed";
  activity.recovery = recovery("finalization", "work-product-observation", effectDigest);
}

function submitWorkProduct(replay: Replay, event: ControlRecordEvent): void {
  const payload = exactPayload(event, ["activityId"]);
  const activity = activityFor(replay, payload);
  assertAgentActivity(activity, "agent-work-product-submitted");
  if (activity.providerOutcome !== "completed") {
    fail("order", `Agent activity ${activity.id} cannot submit work without a completed provider effect`);
  }
  assertWorkProductOpen(activity);
  activity.workProduct = retainedReference(
    registerFinalizedSubject(replay, event, "agent-work-product"),
  );
  activity.stage = "submitted";
  activity.recovery = activity.operation === "delivery.continue"
    ? recovery("candidate-observation", "candidate-revision-observed", null)
    : recovery("finalization", "execution-receipt-recorded", null);
}

function abandonWorkProduct(replay: Replay, event: ControlRecordEvent): void {
  const payload = exactPayload(event, ["activityId"]);
  const activity = activityFor(replay, payload);
  assertAgentActivity(activity, "agent-work-product-abandoned");
  assertExactActivitySubject(event, activity.attempt);
  if (activity.providerOutcome === null) fail("order", `Agent activity ${activity.id} has no provider observation`);
  assertWorkProductOpen(activity);
  activity.workProductAbandoned = true;
  activity.stage = "submitted";
  activity.recovery = activity.operation === "delivery.continue"
    ? recovery("candidate-observation", "candidate-revision-observed", null)
    : recovery("finalization", "execution-receipt-recorded", null);
}

function integrationAssessmentFor(replay: Replay, selected: SubjectReference) {
  const revision = replay.resolveRevision({ recordId: selected.id, revision: selected.revision, digest: selected.digest });
  if (revision === null || revision.recordKind !== "integration-assessment" || revision.recordId !== selected.id ||
    revision.revision !== selected.revision || revision.digest !== selected.digest || revision.processId !== replay.processId) {
    fail("reference", "Integration Activity cannot resolve its exact Assessment");
  }
  return parseFoundationIntegrationAssessmentPayloadV1(revision.payload);
}

function assessIntegration(replay: Replay, event: ControlRecordEvent): void {
  const activity = activityFor(replay, exactPayload(event, ["activityId"]));
  if (activity.operation !== "delivery.integrate" || activity.family !== "integration" || activity.stage !== "started" ||
    activity.integrationAssessment !== null || activity.recovery?.resumesAt !== "integration-assessed") {
    fail("order", "Integration Assessment requires its exact new runtime integration Activity");
  }
  const revision = registerFinalizedSubject(replay, event, "integration-assessment");
  assertOnlyRelationships(revision, ["governed-by", "integrates"]);
  assertReference(requiredRelationship(revision, "governed-by", "work-boundary"), replay.subjects.activeBoundary, "Integration governing Boundary");
  assertReference(requiredRelationship(revision, "integrates", "candidate-revision"), replay.subjects.candidate, "Integration source Candidate");
  const assessment = parseFoundationIntegrationAssessmentPayloadV1(revision.payload);
  activity.integrationAssessment = retainedReference(revision);
  replay.subjects.integrationAssessment = activity.integrationAssessment;
  activity.stage = "finalizing";
  activity.recovery = assessment.outcome === "constructed"
    ? recovery("candidate-observation", "candidate-revision-observed", null)
    : recovery("finalization", "activity-completed", null);
}

function observeCandidateRevision(replay: Replay, event: ControlRecordEvent): void {
  const payload = exactPayload(event, ["activityId"]);
  const activity = activityFor(replay, payload);
  if (activity.receipt !== null) {
    fail("order", "Candidate revision observation must precede the terminal Execution Receipt");
  }
  const candidateRevision = registerFinalizedSubject(replay, event, "candidate-revision");
  if (candidateRevision.payload.schema !== "lifecycle.candidate-revision-payload.v3") {
    fail("candidate-payload", "Candidate observation does not retain one exact reconstructible Revision");
  }
  const candidate = retainedReference(candidateRevision);
  assertOnlyRelationships(candidateRevision, ["revises", "governed-by", "result-of", "integrated-from"]);
  const governedBy = requiredRelationship(
    candidateRevision,
    "governed-by",
    "work-boundary",
  );
  const revises = optionalRelationship(
    candidateRevision,
    "revises",
    "candidate-revision",
  );
  const resultOf = optionalRelationship(
    candidateRevision,
    "result-of",
    "agent-attempt",
  );
  if (activity.candidate !== null) fail("duplicate", `Activity ${activity.id} already observed a Candidate revision`);
  const integratedFrom = optionalRelationship(candidateRevision, "integrated-from", "integration-assessment");
  if (activity.operation !== "delivery.integrate" && integratedFrom !== null) fail("reference", "Only explicit integration can bind an Integration Assessment");
  if (activity.operation === "delivery.integrate") {
    if (activity.integrationAssessment === null || activity.recovery?.resumesAt !== "candidate-revision-observed") {
      fail("order", "Candidate integration requires its exact constructed Assessment");
    }
    const assessment = integrationAssessmentFor(replay, activity.integrationAssessment);
    const previous = replay.subjects.candidate;
    assertReference(governedBy, replay.subjects.activeBoundary, "Integration Candidate Boundary");
    assertReference(integratedFrom, activity.integrationAssessment, "Candidate Integration Assessment");
    if (previous === null || candidate.id !== previous.id || candidate.revision !== previous.revision + 1 ||
      revises === null || !sameReference(revises, previous) || resultOf !== null || candidateRevision.payload.observation !== "integration-successor" ||
      candidateRevision.payload.candidateBaseCommit !== assessment.canonicalParent.commit || assessment.outcome !== "constructed") {
      fail("reference", "Integration must advance the exact current Candidate against its assessed parent");
    }
    if (assessment.validation.factsDigest !== foundationIntegratedCandidateFactsDigestV1(candidateRevision)) {
      fail("reference", "Integration Candidate differs from its Assessment's exact constructed observation");
    }
  } else if (activity.operation === "delivery.continue") {
    if (activity.providerOutcome === null) {
      fail("order", "Candidate revision requires the builder provider terminal observation");
    }
    assertReference(governedBy, replay.subjects.activeBoundary, "Candidate boundary");
    const previous = replay.subjects.candidate;
    if (
      previous === null ||
      candidate.id !== previous.id ||
      candidate.revision !== previous.revision + 1 ||
      revises === null ||
      !sameReference(revises, previous)
    ) {
      fail("reference", "Candidate development must advance the exact current Candidate by one revision");
    }
    const predecessor = replay.resolveRevision({ recordId: previous.id, revision: previous.revision, digest: previous.digest });
    if (predecessor === null || candidateRevision.payload.candidateBaseCommit !== predecessor.payload.candidateBaseCommit) {
      fail("reference", "Candidate development must preserve its predecessor's exact application base");
    }
    if (
      candidateRevision.payload.observation !== "builder-successor" ||
      activity.attempt === null ||
      resultOf === null ||
      !sameReference(resultOf, activity.attempt)
    ) {
      fail("reference", "Candidate builder successor must bind the exact creating Agent Attempt");
    }
  } else if (activity.operation === "delivery.admit" && activity.decisionKind === "admit") {
    if (activity.transactionOutcome !== "applied") {
      fail("order", "Candidate initialization requires an observed applied admission transaction");
    }
    assertReference(governedBy, replay.subjects.activeBoundary, "Admission boundary");
    if (
      candidateRevision.payload.observation !== "initialization" ||
      replay.subjects.candidate !== null || candidate.revision !== 1 ||
      revises !== null || resultOf !== null
    ) {
      fail("reference", "Initial admission must initialize revision 1 of one absent Candidate");
    }
  } else if (activity.operation === "delivery.admit" && activity.decisionKind === "readmit") {
    if (activity.transactionOutcome !== "applied") {
      fail("order", "Candidate readmission rebind requires an observed applied transaction");
    }
    assertReference(governedBy, replay.subjects.activeBoundary, "Readmission boundary");
    const previous = replay.subjects.candidate;
    if (
      previous === null ||
      candidate.id !== previous.id ||
      candidate.revision !== previous.revision + 1 ||
      revises === null ||
      !sameReference(revises, previous)
    ) {
      fail(
        "reference",
        "Candidate readmission rebind must advance the exact continuing Candidate by one revision",
      );
    }
    const retainedPrevious = replay.resolveRevision(Object.freeze({
      recordId: previous.id,
      revision: previous.revision,
      digest: previous.digest,
    }));
    if (
      retainedPrevious === null ||
      retainedPrevious.recordKind !== "candidate-revision" ||
      retainedPrevious.recordId !== previous.id ||
      retainedPrevious.revision !== previous.revision ||
      retainedPrevious.digest !== previous.digest
    ) {
      fail("reference", "Candidate readmission rebind cannot resolve its exact predecessor");
    }
    if (
      candidateRevision.payload.observation !== "readmission-rebind" ||
      resultOf !== null ||
      candidateRevision.payload.candidateBaseCommit !==
        retainedPrevious.payload.candidateBaseCommit ||
      canonicalJson(candidateRevision.payload.state ?? null) !==
        canonicalJson(retainedPrevious.payload.state ?? null) ||
      canonicalJson(candidateRevision.payload.carrierManifest ?? null) !==
        canonicalJson(retainedPrevious.payload.carrierManifest ?? null)
    ) {
      fail(
        "record-payload",
        "Candidate readmission rebind must retain byte-identical state, Carrier, and immutable base",
      );
    }
  } else {
    fail("activity", `${activity.operation} cannot observe a Candidate revision at this boundary`);
  }
  if (candidateRevision.payload.observation === "initialization") replay.candidateIntegrated = false;
  if (candidateRevision.payload.observation === "integration-successor") replay.candidateIntegrated = true;
  activity.candidate = candidate;
  replay.subjects.candidate = candidate;
  replay.subjects.seal = null;
  replay.subjects.evidence = null;
  replay.evidenceReadiness = null;
  activity.stage = "finalizing";
  activity.recovery = activity.operation === "delivery.continue"
    ? recovery("finalization", "execution-receipt-recorded", null)
    : activity.operation === "delivery.integrate" && activity.integrationAssessment !== null &&
      integrationAssessmentFor(replay, activity.integrationAssessment).contextualApplicability.disposition === "requires-readmission"
      ? recovery("finalization", "activity-finalization", null)
      : recovery("finalization", "activity-completed", null);
}

function recordReceipt(replay: Replay, event: ControlRecordEvent): void {
  const payload = exactPayload(event, ["activityId"]);
  const activity = activityFor(replay, payload);
  assertAgentActivity(activity, "execution-receipt-recorded");
  assertCoreAgentTerminal(activity);
  if (activity.receipt !== null) fail("duplicate", `Agent activity ${activity.id} already has an execution Receipt`);
  activity.receipt = retainedReference(
    registerFinalizedSubject(replay, event, "execution-receipt"),
  );
  activity.stage = "finalizing";
  if (activity.workProduct === null) {
    activity.recovery = recovery("finalization", "activity-completed", null);
  } else if (
    activity.operation === "delivery.prepare" ||
    activity.operation === "delivery.revise" ||
    activity.operation === "delivery.reaffirm"
  ) {
    activity.recovery = recovery("finalization", "work-boundary-finalized", null);
  } else {
    activity.recovery = recovery("finalization", "activity-finalization", null);
  }
}

function finalizeBoundary(replay: Replay, event: ControlRecordEvent): void {
  const payload = exactPayload(event, ["activityId"]);
  const activity = activityFor(replay, payload);
  assertAgentActivity(activity, "work-boundary-finalized");
  assertCoreAgentTerminal(activity);
  if (activity.workProduct === null) fail("order", "A Work Boundary requires submitted reconnaissance semantics");
  if (activity.receipt === null) {
    fail("order", "A Work Boundary must follow the truthful terminal Execution Receipt");
  }
  if (activity.boundary !== null) fail("duplicate", `Activity ${activity.id} already finalized a Work Boundary`);
  const proposalKind = activity.operation === "delivery.prepare"
    ? "initial"
    : activity.operation === "delivery.revise"
      ? "revision"
      : activity.operation === "delivery.reaffirm"
        ? "reaffirmation"
        : null;
  if (proposalKind === null) fail("activity", `${activity.operation} cannot finalize a Work Boundary`);
  const boundaryRevision = registerFinalizedSubject(replay, event, "work-boundary");
  const boundary = retainedReference(boundaryRevision);
  assertOnlyRelationships(boundaryRevision, ["uses-brief", "proposed-from", "revises", "resolves"]);
  assertReference(
    requiredRelationship(boundaryRevision, "uses-brief", "director-brief"),
    activity.brief,
    "Work Boundary Director Brief",
  );
  assertReference(
    requiredRelationship(boundaryRevision, "proposed-from", "agent-work-product"),
    activity.workProduct,
    "Work Boundary Work Product",
  );
  const revises = optionalRelationship(boundaryRevision, "revises", "work-boundary");
  const resolves = optionalRelationship(boundaryRevision, "resolves", "material-condition");
  if (proposalKind === "initial") {
    if (boundary.revision !== 1) fail("reference", "An initial Work Boundary must begin at revision 1");
    assertAbsentRelationship(revises, "Initial Work Boundary predecessor");
    assertAbsentRelationship(resolves, "Initial Work Boundary Condition resolution");
  } else {
    const active = replay.subjects.activeBoundary;
    if (active === null || boundary.id !== active.id || boundary.revision !== active.revision + 1) {
      fail("reference", "A resolved Work Boundary must advance the active boundary by one revision");
    }
    if (replay.subjects.materialCondition === null) {
      fail("order", "A resolved Work Boundary requires the retained Material Condition");
    }
    assertReference(revises, active, "Resolved Work Boundary predecessor");
    assertReference(resolves, replay.subjects.materialCondition, "Resolved Work Boundary Condition");
  }
  activity.boundary = boundary;
  activity.stage = "finalizing";
  activity.recovery = recovery("finalization", "baseline-checks", null);
}

function freezeMaterialCondition(replay: Replay, event: ControlRecordEvent): void {
  const payload = exactPayload(event, ["sourceKind", "activityId", "observedFactsDigest"]);
  const sourceKind = enumField(payload, "sourceKind", ["agent-proposal", "integration-assessment", "projection-compilation"] as const);
  const observedFactsDigest = digestField(payload, "observedFactsDigest");
  const conditionRevision = registerFinalizedSubject(replay, event, "material-condition");
  if (conditionRevision.payload.observedFactsDigest !== observedFactsDigest) {
    fail("reference", "Material Condition event does not bind its exact observed-facts digest");
  }
  const source = recordObject(conditionRevision.payload.source, "Material Condition source");
  if (source.kind !== sourceKind) {
    fail("record-payload", "Material Condition event and payload source kinds disagree");
  }
  if (replay.subjects.materialCondition !== null) {
    fail("duplicate", "Delivery already retains an unresolved Material Condition");
  }
  const condition = retainedReference(conditionRevision);

  const activityId = field(payload, "activityId");
  if (typeof activityId !== "string") {
    fail("payload", "Agent-proposed Material Condition requires one exact activity identity");
  }
  const activity = activityFor(replay, Object.freeze({ activityId }));
  if (sourceKind === "integration-assessment") {
    if (activity.operation !== "delivery.integrate" || activity.family !== "integration" || activity.candidate === null ||
      activity.integrationAssessment === null || activity.materialCondition !== null || activity.recovery?.resumesAt !== "activity-finalization") {
      fail("order", "Integration Condition requires the exact constructed successor before finalization");
    }
    const assessment = integrationAssessmentFor(replay, activity.integrationAssessment);
    if (assessment.contextualApplicability.disposition !== "requires-readmission" ||
      observedFactsDigest !== digestCanonical(assessment.contextualApplicability) ||
      conditionRevision.payload.conditionClass !== "integration-context-change") {
      fail("record-payload", "Integration Condition must reproduce the exact contextual change observation");
    }
    assertOnlyRelationships(conditionRevision, ["reported-by", "freezes", "governed-by"]);
    assertReference(requiredRelationship(conditionRevision, "reported-by", "integration-assessment"), activity.integrationAssessment, "Integration Condition source");
    assertReference(requiredRelationship(conditionRevision, "freezes", "candidate-revision"), activity.candidate, "Integration frozen Candidate");
    assertReference(requiredRelationship(conditionRevision, "governed-by", "work-boundary"), replay.subjects.activeBoundary, "Integration Condition Boundary");
    activity.materialCondition = condition;
    replay.subjects.materialCondition = condition;
    activity.stage = "finalizing";
    activity.recovery = recovery("finalization", "activity-completed", null);
    return;
  }
  if (sourceKind === "projection-compilation") {
    const refusal = activity.preIntentRefusal;
    if ((activity.operation !== "delivery.evaluate" && activity.operation !== "delivery.continue") || activity.family !== "agent" ||
        activity.stage !== "finalizing" || activity.recovery?.resumesAt !== "activity-finalization" ||
        activity.attempt !== null || activity.providerEffectDigest !== null || activity.providerOutcome !== null ||
        activity.workProduct !== null || activity.workProductAbandoned || activity.receipt !== null ||
        activity.materialCondition !== null || refusal === null ||
        refusal.payload.resolution !== "projection-condition-required" ||
        refusal.payload.diagnosticCode !== "lifecycle.projection.mandatory-too-large" ||
        source.refusalFactsDigest !== refusal.payload.refusalFactsDigest ||
        conditionRevision.payload.conditionClass !== "projection-closure-exceeded") {
      fail("order", "Projection Condition requires the exact measured pre-intent builder or reviewer refusal");
    }
    const boundary = replay.subjects.activeBoundary;
    const candidate = replay.subjects.candidate;
    const seal = activity.operation === "delivery.evaluate" ? activity.seal : null;
    if (boundary === null || candidate === null || (activity.operation === "delivery.evaluate" && seal === null)) {
      fail("reference", "Projection Condition requires the exact governing Boundary, Candidate, and any evaluation Seal");
    }
    assertOnlyRelationships(conditionRevision, seal === null ? ["freezes", "governed-by"] : ["freezes", "governed-by", "observed-in"]);
    const boundaryRef = requiredRelationship(conditionRevision, "governed-by", "work-boundary");
    const candidateRef = requiredRelationship(conditionRevision, "freezes", "candidate-revision");
    const sealRef = seal === null ? null : requiredRelationship(conditionRevision, "observed-in", "candidate-seal");
    assertReference(boundaryRef, boundary, "Projection Condition Boundary");
    assertReference(candidateRef, candidate, "Projection frozen Candidate");
    if (sealRef !== null) assertReference(sealRef, seal, "Projection Condition Seal");
    if (observedFactsDigest !== foundationProjectionConditionObservedFactsDigestV1({
      activityId, boundary: { kind: "work-boundary", ...boundaryRef },
      candidate: { kind: "candidate-revision", ...candidateRef }, seal: sealRef === null ? null : { kind: "candidate-seal", ...sealRef },
      refusalEvent: { sequence: refusal.sequence, digest: refusal.digest }, source,
    })) {
      fail("record-payload", "Projection Condition must reproduce exact refusal provenance and subject bindings");
    }
    activity.materialCondition = condition;
    replay.subjects.materialCondition = condition;
    activity.stage = "finalizing";
    activity.recovery = recovery("finalization", "activity-completed", null);
    return;
  }
  assertAgentActivity(activity, "material-condition-frozen");
  assertCoreAgentTerminal(activity);
  if (!(activity.operation === "delivery.continue" || activity.operation === "delivery.evaluate")) {
    fail("activity", `${activity.operation} cannot freeze a Material Condition`);
  }
  if (
    activity.workProduct === null || activity.receipt === null ||
    replay.subjects.candidate === null || replay.subjects.activeBoundary === null
  ) {
    fail(
      "order",
      "Material Condition requires submitted semantics, its Execution Receipt, and the exact governed Candidate",
    );
  }
  if (activity.materialCondition !== null) {
    fail("duplicate", "Activity already retains a Material Condition");
  }
  assertOnlyRelationships(conditionRevision, ["reported-by", "observed-in", "freezes", "governed-by"]);
  activity.materialCondition = condition;
  replay.subjects.materialCondition = condition;
  activity.stage = "finalizing";
  activity.recovery = recovery(
    "finalization",
    activity.operation === "delivery.evaluate" ? "activity-finalization" : "activity-completed",
    null,
  );
}

function sealCandidate(replay: Replay, event: ControlRecordEvent): void {
  const payload = exactPayload(event, ["activityId"]);
  const activity = activityFor(replay, payload);
  if (activity.operation !== "delivery.evaluate") fail("activity", "Only evaluation can seal the Candidate");
  if (activity.seal !== null) fail("duplicate", `Evaluation ${activity.id} already sealed its Candidate`);
  if (
    activity.stage !== "started" || activity.attempt !== null || activity.checks.length !== 0 ||
    activity.recovery?.kind !== "finalization" || activity.recovery.resumesAt !== "candidate-sealed"
  ) {
    fail("order", "Evaluation must seal the exact current Candidate before Checks or reviewer execution");
  }
  const sealRevision = registerFinalizedSubject(replay, event, "candidate-seal");
  assertOnlyRelationships(sealRevision, ["seals", "governed-by"]);
  assertReference(
    requiredRelationship(sealRevision, "seals", "candidate-revision"),
    replay.subjects.candidate,
    "Candidate Seal",
  );
  assertReference(
    requiredRelationship(sealRevision, "governed-by", "work-boundary"),
    replay.subjects.activeBoundary,
    "Candidate Seal boundary",
  );
  const seal = retainedReference(sealRevision);
  activity.seal = seal;
  replay.subjects.seal = seal;
  replay.subjects.evidence = null;
  replay.evidenceReadiness = null;
  activity.stage = "finalizing";
  activity.recovery = recovery("finalization", "evaluation-checks", null);
}

function recordCheckReceipt(replay: Replay, event: ControlRecordEvent): void {
  const payload = exactPayload(event, ["activityId"]);
  const activity = activityFor(replay, payload);
  assertAgentActivity(activity, "check-receipt-recorded");
  const checkRevision = registerFinalizedSubject(replay, event, "check-receipt");
  assertOnlyRelationships(checkRevision, ["checks-boundary", "checks-seal"]);
  const checksBoundary = optionalRelationship(
    checkRevision,
    "checks-boundary",
    "work-boundary",
  );
  const checksSeal = optionalRelationship(
    checkRevision,
    "checks-seal",
    "candidate-seal",
  );
  const phase = recordEnumField(checkRevision, "phase", ["baseline", "final"] as const);
  const selectionId = recordIdentifierField(checkRevision, "selectionId");
  const modality = recordEnumField(
    checkRevision,
    "modality",
    ["precondition", "repair-target", "regression-guard", "postcondition", "diagnostic"] as const,
  );
  if (activity.operation === "delivery.evaluate") {
    if (phase !== "final") {
      fail("record-payload", "Evaluation Check Receipt must have final phase");
    }
    if (checksBoundary !== null) {
      fail("record-relationship", "A final Check Receipt cannot also check a Work Boundary");
    }
    assertReference(checksSeal, activity.seal, "Check Receipt seal");
    if (activity.attempt !== null) {
      fail("order", "Evaluation Checks must complete before the reviewer Attempt is prepared");
    }
    const requiredSelections = finalSelectionIds(replay, activity);
    if (!requiredSelections.has(selectionId)) {
      fail(
        "final-selection",
        `Final Check Receipt selects ${selectionId}, which is not final-required by the exact Work Boundary`,
      );
    }
    if (activity.checks.some((check) =>
      check.phase === "final" && check.selectionId === selectionId)) {
      fail(
        "duplicate",
        `Activity ${activity.id} already retained the final Check Receipt for ${selectionId}`,
      );
    }
  } else {
    if (
      activity.operation !== "delivery.prepare" &&
      activity.operation !== "delivery.revise" &&
      activity.operation !== "delivery.reaffirm"
    ) {
      fail("activity", "Only boundary preparation can retain baseline Check Receipts");
    }
    if (phase !== "baseline") {
      fail("record-payload", "Work Boundary Check Receipt must have baseline phase");
    }
    if (checksSeal !== null) {
      fail("record-relationship", "A baseline Check Receipt cannot also check a Candidate Seal");
    }
    assertReference(checksBoundary, activity.boundary, "Check Receipt boundary");
    const requiredSelections = baselineSelectionIds(replay, activity);
    if (!requiredSelections.has(selectionId)) {
      fail(
        "baseline-selection",
        `Baseline Check Receipt selects ${selectionId}, which is not baseline-required by the exact Work Boundary`,
      );
    }
    if (activity.checks.some((check) =>
      check.phase === "baseline" && check.selectionId === selectionId)) {
      fail(
        "duplicate",
        `Activity ${activity.id} already retained the baseline Check Receipt for ${selectionId}`,
      );
    }
  }
  const check = retainedReference(checkRevision);
  activity.checks.push(Object.freeze({
    reference: check,
    selectionId,
    phase,
    modality,
    disposition: recordEnumField(
      checkRevision,
      "disposition",
      ["pass", "fail", "indeterminate", "not-run", "unsupported", "operational-error"] as const,
    ),
  }));
  if (activity.operation === "delivery.evaluate") {
    activity.recovery = recovery("finalization", "evaluation-checks", null);
  } else {
    const requiredSelections = baselineSelectionIds(replay, activity);
    const receivedSelections = new Set(
      activity.checks
        .filter(({ phase: retainedPhase }) => retainedPhase === "baseline")
        .map(({ selectionId: retainedSelectionId }) => retainedSelectionId),
    );
    activity.recovery = recovery(
      "finalization",
      [...requiredSelections].every((required) => receivedSelections.has(required))
        ? "activity-completed"
        : "baseline-checks",
      null,
    );
  }
}

function finalizeEvidence(replay: Replay, event: ControlRecordEvent): void {
  const payload = exactPayload(event, ["activityId"]);
  const activity = activityFor(replay, payload);
  if (activity.operation !== "delivery.evaluate") fail("activity", "Only evaluation can finalize Evidence");
  assertCoreAgentTerminal(activity);
  if (activity.workProduct === null || activity.receipt === null || activity.seal === null) {
    fail("order", "Evidence requires a Seal, independent review, and its execution Receipt");
  }
  if (activity.checks.length === 0) fail("order", "Evidence requires at least one exact-subject Check Receipt");
  if (activity.evidence !== null) fail("duplicate", `Evaluation ${activity.id} already finalized Evidence`);
  const evidenceRevision = registerFinalizedSubject(replay, event, "evidence-packet");
  assertOnlyRelationships(evidenceRevision, [
    "governed-by",
    "evaluates",
    "uses-seal",
    "uses-check",
    "uses-review",
    "uses-review-receipt",
  ]);
  assertReference(
    requiredRelationship(evidenceRevision, "governed-by", "work-boundary"),
    replay.subjects.activeBoundary,
    "Evidence Packet boundary",
  );
  assertReference(
    requiredRelationship(evidenceRevision, "evaluates", "candidate-revision"),
    replay.subjects.candidate,
    "Evidence Packet Candidate",
  );
  assertReference(
    requiredRelationship(evidenceRevision, "uses-seal", "candidate-seal"),
    activity.seal,
    "Evidence Packet seal",
  );
  assertReference(
    requiredRelationship(evidenceRevision, "uses-review", "agent-work-product"),
    activity.workProduct,
    "Evidence Packet review",
  );
  assertReference(
    requiredRelationship(evidenceRevision, "uses-review-receipt", "execution-receipt"),
    activity.receipt,
    "Evidence Packet review Receipt",
  );
  const retainedChecks = relationshipReferences(
    evidenceRevision,
    "uses-check",
    "check-receipt",
  );
  const expectedCheckFacts = [
    ...baselineChecksForBoundary(replay, replay.subjects.activeBoundary),
    ...activity.checks,
  ];
  const expectedChecks = new Set(expectedCheckFacts.map(({ reference: check }) =>
    `${check.id}\u0000${check.revision}\u0000${check.digest}`));
  if (
    retainedChecks.length !== expectedChecks.size ||
    retainedChecks.some((check) =>
      !expectedChecks.has(`${check.id}\u0000${check.revision}\u0000${check.digest}`))
  ) {
    fail("record-relationship", "Evidence Packet must bind the complete exact Check Receipt set");
  }
  const readiness = recordEnumField(
    evidenceRevision,
    "readiness",
    ["acceptance-ready", "correctable", "revision-required", "no-ship-recommended"] as const,
  );
  if (
    readiness === "acceptance-ready" &&
    expectedCheckFacts.some((check) =>
      check.phase === "baseline" ? !legalBaselineReceipt(check) : !legalAcceptanceReceipt(check))
  ) {
    fail("evidence", "Acceptance-ready Evidence cannot retain a Check disposition illegal for its phase and modality");
  }
  if (readiness === "revision-required" && replay.subjects.materialCondition === null) {
    fail("evidence", "Revision-required Evidence must bind a retained Material Condition");
  }
  const evidence = retainedReference(evidenceRevision);
  activity.evidence = evidence;
  activity.evidenceReadiness = readiness;
  replay.subjects.evidence = evidence;
  replay.evidenceReadiness = readiness;
  activity.stage = "finalizing";
  activity.recovery = recovery("finalization", "activity-completed", null);
}

function authenticateDecision(replay: Replay, event: ControlRecordEvent): void {
  const payload = exactPayload(event, ["activityId"]);
  const activity = activityFor(replay, payload);
  assertTransactionActivity(activity, "director-decision-authenticated");
  if (activity.decision !== null) fail("duplicate", `Transaction activity ${activity.id} already has a Director Decision`);
  const expectedDecision: DirectorDecision = activity.operation === "delivery.admit"
    ? activity.originStanding === "awaiting-readmission" ? "readmit" : "admit"
    : activity.operation === "delivery.accept" ? "accept" : "no-ship";
  const decisionRevision = registerFinalizedSubject(replay, event, "director-decision");
  const decision = recordEnumField(
    decisionRevision,
    "decision",
    ["admit", "readmit", "accept", "no-ship"] as const,
  );
  if (decision !== expectedDecision) {
    fail("authority", `${activity.operation} requires a ${expectedDecision} Director Decision`);
  }
  assertOnlyRelationships(decisionRevision, [
    "selects-boundary",
    "selects-baseline-receipt",
    "continues-from-boundary",
    "resolves",
    "selects-candidate",
    "selects-seal",
    "selects-evidence",
  ]);
  const selectsBoundary = optionalRelationship(
    decisionRevision,
    "selects-boundary",
    "work-boundary",
  );
  const resolves = optionalRelationship(
    decisionRevision,
    "resolves",
    "material-condition",
  );
  const selectsCandidate = optionalRelationship(
    decisionRevision,
    "selects-candidate",
    "candidate-revision",
  );
  const selectsSeal = optionalRelationship(
    decisionRevision,
    "selects-seal",
    "candidate-seal",
  );
  const selectsEvidence = optionalRelationship(
    decisionRevision,
    "selects-evidence",
    "evidence-packet",
  );
  const continuesFromBoundary = optionalRelationship(
    decisionRevision,
    "continues-from-boundary",
    "work-boundary",
  );
  const selectedBaselineReceipts = relationshipReferences(
    decisionRevision,
    "selects-baseline-receipt",
    "check-receipt",
  );
  if (decision === "admit" || decision === "readmit") {
    assertReference(selectsBoundary, replay.subjects.proposedBoundary, "Director-selected Work Boundary");
    const expectedBaselineReceipts = baselineChecksForBoundary(
      replay,
      replay.subjects.proposedBoundary,
    ).map(({ reference: referenceValue }) => referenceValue);
    const expectedBaselineKeys = new Set(expectedBaselineReceipts.map((referenceValue) =>
      `${referenceValue.id}\u0000${referenceValue.revision}\u0000${referenceValue.digest}`));
    if (
      selectedBaselineReceipts.length !== expectedBaselineKeys.size ||
      selectedBaselineReceipts.some((referenceValue) =>
        !expectedBaselineKeys.has(
          `${referenceValue.id}\u0000${referenceValue.revision}\u0000${referenceValue.digest}`,
        ))
    ) {
      fail(
        "authority",
        "Director admission must select every and only complete baseline Check Receipt",
      );
    }
    if (decision === "readmit") {
      assertReference(
        continuesFromBoundary,
        replay.subjects.activeBoundary,
        "Director-selected predecessor Work Boundary",
      );
      assertReference(resolves, replay.subjects.materialCondition, "Director-resolved Material Condition");
      assertReference(selectsCandidate, replay.subjects.candidate, "Director-selected continuing Candidate");
    } else {
      assertAbsentRelationship(continuesFromBoundary, "Initial admission predecessor Boundary selection");
      assertAbsentRelationship(resolves, "Admission Condition resolution");
      assertAbsentRelationship(selectsCandidate, "Initial admission Candidate selection");
    }
    assertAbsentRelationship(selectsSeal, "Admission Seal selection");
    assertAbsentRelationship(selectsEvidence, "Admission Evidence selection");
  } else if (decision === "accept") {
    if (selectedBaselineReceipts.length !== 0) {
      fail("record-relationship", "Acceptance cannot select baseline Check Receipts");
    }
    assertAbsentRelationship(continuesFromBoundary, "Acceptance predecessor Boundary selection");
    assertReference(selectsBoundary, replay.subjects.activeBoundary, "Director-selected active Work Boundary");
    assertAbsentRelationship(resolves, "Acceptance Condition resolution");
    assertReference(selectsCandidate, replay.subjects.candidate, "Director-selected Candidate");
    assertReference(selectsSeal, replay.subjects.seal, "Director-selected Candidate Seal");
    assertReference(selectsEvidence, replay.subjects.evidence, "Director-selected Evidence Packet");
  } else {
    if (selectedBaselineReceipts.length !== 0) {
      fail("record-relationship", "No-ship cannot select baseline Check Receipts");
    }
    assertAbsentRelationship(continuesFromBoundary, "No-ship predecessor Boundary selection");
    const boundary = currentEstablishedBoundary(replay);
    if (boundary === null) {
      assertAbsentRelationship(selectsBoundary, "No-ship Work Boundary selection");
    } else {
      assertReference(selectsBoundary, boundary, "Director-selected current Work Boundary");
    }
    if (replay.subjects.materialCondition === null) {
      assertAbsentRelationship(resolves, "No-ship Condition resolution");
    } else {
      assertReference(resolves, replay.subjects.materialCondition, "Director-resolved Material Condition");
    }
    if (replay.subjects.candidate === null) {
      assertAbsentRelationship(selectsCandidate, "No-ship Candidate selection");
    } else {
      assertReference(selectsCandidate, replay.subjects.candidate, "Director-selected Candidate");
    }
    assertAbsentRelationship(selectsSeal, "No-ship Seal selection");
    assertAbsentRelationship(selectsEvidence, "No-ship Evidence selection");
  }
  activity.decision = retainedReference(decisionRevision);
  activity.decisionKind = decision;
  activity.recovery = recovery("finalization", "transaction-effect-intended", null);
}

function intendTransactionEffect(replay: Replay, event: ControlRecordEvent): void {
  const payload = exactPayload(event, ["activityId", "effectDigest"]);
  const activity = activityFor(replay, payload);
  assertTransactionActivity(activity, "transaction-effect-intended");
  assertExactActivitySubject(event, activity.decision);
  if (activity.decision === null || activity.transactionEffectDigest !== null) {
    fail("order", `Transaction activity ${activity.id} is not ready for one effect intent`);
  }
  const effectDigest = digestField(payload, "effectDigest");
  activity.transactionEffectDigest = effectDigest;
  activity.stage = "effect-intended";
  activity.recovery = recovery("transaction", "transaction-effect-observed", effectDigest);
}

function observeTransactionEffect(replay: Replay, event: ControlRecordEvent): void {
  const payload = exactPayload(event, [
    "activityId", "effectDigest", "facts", "factsDigest", "outcome",
  ]);
  const activity = activityFor(replay, payload);
  assertTransactionActivity(activity, "transaction-effect-observed");
  assertExactActivitySubject(event, activity.decision);
  const effectDigest = digestField(payload, "effectDigest");
  if (activity.transactionEffectDigest === null || activity.transactionEffectDigest !== effectDigest) {
    fail("reference", `Transaction observation does not bind the exact effect for activity ${activity.id}`);
  }
  if (activity.transactionOutcome !== null) {
    fail("duplicate", `Transaction activity ${activity.id} already observed its effect`);
  }
  const outcome = enumField(payload, "outcome", ["applied", "not-applied", "indeterminate"] as const);
  if (activity.decisionKind === null) {
    fail("order", `Transaction activity ${activity.id} has no exact Director Decision kind`);
  }
  assertFoundationTransactionObservationFactsV7({
    operation: activity.operation,
    decisionKind: activity.decisionKind,
    outcome,
    facts: payload.facts,
    factsDigest: payload.factsDigest,
  });
  if (outcome === "indeterminate") {
    activity.stage = "effect-intended";
    activity.recovery = recovery("transaction", "transaction-effect-observed", effectDigest);
    return;
  }
  activity.transactionOutcome = outcome;
  activity.stage = "effect-observed";
  activity.recovery = outcome === "not-applied"
    ? recovery("finalization", "activity-completed", null)
    : activity.operation === "delivery.admit"
      ? recovery("candidate-observation", "candidate-revision-observed", null)
      : recovery("finalization", "transaction-finalization", null);
  if (outcome === "applied" && activity.operation === "delivery.admit") {
    if (replay.subjects.proposedBoundary === null) {
      fail("order", "Applied admission requires the exact proposed Work Boundary");
    }
    if (activity.decisionKind === "readmit" && replay.subjects.candidate === null) {
      fail("order", "Readmission requires the exact continuing Candidate");
    }
    replay.subjects.activeBoundary = replay.subjects.proposedBoundary;
    replay.activeAdmission = clonedReference(activity.decision);
    replay.subjects.proposedBoundary = null;
    replay.subjects.materialCondition = null;
    replay.subjects.seal = null;
    replay.subjects.evidence = null;
    replay.evidenceReadiness = null;
  }
}

function recordClosure(replay: Replay, event: ControlRecordEvent): void {
  const payload = exactPayload(event, ["activityId"]);
  const activity = activityFor(replay, payload);
  assertTransactionActivity(activity, "closure-recorded");
  if (!(activity.operation === "delivery.accept" || activity.operation === "delivery.no-ship")) {
    fail("activity", `${activity.operation} cannot close Delivery`);
  }
  if (activity.transactionOutcome !== "applied") {
    fail("order", "Closure requires an observed applied terminal transaction");
  }
  if (replay.subjects.closure !== null || activity.closure !== null) {
    fail("duplicate", "Delivery already has a terminal Closure");
  }
  const closureRevision = registerFinalizedSubject(replay, event, "closure");
  const disposition = recordEnumField(
    closureRevision,
    "disposition",
    ["accepted", "no-ship"] as const,
  );
  const expectedDisposition = activity.operation === "delivery.accept" ? "accepted" : "no-ship";
  if (disposition !== expectedDisposition) {
    fail("authority", `${activity.operation} cannot record ${disposition} Closure`);
  }
  const candidateTreatment = recordEnumField(
    closureRevision,
    "candidateTreatment",
    ["integrated", "abandoned", "not-created"] as const,
  );
  const terminalExecutions = recordObject(
    closureRevision.payload.terminalExecutions,
    "Closure terminal executions",
  );
  const containment = recordObject(
    terminalExecutions.containment,
    "Closure Execution Containment",
  );
  const retirement = recordObject(
    terminalExecutions.retirement,
    "Closure Execution Retirement",
  );
  if (containment.classification !== "complete" || retirement.classification !== "complete") {
    fail("order", "Closure requires complete Execution Containment and Retirement");
  }
  assertOnlyRelationships(closureRevision, [
    "closes-with",
    "governed-by",
    "accepts-candidate",
    "accepts-evidence",
    "abandons-candidate",
  ]);
  assertReference(
    requiredRelationship(closureRevision, "closes-with", "director-decision"),
    activity.decision,
    "Closure Director Decision",
  );
  const governedBy = optionalRelationship(
    closureRevision,
    "governed-by",
    "work-boundary",
  );
  const expectedBoundary = disposition === "accepted"
    ? replay.subjects.activeBoundary
    : currentEstablishedBoundary(replay);
  if (expectedBoundary === null) {
    assertAbsentRelationship(governedBy, "Closure Work Boundary");
  } else {
    assertReference(governedBy, expectedBoundary, "Closure Work Boundary");
  }
  const acceptsCandidate = optionalRelationship(
    closureRevision,
    "accepts-candidate",
    "candidate-revision",
  );
  const acceptsEvidence = optionalRelationship(
    closureRevision,
    "accepts-evidence",
    "evidence-packet",
  );
  const abandonsCandidate = optionalRelationship(
    closureRevision,
    "abandons-candidate",
    "candidate-revision",
  );
  if (disposition === "accepted") {
    if (candidateTreatment !== "integrated") {
      fail("order", "Acceptance Closure must integrate its exact Candidate");
    }
    assertReference(acceptsCandidate, replay.subjects.candidate, "Closure accepted Candidate");
    assertReference(acceptsEvidence, replay.subjects.evidence, "Closure accepted Evidence");
    assertAbsentRelationship(abandonsCandidate, "Acceptance Candidate abandonment");
  } else {
    assertAbsentRelationship(acceptsCandidate, "No-ship accepted Candidate");
    assertAbsentRelationship(acceptsEvidence, "No-ship accepted Evidence");
    if (replay.subjects.candidate === null) {
      if (candidateTreatment !== "not-created") {
        fail("order", "No-ship without a Candidate must record not-created treatment");
      }
      assertAbsentRelationship(abandonsCandidate, "No-ship Candidate abandonment");
    } else {
      if (candidateTreatment !== "abandoned") {
        fail("order", "No-ship with a Candidate must record abandonment");
      }
      assertReference(abandonsCandidate, replay.subjects.candidate, "Closure abandoned Candidate");
    }
  }
  const closure = retainedReference(closureRevision);
  activity.closure = closure;
  replay.subjects.closure = closure;
  replay.closureDisposition = disposition;
  activity.completionOutcome = "completed";
  activity.stage = "completed";
  activity.recovery = null;
}

function completeActivity(replay: Replay, event: ControlRecordEvent): void {
  const payload = exactPayload(event, ["activityId", "outcome"]);
  const activity = activityFor(replay, payload);
  const outcome = enumField(payload, "outcome", ["completed", "failed", "abandoned"] as const);
  const terminalNotAppliedFailure =
    (activity.operation === "delivery.accept" || activity.operation === "delivery.no-ship") &&
    outcome === "failed" &&
    activity.transactionEffectDigest !== null &&
    activity.transactionOutcome === "not-applied" &&
    activity.recovery?.kind === "finalization" &&
    activity.recovery.resumesAt === "activity-completed" &&
    activity.recovery.exactEffectDigest === null;
  const deterministicBoundaryRefusal = outcome !== "completed" &&
    activity.family === "agent" &&
    (
      activity.operation === "delivery.prepare" ||
      activity.operation === "delivery.revise" ||
      activity.operation === "delivery.reaffirm"
    ) &&
    activity.recovery?.kind === "finalization" &&
    activity.recovery.resumesAt === "work-boundary-finalized" &&
    activity.recovery.exactEffectDigest === null;
  const preIntentRefusal = outcome === "abandoned" &&
    activity.family === "agent" && activity.stage === "finalizing" &&
    activity.attempt === null && activity.providerEffectDigest === null &&
    activity.providerOutcome === null && activity.workProduct === null &&
    !activity.workProductAbandoned && activity.receipt === null &&
    activity.recovery?.kind === "finalization" &&
    activity.recovery.resumesAt === "activity-completed" &&
    activity.recovery.exactEffectDigest === null;
  let directContinueFinalization = false;
  if (
    activity.operation === "delivery.continue" && activity.workProduct !== null &&
    activity.recovery?.kind === "finalization" &&
    activity.recovery.resumesAt === "activity-finalization" &&
    activity.recovery.exactEffectDigest === null && replay.processId !== null
  ) {
    const workProduct = replay.resolveRevision(Object.freeze({
      recordId: activity.workProduct.id,
      revision: activity.workProduct.revision,
      digest: activity.workProduct.digest,
    }));
    if (
      workProduct === null || workProduct.processId !== replay.processId ||
      workProduct.recordKind !== "agent-work-product" ||
      workProduct.recordId !== activity.workProduct.id ||
      workProduct.revision !== activity.workProduct.revision ||
      workProduct.digest !== activity.workProduct.digest
    ) {
      fail("reference", "Continue finalization cannot resolve the exact Agent Work Product");
    }
    const semantics = recordObject(workProduct.payload.roleSemantics, "Builder role semantics");
    if (semantics.role !== "builder") {
      fail("record-payload", "Continue finalization requires builder role semantics");
    }
    directContinueFinalization = semantics.proposal !== "material-condition";
  }
  if (!deterministicBoundaryRefusal && !directContinueFinalization && (
    activity.recovery?.kind !== "finalization" ||
    activity.recovery.resumesAt !== "activity-completed" ||
    activity.recovery.exactEffectDigest !== null
  )) {
    fail(
      "order",
      `Activity ${activity.id} cannot complete before its exact reducer-derived finalization coordinate`,
    );
  }
  if (activity.family === "agent") {
    if (!preIntentRefusal) {
      assertCoreAgentTerminal(activity);
      if (activity.receipt === null) fail("order", `Agent activity ${activity.id} requires its execution Receipt`);
    }
    if (outcome === "completed") {
      if (activity.workProduct === null) fail("order", `Completed agent activity ${activity.id} requires submitted work`);
      switch (activity.operation) {
        case "delivery.prepare":
        case "delivery.revise":
        case "delivery.reaffirm":
          if (activity.boundary === null) fail("order", `${activity.operation} requires a finalized Work Boundary`);
          if (activity.checks.length === 0 || activity.checks.some((check) => !legalBaselineReceipt(check))) {
            fail(
              "order",
              `${activity.operation} requires legal baseline Check Receipts for its selected modalities`,
            );
          }
          replay.subjects.proposedBoundary = activity.boundary;
          break;
        case "delivery.continue":
          break;
        case "delivery.evaluate":
          if (activity.evidence === null) fail("order", "Completed evaluation requires a finalized Evidence Packet");
          break;
        default:
          fail("activity", `${activity.operation} is not an agent activity`);
      }
    }
  } else if (activity.family === "integration") {
    if (activity.integrationAssessment === null || outcome !== "completed") fail("order", "Integration completion requires a retained completed assessment");
    const assessment = integrationAssessmentFor(replay, activity.integrationAssessment);
    if ((assessment.outcome === "constructed") !== (activity.candidate !== null)) fail("order", "Only a constructed integration completes with a Candidate successor");
    if (assessment.outcome === "constructed" && assessment.contextualApplicability.disposition === "requires-readmission" && activity.materialCondition === null) {
      fail("order", "Integration context changes must freeze the constructed Candidate before completion");
    }
  } else {
    if (
      (activity.operation === "delivery.accept" || activity.operation === "delivery.no-ship") &&
      !terminalNotAppliedFailure
    ) {
      fail("order", `${activity.operation} is completed atomically by terminal Closure`);
    }
    if (activity.transactionOutcome === null || activity.transactionOutcome === "indeterminate") {
      fail("order", `Transaction activity ${activity.id} has no determinate effect observation`);
    }
    if (outcome === "completed") {
      if (activity.transactionOutcome !== "applied") {
        fail("order", `Completed transaction activity ${activity.id} was not applied`);
      }
      if (activity.operation === "delivery.admit") {
        if (activity.candidate === null) {
          fail(
            "order",
            activity.decisionKind === "readmit"
              ? "Readmission cannot complete before Candidate governance rebind"
              : "Initial admission cannot complete before Candidate initialization",
          );
        }
        if (activity.decisionKind === "readmit" && replay.subjects.proposedBoundary !== null) {
          fail("order", "Readmission cannot complete before boundary activation");
        }
      } else if (activity.closure === null) {
        fail("order", `${activity.operation} cannot complete before terminal Closure`);
      }
    } else if (activity.transactionOutcome !== "not-applied") {
      fail("order", `Unsuccessful transaction activity ${activity.id} must be observed not applied`);
    }
  }
  activity.completionOutcome = outcome;
  activity.stage = "completed";
  activity.recovery = null;
}

function applyEvent(replay: Replay, event: ControlRecordEvent): void {
  const kind = event.eventKind as DeliveryEventKind;
  if (!replay.created && kind !== "delivery-created") {
    fail("order", "Delivery replay must begin with delivery-created");
  }
  if (replay.subjects.closure !== null) {
    fail("terminal", "No Delivery event may follow terminal Closure");
  }
  switch (kind) {
    case "delivery-created":
      exactPayload(event, []);
      if (replay.created || event.sequence !== 1) fail("duplicate", "Delivery is created exactly once at sequence 1");
      replay.created = true;
      break;
    case "director-brief-submitted":
      submitDirectorBrief(replay, event);
      break;
    case "work-delegation-set":
      setWorkDelegation(replay, event);
      break;
    case "work-delegation-stopped":
      stopWorkDelegation(replay, event);
      break;
    case "activity-started":
      startActivity(replay, event);
      break;
    case "activity-recovery-recorded":
      recordRecovery(replay, event);
      break;
    case "agent-pre-intent-refused":
      refuseAgentBeforeIntent(replay, event);
      break;
    case "agent-attempt-prepared":
      prepareAttempt(replay, event);
      break;
    case "provider-effect-intended":
      intendProviderEffect(replay, event);
      break;
    case "provider-effect-observed":
      observeProviderEffect(replay, event);
      break;
    case "agent-work-product-submitted":
      submitWorkProduct(replay, event);
      break;
    case "agent-work-product-abandoned":
      abandonWorkProduct(replay, event);
      break;
    case "integration-assessed":
      assessIntegration(replay, event);
      break;
    case "candidate-revision-observed":
      observeCandidateRevision(replay, event);
      break;
    case "execution-receipt-recorded":
      recordReceipt(replay, event);
      break;
    case "work-boundary-finalized":
      finalizeBoundary(replay, event);
      break;
    case "material-condition-frozen":
      freezeMaterialCondition(replay, event);
      break;
    case "candidate-sealed":
      sealCandidate(replay, event);
      break;
    case "check-receipt-recorded":
      recordCheckReceipt(replay, event);
      break;
    case "evidence-packet-finalized":
      finalizeEvidence(replay, event);
      break;
    case "director-decision-authenticated":
      authenticateDecision(replay, event);
      break;
    case "transaction-effect-intended":
      intendTransactionEffect(replay, event);
      break;
    case "transaction-effect-observed":
      observeTransactionEffect(replay, event);
      break;
    case "activity-completed":
      completeActivity(replay, event);
      break;
    case "closure-recorded":
      recordClosure(replay, event);
      break;
  }
}

export type IncrementalDeliveryReplay = Readonly<{
  append(event: ControlRecordEvent): void;
  fork(): IncrementalDeliveryReplay;
  finish(): ReducedDeliveryState;
  assertSealable(): ReducedDeliveryState;
}>;

function assertSealableState(
  state: ReducedDeliveryState,
  head: ControlRecordEvent | null,
): ReducedDeliveryState {
  const closure = state.subjects.closure;
  if (
    state.standing !== "closed" ||
    closure === null ||
    head === null ||
    head.eventKind !== "closure-recorded" ||
    head.subject === null ||
    head.subject.recordId !== closure.id ||
    head.subject.revision !== closure.revision ||
    head.subject.digest !== closure.digest ||
    state.activities.some(({ stage }) => stage !== "completed")
  ) {
    fail(
      "seal",
      "Store sealing requires terminal Closure as the exact Journal head and no incomplete activity",
    );
  }
  return state;
}

function deliveryReplayController(initial: Replay): IncrementalDeliveryReplay {
  const replay = initial;
  return Object.freeze({
    append(event: ControlRecordEvent): void {
      const expectedSequence = (replay.lastEvent?.sequence ?? 0) + 1;
      verifyEnvelope(replay, event, expectedSequence);
      applyEvent(replay, event);
      replay.lastEvent = event;
    },
    fork(): IncrementalDeliveryReplay {
      return deliveryReplayController(clonedReplay(replay));
    },
    finish(): ReducedDeliveryState {
      return reducedState(replay);
    },
    assertSealable(): ReducedDeliveryState {
      return assertSealableState(reducedState(replay), replay.lastEvent);
    },
  });
}

export function createDeliveryReplay(
  resolveRevision: DeliveryRecordRevisionResolver,
): IncrementalDeliveryReplay {
  return deliveryReplayController(freshReplay(resolveRevision));
}

export function reduceDeliveryEvents(
  events: readonly ControlRecordEvent[],
  resolveRevision: DeliveryRecordRevisionResolver,
): ReducedDeliveryState {
  const replay = createDeliveryReplay(resolveRevision);
  for (const event of events) replay.append(event);
  return replay.finish();
}

/** Replay the complete event chain and exact retained revisions or fail closed. */
export function assertDeliveryReplayIntegrity(
  events: readonly ControlRecordEvent[],
  resolveRevision: DeliveryRecordRevisionResolver,
): ReducedDeliveryState {
  return reduceDeliveryEvents(events, resolveRevision);
}

/** Require the exact terminal semantic state needed before physical Store sealing. */
export function assertDeliveryReplaySealable(
  events: readonly ControlRecordEvent[],
  resolveRevision: DeliveryRecordRevisionResolver,
): ReducedDeliveryState {
  const replay = createDeliveryReplay(resolveRevision);
  for (const event of events) replay.append(event);
  return replay.assertSealable();
}

/**
 * Overlay the exact physical Store disposition that cannot be inferred from
 * retained Delivery events. Closure remains the final event while incomplete
 * sealing or archive verification exposes only exact recovery.
 */
export function composeDeliveryStoreDisposition(
  state: ReducedDeliveryState,
  disposition: DeliveryStoreDisposition,
): ReducedDeliveryState {
  if (state.subjects.closure === null) {
    if (disposition !== "active-unsealed") {
      fail("store-disposition", "A Delivery without Closure cannot be sealed or archived");
    }
    return state;
  }
  if (disposition === "archived-verified") {
    return Object.freeze({ ...state, eligibleOperations: Object.freeze([]) });
  }
  return Object.freeze({
    ...state,
    eligibleOperations: Object.freeze(["delivery.recover"] as const),
  });
}
