#!/usr/bin/env node

import { closeSync, writeSync } from "node:fs";
import { spawn } from "node:child_process";
import { Socket } from "node:net";
import { isAbsolute } from "node:path";

const CONFIGURATION_PROTOCOL = "lifecycle.bootstrap-supervisor.v1";
const READY_PROTOCOL = "lifecycle.bootstrap-supervisor-ready.v1";
const STATUS_PROTOCOL = "lifecycle.bootstrap-supervisor-status.v1";
const INTERRUPT_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];
const TERMINATION_GRACE_MS = 1_000;
const HANDSHAKE_TIMEOUT_MS = 10_000;
const MAX_CONFIGURATION_BYTES = 32 * 1024;

function fail(message) {
  process.stderr.write(`Lifecycle bootstrap supervisor: ${message}\n`);
  process.exit(126);
}

function configuration() {
  const encoded = process.argv[2];
  if (encoded === undefined || encoded.length === 0 || encoded.length > MAX_CONFIGURATION_BYTES) {
    return fail("missing or oversized configuration");
  }
  let value;
  try {
    value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return fail("malformed configuration");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\0") !== ["launcherScript", "schema", "selectedExecutable"].sort().join("\0") ||
      value.schema !== CONFIGURATION_PROTOCOL || typeof value.selectedExecutable !== "string" ||
      typeof value.launcherScript !== "string" || !isAbsolute(value.selectedExecutable) ||
      !isAbsolute(value.launcherScript) || value.selectedExecutable.includes("\0") ||
      value.launcherScript.includes("\0")) {
    return fail("invalid configuration");
  }
  return value;
}

function writeFrame(descriptor, value) {
  const frame = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
  try {
    if (frame.byteLength > 1_024 || writeSync(descriptor, frame) !== frame.byteLength) {
      throw new Error("short frame write");
    }
    closeSync(descriptor);
    return true;
  } catch {
    try { closeSync(descriptor); } catch { /* The launcher may already have exited. */ }
    return false;
  }
}

function writeByte(descriptor, value) {
  try {
    if (writeSync(descriptor, value) !== 1) throw new Error("short byte write");
    closeSync(descriptor);
    return true;
  } catch {
    try { closeSync(descriptor); } catch { /* The launcher may already have exited. */ }
    return false;
  }
}

function exactClosedByte(stream) {
  return new Promise((resolveResult) => {
    let bytes = Buffer.alloc(0);
    let settled = false;
    const settle = (valid) => {
      if (settled) return;
      settled = true;
      resolveResult(valid);
    };
    stream.on("data", (chunk) => {
      if (bytes.byteLength <= 1) bytes = Buffer.concat([bytes, chunk]);
    });
    stream.once("end", () => settle(bytes.byteLength === 1 && bytes[0] === 0x31));
    stream.once("error", () => settle(false));
    stream.once("close", () => settle(false));
  });
}

function initialLifetimeByte(stream, onInvalidAfterReady) {
  return new Promise((resolveResult) => {
    let settled = false;
    stream.on("data", (chunk) => {
      if (!settled) {
        settled = true;
        const valid = chunk.byteLength === 1 && chunk[0] === 0x31;
        resolveResult(valid);
        if (!valid) onInvalidAfterReady(chunk);
        return;
      }
      onInvalidAfterReady(chunk);
    });
    const failBeforeReady = () => {
      if (settled) return;
      settled = true;
      resolveResult(false);
    };
    stream.once("end", failBeforeReady);
    stream.once("error", failBeforeReady);
    stream.once("close", failBeforeReady);
  });
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolveResult) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult(value);
    };
    const timer = setTimeout(() => settle(false), timeoutMs);
    promise.then(settle, () => settle(false));
  });
}

const selected = configuration();
const selectedArguments = [selected.launcherScript, ...process.argv.slice(3)];
const selectedEnvironment = {
  ...process.env,
  LIFECYCLE_INTERNAL_AUTHORITY_STDIN_V1: "1",
  LIFECYCLE_INTERNAL_BOOTSTRAP_READY_FD_V1: "3",
  LIFECYCLE_INTERNAL_BOOTSTRAP_ACK_FD_V1: "4",
  LIFECYCLE_INTERNAL_BOOTSTRAP_PARENT_FD_V1: "5",
};
delete selectedEnvironment.LIFECYCLE_BOOTSTRAP_QUALIFICATION_FORCE_FALLBACK;

let child;
let terminationRequested = false;
let terminationTimer = null;

