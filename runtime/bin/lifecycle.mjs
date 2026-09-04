#!/usr/bin/env node

import { closeSync, existsSync, readFileSync, readSync, writeSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { Socket } from "node:net";
import { constants as osConstants } from "node:os";
import { fileURLToPath } from "node:url";
import { basename, delimiter, dirname, join } from "node:path";

// This bootstrap carrier must stay exactly equal to the canonical minimum
// in src/version.ts because that module is unsafe to import until Node is selected.
const RUNTIME_MINIMUM_NODE_VERSION = "24.14.0";
const INTERRUPT_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];
const BOOTSTRAP_SUPERVISOR_PROTOCOL = "lifecycle.bootstrap-supervisor.v1";
const BOOTSTRAP_SUPERVISOR_READY_PROTOCOL = "lifecycle.bootstrap-supervisor-ready.v1";
const BOOTSTRAP_SUPERVISOR_STATUS_PROTOCOL = "lifecycle.bootstrap-supervisor-status.v1";
const MAX_BOOTSTRAP_SUPERVISOR_FRAME_BYTES = 1_024;
const NODE_SIGNAL_NAMES = new Set(Object.keys(osConstants.signals));
const BOOTSTRAP_PARENT_FORCE_DELAY_MS = 250;
const BOOTSTRAP_PARENT_HARD_STOP_MS = 1_500;
const BOOTSTRAP_SIGNAL_QUALIFICATION_TIMEOUT_MS = 5_000;
const bufferedSignals = [];
let forwardBootstrapSignal = null;
let observeBootstrapSignal = null;
let bootstrapParentHeartbeat = null;
let bootstrapParentChannelLost = null;
let bootstrapParentForceTimer = null;
let bootstrapParentHardStopTimer = null;
let bootstrapParentLost = false;
const bootstrapSignalHandlers = INTERRUPT_SIGNALS.map((signal) => ({
  signal,
  handler: () => {
    observeBootstrapSignal?.(signal);
    if (forwardBootstrapSignal === null) bufferedSignals.push(signal);
    else forwardBootstrapSignal(signal);
  },
}));
for (const { signal, handler } of bootstrapSignalHandlers) process.on(signal, handler);

const bootstrapReadyFd = process.env.LIFECYCLE_INTERNAL_BOOTSTRAP_READY_FD_V1;
const bootstrapAckFd = process.env.LIFECYCLE_INTERNAL_BOOTSTRAP_ACK_FD_V1;
const bootstrapParentFd = process.env.LIFECYCLE_INTERNAL_BOOTSTRAP_PARENT_FD_V1;
delete process.env.LIFECYCLE_INTERNAL_BOOTSTRAP_READY_FD_V1;
delete process.env.LIFECYCLE_INTERNAL_BOOTSTRAP_ACK_FD_V1;
delete process.env.LIFECYCLE_INTERNAL_BOOTSTRAP_PARENT_FD_V1;
if (bootstrapReadyFd !== undefined || bootstrapAckFd !== undefined || bootstrapParentFd !== undefined) {
  const readyDelay = process.env.LIFECYCLE_BOOTSTRAP_QUALIFICATION === "lifecycle-bootstrap-signal-v1"
    ? Number(process.env.LIFECYCLE_BOOTSTRAP_QUALIFICATION_CHILD_READY_DELAY_MS ?? "0")
    : 0;
  if (Number.isSafeInteger(readyDelay) && readyDelay > 0 && readyDelay <= 5_000) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, readyDelay));
  }
  let acknowledged = false;
  let activated = false;
  if (bootstrapReadyFd === "3" && bootstrapAckFd === "4" && bootstrapParentFd === "5") {
    try {
      if (writeSync(3, "1") === 1) {
        closeSync(3);
        const acknowledgment = Buffer.alloc(1);
        acknowledged = readSync(4, acknowledgment, 0, 1, null) === 1 && acknowledgment[0] === 0x31;
        if (acknowledged && writeSync(5, "1") === 1) {
          const activation = Buffer.alloc(1);
          activated = readSync(4, activation, 0, 1, null) === 1 && activation[0] === 0x31;
        }
      }
    } catch {
      // The selecting parent may already have exited.
    }
  }
  for (const descriptor of [3, 4]) {
    try {
      closeSync(descriptor);
    } catch {
      // A successful side of the handshake is already closed.
    }
  }
  if (!acknowledged || !activated) {
    try {
      closeSync(5);
    } catch {
      // An invalid handoff may not have supplied the lifetime descriptor.
    }
    removeBootstrapSignalHandlers();
    process.stderr.write(acknowledged
      ? "Lifecycle bootstrap parent activation failed.\n"
      : "Lifecycle bootstrap parent acknowledgment failed.\n");
    process.exit(1);
  }
  try {
    bootstrapParentHeartbeat = new Socket({ fd: 5, readable: true, writable: true });
    bootstrapParentHeartbeat.resume();
    const parentLost = () => {
      if (bootstrapParentLost) return;
      bootstrapParentLost = true;
      try {
        process.kill(process.pid, "SIGTERM");
      } catch {
        // The selected process may already be completing.
      }
      bootstrapParentForceTimer = setTimeout(() => {
        try {
          process.kill(process.pid, "SIGTERM");
        } catch {
          // The selected process may already have exited.
        }
      }, BOOTSTRAP_PARENT_FORCE_DELAY_MS);
      bootstrapParentHardStopTimer = setTimeout(() => {
        try {
          // A fallback-selected process is a member of its independent
          // supervisor's group, not that group's numeric leader.
          process.kill(process.pid, "SIGKILL");
        } catch {
          process.exit(1);
        }
      }, BOOTSTRAP_PARENT_HARD_STOP_MS);
    };
    bootstrapParentChannelLost = parentLost;
    bootstrapParentHeartbeat.once("end", parentLost);
    bootstrapParentHeartbeat.once("close", parentLost);
    bootstrapParentHeartbeat.once("error", parentLost);
    bootstrapParentHeartbeat.write("1");
  } catch {
    removeBootstrapSignalHandlers();
    process.stderr.write("Lifecycle bootstrap parent lifetime channel failed.\n");
    process.exit(1);
  }
  delete process.env.LIFECYCLE_BOOTSTRAP_QUALIFICATION_CHILD_READY_DELAY_MS;
}

