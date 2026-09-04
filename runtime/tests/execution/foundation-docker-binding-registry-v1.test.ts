import assert from "node:assert/strict";
import test from "node:test";
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
  first.register({
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
