import assert from "node:assert/strict";
import test from "node:test";
import { FoundationInspectionResultSchema } from "../src/foundation.js";
import {
  FOUNDATION_CODE_CHANGED_PATH_LIMIT,
  FOUNDATION_CODE_EXACT_DIFF_MAXIMUM_BYTES,
  FOUNDATION_CODE_RETURNED_DIFF_MAXIMUM_BYTES,
  FoundationCodeBasisSchema,
  FoundationCodeFileDifferenceSchema,
  FoundationCodeFileResultSchema,
  FoundationCodeFileRowSchema,
  FoundationCodeFileSelectorSchema,
  FoundationCodeIndexResultSchema,
  FoundationCodeIndexSelectorSchema,
  type FoundationCodeFileRow,
} from "../src/foundation/code-inspection.js";
import {
  digestFoundationCanonical,
  selfDigestFoundationCarrier,
} from "../src/foundation/core.js";
import {
  FOUNDATION_SOURCE_MAXIMUM_BYTES,
  digestFoundationInspectionCursor,
  createFoundationCodeSelection,
} from "../src/foundation/context-core.js";
import {
  basis,
  gitObject,
  rawDigest,
  sha,
  sourceReference,
} from "./context-inspection-test-support.js";

const candidate = Object.freeze({
  kind: "candidate-revision" as const,
  id: "candidate.one",
  revision: 3,
  digest: sha("a"),
});

const seal = Object.freeze({
  kind: "candidate-seal" as const,
  id: "seal.one",
  revision: 1,
  digest: sha("b"),
});

function codeBasis(options: Readonly<{
  subject?: "candidate" | "decision";
  changedPathCount?: number;
}> = {}) {
  const context = basis("active", sha("9"));
  const subject = options.subject ?? "candidate";
  const value = {
    schema: "lifecycle.code-basis.v2" as const,
    selection: createFoundationCodeSelection({
      targetId: context.selection.targetId, storeId: context.selection.storeId,
      processId: context.selection.processId, origin: context.selection.origin,
      subject, boundary: context.selection.boundary.reference, candidate,
      seal: subject === "decision" ? seal : null,
    }),
    context,
    subject,
    candidate,
    seal: subject === "decision" ? seal : null,
    before: {
      commit: context.repository.canonicalCommit,
      tree: context.repository.canonicalTree,
    },
    after: {
      tree: gitObject("e"),
      candidateDigest: sha("c"),
      pathInventoryDigest: sha("d"),
    },
    difference: {
      digest: sha("e"),
      changedPathCount: options.changedPathCount ?? 2,
    },
  };
  return Object.freeze({ ...value, digest: selfDigestFoundationCarrier(value) });
}

const beforeObject = Object.freeze({
  type: "blob" as const,
  mode: "100644" as const,
  objectId: gitObject("1"),
  digest: sha("1"),
  byteLength: 12,
});

const afterObject = Object.freeze({
  type: "blob" as const,
  mode: "100644" as const,
  objectId: gitObject("2"),
  digest: sha("2"),
  byteLength: 18,
});

function fileRow(
  selectedBasis: ReturnType<typeof codeBasis>,
  options: Readonly<{
    path?: string;
    change?: "added" | "modified" | "deleted" | "mode-changed" | "type-changed";
    before?: FoundationCodeFileRow["before"];
    after?: FoundationCodeFileRow["after"];
  }> = {},
): FoundationCodeFileRow {
  const path = options.path ?? "src/file.ts";
  const change = options.change ?? "modified";
  const before = options.before === undefined ? beforeObject : options.before;
  const after = options.after === undefined ? afterObject : options.after;
  const value = { path, change, before, after };
  return Object.freeze({
    cursor: digestFoundationInspectionCursor({
      basisDigest: selectedBasis.digest,
      collection: "code-files",
      key: {
        path,
        change,
        beforeObjectId: before?.objectId ?? null,
        afterObjectId: after?.objectId ?? null,
      },
    }),
    ...value,
  });
}

