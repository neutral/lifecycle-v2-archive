import { receiveFoundationAuthorityCredential } from "../../src/foundation/repository/authority.js";
import assert from "node:assert/strict";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createFoundationContextSelection,
  createFoundationCodeSelection,
  createFoundationRuntimeOperationRequest,
  type FoundationRuntimeExportRequest,
  type FoundationRuntimeInboxRequest,
  type FoundationRuntimeInspectRequest,
  type FoundationRuntimeDiffRequest,
  type FoundationRuntimeStatusRequest,
  type FoundationRuntimeValidateRequest,
  type FoundationRuntimeWatchRequest,
} from "@neutral/lifecycle-protocol";
import {
  createDeliveryControlRecordStore,
  listDeliveryControlRecordStores,
  openDeliveryControlRecordStoreReadOnly,
} from "../../src/foundation/control/delivery-custody.js";
import { attachRepository } from "../../src/foundation/repository/contract.js";
import { git } from "../../src/foundation/repository/git.js";
import { initializeRepository } from "../../src/foundation/repository/initialize.js";
import { compileFoundationAgentInvestmentV7 } from
  "../../src/foundation/process/operation-context-v7.js";
import { createFoundationRuntimeReadSurface, observeFoundationRepositoryForRead } from "../../src/foundation/runtime-read.js";
import { FOUNDATION_GENERATED_PUBLICATION_DIGEST } from
  "../../src/foundation/validation/generated-schemas.js";
import { writeMinimalAtlas } from "../helpers/atlas-fixture.js";
import { createConnectedDeliveryFixture } from "../support/connected-delivery-fixture.js";

const OBSERVED_AT = "2026-08-29T09:00:00.000Z";

test("retained Context, Code and Source reads survive live work and later Candidate advancement", async () => {
  const fixture = await createConnectedDeliveryFixture({ id: "stable-artifact-inspection" });
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  let enter = () => {};
  const entered = new Promise<void>((resolve) => { enter = resolve; });
  const operation: { pending: ReturnType<typeof fixture.continue> | null } = { pending: null };
  try {
    assert.equal((await fixture.prepare()).outcome, "completed");
    const proposal = fixture.current("proposedBoundary");
    const proposedContext = createFoundationContextSelection({
      targetId: fixture.store.identity.targetId, storeId: fixture.store.identity.storeId, processId: fixture.deliveryId,
      origin: { sequence: fixture.store.state().journal.eventCount, digest: fixture.store.state().journal.headDigest! },
      boundary: { role: "proposed", reference: { kind: "work-boundary", id: proposal.recordId, revision: proposal.revision, digest: proposal.digest } },
    });
    await fixture.admit();
    assert.equal((await fixture.continue({ edit: async (repository) => {
      await writeFile(join(repository, "src/demo.ts"), "export const value = 'selected';\n");
    } })).outcome, "completed");
    const state = fixture.store.state();
    const boundary = fixture.current("activeBoundary");
    const candidate = fixture.current("candidate");
    const context = createFoundationContextSelection({
      targetId: fixture.store.identity.targetId, storeId: fixture.store.identity.storeId, processId: fixture.deliveryId,
      origin: { sequence: state.journal.eventCount, digest: state.journal.headDigest! },
      boundary: { role: "active", reference: { kind: "work-boundary", id: boundary.recordId, revision: boundary.revision, digest: boundary.digest } },
    });
    const code = createFoundationCodeSelection({ ...context, subject: "candidate", boundary: context.boundary.reference,
      candidate: { kind: "candidate-revision", id: candidate.recordId, revision: candidate.revision, digest: candidate.digest }, seal: null });
    const request = (input: FoundationRuntimeInspectRequest["input"]) => createFoundationRuntimeOperationRequest({
      target: fixture.target, deliveryId: fixture.deliveryId, operation: "delivery.inspect", input,
    }) as FoundationRuntimeInspectRequest;
    let observations = 0;
    const surface = createFoundationRuntimeReadSurface({ machineHome: fixture.machineHome, now: fixture.now,
      owners: { observeRepository: async (target, observedAt) => {
        if (++observations === 2) {
          operation.pending = fixture.continue({ edit: async (repository) => {
            enter(); await held;
            await writeFile(join(repository, "src/demo.ts"), "export const value = 'later';\n");
          } });
          await Promise.race([entered, operation.pending.then(() => { throw new Error("Builder returned before the held output"); })]);
        }
        return observeFoundationRepositoryForRead(target, observedAt);
      } },
    });
    const index = await surface.execute(request({ kind: "knowledge-index", context, afterCursor: null, limit: 1 }));
    assert.equal(index.status, "completed", JSON.stringify(index.diagnostics));
    assert(index.value !== null && "kind" in index.value && index.value.kind === "knowledge-index");
    assert(index.observation.delivery!.journal.eventCount > context.origin.sequence);
    assert.deepEqual(index.value.basis.selection, context);
    const historicalProposal = await surface.execute(request({ kind: "knowledge-index", context: proposedContext, afterCursor: null, limit: 1 }));
    assert(historicalProposal.value !== null && "kind" in historicalProposal.value && historicalProposal.value.kind === "knowledge-index");
    assert.equal(historicalProposal.value.basis.selection.boundary.role, "proposed", "admission does not rewrite the retained origin's Boundary role");
    const atlasRequest = request({ kind: "atlas-overview", context, afterMapCursor: null, mapLimit: 1,
      afterPointCursor: null, pointLimit: 1, afterResourceCursor: null, resourceLimit: 1 });
    const atlas = await surface.execute(atlasRequest);
    assert(atlas.value !== null && "kind" in atlas.value && atlas.value.kind === "atlas-overview");
    assert.deepEqual(atlas.value.basis.selection, context);
    const selectedRecord = index.value.records[0]!;
    const body = await surface.execute(request({ kind: "knowledge-record", context, reference: selectedRecord.reference }));
    assert(body.value !== null && "kind" in body.value && body.value.kind === "knowledge-record");
    const sourceRequest = request({ kind: "source", reference: body.value.body, startByte: 0, maximumBytes: 4 });
    const source = await surface.execute(sourceRequest);
    assert(source.value !== null && "kind" in source.value && source.value.kind === "source");
    const codeRequest = request({ kind: "code-index", selection: code, subject: "candidate", afterCursor: null, limit: 1 });
    const firstCode = await surface.execute(codeRequest);
    assert(firstCode.value !== null && "kind" in firstCode.value && firstCode.value.kind === "code-index" && firstCode.value.status === "available");
    assert.deepEqual(firstCode.value.basis.candidate, code.candidate);
    release();
    assert(operation.pending !== null);
    assert.equal((await operation.pending).outcome, "completed");
    operation.pending = null;
    assert.notEqual(fixture.current("candidate").digest, candidate.digest);
    await fixture.reopenStore();
    const restarted = createFoundationRuntimeReadSurface({ machineHome: fixture.machineHome, now: fixture.now });
    const oldCode = await restarted.execute(codeRequest);
    assert.deepEqual(oldCode.value, firstCode.value, "a later Candidate and fresh reader cannot replace the exact selected difference");
    const oldAtlas = await restarted.execute(atlasRequest);
    assert.deepEqual(oldAtlas.value, atlas.value, "historical Atlas identity remains exact across reader restart");
    const oldSource = await restarted.execute(sourceRequest);
    assert.deepEqual(oldSource.value, source.value, "source bytes retain their original selection and basis after restart");
    const forged = createFoundationCodeSelection({ ...code,
      origin: { sequence: fixture.store.state().journal.eventCount, digest: fixture.store.state().journal.headDigest! } });
    const refused = await restarted.execute(request({ kind: "code-index", selection: forged, subject: "candidate", afterCursor: null, limit: 1 }));
    assert.equal(refused.status, "refused");
    assert(refused.diagnostics.some(({ code }) => code === "lifecycle.read-model.inspection-selection"));
    assert.equal(refused.value, null, "rehashing an old Candidate with a newer origin is not valid provenance");
  } finally {
    release();
    if (operation.pending !== null) await operation.pending;
    await fixture.dispose();
  }
});

