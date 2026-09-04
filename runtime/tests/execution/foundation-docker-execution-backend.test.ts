import assert from "node:assert/strict";
import test from "node:test";
import { FoundationError } from "../../src/foundation/error.js";
import {
  compileExecutionReclamationBinding,
  compileExecutionReclamationObligation,
  createFoundationExecutionAllocationKey,
  foundationExecutionAllocationKeyBindingDigest,
  parseFoundationExecutionRetrievalOutcome,
  type FoundationExecutionAllocationKey,
  type FoundationExecutionBackend,
  type FoundationExecutionHandle,
  type FoundationRetrievedExecutionOutputV1,
} from "../../src/foundation/execution/backend.js";
import {
  executionObservationEstablishesContainment,
  parseFoundationExecutionBackendProfile,
  parseFoundationExecutionSpecification,
  type FoundationExecutionBackendProfileV1,
} from "../../src/foundation/execution/contracts.js";
import {
  createFoundationDockerExecutionBackend,
  type FoundationDockerCellCreateRequestV1,
  type FoundationDockerCellDirectObservationV1,
  type FoundationDockerCellDiscoveryV1,
  type FoundationDockerCellInspectionV1,
  type FoundationDockerEngineDescriptionV1,
  type FoundationDockerEngineDriverV1,
  type FoundationDockerExecutionBindingV1,
  type FoundationDockerImageObservationV1,
  type FoundationDockerOutputRetrievalV1,
} from "../../src/foundation/execution/docker-backend.js";
import {
  digestCanonical,
  selfDigest,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";
import {
  digest,
  executionContractFixture,
  executionOutputFixture,
  type ExecutionContractFixture,
} from "../support/execution-contract-fixture.js";

type DockerFixture = ExecutionContractFixture;
const DOCKER_ENGINE_IDENTITY_DIGEST = digest("docker-engine-identity");

function dockerFixture(salt: string): DockerFixture {
  const base = executionContractFixture(`docker-${salt}`);
  const { digest: _profileDigest, ...baseProfile } = base.profile;
  const profileSubject = {
    ...baseProfile,
    profileId: "lifecycle.execution-backend-profile.docker-local.v1",
    backendKind: "docker-local",
    usage: "production",
    implementation: {
      id: "runtime.execution-backend.docker-local",
      version: "1.0.0",
      implementationDigest: digest("docker-backend-implementation"),
      contractDigest: digest("docker-backend-contract"),
    },
    engineContract: {
      kind: "docker-engine",
      compatibilityProfileId: "docker-engine-api-v1",
      compatibleVersion: "1.48",
      contractDigest: digest("docker-engine-contract"),
    },
    isolation: {
      mechanism: "oci-container",
      nonRootRunner: true,
      privileged: false,
      hostPidNamespace: false,
      hostNetworkNamespace: false,
      dockerSocket: false,
      canonicalRepositoryMount: false,
      runtimeCustodyMount: false,
      completeProcessBoundary: true,
      productionIsolationClaim: true,
    },
  } as const;
  const profile = parseFoundationExecutionBackendProfile({
    ...profileSubject,
    digest: selfDigest(profileSubject),
  });
  const { digest: _specificationDigest, ...baseSpecification } = base.specification;
  const specificationSubject = {
    ...baseSpecification,
    backendProfile: {
      profileId: profile.profileId,
      profileDigest: profile.digest,
      implementationDigest: profile.implementation.implementationDigest,
    },
  } as const;
  const specification = parseFoundationExecutionSpecification({
    value: {
      ...specificationSubject,
      digest: selfDigest(specificationSubject),
    },
    backendProfile: profile,
    image: base.image,
    inputSet: base.inputSet,
  });
  return Object.freeze({
    profile,
    image: base.image,
    inputSet: base.inputSet,
    specification,
  });
}

type FakeCell = {
  request: FoundationDockerCellCreateRequestV1;
  cellId: string;
  dispatchMarker: "not-consumed" | "consumed" | "ambiguous";
  processState: "not-started" | "running" | "terminal" | "ambiguous";
  terminalReason: "exited" | "cancelled" | "parent-loss";
  terminalFinishedAt: string | null;
  cancellationSealed: boolean;
  sequence: number;
  output: FoundationRetrievedExecutionOutputV1 | null;
  outputDispositionOverride: "missing" | "partial" | "unavailable" | "ambiguous" | null;
};

function observedAt(sequence: number): string {
  return new Date(Date.UTC(2026, 8, 1, 0, 0, 0, sequence)).toISOString();
}

class FakeDockerEngineDriver implements FoundationDockerEngineDriverV1 {
  readonly description: FoundationDockerEngineDescriptionV1;
  readonly cells = new Map<string, FakeCell>();
  lastCreate: FoundationDockerCellCreateRequestV1 | null = null;
  createAfterEffectFailure = false;
  consumeAfterEffectFailure = false;
  terminalOnStart = true;
  createCount = 0;
  startCount = 0;
  removeCount = 0;
  readonly removeSpecificationDigests: Sha256[] = [];
  removal: "removed" | "missing" | "remaining" | "integrity-refusal" = "removed";
  imageDigestOverride: Sha256 | null = null;
  engineIdentityDigestOverride: Sha256 | null = null;
  engineContractDigestOverride: Sha256 | null = null;
  outputOverride: FoundationRetrievedExecutionOutputV1 | null = null;
  outputUnavailableReason: "missing" | "partial" | "lost" | null = null;
  retrieveTransportFailure = false;
  retrieveCount = 0;

  constructor(readonly profile: FoundationExecutionBackendProfileV1) {
    this.description = Object.freeze({
      schema: "lifecycle.docker-engine-description.private.v1" as const,
      engineIdentityDigest: DOCKER_ENGINE_IDENTITY_DIGEST,
      contractDigest: profile.engineContract.contractDigest,
      compatibilityProfileId: profile.engineContract.compatibilityProfileId,
      compatibleVersion: profile.engineContract.compatibleVersion,
      platform: profile.platforms[0]!,
    });
  }

  async describe(): Promise<FoundationDockerEngineDescriptionV1> {
    return this.engineContractDigestOverride === null &&
        this.engineIdentityDigestOverride === null
      ? this.description
      : Object.freeze({
          ...this.description,
          engineIdentityDigest:
            this.engineIdentityDigestOverride ?? this.description.engineIdentityDigest,
          contractDigest: this.engineContractDigestOverride ?? this.description.contractDigest,
        });
  }

  async inspectImage(input: Readonly<{
    imageId: string;
    imageDigest: Sha256;
    runnerContractId: "lifecycle.execution-cell-runner.v1";
    runnerContractDigest: Sha256;
  }>): Promise<FoundationDockerImageObservationV1> {
    return Object.freeze({
      schema: "lifecycle.docker-image-observation.private.v1" as const,
      imageId: input.imageId,
      imageDigest: this.imageDigestOverride ?? input.imageDigest,
      platform: this.profile.platforms[0]!,
      immutableReference: true as const,
      nonRootRunner: true as const,
      runnerContractId: input.runnerContractId,
      runnerContractDigest: input.runnerContractDigest,
      runnerAndToolInventoryVerified: true as const,
    });
  }

  #inspection(cell: FakeCell, increment: boolean): FoundationDockerCellInspectionV1 {
    if (increment) cell.sequence += 1;
    const terminal = cell.processState === "terminal"
      ? {
          finishedAt: cell.terminalFinishedAt!,
          reason: cell.terminalReason,
          exitCode: cell.terminalReason === "exited" ? 0
            : cell.terminalReason === "parent-loss" ? 137 : null,
          signal: null,
          runnerDisposition: cell.terminalReason === "exited"
            ? "completed" as const : "incomplete" as const,
        }
      : null;
    const output = cell.outputDispositionOverride !== null
      ? {
          disposition: cell.outputDispositionOverride,
          manifestDigest: null,
          carrierByteLength: null,
        }
      : cell.output === null
      ? {
          disposition: "not-produced" as const,
          manifestDigest: null,
          carrierByteLength: null,
        }
      : {
          disposition: "complete" as const,
          manifestDigest: cell.output.manifest.digest,
          carrierByteLength: cell.output.carrierByteLength,
        };
    const contained = cell.processState === "terminal" || cell.processState === "not-started";
    const direct: FoundationDockerCellDirectObservationV1 = Object.freeze({
      observationSequence: cell.sequence,
      observedAt: observedAt(cell.sequence),
      dispatchMarker: cell.dispatchMarker,
      processState: cell.processState,
      terminal,
      containmentFacts: Object.freeze({
        rootProcess: cell.processState === "not-started"
          ? "not-started" as const
          : cell.processState === "running"
            ? "running" as const
            : cell.processState === "terminal"
              ? "terminal" as const
              : "unverified" as const,
        descendants: contained ? "absent" as const : "present" as const,
        writers: contained ? "absent" as const : "present" as const,
        credentials: cell.request.specification.credentialPolicy.mode === "none"
          ? "not-injected" as const
          : contained
            ? "revoked" as const
            : "active" as const,
        providerChannel: cell.request.specification.networkPolicy.providerControlPlane === "none"
          ? "not-granted" as const
          : contained
            ? "unreachable" as const
            : "reachable" as const,
        outputMutation: contained ? "impossible" as const : "possible" as const,
      }),
      output: Object.freeze(output),
      resourceFacts: Object.freeze({
        wallTimeMilliseconds: cell.processState === "not-started" ? 0 : 10,
        cpuTimeMilliseconds: cell.processState === "not-started" ? 0 : 2,
        peakMemoryBytes: cell.processState === "not-started" ? 0 : 1_024,
        storageBytes: cell.output?.carrierByteLength ?? 0,
        outputBytes: cell.output?.carrierByteLength ?? 0,
        eventCount: cell.processState === "not-started" ? 0 : 1,
        limitBreaches: Object.freeze([]),
      }),
    });
    return Object.freeze({
      schema: "lifecycle.docker-cell-inspection.private.v1" as const,
      cellId: cell.cellId,
      engineIdentityDigest:
        this.engineIdentityDigestOverride ?? this.description.engineIdentityDigest,
      labels: cell.request.labels,
      configuration: cell.request.configuration,
      direct,
    });
  }

  async findCells(input: Readonly<{
    labels: Readonly<Record<string, string>>;
    maximumResults: 2;
  }>): Promise<FoundationDockerCellDiscoveryV1> {
    const matches = [...this.cells.values()].filter((cell) =>
      Object.entries(input.labels).every(([name, value]) => cell.request.labels[name] === value)
    );
    return Object.freeze({
      cells: Object.freeze(matches.slice(0, input.maximumResults).map((cell) =>
        this.#inspection(cell, false)
      )),
      truncated: matches.length > input.maximumResults,
    });
  }

  async inspectCell(cellId: string): Promise<FoundationDockerCellInspectionV1 | null> {
    const cell = this.cells.get(cellId);
    return cell === undefined ? null : this.#inspection(cell, true);
  }

  async createCell(request: FoundationDockerCellCreateRequestV1): Promise<void> {
    this.lastCreate = request;
    this.createCount += 1;
    const cellId = digestCanonical({ allocationName: request.allocationName }).slice("sha256:".length);
    if (this.cells.has(cellId)) throw new Error("Docker name conflict");
    this.cells.set(cellId, {
      request,
      cellId,
      dispatchMarker: "not-consumed",
      processState: "not-started",
      terminalReason: "exited",
      terminalFinishedAt: null,
      cancellationSealed: false,
      sequence: 1,
      output: null,
      outputDispositionOverride: null,
    });
    if (this.createAfterEffectFailure) {
      this.createAfterEffectFailure = false;
      throw new Error("lost Docker create response");
    }
  }

  async consumeDispatch(cellId: string): Promise<"consumed" | "already-consumed" | "ambiguous"> {
    const cell = this.cells.get(cellId);
    if (cell === undefined) return "ambiguous";
    if (cell.cancellationSealed) return "ambiguous";
    if (cell.dispatchMarker !== "not-consumed") return "already-consumed";
    cell.dispatchMarker = "consumed";
    if (this.consumeAfterEffectFailure) {
      this.consumeAfterEffectFailure = false;
      throw new Error("lost dispatch-marker response");
    }
    return "consumed";
  }

  async startCell(cellId: string): Promise<void> {
    const cell = this.cells.get(cellId);
    if (cell === undefined || cell.dispatchMarker !== "consumed") {
      throw new Error("invalid start");
    }
    this.startCount += 1;
    cell.processState = this.terminalOnStart ? "terminal" : "running";
    cell.terminalReason = "exited";
    cell.terminalFinishedAt = this.terminalOnStart ? observedAt(cell.sequence + 1) : null;
  }

  async cancelCell(cellId: string): Promise<void> {
    const cell = this.cells.get(cellId);
    if (cell === undefined) return;
    if (cell.processState === "running") {
      cell.processState = "terminal";
      cell.terminalReason = "cancelled";
      cell.terminalFinishedAt = observedAt(cell.sequence + 1);
    } else if (cell.processState === "not-started") {
      cell.cancellationSealed = true;
    }
  }

  async retrieveOutput(): Promise<FoundationDockerOutputRetrievalV1> {
    this.retrieveCount += 1;
    if (this.retrieveTransportFailure) {
      this.retrieveTransportFailure = false;
      throw new Error("interrupted Docker output transport");
    }
    if (this.outputUnavailableReason !== null) {
      return Object.freeze({
        schema: "lifecycle.docker-output-retrieval.private.v1" as const,
        disposition: "unavailable" as const,
        unavailableReason: this.outputUnavailableReason,
        output: null,
      });
    }
    const selected = this.outputOverride ??
      [...this.cells.values()].find((cell) => cell.output !== null)?.output ?? null;
    const output = selected;
    if (output === null) throw new Error("output unavailable");
    return Object.freeze({
      schema: "lifecycle.docker-output-retrieval.private.v1" as const,
      disposition: "complete" as const,
      unavailableReason: null,
      output,
    });
  }

  async removeCell(input: Readonly<{
    cellId: string;
    specificationDigest: Sha256;
  }>): Promise<"removed" | "missing" | "remaining" | "integrity-refusal"> {
    this.removeCount += 1;
    this.removeSpecificationDigests.push(input.specificationDigest);
    if (this.removal === "removed") this.cells.delete(input.cellId);
    return this.cells.has(input.cellId) ? this.removal : "missing";
  }

  provideOutput(handle: FoundationExecutionHandle, output: FoundationRetrievedExecutionOutputV1): void {
    const cell = this.cells.get(handle.slice("execution-handle-v1:".length));
    assert.notEqual(cell, undefined);
    cell!.output = output;
  }

  reportParentLoss(handle: FoundationExecutionHandle): void {
    const cell = this.cells.get(handle.slice("execution-handle-v1:".length));
    assert.notEqual(cell, undefined);
    assert.equal(cell!.processState, "running");
    cell!.processState = "terminal";
    cell!.terminalReason = "parent-loss";
    cell!.terminalFinishedAt = observedAt(cell!.sequence + 1);
  }

  reportOutputDisposition(
    handle: FoundationExecutionHandle,
    disposition: FakeCell["outputDispositionOverride"],
  ): void {
    const cell = this.cells.get(handle.slice("execution-handle-v1:".length));
    assert.notEqual(cell, undefined);
    cell!.outputDispositionOverride = disposition;
  }

  duplicate(handle: FoundationExecutionHandle): void {
    const source = this.cells.get(handle.slice("execution-handle-v1:".length));
    assert.notEqual(source, undefined);
    const cellId = digestCanonical({ duplicate: source!.cellId }).slice("sha256:".length);
    this.cells.set(cellId, {
      ...source!,
      cellId,
    });
  }

  deleteWithoutObservation(handle: FoundationExecutionHandle): void {
    assert.equal(this.cells.delete(handle.slice("execution-handle-v1:".length)), true);
  }
}

