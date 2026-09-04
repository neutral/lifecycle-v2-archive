import type { FoundationTuiPresentation, FoundationTuiTabId } from "../domain/presentation.js";
import { foundationTuiOperationPolicy } from "../domain/operation-policy.js";
import {
  FOUNDATION_TUI_AUTHORITY_SECRET_FILE_RULE,
  lifecycleTuiReviewAction,
  type LifecycleTuiSnapshot,
} from "../app/snapshot.js";
import type { LifecycleTuiState } from "../app/state.js";
import { selectedDashboardTab } from "../app/state.js";
import { tuiSafeJson, tuiSafeLine, tuiSafeText } from "./sanitize.js";

const safe = (value: string): string => tuiSafeText(value).value;

export type FrameDisplaySection = Readonly<{
  text: string;
  notice: string | null;
}>;

export type FrameDisplay = Readonly<{
  summary: FrameDisplaySection;
  plan: FrameDisplaySection;
}>;

export function frameDisplay(model: FoundationTuiPresentation): FrameDisplay | null {
  if (model.semantics !== null) {
    const semantics = model.semantics;
    const summary = semantics.outcome.summary ?? "No outcome summary was retained.";
    const statement = (value: Readonly<{ id: string | null; statement: string; uncertainty: string | null }>): string =>
      `${value.id === null ? "•" : `${tuiSafeLine(value.id)} ·`} ${safe(value.statement)}${value.uncertainty === null ? "" : ` · uncertainty ${tuiSafeLine(value.uncertainty)}`}`;
    const sections = [
      "OUTCOME",
      `Disposition: ${semantics.outcome.disposition ?? "not stated"}`,
      safe(summary),
      `Uncertainty: ${semantics.outcome.uncertainty ?? "not stated"}`,
      "",
      "CLAIMS",
      ...(semantics.claims.length === 0 ? ["None stated."] : semantics.claims.map(statement)),
      "",
      "PROPOSED EFFECTS",
      ...(semantics.proposedEffects.length === 0 ? ["None stated."] : semantics.proposedEffects.map(statement)),
      "",
      "REQUIRED CHECKS",
      ...(semantics.requiredChecks.length === 0
        ? ["None stated."]
        : semantics.requiredChecks.map(({ selectionId, statement: text, status }) =>
            `${tuiSafeLine(selectionId)} · ${tuiSafeLine(status)} · ${safe(text)}`)),
      "",
      "LIMITATIONS",
      ...(semantics.limitations.length === 0 ? ["None stated."] : semantics.limitations.map(statement)),
      "",
      "BOUNDARY PROPOSAL",
      semantics.boundaryProposal === null
        ? "None retained."
        : `${tuiSafeLine(semantics.boundaryProposal.proposalKind)} · ${safe(semantics.boundaryProposal.objective)}\n${tuiSafeLine(semantics.boundaryProposal.reference.id)} · revision ${semantics.boundaryProposal.reference.revision}`,
    ];
    return Object.freeze({
      summary: Object.freeze({
        text: safe(summary),
        notice: model.generation === null ? null : `EXACT RUNTIME VIEW · generation ${tuiSafeLine(model.generation)}`,
      }),
      plan: Object.freeze({
        text: sections.join("\n"),
        notice: "Typed semantic presentation; canonical carriers and identifiers remain under Exact.",
      }),
    });
  }
  const current = model.frame.current;
  if (current === null) return null;
  const coordinate = current.attemptId === null
    ? `Delivery ${tuiSafeLine(current.deliveryId)} · Journal ${current.journalHeadSequence ?? "none"} · ${tuiSafeLine(current.journalHeadDigest ?? "none")}`
    : `Attempt ${tuiSafeLine(current.attemptId)} · Journal ${current.journalHeadSequence ?? "none"} · ${tuiSafeLine(current.journalHeadDigest ?? "none")}`;
  const statusNotice = `${current.status.toUpperCase()} · ${coordinate} · ${tuiSafeLine(current.message)}`;
  if (current.status === "empty" || current.status === "stale" || current.status === "unavailable") {
    return Object.freeze({
      summary: Object.freeze({
        text: current.status === "empty"
          ? "No agent summary is retained at this Journal head."
          : "Agent summary unavailable for this exact snapshot.",
        notice: statusNotice,
      }),
      plan: Object.freeze({
        text: current.status === "empty"
          ? "No plan or proposal is retained at this Journal head."
          : "Plan or proposal unavailable for this exact snapshot.",
        notice: statusNotice,
      }),
    });
  }
  const summaryText = current.summary === null
    ? "No agent summary was retained in this Attempt View."
    : typeof current.summary.text === "string"
      ? safe(current.summary.text)
      : tuiSafeJson(current.summary);
  const proposalText = current.proposal === null
    ? "No plan or proposal was retained in this Attempt View."
    : tuiSafeJson(current.proposal);
  const diagnostics = current.diagnosticCodes.length === 0
    ? ""
    : ` · diagnostics ${current.diagnosticCodes.map((code) => tuiSafeLine(code)).join(", ")}`;
  return Object.freeze({
    summary: Object.freeze({
      text: summaryText,
      notice: `${statusNotice}${diagnostics}`,
    }),
    plan: Object.freeze({
      text: proposalText,
      notice: `${statusNotice}${diagnostics}`,
    }),
  });
}

