import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  compileProviderInputV4,
} from "../../src/foundation/attempt/provider-input-v4.js";
import {
  operateFoundationAgentCellV1,
  type FoundationAgentCellInstalledInputsV1,
} from "../../src/foundation/attempt/execution-cell-v1.js";
import {
  retainExecutionReceipt,
} from "../../src/foundation/control/execution-receipt.js";
import {
  openControlRecordStore,
  type ControlRecordStore,
} from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlJsonObject,
} from "../../src/foundation/control/types.js";
import type {
  FoundationExecutionBackend,
  FoundationExecutionHandle,
  FoundationRetrievedExecutionOutputV1,
} from "../../src/foundation/execution/backend.js";
import type {
  FoundationExecutionOutputManifestEntryV1,
  FoundationExecutionSpecificationV1,
} from "../../src/foundation/execution/contracts.js";
import {
  createFoundationExecutionOutputStoreV1,
} from "../../src/foundation/execution/output-store-v1.js";
import {
  openFoundationExecutionReclamationLedgerV1,
} from "../../src/foundation/execution/reclamation-ledger-v1.js";
import type {
  FoundationCompiledInstalledAgentCellInputsV1,
  FoundationOpenedInstalledAgentRuntimeV1,
} from "../../src/foundation/execution/installed-agent-runtime-v1.js";
import {
  FoundationAgentCellInputTransportRegistryV1,
} from "../../src/foundation/execution/installed-agent-runtime-v1.js";
import {
  inspectFoundationAgentActivityV7,
  operateFoundationAgentActivityV7,
  recoverFoundationAgentActivityV7,
  type FoundationAgentOperationV7Options,
  type FoundationPreparationAgentOperationV7Input,
} from "../../src/foundation/process/agent-operation-v7.js";
import {
  defaultCapabilityProfiles,
  FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR,
} from "../../src/foundation/repository/contract.js";
import {
  FOUNDATION_GENERATED_PUBLICATION_DIGEST,
  FOUNDATION_GENERATED_SPECIFICATION_REVISION,
} from "../../src/foundation/validation/generated-schemas.js";
import {
  canonicalJsonLine,
  digestCanonical,
  selfDigest,
  sha256Bytes,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";
import {
  FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1,
} from "../../src/util/agent-execution-cell-operation-v1.js";
import {
  foundationAttemptProjectionFixture,
  type FoundationAttemptProjectionOrientationSubject,
} from "../helpers/foundation-attempt-projection-fixture.js";
import {
  executionContractFixture,
} from "../support/execution-contract-fixture.js";
import {
  InMemoryExecutionBackendEngine,
} from "../support/in-memory-execution-backend.js";

const RUNTIME = "foundation-runtime";
const TARGET = "agent-operation-v7-target";
const DELIVERY = "agent-operation-v7-delivery";

function digest(label: string): Sha256 {
  return sha256Bytes(`foundation-agent-operation-v7:${label}`);
}

function object(value: unknown, label: string): ControlJsonObject {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), label);
  return value as ControlJsonObject;
}

function rootTokenSetDigest(): Sha256 {
  return digestCanonical(Object.freeze({
    schema: "lifecycle.agent-root-token-set.v3",
    tokens: Object.freeze(["input-bundle", "semantic-workspace"]),
  }));
}

function clock(start = "2026-09-01T00:00:01.000Z"): () => string {
  let value = Date.parse(start);
  return () => new Date(value += 1).toISOString();
}

function orientationSubject(): FoundationAttemptProjectionOrientationSubject {
  const objective = "Reconnoiter the fresh target and propose one exact Work Boundary.";
  const value = Object.freeze({
    kind: "orientation" as const,
    objective,
    objectiveDigest: sha256Bytes(Buffer.from(objective, "utf8")),
    atlasStateDigest: digest("preparation-atlas"),
    knowledgeObservationDigest: digest("preparation-knowledge-observation"),
    knowledgeSetDigest: null,
  });
  return Object.freeze({ ...value, digest: selfDigest(value) });
}

async function freshStore(root: string): Promise<ControlRecordStore> {
  const store = await openControlRecordStore({
    root,
    create: true,
    identity: Object.freeze({
      schema: CONTROL_RECORD_STORE_SCHEMA,
      storeId: "store-agent-operation-v7",
      targetId: TARGET,
      processKind: "delivery" as const,
      processId: DELIVERY,
      createdAt: "2026-09-01T00:00:00.000Z",
    }),
  });
  store.append({ event: Object.freeze({
    eventId: "event-delivery-created-agent-operation-v7",
    eventKind: "delivery-created",
    occurredAt: "2026-09-01T00:00:00.000Z",
    actor: Object.freeze({ kind: "runtime" as const, id: RUNTIME }),
    payload: Object.freeze({}),
  }) });
  return store;
}

