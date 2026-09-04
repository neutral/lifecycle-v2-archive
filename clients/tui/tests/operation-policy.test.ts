import assert from "node:assert/strict";
import test from "node:test";
import { FOUNDATION_RUNTIME_OPERATION_KINDS } from "@neutral/lifecycle-protocol";
import { FOUNDATION_TUI_ENABLED_OPERATIONS, FOUNDATION_TUI_OPERATION_POLICY, foundationTuiCanExecute } from "../src/domain/operation-policy.js";

test("policy exhaustively classifies v10 protocol operations", () => {
  assert.deepEqual(Object.keys(FOUNDATION_TUI_OPERATION_POLICY).sort(), [...FOUNDATION_RUNTIME_OPERATION_KINDS].sort());
  assert.deepEqual(FOUNDATION_TUI_ENABLED_OPERATIONS, [
    "repository.validate",
    "delivery.inbox",
    "delivery.status",
    "delivery.prepare",
    "delivery.continue",
    "delivery.evaluate",
    "delivery.revise",
    "delivery.reaffirm",
    "delivery.inspect",
    "delivery.diff",
    "delivery.watch",
  ]);
  for (const operation of FOUNDATION_RUNTIME_OPERATION_KINDS) {
    assert.equal(foundationTuiCanExecute(operation), FOUNDATION_TUI_ENABLED_OPERATIONS.includes(operation));
  }
});

test("Frame and non-authority next passes execute through the CLI while authority remains handoff", () => {
  assert.equal(FOUNDATION_TUI_OPERATION_POLICY["delivery.prepare"].exposure, "enabled-frame-prepare");
  assert.equal(FOUNDATION_TUI_OPERATION_POLICY["delivery.no-ship"].authoritySecretRequired, true);
  assert.deepEqual(FOUNDATION_TUI_OPERATION_POLICY["delivery.no-ship"].runtimeEligibleOperationIds, ["delivery.no-ship"]);
  assert.equal(FOUNDATION_TUI_OPERATION_POLICY["delivery.inspect"].exposure, "enabled-read-only");
  assert.equal(FOUNDATION_TUI_OPERATION_POLICY["delivery.continue"].exposure, "enabled-next-pass");
  assert.equal(FOUNDATION_TUI_OPERATION_POLICY["delivery.evaluate"].exposure, "enabled-next-pass");
  for (const operation of ["delivery.continue", "delivery.evaluate", "delivery.revise", "delivery.reaffirm"] as const) {
    assert.equal(FOUNDATION_TUI_OPERATION_POLICY[operation].blockedReason, null);
  }
  assert.equal(FOUNDATION_TUI_OPERATION_POLICY["delivery.export"].exposure, "blocked-process-precondition");
  assert.match(
    FOUNDATION_TUI_OPERATION_POLICY["delivery.recover"].effectSummary,
    /exact runtime-selected retained Activity or post-Closure Store seal\/archive disposition/u,
  );
  assert.equal("delivery.select-no-ship" in FOUNDATION_TUI_OPERATION_POLICY, false);
  assert.equal("delivery.authorize-no-ship" in FOUNDATION_TUI_OPERATION_POLICY, false);
});