function bindingResolver(bindings: Map<FoundationExecutionHandle, FoundationDockerExecutionBindingV1>) {
  return async (handle: FoundationExecutionHandle): Promise<FoundationDockerExecutionBindingV1 | null> =>
    bindings.get(handle) ?? null;
}

function executionBinding(input: Readonly<{
  fixture: DockerFixture;
  allocationKey: FoundationExecutionAllocationKey;
  engineIdentityDigest?: Sha256;
  dispatchAuthorityConsumed: boolean;
  retainedObservationSequence?: number | null;
  retirementCheckpointDigest: Sha256 | null;
}>): FoundationDockerExecutionBindingV1 {
  return Object.freeze({
    specification: input.fixture.specification,
    allocationKeyDigest: foundationExecutionAllocationKeyBindingDigest(input.allocationKey),
    engineIdentityDigest: input.engineIdentityDigest ?? DOCKER_ENGINE_IDENTITY_DIGEST,
    dispatchAuthorityConsumed: input.dispatchAuthorityConsumed,
    retainedObservationSequence: input.retainedObservationSequence ?? null,
    retirementCheckpointDigest: input.retirementCheckpointDigest,
  });
}

async function reclamationHandoff(input: Readonly<{
  backend: FoundationExecutionBackend;
  fixture: DockerFixture;
  handle: FoundationExecutionHandle;
  retirementCheckpointDigest: Sha256;
  dispatchAuthorityConsumed: boolean;
}>) {
  const binding = await input.backend.createReclamationBinding({
    specification: input.fixture.specification,
    handle: input.handle,
    retirementCheckpointDigest: input.retirementCheckpointDigest,
    dispatchAuthorityConsumed: input.dispatchAuthorityConsumed,
  });
  return Object.freeze({
    binding,
    obligation: compileExecutionReclamationObligation({
      specification: input.fixture.specification,
      handle: input.handle,
      retirementCheckpointDigest: input.retirementCheckpointDigest,
      reclamationBinding: binding,
    }),
  });
}

