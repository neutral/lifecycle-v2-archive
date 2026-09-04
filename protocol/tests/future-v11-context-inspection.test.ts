import assert from "node:assert/strict";
import test from "node:test";
import * as publicProtocol from "../src/foundation.js";
import * as futureInspection from "../src/foundation/future-v11-context-inspection.js";
import {
  FOUNDATION_FUTURE_V11_SOURCE_PAGE_MAXIMUM_BYTES,
  FoundationFutureV11ContextInspectionSelectorSchema,
} from "../src/foundation/future-v11-context-inspection.js";
import {
  basis,
  boundary,
  knowledgeReference,
  sourceReference,
} from "./future-v11-context-inspection-test-support.js";

test("future v11 preparation remains private and composes every inspect selector", () => {
  for (const name of [
    "FoundationFutureV11ContextBasisSchema",
    "FoundationFutureV11KnowledgeIndexResultSchema",
    "FoundationFutureV11AtlasOverviewResultSchema",
    "FoundationFutureV11SourceReferenceSchema",
    "FoundationFutureV11AuthorizationReviewResultSchema",
  ]) {
    assert.equal(Object.hasOwn(publicProtocol, name), false);
  }
  assert.equal(Object.hasOwn(futureInspection, "digestFutureV11InspectionCursor"), false);
  assert.equal(publicProtocol.FOUNDATION_RUNTIME_PROTOCOL, "lifecycle.runtime.foundation.v10");
  assert.equal(publicProtocol.FOUNDATION_INTERFACE_PROTOCOL, "lifecycle.interface.foundation.v10");

  const context = basis();
  const selection = { expectedGeneration: context.generation.digest, boundary };
  const selectors = [
    { kind: "knowledge-index", context: selection, afterCursor: null, limit: 200 },
    { kind: "knowledge-record", context: selection, reference: knowledgeReference },
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
      pointId: "checkout",
      afterRecordCursor: null,
      recordLimit: 100,
      afterRelationCursor: null,
      relationLimit: 200,
    },
    { kind: "atlas-resource", context: selection, resourceId: "checkout-source" },
    {
      kind: "source",
      expectedGeneration: context.generation.digest,
      reference: sourceReference({ context }),
      startByte: 0,
      maximumBytes: FOUNDATION_FUTURE_V11_SOURCE_PAGE_MAXIMUM_BYTES,
    },
    {
      kind: "authorization-review",
      expectedGeneration: context.generation.digest,
      operation: "delivery.accept",
      input: null,
    },
  ];
  assert.deepEqual(
    selectors.map(({ kind }) => kind),
    [
      "knowledge-index",
      "knowledge-record",
      "atlas-overview",
      "atlas-point",
      "atlas-resource",
      "source",
      "authorization-review",
    ],
  );
  for (const selector of selectors) {
    assert.equal(FoundationFutureV11ContextInspectionSelectorSchema.safeParse(selector).success, true);
  }
  assert.equal(FoundationFutureV11ContextInspectionSelectorSchema.safeParse({
    ...selectors[6]!,
    context: selection,
  }).success, false);
});
