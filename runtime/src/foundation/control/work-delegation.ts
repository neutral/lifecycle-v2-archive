import { FoundationError } from "../error.js";
import type { FoundationCheckCellOperationRequestV1 } from "../check/execution-cell-v1.js";
import type {
  FoundationExecutionBackendProfileReferenceV1,
  FoundationExecutionImageReferenceV1,
  FoundationExecutionSpecificationV1,
} from "../execution/contracts.js";
import { digestCanonical, type Sha256 } from "../validation/canonical.js";
import { knowledgeId } from "../validation/value.js";
import type { AgentAttemptInvestment } from "./agent-attempt.js";
import { canonicalControlEventJsonObject, controlIdentifier, controlTimestamp } from "./model.js";

export const WORK_DELEGATION_SCHEMA = "lifecycle.work-delegation.v2" as const;
export const WORK_DELEGATION_RESERVATION_SCHEMA = "lifecycle.work-delegation-reservation.v1" as const;
export const WORK_DELEGATION_POLICY_ID = "lifecycle.work-delegation.standard-v1" as const;
export const WORK_DELEGATION_OPERATIONS = Object.freeze([
  "delivery.continue", "delivery.evaluate", "delivery.integrate",
] as const);
export const WORK_DELEGATION_MAXIMUM_CELL_WALL_TIME_MS = 86_400_000;
export const WORK_DELEGATION_MAXIMUM_SLOTS = 4_097;

/** One fixed accounting/continuation selection, not a caller-authored policy language. */
export const WORK_DELEGATION_POLICY_DEFINITION = Object.freeze({
  id: WORK_DELEGATION_POLICY_ID,
  operations: WORK_DELEGATION_OPERATIONS,
  accounting: "delivery-lifetime-delegated-reservations-no-refunds",
  stop: "finish-reserved-operation",
  authority: "no-mandate-or-terminal-decision",
  continuation: "fresh-eligible-useful-work-after-settlement",
  maximumCellWallTimeMs: WORK_DELEGATION_MAXIMUM_CELL_WALL_TIME_MS,
  maximumSlots: WORK_DELEGATION_MAXIMUM_SLOTS,
} as const);
export const WORK_DELEGATION_POLICY_DIGEST = digestCanonical(WORK_DELEGATION_POLICY_DEFINITION);

export type WorkDelegationOperation = typeof WORK_DELEGATION_OPERATIONS[number];
export type WorkDelegationReference<Kind extends string = "work-delegation"> = Readonly<{
  kind: Kind;
  id: string;
  revision: number;
  digest: Sha256;
}>;
export type WorkDelegationAgentSelection = Readonly<{
  providerDescriptor: Readonly<{ id: string; digest: Sha256 }>;
  backendProfile: FoundationExecutionBackendProfileReferenceV1;
  image: FoundationExecutionImageReferenceV1;
  model: string;
  reasoning: string;
  wallTimeMs: number;
  limits: AgentAttemptInvestment["limits"];
}>;
export type WorkDelegationAccounting = Readonly<{
  operations: number;
  agentAttempts: number;
  reservedCellWallTimeMs: number;
}>;
export type WorkDelegationPayload = Readonly<{
  schema: typeof WORK_DELEGATION_SCHEMA;
  boundary: WorkDelegationReference<"work-boundary">;
  admission: WorkDelegationReference<"director-decision">;
  replaces: WorkDelegationReference | null;
  policy: Readonly<{ id: typeof WORK_DELEGATION_POLICY_ID; digest: Sha256 }>;
  allowedOperations: readonly WorkDelegationOperation[];
  directions: Readonly<{
    continue: WorkDelegationReference<"director-brief"> | null;
    evaluate: WorkDelegationReference<"director-brief"> | null;
  }>;
  agentSelections: Readonly<{
    builder: WorkDelegationAgentSelection | null;
    reviewer: WorkDelegationAgentSelection | null;
  }>;
  ceilings: WorkDelegationAccounting;
  expiresAt: string | null;
  stopPolicy: "finish-reserved-operation";
}>;
export type WorkDelegationExecutionSlot =
  | Readonly<{
      slotId: string;
      purpose: "agent";
      role: "builder" | "reviewer";
      selection: WorkDelegationAgentSelection;
    }>
  | Readonly<{
      slotId: string;
      purpose: "check";
      phase: "final";
      selectionId: string;
      definition: FoundationCheckCellOperationRequestV1["definition"];
      binding: Readonly<{ id: string; digest: Sha256 }>;
      backendProfile: FoundationExecutionBackendProfileReferenceV1;
      image: FoundationExecutionImageReferenceV1;
      wallTimeMs: number;
      /** Exact selected effective Check limits; interpreted by the Check/Execution owners. */
      limits: FoundationExecutionSpecificationV1["limits"];
    }>;
