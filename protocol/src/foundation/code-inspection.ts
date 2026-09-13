import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { z } from "zod/v4";
import {
  FoundationGitObjectSchema,
  FoundationSha256Schema,
  digestFoundationCanonical,
  type FoundationSha256,
} from "./core.js";
import {
  FOUNDATION_CONTEXT_INDEX_LIMIT,
  FOUNDATION_SOURCE_MAXIMUM_BYTES,
  FoundationContextBasisSchema,
  FoundationCodeSelectionSchema,
  FoundationCandidateInspectionReferenceSchema,
  FoundationSealInspectionReferenceSchema,
  foundationContextSelectionOf,
  FoundationRepositoryRelativePathSchema,
  FoundationSourceReferenceSchema,
  FoundationCursorSchema,
  FoundationIndexLimitSchema,
  addFoundationIssue,
  digestFoundationInspectionCursor,
  refineFoundationSelfDigest,
  sameFoundationValue,
} from "./context-core.js";
import {
  FoundationNonnegativeSafeIntegerSchema,
  FoundationPositiveSafeIntegerSchema,
} from "./internal.js";

/** Bounded Foundation Code inspection contracts. */

export const FOUNDATION_CODE_CHANGED_PATH_LIMIT = 16_384;
export const FOUNDATION_CODE_EXACT_DIFF_MAXIMUM_BYTES = 256 * 1024 * 1024;
export const FOUNDATION_CODE_RETURNED_DIFF_MAXIMUM_BYTES = 256 * 1024;

const FoundationCandidateReferenceSchema = FoundationCandidateInspectionReferenceSchema;
const FoundationSealReferenceSchema = FoundationSealInspectionReferenceSchema;

const FoundationCodeSubjectSchema = z.enum(["candidate", "decision"]);

export const FoundationCodeIndexSelectorSchema = z.object({
  kind: z.literal("code-index"),
  selection: FoundationCodeSelectionSchema,
  subject: FoundationCodeSubjectSchema,
  afterCursor: FoundationCursorSchema,
  limit: FoundationIndexLimitSchema,
}).strict().superRefine((value, context) => {
  if (value.subject !== value.selection.subject) addFoundationIssue(context, ["subject"], "Code subject differs from its selected provenance");
});

export const FoundationCodeFileSelectorSchema = z.object({
  kind: z.literal("code-file"),
  selection: FoundationCodeSelectionSchema,
  subject: FoundationCodeSubjectSchema,
  fileCursor: FoundationSha256Schema,
  maximumDiffBytes: z.number().int().min(4)
    .max(FOUNDATION_CODE_RETURNED_DIFF_MAXIMUM_BYTES),
}).strict().superRefine((value, context) => {
  if (value.subject !== value.selection.subject) addFoundationIssue(context, ["subject"], "Code subject differs from its selected provenance");
});

export const FoundationCodeBasisSchema = z.object({
  schema: z.literal("lifecycle.code-basis.v2"),
  selection: FoundationCodeSelectionSchema,
  context: FoundationContextBasisSchema,
  subject: FoundationCodeSubjectSchema,
  candidate: FoundationCandidateReferenceSchema,
  seal: FoundationSealReferenceSchema.nullable(),
  before: z.object({
    commit: FoundationGitObjectSchema,
    tree: FoundationGitObjectSchema,
  }).strict(),
  after: z.object({
    tree: FoundationGitObjectSchema,
    candidateDigest: FoundationSha256Schema,
    pathInventoryDigest: FoundationSha256Schema,
  }).strict(),
  difference: z.object({
    digest: FoundationSha256Schema,
    changedPathCount: FoundationNonnegativeSafeIntegerSchema
      .max(FOUNDATION_CODE_CHANGED_PATH_LIMIT),
  }).strict(),
  digest: FoundationSha256Schema,
}).strict().superRefine((value, context) => {
  if (value.context.selection.boundary.role !== "active") {
    addFoundationIssue(
      context,
      ["context", "selection", "boundary", "role"],
      "Available Code must use the selected Candidate's exact governing Boundary",
    );
  }
  // The Runtime proves `before` from the Candidate's retained application
  // lineage. Its integration parent P may differ from the governing Context B.
  // This public shape binds both exact identities without reinterpreting them.
  if (value.subject === "candidate" && value.seal !== null) {
    addFoundationIssue(context, ["seal"], "A Candidate Code basis cannot select a Candidate Seal");
  }
  if (value.subject === "decision" && value.seal === null) {
    addFoundationIssue(context, ["seal"], "A decision Code basis requires one exact Candidate Seal");
  }
  if (value.selection.boundary === null || !sameFoundationValue(value.context.selection, foundationContextSelectionOf(value.selection)) ||
      value.subject !== value.selection.subject || !sameFoundationValue(value.candidate, value.selection.candidate) ||
      !sameFoundationValue(value.seal, value.selection.seal)) {
    addFoundationIssue(context, ["selection"], "Code basis does not reproduce its exact selected dependencies");
  }
  refineFoundationSelfDigest(value, context);
});

