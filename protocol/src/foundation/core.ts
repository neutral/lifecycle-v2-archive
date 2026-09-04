import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { z } from "zod/v4";
import { FoundationProtocolError } from "../protocol-error.js";
import {
  parseFoundationStrictJson,
  type FoundationStrictJsonLimits,
} from "../strict-json.js";
import {
  FoundationNonnegativeSafeIntegerSchema,
  FoundationPlainTextSchema,
  FoundationPositiveSafeIntegerSchema,
} from "./internal.js";
import {
  FOUNDATION_DELIVERY_RECOVERY_STEPS,
  refineRecoveryPair,
  type FoundationDeliveryRecoveryStep,
} from "./recovery.js";

export { FoundationProtocolError, parseFoundationStrictJson };
export type { FoundationStrictJsonLimits };
export { FOUNDATION_DELIVERY_RECOVERY_STEPS };
export type { FoundationDeliveryRecoveryStep };

export const FOUNDATION_INTERFACE_PROTOCOL = "lifecycle.interface.foundation.v10" as const;
export const FOUNDATION_RUNTIME_PROTOCOL = "lifecycle.runtime.foundation.v10" as const;
export const FOUNDATION_RUNTIME_FACADE_SCHEMA = "lifecycle.foundation-runtime-facade.v10" as const;
export const FOUNDATION_RUNTIME_RESULT_SCHEMA = "lifecycle.foundation-runtime-result.v10" as const;
export const FOUNDATION_RUNTIME_OBSERVATION_SCHEMA = "lifecycle.foundation-runtime-observation.v10" as const;
export const FOUNDATION_DELIVERY_GENERATION_SCHEMA = "lifecycle.delivery-generation.v1" as const;
export const FOUNDATION_DELIVERY_VIEW_SCHEMA = "lifecycle.delivery-view.v1" as const;
export const FOUNDATION_DELIVERY_INBOX_SCHEMA = "lifecycle.delivery-inbox.v1" as const;
export const FOUNDATION_DELIVERY_DIFF_SCHEMA = "lifecycle.delivery-diff.v1" as const;
export const FOUNDATION_ATTEMPT_VIEW_SCHEMA = "lifecycle.attempt-view.v1" as const;
export const FOUNDATION_ATTEMPT_VIEW_PROFILE_ID = "lifecycle.attempt-view.foundation-v1" as const;
export const FOUNDATION_DELIVERY_REDUCER_ID = "lifecycle.delivery-reducer.foundation-v2" as const;

export const FOUNDATION_DELIVERY_OPERATIONS = Object.freeze([
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

export const FOUNDATION_RUNTIME_OPERATION_KINDS = Object.freeze([
  "repository.initialize",
  "repository.validate",
  "delivery.inbox",
  "delivery.status",
  ...FOUNDATION_DELIVERY_OPERATIONS,
  "delivery.inspect",
  "delivery.diff",
  "delivery.watch",
  "delivery.export",
] as const);

export const FOUNDATION_CONTROL_RECORD_KINDS = Object.freeze([
  "founder-brief",
  "agent-attempt",
  "agent-work-product",
  "execution-receipt",
  "candidate-revision",
  "work-boundary",
  "material-condition",
  "founder-decision",
  "candidate-seal",
  "check-receipt",
  "evidence-packet",
  "closure",
] as const);

export const FOUNDATION_CONTROL_EVENT_KINDS = Object.freeze([
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

export const FOUNDATION_CONTROL_DOSSIERS = Object.freeze([
  "frame",
  "attempt",
  "candidate",
  "boundary",
  "evidence",
  "decision",
  "closure",
] as const);

export type FoundationRuntimeOperationKind = typeof FOUNDATION_RUNTIME_OPERATION_KINDS[number];
export type FoundationDeliveryOperation = typeof FOUNDATION_DELIVERY_OPERATIONS[number];
export type FoundationControlRecordKind = typeof FOUNDATION_CONTROL_RECORD_KINDS[number];
export type FoundationControlEventKind = typeof FOUNDATION_CONTROL_EVENT_KINDS[number];

export type FoundationJsonValue =
  | null
  | boolean
  | number
  | string
  | FoundationJsonValue[]
  | { [key: string]: FoundationJsonValue };

export type FoundationSha256 = `sha256:${string}`;

export const FoundationJsonValueSchema: z.ZodType<FoundationJsonValue> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number().finite().refine((value) => !Number.isInteger(value) || Number.isSafeInteger(value)),
  z.string(),
  z.array(FoundationJsonValueSchema).max(16_384),
  z.record(z.string(), FoundationJsonValueSchema),
]));

export const FoundationJsonObjectSchema = z.record(z.string(), FoundationJsonValueSchema);
export const FoundationSha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u)
  .transform((value): FoundationSha256 => value as FoundationSha256);
export const FoundationGitObjectSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
export const FoundationOpaqueIdSchema = z.string().min(1).max(512)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
export const FoundationRfc3339Schema = z.string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?Z$/u);

function assertUnicodeScalarValue(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        throw new FoundationProtocolError(
          "lifecycle.interface.canonical-unicode",
          `Unpaired high surrogate at ${path}`,
        );
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new FoundationProtocolError(
        "lifecycle.interface.canonical-unicode",
        `Unpaired low surrogate at ${path}`,
      );
    }
  }
}

function canonicalize(value: unknown, path: string, seen: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    assertUnicodeScalarValue(value, path);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new FoundationProtocolError(
        "lifecycle.interface.canonical-number",
        `Unsupported number at ${path}`,
      );
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new FoundationProtocolError(
        "lifecycle.interface.canonical-cycle",
        `Cyclic array at ${path}`,
      );
    }
    seen.add(value);
    const result = `[${value.map((item, index) => canonicalize(item, `${path}[${index}]`, seen)).join(",")}]`;
    seen.delete(value);
    return result;
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      throw new FoundationProtocolError(
        "lifecycle.interface.canonical-cycle",
        `Cyclic object at ${path}`,
      );
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new FoundationProtocolError(
        "lifecycle.interface.canonical-object",
        `Non-plain object at ${path}`,
      );
    }
    seen.add(value);
    const members = Object.keys(value as Record<string, unknown>).sort().map((key) => {
      assertUnicodeScalarValue(key, `${path} key`);
      const child = (value as Record<string, unknown>)[key];
      if (child === undefined) {
        throw new FoundationProtocolError(
          "lifecycle.interface.canonical-undefined",
          `Undefined member at ${path}.${key}`,
        );
      }
      return `${JSON.stringify(key)}:${canonicalize(child, `${path}.${key}`, seen)}`;
    });
    seen.delete(value);
    return `{${members.join(",")}}`;
  }
  throw new FoundationProtocolError(
    "lifecycle.interface.canonical-type",
    `Unsupported ${typeof value} at ${path}`,
  );
}

