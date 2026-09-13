import { z } from "zod/v4";

export const FOUNDATION_DELIVERY_RECOVERY_STEPS = Object.freeze([
  "candidate-sealed",
  "integration-assessed",
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
  "director-decision-authenticated",
  "transaction-effect-intended",
  "transaction-effect-observed",
  "transaction-finalization",
  "store-seal",
  "store-archive",
] as const);

export type FoundationDeliveryRecoveryStep =
  (typeof FOUNDATION_DELIVERY_RECOVERY_STEPS)[number];

export type FoundationRecoveryPair = Readonly<{
  kind: "provider" | "candidate-observation" | "transaction" | "finalization";
  resumesAt: FoundationDeliveryRecoveryStep;
}>;

const FOUNDATION_RECOVERY_KIND_BY_STEP = Object.freeze({
  "candidate-sealed": "finalization",
  "integration-assessed": "finalization",
  "agent-attempt-prepared": "finalization",
  "provider-effect-intended": "finalization",
  "provider-effect-observed": "provider",
  "work-product-observation": "finalization",
  "candidate-revision-observed": "candidate-observation",
  "execution-receipt-recorded": "finalization",
  "work-boundary-finalized": "finalization",
  "baseline-checks": "finalization",
  "evaluation-checks": "finalization",
  "activity-finalization": "finalization",
  "activity-completed": "finalization",
  "director-decision-authenticated": "finalization",
  "transaction-effect-intended": "finalization",
  "transaction-effect-observed": "transaction",
  "transaction-finalization": "finalization",
  "store-seal": "finalization",
  "store-archive": "finalization",
} satisfies Readonly<Record<FoundationRecoveryPair["resumesAt"], FoundationRecoveryPair["kind"]>>);

export function refineRecoveryPair(
  value: FoundationRecoveryPair,
  context: z.RefinementCtx,
): void {
  if (FOUNDATION_RECOVERY_KIND_BY_STEP[value.resumesAt] !== value.kind) {
    context.addIssue({
      code: "custom",
      path: ["resumesAt"],
      message: "Recovery kind and resume step do not name one registered obligation",
    });
  }
}
