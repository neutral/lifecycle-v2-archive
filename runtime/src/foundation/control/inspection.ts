import {
  FoundationExportResultSchema,
  FoundationInspectionResultSchema,
  type FoundationExportResult,
  type FoundationDeliveryGeneration,
  type FoundationInspectionResult,
  type FoundationRuntimeExportRequest,
  type FoundationRuntimeInspectRequest,
  type FoundationRepositoryObservation,
} from "@neutral/lifecycle-protocol";
import { FoundationError } from "../error.js";
import { canonicalJson, canonicalPrettyJson, sha256Bytes } from "../validation/canonical.js";
import {
  compileFoundationAttemptView,
  type FoundationAttemptView,
  type FoundationAttemptViewSelection,
} from "./attempt-view.js";
import {
  deliveryControlRecordPolicies,
  type ControlRecordKindPolicy,
} from "./kind-registry.js";
import {
  compileControlFamilyIndex,
  compileDeliveryView,
} from "./delivery-view.js";
import { publicDeliveryState, type DeliveryControlPhysicalDisposition } from "./public-view.js";
import type { ControlRecordStore } from "./store.js";
import type { ControlRecordRevision } from "./types.js";

const MAXIMUM_EXPORT_BYTES = 64 * 1024 * 1024;
const MAXIMUM_INSPECTION_PAGE_BYTES = 2 * 1024 * 1024;

type ControlDossier =
  | "frame"
  | "attempt"
  | "candidate"
  | "boundary"
  | "evidence"
  | "decision"
  | "closure";

function policiesForDossier(
  dossier: ControlDossier,
): readonly ControlRecordKindPolicy[] {
  return deliveryControlRecordPolicies().filter((policy) => policy.dossier === dossier);
}

function exactRevision(
  store: ControlRecordStore,
  reference: Readonly<{ kind: string; id: string; revision: number; digest: string }>,
): ControlRecordRevision {
  const revision = store.getRevision(reference.id, reference.revision);
  if (
    revision === null ||
    revision.recordKind !== reference.kind ||
    revision.digest !== reference.digest
  ) {
    throw new FoundationError(
      "lifecycle.control-inspection.reference",
      "Inspection reference does not resolve to the exact retained Control revision",
    );
  }
  return revision;
}

function boundedRevisionPage<Cursor extends string | number>(input: Readonly<{
  after: Cursor | null;
  limit: number;
  next(after: Cursor | null): ControlRecordRevision | null;
  cursor(revision: ControlRecordRevision): Cursor;
  carrier(records: readonly ControlRecordRevision[], next: Cursor | null): unknown;
}>): Readonly<{ records: readonly ControlRecordRevision[]; next: Cursor | null }> {
  const records: ControlRecordRevision[] = [];
  let cursor = input.after;
  while (records.length < input.limit) {
    const revision = input.next(cursor);
    if (revision === null) {
      return Object.freeze({ records: Object.freeze(records), next: null });
    }
    const nextCursor = input.cursor(revision);
    const candidate = Object.freeze([...records, revision]);
    const byteLength = Buffer.byteLength(canonicalJson(input.carrier(candidate, nextCursor)), "utf8");
    if (byteLength > MAXIMUM_INSPECTION_PAGE_BYTES) {
      if (records.length === 0) {
        throw new FoundationError(
          "lifecycle.control-inspection.page-bound",
          "One exact Control revision exceeds the bounded inspection page",
          {
            observedFacts: {
              recordId: revision.recordId,
              revision: revision.revision,
              byteLength,
              maximumByteLength: MAXIMUM_INSPECTION_PAGE_BYTES,
            },
          },
        );
      }
      return Object.freeze({ records: Object.freeze(records), next: cursor });
    }
    records.push(revision);
    cursor = nextCursor;
  }
  const more = input.next(cursor) !== null;
  return Object.freeze({
    records: Object.freeze(records),
    next: more ? cursor : null,
  });
}

/**
 * Inspect one reducer-derived Attempt View without creating another Control
 * family or retaining a view cache. The protocol adapter presents this bounded
 * observation through its selected public inspection contract.
 */
