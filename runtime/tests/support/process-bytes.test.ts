import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LifecycleError } from "../../src/errors.js";
import { runCommandBytes } from "../../src/util/process.js";

async function waitForFile(path: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await access(path);
      return;
    } catch {
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (processExists(pid)) {
    if (Date.now() >= deadline) throw new Error(`Process ${pid} survived cancellation`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const BYTE_ECHO_FIXTURE = String.raw`
process.stdin.on("data", (chunk) => process.stdout.write(chunk));
process.stdin.on("end", () => process.stdout.end());
`;

const BYTE_CAP_FIXTURE = String.raw`
process.on("SIGTERM", () => process.exit(23));
process.stdout.write(Buffer.from([0xff, 0x00, 0xfe, 0x61, 0xc3, 0x28, 0x80, 0x62, 0x63, 0x64, 0x65, 0x66]));
setInterval(() => {}, 1000);
`;

const STDERR_CAP_FIXTURE = String.raw`
process.on("SIGTERM", () => process.exit(24));
process.stderr.write("abcdefgh");
setInterval(() => {}, 1000);
`;

const CANCELLATION_FIXTURE = String.raw`
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const [ready, terminated] = process.argv.slice(1);
const descendant = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], { stdio: "ignore" });
process.on("SIGTERM", () => {
  writeFileSync(terminated, "term\n");
  process.exit(0);
});
process.stdout.write(Buffer.from([0x00, 0xff, 0xfe]));
writeFileSync(ready, JSON.stringify({ parent: process.pid, descendant: descendant.pid }));
setInterval(() => {}, 1000);
`;

const NATURAL_EXIT_DESCENDANT_FIXTURE = String.raw`
const { spawn } = require("node:child_process");
const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], { stdio: "ignore" });
descendant.unref();
process.stdout.write(String(descendant.pid));
`;

test("runCommandBytes round-trips NUL and invalid UTF-8 without decoding stdout", async () => {
  const binaryInput = Buffer.from([0x00, 0xff, 0xfe, 0x61, 0xc3, 0x28, 0x80, 0x00]);
  const binary = await runCommandBytes(process.execPath, ["-e", BYTE_ECHO_FIXTURE], {
    cwd: process.cwd(),
    input: binaryInput,
    maxStdoutBytes: 1_024,
    maxStderrBytes: 1_024,
    timeoutMs: 5_000,
  });
  assert.ok(Buffer.isBuffer(binary.stdout));
  assert.deepEqual(binary.stdout, binaryInput);
  assert.ok(Buffer.isBuffer(binary.stderrBytes));
  assert.deepEqual(binary.stderrBytes, Buffer.alloc(0));
  assert.equal(binary.stderr, "");
  assert.equal(binary.signal, null);
  assert.equal(binary.stdoutTruncated, false);

  const textInput = "text\0with-é";
  const text = await runCommandBytes(process.execPath, ["-e", BYTE_ECHO_FIXTURE], {
    cwd: process.cwd(),
    input: textInput,
    maxStdoutBytes: 1_024,
    timeoutMs: 5_000,
  });
  assert.deepEqual(text.stdout, Buffer.from(textInput, "utf8"));

  const binaryStderr = await runCommandBytes(
    process.execPath,
    ["-e", "process.stderr.write(Buffer.from([0x00, 0xff, 0xfe, 0x61]));"],
    { cwd: process.cwd(), maxStdoutBytes: 1_024, maxStderrBytes: 1_024, timeoutMs: 5_000 },
  );
  assert.deepEqual(binaryStderr.stderrBytes, Buffer.from([0x00, 0xff, 0xfe, 0x61]));
});

test("runCommandBytes retains the exact byte prefix and reports or rejects cap termination", async () => {
  const expected = Buffer.from([0xff, 0x00, 0xfe, 0x61, 0xc3]);
  const retained = await runCommandBytes(process.execPath, ["-e", BYTE_CAP_FIXTURE], {
    cwd: process.cwd(),
    allowFailure: true,
    maxStdoutBytes: expected.byteLength,
    maxStderrBytes: 128,
    timeoutMs: 5_000,
  });
  assert.deepEqual(retained.stdout, expected);
  assert.equal(retained.stdoutTruncated, true);
  assert.equal(retained.stderrTruncated, false);
  assert.equal(retained.exitCode, 23);

  await assert.rejects(
    runCommandBytes(process.execPath, ["-e", BYTE_CAP_FIXTURE], {
      cwd: process.cwd(),
      maxStdoutBytes: expected.byteLength,
      timeoutMs: 5_000,
    }),
    (error: unknown) => {
      if (!(error instanceof LifecycleError) || error.code !== "command.failed") return false;
      const facts = error.observedFacts as { stdout?: unknown; stdoutTruncated?: unknown };
      assert.ok(Buffer.isBuffer(facts.stdout));
      assert.deepEqual(facts.stdout, expected);
      assert.equal(facts.stdoutTruncated, true);
      return true;
    },
  );

  const stderr = await runCommandBytes(process.execPath, ["-e", STDERR_CAP_FIXTURE], {
    cwd: process.cwd(),
    allowFailure: true,
    maxStdoutBytes: 128,
    maxStderrBytes: 3,
    timeoutMs: 5_000,
  });
  assert.ok(Buffer.isBuffer(stderr.stdout));
  assert.ok(Buffer.isBuffer(stderr.stderrBytes));
  assert.deepEqual(stderr.stderrBytes, Buffer.from("abc"));
  assert.equal(stderr.stderr, "abc");
  assert.equal(stderr.stderrTruncated, true);
  assert.equal(stderr.exitCode, 24);
});

test("runCommandBytes cancellation sweeps its detached descendant process", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-process-bytes-cancel-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const ready = join(root, "ready.json");
  const terminated = join(root, "terminated");
  const controller = new AbortController();
  const running = runCommandBytes(process.execPath, ["-e", CANCELLATION_FIXTURE, ready, terminated], {
    cwd: root,
    signal: controller.signal,
    maxStdoutBytes: 1_024,
    maxStderrBytes: 1_024,
    timeoutMs: 30_000,
  });

  await waitForFile(ready);
  const pids = JSON.parse(await readFile(ready, "utf8")) as { parent: number; descendant: number };
  controller.abort();
  await assert.rejects(running, (error: unknown) => {
    if (!(error instanceof LifecycleError) || error.code !== "command.interrupted") return false;
    const facts = error.observedFacts as { stdout?: unknown };
    assert.ok(Buffer.isBuffer(facts.stdout));
    assert.deepEqual(facts.stdout, Buffer.from([0x00, 0xff, 0xfe]));
    return true;
  });

  await waitForFile(terminated);
  await waitForProcessExit(pids.parent);
  await waitForProcessExit(pids.descendant);
});

test("runCommandBytes can sweep and verify descendants after a natural foreground exit", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-process-bytes-natural-exit-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  let descendantPid: number | null = null;
  context.after(() => {
    if (descendantPid === null || !processExists(descendantPid)) return;
    try {
      process.kill(descendantPid, "SIGKILL");
    } catch {
      // The operated assertion below owns the expected absence.
    }
  });

  const result = await runCommandBytes(process.execPath, ["-e", NATURAL_EXIT_DESCENDANT_FIXTURE], {
    cwd: root,
    allowFailure: true,
    maxStdoutBytes: 1_024,
    maxStderrBytes: 1_024,
    timeoutMs: 5_000,
    sweepProcessGroupOnClose: true,
  });
  descendantPid = Number(result.stdout.toString("utf8"));

  assert.ok(Number.isSafeInteger(descendantPid) && descendantPid > 0);
  assert.equal(result.exitCode, 0);
  assert.equal(result.processGroupSwept, true);
  await waitForProcessExit(descendantPid);
});
