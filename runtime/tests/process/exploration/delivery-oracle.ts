import type {
  ExplorationClause,
  ExplorationFinding,
  TransitionExpectation,
} from "./bounded-explorer.js";
import { deliveryProperties } from "./delivery-properties.js";

const RECOVER_ONLY = Object.freeze(["delivery.recover"]);
const ACTIVE_OPERATIONS = Object.freeze([
  "delivery.continue",
  "delivery.integrate",
  "delivery.evaluate",
  "delivery.no-ship",
]);
const UNINTEGRATED_ACTIVE_OPERATIONS = Object.freeze(["delivery.continue", "delivery.integrate", "delivery.no-ship"]);
const AWAITING_ADMISSION_OPERATIONS = Object.freeze([
  "delivery.admit",
  "delivery.no-ship",
]);
const BOUNDARY_PAUSED_OPERATIONS = Object.freeze([
  "delivery.revise",
  "delivery.reaffirm",
  "delivery.no-ship",
]);
const AWAITING_READMISSION_OPERATIONS = Object.freeze([
  "delivery.admit",
  "delivery.no-ship",
]);
const DECISION_READY_OPERATIONS = Object.freeze([
  "delivery.integrate",
  "delivery.accept",
  "delivery.no-ship",
]);
const FRESH_FRAMING_OPERATIONS = Object.freeze([
  "delivery.prepare",
]);
const NO_SHIP_ONLY = Object.freeze(["delivery.no-ship"]);
const NO_OPERATIONS = Object.freeze([]) as readonly string[];

type SubjectName =
  | "proposedBoundary"
  | "activeBoundary"
  | "integrationAssessment"
  | "candidate"
  | "materialCondition"
  | "seal"
  | "evidence"
  | "closure";

type ExpectedActivityStage =
  | "started"
  | "prepared"
  | "effect-intended"
  | "effect-observed"
  | "submitted"
  | "finalizing";

type RecoveryEffectBinding = "none" | "model-effect";

export type DeliveryExpectedProfile = Readonly<{
  standing: string | null;
  candidateCondition: string;
  recovery: string | null;
  activeActivityCount: number;
  activeOperation?: string;
  activeFamily?: "agent" | "integration" | "transaction";
  activeStage?: ExpectedActivityStage;
  recoveryEffectBinding?: RecoveryEffectBinding;
  subjects: Readonly<Partial<Record<SubjectName, boolean>>>;
  eligibleOperations?: readonly string[];
}>;

export type DeliveryOracleModel = Readonly<{
  kind: "preparation" | "admission" | "no-ship" | "route-opening" | "progression" | "integration" | "pre-intent-refusal";
  phase: string;
  candidatePresent: boolean;
  candidateIntegrated?: boolean;
  originStanding?:
    | "framing"
    | "awaiting-admission"
    | "active"
    | "boundary-paused"
    | "awaiting-readmission"
    | "decision-ready";
  boundaryKind?: "none" | "proposed" | "active" | "active-and-proposed";
  effectDigest?: string;
  profile?: DeliveryExpectedProfile;
}>;

export type DeliveryOracleCommand = Readonly<{
  id: string;
  expectation(model: DeliveryOracleModel): TransitionExpectation<DeliveryOracleModel>;
}>;

export type DeliveryOracle = Readonly<{
  id: string;
  clauses: readonly ExplorationClause[];
  bounds: Readonly<{
    maxDepth: number;
    maxNodes: number;
    maxTransitions: number;
  }>;
  requiredCoverage: Readonly<{
    phases: readonly string[];
    acceptedCommands: readonly string[];
    eventKinds: readonly string[];
    seedEventKinds: readonly string[];
    generatedEventKinds: readonly string[];
    recoveryCoordinates: readonly string[];
  }>;
  initialModel: DeliveryOracleModel;
  commands: readonly DeliveryOracleCommand[];
}>;

type NormalizedSubject = Readonly<{
  id: string;
  revision: number;
  digest: string;
}>;

export type DeliveryObservation = Readonly<{
  standing: string;
  candidateCondition: string;
  activities: readonly Readonly<{
    id: string;
    operation: string;
    family: string;
    stage: string;
    recovery: Readonly<{
      kind: string;
      resumesAt: string;
      exactEffectDigest: string | null;
    }> | null;
  }>[];
  subjects: Readonly<Record<SubjectName, NormalizedSubject | null>>;
  eligibleOperations: readonly string[];
  journal: Readonly<{ eventCount: number }>;
  eventKinds: readonly string[];
}>;

type PhaseChanges = string | Partial<DeliveryOracleModel>;

const REFUSAL = Object.freeze({
  activity: "lifecycle.delivery-reducer.activity",
  duplicate: "lifecycle.delivery-reducer.duplicate",
  eligibility: "lifecycle.delivery-reducer.eligibility",
  order: "lifecycle.delivery-reducer.order",
  recovery: "lifecycle.delivery-reducer.recovery",
  reference: "lifecycle.delivery-reducer.reference",
  terminal: "lifecycle.delivery-reducer.terminal",
});

type RefusalCode = typeof REFUSAL[keyof typeof REFUSAL];

function expectedCommand(
  id: string,
  byPhase: Readonly<Record<string, PhaseChanges>>,
  refused: (model: DeliveryOracleModel) => RefusalCode,
): DeliveryOracleCommand {
  return Object.freeze({
    id,
    expectation(model: DeliveryOracleModel): TransitionExpectation<DeliveryOracleModel> {
      const selected = byPhase[model.phase];
      if (selected === undefined) {
        return Object.freeze({ kind: "refused", classes: Object.freeze([refused(model)]) });
      }
      const changes = typeof selected === "string" ? { phase: selected } : selected;
      return Object.freeze({
        kind: "accepted",
        next: Object.freeze({ ...model, ...changes }),
      });
    },
  });
}

function unexpectedOraclePhase(kind: string, command: string, phase: string): never {
  throw new TypeError(`No ${kind} refusal expectation for ${command} in phase ${phase}`);
}

function preparationRefusal(model: DeliveryOracleModel): RefusalCode {
  return unexpectedOraclePhase("preparation", "record-prepare-recovery", model.phase);
}

function admissionRefusal(command: string, model: DeliveryOracleModel): RefusalCode {
  const phase = model.phase;
  if (phase === "active" || phase === "retryable") return REFUSAL.activity;
  if (command === "authenticate") return REFUSAL.duplicate;

  if (phase === "started") {
    if (command === "observe-candidate") return REFUSAL.activity;
    if (["complete-failed", "complete-success"].includes(command)) return REFUSAL.order;
    if (["intend", "observe-applied", "observe-indeterminate", "observe-not-applied"]
      .includes(command)) return REFUSAL.reference;
    return REFUSAL.recovery;
  }

  if (phase === "authorized") {
    if (["complete-failed", "complete-success", "observe-candidate"].includes(command)) {
      return REFUSAL.order;
    }
    if (["observe-applied", "observe-indeterminate", "observe-not-applied"]
      .includes(command)) return REFUSAL.reference;
    return REFUSAL.recovery;
  }

  if (phase === "intended") {
    if (["complete-failed", "complete-success", "intend", "observe-candidate"]
      .includes(command)) return REFUSAL.order;
    return REFUSAL.recovery;
  }

  if (phase === "applied-awaiting-candidate") {
    if (["complete-failed", "complete-success", "intend"].includes(command)) {
      return REFUSAL.order;
    }
    if (["observe-applied", "observe-indeterminate", "observe-not-applied"]
      .includes(command)) return REFUSAL.duplicate;
    return REFUSAL.recovery;
  }

  if (phase === "not-applied-awaiting-completion") {
    if (["complete-success", "intend", "observe-candidate"].includes(command)) {
      return REFUSAL.order;
    }
    if (["observe-applied", "observe-indeterminate", "observe-not-applied"]
      .includes(command)) return REFUSAL.duplicate;
    return REFUSAL.recovery;
  }

  if (phase === "candidate-observed") {
    if (["observe-applied", "observe-candidate", "observe-indeterminate", "observe-not-applied"]
      .includes(command)) return REFUSAL.duplicate;
    if (["complete-failed", "intend"].includes(command)) return REFUSAL.order;
    return REFUSAL.recovery;
  }

  return unexpectedOraclePhase("admission", command, phase);
}

function noShipRefusal(command: string, model: DeliveryOracleModel): RefusalCode {
  const phase = model.phase;
  if (phase === "closed") return REFUSAL.terminal;
  if (phase === "retryable") return REFUSAL.activity;
  if (phase === "started") {
    if (["intend", "observe-applied", "observe-indeterminate", "observe-not-applied"]
      .includes(command)) return REFUSAL.reference;
    if (command === "complete-failed" || command === "record-closure") {
      return REFUSAL.order;
    }
    return REFUSAL.recovery;
  }
  if (phase === "authorized") {
    if (command === "authenticate") return REFUSAL.duplicate;
    if (["observe-applied", "observe-indeterminate", "observe-not-applied"]
      .includes(command)) return REFUSAL.reference;
    if (command === "complete-failed" || command === "record-closure") {
      return REFUSAL.order;
    }
    return REFUSAL.recovery;
  }
  if (phase === "uncertain") {
    if (command === "authenticate") return REFUSAL.duplicate;
    if (command === "intend") return REFUSAL.order;
    if (command === "complete-failed" || command === "record-closure") {
      return REFUSAL.order;
    }
    return REFUSAL.recovery;
  }
  if (phase === "applied") {
    if (command === "authenticate") return REFUSAL.duplicate;
    if (command === "intend") return REFUSAL.order;
    if (["observe-applied", "observe-indeterminate", "observe-not-applied"]
      .includes(command)) return REFUSAL.duplicate;
    if (command === "complete-failed") return REFUSAL.order;
    return REFUSAL.recovery;
  }
  if (phase === "not-applied") {
    if (command === "authenticate") return REFUSAL.duplicate;
    if (command === "intend") return REFUSAL.order;
    if (["observe-applied", "observe-indeterminate", "observe-not-applied"]
      .includes(command)) return REFUSAL.duplicate;
    if (command === "record-closure") return REFUSAL.order;
    return REFUSAL.recovery;
  }
  return unexpectedOraclePhase("no-ship", command, phase);
}

