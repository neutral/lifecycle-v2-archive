import { basename } from "node:path";
import { FoundationError } from "../error.js";
import { digestCanonical } from "../validation/canonical.js";
import { FOUNDATION_REPOSITORY_CONTRACT_PATH } from "./contract.js";
import type {
  FoundationGitTreeEntry,
  FoundationProductState,
  FoundationProductStateEntry,
  FoundationProductStateRole,
  FoundationRepositoryContract,
} from "./types.js";

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

export function pathWithin(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/** Adopted Discipline content and its Registry are maintained only outside Delivery. */
export function isDisciplineMaintenancePath(contract: FoundationRepositoryContract, path: string): boolean {
  return pathWithin(path, contract.knowledge.roots.discipline);
}

function coveredBy(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => pathWithin(path, root));
}

function isDescription(path: string, contract: FoundationRepositoryContract): boolean {
  if (pathWithin(path, ".lifecycle") || pathWithin(path, "records/control") || pathWithin(path, contract.atlas.root)) return false;
  const name = basename(path);
  return name.startsWith("_") && name.endsWith(".desc.md");
}

function knowledgeRoots(contract: FoundationRepositoryContract): readonly string[] {
  return [
    contract.knowledge.roots.behavior,
    contract.knowledge.roots.assurance,
    contract.knowledge.roots.blueprint,
    contract.knowledge.roots.check,
    contract.knowledge.roots.discipline,
  ];
}

function prohibitedProductPath(path: string): boolean {
  return pathWithin(path, ".git") ||
    (pathWithin(path, ".lifecycle") && path !== FOUNDATION_REPOSITORY_CONTRACT_PATH) ||
    pathWithin(path, "records/control");
}

function exclusionFor(path: string, contract: FoundationRepositoryContract): string | null {
  return contract.productState.exclusions.find((root) => pathWithin(path, root)) ?? null;
}

function assertProductStatePolicy(contract: FoundationRepositoryContract): void {
  const requiredRoots = [FOUNDATION_REPOSITORY_CONTRACT_PATH, contract.atlas.root, ...knowledgeRoots(contract)];
  for (const required of requiredRoots) {
    if (!coveredBy(required, contract.productState.roots)) {
      throw new FoundationError("lifecycle.repository.product-state", `Product State roots do not cover required source ${required}`, {
        observedFacts: { required, roots: contract.productState.roots },
      });
    }
    const excluding = contract.productState.exclusions.find((exclusion) => pathWithin(required, exclusion) || pathWithin(exclusion, required));
    if (excluding !== undefined) {
      throw new FoundationError("lifecycle.repository.product-state", `Product State exclusion overlaps required source ${required}`, {
        observedFacts: { excluding, required },
      });
    }
  }
  for (const root of contract.productState.roots) {
    if (prohibitedProductPath(root) && root !== FOUNDATION_REPOSITORY_CONTRACT_PATH) {
      throw new FoundationError("lifecycle.path.prohibited", `Product State root enters a prohibited authority path: ${root}`);
    }
  }
  for (const root of contract.productState.governedImplementationRoots) {
    if (!coveredBy(root, contract.productState.roots)) {
      throw new FoundationError("lifecycle.repository.product-state", `Governed implementation root is outside Product State: ${root}`);
    }
    if (prohibitedProductPath(root) || pathWithin(root, contract.atlas.root) || knowledgeRoots(contract).some((knowledgeRoot) => pathWithin(root, knowledgeRoot))) {
      throw new FoundationError("lifecycle.path.prohibited", `Governed implementation root enters a prohibited authority path: ${root}`);
    }
    const excluding = contract.productState.exclusions.find((exclusion) => pathWithin(root, exclusion));
    if (excluding !== undefined) {
      throw new FoundationError("lifecycle.repository.product-state", `Governed implementation root is excluded from Product State: ${root}`, {
        observedFacts: { excluding, root },
      });
    }
  }
}

/** Classify one path by the standard, highest-authority Product State role. */
export function productStateRole(contract: FoundationRepositoryContract, path: string): FoundationProductStateRole | null {
  let role: FoundationProductStateRole | null = null;
  if (path === FOUNDATION_REPOSITORY_CONTRACT_PATH) role = "repository-contract";
  else if (pathWithin(path, contract.atlas.root)) role = "atlas";
  else if (knowledgeRoots(contract).some((root) => pathWithin(path, root)) || isDescription(path, contract)) role = "knowledge";
  else if (coveredBy(path, contract.productState.governedImplementationRoots)) role = "governed-implementation";
  else if (coveredBy(path, contract.productState.roots)) role = "declared-product";
  if (role === null) return null;

  const excludedBy = exclusionFor(path, contract);
  if (excludedBy === null) return role;
  if (role === "repository-contract" || role === "atlas" || role === "knowledge") {
    throw new FoundationError("lifecycle.repository.product-state", `Product State exclusion removes required ${role} source ${path}`, {
      observedFacts: { excludedBy, path, role },
    });
  }
  return null;
}