function providerTerminalBytes(input: Readonly<{
  specification: FoundationExecutionSpecificationV1;
  executableIdentity: Sha256;
  runnerImplementationDigest: Sha256;
}>): Uint8Array {
  if (input.specification.owner.kind !== "agent-attempt" ||
      input.specification.operation.kind !== "agent-attempt") {
    throw new TypeError("Agent operation test received another Execution Specification owner");
  }
  const subject = Object.freeze({
    schema: "lifecycle.agent-execution-cell-provider-terminal-observation.private.v1" as const,
    attemptDigest: input.specification.owner.attempt.digest,
    specificationDigest: input.specification.digest,
    providerDescriptorDigest: input.specification.operation.providerDescriptorDigest,
    adapterImplementationDigest: input.specification.operation.adapterImplementationDigest,
    imageDigest: input.specification.image.imageDigest,
    runnerContractDigest: input.specification.runner.contractDigest,
    runnerImplementationDigest: input.runnerImplementationDigest,
    preparedAt: "2026-09-01T00:00:00.010Z",
    startedAt: "2026-09-01T00:00:00.020Z",
    finishedAt: "2026-09-01T00:00:00.030Z",
    executableIdentity: input.executableIdentity,
    outcome: "natural-return" as const,
    stage: "evaluated" as const,
    productiveStarted: true,
    firstTrigger: "natural-return" as const,
    exitCode: 0,
    signal: null,
    sessionId: "agent-operation-v7-session",
  });
  return Uint8Array.from(Buffer.from(
    canonicalJsonLine({ ...subject, digest: selfDigest(subject) }),
    "utf8",
  ));
}

function executionOutput(input: Readonly<{
  specification: FoundationExecutionSpecificationV1;
  executableIdentity: Sha256;
  runnerImplementationDigest: Sha256;
  invalidAuthoringCarrier?: boolean;
}>): FoundationRetrievedExecutionOutputV1 {
  const terminalBytes = providerTerminalBytes(input);
  const semanticBytes = Uint8Array.from(Buffer.from(
    "# Reconnaissance Work Product\n\n## Outcome\n\nObserved.\n",
    "utf8",
  ));
  const values = [
    Object.freeze({
      path: FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.providerTerminalObservationPath,
      purpose: "operational-artifact" as const,
      mediaType:
        FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.providerTerminalObservationMediaType,
      modeClass: "regular" as const,
      bytes: terminalBytes,
    }),
    ...(input.invalidAuthoringCarrier === true ? [Object.freeze({
      path: FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.semanticWorkspacePath,
      purpose: "agent-work-product" as const,
      mediaType: FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.semanticWorkspaceMediaType,
      modeClass: "regular" as const,
      bytes: semanticBytes,
    })] : []),
  ].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const entries: readonly FoundationExecutionOutputManifestEntryV1[] = Object.freeze(
    values.map((value) => Object.freeze({
      path: value.path,
      entryKind: "file" as const,
      purpose: value.purpose,
      mediaType: value.mediaType,
      modeClass: value.modeClass,
      byteLength: value.bytes.byteLength,
      digest: sha256Bytes(value.bytes),
    })),
  );
  const aggregateByteLength = entries.reduce((sum, entry) => sum + entry.byteLength, 0);
  const manifestSubject = Object.freeze({
    schema: "lifecycle.execution-output-manifest.v1" as const,
    specificationDigest: input.specification.digest,
    inputSetDigest: input.specification.inputSet.digest,
    imageDigest: input.specification.image.imageDigest,
    outputContractDigest: input.specification.outputContract.digest,
    runnerDigest: input.specification.runner.contractDigest,
    completedAt: "2026-09-01T00:00:00.100Z",
    entries,
    entryCount: entries.length,
    aggregateByteLength,
    entryInventoryDigest: digestCanonical(entries),
  });
  return Object.freeze({
    manifest: Object.freeze({ ...manifestSubject, digest: selfDigest(manifestSubject) }),
    carrierByteLength: aggregateByteLength,
    async *entries() {
      for (let index = 0; index < entries.length; index += 1) {
        const descriptor = entries[index]!;
        const bytes = values[index]!.bytes;
        yield Object.freeze({
          path: descriptor.path,
          byteLength: descriptor.byteLength,
          digest: descriptor.digest,
          async *read() {
            yield Uint8Array.from(bytes);
          },
        });
      }
    },
  });
}

