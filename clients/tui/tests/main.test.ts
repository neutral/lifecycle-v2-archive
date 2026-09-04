import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  FoundationCliReportedError,
  FoundationTuiTransportError,
  createLifecycleCliTransport,
} from "../src/adapters/cli/transport.js";
import {
  neutralizeOpenTuiEnvironment,
  writeSignalAwareOutput,
} from "../src/main.js";
import {
  createFakeLifecycle,
  fakeLifecycleCommands,
  readFakeLifecycleEvents,
  waitForFakeLifecycleInvocations,
  type FakeLifecycle,
} from "./support/fake-lifecycle.js";

const TUI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TUI_CARRIER = join(TUI_ROOT, "bin", "lifecycle-tui.mjs");
const MAXIMUM_CAPTURE_BYTES = 2 * 1_024 * 1_024;

test("OpenTUI import cannot inherit logging, path, or renderer override environment", () => {
  const environment: NodeJS.ProcessEnv = {
    OTUI_DEBUG: "1",
    OTUI_DEBUG_FFI: "target.log",
    OTUI_ASSET_ROOT: "/private/provider/path",
    OTUI_USE_CONSOLE: "1",
    OPENTUI_LIBC: "musl",
    OPENTUI_FORCE_NOZWJ: "1",
    SAFE_VALUE: "retained",
  };
  neutralizeOpenTuiEnvironment(environment, { platform: "darwin" });
  assert.deepEqual(environment, { SAFE_VALUE: "retained" });
});

test("OpenTUI libc selection comes only from the trusted host report", () => {
  const glibcEnvironment: NodeJS.ProcessEnv = { OPENTUI_LIBC: "musl" };
  neutralizeOpenTuiEnvironment(glibcEnvironment, { platform: "linux", glibcVersionRuntime: "2.39" });
  assert.deepEqual(glibcEnvironment, { OPENTUI_LIBC: "glibc" });

  const bunGlibcEnvironment: NodeJS.ProcessEnv = { OPENTUI_LIBC: "musl" };
  neutralizeOpenTuiEnvironment(bunGlibcEnvironment, { platform: "linux", glibcVersionRuntime: true });
  assert.deepEqual(bunGlibcEnvironment, { OPENTUI_LIBC: "glibc" });

  const muslEnvironment: NodeJS.ProcessEnv = { OPENTUI_LIBC: "glibc" };
  neutralizeOpenTuiEnvironment(muslEnvironment, { platform: "linux", glibcVersionRuntime: false });
  assert.deepEqual(muslEnvironment, { OPENTUI_LIBC: "musl" });

  const nonLinuxEnvironment: NodeJS.ProcessEnv = { OPENTUI_LIBC: "musl" };
  neutralizeOpenTuiEnvironment(nonLinuxEnvironment, { platform: "win32", glibcVersionRuntime: "untrusted" });
  assert.deepEqual(nonLinuxEnvironment, {});
});

type MainResult = Readonly<{
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}>;

class StalledTtyOutput extends EventEmitter {
  readonly isTTY = true;
  readonly columns = 80;
  readonly rows = 24;
  readonly writes: string[] = [];
  readonly callbacks: ((error?: Error | null) => void)[] = [];
  unrefCount = 0;

  write(value: string | Uint8Array, callback?: (error?: Error | null) => void): boolean {
    this.writes.push(typeof value === "string" ? value : Buffer.from(value).toString("utf8"));
    if (callback === undefined) return true;
    this.callbacks.push(callback);
    return false;
  }

  unref(): void {
    this.unrefCount += 1;
  }
}

async function withTimeout<T>(promise: Promise<T>, milliseconds = 1_000): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("operation did not settle before its test timeout")), milliseconds);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

