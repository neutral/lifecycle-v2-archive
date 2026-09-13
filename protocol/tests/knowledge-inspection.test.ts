import assert from "node:assert/strict";
import test from "node:test";
import { FoundationInspectionResultSchema } from "../src/foundation.js";
import {
  FoundationKnowledgeIndexResultSchema,
  FoundationKnowledgeIndexSelectorSchema,
  FoundationKnowledgeRecordResultSchema,
  FoundationKnowledgeRecordSelectorSchema,
} from "../src/foundation/knowledge-inspection.js";
import { digestFoundationInspectionCursor } from "../src/foundation/context-core.js";
import {
  basis,
  knowledgeReference,
  rawDigest,
  sha,
  sourceReference,
} from "./context-inspection-test-support.js";

test("Knowledge selectors enforce bounds and strict exact references", () => {
  const context = basis();
  const selection = context.selection;
  const selector = { kind: "knowledge-index", context: selection, afterCursor: null };
  assert.equal(FoundationKnowledgeIndexSelectorSchema.safeParse({ ...selector, limit: 1 }).success, true);
  assert.equal(FoundationKnowledgeIndexSelectorSchema.safeParse({ ...selector, limit: 0 }).success, false);
  assert.equal(FoundationKnowledgeIndexSelectorSchema.safeParse({ ...selector, limit: 201 }).success, false);
  assert.equal(FoundationKnowledgeIndexSelectorSchema.safeParse({
    ...selector,
    limit: 10,
    extra: true,
  }).success, false);
  assert.equal(FoundationKnowledgeRecordSelectorSchema.safeParse({
    kind: "knowledge-record",
    context: selection,
    reference: { ...knowledgeReference, extra: true },
  }).success, false);
  assert.equal(FoundationKnowledgeRecordSelectorSchema.safeParse({
    kind: "knowledge-record",
    context: selection,
    reference: { ...knowledgeReference, id: "behavior.Invalid" },
  }).success, false);
});

test("Knowledge index exposes exact bounded UI rows", () => {
  const context = basis();
  const row = {
    cursor: digestFoundationInspectionCursor({
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
    kind: "knowledge-index",
    basis: context,
    records: [row],
    nextAfterCursor: null,
  };
  assert.equal(FoundationKnowledgeIndexResultSchema.safeParse(value).success, true);
  assert.equal(FoundationInspectionResultSchema.safeParse(value).success, true);
  assert.equal(FoundationKnowledgeIndexResultSchema.safeParse({
    ...value,
    records: [{ ...row, cursor: sha("1") }],
  }).success, false);
  assert.equal(FoundationKnowledgeIndexResultSchema.safeParse({
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
    cursor: digestFoundationInspectionCursor({
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
  assert.equal(FoundationKnowledgeIndexResultSchema.safeParse({
    ...value,
    records: [row, assuranceRow],
    nextAfterCursor: assuranceRow.cursor,
  }).success, true);
  assert.equal(FoundationKnowledgeIndexResultSchema.safeParse({
    ...value,
    records: [assuranceRow, row],
  }).success, false);
});

test("Knowledge record exposes kind-specific semantics and explicit unresolved relationships", () => {
  const context = basis();
  const normalizedBody = "# Idempotent checkout\n\nOne checkout intent has one stable result.\n";
  const value = {
    schema: "lifecycle.knowledge-record-inspection.v1",
    kind: "knowledge-record",
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
      actors: ["Director"],
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
    bodyRepresentation: "normalized-semantic-body",
    body: sourceReference({ context, content: normalizedBody }),
  };
  assert.equal(FoundationKnowledgeRecordResultSchema.safeParse(value).success, true);
  assert.equal(FoundationInspectionResultSchema.safeParse(value).success, true);
  assert.equal(value.body.contentDigest, rawDigest(normalizedBody));
  const authoredNewlineBody = normalizedBody.replaceAll("\n", "\r\n");
  assert.notEqual(value.body.contentDigest, rawDigest(authoredNewlineBody));
  assert.notEqual(
    value.body.contentDigest,
    rawDigest(`---\r\ntitle: Idempotent checkout\r\n---\r\n${authoredNewlineBody}`),
  );
  assert.equal(FoundationKnowledgeRecordResultSchema.safeParse({
    ...value,
    bodyRepresentation: "authored-source-text",
  }).success, false);
  const { bodyRepresentation: _omittedBodyRepresentation, ...withoutBodyRepresentation } = value;
  assert.equal(
    FoundationKnowledgeRecordResultSchema.safeParse(withoutBodyRepresentation).success,
    false,
  );
  assert.equal(FoundationKnowledgeRecordResultSchema.safeParse({
    ...value,
    relationships: [{
      ...value.relationships[0],
      target: { id: "behavior.payment", revision: 1, status: null, semanticDigest: sha("4") },
    }],
  }).success, false);
  assert.equal(FoundationKnowledgeRecordResultSchema.safeParse({
    ...value,
    relationships: [{ ...value.relationships[0], type: "depends-on", required: true }],
  }).success, false);
  const longReference = `https://example.invalid/${"a".repeat(5_000)}`;
  assert.equal(FoundationKnowledgeRecordResultSchema.safeParse({
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
  assert.equal(FoundationKnowledgeRecordResultSchema.safeParse({
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
  assert.equal(FoundationKnowledgeRecordResultSchema.safeParse({
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
  assert.equal(FoundationKnowledgeRecordResultSchema.safeParse({
    ...value,
    reference: revisionThreeReference,
    supersedes: { ...value.supersedes, revision: 1 },
    body: revisionThreeBody,
  }).success, false);
});

test("Discipline inspection preserves advisory meaning and exact body identity", () => {
  const context = basis();
  const reference = {
    ...knowledgeReference,
    id: "discipline.javascript.review",
    kind: "discipline",
    revision: 1,
    path: "records/disciplines/javascript-review.md",
  };
  const value = {
    schema: "lifecycle.knowledge-record-inspection.v1",
    kind: "knowledge-record",
    basis: context,
    reference,
    title: "Focused JavaScript review",
    summary: "Review the changed behavior with focused examples.",
    owners: ["publisher.example"],
    supersedes: null,
    tags: ["javascript"],
    spec: {
      practice: "Keep the review focused on the changed behavior.",
      appliesWhen: ["JavaScript development"],
      doesNotApplyWhen: [],
      guidance: ["Inspect the exact changed callers."],
      verification: [],
    },
    relationships: [],
    conflicts: [],
    sources: [],
    selectedByBoundary: true,
    bodyRepresentation: "normalized-semantic-body",
    body: sourceReference({ context, id: reference.id, path: reference.path, revision: 1 }),
  };
  assert.equal(FoundationInspectionResultSchema.safeParse(value).success, true);
  for (const mutation of [
    { owners: ["publisher.example", "another-owner"] },
    { body: sourceReference({ context, id: "discipline.javascript.other", path: reference.path, revision: 1 }) },
    { spec: { ...value.spec, obligation: "This advisory record must be obeyed" } },
    { relationships: [{
      type: "depends-on",
      target: { id: "behavior.payment", revision: 1, status: "current", semanticDigest: sha("3") },
      required: true, scope: null, rationale: null, digest: sha("4"),
    }] },
    { sources: [{
      id: "source.example", required: true, reference: "https://example.invalid/guidance", revision: null,
      digest: null, role: "research", resolution: { kind: "external", locator: null, objectId: null,
        resolvedDigest: null, disposition: "retrieval-denied" },
    }] },
  ]) {
    assert.equal(FoundationKnowledgeRecordResultSchema.safeParse({ ...value, ...mutation }).success, false);
  }
});
