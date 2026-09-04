import { utf8ToBytes } from "@noble/hashes/utils.js";
import { z } from "zod/v4";
import {
  FoundationGitObjectSchema,
  FoundationSha256Schema,
} from "./core.js";
import {
  FOUNDATION_FUTURE_V11_CONTEXT_INDEX_LIMIT,
  FoundationFutureV11ContextBasisSchema,
  FoundationFutureV11ContextSelectionSchema,
  FoundationFutureV11RepositoryRelativePathSchema,
  FoundationFutureV11SourceReferenceSchema,
  FutureV11CursorSchema,
  FutureV11IndexLimitSchema,
  addFutureV11Issue,
  digestFutureV11InspectionCursor,
} from "./future-v11-context-core.js";
import { FoundationNonnegativeSafeIntegerSchema } from "./internal.js";

/** Private, unbarreled Foundation v11 Atlas inspection preparation. */

export const FOUNDATION_FUTURE_V11_ATLAS_RECORD_LIMIT = 100;
export const FOUNDATION_FUTURE_V11_ATLAS_RESOURCE_MAXIMUM_BYTES = 64 * 1024 * 1024;
export const FOUNDATION_FUTURE_V11_ATLAS_AUTHORED_FILE_MAXIMUM_BYTES = 16 * 1024 * 1024;
const FutureV11AtlasRecordLimitSchema = z.number().int().min(1)
  .max(FOUNDATION_FUTURE_V11_ATLAS_RECORD_LIMIT);

const FoundationFutureV11AtlasIdentifierSchema = z.string().min(1)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u)
  .refine(
    (value) => utf8ToBytes(value).byteLength <= FOUNDATION_FUTURE_V11_ATLAS_AUTHORED_FILE_MAXIMUM_BYTES,
    { message: "Atlas identity exceeds the selected authored-file bound" },
  );
const FoundationFutureV11AtlasResourceIdentifierSchema = FoundationFutureV11AtlasIdentifierSchema
  .refine((value) => value.length <= 160, {
    message: "Atlas Resource identity exceeds the Lifecycle Resolution bound",
  });
const FoundationFutureV11AtlasExtensionIdentifierSchema = z.string().min(3)
  .regex(/^x-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u)
  .refine(
    (value) => utf8ToBytes(value).byteLength <= FOUNDATION_FUTURE_V11_ATLAS_AUTHORED_FILE_MAXIMUM_BYTES,
    { message: "Atlas extension identity exceeds the selected authored-file bound" },
  );
const FoundationFutureV11AtlasNonBlankStringSchema = z.string().min(1)
  .refine((value) => /\S/u.test(value), { message: "Atlas text must contain non-whitespace content" })
  .refine((value) => !value.includes("\u0000"), { message: "Atlas text cannot contain NUL" })
  .refine(
    (value) => utf8ToBytes(value).byteLength <= FOUNDATION_FUTURE_V11_ATLAS_AUTHORED_FILE_MAXIMUM_BYTES,
    { message: "Atlas text exceeds the selected authored-file bound" },
  );
const FoundationFutureV11AtlasSummarySchema = FoundationFutureV11AtlasNonBlankStringSchema
  .refine((value) => [...value].length <= 1_000, {
    message: "Atlas summary exceeds the selected 1,000-code-point bound",
  });
const FoundationFutureV11AtlasQuestionSchema = FoundationFutureV11AtlasNonBlankStringSchema
  .refine((value) => [...value].length <= 2_000, {
    message: "Atlas question exceeds the selected 2,000-code-point bound",
  });
const FoundationFutureV11AtlasUriReferenceSchema = FoundationFutureV11AtlasNonBlankStringSchema
  .refine((value) => /^[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=%]+$/u.test(value), {
    message: "Atlas URI reference contains a character outside the selected URI-reference grammar",
  })
  .refine((value) => !/%(?![0-9a-f]{2})/iu.test(value), {
    message: "Atlas URI reference contains invalid percent encoding",
  })
  .refine((value) => {
    try {
      new URL(value, "https://lifecycle.invalid/");
      return true;
    } catch {
      return false;
    }
  }, { message: "Atlas URI reference is invalid" });
