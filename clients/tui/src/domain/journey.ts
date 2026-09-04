import type {
  FoundationDeliveryOperation,
  FoundationRuntimeObservation,
} from "@neutral/lifecycle-protocol";

export const FOUNDATION_TUI_PHASES = Object.freeze([
  Object.freeze({ id: "setup", label: "Setup" }),
  Object.freeze({ id: "frame", label: "Frame" }),
  Object.freeze({ id: "admit", label: "Admit" }),
  Object.freeze({ id: "work", label: "Work" }),
  Object.freeze({ id: "resolve", label: "Resolve" }),
  Object.freeze({ id: "prove", label: "Prove" }),
  Object.freeze({ id: "close", label: "Close" }),
] as const);

export type FoundationTuiPhaseId = typeof FOUNDATION_TUI_PHASES[number]["id"];
export type FoundationTuiExactState =
  | "uninitialized"
  | NonNullable<FoundationRuntimeObservation["delivery"]>["standing"];
export type FoundationTuiJourney = Readonly<{
  currentPhase: FoundationTuiPhaseId;
  currentPhaseLabel: string;
  phasePosition: number;
  rail: readonly Readonly<{
    id: FoundationTuiPhaseId;
    label: string;
    position: number;
    current: boolean;
  }>[];
  exactState: FoundationTuiExactState;
  stateGeneration: number;
  exactStateLabel: string;
  stateExplanation: string;
  activity: "available" | "runtime-working" | "founder-decision" | "recovery" | "closed";
  attentionOwner: "caller" | "founder" | "runtime" | "none";
  phaseBasis: "delivery-standing" | "activity" | "recovery";
  overlay: null;
}>;

type Delivery = NonNullable<FoundationRuntimeObservation["delivery"]>;
type Activity = Delivery["activities"][number];

function currentActivity(delivery: Delivery): Activity | null {
  return [...delivery.activities].reverse().find(({ stage }) => stage !== "completed") ?? null;
}

function operationPhase(operation: FoundationDeliveryOperation): FoundationTuiPhaseId {
  switch (operation) {
    case "delivery.prepare": return "frame";
    case "delivery.admit": return "admit";
    case "delivery.continue": return "work";
    case "delivery.evaluate": return "prove";
    case "delivery.revise":
    case "delivery.reaffirm": return "resolve";
    case "delivery.accept":
    case "delivery.no-ship": return "close";
    case "delivery.recover": return "resolve";
  }
}

function standingPhase(delivery: Delivery): FoundationTuiPhaseId {
  switch (delivery.standing) {
    case "framing": return "frame";
    case "awaiting-admission": return "admit";
    case "boundary-paused":
    case "awaiting-readmission": return "resolve";
    case "decision-ready": return "close";
    case "closed": return "close";
    case "active": return "work";
  }
}

function activityPhase(delivery: Delivery, activity: Activity): FoundationTuiPhaseId {
  if (activity.operation === "delivery.admit" && delivery.standing === "awaiting-readmission") {
    return "resolve";
  }
  return operationPhase(activity.operation);
}

function recoveryActivity(delivery: Delivery): Activity | null {
  const recovery = delivery.recovery;
  if (recovery === null || recovery.activityId === null) return null;
  return delivery.activities.find(({ id }) => id === recovery.activityId) ?? null;
}

function phase(observation: FoundationRuntimeObservation): Readonly<{
  id: FoundationTuiPhaseId;
  basis: FoundationTuiJourney["phaseBasis"];
}> {
  const delivery = observation.delivery;
  if (!observation.repository.initialized) {
    return Object.freeze({ id: "setup", basis: "delivery-standing" });
  }
  if (delivery === null) return Object.freeze({ id: "frame", basis: "delivery-standing" });
  if (delivery.recovery !== null) {
    if (delivery.recovery.scope === "store-disposition") {
      return Object.freeze({ id: "close", basis: "recovery" });
    }
    const activity = recoveryActivity(delivery);
    return Object.freeze({
      id: activity === null ? standingPhase(delivery) : activityPhase(delivery, activity),
      basis: "recovery",
    });
  }
  const activity = currentActivity(delivery);
  if (activity !== null) {
    return Object.freeze({ id: activityPhase(delivery, activity), basis: "activity" });
  }
  return Object.freeze({ id: standingPhase(delivery), basis: "delivery-standing" });
}

function attention(delivery: Delivery | null): Readonly<{
  activity: FoundationTuiJourney["activity"];
  owner: FoundationTuiJourney["attentionOwner"];
}> {
  if (delivery === null) return Object.freeze({ activity: "available", owner: "caller" });
  if (delivery.recovery !== null) return Object.freeze({ activity: "recovery", owner: "runtime" });
  if (delivery.standing === "closed") return Object.freeze({ activity: "closed", owner: "none" });
  if (currentActivity(delivery) !== null) {
    return Object.freeze({ activity: "runtime-working", owner: "runtime" });
  }
  if (
    delivery.standing === "awaiting-admission" ||
    delivery.standing === "awaiting-readmission" ||
    delivery.standing === "decision-ready"
  ) {
    return Object.freeze({ activity: "founder-decision", owner: "founder" });
  }
  return Object.freeze({ activity: "available", owner: "caller" });
}

function explanation(delivery: Delivery | null): string {
  if (delivery === null) {
    return "No Delivery exists yet. One complete fresh brief starts reconnaissance.";
  }
  if (delivery.recovery !== null) {
    return `Recovery resumes only the exact ${delivery.recovery.resumesAt} obligation.`;
  }
  const activity = currentActivity(delivery);
  if (activity !== null) {
    return `${activity.operation} is at its exact ${activity.stage} activity stage.`;
  }
  return `The runtime derives ${delivery.candidateCondition} from the exact Delivery Journal and Control records.`;
}

export function deriveFoundationTuiJourney(
  observation: FoundationRuntimeObservation,
): FoundationTuiJourney {
  const delivery = observation.delivery;
  const selected = phase(observation);
  const position = FOUNDATION_TUI_PHASES.findIndex(({ id }) => id === selected.id) + 1;
  const attentionState = attention(delivery);
  const exactState = delivery?.standing ?? "uninitialized";
  return Object.freeze({
    currentPhase: selected.id,
    currentPhaseLabel: FOUNDATION_TUI_PHASES[position - 1]!.label,
    phasePosition: position,
    rail: Object.freeze(FOUNDATION_TUI_PHASES.map((entry, index) => Object.freeze({
      ...entry,
      position: index + 1,
      current: entry.id === selected.id,
    }))),
    exactState,
    stateGeneration: delivery?.journal.eventCount ?? 0,
    exactStateLabel: exactState.replaceAll("-", " "),
    stateExplanation: explanation(delivery),
    activity: attentionState.activity,
    attentionOwner: attentionState.owner,
    phaseBasis: selected.basis,
    overlay: null,
  });
}
