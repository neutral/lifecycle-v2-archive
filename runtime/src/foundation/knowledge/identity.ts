import { digestCanonical } from "../validation/canonical.js";
import type {
  FoundationKnowledgeOccurrence,
  FoundationKnowledgeRecord,
  FoundationKnowledgeRevisionIdentity,
} from "./types.js";

export function knowledgeRevisionIdentity(
  record: FoundationKnowledgeRecord,
): FoundationKnowledgeRevisionIdentity {
  return Object.freeze({
    id: record.frontMatter.id,
    revision: record.frontMatter.revision,
    sourceDigest: record.sourceDigest,
    semanticDigest: record.semanticDigest,
  });
}

export function knowledgeOccurrence(
  record: FoundationKnowledgeRecord,
  basis: FoundationKnowledgeOccurrence["basis"],
): FoundationKnowledgeOccurrence {
  return Object.freeze({ basis, ...knowledgeRevisionIdentity(record) });
}

/** Preserve the selected Projection identity formula, including the review basis. */
export function knowledgeOccurrenceItemId(occurrence: FoundationKnowledgeOccurrence): string {
  const digest = digestCanonical({
    basis: occurrence.basis,
    id: occurrence.id,
    revision: occurrence.revision,
    sourceDigest: occurrence.sourceDigest,
  });
  return `knowledge.${digest.slice("sha256:".length)}`;
}
