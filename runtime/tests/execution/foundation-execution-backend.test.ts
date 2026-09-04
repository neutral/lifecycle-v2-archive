import assert from "node:assert/strict";
import test from "node:test";
import { FoundationError } from "../../src/foundation/error.js";
import {
  compileExecutionReclamationBinding,
  compileExecutionReclamationObligation,
  createFoundationExecutionAllocationKey,
  parseFoundationExecutionRetrievalOutcome,
  parseExecutionReclamationObservation,
  type FoundationExecutionBackend,
  type FoundationExecutionHandle,
  type FoundationRetrievedExecutionOutputV1,
} from "../../src/foundation/execution/backend.js";
import {
  executionObservationEstablishesContainment,
  parseFoundationExecutionObservation,
  type FoundationExecutionSpecificationV1,
} from "../../src/foundation/execution/contracts.js";
import { selfDigest } from "../../src/foundation/validation/canonical.js";
import {
  digest,
  executionContractFixture,
  executionOutputFixture,
} from "../support/execution-contract-fixture.js";
import {
  InMemoryExecutionBackendEngine,
  type InMemoryExecutionBackendSnapshotV1,
} from "../support/in-memory-execution-backend.js";

function rehashedSnapshot(
  snapshot: InMemoryExecutionBackendSnapshotV1,
  mutate: (value: Record<string, unknown>) => void,
): unknown {
  const value = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;
  mutate(value);
  value.digest = selfDigest(value, "digest");
  return value;
}

function firstAllocation(snapshot: Record<string, unknown>): Record<string, unknown> {
  const allocations = snapshot.allocations as Record<string, unknown>[];
  assert.equal(Array.isArray(allocations), true);
  assert.notEqual(allocations[0], undefined);
  return allocations[0]!;
}

function firstTombstone(snapshot: Record<string, unknown>): Record<string, unknown> {
  const tombstones = snapshot.reclamationTombstones as Record<string, unknown>[];
  assert.equal(Array.isArray(tombstones), true);
  assert.notEqual(tombstones[0], undefined);
  return tombstones[0]!;
}

async function reclamationHandoff(input: Readonly<{
  backend: FoundationExecutionBackend;
  specification: FoundationExecutionSpecificationV1;
  handle: FoundationExecutionHandle;
  retirementCheckpointDigest: ReturnType<typeof digest>;
  dispatchAuthorityConsumed: boolean;
}>) {
  const binding = await input.backend.createReclamationBinding(input);
  return Object.freeze({
    binding,
    obligation: compileExecutionReclamationObligation({
      specification: input.specification,
      handle: input.handle,
      retirementCheckpointDigest: input.retirementCheckpointDigest,
      reclamationBinding: binding,
    }),
  });
}

async function readCarrier(output: FoundationRetrievedExecutionOutputV1): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let entries = 0;
  for await (const entry of output.entries()) {
    entries += 1;
    let observedBytes = 0;
    for await (const chunk of entry.read()) {
      chunks.push(Buffer.from(chunk));
      observedBytes += chunk.byteLength;
    }
    assert.equal(observedBytes, entry.byteLength);
  }
  assert.equal(entries, output.manifest.entryCount);
  return Buffer.concat(chunks);
}

test("in-memory Backend reopens one exact idempotent allocation and refuses substitutions", async () => {
  const fixture = executionContractFixture("allocate");
  const other = executionContractFixture("other");
  const engine = new InMemoryExecutionBackendEngine();
  const key = createFoundationExecutionAllocationKey();

  engine.armFault("allocate-before-create");
  await assert.rejects(engine.facade(fixture.profile).allocate(fixture.specification, key));

  engine.armFault("allocate-after-create-before-return");
  await assert.rejects(engine.facade(fixture.profile).allocate(fixture.specification, key));
  const reopened = engine.facade(fixture.profile);
  const handle = await reopened.allocate(fixture.specification, key);
  assert.equal(await reopened.allocate(fixture.specification, key), handle);

  await assert.rejects(
    reopened.allocate(other.specification, key),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.test-backend.substitution",
  );
  await assert.rejects(
    reopened.allocate(fixture.specification, createFoundationExecutionAllocationKey()),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.test-backend.duplicate",
  );
  await assert.rejects(
    new InMemoryExecutionBackendEngine().facade(fixture.profile).observe(handle),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.test-backend.handle",
  );
});