function transitions(
  entries: readonly (readonly [string, PhaseChanges])[],
): Readonly<Record<string, PhaseChanges>> {
  return Object.freeze(Object.fromEntries(entries));
}

const PREPARATION_COMMANDS = Object.freeze([
  expectedCommand("record-prepare-recovery", transitions([
    ["started", "started"],
  ]), preparationRefusal),
]);

const ADMISSION_COMMANDS = Object.freeze([
  expectedCommand("record-decision-recovery", transitions([
    ["started", "started"],
  ]), (model) => admissionRefusal("record-decision-recovery", model)),
  expectedCommand("authenticate", transitions([
    ["started", "authorized"],
  ]), (model) => admissionRefusal("authenticate", model)),
  expectedCommand("record-intent-recovery", transitions([
    ["authorized", "authorized"],
  ]), (model) => admissionRefusal("record-intent-recovery", model)),
  expectedCommand("intend", transitions([
    ["authorized", "intended"],
  ]), (model) => admissionRefusal("intend", model)),
  expectedCommand("record-observation-recovery", transitions([
    ["intended", "intended"],
  ]), (model) => admissionRefusal("record-observation-recovery", model)),
  expectedCommand("observe-indeterminate", transitions([
    ["intended", "intended"],
  ]), (model) => admissionRefusal("observe-indeterminate", model)),
  expectedCommand("observe-applied", transitions([
    ["intended", "applied-awaiting-candidate"],
  ]), (model) => admissionRefusal("observe-applied", model)),
  expectedCommand("observe-not-applied", transitions([
    ["intended", "not-applied-awaiting-completion"],
  ]), (model) => admissionRefusal("observe-not-applied", model)),
  expectedCommand("record-candidate-recovery", transitions([
    ["applied-awaiting-candidate", "applied-awaiting-candidate"],
  ]), (model) => admissionRefusal("record-candidate-recovery", model)),
  expectedCommand("observe-candidate", transitions([
    ["applied-awaiting-candidate", Object.freeze({
      phase: "candidate-observed",
      candidatePresent: true,
    })],
  ]), (model) => admissionRefusal("observe-candidate", model)),
  expectedCommand("record-completion-recovery", transitions([
    ["candidate-observed", "candidate-observed"],
    ["not-applied-awaiting-completion", "not-applied-awaiting-completion"],
  ]), (model) => admissionRefusal("record-completion-recovery", model)),
  expectedCommand("complete-success", transitions([
    ["candidate-observed", "active"],
  ]), (model) => admissionRefusal("complete-success", model)),
  expectedCommand("complete-failed", transitions([
    ["not-applied-awaiting-completion", "retryable"],
  ]), (model) => admissionRefusal("complete-failed", model)),
]);

const NO_SHIP_COMMANDS = Object.freeze([
  expectedCommand("authenticate", transitions([
    ["started", "authorized"],
  ]), (model) => noShipRefusal("authenticate", model)),
  expectedCommand("intend", transitions([
    ["authorized", "uncertain"],
  ]), (model) => noShipRefusal("intend", model)),
  expectedCommand("record-transaction-recovery", transitions([
    ["uncertain", "uncertain"],
  ]), (model) => noShipRefusal("record-transaction-recovery", model)),
  expectedCommand("observe-indeterminate", transitions([
    ["uncertain", "uncertain"],
  ]), (model) => noShipRefusal("observe-indeterminate", model)),
  expectedCommand("observe-applied", transitions([
    ["uncertain", "applied"],
  ]), (model) => noShipRefusal("observe-applied", model)),
  expectedCommand("observe-not-applied", transitions([
    ["uncertain", "not-applied"],
  ]), (model) => noShipRefusal("observe-not-applied", model)),
  expectedCommand("record-finalization-recovery", transitions([
    ["applied", "applied"],
  ]), (model) => noShipRefusal("record-finalization-recovery", model)),
  expectedCommand("record-completion-recovery", transitions([
    ["not-applied", "not-applied"],
  ]), (model) => noShipRefusal("record-completion-recovery", model)),
  expectedCommand("record-closure", transitions([
    ["applied", "closed"],
  ]), (model) => noShipRefusal("record-closure", model)),
  expectedCommand("complete-failed", transitions([
    ["not-applied", "retryable"],
  ]), (model) => noShipRefusal("complete-failed", model)),
]);

function expectedEligibility(model: DeliveryOracleModel): readonly string[] {
  if (model.profile?.eligibleOperations !== undefined) {
    return model.profile.eligibleOperations;
  }
  if (model.kind === "preparation") return RECOVER_ONLY;
  if (model.kind === "admission") {
    if (model.phase === "active") return UNINTEGRATED_ACTIVE_OPERATIONS;
    if (model.phase === "retryable") return AWAITING_ADMISSION_OPERATIONS;
    return RECOVER_ONLY;
  }
  if (model.phase === "closed") return NO_OPERATIONS;
  if (model.phase === "retryable") {
    switch (model.originStanding) {
      case "awaiting-admission": return AWAITING_ADMISSION_OPERATIONS;
      case "active": return model.candidateIntegrated ? ACTIVE_OPERATIONS : UNINTEGRATED_ACTIVE_OPERATIONS;
      case "boundary-paused": return BOUNDARY_PAUSED_OPERATIONS;
      case "awaiting-readmission": return AWAITING_READMISSION_OPERATIONS;
      case "decision-ready": return DECISION_READY_OPERATIONS;
      case "framing": return NO_SHIP_ONLY;
      default: return NO_SHIP_ONLY;
    }
  }
  return RECOVER_ONLY;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  const sortedRight = [...right].sort();
  return left.length === right.length &&
    [...left].sort().every((value, index) => value === sortedRight[index]);
}

function recovery(kind: string, resumesAt: string): string {
  return `${kind}/${resumesAt}`;
}

function expectedProfile(model: DeliveryOracleModel): DeliveryExpectedProfile | null {
  if (model.profile !== undefined) return model.profile;
  if (model.kind === "preparation") {
    return Object.freeze({
      standing: "framing",
      candidateCondition: "absent",
      recovery: recovery("finalization", "agent-attempt-prepared"),
      activeActivityCount: 1,
      activeOperation: "delivery.prepare",
      activeFamily: "agent",
      activeStage: "started",
      recoveryEffectBinding: "none",
      subjects: Object.freeze({
        proposedBoundary: false,
        activeBoundary: false,
        candidate: false,
        closure: false,
      }),
    });
  }

  if (model.kind === "admission") {
    type AdmissionProfile = readonly [
      standing: string | null,
      candidateCondition: string,
      expectedRecovery: string | null,
      activeStage: ExpectedActivityStage | null,
      recoveryEffectBinding: RecoveryEffectBinding | null,
      proposed: boolean,
      active: boolean,
    ];
    const byPhase: Readonly<Record<string, AdmissionProfile>> = {
      started: [
        "awaiting-admission",
        "absent",
        recovery("finalization", "director-decision-authenticated"),
        "started",
        "none",
        true,
        false,
      ],
      authorized: [
        "awaiting-admission",
        "absent",
        recovery("finalization", "transaction-effect-intended"),
        "started",
        "none",
        true,
        false,
      ],
      intended: [
        "awaiting-admission",
        "absent",
        recovery("transaction", "transaction-effect-observed"),
        "effect-intended",
        "model-effect",
        true,
        false,
      ],
      "applied-awaiting-candidate": [
        "active",
        "absent",
        recovery("candidate-observation", "candidate-revision-observed"),
        "effect-observed",
        "none",
        false,
        true,
      ],
      "not-applied-awaiting-completion": [
        "awaiting-admission",
        "absent",
        recovery("finalization", "activity-completed"),
        "effect-observed",
        "none",
        true,
        false,
      ],
      "candidate-observed": [
        "active",
        "terminal-recovery",
        recovery("finalization", "activity-completed"),
        "finalizing",
        "none",
        false,
        true,
      ],
      active: ["active", "ready-for-work", null, null, null, false, true],
      retryable: ["awaiting-admission", "absent", null, null, null, true, false],
    };
    const selected = byPhase[model.phase];
    if (selected === undefined) return null;
    const [
      standing,
      candidateCondition,
      expectedRecovery,
      activeStage,
      recoveryEffectBinding,
      proposed,
      active,
    ] = selected;
    return Object.freeze({
      standing,
      candidateCondition,
      recovery: expectedRecovery,
      activeActivityCount: ["active", "retryable"].includes(model.phase) ? 0 : 1,
      activeOperation: ["active", "retryable"].includes(model.phase)
        ? undefined
        : "delivery.admit",
      activeFamily: ["active", "retryable"].includes(model.phase)
        ? undefined
        : "transaction",
      activeStage: activeStage ?? undefined,
      recoveryEffectBinding: recoveryEffectBinding ?? undefined,
      subjects: Object.freeze({
        proposedBoundary: proposed,
        activeBoundary: active,
        candidate: model.candidatePresent,
        closure: false,
      }),
    });
  }

  const terminal = model.phase === "closed";
  const retryable = model.phase === "retryable";
  const recoveryByPhase: Readonly<Record<string, string | null>> = {
    started: recovery("finalization", "director-decision-authenticated"),
    authorized: recovery("finalization", "transaction-effect-intended"),
    uncertain: recovery("transaction", "transaction-effect-observed"),
    applied: recovery("finalization", "transaction-finalization"),
    "not-applied": recovery("finalization", "activity-completed"),
    retryable: null,
    closed: null,
  };
  const activeStageByPhase: Readonly<Record<string, ExpectedActivityStage | null>> = {
    started: "started",
    authorized: "started",
    uncertain: "effect-intended",
    applied: "effect-observed",
    "not-applied": "effect-observed",
    retryable: null,
    closed: null,
  };
  const retryableCandidateCondition = model.candidatePresent
    ? model.originStanding === "boundary-paused" ||
        model.originStanding === "awaiting-readmission"
      ? "paused-for-boundary"
      : model.originStanding === "decision-ready"
        ? "ready-for-decision"
        : "ready-for-work"
    : "absent";
  const preIntent = model.phase === "started" || model.phase === "authorized";
  const candidateCondition = terminal
    ? (model.candidatePresent ? "abandoned" : "absent")
    : retryable
      ? retryableCandidateCondition
      : (model.candidatePresent
          ? preIntent ? "in-progress" : "terminal-recovery"
          : "absent");
  const expectedRecovery = recoveryByPhase[model.phase];
  const activeStage = activeStageByPhase[model.phase];
  if (expectedRecovery === undefined || activeStage === undefined) return null;
  return Object.freeze({
    standing: terminal ? "closed" : (model.originStanding ?? null),
    candidateCondition,
    recovery: expectedRecovery,
    activeActivityCount: terminal || retryable ? 0 : 1,
    activeOperation: terminal || retryable ? undefined : "delivery.no-ship",
    activeFamily: terminal || retryable ? undefined : "transaction",
    activeStage: activeStage ?? undefined,
    recoveryEffectBinding: expectedRecovery === null
      ? undefined
      : model.phase === "uncertain" ? "model-effect" : "none",
    subjects: Object.freeze({
      integrationAssessment: model.candidateIntegrated ?? false,
      proposedBoundary: model.boundaryKind === "proposed" ||
        model.boundaryKind === "active-and-proposed",
      activeBoundary: model.boundaryKind === "active" ||
        model.boundaryKind === "active-and-proposed",
      candidate: model.candidatePresent,
      materialCondition: model.originStanding === "boundary-paused" ||
        model.originStanding === "awaiting-readmission",
      seal: model.originStanding === "decision-ready",
      evidence: model.originStanding === "decision-ready",
      closure: terminal,
    }),
  });
}

