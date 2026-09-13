import assert from "node:assert/strict";
import test from "node:test";
import { FoundationInspectionResultSchema } from "../src/foundation.js";
import {
  FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_ARRAY_ITEMS,
  FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_BYTES,
  FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_DEPTH,
  FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_NODES,
  FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_OBJECT_PROPERTIES,
  FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_STRING_CODE_UNITS,
  FOUNDATION_ATLAS_RESULT_JSON_PROFILE,
  FOUNDATION_ATLAS_RESOURCE_MAXIMUM_BYTES,
  FoundationAtlasOverviewResultSchema,
  FoundationAtlasOverviewSelectorSchema,
  FoundationAtlasPointResultSchema,
  FoundationAtlasPointSelectorSchema,
  FoundationAtlasResourceResultSchema,
  FoundationAtlasResourceSelectorSchema,
  selectFoundationAtlasResultJsonLimits,
} from "../src/foundation/atlas-inspection.js";
import {
  FoundationProtocolError,
  parseFoundationStrictJson,
} from "../src/foundation/core.js";
import { digestFoundationInspectionCursor } from "../src/foundation/context-core.js";
import {
  basis,
  gitObject,
  sha,
  sourceReference,
} from "./context-inspection-test-support.js";

const pointSummary = Object.freeze({
  cursor: digestFoundationInspectionCursor({
    basisDigest: basis().digest,
    collection: "atlas-points",
    key: { id: "checkout" },
  }),
  id: "checkout",
  title: "Checkout",
  summary: "Checkout remains exact.",
  kinds: ["implementation"],
  primaryMapId: "experience",
  posture: "asserted" as const,
  lifecycle: "active" as const,
  anchorPath: "atlas/maps/experience/points/checkout.md",
  digest: sha("2"),
  selectedByBoundaryExecutionClosure: true,
});

test("Atlas selectors enforce page bounds and strict identities", () => {
  const context = basis();
  const selection = context.selection;
  const point = {
    kind: "atlas-point",
    context: selection,
    pointCursor: pointSummary.cursor,
    afterRecordCursor: null,
    afterRelationCursor: null,
  };
  assert.equal(FoundationAtlasPointSelectorSchema.safeParse({
    ...point,
    recordLimit: 100,
    relationLimit: 200,
  }).success, true);
  assert.equal(FoundationAtlasPointSelectorSchema.safeParse({
    ...point,
    recordLimit: 101,
    relationLimit: 200,
  }).success, false);
  assert.equal(FoundationAtlasPointSelectorSchema.safeParse({
    ...point,
    recordLimit: 100,
    relationLimit: 201,
  }).success, false);
  assert.equal(FoundationAtlasPointSelectorSchema.safeParse({
    kind: "atlas-point",
    context: selection,
    pointId: "checkout",
    afterRecordCursor: null,
    recordLimit: 100,
    afterRelationCursor: null,
    relationLimit: 200,
  }).success, false);
  assert.equal(FoundationAtlasOverviewSelectorSchema.safeParse({
    kind: "atlas-overview",
    context: selection,
    afterMapCursor: null,
    mapLimit: 1,
    afterPointCursor: null,
    pointLimit: 1,
    afterResourceCursor: null,
    resourceLimit: 1,
    extra: true,
  }).success, false);
  assert.equal(FoundationAtlasResourceSelectorSchema.safeParse({
    kind: "atlas-resource",
    context: selection,
    resourceId: "checkout-source",
    path: "src/private",
  }).success, false);
});

