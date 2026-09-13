import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { prepareAndAdmit, integrateAndEvaluate } from "../support/connected-delivery-assertions.js";
import { git } from "../../src/foundation/repository/git.js";
import type { ControlJsonObject } from "../../src/foundation/control/types.js";
import { parseKnowledgeRecord } from "../../src/foundation/knowledge/records.js";
import { createConnectedDeliveryFixture, connectedPreparationMarkdown, writeConnectedFile } from "../support/connected-delivery-fixture.js";
import { readConnectedCandidateFiles } from "../support/connected-candidate-inspection.js";

function revise(text: string, fields: Record<string, unknown>): string {
  const original = text.split("---\n")[1]!;
  return text.replace(original, `${JSON.stringify({ ...JSON.parse(original), ...fields }, null, 2)}\n`);
}

test("A: exact Current and Draft bytes cross real Attempts before coherent promotion and evaluation", async (context) => {
  const fixture = await createConnectedDeliveryFixture({ id: "current-draft-promotion" });
  try {
    const knowledgeArtifacts = [
      "### Artifact: blueprint-predecessor", "- Path: records/blueprint/demo.md", "- Role: blueprint", "- Must change: true", "- Obligation: result",
      "Supersede the original Blueprint coherently when the successor becomes Current.",
      "### Artifact: blueprint-successor", "- Path: records/blueprint/demo-r2.md", "- Role: blueprint", "- Must change: true", "- Obligation: result",
      "Develop the Draft successor and promote it with exact predecessor provenance.",
    ].join("\n");
    await prepareAndAdmit(fixture, connectedPreparationMarkdown()
      .replace("### Check: source-check", `${knowledgeArtifacts}\n### Check: source-check`)
      .replace("- Evidence artifact: source\n", "- Evidence artifact: source\n- Evidence artifact: blueprint-predecessor\n- Evidence artifact: blueprint-successor\n"));
    const boundary = fixture.current("activeBoundary");
    const admittedCandidate = fixture.current("candidate");
    context.diagnostic(JSON.stringify({ course: "A", targetId: fixture.contract.targetId, deliveryId: fixture.deliveryId,
      boundary: { id: boundary.recordId, revision: boundary.revision, digest: boundary.digest },
      candidate: { id: admittedCandidate.recordId, revision: admittedCandidate.revision, digest: admittedCandidate.digest },
      sequence: ["continue:retain-draft", "reopen-Store", "continue:promote-successor", "integrate", "evaluate"],
      intendedOutcome: "Exact r1 Superseded and r2 Current Blueprint bytes, promoted source, acceptance-ready Evidence" }));
    const canonical = (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim();
    const original = await readFile(join(fixture.target, "records/blueprint/demo.md"), "utf8");
    const parse = (path: string, sourceText: string) => parseKnowledgeRecord({ path, mode: "100644", objectId: "a".repeat(40), bytes: Buffer.from(sourceText), contract: fixture.contract });
    const current = parse("records/blueprint/demo.md", original);
    assert.deepEqual((boundary.payload.knowledge as readonly ControlJsonObject[]).find(({ id }) => id === current.frontMatter.id),
      { id: current.frontMatter.id, revision: 1, sourceDigest: current.sourceDigest, semanticDigest: current.semanticDigest });
    const draft = revise(original, { revision: 2, status: "draft", supersedes: { id: current.frontMatter.id, revision: 1, sourceDigest: current.sourceDigest, semanticDigest: current.semanticDigest } });
    const first = await fixture.continue({ edit: async (repo) => {
      await writeConnectedFile(repo, "records/blueprint/demo-r2.md", draft);
      await writeConnectedFile(repo, "src/demo.ts", "export const value = 'draft-progress';\n");
    } });
    assert.equal(first.outcome, "completed");
    const retained = fixture.current("candidate");
    assert.equal(fixture.current("activeBoundary").digest, boundary.digest, "Retaining Draft output does not replace governing Knowledge");
    assert.deepEqual(retained.relationships.find(({ relation }) => relation === "revises")?.target,
      { kind: "candidate-revision", id: admittedCandidate.recordId, revision: admittedCandidate.revision, digest: admittedCandidate.digest });
    assert.deepEqual(retained.relationships.find(({ relation }) => relation === "governed-by")?.target,
      { kind: "work-boundary", id: boundary.recordId, revision: boundary.revision, digest: boundary.digest });
    assert.equal((await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim(), canonical);
    await fixture.reopenStore();
    assert.equal(fixture.current("candidate").digest, retained.digest);
    const superseded = revise(original, { status: "superseded" });
    const prior = parse("records/blueprint/demo.md", superseded);
    const promoted = revise(draft, { status: "current", supersedes: {
      id: prior.frontMatter.id, revision: 1, sourceDigest: prior.sourceDigest, semanticDigest: prior.semanticDigest } });
    const second = await fixture.continue({ edit: async (repo) => {
      assert.equal(await readFile(join(repo, "records/blueprint/demo.md"), "utf8"), original);
      assert.equal(await readFile(join(repo, "records/blueprint/demo-r2.md"), "utf8"), draft);
      assert.equal(await readFile(join(repo, "src/demo.ts"), "utf8"), "export const value = 'draft-progress';\n");
      await writeConnectedFile(repo, "records/blueprint/demo.md", superseded);
      await writeConnectedFile(repo, "records/blueprint/demo-r2.md", promoted);
      await writeConnectedFile(repo, "src/demo.ts", "export const value = 'promoted';\n");
    } });
    assert.equal(second.outcome, "completed");
    assert.equal(fixture.current("candidate").revision, retained.revision + 1);
    const secondAttempt = fixture.store.getRevision(second.attempt.id, second.attempt.revision)!;
    assert.deepEqual(secondAttempt.relationships.find(({ relation }) => relation === "uses-candidate")?.target,
      { kind: "candidate-revision", id: retained.recordId, revision: retained.revision, digest: retained.digest });
    assert.deepEqual(fixture.current("candidate").relationships.find(({ relation }) => relation === "revises")?.target,
      { kind: "candidate-revision", id: retained.recordId, revision: retained.revision, digest: retained.digest });
    assert.equal(fixture.current("activeBoundary").digest, boundary.digest);
    await integrateAndEvaluate(fixture);
    const final = await readConnectedCandidateFiles(fixture, ["records/blueprint/demo.md", "records/blueprint/demo-r2.md", "src/demo.ts"]);
    assert.equal(final.get("records/blueprint/demo.md"), superseded);
    assert.equal(final.get("records/blueprint/demo-r2.md"), promoted);
    assert.equal(final.get("src/demo.ts"), "export const value = 'promoted';\n");
    assert.equal((await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim(), canonical);
    assert.equal(fixture.invocations.length, 4);
  } finally { await fixture.dispose(); }
});