function finding(
  id: string,
  property: ExplorationClause,
  classification: string,
  summary: string,
  details: Readonly<Record<string, unknown>>,
  signature = id,
): ExplorationFinding {
  return Object.freeze({
    signature,
    id,
    propertyId: property.id,
    classification,
    summary,
    details: Object.freeze(details),
  });
}

/**
 * Product-free phase and cross-field oracle for Delivery reducer observations.
 * This module intentionally imports no runtime implementation or registry.
 */
export function deliveryInvariants(input: Readonly<{
  model: DeliveryOracleModel;
  observation: DeliveryObservation;
}>): readonly ExplorationFinding[] {
  const { model, observation } = input;
  const findings: ExplorationFinding[] = [];
  const candidate = observation.subjects.candidate;
  const closure = observation.subjects.closure;
  const activeActivities = observation.activities.filter((activity) =>
    activity.stage !== "completed");
  const unresolvedRecovery = activeActivities.find((activity) =>
    activity.recovery !== null)?.recovery ?? null;
  const observedRecovery = unresolvedRecovery === null
    ? null
    : recovery(unresolvedRecovery.kind, unresolvedRecovery.resumesAt);
  const profile = expectedProfile(model);

  if (model.kind === "pre-intent-refusal") {
    const expected = {
      "agent-pre-intent-refused": model.phase === "refused" || model.phase === "abandoned" ? 1 : 0,
      "agent-attempt-prepared": model.phase === "prepared" || model.phase === "intended" ? 1 : 0,
      "provider-effect-intended": model.phase === "intended" ? 1 : 0,
      "provider-effect-observed": 0,
      "execution-receipt-recorded": 0,
      "activity-completed": model.phase === "abandoned" ? 1 : 0,
    };
    for (const [eventKind, count] of Object.entries(expected)) {
      const observed = observation.eventKinds.filter((kind) => kind === eventKind).length;
      if (observed !== count) {
        findings.push(finding(
          "pre-intent.milestone-count-differs-from-phase",
          deliveryProperties.activityTopology,
          "confirmed-normative-violation",
          "Subjectless refusal and abandonment retain no Attempt, provider intent or Receipt.",
          { phase: model.phase, eventKind, expected: count, observed },
          `pre-intent.milestone-count/${model.phase}/${eventKind}`,
        ));
      }
    }
  }

  if (
    profile?.activeActivityCount !== undefined &&
    activeActivities.length !== profile.activeActivityCount
  ) {
    findings.push(finding(
      "activities.active-count-differs-from-phase",
      deliveryProperties.activityTopology,
      "prototype-mismatch",
      "Active Activity count differs from the independent scenario phase.",
      {
        phase: model.phase,
        expected: profile.activeActivityCount,
        observed: activeActivities.length,
      },
      `activities.active-count/${model.kind}/${model.phase}`,
    ));
  }

  if (
    profile?.activeOperation !== undefined &&
    activeActivities[0]?.operation !== profile.activeOperation
  ) {
    findings.push(finding(
      "activities.operation-differs-from-phase",
      deliveryProperties.activityTopology,
      "prototype-mismatch",
      "The active Activity operation differs from the independent scenario phase.",
      {
        phase: model.phase,
        expected: profile.activeOperation,
        observed: activeActivities[0]?.operation ?? null,
      },
      `activities.operation/${model.kind}/${model.phase}`,
    ));
  }

  if (
    profile?.activeFamily !== undefined &&
    activeActivities[0]?.family !== profile.activeFamily
  ) {
    findings.push(finding(
      "activities.family-differs-from-phase",
      deliveryProperties.activityTopology,
      "prototype-mismatch",
      "The active Activity family differs from the independent scenario phase.",
      {
        phase: model.phase,
        expected: profile.activeFamily,
        observed: activeActivities[0]?.family ?? null,
      },
      `activities.family/${model.kind}/${model.phase}`,
    ));
  }

  if (
    profile?.activeStage !== undefined &&
    activeActivities[0]?.stage !== profile.activeStage
  ) {
    findings.push(finding(
      "activities.stage-differs-from-phase",
      deliveryProperties.activityTopology,
      "prototype-mismatch",
      "The active Activity stage differs from the independent scenario phase.",
      {
        phase: model.phase,
        expected: profile.activeStage,
        observed: activeActivities[0]?.stage ?? null,
      },
      `activities.stage/${model.kind}/${model.phase}`,
    ));
  }

  const candidateIsAbsent = candidate === null;
  const conditionIsAbsent = observation.candidateCondition === "absent";
  if (candidateIsAbsent !== conditionIsAbsent) {
    findings.push(finding(
      candidateIsAbsent
        ? "candidate.absence-is-independent"
        : "candidate.present-cannot-be-absent",
      deliveryProperties.candidateAbsence,
      "confirmed-normative-violation",
      candidateIsAbsent
        ? "No Candidate exists but Candidate condition is not absent."
        : "A Candidate exists but Candidate condition is absent.",
      {
        phase: model.phase,
        candidatePresent: !candidateIsAbsent,
        standing: observation.standing,
        candidateCondition: observation.candidateCondition,
        recovery: unresolvedRecovery,
      },
      [
        candidateIsAbsent
          ? "candidate.absence-is-independent"
          : "candidate.present-cannot-be-absent",
        model.kind,
        model.originStanding ?? "none",
        model.phase,
        observedRecovery ?? "none",
      ].join("/"),
    ));
  }

  if (
    candidateIsAbsent === conditionIsAbsent &&
    profile?.candidateCondition !== undefined &&
    observation.candidateCondition !== profile.candidateCondition
  ) {
    findings.push(finding(
      "candidate.condition-differs-from-phase",
      deliveryProperties.candidateCondition,
      "prototype-mismatch",
      "Candidate condition differs from the independent scenario phase.",
      {
        phase: model.phase,
        expected: profile.candidateCondition,
        standing: observation.standing,
        candidateCondition: observation.candidateCondition,
        recovery: unresolvedRecovery,
      },
      `candidate.condition-differs-from-phase/${model.kind}/${model.phase}`,
    ));
  }

  if (candidate !== null && model.candidatePresent !== true) {
    findings.push(finding(
      "candidate.presence-differs-from-phase",
      deliveryProperties.subjectTopology,
      "prototype-mismatch",
      "Candidate presence differs from the independent scenario phase.",
      { phase: model.phase, expected: model.candidatePresent, observed: true },
    ));
  }

  if (candidate === null && model.candidatePresent === true) {
    findings.push(finding(
      "candidate.presence-differs-from-phase",
      deliveryProperties.subjectTopology,
      "prototype-mismatch",
      "Candidate presence differs from the independent scenario phase.",
      { phase: model.phase, expected: true, observed: false },
    ));
  }

  if (profile !== null && observedRecovery !== profile.recovery) {
    findings.push(finding(
      "recovery.coordinate-differs-from-phase",
      deliveryProperties.recoveryEligibility,
      "prototype-mismatch",
      "Recovery coordinate differs from the independent scenario phase.",
      { phase: model.phase, expected: profile.recovery, observed: observedRecovery },
    ));
  }


  if (profile?.recoveryEffectBinding !== undefined && unresolvedRecovery !== null) {
    const expectedEffectDigest = profile.recoveryEffectBinding === "none"
      ? null
      : model.effectDigest;
    if (profile.recoveryEffectBinding === "model-effect" && expectedEffectDigest === undefined) {
      throw new TypeError(
        `Oracle phase ${model.kind}/${model.phase} requires one modeled effect digest`,
      );
    }
    if (unresolvedRecovery.exactEffectDigest !== expectedEffectDigest) {
      findings.push(finding(
        "recovery.effect-binding-differs-from-phase",
        deliveryProperties.recoveryEligibility,
        "prototype-mismatch",
        "Recovery effect binding differs from the exact modeled effect.",
        {
          phase: model.phase,
          expected: expectedEffectDigest ?? null,
          observed: unresolvedRecovery.exactEffectDigest,
          recovery: observedRecovery,
        },
        `recovery.effect-binding/${model.kind}/${model.phase}`,
      ));
    }
  }

  if (
    profile?.standing !== null && profile?.standing !== undefined &&
    observation.standing !== profile.standing
  ) {
    findings.push(finding(
      "standing.differs-from-phase",
      deliveryProperties.standingTopology,
      "prototype-mismatch",
      "Standing differs from the independent scenario phase.",
      { phase: model.phase, expected: profile.standing, observed: observation.standing },
    ));
  }

  for (const [name, expectedPresent] of Object.entries(profile?.subjects ?? {})) {
    const subjectName = name as SubjectName;
    const observedPresent = observation.subjects[subjectName] !== null;
    if (observedPresent !== expectedPresent) {
      findings.push(finding(
        `subjects.${name}-presence-differs-from-phase`,
        deliveryProperties.subjectTopology,
        "prototype-mismatch",
        "Current-subject presence differs from the independent scenario phase.",
        {
          phase: model.phase,
          subject: name,
          expected: expectedPresent,
          observed: observedPresent,
        },
      ));
    }
  }

  if (
    observation.standing === "framing" &&
    (
      observation.subjects.proposedBoundary !== null ||
      observation.subjects.activeBoundary !== null
    )
  ) {
    findings.push(finding(
      "standing.framing-has-established-boundary",
      deliveryProperties.standingTopology,
      "specification-gap",
      "Framing is projected despite an established Boundary subject.",
      {
        proposedBoundary: observation.subjects.proposedBoundary,
        activeBoundary: observation.subjects.activeBoundary,
        candidate,
        recovery: unresolvedRecovery,
      },
    ));
  }

  if (
    observation.standing === "awaiting-admission" &&
    observation.subjects.proposedBoundary === null
  ) {
    findings.push(finding(
      "standing.awaiting-admission-needs-proposal",
      deliveryProperties.standingTopology,
      "prototype-mismatch",
      "Awaiting admission has no proposed Boundary.",
      { subjects: observation.subjects },
    ));
  }

  if (
    observation.standing === "active" &&
    observation.subjects.activeBoundary === null
  ) {
    findings.push(finding(
      "standing.active-needs-boundary",
      deliveryProperties.standingTopology,
      "prototype-mismatch",
      "Active standing lacks its governing Boundary.",
      { subjects: observation.subjects },
    ));
  }

  if (candidate !== null && observation.subjects.activeBoundary === null) {
    findings.push(finding(
      "subjects.candidate-needs-active-boundary",
      deliveryProperties.subjectTopology,
      "prototype-mismatch",
      "A current Candidate has no active Boundary.",
      { subjects: observation.subjects },
    ));
  }

  if (unresolvedRecovery !== null &&
      !sameStringSet(observation.eligibleOperations, RECOVER_ONLY)) {
    findings.push(finding(
      "recovery.suppresses-other-operations",
      deliveryProperties.recoveryEligibility,
      "confirmed-normative-violation",
      "Unresolved recovery does not expose exactly delivery.recover.",
      {
        recovery: unresolvedRecovery,
        eligibleOperations: observation.eligibleOperations,
      },
    ));
  }

  const expectedOperations = expectedEligibility(model);
  if (!sameStringSet(observation.eligibleOperations, expectedOperations)) {
    findings.push(finding(
      "eligibility.differs-from-scenario-oracle",
      deliveryProperties.operationEligibility,
      "prototype-mismatch",
      "Reducer eligibility differs from the independent scenario phase.",
      {
        phase: model.phase,
        expected: expectedOperations,
        observed: observation.eligibleOperations,
      },
    ));
  }

  if (observation.standing !== "closed" && observation.eligibleOperations.length === 0) {
    findings.push(finding(
      "progress.nonterminal-operation-sink",
      deliveryProperties.nonterminalProgress,
      "confirmed-normative-violation",
      "A nonterminal reduction exposes no eligible operation.",
      { phase: model.phase, standing: observation.standing },
    ));
  }

  if (closure !== null) {
    if (
      observation.standing !== "closed" || observation.eligibleOperations.length !== 0 ||
      observation.eventKinds.at(-1) !== "closure-recorded" || activeActivities.length !== 0
    ) {
      findings.push(finding(
        "closure.is-terminal",
        deliveryProperties.terminalOrdering,
        "confirmed-normative-violation",
        "Closure does not project one terminal completed state.",
        {
          standing: observation.standing,
          eligibleOperations: observation.eligibleOperations,
          lastEventKind: observation.eventKinds.at(-1) ?? null,
          activeActivityCount: activeActivities.length,
        },
      ));
    }
  }

  if (observation.journal.eventCount !== observation.eventKinds.length) {
    findings.push(finding(
      "journal.count-matches-history",
      deliveryProperties.journalCount,
      "confirmed-normative-violation",
      "Journal event count differs from the exact event history.",
      {
        eventCount: observation.journal.eventCount,
        historyLength: observation.eventKinds.length,
      },
    ));
  }

  return Object.freeze(findings);
}

