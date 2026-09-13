import assert from "node:assert/strict";
import test from "node:test";
import {
  createFoundationRuntimeOperationRequest,
  createFoundationRuntimeOperationResult,
  FoundationDeliveryStateSchema,
  FoundationRuntimeObservationSchema,
  type FoundationRuntimeOperationResult,
} from "@neutral/lifecycle-protocol";
import { renderFoundationCliHuman } from "../../src/foundation/cli.js";
import { compileWorkDelegationStopRequest } from "../../src/foundation/control/work-delegation-stop.js";
import { renderFoundationRuntimeHuman } from "../../src/foundation/facade.js";

const DIGEST = `sha256:${"a".repeat(64)}` as const;
const NOW = "2026-09-05T12:00:00.000Z";
type State = NonNullable<FoundationRuntimeOperationResult["observation"]["delivery"]>;

// Public presentation fixtures: these test what a supplied observation says,
// not how the reducer establishes that observation.
function result(input: {
  state?: Partial<State>;
  status?: FoundationRuntimeOperationResult["status"];
  advanced?: boolean;
} = {}): FoundationRuntimeOperationResult {
  const candidate = { kind: "candidate-revision", id: "candidate-7", revision: 7, digest: DIGEST } as const;
  return createFoundationRuntimeOperationResult({
    request: createFoundationRuntimeOperationRequest({
      operation: "delivery.status", target: "/disposable-target", deliveryId: "delivery-1", input: null,
    }),
    observedAt: NOW, status: input.status ?? "completed", targetId: "target-1", deliveryId: "delivery-1",
    observation: FoundationRuntimeObservationSchema.parse({
      schema: "lifecycle.foundation-runtime-observation.v17", observedAt: NOW,
      repository: {
        schema: "lifecycle.repository-observation.v17", initialized: true, valid: true,
        targetId: "target-1", repositoryContract: "lifecycle.repository.v22",
        repositoryContractDigest: DIGEST, headCommit: "a".repeat(40), headTree: "b".repeat(40),
        productDigest: DIGEST, atlas: null, knowledgeDigest: DIGEST, checkBindingsDigest: DIGEST,
      },
      delivery: FoundationDeliveryStateSchema.parse({
        schema: "lifecycle.delivery-reduction.v5", storeId: "store-1", processId: "delivery-1",
        standing: "active", candidateCondition: "needs-correction", activities: [], recovery: null,
        subjects: {
          proposedBoundary: null, activeBoundary: { kind: "work-boundary", id: "scope-1", revision: 1, digest: DIGEST },
          integrationAssessment: null, candidate, materialCondition: null, seal: null, evidence: null, closure: null,
        },
        delegation: { admission: null, current: null, charged: { operations: 0, agentAttempts: 0, reservedCellWallTimeMs: 0 } },
        journal: { eventCount: 1, headSequence: 1, headDigest: DIGEST },
        storeDisposition: { stage: "active", integrity: "verified", sealSubjectDigest: null, archiveManifestDigest: null },
        eligibleOperations: ["delivery.continue", "delivery.integrate", "delivery.no-ship"],
        ...input.state,
      }),
    }),
    changes: {
      repository: { changed: false, beforeCommit: null, afterCommit: null },
      candidate: { changed: input.advanced ?? false, before: null, after: input.advanced ? candidate : null },
      control: { advanced: false, beforeHead: null, afterHead: null },
    },
  });
}

test("human status explains retained work and every supplied action without inventing publication eligibility", () => {
  const rendered = renderFoundationRuntimeHuman(result());
  assert.match(rendered, /^repository: valid$/mu);
  assert.match(rendered, /Saved proposed result needs correction/u);
  assert.match(rendered, new RegExp(`saved result \\(Candidate\\): candidate-7@7 ${DIGEST}`, "u"));
  assert.match(rendered, /approved scope \(Work Boundary\): scope-1@1/u);
  const courses = rendered.split("Available actions (Runtime rechecks each request):\n")[1]!;
  assert.deepEqual([...courses.matchAll(/^  (\S+)/gmu)].map((match) => match[1]), ["continue", "integrate", "no-ship"]);
  assert.match(courses, /Develop or correct/u);
  assert.match(courses, /End this Delivery without publishing/u);
  assert.doesNotMatch(courses, /^  (?:accept|evaluate|recover)\s/gmu);
});

