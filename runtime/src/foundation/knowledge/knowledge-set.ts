import { FOUNDATION_COMPILER, FOUNDATION_SPECIFICATION_REVISION } from "../constants.js";
import { FoundationError } from "../error.js";
import { objectBlobBytes } from "../repository/git.js";
import type {
  FoundationGitTreeEntry,
  FoundationLoadedRepositoryEpoch,
  FoundationRepositoryContract,
} from "../repository/types.js";
import { canonicalJson, digestCanonical, selfDigest, type Sha256 } from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import {
  DiagnosticCollector,
  foundationValidationImplementation,
  type FoundationDiagnostic,
  type FoundationValidationDiagnostic,
} from "../validation/result.js";
import { bindingIndex, resolveKnowledgeBindings } from "./bindings.js";
import { detectKnowledgeConflicts } from "./conflicts.js";
import { buildDescriptionCoverage } from "./coverage.js";
import { expectedKnowledgeKind, parseKnowledgeRecord } from "./records.js";
import { buildRevisionIndexes, compareKnowledgeRecords as compareRecords } from "./revisions.js";
import { buildRelationshipEdges, relationshipIndexes, validateRelationshipGraph } from "./relationships.js";
import { sourceResolutionIndex, validateKnowledgeSources } from "./sources.js";
import {
  createEmptyDisciplineRegistry,
  parseDisciplineRegistry,
  validateDisciplineRegistryRecords,
} from "./discipline-registry.js";
import type {
  FoundationCoverageEntry,
  FoundationDisciplineRegistry,
  FoundationKnowledgeIndex,
  FoundationKnowledgeRecord,
  FoundationKnowledgeSet,
  FoundationKnowledgeSetManifest,
  FoundationKnowledgeSetResult,
  FoundationRelationshipEdge,
} from "./types.js";

const STAGES = ["discovery", "records", "revision", "sources", "relationships", "coverage", "bindings", "conflicts", "manifest"] as const;
type KnowledgeRepositoryView = Readonly<{
  repository: string;
  contract: FoundationRepositoryContract;
  commit: string;
  tree: string;
  objectFormat: "sha1" | "sha256";
  treeEntries: readonly FoundationGitTreeEntry[];
  productStateDigest: FoundationLoadedRepositoryEpoch["productState"]["digest"];
  atlasStateDigest: FoundationLoadedRepositoryEpoch["atlasState"]["digest"];
  atlasResolutionDigest: FoundationLoadedRepositoryEpoch["atlas"]["resolution"]["digest"];
  atlasNormalizedModelDigest: FoundationLoadedRepositoryEpoch["atlas"]["resolution"]["normalizedModelDigest"];
  atlasResourceBindingsDigest: FoundationLoadedRepositoryEpoch["atlas"]["resolution"]["resourceBindingsDigest"];
}>;

type KnowledgeCompilationWitness = Readonly<{
  epoch: FoundationLoadedRepositoryEpoch;
  epochDigest: Sha256;
  carrierDigest: Sha256;
  result: FoundationKnowledgeSetResult;
}>;

const compiledKnowledge = new WeakMap<FoundationKnowledgeSet, KnowledgeCompilationWitness>();

function compilationEpochDigest(input: FoundationLoadedRepositoryEpoch): Sha256 {
  return digestCanonical({ repository: exactRepositoryView(input), epoch: input.epoch });
}

function compilationCarrierDigest(knowledge: FoundationKnowledgeSet): Sha256 {
  // Map indexes are derived lookup machinery, not the canonical compiler
  // artifact used by snapshot binding. Every canonical field remains bound.
  const { index: _index, ...carrier } = knowledge;
  return digestCanonical(carrier);
}

/**
 * Consume one compiler-owned result for the exact loaded epoch and artifact.
 * Copies, restored carriers, later observations, or changed values use the
 * caller's ordinary recompilation path. This witness grants no currentness.
 */
export function consumeFoundationKnowledgeCompilation(
  input: FoundationLoadedRepositoryEpoch,
  knowledge: FoundationKnowledgeSet,
): FoundationKnowledgeSetResult | null {
  const witness = compiledKnowledge.get(knowledge);
  if (witness === undefined || witness.epoch !== input) return null;
  compiledKnowledge.delete(knowledge);
  try {
    return witness.epochDigest === compilationEpochDigest(input) &&
        witness.carrierDigest === compilationCarrierDigest(knowledge)
      ? witness.result
      : null;
  } catch {
    // A changed or noncanonical caller value cannot turn memoization into an
    // acceptance path or introduce a new diagnostic ahead of its owner.
    return null;
  }
}

