import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { openDeliveryControlRecordStore } from "../../src/foundation/control/delivery-custody.js";
import type { ControlJsonObject } from "../../src/foundation/control/types.js";
import { git } from "../../src/foundation/repository/git.js";
import { createConnectedDeliveryFixture, writeConnectedFile, type ConnectedDeliveryFixture } from "../support/connected-delivery-fixture.js";
import { startConnectedChild, type ConnectedChild } from "../support/connected-process.js";
import type { ConnectedRecoveryDescriptor, ConnectedRecoveryInvocation } from "../support/connected-recovery-worker.js";

const WORKER = new URL("../support/connected-recovery-worker.js", import.meta.url);
const CASES = [
  { id: "accept-unobserved", operation: "accept", checkpoint: "canonical-effect-applied" },
  { id: "accept-closure", operation: "accept", checkpoint: "closure-recorded" },
  { id: "accept-seal", operation: "accept", checkpoint: "store-sealed" },
  { id: "accept-not-applied", operation: "accept", checkpoint: "canonical-effect-ready" },
  { id: "no-ship-observed", operation: "no-ship", checkpoint: "transaction-effect-observed" },
  { id: "no-ship-closure", operation: "no-ship", checkpoint: "closure-recorded" },
  { id: "no-ship-seal", operation: "no-ship", checkpoint: "store-sealed" },
] as const;

async function evaluateReady(fixture: ConnectedDeliveryFixture): Promise<void> {
  const evaluated = await fixture.evaluate();
  assert.equal(evaluated.outcome, "completed", JSON.stringify(evaluated));
  const evidence = fixture.store.state().subjects.evidence;
  assert(evidence !== null, JSON.stringify(evaluated));
  const packet = fixture.store.getRevision(evidence.id, evidence.revision)!;
  assert.equal(packet.payload.readiness, "acceptance-ready", JSON.stringify(packet.payload));
}

type TerminalTrace = Readonly<{
  decisionCount: number;
  intentCount: number;
  closureCount: number;
  finalEvent: string;
  completedAfterClosure: boolean;
  archived: boolean;
  sealed: boolean;
  supportRemoved: boolean;
  canonicalCommit: string | null;
  canonicalParent: string | null;
  treatment: unknown;
  containment: unknown;
  retirement: unknown;
}>;

function assertTerminalTrace(trace: TerminalTrace, expected: Readonly<{
  commit: string | null;
  parent: string | null;
  treatment: "integrated" | "abandoned";
}>): void {
  assert.equal(trace.decisionCount, 1, "same authenticated Decision");
  assert.equal(trace.intentCount, 1, "same terminal effect intent");
  assert.equal(trace.closureCount, 1, "one Closure");
  assert.equal(trace.finalEvent, "closure-recorded", "Closure is final Journal event");
  assert.equal(trace.completedAfterClosure, false);
  assert.equal(trace.archived, true);
  assert.equal(trace.sealed, true);
  assert.equal(trace.supportRemoved, true);
  assert.equal(trace.canonicalCommit, expected.commit);
  assert.equal(trace.canonicalParent, expected.parent);
  assert.equal(trace.treatment, expected.treatment);
  assert.equal(trace.containment, "complete");
  assert.equal(trace.retirement, "complete");
}