async function runMain(
  args: readonly string[],
  timeoutMs = 8_000,
  afterSpawn?: (child: ReturnType<typeof spawn>) => Promise<void>,
  runtimeExecutable = process.execPath,
  supplyDeliveryId = true,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<MainResult> {
  const exactArgs = supplyDeliveryId && args.includes("--target") && !args.includes("--delivery-id")
    ? [...args, "--delivery-id", "delivery-tui-v10"]
    : args;
  const child = spawn(runtimeExecutable, [TUI_CARRIER, ...exactArgs], {
    cwd: TUI_ROOT,
    env: { ...environment, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBytes += chunk.byteLength;
    if (stdoutBytes <= MAXIMUM_CAPTURE_BYTES) stdout.push(Buffer.from(chunk));
    else child.kill("SIGKILL");
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrBytes += chunk.byteLength;
    if (stderrBytes <= MAXIMUM_CAPTURE_BYTES) stderr.push(Buffer.from(chunk));
    else child.kill("SIGKILL");
  });
  const resultPromise = new Promise<Readonly<{ exitCode: number | null; signal: NodeJS.Signals | null }>>((resolveResult, reject) => {
    const timeout = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    timeout.unref();
    child.once("error", reject);
    child.once("close", (exitCode, signal) => {
      clearTimeout(timeout);
      resolveResult({ exitCode, signal });
    });
  });
  try {
    await afterSpawn?.(child);
  } catch (error) {
    child.kill("SIGKILL");
    await resultPromise.catch(() => undefined);
    throw error;
  }
  const result = await resultPromise;
  assert.ok(stdoutBytes <= MAXIMUM_CAPTURE_BYTES, "non-TTY stdout stayed bounded");
  assert.ok(stderrBytes <= MAXIMUM_CAPTURE_BYTES, "non-TTY stderr stayed bounded");
  return Object.freeze({
    ...result,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  });
}

function fakeLifecycleEnvironment(fake: FakeLifecycle): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: [dirname(fake.executable), process.env.PATH].filter((value) => value !== undefined && value.length > 0).join(delimiter),
  };
}

async function runMainWithFake(
  fake: FakeLifecycle,
  args: readonly string[],
  timeoutMs = 8_000,
  afterSpawn?: (child: ReturnType<typeof spawn>) => Promise<void>,
  runtimeExecutable = process.execPath,
  supplyDeliveryId = true,
): Promise<MainResult> {
  return await runMain(
    args,
    timeoutMs,
    afterSpawn,
    runtimeExecutable,
    supplyDeliveryId,
    fakeLifecycleEnvironment(fake),
  );
}

function assertOnlyReadCommands(commands: readonly string[]): void {
  assert.ok(commands.length >= 2);
  assert.ok(commands.every((command) => ["version", "validate", "status", "inbox", "inspect", "diff", "watch"].includes(command)), commands.join(", "));
  assert.ok(commands.includes("validate"));
}

async function fixture(context: test.TestContext): Promise<Readonly<{
  root: string;
  fake: FakeLifecycle;
}>> {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-tui-main-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  return Object.freeze({ root, fake: await createFakeLifecycle(root) });
}

test("non-TTY mode renders one runtime-coherent Delivery and Inbox view without mutation", async (context) => {
  const { root, fake } = await fixture(context);
  const target = join(root, "observed");
  await mkdir(target);
  const result = await runMainWithFake(fake, ["--target", target]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /LIFECYCLE · FOUNDER CONTROLLER/u);
  assert.match(result.stdout, /awaiting admission · generation 1/u);
  assert.match(result.stdout, /DELIVERY INBOX/u);
  assert.match(result.stdout, /Bounded test Delivery/u);
  assertOnlyReadCommands(fakeLifecycleCommands(await readFakeLifecycleEvents(fake)));
});

test("non-TTY entry validates the repository before reading the runtime-owned Delivery Inbox", async (context) => {
  const { root, fake } = await fixture(context);
  const target = join(root, "observed");
  await mkdir(target);
  const result = await runMainWithFake(
    fake,
    ["--target", target],
    8_000,
    undefined,
    process.execPath,
    false,
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /DELIVERY INBOX/u);
  assert.deepEqual(fakeLifecycleCommands(await readFakeLifecycleEvents(fake)), ["version", "validate", "inbox"]);
});

