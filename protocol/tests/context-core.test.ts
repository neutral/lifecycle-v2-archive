import assert from "node:assert/strict";
import test from "node:test";
import { FoundationInspectionResultSchema } from "../src/foundation.js";
import {
  FOUNDATION_SOURCE_MAXIMUM_BYTES,
  FOUNDATION_SOURCE_PAGE_MAXIMUM_BYTES,
  FoundationContextBasisSchema,
  FoundationContextSelectionSchema,
  FoundationCodeSelectionSchema,
  createFoundationCodeSelection,
  FoundationRepositoryRelativePathSchema,
  FoundationSourceReferenceSchema,
  FoundationSourceResultSchema,
  FoundationSourceSelectorSchema,
} from "../src/foundation/context-core.js";
import { selfDigestFoundationCarrier } from "../src/foundation/core.js";
import {
  basis,
  gitObject,
  rawDigest,
  sha,
  sourceReference,
} from "./context-inspection-test-support.js";

test("source selection enforces retained identity, range, and page bounds", () => {
  const context = basis();
  const reference = sourceReference({ context });
  const source = { kind: "source", reference, startByte: 0 };
  assert.equal(FoundationSourceSelectorSchema.safeParse({ ...source, maximumBytes: 3 }).success, false);
  assert.equal(FoundationSourceSelectorSchema.safeParse({
    ...source,
    maximumBytes: FOUNDATION_SOURCE_PAGE_MAXIMUM_BYTES + 1,
  }).success, false);
  assert.equal(FoundationSourceSelectorSchema.safeParse({
    ...source,
    startByte: FOUNDATION_SOURCE_MAXIMUM_BYTES + 1,
    maximumBytes: 4,
  }).success, false);
  assert.equal(FoundationSourceSelectorSchema.safeParse({
    ...source,
    expectedGeneration: sha("0"),
    maximumBytes: 64,
  }).success, false);
});

test("inspection provenance has exact identity, origin and subject domains independent of operation currency", () => {
  const context = basis().selection;
  assert.deepEqual(FoundationContextSelectionSchema.parse(context), context);
  for (const field of ["targetId", "storeId", "processId", "boundary", "origin"]) {
    const value = { ...context, [field]: field === "origin" ? { sequence: 0, digest: sha("a") } : null };
    assert.equal(FoundationContextSelectionSchema.safeParse({ ...value, digest: selfDigestFoundationCarrier(value) }).success, false, field);
  }
  assert.equal(FoundationContextSelectionSchema.safeParse({ ...context, expectedGeneration: sha("0") }).success, false);
  const candidate = { kind: "candidate-revision" as const, id: "candidate.one", revision: 1, digest: sha("c") };
  const code = createFoundationCodeSelection({ ...context, boundary: context.boundary.reference, subject: "candidate", candidate, seal: null });
  assert.deepEqual(FoundationCodeSelectionSchema.parse(code), code);
  for (const replacement of [
    { boundary: null },
    { seal: { kind: "candidate-seal" as const, id: "seal.one", revision: 1, digest: sha("d") } },
    { origin: { sequence: context.origin.sequence, digest: sha("0") } },
  ]) {
    assert.equal(FoundationCodeSelectionSchema.safeParse({ ...code, ...replacement }).success, false);
  }
  const missingSubject = createFoundationCodeSelection({ ...code, candidate: null });
  const source = sourceReference({ sourceKind: "canonical-blob", id: gitObject("6"), selection: missingSubject });
  assert.doesNotThrow(() => FoundationSourceReferenceSchema.safeParse(source));
  assert.equal(FoundationSourceReferenceSchema.safeParse(source).success, false, "Unavailable selection cannot mint a readable Code Source");
});

test("repository paths preserve exact allowed Git identity and refuse unsafe aliases", () => {
  assert.equal(FoundationRepositoryRelativePathSchema.parse("src/exact-file.ts"), "src/exact-file.ts");
  for (const path of [
    "src/line\nfile.ts",
    "src/e\u0301.ts",
    ".git/config",
    "src/literal%20name.ts",
    "src/literal%00name.ts",
  ]) {
    assert.equal(FoundationRepositoryRelativePathSchema.parse(path), path);
  }
  for (const path of [
    "/src/file.ts",
    "../src/file.ts",
    "src/./file.ts",
    "src//file.ts",
    "src\\file.ts",
    "src/%2f/file.ts",
    "src/file?.ts",
    "src/%5c/file.ts",
    "src/nul\u0000file.ts",
    "src/unpaired-\ud800.ts",
    "src/unpaired-final-\ud800",
  ]) {
    assert.equal(FoundationRepositoryRelativePathSchema.safeParse(path).success, false, path);
  }
});

