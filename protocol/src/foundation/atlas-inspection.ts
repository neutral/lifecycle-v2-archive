import { utf8ToBytes } from "@noble/hashes/utils.js";
import { z } from "zod/v4";
import {
  FoundationGitObjectSchema,
  FoundationSha256Schema,
  type FoundationStrictJsonLimits,
} from "./core.js";
import {
  FOUNDATION_CONTEXT_INDEX_LIMIT,
  FoundationContextBasisSchema,
  FoundationContextSelectionSchema,
  FoundationRepositoryRelativePathSchema,
  FoundationSourceReferenceSchema,
  FoundationCursorSchema,
  FoundationIndexLimitSchema,
  addFoundationIssue,
  digestFoundationInspectionCursor,
  sameFoundationValue,
} from "./context-core.js";
import { FoundationNonnegativeSafeIntegerSchema } from "./internal.js";

/** Bounded Foundation Atlas inspection contracts. */

export const FOUNDATION_ATLAS_RECORD_LIMIT = 100;
export const FOUNDATION_ATLAS_RESOURCE_MAXIMUM_BYTES = 64 * 1024 * 1024;
export const FOUNDATION_ATLAS_AUTHORED_FILE_MAXIMUM_BYTES = 16 * 1024 * 1024;
export const FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_BYTES = 96 * 1024 * 1024;
export const FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_STRING_CODE_UNITS = 16 * 1024 * 1024;
export const FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_DEPTH = 64;
export const FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_NODES = 33_554_432;
export const FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_ARRAY_ITEMS = 16_777_216;
export const FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_OBJECT_PROPERTIES = 100_000;

/**
 * Transport profile for a validated Atlas inspection result.
 *
 * A request-aware parser may select this profile only from the
 * originating validated Atlas selector. These ceilings never replace the
 * strict JSON defaults for another operation, and caller limits may only
 * tighten them.
 */
export const FOUNDATION_ATLAS_RESULT_JSON_PROFILE = Object.freeze({
  maximumBytes: FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_BYTES,
  maximumStringCodeUnits: FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_STRING_CODE_UNITS,
  maximumDepth: FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_DEPTH,
  maximumNodes: FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_NODES,
  maximumArrayItems: FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_ARRAY_ITEMS,
  maximumObjectProperties: FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_OBJECT_PROPERTIES,
});

function tightenFoundationAtlasJsonLimit(
  requested: number | undefined,
  ceiling: number,
): number {
  if (requested === undefined) return ceiling;
  if (!Number.isSafeInteger(requested) || requested < 1) return requested;
  return Math.min(requested, ceiling);
}

/** Apply optional caller limits without permitting an Atlas ceiling increase. */
export function selectFoundationAtlasResultJsonLimits(
  requested: FoundationStrictJsonLimits = {},
): FoundationStrictJsonLimits {
  return Object.freeze({
    maximumBytes: tightenFoundationAtlasJsonLimit(
      requested.maximumBytes,
      FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_BYTES,
    ),
    maximumStringCodeUnits: tightenFoundationAtlasJsonLimit(
      requested.maximumStringCodeUnits,
      FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_STRING_CODE_UNITS,
    ),
    maximumDepth: tightenFoundationAtlasJsonLimit(
      requested.maximumDepth,
      FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_DEPTH,
    ),
    maximumNodes: tightenFoundationAtlasJsonLimit(
      requested.maximumNodes,
      FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_NODES,
    ),
    maximumArrayItems: tightenFoundationAtlasJsonLimit(
      requested.maximumArrayItems,
      FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_ARRAY_ITEMS,
    ),
    maximumObjectProperties: tightenFoundationAtlasJsonLimit(
      requested.maximumObjectProperties,
      FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_OBJECT_PROPERTIES,
    ),
    ...(requested.source === undefined ? {} : { source: requested.source }),
  });
}
const FoundationAtlasRecordLimitSchema = z.number().int().min(1)
  .max(FOUNDATION_ATLAS_RECORD_LIMIT);