const FoundationCodeBlobObjectSchema = z.object({
  type: z.literal("blob"),
  mode: z.enum(["100644", "100755", "120000"]),
  objectId: FoundationGitObjectSchema,
  digest: FoundationSha256Schema,
  byteLength: FoundationNonnegativeSafeIntegerSchema,
}).strict();

const FoundationCodeGitlinkObjectSchema = z.object({
  type: z.literal("commit"),
  mode: z.literal("160000"),
  objectId: FoundationGitObjectSchema,
  digest: FoundationSha256Schema,
  byteLength: z.null(),
}).strict();

export const FoundationCodeFileObjectSchema = z.discriminatedUnion("type", [
  FoundationCodeBlobObjectSchema,
  FoundationCodeGitlinkObjectSchema,
]);

const FoundationCodeChangeSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "mode-changed",
  "type-changed",
]);

export const FoundationCodeFileRowSchema = z.object({
  cursor: FoundationSha256Schema,
  path: FoundationRepositoryRelativePathSchema,
  change: FoundationCodeChangeSchema,
  before: FoundationCodeFileObjectSchema.nullable(),
  after: FoundationCodeFileObjectSchema.nullable(),
}).strict().superRefine((value, context) => {
  if (value.change === "added") {
    if (value.before !== null || value.after === null) {
      addFoundationIssue(context, ["change"], "An added path requires only an after object");
    }
    return;
  }
  if (value.change === "deleted") {
    if (value.before === null || value.after !== null) {
      addFoundationIssue(context, ["change"], "A deleted path requires only a before object");
    }
    return;
  }
  if (value.before === null || value.after === null) {
    addFoundationIssue(context, ["change"], "A changed retained path requires before and after objects");
    return;
  }
  if (value.change === "modified") {
    if (
      value.before.type !== value.after.type ||
      value.before.mode !== value.after.mode ||
      value.before.objectId === value.after.objectId
    ) {
      addFoundationIssue(
        context,
        ["change"],
        "A modified path retains type and mode while changing its exact object",
      );
    }
  } else if (value.change === "mode-changed") {
    if (value.before.type !== value.after.type || value.before.mode === value.after.mode) {
      addFoundationIssue(
        context,
        ["change"],
        "A mode-changed path retains its object type and changes mode",
      );
    }
  } else if (value.before.type === value.after.type) {
    addFoundationIssue(context, ["change"], "A type-changed path must change its Git object type");
  }
});

function compareFoundationCodePoints(left: string, right: string): number {
  const leftPoints = [...left];
  const rightPoints = [...right];
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index]!.codePointAt(0)! - rightPoints[index]!.codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

function codeFileCursorKey(row: z.output<typeof FoundationCodeFileRowSchema>) {
  return {
    path: row.path,
    change: row.change,
    beforeObjectId: row.before?.objectId ?? null,
    afterObjectId: row.after?.objectId ?? null,
  };
}

function refineCodeFileRowCursor(
  basis: z.output<typeof FoundationCodeBasisSchema>,
  row: z.output<typeof FoundationCodeFileRowSchema>,
  context: z.core.$RefinementCtx,
  path: readonly (string | number)[],
): void {
  const expected = digestFoundationInspectionCursor({
    basisDigest: basis.digest,
    collection: "code-files",
    key: codeFileCursorKey(row),
  });
  if (row.cursor !== expected) {
    addFoundationIssue(context, [...path, "cursor"], "Code file cursor does not bind its Code basis and exact path change");
  }
}

const FoundationCodeUnavailableReasonSchema = z.enum([
  "candidate-absent",
  "decision-subject-unavailable",
  "candidate-carrier-unavailable",
]);

