import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { after, before } from "node:test";
const TERMINAL_ENTER_SEQUENCE = "\u001b[?1049h";
const TERMINAL_RESTORE_SEQUENCE = "\u001b[?1049l";
import {
  createFakeLifecycle,
  fakeLifecycleCommands,
  readFakeLifecycleEvents,
  waitForFakeLifecycleInvocations,
  type FakeLifecycle,
  type FakeLifecycleEvent,
} from "./support/fake-lifecycle.js";
import { TestPtyHarness, type TestPtyProcess } from "./support/pty.js";

const TUI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TUI_CARRIER = join(TUI_ROOT, "bin", "lifecycle-tui.mjs");
const HEADER = "LIFECYCLE · FOUNDER CONTROLLER";

let harness: TestPtyHarness;

before(async () => {
  harness = await TestPtyHarness.create();
});

after(async () => {
  await harness?.dispose();
});

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function waitUntil(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("PTY application condition did not become true");
    await delay(10);
  }
}

async function waitForNewToken(
  child: TestPtyProcess,
  token: string,
  from = child.text.length,
  timeoutMs = 5_000,
): Promise<void> {
  await waitUntil(() => child.text.slice(from).includes(token), timeoutMs);
}

async function waitForCommandFollowing(
  fake: FakeLifecycle,
  first: string,
  later: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const commands = fakeLifecycleCommands(await readFakeLifecycleEvents(fake));
    const firstIndex = commands.indexOf(first);
    if (firstIndex >= 0 && commands.slice(firstIndex + 1).includes(later)) return;
    if (Date.now() >= deadline) throw new Error(`${later} did not follow ${first} within the bounded PTY wait`);
    await delay(10);
  }
}

async function waitForCommandCompletion(
  fake: FakeLifecycle,
  command: string,
  count: number,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const invocations = (await readFakeLifecycleEvents(fake)).filter(
      (event): event is Extract<FakeLifecycleEvent, { kind: "invoke" }> =>
        event.kind === "invoke" && event.command === command,
    );
    const invocation = invocations[count - 1];
    if (invocation !== undefined) {
      const inputIndex = invocation.args.indexOf("--input");
      assert.ok(inputIndex >= 0 && inputIndex + 1 < invocation.args.length);
      try {
        await access(invocation.args[inputIndex + 1]!);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          // The transport removes private query support only after the child
          // exits and its exact result is parsed. Allow the application
          // microtask that installs the returned modal to complete as well.
          await delay(20);
          return;
        }
        throw error;
      }
    }
    if (Date.now() >= deadline) {
      throw new Error(`Fake Lifecycle did not complete ${count} ${command} invocations`);
    }
    await delay(10);
  }
}

function assertOnlyReadCommands(commands: readonly string[]): void {
  assert.ok(commands.length >= 2);
  const allowed = new Set(["version", "validate", "inbox", "status", "inspect", "diff", "watch"]);
  assert.ok(commands.every((command) => allowed.has(command)), commands.join(", "));
  assert.ok(commands.includes("inbox") || commands.includes("validate"));
}

async function fixture(context: test.TestContext, mode: string): Promise<Readonly<{
  fake: FakeLifecycle;
  target: string;
}>> {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-tui-pty-app-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const target = join(root, mode);
  await mkdir(target);
  return Object.freeze({ fake: await createFakeLifecycle(root), target });
}

async function spawnApp(
  context: test.TestContext,
  fake: FakeLifecycle,
  target: string,
  columns = 90,
  rows = 48,
  deliveryId: string | null = "delivery-tui-v10",
): Promise<TestPtyProcess> {
  const args = [
    TUI_CARRIER,
    "--target",
    target,
  ];
  if (deliveryId !== null) args.push("--delivery-id", deliveryId);
  args.push("--refresh-ms", "60000");
  const child = await harness.spawn(process.execPath, args, {
    cwd: TUI_ROOT,
    viewport: { columns, rows },
    environment: {
      NO_COLOR: "1",
      PATH: [dirname(fake.executable), process.env.PATH]
        .filter((value) => value !== undefined && value.length > 0)
        .join(delimiter),
    },
  });
  context.after(async () => {
    if (!child.settled) await child.terminate(250).catch(() => undefined);
  });
  return child;
}

