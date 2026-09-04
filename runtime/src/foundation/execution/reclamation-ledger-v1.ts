import { randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
} from "node:fs/promises";
import { basename, join, parse as parsePath, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { controlIdentifier } from "../control/model.js";
import type { ControlJsonObject } from "../control/types.js";
import { FoundationError } from "../error.js";
import {
  assertDigest,
  canonicalJson,
  digestCanonical,
  selfDigest,
  type Sha256,
} from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import { assertFoundationSchema } from "../validation/schema-engine.js";
import {
  parseExecutionReclamationBinding,
  parseExecutionReclamationObligation,
  parseExecutionReclamationObservation,
  privateFoundationExecutionHandle,
  type FoundationExecutionHandle,
  type FoundationExecutionReclamationBindingV1,
  type FoundationExecutionReclamationObligationV1,
  type FoundationExecutionReclamationObservationV1,
} from "./backend.js";
import {
  FOUNDATION_EXECUTION_SPECIFICATION_SCHEMA_ID,
  type FoundationExecutionSpecificationV1,
} from "./contracts.js";

export const FOUNDATION_EXECUTION_RECLAMATION_LEDGER_SCHEMA =
  "lifecycle.execution-reclamation-ledger.private.v1" as const;
export const FOUNDATION_EXECUTION_RECLAMATION_HANDOFF_SCHEMA =
  "lifecycle.execution-reclamation-handoff.private.v1" as const;
export const FOUNDATION_EXECUTION_RECLAMATION_STANDING_SCHEMA =
  "lifecycle.execution-reclamation-standing.private.v1" as const;
export const FOUNDATION_EXECUTION_RECLAMATION_CLAIM_SCHEMA =
  "lifecycle.execution-reclamation-claim.private.v1" as const;

const DATABASE_FILENAME = "execution-reclamation-ledger-v1.sqlite";
const LEDGER_ROOT_DIRECTORY = "execution-reclamation";
const DATABASE_APPLICATION_ID = 0x4c455852;
const DATABASE_USER_VERSION = 1;
const MAXIMUM_HANDOFFS = 10_000;
const MAXIMUM_OUTSTANDING_HANDOFFS = 64;
const MAXIMUM_JSON_BYTES = 1024 * 1024;
const MINIMUM_LEASE_MILLISECONDS = 1_000;
const MAXIMUM_LEASE_MILLISECONDS = 5 * 60 * 1_000;
const MAXIMUM_RETRY_MILLISECONDS = 60 * 1_000;
const CLAIM_TOKEN_PATTERN = /^reclamation-claim-v1:[a-f0-9]{64}$/u;
const CANONICAL_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

type SqlRow = Readonly<Record<string, unknown>>;

export type FoundationExecutionReclamationOwnerV1 = Readonly<{
  storeId: string;
  processId: string;
  activityId: string;
  kind: "agent-attempt" | "check";
  subjectDigest: Sha256;
}>;

export type FoundationExecutionReclamationHandoffInputV1 = Readonly<{
  owner: FoundationExecutionReclamationOwnerV1;
  specification: FoundationExecutionSpecificationV1;
  handle: FoundationExecutionHandle;
  reclamationBinding: FoundationExecutionReclamationBindingV1;
  obligation: FoundationExecutionReclamationObligationV1;
  retirementDigest: Sha256;
  dispatchAuthorityConsumed: boolean;
}>;

export type FoundationExecutionReclamationHandoffV1 = Readonly<{
  schema: typeof FOUNDATION_EXECUTION_RECLAMATION_HANDOFF_SCHEMA;
  installationId: string;
  owner: FoundationExecutionReclamationOwnerV1;
  specification: FoundationExecutionSpecificationV1;
  handle: FoundationExecutionHandle;
  reclamationBinding: FoundationExecutionReclamationBindingV1;
  obligation: FoundationExecutionReclamationObligationV1;
  retirementDigest: Sha256;
  dispatchAuthorityConsumed: boolean;
  acceptedAt: string;
  coreDigest: Sha256;
  digest: Sha256;
}>;

export type FoundationExecutionReclamationStandingStateV1 =
  | "pending"
  | "claimed"
  | "reclaimed"
  | "integrity-refusal";

export type FoundationExecutionReclamationStandingV1 = Readonly<{
  schema: typeof FOUNDATION_EXECUTION_RECLAMATION_STANDING_SCHEMA;
  obligationDigest: Sha256;
  generation: number;
  state: FoundationExecutionReclamationStandingStateV1;
  attemptCount: number;
  nextAttemptAt: string | null;
  claimToken: string | null;
  claimExpiresAt: string | null;
  lastObservation: FoundationExecutionReclamationObservationV1 | null;
  updatedAt: string;
  digest: Sha256;
}>;

export type FoundationExecutionReclamationClaimV1 = Readonly<{
  schema: typeof FOUNDATION_EXECUTION_RECLAMATION_CLAIM_SCHEMA;
  handoff: FoundationExecutionReclamationHandoffV1;
  standingGeneration: number;
  standingDigest: Sha256;
  claimToken: string;
  claimedAt: string;
  expiresAt: string;
  digest: Sha256;
}>;

export type FoundationExecutionReclamationLedgerEntryV1 = Readonly<{
  obligationDigest: Sha256;
  handoffDigest: Sha256;
  specificationDigest: Sha256;
  reclamationBindingDigest: Sha256;
  retirementDigest: Sha256;
  owner: FoundationExecutionReclamationOwnerV1;
  acceptedAt: string;
  standing: Readonly<{
    state: FoundationExecutionReclamationStandingStateV1;
    attemptCount: number;
    nextAttemptAt: string | null;
    claimExpiresAt: string | null;
    lastObservationDigest: Sha256 | null;
    lastDisposition: FoundationExecutionReclamationObservationV1["disposition"] | null;
    updatedAt: string;
    digest: Sha256;
  }>;
}>;

export type FoundationExecutionReclamationLedgerSummaryV1 = Readonly<{
  schema: "lifecycle.execution-reclamation-ledger-summary.private.v1";
  storeId: string;
  processId: string;
  obligationSetDigest: Sha256;
  obligationCount: number;
  pendingCount: number;
  claimedCount: number;
  reclaimedCount: number;
  integrityRefusalCount: number;
  digest: Sha256;
}>;

export type FoundationExecutionReclamationTerminalReceiptV1 = Readonly<{
  kind: "execution-receipt" | "check-receipt";
  id: string;
  revision: number;
  digest: Sha256;
}>;

export type FoundationExecutionReclamationTerminalEventReferenceV1 = Readonly<{
  sequence: number;
  eventId: string;
  digest: Sha256;
}>;

/**
 * One Control-derived terminal execution subject. The Receipt reference is
 * stable Control identity; the owner is the exact private ledger owner that
 * must have handed off one retired allocation.
 */
export type FoundationExecutionReclamationTerminalSubjectV1 = Readonly<{
  receipt: FoundationExecutionReclamationTerminalReceiptV1;
  owner: FoundationExecutionReclamationOwnerV1;
  retirementFactsDigest: Sha256;
}>;

/**
 * One existing subjectless Control refusal event. Control validates the event
 * kind, subject, and payload before supplying this selector; the private
 * ledger resolves it to the unique never-dispatched Agent allocation for the
 * same Activity whose completed Retirement makes the Handle non-reusable,
 * without exposing the compiled-but-unretained Attempt identity.
 */
export type FoundationExecutionReclamationPreIntentRefusalV1 = Readonly<{
  event: FoundationExecutionReclamationTerminalEventReferenceV1;
  activityId: string;
}>;

/** Stable facts safe to retain after exact private ledger reconciliation. */
export type FoundationExecutionReclamationTerminalVerificationV1 = Readonly<{
  terminalExecutionSetDigest: Sha256;
  executionCount: number;
  preIntentRefusalSetDigest: Sha256;
  preIntentRefusalCount: number;
  obligationSetDigest: Sha256;
  obligationCount: number;
}>;

export type FoundationExecutionReclamationLedgerPathsV1 = Readonly<{
  root: string;
  database: string;
}>;

export type FoundationExecutionReclamationLedgerClockV1 = Readonly<{
  now(): string;
}>;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.execution.reclamation-ledger-v1.${code}`, message);
}

function exactKeys(value: object, keys: readonly string[], label: string): void {
  if (canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) {
    fail("shape", `${label} is not one exact closed object`);
  }
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") fail("database-row", `${label} is not one text value`);
  return value;
}

function integer(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)) fail("database-row", `${label} is not one safe integer`);
  return Number(value);
}

function booleanInteger(value: unknown, label: string): boolean {
  const selected = integer(value, label);
  if (selected !== 0 && selected !== 1) fail("database-row", `${label} is not one Boolean integer`);
  return selected === 1;
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : string(value, label);
}

function digest(value: unknown, label: string): Sha256 {
  try {
    assertDigest(value, label);
    return value;
  } catch {
    return fail("digest", `${label} is not one exact SHA-256 digest`);
  }
}

function timestamp(value: unknown, label: string): string {
  if (typeof value !== "string" || !CANONICAL_TIME_PATTERN.test(value) ||
      Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    fail("time", `${label} is not one canonical UTC millisecond timestamp`);
  }
  return value;
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== "string") fail("identity", `${label} is not one bounded identity`);
  try {
    return controlIdentifier(value, label);
  } catch {
    return fail("identity", `${label} is not one bounded identity`);
  }
}

function positiveInteger(value: unknown, label: string): number {
  const selected = integer(value, label);
  if (selected < 1) fail("terminal-subject-set", `${label} is not one positive safe integer`);
  return selected;
}

function terminalOwner(
  value: unknown,
  storeId: string,
  processId: string,
): FoundationExecutionReclamationOwnerV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("terminal-subject-set", "Terminal execution owner is not one exact object");
  }
  exactKeys(
    value,
    ["activityId", "kind", "processId", "storeId", "subjectDigest"],
    "Terminal execution owner",
  );
  const owner = value as Record<string, unknown>;
  if (owner.kind !== "agent-attempt" && owner.kind !== "check") {
    fail("terminal-subject-set", "Terminal execution owner kind is unsupported");
  }
  const parsed = Object.freeze({
    storeId: identifier(owner.storeId, "Terminal execution Store identity"),
    processId: identifier(owner.processId, "Terminal execution Process identity"),
    activityId: identifier(owner.activityId, "Terminal execution Activity identity"),
    kind: owner.kind,
    subjectDigest: digest(owner.subjectDigest, "Terminal execution owner subject"),
  });
  if (parsed.storeId !== storeId || parsed.processId !== processId) {
    fail("terminal-subject-set", "Terminal execution owner selects another Store or Process");
  }
  return parsed;
}

function terminalReceipt(
  value: unknown,
  ownerKind: FoundationExecutionReclamationOwnerV1["kind"],
): FoundationExecutionReclamationTerminalReceiptV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("terminal-subject-set", "Terminal execution Receipt is not one exact object");
  }
  exactKeys(value, ["digest", "id", "kind", "revision"], "Terminal execution Receipt");
  const receipt = value as Record<string, unknown>;
  if (receipt.kind !== "execution-receipt" && receipt.kind !== "check-receipt") {
    fail("terminal-subject-set", "Terminal execution Receipt kind is unsupported");
  }
  if (
    (receipt.kind === "execution-receipt" && ownerKind !== "agent-attempt") ||
    (receipt.kind === "check-receipt" && ownerKind !== "check")
  ) {
    fail("terminal-subject-set", "Terminal execution Receipt kind differs from its ledger owner");
  }
  return Object.freeze({
    kind: receipt.kind,
    id: identifier(receipt.id, "Terminal execution Receipt identity"),
    revision: positiveInteger(receipt.revision, "Terminal execution Receipt revision"),
    digest: digest(receipt.digest, "Terminal execution Receipt digest"),
  });
}

function normalizedTerminalSubjects(input: Readonly<{
  storeId: string;
  processId: string;
  subjects: readonly FoundationExecutionReclamationTerminalSubjectV1[];
}>): readonly FoundationExecutionReclamationTerminalSubjectV1[] {
  if (!Array.isArray(input.subjects) || input.subjects.length > MAXIMUM_HANDOFFS) {
    fail("terminal-subject-set", "Terminal execution subject set exceeds its ledger bound");
  }
  const subjects = input.subjects.map((value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      fail("terminal-subject-set", "Terminal execution subject is not one exact object");
    }
    exactKeys(
      value,
      ["owner", "receipt", "retirementFactsDigest"],
      "Terminal execution subject",
    );
    const owner = terminalOwner(value.owner, input.storeId, input.processId);
    return Object.freeze({
      receipt: terminalReceipt(value.receipt, owner.kind),
      owner,
      retirementFactsDigest: digest(
        value.retirementFactsDigest,
        "Terminal execution Retirement facts",
      ),
    });
  }).sort((left, right) => compareCodePoints(canonicalJson(left), canonicalJson(right)));
  const receiptKeys = new Set<string>();
  const ownerKeys = new Set<string>();
  for (const subject of subjects) {
    const receiptKey = canonicalJson(subject.receipt);
    const ownerKey = canonicalJson(subject.owner);
    if (receiptKeys.has(receiptKey) || ownerKeys.has(ownerKey)) {
      fail("terminal-subject-set", "Terminal execution subjects repeat a Receipt or ledger owner");
    }
    receiptKeys.add(receiptKey);
    ownerKeys.add(ownerKey);
  }
  return Object.freeze(subjects);
}

function terminalEventReference(
  value: unknown,
): FoundationExecutionReclamationTerminalEventReferenceV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("terminal-subject-set", "Pre-intent refusal event reference is not one exact object");
  }
  exactKeys(value, ["digest", "eventId", "sequence"], "Pre-intent refusal event reference");
  const event = value as Record<string, unknown>;
  return Object.freeze({
    sequence: positiveInteger(event.sequence, "Pre-intent refusal event sequence"),
    eventId: identifier(event.eventId, "Pre-intent refusal event identity"),
    digest: digest(event.digest, "Pre-intent refusal event digest"),
  });
}

function normalizedPreIntentRefusals(input: Readonly<{
  preIntentRefusals: readonly FoundationExecutionReclamationPreIntentRefusalV1[];
}>): readonly FoundationExecutionReclamationPreIntentRefusalV1[] {
  if (!Array.isArray(input.preIntentRefusals) ||
      input.preIntentRefusals.length > MAXIMUM_HANDOFFS) {
    fail("terminal-subject-set", "Pre-intent refusal selector set exceeds its ledger bound");
  }
  const refusals = input.preIntentRefusals.map((value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      fail("terminal-subject-set", "Pre-intent refusal selector is not one exact object");
    }
    exactKeys(value, ["activityId", "event"], "Pre-intent refusal selector");
    return Object.freeze({
      event: terminalEventReference(value.event),
      activityId: identifier(value.activityId, "Pre-intent refusal Activity identity"),
    });
  }).sort((left, right) => compareCodePoints(canonicalJson(left), canonicalJson(right)));
  const eventSequences = new Set<number>();
  const eventIds = new Set<string>();
  const eventDigests = new Set<Sha256>();
  const activityIds = new Set<string>();
  for (const refusal of refusals) {
    if (eventSequences.has(refusal.event.sequence) ||
        eventIds.has(refusal.event.eventId) ||
        eventDigests.has(refusal.event.digest) ||
        activityIds.has(refusal.activityId)) {
      fail("terminal-subject-set", "Pre-intent refusal selectors repeat an event or Activity");
    }
    eventSequences.add(refusal.event.sequence);
    eventIds.add(refusal.event.eventId);
    eventDigests.add(refusal.event.digest);
    activityIds.add(refusal.activityId);
  }
  return Object.freeze(refusals);
}

/** Bind the exact Control refusal selectors independently of Receipt executions. */
export function foundationExecutionReclamationPreIntentRefusalSetDigestV1(
  input: Readonly<{
    storeId: string;
    processId: string;
    preIntentRefusals: readonly FoundationExecutionReclamationPreIntentRefusalV1[];
  }>,
): Sha256 {
  const storeId = identifier(input.storeId, "Pre-intent refusal Store identity");
  const processId = identifier(input.processId, "Pre-intent refusal Process identity");
  const preIntentRefusals = normalizedPreIntentRefusals({
    preIntentRefusals: input.preIntentRefusals,
  });
  return digestCanonical({
    schema: "lifecycle.execution-reclamation-pre-intent-refusal-set.private.v1",
    storeId,
    processId,
    preIntentRefusals,
  });
}

/**
 * Compile the stable digest terminal independently compares with the ledger's
 * typed verification result. Private owner coordinates are represented only
 * by this digest after reconciliation.
 */
export function foundationExecutionReclamationTerminalSubjectSetDigestV1(
  input: Readonly<{
    storeId: string;
    processId: string;
    subjects: readonly FoundationExecutionReclamationTerminalSubjectV1[];
  }>,
): Sha256 {
  const storeId = identifier(input.storeId, "Terminal execution Store identity");
  const processId = identifier(input.processId, "Terminal execution Process identity");
  const subjects = normalizedTerminalSubjects({
    storeId,
    processId,
    subjects: input.subjects,
  });
  // Closure's terminal-execution set has always selected exact Receipts and
  // owners. Retirement facts are independently aggregated into Closure and
  // are checked against the private handoff below; do not silently change the
  // retained v1 set-digest projection by including them here.
  const retainedSelectors = subjects.map(({ receipt, owner }) =>
    Object.freeze({ receipt, owner })
  ).sort((left, right) => compareCodePoints(canonicalJson(left), canonicalJson(right)));
  return digestCanonical({
    schema: "lifecycle.execution-reclamation-terminal-subject-set.private.v1",
    storeId,
    processId,
    subjects: retainedSelectors,
  });
}

function exactClone<Value>(value: Value): Value {
  const clone = JSON.parse(canonicalJson(value)) as Value;
  const freeze = (selected: unknown): void => {
    if (selected === null || typeof selected !== "object" || Object.isFrozen(selected)) return;
    for (const child of Object.values(selected)) freeze(child);
    Object.freeze(selected);
  };
  freeze(clone);
  return clone;
}

function parseSpecification(value: unknown): FoundationExecutionSpecificationV1 {
  try {
    assertFoundationSchema(
      FOUNDATION_EXECUTION_SPECIFICATION_SCHEMA_ID,
      value,
      "Execution Reclamation Specification",
    );
  } catch {
    return fail("specification", "Reclamation handoff contains an invalid Execution Specification");
  }
  const specification = exactClone(value) as FoundationExecutionSpecificationV1;
  if (Buffer.byteLength(canonicalJson(specification), "utf8") > MAXIMUM_JSON_BYTES ||
      specification.digest !== selfDigest(specification, "digest") ||
      specification.outputContract.digest !== selfDigest(
        specification.outputContract as unknown as Record<string, unknown>,
      )) {
    fail("specification", "Reclamation handoff does not retain one exact Execution Specification");
  }
  return specification;
}

function parseOwner(
  value: unknown,
  specification: FoundationExecutionSpecificationV1,
): FoundationExecutionReclamationOwnerV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("owner", "Reclamation handoff owner is not one exact object");
  }
  exactKeys(value, ["activityId", "kind", "processId", "storeId", "subjectDigest"],
    "Reclamation handoff owner");
  const owner = value as Record<string, unknown>;
  const kind = owner.kind;
  if (kind !== "agent-attempt" && kind !== "check") {
    fail("owner", "Reclamation handoff owner has an unsupported kind");
  }
  const parsed = Object.freeze({
    storeId: identifier(owner.storeId, "Reclamation Store identity"),
    processId: identifier(owner.processId, "Reclamation Process identity"),
    activityId: identifier(owner.activityId, "Reclamation Activity identity"),
    kind,
    subjectDigest: digest(owner.subjectDigest, "Reclamation owner subject"),
  });
  const specificationSubjectDigest = specification.owner.kind === "agent-attempt"
    ? specification.owner.attempt.digest
    : specification.owner.ownerSubjectDigest;
  if (specification.owner.kind !== parsed.kind ||
      specification.owner.activityId !== parsed.activityId ||
      specificationSubjectDigest !== parsed.subjectDigest ||
      specification.operation.kind !== parsed.kind) {
    fail("owner", "Reclamation handoff owner does not bind the exact Execution Specification");
  }
  return parsed;
}

function handoffCore(input: Readonly<{
  installationId: string;
  value: FoundationExecutionReclamationHandoffInputV1;
}>): Readonly<{
  schema: "lifecycle.execution-reclamation-handoff-core.private.v1";
  installationId: string;
  owner: FoundationExecutionReclamationOwnerV1;
  specification: FoundationExecutionSpecificationV1;
  handle: FoundationExecutionHandle;
  reclamationBinding: FoundationExecutionReclamationBindingV1;
  obligation: FoundationExecutionReclamationObligationV1;
  retirementDigest: Sha256;
  dispatchAuthorityConsumed: boolean;
}> {
  const raw = input.value as unknown as Record<string, unknown>;
  exactKeys(raw, [
    "dispatchAuthorityConsumed",
    "handle",
    "obligation",
    "owner",
    "reclamationBinding",
    "retirementDigest",
    "specification",
  ], "Execution Reclamation handoff input");
  const specification = parseSpecification(raw.specification);
  const owner = parseOwner(raw.owner, specification);
  if (typeof raw.handle !== "string") fail("handle", "Reclamation handoff Handle is invalid");
  let handle: FoundationExecutionHandle;
  try {
    handle = privateFoundationExecutionHandle(raw.handle);
  } catch {
    return fail("handle", "Reclamation handoff Handle is invalid");
  }
  if (typeof raw.dispatchAuthorityConsumed !== "boolean") {
    fail("authority", "Reclamation handoff has an invalid dispatch-consumption fact");
  }
  let reclamationBinding: FoundationExecutionReclamationBindingV1;
  try {
    const candidate = raw.reclamationBinding as FoundationExecutionReclamationBindingV1;
    reclamationBinding = parseExecutionReclamationBinding(
      candidate,
      specification,
      {
        handle,
        retirementCheckpointDigest: candidate.retirementCheckpointDigest,
        dispatchAuthorityConsumed: raw.dispatchAuthorityConsumed,
      },
    );
  } catch {
    return fail("reclamation-binding", "Reclamation handoff substituted its backend-owned binding");
  }
  let obligation: FoundationExecutionReclamationObligationV1;
  try {
    obligation = parseExecutionReclamationObligation(
      raw.obligation,
      specification,
      reclamationBinding,
    );
  } catch {
    return fail("obligation", "Reclamation handoff obligation substituted its retired allocation");
  }
  return Object.freeze({
    schema: "lifecycle.execution-reclamation-handoff-core.private.v1" as const,
    installationId: input.installationId,
    owner,
    specification,
    handle,
    reclamationBinding,
    obligation,
    retirementDigest: digest(raw.retirementDigest, "Execution Retirement"),
    dispatchAuthorityConsumed: raw.dispatchAuthorityConsumed,
  });
}

function compileHandoff(input: Readonly<{
  installationId: string;
  value: FoundationExecutionReclamationHandoffInputV1;
  acceptedAt: string;
}>): FoundationExecutionReclamationHandoffV1 {
  const core = handoffCore(input);
  const coreDigest = digestCanonical(core);
  const subject = Object.freeze({
    schema: FOUNDATION_EXECUTION_RECLAMATION_HANDOFF_SCHEMA,
    installationId: core.installationId,
    owner: core.owner,
    specification: core.specification,
    handle: core.handle,
    reclamationBinding: core.reclamationBinding,
    obligation: core.obligation,
    retirementDigest: core.retirementDigest,
    dispatchAuthorityConsumed: core.dispatchAuthorityConsumed,
    acceptedAt: timestamp(input.acceptedAt, "Execution Reclamation handoff acceptance"),
    coreDigest,
  });
  return exactClone(Object.freeze({ ...subject, digest: selfDigest(subject) }));
}

function handoffInput(value: FoundationExecutionReclamationHandoffV1):
FoundationExecutionReclamationHandoffInputV1 {
  return Object.freeze({
    owner: value.owner,
    specification: value.specification,
    handle: value.handle,
    reclamationBinding: value.reclamationBinding,
    obligation: value.obligation,
    retirementDigest: value.retirementDigest,
    dispatchAuthorityConsumed: value.dispatchAuthorityConsumed,
  });
}

function parseHandoff(input: Readonly<{
  installationId: string;
  value: unknown;
}>): FoundationExecutionReclamationHandoffV1 {
  if (input.value === null || typeof input.value !== "object" || Array.isArray(input.value)) {
    fail("handoff-integrity", "Retained Execution Reclamation handoff is not one exact object");
  }
  exactKeys(input.value, [
    "acceptedAt",
    "coreDigest",
    "digest",
    "dispatchAuthorityConsumed",
    "handle",
    "installationId",
    "obligation",
    "owner",
    "reclamationBinding",
    "retirementDigest",
    "schema",
    "specification",
  ], "Retained Execution Reclamation handoff");
  const value = input.value as unknown as FoundationExecutionReclamationHandoffV1;
  if (value.schema !== FOUNDATION_EXECUTION_RECLAMATION_HANDOFF_SCHEMA ||
      value.installationId !== input.installationId) {
    fail("handoff-integrity", "Retained handoff substituted its installation owner");
  }
  const compiled = compileHandoff({
    installationId: input.installationId,
    value: handoffInput(value),
    acceptedAt: value.acceptedAt,
  });
  if (canonicalJson(compiled) !== canonicalJson(value)) {
    fail("handoff-integrity", "Retained Execution Reclamation handoff failed exact validation");
  }
  return compiled;
}

function compileStanding(input: Omit<FoundationExecutionReclamationStandingV1, "digest">):
FoundationExecutionReclamationStandingV1 {
  if (!Number.isSafeInteger(input.generation) || input.generation < 1 ||
      !Number.isSafeInteger(input.attemptCount) || input.attemptCount < 0) {
    fail("standing-integrity", "Execution Reclamation standing has invalid counters");
  }
  digest(input.obligationDigest, "Execution Reclamation standing obligation");
  timestamp(input.updatedAt, "Execution Reclamation standing update");
  const pending = input.state === "pending";
  const claimed = input.state === "claimed";
  const terminal = input.state === "reclaimed" || input.state === "integrity-refusal";
  if ((!pending && !claimed && !terminal) ||
      (pending && (input.nextAttemptAt === null || input.claimToken !== null ||
        input.claimExpiresAt !== null)) ||
      (claimed && (input.nextAttemptAt !== null || input.claimToken === null ||
        input.claimExpiresAt === null)) ||
      (terminal && (input.nextAttemptAt !== null || input.claimToken !== null ||
        input.claimExpiresAt !== null || input.lastObservation === null))) {
    fail("standing-integrity", "Execution Reclamation standing has an invalid state shape");
  }
  if (input.nextAttemptAt !== null) timestamp(input.nextAttemptAt, "Execution Reclamation retry");
  if (input.claimExpiresAt !== null) {
    timestamp(input.claimExpiresAt, "Execution Reclamation claim expiry");
  }
  if (input.claimToken !== null && !CLAIM_TOKEN_PATTERN.test(input.claimToken)) {
    fail("standing-integrity", "Execution Reclamation standing has an invalid claim token");
  }
  if (input.lastObservation !== null &&
      input.lastObservation.obligationDigest !== input.obligationDigest) {
    fail("standing-integrity", "Execution Reclamation standing observation selects another obligation");
  }
  if ((terminal && input.lastObservation?.disposition !== input.state) ||
      ((pending || claimed) && input.lastObservation !== null &&
        input.lastObservation.disposition !== "remaining") ||
      ((claimed || terminal || input.lastObservation !== null) && input.attemptCount < 1)) {
    fail("standing-integrity", "Execution Reclamation standing contradicts its direct result history");
  }
  const subject = exactClone(input);
  return exactClone(Object.freeze({ ...subject, digest: selfDigest(subject) }));
}

function compileClaim(input: Omit<FoundationExecutionReclamationClaimV1, "digest">):
FoundationExecutionReclamationClaimV1 {
  if (!Number.isSafeInteger(input.standingGeneration) || input.standingGeneration < 1 ||
      !CLAIM_TOKEN_PATTERN.test(input.claimToken)) {
    fail("claim", "Execution Reclamation claim has invalid coordinates");
  }
  digest(input.standingDigest, "Execution Reclamation claim standing");
  const claimedAt = timestamp(input.claimedAt, "Execution Reclamation claim time");
  const expiresAt = timestamp(input.expiresAt, "Execution Reclamation claim expiry");
  if (expiresAt <= claimedAt) fail("claim", "Execution Reclamation claim expiry is not later");
  const subject = exactClone(input);
  return exactClone(Object.freeze({ ...subject, digest: selfDigest(subject) }));
}

function schemaSql(): string {
  return `
    PRAGMA application_id = ${DATABASE_APPLICATION_ID};
    PRAGMA user_version = ${DATABASE_USER_VERSION};

    CREATE TABLE ledger_metadata (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      schema_id TEXT NOT NULL,
      installation_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE handoffs (
      obligation_digest TEXT PRIMARY KEY,
      handoff_core_digest TEXT NOT NULL UNIQUE,
      handoff_digest TEXT NOT NULL UNIQUE,
      store_id TEXT NOT NULL,
      process_id TEXT NOT NULL,
      activity_id TEXT NOT NULL,
      owner_kind TEXT NOT NULL CHECK (owner_kind IN ('agent-attempt', 'check')),
      owner_subject_digest TEXT NOT NULL,
      specification_digest TEXT NOT NULL UNIQUE,
      handle TEXT NOT NULL UNIQUE,
      reclamation_binding_digest TEXT NOT NULL UNIQUE,
      retirement_digest TEXT NOT NULL UNIQUE,
      dispatch_authority_consumed INTEGER NOT NULL CHECK (dispatch_authority_consumed IN (0, 1)),
      accepted_at TEXT NOT NULL,
      handoff_json TEXT NOT NULL CHECK (length(handoff_json) BETWEEN 2 AND ${MAXIMUM_JSON_BYTES}),
      UNIQUE (store_id, process_id, activity_id, owner_kind, owner_subject_digest)
    ) STRICT;

    CREATE TABLE standings (
      obligation_digest TEXT PRIMARY KEY,
      generation INTEGER NOT NULL CHECK (generation > 0),
      state TEXT NOT NULL CHECK (state IN ('pending', 'claimed', 'reclaimed', 'integrity-refusal')),
      attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
      next_attempt_at TEXT,
      claim_token TEXT UNIQUE,
      claim_expires_at TEXT,
      last_observation_digest TEXT,
      last_observation_json TEXT,
      updated_at TEXT NOT NULL,
      standing_digest TEXT NOT NULL UNIQUE,
      FOREIGN KEY (obligation_digest) REFERENCES handoffs(obligation_digest),
      CHECK (
        (state = 'pending' AND next_attempt_at IS NOT NULL AND claim_token IS NULL AND claim_expires_at IS NULL) OR
        (state = 'claimed' AND next_attempt_at IS NULL AND claim_token IS NOT NULL AND claim_expires_at IS NOT NULL) OR
        (state IN ('reclaimed', 'integrity-refusal') AND next_attempt_at IS NULL AND claim_token IS NULL AND claim_expires_at IS NULL AND last_observation_digest IS NOT NULL AND last_observation_json IS NOT NULL)
      ),
      CHECK (
        (last_observation_digest IS NULL AND last_observation_json IS NULL) OR
        (last_observation_digest IS NOT NULL AND last_observation_json IS NOT NULL)
      )
    ) STRICT;

    CREATE INDEX standings_schedule ON standings (state, next_attempt_at, claim_expires_at, obligation_digest);
    CREATE INDEX handoffs_process ON handoffs (store_id, process_id, obligation_digest);

    CREATE TRIGGER ledger_metadata_immutable_update BEFORE UPDATE ON ledger_metadata BEGIN
      SELECT RAISE(ABORT, 'ledger_metadata is immutable');
    END;
    CREATE TRIGGER ledger_metadata_immutable_delete BEFORE DELETE ON ledger_metadata BEGIN
      SELECT RAISE(ABORT, 'ledger_metadata is immutable');
    END;
    CREATE TRIGGER handoffs_immutable_update BEFORE UPDATE ON handoffs BEGIN
      SELECT RAISE(ABORT, 'Execution Reclamation handoff is immutable');
    END;
    CREATE TRIGGER handoffs_immutable_delete BEFORE DELETE ON handoffs BEGIN
      SELECT RAISE(ABORT, 'Execution Reclamation handoff is immutable');
    END;
    CREATE TRIGGER standings_retained_delete BEFORE DELETE ON standings BEGIN
      SELECT RAISE(ABORT, 'Execution Reclamation standing tombstone is retained');
    END;
  `;
}

function retainedSchemaSubject(db: DatabaseSync): readonly ControlJsonObject[] {
  const rows = db.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all() as readonly SqlRow[];
  return Object.freeze(rows.map((row) => Object.freeze({
    type: string(row.type, "Database schema object type"),
    name: string(row.name, "Database schema object name"),
    table: string(row.tbl_name, "Database schema object table"),
    sql: string(row.sql, "Database schema object SQL"),
  })));
}

let expectedSchemaSubject: readonly ControlJsonObject[] | null = null;

function assertExactSchema(db: DatabaseSync): void {
  if (expectedSchemaSubject === null) {
    const reference = new DatabaseSync(":memory:", {
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
      allowExtension: false,
      defensive: true,
    });
    try {
      reference.exec(schemaSql());
      expectedSchemaSubject = retainedSchemaSubject(reference);
    } finally {
      reference.close();
    }
  }
  if (canonicalJson(retainedSchemaSubject(db)) !== canonicalJson(expectedSchemaSubject)) {
    fail("database-schema", "Execution Reclamation ledger schema or invariant set is not exact");
  }
}

export function foundationExecutionReclamationLedgerPathsV1(
  machineHome: string,
): FoundationExecutionReclamationLedgerPathsV1 {
  const root = join(resolve(machineHome), LEDGER_ROOT_DIRECTORY);
  return Object.freeze({ root, database: join(root, DATABASE_FILENAME) });
}

async function exactRoot(machineHome: string, create: boolean): Promise<string> {
  const home = resolve(machineHome);
  if (machineHome !== home || home === parsePath(home).root || basename(home) === "") {
    fail("physical-root", "Execution Reclamation ledger requires one exact machine-custody root");
  }
  const homeState = await lstat(home, { bigint: true });
  if (!homeState.isDirectory() || homeState.isSymbolicLink() || await realpath(home) !== home) {
    fail("physical-root", "Execution Reclamation machine custody is not one canonical directory");
  }
  const uid = process.geteuid?.() ?? process.getuid?.();
  if (uid !== undefined && homeState.uid !== BigInt(uid)) {
    fail("physical-root", "Execution Reclamation machine custody has another owner");
  }
  const root = join(home, LEDGER_ROOT_DIRECTORY);
  let exists = true;
  try {
    await lstat(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") exists = false;
    else throw error;
  }
  if (!exists) {
    if (!create) fail("physical-root", "Execution Reclamation ledger root does not exist");
    await mkdir(root, { mode: 0o700 });
    await syncDirectory(home);
  }
  const state = await lstat(root, { bigint: true });
  if (!state.isDirectory() || state.isSymbolicLink() || Number(state.mode & 0o7777n) !== 0o700) {
    fail("physical-root", "Execution Reclamation ledger root is not one mode-0700 directory");
  }
  if (uid !== undefined && state.uid !== BigInt(uid)) {
    fail("physical-root", "Execution Reclamation ledger root has another owner");
  }
  if (await realpath(root) !== root) {
    fail("physical-root", "Execution Reclamation ledger root traverses a substituted path");
  }
  return root;
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function assertRootEntries(root: string): Promise<void> {
  const allowed = new Set([DATABASE_FILENAME, `${DATABASE_FILENAME}-journal`]);
  const entries = await readdir(root);
  const extras = entries.filter((entry) => !allowed.has(entry));
  if (extras.length > 0 || entries.length > allowed.size) {
    fail("physical-layout", "Execution Reclamation ledger root contains unsupported entries");
  }
}

async function exactDatabaseFile(path: string): Promise<void> {
  const state = await lstat(path, { bigint: true });
  if (!state.isFile() || state.isSymbolicLink() || state.nlink !== 1n ||
      Number(state.mode & 0o7777n) !== 0o600) {
    fail("database-file", "Execution Reclamation ledger database is not one mode-0600 regular file");
  }
  const uid = process.geteuid?.() ?? process.getuid?.();
  if (uid !== undefined && state.uid !== BigInt(uid)) {
    fail("database-file", "Execution Reclamation ledger database has another owner");
  }
}

function rowHandoff(row: SqlRow, installationId: string): FoundationExecutionReclamationHandoffV1 {
  let value: unknown;
  try {
    value = JSON.parse(string(row.handoff_json, "Execution Reclamation handoff JSON"));
  } catch {
    return fail("handoff-integrity", "Retained Execution Reclamation handoff JSON is invalid");
  }
  const handoff = parseHandoff({ installationId, value });
  if (
    string(row.obligation_digest, "Handoff obligation") !== handoff.obligation.digest ||
    string(row.handoff_core_digest, "Handoff core") !== handoff.coreDigest ||
    string(row.handoff_digest, "Handoff digest") !== handoff.digest ||
    string(row.store_id, "Handoff Store") !== handoff.owner.storeId ||
    string(row.process_id, "Handoff Process") !== handoff.owner.processId ||
    string(row.activity_id, "Handoff Activity") !== handoff.owner.activityId ||
    string(row.owner_kind, "Handoff owner kind") !== handoff.owner.kind ||
    string(row.owner_subject_digest, "Handoff owner subject") !== handoff.owner.subjectDigest ||
    string(row.specification_digest, "Handoff Specification") !== handoff.specification.digest ||
    string(row.handle, "Handoff Handle") !== handoff.handle ||
    string(row.reclamation_binding_digest, "Handoff Reclamation binding") !==
      handoff.reclamationBinding.digest ||
    string(row.retirement_digest, "Handoff Retirement") !== handoff.retirementDigest ||
    booleanInteger(row.dispatch_authority_consumed, "Handoff dispatch fact") !==
      handoff.dispatchAuthorityConsumed ||
    string(row.accepted_at, "Handoff acceptance") !== handoff.acceptedAt ||
    string(row.handoff_json, "Handoff JSON") !== canonicalJson(handoff)
  ) {
    fail("handoff-integrity", "Execution Reclamation handoff columns substituted retained bytes");
  }
  return handoff;
}

function rowStanding(
  row: SqlRow,
  handoff: FoundationExecutionReclamationHandoffV1,
): FoundationExecutionReclamationStandingV1 {
  const state = string(row.state, "Execution Reclamation standing state");
  if (state !== "pending" && state !== "claimed" && state !== "reclaimed" &&
      state !== "integrity-refusal") {
    fail("standing-integrity", "Execution Reclamation standing has an unsupported state");
  }
  let lastObservation: FoundationExecutionReclamationObservationV1 | null = null;
  const observationJson = nullableString(row.last_observation_json, "Reclamation observation JSON");
  const observationDigest = nullableString(
    row.last_observation_digest,
    "Reclamation observation digest",
  );
  if (observationJson !== null) {
    try {
      lastObservation = parseExecutionReclamationObservation(
        JSON.parse(observationJson),
        handoff.specification,
        handoff.obligation,
      );
    } catch {
      return fail("standing-integrity", "Retained Reclamation observation is invalid");
    }
    if (observationDigest !== lastObservation.digest ||
        observationJson !== canonicalJson(lastObservation)) {
      fail("standing-integrity", "Retained Reclamation observation columns substituted bytes");
    }
  } else if (observationDigest !== null) {
    fail("standing-integrity", "Retained Reclamation observation is incomplete");
  }
  const standing = compileStanding({
    schema: FOUNDATION_EXECUTION_RECLAMATION_STANDING_SCHEMA,
    obligationDigest: handoff.obligation.digest,
    generation: integer(row.generation, "Reclamation standing generation"),
    state,
    attemptCount: integer(row.attempt_count, "Reclamation attempt count"),
    nextAttemptAt: nullableString(row.next_attempt_at, "Reclamation retry time"),
    claimToken: nullableString(row.claim_token, "Reclamation claim token"),
    claimExpiresAt: nullableString(row.claim_expires_at, "Reclamation claim expiry"),
    lastObservation,
    updatedAt: string(row.updated_at, "Reclamation standing update"),
  });
  if (string(row.obligation_digest, "Standing obligation") !== standing.obligationDigest ||
      string(row.standing_digest, "Standing digest") !== standing.digest) {
    fail("standing-integrity", "Execution Reclamation standing columns substituted retained bytes");
  }
  return standing;
}

function standingParameters(
  standing: FoundationExecutionReclamationStandingV1,
): readonly (string | number | null)[] {
  return Object.freeze([
    standing.generation,
    standing.state,
    standing.attemptCount,
    standing.nextAttemptAt,
    standing.claimToken,
    standing.claimExpiresAt,
    standing.lastObservation?.digest ?? null,
    standing.lastObservation === null ? null : canonicalJson(standing.lastObservation),
    standing.updatedAt,
    standing.digest,
  ]);
}

class FoundationExecutionReclamationLedgerOwnerV1 {
  readonly #db: DatabaseSync;
  readonly #installationId: string;
  readonly #paths: FoundationExecutionReclamationLedgerPathsV1;
  readonly #clock: FoundationExecutionReclamationLedgerClockV1;
  readonly #createClaimToken: () => string;
  #transactionOpen = false;

  constructor(input: Readonly<{
    db: DatabaseSync;
    installationId: string;
    paths: FoundationExecutionReclamationLedgerPathsV1;
    clock: FoundationExecutionReclamationLedgerClockV1;
    createClaimToken: () => string;
  }>) {
    this.#db = input.db;
    this.#installationId = input.installationId;
    this.#paths = input.paths;
    this.#clock = input.clock;
    this.#createClaimToken = input.createClaimToken;
  }

  get paths(): FoundationExecutionReclamationLedgerPathsV1 {
    return this.#paths;
  }

  close(): void {
    if (this.#transactionOpen) fail("transaction", "Cannot close a ledger transaction in progress");
    this.#db.close();
  }

  /**
   * Refuse a new physical allocation before calling an Execution Backend when
   * this first implementation cannot safely absorb more retired residue.
   * This is a fixed private availability guard, not a capacity reservation:
   * it creates no retained row and grants no later handoff authority.
   */
  assertAllocationAvailable(): void {
    const counts = this.#db.prepare(`
      SELECT
        COUNT(*) AS retained_count,
        COALESCE(SUM(CASE WHEN s.state <> 'reclaimed' THEN 1 ELSE 0 END), 0)
          AS outstanding_count
      FROM handoffs h JOIN standings s USING (obligation_digest)
    `).get() as SqlRow;
    const retainedCount = integer(
      counts.retained_count,
      "Execution Reclamation retained handoff count",
    );
    const outstandingCount = integer(
      counts.outstanding_count,
      "Execution Reclamation outstanding handoff count",
    );
    if (
      retainedCount >= MAXIMUM_HANDOFFS ||
      outstandingCount >= MAXIMUM_OUTSTANDING_HANDOFFS
    ) {
      throw new FoundationError(
        "lifecycle.execution.reclamation-ledger-v1.allocation-unavailable",
        "Execution allocation is unavailable while retired resources exceed the fixed private Reclamation ceiling",
        {
          retryable: true,
          observedFacts: {
            outstandingCount,
            outstandingCeiling: MAXIMUM_OUTSTANDING_HANDOFFS,
            retainedCount,
            retainedCeiling: MAXIMUM_HANDOFFS,
          },
        },
      );
    }
  }

  [Symbol.dispose](): void {
    this.close();
  }

  #now(label: string): string {
    try {
      return timestamp(this.#clock.now(), label);
    } catch (error) {
      if (error instanceof FoundationError) throw error;
      return fail("clock", `${label} could not be sampled`);
    }
  }

  #transaction<Result>(operation: () => Result): Result {
    if (this.#transactionOpen) fail("transaction", "Nested Reclamation ledger transaction refused");
    this.#db.exec("BEGIN IMMEDIATE");
    this.#transactionOpen = true;
    try {
      const result = operation();
      this.#db.exec("COMMIT");
      return result;
    } catch (error) {
      try { this.#db.exec("ROLLBACK"); } catch { /* original refusal owns the error */ }
      throw error;
    } finally {
      this.#transactionOpen = false;
    }
  }

  #handoffByObligation(obligationDigest: Sha256): FoundationExecutionReclamationHandoffV1 | null {
    const row = this.#db.prepare("SELECT * FROM handoffs WHERE obligation_digest = ?")
      .get(obligationDigest) as SqlRow | undefined;
    return row === undefined ? null : rowHandoff(row, this.#installationId);
  }

  #entryByObligation(obligationDigest: Sha256): Readonly<{
    handoff: FoundationExecutionReclamationHandoffV1;
    standing: FoundationExecutionReclamationStandingV1;
  }> | null {
    const row = this.#db.prepare(`
      SELECT h.*, s.generation, s.state, s.attempt_count, s.next_attempt_at,
        s.claim_token, s.claim_expires_at, s.last_observation_digest,
        s.last_observation_json, s.updated_at, s.standing_digest
      FROM handoffs h JOIN standings s USING (obligation_digest)
      WHERE h.obligation_digest = ?
    `).get(obligationDigest) as SqlRow | undefined;
    if (row === undefined) return null;
    const handoff = rowHandoff(row, this.#installationId);
    return Object.freeze({ handoff, standing: rowStanding(row, handoff) });
  }

  accept(input: FoundationExecutionReclamationHandoffInputV1):
  FoundationExecutionReclamationHandoffV1 {
    // Acceptance time is ledger-owned. A lost-response retry reuses the
    // original row only when every caller-owned core byte remains exact.
    const acceptedAt = this.#now("Execution Reclamation handoff acceptance");
    const candidate = compileHandoff({
      installationId: this.#installationId,
      value: input,
      acceptedAt,
    });
    const initialStanding = compileStanding({
      schema: FOUNDATION_EXECUTION_RECLAMATION_STANDING_SCHEMA,
      obligationDigest: candidate.obligation.digest,
      generation: 1,
      state: "pending",
      attemptCount: 0,
      nextAttemptAt: candidate.acceptedAt,
      claimToken: null,
      claimExpiresAt: null,
      lastObservation: null,
      updatedAt: candidate.acceptedAt,
    });
    const result = this.#transaction((): "inserted" | "existing" | "bound" | "duplicate" => {
      const existing = this.#db.prepare(
        "SELECT obligation_digest FROM handoffs WHERE obligation_digest = ?",
      ).get(candidate.obligation.digest);
      if (existing !== undefined) return "existing";
      const count = Number((this.#db.prepare(
        "SELECT COUNT(*) AS count FROM handoffs",
      ).get() as SqlRow).count);
      if (!Number.isSafeInteger(count)) fail("database-row", "Handoff count is not safe");
      if (count >= MAXIMUM_HANDOFFS) return "bound";
      const inserted = this.#db.prepare(`
        INSERT OR IGNORE INTO handoffs (
          obligation_digest, handoff_core_digest, handoff_digest,
          store_id, process_id, activity_id, owner_kind, owner_subject_digest,
          specification_digest, handle, reclamation_binding_digest,
          retirement_digest, dispatch_authority_consumed,
          accepted_at, handoff_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        candidate.obligation.digest,
        candidate.coreDigest,
        candidate.digest,
        candidate.owner.storeId,
        candidate.owner.processId,
        candidate.owner.activityId,
        candidate.owner.kind,
        candidate.owner.subjectDigest,
        candidate.specification.digest,
        candidate.handle,
        candidate.reclamationBinding.digest,
        candidate.retirementDigest,
        candidate.dispatchAuthorityConsumed ? 1 : 0,
        candidate.acceptedAt,
        canonicalJson(candidate),
      );
      if (Number(inserted.changes) !== 1) return "duplicate";
      const standingInserted = this.#db.prepare(`
        INSERT INTO standings (
          obligation_digest, generation, state, attempt_count, next_attempt_at,
          claim_token, claim_expires_at, last_observation_digest,
          last_observation_json, updated_at, standing_digest
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(candidate.obligation.digest, ...standingParameters(initialStanding));
      if (Number(standingInserted.changes) !== 1) {
        fail("database-cas", "Reclamation standing was not inserted");
      }
      return "inserted";
    });
    if (result === "inserted") return candidate;
    if (result === "bound") {
      fail("bound", "Execution Reclamation ledger reached its retained handoff bound");
    }
    const existing = this.#handoffByObligation(candidate.obligation.digest);
    if (result === "duplicate" || existing === null) {
      fail("handoff-duplicate", "Execution Reclamation handoff duplicates another exact owner or allocation");
    }
    if (existing.coreDigest !== candidate.coreDigest ||
        canonicalJson(handoffInput(existing)) !== canonicalJson(handoffInput(candidate))) {
      fail("handoff-substitution", "Reclamation obligation replay substituted handoff bytes");
    }
    return existing;
  }

  list(): readonly FoundationExecutionReclamationLedgerEntryV1[] {
    const rows = this.#db.prepare(`
      SELECT h.*, s.generation, s.state, s.attempt_count, s.next_attempt_at,
        s.claim_token, s.claim_expires_at, s.last_observation_digest,
        s.last_observation_json, s.updated_at, s.standing_digest
      FROM handoffs h JOIN standings s USING (obligation_digest)
      ORDER BY h.obligation_digest
      LIMIT ${MAXIMUM_HANDOFFS + 1}
    `).all() as readonly SqlRow[];
    if (rows.length > MAXIMUM_HANDOFFS) fail("bound", "Execution Reclamation ledger exceeds its row bound");
    return Object.freeze(rows.map((row) => {
      const handoff = rowHandoff(row, this.#installationId);
      const standing = rowStanding(row, handoff);
      return Object.freeze({
        obligationDigest: handoff.obligation.digest,
        handoffDigest: handoff.digest,
        specificationDigest: handoff.specification.digest,
        reclamationBindingDigest: handoff.reclamationBinding.digest,
        retirementDigest: handoff.retirementDigest,
        owner: handoff.owner,
        acceptedAt: handoff.acceptedAt,
        standing: Object.freeze({
          state: standing.state,
          attemptCount: standing.attemptCount,
          nextAttemptAt: standing.nextAttemptAt,
          claimExpiresAt: standing.claimExpiresAt,
          lastObservationDigest: standing.lastObservation?.digest ?? null,
          lastDisposition: standing.lastObservation?.disposition ?? null,
          updatedAt: standing.updatedAt,
          digest: standing.digest,
        }),
      });
    }));
  }

  summarizeProcess(input: Readonly<{ storeId: string; processId: string }>):
  FoundationExecutionReclamationLedgerSummaryV1 {
    const storeId = identifier(input.storeId, "Reclamation summary Store identity");
    const processId = identifier(input.processId, "Reclamation summary Process identity");
    const entries = this.list().filter((entry) =>
      entry.owner.storeId === storeId && entry.owner.processId === processId
    );
    const obligationDigests = entries.map((entry) => entry.obligationDigest)
      .sort(compareCodePoints);
    const counts = (state: FoundationExecutionReclamationStandingStateV1): number =>
      entries.filter((entry) => entry.standing.state === state).length;
    const subject = Object.freeze({
      schema: "lifecycle.execution-reclamation-ledger-summary.private.v1" as const,
      storeId,
      processId,
      obligationSetDigest: digestCanonical({
        schema: "lifecycle.execution-reclamation-obligation-set.private.v1",
        obligationDigests,
      }),
      obligationCount: entries.length,
      pendingCount: counts("pending"),
      claimedCount: counts("claimed"),
      reclaimedCount: counts("reclaimed"),
      integrityRefusalCount: counts("integrity-refusal"),
    });
    return Object.freeze({ ...subject, digest: selfDigest(subject) });
  }

  /**
   * Reconcile every retained terminal Receipt and undispatched refusal with every
   * immutable Reclamation handoff owned by this Store and Process. A
   * subjectless refusal resolves only one never-dispatched, retired Agent
   * allocation for its exact Activity. Omission, extra handoff, duplicate owner/event, and
   * same-count substitution all fail closed.
   */
  verifyTerminalSubjects(input: Readonly<{
    storeId: string;
    processId: string;
    subjects: readonly FoundationExecutionReclamationTerminalSubjectV1[];
    preIntentRefusals: readonly FoundationExecutionReclamationPreIntentRefusalV1[];
  }>): FoundationExecutionReclamationTerminalVerificationV1 {
    const storeId = identifier(input.storeId, "Terminal execution Store identity");
    const processId = identifier(input.processId, "Terminal execution Process identity");
    const subjects = normalizedTerminalSubjects({
      storeId,
      processId,
      subjects: input.subjects,
    });
    const preIntentRefusals = normalizedPreIntentRefusals({
      preIntentRefusals: input.preIntentRefusals,
    });
    const rows = this.#db.prepare(`
      SELECT h.*, s.generation, s.state, s.attempt_count, s.next_attempt_at,
        s.claim_token, s.claim_expires_at, s.last_observation_digest,
        s.last_observation_json, s.updated_at, s.standing_digest
      FROM handoffs h JOIN standings s USING (obligation_digest)
      WHERE h.store_id = ? AND h.process_id = ?
      ORDER BY h.obligation_digest
      LIMIT ${MAXIMUM_HANDOFFS + 1}
    `).all(storeId, processId) as readonly SqlRow[];
    if (rows.length > MAXIMUM_HANDOFFS) {
      fail("terminal-subject-set", "Terminal Reclamation handoff set exceeds its ledger bound");
    }
    const handoffs = rows.map((row) => {
      const handoff = rowHandoff(row, this.#installationId);
      // Reclaimed and integrity-refusal rows remain immutable tombstones. Parse
      // their standing even though reconciliation uses only handoff identity,
      // so a corrupt terminal standing can never be hidden.
      rowStanding(row, handoff);
      return handoff;
    });
    const handoffByOwner = new Map<string, FoundationExecutionReclamationHandoffV1>();
    for (const handoff of handoffs) {
      const ownerKey = canonicalJson(handoff.owner);
      if (handoffByOwner.has(ownerKey)) {
        fail("terminal-subject-set", "Immutable Reclamation handoffs repeat one exact owner");
      }
      handoffByOwner.set(ownerKey, handoff);
    }
    const matchedObligations = new Set<Sha256>();
    for (const subject of subjects) {
      const handoff = handoffByOwner.get(canonicalJson(subject.owner));
      if (handoff === undefined || matchedObligations.has(handoff.obligation.digest) ||
          handoff.retirementDigest !== subject.retirementFactsDigest ||
          (subject.receipt.kind === "execution-receipt" &&
            handoff.dispatchAuthorityConsumed !== true)) {
        fail(
          "terminal-subject-set",
          "Terminal Receipt does not reproduce one exact immutable Reclamation handoff",
        );
      }
      matchedObligations.add(handoff.obligation.digest);
    }
    const undispatchedAgentHandoffs = new Map<
      string,
      FoundationExecutionReclamationHandoffV1[]
    >();
    for (const handoff of handoffs) {
      if (
        matchedObligations.has(handoff.obligation.digest) ||
        handoff.owner.kind !== "agent-attempt" ||
        handoff.dispatchAuthorityConsumed !== false
      ) continue;
      const matches = undispatchedAgentHandoffs.get(handoff.owner.activityId) ?? [];
      matches.push(handoff);
      undispatchedAgentHandoffs.set(handoff.owner.activityId, matches);
    }
    for (const refusal of preIntentRefusals) {
      const matches = undispatchedAgentHandoffs.get(refusal.activityId) ?? [];
      if (matches.length !== 1) {
        fail(
          "terminal-subject-set",
          "Pre-intent refusal does not select one unique never-dispatched Agent Reclamation handoff",
        );
      }
      matchedObligations.add(matches[0]!.obligation.digest);
      undispatchedAgentHandoffs.delete(refusal.activityId);
    }
    if (matchedObligations.size !== handoffs.length ||
        subjects.length + preIntentRefusals.length !== handoffs.length) {
      fail(
        "terminal-subject-set",
        "Terminal subjects do not exactly reproduce every immutable Reclamation handoff",
      );
    }
    const obligationDigests = handoffs.map(({ obligation }) => obligation.digest)
      .sort(compareCodePoints);
    return Object.freeze({
      terminalExecutionSetDigest:
        foundationExecutionReclamationTerminalSubjectSetDigestV1({
          storeId,
          processId,
          subjects,
        }),
      executionCount: subjects.length,
      preIntentRefusalSetDigest:
        foundationExecutionReclamationPreIntentRefusalSetDigestV1({
          storeId,
          processId,
          preIntentRefusals,
        }),
      preIntentRefusalCount: preIntentRefusals.length,
      obligationSetDigest: digestCanonical({
        schema: "lifecycle.execution-reclamation-obligation-set.private.v1",
        obligationDigests,
      }),
      obligationCount: obligationDigests.length,
    });
  }

  claimNext(leaseMilliseconds = 60_000): FoundationExecutionReclamationClaimV1 | null {
    if (!Number.isSafeInteger(leaseMilliseconds) ||
        leaseMilliseconds < MINIMUM_LEASE_MILLISECONDS ||
        leaseMilliseconds > MAXIMUM_LEASE_MILLISECONDS) {
      fail("claim", "Execution Reclamation lease is outside its bounded duration");
    }
    const sampledAt = this.#now("Execution Reclamation claim time");
    const selected = this.#db.prepare(`
      SELECT h.*, s.generation, s.state, s.attempt_count, s.next_attempt_at,
        s.claim_token, s.claim_expires_at, s.last_observation_digest,
        s.last_observation_json, s.updated_at, s.standing_digest
      FROM handoffs h JOIN standings s USING (obligation_digest)
      WHERE (s.state = 'pending' AND s.next_attempt_at <= ?) OR
        (s.state = 'claimed' AND s.claim_expires_at <= ?)
      ORDER BY h.accepted_at, h.obligation_digest
      LIMIT 1
    `).get(sampledAt, sampledAt) as SqlRow | undefined;
    if (selected === undefined) return null;
    const handoff = rowHandoff(selected, this.#installationId);
    const prior = rowStanding(selected, handoff);
    if (prior.generation >= Number.MAX_SAFE_INTEGER ||
        prior.attemptCount >= Number.MAX_SAFE_INTEGER) {
      fail("bound", "Execution Reclamation claim counters reached their safe bound");
    }
    const claimedAt = sampledAt < prior.updatedAt ? prior.updatedAt : sampledAt;
    const expiresAt = new Date(Date.parse(claimedAt) + leaseMilliseconds).toISOString();
    let claimToken: string;
    try {
      claimToken = this.#createClaimToken();
    } catch {
      return fail("claim", "Execution Reclamation claim token could not be created");
    }
    if (!CLAIM_TOKEN_PATTERN.test(claimToken)) {
      fail("claim", "Execution Reclamation claim token is invalid");
    }
    const standing = compileStanding({
      schema: FOUNDATION_EXECUTION_RECLAMATION_STANDING_SCHEMA,
      obligationDigest: handoff.obligation.digest,
      generation: prior.generation + 1,
      state: "claimed",
      attemptCount: prior.attemptCount + 1,
      nextAttemptAt: null,
      claimToken,
      claimExpiresAt: expiresAt,
      lastObservation: prior.lastObservation,
      updatedAt: claimedAt,
    });
    const claim = compileClaim({
      schema: FOUNDATION_EXECUTION_RECLAMATION_CLAIM_SCHEMA,
      handoff,
      standingGeneration: standing.generation,
      standingDigest: standing.digest,
      claimToken,
      claimedAt,
      expiresAt,
    });
    const updated = this.#transaction(() => this.#db.prepare(`
        UPDATE standings SET
          generation = ?, state = ?, attempt_count = ?, next_attempt_at = ?,
          claim_token = ?, claim_expires_at = ?, last_observation_digest = ?,
          last_observation_json = ?, updated_at = ?, standing_digest = ?
        WHERE obligation_digest = ? AND generation = ? AND state = ? AND
          attempt_count = ? AND next_attempt_at IS ? AND claim_token IS ? AND
          claim_expires_at IS ? AND last_observation_digest IS ? AND
          last_observation_json IS ? AND updated_at = ? AND standing_digest = ?
      `).run(
        ...standingParameters(standing),
        handoff.obligation.digest,
        prior.generation,
        prior.state,
        prior.attemptCount,
        prior.nextAttemptAt,
        prior.claimToken,
        prior.claimExpiresAt,
        prior.lastObservation?.digest ?? null,
        prior.lastObservation === null ? null : canonicalJson(prior.lastObservation),
        prior.updatedAt,
        prior.digest,
      ));
    if (Number(updated.changes) === 1) return claim;
    // A concurrent exact claimant is normal contention. Reopen and validate the
    // retained bytes before reporting that no claim was acquired.
    const current = this.#entryByObligation(handoff.obligation.digest);
    if (current === null || canonicalJson(current.handoff) !== canonicalJson(handoff)) {
      fail("handoff-substitution", "Reclamation claim selected another immutable handoff");
    }
    return null;
  }

  completeClaim(input: Readonly<{
    claim: FoundationExecutionReclamationClaimV1;
    observation: FoundationExecutionReclamationObservationV1;
  }>): FoundationExecutionReclamationStandingV1 {
    const claim = compileClaim({
      schema: input.claim.schema,
      handoff: parseHandoff({
        installationId: this.#installationId,
        value: input.claim.handoff,
      }),
      standingGeneration: input.claim.standingGeneration,
      standingDigest: input.claim.standingDigest,
      claimToken: input.claim.claimToken,
      claimedAt: input.claim.claimedAt,
      expiresAt: input.claim.expiresAt,
    });
    if (claim.digest !== input.claim.digest) fail("claim", "Reclamation claim digest is invalid");
    let observation: FoundationExecutionReclamationObservationV1;
    try {
      observation = parseExecutionReclamationObservation(
        input.observation,
        claim.handoff.specification,
        claim.handoff.obligation,
      );
    } catch {
      return fail("observation", "Reclamation result substituted its exact obligation");
    }
    if (observation.observedAt < claim.claimedAt) {
      fail("observation", "Reclamation result predates its exact claim");
    }
    const completedAt = this.#now("Execution Reclamation result time");
    const selected = this.#entryByObligation(claim.handoff.obligation.digest);
    if (selected === null || canonicalJson(selected.handoff) !== canonicalJson(claim.handoff)) {
      fail("handoff-substitution", "Reclamation result selected another immutable handoff");
    }
    const { handoff, standing: prior } = selected;
    if (prior.lastObservation?.digest === observation.digest) return prior;
    if (prior.generation >= Number.MAX_SAFE_INTEGER) {
      fail("bound", "Execution Reclamation standing generation reached its safe bound");
    }
    if (prior.state !== "claimed" || prior.generation !== claim.standingGeneration ||
        prior.digest !== claim.standingDigest || prior.claimToken !== claim.claimToken ||
        prior.claimExpiresAt !== claim.expiresAt || completedAt < claim.claimedAt ||
        completedAt >= claim.expiresAt || observation.observedAt >= claim.expiresAt) {
      fail("claim-cas", "Reclamation result lost or exceeded its exact claim lease");
    }
    const updatedAt = [completedAt, observation.observedAt, prior.updatedAt]
      .sort(compareCodePoints).at(-1)!;
    const remaining = observation.disposition === "remaining";
    const retryMilliseconds = Math.min(
      1_000 * (2 ** Math.min(prior.attemptCount - 1, 16)),
      MAXIMUM_RETRY_MILLISECONDS,
    );
    const nextState: FoundationExecutionReclamationStandingStateV1 =
      observation.disposition === "remaining" ? "pending" : observation.disposition;
    const standing = compileStanding({
      schema: FOUNDATION_EXECUTION_RECLAMATION_STANDING_SCHEMA,
      obligationDigest: handoff.obligation.digest,
      generation: prior.generation + 1,
      state: nextState,
      attemptCount: prior.attemptCount,
      nextAttemptAt: remaining
        ? new Date(Date.parse(updatedAt) + retryMilliseconds).toISOString()
        : null,
      claimToken: null,
      claimExpiresAt: null,
      lastObservation: observation,
      updatedAt,
    });
    const updated = this.#transaction(() => this.#db.prepare(`
        UPDATE standings SET
          generation = ?, state = ?, attempt_count = ?, next_attempt_at = ?,
          claim_token = ?, claim_expires_at = ?, last_observation_digest = ?,
          last_observation_json = ?, updated_at = ?, standing_digest = ?
        WHERE obligation_digest = ? AND generation = ? AND state = ? AND
          attempt_count = ? AND next_attempt_at IS ? AND claim_token IS ? AND
          claim_expires_at IS ? AND last_observation_digest IS ? AND
          last_observation_json IS ? AND updated_at = ? AND standing_digest = ?
      `).run(
        ...standingParameters(standing),
        handoff.obligation.digest,
        prior.generation,
        prior.state,
        prior.attemptCount,
        prior.nextAttemptAt,
        prior.claimToken,
        prior.claimExpiresAt,
        prior.lastObservation?.digest ?? null,
        prior.lastObservation === null ? null : canonicalJson(prior.lastObservation),
        prior.updatedAt,
        prior.digest,
      ));
    if (Number(updated.changes) === 1) return standing;
    const current = this.#entryByObligation(handoff.obligation.digest);
    if (current === null || canonicalJson(current.handoff) !== canonicalJson(handoff)) {
      fail("handoff-substitution", "Reclamation result selected another immutable handoff");
    }
    if (current.standing.lastObservation?.digest === observation.digest) {
      return current.standing;
    }
    return fail("claim-cas", "Reclamation result lost its exact standing CAS");
  }

  async runNext(input: Readonly<{
    leaseMilliseconds?: number;
    reclaim(
      handoff: FoundationExecutionReclamationHandoffV1,
    ): Promise<FoundationExecutionReclamationObservationV1>;
  }>): Promise<Readonly<{
    claim: FoundationExecutionReclamationClaimV1;
    standing: FoundationExecutionReclamationStandingV1;
  }> | null> {
    const claim = this.claimNext(input.leaseMilliseconds);
    if (claim === null) return null;
    const observation = await input.reclaim(claim.handoff);
    const standing = this.completeClaim({ claim, observation });
    return Object.freeze({ claim, standing });
  }

  verifyIntegrity(): void {
    const result = this.#db.prepare("PRAGMA integrity_check(1)").get() as SqlRow | undefined;
    if (result === undefined || Object.values(result).length !== 1 ||
        Object.values(result)[0] !== "ok") {
      fail("database-integrity", "Execution Reclamation ledger failed SQLite integrity checking");
    }
    assertExactSchema(this.#db);
    const foreignKeys = this.#db.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeys.length !== 0) {
      fail("database-integrity", "Execution Reclamation ledger has an invalid foreign-key binding");
    }
    const counts = this.#db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM handoffs) AS handoff_count,
        (SELECT COUNT(*) FROM standings) AS standing_count
    `).get() as SqlRow;
    const handoffCount = integer(counts.handoff_count, "Execution Reclamation handoff count");
    const standingCount = integer(counts.standing_count, "Execution Reclamation standing count");
    const entries = this.list();
    if (handoffCount !== standingCount || handoffCount !== entries.length) {
      fail("database-integrity", "Execution Reclamation ledger has an incomplete handoff standing");
    }
  }
}

