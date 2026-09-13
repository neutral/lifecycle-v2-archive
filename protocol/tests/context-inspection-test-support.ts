import { createHash } from "node:crypto";
import { createFoundationCodeSelection, createFoundationContextSelection, type FoundationInspectionSelection } from "../src/foundation/context-core.js";
import { selfDigestFoundationCarrier } from "../src/foundation/core.js";

export const sha = (character: string) => `sha256:${character.repeat(64)}` as const;
export const gitObject = (character: string) => character.repeat(40);
export const rawDigest = (content: string) =>
  `sha256:${createHash("sha256").update(content, "utf8").digest("hex")}` as const;

export const boundary = Object.freeze({
  kind: "work-boundary" as const,
  id: "boundary.one",
  revision: 1,
  digest: sha("b"),
});

export function basis(
  role: "proposed" | "active" = "active",
  originDigest = sha("a"),
) {
  const selection = createFoundationContextSelection({
    targetId: "target.one", storeId: "store.one", processId: "delivery.one",
    origin: { sequence: 1, digest: originDigest }, boundary: { role, reference: boundary },
  });
  const subject = {
    schema: "lifecycle.context-basis.v2" as const,
    selection,
    repository: {
      repositorySnapshotDigest: sha("1"),
      repositoryContractDigest: sha("2"),
      canonicalCommit: gitObject("c"),
      canonicalTree: gitObject("d"),
      productStateDigest: sha("3"),
      knowledgeSetDigest: sha("4"),
      atlasStateDigest: sha("5"),
      atlasResolutionDigest: sha("6"),
      atlasNormalizedModelDigest: sha("7"),
      atlasResourceBindingsDigest: sha("8"),
      checkBindingSetDigest: sha("9"),
    },
  };
  return Object.freeze({ ...subject, digest: selfDigestFoundationCarrier(subject) });
}

export const knowledgeReference = Object.freeze({
  id: "behavior.checkout.idempotency",
  kind: "behavior" as const,
  status: "current" as const,
  revision: 2,
  path: "records/behavior/checkout-idempotency.md",
  sourceDigest: sha("e"),
  semanticDigest: sha("f"),
});

export type SourceKind =
  | "knowledge-body"
  | "atlas-body"
  | "atlas-resource"
  | "canonical-blob"
  | "candidate-blob";

export function sourceReference(options: Readonly<{
  context?: ReturnType<typeof basis>;
  selection?: FoundationInspectionSelection;
  sourceKind?: SourceKind;
  id?: string;
  path?: string;
  content?: string;
  subjectDigest?: ReturnType<typeof sha>;
  revision?: number;
}> = {}) {
  const context = options.context ?? basis();
  const sourceKind = options.sourceKind ?? "knowledge-body";
  const subjectKinds = {
    "knowledge-body": "knowledge-record",
    "atlas-body": "atlas-point",
    "atlas-resource": "atlas-resource",
    "canonical-blob": "repository-blob",
    "candidate-blob": "candidate-revision",
  } as const;
  const content = options.content ?? "exact source\n";
  const path = options.path === undefined
    ? sourceKind === "atlas-resource"
      ? "atlas/sources/resource.txt"
      : "records/behavior/checkout-idempotency.md"
    : options.path;
  const subjectKind = subjectKinds[sourceKind];
  const subjectDigest = options.subjectDigest ?? (
    sourceKind === "knowledge-body" ? knowledgeReference.semanticDigest : sha("0")
  );
  const sourceSubject = subjectKind === "atlas-point"
    ? { kind: subjectKind, digest: subjectDigest }
    : subjectKind === "knowledge-record" || subjectKind === "candidate-revision"
    ? {
        kind: subjectKind,
        id: options.id ?? knowledgeReference.id,
        revision: options.revision ?? 2,
        digest: subjectDigest,
      }
    : { kind: subjectKind, id: options.id ?? knowledgeReference.id, digest: subjectDigest };
  const subject = {
    schema: "lifecycle.source-reference.v2" as const,
    selection: options.selection ?? (
      sourceKind === "canonical-blob" || sourceKind === "candidate-blob"
        ? createFoundationCodeSelection({
            targetId: context.selection.targetId, storeId: context.selection.storeId,
            processId: context.selection.processId, origin: context.selection.origin,
            subject: "candidate", boundary: context.selection.boundary.reference,
            candidate: { kind: "candidate-revision", id: "candidate.one", revision: 2, digest: sha("0") },
            seal: null,
          })
        : context.selection
    ),
    basisDigest: context.digest,
    sourceKind,
    subject: sourceSubject,
    label: "Exact source",
    path,
    mediaType: "markdown" as const,
    contentDigest: rawDigest(content),
    byteLength: Buffer.byteLength(content, "utf8"),
  };
  return Object.freeze({ ...subject, digest: selfDigestFoundationCarrier(subject) });
}
