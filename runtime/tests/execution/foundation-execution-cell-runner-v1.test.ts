import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, link, lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { connect } from "node:net";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import {
  foundationAgentExecutionCellOutputContractV1,
  readFoundationAgentProviderFailureDiagnosticV1,
  readFoundationAgentProviderTerminalObservationV1,
} from "../../src/util/agent-execution-cell-operation-v1.js";
import {
  activateFoundationAgentProviderHomeV1,
  readFoundationAgentProviderCredentialV1,
  createFoundationProviderControlTunnelBudgetV1,
  createFoundationProviderControlProxyV1,
  foundationAgentCodexExecArgumentsV1,
  foundationAgentCandidateInputPresentV1,
  foundationAgentPermissionOverridesV1,
  foundationAgentReadOnlyWriteDenialCodesV1,
  foundationAgentProviderFailureDiagnosticV1,
  materializeFoundationAgentProviderVisibleInputV1,
  resolveFoundationCheckExecutableV1,
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
import { FOUNDATION_AGENT_WORK_PRODUCT_VALIDATION_BASIS_MAXIMUM_BYTES } from "../../src/foundation/control/agent-work-product-semantics.js";

test("provider channel quiesces before output packing while its rejecting listener survives until containment", async () => {
  const specificationDigest = sha256Bytes("quiescence specification");
  const providerPolicyDigest = sha256Bytes("quiescence policy");
  const server = createFoundationProviderControlProxyV1({ specificationDigest, providerPolicyDigest, wallTimeMilliseconds: 1000 });
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  assert(address !== null && typeof address === "object");
  const exchange = async (request: string): Promise<string> => await new Promise((resolveReply, rejectReply) => {
    const client = connect({ host: "127.0.0.1", port: address.port });
    const chunks: Buffer[] = [];
    client.setTimeout(1500, () => client.destroy(new Error("bounded proxy regression timed out")));
    client.once("connect", () => client.write(request));
    client.on("data", (chunk: Buffer) => chunks.push(chunk));
    client.once("error", rejectReply);
    client.once("close", () => resolveReply(Buffer.concat(chunks).toString("ascii")));
  });
  const pending = connect({ host: "127.0.0.1", port: address.port });
  try {
    await new Promise<void>((resolveConnected, rejectConnected) => { pending.once("connect", resolveConnected); pending.once("error", rejectConnected); });
    const pendingClosed = new Promise<void>((resolveClosed) => pending.once("close", resolveClosed));
    const retired = await exchange(`POST /__lifecycle_retire/${specificationDigest}/${providerPolicyDigest} HTTP/1.1\r\nHost: provider-control\r\n\r\n`);
    assert.match(retired, /^HTTP\/1\.1 204 /u);
    await pendingClosed;
    assert.equal(server.listening, true, "Channel quiescence must not detach the expected network peer during Cell output packaging");
    const denied = await exchange("CONNECT api.openai.com:443 HTTP/1.1\r\nHost: api.openai.com\r\n\r\n");
    assert.match(denied, /^HTTP\/1\.1 413 /u);
    assert.equal(server.listening, true, "New tunnels stay refused until explicit owner containment");
  } finally {
    pending.destroy();
    await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
  }
  assert.equal(server.listening, false);
});

test("failed provider diagnostics retain only bounded error observations and redact private material", async () => {
  const credential = "fixture-credential-only-for-redaction";
  const bytes = foundationAgentProviderFailureDiagnosticV1({
    stdout: Buffer.from([
      JSON.stringify({ type: "item.completed", item: { type: "reasoning", text: "unretained reasoning" } }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "unretained conversation" } }),
      JSON.stringify({ type: "error", message: `Unavailable model fixture-model. ${credential} /private/operator/auth.json https://example.invalid/private?token=secret Bearer opaque-fixture-credential` }),
      JSON.stringify({ type: "turn.failed", error: { message: "Provider rejected this request with status 401." } }),
    ].join("\n")),
    stderr: Buffer.from("unretained ordinary stderr"),
    stdoutTruncated: false, stderrTruncated: false, credentialValues: [credential],
  });
  const value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  assert.equal(value.source, "provider-reported");
  assert.equal(value.observation, "untrusted-operational-material");
  assert.equal(value.entries.length, 2);
  assert.match(value.entries[0].message, /Unavailable model fixture-model/u);
  for (const forbidden of [credential, "/private/operator", "?token", "opaque-fixture", "unretained"]) {
    assert.equal(Buffer.from(bytes).toString("utf8").includes(forbidden), false);
  }
  const artifact = Object.freeze({
    entryKind: "file" as const,
    path: "provider-result/failure.json", purpose: "raw-provider-output" as const,
    mediaType: "application/json", modeClass: "regular" as const,
    byteLength: bytes.byteLength, digest: sha256Bytes(bytes),
    candidateRepositoryPath: null, candidateGitMode: null,
    read: async function* () { yield bytes; },
  });
  assert.deepEqual(await readFoundationAgentProviderFailureDiagnosticV1({ artifact }), bytes);
});