function codeSourceReference(input: Readonly<{
  selectedBasis: ReturnType<typeof codeBasis>;
  row: ReturnType<typeof fileRow>;
  side: "before" | "after";
}>) {
  const object = input.row[input.side]!;
  const sourceKind = input.side === "before" ? "canonical-blob" : "candidate-blob";
  const subjectDigest = input.side === "before"
    ? digestFoundationCanonical({
        repositorySnapshotDigest:
          input.selectedBasis.context.repository.repositorySnapshotDigest,
        applicationBaseCommit: input.selectedBasis.before.commit,
        applicationBaseTree: input.selectedBasis.before.tree,
        path: input.row.path,
        type: object.type,
        mode: object.mode,
        objectId: object.objectId,
      })
    : input.selectedBasis.candidate.digest;
  const source = sourceReference({
    context: input.selectedBasis.context,
    selection: input.selectedBasis.selection,
    sourceKind,
    id: input.side === "before" ? object.objectId : input.selectedBasis.candidate.id,
    revision: input.selectedBasis.candidate.revision,
    path: input.row.path,
    content: input.side === "before" ? "before bytes" : "candidate content",
    subjectDigest,
  });
  const value = {
    ...source,
    mediaType: "plain" as const,
    contentDigest: object.digest,
    byteLength: object.byteLength!,
  };
  return Object.freeze({ ...value, digest: selfDigestFoundationCarrier(value) });
}

function textDifference(content = "diff --git a/src/file.ts b/src/file.ts\n") {
  const length = Buffer.byteLength(content, "utf8");
  return Object.freeze({
    profile: "lifecycle.code-file-unified-diff.v1" as const,
    disposition: "available" as const,
    exactDigest: rawDigest(content),
    exactByteLength: length,
    returnedDigest: rawDigest(content),
    returnedByteLength: length,
    truncated: false,
    content,
    reason: null,
  });
}

test("Code selectors are bounded and accept no caller path or Git coordinate", () => {
  assert.equal(FoundationCodeIndexSelectorSchema.safeParse({
    kind: "code-index",
    selection: codeBasis().selection,
    subject: "candidate",
    afterCursor: null,
    limit: 200,
  }).success, true);
  assert.equal(FoundationCodeIndexSelectorSchema.safeParse({
    kind: "code-index",
    selection: codeBasis().selection,
    subject: "candidate",
    afterCursor: null,
    limit: 201,
  }).success, false);
  assert.equal(FoundationCodeFileSelectorSchema.safeParse({
    kind: "code-file",
    selection: codeBasis({ subject: "decision" }).selection,
    subject: "decision",
    fileCursor: sha("2"),
    maximumDiffBytes: FOUNDATION_CODE_RETURNED_DIFF_MAXIMUM_BYTES,
  }).success, true);
  assert.equal(FoundationCodeFileSelectorSchema.safeParse({
    kind: "code-file",
    selection: codeBasis().selection,
    subject: "candidate",
    fileCursor: sha("2"),
    maximumDiffBytes: FOUNDATION_CODE_RETURNED_DIFF_MAXIMUM_BYTES + 1,
  }).success, false);
  assert.equal(FoundationCodeFileSelectorSchema.safeParse({
    kind: "code-file",
    selection: codeBasis().selection,
    subject: "candidate",
    fileCursor: sha("2"),
    maximumDiffBytes: 64,
    path: "src/file.ts",
  }).success, false);
});

test("available Code basis binds one active historical context and exact Candidate subject", () => {
  const candidateBasis = codeBasis();
  assert.deepEqual(FoundationCodeBasisSchema.parse(candidateBasis), candidateBasis);

  const integrationParent = {
    ...candidateBasis,
    before: { commit: gitObject("e"), tree: gitObject("0") },
  };
  const integrated = FoundationCodeBasisSchema.parse({
    ...integrationParent,
    digest: selfDigestFoundationCarrier(integrationParent),
  });
  assert.notEqual(integrated.before.commit, integrated.context.repository.canonicalCommit);
  assert.deepEqual(integrated.context, candidateBasis.context);
  assert.deepEqual(integrated.candidate, candidateBasis.candidate);
  assert.equal(FoundationCodeBasisSchema.safeParse({ ...integrated, before: candidateBasis.before }).success, false,
    "The exact basis digest still binds the independently selected application parent");
  const invalidBefore = { ...integrated, before: { ...integrated.before, commit: "not-a-git-object" } };
  assert.equal(FoundationCodeBasisSchema.safeParse({ ...invalidBefore, digest: selfDigestFoundationCarrier(invalidBefore) }).success, false);

  const proposedContext = basis("proposed", candidateBasis.context.selection.origin.digest);
  const proposed = { ...candidateBasis, context: proposedContext };
  assert.equal(FoundationCodeBasisSchema.safeParse({
    ...proposed,
    digest: selfDigestFoundationCarrier(proposed),
  }).success, false);

  const candidateWithSeal = { ...candidateBasis, seal };
  assert.equal(FoundationCodeBasisSchema.safeParse({
    ...candidateWithSeal,
    digest: selfDigestFoundationCarrier(candidateWithSeal),
  }).success, false);
  const advancingDecision = { ...codeBasis({ subject: "decision" }), currentness: "potentially-advancing" };
  assert.equal(FoundationCodeBasisSchema.safeParse(advancingDecision).success, false);
  const tooMany = codeBasis({ changedPathCount: FOUNDATION_CODE_CHANGED_PATH_LIMIT + 1 });
  assert.equal(FoundationCodeBasisSchema.safeParse(tooMany).success, false);
});