type RoutePhase =
  | "framing-fresh"
  | "framing-after-preparation"
  | "awaiting-admission"
  | "active"
  | "active-needs-correction"
  | "active-sealed-after-failed-evaluation"
  | "boundary-paused"
  | "awaiting-readmission"
  | "decision-ready"
  | "closed";

type RouteOperation =
  | "delivery.integrate"
  | "delivery.prepare"
  | "delivery.admit"
  | "delivery.continue"
  | "delivery.evaluate"
  | "delivery.revise"
  | "delivery.reaffirm"
  | "delivery.accept"
  | "delivery.no-ship";

function explicitProfile(input: DeliveryExpectedProfile): DeliveryExpectedProfile {
  return Object.freeze({
    ...input,
    subjects: Object.freeze({ ...input.subjects }),
    eligibleOperations: input.eligibleOperations === undefined
      ? undefined
      : Object.freeze([...input.eligibleOperations]),
  });
}

const ROUTE_PHASES = Object.freeze({
  "framing-fresh": Object.freeze({
    standing: "framing",
    candidateCondition: "absent",
    candidatePresent: false,
    subjects: Object.freeze({
      integrationAssessment: false,
      proposedBoundary: false,
      activeBoundary: false,
      candidate: false,
      materialCondition: false,
      seal: false,
      evidence: false,
      closure: false,
    }),
    eligibleOperations: FRESH_FRAMING_OPERATIONS,
  }),
  "framing-after-preparation": Object.freeze({
    standing: "framing",
    candidateCondition: "absent",
    candidatePresent: false,
    subjects: Object.freeze({
      integrationAssessment: false,
      proposedBoundary: false,
      activeBoundary: false,
      candidate: false,
      materialCondition: false,
      seal: false,
      evidence: false,
      closure: false,
    }),
    eligibleOperations: NO_SHIP_ONLY,
  }),
  "awaiting-admission": Object.freeze({
    standing: "awaiting-admission",
    candidateCondition: "absent",
    candidatePresent: false,
    subjects: Object.freeze({
      integrationAssessment: false,
      proposedBoundary: true,
      activeBoundary: false,
      candidate: false,
      materialCondition: false,
      seal: false,
      evidence: false,
      closure: false,
    }),
    eligibleOperations: AWAITING_ADMISSION_OPERATIONS,
  }),
  active: Object.freeze({
    standing: "active",
    candidateCondition: "ready-for-work",
    candidatePresent: true,
    subjects: Object.freeze({
      integrationAssessment: true,
      proposedBoundary: false,
      activeBoundary: true,
      candidate: true,
      materialCondition: false,
      seal: false,
      evidence: false,
      closure: false,
    }),
    eligibleOperations: ACTIVE_OPERATIONS,
  }),
  "active-needs-correction": Object.freeze({
    standing: "active",
    candidateCondition: "needs-correction",
    candidatePresent: true,
    subjects: Object.freeze({
      integrationAssessment: true,
      proposedBoundary: false,
      activeBoundary: true,
      candidate: true,
      materialCondition: false,
      seal: true,
      evidence: true,
      closure: false,
    }),
    eligibleOperations: ACTIVE_OPERATIONS,
  }),
  "active-sealed-after-failed-evaluation": Object.freeze({
    standing: "active",
    candidateCondition: "sealed-under-evaluation",
    candidatePresent: true,
    subjects: Object.freeze({
      integrationAssessment: true,
      proposedBoundary: false,
      activeBoundary: true,
      candidate: true,
      materialCondition: false,
      seal: true,
      evidence: false,
      closure: false,
    }),
    eligibleOperations: ACTIVE_OPERATIONS,
  }),
  "boundary-paused": Object.freeze({
    standing: "boundary-paused",
    candidateCondition: "paused-for-boundary",
    candidatePresent: true,
    subjects: Object.freeze({
      integrationAssessment: true,
      proposedBoundary: false,
      activeBoundary: true,
      candidate: true,
      materialCondition: true,
      seal: false,
      evidence: false,
      closure: false,
    }),
    eligibleOperations: BOUNDARY_PAUSED_OPERATIONS,
  }),
  "awaiting-readmission": Object.freeze({
    standing: "awaiting-readmission",
    candidateCondition: "paused-for-boundary",
    candidatePresent: true,
    subjects: Object.freeze({
      integrationAssessment: true,
      proposedBoundary: true,
      activeBoundary: true,
      candidate: true,
      materialCondition: true,
      seal: false,
      evidence: false,
      closure: false,
    }),
    eligibleOperations: AWAITING_READMISSION_OPERATIONS,
  }),
  "decision-ready": Object.freeze({
    standing: "decision-ready",
    candidateCondition: "ready-for-decision",
    candidatePresent: true,
    subjects: Object.freeze({
      integrationAssessment: true,
      proposedBoundary: false,
      activeBoundary: true,
      candidate: true,
      materialCondition: false,
      seal: true,
      evidence: true,
      closure: false,
    }),
    eligibleOperations: DECISION_READY_OPERATIONS,
  }),
  closed: Object.freeze({
    standing: "closed",
    candidateCondition: "accepted",
    candidatePresent: true,
    subjects: Object.freeze({
      integrationAssessment: true,
      proposedBoundary: false,
      activeBoundary: true,
      candidate: true,
      materialCondition: false,
      seal: true,
      evidence: true,
      closure: true,
    }),
    eligibleOperations: NO_OPERATIONS,
  }),
} satisfies Readonly<Record<RoutePhase, Readonly<{
  standing: string;
  candidateCondition: string;
  candidatePresent: boolean;
  subjects: Readonly<Partial<Record<SubjectName, boolean>>>;
  eligibleOperations: readonly string[];
}>>>);

function routeOpeningModel(phase: RoutePhase): DeliveryOracleModel {
  const selected = ROUTE_PHASES[phase];
  return Object.freeze({
    kind: "route-opening",
    phase,
    candidatePresent: selected.candidatePresent,
    profile: explicitProfile({
      standing: selected.standing,
      candidateCondition: selected.candidateCondition,
      recovery: null,
      activeActivityCount: 0,
      subjects: selected.subjects,
      eligibleOperations: selected.eligibleOperations,
    }),
  });
}

