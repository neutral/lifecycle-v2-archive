import { compileFoundationAttemptView, type FoundationAttemptView } from "../control/attempt-view.js";
import { parseFoundationIntegrationAssessmentPayloadV1, resolveCandidateIntegrationProvenanceV1,
  resolveFailedIntegrationCorrectionV1 } from "../control/integration-assessment.js";
import { controlTimestamp } from "../control/model.js";
import { assertDeliveryControlRecordPayload } from "../control/payload-registry.js";
import type { DeliveryControlPhysicalDisposition } from "../control/public-view.js";
import type { ControlRecordStore } from "../control/store.js";
import type { ControlRecordEvent, ControlRecordRevision } from "../control/types.js";
import { parseWorkDelegationPayload, parseWorkDelegationReservation,
  type WorkDelegationOperation, type WorkDelegationReservation } from "../control/work-delegation.js";
import { FoundationError } from "../error.js";
import { canonicalJson, type Sha256 } from "../validation/canonical.js";
import { deliveryWorkDecisionBasisDigest } from "./delivery-state.js";

type Reference = Readonly<{ id: string; revision: number; digest: Sha256 }>;
type Reason = WorkDelegationReservation["decision"]["reason"];
export type WorkDelegationStopReason = "recovery-required" | "operation-in-progress" | "closed"
  | "admission-required" | "material-condition" | "delegation-required" | "delegation-stopped"
  | "delegation-expired" | "allowance-exhausted" | "acceptance-required" | "director-decision-required"
  | "operation-not-delegated" | "operation-ineligible" | "operational-failure" | "observation-unavailable"
  | "no-useful-work" | "repeated-unchanged-result" | "unresolved-proof";
type Facts = Readonly<{
  boundary: Reference | null; candidate: Reference | null;
  activityId: string | null; attempt: Reference | null;
  integration: Reference | null; evidence: Reference | null;
}>;
type DecisionBasis = Readonly<{
  basisDigest: Sha256;
  journalHead: Readonly<{ sequence: number; digest: Sha256 | null }>;
  facts: Facts;
}>;
export type WorkDelegationDecision = DecisionBasis & (
  | Readonly<{ kind: "operation"; operation: WorkDelegationOperation; reason: Reason;
      journalHead: Readonly<{ sequence: number; digest: Sha256 }> }>
  | Readonly<{ kind: "stop"; reason: WorkDelegationStopReason }>
);

type Completed = Readonly<{
  activityId: string; operation: WorkDelegationOperation; sequence: number;
  attempt: ControlRecordRevision | null; integration: ControlRecordRevision | null;
  reservation: WorkDelegationReservation | null;
}>;

