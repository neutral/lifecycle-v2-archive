import { contextInspectionSelection } from "../support/inspection-selection.js";
import assert from "node:assert/strict";
import test from "node:test";
import { createFoundationContextSelection, FoundationDeliveryGenerationSchema } from "@neutral/lifecycle-protocol";
import { FoundationError } from "../../src/foundation/error.js";
import {
  compileFoundationAtlasOverviewInspection,
  compileFoundationAtlasPointInspection,
  compileFoundationAtlasResourceInspection,
  resolveFoundationAtlasInspectionSource,
} from "../../src/foundation/read-model/atlas-inspection.js";
import { compileFoundationContextBasis } from "../../src/foundation/read-model/context-basis.js";
import type { FoundationDeliveryQueryBasis } from "../../src/foundation/read-model/delivery-query-basis.js";
import { atlasResourceSourceId } from "../../src/foundation/projection/source-context.js";
import { sha256Bytes, type Sha256 } from "../../src/foundation/validation/canonical.js";

const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);
const OBJECT_ID = "c".repeat(40);
const RESOURCE_BYTES = Buffer.from("# Exact resource\n", "utf8");

function digest(label: string): Sha256 {
  return sha256Bytes(`atlas-inspection:${label}`);
}

function query(): FoundationDeliveryQueryBasis {
  const atlasId = "fixture-atlas";
  const resourceId = "exact-resource";
  const resourceSourceId = atlasResourceSourceId(atlasId, resourceId);
  const resourceDigest = sha256Bytes(RESOURCE_BYTES);
  const resource = Object.freeze({
    id: resourceId,
    uri: "sources/exact-resource.md",
    title: "Exact resource",
    summary: "Exact selected Resource.",
    "media-type": "text/markdown",
  });
  const binding = Object.freeze({
    resourceId,
    uri: resource.uri,
    path: "atlas/sources/exact-resource.md",
    mode: "100644" as const,
    objectId: OBJECT_ID,
    byteDigest: resourceDigest,
    disposition: "resolved" as const,
  });
  const checkoutRecord = Object.freeze({
    kind: "anchor" as const,
    map: "experience",
    path: "maps/experience/points/checkout.md",
    summary: "Checkout remains exact.",
    areas: Object.freeze([Object.freeze({
      area: "orientation",
      context: "Director review remains oriented.",
    })]),
    content: Object.freeze([Object.freeze({ resource: resourceId })]),
    references: Object.freeze([]),
    extensions: Object.freeze({}),
    body: "Checkout body.\n",
  });
  const runtimeRecord = Object.freeze({
    kind: "anchor" as const,
    map: "experience",
    path: "maps/experience/points/runtime.md",
    summary: "Runtime remains subordinate.",
    areas: Object.freeze([]),
    content: Object.freeze([]),
    references: Object.freeze([]),
    extensions: Object.freeze({}),
    body: "Runtime body.\n",
  });
  const relation = Object.freeze({
    sourcePoint: "checkout",
    sourceMap: "experience",
    sourcePath: checkoutRecord.path,
    type: "supports",
    targetPoint: "runtime",
    note: "Checkout informs Runtime.",
    extensions: Object.freeze({}),
  });
  const checkout = Object.freeze({
    id: "checkout",
    title: "Checkout",
    summary: checkoutRecord.summary,
    kinds: Object.freeze(["implementation"]),
    posture: "asserted" as const,
    lifecycle: "active" as const,
    primaryMap: "experience",
    anchorPath: checkoutRecord.path,
    records: Object.freeze([checkoutRecord]),
    relations: Object.freeze([relation]),
    incomingRelations: Object.freeze([]),
    review: null,
    extensions: Object.freeze({}),
  });
  const runtime = Object.freeze({
    id: "runtime",
    title: "Runtime",
    summary: runtimeRecord.summary,
    kinds: Object.freeze(["implementation"]),
    posture: "asserted" as const,
    lifecycle: "active" as const,
    primaryMap: "experience",
    anchorPath: runtimeRecord.path,
    records: Object.freeze([runtimeRecord]),
    relations: Object.freeze([]),
    incomingRelations: Object.freeze([relation]),
    review: null,
    extensions: Object.freeze({}),
  });
  const model = Object.freeze({
    format: 1 as const,
    atlas: Object.freeze({
      id: atlasId,
      title: "Fixture Atlas",
      summary: "Exact project context.",
      navigation: Object.freeze([]),
      resources: Object.freeze([resource]),
      content: Object.freeze([]),
      references: Object.freeze([]),
      extensions: Object.freeze({}),
      body: "Fixture Atlas body.\n",
    }),
    maps: Object.freeze([Object.freeze({
      id: "experience",
      title: "Experience",
      summary: "Director experience.",
      question: "How does the Director orient?",
      status: "active" as const,
      path: "maps/experience/map.md",
      areas: Object.freeze([]),
      content: Object.freeze([Object.freeze({ resource: resourceId })]),
      references: Object.freeze([]),
      extensions: Object.freeze({}),
      body: "Experience body.\n",
      pointIds: Object.freeze(["checkout", "runtime"]),
      anchorPointIds: Object.freeze(["checkout", "runtime"]),
      contextPointIds: Object.freeze([]),
    })]),
    points: Object.freeze([checkout, runtime]),
    checks: Object.freeze([]),
    publicationProfiles: Object.freeze([]),
    relatedMaps: Object.freeze([]),
  });
  const boundary = Object.freeze({
    schema: "lifecycle.control-record-revision.v2" as const,
    processId: "delivery.fixture",
    recordId: "boundary.fixture",
    recordKind: "work-boundary",
    revision: 1,
    producer: Object.freeze({ kind: "runtime" as const, id: "foundation-runtime" }),
    semanticAuthor: Object.freeze({ kind: "runtime" as const, id: "foundation-runtime" }),
    semanticAuthority: "runtime-derived" as const,
    createdAt: "2026-09-04T12:00:00.000Z",
    semanticMarkdown: "# Boundary\n",
    payload: Object.freeze({
      schema: "lifecycle.work-boundary-payload.v6",
      profileId: "lifecycle.work-boundary.foundation-v3",
      targetId: "target.fixture",
      externalSources: Object.freeze([Object.freeze({
        sourceId: resourceSourceId,
        revision: OBJECT_ID,
        digest: resourceDigest,
        ownerKind: "atlas",
        ownerId: resourceSourceId,
      })]),
    }),
    relationships: Object.freeze([]),
    digest: digest("boundary"),
  });
  return Object.freeze({
    boundaryRole: "active" as const,
    boundary,
    basis: Object.freeze({
      specificationRevision: "lifecycle.foundation.1.0.0-rc.17",
      repositoryContract: "lifecycle.repository.v22",
      providerAdapter: "lifecycle.provider-adapter.v7",
      productBaseCommit: COMMIT,
      productBaseTree: TREE,
      productStateDigest: digest("product-state"),
      atlasStateDigest: digest("atlas-state"),
      atlasResolutionDigest: digest("atlas-resolution"),
      atlasNormalizedModelDigest: digest("atlas-model"),
      atlasResourceBindingsDigest: digest("atlas-bindings"),
      repositoryContractDigest: digest("contract"),
      knowledgeSetDigest: digest("knowledge"),
      repositorySnapshotDigest: digest("snapshot"),
    }),
    knowledge: Object.freeze({ sources: Object.freeze([]) }),
    repository: Object.freeze({
      repository: "/private/fixture",
      contract: Object.freeze({
        targetId: "target.fixture",
        atlas: Object.freeze({ root: "atlas", entrypoint: "atlas/atlas.md", readOnly: true }),
        checkBindings: Object.freeze({}),
      }),
      atlas: Object.freeze({
        model,
        resolution: Object.freeze({ resourceBindings: Object.freeze([binding]) }),
      }),
    }),
  }) as unknown as FoundationDeliveryQueryBasis;
}