test("provider stderr diagnostics retain a Rust panic's immediate cause without its backtrace or chatter", () => {
  const credential = "fixture-panic-credential";
  const bytes = foundationAgentProviderFailureDiagnosticV1({
    stdout: Buffer.alloc(0),
    stderr: Buffer.from([
      "unretained startup chatter",
      "Error: fs sandbox helper failed: thread 'main' (1) panicked at linux-sandbox/src/linux_run_main.rs:1293:9:",
      `failed to create sandbox registry /private/operator/registry: Permission denied (os error 13), ${credential}`,
      "stack backtrace:",
      "0: unretained backtrace frame",
      "unretained context continuation",
      "Error: unrelated single-line error",
      "unretained nonpanic continuation",
      "thread 'worker' panicked at linux-sandbox/src/main.rs:12:3:",
      "failed to start helper: Resource temporarily unavailable (os error 11)",
    ].join("\n")),
    stdoutTruncated: false, stderrTruncated: false, credentialValues: [credential],
  });
  const value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  assert.equal(value.entries.length, 3);
  assert.match(value.entries[0].message, /Permission denied \(os error 13\)/u);
  assert.match(value.entries[2].message, /Resource temporarily unavailable \(os error 11\)/u);
  for (const forbidden of [credential, "/private/operator", "backtrace", "unretained"]) {
    assert.equal(Buffer.from(bytes).toString("utf8").includes(forbidden), false);
  }
  assert.equal(value.entries[1].message, "Error: unrelated single-line error");
});

test("provider diagnostic selection bounds Unicode, records truncation, and withholds unavailable redaction", () => {
  const bytes = foundationAgentProviderFailureDiagnosticV1({
    stdout: Buffer.from(Array.from({ length: 12 }, () => JSON.stringify({ type: "error", message: "\u{1f680}".repeat(4096) })).join("\n")),
    stderr: Buffer.alloc(0), stdoutTruncated: false, stderrTruncated: false, credentialValues: [],
  });
  const value = JSON.parse(Buffer.from(bytes).toString("utf8"));
  assert.equal(value.truncated, true);
  assert.ok(bytes.byteLength <= 16 * 1024);
  assert.ok(value.entries.length <= 8);
  assert.ok(value.entries.every((entry: { message: string }) => Buffer.byteLength(entry.message) <= 2048));
  const withheld = foundationAgentProviderFailureDiagnosticV1({
    stdout: Buffer.alloc(0), stderr: Buffer.from("ordinary chatter\nError: sensitive detail\n"),
    stdoutTruncated: false, stderrTruncated: false, credentialValues: null,
  });
  assert.equal(Buffer.from(withheld).toString("utf8").includes("sensitive detail"), false);
  assert.match(Buffer.from(withheld).toString("utf8"), /redaction unavailable/u);
});