export function headerText(snapshot: LifecycleTuiSnapshot | null, target: string): string {
  if (snapshot === null) {
    return `LIFECYCLE · FOUNDER CONTROLLER\n${tuiSafeLine(target)} · READING CANONICAL CLI`;
  }
  if (snapshot.kind === "setup-needed") {
    return `LIFECYCLE · FOUNDER CONTROLLER\n${tuiSafeLine(target)} · SETUP REQUIRED`;
  }
  if (snapshot.kind === "frame-ready") {
    return "FRAME READY\nSubmit one complete fresh Founder brief to create a new Delivery. Status begins only after the returned exact Delivery ID is known.";
  }
  if (snapshot.kind === "inbox") {
    return [
      "LIFECYCLE · FOUNDER CONTROLLER",
      `${tuiSafeLine(snapshot.inbox.targetId)} · DELIVERY INBOX · generation ${tuiSafeLine(snapshot.inbox.generation)}`,
    ].join("\n");
  }
  const model = snapshot.presentation;
  return [
    "LIFECYCLE · FOUNDER CONTROLLER",
    `${tuiSafeLine(model.targetId)} · HEAD ${tuiSafeLine(model.repository.headCommit.slice(0, 12))} · ${tuiSafeLine(model.journey.exactStateLabel)} · generation ${model.journey.stateGeneration ?? "unavailable"}`,
  ].join("\n");
}

export function tabRailText(model: FoundationTuiPresentation, selected: FoundationTuiTabId): string {
  return model.tabs.map((tab) => tab.id === selected ? `[${tab.label.toUpperCase()}]` : tab.label).join("  ·  ");
}

function rows(model: FoundationTuiPresentation, selected: FoundationTuiTabId): string[] {
  const tab = model.tabs.find(({ id }) => id === selected) ?? model.tabs[0]!;
  return [
    `${tab.label.toUpperCase()} DETAILS`,
    safe(tab.summary),
    ...tab.rows.map((row) => `${tuiSafeLine(row.label)}: ${tuiSafeLine(row.value)}`),
    ...(tab.omittedRowCount > 0 ? [`${tab.omittedRowCount} additional row(s) omitted by the presentation bound.`] : []),
  ];
}