test("context bases separate live generation from historical truth and reject substitution", () => {
  const context = basis();
  assert.deepEqual(FoundationContextBasisSchema.parse(context), context);
  assert.equal(FoundationContextBasisSchema.safeParse({
    ...context,
    repository: { ...context.repository, knowledgeSetDigest: sha("0") },
  }).success, false);
  assert.equal(FoundationContextBasisSchema.safeParse({
    ...context, generation: { digest: sha("0") },
  }).success, false, "Live observations are outside the immutable basis");
  const replacedOrigin = {
    ...context.selection, origin: { sequence: 1, digest: sha("0") },
  };
  const replacedBasis = { ...context, selection: replacedOrigin };
  assert.equal(FoundationContextBasisSchema.safeParse({
    ...replacedBasis, digest: selfDigestFoundationCarrier(replacedBasis),
  }).success, false, "Rehashing the outer basis cannot replace the selected provenance");

  const source = sourceReference({ context });
  assert.deepEqual(FoundationSourceReferenceSchema.parse(source), source);
  assert.equal(FoundationSourceReferenceSchema.safeParse({ ...source, basisDigest: sha("0") }).success, false);
  const substituted = { ...source, subject: { ...source.subject, kind: "atlas-point" as const } };
  assert.equal(FoundationSourceReferenceSchema.safeParse({
    ...substituted,
    digest: selfDigestFoundationCarrier(substituted),
  }).success, false);

  const atlasSubject = sourceReference({
    context,
    sourceKind: "atlas-body",
    subjectDigest: sha("2"),
  });
  assert.deepEqual(atlasSubject.subject, { kind: "atlas-point", digest: sha("2") });
  assert.equal(FoundationSourceReferenceSchema.safeParse(atlasSubject).success, true);
  const repeatedPointIdentity = {
    ...atlasSubject,
    subject: { ...atlasSubject.subject, id: "a".repeat(600) },
  };
  assert.equal(FoundationSourceReferenceSchema.safeParse({
    ...repeatedPointIdentity,
    digest: selfDigestFoundationCarrier(repeatedPointIdentity),
  }).success, false);

  const invalidKnowledgeIdentity = {
    ...source,
    subject: { ...source.subject, id: "knowledge.record.alias" },
  };
  assert.equal(FoundationSourceReferenceSchema.safeParse({
    ...invalidKnowledgeIdentity,
    digest: selfDigestFoundationCarrier(invalidKnowledgeIdentity),
  }).success, false);

  const atlasResource = sourceReference({
    context,
    sourceKind: "atlas-resource",
    id: "registered-resource",
  });
  assert.equal(FoundationSourceReferenceSchema.safeParse(atlasResource).success, true);
  const invalidResourceIdentity = {
    ...atlasResource,
    subject: { ...atlasResource.subject, id: "Registered-Resource" },
  };
  assert.equal(FoundationSourceReferenceSchema.safeParse({
    ...invalidResourceIdentity,
    digest: selfDigestFoundationCarrier(invalidResourceIdentity),
  }).success, false);

  const repositoryBlob = sourceReference({
    context,
    sourceKind: "canonical-blob",
    id: gitObject("6"),
  });
  assert.equal(FoundationSourceReferenceSchema.safeParse(repositoryBlob).success, true);
  const invalidBlobIdentity = {
    ...repositoryBlob,
    subject: { ...repositoryBlob.subject, id: "blob.alias" },
  };
  assert.equal(FoundationSourceReferenceSchema.safeParse({
    ...invalidBlobIdentity,
    digest: selfDigestFoundationCarrier(invalidBlobIdentity),
  }).success, false);
});

test("source ranges bind exact UTF-8 bytes, reference, and continuation", () => {
  const context = basis();
  const content = "éxact\n";
  const reference = sourceReference({ context, content });
  assert.equal(FoundationSourceSelectorSchema.safeParse({
    kind: "source",
    reference,
    startByte: reference.byteLength + 1,
    maximumBytes: 64,
  }).success, false);

  const valid = {
    schema: "lifecycle.source-range.v1",
    kind: "source",
    basis: context,
    reference,
    startByte: 0,
    endByte: Buffer.byteLength(content, "utf8"),
    nextByte: null,
    byteLength: Buffer.byteLength(content, "utf8"),
    digest: rawDigest(content),
    content,
  };
  assert.equal(FoundationSourceResultSchema.safeParse(valid).success, true);
  assert.equal(FoundationInspectionResultSchema.safeParse(valid).success, true);
  assert.equal(FoundationSourceResultSchema.safeParse({ ...valid, byteLength: content.length }).success, false);
  assert.equal(FoundationSourceResultSchema.safeParse({ ...valid, digest: sha("0") }).success, false);
  assert.equal(FoundationSourceResultSchema.safeParse({ ...valid, endByte: valid.endByte - 1 }).success, false);
  assert.equal(FoundationSourceResultSchema.safeParse({ ...valid, nextByte: 1 }).success, false);
  assert.equal(FoundationSourceResultSchema.safeParse({ ...valid, basis: basis("active", sha("0")) }).success, false);
});

test("core source carriers reject unknown fields", () => {
  assert.equal(FoundationSourceReferenceSchema.safeParse({
    ...sourceReference(),
    extra: true,
  }).success, false);
});