function outputBackend(input: Readonly<{
  engine: InMemoryExecutionBackendEngine;
  installed: FoundationAgentCellInstalledInputsV1;
  onSpecification(specification: FoundationExecutionSpecificationV1): void;
  invalidAuthoringCarrier?: boolean;
  onDispatch?(): void;
}>): FoundationExecutionBackend {
  const delegate = input.engine.facade(input.installed.profile);
  let specification: FoundationExecutionSpecificationV1 | null = null;
  let supplied = false;
  return Object.freeze({
    profile: delegate.profile,
    async allocate(
      selected: FoundationExecutionSpecificationV1,
      allocationKey: Parameters<FoundationExecutionBackend["allocate"]>[1],
    ) {
      specification = selected;
      input.onSpecification(selected);
      return await delegate.allocate(selected, allocationKey);
    },
    async dispatch(handle: FoundationExecutionHandle) {
      input.onDispatch?.();
      if (!supplied) {
        assert(specification !== null);
        await input.engine.provideOutput(specification, executionOutput({
          specification,
          executableIdentity: input.installed.provider.installedIdentityDigest,
          runnerImplementationDigest: input.installed.image.runnerImplementationDigest,
          invalidAuthoringCarrier: input.invalidAuthoringCarrier,
        }));
        supplied = true;
      }
      return await delegate.dispatch(handle);
    },
    observe: delegate.observe.bind(delegate),
    cancel: delegate.cancel.bind(delegate),
    async retrieve(
      handle: Parameters<FoundationExecutionBackend["retrieve"]>[0],
      observation: Parameters<FoundationExecutionBackend["retrieve"]>[1],
    ) {
      const retrieved = await delegate.retrieve(handle, observation);
      if (input.invalidAuthoringCarrier !== true || retrieved.disposition !== "complete") {
        return retrieved;
      }
      const source = retrieved.output;
      return Object.freeze({
        ...retrieved,
        output: Object.freeze({
          manifest: source.manifest,
          carrierByteLength: source.carrierByteLength,
          async *entries() {
            for await (const reader of source.entries()) {
              if (reader.path !==
                  FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.semanticWorkspacePath) {
                yield reader;
                continue;
              }
              yield Object.freeze({
                path: reader.path,
                byteLength: reader.byteLength,
                digest: reader.digest,
                async *read() {
                  yield new Uint8Array();
                  yield* reader.read();
                },
              });
            }
          },
        }),
      });
    },
    createReclamationBinding: delegate.createReclamationBinding.bind(delegate),
    reclaim: delegate.reclaim.bind(delegate),
  });
}

type InstalledHarness = Readonly<{
  engine: InMemoryExecutionBackendEngine;
  options: FoundationAgentOperationV7Options;
  specificationDigest(): Sha256 | null;
  dispatchCount(): number;
  reclamationCount(): Promise<number>;
}>;

function installedHarness(input: Readonly<{
  machineHome: string;
  now: () => string;
  invalidAuthoringCarrier?: boolean;
}>): InstalledHarness {
  const contract = executionContractFixture("agent-operation-v7");
  const image = Object.freeze({
    ...contract.image,
    runnerContractDigest: digest("runner-contract"),
    runnerImplementationDigest: digest("runner-implementation"),
    toolInventoryDigest: digest("tool-inventory"),
  });
  const engine = new InMemoryExecutionBackendEngine("1".repeat(64));
  let selectedSpecification: Sha256 | null = null;
  let dispatches = 0;
  const options: FoundationAgentOperationV7Options = Object.freeze({
    now: input.now,
    compileInstalled(selected): FoundationCompiledInstalledAgentCellInputsV1 {
      assert.equal(
        selected.provider.descriptorDigest,
        FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR.digest,
      );
      const installed: FoundationAgentCellInstalledInputsV1 = Object.freeze({
        profile: contract.profile,
        image,
        provider: Object.freeze({ ...selected.provider }),
        adapterImplementationDigest: image.runnerImplementationDigest,
        environment: Object.freeze([]),
        capabilities: Object.freeze({
          temporaryWrites: true,
          subprocesses: "repository-toolchain" as const,
          externalEffects: false,
        }),
        networkPolicy: Object.freeze({
          agentProductNetwork: "none" as const,
          agentPolicyDigest: selected.executionPolicy.containmentPolicyDigest,
          providerControlPlane: "none" as const,
          providerPolicyDigest: null,
          separationRequired: true as const,
        }),
        credentialPolicy: Object.freeze({
          mode: "none" as const,
          bindings: Object.freeze([]),
          agentAccess: false,
          outputDisclosure: false,
        }),
      });
      return Object.freeze({
        installed,
        executionPolicy: Object.freeze({ ...selected.executionPolicy }),
        policyDigests: Object.freeze(Object.values(selected.executionPolicy)),
      });
    },
    async openInstalled(selected): Promise<FoundationOpenedInstalledAgentRuntimeV1> {
      const inputTransport = new FoundationAgentCellInputTransportRegistryV1();
      const ledger = await openFoundationExecutionReclamationLedgerV1({
        machineHome: input.machineHome,
        installationId: "installation-agent-operation-v7",
        create: true,
        clock: Object.freeze({ now: input.now }),
      });
      const backend = outputBackend({
        engine,
        installed: selected.installed,
        onSpecification(specification) { selectedSpecification = specification.digest; },
        invalidAuthoringCarrier: input.invalidAuthoringCarrier,
        onDispatch() { dispatches += 1; },
      });
      return Object.freeze({
        runtime: Object.freeze({
          machineHome: input.machineHome,
          backend,
          registerOperation(): void {},
          outputStore: createFoundationExecutionOutputStoreV1({
            machineHome: input.machineHome,
          }),
          reclamation: ledger,
          clock: Object.freeze({ now: input.now }),
          pollMilliseconds: 0,
        }),
        installed: selected.installed,
        inputTransport,
        registerInput(compiledInput): void {
          inputTransport.register(compiledInput.inputSet, compiledInput.resolver);
        },
        ledger,
        async reclaimNext(): Promise<boolean> { return false; },
        close(): void { ledger.close(); },
      });
    },
  });
  return Object.freeze({
    engine,
    options,
    specificationDigest: () => selectedSpecification,
    dispatchCount: () => dispatches,
    async reclamationCount(): Promise<number> {
      const ledger = await openFoundationExecutionReclamationLedgerV1({
        machineHome: input.machineHome,
        installationId: "installation-agent-operation-v7",
        clock: Object.freeze({ now: input.now }),
      });
      try {
        return ledger.list().length;
      } finally {
        ledger.close();
      }
    },
  });
}