async function readOutput(output: FoundationRetrievedExecutionOutputV1): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const entry of output.entries()) {
    for await (const chunk of entry.read()) chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

test("Docker Backend creates one exact hardened Cell and reconciles lost allocation response", async () => {
  const fixture = dockerFixture("allocation");
  const driver = new FakeDockerEngineDriver(fixture.profile);
  driver.createAfterEffectFailure = true;
  const backend = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
  });
  const key = createFoundationExecutionAllocationKey();
  await assert.rejects(backend.allocate(fixture.specification, key));
  const handle = await backend.allocate(fixture.specification, key);
  assert.equal(await backend.allocate(fixture.specification, key), handle);
  assert.equal(driver.cells.size, 1);

  const request = driver.lastCreate!;
  assert.equal(request.configuration.image.imageDigest, fixture.image.imageDigest);
  assert.equal(request.configuration.runner.contractId, "lifecycle.execution-cell-runner.v1");
  assert.deepEqual(request.configuration.security, {
    nonRootRunner: true,
    privileged: false,
    hostPidNamespace: false,
    hostNetworkNamespace: false,
    dockerSocket: false,
    canonicalRepositoryMount: false,
    runtimeCustodyMount: false,
    hostPathMounts: false,
    restartPolicy: "no",
    rootFilesystem: "read-only",
    addedCapabilities: [],
    noNewPrivileges: true,
    outerSeccomp: "unconfined-for-nested-codex-restricted-read",
    innerAgentToolSandbox: "codex-restricted-read-networkless-v1",
  });
  assert.equal(request.configuration.transport.pathFreeRuntimeInterface, true);
  assert.equal(JSON.stringify(request).includes(key), false);
  assert.equal(JSON.stringify(request).includes("/var/run/docker.sock"), false);

  const other = dockerFixture("allocation-other");
  await assert.rejects(
    backend.allocate(other.specification, key),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.docker-backend.allocation-substitution",
  );
  await assert.rejects(
    backend.allocate(fixture.specification, createFoundationExecutionAllocationKey()),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.docker-backend.allocation-duplicate",
  );
});