function signalAnchoredGroup(signal) {
  if (process.platform !== "win32") {
    try {
      process.kill(-process.pid, signal);
      return;
    } catch {
      // The direct selected-process fallback remains bounded by this supervisor.
    }
  }
  if (child?.pid === undefined) return;
  try { child.kill(signal); } catch { /* The selected process may already have exited. */ }
}

function beginTermination() {
  if (terminationRequested) return;
  terminationRequested = true;
  signalAnchoredGroup("SIGTERM");
  terminationTimer = setTimeout(() => signalAnchoredGroup("SIGKILL"), TERMINATION_GRACE_MS);
}

for (const signal of INTERRUPT_SIGNALS) {
  process.on(signal, () => {
    // POSIX delivery targets the complete anchored group, including the
    // selected process. The supervisor remains alive as the group identity.
    if (process.platform === "win32" && child?.pid !== undefined) {
      try { child.kill(signal); } catch { /* The selected process may already have exited. */ }
    }
  });
}

let outerHeartbeat;
let outerActivation;
try {
  outerHeartbeat = new Socket({ fd: 3, readable: true, writable: false });
  outerHeartbeat.resume();
  outerHeartbeat.once("end", beginTermination);
  outerHeartbeat.once("close", beginTermination);
  outerHeartbeat.once("error", beginTermination);
  const outerActivationStream = new Socket({ fd: 6, readable: true, writable: false });
  outerActivation = exactClosedByte(outerActivationStream);
  outerActivationStream.resume();
  outerActivationStream.once("error", beginTermination);
} catch {
  process.exit(126);
}

child = spawn(selected.selectedExecutable, selectedArguments, {
  env: selectedEnvironment,
  stdio: ["pipe", "inherit", "inherit", "pipe", "pipe", "pipe"],
  detached: false,
  windowsHide: true,
});
child.stdin.on("error", () => undefined);
process.stdin.on("error", beginTermination);
process.stdin.pipe(child.stdin);

let selectedResultSettled = false;
const selectedResult = new Promise((resolveResult) => {
  const settle = (value) => {
    if (selectedResultSettled) return;
    selectedResultSettled = true;
    resolveResult(value);
  };
  child.once("error", () => settle({
    schema: STATUS_PROTOCOL,
    kind: "spawn-error",
    code: null,
    signal: null,
  }));
  child.once("exit", (code, signal) => settle({
    schema: STATUS_PROTOCOL,
    kind: "exit",
    code,
    signal,
  }));
});
void selectedResult.then((status) => {
  if (!writeFrame(5, status)) beginTermination();
});

let readyPublished = false;
const publishReady = (kind, failure = null) => {
  if (readyPublished) return false;
  readyPublished = true;
  const published = writeFrame(4, {
    schema: READY_PROTOCOL,
    kind,
    selectedPid: child.pid ?? null,
    failure,
  });
  if (!published) beginTermination();
  return published;
};

const selectedReady = await withTimeout(exactClosedByte(child.stdio[3]), HANDSHAKE_TIMEOUT_MS);
if (!selectedReady) {
  publishReady("failed", "selected-readiness");
  beginTermination();
} else {
  child.stdio[4].on("error", () => undefined);
  child.stdio[4].write("1");
  let selectedArmedSettled = false;
  let resolveSelectedArmed;
  const selectedArmed = new Promise((resolveArmed) => { resolveSelectedArmed = resolveArmed; });
  const observeSelectedArmed = (chunk) => {
    if (selectedArmedSettled) {
      beginTermination();
      return;
    }
    selectedArmedSettled = true;
    resolveSelectedArmed(chunk.byteLength === 1 && chunk[0] === 0x31);
  };
  const selectedLifetimeReady = await withTimeout(
    initialLifetimeByte(child.stdio[5], observeSelectedArmed),
    HANDSHAKE_TIMEOUT_MS,
  );
  if (!selectedLifetimeReady) {
    publishReady("failed", "selected-lifetime");
    beginTermination();
  } else {
    publishReady("ready");
    const launcherActivated = await withTimeout(outerActivation, HANDSHAKE_TIMEOUT_MS);
    if (!launcherActivated) {
      beginTermination();
    } else {
      const selectedActivated = await new Promise((resolveActivation) => {
        child.stdio[4].end("1", (error) => resolveActivation(error == null));
      });
      const armed = selectedActivated && await withTimeout(selectedArmed, HANDSHAKE_TIMEOUT_MS);
      if (!armed) {
        beginTermination();
      } else {
        const launcherArmed = writeByte(7, "1");
        if (!launcherArmed) beginTermination();
      }
    }
  }
}

// The heartbeat or referenced force timer owns this process lifetime. The
// supervisor deliberately remains the PGID anchor after selected-process exit
// until the launcher consumes status and sweeps the complete group.
await new Promise(() => undefined);
