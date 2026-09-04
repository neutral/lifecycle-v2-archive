import assert from "node:assert/strict";
import test from "node:test";
import { FoundationAttemptViewSchema } from "@neutral/lifecycle-protocol";
import { createDeliveryViewLifecycleTuiSnapshot } from "../src/app/snapshot.js";
import { createLifecycleTuiState } from "../src/app/state.js";
import { updateLifecycleTui } from "../src/app/update.js";
import { createFoundationTuiPresentation } from "../src/domain/presentation.js";
import { dashboardContentText, frameDisplay } from "../src/view/content.js";
import { testAttemptView, testBuilderAttemptView, testDelivery, testDeliveryView, testDeliveryViewResult, testDigest, testObservation } from "./support/protocol-v10.js";

function deliveryViewState(
  view: ReturnType<typeof testDeliveryView>,
  tabIndex: number,
) {
  const result = testDeliveryViewResult(view.state);
  const snapshot = createDeliveryViewLifecycleTuiSnapshot(Object.freeze({
    ...result,
    value: Object.freeze({ kind: "delivery-view" as const, view }),
  }));
  let state = createLifecycleTuiState<typeof snapshot>({ columns: 120, rows: 50 });
  state = updateLifecycleTui(state, { kind: "start" }).state;
  state = updateLifecycleTui(state, {
    kind: "refresh-succeeded",
    sequence: 1,
    model: snapshot,
    actionCount: snapshot.presentation.actions.length,
    prepareAvailable: true,
    admitActionIndex: null,
    selectedDelivery: {
      deliveryId: view.generation.processId,
      generation: view.generation.digest,
    },
    nextPassAvailable: view.nextPass.filter(({ eligible }) => eligible).map(({ operation }) => operation),
    observedAt: 1,
  }).state;
  return Object.freeze({ ...state, tabIndex });
}

test("presentation is Delivery-centered and retains Candidate, Attempt, Evidence, and Journal tabs", () => {
  const observation = testObservation({ delivery: testDelivery({
    standing: "active", activities: [{ id: "attempt-v10", operation: "delivery.continue", family: "agent", stage: "submitted" }],
  }) });
  const presentation = createFoundationTuiPresentation(observation);
  assert.deepEqual(presentation.tabs.map(({ id }) => id), [
    "inbox", "now", "frame", "next-pass", "boundary", "candidate",
    "decision", "evidence", "attempt", "journal", "control", "exact",
  ]);
  assert.equal(presentation.workingLane.title, "Candidate");
  assert.match(presentation.tabs.find(({ id }) => id === "attempt")?.summary ?? "", /sanitized execution selection/iu);
  assert.equal(presentation.frame.current?.status, "unavailable");
  assert.equal(presentation.actions.find(({ operationId }) => operationId === "delivery.continue")?.effectRoute, "canonical-cli");
  assert.equal(presentation.actions.find(({ operationId }) => operationId === "delivery.no-ship")?.effectRoute, "canonical-cli-handoff");
  assert.deepEqual(presentation.repository.atlas, observation.repository.atlas);
  const exactRows = presentation.tabs.find(({ id }) => id === "exact")?.rows ?? [];
  assert.equal(exactRows.find(({ label }) => label === "Atlas release")?.value, "0.7.0 · authored format 1");
  assert.equal(exactRows.find(({ label }) => label === "Atlas state")?.value, observation.repository.atlas?.stateDigest);
  assert.equal(exactRows.find(({ label }) => label === "Atlas Resolution")?.value, observation.repository.atlas?.resolutionDigest);
  assert.equal(exactRows.find(({ label }) => label === "Atlas normalized model")?.value, observation.repository.atlas?.normalizedModelDigest);
  assert.equal(exactRows.find(({ label }) => label === "Atlas Resource bindings")?.value, observation.repository.atlas?.resourceBindingsDigest);
  assert.doesNotMatch(
    JSON.stringify(presentation),
    /execution cell|container|backend|allocation|reclamation|job|pipeline/iu,
  );
});

test("no Delivery leaves Frame available without invented carrier facts", () => {
  const presentation = createFoundationTuiPresentation(testObservation({ delivery: null }));
  assert.equal(presentation.journey.currentPhase, "frame");
  assert.equal(presentation.frame.current, null);
  assert.equal(presentation.actions.length, 0);
  assert.match(presentation.tabs.find(({ id }) => id === "frame")?.summary ?? "", /fresh brief/u);
});