const FoundationFutureV11AtlasResourceUriSchema = FoundationFutureV11AtlasUriReferenceSchema
  .refine((value) => [...value].length <= 8_192, {
    message: "Atlas Resource URI exceeds the Lifecycle Resolution bound",
  });
const FoundationFutureV11AtlasPointKindSchema = z.union([
  z.enum([
    "decision",
    "constraint",
    "observation",
    "question",
    "proposal",
    "direction",
    "implementation",
    "requirement",
    "risk",
    "goal",
    "practice",
  ]),
  FoundationFutureV11AtlasExtensionIdentifierSchema,
]);
const FoundationFutureV11AtlasRelationTypeSchema = z.union([
  z.enum(["supersedes", "depends-on", "supports", "contradicts", "refines", "implements"]),
  FoundationFutureV11AtlasExtensionIdentifierSchema,
]);

function compareFutureV11AtlasCodePoints(left: string, right: string): number {
  const leftPoints = [...left];
  const rightPoints = [...right];
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index]!.codePointAt(0)! - rightPoints[index]!.codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

const FoundationFutureV11AtlasMapSummarySchema = z.object({
  cursor: FoundationSha256Schema,
  id: FoundationFutureV11AtlasIdentifierSchema,
  title: FoundationFutureV11AtlasNonBlankStringSchema,
  summary: FoundationFutureV11AtlasSummarySchema,
  question: FoundationFutureV11AtlasQuestionSchema,
  status: z.enum(["draft", "active", "archived"]),
  path: FoundationFutureV11RepositoryRelativePathSchema,
  pointCount: FoundationNonnegativeSafeIntegerSchema,
  selectedForExecution: z.boolean(),
}).strict();

const FoundationFutureV11AtlasPointSummarySchema = z.object({
  cursor: FoundationSha256Schema,
  id: FoundationFutureV11AtlasIdentifierSchema,
  title: FoundationFutureV11AtlasNonBlankStringSchema,
  summary: FoundationFutureV11AtlasSummarySchema,
  kinds: z.array(FoundationFutureV11AtlasPointKindSchema),
  primaryMapId: FoundationFutureV11AtlasIdentifierSchema,
  posture: z.enum(["asserted", "open", "proposed", "intended"]),
  lifecycle: z.enum(["active", "historical", "superseded", "withdrawn"]),
  anchorPath: FoundationFutureV11RepositoryRelativePathSchema,
  digest: FoundationSha256Schema,
  selectedForExecution: z.boolean(),
}).strict().superRefine((value, context) => {
  if (new Set(value.kinds).size !== value.kinds.length) {
    addFutureV11Issue(context, ["kinds"], "Atlas Point kinds cannot repeat");
  }
});

const FoundationFutureV11AtlasResourceSummarySchema = z.object({
  cursor: FoundationSha256Schema,
  id: FoundationFutureV11AtlasResourceIdentifierSchema,
  title: FoundationFutureV11AtlasNonBlankStringSchema,
  summary: FoundationFutureV11AtlasSummarySchema.nullable(),
  mediaType: FoundationFutureV11AtlasNonBlankStringSchema.nullable(),
  disposition: z.enum(["resolved", "retrieval-denied", "missing", "unreadable", "path-invalid"]),
  digest: FoundationSha256Schema,
  selectedForExecution: z.boolean(),
}).strict();

export const FoundationFutureV11AtlasOverviewSelectorSchema = z.object({
  kind: z.literal("atlas-overview"),
  context: FoundationFutureV11ContextSelectionSchema,
  afterMapCursor: FutureV11CursorSchema,
  mapLimit: FutureV11IndexLimitSchema,
  afterPointCursor: FutureV11CursorSchema,
  pointLimit: FutureV11IndexLimitSchema,
  afterResourceCursor: FutureV11CursorSchema,
  resourceLimit: FutureV11IndexLimitSchema,
}).strict();

