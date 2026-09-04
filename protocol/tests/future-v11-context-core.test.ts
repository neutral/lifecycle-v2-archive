import assert from "node:assert/strict";
import test from "node:test";
import {
  FOUNDATION_FUTURE_V11_SOURCE_MAXIMUM_BYTES,
  FOUNDATION_FUTURE_V11_SOURCE_PAGE_MAXIMUM_BYTES,
  FoundationFutureV11ContextBasisSchema,
  FoundationFutureV11RepositoryRelativePathSchema,
  FoundationFutureV11SourceReferenceSchema,
  FoundationFutureV11SourceResultSchema,
  FoundationFutureV11SourceSelectorSchema,
} from "../src/foundation/future-v11-context-core.js";
import { selfDigestFoundationCarrier } from "../src/foundation/core.js";
import {
  basis,
  gitObject,
  rawDigest,
  sha,
  sourceReference,
} from "./future-v11-context-inspection-test-support.js";

test("source selection enforces generation, range, and page bounds", () => {
  const context = basis();
  const reference = sourceReference({ context });
  const source = { kind: "source", expectedGeneration: context.generation.digest, reference, startByte: 0 };
  assert.equal(FoundationFutureV11SourceSelectorSchema.safeParse({ ...source, maximumBytes: 3 }).success, false);
  assert.equal(FoundationFutureV11SourceSelectorSchema.safeParse({
    ...source,
    maximumBytes: FOUNDATION_FUTURE_V11_SOURCE_PAGE_MAXIMUM_BYTES + 1,
  }).success, false);
  assert.equal(FoundationFutureV11SourceSelectorSchema.safeParse({
    ...source,
    startByte: FOUNDATION_FUTURE_V11_SOURCE_MAXIMUM_BYTES + 1,
    maximumBytes: 4,
  }).success, false);
  assert.equal(FoundationFutureV11SourceSelectorSchema.safeParse({
    ...source,
    expectedGeneration: sha("0"),
    maximumBytes: 64,
  }).success, false);
});

test("repository paths preserve exact allowed Git identity and refuse unsafe aliases", () => {
  assert.equal(FoundationFutureV11RepositoryRelativePathSchema.parse("src/exact-file.ts"), "src/exact-file.ts");
  for (const path of [
    "src/line\nfile.ts",
    "src/e\u0301.ts",
    ".git/config",
    "src/literal%20name.ts",
    "src/literal%00name.ts",
  ]) {
    assert.equal(FoundationFutureV11RepositoryRelativePathSchema.parse(path), path);
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
  ]) {
    assert.equal(FoundationFutureV11RepositoryRelativePathSchema.safeParse(path).success, false, path);
  }
});

test("context bases separate live generation from historical truth and reject substitution", () => {
  const context = basis();
  assert.deepEqual(FoundationFutureV11ContextBasisSchema.parse(context), context);
  assert.equal(FoundationFutureV11ContextBasisSchema.safeParse({
    ...context,
    repository: { ...context.repository, knowledgeSetDigest: sha("0") },
  }).success, false);
  const advancedLiveGenerationSubject = {
    ...context,
    generation: {
      ...context.generation,
      repository: {
        headCommit: gitObject("0"),
        headTree: gitObject("1"),
        repositoryContractDigest: sha("0"),
      },
    },
  };
  const advancedLiveGeneration = {
    ...advancedLiveGenerationSubject,
    digest: selfDigestFoundationCarrier(advancedLiveGenerationSubject),
  };
  assert.equal(FoundationFutureV11ContextBasisSchema.safeParse(advancedLiveGeneration).success, true);

  const source = sourceReference({ context });
  assert.deepEqual(FoundationFutureV11SourceReferenceSchema.parse(source), source);
  assert.equal(FoundationFutureV11SourceReferenceSchema.safeParse({ ...source, basisDigest: sha("0") }).success, false);
  const substituted = { ...source, subject: { ...source.subject, kind: "atlas-point" as const } };
  assert.equal(FoundationFutureV11SourceReferenceSchema.safeParse({
    ...substituted,
    digest: selfDigestFoundationCarrier(substituted),
  }).success, false);

  const longAtlasId = `a${"b".repeat(600)}`;
  const longAtlasSubject = sourceReference({
    context,
    sourceKind: "atlas-body",
    id: longAtlasId,
    subjectDigest: sha("2"),
  });
  assert.equal(FoundationFutureV11SourceReferenceSchema.safeParse(longAtlasSubject).success, true);
});

test("source ranges bind exact UTF-8 bytes, reference, and continuation", () => {
  const context = basis();
  const content = "éxact\n";
  const reference = sourceReference({ context, content });
  assert.equal(FoundationFutureV11SourceSelectorSchema.safeParse({
    kind: "source",
    expectedGeneration: context.generation.digest,
    reference,
    startByte: reference.byteLength + 1,
    maximumBytes: 64,
  }).success, false);

  const valid = {
    schema: "lifecycle.source-range.v1",
    basis: context,
    reference,
    startByte: 0,
    endByte: Buffer.byteLength(content, "utf8"),
    nextByte: null,
    byteLength: Buffer.byteLength(content, "utf8"),
    digest: rawDigest(content),
    content,
  };
  assert.equal(FoundationFutureV11SourceResultSchema.safeParse(valid).success, true);
  assert.equal(FoundationFutureV11SourceResultSchema.safeParse({ ...valid, byteLength: content.length }).success, false);
  assert.equal(FoundationFutureV11SourceResultSchema.safeParse({ ...valid, digest: sha("0") }).success, false);
  assert.equal(FoundationFutureV11SourceResultSchema.safeParse({ ...valid, endByte: valid.endByte - 1 }).success, false);
  assert.equal(FoundationFutureV11SourceResultSchema.safeParse({ ...valid, nextByte: 1 }).success, false);
  assert.equal(FoundationFutureV11SourceResultSchema.safeParse({ ...valid, basis: basis("active", sha("0")) }).success, false);
});

test("core source carriers reject unknown fields", () => {
  assert.equal(FoundationFutureV11SourceReferenceSchema.safeParse({
    ...sourceReference(),
    extra: true,
  }).success, false);
});
