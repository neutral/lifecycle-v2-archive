import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createFoundationRuntimeOperationRequest, parseFoundationRuntimeOperationResultForRequest,
  type FoundationRuntimeOperationResult, type FoundationRuntimeWorkRequest } from "@neutral/lifecycle-protocol";
import { withDeliveryOperationLock } from "../../src/foundation/control/delivery-operation-lock.js";
import { compileDeliveryGeneration } from "../../src/foundation/control/delivery-view.js";
import type { FoundationAttemptView } from "../../src/foundation/control/attempt-view.js";
import { executionReceiptSubmissionDiagnostic } from "../../src/foundation/control/execution-receipt.js";
import { assertDeliveryControlRecordPayload } from "../../src/foundation/control/payload-registry.js";
import type { ControlJsonObject, ControlRecordRevision } from "../../src/foundation/control/types.js";
import { compileWorkDelegation } from "../../src/foundation/control/work-delegation-compilation.js";
import { compileWorkDelegationStopAppend } from "../../src/foundation/control/work-delegation-stop.js";
import { readWorkDelegationExecution, workDelegationAgentAttemptMatches, workDelegationAgentSlot } from "../../src/foundation/control/work-delegation-execution.js";
import { addWorkDelegationAccounting, compileWorkDelegationReservation, WORK_DELEGATION_RESERVATION_SCHEMA, type WorkDelegationAgentSelection, type WorkDelegationOperation } from "../../src/foundation/control/work-delegation.js";
import { FoundationError } from "../../src/foundation/error.js";
import { createFoundationRuntimeFacade, createFoundationRuntimeFacadeForTesting } from "../../src/foundation/facade.js";
import { compileFoundationInstalledAgentExecutionPolicyV1 } from "../../src/foundation/execution/installed-agent-policy-v1.js";
import { operateFoundationCandidateAgentRuntimeV7 } from "../../src/foundation/process/candidate-agent-runtime-v7.js";
import { operateFoundationIntegrationRuntimeV1 } from "../../src/foundation/process/integration-runtime-v1.js";
import { evaluateDeliveryV7 } from "../../src/foundation/process/evaluation-runtime-v7.js";
import { deliveryWorkDecisionBasisDigest } from "../../src/foundation/process/delivery-state.js";
import { compileWorkDelegationDecision } from "../../src/foundation/process/work-delegation-policy.js";
import { selectWorkDelegationAgentResources } from "../../src/foundation/process/work-delegation-reservation.js";
import { runWorkDelegation, type WorkDelegationRuntimeDispatch, type WorkDelegationRuntimeInput, type WorkDelegationRuntimeOptions } from "../../src/foundation/process/work-delegation-runtime.js";
import { FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR } from "../../src/foundation/repository/contract.js";
import { loadRepositoryIdentityEpoch } from "../../src/foundation/repository/snapshot.js";
import { installedHarness, type InstalledHarness } from "../support/agent-cell-runtime-fixture.js";
import { readConnectedCandidateFile } from "../support/connected-candidate-inspection.js";
import { CONNECTED_BACKEND_LIMITS, CONNECTED_DIRECTOR_ID, CONNECTED_RUNTIME_ID, connectedBuilderMarkdown,
  connectedCandidateOutput, connectedReviewerMarkdown, connectedSemanticEntry, createConnectedDeliveryFixture, type ConnectedDeliveryFixture } from "../support/connected-delivery-fixture.js";

