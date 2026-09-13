import {
  digestFoundationInspectionCursor,
  FOUNDATION_ATLAS_RESOURCE_MAXIMUM_BYTES,
  FOUNDATION_SOURCE_MAXIMUM_BYTES,
  FoundationAtlasOverviewResultSchema,
  FoundationAtlasOverviewSelectorSchema,
  FoundationAtlasPointResultSchema,
  FoundationAtlasPointSelectorSchema,
  FoundationAtlasResourceResultSchema,
  FoundationAtlasResourceSelectorSchema,
  FoundationContextBasisSchema,
  type FoundationAtlasOverviewResult,
  type FoundationAtlasPointResult,
  type FoundationAtlasResourceResult,
  type FoundationContextBasis,
  type FoundationContextInspectionSelector,
  type FoundationSourceReference,
} from "@neutral/lifecycle-protocol";
import type {
  FoundationAtlasContentTarget,
  FoundationAtlasPoint,
  FoundationAtlasPointRecord,
  FoundationAtlasReference,
  FoundationAtlasRelation,
  FoundationAtlasResource,
  FoundationAtlasResourceBinding,
} from "../atlas/types.js";
import { FoundationError } from "../error.js";
import { compileExecutionProjectionSourceRoots } from "../projection/execution-source-roots.js";
import {
  atlasPointRecordKey,
  planAtlasExecutionClosure,
  type FoundationAtlasExecutionClosurePlan,
} from "../projection/atlas-execution-closure.js";
import { objectBlobBytes } from "../repository/git.js";
import { canonicalJson, digestCanonical, sha256Bytes, type Sha256 } from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import type { FoundationDeliveryQueryBasis } from "./delivery-query-basis.js";
import {
  compileFoundationSourceReference,
  sameFoundationSourceReference,
} from "./source-inspection.js";

type AtlasOverviewSelector = Extract<
  FoundationContextInspectionSelector,
  Readonly<{ kind: "atlas-overview" }>
>;
type AtlasPointSelector = Extract<
  FoundationContextInspectionSelector,
  Readonly<{ kind: "atlas-point" }>
>;
type AtlasResourceSelector = Extract<
  FoundationContextInspectionSelector,
  Readonly<{ kind: "atlas-resource" }>
>;

export type FoundationAtlasInspectionOwners = Readonly<{
  readBlob: (
    repository: string,
    objectId: string,
    maximumBytes: number,
  ) => Promise<Uint8Array>;
}>;

const DEFAULT_OWNERS: FoundationAtlasInspectionOwners = Object.freeze({
  readBlob: (repository, objectId, maximumBytes) =>
    objectBlobBytes(repository, objectId, maximumBytes),
});
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function fail(
  code: string,
  message: string,
  observedFacts: Readonly<Record<string, unknown>> = {},
): never {
  throw new FoundationError(`lifecycle.context-inspection.atlas-${code}`, message, {
    observedFacts,
  });
}

function sameBoundaryReference(
  basis: FoundationContextBasis,
  query: FoundationDeliveryQueryBasis,
): boolean {
  return basis.selection.boundary.role === query.boundaryRole &&
    basis.selection.boundary.reference.kind === "work-boundary" &&
    basis.selection.boundary.reference.id === query.boundary.recordId &&
    basis.selection.boundary.reference.revision === query.boundary.revision &&
    basis.selection.boundary.reference.digest === query.boundary.digest;
}