test("Docker Backend refuses mutable image substitution and incompatible Engine identity", async () => {
  const fixture = dockerFixture("identity");
  const driver = new FakeDockerEngineDriver(fixture.profile);
  driver.imageDigestOverride = digest("substituted-image");
  const backend = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
  });
  await assert.rejects(
    backend.allocate(fixture.specification, createFoundationExecutionAllocationKey()),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.docker-backend.image",
  );

  const incompatible = new FakeDockerEngineDriver(fixture.profile);
  incompatible.engineContractDigestOverride = digest("other-engine-contract");
  await assert.rejects(
    createFoundationDockerExecutionBackend({ profile: fixture.profile, driver: incompatible }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.docker-backend.engine",
  );
});

test("Docker dispatch marker is one-time across uncertain start and allocation cannot adopt it", async () => {
  const fixture = dockerFixture("dispatch");
  const driver = new FakeDockerEngineDriver(fixture.profile);
  driver.consumeAfterEffectFailure = true;
  const bindings = new Map<FoundationExecutionHandle, FoundationDockerExecutionBindingV1>();
  const backend = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
    resolveBinding: bindingResolver(bindings),
  });
  const key = createFoundationExecutionAllocationKey();
  const handle = await backend.allocate(fixture.specification, key);
  bindings.set(handle, executionBinding({
    fixture,
    allocationKey: key,
    dispatchAuthorityConsumed: false,
    retirementCheckpointDigest: null,
  }));
  await assert.rejects(
    backend.dispatch(handle),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.docker-backend.dispatch-authority",
  );
  bindings.set(handle, executionBinding({
    fixture,
    allocationKey: key,
    dispatchAuthorityConsumed: true,
    retirementCheckpointDigest: null,
  }));
  await assert.rejects(backend.dispatch(handle));
  assert.equal(driver.startCount, 0);
  const observed = await backend.observe(handle);
  assert.equal(observed.dispatchState, "accepted");
  assert.equal(observed.processState, "not-started");
  assert.equal(executionObservationEstablishesContainment(observed, true), true);
  await assert.rejects(
    backend.dispatch(handle),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.docker-backend.redispatch",
  );
  await assert.rejects(
    backend.allocate(fixture.specification, key),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.docker-backend.allocation-dispatched",
  );
  assert.equal(driver.startCount, 0);
});

test("Docker cancellation contains without inventing Runtime dispatch authority", async () => {
  const fixture = dockerFixture("cancel-before-dispatch");
  const driver = new FakeDockerEngineDriver(fixture.profile);
  const bindings = new Map<FoundationExecutionHandle, FoundationDockerExecutionBindingV1>();
  const backend = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
    resolveBinding: bindingResolver(bindings),
  });
  const key = createFoundationExecutionAllocationKey();
  const handle = await backend.allocate(fixture.specification, key);
  bindings.set(handle, executionBinding({
    fixture,
    allocationKey: key,
    dispatchAuthorityConsumed: false,
    retirementCheckpointDigest: null,
  }));
  const cancelled = await backend.cancel(handle);
  assert.equal(cancelled.dispatchState, "not-observed");
  assert.equal(cancelled.processState, "not-started");
  assert.equal(executionObservationEstablishesContainment(cancelled, false), true);

  bindings.set(handle, executionBinding({
    fixture,
    allocationKey: key,
    dispatchAuthorityConsumed: true,
    retirementCheckpointDigest: null,
  }));
  await assert.rejects(
    backend.dispatch(handle),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.docker-backend.dispatch-ambiguous",
  );
  assert.equal(driver.startCount, 0);
});

test("Docker Backend preserves one parent-loss terminal through later cancellation", async () => {
  const fixture = dockerFixture("parent-loss");
  const driver = new FakeDockerEngineDriver(fixture.profile);
  driver.terminalOnStart = false;
  const bindings = new Map<FoundationExecutionHandle, FoundationDockerExecutionBindingV1>();
  const backend = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
    resolveBinding: bindingResolver(bindings),
  });
  const key = createFoundationExecutionAllocationKey();
  const handle = await backend.allocate(fixture.specification, key);
  bindings.set(handle, executionBinding({
    fixture,
    allocationKey: key,
    dispatchAuthorityConsumed: true,
    retirementCheckpointDigest: null,
  }));
  const running = await backend.dispatch(handle);
  assert.equal(running.processState, "running");
  driver.reportParentLoss(handle);
  const lostParent = await backend.observe(handle);
  assert.equal(lostParent.processState, "terminal");
  assert.deepEqual(lostParent.terminal, {
    finishedAt: lostParent.terminal?.finishedAt,
    reason: "parent-loss",
    exitCode: 137,
    signal: null,
    runnerDisposition: "incomplete",
  });
  bindings.set(handle, executionBinding({
    fixture,
    allocationKey: key,
    dispatchAuthorityConsumed: true,
    retainedObservationSequence: lostParent.observationSequence,
    retirementCheckpointDigest: null,
  }));
  const contained = await backend.cancel(handle);
  assert.deepEqual(contained.terminal, lostParent.terminal);
  assert.equal(executionObservationEstablishesContainment(contained, true), true);
  assert.equal(driver.startCount, 1);
});

