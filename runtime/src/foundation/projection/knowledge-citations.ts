import { FoundationError } from "../error.js";
import { compareCodePoints } from "../validation/ordering.js";
import type { FoundationProjectionMandatoryItem } from "./types.js";

/** An alias selects exact bytes; it never merges the occurrences carrying them. */
export function unambiguousKnowledgeAliases(
  items: readonly FoundationProjectionMandatoryItem[],
): ReadonlyMap<string, string> {
  const occurrences = new Map<string, FoundationProjectionMandatoryItem[]>();
  const revisionsBySourceDigest = new Map<string, FoundationProjectionMandatoryItem>();
  for (const item of items) {
    if (item.semanticDigest === null) continue;
    const revision = revisionsBySourceDigest.get(item.sourceDigest);
    if (revision !== undefined && (
      revision.sourceIdentity !== item.sourceIdentity || revision.revision !== item.revision ||
      revision.semanticDigest !== item.semanticDigest || revision.kind !== item.kind
    )) {
      throw new FoundationError(
        "lifecycle.projection.citation-identity-conflict",
        "Knowledge occurrences sharing exact source bytes disagree on their revision identity",
      );
    }
    revisionsBySourceDigest.set(item.sourceDigest, item);
    const values = occurrences.get(item.sourceIdentity) ?? [];
    values.push(item);
    occurrences.set(item.sourceIdentity, values);
  }
  const aliases = new Map<string, string>();
  for (const [identity, values] of occurrences) {
    if (new Set(values.map(({ sourceDigest }) => sourceDigest)).size !== 1) continue;
    const selected = [...values].sort((left, right) => compareCodePoints(left.id, right.id))[0]!;
    if (selected.id !== identity) aliases.set(selected.id, identity);
  }
  return aliases;
}