async function fixture(
  t: TestContext,
  salt: string,
  options: Readonly<{ invalidAuthoringCarrier?: boolean }> = Object.freeze({}),
): Promise<Readonly<{
  store: ControlRecordStore;
  request: FoundationPreparationAgentOperationV7Input;
  harness: InstalledHarness;
}>> {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), `lifecycle-agent-op-${salt}-`)));
  const machineHome = join(workspace, "machine");
  const codexHome = join(machineHome, "codex-home");
  const targetRepository = join(workspace, "target");
  await mkdir(machineHome, { mode: 0o700 });
  await Promise.all([
    mkdir(codexHome, { mode: 0o700 }),
    mkdir(targetRepository, { mode: 0o700 }),
  ]);
  const store = await freshStore(join(machineHome, "store"));
  const capability = defaultCapabilityProfiles()["local-development-v1"]!;
  const projection = foundationAttemptProjectionFixture(orientationSubject(), {
    capability: Object.freeze({ profileId: capability.id, profileDigest: capability.digest }),
  });
  const roleSubject: ControlJsonObject = Object.freeze({
    schema: "lifecycle.preparation-role-subject.test.v1",
    objectiveDigest: digest("preparation-objective"),
    boundary: null,
    candidate: null,
    seal: null,
  });
  const founderSemanticMarkdown =
    "# Frame\n\nReconnoiter the fresh target and propose one coherent boundary.\n";
  const providerInput = compileProviderInputV4({
    projection,
    operation: "delivery.prepare",
    roleSubjectDigest: digestCanonical(roleSubject),
    rootTokenSetDigest: rootTokenSetDigest(),
    capability: Object.freeze({
      candidateWrites: false,
      temporaryWrites: capability.temporaryWrites,
      subprocesses: capability.subprocesses,
      network: "none" as const,
      credentials: "none" as const,
      externalEffects: Object.freeze([]),
    }),
    founderSemanticMarkdown,
  });
  const investmentValue = Object.freeze({
    id: "investment-agent-operation-v7",
    model: "gpt-5.6-sol",
    reasoning: "high",
    wallTimeMs: 30_000,
    limits: Object.freeze({
      tokens: null,
      events: 50,
      outputBytes: 64 * 1024,
      toolCalls: null,
      processes: 4,
      storageBytes: 1024 * 1024,
    }),
    rationale: "execution-cell-orchestration",
  });
  const selectedImage = executionContractFixture("agent-operation-v7").image;
  const now = clock();
  const request: FoundationPreparationAgentOperationV7Input = Object.freeze({
    store,
    configuration: Object.freeze({
      machineHome,
      installationId: `installation.lifecycle.${"1".repeat(64)}`,
      codexHome,
      model: "gpt-5.6-sol",
      reasoning: "high",
      specificationRevision: FOUNDATION_GENERATED_SPECIFICATION_REVISION,
      publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
      execution: Object.freeze({
        dockerExecutable: join(workspace, "docker"),
        dockerExecutableDigest: digest("docker-executable"),
        engineEndpoint: "unix:///private/test/docker.sock",
        dockerConfigDirectory: join(workspace, "docker-config"),
        image: Object.freeze({
          imageId: selectedImage.imageId,
          imageDigest: selectedImage.imageDigest,
          immutableReference: `${selectedImage.imageId}@${selectedImage.imageDigest}`,
          configurationDigest: digest("image-configuration"),
          platform: Object.freeze({ os: "linux" as const, architecture: "amd64" as const, variant: null }),
          nonRootUser: "65532:65532",
          runnerContractId: "lifecycle.execution-cell-runner.v1" as const,
          runnerContractDigest: digest("runner-contract"),
          runnerImplementationDigest: digest("runner-implementation"),
          toolInventoryDigest: digest("tool-inventory"),
          agentProvider: Object.freeze({
            codexVersion: "0.151.0",
            executableIdentity: digest("agent-executable"),
            adapterImplementationDigest: digest("runner-implementation"),
          }),
        }),
      }),
    }),
    activityId: `activity-prepare-${salt}`,
    operation: "delivery.prepare",
    runtimeId: RUNTIME,
    agentId: "agent-reconnaissance-test",
    opening: Object.freeze({
      semanticMarkdown: founderSemanticMarkdown,
      submittedAt: "2026-09-01T00:00:00.001Z",
      startedAt: "2026-09-01T00:00:00.002Z",
      attemptCreatedAt: "2026-09-01T00:00:00.003Z",
      founderId: "founder-test",
    }),
    boundary: null,
    candidate: null,
    seal: null,
    projection,
    providerInput,
    targetRepository,
    roleSubject,
    capabilityProfile: Object.freeze({ id: capability.id, digest: capability.digest }),
    investment: Object.freeze({ ...investmentValue, digest: digestCanonical(investmentValue) }),
    evidenceSetDigest: null,
    propositionSet: null,
    revalidateBeforeIntent: async () => undefined,
    finalizeRoleControl: async (context) => {
      assert.equal(context.operation, "delivery.prepare");
      assert.equal(context.workProduct, null);
      return Object.freeze({ outcome: "abandoned" as const });
    },
  });
  const harness = installedHarness({
    machineHome,
    now,
    invalidAuthoringCarrier: options.invalidAuthoringCarrier,
  });
  t.after(async () => {
    try { store.close(); } catch { /* already closed */ }
    await rm(workspace, { recursive: true, force: true });
  });
  return Object.freeze({ store, request, harness });
}