function assertContextBasis(
  query: FoundationDeliveryQueryBasis,
  value: FoundationContextBasis,
): FoundationContextBasis {
  const basis = FoundationContextBasisSchema.parse(value);
  const expectedRepository = Object.freeze({
    repositorySnapshotDigest: query.basis.repositorySnapshotDigest,
    repositoryContractDigest: query.basis.repositoryContractDigest,
    canonicalCommit: query.basis.productBaseCommit,
    canonicalTree: query.basis.productBaseTree,
    productStateDigest: query.basis.productStateDigest,
    knowledgeSetDigest: query.basis.knowledgeSetDigest,
    atlasStateDigest: query.basis.atlasStateDigest,
    atlasResolutionDigest: query.basis.atlasResolutionDigest,
    atlasNormalizedModelDigest: query.basis.atlasNormalizedModelDigest,
    atlasResourceBindingsDigest: query.basis.atlasResourceBindingsDigest,
    checkBindingSetDigest: digestCanonical(query.repository.contract.checkBindings),
  });
  if (
    !sameBoundaryReference(basis, query) ||
    canonicalJson(basis.repository) !== canonicalJson(expectedRepository)
  ) {
    fail(
      "basis-substituted",
      "Atlas inspection Context basis does not reproduce the selected historical Work Boundary",
      {
        selectedBoundary: basis.selection.boundary.reference,
        retainedBoundary: {
          id: query.boundary.recordId,
          revision: query.boundary.revision,
          digest: query.boundary.digest,
        },
        selectedRepositoryDigest: basis.repository.repositorySnapshotDigest,
        retainedRepositoryDigest: query.basis.repositorySnapshotDigest,
      },
    );
  }
  return basis;
}

function assertContextSelection(
  selector: Readonly<{ context: FoundationContextBasis["selection"] }>,
  basis: FoundationContextBasis,
): void {
  if (canonicalJson(selector.context) !== canonicalJson(basis.selection)) {
    fail("selection-substituted", "Atlas selector does not bind the exact historical inspection selection");
  }
}

function inspectionCursor(
  basis: FoundationContextBasis,
  collection:
    | "atlas-maps"
    | "atlas-points"
    | "atlas-resources"
    | "atlas-point-records"
    | "atlas-point-relations",
  key: unknown,
): Sha256 {
  return digestFoundationInspectionCursor({
    basisDigest: basis.digest,
    collection,
    key,
  });
}

function page<T extends Readonly<{ cursor: Sha256 }>>(input: Readonly<{
  rows: readonly T[];
  after: string | null;
  limit: number;
  label: string;
}>): Readonly<{ rows: readonly T[]; next: Sha256 | null }> {
  if (new Set(input.rows.map(({ cursor }) => cursor)).size !== input.rows.length) {
    fail("cursor-collision", `${input.label} rows do not retain unique basis-bound cursors`);
  }
  let start = 0;
  if (input.after !== null) {
    const matches = input.rows.flatMap((row, index) =>
      row.cursor === input.after ? [index] : []);
    if (matches.length !== 1) {
      fail("cursor-unknown", `${input.label} cursor is not a member of the selected Context basis`, {
        cursor: input.after,
      });
    }
    start = matches[0]! + 1;
  }
  const rows = Object.freeze(input.rows.slice(start, start + input.limit));
  return Object.freeze({
    rows,
    next: start + rows.length < input.rows.length ? rows.at(-1)?.cursor ?? null : null,
  });
}

function atlasRepositoryPath(query: FoundationDeliveryQueryBasis, relative: string): string {
  const root = query.repository.contract.atlas.root;
  return relative === "atlas.md" ? `${root}/atlas.md` : `${root}/${relative}`;
}

function atlasClosure(query: FoundationDeliveryQueryBasis): FoundationAtlasExecutionClosurePlan {
  const sourceRoots = compileExecutionProjectionSourceRoots({
    boundary: query.boundary,
    knowledge: query.knowledge,
    snapshot: query.repository,
  });
  return planAtlasExecutionClosure({
    loaded: query.repository,
    sourceRoots,
  });
}

function resourceBinding(
  query: FoundationDeliveryQueryBasis,
  resourceId: string,
): FoundationAtlasResourceBinding {
  const matches = query.repository.atlas.resolution.resourceBindings.filter(
    (binding) => binding.resourceId === resourceId,
  );
  if (matches.length !== 1) {
    fail("resource-binding", "Atlas Resource does not retain one exact Resolution binding", {
      resourceId,
      bindingCount: matches.length,
    });
  }
  return matches[0]!;
}