test("dispatch entry is physically at-most-once across every uncertain return", async () => {
  const fixture = executionContractFixture("dispatch-started");
  const engine = new InMemoryExecutionBackendEngine();
  const firstFacade = engine.facade(fixture.profile);
  const handle = await firstFacade.allocate(
    fixture.specification,
    createFoundationExecutionAllocationKey(),
  );
  engine.armFault("dispatch-after-start-before-return");
  await assert.rejects(firstFacade.dispatch(handle));

  const reopened = engine.facade(fixture.profile);
  const observed = await reopened.observe(handle);
  assert.equal(observed.processState, "terminal");
  assert.equal(engine.productiveStartCount(fixture.specification.digest), 1);

  await assert.rejects(
    reopened.dispatch(handle),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.test-backend.redispatch",
  );
  assert.equal(engine.productiveStartCount(fixture.specification.digest), 1);

  const notStartedFixture = executionContractFixture("dispatch-not-started");
  const notStartedEngine = new InMemoryExecutionBackendEngine();
  const notStartedBackend = notStartedEngine.facade(notStartedFixture.profile);
  const notStartedHandle = await notStartedBackend.allocate(
    notStartedFixture.specification,
    createFoundationExecutionAllocationKey(),
  );
  notStartedEngine.armFault("dispatch-before-start");
  await assert.rejects(notStartedBackend.dispatch(notStartedHandle));
  const direct = await notStartedEngine.facade(notStartedFixture.profile).observe(notStartedHandle);
  assert.equal(direct.dispatchState, "accepted");
  assert.equal(direct.processState, "not-started");
  assert.equal(executionObservationEstablishesContainment(direct, true), true);
  await assert.rejects(
    notStartedBackend.dispatch(notStartedHandle),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.test-backend.redispatch",
  );
  assert.equal(notStartedEngine.productiveStartCount(notStartedFixture.specification.digest), 0);
});

