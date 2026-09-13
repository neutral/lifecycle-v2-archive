import assert from "node:assert/strict";
import type { FoundationAgentCellInstalledInputsV1, FoundationAgentCellRuntimeV1 } from "../../src/foundation/attempt/execution-cell-v1.js";
import type { FoundationExecutionBackend, FoundationExecutionHandle, FoundationRetrievedExecutionOutputV1 } from "../../src/foundation/execution/backend.js";
import { parseFoundationExecutionBackendProfile, type FoundationExecutionBackendProfileV1, type FoundationExecutionOutputManifestEntryV1, type FoundationExecutionSpecificationV1 } from "../../src/foundation/execution/contracts.js";
import { createFoundationExecutionOutputStoreV1 } from "../../src/foundation/execution/output-store-v1.js";
import { openFoundationExecutionReclamationLedgerV1 } from "../../src/foundation/execution/reclamation-ledger-v1.js";
import { FoundationAgentCellInputTransportRegistryV1, createFoundationAgentCellOperatorV1, type FoundationCompiledInstalledAgentCellInputsV1, type FoundationOpenedInstalledAgentRuntimeV1 } from "../../src/foundation/execution/installed-agent-runtime-v1.js";
import type { FoundationAgentOperationV7Options } from "../../src/foundation/process/agent-operation-v7.js";
import { FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR } from "../../src/foundation/repository/contract.js";
import { canonicalJsonLine, digestCanonical, selfDigest, sha256Bytes, type Sha256 } from "../../src/foundation/validation/canonical.js";
import { FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1 } from "../../src/util/agent-execution-cell-operation-v1.js";
import { executionContractFixture } from "./execution-contract-fixture.js";
import { InMemoryExecutionBackendEngine } from "./in-memory-execution-backend.js";

// Installed Runtime owners composed with a deterministic external Backend for tests.
// The Backend supplies exact declared Output bytes; Runtime owners allocate, dispatch,
// validate, retain, contain, retire and account for the resulting execution.
export type AgentCellFixtureOutputEntry = Omit<FoundationExecutionOutputManifestEntryV1, "entryKind" | "byteLength" | "digest"> & Readonly<{ bytes: Uint8Array }>;


export type AgentCellFixtureOutputProducer = (input: Readonly<{
  specification: FoundationExecutionSpecificationV1;
  inputEntries: ReadonlyMap<string, Uint8Array>;
}>) => Promise<Readonly<{ entries: readonly AgentCellFixtureOutputEntry[]; providerExitCode?: number;
  providerOutcome?: "natural-return" | "provider-failure" }>>;

function digest(label: string): Sha256 {
  return sha256Bytes(`foundation-agent-operation-v7:${label}`);
}

function providerTerminalBytes(input: Readonly<{
  specification: FoundationExecutionSpecificationV1;
  executableIdentity: Sha256;
  runnerImplementationDigest: Sha256;
  observedAt?: string;
  providerExitCode?: number;
  providerOutcome?: "natural-return" | "provider-failure";
  providerSessionId?: string;
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
    preparedAt: input.observedAt ?? "2026-09-01T00:00:00.010Z",
    startedAt: input.observedAt ?? "2026-09-01T00:00:00.020Z",
    finishedAt: input.observedAt ?? "2026-09-01T00:00:00.030Z",
    executableIdentity: input.executableIdentity,
    outcome: input.providerOutcome ?? "natural-return",
    stage: "evaluated" as const,
    productiveStarted: true,
    firstTrigger: input.providerOutcome ?? "natural-return",
    exitCode: input.providerExitCode ?? 0,
    signal: null,
    sessionId: input.providerSessionId ?? "agent-operation-v7-session",
  });
  return Uint8Array.from(Buffer.from(
    canonicalJsonLine({ ...subject, digest: selfDigest(subject) }),
    "utf8",
  ));
}