function mapSummary(
  query: FoundationDeliveryQueryBasis,
  basis: FoundationContextBasis,
  closure: FoundationAtlasExecutionClosurePlan,
  map: FoundationDeliveryQueryBasis["repository"]["atlas"]["model"]["maps"][number],
) {
  return Object.freeze({
    cursor: inspectionCursor(basis, "atlas-maps", { id: map.id }),
    id: map.id,
    title: map.title,
    summary: map.summary,
    question: map.question,
    status: map.status,
    path: atlasRepositoryPath(query, map.path),
    pointCount: map.pointIds.length,
    selectedByBoundaryExecutionClosure: closure.mapIds.has(map.id),
  });
}

function pointDigest(point: FoundationAtlasPoint): Sha256 {
  return digestCanonical(point);
}

function pointSummary(
  query: FoundationDeliveryQueryBasis,
  basis: FoundationContextBasis,
  closure: FoundationAtlasExecutionClosurePlan,
  point: FoundationAtlasPoint,
) {
  return Object.freeze({
    cursor: inspectionCursor(basis, "atlas-points", { id: point.id }),
    id: point.id,
    title: point.title,
    summary: point.summary,
    kinds: Object.freeze([...point.kinds]),
    primaryMapId: point.primaryMap,
    posture: point.posture,
    lifecycle: point.lifecycle,
    anchorPath: atlasRepositoryPath(query, point.anchorPath),
    digest: pointDigest(point),
    selectedByBoundaryExecutionClosure: closure.pointIds.has(point.id),
  });
}

function resourceRegistrationDigest(resource: FoundationAtlasResource): Sha256 {
  return digestCanonical(resource);
}

function resourceSummary(
  query: FoundationDeliveryQueryBasis,
  basis: FoundationContextBasis,
  closure: FoundationAtlasExecutionClosurePlan,
  resource: FoundationAtlasResource,
) {
  return Object.freeze({
    cursor: inspectionCursor(basis, "atlas-resources", { id: resource.id }),
    id: resource.id,
    title: resource.title,
    summary: resource.summary ?? null,
    mediaType: resource["media-type"] ?? null,
    disposition: resourceBinding(query, resource.id).disposition,
    digest: resourceRegistrationDigest(resource),
    selectedByBoundaryExecutionClosure: closure.resourceIds.has(resource.id),
  });
}

function mapContentTarget(target: FoundationAtlasContentTarget) {
  const hasResource = target.resource !== undefined;
  const hasUri = target.uri !== undefined;
  if (hasResource === hasUri) {
    fail("point-content", "Atlas Point Content target must select exactly one Resource or URI");
  }
  if (hasUri && target.selector !== undefined) {
    fail("point-content", "Atlas Point URI Content target cannot retain a Resource selector");
  }
  return hasResource
    ? Object.freeze({
      resource: target.resource!,
      uri: null,
      selector: target.selector ?? null,
      label: target.label ?? null,
    })
    : Object.freeze({
      resource: null,
      uri: target.uri!,
      selector: null,
      label: target.label ?? null,
    });
}

function mapReference(reference: FoundationAtlasReference) {
  const target = mapContentTarget(reference);
  return Object.freeze({
    role: reference.role,
    label: target.label,
    note: reference.note ?? null,
    resource: target.resource,
    uri: target.uri,
    selector: target.selector,
  });
}

