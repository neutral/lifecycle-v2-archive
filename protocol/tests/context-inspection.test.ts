import assert from "node:assert/strict";
import test from "node:test";
import * as publicProtocol from "../src/foundation.js";
import * as inspectionContract from "../src/foundation/context-inspection.js";
import {
  FOUNDATION_SOURCE_PAGE_MAXIMUM_BYTES,
  FoundationContextInspectionSelectorSchema,
} from "../src/foundation/context-inspection.js";
import {
  basis,
  boundary,
  knowledgeReference,
  sourceReference,
  sha,
} from "./context-inspection-test-support.js";
import { createFoundationCodeSelection, digestFoundationInspectionCursor } from "../src/foundation/context-core.js";

test("Foundation publicly composes every bounded context inspection selector", () => {
  for (const name of [
    "FoundationContextBasisSchema",
    "FoundationKnowledgeIndexResultSchema",
    "FoundationCodeIndexResultSchema",
    "FoundationCodeFileResultSchema",
    "FoundationAtlasOverviewResultSchema",
    "FOUNDATION_ATLAS_RESULT_JSON_PROFILE",
    "selectFoundationAtlasResultJsonLimits",
    "FoundationSourceReferenceSchema",
    "FoundationAuthorizationReviewResultSchema",
  ]) {
    assert.equal(Object.hasOwn(publicProtocol, name), true, name);
  }
  assert.equal(Object.hasOwn(inspectionContract, "digestFoundationInspectionCursor"), true);
  assert.equal(Object.hasOwn(publicProtocol, "digestFoundationInspectionCursor"), true);
  assert.equal(publicProtocol.FOUNDATION_RUNTIME_PROTOCOL, "lifecycle.runtime.foundation.v17");
  assert.equal(publicProtocol.FOUNDATION_INTERFACE_PROTOCOL, "lifecycle.interface.foundation.v17");

  const context = basis();
  const selection = context.selection;
  const selectors = [
    { kind: "knowledge-index", context: selection, afterCursor: null, limit: 200 },
    { kind: "knowledge-record", context: selection, reference: knowledgeReference },
    {
      kind: "code-index",
      selection: createFoundationCodeSelection({ ...selection, subject: "candidate", boundary, candidate: null, seal: null }),
      subject: "candidate",
      afterCursor: null,
      limit: 200,
    },
    {
      kind: "code-file",
      selection: createFoundationCodeSelection({ ...selection, subject: "decision", boundary, candidate: null, seal: null }),
      subject: "decision",
      fileCursor: digestFoundationInspectionCursor({
        basisDigest: context.digest,
        collection: "code-files",
        key: { path: "src/file.ts" },
      }),
      maximumDiffBytes: 256 * 1024,
    },
    {
      kind: "atlas-overview",
      context: selection,
      afterMapCursor: null,
      mapLimit: 200,
      afterPointCursor: null,
      pointLimit: 200,
      afterResourceCursor: null,
      resourceLimit: 200,
    },
    {
      kind: "atlas-point",
      context: selection,
      pointCursor: digestFoundationInspectionCursor({
        basisDigest: context.digest,
        collection: "atlas-points",
        key: { id: "checkout" },
      }),
      afterRecordCursor: null,
      recordLimit: 100,
      afterRelationCursor: null,
      relationLimit: 200,
    },
    { kind: "atlas-resource", context: selection, resourceId: "checkout-source" },
    {
      kind: "source",
      reference: sourceReference({ context }),
      startByte: 0,
      maximumBytes: FOUNDATION_SOURCE_PAGE_MAXIMUM_BYTES,
    },
    {
      kind: "authorization-review",
      expectedGeneration: sha("a"),
      operation: "delivery.accept",
      input: null,
    },
  ];
  assert.deepEqual(
    selectors.map(({ kind }) => kind),
    [
      "knowledge-index",
      "knowledge-record",
      "code-index",
      "code-file",
      "atlas-overview",
      "atlas-point",
      "atlas-resource",
      "source",
      "authorization-review",
    ],
  );
  for (const selector of selectors) {
    assert.equal(FoundationContextInspectionSelectorSchema.safeParse(selector).success, true);
    assert.equal(publicProtocol.FoundationInspectQuerySchema.safeParse(selector).success, true);
  }
  assert.equal(FoundationContextInspectionSelectorSchema.safeParse({
    ...selectors[8]!,
    context: selection,
  }).success, false);
});
