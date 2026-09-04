import { normalizeFrameDraft, TUI_FRAME_DRAFT_MAXIMUM_BYTES } from "../view/sanitize.js";
import type { FoundationControlRecordKind } from "@neutral/lifecycle-protocol";
import {
  DASHBOARD_TABS,
  type FoundationTuiNextPassOperation,
  type LifecycleTuiDeliveryBinding,
  type LifecycleTuiModal,
  type LifecycleTuiState,
  type Viewport,
} from "./state.js";

export { TUI_FRAME_DRAFT_MAXIMUM_BYTES as FRAME_DRAFT_MAXIMUM_BYTES };

export type LifecycleTuiKey =
  | "next-region"
  | "previous-region"
  | "up"
  | "down"
  | "enter"
  | "escape"
  | "refresh"
  | "help"
  | "quit"
  | "handoff"
  | "cancel"
  | "edit-frame"
  | "submit-frame"
  | "use-plan"
  | "edit-next-pass"
  | "submit-next-pass"
  | "cycle-next-pass"
  | "select-delivery"
  | "show-diff"
  | "open-control";

export type LifecycleTuiEvent<Model> =
  | Readonly<{ kind: "start" }>
  | Readonly<{ kind: "timer" }>
  | Readonly<{ kind: "resize"; viewport: Viewport }>
  | Readonly<{
    kind: "frame-draft-changed";
    value: string;
    normalization?: Readonly<{ changed: boolean; byteLimited: boolean }>;
  }>
  | Readonly<{
    kind: "next-pass-draft-changed";
    value: string;
    normalization?: Readonly<{ changed: boolean; byteLimited: boolean }>;
  }>
  | Readonly<{
    kind: "delivery-selected";
    binding: LifecycleTuiDeliveryBinding;
    index: number;
  }>
  | Readonly<{
    kind: "refresh-succeeded";
    sequence: number;
    model: Model;
    actionCount: number;
    prepareAvailable?: boolean;
    admitActionIndex?: number | null;
    selectedDelivery?: LifecycleTuiDeliveryBinding | null;
    nextPassAvailable?: readonly FoundationTuiNextPassOperation[];
    inboxCount?: number;
    observedAt: number;
  }>
  | Readonly<{ kind: "refresh-failed"; sequence: number; message: string; observedAt: number }>
  | Readonly<{
    kind: "prepare-succeeded";
    sequence: number;
    model: Model;
    actionCount: number;
    prepareAvailable: boolean;
    admitActionIndex: number | null;
    selectedDelivery?: LifecycleTuiDeliveryBinding | null;
    nextPassAvailable?: readonly FoundationTuiNextPassOperation[];
    inboxCount?: number;
    status: "completed" | "refused" | "recovery-required" | "incomplete";
    observedAt: number;
  }>
  | Readonly<{
    kind: "prepare-failed";
    sequence: number;
    message: string;
    refreshRequired: boolean;
    observedAt: number;
  }>
  | Readonly<{
    kind: "operation-succeeded";
    sequence: number;
    model: Model;
    binding: LifecycleTuiDeliveryBinding;
    actionCount: number;
    prepareAvailable: boolean;
    admitActionIndex: number | null;
    nextPassAvailable: readonly FoundationTuiNextPassOperation[];
    inboxCount?: number;
    status: "completed" | "refused" | "recovery-required" | "incomplete";
    observedAt: number;
  }>
  | Readonly<{
    kind: "operation-failed";
    sequence: number;
    message: string;
    refreshRequired: boolean;
    observedAt: number;
  }>
  | Readonly<{
    kind: "auxiliary-succeeded";
    sequence: number;
    modal: LifecycleTuiModal;
  }>
  | Readonly<{ kind: "auxiliary-failed"; sequence: number; message: string }>
  | Readonly<{ kind: "key"; key: LifecycleTuiKey }>;