export type WorkDelegationReservation = Readonly<{
  schema: typeof WORK_DELEGATION_RESERVATION_SCHEMA;
  reservationId: string;
  delegation: WorkDelegationReference;
  activityId: string;
  operation: WorkDelegationOperation;
  decision: Readonly<{
    journalHead: Readonly<{ sequence: number; digest: Sha256 }>;
    basisDigest: Sha256;
    reason: "develop-candidate" | "integrate-ready-candidate"
      | "evaluate-integrated-candidate" | "correct-in-scope-findings";
  }>;
  charges: WorkDelegationAccounting;
  slots: readonly WorkDelegationExecutionSlot[];
}>;
export type WorkDelegationAllowance = Readonly<{
  allowed: boolean;
  reason: "within-allowance" | "stopped" | "expired" | "operation-not-delegated"
    | "selection-mismatch" | "operations-exhausted" | "agent-attempts-exhausted"
    | "cell-wall-time-exhausted";
  charged: WorkDelegationAccounting;
  prospective: WorkDelegationAccounting;
}>;

function fail(reason: string): never {
  throw new FoundationError("lifecycle.work-delegation.invalid", "Work delegation requires one exact bounded resource contract", {
    observedFacts: Object.freeze({ reason }),
  });
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("object");
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) fail("members");
  return record;
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || /[\r\n\u2028\u2029]/u.test(value)) fail("identity");
  return controlIdentifier(value, "Work delegation identity");
}

function opaque(value: unknown): string {
  const selected = identifier(value);
  if (selected.length > 160) fail("opaque-identity-bound");
  return selected;
}

function digest(value: unknown): Sha256 {
  if (typeof value !== "string" || value.length !== 71 || !/^sha256:[a-f0-9]{64}$/u.test(value)) fail("digest");
  return value as Sha256;
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) fail("integer-bound");
  return value;
}

function time(value: unknown): string {
  if (typeof value !== "string") fail("time");
  return controlTimestamp(value, "Work delegation time");
}

function exactReference<Kind extends string>(value: unknown, kind: Kind): WorkDelegationReference<Kind> {
  const selected = object(value, ["kind", "id", "revision", "digest"]);
  if (selected.kind !== kind) fail("reference-kind");
  return Object.freeze({ kind, id: identifier(selected.id), revision: integer(selected.revision, 1), digest: digest(selected.digest) });
}

function resourceReference(value: unknown): Readonly<{ id: string; digest: Sha256 }> {
  const selected = object(value, ["id", "digest"]);
  return Object.freeze({ id: identifier(selected.id), digest: digest(selected.digest) });
}

function backend(value: unknown): FoundationExecutionBackendProfileReferenceV1 {
  const selected = object(value, ["profileId", "profileDigest", "implementationDigest"]);
  if (selected.profileId !== "lifecycle.execution-backend-profile.docker-local.v1" &&
      selected.profileId !== "lifecycle.execution-backend-profile.fault-injection.v1") fail("backend-profile");
  return Object.freeze({ profileId: selected.profileId, profileDigest: digest(selected.profileDigest), implementationDigest: digest(selected.implementationDigest) });
}

function image(value: unknown): FoundationExecutionImageReferenceV1 {
  const selected = object(value, ["imageId", "imageDigest"]);
  return Object.freeze({ imageId: identifier(selected.imageId), imageDigest: digest(selected.imageDigest) });
}

function agentLimits(value: unknown): AgentAttemptInvestment["limits"] {
  const selected = object(value, ["tokens", "events", "outputBytes", "toolCalls", "processes", "storageBytes"]);
  const limit = (key: string): number | null => selected[key] === null ? null : integer(selected[key], 1);
  return Object.freeze({ tokens: limit("tokens"), events: limit("events"), outputBytes: limit("outputBytes"), toolCalls: limit("toolCalls"), processes: limit("processes"), storageBytes: limit("storageBytes") });
}

