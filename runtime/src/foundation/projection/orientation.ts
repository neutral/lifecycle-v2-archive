import { FOUNDATION_PROJECTION_COMPILER } from "../constants.js";
import { FoundationError } from "../error.js";
import { governedImplementationEntries } from "../knowledge/coverage.js";
import type { FoundationKnowledgeObservation, FoundationKnowledgeSourceResolution } from "../knowledge/types.js";
import { objectBlobBytes } from "../repository/git.js";
import type { FoundationLoadedRepositoryEpoch, FoundationProjectionProfile } from "../repository/types.js";
import { digestCanonical, sha256Bytes, type Sha256 } from "../validation/canonical.js";
import { compareCodePoints, sortUniqueCodePoints } from "../validation/ordering.js";
import { DiagnosticCollector } from "../validation/result.js";
import { buildTierTwoItem, ProjectionByteInventoryBuilder, projectionIndexBytes } from "./content.js";
import { exactBlobSizes } from "./objects.js";
import { foundationRepositorySourceMaterials } from "./source-context.js";
import type {
  FoundationOrientationProjectionCore,
  FoundationOrientationProjectionRequest,
  FoundationProjectionBindingItem,
  FoundationProjectionByteInventoryEntry,
  FoundationProjectionConflict,
  FoundationProjectionMandatoryItem,
  FoundationProjectionOmission,
  FoundationProjectionOmissionCategory,
  FoundationProjectionReachableCategory,
  FoundationProjectionReachableItem,
  FoundationProjectionSourceItem,
  FoundationProjectionUnresolved,
} from "./types.js";

export const FOUNDATION_PROJECTION_COMPILER_IDENTITY = Object.freeze({
  ...FOUNDATION_PROJECTION_COMPILER,
  digest: digestCanonical(FOUNDATION_PROJECTION_COMPILER),
});

export const FOUNDATION_PROJECTION_REACHABLE_CATEGORIES: readonly FoundationProjectionReachableCategory[] = Object.freeze([
  "related-knowledge",
  "atlas-context",
  "provenance-source",
  "historical-revision",
  "neighboring-description",
  "unaffected-implementation",
]);
const REACHABLE_CATEGORY_ORDER = new Map(FOUNDATION_PROJECTION_REACHABLE_CATEGORIES.map((category, index) => [category, index]));
const KNOWLEDGE_KIND_ORDER = new Map([
  ["behavior", 0],
  ["assurance", 1],
  ["blueprint", 2],
  ["description", 3],
  ["check", 4],
]);

type ReachableCandidate = Readonly<{
  id: string;
  category: FoundationProjectionReachableCategory;
  kind: string;
  summary: string;
  sourceRevision: string | null;
  digest: Sha256 | null;
  objectId: string | null;
  bytes: Buffer | null;
  byteLength: number;
}>;

export type OrientationCompilation = Readonly<{
  core: FoundationOrientationProjectionCore;
  mandatory: readonly FoundationProjectionMandatoryItem[];
  bindings: readonly FoundationProjectionBindingItem[];
  sources: readonly FoundationProjectionSourceItem[];
  reachable: readonly FoundationProjectionReachableItem[];
  conflicts: readonly FoundationProjectionConflict[];
  unresolved: readonly FoundationProjectionUnresolved[];
  omission: FoundationProjectionOmission;
  inventory: readonly FoundationProjectionByteInventoryEntry[];
}>;

function handle(requestDigest: Sha256, candidate: ReachableCandidate): string {
  if (candidate.digest === null) throw new FoundationError("lifecycle.projection.content-digest", "Reachable handle requires one exact content digest");
  return `retrieval.${digestCanonical({
    requestDigest,
    category: candidate.category,
    id: candidate.id,
    revision: candidate.sourceRevision,
    digest: candidate.digest,
  }).slice("sha256:".length)}`;
}