export function inspectDeliveryAttemptView(
  store: ControlRecordStore,
  physical: DeliveryControlPhysicalDisposition,
  selection: FoundationAttemptViewSelection,
): FoundationAttemptView | null {
  return compileFoundationAttemptView({ store, physical, selection });
}

export function inspectDeliveryControl(
  store: ControlRecordStore,
  physical: DeliveryControlPhysicalDisposition,
  query: FoundationRuntimeInspectRequest["input"],
  context?: Readonly<{
    repository?: FoundationRepositoryObservation;
    investment?: Readonly<{ model: string; reasoning: string }> | null;
    observedAt?: string;
    generation: FoundationDeliveryGeneration;
  }>,
): FoundationInspectionResult {
  if (query.kind === "summary") {
    return FoundationInspectionResultSchema.parse({
      kind: "summary",
      state: publicDeliveryState(store, physical),
    });
  }
  if (query.kind === "events") {
    const page = store.listEvents(query.afterSequence, query.limit + 1);
    const events = page.slice(0, query.limit);
    return FoundationInspectionResultSchema.parse({
      kind: "events",
      events,
      nextAfterSequence: page.length > query.limit ? events.at(-1)!.sequence : null,
    });
  }
  if (query.kind === "dossier") {
    const policies = policiesForDossier(query.dossier);
    const recordKinds = policies.map(({ kind }) => kind);
    const page = boundedRevisionPage({
      after: query.afterRecordId,
      limit: query.limit,
      next: (after) => store.listCurrentRevisions({
        recordKinds,
        afterRecordId: after,
        limit: 1,
      })[0] ?? null,
      cursor: (revision) => revision.recordId,
      carrier: (records, nextAfterRecordId) => ({
        kind: "dossier",
        dossier: query.dossier,
        records,
        nextAfterRecordId,
      }),
    });
    return FoundationInspectionResultSchema.parse({
      kind: "dossier",
      dossier: query.dossier,
      records: page.records,
      nextAfterRecordId: page.next,
    });
  }
  if (query.kind === "attempt-view") {
    return FoundationInspectionResultSchema.parse({
      kind: "attempt-view",
      view: inspectDeliveryAttemptView(store, physical, query.selection),
    });
  }
  if (query.kind === "delivery-view") {
    if (context?.repository === undefined || context.investment === undefined || context.observedAt === undefined) {
      throw new FoundationError(
        "lifecycle.control-inspection.delivery-view-context",
        "Delivery View inspection requires its exact repository and Investment context",
      );
    }
    return FoundationInspectionResultSchema.parse({
      kind: "delivery-view",
      view: compileDeliveryView({
        store,
        physical,
        repository: context.repository,
        investment: context.investment,
        observedAt: context.observedAt,
      }),
    });
  }
  if (query.kind === "families") {
    if (context === undefined) {
      throw new FoundationError(
        "lifecycle.control-inspection.generation-context",
        "Control family inspection requires its exact Delivery generation",
      );
    }
    return FoundationInspectionResultSchema.parse({
      kind: "families",
      generation: context.generation,
      families: compileControlFamilyIndex(store),
    });
  }
  if (query.kind === "family") {
    if (context === undefined) {
      throw new FoundationError(
        "lifecycle.control-inspection.generation-context",
        "Control family inspection requires its exact Delivery generation",
      );
    }
    const page = boundedRevisionPage({
      after: query.afterRecordId,
      limit: query.limit,
      next: (after) => store.listCurrentRevisions({
        recordKinds: [query.recordKind],
        afterRecordId: after,
        limit: 1,
      })[0] ?? null,
      cursor: (revision) => revision.recordId,
      carrier: (records, nextAfterRecordId) => ({
        kind: "family",
        recordKind: query.recordKind,
        records,
        nextAfterRecordId,
      }),
    });
    return FoundationInspectionResultSchema.parse({
      kind: "family",
      generation: context.generation,
      recordKind: query.recordKind,
      records: page.records,
      nextAfterRecordId: page.next,
    });
  }
  if (query.kind === "revisions") {
    if (context === undefined) {
      throw new FoundationError(
        "lifecycle.control-inspection.generation-context",
        "Control revision inspection requires its exact Delivery generation",
      );
    }
    const page = boundedRevisionPage({
      after: query.afterRevision,
      limit: query.limit,
      next: (after) => store.listRevisions({
        recordId: query.recordId,
        afterRevision: after ?? 0,
        limit: 1,
      })[0] ?? null,
      cursor: (revision) => revision.revision,
      carrier: (records, nextAfterRevision) => ({
        kind: "revisions",
        recordId: query.recordId,
        records,
        nextAfterRevision,
      }),
    });
    return FoundationInspectionResultSchema.parse({
      kind: "revisions",
      generation: context.generation,
      recordId: query.recordId,
      records: page.records,
      nextAfterRevision: page.next,
    });
  }
  if (query.kind !== "record") {
    throw new FoundationError(
      "lifecycle.control-inspection.query",
      "Unsupported exact Control inspection query",
    );
  }
  return FoundationInspectionResultSchema.parse({
    kind: "record",
    record: exactRevision(store, query.reference),
  });
}