export const routeOpeningModels = Object.freeze(Object.fromEntries(
  (Object.keys(ROUTE_PHASES) as RoutePhase[]).map((phase) => [
    phase,
    routeOpeningModel(phase),
  ]),
)) as Readonly<Record<RoutePhase, DeliveryOracleModel>>;

function routePhases(...phases: RoutePhase[]): readonly RoutePhase[] {
  return Object.freeze(phases);
}

const ROUTE_OPENINGS = Object.freeze([
  Object.freeze({
    id: "start-prepare",
    operation: "delivery.prepare",
    family: "agent",
    recovery: recovery("finalization", "agent-attempt-prepared"),
    phases: routePhases("framing-fresh"),
  }),
  Object.freeze({
    id: "start-admit",
    operation: "delivery.admit",
    family: "transaction",
    recovery: recovery("finalization", "director-decision-authenticated"),
    phases: routePhases("awaiting-admission", "awaiting-readmission"),
  }),
  Object.freeze({
    id: "start-continue",
    operation: "delivery.continue",
    family: "agent",
    recovery: recovery("finalization", "agent-attempt-prepared"),
    phases: routePhases(
      "active",
      "active-needs-correction",
      "active-sealed-after-failed-evaluation",
    ),
  }),
  Object.freeze({
    id: "start-integrate", operation: "delivery.integrate", family: "integration",
    recovery: recovery("finalization", "integration-assessed"),
    phases: routePhases("active", "active-needs-correction", "active-sealed-after-failed-evaluation", "decision-ready"),
  }),
  Object.freeze({
    id: "start-evaluate",
    operation: "delivery.evaluate",
    family: "agent",
    recovery: recovery("finalization", "candidate-sealed"),
    phases: routePhases(
      "active",
      "active-needs-correction",
      "active-sealed-after-failed-evaluation",
    ),
  }),
  Object.freeze({
    id: "start-revise",
    operation: "delivery.revise",
    family: "agent",
    recovery: recovery("finalization", "agent-attempt-prepared"),
    phases: routePhases("boundary-paused"),
  }),
  Object.freeze({
    id: "start-reaffirm",
    operation: "delivery.reaffirm",
    family: "agent",
    recovery: recovery("finalization", "agent-attempt-prepared"),
    phases: routePhases("boundary-paused"),
  }),
  Object.freeze({
    id: "start-accept",
    operation: "delivery.accept",
    family: "transaction",
    recovery: recovery("finalization", "director-decision-authenticated"),
    phases: routePhases("decision-ready"),
  }),
  Object.freeze({
    id: "start-no-ship",
    operation: "delivery.no-ship",
    family: "transaction",
    recovery: recovery("finalization", "director-decision-authenticated"),
    phases: routePhases(
      "framing-after-preparation",
      "awaiting-admission",
      "active",
      "active-needs-correction",
      "active-sealed-after-failed-evaluation",
      "boundary-paused",
      "awaiting-readmission",
      "decision-ready",
    ),
  }),
] as const satisfies readonly Readonly<{
  id: string;
  operation: RouteOperation;
  family: "agent" | "integration" | "transaction";
  recovery: string;
  phases: readonly RoutePhase[];
}>[]);

function routeOpeningCandidateCondition(
  model: DeliveryOracleModel,
  operation: RouteOperation,
): string {
  if (!model.candidatePresent) return "absent";
  if (
    model.phase === "boundary-paused" ||
    model.phase === "awaiting-readmission"
  ) return "paused-for-boundary";
  if (operation === "delivery.integrate") return "in-progress";
  if (model.phase === "decision-ready") return "ready-for-decision";
  if (operation === "delivery.evaluate" && model.profile?.subjects.seal === true) {
    return "sealed-under-evaluation";
  }
  return "in-progress";
}

const ROUTE_OPENING_COMMANDS = Object.freeze(ROUTE_OPENINGS.map((opening) =>
  Object.freeze({
    id: opening.id,
    expectation(model: DeliveryOracleModel): TransitionExpectation<DeliveryOracleModel> {
      if (model.kind !== "route-opening" || model.profile === undefined) {
        return unexpectedOraclePhase("route-opening", opening.id, model.phase);
      }
      if (!opening.phases.includes(model.phase as RoutePhase)) {
        return Object.freeze({
          kind: "refused",
          classes: Object.freeze([
            model.phase === "closed" ? REFUSAL.terminal : REFUSAL.eligibility,
          ]),
        });
      }
      return Object.freeze({
        kind: "accepted",
        next: Object.freeze({
          ...model,
          phase: `${model.phase}/${opening.operation}/started`,
          profile: explicitProfile({
            standing: model.profile.standing,
            candidateCondition: routeOpeningCandidateCondition(model, opening.operation),
            recovery: opening.recovery,
            activeActivityCount: 1,
            activeOperation: opening.operation,
            activeFamily: opening.family,
            activeStage: "started",
            recoveryEffectBinding: "none",
            subjects: model.profile.subjects,
            eligibleOperations: RECOVER_ONLY,
          }),
        }),
      });
    },
  })));

export const routeOpeningOracle: DeliveryOracle = Object.freeze({
  id: "delivery-route-openings",
  clauses: Object.freeze([
    deliveryProperties.candidateAbsence,
    deliveryProperties.candidateCondition,
    deliveryProperties.standingTopology,
    deliveryProperties.subjectTopology,
    deliveryProperties.recoveryEligibility,
    deliveryProperties.activityTopology,
    deliveryProperties.operationEligibility,
    deliveryProperties.nonterminalProgress,
    deliveryProperties.terminalOrdering,
    deliveryProperties.journalCount,
  ]),
  bounds: Object.freeze({ maxDepth: 1, maxNodes: 45, maxTransitions: 120 }),
  requiredCoverage: Object.freeze({
    phases: Object.freeze(Object.keys(ROUTE_PHASES)),
    acceptedCommands: Object.freeze(ROUTE_OPENINGS.map(({ id }) => id)),
    eventKinds: Object.freeze(["activity-started"]),
    seedEventKinds: Object.freeze([]),
    generatedEventKinds: Object.freeze(["activity-started"]),
    recoveryCoordinates: Object.freeze([
      "finalization/agent-attempt-prepared",
      "finalization/candidate-sealed",
      "finalization/director-decision-authenticated",
    ]),
  }),
  initialModel: routeOpeningModels["framing-fresh"],
  commands: ROUTE_OPENING_COMMANDS,
});

type ProgressionPhase =
  | "provider-intent"
  | "provider-observation"
  | "work-product-observation"
  | "candidate-observation"
  | "candidate-receipt"
  | "boundary-receipt"
  | "work-boundary"
  | "baseline-checks"
  | "boundary-completion"
  | "candidate-seal"
  | "evaluation-checks"
  | "reviewer-provider-intent"
  | "continue-finalization"
  | "condition-completion"
  | "evaluation-finalization"
  | "evidence-completion";

function progressionModel(input: Readonly<{
  phase: ProgressionPhase;
  operation: "delivery.prepare" | "delivery.continue" | "delivery.evaluate";
  standing: "framing" | "active" | "boundary-paused" | "decision-ready";
  candidatePresent: boolean;
  candidateCondition: string;
  recovery: string;
  activeStage: ExpectedActivityStage;
  recoveryEffectBinding?: RecoveryEffectBinding;
  proposedBoundary?: boolean;
  activeBoundary?: boolean;
  materialCondition?: boolean;
  seal?: boolean;
  evidence?: boolean;
}>): DeliveryOracleModel {
  return Object.freeze({
    kind: "progression",
    phase: input.phase,
    candidatePresent: input.candidatePresent,
    profile: explicitProfile({
      standing: input.standing,
      candidateCondition: input.candidateCondition,
      recovery: input.recovery,
      activeActivityCount: 1,
      activeOperation: input.operation,
      activeFamily: "agent",
      activeStage: input.activeStage,
      recoveryEffectBinding: input.recoveryEffectBinding ?? "none",
      subjects: Object.freeze({
        integrationAssessment: input.candidatePresent,
        proposedBoundary: input.proposedBoundary ?? false,
        activeBoundary: input.activeBoundary ?? false,
        candidate: input.candidatePresent,
        materialCondition: input.materialCondition ?? false,
        seal: input.seal ?? false,
        evidence: input.evidence ?? false,
        closure: false,
      }),
      eligibleOperations: RECOVER_ONLY,
    }),
  });
}

const activeProgression = (
  phase: ProgressionPhase,
  operation: "delivery.continue" | "delivery.evaluate",
  resumesAt: string,
  additions: Readonly<{
    standing?: "active" | "boundary-paused" | "decision-ready";
    candidateCondition?: "in-progress" | "sealed-under-evaluation" | "terminal-recovery";
    materialCondition?: boolean;
    seal?: boolean;
    evidence?: boolean;
    activeStage?: ExpectedActivityStage;
    recoveryEffectBinding?: RecoveryEffectBinding;
  }> = {},
): DeliveryOracleModel => progressionModel({
  phase,
  operation,
  standing: additions.standing ?? "active",
  candidatePresent: true,
  candidateCondition: additions.candidateCondition ?? "terminal-recovery",
  recovery: resumesAt,
  activeStage: additions.activeStage ?? "finalizing",
  recoveryEffectBinding: additions.recoveryEffectBinding,
  activeBoundary: true,
  materialCondition: additions.materialCondition,
  seal: additions.seal,
  evidence: additions.evidence,
});

const boundaryProgression = (
  phase: ProgressionPhase,
  resumesAt: string,
  activeStage: ExpectedActivityStage,
): DeliveryOracleModel => progressionModel({
  phase,
  operation: "delivery.prepare",
  standing: "framing",
  candidatePresent: false,
  candidateCondition: "absent",
  recovery: resumesAt,
  activeStage,
});

