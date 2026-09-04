import { createHash } from "node:crypto";
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
  generationDigest = sha("a"),
) {
  const generation = {
    schema: "lifecycle.delivery-generation.v1" as const,
    storeId: "store.one",
    processId: "delivery.one",
    journal: { eventCount: 0, headSequence: null, headDigest: null },
    storeDisposition: {
      stage: "active" as const,
      integrity: "verified" as const,
      sealSubjectDigest: null,
      archiveManifestDigest: null,
    },
    repository: {
      headCommit: gitObject("c"),
      headTree: gitObject("d"),
      repositoryContractDigest: sha("2"),
    },
    activeOperation: null,
    digest: generationDigest,
  };
  const subject = {
    schema: "lifecycle.context-basis.v1" as const,
    generation,
    boundary: { role, reference: boundary },
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
  const sourceSubject = subjectKind === "knowledge-record" || subjectKind === "candidate-revision"
    ? {
        kind: subjectKind,
        id: options.id ?? knowledgeReference.id,
        revision: options.revision ?? 2,
        digest: subjectDigest,
      }
    : { kind: subjectKind, id: options.id ?? knowledgeReference.id, digest: subjectDigest };
  const subject = {
    schema: "lifecycle.source-reference.v1" as const,
    generationDigest: context.generation.digest,
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
