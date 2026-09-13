import { FoundationError } from "../error.js";
import {
  canonicalJson,
  digestCanonical,
  type Sha256,
} from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import {
  CONTROL_RECORD_EVENT_SCHEMA,
  CONTROL_RECORD_REVISION_SCHEMA,
  type ControlActor,
  type ControlJsonObject,
  type ControlJsonValue,
  type ControlRecordEvent,
  type ControlRecordEventInput,
  type ControlRecordRelationship,
  type ControlRecordRevision,
  type ControlRecordRevisionInput,
} from "./types.js";

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const RELATION_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const MAXIMUM_SEMANTIC_MARKDOWN_BYTES = 1024 * 1024;
const MAXIMUM_REVISION_PAYLOAD_BYTES = 2 * 1024 * 1024;
const MAXIMUM_EVENT_PAYLOAD_BYTES = 64 * 1024;
const MAXIMUM_JSON_DEPTH = 64;
const MAXIMUM_JSON_MEMBERS = 16_384;
const MAXIMUM_JSON_VALUES = 262_144;
const MAXIMUM_RELATIONSHIPS = 4_096;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.control-record-store.${code}`, message);
}

export function controlIdentifier(value: string, label: string): string {
  if (!ID_PATTERN.test(value) || Buffer.byteLength(value, "utf8") > 512) {
    fail("identity", `${label} must be one bounded opaque identity`);
  }
  return value;
}

export function controlRecordKind(value: string, label = "Control record kind"): string {
  if (!RELATION_PATTERN.test(value) || Buffer.byteLength(value, "utf8") > 160) {
    fail("kind", `${label} must use lowercase hyphenated identity syntax`);
  }
  return value;
}

export function controlTimestamp(value: string, label: string): string {
  const parsed = new Date(value);
  const canonicalMilliseconds = Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : null;
  const canonicalWholeSeconds = canonicalMilliseconds?.replace(/\.000Z$/u, "Z") ?? null;
  if (
    canonicalMilliseconds === null ||
    (value !== canonicalMilliseconds && value !== canonicalWholeSeconds)
  ) {
    fail("time", `${label} must be one canonical RFC 3339 UTC timestamp`);
  }
  return value;
}

export function normalizeSemanticMarkdown(value: string): string {
  if (typeof value !== "string" || value.includes("\u0000") || value.startsWith("\ufeff")) {
    fail("semantic-markdown", "Semantic Markdown must be UTF-8 text without BOM or NUL");
  }
  const normalized = value.replaceAll("\r\n", "\n");
  if (normalized.includes("\r")) {
    fail("semantic-markdown", "Semantic Markdown must use LF or CRLF line endings consistently");
  }
  const canonical = `${normalized.replace(/\n+$/u, "")}\n`;
  if (canonical.trim().length === 0) {
    fail("semantic-markdown", "Semantic Markdown must contain non-whitespace content");
  }
  if (Buffer.byteLength(canonical, "utf8") > MAXIMUM_SEMANTIC_MARKDOWN_BYTES) {
    fail("semantic-markdown", "Semantic Markdown exceeds the Control record limit");
  }
  return canonical;
}

function boundedControlJson(
  value: ControlJsonObject,
  label: string,
  maximumBytes: number,
): string {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    fail("json", `${label} must be one JSON object`);
  }
  const pending: Array<Readonly<{ value: ControlJsonValue; depth: number }>> = [
    Object.freeze({ value, depth: 1 }),
  ];
  const seen = new Set<object>();
  let valueCount = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    valueCount += 1;
    if (valueCount > MAXIMUM_JSON_VALUES) {
      fail("json-bounds", `${label} exceeds the maximum JSON value count`);
    }
    if (current.depth > MAXIMUM_JSON_DEPTH) {
      fail("json-bounds", `${label} exceeds the maximum JSON nesting depth`);
    }
    if (typeof current.value === "string") {
      if (
        current.value.length > maximumBytes ||
        Buffer.byteLength(current.value, "utf8") > maximumBytes
      ) {
        fail("json-bounds", `${label} contains a string larger than its byte limit`);
      }
      continue;
    }
    if (current.value === null || typeof current.value !== "object") continue;
    if (seen.has(current.value)) fail("json", `${label} contains a cyclic value`);
    seen.add(current.value);
    const members = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value);
    if (members.length > MAXIMUM_JSON_MEMBERS) {
      fail("json-bounds", `${label} contains too many members in one collection`);
    }
    for (const member of members) {
      pending.push(Object.freeze({ value: member, depth: current.depth + 1 }));
    }
  }
  try {
    const canonical = canonicalJson(value);
    if (Buffer.byteLength(canonical, "utf8") > maximumBytes) {
      fail("json-bounds", `${label} exceeds its canonical byte limit`);
    }
    return canonical;
  } catch (error) {
    if (error instanceof FoundationError) throw error;
    fail("json", `${label} is outside the bounded canonical JSON domain: ${(error as Error).message}`);
  }
}

function frozenCanonicalControlJsonObject(canonical: string): ControlJsonObject {
  const value = JSON.parse(canonical) as ControlJsonObject;
  const pending: object[] = [value];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const member of Array.isArray(current) ? current : Object.values(current)) {
      if (member !== null && typeof member === "object") pending.push(member);
    }
    Object.freeze(current);
  }
  return value;
}

export function canonicalControlJsonObject(value: ControlJsonObject, label: string): string {
  return boundedControlJson(value, label, MAXIMUM_REVISION_PAYLOAD_BYTES);
}

export function canonicalControlEventJsonObject(value: ControlJsonObject, label: string): string {
  return boundedControlJson(value, label, MAXIMUM_EVENT_PAYLOAD_BYTES);
}

function normalizedControlJsonObject(
  value: ControlJsonObject,
  label: string,
  maximumBytes: number,
): ControlJsonObject {
  return frozenCanonicalControlJsonObject(boundedControlJson(value, label, maximumBytes));
}

function normalizedActor(actor: ControlActor, label: string): ControlActor {
  if (!(["agent", "director", "runtime"] as const).includes(actor.kind)) {
    fail("actor", `${label} has an unsupported actor kind`);
  }
  return Object.freeze({ kind: actor.kind, id: controlIdentifier(actor.id, `${label} identity`) });
}

function relationshipOrder(left: ControlRecordRelationship, right: ControlRecordRelationship): number {
  return compareCodePoints(
    `${left.relation}\u0000${left.target.kind}\u0000${left.target.id}\u0000${left.target.revision}\u0000${left.target.digest}`,
    `${right.relation}\u0000${right.target.kind}\u0000${right.target.id}\u0000${right.target.revision}\u0000${right.target.digest}`,
  );
}

function normalizedRelationships(
  values: readonly ControlRecordRelationship[] | undefined,
): readonly ControlRecordRelationship[] {
  if ((values?.length ?? 0) > MAXIMUM_RELATIONSHIPS) {
    fail("relationship", "Control record revision exceeds the relationship limit");
  }
  const normalized = (values ?? []).map((value, index) => {
    const relation = controlRecordKind(value.relation, `Relationship ${index + 1} type`);
    const revision = value.target.revision;
    if (!Number.isSafeInteger(revision) || revision < 1) {
      fail("relationship", `Relationship ${index + 1} target revision must be a positive integer`);
    }
    if (!/^sha256:[a-f0-9]{64}$/u.test(value.target.digest)) {
      fail("relationship", `Relationship ${index + 1} target digest must be one lowercase SHA-256 digest`);
    }
    return Object.freeze({
      relation,
      target: Object.freeze({
        kind: controlRecordKind(value.target.kind, `Relationship ${index + 1} target kind`),
        id: controlIdentifier(value.target.id, `Relationship ${index + 1} target identity`),
        revision,
        digest: value.target.digest,
      }),
    });
  }).sort(relationshipOrder);
  for (let index = 1; index < normalized.length; index += 1) {
    if (relationshipOrder(normalized[index - 1]!, normalized[index]!) === 0) {
      fail("relationship", "Control record relationships must be unique");
    }
  }
  return Object.freeze(normalized);
}

export function compileControlRecordRevision(
  processId: string,
  input: ControlRecordRevisionInput,
): ControlRecordRevision {
  const recordId = controlIdentifier(input.recordId, "Control record identity");
  const recordKind = controlRecordKind(input.recordKind);
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
    fail("revision", "Control record revision must be a positive safe integer");
  }
  const producer = normalizedActor(input.producer, "Control record producer");
  const semanticAuthor = normalizedActor(input.semanticAuthor, "Control record semantic author");
  if (!([
    "agent-proposed",
    "director-supplied",
    "director-authenticated",
    "runtime-observed",
    "runtime-derived",
  ] as const).includes(input.semanticAuthority)) {
    fail("semantic-authority", "Control record revision has an unsupported semantic authority");
  }
  const semanticMarkdown = normalizeSemanticMarkdown(input.semanticMarkdown);
  const relationships = normalizedRelationships(input.relationships);
  const payload = normalizedControlJsonObject(
    input.payload,
    "Control record payload",
    MAXIMUM_REVISION_PAYLOAD_BYTES,
  );
  const subject = Object.freeze({
    schema: CONTROL_RECORD_REVISION_SCHEMA,
    processId: controlIdentifier(processId, "Process identity"),
    recordId,
    recordKind,
    revision: input.revision,
    producer,
    semanticAuthor,
    semanticAuthority: input.semanticAuthority,
    createdAt: controlTimestamp(input.createdAt, "Control record creation time"),
    semanticMarkdown,
    payload,
    relationships,
  });
  return Object.freeze({ ...subject, digest: digestCanonical(subject) });
}

export function compileControlRecordEvent(input: Readonly<{
  storeId: string;
  processId: string;
  sequence: number;
  predecessorDigest: Sha256 | null;
  event: ControlRecordEventInput;
}>): ControlRecordEvent {
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) {
    fail("event-sequence", "Control record event sequence must be a positive safe integer");
  }
  if ((input.sequence === 1) !== (input.predecessorDigest === null)) {
    fail("event-predecessor", "Only the first Control record event can omit its predecessor digest");
  }
  const payload = normalizedControlJsonObject(
    input.event.payload,
    "Control record event payload",
    MAXIMUM_EVENT_PAYLOAD_BYTES,
  );
  const subject = input.event.subject === undefined || input.event.subject === null
    ? null
    : Object.freeze({
      recordId: controlIdentifier(input.event.subject.recordId, "Event subject record identity"),
      revision: input.event.subject.revision,
      digest: input.event.subject.digest,
    });
  if (subject !== null && (!Number.isSafeInteger(subject.revision) || subject.revision < 1)) {
    fail("event-subject", "Event subject revision must be a positive safe integer");
  }
  if (subject !== null && !/^sha256:[a-f0-9]{64}$/u.test(subject.digest)) {
    fail("event-subject", "Event subject digest must be one lowercase SHA-256 digest");
  }
  const values = Object.freeze({
    schema: CONTROL_RECORD_EVENT_SCHEMA,
    storeId: controlIdentifier(input.storeId, "Control Record Store identity"),
    processId: controlIdentifier(input.processId, "Process identity"),
    sequence: input.sequence,
    eventId: controlIdentifier(input.event.eventId, "Control record event identity"),
    eventKind: controlRecordKind(input.event.eventKind, "Control record event kind"),
    occurredAt: controlTimestamp(input.event.occurredAt, "Control record event time"),
    actor: normalizedActor(input.event.actor, "Control record event actor"),
    subject,
    payload,
    predecessorDigest: input.predecessorDigest,
  });
  return Object.freeze({ ...values, digest: digestCanonical(values) });
}