test("human recovery distinguishes unestablished repository validity from exact failure diagnostics", () => {
  const basis = result();
  for (const hasValidationFailure of [false, true]) {
    const recovered = createFoundationRuntimeOperationResult({
      request: createFoundationRuntimeOperationRequest({
        operation: "delivery.recover", target: "/disposable-target", deliveryId: "delivery-1", input: null,
      }),
      observedAt: NOW, status: "completed", targetId: "target-1", deliveryId: "delivery-1",
      observation: {
        ...basis.observation,
        repository: { ...basis.observation.repository, valid: false,
          productDigest: null, atlas: null, knowledgeDigest: null },
      },
      changes: basis.changes,
      diagnostics: hasValidationFailure ? [{
        code: "lifecycle.atlas.invalid", severity: "error", message: "Current Atlas validation failed.",
        retryable: false, facts: {},
      }] : [],
    });
    const rendered = renderFoundationRuntimeHuman(recovered);
    assert.match(rendered, /^delivery\.recover: completed$/mu);
    assert.match(rendered, /^repository: validity not established$/mu);
    assert.doesNotMatch(rendered, /^repository: invalid$/mu);
    assert.equal(rendered.includes("lifecycle.atlas.invalid"), hasValidationFailure);
    assert.equal(rendered.includes("Current Atlas validation failed."), hasValidationFailure);
  }
});

test("a completed command does not describe an evaluated Candidate as published", () => {
  const rendered = renderFoundationRuntimeHuman(result({ state: {
    standing: "decision-ready", candidateCondition: "ready-for-decision",
    eligibleOperations: ["delivery.accept", "delivery.no-ship"],
  } }));
  assert.match(rendered, /not published yet/u);
  assert.match(rendered, /if its parent still matches/u);
  assert.doesNotMatch(rendered, /was applied to canonical/u);
});

test("refusal and a changed retained result reference remain independent", () => {
  const rendered = renderFoundationRuntimeHuman(result({ status: "refused", advanced: true }));
  assert.match(rendered, /requested operation was refused/u);
  assert.match(rendered, /Saved result reference changed: <none> -> candidate-7@7/u);
  assert.match(rendered, /candidate-7@7/u);
  assert.match(rendered, /Develop or correct the saved proposed result/u);
});

test("recovery explains reconciliation and does not supply a new productive action", () => {
  const rendered = renderFoundationRuntimeHuman(result({ status: "recovery-required", state: {
    candidateCondition: "terminal-recovery",
    recovery: { scope: "activity", activityId: "activity-1", kind: "transaction", resumesAt: "transaction-effect-observed", exactEffectDigest: DIGEST },
    eligibleOperations: ["delivery.recover"],
  } }));
  assert.match(rendered, /completion is not established/u);
  assert.match(rendered, /recovery: transaction-effect-observed/u);
  assert.match(rendered, /do not redispatch/u);
  assert.doesNotMatch(rendered, /^  continue\s/gmu);
});

