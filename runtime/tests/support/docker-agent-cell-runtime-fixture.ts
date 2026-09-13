import assert from "node:assert/strict";
import type { FoundationAgentCellInstalledInputsV1 } from "../../src/foundation/attempt/execution-cell-v1.js";
import type { FoundationRetrievedExecutionOutputV1 } from "../../src/foundation/execution/backend.js";
import {
  createFoundationDockerExecutionBackend,
  type FoundationDockerCellCreateRequestV1,
  type FoundationDockerCellInspectionV1,
  type FoundationDockerEngineDriverV1,
} from "../../src/foundation/execution/docker-backend.js";
import { FoundationDockerExecutionBindingRegistryV1 } from "../../src/foundation/execution/docker-binding-registry-v1.js";
import {
  compileFoundationInstalledAgentCellInputsV1,
  createFoundationMaintainedAgentCellOperatorV1,
  FoundationAgentCellInputTransportRegistryV1,
} from "../../src/foundation/execution/installed-agent-runtime-v1.js";
import { createFoundationExecutionOutputStoreV1 } from "../../src/foundation/execution/output-store-v1.js";
import { openFoundationExecutionReclamationLedgerV1 } from "../../src/foundation/execution/reclamation-ledger-v1.js";
import type { FoundationAgentOperationV7Options } from "../../src/foundation/process/agent-operation-v7.js";
import { digestCanonical, sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { agentCellFixtureExecutionOutput, type AgentCellFixtureOutputProducer } from "./agent-cell-runtime-fixture.js";

type ObservedCell = {
  request: FoundationDockerCellCreateRequestV1;
  cellId: string;
  consumed: boolean;
  state: "not-started" | "running" | "terminal";
  finishedAt: string | null;
  cancelledBeforeStart: boolean;
  output: FoundationRetrievedExecutionOutputV1 | null;
};

/**
 * Deterministic observations at the Engine/runner boundary of the real Docker
 * Backend. No Docker CLI, OCI isolation, provider, credential, interrupted
 * Engine, Reclamation or process-restart qualification is claimed. Output
 * begins as raw provider/semantic/Candidate
 * bytes; Runtime owners compile and retain all resulting Control facts.
 */
class ObservedDockerEngine implements FoundationDockerEngineDriverV1 {
  readonly cells = new Map<string, ObservedCell>();
  readonly identity = sha256Bytes("connected-docker-agent:deterministic-engine");
  dispatches = 0;

  constructor(readonly selected: Readonly<{
    installed: FoundationAgentCellInstalledInputsV1;
    transport: FoundationAgentCellInputTransportRegistryV1;
    bindings: FoundationDockerExecutionBindingRegistryV1;
    produceOutput: AgentCellFixtureOutputProducer;
    now(): string;
  }>) {}

  async describe() {
    const profile = this.selected.installed.profile;
    return { schema: "lifecycle.docker-engine-description.private.v1" as const,
      engineIdentityDigest: this.identity, contractDigest: profile.engineContract.contractDigest,
      compatibilityProfileId: profile.engineContract.compatibilityProfileId,
      compatibleVersion: profile.engineContract.compatibleVersion, platform: profile.platforms[0]! };
  }

  async inspectImage(input: Parameters<FoundationDockerEngineDriverV1["inspectImage"]>[0]) {
    const installed = this.selected.installed;
    assert.equal(input.imageId, installed.image.imageId);
    assert.equal(input.imageDigest, installed.image.imageDigest);
    assert.equal(input.runnerContractDigest, installed.image.runnerContractDigest);
    return { schema: "lifecycle.docker-image-observation.private.v1" as const,
      ...input, platform: installed.profile.platforms[0]!, immutableReference: true as const,
      nonRootRunner: true as const, runnerAndToolInventoryVerified: true as const };
  }

  async allocationResourcesAbsent(input: Parameters<NonNullable<FoundationDockerEngineDriverV1["allocationResourcesAbsent"]>>[0]) {
    return ![...this.cells.values()].some(({ request }) => request.allocationName === input.allocationName);
  }

  // This deterministic Engine never receives credentials. Real custody and
  // provider refresh remain outside this fixture's declared boundary.
  async settleProviderCredential() {}
  async forgetProviderCredential() {}

  async #inspect(cell: ObservedCell): Promise<FoundationDockerCellInspectionV1> {
    const contained = cell.state !== "running";
    const specification = cell.request.specification;
    return { schema: "lifecycle.docker-cell-inspection.private.v1", cellId: cell.cellId,
      engineIdentityDigest: this.identity, labels: cell.request.labels, configuration: cell.request.configuration,
      direct: {
        observationSequence: await this.selected.bindings.observationSequence.next(cell.cellId),
        observedAt: this.selected.now(), dispatchMarker: cell.consumed ? "consumed" : "not-consumed",
        processState: cell.state,
        terminal: cell.state === "terminal" ? { finishedAt: cell.finishedAt!, reason: "exited",
          exitCode: 0, signal: null, runnerDisposition: "completed" } : null,
        containmentFacts: {
          rootProcess: cell.state, descendants: contained ? "absent" : "present",
          writers: contained ? "absent" : "present",
          credentials: specification.credentialPolicy.mode === "none" ? "not-injected" : contained ? "revoked" : "active",
          providerChannel: specification.networkPolicy.providerControlPlane === "none" ? "not-granted" : contained ? "unreachable" : "reachable",
          outputMutation: contained ? "impossible" : "possible",
        },
        output: cell.output === null
          ? { disposition: "not-produced", manifestDigest: null, carrierByteLength: null }
          : { disposition: "complete", manifestDigest: cell.output.manifest.digest, carrierByteLength: cell.output.carrierByteLength },
        resourceFacts: { wallTimeMilliseconds: cell.state === "not-started" ? 0 : 10,
          cpuTimeMilliseconds: cell.state === "not-started" ? 0 : 2,
          peakMemoryBytes: cell.state === "not-started" ? 0 : 1024,
          storageBytes: cell.output?.carrierByteLength ?? 0, outputBytes: cell.output?.carrierByteLength ?? 0,
          eventCount: cell.state === "not-started" ? 0 : 1, limitBreaches: [] },
      } };
  }

  #matching(labels: Readonly<Record<string, string>>) {
    return [...this.cells.values()].filter(({ request }) =>
      Object.entries(labels).every(([key, value]) => request.labels[key] === value));
  }

  async findCells(input: Parameters<FoundationDockerEngineDriverV1["findCells"]>[0]) {
    const matches = this.#matching(input.labels);
    return { cells: await Promise.all(matches.slice(0, input.maximumResults).map(cell => this.#inspect(cell))),
      truncated: matches.length > input.maximumResults };
  }

  async findCellIdentities(input: Parameters<NonNullable<FoundationDockerEngineDriverV1["findCellIdentities"]>>[0]) {
    const matches = this.#matching(input.labels);
    return { cellIds: matches.slice(0, input.maximumResults).map(cell => cell.cellId), truncated: matches.length > input.maximumResults };
  }

  async inspectCell(cellId: string) {
    const cell = this.cells.get(cellId);
    return cell === undefined ? null : this.#inspect(cell);
  }

  async createCell(request: FoundationDockerCellCreateRequestV1) {
    const cellId = digestCanonical({ allocationName: request.allocationName }).slice("sha256:".length);
    assert.equal(this.cells.has(cellId), false, "One exact allocation cannot create a second Cell");
    this.cells.set(cellId, { request, cellId, consumed: false, state: "not-started",
      finishedAt: null, cancelledBeforeStart: false, output: null });
  }

  async consumeDispatch(cellId: string): ReturnType<FoundationDockerEngineDriverV1["consumeDispatch"]> {
    const cell = this.cells.get(cellId);
    if (cell === undefined || cell.cancelledBeforeStart) return "ambiguous";
    if (cell.consumed) return "already-consumed";
    cell.consumed = true;
    return "consumed";
  }

  async startCell(cellId: string) {
    const cell = this.cells.get(cellId);
    assert(cell !== undefined && cell.consumed && cell.state === "not-started" && !cell.cancelledBeforeStart,
      "Start requires the exact unstarted Cell and one consumed dispatch marker");
    this.dispatches += 1;
    cell.state = "running";
    const specification = cell.request.specification;
    const transport = await this.selected.transport.open(specification);
    const inputEntries = new Map<string, Uint8Array>();
    for await (const entry of transport.entries()) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of entry.read()) chunks.push(chunk);
      inputEntries.set(entry.path, Uint8Array.from(Buffer.concat(chunks)));
    }
    const produced = await this.selected.produceOutput({ specification, inputEntries });
    cell.output = agentCellFixtureExecutionOutput({ specification,
      executableIdentity: this.selected.installed.provider.installedIdentityDigest,
      runnerImplementationDigest: this.selected.installed.image.runnerImplementationDigest,
      outputEntries: produced.entries, providerExitCode: produced.providerExitCode,
      providerOutcome: produced.providerOutcome, providerSessionId: `connected-${specification.digest.slice(7)}`,
      observedAt: this.selected.now() });
    cell.state = "terminal";
    cell.finishedAt = this.selected.now();
  }

  async cancelCell(cellId: string) {
    const cell = this.cells.get(cellId);
    assert(cell?.state !== "running",
      "This bounded Engine substitute does not establish cancellation or containment of a pending Output producer");
    if (cell?.state === "not-started") cell.cancelledBeforeStart = true;
  }

  async retrieveOutput(input: Parameters<FoundationDockerEngineDriverV1["retrieveOutput"]>[0]) {
    const cell = this.cells.get(input.cellId);
    assert(cell !== undefined && cell.state === "terminal" && cell.output !== null,
      "Retrieve requires the exact terminal Cell with its retained Output");
    const specification = cell.request.specification;
    assert.equal(input.specificationDigest, specification.digest);
    assert.equal(input.inputSetDigest, specification.inputSet.digest);
    assert.equal(input.imageDigest, specification.image.imageDigest);
    assert.equal(input.outputContractDigest, specification.outputContract.digest);
    assert.equal(input.runnerContractDigest, specification.runner.contractDigest);
    return { schema: "lifecycle.docker-output-retrieval.private.v1" as const,
      disposition: "complete" as const, unavailableReason: null, output: cell.output };
  }

  async removeCell(input: Parameters<FoundationDockerEngineDriverV1["removeCell"]>[0]): ReturnType<FoundationDockerEngineDriverV1["removeCell"]> {
    const cell = this.cells.get(input.cellId);
    if (cell === undefined) return "missing";
    if (cell.request.specification.digest !== input.specificationDigest) return "integrity-refusal";
    this.cells.delete(input.cellId);
    return "removed";
  }
}