for (const scenario of CASES) {
  test(`connected G ${scenario.id}: cold recovery reaches exact Closure and disposition`, async (context) => {
    const fixture = await createConnectedDeliveryFixture({ id: `restart-g-${scenario.id}` });
    const children: ConnectedChild[] = [];
    try {
      const prepared = await fixture.prepare();
      assert.equal(prepared.outcome, "completed", JSON.stringify(prepared));
      assert.notEqual(fixture.store.state().subjects.proposedBoundary, null);
      await fixture.admit();
      await fixture.continue({ edit: (repository) => writeConnectedFile(repository, "src/demo.ts", "export const value = 'terminal';\n") });
      if (scenario.operation === "accept") {
        assert.equal((await fixture.integrate()).outcome, "constructed");
        await evaluateReady(fixture);
        assert.equal(fixture.store.state().eligibleOperations.includes("delivery.accept"), true);
      }
      const starting = fixture.store.state().subjects;
      const startingCandidate = fixture.current("candidate");
      const startingState = startingCandidate.payload.state as ControlJsonObject;
      const parent = (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim();
      context.diagnostic(JSON.stringify({ course: "G", case: scenario.id, starting,
        operation: `delivery.${scenario.operation}`, canonicalParent: parent,
        sequence: ["prepare", "admit", "continue", ...(scenario.operation === "accept" ? ["integrate", "evaluate"] : []),
          scenario.operation, "SIGKILL", "cold recover", "complete lawful course", "archive"],
        fault: `SIGKILL at ${scenario.checkpoint}` }));
      const descriptor: ConnectedRecoveryDescriptor = {
        workspace: fixture.workspace,
        target: fixture.target,
        machineHome: fixture.machineHome,
        authorityHome: fixture.authorityHome,
        targetId: fixture.contract.targetId,
        deliveryId: fixture.deliveryId,
        configuration: fixture.configuration,
        backendPath: join(fixture.workspace, "unused-external-engine.json"),
        activityId: "terminal-from-retained-state",
      };
      const descriptorPath = join(fixture.workspace, "restart.json");
      await writeFile(descriptorPath, JSON.stringify(descriptor), { mode: 0o600 });
      fixture.store.close();
      const launch = (invocation: ConnectedRecoveryInvocation): ConnectedChild => {
        const child = startConnectedChild({ worker: WORKER, arguments: [descriptorPath, JSON.stringify(invocation)] });
        children.push(child);
        return child;
      };
      const original = launch({ operation: scenario.operation,
        ...(scenario.id === "accept-not-applied" ? {
          terminalCheckpoints: ["canonical-effect-ready", "transaction-effect-observed"],
        } : { terminalCheckpoint: scenario.checkpoint }) });
      const checkpoint = await original.next();
      assert.equal(checkpoint.kind, "checkpoint", JSON.stringify(checkpoint.value));
      assert.equal((checkpoint.value as { boundary: string }).boundary, scenario.checkpoint);
      if (scenario.id === "accept-not-applied") {
        await writeConnectedFile(fixture.target, "race.txt", "A competing canonical publication wins the exact Git CAS.\n");
        await git(fixture.target, ["add", "--", "race.txt"]);
        await git(fixture.target, ["commit", "-m", "Win canonical publication immediately before acceptance CAS"]);
        original.resume();
        const observed = await original.next();
        assert.equal(observed.kind, "checkpoint", JSON.stringify(observed.value));
        assert.equal((observed.value as { boundary: string }).boundary, "transaction-effect-observed");
      }
      assert.deepEqual(await original.kill(), { code: null, signal: "SIGKILL" });
      const selectedCommit = (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim();
      if (scenario.operation === "accept") assert.notEqual(selectedCommit, parent);
      else assert.equal(selectedCommit, parent);
      const interrupted = await openDeliveryControlRecordStore(descriptor);
      const { activity, terminalEventsBefore, decision, closureBefore } = (() => {
        try {
          const activity = interrupted.store.state().activities.find(({ operation }) => operation === `delivery.${scenario.operation}`);
          assert(activity !== undefined);
          const terminalEventsBefore = interrupted.store.listEvents(0, 10_000);
          const decision = terminalEventsBefore.find(({ eventKind, payload }) => eventKind === "director-decision-authenticated" && payload.activityId === activity.id)!.subject;
          const closureBefore = terminalEventsBefore.find(({ eventKind }) => eventKind === "closure-recorded");
          return { activity, terminalEventsBefore, decision, closureBefore };
        } finally {
          interrupted.store.close();
        }
      })();

      if (scenario.id === "accept-not-applied") {
        const cold = launch({ operation: "recover-terminal" });
        const settled = await cold.next();
        assert.equal(settled.kind, "result", JSON.stringify(settled.value));
        const failed = (settled.value as { result: { status: string; transactionOutcome: string; closure: unknown } }).result;
        assert.equal(failed.status, "failed");
        assert.equal(failed.transactionOutcome, "not-applied");
        assert.equal(failed.closure, null);
        assert.deepEqual(await cold.finish(), { code: 0, signal: null });
        assert.equal((await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim(), selectedCommit);
        assert.equal(await readFile(join(fixture.target, "src/demo.ts"), "utf8"), "export const value = 'base';\n");
        await fixture.reopenStore();
        assert.equal(fixture.store.state().subjects.closure, null);
        assert.equal(fixture.store.getOperationSupport(activity.id), null);
        assert.deepEqual(fixture.store.state().subjects.activeBoundary, starting.activeBoundary);
        assert.deepEqual(fixture.store.state().subjects.candidate, starting.candidate);
        assert.equal((await fixture.integrate()).outcome, "constructed");
        await evaluateReady(fixture);
        const renewed = fixture.store.state().subjects;
        assert.notEqual(renewed.candidate?.digest, starting.candidate?.digest);
        assert.notEqual(renewed.evidence?.digest, starting.evidence?.digest);
        assert.deepEqual(renewed.activeBoundary, starting.activeBoundary);
        fixture.store.close();
        const accepted = launch({ operation: "accept" });
        const finished = await accepted.next();
        assert.equal(finished.kind, "result", JSON.stringify(finished.value));
        const result = (finished.value as { result: { status: string; transactionOutcome: string; canonicalCommit: string } }).result;
        assert.equal(result.status, "completed");
        assert.equal(result.transactionOutcome, "applied");
        assert.deepEqual(await accepted.finish(), { code: 0, signal: null });
        const archived = await openDeliveryControlRecordStore(descriptor);
        try {
          assert.equal(archived.disposition, "archived");
          const events = archived.store.listEvents(0, 10_000);
          const old = events.filter(({ payload }) => payload.activityId === activity.id);
          assert.equal(old.filter(({ eventKind }) => eventKind === "director-decision-authenticated").length, 1);
          assert.equal(old.filter(({ eventKind }) => eventKind === "transaction-effect-intended").length, 1);
          assert.equal(old.filter(({ eventKind }) => eventKind === "transaction-effect-observed").length, 1);
          assert.equal(events.filter(({ eventKind }) => eventKind === "director-decision-authenticated").length, 3,
            "one admission, one failed acceptance, and one new exact acceptance");
          assert.equal(events.at(-1)!.eventKind, "closure-recorded");
          assert.equal(events.filter(({ eventKind }) => eventKind === "closure-recorded").length, 1);
          const closureRef = archived.store.state().subjects.closure!;
          const closure = archived.store.getRevision(closureRef.id, closureRef.revision)!;
          const canonical = closure.payload.canonicalResult as ControlJsonObject;
          assert.equal(canonical.parentCommit, selectedCommit);
          assert.equal(canonical.commit, result.canonicalCommit);
          assert.equal((await git(fixture.target, ["rev-parse", "HEAD^1"])).stdout.trim(), selectedCommit);
          assert.equal(await readFile(join(fixture.target, "src/demo.ts"), "utf8"), "export const value = 'terminal';\n");
          assert.equal(await readFile(join(fixture.target, "race.txt"), "utf8"), "A competing canonical publication wins the exact Git CAS.\n");
          assert(archived.store.getSeal() !== null);
          context.diagnostic(JSON.stringify({ course: "G", case: scenario.id, starting,
            fault: "SIGKILL after conclusive not-applied observation", recoveredPids: children.map(({ pid }) => pid),
            outcome: "failed old Activity, new integration and Evidence, new acceptance, exact Closure and archive" }));
        } finally { archived.store.close(); }
        return;
      }

      if (scenario.id === "accept-unobserved") {
        assert.equal(terminalEventsBefore.some(({ eventKind, payload }) => eventKind === "transaction-effect-observed" && payload.activityId === activity.id), false);
        // The actual ref update occurred. Temporarily remove its canonical
        // ancestry, retaining the exact commit object, then cold-observe it.
        await git(fixture.target, ["reset", "--hard", parent]);
        assert.equal((await git(fixture.target, ["cat-file", "-e", selectedCommit])).exitCode, 0);
        const uncertain = launch({ operation: "recover-terminal" });
        const observation = await uncertain.next();
        assert.equal(observation.kind, "result", JSON.stringify(observation.value));
        const result = (observation.value as { result: { status: string; transactionOutcome: string; closure: unknown } }).result;
        assert.equal(result.status, "recovery-required");
        assert.equal(result.transactionOutcome, "indeterminate");
        assert.equal(result.closure, null);
        assert.deepEqual(await uncertain.finish(), { code: 0, signal: null });
        const pending = await openDeliveryControlRecordStore(descriptor);
        try {
          assert.equal(pending.store.state().subjects.closure, null);
          assert.deepEqual(pending.store.listEvents(0, 10_000).find(({ eventKind, payload }) => eventKind === "director-decision-authenticated" && payload.activityId === activity.id)!.subject, decision);
        } finally {
          pending.store.close();
        }
        assert.equal((await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim(), parent);
        // Restore the previously applied exact K, not a replacement decision
        // or speculative nonapplication fact. A later commit then confirms K
        // as an ancestor to the independent canonical observation owner.
        await git(fixture.target, ["reset", "--hard", selectedCommit]);
      }

      await writeConnectedFile(fixture.target, "later.txt", "An independent canonical publication after the terminal boundary.\n");
      await git(fixture.target, ["add", "--", "later.txt"]);
      await git(fixture.target, ["commit", "-m", "Move canonical independently before cold terminal recovery"]);
      const tip = (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim();
      const replacement = launch({ operation: "recover-terminal" });
      assert.notEqual(replacement.pid, original.pid);
      const completion = await replacement.next();
      assert.equal(completion.kind, "result", JSON.stringify(completion.value));
      const result = (completion.value as { result: { status: string; transactionOutcome: string; canonicalCommit: string | null } }).result;
      assert.equal(result.status, "completed");
      assert.equal(result.transactionOutcome, "applied");
      assert.equal(result.canonicalCommit, scenario.operation === "accept" ? selectedCommit : null);
      assert.deepEqual(await replacement.finish(), { code: 0, signal: null });
      const archived = await openDeliveryControlRecordStore(descriptor);
      try {
        const events = archived.store.listEvents(0, 10_000);
        const closureEvent = events.find(({ eventKind }) => eventKind === "closure-recorded")!;
        assert(closureEvent.subject !== null);
        const closure = archived.store.getRevision(closureEvent.subject.recordId, closureEvent.subject.revision)!;
        const canonical = closure.payload.canonicalResult as ControlJsonObject | null;
        const candidateEdge = closure.relationships.find(({ relation }) => relation ===
          (scenario.operation === "accept" ? "accepts-candidate" : "abandons-candidate"));
        assert.deepEqual(candidateEdge?.target, {
          kind: "candidate-revision", id: startingCandidate.recordId, revision: startingCandidate.revision, digest: startingCandidate.digest,
        });
        if (scenario.operation === "accept") {
          assert.equal(canonical?.tree, startingState.tree);
          assert.equal(canonical?.candidateDigest, startingState.candidateDigest);
          assert.equal(canonical?.productStateDigest, startingState.productStateDigest);
          assert.equal(canonical?.knowledgeSetDigest, startingState.knowledgeSetDigest);
          assert.equal((await git(fixture.target, ["rev-parse", `${selectedCommit}^{tree}`])).stdout.trim(), startingState.tree);
          assert.equal((await git(fixture.target, ["rev-parse", `${selectedCommit}^1`])).stdout.trim(), parent);
          const evidenceEdge = closure.relationships.find(({ relation }) => relation === "accepts-evidence");
          assert.deepEqual(evidenceEdge?.target, {
            kind: "evidence-packet", id: starting.evidence!.id, revision: starting.evidence!.revision, digest: starting.evidence!.digest,
          });
        } else assert.equal(closure.payload.nonIntegrationVerified, true);
        const executions = closure.payload.terminalExecutions as ControlJsonObject;
        const activityEvents = events.filter(({ payload }) => payload.activityId === activity.id);
        const trace: TerminalTrace = {
          decisionCount: activityEvents.filter(({ eventKind }) => eventKind === "director-decision-authenticated").length,
          intentCount: activityEvents.filter(({ eventKind }) => eventKind === "transaction-effect-intended").length,
          closureCount: events.filter(({ eventKind }) => eventKind === "closure-recorded").length,
          finalEvent: events.at(-1)!.eventKind,
          completedAfterClosure: events.some(({ eventKind, sequence }) => eventKind === "activity-completed" && sequence > closureEvent.sequence),
          archived: archived.disposition === "archived",
          sealed: archived.store.getSeal() !== null,
          supportRemoved: archived.store.getOperationSupport(activity.id) === null,
          canonicalCommit: canonical?.commit as string | undefined ?? null,
          canonicalParent: canonical?.parentCommit as string | undefined ?? null,
          treatment: closure.payload.candidateTreatment,
          containment: (executions.containment as ControlJsonObject).classification,
          retirement: (executions.retirement as ControlJsonObject).classification,
        };
        const expected = { commit: scenario.operation === "accept" ? selectedCommit : null,
          parent: scenario.operation === "accept" ? parent : null,
          treatment: scenario.operation === "accept" ? "integrated" as const : "abandoned" as const };
        assertTerminalTrace(trace, expected);
        assert.deepEqual(activityEvents.find(({ eventKind }) => eventKind === "director-decision-authenticated")!.subject, decision);
        if (closureBefore !== undefined) assert.deepEqual(closureEvent, closureBefore, "post-Closure recovery cannot append or alter Journal history");
        if (scenario.id === "accept-unobserved") {
          const applied = activityEvents.filter(({ eventKind }) => eventKind === "transaction-effect-observed").at(-1)!;
          const facts = applied.payload.facts as ControlJsonObject;
          assert.equal(facts.commit, selectedCommit);
          assert.equal(facts.recognition, "ancestor");
          assert.equal((facts.observedTip as ControlJsonObject).commit, tip);
        }
        assert.equal((await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim(), tip, "recovery observes without another ref update");
        assert.equal(await readFile(join(fixture.target, "src/demo.ts"), "utf8"), scenario.operation === "accept"
          ? "export const value = 'terminal';\n" : "export const value = 'base';\n");
        const mutants: readonly Readonly<{ name: string; trace: TerminalTrace }>[] = [
          { name: "duplicate authorization", trace: { ...trace, decisionCount: 2 } },
          { name: "repeat terminal effect", trace: { ...trace, intentCount: 2 } },
          { name: "event after Closure", trace: { ...trace, finalEvent: "activity-completed", completedAfterClosure: true } },
          { name: "missing archive", trace: { ...trace, archived: false } },
          { name: "substituted accepted commit", trace: { ...trace, canonicalCommit: "another-commit" } },
          { name: "substituted parent", trace: { ...trace, canonicalParent: "another-parent" } },
          { name: "missing Retirement", trace: { ...trace, retirement: "unknown" } },
        ];
        for (const mutant of mutants) assert.throws(() => assertTerminalTrace(mutant.trace, expected), assert.AssertionError, mutant.name);
        context.diagnostic(JSON.stringify({ course: "G", case: scenario.id, starting, fault: `SIGKILL at ${scenario.checkpoint}`,
          recoveredPids: children.map(({ pid }) => pid), outcome: "exact applied Closure and archived Store",
          indeterminateThenConfirmed: scenario.id === "accept-unobserved", oracleMutations: mutants.map(({ name }) => name) }));
      } finally { archived.store.close(); }
    } finally {
      for (const child of children) await child.kill();
      await fixture.dispose();
    }
  });
}
