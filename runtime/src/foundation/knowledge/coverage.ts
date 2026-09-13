import { basename } from "node:path";
import type { FoundationGitTreeEntry, FoundationRepositoryContract } from "../repository/types.js";
import { compareCodePoints } from "../validation/ordering.js";
import type { DiagnosticCollector } from "../validation/result.js";
import type {
  FoundationCoverageEntry,
  FoundationCoverageExemptionResult,
  FoundationDescriptionSpec,
  FoundationKnowledgeRecord,
} from "./types.js";

const COVERAGE_STAGE = "coverage";

function atOrBelow(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function matchesSelector(path: string, selector: FoundationDescriptionSpec["coverage"][number]): boolean {
  if (selector.mode === "file") return path === selector.path;
  if (!atOrBelow(path, selector.path) || path === selector.path) return false;
  return !selector.exclude.some((excluded) => atOrBelow(path, excluded));
}

function isDescriptionRecord(path: string): boolean {
  const name = basename(path);
  return name.startsWith("_") && name.endsWith(".desc.md");
}

export function knowledgeOrControlPath(path: string, contract: FoundationRepositoryContract): boolean {
  const roots = contract.knowledge.roots;
  return atOrBelow(path, roots.behavior) || atOrBelow(path, roots.assurance) || atOrBelow(path, roots.blueprint) ||
    atOrBelow(path, roots.check) || atOrBelow(path, roots.discipline) || atOrBelow(path, contract.atlas.root) ||
    atOrBelow(path, "records/control") || atOrBelow(path, ".lifecycle") || isDescriptionRecord(path);
}

/** Knowledge and Control retain their owners even beneath an implementation root. */
export function governedImplementationPath(contract: FoundationRepositoryContract, path: string): boolean {
  return contract.productState.governedImplementationRoots.some((root) => atOrBelow(path, root)) &&
    !knowledgeOrControlPath(path, contract);
}

export function governedImplementationEntries(options: {
  contract: FoundationRepositoryContract;
  treeEntries: readonly FoundationGitTreeEntry[];
  collector: DiagnosticCollector;
}): readonly FoundationGitTreeEntry[] {
  const entries: FoundationGitTreeEntry[] = [];
  for (const entry of options.treeEntries) {
    // Product State exclusions decide drift membership, not Description
    // coverage. Only exact coverageExemptions can waive semantic ownership.
    if (!governedImplementationPath(options.contract, entry.path)) continue;
    if (entry.type !== "blob" || (entry.mode !== "100644" && entry.mode !== "100755")) {
      options.collector.add({
        stage: COVERAGE_STAGE,
        code: "lifecycle.description.coverage-file-kind",
        message: `Governed implementation path ${entry.path} is not a supported regular Git blob`,
        path: entry.path,
        facts: { mode: entry.mode, type: entry.type },
      });
      continue;
    }
    entries.push(entry);
  }
  return Object.freeze(entries.sort((left, right) => compareCodePoints(left.path, right.path)));
}

export function buildDescriptionCoverage(options: {
  contract: FoundationRepositoryContract;
  treeEntries: readonly FoundationGitTreeEntry[];
  currentDescriptions: readonly FoundationKnowledgeRecord[];
  collector: DiagnosticCollector;
}): Readonly<{
  coverage: readonly FoundationCoverageEntry[];
  exemptions: readonly FoundationCoverageExemptionResult[];
}> {
  const governed = governedImplementationEntries(options);
  const governedByPath = new Map(governed.map((entry) => [entry.path, entry]));
  const exemptionResults: FoundationCoverageExemptionResult[] = [];
  const exempted = new Set<string>();

  for (const exemption of options.contract.productState.coverageExemptions) {
    const matches = governed.filter((entry) => atOrBelow(entry.path, exemption.path));
    exemptionResults.push(Object.freeze({ path: exemption.path, reason: exemption.reason, matched: matches.length > 0 }));
    for (const entry of matches) exempted.add(entry.path);
    if (matches.length === 0) {
      options.collector.add({
        stage: COVERAGE_STAGE,
        code: "lifecycle.description.exemption-empty",
        severity: "warning",
        message: `Coverage exemption ${exemption.path} matches no governed implementation artifact`,
        path: exemption.path,
        facts: { reason: exemption.reason },
      });
    }
  }

  const selectors: Readonly<{ record: FoundationKnowledgeRecord; selector: FoundationDescriptionSpec["coverage"][number] }>[] = options.currentDescriptions
    .flatMap((record) => (record.frontMatter.spec as FoundationDescriptionSpec).coverage.map((selector) => ({ record, selector })))
    .sort((left, right) => compareCodePoints(`${left.record.frontMatter.id}\0${left.selector.path}\0${left.selector.mode}`, `${right.record.frontMatter.id}\0${right.selector.path}\0${right.selector.mode}`));

  for (const { record, selector } of selectors) {
    const matches = governed.filter((entry) => matchesSelector(entry.path, selector));
    if (matches.length === 0) {
      options.collector.add({
        stage: COVERAGE_STAGE,
        code: "lifecycle.description.coverage-empty",
        severity: "warning",
        message: `Description selector ${selector.path} in ${record.frontMatter.id} matches no governed implementation artifact`,
        path: record.path,
        facts: { selectorPath: selector.path, selectorMode: selector.mode },
      });
    }
    if (selector.mode === "file" && !governedByPath.has(selector.path)) {
      options.collector.add({
        stage: COVERAGE_STAGE,
        code: "lifecycle.description.coverage-target-missing",
        message: `Description file selector ${selector.path} is not one governed implementation artifact`,
        path: record.path,
        facts: { selectorPath: selector.path },
      });
    }
  }

  const coverage: FoundationCoverageEntry[] = [];
  for (const entry of governed) {
    if (exempted.has(entry.path)) continue;
    const owners = selectors.filter(({ selector }) => matchesSelector(entry.path, selector));
    if (owners.length === 0) {
      options.collector.add({
        stage: COVERAGE_STAGE,
        code: "lifecycle.description.coverage-missing",
        message: `Governed implementation artifact ${entry.path} has no current primary Description`,
        path: entry.path,
      });
      continue;
    }
    if (owners.length > 1) {
      options.collector.add({
        stage: COVERAGE_STAGE,
        code: "lifecycle.description.coverage-ambiguous",
        message: `Governed implementation artifact ${entry.path} has ${owners.length} primary Descriptions`,
        path: entry.path,
        related: owners.map(({ record }) => record.path),
        facts: { descriptionIds: owners.map(({ record }) => record.frontMatter.id).sort(compareCodePoints) },
      });
      continue;
    }
    const owner = owners[0]!;
    coverage.push(Object.freeze({
      path: entry.path,
      mode: entry.mode as "100644" | "100755",
      objectId: entry.objectId,
      descriptionId: owner.record.frontMatter.id,
      descriptionRevision: owner.record.frontMatter.revision,
      selectorPath: owner.selector.path,
      selectorMode: owner.selector.mode,
    }));
  }

  return Object.freeze({
    coverage: Object.freeze(coverage.sort((left, right) => compareCodePoints(left.path, right.path))),
    exemptions: Object.freeze(exemptionResults.sort((left, right) => compareCodePoints(left.path, right.path))),
  });
}