// Existing Runtime owners consume raw semantic/Candidate output
// through real Git and SQLite with a deterministic external Backend. This is one
// reserved Builder connection, not an automatic-run, OS/provider, Check,
// integration, evaluation or acceptance qualification claim.
test("reserved Builder retains the original standing Brief and exact resources through Candidate progress and Store reopen", async () => {
  const f = await createConnectedDeliveryFixture({ id: "reserved-builder" });
  try {
    await f.prepare(); await f.admit();
    const originalCandidate = f.current("candidate");
    const originalBoundary = f.current("activeBoundary");
    const canonicalBytes = await readFile(join(f.target, "src/demo.ts"));
    const activityId = "activity.reserved-connected-builder";
    const agent = installedHarness({ machineHome: f.machineHome, now: f.now, backendLimits: CONNECTED_BACKEND_LIMITS,
      produceOutput: async input => ({ entries: [
        ...await connectedCandidateOutput({ machineHome: f.machineHome, workspace: f.workspace, input,
          edit: async repository => writeFile(join(repository, "src/demo.ts"), "export const value = 'delegated';\n") }),
        connectedSemanticEntry(connectedBuilderMarkdown()),
      ] }) });
    const compileInstalled = agent.options.compileInstalled;
    assert.ok(compileInstalled);
    const imageProvider = f.configuration.execution?.image.agentProvider;
    assert.ok(imageProvider);
    const installed = compileInstalled({ configuration: f.configuration,
      provider: { descriptorId: FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR.id,
        descriptorDigest: FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR.digest,
        executableIdentityClass: FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR.provider.executableIdentityClass,
        installedIdentityDigest: imageProvider.executableIdentity },
      investment: { model: "deterministic-test", reasoning: "high" },
      executionPolicy: compileFoundationInstalledAgentExecutionPolicyV1().executionPolicy }).installed;
    const selection: WorkDelegationAgentSelection = {
      providerDescriptor: { id: installed.provider.descriptorId, digest: installed.provider.descriptorDigest },
      backendProfile: { profileId: installed.profile.profileId, profileDigest: installed.profile.digest,
        implementationDigest: installed.profile.implementation.implementationDigest },
      image: { imageId: installed.image.imageId, imageDigest: installed.image.imageDigest },
      model: "deterministic-test", reasoning: "high", wallTimeMs: 123_000,
      limits: { tokens: null, events: 512, outputBytes: 268_435_456, toolCalls: null, processes: 64, storageBytes: 268_435_456 },
    };
    const grant = compileWorkDelegation({ store: f.store, directorId: CONNECTED_DIRECTOR_ID, runtimeId: CONNECTED_RUNTIME_ID,
      submittedAt: f.now(), semanticMarkdown: "# Work allowance\n\nComplete one bounded Builder pass under the admitted mandate.\n",
      allowedOperations: ["delivery.continue"], directions: { continue: "# Continue\n\nComplete useful source progress under this admitted mandate.\n", evaluate: null },
      agentSelections: { builder: selection, reviewer: null }, ceilings: { operations: 1, agentAttempts: 1, reservedCellWallTimeMs: 123_000 }, expiresAt: null });
    const standing = grant.standingBriefs.continue;
    assert.ok(standing);
    await withDeliveryOperationLock({ machineHome: f.machineHome, targetId: f.contract.targetId, deliveryId: f.deliveryId }, "continue", async () => {
      f.store.appendBatch(grant.appends);
      const state = f.store.state();
      assert.ok(state.journal.headDigest);
      const reservation = compileWorkDelegationReservation({ schema: WORK_DELEGATION_RESERVATION_SCHEMA,
        reservationId: "reservation.connected-builder", activityId, operation: "delivery.continue",
        delegation: { kind: "work-delegation", id: grant.revision.recordId, revision: grant.revision.revision, digest: grant.revision.digest },
        decision: { journalHead: { sequence: state.journal.eventCount, digest: state.journal.headDigest },
          basisDigest: deliveryWorkDecisionBasisDigest(state), reason: "develop-candidate" },
        slots: [{ slotId: "slot.builder", purpose: "agent", role: "builder", selection }] });
      await operateFoundationCandidateAgentRuntimeV7({ target: f.target, store: f.store,
        configuration: { ...f.configuration, model: "changed-current-default", reasoning: "low" },
        activityId, operation: "delivery.continue", runtimeId: CONNECTED_RUNTIME_ID, agentId: "agent:builder",
        opening: { reservation, directorId: CONNECTED_DIRECTOR_ID, semanticMarkdown: standing.compiled.semanticMarkdown,
          submittedAt: standing.compiled.createdAt, startedAt: f.now(), attemptCreatedAt: f.now() } },
      { agentOperation: { ...agent.options, compileInstalled: request => {
        assert.equal(request.configuration.model, selection.model);
        assert.equal(request.configuration.reasoning, selection.reasoning);
        assert.equal(request.investment.model, selection.model);
        assert.equal(request.investment.reasoning, selection.reasoning);
        return compileInstalled(request);
      } } });
      assert.deepEqual(f.store.state().delegation.charged, reservation.charges);
    });
    assert.equal(agent.dispatchCount(), 1);
    const candidate = f.current("candidate");
    assert.equal(candidate.revision, originalCandidate.revision + 1);
    assert.notEqual(candidate.digest, originalCandidate.digest);
    assert.deepEqual(f.current("activeBoundary"), originalBoundary);
    assert.deepEqual(await readFile(join(f.target, "src/demo.ts")), canonicalBytes);
    const binding = readWorkDelegationExecution({ store: f.store, activityId });
    const slot = workDelegationAgentSlot(binding, "builder");
    assert.ok(slot);
    const attempts = f.store.listEvents(0, 10_000).filter(event => event.eventKind === "agent-attempt-prepared" && event.payload.activityId === activityId);
    assert.equal(attempts.length, 1);
    const selectedAttempt = attempts[0]!.subject;
    assert.ok(selectedAttempt);
    const attempt = f.store.getRevision(selectedAttempt.recordId, selectedAttempt.revision);
    assert.ok(attempt);
    assert.equal(workDelegationAgentAttemptMatches(slot, attempt), true);
    assert.equal(f.store.listEvents(0, 10_000).filter(event => event.eventKind === "director-brief-submitted" && event.subject?.recordId === standing.compiled.recordId).length, 1);
    assert.equal(f.store.state().activities.find(activity => activity.id === activityId)?.stage, "completed");
    assert.equal(f.store.state().activities.find(activity => activity.id === activityId)?.recovery, null);
    await f.reopenStore();
    assert.deepEqual(readWorkDelegationExecution({ store: f.store, activityId }), binding);
    assert.deepEqual(f.store.getRevision(standing.compiled.recordId, 1), standing.compiled);
    assert.deepEqual(f.store.getRevision(attempt.recordId, attempt.revision), attempt);
    assert.deepEqual(f.current("candidate"), candidate);
    assert.deepEqual(f.store.state().delegation.charged, { operations: 1, agentAttempts: 1, reservedCellWallTimeMs: 123_000 });
    await f.store.verifyIntegrity();
  } finally { await f.dispose(); }
});

/**
 * Explicit test-only selection adapter for actual retained owner-finalized facts.
 * The production Attempt View deliberately requires the production Docker
 * profile; this fixture honestly retains its fault-injection profile. No record,
 * resource or execution observation is changed to impersonate production.
 * Only the policy-read fields exercised by the runner fault courses are
 * projected. The separate readiness course uses the actual Attempt View and
 * Docker Backend with deterministic Engine observations.
 */