/** Opaque private owner; construction is available only through the exact-root opener. */
export type FoundationExecutionReclamationLedgerV1 =
  FoundationExecutionReclamationLedgerOwnerV1;

export async function openFoundationExecutionReclamationLedgerV1(input: Readonly<{
  machineHome: string;
  installationId: string;
  create?: boolean;
  clock?: FoundationExecutionReclamationLedgerClockV1;
  createClaimToken?: () => string;
}>): Promise<FoundationExecutionReclamationLedgerV1> {
  const installationId = identifier(input.installationId, "Lifecycle installation identity");
  const root = await exactRoot(input.machineHome, input.create === true);
  const paths = foundationExecutionReclamationLedgerPathsV1(input.machineHome);
  await assertRootEntries(root);
  let existed = true;
  try {
    await lstat(paths.database);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") existed = false;
    else throw error;
  }
  if (!existed && input.create !== true) fail("open", "Execution Reclamation ledger does not exist");
  if (!existed) {
    const handle = await open(paths.database, "wx", 0o600);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(paths.database, 0o600);
    await syncDirectory(root);
  }
  await exactDatabaseFile(paths.database);
  const emptyDatabase = (await lstat(paths.database, { bigint: true })).size === 0n;
  if (emptyDatabase && input.create !== true) {
    fail("open", "Execution Reclamation ledger database is not initialized");
  }
  const initialize = !existed || emptyDatabase;
  const db = new DatabaseSync(paths.database, {
    timeout: 5_000,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
    defensive: true,
    allowBareNamedParameters: false,
    allowUnknownNamedParameters: false,
    limits: {
      length: 2 * MAXIMUM_JSON_BYTES,
      sqlLength: 64 * 1024,
      column: 64,
      exprDepth: 64,
      compoundSelect: 4,
      functionArg: 16,
      attach: 0,
      likePatternLength: 256,
      variableNumber: 32,
      triggerDepth: 4,
    },
  });
  try {
    db.enableDefensive(true);
    db.exec(`
      PRAGMA trusted_schema = OFF;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA secure_delete = ON;
      PRAGMA journal_mode = DELETE;
      PRAGMA synchronous = EXTRA;
      PRAGMA temp_store = MEMORY;
    `);
    if (initialize) {
      const clock = input.clock ?? Object.freeze({ now: () => new Date().toISOString() });
      const createdAt = timestamp(clock.now(), "Execution Reclamation ledger creation");
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec(schemaSql());
        db.prepare(`
          INSERT INTO ledger_metadata (singleton, schema_id, installation_id, created_at)
          VALUES (1, ?, ?, ?)
        `).run(FOUNDATION_EXECUTION_RECLAMATION_LEDGER_SCHEMA, installationId, createdAt);
        db.exec("COMMIT");
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch { /* initialization error owns the refusal */ }
        throw error;
      }
    }
    const applicationId = integer(
      (db.prepare("PRAGMA application_id").get() as SqlRow).application_id,
      "Execution Reclamation database application identity",
    );
    const userVersion = integer(
      (db.prepare("PRAGMA user_version").get() as SqlRow).user_version,
      "Execution Reclamation database version",
    );
    if (applicationId !== DATABASE_APPLICATION_ID || userVersion !== DATABASE_USER_VERSION) {
      fail("database-version", "Execution Reclamation ledger has unsupported database coordinates");
    }
    assertExactSchema(db);
    const metadata = db.prepare(`
      SELECT schema_id, installation_id, created_at FROM ledger_metadata ORDER BY singleton LIMIT 2
    `).all() as readonly SqlRow[];
    if (metadata.length !== 1 ||
        string(metadata[0]!.schema_id, "Reclamation ledger schema") !==
          FOUNDATION_EXECUTION_RECLAMATION_LEDGER_SCHEMA ||
        string(metadata[0]!.installation_id, "Reclamation installation identity") !== installationId) {
      fail("metadata", "Execution Reclamation ledger substituted its installation identity");
    }
    timestamp(metadata[0]!.created_at, "Execution Reclamation ledger creation");
    const ledger = new FoundationExecutionReclamationLedgerOwnerV1({
      db,
      installationId,
      paths,
      clock: input.clock ?? Object.freeze({ now: () => new Date().toISOString() }),
      createClaimToken: input.createClaimToken ?? (() =>
        `reclamation-claim-v1:${randomBytes(32).toString("hex")}`),
    });
    ledger.verifyIntegrity();
    await exactDatabaseFile(paths.database);
    await assertRootEntries(root);
    return ledger;
  } catch (error) {
    db.close();
    throw error;
  }
}