export function dashboardContentText(
  state: LifecycleTuiState<LifecycleTuiSnapshot>,
  target: string,
): string {
  const snapshot = state.model;
  if (snapshot === null) {
    return state.failure === null
      ? "Reading the canonical Lifecycle CLI…"
      : `STATUS UNAVAILABLE\n${tuiSafeLine(state.failure)}\nNo Process state or eligible operation is inferred from this failure.`;
  }
  if (snapshot.kind === "setup-needed") {
    const details = snapshot.source.kind === "cli-refusal"
      ? [
        tuiSafeLine(snapshot.source.failure.message),
        `Refusal: ${tuiSafeLine(snapshot.source.failure.code)} · retryable=${String(snapshot.source.failure.retryable)} · repositoryChanged=${String(snapshot.source.failure.repositoryChanged)} · operationalStateChanged=${String(snapshot.source.failure.operationalStateChanged)}`,
        ...(snapshot.source.failure.recoveryActions ?? []).slice(0, 8).map(({ action, detail }) => `Recovery: ${tuiSafeLine(action)} — ${tuiSafeLine(detail)}`),
        ...(snapshot.source.failure.observedFacts === undefined ? [] : [`Observed facts: ${tuiSafeJson(snapshot.source.failure.observedFacts)}`]),
      ]
      : [
        "Canonical repository validation completed without finding an initialized Foundation target.",
        `Observation: initialized=${String(snapshot.source.result.observation.repository.initialized)} · valid=${String(snapshot.source.result.observation.repository.valid)}`,
        ...snapshot.source.result.diagnostics.slice(0, 8).map(({ code, message }) =>
          `Diagnostic: ${tuiSafeLine(code)} — ${tuiSafeLine(message)}`),
      ];
    return [
      "SETUP REQUIRED",
      ...details,
      "",
      "SETUP GUIDANCE · CANONICAL CLI HANDOFF",
      "Initialize this fresh target · repository.initialize",
      "Press Enter to review the exact input and authority needs before printing the canonical CLI handoff.",
      `Target: ${tuiSafeLine(target)}`,
    ].join("\n");
  }
  if (snapshot.kind === "frame-ready") {
    return "FRAME READY\nSubmit one complete fresh Founder brief to create a new Delivery. Status begins only after the returned exact Delivery ID is known.";
  }
  if (snapshot.kind === "inbox") {
    if (selectedDashboardTab(state) === "frame") {
      return [
        "FRAME · FRESH RECONNAISSANCE",
        "Submit one complete fresh Founder brief to create a new Delivery.",
        "No prior input, plan, Candidate, Attempt, Journal, or provider context is implicit.",
      ].join("\n");
    }
    const rows = snapshot.inbox.rows;
    return [
      "DELIVERY INBOX",
      "Runtime-owned aggregate projection; unavailable Stores remain explicit diagnostics.",
      "",
      ...(rows.length === 0 ? ["No Delivery Control Record Store is present."] : rows.map((entry, index) => {
        const selected = index === state.inboxSelectedIndex ? ">" : " ";
        if (entry.status === "unavailable") {
          return `${selected} UNAVAILABLE · ${entry.deliveryId ?? entry.coordinateDigest} · ${entry.diagnostic.code} · ${entry.diagnostic.message}`;
        }
        return `${selected} ${entry.label} · ${entry.deliveryId} · ${entry.standing} · Candidate ${entry.candidateCondition} · ${entry.attentionOwner} · ${entry.recoveryRequired ? "RECOVERY" : entry.evidenceReadiness ?? "evidence pending"}\n    ${entry.activity?.stage ?? "idle"} · ${entry.latestMilestone?.eventKind ?? "no durable milestone"}`;
      })),
      "",
      "Enter binds all following views and actions to the selected exact Delivery generation.",
    ].join("\n");
  }
  const model = snapshot.presentation;
  const selected = selectedDashboardTab(state);
  const stale = state.freshness === "stale" ? [`STALE · ${tuiSafeLine(state.failure ?? "latest refresh failed")}`, ""] : [];
  const hero = [
    tuiSafeLine(model.hero.eyebrow),
    tuiSafeLine(model.hero.title),
    safe(model.hero.body),
    `Attention owner: ${model.hero.owner}`,
    "",
  ];
  if (selected === "inbox") {
    const inbox = snapshot.inbox;
    if (inbox !== null) {
      return [
        ...stale,
        "DELIVERY INBOX",
        `Runtime generation: ${tuiSafeLine(inbox.generation)}`,
        "",
        ...(inbox.rows.length === 0 ? ["No Delivery Control Record Store is present."] : inbox.rows.map((entry, index) => {
          const selectedRow = index === state.inboxSelectedIndex ? ">" : " ";
          if (entry.status === "unavailable") {
            return `${selectedRow} UNAVAILABLE · ${entry.deliveryId ?? entry.coordinateDigest} · ${entry.diagnostic.code} · ${entry.diagnostic.message}`;
          }
          return `${selectedRow} ${entry.label} · ${entry.deliveryId} · ${entry.standing} · Candidate ${entry.candidateCondition} · ${entry.attentionOwner} · ${entry.recoveryRequired ? "RECOVERY" : entry.evidenceReadiness ?? "evidence pending"}\n    ${entry.activity?.stage ?? "idle"} · ${entry.latestMilestone?.eventKind ?? "no durable milestone"}`;
        })),
        "",
        state.selectedDelivery === null
          ? "No exact Delivery is bound."
          : `Bound: ${tuiSafeLine(state.selectedDelivery.deliveryId)} · ${tuiSafeLine(state.selectedDelivery.generation)}`,
      ].join("\n");
    }
    return [
      ...stale,
      "DELIVERY INBOX",
      "The runtime owns discovery, ordering, standing, Candidate condition, attention, recovery, and latest durable milestone.",
      "",
      state.selectedDelivery === null
        ? "No Delivery is selected. Use ↑/↓ then Enter to bind one exact Delivery generation."
        : `Selected: ${tuiSafeLine(state.selectedDelivery.deliveryId)} · generation ${tuiSafeLine(state.selectedDelivery.generation)}`,
      "The TUI never discovers Store files or opens SQLite.",
    ].join("\n");
  }
  if (selected === "now") {
    const action = model.actions[state.selectedAction];
    const currentActivity = model.activity;
    return [
      ...stale,
      ...hero,
      `CANONICAL PRODUCT · ${tuiSafeLine(model.canonicalLane.status)}`,
      safe(model.canonicalLane.summary),
      `CANDIDATE · ${tuiSafeLine(model.workingLane.status)}`,
      safe(model.workingLane.summary),
      "",
      "RUNTIME ACTIVITY",
      ...(currentActivity === null
        ? ["Idle · no durable operation stage is active in this exact generation."]
        : [
            `${tuiSafeLine(currentActivity.operation)} · ${tuiSafeLine(currentActivity.stage)}`,
            `Activity: ${tuiSafeLine(currentActivity.activityId)}`,
          ]),
      "",
      "STATE-ELIGIBLE OPERATION FACTS",
      ...(action === undefined ? ["No eligible operation is present in this exact observation."] : [
        `Action ${state.selectedAction + 1}/${model.actions.length}`,
        `${tuiSafeLine(action.title)} · ${action.effectRoute === "canonical-cli" ? "RUN THROUGH CLI" : "REVIEW AND HANDOFF"}`,
        tuiSafeLine(action.operationId),
        tuiSafeLine(action.badges.join(" · ")),
        safe(action.summary),
      ]),
    ].join("\n");
  }
  if (selected === "next-pass") {
    const requirement = model.nextPass.find(({ operation }) => operation === state.nextPassOperation) ?? null;
    const exactReference = (value: typeof requirement extends null ? never : NonNullable<typeof requirement>["boundary"]): string =>
      value === null
        ? "none"
        : `${tuiSafeLine(value.kind)}:${tuiSafeLine(value.id)} · revision ${value.revision} · ${tuiSafeLine(value.digest)}`;
    return [
      ...stale,
      ...hero,
      "EXACT NEXT PASS",
      `Delivery: ${state.selectedDelivery?.deliveryId ?? "none"}`,
      `Generation: ${state.selectedDelivery?.generation ?? "unavailable"}`,
      `Eligible: ${state.nextPassAvailable.join(", ") || "none"}`,
      `Selected: ${state.nextPassOperation ?? "none"}`,
      ...(requirement === null ? [
        "No runtime-typed requirement is available for the selected operation.",
      ] : [
        `Role: ${tuiSafeLine(requirement.role)}`,
        `Boundary: ${exactReference(requirement.boundary)}`,
        `Candidate: ${exactReference(requirement.candidate)}`,
        `Consequence: ${safe(requirement.consequence)}`,
        "",
        "FRESH INVESTMENT · REQUIRED ON INVOCATION",
        `Model: ${tuiSafeLine(requirement.investment.model)}`,
        `Reasoning: ${tuiSafeLine(requirement.investment.reasoning)}`,
        `Wall time: ${requirement.investment.wallTimeMs} ms`,
        `Maximum output: ${requirement.investment.maximumOutputBytes} bytes`,
      ]),
      "The runtime rechecks the exact generation, Boundary, Candidate, eligibility, and fresh Investment before starting.",
      ...(state.nextPassDraftStale ? ["STALE DRAFT · Review against the current generation before execution."] : []),
    ].join("\n");
  }
  if (selected === "decision") {
    const decision = model.decisionReadiness;
    if (decision === null) {
      return [...stale, ...hero, "FOUNDER DECISION", "No runtime-typed decision view is available for this snapshot."].join("\n");
    }
    const reference = (value: typeof decision.boundary): string => value === null
      ? "none"
      : `${tuiSafeLine(value.kind)}:${tuiSafeLine(value.id)} · revision ${value.revision} · ${tuiSafeLine(value.digest)}`;
    const findings = (values: typeof decision.reviewerFindings): string[] => values.length === 0
      ? ["None retained."]
      : values.map(({ id, statement, uncertainty }) =>
          `${id === null ? "•" : tuiSafeLine(id)} ${safe(statement)}${uncertainty === null ? "" : ` · uncertainty ${tuiSafeLine(uncertainty)}`}`);
    return [
      ...stale,
      "FOUNDER DECISION · EXACT JOINED RUNTIME VIEW",
      `Generation: ${model.generation ?? "unavailable"}`,
      `Boundary: ${reference(decision.boundary)}`,
      `Candidate: ${reference(decision.candidate)}`,
      `Candidate Seal: ${reference(decision.seal)}`,
      `Evidence subject: ${reference(decision.evidence)}`,
      `Evidence readiness: ${decision.evidenceReadiness ?? "not ready"}`,
      "",
      "CANDIDATE CHANGE SUMMARY",
      ...findings(decision.changedSubjects),
      "",
      "REQUIRED / COMPLETED CHECKS",
      ...(decision.checks.length === 0
        ? ["No check selection is retained."]
        : decision.checks.map(({ selectionId, disposition, receipt }) =>
            `${tuiSafeLine(selectionId)} · ${tuiSafeLine(disposition)} · receipt ${reference(receipt)}`)),
      "",
      "INDEPENDENT REVIEWER FINDINGS",
      ...findings(decision.reviewerFindings),
      "",
      `UNCERTAINTY · ${decision.uncertainty ?? "not stated"}`,
      "LIMITATIONS",
      ...findings(decision.limitations),
      "",
      `FOUNDER CHOICES · ${decision.terminalChoices.join(" · ") || "none eligible"}`,
      "d opens the exact runtime-generated decision-bound diff. Authority choices remain reviewed CLI handoffs.",
    ].join("\n");
  }
  if (selected !== "frame") return [...stale, ...hero, ...rows(model, selected)].join("\n");
  return [...stale, ...hero].join("\n");
}