test("Code rows encode exact add, delete, modification, mode, and type facts without rename inference", () => {
  const selectedBasis = codeBasis({ changedPathCount: 5 });
  const added = fileRow(selectedBasis, { path: "src/added.ts", change: "added", before: null });
  const deleted = fileRow(selectedBasis, { path: "src/deleted.ts", change: "deleted", after: null });
  const modified = fileRow(selectedBasis);
  const executableAfter = Object.freeze({ ...afterObject, mode: "100755" as const });
  const modeChanged = fileRow(selectedBasis, {
    path: "src/mode.ts",
    change: "mode-changed",
    after: executableAfter,
  });
  const gitlinkBefore = Object.freeze({
    type: "commit" as const,
    mode: "160000" as const,
    objectId: gitObject("3"),
    digest: sha("3"),
    byteLength: null,
  });
  const typeChanged = fileRow(selectedBasis, {
    path: "vendor/old-link",
    change: "type-changed",
    before: gitlinkBefore,
  });
  for (const row of [added, deleted, modified, modeChanged, typeChanged]) {
    assert.equal(FoundationCodeFileRowSchema.safeParse(row).success, true);
  }
  assert.equal(FoundationCodeFileRowSchema.safeParse({
    ...modified,
    change: "renamed",
  }).success, false);
  assert.equal(FoundationCodeFileRowSchema.safeParse({
    ...added,
    before: beforeObject,
  }).success, false);
  assert.equal(FoundationCodeFileRowSchema.safeParse({
    ...modified,
    after: { ...afterObject, objectId: beforeObject.objectId },
  }).success, false);
});

test("Code index validates basis-bound cursors, canonical order, and continuation", () => {
  const selectedBasis = codeBasis({ changedPathCount: 3 });
  const first = fileRow(selectedBasis, { path: "src/a.ts" });
  const second = fileRow(selectedBasis, { path: "src/b.ts" });
  const valid = {
    schema: "lifecycle.code-index.v1",
    kind: "code-index",
    status: "available",
    basis: selectedBasis,
    files: [first, second],
    nextAfterCursor: second.cursor,
  };
  assert.equal(FoundationCodeIndexResultSchema.safeParse(valid).success, true);
  assert.equal(FoundationInspectionResultSchema.safeParse(valid).success, true);
  assert.equal(FoundationCodeIndexResultSchema.safeParse({
    ...valid,
    files: [second, first],
  }).success, false);
  assert.equal(FoundationCodeIndexResultSchema.safeParse({
    ...valid,
    nextAfterCursor: first.cursor,
  }).success, false);
  assert.equal(FoundationCodeIndexResultSchema.safeParse({
    ...valid,
    files: [{ ...first, cursor: sha("0") }, second],
  }).success, false);
  assert.equal(FoundationCodeIndexResultSchema.safeParse({
    ...valid,
    files: [],
    nextAfterCursor: second.cursor,
  }).success, false);

  const completeBasis = codeBasis({ changedPathCount: 2 });
  const completeFirst = fileRow(completeBasis, { path: "src/a.ts" });
  const completeSecond = fileRow(completeBasis, { path: "src/b.ts" });
  const complete = {
    ...valid,
    basis: completeBasis,
    files: [completeFirst, completeSecond],
    nextAfterCursor: null,
  };
  assert.equal(FoundationCodeIndexResultSchema.safeParse(complete).success, true);
  assert.equal(FoundationCodeIndexResultSchema.safeParse({
    ...complete,
    nextAfterCursor: completeSecond.cursor,
  }).success, false);
});

