import {
  digestFoundationInspectionCursor,
  FoundationKnowledgeIndexResultSchema,
  FoundationKnowledgeRecordResultSchema,
  type FoundationContextBasis,
  type FoundationContextInspectionSelector,
  type FoundationKnowledgeIndexResult,
  type FoundationKnowledgeRecordResult,
  type FoundationKnowledgeReference,
  type FoundationSourceReference,
} from "@neutral/lifecycle-protocol";
import { FoundationError } from "../error.js";
import {
  FOUNDATION_KNOWLEDGE_KINDS,
  type FoundationKnowledgeRecord,
  type FoundationKnowledgeSourceResolution,
} from "../knowledge/types.js";
import type { ControlJsonObject, ControlJsonValue } from "../control/types.js";
import { canonicalJson } from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import type { FoundationDeliveryQueryBasis } from "./delivery-query-basis.js";
import {
  compileFoundationSourceReference,
  sameFoundationSourceReference,
} from "./source-inspection.js";

type KnowledgeIndexSelector = Extract<
  FoundationContextInspectionSelector,
  { kind: "knowledge-index" }
>;
type KnowledgeRecordSelector = Extract<
  FoundationContextInspectionSelector,
  { kind: "knowledge-record" }
>;

const KIND_ORDER = new Map(FOUNDATION_KNOWLEDGE_KINDS.map((kind, index) => [kind, index]));

function fail(code: string, message: string, observedFacts: unknown = {}): never {
  throw new FoundationError(`lifecycle.context-inspection.knowledge-${code}`, message, {
    observedFacts,
  });
}

function reference(record: FoundationKnowledgeRecord): FoundationKnowledgeReference {
  return Object.freeze({
    id: record.frontMatter.id,
    kind: record.frontMatter.kind,
    status: record.frontMatter.status,
    revision: record.frontMatter.revision,
    path: record.path,
    sourceDigest: record.sourceDigest,
    semanticDigest: record.semanticDigest,
  });
}

function recordKey(record: FoundationKnowledgeRecord): string {
  return `${record.frontMatter.id}@${record.frontMatter.revision}`;
}

function compareRecords(left: FoundationKnowledgeRecord, right: FoundationKnowledgeRecord): number {
  return (KIND_ORDER.get(left.frontMatter.kind) ?? Number.MAX_SAFE_INTEGER) -
    (KIND_ORDER.get(right.frontMatter.kind) ?? Number.MAX_SAFE_INTEGER) ||
    compareCodePoints(left.frontMatter.id, right.frontMatter.id) ||
    left.frontMatter.revision - right.frontMatter.revision ||
    compareCodePoints(left.path, right.path);
}

function object(value: ControlJsonValue | undefined): ControlJsonObject | null {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)
    ? value as ControlJsonObject
    : null;
}

function selectedKnowledge(query: FoundationDeliveryQueryBasis): ReadonlySet<string> {
  const source = query.boundary.payload.knowledge;
  if (!Array.isArray(source)) {
    fail("boundary-invalid", "Selected Work Boundary Knowledge is not one exact array");
  }
  const selected = new Set<string>();
  for (const [index, value] of source.entries()) {
    const item = object(value);
    if (
      item === null ||
      typeof item.id !== "string" ||
      typeof item.revision !== "number" ||
      !Number.isSafeInteger(item.revision) ||
      typeof item.sourceDigest !== "string" ||
      typeof item.semanticDigest !== "string"
    ) {
      fail("boundary-invalid", "Selected Work Boundary Knowledge contains an invalid exact reference", {
        index,
      });
    }
    const exact = query.knowledge.index.byIdentityRevision.get(`${item.id}@${item.revision}`);
    if (
      exact === undefined ||
      exact.sourceDigest !== item.sourceDigest ||
      exact.semanticDigest !== item.semanticDigest
    ) {
      fail("boundary-substituted", "Selected Work Boundary Knowledge does not reproduce the historical Knowledge Set", {
        index,
        id: item.id,
        revision: item.revision,
      });
    }
    selected.add(recordKey(exact));
  }
  return selected;
}

function cursor(basis: FoundationContextBasis, record: FoundationKnowledgeRecord): string {
  return digestFoundationInspectionCursor({
    basisDigest: basis.digest,
    collection: "knowledge-records",
    key: Object.freeze({
      kind: record.frontMatter.kind,
      id: record.frontMatter.id,
      revision: record.frontMatter.revision,
    }),
  });
}

function pageStart(
  records: readonly FoundationKnowledgeRecord[],
  basis: FoundationContextBasis,
  afterCursor: string | null,
): number {
  if (afterCursor === null) return 0;
  const index = records.findIndex((record) => cursor(basis, record) === afterCursor);
  if (index < 0) {
    fail("cursor-substituted", "Knowledge continuation is not a member of the exact Context basis", {
      afterCursor,
      basisDigest: basis.digest,
    });
  }
  return index + 1;
}

function bodyReference(
  basis: FoundationContextBasis,
  record: FoundationKnowledgeRecord,
): FoundationSourceReference {
  return compileFoundationSourceReference({
    basis,
    sourceKind: "knowledge-body",
    subject: Object.freeze({
      kind: "knowledge-record",
      id: record.frontMatter.id,
      revision: record.frontMatter.revision,
      digest: record.semanticDigest,
    }),
    label: record.frontMatter.title,
    path: record.path,
    mediaType: "markdown",
    content: record.bodyNormalized,
  });
}

