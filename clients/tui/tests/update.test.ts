import assert from "node:assert/strict";
import test from "node:test";
import { createLifecycleTuiState, type LifecycleTuiState } from "../src/app/state.js";
import { updateLifecycleTui } from "../src/app/update.js";
import { TUI_FRAME_DRAFT_MAXIMUM_BYTES } from "../src/view/sanitize.js";

const FIRST_BINDING = Object.freeze({ deliveryId: "delivery-update-v10", generation: `sha256:${"a".repeat(64)}` });
const SECOND_BINDING = Object.freeze({ deliveryId: "delivery-update-v10", generation: `sha256:${"b".repeat(64)}` });

function liveFrame() {
  let state = createLifecycleTuiState<string>({ columns: 100, rows: 30 });
  state = updateLifecycleTui(state, { kind: "start" }).state;
  state = updateLifecycleTui(state, {
    kind: "refresh-succeeded", sequence: 1, model: "live", actionCount: 1,
    prepareAvailable: true, admitActionIndex: null, observedAt: 1,
  }).state;
  state = updateLifecycleTui(state, { kind: "key", key: "next-region" }).state;
  state = updateLifecycleTui(state, { kind: "key", key: "next-region" }).state;
  state = updateLifecycleTui(state, { kind: "key", key: "enter" }).state;
  return state;
}

function liveNextPass() {
  let state = createLifecycleTuiState<string>({ columns: 100, rows: 30 });
  state = updateLifecycleTui(state, { kind: "start" }).state;
  state = updateLifecycleTui(state, {
    kind: "refresh-succeeded",
    sequence: 1,
    model: "live",
    actionCount: 0,
    prepareAvailable: true,
    admitActionIndex: null,
    selectedDelivery: FIRST_BINDING,
    nextPassAvailable: ["delivery.continue", "delivery.evaluate"],
    inboxCount: 1,
    observedAt: 1,
  }).state;
  for (let index = 0; index < 3; index += 1) {
    state = updateLifecycleTui(state, { kind: "key", key: "next-region" }).state;
  }
  state = updateLifecycleTui(state, { kind: "key", key: "enter" }).state;
  return state;
}

test("refreshes serialize and stale async results cannot replace live facts", () => {
  const initial = createLifecycleTuiState<string>({ columns: 80, rows: 24 });
  const started = updateLifecycleTui(initial, { kind: "start" });
  assert.deepEqual(started.effects, [{ kind: "refresh", sequence: 1 }]);
  assert.deepEqual(updateLifecycleTui(started.state, { kind: "timer" }).effects, []);
  assert.equal(updateLifecycleTui(started.state, { kind: "refresh-succeeded", sequence: 0, model: "old", actionCount: 1, observedAt: 1 }).state.model, null);
});

test("Frame passes one complete fresh brief and clears only completed prepare", () => {
  let state = liveFrame();
  const completeBrief = "Inspect everything\nReturn one plan.";
  state = updateLifecycleTui(state, { kind: "frame-draft-changed", value: completeBrief }).state;
  const submitted = updateLifecycleTui(state, { kind: "key", key: "submit-frame" });
  assert.deepEqual(submitted.effects, [{ kind: "prepare", sequence: 1, input: completeBrief }]);
  assert.equal(submitted.state.frameDraft, completeBrief);
  state = updateLifecycleTui(submitted.state, {
    kind: "prepare-succeeded", sequence: 1, model: "refused", actionCount: 1,
    prepareAvailable: true, admitActionIndex: null, status: "refused", observedAt: 2,
  }).state;
  assert.equal(state.frameDraft, completeBrief);
  assert.match(state.frameFailure!, /remains available/u);
  state = updateLifecycleTui(state, { kind: "key", key: "enter" }).state;
  const second = updateLifecycleTui(state, { kind: "key", key: "submit-frame" });
  state = updateLifecycleTui(second.state, {
    kind: "prepare-succeeded", sequence: 2, model: "completed", actionCount: 2,
    prepareAvailable: true, admitActionIndex: 1, status: "completed", observedAt: 3,
  }).state;
  assert.equal(state.frameDraft, "");
});