test("exact Control reads finish through pending work, refuse lost custody, and resume the same revision", async () => {
  const fixture = await createConnectedDeliveryFixture({ id: "stable-control-record" });
  let releaseOutput = () => {};
  const outputHeld = new Promise<void>((resolve) => { releaseOutput = resolve; });
  let enteredOutput = () => {};
  const outputEntered = new Promise<void>((resolve) => { enteredOutput = resolve; });
  const operation: { pending: ReturnType<typeof fixture.continue> | null } = { pending: null };
  let withheldRoot: string | null = null;
  try {
    assert.equal((await fixture.prepare()).outcome, "completed");
    await fixture.admit();
    const boundary = fixture.current("activeBoundary");
    const reference = { kind: "work-boundary" as const, id: boundary.recordId, revision: boundary.revision, digest: boundary.digest };
    const request = createFoundationRuntimeOperationRequest({
      target: fixture.target, deliveryId: fixture.deliveryId,
      operation: "delivery.inspect", input: { kind: "record", reference },
    }) as FoundationRuntimeInspectRequest;
    const before = fixture.store.state().journal;
    let observations = 0;
    const surface = createFoundationRuntimeReadSurface({
      machineHome: fixture.machineHome, now: fixture.now,
      owners: { observeRepository: async (target, observedAt) => {
        if (++observations === 2) {
          operation.pending = fixture.continue({ edit: async () => {
            enteredOutput();
            await outputHeld;
          } });
          await Promise.race([
            outputEntered,
            operation.pending.then(() => { throw new Error("Builder returned before its held Output boundary"); }),
          ]);
        }
        return observeFoundationRepositoryForRead(target, observedAt);
      } },
    });
    const read = await surface.execute(request);
    assert.equal(read.status, "completed", JSON.stringify(read.diagnostics));
    assert(read.value !== null && "kind" in read.value && read.value.kind === "record");
    assert.deepEqual(read.value.record, boundary, "the approved scope body remains exact while a real Builder is held");
    assert(read.observation.delivery !== null);
    assert(read.observation.delivery.journal.eventCount > before.eventCount, "the final observation must include actual Activity progress after selection");
    assert(read.observation.delivery.activities.some(({ operation, stage }) => operation === "delivery.continue" && stage !== "completed"));
    assert.equal(read.changes.control.advanced, false, "an observation is not an effect of the read");
    releaseOutput();
    assert(operation.pending !== null);
    assert.equal((await operation.pending).outcome, "completed", "the same pending Builder must finish without redispatch");
    operation.pending = null;
    assert.deepEqual(fixture.current("activeBoundary"), boundary);

    // Real custody loss after the first record read, followed by restoration.
    const storeRoot = fixture.store.paths.root;
    const temporaryRoot = join(fixture.workspace, "withheld-record-custody");
    observations = 0;
    const unavailable = createFoundationRuntimeReadSurface({
      machineHome: fixture.machineHome, now: fixture.now,
      owners: { observeRepository: async (target, observedAt) => {
        if (++observations === 2) {
          await rename(storeRoot, temporaryRoot);
          withheldRoot = temporaryRoot;
        }
        return observeFoundationRepositoryForRead(target, observedAt);
      } },
    });
    const refused = await unavailable.execute(request);
    assert.equal(refused.status, "refused");
    assert.equal(refused.value, null);
    await rename(temporaryRoot, storeRoot);
    withheldRoot = null;
    await fixture.reopenStore();
    const restored = await createFoundationRuntimeReadSurface({ machineHome: fixture.machineHome, now: fixture.now }).execute(request);
    assert.equal(restored.status, "completed", JSON.stringify(restored.diagnostics));
    assert(restored.value !== null && "kind" in restored.value && restored.value.kind === "record");
    assert.deepEqual(restored.value.record, boundary, "restored custody permits the original exact historical record read");

    // Deliberately substitute only the owning prefix read: this detects removal
    // of the prefix guard without manufacturing a second valid Journal.
    let openings = 0;
    const substituted = createFoundationRuntimeReadSurface({
      machineHome: fixture.machineHome, now: fixture.now,
      owners: { openDeliveryStore: async (selection) => {
        const opened = await openDeliveryControlRecordStoreReadOnly(selection);
        if (++openings === 2 && opened !== null) {
          const listEvents = opened.store.listEvents.bind(opened.store);
          const verifyIntegrity = opened.store.verifyIntegrity.bind(opened.store);
          opened.store.verifyIntegrity = async (...args) => {
            const result = await verifyIntegrity(...args);
            opened.store.listEvents = (after, limit) => listEvents(after, limit).map((event) => ({
              ...event, digest: `sha256:${"0".repeat(64)}` as typeof event.digest,
            }));
            return result;
          };
        }
        return opened;
      } },
    });
    const wrongPrefix = await substituted.execute(request);
    assert.equal(wrongPrefix.status, "refused");
    assert(wrongPrefix.diagnostics.some(({ code }) => code === "lifecycle.runtime-read.control-epoch-mixed"));
    assert.equal(wrongPrefix.value, null);
  } finally {
    releaseOutput();
    await operation.pending?.catch(() => undefined);
    if (withheldRoot !== null) await rename(withheldRoot, fixture.store.paths.root);
    await fixture.dispose();
  }
});