function removeBootstrapSignalHandlers() {
  for (const { signal, handler } of bootstrapSignalHandlers) process.removeListener(signal, handler);
}

function handoffBootstrapSignals() {
  removeBootstrapSignalHandlers();
  return bufferedSignals.splice(0);
}

function exactBootstrapFrame(stream) {
  return new Promise((resolveFrame) => {
    let bytes = Buffer.alloc(0);
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolveFrame(value);
    };
    stream.on("data", (chunk) => {
      if (settled) return;
      if (bytes.byteLength + chunk.byteLength > MAX_BOOTSTRAP_SUPERVISOR_FRAME_BYTES) {
        settle(null);
        stream.resume();
        return;
      }
      bytes = Buffer.concat([bytes, chunk]);
    });
    stream.once("end", () => {
      if (settled) return;
      if (bytes.byteLength < 2 || bytes[bytes.byteLength - 1] !== 0x0a ||
          bytes.subarray(0, bytes.byteLength - 1).includes(0x0a) ||
          bytes.subarray(0, bytes.byteLength - 1).some((byte) => byte > 0x7f)) {
        settle(null);
        return;
      }
      try {
        settle(JSON.parse(bytes.subarray(0, bytes.byteLength - 1).toString("ascii")));
      } catch {
        settle(null);
      }
    });
    stream.once("error", () => settle(null));
    stream.once("close", () => settle(null));
  });
}

function exactBootstrapByte(stream) {
  return new Promise((resolveByte) => {
    let bytes = Buffer.alloc(0);
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolveByte(value);
    };
    stream.on("data", (chunk) => {
      if (bytes.byteLength <= 1) bytes = Buffer.concat([bytes, chunk]);
    });
    stream.once("end", () => settle(bytes.byteLength === 1 && bytes[0] === 0x31));
    stream.once("error", () => settle(false));
    stream.once("close", () => settle(false));
  });
}

function bootstrapSupervisorReady(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\0") !== ["failure", "kind", "schema", "selectedPid"].sort().join("\0") ||
      value.schema !== BOOTSTRAP_SUPERVISOR_READY_PROTOCOL ||
      (value.kind !== "ready" && value.kind !== "failed") ||
      (value.selectedPid !== null && (!Number.isSafeInteger(value.selectedPid) || value.selectedPid < 1)) ||
      (value.kind === "ready" && (value.selectedPid === null || value.failure !== null)) ||
      (value.kind === "failed" && !["selected-readiness", "selected-lifetime"].includes(value.failure))) {
    return undefined;
  }
  return value;
}

