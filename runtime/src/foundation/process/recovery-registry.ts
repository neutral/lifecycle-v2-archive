import {
  type FoundationDeliveryRecoveryStep,
} from "@neutral/lifecycle-protocol";
import { FoundationError } from "../error.js";
import type { DeliveryRecoveryObligation } from "./delivery-state.js";

export const DELIVERY_RECOVERY_STEPS = Object.freeze([
  "candidate-sealed",
  "agent-attempt-prepared",
  "provider-effect-intended",
  "provider-effect-observed",
  "work-product-observation",
  "candidate-revision-observed",
  "execution-receipt-recorded",
  "work-boundary-finalized",
  "baseline-checks",
  "evaluation-checks",
  "activity-finalization",
  "activity-completed",
  "founder-decision-authenticated",
  "transaction-effect-intended",
  "transaction-effect-observed",
  "transaction-finalization",
  "store-seal",
  "store-archive",
] as const satisfies readonly FoundationDeliveryRecoveryStep[]);

export type DeliveryRecoveryStep = FoundationDeliveryRecoveryStep;

export type DeliveryRecoveryDescriptor = Readonly<{
  kind: DeliveryRecoveryObligation["kind"];
  resumesAt: DeliveryRecoveryStep;
  next: Readonly<
    | { type: "event"; eventKinds: readonly string[] }
    | { type: "physical"; action: "store-seal" | "store-archive" }
  >;
  support:
    | "attempt-compiler"
    | "provider-planner"
    | "provider-observation"
    | "execution-output"
    | "candidate-carrier"
    | "attempt-observation"
    | "boundary-compiler"
    | "check-execution"
    | "activity-compiler"
    | "authority-compiler"
    | "transaction-planner"
    | "transaction-observation"
    | "transaction-finalizer"
    | "store-custody";
  lockScope: "delivery" | "candidate" | "target";
  idempotence:
    | "exact-effect-observation"
    | "exact-effect-intent"
    | "exact-candidate-revision"
    | "exact-record-finalization"
    | "exact-transaction-observation"
    | "exact-physical-disposition";
}>;

function descriptor(
  value: DeliveryRecoveryDescriptor,
): DeliveryRecoveryDescriptor {
  return Object.freeze({
    ...value,
    next: value.next.type === "event"
      ? Object.freeze({ type: "event", eventKinds: Object.freeze([...value.next.eventKinds]) })
      : Object.freeze({ ...value.next }),
  });
}

