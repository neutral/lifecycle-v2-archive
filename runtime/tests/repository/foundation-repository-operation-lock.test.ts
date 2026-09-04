import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FoundationError } from "../../src/foundation/error.js";
import { git, gitCommonDirectory } from "../../src/foundation/repository/git.js";
import {
  foundationTargetOperationLockProvider,
  withTargetOperationLock,
} from "../../src/foundation/repository/operation-lock.js";

const OPERATION_LOCK_MODULE = new URL(
  "../../src/foundation/repository/operation-lock.js",
  import.meta.url,
).href;

const HOLD_OPERATION_LOCK = String.raw`
const [repository, operationLockModule] = process.argv.slice(1);
const { withTargetOperationLock } = await import(operationLockModule);

await withTargetOperationLock(repository, "test-holder", async () => {
  process.stdout.write("locked\n");
  await new Promise((resolve, reject) => {
    process.stdin.once("data", resolve);
    process.stdin.once("end", resolve);
    process.stdin.once("error", reject);
    process.stdin.resume();
  });
});
`;

type Holder = Readonly<{
  child: ChildProcessWithoutNullStreams;
  stderr: () => string;
}>;

type ChildExit = Readonly<{
  code: number | null;
  signal: NodeJS.Signals | null;
}>;

function waitForExit(child: ChildProcessWithoutNullStreams): Promise<ChildExit> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(Object.freeze({ code: child.exitCode, signal: child.signalCode }));
  }
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve(Object.freeze({ code, signal })));
  });
}

function startHolder(repository: string): Promise<Holder> {
  const child = spawn(process.execPath, [
    "--input-type=module",
    "--eval",
    HOLD_OPERATION_LOCK,
    repository,
    OPERATION_LOCK_MODULE,
  ], { stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let ready = false;
    const timeout = setTimeout(() => {
      if (!ready) {
        child.kill("SIGKILL");
        reject(new Error(`Operation-lock holder did not become ready: ${stderr}`));
      }
    }, 10_000);
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (!ready && stdout.includes("locked\n")) {
        ready = true;
        clearTimeout(timeout);
        resolve(Object.freeze({ child, stderr: () => stderr }));
      }
    });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (error) => {
      clearTimeout(timeout);
      if (!ready) reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (!ready) reject(new Error(
        `Operation-lock holder exited before readiness: code=${String(code)} signal=${String(signal)} stderr=${stderr}`,
      ));
    });
  });
}

test("operation lock selects exact descriptor providers for supported Runtime hosts", () => {
  assert.deepEqual(foundationTargetOperationLockProvider("darwin"), {
    executable: "/usr/bin/lockf",
    arguments: ["-s", "-t", "0", "3"],
    contentionExitCode: 75,
  });
  assert.deepEqual(foundationTargetOperationLockProvider("linux"), {
    executable: "/usr/bin/flock",
    arguments: ["-x", "-n", "-E", "75", "3"],
    contentionExitCode: 75,
  });
  assert.throws(
    () => foundationTargetOperationLockProvider("win32"),
    (error: unknown) => {
      if (!(error instanceof FoundationError)) return false;
      assert.equal(error.code, "operation.lock_unavailable");
      assert.deepEqual(error.observedFacts, { platform: "win32" });
      return true;
    },
  );
});

test("operation lock serializes linked worktrees, not independent repositories, and releases with its owner", {
  skip: process.platform === "darwin" || process.platform === "linux"
    ? false
    : "Foundation operation locking requires the installed macOS or Linux descriptor-lock provider",
}, async (context) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-operation-domain-")));
  const canonical = join(root, "canonical");
  const linked = join(root, "linked");
  const independent = join(root, "independent");
  let holder: Holder | null = null;
  context.after(async () => {
    if (holder !== null && holder.child.exitCode === null && holder.child.signalCode === null) {
      holder.child.kill("SIGKILL");
      await waitForExit(holder.child);
    }
    await rm(root, { recursive: true, force: true });
  });

  await mkdir(canonical);
  await git(canonical, ["init", "-b", "main"]);
  await git(canonical, ["config", "user.name", "Lifecycle Test"]);
  await git(canonical, ["config", "user.email", "lifecycle@example.invalid"]);
  await writeFile(join(canonical, "subject.txt"), "operation domain\n", "utf8");
  await git(canonical, ["add", "--", "subject.txt"]);
  await git(canonical, ["commit", "-m", "Create operation-domain subject"]);
  await git(canonical, ["worktree", "add", "-b", "linked-operation-domain", linked, "HEAD"]);

  await mkdir(independent);
  await git(independent, ["init", "-b", "main"]);

  const [canonicalCommon, linkedCommon, independentCommon] = await Promise.all([
    gitCommonDirectory(canonical),
    gitCommonDirectory(linked),
    gitCommonDirectory(independent),
  ]);
  assert.equal(linkedCommon, canonicalCommon);
  assert.notEqual(independentCommon, canonicalCommon);

  holder = await startHolder(canonical);
  const supportPath = join(canonicalCommon, "lifecycle", "operation.lock");
  const supportWhileOwned = await lstat(supportPath);
  assert.equal(supportWhileOwned.isFile(), true);

  let independentEntered = false;
  await withTargetOperationLock(independent, "test-independent", async () => {
    independentEntered = true;
  });
  assert.equal(independentEntered, true);

  let linkedEntered = false;
  const failure = await withTargetOperationLock(linked, "test-linked", async () => {
    linkedEntered = true;
  }).then(() => null, (error: unknown) => error);
  assert.equal(linkedEntered, false);
  assert(failure instanceof FoundationError);
  assert.equal(failure.code, "operation.busy");
  assert.equal(failure.retryable, true);
  assert.match(failure.message, /Git common-directory operation domain, possibly through a linked worktree/u);
  assert.deepEqual(failure.observedFacts, { operationDomain: "git-common-directory" });
  assert(!JSON.stringify(failure.toJSON()).includes(root));

  const holderExit = waitForExit(holder.child);
  assert.equal(holder.child.kill("SIGKILL"), true);
  assert.deepEqual(await holderExit, { code: null, signal: "SIGKILL" }, holder.stderr());
  const supportAfterOwnerExit = await lstat(supportPath);
  assert.equal(supportAfterOwnerExit.isFile(), true);
  assert.equal(supportAfterOwnerExit.dev, supportWhileOwned.dev);
  assert.equal(supportAfterOwnerExit.ino, supportWhileOwned.ino);

  let linkedEnteredAfterRelease = false;
  await withTargetOperationLock(linked, "test-linked-retry", async () => {
    linkedEnteredAfterRelease = true;
  });
  assert.equal(linkedEnteredAfterRelease, true);

  const permanentSupport = await lstat(supportPath);
  assert.equal(permanentSupport.isFile(), true);
  assert.equal(permanentSupport.dev, supportWhileOwned.dev);
  assert.equal(permanentSupport.ino, supportWhileOwned.ino);
});
