import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { FoundationCliReportedError, FoundationTuiTransportError, connectLifecycleExecutable, createLifecycleCliTransport, resolveLifecycleExecutablePath, sanitizedLifecycleDeliveryEnvironment, sanitizedLifecycleEnvironment, sanitizedLifecyclePrepareEnvironment } from "../src/adapters/cli/transport.js";
import { createFakeLifecycle, fakeLifecycleCommands, readFakeLifecycleEvents, waitForFakeLifecycleInvocations } from "./support/fake-lifecycle.js";
import { TEST_DELIVERY_ID, testGeneration } from "./support/protocol-v10.js";

async function root(context: TestContext): Promise<string> { const value = await mkdtemp(join(tmpdir(), "lifecycle-tui-transport-")); context.after(async () => await rm(value, { recursive: true, force: true })); return value; }

const EXECUTION_ENVIRONMENT = Object.freeze({
  LIFECYCLE_DOCKER_PATH: "/private/bin/docker",
  LIFECYCLE_DOCKER_HOST: "unix:///private/run/docker.sock",
  LIFECYCLE_DOCKER_CONFIG: "/private/docker-config",
  LIFECYCLE_EXECUTION_IMAGE_ID: "lifecycle-agent-cell",
  LIFECYCLE_EXECUTION_IMAGE_DIGEST: `sha256:${"a".repeat(64)}`,
  LIFECYCLE_EXECUTION_IMAGE_ARCHITECTURE: "arm64",
  LIFECYCLE_EXECUTION_RUNNER_CONTRACT_DIGEST: `sha256:${"b".repeat(64)}`,
  LIFECYCLE_EXECUTION_RUNNER_IMPLEMENTATION_DIGEST: `sha256:${"c".repeat(64)}`,
  LIFECYCLE_EXECUTION_TOOL_INVENTORY_DIGEST: `sha256:${"d".repeat(64)}`,
  LIFECYCLE_EXECUTION_CODEX_VERSION: "0.151.0",
  LIFECYCLE_EXECUTION_CODEX_EXECUTABLE_IDENTITY: `sha256:${"e".repeat(64)}`,
  LIFECYCLE_EXECUTION_AGENT_ADAPTER_IMPLEMENTATION_DIGEST: `sha256:${"f".repeat(64)}`,
});

const EMPTY_EXECUTION_OBSERVATION = Object.freeze({
  dockerPath: null,
  dockerHost: null,
  dockerConfig: null,
  imageId: null,
  imageDigest: null,
  imageArchitecture: null,
  runnerContractDigest: null,
  runnerImplementationDigest: null,
  toolInventoryDigest: null,
  codexVersion: null,
  codexExecutableIdentity: null,
  agentAdapterImplementationDigest: null,
});

const SELECTED_EXECUTION_OBSERVATION = Object.freeze({
  dockerPath: EXECUTION_ENVIRONMENT.LIFECYCLE_DOCKER_PATH,
  dockerHost: EXECUTION_ENVIRONMENT.LIFECYCLE_DOCKER_HOST,
  dockerConfig: EXECUTION_ENVIRONMENT.LIFECYCLE_DOCKER_CONFIG,
  imageId: EXECUTION_ENVIRONMENT.LIFECYCLE_EXECUTION_IMAGE_ID,
  imageDigest: EXECUTION_ENVIRONMENT.LIFECYCLE_EXECUTION_IMAGE_DIGEST,
  imageArchitecture: EXECUTION_ENVIRONMENT.LIFECYCLE_EXECUTION_IMAGE_ARCHITECTURE,
  runnerContractDigest: EXECUTION_ENVIRONMENT.LIFECYCLE_EXECUTION_RUNNER_CONTRACT_DIGEST,
  runnerImplementationDigest: EXECUTION_ENVIRONMENT.LIFECYCLE_EXECUTION_RUNNER_IMPLEMENTATION_DIGEST,
  toolInventoryDigest: EXECUTION_ENVIRONMENT.LIFECYCLE_EXECUTION_TOOL_INVENTORY_DIGEST,
  codexVersion: EXECUTION_ENVIRONMENT.LIFECYCLE_EXECUTION_CODEX_VERSION,
  codexExecutableIdentity: EXECUTION_ENVIRONMENT.LIFECYCLE_EXECUTION_CODEX_EXECUTABLE_IDENTITY,
  agentAdapterImplementationDigest:
    EXECUTION_ENVIRONMENT.LIFECYCLE_EXECUTION_AGENT_ADAPTER_IMPLEMENTATION_DIGEST,
});

