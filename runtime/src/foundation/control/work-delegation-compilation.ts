import { FoundationSemanticMarkdownSchema } from "@neutral/lifecycle-protocol";
import { FoundationError } from "../error.js";
import { digestCanonical } from "../validation/canonical.js";
import { compileStandingDirectorBrief, type CompiledDirectorBrief } from "./director-brief.js";
import { assertDeliveryControlRecordPolicy } from "./kind-registry.js";
import { compileControlRecordRevision, controlIdentifier, controlTimestamp } from "./model.js";
import type { ControlRecordStore } from "./store.js";
import type { ControlRecordRelationship, ControlRecordRevision, ControlRecordStoreAppend } from "./types.js";
import {
  WORK_DELEGATION_POLICY_DIGEST,
  WORK_DELEGATION_POLICY_ID,
  WORK_DELEGATION_SCHEMA,
  parseWorkDelegationAccounting,
  parseWorkDelegationPayload,
  type WorkDelegationPayload,
  type WorkDelegationReference,
} from "./work-delegation.js";

/** Read custody only. The caller retains the batch under the Delivery writer. */
export type WorkDelegationCompilationStore = Pick<ControlRecordStore, "identity" | "state" | "getRevision">
  & Partial<Pick<ControlRecordStore, "getWorkDelegationStopRequest">>;

export type WorkDelegationCompilationInput = Readonly<{
  store: WorkDelegationCompilationStore;
  directorId: string;
  runtimeId: string;
  submittedAt: string;
  semanticMarkdown: string;
  allowedOperations: WorkDelegationPayload["allowedOperations"];
  directions: Readonly<{ continue: string | null; evaluate: string | null }>;
  agentSelections: WorkDelegationPayload["agentSelections"];
  ceilings: WorkDelegationPayload["ceilings"];
  expiresAt: string | null;
}>;

type CompilationRefusal = "currentness" | "pending-stop" | "retained-subject" | "admission"
  | "director" | "revision" | "expired" | "lifetime-ceiling" | "semantic-markdown";

function fail(reason: CompilationRefusal): never {
  throw new FoundationError("lifecycle.work-delegation.invalid",
    "Work delegation requires settled admitted work, its exact Director and a finite lifetime allowance", {
      observedFacts: Object.freeze({ reason }),
    });
}

function reference<Kind extends string>(revision: ControlRecordRevision, kind: Kind): WorkDelegationReference<Kind> {
  return Object.freeze({ kind, id: revision.recordId, revision: revision.revision, digest: revision.digest });
}

function exactRevision(
  store: WorkDelegationCompilationStore,
  selected: Omit<WorkDelegationReference<string>, "kind">,
  kind: string,
): ControlRecordRevision {
  const revision = store.getRevision(selected.id, selected.revision);
  if (revision === null || revision.processId !== store.identity.processId || revision.recordKind !== kind ||
      revision.recordId !== selected.id || revision.revision !== selected.revision || revision.digest !== selected.digest) {
    fail("retained-subject");
  }
  return revision;
}

/**
 * Compile one explicit resource choice, without authenticating Product authority,
 * changing a Store or reserving execution. Currentness and the pending stop are
 * checked again by the append owner; this result is not permission to execute.
 */