test("durable engine reload retains consumed dispatch before and after productive start", async () => {
  const beforeStart = executionContractFixture("restart-before-start");
  const beforeStartEngine = new InMemoryExecutionBackendEngine();
  const beforeStartKey = createFoundationExecutionAllocationKey();
  const beforeStartHandle = await beforeStartEngine.facade(beforeStart.profile).allocate(
    beforeStart.specification,
    beforeStartKey,
  );
  beforeStartEngine.armFault("dispatch-before-start");
  await assert.rejects(
    beforeStartEngine.facade(beforeStart.profile).dispatch(beforeStartHandle),
  );

  const beforeStartSnapshot = beforeStartEngine.snapshot();
  assert.throws(
    () => InMemoryExecutionBackendEngine.reload(
      rehashedSnapshot(beforeStartSnapshot, (snapshot) => {
        firstAllocation(snapshot).dispatched = false;
      }),
      beforeStart.profile,
    ),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.test-backend.snapshot",
  );
  assert.throws(
    () => InMemoryExecutionBackendEngine.reload(
      rehashedSnapshot(beforeStartSnapshot, (snapshot) => {
        firstAllocation(snapshot).unexpected = true;
      }),
      beforeStart.profile,
    ),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.test-backend.snapshot",
  );
  const restartedBeforeStart = InMemoryExecutionBackendEngine.reload(
    beforeStartSnapshot,
    beforeStart.profile,
  );
  assert.notEqual(restartedBeforeStart, beforeStartEngine);
  const direct = await restartedBeforeStart.facade(beforeStart.profile).observe(beforeStartHandle);
  assert.equal(direct.dispatchState, "accepted");
  assert.equal(direct.processState, "not-started");
  assert.equal(executionObservationEstablishesContainment(direct, true), true);
  await assert.rejects(
    restartedBeforeStart.facade(beforeStart.profile).dispatch(beforeStartHandle),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.test-backend.redispatch",
  );
  assert.equal(restartedBeforeStart.productiveStartCount(beforeStart.specification.digest), 0);

  const afterStart = executionContractFixture("restart-after-start");
  const afterStartEngine = new InMemoryExecutionBackendEngine();
  const afterStartHandle = await afterStartEngine.facade(afterStart.profile).allocate(
    afterStart.specification,
    createFoundationExecutionAllocationKey(),
  );
  afterStartEngine.armFault("dispatch-after-start-before-return");
  await assert.rejects(afterStartEngine.facade(afterStart.profile).dispatch(afterStartHandle));

  const afterStartSnapshot = afterStartEngine.snapshot();
  assert.throws(
    () => InMemoryExecutionBackendEngine.reload(
      rehashedSnapshot(afterStartSnapshot, (snapshot) => {
        const allocation = firstAllocation(snapshot);
        allocation.dispatched = false;
        allocation.dispatchEntryDigest = null;
      }),
      afterStart.profile,
    ),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.test-backend.snapshot",
  );
  assert.throws(
    () => InMemoryExecutionBackendEngine.reload(
      rehashedSnapshot(afterStartSnapshot, (snapshot) => {
        firstAllocation(snapshot).productiveStarts = 0;
      }),
      afterStart.profile,
    ),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.test-backend.snapshot",
  );
  assert.throws(
    () => InMemoryExecutionBackendEngine.reload(
      rehashedSnapshot(afterStartSnapshot, (snapshot) => {
        const allocation = firstAllocation(snapshot);
        allocation.started = false;
        allocation.productiveStarts = 0;
      }),
      afterStart.profile,
    ),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.test-backend.snapshot",
  );
  const restartedAfterStart = InMemoryExecutionBackendEngine.reload(
    afterStartSnapshot,
    afterStart.profile,
  );
  assert.notEqual(restartedAfterStart, afterStartEngine);
  assert.equal(
    (await restartedAfterStart.facade(afterStart.profile).observe(afterStartHandle)).processState,
    "terminal",
  );
  await assert.rejects(
    restartedAfterStart.facade(afterStart.profile).dispatch(afterStartHandle),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.test-backend.redispatch",
  );
  assert.equal(restartedAfterStart.productiveStartCount(afterStart.specification.digest), 1);
});

test("durable engine reload preserves missing-allocation ambiguity after dispatch entry", async () => {
  const fixture = executionContractFixture("restart-missing");
  const engine = new InMemoryExecutionBackendEngine();
  const key = createFoundationExecutionAllocationKey();
  const handle = await engine.facade(fixture.profile).allocate(fixture.specification, key);
  engine.armFault("dispatch-before-start");
  await assert.rejects(engine.facade(fixture.profile).dispatch(handle));
  engine.removePhysicalAllocationWithoutObservation(handle);

  const restarted = InMemoryExecutionBackendEngine.reload(engine.snapshot(), fixture.profile);
  const observed = await restarted.facade(fixture.profile).observe(handle);
  assert.equal(observed.allocationState, "ambiguous");
  assert.equal(observed.dispatchState, "accepted");
  assert.equal(observed.processState, "ambiguous");
  assert.equal(executionObservationEstablishesContainment(observed, true), false);
  await assert.rejects(
    restarted.facade(fixture.profile).dispatch(handle),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.test-backend.allocation-ambiguous",
  );
  await assert.rejects(
    restarted.facade(fixture.profile).allocate(fixture.specification, key),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.test-backend.allocation-ambiguous",
  );
  assert.equal(restarted.productiveStartCount(fixture.specification.digest), 0);
});

test("unavailable and ambiguous Backend facts never establish Containment", async () => {
  const fixture = executionContractFixture("observe");
  const engine = new InMemoryExecutionBackendEngine();
  const backend = engine.facade(fixture.profile);
  const handle = await backend.allocate(fixture.specification, createFoundationExecutionAllocationKey());
  await backend.dispatch(handle);

  engine.armFault("observe-unavailable");
  const unavailable = await backend.observe(handle);
  assert.equal(unavailable.allocationState, "unavailable");
  assert.equal(executionObservationEstablishesContainment(unavailable, true), false);

  engine.armFault("observe-ambiguous");
  const ambiguous = await backend.observe(handle);
  assert.equal(ambiguous.allocationState, "ambiguous");
  assert.equal(executionObservationEstablishesContainment(ambiguous, true), false);
});

