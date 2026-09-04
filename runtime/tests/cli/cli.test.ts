import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { cliFailureExitCode } from "../../src/cli.js";
import { LifecycleError } from "../../src/errors.js";
import { allHelpLeafPaths } from "../../src/cli-help.js";
import { FOUNDATION_GENERATED_PUBLICATION_DIGEST } from "../../src/foundation/validation/generated-schemas.js";

const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const CLI = join(SOURCE_ROOT, "runtime", "bin", "lifecycle.mjs");

type CliResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

type CliError = {
  code: string;
  message: string;
  recoveryActions: Array<{ action: string; detail: string }>;
};

function runCli(
  args: string[],
  authoritySecret?: string,
  environmentAdditions: NodeJS.ProcessEnv = {},
): CliResult {
  const environment: NodeJS.ProcessEnv = { ...process.env, ...environmentAdditions };
  delete environment.LIFECYCLE_AUTHORITY_SECRET;
  if (authoritySecret !== undefined) environment.LIFECYCLE_AUTHORITY_SECRET = authoritySecret;
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: SOURCE_ROOT,
    encoding: "utf8",
    env: environment,
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.ifError(result.error);
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function eventuallyProcessGone(pid: number, label: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

function bootstrapQualificationPids(stderr: string): { supervisorPid: number; selectedPid: number } | undefined {
  const supervisor = /Lifecycle bootstrap supervisor pid: ([1-9][0-9]*)\./u.exec(stderr);
  const selected = /Lifecycle bootstrap selected pid: ([1-9][0-9]*)\./u.exec(stderr);
  if (!stderr.includes("Lifecycle bootstrap handoff ready.\n") || supervisor === null || selected === null) return undefined;
  return { supervisorPid: Number(supervisor[1]), selectedPid: Number(selected[1]) };
}

function exactError(result: CliResult): CliError {
  assert.equal(result.stdout, "");
  assert.equal(result.status, 2);
  return (JSON.parse(result.stderr) as { error: CliError }).error;
}

test("root help presents Foundation v1 as the sole route", () => {
  const concise = runCli([]);
  assert.equal(concise.status, 0);
  assert.equal(concise.stderr, "");
  assert.match(concise.stdout, /Lifecycle Foundation v1/u);
  assert.match(concise.stdout, /COMMON COMMANDS/u);
  assert.doesNotMatch(concise.stdout, /lifecycle successor|lifecycle method|lifecycle delivery /u);

  for (const args of [["--help"], ["-h"], ["help"]]) {
    const full = runCli(args);
    assert.equal(full.status, 0);
    assert.equal(full.stderr, "");
    assert.match(full.stdout, /COMMANDS/u);
    assert.match(full.stdout, /initialize/u);
    assert.match(full.stdout, /no-ship/u);
    assert.doesNotMatch(full.stdout, /\b(?:successor|method|migrate|abandon)\b/u);
  }
});

test("every direct command exposes side-effect-free contextual help", () => {
  for (const leaf of allHelpLeafPaths()) {
    const explicit = runCli(["help", leaf]);
    assert.equal(explicit.status, 0, `${leaf}: ${explicit.stderr}`);
    assert.equal(explicit.stderr, "");
    assert.match(explicit.stdout, /USAGE/u);
    assert.match(explicit.stdout, new RegExp(`lifecycle ${leaf}\\b`, "u"));

    for (const flag of ["--help", "-h"]) {
      const inline = runCli([leaf, "/target-that-must-not-be-inspected", "--unsupported", flag]);
      assert.equal(inline.status, 0, `${leaf} ${flag}: ${inline.stderr}`);
      assert.equal(inline.stderr, "");
      assert.equal(inline.stdout, explicit.stdout);
    }
  }
});

test("version aliases preserve the exact Foundation v1 identity", () => {
  const canonical = runCli(["version"]);
  assert.equal(canonical.status, 0);
  assert.equal(canonical.stderr, "");
  assert.deepEqual(JSON.parse(canonical.stdout), {
    runtimeVersion: "1.0.0",
    runtimeProtocol: "lifecycle.runtime.foundation.v10",
    specificationId: "lifecycle",
    specificationRevision: "lifecycle.foundation.1.0.0-rc.10",
    specificationStatus: "draft",
    publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
    authenticatedPublicationStatus: null,
    provider: {
      defaultDescriptorId: "codex-exec-standard-v6",
      defaultDescriptorDigest: "sha256:2e7d6aa152145518c6ce35b561384eb9f0e49dd2736ea019f18d47d5f095fc9e",
      protocol: "lifecycle.provider-adapter.v6",
    },
    codex: {
      executableRange: ">=0.151.0 <0.152.0",
      generatedWith: "0.151.0",
      protocol: "exec-jsonl-v1",
    },
  });
  for (const alias of ["--version", "-V"]) {
    const result = runCli([alias]);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.deepEqual(JSON.parse(result.stdout), JSON.parse(canonical.stdout));
  }
});

test("signal exit codes preserve first-signal failure causality and repeated-force causality", () => {
  const interrupted = new LifecycleError({ code: "runtime.interrupted", message: "cancelled", retryable: true });
  const recovery = new LifecycleError({ code: "transaction.recovery_required", message: "retry exact transition", retryable: true });
  assert.equal(cliFailureExitCode(interrupted, "SIGINT", false), 130);
  assert.equal(cliFailureExitCode(recovery, "SIGINT", false), 1);
  assert.equal(cliFailureExitCode(recovery, "SIGINT", true), 130);
  assert.equal(cliFailureExitCode(recovery, null, false), 1);
});

test("a closed stdout consumer does not produce a stack trace or failure", async () => {
  const child = spawn(process.execPath, [CLI, "--help"], {
    cwd: SOURCE_ROOT,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  child.stdout.destroy();
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveResult, rejectResult) => {
    child.on("error", rejectResult);
    child.on("close", (code, signal) => resolveResult({ code, signal }));
  });
  assert.deepEqual(result, { code: 0, signal: null });
  assert.equal(stderr, "");
});

test("the launcher buffers a signal received before the runtime module is imported", async () => {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    LIFECYCLE_BOOTSTRAP_QUALIFICATION: "lifecycle-bootstrap-signal-v1",
    LIFECYCLE_BOOTSTRAP_QUALIFICATION_DELAY_MS: "1500",
  };
  const child = spawn(process.execPath, [CLI, "--help"], {
    cwd: SOURCE_ROOT,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  assert.equal(child.kill("SIGINT"), true);
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveResult, rejectResult) => {
    child.on("error", rejectResult);
    child.on("close", (code, signal) => resolveResult({ code, signal }));
  });
  assert.deepEqual(result, { code: 130, signal: null });
  assert.equal(stdout, "");
  const failure = (JSON.parse(stderr) as { error: CliError & { retryable: boolean } }).error;
  assert.equal(failure.code, "runtime.interrupted");
  assert.equal(failure.retryable, true);
});

test("the fallback launcher waits for the selected runtime signal handler before forwarding", async () => {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    LIFECYCLE_NODE_PATH: process.execPath,
    LIFECYCLE_BOOTSTRAP_QUALIFICATION: "lifecycle-bootstrap-signal-v1",
    LIFECYCLE_BOOTSTRAP_QUALIFICATION_FORCE_FALLBACK: "1",
    LIFECYCLE_BOOTSTRAP_QUALIFICATION_BUFFER_SIGNAL_V1: "SIGTERM",
    LIFECYCLE_BOOTSTRAP_QUALIFICATION_CHILD_READY_DELAY_MS: "100",
    LIFECYCLE_BOOTSTRAP_QUALIFICATION_DELAY_MS: "1",
  };
  const child = spawn(process.execPath, [CLI, "--help"], {
    cwd: SOURCE_ROOT,
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveResult, rejectResult) => {
    child.on("error", rejectResult);
    child.on("close", (code, signal) => resolveResult({ code, signal }));
  });
  assert.deepEqual(result, { code: 143, signal: null });
  assert.equal(stdout, "");
  const failure = (JSON.parse(stderr) as { error: CliError & { retryable: boolean } }).error;
  assert.equal(failure.code, "runtime.interrupted");
  assert.equal(failure.retryable, true);
});

