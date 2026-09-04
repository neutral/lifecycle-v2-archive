import assert from "node:assert/strict";
import test from "node:test";
import {
  DELIVERY_RECOVERY_STEPS,
  deliveryRecoveryDescriptor,
  deliveryRecoveryDescriptors,
} from "../../src/foundation/process/recovery-registry.js";

test("evaluation sealing is one exact registered recovery boundary", () => {
  assert(DELIVERY_RECOVERY_STEPS.includes("candidate-sealed"));
  assert.equal(deliveryRecoveryDescriptors().length, DELIVERY_RECOVERY_STEPS.length);
  assert.deepEqual(
    deliveryRecoveryDescriptor("finalization", "candidate-sealed"),
    {
      kind: "finalization",
      resumesAt: "candidate-sealed",
      next: { type: "event", eventKinds: ["candidate-sealed"] },
      support: "candidate-carrier",
      lockScope: "candidate",
      idempotence: "exact-record-finalization",
    },
  );
  assert.throws(
    () => deliveryRecoveryDescriptor("candidate-observation", "candidate-sealed"),
    /Unsupported Delivery recovery obligation/u,
  );
});

test("Work Boundary finalization can retain a Boundary or terminate after deterministic refusal", () => {
  assert.deepEqual(
    deliveryRecoveryDescriptor("finalization", "work-boundary-finalized"),
    {
      kind: "finalization",
      resumesAt: "work-boundary-finalized",
      next: { type: "event", eventKinds: ["work-boundary-finalized", "activity-completed"] },
      support: "boundary-compiler",
      lockScope: "delivery",
      idempotence: "exact-record-finalization",
    },
  );
});
