import {
  FoundationControlFamilySummarySchema,
  FoundationDeliveryGenerationSchema,
  FoundationDeliveryViewSchema,
  type FoundationControlFamilySummary,
  type FoundationControlReference,
  type FoundationDeliveryActivityPresentation,
  type FoundationDeliveryGeneration,
  type FoundationDeliveryState,
  type FoundationDeliveryView,
  type FoundationRepositoryObservation,
} from "@neutral/lifecycle-protocol";
import {
  deliveryOperationDescriptor,
} from "../process/operation-registry.js";
import {
  foundationActivitySupportBindingDigestV7,
} from "../process/activity-kernel-v7.js";
import { digestCanonical, type Sha256 } from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import { compileFoundationAttemptView } from "./attempt-view.js";
import { deliveryControlRecordPolicies } from "./kind-registry.js";
import type { DeliveryControlPhysicalDisposition } from "./public-view.js";
import { publicDeliveryState } from "./public-view.js";
import type { ControlRecordStore } from "./store.js";
import type { ControlJsonObject, ControlJsonValue, ControlRecordRevision } from "./types.js";

const NEXT_PASS_OPERATIONS = Object.freeze([
  "delivery.continue",
  "delivery.evaluate",
  "delivery.revise",
  "delivery.reaffirm",
] as const);

type NextPassOperation = typeof NEXT_PASS_OPERATIONS[number];

const CONSEQUENCES: Readonly<Record<NextPassOperation, string>> = Object.freeze({
  "delivery.continue": "Start one freshly funded bounded development pass on the exact current Candidate.",
  "delivery.evaluate": "Seal the exact current Candidate and run its required Checks and independent review.",
  "delivery.revise": "Prepare a changed Work Boundary proposal while preserving Candidate continuity.",
  "delivery.reaffirm": "Prepare the unchanged Work Boundary for readmission while preserving Candidate continuity.",
});

function objectValue(value: ControlJsonValue | undefined): ControlJsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as ControlJsonObject
    : null;
}

function arrayValue(value: ControlJsonValue | undefined): readonly ControlJsonValue[] {
  return Array.isArray(value) ? value : Object.freeze([]);
}