test("the selected fallback runtime fails closed when its bootstrap parent withholds acknowledgment", async () => {
  const child = spawn(process.execPath, [CLI, "--help"], {
    cwd: SOURCE_ROOT,
    env: {
      ...process.env,
      LIFECYCLE_INTERNAL_BOOTSTRAP_READY_FD_V1: "3",
      LIFECYCLE_INTERNAL_BOOTSTRAP_ACK_FD_V1: "4",
      LIFECYCLE_INTERNAL_BOOTSTRAP_PARENT_FD_V1: "5",
    },
    stdio: ["ignore", "pipe", "pipe", "pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout!.setEncoding("utf8");
  child.stderr!.setEncoding("utf8");
  child.stdout!.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr!.on("data", (chunk: string) => { stderr += chunk; });
  await new Promise<void>((resolveReady, rejectReady) => {
    child.stdio[3]!.once("data", () => resolveReady());
    child.stdio[3]!.once("error", rejectReady);
  });
  child.stdio[4]!.destroy();
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveResult, rejectResult) => {
    child.on("error", rejectResult);
    child.on("close", (code, signal) => resolveResult({ code, signal }));
  });
  assert.deepEqual(result, { code: 1, signal: null });
  assert.equal(stdout, "");
  assert.equal(stderr, "Lifecycle bootstrap parent acknowledgment failed.\n");
});

test("the selected fallback runtime rejects a wrong bootstrap acknowledgment byte", async () => {
  const child = spawn(process.execPath, [CLI, "--help"], {
    cwd: SOURCE_ROOT,
    env: {
      ...process.env,
      LIFECYCLE_INTERNAL_BOOTSTRAP_READY_FD_V1: "3",
      LIFECYCLE_INTERNAL_BOOTSTRAP_ACK_FD_V1: "4",
      LIFECYCLE_INTERNAL_BOOTSTRAP_PARENT_FD_V1: "5",
    },
    stdio: ["ignore", "pipe", "pipe", "pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout!.setEncoding("utf8");
  child.stderr!.setEncoding("utf8");
  child.stdout!.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr!.on("data", (chunk: string) => { stderr += chunk; });
  await new Promise<void>((resolveReady, rejectReady) => {
    child.stdio[3]!.once("data", () => resolveReady());
    child.stdio[3]!.once("error", rejectReady);
  });
  (child.stdio[4] as Writable).end("0");
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveResult, rejectResult) => {
    child.on("error", rejectResult);
    child.on("close", (code, signal) => resolveResult({ code, signal }));
  });
  assert.deepEqual(result, { code: 1, signal: null });
  assert.equal(stdout, "");
  assert.equal(stderr, "Lifecycle bootstrap parent acknowledgment failed.\n");
});

test("the fallback launcher preserves a selected signal before readiness", async (context) => {
  if (process.platform === "win32") return context.skip("POSIX selected-signal qualification");
  const parent = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-bootstrap-early-signal-")));
  context.after(async () => await rm(parent, { recursive: true, force: true }));
  const selectedNode = join(parent, "selected-node");
  await writeFile(selectedNode, [
    "#!/bin/sh",
    "if [ \"$1\" = \"--version\" ]; then",
    "  printf 'v24.14.0\\n'",
    "  exit 0",
    "fi",
    "kill -KILL $$",
    "",
  ].join("\n"), { mode: 0o700 });
  const child = spawn(process.execPath, [CLI, "--help"], {
    cwd: SOURCE_ROOT,
    env: {
      ...process.env,
      LIFECYCLE_NODE_PATH: selectedNode,
      LIFECYCLE_BOOTSTRAP_QUALIFICATION: "lifecycle-bootstrap-signal-v1",
      LIFECYCLE_BOOTSTRAP_QUALIFICATION_FORCE_FALLBACK: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveResult, rejectResult) => {
    child.on("error", rejectResult);
    child.on("close", (code, signal) => resolveResult({ code, signal }));
  });
  assert.deepEqual(result, { code: null, signal: "SIGKILL" });
  assert.equal(stdout, "");
  assert.equal(stderr, "");
});

test("the fallback supervisor kills a stopped selected runtime when its launcher parent is lost", async (context) => {
  if (process.platform === "win32") return context.skip("POSIX detached fallback qualification");
  const child = spawn(process.execPath, [CLI, "--help"], {
    cwd: SOURCE_ROOT,
    env: {
      ...process.env,
      LIFECYCLE_NODE_PATH: process.execPath,
      LIFECYCLE_BOOTSTRAP_QUALIFICATION: "lifecycle-bootstrap-signal-v1",
      LIFECYCLE_BOOTSTRAP_QUALIFICATION_FORCE_FALLBACK: "1",
      LIFECYCLE_BOOTSTRAP_QUALIFICATION_CHILD_READY_DELAY_MS: "100",
      LIFECYCLE_BOOTSTRAP_QUALIFICATION_DELAY_MS: "3000",
      LIFECYCLE_BOOTSTRAP_QUALIFICATION_HANDOFF_MARKER_V1: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let observedPids: { supervisorPid: number; selectedPid: number } | undefined;
  let observeHandoff!: (pids: { supervisorPid: number; selectedPid: number }) => void;
  const handoffObserved = new Promise<{ supervisorPid: number; selectedPid: number }>((resolveHandoff) => {
    observeHandoff = resolveHandoff;
  });
  context.after(() => {
    if (observedPids !== undefined) {
      try { process.kill(-observedPids.supervisorPid, "SIGKILL"); } catch { /* The supervisor group was swept. */ }
      try { process.kill(observedPids.selectedPid, "SIGKILL"); } catch { /* The selected process was swept. */ }
    }
    try { child.kill("SIGKILL"); } catch { /* The launcher was already killed. */ }
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
    const pids = bootstrapQualificationPids(stderr);
    if (pids !== undefined && observedPids === undefined) {
      observedPids = pids;
      observeHandoff(pids);
    }
  });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveResult, rejectResult) => {
    child.on("error", rejectResult);
    child.on("close", (code, signal) => resolveResult({ code, signal }));
  });
  const pids = await Promise.race([
    handoffObserved,
    new Promise<never>((_resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("selected runtime never completed its launcher handoff")), 5_000);
      timeout.unref();
    }),
  ]);
  assert.equal(processAlive(pids.supervisorPid), true);
  assert.equal(processAlive(pids.selectedPid), true);
  process.kill(pids.selectedPid, "SIGSTOP");
  assert.equal(child.kill("SIGKILL"), true);
  const result = await Promise.race([
    closed,
    new Promise<never>((_resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("selected runtime outlived its launcher bound")), 4_000);
      timeout.unref();
    }),
  ]);
  assert.deepEqual(result, { code: null, signal: "SIGKILL" });
  await eventuallyProcessGone(pids.selectedPid, "stopped selected fallback runtime cleanup");
  await eventuallyProcessGone(pids.supervisorPid, "fallback supervisor cleanup");
  assert.equal(stdout, "");
  assert.equal(stderr, [
    "Lifecycle bootstrap handoff ready.",
    `Lifecycle bootstrap supervisor pid: ${pids.supervisorPid}.`,
    `Lifecycle bootstrap selected pid: ${pids.selectedPid}.`,
    "",
  ].join("\n"));
});

