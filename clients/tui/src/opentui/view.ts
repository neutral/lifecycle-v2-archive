import {
  BoxRenderable,
  CliRenderEvents,
  type CliRenderer,
  type KeyEvent,
  type PasteEvent,
  ScrollBoxRenderable,
  TabSelectRenderable,
  TextareaRenderable,
  TextRenderable,
  defaultTextareaKeyBindings,
} from "@opentui/core";
import type { LifecycleTuiSnapshot } from "../app/snapshot.js";
import { selectedDashboardTab, type LifecycleTuiState } from "../app/state.js";
import type { LifecycleTuiKey } from "../app/update.js";
import { FOUNDATION_TUI_TAB_IDS, type FoundationTuiTabId } from "../domain/presentation.js";
import {
  dashboardContentText,
  footerText,
  frameDisplay,
  headerText,
  helpText,
  reviewText,
} from "../view/content.js";
import { normalizeFrameDraft, TUI_FRAME_DRAFT_MAXIMUM_BYTES, tuiSafeLine } from "../view/sanitize.js";

const TAB_LABELS: Readonly<Record<FoundationTuiTabId, string>> = Object.freeze({
  inbox: "Inbox",
  now: "Now",
  frame: "Frame",
  "next-pass": "Next Pass",
  boundary: "Boundary",
  candidate: "Candidate",
  decision: "Decision",
  evidence: "Evidence",
  attempt: "Attempt",
  journal: "Journal",
  control: "Control",
  exact: "Exact",
});
const UTF8 = new TextEncoder();

function utf8Bytes(value: string): number {
  return UTF8.encode(value).byteLength;
}

export type LifecycleOpenTuiViewHandlers = Readonly<{
  key: (key: LifecycleTuiKey) => void;
  draft: (
    value: string,
    normalization?: Readonly<{ changed: boolean; byteLimited: boolean }>,
  ) => void;
  nextDraft?: (
    value: string,
    normalization?: Readonly<{ changed: boolean; byteLimited: boolean }>,
  ) => void;
  resize: (columns: number, rows: number) => void;
}>;

/**
 * OpenTUI owns terminal decoding, layout, scrolling, and editor behavior. This
 * view supplies only already-sanitized inert strings; it never uses Markdown
 * or StyledText for repository-, CLI-, or agent-derived bytes.
 */
export class LifecycleOpenTuiView {
  readonly #renderer: CliRenderer;
  readonly #target: string;
  readonly #handlers: LifecycleOpenTuiViewHandlers;
  readonly #root: BoxRenderable;
  readonly #header: TextRenderable;
  readonly #tabs: TabSelectRenderable;
  readonly #scroll: ScrollBoxRenderable;
  readonly #general: TextRenderable;
  readonly #frameIntro: TextRenderable;
  readonly #frameFailure: TextRenderable;
  readonly #editor: TextareaRenderable;
  readonly #summary: TextRenderable;
  readonly #plan: TextRenderable;
  readonly #nextIntro: TextRenderable;
  readonly #nextFailure: TextRenderable;
  readonly #nextEditor: TextareaRenderable;
  readonly #modal: BoxRenderable;
  readonly #modalScroll: ScrollBoxRenderable;
  readonly #modalText: TextRenderable;
  readonly #footer: TextRenderable;
  #state: LifecycleTuiState<LifecycleTuiSnapshot>;
  #settingDraft = false;
  #destroyed = false;

