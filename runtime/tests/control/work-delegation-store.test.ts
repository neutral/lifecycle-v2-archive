import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  compileAgentPreIntentRefusalAppend,
  compileDeliveryActivityCompletionAppend,
} from "../../src/foundation/control/activity.js";
import { withDeliveryOperationLock } from "../../src/foundation/control/delivery-operation-lock.js";
import { compileDeliveryGeneration } from "../../src/foundation/control/delivery-view.js";
import { publicObservedDeliveryState } from "../../src/foundation/control/public-view.js";
import { compileAgentActivityOpening, compileStandingDirectorBrief } from "../../src/foundation/control/director-brief.js";
import { compileControlRecordEvent } from "../../src/foundation/control/model.js";
import { openControlRecordStore, type ControlRecordStore } from "../../src/foundation/control/store.js";
import type { ControlRecordRevision } from "../../src/foundation/control/types.js";
import { compileWorkDelegation, type CompiledWorkDelegation } from "../../src/foundation/control/work-delegation-compilation.js";
import { compileWorkDelegationStopAppend, compileWorkDelegationStopRequest, type WorkDelegationStopRequest } from "../../src/foundation/control/work-delegation-stop.js";
import {
  WORK_DELEGATION_RESERVATION_SCHEMA,
  compileWorkDelegationReservation,
  type WorkDelegationAgentSelection,
} from "../../src/foundation/control/work-delegation.js";
import { FoundationError } from "../../src/foundation/error.js";
import { deliveryWorkDecisionBasisDigest } from "../../src/foundation/process/delivery-state.js";
import { reduceDeliveryEvents } from "../../src/foundation/process/delivery-reducer.js";
import { digestCanonical } from "../../src/foundation/validation/canonical.js";
import {
  CONNECTED_DIRECTOR_ID,
  CONNECTED_RUNTIME_ID,
  createConnectedDeliveryFixture,
  type ConnectedDeliveryFixture,
} from "../support/connected-delivery-fixture.js";

// Authored UNRUN. Preparation/admission use existing connected Runtime fixtures;
// the first course then supplies exact owner-level Activity events without
// dispatching a delegated Agent. The second course exercises one existing manual
// Builder with deterministic external execution. These are real SQLite/reducer
// and lock tests, not automatic-run, process-crash, installed or provider
// qualification. The second connection is deliberately opened before new work.
function code(expected: string) {
  return (error: unknown): boolean => error instanceof FoundationError && error.code === expected;
}

function exactRequest(request: WorkDelegationStopRequest | null): WorkDelegationStopRequest {
  assert.ok(request);
  return request;
}

function reference(revision: ControlRecordRevision) {
  return { kind: "work-delegation" as const, id: revision.recordId, revision: revision.revision, digest: revision.digest };
}

function selectedAgent(): WorkDelegationAgentSelection {
  return {
    providerDescriptor: { id: "descriptor.store-test", digest: digestCanonical({ descriptor: "store-test" }) },
    backendProfile: { profileId: "lifecycle.execution-backend-profile.fault-injection.v1", profileDigest: digestCanonical({ profile: "store-test" }), implementationDigest: digestCanonical({ implementation: "store-test" }) },
    image: { imageId: "image.store-test", imageDigest: digestCanonical({ image: "store-test" }) },
    model: "model.store-test", reasoning: "high", wallTimeMs: 1_000,
    limits: { tokens: null, events: 1_000, outputBytes: 1_048_576, toolCalls: null, processes: 128, storageBytes: 268_435_456 },
  };
}

function compileGrant(f: ConnectedDeliveryFixture, operation: "delivery.continue" | "delivery.integrate" = "delivery.continue") {
  return compileWorkDelegation({
    store: f.store, directorId: CONNECTED_DIRECTOR_ID, runtimeId: CONNECTED_RUNTIME_ID, submittedAt: f.now(),
    semanticMarkdown: "# Finite work allowance\n\nUse only this supplied resource allowance under the admitted mandate.\n",
    allowedOperations: [operation],
    directions: { continue: operation === "delivery.continue" ? "Complete useful work inside the admitted mandate.\n" : null, evaluate: null },
    agentSelections: { builder: operation === "delivery.continue" ? selectedAgent() : null, reviewer: null },
    ceilings: { operations: 4, agentAttempts: operation === "delivery.continue" ? 4 : 0, reservedCellWallTimeMs: operation === "delivery.continue" ? 4_000 : 0 },
    expiresAt: null,
  });
}