function refineUnavailableCode(
  value: Readonly<{
    selection: z.output<typeof FoundationCodeSelectionSchema>;
    subject: "candidate" | "decision";
    candidate: z.output<typeof FoundationCandidateReferenceSchema> | null;
    seal: z.output<typeof FoundationSealReferenceSchema> | null;
    reason: z.output<typeof FoundationCodeUnavailableReasonSchema>;
  }>,
  context: z.core.$RefinementCtx,
): void {
  if (value.subject !== value.selection.subject || !sameFoundationValue(value.candidate, value.selection.candidate) ||
      !sameFoundationValue(value.seal, value.selection.seal)) {
    addFoundationIssue(context, ["selection"], "Unavailable Code must preserve its selected dependencies");
  }
  if (value.subject === "candidate" && value.seal !== null) {
    addFoundationIssue(context, ["seal"], "Unavailable Candidate Code cannot select a Candidate Seal");
  }
  if (value.reason === "candidate-absent") {
    if (value.candidate !== null || value.seal !== null) {
      addFoundationIssue(context, ["reason"], "Candidate absence cannot retain a Candidate or Seal reference");
    }
    return;
  }
  if (value.candidate === null) {
    addFoundationIssue(context, ["candidate"], "Every non-absence Code unavailability requires the exact Candidate reference");
  }
  if (value.reason === "decision-subject-unavailable") {
    if (value.subject !== "decision" || value.seal !== null) {
      addFoundationIssue(context, ["reason"], "Decision-subject unavailability requires a Candidate and no selected Seal");
    }
  } else if (value.subject === "decision" && value.seal === null) {
    addFoundationIssue(context, ["seal"], "Unavailable sealed-decision content must retain its exact Seal reference");
  }
}

const FoundationCodeIndexUnavailableResultSchema = z.object({
  schema: z.literal("lifecycle.code-index.v1"),
  kind: z.literal("code-index"),
  status: z.literal("unavailable"),
  selection: FoundationCodeSelectionSchema,
  subject: FoundationCodeSubjectSchema,
  candidate: FoundationCandidateReferenceSchema.nullable(),
  seal: FoundationSealReferenceSchema.nullable(),
  reason: FoundationCodeUnavailableReasonSchema,
}).strict().superRefine(refineUnavailableCode);

const FoundationCodeIndexAvailableResultSchema = z.object({
  schema: z.literal("lifecycle.code-index.v1"),
  kind: z.literal("code-index"),
  status: z.literal("available"),
  basis: FoundationCodeBasisSchema,
  files: z.array(FoundationCodeFileRowSchema)
    .max(FOUNDATION_CONTEXT_INDEX_LIMIT),
  nextAfterCursor: FoundationCursorSchema,
}).strict().superRefine((value, context) => {
  const paths = value.files.map(({ path }) => path);
  if (new Set(paths).size !== paths.length) {
    addFoundationIssue(context, ["files"], "Code index cannot repeat a changed path");
  }
  const cursors = value.files.map(({ cursor }) => cursor);
  if (new Set(cursors).size !== cursors.length) {
    addFoundationIssue(context, ["files"], "Code index cursors cannot repeat");
  }
  if (value.files.length > value.basis.difference.changedPathCount) {
    addFoundationIssue(context, ["files"], "Code page exceeds the exact Candidate changed-path count");
  }
  for (let index = 0; index < value.files.length; index += 1) {
    const row = value.files[index]!;
    refineCodeFileRowCursor(value.basis, row, context, ["files", index]);
    if (
      index > 0 &&
      compareFoundationCodePoints(value.files[index - 1]!.path, row.path) >= 0
    ) {
      addFoundationIssue(context, ["files", index], "Code files must use canonical path order");
    }
  }
  if (value.nextAfterCursor !== null && value.files.length === 0) {
    addFoundationIssue(context, ["nextAfterCursor"], "An empty Code page cannot advertise continuation");
  }
  if (
    value.nextAfterCursor !== null &&
    value.nextAfterCursor !== value.files.at(-1)?.cursor
  ) {
    addFoundationIssue(context, ["nextAfterCursor"], "Code continuation must equal the final returned file cursor");
  }
  if (
    value.nextAfterCursor !== null &&
    value.files.length === value.basis.difference.changedPathCount
  ) {
    addFoundationIssue(context, ["nextAfterCursor"], "A complete Code inventory cannot advertise continuation");
  }
});

export const FoundationCodeIndexResultSchema = z.discriminatedUnion("status", [
  FoundationCodeIndexAvailableResultSchema,
  FoundationCodeIndexUnavailableResultSchema,
]);

const FoundationCodeSourceDispositionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("absent"), reference: z.null() }).strict(),
  z.object({
    status: z.literal("available"),
    reference: FoundationSourceReferenceSchema,
  }).strict(),
  z.object({ status: z.literal("binary"), reference: z.null() }).strict(),
  z.object({ status: z.literal("oversized"), reference: z.null() }).strict(),
  z.object({ status: z.literal("unsupported"), reference: z.null() }).strict(),
]);

function digestFoundationUtf8(value: string): FoundationSha256 {
  return `sha256:${bytesToHex(sha256(utf8ToBytes(value)))}`;
}

function isFoundationUnicodeScalarText(value: string): boolean {
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
}

const FoundationCodeAvailableDifferenceSchema = z.object({
  profile: z.literal("lifecycle.code-file-unified-diff.v1"),
  disposition: z.literal("available"),
  exactDigest: FoundationSha256Schema,
  exactByteLength: FoundationPositiveSafeIntegerSchema
    .max(FOUNDATION_CODE_EXACT_DIFF_MAXIMUM_BYTES),
  returnedDigest: FoundationSha256Schema,
  returnedByteLength: FoundationNonnegativeSafeIntegerSchema
    .max(FOUNDATION_CODE_RETURNED_DIFF_MAXIMUM_BYTES),
  truncated: z.boolean(),
  content: z.string().max(FOUNDATION_CODE_RETURNED_DIFF_MAXIMUM_BYTES)
    .refine(isFoundationUnicodeScalarText, {
      message: "Returned Code diff must contain only Unicode scalar values",
    }),
  reason: z.null(),
}).strict().superRefine((value, context) => {
  const returnedByteLength = utf8ToBytes(value.content).byteLength;
  if (returnedByteLength !== value.returnedByteLength) {
    addFoundationIssue(context, ["returnedByteLength"], "Returned Code diff UTF-8 length does not reproduce its content");
  }
  if (digestFoundationUtf8(value.content) !== value.returnedDigest) {
    addFoundationIssue(context, ["returnedDigest"], "Returned Code diff digest does not reproduce its content");
  }
  if (value.returnedByteLength > value.exactByteLength) {
    addFoundationIssue(context, ["returnedByteLength"], "Returned Code diff exceeds its exact bytes");
  }
  if (value.truncated !== (value.returnedByteLength < value.exactByteLength)) {
    addFoundationIssue(context, ["truncated"], "Code diff truncation must exactly disclose omitted bytes");
  }
  if (!value.truncated && value.exactDigest !== value.returnedDigest) {
    addFoundationIssue(context, ["exactDigest"], "A complete returned Code diff must reproduce its exact digest");
  }
  if (value.exactByteLength > 0 && value.returnedByteLength === 0) {
    addFoundationIssue(context, ["returnedByteLength"], "A nonempty textual Code diff must return a bounded prefix");
  }
});

const FoundationCodeUnavailableDifferenceSchema = z.object({
  profile: z.literal("lifecycle.code-file-unified-diff.v1"),
  disposition: z.literal("unavailable"),
  exactDigest: z.null(),
  exactByteLength: z.null(),
  returnedDigest: z.null(),
  returnedByteLength: z.literal(0),
  truncated: z.literal(false),
  content: z.null(),
  reason: z.literal("difference-unavailable"),
}).strict();

export const FoundationCodeFileDifferenceSchema = z.discriminatedUnion("disposition", [
  FoundationCodeAvailableDifferenceSchema,
  FoundationCodeUnavailableDifferenceSchema,
]);

