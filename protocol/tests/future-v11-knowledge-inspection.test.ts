import assert from "node:assert/strict";
import test from "node:test";
import {
  FoundationFutureV11KnowledgeIndexResultSchema,
  FoundationFutureV11KnowledgeIndexSelectorSchema,
  FoundationFutureV11KnowledgeRecordResultSchema,
  FoundationFutureV11KnowledgeRecordSelectorSchema,
} from "../src/foundation/future-v11-knowledge-inspection.js";
import { digestFutureV11InspectionCursor } from "../src/foundation/future-v11-context-core.js";
import {
  basis,
  boundary,
  knowledgeReference,
  sha,
  sourceReference,
} from "./future-v11-context-inspection-test-support.js";

test("Knowledge selectors enforce bounds and strict exact references", () => {
  const context = basis();
  const selection = { expectedGeneration: context.generation.digest, boundary };
  const selector = { kind: "knowledge-index", context: selection, afterCursor: null };
  assert.equal(FoundationFutureV11KnowledgeIndexSelectorSchema.safeParse({ ...selector, limit: 1 }).success, true);
  assert.equal(FoundationFutureV11KnowledgeIndexSelectorSchema.safeParse({ ...selector, limit: 0 }).success, false);
  assert.equal(FoundationFutureV11KnowledgeIndexSelectorSchema.safeParse({ ...selector, limit: 201 }).success, false);
  assert.equal(FoundationFutureV11KnowledgeIndexSelectorSchema.safeParse({
    ...selector,
    limit: 10,
    extra: true,
  }).success, false);
  assert.equal(FoundationFutureV11KnowledgeRecordSelectorSchema.safeParse({
    kind: "knowledge-record",
    context: selection,
    reference: { ...knowledgeReference, extra: true },
  }).success, false);
  assert.equal(FoundationFutureV11KnowledgeRecordSelectorSchema.safeParse({
    kind: "knowledge-record",
    context: selection,
    reference: { ...knowledgeReference, id: "behavior.Invalid" },
  }).success, false);
});

test("Knowledge index exposes exact bounded UI rows", () => {
  const context = basis();
  const row = {
    cursor: digestFutureV11InspectionCursor({
      basisDigest: context.digest,
      collection: "knowledge-records",
      key: {
        kind: knowledgeReference.kind,
        id: knowledgeReference.id,
        revision: knowledgeReference.revision,
      },
    }),
    reference: knowledgeReference,
    title: "Idempotent checkout",
    summary: "Checkout can be repeated without changing the result.",
    owners: ["team/platform@checkout"],
    tags: ["checkout"],
    selectedByBoundary: true,
  };
  const value = {
    schema: "lifecycle.knowledge-index.v1",
    basis: context,
    records: [row],
    nextAfterCursor: null,
  };
  assert.equal(FoundationFutureV11KnowledgeIndexResultSchema.safeParse(value).success, true);
  assert.equal(FoundationFutureV11KnowledgeIndexResultSchema.safeParse({
    ...value,
    records: [{ ...row, cursor: sha("1") }],
  }).success, false);
  assert.equal(FoundationFutureV11KnowledgeIndexResultSchema.safeParse({
    ...value,
    nextAfterCursor: sha("1"),
  }).success, false);

  const assuranceReference = {
    ...knowledgeReference,
    id: "assurance.checkout.safety",
    kind: "assurance" as const,
    revision: 1,
  };
  const assuranceRow = {
    ...row,
    cursor: digestFutureV11InspectionCursor({
      basisDigest: context.digest,
      collection: "knowledge-records",
      key: {
        kind: assuranceReference.kind,
        id: assuranceReference.id,
        revision: assuranceReference.revision,
      },
    }),
    reference: assuranceReference,
  };
  assert.equal(FoundationFutureV11KnowledgeIndexResultSchema.safeParse({
    ...value,
    records: [row, assuranceRow],
    nextAfterCursor: assuranceRow.cursor,
  }).success, true);
  assert.equal(FoundationFutureV11KnowledgeIndexResultSchema.safeParse({
    ...value,
    records: [assuranceRow, row],
  }).success, false);
});

test("Knowledge record exposes kind-specific semantics and explicit unresolved relationships", () => {
  const context = basis();
  const value = {
    schema: "lifecycle.knowledge-record-inspection.v1",
    basis: context,
    reference: knowledgeReference,
    title: "Idempotent checkout",
    summary: "Checkout can be repeated without changing the result.",
    owners: ["team/platform@checkout"],
    supersedes: {
      id: knowledgeReference.id,
      revision: 1,
      sourceDigest: sha("1"),
      semanticDigest: sha("2"),
    },
    tags: ["checkout"],
    spec: {
      outcome: "One checkout intent has one stable result.",
      actors: ["Founder"],
      conditions: [],
      included: ["Equivalent retries"],
      excluded: [],
      examples: [],
      falsifiers: ["A retry produces another result"],
    },
    relationships: [{
      type: "related-to",
      target: { id: "behavior.payment", revision: null, status: null, semanticDigest: null },
      required: false,
      scope: null,
      rationale: null,
      digest: sha("3"),
    }],
    conflicts: [],
    sources: [],
    selectedByBoundary: true,
    body: sourceReference({ context }),
  };
  assert.equal(FoundationFutureV11KnowledgeRecordResultSchema.safeParse(value).success, true);
  assert.equal(FoundationFutureV11KnowledgeRecordResultSchema.safeParse({
    ...value,
    relationships: [{
      ...value.relationships[0],
      target: { id: "behavior.payment", revision: 1, status: null, semanticDigest: sha("4") },
    }],
  }).success, false);
  assert.equal(FoundationFutureV11KnowledgeRecordResultSchema.safeParse({
    ...value,
    relationships: [{ ...value.relationships[0], type: "depends-on", required: true }],
  }).success, false);
  const longReference = `https://example.invalid/${"a".repeat(5_000)}`;
  assert.equal(FoundationFutureV11KnowledgeRecordResultSchema.safeParse({
    ...value,
    sources: [{
      id: "source.one",
      required: true,
      reference: longReference,
      revision: "revision.one",
      digest: sha("5"),
      role: "research",
      resolution: {
        kind: "repository",
        locator: "sources/research.txt",
        objectId: "a".repeat(40),
        resolvedDigest: sha("5"),
        disposition: "resolved",
      },
    }],
  }).success, true);
  assert.equal(FoundationFutureV11KnowledgeRecordResultSchema.safeParse({
    ...value,
    sources: [{
      id: "source.one",
      required: false,
      reference: "https://example.invalid/has whitespace",
      revision: null,
      digest: null,
      role: "research",
      resolution: {
        kind: "external",
        locator: null,
        objectId: null,
        resolvedDigest: null,
        disposition: "retrieval-denied",
      },
    }],
  }).success, false);
  assert.equal(FoundationFutureV11KnowledgeRecordResultSchema.safeParse({
    ...value,
    conflicts: [{
      type: "assurance-limit",
      leftId: "assurance.unrelated-left",
      leftRevision: 1,
      leftFact: "Left",
      rightId: "assurance.unrelated-right",
      rightRevision: 1,
      rightFact: "Right",
      digest: sha("6"),
    }],
  }).success, false);

  const revisionThreeReference = { ...knowledgeReference, revision: 3 };
  const revisionThreeBody = sourceReference({ context, revision: 3 });
  assert.equal(FoundationFutureV11KnowledgeRecordResultSchema.safeParse({
    ...value,
    reference: revisionThreeReference,
    supersedes: { ...value.supersedes, revision: 1 },
    body: revisionThreeBody,
  }).success, false);
});
