import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { importCandidateRevisionCarrierIntoRepository } from "../../src/foundation/candidate/carrier-import.js";
import { openDeliveryControlRecordStore } from "../../src/foundation/control/delivery-custody.js";
import type { ControlJsonObject } from "../../src/foundation/control/types.js";
import { inspectFoundationAgentActivityV7 } from "../../src/foundation/process/agent-operation-v7.js";
import { git } from "../../src/foundation/repository/git.js";
import type { Sha256 } from "../../src/foundation/validation/canonical.js";
import { createConnectedDeliveryFixture } from "../support/connected-delivery-fixture.js";
import { startConnectedChild, type ConnectedChild } from "../support/connected-process.js";
import type { ConnectedRecoveryDescriptor, ConnectedRecoveryInvocation } from "../support/connected-recovery-worker.js";
import { readConnectedBackendState } from "../support/disk-execution-backend.js";

const WORKER = new URL("../support/connected-recovery-worker.js", import.meta.url);

type ExecutionTrace = Readonly<{
  dispatches: number;
  starts: number;
  allocatedHandles: readonly string[];
  observedHandles: readonly string[];
  specificationDigests: readonly string[];
  attemptCount: number;
  intentCount: number;
  receiptCount: number;
  containment: unknown;
  retirement: unknown;
  supportRemoved: boolean;
  product: string;
}>;

function assertExecutionTrace(trace: ExecutionTrace): void {
  assert.equal(trace.dispatches, 1, "one external dispatch call");
  assert.equal(trace.starts, 1, "one productive start");
  assert.equal(trace.allocatedHandles.length, 1, "one retained allocation");
  assert(trace.observedHandles.length > 0, "recovery observes retained execution");
  assert(trace.observedHandles.every((handle) => handle === trace.allocatedHandles[0]), "same Handle across recovery");
  assert.equal(new Set(trace.specificationDigests).size, 1, "same Execution Specification");
  assert.equal(trace.attemptCount, 1, "one Attempt");
  assert.equal(trace.intentCount, 1, "one provider intent");
  assert.equal(trace.receiptCount, 1, "one Receipt");
  assert.equal(trace.containment, "contained");
  assert.equal(trace.retirement, "retired");
  assert.equal(trace.supportRemoved, true);
  assert.equal(trace.product, "export const value = 'recovered';\n");
}

const CASES = [
  { id: "dispatch-original", checkpoint: "dispatch", changedDefaults: false, custody: undefined },
  { id: "dispatch-defaults", checkpoint: "dispatch", changedDefaults: true, custody: undefined },
  { id: "dispatch-custody", checkpoint: "dispatch", changedDefaults: true, custody: "unavailable" },
  { id: "retrieval-custody", checkpoint: "retrieve", changedDefaults: true, custody: "substituted" },
] as const;

