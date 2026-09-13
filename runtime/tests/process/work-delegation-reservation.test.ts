import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { compileFoundationCheckCellResourceSelectionV1 } from "../../src/foundation/check/execution-cell-v1.js";
import { compileWorkDelegation } from "../../src/foundation/control/work-delegation-compilation.js";
import { compileWorkDelegationStopAppend } from "../../src/foundation/control/work-delegation-stop.js";
import { withDeliveryOperationLock } from "../../src/foundation/control/delivery-operation-lock.js";
import { FoundationError } from "../../src/foundation/error.js";
import { finalCheckSelections } from "../../src/foundation/process/evaluation-preparation-v7.js";
import { deliveryWorkDecisionBasisDigest } from "../../src/foundation/process/delivery-state.js";
import {
  compileWorkDelegationReservationForDecision,
  selectWorkDelegationAgentResources,
  type WorkDelegationReservationOwners,
} from "../../src/foundation/process/work-delegation-reservation.js";
import { digestCanonical } from "../../src/foundation/validation/canonical.js";
import { installedHarness } from "../support/agent-cell-runtime-fixture.js";
import { CONNECTED_BACKEND_LIMITS, CONNECTED_DIRECTOR_ID, CONNECTED_RUNTIME_ID, createConnectedDeliveryFixture } from "../support/connected-delivery-fixture.js";
import { executionContractFixture } from "../support/execution-contract-fixture.js";

