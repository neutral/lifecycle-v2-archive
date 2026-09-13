import type {
  compileFoundationCheckCellResourceSelectionV1,
  FoundationCheckCellOperationRequestV1,
} from "../check/execution-cell-v1.js";
import { FoundationError } from "../error.js";
import type { FoundationAgentExecutionSelectionV1 } from "../execution/agent-selection-v1.js";
import { canonicalJson, type Sha256 } from "../validation/canonical.js";
import type { AgentAttemptExecution, AgentAttemptInvestment, AgentAttemptProvider, AgentAttemptRole } from "./agent-attempt.js";
import { controlIdentifier } from "./model.js";
import { assertDeliveryControlRecordPayload } from "./payload-registry.js";
import type { ControlRecordStore } from "./store.js";
import type { ControlRecordEvent, ControlRecordRevision } from "./types.js";
import {
  parseWorkDelegationReservation,
  type WorkDelegationExecutionSlot,
  type WorkDelegationReservation,
} from "./work-delegation.js";

export type WorkDelegationExecutionReadStore = Pick<ControlRecordStore, "identity" | "listEvents"> & Readonly<{
  state(): Pick<ReturnType<ControlRecordStore["state"]>, "journal">;
}>;
export type WorkDelegationAgentSlot = Extract<WorkDelegationExecutionSlot, { purpose: "agent" }>;
export type WorkDelegationCheckSlot = Extract<WorkDelegationExecutionSlot, { purpose: "check" }>;
export type WorkDelegationExecution = Readonly<{
  opening: Readonly<{ eventId: string; sequence: number; digest: Sha256 }>;
  activityId: string;
  operation: string;
  reservation: WorkDelegationReservation | null;
}>;

function fail(reason: string): never {
  throw new FoundationError("lifecycle.work-delegation.execution-binding",
    "Execution must match its exact retained Activity resource reservation", {
      observedFacts: Object.freeze({ reason }),
    });
}

/**
 * Read one opening from a captured, owner-verified Journal prefix. This is a
 * historical resource binding, not current permission or a second reservation.
 * The caller still owns verified Store custody and all execution checks.
 */
export function readWorkDelegationExecution(input: Readonly<{
  store: WorkDelegationExecutionReadStore;
  activityId: string;
}>): WorkDelegationExecution {
  const activityId = controlIdentifier(input.activityId, "Reserved Activity identity");
  const head = input.store.state().journal;
  if (!Number.isSafeInteger(head.eventCount) || head.eventCount < 1 || head.headDigest === null) fail("journal");
  let cursor = 0;
  let predecessorDigest: Sha256 | null = null;
  let opening: ControlRecordEvent | null = null;
  while (cursor < head.eventCount) {
    const count = Math.min(1_000, head.eventCount - cursor);
    const page = input.store.listEvents(cursor, count);
    if (page.length !== count) fail("journal-prefix");
    for (const event of page) {
      if (event.sequence !== cursor + 1 || event.storeId !== input.store.identity.storeId ||
          event.processId !== input.store.identity.processId || event.predecessorDigest !== predecessorDigest) {
        fail("journal-prefix");
      }
      if (event.eventKind === "activity-started" && event.payload.activityId === activityId) {
        if (opening !== null) fail("duplicate-opening");
        opening = event;
      }
      cursor = event.sequence;
      predecessorDigest = event.digest;
    }
  }
  if (predecessorDigest !== head.headDigest) fail("journal-prefix");
  if (opening === null) fail("missing-opening");
  const hasReservation = Object.hasOwn(opening.payload, "reservation");
  const keys = hasReservation ? ["activityId", "operation", "reservation"] : ["activityId", "operation"];
  if (opening.subject !== null || Object.keys(opening.payload).length !== keys.length ||
      Object.keys(opening.payload).some(key => !keys.includes(key)) || typeof opening.payload.operation !== "string") {
    fail("opening-shape");
  }
  const reservation = hasReservation ? parseWorkDelegationReservation(opening.payload.reservation) : null;
  if (reservation !== null && (reservation.activityId !== activityId || reservation.operation !== opening.payload.operation ||
      reservation.decision.journalHead.sequence !== opening.sequence - 1 ||
      reservation.decision.journalHead.digest !== opening.predecessorDigest)) {
    fail("opening-reservation");
  }
  return Object.freeze({
    opening: Object.freeze({ eventId: opening.eventId, sequence: opening.sequence, digest: opening.digest }),
    activityId, operation: opening.payload.operation, reservation,
  });
}