test("Frame sanitizes controls and enforces the exact 64 KiB UTF-8 bound", () => {
  const state = liveFrame();
  const changed = updateLifecycleTui(state, { kind: "frame-draft-changed", value: `safe\u001b]8;;bad\u0000${"é".repeat(40_000)}` });
  assert.ok(new TextEncoder().encode(changed.state.frameDraft).byteLength <= TUI_FRAME_DRAFT_MAXIMUM_BYTES);
  assert.doesNotMatch(changed.state.frameDraft, /[\u0000\u001b]/u);
  assert.deepEqual(changed.effects, [{ kind: "replace-frame-draft", value: changed.state.frameDraft }]);

  const pasteObserved = updateLifecycleTui(state, {
    kind: "frame-draft-changed",
    value: "safe paste",
    normalization: { changed: true, byteLimited: false },
  });
  assert.match(pasteObserved.state.frameFailure ?? "", /Control characters were removed/u);
  assert.deepEqual(pasteObserved.effects, [], "a paste already normalized through the native editor does not reset its cursor");
});

test("Use Boundary freezes the exact admit action for CLI handoff", () => {
  let state = liveFrame();
  state = Object.freeze({ ...state, frameEditing: false, admitActionIndex: 1, actionCount: 2 });
  const review = updateLifecycleTui(state, { kind: "key", key: "use-plan" });
  assert.equal(review.state.reviewedAction, 1);
  assert.deepEqual(updateLifecycleTui(review.state, { kind: "key", key: "handoff" }).effects, [{ kind: "quit", handoffActionIndex: 1 }]);
});

test("Next Pass binds Founder input to one generation and keeps a refused mismatched draft visibly stale", () => {
  let state = liveNextPass();
  state = updateLifecycleTui(state, {
    kind: "next-pass-draft-changed",
    value: "Continue the exact bounded implementation.",
  }).state;
  const submitted = updateLifecycleTui(state, { kind: "key", key: "submit-next-pass" });
  assert.deepEqual(submitted.effects, [{
    kind: "execute-next-pass",
    sequence: 1,
    operation: "delivery.continue",
    binding: FIRST_BINDING,
    input: "Continue the exact bounded implementation.",
  }]);
  assert.deepEqual(updateLifecycleTui(submitted.state, { kind: "timer" }).effects, [],
    "a watch generation change cannot start a competing refresh during mutation");

  state = updateLifecycleTui(submitted.state, {
    kind: "operation-succeeded",
    sequence: 1,
    model: "new generation",
    binding: SECOND_BINDING,
    actionCount: 0,
    prepareAvailable: true,
    admitActionIndex: null,
    nextPassAvailable: ["delivery.continue"],
    status: "refused",
    observedAt: 2,
  }).state;
  assert.equal(state.nextPassDraft, "Continue the exact bounded implementation.");
  assert.deepEqual(state.nextPassDraftBinding, FIRST_BINDING);
  assert.equal(state.nextPassDraftStale, true);
  assert.match(state.nextPassFailure ?? "", /input remains available/u);
  assert.deepEqual(updateLifecycleTui(state, { kind: "key", key: "submit-next-pass" }).effects, []);

  const reselected = updateLifecycleTui(state, {
    kind: "delivery-selected",
    binding: SECOND_BINDING,
    index: 0,
  }).state;
  assert.equal(reselected.nextPassDraftStale, true, "reselecting the same exact Delivery cannot clear stale truth");
});