const FoundationAtlasIdentifierSchema = z.string().min(1)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u)
  .refine(
    (value) => utf8ToBytes(value).byteLength <= FOUNDATION_ATLAS_AUTHORED_FILE_MAXIMUM_BYTES,
    { message: "Atlas identity exceeds the selected authored-file bound" },
  );
const FoundationAtlasResourceIdentifierSchema = FoundationAtlasIdentifierSchema
  .refine((value) => value.length <= 160, {
    message: "Atlas Resource identity exceeds the Lifecycle Resolution bound",
  });
const FoundationAtlasExtensionIdentifierSchema = z.string().min(3)
  .regex(/^x-[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u)
  .refine(
    (value) => utf8ToBytes(value).byteLength <= FOUNDATION_ATLAS_AUTHORED_FILE_MAXIMUM_BYTES,
    { message: "Atlas extension identity exceeds the selected authored-file bound" },
  );
const FoundationAtlasNonBlankStringSchema = z.string().min(1)
  .refine((value) => /\S/u.test(value), { message: "Atlas text must contain non-whitespace content" })
  .refine((value) => !value.includes("\u0000"), { message: "Atlas text cannot contain NUL" })
  .refine(
    (value) => utf8ToBytes(value).byteLength <= FOUNDATION_ATLAS_AUTHORED_FILE_MAXIMUM_BYTES,
    { message: "Atlas text exceeds the selected authored-file bound" },
  );
const FoundationAtlasSummarySchema = FoundationAtlasNonBlankStringSchema
  .refine((value) => [...value].length <= 1_000, {
    message: "Atlas summary exceeds the selected 1,000-code-point bound",
  });
const FoundationAtlasQuestionSchema = FoundationAtlasNonBlankStringSchema
  .refine((value) => [...value].length <= 2_000, {
    message: "Atlas question exceeds the selected 2,000-code-point bound",
  });
const FoundationAtlasUriReferenceSchema = FoundationAtlasNonBlankStringSchema
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
const FoundationAtlasResourceUriSchema = FoundationAtlasUriReferenceSchema
  .refine((value) => [...value].length <= 8_192, {
    message: "Atlas Resource URI exceeds the Lifecycle Resolution bound",
  });
const FoundationAtlasPointKindSchema = z.union([
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
  FoundationAtlasExtensionIdentifierSchema,
]);
const FoundationAtlasRelationTypeSchema = z.union([
  z.enum(["supersedes", "depends-on", "supports", "contradicts", "refines", "implements"]),
  FoundationAtlasExtensionIdentifierSchema,
]);

function compareFoundationAtlasCodePoints(left: string, right: string): number {
  const leftPoints = [...left];
  const rightPoints = [...right];
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index]!.codePointAt(0)! - rightPoints[index]!.codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

const FoundationAtlasMapSummarySchema = z.object({
  cursor: FoundationSha256Schema,
  id: FoundationAtlasIdentifierSchema,
  title: FoundationAtlasNonBlankStringSchema,
  summary: FoundationAtlasSummarySchema,
  question: FoundationAtlasQuestionSchema,
  status: z.enum(["draft", "active", "archived"]),
  path: FoundationRepositoryRelativePathSchema,
  pointCount: FoundationNonnegativeSafeIntegerSchema,
  selectedByBoundaryExecutionClosure: z.boolean(),
}).strict();

const FoundationAtlasPointSummarySchema = z.object({
  cursor: FoundationSha256Schema,
  id: FoundationAtlasIdentifierSchema,
  title: FoundationAtlasNonBlankStringSchema,
  summary: FoundationAtlasSummarySchema,
  kinds: z.array(FoundationAtlasPointKindSchema),
  primaryMapId: FoundationAtlasIdentifierSchema,
  posture: z.enum(["asserted", "open", "proposed", "intended"]),
  lifecycle: z.enum(["active", "historical", "superseded", "withdrawn"]),
  anchorPath: FoundationRepositoryRelativePathSchema,
  digest: FoundationSha256Schema,
  selectedByBoundaryExecutionClosure: z.boolean(),
}).strict().superRefine((value, context) => {
  if (new Set(value.kinds).size !== value.kinds.length) {
    addFoundationIssue(context, ["kinds"], "Atlas Point kinds cannot repeat");
  }
});

const FoundationAtlasResourceSummarySchema = z.object({
  cursor: FoundationSha256Schema,
  id: FoundationAtlasResourceIdentifierSchema,
  title: FoundationAtlasNonBlankStringSchema,
  summary: FoundationAtlasSummarySchema.nullable(),
  mediaType: FoundationAtlasNonBlankStringSchema.nullable(),
  disposition: z.enum(["resolved", "retrieval-denied", "missing", "unreadable", "path-invalid"]),
  digest: FoundationSha256Schema,
  selectedByBoundaryExecutionClosure: z.boolean(),
}).strict();

export const FoundationAtlasOverviewSelectorSchema = z.object({
  kind: z.literal("atlas-overview"),
  context: FoundationContextSelectionSchema,
  afterMapCursor: FoundationCursorSchema,
  mapLimit: FoundationIndexLimitSchema,
  afterPointCursor: FoundationCursorSchema,
  pointLimit: FoundationIndexLimitSchema,
  afterResourceCursor: FoundationCursorSchema,
  resourceLimit: FoundationIndexLimitSchema,
}).strict();

export const FoundationAtlasOverviewResultSchema = z.object({
  schema: z.literal("lifecycle.atlas-overview.v1"),
  kind: z.literal("atlas-overview"),
  basis: FoundationContextBasisSchema,
  atlasId: FoundationAtlasIdentifierSchema,
  title: FoundationAtlasNonBlankStringSchema,
  summary: FoundationAtlasSummarySchema,
  maps: z.array(FoundationAtlasMapSummarySchema)
    .max(FOUNDATION_CONTEXT_INDEX_LIMIT),
  nextAfterMapCursor: FoundationCursorSchema,
  points: z.array(FoundationAtlasPointSummarySchema)
    .max(FOUNDATION_CONTEXT_INDEX_LIMIT),
  nextAfterPointCursor: FoundationCursorSchema,
  resources: z.array(FoundationAtlasResourceSummarySchema)
    .max(FOUNDATION_CONTEXT_INDEX_LIMIT),
  nextAfterResourceCursor: FoundationCursorSchema,
}).strict().superRefine((value, context) => {
  if (value.nextAfterMapCursor !== null && value.maps.length === 0) {
    addFoundationIssue(context, ["nextAfterMapCursor"], "An empty Atlas Map page cannot advertise continuation");
  }
  if (value.nextAfterPointCursor !== null && value.points.length === 0) {
    addFoundationIssue(context, ["nextAfterPointCursor"], "An empty Atlas Point page cannot advertise continuation");
  }
  if (value.nextAfterResourceCursor !== null && value.resources.length === 0) {
    addFoundationIssue(context, ["nextAfterResourceCursor"], "An empty Atlas Resource page cannot advertise continuation");
  }
  const mapIds = value.maps.map(({ id }) => id);
  if (new Set(mapIds).size !== mapIds.length) {
    addFoundationIssue(context, ["maps"], "Atlas Maps cannot repeat");
  }
  const mapCursors = value.maps.map(({ cursor }) => cursor);
  if (new Set(mapCursors).size !== mapCursors.length) {
    addFoundationIssue(context, ["maps"], "Atlas Map cursors cannot repeat");
  }
  const pointCursors = value.points.map(({ cursor }) => cursor);
  if (new Set(pointCursors).size !== pointCursors.length) {
    addFoundationIssue(context, ["points"], "Atlas Point cursors cannot repeat");
  }
  const pointIds = value.points.map(({ id }) => id);
  if (new Set(pointIds).size !== pointIds.length) {
    addFoundationIssue(context, ["points"], "Atlas Point identities cannot repeat");
  }
  const resourceCursors = value.resources.map(({ cursor }) => cursor);
  if (new Set(resourceCursors).size !== resourceCursors.length) {
    addFoundationIssue(context, ["resources"], "Atlas Resource cursors cannot repeat");
  }
  const resourceIds = value.resources.map(({ id }) => id);
  if (new Set(resourceIds).size !== resourceIds.length) {
    addFoundationIssue(context, ["resources"], "Atlas Resource identities cannot repeat");
  }
  const pages = [
    { path: "maps", collection: "atlas-maps" as const, rows: value.maps, next: value.nextAfterMapCursor },
    { path: "points", collection: "atlas-points" as const, rows: value.points, next: value.nextAfterPointCursor },
    { path: "resources", collection: "atlas-resources" as const, rows: value.resources, next: value.nextAfterResourceCursor },
  ];
  for (const page of pages) {
    for (let index = 0; index < page.rows.length; index += 1) {
      const row = page.rows[index]!;
      const expectedCursor = digestFoundationInspectionCursor({
        basisDigest: value.basis.digest,
        collection: page.collection,
        key: { id: row.id },
      });
      if (row.cursor !== expectedCursor) {
        addFoundationIssue(context, [page.path, index, "cursor"], "Atlas overview cursor does not bind its context basis and exact identity");
      }
      if (
        index > 0 &&
        compareFoundationAtlasCodePoints(page.rows[index - 1]!.id, row.id) >= 0
      ) {
        addFoundationIssue(context, [page.path, index], "Atlas overview rows must use canonical identity order");
      }
    }
    if (page.next !== null && page.next !== page.rows.at(-1)?.cursor) {
      addFoundationIssue(context, [`nextAfter${page.path[0]!.toUpperCase()}${page.path.slice(1, -1)}Cursor`], "Atlas continuation must equal the final returned row cursor");
    }
  }
});

export const FoundationAtlasPointSelectorSchema = z.object({
  kind: z.literal("atlas-point"),
  context: FoundationContextSelectionSchema,
  pointCursor: FoundationSha256Schema,
  afterRecordCursor: FoundationCursorSchema,
  recordLimit: FoundationAtlasRecordLimitSchema,
  afterRelationCursor: FoundationCursorSchema,
  relationLimit: FoundationIndexLimitSchema,
}).strict();

const FoundationAtlasContentTargetSchema = z.union([
  z.object({
    resource: FoundationAtlasResourceIdentifierSchema,
    uri: z.null(),
    selector: FoundationAtlasNonBlankStringSchema.nullable(),
    label: FoundationAtlasNonBlankStringSchema.nullable(),
  }).strict(),
  z.object({
    resource: z.null(),
    uri: FoundationAtlasUriReferenceSchema,
    selector: z.null(),
    label: FoundationAtlasNonBlankStringSchema.nullable(),
  }).strict(),
]);

const FoundationAtlasReferenceBaseSchema = z.object({
  role: z.enum(["evidence", "supporting", "implementation", "historical", "example"]),
  label: FoundationAtlasNonBlankStringSchema.nullable(),
  note: FoundationAtlasNonBlankStringSchema.nullable(),
});
const FoundationAtlasReferenceSchema = z.union([
  FoundationAtlasReferenceBaseSchema.extend({
    resource: FoundationAtlasResourceIdentifierSchema,
    uri: z.null(),
    selector: FoundationAtlasNonBlankStringSchema.nullable(),
  }).strict(),
  FoundationAtlasReferenceBaseSchema.extend({
    resource: z.null(),
    uri: FoundationAtlasUriReferenceSchema,
    selector: z.null(),
  }).strict(),
]);

const FoundationAtlasPointRecordSchema = z.object({
  cursor: FoundationSha256Schema,
  kind: z.enum(["anchor", "context"]),
  map: FoundationAtlasIdentifierSchema,
  path: FoundationRepositoryRelativePathSchema,
  summary: FoundationAtlasSummarySchema,
  areas: z.array(z.object({
    area: FoundationAtlasIdentifierSchema,
    context: FoundationAtlasSummarySchema,
  }).strict()),
  content: z.array(FoundationAtlasContentTargetSchema),
  references: z.array(FoundationAtlasReferenceSchema),
  source: FoundationSourceReferenceSchema,
  selectedByBoundaryExecutionClosure: z.boolean(),
}).strict().superRefine((value, context) => {
  const areaKeys = value.areas.map(({ area, context: areaContext }) => `${area}\u0000${areaContext}`);
  if (new Set(areaKeys).size !== areaKeys.length) {
    addFoundationIssue(context, ["areas"], "Atlas Point area memberships cannot repeat");
  }
  const contentKeys = value.content.map((target) => target.resource === null
    ? `uri\u0000${target.uri}`
    : `resource\u0000${target.resource}\u0000${target.selector ?? ""}`);
  if (new Set(contentKeys).size !== contentKeys.length) {
    addFoundationIssue(context, ["content"], "Atlas Point Content targets cannot repeat");
  }
  const referenceKeys = value.references.map((reference) => reference.resource === null
    ? `uri\u0000${reference.uri}\u0000${reference.role}`
    : `resource\u0000${reference.resource}\u0000${reference.selector ?? ""}\u0000${reference.role}`);
  if (new Set(referenceKeys).size !== referenceKeys.length) {
    addFoundationIssue(context, ["references"], "Atlas Point References cannot repeat");
  }
});

const FoundationAtlasRelationSchema = z.object({
  cursor: FoundationSha256Schema,
  relatedPointCursor: FoundationSha256Schema,
  direction: z.enum(["outbound", "inbound"]),
  sourcePoint: FoundationAtlasIdentifierSchema,
  sourceMap: FoundationAtlasIdentifierSchema,
  sourcePath: FoundationRepositoryRelativePathSchema,
  type: FoundationAtlasRelationTypeSchema,
  targetPoint: FoundationAtlasIdentifierSchema,
  note: FoundationAtlasNonBlankStringSchema,
}).strict();

export const FoundationAtlasPointResultSchema = z.object({
  schema: z.literal("lifecycle.atlas-point-inspection.v1"),
  kind: z.literal("atlas-point"),
  basis: FoundationContextBasisSchema,
  point: FoundationAtlasPointSummarySchema,
  records: z.array(FoundationAtlasPointRecordSchema)
    .max(FOUNDATION_ATLAS_RECORD_LIMIT),
  nextAfterRecordCursor: FoundationCursorSchema,
  relations: z.array(FoundationAtlasRelationSchema)
    .max(FOUNDATION_CONTEXT_INDEX_LIMIT),
  nextAfterRelationCursor: FoundationCursorSchema,
}).strict().superRefine((value, context) => {
  if (value.point.cursor !== digestFoundationInspectionCursor({
    basisDigest: value.basis.digest,
    collection: "atlas-points",
    key: { id: value.point.id },
  })) {
    addFoundationIssue(context, ["point", "cursor"], "Atlas Point cursor does not bind its context basis and identity");
  }
  if (value.nextAfterRecordCursor !== null && value.records.length === 0) {
    addFoundationIssue(context, ["nextAfterRecordCursor"], "An empty Atlas record page cannot advertise continuation");
  }
  if (value.nextAfterRelationCursor !== null && value.relations.length === 0) {
    addFoundationIssue(context, ["nextAfterRelationCursor"], "An empty Atlas relation page cannot advertise continuation");
  }
  const anchors = value.records.filter((record) => record.kind === "anchor");
  if (anchors.length > 1) {
    addFoundationIssue(context, ["records"], "One Atlas Point page cannot contain several anchors");
  }
  for (let index = 0; index < value.records.length; index += 1) {
    const record = value.records[index]!;
    const source = record.source;
    if (
      record.kind === "anchor" &&
      (record.map !== value.point.primaryMapId || record.path !== value.point.anchorPath)
    ) {
      addFoundationIssue(context, ["records", index], "Atlas Point anchor does not reproduce its primary Map and anchor path");
    }
    if (record.kind === "context" && record.map === value.point.primaryMapId) {
      addFoundationIssue(context, ["records", index, "map"], "Atlas Point context record cannot use its primary Map");
    }
    if (
      record.selectedByBoundaryExecutionClosure &&
      !value.point.selectedByBoundaryExecutionClosure
    ) {
      addFoundationIssue(
        context,
        ["records", index, "selectedByBoundaryExecutionClosure"],
        "A record selected by the Boundary execution closure requires a similarly selected Point",
      );
    }
    if (
      source.sourceKind !== "atlas-body" ||
      source.subject.kind !== "atlas-point" ||
      source.subject.digest !== value.point.digest ||
      source.path !== record.path ||
      !sameFoundationValue(source.selection, value.basis.selection) ||
      source.basisDigest !== value.basis.digest
    ) {
      addFoundationIssue(context, ["records", index, "source"], "Atlas Point source uses another kind or context basis");
    }
  }
  const recordMaps = value.records.map(({ map }) => map);
  if (new Set(recordMaps).size !== recordMaps.length) {
    addFoundationIssue(context, ["records"], "Atlas Point records cannot repeat one Map");
  }
  const recordCursors = value.records.map(({ cursor }) => cursor);
  if (new Set(recordCursors).size !== recordCursors.length) {
    addFoundationIssue(context, ["records"], "Atlas record cursors cannot repeat");
  }
  for (let index = 0; index < value.records.length; index += 1) {
    const record = value.records[index]!;
    const expectedCursor = digestFoundationInspectionCursor({
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
      addFoundationIssue(context, ["records", index, "cursor"], "Atlas record cursor does not bind its context basis and exact record identity");
    }
    if (index > 0) {
      const prior = value.records[index - 1]!;
      const priorKey = `${prior.kind === "anchor" ? "0" : "1"}\u0000${prior.map}\u0000${prior.path}`;
      const rowKey = `${record.kind === "anchor" ? "0" : "1"}\u0000${record.map}\u0000${record.path}`;
      if (compareFoundationAtlasCodePoints(priorKey, rowKey) >= 0) {
        addFoundationIssue(context, ["records", index], "Atlas Point records must use canonical anchor, Map, and path order");
      }
    }
  }
  if (
    value.nextAfterRecordCursor !== null &&
    value.nextAfterRecordCursor !== value.records.at(-1)?.cursor
  ) {
    addFoundationIssue(context, ["nextAfterRecordCursor"], "Atlas record continuation must equal the final returned row cursor");
  }
  const relationCursors = value.relations.map(({ cursor }) => cursor);
  if (new Set(relationCursors).size !== relationCursors.length) {
    addFoundationIssue(context, ["relations"], "Atlas relation cursors cannot repeat");
  }
  const relationKeys = value.relations.map((relation, index) => {
    if (relation.sourcePoint === relation.targetPoint) {
      addFoundationIssue(context, ["relations", index], "Atlas relations cannot target their source Point");
    }
    if (relation.direction === "outbound" && (
      relation.sourcePoint !== value.point.id ||
      relation.sourceMap !== value.point.primaryMapId ||
      relation.sourcePath !== value.point.anchorPath
    )) {
      addFoundationIssue(context, ["relations", index], "Outbound Atlas relation does not originate at the inspected Point anchor");
    }
    if (relation.direction === "inbound" && relation.targetPoint !== value.point.id) {
      addFoundationIssue(context, ["relations", index], "Inbound Atlas relation does not target the inspected Point");
    }
    const identity = [
      relation.direction,
      relation.sourcePoint,
      relation.sourceMap,
      relation.sourcePath,
      relation.type,
      relation.targetPoint,
    ];
    const expectedCursor = digestFoundationInspectionCursor({
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
      addFoundationIssue(context, ["relations", index, "cursor"], "Atlas relation cursor does not bind its context basis and exact directional identity");
    }
    const relatedPointId = relation.direction === "outbound"
      ? relation.targetPoint
      : relation.sourcePoint;
    const expectedRelatedPointCursor = digestFoundationInspectionCursor({
      basisDigest: value.basis.digest,
      collection: "atlas-points",
      key: { id: relatedPointId },
    });
    if (relation.relatedPointCursor !== expectedRelatedPointCursor) {
      addFoundationIssue(
        context,
        ["relations", index, "relatedPointCursor"],
        "Atlas relation navigation cursor does not bind the related Point in this context basis",
      );
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
      if (compareFoundationAtlasCodePoints(priorKey, rowKey) >= 0) {
        addFoundationIssue(context, ["relations", index], "Atlas relations must use canonical directional identity order");
      }
    }
    return identity.join("\u0000");
  });
  if (new Set(relationKeys).size !== relationKeys.length) {
    addFoundationIssue(context, ["relations"], "Atlas relations cannot repeat one directional identity");
  }
  if (
    value.nextAfterRelationCursor !== null &&
    value.nextAfterRelationCursor !== value.relations.at(-1)?.cursor
  ) {
    addFoundationIssue(context, ["nextAfterRelationCursor"], "Atlas relation continuation must equal the final returned row cursor");
  }
});

export const FoundationAtlasResourceSelectorSchema = z.object({
  kind: z.literal("atlas-resource"),
  context: FoundationContextSelectionSchema,
  resourceId: FoundationAtlasResourceIdentifierSchema,
}).strict();

export const FoundationAtlasResourceResultSchema = z.object({
  schema: z.literal("lifecycle.atlas-resource-inspection.v1"),
  kind: z.literal("atlas-resource"),
  basis: FoundationContextBasisSchema,
  registration: z.object({
    id: FoundationAtlasResourceIdentifierSchema,
    uri: FoundationAtlasResourceUriSchema,
    title: FoundationAtlasNonBlankStringSchema,
    summary: FoundationAtlasSummarySchema.nullable(),
    mediaType: FoundationAtlasNonBlankStringSchema.nullable(),
    digest: FoundationSha256Schema,
  }).strict(),
  selectedByBoundaryExecutionClosure: z.boolean(),
  binding: z.object({
    disposition: z.enum(["resolved", "retrieval-denied", "missing", "unreadable", "path-invalid"]),
    path: FoundationRepositoryRelativePathSchema.nullable(),
    mode: z.literal("100644").nullable(),
    objectId: FoundationGitObjectSchema.nullable(),
    byteDigest: FoundationSha256Schema.nullable(),
    byteLength: FoundationNonnegativeSafeIntegerSchema
      .max(FOUNDATION_ATLAS_RESOURCE_MAXIMUM_BYTES).nullable(),
  }).strict(),
  source: FoundationSourceReferenceSchema.nullable(),
}).strict().superRefine((value, context) => {
  const isResolved = value.binding.disposition === "resolved";
  const retainsPath = isResolved ||
    value.binding.disposition === "missing" || value.binding.disposition === "unreadable";
  if ((value.binding.path !== null) !== retainsPath) {
    addFoundationIssue(context, ["binding", "path"], "Atlas Resource disposition and retained repository path disagree");
  }
  for (const field of ["mode", "objectId", "byteDigest", "byteLength"] as const) {
    if ((value.binding[field] !== null) !== isResolved) {
      addFoundationIssue(context, ["binding", field], "Only a resolved Atlas Resource carries complete observed blob facts");
    }
  }
  if (value.source !== null && !isResolved) {
    addFoundationIssue(context, ["source"], "Only a resolved Atlas Resource can have readable text source");
  }
  if (value.source !== null) {
    if (
      value.source.sourceKind !== "atlas-resource" ||
      value.source.subject.kind !== "atlas-resource" ||
      value.source.subject.id !== value.registration.id ||
      value.source.subject.digest !== value.registration.digest ||
      !sameFoundationValue(value.source.selection, value.basis.selection) ||
      value.source.basisDigest !== value.basis.digest ||
      value.source.path !== value.binding.path ||
      value.source.contentDigest !== value.binding.byteDigest ||
      value.source.byteLength !== value.binding.byteLength
    ) {
      addFoundationIssue(context, ["source"], "Atlas Resource source does not reproduce the exact binding");
    }
  }
});

export type FoundationAtlasOverviewResult = z.output<typeof FoundationAtlasOverviewResultSchema>;
export type FoundationAtlasPointResult = z.output<typeof FoundationAtlasPointResultSchema>;
export type FoundationAtlasResourceResult = z.output<typeof FoundationAtlasResourceResultSchema>;