test("human Inbox exposes exact selectable identities and discloses unavailable and remaining rows", () => {
  const basis = result();
  const inbox = createFoundationRuntimeOperationResult({
    request: createFoundationRuntimeOperationRequest({ operation: "delivery.inbox", target: "/disposable-target", input: { limit: 2, afterDeliveryId: null } }),
    observedAt: NOW, status: "completed", targetId: "target-1", deliveryId: null,
    observation: { ...basis.observation, delivery: null }, changes: basis.changes,
    value: { kind: "inbox", view: {
      schema: "lifecycle.delivery-inbox.v1", targetId: "target-1", generation: DIGEST,
      nextAfterDeliveryId: "delivery-2",
      rows: [{ status: "available", deliveryId: "delivery-1", label: "Add account export",
        standing: "active", candidateCondition: "needs-correction", activity: null,
        attentionOwner: "director", evidenceReadiness: null, recoveryRequired: false, latestMilestone: null,
        generation: {
          schema: "lifecycle.delivery-generation.v1", storeId: "store-1", processId: "delivery-1",
          journal: basis.observation.delivery!.journal, storeDisposition: basis.observation.delivery!.storeDisposition,
          repository: { headCommit: "a".repeat(40), headTree: "b".repeat(40), repositoryContractDigest: DIGEST },
          activeOperation: null, digest: DIGEST,
        },
      }, { status: "unavailable", deliveryId: "delivery-2", coordinateDigest: DIGEST,
        diagnostic: { code: "test.unavailable", severity: "error", message: "Saved work cannot currently be read.", retryable: true, facts: {} } }],
    } },
  });
  const rendered = renderFoundationRuntimeHuman(inbox);
  assert.match(rendered, /delivery-1 \| Add account export/u);
  assert.match(rendered, /proposed result: needs-correction \| attention: director/u);
  assert.match(rendered, /delivery-2 \| unavailable \| test.unavailable/u);
  assert.match(rendered, /More Deliveries remain; next afterDeliveryId: delivery-2/u);
  assert.match(rendered, /Use status with a listed Delivery identity/u);
  assert.ok(inbox.value !== null && "kind" in inbox.value && inbox.value.kind === "inbox");
  for (const changed of [true, false]) {
    const watched = createFoundationRuntimeOperationResult({
      request: createFoundationRuntimeOperationRequest({ operation: "delivery.watch", target: "/disposable-target",
        deliveryId: null, input: { scope: "inbox", afterGeneration: changed ? null : DIGEST, timeoutMs: 0 } }),
      observedAt: NOW, status: "completed", targetId: "target-1", deliveryId: null,
      observation: inbox.observation, changes: inbox.changes,
      value: { kind: "watch", scope: "inbox", changed, generation: DIGEST, inbox: inbox.value.view, delivery: null },
    });
    const output = renderFoundationRuntimeHuman(watched);
    assert.match(output, changed ? /initial snapshot or changed generation/u : /no generation change observed/u);
    assert.match(output, /delivery-1 \| Add account export/u, "watch renders the returned Inbox, including an unchanged snapshot");
    assert.match(output, /delivery-2 \| unavailable/u);
    assert.match(output, /use this watch generation as afterGeneration/u);
    assert.match(output, /watch return does not complete work/u);
  }
});

test("human diff presents the requested content and distinguishes unavailable, advancing, and incomplete reads", () => {
  const basis = result();
  const generation = {
    schema: "lifecycle.delivery-generation.v1" as const, storeId: "store-1", processId: "delivery-1",
    journal: basis.observation.delivery!.journal, storeDisposition: basis.observation.delivery!.storeDisposition,
    repository: { headCommit: "a".repeat(40), headTree: "b".repeat(40), repositoryContractDigest: DIGEST },
    activeOperation: null, digest: DIGEST,
  };
  const content = "--- a/account.ts\n+++ b/account.ts\n-old\n+corrected\n";
  for (const subject of ["candidate", "decision"] as const) {
    for (const currentness of ["exact", "potentially-advancing", "unavailable"] as const) {
      if (subject === "decision" && currentness === "potentially-advancing") continue;
      for (const truncated of [false, true]) {
        if (currentness === "unavailable" && truncated) continue;
        const available = currentness !== "unavailable";
        const seal = subject === "decision" ? { kind: "candidate-seal", id: "seal-7", revision: 1, digest: DIGEST } as const : null;
        const observation = { ...basis.observation, delivery: { ...basis.observation.delivery!,
          subjects: { ...basis.observation.delivery!.subjects, seal } } };
        const request = createFoundationRuntimeOperationRequest({ operation: "delivery.diff", target: "/disposable-target",
          deliveryId: "delivery-1", input: { subject, maximumBytes: 65536 } });
        const response = createFoundationRuntimeOperationResult({
          request,
          observedAt: NOW, status: "completed", targetId: "target-1", deliveryId: "delivery-1",
          observation, changes: basis.changes,
          value: { kind: "diff", view: {
            schema: "lifecycle.delivery-diff.v1", generation, subject, currentness,
            candidate: basis.observation.delivery!.subjects.candidate,
            seal,
            baseCommit: available ? "a".repeat(40) : null, tree: available ? "b".repeat(40) : null,
            exactDiffDigest: available ? DIGEST : null, contentDigest: available ? DIGEST : null,
            byteLength: available ? Buffer.byteLength(content) : 0, truncated,
            content: available ? content : null, unavailableReason: available ? null : "Exact Carrier unavailable.",
          } },
        });
        const output = renderFoundationRuntimeHuman(response);
        assert.match(output, subject === "decision" ? /sealed result for decision/u : /retained working result/u);
        assert.match(output, /Candidate: candidate-7@7/u);
        if (subject === "decision") assert.match(output, /Seal: seal-7@1/u);
        assert.match(output, /Read generation: sha256:/u);
        assert.doesNotMatch(output, /Available actions/u, "the requested diff leads instead of a second status view");
        if (available) assert.ok(output.includes(content));
        else {
          assert.match(output, /Diff unavailable: Exact Carrier unavailable/u);
          assert.doesNotMatch(output, /No textual differences/u);
        }
        assert.equal(output.includes("Development is active"), currentness === "potentially-advancing");
        assert.equal(output.includes("Omitted content must not be treated as reviewed"), truncated);
        if (subject === "candidate" && currentness === "exact" && !truncated) {
          assert.ok(response.value !== null && "kind" in response.value && response.value.kind === "diff");
          const empty = createFoundationRuntimeOperationResult({ ...response, request,
            value: { kind: "diff", view: { ...response.value.view, content: "", byteLength: 0 } } });
          assert.match(renderFoundationRuntimeHuman(empty), /No textual differences in this exact diff/u);
          assert.doesNotMatch(renderFoundationRuntimeHuman(empty), /Diff unavailable/u);
        }
      }
    }
  }
});