function expectedObservedEnvironment(input: Readonly<{
  machineHome?: string | null;
  model?: string | null;
  reasoning?: string | null;
  execution?: typeof SELECTED_EXECUTION_OBSERVATION;
}> = {}) {
  return {
    machineHome: input.machineHome ?? null,
    codexPath: null,
    model: input.model ?? null,
    reasoning: input.reasoning ?? null,
    execution: input.execution ?? EMPTY_EXECUTION_OBSERVATION,
    authoritySecret: null,
    arbitraryLifecycle: null,
    nodeOptions: null,
  };
}

test("validation, Delivery reads, and prepare receive only their exact installed configuration", () => {
  const source = {
    PATH: "/bin",
    HOME: "/safe",
    NODE_OPTIONS: "--import=x",
    LIFECYCLE_MACHINE_HOME: "/private/machine",
    LIFECYCLE_CODEX_PATH: "/private/bin/codex",
    LIFECYCLE_FOUNDATION_PROVIDER_MODEL: "gpt-5.6-sol",
    LIFECYCLE_FOUNDATION_PROVIDER_REASONING: "high",
    ...EXECUTION_ENVIRONMENT,
    LIFECYCLE_AUTHORITY_SECRET: "secret",
    LIFECYCLE_ARBITRARY_INJECTION: "must-not-pass",
    LIFECYCLE_FOUNDATION_PROVIDER_HOME: "/retired/provider",
  };
  assert.deepEqual(sanitizedLifecycleEnvironment(source), { PATH: "/bin", HOME: "/safe" });
  assert.deepEqual(sanitizedLifecycleDeliveryEnvironment(source), {
    PATH: "/bin",
    HOME: "/safe",
    LIFECYCLE_MACHINE_HOME: "/private/machine",
  });
  assert.deepEqual(sanitizedLifecyclePrepareEnvironment(source), {
    PATH: "/bin",
    HOME: "/safe",
    LIFECYCLE_MACHINE_HOME: "/private/machine",
    LIFECYCLE_FOUNDATION_PROVIDER_MODEL: "gpt-5.6-sol",
    LIFECYCLE_FOUNDATION_PROVIDER_REASONING: "high",
    ...EXECUTION_ENVIRONMENT,
  });
  assert.equal(
    sanitizedLifecyclePrepareEnvironment(source).LIFECYCLE_CODEX_PATH,
    undefined,
  );
  assert.equal(
    sanitizedLifecyclePrepareEnvironment({ ...source, LIFECYCLE_DOCKER_HOST: "tcp://remote.invalid" }).LIFECYCLE_DOCKER_HOST,
    undefined,
  );
  assert.equal(
    sanitizedLifecyclePrepareEnvironment({ ...source, LIFECYCLE_EXECUTION_IMAGE_DIGEST: "latest" }).LIFECYCLE_EXECUTION_IMAGE_DIGEST,
    undefined,
  );
  assert.equal(
    sanitizedLifecycleDeliveryEnvironment({ ...source, LIFECYCLE_MACHINE_HOME: "relative/machine" }).LIFECYCLE_MACHINE_HOME,
    undefined,
  );
});