test("non-TTY fresh target presents Setup from no-custody repository validation", async (context) => {
  const { root, fake } = await fixture(context);
  const target = join(root, "setup-observation");
  await mkdir(target);
  const result = await runMainWithFake(
    fake,
    ["--target", target],
    8_000,
    undefined,
    process.execPath,
    false,
  );
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /SETUP REQUIRED/u);
  assert.match(result.stdout, /lifecycle\.repository\.contract-missing/u);
  assert.match(result.stdout, /SETUP GUIDANCE · CANONICAL CLI HANDOFF/u);
  assert.doesNotMatch(result.stdout, /STATUS UNAVAILABLE/u);
  assert.deepEqual(fakeLifecycleCommands(await readFakeLifecycleEvents(fake)), ["version", "validate"]);
});

test("an initialized invalid repository observation remains unavailable rather than becoming Setup", async (context) => {
  const { root, fake } = await fixture(context);
  const target = join(root, "invalid-observation");
  await mkdir(target);
  const result = await runMainWithFake(
    fake,
    ["--target", target],
    8_000,
    undefined,
    process.execPath,
    false,
  );
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /status unavailable/u);
  assert.doesNotMatch(result.stderr, /SETUP REQUIRED|SETUP GUIDANCE/u);
  assert.deepEqual(fakeLifecycleCommands(await readFakeLifecycleEvents(fake)), ["version", "validate"]);
});

test("the plain non-TTY carrier remains importable and operable under the declared Node host", async (context) => {
  const { root, fake } = await fixture(context);
  const target = join(root, "observed");
  await mkdir(target);
  const nodeExecutable = process.env.LIFECYCLE_TUI_TEST_NODE ?? process.env.npm_node_execpath ?? process.env.NODE;
  assert.ok(nodeExecutable, "the package test runner must identify the exact Node executable");
  const result = await runMainWithFake(fake, ["--target", target], 8_000, undefined, nodeExecutable);
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /LIFECYCLE · FOUNDER CONTROLLER/u);
  assert.match(result.stdout, /DELIVERY INBOX/u);
  assertOnlyReadCommands(fakeLifecycleCommands(await readFakeLifecycleEvents(fake)));
});

test("non-TTY mode recognizes only an exact no-effect missing-contract failure as setup", async (context) => {
  const { root, fake } = await fixture(context);
  const target = join(root, "setup");
  await mkdir(target);
  const result = await runMainWithFake(fake, ["--target", target]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /SETUP REQUIRED/u);
  assert.match(result.stdout, /SETUP GUIDANCE · CANONICAL CLI HANDOFF/u);
  assert.doesNotMatch(result.stdout, /STATUS UNAVAILABLE/u);
  assertOnlyReadCommands(fakeLifecycleCommands(await readFakeLifecycleEvents(fake)));
});

test("read-only transport and main reject either reported mutation effect", async (context) => {
  const { root, fake } = await fixture(context);
  const transport = await createLifecycleCliTransport({
    executable: "lifecycle",
    environment: fakeLifecycleEnvironment(fake),
  });
  for (const mode of ["setup-repository-effect", "setup-operational-effect"] as const) {
    const target = join(root, mode);
    await mkdir(target);
    await assert.rejects(
      transport.status(target, "delivery-tui-v10"),
      (error: unknown) => error instanceof FoundationTuiTransportError &&
        !(error instanceof FoundationCliReportedError) &&
        error.code === "tui.cli.read-effect",
    );
  }

  const result = await runMainWithFake(fake, ["--target", join(root, "setup-repository-effect")]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /read-only Lifecycle invocation reported a repository or operational state change/u);
  assert.doesNotMatch(result.stderr, /SETUP GUIDANCE/u);
  assertOnlyReadCommands(fakeLifecycleCommands(await readFakeLifecycleEvents(fake)));
});

