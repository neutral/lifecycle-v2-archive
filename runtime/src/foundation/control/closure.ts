import { FoundationError } from "../error.js";
import {
  assertFoundationTransactionObservationFactsV7,
  FOUNDATION_TERMINAL_ACCEPTANCE_OBSERVATION_FACTS_V1,
  FOUNDATION_TERMINAL_REPOSITORY_OBSERVATION_FACTS_V1,
} from "../process/transaction-observation-facts-v7.js";
import {
  digestCanonical,
  type Sha256,
} from "../validation/canonical.js";
import { assertDeliveryControlRecordPolicy } from "./kind-registry.js";
import { resolveCandidateIntegrationProvenanceV1 } from "./integration-assessment.js";
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
  ControlRecordStoreAppend,
} from "./types.js";

export type ClosureCanonicalResult = Readonly<{
  parentCommit: string;
  parentTree: string;
  commit: string;
  tree: string;
  candidateDigest: Sha256;
  productStateDigest: Sha256;
  knowledgeSetDigest: Sha256;
}>;

export type ClosureTerminalExecutions = Readonly<{
  terminalExecutionSetDigest: Sha256;
  executionCount: number;
  containment: Readonly<{ classification: "complete"; factsDigest: Sha256 }>;
  retirement: Readonly<{ classification: "complete"; factsDigest: Sha256 }>;
}>;

export type ClosureReclamationHandoff = Readonly<{
  obligationSetDigest: Sha256;
  obligationCount: number;
}>;

export type ClosureRuntimeCoordinates = Readonly<{
  implementationId: string;
  implementationDigest: Sha256;
  ruleSetId: string;
  ruleSetDigest: Sha256;
}>;

export type CompiledClosureAppend = Readonly<{
  revision: ControlRecordRevision;
  append: ControlRecordStoreAppend;
}>;

type ClosureDisposition = "accepted" | "no-ship";
type TerminalFinalObservationFactsSchema =
  | typeof FOUNDATION_TERMINAL_ACCEPTANCE_OBSERVATION_FACTS_V1
  | typeof FOUNDATION_TERMINAL_REPOSITORY_OBSERVATION_FACTS_V1;

