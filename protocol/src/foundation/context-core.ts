import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { z } from "zod/v4";
import {
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

/** Shared Foundation context and source inspection contracts. */

export const FOUNDATION_CONTEXT_INDEX_LIMIT = 200;
export const FOUNDATION_SOURCE_MAXIMUM_BYTES = 16 * 1024 * 1024;
export const FOUNDATION_SOURCE_PAGE_MAXIMUM_BYTES = 256 * 1024;
export const FOUNDATION_REPOSITORY_PATH_MAXIMUM_BYTES = 4_096;

export const FoundationCursorSchema = FoundationSha256Schema.nullable();
export const FoundationIndexLimitSchema = z.number().int().min(1)
  .max(FOUNDATION_CONTEXT_INDEX_LIMIT);

export type FoundationInspectionCursorCollection =
  | "knowledge-records"
  | "code-files"
  | "atlas-maps"
  | "atlas-points"
  | "atlas-resources"
  | "atlas-point-records"
  | "atlas-point-relations";

/** Compile one opaque, basis-bound cursor over an exact semantic row key. */
export function digestFoundationInspectionCursor(input: Readonly<{
  basisDigest: FoundationSha256;
  collection: FoundationInspectionCursorCollection;
  key: unknown;
}>): FoundationSha256 {
  return digestFoundationCanonical({
    schema: "lifecycle.context-inspection-cursor.v1",
    basisDigest: input.basisDigest,
    collection: input.collection,
    key: input.key,
  });
}

export function addFoundationIssue(
  context: z.core.$RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  context.addIssue({ code: "custom", path: [...path], message, input: undefined });
}

export function sameFoundationValue(left: unknown, right: unknown): boolean {
  return canonicalFoundationJson(left) === canonicalFoundationJson(right);
}

export function refineFoundationSelfDigest(
  value: Readonly<Record<string, unknown>>,
  context: z.core.$RefinementCtx,
): void {
  if (value.digest !== selfDigestFoundationCarrier(value)) {
    addFoundationIssue(context, ["digest"], "Self digest does not reproduce the complete carrier");
  }
}

function digestFoundationUtf8(value: string): FoundationSha256 {
  return `sha256:${bytesToHex(sha256(utf8ToBytes(value)))}`;
}

export const FoundationRepositoryRelativePathSchema = z.string().min(1)
  .refine((value) => {
    for (let index = 0; index < value.length; index += 1) {
      const unit = value.charCodeAt(index);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        if (index + 1 >= value.length) return false;
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
    (value) => utf8ToBytes(value).byteLength <= FOUNDATION_REPOSITORY_PATH_MAXIMUM_BYTES,
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

export const FoundationWorkBoundaryReferenceSchema = z.object({
  kind: z.literal("work-boundary"),
  id: FoundationOpaqueIdSchema,
  revision: FoundationPositiveSafeIntegerSchema,
  digest: FoundationSha256Schema,
}).strict();

const FoundationInspectionIdentityShape = {
  targetId: FoundationOpaqueIdSchema,
  storeId: FoundationOpaqueIdSchema,
  processId: FoundationOpaqueIdSchema,
  origin: z.object({
    sequence: FoundationPositiveSafeIntegerSchema,
    digest: FoundationSha256Schema,
  }).strict(),
};

const FoundationInspectionBoundarySchema = z.object({
  role: z.enum(["proposed", "active"]),
  reference: FoundationWorkBoundaryReferenceSchema,
}).strict();

export const FoundationCandidateInspectionReferenceSchema = z.object({
  kind: z.literal("candidate-revision"),
  id: FoundationOpaqueIdSchema,
  revision: FoundationPositiveSafeIntegerSchema,
  digest: FoundationSha256Schema,
}).strict();

export const FoundationSealInspectionReferenceSchema = z.object({
  kind: z.literal("candidate-seal"),
  id: FoundationOpaqueIdSchema,
  revision: FoundationPositiveSafeIntegerSchema,
  digest: FoundationSha256Schema,
}).strict();

/** Origin is retained provenance, not the latest operation generation. */
export const FoundationContextSelectionSchema = z.object({
  schema: z.literal("lifecycle.context-selection.v1"),
  ...FoundationInspectionIdentityShape,
  boundary: FoundationInspectionBoundarySchema,
  digest: FoundationSha256Schema,
}).strict().superRefine(refineFoundationSelfDigest);

export const FoundationCodeSelectionSchema = z.object({
  schema: z.literal("lifecycle.code-selection.v1"),
  ...FoundationInspectionIdentityShape,
  subject: z.enum(["candidate", "decision"]),
  boundary: FoundationWorkBoundaryReferenceSchema.nullable(),
  candidate: FoundationCandidateInspectionReferenceSchema.nullable(),
  seal: FoundationSealInspectionReferenceSchema.nullable(),
  digest: FoundationSha256Schema,
}).strict().superRefine((value, context) => {
  if (value.candidate !== null && value.boundary === null) {
    addFoundationIssue(context, ["boundary"], "A Candidate selection requires its governing Boundary");
  }
  if ((value.subject === "candidate" || value.candidate === null) && value.seal !== null) {
    addFoundationIssue(context, ["seal"], "This Code selection cannot select a Seal");
  }
  refineFoundationSelfDigest(value, context);
});

export const FoundationInspectionSelectionSchema = z.discriminatedUnion("schema", [
  FoundationContextSelectionSchema, FoundationCodeSelectionSchema,
]);

export function createFoundationContextSelection(
  input: Omit<z.output<typeof FoundationContextSelectionSchema>, "schema" | "digest">,
): z.output<typeof FoundationContextSelectionSchema> {
  const body = { ...input, schema: "lifecycle.context-selection.v1" as const };
  return FoundationContextSelectionSchema.parse({ ...body, digest: selfDigestFoundationCarrier(body) });
}

export function createFoundationCodeSelection(
  input: Omit<z.output<typeof FoundationCodeSelectionSchema>, "schema" | "digest">,
): z.output<typeof FoundationCodeSelectionSchema> {
  const body = { ...input, schema: "lifecycle.code-selection.v1" as const };
  return FoundationCodeSelectionSchema.parse({ ...body, digest: selfDigestFoundationCarrier(body) });
}

export function foundationContextSelectionOf(
  selection: z.output<typeof FoundationInspectionSelectionSchema>,
): z.output<typeof FoundationContextSelectionSchema> {
  if (selection.schema === "lifecycle.context-selection.v1") return selection;
  if (selection.boundary === null) throw new TypeError("Code without a Boundary has no Context basis");
  return createFoundationContextSelection({
    targetId: selection.targetId, storeId: selection.storeId, processId: selection.processId,
    origin: selection.origin, boundary: { role: "active", reference: selection.boundary },
  });
}

const FoundationContextRepositoryBasisSchema = z.object({
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

export const FoundationContextBasisSchema = z.object({
  schema: z.literal("lifecycle.context-basis.v2"),
  selection: FoundationContextSelectionSchema,
  repository: FoundationContextRepositoryBasisSchema,
  digest: FoundationSha256Schema,
}).strict().superRefine(refineFoundationSelfDigest);

const FoundationSourceKindSchema = z.enum([
  "knowledge-body",
  "atlas-body",
  "atlas-resource",
  "canonical-blob",
  "candidate-blob",
]);

const FoundationKnowledgeSourceIdentitySchema = z.string().min(1).max(160)
  .regex(/^(?:behavior|assurance|blueprint|description|check|discipline)(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/u);
const FoundationAtlasResourceSourceIdentitySchema = z.string().min(1).max(160)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u);

const FoundationSourceSubjectSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("knowledge-record"),
    id: FoundationKnowledgeSourceIdentitySchema,
    revision: FoundationPositiveSafeIntegerSchema,
    digest: FoundationSha256Schema,
  }).strict(),
  z.object({
    kind: z.literal("atlas-point"),
    digest: FoundationSha256Schema,
  }).strict(),
  z.object({
    kind: z.literal("atlas-resource"),
    id: FoundationAtlasResourceSourceIdentitySchema,
    digest: FoundationSha256Schema,
  }).strict(),
  z.object({
    kind: z.literal("repository-blob"),
    /**
     * `id` is the exact historical Git blob object identity. `digest` binds
     * governing repository Snapshot, application-base commit and tree, path,
     * type, mode, and object identity; it is not a
     * second content digest.
     */
    id: FoundationGitObjectSchema,
    digest: FoundationSha256Schema,
  }).strict(),
  z.object({
    kind: z.literal("candidate-revision"),
    /** The exact reducer-selected Candidate Revision that owns `path`. */
    id: FoundationOpaqueIdSchema,
    revision: FoundationPositiveSafeIntegerSchema,
    digest: FoundationSha256Schema,
  }).strict(),
]);

export const FoundationSourceReferenceSchema = z.object({
  schema: z.literal("lifecycle.source-reference.v2"),
  selection: FoundationInspectionSelectionSchema,
  basisDigest: FoundationSha256Schema,
  sourceKind: FoundationSourceKindSchema,
  subject: FoundationSourceSubjectSchema,
  label: FoundationPlainTextSchema,
  path: FoundationRepositoryRelativePathSchema,
  mediaType: z.enum(["markdown", "plain", "json"]),
  contentDigest: FoundationSha256Schema,
  byteLength: FoundationNonnegativeSafeIntegerSchema
    .max(FOUNDATION_SOURCE_MAXIMUM_BYTES),
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
    addFoundationIssue(context, ["subject", "kind"], "Source kind and source subject kind disagree");
  }
  const code = value.sourceKind === "canonical-blob" || value.sourceKind === "candidate-blob";
  if (code !== (value.selection.schema === "lifecycle.code-selection.v1")) {
    addFoundationIssue(context, ["selection"], "Source kind requires its exact Context or Code selection");
  }
  if (value.selection.schema === "lifecycle.code-selection.v1" &&
    (value.selection.boundary === null || value.selection.candidate === null ||
      (value.selection.subject === "decision" && value.selection.seal === null))) {
    addFoundationIssue(context, ["selection"], "A Code source requires a complete exact readable subject");
  }
  if (value.sourceKind === "candidate-blob" && value.selection.schema === "lifecycle.code-selection.v1" &&
      !sameFoundationValue(value.subject, value.selection.candidate)) {
    addFoundationIssue(context, ["subject"], "Candidate Source must bind the selected exact Candidate Revision");
  }
  refineFoundationSelfDigest(value, context);
});

export const FoundationSourceSelectorSchema = z.object({
  kind: z.literal("source"),
  reference: FoundationSourceReferenceSchema,
  startByte: FoundationNonnegativeSafeIntegerSchema
    .max(FOUNDATION_SOURCE_MAXIMUM_BYTES),
  maximumBytes: z.number().int().min(4)
    .max(FOUNDATION_SOURCE_PAGE_MAXIMUM_BYTES),
}).strict().superRefine((value, context) => {
  if (value.startByte > value.reference.byteLength) {
    addFoundationIssue(context, ["startByte"], "Source range starts after the exact source bytes");
  }
});

export const FoundationSourceResultSchema = z.object({
  schema: z.literal("lifecycle.source-range.v1"),
  kind: z.literal("source"),
  basis: FoundationContextBasisSchema,
  reference: FoundationSourceReferenceSchema,
  startByte: FoundationNonnegativeSafeIntegerSchema
    .max(FOUNDATION_SOURCE_MAXIMUM_BYTES),
  endByte: FoundationNonnegativeSafeIntegerSchema
    .max(FOUNDATION_SOURCE_MAXIMUM_BYTES),
  nextByte: FoundationNonnegativeSafeIntegerSchema
    .max(FOUNDATION_SOURCE_MAXIMUM_BYTES).nullable(),
  byteLength: FoundationNonnegativeSafeIntegerSchema
    .max(FOUNDATION_SOURCE_PAGE_MAXIMUM_BYTES),
  digest: FoundationSha256Schema,
  content: z.string().max(FOUNDATION_SOURCE_PAGE_MAXIMUM_BYTES),
}).strict().superRefine((value, context) => {
  const encodedLength = utf8ToBytes(value.content).byteLength;
  if ((value.reference.selection.schema === "lifecycle.code-selection.v1" && value.reference.selection.boundary === null) ||
    !sameFoundationValue(foundationContextSelectionOf(value.reference.selection), value.basis.selection)) {
    addFoundationIssue(context, ["reference", "selection"], "Source result uses another inspection selection");
  }
  if (value.reference.basisDigest !== value.basis.digest) {
    addFoundationIssue(context, ["reference", "basisDigest"], "Source result uses another context basis");
  }
  if (value.endByte < value.startByte || value.endByte - value.startByte !== value.byteLength) {
    addFoundationIssue(context, ["endByte"], "Source range and declared byte length disagree");
  }
  if (encodedLength !== value.byteLength) {
    addFoundationIssue(context, ["byteLength"], "Source content UTF-8 length does not reproduce the range");
  }
  if (digestFoundationUtf8(value.content) !== value.digest) {
    addFoundationIssue(context, ["digest"], "Source content digest does not reproduce the returned UTF-8 bytes");
  }
  if (value.endByte > value.reference.byteLength) {
    addFoundationIssue(context, ["endByte"], "Source range exceeds the exact source bytes");
  }
  const expectedNext = value.endByte === value.reference.byteLength ? null : value.endByte;
  if (value.nextByte !== expectedNext) {
    addFoundationIssue(context, ["nextByte"], "Source continuation does not match the exact returned range");
  }
  if (value.byteLength === 0 && value.startByte < value.reference.byteLength) {
    addFoundationIssue(context, ["byteLength"], "A nonterminal Source page must make progress");
  }
});

export type FoundationContextSelection = z.output<typeof FoundationContextSelectionSchema>;
export type FoundationCodeSelection = z.output<typeof FoundationCodeSelectionSchema>;
export type FoundationInspectionSelection = z.output<typeof FoundationInspectionSelectionSchema>;
export type FoundationContextBasis = z.output<typeof FoundationContextBasisSchema>;
export type FoundationSourceReference = z.output<typeof FoundationSourceReferenceSchema>;
export type FoundationSourceResult = z.output<typeof FoundationSourceResultSchema>;