/** RFC 8785 canonical JSON over Lifecycle's bounded public JSON domain. */
export function canonicalFoundationJson(value: unknown): string {
  return canonicalize(value, "$", new Set<object>());
}

export function canonicalFoundationJsonLine(value: unknown): string {
  return `${canonicalFoundationJson(value)}\n`;
}

export function digestFoundationCanonical(value: unknown): FoundationSha256 {
  return `sha256:${bytesToHex(sha256(utf8ToBytes(canonicalFoundationJson(value))))}`;
}

export function selfDigestFoundationCarrier(value: Readonly<Record<string, unknown>>): FoundationSha256 {
  const { digest: _digest, ...subject } = value;
  return digestFoundationCanonical(subject);
}


const forbiddenPublicKeys = new Set([
  "allocationCoordinate",
  "allocationHandle",
  "allocationId",
  "allocationKey",
  "allocationLocator",
  "authorityProof",
  "authoritySecret",
  "backendCoordinate",
  "backendEndpoint",
  "backendHandle",
  "backendLocator",
  "candidateCustody",
  "cellCoordinate",
  "cellHandle",
  "cellId",
  "cellLocator",
  "cleanup",
  "container",
  "containerCoordinate",
  "containerHandle",
  "containerId",
  "containerLocator",
  "credentials",
  "custodyPath",
  "daemonEndpoint",
  "daemonIdentity",
  "databasePath",
  "dockerDaemon",
  "dockerEndpoint",
  "dockerSocket",
  "draftPath",
  "executionCell",
  "executionHandle",
  "garbageCollection",
  "gcState",
  "handle",
  "maintenanceState",
  "materialization",
  "physicalIdentityDigest",
  "physicalPath",
  "privatePath",
  "processHandle",
  "providerBytes",
  "query",
  "reclamation",
  "reclamationCoordinate",
  "reclamationHandle",
  "reclamationLocator",
  "reclamationState",
  "recoveryPackage",
  "runtimePath",
  "runtimeSupport",
  "sql",
  "sqlitePath",
  "supportCoordinateDigest",
  "transactionHandle",
  "volume",
  "volumeId",
  "workspacePath",
].map((key) => key.toLowerCase()));

const forbiddenPublicKeyPatterns = Object.freeze([
  /^(?:execution)?cell(?:coordinate|handle|id|identity|locator|name|pid|state)$/u,
  /^(?:docker)?container(?:runtime)?(?:command|coordinate|handle|id|identity|locator|name|pid|state)$/u,
  /^(?:allocation|backend|daemon|reclamation|transaction)(?:coordinate|endpoint|handle|host|id|identity|key|locator|path|socket|state|url|uri)$/u,
  /^(?:container|docker)?engine(?:coordinate|endpoint|handle|host|id|identity|key|locator|path|socket|state|url|uri)$/u,
  /^docker(?:config|daemon|endpoint|host|socket|url|uri)$/u,
  /^(?:codex|machine)home$/u,
  /^authority(?:bytes|credential|file|key|material|path|proof|root|secret|token|value)$/u,
  /^(?:auth|authentication|credential|credentials)(?:bytes|coordinate|digest|endpoint|file|handle|host|id|identity|key|location|locator|name|path|root|secret|socket|state|token|url|uri|value)$/u,
  /^(?:access|api|bearer|refresh)(?:credential|key|secret|token)$/u,
  /^provider(?:credential|key|secret|token)$/u,
  /^outputcarrier(?:coordinate|handle|locator|path|root|state)$/u,
  /^(?:private)?environment(?:bytes|dir|directory|location|locator|path|root|secret|token|value)$/u,
  /^(?:custody|database|draft|physical|private|runtime|sqlite|workspace)(?:dir|directory|location|locator|path|root)$/u,
]);

function normalizedPublicKey(key: string): string {
  return key.normalize("NFKC").replace(/[^A-Za-z0-9]/gu, "").toLowerCase();
}

function isForbiddenPublicKey(key: string): boolean {
  const normalized = normalizedPublicKey(key);
  return forbiddenPublicKeys.has(normalized) ||
    forbiddenPublicKeyPatterns.some((pattern) => pattern.test(normalized));
}

function findForbiddenPublicMechanic(
  value: FoundationJsonValue,
  path: readonly (string | number)[] = [],
): readonly (string | number)[] | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenPublicMechanic(value[index] as FoundationJsonValue, [...path, index]);
      if (found !== null) return found;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (isForbiddenPublicKey(key)) return [...path, key];
      const found = findForbiddenPublicMechanic(child, [...path, key]);
      if (found !== null) return found;
    }
  }
  return null;
}

export const FoundationPublicFactsSchema = FoundationJsonObjectSchema.superRefine((value, context) => {
  const path = findForbiddenPublicMechanic(value);
  if (path !== null) {
    context.addIssue({
      code: "custom",
      path: [...path],
      message: "Public facts cannot expose runtime custody or implementation mechanics",
    });
  }
});

export const FoundationControlRecordKindSchema = z.enum(FOUNDATION_CONTROL_RECORD_KINDS);
export const FoundationControlEventKindSchema = z.enum(FOUNDATION_CONTROL_EVENT_KINDS);
export const FoundationDeliveryOperationSchema = z.enum(FOUNDATION_DELIVERY_OPERATIONS);
export const FoundationRuntimeOperationKindSchema = z.enum(FOUNDATION_RUNTIME_OPERATION_KINDS);
export const FoundationDeliveryRecoveryStepSchema = z.enum(FOUNDATION_DELIVERY_RECOVERY_STEPS);

export const FoundationControlReferenceSchema = z.object({
  kind: FoundationControlRecordKindSchema,
  id: FoundationOpaqueIdSchema,
  revision: FoundationPositiveSafeIntegerSchema,
  digest: FoundationSha256Schema,
}).strict();

export const FoundationControlEventReferenceSchema = z.object({
  sequence: FoundationPositiveSafeIntegerSchema,
  eventId: FoundationOpaqueIdSchema,
  digest: FoundationSha256Schema,
}).strict();

export const FoundationControlActorSchema = z.object({
  kind: z.enum(["agent", "founder", "runtime"]),
  id: FoundationOpaqueIdSchema,
}).strict();