test("Delivery inspection preserves the exact governing objective while the next Attempt has no report", async () => {
  const fixture = await createConnectedDeliveryFixture({ id: "read-objective-continuity", agentBackend: "docker-observed" });
  try {
    assert.equal((await fixture.prepare()).outcome, "completed");
    await fixture.admit();
    const boundary = fixture.current("activeBoundary");
    const expectedObjective = "Make the source expose the requested value and preserve coherent Knowledge revisions.";
    const surface = createFoundationRuntimeReadSurface({ machineHome: fixture.machineHome, now: fixture.now });
    const inspect = async () => {
      const result = await surface.execute(createFoundationRuntimeOperationRequest({
        target: fixture.target, deliveryId: fixture.deliveryId, operation: "delivery.inspect", input: { kind: "delivery-view" },
      }) as FoundationRuntimeInspectRequest);
      assert.equal(result.status, "completed", JSON.stringify(result.diagnostics));
      if (result.value === null || !("kind" in result.value) || result.value.kind !== "delivery-view") throw new TypeError("Expected exact Delivery View");
      const view = result.value.view;
      assert.deepEqual(view.semantics.boundaryProposal?.reference, {
        kind: "work-boundary", id: boundary.recordId, revision: boundary.revision, digest: boundary.digest,
      });
      assert.equal(view.semantics.boundaryProposal?.objective, expectedObjective);
      return view;
    };
    const admitted = await inspect();
    assert.notEqual(admitted.semantics.outcome.summary, null);
    let observedInFlight = false;
    assert.equal((await fixture.continue({ edit: async () => {
      const running = await inspect();
      assert.notEqual(running.generation.digest, admitted.generation.digest);
      assert.equal(running.activity?.operation, "delivery.continue");
      assert.equal(running.state.activities.find(({ id }) => id === running.activity?.activityId)?.stage, "effect-intended");
      assert.equal(running.state.recovery?.kind, "provider");
      assert.equal(running.state.recovery?.resumesAt, "provider-effect-observed");
      assert.equal(running.activity?.stage, "recovery",
        "The public stage exposes the retained recovery obligation while the same invocation is still running; it is not live provider telemetry");
      assert.equal(running.semantics.outcome.summary, null, "the earlier Agent report does not become the active Attempt's report");
      observedInFlight = true;
    } })).outcome, "completed");
    assert.equal(observedInFlight, true);
    const completed = await inspect();
    assert.equal(completed.activity, null);
    assert.equal(completed.state.recovery, null);
    assert.equal(completed.semantics.outcome.summary, "The Candidate contains useful coherent progress.");
  } finally { await fixture.dispose(); }
});