function openReservedBuilder(f: ConnectedDeliveryFixture, grant: CompiledWorkDelegation, activityId: string) {
  const state = f.store.state();
  assert.ok(state.journal.headDigest);
  assert.ok(grant.payload.agentSelections.builder);
  const reservation = compileWorkDelegationReservation({
    schema: WORK_DELEGATION_RESERVATION_SCHEMA, reservationId: `reservation.${activityId}`,
    delegation: reference(grant.revision), activityId, operation: "delivery.continue",
    decision: { journalHead: { sequence: state.journal.eventCount, digest: state.journal.headDigest },
      basisDigest: deliveryWorkDecisionBasisDigest(state), reason: "develop-candidate" },
    slots: [{ slotId: "slot.builder", purpose: "agent", role: "builder", selection: grant.payload.agentSelections.builder }],
  });
  const opened = f.store.append({ event: {
    eventId: `event.${activityId}.opened`, eventKind: "activity-started", occurredAt: f.now(),
    actor: { kind: "runtime", id: CONNECTED_RUNTIME_ID }, payload: { activityId, operation: "delivery.continue", reservation },
  } });
  return { reservation, event: opened.event };
}

function settleBeforeInvocation(f: ConnectedDeliveryFixture, activityId: string): void {
  f.store.append(compileAgentPreIntentRefusalAppend({ store: f.store, activityId,
    refusedAt: f.now(), runtimeId: CONNECTED_RUNTIME_ID,
    diagnosticCode: "lifecycle.work-delegation.store-fixture-refusal",
    refusalFactsDigest: digestCanonical({ fixture: "no-invocation", activityId }),
  }));
  f.store.append(compileDeliveryActivityCompletionAppend({ store: f.store, activityId,
    outcome: "abandoned", completedAt: f.now(), runtimeId: CONNECTED_RUNTIME_ID,
  }));
}

async function secondConnection(f: ConnectedDeliveryFixture, readOnly = false): Promise<ControlRecordStore> {
  return openControlRecordStore({ root: f.store.paths.root, identity: f.store.identity, create: false, readOnly });
}

function lockSelection(f: ConnectedDeliveryFixture) {
  return { machineHome: f.machineHome, targetId: f.contract.targetId, deliveryId: f.deliveryId };
}