function media(path: string): Readonly<{ mediaType: string; encoding: "utf-8" | "binary"; hint: "markdown" | "json" | "source" | "binary" }> {
  if (path.endsWith(".md")) return { mediaType: "text/markdown", encoding: "utf-8", hint: "markdown" };
  if (path.endsWith(".json")) return { mediaType: "application/json", encoding: "utf-8", hint: "json" };
  if (/\.(?:c|cc|cpp|css|go|h|hpp|html|java|js|jsx|mjs|py|rb|rs|sh|ts|tsx|vue|xml|yaml|yml)$/u.test(path)) {
    return { mediaType: "text/plain", encoding: "utf-8", hint: "source" };
  }
  return { mediaType: "application/octet-stream", encoding: "binary", hint: "binary" };
}

function sourceId(source: FoundationKnowledgeSourceResolution): string {
  return `source.${sha256Bytes(`${source.recordId}\0${source.recordRevision}\0${source.sourceId}`).slice("sha256:".length)}`;
}

function pathItemId(namespace: string, path: string): string {
  return `${namespace}.${sha256Bytes(path).slice("sha256:".length)}`;
}

function candidateForSource(
  source: FoundationKnowledgeSourceResolution,
  sizes: ReadonlyMap<string, number>,
): ReachableCandidate | null {
  const id = sourceId(source);
  if (source.objectId !== null && source.resolvedDigest !== null && source.disposition === "resolved") {
    return Object.freeze({
      id,
      category: "provenance-source",
      kind: source.role,
      summary: `Exact ${source.role} source for ${source.recordId} revision ${source.recordRevision}`,
      sourceRevision: source.objectId,
      digest: source.resolvedDigest,
      objectId: source.objectId,
      bytes: null,
      byteLength: sizes.get(source.objectId) ?? 0,
    });
  }
  if (source.declaredDigest === null) return null;
  return Object.freeze({
    id,
    category: "provenance-source",
    kind: source.role,
    summary: `${source.role} source is ${source.disposition} under the bound retrieval policy`,
    sourceRevision: source.declaredRevision,
    digest: source.declaredDigest,
    objectId: null,
    bytes: null,
    byteLength: 0,
  });
}

function omission(
  profile: FoundationProjectionProfile,
  candidates: readonly ReachableCandidate[],
  included: readonly ReachableCandidate[],
): FoundationProjectionOmission {
  const includedKeys = new Set(included.map((entry) => `${entry.category}\0${entry.id}`));
  const categories: FoundationProjectionOmissionCategory[] = FOUNDATION_PROJECTION_REACHABLE_CATEGORIES.map((category) => {
    const before = candidates.filter((entry) => entry.category === category).sort((left, right) =>
      compareCodePoints(left.id, right.id) || compareCodePoints(left.sourceRevision ?? "", right.sourceRevision ?? ""));
    const after = before.filter((entry) => includedKeys.has(`${entry.category}\0${entry.id}`));
    const omitted = before.filter((entry) => !includedKeys.has(`${entry.category}\0${entry.id}`));
    return Object.freeze({
      category,
      before: Object.freeze({ items: before.length, bytes: before.reduce((total, entry) => total + entry.byteLength, 0) }),
      after: Object.freeze({ items: after.length, bytes: after.reduce((total, entry) => total + entry.byteLength, 0) }),
      omitted: Object.freeze({ items: omitted.length, bytes: omitted.reduce((total, entry) => total + entry.byteLength, 0) }),
      enumerationComplete: true as const,
      omittedIds: Object.freeze(omitted.map((entry) => entry.id)),
    });
  });
  return Object.freeze({
    profile: profile.id,
    profileDigest: profile.digest,
    bounds: Object.freeze({
      maximumMandatoryItems: profile.maximumMandatoryItems,
      maximumMandatoryBytes: profile.maximumMandatoryBytes,
      maximumItemBytes: profile.maximumItemBytes,
      maximumReachableItems: profile.maximumReachableItems,
      maximumReachableBytes: profile.maximumReachableBytes,
      maximumSourceBytes: profile.maximumSourceBytes,
      maximumRelationshipDepth: profile.maximumRelationshipDepth,
    }),
    eligibleCategories: FOUNDATION_PROJECTION_REACHABLE_CATEGORIES,
    categories: Object.freeze(categories),
    policy: "category-code-point-prefix-v1",
    mandatoryOmissions: 0,
  });
}

