import {
  FOUNDATION_RUNTIME_OPERATION_KINDS,
  type FoundationRuntimeOperationKind,
} from "@neutral/lifecycle-protocol";

export type TuiOperationClass =
  | "read-only"
  | "setup"
  | "productive"
  | "authority-bearing"
  | "terminal"
  | "recovery";

export type TuiOperationInputKind =
  | "none"
  | "initialization"
  | "semantic-markdown";

export type TuiOperationExposure =
  | "enabled-read-only"
  | "enabled-frame-prepare"
  | "enabled-next-pass"
  | "blocked-target-precondition"
  | "blocked-process-precondition";

export type TuiOperationPolicy = Readonly<{
  operation: FoundationRuntimeOperationKind;
  cliCommand: string;
  classes: readonly TuiOperationClass[];
  runtimeEligibleOperationIds: readonly string[];
  authoritySecretRequired: boolean;
  investmentRequired: boolean;
  inputKind: TuiOperationInputKind;
  exposure: TuiOperationExposure;
  effectSummary: string;
  blockedReason: string | null;
}>;

const TARGET_PRECONDITION_REASON =
  "This presentation hands initialization to the canonical CLI, which owns fresh-target validation, exact input, and Founder authority.";

const PROCESS_PRECONDITION_REASON =
  "This presentation hands the selected course to the canonical CLI, which re-observes the Process and owns execution.";

const AUTHORITY_PRECONDITION_REASON =
  "This presentation hands the selected course to the canonical CLI, which re-observes the Process and owns the exact Founder authorization subject and effect.";

const policy = (value: TuiOperationPolicy): TuiOperationPolicy => Object.freeze({
  ...value,
  classes: Object.freeze([...value.classes]),
  runtimeEligibleOperationIds: Object.freeze([...value.runtimeEligibleOperationIds]),
});

/**
 * Presentation policy for every operation in the public Foundation protocol.
 *
 * This registry classifies operations and the exact interface route. It is not
 * a transition table and MUST NOT be used to
 * infer live eligibility. Only a validated runtime status projection owns
 * eligibility, and an eligible marker remains descriptive rather than a
 * permit.
 */