test("runtime eligible operations are descriptive and unified no-ship remains a CLI handoff", () => {
  const presentation = createFoundationTuiPresentation(testObservation({ delivery: testDelivery({ standing: "decision-ready" }) }));
  const noShip = presentation.actions.find(({ operationId }) => operationId === "delivery.no-ship");
  assert.equal(noShip?.founderAuthorityRequired, true);
  assert.equal(noShip?.effectRoute, "canonical-cli-handoff");
  assert.match(noShip?.handoffReason ?? "", /explicit reviewed CLI handoffs/u);
  assert.equal(noShip?.title, "Close without shipping the Candidate");
  assert.match(noShip?.consequence ?? "", /abandoned.*contained and retired/u);
});

test("Founder-facing action copy names the Candidate and exact mandate consequence", () => {
  const active = createFoundationTuiPresentation(testObservation({ delivery: testDelivery({ standing: "active" }) }));
  assert.equal(active.actions.find(({ operationId }) => operationId === "delivery.continue")?.title, "Continue work on the Candidate");
  assert.equal(active.actions.find(({ operationId }) => operationId === "delivery.evaluate")?.title, "Seal and evaluate the Candidate");

  const admission = createFoundationTuiPresentation(testObservation({ delivery: testDelivery({ standing: "awaiting-admission" }) }));
  assert.equal(admission.actions.find(({ operationId }) => operationId === "delivery.admit")?.title, "Activate the boundary and initialize the Candidate");

  const decision = createFoundationTuiPresentation(testObservation({ delivery: testDelivery({ standing: "decision-ready" }) }));
  assert.equal(decision.actions.find(({ operationId }) => operationId === "delivery.accept")?.title, "Accept the exact evidenced Candidate");
  assert.equal(decision.hero.owner, "Founder");
});

test("presentation keeps Candidate absence and Store recovery separate", () => {
  const admission = createFoundationTuiPresentation(testObservation({ delivery: testDelivery({
    standing: "active",
    candidatePresent: false,
    candidateCondition: "absent",
    eligibleOperations: ["delivery.recover"],
    recovery: {
      scope: "activity",
      activityId: "admit-awaiting-candidate",
      kind: "candidate-observation",
      resumesAt: "candidate-revision-observed",
      exactEffectDigest: null,
    },
    activities: [{
      id: "admit-awaiting-candidate",
      operation: "delivery.admit",
      family: "transaction",
      stage: "effect-observed",
    }],
  }) }));
  assert.equal(admission.workingLane.status, "absent");
  assert.equal(admission.workingLane.tone, "unavailable");
  assert.equal(admission.hero.owner, "Lifecycle");

  const progressing = createFoundationTuiPresentation(testObservation({ delivery: testDelivery({
    standing: "active",
    candidateCondition: "in-progress",
    eligibleOperations: ["delivery.recover"],
    activities: [{
      id: "continue-prepared",
      operation: "delivery.continue",
      family: "agent",
      stage: "prepared",
    }],
    recovery: {
      scope: "activity",
      activityId: "continue-prepared",
      kind: "finalization",
      resumesAt: "provider-effect-intended",
      exactEffectDigest: null,
    },
  }) }));
  assert.equal(progressing.workingLane.status, "in-progress");
  assert.equal(progressing.hero.owner, "Lifecycle");
  assert.match(progressing.hero.body, /provider-effect-intended/u);

  const closing = createFoundationTuiPresentation(testObservation({ delivery: testDelivery({
    standing: "closed",
    candidateCondition: "accepted",
    eligibleOperations: ["delivery.recover"],
    recovery: {
      scope: "store-disposition",
      activityId: null,
      kind: "finalization",
      resumesAt: "store-archive",
      exactEffectDigest: null,
    },
  }) }));
  assert.equal(closing.workingLane.status, "accepted");
  assert.equal(closing.hero.owner, "Lifecycle");
  assert.match(closing.hero.body, /store-archive/u);
});

test("Frame uses summary and proposal from one coherent derived Attempt View coordinate", () => {
  const observation = testObservation({ delivery: testDelivery({ standing: "awaiting-admission" }) });
  const view = testAttemptView();
  const presentation = createFoundationTuiPresentation(observation, { kind: "available", view });
  assert.equal(presentation.frame.current?.status, "available");
  assert.equal(presentation.frame.current?.attemptId, "attempt-tui-v10");
  assert.equal(
    presentation.frame.current?.summary?.text,
    "The target is understood and one bounded implementation route is ready for admission.",
  );
  assert.deepEqual(presentation.frame.current?.proposal, view.agentSemantics.roleSemantics);
  const display = frameDisplay(presentation);
  assert.match(display?.summary.text ?? "", /one bounded implementation route/u);
  assert.match(display?.plan.text ?? "", /workBoundary/u);
  assert.match(display?.plan.notice ?? "", /Attempt attempt-tui-v10 · Journal 1/u);
});