test("provider diagnostic reader refuses arbitrary events and noncanonical or oversized detail", async () => {
  const base = {
    schema: "lifecycle.agent-provider-failure-diagnostic.private.v1",
    source: "provider-reported", observation: "untrusted-operational-material",
    entries: [{ stream: "stdout-json", eventType: "error", message: "fixture provider failure" }], truncated: false,
  };
  for (const value of [
    { ...base, entries: [{ stream: "stdout-json", eventType: "item.completed", message: "not an error" }] },
    { ...base, entries: [{ stream: "stdout-json", eventType: "error", message: "x".repeat(2049) }] },
    { ...base, transcript: "undeclared" },
  ]) {
    const bytes = Buffer.from(`${canonicalJson(value)}\n`);
    await assert.rejects(readFoundationAgentProviderFailureDiagnosticV1({ artifact: {
      entryKind: "file",
      path: "provider-result/failure.json", purpose: "raw-provider-output",
      mediaType: "application/json", modeClass: "regular",
      byteLength: bytes.byteLength, digest: sha256Bytes(bytes),
      candidateRepositoryPath: null, candidateGitMode: null,
      read: async function* () { yield bytes; },
    } }), /closed bounded shape/u);
  }
});

test("Check dispatch resolves the declared image or Candidate base despite a Candidate shadow", async (t) => {
  const owner = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-check-executable-")));
  t.after(async () => rm(owner, { recursive: true, force: true }));
  const subjectRoot = join(owner, "candidate");
  const imageTool = join(owner, "image-tool");
  const imagePath = relative("/", imageTool);
  const shadow = join(subjectRoot, imagePath);
  await mkdir(dirname(shadow), { recursive: true });
  const imageBytes = Buffer.from("#!/bin/sh\nprintf 'image selected\\n'\n");
  const candidateBytes = Buffer.from("#!/bin/sh\nprintf 'Candidate selected\\n'\n");
  await writeFile(imageTool, imageBytes, { mode: 0o500 });
  await writeFile(shadow, candidateBytes, { mode: 0o500 });
  for (const [relativeTo, bytes, expectedPath, expectedOutput] of [
    ["execution-image", imageBytes, imageTool, "image selected\n"],
    ["candidate", candidateBytes, shadow, "Candidate selected\n"],
  ] as const) {
    const command = await resolveFoundationCheckExecutableV1({
      subjectRoot,
      binding: { executable: { relativeTo, path: imagePath }, implementationDigest: sha256Bytes(bytes) },
    });
    assert.equal(command, expectedPath);
    assert.equal(execFileSync(command, [], { cwd: subjectRoot, encoding: "utf8" }), expectedOutput);
  }
});

test("Check executable selection refuses aliases, invalid files, and changed identities before dispatch", async (t) => {
  const owner = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-check-executable-refusal-")));
  t.after(async () => rm(owner, { recursive: true, force: true }));
  const subjectRoot = join(owner, "candidate");
  const toolsRoot = join(subjectRoot, "tools");
  await mkdir(toolsRoot, { recursive: true });
  const bytes = Buffer.from("#!/bin/sh\nexit 0\n");
  await writeFile(join(toolsRoot, "check"), bytes, { mode: 0o500 });
  await writeFile(join(toolsRoot, "non-executable"), bytes, { mode: 0o400 });
  await symlink("check", join(toolsRoot, "alias"));
  await symlink("tools", join(subjectRoot, "tool-alias"));
  const digest = sha256Bytes(bytes);
  const mutations = [
    { name: "absolute path", path: "/tools/check", digest, error: /normalized relative path/u },
    { name: "traversal", path: "../tools/check", digest, error: /normalized relative path/u },
    { name: "leaf alias", path: "tools/alias", digest, error: /canonical regular executable/u },
    { name: "parent alias", path: "tool-alias/check", digest, error: /canonical regular executable/u },
    { name: "directory", path: "tools", digest, error: /canonical regular executable/u },
    { name: "non-executable", path: "tools/non-executable", digest, error: /canonical regular executable/u },
    { name: "missing", path: "tools/missing", digest, error: /unavailable or not executable/u },
    { name: "wrong digest", path: "tools/check", digest: sha256Bytes("other bytes"), error: /differs from its implementation digest/u },
  ];
  for (const mutation of mutations) {
    await t.test(mutation.name, async () => {
      await assert.rejects(resolveFoundationCheckExecutableV1({
        subjectRoot,
        binding: {
          executable: { relativeTo: "candidate", path: mutation.path },
          implementationDigest: mutation.digest,
        },
      }), mutation.error);
    });
  }
  await assert.rejects(resolveFoundationCheckExecutableV1({
    subjectRoot,
    binding: { executable: { relativeTo: "host", path: "tools/check" }, implementationDigest: digest },
  }), /unsupported base/u);
  await chmod(join(toolsRoot, "check"), 0o700);
  await writeFile(join(toolsRoot, "check"), "#!/bin/sh\nexit 1\n");
  await assert.rejects(resolveFoundationCheckExecutableV1({
    subjectRoot,
    binding: { executable: { relativeTo: "candidate", path: "tools/check" }, implementationDigest: digest },
  }), /differs from its implementation digest/u);
});

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