test("transport uses operation-scoped installed configuration and ephemeral Delivery inputs", async (context) => {
  const directory = await root(context); const fake = await createFakeLifecycle(directory);
  const installed = {
    LIFECYCLE_MACHINE_HOME: "/private/machine",
    LIFECYCLE_CODEX_PATH: "/private/bin/codex",
    LIFECYCLE_FOUNDATION_PROVIDER_MODEL: "gpt-5.6-sol",
    LIFECYCLE_FOUNDATION_PROVIDER_REASONING: "high",
    ...EXECUTION_ENVIRONMENT,
    LIFECYCLE_AUTHORITY_SECRET: "secret",
    LIFECYCLE_ARBITRARY_INJECTION: "must-not-pass",
    NODE_OPTIONS: "--import=x",
  };
  const transport = await createLifecycleCliTransport({ executable: fake.executable, environment: installed }); const target = join(directory, "target"); await mkdir(target);
  const validation = await transport.validate(target);
  const status = await transport.status(target, TEST_DELIVERY_ID);
  const emptyView = await transport.inspectAttemptView(target, TEST_DELIVERY_ID);
  const prepared = await transport.prepare(target, "# Complete fresh brief");
  const exactView = await transport.inspectAttemptView(target, TEST_DELIVERY_ID);
  assert.equal(validation.operation, "repository.validate");
  assert.equal(status.observation.delivery?.processId, TEST_DELIVERY_ID);
  assert.equal(prepared.deliveryId, TEST_DELIVERY_ID);
  assert.equal(emptyView.value !== null && "kind" in emptyView.value && emptyView.value.kind === "attempt-view" ? emptyView.value.view : "invalid", null);
  assert.equal(
    exactView.value !== null && "kind" in exactView.value && exactView.value.kind === "attempt-view"
      ? exactView.value.view?.agentSemantics.summary?.text
      : null,
    "The target is understood and one bounded implementation route is ready for admission.",
  );
  const events = await readFakeLifecycleEvents(fake);
  const invocation = (command: string) => events.find((event) => event.kind === "invoke" && event.command === command);
  const versionEvent = invocation("version");
  assert.ok(versionEvent?.kind === "invoke");
  assert.deepEqual(versionEvent.environment, expectedObservedEnvironment());
  const validationEvent = invocation("validate");
  assert.ok(validationEvent?.kind === "invoke");
  assert.deepEqual(validationEvent.environment, expectedObservedEnvironment());
  const statusEvent = events.find((event) => event.kind === "invoke" && event.command === "status");
  assert.deepEqual(statusEvent?.kind === "invoke" ? statusEvent.args : [], ["status", target, TEST_DELIVERY_ID, "--format", "json"]);
  assert.deepEqual(
    statusEvent?.kind === "invoke" ? statusEvent.environment : null,
    expectedObservedEnvironment({ machineHome: "/private/machine" }),
  );
  const inspections = events.filter((event) => event.kind === "invoke" && event.command === "inspect");
  assert.equal(inspections.length, 2);
  for (const inspection of inspections) {
    if (inspection.kind !== "invoke") continue;
    assert.deepEqual(inspection.args.slice(0, 3), ["inspect", target, TEST_DELIVERY_ID]);
    const input = inspection.args.indexOf("--input");
    assert.ok(input > 1);
    assert.deepEqual(inspection.args.slice(-2), ["--format", "json"]);
    await assert.rejects(access(inspection.args[input + 1]!), { code: "ENOENT" });
    assert.deepEqual(
      inspection.environment,
      expectedObservedEnvironment({ machineHome: "/private/machine" }),
    );
  }
  const prepare = events.find((event) => event.kind === "invoke" && event.command === "prepare");
  assert.ok(prepare?.kind === "invoke"); const input = prepare.args.indexOf("--input"); assert.ok(input > 1); await assert.rejects(access(prepare.args[input + 1]!), { code: "ENOENT" });
  assert.deepEqual(prepare.environment, expectedObservedEnvironment({
    machineHome: "/private/machine",
    model: "gpt-5.6-sol",
    reasoning: "high",
    execution: SELECTED_EXECUTION_OBSERVATION,
  }));
  assert.deepEqual(fakeLifecycleCommands(events), ["version", "validate", "status", "inspect", "prepare", "inspect"]);
  assert.equal(transport.executable.version.provider.defaultDescriptorId, "codex-exec-standard-v6");
});