/** Null means an ordinary opening, never a missing slot in delegated work. */
export function workDelegationAgentSlot(binding: WorkDelegationExecution, role: AgentAttemptRole): WorkDelegationAgentSlot | null {
  if (binding.reservation === null) return null;
  const slots = binding.reservation.slots.filter((slot): slot is WorkDelegationAgentSlot => slot.purpose === "agent" && slot.role === role);
  if (slots.length !== 1) fail("agent-slot");
  return slots[0]!;
}

/** Exact selectionId distinguishes multiple admitted uses of one Definition. */
export function workDelegationCheckSlot(
  binding: WorkDelegationExecution,
  selectionId: string,
  phase: FoundationCheckCellOperationRequestV1["phase"],
): WorkDelegationCheckSlot | null {
  if (binding.reservation === null) return null;
  const slots = binding.reservation.slots.filter((slot): slot is WorkDelegationCheckSlot =>
    slot.purpose === "check" && slot.selectionId === selectionId && slot.phase === phase);
  if (slots.length !== 1) fail("check-slot");
  return slots[0]!;
}

type AgentResourceFacts = Readonly<{
  provider: Pick<AgentAttemptProvider, "descriptorId" | "descriptorDigest">;
  execution: Pick<AgentAttemptExecution, "backendProfile" | "image">;
  investment: Pick<AgentAttemptInvestment, "model" | "reasoning" | "wallTimeMs" | "limits">;
}>;

/** Compare already owner-validated Attempt/installed facts; this grants no authority. */
export function workDelegationAgentSelectionMatches(slot: WorkDelegationAgentSlot, actual: AgentResourceFacts): boolean {
  return canonicalJson(slot.selection) === canonicalJson({
    providerDescriptor: { id: actual.provider.descriptorId, digest: actual.provider.descriptorDigest },
    backendProfile: actual.execution.backendProfile,
    image: actual.execution.image,
    model: actual.investment.model,
    reasoning: actual.investment.reasoning,
    wallTimeMs: actual.investment.wallTimeMs,
    limits: actual.investment.limits,
  });
}

/**
 * One schema-owned projection for an exact retained Attempt. Callers establish
 * the Activity/record join; this validates shape and compares only resources.
 */
export function workDelegationAgentAttemptMatches(slot: WorkDelegationAgentSlot, attempt: ControlRecordRevision): boolean {
  if (attempt.recordKind !== "agent-attempt") fail("attempt-kind");
  assertDeliveryControlRecordPayload(attempt);
  // The selected family schema owns these structures; callers need no casts or
  // independent interpretation of its provider/execution/Investment members.
  const payload = attempt.payload as unknown as AgentResourceFacts & Readonly<{ role: AgentAttemptRole }>;
  return payload.role === slot.role && workDelegationAgentSelectionMatches(slot, payload);
}

/** Use the existing parsed private selection; never reselect current defaults. */
export function workDelegationRetainedAgentSelectionMatches(slot: WorkDelegationAgentSlot, actual: Readonly<{
  selection: FoundationAgentExecutionSelectionV1;
  investment: AgentResourceFacts["investment"];
}>): boolean {
  const { provider, profile, image } = actual.selection.compiled.installed;
  return workDelegationAgentSelectionMatches(slot, {
    provider,
    execution: {
      backendProfile: { profileId: profile.profileId, profileDigest: profile.digest, implementationDigest: profile.implementation.implementationDigest },
      image: { imageId: image.imageId, imageDigest: image.imageDigest },
    },
    investment: actual.investment,
  });
}

/** Check semantic occurrence, selected Binding and all effective Cell limits. */
export function workDelegationCheckSelectionMatches(slot: WorkDelegationCheckSlot, actual: Readonly<{
  request: Pick<FoundationCheckCellOperationRequestV1, "selectionId" | "phase" | "definition" | "bindingId" | "binding">;
  resources: ReturnType<typeof compileFoundationCheckCellResourceSelectionV1>;
}>): boolean {
  const { request, resources } = actual;
  return request.bindingId === request.binding.id && canonicalJson({
    phase: slot.phase, selectionId: slot.selectionId, definition: slot.definition, binding: slot.binding,
    backendProfile: slot.backendProfile, image: slot.image, wallTimeMs: slot.wallTimeMs, limits: slot.limits,
  }) === canonicalJson({
    phase: request.phase, selectionId: request.selectionId, definition: request.definition,
    binding: { id: request.bindingId, digest: request.binding.digest },
    backendProfile: resources.backendProfile, image: resources.image,
    wallTimeMs: resources.limits.wallTimeMilliseconds, limits: resources.limits,
  });
}
