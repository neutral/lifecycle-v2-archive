import { FoundationSemanticMarkdownSchema } from "@neutral/lifecycle-protocol";
import { FoundationError } from "../error.js";
import {
  digestCanonical,
  sha256Bytes,
  type Sha256,
} from "../validation/canonical.js";
import { compileDeliveryActivityStartAppend } from "./activity.js";
import { assertDeliveryControlRecordPolicy } from "./kind-registry.js";
import {
  compileControlRecordRevision,
  controlIdentifier,
  normalizeSemanticMarkdown,
} from "./model.js";
import type { ControlRecordStore } from "./store.js";
import type {
  ControlJsonObject,
  ControlRecordEvent,
  ControlRecordStoreAppend,
  ControlRecordRevision,
} from "./types.js";

export const FOUNDER_BRIEF_OPERATIONS = Object.freeze([
  "delivery.prepare",
  "delivery.continue",
  "delivery.evaluate",
  "delivery.revise",
  "delivery.reaffirm",
] as const);

export type FounderBriefOperation = typeof FOUNDER_BRIEF_OPERATIONS[number];

export const FOUNDER_BRIEF_TEMPLATE_PROFILE_BY_OPERATION = Object.freeze({
  "delivery.prepare": "founder-brief.prepare-v1",
  "delivery.continue": "founder-brief.direction-v1",
  "delivery.evaluate": "founder-brief.direction-v1",
  "delivery.revise": "founder-brief.resolution-v1",
  "delivery.reaffirm": "founder-brief.resolution-v1",
} satisfies Readonly<Record<FounderBriefOperation, string>>);

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.control-founder-brief.${code}`, message);
}

function founderBriefOperation(value: string): FounderBriefOperation {
  if (!FOUNDER_BRIEF_OPERATIONS.includes(value as FounderBriefOperation)) {
    fail("operation", "Founder Brief compilation requires one exact agent Delivery operation");
  }
  return value as FounderBriefOperation;
}

function publicSemanticMarkdown(value: string): Readonly<{
  rawDigest: Sha256;
  rawByteLength: number;
  normalizedMarkdown: string;
  normalizedDigest: Sha256;
  normalizedByteLength: number;
}> {
  const parsed = FoundationSemanticMarkdownSchema.safeParse(value);
  if (!parsed.success) {
    fail("semantic-markdown", "Founder Brief input must be exact body-only public semantic Markdown");
  }
  const rawBytes = Buffer.from(parsed.data, "utf8");
  const normalizedMarkdown = normalizeSemanticMarkdown(parsed.data);
  return Object.freeze({
    rawDigest: sha256Bytes(rawBytes),
    rawByteLength: rawBytes.byteLength,
    normalizedMarkdown,
    normalizedDigest: sha256Bytes(normalizedMarkdown),
    normalizedByteLength: Buffer.byteLength(normalizedMarkdown, "utf8"),
  });
}

function runtimeOwnedIdentities(
  store: ControlRecordStore,
  activityId: string,
): Readonly<{ recordId: string; eventId: string }> {
  const suffix = digestCanonical({
    recordKind: "founder-brief",
    storeId: store.identity.storeId,
    processId: store.identity.processId,
    activityId,
  }).slice("sha256:".length);
  return Object.freeze({
    recordId: `founder-brief-${suffix}`,
    eventId: `event-founder-brief-submitted-${suffix}`,
  });
}

export type FounderBriefInput = Readonly<{
  store: ControlRecordStore;
  activityId: string;
  operation: FounderBriefOperation;
  semanticMarkdown: string;
  submittedAt: string;
  founderId: string;
  runtimeId: string;
}>;

type CompiledFounderBrief = Readonly<{
  append: ControlRecordStoreAppend;
  compiled: ControlRecordRevision;
  semantic: ReturnType<typeof publicSemanticMarkdown>;
}>;

function compileFounderBrief(input: FounderBriefInput): CompiledFounderBrief {
  const activityId = controlIdentifier(input.activityId, "Founder Brief activity identity");
  const operation = founderBriefOperation(input.operation);
  const semantic = publicSemanticMarkdown(input.semanticMarkdown);
  const identities = runtimeOwnedIdentities(input.store, activityId);
  const payload: ControlJsonObject = Object.freeze({
    schema: "lifecycle.founder-brief-payload.v1",
    inputProfile: operation,
    templateProfileId: FOUNDER_BRIEF_TEMPLATE_PROFILE_BY_OPERATION[operation],
    semanticMarkdownDigest: semantic.normalizedDigest,
    submission: Object.freeze({
      rawDigest: semantic.rawDigest,
      rawByteLength: semantic.rawByteLength,
      normalizedByteLength: semantic.normalizedByteLength,
    }),
  });
  const revisionInput = Object.freeze({
    recordId: identities.recordId,
    recordKind: "founder-brief",
    revision: 1,
    producer: Object.freeze({ kind: "runtime" as const, id: input.runtimeId }),
    semanticAuthor: Object.freeze({ kind: "founder" as const, id: input.founderId }),
    semanticAuthority: "founder-supplied" as const,
    createdAt: input.submittedAt,
    semanticMarkdown: semantic.normalizedMarkdown,
    payload,
    relationships: Object.freeze([]),
  });
  const compiled = compileControlRecordRevision(input.store.identity.processId, revisionInput);
  assertDeliveryControlRecordPolicy(compiled);
  return Object.freeze({
    compiled,
    semantic,
    append: Object.freeze({
      revision: revisionInput,
      event: Object.freeze({
        eventId: identities.eventId,
        eventKind: "founder-brief-submitted",
        occurredAt: input.submittedAt,
        actor: Object.freeze({ kind: "runtime" as const, id: input.runtimeId }),
        subject: Object.freeze({
          recordId: compiled.recordId,
          revision: compiled.revision,
          digest: compiled.digest,
        }),
        payload: Object.freeze({ activityId }),
      }),
    }),
  });
}

export type CompiledAgentActivityOpening = Readonly<{
  appends: readonly [ControlRecordStoreAppend, ControlRecordStoreAppend];
  revision: ControlRecordRevision;
  rawDigest: Sha256;
  rawByteLength: number;
  normalizedDigest: Sha256;
  normalizedByteLength: number;
}>;

/**
 * Compile, but do not retain, one immutable Founder Brief and its exact Agent
 * activity opening. Operation owners use this form when the two Journal facts
 * and their first recovery checkpoint must share one SQLite transaction.
 */
export function compileAgentActivityOpening(
  input: FounderBriefInput & Readonly<{ startedAt: string }>,
): CompiledAgentActivityOpening {
  const brief = compileFounderBrief(input);
  const start = compileDeliveryActivityStartAppend({
    store: input.store,
    activityId: input.activityId,
    operation: input.operation,
    startedAt: input.startedAt,
    runtimeId: input.runtimeId,
  });
  const appends: readonly [ControlRecordStoreAppend, ControlRecordStoreAppend] =
    Object.freeze([brief.append, start]);
  return Object.freeze({
    appends,
    revision: brief.compiled,
    rawDigest: brief.semantic.rawDigest,
    rawByteLength: brief.semantic.rawByteLength,
    normalizedDigest: brief.semantic.normalizedDigest,
    normalizedByteLength: brief.semantic.normalizedByteLength,
  });
}

/**
 * Compile and retain one immutable Founder Brief and its Agent activity opening
 * as one SQLite transaction. The Store can therefore expose both milestones
 * or neither after interruption; an orphaned planned Brief is impossible.
 */
export function openAgentActivity(input: FounderBriefInput & Readonly<{
  startedAt: string;
}>): Readonly<{
  revision: ControlRecordRevision;
  briefEvent: ControlRecordEvent;
  activityEvent: ControlRecordEvent;
  rawDigest: Sha256;
  rawByteLength: number;
  normalizedDigest: Sha256;
  normalizedByteLength: number;
}> {
  const opening = compileAgentActivityOpening(input);
  const [retainedBrief, retainedActivity] = input.store.appendBatch(opening.appends);
  if (
    retainedBrief === undefined || retainedBrief.revision === null ||
    retainedActivity === undefined || retainedActivity.revision !== null
  ) {
    fail("retention", "Founder Brief and Agent activity opening did not retain atomically");
  }
  return Object.freeze({
    revision: retainedBrief.revision,
    briefEvent: retainedBrief.event,
    activityEvent: retainedActivity.event,
    rawDigest: opening.rawDigest,
    rawByteLength: opening.rawByteLength,
    normalizedDigest: opening.normalizedDigest,
    normalizedByteLength: opening.normalizedByteLength,
  });
}
