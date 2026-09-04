import {
  FoundationChangeFactsSchema,
  FoundationControlEventSchema,
  FoundationDiagnosticSchema,
  FoundationRuntimeObservationSchema,
  createFoundationRuntimeOperationResult,
  type FoundationControlEvent,
  type FoundationControlEventReference,
  type FoundationControlReference,
  type FoundationDiagnostic,
  type FoundationRuntimeOperationResult,
} from "@neutral/lifecycle-protocol";
import type { DeliveryControlPhysicalDisposition } from "../control/public-view.js";
import { publicDeliveryState } from "../control/public-view.js";
import type { ExecutionReceiptSubmissionDiagnostic } from "../control/execution-receipt.js";
import type { ControlRecordStore } from "../control/store.js";
import type { ControlRecordEvent, ControlRecordRevision } from "../control/types.js";
import { FoundationError } from "../error.js";
import type { FoundationRuntimeMutationRequest } from "../facade.js";
import {
  observeFoundationRepositoryForRead,
  observeFoundationRepositoryIdentityForRead,
} from "../runtime-read.js";

const MAXIMUM_RESULT_ITEMS = 256;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.mutation-result-v7.${code}`, message);
}

function eventReference(event: FoundationControlEvent): FoundationControlEventReference {
  return Object.freeze({ sequence: event.sequence, eventId: event.eventId, digest: event.digest });
}

function controlReference(revision: ControlRecordRevision): FoundationControlReference {
  return Object.freeze({
    kind: revision.recordKind as FoundationControlReference["kind"],
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function operationEvents(
  store: ControlRecordStore,
  afterSequence: number,
): readonly FoundationControlEvent[] {
  const events = store.listEvents(afterSequence, MAXIMUM_RESULT_ITEMS + 1);
  if (events.length > MAXIMUM_RESULT_ITEMS) {
    fail("result-bound", "One mutation produced more events than its public result can bind");
  }
  return Object.freeze(events.map(publicControlEvent));
}

function publicControlEvent(event: ControlRecordEvent): FoundationControlEvent {
  return FoundationControlEventSchema.parse(event);
}

function operationControl(
  store: ControlRecordStore,
  events: readonly FoundationControlEvent[],
): readonly FoundationControlReference[] {
  const seen = new Set<string>();
  const references: FoundationControlReference[] = [];
  for (const event of events) {
    if (event.subject === null) continue;
    const key = `${event.subject.recordId}\u0000${event.subject.revision}\u0000${event.subject.digest}`;
    if (seen.has(key)) continue;
    const revision = store.getRevision(event.subject.recordId, event.subject.revision);
    if (revision === null || revision.digest !== event.subject.digest) {
      fail("operation-control", "Operation event subject does not resolve its exact Control revision");
    }
    seen.add(key);
    references.push(controlReference(revision));
  }
  if (references.length > MAXIMUM_RESULT_ITEMS) {
    fail("result-bound", "One mutation produced more Control revisions than its public result can bind");
  }
  return Object.freeze(references);
}

function publicDiagnostic(error: unknown, recovery: boolean): FoundationDiagnostic {
  const code = error instanceof FoundationError
    ? error.code
    : "lifecycle.mutation-result-v7.unexpected";
  return FoundationDiagnosticSchema.parse({
    code,
    severity: "error",
    message: recovery
      ? "The Delivery operation stopped at one exact retained recovery coordinate"
      : "The Delivery operation could not establish its exact result",
    retryable: recovery || (error instanceof FoundationError && error.retryable),
    facts: {},
  });
}

function publicSubmissionDiagnostic(
  diagnostic: ExecutionReceiptSubmissionDiagnostic,
): FoundationDiagnostic {
  return FoundationDiagnosticSchema.parse({
    code: diagnostic.code,
    severity: "error",
    message: diagnostic.code.startsWith("lifecycle.agent-work-product.runtime.")
      ? "The runtime could not compile the valid governed Agent semantics"
      : "The governed Agent semantic submission did not satisfy its exact profile",
    retryable: false,
    facts: {
      stage: diagnostic.stage,
      factsDigest: diagnostic.factsDigest,
    },
  });
}

export type FoundationMutationBeforeV7 = Readonly<{
  repositoryCommit: string | null;
  candidate: FoundationControlReference | null;
  controlHead: FoundationControlEventReference | null;
}>;

function sameControlReference(
  left: FoundationControlReference | null,
  right: FoundationControlReference | null,
): boolean {
  return left?.kind === right?.kind && left?.id === right?.id &&
    left?.revision === right?.revision && left?.digest === right?.digest;
}

function currentControlHead(store: ControlRecordStore): FoundationControlEventReference | null {
  const eventCount = store.state().journal.eventCount;
  if (eventCount === 0) return null;
  const selected = store.listEvents(eventCount - 1, 2);
  if (selected.length !== 1 || selected[0]!.sequence !== eventCount) {
    fail("journal-head", "The Control Record Store does not expose one exact current Journal head");
  }
  return eventReference(publicControlEvent(selected[0]!));
}

export function foundationMutationBeforeV7(
  store: ControlRecordStore,
  repositoryCommit: string | null,
): FoundationMutationBeforeV7 {
  const delivery = publicDeliveryState(store, {
    disposition: "active",
    archiveManifestDigest: null,
  });
  return Object.freeze({
    repositoryCommit,
    candidate: delivery.subjects.candidate,
    controlHead: currentControlHead(store),
  });
}

/**
 * Project one already-retained mutation boundary into the public protocol.
 * This owner never decides operation eligibility or changes Control.
 */
export async function foundationMutationResultV7(input: Readonly<{
  request: FoundationRuntimeMutationRequest;
  store: ControlRecordStore;
  status: "completed" | "recovery-required" | "refused";
  error?: unknown;
  observedAt: string;
  afterSequence: number;
  before?: FoundationMutationBeforeV7;
  physical?: DeliveryControlPhysicalDisposition;
  submissionDiagnostic?: ExecutionReceiptSubmissionDiagnostic | null;
  repositoryObservation?: "complete-current" | "identity-current";
}>): Promise<FoundationRuntimeOperationResult> {
  const observationMode = input.repositoryObservation ?? "complete-current";
  const observed = observationMode === "complete-current"
    ? await observeFoundationRepositoryForRead(input.request.target, input.observedAt)
    : await observeFoundationRepositoryIdentityForRead(input.request.target, input.observedAt);
  if (
    observationMode === "complete-current"
      ? (!observed.repository.valid || observed.repository.targetId !== input.store.identity.targetId)
      : (
          observed.repository.targetId !== null &&
          observed.repository.targetId !== input.store.identity.targetId
        )
  ) {
    fail(
      "repository-observation",
      observationMode === "complete-current"
        ? "Post-operation observation is not the exact valid target"
        : "Post-operation repository identity differs from the retained Delivery target",
    );
  }
  const delivery = publicDeliveryState(input.store, input.physical ?? {
    disposition: "active",
    archiveManifestDigest: null,
  });
  const events = operationEvents(input.store, input.afterSequence);
  const head = currentControlHead(input.store);
  const before = input.before ?? Object.freeze({
    repositoryCommit: observed.repository.headCommit,
    candidate: null,
    controlHead: null,
  });
  const candidate = delivery.subjects.candidate;
  const observation = FoundationRuntimeObservationSchema.parse({
    schema: "lifecycle.foundation-runtime-observation.v10",
    observedAt: input.observedAt,
    repository: observed.repository,
    delivery,
  });
  const changes = FoundationChangeFactsSchema.parse({
    repository: {
      changed: before.repositoryCommit !== observed.repository.headCommit,
      beforeCommit: before.repositoryCommit,
      afterCommit: observed.repository.headCommit,
    },
    candidate: {
      changed: !sameControlReference(before.candidate, candidate),
      before: before.candidate,
      after: candidate,
    },
    control: {
      advanced: events.length > 0,
      beforeHead: before.controlHead,
      afterHead: head,
    },
  });
  return createFoundationRuntimeOperationResult({
    request: input.request,
    observedAt: input.observedAt,
    status: input.status,
    targetId: input.store.identity.targetId,
    deliveryId: input.store.identity.processId,
    observation,
    changes,
    events,
    control: operationControl(input.store, events),
    diagnostics: input.error === undefined
      ? [
          ...observed.diagnostics,
          ...(input.submissionDiagnostic === undefined || input.submissionDiagnostic === null
            ? []
            : [publicSubmissionDiagnostic(input.submissionDiagnostic)]),
        ]
      : [publicDiagnostic(input.error, input.status === "recovery-required")],
  });
}