function generation() {
  return FoundationDeliveryGenerationSchema.parse({
    schema: "lifecycle.delivery-generation.v1",
    storeId: "store.fixture",
    processId: "delivery.fixture",
    journal: { eventCount: 1, headSequence: 1, headDigest: digest("head") },
    storeDisposition: {
      stage: "active",
      integrity: "verified",
      sealSubjectDigest: null,
      archiveManifestDigest: null,
    },
    repository: {
      headCommit: COMMIT,
      headTree: TREE,
      repositoryContractDigest: digest("contract"),
    },
    activeOperation: null,
    digest: digest("generation"),
  });
}


test("Atlas compilers page exact normalized truth and preserve Boundary closure selection", async () => {
  const selected = query();
  const selectedGeneration = generation();
  const basis = compileFoundationContextBasis(selected, contextInspectionSelection(selected, selectedGeneration));
  const context = basis.selection;
  const overview = compileFoundationAtlasOverviewInspection({
    query: selected,
    basis,
    selector: {
      kind: "atlas-overview",
      context,
      afterMapCursor: null,
      mapLimit: 1,
      afterPointCursor: null,
      pointLimit: 1,
      afterResourceCursor: null,
      resourceLimit: 1,
    },
  });
  assert.equal(overview.maps[0]?.path, "atlas/maps/experience/map.md");
  assert.equal(overview.maps[0]?.selectedByBoundaryExecutionClosure, true);
  assert.equal(overview.points[0]?.id, "checkout");
  assert.equal(overview.points[0]?.selectedByBoundaryExecutionClosure, true);
  assert.equal(overview.nextAfterPointCursor, overview.points[0]?.cursor);
  assert.equal(overview.resources[0]?.selectedByBoundaryExecutionClosure, true);

  const next = compileFoundationAtlasOverviewInspection({
    query: selected,
    basis,
    selector: {
      kind: "atlas-overview",
      context,
      afterMapCursor: null,
      mapLimit: 1,
      afterPointCursor: overview.nextAfterPointCursor,
      pointLimit: 1,
      afterResourceCursor: null,
      resourceLimit: 1,
    },
  });
  assert.equal(next.points[0]?.id, "runtime");
  assert.equal(next.points[0]?.selectedByBoundaryExecutionClosure, false);
  assert.equal(next.nextAfterPointCursor, null);

  const point = compileFoundationAtlasPointInspection({
    query: selected,
    basis,
    selector: {
      kind: "atlas-point",
      context,
      pointCursor: overview.points[0]!.cursor,
      afterRecordCursor: null,
      recordLimit: 1,
      afterRelationCursor: null,
      relationLimit: 1,
    },
  });
  assert.equal(point.records[0]?.path, "atlas/maps/experience/points/checkout.md");
  assert.equal(point.records[0]?.selectedByBoundaryExecutionClosure, true);
  assert.equal(point.relations[0]?.direction, "outbound");
  assert.equal(point.relations[0]?.sourcePath, point.point.anchorPath);

  const resource = await compileFoundationAtlasResourceInspection({
    query: selected,
    basis,
    selector: { kind: "atlas-resource", context, resourceId: "exact-resource" },
    owners: Object.freeze({
      readBlob: async (_repository, objectId, maximumBytes) => {
        assert.equal(objectId, OBJECT_ID);
        assert.equal(maximumBytes, 64 * 1024 * 1024);
        return RESOURCE_BYTES;
      },
    }),
  });
  assert.equal(resource.binding.byteLength, RESOURCE_BYTES.byteLength);
  assert.equal(resource.source?.mediaType, "markdown");
  assert.equal(resource.source?.path, resource.binding.path);
  assert.deepEqual(
    Buffer.from((await resolveFoundationAtlasInspectionSource({
      query: selected,
      basis,
      reference: point.records[0]!.source,
    }))!),
    Buffer.from("Checkout body.\n", "utf8"),
  );
  assert.deepEqual(
    Buffer.from((await resolveFoundationAtlasInspectionSource({
      query: selected,
      basis,
      reference: resource.source!,
      owners: Object.freeze({ readBlob: async () => RESOURCE_BYTES }),
    }))!),
    RESOURCE_BYTES,
  );
});