export const FOUNDATION_TUI_OPERATION_POLICY = Object.freeze({
  "repository.initialize": policy({
    operation: "repository.initialize",
    cliCommand: "initialize",
    classes: ["setup", "authority-bearing"],
    runtimeEligibleOperationIds: [],
    authoritySecretRequired: true,
    investmentRequired: false,
    inputKind: "initialization",
    exposure: "blocked-target-precondition",
    effectSummary: "Create the fresh repository contract, machine authority, and target layout.",
    blockedReason: TARGET_PRECONDITION_REASON,
  }),
  "repository.validate": policy({
    operation: "repository.validate",
    cliCommand: "validate",
    classes: ["read-only"],
    runtimeEligibleOperationIds: [],
    authoritySecretRequired: false,
    investmentRequired: false,
    inputKind: "none",
    exposure: "enabled-read-only",
    effectSummary: "Inspect and validate the repository without changing it.",
    blockedReason: null,
  }),
  "delivery.inbox": policy({
    operation: "delivery.inbox",
    cliCommand: "inbox",
    classes: ["read-only"],
    runtimeEligibleOperationIds: [],
    authoritySecretRequired: false,
    investmentRequired: false,
    inputKind: "none",
    exposure: "enabled-read-only",
    effectSummary: "Read one bounded runtime-owned portfolio projection over current Delivery Stores.",
    blockedReason: null,
  }),
  "delivery.status": policy({
    operation: "delivery.status",
    cliCommand: "status",
    classes: ["read-only"],
    runtimeEligibleOperationIds: [],
    authoritySecretRequired: false,
    investmentRequired: false,
    inputKind: "none",
    exposure: "enabled-read-only",
    effectSummary: "Observe one protocol-coherent set of repository and Delivery Process coordinates.",
    blockedReason: null,
  }),
  "delivery.prepare": policy({
    operation: "delivery.prepare",
    cliCommand: "prepare",
    classes: ["productive"],
    runtimeEligibleOperationIds: ["delivery.prepare"],
    authoritySecretRequired: false,
    investmentRequired: true,
    inputKind: "semantic-markdown",
    exposure: "enabled-frame-prepare",
    effectSummary: "Fund reconnaissance and prepare a proposed Work Boundary.",
    blockedReason: null,
  }),
  "delivery.admit": policy({
    operation: "delivery.admit",
    cliCommand: "admit",
    classes: ["authority-bearing"],
    runtimeEligibleOperationIds: ["delivery.admit"],
    authoritySecretRequired: true,
    investmentRequired: false,
    inputKind: "none",
    exposure: "blocked-process-precondition",
    effectSummary: "Authenticate and activate the exact pending Work Boundary, initializing or preserving Candidate continuity as the phase requires.",
    blockedReason: AUTHORITY_PRECONDITION_REASON,
  }),
  "delivery.continue": policy({
    operation: "delivery.continue",
    cliCommand: "continue",
    classes: ["productive"],
    runtimeEligibleOperationIds: ["delivery.continue"],
    authoritySecretRequired: false,
    investmentRequired: true,
    inputKind: "semantic-markdown",
    exposure: "enabled-next-pass",
    effectSummary: "Continue bounded work on the exact current Candidate through one freshly funded builder Attempt.",
    blockedReason: null,
  }),
  "delivery.evaluate": policy({
    operation: "delivery.evaluate",
    cliCommand: "evaluate",
    classes: ["productive"],
    runtimeEligibleOperationIds: ["delivery.evaluate"],
    authoritySecretRequired: false,
    investmentRequired: true,
    inputKind: "semantic-markdown",
    exposure: "enabled-next-pass",
    effectSummary: "Seal and independently evaluate the exact Candidate.",
    blockedReason: null,
  }),
  "delivery.revise": policy({
    operation: "delivery.revise",
    cliCommand: "revise",
    classes: ["productive"],
    runtimeEligibleOperationIds: ["delivery.revise"],
    authoritySecretRequired: false,
    investmentRequired: true,
    inputKind: "semantic-markdown",
    exposure: "enabled-next-pass",
    effectSummary: "Resolve a Material Condition with a complete replacement mandate while preserving Candidate continuity.",
    blockedReason: null,
  }),
  "delivery.reaffirm": policy({
    operation: "delivery.reaffirm",
    cliCommand: "reaffirm",
    classes: ["productive"],
    runtimeEligibleOperationIds: ["delivery.reaffirm"],
    authoritySecretRequired: false,
    investmentRequired: true,
    inputKind: "semantic-markdown",
    exposure: "enabled-next-pass",
    effectSummary: "Resolve a Material Condition with a complete unchanged mandate while preserving Candidate continuity.",
    blockedReason: null,
  }),
  "delivery.accept": policy({
    operation: "delivery.accept",
    cliCommand: "accept",
    classes: ["authority-bearing", "terminal"],
    runtimeEligibleOperationIds: ["delivery.accept"],
    authoritySecretRequired: true,
    investmentRequired: false,
    inputKind: "none",
    exposure: "blocked-process-precondition",
    effectSummary: "Authenticate acceptance of the exact evidenced Candidate and perform the canonical terminal sequence.",
    blockedReason: AUTHORITY_PRECONDITION_REASON,
  }),
  "delivery.no-ship": policy({
    operation: "delivery.no-ship",
    cliCommand: "no-ship",
    classes: ["authority-bearing", "terminal"],
    runtimeEligibleOperationIds: ["delivery.no-ship"],
    authoritySecretRequired: true,
    investmentRequired: false,
    inputKind: "semantic-markdown",
    exposure: "blocked-process-precondition",
    effectSummary: "Authenticate the exact no-ship reason and Candidate disposition without integrating Candidate product bytes.",
    blockedReason: AUTHORITY_PRECONDITION_REASON,
  }),
  "delivery.recover": policy({
    operation: "delivery.recover",
    cliCommand: "recover",
    classes: ["recovery"],
    runtimeEligibleOperationIds: ["delivery.recover"],
    authoritySecretRequired: false,
    investmentRequired: false,
    inputKind: "none",
    exposure: "blocked-process-precondition",
    effectSummary: "Recover the exact runtime-selected retained Activity or post-Closure Store seal/archive disposition.",
    blockedReason: PROCESS_PRECONDITION_REASON,
  }),
  "delivery.inspect": policy({ operation: "delivery.inspect", cliCommand: "inspect", classes: ["read-only"], runtimeEligibleOperationIds: [], authoritySecretRequired: false, investmentRequired: false, inputKind: "none", exposure: "enabled-read-only", effectSummary: "Inspect one exact reducer-derived Delivery view through the canonical CLI.", blockedReason: null }),
  "delivery.diff": policy({ operation: "delivery.diff", cliCommand: "diff", classes: ["read-only"], runtimeEligibleOperationIds: [], authoritySecretRequired: false, investmentRequired: false, inputKind: "none", exposure: "enabled-read-only", effectSummary: "Render one bounded exact Candidate or decision diff selected by the runtime.", blockedReason: null }),
  "delivery.watch": policy({ operation: "delivery.watch", cliCommand: "watch", classes: ["read-only"], runtimeEligibleOperationIds: [], authoritySecretRequired: false, investmentRequired: false, inputKind: "none", exposure: "enabled-read-only", effectSummary: "Wait for one durable generation change and return a complete coherent runtime snapshot.", blockedReason: null }),
  "delivery.export": policy({ operation: "delivery.export", cliCommand: "export", classes: ["read-only"], runtimeEligibleOperationIds: [], authoritySecretRequired: false, investmentRequired: false, inputKind: "none", exposure: "blocked-process-precondition", effectSummary: "Export the exact Delivery through the canonical CLI.", blockedReason: PROCESS_PRECONDITION_REASON }),
} as const satisfies Readonly<Record<FoundationRuntimeOperationKind, TuiOperationPolicy>>);

export const FOUNDATION_TUI_ENABLED_OPERATIONS = Object.freeze(
  FOUNDATION_RUNTIME_OPERATION_KINDS.filter(
    (operation) => FOUNDATION_TUI_OPERATION_POLICY[operation].exposure === "enabled-read-only" ||
      FOUNDATION_TUI_OPERATION_POLICY[operation].exposure === "enabled-frame-prepare" ||
      FOUNDATION_TUI_OPERATION_POLICY[operation].exposure === "enabled-next-pass",
  ),
) as readonly FoundationRuntimeOperationKind[];

export function foundationTuiOperationPolicy(
  operation: FoundationRuntimeOperationKind,
): TuiOperationPolicy {
  return FOUNDATION_TUI_OPERATION_POLICY[operation];
}

export function foundationTuiCanExecute(
  operation: FoundationRuntimeOperationKind,
): boolean {
  const exposure = FOUNDATION_TUI_OPERATION_POLICY[operation].exposure;
  return exposure === "enabled-read-only" || exposure === "enabled-frame-prepare" ||
    exposure === "enabled-next-pass";
}