export const recoveryProgressionModels = Object.freeze({
  "provider-intent": activeProgression(
    "provider-intent",
    "delivery.continue",
    recovery("finalization", "provider-effect-intended"),
    { candidateCondition: "in-progress", activeStage: "prepared" },
  ),
  "provider-observation": activeProgression(
    "provider-observation",
    "delivery.continue",
    recovery("provider", "provider-effect-observed"),
    { activeStage: "effect-intended", recoveryEffectBinding: "model-effect" },
  ),
  "work-product-observation": activeProgression(
    "work-product-observation",
    "delivery.continue",
    recovery("finalization", "work-product-observation"),
    { activeStage: "effect-observed", recoveryEffectBinding: "model-effect" },
  ),
  "candidate-observation": activeProgression(
    "candidate-observation",
    "delivery.continue",
    recovery("candidate-observation", "candidate-revision-observed"),
    { activeStage: "submitted" },
  ),
  "candidate-receipt": activeProgression(
    "candidate-receipt",
    "delivery.continue",
    recovery("finalization", "execution-receipt-recorded"),
  ),
  "boundary-receipt": boundaryProgression(
    "boundary-receipt",
    recovery("finalization", "execution-receipt-recorded"),
    "submitted",
  ),
  "work-boundary": boundaryProgression(
    "work-boundary",
    recovery("finalization", "work-boundary-finalized"),
    "finalizing",
  ),
  "baseline-checks": boundaryProgression(
    "baseline-checks",
    recovery("finalization", "baseline-checks"),
    "finalizing",
  ),
  "boundary-completion": boundaryProgression(
    "boundary-completion",
    recovery("finalization", "activity-completed"),
    "finalizing",
  ),
  "candidate-seal": activeProgression(
    "candidate-seal",
    "delivery.evaluate",
    recovery("finalization", "candidate-sealed"),
    { candidateCondition: "in-progress", activeStage: "started" },
  ),
  "evaluation-checks": activeProgression(
    "evaluation-checks",
    "delivery.evaluate",
    recovery("finalization", "evaluation-checks"),
    { seal: true },
  ),
  "reviewer-provider-intent": activeProgression(
    "reviewer-provider-intent",
    "delivery.evaluate",
    recovery("finalization", "provider-effect-intended"),
    {
      candidateCondition: "sealed-under-evaluation",
      seal: true,
      activeStage: "prepared",
    },
  ),
  "continue-finalization": activeProgression(
    "continue-finalization",
    "delivery.continue",
    recovery("finalization", "activity-finalization"),
  ),
  "condition-completion": activeProgression(
    "condition-completion",
    "delivery.continue",
    recovery("finalization", "activity-completed"),
    { standing: "boundary-paused", materialCondition: true },
  ),
  "evaluation-finalization": activeProgression(
    "evaluation-finalization",
    "delivery.evaluate",
    recovery("finalization", "activity-finalization"),
    { seal: true },
  ),
  "evidence-completion": activeProgression(
    "evidence-completion",
    "delivery.evaluate",
    recovery("finalization", "activity-completed"),
    { standing: "decision-ready", seal: true, evidence: true },
  ),
} satisfies Readonly<Record<ProgressionPhase, DeliveryOracleModel>>);

const RECOVERY_PROGRESSION_TRANSITIONS: Readonly<
  Partial<Record<ProgressionPhase, DeliveryOracleModel>>
> = Object.freeze({
  "provider-intent": recoveryProgressionModels["provider-observation"],
  "provider-observation": recoveryProgressionModels["work-product-observation"],
  "work-product-observation": recoveryProgressionModels["candidate-observation"],
  "candidate-observation": recoveryProgressionModels["candidate-receipt"],
  "boundary-receipt": recoveryProgressionModels["work-boundary"],
  "work-boundary": recoveryProgressionModels["baseline-checks"],
  "baseline-checks": recoveryProgressionModels["boundary-completion"],
  "candidate-seal": recoveryProgressionModels["evaluation-checks"],
  "evaluation-checks": recoveryProgressionModels["reviewer-provider-intent"],
  "continue-finalization": recoveryProgressionModels["condition-completion"],
  "evaluation-finalization": recoveryProgressionModels["evidence-completion"],
});

const RECOVERY_PROGRESSION_COMMANDS = Object.freeze([
  Object.freeze({
    id: "advance-recovery",
    expectation(model: DeliveryOracleModel): TransitionExpectation<DeliveryOracleModel> {
      if (model.kind !== "progression") {
        return unexpectedOraclePhase("progression", "advance-recovery", model.phase);
      }
      const next = RECOVERY_PROGRESSION_TRANSITIONS[model.phase as ProgressionPhase];
      if (next === undefined) {
        return unexpectedOraclePhase("progression", "advance-recovery", model.phase);
      }
      return Object.freeze({
        kind: "accepted",
        next: Object.freeze({
          ...next,
          effectDigest: model.effectDigest,
        }),
      });
    },
  }),
]);

export const recoveryProgressionOracle: DeliveryOracle = Object.freeze({
  id: "delivery-recovery-progression",
  clauses: Object.freeze([
    deliveryProperties.candidateAbsence,
    deliveryProperties.candidateCondition,
    deliveryProperties.standingTopology,
    deliveryProperties.subjectTopology,
    deliveryProperties.recoveryEligibility,
    deliveryProperties.activityTopology,
    deliveryProperties.operationEligibility,
    deliveryProperties.nonterminalProgress,
    deliveryProperties.journalCount,
  ]),
  bounds: Object.freeze({ maxDepth: 1, maxNodes: 30, maxTransitions: 20 }),
  requiredCoverage: Object.freeze({
    phases: Object.freeze(Object.keys(RECOVERY_PROGRESSION_TRANSITIONS)),
    acceptedCommands: Object.freeze(["advance-recovery"]),
    eventKinds: Object.freeze([
      "agent-attempt-prepared",
      "agent-work-product-abandoned",
      "candidate-revision-observed",
      "candidate-sealed",
      "check-receipt-recorded",
      "evidence-packet-finalized",
      "execution-receipt-recorded",
      "material-condition-frozen",
      "provider-effect-intended",
      "provider-effect-observed",
      "work-boundary-finalized",
    ]),
    seedEventKinds: Object.freeze([]),
    generatedEventKinds: Object.freeze([
      "agent-attempt-prepared",
      "agent-work-product-abandoned",
      "candidate-revision-observed",
      "candidate-sealed",
      "check-receipt-recorded",
      "evidence-packet-finalized",
      "execution-receipt-recorded",
      "material-condition-frozen",
      "provider-effect-intended",
      "provider-effect-observed",
      "work-boundary-finalized",
    ]),
    recoveryCoordinates: Object.freeze([
      "candidate-observation/candidate-revision-observed",
      "finalization/activity-completed",
      "finalization/activity-finalization",
      "finalization/baseline-checks",
      "finalization/candidate-sealed",
      "finalization/evaluation-checks",
      "finalization/execution-receipt-recorded",
      "finalization/provider-effect-intended",
      "finalization/work-boundary-finalized",
      "finalization/work-product-observation",
      "provider/provider-effect-observed",
    ]),
  }),
  initialModel: recoveryProgressionModels["provider-intent"],
  commands: RECOVERY_PROGRESSION_COMMANDS,
});

export const preparationOracle: DeliveryOracle = Object.freeze({
  id: "preparation-recovery",
  clauses: Object.freeze([
    deliveryProperties.preparationRecovery,
    deliveryProperties.candidateAbsence,
    deliveryProperties.subjectTopology,
    deliveryProperties.recoveryEligibility,
    deliveryProperties.activityTopology,
    deliveryProperties.operationEligibility,
    deliveryProperties.nonterminalProgress,
    deliveryProperties.journalCount,
  ]),
  bounds: Object.freeze({ maxDepth: 2, maxNodes: 10, maxTransitions: 10 }),
  requiredCoverage: Object.freeze({
    phases: Object.freeze(["started"]),
    acceptedCommands: Object.freeze(["record-prepare-recovery"]),
    eventKinds: Object.freeze([
      "activity-recovery-recorded",
      "activity-started",
      "delivery-created",
      "director-brief-submitted",
    ]),
    seedEventKinds: Object.freeze([
      "activity-started",
      "delivery-created",
      "director-brief-submitted",
    ]),
    generatedEventKinds: Object.freeze(["activity-recovery-recorded"]),
    recoveryCoordinates: Object.freeze(["finalization/agent-attempt-prepared"]),
  }),
  initialModel: Object.freeze({
    kind: "preparation",
    phase: "started",
    candidatePresent: false,
  }),
  commands: PREPARATION_COMMANDS,
});

export const admissionOracle: DeliveryOracle = Object.freeze({
  id: "initial-admission",
  clauses: Object.freeze([
    deliveryProperties.initialAdmissionOrdering,
    deliveryProperties.candidateAbsence,
    deliveryProperties.candidateCondition,
    deliveryProperties.standingTopology,
    deliveryProperties.subjectTopology,
    deliveryProperties.recoveryEligibility,
    deliveryProperties.activityTopology,
    deliveryProperties.operationEligibility,
    deliveryProperties.nonterminalProgress,
    deliveryProperties.journalCount,
  ]),
  bounds: Object.freeze({ maxDepth: 5, maxNodes: 250, maxTransitions: 1_000 }),
  requiredCoverage: Object.freeze({
    phases: Object.freeze([
      "started",
      "authorized",
      "intended",
      "applied-awaiting-candidate",
      "not-applied-awaiting-completion",
      "candidate-observed",
      "active",
      "retryable",
    ]),
    acceptedCommands: Object.freeze(ADMISSION_COMMANDS.map(({ id }) => id)),
    eventKinds: Object.freeze([
      "activity-completed",
      "activity-recovery-recorded",
      "activity-started",
      "agent-attempt-prepared",
      "agent-work-product-submitted",
      "candidate-revision-observed",
      "check-receipt-recorded",
      "delivery-created",
      "execution-receipt-recorded",
      "director-brief-submitted",
      "director-decision-authenticated",
      "provider-effect-intended",
      "provider-effect-observed",
      "transaction-effect-intended",
      "transaction-effect-observed",
      "work-boundary-finalized",
    ]),
    seedEventKinds: Object.freeze([
      "activity-completed",
      "activity-started",
      "agent-attempt-prepared",
      "agent-work-product-submitted",
      "check-receipt-recorded",
      "delivery-created",
      "execution-receipt-recorded",
      "director-brief-submitted",
      "provider-effect-intended",
      "provider-effect-observed",
      "work-boundary-finalized",
    ]),
    generatedEventKinds: Object.freeze([
      "activity-completed",
      "activity-recovery-recorded",
      "candidate-revision-observed",
      "director-decision-authenticated",
      "transaction-effect-intended",
      "transaction-effect-observed",
    ]),
    recoveryCoordinates: Object.freeze([
      "candidate-observation/candidate-revision-observed",
      "finalization/activity-completed",
      "finalization/director-decision-authenticated",
      "finalization/transaction-effect-intended",
      "transaction/transaction-effect-observed",
    ]),
  }),
  initialModel: Object.freeze({
    kind: "admission",
    phase: "started",
    candidatePresent: false,
  }),
  commands: ADMISSION_COMMANDS,
});

