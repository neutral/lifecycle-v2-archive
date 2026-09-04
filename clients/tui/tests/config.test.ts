import assert from "node:assert/strict";
import test from "node:test";
import { LIFECYCLE_TUI_USAGE, parseLifecycleTuiConfig } from "../src/config.js";

test("configuration resolves the target and keeps read-only polling explicit", () => {
  const config = parseLifecycleTuiConfig(
    ["--target", "project", "--refresh-ms", "750"],
    { cwd: "/workspace" },
  );
  assert.equal(config.target, "/workspace/project");
  assert.equal(config.refreshIntervalMs, 750);
  assert.doesNotMatch(LIFECYCLE_TUI_USAGE, /--lifecycle/u);
});

test("configuration rejects ambiguous or unsafe arguments", () => {
  assert.throws(() => parseLifecycleTuiConfig(["target"]), /Unexpected positional/u);
  assert.throws(() => parseLifecycleTuiConfig(["--target", "one", "--target", "two"]), /Repeated option/u);
  assert.throws(() => parseLifecycleTuiConfig(["--refresh-ms", "499"]), /between 500/u);
  assert.throws(() => parseLifecycleTuiConfig(["--lifecycle", "/opt/lifecycle"]), /Unknown option/u);
  assert.throws(() => parseLifecycleTuiConfig(["--no-color"]), /Unknown option/u);
});