function pointRecordRow(
  query: FoundationDeliveryQueryBasis,
  basis: FoundationContextBasis,
  closure: FoundationAtlasExecutionClosurePlan,
  point: FoundationAtlasPoint,
  record: FoundationAtlasPointRecord,
) {
  const path = atlasRepositoryPath(query, record.path);
  return Object.freeze({
    cursor: inspectionCursor(basis, "atlas-point-records", {
      pointId: point.id,
      map: record.map,
      kind: record.kind,
      path,
    }),
    kind: record.kind,
    map: record.map,
    path,
    summary: record.summary,
    areas: Object.freeze(record.areas.map(({ area, context }) =>
      Object.freeze({ area, context }))),
    content: Object.freeze(record.content.map(mapContentTarget)),
    references: Object.freeze(record.references.map(mapReference)),
    source: compileFoundationSourceReference({
      basis,
      sourceKind: "atlas-body",
      subject: Object.freeze({
        kind: "atlas-point",
        digest: pointDigest(point),
      }),
      label: "Atlas Point record body",
      path,
      mediaType: "markdown",
      content: record.body,
    }),
    selectedByBoundaryExecutionClosure: closure.pointRecordKeys.has(
      atlasPointRecordKey(point, record),
    ),
  });
}

function relationRow(
  query: FoundationDeliveryQueryBasis,
  basis: FoundationContextBasis,
  inspectedPoint: FoundationAtlasPoint,
  direction: "outbound" | "inbound",
  relation: FoundationAtlasRelation,
) {
  const sourcePath = atlasRepositoryPath(query, relation.sourcePath);
  const relatedPointId = direction === "outbound"
    ? relation.targetPoint
    : relation.sourcePoint;
  return Object.freeze({
    cursor: inspectionCursor(basis, "atlas-point-relations", {
      pointId: inspectedPoint.id,
      direction,
      sourcePoint: relation.sourcePoint,
      sourceMap: relation.sourceMap,
      sourcePath,
      type: relation.type,
      targetPoint: relation.targetPoint,
    }),
    relatedPointCursor: inspectionCursor(basis, "atlas-points", { id: relatedPointId }),
    direction,
    sourcePoint: relation.sourcePoint,
    sourceMap: relation.sourceMap,
    sourcePath,
    type: relation.type,
    targetPoint: relation.targetPoint,
    note: relation.note,
  });
}

function comparePointRecords(
  left: FoundationAtlasPointRecord,
  right: FoundationAtlasPointRecord,
): number {
  const leftKey = `${left.kind === "anchor" ? "0" : "1"}\0${left.map}\0${left.path}`;
  const rightKey = `${right.kind === "anchor" ? "0" : "1"}\0${right.map}\0${right.path}`;
  return compareCodePoints(leftKey, rightKey);
}

function compareRelationRows(
  left: ReturnType<typeof relationRow>,
  right: ReturnType<typeof relationRow>,
): number {
  const leftKey = [
    left.direction === "outbound" ? "0" : "1",
    left.sourcePoint,
    left.sourceMap,
    left.sourcePath,
    left.type,
    left.targetPoint,
  ].join("\0");
  const rightKey = [
    right.direction === "outbound" ? "0" : "1",
    right.sourcePoint,
    right.sourceMap,
    right.sourcePath,
    right.type,
    right.targetPoint,
  ].join("\0");
  return compareCodePoints(leftKey, rightKey);
}