function bootstrapSupervisorStatus(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join("\0") !== ["code", "kind", "schema", "signal"].sort().join("\0") ||
      value.schema !== BOOTSTRAP_SUPERVISOR_STATUS_PROTOCOL) {
    return undefined;
  }
  if (value.kind === "spawn-error" && value.code === null && value.signal === null) return value;
  const codeExit = Number.isSafeInteger(value.code) && value.code >= 0 && value.code <= 255 && value.signal === null;
  const signalExit = value.code === null && typeof value.signal === "string" && NODE_SIGNAL_NAMES.has(value.signal);
  return value.kind === "exit" && (codeExit || signalExit) ? value : undefined;
}

function signalBootstrapSupervisorGroup(child, signal) {
  if (process.platform !== "win32" && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The direct supervisor fallback remains safe while Node owns the handle.
    }
  }
  try { child.kill(signal); } catch { /* The supervisor may already have exited. */ }
}

function parseNodeVersion(version) {
  const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u.exec(
    version,
  );
  if (
    !match ||
    match[4]
      ?.split(".")
      .some((identifier) => /^\d+$/u.test(identifier) && identifier.length > 1 && identifier[0] === "0")
  ) {
    return undefined;
  }
  return {
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    patch: BigInt(match[3]),
    prerelease: match[4] !== undefined,
  };
}

function isSupportedNodeVersion(version) {
  const parsed = parseNodeVersion(version);
  if (!parsed) return false;
  const minimum = { major: 24n, minor: 14n, patch: 0n };
  for (const component of ["major", "minor", "patch"]) {
    if (parsed[component] > minimum[component]) return true;
    if (parsed[component] < minimum[component]) return false;
  }
  return !parsed.prerelease;
}

function nodeRuntimeCandidates() {
  const executable = process.platform === "win32" ? "node.exe" : "node";
  const candidates = [];
  const seen = new Set();
  const add = (candidate) => {
    if (!candidate || seen.has(candidate)) return;
    seen.add(candidate);
    candidates.push(candidate);
  };

  add(process.env.LIFECYCLE_NODE_PATH);
  for (const directory of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
    add(join(directory, executable));
    const parent = dirname(directory);
    if (
      (basename(directory) === "override" || basename(directory) === "fallback") &&
      basename(parent) === "bin" &&
      basename(dirname(parent)) === "dependencies"
    ) {
      add(join(dirname(parent), "node", "bin", executable));
    }
  }
  return candidates;
}

function findCompatibleNodeRuntime() {
  for (const path of nodeRuntimeCandidates()) {
    const result = spawnSync(path, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
      windowsHide: true,
    });
    if (result.error || result.status !== 0) continue;
    const version = result.stdout.trim().replace(/^v/u, "");
    if (isSupportedNodeVersion(version)) return { path, version };
  }
  return undefined;
}

const script = fileURLToPath(import.meta.url);
const here = dirname(script);
const entry = join(here, "..", "dist", "src", "cli.js");
const bootstrapSupervisor = join(here, "bootstrap-supervisor.mjs");

const authoritySecretFromStdin = process.env.LIFECYCLE_INTERNAL_AUTHORITY_STDIN_V1 === "1";
delete process.env.LIFECYCLE_INTERNAL_AUTHORITY_STDIN_V1;
const authoritySecret = authoritySecretFromStdin
  ? readFileSync(0, "utf8")
  : process.env.LIFECYCLE_AUTHORITY_SECRET;
delete process.env.LIFECYCLE_AUTHORITY_SECRET;

if (!existsSync(entry) || !existsSync(bootstrapSupervisor)) {
  process.stderr.write("Lifecycle runtime is not built. Run `npm run build` from the Lifecycle source root.\n");
  process.exit(1);
}

const forceFallbackQualification = process.env.LIFECYCLE_BOOTSTRAP_QUALIFICATION === "lifecycle-bootstrap-signal-v1" &&
  process.env.LIFECYCLE_BOOTSTRAP_QUALIFICATION_FORCE_FALLBACK === "1";
const bufferedSignalQualification = forceFallbackQualification &&
  process.env.LIFECYCLE_BOOTSTRAP_QUALIFICATION_BUFFER_SIGNAL_V1 === "SIGTERM";