for (const scenario of CASES) {
  test(`connected E ${scenario.id}: cold restart completes the original execution`, async (context) => {
    const fixture = await createConnectedDeliveryFixture({ id: `restart-e-${scenario.id}` });
    const children: ConnectedChild[] = [];
    try {
      const prepared = await fixture.prepare();
      assert.equal(prepared.outcome, "completed", JSON.stringify(prepared));
      assert.notEqual(fixture.store.state().subjects.proposedBoundary, null);
      await fixture.admit();
      const starting = fixture.store.state().subjects;
      const canonicalBefore = (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim();
      context.diagnostic(JSON.stringify({ course: "E", case: scenario.id, starting,
        operation: "delivery.continue", canonicalParent: canonicalBefore,
        sequence: ["prepare", "admit", "continue", "SIGKILL", "cold recover", "restore custody if selected", "complete"],
        fault: `SIGKILL after ${scenario.checkpoint}`, changedDefaults: scenario.changedDefaults,
        custody: scenario.custody ?? "available" }));
      const descriptor: ConnectedRecoveryDescriptor = {
        workspace: fixture.workspace,
        target: fixture.target,
        machineHome: fixture.machineHome,
        authorityHome: fixture.authorityHome,
        targetId: fixture.contract.targetId,
        deliveryId: fixture.deliveryId,
        configuration: fixture.configuration,
        backendPath: join(fixture.workspace, "external-engine.json"),
        activityId: `restart-${scenario.id}`,
      };
      const descriptorPath = join(fixture.workspace, "restart.json");
      await writeFile(descriptorPath, JSON.stringify(descriptor), { mode: 0o600 });
      fixture.store.close();
      const launch = (invocation: ConnectedRecoveryInvocation): ConnectedChild => {
        const child = startConnectedChild({ worker: WORKER, arguments: [descriptorPath, JSON.stringify(invocation)] });
        children.push(child);
        return child;
      };
      const original = launch({ operation: "continue", backendCheckpoint: scenario.checkpoint });
      const checkpoint = await original.next();
      assert.equal(checkpoint.kind, "checkpoint", JSON.stringify(checkpoint.value));
      assert.equal((checkpoint.value as { boundary: string }).boundary, `backend.${scenario.checkpoint}`);
      assert.deepEqual(await original.kill(), { code: null, signal: "SIGKILL" });

      const opened = await openDeliveryControlRecordStore(descriptor);
      let retained: ReturnType<typeof inspectFoundationAgentActivityV7>;
      try {
        retained = inspectFoundationAgentActivityV7(opened.store, descriptor.activityId, "delivery.continue");
        assert(retained.executionSelection !== null);
        assert(retained.execution !== null);
        assert.notEqual(retained.execution.dispatchAuthorityConsumedAt, null);
      } finally {
        opened.store.close();
      }
      const externalBefore = await readConnectedBackendState(descriptor.backendPath);
      assert.equal(externalBefore.engine.allocations.length, 1);

      if (scenario.custody !== undefined) {
        const unavailable = launch({ operation: "recover-agent", changedDefaults: scenario.changedDefaults, custody: scenario.custody });
        assert.notEqual(unavailable.pid, original.pid);
        const refusal = await unavailable.next();
        assert.equal(refusal.kind, "failure");
        assert.match((refusal.value as { message: string }).message, scenario.custody === "unavailable"
          ? /Exact retained execution custody is temporarily unavailable/u
          : /installed|selection|Cell/iu);
        assert.deepEqual(await unavailable.finish(), { code: 1, signal: null });
        const afterRefusal = await openDeliveryControlRecordStore(descriptor);
        try {
          const preserved = inspectFoundationAgentActivityV7(afterRefusal.store, descriptor.activityId, "delivery.continue");
          assert.deepEqual(preserved.executionSelection, retained.executionSelection);
          assert.deepEqual(preserved.execution, retained.execution);
        } finally {
          afterRefusal.store.close();
        }
        const refusedExternal = await readConnectedBackendState(descriptor.backendPath);
        assert.deepEqual(refusedExternal.calls, externalBefore.calls, "refused custody performs no Backend operation");
      }

      const replacement = launch({ operation: "recover-agent", changedDefaults: scenario.changedDefaults });
      assert.notEqual(replacement.pid, original.pid);
      const completion = await replacement.next();
      assert.equal(completion.kind, "result", JSON.stringify(completion.value));
      assert.deepEqual(await replacement.finish(), { code: 0, signal: null });
      const recovered = await openDeliveryControlRecordStore(descriptor);
      try {
        const events = recovered.store.listEvents(0, 10_000).filter(({ payload }) => payload.activityId === descriptor.activityId);
        const receiptEvent = events.find(({ eventKind }) => eventKind === "execution-receipt-recorded");
        assert(receiptEvent?.subject !== null && receiptEvent?.subject !== undefined);
        const receipt = recovered.store.getRevision(receiptEvent.subject.recordId, receiptEvent.subject.revision)!;
        const candidateRef = recovered.store.state().subjects.candidate;
        assert(candidateRef !== null);
        assert.notEqual(candidateRef.digest, starting.candidate!.digest);
        const candidate = recovered.store.getRevision(candidateRef.id, candidateRef.revision)!;
        const carrier = candidate.payload.carrierManifest as ControlJsonObject;
        const manifest = await recovered.store.readRetainedFile(carrier.digest as Sha256);
        assert(manifest !== null);
        const repository = join(fixture.workspace, "verified-output");
        await mkdir(repository);
        await git(repository, ["init", "-b", "read"]);
        const rootTree = (candidate.payload.state as ControlJsonObject).tree;
        await importCandidateRevisionCarrierIntoRepository({ machineHome: fixture.machineHome, repository, manifestBytes: manifest.bytes, expectedRootTree: String(rootTree) });
        const product = (await git(repository, ["show", `${String(rootTree)}:src/demo.ts`])).stdout;
        const external = await readConnectedBackendState(descriptor.backendPath);
        const exactExecution = externalBefore.engine.allocations[0]!.specification;
        const execution = receipt.payload.execution as ControlJsonObject;
        assert.deepEqual(execution.inputSet, exactExecution.inputSet);
        assert.deepEqual(execution.image, exactExecution.image);
        assert.equal((execution.output as ControlJsonObject).manifestDigest,
          externalBefore.engine.allocations[0]!.output!.manifest.digest);
        assert.equal((receipt.payload.provider as ControlJsonObject).model, fixture.configuration.model);
        const prepared = events.find(({ eventKind }) => eventKind === "agent-attempt-prepared")!;
        assert(prepared.subject !== null);
        const attempt = recovered.store.getRevision(prepared.subject.recordId, prepared.subject.revision)!;
        const investment = attempt.payload.investment as ControlJsonObject;
        assert.equal(investment.model, fixture.configuration.model);
        assert.equal(investment.reasoning, fixture.configuration.reasoning);
        assert.equal(recovered.store.state().activities.find(({ id }) => id === descriptor.activityId)!.stage, "completed");
        const trace: ExecutionTrace = {
          dispatches: external.calls.filter(({ method }) => method === "dispatch").length,
          starts: external.engine.allocations.reduce((sum, allocation) => sum + allocation.productiveStarts, 0),
          allocatedHandles: external.engine.allocations.map(({ handle }) => handle),
          observedHandles: external.calls.filter(({ method }) => method === "observe").map(({ handle }) => handle!),
          specificationDigests: [...external.engine.allocations.map(({ specification }) => specification.digest),
            String((receipt.payload.execution as ControlJsonObject).specificationDigest)],
          attemptCount: events.filter(({ eventKind }) => eventKind === "agent-attempt-prepared").length,
          intentCount: events.filter(({ eventKind }) => eventKind === "provider-effect-intended").length,
          receiptCount: events.filter(({ eventKind }) => eventKind === "execution-receipt-recorded").length,
          containment: (receipt.payload.containment as ControlJsonObject).classification,
          retirement: (receipt.payload.retirement as ControlJsonObject).classification,
          supportRemoved: recovered.store.getOperationSupport(descriptor.activityId) === null,
          product,
        };
        assertExecutionTrace(trace);
        assert.equal((await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim(), canonicalBefore);
        assert.equal(await readFile(join(fixture.target, "src/demo.ts"), "utf8"), "export const value = 'base';\n");
        assert.deepEqual(recovered.store.state().subjects.activeBoundary, starting.activeBoundary);
        const mutations: readonly Readonly<{ name: string; trace: ExecutionTrace }>[] = [
          { name: "redispatch", trace: { ...trace, dispatches: 2 } },
          { name: "duplicate start", trace: { ...trace, starts: 2 } },
          { name: "substituted Handle", trace: { ...trace, observedHandles: ["another-handle"] } },
          { name: "substituted Specification", trace: { ...trace, specificationDigests: [...trace.specificationDigests, "another-specification"] } },
          { name: "missing containment", trace: { ...trace, containment: "unknown" } },
          { name: "missing Retirement", trace: { ...trace, retirement: null } },
          { name: "lost useful Product", trace: { ...trace, product: "" } },
        ];
        for (const mutant of mutations) assert.throws(() => assertExecutionTrace(mutant.trace), assert.AssertionError, mutant.name);
        context.diagnostic(JSON.stringify({ course: "E", case: scenario.id, starting, operation: "delivery.continue",
          fault: `SIGKILL after ${scenario.checkpoint}`, changedDefaults: scenario.changedDefaults, recoveredPids: children.map(({ pid }) => pid),
          outcome: "same execution contained and retired; useful Candidate selected", oracleMutations: mutations.map(({ name }) => name) }));
      } finally { recovered.store.close(); }
    } finally {
      for (const child of children) await child.kill();
      await fixture.dispose();
    }
  });
}