function retainedPolicyView(f: ConnectedDeliveryFixture, attemptId: string): FoundationAttemptView {
  const exact = (id: string, revision: number, kind: string) => {
    const value = f.store.getRevision(id, revision);
    assert.ok(value && value.recordKind === kind);
    assertDeliveryControlRecordPayload(value);
    return value;
  };
  const reference = (value: ControlRecordRevision) => ({ kind: value.recordKind, id: value.recordId, revision: value.revision, digest: value.digest });
  const attempt = exact(attemptId, 1, "agent-attempt");
  const activityId = String(attempt.payload.activityId);
  const related = (relation: string) => {
    const links = attempt.relationships.filter(link => link.relation === relation);
    assert.equal(links.length, 1); return links[0]!.target;
  };
  const events = f.store.listEvents(0, 10_000).filter(event => event.payload.activityId === activityId);
  const one = (eventKind: string, kind: string) => {
    const matches = events.filter(event => event.eventKind === eventKind);
    assert.equal(matches.length, 1); const subject = matches[0]!.subject; assert.ok(subject);
    const value = exact(subject.recordId, subject.revision, kind); assert.equal(value.digest, subject.digest); return value;
  };
  const workProduct = one("agent-work-product-submitted", "agent-work-product");
  const receipt = one("execution-receipt-recorded", "execution-receipt");
  assert.deepEqual(receipt.relationships.find(link => link.relation === "observes-attempt")?.target, reference(attempt));
  assert.deepEqual(receipt.relationships.find(link => link.relation === "observes-work-product")?.target, reference(workProduct));
  assert.equal(f.store.state().activities.find(activity => activity.id === activityId)?.stage, "completed");
  const observed = receipt.payload.candidate as ControlJsonObject;
  const workspace = receipt.payload.workspace as ControlJsonObject;
  return {
    complete: true, coordinate: { attempt: reference(attempt) },
    attemptContract: { activityId, operation: attempt.payload.operation, boundary: related("uses-boundary"), candidate: related("uses-candidate") },
    providerExecution: { effect: receipt.payload.providerEffect },
    agentSemantics: { workProduct: reference(workProduct), roleSemantics: workProduct.payload.roleSemantics,
      submissionDiagnostics: { parserDisposition: workspace.parserDisposition, compilerDisposition: workspace.compilerDisposition,
        diagnostic: executionReceiptSubmissionDiagnostic(receipt) } },
    candidateTransition: observed,
    processAndProof: { checks: [], obligations: [] },
  } as unknown as FoundationAttemptView;
}

test("real retained readiness selects integration again after changed work, then acceptance-ready Evidence returns to the Director", async () => {
  const f = await createConnectedDeliveryFixture({ id: "policy-connected", agentBackend: "docker-observed" });
  try {
    await f.prepare(); await f.admit();
    const ready = "# Builder Work Product\n\n## Outcome\n- Disposition: complete\n- Uncertainty: bounded\nThe admitted source is ready for exact integration and independent evaluation.\n\n## Proposal\n- Kind: ready-to-evaluate\n";
    await f.continue({ edit: async repository => writeFile(join(repository, "src/demo.ts"), "export const value = 'first';\n") });
    await f.continue({ semanticMarkdown: ready });
    const unchanged = f.current("candidate");
    assert.equal((unchanged.payload.state as ControlJsonObject).unchangedFromPredecessor, true);
    const builder = selectWorkDelegationAgentResources({ configuration: f.configuration, operation: "delivery.continue" });
    const reviewer = selectWorkDelegationAgentResources({ configuration: f.configuration, operation: "delivery.evaluate" });
    const setGrant = async () => {
      const grant = compileWorkDelegation({ store: f.store, directorId: CONNECTED_DIRECTOR_ID, runtimeId: CONNECTED_RUNTIME_ID,
        submittedAt: f.now(), semanticMarkdown: "# Explicit work allowance\n\nFund the exact admitted course.\n",
        allowedOperations: ["delivery.continue", "delivery.evaluate", "delivery.integrate"],
        directions: { continue: "Complete the admitted source and propose readiness when useful.\n", evaluate: "Independently evaluate the exact sealed integrated result.\n" },
        agentSelections: { builder, reviewer }, ceilings: { operations: 10, agentAttempts: 6, reservedCellWallTimeMs: 20_000_000 }, expiresAt: null });
      await withDeliveryOperationLock({ machineHome: f.machineHome, targetId: f.contract.targetId, deliveryId: f.deliveryId }, "work-grant", async () => { f.store.appendBatch(grant.appends); });
      return grant;
    };
    const stopGrant = async (grant: Awaited<ReturnType<typeof setGrant>>) => {
      const stop = f.store.requestWorkDelegationStop({ delegation: { kind: "work-delegation", id: grant.revision.recordId, revision: grant.revision.revision, digest: grant.revision.digest },
        requestedBy: CONNECTED_DIRECTOR_ID, requestedAt: f.now() });
      await withDeliveryOperationLock({ machineHome: f.machineHome, targetId: f.contract.targetId, deliveryId: f.deliveryId }, "stop", async () => {
        f.store.append(compileWorkDelegationStopAppend({ request: stop.request, runtimeId: CONNECTED_RUNTIME_ID, stoppedAt: f.now() }));
      });
    };
    const decide = () => compileWorkDelegationDecision({ store: f.store, physical: { disposition: "active", archiveManifestDigest: null }, observedAt: f.now() });
    let grant = await setGrant();
    assert.equal(decide().reason, "integrate-ready-candidate", "Unchanged valid readiness advances proof phase without claiming new content");
    // These are explicit manual owner calls after an explicit stop, not an
    // automated caller or an unreserved operation concealed under a live grant.
    await stopGrant(grant); assert.equal((await f.integrate()).outcome, "constructed");
    grant = await setGrant(); assert.equal(decide().reason, "evaluate-integrated-candidate");
    await stopGrant(grant);
    await f.continue({ semanticMarkdown: ready, edit: async repository => writeFile(join(repository, "src/demo.ts"), "export const value = 'final';\n") });
    assert.ok(f.store.state().eligibleOperations.includes("delivery.evaluate"), "Existing integrated ancestry remains eligible");
    assert.equal((f.current("candidate").payload.state as ControlJsonObject).unchangedFromPredecessor, false);
    grant = await setGrant(); assert.equal(decide().reason, "integrate-ready-candidate", "Changed ready work requires fresh integration despite sticky ancestry");
    await stopGrant(grant); assert.equal((await f.integrate()).outcome, "constructed");
    await f.evaluate();
    const evidence = f.store.state().subjects.evidence; assert.ok(evidence);
    assert.equal(f.store.getRevision(evidence.id, evidence.revision)!.payload.readiness, "acceptance-ready");
    assert.equal(decide().reason, "acceptance-required");
    await f.reopenStore(); assert.equal(decide().reason, "acceptance-required");
    assert.equal(f.store.state().subjects.closure, null);
    assert.equal(await readFile(join(f.target, "src/demo.ts"), "utf8"), "export const value = 'base';\n");
    assert.equal(await readConnectedCandidateFile(f, "src/demo.ts"), "export const value = 'final';\n");
    assert.equal(f.invocations.length, 5, "Only the explicit preparation, three Builders and review invoke Agents; selection and policy reads do not");
    assert.deepEqual(f.store.state().delegation.charged, { operations: 0, agentAttempts: 0, reservedCellWallTimeMs: 0 }, "This selection-only course uses explicit manual operations between grants");
  } finally { await f.dispose(); }
});