test("Docker reports exact host-compatible absence only before dispatch consumption", async () => {
  const fixture = dockerFixture("absent-before-dispatch");
  const driver = new FakeDockerEngineDriver(fixture.profile);
  const backend = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
  });
  const handle = await backend.allocate(
    fixture.specification,
    createFoundationExecutionAllocationKey(),
  );
  driver.deleteWithoutObservation(handle);

  const absent = await backend.observe(handle);
  assert.equal(absent.allocationState, "absent");
  assert.equal(absent.dispatchState, "not-observed");
  assert.equal(absent.processState, "not-observed");
  assert.equal(absent.terminal, null);
  assert.deepEqual(absent.containmentFacts, {
    rootProcess: "unverified",
    descendants: "absent",
    writers: "absent",
    credentials: "not-injected",
    providerChannel: "not-granted",
    outputMutation: "impossible",
  });
  assert.deepEqual(absent.output, {
    disposition: "not-produced",
    manifestDigest: null,
    carrierByteLength: null,
  });
  assert.equal(executionObservationEstablishesContainment(absent, false), true);
  assert.equal(executionObservationEstablishesContainment(absent, true), false);

  const consumedFixture = dockerFixture("absent-after-dispatch-consumption");
  const consumedDriver = new FakeDockerEngineDriver(consumedFixture.profile);
  consumedDriver.consumeAfterEffectFailure = true;
  const consumedBindings =
    new Map<FoundationExecutionHandle, FoundationDockerExecutionBindingV1>();
  const consumedBackend = await createFoundationDockerExecutionBackend({
    profile: consumedFixture.profile,
    driver: consumedDriver,
    resolveBinding: bindingResolver(consumedBindings),
  });
  const consumedKey = createFoundationExecutionAllocationKey();
  const consumedHandle = await consumedBackend.allocate(
    consumedFixture.specification,
    consumedKey,
  );
  consumedBindings.set(consumedHandle, executionBinding({
    fixture: consumedFixture,
    allocationKey: consumedKey,
    dispatchAuthorityConsumed: true,
    retirementCheckpointDigest: null,
  }));
  await assert.rejects(consumedBackend.dispatch(consumedHandle));
  consumedDriver.deleteWithoutObservation(consumedHandle);

  const ambiguous = await consumedBackend.observe(consumedHandle);
  assert.equal(ambiguous.allocationState, "ambiguous");
  assert.equal(ambiguous.dispatchState, "ambiguous");
  assert.equal(ambiguous.processState, "ambiguous");
  assert.deepEqual(ambiguous.containmentFacts, {
    rootProcess: "unverified",
    descendants: "unverified",
    writers: "unverified",
    credentials: "unverified",
    providerChannel: "unverified",
    outputMutation: "unverified",
  });
  assert.equal(executionObservationEstablishesContainment(ambiguous, true), false);
  assert.equal(consumedDriver.startCount, 0);
});

test("Docker restart advances pre-dispatch absence beyond the retained observation sequence", async () => {
  const fixture = dockerFixture("restart-absence-sequence");
  const driver = new FakeDockerEngineDriver(fixture.profile);
  const first = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
  });
  const key = createFoundationExecutionAllocationKey();
  const handle = await first.allocate(fixture.specification, key);
  const retained = await first.observe(handle);
  driver.deleteWithoutObservation(handle);

  const bindings = new Map<FoundationExecutionHandle, FoundationDockerExecutionBindingV1>([[
    handle,
    executionBinding({
      fixture,
      allocationKey: key,
      dispatchAuthorityConsumed: false,
      retainedObservationSequence: retained.observationSequence,
      retirementCheckpointDigest: null,
    }),
  ]]);
  const reopened = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
    resolveBinding: bindingResolver(bindings),
    now: () => "2026-09-01T01:30:00.000Z",
  });

  const absent = await reopened.observe(handle);
  assert.equal(absent.allocationState, "absent");
  assert.equal(absent.dispatchState, "not-observed");
  assert.equal(absent.processState, "not-observed");
  assert.equal(absent.observationSequence, retained.observationSequence + 1);
});

test("Docker restart refuses a repointed Engine before reporting direct absence", async () => {
  const fixture = dockerFixture("restart-repointed-engine-absence");
  const driver = new FakeDockerEngineDriver(fixture.profile);
  const first = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
  });
  const key = createFoundationExecutionAllocationKey();
  const handle = await first.allocate(fixture.specification, key);
  const retained = await first.observe(handle);
  driver.deleteWithoutObservation(handle);
  driver.engineIdentityDigestOverride = digest("repointed-docker-engine-absence");

  const bindings = new Map<FoundationExecutionHandle, FoundationDockerExecutionBindingV1>([[
    handle,
    executionBinding({
      fixture,
      allocationKey: key,
      dispatchAuthorityConsumed: false,
      retainedObservationSequence: retained.observationSequence,
      retirementCheckpointDigest: null,
    }),
  ]]);
  const reopened = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
    resolveBinding: bindingResolver(bindings),
  });

  await assert.rejects(
    reopened.observe(handle),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.docker-backend.engine-substitution",
  );
});

test("Docker restart refuses a repointed Engine before dispatch", async () => {
  const fixture = dockerFixture("restart-repointed-engine-dispatch");
  const driver = new FakeDockerEngineDriver(fixture.profile);
  const first = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
  });
  const key = createFoundationExecutionAllocationKey();
  const handle = await first.allocate(fixture.specification, key);
  const bindings = new Map<FoundationExecutionHandle, FoundationDockerExecutionBindingV1>([[
    handle,
    executionBinding({
      fixture,
      allocationKey: key,
      dispatchAuthorityConsumed: true,
      retirementCheckpointDigest: null,
    }),
  ]]);
  driver.engineIdentityDigestOverride = digest("repointed-docker-engine-dispatch");
  const reopened = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
    resolveBinding: bindingResolver(bindings),
  });

  await assert.rejects(
    reopened.dispatch(handle),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.docker-backend.engine-substitution",
  );
  assert.equal(driver.startCount, 0);
});

test("Docker restart refuses a repointed Engine before absence-based Reclamation", async () => {
  const fixture = dockerFixture("restart-repointed-engine-reclamation");
  const driver = new FakeDockerEngineDriver(fixture.profile);
  const bindings = new Map<FoundationExecutionHandle, FoundationDockerExecutionBindingV1>();
  const first = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
    resolveBinding: bindingResolver(bindings),
  });
  const key = createFoundationExecutionAllocationKey();
  const handle = await first.allocate(fixture.specification, key);
  const retirementCheckpointDigest = digest("repointed-engine-retirement");
  bindings.set(handle, executionBinding({
    fixture,
    allocationKey: key,
    dispatchAuthorityConsumed: false,
    retirementCheckpointDigest,
  }));
  const retirement = await reclamationHandoff({
    backend: first,
    fixture,
    handle,
    retirementCheckpointDigest,
    dispatchAuthorityConsumed: false,
  });
  driver.deleteWithoutObservation(handle);
  driver.engineIdentityDigestOverride = digest("repointed-docker-engine-reclamation");
  const reopened = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
  });

  await assert.rejects(
    reopened.reclaim(
      fixture.specification,
      retirement.binding,
      retirement.obligation,
    ),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.docker-backend.engine-substitution",
  );
  assert.equal(driver.removeCount, 0);
});