function activityEvents(store: ControlRecordStore, activityId: string) {
  return store.listEvents(0, 10_000).filter((event) => event.payload.activityId === activityId);
}

test("Agent orchestration runs one exact Attempt through a retired Execution Cell", async (t) => {
  const selected = await fixture(t, "success");
  const result = await operateFoundationAgentActivityV7(
    selected.request,
    selected.harness.options,
  );
  assert.equal(result.outcome, "abandoned");
  assert.equal(result.workProduct, null);
  const attempt = selected.store.getRevision(result.attempt.id, result.attempt.revision)!;
  const receipt = selected.store.getRevision(result.receipt.id, result.receipt.revision)!;
  const attemptProvider = object(attempt.payload.provider, "Attempt Provider binding");
  const attemptExecution = object(attempt.payload.execution, "Attempt Execution binding");
  const attemptInputSet = object(attemptExecution.inputSet, "Attempt Input Set binding");
  const attemptExecutionPolicy = object(
    attempt.payload.executionPolicy,
    "Attempt execution policy",
  );
  const receiptExecution = object(receipt.payload.execution, "Receipt Execution facts");
  const receiptContainment = object(receipt.payload.containment, "Receipt containment facts");
  const receiptRetirement = object(receipt.payload.retirement, "Receipt retirement facts");
  assert.equal(attempt.payload.schema, "lifecycle.agent-attempt-payload.v3");
  assert.equal(attemptProvider.adapter, "lifecycle.provider-adapter.v6");
  assert.equal(attemptProvider.executableIdentityClass,
    FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR.provider.executableIdentityClass);
  assert.equal(attemptInputSet.profileId, "lifecycle.execution-input-set.v1");
  assert.deepEqual(Object.keys(attemptExecutionPolicy).sort(), [
    "cancellationPolicyDigest",
    "containmentPolicyDigest",
    "parentLossPolicyDigest",
    "recoveryPolicyDigest",
    "retirementPolicyDigest",
  ]);
  assert.equal(receipt.payload.schema, "lifecycle.execution-receipt-payload.v3");
  assert.equal(receiptExecution.specificationDigest, selected.harness.specificationDigest());
  assert.equal(receiptContainment.classification, "contained");
  assert.equal(receiptRetirement.classification, "retired");
  const events = activityEvents(selected.store, selected.request.activityId);
  const attemptEvent = events.find(({ eventKind }) => eventKind === "agent-attempt-prepared")!;
  const intentEvent = events.find(({ eventKind }) => eventKind === "provider-effect-intended")!;
  assert.equal(intentEvent.sequence, attemptEvent.sequence + 1);
  assert.equal(intentEvent.payload.effectDigest, receiptExecution.specificationDigest);
  assert.equal(events.filter(({ eventKind }) => eventKind === "provider-effect-observed").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "execution-receipt-recorded").length, 1);
  assert.equal(selected.harness.engine.productiveStartCount(
    receiptExecution.specificationDigest as Sha256,
  ), 1);
  assert.equal(selected.store.getOperationSupport(selected.request.activityId), null);
});