const FoundationEventSubjectSchema = z.object({
  recordId: FoundationOpaqueIdSchema,
  revision: FoundationPositiveSafeIntegerSchema,
  digest: FoundationSha256Schema,
}).strict();

const FoundationEmptyPayloadSchema = z.object({}).strict();
const FoundationActivityPayloadSchema = z.object({ activityId: FoundationOpaqueIdSchema }).strict();
const FoundationMaterialConditionFrozenPayloadSchema = z.object({
  sourceKind: z.literal("agent-proposal"),
  activityId: FoundationOpaqueIdSchema,
  observedFactsDigest: FoundationSha256Schema,
}).strict();
const FoundationActivityStartedPayloadSchema = z.object({
  activityId: FoundationOpaqueIdSchema,
  operation: FoundationDeliveryOperationSchema,
}).strict();
const FoundationActivityRecoveryPayloadSchema = z.object({
  activityId: FoundationOpaqueIdSchema,
  kind: z.enum(["provider", "candidate-observation", "transaction", "finalization"]),
  resumesAt: FoundationDeliveryRecoveryStepSchema,
  exactEffectDigest: FoundationSha256Schema.nullable(),
}).strict().superRefine(refineRecoveryPair);
const FoundationEffectIntendedPayloadSchema = z.object({
  activityId: FoundationOpaqueIdSchema,
  effectDigest: FoundationSha256Schema,
}).strict();
const FoundationProviderEffectObservedPayloadSchema = z.object({
  activityId: FoundationOpaqueIdSchema,
  effectDigest: FoundationSha256Schema,
  outcome: z.enum(["completed", "failed", "not-started"]),
}).strict();
const FoundationAdmissionDispositionSchema = z.object({
  outcome: z.literal("not-applied"),
  reason: z.enum(["repository-basis-mismatch", "candidate-continuity-mismatch"]),
  observedFactsDigest: FoundationSha256Schema,
}).strict();
const FoundationAdmissionTransactionObservationFactsSchema = z.object({
  schema: z.literal("lifecycle.admission-effect-observation-facts.v2"),
  outcome: z.enum(["applied", "not-applied", "indeterminate"]),
  disposition: FoundationAdmissionDispositionSchema.nullable(),
  repositoryBasisDigest: FoundationSha256Schema.nullable(),
}).strict();
const FoundationTerminalGitRefSchema = z.string()
  .max(512)
  .regex(/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._\/-]*$/u);
const FoundationTerminalRepositoryCoordinateSchema = z.object({
  ref: FoundationTerminalGitRefSchema,
  commit: FoundationGitObjectSchema,
  tree: FoundationGitObjectSchema,
  objectFormat: z.enum(["sha1", "sha256"]),
}).strict();
const FoundationTerminalRepositoryObservationFactsSchema =
  FoundationTerminalRepositoryCoordinateSchema.extend({
    schema: z.literal("lifecycle.terminal-repository-effect-observation.v1"),
  }).strict();
const FoundationTerminalAcceptanceObservationFactsSchema =
  FoundationTerminalRepositoryCoordinateSchema.extend({
    schema: z.literal("lifecycle.terminal-acceptance-effect-observation.v1"),
    canonicalResultDigest: FoundationSha256Schema,
  }).strict();
const FoundationTerminalDetachedObservationFactsSchema = z.object({
  schema: z.literal("lifecycle.terminal-detached-canonical-effect-observation.v1"),
  attached: FoundationTerminalRepositoryCoordinateSchema,
  canonicalRef: FoundationTerminalGitRefSchema,
  canonicalCommit: FoundationGitObjectSchema,
  canonicalTree: FoundationGitObjectSchema,
}).strict();
const FoundationTerminalFailureObservationFactsSchema = z.object({
  schema: z.literal("lifecycle.terminal-effect-failure.v1"),
  stage: z.enum([
    "repository-observation",
    "accepted-checkout",
    "acceptance-effect",
    "no-ship-non-integration",
  ]),
  code: FoundationOpaqueIdSchema,
}).strict();
const FoundationTransactionObservationFactsSchema = z.discriminatedUnion("schema", [
  FoundationAdmissionTransactionObservationFactsSchema,
  FoundationTerminalRepositoryObservationFactsSchema,
  FoundationTerminalAcceptanceObservationFactsSchema,
  FoundationTerminalDetachedObservationFactsSchema,
  FoundationTerminalFailureObservationFactsSchema,
]);
const FoundationTransactionEffectObservedPayloadSchema = z.object({
  activityId: FoundationOpaqueIdSchema,
  effectDigest: FoundationSha256Schema,
  facts: FoundationTransactionObservationFactsSchema,
  factsDigest: FoundationSha256Schema,
  outcome: z.enum(["applied", "not-applied", "indeterminate"]),
}).strict().superRefine((value, context) => {
  if (digestFoundationCanonical(value.facts) !== value.factsDigest) {
    context.addIssue({
      code: "custom",
      path: ["factsDigest"],
      message: "Transaction observation facts digest mismatch",
    });
  }
  if (
    value.facts.schema === "lifecycle.admission-effect-observation-facts.v2"
  ) {
    if (value.facts.outcome !== value.outcome) {
      context.addIssue({
        code: "custom",
        path: ["facts", "outcome"],
        message: "Admission observation facts outcome mismatch",
      });
    }
    if ((value.facts.outcome === "not-applied") !== (value.facts.disposition !== null)) {
      context.addIssue({
        code: "custom",
        path: ["facts", "disposition"],
        message: "Admission disposition must exist exactly for a not-applied observation",
      });
    }
    if (value.facts.outcome !== "indeterminate" && value.facts.repositoryBasisDigest === null) {
      context.addIssue({
        code: "custom",
        path: ["facts", "repositoryBasisDigest"],
        message: "Determinate Admission facts require a repository basis digest",
      });
    }
    if (
      value.facts.disposition?.reason === "repository-basis-mismatch" &&
      value.facts.disposition.observedFactsDigest !== value.facts.repositoryBasisDigest
    ) {
      context.addIssue({
        code: "custom",
        path: ["facts", "disposition", "observedFactsDigest"],
        message: "Repository-basis mismatch must bind the observed repository basis",
      });
    }
  }
  const assertObjectFormat = (
    coordinate: Readonly<{
      commit: string;
      tree: string;
      objectFormat: "sha1" | "sha256";
    }>,
    path: readonly (string | number)[],
  ): void => {
    const expectedLength = coordinate.objectFormat === "sha1" ? 40 : 64;
    if (coordinate.commit.length !== expectedLength) {
      context.addIssue({
        code: "custom",
        path: [...path, "commit"],
        message: "Git commit length must match the declared object format",
      });
    }
    if (coordinate.tree.length !== expectedLength) {
      context.addIssue({
        code: "custom",
        path: [...path, "tree"],
        message: "Git tree length must match the declared object format",
      });
    }
  };
  if (
    value.facts.schema === "lifecycle.terminal-repository-effect-observation.v1" ||
    value.facts.schema === "lifecycle.terminal-acceptance-effect-observation.v1"
  ) {
    assertObjectFormat(value.facts, ["facts"]);
  }
  if (
    value.facts.schema === "lifecycle.terminal-acceptance-effect-observation.v1" &&
    value.outcome !== "applied"
  ) {
    context.addIssue({
      code: "custom",
      path: ["outcome"],
      message: "Acceptance result facts require an applied outcome",
    });
  }
  if (value.facts.schema === "lifecycle.terminal-detached-canonical-effect-observation.v1") {
    assertObjectFormat(value.facts.attached, ["facts", "attached"]);
    const expectedLength = value.facts.attached.objectFormat === "sha1" ? 40 : 64;
    if (value.facts.canonicalCommit.length !== expectedLength) {
      context.addIssue({
        code: "custom",
        path: ["facts", "canonicalCommit"],
        message: "Canonical commit length must match the attached object format",
      });
    }
    if (value.facts.canonicalTree.length !== expectedLength) {
      context.addIssue({
        code: "custom",
        path: ["facts", "canonicalTree"],
        message: "Canonical tree length must match the attached object format",
      });
    }
  }
  if (
    value.facts.schema === "lifecycle.terminal-effect-failure.v1" &&
    value.outcome !== "indeterminate"
  ) {
    context.addIssue({
      code: "custom",
      path: ["outcome"],
      message: "Terminal failure facts require an indeterminate outcome",
    });
  }
  if (
    value.facts.schema === "lifecycle.terminal-detached-canonical-effect-observation.v1" &&
    value.outcome === "applied"
  ) {
    context.addIssue({
      code: "custom",
      path: ["outcome"],
      message: "Detached terminal facts cannot establish applied outcome",
    });
  }
});
const FoundationActivityCompletedPayloadSchema = z.object({
  activityId: FoundationOpaqueIdSchema,
  outcome: z.enum(["completed", "failed", "abandoned"]),
}).strict();
const FoundationAgentPreIntentRefusedPayloadSchema = z.object({
  activityId: FoundationOpaqueIdSchema,
  diagnosticCode: FoundationOpaqueIdSchema,
  refusalFactsDigest: FoundationSha256Schema,
}).strict();