test("Code unavailability carries no Context or difference claim", () => {
  const absent = {
    schema: "lifecycle.code-index.v1",
    kind: "code-index",
    status: "unavailable",
    selection: createFoundationCodeSelection({
      ...codeBasis().selection, candidate: null,
    }),
    subject: "candidate",
    candidate: null,
    seal: null,
    reason: "candidate-absent",
  };
  assert.equal(FoundationCodeIndexResultSchema.safeParse(absent).success, true);
  assert.equal(FoundationCodeIndexResultSchema.safeParse({
    ...absent,
    candidate,
  }).success, false);
  const decisionUnavailable = {
    schema: "lifecycle.code-file.v1",
    kind: "code-file",
    status: "unavailable",
    selection: createFoundationCodeSelection({
      ...codeBasis({ subject: "decision" }).selection, seal: null,
    }),
    subject: "decision",
    candidate,
    seal: null,
    reason: "decision-subject-unavailable",
  };
  assert.equal(FoundationCodeFileResultSchema.safeParse(decisionUnavailable).success, true);
  assert.equal(FoundationCodeFileResultSchema.safeParse({
    ...decisionUnavailable,
    context: basis(),
  }).success, false);
  assert.equal(FoundationCodeFileResultSchema.safeParse({
    ...decisionUnavailable,
    reason: "candidate-carrier-unavailable",
  }).success, false);
  assert.equal(FoundationCodeFileResultSchema.safeParse({
    ...decisionUnavailable,
    subject: "candidate",
    selection: codeBasis().selection,
    seal: null,
    reason: "candidate-carrier-unavailable",
  }).success, true);
});

test("Code file binds exact canonical and Candidate source references", () => {
  const selectedBasis = codeBasis({ subject: "decision", changedPathCount: 1 });
  const row = fileRow(selectedBasis);
  const beforeReference = codeSourceReference({ selectedBasis, row, side: "before" });
  const afterReference = codeSourceReference({ selectedBasis, row, side: "after" });
  const valid = {
    schema: "lifecycle.code-file.v1",
    kind: "code-file",
    status: "available",
    basis: selectedBasis,
    file: row,
    beforeSource: { status: "available", reference: beforeReference },
    afterSource: { status: "available", reference: afterReference },
    difference: textDifference(),
  };
  assert.equal(FoundationCodeFileResultSchema.safeParse(valid).success, true);
  assert.equal(FoundationInspectionResultSchema.safeParse(valid).success, true);

  const movedParent = { ...selectedBasis, before: { commit: gitObject("e"), tree: gitObject("f") } };
  const integratedBasis = Object.freeze({ ...movedParent, digest: selfDigestFoundationCarrier(movedParent) });
  assert.deepEqual(FoundationCodeBasisSchema.parse(integratedBasis), integratedBasis);
  const integratedRow = fileRow(integratedBasis);
  const integrated = { ...valid, basis: integratedBasis, file: integratedRow,
    beforeSource: { status: "available", reference: codeSourceReference({ selectedBasis: integratedBasis, row: integratedRow, side: "before" }) } };
  assert.equal(FoundationCodeFileResultSchema.safeParse(integrated).success, true,
    "The same governed Context can inspect exact P→I bytes independently from B");
  assert.equal(FoundationCodeFileResultSchema.safeParse({ ...integrated, beforeSource: valid.beforeSource }).success, false,
    "Even an unchanged blob needs the exact selected application parent in its source subject");

  const wrongCandidate = {
    ...afterReference,
    subject: { ...afterReference.subject, revision: candidate.revision + 1 },
  };
  assert.equal(FoundationCodeFileResultSchema.safeParse({
    ...valid,
    afterSource: {
      status: "available",
      reference: { ...wrongCandidate, digest: selfDigestFoundationCarrier(wrongCandidate) },
    },
  }).success, false);
  assert.equal(FoundationCodeFileResultSchema.safeParse({
    ...valid,
    file: { ...row, cursor: sha("0") },
  }).success, false);
  assert.equal(FoundationCodeFileResultSchema.safeParse({
    ...valid,
    beforeSource: { status: "absent", reference: null },
  }).success, false);
  const wrongMedia = { ...beforeReference, mediaType: "markdown" as const };
  assert.equal(FoundationCodeFileResultSchema.safeParse({
    ...valid,
    beforeSource: {
      status: "available",
      reference: { ...wrongMedia, digest: selfDigestFoundationCarrier(wrongMedia) },
    },
  }).success, false);
  const emptyBasis = codeBasis({ subject: "decision", changedPathCount: 0 });
  const emptyRow = fileRow(emptyBasis);
  assert.equal(FoundationCodeFileResultSchema.safeParse({
    ...valid,
    basis: emptyBasis,
    file: emptyRow,
    beforeSource: {
      status: "available",
      reference: codeSourceReference({ selectedBasis: emptyBasis, row: emptyRow, side: "before" }),
    },
    afterSource: {
      status: "available",
      reference: codeSourceReference({ selectedBasis: emptyBasis, row: emptyRow, side: "after" }),
    },
  }).success, false);
});