test("Delivery reads reject a malformed Delivery identity before invocation", async (context) => {
  const directory = await root(context); const fake = await createFakeLifecycle(directory); const transport = await createLifecycleCliTransport({ executable: fake.executable });
  await assert.rejects(transport.status(join(directory, "target"), "bad id"), /exact v10 Delivery identity/u);
});

test("read-model routes receive only the installed coordinates their runtime projection requires", async (context) => {
  const directory = await root(context);
  const fake = await createFakeLifecycle(directory);
  const target = join(directory, "target");
  await mkdir(target);
  const transport = await createLifecycleCliTransport({
    executable: fake.executable,
    environment: {
      LIFECYCLE_MACHINE_HOME: "/private/machine",
      LIFECYCLE_CODEX_PATH: "/private/bin/codex",
      LIFECYCLE_FOUNDATION_PROVIDER_MODEL: "gpt-5.6-sol",
      LIFECYCLE_FOUNDATION_PROVIDER_REASONING: "high",
      ...EXECUTION_ENVIRONMENT,
      LIFECYCLE_AUTHORITY_SECRET: "never-pass",
    },
  });
  const inbox = await transport.inbox(target);
  await transport.inspectDeliveryView(target, TEST_DELIVERY_ID);
  await transport.inspectControl(target, TEST_DELIVERY_ID, { kind: "families" });
  const generation = inbox.value !== null && "kind" in inbox.value && inbox.value.kind === "inbox"
    ? inbox.value.view.generation
    : null;
  assert.notEqual(generation, null);
  await transport.watch(target, {
    scope: "inbox",
    deliveryId: null,
    afterGeneration: generation,
    timeoutMs: 1,
  });
  await transport.watch(target, {
    scope: "delivery",
    deliveryId: TEST_DELIVERY_ID,
    afterGeneration: generation,
    timeoutMs: 1,
  });

  const events = (await readFakeLifecycleEvents(fake)).filter((event) => event.kind === "invoke");
  const commands = events.map(({ command }) => command);
  assert.deepEqual(commands, ["version", "inbox", "inspect", "inspect", "watch", "watch"]);
  const expectedCustody = expectedObservedEnvironment({ machineHome: "/private/machine" });
  const expectedReadModel = expectedObservedEnvironment({
    machineHome: "/private/machine",
    model: "gpt-5.6-sol",
    reasoning: "high",
    execution: SELECTED_EXECUTION_OBSERVATION,
  });
  assert.deepEqual(events[1]?.environment, expectedCustody, "Inbox aggregate is custody-only");
  assert.deepEqual(events[2]?.environment, expectedReadModel, "Delivery view resolves exact installed Investment");
  assert.deepEqual(events[3]?.environment, expectedCustody, "Control inspection is custody-only");
  assert.deepEqual(events[4]?.environment, expectedCustody, "Inbox watch is custody-only");
  assert.deepEqual(events[5]?.environment, expectedReadModel, "Delivery watch returns a complete Investment-bearing view");
  for (const event of events.slice(1)) {
    assert.equal(event.environment.authoritySecret, null);
  }
});

