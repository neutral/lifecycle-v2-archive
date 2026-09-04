import type { Sha256 } from "../validation/canonical.js";
import type { DeliveryRecoveryStep } from "./recovery-registry.js";

export const DELIVERY_STANDINGS = Object.freeze([
  "framing",
  "awaiting-admission",
  "active",
  "boundary-paused",
  "awaiting-readmission",
  "decision-ready",
  "closed",
] as const);

export type DeliveryStanding = typeof DELIVERY_STANDINGS[number];

export const DELIVERY_CANDIDATE_CONDITIONS = Object.freeze([
  "absent",
  "ready-for-work",
  "in-progress",
  "needs-correction",
  "paused-for-boundary",
  "sealed-under-evaluation",
  "ready-for-decision",
  "terminal-recovery",
  "accepted",
  "abandoned",
] as const);

export type DeliveryCandidateCondition = typeof DELIVERY_CANDIDATE_CONDITIONS[number];

export type DeliveryActivityFamily = "agent" | "transaction";

export type DeliveryActivityStage =
  | "started"
  | "prepared"
  | "effect-intended"
  | "effect-observed"
  | "submitted"
  | "finalizing"
  | "completed";

export type DeliveryRecoveryObligation = Readonly<{
  kind: "provider" | "candidate-observation" | "transaction" | "finalization";
  resumesAt: DeliveryRecoveryStep;
  exactEffectDigest: Sha256 | null;
}>;

export type DeliveryActivity = Readonly<{
  id: string;
  operation: DeliveryOperation;
  family: DeliveryActivityFamily;
  stage: DeliveryActivityStage;
  recovery: DeliveryRecoveryObligation | null;
}>;

export type DeliveryCurrentSubjects = Readonly<{
  proposedBoundary: Readonly<{ id: string; revision: number; digest: Sha256 }> | null;
  activeBoundary: Readonly<{ id: string; revision: number; digest: Sha256 }> | null;
  candidate: Readonly<{ id: string; revision: number; digest: Sha256 }> | null;
  materialCondition: Readonly<{ id: string; revision: number; digest: Sha256 }> | null;
  seal: Readonly<{ id: string; revision: number; digest: Sha256 }> | null;
  evidence: Readonly<{ id: string; revision: number; digest: Sha256 }> | null;
  closure: Readonly<{ id: string; revision: number; digest: Sha256 }> | null;
}>;

export type DeliveryState = Readonly<{
  standing: DeliveryStanding;
  candidateCondition: DeliveryCandidateCondition;
  activities: readonly DeliveryActivity[];
  subjects: DeliveryCurrentSubjects;
  journal: Readonly<{
    eventCount: number;
    headDigest: Sha256 | null;
  }>;
}>;

export type DeliveryOperation =
  | "delivery.prepare"
  | "delivery.admit"
  | "delivery.continue"
  | "delivery.evaluate"
  | "delivery.revise"
  | "delivery.reaffirm"
  | "delivery.accept"
  | "delivery.no-ship"
  | "delivery.recover";

export function initialDeliveryState(): DeliveryState {
  return Object.freeze({
    standing: "framing",
    candidateCondition: "absent",
    activities: Object.freeze([]),
    subjects: Object.freeze({
      proposedBoundary: null,
      activeBoundary: null,
      candidate: null,
      materialCondition: null,
      seal: null,
      evidence: null,
      closure: null,
    }),
    journal: Object.freeze({ eventCount: 0, headDigest: null }),
  });
}
