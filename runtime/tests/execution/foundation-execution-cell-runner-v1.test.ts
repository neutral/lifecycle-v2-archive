import assert from "node:assert/strict";
import { chmod, lstat, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  foundationAgentExecutionCellOutputContractV1,
  readFoundationAgentProviderTerminalObservationV1,
} from "../../src/util/agent-execution-cell-operation-v1.js";
import {
  createFoundationProviderControlTunnelBudgetV1,
  foundationAgentCodexExecArgumentsV1,
  foundationAgentReadOnlyWriteDenialCodesV1,
  materializeFoundationAgentProviderVisibleInputV1,
  writeFoundationAgentRunnerTerminalOutputV1,
} from "../../src/util/execution-cell-runner-v1.js";
import {
  parseFoundationExecutionSpecification,
  type FoundationExecutionSpecificationV1,
} from "../../src/foundation/execution/contracts.js";
import {
  canonicalJson,
  selfDigest,
  sha256Bytes,
} from "../../src/foundation/validation/canonical.js";
import { executionContractFixture } from "../support/execution-contract-fixture.js";

test("Agent invocation uses only the named permission profile", () => {
  const arguments_ = foundationAgentCodexExecArgumentsV1({
    cwd: "/lifecycle/work",
    model: "test-model",
    reasoning: "high",
    permissionOverrides: Object.freeze([
      'default_permissions="lifecycle"',
      "permissions.lifecycle.network.enabled=false",
    ]),
  });
  assert.equal(arguments_.includes("-s"), false);
  assert.equal(arguments_.includes("--sandbox"), false);
  assert.equal(arguments_.includes("workspace-write"), false);
  assert.equal(arguments_.includes('default_permissions="lifecycle"'), true);
});

test("Agent isolation recognizes a read-only mount as proven write denial", () => {
  assert.deepEqual(foundationAgentReadOnlyWriteDenialCodesV1, [
    "EACCES",
    "EPERM",
    "EROFS",
  ]);
});

test("runner materializes only the curated provider-visible package as read-only files", async (t) => {
  const owner = await mkdtemp(join(tmpdir(), "lifecycle-provider-visible-input-"));
  const transport = join(owner, "transport");
  const destination = join(owner, "provider");
  t.after(async () => {
    for (const path of [destination, join(destination, "sources")]) {
      try { await chmod(path, 0o700); } catch { /* Test may refuse before materialization. */ }
    }
    for (const path of [
      join(destination, "role-brief.md"),
      join(destination, "sources", "00001-source.md"),
    ]) {
      try { await chmod(path, 0o600); } catch { /* Test may refuse before materialization. */ }
    }
    await rm(owner, { recursive: true, force: true });
  });
  await mkdir(join(transport, ".lifecycle"), { recursive: true });
  await mkdir(join(transport, "sources"), { recursive: true });
  await mkdir(join(transport, "semantic"), { recursive: true });
  await mkdir(join(transport, "candidate"), { recursive: true });
  const values = Object.freeze([
    Object.freeze({ path: "role-brief.md", purpose: "role-brief", bytes: Buffer.from("# Role Brief\n") }),
    Object.freeze({ path: "sources/00001-source.md", purpose: "projection", bytes: Buffer.from("# Source\n") }),
    Object.freeze({ path: "semantic/template.md", purpose: "semantic-template", bytes: Buffer.from("# Template\n") }),
    Object.freeze({ path: "candidate/carrier.pack", purpose: "operation-input", bytes: Buffer.from("private carrier") }),
  ]);
  await writeFile(join(transport, ".lifecycle", "input-set.json"), "private input set");
  for (const value of values) await writeFile(join(transport, value.path), value.bytes, { mode: 0o600 });
  const inputSet = {
    entries: values.map((value) => ({
      path: value.path,
      purpose: value.purpose,
      modeClass: "regular",
      byteLength: value.bytes.byteLength,
      digest: sha256Bytes(value.bytes),
    })),
  };
  assert.equal(await materializeFoundationAgentProviderVisibleInputV1({
    transportInputRoot: transport,
    inputSet,
    destinationRoot: destination,
  }), destination);
  assert.deepEqual((await readdir(destination)).sort(), ["role-brief.md", "sources"]);
  assert.deepEqual(await readdir(join(destination, "sources")), ["00001-source.md"]);
  assert.equal(await readFile(join(destination, "role-brief.md"), "utf8"), "# Role Brief\n");
  assert.equal(await readFile(join(destination, "sources", "00001-source.md"), "utf8"), "# Source\n");
  assert.equal((await lstat(destination)).mode & 0o222, 0);
  assert.equal((await lstat(join(destination, "role-brief.md"))).mode & 0o222, 0);
  await assert.rejects(
    writeFile(join(destination, "role-brief.md"), "changed"),
    (error: unknown) => error instanceof Error,
  );
});