test("the fallback supervisor preserves an exact selected-process signal", async (context) => {
  if (process.platform === "win32") return context.skip("POSIX selected-signal qualification");
  const child = spawn(process.execPath, [CLI, "--help"], {
    cwd: SOURCE_ROOT,
    env: {
      ...process.env,
      LIFECYCLE_NODE_PATH: process.execPath,
      LIFECYCLE_BOOTSTRAP_QUALIFICATION: "lifecycle-bootstrap-signal-v1",
      LIFECYCLE_BOOTSTRAP_QUALIFICATION_FORCE_FALLBACK: "1",
      LIFECYCLE_BOOTSTRAP_QUALIFICATION_CHILD_READY_DELAY_MS: "100",
      LIFECYCLE_BOOTSTRAP_QUALIFICATION_DELAY_MS: "3000",
      LIFECYCLE_BOOTSTRAP_QUALIFICATION_HANDOFF_MARKER_V1: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  let observedPids: { supervisorPid: number; selectedPid: number } | undefined;
  let observeHandoff!: (pids: { supervisorPid: number; selectedPid: number }) => void;
  const handoffObserved = new Promise<{ supervisorPid: number; selectedPid: number }>((resolveHandoff) => {
    observeHandoff = resolveHandoff;
  });
  context.after(() => {
    if (observedPids !== undefined) {
      try { process.kill(-observedPids.supervisorPid, "SIGKILL"); } catch { /* The supervisor group was swept. */ }
      try { process.kill(observedPids.selectedPid, "SIGKILL"); } catch { /* The selected process exited. */ }
    }
    try { child.kill("SIGKILL"); } catch { /* The launcher already preserved the selected signal. */ }
  });
  child.stdout.resume();
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
    const pids = bootstrapQualificationPids(stderr);
    if (pids !== undefined && observedPids === undefined) {
      observedPids = pids;
      observeHandoff(pids);
    }
  });
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolveResult, rejectResult) => {
    child.on("error", rejectResult);
    child.on("close", (code, signal) => resolveResult({ code, signal }));
  });
  const pids = await Promise.race([
    handoffObserved,
    new Promise<never>((_resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("selected runtime never completed its launcher handoff")), 5_000);
      timeout.unref();
    }),
  ]);
  process.kill(pids.selectedPid, "SIGKILL");
  const result = await Promise.race([
    closed,
    new Promise<never>((_resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("launcher did not preserve selected SIGKILL")), 4_000);
      timeout.unref();
    }),
  ]);
  assert.deepEqual(result, { code: null, signal: "SIGKILL" });
  await eventuallyProcessGone(pids.supervisorPid, "selected-signal supervisor cleanup");
});