test("Atlas compilers reject stale selections, unknown cursors, and substituted Resource bytes", async () => {
  const selected = query();
  const selectedGeneration = generation();
  const basis = compileFoundationContextBasis(selected, contextInspectionSelection(selected, selectedGeneration));
  const context = basis.selection;
  const selector = {
    kind: "atlas-overview" as const,
    context,
    afterMapCursor: null,
    mapLimit: 1,
    afterPointCursor: digest("unknown-cursor"),
    pointLimit: 1,
    afterResourceCursor: null,
    resourceLimit: 1,
  };
  assert.throws(
    () => compileFoundationAtlasOverviewInspection({ query: selected, basis, selector }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.context-inspection.atlas-cursor-unknown",
  );
  assert.throws(
    () => compileFoundationAtlasOverviewInspection({
      query: selected,
      basis,
      selector: {
        ...selector,
        afterPointCursor: null,
        context: createFoundationContextSelection({
          targetId: context.targetId,
          storeId: context.storeId,
          processId: context.processId,
          origin: { ...context.origin, digest: digest("substituted") },
          boundary: context.boundary,
        }),
      },
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.context-inspection.atlas-selection-substituted",
  );
  await assert.rejects(
    () => compileFoundationAtlasResourceInspection({
      query: selected,
      basis,
      selector: { kind: "atlas-resource", context, resourceId: "exact-resource" },
      owners: Object.freeze({
        readBlob: async () => Buffer.from("substituted\n", "utf8"),
      }),
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.context-inspection.atlas-resource-substituted",
  );
});