test("runner refuses malformed or executable provider-visible source entries", async (t) => {
  const owner = await mkdtemp(join(tmpdir(), "lifecycle-provider-visible-refusal-"));
  t.after(async () => rm(owner, { recursive: true, force: true }));
  const transport = join(owner, "transport");
  await mkdir(join(transport, "sources"), { recursive: true });
  const role = Buffer.from("# Role Brief\n");
  const source = Buffer.from("# Source\n");
  await writeFile(join(transport, "role-brief.md"), role);
  await writeFile(join(transport, "sources", "source.md"), source);
  await chmod(join(transport, "sources", "source.md"), 0o500);
  const entries = [
    {
      path: "role-brief.md",
      purpose: "role-brief",
      modeClass: "regular",
      byteLength: role.byteLength,
      digest: sha256Bytes(role),
    },
    {
      path: "sources/source.md",
      purpose: "projection",
      modeClass: "regular",
      byteLength: source.byteLength,
      digest: sha256Bytes(source),
    },
  ];
  await assert.rejects(materializeFoundationAgentProviderVisibleInputV1({
    transportInputRoot: transport,
    inputSet: { entries },
    destinationRoot: join(owner, "provider-executable"),
  }), /non-executable regular file/u);
  await chmod(join(transport, "sources", "source.md"), 0o400);
  await assert.rejects(materializeFoundationAgentProviderVisibleInputV1({
    transportInputRoot: transport,
    inputSet: {
      entries: entries.map((entry) => entry.purpose === "projection"
        ? { ...entry, path: "private/source.md" }
        : entry),
    },
    destinationRoot: join(owner, "provider-path"),
  }), /invalid provider-visible entry/u);
});

function agentSpecification(): Readonly<{
  specification: FoundationExecutionSpecificationV1;
  runnerImplementationDigest: `sha256:${string}`;
}> {
  const fixture = executionContractFixture("runner-terminal");
  const subject = JSON.parse(canonicalJson(fixture.specification)) as Record<string, unknown>;
  delete subject.digest;
  const runnerImplementationDigest = sha256Bytes("fixed Agent runner implementation");
  (subject.operation as Record<string, unknown>).adapterImplementationDigest =
    runnerImplementationDigest;
  subject.outputContract = foundationAgentExecutionCellOutputContractV1({
    role: "reconnaissance",
    limits: fixture.specification.limits,
  });
  const specification = parseFoundationExecutionSpecification({
    value: { ...subject, digest: selfDigest(subject) },
    backendProfile: fixture.profile,
    image: fixture.image,
    inputSet: fixture.inputSet,
  });
  return Object.freeze({ specification, runnerImplementationDigest });
}

