import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { z } from "zod/v4";
import {
  FoundationDeliveryGenerationSchema,
  FoundationGitObjectSchema,
  FoundationOpaqueIdSchema,
  FoundationSha256Schema,
  canonicalFoundationJson,
  digestFoundationCanonical,
  selfDigestFoundationCarrier,
  type FoundationSha256,
} from "./core.js";
import {
  FoundationNonnegativeSafeIntegerSchema,
  FoundationPlainTextSchema,
  FoundationPositiveSafeIntegerSchema,
} from "./internal.js";

/** Private, unbarreled Foundation v11 context and source preparation. */

export const FOUNDATION_FUTURE_V11_CONTEXT_INDEX_LIMIT = 200;
export const FOUNDATION_FUTURE_V11_SOURCE_MAXIMUM_BYTES = 16 * 1024 * 1024;
export const FOUNDATION_FUTURE_V11_SOURCE_PAGE_MAXIMUM_BYTES = 256 * 1024;
export const FOUNDATION_FUTURE_V11_REPOSITORY_PATH_MAXIMUM_BYTES = 4_096;
export const FOUNDATION_FUTURE_V11_SOURCE_OWNER_IDENTITY_MAXIMUM_BYTES = 16 * 1024 * 1024;

export const FutureV11CursorSchema = FoundationSha256Schema.nullable();
export const FutureV11IndexLimitSchema = z.number().int().min(1)
  .max(FOUNDATION_FUTURE_V11_CONTEXT_INDEX_LIMIT);

export type FutureV11InspectionCursorCollection =
  | "knowledge-records"
  | "atlas-maps"
  | "atlas-points"
  | "atlas-resources"
  | "atlas-point-records"
  | "atlas-point-relations";

/** Compile one opaque, basis-bound cursor over an exact semantic row key. */
export function digestFutureV11InspectionCursor(input: Readonly<{
  basisDigest: FoundationSha256;
  collection: FutureV11InspectionCursorCollection;
  key: unknown;
}>): FoundationSha256 {
  return digestFoundationCanonical({
    schema: "lifecycle.context-inspection-cursor.v1",
    basisDigest: input.basisDigest,
    collection: input.collection,
    key: input.key,
  });
}

export function addFutureV11Issue(
  context: z.core.$RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  context.addIssue({ code: "custom", path: [...path], message, input: undefined });
}

export function sameFutureV11Value(left: unknown, right: unknown): boolean {
  return canonicalFoundationJson(left) === canonicalFoundationJson(right);
}

export function refineFutureV11SelfDigest(
  value: Readonly<Record<string, unknown>>,
  context: z.core.$RefinementCtx,
): void {
  if (value.digest !== selfDigestFoundationCarrier(value)) {
    addFutureV11Issue(context, ["digest"], "Self digest does not reproduce the complete carrier");
  }
}

function digestFutureV11Utf8(value: string): FoundationSha256 {
  return `sha256:${bytesToHex(sha256(utf8ToBytes(value)))}`;
}

export const FoundationFutureV11RepositoryRelativePathSchema = z.string().min(1)
  .refine((value) => {
    for (let index = 0; index < value.length; index += 1) {
      const unit = value.charCodeAt(index);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (next < 0xdc00 || next > 0xdfff) return false;
        index += 1;
      } else if (unit >= 0xdc00 && unit <= 0xdfff) {
        return false;
      }
    }
    return true;
  }, { message: "Repository path must contain only Unicode scalar values" })
  .refine(
    (value) => utf8ToBytes(value).byteLength <= FOUNDATION_FUTURE_V11_REPOSITORY_PATH_MAXIMUM_BYTES,
    { message: "Repository path exceeds its UTF-8 byte bound" },
  )
  .refine((value) => {
    const segments = value.split("/");
    return !value.startsWith("/") &&
      !value.includes("\u0000") &&
      !value.includes("\\") &&
      !value.includes("?") &&
      !value.includes("#") &&
      !/%(?:2f|5c)/iu.test(value) &&
      segments.every((segment) =>
        segment.length > 0 &&
        segment !== "." &&
        segment !== "..");
  }, { message: "Path must be one exact repository-relative path" });

export const FoundationFutureV11WorkBoundaryReferenceSchema = z.object({
  kind: z.literal("work-boundary"),
  id: FoundationOpaqueIdSchema,
  revision: FoundationPositiveSafeIntegerSchema,
  digest: FoundationSha256Schema,
}).strict();