export const FoundationFutureV11AtlasOverviewResultSchema = z.object({
  schema: z.literal("lifecycle.atlas-overview.v1"),
  basis: FoundationFutureV11ContextBasisSchema,
  atlasId: FoundationFutureV11AtlasIdentifierSchema,
  title: FoundationFutureV11AtlasNonBlankStringSchema,
  summary: FoundationFutureV11AtlasSummarySchema,
  maps: z.array(FoundationFutureV11AtlasMapSummarySchema)
    .max(FOUNDATION_FUTURE_V11_CONTEXT_INDEX_LIMIT),
  nextAfterMapCursor: FutureV11CursorSchema,
  points: z.array(FoundationFutureV11AtlasPointSummarySchema)
    .max(FOUNDATION_FUTURE_V11_CONTEXT_INDEX_LIMIT),
  nextAfterPointCursor: FutureV11CursorSchema,
  resources: z.array(FoundationFutureV11AtlasResourceSummarySchema)
    .max(FOUNDATION_FUTURE_V11_CONTEXT_INDEX_LIMIT),
  nextAfterResourceCursor: FutureV11CursorSchema,
}).strict().superRefine((value, context) => {
  if (value.nextAfterMapCursor !== null && value.maps.length === 0) {
    addFutureV11Issue(context, ["nextAfterMapCursor"], "An empty Atlas Map page cannot advertise continuation");
  }
  if (value.nextAfterPointCursor !== null && value.points.length === 0) {
    addFutureV11Issue(context, ["nextAfterPointCursor"], "An empty Atlas Point page cannot advertise continuation");
  }
  if (value.nextAfterResourceCursor !== null && value.resources.length === 0) {
    addFutureV11Issue(context, ["nextAfterResourceCursor"], "An empty Atlas Resource page cannot advertise continuation");
  }
  const mapIds = value.maps.map(({ id }) => id);
  if (new Set(mapIds).size !== mapIds.length) {
    addFutureV11Issue(context, ["maps"], "Atlas Maps cannot repeat");
  }
  const mapCursors = value.maps.map(({ cursor }) => cursor);
  if (new Set(mapCursors).size !== mapCursors.length) {
    addFutureV11Issue(context, ["maps"], "Atlas Map cursors cannot repeat");
  }
  const pointCursors = value.points.map(({ cursor }) => cursor);
  if (new Set(pointCursors).size !== pointCursors.length) {
    addFutureV11Issue(context, ["points"], "Atlas Point cursors cannot repeat");
  }
  const pointIds = value.points.map(({ id }) => id);
  if (new Set(pointIds).size !== pointIds.length) {
    addFutureV11Issue(context, ["points"], "Atlas Point identities cannot repeat");
  }
  const resourceCursors = value.resources.map(({ cursor }) => cursor);
  if (new Set(resourceCursors).size !== resourceCursors.length) {
    addFutureV11Issue(context, ["resources"], "Atlas Resource cursors cannot repeat");
  }
  const resourceIds = value.resources.map(({ id }) => id);
  if (new Set(resourceIds).size !== resourceIds.length) {
    addFutureV11Issue(context, ["resources"], "Atlas Resource identities cannot repeat");
  }
  const pages = [
    { path: "maps", collection: "atlas-maps" as const, rows: value.maps, next: value.nextAfterMapCursor },
    { path: "points", collection: "atlas-points" as const, rows: value.points, next: value.nextAfterPointCursor },
    { path: "resources", collection: "atlas-resources" as const, rows: value.resources, next: value.nextAfterResourceCursor },
  ];
  for (const page of pages) {
    for (let index = 0; index < page.rows.length; index += 1) {
      const row = page.rows[index]!;
      const expectedCursor = digestFutureV11InspectionCursor({
        basisDigest: value.basis.digest,
        collection: page.collection,
        key: { id: row.id },
      });
      if (row.cursor !== expectedCursor) {
        addFutureV11Issue(context, [page.path, index, "cursor"], "Atlas overview cursor does not bind its context basis and exact identity");
      }
      if (
        index > 0 &&
        compareFutureV11AtlasCodePoints(page.rows[index - 1]!.id, row.id) >= 0
      ) {
        addFutureV11Issue(context, [page.path, index], "Atlas overview rows must use canonical identity order");
      }
    }
    if (page.next !== null && page.next !== page.rows.at(-1)?.cursor) {
      addFutureV11Issue(context, [`nextAfter${page.path[0]!.toUpperCase()}${page.path.slice(1, -1)}Cursor`], "Atlas continuation must equal the final returned row cursor");
    }
  }
});