test("Agent recovery observes the same dispatched Handle without redispatch", async (t) => {
  const selected = await fixture(t, "recovery");
  selected.harness.engine.armFault("dispatch-after-start-before-return");
  await assert.rejects(operateFoundationAgentActivityV7(
    selected.request,
    selected.harness.options,
  ));
  const interrupted = inspectFoundationAgentActivityV7(
    selected.store,
    selected.request.activityId,
    "delivery.prepare",
  );
  assert.equal(interrupted.stage, "effect-intended");
  assert.notEqual(interrupted.execution?.dispatchAuthorityConsumedAt, null);
  const recovered = await recoverFoundationAgentActivityV7(
    selected.request,
    selected.harness.options,
  );
  const receipt = selected.store.getRevision(recovered.receipt.id, recovered.receipt.revision)!;
  const specificationDigest = object(
    receipt.payload.execution,
    "Recovered Receipt Execution facts",
  ).specificationDigest as Sha256;
  assert.equal(selected.harness.engine.productiveStartCount(specificationDigest), 1);
  const events = activityEvents(selected.store, selected.request.activityId);
  assert.equal(events.filter(({ eventKind }) => eventKind === "agent-attempt-prepared").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "provider-effect-intended").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "execution-receipt-recorded").length, 1);
});

test("pre-intent refusal remains subjectless and allocates no productive execution", async (t) => {
  const selected = await fixture(t, "pre-intent-refusal");
  const request: FoundationPreparationAgentOperationV7Input = Object.freeze({
    ...selected.request,
    revalidateBeforeIntent: async () => {
      throw new Error("pre-intent-refused-by-test");
    },
  });
  await assert.rejects(
    operateFoundationAgentActivityV7(request, selected.harness.options),
    /pre-intent revalidation refusal/u,
  );
  const events = activityEvents(selected.store, request.activityId);
  const refusal = events.filter(({ eventKind }) => eventKind === "agent-pre-intent-refused");
  assert.equal(refusal.length, 1);
  assert.equal(refusal[0]!.subject, null);
  assert.equal(events.filter(({ eventKind }) => eventKind === "agent-attempt-prepared").length, 0);
  assert.equal(events.filter(({ eventKind }) => eventKind === "provider-effect-intended").length, 0);
  assert.equal(events.filter(({ eventKind }) => eventKind === "execution-receipt-recorded").length, 0);
  const specificationDigest = selected.harness.specificationDigest();
  assert.notEqual(specificationDigest, null);
  assert.equal(selected.harness.engine.productiveStartCount(specificationDigest!), 0);
  assert.equal(selected.store.getOperationSupport(request.activityId), null);
});

test("lost refusal commit response resumes the same inert Cell through Retirement", async (t) => {
  const selected = await fixture(t, "pre-intent-refusal-recovery");
  let lostResponse = false;
  let revalidations = 0;
  const request: FoundationPreparationAgentOperationV7Input = Object.freeze({
    ...selected.request,
    revalidateBeforeIntent: async () => {
      revalidations += 1;
      throw new Error("pre-intent-refused-before-lost-response");
    },
  });
  const options: FoundationAgentOperationV7Options = Object.freeze({
    ...selected.harness.options,
    async operateCell(input) {
      const delegate = input.activityOwner;
      return await operateFoundationAgentCellV1(Object.freeze({
        ...input,
        activityOwner: Object.freeze({
          read: delegate.read.bind(delegate),
          commitSupport: delegate.commitSupport.bind(delegate),
          ownerCommitDispatch: delegate.ownerCommitDispatch.bind(delegate),
          async ownerCommitPreIntentRefusal(
            mutation: Parameters<typeof delegate.ownerCommitPreIntentRefusal>[0],
          ) {
            const retained = await delegate.ownerCommitPreIntentRefusal(mutation);
            if (!lostResponse) {
              lostResponse = true;
              throw new Error("injected-lost-refusal-owner-response");
            }
            return retained;
          },
        }),
      }));
    },
  });
  await assert.rejects(operateFoundationAgentActivityV7(request, options));
  const interrupted = inspectFoundationAgentActivityV7(
    selected.store,
    request.activityId,
    "delivery.prepare",
  );
  assert.equal(interrupted.stage, "pre-intent-refused");
  assert.equal(interrupted.attempt, null);
  assert.notEqual(interrupted.execution?.handle, null);
  assert.equal(interrupted.execution?.dispatchAuthorityConsumedAt, null);
  assert.notEqual(interrupted.execution?.containment, null);
  assert.equal(interrupted.execution?.output, null);
  assert.equal(interrupted.execution?.retirement, null);
  const handle = interrupted.execution!.handle;
  assert.equal(await selected.harness.reclamationCount(), 0);

  await assert.rejects(
    recoverFoundationAgentActivityV7(request, options),
    /pre-intent revalidation refusal/u,
  );
  assert.equal(revalidations, 1);
  assert.equal(selected.harness.engine.snapshot().allocations.length, 1);
  assert.equal(selected.harness.engine.snapshot().allocations[0]?.handle, handle);
  assert.equal(selected.harness.engine.productiveStartCount(
    selected.harness.specificationDigest()!,
  ), 0);
  assert.equal(await selected.harness.reclamationCount(), 1);
  const events = activityEvents(selected.store, request.activityId);
  assert.equal(events.filter(({ eventKind }) => eventKind === "agent-pre-intent-refused").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "agent-attempt-prepared").length, 0);
  assert.equal(events.filter(({ eventKind }) => eventKind === "provider-effect-intended").length, 0);
  assert.equal(selected.store.getOperationSupport(request.activityId), null);
});