function refineCodeSource(
  input: Readonly<{
    basis: z.output<typeof FoundationCodeBasisSchema>;
    file: z.output<typeof FoundationCodeFileRowSchema>;
    side: "before" | "after";
    disposition: z.output<typeof FoundationCodeSourceDispositionSchema>;
  }>,
  context: z.core.$RefinementCtx,
): void {
  const object = input.file[input.side];
  const path = input.side === "before" ? ["beforeSource"] : ["afterSource"];
  if (object === null) {
    if (input.disposition.status !== "absent") {
      addFoundationIssue(context, path, "An absent Code file side cannot claim source material");
    }
    return;
  }
  if (input.disposition.status === "absent") {
    addFoundationIssue(context, path, "A present Code file side cannot be source-absent");
    return;
  }
  const regular = object.type === "blob" && (object.mode === "100644" || object.mode === "100755");
  if (!regular) {
    if (input.disposition.status !== "unsupported") {
      addFoundationIssue(context, path, "A non-regular Code object must use unsupported source disposition");
    }
    return;
  }
  if (object.byteLength > FOUNDATION_SOURCE_MAXIMUM_BYTES) {
    if (input.disposition.status !== "oversized") {
      addFoundationIssue(context, path, "A Code blob above the source ceiling must use oversized disposition");
    }
    return;
  }
  if (input.disposition.status === "oversized" || input.disposition.status === "unsupported") {
    addFoundationIssue(context, path, "A regular bounded Code blob must be available text or binary");
    return;
  }
  if (input.disposition.status === "binary") return;

  const reference = input.disposition.reference;
  if (
    !sameFoundationValue(reference.selection, input.basis.selection) ||
    reference.basisDigest !== input.basis.context.digest ||
    reference.path !== input.file.path ||
    reference.mediaType !== "plain" ||
    reference.contentDigest !== object.digest ||
    reference.byteLength !== object.byteLength
  ) {
    addFoundationIssue(context, [...path, "reference"], "Code source reference does not bind its exact side and Context basis");
    return;
  }
  if (input.side === "before") {
    const expectedSubjectDigest = digestFoundationCanonical({
      repositorySnapshotDigest: input.basis.context.repository.repositorySnapshotDigest,
      applicationBaseCommit: input.basis.before.commit,
      applicationBaseTree: input.basis.before.tree,
      path: input.file.path,
      type: object.type,
      mode: object.mode,
      objectId: object.objectId,
    });
    if (
      reference.sourceKind !== "canonical-blob" ||
      reference.subject.kind !== "repository-blob" ||
      reference.subject.id !== object.objectId ||
      reference.subject.digest !== expectedSubjectDigest
    ) {
      addFoundationIssue(context, [...path, "reference", "subject"], "Canonical Code source does not bind its exact historical blob identity");
    }
  } else if (
    reference.sourceKind !== "candidate-blob" ||
    reference.subject.kind !== "candidate-revision" ||
    !sameFoundationValue(reference.subject, input.basis.candidate)
  ) {
    addFoundationIssue(context, [...path, "reference", "subject"], "Candidate Code source does not bind its exact Candidate Revision");
  }
}

const FoundationCodeFileUnavailableResultSchema = z.object({
  schema: z.literal("lifecycle.code-file.v1"),
  kind: z.literal("code-file"),
  status: z.literal("unavailable"),
  selection: FoundationCodeSelectionSchema,
  subject: FoundationCodeSubjectSchema,
  candidate: FoundationCandidateReferenceSchema.nullable(),
  seal: FoundationSealReferenceSchema.nullable(),
  reason: FoundationCodeUnavailableReasonSchema,
}).strict().superRefine(refineUnavailableCode);

const FoundationCodeFileAvailableResultSchema = z.object({
  schema: z.literal("lifecycle.code-file.v1"),
  kind: z.literal("code-file"),
  status: z.literal("available"),
  basis: FoundationCodeBasisSchema,
  file: FoundationCodeFileRowSchema,
  beforeSource: FoundationCodeSourceDispositionSchema,
  afterSource: FoundationCodeSourceDispositionSchema,
  difference: FoundationCodeFileDifferenceSchema,
}).strict().superRefine((value, context) => {
  if (value.basis.difference.changedPathCount === 0) {
    addFoundationIssue(context, ["file"], "A selected Code file requires a nonempty exact changed-path inventory");
  }
  refineCodeFileRowCursor(value.basis, value.file, context, ["file"]);
  refineCodeSource({
    basis: value.basis,
    file: value.file,
    side: "before",
    disposition: value.beforeSource,
  }, context);
  refineCodeSource({
    basis: value.basis,
    file: value.file,
    side: "after",
    disposition: value.afterSource,
  }, context);
});

export const FoundationCodeFileResultSchema = z.discriminatedUnion("status", [
  FoundationCodeFileAvailableResultSchema,
  FoundationCodeFileUnavailableResultSchema,
]);

export type FoundationCodeBasis = z.output<typeof FoundationCodeBasisSchema>;
export type FoundationCodeFileRow = z.output<typeof FoundationCodeFileRowSchema>;
export type FoundationCodeIndexResult = z.output<typeof FoundationCodeIndexResultSchema>;
export type FoundationCodeFileResult = z.output<typeof FoundationCodeFileResultSchema>;
export type FoundationCodeIndexSelector = z.output<typeof FoundationCodeIndexSelectorSchema>;
export type FoundationCodeFileSelector = z.output<typeof FoundationCodeFileSelectorSchema>;