export function helpText(): string {
  return [
    "LIFECYCLE · HELP",
    "",
    "Frame accepts one complete fresh Founder reconnaissance brief and creates a new Delivery through the canonical CLI.",
    "Next Pass runs only runtime-eligible continue, revise, reaffirm, or evaluate operations through the canonical CLI.",
    "Setup → Frame → Admit → Work → Resolve → Prove → Close.",
    "Each Frame submission is fresh; Lifecycle does not automatically include a prior plan or earlier Founder input.",
    "Admission, readmission, acceptance, no-ship, and authority-dependent recovery remain reviewed CLI handoffs.",
    "",
    "AUTHORITY SECRET FILE",
    FOUNDATION_TUI_AUTHORITY_SECRET_FILE_RULE,
    "The TUI never reads this file; it leaves an unresolved placeholder for the canonical CLI.",
    "",
    "Tab/Shift-Tab tabs · Frame/Next Pass: Enter edit, Ctrl-S submit · n changes eligible pass · d runtime diff · c Control explorer · Esc back · r refresh · ? help · q quit · Ctrl-C cancel/quit",
  ].map(safe).join("\n");
}

export function reviewText(state: LifecycleTuiState<LifecycleTuiSnapshot>): string {
  const snapshot = state.model;
  if (snapshot === null) return "HANDOFF UNAVAILABLE";
  const action = lifecycleTuiReviewAction(snapshot, state.reviewedAction ?? state.selectedAction);
  if (action === null) return "HANDOFF UNAVAILABLE\nThe selected runtime operation is not recognized by this presentation.";
  const policy = foundationTuiOperationPolicy(action.protocolOperation);
  const observation = snapshot.kind === "observed" ? snapshot.observation : null;
  return [
    "CANONICAL CLI HANDOFF REVIEW · NO TUI EXECUTION",
    "",
    tuiSafeLine(action.title),
    `Runtime eligibility fact: ${tuiSafeLine(action.operationId)}`,
    tuiSafeLine(action.badges.join(" · ")),
    "",
    "PRESENTATION GUIDANCE · POSSIBLE OPERATION CONSEQUENCE",
    safe(action.consequence),
    "",
    "REQUIREMENTS",
    `Required inputs: ${action.requiredInputIds.map((id) => tuiSafeLine(id)).join(" · ") || "none"}`,
    `Founder authority: ${String(action.founderAuthorityRequired)} · fresh Investment: ${String(action.investmentPerInvocation)}`,
    ...(action.authoritySecretFileRule === null ? [] : ["", "AUTHORITY SECRET FILE", safe(action.authoritySecretFileRule), "The TUI will not read or create it; the printed handoff keeps its path unresolved."]),
    "",
    "WILL NOT",
    "Execute Lifecycle, read authority bytes, create authority input, or treat eligibility as permission.",
    "",
    "REVIEWED SNAPSHOT · DESCRIPTIVE ONLY",
    `Target: ${observation === null ? "unavailable" : tuiSafeLine(observation.repository.targetId ?? "unavailable")}`,
    `Contract: ${observation === null ? "unavailable" : observation.repository.repositoryContractDigest ?? "unavailable"}`,
    `HEAD: ${observation === null ? "unavailable" : observation.repository.headCommit}`,
    `Selected operation: ${tuiSafeLine(action.operationId)}`,
    "",
    `Live relationship: ${safe(action.expectedStateRelationship)}`,
    ...(policy.blockedReason === null ? [] : [`Why in-TUI execution is blocked: ${safe(policy.blockedReason)}`]),
    "",
    "Press x to exit and print the handoff. Press Esc to return without output.",
  ].join("\n");
}