test("Docker restart proves Reclamation from the original empty Engine without Activity support", async () => {
  const fixture = dockerFixture("restart-reclamation-empty-engine");
  const driver = new FakeDockerEngineDriver(fixture.profile);
  const bindings = new Map<FoundationExecutionHandle, FoundationDockerExecutionBindingV1>();
  const first = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
    resolveBinding: bindingResolver(bindings),
  });
  const key = createFoundationExecutionAllocationKey();
  const handle = await first.allocate(fixture.specification, key);
  const retirementCheckpointDigest = digest("restart-reclamation-empty-engine-retirement");
  bindings.set(handle, executionBinding({
    fixture,
    allocationKey: key,
    dispatchAuthorityConsumed: false,
    retirementCheckpointDigest,
  }));
  const retirement = await reclamationHandoff({
    backend: first,
    fixture,
    handle,
    retirementCheckpointDigest,
    dispatchAuthorityConsumed: false,
  });
  driver.deleteWithoutObservation(handle);
  bindings.clear();

  const restarted = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
    now: () => "2026-09-01T01:00:00.000Z",
  });
  const reclaimed = await restarted.reclaim(
    fixture.specification,
    retirement.binding,
    retirement.obligation,
  );
  assert.equal(reclaimed.disposition, "reclaimed");
  assert.equal(reclaimed.obligationDigest, retirement.obligation.digest);
  assert.equal(driver.removeCount, 1);
  assert.deepEqual(driver.removeSpecificationDigests, [fixture.specification.digest]);
});

test("Docker restart refuses a same-key replacement after the exact Handle disappears", async () => {
  const fixture = dockerFixture("restart-reclamation-same-key-replacement");
  const driver = new FakeDockerEngineDriver(fixture.profile);
  const bindings = new Map<FoundationExecutionHandle, FoundationDockerExecutionBindingV1>();
  const first = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
    resolveBinding: bindingResolver(bindings),
  });
  const key = createFoundationExecutionAllocationKey();
  const handle = await first.allocate(fixture.specification, key);
  const retirementCheckpointDigest = digest(
    "restart-reclamation-same-key-replacement-retirement",
  );
  bindings.set(handle, executionBinding({
    fixture,
    allocationKey: key,
    dispatchAuthorityConsumed: false,
    retirementCheckpointDigest,
  }));
  const retirement = await reclamationHandoff({
    backend: first,
    fixture,
    handle,
    retirementCheckpointDigest,
    dispatchAuthorityConsumed: false,
  });
  driver.duplicate(handle);
  driver.deleteWithoutObservation(handle);
  bindings.clear();

  const restarted = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
    now: () => "2026-09-01T01:00:00.000Z",
  });
  const refusal = await restarted.reclaim(
    fixture.specification,
    retirement.binding,
    retirement.obligation,
  );
  assert.equal(refusal.disposition, "integrity-refusal");
  assert.equal(refusal.obligationDigest, retirement.obligation.digest);
  assert.equal(driver.removeCount, 0);
  assert.equal(driver.cells.size, 1);
});

test("Docker Backend reopens exact retained binding and refuses Cell duplication", async () => {
  const fixture = dockerFixture("recovery");
  const driver = new FakeDockerEngineDriver(fixture.profile);
  const first = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
  });
  const key = createFoundationExecutionAllocationKey();
  const handle = await first.allocate(fixture.specification, key);
  const bindings = new Map<FoundationExecutionHandle, FoundationDockerExecutionBindingV1>([[
    handle,
    executionBinding({
      fixture,
      allocationKey: key,
      dispatchAuthorityConsumed: false,
      retirementCheckpointDigest: null,
    }),
  ]]);
  const reopened = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
    resolveBinding: bindingResolver(bindings),
  });
  assert.equal((await reopened.observe(handle)).processState, "not-started");

  driver.duplicate(handle);
  await assert.rejects(
    reopened.observe(handle),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.docker-backend.allocation-ambiguous",
  );
});

test("Docker direct readiness rearms one retained pre-dispatch Handle only before consumption", async () => {
  const fixture = dockerFixture("restart-before-consumption");
  const driver = new FakeDockerEngineDriver(fixture.profile);
  const first = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
  });
  const key = createFoundationExecutionAllocationKey();
  const handle = await first.allocate(fixture.specification, key);
  const bindings = new Map<FoundationExecutionHandle, FoundationDockerExecutionBindingV1>([[
    handle,
    executionBinding({
      fixture,
      allocationKey: key,
      dispatchAuthorityConsumed: false,
      retirementCheckpointDigest: null,
    }),
  ]]);
  const reopened = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
    resolveBinding: bindingResolver(bindings),
  });

  const readiness = await reopened.observe(handle);
  assert.equal(readiness.dispatchState, "not-observed");
  assert.equal(readiness.processState, "not-started");
  bindings.set(handle, executionBinding({
    fixture,
    allocationKey: key,
    dispatchAuthorityConsumed: true,
    retirementCheckpointDigest: null,
  }));
  assert.equal((await reopened.dispatch(handle)).processState, "terminal");
  assert.equal(driver.createCount, 1);
  assert.equal(driver.cells.size, 1);
  assert.equal(driver.startCount, 1);

  const consumedFixture = dockerFixture("restart-after-consumption");
  const consumedDriver = new FakeDockerEngineDriver(consumedFixture.profile);
  const consumedFirst = await createFoundationDockerExecutionBackend({
    profile: consumedFixture.profile,
    driver: consumedDriver,
  });
  const consumedKey = createFoundationExecutionAllocationKey();
  const consumedHandle = await consumedFirst.allocate(
    consumedFixture.specification,
    consumedKey,
  );
  const consumedBindings =
    new Map<FoundationExecutionHandle, FoundationDockerExecutionBindingV1>([[
      consumedHandle,
      executionBinding({
        fixture: consumedFixture,
        allocationKey: consumedKey,
        dispatchAuthorityConsumed: true,
        retirementCheckpointDigest: null,
      }),
    ]]);
  const consumedReopened = await createFoundationDockerExecutionBackend({
    profile: consumedFixture.profile,
    driver: consumedDriver,
    resolveBinding: bindingResolver(consumedBindings),
  });
  const consumedReadiness = await consumedReopened.observe(consumedHandle);
  assert.equal(consumedReadiness.dispatchState, "not-observed");
  assert.equal(consumedReadiness.processState, "not-started");
  await assert.rejects(
    consumedReopened.dispatch(consumedHandle),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.docker-backend.redispatch",
  );
  assert.equal(consumedDriver.createCount, 1);
  assert.equal(consumedDriver.cells.size, 1);
  assert.equal(consumedDriver.startCount, 0);
});