export type LifecycleTuiEffect =
  | Readonly<{ kind: "refresh"; sequence: number }>
  | Readonly<{ kind: "prepare"; sequence: number; input: string }>
  | Readonly<{
    kind: "execute-next-pass";
    sequence: number;
    operation: FoundationTuiNextPassOperation;
    binding: LifecycleTuiDeliveryBinding;
    input: string;
  }>
  | Readonly<{
    kind: "load-diff";
    sequence: number;
    binding: LifecycleTuiDeliveryBinding;
    subject: "candidate" | "decision";
  }>
  | Readonly<{
    kind: "load-control";
    sequence: number;
    binding: LifecycleTuiDeliveryBinding;
    selection:
      | Readonly<{ kind: "families" }>
      | Readonly<{ kind: "family"; recordKind: FoundationControlRecordKind }>
      | Readonly<{ kind: "revisions"; recordKind: FoundationControlRecordKind; recordId: string }>;
  }>
  | Readonly<{ kind: "replace-frame-draft"; value: string }>
  | Readonly<{ kind: "replace-next-pass-draft"; value: string }>
  | Readonly<{ kind: "cancel-refresh" }>
  | Readonly<{ kind: "cancel-prepare" }>
  | Readonly<{ kind: "cancel-operation" }>
  | Readonly<{ kind: "cancel-auxiliary" }>
  | Readonly<{ kind: "select-inbox-delivery"; index: number }>
  | Readonly<{ kind: "quit"; handoffActionIndex: number | null }>;

export type LifecycleTuiUpdate<Model> = Readonly<{
  state: LifecycleTuiState<Model>;
  effects: readonly LifecycleTuiEffect[];
}>;

function noEffects<Model>(state: LifecycleTuiState<Model>): LifecycleTuiUpdate<Model> {
  return Object.freeze({ state, effects: Object.freeze([]) });
}

function refresh<Model>(state: LifecycleTuiState<Model>): LifecycleTuiUpdate<Model> {
  if (state.pendingRefresh !== null || state.pendingPrepare !== null || state.pendingOperation !== null ||
      state.pendingAuxiliary !== null) return noEffects(state);
  const sequence = state.refreshSequence + 1;
  return Object.freeze({
    state: Object.freeze({ ...state, pendingRefresh: sequence, refreshSequence: sequence }),
    effects: Object.freeze([{ kind: "refresh", sequence } as const]),
  });
}

function sameBinding(
  left: LifecycleTuiDeliveryBinding | null,
  right: LifecycleTuiDeliveryBinding | null,
): boolean {
  return left !== null && right !== null &&
    left.deliveryId === right.deliveryId && left.generation === right.generation;
}

function beginNextPass<Model>(state: LifecycleTuiState<Model>): LifecycleTuiUpdate<Model> {
  const binding = state.selectedDelivery;
  const operation = state.nextPassOperation;
  const available = selectedTab(state) === "next-pass" && state.mode === "dashboard" &&
    state.nextPassEditing && binding !== null && operation !== null &&
    state.nextPassAvailable.includes(operation) && !state.nextPassDraftStale &&
    sameBinding(state.nextPassDraftBinding, binding) && state.freshness === "live" &&
    state.pendingRefresh === null && state.pendingPrepare === null && state.pendingOperation === null &&
    state.viewport.columns >= 40 && state.viewport.rows >= 12;
  if (!available) return noEffects(state);
  if (state.nextPassDraft.trim().length === 0) {
    return noEffects(Object.freeze({
      ...state,
      nextPassFailure: "Enter complete Founder direction for this exact next pass.",
    }));
  }
  const sequence = state.operationSequence + 1;
  return Object.freeze({
    state: Object.freeze({
      ...state,
      operationSequence: sequence,
      pendingOperation: Object.freeze({ sequence, operation, binding }),
      nextPassEditing: false,
      nextPassFailure: null,
    }),
    effects: Object.freeze([{
      kind: "execute-next-pass",
      sequence,
      operation,
      binding,
      input: state.nextPassDraft,
    } as const]),
  });
}

function beginAuxiliary<Model>(
  state: LifecycleTuiState<Model>,
  kind: "diff" | "control",
): LifecycleTuiUpdate<Model> {
  const binding = state.selectedDelivery;
  if (binding === null || state.freshness !== "live" || state.pendingAuxiliary !== null ||
      state.pendingRefresh !== null || state.pendingPrepare !== null || state.pendingOperation !== null) {
    return noEffects(state);
  }
  const sequence = state.auxiliarySequence + 1;
  const effect: LifecycleTuiEffect = kind === "diff"
    ? Object.freeze({
        kind: "load-diff",
        sequence,
        binding,
        subject: selectedTab(state) === "decision" ? "decision" : "candidate",
      })
    : Object.freeze({ kind: "load-control", sequence, binding, selection: Object.freeze({ kind: "families" as const }) });
  return Object.freeze({
    state: Object.freeze({
      ...state,
      auxiliarySequence: sequence,
      pendingAuxiliary: Object.freeze({ sequence, kind, binding }),
    }),
    effects: Object.freeze([effect]),
  });
}

