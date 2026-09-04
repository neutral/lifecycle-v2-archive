import type { LifecycleTuiSnapshot } from "../app/snapshot.js";
import type { LifecycleTuiState } from "../app/state.js";
import { selectedDashboardTab } from "../app/state.js";
import { dashboardContentText, footerText, frameDisplay, headerText, tabRailText } from "./content.js";

/** One inert, bounded non-TTY snapshot. Interactive layout belongs only to OpenTUI. */
export function renderLifecyclePlainSnapshot(
  state: LifecycleTuiState<LifecycleTuiSnapshot>,
  target: string,
): string {
  const snapshot = state.model;
  const lines = [headerText(snapshot, target)];
  if (snapshot?.kind === "observed") {
    lines.push(tabRailText(snapshot.presentation, selectedDashboardTab(state)));
  }
  lines.push("", dashboardContentText(state, target));
  if (snapshot?.kind === "observed" && selectedDashboardTab(state) === "frame") {
    const current = frameDisplay(snapshot.presentation);
    lines.push("", "FOUNDER INPUT · COMPLETE BRIEF REQUIRED EACH TURN", "Each submission is a fresh full reconnaissance brief; prior plan and input are not implicit.");
    if (current === null) {
      lines.push("", "AGENT SUMMARY", "No Delivery exists yet.", "", "PLAN / PROPOSAL", "No Delivery exists yet.");
    } else {
      lines.push("", "AGENT SUMMARY", ...(current.summary.notice === null ? [] : [current.summary.notice]), current.summary.text);
      lines.push("", "PLAN / PROPOSAL", ...(current.plan.notice === null ? [] : [current.plan.notice]), current.plan.text);
    }
  }
  lines.push("", footerText(state));
  return `${lines.join("\n")}\n`;
}
