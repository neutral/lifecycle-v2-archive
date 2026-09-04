import assert from "node:assert/strict";
import test from "node:test";
import { FoundationError } from "../../src/foundation/error.js";
import {
  compileFoundationExecutionRetrievalOutcome,
  compileExecutionReclamationBinding,
  compileExecutionReclamationObservation,
  createFoundationExecutionAllocationKey,
  parseExecutionReclamationBinding,
  parseExecutionReclamationObligation,
  parseExecutionReclamationObservation,
  type FoundationExecutionAllocationKey,
  type FoundationExecutionBackend,
  type FoundationExecutionHandle,
  type FoundationExecutionRetrievalOutcomeV1,
  type FoundationExecutionReclamationBindingV1,
  type FoundationExecutionReclamationObligationV1,
} from "../../src/foundation/execution/backend.js";
import {
  parseFoundationExecutionObservation,
  type FoundationExecutionObservationV1,
  type FoundationExecutionSpecificationV1,
} from "../../src/foundation/execution/contracts.js";
import {
  FoundationExecutionOperationHostV1,
  type FoundationExecutionOwnerTerminalCompletionV1,
  type FoundationExecutionOperationCheckpointCoordinateV1,
  type FoundationExecutionOperationCheckpointPersistenceV1,
  type FoundationExecutionOperationCheckpointV1,
  type FoundationRetainedExecutionOperationCheckpointV1,
} from "../../src/foundation/execution/operation-host.js";
import type {
  FoundationExecutionOutputStagingBindingV1,
  FoundationExecutionOutputStagingPlanV1,
  FoundationStagedExecutionOutputArtifactV1,
} from "../../src/foundation/execution/output-validation.js";
import {
  parseFoundationExecutionOutputStoreBindingV1,
  type FoundationExecutionOutputStoreDescriptorV1,
  type FoundationExecutionOutputStoreV1,
} from "../../src/foundation/execution/output-store-v1.js";
import {
  canonicalJson,
  canonicalJsonLine,
  digestCanonical,
  selfDigest,
  sha256Bytes,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";
import {
  digest,
  executionContractFixture,
  executionOutputFixture,
} from "../support/execution-contract-fixture.js";
import {
  InMemoryExecutionBackendEngine,
} from "../support/in-memory-execution-backend.js";

const RUNNER_DIGEST = digest("runner-implementation");

function clone<Value>(value: Value): Value {
  return JSON.parse(canonicalJson(value)) as Value;
}

function observationWithOutput(
  value: FoundationExecutionObservationV1,
  output: FoundationExecutionObservationV1["output"],
): FoundationExecutionObservationV1 {
  const subject = Object.freeze({
    ...clone(value),
    output: Object.freeze(output),
  });
  return Object.freeze({ ...subject, digest: selfDigest(subject, "digest") });
}

class MemoryCheckpointPersistence
implements FoundationExecutionOperationCheckpointPersistenceV1 {
  #retained: FoundationRetainedExecutionOperationCheckpointV1 | null = null;
  #failAfterCommit = false;

  failAfterNextCommit(): void {
    this.#failAfterCommit = true;
  }

  tamper(
    mutate: (checkpoint: Record<string, unknown>) => void,
  ): void {
    assert.notEqual(this.#retained, null);
    const checkpoint = clone(this.#retained!.checkpoint) as unknown as Record<string, unknown>;
    delete checkpoint.digest;
    mutate(checkpoint);
    checkpoint.digest = selfDigest(checkpoint);
    this.#retained = Object.freeze({
      coordinate: Object.freeze({
        revision: this.#retained!.coordinate.revision,
        checkpointDigest: checkpoint.digest as Sha256,
        persistenceDigest: this.#retained!.coordinate.persistenceDigest,
      }),
      checkpoint: Object.freeze(checkpoint) as unknown as FoundationExecutionOperationCheckpointV1,
    });
  }

  async read(
    _specificationDigest: Sha256,
  ): Promise<FoundationRetainedExecutionOperationCheckpointV1 | null> {
    if (this.#retained === null) return null;
    return clone(this.#retained);
  }

  async compareExchange(input: Readonly<{
    specificationDigest: Sha256;
    expected: FoundationExecutionOperationCheckpointCoordinateV1 | null;
    checkpoint: FoundationExecutionOperationCheckpointV1;
  }>): Promise<FoundationRetainedExecutionOperationCheckpointV1> {
    assert.equal(input.checkpoint.specificationDigest, input.specificationDigest);
    if (input.expected === null) {
      if (this.#retained !== null) throw new Error("injected checkpoint CAS conflict");
    } else if (this.#retained === null ||
        this.#retained.coordinate.revision !== input.expected.revision ||
        this.#retained.coordinate.checkpointDigest !== input.expected.checkpointDigest ||
        this.#retained.coordinate.persistenceDigest !== input.expected.persistenceDigest) {
      throw new Error("injected checkpoint CAS conflict");
    }
    const retained = Object.freeze({
      coordinate: Object.freeze({
        revision: (this.#retained?.coordinate.revision ?? 0) + 1,
        checkpointDigest: input.checkpoint.digest,
        persistenceDigest: digestCanonical({
          schema: "lifecycle.test.execution-checkpoint-persistence-coordinate.v1",
          revision: (this.#retained?.coordinate.revision ?? 0) + 1,
          checkpointDigest: input.checkpoint.digest,
        }),
      }),
      checkpoint: clone(input.checkpoint),
    });
    this.#retained = retained;
    if (this.#failAfterCommit) {
      this.#failAfterCommit = false;
      throw new Error("injected lost checkpoint response");
    }
    return clone(retained);
  }
}

function clock(start = Date.parse("2026-09-01T01:00:00.000Z")) {
  let current = start;
  return Object.freeze({
    now() {
      current += 1;
      return new Date(current).toISOString();
    },
  });
}

function staging() {
  type Stored = Readonly<{
    descriptor: FoundationExecutionOutputStoreDescriptorV1;
    manifestBytes: Uint8Array;
    chunks: readonly (readonly Uint8Array[])[];
  }>;
  const committed = new Map<string, Stored>();
  const stats = { begins: 0, commits: 0, aborts: 0, reopens: 0 };
  let failBegin = false;
  const owner: FoundationExecutionOutputStoreV1 = Object.freeze({
    async begin(input: Readonly<{
      plan: FoundationExecutionOutputStagingPlanV1;
      manifestBytes: Uint8Array;
    }>) {
      stats.begins += 1;
      if (failBegin) {
        failBegin = false;
        throw new Error("injected Output Store begin interruption");
      }
      const plan = input.plan;
      const manifestBytes = Uint8Array.from(input.manifestBytes);
      const transaction = new Map<number, readonly Uint8Array[]>();
      const stagedBindings = new Map<number, FoundationExecutionOutputStagingBindingV1>();
      let live = true;
      const artifact = (
        binding: FoundationExecutionOutputStagingBindingV1,
      ): FoundationStagedExecutionOutputArtifactV1 => Object.freeze({
        artifactIndex: binding.artifactIndex,
        bindingDigest: binding.bindingDigest,
        byteLength: binding.byteLength,
        digest: binding.digest,
        async *read() {
          const chunks = transaction.get(binding.artifactIndex);
          if (chunks === undefined) throw new Error("staged output is unavailable");
          for (const chunk of chunks) yield Uint8Array.from(chunk);
        },
      });
      return Object.freeze({
        async stage(input: FoundationExecutionOutputStagingBindingV1 & Readonly<{
          bytes: AsyncIterable<Uint8Array>;
        }>) {
          if (!live) throw new Error("staging transaction is closed");
          const chunks: Uint8Array[] = [];
          for await (const chunk of input.bytes) chunks.push(Uint8Array.from(chunk));
          transaction.set(input.artifactIndex, Object.freeze(chunks));
          stagedBindings.set(input.artifactIndex, Object.freeze({
            artifactIndex: input.artifactIndex,
            bindingDigest: input.bindingDigest,
            byteLength: input.byteLength,
            digest: input.digest,
          }));
          return artifact(input);
        },
        async commit() {
          if (!live) throw new Error("staging transaction is closed");
          const bindings = Object.freeze([...transaction.keys()]
            .sort((left, right) => left - right)
            .map((index) => stagedBindings.get(index)!));
          const descriptorSubject = Object.freeze({
            schema: "lifecycle.execution-output-store-descriptor.v1" as const,
            plan,
            manifest: Object.freeze({
              byteLength: manifestBytes.byteLength,
              digest: sha256Bytes(manifestBytes),
            }),
            artifacts: bindings,
            artifactInventoryDigest: digestCanonical(bindings),
          });
          const descriptor = Object.freeze({
            ...descriptorSubject,
            digest: selfDigest(descriptorSubject),
          });
          const descriptorBytes = Uint8Array.from(
            Buffer.from(canonicalJsonLine(descriptor), "utf8"),
          );
          const bindingSubject = Object.freeze({
            schema: "lifecycle.execution-output-store-binding.v1" as const,
            descriptor: Object.freeze({
              byteLength: descriptorBytes.byteLength,
              digest: sha256Bytes(descriptorBytes),
            }),
          });
          const binding = Object.freeze({
            ...bindingSubject,
            digest: selfDigest(bindingSubject),
          });
          committed.set(binding.digest, Object.freeze({
            descriptor,
            manifestBytes,
            chunks: Object.freeze(bindings.map((selected) =>
              Object.freeze((transaction.get(selected.artifactIndex) ?? [])
                .map((chunk) => Uint8Array.from(chunk))))),
          }));
          live = false;
          stats.commits += 1;
          return binding;
        },
        async abort() {
          live = false;
          transaction.clear();
          stats.aborts += 1;
        },
      });
    },
    async reopen(bindingValue) {
      stats.reopens += 1;
      const binding = parseFoundationExecutionOutputStoreBindingV1(bindingValue);
      const selected = committed.get(binding.digest);
      if (selected === undefined) throw new Error("stored output is unavailable");
      return Object.freeze({
        binding,
        descriptor: selected.descriptor,
        manifestBytes: Uint8Array.from(selected.manifestBytes),
        artifacts: Object.freeze(selected.descriptor.artifacts.map((artifact) => Object.freeze({
          ...artifact,
          async *read() {
            for (const chunk of selected.chunks[artifact.artifactIndex] ?? []) {
              yield Uint8Array.from(chunk);
            }
          },
        }))),
      });
    },
  });
  return Object.freeze({
    owner,
    stats,
    failNextBegin() {
      failBegin = true;
    },
  });
}

function host(input: Readonly<{
  engine: InMemoryExecutionBackendEngine;
  fixture: ReturnType<typeof executionContractFixture>;
  checkpoints: MemoryCheckpointPersistence;
  staging: ReturnType<typeof staging>;
  clock?: ReturnType<typeof clock>;
  backend?: FoundationExecutionBackend;
  observeTerminalCompletion?: FoundationExecutionOwnerTerminalCompletionV1;
}>) {
  return new FoundationExecutionOperationHostV1({
    backend: input.backend ?? input.engine.facade(input.fixture.profile),
    checkpoints: input.checkpoints,
    clock: input.clock ?? clock(),
    outputStore: input.staging.owner,
    observeTerminalCompletion: input.observeTerminalCompletion,
    createAllocationKey: (() =>
      `allocation-v1:${"ab".repeat(32)}` as FoundationExecutionAllocationKey),
  });
}

function authoritativelyAbsentBackend(input: Readonly<{
  engine: InMemoryExecutionBackendEngine;
  fixture: ReturnType<typeof executionContractFixture>;
}>) {
  const delegate = input.engine.facade(input.fixture.profile);
  let handle: FoundationExecutionHandle | null = null;
  let lastObservation: FoundationExecutionObservationV1 | null = null;
  let absent = false;
  const stats = { allocations: 0, dispatches: 0, reclaims: 0 };

  const observeAbsent = (): FoundationExecutionObservationV1 => {
    assert.notEqual(handle, null);
    const sequence = (lastObservation?.observationSequence ?? 0) + 1;
    const observedAt = new Date(
      Date.parse(lastObservation?.observedAt ?? "2026-09-01T00:00:00.000Z") + 1,
    ).toISOString();
    const subject = {
      schema: "lifecycle.execution-observation.v1" as const,
      specificationDigest: input.fixture.specification.digest,
      backendProfile: input.fixture.specification.backendProfile,
      imageDigest: input.fixture.specification.image.imageDigest,
      inputSetDigest: input.fixture.specification.inputSet.digest,
      observationSequence: sequence,
      observedAt,
      allocationState: "absent" as const,
      dispatchState: "not-observed" as const,
      processState: "not-observed" as const,
      terminal: null,
      containmentFacts: Object.freeze({
        rootProcess: "unverified" as const,
        descendants: "absent" as const,
        writers: "absent" as const,
        credentials: "not-injected" as const,
        providerChannel: "not-granted" as const,
        outputMutation: "impossible" as const,
      }),
      output: Object.freeze({
        disposition: "not-produced" as const,
        manifestDigest: null,
        carrierByteLength: null,
      }),
      resourceFacts: Object.freeze({
        wallTimeMilliseconds: null,
        cpuTimeMilliseconds: null,
        peakMemoryBytes: null,
        storageBytes: null,
        outputBytes: null,
        eventCount: null,
        limitBreaches: Object.freeze([]),
      }),
    };
    const observation = parseFoundationExecutionObservation({
      value: Object.freeze({ ...subject, digest: selfDigest(subject) }),
      specification: input.fixture.specification,
      previous: lastObservation,
    });
    lastObservation = observation;
    return observation;
  };

  const backend: FoundationExecutionBackend = Object.freeze({
    profile: delegate.profile,
    async allocate(
      specification: FoundationExecutionSpecificationV1,
      allocationKey: FoundationExecutionAllocationKey,
    ) {
      stats.allocations += 1;
      const allocatedHandle = await delegate.allocate(specification, allocationKey);
      handle = allocatedHandle;
      return allocatedHandle;
    },
    async dispatch(selectedHandle: FoundationExecutionHandle) {
      stats.dispatches += 1;
      if (absent) throw new Error("dispatch attempted for authoritatively absent allocation");
      const observation = await delegate.dispatch(selectedHandle);
      lastObservation = observation;
      return observation;
    },
    async observe(selectedHandle: FoundationExecutionHandle) {
      assert.equal(selectedHandle, handle);
      if (absent) return observeAbsent();
      const observation = await delegate.observe(selectedHandle);
      lastObservation = observation;
      return observation;
    },
    async cancel(selectedHandle: FoundationExecutionHandle) {
      assert.equal(selectedHandle, handle);
      if (absent) return observeAbsent();
      const observation = await delegate.cancel(selectedHandle);
      lastObservation = observation;
      return observation;
    },
    retrieve: delegate.retrieve.bind(delegate),
    async createReclamationBinding(
      bindingInput: Parameters<FoundationExecutionBackend["createReclamationBinding"]>[0],
    ) {
      return compileExecutionReclamationBinding({
        ...bindingInput,
        backendBinding: Object.freeze({
          schema: "lifecycle.execution-operation-host-absence-binding.private.v1",
          physicalIdentityDigest: digest("authoritative-absence-physical-binding"),
        }),
      });
    },
    async reclaim(
      specification: FoundationExecutionSpecificationV1,
      bindingValue: FoundationExecutionReclamationBindingV1,
      obligationValue: FoundationExecutionReclamationObligationV1,
    ) {
      const binding = parseExecutionReclamationBinding(bindingValue, specification);
      const selectedHandle = binding.handle;
      assert.equal(selectedHandle, handle);
      if (!absent) return delegate.reclaim(specification, binding, obligationValue);
      stats.reclaims += 1;
      const obligation = parseExecutionReclamationObligation(
        obligationValue,
        input.fixture.specification,
        binding,
      );
      return compileExecutionReclamationObservation({
        obligation,
        observedAt: new Date(
          Date.parse(lastObservation?.observedAt ?? "2026-09-01T00:00:00.000Z") + 1,
        ).toISOString(),
        disposition: "reclaimed",
        factsDigest: digestCanonical({
          obligationDigest: obligation.digest,
          allocationIdentityDigest: obligation.allocationIdentityDigest,
          physicalAllocationAbsent: true,
        }),
      });
    },
  });
  return Object.freeze({
    backend,
    stats,
    markAbsent() {
      assert.notEqual(handle, null);
      input.engine.removePhysicalAllocationWithoutObservation(handle!);
      absent = true;
    },
  });
}

async function openAndAllocate(input: Readonly<{
  operationHost: FoundationExecutionOperationHostV1;
  specification: ReturnType<typeof executionContractFixture>["specification"];
}>): Promise<FoundationRetainedExecutionOperationCheckpointV1> {
  const opened = await input.operationHost.advance({
    specification: input.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(opened.retained.checkpoint.handle, null);
  const allocated = await input.operationHost.advance({
    specification: input.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.notEqual(allocated.retained.checkpoint.handle, null);
  assert.equal(allocated.retained.checkpoint.dispatchAuthorityConsumedAt, null);
  assert.equal(allocated.retained.checkpoint.containment, null);
  return allocated.retained;
}

test("private operation facts compose allocation, dispatch, validation, Retirement, and Reclamation handoff", async () => {
  const fixture = executionContractFixture("operation-host-healthy");
  const engine = new InMemoryExecutionBackendEngine();
  const checkpoints = new MemoryCheckpointPersistence();
  const outputStaging = staging();
  const operationClock = clock();
  const operationHost = host({
    engine,
    fixture,
    checkpoints,
    staging: outputStaging,
    clock: operationClock,
  });
  await openAndAllocate({ operationHost, specification: fixture.specification });
  await engine.provideOutput(fixture.specification, executionOutputFixture(fixture.specification));

  const observed = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.notEqual(observed.retained.checkpoint.dispatchAuthorityConsumedAt, null);
  assert.equal(observed.retained.checkpoint.observation?.processState, "terminal");
  assert.notEqual(observed.retained.checkpoint.containment, null);
  assert.ok(
    observed.retained.checkpoint.containment!.establishedAt >=
      observed.retained.checkpoint.observation!.observedAt,
  );
  assert.equal(observed.retained.checkpoint.output, null);

  const retrieved = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(retrieved.validatedOutput?.manifest.digest,
    observed.retained.checkpoint.observation?.output.manifestDigest);
  assert.equal(retrieved.retained.checkpoint.output?.disposition, "complete");
  assert.equal(outputStaging.stats.commits, 1);
  assert.equal(Object.hasOwn(retrieved.retained.checkpoint, "stage"), false);
  assert.equal(Object.hasOwn(retrieved.retained.checkpoint, "phase"), false);
  assert.equal(Object.hasOwn(retrieved.retained.checkpoint, "status"), false);

  const retired = await operationHost.retire(fixture.specification);
  const retirement = retired.checkpoint.retirement;
  assert.notEqual(retirement, null);
  assert.equal(retirement?.dispatchAuthorityConsumed, true);
  assert.ok(retirement!.retiredAt >= retrieved.retained.checkpoint.output!.validatedAt!);
  assert.equal(retirement?.reclamationObligation.specificationDigest, fixture.specification.digest);
  assert.equal((await operationHost.retire(fixture.specification)).checkpoint.digest,
    retired.checkpoint.digest);
  const recoveredHost = host({
    engine,
    fixture,
    checkpoints,
    staging: outputStaging,
    clock: operationClock,
  });
  const reopenedAfterRetirement = await recoveredHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(
    reopenedAfterRetirement.validatedOutput?.manifest.digest,
    retrieved.validatedOutput?.manifest.digest,
  );
  assert.equal(reopenedAfterRetirement.retained.checkpoint.digest, retired.checkpoint.digest);
  assert.equal(outputStaging.stats.reopens, 1);

  const reclaimed = await engine.facade(fixture.profile).reclaim(
    fixture.specification,
    retirement!.reclamationBinding,
    retirement!.reclamationObligation,
  );
  assert.equal(parseExecutionReclamationObservation(
    reclaimed,
    fixture.specification,
    retirement!.reclamationObligation,
  ).disposition, "reclaimed");
  assert.equal(engine.productiveStartCount(fixture.specification.digest), 1);
});

test("lost terminal-completion commit response recovers before strict output validation without redispatch", async () => {
  const fixture = executionContractFixture("operation-host-terminal-completion-recovery");
  const engine = new InMemoryExecutionBackendEngine();
  const delegate = engine.facade(fixture.profile);
  let dispatches = 0;
  let observations = 0;
  let retrievals = 0;
  const backend: FoundationExecutionBackend = Object.freeze({
    profile: delegate.profile,
    allocate: delegate.allocate.bind(delegate),
    async dispatch(handle: FoundationExecutionHandle) {
      dispatches += 1;
      return await delegate.dispatch(handle);
    },
    async observe(handle: FoundationExecutionHandle) {
      observations += 1;
      return await delegate.observe(handle);
    },
    cancel: delegate.cancel.bind(delegate),
    async retrieve(
      handle: FoundationExecutionHandle,
      sourceObservation: FoundationExecutionObservationV1,
    ) {
      retrievals += 1;
      if (retrievals === 2) throw new Error("injected whole-Carrier retrieval interruption");
      return await delegate.retrieve(handle, sourceObservation);
    },
    createReclamationBinding: delegate.createReclamationBinding.bind(delegate),
    reclaim: delegate.reclaim.bind(delegate),
  });
  const checkpoints = new MemoryCheckpointPersistence();
  const outputStaging = staging();
  const operationClock = clock();
  const terminalValue = Object.freeze({
    schema: "lifecycle.test.execution-terminal-completion.v1",
    disposition: "observed",
  });
  let terminalObservations = 0;
  const observeTerminalCompletion: FoundationExecutionOwnerTerminalCompletionV1 = async (input) => {
    terminalObservations += 1;
    assert.equal(input.specification.digest, fixture.specification.digest);
    assert.equal(input.output.manifest.specificationDigest, fixture.specification.digest);
    return Object.freeze({ disposition: "observed" as const, value: terminalValue });
  };
  const operationHost = host({
    engine,
    fixture,
    checkpoints,
    staging: outputStaging,
    clock: operationClock,
    backend,
    observeTerminalCompletion,
  });
  await openAndAllocate({ operationHost, specification: fixture.specification });
  await engine.provideOutput(fixture.specification, executionOutputFixture(fixture.specification));

  const observed = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.notEqual(observed.retained.checkpoint.containment, null);
  assert.equal(observed.retained.checkpoint.terminalCompletion, null);
  assert.equal(observed.retained.checkpoint.output, null);
  assert.equal(dispatches, 1);
  assert.equal(retrievals, 0);

  checkpoints.failAfterNextCommit();
  await assert.rejects(
    operationHost.advance({
      specification: fixture.specification,
      runnerDigest: RUNNER_DIGEST,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.operation-host.persistence",
  );
  const terminalCommitted = await checkpoints.read(fixture.specification.digest);
  assert.notEqual(terminalCommitted, null);
  assert.equal(
    terminalCommitted!.coordinate.revision,
    observed.retained.coordinate.revision + 1,
  );
  assert.notEqual(terminalCommitted!.checkpoint.terminalCompletion, null);
  assert.equal(terminalCommitted!.checkpoint.terminalCompletion?.disposition, "observed");
  assert.deepEqual(terminalCommitted!.checkpoint.terminalCompletion?.value, terminalValue);
  assert.equal(terminalCommitted!.checkpoint.output, null);
  assert.equal(terminalObservations, 1);
  assert.equal(retrievals, 1);
  assert.equal(outputStaging.stats.begins, 0);
  assert.equal(outputStaging.stats.commits, 0);

  const recovered = host({
    engine,
    fixture,
    checkpoints,
    staging: outputStaging,
    clock: operationClock,
    backend,
    observeTerminalCompletion,
  });
  const observationDigest = terminalCommitted!.checkpoint.observation?.digest;
  const terminalCompletionDigest = terminalCommitted!.checkpoint.terminalCompletion?.digest;
  const observationsBeforeWholeCarrierRetrieval = observations;
  await assert.rejects(
    recovered.advance({
      specification: fixture.specification,
      runnerDigest: RUNNER_DIGEST,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.operation-host.backend-interrupted",
  );
  const retrievalInterrupted = await recovered.read(fixture.specification);
  assert.notEqual(retrievalInterrupted, null);
  assert.equal(
    retrievalInterrupted!.checkpoint.digest,
    terminalCommitted!.checkpoint.digest,
  );
  assert.equal(retrievalInterrupted!.checkpoint.observation?.digest, observationDigest);
  assert.equal(
    retrievalInterrupted!.checkpoint.terminalCompletion?.digest,
    terminalCompletionDigest,
  );
  assert.equal(retrievalInterrupted!.checkpoint.output, null);
  assert.equal(terminalObservations, 1);
  assert.equal(observations, observationsBeforeWholeCarrierRetrieval);
  assert.equal(dispatches, 1);
  assert.equal(retrievals, 2);

  const validated = await recovered.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.notEqual(validated.validatedOutput, null);
  assert.equal(validated.retained.checkpoint.output?.validation, "valid");
  assert.equal(
    validated.retained.coordinate.revision,
    terminalCommitted!.coordinate.revision + 1,
  );
  assert.equal(
    validated.retained.checkpoint.terminalCompletion?.digest,
    terminalCommitted!.checkpoint.terminalCompletion?.digest,
  );
  assert.equal(terminalObservations, 1);
  assert.equal(observations, observationsBeforeWholeCarrierRetrieval);
  assert.equal(retrievals, 3);
  assert.equal(outputStaging.stats.begins, 1);
  assert.equal(outputStaging.stats.commits, 1);
  assert.equal(dispatches, 1);
  assert.equal(engine.productiveStartCount(fixture.specification.digest), 1);

  const retired = await recovered.retire(fixture.specification);
  assert.notEqual(retired.checkpoint.retirement, null);
  assert.equal(
    retired.checkpoint.retirement?.terminalCompletionDigest,
    retired.checkpoint.terminalCompletion?.digest,
  );
  assert.equal(
    retired.checkpoint.retirement?.outputDigest,
    retired.checkpoint.output?.digest,
  );
  assert.equal(retired.checkpoint.retirement?.dispatchAuthorityConsumed, true);
  assert.equal(dispatches, 1);
  assert.equal(observations, observationsBeforeWholeCarrierRetrieval);
  assert.equal(retrievals, 3);
});

test("dependent Runtime facts cannot predate their direct Backend observation", async () => {
  const fixture = executionContractFixture("operation-host-causal-time");
  const engine = new InMemoryExecutionBackendEngine();
  const checkpoints = new MemoryCheckpointPersistence();
  const operationHost = host({ engine, fixture, checkpoints, staging: staging() });
  await openAndAllocate({ operationHost, specification: fixture.specification });
  await engine.provideOutput(fixture.specification, executionOutputFixture(fixture.specification));
  const observed = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.notEqual(observed.retained.checkpoint.containment, null);
  assert.notEqual(observed.retained.checkpoint.observation, null);

  checkpoints.tamper((checkpoint) => {
    const observation = checkpoint.observation as Record<string, unknown>;
    const containment = checkpoint.containment as Record<string, unknown>;
    containment.establishedAt = new Date(
      Date.parse(String(observation.observedAt)) - 1,
    ).toISOString();
    delete containment.digest;
    containment.digest = selfDigest(containment);
  });
  await assert.rejects(
    operationHost.read(fixture.specification),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.operation-host.checkpoint-substitution",
  );
});

test("lost allocation and dispatch responses recover the same Cell without redispatch", async () => {
  const allocationFixture = executionContractFixture("operation-host-allocation-loss");
  const allocationEngine = new InMemoryExecutionBackendEngine();
  const allocationCheckpoints = new MemoryCheckpointPersistence();
  const allocationStaging = staging();
  const allocationHost = host({
    engine: allocationEngine,
    fixture: allocationFixture,
    checkpoints: allocationCheckpoints,
    staging: allocationStaging,
  });
  await allocationHost.advance({
    specification: allocationFixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  allocationEngine.armFault("allocate-after-create-before-return");
  await assert.rejects(allocationHost.advance({
    specification: allocationFixture.specification,
    runnerDigest: RUNNER_DIGEST,
  }));
  const reopenedAllocation = host({
    engine: allocationEngine,
    fixture: allocationFixture,
    checkpoints: allocationCheckpoints,
    staging: allocationStaging,
  });
  const allocated = await reopenedAllocation.advance({
    specification: allocationFixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.notEqual(allocated.retained.checkpoint.handle, null);

  const dispatchFixture = executionContractFixture("operation-host-dispatch-loss");
  const dispatchEngine = new InMemoryExecutionBackendEngine();
  const dispatchCheckpoints = new MemoryCheckpointPersistence();
  const dispatchStaging = staging();
  const dispatchClock = clock();
  const dispatchHost = host({
    engine: dispatchEngine,
    fixture: dispatchFixture,
    checkpoints: dispatchCheckpoints,
    staging: dispatchStaging,
    clock: dispatchClock,
  });
  await openAndAllocate({ operationHost: dispatchHost, specification: dispatchFixture.specification });
  await dispatchEngine.provideOutput(
    dispatchFixture.specification,
    executionOutputFixture(dispatchFixture.specification),
  );
  dispatchEngine.armFault("dispatch-after-start-before-return");
  await assert.rejects(dispatchHost.advance({
    specification: dispatchFixture.specification,
    runnerDigest: RUNNER_DIGEST,
  }));
  assert.notEqual((await dispatchHost.read(dispatchFixture.specification))!
    .checkpoint.dispatchAuthorityConsumedAt, null);

  const reloadedEngine = InMemoryExecutionBackendEngine.reload(
    dispatchEngine.snapshot(),
    dispatchFixture.profile,
  );
  const recovered = host({
    engine: reloadedEngine,
    fixture: dispatchFixture,
    checkpoints: dispatchCheckpoints,
    staging: dispatchStaging,
    clock: dispatchClock,
  });
  const direct = await recovered.advance({
    specification: dispatchFixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(direct.retained.checkpoint.observation?.processState, "terminal");
  assert.notEqual(direct.retained.checkpoint.containment, null);
  assert.equal(reloadedEngine.productiveStartCount(dispatchFixture.specification.digest), 1);
  await recovered.advance({
    specification: dispatchFixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(reloadedEngine.productiveStartCount(dispatchFixture.specification.digest), 1);
});

test("terminal parent loss requests containment immediately and preserves the terminal fact", async () => {
  const fixture = executionContractFixture("operation-host-parent-loss-containment");
  const engine = new InMemoryExecutionBackendEngine();
  const delegate = engine.facade(fixture.profile);
  let dispatchCalls = 0;
  let cancelCalls = 0;
  const backend: FoundationExecutionBackend = Object.freeze({
    profile: delegate.profile,
    allocate: delegate.allocate.bind(delegate),
    async dispatch(handle: FoundationExecutionHandle) {
      dispatchCalls += 1;
      return await delegate.dispatch(handle);
    },
    async observe(handle: FoundationExecutionHandle) {
      const observation = await delegate.observe(handle);
      if (observation.terminal?.reason !== "parent-loss") return observation;
      const { digest: _digest, ...subject } = clone(observation);
      const residue = Object.freeze({
        ...subject,
        containmentFacts: Object.freeze({
          rootProcess: "terminal" as const,
          descendants: "present" as const,
          writers: "present" as const,
          credentials: "not-injected" as const,
          providerChannel: "not-granted" as const,
          outputMutation: "possible" as const,
        }),
      });
      return Object.freeze({
        ...residue,
        digest: selfDigest(residue),
      }) as FoundationExecutionObservationV1;
    },
    async cancel(handle: FoundationExecutionHandle) {
      cancelCalls += 1;
      return await delegate.cancel(handle);
    },
    retrieve: delegate.retrieve.bind(delegate),
    createReclamationBinding: delegate.createReclamationBinding.bind(delegate),
    reclaim: delegate.reclaim.bind(delegate),
  });
  const checkpoints = new MemoryCheckpointPersistence();
  const operationHost = host({
    engine,
    fixture,
    checkpoints,
    staging: staging(),
    backend,
  });
  await openAndAllocate({ operationHost, specification: fixture.specification });
  engine.holdOpen(fixture.specification.digest);
  const running = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(running.retained.checkpoint.observation?.processState, "running");
  engine.reportParentLoss(fixture.specification.digest);

  const lostParent = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(lostParent.retained.checkpoint.observation?.terminal?.reason, "parent-loss");
  assert.equal(lostParent.retained.checkpoint.containment, null);
  const terminal = lostParent.retained.checkpoint.observation?.terminal;

  const requested = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.notEqual(requested.retained.checkpoint.containmentRequestedAt, null);
  assert.equal(cancelCalls, 0);

  const contained = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(cancelCalls, 1);
  assert.deepEqual(contained.retained.checkpoint.observation?.terminal, terminal);
  assert.notEqual(contained.retained.checkpoint.containment, null);
  assert.equal(dispatchCalls, 1);
  assert.equal(engine.productiveStartCount(fixture.specification.digest), 1);
});

test("allocation preserves deterministic Backend refusals and masks uncertain failures", async () => {
  const fixture = executionContractFixture("operation-host-allocation-refusal");
  const engine = new InMemoryExecutionBackendEngine();
  const delegate = engine.facade(fixture.profile);
  let allocationFailure: unknown = new FoundationError(
    "lifecycle.execution.test-backend.allocation-duplicate",
    "Test Backend Specification already has another allocation",
  );
  const backend: FoundationExecutionBackend = Object.freeze({
    profile: delegate.profile,
    async allocate() {
      throw allocationFailure;
    },
    dispatch: delegate.dispatch.bind(delegate),
    observe: delegate.observe.bind(delegate),
    cancel: delegate.cancel.bind(delegate),
    retrieve: delegate.retrieve.bind(delegate),
    createReclamationBinding: delegate.createReclamationBinding.bind(delegate),
    reclaim: delegate.reclaim.bind(delegate),
  });
  const checkpoints = new MemoryCheckpointPersistence();
  const operationHost = host({
    engine,
    fixture,
    checkpoints,
    staging: staging(),
    backend,
  });
  await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });

  await assert.rejects(
    operationHost.advance({
      specification: fixture.specification,
      runnerDigest: RUNNER_DIGEST,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.test-backend.allocation-duplicate",
  );
  assert.equal((await operationHost.read(fixture.specification))?.checkpoint.handle, null);

  allocationFailure = new FoundationError(
    "lifecycle.execution.test-backend.engine-unavailable",
    "Test Backend direct allocation result is unavailable",
    { retryable: true },
  );
  await assert.rejects(
    operationHost.advance({
      specification: fixture.specification,
      runnerDigest: RUNNER_DIGEST,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.operation-host.backend-interrupted",
  );

  allocationFailure = new Error("private Backend interruption detail");
  await assert.rejects(
    operationHost.advance({
      specification: fixture.specification,
      runnerDigest: RUNNER_DIGEST,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.operation-host.backend-interrupted" &&
      !error.message.includes("private Backend interruption detail"),
  );
});

test("consumed authority plus a direct pre-entry observation retires inertly and never dispatches", async () => {
  const fixture = executionContractFixture("operation-host-pre-entry-loss");
  const engine = new InMemoryExecutionBackendEngine();
  const checkpoints = new MemoryCheckpointPersistence();
  const outputStaging = staging();
  const operationClock = clock();
  const operationHost = host({
    engine,
    fixture,
    checkpoints,
    staging: outputStaging,
    clock: operationClock,
  });
  await openAndAllocate({ operationHost, specification: fixture.specification });

  checkpoints.failAfterNextCommit();
  await assert.rejects(
    operationHost.advance({
      specification: fixture.specification,
      runnerDigest: RUNNER_DIGEST,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.operation-host.persistence",
  );
  assert.equal(engine.productiveStartCount(fixture.specification.digest), 0);

  const recovered = host({
    engine,
    fixture,
    checkpoints,
    staging: outputStaging,
    clock: operationClock,
  });
  const contained = await recovered.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(contained.retained.checkpoint.observation?.dispatchState, "not-observed");
  assert.equal(contained.retained.checkpoint.observation?.processState, "not-started");
  assert.equal(contained.retained.checkpoint.containment?.backendEffectObserved, false);
  assert.notEqual(contained.retained.checkpoint.dispatchAuthorityConsumedAt, null);
  assert.equal(engine.productiveStartCount(fixture.specification.digest), 0);

  const output = await recovered.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(output.retained.checkpoint.output?.disposition, "not-produced");
  const retired = await recovered.retire(fixture.specification);
  assert.equal(retired.checkpoint.retirement?.dispatchAuthorityConsumed, true);
  assert.equal(engine.productiveStartCount(fixture.specification.digest), 0);
});

test("Containment requested before dispatch retires the same allocation without consuming authority", async () => {
  const fixture = executionContractFixture("operation-host-cancel-before-dispatch");
  const engine = new InMemoryExecutionBackendEngine();
  const checkpoints = new MemoryCheckpointPersistence();
  const outputStaging = staging();
  const operationHost = host({ engine, fixture, checkpoints, staging: outputStaging });
  await openAndAllocate({ operationHost, specification: fixture.specification });

  const requested = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
    requestContainment: true,
  });
  assert.notEqual(requested.retained.checkpoint.containmentRequestedAt, null);
  assert.equal(requested.retained.checkpoint.dispatchAuthorityConsumedAt, null);

  const contained = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
    requestContainment: true,
  });
  assert.equal(contained.retained.checkpoint.observation?.dispatchState, "not-observed");
  assert.equal(contained.retained.checkpoint.observation?.processState, "not-started");
  assert.equal(contained.retained.checkpoint.containment?.backendEffectObserved, false);
  assert.equal(contained.retained.checkpoint.dispatchAuthorityConsumedAt, null);

  const output = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(output.retained.checkpoint.output?.disposition, "not-produced");
  const retired = await operationHost.retire(fixture.specification);
  assert.equal(retired.checkpoint.retirement?.dispatchAuthorityConsumed, false);
  assert.equal(engine.productiveStartCount(fixture.specification.digest), 0);
});

test("authoritative pre-dispatch absence retires as no-effect and is never recreated or dispatched", async () => {
  const fixture = executionContractFixture("operation-host-absent-before-dispatch");
  const engine = new InMemoryExecutionBackendEngine();
  const absent = authoritativelyAbsentBackend({ engine, fixture });
  const checkpoints = new MemoryCheckpointPersistence();
  const operationClock = clock();
  const operationHost = new FoundationExecutionOperationHostV1({
    backend: absent.backend,
    checkpoints,
    clock: operationClock,
    outputStore: staging().owner,
    createAllocationKey: (() =>
      `allocation-v1:${"ef".repeat(32)}` as FoundationExecutionAllocationKey),
  });
  await openAndAllocate({
    operationHost,
    specification: fixture.specification,
  });
  absent.markAbsent();

  const contained = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(contained.retained.checkpoint.observation?.allocationState, "absent");
  assert.equal(contained.retained.checkpoint.observation?.dispatchState, "not-observed");
  assert.equal(contained.retained.checkpoint.observation?.processState, "not-observed");
  assert.notEqual(contained.retained.checkpoint.containment, null);
  assert.equal(contained.retained.checkpoint.dispatchAuthorityConsumedAt, null);
  assert.equal(absent.stats.allocations, 1);
  assert.equal(absent.stats.dispatches, 0);

  const finalized = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(finalized.retained.checkpoint.output?.disposition, "not-produced");
  const retired = await operationHost.retire(fixture.specification);
  assert.equal(retired.checkpoint.retirement?.dispatchAuthorityConsumed, false);
  const reclaimed = await absent.backend.reclaim(
    fixture.specification,
    retired.checkpoint.retirement!.reclamationBinding,
    retired.checkpoint.retirement!.reclamationObligation,
  );
  assert.equal(parseExecutionReclamationObservation(
    reclaimed,
    fixture.specification,
    retired.checkpoint.retirement!.reclamationObligation,
  ).disposition, "reclaimed");
  assert.equal(absent.stats.reclaims, 1);
  assert.equal(absent.stats.allocations, 1);
  assert.equal(absent.stats.dispatches, 0);
  assert.equal(engine.productiveStartCount(fixture.specification.digest), 0);

  const consumedFixture = executionContractFixture("operation-host-absent-after-consumption");
  const consumedEngine = new InMemoryExecutionBackendEngine();
  const consumedAbsent = authoritativelyAbsentBackend({
    engine: consumedEngine,
    fixture: consumedFixture,
  });
  const consumedCheckpoints = new MemoryCheckpointPersistence();
  const consumedClock = clock();
  const consumedHost = new FoundationExecutionOperationHostV1({
    backend: consumedAbsent.backend,
    checkpoints: consumedCheckpoints,
    clock: consumedClock,
    outputStore: staging().owner,
    createAllocationKey: (() =>
      `allocation-v1:${"12".repeat(32)}` as FoundationExecutionAllocationKey),
  });
  await openAndAllocate({
    operationHost: consumedHost,
    specification: consumedFixture.specification,
  });
  consumedCheckpoints.failAfterNextCommit();
  await assert.rejects(
    consumedHost.advance({
      specification: consumedFixture.specification,
      runnerDigest: RUNNER_DIGEST,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.operation-host.persistence",
  );
  consumedAbsent.markAbsent();

  const recoveredConsumed = new FoundationExecutionOperationHostV1({
    backend: consumedAbsent.backend,
    checkpoints: consumedCheckpoints,
    clock: consumedClock,
    outputStore: staging().owner,
  });
  await assert.rejects(
    recoveredConsumed.advance({
      specification: consumedFixture.specification,
      runnerDigest: RUNNER_DIGEST,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.operation-host.containment-unavailable",
  );
  const refused = await recoveredConsumed.read(consumedFixture.specification);
  assert.notEqual(refused?.checkpoint.dispatchAuthorityConsumedAt, null);
  assert.equal(refused?.checkpoint.observation?.allocationState, "absent");
  assert.equal(refused?.checkpoint.containment, null);
  assert.equal(refused?.checkpoint.output, null);
  assert.equal(refused?.checkpoint.retirement, null);
  await assert.rejects(recoveredConsumed.retire(consumedFixture.specification));
  assert.equal(consumedAbsent.stats.allocations, 1);
  assert.equal(consumedAbsent.stats.dispatches, 0);
  assert.equal(consumedEngine.productiveStartCount(consumedFixture.specification.digest), 0);
});

test("ambiguous direct facts are retained but cannot establish Containment or Retirement", async () => {
  const fixture = executionContractFixture("operation-host-ambiguity");
  const engine = new InMemoryExecutionBackendEngine();
  const checkpoints = new MemoryCheckpointPersistence();
  const outputStaging = staging();
  const operationHost = host({ engine, fixture, checkpoints, staging: outputStaging });
  await openAndAllocate({ operationHost, specification: fixture.specification });
  engine.holdOpen(fixture.specification.digest);
  const running = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(running.retained.checkpoint.observation?.processState, "running");
  assert.equal(running.retained.checkpoint.containment, null);

  engine.armFault("observe-ambiguous");
  await assert.rejects(
    operationHost.advance({
      specification: fixture.specification,
      runnerDigest: RUNNER_DIGEST,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.operation-host.containment-ambiguous",
  );
  const ambiguous = await operationHost.read(fixture.specification);
  assert.equal(ambiguous?.checkpoint.observation?.processState, "ambiguous");
  assert.equal(ambiguous?.checkpoint.containment, null);
  await assert.rejects(
    operationHost.retire(fixture.specification),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.operation-host.checkpoint-order",
  );

  await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
    requestContainment: true,
  });
  const cancelled = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
    requestContainment: true,
  });
  assert.equal(cancelled.retained.checkpoint.observation?.processState, "terminal");
  assert.notEqual(cancelled.retained.checkpoint.containment, null);
  await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.notEqual((await operationHost.retire(fixture.specification)).checkpoint.retirement, null);
});

test("output-only ambiguity re-observes the same contained allocation before final disposition", async () => {
  const fixture = executionContractFixture("operation-host-output-ambiguity");
  const engine = new InMemoryExecutionBackendEngine();
  const delegate = engine.facade(fixture.profile);
  const backend: FoundationExecutionBackend = Object.freeze({
    profile: delegate.profile,
    allocate: delegate.allocate.bind(delegate),
    async dispatch(handle: FoundationExecutionHandle) {
      const observation = await delegate.dispatch(handle);
      return observationWithOutput(observation, Object.freeze({
        disposition: "ambiguous",
        manifestDigest: null,
        carrierByteLength: null,
      }));
    },
    observe: delegate.observe.bind(delegate),
    cancel: delegate.cancel.bind(delegate),
    retrieve: delegate.retrieve.bind(delegate),
    createReclamationBinding: delegate.createReclamationBinding.bind(delegate),
    reclaim: delegate.reclaim.bind(delegate),
  });
  const checkpoints = new MemoryCheckpointPersistence();
  const operationHost = new FoundationExecutionOperationHostV1({
    backend,
    checkpoints,
    clock: clock(),
    outputStore: staging().owner,
    createAllocationKey: (() =>
      `allocation-v1:${"45".repeat(32)}` as FoundationExecutionAllocationKey),
  });
  await openAndAllocate({ operationHost, specification: fixture.specification });

  await assert.rejects(
    operationHost.advance({
      specification: fixture.specification,
      runnerDigest: RUNNER_DIGEST,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.operation-host.containment-ambiguous",
  );
  const ambiguous = await operationHost.read(fixture.specification);
  assert.notEqual(ambiguous?.checkpoint.containment, null);
  assert.equal(ambiguous?.checkpoint.observation?.output.disposition, "ambiguous");
  assert.equal(ambiguous?.checkpoint.output, null);

  const observed = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(observed.retained.checkpoint.observation?.output.disposition, "not-produced");
  assert.equal(observed.retained.checkpoint.output, null);
  const finalized = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(finalized.retained.checkpoint.output?.disposition, "not-produced");
  assert.equal(finalized.retained.checkpoint.output?.validation, "not-applicable");
  assert.notEqual((await operationHost.retire(fixture.specification)).checkpoint.retirement, null);
});

test("deterministically invalid contained output is final and permits Retirement", async () => {
  const fixture = executionContractFixture("operation-host-invalid-output");
  const engine = new InMemoryExecutionBackendEngine();
  const delegate = engine.facade(fixture.profile);
  let retrievals = 0;
  const backend: FoundationExecutionBackend = Object.freeze({
    profile: delegate.profile,
    allocate: delegate.allocate.bind(delegate),
    dispatch: delegate.dispatch.bind(delegate),
    observe: delegate.observe.bind(delegate),
    cancel: delegate.cancel.bind(delegate),
    async retrieve(
      handle: FoundationExecutionHandle,
      sourceObservation: FoundationExecutionObservationV1,
    ): Promise<FoundationExecutionRetrievalOutcomeV1> {
      retrievals += 1;
      const retrieved = await delegate.retrieve(handle, sourceObservation);
      assert.equal(retrieved.disposition, "complete");
      return compileFoundationExecutionRetrievalOutcome({
        specification: fixture.specification,
        handle,
        observation: sourceObservation,
        disposition: "complete",
        output: Object.freeze({
          ...retrieved.output,
          manifest: Object.freeze({
            ...clone(retrieved.output.manifest),
            runnerDigest: digest("substituted-output-runner"),
          }),
        }),
      });
    },
    createReclamationBinding: delegate.createReclamationBinding.bind(delegate),
    reclaim: delegate.reclaim.bind(delegate),
  });
  const checkpoints = new MemoryCheckpointPersistence();
  const outputStaging = staging();
  const operationHost = new FoundationExecutionOperationHostV1({
    backend,
    checkpoints,
    clock: clock(),
    outputStore: outputStaging.owner,
    createAllocationKey: (() =>
      `allocation-v1:${"67".repeat(32)}` as FoundationExecutionAllocationKey),
  });
  await openAndAllocate({ operationHost, specification: fixture.specification });
  await engine.provideOutput(fixture.specification, executionOutputFixture(fixture.specification));
  await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });

  const invalid = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(invalid.validatedOutput, null);
  assert.equal(invalid.retained.checkpoint.output?.disposition, "complete");
  assert.equal(invalid.retained.checkpoint.output?.validation, "invalid");
  assert.notEqual(invalid.retained.checkpoint.output?.failureFactsDigest, null);
  assert.equal(outputStaging.stats.commits, 0);
  assert.equal(retrievals, 1);

  const reopened = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(reopened.validatedOutput, null);
  assert.equal(retrievals, 1);
  assert.notEqual((await operationHost.retire(fixture.specification)).checkpoint.retirement, null);
});

test("complete retrieval that substitutes its retained observation remains recoverable", async () => {
  const fixture = executionContractFixture("operation-host-retrieval-substitution");
  const engine = new InMemoryExecutionBackendEngine();
  const delegate = engine.facade(fixture.profile);
  const backend: FoundationExecutionBackend = Object.freeze({
    profile: delegate.profile,
    allocate: delegate.allocate.bind(delegate),
    dispatch: delegate.dispatch.bind(delegate),
    observe: delegate.observe.bind(delegate),
    cancel: delegate.cancel.bind(delegate),
    async retrieve(
      handle: FoundationExecutionHandle,
      sourceObservation: FoundationExecutionObservationV1,
    ) {
      const retrieved = await delegate.retrieve(handle, sourceObservation);
      assert.equal(retrieved.disposition, "complete");
      return Object.freeze({
        ...retrieved,
        output: Object.freeze({
          ...retrieved.output,
          carrierByteLength: retrieved.output.carrierByteLength + 1,
        }),
      });
    },
    createReclamationBinding: delegate.createReclamationBinding.bind(delegate),
    reclaim: delegate.reclaim.bind(delegate),
  });
  const checkpoints = new MemoryCheckpointPersistence();
  const outputStore = staging();
  const operationHost = new FoundationExecutionOperationHostV1({
    backend,
    checkpoints,
    clock: clock(),
    outputStore: outputStore.owner,
    createAllocationKey: (() =>
      `allocation-v1:${"68".repeat(32)}` as FoundationExecutionAllocationKey),
  });
  await openAndAllocate({ operationHost, specification: fixture.specification });
  await engine.provideOutput(fixture.specification, executionOutputFixture(fixture.specification));
  const observed = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });

  await assert.rejects(
    operationHost.advance({
      specification: fixture.specification,
      runnerDigest: RUNNER_DIGEST,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.operation-host.backend-substitution",
  );
  const retained = await operationHost.read(fixture.specification);
  assert.equal(retained?.checkpoint.digest, observed.retained.checkpoint.digest);
  assert.equal(retained?.checkpoint.output, null);
  assert.equal(outputStore.stats.begins, 0);
});

test("an exact short read from retained complete output finalizes unavailable", async () => {
  const fixture = executionContractFixture("operation-host-partial-retrieval");
  const engine = new InMemoryExecutionBackendEngine();
  const delegate = engine.facade(fixture.profile);
  let retrievals = 0;
  const backend: FoundationExecutionBackend = Object.freeze({
    profile: delegate.profile,
    allocate: delegate.allocate.bind(delegate),
    dispatch: delegate.dispatch.bind(delegate),
    observe: delegate.observe.bind(delegate),
    cancel: delegate.cancel.bind(delegate),
    async retrieve(
      handle: FoundationExecutionHandle,
      sourceObservation: FoundationExecutionObservationV1,
    ) {
      retrievals += 1;
      const retrieved = await delegate.retrieve(handle, sourceObservation);
      assert.equal(retrieved.disposition, "complete");
      const output = retrieved.output;
      return Object.freeze({
        ...retrieved,
        output: Object.freeze({
          ...output,
          async *entries() {
            let first = true;
            for await (const reader of output.entries()) {
              if (!first) {
                yield reader;
                continue;
              }
              first = false;
              yield Object.freeze({
                ...reader,
                async *read() {
                  for await (const chunk of reader.read()) {
                    if (chunk.byteLength > 1) yield Uint8Array.from(chunk.subarray(0, -1));
                    break;
                  }
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
  const checkpoints = new MemoryCheckpointPersistence();
  const outputStore = staging();
  const operationHost = new FoundationExecutionOperationHostV1({
    backend,
    checkpoints,
    clock: clock(),
    outputStore: outputStore.owner,
    createAllocationKey: (() =>
      `allocation-v1:${"69".repeat(32)}` as FoundationExecutionAllocationKey),
  });
  await openAndAllocate({ operationHost, specification: fixture.specification });
  await engine.provideOutput(fixture.specification, executionOutputFixture(fixture.specification));
  await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });

  const unavailable = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(unavailable.validatedOutput, null);
  assert.equal(unavailable.retained.checkpoint.output?.disposition, "complete");
  assert.equal(unavailable.retained.checkpoint.output?.validation, "unavailable");
  assert.notEqual(unavailable.retained.checkpoint.output?.failureFactsDigest, null);
  assert.equal(outputStore.stats.aborts, 1);
  assert.equal(outputStore.stats.commits, 0);
  assert.equal(retrievals, 1);
  await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(retrievals, 1);
});

test("direct missing, partial, and unavailable output facts finalize unavailable without retrieval", async () => {
  for (const disposition of ["missing", "partial", "unavailable"] as const) {
    const fixture = executionContractFixture(`operation-host-direct-${disposition}`);
    const engine = new InMemoryExecutionBackendEngine();
    const delegate = engine.facade(fixture.profile);
    let retrievals = 0;
    const backend: FoundationExecutionBackend = Object.freeze({
      profile: delegate.profile,
      allocate: delegate.allocate.bind(delegate),
      async dispatch(handle: FoundationExecutionHandle) {
        return observationWithOutput(
          await delegate.dispatch(handle),
          Object.freeze({ disposition, manifestDigest: null, carrierByteLength: null }),
        );
      },
      observe: delegate.observe.bind(delegate),
      cancel: delegate.cancel.bind(delegate),
      async retrieve(
        handle: FoundationExecutionHandle,
        sourceObservation: FoundationExecutionObservationV1,
      ) {
        retrievals += 1;
        return delegate.retrieve(handle, sourceObservation);
      },
      createReclamationBinding: delegate.createReclamationBinding.bind(delegate),
      reclaim: delegate.reclaim.bind(delegate),
    });
    const operationHost = new FoundationExecutionOperationHostV1({
      backend,
      checkpoints: new MemoryCheckpointPersistence(),
      clock: clock(),
      outputStore: staging().owner,
      createAllocationKey: (() =>
        `allocation-v1:${"79".repeat(32)}` as FoundationExecutionAllocationKey),
    });
    await openAndAllocate({ operationHost, specification: fixture.specification });
    await engine.provideOutput(fixture.specification, executionOutputFixture(fixture.specification));
    const observed = await operationHost.advance({
      specification: fixture.specification,
      runnerDigest: RUNNER_DIGEST,
    });
    assert.equal(observed.retained.checkpoint.observation?.output.disposition, disposition);
    const finalized = await operationHost.advance({
      specification: fixture.specification,
      runnerDigest: RUNNER_DIGEST,
    });
    assert.equal(finalized.retained.checkpoint.output?.validation, "unavailable");
    assert.notEqual(finalized.retained.checkpoint.output?.failureFactsDigest, null);
    assert.equal(retrievals, 0);
  }
});

test("typed transport loss from a retained complete observation finalizes unavailable", async () => {
  const fixture = executionContractFixture("operation-host-typed-output-loss");
  const engine = new InMemoryExecutionBackendEngine();
  const delegate = engine.facade(fixture.profile);
  let retrievals = 0;
  const backend: FoundationExecutionBackend = Object.freeze({
    profile: delegate.profile,
    allocate: delegate.allocate.bind(delegate),
    dispatch: delegate.dispatch.bind(delegate),
    observe: delegate.observe.bind(delegate),
    cancel: delegate.cancel.bind(delegate),
    async retrieve(
      handle: FoundationExecutionHandle,
      sourceObservation: FoundationExecutionObservationV1,
    ) {
      retrievals += 1;
      return compileFoundationExecutionRetrievalOutcome({
        specification: fixture.specification,
        handle,
        observation: sourceObservation,
        disposition: "unavailable",
        unavailableReason: "lost",
      });
    },
    createReclamationBinding: delegate.createReclamationBinding.bind(delegate),
    reclaim: delegate.reclaim.bind(delegate),
  });
  const checkpoints = new MemoryCheckpointPersistence();
  const outputStore = staging();
  let terminalObservations = 0;
  const operationHost = new FoundationExecutionOperationHostV1({
    backend,
    checkpoints,
    clock: clock(),
    outputStore: outputStore.owner,
    observeTerminalCompletion: async () => {
      terminalObservations += 1;
      return Object.freeze({
        disposition: "observed" as const,
        value: Object.freeze({ schema: "lifecycle.test.unexpected-terminal.v1" }),
      });
    },
    createAllocationKey: (() =>
      `allocation-v1:${"78".repeat(32)}` as FoundationExecutionAllocationKey),
  });
  await openAndAllocate({ operationHost, specification: fixture.specification });
  await engine.provideOutput(fixture.specification, executionOutputFixture(fixture.specification));
  const observed = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(observed.retained.checkpoint.observation?.output.disposition, "complete");

  const unavailable = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(unavailable.validatedOutput, null);
  assert.equal(unavailable.retained.checkpoint.output?.disposition, "complete");
  assert.equal(unavailable.retained.checkpoint.output?.validation, "unavailable");
  assert.notEqual(unavailable.retained.checkpoint.output?.failureFactsDigest, null);
  assert.equal(unavailable.retained.checkpoint.output?.outputStoreBinding, null);
  assert.equal(unavailable.retained.checkpoint.terminalCompletion, null);
  assert.equal(outputStore.stats.begins, 0);
  assert.equal(terminalObservations, 0);
  assert.equal(retrievals, 1);
  await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(retrievals, 1);
  const retired = await operationHost.retire(fixture.specification);
  assert.notEqual(retired.checkpoint.retirement, null);
  assert.equal(retired.checkpoint.retirement?.terminalCompletionDigest, null);
});

test("transient Output Store interruption retains no final output and retries", async () => {
  const fixture = executionContractFixture("operation-host-output-store-interruption");
  const engine = new InMemoryExecutionBackendEngine();
  const checkpoints = new MemoryCheckpointPersistence();
  const outputStore = staging();
  const operationHost = host({ engine, fixture, checkpoints, staging: outputStore });
  await openAndAllocate({ operationHost, specification: fixture.specification });
  await engine.provideOutput(fixture.specification, executionOutputFixture(fixture.specification));
  const observed = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  outputStore.failNextBegin();
  await assert.rejects(
    operationHost.advance({
      specification: fixture.specification,
      runnerDigest: RUNNER_DIGEST,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.output-validation.staging-begin",
  );
  const interrupted = await operationHost.read(fixture.specification);
  assert.equal(interrupted?.checkpoint.digest, observed.retained.checkpoint.digest);
  assert.equal(interrupted?.checkpoint.output, null);

  const valid = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(valid.retained.checkpoint.output?.validation, "valid");
  assert.notEqual(valid.retained.checkpoint.output?.outputStoreBinding, null);
  assert.notEqual(valid.validatedOutput, null);
  assert.equal(outputStore.stats.begins, 2);
  assert.equal(outputStore.stats.commits, 1);
});

test("lost retrieval is re-observed and can finalize as exact unavailable output", async () => {
  const fixture = executionContractFixture("operation-host-lost-output");
  const engine = new InMemoryExecutionBackendEngine();
  const delegate = engine.facade(fixture.profile);
  let retrievalFailed = false;
  const backend: FoundationExecutionBackend = Object.freeze({
    profile: delegate.profile,
    allocate: delegate.allocate.bind(delegate),
    dispatch: delegate.dispatch.bind(delegate),
    async observe(handle: FoundationExecutionHandle) {
      const observation = await delegate.observe(handle);
      return retrievalFailed
        ? observationWithOutput(observation, Object.freeze({
            disposition: "unavailable",
            manifestDigest: null,
            carrierByteLength: null,
          }))
        : observation;
    },
    cancel: delegate.cancel.bind(delegate),
    async retrieve(
      _handle: FoundationExecutionHandle,
      _sourceObservation: FoundationExecutionObservationV1,
    ): Promise<FoundationExecutionRetrievalOutcomeV1> {
      retrievalFailed = true;
      throw new Error("injected lost contained output");
    },
    createReclamationBinding: delegate.createReclamationBinding.bind(delegate),
    reclaim: delegate.reclaim.bind(delegate),
  });
  const checkpoints = new MemoryCheckpointPersistence();
  const operationHost = new FoundationExecutionOperationHostV1({
    backend,
    checkpoints,
    clock: clock(),
    outputStore: staging().owner,
    createAllocationKey: (() =>
      `allocation-v1:${"89".repeat(32)}` as FoundationExecutionAllocationKey),
  });
  await openAndAllocate({ operationHost, specification: fixture.specification });
  await engine.provideOutput(fixture.specification, executionOutputFixture(fixture.specification));
  await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });

  const unavailable = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(unavailable.retained.checkpoint.observation?.output.disposition, "unavailable");
  assert.equal(unavailable.retained.checkpoint.output, null);
  const finalized = await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(finalized.retained.checkpoint.output?.disposition, "unavailable");
  assert.equal(finalized.retained.checkpoint.output?.validation, "unavailable");
  assert.notEqual((await operationHost.retire(fixture.specification)).checkpoint.retirement, null);
});

test("validated Output recovery reopens exact bytes after a lost checkpoint response", async () => {
  const fixture = executionContractFixture("operation-host-output-recovery");
  const engine = new InMemoryExecutionBackendEngine();
  const checkpoints = new MemoryCheckpointPersistence();
  const outputStaging = staging();
  const operationClock = clock();
  const delegate = engine.facade(fixture.profile);
  let retrievals = 0;
  const backend: FoundationExecutionBackend = Object.freeze({
    profile: delegate.profile,
    allocate: delegate.allocate.bind(delegate),
    dispatch: delegate.dispatch.bind(delegate),
    observe: delegate.observe.bind(delegate),
    cancel: delegate.cancel.bind(delegate),
    async retrieve(
      handle: FoundationExecutionHandle,
      sourceObservation: FoundationExecutionObservationV1,
    ) {
      retrievals += 1;
      return delegate.retrieve(handle, sourceObservation);
    },
    createReclamationBinding: delegate.createReclamationBinding.bind(delegate),
    reclaim: delegate.reclaim.bind(delegate),
  });
  const operationHost = host({
    engine,
    fixture,
    checkpoints,
    staging: outputStaging,
    clock: operationClock,
    backend,
  });
  await openAndAllocate({ operationHost, specification: fixture.specification });
  await engine.provideOutput(fixture.specification, executionOutputFixture(fixture.specification));
  await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });

  checkpoints.failAfterNextCommit();
  await assert.rejects(operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  }));
  assert.equal(outputStaging.stats.commits, 1);
  const retained = await operationHost.read(fixture.specification);
  assert.equal(retained?.checkpoint.output?.disposition, "complete");
  assert.notEqual(retained?.checkpoint.output?.outputStoreBinding, null);
  assert.equal(retrievals, 1);
  const handle = retained!.checkpoint.handle!;
  engine.removePhysicalAllocationWithoutObservation(handle);
  assert.throws(() => engine.activeCell(handle));

  const recovered = host({
    engine,
    fixture,
    checkpoints,
    staging: outputStaging,
    clock: operationClock,
    backend,
  });
  const reopened = await recovered.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.notEqual(reopened.validatedOutput, null);
  assert.equal(outputStaging.stats.commits, 1);
  assert.equal(outputStaging.stats.reopens, 1);
  assert.equal(retrievals, 1);
  await assert.rejects(
    recovered.advance({
      specification: fixture.specification,
      runnerDigest: digest("substituted-runner"),
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.operation-host.output-substitution",
  );
});

test("checkpoint and Backend substitutions fail closed before productive use", async () => {
  const fixture = executionContractFixture("operation-host-substitution");
  const engine = new InMemoryExecutionBackendEngine();
  const checkpoints = new MemoryCheckpointPersistence();
  const outputStaging = staging();
  const operationHost = host({ engine, fixture, checkpoints, staging: outputStaging });
  await operationHost.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  checkpoints.tamper((checkpoint) => {
    checkpoint.specificationDigest = digest("substituted-checkpoint-specification");
  });
  await assert.rejects(
    operationHost.read(fixture.specification),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.operation-host.checkpoint-substitution",
  );

  const selected = executionContractFixture("operation-host-selected-handle");
  const substituted = executionContractFixture("operation-host-substituted-handle");
  const substitutionEngine = new InMemoryExecutionBackendEngine();
  const delegate = substitutionEngine.facade(selected.profile);
  const substitutedHandle = await delegate.allocate(
    substituted.specification,
    createFoundationExecutionAllocationKey(),
  );
  const backend: FoundationExecutionBackend = Object.freeze({
    profile: delegate.profile,
    async allocate() {
      return substitutedHandle;
    },
    dispatch: delegate.dispatch.bind(delegate),
    observe: delegate.observe.bind(delegate),
    cancel: delegate.cancel.bind(delegate),
    retrieve: delegate.retrieve.bind(delegate),
    createReclamationBinding: delegate.createReclamationBinding.bind(delegate),
    reclaim: delegate.reclaim.bind(delegate),
  });
  const substitutedHost = new FoundationExecutionOperationHostV1({
    backend,
    checkpoints: new MemoryCheckpointPersistence(),
    clock: clock(),
    outputStore: staging().owner,
    createAllocationKey: (() =>
      `allocation-v1:${"cd".repeat(32)}` as FoundationExecutionAllocationKey),
  });
  await substitutedHost.advance({
    specification: selected.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  await assert.rejects(
    substitutedHost.advance({
      specification: selected.specification,
      runnerDigest: RUNNER_DIGEST,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.contract-invalid",
  );
  assert.equal(substitutionEngine.productiveStartCount(selected.specification.digest), 0);
  assert.equal(substitutionEngine.productiveStartCount(substituted.specification.digest), 0);
});
