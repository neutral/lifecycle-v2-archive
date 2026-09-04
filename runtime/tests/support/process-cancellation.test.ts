import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LifecycleError } from "../../src/errors.js";
import { runCommand, throwIfProcessCancellationRequested, withFirstSignalDeferred, withProcessCancellation } from "../../src/util/process.js";

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

async function waitForJson<Value>(path: string, timeoutMs = 5_000): Promise<Value> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return JSON.parse(await readFile(path, "utf8")) as Value;
    } catch (error) {
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for complete JSON at ${path}`, { cause: error });
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

const gracefulFixture = String.raw`
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const [ready, terminated] = process.argv.slice(1);
const descendant = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], { stdio: "ignore" });
process.on("SIGTERM", () => {
  writeFileSync(terminated, "term\n");
  process.exit(0);
});
writeFileSync(ready, JSON.stringify({ parent: process.pid, descendant: descendant.pid }));
setInterval(() => {}, 1000);
`;

const forcedFixture = String.raw`
const { writeFileSync } = require("node:fs");
const [ready, terminated] = process.argv.slice(1);
process.on("SIGTERM", () => writeFileSync(terminated, "term\n"));
writeFileSync(ready, JSON.stringify({ parent: process.pid }));
setInterval(() => {}, 1000);
`;

test("runCommand requests graceful group cancellation and sweeps descendants before rejecting", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-process-cancel-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const ready = join(root, "ready.json");
  const terminated = join(root, "terminated");
  const controller = new AbortController();
  const running = runCommand(process.execPath, ["-e", gracefulFixture, ready, terminated], {
    cwd: root,
    signal: controller.signal,
    timeoutMs: 30_000,
  });
  void running.catch(() => undefined);

  const pids = await waitForJson<{ parent: number; descendant: number }>(ready);
  controller.abort();
  await assert.rejects(running, (error: unknown) =>
    error instanceof LifecycleError && error.code === "command.interrupted" && error.retryable
  );

  await waitForFile(terminated);
  await waitForProcessExit(pids.parent);
  await waitForProcessExit(pids.descendant);
});

test("ambient cancellation reaches a generic command and a force signal skips the grace wait", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-process-force-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const ready = join(root, "ready.json");
  const terminated = join(root, "terminated");
  const controller = new AbortController();
  const forceController = new AbortController();
  const running = withProcessCancellation(
    { signal: controller.signal, forceSignal: forceController.signal },
    async () => await runCommand(process.execPath, ["-e", forcedFixture, ready, terminated], {
      cwd: root,
      timeoutMs: 30_000,
    }),
  );
  void running.catch(() => undefined);

  const { parent } = await waitForJson<{ parent: number }>(ready);
  controller.abort();
  await waitForFile(terminated);
  const forcedAt = Date.now();
  forceController.abort();
  await assert.rejects(running, (error: unknown) => {
    if (!(error instanceof LifecycleError) || error.code !== "command.interrupted") return false;
    assert.equal((error.observedFacts as { forced?: unknown }).forced, true);
    return true;
  });
  assert.ok(Date.now() - forcedAt < 750, "forced cancellation waited for the full graceful timeout");
  await waitForProcessExit(parent);
});

test("a pre-aborted command never spawns", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-process-preabort-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const marker = join(root, "must-not-exist");
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    runCommand(process.execPath, ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "bad")`], {
      cwd: root,
      signal: controller.signal,
    }),
    (error: unknown) => error instanceof LifecycleError && error.code === "command.interrupted",
  );
  await assert.rejects(() => access(marker));
});

test("the explicit safe point gives pre-entry cancellation priority and post-entry completion priority", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-process-safe-point-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));

  const preEntry = new AbortController();
  preEntry.abort();
  let entered = false;
  await assert.rejects(
    withProcessCancellation({ signal: preEntry.signal }, async () => {
      throwIfProcessCancellationRequested();
      return await withFirstSignalDeferred(async () => {
        entered = true;
      });
    }),
    (error: unknown) => error instanceof LifecycleError && error.code === "runtime.interrupted",
  );
  assert.equal(entered, false);

  const completion = new AbortController();
  const marker = join(root, "completed");
  let tailCompleted = false;
  await withProcessCancellation({ signal: completion.signal }, async () => {
    throwIfProcessCancellationRequested();
    await withFirstSignalDeferred(async () => {
      completion.abort();
      await runCommand(process.execPath, ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "complete")`], { cwd: root });
      tailCompleted = true;
    });
  });
  assert.equal(await readFile(marker, "utf8"), "complete");
  assert.equal(tailCompleted, true);
});