function fail(reason: string): never {
  throw new FoundationError("lifecycle.work-delegation.policy-binding", "Useful-work selection requires exact retained owner facts", {
    observedFacts: Object.freeze({ reason }),
  });
}
function ref(value: ControlRecordRevision): Reference {
  return Object.freeze({ id: value.recordId, revision: value.revision, digest: value.digest });
}
function same(left: Reference | null, right: Reference | null): boolean {
  const identity = (value: Reference | null) => value === null ? null : { id: value.id, revision: value.revision, digest: value.digest };
  return canonicalJson(identity(left)) === canonicalJson(identity(right));
}
function retained(store: ControlRecordStore, selected: Reference, kind: string): ControlRecordRevision {
  const revision = store.getRevision(selected.id, selected.revision);
  if (revision === null || revision.recordKind !== kind || revision.processId !== store.identity.processId || !same(ref(revision), selected)) fail("revision");
  assertDeliveryControlRecordPayload(revision);
  return revision;
}
function linked(revision: ControlRecordRevision, relation: string, kind: string): Reference {
  const matches = revision.relationships.filter(value => value.relation === relation);
  if (matches.length !== 1 || matches[0]!.target.kind !== kind) fail("relationship");
  const { id, revision: number, digest } = matches[0]!.target;
  return { id, revision: number, digest };
}
function journal(store: ControlRecordStore): readonly ControlRecordEvent[] {
  const head = store.state().journal;
  if (head.eventCount > 100_000) fail("journal-bound");
  const events: ControlRecordEvent[] = [];
  let digest: Sha256 | null = null;
  while (events.length < head.eventCount) {
    const count = Math.min(1_000, head.eventCount - events.length);
    const page = store.listEvents(events.length, count);
    if (page.length !== count) fail("journal-prefix");
    for (const event of page) {
      if (event.sequence !== events.length + 1 || event.predecessorDigest !== digest ||
          event.storeId !== store.identity.storeId || event.processId !== store.identity.processId) fail("journal-prefix");
      events.push(event); digest = event.digest;
    }
  }
  if (digest !== head.headDigest) fail("journal-prefix");
  return events;
}
function eventRevision(store: ControlRecordStore, event: ControlRecordEvent, kind: string): ControlRecordRevision {
  if (event.subject === null) fail("event-subject");
  return retained(store, { id: event.subject.recordId, revision: event.subject.revision, digest: event.subject.digest }, kind);
}
function completedHistory(store: ControlRecordStore, events: readonly ControlRecordEvent[], boundary: Reference, admission: Reference): readonly Completed[] {
  const admissions = events.filter(event => event.eventKind === "transaction-effect-observed" && event.subject !== null &&
    same({ id: event.subject.recordId, revision: event.subject.revision, digest: event.subject.digest }, admission));
  if (admissions.length !== 1) fail("applied-admission");
  const byActivity = new Map<string, ControlRecordEvent[]>();
  for (const event of events) {
    if (typeof event.payload.activityId !== "string") continue;
    const selected = byActivity.get(event.payload.activityId) ?? [];
    selected.push(event); byActivity.set(event.payload.activityId, selected);
  }
  const result: Completed[] = [];
  for (const activity of store.state().activities) {
    if (activity.stage !== "completed" || !["delivery.continue", "delivery.integrate", "delivery.evaluate"].includes(activity.operation)) continue;
    const selected = byActivity.get(activity.id) ?? [];
    const one = (kind: string) => {
      const matches = selected.filter(event => event.eventKind === kind);
      if (matches.length > 1) fail("duplicate-activity-fact");
      return matches[0] ?? null;
    };
    const opening = one("activity-started"), completion = one("activity-completed");
    if (opening === null || completion === null) fail("activity");
    const prepared = one("agent-attempt-prepared"), assessed = one("integration-assessed");
    const attempt = prepared === null ? null : eventRevision(store, prepared, "agent-attempt");
    const integration = assessed === null ? null : eventRevision(store, assessed, "integration-assessment");
    const governing = attempt !== null ? linked(attempt, "uses-boundary", "work-boundary")
      : integration !== null ? linked(integration, "governed-by", "work-boundary") : null;
    // A pre-intent refusal has no Attempt. The exact applied-admission event
    // distinguishes a current operation from an older same-Delivery course.
    if (governing === null ? opening.sequence <= admissions[0]!.sequence : !same(governing, boundary)) continue;
    result.push(Object.freeze({ activityId: activity.id, operation: activity.operation as WorkDelegationOperation,
      sequence: completion.sequence, attempt, integration,
      reservation: opening.payload.reservation === undefined ? null : parseWorkDelegationReservation(opening.payload.reservation) }));
  }
  return Object.freeze(result.sort((a, b) => a.sequence - b.sequence));
}
function tree(store: ControlRecordStore, selected: Reference | null): string | null {
  if (selected === null) return null;
  const candidate = retained(store, selected, "candidate-revision");
  const state = candidate.payload.state;
  if (state === null || typeof state !== "object" || Array.isArray(state) ||
      !("tree" in state) || typeof state.tree !== "string") fail("candidate-state");
  return state.tree;
}

/**
 * Choose one useful existing operation from verified retained facts. The caller
 * owns fresh Store/custody observation and the Delivery lock. This function does
 * not observe canonical HEAD, reserve resources, start work or verify acceptance.
 */