function stringValue(value: ControlJsonValue | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function plain(value: string | null, fallback: string): string {
  const selected = (value ?? fallback).replace(/\u0000/gu, "").slice(0, 16_384);
  return selected.length > 0 ? selected : fallback;
}

function reference(revision: ControlRecordRevision): FoundationControlReference {
  return Object.freeze({
    kind: revision.recordKind,
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  }) as FoundationControlReference;
}

function exactRevision(
  store: ControlRecordStore,
  selected: FoundationControlReference | null,
): ControlRecordRevision | null {
  if (selected === null) return null;
  const revision = store.getRevision(selected.id, selected.revision);
  return revision !== null && revision.recordKind === selected.kind && revision.digest === selected.digest
    ? revision
    : null;
}

function semanticStatement(value: ControlJsonValue, fallback: string) {
  const object = objectValue(value);
  const id = stringValue(object?.id) ?? null;
  const statement = stringValue(object?.statement) ?? stringValue(object?.text) ??
    stringValue(object?.rationale) ?? stringValue(object?.path) ?? fallback;
  const uncertainty = stringValue(object?.uncertainty);
  return Object.freeze({
    id,
    statement: plain(statement, fallback),
    uncertainty: uncertainty === "none" || uncertainty === "bounded" ||
        uncertainty === "material" || uncertainty === "unknown"
      ? uncertainty
      : null,
  });
}

function attemptView(
  store: ControlRecordStore,
  physical: DeliveryControlPhysicalDisposition,
) {
  return compileFoundationAttemptView({
    store,
    physical,
    selection: Object.freeze({ kind: "latest-attempt" }),
  });
}

function presentationStage(value: string): FoundationDeliveryActivityPresentation["stage"] {
  switch (value) {
    case "effect-intended":
      return "provider-running";
    case "effect-observed":
      return "semantic-result-observed";
    case "workspace-observed":
      return "semantic-compilation";
    case "candidate-observed":
      return "candidate-observation";
    case "receipt-retained":
    case "submitted":
    case "finalizing":
      return "completion";
    default:
      return "attempt-preparation";
  }
}

export function deliveryActivityPresentation(
  _store: ControlRecordStore,
  state: FoundationDeliveryState,
): FoundationDeliveryActivityPresentation | null {
  const activity = state.activities.find(({ stage }) => stage !== "completed") ?? null;
  if (activity === null) return null;
  if (activity.family === "transaction") {
    return Object.freeze({
      activityId: activity.id,
      operation: activity.operation,
      stage: state.recovery === null ? "transaction" : "recovery",
    });
  }
  return Object.freeze({
    activityId: activity.id,
    operation: activity.operation,
    stage: state.recovery === null ? presentationStage(activity.stage) : "recovery",
  });
}

function operationSupportBindingDigest(
  store: ControlRecordStore,
  state: FoundationDeliveryState,
): Sha256 | null {
  const activity = state.activities.find(({ stage }) => stage !== "completed") ?? null;
  if (activity === null) return null;
  return foundationActivitySupportBindingDigestV7({
    store,
    activityId: activity.id,
  });
}

export function compileDeliveryGeneration(input: Readonly<{
  store: ControlRecordStore;
  physical: DeliveryControlPhysicalDisposition;
  repository: Pick<FoundationRepositoryObservation, "headCommit" | "headTree" | "repositoryContractDigest">;
  state?: FoundationDeliveryState;
}>): FoundationDeliveryGeneration {
  const state = input.state ?? publicDeliveryState(input.store, input.physical);
  if (
    input.repository.headCommit === null || input.repository.headTree === null ||
    input.repository.repositoryContractDigest === null
  ) {
    throw new TypeError("Delivery generation requires one exact valid repository epoch");
  }
  const source = {
    schema: "lifecycle.delivery-generation.v1",
    storeId: state.storeId,
    processId: state.processId,
    journal: state.journal,
    storeDisposition: state.storeDisposition,
    repository: {
      headCommit: input.repository.headCommit,
      headTree: input.repository.headTree,
      repositoryContractDigest: input.repository.repositoryContractDigest,
    },
    activeOperation: deliveryActivityPresentation(input.store, state),
  } as const;
  // This private binding makes the public token advance without publishing a
  // recovery coordinate or creating another public workflow/state field.
  const digest = digestCanonical({
    schema: "lifecycle.delivery-read-generation-token.v1",
    publicSubject: source,
    operationSupportBindingDigest: operationSupportBindingDigest(input.store, state),
  });
  return FoundationDeliveryGenerationSchema.parse({ ...source, digest });
}

export function compileControlFamilyIndex(
  store: ControlRecordStore,
): readonly FoundationControlFamilySummary[] {
  return Object.freeze(deliveryControlRecordPolicies().map(({ kind }) => {
    const family = store.inspectRecordFamily(kind);
    return FoundationControlFamilySummarySchema.parse({
      recordKind: family.recordKind,
      recordCount: family.recordCount,
      revisionCount: family.revisionCount,
      current: family.current === null ? null : reference(family.current),
    });
  }).sort((left, right) => compareCodePoints(left.recordKind, right.recordKind)));
}

function boundaryProposal(
  store: ControlRecordStore,
  state: FoundationDeliveryState,
) {
  const selected = state.subjects.proposedBoundary ?? state.subjects.activeBoundary;
  const revision = exactRevision(store, selected);
  if (selected === null || revision === null) return null;
  const mandate = objectValue(revision.payload.mandate);
  const objective = objectValue(mandate?.objective);
  const proposalKind = stringValue(revision.payload.proposalKind);
  if (proposalKind !== "initial" && proposalKind !== "revision" && proposalKind !== "reaffirmation") {
    return null;
  }
  return Object.freeze({
    reference: selected,
    proposalKind,
    objective: plain(stringValue(objective?.text) ?? stringValue(mandate?.objective), "Work Boundary objective"),
  });
}

function typedSemantics(
  store: ControlRecordStore,
  state: FoundationDeliveryState,
  view: ReturnType<typeof attemptView>,
) {
  const semantics = view?.agentSemantics ?? null;
  const role = objectValue(semantics?.roleSemantics ?? undefined);
  const uncertainty = objectValue(semantics?.uncertainty ?? undefined);
  const effects = arrayValue(role?.effects);
  const requiredChecks = (view?.processAndProof.checks ?? []).map((check) => {
    const definition = objectValue(check.definition);
    const receipt = check.final ?? check.baseline;
    const disposition = receipt?.disposition ?? "not-run";
    const status = disposition === "pass"
      ? "passed"
      : disposition === "fail"
        ? "failed"
        : disposition === "not-run"
          ? "not-run"
          : "incomplete";
    return Object.freeze({
      selectionId: check.selectionId,
      statement: plain(stringValue(definition?.purpose), check.selectionId),
      status,
    });
  });
  return Object.freeze({
    outcome: Object.freeze({
      disposition: semantics?.disposition ?? null,
      summary: semantics === null ? null : stringValue(semantics.summary?.text),
      uncertainty: uncertainty === null ? null : stringValue(uncertainty.level),
    }),
    claims: Object.freeze((semantics?.claims ?? []).map((value, index) =>
      semanticStatement(value, `Claim ${index + 1}`))),
    proposedEffects: Object.freeze(effects.map((value, index) =>
      semanticStatement(value, `Proposed effect ${index + 1}`))),
    limitations: Object.freeze((semantics?.limitations ?? []).map((value, index) =>
      semanticStatement(value, `Limitation ${index + 1}`))),
    requiredChecks: Object.freeze(requiredChecks),
    boundaryProposal: boundaryProposal(store, state),
  });
}

function decisionReadiness(
  state: FoundationDeliveryState,
  view: ReturnType<typeof attemptView>,
) {
  const role = objectValue(view?.agentSemantics.roleSemantics ?? undefined);
  const reviewer = arrayValue(role?.judgments);
  const uncertainty = objectValue(view?.agentSemantics.uncertainty ?? undefined);
  const evidence = view?.processAndProof.evidence ?? null;
  const checks = (view?.processAndProof.checks ?? []).map((check) => {
    const receipt = check.final ?? check.baseline;
    return Object.freeze({
      selectionId: check.selectionId,
      disposition: receipt?.disposition ?? "not-run",
      receipt: receipt?.reference ?? null,
    });
  });
  const terminalChoices = state.eligibleOperations.filter((operation) =>
    operation === "delivery.accept" || operation === "delivery.no-ship");
  return Object.freeze({
    boundary: state.subjects.activeBoundary,
    candidate: state.subjects.candidate,
    changedSubjects: Object.freeze((view?.candidateTransition.changedSubjects ?? []).map((value, index) =>
      semanticStatement(value, `Changed subject ${index + 1}`))),
    seal: state.subjects.seal,
    checks: Object.freeze(checks),
    reviewerFindings: Object.freeze(reviewer.map((value, index) =>
      semanticStatement(value, `Reviewer finding ${index + 1}`))),
    uncertainty: uncertainty === null ? null : stringValue(uncertainty.level),
    limitations: Object.freeze((view?.agentSemantics.limitations ?? []).map((value, index) =>
      semanticStatement(value, `Limitation ${index + 1}`))),
    evidence: state.subjects.evidence,
    evidenceReadiness: evidence?.readiness ?? null,
    terminalChoices: Object.freeze(terminalChoices),
  });
}

export function compileDeliveryView(input: Readonly<{
  store: ControlRecordStore;
  physical: DeliveryControlPhysicalDisposition;
  repository: FoundationRepositoryObservation;
  investment: Readonly<{ model: string; reasoning: string }>;
}>): FoundationDeliveryView {
  const state = publicDeliveryState(input.store, input.physical);
  const generation = compileDeliveryGeneration({
    store: input.store,
    physical: input.physical,
    repository: input.repository,
    state,
  });
  const latestAttempt = attemptView(input.store, input.physical);
  const nextPass = NEXT_PASS_OPERATIONS.map((operation) => {
    const descriptor = deliveryOperationDescriptor(operation);
    return Object.freeze({
      operation,
      eligible: state.eligibleOperations.includes(operation),
      role: descriptor.role!,
      boundary: state.subjects.activeBoundary ?? state.subjects.proposedBoundary,
      candidate: state.subjects.candidate,
      consequence: CONSEQUENCES[operation],
      investment: Object.freeze({
        freshness: "fresh-on-invocation" as const,
        model: input.investment.model,
        reasoning: input.investment.reasoning,
        wallTimeMs: 30 * 60 * 1_000,
        maximumOutputBytes: 64 * 1024,
      }),
    });
  });
  return FoundationDeliveryViewSchema.parse({
    schema: "lifecycle.delivery-view.v1",
    generation,
    state,
    currentSubjects: state.subjects,
    semantics: typedSemantics(input.store, state, latestAttempt),
    nextPass,
    decisionReadiness: decisionReadiness(state, latestAttempt),
    activity: generation.activeOperation,
    controlFamilies: compileControlFamilyIndex(input.store),
  });
}

export function deliveryLabel(store: ControlRecordStore): string {
  const briefs = store.listCurrentRevisions({ recordKinds: ["founder-brief"], limit: 1_000 });
  const initial = briefs.find((brief) => brief.payload.operation === "delivery.prepare") ?? briefs[0] ?? null;
  if (initial === null) return plain(null, `Delivery ${store.identity.processId}`);
  const lines = initial.semanticMarkdown.split("\n").map((value) => value.trim());
  const semanticLine = lines
    .filter((value) => value.length > 0 && !/^#{1,6}\s+/u.test(value) && !/^```/u.test(value))
    .map((value) => value
      .replace(/^>\s*/u, "")
      .replace(/^(?:[-*+]\s+|[0-9]+\.\s+)/u, "")
      .trim())
    .find((value) => value.length > 0) ?? null;
  const genericHeadings = new Set([
    "delivery", "founder brief", "frame", "objective", "reconnaissance", "request", "summary",
  ]);
  const meaningfulHeading = lines
    .filter((value) => /^#{1,6}\s+/u.test(value))
    .map((value) => value.replace(/^#{1,6}\s+/u, "").trim())
    .find((value) => value.length > 0 && !genericHeadings.has(value.toLowerCase())) ?? null;
  return plain(
    semanticLine ?? meaningfulHeading,
    `Delivery ${store.identity.processId}`,
  ).slice(0, 160);
}

export function latestMilestone(store: ControlRecordStore, state: FoundationDeliveryState) {
  if (state.journal.headSequence === null) return null;
  const event = store.listEvents(state.journal.headSequence - 1, 1)[0] ?? null;
  return event === null
    ? null
    : Object.freeze({
        sequence: event.sequence,
        eventKind: event.eventKind,
        occurredAt: event.occurredAt,
        digest: event.digest as Sha256,
      });
}