function assertEntryKind(entry: FoundationGitTreeEntry, role: FoundationProductStateRole): asserts entry is FoundationGitTreeEntry & { mode: "100644" | "100755" } {
  if (entry.type !== "blob" || (entry.mode !== "100644" && entry.mode !== "100755")) {
    throw new FoundationError("lifecycle.path.prohibited", `Product State path is not a tracked regular blob: ${entry.path}`, {
      observedFacts: { mode: entry.mode, objectId: entry.objectId, path: entry.path, role, type: entry.type },
    });
  }
  if ((role === "repository-contract" || role === "atlas" || role === "knowledge") && entry.mode !== "100644") {
    throw new FoundationError("lifecycle.path.prohibited", `Authoritative ${role} path must be non-executable: ${entry.path}`, {
      observedFacts: { mode: entry.mode, path: entry.path, role },
    });
  }
}

export function assertExactAuthoritativePaths(
  entries: readonly { path: string }[],
  universe: readonly { path: string }[] = entries,
): void {
  const authoritativePrefixes = new Set<string>();
  for (const entry of entries) {
    const segments = entry.path.split("/");
    let prefix = "";
    for (const segment of segments) {
      prefix = prefix.length === 0 ? segment : `${prefix}/${segment}`;
      authoritativePrefixes.add(prefix);
    }
  }
  const casePrefixes = new Map<string, string>();
  const normalizedPrefixes = new Map<string, string>();
  for (const entry of universe) {
    const segments = entry.path.split("/");
    let prefix = "";
    for (const segment of segments) {
      prefix = prefix.length === 0 ? segment : `${prefix}/${segment}`;
      const caseKey = prefix.toLowerCase();
      const casePrior = casePrefixes.get(caseKey);
      if (casePrior !== undefined && casePrior !== prefix && (authoritativePrefixes.has(casePrior) || authoritativePrefixes.has(prefix))) {
        throw new FoundationError("lifecycle.path.case-mismatch", `Authoritative paths collide under case folding: ${casePrior} and ${prefix}`, {
          observedFacts: { left: casePrior, right: prefix },
        });
      }
      casePrefixes.set(caseKey, prefix);

      const normalizedKey = prefix.normalize("NFC");
      const normalizedPrior = normalizedPrefixes.get(normalizedKey);
      if (normalizedPrior !== undefined && normalizedPrior !== prefix && (authoritativePrefixes.has(normalizedPrior) || authoritativePrefixes.has(prefix))) {
        throw new FoundationError("lifecycle.path.case-mismatch", `Authoritative paths collide under Unicode normalization: ${normalizedPrior} and ${prefix}`, {
          observedFacts: { left: normalizedPrior, right: prefix, normalization: "NFC" },
        });
      }
      normalizedPrefixes.set(normalizedKey, prefix);
    }
  }
}

export function buildProductState(contract: FoundationRepositoryContract, treeEntries: readonly FoundationGitTreeEntry[]): FoundationProductState {
  assertProductStatePolicy(contract);
  const trackedControl = treeEntries.find((entry) => pathWithin(entry.path, "records/control"));
  if (trackedControl !== undefined) {
    throw new FoundationError(
      "lifecycle.repository.epoch-mixed",
      `Repository v22 forbids repository-visible Delivery Control at ${trackedControl.path}; Control Record Stores remain off HEAD in runtime custody`,
      { observedFacts: { path: trackedControl.path } },
    );
  }
  const entries: FoundationProductStateEntry[] = [];
  for (const treeEntry of treeEntries) {
    const role = productStateRole(contract, treeEntry.path);
    if (role === null) continue;
    if (prohibitedProductPath(treeEntry.path) && role !== "repository-contract") {
      throw new FoundationError("lifecycle.path.prohibited", `Product State includes prohibited authority path ${treeEntry.path}`, {
        observedFacts: { path: treeEntry.path, role },
      });
    }
    assertEntryKind(treeEntry, role);
    entries.push(Object.freeze({ path: treeEntry.path, mode: treeEntry.mode, objectId: treeEntry.objectId, role }));
  }
  entries.sort((left, right) => compareCodePoints(left.path, right.path));
  const contractEntry = entries.find((entry) => entry.path === FOUNDATION_REPOSITORY_CONTRACT_PATH);
  if (contractEntry === undefined) throw new FoundationError("lifecycle.repository.contract-missing", `Bound commit lacks ${FOUNDATION_REPOSITORY_CONTRACT_PATH}`);
  const atlasEntrypoint = entries.find((entry) => entry.path === contract.atlas.entrypoint && entry.role === "atlas");
  if (atlasEntrypoint === undefined) throw new FoundationError("lifecycle.atlas.missing", `Bound commit lacks ${contract.atlas.entrypoint}`);
  assertExactAuthoritativePaths(entries, treeEntries);
  const frozenEntries = Object.freeze(entries);
  return Object.freeze({ entries: frozenEntries, digest: digestCanonical(frozenEntries) });
}