type TransactionFacts = Readonly<{
  operation: "delivery.accept" | "delivery.no-ship";
  disposition: ClosureDisposition;
  decision: ControlRecordRevision;
  effectDigest: Sha256;
  observationFactsSchema: TerminalFinalObservationFactsSchema;
  observationFactsDigest: Sha256;
  canonicalResultDigest: Sha256 | null;
  observedAt: string;
}>;

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const GIT_OBJECT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.control-closure.${code}`, message);
}

function digest(value: unknown, label: string): Sha256 {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail("digest", `${label} must be one lowercase SHA-256 digest`);
  }
  return value as Sha256;
}

function gitObject(value: unknown, label: string): string {
  if (typeof value !== "string" || !GIT_OBJECT_PATTERN.test(value)) {
    fail("git-object", `${label} must be one exact Git object identity`);
  }
  return value;
}

function object(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    fail("retained-fact", `${label} must be one exact object`);
  }
  return value as ControlJsonObject;
}

function reference(revision: ControlRecordRevision): ControlRecordRelationshipTarget {
  return Object.freeze({
    kind: revision.recordKind,
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function sameReference(
  left: Readonly<{ id: string; revision: number; digest: Sha256 }> | null,
  right: ControlRecordRelationshipTarget | null,
): boolean {
  return left !== null && right !== null && left.id === right.id &&
    left.revision === right.revision && left.digest === right.digest;
}

function exactEventSubject(event: ControlRecordEvent, revision: ControlRecordRevision): boolean {
  return event.subject !== null && event.subject.recordId === revision.recordId &&
    event.subject.revision === revision.revision && event.subject.digest === revision.digest;
}

function allEvents(store: ControlRecordStore): readonly ControlRecordEvent[] {
  const events: ControlRecordEvent[] = [];
  let cursor = 0;
  for (;;) {
    const page = store.listEvents(cursor, 10_000);
    events.push(...page);
    if (page.length < 10_000) return Object.freeze(events);
    cursor = page.at(-1)!.sequence;
    if (events.length > 100_000) fail("journal", "Closure lookup exceeds the Journal bound");
  }
}

function exactObjectKeys(
  value: ControlJsonObject,
  expected: readonly string[],
  label: string,
): void {
  const keys = Object.keys(value);
  const allowed = new Set(expected);
  if (keys.length !== expected.length || keys.some((key) => !allowed.has(key))) {
    fail("journal", `${label} does not have its exact keys`);
  }
}

function preIntentRefusalEventCount(store: ControlRecordStore): number {
  const activities = new Set<string>();
  let count = 0;
  for (const event of allEvents(store)) {
    if (event.eventKind !== "agent-pre-intent-refused") continue;
    if (event.subject !== null) {
      fail("journal", "Pre-intent refusal unexpectedly names a Control subject");
    }
    exactObjectKeys(
      event.payload,
      ["activityId", "diagnosticCode", "refusalFactsDigest", "resolution"],
      "Pre-intent refusal payload",
    );
    const activityValue = event.payload.activityId;
    const diagnosticValue = event.payload.diagnosticCode;
    if (typeof activityValue !== "string" || typeof diagnosticValue !== "string") {
      fail("journal", "Pre-intent refusal payload identities are not exact strings");
    }
    const activityId = controlIdentifier(activityValue, "Pre-intent refusal Activity identity");
    controlIdentifier(diagnosticValue, "Pre-intent refusal diagnostic code");
    digest(event.payload.refusalFactsDigest, "Pre-intent refusal facts digest");
    if (activities.has(activityId)) {
      fail("journal", "Pre-intent refusal repeats one Agent Activity");
    }
    activities.add(activityId);
    if (event.payload.resolution !== "none" && event.payload.resolution !== "projection-condition-required") {
      fail("journal", "Pre-intent refusal lacks an exact execution-allocation disposition");
    }
    if (event.payload.resolution === "none") count += 1;
  }
  return count;
}

function exactRetainedSubject(
  store: ControlRecordStore,
  event: ControlRecordEvent,
  expectedKind: string,
): ControlRecordRevision {
  if (event.subject === null) fail("journal", `${event.eventKind} has no exact retained subject`);
  const revision = store.getRevision(event.subject.recordId, event.subject.revision);
  if (
    revision === null || revision.recordKind !== expectedKind ||
    revision.digest !== event.subject.digest
  ) {
    fail("journal", `${event.eventKind} does not resolve to one exact ${expectedKind} revision`);
  }
  return revision;
}

function relationshipTarget(
  revision: ControlRecordRevision,
  relation: string,
  expectedKind: string,
  required: boolean,
): ControlRecordRelationshipTarget | null {
  const matches = revision.relationships.filter((item) => item.relation === relation);
  if (matches.length > 1 || (required && matches.length !== 1)) {
    fail("relationship", `${revision.recordKind} must have ${required ? "exactly" : "at most"} one ${relation}`);
  }
  const target = matches[0]?.target ?? null;
  if (target !== null && target.kind !== expectedKind) {
    fail("relationship", `${relation} must target ${expectedKind}`);
  }
  return target;
}

function retainedTarget(
  store: ControlRecordStore,
  target: ControlRecordRelationshipTarget,
): ControlRecordRevision {
  const revision = store.getRevision(target.id, target.revision);
  if (revision === null || revision.recordKind !== target.kind || revision.digest !== target.digest) {
    fail("relationship", `Relationship does not resolve to one exact ${target.kind} revision`);
  }
  return revision;
}

function transactionFacts(store: ControlRecordStore, exactActivityId: string): TransactionFacts {
  const state = store.state();
  const activity = state.activities.find(({ id }) => id === exactActivityId);
  if (
    activity === undefined || activity.family !== "transaction" ||
    !(activity.operation === "delivery.accept" || activity.operation === "delivery.no-ship") ||
    activity.stage !== "effect-observed" || activity.recovery?.kind !== "finalization" ||
    activity.recovery.resumesAt !== "transaction-finalization" ||
    state.subjects.closure !== null
  ) {
    fail("activity", "Closure requires one exact applied terminal transaction awaiting finalization");
  }

  const events = allEvents(store).filter((event) => event.payload.activityId === exactActivityId);
  const decisions = events.filter(({ eventKind }) => eventKind === "director-decision-authenticated");
  const intents = events.filter(({ eventKind }) => eventKind === "transaction-effect-intended");
  const observations = events.filter(({ eventKind }) => eventKind === "transaction-effect-observed");
  const closures = events.filter(({ eventKind }) => eventKind === "closure-recorded");
  if (decisions.length !== 1 || intents.length !== 1 || observations.length < 1 || closures.length !== 0) {
    fail("journal", "Terminal transaction history is incomplete, repeated, or already closed");
  }
  const decision = exactRetainedSubject(store, decisions[0]!, "director-decision");
  if (!exactEventSubject(intents[0]!, decision)) {
    fail("journal", "Transaction intent does not bind the exact Director Decision");
  }
  const effectDigest = digest(intents[0]!.payload.effectDigest, "Transaction effect digest");
  const decisionKind = decision.payload.decision;
  if (decisionKind !== "accept" && decisionKind !== "no-ship") {
    fail("authority", "Director Decision is not one terminal decision kind");
  }
  const disposition = activity.operation === "delivery.accept" ? "accepted" : "no-ship";
  if (
    (disposition === "accepted" && decisionKind !== "accept") ||
    (disposition === "no-ship" && decisionKind !== "no-ship")
  ) {
    fail("authority", "Director Decision does not authorize the terminal activity disposition");
  }
  let observationFactsSchema: TerminalFinalObservationFactsSchema | null = null;
  let observationFactsDigest: Sha256 | null = null;
  let canonicalResultDigest: Sha256 | null = null;
  for (const [index, observation] of observations.entries()) {
    if (
      !exactEventSubject(observation, decision) ||
      digest(observation.payload.effectDigest, "Transaction observation digest") !== effectDigest
    ) {
      fail("journal", "Transaction observation does not bind the exact retained effect and Decision");
    }
    const outcome = observation.payload.outcome;
    const last = index === observations.length - 1;
    if (outcome !== "applied" && outcome !== "not-applied" && outcome !== "indeterminate") {
      fail("transaction", "Transaction observation outcome is unsupported");
    }
    if ((!last && outcome !== "indeterminate") || (last && outcome !== "applied")) {
      fail("transaction", "Only indeterminate observations may precede the final applied transaction fact");
    }
    const facts = assertFoundationTransactionObservationFactsV7({
      operation: activity.operation,
      decisionKind,
      outcome,
      facts: observation.payload.facts,
      factsDigest: observation.payload.factsDigest,
    });
    if (last) {
      observationFactsDigest = digest(
        observation.payload.factsDigest,
        "Final transaction observation facts digest",
      );
      if (disposition === "accepted") {
        if (facts.schema !== FOUNDATION_TERMINAL_ACCEPTANCE_OBSERVATION_FACTS_V1) {
          fail(
            "canonical-result-binding",
            "Accepted Closure requires final applied acceptance observation facts",
          );
        }
        canonicalResultDigest = facts.canonicalResultDigest;
        observationFactsSchema = facts.schema;
      } else {
        if (facts.schema !== FOUNDATION_TERMINAL_REPOSITORY_OBSERVATION_FACTS_V1) {
          fail(
            "transaction-binding",
            "No-ship Closure requires final applied repository observation facts",
          );
        }
        observationFactsSchema = facts.schema;
      }
    }
  }
  if (observationFactsSchema === null || observationFactsDigest === null) {
    fail("journal", "Terminal transaction lacks one final observation facts digest");
  }
  return Object.freeze({
    operation: activity.operation,
    disposition,
    decision,
    effectDigest,
    observationFactsSchema,
    observationFactsDigest,
    canonicalResultDigest,
    observedAt: observations.at(-1)!.occurredAt,
  });
}

function nonnegativeSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail("terminal-facts", `${label} must be one nonnegative safe integer`);
  }
  return value;
}

function terminalExecutionsPayload(value: ClosureTerminalExecutions): ControlJsonObject {
  if (value.containment.classification !== "complete" || value.retirement.classification !== "complete") {
    fail("terminal-facts", "Closure requires complete Execution Containment and Retirement");
  }
  return Object.freeze({
    terminalExecutionSetDigest: digest(
      value.terminalExecutionSetDigest,
      "Terminal execution-set digest",
    ),
    executionCount: nonnegativeSafeInteger(value.executionCount, "Terminal execution count"),
    containment: Object.freeze({
      classification: "complete",
      factsDigest: digest(value.containment.factsDigest, "Execution Containment facts digest"),
    }),
    retirement: Object.freeze({
      classification: "complete",
      factsDigest: digest(value.retirement.factsDigest, "Execution Retirement facts digest"),
    }),
  });
}

function reclamationHandoffPayload(value: ClosureReclamationHandoff): ControlJsonObject {
  return Object.freeze({
    obligationSetDigest: digest(value.obligationSetDigest, "Reclamation obligation-set digest"),
    obligationCount: nonnegativeSafeInteger(value.obligationCount, "Reclamation obligation count"),
  });
}

function canonicalResult(
  value: ClosureCanonicalResult,
  candidate: ControlRecordRevision,
  store: ControlRecordStore,
): ControlJsonObject {
  if (
    candidate.payload.schema !== "lifecycle.candidate-revision-payload.v3"
  ) {
    fail("candidate", "Accepted Closure requires one exact reconstructible Candidate Revision");
  }
  const state = object(candidate.payload.state, "Accepted Candidate state");
  const integration = resolveCandidateIntegrationProvenanceV1({ store, candidate });
  if (integration === null) {
    fail("canonical-result", "Accepted Closure requires exact Candidate integration provenance");
  }
  const result = Object.freeze({
    parentCommit: gitObject(value.parentCommit, "Accepted canonical parent commit"),
    parentTree: gitObject(value.parentTree, "Accepted canonical parent tree"),
    commit: gitObject(value.commit, "Accepted canonical commit"),
    tree: gitObject(value.tree, "Accepted canonical tree"),
    candidateDigest: digest(value.candidateDigest, "Accepted Candidate digest"),
    productStateDigest: digest(value.productStateDigest, "Accepted Product State digest"),
    knowledgeSetDigest: digest(value.knowledgeSetDigest, "Accepted Knowledge Set digest"),
  });
  if (
    result.parentCommit !== gitObject(
      candidate.payload.candidateBaseCommit,
      "Accepted Candidate base commit",
    ) ||
    result.parentCommit !== gitObject(
      integration.canonicalParent.commit,
      "Accepted integration parent commit",
    ) ||
    result.parentTree !== gitObject(
      integration.canonicalParent.tree,
      "Accepted integration parent tree",
    ) ||
    result.tree !== state.tree || result.candidateDigest !== state.candidateDigest ||
    result.productStateDigest !== state.productStateDigest ||
    result.knowledgeSetDigest !== state.knowledgeSetDigest
  ) {
    fail("canonical-result", "Accepted canonical result does not reproduce the exact selected Candidate Revision");
  }
  return result;
}

function exactSelectedTarget(
  store: ControlRecordStore,
  decision: ControlRecordRevision,
  relation: string,
  kind: string,
  required: boolean,
): ControlRecordRevision | null {
  const target = relationshipTarget(decision, relation, kind, required);
  return target === null ? null : retainedTarget(store, target);
}

function relationship(
  relation: string,
  revision: ControlRecordRevision,
): ControlRecordRelationship {
  return Object.freeze({ relation, target: reference(revision) });
}

function identities(store: ControlRecordStore, activityId: string): Readonly<{
  recordId: string;
  eventId: string;
}> {
  const suffix = digestCanonical({
    recordKind: "closure",
    storeId: store.identity.storeId,
    processId: store.identity.processId,
    activityId,
  }).slice("sha256:".length);
  return Object.freeze({
    recordId: `closure-${suffix}`,
    eventId: `event-closure-recorded-${suffix}`,
  });
}

function semanticMarkdown(input: Readonly<{
  disposition: ClosureDisposition;
  decision: ControlRecordRevision;
  boundary: ControlRecordRevision | null;
  candidate: ControlRecordRevision | null;
  canonical: ControlJsonObject | null;
  transactionObservedAt: string;
  terminalAt: string;
}>): string {
  const lines = [
    "# Closure",
    "",
    `- Disposition: ${input.disposition}`,
    `- Director Decision: ${input.decision.recordId} revision ${input.decision.revision}`,
    `- Work Boundary: ${input.boundary === null ? "none" : `${input.boundary.recordId} revision ${input.boundary.revision}`}`,
    `- Candidate: ${input.candidate === null ? "not created" : `${input.candidate.recordId} revision ${input.candidate.revision}`}`,
    `- Transaction observed: ${input.transactionObservedAt}`,
    `- Execution Containment: complete`,
    `- Execution Retirement: complete`,
    `- Closed at: ${input.terminalAt}`,
  ];
  if (input.canonical !== null) {
    lines.push(
      `- Accepted commit: ${String(input.canonical.commit)}`,
      `- Accepted tree: ${String(input.canonical.tree)}`,
    );
  } else {
    lines.push("- Canonical product integration: none");
  }
  lines.push("", "The related Director Decision retains the authenticated terminal rationale.", "");
  return lines.join("\n");
}

export type CompileClosureAppendInput = Readonly<{
  store: ControlRecordStore;
  activityId: string;
  canonicalResult: ClosureCanonicalResult | null;
  terminalExecutions: ClosureTerminalExecutions;
  reclamationHandoff: ClosureReclamationHandoff;
  runtime: ClosureRuntimeCoordinates;
  terminalAt: string;
  runtimeId: string;
}>;

/**
 * Compile Delivery's final Control revision and Journal append without
 * mutating the Store. A transaction owner can therefore commit Closure and
 * exact operation-support disposal at one durability boundary.
 */
export function compileClosureAppend(
  input: CompileClosureAppendInput,
): CompiledClosureAppend {
  const activityId = controlIdentifier(input.activityId, "Closure activity identity");
  const runtimeId = controlIdentifier(input.runtimeId, "Closure runtime identity");
  const terminalAt = controlTimestamp(input.terminalAt, "Closure terminal time");
  const transaction = transactionFacts(input.store, activityId);
  if (Date.parse(terminalAt) < Date.parse(transaction.observedAt)) {
    fail("time", "Closure cannot precede the applied transaction observation");
  }

  const boundary = exactSelectedTarget(
    input.store,
    transaction.decision,
    "selects-boundary",
    "work-boundary",
    transaction.disposition === "accepted",
  );
  const candidate = exactSelectedTarget(
    input.store,
    transaction.decision,
    "selects-candidate",
    "candidate-revision",
    transaction.disposition === "accepted",
  );
  const seal = exactSelectedTarget(
    input.store,
    transaction.decision,
    "selects-seal",
    "candidate-seal",
    transaction.disposition === "accepted",
  );
  const evidence = exactSelectedTarget(
    input.store,
    transaction.decision,
    "selects-evidence",
    "evidence-packet",
    transaction.disposition === "accepted",
  );
  const current = input.store.state().subjects;
  if (transaction.disposition === "accepted") {
    if (
      !sameReference(current.activeBoundary, boundary === null ? null : reference(boundary)) ||
      !sameReference(current.candidate, candidate === null ? null : reference(candidate)) ||
      !sameReference(current.seal, seal === null ? null : reference(seal)) ||
      !sameReference(current.evidence, evidence === null ? null : reference(evidence))
    ) {
      fail("current-subject", "Acceptance subjects changed after the exact authenticated Director Decision");
    }
  } else if (seal !== null || evidence !== null) {
    fail("authority", "No-ship Director Decision cannot select a Candidate Seal or Evidence Packet");
  }

  let acceptedResult: ControlJsonObject | null = null;
  let candidateTreatment: "integrated" | "abandoned" | "not-created";
  if (transaction.disposition === "accepted") {
    if (boundary === null || candidate === null || input.canonicalResult === null) {
      fail("canonical-result", "Acceptance requires the exact observed canonical result");
    }
    acceptedResult = canonicalResult(input.canonicalResult, candidate, input.store);
    if (
      transaction.canonicalResultDigest === null ||
      transaction.canonicalResultDigest !== digestCanonical(acceptedResult)
    ) {
      fail(
        "canonical-result-binding",
        "Accepted canonical result differs from the final immutable applied observation",
      );
    }
    candidateTreatment = "integrated";
  } else {
    if (input.canonicalResult !== null) {
      fail("canonical-result", "No-ship cannot retain or imply canonical product integration");
    }
    candidateTreatment = candidate === null ? "not-created" : "abandoned";
  }

  const terminalExecutions = terminalExecutionsPayload(input.terminalExecutions);
  const reclamationHandoff = reclamationHandoffPayload(input.reclamationHandoff);
  const preIntentRefusalCount = preIntentRefusalEventCount(input.store);
  const expectedObligationCount =
    input.terminalExecutions.executionCount + preIntentRefusalCount;
  if (
    !Number.isSafeInteger(expectedObligationCount) ||
    input.reclamationHandoff.obligationCount !== expectedObligationCount
  ) {
    fail(
      "terminal-facts",
      "Closure requires exactly one Reclamation obligation per terminal execution and allocated pre-intent refusal",
    );
  }
  const runtime = Object.freeze({
    qualification: "lifecycle.foundation.1.0.0-rc.17",
    repository: "lifecycle.repository.v22",
    runtimeProtocol: "lifecycle.runtime.foundation.v17",
    interfaceProtocol: "lifecycle.interface.foundation.v17",
    provider: "lifecycle.provider-adapter.v7",
    implementationId: controlIdentifier(input.runtime.implementationId, "Closure implementation identity"),
    implementationDigest: digest(input.runtime.implementationDigest, "Closure implementation digest"),
    ruleSetId: controlIdentifier(input.runtime.ruleSetId, "Closure rule-set identity"),
    ruleSetDigest: digest(input.runtime.ruleSetDigest, "Closure rule-set digest"),
  });
  const payload: ControlJsonObject = Object.freeze({
    schema: "lifecycle.closure-payload.v6",
    profileId: "lifecycle.delivery-closure.foundation-v1",
    disposition: transaction.disposition,
    transaction: Object.freeze({
      effectDigest: transaction.effectDigest,
      outcome: "applied",
      observationFactsSchema: transaction.observationFactsSchema,
      observationFactsDigest: transaction.observationFactsDigest,
      canonicalResultDigest: transaction.canonicalResultDigest,
      observedAt: transaction.observedAt,
    }),
    candidateTreatment,
    canonicalResult: acceptedResult,
    nonIntegrationVerified: transaction.disposition === "no-ship",
    terminalExecutions,
    reclamationHandoff,
    runtime,
    terminalAt,
  });
  const relationships: readonly ControlRecordRelationship[] = Object.freeze([
    relationship("closes-with", transaction.decision),
    ...(boundary === null ? [] : [relationship("governed-by", boundary)]),
    ...(transaction.disposition === "accepted"
      ? [
          relationship("accepts-candidate", candidate!),
          relationship("accepts-evidence", evidence!),
        ]
      : candidate === null ? [] : [relationship("abandons-candidate", candidate)]),
  ]);
  const owned = identities(input.store, activityId);
  const revisionInput = Object.freeze({
    recordId: owned.recordId,
    recordKind: "closure",
    revision: 1,
    producer: Object.freeze({ kind: "runtime" as const, id: runtimeId }),
    semanticAuthor: Object.freeze({ kind: "runtime" as const, id: runtimeId }),
    semanticAuthority: "runtime-derived" as const,
    createdAt: terminalAt,
    semanticMarkdown: semanticMarkdown({
      disposition: transaction.disposition,
      decision: transaction.decision,
      boundary,
      candidate,
      canonical: acceptedResult,
      transactionObservedAt: transaction.observedAt,
      terminalAt,
    }),
    payload,
    relationships,
  });
  const compiled = compileControlRecordRevision(input.store.identity.processId, revisionInput);
  assertDeliveryControlRecordPolicy(compiled);
  assertDeliveryControlRecordPayload(compiled);
  const append: ControlRecordStoreAppend = Object.freeze({
    revision: revisionInput,
    event: Object.freeze({
      eventId: owned.eventId,
      eventKind: "closure-recorded",
      occurredAt: terminalAt,
      actor: Object.freeze({ kind: "runtime" as const, id: runtimeId }),
      subject: Object.freeze({
        recordId: compiled.recordId,
        revision: compiled.revision,
        digest: compiled.digest,
      }),
      payload: Object.freeze({ activityId }),
    }),
  });
  return Object.freeze({ revision: compiled, append });
}

/**
 * Compile and atomically retain Delivery's final Control revision. The runtime
 * derives authority, subjects, transaction facts, identities, and disposition
 * from the exact Journal head; callers supply only fresh physical observations.
 */
export function retainClosure(
  input: CompileClosureAppendInput,
): Readonly<{ revision: ControlRecordRevision; event: ControlRecordEvent }> {
  const compiled = compileClosureAppend(input);
  const retained = input.store.append(compiled.append);
  if (retained.revision === null) fail("retention", "Closure revision was not retained");
  return Object.freeze({ revision: retained.revision, event: retained.event });
}