test("Docker refreshes same-instance Retirement and reclaims without consuming dispatch", async () => {
  const fixture = dockerFixture("same-instance-retirement");
  const driver = new FakeDockerEngineDriver(fixture.profile);
  const bindings = new Map<FoundationExecutionHandle, FoundationDockerExecutionBindingV1>();
  const backend = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
    resolveBinding: bindingResolver(bindings),
    now: () => "2026-09-01T01:00:00.000Z",
  });
  const key = createFoundationExecutionAllocationKey();
  const handle = await backend.allocate(fixture.specification, key);
  const unretired = executionBinding({
    fixture,
    allocationKey: key,
    dispatchAuthorityConsumed: false,
    retirementCheckpointDigest: null,
  });
  bindings.set(handle, unretired);

  bindings.set(handle, Object.freeze({
    ...unretired,
    allocationKeyDigest: digest("substituted-allocation-key-binding"),
  }));
  await assert.rejects(
    backend.dispatch(handle),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.docker-backend.binding-substitution",
  );
  assert.equal(driver.startCount, 0);

  const retirementCheckpointDigest = digest("same-instance-retirement");
  bindings.set(handle, executionBinding({
    fixture,
    allocationKey: key,
    dispatchAuthorityConsumed: false,
    retirementCheckpointDigest,
  }));
  await assert.rejects(
    backend.dispatch(handle),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.docker-backend.retired",
  );
  const stillInert = await backend.observe(handle);
  assert.equal(stillInert.dispatchState, "not-observed");
  assert.equal(stillInert.processState, "not-started");
  assert.equal(driver.startCount, 0);

  const retirement = await reclamationHandoff({
    backend,
    fixture,
    handle,
    retirementCheckpointDigest,
    dispatchAuthorityConsumed: false,
  });
  const substitutedBinding = compileExecutionReclamationBinding({
    specification: fixture.specification,
    handle,
    retirementCheckpointDigest: digest("other-same-instance-retirement"),
    dispatchAuthorityConsumed: false,
    backendBinding: retirement.binding.backendBinding,
  });
  const substitutedRetirement = compileExecutionReclamationObligation({
    specification: fixture.specification,
    handle,
    retirementCheckpointDigest: substitutedBinding.retirementCheckpointDigest,
    reclamationBinding: substitutedBinding,
  });
  await assert.rejects(
    backend.reclaim(fixture.specification, retirement.binding, substitutedRetirement),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.reclamation-obligation-invalid",
  );
  assert.equal(driver.removeCount, 0);

  bindings.clear();
  assert.equal((await backend.reclaim(
    fixture.specification,
    retirement.binding,
    retirement.obligation,
  )).disposition, "reclaimed");
  assert.equal(driver.removeCount, 1);
  assert.equal(driver.startCount, 0);
});

test("Docker restart refuses an unconsumed retired Handle and reclaims its exact Cell", async () => {
  const fixture = dockerFixture("restart-retirement");
  const driver = new FakeDockerEngineDriver(fixture.profile);
  const bindings = new Map<FoundationExecutionHandle, FoundationDockerExecutionBindingV1>();
  const first = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
    resolveBinding: bindingResolver(bindings),
  });
  const key = createFoundationExecutionAllocationKey();
  const handle = await first.allocate(fixture.specification, key);
  const retirementCheckpointDigest = digest("restart-retirement");
  bindings.set(handle, executionBinding({
    fixture,
    allocationKey: key,
    dispatchAuthorityConsumed: false,
    retirementCheckpointDigest,
  }));
  const retirement = await reclamationHandoff({
    backend: first,
    fixture,
    handle,
    retirementCheckpointDigest,
    dispatchAuthorityConsumed: false,
  });
  const reopened = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
    resolveBinding: bindingResolver(bindings),
    now: () => "2026-09-01T01:00:00.000Z",
  });

  await assert.rejects(
    reopened.dispatch(handle),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.docker-backend.retired",
  );
  assert.equal((await reopened.observe(handle)).dispatchState, "not-observed");
  assert.equal(driver.startCount, 0);
  bindings.clear();
  assert.equal((await reopened.reclaim(
    fixture.specification,
    retirement.binding,
    retirement.obligation,
  )).disposition, "reclaimed");
  assert.equal(driver.removeCount, 1);
  assert.equal(driver.startCount, 0);
});

test("Docker retrieval distinguishes complete, authoritative unavailable, and transient transport", async () => {
  const fixture = dockerFixture("output");
  const driver = new FakeDockerEngineDriver(fixture.profile);
  driver.terminalOnStart = false;
  const bindings = new Map<FoundationExecutionHandle, FoundationDockerExecutionBindingV1>();
  const backend = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
    resolveBinding: bindingResolver(bindings),
  });
  const key = createFoundationExecutionAllocationKey();
  const handle = await backend.allocate(fixture.specification, key);
  bindings.set(handle, executionBinding({
    fixture,
    allocationKey: key,
    dispatchAuthorityConsumed: true,
    retirementCheckpointDigest: null,
  }));
  const running = await backend.dispatch(handle);
  assert.equal(running.processState, "running");
  bindings.set(handle, executionBinding({
    fixture,
    allocationKey: key,
    dispatchAuthorityConsumed: true,
    retainedObservationSequence: running.observationSequence,
    retirementCheckpointDigest: null,
  }));
  await assert.rejects(
    backend.retrieve(handle, running),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.docker-backend.containment-required",
  );

  const expected = executionOutputFixture(fixture.specification);
  driver.provideOutput(handle, expected);
  const cancelled = await backend.cancel(handle);
  assert.equal(executionObservationEstablishesContainment(cancelled, true), true);
  bindings.set(handle, executionBinding({
    fixture,
    allocationKey: key,
    dispatchAuthorityConsumed: true,
    retainedObservationSequence: cancelled.observationSequence,
    retirementCheckpointDigest: null,
  }));
  await assert.rejects(
    backend.retrieve(handle, running),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.docker-backend.retrieval-source",
  );

  driver.retrieveTransportFailure = true;
  await assert.rejects(
    backend.retrieve(handle, cancelled),
    /interrupted Docker output transport/u,
  );

  const retrieved = await backend.retrieve(handle, cancelled);
  assert.equal(retrieved.disposition, "complete");
  if (retrieved.disposition !== "complete") assert.fail("expected complete retrieval");
  assert.equal(retrieved.unavailableReason, null);
  assert.equal(retrieved.observationDigest, cancelled.digest);
  assert.equal(JSON.stringify(retrieved).includes(handle), false);
  assert.equal((await readOutput(retrieved.output)).toString("utf8"), "bounded output\n");

  const retrievalCallsBeforeChangedObservation = driver.retrieveCount;
  for (const disposition of ["missing", "partial", "unavailable", "ambiguous"] as const) {
    driver.reportOutputDisposition(handle, disposition);
    await assert.rejects(
      backend.retrieve(handle, cancelled),
      (error: unknown) => error instanceof FoundationError &&
        error.code === "lifecycle.execution.docker-backend.retrieval-source-changed" &&
        error.retryable,
    );
  }
  driver.reportOutputDisposition(handle, null);
  assert.equal(driver.retrieveCount, retrievalCallsBeforeChangedObservation);

  for (const reason of ["missing", "partial", "lost"] as const) {
    driver.outputUnavailableReason = reason;
    const unavailable = await backend.retrieve(handle, cancelled);
    assert.equal(unavailable.disposition, "unavailable");
    if (unavailable.disposition !== "unavailable") assert.fail("expected unavailable retrieval");
    assert.equal(unavailable.unavailableReason, reason);
    assert.equal(unavailable.output, null);
    assert.match(unavailable.factsDigest, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(unavailable.specificationDigest, fixture.specification.digest);
    assert.deepEqual(
      parseFoundationExecutionRetrievalOutcome({
        value: unavailable,
        specification: fixture.specification,
        handle,
      }),
      unavailable,
    );
  }

  driver.outputUnavailableReason = null;
  const substituted = executionOutputFixture(dockerFixture("substituted-output").specification);
  driver.outputOverride = substituted;
  await assert.rejects(
    backend.retrieve(handle, cancelled),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.docker-backend.output",
  );
});

