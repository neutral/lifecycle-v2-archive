import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createFoundationRuntimeOperationRequest, parseFoundationRuntimeOperationResultForRequest } from "@neutral/lifecycle-protocol";
import { openDeliveryControlRecordStore } from "../../src/foundation/control/delivery-custody.js";
import type { ControlJsonObject } from "../../src/foundation/control/types.js";
import { git } from "../../src/foundation/repository/git.js";
import { parseKnowledgeRecord } from "../../src/foundation/knowledge/records.js";
import { openFoundationExecutionReclamationLedgerV1 } from "../../src/foundation/execution/reclamation-ledger-v1.js";
import { acceptDeliveryV7, type FoundationTerminalV7Options } from "../../src/foundation/transaction/terminal-v7.js";
import { foundationMutationBeforeV7, foundationMutationResultV7 } from "../../src/foundation/process/mutation-result-v7.js";
import { createFoundationInvocationPrivateAuthorizationHandoffResultV1 } from "../../src/foundation/invocation-private-authorization-channel-v1.js";
import { CONNECTED_RUNTIME_ID, connectedAuthorityCredential, connectedPreparationMarkdown, connectedKnowledgeDocument,
  createConnectedDeliveryFixture, writeConnectedFile, type ConnectedDeliveryFixture } from "../support/connected-delivery-fixture.js";

async function advanceCanonicalBlueprint(fixture: ConnectedDeliveryFixture, name: string): Promise<void> {
  const path = `records/blueprint/${name}.md`;
  const original = await readFile(join(fixture.target, path), "utf8");
  const header = original.split("---\n")[1]!;
  const revise = (fields: Record<string, unknown>) => original.replace(header, `${JSON.stringify({ ...JSON.parse(header), ...fields }, null, 2)}\n`);
  const superseded = revise({ status: "superseded" });
  const previous = parseKnowledgeRecord({ path, mode: "100644", objectId: "a".repeat(40), bytes: Buffer.from(superseded), contract: fixture.contract });
  await writeConnectedFile(fixture.target, path, superseded);
  await writeConnectedFile(fixture.target, `records/blueprint/${name}-r2.md`, `${revise({ revision: 2, status: "current", supersedes: {
    id: previous.frontMatter.id, revision: 1, sourceDigest: previous.sourceDigest, semanticDigest: previous.semanticDigest,
  } })}\nThe current design also preserves independent canonical contributions.\n`);
}

async function ready(fixture: ConnectedDeliveryFixture): Promise<void> {
  assert.equal((await fixture.integrate()).outcome, "constructed");
  assert.equal((await fixture.evaluate()).outcome, "completed");
  const evidence = fixture.store.state().subjects.evidence!;
  assert.equal(fixture.store.getRevision(evidence.id, evidence.revision)!.payload.readiness, "acceptance-ready");
  assert.equal(fixture.store.state().subjects.materialCondition, null);
}

function terminalOptions(fixture: ConnectedDeliveryFixture): FoundationTerminalV7Options {
  return {
    now: fixture.now,
    observeReclamationHandoff: async (input) => {
      const ledger = await openFoundationExecutionReclamationLedgerV1({ machineHome: fixture.machineHome,
        installationId: fixture.configuration.installationId!, create: false, clock: { now: fixture.now } });
      try { return ledger.verifyTerminalSubjects(input); }
      finally { ledger.close(); }
    },
  };
}

function accept(fixture: ConnectedDeliveryFixture, options: FoundationTerminalV7Options = {}) {
  return acceptDeliveryV7({ target: fixture.target, machineHome: fixture.machineHome, store: fixture.store,
    authorityHome: fixture.authorityHome, authorityCredential: connectedAuthorityCredential("director-decision"),
    runtimeId: CONNECTED_RUNTIME_ID }, { ...terminalOptions(fixture), ...options });
}

