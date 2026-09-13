import { assertFoundationAuthorityCredential, type FoundationAuthorityCredential } from "../../src/foundation/repository/authority.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { parseFoundationCliErrorJson } from "@neutral/lifecycle-protocol";
import { fileURLToPath } from "node:url";
import {
  startFoundationInvocationPrivateAuthorizationChannelServerV1,
} from "../../src/foundation/invocation-private-authorization-channel-v1.js";

const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const CLI = join(SOURCE_ROOT, "runtime", "bin", "lifecycle.mjs");
const INVOCATION_ID = "c3333333-3333-4333-8333-333333333333";
const CHALLENGE = `lcw1.${INVOCATION_ID}.${"C".repeat(43)}`;
const SECRET = "invocation-private-cli-director-secret-with-sufficient-entropy";

async function runCli(args: readonly string[]): Promise<Readonly<{
  status: number | null;
  stdout: string;
  stderr: string;
}>> {
  const child = spawn(process.execPath, [CLI, ...args], {
    cwd: SOURCE_ROOT,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const status = await new Promise<number | null>((resolveClose, rejectClose) => {
    child.once("error", rejectClose);
    child.once("close", (code) => resolveClose(code));
  });
  return Object.freeze({ status, stdout, stderr });
}

test("canonical authorize command streams the owner-private file and prints only the safe bound result", async (context) => {
  if (process.platform === "win32") return context.skip("Unix authorization channel");
  const directory = await mkdtemp(join(tmpdir(), "lifecycle-authorize-cli-"));
  const authorityFile = join(directory, "authority.secret");
  await writeFile(authorityFile, SECRET, { mode: 0o600 });
  let observed: { challenge: string; authorityCredential: FoundationAuthorityCredential } | null = null;
  const server = await startFoundationInvocationPrivateAuthorizationChannelServerV1({
    invocationId: INVOCATION_ID,
    async handle(request) {
      assertFoundationAuthorityCredential(request.authorityCredential, "director-decision");
      observed = request;
      return {
        kind: "invocation-private-authorization-result",
        invocationId: INVOCATION_ID,
        operation: "delivery.no-ship",
        deliveryId: "delivery:cli",
        status: "recovery-required",
        resultDigest: `sha256:${"4".repeat(64)}`,
      };
    },
  });
  context.after(async () => {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });

  const completed = await runCli([
    "authorize",
    CHALLENGE,
    "--authority-secret-file",
    authorityFile,
  ]);
  assert.equal(completed.status, 0, completed.stderr);
  assert.equal(completed.stderr, "");
  assert.deepEqual(JSON.parse(completed.stdout), {
    kind: "invocation-private-authorization-result",
    invocationId: INVOCATION_ID,
    operation: "delivery.no-ship",
    deliveryId: "delivery:cli",
    status: "recovery-required",
    resultDigest: `sha256:${"4".repeat(64)}`,
  });
  assert.equal((observed as { challenge: string } | null)?.challenge, CHALLENGE);
  assert.doesNotMatch(JSON.stringify(observed), /authoritySecret|director-secret/u);
  assert.deepEqual(Object.keys((observed as { authorityCredential: FoundationAuthorityCredential } | null)!.authorityCredential), []);
  assert.doesNotMatch(completed.stdout + completed.stderr, new RegExp(SECRET, "u"));
  assert.doesNotMatch(completed.stdout, /authority-secret-file|private\/target/u);
});

test("authorize rejects malformed challenges and invalid secret carriers before channel dispatch", async (context) => {
  if (process.platform === "win32") return context.skip("Unix authorization channel");
  const directory = await mkdtemp(join(tmpdir(), "lifecycle-authorize-cli-refusal-"));
  const authorityFile = join(directory, "authority.secret");
  await writeFile(authorityFile, SECRET, { mode: 0o600 });
  let handled = 0;
  const server = await startFoundationInvocationPrivateAuthorizationChannelServerV1({
    invocationId: INVOCATION_ID,
    async handle() {
      handled += 1;
      return {
        kind: "invocation-private-authorization-result",
        invocationId: INVOCATION_ID,
        operation: "delivery.accept",
        deliveryId: "delivery:must-not-run",
        status: "refused",
        resultDigest: `sha256:${"5".repeat(64)}`,
      };
    },
  });
  context.after(async () => {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });

  const malformed = await runCli([
    "authorize",
    "not-a-challenge",
    "--authority-secret-file",
    join(directory, "missing-secret"),
  ]);
  assert.equal(malformed.status, 2);
  assert.equal(JSON.parse(malformed.stderr).error.code, "cli.usage");

  await chmod(authorityFile, 0o644);
  const permissive = await runCli([
    "authorize",
    CHALLENGE,
    "--authority-secret-file",
    authorityFile,
  ]);
  assert.equal(permissive.status, 2);
  assert.equal(JSON.parse(permissive.stderr).error.code, "cli.authority-secret-file");
  assert.doesNotMatch(permissive.stderr, new RegExp(SECRET, "u"));

  await writeFile(authorityFile, Buffer.concat([Buffer.alloc(32, 0x61), Buffer.from([0])]), { mode: 0o600 });
  await chmod(authorityFile, 0o600);
  const nul = await runCli([
    "authorize",
    CHALLENGE,
    `--authority-secret-file=${authorityFile}`,
  ]);
  assert.equal(nul.status, 2);
  assert.equal(JSON.parse(nul.stderr).error.code, "cli.authority-secret-file");
  assert.match(JSON.parse(nul.stderr).error.message, /NUL/u);
  assert.equal(handled, 0);
});

test("authorize resolves the live invocation before touching the authority file", async (context) => {
  if (process.platform === "win32") return context.skip("Unix authorization channel");
  const directory = await mkdtemp(join(tmpdir(), "lifecycle-authorize-cli-missing-"));
  context.after(async () => await rm(directory, { recursive: true, force: true }));
  const missingAuthorityFile = join(directory, "must-not-be-read.secret");
  const missingInvocation = "d4444444-4444-4444-8444-444444444444";
  const missingChallenge = `lcw1.${missingInvocation}.${"D".repeat(43)}`;
  const response = await runCli([
    "authorize",
    missingChallenge,
    "--authority-secret-file",
    missingAuthorityFile,
  ]);
  assert.equal(response.status, 1);
  const failure = JSON.parse(response.stderr).error;
  assert.equal(failure.code, "runtime.authorization-invocation-unavailable");
  assert.doesNotMatch(
    response.stderr,
    new RegExp(`${SECRET}|${missingChallenge}|must-not-be-read`, "u"),
  );
});

test("canonical authorize reports unknown effects after handler failure and does not retry", async (context) => {
  if (process.platform === "win32") return context.skip("Unix authorization channel");
  const directory = await mkdtemp(join(tmpdir(), "lifecycle-authorize-unobserved-"));
  const authorityFile = join(directory, "authority.secret");
  await writeFile(authorityFile, SECRET, { mode: 0o600 });
  let calls = 0;
  const server = await startFoundationInvocationPrivateAuthorizationChannelServerV1({
    invocationId: INVOCATION_ID,
    async handle() {
      calls += 1;
      await writeFile(join(directory, "retained-effect"), "effect applied\n");
      throw new Error(`fixture-private-message ${SECRET}`);
    },
  });
  context.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });
  const response = await runCli(["authorize", CHALLENGE, "--authority-secret-file", authorityFile]);
  assert.equal(response.status, 1);
  assert.equal(response.stdout, "");
  const failure = parseFoundationCliErrorJson(response.stderr);
  assert.equal(failure.code, "runtime.authorization-result-unavailable");
  assert.equal(failure.repositoryChanged, null);
  assert.equal(failure.operationalStateChanged, null);
  assert.equal(failure.retryable, false);
  assert.deepEqual(failure.recoveryActions, []);
  assert.deepEqual(failure.observedFacts, { invocationId: INVOCATION_ID, authorizationSubmission: "may-have-started" });
  assert.doesNotMatch(response.stderr, /fixture-private-message|director-secret|authority\.secret|lcw1\./u);
  assert.equal(calls, 1);
});