const FoundationControlEventBaseSchema = z.object({
  schema: z.literal("lifecycle.control-record-event.v2"),
  storeId: FoundationOpaqueIdSchema,
  processId: FoundationOpaqueIdSchema,
  sequence: FoundationPositiveSafeIntegerSchema,
  eventId: FoundationOpaqueIdSchema,
  occurredAt: FoundationRfc3339Schema,
  actor: z.object({ kind: z.literal("runtime"), id: FoundationOpaqueIdSchema }).strict(),
  predecessorDigest: FoundationSha256Schema.nullable(),
  digest: FoundationSha256Schema,
});

function subjectEvent<Kind extends FoundationControlEventKind, Payload extends z.ZodType>(
  eventKind: Kind,
  payload: Payload,
) {
  return FoundationControlEventBaseSchema.extend({
    eventKind: z.literal(eventKind),
    subject: FoundationEventSubjectSchema,
    payload,
  }).strict();
}

function subjectlessEvent<Kind extends FoundationControlEventKind, Payload extends z.ZodType>(
  eventKind: Kind,
  payload: Payload,
) {
  return FoundationControlEventBaseSchema.extend({
    eventKind: z.literal(eventKind),
    subject: z.null(),
    payload,
  }).strict();
}

export const FoundationControlEventSchema = z.discriminatedUnion("eventKind", [
  subjectlessEvent("delivery-created", FoundationEmptyPayloadSchema),
  subjectEvent("founder-brief-submitted", FoundationActivityPayloadSchema),
  subjectlessEvent("activity-started", FoundationActivityStartedPayloadSchema),
  subjectlessEvent("activity-recovery-recorded", FoundationActivityRecoveryPayloadSchema),
  subjectlessEvent("agent-pre-intent-refused", FoundationAgentPreIntentRefusedPayloadSchema),
  subjectEvent("agent-attempt-prepared", FoundationActivityPayloadSchema),
  subjectEvent("provider-effect-intended", FoundationEffectIntendedPayloadSchema),
  subjectEvent("provider-effect-observed", FoundationProviderEffectObservedPayloadSchema),
  subjectEvent("agent-work-product-submitted", FoundationActivityPayloadSchema),
  subjectEvent("agent-work-product-abandoned", FoundationActivityPayloadSchema),
  subjectEvent("candidate-revision-observed", FoundationActivityPayloadSchema),
  subjectEvent("execution-receipt-recorded", FoundationActivityPayloadSchema),
  subjectEvent("work-boundary-finalized", FoundationActivityPayloadSchema),
  subjectEvent("material-condition-frozen", FoundationMaterialConditionFrozenPayloadSchema),
  subjectEvent("candidate-sealed", FoundationActivityPayloadSchema),
  subjectEvent("check-receipt-recorded", FoundationActivityPayloadSchema),
  subjectEvent("evidence-packet-finalized", FoundationActivityPayloadSchema),
  subjectEvent("founder-decision-authenticated", FoundationActivityPayloadSchema),
  subjectEvent("transaction-effect-intended", FoundationEffectIntendedPayloadSchema),
  subjectEvent("transaction-effect-observed", FoundationTransactionEffectObservedPayloadSchema),
  subjectlessEvent("activity-completed", FoundationActivityCompletedPayloadSchema),
  subjectEvent("closure-recorded", FoundationActivityPayloadSchema),
]).superRefine((value, context) => {
  if (value.digest !== selfDigestFoundationCarrier(value)) {
    context.addIssue({ code: "custom", path: ["digest"], message: "Control event digest mismatch" });
  }
  if ((value.sequence === 1) !== (value.predecessorDigest === null)) {
    context.addIssue({
      code: "custom",
      path: ["predecessorDigest"],
      message: "Only the first Control event has no predecessor digest",
    });
  }
});

export const FoundationControlRelationshipSchema = z.object({
  relation: z.string().min(1).max(160).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u),
  target: FoundationControlReferenceSchema,
}).strict();