test("a retained complete output can become unobservable but cannot regress to another physical disposition", async () => {
  const fixture = executionContractFixture("complete-output-observation-continuity");
  const engine = new InMemoryExecutionBackendEngine();
  const backend = engine.facade(fixture.profile);
  const handle = await backend.allocate(
    fixture.specification,
    createFoundationExecutionAllocationKey(),
  );
  await engine.provideOutput(
    fixture.specification,
    executionOutputFixture(fixture.specification),
  );
  const complete = await backend.dispatch(handle);
  assert.equal(complete.output.disposition, "complete");

  function laterOutput(disposition: "not-produced" | "missing" | "partial" | "unavailable" | "ambiguous") {
    const value = JSON.parse(JSON.stringify(complete)) as Record<string, unknown>;
    value.observationSequence = complete.observationSequence + 1;
    value.output = { disposition, manifestDigest: null, carrierByteLength: null };
    value.digest = selfDigest(value, "digest");
    return value;
  }

  for (const disposition of ["not-produced", "missing", "partial"] as const) {
    assert.throws(
      () => parseFoundationExecutionObservation({
        value: laterOutput(disposition),
        specification: fixture.specification,
        previous: complete,
      }),
      (error: unknown) => error instanceof FoundationError &&
        error.code === "lifecycle.execution.contract-invalid",
    );
  }
  for (const disposition of ["unavailable", "ambiguous"] as const) {
    assert.equal(
      parseFoundationExecutionObservation({
        value: laterOutput(disposition),
        specification: fixture.specification,
        previous: complete,
      }).output.disposition,
      disposition,
    );
  }
});