test("Atlas overview and Point retain bounded normalized detail and exact source references", () => {
  const context = basis();
  const overview = {
    schema: "lifecycle.atlas-overview.v1",
    kind: "atlas-overview",
    basis: context,
    atlasId: "lifecycle",
    title: "Lifecycle",
    summary: "Lifecycle project context.",
    maps: [{
      cursor: digestFoundationInspectionCursor({
        basisDigest: context.digest,
        collection: "atlas-maps",
        key: { id: "experience" },
      }),
      id: "experience",
      title: "Experience",
      summary: "Director experience.",
      question: "How does the Director orient?",
      status: "active",
      path: "atlas/maps/experience/map.md",
      pointCount: 1,
      selectedByBoundaryExecutionClosure: true,
    }],
    nextAfterMapCursor: null,
    points: [pointSummary],
    nextAfterPointCursor: null,
    resources: [{
      cursor: digestFoundationInspectionCursor({
        basisDigest: context.digest,
        collection: "atlas-resources",
        key: { id: "checkout-source" },
      }),
      id: "checkout-source",
      title: "Checkout source",
      summary: "Exact source.",
      mediaType: "text/markdown",
      disposition: "resolved",
      digest: sha("8"),
      selectedByBoundaryExecutionClosure: true,
    }],
    nextAfterResourceCursor: null,
  };
  assert.equal(FoundationAtlasOverviewResultSchema.safeParse(overview).success, true);
  assert.equal(FoundationInspectionResultSchema.safeParse(overview).success, true);
  assert.equal(FoundationAtlasOverviewResultSchema.safeParse({
    ...overview,
    nextAfterMapCursor: overview.maps[0]!.cursor,
    nextAfterPointCursor: overview.points[0]!.cursor,
    nextAfterResourceCursor: overview.resources[0]!.cursor,
  }).success, true);
  assert.equal(FoundationAtlasOverviewResultSchema.safeParse({
    ...overview,
    maps: [],
    nextAfterMapCursor: sha("1"),
  }).success, false);
  assert.equal(FoundationAtlasOverviewResultSchema.safeParse({
    ...overview,
    maps: [overview.maps[0], { ...overview.maps[0], cursor: sha("7") }],
  }).success, false);

  const pointSource = sourceReference({
    context,
    sourceKind: "atlas-body",
    id: "checkout",
    path: "atlas/maps/experience/points/checkout.md",
    subjectDigest: pointSummary.digest,
  });
  const pointResult = {
    schema: "lifecycle.atlas-point-inspection.v1",
    kind: "atlas-point",
    basis: context,
    point: pointSummary,
    records: [{
      cursor: digestFoundationInspectionCursor({
        basisDigest: context.digest,
        collection: "atlas-point-records",
        key: {
          pointId: "checkout",
          map: "experience",
          kind: "anchor",
          path: "atlas/maps/experience/points/checkout.md",
        },
      }),
      kind: "anchor",
      map: "experience",
      path: "atlas/maps/experience/points/checkout.md",
      summary: "Checkout remains exact.",
      areas: [{ area: "orientation", context: "Director review" }],
      content: [{ resource: "checkout-source", uri: null, selector: null, label: "Checkout source" }],
      references: [{
        role: "implementation",
        resource: "checkout-source",
        uri: null,
        selector: null,
        label: "Checkout source",
        note: "Exact implementation.",
      }],
      source: pointSource,
      selectedByBoundaryExecutionClosure: true,
    }],
    nextAfterRecordCursor: null,
    relations: [{
      cursor: digestFoundationInspectionCursor({
        basisDigest: context.digest,
        collection: "atlas-point-relations",
        key: {
          pointId: "checkout",
          direction: "outbound",
          sourcePoint: "checkout",
          sourceMap: "experience",
          sourcePath: "atlas/maps/experience/points/checkout.md",
          type: "supports",
          targetPoint: "runtime",
        },
      }),
      relatedPointCursor: digestFoundationInspectionCursor({
        basisDigest: context.digest,
        collection: "atlas-points",
        key: { id: "runtime" },
      }),
      direction: "outbound",
      sourcePoint: "checkout",
      sourceMap: "experience",
      sourcePath: "atlas/maps/experience/points/checkout.md",
      type: "supports",
      targetPoint: "runtime",
      note: "Checkout informs runtime behavior.",
    }],
    nextAfterRelationCursor: null,
  };
  assert.equal(FoundationAtlasPointResultSchema.safeParse(pointResult).success, true);
  assert.equal(FoundationInspectionResultSchema.safeParse(pointResult).success, true);
  assert.equal(FoundationAtlasPointResultSchema.safeParse({
    ...pointResult,
    nextAfterRecordCursor: pointResult.records[0]!.cursor,
    nextAfterRelationCursor: pointResult.relations[0]!.cursor,
  }).success, true);
  assert.equal(FoundationAtlasPointResultSchema.safeParse({
    ...pointResult,
    point: { ...pointResult.point, cursor: sha("1") },
  }).success, false);
  assert.equal(FoundationAtlasPointResultSchema.safeParse({
    ...pointResult,
    point: { ...pointResult.point, selectedByBoundaryExecutionClosure: false },
  }).success, false);
  assert.equal(FoundationAtlasPointResultSchema.safeParse({
    ...pointResult,
    point: { ...pointResult.point, id: "point.checkout" },
  }).success, false);
  assert.equal(FoundationAtlasPointResultSchema.safeParse({
    ...pointResult,
    point: { ...pointResult.point, title: "T".repeat(20_000) },
  }).success, true);
  assert.equal(FoundationAtlasPointResultSchema.safeParse({
    ...pointResult,
    point: { ...pointResult.point, kinds: ["architecture"] },
  }).success, false);
  assert.equal(FoundationAtlasPointResultSchema.safeParse({
    ...pointResult,
    records: [{
      ...pointResult.records[0],
      cursor: digestFoundationInspectionCursor({
        basisDigest: context.digest,
        collection: "atlas-point-records",
        key: {
          pointId: "checkout",
          map: "operation",
          kind: "anchor",
          path: "atlas/maps/experience/points/checkout.md",
        },
      }),
      map: "operation",
    }],
  }).success, false);
  assert.equal(FoundationAtlasPointResultSchema.safeParse({
    ...pointResult,
    records: [{ ...pointResult.records[0], kind: "context" }],
  }).success, false);
  assert.equal(FoundationAtlasPointResultSchema.safeParse({
    ...pointResult,
    records: [
      pointResult.records[0],
      { ...pointResult.records[0], cursor: sha("7"), kind: "context" },
    ],
  }).success, false);
  assert.equal(FoundationAtlasPointResultSchema.safeParse({
    ...pointResult,
    records: [{
      ...pointResult.records[0],
      content: [{ resource: null, uri: "https://example.invalid/source", selector: "#fragment", label: null }],
    }],
  }).success, false);
  assert.equal(FoundationAtlasPointResultSchema.safeParse({
    ...pointResult,
    records: [{
      ...pointResult.records[0],
      content: [
        pointResult.records[0]!.content[0]!,
        { ...pointResult.records[0]!.content[0]!, label: "Another label" },
      ],
    }],
  }).success, false);
  assert.equal(FoundationAtlasPointResultSchema.safeParse({
    ...pointResult,
    relations: [{
      ...pointResult.relations[0],
      cursor: digestFoundationInspectionCursor({
        basisDigest: context.digest,
        collection: "atlas-point-relations",
        key: {
          pointId: "checkout",
          direction: "outbound",
          sourcePoint: "another-point",
          sourceMap: "experience",
          sourcePath: "atlas/maps/experience/points/checkout.md",
          type: "supports",
          targetPoint: "runtime",
        },
      }),
      sourcePoint: "another-point",
    }],
  }).success, false);
  assert.equal(FoundationAtlasPointResultSchema.safeParse({
    ...pointResult,
    relations: [{ ...pointResult.relations[0], type: "informs" }],
  }).success, false);
  assert.equal(FoundationAtlasPointResultSchema.safeParse({
    ...pointResult,
    relations: [{ ...pointResult.relations[0], relatedPointCursor: sha("7") }],
  }).success, false);
  const inboundRelation = {
    cursor: digestFoundationInspectionCursor({
      basisDigest: context.digest,
      collection: "atlas-point-relations" as const,
      key: {
        pointId: "checkout",
        direction: "inbound",
        sourcePoint: "runtime",
        sourceMap: "operation",
        sourcePath: "atlas/maps/operation/points/runtime.md",
        type: "supports",
        targetPoint: "checkout",
      },
    }),
    relatedPointCursor: digestFoundationInspectionCursor({
      basisDigest: context.digest,
      collection: "atlas-points" as const,
      key: { id: "runtime" },
    }),
    direction: "inbound" as const,
    sourcePoint: "runtime",
    sourceMap: "operation",
    sourcePath: "atlas/maps/operation/points/runtime.md",
    type: "supports",
    targetPoint: "checkout",
    note: "Runtime informs Checkout.",
  };
  assert.equal(FoundationAtlasPointResultSchema.safeParse({
    ...pointResult,
    relations: [inboundRelation],
  }).success, true);
  assert.equal(FoundationAtlasPointResultSchema.safeParse({
    ...pointResult,
    relations: [{ ...inboundRelation, relatedPointCursor: pointSummary.cursor }],
  }).success, false);
  assert.equal(FoundationAtlasPointResultSchema.safeParse({
    ...pointResult,
    relations: [
      pointResult.relations[0],
      { ...pointResult.relations[0], cursor: sha("7"), note: "Changed note." },
    ],
  }).success, false);
});