test("Runtime read surface derives validation, status, inspection, export, and unchanged facts", async () => {
  const target = await mkdtemp(join(tmpdir(), "lifecycle-runtime-read-target-"));
  const machineHome = await mkdtemp(join(tmpdir(), "lifecycle-runtime-read-home-"));
  const deliveryId = "delivery-runtime-read";
  try {
    await git(target, ["init", "-b", "main"]);
    await git(target, ["config", "user.name", "Lifecycle Test"]);
    await git(target, ["config", "user.email", "lifecycle@example.invalid"]);
    await writeMinimalAtlas(target);
    await git(target, ["add", "--", "atlas"]);
    await git(target, ["commit", "-m", "Initialize target"]);
    const contract = await initializeRepository(target, {
      targetId: "target-runtime-read",
      directorPrincipal: "director-runtime-read",
      home: machineHome,
      authorityCredential: receiveFoundationAuthorityCredential("runtime-read-director-secret-at-least-thirty-two-bytes", "initialize"),
      publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
      implementationRoots: [],
      stage: true,
    });
    await git(target, ["commit", "-m", "Initialize Lifecycle"]);
    const attachment = await attachRepository(target);
    const created = await createDeliveryControlRecordStore({
      machineHome,
      targetId: contract.targetId,
      deliveryId,
      createdAt: "2026-08-29T08:59:00.000Z",
      runtimeActorId: "foundation-runtime",
    });
    created.store.close();

    const investmentConfiguration = Object.freeze({ model: "codex-preview-test", reasoning: "high" });
    const surface = createFoundationRuntimeReadSurface({
      machineHome,
      now: () => OBSERVED_AT,
      investment: investmentConfiguration,
    });
    const validationRequest = createFoundationRuntimeOperationRequest({
      target,
      operation: "repository.validate",
      input: null,
    }) as FoundationRuntimeValidateRequest;
    const validation = await surface.execute(validationRequest);
    assert.equal(validation.status, "completed");
    assert.equal(validation.observation.repository.initialized, true);
    assert.equal(validation.observation.repository.valid, true);
    assert.equal(validation.observation.repository.repositoryContract, "lifecycle.repository.v22");
    assert.equal(
      validation.observation.repository.repositoryContractDigest,
      contract.digest,
    );
    assert.equal(validation.observation.repository.headCommit, attachment.headCommit);
    assert.equal(validation.observation.delivery, null);
    assert.equal(validation.value, null);
    assert.deepEqual(validation.changes, {
      repository: {
        changed: false,
        beforeCommit: attachment.headCommit,
        afterCommit: attachment.headCommit,
      },
      candidate: { changed: false, before: null, after: null },
      control: { advanced: false, beforeHead: null, afterHead: null },
    });

    const statusRequest = createFoundationRuntimeOperationRequest({
      target,
      deliveryId,
      operation: "delivery.status",
      input: null,
    }) as FoundationRuntimeStatusRequest;
    const status = await surface.execute(statusRequest);
    assert.equal(status.status, "completed");
    assert.equal(status.value, null);
    assert.equal(status.observation.delivery?.storeId, created.identity.storeId);
    assert.equal(status.observation.delivery?.processId, deliveryId);
    assert.equal(status.observation.delivery?.journal.eventCount, 1);
    assert.equal(status.observation.delivery?.storeDisposition.stage, "active");
    assert.equal(status.observation.delivery?.storeDisposition.integrity, "verified");
    assert.equal(status.observation.delivery?.recovery, null);
    assert.equal(status.changes.control.advanced, false);
    assert.equal(status.changes.control.beforeHead?.sequence, 1);
    assert.deepEqual(status.changes.control.afterHead, status.changes.control.beforeHead);

    const inspectRequest = createFoundationRuntimeOperationRequest({
      target,
      deliveryId,
      operation: "delivery.inspect",
      input: { kind: "events", afterSequence: 0, limit: 10 },
    }) as FoundationRuntimeInspectRequest;
    const inspection = await surface.execute(inspectRequest);
    assert.equal(inspection.status, "completed");
    const inspectionValue = inspection.value;
    if (inspectionValue === null || !("kind" in inspectionValue) || inspectionValue.kind !== "events") {
      throw new TypeError("Expected event inspection");
    }
    assert.equal(inspectionValue.events.length, 1);
    assert.equal(inspectionValue.events[0]?.eventKind, "delivery-created");
    assert.deepEqual(inspection.changes.control.afterHead, inspection.changes.control.beforeHead);

    const attemptViewRequest = createFoundationRuntimeOperationRequest({
      target,
      deliveryId,
      operation: "delivery.inspect",
      input: { kind: "attempt-view", selection: { kind: "latest-attempt" } },
    }) as FoundationRuntimeInspectRequest;
    const attemptView = await surface.execute(attemptViewRequest);
    assert.equal(attemptView.status, "completed");
    if (
      attemptView.value === null || !("kind" in attemptView.value) ||
      attemptView.value.kind !== "attempt-view"
    ) {
      throw new TypeError("Expected derived Attempt View inspection");
    }
    assert.equal(attemptView.value.view, null);
    assert.deepEqual(attemptView.changes.control.afterHead, attemptView.changes.control.beforeHead);

    const inboxRequest = createFoundationRuntimeOperationRequest({
      target,
      operation: "delivery.inbox",
      input: { afterDeliveryId: null, limit: 10 },
    }) as FoundationRuntimeInboxRequest;
    const inbox = await surface.execute(inboxRequest);
    assert.equal(inbox.status, "completed");
    if (inbox.value === null || !("kind" in inbox.value) || inbox.value.kind !== "inbox") {
      throw new TypeError("Expected Delivery Inbox");
    }
    assert.equal(inbox.value.view.rows.length, 1);
    const inboxRow = inbox.value.view.rows[0];
    assert.equal(inboxRow?.status, "available");
    if (inboxRow?.status !== "available") throw new TypeError("Expected available Inbox row");
    assert.equal(inboxRow.deliveryId, deliveryId);
    assert.equal(inboxRow.standing, "framing");
    assert.equal(inboxRow.generation.journal.headSequence, 1);

    const deliveryViewRequest = createFoundationRuntimeOperationRequest({
      target,
      deliveryId,
      operation: "delivery.inspect",
      input: { kind: "delivery-view" },
    }) as FoundationRuntimeInspectRequest;
    const deliveryView = await surface.execute(deliveryViewRequest);
    assert.equal(deliveryView.status, "completed");
    if (
      deliveryView.value === null || !("kind" in deliveryView.value) ||
      deliveryView.value.kind !== "delivery-view"
    ) throw new TypeError("Expected coherent Delivery View");
    assert.equal(deliveryView.value.view.generation.digest, inboxRow.generation.digest);
    assert.equal(deliveryView.value.view.nextPass.length, 5);
    assert.deepEqual(deliveryView.value.view.controlFamilies.map(({ recordKind }) => recordKind), [
      "agent-attempt", "agent-work-product", "candidate-revision", "candidate-seal",
      "check-receipt", "closure", "director-brief", "director-decision", "evidence-packet",
      "execution-receipt", "integration-assessment", "material-condition", "work-boundary", "work-delegation",
    ]);
    const previewStore = await openDeliveryControlRecordStoreReadOnly({
      machineHome,
      targetId: contract.targetId,
      deliveryId,
    });
    assert(previewStore !== null);
    try {
      for (const requirement of deliveryView.value.view.nextPass) {
        if (requirement.operation === "delivery.integrate") {
          assert.equal(requirement.role, null);
          assert.equal(requirement.investment, null);
          assert.equal(requirement.eligible, false);
          assert.match(requirement.consequence, /canonical parent/u);
          continue;
        }
        const selected = compileFoundationAgentInvestmentV7({
          store: previewStore.store,
          activityId: `activity-preview-${requirement.operation.slice("delivery.".length)}`,
          operation: requirement.operation,
          configuration: investmentConfiguration,
        });
        assert.deepEqual(requirement.investment, {
          freshness: "fresh-on-invocation",
          model: selected.model,
          reasoning: selected.reasoning,
          wallTimeMs: selected.wallTimeMs,
          maximumOutputBytes: selected.limits.outputBytes,
        });
        assert.equal(requirement.investment.maximumOutputBytes,
          requirement.operation === "delivery.continue" ? 268_435_456 : 1_048_576);
      }
      assert.equal(previewStore.store.state().journal.eventCount, 1);
    } finally {
      previewStore.store.close();
    }

    const familyRequest = createFoundationRuntimeOperationRequest({
      target,
      deliveryId,
      operation: "delivery.inspect",
      input: { kind: "families" },
    }) as FoundationRuntimeInspectRequest;
    const families = await surface.execute(familyRequest);
    if (families.value === null || !("kind" in families.value) || families.value.kind !== "families") {
      throw new TypeError("Expected Control family index");
    }
    assert.equal(families.value.families.length, 14);
    assert.equal(families.value.generation.digest, deliveryView.value.view.generation.digest);

    assert.equal(deliveryView.value.view.state.subjects.activeBoundary, null);
    assert.equal(deliveryView.value.view.state.subjects.candidate, null);
    const codeIndex = await surface.execute(createFoundationRuntimeOperationRequest({
      target,
      deliveryId,
      operation: "delivery.inspect",
      input: {
        kind: "code-index",
        selection: createFoundationCodeSelection({
          targetId: deliveryView.targetId!, storeId: deliveryView.value.view.state.storeId, processId: deliveryId,
          origin: { sequence: deliveryView.value.view.state.journal.headSequence!, digest: deliveryView.value.view.state.journal.headDigest! },
          subject: "candidate", boundary: deliveryView.value.view.state.subjects.activeBoundary,
          candidate: deliveryView.value.view.state.subjects.candidate, seal: null,
        }),
        subject: "candidate",
        afterCursor: null,
        limit: 10,
      },
    }) as FoundationRuntimeInspectRequest);
    assert.equal(codeIndex.status, "completed");
    if (
      codeIndex.value === null || !("kind" in codeIndex.value) ||
      codeIndex.value.kind !== "code-index"
    ) throw new TypeError("Expected exact Code index inspection");
    assert.equal(codeIndex.value.status, "unavailable");
    if (codeIndex.value.status === "unavailable") {
      assert.equal(codeIndex.value.reason, "candidate-absent");
      assert.equal(codeIndex.value.selection.origin.digest, deliveryView.value.view.state.journal.headDigest);
    }

    const staleAuthorizationReview = await surface.execute(createFoundationRuntimeOperationRequest({
      target,
      deliveryId,
      operation: "delivery.inspect",
      input: {
        kind: "authorization-review",
        expectedGeneration: `sha256:${"f".repeat(64)}`,
        operation: "delivery.no-ship",
        input: {
          semanticMarkdown: "# No ship\n\nThis stale review must be refused.\n",
        },
      },
    }) as FoundationRuntimeInspectRequest);
    assert.equal(staleAuthorizationReview.status, "refused");
    assert.equal(
      staleAuthorizationReview.diagnostics.some(({ code }) =>
        code === "lifecycle.read-model.generation-stale"),
      true,
    );

    const diffRequest = createFoundationRuntimeOperationRequest({
      target,
      deliveryId,
      operation: "delivery.diff",
      input: { subject: "candidate", maximumBytes: 4_096 },
    }) as FoundationRuntimeDiffRequest;
    const diff = await surface.execute(diffRequest);
    assert.equal(diff.status, "completed");
    if (diff.value === null || !("kind" in diff.value) || diff.value.kind !== "diff") {
      throw new TypeError("Expected Candidate diff result");
    }
    assert.equal(diff.value.view.currentness, "unavailable");
    assert.match(diff.value.view.unavailableReason ?? "", /No exact current Candidate/u);

    const watchRequest = createFoundationRuntimeOperationRequest({
      target,
      deliveryId,
      operation: "delivery.watch",
      input: {
        scope: "delivery",
        afterGeneration: deliveryView.value.view.generation.digest,
        timeoutMs: 0,
      },
    }) as FoundationRuntimeWatchRequest;
    const watched = await surface.execute(watchRequest);
    assert.equal(watched.status, "completed");
    if (watched.value === null || !("kind" in watched.value) || watched.value.kind !== "watch") {
      throw new TypeError("Expected watch result");
    }
    assert.equal(watched.value.changed, false);
    assert.equal(watched.value.delivery?.generation.digest, deliveryView.value.view.generation.digest);

    const exportRequest = createFoundationRuntimeOperationRequest({
      target,
      deliveryId,
      operation: "delivery.export",
      input: { format: "markdown", selection: { kind: "delivery" } },
    }) as FoundationRuntimeExportRequest;
    const exported = await surface.execute(exportRequest);
    assert.equal(exported.status, "completed");
    if (exported.value === null || !("format" in exported.value)) {
      throw new TypeError("Expected Markdown export");
    }
    assert.equal(exported.value.format, "markdown");
    assert.match(exported.value.content, /Derived inspection representation/u);
    assert.equal(exported.changes.repository.changed, false);
    assert.equal(exported.changes.candidate.changed, false);
    assert.equal(exported.changes.control.advanced, false);

    const retained = await openDeliveryControlRecordStoreReadOnly({
      machineHome,
      targetId: contract.targetId,
      deliveryId,
    });
    assert(retained !== null);
    assert.equal((await retained.store.verifyIntegrity()).eventCount, 1);
    retained.store.close();

    const secondDeliveryId = "delivery-runtime-read-z";
    const secondCreated = await createDeliveryControlRecordStore({
      machineHome,
      targetId: contract.targetId,
      deliveryId: secondDeliveryId,
      createdAt: "2026-08-29T08:59:01.000Z",
      runtimeActorId: "foundation-runtime",
    });
    secondCreated.store.close();
    const inboxFirstPage = await surface.execute(createFoundationRuntimeOperationRequest({
      target,
      operation: "delivery.inbox",
      input: { afterDeliveryId: null, limit: 1 },
    }) as FoundationRuntimeInboxRequest);
    if (
      inboxFirstPage.value === null || !("kind" in inboxFirstPage.value) ||
      inboxFirstPage.value.kind !== "inbox"
    ) throw new TypeError("Expected first Inbox page");
    assert.equal(inboxFirstPage.value.view.rows.length, 1);
    assert.equal(inboxFirstPage.value.view.rows[0]?.deliveryId, deliveryId);
    assert.equal(inboxFirstPage.value.view.nextAfterDeliveryId, deliveryId);
    const inboxSecondPage = await surface.execute(createFoundationRuntimeOperationRequest({
      target,
      operation: "delivery.inbox",
      input: { afterDeliveryId: deliveryId, limit: 1 },
    }) as FoundationRuntimeInboxRequest);
    if (
      inboxSecondPage.value === null || !("kind" in inboxSecondPage.value) ||
      inboxSecondPage.value.kind !== "inbox"
    ) throw new TypeError("Expected second Inbox page");
    assert.equal(inboxSecondPage.value.view.rows[0]?.deliveryId, secondDeliveryId);
    assert.equal(inboxSecondPage.value.view.nextAfterDeliveryId, null);

    const tailDeliveryId = "delivery-runtime-read-zz";
    const tailCreated = await createDeliveryControlRecordStore({
      machineHome,
      targetId: contract.targetId,
      deliveryId: tailDeliveryId,
      createdAt: "2026-08-29T08:59:02.000Z",
      runtimeActorId: "foundation-runtime",
    });
    tailCreated.store.close();
    const inboxAfterTail = await surface.execute(createFoundationRuntimeOperationRequest({
      target,
      operation: "delivery.inbox",
      input: { afterDeliveryId: null, limit: 1 },
    }) as FoundationRuntimeInboxRequest);
    if (
      inboxAfterTail.value === null || !("kind" in inboxAfterTail.value) ||
      inboxAfterTail.value.kind !== "inbox"
    ) throw new TypeError("Expected Inbox page after tail creation");
    assert.equal(inboxAfterTail.value.view.rows[0]?.deliveryId, deliveryId);
    assert.notEqual(inboxAfterTail.value.view.generation, inboxFirstPage.value.view.generation);
    const inboxWatchAfterTail = await surface.execute(createFoundationRuntimeOperationRequest({
      target,
      deliveryId: null,
      operation: "delivery.watch",
      input: {
        scope: "inbox",
        afterGeneration: inboxFirstPage.value.view.generation,
        timeoutMs: 0,
      },
    }) as FoundationRuntimeWatchRequest);
    if (
      inboxWatchAfterTail.value === null || !("kind" in inboxWatchAfterTail.value) ||
      inboxWatchAfterTail.value.kind !== "watch"
    ) throw new TypeError("Expected Inbox watch after tail creation");
    assert.equal(inboxWatchAfterTail.value.changed, true);
    assert.equal(inboxWatchAfterTail.value.generation, inboxAfterTail.value.view.generation);

    const isolatedInbox = await createFoundationRuntimeReadSurface({
      machineHome,
      now: () => OBSERVED_AT,
      owners: {
        openDeliveryStore: async (selection) => {
          const opened = await openDeliveryControlRecordStoreReadOnly(selection);
          if (opened === null || selection.deliveryId !== secondDeliveryId) return opened;
          let verifications = 0;
          const store = new Proxy(opened.store, {
            get(targetStore, property) {
              if (property === "verifyIntegrity") {
                return async () => {
                  const exact = await targetStore.verifyIntegrity();
                  verifications += 1;
                  return verifications === 2
                    ? { ...exact, eventCount: exact.eventCount + 1 }
                    : exact;
                };
              }
              const selected = Reflect.get(targetStore, property, targetStore) as unknown;
              return typeof selected === "function" ? selected.bind(targetStore) : selected;
            },
          });
          return { ...opened, store };
        },
      },
    }).execute(createFoundationRuntimeOperationRequest({
      target,
      operation: "delivery.inbox",
      input: { afterDeliveryId: null, limit: 10 },
    }) as FoundationRuntimeInboxRequest);
    if (
      isolatedInbox.value === null || !("kind" in isolatedInbox.value) ||
      isolatedInbox.value.kind !== "inbox"
    ) throw new TypeError("Expected isolated Inbox result");
    assert.equal(isolatedInbox.status, "completed");
    assert.deepEqual(
      isolatedInbox.value.view.rows.map(({ deliveryId: selected, status: rowStatus }) =>
        [selected, rowStatus]),
      [[deliveryId, "available"], [secondDeliveryId, "unavailable"], [tailDeliveryId, "available"]],
    );

    let registryReads = 0;
    const mixedRegistry = await createFoundationRuntimeReadSurface({
      machineHome,
      now: () => OBSERVED_AT,
      owners: {
        listDeliveryStores: async (selection) => {
          const exact = await listDeliveryControlRecordStores(selection);
          registryReads += 1;
          return registryReads === 2
            ? { ...exact, inventoryDigest: `sha256:${"e".repeat(64)}` as const }
            : exact;
        },
      },
    }).execute(createFoundationRuntimeOperationRequest({
      target,
      operation: "delivery.inbox",
      input: { afterDeliveryId: null, limit: 1 },
    }) as FoundationRuntimeInboxRequest);
    assert.equal(mixedRegistry.status, "refused");
    assert(mixedRegistry.diagnostics.some(({ code }) =>
      code === "lifecycle.runtime-read.inbox-registry-epoch-mixed"));
    const retainedSecond = await openDeliveryControlRecordStoreReadOnly({
      machineHome,
      targetId: contract.targetId,
      deliveryId: secondDeliveryId,
    });
    assert(retainedSecond !== null);
    assert.equal((await retainedSecond.store.verifyIntegrity()).eventCount, 1);
    retainedSecond.store.close();

    let repositoryObservations = 0;
    const movingEpoch = createFoundationRuntimeReadSurface({
      machineHome,
      now: () => OBSERVED_AT,
      owners: {
        observeRepository: async () => {
          repositoryObservations += 1;
          return {
            repository: repositoryObservations === 1
              ? validation.observation.repository
              : {
                  ...validation.observation.repository,
                  headCommit: "f".repeat(40),
                },
            diagnostics: validation.diagnostics,
          };
        },
      },
    });
    const mixed = await movingEpoch.execute(deliveryViewRequest);
    assert.equal(mixed.status, "refused");
    assert(mixed.diagnostics.some(({ code }) =>
      code === "lifecycle.runtime-read.repository-epoch-mixed"));
  } finally {
    await Promise.all([
      rm(target, { recursive: true, force: true }),
      rm(machineHome, { recursive: true, force: true }),
    ]);
  }
});