test("runner accepts only a complete optional reconnaissance Candidate triple and preserves read-only authority", () => {
  const kinds = ["candidate-revision", "candidate-revision-carrier-manifest", "delivery-git-context"];
  const subjects = kinds.map((kind) => ({ kind, id: kind, revision: 1, digest: sha256Bytes(kind) }));
  for (const role of ["reconnaissance", "builder", "reviewer"]) {
    for (let mask = 0; mask < 8; mask += 1) {
      const selected = subjects.filter((_, index) => (mask & (1 << index)) !== 0);
      if (mask === 7 || role === "reconnaissance" && mask === 0) {
        assert.equal(foundationAgentCandidateInputPresentV1({ role, subjects: selected }), mask === 7);
      } else {
        assert.throws(() => foundationAgentCandidateInputPresentV1({ role, subjects: selected }), /complete exact Candidate/);
      }
    }
    for (const duplicate of subjects) {
      assert.throws(() => foundationAgentCandidateInputPresentV1({ role, subjects: [...subjects, duplicate] }), /complete exact Candidate/);
    }
  }
  const permission = foundationAgentPermissionOverridesV1({
    transportInputRoot: "/transport", providerInputRoot: "/provider", workingRoot: "/work",
    candidateRoot: "/work/candidate", candidateWritable: false, semanticRoot: "/output/semantic",
  });
  const filesystem = permission.find((value) => value.startsWith("permissions.lifecycle.filesystem="))!;
  assert(filesystem.includes('"/work/candidate"="read"'));
  assert(filesystem.includes('"/output/semantic"="write"'));
  assert(filesystem.includes('"/opt/lifecycle-runtime"="read"'), "The supported draft executable must load its exact immutable package and dependencies");
  assert(filesystem.includes('"/tmp/lifecycle-provider-state"="deny"'));
  assert(!filesystem.includes('"/opt"="read"'));
  assert(!filesystem.includes('"/opt/lifecycle-runtime"="write"'));
  assert(!filesystem.includes('"/work/candidate"="write"'));
  const specification = agentSpecification().specification;
  assert.equal(specification.capabilities.candidateWrites, false);
  assert.equal(specification.outputContract.declaredOutputRoots.some(({ purpose }) => purpose === "candidate-output"), false);
});

