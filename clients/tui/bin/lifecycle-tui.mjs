#!/usr/bin/env bun

function safeFailure(value) {
  return String(value).replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu, "�").slice(0, 8192);
}

try {
  const { runLifecycleTui } = await import("../dist/src/main.js");
  process.exitCode = await runLifecycleTui(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown Lifecycle TUI failure";
  process.stderr.write(`Lifecycle TUI failed: ${safeFailure(message)}\n`);
  process.exitCode = 1;
}