/** Compile the three independently paged normalized Atlas overview collections. */
export function compileFoundationAtlasOverviewInspection(input: Readonly<{
  query: FoundationDeliveryQueryBasis;
  basis: FoundationContextBasis;
  selector: AtlasOverviewSelector;
}>): FoundationAtlasOverviewResult {
  const selector = FoundationAtlasOverviewSelectorSchema.parse(input.selector);
  const basis = assertContextBasis(input.query, input.basis);
  assertContextSelection(selector, basis);
  const closure = atlasClosure(input.query);
  const model = input.query.repository.atlas.model;
  const maps = model.maps
    .map((map) => mapSummary(input.query, basis, closure, map))
    .sort((left, right) => compareCodePoints(left.id, right.id));
  const points = model.points
    .map((point) => pointSummary(input.query, basis, closure, point))
    .sort((left, right) => compareCodePoints(left.id, right.id));
  const resources = model.atlas.resources
    .map((resource) => resourceSummary(input.query, basis, closure, resource))
    .sort((left, right) => compareCodePoints(left.id, right.id));
  const mapPage = page({
    rows: maps,
    after: selector.afterMapCursor,
    limit: selector.mapLimit,
    label: "Atlas Map",
  });
  const pointPage = page({
    rows: points,
    after: selector.afterPointCursor,
    limit: selector.pointLimit,
    label: "Atlas Point",
  });
  const resourcePage = page({
    rows: resources,
    after: selector.afterResourceCursor,
    limit: selector.resourceLimit,
    label: "Atlas Resource",
  });
  return FoundationAtlasOverviewResultSchema.parse(Object.freeze({
    schema: "lifecycle.atlas-overview.v1",
    kind: "atlas-overview",
    basis,
    atlasId: model.atlas.id,
    title: model.atlas.title,
    summary: model.atlas.summary,
    maps: mapPage.rows,
    nextAfterMapCursor: mapPage.next,
    points: pointPage.rows,
    nextAfterPointCursor: pointPage.next,
    resources: resourcePage.rows,
    nextAfterResourceCursor: resourcePage.next,
  }));
}

/** Compile one exact normalized Atlas Point selected by its basis-bound cursor. */
export function compileFoundationAtlasPointInspection(input: Readonly<{
  query: FoundationDeliveryQueryBasis;
  basis: FoundationContextBasis;
  selector: AtlasPointSelector;
}>): FoundationAtlasPointResult {
  const selector = FoundationAtlasPointSelectorSchema.parse(input.selector);
  const basis = assertContextBasis(input.query, input.basis);
  assertContextSelection(selector, basis);
  const model = input.query.repository.atlas.model;
  const selectedPoints = model.points.filter((point) =>
    inspectionCursor(basis, "atlas-points", { id: point.id }) === selector.pointCursor);
  if (selectedPoints.length !== 1) {
    fail("point-cursor", "Atlas Point cursor does not select one exact normalized Point", {
      cursor: selector.pointCursor,
      matchCount: selectedPoints.length,
    });
  }
  const point = selectedPoints[0]!;
  const closure = atlasClosure(input.query);
  const records = [...point.records]
    .sort(comparePointRecords)
    .map((record) => pointRecordRow(input.query, basis, closure, point, record));
  const relations = [
    ...point.relations.map((relation) =>
      relationRow(input.query, basis, point, "outbound", relation)),
    ...point.incomingRelations.map((relation) =>
      relationRow(input.query, basis, point, "inbound", relation)),
  ].sort(compareRelationRows);
  const recordPage = page({
    rows: records,
    after: selector.afterRecordCursor,
    limit: selector.recordLimit,
    label: "Atlas Point record",
  });
  const relationPage = page({
    rows: relations,
    after: selector.afterRelationCursor,
    limit: selector.relationLimit,
    label: "Atlas Point relation",
  });
  return FoundationAtlasPointResultSchema.parse(Object.freeze({
    schema: "lifecycle.atlas-point-inspection.v1",
    kind: "atlas-point",
    basis,
    point: pointSummary(input.query, basis, closure, point),
    records: recordPage.rows,
    nextAfterRecordCursor: recordPage.next,
    relations: relationPage.rows,
    nextAfterRelationCursor: relationPage.next,
  }));
}