// After the ordinary prepare/admit setup, these two bounded
// Facade resource actions use real SQLite/result owners without dispatching
// another Agent. Public transport remains outside this source-only coverage.
test("machine-custody-only Facade Stop folds an integrate-only grant and returns its exact durable acknowledgment", async () => {
  const f = await createConnectedDeliveryFixture({ id: "facade-work-stop" });
  try {
    await f.prepare(); await f.admit();
    const candidate = f.current("candidate"), boundary = f.current("activeBoundary");
    const invocations = f.invocations.length;
    const grant = compileWorkDelegation({ store: f.store, directorId: CONNECTED_DIRECTOR_ID, runtimeId: CONNECTED_RUNTIME_ID,
      submittedAt: f.now(), semanticMarkdown: "# Integration allowance\n\nPermit one exact integration within the admitted mandate.\n",
      allowedOperations: ["delivery.integrate"], directions: { continue: null, evaluate: null },
      agentSelections: { builder: null, reviewer: null },
      ceilings: { operations: 1, agentAttempts: 0, reservedCellWallTimeMs: 0 }, expiresAt: null });
    await withDeliveryOperationLock({ machineHome: f.machineHome, targetId: f.contract.targetId, deliveryId: f.deliveryId }, "work-grant", async () => {
      f.store.appendBatch(grant.appends);
    });
    const before = f.store.state().journal;
    const delegation = { kind: "work-delegation" as const, id: grant.revision.recordId, revision: grant.revision.revision, digest: grant.revision.digest };
    const request = createFoundationRuntimeOperationRequest({ operation: "delivery.work", target: f.target, deliveryId: f.deliveryId,
      input: { action: "stop", delegation } });
    // No model, reasoning, provider home, Docker executable or Image settings.
    const facade = createFoundationRuntimeFacade({ environment: { LIFECYCLE_MACHINE_HOME: f.machineHome }, now: f.now });
    const returned = await facade.execute(request);
    await f.reopenStore();
    const result = parseFoundationRuntimeOperationResultForRequest(JSON.parse(JSON.stringify(returned)), request);
    assert.equal(result.status, "completed");
    assert.ok(result.value !== null && "kind" in result.value && result.value.kind === "work-control");
    assert.equal(result.value.action, "stop"); assert.equal(result.value.reason, "delegation-stopped");
    assert.equal(result.value.stop?.disposition, "stopped");
    assert.deepEqual(result.value.delegation, delegation);
    assert.deepEqual(result.events, []); assert.deepEqual(result.control, []);
    assert.equal(result.changes.control.advanced, true);
    assert.equal(result.changes.control.beforeHead?.digest, before.headDigest);
    assert.equal(result.changes.control.afterHead?.sequence, before.eventCount + 1);
    assert.equal(result.changes.control.afterHead?.digest, f.store.state().journal.headDigest);
    assert.equal(result.observation.delivery?.delegation.current?.stopped, true);
    assert.equal(f.store.getWorkDelegationStopRequest(), null);
    assert.deepEqual(f.store.getRevision(grant.revision.recordId, grant.revision.revision), grant.revision);
    assert.deepEqual(f.current("candidate"), candidate); assert.deepEqual(f.current("activeBoundary"), boundary);
    assert.deepEqual(f.store.state().delegation.charged, { operations: 0, agentAttempts: 0, reservedCellWallTimeMs: 0 });
    assert.equal(f.invocations.length, invocations);
    await f.store.verifyIntegrity();
  } finally { await f.dispose(); }
});