test("Atlas result JSON profile is explicit and does not redefine global defaults", () => {
  assert.deepEqual(FOUNDATION_ATLAS_RESULT_JSON_PROFILE, {
    maximumBytes: 100_663_296,
    maximumStringCodeUnits: 16_777_216,
    maximumDepth: 64,
    maximumNodes: 33_554_432,
    maximumArrayItems: 16_777_216,
    maximumObjectProperties: 100_000,
  });
  assert.equal(FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_BYTES, 100_663_296);
  assert.equal(FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_STRING_CODE_UNITS, 16_777_216);
  assert.equal(FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_DEPTH, 64);
  assert.equal(FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_NODES, 33_554_432);
  assert.equal(FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_ARRAY_ITEMS, 16_777_216);
  assert.equal(FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_OBJECT_PROPERTIES, 100_000);

  assert.deepEqual(selectFoundationAtlasResultJsonLimits({
    maximumBytes: FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_BYTES + 1,
    maximumDepth: 12,
    maximumNodes: FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_NODES + 1,
    source: "validated Atlas inspection result",
  }), {
    maximumBytes: FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_BYTES,
    maximumStringCodeUnits: FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_STRING_CODE_UNITS,
    maximumDepth: 12,
    maximumNodes: FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_NODES,
    maximumArrayItems: FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_ARRAY_ITEMS,
    maximumObjectProperties: FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_OBJECT_PROPERTIES,
    source: "validated Atlas inspection result",
  });
  for (const [field, ceiling] of Object.entries(
    FOUNDATION_ATLAS_RESULT_JSON_PROFILE,
  )) {
    for (const requested of [1, ceiling, ceiling + 1]) {
      const selected = selectFoundationAtlasResultJsonLimits({
        [field]: requested,
      });
      assert.equal(
        selected[field as keyof typeof selected],
        Math.min(requested, ceiling),
        `${field} at ${requested}`,
      );
    }
  }

  const beyondGlobalStringDefault = JSON.stringify("a".repeat((1024 * 1024) + 1));
  assert.throws(
    () => parseFoundationStrictJson(beyondGlobalStringDefault),
    (error: unknown) => error instanceof FoundationProtocolError &&
      error.code === "lifecycle.interface.json-string",
  );
  assert.equal(
    parseFoundationStrictJson(
      beyondGlobalStringDefault,
      selectFoundationAtlasResultJsonLimits(),
    ),
    "a".repeat((1024 * 1024) + 1),
  );
  assert.throws(
    () => parseFoundationStrictJson(
      "null",
      selectFoundationAtlasResultJsonLimits({ maximumDepth: 0 }),
    ),
    (error: unknown) => error instanceof FoundationProtocolError &&
      error.code === "lifecycle.interface.json-limit",
  );
  const beyondAtlasStringCeiling = JSON.stringify(
    "a".repeat(FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_STRING_CODE_UNITS + 1),
  );
  assert.throws(
    () => parseFoundationStrictJson(
      beyondAtlasStringCeiling,
      selectFoundationAtlasResultJsonLimits(),
    ),
    (error: unknown) => error instanceof FoundationProtocolError &&
      error.code === "lifecycle.interface.json-string",
  );
});

