import assert from "node:assert/strict";
import test from "node:test";
import { FoundationError } from "../../src/foundation/error.js";
import {
  createFoundationExecutionAllocationKey,
  foundationExecutionAllocationKeyBindingDigest,
  privateFoundationExecutionHandle,
} from "../../src/foundation/execution/backend.js";
import {
  parseFoundationExecutionObservation,
  type FoundationExecutionObservationV1,
} from "../../src/foundation/execution/contracts.js";
import {
  FoundationDockerExecutionBindingRegistryV1,
} from "../../src/foundation/execution/docker-binding-registry-v1.js";
import {
  FOUNDATION_EXECUTION_OPERATION_CHECKPOINT_SCHEMA,
  type FoundationExecutionOperationCheckpointPersistenceV1,
  type FoundationExecutionOperationCheckpointV1,
  type FoundationRetainedExecutionOperationCheckpointV1,
} from "../../src/foundation/execution/operation-host.js";
import {
  digestCanonical,
  selfDigest,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";
import {
  executionContractFixture,
} from "../support/execution-contract-fixture.js";

const CELL_ID = "c".repeat(64);
const HANDLE = privateFoundationExecutionHandle(`execution-handle-v1:${CELL_ID}`);
const ALLOCATION_KEY = createFoundationExecutionAllocationKey();
const ENGINE_DIGEST = digestCanonical({ engine: "binding-registry-test" });

function observation(
  specification: ReturnType<typeof executionContractFixture>["specification"],
  sequence: number,
): FoundationExecutionObservationV1 {
  const subject = Object.freeze({
    schema: "lifecycle.execution-observation.v1" as const,
    specificationDigest: specification.digest,
    backendProfile: specification.backendProfile,
    imageDigest: specification.image.imageDigest,
    inputSetDigest: specification.inputSet.digest,
    observationSequence: sequence,
    observedAt: new Date(Date.parse("2026-09-01T12:00:00.000Z") + sequence).toISOString(),
    allocationState: "allocated" as const,
    dispatchState: "not-observed" as const,
    processState: "not-started" as const,
    terminal: null,
    containmentFacts: Object.freeze({
      rootProcess: "not-started" as const,
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
  });
  return parseFoundationExecutionObservation({
    value: Object.freeze({ ...subject, digest: selfDigest(subject) }),
    specification,
  });
}

function checkpoint(
  specification: ReturnType<typeof executionContractFixture>["specification"],
  sequence: number,
): FoundationExecutionOperationCheckpointV1 {
  const subject = Object.freeze({
    schema: FOUNDATION_EXECUTION_OPERATION_CHECKPOINT_SCHEMA,
    specificationDigest: specification.digest,
    backendProfile: specification.backendProfile,
    openedAt: "2026-09-01T11:59:59.000Z",
    allocationKey: ALLOCATION_KEY,
    handle: HANDLE,
    dispatchAuthorityConsumedAt: "2026-09-01T12:00:00.000Z",
    containmentRequestedAt: null,
    observation: observation(specification, sequence),
    containment: null,
    terminalCompletion: null,
    output: null,
    retirement: null,
  });
  return Object.freeze({ ...subject, digest: selfDigest(subject) });
}

class RetainedCheckpoint implements FoundationExecutionOperationCheckpointPersistenceV1 {
  #value: FoundationRetainedExecutionOperationCheckpointV1;

  constructor(
    readonly specification: ReturnType<typeof executionContractFixture>["specification"],
    sequence: number,
  ) {
    this.#value = this.#retained(sequence);
  }

  #retained(sequence: number): FoundationRetainedExecutionOperationCheckpointV1 {
    const selected = checkpoint(this.specification, sequence);
    return Object.freeze({
      coordinate: Object.freeze({
        revision: sequence,
        checkpointDigest: selected.digest,
        persistenceDigest: digestCanonical({ sequence, checkpointDigest: selected.digest }),
      }),
      checkpoint: selected,
    });
  }

  retain(sequence: number): void {
    this.#value = this.#retained(sequence);
  }

  async read(specificationDigest: Sha256) {
    assert.equal(specificationDigest, this.specification.digest);
    return this.#value;
  }

  async compareExchange(): Promise<FoundationRetainedExecutionOperationCheckpointV1> {
    throw new Error("binding-registry test persistence is read-only");
  }
}

test("Docker binding recovery resolves one durable Handle and resumes observation sequencing after restart", async () => {
  const fixture = executionContractFixture("docker-binding-registry-restart");
  const persistence = new RetainedCheckpoint(fixture.specification, 7);
  const first = new FoundationDockerExecutionBindingRegistryV1();
  const release = first.register({
    specification: fixture.specification,
    engineIdentityDigest: ENGINE_DIGEST,
    persistence,
  });

  const binding = await first.resolve(HANDLE);
  assert.notEqual(binding, null);
  assert.equal(binding!.specification.digest, fixture.specification.digest);
  assert.equal(binding!.allocationKeyDigest,
    foundationExecutionAllocationKeyBindingDigest(ALLOCATION_KEY));
  assert.equal(binding!.engineIdentityDigest, ENGINE_DIGEST);
  assert.equal(binding!.dispatchAuthorityConsumed, true);
  assert.equal(binding!.retainedObservationSequence, 7);
  assert.equal(binding!.retirementCheckpointDigest, null);
  assert.equal(await first.observationSequence.next(CELL_ID), 8);
  assert.equal(await first.observationSequence.next(CELL_ID), 9);

  persistence.retain(8);
  release();
  assert.equal(await first.resolve(HANDLE), null);
  const restarted = new FoundationDockerExecutionBindingRegistryV1();
  restarted.register({
    specification: fixture.specification,
    engineIdentityDigest: ENGINE_DIGEST,
    persistence,
  });
  assert.equal(await restarted.observationSequence.next(CELL_ID), 9);
  assert.equal(await restarted.resolve(
    privateFoundationExecutionHandle(`execution-handle-v1:${"d".repeat(64)}`),
  ), null);
});

test("released Docker bindings no longer read the previous operation checkpoint", async () => {
  const firstFixture = executionContractFixture("docker-binding-registry-first");
  const secondFixture = executionContractFixture("docker-binding-registry-second");
  assert.notEqual(firstFixture.specification.digest, secondFixture.specification.digest);
  const firstPersistence = new RetainedCheckpoint(firstFixture.specification, 7);
  const secondPersistence = new RetainedCheckpoint(secondFixture.specification, 17);
  const registry = new FoundationDockerExecutionBindingRegistryV1();
  let previousCheckpointIsCurrent = true;
  let firstReads = 0;
  const release = registry.register({
    specification: firstFixture.specification,
    engineIdentityDigest: ENGINE_DIGEST,
    persistence: {
      read: async (specificationDigest) => {
        firstReads += 1;
        assert.equal(previousCheckpointIsCurrent, true,
          "the previous operation must not read the next operation's checkpoint");
        return firstPersistence.read(specificationDigest);
      },
      compareExchange: () => firstPersistence.compareExchange(),
    },
  });
  assert.equal((await registry.resolve(HANDLE))!.retainedObservationSequence, 7);
  assert.equal(firstReads, 1);

  release();
  release();
  previousCheckpointIsCurrent = false;
  registry.register({
    specification: secondFixture.specification,
    engineIdentityDigest: ENGINE_DIGEST,
    persistence: secondPersistence,
  });
  const binding = await registry.resolve(HANDLE);
  assert.equal(binding!.specification.digest, secondFixture.specification.digest);
  assert.equal(binding!.retainedObservationSequence, 17);
  assert.equal(await registry.observationSequence.next(CELL_ID), 18);
  assert.equal(firstReads, 1);
});

test("releasing an earlier Docker binding preserves its exact-Specification replacement", async () => {
  const fixture = executionContractFixture("docker-binding-registry-replacement");
  const registry = new FoundationDockerExecutionBindingRegistryV1();
  const releaseEarlier = registry.register({
    specification: fixture.specification,
    engineIdentityDigest: ENGINE_DIGEST,
    persistence: new RetainedCheckpoint(fixture.specification, 7),
  });
  const releaseReplacement = registry.register({
    specification: fixture.specification,
    engineIdentityDigest: ENGINE_DIGEST,
    persistence: new RetainedCheckpoint(fixture.specification, 17),
  });

  releaseEarlier();
  releaseEarlier();
  assert.equal((await registry.resolve(HANDLE))!.retainedObservationSequence, 17);
  assert.equal(await registry.observationSequence.next(CELL_ID), 18);
  releaseReplacement();
  releaseReplacement();
  assert.equal(await registry.resolve(HANDLE), null);
});

test("active Docker binding checkpoint refusals remain conclusive until that registration is released", async () => {
  const fixture = executionContractFixture("docker-binding-registry-checkpoint-refusal");
  const persistence = new RetainedCheckpoint(fixture.specification, 7);
  const registry = new FoundationDockerExecutionBindingRegistryV1();
  const refusal = new FoundationError(
    "lifecycle.check-operation-v7.substitution",
    "Retained Check Cell checkpoint differs from the exact proof obligation",
  );
  let substituted = false;
  const release = registry.register({
    specification: fixture.specification,
    engineIdentityDigest: ENGINE_DIGEST,
    persistence: {
      read: async (specificationDigest) => {
        if (substituted) throw refusal;
        return persistence.read(specificationDigest);
      },
      compareExchange: () => persistence.compareExchange(),
    },
  });
  assert.equal((await registry.resolve(HANDLE))!.retainedObservationSequence, 7);
  substituted = true;
  await assert.rejects(registry.resolve(HANDLE), (error: unknown) => error === refusal);
  await assert.rejects(registry.observationSequence.next(CELL_ID),
    (error: unknown) => error === refusal);

  release();
  assert.equal(await registry.resolve(HANDLE), null);
  registry.register({
    specification: fixture.specification,
    engineIdentityDigest: ENGINE_DIGEST,
    persistence,
  });
  assert.equal(await registry.observationSequence.next(CELL_ID), 8);
});