test("fixed provider-control tunnel budget decrements once and closes admission on retirement", () => {
  const budget = createFoundationProviderControlTunnelBudgetV1(2);
  const first = budget.acquire();
  const second = budget.acquire();
  assert.notEqual(first, null);
  assert.notEqual(second, null);
  assert.equal(budget.acquire(), null);
  assert.deepEqual(budget.observation(), { active: 2, retiring: false });

  first!();
  first!();
  assert.deepEqual(budget.observation(), { active: 1, retiring: false });
  const replacement = budget.acquire();
  assert.notEqual(replacement, null);
  assert.equal(budget.acquire(), null);

  budget.retire();
  second!();
  replacement!();
  assert.deepEqual(budget.observation(), { active: 0, retiring: true });
  assert.equal(budget.acquire(), null);
});

test("runner replaces interrupted finalization with one Specification-bound terminal output", async (t) => {
  const outputRoot = await mkdtemp(join(tmpdir(), "lifecycle-agent-runner-terminal-"));
  t.after(async () => rm(outputRoot, { recursive: true, force: true }));
  await mkdir(join(outputRoot, ".lifecycle"));
  await writeFile(join(outputRoot, ".lifecycle", "output-manifest.pending"), "partial");
  await mkdir(join(outputRoot, "agent-work-product"));
  await writeFile(join(outputRoot, "agent-work-product", "semantic.md"), "provisional");

  const selected = agentSpecification();
  const preparedAt = "2026-09-01T00:00:00.010Z";
  const finishedAt = "2026-09-01T00:00:00.020Z";
  await writeFoundationAgentRunnerTerminalOutputV1({
    outputRoot,
    specification: selected.specification,
    runnerImplementationDigest: selected.runnerImplementationDigest,
    facts: Object.freeze({
      preparedAt,
      startedAt: null,
      finishedAt,
      executableIdentity: null,
      outcome: "runtime-failure",
      stage: "preflight",
      productiveStarted: false,
      firstTrigger: "runtime-failure",
      exitCode: null,
      signal: null,
      sessionId: null,
    }),
  });

  assert.deepEqual((await readdir(outputRoot)).sort(), [".lifecycle", "provider-terminal"]);
  assert.deepEqual(
    (await readdir(join(outputRoot, ".lifecycle"))).sort(),
    ["output-manifest.json"],
  );
  const manifest = JSON.parse(await readFile(
    join(outputRoot, ".lifecycle", "output-manifest.json"),
    "utf8",
  )) as Record<string, unknown>;
  assert.equal(manifest.specificationDigest, selected.specification.digest);
  assert.equal(manifest.entryCount, 1);
  assert.equal((manifest.entries as Array<Record<string, unknown>>)[0]?.path,
    "provider-terminal/observation.json");
  const { digest: manifestDigest, ...manifestSubject } = manifest;
  assert.equal(manifestDigest, selfDigest(manifestSubject));

  const terminalBytes = await readFile(
    join(outputRoot, "provider-terminal", "observation.json"),
  );
  const terminal = await readFoundationAgentProviderTerminalObservationV1({
    artifact: Object.freeze({
      path: "provider-terminal/observation.json",
      entryKind: "file" as const,
      purpose: "operational-artifact",
      mediaType: "application/json",
      modeClass: "regular",
      byteLength: terminalBytes.byteLength,
      digest: sha256Bytes(terminalBytes),
      candidateRepositoryPath: null,
      candidateGitMode: null,
      async *read() { yield Uint8Array.from(terminalBytes); },
    }),
    specification: selected.specification,
    attemptDigest: selected.specification.owner.kind === "agent-attempt"
      ? selected.specification.owner.attempt.digest
      : assert.fail("fixture must be Agent-owned"),
    executableIdentity: sha256Bytes("installed Codex executable"),
    runnerImplementationDigest: selected.runnerImplementationDigest,
  });
  assert.equal(terminal.outcome, "runtime-failure");
  assert.equal(terminal.stage, "preflight");
  assert.equal(terminal.productiveStarted, false);
  assert.equal(terminal.executableIdentity, null);
});