test("Code source dispositions distinguish absent, binary, oversized, and unsupported material", () => {
  const selectedBasis = codeBasis({ changedPathCount: 3 });
  const added = fileRow(selectedBasis, { change: "added", before: null });
  assert.equal(FoundationCodeFileResultSchema.safeParse({
    schema: "lifecycle.code-file.v1",
    kind: "code-file",
    status: "available",
    basis: selectedBasis,
    file: added,
    beforeSource: { status: "absent", reference: null },
    afterSource: { status: "binary", reference: null },
    difference: textDifference("diff --git a/src/file.ts b/src/file.ts\nGIT binary patch\n"),
  }).success, true);

  const oversizedAfter = Object.freeze({
    ...afterObject,
    byteLength: FOUNDATION_SOURCE_MAXIMUM_BYTES + 1,
  });
  const oversized = fileRow(selectedBasis, {
    path: "src/large.ts",
    change: "added",
    before: null,
    after: oversizedAfter,
  });
  const oversizedResult = {
    schema: "lifecycle.code-file.v1",
    kind: "code-file",
    status: "available",
    basis: selectedBasis,
    file: oversized,
    beforeSource: { status: "absent", reference: null },
    afterSource: { status: "oversized", reference: null },
    difference: textDifference(),
  };
  assert.equal(FoundationCodeFileResultSchema.safeParse(oversizedResult).success, true);
  assert.equal(FoundationCodeFileResultSchema.safeParse({
    ...oversizedResult,
    afterSource: { status: "binary", reference: null },
  }).success, false);

  const symlinkAfter = Object.freeze({
    ...afterObject,
    mode: "120000" as const,
  });
  const symlink = fileRow(selectedBasis, {
    path: "src/link",
    change: "added",
    before: null,
    after: symlinkAfter,
  });
  assert.equal(FoundationCodeFileResultSchema.safeParse({
    ...oversizedResult,
    file: symlink,
    afterSource: { status: "unsupported", reference: null },
  }).success, true);
});

test("raw per-file difference exposes exact and returned bytes without parsed claims", () => {
  const full = "éxact diff\n";
  const prefix = "éxact";
  const valid = {
    profile: "lifecycle.code-file-unified-diff.v1",
    disposition: "available",
    exactDigest: rawDigest(full),
    exactByteLength: Buffer.byteLength(full, "utf8"),
    returnedDigest: rawDigest(prefix),
    returnedByteLength: Buffer.byteLength(prefix, "utf8"),
    truncated: true,
    content: prefix,
    reason: null,
  };
  assert.equal(FoundationCodeFileDifferenceSchema.safeParse(valid).success, true);
  assert.equal(FoundationCodeFileDifferenceSchema.safeParse({
    ...valid,
    returnedByteLength: prefix.length,
  }).success, false);
  assert.equal(FoundationCodeFileDifferenceSchema.safeParse({
    ...valid,
    truncated: false,
    exactDigest: valid.returnedDigest,
  }).success, false);
  assert.equal(FoundationCodeFileDifferenceSchema.safeParse({
    ...valid,
    exactByteLength: FOUNDATION_CODE_EXACT_DIFF_MAXIMUM_BYTES + 1,
  }).success, false);
  const complete = textDifference();
  assert.equal(FoundationCodeFileDifferenceSchema.safeParse({
    ...complete,
    exactDigest: sha("f"),
  }).success, false);
  assert.equal(FoundationCodeFileDifferenceSchema.safeParse({
    ...complete,
    content: "\ud800",
    exactDigest: rawDigest("\ud800"),
    exactByteLength: Buffer.byteLength("\ud800", "utf8"),
    returnedDigest: rawDigest("\ud800"),
    returnedByteLength: Buffer.byteLength("\ud800", "utf8"),
  }).success, false);
  assert.equal(FoundationCodeFileDifferenceSchema.safeParse({
    ...complete,
    exactDigest: rawDigest(""),
    exactByteLength: 0,
    returnedDigest: rawDigest(""),
    returnedByteLength: 0,
    content: "",
  }).success, false);
  const unavailable = {
    profile: "lifecycle.code-file-unified-diff.v1",
    disposition: "unavailable",
    exactDigest: null,
    exactByteLength: null,
    returnedDigest: null,
    returnedByteLength: 0,
    truncated: false,
    content: null,
    reason: "difference-unavailable",
  };
  assert.equal(FoundationCodeFileDifferenceSchema.safeParse(unavailable).success, true);
  assert.equal(FoundationCodeFileDifferenceSchema.safeParse({
    ...unavailable,
    reason: null,
  }).success, false);
  assert.equal(FoundationCodeFileDifferenceSchema.safeParse({
    ...valid,
    lines: [],
  }).success, false);
});