test("legacy command families and the successor namespace have no aliases", () => {
  for (const args of [
    ["successor", "validate", "/target"],
    ["delivery", "status", "/target"],
    ["method", "compile", "/source"],
    ["migrate", "/target"],
    ["init", "/target"],
  ]) {
    const failure = exactError(runCli(args));
    assert.equal(failure.code, "cli.usage", args.join(" "));
    assert.match(failure.message, /Unknown command/u);
    assert.equal(failure.recoveryActions[0]?.action, "lifecycle --help");
  }

  const typo = exactError(runCli(["valdate", "/target"]));
  assert.match(typo.message, /Did you mean validate\?/u);

  const option = exactError(runCli([
    "validate", "/target", "--request-id", "request.validation", "--unsupported", "value",
  ]));
  assert.equal(option.code, "cli.option");
  assert.match(option.message, /Unsupported Lifecycle Foundation option/u);
  assert.equal(option.recoveryActions[0]?.action, "lifecycle help validate");
});

test("installed validate is a direct top-level v7 JSON and human route", async (context) => {
  const owner = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-foundation-cli-validate-")));
  context.after(async () => await rm(owner, { recursive: true, force: true }));
  const unavailableMutationConfiguration = {
    LIFECYCLE_MACHINE_HOME: join(owner, "absent-machine-home"),
    LIFECYCLE_FOUNDATION_PROVIDER_MODEL: "unused-validation-model",
    LIFECYCLE_FOUNDATION_PROVIDER_REASONING: "unused-validation-reasoning",
  };
  const target = join(owner, "missing-target");
  const json = runCli(["validate", target], undefined, unavailableMutationConfiguration);
  assert.equal(json.status, 0, json.stderr);
  assert.equal(json.stderr, "");
  const result = JSON.parse(json.stdout) as {
    operation: string;
    status: string;
    schema: string;
    observation: { repository: { initialized: boolean; valid: boolean }; delivery: unknown };
    value: unknown;
  };
  assert.equal(result.operation, "repository.validate");
  assert.equal(result.status, "completed");
  assert.equal(result.schema, "lifecycle.foundation-runtime-result.v10");
  assert.deepEqual(result.observation.repository, {
    schema: "lifecycle.repository-observation.v10",
    initialized: false,
    valid: false,
    targetId: null,
    repositoryContract: null,
    repositoryContractDigest: null,
    headCommit: null,
    headTree: null,
    productDigest: null,
    atlas: null,
    knowledgeDigest: null,
    checkBindingsDigest: null,
  });
  assert.equal(result.observation.delivery, null);
  assert.equal(result.value, null);

  const human = runCli(
    ["validate", target, "--format", "human"],
    undefined,
    unavailableMutationConfiguration,
  );
  assert.equal(human.status, 0, human.stderr);
  assert.equal(human.stderr, "");
  assert.match(human.stdout, /^repository\.validate: completed\n/u);
  assert.match(human.stdout, /^repository: uninitialized$/mu);
});

