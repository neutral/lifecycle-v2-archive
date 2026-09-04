import { FoundationError } from "../error.js";
import type {
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordEvent,
  ControlRecordRevision,
  ControlRecordEventSubject,
} from "../control/types.js";
import { digestCanonical } from "../validation/canonical.js";
import { parseFoundationTransactionObservationFactsV7 } from
  "./transaction-observation-facts-v7.js";

export const DELIVERY_EVENT_KINDS = Object.freeze([
  "delivery-created",
  "founder-brief-submitted",
  "activity-started",
  "activity-recovery-recorded",
  "agent-pre-intent-refused",
  "agent-attempt-prepared",
  "provider-effect-intended",
  "provider-effect-observed",
  "agent-work-product-submitted",
  "agent-work-product-abandoned",
  "candidate-revision-observed",
  "execution-receipt-recorded",
  "work-boundary-finalized",
  "material-condition-frozen",
  "candidate-sealed",
  "check-receipt-recorded",
  "evidence-packet-finalized",
  "founder-decision-authenticated",
  "transaction-effect-intended",
  "transaction-effect-observed",
  "activity-completed",
  "closure-recorded",
] as const);

export type DeliveryEventKind = typeof DELIVERY_EVENT_KINDS[number];

export type DeliveryEventSubjectKind =
  | "founder-brief"
  | "agent-attempt"
  | "agent-work-product"
  | "candidate-revision"
  | "execution-receipt"
  | "work-boundary"
  | "material-condition"
  | "candidate-seal"
  | "check-receipt"
  | "evidence-packet"
  | "founder-decision"
  | "closure";

export type DeliveryEventDescriptor = Readonly<{
  kind: DeliveryEventKind;
  boundary:
    | "process"
    | "activity"
    | "provider-effect"
    | "work-product"
    | "candidate"
    | "receipt"
    | "boundary"
    | "evidence"
    | "authority"
    | "transaction"
    | "closure";
  subjectKind: DeliveryEventSubjectKind | null;
  subjectUse: "forbidden" | "required" | "exact-activity-subject";
}>;

const DESCRIPTORS = Object.freeze({
  "delivery-created": {
    kind: "delivery-created",
    boundary: "process",
    subjectKind: null,
    subjectUse: "forbidden",
  },
  "founder-brief-submitted": {
    kind: "founder-brief-submitted",
    boundary: "activity",
    subjectKind: "founder-brief",
    subjectUse: "required",
  },
  "activity-started": {
    kind: "activity-started",
    boundary: "activity",
    subjectKind: null,
    subjectUse: "forbidden",
  },
  "activity-recovery-recorded": {
    kind: "activity-recovery-recorded",
    boundary: "activity",
    subjectKind: null,
    subjectUse: "forbidden",
  },
  "agent-pre-intent-refused": {
    kind: "agent-pre-intent-refused",
    boundary: "activity",
    subjectKind: null,
    subjectUse: "forbidden",
  },
  "agent-attempt-prepared": {
    kind: "agent-attempt-prepared",
    boundary: "activity",
    subjectKind: "agent-attempt",
    subjectUse: "required",
  },
  "provider-effect-intended": {
    kind: "provider-effect-intended",
    boundary: "provider-effect",
    subjectKind: "agent-attempt",
    subjectUse: "exact-activity-subject",
  },
  "provider-effect-observed": {
    kind: "provider-effect-observed",
    boundary: "provider-effect",
    subjectKind: "agent-attempt",
    subjectUse: "exact-activity-subject",
  },
  "agent-work-product-submitted": {
    kind: "agent-work-product-submitted",
    boundary: "work-product",
    subjectKind: "agent-work-product",
    subjectUse: "required",
  },
  "agent-work-product-abandoned": {
    kind: "agent-work-product-abandoned",
    boundary: "work-product",
    subjectKind: "agent-attempt",
    subjectUse: "exact-activity-subject",
  },
  "candidate-revision-observed": {
    kind: "candidate-revision-observed",
    boundary: "candidate",
    subjectKind: "candidate-revision",
    subjectUse: "required",
  },
  "execution-receipt-recorded": {
    kind: "execution-receipt-recorded",
    boundary: "receipt",
    subjectKind: "execution-receipt",
    subjectUse: "required",
  },
  "work-boundary-finalized": {
    kind: "work-boundary-finalized",
    boundary: "boundary",
    subjectKind: "work-boundary",
    subjectUse: "required",
  },
  "material-condition-frozen": {
    kind: "material-condition-frozen",
    boundary: "boundary",
    subjectKind: "material-condition",
    subjectUse: "required",
  },
  "candidate-sealed": {
    kind: "candidate-sealed",
    boundary: "evidence",
    subjectKind: "candidate-seal",
    subjectUse: "required",
  },
  "check-receipt-recorded": {
    kind: "check-receipt-recorded",
    boundary: "evidence",
    subjectKind: "check-receipt",
    subjectUse: "required",
  },
  "evidence-packet-finalized": {
    kind: "evidence-packet-finalized",
    boundary: "evidence",
    subjectKind: "evidence-packet",
    subjectUse: "required",
  },
  "founder-decision-authenticated": {
    kind: "founder-decision-authenticated",
    boundary: "authority",
    subjectKind: "founder-decision",
    subjectUse: "required",
  },
  "transaction-effect-intended": {
    kind: "transaction-effect-intended",
    boundary: "transaction",
    subjectKind: "founder-decision",
    subjectUse: "exact-activity-subject",
  },
  "transaction-effect-observed": {
    kind: "transaction-effect-observed",
    boundary: "transaction",
    subjectKind: "founder-decision",
    subjectUse: "exact-activity-subject",
  },
  "activity-completed": {
    kind: "activity-completed",
    boundary: "activity",
    subjectKind: null,
    subjectUse: "forbidden",
  },
  "closure-recorded": {
    kind: "closure-recorded",
    boundary: "closure",
    subjectKind: "closure",
    subjectUse: "required",
  },
} satisfies Readonly<Record<DeliveryEventKind, DeliveryEventDescriptor>>);