test("real PTY startup follows the Delivery Inbox, redraws on resize, and quits cleanly", async (context) => {
  const { fake, target } = await fixture(context, "observed");
  const child = await spawnApp(context, fake, target);
  await child.waitForOutput("DELIVERY INBOX");
  await waitForFakeLifecycleInvocations(fake, 4);
  const firstHeader = child.text.lastIndexOf(HEADER);
  assert.ok(firstHeader >= 0);

  const beforeSmall = child.text.length;
  await child.resize(39, 10);
  await waitForNewToken(child, "small", beforeSmall);
  await child.resize(90, 48);
  await waitUntil(() => child.text.lastIndexOf(HEADER) > firstHeader);

  await child.writeKeys("q");
  const result = await child.wait(5_000);
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.equal(result.captureComplete, true);
  assert.match(result.text, /Terminal too small/u);
  assert.ok(result.text.includes(TERMINAL_RESTORE_SEQUENCE));
  assertOnlyReadCommands(fakeLifecycleCommands(await readFakeLifecycleEvents(fake)));
});

test("a fresh no-ID startup discovers Setup through no-custody validation before offering Frame", async (context) => {
  const { fake, target } = await fixture(context, "setup-observation");
  const child = await spawnApp(context, fake, target, 90, 48, null);
  await child.waitForOutput("SETUP REQUIRED");
  await waitForFakeLifecycleInvocations(fake, 2);
  assert.deepEqual(fakeLifecycleCommands(await readFakeLifecycleEvents(fake)), ["version", "validate"]);
  await child.writeKeys("q");
  const result = await child.wait(5_000);
  assert.equal(result.exitCode, 0);
});

test("a parent signal during version pin cancels the owned child before terminal entry", async (context) => {
  const { fake, target } = await fixture(context, "observed");
  await writeFile(fake.versionDelayPath, "delay\n", { encoding: "utf8", mode: 0o600 });
  const child = await spawnApp(context, fake, target);
  await waitForFakeLifecycleInvocations(fake, 1);
  await child.signal("SIGTERM");
  const result = await child.wait(5_000);
  assert.ok(
    (result.signal === null && (result.exitCode === 143 || result.exitCode === 1)) ||
    (result.exitCode === null && result.signal === "SIGTERM"),
  );
  assert.equal(result.text.includes(TERMINAL_ENTER_SEQUENCE), false);
  const events = await readFakeLifecycleEvents(fake);
  assert.deepEqual(fakeLifecycleCommands(events), ["version"]);
  // The bootstrap process may terminate before the child has installed its
  // cancellation hook; no terminal ownership or later command is permitted.
});

test("signals remain owned from terminal entry through forced read cleanup and restoration", async (context) => {
  const { fake, target } = await fixture(context, "ignore-cancel");
  const child = await spawnApp(context, fake, target);
  await child.waitForOutput(TERMINAL_ENTER_SEQUENCE);
  await waitForFakeLifecycleInvocations(fake, 3);

  await child.signal("SIGTERM");
  await delay(100);
  if (!child.settled) await child.signal("SIGTERM");

  const result = await child.wait(5_000);
  assert.equal(result.exitCode, 143);
  assert.equal(result.signal, null);
  assert.equal(result.captureComplete, true);
  assert.ok(result.text.includes(TERMINAL_ENTER_SEQUENCE));
  assert.ok(result.text.includes(TERMINAL_RESTORE_SEQUENCE));
  assert.ok(result.text.lastIndexOf(TERMINAL_RESTORE_SEQUENCE) > result.text.indexOf(TERMINAL_ENTER_SEQUENCE));
  const events = await readFakeLifecycleEvents(fake);
  assert.ok(events.some((event) => event.kind === "signal" && event.signal === "SIGINT"));
  assertOnlyReadCommands(fakeLifecycleCommands(events));
});