export const FoundationFutureV11AtlasPointSelectorSchema = z.object({
  kind: z.literal("atlas-point"),
  context: FoundationFutureV11ContextSelectionSchema,
  pointId: FoundationFutureV11AtlasIdentifierSchema,
  afterRecordCursor: FutureV11CursorSchema,
  recordLimit: FutureV11AtlasRecordLimitSchema,
  afterRelationCursor: FutureV11CursorSchema,
  relationLimit: FutureV11IndexLimitSchema,
}).strict();

const FoundationFutureV11AtlasContentTargetSchema = z.union([
  z.object({
    resource: FoundationFutureV11AtlasResourceIdentifierSchema,
    uri: z.null(),
    selector: FoundationFutureV11AtlasNonBlankStringSchema.nullable(),
    label: FoundationFutureV11AtlasNonBlankStringSchema.nullable(),
  }).strict(),
  z.object({
    resource: z.null(),
    uri: FoundationFutureV11AtlasUriReferenceSchema,
    selector: z.null(),
    label: FoundationFutureV11AtlasNonBlankStringSchema.nullable(),
  }).strict(),
]);

const FoundationFutureV11AtlasReferenceBaseSchema = z.object({
  role: z.enum(["evidence", "supporting", "implementation", "historical", "example"]),
  label: FoundationFutureV11AtlasNonBlankStringSchema.nullable(),
  note: FoundationFutureV11AtlasNonBlankStringSchema.nullable(),
});
const FoundationFutureV11AtlasReferenceSchema = z.union([
  FoundationFutureV11AtlasReferenceBaseSchema.extend({
    resource: FoundationFutureV11AtlasResourceIdentifierSchema,
    uri: z.null(),
    selector: FoundationFutureV11AtlasNonBlankStringSchema.nullable(),
  }).strict(),
  FoundationFutureV11AtlasReferenceBaseSchema.extend({
    resource: z.null(),
    uri: FoundationFutureV11AtlasUriReferenceSchema,
    selector: z.null(),
  }).strict(),
]);

const FoundationFutureV11AtlasPointRecordSchema = z.object({
  cursor: FoundationSha256Schema,
  kind: z.enum(["anchor", "context"]),
  map: FoundationFutureV11AtlasIdentifierSchema,
  path: FoundationFutureV11RepositoryRelativePathSchema,
  summary: FoundationFutureV11AtlasSummarySchema,
  areas: z.array(z.object({
    area: FoundationFutureV11AtlasIdentifierSchema,
    context: FoundationFutureV11AtlasSummarySchema,
  }).strict()),
  content: z.array(FoundationFutureV11AtlasContentTargetSchema),
  references: z.array(FoundationFutureV11AtlasReferenceSchema),
  source: FoundationFutureV11SourceReferenceSchema,
  selectedForExecution: z.boolean(),
}).strict().superRefine((value, context) => {
  const areaKeys = value.areas.map(({ area, context: areaContext }) => `${area}\u0000${areaContext}`);
  if (new Set(areaKeys).size !== areaKeys.length) {
    addFutureV11Issue(context, ["areas"], "Atlas Point area memberships cannot repeat");
  }
  const contentKeys = value.content.map((target) => target.resource === null
    ? `uri\u0000${target.uri}`
    : `resource\u0000${target.resource}\u0000${target.selector ?? ""}`);
  if (new Set(contentKeys).size !== contentKeys.length) {
    addFutureV11Issue(context, ["content"], "Atlas Point Content targets cannot repeat");
  }
  const referenceKeys = value.references.map((reference) => reference.resource === null
    ? `uri\u0000${reference.uri}\u0000${reference.role}`
    : `resource\u0000${reference.resource}\u0000${reference.selector ?? ""}\u0000${reference.role}`);
  if (new Set(referenceKeys).size !== referenceKeys.length) {
    addFutureV11Issue(context, ["references"], "Atlas Point References cannot repeat");
  }
});

