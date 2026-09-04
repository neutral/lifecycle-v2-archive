import { FoundationError } from "../error.js";
import { digestCanonical } from "../validation/canonical.js";
import { assertExactAuthoritativePaths, pathWithin } from "./product-state.js";
import type { FoundationAtlasState, FoundationAtlasStateEntry, FoundationGitTreeEntry, FoundationRepositoryContract } from "./types.js";

function compareCodePoints(left: string, right: string): number {
  const leftPoints = [...left];
  const rightPoints = [...right];
  for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
    const leftPoint = leftPoints[index]!.codePointAt(0)!;
    const rightPoint = rightPoints[index]!.codePointAt(0)!;
    if (leftPoint !== rightPoint) return leftPoint - rightPoint;
  }
  return leftPoints.length - rightPoints.length;
}

export function buildAtlasState(contract: FoundationRepositoryContract, treeEntries: readonly FoundationGitTreeEntry[]): FoundationAtlasState {
  return buildAtlasStateForSelection(contract.atlas.root, contract.atlas.entrypoint, treeEntries);
}

/** Build the fixed Atlas source boundary before a repository contract exists. */
export function buildAtlasStateForSelection(
  root: string,
  entrypoint: string,
  treeEntries: readonly FoundationGitTreeEntry[],
): FoundationAtlasState {
  const entries: FoundationAtlasStateEntry[] = [];
  for (const treeEntry of treeEntries) {
    if (!pathWithin(treeEntry.path, root)) continue;
    if (treeEntry.type !== "blob" || treeEntry.mode !== "100644") {
      throw new FoundationError("lifecycle.path.prohibited", `Authoritative Atlas path must be one non-executable regular blob: ${treeEntry.path}`, {
        observedFacts: { mode: treeEntry.mode, objectId: treeEntry.objectId, path: treeEntry.path, type: treeEntry.type },
      });
    }
    entries.push(Object.freeze({ path: treeEntry.path, mode: "100644", objectId: treeEntry.objectId }));
  }
  entries.sort((left, right) => compareCodePoints(left.path, right.path));
  if (!entries.some((entry) => entry.path === entrypoint)) {
    throw new FoundationError("lifecycle.atlas.missing", `Bound commit lacks tracked non-executable ${entrypoint}`);
  }
  assertExactAuthoritativePaths(entries, treeEntries);
  const frozenEntries = Object.freeze(entries);
  return Object.freeze({ entries: frozenEntries, digest: digestCanonical(frozenEntries) });
}