test("review plus x exits the alternate screen and prints an honest authority handoff", async (context) => {
  const { fake, target } = await fixture(context, "observed");
  const child = await spawnApp(context, fake, target);
  await child.waitForOutput("DELIVERY INBOX");
  await child.writeKeys("\t");
  await child.waitForOutput("delivery.admit");
  await child.writeKeys("\r");
  await child.waitForOutput("EXECUTION");
  await child.writeKeys("x");
  const result = await child.wait(5_000);
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.match(result.text, /Lifecycle canonical CLI handoff/u);
  assert.match(result.text, /Controller outcome: print-only handoff/u);
  assert.match(result.text, /Required operation input: none/u);
  assert.match(result.text, /<authority-secret-file>/u);
  assert.match(result.text, /derives all target, Process, package, identity, digest, and time mechanics/u);
  assert.match(result.text, /"admit"/u);
  assert.match(result.text, /<authority-secret-file>/u);
  assert.ok(result.text.lastIndexOf(TERMINAL_RESTORE_SEQUENCE) < result.text.lastIndexOf("Lifecycle canonical CLI handoff"));
  assertOnlyReadCommands(fakeLifecycleCommands(await readFakeLifecycleEvents(fake)));
});

test("Frame submits one complete fresh brief, renders the Boundary, and hands admission back to the Founder", { timeout: 10_000 }, async (context) => {
  const { fake, target } = await fixture(context, "observed");
  const child = await spawnApp(context, fake, target, 100, 60);
  await child.waitForOutput("DELIVERY INBOX");
  const beforeFrame = child.text.length;
  await child.writeKeys("\t\t");
  await waitForNewToken(child, "INPUT", beforeFrame);
  await child.writeKeys("\r");
  await child.writeKeys("\u001b[200~# Complete fresh brief\n\nInspect the exact target.\u001b[201~");
  const beforePrepare = child.text.length;
  await child.writeKeys(new Uint8Array([19]));
  await waitForCommandFollowing(fake, "prepare", "inspect");
  await delay(100);
  assert.match(child.text.slice(beforePrepare), /use current boundary/u);
  await child.writeKeys("q");
  const result = await child.wait(5_000);
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.match(result.text, /INPUT/u);
  assert.match(result.text, /BOUNDARY/u);
  assert.match(result.text, /delivery\.admit/u);

  const events = await readFakeLifecycleEvents(fake);
  const commands = fakeLifecycleCommands(events);
  assert.ok(commands.includes("inbox"));
  assert.ok(commands.includes("inspect"));
  assert.equal(commands.filter((command) => command === "prepare").length, 1);
  const prepare = events.find((event) => event.kind === "invoke" && event.command === "prepare");
  assert.ok(prepare?.kind === "invoke");
  const inputIndex = prepare.args.indexOf("--input");
  assert.ok(inputIndex > 1);
  await assert.rejects(access(prepare.args[inputIndex + 1]!), { code: "ENOENT" });
});

test("Control explorer drills through runtime families, records, revisions, and exact content", { timeout: 15_000 }, async (context) => {
  const { fake, target } = await fixture(context, "observed");
  const child = await spawnApp(context, fake, target, 110, 60);
  await child.waitForOutput("DELIVERY INBOX");
  await child.writeKeys("c");
  await waitForCommandCompletion(fake, "inspect", 2);
  await child.writeKeys("\r");
  await waitForCommandCompletion(fake, "inspect", 3);
  await child.writeKeys("\r");
  await waitForCommandCompletion(fake, "inspect", 4);
  const beforeExact = child.text.length;
  await child.writeKeys("\r");
  await waitForNewToken(child, "MARKDOWN", beforeExact);
  await child.writeKeys("q");
  const result = await child.wait(5_000);
  assert.equal(result.exitCode, 0);
  assert.match(result.text, /boundary-proposed-v10/u);
  assert.match(result.text, /PAYLOAD/u);
  const events = await readFakeLifecycleEvents(fake);
  const inspections = events.filter((event) => event.kind === "invoke" && event.command === "inspect");
  assert.equal(inspections.length, 4, "one Delivery view plus three exact Control selections");
  for (const inspection of inspections) {
    assert.ok(inspection.kind === "invoke");
    assert.deepEqual(inspection.args.slice(0, 3), ["inspect", target, "delivery-tui-v10"]);
  }
  assert.ok(fakeLifecycleCommands(events).every((command) =>
    ["version", "validate", "inbox", "inspect", "watch"].includes(command)));
});