test("Facade Set awaits complete result projection before closing its Store without starting integrate-only work", async () => {
  const f = await createConnectedDeliveryFixture({ id: "facade-work-set" });
  try {
    await f.prepare(); await f.admit();
    const candidate = f.current("candidate"), boundary = f.current("activeBoundary");
    const before = f.store.state();
    const epoch = await loadRepositoryIdentityEpoch(f.target);
    const generation = compileDeliveryGeneration({ store: f.store, physical: { disposition: "active", archiveManifestDigest: null },
      repository: { headCommit: epoch.epoch.commit, headTree: epoch.epoch.tree, repositoryContractDigest: epoch.contract.digest } });
    const request = createFoundationRuntimeOperationRequest({ operation: "delivery.work", target: f.target, deliveryId: f.deliveryId,
      input: { action: "set", expectedGeneration: generation.digest, allowedOperations: ["delivery.integrate"],
        directions: { continue: null, evaluate: null }, agentChoices: { builder: null, reviewer: null },
        ceilings: { operations: 1, agentAttempts: 0, reservedCellWallTimeMs: 0 }, expiresAt: null } });
    // Configuration is the existing explicit test seam; every mutation owner
    // remains real. Integrate-only Set resolves no Agent or Check resource.
    const { execution: _execution, ...configuration } = f.configuration;
    const facade = createFoundationRuntimeFacadeForTesting({
      configuration: { ...configuration, codexHome: join(f.machineHome, "unused-provider-home") }, now: f.now });
    const returned = await facade.execute(request);
    await f.reopenStore();
    const result = parseFoundationRuntimeOperationResultForRequest(JSON.parse(JSON.stringify(returned)), request);
    assert.equal(result.status, "completed");
    assert.ok(result.value !== null && "kind" in result.value && result.value.kind === "work-control");
    assert.equal(result.value.action, "set"); assert.equal(result.value.reason, "delegation-set");
    assert.equal(result.value.completedOperations, 0); assert.equal(result.value.lastActivity, null);
    const grant = f.store.getRevision(result.value.delegation.id, result.value.delegation.revision);
    assert.ok(grant); assert.equal(grant.digest, result.value.delegation.digest);
    assert.deepEqual(grant.payload.allowedOperations, ["delivery.integrate"]);
    assert.deepEqual(grant.payload.directions, { continue: null, evaluate: null });
    assert.deepEqual(grant.payload.agentSelections, { builder: null, reviewer: null });
    assert.deepEqual(result.events, []); assert.deepEqual(result.control, []);
    assert.equal(result.changes.control.beforeHead?.digest, before.journal.headDigest);
    assert.equal(result.changes.control.afterHead?.sequence, before.journal.eventCount + 1);
    assert.equal(result.changes.control.afterHead?.digest, f.store.state().journal.headDigest);
    assert.deepEqual(f.store.state().activities, before.activities);
    assert.deepEqual(f.store.state().delegation.charged, before.delegation.charged);
    assert.deepEqual(f.current("candidate"), candidate); assert.deepEqual(f.current("activeBoundary"), boundary);
    assert.equal(f.store.state().subjects.integrationAssessment, null);
    await f.store.verifyIntegrity();
  } finally { await f.dispose(); }
});

const RUNNER_PRODUCT = "export const value = 'reserved-course';\n";
const RUNNER_READY = "# Builder Work Product\n\n## Outcome\n- Disposition: complete\n- Uncertainty: bounded\nThe admitted source change is ready for exact integration and independent evaluation.\n\n## Proposal\n- Kind: ready-to-evaluate\n";

function runnerAgent(f: ConnectedDeliveryFixture, duringBuilder?: () => Promise<void>): InstalledHarness {
  return installedHarness({ machineHome: f.machineHome, now: f.now, backendLimits: CONNECTED_BACKEND_LIMITS,
    produceOutput: async input => {
      assert.equal(input.specification.operation.kind, "agent-attempt");
      assert.ok("role" in input.specification.operation);
      if (input.specification.operation.role === "reviewer") {
        return { entries: [connectedSemanticEntry(connectedReviewerMarkdown(input))] };
      }
      assert.equal(input.specification.operation.role, "builder");
      await duringBuilder?.();
      return { entries: [...await connectedCandidateOutput({ machineHome: f.machineHome, workspace: f.workspace, input,
        edit: async repository => writeFile(join(repository, "src/demo.ts"), RUNNER_PRODUCT) }), connectedSemanticEntry(RUNNER_READY)] };
    } });
}

async function retainRunnerGrant(f: ConnectedDeliveryFixture, agent: InstalledHarness,
  allowedOperations: readonly WorkDelegationOperation[] = ["delivery.continue", "delivery.evaluate", "delivery.integrate"],
  operationCeiling = allowedOperations.length) {
  const compileAgent = agent.options.compileInstalled; assert.ok(compileAgent);
  const builder = selectWorkDelegationAgentResources({ configuration: f.configuration, operation: "delivery.continue" }, { compileAgent });
  const reviewer = allowedOperations.includes("delivery.evaluate")
    ? selectWorkDelegationAgentResources({ configuration: f.configuration, operation: "delivery.evaluate" }, { compileAgent }) : null;
  const grant = compileWorkDelegation({ store: f.store, directorId: CONNECTED_DIRECTOR_ID, runtimeId: CONNECTED_RUNTIME_ID,
    submittedAt: f.now(), semanticMarkdown: "# Finite work allowance\n\nComplete the admitted source and establish its exact proof.\n",
    allowedOperations, directions: { continue: "Complete the admitted source, then propose readiness.\n",
      evaluate: reviewer === null ? null : "Independently review the exact integrated source and required proof.\n" },
    agentSelections: { builder, reviewer },
    ceilings: { operations: operationCeiling, agentAttempts: reviewer === null ? 1 : 2, reservedCellWallTimeMs: 6_000_000 }, expiresAt: null });
  await withDeliveryOperationLock({ machineHome: f.machineHome, targetId: f.contract.targetId, deliveryId: f.deliveryId }, "work-grant", async () => {
    f.store.appendBatch(grant.appends);
  });
  return grant;
}

async function observeRunner(f: ConnectedDeliveryFixture) {
  const epoch = await loadRepositoryIdentityEpoch(f.target);
  assert.equal(epoch.contract.digest, f.contract.digest);
  assert.equal(f.store.getSeal(), null);
  return { physical: { disposition: "active" as const, archiveManifestDigest: null }, contract: epoch.contract,
    configuration: { ...f.configuration, model: "changed-current-default", reasoning: "low" } };
}

function runnerOptions(f: ConnectedDeliveryFixture, agent: InstalledHarness): WorkDelegationRuntimeOptions {
  const compileAgent = agent.options.compileInstalled; assert.ok(compileAgent);
  return { now: f.now, reservationOwners: { compileAgent, checkResources: () => f.check.resources },
    policyOwners: { compileAttemptView: input => {
      assert.equal(input.selection.kind, "attempt"); assert.ok("attemptId" in input.selection);
      return retainedPolicyView(f, input.selection.attemptId);
    } } };
}