function agentSelection(value: unknown): WorkDelegationAgentSelection {
  const selected = object(value, ["providerDescriptor", "backendProfile", "image", "model", "reasoning", "wallTimeMs", "limits"]);
  return Object.freeze({
    providerDescriptor: resourceReference(selected.providerDescriptor), backendProfile: backend(selected.backendProfile),
    image: image(selected.image), model: opaque(selected.model), reasoning: opaque(selected.reasoning),
    wallTimeMs: integer(selected.wallTimeMs, 1, WORK_DELEGATION_MAXIMUM_CELL_WALL_TIME_MS), limits: agentLimits(selected.limits),
  });
}

function executionLimits(value: unknown): FoundationExecutionSpecificationV1["limits"] {
  const selected = object(value, ["wallTimeMilliseconds", "processes", "storageBytes", "outputEntries", "outputBytes", "outputEntryBytes", "events"]);
  return Object.freeze({
    wallTimeMilliseconds: integer(selected.wallTimeMilliseconds, 1, WORK_DELEGATION_MAXIMUM_CELL_WALL_TIME_MS),
    processes: integer(selected.processes, 1), storageBytes: integer(selected.storageBytes, 1),
    outputEntries: integer(selected.outputEntries, 1), outputBytes: integer(selected.outputBytes, 1),
    outputEntryBytes: integer(selected.outputEntryBytes, 1), events: integer(selected.events, 1),
  });
}

export function parseWorkDelegationAccounting(value: unknown): WorkDelegationAccounting {
  const selected = object(value, ["operations", "agentAttempts", "reservedCellWallTimeMs"]);
  return Object.freeze({ operations: integer(selected.operations), agentAttempts: integer(selected.agentAttempts), reservedCellWallTimeMs: integer(selected.reservedCellWallTimeMs) });
}

export function parseWorkDelegationPayload(value: unknown): WorkDelegationPayload {
  const selected = object(value, ["schema", "boundary", "admission", "replaces", "policy", "allowedOperations", "directions", "agentSelections", "ceilings", "expiresAt", "stopPolicy"]);
  if (selected.schema !== WORK_DELEGATION_SCHEMA || selected.stopPolicy !== "finish-reserved-operation") fail("profile");
  const policy = object(selected.policy, ["id", "digest"]);
  if (policy.id !== WORK_DELEGATION_POLICY_ID || policy.digest !== WORK_DELEGATION_POLICY_DIGEST) fail("policy");
  if (!Array.isArray(selected.allowedOperations) || selected.allowedOperations.length < 1 || selected.allowedOperations.length > 3) fail("operations");
  const operationInputs: unknown[] = selected.allowedOperations;
  const allowedOperations = operationInputs.map((operation: unknown, index: number) => {
    if (!WORK_DELEGATION_OPERATIONS.includes(operation as WorkDelegationOperation)) fail("operation");
    if (index > 0 && String(operationInputs[index - 1]) >= String(operation)) fail("operation-order");
    return operation as WorkDelegationOperation;
  });
  const directions = object(selected.directions, ["continue", "evaluate"]);
  const selections = object(selected.agentSelections, ["builder", "reviewer"]);
  const builder = allowedOperations.includes("delivery.continue");
  const reviewer = allowedOperations.includes("delivery.evaluate");
  if ((directions.continue !== null) !== builder || (selections.builder !== null) !== builder ||
      (directions.evaluate !== null) !== reviewer || (selections.reviewer !== null) !== reviewer) fail("operation-inputs");
  const ceilings = parseWorkDelegationAccounting(selected.ceilings);
  if (ceilings.operations < 1 || ((builder || reviewer) && (ceilings.agentAttempts < 1 || ceilings.reservedCellWallTimeMs < 1))) fail("empty-allowance");
  return Object.freeze({
    schema: WORK_DELEGATION_SCHEMA,
    boundary: exactReference(selected.boundary, "work-boundary"), admission: exactReference(selected.admission, "director-decision"),
    replaces: selected.replaces === null ? null : exactReference(selected.replaces, "work-delegation"),
    policy: Object.freeze({ id: WORK_DELEGATION_POLICY_ID, digest: WORK_DELEGATION_POLICY_DIGEST }),
    allowedOperations: Object.freeze(allowedOperations),
    directions: Object.freeze({ continue: directions.continue === null ? null : exactReference(directions.continue, "director-brief"), evaluate: directions.evaluate === null ? null : exactReference(directions.evaluate, "director-brief") }),
    agentSelections: Object.freeze({ builder: selections.builder === null ? null : agentSelection(selections.builder), reviewer: selections.reviewer === null ? null : agentSelection(selections.reviewer) }),
    ceilings, expiresAt: selected.expiresAt === null ? null : time(selected.expiresAt), stopPolicy: "finish-reserved-operation",
  });
}