test("Control, diff, and Next Pass calls use only canonical CLI argv and ephemeral inputs", async (context) => {
  const directory = await root(context);
  const fake = await createFakeLifecycle(directory);
  const target = join(directory, "target");
  await mkdir(target);
  const transport = await createLifecycleCliTransport({
    executable: fake.executable,
    environment: {
      LIFECYCLE_MACHINE_HOME: "/private/machine",
      LIFECYCLE_CODEX_PATH: "/private/bin/codex",
      LIFECYCLE_FOUNDATION_PROVIDER_MODEL: "gpt-5.6-sol",
      LIFECYCLE_FOUNDATION_PROVIDER_REASONING: "high",
      ...EXECUTION_ENVIRONMENT,
      LIFECYCLE_AUTHORITY_SECRET: "never-pass",
    },
  });
  const generation = testGeneration().digest;
  const family = await transport.inspectControl(target, TEST_DELIVERY_ID, {
    kind: "family",
    recordKind: "work-boundary",
    afterRecordId: null,
    limit: 200,
  });
  const revisions = await transport.inspectControl(target, TEST_DELIVERY_ID, {
    kind: "revisions",
    recordId: "boundary-proposed-v10",
    afterRevision: 0,
    limit: 200,
  });
  const diff = await transport.diff(target, TEST_DELIVERY_ID, { subject: "candidate", maximumBytes: 262_144 });
  const pass = await transport.executeNextPass(
    target,
    TEST_DELIVERY_ID,
    "delivery.continue",
    "Continue this exact bounded implementation.",
    generation,
  );
  assert.equal(family.value !== null && "kind" in family.value ? family.value.kind : null, "family");
  assert.equal(revisions.value !== null && "kind" in revisions.value ? revisions.value.kind : null, "revisions");
  assert.equal(diff.value !== null && "kind" in diff.value ? diff.value.kind : null, "diff");
  assert.equal(pass.operation, "delivery.continue");

  const events = (await readFakeLifecycleEvents(fake)).filter((event) => event.kind === "invoke");
  assert.deepEqual(events.map(({ command }) => command), ["version", "inspect", "inspect", "diff", "continue"]);
  for (const event of events.slice(1, 4)) {
    const inputIndex = event.args.indexOf("--input");
    assert.ok(inputIndex > 1);
    await assert.rejects(access(event.args[inputIndex + 1]!), { code: "ENOENT" });
    assert.equal(event.environment.codexPath, null);
    assert.equal(event.environment.authoritySecret, null);
  }
  const mutation = events.at(-1)!;
  const inputIndex = mutation.args.indexOf("--input");
  assert.deepEqual(mutation.args.slice(0, 3), ["continue", target, TEST_DELIVERY_ID]);
  assert.deepEqual(mutation.args.slice(inputIndex + 2), ["--expected-generation", generation, "--format", "json"]);
  await assert.rejects(access(mutation.args[inputIndex + 1]!), { code: "ENOENT" });
  assert.deepEqual(mutation.environment, expectedObservedEnvironment({
    machineHome: "/private/machine",
    model: "gpt-5.6-sol",
    reasoning: "high",
    execution: SELECTED_EXECUTION_OBSERVATION,
  }));
});

test("typed refusals, reported read effects, and cancellation remain distinct", async (context) => {
  const directory = await root(context); const fake = await createFakeLifecycle(directory); const transport = await createLifecycleCliTransport({ executable: fake.executable });
  await assert.rejects(transport.status(join(directory, "typed-refusal"), TEST_DELIVERY_ID), (error: unknown) =>
    error instanceof FoundationCliReportedError &&
    error.failure.code === "lifecycle.test.follow-up" &&
    error.failure.diagnostics?.[0]?.code === "fake-diagnostic");
  await assert.rejects(transport.status(join(directory, "setup-repository-effect"), TEST_DELIVERY_ID), (error: unknown) => error instanceof FoundationTuiTransportError && error.code === "tui.cli.read-effect");
  const controller = new AbortController(); const pending = transport.status(join(directory, "slow"), TEST_DELIVERY_ID, { signal: controller.signal, timeoutMs: 30_000 }); await waitForFakeLifecycleInvocations(fake, 4); controller.abort();
  await assert.rejects(pending, (error: unknown) => error instanceof FoundationTuiTransportError && error.code === "tui.cli.cancelled");
});

test("locator pins only the exact lifecycle executable and version deadline", async (context) => {
  const directory = await root(context); const fake = await createFakeLifecycle(directory); const bin = join(directory, "bin"); await mkdir(bin); await symlink(fake.executable, join(bin, "lifecycle"));
  assert.equal(await resolveLifecycleExecutablePath("lifecycle", { PATH: bin }), join(bin, "lifecycle"));
  await assert.rejects(resolveLifecycleExecutablePath("other", { PATH: bin }), /exactly lifecycle/u);
  await writeFile(fake.versionDelayPath, "slow\n");
  await assert.rejects(connectLifecycleExecutable(fake.executable, { timeoutMs: 50 }), (error: unknown) => error instanceof FoundationTuiTransportError && error.code === "tui.cli.timeout");
});