/** Only the existing operation owners write openings, final records and effects. */
async function dispatchRunner(f: ConnectedDeliveryFixture, agent: InstalledHarness,
  input: WorkDelegationRuntimeDispatch): ReturnType<WorkDelegationRuntimeInput["dispatch"]> {
  let result: Readonly<{ activityId: string; operation: string }>;
  if (input.operation === "delivery.integrate") {
    result = await operateFoundationIntegrationRuntimeV1({ target: f.target, machineHome: f.machineHome, store: f.store,
      activityId: input.activityId, runtimeId: CONNECTED_RUNTIME_ID, reservation: input.reservation }, { now: f.now });
  } else if (input.operation === "delivery.evaluate") {
    assert.equal(input.standingBrief.semanticAuthor.kind, "director");
    result = await evaluateDeliveryV7({ target: f.target, store: f.store, configuration: input.observation.configuration,
      contract: input.observation.contract, semanticMarkdown: input.standingBrief.semanticMarkdown,
      directorId: input.standingBrief.semanticAuthor.id, agentId: "agent:reviewer", runtimeId: CONNECTED_RUNTIME_ID,
      reservation: input.reservation }, { now: f.now, createActivityId: () => input.activityId,
      preparation: { now: f.now, checkCellOperator: f.check.operator }, finalization: { now: f.now }, agentOperation: agent.options });
  } else {
    assert.equal(input.standingBrief.semanticAuthor.kind, "director");
    result = await operateFoundationCandidateAgentRuntimeV7({ target: f.target, store: f.store, configuration: input.observation.configuration,
      activityId: input.activityId, operation: input.operation, runtimeId: CONNECTED_RUNTIME_ID, agentId: "agent:builder",
      opening: { reservation: input.reservation, directorId: input.standingBrief.semanticAuthor.id,
        semanticMarkdown: input.standingBrief.semanticMarkdown, submittedAt: input.standingBrief.createdAt,
        startedAt: input.startedAt, attemptCreatedAt: f.now() } }, { agentOperation: agent.options });
  }
  assert.equal(result.activityId, input.activityId); assert.equal(result.operation, input.operation);
  return { activityId: result.activityId, operation: input.operation };
}

// One full runner course and two bounded interruptions reuse
// actual Git/SQLite, Agent, Check, integration and Evidence owners. Only external
// execution/resource observations and the explicitly excluded production
// Attempt View adapter above are supplied. No finalized records are injected;
// real Docker/provider, public transport and independent-process restart remain
// separate qualification boundaries.
test("foreground delegation restores an unavailable exact resource then runs Continue, Integrate and Evaluate to real decision-ready Evidence", async () => {
  const f = await createConnectedDeliveryFixture({ id: "runner-complete" });
  try {
    await f.prepare(); await f.admit();
    const originalCandidate = f.current("candidate"), boundary = f.current("activeBoundary");
    const agent = runnerAgent(f), grant = await retainRunnerGrant(f, agent);
    const baseOptions = runnerOptions(f, agent);
    const compileAgent = baseOptions.reservationOwners!.compileAgent!;
    let available = false;
    let observations = 0;
    const dispatched: WorkDelegationRuntimeDispatch[] = [];
    const run = () => withDeliveryOperationLock({ machineHome: f.machineHome, targetId: f.contract.targetId, deliveryId: f.deliveryId }, "work-run", async () =>
      runWorkDelegation({ store: f.store, runtimeId: CONNECTED_RUNTIME_ID,
        observe: async () => { observations += 1; return observeRunner(f); },
        dispatch: async input => { dispatched.push(input); return dispatchRunner(f, agent, input); } },
      { ...baseOptions, reservationOwners: { ...baseOptions.reservationOwners, compileAgent: input => {
        if (!available) throw new FoundationError("lifecycle.execution.installed-agent-runtime-v1.unavailable", "Selected resource temporarily unavailable");
        return compileAgent(input);
      } } }));
    const before = { state: f.store.state(), inventory: f.store.logicalInventoryDigest(), checks: f.check.dispatchCount() };
    const refused = await run();
    assert.equal(refused.completedOperations, 0);
    assert.equal(refused.latestActivity, null);
    assert.equal(refused.stopReason, "observation-unavailable");
    assert.equal(refused.diagnostic?.stage, "reservation");
    assert.deepEqual({ state: f.store.state(), inventory: f.store.logicalInventoryDigest(), checks: f.check.dispatchCount() }, before);
    assert.equal(agent.dispatchCount(), 0); assert.equal(dispatched.length, 0);
    await f.reopenStore();
    assert.deepEqual(f.store.getRevision(grant.revision.recordId, grant.revision.revision), grant.revision);
    available = true;
    const result = await run();
    assert.equal(result.stopReason, "acceptance-required");
    assert.equal(result.diagnostic, null);
    assert.equal(result.completedOperations, 3);
    assert.deepEqual(dispatched.map(value => value.operation), ["delivery.continue", "delivery.integrate", "delivery.evaluate"]);
    assert.equal(observations, 5, "One refused planning pass plus a fresh observation at every successful settled boundary");
    assert.equal(agent.dispatchCount(), 2);
    assert.equal(f.check.dispatchCount(), before.checks + 1, "One actual required final Check executes in addition to the retained baseline");
    const candidate = f.current("candidate");
    assert.equal(candidate.revision, originalCandidate.revision + 2);
    assert.deepEqual(f.current("activeBoundary"), boundary);
    assert.equal(await readConnectedCandidateFile(f, "src/demo.ts"), RUNNER_PRODUCT);
    assert.equal(await readFile(join(f.target, "src/demo.ts"), "utf8"), "export const value = 'base';\n");
    let charged = { operations: 0, agentAttempts: 0, reservedCellWallTimeMs: 0 };
    for (const dispatchedOperation of dispatched) {
      const execution = readWorkDelegationExecution({ store: f.store, activityId: dispatchedOperation.activityId });
      assert.deepEqual(execution.reservation, dispatchedOperation.reservation);
      charged = addWorkDelegationAccounting(charged, dispatchedOperation.reservation.charges);
      const activity = f.store.state().activities.find(value => value.id === dispatchedOperation.activityId);
      assert.ok(activity); assert.equal(activity.stage, "completed"); assert.equal(activity.recovery, null);
    }
    assert.deepEqual(f.store.state().delegation.charged, charged);
    assert.equal(charged.operations, 3); assert.equal(charged.agentAttempts, 2);
    const evaluation = dispatched.at(-1)!;
    assert.deepEqual(result.latestActivity, { activityId: evaluation.activityId, operation: "delivery.evaluate" });
    const finalSpecifications = f.check.specifications().filter(value => value.owner.activityId === evaluation.activityId);
    const slots = evaluation.reservation.slots.filter(value => value.purpose === "check");
    assert.equal(finalSpecifications.length, slots.length);
    for (const slot of slots) {
      const specification = finalSpecifications.find(value => value.owner.kind === "check" && value.owner.selectionId === slot.selectionId);
      assert.ok(specification);
      assert.deepEqual(specification.backendProfile, slot.backendProfile);
      assert.deepEqual(specification.image, slot.image);
      assert.deepEqual(specification.limits, slot.limits);
    }
    const state = f.store.state(); assert.ok(state.subjects.evidence && state.subjects.seal);
    const packet = f.store.getRevision(state.subjects.evidence.id, state.subjects.evidence.revision)!;
    assert.equal(packet.payload.readiness, "acceptance-ready");
    assert.deepEqual(packet.relationships.find(value => value.relation === "evaluates")?.target,
      { kind: "candidate-revision", id: candidate.recordId, revision: candidate.revision, digest: candidate.digest });
    assert.deepEqual(packet.relationships.find(value => value.relation === "uses-seal")?.target, { kind: "candidate-seal", ...state.subjects.seal });
    assert.equal(state.subjects.closure, null);
    const originalBriefs = [grant.standingBriefs.continue, grant.standingBriefs.evaluate];
    for (const standing of originalBriefs) {
      assert.ok(standing);
      assert.deepEqual(f.store.getRevision(standing.compiled.recordId, 1), standing.compiled);
      assert.equal(f.store.listEvents(0, 10_000).filter(event => event.eventKind === "director-brief-submitted" && event.subject?.recordId === standing.compiled.recordId).length, 1);
    }
    await f.reopenStore();
    const settled = await run();
    assert.equal(settled.stopReason, "acceptance-required"); assert.equal(settled.completedOperations, 0);
    assert.equal(agent.dispatchCount(), 2); assert.equal(dispatched.length, 3);
    assert.deepEqual(f.store.state().delegation.charged, charged);
    await f.store.verifyIntegrity();
  } finally { await f.dispose(); }
});