function executionSlot(value: unknown): WorkDelegationExecutionSlot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("slot");
  if ((value as Record<string, unknown>).purpose === "agent") {
    const selected = object(value, ["slotId", "purpose", "role", "selection"]);
    if (selected.role !== "builder" && selected.role !== "reviewer") fail("agent-role");
    return Object.freeze({ slotId: identifier(selected.slotId), purpose: "agent", role: selected.role, selection: agentSelection(selected.selection) });
  }
  const selected = object(value, ["slotId", "purpose", "phase", "selectionId", "definition", "binding", "backendProfile", "image", "wallTimeMs", "limits"]);
  if (selected.purpose !== "check" || selected.phase !== "final") fail("check-phase");
  const wallTimeMs = integer(selected.wallTimeMs, 1, WORK_DELEGATION_MAXIMUM_CELL_WALL_TIME_MS);
  const limits = executionLimits(selected.limits);
  if (limits.wallTimeMilliseconds !== wallTimeMs) fail("check-wall-time");
  const definition = object(selected.definition, ["id", "revision", "sourceDigest", "semanticDigest"]);
  const definitionId = knowledgeId(opaque(definition.id), "Reserved Check Definition identity");
  if (!definitionId.startsWith("check.")) fail("check-definition-kind");
  return Object.freeze({ slotId: identifier(selected.slotId), purpose: "check", phase: "final", selectionId: identifier(selected.selectionId), definition: Object.freeze({ id: definitionId, revision: integer(definition.revision, 1), sourceDigest: digest(definition.sourceDigest), semanticDigest: digest(definition.semanticDigest) }), binding: resourceReference(selected.binding), backendProfile: backend(selected.backendProfile), image: image(selected.image), wallTimeMs, limits });
}

/** All additions use safe-integer arithmetic; no measured usage or refund is inferred. */
export function addWorkDelegationAccounting(left: WorkDelegationAccounting, right: WorkDelegationAccounting): WorkDelegationAccounting {
  const before = parseWorkDelegationAccounting(left);
  const added = parseWorkDelegationAccounting(right);
  return parseWorkDelegationAccounting({ operations: before.operations + added.operations, agentAttempts: before.agentAttempts + added.agentAttempts, reservedCellWallTimeMs: before.reservedCellWallTimeMs + added.reservedCellWallTimeMs });
}

function reservationParts(value: unknown): Omit<WorkDelegationReservation, "charges"> {
  const selected = object(value, ["schema", "reservationId", "delegation", "activityId", "operation", "decision", "slots"]);
  if (selected.schema !== WORK_DELEGATION_RESERVATION_SCHEMA || !WORK_DELEGATION_OPERATIONS.includes(selected.operation as WorkDelegationOperation)) fail("reservation-operation");
  const operation = selected.operation as WorkDelegationOperation;
  const decision = object(selected.decision, ["journalHead", "basisDigest", "reason"]);
  const head = object(decision.journalHead, ["sequence", "digest"]);
  const reasons = operation === "delivery.continue" ? ["develop-candidate", "correct-in-scope-findings"]
    : operation === "delivery.integrate" ? ["integrate-ready-candidate"] : ["evaluate-integrated-candidate"];
  if (typeof decision.reason !== "string" || !reasons.includes(decision.reason)) fail("decision-reason");
  if (!Array.isArray(selected.slots) || selected.slots.length > WORK_DELEGATION_MAXIMUM_SLOTS) fail("slot-bound");
  const slots = selected.slots.map(executionSlot);
  const checks = new Set<string>();
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index]!;
    if (index > 0 && slots[index - 1]!.slotId >= slot.slotId) fail("slot-order");
    if (slot.purpose === "check") {
      if (checks.has(slot.selectionId)) fail("duplicate-check-selection");
      checks.add(slot.selectionId);
    }
  }
  const agents = slots.filter((slot) => slot.purpose === "agent");
  if (operation === "delivery.integrate" ? slots.length !== 0
    : agents.length !== 1 || agents[0]!.role !== (operation === "delivery.continue" ? "builder" : "reviewer") ||
      (operation === "delivery.continue" && slots.length !== 1)) fail("operation-slots");
  return Object.freeze({ schema: WORK_DELEGATION_RESERVATION_SCHEMA, reservationId: identifier(selected.reservationId), delegation: exactReference(selected.delegation, "work-delegation"), activityId: identifier(selected.activityId), operation,
    decision: Object.freeze({ journalHead: Object.freeze({ sequence: integer(head.sequence, 1), digest: digest(head.digest) }), basisDigest: digest(decision.basisDigest), reason: decision.reason as WorkDelegationReservation["decision"]["reason"] }), slots: Object.freeze(slots) });
}

