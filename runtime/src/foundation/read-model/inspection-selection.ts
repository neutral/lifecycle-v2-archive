import {
  FoundationInspectionSelectionSchema,
  type FoundationInspectionSelection,
} from "@neutral/lifecycle-protocol";
import type { ControlRecordStore } from "../control/store.js";
import { FoundationError } from "../error.js";
import { createDeliveryReplay, type ReducedDeliveryState } from "../process/delivery-reducer.js";
import { canonicalJson } from "../validation/canonical.js";

type InspectionStore = Pick<ControlRecordStore, "identity" | "state" | "getRevision" | "listEvents">;

function refuse(message: string): never {
  throw new FoundationError("lifecycle.read-model.inspection-selection", message, { retryable: true });
}

/** Reuse the sole reducer to establish an exact historical read combination. */
export function resolveFoundationInspectionSelection(
  store: InspectionStore,
  input: FoundationInspectionSelection,
): ReducedDeliveryState {
  const selection = FoundationInspectionSelectionSchema.parse(input);
  if (selection.targetId !== store.identity.targetId || selection.storeId !== store.identity.storeId ||
      selection.processId !== store.identity.processId) refuse("Inspection selection names another Target, Store or Delivery");
  if (selection.origin.sequence > store.state().journal.eventCount) refuse("Inspection origin is not in the retained Journal");
  const replay = createDeliveryReplay((reference) => store.getRevision(reference.recordId, reference.revision));
  let sequence = 0;
  let digest: string | null = null;
  while (sequence < selection.origin.sequence) {
    const events = store.listEvents(sequence, Math.min(256, selection.origin.sequence - sequence));
    if (events.length === 0) refuse("Inspection origin is not a complete retained Journal prefix");
    for (const event of events) {
      replay.append(event);
      sequence = event.sequence;
      digest = event.digest;
    }
  }
  if (sequence !== selection.origin.sequence || digest !== selection.origin.digest) {
    refuse("Inspection origin does not reproduce its exact retained Journal prefix");
  }
  const state = replay.finish();
  const same = (left: Readonly<{ id: string; revision: number; digest: string }> | null,
    right: Readonly<{ id: string; revision: number; digest: string }> | null) =>
    canonicalJson(left) === canonicalJson(right === null ? null : { id: right.id, revision: right.revision, digest: right.digest });
  if (selection.schema === "lifecycle.context-selection.v1") {
    const expected = selection.boundary.role === "active" ? state.subjects.activeBoundary : state.subjects.proposedBoundary;
    if (!same(expected, selection.boundary.reference)) refuse("Inspection Boundary role and reference were not selected at the retained origin");
  } else if (!same(state.subjects.activeBoundary, selection.boundary) || !same(state.subjects.candidate, selection.candidate) ||
      !same(selection.subject === "decision" ? state.subjects.seal : null, selection.seal)) {
    refuse("Code Boundary, Candidate and Seal were not one exact selection at the retained origin");
  }
  return state;
}
