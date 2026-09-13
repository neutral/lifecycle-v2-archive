import { FoundationError } from "../error.js";
import { digestCanonical, type Sha256 } from "../validation/canonical.js";
import { canonicalControlEventJsonObject, controlIdentifier, controlTimestamp } from "./model.js";
import type { WorkDelegationReference } from "./work-delegation.js";
import type { ControlRecordStoreAppend } from "./types.js";

export const WORK_DELEGATION_STOP_REQUEST_SCHEMA = "lifecycle.work-delegation-stop-request.v1" as const;

export type WorkDelegationStopRequest = Readonly<{
  schema: typeof WORK_DELEGATION_STOP_REQUEST_SCHEMA;
  storeId: string;
  processId: string;
  delegation: WorkDelegationReference;
  requestedBy: string;
  requestedAt: string;
  digest: Sha256;
}>;

function fail(): never {
  throw new FoundationError("lifecycle.work-delegation.stop-request-invalid",
    "A stop request must bind one exact Delivery, delegation, Director and request time");
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || Object.keys(result).some((key) => !keys.includes(key))) fail();
  return result;
}

function identifier(value: unknown): string {
  if (typeof value !== "string" || /[\r\n\u2028\u2029]/u.test(value)) fail();
  return controlIdentifier(value, "Stop request identity");
}

function digest(value: unknown): Sha256 {
  if (typeof value !== "string" || value.length !== 71 || !/^sha256:[a-f0-9]{64}$/u.test(value)) fail();
  return value as Sha256;
}

/** Constructs the exact value shared by operational custody and its later Journal fact. */
export function compileWorkDelegationStopRequest(input: Readonly<{
  storeId: string;
  processId: string;
  delegation: WorkDelegationReference;
  requestedBy: string;
  requestedAt: string;
}>): WorkDelegationStopRequest {
  const selected = object(input, ["storeId", "processId", "delegation", "requestedBy", "requestedAt"]);
  const reference = object(selected.delegation, ["kind", "id", "revision", "digest"]);
  if (reference.kind !== "work-delegation" || typeof reference.revision !== "number" ||
      !Number.isSafeInteger(reference.revision) || reference.revision < 1 || typeof selected.requestedAt !== "string") fail();
  const body = Object.freeze({
    schema: WORK_DELEGATION_STOP_REQUEST_SCHEMA,
    storeId: identifier(selected.storeId), processId: identifier(selected.processId),
    delegation: Object.freeze({ kind: "work-delegation" as const, id: identifier(reference.id),
      revision: reference.revision, digest: digest(reference.digest) }),
    requestedBy: identifier(selected.requestedBy),
    requestedAt: controlTimestamp(selected.requestedAt, "Stop request time"),
  });
  const request = Object.freeze({ ...body, digest: digestCanonical(body) });
  canonicalControlEventJsonObject(request, "Stop request");
  return request;
}

export function parseWorkDelegationStopRequest(value: unknown): WorkDelegationStopRequest {
  const selected = object(value, ["schema", "storeId", "processId", "delegation", "requestedBy", "requestedAt", "digest"]);
  if (selected.schema !== WORK_DELEGATION_STOP_REQUEST_SCHEMA) fail();
  const request = compileWorkDelegationStopRequest({
    storeId: selected.storeId as string, processId: selected.processId as string,
    delegation: selected.delegation as WorkDelegationReference,
    requestedBy: selected.requestedBy as string, requestedAt: selected.requestedAt as string,
  });
  if (digest(selected.digest) !== request.digest) fail();
  return request;
}

/** The sole Journal writer folds operational custody after existing work settles. */
export function compileWorkDelegationStopAppend(input: Readonly<{
  request: WorkDelegationStopRequest;
  runtimeId: string;
  stoppedAt: string;
}>): ControlRecordStoreAppend {
  const request = parseWorkDelegationStopRequest(input.request);
  const stoppedAt = controlTimestamp(input.stoppedAt, "Delegation stop time");
  if (Date.parse(stoppedAt) < Date.parse(request.requestedAt)) fail();
  return Object.freeze({ event: Object.freeze({
    eventId: `event-work-delegation-stopped-${request.digest.slice("sha256:".length)}`,
    eventKind: "work-delegation-stopped",
    occurredAt: stoppedAt,
    actor: Object.freeze({ kind: "runtime" as const, id: identifier(input.runtimeId) }),
    subject: Object.freeze({ recordId: request.delegation.id, revision: request.delegation.revision,
      digest: request.delegation.digest }),
    payload: Object.freeze({ requestDigest: request.digest,
      requestedAt: request.requestedAt, requestedBy: request.requestedBy }),
  }) });
}
