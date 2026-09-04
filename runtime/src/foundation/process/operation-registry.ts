import { FoundationError } from "../error.js";
import type {
  DeliveryActivity,
  DeliveryOperation,
  DeliveryStanding,
  DeliveryState,
} from "./delivery-state.js";

export const DELIVERY_OPERATIONS = Object.freeze([
  "delivery.prepare",
  "delivery.admit",
  "delivery.continue",
  "delivery.evaluate",
  "delivery.revise",
  "delivery.reaffirm",
  "delivery.accept",
  "delivery.no-ship",
  "delivery.recover",
] as const satisfies readonly DeliveryOperation[]);

export type DeliveryOperationDescriptor = Readonly<{
  operation: DeliveryOperation;
  actor: "founder";
  input: "none" | "semantic-markdown";
  authority: "none" | "founder-authentication";
  activity: "agent" | "transaction" | "recovery";
  role: "reconnaissance" | "builder" | "reviewer" | null;
  legalStandings: readonly DeliveryStanding[];
  concurrency: "fresh-delivery" | "candidate-exclusive" | "process-exclusive" | "target-exclusive" | "exact-recovery";
  candidateRequirement: "absent" | "present" | "sealed-and-evidenced" | "any";
}>;

function standings(...values: DeliveryStanding[]): readonly DeliveryStanding[] {
  return Object.freeze(values);
}

const DESCRIPTORS = Object.freeze({
  "delivery.prepare": Object.freeze({
    operation: "delivery.prepare",
    actor: "founder",
    input: "semantic-markdown",
    authority: "none",
    activity: "agent",
    role: "reconnaissance",
    legalStandings: standings("framing"),
    concurrency: "fresh-delivery",
    candidateRequirement: "absent",
  }),
  "delivery.admit": Object.freeze({
    operation: "delivery.admit",
    actor: "founder",
    input: "none",
    authority: "founder-authentication",
    activity: "transaction",
    role: null,
    legalStandings: standings("awaiting-admission", "awaiting-readmission"),
    concurrency: "target-exclusive",
    candidateRequirement: "any",
  }),
  "delivery.continue": Object.freeze({
    operation: "delivery.continue",
    actor: "founder",
    input: "semantic-markdown",
    authority: "none",
    activity: "agent",
    role: "builder",
    legalStandings: standings("active"),
    concurrency: "candidate-exclusive",
    candidateRequirement: "present",
  }),
  "delivery.evaluate": Object.freeze({
    operation: "delivery.evaluate",
    actor: "founder",
    input: "semantic-markdown",
    authority: "none",
    activity: "agent",
    role: "reviewer",
    legalStandings: standings("active"),
    concurrency: "candidate-exclusive",
    candidateRequirement: "present",
  }),
  "delivery.revise": Object.freeze({
    operation: "delivery.revise",
    actor: "founder",
    input: "semantic-markdown",
    authority: "none",
    activity: "agent",
    role: "reconnaissance",
    legalStandings: standings("boundary-paused"),
    concurrency: "process-exclusive",
    candidateRequirement: "present",
  }),
  "delivery.reaffirm": Object.freeze({
    operation: "delivery.reaffirm",
    actor: "founder",
    input: "semantic-markdown",
    authority: "none",
    activity: "agent",
    role: "reconnaissance",
    legalStandings: standings("boundary-paused"),
    concurrency: "process-exclusive",
    candidateRequirement: "present",
  }),
  "delivery.accept": Object.freeze({
    operation: "delivery.accept",
    actor: "founder",
    input: "none",
    authority: "founder-authentication",
    activity: "transaction",
    role: null,
    legalStandings: standings("decision-ready"),
    concurrency: "target-exclusive",
    candidateRequirement: "sealed-and-evidenced",
  }),
  "delivery.no-ship": Object.freeze({
    operation: "delivery.no-ship",
    actor: "founder",
    input: "semantic-markdown",
    authority: "founder-authentication",
    activity: "transaction",
    role: null,
    legalStandings: standings(
      "framing",
      "awaiting-admission",
      "active",
      "boundary-paused",
      "awaiting-readmission",
      "decision-ready",
    ),
    concurrency: "target-exclusive",
    candidateRequirement: "any",
  }),
  "delivery.recover": Object.freeze({
    operation: "delivery.recover",
    actor: "founder",
    input: "none",
    authority: "none",
    activity: "recovery",
    role: null,
    legalStandings: standings(
      "framing",
      "awaiting-admission",
      "active",
      "boundary-paused",
      "awaiting-readmission",
      "decision-ready",
      "closed",
    ),
    concurrency: "exact-recovery",
    candidateRequirement: "any",
  }),
} satisfies Readonly<Record<DeliveryOperation, DeliveryOperationDescriptor>>);

export function deliveryOperationDescriptors(): readonly DeliveryOperationDescriptor[] {
  return DELIVERY_OPERATIONS.map((operation) => DESCRIPTORS[operation]);
}

export function deliveryOperationDescriptor(operation: string): DeliveryOperationDescriptor {
  if (!DELIVERY_OPERATIONS.includes(operation as DeliveryOperation)) {
    throw new FoundationError(
      "lifecycle.delivery-operation.operation",
      `Unsupported Delivery operation ${operation}`,
    );
  }
  return DESCRIPTORS[operation as DeliveryOperation];
}

function unresolvedActivities(state: DeliveryState): readonly DeliveryActivity[] {
  return state.activities.filter((activity) => activity.stage !== "completed");
}

function candidateSatisfies(
  descriptor: DeliveryOperationDescriptor,
  state: DeliveryState,
): boolean {
  switch (descriptor.candidateRequirement) {
    case "absent":
      return state.subjects.candidate === null;
    case "present":
      return state.subjects.candidate !== null;
    case "sealed-and-evidenced":
      return state.subjects.candidate !== null && state.subjects.seal !== null && state.subjects.evidence !== null;
    case "any":
      return true;
  }
}

function concurrencyAllows(
  descriptor: DeliveryOperationDescriptor,
  active: readonly DeliveryActivity[],
): boolean {
  if (descriptor.concurrency === "exact-recovery") {
    return active.some((activity) => activity.recovery !== null);
  }
  if (active.some((activity) => activity.recovery !== null)) return false;
  return active.length === 0;
}

export function eligibleDeliveryOperations(state: DeliveryState): readonly DeliveryOperation[] {
  if (state.standing === "closed") return Object.freeze([]);
  const active = unresolvedActivities(state);
  if (active.some((activity) => activity.recovery !== null)) {
    return Object.freeze(["delivery.recover"]);
  }
  const preparation = state.activities.find((activity) => activity.operation === "delivery.prepare");
  return Object.freeze(DELIVERY_OPERATIONS.filter((operation) => {
    const descriptor = DESCRIPTORS[operation];
    if (operation === "delivery.recover") return false;
    if (operation === "delivery.prepare" && preparation !== undefined) return false;
    if (
      operation === "delivery.no-ship" &&
      state.standing === "framing" &&
      preparation?.stage !== "completed"
    ) return false;
    return descriptor.legalStandings.includes(state.standing) &&
      candidateSatisfies(descriptor, state) &&
      concurrencyAllows(descriptor, active);
  }));
}