test("a machine-custody-only Facade stop during reserved Builder dispatch retains its exact pending acknowledgment after settlement and reopen", async () => {
  const f = await createConnectedDeliveryFixture({ id: "runner-stop" });
  try {
    await f.prepare(); await f.admit();
    const boundary = f.current("activeBoundary"), candidate = f.current("candidate");
    let requestDigest: string | null = null;
    const acknowledgments: Readonly<{ request: FoundationRuntimeWorkRequest; result: FoundationRuntimeOperationResult }>[] = [];
    const facade = createFoundationRuntimeFacade({ environment: { LIFECYCLE_MACHINE_HOME: f.machineHome }, now: f.now });
    const agent = runnerAgent(f, async () => {
      const active = f.store.state().activities.filter(value => value.stage !== "completed");
      assert.equal(active.length, 1); assert.equal(active[0]!.operation, "delivery.continue");
      const before = f.store.state().journal;
      const current = f.store.state().delegation.current; assert.ok(current);
      const request = createFoundationRuntimeOperationRequest({ operation: "delivery.work", target: f.target, deliveryId: f.deliveryId,
        input: { action: "stop", delegation: { kind: "work-delegation", ...current.reference } } });
      assert.ok(request.operation === "delivery.work");
      const result = parseFoundationRuntimeOperationResultForRequest(await facade.execute(request), request);
      acknowledgments.push({ request, result });
      assert.equal(result.status, "completed");
      assert.ok(result.value !== null && "kind" in result.value && result.value.kind === "work-control");
      assert.equal(result.value.stop?.disposition, "pending"); assert.equal(result.value.reason, "stop-pending");
      assert.ok(result.value.stop);
      requestDigest = result.value.stop.request.digest;
      assert.equal(result.observation.delivery?.journal.headDigest, before.headDigest);
      assert.equal(result.changes.control.advanced, false);
      assert.deepEqual(result.changes.control.beforeHead, result.changes.control.afterHead);
      assert.equal(f.store.getWorkDelegationStopRequest()?.digest, requestDigest);
      assert.deepEqual(f.store.state().journal, before);
    });
    const grant = await retainRunnerGrant(f, agent);
    const dispatched: WorkDelegationRuntimeDispatch[] = [];
    const run = () => withDeliveryOperationLock({ machineHome: f.machineHome, targetId: f.contract.targetId, deliveryId: f.deliveryId }, "work-run", async () =>
      runWorkDelegation({ store: f.store, runtimeId: CONNECTED_RUNTIME_ID, observe: () => observeRunner(f),
        dispatch: async input => { dispatched.push(input); return dispatchRunner(f, agent, input); } }, runnerOptions(f, agent)));
    const result = await run();
    assert.equal(result.stopReason, "delegation-stopped"); assert.equal(result.diagnostic, null);
    assert.equal(result.completedOperations, 1); assert.equal(agent.dispatchCount(), 1);
    assert.deepEqual(dispatched.map(value => value.operation), ["delivery.continue"]);
    assert.deepEqual(f.store.state().delegation.charged, dispatched[0]!.reservation.charges);
    assert.equal(f.store.getWorkDelegationStopRequest(), null);
    const stopped = f.store.listEvents(0, 10_000).filter(event => event.eventKind === "work-delegation-stopped");
    assert.equal(stopped.length, 1); assert.equal(stopped[0]!.payload.requestDigest, requestDigest);
    assert.equal(stopped[0]!.subject?.digest, grant.revision.digest);
    assert.equal(f.store.state().delegation.current?.stopped, true);
    assert.equal(f.current("candidate").revision, candidate.revision + 1);
    assert.deepEqual(f.current("activeBoundary"), boundary);
    assert.equal(await readConnectedCandidateFile(f, "src/demo.ts"), RUNNER_PRODUCT);
    assert.equal(f.store.state().subjects.integrationAssessment, null); assert.equal(f.store.state().subjects.evidence, null);
    await f.reopenStore();
    assert.equal(acknowledgments.length, 1);
    const saved = acknowledgments[0]!;
    const pendingResult = parseFoundationRuntimeOperationResultForRequest(JSON.parse(JSON.stringify(saved.result)), saved.request);
    assert.ok(pendingResult.value !== null && "kind" in pendingResult.value && pendingResult.value.kind === "work-control");
    assert.equal(pendingResult.value.stop?.disposition, "pending", "Later folding does not rewrite the acknowledged historical observation");
    assert.equal(pendingResult.observation.delivery?.delegation.current?.stopped, false);
    const acknowledgedHead = pendingResult.changes.control.afterHead; assert.ok(acknowledgedHead);
    assert.ok(f.store.state().journal.eventCount > acknowledgedHead.sequence);
    assert.equal(f.store.listEvents(acknowledgedHead.sequence - 1, 1)[0]?.digest, acknowledgedHead.digest);
    assert.equal(f.store.state().delegation.current?.stopped, true);
    assert.equal((await run()).completedOperations, 0);
    assert.equal(agent.dispatchCount(), 1); assert.equal(dispatched.length, 1);
    assert.equal(f.store.listEvents(0, 10_000).filter(event => event.eventKind === "work-delegation-stopped").length, 1);
    await f.store.verifyIntegrity();
  } finally { await f.dispose(); }
});