test("work human output separates saved permission, settled operations and a pending stop from acceptance", () => {
  const reference = { kind: "work-delegation", id: "permission-1", revision: 1, digest: DIGEST } as const;
  const stopRequest = compileWorkDelegationStopRequest({ storeId: "store-1", processId: "delivery-1",
    delegation: reference, requestedBy: "director-1", requestedAt: NOW });
  const base = result({ state: { standing: "decision-ready", candidateCondition: "ready-for-decision",
    delegation: { admission: null, current: { reference, stopped: false },
      charged: { operations: 1, agentAttempts: 0, reservedCellWallTimeMs: 0 } },
    activities: [{ id: "activity-1", operation: "delivery.integrate", family: "integration", stage: "completed" }],
    eligibleOperations: ["delivery.accept", "delivery.no-ship"],
  } });
  const head = { sequence: 1, eventId: "event-1", digest: DIGEST };
  for (const action of ["set", "run", "stop"] as const) {
    const request = createFoundationRuntimeOperationRequest({ operation: "delivery.work", target: "/disposable-target",
      deliveryId: "delivery-1", input: action === "set"
        ? { action, expectedGeneration: DIGEST, allowedOperations: ["delivery.integrate"],
            directions: { continue: null, evaluate: null }, agentChoices: { builder: null, reviewer: null },
            ceilings: { operations: 3, agentAttempts: 0, reservedCellWallTimeMs: 0 }, expiresAt: null }
        : action === "run" ? { action, expectedGeneration: DIGEST, delegation: reference }
        : { action, delegation: reference } });
    const observed = createFoundationRuntimeOperationResult({ request, observedAt: NOW, status: "completed",
      targetId: base.targetId, deliveryId: base.deliveryId, observation: base.observation,
      changes: { ...base.changes, control: { advanced: action !== "stop", beforeHead: action === "stop" ? head : null, afterHead: head } },
      value: { kind: "work-control", action, delegation: reference, eventProjection: "journal-coordinates-only",
        completedOperations: action === "run" ? 1 : 0,
        lastActivity: action === "run" ? { activityId: "activity-1", operation: "delivery.integrate" } : null,
        stop: action === "stop" ? { disposition: "pending", request: stopRequest } : null,
        reason: action === "set" ? "delegation-set" : action === "stop" ? "stop-pending" : "acceptance-required" } });
    const text = renderFoundationCliHuman(observed);
    assert.match(text, /Settled operations do not mean Product acceptance/u);
    assert.match(text, /not published yet/u);
    assert.match(text, /permission-1@1/u);
    assert.doesNotMatch(text, /was applied to canonical|automatically resumes/u);
    if (action === "set") assert.match(text, /Work permission saved. Work has not started/u);
    if (action === "run") assert.match(text, /Settled operations observed: 1/u);
    if (action === "stop") {
      assert.match(text, /Stop request saved. The current finite operation may finish/u);
      assert.match(text, /no next reservation is permitted/u);
      assert.doesNotMatch(text, /operation cancelled|execution retired/u);
    }
  }
  assert.equal(renderFoundationCliHuman(result()), renderFoundationRuntimeHuman(result()));
});