test("non-TTY and carrier failures cannot inject terminal controls or extra lines", async (context) => {
  const { root, fake } = await fixture(context);
  const target = join(root, "unsafe-error");
  await mkdir(target);
  const status = await runMainWithFake(fake, ["--target", target]);
  assert.equal(status.exitCode, 1);
  assert.match(status.stderr, /unsafe status/u);
  assert.doesNotMatch(status.stderr, /[\u001b\u202e]/u);
  assert.doesNotMatch(status.stderr, /\nspoof/u);
  assert.equal(status.stderr.trimEnd().split("\n").length, 1);

  const config = await runMain(["--unsafe\u001b[31m\nspoof"]);
  assert.equal(config.exitCode, 1);
  assert.match(config.stderr, /Unknown option/u);
  assert.doesNotMatch(config.stderr, /[\u001b\u202e]/u);
  assert.doesNotMatch(config.stderr, /\nspoof/u);
  assert.equal(config.stderr.trimEnd().split("\n").length, 1);
});

test("non-TTY inspection preserves typed refusal identity, effect flags, recovery, and observed facts", async (context) => {
  const { root, fake } = await fixture(context);
  const target = join(root, "typed-refusal");
  await mkdir(target);
  const result = await runMainWithFake(fake, ["--target", target]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /CLI REFUSAL lifecycle\.test\.follow-up/u);
  assert.match(result.stderr, /repositoryChanged=false/u);
  assert.match(result.stderr, /inspect — Inspect exact Delivery facts/u);
  assert.match(result.stderr, /observed facts/u);
  assertOnlyReadCommands(fakeLifecycleCommands(await readFakeLifecycleEvents(fake)));
});

test("a parent signal during non-TTY inspection cancels the owned read and preserves signal exit status", async (context) => {
  const { root, fake } = await fixture(context);
  const target = join(root, "slow");
  await mkdir(target);
  const result = await runMainWithFake(
    fake,
    ["--target", target],
    8_000,
    async (child) => {
      await waitForFakeLifecycleInvocations(fake, 3);
      child.kill("SIGTERM");
    },
  );
  assert.equal(result.exitCode, 143);
  assert.equal(result.signal, null);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  const events = await readFakeLifecycleEvents(fake);
  assert.ok(events.some((event) => event.kind === "signal" && event.signal === "SIGINT"));
  assertOnlyReadCommands(fakeLifecycleCommands(events));
});

test("signal-aware non-TTY output yields after render and awaits write completion", async () => {
  let exitCode = 0;
  let written = "";
  const signals = { get exitCode(): number { return exitCode; } };

  const skipped = new Writable({
    write(_chunk, _encoding, callback) {
      written += "unexpected";
      callback();
    },
  });
  await writeSignalAwareOutput(() => {
    exitCode = 143;
    return "must not be written";
  }, skipped as unknown as NodeJS.WriteStream, signals);
  assert.equal(written, "");

  exitCode = 0;
  const draining = new Writable({
    write(chunk, _encoding, callback) {
      written += chunk.toString();
      setImmediate(() => {
        exitCode = 143;
        callback();
      });
    },
  });
  await writeSignalAwareOutput(
    () => "bounded output",
    draining as unknown as NodeJS.WriteStream,
    signals,
  );
  assert.equal(written, "bounded output");
  assert.equal(signals.exitCode, 143);

  exitCode = 0;
  const cancellation = new AbortController();
  const stalled = new StalledTtyOutput();
  const pending = writeSignalAwareOutput(
    () => "stalled output",
    stalled as unknown as NodeJS.WriteStream,
    { get exitCode(): number { return exitCode; }, signal: cancellation.signal },
  );
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(stalled.writes, ["stalled output"]);
  exitCode = 129;
  cancellation.abort();
  await withTimeout(pending);
  assert.equal(stalled.unrefCount, 0);
  stalled.callbacks[0]!();
});
