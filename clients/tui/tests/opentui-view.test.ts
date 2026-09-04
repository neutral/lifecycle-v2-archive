import assert from "node:assert/strict";
import test from "node:test";
import { ScrollBoxRenderable, TextareaRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { createInspectedLifecycleTuiSnapshot } from "../src/app/snapshot.js";
import { createLifecycleTuiState } from "../src/app/state.js";
import { updateLifecycleTui } from "../src/app/update.js";
import { controlInspectionSubject, createOpenTuiEventDispatcher, destroyOpenTuiSession, disableOpenTuiKeyboardExtensions, preparedDeliveryIdentity } from "../src/opentui/application.js";
import { LifecycleOpenTuiView } from "../src/opentui/view.js";
import { footerText } from "../src/view/content.js";
import { testAttemptViewResult, testGeneration, testPrepareResult } from "./support/protocol-v10.js";

function frameState() {
  const snapshot = createInspectedLifecycleTuiSnapshot(testAttemptViewResult());
  let state = createLifecycleTuiState<typeof snapshot>({ columns: 100, rows: 40 });
  state = updateLifecycleTui(state, { kind: "start" }).state;
  state = updateLifecycleTui(state, { kind: "refresh-succeeded", sequence: 1, model: snapshot, actionCount: snapshot.presentation.actions.length, prepareAvailable: true, admitActionIndex: snapshot.presentation.actions.findIndex(({ operationId }) => operationId === "delivery.admit"), observedAt: 1 }).state;
  state = updateLifecycleTui(state, { kind: "key", key: "next-region" }).state;
  return updateLifecycleTui(state, { kind: "key", key: "next-region" }).state;
}

test("OpenTUI pins header, one tab row, and reserved footer while Frame is scrollable", async () => {
  const setup = await createTestRenderer({ width: 100, height: 40 }); let state = frameState();
  const view = new LifecycleOpenTuiView(setup.renderer, "/target", state, { key: (key) => { state = updateLifecycleTui(state, { kind:"key", key }).state; view.render(state); }, draft: (value) => { state = updateLifecycleTui(state, { kind:"frame-draft-changed", value }).state; view.render(state); }, resize: () => undefined });
  try {
    await setup.renderOnce(); const rows = setup.captureCharFrame().split("\n");
    assert.match(rows[0]!, /LIFECYCLE · FOUNDER CONTROLLER/u);
    assert.match(rows[2]!, /Inbox\s+Now\s+Frame\s+Next Pass\s+Boundary/u);
    assert.match(rows.at(-2)!, /Tab\/Shift-Tab tabs/u);
    assert.ok(setup.renderer.root.findDescendantById("frame-founder-input") instanceof TextareaRenderable);
    assert.match(setup.captureCharFrame(), /AGENT SUMMARY/u);
    assert.match(setup.captureCharFrame(), /PLAN \/ PROPOSAL/u);
    const scroll = setup.renderer.root.findDescendantById("lifecycle-content-scroll"); assert.ok(scroll instanceof ScrollBoxRenderable);
    state = Object.freeze({ ...state, pendingRefresh: 2 }); view.render(state); await setup.renderOnce();
    const refreshing = setup.captureCharFrame().split("\n"); assert.match(refreshing.at(-2)!, /REFRESHING/u);
    assert.match(refreshing[2]!, /Inbox\s+Now\s+Frame\s+Next Pass\s+Boundary/u, "refresh occupies the reserved status row without moving tabs");
  } finally { view.destroy(); setup.renderer.destroy(); }
});

test("Frame edit keeps native multiline and grapheme-safe textarea behavior", async () => {
  const setup = await createTestRenderer({ width: 80, height: 24 }); let state = updateLifecycleTui(frameState(), { kind:"key", key:"enter" }).state;
  const view = new LifecycleOpenTuiView(setup.renderer, "/target", state, { key: (key) => { state = updateLifecycleTui(state, { kind:"key", key }).state; view.render(state); }, draft: (value) => { state = updateLifecycleTui(state, { kind:"frame-draft-changed", value }).state; view.render(state); }, resize: () => undefined });
  try { const editor = setup.renderer.root.findDescendantById("frame-founder-input") as TextareaRenderable; await setup.mockInput.typeText("first\nsecond"); editor.editBuffer.setText("x👩🏽‍💻"); editor.gotoBufferEnd(); setup.mockInput.pressBackspace(); assert.equal(editor.plainText, "x"); await setup.renderOnce(); assert.match(setup.captureCharFrame(), /Textarea active/u); }
  finally { view.destroy(); setup.renderer.destroy(); }
});

test("keyboard workaround, teardown, and synchronous dispatch retain terminal safety", async () => {
  let enabled = true; const keyboard = { disableKittyKeyboard: () => { enabled = false; }, get useKittyKeyboard() { return enabled; } }; disableOpenTuiKeyboardExtensions(keyboard); assert.equal(keyboard.useKittyKeyboard, false);
  const events: string[] = []; await destroyOpenTuiSession({ release: () => { events.push("release"); } }, { stop: () => { events.push("stop"); }, suspend: () => { events.push("suspend"); }, destroy: () => { events.push("destroy"); } }); assert.deepEqual(events, ["stop","suspend","release","destroy"]);
  const values: string[] = []; const dispatch = createOpenTuiEventDispatcher<string>({ accept: () => true, process: (value) => values.push(value), fail: () => assert.fail("unexpected") }); for (let index=0; index<1000; index+=1) dispatch(String(index)); assert.equal(values.at(-1), "999");
});

test("Frame footer advertises only currently available controls", () => {
  const state = frameState(); assert.match(footerText(state), /Enter edit/u); assert.match(footerText(Object.freeze({ ...state, pendingRefresh: 2 })), /REFRESHING/u);
});

test("runtime modal stays inside the fixed header, tab, and reserved footer shell", async () => {
  const setup = await createTestRenderer({ width: 100, height: 40 });
  const base = frameState();
  const state = Object.freeze({
    ...base,
    mode: "modal" as const,
    modal: Object.freeze({
      kind: "diff" as const,
      deliveryId: "delivery-tui-v10",
      generation: `sha256:${"a".repeat(64)}`,
      subject: "candidate" as const,
      title: "Current Candidate diff",
      body: "diff --git a/example b/example\n+bounded change",
      truncated: false,
      stale: false,
    }),
  });
  const view = new LifecycleOpenTuiView(setup.renderer, "/target", state, {
    key: () => undefined,
    draft: () => undefined,
    resize: () => undefined,
  });
  try {
    await setup.renderOnce();
    const rows = setup.captureCharFrame().split("\n");
    assert.match(rows[0]!, /LIFECYCLE · FOUNDER CONTROLLER/u);
    assert.match(rows[2]!, /Inbox\s+Now\s+Frame\s+Next Pass/u);
    assert.match(rows.at(-2)!, /scroll exact runtime view/u);
    assert.match(setup.captureCharFrame(), /Current Candidate diff · EXACT/u);
  } finally {
    view.destroy();
    setup.renderer.destroy();
  }
});

test("completed Frame preparation adopts only one exact returned Delivery identity", () => {
  assert.equal(preparedDeliveryIdentity(testPrepareResult()), "delivery-tui-v10");
  assert.throws(
    () => preparedDeliveryIdentity(Object.freeze({ ...testPrepareResult(), deliveryId: null })),
    /one exact Delivery identity/u,
  );
  assert.throws(
    () => preparedDeliveryIdentity(Object.freeze({ ...testPrepareResult(), deliveryId: "delivery-mismatch" })),
    /one exact Delivery identity/u,
  );
});

test("Control inspection displays the runtime-returned generation and marks a raced binding stale", () => {
  const generation = testGeneration();
  assert.deepEqual(controlInspectionSubject({
    deliveryId: generation.processId,
    generation: generation.digest,
  }, generation), { generation: generation.digest, stale: false });
  assert.deepEqual(controlInspectionSubject({
    deliveryId: generation.processId,
    generation: `sha256:${"0".repeat(64)}`,
  }, generation), { generation: generation.digest, stale: true });
  assert.throws(
    () => controlInspectionSubject({ deliveryId: "another-delivery", generation: generation.digest }, generation),
    /different Delivery identity/u,
  );
});