export function selectProjectionReachablePrefix<T extends Readonly<{
  id: string;
  category: FoundationProjectionReachableCategory;
  sourceRevision: string | null;
  byteLength: number;
}>>(
  candidates: readonly T[],
  profile: Pick<FoundationProjectionProfile, "maximumReachableItems" | "maximumReachableBytes">,
): readonly T[] {
  const values = [...candidates].sort((left, right) =>
    REACHABLE_CATEGORY_ORDER.get(left.category)! - REACHABLE_CATEGORY_ORDER.get(right.category)! ||
    compareCodePoints(left.id, right.id) ||
    compareCodePoints(left.sourceRevision ?? "", right.sourceRevision ?? ""));
  const included: T[] = [];
  let bytes = 0;
  const stoppedCategories = new Set<FoundationProjectionReachableCategory>();
  for (const candidate of values) {
    if (stoppedCategories.has(candidate.category)) continue;
    if (included.length + 1 > profile.maximumReachableItems || bytes + candidate.byteLength > profile.maximumReachableBytes) {
      stoppedCategories.add(candidate.category);
      continue;
    }
    included.push(candidate);
    bytes += candidate.byteLength;
  }
  return Object.freeze(included);
}

export async function compileOrientation(options: {
  request: FoundationOrientationProjectionRequest;
  loaded: FoundationLoadedRepositoryEpoch;
  knowledge: FoundationKnowledgeObservation;
  inventory: ProjectionByteInventoryBuilder;
  atlasResourceIds?: ReadonlySet<string>;
}): Promise<OrientationCompilation> {
  const { request, loaded, knowledge, inventory } = options;
  const records = knowledge.currentRecords.map((record) => Object.freeze({
    id: record.frontMatter.id,
    kind: record.frontMatter.kind,
    revision: record.frontMatter.revision,
    title: record.frontMatter.title,
    summary: record.frontMatter.summary,
    owners: Object.freeze([...record.frontMatter.owners]),
    path: record.path,
    sourceDigest: record.sourceDigest,
    semanticDigest: record.semanticDigest,
  })).sort((left, right) =>
    (KNOWLEDGE_KIND_ORDER.get(left.kind) ?? 99) - (KNOWLEDGE_KIND_ORDER.get(right.kind) ?? 99) ||
    compareCodePoints(left.id, right.id) || left.revision - right.revision || compareCodePoints(left.path, right.path));
  const currentRevision = new Map(knowledge.currentRecords.map((record) => [record.frontMatter.id, record.frontMatter.revision]));
  const relationships = knowledge.relationships
    .filter((edge) => currentRevision.get(edge.source) === edge.sourceRevision)
    .map((edge) => Object.freeze({
      sourceId: edge.source,
      type: edge.type,
      targetId: edge.target,
      required: edge.required,
      scope: edge.scope,
    }))
    .sort((left, right) => compareCodePoints(`${left.sourceId}\0${left.type}\0${left.targetId}`, `${right.sourceId}\0${right.type}\0${right.targetId}`));
  const knowledgeIndexBase = { records: Object.freeze(records), relationships: Object.freeze(relationships) };
  const knowledgeIndex = Object.freeze({ ...knowledgeIndexBase, digest: digestCanonical(knowledgeIndexBase) });
  const coverageEntries = knowledge.coverage.map((entry) => Object.freeze({
    path: entry.path,
    descriptionId: entry.descriptionId,
    descriptionRevision: entry.descriptionRevision,
    selectorPath: entry.selectorPath,
    selectorMode: entry.selectorMode,
  })).sort((left, right) => compareCodePoints(left.path, right.path));
  const governedImplementation = governedImplementationEntries({
    contract: loaded.contract,
    treeEntries: loaded.treeEntries,
    collector: new DiagnosticCollector(),
  });
  const atOrBelow = (path: string, root: string): boolean => path === root || path.startsWith(`${root}/`);
  const exemptionItems = governedImplementation.filter((entry) =>
    loaded.contract.productState.coverageExemptions.some((exemption) => atOrBelow(entry.path, exemption.path))).length;
  const missingItems = knowledge.validation.diagnostics.filter((diagnostic) =>
    diagnostic.code === "lifecycle.description.coverage-missing").length;
  const ambiguousItems = knowledge.validation.diagnostics.filter((diagnostic) =>
    diagnostic.code === "lifecycle.description.coverage-ambiguous").length;
  const coverageBase = {
    implementationRoots: Object.freeze([...loaded.contract.productState.governedImplementationRoots].sort(compareCodePoints)),
    exemptions: Object.freeze(knowledge.exemptions.map((entry) => Object.freeze({ ...entry }))),
    entries: Object.freeze(coverageEntries),
    summary: Object.freeze({
      governedImplementationItems: governedImplementation.length,
      coveredItems: coverageEntries.length,
      missingItems,
      ambiguousItems,
      exemptionItems,
    }),
  };
  const coverageIndex = Object.freeze({ ...coverageBase, digest: digestCanonical(coverageBase) });
  const bindingEntries = Object.values(loaded.contract.checkBindings).map((binding) => Object.freeze({
    id: binding.id,
    binding,
    checkIds: Object.freeze([...binding.checkIds].sort(compareCodePoints)),
    evidenceKinds: Object.freeze(["command"] as const),
    capabilityProfileId: binding.capabilityProfileId,
    digest: binding.digest,
  })).sort((left, right) => compareCodePoints(left.id, right.id));
  const bindingBase = { entries: Object.freeze(bindingEntries) };
  const bindingIndex = Object.freeze({ ...bindingBase, digest: digestCanonical(bindingBase) });
  const capabilityEntries = Object.values(loaded.contract.capabilityProfiles).map((entry) => Object.freeze({ id: entry.id, profile: entry, digest: entry.digest }))
    .sort((left, right) => compareCodePoints(left.id, right.id));
  const capabilityBase = { entries: Object.freeze(capabilityEntries) };
  const capabilityIndex = Object.freeze({ ...capabilityBase, digest: digestCanonical(capabilityBase) });
  const profileEntries = Object.values(loaded.contract.projectionProfiles).sort((left, right) => compareCodePoints(left.id, right.id));
  const profileBase = { entries: Object.freeze(profileEntries) };
  const profileIndex = Object.freeze({ ...profileBase, digest: digestCanonical(profileBase) });
  const conditions = knowledge.validation.diagnostics.map((diagnostic) => Object.freeze({
    code: diagnostic.code,
    severity: diagnostic.severity,
    detail: diagnostic.message,
    sourceIds: Object.freeze(sortUniqueCodePoints(diagnostic.related.map((entry) => entry.id))),
  })).sort((left, right) => compareCodePoints(
    `${left.code}\0${left.severity}\0${left.detail}\0${left.sourceIds.join("\0")}`,
    `${right.code}\0${right.severity}\0${right.detail}\0${right.sourceIds.join("\0")}`,
  ));
  if (conditions.length > 2_048) {
    throw new FoundationError("lifecycle.projection.bounds-invalid", "Orientation conditions exceed the complete result-enumeration bound", {
      observedFacts: { maximum: 2_048, observed: conditions.length, category: "conditions" },
    });
  }
  const bindings: FoundationProjectionBindingItem[] = [];
  const compatibleByBinding = new Map<string, string[]>();
  for (const entry of knowledge.bindings) {
    const compatible = compatibleByBinding.get(entry.binding.id) ?? [];
    compatible.push(entry.checkId);
    compatibleByBinding.set(entry.binding.id, compatible);
  }
  for (const binding of Object.values(loaded.contract.checkBindings).sort((left, right) => compareCodePoints(left.id, right.id))) {
    const bytes = projectionIndexBytes(binding);
    const stored = inventory.add({ tier: "mandatory", key: `binding:${binding.id}`, bytes, mediaType: "application/json", encoding: "utf-8" });
    const compatibleChecks = (compatibleByBinding.get(binding.id) ?? []).sort(compareCodePoints);
    bindings.push(buildTierTwoItem({
      id: binding.id,
      binding,
      checkIds: Object.freeze([...binding.checkIds].sort(compareCodePoints)),
      compatibleCheckIds: Object.freeze(compatibleChecks),
      bindingDigest: binding.digest,
      evidenceKinds: Object.freeze(["command"] as const),
      inclusionReasons: Object.freeze([
        "orientation-binding-index",
        ...compatibleChecks.map((checkId) => `compatible with ${checkId}`),
      ]),
      presentationHint: "json" as const,
      content: stored.content,
      useLimit: "Execution guidance only; Check Definition and Capability Profile remain authoritative.",
    }));
  }
  bindings.sort((left, right) => compareCodePoints(left.id, right.id));

  // Current Knowledge is exact role authority, not optional adjacent context.
  // Keeping these records in Tier 2 preserves their Knowledge citation kind
  // and semantic digest through provider materialization. Historical records
  // and neighboring non-authority context remain bounded Tier-3 retrieval.
  const mandatory: FoundationProjectionMandatoryItem[] = [];
  for (const record of knowledge.currentRecords) {
    const bytes = Buffer.from(record.sourceText, "utf8");
    const stored = inventory.add({
      tier: "mandatory",
      key: `knowledge:orientation:${record.frontMatter.id}:r${record.frontMatter.revision}`,
      bytes,
      declaredDigest: record.sourceDigest,
      mediaType: "text/markdown",
      encoding: "utf-8",
    });
    mandatory.push(buildTierTwoItem({
      id: `knowledge.${digestCanonical({
        id: record.frontMatter.id,
        revision: record.frontMatter.revision,
        sourceDigest: record.sourceDigest,
      }).slice("sha256:".length)}`,
      category: "knowledge" as const,
      sourceIdentity: record.frontMatter.id,
      kind: record.frontMatter.kind,
      authority: "product-knowledge" as const,
      locator: record.path,
      revision: record.frontMatter.revision,
      sourceDigest: record.sourceDigest,
      semanticDigest: record.semanticDigest,
      inclusionReasons: Object.freeze(["orientation-current-knowledge"]),
      relationshipPaths: Object.freeze([]),
      content: stored.content,
      presentationHint: "markdown" as const,
      useLimit: "Current repository Knowledge retains its declared kind and owner authority; reconnaissance may propose but cannot revise it.",
    }));
  }
  mandatory.sort((left, right) =>
    (KNOWLEDGE_KIND_ORDER.get(left.kind ?? "") ?? 99) -
      (KNOWLEDGE_KIND_ORDER.get(right.kind ?? "") ?? 99) ||
    compareCodePoints(
      `${left.sourceIdentity}\0${String(left.revision ?? "")}\0${left.locator}\0${left.id}`,
      `${right.sourceIdentity}\0${String(right.revision ?? "")}\0${right.locator}\0${right.id}`,
    ));

  const sources: FoundationProjectionSourceItem[] = [];
  const repositorySources = await foundationRepositorySourceMaterials({
    loaded,
    maximumItemBytes: request.profile.maximumItemBytes,
    atlasResourceIds: options.atlasResourceIds,
  });
  for (const source of repositorySources) {
    const stored = inventory.add({
      tier: "mandatory",
      key: `source:${source.id.slice("source.".length)}`,
      bytes: source.bytes,
      declaredDigest: source.digest,
      mediaType: source.mediaType,
      encoding: source.encoding,
    });
    sources.push(buildTierTwoItem({
      id: source.id,
      reference: source.reference,
      revision: source.revision,
      digest: source.digest,
      authority: source.authority,
      semantic: Object.freeze({
        class: "source" as const,
        subjectId: source.id,
        subjectDigest: source.digest,
        evidenceKind: null,
      }),
      inclusionReasons: Object.freeze([
        source.authority === "atlas" ? "orientation-selected-atlas-resource" : "orientation-repository-context",
      ]),
      presentationHint: source.presentationHint,
      content: stored.content,
      useLimit: source.useLimit,
    }));
  }
  sources.sort((left, right) => compareCodePoints(
    `${left.reference}\0${left.revision ?? ""}\0${left.id}`,
    `${right.reference}\0${right.revision ?? ""}\0${right.id}`,
  ));

  const candidates: ReachableCandidate[] = [];
  const optionalObjectIds = [
    ...(request.features.reachable ? loaded.productState.entries.filter((entry) => entry.role === "governed-implementation").map((entry) => entry.objectId) : []),
    ...knowledge.sources.filter((source) => source.disposition === "resolved" && source.objectId !== null).map((source) => source.objectId!),
  ];
  const objectSizes = await exactBlobSizes(loaded.repository, optionalObjectIds);
  if (request.features.historical) {
    for (const record of knowledge.historicalRecords) {
      const bytes = Buffer.from(record.sourceText, "utf8");
      candidates.push(Object.freeze({
        id: `historical.${sha256Bytes(`${record.frontMatter.id}\0${record.frontMatter.revision}`).slice("sha256:".length)}`,
        category: "historical-revision",
        kind: record.frontMatter.kind,
        summary: record.frontMatter.summary,
        sourceRevision: String(record.frontMatter.revision),
        digest: record.sourceDigest,
        objectId: record.objectId,
        bytes,
        byteLength: bytes.byteLength,
      }));
    }
  }
  for (const source of knowledge.sources) {
    const candidate = candidateForSource(source, objectSizes);
    if (candidate !== null) candidates.push(candidate);
  }
  if (request.features.reachable) {
    for (const entry of loaded.productState.entries.filter((entry) => entry.role === "governed-implementation")) {
      candidates.push(Object.freeze({
        id: pathItemId("implementation", entry.path),
        category: "unaffected-implementation",
        kind: "implementation",
        summary: `Exact governed implementation at ${entry.path}`,
        sourceRevision: entry.objectId,
        digest: null,
        objectId: entry.objectId,
        bytes: null,
        byteLength: objectSizes.get(entry.objectId) ?? 0,
      }));
    }
  }
  if (candidates.length > 262_144) {
    throw new FoundationError("lifecycle.projection.bounds-invalid", "Reachable context exceeds the complete omission-enumeration bound", {
      observedFacts: { maximum: 262_144, observed: candidates.length },
    });
  }
  const selected = selectProjectionReachablePrefix(candidates, request.profile);
  const included: ReachableCandidate[] = [];
  for (const candidate of selected) {
    if (candidate.bytes !== null || candidate.objectId === null) {
      included.push(candidate);
      continue;
    }
    const bytes = await objectBlobBytes(loaded.repository, candidate.objectId, candidate.byteLength);
    const digest = sha256Bytes(bytes);
    if (candidate.digest !== null && candidate.digest !== digest) {
      throw new FoundationError("lifecycle.projection.content-digest", `Resolved source digest mismatch for ${candidate.id}`, {
        observedFacts: { actual: digest, expected: candidate.digest, id: candidate.id },
      });
    }
    included.push(Object.freeze({ ...candidate, digest, bytes }));
  }
  const reachable: FoundationProjectionReachableItem[] = [];
  for (const candidate of included) {
    const retrievalHandle = handle(request.digest, candidate);
    if (candidate.bytes === null) {
      reachable.push(Object.freeze({
        handle: retrievalHandle,
        id: candidate.id,
        category: candidate.category,
        kind: candidate.kind,
        summary: candidate.summary,
        sourceRevision: candidate.sourceRevision,
        digest: candidate.digest!,
        byteLength: 0,
        retrieval: "inaccessible",
        mountedPath: null,
      }));
    } else {
      const contentMedia = media(candidate.id);
      const stored = inventory.add({ tier: "reachable", key: retrievalHandle, bytes: candidate.bytes, declaredDigest: candidate.digest!, mediaType: contentMedia.mediaType, encoding: contentMedia.encoding });
      reachable.push(Object.freeze({
        handle: retrievalHandle,
        id: candidate.id,
        category: candidate.category,
        kind: candidate.kind,
        summary: candidate.summary,
        sourceRevision: candidate.sourceRevision,
        digest: candidate.digest!,
        byteLength: stored.byteLength,
        retrieval: "mounted",
        mountedPath: stored.path,
      }));
    }
  }
  reachable.sort((left, right) =>
    REACHABLE_CATEGORY_ORDER.get(left.category)! - REACHABLE_CATEGORY_ORDER.get(right.category)! ||
    compareCodePoints(left.id, right.id) ||
    compareCodePoints(left.handle, right.handle));

  const conflicts = knowledge.conflicts.map((conflict) => Object.freeze({
    id: `conflict.${conflict.digest.slice("sha256:".length)}`,
    code: `lifecycle.knowledge.${conflict.type}`,
    severity: "error" as const,
    recordIds: Object.freeze(sortUniqueCodePoints([conflict.leftId, conflict.rightId])),
    detail: `${conflict.leftFact} conflicts with ${conflict.rightFact}`,
  })).sort((left, right) => compareCodePoints(`${left.code}\0${left.id}`, `${right.code}\0${right.id}`));
  const currentRevisions = new Map(knowledge.currentRecords.map((record) => [record.frontMatter.id, record.frontMatter.revision]));
  const unresolved = knowledge.sources.filter((source) => source.disposition !== "resolved").map((source) => Object.freeze({
    id: `unresolved.${digestCanonical(source).slice("sha256:".length)}`,
    code: source.disposition === "retrieval-denied" ? "lifecycle.projection.external-denied" : "lifecycle.projection.source-inaccessible",
    required: source.required && currentRevisions.get(source.recordId) === source.recordRevision,
    reference: source.reference,
    detail: `Source ${source.sourceId} for ${source.recordId} is ${source.disposition}`,
  })).sort((left, right) => compareCodePoints(
    `${left.required ? "0" : "1"}\0${left.reference}\0${left.id}`,
    `${right.required ? "0" : "1"}\0${right.reference}\0${right.id}`,
  ));
  if (conflicts.length > 2_048 || unresolved.length > 2_048) {
    const category = conflicts.length > 2_048 ? "conflicts" : "unresolved";
    const observed = category === "conflicts" ? conflicts.length : unresolved.length;
    throw new FoundationError("lifecycle.projection.bounds-invalid", `Orientation ${category} exceed the complete result-enumeration bound`, {
      observedFacts: { maximum: 2_048, observed, category },
    });
  }

  const retrievalEntries = reachable.map((entry) => Object.freeze({
    handle: entry.handle,
    id: entry.id,
    kind: entry.kind,
    digest: entry.digest,
    byteLength: entry.byteLength,
    availability: entry.retrieval,
  }));
  const retrievalBase = { entries: Object.freeze(retrievalEntries) };
  const retrievalIndex = Object.freeze({ ...retrievalBase, digest: digestCanonical(retrievalBase) });
  const indexDigest = digestCanonical({
    knowledgeIndexDigest: knowledgeIndex.digest,
    coverageIndexDigest: coverageIndex.digest,
    bindingIndexDigest: bindingIndex.digest,
    capabilityIndexDigest: capabilityIndex.digest,
    profileIndexDigest: profileIndex.digest,
    retrievalIndexDigest: retrievalIndex.digest,
  });
  const core: FoundationOrientationProjectionCore = Object.freeze({
    class: "orientation",
    objective: request.subject.objective,
    purpose: "Ground reconnaissance in the exact Repository Epoch, Knowledge observation, Description coverage, Check Bindings, and authorized retrieval surface.",
    conditions: Object.freeze(conditions),
    knowledgeIndex,
    coverageIndex,
    bindingIndex,
    capabilityIndex,
    profileIndex,
    retrievalIndex,
    indexDigest,
  });

  return Object.freeze({
    core,
    mandatory: Object.freeze(mandatory),
    bindings: Object.freeze(bindings),
    sources: Object.freeze(sources),
    reachable: Object.freeze(reachable),
    conflicts: Object.freeze(conflicts),
    unresolved: Object.freeze(unresolved),
    omission: omission(request.profile, candidates, included),
    inventory: inventory.entries(),
  });
}
