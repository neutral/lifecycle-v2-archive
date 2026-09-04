import assert from "node:assert/strict";
import test from "node:test";
import { FOUNDATION_TUI_AUTHORITY_SECRET_FILE_RULE, createFrameReadyLifecycleTuiSnapshot, createInspectedLifecycleTuiSnapshot, createObservedLifecycleTuiSnapshot, createSetupLifecycleTuiSnapshot, lifecycleTuiReviewAction } from "../src/app/snapshot.js";
import { testAttemptViewResult, testDelivery, testObservation, testStatusResult } from "./support/protocol-v10.js";

test("setup remains print-only guidance and Frame-before-Delivery has no status action", () => {
  const setup = createSetupLifecycleTuiSnapshot("/work/product", { code: "lifecycle.repository.contract-missing", message: "Repository contract is missing", retryable: false, repositoryChanged: false, operationalStateChanged: false, recoveryActions: [] });
  assert.equal(lifecycleTuiReviewAction(setup, 0)?.protocolOperation, "repository.initialize");
  assert.match(lifecycleTuiReviewAction(setup, 0)?.authoritySecretFileRule ?? "", /owner-private/u);
  assert.equal(lifecycleTuiReviewAction(createFrameReadyLifecycleTuiSnapshot("/work/product"), 0), null);
  assert.match(FOUNDATION_TUI_AUTHORITY_SECRET_FILE_RULE, /NUL-free UTF-8/u);
});

test("review action derives unified v10 no-ship from exact eligible operations", () => {
  const observation = testObservation({ delivery: testDelivery({ standing: "decision-ready" }) });
  const snapshot = createObservedLifecycleTuiSnapshot(testStatusResult({ observation }));
  const noShip = snapshot.presentation.actions.findIndex(({ operationId }) => operationId === "delivery.no-ship");
  const action = lifecycleTuiReviewAction(snapshot, noShip);
  assert.equal(action?.protocolOperation, "delivery.no-ship");
  assert.equal(action?.founderAuthorityRequired, true);
  assert.deepEqual(action?.requiredInputIds, ["semantic Markdown file", "Founder authority secret file"]);
});

test("Attempt View inspection snapshot preserves exact empty and semantic states", () => {
  const exact = createInspectedLifecycleTuiSnapshot(testAttemptViewResult());
  assert.equal(exact.presentation.frame.current?.status, "available");
  assert.equal(exact.presentation.frame.current?.attemptId, "attempt-tui-v10");
  const empty = createInspectedLifecycleTuiSnapshot(testAttemptViewResult({ empty: true }));
  assert.equal(empty.presentation.frame.current?.status, "empty");
  assert.throws(
    () => createInspectedLifecycleTuiSnapshot(testStatusResult()),
    /did not return one exact Attempt View result/u,
  );
  assert.throws(
    () => createInspectedLifecycleTuiSnapshot(Object.freeze({
      ...testAttemptViewResult(),
      deliveryId: "another-delivery",
    })),
    /did not bind one exact Delivery identity/u,
  );
});