function asDiagnostic(error: unknown, path: string | null): Omit<FoundationDiagnostic, "severity" | "pointer" | "related" | "facts"> & { facts: Record<string, unknown> } {
  if (error instanceof FoundationError) {
    return { code: error.code, message: error.message, path, facts: { observedFacts: error.observedFacts ?? null } };
  }
  return { code: "lifecycle.knowledge.processor", message: error instanceof Error ? error.message : String(error), path, facts: {} };
}

function addNestedDiagnostic(
  collector: DiagnosticCollector,
  diagnostic: FoundationDiagnostic | FoundationValidationDiagnostic,
  fallbackPath: string,
): void {
  if ("stage" in diagnostic) {
    collector.add({
      stage: "records",
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      path: diagnostic.location.locator ?? fallbackPath,
      pointer: diagnostic.location.jsonPointer,
      line: diagnostic.location.line,
      column: diagnostic.location.column,
      length: diagnostic.location.length,
      related: diagnostic.related.map((entry) => entry.id),
      facts: diagnostic.facts,
    });
    return;
  }
  collector.add({
    stage: "records",
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    path: diagnostic.path ?? fallbackPath,
    pointer: diagnostic.pointer,
    line: diagnostic.line,
    column: diagnostic.column,
    length: diagnostic.length,
    related: diagnostic.related,
    facts: diagnostic.facts,
  });
}

function addRecordFailure(collector: DiagnosticCollector, error: unknown, path: string): void {
  if (error instanceof FoundationError && error.diagnostics.length > 0) {
    for (const diagnostic of error.diagnostics) addNestedDiagnostic(collector, diagnostic, path);
    return;
  }
  const diagnostic = asDiagnostic(error, path);
  collector.add({ stage: "records", ...diagnostic });
}

function exactRepositoryView(input: FoundationLoadedRepositoryEpoch): KnowledgeRepositoryView {
  return Object.freeze({
    repository: input.repository,
    contract: input.contract,
    commit: input.epoch.commit,
    tree: input.epoch.tree,
    objectFormat: input.epoch.objectFormat,
    treeEntries: input.treeEntries,
    productStateDigest: input.productState.digest,
    atlasStateDigest: input.atlasState.digest,
    atlasResolutionDigest: input.atlas.resolution.digest,
    atlasNormalizedModelDigest: input.atlas.resolution.normalizedModelDigest,
    atlasResourceBindingsDigest: input.atlas.resolution.resourceBindingsDigest,
  });
}

function coverageIndexes(coverage: readonly FoundationCoverageEntry[]): Pick<FoundationKnowledgeIndex, "coverageByPath" | "coveredPathsByDescription"> {
  const coverageByPath = new Map(coverage.map((entry) => [entry.path, entry]));
  const coveredPathsByDescription = new Map<string, FoundationCoverageEntry[]>();
  for (const entry of coverage) {
    const values = coveredPathsByDescription.get(entry.descriptionId) ?? [];
    values.push(entry);
    coveredPathsByDescription.set(entry.descriptionId, values);
  }
  return Object.freeze({
    coverageByPath,
    coveredPathsByDescription: new Map([...coveredPathsByDescription].sort(([left], [right]) => compareCodePoints(left, right))
      .map(([key, values]) => [key, Object.freeze(values.sort((left, right) => compareCodePoints(left.path, right.path)))])),
  });
}