test("lost return after exact Builder settlement stops this caller and an explicit reopened run advances proof without redispatch", async () => {
  const f = await createConnectedDeliveryFixture({ id: "runner-lost-return" });
  try {
    await f.prepare(); await f.admit();
    const agent = runnerAgent(f);
    // Keep one operation of headroom so the stop proves the missing Evaluate
    // delegation, rather than the earlier operation-count exhaustion guard.
    await retainRunnerGrant(f, agent, ["delivery.continue", "delivery.integrate"], 3);
    const dispatched: WorkDelegationRuntimeDispatch[] = [];
    let loseReturn = true;
    const dispatch: WorkDelegationRuntimeInput["dispatch"] = async input => {
      dispatched.push(input);
      const result = await dispatchRunner(f, agent, input);
      if (loseReturn) { loseReturn = false; throw new Error("Lost private-provider-response after exact settlement"); }
      return result;
    };
    const run = () => withDeliveryOperationLock({ machineHome: f.machineHome, targetId: f.contract.targetId, deliveryId: f.deliveryId }, "work-run", async () =>
      runWorkDelegation({ store: f.store, runtimeId: CONNECTED_RUNTIME_ID, observe: () => observeRunner(f), dispatch }, runnerOptions(f, agent)));
    const interrupted = await run();
    assert.equal(interrupted.completedOperations, 1); assert.equal(interrupted.stopReason, "observation-unavailable");
    assert.deepEqual(interrupted.diagnostic, { stage: "dispatch", code: "lifecycle.work-delegation.runtime-interrupted", retryable: false });
    assert.equal(JSON.stringify(interrupted).includes("private-provider-response"), false);
    assert.equal(agent.dispatchCount(), 1); assert.equal(dispatched.length, 1);
    const builder = dispatched[0]!;
    const retainedCandidate = f.current("candidate");
    const receiptEvent = f.store.listEvents(0, 10_000).find(event => event.eventKind === "execution-receipt-recorded" && event.payload.activityId === builder.activityId);
    assert.ok(receiptEvent?.subject);
    const receipt = f.store.getRevision(receiptEvent.subject.recordId, receiptEvent.subject.revision);
    assert.ok(receipt);
    assert.equal(f.store.state().activities.find(value => value.id === builder.activityId)?.recovery, null);
    await f.reopenStore();
    assert.deepEqual(f.store.getRevision(receipt.recordId, receipt.revision), receipt);
    assert.deepEqual(f.current("candidate"), retainedCandidate);
    const resumed = await run();
    assert.equal(resumed.completedOperations, 1); assert.equal(resumed.stopReason, "operation-not-delegated");
    assert.equal(resumed.diagnostic, null);
    assert.deepEqual(dispatched.map(value => value.operation), ["delivery.continue", "delivery.integrate"]);
    assert.notEqual(dispatched[1]!.activityId, builder.activityId);
    assert.equal(agent.dispatchCount(), 1, "An explicit rerun uses the retained ready Candidate rather than redispatching its Builder");
    assert.equal(f.current("candidate").revision, retainedCandidate.revision + 1);
    assert.equal(await readConnectedCandidateFile(f, "src/demo.ts"), RUNNER_PRODUCT);
    assert.deepEqual(f.store.getRevision(receipt.recordId, receipt.revision), receipt);
    assert.equal(f.store.listEvents(0, 10_000).filter(event => event.eventKind === "execution-receipt-recorded" && event.payload.activityId === builder.activityId).length, 1);
    assert.deepEqual(f.store.state().delegation.charged, addWorkDelegationAccounting(builder.reservation.charges, dispatched[1]!.reservation.charges));
    assert.equal(f.store.state().subjects.evidence, null); assert.equal(f.store.state().subjects.closure, null);
    await f.store.verifyIntegrity();
  } finally { await f.dispose(); }
});