export function compileWorkDelegation(input: WorkDelegationCompilationInput) {
  const directorId = controlIdentifier(input.directorId, "Delegating Director identity");
  const runtimeId = controlIdentifier(input.runtimeId, "Delegation Runtime identity");
  const submittedAt = controlTimestamp(input.submittedAt, "Delegation submission time");
  const state = input.store.state();
  if (state.standing === "closed" || state.subjects.closure !== null || state.subjects.activeBoundary === null ||
      state.delegation.admission === null || state.subjects.materialCondition !== null ||
      state.activities.some(activity => activity.stage !== "completed" || activity.recovery !== null) ||
      state.journal.eventCount < 1 || state.journal.headDigest === null) {
    fail("currentness");
  }
  if (input.store.getWorkDelegationStopRequest?.() != null) fail("pending-stop");
  const boundary = reference(exactRevision(input.store, state.subjects.activeBoundary, "work-boundary"), "work-boundary");
  const admissionRevision = exactRevision(input.store, state.delegation.admission, "director-decision");
  const admission = reference(admissionRevision, "director-decision");
  // Applied-admission provenance comes from the reducer, not a latest Decision
  // search. Bind that retained Decision to the same current Boundary as well.
  const boundarySelections = admissionRevision.relationships.filter(link => link.relation === "selects-boundary");
  if (admissionRevision.semanticAuthor.kind !== "director" || admissionRevision.semanticAuthority !== "director-authenticated" ||
      (admissionRevision.payload.decision !== "admit" && admissionRevision.payload.decision !== "readmit") ||
      boundarySelections.length !== 1 || digestCanonical(boundarySelections[0]!.target) !== digestCanonical(boundary)) {
    fail("admission");
  }
  if (admissionRevision.semanticAuthor.id !== directorId) fail("director");

  const previous = state.delegation.current === null ? null
    : exactRevision(input.store, state.delegation.current.reference, "work-delegation");
  if (previous !== null) parseWorkDelegationPayload(previous.payload);
  const replaces = previous === null ? null : reference(previous, "work-delegation");
  const recordId = previous?.recordId ?? `work-delegation-${digestCanonical({
    recordKind: "work-delegation", storeId: input.store.identity.storeId, processId: input.store.identity.processId,
  }).slice("sha256:".length)}`;
  const revision = (previous?.revision ?? 0) + 1;
  if (!Number.isSafeInteger(revision)) fail("revision");
  const semantic = FoundationSemanticMarkdownSchema.safeParse(input.semanticMarkdown);
  if (!semantic.success) fail("semantic-markdown");

  const standing = (operation: "delivery.continue" | "delivery.evaluate", direction: string | null): CompiledDirectorBrief | null =>
    direction === null ? null : compileStandingDirectorBrief({
      store: input.store, delegationId: recordId, delegationRevision: revision, operation,
      semanticMarkdown: direction, submittedAt, directorId, runtimeId,
    });
  const standingBriefs = Object.freeze({
    continue: standing("delivery.continue", input.directions.continue),
    evaluate: standing("delivery.evaluate", input.directions.evaluate),
  });
  const payload = parseWorkDelegationPayload({
    schema: WORK_DELEGATION_SCHEMA, boundary, admission, replaces,
    policy: { id: WORK_DELEGATION_POLICY_ID, digest: WORK_DELEGATION_POLICY_DIGEST },
    allowedOperations: input.allowedOperations,
    directions: {
      continue: standingBriefs.continue === null ? null : reference(standingBriefs.continue.compiled, "director-brief"),
      evaluate: standingBriefs.evaluate === null ? null : reference(standingBriefs.evaluate.compiled, "director-brief"),
    },
    agentSelections: input.agentSelections, ceilings: input.ceilings, expiresAt: input.expiresAt,
    stopPolicy: "finish-reserved-operation",
  });
  if (payload.expiresAt !== null && Date.parse(payload.expiresAt) <= Date.parse(submittedAt)) fail("expired");
  const charged = parseWorkDelegationAccounting(state.delegation.charged);
  for (const field of ["operations", "agentAttempts", "reservedCellWallTimeMs"] as const) {
    if (payload.ceilings[field] < charged[field]) fail("lifetime-ceiling");
  }
  const relationships: ControlRecordRelationship[] = [
    { relation: "uses-boundary", target: boundary },
    { relation: "uses-admission", target: admission },
  ];
  for (const direction of [payload.directions.continue, payload.directions.evaluate]) {
    if (direction !== null) relationships.push({ relation: "uses-brief", target: direction });
  }
  if (replaces !== null) relationships.push({ relation: "revises", target: replaces });
  const revisionInput = Object.freeze({
    recordId, recordKind: "work-delegation", revision,
    producer: Object.freeze({ kind: "runtime" as const, id: runtimeId }),
    semanticAuthor: Object.freeze({ kind: "director" as const, id: directorId }),
    semanticAuthority: "director-supplied" as const, createdAt: submittedAt,
    semanticMarkdown: semantic.data, payload, relationships: Object.freeze(relationships),
  });
  const compiled = compileControlRecordRevision(input.store.identity.processId, revisionInput);
  assertDeliveryControlRecordPolicy(compiled);
  const append: ControlRecordStoreAppend = Object.freeze({
    revision: revisionInput,
    event: Object.freeze({
      eventId: `event-work-delegation-set-${digestCanonical({
        storeId: input.store.identity.storeId, processId: input.store.identity.processId, recordId, revision,
      }).slice("sha256:".length)}`,
      eventKind: "work-delegation-set", occurredAt: submittedAt,
      actor: Object.freeze({ kind: "runtime" as const, id: runtimeId }),
      subject: Object.freeze({ recordId, revision, digest: compiled.digest }), payload: Object.freeze({}),
    }),
  });
  return Object.freeze({
    revision: compiled, payload, standingBriefs,
    expectedHead: Object.freeze({ sequence: state.journal.eventCount, digest: state.journal.headDigest }),
    charged,
    appends: Object.freeze([
      ...(standingBriefs.continue === null ? [] : [standingBriefs.continue.append]),
      ...(standingBriefs.evaluate === null ? [] : [standingBriefs.evaluate.append]), append,
    ]),
  });
}

export type CompiledWorkDelegation = ReturnType<typeof compileWorkDelegation>;