function buildManifest(options: {
  repository: KnowledgeRepositoryView;
  records: readonly FoundationKnowledgeRecord[];
  relationships: readonly FoundationRelationshipEdge[];
  sources: FoundationKnowledgeSet["sources"];
  conflicts: FoundationKnowledgeSet["conflicts"];
  coverage: readonly FoundationCoverageEntry[];
  exemptions: FoundationKnowledgeSet["exemptions"];
  bindings: FoundationKnowledgeSet["bindings"];
  disciplineRegistry: FoundationDisciplineRegistry;
  complete: boolean;
  valid: boolean;
}): FoundationKnowledgeSetManifest {
  const base: Omit<FoundationKnowledgeSetManifest, "digest"> = {
    schema: "lifecycle.knowledge-set.v2",
    specificationRevision: FOUNDATION_SPECIFICATION_REVISION,
    profile: "knowledge-set-v2",
    repository: Object.freeze({
      targetId: options.repository.contract.targetId,
      commit: options.repository.commit,
      tree: options.repository.tree,
      objectFormat: options.repository.objectFormat,
      contractDigest: options.repository.contract.digest,
      productStateDigest: options.repository.productStateDigest,
      atlasStateDigest: options.repository.atlasStateDigest,
      atlasResolutionDigest: options.repository.atlasResolutionDigest,
      atlasNormalizedModelDigest: options.repository.atlasNormalizedModelDigest,
      atlasResourceBindingsDigest: options.repository.atlasResourceBindingsDigest,
    }),
    disciplineRegistry: options.disciplineRegistry,
    records: Object.freeze(options.records.map((record) => Object.freeze({
      kind: record.frontMatter.kind,
      id: record.frontMatter.id,
      status: record.frontMatter.status,
      revision: record.frontMatter.revision,
      path: record.path,
      sourceDigest: record.sourceDigest,
      semanticDigest: record.semanticDigest,
    }))),
    relationships: options.relationships,
    sources: options.sources,
    conflicts: options.conflicts,
    coverage: Object.freeze(options.coverage.map((entry) => Object.freeze({
      path: entry.path,
      descriptionId: entry.descriptionId,
      descriptionRevision: entry.descriptionRevision,
      selectorPath: entry.selectorPath,
      selectorMode: entry.selectorMode,
    }))),
    exemptions: options.exemptions,
    bindings: Object.freeze(options.bindings.map((entry) => Object.freeze({
      checkId: entry.checkId,
      bindingId: entry.binding.id,
      bindingDigest: entry.binding.digest,
    }))),
    complete: options.complete,
    valid: options.valid,
  };
  return Object.freeze({ ...base, digest: selfDigest(base as unknown as Record<string, unknown>) });
}