test("cancel, streaming retrieval, and Reclamation recover every interrupted physical boundary", async () => {
  const fixture = executionContractFixture("terminal");
  let engine = new InMemoryExecutionBackendEngine();
  engine.holdOpen(fixture.specification.digest);
  let backend = engine.facade(fixture.profile);
  const allocationKey = createFoundationExecutionAllocationKey();
  const handle = await backend.allocate(fixture.specification, allocationKey);
  await engine.provideOutput(
    fixture.specification,
    executionOutputFixture(fixture.specification),
  );
  assert.equal((await backend.dispatch(handle)).processState, "running");

  engine.armFault("cancel-before-containment");
  await assert.rejects(backend.cancel(handle));
  assert.equal((await backend.observe(handle)).processState, "running");

  engine.armFault("cancel-after-containment-before-return");
  await assert.rejects(backend.cancel(handle));
  const contained = await engine.facade(fixture.profile).observe(handle);
  assert.equal(contained.processState, "terminal");
  assert.equal(executionObservationEstablishesContainment(contained, true), true);

  const containedSnapshot = engine.snapshot();
  assert.throws(
    () => InMemoryExecutionBackendEngine.reload(
      rehashedSnapshot(containedSnapshot, (snapshot) => {
        const storedOutput = firstAllocation(snapshot).output as Record<string, unknown>;
        storedOutput.carrierByteLength = Number(storedOutput.carrierByteLength) + 1;
      }),
      fixture.profile,
    ),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.test-backend.snapshot",
  );
  engine = InMemoryExecutionBackendEngine.reload(containedSnapshot, fixture.profile);
  backend = engine.facade(fixture.profile);

  engine.armFault("retrieve-before-read");
  await assert.rejects(backend.retrieve(handle, contained));
  engine.armFault("retrieve-after-read-before-return");
  const interrupted = await backend.retrieve(handle, contained);
  assert.equal(interrupted.disposition, "complete");
  if (interrupted.disposition !== "complete") assert.fail("expected complete retrieval");
  const partialChunks: Buffer[] = [];
  await assert.rejects(async () => {
    for await (const entry of interrupted.output.entries()) {
      for await (const chunk of entry.read()) partialChunks.push(Buffer.from(chunk));
    }
  });
  assert.equal(Buffer.concat(partialChunks).toString("utf8"), "bounded");
  engine = InMemoryExecutionBackendEngine.reload(engine.snapshot(), fixture.profile);
  backend = engine.facade(fixture.profile);
  const retrieval = await backend.retrieve(handle, contained);
  assert.equal(retrieval.disposition, "complete");
  if (retrieval.disposition !== "complete") assert.fail("expected complete retrieval");
  assert.equal(retrieval.observationDigest, contained.digest);
  assert.deepEqual(Object.keys(retrieval).sort(), [
    "allocationIdentityDigest",
    "disposition",
    "factsDigest",
    "observationDigest",
    "output",
    "schema",
    "specificationDigest",
    "unavailableReason",
  ]);
  assert.deepEqual(
    parseFoundationExecutionRetrievalOutcome({
      value: retrieval,
      specification: fixture.specification,
      handle,
    }),
    retrieval,
  );
  const output = retrieval.output;
  assert.deepEqual(Object.keys(output).sort(), ["carrierByteLength", "entries", "manifest"]);
  assert.equal((await readCarrier(output)).toString("utf8"), "bounded output\n");

  for (const extra of ["hidden", Symbol("hidden")]) {
    const substituted = { ...retrieval } as Record<PropertyKey, unknown>;
    Object.defineProperty(substituted, extra, { value: true, enumerable: false });
    assert.throws(
      () => parseFoundationExecutionRetrievalOutcome({
        value: substituted,
        specification: fixture.specification,
        handle,
      }),
      (error: unknown) => error instanceof FoundationError &&
        error.code === "lifecycle.execution.retrieval-outcome-invalid",
    );
  }

  // This call models the private Runtime gate after durable Retirement.
  const retirement = await reclamationHandoff({
    backend,
    specification: fixture.specification,
    handle,
    retirementCheckpointDigest: digest("retirement-terminal"),
    dispatchAuthorityConsumed: true,
  });
  const { binding, obligation } = retirement;
  assert.equal(Object.isFrozen(obligation), true);
  assert.equal(Object.isFrozen(obligation.backendProfile), true);
  const serializedObligation = JSON.stringify(obligation);
  assert.equal(serializedObligation.includes(handle), false);
  assert.equal(serializedObligation.includes(allocationKey), false);
  engine.armFault("reclaim-before-removal");
  await assert.rejects(backend.reclaim(fixture.specification, binding, obligation));
  engine = InMemoryExecutionBackendEngine.reload(engine.snapshot(), fixture.profile);
  backend = engine.facade(fixture.profile);
  engine.armFault("reclaim-after-removal-before-return");
  await assert.rejects(backend.reclaim(fixture.specification, binding, obligation));
  const reclaimedSnapshot = engine.snapshot();
  assert.throws(
    () => InMemoryExecutionBackendEngine.reload(
      rehashedSnapshot(reclaimedSnapshot, (snapshot) => {
        const observation = firstTombstone(snapshot).observation as Record<string, unknown>;
        observation.obligationDigest = digest("forged-obligation");
        observation.digest = selfDigest(observation, "digest");
      }),
      fixture.profile,
    ),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.reclamation-invalid",
  );
  engine = InMemoryExecutionBackendEngine.reload(reclaimedSnapshot, fixture.profile);
  backend = engine.facade(fixture.profile);
  const tombstone = await backend.reclaim(fixture.specification, binding, obligation);
  assert.equal(tombstone.disposition, "reclaimed");
  assert.equal(tombstone.obligationDigest, obligation.digest);
  assert.deepEqual(
    await backend.reclaim(fixture.specification, binding, obligation),
    tombstone,
  );
  assert.deepEqual(
    parseExecutionReclamationObservation(tombstone, fixture.specification, obligation),
    tombstone,
  );
  const substitutedBinding = compileExecutionReclamationBinding({
    specification: fixture.specification,
    handle,
    retirementCheckpointDigest: digest("substituted-retirement-terminal"),
    dispatchAuthorityConsumed: true,
    backendBinding: binding.backendBinding,
  });
  const substitutedObligation = compileExecutionReclamationObligation({
    specification: fixture.specification,
    handle,
    retirementCheckpointDigest: substitutedBinding.retirementCheckpointDigest,
    reclamationBinding: substitutedBinding,
  });
  await assert.rejects(
    backend.reclaim(fixture.specification, binding, substitutedObligation),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.reclamation-obligation-invalid",
  );
  assert.throws(
    () => parseExecutionReclamationObservation(
      tombstone,
      fixture.specification,
      substitutedObligation,
    ),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.reclamation-invalid",
  );
  const replayFixture = executionContractFixture("reclamation-replay");
  const replayHandle = await backend.allocate(
    replayFixture.specification,
    createFoundationExecutionAllocationKey(),
  );
  const replay = await reclamationHandoff({
    backend,
    specification: replayFixture.specification,
    handle: replayHandle,
    retirementCheckpointDigest: digest("replay-retirement"),
    dispatchAuthorityConsumed: false,
  });
  const replayObligation = replay.obligation;
  assert.throws(
    () => parseExecutionReclamationObservation(
      tombstone,
      replayFixture.specification,
      replayObligation,
    ),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.reclamation-invalid",
  );
  await assert.rejects(
    backend.observe(handle),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.test-backend.reclaimed",
  );
  await assert.rejects(
    backend.dispatch(handle),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.test-backend.reclaimed",
  );
});

