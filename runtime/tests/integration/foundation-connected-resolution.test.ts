import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import type { ControlJsonObject, ControlRecordRevision } from "../../src/foundation/control/types.js";
import { compileFoundationAttemptView } from "../../src/foundation/control/attempt-view.js";
import { compileDeliveryView } from "../../src/foundation/control/delivery-view.js";
import { retainExecutionReceipt } from "../../src/foundation/control/execution-receipt.js";
import { FoundationError } from "../../src/foundation/error.js";
import { createFoundationDockerExecutionBackend, type FoundationDockerEngineDriverV1 } from "../../src/foundation/execution/docker-backend.js";
import { foundationDockerExecutionBackendProfileV1 } from "../../src/foundation/execution/docker-profile-v1.js";
import { createFoundationAgentCellOperatorV1, FoundationAgentCellInputTransportRegistryV1 } from "../../src/foundation/execution/installed-agent-runtime-v1.js";
import { createFoundationExecutionOutputStoreV1 } from "../../src/foundation/execution/output-store-v1.js";
import { openFoundationExecutionReclamationLedgerV1 } from "../../src/foundation/execution/reclamation-ledger-v1.js";
import { inspectFoundationAgentActivityV7, type FoundationAgentOperationV7Options } from "../../src/foundation/process/agent-operation-v7.js";
import { operateFoundationCandidateAgentRuntimeV7, recoverFoundationCandidateAgentRuntimeV7 } from "../../src/foundation/process/candidate-agent-runtime-v7.js";
import { preflightFoundationPreparationBasisV7 } from "../../src/foundation/process/preparation-context-v7.js";
import { operateFoundationPreparationRuntimeV7, recoverFoundationPreparationRuntimeV7 } from "../../src/foundation/process/preparation-runtime-v7.js";
import { commandCheckBinding } from "../../src/foundation/repository/initialize.js";
import { observeFoundationRepositoryIdentityForRead } from "../../src/foundation/runtime-read.js";
import { sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { installedHarness } from "../support/agent-cell-runtime-fixture.js";
import { CONNECTED_BACKEND_LIMITS, CONNECTED_DIRECTOR_ID, CONNECTED_RUNTIME_ID, connectedKnowledgeDocument, connectedPreparationMarkdown, connectedReviewerMarkdown, connectedSemanticEntry, createConnectedDeliveryFixture, writeConnectedFile, type ConnectedAgentInput, type ConnectedDeliveryFixture } from "../support/connected-delivery-fixture.js";
import { createConnectedCheckOperator } from "../support/connected-check-cell.js";
import { readConnectedCandidateFile } from "../support/connected-candidate-inspection.js";

const ACTIVE = Object.freeze({ disposition: "active" as const, archiveManifestDigest: null });

async function currentViews(fixture: ConnectedDeliveryFixture) {
  const before = fixture.store.state();
  const observed = await observeFoundationRepositoryIdentityForRead(fixture.target, fixture.now());
  assert.deepEqual(observed.diagnostics, []);
  assert.equal(observed.repository.targetId, fixture.contract.targetId);
  const attempt = compileFoundationAttemptView({ store: fixture.store, physical: ACTIVE,
    selection: { kind: "latest-attempt" } });
  assert(attempt !== null);
  const delivery = compileDeliveryView({ store: fixture.store, physical: ACTIVE,
    repository: observed.repository, investment: fixture.configuration, observedAt: fixture.now() });
  assert.equal(attempt.complete, true);
  assert.equal(attempt.coordinate.journal.headDigest, before.journal.headDigest);
  assert.equal(delivery.state.journal.headDigest, before.journal.headDigest);
  assert.deepEqual(delivery.state.eligibleOperations, attempt.processAndProof.eligibleOperations);
  assert.deepEqual(fixture.store.state(), before, "Reading either complete view cannot change retained Process truth");
  return { attempt, delivery };
}

function assertReviewerInputSubstitutionRefused(fixture: ConnectedDeliveryFixture, previous: ControlRecordRevision): void {
  const view = compileFoundationAttemptView({ store: fixture.store, physical: ACTIVE,
    selection: { kind: "latest-attempt" } });
  assert(view !== null && view.attemptContract.role === "reviewer");
  const selectedReceipt = view.providerExecution.receipt!;
  const receipt = fixture.store.getRevision(selectedReceipt.id, selectedReceipt.revision)!;
  const input = (receipt.payload.candidate as ControlJsonObject).input as ControlJsonObject;
  assert.notEqual((input.revision as ControlJsonObject).digest, previous.digest);
  // Substitute one read of a real retained Receipt with another real Candidate
  // binding. No durable record is edited, and no positive Control fact is faked.
  const substituted = { ...receipt, payload: { ...receipt.payload, candidate: {
    ...receipt.payload.candidate as ControlJsonObject,
    input: { revision: { kind: "candidate-revision", id: previous.recordId,
      revision: previous.revision, digest: previous.digest },
    carrierManifestDigest: (previous.payload.carrierManifest as ControlJsonObject).digest! },
  } } };
  const store = new Proxy(fixture.store, {
    get(target, property) {
      if (property === "getRevision") return (id: string, revision: number) =>
        id === receipt.recordId && revision === receipt.revision ? substituted : target.getRevision(id, revision);
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  assert.throws(() => compileFoundationAttemptView({ store, physical: ACTIVE,
    selection: { kind: "latest-attempt" } }),
  { code: "lifecycle.attempt-view.binding" });
  assert.deepEqual(fixture.store.getRevision(receipt.recordId, receipt.revision), receipt);
}

async function ready(fixture: ConnectedDeliveryFixture): Promise<void> {
  assert.equal((await fixture.integrate()).outcome, "constructed");
  assert.equal((await fixture.evaluate()).outcome, "completed");
  const evidence = fixture.store.state().subjects.evidence!;
  assert.equal(fixture.store.getRevision(evidence.id, evidence.revision)!.payload.readiness, "acceptance-ready");
  assert.equal(fixture.store.state().subjects.materialCondition, null);
}

async function settleUnallocatedRevision(fixture: ConnectedDeliveryFixture): Promise<void> {
  const activityId = "revise-invalid-image";
  const subjects = fixture.store.state().subjects;
  const retainedCandidate = fixture.current("candidate");
  const retainedCondition = fixture.store.getRevision(subjects.materialCondition!.id, subjects.materialCondition!.revision)!;
  const profile = foundationDockerExecutionBackendProfileV1();
  const invalidDigest = sha256Bytes("connected-resolution:invalid-installed-image");
  const originalImage = fixture.configuration.execution!.image;
  const invalidConfiguration = { ...fixture.configuration, execution: { image: {
    ...originalImage, imageDigest: invalidDigest, immutableReference: `${originalImage.imageId}@${invalidDigest}`,
  } } };
  const agent = installedHarness({ machineHome: fixture.machineHome, now: fixture.now, backendLimits: CONNECTED_BACKEND_LIMITS });
  let unavailable = true;
  let interruptCompletion = false;
  let imageReads = 0;
  let absenceReads = 0;
  let creates = 0;
  const never = async (): Promise<never> => { throw new Error("Unallocated revision cannot operate a physical Cell"); };
  // The real Docker Backend interprets these external observations. The test
  // does not manufacture its no-effect witness or finalized Control records.
  const driver: FoundationDockerEngineDriverV1 = {
    async describe() { return { schema: "lifecycle.docker-engine-description.private.v1",
      engineIdentityDigest: sha256Bytes("connected-resolution:engine"), contractDigest: profile.engineContract.contractDigest,
      compatibilityProfileId: profile.engineContract.compatibilityProfileId, compatibleVersion: profile.engineContract.compatibleVersion,
      platform: profile.platforms[0]! }; },
    async inspectImage() {
      imageReads += 1;
      if (unavailable) throw new Error("Image observation temporarily unavailable");
      throw new FoundationError("lifecycle.execution.docker-cli-driver.image-substitution", "The exact selected immutable Image is invalid");
    },
    async allocationResourcesAbsent() { absenceReads += 1; return true; },
    async findCells() { return { cells: [], truncated: false }; },
    inspectCell: never, async createCell() { creates += 1; return never(); },
    consumeDispatch: never, startCell: never, cancelCell: never, retrieveOutput: never, removeCell: never,
  };
  const events = () => fixture.store.listEvents(0, 1000).filter(({ payload }) => payload.activityId === activityId);
  const options: FoundationAgentOperationV7Options = {
    ...agent.options,
    now() {
      if (interruptCompletion && events().some(({ eventKind }) => eventKind === "agent-pre-intent-refused")) {
        throw new Error("Lost return after retained revision refusal");
      }
      return fixture.now();
    },
    compileInstalled(input) {
      assert.equal(input.configuration.execution!.image.imageDigest, invalidDigest);
      const compiled = agent.options.compileInstalled!(input);
      return { ...compiled, installed: { ...compiled.installed, profile,
        image: { ...compiled.installed.image, imageDigest: invalidDigest } } };
    },
    async openInstalled(input) {
      assert.equal(input.image.imageDigest, invalidDigest, "Recovery opens the retained invalid Image, not corrected defaults");
      const ledger = await openFoundationExecutionReclamationLedgerV1({ machineHome: fixture.machineHome,
        installationId: fixture.configuration.installationId!, create: true, clock: { now: input.now } });
      const backend = await createFoundationDockerExecutionBackend({ profile, driver, now: input.now });
      const operator = createFoundationAgentCellOperatorV1({ installed: input.installed,
        inputTransport: new FoundationAgentCellInputTransportRegistryV1(), runtime: {
          machineHome: fixture.machineHome, backend, registerOperation() {},
          outputStore: createFoundationExecutionOutputStoreV1({ machineHome: fixture.machineHome }),
          reclamation: ledger, clock: { now: input.now }, pollMilliseconds: 0,
        } });
      return { ...operator, async reclaimNext() { return false; }, close() { ledger.close(); } };
    },
  };
  await assert.rejects(operateFoundationCandidateAgentRuntimeV7({ target: fixture.target, store: fixture.store,
    configuration: invalidConfiguration, activityId, operation: "delivery.revise", runtimeId: CONNECTED_RUNTIME_ID, agentId: "agent:reconnaissance",
    opening: { directorId: CONNECTED_DIRECTOR_ID, semanticMarkdown: "# Revise\n\nRetain the useful source and explicitly revise the objective.\n",
      submittedAt: fixture.now(), startedAt: fixture.now(), attemptCreatedAt: fixture.now() } }, { agentOperation: options }),
    { code: "lifecycle.execution.operation-host.backend-interrupted" });
  const original = inspectFoundationAgentActivityV7(fixture.store, activityId, "delivery.revise");
  assert.equal(original.stage, "activity-opened");
  assert.equal(original.execution!.handle, null);
  assert.equal(original.executionSelection!.image.imageDigest, invalidDigest);
  assert.equal(absenceReads, 0, "An unavailable observation cannot justify abandoning exact recovery");

  await fixture.reopenStore();
  assert.deepEqual(inspectFoundationAgentActivityV7(fixture.store, activityId, "delivery.revise").execution, original.execution);
  const recover = (agentOperation: FoundationAgentOperationV7Options) => recoverFoundationCandidateAgentRuntimeV7({
    target: fixture.target, store: fixture.store, configuration: fixture.configuration, activityId, operation: "delivery.revise",
  }, { agentOperation });
  unavailable = false;
  interruptCompletion = true;
  await assert.rejects(recover(options), /Lost return after retained revision refusal/u);
  const refused = inspectFoundationAgentActivityV7(fixture.store, activityId, "delivery.revise");
  assert.equal(refused.stage, "pre-intent-refused");
  assert.deepEqual(refused.executionSelection, original.executionSelection);
  assert.deepEqual(refused.execution, original.execution);
  const imageReadsAtRefusal = imageReads;
  await fixture.reopenStore();
  interruptCompletion = false;
  await assert.rejects(recover({ ...options, compileInstalled: () => { throw new Error("Retained refusal cannot select fresh resources"); }, openInstalled: never }),
    { code: "lifecycle.execution.docker-cli-driver.image-substitution" });
  assert.equal(imageReads, imageReadsAtRefusal, "Reopening a retained refusal completes without another Image observation");
  assert.equal(absenceReads, 1);
  assert.equal(creates, 0);
  assert.equal(agent.dispatchCount(), 0);
  assert.equal(fixture.store.getOperationSupport(activityId), null);
  assert.equal(events().filter(({ eventKind }) => eventKind === "agent-pre-intent-refused").length, 1);
  assert.equal(events().find(({ eventKind }) => eventKind === "activity-completed")!.payload.outcome, "abandoned");
  assert.equal(events().filter(({ eventKind }) => ["agent-attempt-prepared", "provider-effect-intended", "agent-work-product-submitted", "execution-receipt-recorded", "work-boundary-finalized"].includes(eventKind)).length, 0);
  assert.equal(fixture.store.state().activities.find(({ id }) => id === activityId)!.recovery, null);
  assert.deepEqual(fixture.store.state().subjects.candidate, subjects.candidate);
  assert.deepEqual(fixture.store.state().subjects.materialCondition, subjects.materialCondition);
  assert.deepEqual(fixture.current("candidate"), retainedCandidate);
  assert.deepEqual(fixture.store.getRevision(retainedCondition.recordId, retainedCondition.revision), retainedCondition);
}

for (const interruption of ["none", "second-allocation-return"] as const) {
  test(`two baseline Checks share one proof subject and continue after ${interruption}`, async (context) => {
    const secondBinding = commandCheckBinding({ id: "binding.check.second", checkIds: ["check.second"],
      subjectSelectors: [{ kind: "candidate", selector: "src/demo.ts" }], executable: { relativeTo: "execution-image", path: "usr/bin/true" } });
    const fixture = await createConnectedDeliveryFixture({ id: `two-checks-${interruption}`,
      additionalCheckBindings: [secondBinding],
      configureTarget: async (target) => await writeConnectedFile(target, "records/checks/second.md",
        connectedKnowledgeDocument("check").replaceAll("check.demo", "check.second")) });
    const activityId = "prepare-two-checks";
    // Independently declared outcome: both selected Checks observe the same
    // exact Boundary once; one retained reconnaissance submission produces a
    // usable proposal even when the second allocation return is lost.
    const secondCheck = ["### Check: second-source-check", "- Check Knowledge: check.second",
      "- Binding: binding.check.second", "- Modality: regression-guard", "- Baseline required: true",
      "- Final required: true", "- Obligation: result", "Independently observe the same bounded source."].join("\n");
    const secondProposition = ["### Proposition: second-source-result", "- Obligation: result", "- Check: second-source-check",
      "- Evidence artifact: source", "- Evidence kind: check", "The second exact Check supports the same required source result."].join("\n");
    const markdown = connectedPreparationMarkdown()
      .replace("- Knowledge: check.demo", "- Knowledge: check.demo\n- Knowledge: check.second")
      .replace("- Selected Knowledge: check.demo", "- Selected Knowledge: check.demo\n- Selected Knowledge: check.second")
      .replace("## Proposal", "### Citation: second-check-owner\n- Subject: check.second\n- Supports: route\n## Proposal")
      .replace("### Proposition: source-result", `${secondCheck}\n### Proposition: source-result`) + `${secondProposition}\n`;
    const agent = installedHarness({ machineHome: fixture.machineHome, now: fixture.now, backendLimits: CONNECTED_BACKEND_LIMITS,
      produceOutput: async () => ({ entries: [connectedSemanticEntry(markdown)] }) });
    let allocations = 0;
    let check = await createConnectedCheckOperator({ machineHome: fixture.machineHome, now: fixture.now,
      afterAllocate() {
        allocations += 1;
        if (interruption === "second-allocation-return" && allocations === 2) throw new Error("lost-second-check-allocation-return");
      } });
    const options = () => ({ agentOperation: agent.options,
      boundaryFinalization: { machineHome: fixture.machineHome, now: fixture.now, checkCellOperator: check.operator, checkOperation: { now: fixture.now } } });
    const receipts = () => fixture.store.listEvents(0, 1000).filter(({ eventKind }) => eventKind === "check-receipt-recorded")
      .map(({ subject }) => { assert(subject !== null); const receipt = fixture.store.getRevision(subject.recordId, subject.revision); assert(receipt !== null); return receipt; });
    let dispatchesBeforeRestart = 0;
    try {
      const basis = await preflightFoundationPreparationBasisV7({ target: fixture.target,
        semanticMarkdown: "# Prepare\n\nObserve the bounded source through both selected Checks.\n", observedAt: fixture.now() });
      const prepare = () => operateFoundationPreparationRuntimeV7({ store: fixture.store, configuration: fixture.configuration,
        activityId, runtimeId: CONNECTED_RUNTIME_ID, agentId: "agent:reconnaissance", basis,
        submittedAt: fixture.now(), startedAt: fixture.now(), attemptCreatedAt: fixture.now() }, options());
      if (interruption === "none") {
        assert.equal((await prepare()).outcome, "completed");
      } else {
        await assert.rejects(prepare(), { code: "lifecycle.execution.operation-host.backend-interrupted" });
        const retainedFirst = receipts();
        assert.equal(retainedFirst.length, 1);
        assert.equal(retainedFirst[0]!.payload.disposition, "pass");
        assert.equal(check.dispatchCount(), 1);
        assert.equal(fixture.store.state().activities.find(({ id }) => id === activityId)!.recovery?.resumesAt, "baseline-checks");
        const physical = check.engineSnapshot();
        assert.equal(physical.allocations.length, 2);
        assert.equal(physical.allocations.filter(({ dispatched }) => dispatched).length, 1);
        const snapshotPath = join(fixture.workspace, "check-engine-snapshot.json");
        await writeFile(snapshotPath, JSON.stringify(physical));
        dispatchesBeforeRestart = check.dispatchCount();
        check.close();
        await fixture.reopenStore();
        check = await createConnectedCheckOperator({ machineHome: fixture.machineHome, now: fixture.now,
          engineSnapshot: JSON.parse(await readFile(snapshotPath, "utf8")) });
        assert.equal((await recoverFoundationPreparationRuntimeV7({ target: fixture.target, store: fixture.store,
          configuration: fixture.configuration, activityId, runtimeId: CONNECTED_RUNTIME_ID }, options())).outcome, "completed");
        assert.deepEqual(receipts()[0], retainedFirst[0], "Recovery preserves the exact first Receipt and does not rerun that Check");
        assert.deepEqual(check.engineSnapshot().allocations.map(({ handle, specification }) => ({ handle, digest: specification.digest })),
          physical.allocations.map(({ handle, specification }) => ({ handle, digest: specification.digest })),
          "Recovery observes the original allocations instead of creating replacements");
      }
      const boundary = fixture.current("proposedBoundary");
      const selected = (boundary.payload.mandate as ControlJsonObject).checks as readonly ControlJsonObject[];
      const retained = receipts();
      assert.equal(selected.length, 2);
      assert.equal(retained.length, 2);
      assert.deepEqual(new Set(retained.map(({ payload }) => payload.selectionId)), new Set(selected.map(({ id }) => id)));
      assert.equal(new Set(retained.map(({ payload }) => (payload.execution as ControlJsonObject).specificationDigest)).size, 2);
      for (const receipt of retained) {
        assert.equal(receipt.payload.phase, "baseline");
        assert.equal(receipt.payload.disposition, "pass");
        assert.deepEqual(receipt.relationships.find(({ relation }) => relation === "checks-boundary")?.target,
          { kind: "work-boundary", id: boundary.recordId, revision: boundary.revision, digest: boundary.digest });
      }
      assert.equal(dispatchesBeforeRestart + check.dispatchCount(), 2);
      assert.equal(agent.dispatchCount(), 1, "The retained Work Product suffices for finalization recovery");
      assert.equal(fixture.store.getOperationSupport(activityId), null);
      assert.equal(fixture.store.state().activities.find(({ id }) => id === activityId)!.recovery, null);
      const ledger = await openFoundationExecutionReclamationLedgerV1({ machineHome: fixture.machineHome,
        installationId: fixture.configuration.installationId!, create: false, clock: { now: fixture.now } });
      try {
        const entries = ledger.list().filter(({ owner }) => owner.kind === "check");
        assert.equal(entries.length, 2, "Separate exact allocations share a proof subject without sharing a Reclamation obligation");
        assert.equal(new Set(entries.map(({ obligationDigest }) => obligationDigest)).size, 2);
        assert(entries.every(({ owner }) => owner.activityId === activityId && owner.subjectDigest === boundary.digest));
      } finally { ledger.close(); }
      assert.equal((await fixture.admit()).status, "completed");
      assert.equal(fixture.current("activeBoundary").digest, boundary.digest);
      context.diagnostic(JSON.stringify({ starting: fixture.deliveryId, activityId, interruption,
        sequence: ["prepare", "first Check Receipt", "second Check allocation", ...(interruption === "none" ? [] : ["lose return", "reopen SQLite and supplied physical snapshot"]), "second Check Receipt", "proposal", "admit"],
        expected: "two exact baseline Receipts, distinct Reclamation obligations, one reconnaissance dispatch, admitted same Boundary",
        exclusions: "No real Docker, provider, or OS process restart; reconstructed owners read retained disk state." }));
    } finally { check.close(); await fixture.dispose(); }
  });
}

test("retained invalid proposal recovery completes after a lost Receipt return without another provider invocation", async (context) => {
  const fixture = await createConnectedDeliveryFixture({ id: "retained-proposal-refusal" });
  const activityId = "prepare-retained-proposal-refusal";
  try {
    // This frozen proposal is syntactically valid but names no installed Binding.
    // It reaches the same conclusive pre-retention refusal owner as a Work
    // Product retained before the required-phase compiler correction.
    const markdown = connectedPreparationMarkdown().replace("- Binding: binding.check.demo", "- Binding: binding.check.absent");
    const agent = installedHarness({ machineHome: fixture.machineHome, now: fixture.now, backendLimits: CONNECTED_BACKEND_LIMITS,
      produceOutput: async () => ({ entries: [connectedSemanticEntry(markdown)] }) });
    let lostReturn = false;
    const options = { agentOperation: { ...agent.options,
      async retainReceipt(input: Parameters<typeof retainExecutionReceipt>[0]) {
        const retained = await retainExecutionReceipt(input);
        if (!lostReturn) { lostReturn = true; throw new Error("lost-invalid-proposal-receipt-return"); }
        return retained;
      } }, boundaryFinalization: { machineHome: fixture.machineHome, now: fixture.now } };
    const basis = await preflightFoundationPreparationBasisV7({ target: fixture.target,
      semanticMarkdown: "# Prepare\n\nChange the bounded source.\n", observedAt: fixture.now() });
    await assert.rejects(operateFoundationPreparationRuntimeV7({ store: fixture.store, configuration: fixture.configuration,
      activityId, runtimeId: CONNECTED_RUNTIME_ID, agentId: "agent:reconnaissance", basis,
      submittedAt: fixture.now(), startedAt: fixture.now(), attemptCreatedAt: fixture.now() }, options), /lost-invalid-proposal-receipt-return/u);
    const events = fixture.store.listEvents(0, 1000);
    const retainedSubjects = events.filter(({ eventKind }) => ["agent-work-product-submitted", "execution-receipt-recorded"].includes(eventKind))
      .map(({ subject }) => { assert(subject !== null); return fixture.store.getRevision(subject.recordId, subject.revision)!; });
    assert.equal(retainedSubjects.length, 2);
    assert.equal(fixture.store.state().activities[0]?.recovery?.resumesAt, "work-boundary-finalized");
    await fixture.reopenStore();
    context.diagnostic(JSON.stringify({ starting: fixture.deliveryId, activityId,
      sequence: ["prepare", "retain exact Work Product and Receipt", "lose return", "reopen SQLite", "recover", "complete failed"],
      expected: "same records and one provider invocation, no Boundary, recovery support retired" }));
    const recovered = await recoverFoundationPreparationRuntimeV7({ target: fixture.target, store: fixture.store,
      configuration: fixture.configuration, activityId, runtimeId: CONNECTED_RUNTIME_ID }, options);
    assert.equal(recovered.outcome, "failed");
    assert.equal(agent.dispatchCount(), 1);
    assert.equal(fixture.store.state().subjects.proposedBoundary, null);
    assert.equal(fixture.store.state().activities[0]?.stage, "completed");
    assert.equal(fixture.store.state().activities[0]?.recovery, null);
    assert.equal(fixture.store.getOperationSupport(activityId), null);
    for (const retained of retainedSubjects) {
      assert.deepEqual(fixture.store.getRevision(retained.recordId, retained.revision), retained);
    }
    const completedEvents = fixture.store.listEvents(0, 1000);
    for (const kind of ["agent-attempt-prepared", "provider-effect-intended", "agent-work-product-submitted", "execution-receipt-recorded", "activity-completed"]) {
      assert.equal(completedEvents.filter(({ eventKind }) => eventKind === kind).length, 1, kind);
    }
  } finally { await fixture.dispose(); }
});

test("preparation refuses an empty required Check phase and a fresh corrected postcondition reaches evaluation", async (context) => {
  const postcondition = connectedPreparationMarkdown().replace("- Modality: regression-guard", "- Modality: postcondition");
  for (const phase of ["Baseline", "Final"] as const) {
    const fixture = await createConnectedDeliveryFixture({ id: `empty-${phase.toLowerCase()}-checks` });
    try {
      const result = await fixture.prepare(postcondition.replace(`- ${phase} required: true`, `- ${phase} required: false`));
      context.diagnostic(JSON.stringify({ starting: fixture.deliveryId, phase, sequence: ["prepare", "refuse semantic submission", "complete failed"],
        expected: "one retired execution, no Work Product or Boundary, no permanent recovery" }));
      assert.equal(result.outcome, "failed");
      assert.equal(result.workProduct, null);
      assert.equal(fixture.store.state().subjects.proposedBoundary, null);
      assert.equal(fixture.store.state().activities[0]?.stage, "completed");
      assert.equal(fixture.store.state().activities[0]?.recovery, null);
      assert.equal(fixture.invocations.length, 1);
      const receipt = fixture.store.getRevision(result.receipt.id, result.receipt.revision)!;
      assert.equal((receipt.payload.workspace as ControlJsonObject).compilerDisposition, "invalid-result");
      assert.equal(fixture.store.listEvents(0, 1000).filter(({ eventKind }) => eventKind === "check-receipt-recorded").length, 0);
    } finally { await fixture.dispose(); }
  }
  const corrected = await createConnectedDeliveryFixture({ id: "corrected-postcondition-checks" });
  try {
    context.diagnostic(JSON.stringify({ starting: corrected.deliveryId,
      sequence: ["prepare postcondition with both requirements", "not-run baseline", "admit", "continue", "integrate", "evaluate"],
      expected: "authorized baseline non-execution permits the exact Product to reach acceptance-ready Evidence" }));
    assert.equal((await corrected.prepare(postcondition)).outcome, "completed");
    assert.equal(corrected.store.state().standing, "awaiting-admission");
    const baselineEvent = corrected.store.listEvents(0, 1000).find(({ eventKind }) => eventKind === "check-receipt-recorded");
    assert(baselineEvent?.subject !== undefined && baselineEvent.subject !== null);
    const baseline = corrected.store.getRevision(baselineEvent.subject.recordId, baselineEvent.subject.revision)!;
    assert.equal(baseline.payload.disposition, "not-run");
    assert.deepEqual(baseline.payload.notRunAuthorization, { kind: "baseline-postcondition" });
    assert.equal(baseline.payload.startedAt, null);
    assert.equal(baseline.payload.finishedAt, null);
    assert.deepEqual(baseline.payload.execution, { allocation: "not-allocated" });
    assert.equal(baseline.relationships.find(({ relation }) => relation === "checks-boundary")?.target.digest,
      corrected.store.state().subjects.proposedBoundary?.digest);
    await corrected.admit();
    const product = "export const value = 'corrected-postcondition';\n";
    assert.equal((await corrected.continue({ edit: (repo) => writeConnectedFile(repo, "src/demo.ts", product) })).outcome, "completed");
    await ready(corrected);
    const packetReference = corrected.store.state().subjects.evidence!;
    const packet = corrected.store.getRevision(packetReference.id, packetReference.revision)!;
    const receiptUse = packet.payload.receiptUse as readonly ControlJsonObject[];
    assert.deepEqual(receiptUse.filter(entry => entry.phase === "baseline").map(entry => ({
      receiptId:entry.receiptId,use:entry.use,freshness:entry.freshness,subjectEquivalence:entry.subjectEquivalence,
      ageMs:entry.ageMs,maximumAgeMs:entry.maximumAgeMs,reasonCode:entry.reasonCode,
    })), [{receiptId:baseline.recordId,use:"excluded",freshness:"not-applicable",subjectEquivalence:"exact",
      ageMs:null,maximumAgeMs:null,reasonCode:"baseline-postcondition-not-run"}]);
    assert(packet.relationships.some(entry => entry.relation === "uses-check" && entry.target.digest === baseline.digest));
    const finalUse = receiptUse.find(entry => entry.phase === "final")!;
    assert.equal(finalUse.use, "executed"); assert.equal(finalUse.freshness, "fresh");
    const finalReceipt = corrected.store.getRevision(finalUse.receiptId as string, 1)!;
    assert.equal(finalReceipt.payload.disposition, "pass");
    assert.equal((finalReceipt.payload.execution as ControlJsonObject).allocation, "allocated");
    assert.equal(typeof finalReceipt.payload.finishedAt, "string");
    assert.equal((packet.payload.uncertainty as ControlJsonObject).level, "bounded",
      "The reviewer retains its bounded judgment; authorized non-execution adds no unknown uncertainty");
    await corrected.reopenStore();
    assert.deepEqual(corrected.store.getRevision(baseline.recordId, baseline.revision), baseline,
      "Evaluation and reopen cannot add execution facts to the immutable authorized baseline");
    assert.deepEqual(corrected.store.getRevision(packet.recordId, packet.revision), packet);
    assert(corrected.store.state().eligibleOperations.includes("delivery.accept"));
    assert.equal(await readConnectedCandidateFile(corrected, "src/demo.ts"), product);
  } finally { await corrected.dispose(); }
});

test("a reviewer capability Condition resolves an explicit Check requirement without losing the Product", async (context) => {
  const fixture = await createConnectedDeliveryFixture({ id: "reviewer-check-capability", agentBackend: "docker-observed" });
  const requirement = "The command uses the exact environment already declared by its selected Binding.";
  const postcondition = connectedPreparationMarkdown().replace("- Modality: regression-guard", "- Modality: postcondition");
  const initial = postcondition.replace("- Final required: true", `- Final required: true\n- Environment requirement: ${requirement}`);
  const checkReceipts = () => fixture.store.listEvents(0, 1000)
    .filter(({ eventKind }) => eventKind === "check-receipt-recorded")
    .map(({ subject }) => {
      assert(subject !== null);
      const receipt = fixture.store.getRevision(subject.recordId, subject.revision);
      assert(receipt !== null);
      return receipt;
    });
  const conditionReview = (input: ConnectedAgentInput): string => connectedReviewerMarkdown(input)
    .replace("The exact supplied subjects support the bounded result.", "The final Check cannot interpret the authored environment prerequisite.")
    .replace("- Category: completed", "- Category: limitation")
    .replace("The supplied subjects support the reviewed source result.", "The retained unsupported Check does not establish the required final proof.")
    .replace("## Review", "## Limitations\n### Limitation: limit-environment\nThe selected Check route cannot interpret the additional free-text prerequisite.\n## Review")
    .replace("- Disposition: applicable", "- Disposition: requires-readmission")
    .replace("The admitted mandate remains applicable to the exact parent and Candidate.",
      "The Director must decide whether any prerequisite beyond the exact Binding was intended; the reviewer cannot waive it.")
    .replace("### Decision: decision-0", ["### Material Condition: condition-environment",
      "- Condition class: required-capability-unavailable",
      "The final Receipt reports the free-text environment requirement unsupported. Retain the Candidate and request explicit mandate resolution before renewed evaluation.",
      "### Decision: decision-0"].join("\n"))
    .replaceAll("- Disposition: accepted", "- Disposition: indeterminate")
    .replace(/^- Proposition: (.+)$/gmu, "- Proposition: $1\n- Limitation: limit-environment")
    .replaceAll("The supplied exact evidence supports the proposition.", "The unsupported final Check leaves this proposition unresolved.");
  try {
    context.diagnostic(JSON.stringify({ course: "D reviewer Check capability", starting: fixture.deliveryId,
      sequence: ["prepare postcondition with explicit environment requirement", "authorized baseline not-run", "admit", "continue", "integrate",
        "unsupported final Check and invalid reviewer local reference", "reopen SQLite", "correct typed review and freeze Condition",
        "explicit Director revision", "readmit unchanged Product", "reopen SQLite", "integrate", "execute final Check", "renewed review and Evidence"],
      expected: "The original Boundary and Receipts remain immutable; only authenticated changed mandate replaces the unsupported requirement",
      exclusions: "Deterministic external provider and executed-Check responses; no real provider, Docker daemon, OS restart, browser, acceptance or publication" }));
    assert.equal((await fixture.prepare(initial)).outcome, "completed");
    const originalBaseline = checkReceipts()[0]!;
    assert.equal(originalBaseline.payload.disposition, "not-run");
    assert.deepEqual(originalBaseline.payload.notRunAuthorization, { kind: "baseline-postcondition" });
    assert.equal((await fixture.admit()).status, "completed");
    const originalBoundary = fixture.current("activeBoundary");
    const originalCheck = (originalBoundary.payload.mandate as ControlJsonObject).checks as readonly ControlJsonObject[];
    assert.equal(originalCheck.length, 1);
    assert.deepEqual(originalCheck[0]!.environmentRequirements, [requirement]);
    const product = "export const value = 'retained-through-check-resolution';\n";
    assert.equal((await fixture.continue({ edit: (repo) => writeConnectedFile(repo, "src/demo.ts", product) })).outcome, "completed");
    assert.equal((await fixture.integrate()).outcome, "constructed");
    const frozen = fixture.current("candidate");

    // Supply the actual authoring mistake as raw provider Markdown. The normal
    // compiler rejects it before a Work Product, Condition or Packet is retained.
    const failed = await fixture.evaluate((input) => conditionReview(input).replaceAll("- Limitation: limit-environment", "- Limitation: review-result"));
    assert.equal(failed.outcome, "failed");
    assert.equal(failed.workProduct, null);
    const failedActivity = fixture.invocations.at(-1)!.activityId;
    assert.equal(fixture.store.getOperationSupport(failedActivity), null);
    assert.equal(fixture.store.state().activities.find(({ id }) => id === failedActivity)!.recovery, null);
    assert.deepEqual(fixture.current("candidate"), frozen);
    assert.equal(fixture.store.state().subjects.materialCondition, null);
    assert.equal(fixture.store.state().subjects.evidence, null);
    const unsupported = checkReceipts().find(({ payload }) => payload.phase === "final")!;
    assert.equal(unsupported.payload.disposition, "unsupported");
    assert.equal(unsupported.payload.reasonCode, "check-environment-unsupported");
    assert.deepEqual(unsupported.payload.execution, { allocation: "not-allocated" });
    assert.equal(unsupported.relationships.find(({ relation }) => relation === "checks-seal")?.target.digest,
      fixture.store.state().subjects.seal?.digest);
    await fixture.reopenStore();
    const refused = await currentViews(fixture);
    assert.equal(refused.attempt.coordinate.attempt.digest, failed.attempt.digest);
    assert.equal(refused.attempt.agentSemantics.submissionDiagnostics.diagnostic?.code,
      "lifecycle.agent-work-product.invalid.local-reference");
    assert.equal(refused.attempt.agentSemantics.submissionDiagnostics.compilerDisposition, "invalid-result");
    assert(refused.delivery.state.eligibleOperations.includes("delivery.evaluate"));
    assert(!refused.delivery.state.eligibleOperations.includes("delivery.recover"));

    const reviewed = await fixture.evaluate(conditionReview);
    assert.equal(reviewed.outcome, "completed");
    assert(reviewed.workProduct !== null);
    const review = fixture.store.getRevision(reviewed.workProduct.id, reviewed.workProduct.revision)!;
    const role = review.payload.roleSemantics as ControlJsonObject;
    assert.equal((role.mandateApplicability as ControlJsonObject).disposition, "requires-readmission");
    const limitations = review.payload.limitations as readonly ControlJsonObject[];
    assert.equal(limitations.length, 1);
    for (const judgment of role.judgments as readonly ControlJsonObject[]) {
      assert.deepEqual(judgment.limitationIds, [limitations[0]!.id]);
    }
    const conditionRef = fixture.store.state().subjects.materialCondition!;
    assert(conditionRef !== null);
    const condition = fixture.store.getRevision(conditionRef.id, conditionRef.revision)!;
    assert.equal(condition.payload.conditionClass, "required-capability-unavailable");
    assert.equal((condition.payload.source as ControlJsonObject).kind, "agent-proposal");
    assert.equal(condition.relationships.find(({ relation }) => relation === "reported-by")?.target.digest, review.digest);
    assert.equal(condition.relationships.find(({ relation }) => relation === "observed-in")?.target.digest, reviewed.receipt.digest);
    assert.equal(condition.relationships.find(({ relation }) => relation === "freezes")?.target.digest, frozen.digest);
    assert.equal(condition.relationships.find(({ relation }) => relation === "governed-by")?.target.digest, originalBoundary.digest);
    assert.deepEqual(fixture.current("candidate"), frozen);
    const pausedViews = await currentViews(fixture);
    assert(pausedViews.delivery.state.eligibleOperations.includes("delivery.revise"));
    assert(!pausedViews.delivery.state.eligibleOperations.includes("delivery.continue"));
    const priorEvidence = fixture.store.state().subjects.evidence!;
    const priorPacket = fixture.store.getRevision(priorEvidence.id, priorEvidence.revision)!;
    assert.notEqual(priorPacket.payload.readiness, "acceptance-ready");
    assert.equal(pausedViews.delivery.decisionReadiness.uncertainty, "material",
      "Unsupported required proof leaves Packet uncertainty material even though the reviewer's own report is bounded");
    assert.equal(pausedViews.delivery.semantics.outcome.uncertainty, "bounded");
    assert.deepEqual(pausedViews.delivery.decisionReadiness.reviewerFindings,
      (role.judgments as readonly ControlJsonObject[]).map(({ id, rationale, uncertainty }) =>
        ({ id, statement: rationale, uncertainty })));
    assert.deepEqual(pausedViews.delivery.decisionReadiness.limitations,
      limitations.map(({ id, statement }) => ({ id, statement, uncertainty: null })));
    assert(pausedViews.delivery.decisionReadiness.changedSubjects.some(({ statement }) => statement === "src/demo.ts"),
      "The selected Candidate retains its changed subjects after a read-only reviewer Attempt");
    assert.equal(pausedViews.delivery.semantics.requiredChecks[0]?.statement, "Observe the bounded source result.",
      "The Check selection owns its authored purpose; its Definition is only an exact Knowledge reference");
    assert.equal(pausedViews.delivery.decisionReadiness.checks[0]?.disposition, "unsupported");
    const originalReceipts = checkReceipts();

    const resolved = await fixture.continue({ operation: "delivery.revise", semanticMarkdown: postcondition,
      direction: "# Revise\n\nNo additional environment prerequisite beyond the exact selected Binding was intended. Explicitly remove only the redundant free-text Environment requirement. Preserve the Check Definition, Binding, postcondition modality, required final proof and useful Candidate.\n" });
    assert.equal(resolved.outcome, "completed");
    const proposed = fixture.store.state().subjects.proposedBoundary!;
    const successor = fixture.store.getRevision(proposed.id, proposed.revision)!;
    const revisedCheck = ((successor.payload.mandate as ControlJsonObject).checks as readonly ControlJsonObject[])[0]!;
    assert.deepEqual(revisedCheck.environmentRequirements, []);
    assert.deepEqual(revisedCheck.definition, originalCheck[0]!.definition);
    assert.deepEqual(revisedCheck.bindings, originalCheck[0]!.bindings);
    assert.equal(revisedCheck.modality, "postcondition");
    assert.equal(revisedCheck.baselineRequired, true);
    assert.equal(revisedCheck.finalRequired, true);
    assert.deepEqual((successor.payload.resolution as ControlJsonObject).changedMandateFields,
      ["/mandate/checks", "/mandate/acceptancePropositions"]);
    assert.equal(successor.relationships.find(({ relation }) => relation === "revises")?.target.digest, originalBoundary.digest);
    assert.equal(successor.relationships.find(({ relation }) => relation === "resolves")?.target.digest, condition.digest);
    assert.equal(successor.relationships.find(({ relation }) => relation === "proposed-from")?.target.digest, resolved.workProduct?.digest);
    assert.equal(fixture.current("activeBoundary").digest, originalBoundary.digest);
    assert.deepEqual(fixture.current("candidate"), frozen);
    assert.deepEqual(fixture.store.state().subjects.materialCondition, conditionRef);
    await fixture.reopenStore();
    const proposedViews = await currentViews(fixture);
    assert.equal(proposedViews.attempt.attemptContract.role, "reconnaissance");
    assert.equal(proposedViews.delivery.semantics.outcome.summary, "The requested change has a complete bounded route.");
    assert.equal(proposedViews.delivery.semantics.boundaryProposal?.reference.digest, successor.digest);
    assert.notEqual(revisedCheck.id, originalCheck[0]!.id);
    assert.deepEqual(proposedViews.delivery.decisionReadiness, pausedViews.delivery.decisionReadiness,
      "A later revised proposal cannot replace the selected evaluation's review, Packet uncertainty, Candidate changes, Checks or observed subjects");
    assert.deepEqual(proposedViews.delivery.semantics.requiredChecks, pausedViews.delivery.semantics.requiredChecks,
      "Until readmission the governing Check selection, purpose and unsupported Receipt remain exact");
    for (const fault of ["reviewer", "candidate"] as const) {
      const replacement = fault === "reviewer"
        ? { kind: "agent-work-product", ...resolved.workProduct! }
        : frozen.relationships.find(({ relation }) => relation === "revises")!.target;
      const substituted = { ...priorPacket, relationships: priorPacket.relationships.map((entry) =>
        entry.relation === (fault === "reviewer" ? "uses-review" : "evaluates")
          ? { ...entry, target: replacement } : entry) };
      const store = new Proxy(fixture.store, {
        get(target, property) {
          if (property === "getRevision") return (id: string, revision: number) =>
            id === priorPacket.recordId && revision === priorPacket.revision ? substituted : target.getRevision(id, revision);
          const value = Reflect.get(target, property);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const observed = await observeFoundationRepositoryIdentityForRead(fixture.target, fixture.now());
      // The actual Attempt View replays the Journal before the Delivery display
      // joins. A substituted Packet must already fail that retained relationship.
      assert.throws(() => compileDeliveryView({ store, physical: ACTIVE,
        repository: observed.repository, investment: fixture.configuration, observedAt: fixture.now() }),
      { code: "lifecycle.delivery-reducer.reference",
        message: `Evidence Packet ${fault === "reviewer" ? "review" : "Candidate"} does not bind the exact current Control record subject` },
      `A substituted ${fault} cannot supply the retained evaluation display`);
    }
    assert.deepEqual(fixture.store.getRevision(priorEvidence.id, priorEvidence.revision), priorPacket);
    assert.equal((await fixture.admit()).status, "completed");
    const rebound = fixture.current("candidate");
    assert.equal(rebound.recordId, frozen.recordId);
    assert.equal(rebound.revision, frozen.revision + 1);
    assert.equal(rebound.payload.observation, "readmission-rebind");
    assert.deepEqual(rebound.payload.state, frozen.payload.state);
    assert.deepEqual(rebound.payload.carrierManifest, frozen.payload.carrierManifest);
    assert.equal(fixture.current("activeBoundary").digest, successor.digest);
    assert.equal(fixture.store.state().subjects.materialCondition, null);
    assert.equal(fixture.store.state().subjects.evidence, null);
    await fixture.reopenStore();
    const readmittedViews = await currentViews(fixture);
    assert.equal(readmittedViews.delivery.decisionReadiness.evidence, null);
    assert.equal(readmittedViews.delivery.decisionReadiness.evidenceReadiness, null);
    assert.equal(readmittedViews.delivery.decisionReadiness.uncertainty, null);
    assert.deepEqual(readmittedViews.delivery.decisionReadiness.reviewerFindings, []);
    assert.deepEqual(readmittedViews.delivery.decisionReadiness.limitations, []);
    assert.equal(readmittedViews.delivery.semantics.requiredChecks[0]?.selectionId, revisedCheck.id);
    assert.equal(readmittedViews.delivery.decisionReadiness.checks[0]?.disposition, "not-run",
      "The new Boundary's authorized baseline is not the old Boundary's final result");
    assert.equal(await readConnectedCandidateFile(fixture, "src/demo.ts"), product);

    await ready(fixture);
    const completed = await currentViews(fixture);
    assert.equal(completed.delivery.decisionReadiness.evidenceReadiness, "acceptance-ready");
    const candidate = fixture.current("candidate");
    assert.equal(candidate.recordId, frozen.recordId);
    const sealRef = fixture.store.state().subjects.seal!;
    const seal = fixture.store.getRevision(sealRef.id, sealRef.revision)!;
    assert.equal(seal.relationships.find(({ relation }) => relation === "seals")?.target.digest, candidate.digest);
    assert.equal(seal.relationships.find(({ relation }) => relation === "governed-by")?.target.digest, successor.digest);
    const evidenceRef = fixture.store.state().subjects.evidence!;
    const evidence = fixture.store.getRevision(evidenceRef.id, evidenceRef.revision)!;
    const final = checkReceipts().filter(({ payload }) => payload.phase === "final").at(-1)!;
    assert.equal(final.payload.disposition, "pass");
    assert.notEqual(final.digest, unsupported.digest);
    assert.equal(final.payload.selectionId, revisedCheck.id);
    assert.deepEqual(final.payload.definition, revisedCheck.definition);
    assert.deepEqual(final.payload.binding, (revisedCheck.bindings as readonly ControlJsonObject[])[0]);
    assert.equal((final.payload.execution as ControlJsonObject).allocation, "allocated");
    assert.equal(final.relationships.find(({ relation }) => relation === "checks-seal")?.target.digest, seal.digest);
    assert.notEqual(seal.digest, unsupported.relationships.find(({ relation }) => relation === "checks-seal")?.target.digest);
    for (const [relation, digest] of [["governed-by", successor.digest], ["evaluates", candidate.digest],
      ["uses-seal", seal.digest], ["uses-check", final.digest], ["uses-review", completed.attempt.agentSemantics.workProduct!.digest],
      ["uses-review-receipt", completed.attempt.providerExecution.receipt!.digest]]) {
      assert(evidence.relationships.some((entry) => entry.relation === relation && entry.target.digest === digest));
    }
    assert(!evidence.relationships.some(({ target }) => target.digest === unsupported.digest),
      "Fresh readiness cannot reuse the unsupported Receipt from the superseded mandate");
    assert.deepEqual(fixture.store.getRevision(originalBoundary.recordId, originalBoundary.revision), originalBoundary);
    for (const receipt of originalReceipts) assert.deepEqual(fixture.store.getRevision(receipt.recordId, receipt.revision), receipt);
    assert.equal(await readConnectedCandidateFile(fixture, "src/demo.ts"), product);
    assert.equal(await readFile(join(fixture.target, "src/demo.ts"), "utf8"), "export const value = 'base';\n");
    assert.equal(fixture.invocations.length, 6, "Preparation, builder, two reviews, revision and renewed review each dispatch once");
  } finally { await fixture.dispose(); }
});

for (const resolution of ["reaffirm", "revise-after-image-refusal", "revise-after-semantic-refusal"] as const) {
test(`D ${resolution}: measured reviewer refusal resolves through the selected larger profile and evaluates the retained Product`, async (context) => {
  const fixture = await createConnectedDeliveryFixture({ id: `capacity-${resolution}`, agentBackend: "docker-observed" });
  const preparation = connectedPreparationMarkdown;
  try {
    assert.equal((await fixture.prepare(preparation("execution-standard-v1"))).outcome, "completed"); await fixture.admit();
    const originalBoundary = fixture.current("activeBoundary");
    context.diagnostic(JSON.stringify({ course: "D", resolution, starting: fixture.store.state().subjects,
      sequence: ["continue", "reopen", "continue", "integrate", "evaluate/refuse", "reopen",
        ...(resolution === "reaffirm" ? ["reaffirm"] : resolution === "revise-after-image-refusal"
          ? ["revise/image-unavailable", "reopen SQLite", "recover/image-invalid-and-absent", "lose refusal return",
            "reopen SQLite", "recover/abandoned", "fresh revise/corrected Image"]
          : ["revise/duplicate local identity", "reopen SQLite", "read Attempt and Delivery", "fresh revise/corrected semantic"]),
        "admit", "reopen", "integrate", "evaluate", "read reviewer Attempt and Delivery"],
      expected: "same Product survives two Attempts and exact capacity resolution, then reaches acceptance-ready Evidence" }));
    const selectedLimit = fixture.contract.projectionProfiles["execution-standard-v1"]!.maximumItemBytes;
    const largeLimit = fixture.contract.projectionProfiles["execution-large-v1"]!.maximumItemBytes;
    const firstProduct = `export const value = 'large-progress';\n/*${"x".repeat(largeLimit - 4096)}*/\n`;
    const product = firstProduct.replace("large-progress", "complete");
    assert(Buffer.byteLength(product) > selectedLimit);
    assert(Buffer.byteLength(product) < largeLimit);
    const first = await fixture.continue({ edit: (repo, input) => {
      assert.equal(input.specification.limits.outputBytes, 256 * 1024 * 1024);
      assert.equal(input.specification.limits.outputEntryBytes, 256 * 1024 * 1024,
        "The installed Docker profile retains its fixed per-entry ceiling independently of Projection capacity");
      return writeConnectedFile(repo, "src/demo.ts", firstProduct);
    } });
    assert.equal(first.outcome, "completed");
    const investment = fixture.store.getRevision(first.attempt.id, first.attempt.revision)!.payload.investment as ControlJsonObject;
    assert.equal((investment.limits as ControlJsonObject).outputBytes, 256 * 1024 * 1024);
    await fixture.reopenStore();
    assert.equal((await fixture.continue({ edit: async (repo) => {
      assert.equal(await readFile(join(repo, "src/demo.ts"), "utf8"), firstProduct);
      await writeConnectedFile(repo, "src/demo.ts", product);
    } })).outcome, "completed");
    await fixture.integrate();
    const frozenCandidate = fixture.current("candidate");
    context.diagnostic(JSON.stringify({ course: "D", fault: "measured mandatory item exceeds execution-standard-v1",
      candidate: { id: frozenCandidate.recordId, revision: frozenCandidate.revision, digest: frozenCandidate.digest },
      observedBytes: Buffer.byteLength(product), selectedLimit, permittedReplacementLimit: largeLimit }));
    const dispatchedBefore = fixture.invocations.length;
    await assert.rejects(() => fixture.evaluate(), {
      code: "lifecycle.projection.mandatory-too-large",
    });
    assert.equal(fixture.invocations.length, dispatchedBefore, "Conclusive mandatory context refusal cannot manufacture a reviewer execution");
    const conditionRef = fixture.store.state().subjects.materialCondition;
    assert(conditionRef !== null);
    const condition = fixture.store.getRevision(conditionRef.id, conditionRef.revision)!;
    assert.equal((condition.payload.source as ControlJsonObject).kind, "projection-compilation");
    assert.equal(condition.relationships.find(({ relation }) => relation === "freezes")?.target.digest, frozenCandidate.digest);
    await fixture.reopenStore();
    const paused = await currentViews(fixture);
    assert.equal(paused.attempt.processAndProof.materialCondition?.reference.digest, condition.digest);
    assert.equal(paused.delivery.currentSubjects.materialCondition?.digest, condition.digest);
    assert(paused.attempt.processAndProof.obligations.every(({ standing }) => standing !== "material-condition"),
      "A measured Projection refusal does not invent an Agent mandate falsifier");
    if (resolution === "revise-after-image-refusal") {
      context.diagnostic(JSON.stringify({ course: "D", resolution, starting: fixture.store.state().subjects,
        fault: "Unavailable Image observation, then complete invalidity plus allocation absence, then lost refusal return",
        expected: "Same Delivery, Candidate and Material Condition survive SQLite reopen; fresh corrected revision reaches readmission and acceptance-ready Evidence",
        exclusions: "No OS process restart, Docker daemon, live provider, publication or no-ship" }));
      await settleUnallocatedRevision(fixture);
      assert.equal(fixture.invocations.length, dispatchedBefore, "Failed resolution cannot invoke an Agent");
    }
    if (resolution === "revise-after-semantic-refusal") {
      const activityId = "revise-duplicate-citation-artifact";
      const invalid = preparation("execution-large-v1").replace("### Citation: check-owner", "### Citation: source");
      const failed = await fixture.continue({ activityId, operation: "delivery.revise",
        direction: "# Revise\n\nRetain useful progress and select the larger Projection profile.\n",
        semanticMarkdown: invalid });
      assert.equal(failed.outcome, "failed");
      assert.equal(failed.workProduct, null);
      assert.equal(fixture.store.getOperationSupport(activityId), null);
      assert.equal(fixture.store.state().activities.find(({ id }) => id === activityId)!.recovery, null);
      assert.equal(fixture.store.state().subjects.proposedBoundary, null);
      assert.equal(fixture.current("activeBoundary").digest, originalBoundary.digest);
      assert.deepEqual(fixture.current("candidate"), frozenCandidate);
      assert.deepEqual(fixture.store.state().subjects.materialCondition, conditionRef);
      assert.equal(fixture.invocations.length, dispatchedBefore + 1);
      await fixture.reopenStore();
      const refused = await currentViews(fixture);
      assert.equal(refused.attempt.coordinate.attempt.digest, failed.attempt.digest);
      assert.equal(refused.attempt.attemptContract.operation, "delivery.revise");
      assert.equal(refused.attempt.attemptContract.role, "reconnaissance");
      assert.equal(refused.attempt.attemptContract.candidate?.digest, frozenCandidate.digest);
      assert.equal(refused.attempt.agentSemantics.workProduct, null);
      assert.equal(refused.attempt.agentSemantics.submissionDiagnostics.diagnostic?.code,
        "lifecycle.agent-work-product.invalid.duplicate-local-identity");
      assert.equal(refused.attempt.agentSemantics.submissionDiagnostics.parserDisposition, "invalid");
      assert.equal(refused.attempt.agentSemantics.submissionDiagnostics.compilerDisposition, "not-run");
      assert.equal(refused.attempt.candidateTransition.input, null);
      assert.equal(refused.attempt.candidateTransition.successor, null);
      assert.equal(refused.attempt.candidateTransition.current?.revision.digest, frozenCandidate.digest);
      assert.equal(refused.delivery.currentSubjects.materialCondition?.digest, condition.digest);
      assert.equal(refused.delivery.semantics.outcome.summary, null, "Invalid provider prose cannot become a retained outcome");
      assert(refused.delivery.nextPass.some(({ operation: next, eligible }) => next === "delivery.revise" && eligible));
      assert(!refused.attempt.processAndProof.eligibleOperations.includes("delivery.recover"));
    }
    const resolutionInputs: ConnectedAgentInput[] = [];
    const operation = resolution === "reaffirm" ? "delivery.reaffirm" : "delivery.revise";
    const revisedObjective = "Make the source expose the requested value, preserve coherent Knowledge revisions, and retain useful progress through explicit resolution.";
    const resolved = await fixture.continue({ operation,
      direction: resolution === "reaffirm" ? "# Reaffirm\n\nKeep the mandate and explicitly select the registered larger Projection profile.\n"
        : "# Revise\n\nRevise the objective to make retained useful progress explicit, use distinct Citation and Artifact handles, and select the larger Projection profile.\n",
      semanticMarkdown: (input) => {
        resolutionInputs.push(input);
        assert.equal(input.specification.image.imageDigest, fixture.configuration.execution!.image.imageDigest,
          "Only the fresh resolution selects the explicitly corrected installed Image");
        const proposal = preparation("execution-large-v1");
        return resolution === "reaffirm" ? proposal : proposal.replace(
          "Make the source expose the requested value and preserve coherent Knowledge revisions.", revisedObjective);
      } });
    assert.equal(resolved.outcome, "completed");
    assert.equal(resolutionInputs.length, 1);
    const resolutionText = [...resolutionInputs[0]!.inputEntries.values()].map((bytes) => Buffer.from(bytes).toString("utf8"));
    assert(resolutionText.some((text) => text.includes("projection-compilation") && text.includes(condition.digest) && text.includes(frozenCandidate.digest)),
      "Resolution receives the exact refused Condition and frozen Candidate facts");
    assert(resolutionText.some((text) => text.includes("execution-large-v1") && text.includes(fixture.contract.projectionProfiles["execution-large-v1"]!.digest)),
      "Resolution can discover the exact permitted replacement profile");
    assert.equal(fixture.current("candidate").digest, frozenCandidate.digest, "Read-only resolution cannot advance the frozen Candidate");
    const proposed = fixture.store.state().subjects.proposedBoundary!;
    const successor = fixture.store.getRevision(proposed.id, proposed.revision)!;
    assert.deepEqual(successor.relationships.find(({ relation }) => relation === "revises")?.target,
      { kind: "work-boundary", id: originalBoundary.recordId, revision: originalBoundary.revision, digest: originalBoundary.digest });
    assert.deepEqual(successor.relationships.find(({ relation }) => relation === "resolves")?.target,
      { kind: "material-condition", ...conditionRef });
    assert.deepEqual(successor.relationships.find(({ relation }) => relation === "proposed-from")?.target,
      { kind: "agent-work-product", ...resolved.workProduct! });
    assert.equal(fixture.current("activeBoundary").digest, originalBoundary.digest, "A completed proposal does not reactivate the mandate");
    assert.deepEqual(fixture.store.state().subjects.materialCondition, conditionRef);
    const receipt = fixture.store.getRevision(resolved.receipt.id, resolved.receipt.revision)!;
    assert.equal(((receipt.payload.execution as ControlJsonObject).image as ControlJsonObject).imageDigest,
      fixture.configuration.execution!.image.imageDigest, "The fresh completed resolution retains the corrected exact Image");
    if (resolution === "reaffirm") assert.deepEqual(successor.payload.mandate, originalBoundary.payload.mandate);
    else {
      const { objective: previousObjective, ...previousMandate } = originalBoundary.payload.mandate as ControlJsonObject;
      const { objective, ...mandate } = successor.payload.mandate as ControlJsonObject;
      assert.deepEqual(mandate, previousMandate);
      assert.equal((objective as ControlJsonObject).interpretation, revisedObjective);
      assert.notEqual((objective as ControlJsonObject).fragmentDigest, (previousObjective as ControlJsonObject).fragmentDigest);
    }
    assert.deepEqual(successor.payload.projectionProfile, { id: "execution-large-v1",
      digest: fixture.contract.projectionProfiles["execution-large-v1"]!.digest });
    assert.deepEqual((successor.payload.resolution as ControlJsonObject).changedMandateFields,
      resolution === "reaffirm" ? [] : ["/mandate/objective"]);
    const proposedViews = await currentViews(fixture);
    assert.equal(proposedViews.attempt.coordinate.attempt.digest, resolved.attempt.digest);
    assert.equal(proposedViews.attempt.attemptContract.candidate?.digest, frozenCandidate.digest);
    assert.equal(proposedViews.attempt.candidateTransition.input, null);
    assert.equal(proposedViews.attempt.candidateTransition.successor, null);
    assert.equal(proposedViews.delivery.currentSubjects.proposedBoundary?.digest, successor.digest);
    assert.equal(proposedViews.delivery.currentSubjects.activeBoundary?.digest, originalBoundary.digest);
    assert.equal(proposedViews.delivery.currentSubjects.materialCondition?.digest, condition.digest);
    assert(proposedViews.delivery.state.eligibleOperations.includes("delivery.admit"));
    assert.equal((await fixture.admit()).status, "completed");
    const rebound = fixture.current("candidate");
    assert.deepEqual(rebound.payload.state, frozenCandidate.payload.state);
    assert.deepEqual(rebound.payload.carrierManifest, frozenCandidate.payload.carrierManifest);
    assert.equal(fixture.current("activeBoundary").digest, successor.digest);
    await fixture.reopenStore();
    const admittedViews = await currentViews(fixture);
    assert.equal(admittedViews.delivery.currentSubjects.activeBoundary?.digest, successor.digest);
    assert.equal(admittedViews.delivery.currentSubjects.materialCondition, null);
    assert.equal(admittedViews.attempt.attemptContract.candidate?.digest, frozenCandidate.digest,
      "Readmission does not rewrite the historical resolution Attempt subject");
    assert.equal(admittedViews.attempt.candidateTransition.current?.revision.digest, rebound.digest);
    await ready(fixture);
    const evaluated = await currentViews(fixture);
    assert.equal(evaluated.attempt.attemptContract.role, "reviewer");
    assert.equal(evaluated.attempt.candidateTransition.input?.revision.digest, fixture.current("candidate").digest);
    assert.equal(evaluated.attempt.candidateTransition.successor, null);
    assert.equal(evaluated.attempt.candidateTransition.successorDisposition, null);
    assert.equal(evaluated.delivery.decisionReadiness.evidenceReadiness, "acceptance-ready");
    assert.equal(evaluated.delivery.currentSubjects.candidate?.digest, fixture.current("candidate").digest);
    const reviewerReceiptRef = evaluated.attempt.providerExecution.receipt!;
    const reviewerReceipt = fixture.store.getRevision(reviewerReceiptRef.id, reviewerReceiptRef.revision)!;
    assert.equal(reviewerReceipt.relationships.filter(({ relation }) => relation === "observes-candidate").length, 0,
      "A reviewer binds its exact Candidate in payload.input and observes no successor relation");
    if (resolution === "revise-after-semantic-refusal") assertReviewerInputSubstitutionRefused(fixture, frozenCandidate);
    const reviewerInput = fixture.invocations.at(-1)!.input;
    assert([...reviewerInput.inputEntries.values()].some((bytes) => Buffer.from(bytes).equals(Buffer.from(product))),
      "The renewed reviewer receives the exact mandatory Product bytes that exceeded the original profile");
    assert.equal(await readConnectedCandidateFile(fixture, "src/demo.ts"), product);
    assert.equal(fixture.current("activeBoundary").digest, successor.digest);
    assert.equal(fixture.invocations.length, dispatchedBefore + (resolution === "revise-after-semantic-refusal" ? 3 : 2),
      "Each explicit resolution executes once, followed by the successful renewed reviewer");
    assert.equal(await readFile(join(fixture.target, "src/demo.ts"), "utf8"), "export const value = 'base';\n");
  } finally { await fixture.dispose(); }
});
}