test("ambient authority secrets are refused without exposing their bytes", () => {
  const secret = "foundation-cli-secret-that-must-never-be-rendered";
  const failure = exactError(runCli(["version"], secret));
  assert.equal(failure.code, "cli.option");
  assert.match(failure.message, /--authority-secret-file/u);
  assert.doesNotMatch(JSON.stringify(failure), new RegExp(secret, "u"));
});

test("authority-secret files reject malformed UTF-8 without effects or disclosure", async () => {
  const owner = await mkdtemp(join(tmpdir(), "lifecycle-foundation-cli-authority-"));
  const target = join(owner, "target-that-must-not-exist");
  const input = join(owner, "initialize.json");
  const authorityFile = join(owner, "authority.secret");
  const secretMarker = "foundation-cli-malformed-secret-must-not-render";
  try {
    await writeFile(input, "{}\n", "utf8");
    await writeFile(
      authorityFile,
      Buffer.concat([Buffer.from(secretMarker, "utf8"), Buffer.from([0xff])]),
      { mode: 0o600 },
    );

    const result = runCli([
      "initialize",
      target,
      "--input", input,
      "--authority-secret-file", authorityFile,
    ]);
    const failure = exactError(result);
    assert.equal(failure.code, "cli.authority-secret-file");
    assert.match(failure.message, /valid UTF-8/u);
    assert.equal(result.stderr.includes(secretMarker), false);
    await assert.rejects(realpath(target), /ENOENT/u);
  } finally {
    await rm(owner, { recursive: true, force: true });
  }
});