/** Compile only operation-owned slots. Store/reducer owners establish currentness and permission. */
export function compileWorkDelegationReservation(value: Omit<WorkDelegationReservation, "charges">): WorkDelegationReservation {
  const selected = reservationParts(value);
  let charges: WorkDelegationAccounting = Object.freeze({ operations: 1, agentAttempts: 0, reservedCellWallTimeMs: 0 });
  for (const slot of selected.slots) {
    charges = addWorkDelegationAccounting(charges, { operations: 0, agentAttempts: slot.purpose === "agent" ? 1 : 0, reservedCellWallTimeMs: slot.purpose === "agent" ? slot.selection.wallTimeMs : slot.wallTimeMs });
  }
  const reservation = Object.freeze({ ...selected, charges });
  try {
    // Check the complete existing opening payload, not merely the slot count.
    // The Control owner retains its 64-KiB canonical payload and JSON bounds.
    canonicalControlEventJsonObject({ activityId: selected.activityId, operation: selected.operation, reservation }, "Delegated Activity opening");
  } catch (error) {
    if (error instanceof FoundationError && error.code === "lifecycle.control-record-store.json-bounds") {
      throw new FoundationError("lifecycle.work-delegation.resource-limit", "The complete delegated Activity reservation exceeds the Control opening bound; select explicit manual work or a smaller lawful delegated operation", {
        observedFacts: Object.freeze({ reason: "activity-opening-bound" }),
      });
    }
    throw error;
  }
  return reservation;
}

export function parseWorkDelegationReservation(value: unknown): WorkDelegationReservation {
  const selected = object(value, ["schema", "reservationId", "delegation", "activityId", "operation", "decision", "charges", "slots"]);
  const { charges, ...parts } = selected;
  const compiled = compileWorkDelegationReservation(parts as Omit<WorkDelegationReservation, "charges">);
  if (digestCanonical(parseWorkDelegationAccounting(charges)) !== digestCanonical(compiled.charges)) fail("reservation-charges");
  return compiled;
}

/** Pure resource assessment only. Exact grant/Boundary/Brief/Check joins and durable stop are owning inputs. */
export function assessWorkDelegationAllowance(input: Readonly<{
  delegation: WorkDelegationPayload;
  accounting: WorkDelegationAccounting;
  reservation: WorkDelegationReservation;
  observedAt: string;
  stopped: boolean;
}>): WorkDelegationAllowance {
  const grant = parseWorkDelegationPayload(input.delegation);
  const charged = parseWorkDelegationAccounting(input.accounting);
  const reservation = parseWorkDelegationReservation(input.reservation);
  const observedAt = time(input.observedAt);
  if (typeof input.stopped !== "boolean") fail("stop-observation");
  const prospective = addWorkDelegationAccounting(charged, reservation.charges);
  const agent = reservation.slots.find((slot) => slot.purpose === "agent");
  const selectedAgent = agent?.purpose === "agent" ? grant.agentSelections[agent.role] : null;
  const reason: WorkDelegationAllowance["reason"] = input.stopped ? "stopped"
    : grant.expiresAt !== null && Date.parse(observedAt) >= Date.parse(grant.expiresAt) ? "expired"
    : !grant.allowedOperations.includes(reservation.operation) ? "operation-not-delegated"
    : agent?.purpose === "agent" && digestCanonical(agent.selection) !== digestCanonical(selectedAgent) ? "selection-mismatch"
    : prospective.operations > grant.ceilings.operations ? "operations-exhausted"
    : prospective.agentAttempts > grant.ceilings.agentAttempts ? "agent-attempts-exhausted"
    : prospective.reservedCellWallTimeMs > grant.ceilings.reservedCellWallTimeMs ? "cell-wall-time-exhausted"
    : "within-allowance";
  return Object.freeze({ allowed: reason === "within-allowance", reason, charged, prospective });
}