test("validation reports an uninitialized target without inventing repository facts", async () => {
  const target = await mkdtemp(join(tmpdir(), "lifecycle-runtime-read-uninitialized-"));
  const machineHome = await mkdtemp(join(tmpdir(), "lifecycle-runtime-read-empty-home-"));
  try {
    const request = createFoundationRuntimeOperationRequest({
      target,
      operation: "repository.validate",
      input: null,
    }) as FoundationRuntimeValidateRequest;
    const result = await createFoundationRuntimeReadSurface({
      machineHome,
      now: () => OBSERVED_AT,
    }).execute(request);
    assert.equal(result.status, "completed");
    assert.equal(result.targetId, null);
    assert.equal(result.observation.repository.initialized, false);
    assert.equal(result.observation.repository.valid, false);
    assert.equal(result.observation.repository.repositoryContract, null);
    assert.equal(result.observation.repository.headCommit, null);
    assert(result.diagnostics.some(({ severity }) => severity === "error"));
    assert.deepEqual(result.changes, {
      repository: { changed: false, beforeCommit: null, afterCommit: null },
      candidate: { changed: false, before: null, after: null },
      control: { advanced: false, beforeHead: null, afterHead: null },
    });
  } finally {
    await Promise.all([
      rm(target, { recursive: true, force: true }),
      rm(machineHome, { recursive: true, force: true }),
    ]);
  }
});