test("Agent permission profiles cover private descendants without nested sandbox masks", () => {
  const privateRoot = "/tmp/lifecycle-provider-state";
  const privateDescendants = [
    privateRoot, `${privateRoot}/home`, `${privateRoot}/home/auth.json`,
    `${privateRoot}/home/sessions/retained.json`, `${privateRoot}/other-private-state`,
  ];
  const assertPrivateMask = (filesystem: ReadonlyMap<string, string>): void => {
    assert.equal(filesystem.get(privateRoot), "deny", "The complete provider-state root remains denied");
    for (const path of privateDescendants) {
      const covering = [...filesystem].filter(([root]) => path === root || path.startsWith(`${root}/`));
      assert.deepEqual(covering, [[privateRoot, "deny"]], `${path} has one denied ancestor and no override`);
    }
    for (const [root, access] of filesystem) {
      if (access !== "deny") continue;
      assert.equal([...filesystem.keys()].some((path) => path.startsWith(`${root}/`)), false,
        `A nested mask cannot be mounted beneath denied ${root}`);
    }
  };
  for (const candidate of [
    { candidateRoot: null, candidateWritable: false },
    { candidateRoot: "/tmp/work/candidate", candidateWritable: false },
    { candidateRoot: "/tmp/work/candidate", candidateWritable: true },
  ]) {
    const permission = foundationAgentPermissionOverridesV1({
      transportInputRoot: "/lifecycle/input", providerInputRoot: "/tmp/lifecycle-provider-input",
      workingRoot: "/tmp/work", semanticRoot: "/lifecycle/output/agent-work-product", ...candidate,
    });
    const selected = permission.find((value) => value.startsWith("permissions.lifecycle.filesystem="));
    assert(selected !== undefined);
    const filesystem = new Map([...selected.matchAll(/"([^"]+)"="(read|write|deny)"/gu)]
      .map((match) => [match[1]!, match[2]!]));
    assertPrivateMask(filesystem);
    const nested = new Map(filesystem).set(`${privateRoot}/home`, "deny");
    assert.throws(() => assertPrivateMask(nested), /one denied ancestor and no override/);
    const absent = new Map(filesystem);
    absent.delete(privateRoot);
    assert.throws(() => assertPrivateMask(absent), /complete provider-state root remains denied/);
  }
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
      join(destination, "semantic-basis.json"),
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
    Object.freeze({ path: "semantic-basis.json", purpose: "operation-input", bytes: Buffer.from('{"fixture":"exact basis bytes"}\n') }),
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
      mediaType: value.path === "semantic-basis.json" ? "application/json" : "text/markdown; charset=utf-8",
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
  assert.deepEqual((await readdir(destination)).sort(), ["role-brief.md", "semantic-basis.json", "sources"]);
  assert.equal(await readFile(join(destination, "semantic-basis.json"), "utf8"), '{"fixture":"exact basis bytes"}\n');
  assert.equal((await lstat(join(destination, "semantic-basis.json"))).mode & 0o333, 0);
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
  const basis = Buffer.from("{}\n");
  await writeFile(join(transport, "role-brief.md"), role);
  await writeFile(join(transport, "semantic-basis.json"), basis);
  await writeFile(join(transport, "sources", "source.md"), source);
  await chmod(join(transport, "sources", "source.md"), 0o500);
  const entries = [
    {
      path: "semantic-basis.json", purpose: "operation-input", mediaType: "application/json",
      modeClass: "regular", byteLength: basis.byteLength, digest: sha256Bytes(basis),
    },
    {
      path: "role-brief.md",
      purpose: "role-brief",
      mediaType: "text/markdown; charset=utf-8",
      modeClass: "regular",
      byteLength: role.byteLength,
      digest: sha256Bytes(role),
    },
    {
      path: "sources/source.md",
      purpose: "projection",
      mediaType: "text/markdown; charset=utf-8",
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
  for (const variation of ["missing", "oversized", "substituted"] as const) {
    const changed = variation === "missing" ? entries.filter(({ path }) => path !== "semantic-basis.json")
      : entries.map((entry) => entry.path !== "semantic-basis.json" ? entry
        : variation === "oversized" ? { ...entry, byteLength: FOUNDATION_AGENT_WORK_PRODUCT_VALIDATION_BASIS_MAXIMUM_BYTES + 1 }
        : { ...entry, digest: sha256Bytes("another basis") });
    await assert.rejects(materializeFoundationAgentProviderVisibleInputV1({
      transportInputRoot: transport, inputSet: { entries: changed }, destinationRoot: join(owner, `basis-${variation}`),
    }), variation === "missing" ? /exact provider-visible Role Brief and semantic basis/u
      : variation === "oversized" ? /invalid provider-visible entry/u : /changed while it was materialized/u);
  }
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


test("private provider auth crosses staging into durable state and preserves provider refresh for retirement", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "lifecycle-provider-state-"));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  const staging = join(directory, "staging-auth.json");
  const stateRoot = join(directory, "provider-state");
  const original = Buffer.from('{"tokens":{"refresh_token":"original-fixture-refresh"}}');
  const updated = Buffer.from('{"tokens":{"refresh_token":"updated-fixture-refresh"}}');
  await mkdir(stateRoot, { mode: 0o700 });
  assert.equal(await readFoundationAgentProviderCredentialV1(stateRoot), null);
  await writeFile(staging, original, { mode: 0o600 });
  const originalFile = await lstat(staging);
  await activateFoundationAgentProviderHomeV1({ source: staging, stateRoot });
  await assert.rejects(lstat(staging), { code: "ENOENT" });
  const retained = await lstat(join(stateRoot, "home/auth.json"));
  assert.equal(retained.mode & 0o777, 0o600);
  assert.notEqual(retained.ino, originalFile.ino, "Activation copies into the volume instead of renaming across filesystems");
  assert.deepEqual(await readFoundationAgentProviderCredentialV1(stateRoot), Uint8Array.from(original));
  await writeFile(join(stateRoot, "home/auth.json"), updated, { mode: 0o600 });
  await writeFile(join(stateRoot, "home/unrelated-provider-state"), "not credential output");
  assert.deepEqual(await readFoundationAgentProviderCredentialV1(stateRoot), Uint8Array.from(updated));
  assert.deepEqual(await readFoundationAgentProviderCredentialV1(stateRoot), Uint8Array.from(updated), "Retirement reads leave retained provider bytes unchanged");
  await assert.rejects(activateFoundationAgentProviderHomeV1({ source: join(stateRoot, "home/auth.json"), stateRoot }), { code: "EEXIST" });
  assert.deepEqual(await readFoundationAgentProviderCredentialV1(stateRoot), Uint8Array.from(updated));
});

test("private credential retrieval distinguishes missing auth from unsafe or unavailable state", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "lifecycle-provider-state-refusal-"));
  t.after(async () => await rm(directory, { recursive: true, force: true }));
  for (const variation of ["missing", "short", "oversized", "public-mode", "symlink", "home-symlink", "hardlink", "root-mode"] as const) {
    const stateRoot = join(directory, variation);
    await mkdir(stateRoot, { mode: 0o700 });
    const home = join(stateRoot, "home");
    if (variation === "home-symlink") await symlink(directory, home);
    else await mkdir(home, { mode: 0o700 });
    const path = join(home, "auth.json");
    if (variation === "symlink") await symlink(join(directory, "absent"), path);
    else if (variation !== "missing" && variation !== "home-symlink") {
      await writeFile(path, Buffer.alloc(variation === "oversized" ? 4 * 1024 * 1024 + 1 : variation === "short" ? 1 : 2), { mode: variation === "public-mode" ? 0o644 : 0o600 });
    }
    if (variation === "hardlink") await link(path, join(directory, "second-auth-name"));
    if (variation === "root-mode") await chmod(stateRoot, 0o755);
    if (variation === "missing") assert.equal(await readFoundationAgentProviderCredentialV1(stateRoot), null);
    else await assert.rejects(readFoundationAgentProviderCredentialV1(stateRoot), /private|bounded/);
  }
  await assert.rejects(readFoundationAgentProviderCredentialV1(join(directory, "absent-volume")), { code: "ENOENT" });
});