for (const contextChange of ["independent", "unselected-knowledge", "selected-knowledge"] as const) {
  test(`F: ${contextChange} canonical movement refuses stale publication, then renews proof and publishes against exact P`, async (context) => {
    const fixture = await createConnectedDeliveryFixture({ id: `stale-parent-${contextChange}`,
      configureTarget: (target) => writeConnectedFile(target, "records/blueprint/discovery.md",
        connectedKnowledgeDocument("blueprint").replace('"id": "blueprint.demo"', '"id": "blueprint.discovery"')) });
    try {
      assert.equal((await fixture.prepare()).outcome, "completed"); await fixture.admit();
      const governing = fixture.current("activeBoundary");
      const admittedParent = (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim();
      const product = "export const value = 'published';\n";
      await fixture.continue({ edit: (repo) => writeConnectedFile(repo, "src/demo.ts", product) });
      await ready(fixture);
      const firstProof = fixture.store.state().subjects;
      context.diagnostic(JSON.stringify({ course: "F", case: contextChange, starting: firstProof,
        operation: "delivery.accept", canonicalParent: admittedParent,
        sequence: ["prepare", "admit", "continue", "integrate", "evaluate", "accept", "canonical movement", "not-applied",
          "reopen", "integrate", ...(contextChange === "selected-knowledge" ? ["revise", "admit", "integrate"] : []), "evaluate", "accept", "archive"],
        fault: "competing canonical commit at canonical-effect-ready" }));
      let movedParent = "";
      const refused = await accept(fixture, { onStage: async (stage) => {
        if (stage !== "canonical-effect-ready") return;
        if (contextChange !== "independent") {
          await advanceCanonicalBlueprint(fixture, contextChange === "selected-knowledge" ? "demo" : "discovery");
        }
        await writeConnectedFile(fixture.target, "independent.txt", "Independent canonical contribution.\n");
        await git(fixture.target, ["add", "."]); await git(fixture.target, ["commit", "-m", "Advance canonical parent before conditional publication"]);
        movedParent = (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim();
      } });
      assert.notEqual(movedParent, admittedParent);
      assert.equal(refused.status, "failed");
      assert.equal(refused.transactionOutcome, "not-applied");
      assert.equal(refused.closure, null);
      assert.equal(fixture.current("activeBoundary").digest, governing.digest);
      assert.equal(fixture.current("candidate").digest, firstProof.candidate!.digest);
      assert.equal(await readFile(join(fixture.target, "src/demo.ts"), "utf8"), "export const value = 'base';\n");
      await fixture.reopenStore();
      assert.equal((await fixture.integrate()).outcome, "constructed");
      assert.equal(fixture.current("candidate").payload.candidateBaseCommit, movedParent);
      if (contextChange === "selected-knowledge") {
        const condition = fixture.store.state().subjects.materialCondition!;
        assert.equal(fixture.store.getRevision(condition.id, condition.revision)!.payload.conditionClass, "integration-context-change");
        assert.equal((await fixture.continue({
          operation: "delivery.revise",
          direction: "# Revise\n\nSelect the new exact Knowledge revision while preserving the requested Product outcome.\n",
          semanticMarkdown: connectedPreparationMarkdown(),
        })).outcome, "completed");
        const proposalRef = fixture.store.state().subjects.proposedBoundary!;
        const proposal = fixture.store.getRevision(proposalRef.id, proposalRef.revision)!;
        assert.deepEqual((proposal.payload.resolution as ControlJsonObject).changedMandateFields, ["/knowledge"]);
        await fixture.admit();
        assert.notEqual(fixture.current("activeBoundary").digest, governing.digest);
        assert.equal((await fixture.integrate()).outcome, "constructed");
      } else {
        assert.equal(fixture.store.state().subjects.materialCondition, null);
        assert.equal(fixture.current("activeBoundary").digest, governing.digest);
      }
      assert.equal((await fixture.evaluate()).outcome, "completed");
      const renewed = fixture.store.state().subjects;
      for (const subject of ["candidate", "seal", "evidence"] as const) assert.notEqual(renewed[subject]!.digest, firstProof[subject]!.digest);
      assert.equal(fixture.store.getRevision(renewed.evidence!.id, renewed.evidence!.revision)!.payload.readiness, "acceptance-ready");
      const renewedCandidateState = fixture.current("candidate").payload.state as ControlJsonObject;
      const beforeAcceptance = foundationMutationBeforeV7(fixture.store, movedParent);
      const afterSequence = fixture.store.state().journal.eventCount;
      const accepted = await accept(fixture);
      assert.equal(accepted.status, "completed");
      assert.equal(accepted.transactionOutcome, "applied");
      assert(accepted.closure !== null);
      assert.notDeepEqual(accepted.decision, refused.decision);
      assert.equal((await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim(), accepted.canonicalCommit);
      assert.equal((await git(fixture.target, ["rev-parse", "HEAD^"])).stdout.trim(), movedParent);
      assert.equal(await readFile(join(fixture.target, "src/demo.ts"), "utf8"), product);
      assert.equal(await readFile(join(fixture.target, "independent.txt"), "utf8"), "Independent canonical contribution.\n");
      const archived = await openDeliveryControlRecordStore({ machineHome: fixture.machineHome,
        targetId: fixture.contract.targetId, deliveryId: fixture.deliveryId });
      try {
        assert.equal(archived.disposition, "archived");
        assert(archived.store.getSeal() !== null);
        assert.deepEqual(archived.store.state().subjects.closure, accepted.closure);
        assert.deepEqual(archived.store.state().subjects.activeBoundary, renewed.activeBoundary);
        const closure = archived.store.getRevision(accepted.closure.id, accepted.closure.revision)!;
        const expectedRelationships = [
          { relation: "accepts-candidate", target: { kind: "candidate-revision", ...renewed.candidate! } },
          { relation: "accepts-evidence", target: { kind: "evidence-packet", ...renewed.evidence! } },
          { relation: "closes-with", target: { kind: "director-decision", ...accepted.decision } },
          { relation: "governed-by", target: { kind: "work-boundary", ...renewed.activeBoundary! } },
        ];
        assert.deepEqual(closure.relationships, expectedRelationships);
        assert.deepEqual(closure.payload.canonicalResult, {
          parentCommit: movedParent,
          parentTree: (await git(fixture.target, ["rev-parse", `${movedParent}^{tree}`])).stdout.trim(),
          commit: accepted.canonicalCommit,
          tree: renewedCandidateState.tree,
          candidateDigest: renewedCandidateState.candidateDigest,
          productStateDigest: renewedCandidateState.productStateDigest,
          knowledgeSetDigest: renewedCandidateState.knowledgeSetDigest,
        });
        assert.equal((await git(fixture.target, ["rev-parse", "HEAD^{tree}"])).stdout.trim(), renewedCandidateState.tree);
        const decision = archived.store.getRevision(accepted.decision.id, accepted.decision.revision)!;
        assert.deepEqual(decision.relationships.find(({ relation }) => relation === "selects-seal")?.target,
          { kind: "candidate-seal", ...renewed.seal! });
        const events = archived.store.listEvents(0, 10_000);
        assert.equal(events.filter(({ eventKind }) => eventKind === "closure-recorded").length, 1);
        assert.equal(events.at(-1)!.eventKind, "closure-recorded");
        // The real terminal owner has applied and archived. Its exact public
        // result must survive the event parser before a CLI handoff can report it.
        const retainedHead = archived.store.state().journal;
        const request = createFoundationRuntimeOperationRequest({ target: fixture.target,
          operation: "delivery.accept", deliveryId: fixture.deliveryId, input: null });
        assert.equal(request.operation, "delivery.accept");
        const result = parseFoundationRuntimeOperationResultForRequest(await foundationMutationResultV7({
          request, store: archived.store, status: "completed", observedAt: fixture.now(),
          afterSequence, before: beforeAcceptance, repositoryObservation: "identity-current",
          physical: { disposition: archived.disposition, archiveManifestDigest: archived.archiveManifestDigest },
        }), request);
        assert.equal(result.status, "completed");
        assert.equal(result.observation.delivery?.standing, "closed");
        assert.equal(result.observation.delivery?.storeDisposition.stage, "archived");
        assert.equal(result.observation.delivery?.recovery, null);
        assert.deepEqual(result.observation.delivery?.eligibleOperations, []);
        assert.deepEqual(result.observation.delivery?.subjects.closure, { kind: "closure", ...accepted.closure });
        assert.deepEqual(result.changes.repository, {
          changed: true, beforeCommit: movedParent, afterCommit: accepted.canonicalCommit,
        });
        assert.equal(result.changes.candidate.changed, false);
        assert.equal(result.changes.control.advanced, true);
        const retainedTransaction = events.find(event => event.sequence > afterSequence && event.eventKind === "transaction-effect-observed")!;
        assert.deepEqual(result.events.find(event => event.eventKind === "transaction-effect-observed"), retainedTransaction);
        const facts = retainedTransaction.payload.facts as ControlJsonObject;
        assert.equal(facts.recognition, "at-tip");
        assert.deepEqual(facts.observedTip, { commit: accepted.canonicalCommit, tree: renewedCandidateState.tree });
        assert(result.control.some(ref => ref.kind === "closure" && ref.digest === accepted.closure!.digest));
        const handoff = createFoundationInvocationPrivateAuthorizationHandoffResultV1({
          kind: "invocation-private-authorization-result", invocationId: "c8e3f835-6317-4abc-8aaf-3e413a802054",
          operation: "delivery.accept", deliveryId: fixture.deliveryId, status: result.status, resultDigest: result.digest,
        });
        assert.equal(handoff.status, "completed");
        assert.equal(handoff.resultDigest, result.digest);
        assert.deepEqual(archived.store.state().journal, retainedHead);
      } finally {
        archived.store.close();
      }
    } finally { await fixture.dispose(); }
  });
}
