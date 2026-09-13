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
import { parseWorkDelegationPayload, parseWorkDelegationReservation, type WorkDelegationReservation } from "./work-delegation.js";
import type {
  ControlJsonObject,
  ControlRecordEvent,
  ControlRecordStoreAppend,
  ControlRecordRevision,
} from "./types.js";

export const DIRECTOR_BRIEF_OPERATIONS = Object.freeze([
  "delivery.prepare",
  "delivery.continue",
  "delivery.evaluate",
  "delivery.revise",
  "delivery.reaffirm",
] as const);

export type DirectorBriefOperation = typeof DIRECTOR_BRIEF_OPERATIONS[number];

export const DIRECTOR_BRIEF_TEMPLATE_PROFILE_BY_OPERATION = Object.freeze({
  "delivery.prepare": "director-brief.prepare-v1",
  "delivery.continue": "director-brief.direction-v1",
  "delivery.evaluate": "director-brief.direction-v1",
  "delivery.revise": "director-brief.resolution-v1",
  "delivery.reaffirm": "director-brief.resolution-v1",
} satisfies Readonly<Record<DirectorBriefOperation, string>>);

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.control-director-brief.${code}`, message);
}

function directorBriefOperation(value: string): DirectorBriefOperation {
  if (!DIRECTOR_BRIEF_OPERATIONS.includes(value as DirectorBriefOperation)) {
    fail("operation", "Director Brief compilation requires one exact agent Delivery operation");
  }
  return value as DirectorBriefOperation;
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
    fail("semantic-markdown", "Director Brief input must be exact body-only public semantic Markdown");
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
  store: Pick<ControlRecordStore, "identity">,
  scope: DirectorBriefScope,
): Readonly<{ recordId: string; eventId: string }> {
  const suffix = digestCanonical({
    recordKind: "director-brief",
    storeId: store.identity.storeId,
    processId: store.identity.processId,
    scope,
  }).slice("sha256:".length);
  return Object.freeze({
    recordId: `director-brief-${suffix}`,
    eventId: `event-director-brief-submitted-${suffix}`,
  });
}

export type DirectorBriefInput = Readonly<{
  store: ControlRecordStore;
  activityId: string;
  operation: DirectorBriefOperation;
  semanticMarkdown: string;
  submittedAt: string;
  directorId: string;
  runtimeId: string;
}>;

export type DirectorBriefScope =
  | Readonly<{ kind: "activity"; activityId: string }>
  | Readonly<{
      kind: "delegation";
      delegationId: string;
      delegationRevision: number;
      operation: "delivery.continue" | "delivery.evaluate";
    }>;

export type CompiledDirectorBrief = Readonly<{
  append: ControlRecordStoreAppend;
  compiled: ControlRecordRevision;
  semantic: ReturnType<typeof publicSemanticMarkdown>;
}>;

function compileDirectorBrief(input: DirectorBriefInput): CompiledDirectorBrief {
  const activityId = controlIdentifier(input.activityId, "Director Brief activity identity");
  return compileDirectorBriefForScope({ ...input, scope: Object.freeze({ kind: "activity", activityId }) });
}

function compileDirectorBriefForScope(input: Omit<DirectorBriefInput, "activityId" | "store"> & Readonly<{
  store: Pick<ControlRecordStore, "identity">;
  scope: DirectorBriefScope;
}>): CompiledDirectorBrief {
  const operation = directorBriefOperation(input.operation);
  const semantic = publicSemanticMarkdown(input.semanticMarkdown);
  const identities = runtimeOwnedIdentities(input.store, input.scope);
  const payload: ControlJsonObject = Object.freeze({
    schema: "lifecycle.director-brief-payload.v2",
    scope: input.scope,
    inputProfile: operation,
    templateProfileId: DIRECTOR_BRIEF_TEMPLATE_PROFILE_BY_OPERATION[operation],
    semanticMarkdownDigest: semantic.normalizedDigest,
    submission: Object.freeze({
      rawDigest: semantic.rawDigest,
      rawByteLength: semantic.rawByteLength,
      normalizedByteLength: semantic.normalizedByteLength,
    }),
  });
  const revisionInput = Object.freeze({
    recordId: identities.recordId,
    recordKind: "director-brief",
    revision: 1,
    producer: Object.freeze({ kind: "runtime" as const, id: input.runtimeId }),
    semanticAuthor: Object.freeze({ kind: "director" as const, id: input.directorId }),
    semanticAuthority: "director-supplied" as const,
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
        eventKind: "director-brief-submitted",
        occurredAt: input.submittedAt,
        actor: Object.freeze({ kind: "runtime" as const, id: input.runtimeId }),
        subject: Object.freeze({
          recordId: compiled.recordId,
          revision: compiled.revision,
          digest: compiled.digest,
        }),
        payload: input.scope.kind === "activity"
          ? Object.freeze({ activityId: input.scope.activityId })
          : Object.freeze({
              delegationId: input.scope.delegationId,
              delegationRevision: input.scope.delegationRevision,
              operation: input.scope.operation,
            }),
      }),
    }),
  });
}

/**
 * Retain supplied standing direction once. The resource owner supplies the
 * upcoming delegation identity and commits this Brief with that delegation.
 * A subsequent Attempt uses this exact revision; Runtime context is not
 * attributed to a new Director submission.
 */
export function compileStandingDirectorBrief(input: Omit<DirectorBriefInput, "activityId" | "operation" | "store"> & Readonly<{
  store: Pick<ControlRecordStore, "identity">;
  delegationId: string;
  delegationRevision: number;
  operation: "delivery.continue" | "delivery.evaluate";
}>): CompiledDirectorBrief {
  const delegationId = controlIdentifier(input.delegationId, "Director Brief delegation identity");
  if (!Number.isSafeInteger(input.delegationRevision) || input.delegationRevision < 1) {
    fail("scope", "Standing Director direction requires an exact positive delegation revision");
  }
  if (input.operation !== "delivery.continue" && input.operation !== "delivery.evaluate") {
    fail("scope", "Standing Director direction applies only to delegated builder or reviewer work");
  }
  return compileDirectorBriefForScope({ ...input, scope: Object.freeze({
    kind: "delegation", delegationId, delegationRevision: input.delegationRevision,
    operation: input.operation,
  }) });
}

export type CompiledAgentActivityOpening = Readonly<{
  appends: readonly ControlRecordStoreAppend[];
  revision: ControlRecordRevision;
  rawDigest: Sha256;
  rawByteLength: number;
  normalizedDigest: Sha256;
  normalizedByteLength: number;
}>;

/** Reuse the exact original standing direction without creating a Director submission. */
export function compileDelegatedAgentActivityOpening(input: Readonly<{
  store: Pick<ControlRecordStore, "identity" | "state" | "getRevision">;
  activityId: string;
  operation: "delivery.continue" | "delivery.evaluate";
  reservation: WorkDelegationReservation;
  startedAt: string;
  runtimeId: string;
}>): CompiledAgentActivityOpening {
  const reservation = parseWorkDelegationReservation(input.reservation);
  const selected = reservation.delegation;
  const current = input.store.state().delegation.current;
  const retained = input.store.getRevision(selected.id, selected.revision);
  if (current === null || current.stopped || current.reference.id !== selected.id ||
      current.reference.revision !== selected.revision || current.reference.digest !== selected.digest ||
      retained === null || retained.recordKind !== "work-delegation" || retained.digest !== selected.digest ||
      retained.processId !== input.store.identity.processId) {
    fail("delegation", "Standing direction requires the current exact Work Delegation");
  }
  const delegation = parseWorkDelegationPayload(retained.payload);
  const selectedBrief = input.operation === "delivery.continue" ? delegation.directions.continue : delegation.directions.evaluate;
  const brief = selectedBrief === null ? null : input.store.getRevision(selectedBrief.id, selectedBrief.revision);
  if (brief === null || selectedBrief === null || brief.recordKind !== "director-brief" ||
      brief.processId !== input.store.identity.processId || brief.digest !== selectedBrief.digest ||
      brief.semanticAuthor.kind !== "director" || brief.semanticAuthor.id !== retained.semanticAuthor.id ||
      digestCanonical(brief.payload.scope) !== digestCanonical({ kind: "delegation", delegationId: selected.id,
        delegationRevision: selected.revision, operation: input.operation }) || brief.payload.inputProfile !== input.operation) {
    fail("standing-direction", "A reserved Activity requires its exact original Director Brief");
  }
  const semantic = publicSemanticMarkdown(brief.semanticMarkdown);
  const submission = brief.payload.submission;
  if (submission === null || typeof submission !== "object" || Array.isArray(submission) ||
      !("rawDigest" in submission) || typeof submission.rawDigest !== "string" || submission.rawDigest.length !== 71 ||
      !/^sha256:[a-f0-9]{64}$/u.test(submission.rawDigest) || typeof submission.rawByteLength !== "number" ||
      !Number.isSafeInteger(submission.rawByteLength) || submission.rawByteLength < 1 ||
      submission.normalizedByteLength !== semantic.normalizedByteLength ||
      brief.payload.semanticMarkdownDigest !== semantic.normalizedDigest) {
    fail("standing-direction", "Standing direction must preserve its original submission facts");
  }
  const start = compileDeliveryActivityStartAppend({ ...input, reservation });
  return Object.freeze({
    appends: Object.freeze([start]), revision: brief,
    rawDigest: submission.rawDigest as Sha256, rawByteLength: submission.rawByteLength,
    normalizedDigest: semantic.normalizedDigest, normalizedByteLength: semantic.normalizedByteLength,
  });
}

/**
 * Compile, but do not retain, one immutable Director Brief and its exact Agent
 * activity opening. Operation owners use this form when the two Journal facts
 * and their first recovery checkpoint must share one SQLite transaction.
 */
export function compileAgentActivityOpening(
  input: DirectorBriefInput & Readonly<{ startedAt: string }>,
): CompiledAgentActivityOpening {
  const brief = compileDirectorBrief(input);
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
 * Compile and retain one immutable Director Brief and its Agent activity opening
 * as one SQLite transaction. The Store can therefore expose both milestones
 * or neither after interruption; an orphaned planned Brief is impossible.
 */
export function openAgentActivity(input: DirectorBriefInput & Readonly<{
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
    fail("retention", "Director Brief and Agent activity opening did not retain atomically");
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