if (!isSupportedNodeVersion(process.versions.node) || forceFallbackQualification) {
  const selected = findCompatibleNodeRuntime();
  if (selected) {
    const supervisorConfiguration = Buffer.from(JSON.stringify({
      schema: BOOTSTRAP_SUPERVISOR_PROTOCOL,
      selectedExecutable: selected.path,
      launcherScript: script,
    }), "utf8").toString("base64url");
    const supervisor = spawn(process.execPath, [
      bootstrapSupervisor,
      supervisorConfiguration,
      ...process.argv.slice(2),
    ], {
      env: process.env,
      stdio: ["pipe", "inherit", "inherit", "pipe", "pipe", "pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    supervisor.stdin.on("error", () => undefined);
    supervisor.stdin.end(authoritySecret ?? "");
    const heartbeat = supervisor.stdio[3];
    const readyStream = supervisor.stdio[4];
    const statusStream = supervisor.stdio[5];
    const activationStream = supervisor.stdio[6];
    const armedStream = supervisor.stdio[7];
    heartbeat.on("error", () => undefined);
    activationStream.on("error", () => undefined);
    const supervisorArmedPromise = exactBootstrapByte(armedStream);
    const readyPromise = exactBootstrapFrame(readyStream);
    const statusPromise = exactBootstrapFrame(statusStream);
    let supervisorExited = false;
    const supervisorExit = new Promise((resolveExit) => {
      const settle = (value) => {
        if (supervisorExited) return;
        supervisorExited = true;
        resolveExit(value);
      };
      supervisor.once("error", (error) => settle({ error, code: null, signal: null }));
      supervisor.once("exit", (code, signal) => settle({ error: null, code, signal }));
    });
    const supervisorClose = new Promise((resolveClose) => {
      supervisor.once("close", (code, signal) => resolveClose({ code, signal }));
      supervisor.once("error", () => resolveClose({ code: null, signal: null }));
    });
    let supervisorSwept = false;
    const sweepSupervisor = async () => {
      if (supervisorSwept) return;
      supervisorSwept = true;
      signalBootstrapSupervisorGroup(supervisor, "SIGKILL");
      await supervisorClose;
      heartbeat.destroy();
      removeBootstrapSignalHandlers();
    };
    const finishSelectedStatus = async (status) => {
      await sweepSupervisor();
      if (status === undefined) {
        process.stderr.write("Lifecycle compatible Node supervisor returned no valid terminal status.\n");
        process.exit(1);
      }
      if (status.kind === "spawn-error") {
        process.stderr.write(`Lifecycle could not start Node.js ${selected.version} at ${selected.path}.\n`);
        process.exit(1);
      }
      if (status.signal) {
        try {
          process.kill(process.pid, status.signal);
        } catch {
          process.exit(1);
        }
      }
      process.exit(status.code ?? 1);
    };
    const forward = (signal) => {
      signalBootstrapSupervisorGroup(supervisor, signal);
    };
    if (bufferedSignalQualification) {
      // Qualification injects the signal in this process, after the supervisor
      // exists but before selected-runtime readiness. Wait for the launcher's
      // already-installed handler to acknowledge that it buffered the signal.
      let qualificationTimer;
      const observedSignal = new Promise((resolveSignal, rejectSignal) => {
        observeBootstrapSignal = (signal) => {
          if (signal !== "SIGTERM") return;
          resolveSignal();
        };
        qualificationTimer = setTimeout(() => {
          rejectSignal(new Error("Lifecycle bootstrap qualification signal was not observed by the buffering handler."));
        }, BOOTSTRAP_SIGNAL_QUALIFICATION_TIMEOUT_MS);
      });
      try {
        process.kill(process.pid, "SIGTERM");
        await observedSignal;
      } finally {
        observeBootstrapSignal = null;
        clearTimeout(qualificationTimer);
      }
    }
    const readiness = await Promise.race([
      readyPromise.then((frame) => ({ kind: "frame", frame })),
      statusPromise.then((frame) => ({ kind: "status", status: bootstrapSupervisorStatus(frame) })),
      supervisorExit.then((result) => ({ kind: "exit", result })),
    ]);
    if (readiness.kind === "status") await finishSelectedStatus(readiness.status);
    const ready = readiness.kind === "frame" ? bootstrapSupervisorReady(readiness.frame) : undefined;
    if (ready === undefined || ready.kind !== "ready" || ready.selectedPid === supervisor.pid) {
      if (ready?.kind === "failed") {
        const failedTerminal = await Promise.race([
          statusPromise.then((frame) => ({ kind: "status", status: bootstrapSupervisorStatus(frame) })),
          supervisorExit.then(() => ({ kind: "exit" })),
        ]);
        if (failedTerminal.kind === "status" && failedTerminal.status !== undefined) {
          await finishSelectedStatus(failedTerminal.status);
        }
      }
      await sweepSupervisor();
      if (readiness.kind === "exit" && readiness.result.error !== null) {
        process.stderr.write(`Lifecycle could not start its Node.js bootstrap supervisor: ${readiness.result.error.message}\n`);
        process.exit(1);
      }
      process.stderr.write("Lifecycle compatible Node handoff failed.\n");
      process.exit(1);
    }
    const activationWrite = new Promise((resolveActivation) => {
      try {
        activationStream.end("1", (error) => {
          resolveActivation(error == null);
        });
      } catch {
        resolveActivation(false);
      }
    });
    const activation = await Promise.race([
      activationWrite.then((written) => ({ kind: "activation", written })),
      statusPromise.then((frame) => ({ kind: "status", status: bootstrapSupervisorStatus(frame) })),
      supervisorExit.then(() => ({ kind: "exit" })),
    ]);
    if (activation.kind === "status") await finishSelectedStatus(activation.status);
    const activationWritten = activation.kind === "activation" && activation.written;
    const arming = activationWritten
      ? await Promise.race([
          supervisorArmedPromise.then((armed) => ({ kind: "armed", armed })),
          statusPromise.then((frame) => ({ kind: "status", status: bootstrapSupervisorStatus(frame) })),
          supervisorExit.then(() => ({ kind: "exit" })),
        ])
      : { kind: "armed", armed: false };
    if (arming.kind === "status") await finishSelectedStatus(arming.status);
    const activated = arming.kind === "armed" && arming.armed;
    if (!activated) {
      await sweepSupervisor();
      process.stderr.write(activationWritten
        ? "Lifecycle compatible Node activation acknowledgment failed.\n"
        : "Lifecycle compatible Node activation write failed.\n");
      process.exit(1);
    }
    forwardBootstrapSignal = forward;
    for (const signal of bufferedSignals.splice(0)) forward(signal);
    if (process.env.LIFECYCLE_BOOTSTRAP_QUALIFICATION_HANDOFF_MARKER_V1 === "1") {
      process.stderr.write([
        "Lifecycle bootstrap handoff ready.",
        `Lifecycle bootstrap supervisor pid: ${supervisor.pid}.`,
        `Lifecycle bootstrap selected pid: ${ready.selectedPid}.`,
        "",
      ].join("\n"));
    }

    const terminal = await Promise.race([
      statusPromise.then((frame) => ({ kind: "status", frame })),
      supervisorExit.then((result) => ({ kind: "exit", result })),
    ]);
    const status = terminal.kind === "status" ? bootstrapSupervisorStatus(terminal.frame) : undefined;
    await finishSelectedStatus(status);
  }
  process.stderr.write(
    `Lifecycle requires Node.js ${RUNTIME_MINIMUM_NODE_VERSION} or newer; found ${process.versions.node} and no compatible Node.js executable. Set LIFECYCLE_NODE_PATH to one.\n`,
  );
  process.exit(1);
}

const bootstrapQualification = process.env.LIFECYCLE_BOOTSTRAP_QUALIFICATION;
const bootstrapQualificationDelay = process.env.LIFECYCLE_BOOTSTRAP_QUALIFICATION_DELAY_MS;
delete process.env.LIFECYCLE_BOOTSTRAP_QUALIFICATION;
delete process.env.LIFECYCLE_BOOTSTRAP_QUALIFICATION_DELAY_MS;
delete process.env.LIFECYCLE_BOOTSTRAP_QUALIFICATION_FORCE_FALLBACK;
delete process.env.LIFECYCLE_BOOTSTRAP_QUALIFICATION_CHILD_READY_DELAY_MS;
delete process.env.LIFECYCLE_BOOTSTRAP_QUALIFICATION_HANDOFF_MARKER_V1;
delete process.env.LIFECYCLE_BOOTSTRAP_QUALIFICATION_BUFFER_SIGNAL_V1;
if (bootstrapQualification === "lifecycle-bootstrap-signal-v1") {
  const delay = Number(bootstrapQualificationDelay ?? "0");
  if (!Number.isSafeInteger(delay) || delay < 1 || delay > 5_000) {
    removeBootstrapSignalHandlers();
    process.stderr.write("Lifecycle bootstrap qualification delay must be an integer from 1 through 5000 milliseconds.\n");
    process.exit(1);
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
}

const { main } = await import(entry);
await main(process.argv.slice(2), authoritySecret, handoffBootstrapSignals);
if (bootstrapParentForceTimer !== null) clearTimeout(bootstrapParentForceTimer);
if (bootstrapParentHardStopTimer !== null) clearTimeout(bootstrapParentHardStopTimer);
if (bootstrapParentHeartbeat !== null && bootstrapParentChannelLost !== null) {
  bootstrapParentHeartbeat.removeListener("end", bootstrapParentChannelLost);
  bootstrapParentHeartbeat.removeListener("close", bootstrapParentChannelLost);
  bootstrapParentHeartbeat.removeListener("error", bootstrapParentChannelLost);
}
bootstrapParentHeartbeat?.destroy();