test("Frame exposes a fully observed semantic submission failure without marking the view incomplete", () => {
  const observation = testObservation({ delivery: testDelivery({ standing: "awaiting-admission" }) });
  const complete = testAttemptView();
  const failureFactsDigest = testDigest("7");
  const invalid = FoundationAttemptViewSchema.parse({
    ...complete,
    agentSemantics: {
      ...complete.agentSemantics,
      workProduct: null,
      disposition: null,
      summary: null,
      uncertainty: null,
      claims: [],
      citations: [],
      limitations: [],
      noProductReason: null,
      roleSemantics: null,
      body: null,
      submissionDiagnostics: {
        parserDisposition: "invalid",
        compilerDisposition: "not-run",
        failureFactsDigest,
        diagnostic: {
          code: "lifecycle.agent-work-product.invalid.title",
          stage: "template",
          factsDigest: failureFactsDigest,
        },
      },
    },
  });
  const presentation = createFoundationTuiPresentation(observation, { kind: "available", view: invalid });
  assert.equal(presentation.frame.current?.status, "available");
  assert.deepEqual(presentation.frame.current?.diagnosticCodes, [
    "lifecycle.agent-work-product.invalid.title",
  ]);
  assert.match(presentation.frame.current?.message ?? "", /observed completely/u);
  assert.match(frameDisplay(presentation)?.plan.notice ?? "", /diagnostics lifecycle\.agent-work-product\.invalid\.title/u);

  assert.equal(FoundationAttemptViewSchema.safeParse({
    ...invalid,
    agentSemantics: {
      ...invalid.agentSemantics,
      submissionDiagnostics: {
        ...invalid.agentSemantics.submissionDiagnostics,
        failureFactsDigest: testDigest("8"),
      },
    },
  }).success, false);
});

test("Frame distinguishes empty, incomplete, stale, and unavailable Attempt View facts", () => {
  const observation = testObservation({ delivery: testDelivery({ standing: "awaiting-admission" }) });
  const complete = testAttemptView();
  const incomplete = FoundationAttemptViewSchema.parse({
    ...complete,
    complete: false,
    diagnostics: [{
      code: "lifecycle.attempt-view.incomplete",
      stage: "agent-semantics",
      factsDigest: testDigest("f"),
    }],
  });
  const stale = FoundationAttemptViewSchema.parse({
    ...complete,
    coordinate: {
      ...complete.coordinate,
      journal: { ...complete.coordinate.journal, headDigest: testDigest("e") },
    },
  });
  assert.equal(createFoundationTuiPresentation(observation, { kind: "empty" }).frame.current?.status, "empty");
  assert.equal(createFoundationTuiPresentation(observation, { kind: "available", view: incomplete }).frame.current?.status, "incomplete");
  const stalePresentation = createFoundationTuiPresentation(observation, { kind: "available", view: stale });
  assert.equal(stalePresentation.frame.current?.status, "stale");
  assert.equal(stalePresentation.frame.current?.summary, null, "stale semantics are never mixed into the live snapshot");
  const staleAttempt = stalePresentation.tabs.find(({ id }) => id === "attempt");
  assert.doesNotMatch(JSON.stringify(staleAttempt), /docker-local|execution-image-tui-v10/iu);
  assert.equal(createFoundationTuiPresentation(observation, { kind: "unavailable", message: "read failed" }).frame.current?.status, "unavailable");
});