test("pending stop survives reopened SQLite custody, blocks new reservations and folds only after the held operation settles", async () => {
  const f = await createConnectedDeliveryFixture({ id: "work-stop-reserved" });
  let stopStore: ControlRecordStore | null = null;
  try {
    await f.prepare();
    await f.admit();
    const originalCandidate = f.store.state().subjects.candidate;
    const originalBoundary = f.store.state().subjects.activeBoundary;
    const grant = compileGrant(f);
    f.store.appendBatch(grant.appends);
    // A previously compiled replacement must still encounter the SQL boundary.
    const previouslyCompiledReplacement = compileGrant(f);
    stopStore = await secondConnection(f);
    const beforeOpening = stopStore.state().journal;
    const activityId = "activity.delegated-builder-held";
    let retainedRequest: WorkDelegationStopRequest | null = null;
    const committedStops: ReturnType<ControlRecordStore["requestWorkDelegationStop"]>[] = [];
    await withDeliveryOperationLock(lockSelection(f), "continue", async () => {
      const opened = openReservedBuilder(f, grant, activityId);
      const exactHead = f.store.state().journal;
      const exactInventory = f.store.logicalInventoryDigest();
      const boundaryBasis = f.store.getRevision(originalBoundary!.id, originalBoundary!.revision)!.payload.basis as {
        productBaseCommit: string; productBaseTree: string; repositoryContractDigest: `sha256:${string}`;
      };
      const generation = (store: ControlRecordStore) => compileDeliveryGeneration({ store,
        physical: { disposition: "active", archiveManifestDigest: null },
        repository: { headCommit: boundaryBasis.productBaseCommit, headTree: boundaryBasis.productBaseTree,
          repositoryContractDigest: boundaryBasis.repositoryContractDigest },
      });
      const beforeStopGeneration = generation(f.store);
      assert.notDeepEqual(exactHead, beforeOpening);
      assert.deepEqual(stopStore!.state().journal, beforeOpening, "The independent stop connection starts with older replay");
      assert.deepEqual(f.store.state().delegation.charged, opened.reservation.charges);
      const requestInput = { delegation: reference(grant.revision), requestedBy: CONNECTED_DIRECTOR_ID, requestedAt: f.now() };
      for (const delegation of [
        { ...requestInput.delegation, id: "work-delegation.other" },
        { ...requestInput.delegation, revision: 2 },
        { ...requestInput.delegation, digest: digestCanonical({ wrong: "grant" }) },
      ]) assert.throws(() => stopStore!.requestWorkDelegationStop({ ...requestInput, delegation }), code("lifecycle.control-record-store.work-stop-subject"));
      assert.throws(() => stopStore!.requestWorkDelegationStop({ ...requestInput, requestedBy: "director.other" }), code("lifecycle.control-record-store.work-stop-subject"));
      assert.equal(stopStore!.getWorkDelegationStopRequest(), null);

      // Simulate a lost caller return after the real commit, not a process crash.
      assert.throws(() => {
        const committed = stopStore!.requestWorkDelegationStop(requestInput);
        assert.equal(committed.disposition, "pending");
        committedStops.push(committed);
        retainedRequest = committed.request;
        throw new Error("lost committed stop response");
      }, /lost committed stop response/u);
      assert.ok(retainedRequest);
      const retry = stopStore!.requestWorkDelegationStop({ ...requestInput, requestedAt: f.now() });
      assert.deepEqual({ request: retry.request, disposition: retry.disposition }, { request: retainedRequest, disposition: "pending" });
      assert.deepEqual(retry.observation.state.journal, exactHead);
      assert.equal(retry.observation.seal, null);
      assert.deepEqual(retry.observation.head, f.store.listEvents(exactHead.eventCount - 1, 1)[0]);
      assert(Object.isFrozen(retry.observation));
      assert.deepEqual(stopStore!.state().journal, exactHead, "Request refreshes its own replay without appending");
      assert.deepEqual(f.store.state().journal, exactHead);
      assert.equal(f.store.logicalInventoryDigest(), exactInventory);
      assert.deepEqual(f.store.getWorkDelegationStopRequest(), retainedRequest);
      const pendingGeneration = generation(f.store);
      assert.notEqual(pendingGeneration.digest, beforeStopGeneration.digest,
        "A durable stop invalidates stale work forms even before any Journal or inventory change");
      assert.deepEqual({ ...pendingGeneration, digest: beforeStopGeneration.digest }, beforeStopGeneration,
        "The stop advances the opaque token without inventing another Journal state");
      assert.equal(f.store.state().delegation.current?.stopped, false);
      await assert.rejects(withDeliveryOperationLock(lockSelection(f), "continue", async () => undefined), code("operation.busy"));

      stopStore!.close();
      stopStore = await secondConnection(f);
      assert.deepEqual(generation(stopStore), pendingGeneration,
        "Disk reopen preserves the same pending-stop freshness token");
      assert.deepEqual(stopStore.getWorkDelegationStopRequest(), retainedRequest);
      assert.deepEqual(stopStore.state().journal, exactHead);
      const readOnly = await secondConnection(f, true);
      try {
        assert.deepEqual(readOnly.getWorkDelegationStopRequest(), retainedRequest);
        assert.throws(() => readOnly.requestWorkDelegationStop(requestInput), code("lifecycle.control-record-store.read-only"));
      } finally { readOnly.close(); }

      assert.throws(() => f.store.append({ event: {
        eventId: "event.unreserved-opening-while-stopped", eventKind: "activity-started", occurredAt: f.now(),
        actor: { kind: "runtime", id: CONNECTED_RUNTIME_ID }, payload: { activityId: "activity.unreserved", operation: "delivery.integrate" },
      } }), code("lifecycle.control-record-store.work-stop-pending"));
      const replacementTime = f.now();
      const delayedReplacement = previouslyCompiledReplacement.appends.map(append => ({ ...append, event: { ...append.event, occurredAt: replacementTime } }));
      assert.throws(() => f.store.appendBatch(delayedReplacement), code("lifecycle.control-record-store.work-stop-pending"));
      assert.equal(f.store.getRevision(previouslyCompiledReplacement.standingBriefs.continue!.compiled.recordId, 1), null,
        "Earlier Brief inserts in the refused grant batch roll back");
      assert.equal(f.store.getRevision(grant.revision.recordId, 2), null);
      assert.equal(f.store.logicalInventoryDigest(), exactInventory);
      const stopAppend = compileWorkDelegationStopAppend({ request: exactRequest(retainedRequest), runtimeId: CONNECTED_RUNTIME_ID, stoppedAt: f.now() });
      assert.throws(() => f.store.append(stopAppend), code("lifecycle.delivery-reducer.delegation-stop"));
      assert.deepEqual(f.store.getWorkDelegationStopRequest(), retainedRequest, "A premature fold rolls back without consuming custody");
      await assert.rejects(f.store.seal({ closure: { recordId: "unused.closure", revision: 1, digest: digestCanonical({ unused: "closure" }) }, sealedAt: f.now() }), code("lifecycle.control-record-store.seal-work-stop"));

      settleBeforeInvocation(f, activityId);
      assert.equal(f.store.state().activities.find(activity => activity.id === activityId)?.stage, "completed");
      assert.deepEqual(f.store.state().delegation.charged, opened.reservation.charges, "Abandonment does not refund the reservation");
      assert.deepEqual(f.store.state().subjects.candidate, originalCandidate);
      assert.deepEqual(f.store.state().subjects.activeBoundary, originalBoundary);
    });

    assert.ok(retainedRequest);
    const settledHead = f.store.state().journal;
    const fold = compileWorkDelegationStopAppend({ request: exactRequest(retainedRequest), runtimeId: CONNECTED_RUNTIME_ID, stoppedAt: f.now() });
    for (const payload of [
      { ...fold.event.payload, requestDigest: digestCanonical({ wrong: "request" }) },
      { ...fold.event.payload, requestedBy: "director.other" },
      { ...fold.event.payload, requestedAt: f.now() },
    ]) {
      assert.throws(() => f.store.append({ event: { ...fold.event, payload } }), code("lifecycle.control-record-store.work-stop-integrity"));
      assert.deepEqual(f.store.getWorkDelegationStopRequest(), retainedRequest);
      assert.deepEqual(f.store.state().journal, settledHead);
    }
    assert.throws(() => compileWorkDelegationStopAppend({ request: { ...exactRequest(retainedRequest), digest: digestCanonical({ forged: true }) }, runtimeId: CONNECTED_RUNTIME_ID, stoppedAt: f.now() }), code("lifecycle.work-delegation.stop-request-invalid"));
    await withDeliveryOperationLock(lockSelection(f), "stop", async () => {
      const result = f.store.append(fold);
      assert.equal(result.event.sequence, settledHead.eventCount + 1);
      assert.deepEqual(result.event.payload, { requestDigest: exactRequest(retainedRequest).digest, requestedAt: exactRequest(retainedRequest).requestedAt, requestedBy: CONNECTED_DIRECTOR_ID });
      assert.equal(f.store.getWorkDelegationStopRequest(), null);
      assert.equal(f.store.state().delegation.current?.stopped, true);
      assert.deepEqual(f.store.append(fold), result, "An exact lost fold return reopens the same Journal event");
    });
    const stoppedHead = f.store.state().journal;
    // Bypass operational custody only in a copied Journal: independent replay
    // must reject an internally digested stop requested before its grant existed.
    const exactEvents = f.store.listEvents(0, 10_000);
    const exactStop = exactEvents.at(-1)!;
    assert.equal(exactStop.eventKind, "work-delegation-stopped");
    const earlierRequest = compileWorkDelegationStopRequest({
      storeId: f.store.identity.storeId, processId: f.deliveryId,
      delegation: reference(grant.revision), requestedBy: CONNECTED_DIRECTOR_ID,
      requestedAt: new Date(Date.parse(grant.revision.createdAt) - 1).toISOString(),
    });
    const earlierStop = compileWorkDelegationStopAppend({ request: earlierRequest, runtimeId: CONNECTED_RUNTIME_ID, stoppedAt: exactStop.occurredAt });
    const changedStop = compileControlRecordEvent({ storeId: exactStop.storeId, processId: exactStop.processId,
      sequence: exactStop.sequence, predecessorDigest: exactStop.predecessorDigest, event: earlierStop.event });
    assert.throws(() => reduceDeliveryEvents([...exactEvents.slice(0, -1), changedStop],
      selected => f.store.getRevision(selected.recordId, selected.revision)), code("lifecycle.delivery-reducer.delegation-stop"));
    assert.deepEqual(f.store.state().journal, stoppedHead);
    assert.deepEqual(f.store.listEvents(0, 10_000), exactEvents);
    const folded = stopStore!.requestWorkDelegationStop({ delegation: reference(grant.revision), requestedBy: CONNECTED_DIRECTOR_ID, requestedAt: f.now() });
    assert.deepEqual({ request: folded.request, disposition: folded.disposition }, { request: retainedRequest, disposition: "stopped" });
    assert.deepEqual(folded.observation.state.journal, stoppedHead);
    assert.deepEqual(folded.observation.head, exactStop);
    assert.equal(folded.observation.seal, null);
    const earlier = committedStops[0]!;
    assert.deepEqual(earlier.request, folded.request, "Receipt idempotency does not require an unchanged observation");
    assert.notDeepEqual(earlier.observation.state.journal, folded.observation.state.journal);
    const earlierView = publicObservedDeliveryState({ identity: f.store.identity, ...earlier.observation,
      physical: { disposition: "active", archiveManifestDigest: null } });
    assert.equal(earlierView.delegation.current?.stopped, false);
    assert.equal(earlierView.activities.find(activity => activity.id === activityId)?.stage, "started");
    const foldedView = publicObservedDeliveryState({ identity: f.store.identity, ...folded.observation,
      physical: { disposition: "active", archiveManifestDigest: null } });
    assert.equal(foldedView.delegation.current?.stopped, true);
    assert.equal(foldedView.activities.find(activity => activity.id === activityId)?.stage, "completed");
    assert.deepEqual(f.store.state().journal, stoppedHead);
    stopStore!.close(); stopStore = null;
    await f.reopenStore();
    assert.equal(f.store.getWorkDelegationStopRequest(), null);
    assert.equal(f.store.state().delegation.current?.stopped, true);
    assert.deepEqual(f.store.state().delegation.charged, { operations: 1, agentAttempts: 1, reservedCellWallTimeMs: 1_000 });
    await withDeliveryOperationLock(lockSelection(f), "continue", async () => {
      const replacement = compileGrant(f);
      f.store.appendBatch(replacement.appends);
      assert.equal(replacement.revision.recordId, grant.revision.recordId);
      assert.equal(replacement.revision.revision, 2);
      assert.deepEqual(replacement.payload.replaces, reference(grant.revision));
      assert.equal(f.store.state().delegation.current?.stopped, false);
      assert.deepEqual(f.store.state().delegation.charged, replacement.charged);
      assert.deepEqual(f.store.getRevision(grant.revision.recordId, 1), grant.revision);
      const fresh = openReservedBuilder(f, replacement, "activity.delegated-builder-after-stop");
      assert.notEqual(fresh.reservation.reservationId, "reservation.activity.delegated-builder-held");
      settleBeforeInvocation(f, fresh.reservation.activityId);
      assert.deepEqual(f.store.state().delegation.charged, { operations: 2, agentAttempts: 2, reservedCellWallTimeMs: 2_000 });
    });
    await f.store.verifyIntegrity();
  } finally { stopStore?.close(); await f.dispose(); }
});