export function compileWorkDelegationDecision(input: Readonly<{
  store: ControlRecordStore; physical: DeliveryControlPhysicalDisposition; observedAt: string;
}>, owners: Readonly<{ compileAttemptView?: typeof compileFoundationAttemptView }> = {}): WorkDelegationDecision {
  const { store } = input;
  const observedAt = controlTimestamp(input.observedAt, "Work decision observation time");
  const state = store.state();
  const basisDigest = deliveryWorkDecisionBasisDigest(state);
  const journalHead = Object.freeze({ sequence: state.journal.eventCount, digest: state.journal.headDigest });
  let facts: Facts = Object.freeze({ boundary: state.subjects.activeBoundary, candidate: state.subjects.candidate,
    activityId: null, attempt: null, integration: state.subjects.integrationAssessment, evidence: state.subjects.evidence });
  const stop = (reason: WorkDelegationStopReason): WorkDelegationDecision => Object.freeze({ kind: "stop", reason, basisDigest, journalHead, facts });
  if (state.activities.some(activity => activity.recovery !== null)) return stop("recovery-required");
  if (state.activities.some(activity => activity.stage !== "completed")) return stop("operation-in-progress");
  if (state.standing === "closed" || state.subjects.closure !== null) return stop("closed");
  if (state.subjects.materialCondition !== null) return stop("material-condition");
  if (state.subjects.activeBoundary === null || state.delegation.admission === null || state.subjects.candidate === null ||
      !["active", "decision-ready"].includes(state.standing)) return stop("admission-required");
  if (state.standing === "decision-ready") return stop("acceptance-required");
  const current = state.delegation.current;
  if (current === null) return stop("delegation-required");
  if (current.stopped || store.getWorkDelegationStopRequest() !== null) return stop("delegation-stopped");
  const delegation = parseWorkDelegationPayload(retained(store, current.reference, "work-delegation").payload);
  if (!same(delegation.boundary, state.subjects.activeBoundary) ||
      !same(delegation.admission, state.delegation.admission)) return stop("admission-required");
  if (delegation.expiresAt !== null && Date.parse(observedAt) >= Date.parse(delegation.expiresAt)) return stop("delegation-expired");
  if (state.delegation.charged.operations >= delegation.ceilings.operations) return stop("allowance-exhausted");
  const choose = (operation: WorkDelegationOperation, reason: Reason): WorkDelegationDecision => {
    if (!delegation.allowedOperations.includes(operation)) return stop("operation-not-delegated");
    if (!state.eligibleOperations.includes(operation)) return stop("operation-ineligible");
    if (journalHead.sequence < 1 || journalHead.digest === null) fail("decision-head");
    return Object.freeze({ kind: "operation", operation, reason, basisDigest,
      journalHead: Object.freeze({ sequence: journalHead.sequence, digest: journalHead.digest }), facts });
  };
  const boundary = retained(store, state.subjects.activeBoundary, "work-boundary");
  const candidate = retained(store, state.subjects.candidate, "candidate-revision");
  const history = completedHistory(store, journal(store), ref(boundary), state.delegation.admission);
  const latest = history.at(-1);
  if (latest === undefined) return choose("delivery.continue", "develop-candidate");
  facts = Object.freeze({ ...facts, activityId: latest.activityId, attempt: latest.attempt === null ? null : ref(latest.attempt) });
  if (latest.operation === "delivery.integrate") {
    if (latest.integration === null || !same(ref(latest.integration), state.subjects.integrationAssessment)) return stop("observation-unavailable");
    const assessment = parseFoundationIntegrationAssessmentPayloadV1(latest.integration.payload);
    if (assessment.contextualApplicability.disposition === "requires-readmission") return stop("admission-required");
    if (assessment.outcome !== "constructed") {
      const correction = resolveFailedIntegrationCorrectionV1({ store, assessment: { kind: "integration-assessment", ...ref(latest.integration) }, boundary, candidate });
      if (correction === null || (assessment.conflicts.length === 0 && assessment.validation.diagnosticCodes.length === 0)) return stop("no-useful-work");
      return choose("delivery.continue", "correct-in-scope-findings");
    }
    const provenance = resolveCandidateIntegrationProvenanceV1({ store, candidate });
    if (provenance === null || !same(ref(provenance.assessment), ref(latest.integration))) fail("integration-provenance");
    return choose("delivery.evaluate", "evaluate-integrated-candidate");
  }
  if (latest.attempt === null) return stop("operational-failure");
  const compileView = owners.compileAttemptView ?? compileFoundationAttemptView;
  const viewFor = (selected: Completed): FoundationAttemptView | null => selected.attempt === null ? null : compileView({
    store, physical: input.physical, selection: { kind: "attempt", attemptId: selected.attempt.recordId },
  });
  const view = viewFor(latest);
  if (view === null || !view.complete || view.attemptContract.activityId !== latest.activityId ||
      view.attemptContract.operation !== latest.operation || !same(view.coordinate.attempt, ref(latest.attempt)) ||
      !same(view.attemptContract.boundary, ref(boundary))) return stop("observation-unavailable");
  const previous = [...history].reverse().find(entry => entry.sequence < latest.sequence && entry.operation === latest.operation);
  const repeatedInvalid = (): boolean => {
    if (previous === undefined) return false;
    const prior = viewFor(previous);
    return prior !== null && prior.agentSemantics.workProduct === null &&
      prior.agentSemantics.submissionDiagnostics.diagnostic !== null &&
      tree(store, prior.attemptContract.candidate) === tree(store, view.attemptContract.candidate);
  };
  if (view.agentSemantics.workProduct === null) {
    if (latest.operation === "delivery.continue" && view.candidateTransition.successorDisposition === "promoted" &&
        view.candidateTransition.contentDisposition === "changed" && same(view.candidateTransition.successor?.revision ?? null, ref(candidate))) {
      // Candidate observation is independent of semantic submission/provider
      // success. Actual changed valid bytes justify a fresh bounded Builder;
      // they do not supply a readiness proposal or permit direct evaluation.
      return choose("delivery.continue", "develop-candidate");
    }
    if (view.agentSemantics.submissionDiagnostics.diagnostic !== null &&
        (view.agentSemantics.submissionDiagnostics.parserDisposition === "invalid" || view.agentSemantics.submissionDiagnostics.compilerDisposition === "invalid-result")) {
      if (repeatedInvalid()) return stop("repeated-unchanged-result");
      if (latest.operation === "delivery.evaluate") {
        if (resolveCandidateIntegrationProvenanceV1({ store, candidate }) === null) return stop("unresolved-proof");
        return choose("delivery.evaluate", "evaluate-integrated-candidate");
      }
      return choose("delivery.continue", "correct-in-scope-findings");
    }
    return stop(view.providerExecution.effect.outcome === "failed" || view.providerExecution.effect.outcome === "not-started"
      ? "operational-failure" : "no-useful-work");
  }
  // A useful valid Work Product is not erased merely because the provider also
  // reported failure. Its Candidate/proof facts remain independently checked.
  if (latest.operation === "delivery.continue") {
    const semantics = view.agentSemantics.roleSemantics;
    if (semantics?.role === "builder" && view.candidateTransition.successorDisposition === "invalid" && view.candidateTransition.failureFactsDigest !== null) {
      const prior = previous === undefined ? null : viewFor(previous);
      if (prior?.candidateTransition.successorDisposition === "invalid" &&
          tree(store, prior.attemptContract.candidate) === tree(store, view.attemptContract.candidate)) return stop("repeated-unchanged-result");
      return choose("delivery.continue", "correct-in-scope-findings");
    }
    if (semantics?.role !== "builder" || view.candidateTransition.successorDisposition !== "promoted" ||
        !same(view.candidateTransition.successor?.revision ?? null, ref(candidate))) return stop("no-useful-work");
    const earlier = history.length < 2 ? null : history[history.length - 2]!;
    if (view.candidateTransition.contentDisposition === "unchanged" && earlier !== null) {
      if (earlier.integration !== null && parseFoundationIntegrationAssessmentPayloadV1(earlier.integration.payload).outcome !== "constructed") {
        return stop("repeated-unchanged-result");
      }
      if (earlier.operation === "delivery.evaluate") {
        const review = viewFor(earlier);
        if (review?.agentSemantics.workProduct !== null && review?.agentSemantics.workProduct !== undefined) return stop("repeated-unchanged-result");
      }
    }
    if (semantics.proposal === "ready-to-evaluate") return choose("delivery.integrate", "integrate-ready-candidate");
    if (semantics.proposal === "progress" && view.candidateTransition.contentDisposition === "changed") return choose("delivery.continue", "develop-candidate");
    if (semantics.proposal === "progress") return stop("repeated-unchanged-result");
    return stop(semantics.proposal === "material-condition" ? "material-condition" : "no-useful-work");
  }
  const packet = state.subjects.evidence === null ? null : retained(store, state.subjects.evidence, "evidence-packet");
  if (packet === null || !same(linked(packet, "governed-by", "work-boundary"), ref(boundary)) ||
      !same(linked(packet, "evaluates", "candidate-revision"), ref(candidate)) ||
      !same(linked(packet, "uses-seal", "candidate-seal"), state.subjects.seal) ||
      !same(linked(packet, "uses-review", "agent-work-product"), view.agentSemantics.workProduct)) return stop("unresolved-proof");
  if (packet.payload.readiness === "acceptance-ready") return stop("acceptance-required");
  if (packet.payload.readiness === "no-ship-recommended") return stop("director-decision-required");
  if (view.processAndProof.checks.some(check => check.final !== null && !["pass", "fail"].includes(check.final.disposition))) return stop("unresolved-proof");
  const concreteCorrection = view.processAndProof.obligations.some(obligation => obligation.standing === "review-rejected" || obligation.standing === "check-failed");
  return concreteCorrection ? choose("delivery.continue", "correct-in-scope-findings") : stop("unresolved-proof");
}