const DESCRIPTORS = Object.freeze([
  descriptor({
    kind: "finalization",
    resumesAt: "candidate-sealed",
    next: { type: "event", eventKinds: ["candidate-sealed"] },
    support: "candidate-carrier",
    lockScope: "candidate",
    idempotence: "exact-record-finalization",
  }),
  descriptor({
    kind: "finalization",
    resumesAt: "agent-attempt-prepared",
    next: { type: "event", eventKinds: ["agent-attempt-prepared", "agent-pre-intent-refused"] },
    support: "attempt-compiler",
    lockScope: "delivery",
    idempotence: "exact-record-finalization",
  }),
  descriptor({
    kind: "finalization",
    resumesAt: "provider-effect-intended",
    next: { type: "event", eventKinds: ["provider-effect-intended"] },
    support: "provider-planner",
    lockScope: "delivery",
    idempotence: "exact-effect-intent",
  }),
  descriptor({
    kind: "provider",
    resumesAt: "provider-effect-observed",
    next: { type: "event", eventKinds: ["provider-effect-observed"] },
    support: "provider-observation",
    lockScope: "delivery",
    idempotence: "exact-effect-observation",
  }),
  descriptor({
    kind: "finalization",
    resumesAt: "work-product-observation",
    next: {
      type: "event",
      eventKinds: ["agent-work-product-submitted", "agent-work-product-abandoned"],
    },
    support: "execution-output",
    lockScope: "delivery",
    idempotence: "exact-record-finalization",
  }),
  descriptor({
    kind: "candidate-observation",
    resumesAt: "candidate-revision-observed",
    next: { type: "event", eventKinds: ["candidate-revision-observed"] },
    support: "candidate-carrier",
    lockScope: "candidate",
    idempotence: "exact-candidate-revision",
  }),
  descriptor({
    kind: "finalization",
    resumesAt: "execution-receipt-recorded",
    next: { type: "event", eventKinds: ["execution-receipt-recorded"] },
    support: "attempt-observation",
    lockScope: "delivery",
    idempotence: "exact-record-finalization",
  }),
  descriptor({
    kind: "finalization",
    resumesAt: "work-boundary-finalized",
    next: { type: "event", eventKinds: ["work-boundary-finalized", "activity-completed"] },
    support: "boundary-compiler",
    lockScope: "delivery",
    idempotence: "exact-record-finalization",
  }),
  descriptor({
    kind: "finalization",
    resumesAt: "baseline-checks",
    next: { type: "event", eventKinds: ["check-receipt-recorded", "activity-completed"] },
    support: "check-execution",
    lockScope: "delivery",
    idempotence: "exact-record-finalization",
  }),
  descriptor({
    kind: "finalization",
    resumesAt: "evaluation-checks",
    next: {
      type: "event",
      eventKinds: ["check-receipt-recorded", "agent-attempt-prepared", "agent-pre-intent-refused"],
    },
    support: "check-execution",
    lockScope: "candidate",
    idempotence: "exact-record-finalization",
  }),
  descriptor({
    kind: "finalization",
    resumesAt: "activity-finalization",
    next: {
      type: "event",
      eventKinds: [
        "check-receipt-recorded",
        "material-condition-frozen",
        "evidence-packet-finalized",
        "activity-completed",
      ],
    },
    support: "activity-compiler",
    lockScope: "delivery",
    idempotence: "exact-record-finalization",
  }),
  descriptor({
    kind: "finalization",
    resumesAt: "activity-completed",
    next: { type: "event", eventKinds: ["activity-completed"] },
    support: "activity-compiler",
    lockScope: "delivery",
    idempotence: "exact-record-finalization",
  }),
  descriptor({
    kind: "finalization",
    resumesAt: "founder-decision-authenticated",
    next: { type: "event", eventKinds: ["founder-decision-authenticated"] },
    support: "authority-compiler",
    lockScope: "target",
    idempotence: "exact-record-finalization",
  }),
  descriptor({
    kind: "finalization",
    resumesAt: "transaction-effect-intended",
    next: { type: "event", eventKinds: ["transaction-effect-intended"] },
    support: "transaction-planner",
    lockScope: "target",
    idempotence: "exact-effect-intent",
  }),
  descriptor({
    kind: "transaction",
    resumesAt: "transaction-effect-observed",
    next: { type: "event", eventKinds: ["transaction-effect-observed"] },
    support: "transaction-observation",
    lockScope: "target",
    idempotence: "exact-transaction-observation",
  }),
  descriptor({
    kind: "finalization",
    resumesAt: "transaction-finalization",
    next: {
      type: "event",
      eventKinds: ["candidate-revision-observed", "activity-completed", "closure-recorded"],
    },
    support: "transaction-finalizer",
    lockScope: "target",
    idempotence: "exact-record-finalization",
  }),
  descriptor({
    kind: "finalization",
    resumesAt: "store-seal",
    next: { type: "physical", action: "store-seal" },
    support: "store-custody",
    lockScope: "target",
    idempotence: "exact-physical-disposition",
  }),
  descriptor({
    kind: "finalization",
    resumesAt: "store-archive",
    next: { type: "physical", action: "store-archive" },
    support: "store-custody",
    lockScope: "target",
    idempotence: "exact-physical-disposition",
  }),
] as const satisfies readonly DeliveryRecoveryDescriptor[]);

const BY_KEY = new Map<string, DeliveryRecoveryDescriptor>(
  DESCRIPTORS.map((value) => [`${value.kind}\u0000${value.resumesAt}`, value]),
);

export function deliveryRecoveryDescriptors(): readonly DeliveryRecoveryDescriptor[] {
  return DESCRIPTORS;
}

export function deliveryRecoveryDescriptor(
  kind: DeliveryRecoveryObligation["kind"],
  resumesAt: string,
): DeliveryRecoveryDescriptor {
  const value = BY_KEY.get(`${kind}\u0000${resumesAt}`);
  if (value === undefined) {
    throw new FoundationError(
      "lifecycle.delivery-recovery.step",
      `Unsupported Delivery recovery obligation ${kind}/${resumesAt}`,
    );
  }
  return value;
}
