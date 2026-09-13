import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chmod, lstat, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { withDeliveryOperationLock } from "../../src/foundation/control/delivery-operation-lock.js";
import { FoundationError } from "../../src/foundation/error.js";

const LOCK_MODULE = new URL("../../src/foundation/control/delivery-operation-lock.js", import.meta.url).href;
const supported = process.platform === "darwin" || process.platform === "linux";
const HOLD_LOCK = String.raw`
const [moduleUrl, machineHome, targetId, deliveryId] = process.argv.slice(1);
const { withDeliveryOperationLock } = await import(moduleUrl);
await withDeliveryOperationLock({ machineHome, targetId, deliveryId }, "test-holder", async () => {
  process.stdout.write("locked\n");
  await new Promise((resolve, reject) => {
    process.stdin.once("data", resolve);
    process.stdin.once("end", resolve);
    process.stdin.once("error", reject);
    process.stdin.resume();
  });
});
`;

type Selection = Parameters<typeof withDeliveryOperationLock>[0];
type Holder = Readonly<{
  child: ChildProcessWithoutNullStreams;
  exit: Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>;
}>;

async function startHolder(selection: Selection, holders: Holder[]): Promise<Holder> {
  const child = spawn(process.execPath, [
    "--input-type=module", "--eval", HOLD_LOCK,
    LOCK_MODULE, selection.machineHome, selection.targetId, selection.deliveryId,
  ], { stdio: ["pipe", "pipe", "pipe"] });
  const exit = new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>((resolveExit) => {
    child.once("close", (code, signal) => resolveExit({ code, signal }));
  });
  holders.push({ child, exit });
  await new Promise<void>((resolveReady, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Delivery lock owner did not become ready: ${stderr}`));
    }, 10_000);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.includes("locked\n")) {
        clearTimeout(timeout);
        resolveReady();
      }
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      reject(new Error(`Delivery lock owner exited: ${String(code)} ${String(signal)} ${stderr}`));
    });
  });
  return { child, exit };
}

async function fixture(context: TestContext): Promise<Readonly<{
  selection: Selection;
  hold: () => Promise<Holder>;
}>> {
  const machineHome = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-delivery-lock-")));
  const holders: Holder[] = [];
  context.after(async () => {
    for (const { child, exit } of holders) {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await exit;
    }
    await rm(machineHome, { recursive: true, force: true });
  });
  const selection = { machineHome, targetId: "target.lock-test", deliveryId: "delivery.lock-test" };
  return { selection, hold: () => startHolder(selection, holders) };
}

async function onlySupport(selection: Selection): Promise<string> {
  const directory = join(selection.machineHome, "delivery-operation-locks");
  const entries = await readdir(directory);
  assert.equal(entries.length, 1);
  return join(directory, entries[0]!);
}

test("Delivery lock excludes the same Store while independent Deliveries enter concurrently", { skip: !supported }, async (context) => {
  const { selection, hold } = await fixture(context);
  const holder = await hold();
  const supportPath = await onlySupport(selection);
  const before = await lstat(supportPath);
  let sameEntered = false;
  await assert.rejects(withDeliveryOperationLock(selection, "test-recovery", async () => {
    sameEntered = true;
  }), (error: unknown) => {
    assert.ok(error instanceof FoundationError);
    assert.equal(error.code, "operation.busy");
    assert.equal(error.retryable, true);
    assert.deepEqual(error.observedFacts, {
      operationDomain: "delivery", targetId: selection.targetId, deliveryId: selection.deliveryId,
    });
    assert.equal(JSON.stringify(error.toJSON()).includes(selection.machineHome), false);
    return true;
  });
  assert.equal(sameEntered, false);
  const entered = await Promise.all([
    withDeliveryOperationLock({ ...selection, deliveryId: "delivery.independent" }, "test-other-delivery", async () => "delivery"),
    withDeliveryOperationLock({ ...selection, targetId: "target.independent" }, "test-other-target", async () => "target"),
  ]);
  assert.deepEqual(entered, ["delivery", "target"]);
  assert.equal(holder.child.exitCode, null);
  holder.child.stdin.end("release\n");
  assert.deepEqual(await holder.exit, { code: 0, signal: null });
  assert.equal(await withDeliveryOperationLock(selection, "test-retry", async () => "entered"), "entered");
  const after = await lstat(supportPath);
  assert.equal(after.dev, before.dev);
  assert.equal(after.ino, before.ino);
});

test("Delivery lock releases after parent loss without deleting or replacing permanent support", { skip: !supported }, async (context) => {
  const { selection, hold } = await fixture(context);
  const holder = await hold();
  const supportPath = await onlySupport(selection);
  const before = await lstat(supportPath);
  assert.equal(holder.child.kill("SIGKILL"), true);
  assert.deepEqual(await holder.exit, { code: null, signal: "SIGKILL" });
  assert.equal(await withDeliveryOperationLock(selection, "test-recover", async () => "recovered"), "recovered");
  const after = await lstat(supportPath);
  assert.equal(after.dev, before.dev);
  assert.equal(after.ino, before.ino);
  assert.equal(after.mode & 0o7777, 0o600);
});

test("Delivery lock preserves callback failure and refuses substituted or nonprivate support before entry", { skip: !supported }, async (context) => {
  const { selection } = await fixture(context);
  const expected = new Error("bounded callback failure");
  await assert.rejects(withDeliveryOperationLock(selection, "test-failure", async () => { throw expected; }), (error) => error === expected);
  assert.equal(await withDeliveryOperationLock(selection, "test-after-failure", async () => true), true);
  const supportPath = await onlySupport(selection);
  let entered = false;
  const attempt = () => withDeliveryOperationLock(selection, "test-invalid-support", async () => { entered = true; });
  await chmod(supportPath, 0o644);
  await assert.rejects(attempt(), (error: unknown) => error instanceof FoundationError && error.code === "operation.lock_file");
  const external = join(selection.machineHome, "foreign-content");
  await writeFile(external, "preserve exact external bytes\n", { mode: 0o600 });
  await rm(supportPath);
  await symlink(external, supportPath);
  await assert.rejects(attempt(), (error: unknown) => {
    assert.ok(error instanceof FoundationError);
    assert.equal(error.code, "operation.lock_support");
    assert.equal(JSON.stringify(error.toJSON()).includes(selection.machineHome), false);
    return true;
  });
  assert.equal(entered, false);
  assert.equal((await lstat(external)).mode & 0o7777, 0o600);
  assert.equal(await readFile(external, "utf8"), "preserve exact external bytes\n");
});