export function footerText(state: LifecycleTuiState<LifecycleTuiSnapshot>): string {
  if (state.viewport.columns < 40 || state.viewport.rows < 12) return "Terminal too small · resize to 40×12 · q quit";
  if (state.pendingAuxiliary !== null) return `READING ${state.pendingAuxiliary.kind.toUpperCase()} · Ctrl-C cancel · displayed snapshot remains coherent`;
  if (state.pendingOperation !== null) return `${state.pendingOperation.operation.toUpperCase()} · Ctrl-C cancel · Founder input retained until coherent completion`;
  if (state.pendingPrepare !== null) return "RUNNING RECONNAISSANCE · Ctrl-C cancel · complete Founder input retained until completion";
  if (state.pendingRefresh !== null && state.model !== null) return "REFRESHING · displayed facts remain the last complete snapshot";
  if (state.mode === "help") return "↑↓ scroll · ? or Esc back · r refresh · q quit";
  if (state.mode === "modal") return state.modal?.kind === "control" && state.modal.level !== "revision"
    ? "↑↓ select · Enter open · Esc back · exact runtime rows never silently retarget"
    : "↑↓ scroll exact runtime view · Esc back · stale subjects never silently retarget";
  if (state.mode === "action-review") return "↑↓ scroll · x print CLI handoff · Esc back · r refresh · q quit";
  if (selectedDashboardTab(state) === "frame") {
    if (state.frameEditing) return "Textarea active · Enter newline · Ctrl-S run fresh reconnaissance · Esc retain";
    return [
      "Tab/Shift-Tab tabs",
      ...(state.prepareAvailable ? ["Enter edit"] : []),
      ...(state.admitActionIndex === null ? [] : ["u use current boundary"]),
      "↑↓ scroll",
      "r refresh",
      "? help",
      "q quit",
    ].join(" · ");
  }
  if (selectedDashboardTab(state) === "next-pass") {
    if (state.nextPassEditing) return "Textarea active · Enter newline · Ctrl-S run exact pass · Esc retain";
    return [
      "Tab/Shift-Tab tabs",
      ...(state.nextPassAvailable.length > 0 ? ["Enter edit"] : []),
      ...(state.nextPassAvailable.length > 1 ? ["n change pass"] : []),
      "d diff",
      "r refresh",
      "? help",
      "q quit",
    ].join(" · ");
  }
  if (selectedDashboardTab(state) === "candidate" || selectedDashboardTab(state) === "decision") {
    return "Tab/Shift-Tab tabs · ↑↓ scroll · d show runtime diff · Enter review · r refresh · ? help · q quit";
  }
  if (selectedDashboardTab(state) === "control") {
    return "Tab/Shift-Tab tabs · ↑↓ select · c inspect exact Control · r refresh · ? help · q quit";
  }
  return selectedDashboardTab(state) === "inbox"
    ? "Tab/Shift-Tab tabs · ↑↓ select Delivery · Enter bind exact generation · r refresh · ? help · q quit"
    : "Tab/Shift-Tab tabs · ↑↓ scroll · Enter review · r refresh · ? help · q quit";
}