export async function validateKnowledgeSet(input: FoundationLoadedRepositoryEpoch): Promise<FoundationKnowledgeSetResult> {
  const repository = exactRepositoryView(input);
  const epochDigest = compilationEpochDigest(input);
  const collector = new DiagnosticCollector();
  const limits = repository.contract.knowledge.limits;
  const candidates = repository.treeEntries
    .filter((entry) => expectedKnowledgeKind(entry.path, repository.contract) !== null)
    .sort((left, right) => compareCodePoints(left.path, right.path));
  let discoveryComplete = true;
  if (candidates.length === 0) {
    collector.add({
      stage: "discovery",
      code: "lifecycle.knowledge.discovery-empty",
      severity: "information",
      message: "Repository contains no governed Knowledge records",
    });
  }
  if (candidates.length > limits.maximumRecords) {
    discoveryComplete = false;
    collector.add({
      stage: "discovery",
      code: "lifecycle.knowledge.limit-exceeded",
      message: `Repository declares ${candidates.length} Knowledge records beyond the ${limits.maximumRecords}-record bound`,
      facts: { maximumRecords: limits.maximumRecords, observedRecords: candidates.length },
    });
  }

  const records: FoundationKnowledgeRecord[] = [];
  let recordsComplete = true;
  let recordBytes = 0;
  for (const entry of candidates.slice(0, limits.maximumRecords)) {
    if (entry.type !== "blob") {
      addRecordFailure(collector, new FoundationError("lifecycle.knowledge.file-kind", `${entry.path} must be one regular Git blob`), entry.path);
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = await objectBlobBytes(repository.repository, entry.objectId, limits.maximumFileBytes);
    } catch (error) {
      // An unread blob is unavailable observation, not conclusive malformed bytes.
      recordsComplete = false;
      addRecordFailure(collector, error, entry.path);
      continue;
    }
    try {
      if (recordBytes + bytes.byteLength > limits.maximumTotalRecordBytes) {
        recordsComplete = false;
        collector.add({
          stage: "records",
          code: "lifecycle.knowledge.limit-exceeded",
          message: `Knowledge record bytes exceed the ${limits.maximumTotalRecordBytes}-byte aggregate bound`,
          path: entry.path,
          facts: { maximumTotalRecordBytes: limits.maximumTotalRecordBytes, nextBytes: bytes.byteLength, observedBefore: recordBytes },
        });
        break;
      }
      recordBytes += bytes.byteLength;
      records.push(parseKnowledgeRecord({ path: entry.path, mode: entry.mode, objectId: entry.objectId, bytes, contract: repository.contract }));
    } catch (error) {
      addRecordFailure(collector, error, entry.path);
    }
  }
  records.sort(compareRecords);

  const frozenRecords = Object.freeze(records);
  const revisions = buildRevisionIndexes({ records: frozenRecords, collector });
  let disciplineRegistry = createEmptyDisciplineRegistry();
  let registryComplete = true;
  const registryPath = repository.contract.knowledge.roots.disciplineRegistry;
  const registryEntry = repository.treeEntries.find((entry) => entry.path === registryPath);
  try {
    if (registryEntry === undefined || registryEntry.type !== "blob" || registryEntry.mode !== "100644") {
      throw new FoundationError(
        "lifecycle.discipline.registry-missing",
        `Repository requires one tracked non-executable Discipline registry at ${registryPath}`,
      );
    }
    disciplineRegistry = parseDisciplineRegistry(
      await objectBlobBytes(repository.repository, registryEntry.objectId, limits.maximumFileBytes),
      repository.contract,
    );
    validateDisciplineRegistryRecords(disciplineRegistry, revisions.currentRecords);
  } catch (error) {
    registryComplete = false;
    addRecordFailure(collector, error, registryPath);
  }
  const sourceResult = await validateKnowledgeSources({
    repository: repository.repository,
    commit: repository.commit,
    contract: repository.contract,
    treeEntries: repository.treeEntries,
    records: frozenRecords,
    disciplineRegistry,
    collector,
  });
  const relationships = buildRelationshipEdges({
    records: frozenRecords,
    revisionsByIdentity: revisions.revisionsByIdentity,
    currentByIdentity: revisions.currentByIdentity,
    collector,
    limits,
  });
  const graph = validateRelationshipGraph({ edges: relationships, currentByIdentity: revisions.currentByIdentity, collector, limits });
  const descriptions = revisions.currentRecords.filter((record) => record.frontMatter.kind === "description");
  const coverageResult = buildDescriptionCoverage({
    contract: repository.contract,
    treeEntries: repository.treeEntries,
    currentDescriptions: descriptions,
    collector,
  });
  const bindings = resolveKnowledgeBindings({
    contract: repository.contract,
    treeEntries: repository.treeEntries,
    currentByIdentity: revisions.currentByIdentity,
    collector,
  });
  const conflicts = detectKnowledgeConflicts({ currentRecords: revisions.currentRecords, currentByIdentity: revisions.currentByIdentity, collector });

  const prerequisiteComplete = discoveryComplete && recordsComplete && registryComplete;
  const complete = prerequisiteComplete && sourceResult.complete && graph.complete;
  const valid = complete && !collector.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  const manifest = buildManifest({
    repository,
    records: frozenRecords,
    relationships,
    sources: sourceResult.resolutions,
    conflicts,
    coverage: coverageResult.coverage,
    exemptions: coverageResult.exemptions,
    bindings,
    disciplineRegistry,
    complete,
    valid,
  });
  const validation = collector.result({
    profile: "knowledge-set-v2",
    subjectKind: "repository-knowledge",
    subjectId: repository.contract.targetId,
    subjectDigest: manifest.digest,
    subjectRevision: repository.commit,
    publicationDigest: repository.contract.specification.publicationDigest,
    implementation: foundationValidationImplementation(
      repository.contract.selections.profiles,
      repository.contract.selections.extensions,
    ),
    stages: STAGES.map((id) => ({
      id,
      complete: id === "discovery" ? discoveryComplete :
        id === "records" ? recordsComplete && registryComplete :
          id === "sources" ? prerequisiteComplete && sourceResult.complete :
            id === "relationships" ? prerequisiteComplete && graph.complete :
              id === "revision" ? prerequisiteComplete : complete,
    })),
    limits: {
      ...limits,
      observedCandidateRecords: candidates.length,
      observedParsedRecords: records.length,
      observedRecordBytes: recordBytes,
      observedDisciplineAdoptions: disciplineRegistry.adoptions.length,
      observedDisciplineWorkTypes: disciplineRegistry.workTypes.length,
      observedRelationships: relationships.length,
      observedGovernedCoverage: coverageResult.coverage.length,
      observedSources: sourceResult.observedCount,
      observedSourceBytes: sourceResult.observedBytes,
      observedConflicts: conflicts.length,
    },
  });
  if (validation.complete !== complete || validation.valid !== valid) {
    throw new FoundationError("lifecycle.knowledge.processor", "Knowledge manifest and validation outcome disagree");
  }
  const relationshipsBy = relationshipIndexes({ records: frozenRecords, edges: relationships });
  const coverageBy = coverageIndexes(coverageResult.coverage);
  const index: FoundationKnowledgeIndex = Object.freeze({
    byIdentityRevision: revisions.byIdentityRevision,
    revisionsByIdentity: revisions.revisionsByIdentity,
    currentByIdentity: revisions.currentByIdentity,
    outgoingByIdentity: relationshipsBy.outgoingByIdentity,
    incomingByIdentity: relationshipsBy.incomingByIdentity,
    coverageByPath: coverageBy.coverageByPath,
    coveredPathsByDescription: coverageBy.coveredPathsByDescription,
    bindingsByCheck: bindingIndex(bindings),
    sourcesByIdentityRevision: sourceResolutionIndex(sourceResult.resolutions),
  });
  const observation: FoundationKnowledgeSet = Object.freeze({
    repository: Object.freeze({
      path: repository.repository,
      contract: repository.contract,
      commit: repository.commit,
      tree: repository.tree,
      objectFormat: repository.objectFormat,
      productStateDigest: repository.productStateDigest,
      atlasStateDigest: repository.atlasStateDigest,
      atlasResolutionDigest: repository.atlasResolutionDigest,
      atlasNormalizedModelDigest: repository.atlasNormalizedModelDigest,
      atlasResourceBindingsDigest: repository.atlasResourceBindingsDigest,
    }),
    records: frozenRecords,
    currentRecords: revisions.currentRecords,
    historicalRecords: revisions.historicalRecords,
    disciplineRegistry,
    relationships,
    coverage: coverageResult.coverage,
    exemptions: coverageResult.exemptions,
    bindings,
    sources: sourceResult.resolutions,
    conflicts,
    validation,
    manifest,
    index,
  });
  const result: FoundationKnowledgeSetResult = Object.freeze({
    validation,
    observation,
    knowledgeSet: validation.complete && validation.valid ? observation : null,
  });
  if (result.knowledgeSet !== null) {
    compiledKnowledge.set(result.knowledgeSet, Object.freeze({
      epoch: input,
      epochDigest,
      carrierDigest: compilationCarrierDigest(result.knowledgeSet),
      result,
    }));
  }
  return result;
}