/** Exact installed Agent selection, real Docker Backend, deterministic Engine. */
export function installedDockerAgentHarness(input: Readonly<{
  machineHome: string;
  installationId: string;
  now(): string;
  produceOutput: AgentCellFixtureOutputProducer;
}>) {
  const engines: ObservedDockerEngine[] = [];
  const options: FoundationAgentOperationV7Options = {
    now: input.now,
    compileInstalled: compileFoundationInstalledAgentCellInputsV1,
    async openInstalled(selected) {
      const inputTransport = new FoundationAgentCellInputTransportRegistryV1();
      const bindings = new FoundationDockerExecutionBindingRegistryV1();
      const driver = new ObservedDockerEngine({ installed: selected.installed, transport: inputTransport,
        bindings, produceOutput: input.produceOutput, now: input.now });
      engines.push(driver);
      const engine = await driver.describe();
      const backend = await createFoundationDockerExecutionBackend({ profile: selected.installed.profile,
        driver, resolveBinding: bindings.resolve, now: input.now });
      const ledger = await openFoundationExecutionReclamationLedgerV1({ machineHome: input.machineHome,
        installationId: input.installationId, create: true, clock: { now: input.now } });
      const operator = createFoundationMaintainedAgentCellOperatorV1({ installed: selected.installed, inputTransport,
        engineIdentityDigest: async () => (await driver.describe()).engineIdentityDigest,
        runtime: { machineHome: input.machineHome, backend,
          registerOperation({ specification, persistence }) {
            bindings.register({ specification, persistence, engineIdentityDigest: engine.engineIdentityDigest });
          },
          outputStore: createFoundationExecutionOutputStoreV1({ machineHome: input.machineHome }),
          reclamation: ledger, clock: { now: input.now }, pollMilliseconds: 0,
        } });
      return { ...operator, close() { ledger.close(); } };
    },
  };
  return { options, dispatchCount: () => engines.reduce((total, driver) => total + driver.dispatches, 0) };
}
