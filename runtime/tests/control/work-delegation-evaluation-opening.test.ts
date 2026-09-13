import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { compileFoundationCheckCellResourceSelectionV1 } from "../../src/foundation/check/execution-cell-v1.js";
import { withDeliveryOperationLock } from "../../src/foundation/control/delivery-operation-lock.js";
import { compileWorkDelegation } from "../../src/foundation/control/work-delegation-compilation.js";
import { compileWorkDelegationReservation, WORK_DELEGATION_RESERVATION_SCHEMA,
  type WorkDelegationAgentSelection, type WorkDelegationExecutionSlot } from "../../src/foundation/control/work-delegation.js";
import type { ControlJsonObject } from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import { deliveryWorkDecisionBasisDigest } from "../../src/foundation/process/delivery-state.js";
import { digestCanonical } from "../../src/foundation/validation/canonical.js";
import { CONNECTED_DIRECTOR_ID, CONNECTED_RUNTIME_ID, createConnectedDeliveryFixture } from "../support/connected-delivery-fixture.js";
import { executionContractFixture } from "../support/execution-contract-fixture.js";

// Authored UNRUN. Real preparation, admission, Builder and integration provide
// the retained mandate/Candidate. This assertion stops at the reserved Evaluate
// opening in real SQLite/replay. It does not dispatch the reserved Checks or
// reviewer, finalize Evidence, or claim automatic delegated continuation.
test("reserved evaluation joins the exact admitted Binding reference despite its additional implementation digest", async () => {
  const f = await createConnectedDeliveryFixture({ id: "reserved-evaluation-opening" });
  try {
    await f.prepare(); await f.admit();
    await f.continue({ edit: async repository => writeFile(join(repository, "src/demo.ts"), "export const value = 'ready';\n") });
    await f.integrate();
    const boundary = f.current("activeBoundary");
    const candidate = f.current("candidate");
    assert.ok(f.store.state().eligibleOperations.includes("delivery.evaluate"));
    const selected = ((boundary.payload.mandate as ControlJsonObject).checks as readonly ControlJsonObject[])
      .filter(check => check.finalRequired === true);
    assert.equal(selected.length, 1);
    const required = selected[0]!;
    const admittedBindings = required.bindings as readonly ControlJsonObject[];
    assert.equal(admittedBindings.length, 1);
    const admittedBinding = admittedBindings[0]!;
    assert.equal(typeof admittedBinding.implementationDigest, "string");
    assert.equal(typeof admittedBinding.id, "string");
    const binding = f.contract.checkBindings[admittedBinding.id as string];
    assert.ok(binding);
    assert.equal(binding.digest, admittedBinding.digest);
    const fixture = executionContractFixture("reserved-evaluation-opening");
    const resources = compileFoundationCheckCellResourceSelectionV1({ binding, profile: fixture.profile,
      image: { ...fixture.image, runnerContractDigest: digestCanonical("runner-contract"),
        runnerImplementationDigest: digestCanonical("runner-implementation"), toolInventoryDigest: digestCanonical("tool-inventory") } });
    const reviewer: WorkDelegationAgentSelection = {
      providerDescriptor: { id: "descriptor.opening-fixture", digest: digestCanonical("descriptor") },
      backendProfile: resources.backendProfile, image: resources.image,
      model: "model.opening-fixture", reasoning: "high", wallTimeMs: 1_000,
      limits: { tokens: null, events: 100, outputBytes: 1_048_576, toolCalls: null, processes: 8, storageBytes: 1_048_576 },
    };
    const checkSlot: Extract<WorkDelegationExecutionSlot, { purpose: "check" }> = {
      slotId: "slot.check", purpose: "check", phase: "final", selectionId: required.id as string,
      definition: required.definition as Extract<WorkDelegationExecutionSlot, { purpose: "check" }>["definition"],
      binding: { id: binding.id, digest: binding.digest }, ...resources, wallTimeMs: resources.limits.wallTimeMilliseconds,
    };
    assert.deepEqual(Object.keys(checkSlot.binding).sort(), ["digest", "id"]);
    const reviewerSlot: WorkDelegationExecutionSlot = { slotId: "slot.reviewer", purpose: "agent", role: "reviewer", selection: reviewer };
    const grant = compileWorkDelegation({ store: f.store, directorId: CONNECTED_DIRECTOR_ID, runtimeId: CONNECTED_RUNTIME_ID,
      submittedAt: f.now(), semanticMarkdown: "# Evaluate allowance\n\nReserve the exact final Check and one independent review.\n",
      allowedOperations: ["delivery.evaluate"], directions: { continue: null, evaluate: "# Evaluate\n\nReview the exact integrated Candidate.\n" },
      agentSelections: { builder: null, reviewer },
      ceilings: { operations: 1, agentAttempts: 1, reservedCellWallTimeMs: reviewer.wallTimeMs + checkSlot.wallTimeMs }, expiresAt: null });
    await withDeliveryOperationLock({ machineHome: f.machineHome, targetId: f.contract.targetId, deliveryId: f.deliveryId }, "evaluate", async () => {
      f.store.appendBatch(grant.appends);
      const state = f.store.state();
      assert.ok(state.journal.headDigest);
      const beforeInventory = f.store.logicalInventoryDigest();
      const beforeInvocations = f.invocations.length;
      const activityId = "activity.reserved-evaluation-opening";
      const reserve = (slots: readonly WorkDelegationExecutionSlot[]) => compileWorkDelegationReservation({
        schema: WORK_DELEGATION_RESERVATION_SCHEMA, reservationId: "reservation.evaluation-opening", activityId, operation: "delivery.evaluate",
        delegation: { kind: "work-delegation", id: grant.revision.recordId, revision: grant.revision.revision, digest: grant.revision.digest },
        decision: { journalHead: { sequence: state.journal.eventCount, digest: state.journal.headDigest! },
          basisDigest: deliveryWorkDecisionBasisDigest(state), reason: "evaluate-integrated-candidate" }, slots });
      const append = (slots: readonly WorkDelegationExecutionSlot[]) => f.store.append({ event: {
        eventId: "event.reserved-evaluation-opening", eventKind: "activity-started", occurredAt: f.now(),
        actor: { kind: "runtime", id: CONNECTED_RUNTIME_ID }, payload: { activityId, operation: "delivery.evaluate", reservation: reserve(slots) },
      } });
      for (const slots of [
        [{ ...checkSlot, binding: { ...checkSlot.binding, digest: digestCanonical("substituted-binding") } }, reviewerSlot],
        [reviewerSlot],
      ]) {
        assert.throws(() => append(slots), (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.delivery-reducer.delegation-checks");
        assert.deepEqual(f.store.state().journal, state.journal);
        assert.equal(f.store.logicalInventoryDigest(), beforeInventory);
        assert.equal(f.invocations.length, beforeInvocations);
        assert.deepEqual(f.current("candidate"), candidate);
      }
      const reservation = reserve([checkSlot, reviewerSlot]);
      const opened = append(reservation.slots);
      assert.deepEqual(opened.event.payload.reservation, reservation);
      assert.equal(opened.event.sequence, state.journal.eventCount + 1);
      assert.equal(opened.event.predecessorDigest, state.journal.headDigest);
      assert.deepEqual(f.store.state().delegation.charged, reservation.charges);
      assert.deepEqual(reservation.charges, { operations: 1, agentAttempts: 1,
        reservedCellWallTimeMs: checkSlot.wallTimeMs + reviewer.wallTimeMs });
      assert.equal(f.store.state().activities.find(activity => activity.id === activityId)?.stage, "started");
      assert.equal(f.invocations.length, beforeInvocations);
      assert.deepEqual(f.current("candidate"), candidate);
      assert.deepEqual(f.current("activeBoundary"), boundary);
    });
    await f.reopenStore();
    assert.equal(f.store.state().activities.find(activity => activity.id === "activity.reserved-evaluation-opening")?.stage, "started");
    assert.equal(f.store.state().delegation.charged.operations, 1);
    await f.store.verifyIntegrity();
  } finally { await f.dispose(); }
});