export async function loadKnowledgeSet(input: FoundationLoadedRepositoryEpoch): Promise<FoundationKnowledgeSet> {
  const result = await validateKnowledgeSet(input);
  if (result.knowledgeSet === null || !result.validation.complete || !result.validation.valid) {
    throw new FoundationError("lifecycle.knowledge.invalid", "Repository Knowledge Set is incomplete or invalid", {
      diagnostics: result.validation.diagnostics,
      observedFacts: { validationResultDigest: result.validation.digest },
    });
  }
  return result.knowledgeSet;
}

export type FoundationCanonicalKnowledgeSet = Readonly<Omit<FoundationKnowledgeSet, "index">>;

/**
 * Rebuild runtime-only Map indexes from one exact canonical Knowledge carrier.
 * Durable Process storage retains the carrier once and never serializes Map
 * implementation objects as if they were repository-authored truth.
 */
export function restoreFoundationKnowledgeSetIndex(
  value: FoundationCanonicalKnowledgeSet,
): FoundationKnowledgeSet {
  if (value.manifest.digest !== selfDigest(value.manifest as unknown as Readonly<Record<string, unknown>>)) {
    throw new FoundationError("lifecycle.knowledge.manifest-digest", "Retained Knowledge manifest self-digest is invalid");
  }
  const collector = new DiagnosticCollector();
  const revisions = buildRevisionIndexes({ records: value.records, collector });
  if (collector.diagnostics.some(({ severity }) => severity === "error") ||
      canonicalJson(revisions.currentRecords) !== canonicalJson(value.currentRecords) ||
      canonicalJson(revisions.historicalRecords) !== canonicalJson(value.historicalRecords)) {
    throw new FoundationError("lifecycle.knowledge.index-invalid", "Retained Knowledge records do not reproduce their exact revision indexes");
  }
  const relationshipsBy = relationshipIndexes({ records: value.records, edges: value.relationships });
  const coverageBy = coverageIndexes(value.coverage);
  const index: FoundationKnowledgeIndex = Object.freeze({
    byIdentityRevision: revisions.byIdentityRevision,
    revisionsByIdentity: revisions.revisionsByIdentity,
    currentByIdentity: revisions.currentByIdentity,
    outgoingByIdentity: relationshipsBy.outgoingByIdentity,
    incomingByIdentity: relationshipsBy.incomingByIdentity,
    coverageByPath: coverageBy.coverageByPath,
    coveredPathsByDescription: coverageBy.coveredPathsByDescription,
    bindingsByCheck: bindingIndex(value.bindings),
    sourcesByIdentityRevision: sourceResolutionIndex(value.sources),
  });
  return Object.freeze({ ...value, index });
}

export const FOUNDATION_KNOWLEDGE_IMPLEMENTATION = FOUNDATION_COMPILER;