export function noShipOracle(candidatePresent: boolean): DeliveryOracle {
  return Object.freeze({
    id: candidatePresent ? "candidate-present-no-ship" : "no-candidate-no-ship",
    clauses: Object.freeze([
      deliveryProperties.noShipOrdering,
      deliveryProperties.candidateAbsence,
      deliveryProperties.candidateCondition,
      deliveryProperties.standingTopology,
      deliveryProperties.subjectTopology,
      deliveryProperties.recoveryEligibility,
      deliveryProperties.activityTopology,
      deliveryProperties.operationEligibility,
      deliveryProperties.nonterminalProgress,
      deliveryProperties.terminalOrdering,
      deliveryProperties.journalCount,
    ]),
    bounds: Object.freeze({
      maxDepth: candidatePresent ? 3 : 4,
      maxNodes: candidatePresent ? 300 : 500,
      maxTransitions: candidatePresent ? 1_200 : 5_000,
    }),
    requiredCoverage: Object.freeze({
      phases: Object.freeze(candidatePresent
        ? ["uncertain", "applied", "not-applied", "retryable", "closed"]
        : [
            "started",
            "authorized",
            "uncertain",
            "applied",
            "not-applied",
            "retryable",
            "closed",
          ]),
      acceptedCommands: Object.freeze(NO_SHIP_COMMANDS
        .filter(({ id }) => !candidatePresent || (id !== "authenticate" && id !== "intend"))
        .map(({ id }) => id)),
      eventKinds: Object.freeze(candidatePresent ? [
        "activity-completed",
        "activity-recovery-recorded",
        "activity-started",
        "agent-attempt-prepared",
        "agent-work-product-submitted",
        "candidate-revision-observed",
        "check-receipt-recorded",
        "closure-recorded",
        "delivery-created",
        "execution-receipt-recorded",
        "director-brief-submitted",
        "director-decision-authenticated",
        "provider-effect-intended",
        "provider-effect-observed",
        "transaction-effect-intended",
        "transaction-effect-observed",
        "work-boundary-finalized",
      ] : [
        "activity-completed",
        "activity-recovery-recorded",
        "activity-started",
        "agent-attempt-prepared",
        "agent-pre-intent-refused",
        "agent-work-product-submitted",
        "check-receipt-recorded",
        "closure-recorded",
        "delivery-created",
        "execution-receipt-recorded",
        "director-brief-submitted",
        "director-decision-authenticated",
        "provider-effect-intended",
        "provider-effect-observed",
        "transaction-effect-intended",
        "transaction-effect-observed",
        "work-boundary-finalized",
      ]),
      seedEventKinds: Object.freeze(candidatePresent ? [
        "activity-completed",
        "activity-started",
        "agent-attempt-prepared",
        "agent-work-product-submitted",
        "candidate-revision-observed",
        "check-receipt-recorded",
        "delivery-created",
        "execution-receipt-recorded",
        "director-brief-submitted",
        "director-decision-authenticated",
        "provider-effect-intended",
        "provider-effect-observed",
        "transaction-effect-intended",
        "transaction-effect-observed",
        "work-boundary-finalized",
      ] : [
        "activity-completed",
        "activity-started",
        "agent-attempt-prepared",
        "agent-pre-intent-refused",
        "agent-work-product-submitted",
        "check-receipt-recorded",
        "delivery-created",
        "execution-receipt-recorded",
        "director-brief-submitted",
        "director-decision-authenticated",
        "provider-effect-intended",
        "provider-effect-observed",
        "transaction-effect-intended",
        "work-boundary-finalized",
      ]),
      generatedEventKinds: Object.freeze(candidatePresent ? [
        "activity-completed",
        "activity-recovery-recorded",
        "closure-recorded",
        "transaction-effect-observed",
      ] : [
        "activity-completed",
        "activity-recovery-recorded",
        "closure-recorded",
        "director-decision-authenticated",
        "transaction-effect-intended",
        "transaction-effect-observed",
      ]),
      recoveryCoordinates: Object.freeze(candidatePresent ? [
        "finalization/activity-completed",
        "finalization/transaction-finalization",
        "transaction/transaction-effect-observed",
      ] : [
        "finalization/activity-completed",
        "finalization/director-decision-authenticated",
        "finalization/transaction-effect-intended",
        "finalization/transaction-finalization",
        "transaction/transaction-effect-observed",
      ]),
    }),
    initialModel: Object.freeze({
      kind: "no-ship",
      phase: "uncertain",
      candidatePresent,
      originStanding: candidatePresent ? "active" : "framing",
      boundaryKind: candidatePresent ? "active" : "none",
    }),
    commands: NO_SHIP_COMMANDS,
  });
}

// This table is product-free: exact allowed integration transitions are stated
// independently of the reducer, with refused substitutions in the same alphabet.
type IntegrationPhase = "fresh" | "started" | "assessed-clean" | "assessed-context" | "conflicted" | "invalid" | "selected" | "needs-condition" | "paused" | "done-clean" | "done-conflict" | "done-invalid" | "done-paused";
function integrationModel(phase: IntegrationPhase): DeliveryOracleModel {
  const done = phase.startsWith("done-");
  const fresh = phase === "fresh";
  const paused = phase === "paused" || phase === "done-paused";
  const recoveryStep = phase === "started" ? "finalization/integration-assessed"
    : phase === "assessed-clean" || phase === "assessed-context" ? "candidate-observation/candidate-revision-observed"
      : phase === "needs-condition" ? "finalization/activity-finalization"
        : fresh || done ? null : "finalization/activity-completed";
  return Object.freeze({ kind: "integration", phase, candidatePresent: true,
    profile: explicitProfile({ standing: paused ? "boundary-paused" : "active",
      candidateCondition: fresh || done ? paused ? "paused-for-boundary" : "ready-for-work"
        : phase === "started" ? "in-progress" : "terminal-recovery",
      recovery: recoveryStep, activeActivityCount: fresh || done ? 0 : 1,
      ...(fresh || done ? {} : { activeOperation: "delivery.integrate", activeFamily: "integration", activeStage: phase === "started" ? "started" : "finalizing", recoveryEffectBinding: "none" }),
      subjects: { proposedBoundary: false, activeBoundary: true, candidate: true,
        integrationAssessment: !fresh && phase !== "started", materialCondition: paused, seal: false, evidence: false, closure: false },
      eligibleOperations: fresh || done ? paused ? BOUNDARY_PAUSED_OPERATIONS
        : phase === "done-clean" ? ACTIVE_OPERATIONS : UNINTEGRATED_ACTIVE_OPERATIONS : RECOVER_ONLY,
    }) });
}
const INTEGRATION_TRANSITIONS: Readonly<Record<string, Readonly<Partial<Record<IntegrationPhase, IntegrationPhase>>>>> = Object.freeze({
  start: { fresh: "started" },
  "assess-clean": { started: "assessed-clean" },
  "assess-context": { started: "assessed-context" },
  "assess-conflict": { started: "conflicted" },
  "assess-invalid": { started: "invalid" },
  "assess-wrong-source": {},
  candidate: { "assessed-clean": "selected", "assessed-context": "needs-condition" },
  "candidate-wrong-parent": {},
  "candidate-wrong-source": {},
  "candidate-wrong-boundary": {},
  "candidate-wrong-observation": {},
  condition: { "needs-condition": "paused" },
  complete: { selected: "done-clean", paused: "done-paused", conflicted: "done-conflict", invalid: "done-invalid" },
});
function integrationRefusal(command: string, phase: IntegrationPhase): string {
  if (command === "start") return REFUSAL.duplicate;
  // The exact unresolved Condition remains retained after Activity completion.
  if (command === "condition" && (phase === "paused" || phase === "done-paused")) return REFUSAL.duplicate;
  if (phase === "fresh" || phase.startsWith("done-")) return REFUSAL.activity;
  if (command.startsWith("assess-")) return phase === "started" ? REFUSAL.reference : REFUSAL.order;
  if (command.startsWith("candidate")) {
    if (["selected", "needs-condition", "paused"].includes(phase)) return REFUSAL.duplicate;
    return phase === "assessed-clean" || phase === "assessed-context" ? REFUSAL.reference : REFUSAL.order;
  }
  return REFUSAL.order;
}
export const integrationOracle: DeliveryOracle = Object.freeze({
  id: "delivery-exact-integration", clauses: Object.freeze([
    deliveryProperties.integrationOrdering, deliveryProperties.candidateCondition, deliveryProperties.subjectTopology,
    deliveryProperties.standingTopology, deliveryProperties.recoveryEligibility, deliveryProperties.activityTopology,
    deliveryProperties.operationEligibility, deliveryProperties.nonterminalProgress, deliveryProperties.journalCount,
  ]),
  bounds: { maxDepth: 6, maxNodes: 100, maxTransitions: 1200 },
  requiredCoverage: { phases: ["fresh", "started", "assessed-clean", "assessed-context", "conflicted", "invalid", "selected", "needs-condition", "paused", "done-clean", "done-conflict", "done-invalid", "done-paused"],
    acceptedCommands: ["start", "assess-clean", "assess-context", "assess-conflict", "assess-invalid", "candidate", "condition", "complete"],
    eventKinds: ["activity-started", "integration-assessed", "candidate-revision-observed", "material-condition-frozen", "activity-completed"], seedEventKinds: [], generatedEventKinds: ["activity-started", "integration-assessed", "candidate-revision-observed", "material-condition-frozen", "activity-completed"],
    recoveryCoordinates: ["finalization/integration-assessed", "candidate-observation/candidate-revision-observed", "finalization/activity-finalization", "finalization/activity-completed"] },
  initialModel: integrationModel("fresh"),
  commands: Object.freeze(Object.entries(INTEGRATION_TRANSITIONS).map(([id, transitions]) => ({ id,
    expectation(model: DeliveryOracleModel): TransitionExpectation<DeliveryOracleModel> {
      if (model.kind !== "integration") throw new TypeError("Integration oracle received another scenario model");
      const phase = model.phase as IntegrationPhase;
      const next = transitions[phase];
      return next === undefined ? { kind: "refused", classes: [integrationRefusal(id, phase)] }
        : { kind: "accepted", next: integrationModel(next) };
    },
  }))),
});