test("Docker retrieval does not classify not-produced output as unavailable", async () => {
  const fixture = dockerFixture("output-not-produced");
  const driver = new FakeDockerEngineDriver(fixture.profile);
  const bindings = new Map<FoundationExecutionHandle, FoundationDockerExecutionBindingV1>();
  const backend = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
    resolveBinding: bindingResolver(bindings),
  });
  const key = createFoundationExecutionAllocationKey();
  const handle = await backend.allocate(fixture.specification, key);
  bindings.set(handle, executionBinding({
    fixture,
    allocationKey: key,
    dispatchAuthorityConsumed: true,
    retirementCheckpointDigest: null,
  }));
  const terminal = await backend.dispatch(handle);
  assert.equal(terminal.processState, "terminal");
  bindings.set(handle, executionBinding({
    fixture,
    allocationKey: key,
    dispatchAuthorityConsumed: true,
    retainedObservationSequence: terminal.observationSequence,
    retirementCheckpointDigest: null,
  }));
  await assert.rejects(
    backend.retrieve(handle, terminal),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.docker-backend.output-not-applicable",
  );
});

test("Docker Reclamation binds Retirement, proves absence, and refuses ambiguous identity", async () => {
  const fixture = dockerFixture("reclamation");
  const driver = new FakeDockerEngineDriver(fixture.profile);
  const bindings = new Map<FoundationExecutionHandle, FoundationDockerExecutionBindingV1>();
  const backend = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
    resolveBinding: bindingResolver(bindings),
    now: () => "2026-09-01T01:00:00.000Z",
  });
  const key = createFoundationExecutionAllocationKey();
  const handle = await backend.allocate(fixture.specification, key);
  bindings.set(handle, executionBinding({
    fixture,
    allocationKey: key,
    dispatchAuthorityConsumed: true,
    retirementCheckpointDigest: null,
  }));
  assert.equal((await backend.dispatch(handle)).processState, "terminal");
  const retirementCheckpointDigest = digest("docker-retirement");
  bindings.set(handle, executionBinding({
    fixture,
    allocationKey: key,
    dispatchAuthorityConsumed: true,
    retirementCheckpointDigest,
  }));
  const retirement = await reclamationHandoff({
    backend,
    fixture,
    handle,
    retirementCheckpointDigest,
    dispatchAuthorityConsumed: true,
  });
  bindings.clear();
  const reclaimer = await createFoundationDockerExecutionBackend({
    profile: fixture.profile,
    driver,
    now: () => "2026-09-01T01:00:00.000Z",
  });
  const reclaimed = await reclaimer.reclaim(
    fixture.specification,
    retirement.binding,
    retirement.obligation,
  );
  assert.equal(reclaimed.disposition, "reclaimed");
  assert.equal(reclaimed.obligationDigest, retirement.obligation.digest);
  assert.equal(driver.removeCount, 1);
  assert.equal((await reclaimer.reclaim(
    fixture.specification,
    retirement.binding,
    retirement.obligation,
  )).disposition, "reclaimed");
  assert.equal(driver.removeCount, 2);
  assert.deepEqual(driver.removeSpecificationDigests, [
    fixture.specification.digest,
    fixture.specification.digest,
  ]);

  const ambiguousFixture = dockerFixture("reclamation-ambiguous");
  const ambiguousDriver = new FakeDockerEngineDriver(ambiguousFixture.profile);
  const ambiguousBindings =
    new Map<FoundationExecutionHandle, FoundationDockerExecutionBindingV1>();
  const ambiguousBackend = await createFoundationDockerExecutionBackend({
    profile: ambiguousFixture.profile,
    driver: ambiguousDriver,
    resolveBinding: bindingResolver(ambiguousBindings),
    now: () => "2026-09-01T01:00:00.000Z",
  });
  const ambiguousKey = createFoundationExecutionAllocationKey();
  const ambiguousHandle = await ambiguousBackend.allocate(
    ambiguousFixture.specification,
    ambiguousKey,
  );
  ambiguousBindings.set(ambiguousHandle, executionBinding({
    fixture: ambiguousFixture,
    allocationKey: ambiguousKey,
    dispatchAuthorityConsumed: true,
    retirementCheckpointDigest: null,
  }));
  await ambiguousBackend.dispatch(ambiguousHandle);
  const ambiguousRetirementCheckpointDigest = digest("docker-retirement-ambiguous");
  ambiguousBindings.set(ambiguousHandle, executionBinding({
    fixture: ambiguousFixture,
    allocationKey: ambiguousKey,
    dispatchAuthorityConsumed: true,
    retirementCheckpointDigest: ambiguousRetirementCheckpointDigest,
  }));
  const ambiguousRetirement = await reclamationHandoff({
    backend: ambiguousBackend,
    fixture: ambiguousFixture,
    handle: ambiguousHandle,
    retirementCheckpointDigest: ambiguousRetirementCheckpointDigest,
    dispatchAuthorityConsumed: true,
  });
  ambiguousDriver.duplicate(ambiguousHandle);
  ambiguousBindings.clear();
  const refusal = await ambiguousBackend.reclaim(
    ambiguousFixture.specification,
    ambiguousRetirement.binding,
    ambiguousRetirement.obligation,
  );
  assert.equal(refusal.disposition, "integrity-refusal");
  assert.equal(ambiguousDriver.removeCount, 0);
});