export const FOUNDATION_SEMANTIC_MARKDOWN_MAXIMUM_BYTES = 1024 * 1024;
export const FoundationSemanticMarkdownSchema = z.string().min(1)
  .refine((value) => !value.startsWith("\ufeff"), { message: "Semantic Markdown cannot begin with BOM" })
  .refine((value) => !value.includes("\u0000"), { message: "Semantic Markdown cannot contain NUL" })
  .refine((value) => !value.includes("\r"), { message: "Semantic Markdown must use LF line endings" })
  .refine((value) => !/^---\n/u.test(value), { message: "Semantic Markdown must be body-only" })
  .refine((value) => new TextEncoder().encode(value).byteLength <= FOUNDATION_SEMANTIC_MARKDOWN_MAXIMUM_BYTES, {
    message: "Semantic Markdown exceeds its UTF-8 byte bound",
  });

export const FoundationControlRevisionSchema = z.object({
  schema: z.literal("lifecycle.control-record-revision.v1"),
  processId: FoundationOpaqueIdSchema,
  recordId: FoundationOpaqueIdSchema,
  recordKind: FoundationControlRecordKindSchema,
  revision: FoundationPositiveSafeIntegerSchema,
  producer: FoundationControlActorSchema,
  semanticAuthor: FoundationControlActorSchema,
  semanticAuthority: z.enum([
    "agent-proposed",
    "founder-supplied",
    "founder-authenticated",
    "runtime-observed",
    "runtime-derived",
  ]),
  createdAt: FoundationRfc3339Schema,
  semanticMarkdown: FoundationSemanticMarkdownSchema,
  payload: FoundationPublicFactsSchema,
  relationships: z.array(FoundationControlRelationshipSchema).max(4_096),
  digest: FoundationSha256Schema,
}).strict().superRefine((value, context) => {
  if (value.producer.kind !== "runtime") {
    context.addIssue({
      code: "custom",
      path: ["producer", "kind"],
      message: "Runtime produces Control revisions",
    });
  }
  if (value.digest !== selfDigestFoundationCarrier(value)) {
    context.addIssue({ code: "custom", path: ["digest"], message: "Control revision digest mismatch" });
  }
});

export const FoundationDeliveryActivitySchema = z.object({
  id: FoundationOpaqueIdSchema,
  operation: FoundationDeliveryOperationSchema,
  family: z.enum(["agent", "transaction"]),
  stage: z.enum([
    "started",
    "prepared",
    "effect-intended",
    "effect-observed",
    "submitted",
    "finalizing",
    "completed",
  ]),
}).strict();

export const FoundationDeliveryRecoverySchema = z.object({
  scope: z.enum(["activity", "store-disposition"]),
  activityId: FoundationOpaqueIdSchema.nullable(),
  kind: z.enum(["provider", "candidate-observation", "transaction", "finalization"]),
  resumesAt: FoundationDeliveryRecoveryStepSchema,
  exactEffectDigest: FoundationSha256Schema.nullable(),
}).strict().superRefine((value, context) => {
  refineRecoveryPair(value, context);
  const storeDisposition = value.resumesAt === "store-seal" || value.resumesAt === "store-archive";
  if (storeDisposition !== (value.scope === "store-disposition")) {
    context.addIssue({
      code: "custom",
      path: ["scope"],
      message: "Recovery scope must match activity or Store-disposition custody",
    });
  }
  if ((value.scope === "activity") !== (value.activityId !== null)) {
    context.addIssue({
      code: "custom",
      path: ["activityId"],
      message: "Only activity recovery carries an activity identity",
    });
  }
  if (value.scope === "store-disposition" && value.exactEffectDigest !== null) {
    context.addIssue({
      code: "custom",
      path: ["exactEffectDigest"],
      message: "Store disposition recovery has no effect digest",
    });
  }
});

export const FoundationDeliverySubjectsSchema = z.object({
  proposedBoundary: FoundationControlReferenceSchema.nullable(),
  activeBoundary: FoundationControlReferenceSchema.nullable(),
  candidate: FoundationControlReferenceSchema.nullable(),
  materialCondition: FoundationControlReferenceSchema.nullable(),
  seal: FoundationControlReferenceSchema.nullable(),
  evidence: FoundationControlReferenceSchema.nullable(),
  closure: FoundationControlReferenceSchema.nullable(),
}).strict();

export const FoundationDeliveryJournalSummarySchema = z.object({
  eventCount: FoundationNonnegativeSafeIntegerSchema.max(100_000),
  headSequence: FoundationPositiveSafeIntegerSchema.nullable(),
  headDigest: FoundationSha256Schema.nullable(),
}).strict().superRefine((value, context) => {
  if ((value.eventCount === 0) !== (value.headSequence === null && value.headDigest === null)) {
    context.addIssue({
      code: "custom",
      path: ["eventCount"],
      message: "Journal head presence must match event count",
    });
  }
  if (value.eventCount > 0 && value.headSequence !== value.eventCount) {
    context.addIssue({
      code: "custom",
      path: ["headSequence"],
      message: "Journal head must be the final event",
    });
  }
});

export const FoundationDeliveryStoreDispositionSchema = z.object({
  stage: z.enum(["active", "closure-recorded", "sealed", "archived"]),
  integrity: z.enum(["verified", "unverified", "invalid"]),
  sealSubjectDigest: FoundationSha256Schema.nullable(),
  archiveManifestDigest: FoundationSha256Schema.nullable(),
}).strict();

export const FoundationDeliveryStateSchema = z.object({
  schema: z.literal("lifecycle.delivery-reduction.v2"),
  storeId: FoundationOpaqueIdSchema,
  processId: FoundationOpaqueIdSchema,
  standing: z.enum([
    "framing",
    "awaiting-admission",
    "active",
    "boundary-paused",
    "awaiting-readmission",
    "decision-ready",
    "closed",
  ]),
  candidateCondition: z.enum([
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
  ]),
  activities: z.array(FoundationDeliveryActivitySchema).max(10_000),
  recovery: FoundationDeliveryRecoverySchema.nullable(),
  subjects: FoundationDeliverySubjectsSchema,
  journal: FoundationDeliveryJournalSummarySchema,
  storeDisposition: FoundationDeliveryStoreDispositionSchema,
  eligibleOperations: z.array(FoundationDeliveryOperationSchema).max(9),
}).strict().superRefine((value, context) => {
  if (new Set(value.activities.map(({ id }) => id)).size !== value.activities.length) {
    context.addIssue({
      code: "custom",
      path: ["activities"],
      message: "Activity identities must be unique",
    });
  }
  if (new Set(value.eligibleOperations).size !== value.eligibleOperations.length) {
    context.addIssue({
      code: "custom",
      path: ["eligibleOperations"],
      message: "Eligible operations must be unique",
    });
  }
});

