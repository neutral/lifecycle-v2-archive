#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const INVOCATION_SCHEMA = "lifecycle.runtime-invocation.private.v1";
const HEARTBEAT_INTERVAL_MS = 500;
const MISSED_HEARTBEAT_LIMIT = 10;
const FORCE_DELAY_MS = 1_500;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const COUNTER = /^(?:0|[1-9][0-9]{0,15})\n$/u;
const SIGNAL_CODES = Object.freeze({ SIGHUP: 129, SIGINT: 130, SIGTERM: 143 });

function refuse(message) {
  process.stderr.write(`Lifecycle Runtime invocation refused: ${message}\n`);
  process.exit(64);
}

function exactInvocation(path) {
  let value;
  try {
    const bytes = readFileSync(path, "utf8");
    value = JSON.parse(bytes);
    const keys = Object.keys(value).sort().join("\0");
    if (keys !== [
      "heartbeatFile",
      "heartbeatIntervalMilliseconds",
      "invocationId",
      "missedHeartbeatLimit",
      "schema",
    ].sort().join("\0") ||
        value.schema !== INVOCATION_SCHEMA ||
        !UUID.test(value.invocationId) ||
        value.heartbeatFile !== "/run/lifecycle-invocation/heartbeat" ||
        value.heartbeatIntervalMilliseconds !== HEARTBEAT_INTERVAL_MS ||
        value.missedHeartbeatLimit !== MISSED_HEARTBEAT_LIMIT ||
        bytes !== `${JSON.stringify(Object.fromEntries(
          Object.keys(value).sort().map((key) => [key, value[key]]),
        ), null, 2)}\n`) {
      refuse("private invocation carrier is invalid");
    }
  } catch {
    refuse("private invocation carrier is unavailable");
  }
  return value;
}

const invocationPath = process.env.LIFECYCLE_RUNTIME_INVOCATION_FILE;
delete process.env.LIFECYCLE_RUNTIME_INVOCATION_FILE;
if (invocationPath !== "/run/lifecycle-invocation/invocation.json") {
  refuse("private invocation carrier was not selected");
}
const invocation = exactInvocation(invocationPath);

const [commandName, ...arguments_] = process.argv.slice(2);
const command = commandName === "lifecycle"
  ? Object.freeze({ executable: "/opt/lifecycle/bin/lifecycle", prefix: Object.freeze([]) })
  : null;
if (command === null) refuse("entrypoint is not the selected Lifecycle CLI");

let lastCounter = null;
let missed = 0;
let parentLost = false;
let forceTimer = null;
const child = spawn(command.executable, [...command.prefix, ...arguments_], {
  env: process.env,
  shell: false,
  stdio: "inherit",
});

function signalChild(signal) {
  try {
    child.kill(signal);
  } catch {
    // The product process may already be terminal.
  }
}

for (const signal of Object.keys(SIGNAL_CODES)) {
  process.on(signal, () => signalChild(signal));
}

function containForParentLoss() {
  if (parentLost) return;
  parentLost = true;
  signalChild("SIGTERM");
  forceTimer = setTimeout(() => signalChild("SIGKILL"), FORCE_DELAY_MS);
  forceTimer.unref();
}

function observeHeartbeat() {
  let observed;
  try {
    observed = readFileSync(invocation.heartbeatFile, "utf8");
  } catch {
    containForParentLoss();
    return;
  }
  if (!COUNTER.test(observed)) {
    containForParentLoss();
    return;
  }
  if (observed === lastCounter) missed += 1;
  else {
    lastCounter = observed;
    missed = 0;
  }
  if (missed >= MISSED_HEARTBEAT_LIMIT) containForParentLoss();
}

observeHeartbeat();
const heartbeatTimer = setInterval(observeHeartbeat, HEARTBEAT_INTERVAL_MS);

child.once("error", () => {
  clearInterval(heartbeatTimer);
  process.stderr.write("Lifecycle Runtime process could not start.\n");
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  clearInterval(heartbeatTimer);
  if (forceTimer !== null) clearTimeout(forceTimer);
  if (code !== null) process.exitCode = code;
  else process.exitCode = SIGNAL_CODES[signal] ?? 1;
});