  readonly #onResize = (): void => {
    this.#handlers.resize(this.#renderer.width, this.#renderer.height);
  };

  readonly #onKey = (event: KeyEvent): void => {
    const selected = selectedDashboardTab(this.#state);
    const editingFrame = this.#state.frameEditing && selected === "frame";
    const editingNext = this.#state.nextPassEditing && selected === "next-pass";
    const editing = editingFrame || editingNext;
    if (event.ctrl && event.name === "c") {
      event.preventDefault();
      event.stopPropagation();
      this.#handlers.key("cancel");
      return;
    }
    if (editing) {
      if (event.name === "escape") {
        event.preventDefault();
        event.stopPropagation();
        if (editingFrame) this.#editor.blur(); else this.#nextEditor.blur();
        this.#handlers.key("escape");
      } else if (event.name === "tab") {
        event.preventDefault();
        event.stopPropagation();
        if (editingFrame) this.#editor.blur(); else this.#nextEditor.blur();
        this.#handlers.key(event.shift ? "previous-region" : "next-region");
      }
      return;
    }
    let key: LifecycleTuiKey | null = null;
    if (event.name === "tab") key = event.shift ? "previous-region" : "next-region";
    else if (event.name === "left") key = "previous-region";
    else if (event.name === "right") key = "next-region";
    else if (event.name === "up") key = "up";
    else if (event.name === "down") key = "down";
    else if (event.name === "return" || event.name === "enter") key = "enter";
    else if (event.name === "escape") key = "escape";
    else if (event.name === "r") key = "refresh";
    else if (event.name === "?") key = "help";
    else if (event.name === "q") key = "quit";
    else if (event.name === "x") key = "handoff";
    else if (event.name === "i") key = "edit-frame";
    else if (event.name === "u") key = "use-plan";
    else if (event.name === "n") key = "cycle-next-pass";
    else if (event.name === "d") key = "show-diff";
    else if (event.name === "c") key = "open-control";
    if (key === null) return;
    event.preventDefault();
    event.stopPropagation();
    if ((key === "up" || key === "down") && this.#state.mode === "modal") {
      if (this.#state.modal?.kind === "control" && this.#state.modal.level !== "revision") {
        this.#handlers.key(key);
      } else {
        this.#modalScroll.scrollBy(key === "up" ? -1 : 1, "step");
      }
      return;
    }
    if ((key === "up" || key === "down") && (this.#state.mode !== "dashboard" || this.#state.tabIndex !== 0)) {
      this.#scroll.scrollBy(key === "up" ? -1 : 1, "step");
      return;
    }
    this.#handlers.key(key);
  };

  constructor(
    renderer: CliRenderer,
    target: string,
    initialState: LifecycleTuiState<LifecycleTuiSnapshot>,
    handlers: LifecycleOpenTuiViewHandlers,
  ) {
    this.#renderer = renderer;
    this.#target = target;
    this.#state = initialState;
    this.#handlers = handlers;
    this.#root = new BoxRenderable(renderer, {
      id: "lifecycle-root",
      width: "100%",
      height: "100%",
      flexDirection: "column",
    });
    this.#header = new TextRenderable(renderer, { id: "lifecycle-header", height: 2, content: "" });
    this.#tabs = new TabSelectRenderable(renderer, {
      id: "lifecycle-tabs",
      height: 1,
      options: FOUNDATION_TUI_TAB_IDS.map((id) => ({ name: TAB_LABELS[id], description: "", value: id })),
      showDescription: false,
      showUnderline: false,
      showScrollArrows: true,
      wrapSelection: true,
      keyBindings: [],
    });
    this.#scroll = new ScrollBoxRenderable(renderer, {
      id: "lifecycle-content-scroll",
      flexGrow: 1,
      width: "100%",
      scrollY: true,
      scrollX: false,
      viewportCulling: true,
      contentOptions: { flexDirection: "column", paddingRight: 1 },
    });
    this.#general = new TextRenderable(renderer, { id: "lifecycle-general", width: "100%", content: "" });
    this.#frameIntro = new TextRenderable(renderer, { id: "frame-intro", width: "100%", content: "" });
    this.#frameFailure = new TextRenderable(renderer, { id: "frame-failure", width: "100%", content: "" });
    this.#editor = new TextareaRenderable(renderer, {
      id: "frame-founder-input",
      width: "100%",
      height: 8,
      minHeight: 5,
      wrapMode: "word",
      scrollMargin: 1,
      placeholder: "Type one complete fresh Founder reconnaissance brief…",
      keyBindings: [...defaultTextareaKeyBindings, { name: "s", ctrl: true, action: "submit" }],
      onContentChange: () => this.#changedDraft(),
      onSubmit: () => this.#handlers.key("submit-frame"),
      onPaste: (event) => this.#paste(event),
    });
    this.#summary = new TextRenderable(renderer, { id: "frame-agent-summary", width: "100%", content: "" });
    this.#plan = new TextRenderable(renderer, { id: "frame-current-plan", width: "100%", content: "" });
    this.#nextIntro = new TextRenderable(renderer, { id: "next-pass-intro", width: "100%", content: "" });
    this.#nextFailure = new TextRenderable(renderer, { id: "next-pass-failure", width: "100%", content: "" });
    this.#nextEditor = new TextareaRenderable(renderer, {
      id: "next-pass-founder-input",
      width: "100%",
      height: 8,
      minHeight: 5,
      wrapMode: "word",
      scrollMargin: 1,
      placeholder: "Type complete Founder direction for this exact pass…",
      keyBindings: [...defaultTextareaKeyBindings, { name: "s", ctrl: true, action: "submit" }],
      onContentChange: () => this.#changedNextDraft(),
      onSubmit: () => this.#handlers.key("submit-next-pass"),
      onPaste: (event) => this.#pasteNext(event),
    });
    this.#footer = new TextRenderable(renderer, { id: "lifecycle-footer", height: 1, content: "" });
    this.#modal = new BoxRenderable(renderer, {
      id: "lifecycle-modal",
      position: "absolute",
      top: 3,
      left: 2,
      right: 2,
      bottom: 1,
      zIndex: 100,
      border: true,
      borderStyle: "single",
      title: "Exact runtime view",
      padding: 1,
      visible: false,
    });
    this.#modalScroll = new ScrollBoxRenderable(renderer, {
      id: "lifecycle-modal-scroll",
      width: "100%",
      height: "100%",
      scrollY: true,
      scrollX: false,
      viewportCulling: true,
    });
    this.#modalText = new TextRenderable(renderer, { id: "lifecycle-modal-content", width: "100%", content: "" });
    this.#modalScroll.add(this.#modalText);
    this.#modal.add(this.#modalScroll);

    this.#scroll.add(this.#general);
    this.#scroll.add(this.#frameIntro);
    this.#scroll.add(this.#frameFailure);
    this.#scroll.add(this.#editor);
    this.#scroll.add(this.#summary);
    this.#scroll.add(this.#plan);
    this.#scroll.add(this.#nextIntro);
    this.#scroll.add(this.#nextFailure);
    this.#scroll.add(this.#nextEditor);
    this.#root.add(this.#header);
    this.#root.add(this.#tabs);
    this.#root.add(this.#scroll);
    this.#root.add(this.#footer);
    this.#root.add(this.#modal);
    renderer.root.add(this.#root);
    renderer.keyInput.on("keypress", this.#onKey);
    renderer.on(CliRenderEvents.RESIZE, this.#onResize);
    this.render(initialState);
  }

  render(state: LifecycleTuiState<LifecycleTuiSnapshot>): void {
    if (this.#destroyed) return;
    const previousTab = selectedDashboardTab(this.#state);
    const wasFrameEditing = this.#state.frameEditing;
    const wasNextEditing = this.#state.nextPassEditing;
    this.#state = state;
    const selected = selectedDashboardTab(state);
    if (selected !== previousTab) this.#scroll.scrollTo(0);
    this.#header.content = headerText(state.model, this.#target);
    this.#tabs.setSelectedIndex(state.tabIndex);
    this.#footer.content = footerText(state);

    this.#modal.visible = state.mode === "modal" && state.modal !== null;
    if (this.#modal.visible && state.modal !== null) {
      this.#modal.title = `${state.modal.title}${state.modal.stale ? " · STALE" : " · EXACT"}`;
      const selectedModal = state.modal;
      const controlBody = selectedModal.kind === "control"
        ? selectedModal.level === "revision"
          ? selectedModal.exactBody ?? "Exact revision content is unavailable."
          : [
              selectedModal.body,
              "",
              ...selectedModal.items.map((item, index) =>
                `${index === selectedModal.selectedIndex ? ">" : " "} ${tuiSafeLine(item.label)}`),
              selectedModal.bounded
                ? "\nBOUNDED · More rows or bytes exist beyond this explicit inspection bound."
                : "",
              "\n↑↓ select · Enter open · Esc back",
            ].filter((line) => line.length > 0).join("\n")
        : selectedModal.body;
      this.#modalText.content = [
        state.modal.stale
          ? "STALE · The selected Delivery generation advanced. Close and reopen to inspect the current exact subject."
          : `EXACT SUBJECT · ${tuiSafeLine(state.modal.deliveryId)} · ${tuiSafeLine(state.modal.generation)}`,
        state.modal.kind === "diff" && state.modal.truncated ? "TRUNCATED · Runtime output reached its explicit presentation bound." : "",
        state.modal.kind === "control" && state.modal.bounded
          ? "BOUNDED INSPECTION · The runtime reported a continuation or a display bound."
          : "",
        "",
        controlBody,
      ].filter((line) => line.length > 0).join("\n");
    }

    const frame = state.mode === "dashboard" && selected === "frame" &&
      (state.model?.kind === "observed" || state.model?.kind === "frame-ready" || state.model?.kind === "inbox");
    const nextPass = state.mode === "dashboard" && selected === "next-pass" && state.model?.kind === "observed";
    this.#general.visible = !frame && !nextPass;
    this.#frameIntro.visible = frame;
    this.#frameFailure.visible = frame && state.frameFailure !== null;
    this.#editor.visible = frame;
    this.#summary.visible = frame;
    this.#plan.visible = frame;
    this.#nextIntro.visible = nextPass;
    this.#nextFailure.visible = nextPass && state.nextPassFailure !== null;
    this.#nextEditor.visible = nextPass;
    if (!frame && !nextPass) {
      this.#general.content = state.mode === "help"
        ? helpText()
        : state.mode === "action-review"
          ? reviewText(state)
          : dashboardContentText(state, this.#target);
      this.#editor.blur();
      this.#nextEditor.blur();
    } else if (frame) {
      this.#frameIntro.content = [
        dashboardContentText(state, this.#target),
        "",
        "FOUNDER INPUT · COMPLETE BRIEF REQUIRED EACH TURN",
        "Each submission is a fresh full reconnaissance brief. The previous plan and earlier input are not implicit provider input.",
      ].join("\n");
      this.#frameFailure.content = state.frameFailure === null ? "" : `\nINPUT STATUS\n${tuiSafeLine(state.frameFailure)}`;
      if (this.#editor.plainText !== state.frameDraft) this.replaceDraft(state.frameDraft);
      const display = state.model.kind === "observed" ? frameDisplay(state.model.presentation) : null;
      this.#summary.content = display === null
        ? "\nAGENT SUMMARY\nNo Delivery exists yet."
        : `\nAGENT SUMMARY\n${display.summary.notice === null ? "" : `${display.summary.notice}\n`}${display.summary.text}`;
      this.#plan.content = display === null
        ? "\nPLAN / PROPOSAL\nNo Delivery exists yet."
        : `\nPLAN / PROPOSAL\n${display.plan.notice === null ? "" : `${display.plan.notice}\n`}${display.plan.text}\n\n${state.admitActionIndex === null ? "" : "USE CURRENT BOUNDARY · press u to review the delivery.admit CLI handoff"}`;
      if (state.frameEditing) {
        this.#editor.focus();
        if (!wasFrameEditing) this.#scroll.scrollChildIntoView("frame-founder-input");
      } else this.#editor.blur();
    } else {
      this.#nextIntro.content = [
        dashboardContentText(state, this.#target),
        "",
        "FOUNDER INPUT · EXACT NEXT PASS",
        `Operation: ${state.nextPassOperation ?? "none eligible"}`,
        `Generation: ${state.selectedDelivery?.generation ?? "unavailable"}`,
        "The runtime rechecks this exact generation, eligibility, Boundary, Candidate, and fresh Investment before execution.",
      ].join("\n");
      this.#nextFailure.content = state.nextPassFailure === null ? "" : `\nINPUT STATUS\n${tuiSafeLine(state.nextPassFailure)}`;
      if (this.#nextEditor.plainText !== state.nextPassDraft) this.replaceNextDraft(state.nextPassDraft);
      this.#editor.blur();
      if (state.nextPassEditing) {
        this.#nextEditor.focus();
        if (!wasNextEditing) this.#scroll.scrollChildIntoView("next-pass-founder-input");
      } else this.#nextEditor.blur();
    }
    this.#renderer.requestRender();
  }

  replaceDraft(value: string): void {
    if (this.#destroyed || this.#editor.plainText === value) return;
    this.#settingDraft = true;
    try {
      this.#editor.editBuffer.setText(value);
      this.#editor.gotoBufferEnd();
    } finally {
      this.#settingDraft = false;
    }
  }

  replaceNextDraft(value: string): void {
    if (this.#destroyed || this.#nextEditor.plainText === value) return;
    this.#settingDraft = true;
    try {
      this.#nextEditor.editBuffer.setText(value);
      this.#nextEditor.gotoBufferEnd();
    } finally {
      this.#settingDraft = false;
    }
  }

  destroy(): void {
    this.release();
    this.#root.destroyRecursively();
  }

  /** Release handlers before the renderer safely owns recursive tree teardown. */
  release(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#renderer.keyInput.off("keypress", this.#onKey);
    this.#renderer.off(CliRenderEvents.RESIZE, this.#onResize);
  }

  #changedDraft(): void {
    if (this.#settingDraft || this.#destroyed) return;
    this.#handlers.draft(this.#editor.plainText);
  }

  #changedNextDraft(): void {
    if (this.#settingDraft || this.#destroyed) return;
    this.#handlers.nextDraft?.(this.#nextEditor.plainText);
  }

  #paste(event: PasteEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const inserted = new TextDecoder("utf-8", { fatal: false }).decode(event.bytes);
    const text = this.#editor.plainText;
    const selected = this.#editor.getSelectedText();
    const available = Math.max(0, TUI_FRAME_DRAFT_MAXIMUM_BYTES - (utf8Bytes(text) - utf8Bytes(selected)));
    const normalized = normalizeFrameDraft(inserted, available);
    this.#settingDraft = true;
    try {
      this.#editor.insertText(normalized.value);
    } finally {
      this.#settingDraft = false;
    }
    this.#handlers.draft(this.#editor.plainText, {
      changed: normalized.changed,
      byteLimited: normalized.byteLimited,
    });
  }


  #pasteNext(event: PasteEvent): void {
    event.preventDefault();
    event.stopPropagation();
    const inserted = new TextDecoder("utf-8", { fatal: false }).decode(event.bytes);
    const text = this.#nextEditor.plainText;
    const selected = this.#nextEditor.getSelectedText();
    const available = Math.max(0, TUI_FRAME_DRAFT_MAXIMUM_BYTES - (utf8Bytes(text) - utf8Bytes(selected)));
    const normalized = normalizeFrameDraft(inserted, available);
    this.#settingDraft = true;
    try {
      this.#nextEditor.insertText(normalized.value);
    } finally {
      this.#settingDraft = false;
    }
    this.#handlers.nextDraft?.(this.#nextEditor.plainText, {
      changed: normalized.changed,
      byteLimited: normalized.byteLimited,
    });
  }
}