export const FoundationDeliveryActivityPresentationSchema = z.object({
  activityId: FoundationOpaqueIdSchema,
  operation: FoundationDeliveryOperationSchema,
  stage: z.enum([
    "attempt-preparation",
    "provider-running",
    "semantic-result-observed",
    "semantic-compilation",
    "candidate-observation",
    "completion",
    "transaction",
    "recovery",
  ]),
}).strict();

/** Runtime-derived staleness token; clients validate its shape but cannot recompute it. */
export const FoundationDeliveryGenerationSchema = z.object({
  schema: z.literal(FOUNDATION_DELIVERY_GENERATION_SCHEMA),
  storeId: FoundationOpaqueIdSchema,
  processId: FoundationOpaqueIdSchema,
  journal: FoundationDeliveryJournalSummarySchema,
  storeDisposition: FoundationDeliveryStoreDispositionSchema,
  repository: z.object({
    headCommit: FoundationGitObjectSchema,
    headTree: FoundationGitObjectSchema,
    repositoryContractDigest: FoundationSha256Schema,
  }).strict(),
  activeOperation: FoundationDeliveryActivityPresentationSchema.nullable(),
  digest: FoundationSha256Schema,
}).strict();

const FoundationSemanticUncertaintySchema = z.enum(["none", "bounded", "material", "unknown"]);

export const FoundationSemanticStatementSchema = z.object({
  id: FoundationOpaqueIdSchema.nullable(),
  statement: FoundationPlainTextSchema,
  uncertainty: FoundationSemanticUncertaintySchema.nullable(),
}).strict();

export const FoundationTypedSemanticsSchema = z.object({
  outcome: z.object({
    disposition: FoundationOpaqueIdSchema.nullable(),
    summary: FoundationPlainTextSchema.nullable(),
    uncertainty: FoundationSemanticUncertaintySchema.nullable(),
  }).strict(),
  claims: z.array(FoundationSemanticStatementSchema).max(4_096),
  proposedEffects: z.array(FoundationSemanticStatementSchema).max(4_096),
  limitations: z.array(FoundationSemanticStatementSchema).max(1_024),
  requiredChecks: z.array(z.object({
    selectionId: FoundationOpaqueIdSchema,
    statement: FoundationPlainTextSchema,
    status: z.enum(["required", "passed", "failed", "incomplete", "not-run"]),
  }).strict()).max(4_096),
  boundaryProposal: z.object({
    reference: FoundationControlReferenceSchema,
    proposalKind: z.enum(["initial", "revision", "reaffirmation"]),
    objective: FoundationPlainTextSchema,
  }).strict().nullable(),
}).strict();

export const FoundationNextPassRequirementSchema = z.object({
  operation: z.enum([
    "delivery.continue",
    "delivery.evaluate",
    "delivery.revise",
    "delivery.reaffirm",
  ]),
  eligible: z.boolean(),
  role: z.enum(["reconnaissance", "builder", "reviewer"]),
  boundary: FoundationControlReferenceSchema.nullable(),
  candidate: FoundationControlReferenceSchema.nullable(),
  consequence: FoundationPlainTextSchema,
  investment: z.object({
    freshness: z.literal("fresh-on-invocation"),
    model: FoundationOpaqueIdSchema,
    reasoning: FoundationOpaqueIdSchema,
    wallTimeMs: FoundationPositiveSafeIntegerSchema,
    maximumOutputBytes: FoundationPositiveSafeIntegerSchema,
  }).strict(),
}).strict();

export const FoundationDecisionReadinessSchema = z.object({
  boundary: FoundationControlReferenceSchema.nullable(),
  candidate: FoundationControlReferenceSchema.nullable(),
  changedSubjects: z.array(FoundationSemanticStatementSchema).max(16_384),
  seal: FoundationControlReferenceSchema.nullable(),
  checks: z.array(z.object({
    selectionId: FoundationOpaqueIdSchema,
    disposition: z.enum(["pass", "fail", "indeterminate", "not-run", "unsupported", "operational-error"]),
    receipt: FoundationControlReferenceSchema.nullable(),
  }).strict()).max(4_096),
  reviewerFindings: z.array(FoundationSemanticStatementSchema).max(4_096),
  uncertainty: FoundationSemanticUncertaintySchema.nullable(),
  limitations: z.array(FoundationSemanticStatementSchema).max(1_024),
  evidence: FoundationControlReferenceSchema.nullable(),
  evidenceReadiness: z.enum([
    "acceptance-ready",
    "correctable",
    "revision-required",
    "no-ship-recommended",
  ]).nullable(),
  terminalChoices: z.array(z.enum(["delivery.accept", "delivery.no-ship"])).max(2),
}).strict();

export const FoundationControlFamilySummarySchema = z.object({
  recordKind: FoundationControlRecordKindSchema,
  recordCount: FoundationNonnegativeSafeIntegerSchema,
  revisionCount: FoundationNonnegativeSafeIntegerSchema,
  current: FoundationControlReferenceSchema.nullable(),
}).strict();