function exportHeader(
  store: ControlRecordStore,
  physical: DeliveryControlPhysicalDisposition,
  selection: FoundationRuntimeExportRequest["input"]["selection"],
): string {
  const state = publicDeliveryState(store, physical);
  return canonicalPrettyJson({
    schema: "lifecycle.control-export.v1",
    representation: "derived-inspection",
    store: store.identity,
    journal: state.journal,
    storeDisposition: state.storeDisposition,
    selection,
  });
}

function revisionSection(revision: ControlRecordRevision): string {
  const operational = canonicalPrettyJson({
    recordId: revision.recordId,
    recordKind: revision.recordKind,
    revision: revision.revision,
    digest: revision.digest,
    producer: revision.producer,
    semanticAuthor: revision.semanticAuthor,
    semanticAuthority: revision.semanticAuthority,
    createdAt: revision.createdAt,
    payload: revision.payload,
    relationships: revision.relationships,
  }).trimEnd();
  return [
    `## ${revision.recordKind} · ${revision.recordId} · revision ${revision.revision}`,
    "",
    "```json",
    operational,
    "```",
    "",
    revision.semanticMarkdown.trimEnd(),
    "",
  ].join("\n");
}

function allCurrentRevisions(
  store: ControlRecordStore,
  policies: readonly ControlRecordKindPolicy[],
): readonly ControlRecordRevision[] {
  const records: ControlRecordRevision[] = [];
  let afterRecordId: string | null = null;
  do {
    const page = store.listCurrentRevisions({
      recordKinds: policies.map(({ kind }) => kind),
      afterRecordId,
      limit: 1_000,
    });
    records.push(...page);
    afterRecordId = page.length === 1_000 ? page.at(-1)!.recordId : null;
  } while (afterRecordId !== null);
  return Object.freeze(records);
}

export function exportDeliveryControl(
  store: ControlRecordStore,
  physical: DeliveryControlPhysicalDisposition,
  input: FoundationRuntimeExportRequest["input"],
): FoundationExportResult {
  const selection = input.selection;
  const policies = selection.kind === "delivery"
    ? deliveryControlRecordPolicies()
    : selection.kind === "dossier"
      ? policiesForDossier(selection.dossier)
      : [];
  const records = selection.kind === "record"
    ? Object.freeze([exactRevision(store, selection.reference)])
    : allCurrentRevisions(store, policies);
  const content = [
    "---",
    exportHeader(store, physical, selection).trimEnd(),
    "---",
    "# Lifecycle Control export",
    "",
    "> Derived inspection representation. This Markdown is not a Control Record Store, import, backup, or recovery carrier.",
    "",
    ...records.map(revisionSection),
  ].join("\n").replace(/\n+$/u, "\n");
  const bytes = Buffer.from(content, "utf8");
  if (bytes.byteLength > MAXIMUM_EXPORT_BYTES) {
    throw new FoundationError(
      "lifecycle.control-export.bound",
      "Derived Markdown export exceeds the installed output bound",
      { observedFacts: { byteLength: bytes.byteLength, maximumByteLength: MAXIMUM_EXPORT_BYTES } },
    );
  }
  return FoundationExportResultSchema.parse({
    format: "markdown",
    mediaType: "text/markdown",
    byteLength: bytes.byteLength,
    digest: sha256Bytes(bytes),
    content,
  });
}