// Authored UNRUN. The integrated Candidate and grant use real existing Runtime,
// Git and SQLite owners. Only installed Agent/Check resource observations are
// injected. The reservation compiler itself runs; no finalized reservation,
// subsequent Activity, provider response or resource accounting is manufactured.
// This test does not establish automatic progression or physical availability.
test("decision reservation compiles exact retained resources and all final Checks without spending or opening work", async () => {
  const f = await createConnectedDeliveryFixture({ id: "reservation-compiler" });
  try {
    await f.prepare(); await f.admit();
    await f.continue({ edit: async repository => writeFile(join(repository, "src/demo.ts"), "export const value = 'integrated';\n") });
    await f.integrate();
    const candidate = f.current("candidate");
    const boundary = f.current("activeBoundary");
    const harness = installedHarness({ machineHome: f.machineHome, now: f.now, backendLimits: CONNECTED_BACKEND_LIMITS });
    const installedCompile = harness.options.compileInstalled;
    assert.ok(installedCompile);
    let substitutedImage = false;
    const observedModels: { configuration: string; investment: string; reasoning: string }[] = [];
    let checkObservations = 0;
    const checkFixture = executionContractFixture("reservation-compiler-check");
    const selectedCheckResources = { profile: checkFixture.profile, image: {
      ...checkFixture.image, runnerContractDigest: digestCanonical("reservation-check-runner-contract"),
      runnerImplementationDigest: digestCanonical("reservation-check-runner"), toolInventoryDigest: digestCanonical("reservation-check-tools"),
    } };
    const owners: WorkDelegationReservationOwners = {
      compileAgent(input) {
        observedModels.push({ configuration: input.configuration.model, investment: input.investment.model, reasoning: input.investment.reasoning });
        const compiled = installedCompile(input);
        return substitutedImage ? { ...compiled, installed: { ...compiled.installed,
          image: { ...compiled.installed.image, imageDigest: digestCanonical("other-installed-image") } } } : compiled;
      },
      checkResources() { checkObservations += 1; return selectedCheckResources; },
    };
    const reviewer = selectWorkDelegationAgentResources({ configuration: f.configuration, operation: "delivery.evaluate" }, owners);
    const checks = finalCheckSelections(boundary, f.contract);
    assert.equal(checks.length, 1);
    const expectedChecks = checks.map(check => ({ check,
      resources: compileFoundationCheckCellResourceSelectionV1({ binding: check.binding, ...selectedCheckResources }) }));
    const totalWallTime = reviewer.wallTimeMs + expectedChecks.reduce((sum, value) => sum + value.resources.limits.wallTimeMilliseconds, 0);
    const direction = "# Independent review\n\nReview the exact integrated Candidate and every required proposition.\n";
    const setGrant = async (wallTime: number, expiresAt: string | null = null) => {
      const grant = compileWorkDelegation({ store: f.store, directorId: CONNECTED_DIRECTOR_ID, runtimeId: CONNECTED_RUNTIME_ID,
        submittedAt: f.now(), semanticMarkdown: "# Finite evaluation allowance\n\nUse only the selected review and Check resources.\n",
        allowedOperations: ["delivery.evaluate", "delivery.integrate"], directions: { continue: null, evaluate: direction },
        agentSelections: { builder: null, reviewer }, ceilings: { operations: 2, agentAttempts: 1, reservedCellWallTimeMs: wallTime }, expiresAt });
      await withDeliveryOperationLock({ machineHome: f.machineHome, targetId: f.contract.targetId, deliveryId: f.deliveryId }, "work-grant", async () => {
        f.store.appendBatch(grant.appends);
      });
      return grant;
    };
    let grant = await setGrant(totalWallTime);
    const input = () => {
      const state = f.store.state();
      assert.ok(state.journal.headDigest);
      return { store: f.store, contract: f.contract,
        configuration: { ...f.configuration, model: "changed-default", reasoning: "low" },
        activityId: "activity.reservation-compiler", observedAt: f.now(),
        decision: { operation: "delivery.evaluate" as const, reason: "evaluate-integrated-candidate" as const,
          basisDigest: deliveryWorkDecisionBasisDigest(state), journalHead: { sequence: state.journal.eventCount, digest: state.journal.headDigest } } };
    };
    const unchanged = () => ({ state: f.store.state(), inventory: f.store.logicalInventoryDigest(), invocations: f.invocations.length, dispatches: harness.dispatchCount() });
    const before = unchanged();
    const request = input();
    const reservation = compileWorkDelegationReservationForDecision(request, owners);
    assert.deepEqual(unchanged(), before);
    assert.deepEqual(reservation.delegation, { kind: "work-delegation", id: grant.revision.recordId, revision: grant.revision.revision, digest: grant.revision.digest });
    assert.deepEqual(reservation.decision, { journalHead: request.decision.journalHead,
      basisDigest: request.decision.basisDigest, reason: request.decision.reason });
    assert.deepEqual(reservation.charges, { operations: 1, agentAttempts: 1, reservedCellWallTimeMs: totalWallTime });
    assert.deepEqual(reservation.slots.filter(slot => slot.purpose === "agent").map(slot => slot.selection), [reviewer]);
    const actualChecks = reservation.slots.filter(slot => slot.purpose === "check");
    assert.equal(actualChecks.length, expectedChecks.length);
    for (const { check, resources } of expectedChecks) {
      const slot = actualChecks.find(value => value.selectionId === check.id);
      assert.ok(slot);
      assert.deepEqual(slot.definition, check.definition);
      assert.deepEqual(slot.binding, { id: check.bindingId, digest: check.binding.digest });
      assert.deepEqual(slot.backendProfile, resources.backendProfile);
      assert.deepEqual(slot.image, resources.image);
      assert.deepEqual(slot.limits, resources.limits);
      assert.equal(slot.wallTimeMs, resources.limits.wallTimeMilliseconds);
    }
    assert.deepEqual(observedModels.at(-1), { configuration: reviewer.model, investment: reviewer.model, reasoning: reviewer.reasoning });
    assert.equal(checkObservations, 1);
    assert.ok(grant.standingBriefs.evaluate);
    assert.equal(grant.standingBriefs.evaluate.compiled.semanticMarkdown, direction);
    assert.deepEqual(f.store.getRevision(grant.standingBriefs.evaluate.compiled.recordId, 1), grant.standingBriefs.evaluate.compiled);
    assert.deepEqual(compileWorkDelegationReservationForDecision(request, owners), reservation, "Repeated read-only planning neither charges nor creates another reservation identity");

    const refuses = (request: Parameters<typeof compileWorkDelegationReservationForDecision>[0], reason: string) => {
      const beforeRefusal = unchanged();
      assert.throws(() => compileWorkDelegationReservationForDecision(request, owners), (error: unknown) => {
        assert.ok(error instanceof FoundationError);
        assert.equal(error.code, "lifecycle.work-delegation.reservation-context");
        assert.deepEqual(error.observedFacts, { reason });
        return true;
      });
      assert.deepEqual(unchanged(), beforeRefusal);
    };
    substitutedImage = true;
    refuses(input(), "installed-selection-unavailable");
    substitutedImage = false;
    const exact = input();
    refuses({ ...exact, decision: { ...exact.decision, basisDigest: digestCanonical("other-basis") } }, "currentness");
    refuses({ ...exact, decision: { ...exact.decision, journalHead: { ...exact.decision.journalHead, sequence: exact.decision.journalHead.sequence - 1 } } }, "currentness");
    refuses({ ...exact, contract: { ...exact.contract, digest: digestCanonical("other-contract") } }, "repository-contract");
    const counts = { agent: observedModels.length, check: checkObservations };
    const integrated = compileWorkDelegationReservationForDecision({ ...exact,
      decision: { ...exact.decision, operation: "delivery.integrate", reason: "integrate-ready-candidate" } }, owners);
    assert.deepEqual(integrated.slots, []);
    assert.deepEqual(integrated.charges, { operations: 1, agentAttempts: 0, reservedCellWallTimeMs: 0 });
    assert.deepEqual({ agent: observedModels.length, check: checkObservations }, counts);
    assert.deepEqual(unchanged(), before);

    grant = await setGrant(totalWallTime - 1);
    refuses(input(), "cell-wall-time-exhausted");
    const expiresAt = new Date(Date.parse(f.now()) + 60_000).toISOString();
    grant = await setGrant(totalWallTime, expiresAt);
    refuses({ ...input(), observedAt: expiresAt }, "expired");
    const current = input();
    const stop = f.store.requestWorkDelegationStop({ delegation: { kind: "work-delegation", id: grant.revision.recordId, revision: grant.revision.revision, digest: grant.revision.digest },
      requestedBy: CONNECTED_DIRECTOR_ID, requestedAt: f.now() });
    refuses(current, "currentness");
    await withDeliveryOperationLock({ machineHome: f.machineHome, targetId: f.contract.targetId, deliveryId: f.deliveryId }, "stop", async () => {
      f.store.append(compileWorkDelegationStopAppend({ request: stop.request, runtimeId: CONNECTED_RUNTIME_ID, stoppedAt: f.now() }));
    });
    refuses(input(), "currentness");
    assert.deepEqual(f.current("candidate"), candidate);
    assert.deepEqual(f.current("activeBoundary"), boundary);
    assert.deepEqual(f.store.state().delegation.charged, { operations: 0, agentAttempts: 0, reservedCellWallTimeMs: 0 });
    assert.equal(harness.dispatchCount(), 0);
    await f.store.verifyIntegrity();
  } finally { await f.dispose(); }
});