export const FoundationDeliveryViewSchema = z.object({
  schema: z.literal(FOUNDATION_DELIVERY_VIEW_SCHEMA),
  generation: FoundationDeliveryGenerationSchema,
  state: FoundationDeliveryStateSchema,
  currentSubjects: FoundationDeliverySubjectsSchema,
  semantics: FoundationTypedSemanticsSchema,
  nextPass: z.array(FoundationNextPassRequirementSchema).max(4),
  decisionReadiness: FoundationDecisionReadinessSchema,
  activity: FoundationDeliveryActivityPresentationSchema.nullable(),
  controlFamilies: z.array(FoundationControlFamilySummarySchema).max(FOUNDATION_CONTROL_RECORD_KINDS.length),
}).strict().superRefine((value, context) => {
  const sameCoordinate = (left: unknown, right: unknown) =>
    canonicalFoundationJson(left) === canonicalFoundationJson(right);
  const requireSameCoordinate = (
    left: unknown,
    right: unknown,
    path: readonly (string | number)[],
    message: string,
  ) => {
    if (!sameCoordinate(left, right)) {
      context.addIssue({ code: "custom", path: [...path], message });
    }
  };

  requireSameCoordinate(
    value.generation.storeId,
    value.state.storeId,
    ["generation", "storeId"],
    "Delivery View generation must bind the reduced Store identity",
  );
  requireSameCoordinate(
    value.generation.processId,
    value.state.processId,
    ["generation", "processId"],
    "Delivery View generation must bind the reduced Process identity",
  );
  requireSameCoordinate(
    value.generation.journal,
    value.state.journal,
    ["generation", "journal"],
    "Delivery View generation must bind the reduced Journal head",
  );
  requireSameCoordinate(
    value.generation.storeDisposition,
    value.state.storeDisposition,
    ["generation", "storeDisposition"],
    "Delivery View generation must bind the reduced Store disposition",
  );
  requireSameCoordinate(
    value.currentSubjects,
    value.state.subjects,
    ["currentSubjects"],
    "Delivery View current subjects must match the reduction",
  );
  requireSameCoordinate(
    value.activity,
    value.generation.activeOperation,
    ["activity"],
    "Delivery View activity must match the generated active operation",
  );
  const unresolvedActivities = value.state.activities.filter(({ stage }) => stage !== "completed");
  if (unresolvedActivities.length > 1) {
    context.addIssue({
      code: "custom",
      path: ["state", "activities"],
      message: "Delivery View can bind at most one unresolved activity",
    });
  }
  const unresolvedActivity = unresolvedActivities[0] ?? null;
  if (unresolvedActivity === null) {
    if (value.generation.activeOperation !== null) {
      context.addIssue({
        code: "custom",
        path: ["generation", "activeOperation"],
        message: "Delivery View cannot present an active operation without an unresolved activity",
      });
    }
    if (value.state.recovery?.scope === "activity") {
      context.addIssue({
        code: "custom",
        path: ["state", "recovery"],
        message: "Activity recovery requires one unresolved activity",
      });
    }
  } else {
    const recovery = value.state.recovery;
    if (
      recovery !== null &&
      (recovery.scope !== "activity" || recovery.activityId !== unresolvedActivity.id)
    ) {
      context.addIssue({
        code: "custom",
        path: ["state", "recovery"],
        message: "Activity recovery must bind the exact unresolved activity",
      });
    }
    const expectedStage = unresolvedActivity.family === "transaction"
      ? recovery === null ? "transaction" : "recovery"
      : recovery !== null
        ? "recovery"
        : unresolvedActivity.stage === "effect-intended"
          ? "provider-running"
          : unresolvedActivity.stage === "effect-observed"
            ? "semantic-result-observed"
            : unresolvedActivity.stage === "submitted" || unresolvedActivity.stage === "finalizing"
              ? "completion"
              : "attempt-preparation";
    requireSameCoordinate(
      value.generation.activeOperation,
      {
        activityId: unresolvedActivity.id,
        operation: unresolvedActivity.operation,
        stage: expectedStage,
      },
      ["generation", "activeOperation"],
      "Delivery View active operation must present the exact unresolved activity",
    );
  }
  const nextPassOperations = new Set<string>();
  for (const [index, requirement] of value.nextPass.entries()) {
    if (nextPassOperations.has(requirement.operation)) {
      context.addIssue({
        code: "custom",
        path: ["nextPass", index, "operation"],
        message: "Delivery View Next Pass operations must be unique",
      });
    }
    nextPassOperations.add(requirement.operation);
    const expectedRole = requirement.operation === "delivery.continue"
      ? "builder"
      : requirement.operation === "delivery.evaluate"
        ? "reviewer"
        : "reconnaissance";
    requireSameCoordinate(
      requirement.role,
      expectedRole,
      ["nextPass", index, "role"],
      "Next Pass role must match its exact operation",
    );
    requireSameCoordinate(
      requirement.eligible,
      value.state.eligibleOperations.includes(requirement.operation),
      ["nextPass", index, "eligible"],
      "Next Pass eligibility must match the reduction",
    );
    requireSameCoordinate(
      requirement.boundary,
      value.state.subjects.activeBoundary ?? value.state.subjects.proposedBoundary,
      ["nextPass", index, "boundary"],
      "Next Pass Boundary must match the reduction",
    );
    requireSameCoordinate(
      requirement.candidate,
      value.state.subjects.candidate,
      ["nextPass", index, "candidate"],
      "Next Pass Candidate must match the reduction",
    );
  }
  for (const subject of ["boundary", "candidate", "seal", "evidence"] as const) {
    const reducedSubject = subject === "boundary"
      ? value.state.subjects.activeBoundary
      : value.state.subjects[subject];
    requireSameCoordinate(
      value.decisionReadiness[subject],
      reducedSubject,
      ["decisionReadiness", subject],
      `Decision Readiness ${subject} must match the reduction`,
    );
  }
  requireSameCoordinate(
    value.decisionReadiness.terminalChoices,
    value.state.eligibleOperations.filter((operation) =>
      operation === "delivery.accept" || operation === "delivery.no-ship"),
    ["decisionReadiness", "terminalChoices"],
    "Decision Readiness terminal choices must match eligible operations",
  );
});

export const FoundationDeliveryInboxRowSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    deliveryId: FoundationOpaqueIdSchema,
    label: FoundationPlainTextSchema,
    standing: z.enum([
      "framing",
      "awaiting-admission",
      "active",
      "boundary-paused",
      "awaiting-readmission",
      "decision-ready",
      "closed",
    ]),
    candidateCondition: z.enum([
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
    ]),
    activity: FoundationDeliveryActivityPresentationSchema.nullable(),
    attentionOwner: z.enum(["founder", "runtime", "provider", "reviewer", "none"]),
    evidenceReadiness: z.enum([
      "acceptance-ready",
      "correctable",
      "revision-required",
      "no-ship-recommended",
    ]).nullable(),
    recoveryRequired: z.boolean(),
    latestMilestone: z.object({
      sequence: FoundationPositiveSafeIntegerSchema,
      eventKind: FoundationControlEventKindSchema,
      occurredAt: FoundationRfc3339Schema,
      digest: FoundationSha256Schema,
    }).strict().nullable(),
    generation: FoundationDeliveryGenerationSchema,
  }).strict(),
  z.object({
    status: z.literal("unavailable"),
    deliveryId: FoundationOpaqueIdSchema.nullable(),
    coordinateDigest: FoundationSha256Schema,
    diagnostic: z.object({
      code: FoundationOpaqueIdSchema,
      severity: z.enum(["info", "warning", "error"]),
      message: FoundationPlainTextSchema,
      retryable: z.boolean(),
      facts: FoundationPublicFactsSchema,
    }).strict(),
  }).strict(),
]);