function textualMediaType(
  resource: FoundationAtlasResource,
): FoundationSourceReference["mediaType"] | null {
  const mediaType = resource["media-type"]?.toLowerCase() ?? "";
  const withoutQuery = resource.uri.split(/[?#]/u, 1)[0]?.toLowerCase() ?? "";
  if (
    mediaType === "text/markdown" ||
    withoutQuery.endsWith(".md") ||
    withoutQuery.endsWith(".markdown")
  ) return "markdown";
  if (
    mediaType === "application/json" ||
    mediaType.endsWith("+json") ||
    withoutQuery.endsWith(".json")
  ) return "json";
  if (
    mediaType.startsWith("text/") ||
    [".txt", ".csv", ".tsv", ".yaml", ".yml"].some((suffix) =>
      withoutQuery.endsWith(suffix))
  ) return "plain";
  return null;
}

function exactUtf8(bytes: Uint8Array): boolean {
  try {
    const decoded = UTF8_DECODER.decode(bytes);
    const reencoded = UTF8_ENCODER.encode(decoded);
    return reencoded.byteLength === bytes.byteLength &&
      reencoded.every((byte, index) => byte === bytes[index]);
  } catch {
    return false;
  }
}

type ResourceCompilation = Readonly<{
  result: FoundationAtlasResourceResult;
  bytes: Uint8Array | null;
}>;

async function compileResource(input: Readonly<{
  query: FoundationDeliveryQueryBasis;
  basis: FoundationContextBasis;
  resource: FoundationAtlasResource;
  closure: FoundationAtlasExecutionClosurePlan;
  owners: FoundationAtlasInspectionOwners;
}>): Promise<ResourceCompilation> {
  const binding = resourceBinding(input.query, input.resource.id);
  const resolved = binding.disposition === "resolved";
  if (
    resolved !== (
      binding.path !== null &&
      binding.mode === "100644" &&
      binding.objectId !== null &&
      binding.byteDigest !== null
    ) ||
    (!resolved && (
      binding.mode !== null ||
      binding.objectId !== null ||
      binding.byteDigest !== null
    ))
  ) {
    fail("resource-binding", "Atlas Resource binding disposition and observed blob facts disagree", {
      resourceId: input.resource.id,
      disposition: binding.disposition,
    });
  }

  let bytes: Uint8Array | null = null;
  let byteLength: number | null = null;
  if (resolved) {
    bytes = Uint8Array.from(await input.owners.readBlob(
      input.query.repository.repository,
      binding.objectId!,
      FOUNDATION_ATLAS_RESOURCE_MAXIMUM_BYTES,
    ));
    if (
      bytes.byteLength > FOUNDATION_ATLAS_RESOURCE_MAXIMUM_BYTES ||
      sha256Bytes(bytes) !== binding.byteDigest
    ) {
      fail("resource-substituted", "Atlas Resource bytes do not reproduce their historical Resolution binding", {
        resourceId: input.resource.id,
        expectedDigest: binding.byteDigest,
        actualDigest: sha256Bytes(bytes),
        byteLength: bytes.byteLength,
      });
    }
    byteLength = bytes.byteLength;
  }

  const registrationDigest = resourceRegistrationDigest(input.resource);
  const mediaType = bytes !== null && bytes.byteLength <= FOUNDATION_SOURCE_MAXIMUM_BYTES
    ? textualMediaType(input.resource)
    : null;
  const source = bytes !== null && mediaType !== null && exactUtf8(bytes)
    ? compileFoundationSourceReference({
      basis: input.basis,
      sourceKind: "atlas-resource",
      subject: Object.freeze({
        kind: "atlas-resource",
        id: input.resource.id,
        digest: registrationDigest,
      }),
      label: `Atlas Resource ${input.resource.id}`,
      path: binding.path!,
      mediaType,
      content: bytes,
    })
    : null;
  const result = FoundationAtlasResourceResultSchema.parse(Object.freeze({
    schema: "lifecycle.atlas-resource-inspection.v1",
    kind: "atlas-resource",
    basis: input.basis,
    registration: Object.freeze({
      id: input.resource.id,
      uri: input.resource.uri,
      title: input.resource.title,
      summary: input.resource.summary ?? null,
      mediaType: input.resource["media-type"] ?? null,
      digest: registrationDigest,
    }),
    selectedByBoundaryExecutionClosure: input.closure.resourceIds.has(input.resource.id),
    binding: Object.freeze({
      disposition: binding.disposition,
      path: binding.path,
      mode: binding.mode,
      objectId: binding.objectId,
      byteDigest: binding.byteDigest,
      byteLength,
    }),
    source,
  }));
  return Object.freeze({ result, bytes });
}

/** Compile one registered Atlas Resource and its exact historical Resolution binding. */
export async function compileFoundationAtlasResourceInspection(input: Readonly<{
  query: FoundationDeliveryQueryBasis;
  basis: FoundationContextBasis;
  selector: AtlasResourceSelector;
  owners?: FoundationAtlasInspectionOwners;
}>): Promise<FoundationAtlasResourceResult> {
  const selector = FoundationAtlasResourceSelectorSchema.parse(input.selector);
  const basis = assertContextBasis(input.query, input.basis);
  assertContextSelection(selector, basis);
  const resources = input.query.repository.atlas.model.atlas.resources.filter(
    (resource) => resource.id === selector.resourceId,
  );
  if (resources.length !== 1) {
    fail("resource-unknown", "Atlas Resource selector does not name one exact registration", {
      resourceId: selector.resourceId,
      matchCount: resources.length,
    });
  }
  const compiled = await compileResource({
    query: input.query,
    basis,
    resource: resources[0]!,
    closure: atlasClosure(input.query),
    owners: input.owners ?? DEFAULT_OWNERS,
  });
  return compiled.result;
}

/**
 * Rederive one Atlas Source Reference from immutable normalized truth.
 *
 * `null` means that the selected reference belongs to another inspection
 * owner. An Atlas-kind reference that does not reproduce exactly is refused.
 */
export async function resolveFoundationAtlasInspectionSource(input: Readonly<{
  query: FoundationDeliveryQueryBasis;
  basis: FoundationContextBasis;
  reference: FoundationSourceReference;
  owners?: FoundationAtlasInspectionOwners;
}>): Promise<Uint8Array | null> {
  const basis = assertContextBasis(input.query, input.basis);
  if (
    input.reference.sourceKind !== "atlas-body" &&
    input.reference.sourceKind !== "atlas-resource"
  ) return null;
  if (
    canonicalJson(input.reference.selection) !== canonicalJson(basis.selection) ||
    input.reference.basisDigest !== basis.digest
  ) {
    fail("source-substituted", "Atlas Source Reference uses another inspection selection or Context basis");
  }

  if (input.reference.sourceKind === "atlas-body") {
    const matches: Uint8Array[] = [];
    const closure = atlasClosure(input.query);
    for (const point of input.query.repository.atlas.model.points) {
      if (
        input.reference.subject.kind !== "atlas-point" ||
        pointDigest(point) !== input.reference.subject.digest
      ) continue;
      for (const record of point.records) {
        const row = pointRecordRow(input.query, basis, closure, point, record);
        if (sameFoundationSourceReference(row.source, input.reference)) {
          matches.push(UTF8_ENCODER.encode(record.body));
        }
      }
    }
    if (matches.length !== 1) {
      fail("source-substituted", "Atlas Point Source Reference does not select one exact normalized record body", {
        matchCount: matches.length,
      });
    }
    return matches[0]!;
  }

  if (input.reference.subject.kind !== "atlas-resource") {
    fail("source-substituted", "Atlas Resource Source Reference uses another subject kind");
  }
  const subject = input.reference.subject;
  const resources = input.query.repository.atlas.model.atlas.resources.filter(
    (resource) => resource.id === subject.id,
  );
  if (resources.length !== 1) {
    fail("source-substituted", "Atlas Resource Source Reference does not select one exact registration", {
      matchCount: resources.length,
    });
  }
  const compiled = await compileResource({
    query: input.query,
    basis,
    resource: resources[0]!,
    closure: atlasClosure(input.query),
    owners: input.owners ?? DEFAULT_OWNERS,
  });
  if (
    compiled.result.source === null ||
    compiled.bytes === null ||
    !sameFoundationSourceReference(compiled.result.source, input.reference)
  ) {
    fail("source-substituted", "Atlas Resource Source Reference does not reproduce one exact textual binding");
  }
  return compiled.bytes;
}
