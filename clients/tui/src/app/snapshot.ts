import type {
  FoundationDeliveryInbox,
  FoundationDeliveryView,
  FoundationRuntimeObservation,
  FoundationRuntimeOperationKind,
} from "@neutral/lifecycle-protocol";
import type {
  FoundationAttemptViewResult,
  FoundationCliError,
  FoundationDeliveryViewResult,
  FoundationInboxOperationResult,
  FoundationPrepareResult,
  FoundationStatusResult,
  FoundationValidationResult,
} from "../adapters/cli/transport.js";
import {
  createFoundationTuiPresentation,
  type FoundationTuiAttemptViewState,
  type FoundationTuiPresentation,
} from "../domain/presentation.js";

export type ObservedLifecycleTuiSnapshot = Readonly<{
  kind: "observed";
  result: FoundationStatusResult | FoundationPrepareResult | FoundationAttemptViewResult |
    FoundationDeliveryViewResult;
  observation: FoundationRuntimeObservation;
  presentation: FoundationTuiPresentation;
  deliveryView: FoundationDeliveryView | null;
  inbox: FoundationDeliveryInbox | null;
}>;

export type InboxLifecycleTuiSnapshot = Readonly<{
  kind: "inbox";
  result: FoundationInboxOperationResult;
  inbox: FoundationDeliveryInbox;
}>;

export type SetupLifecycleTuiSnapshot = Readonly<{
  kind: "setup-needed";
  target: string;
  source: Readonly<{
    kind: "cli-refusal";
    failure: FoundationCliError;
  }> | Readonly<{
    kind: "repository-observation";
    result: FoundationValidationResult;
  }>;
}>;

/** A fresh Frame has no Delivery identity yet, so it deliberately has no status result. */
export type FrameReadyLifecycleTuiSnapshot = Readonly<{
  kind: "frame-ready";
  target: string;
}>;

export type LifecycleTuiSnapshot = InboxLifecycleTuiSnapshot | ObservedLifecycleTuiSnapshot |
  SetupLifecycleTuiSnapshot | FrameReadyLifecycleTuiSnapshot;

export const FOUNDATION_TUI_AUTHORITY_SECRET_FILE_RULE =
  "Use one owner-private, non-symlink regular file containing valid NUL-free UTF-8 encoded as 32–4096 bytes. The exact bytes are untrimmed; any trailing line ending is part of the secret.";

export type LifecycleTuiReviewAction = Readonly<{
  title: string;
  operationId: string;
  protocolOperation: FoundationRuntimeOperationKind;
  summary: string;
  consequence: string;
  badges: readonly string[];
  expectedStateRelationship: string;
  requiredInputIds: readonly string[];
  founderAuthorityRequired: boolean;
  authoritySecretFileRule: string | null;
  investmentPerInvocation: boolean;
  capabilityProfileIds: null;
  handoffScopeNote: string | null;
}>;

export function createObservedLifecycleTuiSnapshot(
  result: FoundationStatusResult,
): ObservedLifecycleTuiSnapshot {
  return Object.freeze({
    kind: "observed",
    result,
    observation: result.observation,
    presentation: createFoundationTuiPresentation(result.observation),
    deliveryView: null,
    inbox: null,
  });
}

export function createInboxLifecycleTuiSnapshot(
  result: FoundationInboxOperationResult,
): InboxLifecycleTuiSnapshot {
  if (result.operation !== "delivery.inbox" || result.status !== "completed" ||
      result.value === null || !("kind" in result.value) || result.value.kind !== "inbox") {
    throw new Error("Completed Inbox read did not return one exact runtime-owned Inbox projection");
  }
  if (!result.observation.repository.initialized || !result.observation.repository.valid ||
      result.observation.delivery !== null) {
    throw new Error("Completed Inbox read did not bind one valid initialized repository aggregate");
  }
  return Object.freeze({ kind: "inbox", result, inbox: result.value.view });
}

export function createDeliveryViewLifecycleTuiSnapshot(
  result: FoundationDeliveryViewResult,
  inbox: FoundationDeliveryInbox | null = null,
): ObservedLifecycleTuiSnapshot {
  if (result.operation !== "delivery.inspect" || result.status !== "completed" ||
      result.value === null || !("kind" in result.value) || result.value.kind !== "delivery-view") {
    throw new Error("Completed Delivery inspection did not return one exact runtime-owned Delivery view");
  }
  const view = result.value.view;
  if (result.deliveryId === null || view.generation.processId !== result.deliveryId ||
      result.observation.delivery?.processId !== result.deliveryId) {
    throw new Error("Completed Delivery view did not bind one exact Delivery identity");
  }
  return Object.freeze({
    kind: "observed",
    result,
    observation: result.observation,
    deliveryView: view,
    inbox,
    presentation: createFoundationTuiPresentation(result.observation, undefined, view),
  });
}