test("an out-of-grant manual Builder refuses, then an explicit stop permits its normal Candidate continuation", async () => {
  const f = await createConnectedDeliveryFixture({ id: "work-stop-manual" });
  let stopStore: ControlRecordStore | null = null;
  try {
    await f.prepare(); await f.admit();
    const grant = compileGrant(f, "delivery.integrate");
    f.store.appendBatch(grant.appends);
    const beforeCandidate = f.store.state().subjects.candidate;
    assert.ok(beforeCandidate);
    stopStore = await secondConnection(f);
    const direction = "# Continue\n\nComplete the admitted source change after stopping the narrower grant.\n";
    const activityId = "activity.manual-after-explicit-stop";
    const priorJournal = f.store.state().journal;
    const priorInvocations = f.invocations.length;
    const priorBaseline = f.store.listCurrentRevisions({ recordKinds: ["check-receipt"] });
    const priorBoundary = f.store.state().subjects.activeBoundary;
    const opening = compileAgentActivityOpening({ store: f.store, activityId, operation: "delivery.continue",
      semanticMarkdown: direction, directorId: CONNECTED_DIRECTOR_ID, runtimeId: CONNECTED_RUNTIME_ID,
      submittedAt: f.now(), startedAt: f.now() });
    await withDeliveryOperationLock(lockSelection(f), "continue", async () => {
      assert.throws(() => f.store.appendBatch(opening.appends), code("lifecycle.delivery-reducer.delegation-reservation"));
    });
    assert.deepEqual(f.store.state().journal, priorJournal);
    assert.equal(f.store.getRevision(opening.revision.recordId, opening.revision.revision), null);
    assert.equal(f.invocations.length, priorInvocations);
    const stopped = stopStore.requestWorkDelegationStop({ delegation: reference(grant.revision), requestedBy: CONNECTED_DIRECTOR_ID, requestedAt: f.now() });
    assert.equal(stopped.disposition, "pending");
    await withDeliveryOperationLock(lockSelection(f), "stop", async () => {
      f.store.append(compileWorkDelegationStopAppend({ request: stopped.request, runtimeId: CONNECTED_RUNTIME_ID, stoppedAt: f.now() }));
    });
    assert.equal(f.store.getWorkDelegationStopRequest(), null);
    assert.equal(f.store.state().delegation.current?.stopped, true);
    await withDeliveryOperationLock(lockSelection(f), "continue", async () => {
      await f.continue({ activityId, direction, edit: async repository => {
        await writeFile(join(repository, "src/demo.ts"), "export const value = 2;\n");
      } });
    });
    const completed = f.store.state();
    assert.equal(completed.activities.find(activity => activity.id === activityId)?.stage, "completed");
    assert.ok(completed.subjects.candidate);
    assert.ok(completed.subjects.candidate.revision > beforeCandidate.revision);
    assert.notEqual(completed.subjects.candidate.digest, beforeCandidate.digest);
    assert.deepEqual(completed.delegation.charged, { operations: 0, agentAttempts: 0, reservedCellWallTimeMs: 0 },
      "The stopped grant does not charge the separately selected normal manual route");
    assert.deepEqual(completed.subjects.activeBoundary, priorBoundary);
    assert.deepEqual(f.store.listCurrentRevisions({ recordKinds: ["check-receipt"] }), priorBaseline);
    const briefEvent = f.store.listEvents(0, 10_000).find(event => event.eventKind === "director-brief-submitted" && event.payload.activityId === activityId);
    assert.ok(briefEvent?.subject);
    const brief = f.store.getRevision(briefEvent.subject.recordId, briefEvent.subject.revision);
    assert.ok(brief);
    assert.equal(brief.semanticMarkdown, direction);
    assert.equal(brief.semanticAuthor.id, CONNECTED_DIRECTOR_ID);
    assert.deepEqual(brief.payload.scope, { kind: "activity", activityId });
    const start = f.store.listEvents(0, 10_000).find(event => event.eventKind === "activity-started" && event.payload.activityId === activityId);
    assert.ok(start);
    assert.equal(Object.hasOwn(start.payload, "reservation"), false);
    assert.equal(f.invocations.filter(invocation => invocation.activityId === activityId).length, 1);
    await f.store.verifyIntegrity();
  } finally { stopStore?.close(); await f.dispose(); }
});

