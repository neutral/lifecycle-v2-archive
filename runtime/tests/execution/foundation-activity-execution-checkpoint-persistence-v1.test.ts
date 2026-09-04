import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTROL_RECORD_OPERATION_SUPPORT_SCHEMA,
  type ControlJsonObject,
  type ControlRecordStoreAppend,
} from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import {
  createFoundationActivityExecutionCheckpointPersistenceV1,
} from "../../src/foundation/execution/activity-checkpoint-persistence-v1.js";
import type {
  FoundationExecutionAllocationKey,
  FoundationExecutionBackend,
} from "../../src/foundation/execution/backend.js";
import {
  FoundationExecutionOperationHostV1,
  parseFoundationExecutionOperationCheckpoint,
  type FoundationExecutionOperationCheckpointCoordinateV1,
  type FoundationExecutionOperationCheckpointPersistenceV1,
  type FoundationExecutionOperationCheckpointV1,
  type FoundationRetainedExecutionOperationCheckpointV1,
} from "../../src/foundation/execution/operation-host.js";
import type {
  FoundationExecutionOutputStoreV1,
} from "../../src/foundation/execution/output-store-v1.js";
import {
  createFoundationActivityChildCheckpointAdapterV7,
} from "../../src/foundation/process/activity-child-checkpoint-v7.js";
import {
  FOUNDATION_ACTIVITY_KERNEL_V7_SUPPORT_KIND,
  FOUNDATION_ACTIVITY_KERNEL_V7_SUPPORT_SCHEMA,
  type FoundationActivityKernelCheckpointAdapterV7,
  type FoundationActivityKernelContextV7,
  type FoundationActivityKernelEnvelopeV7,
} from "../../src/foundation/process/activity-kernel-v7.js";
import {
  canonicalJson,
  digestCanonical,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";
import {
  digest,
  executionContractFixture,
} from "../support/execution-contract-fixture.js";
import {
  InMemoryExecutionBackendEngine,
} from "../support/in-memory-execution-backend.js";

type Plan = Readonly<{
  schema: "lifecycle.test.execution-activity-plan.v1";
  subject: string;
}>;

type Parent = Readonly<{
  schema: "lifecycle.test.execution-activity-checkpoint.v1";
  sibling: string;
  execution: ControlJsonObject | null;
}>;

const RUNNER_DIGEST = digest("activity-persistence-runner");
const ALLOCATION_KEY = `allocation-v1:${"ab".repeat(32)}` as FoundationExecutionAllocationKey;

function testClock() {
  let current = Date.parse("2026-09-01T03:00:00.000Z");
  return Object.freeze({
    now() {
      current += 1;
      return new Date(current).toISOString();
    },
  });
}

const unavailableOutputStore: FoundationExecutionOutputStoreV1 = Object.freeze({
  async begin() {
    throw new Error("Output staging is outside this persistence test");
  },
  async reopen() {
    throw new Error("Output reopen is outside this persistence test");
  },
});

function operationHost(input: Readonly<{
  backend: FoundationExecutionBackend;
  checkpoints: FoundationExecutionOperationCheckpointPersistenceV1;
}>): FoundationExecutionOperationHostV1 {
  return new FoundationExecutionOperationHostV1({
    backend: input.backend,
    checkpoints: input.checkpoints,
    clock: testClock(),
    outputStore: unavailableOutputStore,
    createAllocationKey: () => ALLOCATION_KEY,
  });
}

function activityHarness(input: Readonly<{
  activityId: string;
  initialGeneration: number;
  backend: FoundationExecutionBackend;
  specification: ReturnType<typeof executionContractFixture>["specification"];
  allowedSiblings?: readonly string[];
}>) {
  const plan: Plan = Object.freeze({
    schema: "lifecycle.test.execution-activity-plan.v1",
    subject: "immutable",
  });
  let parent: Parent = Object.freeze({
    schema: "lifecycle.test.execution-activity-checkpoint.v1",
    sibling: "preserved",
    execution: null,
  });
  let generation = input.initialGeneration;
  const commits: Parameters<
    FoundationActivityKernelCheckpointAdapterV7<Plan, Parent>["commit"]
  >[0][] = [];
  const allowedSiblings = new Set(input.allowedSiblings ?? ["preserved"]);

  const envelope = (): FoundationActivityKernelEnvelopeV7<Plan, Parent> => Object.freeze({
    schema: FOUNDATION_ACTIVITY_KERNEL_V7_SUPPORT_SCHEMA,
    activityId: input.activityId,
    operation: "delivery.continue",
    definition: Object.freeze({
      id: "lifecycle.test.execution-activity.v1",
      digest: digest("execution-activity-definition"),
    }),
    plan: Object.freeze({ value: plan, digest: digestCanonical(plan) }),
    checkpoint: Object.freeze({ value: parent, digest: digestCanonical(parent) }),
    completion: null,
  });

  const context = (): FoundationActivityKernelContextV7<Plan, Parent> => {
    const selectedEnvelope = envelope();
    const payload = selectedEnvelope as unknown as ControlJsonObject;
    const payloadDigest = digestCanonical(payload);
    return {
      support: Object.freeze({
        schema: CONTROL_RECORD_OPERATION_SUPPORT_SCHEMA,
        storeId: "store-activity-persistence",
        processId: "process-activity-persistence",
        activityId: input.activityId,
        supportKind: FOUNDATION_ACTIVITY_KERNEL_V7_SUPPORT_KIND,
        generation,
        payload,
        payloadDigest,
      }),
      coordinate: Object.freeze({ generation, payloadDigest }),
      envelope: selectedEnvelope,
    } as unknown as FoundationActivityKernelContextV7<Plan, Parent>;
  };

  const kernel = Object.freeze({
    current: context,
    commit(
      mutation: Parameters<
        FoundationActivityKernelCheckpointAdapterV7<Plan, Parent>["commit"]
      >[0],
    ) {
      assert.deepEqual(mutation.expected, context().coordinate);
      assert.notEqual(mutation.checkpoint, null);
      commits.push(mutation);
      parent = mutation.checkpoint as Parent;
      generation += 1;
      return Object.freeze({
        context: context(),
        append: null,
        files: Object.freeze([]),
      });
    },
    async commitWithFiles() {
      throw new Error("File commits are outside this persistence test");
    },
  }) as FoundationActivityKernelCheckpointAdapterV7<Plan, Parent>;

  const child = createFoundationActivityChildCheckpointAdapterV7({
    parent: kernel,
    lens: Object.freeze({
      get: (value: Parent) => value.execution,
      set: (
        value: Parent,
        execution: FoundationExecutionOperationCheckpointV1 | null,
      ): Parent => Object.freeze({ ...value, execution }),
      parse: (value: ControlJsonObject) => parseFoundationExecutionOperationCheckpoint({
        value,
        specification: input.specification,
        backend: input.backend,
      }),
    }),
    assertContext(selected, value) {
      if (selected.envelope.activityId !== input.activityId || !allowedSiblings.has(value.sibling)) {
        throw new FoundationError(
          "lifecycle.test.execution-activity.context",
          "Execution child changed its Activity owner or sibling checkpoint",
        );
      }
    },
  });

  return Object.freeze({
    child,
    context,
    kernel,
    generation: () => generation,
    parent: () => parent,
    commits: () => Object.freeze([...commits]),
  });
}

function activityAppend(
  activityId: string,
  eventKind: string,
): ControlRecordStoreAppend {
  return Object.freeze({
    event: Object.freeze({
      eventId: `event-${eventKind}-${activityId}`,
      eventKind,
      occurredAt: "2026-09-01T03:00:00.000Z",
      actor: Object.freeze({ kind: "runtime" as const, id: "foundation-runtime" }),
      subject: null,
      payload: Object.freeze({ activityId }),
    }),
  });
}

class OffsetCheckpointPersistence
implements FoundationExecutionOperationCheckpointPersistenceV1 {
  #retained: FoundationRetainedExecutionOperationCheckpointV1 | null = null;
  #nextDelta = 1;

  jumpNextRevision(): void {
    this.#nextDelta = 2;
  }

  async read(): Promise<FoundationRetainedExecutionOperationCheckpointV1 | null> {
    return this.#retained;
  }

  async compareExchange(input: Readonly<{
    specificationDigest: Sha256;
    expected: FoundationExecutionOperationCheckpointCoordinateV1 | null;
    checkpoint: FoundationExecutionOperationCheckpointV1;
  }>): Promise<FoundationRetainedExecutionOperationCheckpointV1> {
    if (input.expected === null) {
      assert.equal(this.#retained, null);
    } else {
      assert.deepEqual(input.expected, this.#retained?.coordinate);
    }
    const revision = this.#retained === null
      ? 7
      : this.#retained.coordinate.revision + this.#nextDelta;
    this.#nextDelta = 1;
    const coordinate = Object.freeze({
      revision,
      checkpointDigest: input.checkpoint.digest,
      persistenceDigest: digestCanonical({
        schema: "lifecycle.test.offset-execution-persistence-coordinate.v1",
        revision,
        checkpointDigest: input.checkpoint.digest,
      }),
    });
    this.#retained = Object.freeze({ coordinate, checkpoint: input.checkpoint });
    return this.#retained;
  }
}

async function checkpointProposals(suffix: string) {
  const fixture = executionContractFixture(`activity-persistence-proposals-${suffix}`);
  const backend = new InMemoryExecutionBackendEngine().facade(fixture.profile);
  const selected = activityHarness({
    activityId: `activity-proposals-${suffix}`,
    initialGeneration: 1,
    backend,
    specification: fixture.specification,
  });
  const checkpoints = createFoundationActivityExecutionCheckpointPersistenceV1({
    context: selected.context(),
    child: selected.child,
    specificationDigest: fixture.specification.digest,
  });
  const host = operationHost({ backend, checkpoints });
  const opened = await host.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  const allocated = await host.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  return Object.freeze({
    fixture,
    backend,
    opened: opened.retained.checkpoint,
    allocated: allocated.retained.checkpoint,
  });
}

test("an execution child may open after Activity support generation N", async () => {
  const fixture = executionContractFixture("activity-persistence-generation-n");
  const backend = new InMemoryExecutionBackendEngine().facade(fixture.profile);
  const selected = activityHarness({
    activityId: "activity-generation-n",
    initialGeneration: 11,
    backend,
    specification: fixture.specification,
  });
  const checkpoints = createFoundationActivityExecutionCheckpointPersistenceV1({
    context: selected.context(),
    child: selected.child,
    specificationDigest: fixture.specification.digest,
  });
  const host = operationHost({ backend, checkpoints });

  const opened = await host.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(opened.retained.coordinate.revision, 12);
  assert.equal(selected.generation(), 12);
  assert.equal((await checkpoints.read(fixture.specification.digest))?.checkpoint.digest,
    opened.retained.checkpoint.digest);

  const allocated = await host.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(allocated.retained.coordinate.revision, 13);
  assert.equal(selected.generation(), 13);
  assert.deepEqual(selected.commits().map(({ mode }) => mode), [
    "support-only",
    "support-only",
  ]);
  assert.equal(selected.parent().sibling, "preserved");
});

test("an owner commit may atomically replace the full parent beside ordered appends", async () => {
  const proposals = await checkpointProposals("owner-ordered-appends");
  const selected = activityHarness({
    activityId: "activity-owner-ordered-appends",
    initialGeneration: 8,
    backend: proposals.backend,
    specification: proposals.fixture.specification,
    allowedSiblings: Object.freeze(["preserved", "owner-committed"]),
  });
  const appends = Object.freeze([
    activityAppend("activity-owner-ordered-appends", "agent-attempt-prepared"),
    activityAppend("activity-owner-ordered-appends", "provider-effect-intended"),
  ] as const);
  const checkpoints = createFoundationActivityExecutionCheckpointPersistenceV1({
    context: selected.context(),
    child: selected.child,
    specificationDigest: proposals.fixture.specification.digest,
    ownerCommit: ({ selected: current, proposed }) => {
      assert.equal(current.checkpoint, null);
      assert.equal(proposed.digest, proposals.opened.digest);
      return () => {
        const parent = current.context.envelope.checkpoint?.value;
        assert(parent !== undefined);
        selected.kernel.commit({
          mode: "ordered-appends",
          expected: current.coordinate,
          checkpoint: Object.freeze({
            ...parent,
            sibling: "owner-committed",
            execution: proposed,
          }),
          appends,
        });
      };
    },
  });

  const retained = await checkpoints.compareExchange({
    specificationDigest: proposals.fixture.specification.digest,
    expected: null,
    checkpoint: proposals.opened,
  });

  assert.equal(retained.coordinate.revision, 9);
  assert.equal(retained.checkpoint.digest, proposals.opened.digest);
  assert.equal(selected.parent().sibling, "owner-committed");
  assert.equal(selected.parent().execution?.digest, proposals.opened.digest);
  assert.equal(selected.commits().length, 1);
  assert.equal(selected.commits()[0]?.mode, "ordered-appends");
  const commit = selected.commits()[0];
  assert(commit?.mode === "ordered-appends");
  assert.deepEqual(commit.appends, appends);
});

test("an owner commit that retains nothing is refused", async () => {
  const proposals = await checkpointProposals("owner-no-op");
  const selected = activityHarness({
    activityId: "activity-owner-no-op",
    initialGeneration: 3,
    backend: proposals.backend,
    specification: proposals.fixture.specification,
  });
  const checkpoints = createFoundationActivityExecutionCheckpointPersistenceV1({
    context: selected.context(),
    child: selected.child,
    specificationDigest: proposals.fixture.specification.digest,
    ownerCommit: () => () => undefined,
  });

  await assert.rejects(
    checkpoints.compareExchange({
      specificationDigest: proposals.fixture.specification.digest,
      expected: null,
      checkpoint: proposals.opened,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code ===
        "lifecycle.execution.activity-checkpoint-persistence-v1.persistence-substitution",
  );
  assert.equal(selected.generation(), 3);
  assert.equal(selected.parent().execution, null);
});

test("an owner commit that retains another execution child is refused", async () => {
  const proposals = await checkpointProposals("owner-wrong-child");
  const selected = activityHarness({
    activityId: "activity-owner-wrong-child",
    initialGeneration: 5,
    backend: proposals.backend,
    specification: proposals.fixture.specification,
  });
  const checkpoints = createFoundationActivityExecutionCheckpointPersistenceV1({
    context: selected.context(),
    child: selected.child,
    specificationDigest: proposals.fixture.specification.digest,
    ownerCommit: ({ selected: current }) => () => {
      const parent = current.context.envelope.checkpoint?.value;
      assert(parent !== undefined);
      selected.kernel.commit({
        mode: "support-only",
        expected: current.coordinate,
        checkpoint: Object.freeze({ ...parent, execution: proposals.allocated }),
      });
    },
  });

  await assert.rejects(
    checkpoints.compareExchange({
      specificationDigest: proposals.fixture.specification.digest,
      expected: null,
      checkpoint: proposals.opened,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code ===
        "lifecycle.execution.activity-checkpoint-persistence-v1.persistence-substitution",
  );
  assert.equal(selected.generation(), 6);
  assert.equal(selected.parent().execution?.digest, proposals.allocated.digest);
});

test("an owner commit that advances more than one support generation is refused", async () => {
  const proposals = await checkpointProposals("owner-revision-jump");
  const selected = activityHarness({
    activityId: "activity-owner-revision-jump",
    initialGeneration: 13,
    backend: proposals.backend,
    specification: proposals.fixture.specification,
  });
  const checkpoints = createFoundationActivityExecutionCheckpointPersistenceV1({
    context: selected.context(),
    child: selected.child,
    specificationDigest: proposals.fixture.specification.digest,
    ownerCommit: ({ selected: current, proposed }) => () => {
      const parent = current.context.envelope.checkpoint?.value;
      assert(parent !== undefined);
      selected.kernel.commit({
        mode: "support-only",
        expected: current.coordinate,
        checkpoint: Object.freeze({ ...parent, execution: proposed }),
      });
      const intermediate = selected.context();
      const intermediateParent = intermediate.envelope.checkpoint?.value;
      assert(intermediateParent !== undefined);
      selected.kernel.commit({
        mode: "support-only",
        expected: intermediate.coordinate,
        checkpoint: Object.freeze({ ...intermediateParent, execution: proposed }),
      });
    },
  });

  await assert.rejects(
    checkpoints.compareExchange({
      specificationDigest: proposals.fixture.specification.digest,
      expected: null,
      checkpoint: proposals.opened,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code ===
        "lifecycle.execution.activity-checkpoint-persistence-v1.persistence-substitution",
  );
  assert.equal(selected.generation(), 15);
  assert.equal(selected.parent().execution?.digest, proposals.opened.digest);
});

test("the host accepts any positive first coordinate but refuses a later revision jump", async () => {
  const fixture = executionContractFixture("operation-host-offset-coordinate");
  const backend = new InMemoryExecutionBackendEngine().facade(fixture.profile);
  const checkpoints = new OffsetCheckpointPersistence();
  const host = operationHost({ backend, checkpoints });

  const opened = await host.advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  assert.equal(opened.retained.coordinate.revision, 7);

  checkpoints.jumpNextRevision();
  await assert.rejects(
    host.advance({
      specification: fixture.specification,
      runnerDigest: RUNNER_DIGEST,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.operation-host.persistence-substitution",
  );
});

test("same child bytes from another Activity cannot satisfy the persistence CAS", async () => {
  const fixture = executionContractFixture("activity-persistence-owner-binding");
  const engine = new InMemoryExecutionBackendEngine();
  const backend = engine.facade(fixture.profile);
  const left = activityHarness({
    activityId: "activity-owner-left",
    initialGeneration: 4,
    backend,
    specification: fixture.specification,
  });
  const right = activityHarness({
    activityId: "activity-owner-right",
    initialGeneration: 4,
    backend,
    specification: fixture.specification,
  });
  const leftPersistence = createFoundationActivityExecutionCheckpointPersistenceV1({
    context: left.context(),
    child: left.child,
    specificationDigest: fixture.specification.digest,
  });
  const rightPersistence = createFoundationActivityExecutionCheckpointPersistenceV1({
    context: right.context(),
    child: right.child,
    specificationDigest: fixture.specification.digest,
  });
  const leftOpened = await operationHost({ backend, checkpoints: leftPersistence }).advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });
  const rightOpened = await operationHost({ backend, checkpoints: rightPersistence }).advance({
    specification: fixture.specification,
    runnerDigest: RUNNER_DIGEST,
  });

  assert.equal(leftOpened.retained.coordinate.revision, rightOpened.retained.coordinate.revision);
  assert.equal(
    canonicalJson(leftOpened.retained.checkpoint),
    canonicalJson(rightOpened.retained.checkpoint),
  );
  assert.notEqual(
    leftOpened.retained.coordinate.persistenceDigest,
    rightOpened.retained.coordinate.persistenceDigest,
  );
  await assert.rejects(
    rightPersistence.compareExchange({
      specificationDigest: fixture.specification.digest,
      expected: leftOpened.retained.coordinate,
      checkpoint: rightOpened.retained.checkpoint,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.activity-checkpoint-persistence-v1.checkpoint-cas",
  );

  const crossActivity = createFoundationActivityExecutionCheckpointPersistenceV1({
    context: left.context(),
    child: right.child,
    specificationDigest: fixture.specification.digest,
  });
  await assert.rejects(
    crossActivity.read(fixture.specification.digest),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.activity-checkpoint-persistence-v1.activity-substitution",
  );
});

test("an Activity-bound persistence adapter refuses another Execution Specification", async () => {
  const fixture = executionContractFixture("activity-persistence-specification");
  const other = executionContractFixture("activity-persistence-specification-other");
  const backend = new InMemoryExecutionBackendEngine().facade(fixture.profile);
  const selected = activityHarness({
    activityId: "activity-specification",
    initialGeneration: 2,
    backend,
    specification: fixture.specification,
  });
  const checkpoints = createFoundationActivityExecutionCheckpointPersistenceV1({
    context: selected.context(),
    child: selected.child,
    specificationDigest: fixture.specification.digest,
  });

  await assert.rejects(
    checkpoints.read(other.specification.digest),
    (error: unknown) => error instanceof FoundationError &&
      error.code ===
        "lifecycle.execution.activity-checkpoint-persistence-v1.specification-substitution",
  );
});