test("a coherently completed Next Pass clears only its bound Founder input", () => {
  let state = liveNextPass();
  state = updateLifecycleTui(state, { kind: "next-pass-draft-changed", value: "Complete this bounded pass." }).state;
  state = updateLifecycleTui(state, { kind: "key", key: "submit-next-pass" }).state;
  state = updateLifecycleTui(state, {
    kind: "operation-succeeded",
    sequence: 1,
    model: "completed",
    binding: SECOND_BINDING,
    actionCount: 0,
    prepareAvailable: true,
    admitActionIndex: null,
    nextPassAvailable: ["delivery.evaluate"],
    status: "completed",
    observedAt: 2,
  }).state;
  assert.equal(state.nextPassDraft, "");
  assert.deepEqual(state.nextPassDraftBinding, SECOND_BINDING);
  assert.equal(state.nextPassDraftStale, false);
});

test("Control explorer drills through exact runtime selections before rendering one revision", () => {
  let state: LifecycleTuiState<string> = Object.freeze({
    ...createLifecycleTuiState<string>({ columns: 100, rows: 30 }),
    model: "live",
    freshness: "live" as const,
    selectedDelivery: FIRST_BINDING,
  });
  let transition = updateLifecycleTui(state, { kind: "key", key: "open-control" });
  assert.deepEqual(transition.effects, [{
    kind: "load-control",
    sequence: 1,
    binding: FIRST_BINDING,
    selection: { kind: "families" },
  }]);
  state = updateLifecycleTui(transition.state, {
    kind: "auxiliary-succeeded",
    sequence: 1,
    modal: {
      kind: "control",
      deliveryId: FIRST_BINDING.deliveryId,
      generation: FIRST_BINDING.generation,
      title: "Control families",
      body: "Choose a family.",
      stale: false,
      level: "families",
      recordKind: null,
      recordId: null,
      items: [{ id: "work-boundary", label: "work-boundary", detail: null }],
      selectedIndex: 0,
      bounded: false,
      exactBody: null,
    },
  }).state;
  transition = updateLifecycleTui(state, { kind: "key", key: "enter" });
  assert.deepEqual(transition.effects, [{
    kind: "load-control",
    sequence: 2,
    binding: FIRST_BINDING,
    selection: { kind: "family", recordKind: "work-boundary" },
  }]);
  state = updateLifecycleTui(transition.state, {
    kind: "auxiliary-succeeded",
    sequence: 2,
    modal: {
      kind: "control",
      deliveryId: FIRST_BINDING.deliveryId,
      generation: FIRST_BINDING.generation,
      title: "Control records · work-boundary",
      body: "Choose a record.",
      stale: false,
      level: "records",
      recordKind: "work-boundary",
      recordId: null,
      items: [{ id: "boundary-1", label: "boundary-1", detail: null }],
      selectedIndex: 0,
      bounded: false,
      exactBody: null,
    },
  }).state;
  transition = updateLifecycleTui(state, { kind: "key", key: "enter" });
  assert.deepEqual(transition.effects, [{
    kind: "load-control",
    sequence: 3,
    binding: FIRST_BINDING,
    selection: { kind: "revisions", recordKind: "work-boundary", recordId: "boundary-1" },
  }]);
  state = updateLifecycleTui(transition.state, {
    kind: "auxiliary-succeeded",
    sequence: 3,
    modal: {
      kind: "control",
      deliveryId: FIRST_BINDING.deliveryId,
      generation: FIRST_BINDING.generation,
      title: "Control revisions · boundary-1",
      body: "Choose a revision.",
      stale: false,
      level: "revisions",
      recordKind: "work-boundary",
      recordId: "boundary-1",
      items: [{ id: "boundary-1", label: "revision 1", detail: "exact retained semantic Markdown" }],
      selectedIndex: 0,
      bounded: false,
      exactBody: null,
    },
  }).state;
  state = updateLifecycleTui(state, { kind: "key", key: "enter" }).state;
  assert.equal(state.modal?.kind === "control" ? state.modal.level : null, "revision");
  assert.equal(state.modal?.kind === "control" ? state.modal.exactBody : null, "exact retained semantic Markdown");
  state = updateLifecycleTui(state, { kind: "key", key: "escape" }).state;
  assert.equal(state.modal?.kind === "control" ? state.modal.level : null, "revisions");
});