type PreIntentRefusalPhase = "opened" | "refused" | "abandoned" | "prepared" | "intended";

function preIntentRefusalModel(phase: PreIntentRefusalPhase): DeliveryOracleModel {
  const done = phase === "abandoned";
  const intended = phase === "intended";
  return Object.freeze({
    kind: "pre-intent-refusal",
    phase,
    candidatePresent: false,
    profile: explicitProfile({
      standing: "framing",
      candidateCondition: "absent",
      recovery: done ? null : recovery(intended ? "provider" : "finalization",
        intended ? "provider-effect-observed" : phase === "prepared"
          ? "provider-effect-intended" : phase === "refused"
            ? "activity-completed" : "agent-attempt-prepared"),
      activeActivityCount: done ? 0 : 1,
      ...(done ? {} : {
        activeOperation: "delivery.prepare",
        activeFamily: "agent" as const,
        activeStage: intended ? "effect-intended" as const : phase === "prepared"
          ? "prepared" as const : phase === "refused" ? "finalizing" as const : "started" as const,
        recoveryEffectBinding: intended ? "model-effect" as const : "none" as const,
      }),
      subjects: {
        proposedBoundary: false, activeBoundary: false, candidate: false,
        integrationAssessment: false, materialCondition: false, seal: false,
        evidence: false, closure: false,
      },
      eligibleOperations: done ? NO_SHIP_ONLY : RECOVER_ONLY,
    }),
  });
}

const PRE_INTENT_REFUSAL_TRANSITIONS: Readonly<Record<string,
  Readonly<Partial<Record<PreIntentRefusalPhase, PreIntentRefusalPhase>>>>> = Object.freeze({
  recover: { opened: "opened", refused: "refused", prepared: "prepared", intended: "intended" },
  "recover-wrong-step": {},
  "refuse-none": { opened: "refused" },
  "refuse-with-subject": {},
  "prepare-attempt": { opened: "prepared" },
  "intend-provider": { prepared: "intended" },
  "complete-abandoned": { refused: "abandoned" },
  "complete-failed": {},
  "complete-success": {},
});

/** One opened preparation, exact no-resolution refusal, and competing intent.
 * Depth four includes recover -> refuse -> recover -> abandoned. The oracle
 * models Journal order only, excluding clocks, Cells, SQLite and provider effects. */
export const preIntentRefusalOracle: DeliveryOracle = Object.freeze({
  id: "delivery-pre-intent-refusal-recovery",
  clauses: [deliveryProperties.preparationRecovery, deliveryProperties.activityTopology,
    deliveryProperties.candidateAbsence, deliveryProperties.standingTopology,
    deliveryProperties.subjectTopology, deliveryProperties.recoveryEligibility,
    deliveryProperties.operationEligibility, deliveryProperties.nonterminalProgress,
    deliveryProperties.journalCount],
  bounds: { maxDepth: 4, maxNodes: 100, maxTransitions: 512 },
  requiredCoverage: {
    phases: ["opened", "refused", "abandoned", "prepared", "intended"],
    acceptedCommands: ["recover", "refuse-none", "prepare-attempt", "intend-provider", "complete-abandoned"],
    eventKinds: ["delivery-created", "director-brief-submitted", "activity-started", "activity-recovery-recorded", "agent-pre-intent-refused",
      "agent-attempt-prepared", "provider-effect-intended", "activity-completed"],
    seedEventKinds: ["delivery-created", "director-brief-submitted", "activity-started"],
    generatedEventKinds: ["activity-recovery-recorded", "agent-pre-intent-refused",
      "agent-attempt-prepared", "provider-effect-intended", "activity-completed"],
    recoveryCoordinates: ["finalization/agent-attempt-prepared", "finalization/activity-completed",
      "finalization/provider-effect-intended", "provider/provider-effect-observed"],
  },
  initialModel: preIntentRefusalModel("opened"),
  commands: Object.entries(PRE_INTENT_REFUSAL_TRANSITIONS).map(([id, transitions]) => ({
    id,
    expectation(model: DeliveryOracleModel): TransitionExpectation<DeliveryOracleModel> {
      if (model.kind !== "pre-intent-refusal") throw new TypeError("Pre-intent refusal oracle received another model");
      const phase = model.phase as PreIntentRefusalPhase;
      const next = transitions[phase];
      if (next !== undefined) return {
        kind: "accepted", next: Object.freeze({ ...preIntentRefusalModel(next), effectDigest: model.effectDigest }),
      };
      const code = id === "refuse-with-subject" ? "lifecycle.delivery-event.subject"
        : phase === "abandoned" ? REFUSAL.activity
        : id === "recover-wrong-step" ? REFUSAL.recovery
        : id === "intend-provider" && (phase === "opened" || phase === "refused") ? REFUSAL.reference
        : REFUSAL.order;
      return { kind: "refused", classes: [code] };
    },
  })),
});

type ProjectionRefusalPhase = "ready" | "refused" | "frozen" | "resolution";
function projectionRefusalModel(phase: ProjectionRefusalPhase, operation: "delivery.continue" | "delivery.evaluate"): DeliveryOracleModel {
  const done = phase === "resolution";
  const frozen = phase === "frozen" || done;
  const reviewer = operation === "delivery.evaluate";
  return Object.freeze({ kind: "progression", phase, candidatePresent: true,
    profile: explicitProfile({
      standing: frozen ? "boundary-paused" : "active",
      candidateCondition: done ? "paused-for-boundary" : !reviewer && phase === "ready" ? "in-progress" : "terminal-recovery",
      recovery: done ? null : recovery("finalization", phase === "ready" ? reviewer ? "evaluation-checks" : "agent-attempt-prepared" : phase === "refused" ? "activity-finalization" : "activity-completed"),
      activeActivityCount: done ? 0 : 1,
      ...(done ? {} : { activeOperation: operation, activeFamily: "agent" as const, activeStage: !reviewer && phase === "ready" ? "started" as const : "finalizing" as const, recoveryEffectBinding: "none" as const }),
      subjects: { proposedBoundary: false, activeBoundary: true, candidate: true, integrationAssessment: true,
        materialCondition: frozen, seal: reviewer, evidence: false, closure: false },
      eligibleOperations: done ? BOUNDARY_PAUSED_OPERATIONS : RECOVER_ONLY,
    }),
  });
}
const PROJECTION_REFUSAL_TRANSITIONS: Readonly<Record<string, Readonly<Partial<Record<ProjectionRefusalPhase, ProjectionRefusalPhase>>>>> = {
  refuse: { ready: "refused" },
  freeze: { refused: "frozen" },
  "freeze-wrong-candidate": {},
  "freeze-wrong-facts": {},
  complete: { frozen: "resolution" },
  recover: { ready: "ready", refused: "refused", frozen: "frozen" },
};
function projectionRefusalOracleFor(operation: "delivery.continue" | "delivery.evaluate"): DeliveryOracle {
  const reviewer = operation === "delivery.evaluate";
  return Object.freeze({
  id: reviewer ? "delivery-measured-projection-refusal" : "delivery-measured-builder-projection-refusal",
  clauses: [deliveryProperties.candidateCondition, deliveryProperties.standingTopology, deliveryProperties.subjectTopology,
    deliveryProperties.recoveryEligibility, deliveryProperties.activityTopology, deliveryProperties.operationEligibility,
    deliveryProperties.nonterminalProgress, deliveryProperties.journalCount],
  bounds: { maxDepth: 4, maxNodes: 100, maxTransitions: 600 },
  requiredCoverage: {
    phases: ["ready", "refused", "frozen", "resolution"], acceptedCommands: ["refuse", "freeze", "complete", "recover"],
    eventKinds: [...(reviewer ? ["candidate-sealed", "check-receipt-recorded"] : ["activity-started"]), "agent-pre-intent-refused", "material-condition-frozen", "activity-completed", "activity-recovery-recorded"],
    seedEventKinds: reviewer ? ["candidate-sealed", "check-receipt-recorded"] : ["activity-started"],
    generatedEventKinds: ["agent-pre-intent-refused", "material-condition-frozen", "activity-completed", "activity-recovery-recorded"],
    recoveryCoordinates: [reviewer ? "finalization/evaluation-checks" : "finalization/agent-attempt-prepared", "finalization/activity-finalization", "finalization/activity-completed"],
  },
  initialModel: projectionRefusalModel("ready", operation),
  commands: Object.entries(PROJECTION_REFUSAL_TRANSITIONS).map(([id, transitions]) => ({ id,
    expectation(model: DeliveryOracleModel): TransitionExpectation<DeliveryOracleModel> {
      const phase = model.phase as ProjectionRefusalPhase;
      const next = transitions[phase];
      if (next !== undefined) return { kind: "accepted", next: projectionRefusalModel(next, operation) };
      const code = id.startsWith("freeze") && (phase === "frozen" || phase === "resolution") ? REFUSAL.duplicate
        : phase === "resolution" ? REFUSAL.activity
        : id === "freeze-wrong-candidate" && phase === "refused" ? REFUSAL.reference
        : id === "freeze-wrong-facts" && phase === "refused" ? "lifecycle.delivery-reducer.record-payload"
        : REFUSAL.order;
      return { kind: "refused", classes: [code] };
    },
  })),
});
}
export const projectionRefusalOracle = projectionRefusalOracleFor("delivery.evaluate");
export const builderProjectionRefusalOracle = projectionRefusalOracleFor("delivery.continue");