const FoundationFutureV11AtlasRelationSchema = z.object({
  cursor: FoundationSha256Schema,
  direction: z.enum(["outbound", "inbound"]),
  sourcePoint: FoundationFutureV11AtlasIdentifierSchema,
  sourceMap: FoundationFutureV11AtlasIdentifierSchema,
  sourcePath: FoundationFutureV11RepositoryRelativePathSchema,
  type: FoundationFutureV11AtlasRelationTypeSchema,
  targetPoint: FoundationFutureV11AtlasIdentifierSchema,
  note: FoundationFutureV11AtlasNonBlankStringSchema,
}).strict();

export const FoundationFutureV11AtlasPointResultSchema = z.object({
  schema: z.literal("lifecycle.atlas-point-inspection.v1"),
  basis: FoundationFutureV11ContextBasisSchema,
  point: FoundationFutureV11AtlasPointSummarySchema,
  records: z.array(FoundationFutureV11AtlasPointRecordSchema)
    .max(FOUNDATION_FUTURE_V11_ATLAS_RECORD_LIMIT),
  nextAfterRecordCursor: FutureV11CursorSchema,
  relations: z.array(FoundationFutureV11AtlasRelationSchema)
    .max(FOUNDATION_FUTURE_V11_CONTEXT_INDEX_LIMIT),
  nextAfterRelationCursor: FutureV11CursorSchema,
}).strict().superRefine((value, context) => {
  if (value.point.cursor !== digestFutureV11InspectionCursor({
    basisDigest: value.basis.digest,
    collection: "atlas-points",
    key: { id: value.point.id },
  })) {
    addFutureV11Issue(context, ["point", "cursor"], "Atlas Point cursor does not bind its context basis and identity");
  }
  if (value.nextAfterRecordCursor !== null && value.records.length === 0) {
    addFutureV11Issue(context, ["nextAfterRecordCursor"], "An empty Atlas record page cannot advertise continuation");
  }
  if (value.nextAfterRelationCursor !== null && value.relations.length === 0) {
    addFutureV11Issue(context, ["nextAfterRelationCursor"], "An empty Atlas relation page cannot advertise continuation");
  }
  const anchors = value.records.filter((record) => record.kind === "anchor");
  if (anchors.length > 1) {
    addFutureV11Issue(context, ["records"], "One Atlas Point page cannot contain several anchors");
  }
  for (let index = 0; index < value.records.length; index += 1) {
    const record = value.records[index]!;
    const source = record.source;
    if (
      record.kind === "anchor" &&
      (record.map !== value.point.primaryMapId || record.path !== value.point.anchorPath)
    ) {
      addFutureV11Issue(context, ["records", index], "Atlas Point anchor does not reproduce its primary Map and anchor path");
    }
    if (record.kind === "context" && record.map === value.point.primaryMapId) {
      addFutureV11Issue(context, ["records", index, "map"], "Atlas Point context record cannot use its primary Map");
    }
    if (record.selectedForExecution && !value.point.selectedForExecution) {
      addFutureV11Issue(context, ["records", index, "selectedForExecution"], "A selected record requires a selected Point");
    }
    if (
      source.sourceKind !== "atlas-body" ||
      source.subject.kind !== "atlas-point" ||
      source.subject.id !== value.point.id ||
      source.subject.digest !== value.point.digest ||
      source.path !== record.path ||
      source.generationDigest !== value.basis.generation.digest ||
      source.basisDigest !== value.basis.digest
    ) {
      addFutureV11Issue(context, ["records", index, "source"], "Atlas Point source uses another kind or context basis");
    }
  }
  const recordMaps = value.records.map(({ map }) => map);
  if (new Set(recordMaps).size !== recordMaps.length) {
    addFutureV11Issue(context, ["records"], "Atlas Point records cannot repeat one Map");
  }
  const recordCursors = value.records.map(({ cursor }) => cursor);
  if (new Set(recordCursors).size !== recordCursors.length) {
    addFutureV11Issue(context, ["records"], "Atlas record cursors cannot repeat");
  }
  for (let index = 0; index < value.records.length; index += 1) {
    const record = value.records[index]!;
    const expectedCursor = digestFutureV11InspectionCursor({
      basisDigest: value.basis.digest,
      collection: "atlas-point-records",
      key: {
        pointId: value.point.id,
        map: record.map,
        kind: record.kind,
        path: record.path,
      },
    });
    if (record.cursor !== expectedCursor) {
      addFutureV11Issue(context, ["records", index, "cursor"], "Atlas record cursor does not bind its context basis and exact record identity");
    }
    if (index > 0) {
      const prior = value.records[index - 1]!;
      const priorKey = `${prior.kind === "anchor" ? "0" : "1"}\u0000${prior.map}\u0000${prior.path}`;
      const rowKey = `${record.kind === "anchor" ? "0" : "1"}\u0000${record.map}\u0000${record.path}`;
      if (compareFutureV11AtlasCodePoints(priorKey, rowKey) >= 0) {
        addFutureV11Issue(context, ["records", index], "Atlas Point records must use canonical anchor, Map, and path order");
      }
    }
  }
  if (
    value.nextAfterRecordCursor !== null &&
    value.nextAfterRecordCursor !== value.records.at(-1)?.cursor
  ) {
    addFutureV11Issue(context, ["nextAfterRecordCursor"], "Atlas record continuation must equal the final returned row cursor");
  }
  const relationCursors = value.relations.map(({ cursor }) => cursor);
  if (new Set(relationCursors).size !== relationCursors.length) {
    addFutureV11Issue(context, ["relations"], "Atlas relation cursors cannot repeat");
  }
  const relationKeys = value.relations.map((relation, index) => {
    if (relation.sourcePoint === relation.targetPoint) {
      addFutureV11Issue(context, ["relations", index], "Atlas relations cannot target their source Point");
    }
    if (relation.direction === "outbound" && (
      relation.sourcePoint !== value.point.id ||
      relation.sourceMap !== value.point.primaryMapId ||
      relation.sourcePath !== value.point.anchorPath
    )) {
      addFutureV11Issue(context, ["relations", index], "Outbound Atlas relation does not originate at the inspected Point anchor");
    }
    if (relation.direction === "inbound" && relation.targetPoint !== value.point.id) {
      addFutureV11Issue(context, ["relations", index], "Inbound Atlas relation does not target the inspected Point");
    }
    const identity = [
      relation.direction,
      relation.sourcePoint,
      relation.sourceMap,
      relation.sourcePath,
      relation.type,
      relation.targetPoint,
    ];
    const expectedCursor = digestFutureV11InspectionCursor({
      basisDigest: value.basis.digest,
      collection: "atlas-point-relations",
      key: {
        pointId: value.point.id,
        direction: relation.direction,
        sourcePoint: relation.sourcePoint,
        sourceMap: relation.sourceMap,
        sourcePath: relation.sourcePath,
        type: relation.type,
        targetPoint: relation.targetPoint,
      },
    });
    if (relation.cursor !== expectedCursor) {
      addFutureV11Issue(context, ["relations", index, "cursor"], "Atlas relation cursor does not bind its context basis and exact directional identity");
    }
    if (index > 0) {
      const prior = value.relations[index - 1]!;
      const priorKey = [
        prior.direction === "outbound" ? "0" : "1",
        prior.sourcePoint,
        prior.sourceMap,
        prior.sourcePath,
        prior.type,
        prior.targetPoint,
      ].join("\u0000");
      const rowKey = [
        relation.direction === "outbound" ? "0" : "1",
        relation.sourcePoint,
        relation.sourceMap,
        relation.sourcePath,
        relation.type,
        relation.targetPoint,
      ].join("\u0000");
      if (compareFutureV11AtlasCodePoints(priorKey, rowKey) >= 0) {
        addFutureV11Issue(context, ["relations", index], "Atlas relations must use canonical directional identity order");
      }
    }
    return identity.join("\u0000");
  });
  if (new Set(relationKeys).size !== relationKeys.length) {
    addFutureV11Issue(context, ["relations"], "Atlas relations cannot repeat one directional identity");
  }
  if (
    value.nextAfterRelationCursor !== null &&
    value.nextAfterRelationCursor !== value.relations.at(-1)?.cursor
  ) {
    addFutureV11Issue(context, ["nextAfterRelationCursor"], "Atlas relation continuation must equal the final returned row cursor");
  }
});