export function createInspectedLifecycleTuiSnapshot(
  result: FoundationAttemptViewResult,
): ObservedLifecycleTuiSnapshot {
  if (result.operation !== "delivery.inspect" || result.status !== "completed" ||
      result.value === null || !("kind" in result.value) || result.value.kind !== "attempt-view") {
    throw new Error("Completed Attempt View inspection did not return one exact Attempt View result");
  }
  if (result.deliveryId === null || result.observation.delivery?.processId !== result.deliveryId) {
    throw new Error("Completed Attempt View inspection did not bind one exact Delivery identity");
  }
  const attemptViewState: FoundationTuiAttemptViewState = result.value.view === null
    ? Object.freeze({ kind: "empty" })
    : Object.freeze({ kind: "available", view: result.value.view });
  return Object.freeze({
    kind: "observed",
    result,
    observation: result.observation,
    presentation: createFoundationTuiPresentation(result.observation, attemptViewState),
    deliveryView: null,
    inbox: null,
  });
}

export function createPreparedLifecycleTuiSnapshot(
  result: FoundationPrepareResult,
  attemptViewState: FoundationTuiAttemptViewState = Object.freeze({
    kind: "unavailable",
    message: "Preparation completed, but its derived Attempt View has not been inspected yet.",
  }),
): ObservedLifecycleTuiSnapshot {
  return Object.freeze({
    kind: "observed",
    result,
    observation: result.observation,
    presentation: createFoundationTuiPresentation(result.observation, attemptViewState),
    deliveryView: null,
    inbox: null,
  });
}

export function createSetupLifecycleTuiSnapshot(
  target: string,
  failure: FoundationCliError,
): SetupLifecycleTuiSnapshot {
  return Object.freeze({
    kind: "setup-needed",
    target,
    source: Object.freeze({ kind: "cli-refusal", failure }),
  });
}

export function createUninitializedLifecycleTuiSnapshot(
  target: string,
  result: FoundationValidationResult,
): SetupLifecycleTuiSnapshot {
  if (
    result.operation !== "repository.validate" || result.status !== "completed" ||
    result.deliveryId !== null || result.observation.delivery !== null ||
    result.observation.repository.initialized
  ) {
    throw new Error("Setup requires one completed uninitialized repository observation");
  }
  return Object.freeze({
    kind: "setup-needed",
    target,
    source: Object.freeze({ kind: "repository-observation", result }),
  });
}

export function createFrameReadyLifecycleTuiSnapshot(target: string): FrameReadyLifecycleTuiSnapshot {
  return Object.freeze({ kind: "frame-ready", target });
}

export function lifecycleTuiSnapshotActionCount(snapshot: LifecycleTuiSnapshot): number {
  return snapshot.kind === "setup-needed" ? 1 : snapshot.kind === "observed"
    ? snapshot.presentation.actions.length
    : 0;
}

export function lifecycleTuiReviewAction(
  snapshot: LifecycleTuiSnapshot,
  selectedIndex: number,
): LifecycleTuiReviewAction | null {
  if (snapshot.kind === "setup-needed") {
    if (selectedIndex !== 0) return null;
    return Object.freeze({
      title: "Initialize this fresh target",
      operationId: "repository.initialize",
      protocolOperation: "repository.initialize",
      summary: "Use the canonical Lifecycle CLI to create a fresh Foundation repository contract and machine authority.",
      consequence: "Initialization creates target layout and authority state only after its own live fresh-target checks.",
      badges: Object.freeze(["SETUP", "FOUNDER AUTHORITY", "CLI HANDOFF"]),
      expectedStateRelationship: "The target must still satisfy the canonical CLI's fresh-project requirements.",
      requiredInputIds: Object.freeze(["initialization input file", "Founder authority secret file"]),
      founderAuthorityRequired: true,
      authoritySecretFileRule: FOUNDATION_TUI_AUTHORITY_SECRET_FILE_RULE,
      investmentPerInvocation: false,
      capabilityProfileIds: null,
      handoffScopeNote: null,
    });
  }
  if (snapshot.kind === "frame-ready" || snapshot.kind === "inbox") return null;
  const action = snapshot.presentation.actions[selectedIndex];
  if (action === undefined) return null;
  return Object.freeze({
    title: action.title,
    operationId: action.operationId,
    protocolOperation: action.operationId,
    summary: action.summary,
    consequence: action.consequence,
    badges: action.badges,
    expectedStateRelationship: action.expectedStateRelationship,
    requiredInputIds: action.requiredInputIds,
    founderAuthorityRequired: action.founderAuthorityRequired,
    authoritySecretFileRule: action.founderAuthorityRequired
      ? FOUNDATION_TUI_AUTHORITY_SECRET_FILE_RULE
      : null,
    investmentPerInvocation: action.investmentPerInvocation,
    capabilityProfileIds: null,
    handoffScopeNote: null,
  });
}
