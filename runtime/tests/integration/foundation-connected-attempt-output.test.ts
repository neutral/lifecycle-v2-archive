import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { prepareAndAdmit, integrateAndEvaluate } from "../support/connected-delivery-assertions.js";
import type { ControlJsonObject } from "../../src/foundation/control/types.js";
import { createConnectedDeliveryFixture, writeConnectedFile } from "../support/connected-delivery-fixture.js";
import { readConnectedCandidateFile } from "../support/connected-candidate-inspection.js";

test("B: unsuccessful provider terminal facts preserve valid Product progress for correction and evaluation", async (context) => {
  const fixture = await createConnectedDeliveryFixture({ id: "failed-provider-valid-output" });
  try {
    await prepareAndAdmit(fixture);
    const input = fixture.current("candidate");
    const boundary = fixture.current("activeBoundary");
    context.diagnostic(JSON.stringify({ course: "B", targetId: fixture.contract.targetId, deliveryId: fixture.deliveryId,
      boundary: { id: boundary.recordId, revision: boundary.revision, digest: boundary.digest },
      candidate: { id: input.recordId, revision: input.revision, digest: input.digest },
      sequence: ["continue:provider-failure-valid-Product", "reopen-Store", "continue:correct", "integrate", "evaluate"],
      intendedOutcome: "Failed Provider Receipt retains useful C; next Attempt produces corrected source and acceptance-ready Evidence" }));
    const first = await fixture.continue({ providerExitCode: 1, providerOutcome: "provider-failure", edit: async (repo) => {
      await writeConnectedFile(repo, "src/demo.ts", "export const value = 'useful-failed-progress';\n");
    } });
    const receipt = fixture.store.getRevision(first.receipt.id, first.receipt.revision)!;
    assert.equal((receipt.payload.provider as ControlJsonObject).exitCode, 1);
    assert.equal((receipt.payload.providerEffect as ControlJsonObject).outcome, "failed");
    const workspace = receipt.payload.workspace as ControlJsonObject;
    assert.equal(workspace.availability, "available");
    assert.equal(workspace.parserDisposition, "not-run");
    assert.equal(workspace.compilerDisposition, "not-run");
    assert.equal(workspace.submissionDiagnostic, null, "No submission trigger is not invalid semantics");
    const submission = receipt.payload.workProduct as ControlJsonObject;
    assert.equal(submission.disposition, "abandoned");
    assert.equal(first.workProduct, null, "Provider failure cannot silently submit its semantic draft");
    assert.equal((receipt.payload.candidate as ControlJsonObject).successorDisposition, "promoted");
    const useful = fixture.current("candidate");
    assert.equal(useful.revision, input.revision + 1);
    assert.deepEqual(useful.relationships.find(({ relation }) => relation === "revises")?.target,
      { kind: "candidate-revision", id: input.recordId, revision: input.revision, digest: input.digest });
    assert.equal(fixture.store.state().subjects.materialCondition, null);
    await fixture.reopenStore();
    const second = await fixture.continue({ edit: async (repo) => {
      assert.equal(await readFile(join(repo, "src/demo.ts"), "utf8"), "export const value = 'useful-failed-progress';\n");
      await writeConnectedFile(repo, "src/demo.ts", "export const value = 'corrected';\n");
    } });
    assert.equal(second.outcome, "completed");
    assert(second.workProduct !== null);
    const correctedReceipt = fixture.store.getRevision(second.receipt.id, second.receipt.revision)!;
    assert.equal((correctedReceipt.payload.workspace as ControlJsonObject).compilerDisposition, "retained");
    assert.equal(((correctedReceipt.payload.workProduct as ControlJsonObject).reference as ControlJsonObject).digest, second.workProduct.digest);
    assert.notEqual(second.attempt.digest, first.attempt.digest);
    const secondAttempt = fixture.store.getRevision(second.attempt.id, second.attempt.revision)!;
    assert.deepEqual(secondAttempt.relationships.find(({ relation }) => relation === "uses-candidate")?.target,
      { kind: "candidate-revision", id: useful.recordId, revision: useful.revision, digest: useful.digest });
    assert.equal(fixture.current("candidate").revision, useful.revision + 1);
    await integrateAndEvaluate(fixture);
    assert.equal(await readConnectedCandidateFile(fixture, "src/demo.ts"), "export const value = 'corrected';\n");
    assert.equal(fixture.invocations.length, 4);
  } finally { await fixture.dispose(); }
});