test("lost Receipt owner response reuses one Receipt and one productive Cell", async (t) => {
  const selected = await fixture(t, "receipt-recovery");
  let lostResponse = false;
  const options: FoundationAgentOperationV7Options = Object.freeze({
    ...selected.harness.options,
    async retainReceipt(input) {
      const retained = await retainExecutionReceipt(input);
      if (!lostResponse) {
        lostResponse = true;
        throw new Error("injected-lost-receipt-owner-response");
      }
      return retained;
    },
  });
  await assert.rejects(operateFoundationAgentActivityV7(selected.request, options));
  let events = activityEvents(selected.store, selected.request.activityId);
  assert.equal(events.filter(({ eventKind }) => eventKind === "execution-receipt-recorded").length, 1);
  assert.notEqual(selected.store.getOperationSupport(selected.request.activityId), null);

  const recovered = await recoverFoundationAgentActivityV7(selected.request, options);
  const receipt = selected.store.getRevision(recovered.receipt.id, recovered.receipt.revision)!;
  const specificationDigest = object(
    receipt.payload.execution,
    "Recovered Receipt Execution facts",
  ).specificationDigest as Sha256;
  assert.equal(selected.harness.engine.productiveStartCount(specificationDigest), 1);
  events = activityEvents(selected.store, selected.request.activityId);
  assert.equal(events.filter(({ eventKind }) => eventKind === "agent-attempt-prepared").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "provider-effect-intended").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "execution-receipt-recorded").length, 1);
  assert.equal(selected.store.getOperationSupport(selected.request.activityId), null);
});

