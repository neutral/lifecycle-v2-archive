import assert from "node:assert/strict";
import { lstat, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { prepareAndAdmit, integrateAndEvaluate } from "../support/connected-delivery-assertions.js";
import { git } from "../../src/foundation/repository/git.js";
import { createConnectedDeliveryFixture, connectedPreparationMarkdown, writeConnectedFile } from "../support/connected-delivery-fixture.js";
import { readConnectedCandidateFiles } from "../support/connected-candidate-inspection.js";

test("C: an absent directory Artifact is created, corrected with exact conflicted P context, integrated and evaluated", async (context) => {
  const fixture = await createConnectedDeliveryFixture({ id: "conflict-correction-evaluation", configureTarget: async (target) => {
    // Preserve the exact Current tree Description while leaving its future
    // implementation directory absent from the admitted Git tree.
    await rename(join(target, "src/_source.desc.md"), join(target, "_source.desc.md"));
    await rm(join(target, "src"), { recursive: true, force: true });
  } });
  try {
    await assert.rejects(lstat(join(fixture.target, "src")), { code: "ENOENT" });
    await prepareAndAdmit(fixture, connectedPreparationMarkdown("execution-standard-v1", "src"));
    const boundary = fixture.current("activeBoundary");
    const admittedCandidate = fixture.current("candidate");
    context.diagnostic(JSON.stringify({ course: "C", targetId: fixture.contract.targetId, deliveryId: fixture.deliveryId,
      boundary: { id: boundary.recordId, revision: boundary.revision, digest: boundary.digest },
      candidate: { id: admittedCandidate.recordId, revision: admittedCandidate.revision, digest: admittedCandidate.digest },
      sequence: ["continue:create-absent-directory", "advance-canonical-P", "integrate:conflict", "reopen-Store", "continue:correct", "integrate", "evaluate"],
      intendedOutcome: "Absent directory Artifact is created and preserves exact P source and original local contribution; acceptance-ready Evidence" }));
    const base = (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim();
    const localText = "export const value = 'local-contribution';\n";
    const created = await fixture.continue({ edit: async (repo) => {
      await assert.rejects(lstat(join(repo, "src")), { code: "ENOENT" });
      await writeConnectedFile(repo, "src/demo.ts", localText);
    } });
    assert.equal(created.outcome, "completed");
    const source = fixture.current("candidate");
    const parentText = "export const value = 'canonical-contribution';\n";
    const preservedLocalText = localText;
    await writeConnectedFile(fixture.target, "src/demo.ts", parentText);
    await git(fixture.target, ["add", "."]); await git(fixture.target, ["commit", "-m", "Advance independent canonical contribution"]);
    const parent = (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim();
    const parentObject = (await git(fixture.target, ["rev-parse", `${parent}:src/demo.ts`])).stdout.trim();
    assert.notEqual(parent, base);
    const conflicted = await fixture.integrate();
    context.diagnostic(JSON.stringify({ course: "C", phase: "after-integration", outcome: conflicted.outcome, attemptedParent: parent,
      parentObject, boundary: { id: boundary.recordId, revision: boundary.revision, digest: boundary.digest },
      sourceCandidate: { id: source.recordId, revision: source.revision, digest: source.digest } }));
    assert.equal(conflicted.outcome, "conflicted");
    assert.equal(fixture.current("candidate").digest, source.digest);
    assert.equal(fixture.store.state().subjects.materialCondition, null);
    await fixture.reopenStore();
    const corrected = await fixture.continue({ edit: async (repo, input) => {
      assert.equal(await readFile(join(repo, "src/demo.ts"), "utf8"), localText);
      const brief = Buffer.from(input.inputEntries.get("role-brief.md")!).toString("utf8");
      assert.match(brief, /Read-only failed integration correction input/);
      const descriptors = [...input.inputEntries.values()].flatMap((bytes) => {
        try {
          const value = JSON.parse(Buffer.from(bytes).toString("utf8"));
          return value.schema === "lifecycle.integration-correction-input.v1" ? [value] : [];
        } catch { return []; }
      });
      assert.equal(descriptors.length, 1);
      const exact = descriptors[0]!;
      assert.equal(exact.workBoundary.digest, boundary.digest);
      assert.equal(exact.sourceCandidate.digest, source.digest);
      assert.equal(exact.currentCandidate.digest, source.digest);
      assert.equal(exact.parent.commit, parent);
      assert.equal(exact.completeConflictPaths, true);
      assert.deepEqual(exact.paths.map((entry: { path: string }) => entry.path), ["src/demo.ts"]);
      assert.deepEqual(exact.entries.map((entry: { path: string; objectId: string }) => ({ path: entry.path, objectId: entry.objectId })),
        [{ path: "src/demo.ts", objectId: parentObject }]);
      assert([...input.inputEntries.values()].some((bytes) => Buffer.from(bytes).toString("utf8") === parentText));
      await writeConnectedFile(repo, "src/demo.ts", parentText);
      await writeConnectedFile(repo, "src/local.ts", preservedLocalText);
    } });
    assert.equal(corrected.outcome, "completed");
    assert.equal(fixture.current("activeBoundary").digest, boundary.digest);
    await integrateAndEvaluate(fixture);
    const integrated = fixture.current("candidate");
    assert.equal(integrated.payload.candidateBaseCommit, parent);
    const final = await readConnectedCandidateFiles(fixture, ["src/demo.ts", "src/local.ts"]);
    assert.equal(final.get("src/demo.ts"), parentText);
    assert.equal(final.get("src/local.ts"), preservedLocalText);
    assert.equal((await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim(), parent);
    assert.equal(fixture.invocations.length, 4);
  } finally { await fixture.dispose(); }
});