test("Delivery status remains available from raw repository identity when the moved commit has invalid Atlas", async () => {
  const target = await mkdtemp(join(tmpdir(), "lifecycle-runtime-read-invalid-atlas-"));
  const machineHome = await mkdtemp(join(tmpdir(), "lifecycle-runtime-read-invalid-atlas-home-"));
  const deliveryId = "delivery-runtime-read-invalid-atlas";
  try {
    await git(target, ["init", "-b", "main"]);
    await git(target, ["config", "user.name", "Lifecycle Test"]);
    await git(target, ["config", "user.email", "lifecycle@example.invalid"]);
    await writeMinimalAtlas(target);
    await git(target, ["add", "--", "atlas"]);
    await git(target, ["commit", "-m", "Initialize target"]);
    const contract = await initializeRepository(target, {
      targetId: "target-runtime-read-invalid-atlas",
      directorPrincipal: "director-runtime-read-invalid-atlas",
      home: machineHome,
      authorityCredential: receiveFoundationAuthorityCredential("runtime-read-invalid-atlas-secret-at-least-thirty-two-bytes", "initialize"),
      publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
      implementationRoots: [],
      stage: true,
    });
    await git(target, ["commit", "-m", "Initialize Lifecycle"]);
    const created = await createDeliveryControlRecordStore({
      machineHome,
      targetId: contract.targetId,
      deliveryId,
      createdAt: "2026-08-29T08:59:00.000Z",
      runtimeActorId: "foundation-runtime",
    });
    created.store.close();

    await writeFile(join(target, "atlas/atlas.md"), "invalid current Atlas\n", "utf8");
    await git(target, ["add", "--", "atlas/atlas.md"]);
    await git(target, ["commit", "-m", "Move branch to invalid Atlas"]);
    const movedCommit = (await git(target, ["rev-parse", "HEAD"])).stdout.trim();
    const result = await createFoundationRuntimeReadSurface({
      machineHome,
      now: () => OBSERVED_AT,
    }).execute(createFoundationRuntimeOperationRequest({
      target,
      deliveryId,
      operation: "delivery.status",
      input: null,
    }) as FoundationRuntimeStatusRequest);

    assert.equal(result.status, "completed");
    assert.equal(result.observation.repository.initialized, true);
    assert.equal(result.observation.repository.valid, false);
    assert.equal(result.observation.repository.targetId, contract.targetId);
    assert.equal(result.observation.repository.headCommit, movedCommit);
    assert.notEqual(result.observation.repository.headTree, null);
    assert.equal(result.observation.repository.atlas, null);
    assert.equal(result.observation.delivery?.processId, deliveryId);
    assert(result.diagnostics.some(({ severity }) => severity === "error"));
  } finally {
    await Promise.all([
      rm(target, { recursive: true, force: true }),
      rm(machineHome, { recursive: true, force: true }),
    ]);
  }
});