// The Journal reducer observes event order, not SQLite commit boundaries. These
// cases exercise the Store's atomic standing-direction boundary without opening
// or dispatching delegated work. Authored UNRUN.
test("standing directions retain only with their exact complete Work Delegation batch", async () => {
  const f = await createConnectedDeliveryFixture({ id: "work-standing-brief-batch" });
  try {
    await f.prepare(); await f.admit();
    const grant = compileGrant(f);
    const direction = grant.standingBriefs.continue!;
    const before = f.store.state();
    const beforeInventory = f.store.logicalInventoryDigest();
    const beforeInvocations = f.invocations.length;
    await withDeliveryOperationLock(lockSelection(f), "continue", async () => {
      assert.throws(() => f.store.append(direction.append),
        code("lifecycle.control-record-store.work-delegation-brief-batch"));
      assert.deepEqual(f.store.state(), before);
      assert.equal(f.store.logicalInventoryDigest(), beforeInventory);
      assert.equal(f.store.getRevision(direction.compiled.recordId, 1), null);
      assert.equal(f.store.getRevision(grant.revision.recordId, 1), null);
      assert.equal(f.invocations.length, beforeInvocations);

      const retained = f.store.appendBatch(grant.appends);
      assert.equal(retained.length, 2);
      assert.equal(retained[0]!.event.sequence, before.journal.eventCount + 1);
      assert.equal(retained[1]!.event.sequence, before.journal.eventCount + 2);
      assert.deepEqual(f.store.getRevision(direction.compiled.recordId, 1), direction.compiled);
      assert.deepEqual(f.store.getRevision(grant.revision.recordId, 1), grant.revision);

      const replacement = compileGrant(f);
      const extraDirection = compileStandingDirectorBrief({
        store: f.store, delegationId: replacement.revision.recordId,
        delegationRevision: replacement.revision.revision, operation: "delivery.evaluate",
        semanticMarkdown: "# Review\n\nReview the exact integrated Candidate.\n",
        submittedAt: replacement.revision.createdAt,
        directorId: CONNECTED_DIRECTOR_ID, runtimeId: CONNECTED_RUNTIME_ID,
      });
      assert.equal(replacement.payload.directions.evaluate, null);
      const beforeReplacement = f.store.state();
      const replacementInventory = f.store.logicalInventoryDigest();
      // Both Briefs name this same forthcoming grant coordinate, but this grant
      // selects only Continue. An unrelated leftover direction cannot commit.
      assert.throws(() => f.store.appendBatch([
        replacement.standingBriefs.continue!.append,
        extraDirection.append,
        replacement.appends.at(-1)!,
      ]), code("lifecycle.control-record-store.work-delegation-brief-batch"));
      assert.deepEqual(f.store.state(), beforeReplacement);
      assert.equal(f.store.logicalInventoryDigest(), replacementInventory);
      assert.equal(f.store.getRevision(replacement.standingBriefs.continue!.compiled.recordId, 1), null);
      assert.equal(f.store.getRevision(extraDirection.compiled.recordId, 1), null);
      assert.equal(f.store.getRevision(replacement.revision.recordId, replacement.revision.revision), null);
      assert.equal(f.invocations.length, beforeInvocations);

      f.store.appendBatch(replacement.appends);
      assert.deepEqual(f.store.getRevision(replacement.revision.recordId, replacement.revision.revision), replacement.revision);
      assert.deepEqual(f.store.state().delegation.charged, before.delegation.charged);
      assert.deepEqual(f.store.state().subjects, before.subjects);
    });
    await f.reopenStore();
    assert.equal(f.store.state().delegation.current?.reference.revision, 2);
    assert.deepEqual(f.store.state().delegation.charged, before.delegation.charged);
    assert.equal(f.invocations.length, beforeInvocations);
    await f.store.verifyIntegrity();
  } finally { await f.dispose(); }
});
