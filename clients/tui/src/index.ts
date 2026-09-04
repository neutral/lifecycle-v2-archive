export {
  LIFECYCLE_TUI_USAGE,
  parseLifecycleTuiConfig,
  type LifecycleTuiConfig,
} from "./config.js";
export {
  FOUNDATION_TUI_PHASES,
  deriveFoundationTuiJourney,
  type FoundationTuiJourney,
  type FoundationTuiPhaseId,
} from "./domain/journey.js";
export {
  FOUNDATION_TUI_HANDOFF_REASON,
  FOUNDATION_TUI_TAB_IDS,
  createFoundationTuiPresentation,
  type FoundationTuiActionCard,
  type FoundationTuiPresentation,
  type FoundationTuiTabId,
} from "./domain/presentation.js";
export {
  FOUNDATION_TUI_ENABLED_OPERATIONS,
  FOUNDATION_TUI_OPERATION_POLICY,
  foundationTuiCanExecute,
  foundationTuiOperationPolicy,
  type TuiOperationPolicy,
} from "./domain/operation-policy.js";
export {
  createLifecycleCliHandoff,
  renderLifecycleCliHandoff,
  type LifecycleCliHandoff,
} from "./domain/handoff.js";
export {
  createLifecycleCliTransport,
  FoundationCliReportedError,
  FoundationTuiTransportError,
  type FoundationPrepareResult,
  type LifecycleCliTransport,
} from "./adapters/cli/transport.js";
export { renderLifecyclePlainSnapshot } from "./view/plain.js";
export {
  frameDisplay,
  type FrameDisplay,
  type FrameDisplaySection,
} from "./view/content.js";
export {
  normalizeFrameDraft,
  tuiSafeLine,
  tuiSafeText,
  TUI_FRAME_DRAFT_MAXIMUM_BYTES,
} from "./view/sanitize.js";
export { runLifecycleTui } from "./main.js";