export const FoundationDeliveryInboxSchema = z.object({
  schema: z.literal(FOUNDATION_DELIVERY_INBOX_SCHEMA),
  targetId: FoundationOpaqueIdSchema,
  rows: z.array(FoundationDeliveryInboxRowSchema).max(100),
  nextAfterDeliveryId: FoundationOpaqueIdSchema.nullable(),
  generation: FoundationSha256Schema,
}).strict();

export const FoundationDeliveryDiffSchema = z.object({
  schema: z.literal(FOUNDATION_DELIVERY_DIFF_SCHEMA),
  generation: FoundationDeliveryGenerationSchema,
  subject: z.enum(["candidate", "decision"]),
  currentness: z.enum(["exact", "potentially-advancing", "unavailable"]),
  candidate: FoundationControlReferenceSchema.nullable(),
  seal: FoundationControlReferenceSchema.nullable(),
  baseCommit: FoundationGitObjectSchema.nullable(),
  tree: FoundationGitObjectSchema.nullable(),
  exactDiffDigest: FoundationSha256Schema.nullable(),
  contentDigest: FoundationSha256Schema.nullable(),
  byteLength: FoundationNonnegativeSafeIntegerSchema.max(16 * 1024 * 1024),
  truncated: z.boolean(),
  content: z.string().max(16 * 1024 * 1024).nullable(),
  unavailableReason: FoundationPlainTextSchema.nullable(),
}).strict();

export const FoundationRepositoryAtlasObservationSchema = z.object({
  selection: z.object({
    release: z.literal("0.7.0"),
    specificationRevision: z.literal("429fee62966f4d30e91ec2a15d27ecf353f5d68f"),
    authoredFormat: z.literal(1),
    processorRevision: z.literal("746cbce73c51b28d617b96ca08f18d498ac749c4"),
    validationProfile: z.literal("neutral.atlas-validator.resolved"),
    validationResultSchema: z.literal("urn:atlas:schema:validation-result:1"),
    normalizedModelSchema: z.literal("urn:atlas:schema:normalized:1"),
    consumerProfile: z.literal("lifecycle.atlas-consumer.v1"),
  }).strict(),
  processor: z.object({
    id: z.literal("atlas-reference-validator"),
    version: z.literal("0.7.0"),
    implementationDigest: FoundationSha256Schema,
  }).strict(),
  stateDigest: FoundationSha256Schema,
  resolutionDigest: FoundationSha256Schema,
  normalizedModelDigest: FoundationSha256Schema,
  resourceBindingsDigest: FoundationSha256Schema,
  complete: z.literal(true),
  valid: z.literal(true),
}).strict();

export const FoundationRepositoryObservationSchema = z.object({
  schema: z.literal("lifecycle.repository-observation.v10"),
  initialized: z.boolean(),
  valid: z.boolean(),
  targetId: FoundationOpaqueIdSchema.nullable(),
  repositoryContract: z.literal("lifecycle.repository.v15").nullable(),
  repositoryContractDigest: FoundationSha256Schema.nullable(),
  headCommit: FoundationGitObjectSchema.nullable(),
  headTree: FoundationGitObjectSchema.nullable(),
  productDigest: FoundationSha256Schema.nullable(),
  atlas: FoundationRepositoryAtlasObservationSchema.nullable(),
  knowledgeDigest: FoundationSha256Schema.nullable(),
  checkBindingsDigest: FoundationSha256Schema.nullable(),
}).strict();

export const FoundationRuntimeObservationSchema = z.object({
  schema: z.literal(FOUNDATION_RUNTIME_OBSERVATION_SCHEMA),
  observedAt: FoundationRfc3339Schema,
  repository: FoundationRepositoryObservationSchema,
  delivery: FoundationDeliveryStateSchema.nullable(),
}).strict();

export const FoundationRepositoryChangeSchema = z.object({
  changed: z.boolean(),
  beforeCommit: FoundationGitObjectSchema.nullable(),
  afterCommit: FoundationGitObjectSchema.nullable(),
}).strict();

export const FoundationCandidateChangeSchema = z.object({
  changed: z.boolean(),
  before: FoundationControlReferenceSchema.nullable(),
  after: FoundationControlReferenceSchema.nullable(),
}).strict();

export const FoundationControlChangeSchema = z.object({
  advanced: z.boolean(),
  beforeHead: FoundationControlEventReferenceSchema.nullable(),
  afterHead: FoundationControlEventReferenceSchema.nullable(),
}).strict();

export const FoundationChangeFactsSchema = z.object({
  repository: FoundationRepositoryChangeSchema,
  candidate: FoundationCandidateChangeSchema,
  control: FoundationControlChangeSchema,
}).strict();

export const FoundationDiagnosticSchema = z.object({
  code: FoundationOpaqueIdSchema,
  severity: z.enum(["info", "warning", "error"]),
  message: FoundationPlainTextSchema,
  retryable: z.boolean(),
  facts: FoundationPublicFactsSchema,
}).strict();

export type FoundationControlReference = z.output<typeof FoundationControlReferenceSchema>;
export type FoundationControlEventReference = z.output<typeof FoundationControlEventReferenceSchema>;
export type FoundationControlEvent = z.output<typeof FoundationControlEventSchema>;
export type FoundationControlRevision = z.output<typeof FoundationControlRevisionSchema>;
export type FoundationDeliveryState = z.output<typeof FoundationDeliveryStateSchema>;
export type FoundationRepositoryAtlasObservation = z.output<typeof FoundationRepositoryAtlasObservationSchema>;
export type FoundationRepositoryObservation = z.output<typeof FoundationRepositoryObservationSchema>;
export type FoundationRuntimeObservation = z.output<typeof FoundationRuntimeObservationSchema>;
export type FoundationChangeFacts = z.output<typeof FoundationChangeFactsSchema>;
export type FoundationDiagnostic = z.output<typeof FoundationDiagnosticSchema>;
export type FoundationSemanticMarkdown = z.output<typeof FoundationSemanticMarkdownSchema>;
export type FoundationDeliveryActivityPresentation = z.output<typeof FoundationDeliveryActivityPresentationSchema>;
export type FoundationDeliveryGeneration = z.output<typeof FoundationDeliveryGenerationSchema>;
export type FoundationDeliveryView = z.output<typeof FoundationDeliveryViewSchema>;
export type FoundationDeliveryInboxRow = z.output<typeof FoundationDeliveryInboxRowSchema>;
export type FoundationDeliveryInbox = z.output<typeof FoundationDeliveryInboxSchema>;
export type FoundationDeliveryDiff = z.output<typeof FoundationDeliveryDiffSchema>;
export type FoundationControlFamilySummary = z.output<typeof FoundationControlFamilySummarySchema>;