export const FoundationFutureV11ContextSelectionSchema = z.object({
  expectedGeneration: FoundationSha256Schema,
  boundary: FoundationFutureV11WorkBoundaryReferenceSchema,
}).strict();

const FoundationFutureV11ContextRepositoryBasisSchema = z.object({
  repositorySnapshotDigest: FoundationSha256Schema,
  repositoryContractDigest: FoundationSha256Schema,
  canonicalCommit: FoundationGitObjectSchema,
  canonicalTree: FoundationGitObjectSchema,
  productStateDigest: FoundationSha256Schema,
  knowledgeSetDigest: FoundationSha256Schema,
  atlasStateDigest: FoundationSha256Schema,
  atlasResolutionDigest: FoundationSha256Schema,
  atlasNormalizedModelDigest: FoundationSha256Schema,
  atlasResourceBindingsDigest: FoundationSha256Schema,
  checkBindingSetDigest: FoundationSha256Schema,
}).strict();

export const FoundationFutureV11ContextBasisSchema = z.object({
  schema: z.literal("lifecycle.context-basis.v1"),
  generation: FoundationDeliveryGenerationSchema,
  boundary: z.object({
    role: z.enum(["proposed", "active"]),
    reference: FoundationFutureV11WorkBoundaryReferenceSchema,
  }).strict(),
  repository: FoundationFutureV11ContextRepositoryBasisSchema,
  digest: FoundationSha256Schema,
}).strict().superRefine(refineFutureV11SelfDigest);

const FoundationFutureV11SourceKindSchema = z.enum([
  "knowledge-body",
  "atlas-body",
  "atlas-resource",
  "canonical-blob",
  "candidate-blob",
]);

const FoundationFutureV11SourceOwnerIdentitySchema = z.string().min(1)
  .refine((value) => !value.includes("\u0000"), {
    message: "Source subject identity cannot contain NUL",
  })
  .refine(
    (value) => utf8ToBytes(value).byteLength <= FOUNDATION_FUTURE_V11_SOURCE_OWNER_IDENTITY_MAXIMUM_BYTES,
    { message: "Source subject identity exceeds its selected owner bound" },
  );

const FoundationFutureV11SourceSubjectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("knowledge-record"),
    id: FoundationOpaqueIdSchema,
    revision: FoundationPositiveSafeIntegerSchema,
    digest: FoundationSha256Schema,
  }).strict(),
  z.object({
    kind: z.literal("atlas-point"),
    id: FoundationFutureV11SourceOwnerIdentitySchema,
    digest: FoundationSha256Schema,
  }).strict(),
  z.object({
    kind: z.literal("atlas-resource"),
    id: FoundationFutureV11SourceOwnerIdentitySchema,
    digest: FoundationSha256Schema,
  }).strict(),
  z.object({
    kind: z.literal("repository-blob"),
    id: FoundationOpaqueIdSchema,
    digest: FoundationSha256Schema,
  }).strict(),
  z.object({
    kind: z.literal("candidate-revision"),
    id: FoundationOpaqueIdSchema,
    revision: FoundationPositiveSafeIntegerSchema,
    digest: FoundationSha256Schema,
  }).strict(),
]);

export const FoundationFutureV11SourceReferenceSchema = z.object({
  schema: z.literal("lifecycle.source-reference.v1"),
  generationDigest: FoundationSha256Schema,
  basisDigest: FoundationSha256Schema,
  sourceKind: FoundationFutureV11SourceKindSchema,
  subject: FoundationFutureV11SourceSubjectSchema,
  label: FoundationPlainTextSchema,
  path: FoundationFutureV11RepositoryRelativePathSchema,
  mediaType: z.enum(["markdown", "plain", "json"]),
  contentDigest: FoundationSha256Schema,
  byteLength: FoundationNonnegativeSafeIntegerSchema
    .max(FOUNDATION_FUTURE_V11_SOURCE_MAXIMUM_BYTES),
  digest: FoundationSha256Schema,
}).strict().superRefine((value, context) => {
  const expectedSubjectKinds = {
    "knowledge-body": "knowledge-record",
    "atlas-body": "atlas-point",
    "atlas-resource": "atlas-resource",
    "canonical-blob": "repository-blob",
    "candidate-blob": "candidate-revision",
  } as const;
  if (value.subject.kind !== expectedSubjectKinds[value.sourceKind]) {
    addFutureV11Issue(context, ["subject", "kind"], "Source kind and source subject kind disagree");
  }
  refineFutureV11SelfDigest(value, context);
});