export function agentCellFixtureExecutionOutput(input: Readonly<{
  specification: FoundationExecutionSpecificationV1;
  executableIdentity: Sha256;
  runnerImplementationDigest: Sha256;
  invalidAuthoringCarrier?: boolean;
  outputEntries?: readonly AgentCellFixtureOutputEntry[];
  observedAt?: string;
  providerExitCode?: number;
  providerOutcome?: "natural-return" | "provider-failure";
  providerSessionId?: string;
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
    ...(input.outputEntries ?? []),
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
    completedAt: input.observedAt ?? "2026-09-01T00:00:00.100Z",
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
            if (bytes.byteLength > 0) yield Uint8Array.from(bytes);
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
  outputEntries?: readonly AgentCellFixtureOutputEntry[];
  onDispatch?(): void;
  now(): string;
  inputTransport: FoundationAgentCellInputTransportRegistryV1;
  produceOutput?: AgentCellFixtureOutputProducer;
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
        const inputEntries = new Map<string, Uint8Array>();
        if (input.produceOutput !== undefined) {
          const transport = await input.inputTransport.open(specification);
          for await (const entry of transport.entries()) {
            const chunks: Uint8Array[] = [];
            for await (const chunk of entry.read()) chunks.push(chunk);
            inputEntries.set(entry.path, Uint8Array.from(Buffer.concat(chunks)));
          }
        }
        const produced = await input.produceOutput?.({ specification, inputEntries });
        await input.engine.provideOutput(specification, agentCellFixtureExecutionOutput({
          specification,
          executableIdentity: input.installed.provider.installedIdentityDigest,
          runnerImplementationDigest: input.installed.image.runnerImplementationDigest,
          invalidAuthoringCarrier: input.invalidAuthoringCarrier,
          outputEntries: produced?.entries ?? input.outputEntries,
          providerExitCode: produced?.providerExitCode,
          providerOutcome: produced?.providerOutcome,
          providerSessionId: produced === undefined ? undefined : `connected-${specification.digest.slice(7)}`,
          observedAt: input.outputEntries === undefined && produced === undefined ? undefined : input.now(),
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

export type InstalledHarness = Readonly<{
  engine: InMemoryExecutionBackendEngine;
  options: FoundationAgentOperationV7Options;
  specificationDigest(): Sha256 | null;
  dispatchCount(): number;
  reclamationCount(): Promise<number>;
}>;

export function installedHarness(input: Readonly<{
  machineHome: string;
  now: () => string;
  invalidAuthoringCarrier?: boolean;
  outputEntries?: readonly AgentCellFixtureOutputEntry[];
  backendLimits?: FoundationExecutionBackendProfileV1["limits"];
  produceOutput?: AgentCellFixtureOutputProducer;
  engine?: InMemoryExecutionBackendEngine;
  wrapBackend?: (backend: FoundationExecutionBackend) => FoundationExecutionBackend;
}>): InstalledHarness {
  const contract = executionContractFixture("agent-operation-v7");
  const profile = input.backendLimits === undefined ? contract.profile : (() => {
    const subject = { ...contract.profile, limits: input.backendLimits };
    return parseFoundationExecutionBackendProfile({ ...subject, digest: selfDigest(subject) });
  })();
  const image = Object.freeze({
    ...contract.image,
    runnerContractDigest: digest("runner-contract"),
    runnerImplementationDigest: digest("runner-implementation"),
    toolInventoryDigest: digest("tool-inventory"),
  });
  const engine = input.engine ?? new InMemoryExecutionBackendEngine("1".repeat(64));
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
        profile,
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
      assert.deepEqual(Object.keys(selected).sort(), ["image", "installed", "investment", "now"]);
      const inputTransport = new FoundationAgentCellInputTransportRegistryV1();
      const ledger = await openFoundationExecutionReclamationLedgerV1({
        machineHome: input.machineHome,
        installationId: "installation-agent-operation-v7",
        create: true,
        clock: Object.freeze({ now: input.now }),
      });
      const backend = outputBackend({
        engine,
        inputTransport,
        produceOutput: input.produceOutput,
        installed: selected.installed,
        onSpecification(specification) { selectedSpecification = specification.digest; },
        invalidAuthoringCarrier: input.invalidAuthoringCarrier,
        outputEntries: input.outputEntries,
        now: input.now,
        onDispatch() { dispatches += 1; },
      });
      const runtime: FoundationAgentCellRuntimeV1 = Object.freeze({
        machineHome: input.machineHome,
        backend: input.wrapBackend?.(backend) ?? backend,
        registerOperation(): void {},
        outputStore: createFoundationExecutionOutputStoreV1({
          machineHome: input.machineHome,
        }),
        reclamation: ledger,
        clock: Object.freeze({ now: input.now }),
        pollMilliseconds: 0,
      });
      const operator = createFoundationAgentCellOperatorV1({
        installed: selected.installed, runtime, inputTransport,
      });
      assert.deepEqual(Object.keys(operator).sort(), ["installed", "operate"]);
      return Object.freeze({
        ...operator,
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