function beginControlLoad<Model>(
  state: LifecycleTuiState<Model>,
  selection:
    | Readonly<{ kind: "families" }>
    | Readonly<{ kind: "family"; recordKind: FoundationControlRecordKind }>
    | Readonly<{ kind: "revisions"; recordKind: FoundationControlRecordKind; recordId: string }>,
): LifecycleTuiUpdate<Model> {
  const binding = state.selectedDelivery;
  if (binding === null || state.freshness !== "live" || state.pendingAuxiliary !== null ||
      state.pendingRefresh !== null || state.pendingPrepare !== null || state.pendingOperation !== null) {
    return noEffects(state);
  }
  const sequence = state.auxiliarySequence + 1;
  return Object.freeze({
    state: Object.freeze({
      ...state,
      auxiliarySequence: sequence,
      pendingAuxiliary: Object.freeze({ sequence, kind: "control" as const, binding }),
    }),
    effects: Object.freeze([{
      kind: "load-control" as const,
      sequence,
      binding,
      selection,
    }]),
  });
}

function clampAction(index: number, count: number): number {
  if (count <= 0) return 0;
  return Math.max(0, Math.min(index, count - 1));
}

function selectedTab<Model>(state: LifecycleTuiState<Model>): string {
  return DASHBOARD_TABS[state.tabIndex] ?? "now";
}

function prepare<Model>(state: LifecycleTuiState<Model>): LifecycleTuiUpdate<Model> {
  const available = selectedTab(state) === "frame" && state.mode === "dashboard" && state.frameEditing &&
    state.prepareAvailable && state.freshness === "live" && state.pendingRefresh === null &&
    state.pendingPrepare === null && state.viewport.columns >= 40 && state.viewport.rows >= 12;
  if (!available) return noEffects(state);
  if (state.frameDraft.trim().length === 0) {
    return noEffects(Object.freeze({ ...state, frameFailure: "Enter one complete Founder brief before running reconnaissance." }));
  }
  const sequence = state.prepareSequence + 1;
  return Object.freeze({
    state: Object.freeze({
      ...state,
      prepareSequence: sequence,
      pendingPrepare: sequence,
      frameEditing: false,
      frameFailure: null,
    }),
    effects: Object.freeze([{ kind: "prepare", sequence, input: state.frameDraft } as const]),
  });
}

