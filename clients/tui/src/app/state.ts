import {
  FOUNDATION_TUI_TAB_IDS,
  type FoundationTuiTabId,
} from "../domain/presentation.js";
import type { FoundationControlRecordKind } from "@neutral/lifecycle-protocol";

export const DASHBOARD_TABS = FOUNDATION_TUI_TAB_IDS;
export type DashboardTab = FoundationTuiTabId;

export type Viewport = Readonly<{ columns: number; rows: number }>;

export const FOUNDATION_TUI_NEXT_PASS_OPERATIONS = Object.freeze([
  "delivery.continue",
  "delivery.revise",
  "delivery.reaffirm",
  "delivery.evaluate",
] as const);
export type FoundationTuiNextPassOperation = typeof FOUNDATION_TUI_NEXT_PASS_OPERATIONS[number];

/** One selection is always bound to the exact runtime generation that produced it. */
export type LifecycleTuiDeliveryBinding = Readonly<{
  deliveryId: string;
  generation: string;
}>;

export type LifecycleTuiControlLevel = "families" | "records" | "revisions" | "revision";

export type LifecycleTuiControlItem = Readonly<{
  id: string;
  label: string;
  detail: string | null;
}>;

export type LifecycleTuiModal =
  | Readonly<{
    kind: "diff";
    deliveryId: string;
    generation: string;
    subject: "candidate" | "decision";
    title: string;
    body: string;
    truncated: boolean;
    stale: boolean;
  }>
  | Readonly<{
    kind: "control";
    deliveryId: string;
    generation: string;
    title: string;
    body: string;
    stale: boolean;
    level: LifecycleTuiControlLevel;
    recordKind: FoundationControlRecordKind | null;
    recordId: string | null;
    items: readonly LifecycleTuiControlItem[];
    selectedIndex: number;
    bounded: boolean;
    exactBody: string | null;
  }>;

export type LifecycleTuiMode = "dashboard" | "help" | "action-review" | "modal";
export type ObservationFreshness = "loading" | "live" | "stale";

export type LifecycleTuiState<Model> = Readonly<{
  model: Model | null;
  freshness: ObservationFreshness;
  failure: string | null;
  viewport: Viewport;
  tabIndex: number;
  selectedAction: number;
  reviewedAction: number | null;
  actionCount: number;
  mode: LifecycleTuiMode;
  refreshSequence: number;
  pendingRefresh: number | null;
  prepareSequence: number;
  pendingPrepare: number | null;
  prepareAvailable: boolean;
  admitActionIndex: number | null;
  selectedDelivery: LifecycleTuiDeliveryBinding | null;
  inboxSelectedIndex: number;
  inboxCount: number;
  frameDraft: string;
  frameEditing: boolean;
  frameFailure: string | null;
  nextPassOperation: FoundationTuiNextPassOperation | null;
  nextPassAvailable: readonly FoundationTuiNextPassOperation[];
  nextPassDraft: string;
  nextPassDraftBinding: LifecycleTuiDeliveryBinding | null;
  nextPassDraftStale: boolean;
  nextPassEditing: boolean;
  nextPassFailure: string | null;
  operationSequence: number;
  pendingOperation: Readonly<{
    sequence: number;
    operation: FoundationTuiNextPassOperation;
    binding: LifecycleTuiDeliveryBinding;
  }> | null;
  modal: LifecycleTuiModal | null;
  auxiliarySequence: number;
  pendingAuxiliary: Readonly<{
    sequence: number;
    kind: "diff" | "control";
    binding: LifecycleTuiDeliveryBinding;
  }> | null;
  lastObservedAt: number | null;
}>;

export function createLifecycleTuiState<Model>(viewport: Viewport): LifecycleTuiState<Model> {
  return Object.freeze({
    model: null,
    freshness: "loading",
    failure: null,
    viewport,
    tabIndex: 0,
    selectedAction: 0,
    reviewedAction: null,
    actionCount: 0,
    mode: "dashboard",
    refreshSequence: 0,
    pendingRefresh: null,
    prepareSequence: 0,
    pendingPrepare: null,
    prepareAvailable: false,
    admitActionIndex: null,
    selectedDelivery: null,
    inboxSelectedIndex: 0,
    inboxCount: 0,
    frameDraft: "",
    frameEditing: false,
    frameFailure: null,
    nextPassOperation: null,
    nextPassAvailable: Object.freeze([]),
    nextPassDraft: "",
    nextPassDraftBinding: null,
    nextPassDraftStale: false,
    nextPassEditing: false,
    nextPassFailure: null,
    operationSequence: 0,
    pendingOperation: null,
    modal: null,
    auxiliarySequence: 0,
    pendingAuxiliary: null,
    lastObservedAt: null,
  });
}

export function selectedDashboardTab(state: LifecycleTuiState<unknown>): DashboardTab {
  return DASHBOARD_TABS[state.tabIndex] ?? "now";
}