export const FoundationFutureV11SourceSelectorSchema = z.object({
  kind: z.literal("source"),
  expectedGeneration: FoundationSha256Schema,
  reference: FoundationFutureV11SourceReferenceSchema,
  startByte: FoundationNonnegativeSafeIntegerSchema
    .max(FOUNDATION_FUTURE_V11_SOURCE_MAXIMUM_BYTES),
  maximumBytes: z.number().int().min(4)
    .max(FOUNDATION_FUTURE_V11_SOURCE_PAGE_MAXIMUM_BYTES),
}).strict().superRefine((value, context) => {
  if (value.expectedGeneration !== value.reference.generationDigest) {
    addFutureV11Issue(context, ["expectedGeneration"], "Source selection uses another read generation");
  }
  if (value.startByte > value.reference.byteLength) {
    addFutureV11Issue(context, ["startByte"], "Source range starts after the exact source bytes");
  }
});

export const FoundationFutureV11SourceResultSchema = z.object({
  schema: z.literal("lifecycle.source-range.v1"),
  basis: FoundationFutureV11ContextBasisSchema,
  reference: FoundationFutureV11SourceReferenceSchema,
  startByte: FoundationNonnegativeSafeIntegerSchema
    .max(FOUNDATION_FUTURE_V11_SOURCE_MAXIMUM_BYTES),
  endByte: FoundationNonnegativeSafeIntegerSchema
    .max(FOUNDATION_FUTURE_V11_SOURCE_MAXIMUM_BYTES),
  nextByte: FoundationNonnegativeSafeIntegerSchema
    .max(FOUNDATION_FUTURE_V11_SOURCE_MAXIMUM_BYTES).nullable(),
  byteLength: FoundationNonnegativeSafeIntegerSchema
    .max(FOUNDATION_FUTURE_V11_SOURCE_PAGE_MAXIMUM_BYTES),
  digest: FoundationSha256Schema,
  content: z.string().max(FOUNDATION_FUTURE_V11_SOURCE_PAGE_MAXIMUM_BYTES),
}).strict().superRefine((value, context) => {
  const encodedLength = utf8ToBytes(value.content).byteLength;
  if (value.reference.generationDigest !== value.basis.generation.digest) {
    addFutureV11Issue(context, ["reference", "generationDigest"], "Source result uses another read generation");
  }
  if (value.reference.basisDigest !== value.basis.digest) {
    addFutureV11Issue(context, ["reference", "basisDigest"], "Source result uses another context basis");
  }
  if (value.endByte < value.startByte || value.endByte - value.startByte !== value.byteLength) {
    addFutureV11Issue(context, ["endByte"], "Source range and declared byte length disagree");
  }
  if (encodedLength !== value.byteLength) {
    addFutureV11Issue(context, ["byteLength"], "Source content UTF-8 length does not reproduce the range");
  }
  if (digestFutureV11Utf8(value.content) !== value.digest) {
    addFutureV11Issue(context, ["digest"], "Source content digest does not reproduce the returned UTF-8 bytes");
  }
  if (value.endByte > value.reference.byteLength) {
    addFutureV11Issue(context, ["endByte"], "Source range exceeds the exact source bytes");
  }
  const expectedNext = value.endByte === value.reference.byteLength ? null : value.endByte;
  if (value.nextByte !== expectedNext) {
    addFutureV11Issue(context, ["nextByte"], "Source continuation does not match the exact returned range");
  }
  if (value.byteLength === 0 && value.startByte < value.reference.byteLength) {
    addFutureV11Issue(context, ["byteLength"], "A nonterminal Source page must make progress");
  }
});

export type FoundationFutureV11ContextSelection = z.output<typeof FoundationFutureV11ContextSelectionSchema>;
export type FoundationFutureV11ContextBasis = z.output<typeof FoundationFutureV11ContextBasisSchema>;
export type FoundationFutureV11SourceReference = z.output<typeof FoundationFutureV11SourceReferenceSchema>;
export type FoundationFutureV11SourceResult = z.output<typeof FoundationFutureV11SourceResultSchema>;