export const FoundationFutureV11AtlasResourceSelectorSchema = z.object({
  kind: z.literal("atlas-resource"),
  context: FoundationFutureV11ContextSelectionSchema,
  resourceId: FoundationFutureV11AtlasResourceIdentifierSchema,
}).strict();

export const FoundationFutureV11AtlasResourceResultSchema = z.object({
  schema: z.literal("lifecycle.atlas-resource-inspection.v1"),
  basis: FoundationFutureV11ContextBasisSchema,
  registration: z.object({
    id: FoundationFutureV11AtlasResourceIdentifierSchema,
    uri: FoundationFutureV11AtlasResourceUriSchema,
    title: FoundationFutureV11AtlasNonBlankStringSchema,
    summary: FoundationFutureV11AtlasSummarySchema.nullable(),
    mediaType: FoundationFutureV11AtlasNonBlankStringSchema.nullable(),
    digest: FoundationSha256Schema,
  }).strict(),
  selectedForExecution: z.boolean(),
  binding: z.object({
    disposition: z.enum(["resolved", "retrieval-denied", "missing", "unreadable", "path-invalid"]),
    path: FoundationFutureV11RepositoryRelativePathSchema.nullable(),
    mode: z.literal("100644").nullable(),
    objectId: FoundationGitObjectSchema.nullable(),
    byteDigest: FoundationSha256Schema.nullable(),
    byteLength: FoundationNonnegativeSafeIntegerSchema
      .max(FOUNDATION_FUTURE_V11_ATLAS_RESOURCE_MAXIMUM_BYTES).nullable(),
  }).strict(),
  source: FoundationFutureV11SourceReferenceSchema.nullable(),
}).strict().superRefine((value, context) => {
  const isResolved = value.binding.disposition === "resolved";
  const retainsPath = isResolved ||
    value.binding.disposition === "missing" || value.binding.disposition === "unreadable";
  if ((value.binding.path !== null) !== retainsPath) {
    addFutureV11Issue(context, ["binding", "path"], "Atlas Resource disposition and retained repository path disagree");
  }
  for (const field of ["mode", "objectId", "byteDigest", "byteLength"] as const) {
    if ((value.binding[field] !== null) !== isResolved) {
      addFutureV11Issue(context, ["binding", field], "Only a resolved Atlas Resource carries complete observed blob facts");
    }
  }
  if (value.source !== null && !isResolved) {
    addFutureV11Issue(context, ["source"], "Only a resolved Atlas Resource can have readable text source");
  }
  if (value.source !== null) {
    if (
      value.source.sourceKind !== "atlas-resource" ||
      value.source.subject.kind !== "atlas-resource" ||
      value.source.subject.id !== value.registration.id ||
      value.source.subject.digest !== value.registration.digest ||
      value.source.generationDigest !== value.basis.generation.digest ||
      value.source.basisDigest !== value.basis.digest ||
      value.source.path !== value.binding.path ||
      value.source.contentDigest !== value.binding.byteDigest ||
      value.source.byteLength !== value.binding.byteLength
    ) {
      addFutureV11Issue(context, ["source"], "Atlas Resource source does not reproduce the exact binding");
    }
  }
});

export type FoundationFutureV11AtlasOverviewResult = z.output<typeof FoundationFutureV11AtlasOverviewResultSchema>;
export type FoundationFutureV11AtlasPointResult = z.output<typeof FoundationFutureV11AtlasPointResultSchema>;
export type FoundationFutureV11AtlasResourceResult = z.output<typeof FoundationFutureV11AtlasResourceResultSchema>;