test("in-memory retrieval keeps not-produced and transport interruption non-authoritative", async () => {
  const fixture = executionContractFixture("retrieval-not-applicable");
  const engine = new InMemoryExecutionBackendEngine();
  const backend = engine.facade(fixture.profile);
  const handle = await backend.allocate(
    fixture.specification,
    createFoundationExecutionAllocationKey(),
  );
  const terminal = await backend.dispatch(handle);
  await assert.rejects(
    backend.retrieve(handle, terminal),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.test-backend.retrieve",
  );
});

test("Reclamation reports remaining and integrity refusal without deleting allocation", async () => {
  const fixture = executionContractFixture("reclamation-results");
  let engine = new InMemoryExecutionBackendEngine();
  let backend = engine.facade(fixture.profile);
  const handle = await backend.allocate(
    fixture.specification,
    createFoundationExecutionAllocationKey(),
  );
  assert.equal((await backend.dispatch(handle)).processState, "terminal");
  const retirement = await reclamationHandoff({
    backend,
    specification: fixture.specification,
    handle,
    retirementCheckpointDigest: digest("retirement-results"),
    dispatchAuthorityConsumed: true,
  });
  const { binding, obligation } = retirement;

  engine.reportReclamationIntegrityRefusalOnce(handle);
  const integrityRefusal = await backend.reclaim(fixture.specification, binding, obligation);
  assert.equal(integrityRefusal.disposition, "integrity-refusal");
  assert.equal(integrityRefusal.obligationDigest, obligation.digest);
  assert.equal((await backend.observe(handle)).allocationState, "allocated");

  engine = InMemoryExecutionBackendEngine.reload(engine.snapshot(), fixture.profile);
  backend = engine.facade(fixture.profile);
  engine.reportReclamationRemainingOnce(handle);
  const remaining = await backend.reclaim(fixture.specification, binding, obligation);
  assert.equal(remaining.disposition, "remaining");
  assert.equal(remaining.obligationDigest, obligation.digest);
  assert.equal((await backend.observe(handle)).allocationState, "allocated");

  const substitutedBinding = compileExecutionReclamationBinding({
    specification: fixture.specification,
    handle,
    retirementCheckpointDigest: digest("another-retirement"),
    dispatchAuthorityConsumed: true,
    backendBinding: binding.backendBinding,
  });
  const substituted = compileExecutionReclamationObligation({
    specification: fixture.specification,
    handle,
    retirementCheckpointDigest: substitutedBinding.retirementCheckpointDigest,
    reclamationBinding: substitutedBinding,
  });
  await assert.rejects(
    backend.reclaim(fixture.specification, binding, substituted),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.reclamation-obligation-invalid",
  );

  engine = InMemoryExecutionBackendEngine.reload(engine.snapshot(), fixture.profile);
  backend = engine.facade(fixture.profile);
  assert.equal(
    (await backend.reclaim(fixture.specification, binding, obligation)).disposition,
    "reclaimed",
  );
});
