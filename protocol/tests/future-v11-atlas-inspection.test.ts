import assert from "node:assert/strict";
import test from "node:test";
import {
  FOUNDATION_FUTURE_V11_ATLAS_RESOURCE_MAXIMUM_BYTES,
  FoundationFutureV11AtlasOverviewResultSchema,
  FoundationFutureV11AtlasOverviewSelectorSchema,
  FoundationFutureV11AtlasPointResultSchema,
  FoundationFutureV11AtlasPointSelectorSchema,
  FoundationFutureV11AtlasResourceResultSchema,
  FoundationFutureV11AtlasResourceSelectorSchema,
} from "../src/foundation/future-v11-atlas-inspection.js";
import { digestFutureV11InspectionCursor } from "../src/foundation/future-v11-context-core.js";
import {
  basis,
  boundary,
  gitObject,
  sha,
  sourceReference,
} from "./future-v11-context-inspection-test-support.js";

const pointSummary = Object.freeze({
  cursor: digestFutureV11InspectionCursor({
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
  selectedForExecution: true,
});

test("Atlas selectors enforce page bounds and strict identities", () => {
  const context = basis();
  const selection = { expectedGeneration: context.generation.digest, boundary };
  const point = {
    kind: "atlas-point",
    context: selection,
    pointId: "checkout",
    afterRecordCursor: null,
    afterRelationCursor: null,
  };
  assert.equal(FoundationFutureV11AtlasPointSelectorSchema.safeParse({
    ...point,
    recordLimit: 100,
    relationLimit: 200,
  }).success, true);
  assert.equal(FoundationFutureV11AtlasPointSelectorSchema.safeParse({
    ...point,
    recordLimit: 101,
    relationLimit: 200,
  }).success, false);
  assert.equal(FoundationFutureV11AtlasPointSelectorSchema.safeParse({
    ...point,
    recordLimit: 100,
    relationLimit: 201,
  }).success, false);
  assert.equal(FoundationFutureV11AtlasOverviewSelectorSchema.safeParse({
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
  assert.equal(FoundationFutureV11AtlasResourceSelectorSchema.safeParse({
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
    basis: context,
    atlasId: "lifecycle",
    title: "Lifecycle",
    summary: "Lifecycle project context.",
    maps: [{
      cursor: digestFutureV11InspectionCursor({
        basisDigest: context.digest,
        collection: "atlas-maps",
        key: { id: "experience" },
      }),
      id: "experience",
      title: "Experience",
      summary: "Founder experience.",
      question: "How does the Founder orient?",
      status: "active",
      path: "atlas/maps/experience/map.md",
      pointCount: 1,
      selectedForExecution: true,
    }],
    nextAfterMapCursor: null,
    points: [pointSummary],
    nextAfterPointCursor: null,
    resources: [{
      cursor: digestFutureV11InspectionCursor({
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
      selectedForExecution: true,
    }],
    nextAfterResourceCursor: null,
  };
  assert.equal(FoundationFutureV11AtlasOverviewResultSchema.safeParse(overview).success, true);
  assert.equal(FoundationFutureV11AtlasOverviewResultSchema.safeParse({
    ...overview,
    nextAfterMapCursor: overview.maps[0]!.cursor,
    nextAfterPointCursor: overview.points[0]!.cursor,
    nextAfterResourceCursor: overview.resources[0]!.cursor,
  }).success, true);
  assert.equal(FoundationFutureV11AtlasOverviewResultSchema.safeParse({
    ...overview,
    maps: [],
    nextAfterMapCursor: sha("1"),
  }).success, false);
  assert.equal(FoundationFutureV11AtlasOverviewResultSchema.safeParse({
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
    basis: context,
    point: pointSummary,
    records: [{
      cursor: digestFutureV11InspectionCursor({
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
      areas: [{ area: "orientation", context: "Founder review" }],
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
      selectedForExecution: true,
    }],
    nextAfterRecordCursor: null,
    relations: [{
      cursor: digestFutureV11InspectionCursor({
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
  assert.equal(FoundationFutureV11AtlasPointResultSchema.safeParse(pointResult).success, true);
  assert.equal(FoundationFutureV11AtlasPointResultSchema.safeParse({
    ...pointResult,
    nextAfterRecordCursor: pointResult.records[0]!.cursor,
    nextAfterRelationCursor: pointResult.relations[0]!.cursor,
  }).success, true);
  assert.equal(FoundationFutureV11AtlasPointResultSchema.safeParse({
    ...pointResult,
    point: { ...pointResult.point, cursor: sha("1") },
  }).success, false);
  assert.equal(FoundationFutureV11AtlasPointResultSchema.safeParse({
    ...pointResult,
    point: { ...pointResult.point, selectedForExecution: false },
  }).success, false);
  assert.equal(FoundationFutureV11AtlasPointResultSchema.safeParse({
    ...pointResult,
    point: { ...pointResult.point, id: "point.checkout" },
  }).success, false);
  assert.equal(FoundationFutureV11AtlasPointResultSchema.safeParse({
    ...pointResult,
    point: { ...pointResult.point, title: "T".repeat(20_000) },
  }).success, true);
  assert.equal(FoundationFutureV11AtlasPointResultSchema.safeParse({
    ...pointResult,
    point: { ...pointResult.point, kinds: ["architecture"] },
  }).success, false);
  assert.equal(FoundationFutureV11AtlasPointResultSchema.safeParse({
    ...pointResult,
    records: [{
      ...pointResult.records[0],
      cursor: digestFutureV11InspectionCursor({
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
  assert.equal(FoundationFutureV11AtlasPointResultSchema.safeParse({
    ...pointResult,
    records: [{ ...pointResult.records[0], kind: "context" }],
  }).success, false);
  assert.equal(FoundationFutureV11AtlasPointResultSchema.safeParse({
    ...pointResult,
    records: [
      pointResult.records[0],
      { ...pointResult.records[0], cursor: sha("7"), kind: "context" },
    ],
  }).success, false);
  assert.equal(FoundationFutureV11AtlasPointResultSchema.safeParse({
    ...pointResult,
    records: [{
      ...pointResult.records[0],
      content: [{ resource: null, uri: "https://example.invalid/source", selector: "#fragment", label: null }],
    }],
  }).success, false);
  assert.equal(FoundationFutureV11AtlasPointResultSchema.safeParse({
    ...pointResult,
    records: [{
      ...pointResult.records[0],
      content: [
        pointResult.records[0]!.content[0]!,
        { ...pointResult.records[0]!.content[0]!, label: "Another label" },
      ],
    }],
  }).success, false);
  assert.equal(FoundationFutureV11AtlasPointResultSchema.safeParse({
    ...pointResult,
    relations: [{
      ...pointResult.relations[0],
      cursor: digestFutureV11InspectionCursor({
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
  assert.equal(FoundationFutureV11AtlasPointResultSchema.safeParse({
    ...pointResult,
    relations: [{ ...pointResult.relations[0], type: "informs" }],
  }).success, false);
  assert.equal(FoundationFutureV11AtlasPointResultSchema.safeParse({
    ...pointResult,
    relations: [
      pointResult.relations[0],
      { ...pointResult.relations[0], cursor: sha("7"), note: "Changed note." },
    ],
  }).success, false);
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
    basis: context,
    registration: {
      id: "checkout-source",
      uri: "atlas/sources/checkout.md",
      title: "Checkout source",
      summary: "Exact source.",
      mediaType: "text/markdown",
      digest: sha("8"),
    },
    selectedForExecution: true,
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
  assert.equal(FoundationFutureV11AtlasResourceResultSchema.safeParse(readable).success, true);
  assert.equal(FoundationFutureV11AtlasResourceResultSchema.safeParse({
    ...readable,
    binding: { ...readable.binding, byteLength: resourceSource.byteLength + 1 },
  }).success, false);
  assert.equal(FoundationFutureV11AtlasResourceResultSchema.safeParse({
    schema: "lifecycle.atlas-resource-inspection.v1",
    basis: context,
    registration: {
      id: "binary",
      uri: "atlas/sources/diagram.png",
      title: "Architecture diagram",
      summary: null,
      mediaType: "image/png",
      digest: sha("9"),
    },
    selectedForExecution: false,
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
  assert.equal(FoundationFutureV11AtlasResourceResultSchema.safeParse({
    schema: "lifecycle.atlas-resource-inspection.v1",
    basis: context,
    registration: {
      id: "oversized",
      uri: "atlas/sources/oversized.bin",
      title: "Oversized resource",
      summary: null,
      mediaType: "application/octet-stream",
      digest: sha("a"),
    },
    selectedForExecution: false,
    binding: {
      disposition: "resolved",
      path: "atlas/sources/oversized.bin",
      mode: "100644",
      objectId: gitObject("c"),
      byteDigest: sha("b"),
      byteLength: FOUNDATION_FUTURE_V11_ATLAS_RESOURCE_MAXIMUM_BYTES + 1,
    },
    source: null,
  }).success, false);

  for (const disposition of ["missing", "unreadable"] as const) {
    assert.equal(FoundationFutureV11AtlasResourceResultSchema.safeParse({
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
    assert.equal(FoundationFutureV11AtlasResourceResultSchema.safeParse({
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
  assert.equal(FoundationFutureV11AtlasResourceResultSchema.safeParse({
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
  assert.equal(FoundationFutureV11AtlasResourceResultSchema.safeParse({
    ...readable,
    registration: { ...readable.registration, id: "resource.checkout" },
    source: null,
  }).success, false);
  assert.equal(FoundationFutureV11AtlasResourceResultSchema.safeParse({
    ...readable,
    registration: { ...readable.registration, uri: `https://example.invalid/${"a".repeat(8_192)}` },
    source: null,
  }).success, false);
});