type PayloadField =
  | "identifier"
  | "sha256"
  | "nullable-sha256"
  | "transaction-facts"
  | Readonly<{ values: readonly string[] }>;

const OPERATIONS = Object.freeze([
  "delivery.prepare",
  "delivery.admit",
  "delivery.continue",
  "delivery.evaluate",
  "delivery.revise",
  "delivery.reaffirm",
  "delivery.accept",
  "delivery.no-ship",
  "delivery.recover",
] as const);

const PAYLOAD_FIELDS = Object.freeze({
  "delivery-created": Object.freeze({}),
  "founder-brief-submitted": Object.freeze({ activityId: "identifier" }),
  "activity-started": Object.freeze({
    activityId: "identifier",
    operation: Object.freeze({ values: OPERATIONS }),
  }),
  "activity-recovery-recorded": Object.freeze({
    activityId: "identifier",
    exactEffectDigest: "nullable-sha256",
    kind: Object.freeze({ values: Object.freeze([
      "provider",
      "candidate-observation",
      "transaction",
      "finalization",
    ]) }),
    resumesAt: "identifier",
  }),
  "agent-pre-intent-refused": Object.freeze({
    activityId: "identifier",
    diagnosticCode: "identifier",
    refusalFactsDigest: "sha256",
  }),
  "agent-attempt-prepared": Object.freeze({ activityId: "identifier" }),
  "provider-effect-intended": Object.freeze({ activityId: "identifier", effectDigest: "sha256" }),
  "provider-effect-observed": Object.freeze({
    activityId: "identifier",
    effectDigest: "sha256",
    outcome: Object.freeze({ values: Object.freeze(["completed", "failed", "not-started"]) }),
  }),
  "agent-work-product-submitted": Object.freeze({ activityId: "identifier" }),
  "agent-work-product-abandoned": Object.freeze({ activityId: "identifier" }),
  "candidate-revision-observed": Object.freeze({ activityId: "identifier" }),
  "execution-receipt-recorded": Object.freeze({ activityId: "identifier" }),
  "work-boundary-finalized": Object.freeze({ activityId: "identifier" }),
  "material-condition-frozen": Object.freeze({
    sourceKind: Object.freeze({ values: Object.freeze(["agent-proposal"]) }),
    activityId: "identifier",
    observedFactsDigest: "sha256",
  }),
  "candidate-sealed": Object.freeze({ activityId: "identifier" }),
  "check-receipt-recorded": Object.freeze({ activityId: "identifier" }),
  "evidence-packet-finalized": Object.freeze({ activityId: "identifier" }),
  "founder-decision-authenticated": Object.freeze({ activityId: "identifier" }),
  "transaction-effect-intended": Object.freeze({ activityId: "identifier", effectDigest: "sha256" }),
  "transaction-effect-observed": Object.freeze({
    activityId: "identifier",
    effectDigest: "sha256",
    facts: "transaction-facts",
    factsDigest: "sha256",
    outcome: Object.freeze({ values: Object.freeze(["applied", "not-applied", "indeterminate"]) }),
  }),
  "activity-completed": Object.freeze({
    activityId: "identifier",
    outcome: Object.freeze({ values: Object.freeze(["completed", "failed", "abandoned"]) }),
  }),
  "closure-recorded": Object.freeze({ activityId: "identifier" }),
} satisfies Readonly<Record<DeliveryEventKind, Readonly<Record<string, PayloadField>>>>);

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.delivery-event.${code}`, message);
}

export function deliveryEventDescriptors(): readonly DeliveryEventDescriptor[] {
  return DELIVERY_EVENT_KINDS.map((kind) => DESCRIPTORS[kind]);
}

export function deliveryEventDescriptor(kind: string): DeliveryEventDescriptor {
  if (!DELIVERY_EVENT_KINDS.includes(kind as DeliveryEventKind)) {
    fail("kind", `Unsupported Delivery event kind ${kind}`);
  }
  return DESCRIPTORS[kind as DeliveryEventKind];
}

function assertPayloadValue(name: string, value: ControlJsonValue, field: PayloadField): void {
  if (field === "identifier") {
    if (
      typeof value !== "string" ||
      !IDENTIFIER_PATTERN.test(value) ||
      Buffer.byteLength(value, "utf8") > 512
    ) {
      fail("payload", `Delivery event payload ${name} must be one bounded opaque identity`);
    }
    return;
  }
  if (field === "sha256") {
    if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
      fail("payload", `Delivery event payload ${name} must be one lowercase SHA-256 digest`);
    }
    return;
  }
  if (field === "nullable-sha256") {
    if (value !== null && (typeof value !== "string" || !SHA256_PATTERN.test(value))) {
      fail("payload", `Delivery event payload ${name} must be null or one lowercase SHA-256 digest`);
    }
    return;
  }
  if (field === "transaction-facts") {
    parseFoundationTransactionObservationFactsV7(value);
    return;
  }
  if (typeof value !== "string" || !field.values.includes(value)) {
    fail("payload", `Delivery event payload ${name} has an unsupported value`);
  }
}

export function assertDeliveryEventPayload(event: ControlRecordEvent): ControlJsonObject {
  const descriptor = deliveryEventDescriptor(event.eventKind);
  const fields: Readonly<Record<string, PayloadField>> = PAYLOAD_FIELDS[descriptor.kind];
  const actual = Object.keys(event.payload).sort();
  const expected = Object.keys(fields).sort();
  if (
    actual.length !== expected.length ||
    actual.some((name, index) => name !== expected[index])
  ) {
    fail(
      "payload",
      `${descriptor.kind} payload must contain exactly ${
        expected.length === 0 ? "no fields" : expected.join(", ")
      }`,
    );
  }
  for (const name of expected) {
    assertPayloadValue(name, event.payload[name]!, fields[name]!);
  }
  if (descriptor.kind === "transaction-effect-observed") {
    const facts = parseFoundationTransactionObservationFactsV7(event.payload.facts);
    if (digestCanonical(facts) !== event.payload.factsDigest) {
      fail("payload", "Transaction observation facts differ from their retained digest");
    }
  }
  return event.payload;
}

export function assertDeliveryEventEnvelope(event: ControlRecordEvent): DeliveryEventDescriptor {
  const descriptor = deliveryEventDescriptor(event.eventKind);
  if (descriptor.subjectUse === "forbidden" && event.subject !== null) {
    fail("subject", `${descriptor.kind} cannot carry a Control record subject`);
  }
  if (descriptor.subjectUse !== "forbidden" && event.subject === null) {
    fail("subject", `${descriptor.kind} must bind its exact Control record subject`);
  }
  assertDeliveryEventPayload(event);
  return descriptor;
}

export function deliveryEventSubject(event: ControlRecordEvent): ControlRecordEventSubject {
  assertDeliveryEventEnvelope(event);
  if (event.subject === null) {
    fail("subject", `${event.eventKind} has no Control record subject`);
  }
  return event.subject;
}

export type DeliveryRecordRevisionResolver = (
  subject: ControlRecordEventSubject,
) => ControlRecordRevision | null;

export function resolveDeliveryEventSubject(
  event: ControlRecordEvent,
  processId: string,
  resolveRevision: DeliveryRecordRevisionResolver,
): ControlRecordRevision {
  const descriptor = assertDeliveryEventEnvelope(event);
  if (descriptor.subjectKind === null || event.subject === null) {
    fail("subject", `${event.eventKind} has no Control record subject to resolve`);
  }
  const revision = resolveRevision(event.subject);
  if (revision === null) {
    fail("subject", `${event.eventKind} names an unavailable Control record revision`);
  }
  if (
    revision.processId !== processId ||
    revision.recordId !== event.subject.recordId ||
    revision.revision !== event.subject.revision ||
    revision.digest !== event.subject.digest
  ) {
    fail("subject", `${event.eventKind} does not resolve to its exact retained revision`);
  }
  if (revision.recordKind !== descriptor.subjectKind) {
    fail(
      "subject-kind",
      `${event.eventKind} requires ${descriptor.subjectKind}, received ${revision.recordKind}`,
    );
  }
  return revision;
}