test("typed missing contract renders setup and x prints initialization guidance without executing it", async (context) => {
  const { fake, target } = await fixture(context, "setup");
  const child = await spawnApp(context, fake, target);
  await child.waitForOutput("SETUP");
  const beforeReview = child.text.length;
  await child.writeKeys("\r");
  await waitForNewToken(child, "EXECUTION", beforeReview);
  await child.writeKeys("x");
  const result = await child.wait(5_000);
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.match(result.text, /Lifecycle canonical CLI handoff/u);
  assert.match(result.text, /"initialize"/u);
  assert.match(result.text, /<initialization-input\.json>/u);
  assert.match(result.text, /<authority-secret-file>/u);
  assertOnlyReadCommands(fakeLifecycleCommands(await readFakeLifecycleEvents(fake)));
});

test("a pending refresh cannot mix the prior snapshot into review or handoff", async (context) => {
  const { fake, target } = await fixture(context, "refresh-slow");
  const child = await spawnApp(context, fake, target);
  await child.waitForOutput("DELIVERY INBOX");
  const beforeRefresh = child.text.length;
  await child.writeKeys("r");
  await waitForFakeLifecycleInvocations(fake, 3);
  await waitForNewToken(child, "REFRESHING", beforeRefresh);
  const beforeRejectedReview = child.text.length;
  await child.writeKeys("\rx");
  await delay(150);
  assert.equal(child.settled, false);
  assert.equal(child.text.slice(beforeRejectedReview).includes("EXECUTION"), false);
  assert.doesNotMatch(child.text, /Lifecycle canonical CLI handoff/u);

  await child.writeKeys("q");
  const result = await child.wait(5_000);
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.doesNotMatch(result.text, /Lifecycle canonical CLI handoff/u);
  assertOnlyReadCommands(fakeLifecycleCommands(await readFakeLifecycleEvents(fake)));
});

test("Ctrl-C cancels a pending read without quitting, then quits from the failed dashboard", async (context) => {
  const { fake, target } = await fixture(context, "slow");
  const child = await spawnApp(context, fake, target);
  await child.waitForOutput("Reading");
  await waitForFakeLifecycleInvocations(fake, 3);
  const beforeFailure = child.text.length;
  await child.writeKeys(new Uint8Array([3]));
  await waitForNewToken(child, "UNAVAILABLE", beforeFailure);
  assert.equal(child.settled, false);
  await child.writeKeys(new Uint8Array([3]));
  const result = await child.wait(5_000);
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.doesNotMatch(result.text, /Lifecycle canonical CLI handoff/u);
  const events = await readFakeLifecycleEvents(fake);
  assert.ok(events.some((event) => event.kind === "signal" && event.signal === "SIGINT"));
  assertOnlyReadCommands(fakeLifecycleCommands(events));
});

test("quit force-cancels an interrupt-resistant read without a deadlock", async (context) => {
  const { fake, target } = await fixture(context, "ignore-cancel");
  const child = await spawnApp(context, fake, target);
  await child.waitForOutput("Reading");
  await waitForFakeLifecycleInvocations(fake, 3);
  const startedAt = Date.now();
  await child.writeKeys("q");
  const result = await child.wait(5_000);
  assert.equal(result.exitCode, 0);
  assert.equal(result.signal, null);
  assert.ok(Date.now() - startedAt < 4_000);
  assert.ok(result.text.includes(TERMINAL_RESTORE_SEQUENCE));
  const events = await readFakeLifecycleEvents(fake);
  assert.ok(events.some((event) => event.kind === "signal" && event.signal === "SIGINT"));
  assertOnlyReadCommands(fakeLifecycleCommands(events));
});