test("Candidate Carrier and execution bindings remain subordinate to their Delivery Attempt", () => {
  const view = testBuilderAttemptView();
  const observation = testObservation({ delivery: testDelivery({ standing: "active" }) });
  const presentation = createFoundationTuiPresentation(observation, { kind: "available", view });
  assert.equal(
    view.attemptContract.candidate?.carrierManifestDigest,
    "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  );
  assert.equal(
    view.providerExecution.execution?.backendProfile.profileId,
    "lifecycle.execution-backend-profile.docker-local.v1",
  );
  assert.equal(view.providerExecution.containment?.classification, "contained");
  assert.equal(view.providerExecution.retirement?.classification, "retired");
  const attemptRows = presentation.tabs.find(({ id }) => id === "attempt")?.rows ?? [];
  assert.match(attemptRows.find(({ label }) => label === "Backend Profile")?.value ?? "", /Docker Execution Backend.*docker-local/iu);
  assert.match(attemptRows.find(({ label }) => label === "Execution Image")?.value ?? "", /execution-image-tui-v10/u);
  assert.equal(attemptRows.find(({ label }) => label === "Agent product network")?.value, "none");
  assert.equal(attemptRows.find(({ label }) => label === "Provider service")?.value, "fixed service channel");
  assert.equal(attemptRows.find(({ label }) => label === "Network separation")?.value, "required");
  assert.equal(attemptRows.find(({ label }) => label === "Wall-time limit")?.value, "3600000 ms");
  assert.equal(attemptRows.find(({ label }) => label === "Process limit")?.value, "128");
  assert.equal(attemptRows.find(({ label }) => label === "Output-byte limit")?.value, "1048576 bytes");
  assert.equal(attemptRows.find(({ label }) => label === "Containment")?.value, "contained");
  assert.equal(attemptRows.find(({ label }) => label === "Retirement")?.value, "retired");
  const publicPresentation = JSON.stringify(presentation);
  assert.doesNotMatch(
    publicPresentation,
    new RegExp(view.attemptContract.candidate!.carrierManifestDigest, "u"),
  );
  assert.doesNotMatch(
    publicPresentation,
    /"handle"|dockerId|endpoint|credential|reclamationCoordinate/iu,
  );
  assert.deepEqual(presentation.journey.rail.map(({ id }) => id), [
    "setup", "frame", "admit", "work", "resolve", "prove", "close",
  ]);
});

test("Attempt presentation labels the test Backend Profile without calling it Docker", () => {
  const source = testBuilderAttemptView();
  const profileId = "lifecycle.execution-backend-profile.fault-injection.v1";
  const view = FoundationAttemptViewSchema.parse({
    ...source,
    attemptContract: {
      ...source.attemptContract,
      execution: {
        ...source.attemptContract.execution,
        backendProfile: {
          ...source.attemptContract.execution.backendProfile,
          profileId,
        },
      },
    },
    providerExecution: {
      ...source.providerExecution,
      execution: source.providerExecution.execution === null
        ? null
        : {
            ...source.providerExecution.execution,
            backendProfile: {
              ...source.providerExecution.execution.backendProfile,
              profileId,
            },
          },
    },
  });
  const presentation = createFoundationTuiPresentation(
    testObservation({ delivery: testDelivery({ standing: "active" }) }),
    { kind: "available", view },
  );
  const backend = presentation.tabs.find(({ id }) => id === "attempt")?.rows
    .find(({ label }) => label === "Backend Profile")?.value ?? "";
  assert.match(backend, /Fault-injection Test Backend.*fault-injection/iu);
  assert.doesNotMatch(backend, /Docker/iu);
});

test("Now renders coherent recovery across every unresolved durable activity stage without exposing execution mechanics", () => {
  for (const durableStage of [
    "started",
    "prepared",
    "effect-intended",
    "effect-observed",
    "submitted",
    "finalizing",
  ] as const) {
    const delivery = testDelivery({
      standing: "active",
      eligibleOperations: ["delivery.recover"],
      activities: [{
        id: "activity-current-v10",
        operation: "delivery.continue",
        family: "agent",
        stage: durableStage,
      }],
      recovery: {
        scope: "activity",
        activityId: "activity-current-v10",
        kind: "finalization",
        resumesAt: "activity-completed",
        exactEffectDigest: null,
      },
    });
    const view = testDeliveryView(delivery);
    assert.equal(view.state.activities[0]?.stage, durableStage);
    assert.equal(view.activity?.stage, "recovery");
    const content = dashboardContentText(deliveryViewState(view, 1), "/target");
    assert.match(content, /RUNTIME ACTIVITY/u);
    assert.match(content, /recovery/u);
    assert.match(content, /activity-current-v10/u);
    assert.doesNotMatch(content, /support coordinate|execution cell|container|backend|allocation|reclamation|job|pipeline/iu);
  }
});

test("abandoned Candidate is terminal Delivery state, not a cleanup workflow", () => {
  const presentation = createFoundationTuiPresentation(testObservation({
    delivery: testDelivery({ standing: "closed", candidateCondition: "abandoned" }),
  }));
  assert.equal(presentation.workingLane.status, "abandoned");
  assert.match(presentation.workingLane.summary, /abandoned.*closed without integration/u);
  assert.deepEqual(presentation.journey.rail.map(({ id }) => id), [
    "setup", "frame", "admit", "work", "resolve", "prove", "close",
  ]);
  assert.equal(presentation.actions.length, 0);
});

test("Next Pass renders the selected typed Boundary, Candidate, consequence, and fresh Investment", () => {
  const delivery = testDelivery({ standing: "active" });
  const view = testDeliveryView(delivery);
  const content = dashboardContentText(deliveryViewState(view, 3), "/target");
  const selected = view.nextPass.find(({ operation }) => operation === "delivery.continue");
  assert.ok(selected !== undefined);
  assert.match(content, new RegExp(selected.boundary?.id ?? "missing-boundary", "u"));
  assert.match(content, new RegExp(selected.candidate?.id ?? "missing-candidate", "u"));
  assert.match(content, /Run delivery\.continue against the exact current Delivery generation/u);
  assert.match(content, /Model: gpt-5\.6-codex/u);
  assert.match(content, /Reasoning: high/u);
  assert.match(content, /Wall time: 120000 ms/u);
  assert.match(content, /Maximum output: 65536 bytes/u);
});
