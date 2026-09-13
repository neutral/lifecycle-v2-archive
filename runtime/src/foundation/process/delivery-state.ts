import { digestCanonical, type Sha256 } from "../validation/canonical.js";
import type { DeliveryRecoveryStep } from "./recovery-registry.js";
import type { WorkDelegationAccounting } from "../control/work-delegation.js";

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

export type DeliveryActivityFamily = "agent" | "integration" | "transaction";

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
  integrationAssessment: Readonly<{ id: string; revision: number; digest: Sha256 }> | null;
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
  delegation: Readonly<{
    admission: Readonly<{ id: string; revision: number; digest: Sha256 }> | null;
    current: Readonly<{
      reference: Readonly<{ id: string; revision: number; digest: Sha256 }>;
      stopped: boolean;
    }> | null;
    charged: WorkDelegationAccounting;
  }>;
  journal: Readonly<{
    eventCount: number;
    headDigest: Sha256 | null;
  }>;
}>;

export type DeliveryOperation =
  | "delivery.prepare"
  | "delivery.admit"
  | "delivery.continue"
  | "delivery.integrate"
  | "delivery.evaluate"
  | "delivery.revise"
  | "delivery.reaffirm"
  | "delivery.accept"
  | "delivery.no-ship"
  | "delivery.recover";

/** Exact settled facts used by the fixed resource caller, never a permission. */
export function deliveryWorkDecisionBasisDigest(state: DeliveryState): Sha256 {
  return digestCanonical({
    schema: "lifecycle.delivery-work-decision-basis.v1",
    journal: state.journal,
    subjects: state.subjects,
    delegation: state.delegation,
    standing: state.standing,
    candidateCondition: state.candidateCondition,
  });
}

export function initialDeliveryState(): DeliveryState {
  return Object.freeze({
    standing: "framing",
    candidateCondition: "absent",
    activities: Object.freeze([]),
    subjects: Object.freeze({
      proposedBoundary: null,
      activeBoundary: null,
      integrationAssessment: null,
      candidate: null,
      materialCondition: null,
      seal: null,
      evidence: null,
      closure: null,
    }),
    delegation: Object.freeze({ admission: null, current: null,
      charged: Object.freeze({ operations: 0, agentAttempts: 0, reservedCellWallTimeMs: 0 }) }),
    journal: Object.freeze({ eventCount: 0, headDigest: null }),
  });
}