export function updateLifecycleTui<Model>(state: LifecycleTuiState<Model>, event: LifecycleTuiEvent<Model>): LifecycleTuiUpdate<Model> {
  switch (event.kind) {
    case "start": return refresh(state);
    case "timer": return state.mode === "action-review" || state.mode === "modal" || state.frameEditing ||
      state.nextPassEditing || state.pendingPrepare !== null || state.pendingOperation !== null
      ? noEffects(state)
      : refresh(state);
    case "resize": return noEffects(Object.freeze({ ...state, viewport: event.viewport }));
    case "frame-draft-changed": {
      if (!state.frameEditing || selectedTab(state) !== "frame" || state.pendingPrepare !== null) return noEffects(state);
      const normalized = normalizeFrameDraft(event.value);
      const byteLimited = normalized.byteLimited || event.normalization?.byteLimited === true;
      const changed = normalized.changed || event.normalization?.changed === true;
      const next = Object.freeze({
        ...state,
        frameDraft: normalized.value,
        frameFailure: byteLimited
          ? `Founder input is limited to ${TUI_FRAME_DRAFT_MAXIMUM_BYTES} UTF-8 bytes.`
          : changed
            ? "Control characters were removed from Founder input."
            : null,
      });
      return Object.freeze({
        state: next,
        effects: normalized.changed
          ? Object.freeze([{ kind: "replace-frame-draft", value: normalized.value } as const])
          : Object.freeze([]),
      });
    }
    case "next-pass-draft-changed": {
      if (!state.nextPassEditing || selectedTab(state) !== "next-pass" || state.pendingOperation !== null) {
        return noEffects(state);
      }
      const normalized = normalizeFrameDraft(event.value);
      const byteLimited = normalized.byteLimited || event.normalization?.byteLimited === true;
      const changed = normalized.changed || event.normalization?.changed === true;
      const next = Object.freeze({
        ...state,
        nextPassDraft: normalized.value,
        nextPassFailure: byteLimited
          ? `Founder input is limited to ${TUI_FRAME_DRAFT_MAXIMUM_BYTES} UTF-8 bytes.`
          : changed
            ? "Control characters were removed from Founder input."
            : null,
      });
      return Object.freeze({
        state: next,
        effects: normalized.changed
          ? Object.freeze([{ kind: "replace-next-pass-draft", value: normalized.value } as const])
          : Object.freeze([]),
      });
    }
    case "delivery-selected": {
      const changed = !sameBinding(state.selectedDelivery, event.binding);
      return noEffects(Object.freeze({
        ...state,
        selectedDelivery: event.binding,
        inboxSelectedIndex: Math.max(0, event.index),
        tabIndex: DASHBOARD_TABS.indexOf("now"),
        nextPassDraftStale: state.nextPassDraftStale || (changed && state.nextPassDraft.length > 0),
        modal: state.modal === null ? null : Object.freeze({ ...state.modal, stale: changed || state.modal.stale }),
      }));
    }
    case "refresh-succeeded":
      if (event.sequence !== state.pendingRefresh) return noEffects(state);
      {
        const selectedDelivery = event.selectedDelivery === undefined
          ? state.selectedDelivery
          : event.selectedDelivery;
        const generationChanged = state.selectedDelivery !== null && selectedDelivery !== null &&
          state.selectedDelivery.deliveryId === selectedDelivery.deliveryId &&
          state.selectedDelivery.generation !== selectedDelivery.generation;
      return noEffects(Object.freeze({
        ...state,
        model: event.model,
        freshness: "live" as const,
        failure: null,
        pendingRefresh: null,
        actionCount: event.actionCount,
        selectedAction: clampAction(state.selectedAction, event.actionCount),
        reviewedAction: null,
        prepareAvailable: event.prepareAvailable ?? false,
        admitActionIndex: event.admitActionIndex ?? null,
        selectedDelivery,
        inboxSelectedIndex: clampAction(state.inboxSelectedIndex, event.inboxCount ?? 0),
        inboxCount: event.inboxCount ?? 0,
        nextPassAvailable: Object.freeze([...(event.nextPassAvailable ?? [])]),
        nextPassOperation: (event.nextPassAvailable ?? []).includes(state.nextPassOperation!)
          ? state.nextPassOperation
          : event.nextPassAvailable?.[0] ?? null,
        nextPassDraftStale: state.nextPassDraftStale || generationChanged,
        modal: state.modal === null
          ? null
          : Object.freeze({ ...state.modal, stale: state.modal.stale || generationChanged }),
        lastObservedAt: event.observedAt,
      }));
      }
    case "refresh-failed":
      if (event.sequence !== state.pendingRefresh) return noEffects(state);
      return noEffects(Object.freeze({
        ...state,
        freshness: "stale" as const,
        failure: event.message,
        pendingRefresh: null,
        prepareAvailable: false,
        admitActionIndex: null,
        lastObservedAt: event.observedAt,
      }));
    case "prepare-succeeded":
      if (event.sequence !== state.pendingPrepare) return noEffects(state);
      return noEffects(Object.freeze({
        ...state,
        model: event.model,
        freshness: "live" as const,
        failure: null,
        pendingPrepare: null,
        actionCount: event.actionCount,
        selectedAction: clampAction(state.selectedAction, event.actionCount),
        reviewedAction: null,
        prepareAvailable: event.prepareAvailable,
        admitActionIndex: event.admitActionIndex,
        selectedDelivery: event.selectedDelivery ?? state.selectedDelivery,
        inboxSelectedIndex: clampAction(state.inboxSelectedIndex, event.inboxCount ?? 0),
        inboxCount: event.inboxCount ?? 0,
        nextPassAvailable: Object.freeze([...(event.nextPassAvailable ?? [])]),
        nextPassOperation: (event.nextPassAvailable ?? []).includes(state.nextPassOperation!)
          ? state.nextPassOperation
          : event.nextPassAvailable?.[0] ?? null,
        frameDraft: event.status === "completed" ? "" : state.frameDraft,
        frameFailure: event.status === "completed"
          ? null
          : `Reconnaissance ended ${event.status}; the complete Founder input remains available.`,
        lastObservedAt: event.observedAt,
      }));
    case "prepare-failed": {
      if (event.sequence !== state.pendingPrepare) return noEffects(state);
      const failed = Object.freeze({
        ...state,
        pendingPrepare: null,
        frameEditing: false,
        frameFailure: event.message,
        lastObservedAt: event.observedAt,
      });
      return event.refreshRequired ? refresh(Object.freeze({
        ...failed,
        freshness: "stale" as const,
        failure: event.message,
        prepareAvailable: false,
        admitActionIndex: null,
      })) : noEffects(failed);
    }
    case "operation-succeeded": {
      if (event.sequence !== state.pendingOperation?.sequence) return noEffects(state);
      const completedCoherently = event.status === "completed" &&
        event.binding.deliveryId === state.pendingOperation.binding.deliveryId;
      const retainedDraftIsStale = !completedCoherently && state.nextPassDraft.length > 0 &&
        (state.nextPassDraftStale || !sameBinding(state.nextPassDraftBinding, event.binding));
      return noEffects(Object.freeze({
        ...state,
        model: event.model,
        freshness: "live" as const,
        failure: null,
        pendingOperation: null,
        selectedDelivery: event.binding,
        inboxCount: event.inboxCount ?? state.inboxCount,
        actionCount: event.actionCount,
        selectedAction: clampAction(state.selectedAction, event.actionCount),
        reviewedAction: null,
        prepareAvailable: event.prepareAvailable,
        admitActionIndex: event.admitActionIndex,
        nextPassAvailable: Object.freeze([...event.nextPassAvailable]),
        nextPassOperation: event.nextPassAvailable.includes(state.nextPassOperation!)
          ? state.nextPassOperation
          : event.nextPassAvailable[0] ?? null,
        nextPassDraft: completedCoherently ? "" : state.nextPassDraft,
        nextPassDraftBinding: completedCoherently ? event.binding : state.nextPassDraftBinding,
        nextPassDraftStale: retainedDraftIsStale,
        nextPassFailure: completedCoherently
          ? null
          : `The pass ended ${event.status}; Founder input remains available.`,
        modal: state.modal === null ? null : Object.freeze({ ...state.modal, stale: true }),
        lastObservedAt: event.observedAt,
      }));
    }
    case "operation-failed": {
      if (event.sequence !== state.pendingOperation?.sequence) return noEffects(state);
      const failed = Object.freeze({
        ...state,
        pendingOperation: null,
        nextPassEditing: false,
        nextPassFailure: event.message,
        lastObservedAt: event.observedAt,
      });
      return event.refreshRequired
        ? refresh(Object.freeze({ ...failed, freshness: "stale" as const, failure: event.message }))
        : noEffects(failed);
    }
    case "auxiliary-succeeded":
      if (event.sequence !== state.pendingAuxiliary?.sequence) return noEffects(state);
      return noEffects(Object.freeze({
        ...state,
        pendingAuxiliary: null,
        modal: event.modal,
        mode: "modal" as const,
      }));
    case "auxiliary-failed":
      if (event.sequence !== state.pendingAuxiliary?.sequence) return noEffects(state);
      return noEffects(Object.freeze({
        ...state,
        pendingAuxiliary: null,
        failure: event.message,
      }));
    case "key": break;
  }

  const key = event.key;
  if (state.mode === "modal" && state.modal?.kind === "control") {
    const modal = state.modal;
    if ((key === "up" || key === "down") && modal.level !== "revision" && modal.items.length > 0) {
      const delta = key === "up" ? -1 : 1;
      return noEffects(Object.freeze({
        ...state,
        modal: Object.freeze({
          ...modal,
          selectedIndex: Math.max(0, Math.min(modal.items.length - 1, modal.selectedIndex + delta)),
        }),
      }));
    }
    if (key === "enter" && !modal.stale && state.pendingAuxiliary === null) {
      const item = modal.items[modal.selectedIndex];
      if (item === undefined) return noEffects(state);
      if (modal.level === "families") {
        return beginControlLoad(state, {
          kind: "family",
          recordKind: item.id as FoundationControlRecordKind,
        });
      }
      if (modal.level === "records" && modal.recordKind !== null) {
        return beginControlLoad(state, {
          kind: "revisions",
          recordKind: modal.recordKind,
          recordId: item.id,
        });
      }
      if (modal.level === "revisions" && item.detail !== null) {
        return noEffects(Object.freeze({
          ...state,
          modal: Object.freeze({
            ...modal,
            level: "revision" as const,
            recordId: item.id,
            title: `Control revision · ${item.label}`,
            exactBody: item.detail,
          }),
        }));
      }
      return noEffects(state);
    }
    if (key === "escape") {
      if (modal.level === "revision") {
        return noEffects(Object.freeze({
          ...state,
          modal: Object.freeze({
            ...modal,
            level: "revisions" as const,
            title: `Control revisions · ${modal.recordId ?? "record"}`,
            exactBody: null,
          }),
        }));
      }
      if (modal.level === "revisions" && modal.recordKind !== null) {
        return beginControlLoad(state, { kind: "family", recordKind: modal.recordKind });
      }
      if (modal.level === "records") return beginControlLoad(state, { kind: "families" });
      return noEffects(Object.freeze({ ...state, mode: "dashboard" as const, modal: null }));
    }
  }
  if (key === "submit-frame") return prepare(state);
  if (key === "submit-next-pass") return beginNextPass(state);
  if (key === "show-diff") return beginAuxiliary(state, "diff");
  if (key === "open-control") return beginAuxiliary(state, "control");
  if (key === "cycle-next-pass" && selectedTab(state) === "next-pass" && state.nextPassAvailable.length > 1) {
    const current = state.nextPassOperation === null ? -1 : state.nextPassAvailable.indexOf(state.nextPassOperation);
    return noEffects(Object.freeze({
      ...state,
      nextPassOperation: state.nextPassAvailable[(current + 1) % state.nextPassAvailable.length]!,
      nextPassFailure: null,
    }));
  }
  if (key === "edit-next-pass" || (key === "enter" && selectedTab(state) === "next-pass" && state.mode === "dashboard")) {
    const available = state.selectedDelivery !== null && state.nextPassOperation !== null &&
      state.nextPassAvailable.includes(state.nextPassOperation) && state.freshness === "live" &&
      state.pendingRefresh === null && state.pendingOperation === null &&
      state.viewport.columns >= 40 && state.viewport.rows >= 12;
    return available ? noEffects(Object.freeze({
      ...state,
      nextPassEditing: true,
      nextPassFailure: null,
      nextPassDraftBinding: state.selectedDelivery,
      nextPassDraftStale: false,
    })) : noEffects(state);
  }
  if (key === "edit-frame" || (key === "enter" && selectedTab(state) === "frame" && state.mode === "dashboard")) {
    const available = state.prepareAvailable && state.freshness === "live" && state.pendingRefresh === null &&
      state.pendingPrepare === null && state.viewport.columns >= 40 && state.viewport.rows >= 12;
    return available
      ? noEffects(Object.freeze({ ...state, frameEditing: true, frameFailure: null }))
      : noEffects(state);
  }
  if (key === "use-plan") {
    const available = selectedTab(state) === "frame" && state.mode === "dashboard" && state.admitActionIndex !== null &&
      state.freshness === "live" && state.pendingRefresh === null && state.pendingPrepare === null &&
      state.viewport.columns >= 40 && state.viewport.rows >= 12;
    return available ? noEffects(Object.freeze({
      ...state,
      mode: "action-review" as const,
      reviewedAction: state.admitActionIndex,
      frameEditing: false,
    })) : noEffects(state);
  }
  if (key === "refresh") {
    return refresh(Object.freeze({ ...state, mode: "dashboard" as const, reviewedAction: null, frameEditing: false }));
  }
  if (key === "quit") {
    return Object.freeze({ state, effects: Object.freeze([
      ...(state.pendingRefresh === null ? [] : [{ kind: "cancel-refresh" } as const]),
      ...(state.pendingPrepare === null ? [] : [{ kind: "cancel-prepare" } as const]),
      ...(state.pendingOperation === null ? [] : [{ kind: "cancel-operation" } as const]),
      ...(state.pendingAuxiliary === null ? [] : [{ kind: "cancel-auxiliary" } as const]),
      { kind: "quit", handoffActionIndex: null } as const,
    ]) });
  }
  if (key === "cancel") {
    if (state.pendingAuxiliary !== null) return Object.freeze({ state, effects: Object.freeze([{ kind: "cancel-auxiliary" } as const]) });
    if (state.pendingOperation !== null) return Object.freeze({ state, effects: Object.freeze([{ kind: "cancel-operation" } as const]) });
    if (state.pendingPrepare !== null) return Object.freeze({ state, effects: Object.freeze([{ kind: "cancel-prepare" } as const]) });
    if (state.nextPassEditing) return noEffects(Object.freeze({ ...state, nextPassEditing: false }));
    if (state.frameEditing) return noEffects(Object.freeze({ ...state, frameEditing: false }));
    if (state.mode !== "dashboard") return noEffects(Object.freeze({ ...state, mode: "dashboard" as const, reviewedAction: null }));
    if (state.pendingRefresh !== null) return Object.freeze({ state, effects: Object.freeze([{ kind: "cancel-refresh" } as const]) });
    return Object.freeze({ state, effects: Object.freeze([{ kind: "quit", handoffActionIndex: null } as const]) });
  }
  if (key === "help") {
    return noEffects(Object.freeze({
      ...state,
      mode: (state.mode === "help" ? "dashboard" : "help") as "dashboard" | "help",
      reviewedAction: null,
      frameEditing: false,
      nextPassEditing: false,
    }));
  }
  if (key === "escape") return noEffects(Object.freeze({
    ...state,
    mode: "dashboard" as const,
    reviewedAction: null,
    frameEditing: false,
    nextPassEditing: false,
    modal: null,
  }));
  if (key === "handoff") {
    const selected = state.reviewedAction ?? state.selectedAction;
    const available = state.mode === "action-review" && state.freshness === "live" && state.pendingRefresh === null &&
      state.pendingPrepare === null && state.actionCount > 0 && state.viewport.columns >= 40 && state.viewport.rows >= 12;
    return Object.freeze({
      state,
      effects: available ? Object.freeze([{ kind: "quit", handoffActionIndex: selected } as const]) : Object.freeze([]),
    });
  }
  if (key === "enter") {
    if (selectedTab(state) === "inbox" && state.mode === "dashboard" && state.inboxCount > 0 &&
        state.pendingRefresh === null) {
      return Object.freeze({
        state,
        effects: Object.freeze([{ kind: "select-inbox-delivery", index: state.inboxSelectedIndex } as const]),
      });
    }
    if (state.actionCount === 0 || state.freshness !== "live" || state.pendingRefresh !== null || state.pendingPrepare !== null) return noEffects(state);
    return noEffects(Object.freeze({
      ...state,
      mode: (state.mode === "action-review" ? "dashboard" : "action-review") as "dashboard" | "action-review",
      reviewedAction: state.mode === "action-review" ? null : state.selectedAction,
    }));
  }
  if (key === "previous-region" || key === "next-region") {
    if (state.mode !== "dashboard") return noEffects(state);
    const delta = key === "previous-region" ? -1 : 1;
    return noEffects(Object.freeze({
      ...state,
      tabIndex: (state.tabIndex + DASHBOARD_TABS.length + delta) % DASHBOARD_TABS.length,
      frameEditing: false,
      nextPassEditing: false,
    }));
  }
  if (key === "up" && state.mode === "dashboard" && selectedTab(state) === "inbox") {
    return noEffects(Object.freeze({ ...state, inboxSelectedIndex: Math.max(0, state.inboxSelectedIndex - 1) }));
  }
  if (key === "down" && state.mode === "dashboard" && selectedTab(state) === "inbox") {
    return noEffects(Object.freeze({ ...state, inboxSelectedIndex: state.inboxSelectedIndex + 1 }));
  }
  if (key === "up" && state.mode === "dashboard" && selectedTab(state) === "now") {
    return noEffects(Object.freeze({ ...state, selectedAction: clampAction(state.selectedAction - 1, state.actionCount) }));
  }
  if (key === "down" && state.mode === "dashboard" && selectedTab(state) === "now") {
    return noEffects(Object.freeze({ ...state, selectedAction: clampAction(state.selectedAction + 1, state.actionCount) }));
  }
  return noEffects(state);
}