test("Atlas Resources distinguish readable text source from resolved binary binding", () => {
  const context = basis();
  const resourceContent = "resource bytes\n";
  const resourceSource = sourceReference({
    context,
    sourceKind: "atlas-resource",
    id: "checkout-source",
    content: resourceContent,
    path: "atlas/sources/checkout.md",
    subjectDigest: sha("8"),
  });
  const readable = {
    schema: "lifecycle.atlas-resource-inspection.v1",
    kind: "atlas-resource",
    basis: context,
    registration: {
      id: "checkout-source",
      uri: "atlas/sources/checkout.md",
      title: "Checkout source",
      summary: "Exact source.",
      mediaType: "text/markdown",
      digest: sha("8"),
    },
    selectedByBoundaryExecutionClosure: true,
    binding: {
      disposition: "resolved",
      path: "atlas/sources/checkout.md",
      mode: "100644",
      objectId: gitObject("a"),
      byteDigest: resourceSource.contentDigest,
      byteLength: resourceSource.byteLength,
    },
    source: resourceSource,
  };
  assert.equal(FoundationAtlasResourceResultSchema.safeParse(readable).success, true);
  assert.equal(FoundationInspectionResultSchema.safeParse(readable).success, true);
  assert.equal(FoundationAtlasResourceResultSchema.safeParse({
    ...readable,
    binding: { ...readable.binding, byteLength: resourceSource.byteLength + 1 },
  }).success, false);
  assert.equal(FoundationAtlasResourceResultSchema.safeParse({
    schema: "lifecycle.atlas-resource-inspection.v1",
    kind: "atlas-resource",
    basis: context,
    registration: {
      id: "binary",
      uri: "atlas/sources/diagram.png",
      title: "Architecture diagram",
      summary: null,
      mediaType: "image/png",
      digest: sha("9"),
    },
    selectedByBoundaryExecutionClosure: false,
    binding: {
      disposition: "resolved",
      path: "atlas/sources/diagram.png",
      mode: "100644",
      objectId: gitObject("b"),
      byteDigest: sha("7"),
      byteLength: 4_096,
    },
    source: null,
  }).success, true);
  assert.equal(FoundationAtlasResourceResultSchema.safeParse({
    schema: "lifecycle.atlas-resource-inspection.v1",
    kind: "atlas-resource",
    basis: context,
    registration: {
      id: "oversized",
      uri: "atlas/sources/oversized.bin",
      title: "Oversized resource",
      summary: null,
      mediaType: "application/octet-stream",
      digest: sha("a"),
    },
    selectedByBoundaryExecutionClosure: false,
    binding: {
      disposition: "resolved",
      path: "atlas/sources/oversized.bin",
      mode: "100644",
      objectId: gitObject("c"),
      byteDigest: sha("b"),
      byteLength: FOUNDATION_ATLAS_RESOURCE_MAXIMUM_BYTES + 1,
    },
    source: null,
  }).success, false);

  for (const disposition of ["missing", "unreadable"] as const) {
    assert.equal(FoundationAtlasResourceResultSchema.safeParse({
      ...readable,
      binding: {
        disposition,
        path: "atlas/sources/checkout.md",
        mode: null,
        objectId: null,
        byteDigest: null,
        byteLength: null,
      },
      source: null,
    }).success, true, disposition);
  }
  for (const disposition of ["retrieval-denied", "path-invalid"] as const) {
    assert.equal(FoundationAtlasResourceResultSchema.safeParse({
      ...readable,
      binding: {
        disposition,
        path: null,
        mode: null,
        objectId: null,
        byteDigest: null,
        byteLength: null,
      },
      source: null,
    }).success, true, disposition);
  }
  assert.equal(FoundationAtlasResourceResultSchema.safeParse({
    ...readable,
    binding: {
      disposition: "missing",
      path: null,
      mode: null,
      objectId: null,
      byteDigest: null,
      byteLength: null,
    },
    source: null,
  }).success, false);
  assert.equal(FoundationAtlasResourceResultSchema.safeParse({
    ...readable,
    registration: { ...readable.registration, id: "resource.checkout" },
    source: null,
  }).success, false);
  assert.equal(FoundationAtlasResourceResultSchema.safeParse({
    ...readable,
    registration: { ...readable.registration, uri: `https://example.invalid/${"a".repeat(8_192)}` },
    source: null,
  }).success, false);
});