test("invalid authoring Carrier retains exact terminal Receipt facts through recovery", async (t) => {
  const selected = await fixture(t, "invalid-authoring-receipt-recovery", {
    invalidAuthoringCarrier: true,
  });
  let lostResponse = false;
  const cellResults: Awaited<ReturnType<typeof operateFoundationAgentCellV1>>[] = [];
  const options: FoundationAgentOperationV7Options = Object.freeze({
    ...selected.harness.options,
    async operateCell(input) {
      const result = await operateFoundationAgentCellV1(input);
      cellResults.push(result);
      return result;
    },
    async retainReceipt(input) {
      const retained = await retainExecutionReceipt(input);
      if (!lostResponse) {
        lostResponse = true;
        throw new Error("injected-lost-invalid-authoring-receipt-response");
      }
      return retained;
    },
  });

  await assert.rejects(
    operateFoundationAgentActivityV7(selected.request, options),
    /injected-lost-invalid-authoring-receipt-response/u,
  );
  assert.equal(cellResults.length, 1);
  const firstCell = cellResults[0]!;
  assert.equal(firstCell.terminal.outputValidation, "invalid");
  assert.equal(firstCell.validatedOutput, null);
  assert.equal(firstCell.providerResult, null);
  assert.equal(firstCell.semantic.disposition, "unavailable");
  assert.equal(firstCell.candidate.disposition, "not-applicable");
  assert.deepEqual(firstCell.receiptFacts.execution.output, {
    availability: "unavailable",
    carrierByteLength: null,
    carrierDigest: null,
    manifestDigest: null,
  });
  assert.equal(firstCell.receiptFacts.provider?.outcome, "natural-return");
  assert.equal(firstCell.receiptFacts.provider?.stage, "evaluated");
  assert.equal(firstCell.receiptFacts.provider?.productiveStarted, true);
  assert.equal(firstCell.receiptFacts.provider?.exitCode, 0);
  assert.equal(firstCell.receiptFacts.provider?.signal, null);
  assert.equal(firstCell.receiptFacts.provider?.sessionId, "agent-operation-v7-session");

  let events = activityEvents(selected.store, selected.request.activityId);
  assert.equal(events.filter(({ eventKind }) => eventKind === "execution-receipt-recorded").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "activity-completed").length, 0);
  assert.equal(events.filter(({ eventKind }) => eventKind === "candidate-revision-observed").length, 0);
  const interrupted = inspectFoundationAgentActivityV7(
    selected.store,
    selected.request.activityId,
    "delivery.prepare",
  );
  assert.notEqual(interrupted.execution?.terminalCompletion, null);
  assert.equal(interrupted.execution?.output?.validation, "invalid");
  assert.notEqual(interrupted.execution?.retirement, null);
  assert.equal(
    interrupted.execution?.retirement?.terminalCompletionDigest,
    interrupted.execution?.terminalCompletion?.digest,
  );
  assert.equal(selected.harness.dispatchCount(), 1);
  assert.equal(selected.harness.engine.productiveStartCount(firstCell.specification.digest), 1);
  assert.equal(await selected.harness.reclamationCount(), 1);

  const recovered = await recoverFoundationAgentActivityV7(selected.request, options);
  assert.equal(recovered.outcome, "abandoned");
  assert.equal(recovered.workProduct, null);
  assert.equal(recovered.candidate, null);
  assert.equal(cellResults.length, 2);
  assert.deepEqual(cellResults[1]!.receiptFacts, firstCell.receiptFacts);
  assert.deepEqual(cellResults[1]!.terminal, firstCell.terminal);
  assert.equal(selected.harness.dispatchCount(), 1);
  assert.equal(selected.harness.engine.productiveStartCount(firstCell.specification.digest), 1);
  assert.equal(await selected.harness.reclamationCount(), 1);

  const receipt = selected.store.getRevision(recovered.receipt.id, recovered.receipt.revision)!;
  const attempt = selected.store.getRevision(recovered.attempt.id, recovered.attempt.revision)!;
  const attemptProvider = object(attempt.payload.provider, "Recovered Attempt Provider facts");
  const provider = object(receipt.payload.provider, "Recovered Receipt Provider facts");
  const providerEffect = object(
    receipt.payload.providerEffect,
    "Recovered Receipt provider effect",
  );
  const execution = object(receipt.payload.execution, "Recovered Receipt Execution facts");
  const output = object(execution.output, "Recovered Receipt Output facts");
  const workspace = object(receipt.payload.workspace, "Recovered Receipt workspace facts");
  const workProduct = object(receipt.payload.workProduct, "Recovered Receipt Work Product facts");
  const candidate = object(receipt.payload.candidate, "Recovered Receipt Candidate facts");
  const containment = object(receipt.payload.containment, "Recovered Receipt Containment facts");
  const retirement = object(receipt.payload.retirement, "Recovered Receipt Retirement facts");
  assert.equal(providerEffect.outcome, "completed");
  assert.equal(receipt.payload.productiveExecutionStarted, true);
  assert.equal(provider.observedExecutableIdentity, attemptProvider.installedIdentityDigest);
  assert.equal(provider.sessionId, "agent-operation-v7-session");
  assert.equal(provider.firstTrigger, "natural");
  assert.equal(provider.terminalReason, "natural-completion");
  assert.equal(provider.stage, "evaluated");
  assert.equal(provider.startedAt, "2026-09-01T00:00:00.020Z");
  assert.equal(provider.finishedAt, "2026-09-01T00:00:00.030Z");
  assert.equal(provider.exitCode, 0);
  assert.equal(provider.signal, null);
  assert.deepEqual(output, {
    availability: "unavailable",
    carrierByteLength: null,
    carrierDigest: null,
    manifestDigest: null,
  });
  assert.equal(workspace.availability, "unavailable");
  assert.notEqual(workspace.failureFactsDigest, null);
  assert.equal(workspace.parserDisposition, "not-run");
  assert.equal(workspace.compilerDisposition, "not-run");
  assert.deepEqual(workProduct, { disposition: "abandoned", reference: null });
  assert.deepEqual(candidate, {
    input: null,
    successorDisposition: null,
    successor: null,
    contentDisposition: null,
  });
  assert.equal(containment.classification, "contained");
  assert.equal(retirement.classification, "retired");
  assert.equal(
    retirement.residualFactsDigest,
    interrupted.execution?.retirement?.reclamationObligation.digest,
  );

  events = activityEvents(selected.store, selected.request.activityId);
  assert.equal(events.filter(({ eventKind }) => eventKind === "agent-attempt-prepared").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "provider-effect-intended").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "provider-effect-observed").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "agent-work-product-abandoned").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "execution-receipt-recorded").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "candidate-revision-observed").length, 0);
  assert.equal(events.filter(({ eventKind }) => eventKind === "activity-completed").length, 1);
  assert.equal(selected.store.getOperationSupport(selected.request.activityId), null);
});

test("missing Execution Backend refuses without a Runtime-host fallback", async (t) => {
  const selected = await fixture(t, "execution-backend-unavailable");
  const { execution: _execution, ...unconfigured } = selected.request.configuration;
  const request: FoundationPreparationAgentOperationV7Input = Object.freeze({
    ...selected.request,
    configuration: Object.freeze(unconfigured),
  });
  await assert.rejects(
    operateFoundationAgentActivityV7(request, selected.harness.options),
    /requires one installed Execution Image with Agent provider support/u,
  );
  const events = activityEvents(selected.store, request.activityId);
  assert.equal(events.filter(({ eventKind }) => eventKind === "agent-attempt-prepared").length, 0);
  assert.equal(events.filter(({ eventKind }) => eventKind === "provider-effect-intended").length, 0);
  assert.equal(events.filter(({ eventKind }) => eventKind === "agent-pre-intent-refused").length, 0);
  assert.equal(selected.harness.engine.snapshot().allocations.length, 0);
  assert.equal(selected.harness.specificationDigest(), null);
  assert.notEqual(selected.store.getOperationSupport(request.activityId), null);
});