function exactRecord(
  query: FoundationDeliveryQueryBasis,
  selected: FoundationKnowledgeReference,
): FoundationKnowledgeRecord {
  const record = query.knowledge.index.byIdentityRevision.get(`${selected.id}@${selected.revision}`);
  if (record === undefined) {
    fail("record-absent", "Knowledge reference is absent from the exact historical Knowledge Set", {
      id: selected.id,
      revision: selected.revision,
    });
  }
  const expected = reference(record);
  if (canonicalJson(expected) !== canonicalJson(selected)) {
    fail("reference-substituted", "Knowledge reference does not reproduce the selected exact record", {
      selected,
      expected,
    });
  }
  return record;
}

function sourceResolution(
  resolution: FoundationKnowledgeSourceResolution,
): FoundationKnowledgeRecordResult["sources"][number] {
  return Object.freeze({
    id: resolution.sourceId,
    required: resolution.required,
    reference: resolution.reference,
    revision: resolution.declaredRevision,
    digest: resolution.declaredDigest,
    role: resolution.role,
    resolution: Object.freeze({
      kind: resolution.kind,
      locator: resolution.locator,
      objectId: resolution.objectId,
      resolvedDigest: resolution.resolvedDigest,
      disposition: resolution.disposition,
    }),
  });
}

export function compileFoundationKnowledgeIndex(input: Readonly<{
  query: FoundationDeliveryQueryBasis;
  basis: FoundationContextBasis;
  selector: KnowledgeIndexSelector;
}>): FoundationKnowledgeIndexResult {
  const records = Object.freeze([...input.query.knowledge.records].sort(compareRecords));
  const start = pageStart(records, input.basis, input.selector.afterCursor);
  const selected = selectedKnowledge(input.query);
  const page = records.slice(start, start + input.selector.limit);
  const rows = Object.freeze(page.map((record) => Object.freeze({
    cursor: cursor(input.basis, record),
    reference: reference(record),
    title: record.frontMatter.title,
    summary: record.frontMatter.summary,
    owners: record.frontMatter.owners,
    tags: record.frontMatter.tags,
    selectedByBoundary: selected.has(recordKey(record)),
  })));
  return FoundationKnowledgeIndexResultSchema.parse(Object.freeze({
    schema: "lifecycle.knowledge-index.v1",
    kind: "knowledge-index",
    basis: input.basis,
    records: rows,
    nextAfterCursor: start + page.length < records.length
      ? rows.at(-1)?.cursor ?? null
      : null,
  }));
}

export function compileFoundationKnowledgeRecord(input: Readonly<{
  query: FoundationDeliveryQueryBasis;
  basis: FoundationContextBasis;
  selector: KnowledgeRecordSelector;
}>): FoundationKnowledgeRecordResult {
  const record = exactRecord(input.query, input.selector.reference);
  const relationships = (input.query.knowledge.index.outgoingByIdentity.get(record.frontMatter.id) ?? [])
    .filter(({ sourceRevision, sourceSemanticDigest }) =>
      sourceRevision === record.frontMatter.revision && sourceSemanticDigest === record.semanticDigest)
    .map((edge) => Object.freeze({
      type: edge.type,
      target: Object.freeze({
        id: edge.target,
        revision: edge.targetRevision,
        status: edge.targetStatus,
        semanticDigest: edge.targetSemanticDigest,
      }),
      required: edge.required,
      scope: edge.scope,
      rationale: record.frontMatter.relationships.find((relationship) =>
        relationship.type === edge.type && relationship.target === edge.target)?.rationale ?? null,
      digest: edge.digest,
    }));
  const conflicts = input.query.knowledge.conflicts.filter((conflict) =>
    (conflict.leftId === record.frontMatter.id && conflict.leftRevision === record.frontMatter.revision) ||
    (conflict.rightId === record.frontMatter.id && conflict.rightRevision === record.frontMatter.revision));
  const sources = input.query.knowledge.index.sourcesByIdentityRevision.get(recordKey(record)) ?? [];
  const result = Object.freeze({
    schema: "lifecycle.knowledge-record-inspection.v1" as const,
    kind: "knowledge-record" as const,
    basis: input.basis,
    reference: reference(record),
    title: record.frontMatter.title,
    summary: record.frontMatter.summary,
    owners: record.frontMatter.owners,
    supersedes: record.frontMatter.supersedes,
    tags: record.frontMatter.tags,
    spec: record.frontMatter.spec,
    relationships: Object.freeze(relationships),
    conflicts: Object.freeze(conflicts),
    sources: Object.freeze(sources.map(sourceResolution)),
    selectedByBoundary: selectedKnowledge(input.query).has(recordKey(record)),
    bodyRepresentation: "normalized-semantic-body" as const,
    body: bodyReference(input.basis, record),
  });
  return FoundationKnowledgeRecordResultSchema.parse(result);
}

/** Resolve only one exact Runtime-issued Knowledge body reference. */
export function resolveFoundationKnowledgeInspectionSource(input: Readonly<{
  query: FoundationDeliveryQueryBasis;
  basis: FoundationContextBasis;
  reference: FoundationSourceReference;
}>): Uint8Array | null {
  if (
    input.reference.sourceKind !== "knowledge-body" ||
    input.reference.subject.kind !== "knowledge-record"
  ) return null;
  const selected = input.reference.subject;
  const record = input.query.knowledge.index.byIdentityRevision.get(`${selected.id}@${selected.revision}`);
  if (record === undefined || record.semanticDigest !== selected.digest) return null;
  const expected = bodyReference(input.basis, record);
  return sameFoundationSourceReference(expected, input.reference)
    ? new TextEncoder().encode(record.bodyNormalized)
    : null;
}
