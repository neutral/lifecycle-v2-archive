import { FoundationError } from "../error.js";
import { knowledgeOccurrenceItemId } from "../knowledge/identity.js";
import { canonicalJson, digestCanonical, selfDigest, sha256Bytes, type Sha256 } from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import { assertFoundationSchema } from "../validation/schema-engine.js";
import { decodeInventoryBytes } from "./content.js";
import { FOUNDATION_PROJECTION_REACHABLE_CATEGORIES } from "./orientation.js";
import { parseOrientationObjective } from "./orientation-objective.js";
import type {
  FoundationCompiledProjection,
  FoundationExecutionProjectionSubject,
  FoundationProjectionByteInventoryEntry,
  FoundationProjectionCacheKey,
  FoundationProjectionProposition,
  FoundationProjectionRequest,
} from "./types.js";

const KNOWLEDGE_KIND_ORDER = new Map([
  ["behavior", 0],
  ["assurance", 1],
  ["blueprint", 2],
  ["description", 3],
  ["check", 4],
  ["discipline", 5],
]);
const REACHABLE_CATEGORY_ORDER = new Map(FOUNDATION_PROJECTION_REACHABLE_CATEGORIES.map((category, index) => [category, index]));

function revisionSortKey(revision: string | number | null): string {
  if (revision === null) return "0:";
  return typeof revision === "number" ? `1:${revision.toString().padStart(16, "0")}` : `2:${revision}`;
}

function assertStrictlyOrdered<T>(values: readonly T[], key: (value: T) => string, label: string): void {
  for (let index = 1; index < values.length; index += 1) {
    if (compareCodePoints(key(values[index - 1]!), key(values[index]!)) >= 0) {
      throw new FoundationError("lifecycle.projection.order-invalid", `${label} is not unique and deterministically code-point ordered`);
    }
  }
}

export function assertProjectionPropositionOrder(
  propositions: readonly FoundationProjectionProposition[],
): void {
  assertStrictlyOrdered(
    propositions,
    ({ id }) => id,
    "Execution Projection propositions",
  );
}

function assertIndexDigest(value: Readonly<{ digest: Sha256 }>, label: string): void {
  if (selfDigest(value as unknown as Record<string, unknown>) !== value.digest) {
    throw new FoundationError("lifecycle.projection.index-invalid", `${label} self-digest is invalid`);
  }
}

export function projectionCacheKey(options: {
  request: FoundationProjectionRequest;
  compilerDigest: Sha256;
  basis: FoundationCompiledProjection["manifest"]["basis"];
  executionSubject?: FoundationExecutionProjectionSubject | null;
}): FoundationProjectionCacheKey {
  const requestSubjectDigest = options.request.class === "orientation"
    ? options.request.subject.objectiveDigest
    : options.executionSubject?.subjectDigest;
  if (requestSubjectDigest === undefined) {
    throw new FoundationError("lifecycle.projection.boundary-invalid", "Execution cache identity requires the exact execution data subject digest");
  }
  const subject = {
    specificationRevision: options.request.specificationRevision,
    compilerDigest: options.compilerDigest,
    class: options.request.class,
    role: options.request.role,
    profile: options.request.profile.id,
    basis: options.basis,
    profileBoundsDigest: options.request.profile.digest,
    requestSubjectDigest,
    retrievalPolicyDigest: digestCanonical(options.request.retrieval),
  };
  return Object.freeze({ ...subject, digest: digestCanonical(subject) }) as FoundationProjectionCacheKey;
}

function itemDigest(value: Record<string, unknown>): Sha256 {
  const { itemDigest: _digest, ...subject } = value;
  return digestCanonical(subject);
}

function inventoryIndex(inventory: readonly FoundationProjectionByteInventoryEntry[]): ReadonlyMap<string, FoundationProjectionByteInventoryEntry> {
  const values = new Map<string, FoundationProjectionByteInventoryEntry>();
  const keys = new Set<string>();
  for (const entry of inventory) {
    if (values.has(entry.path)) throw new FoundationError("lifecycle.projection.order-invalid", `Projection bundle path is duplicated: ${entry.path}`);
    const key = `${entry.tier}\0${entry.key}`;
    if (keys.has(key)) throw new FoundationError("lifecycle.projection.order-invalid", `Projection bundle key is duplicated: ${entry.key}`);
    decodeInventoryBytes(entry);
    values.set(entry.path, entry);
    keys.add(key);
  }
  assertStrictlyOrdered(inventory, (entry) => `${entry.tier}\0${entry.key}`, "Projection byte inventory");
  return values;
}

export function verifyCompiledProjection(compiled: FoundationCompiledProjection): void {
  assertFoundationSchema("urn:lifecycle:schema:knowledge-projection:v6", compiled.manifest, "knowledge-projection");
  if (compiled.manifest.schema !== "lifecycle.knowledge-projection.v6") {
    throw new FoundationError("lifecycle.projection.content-digest", "Projection manifest schema is invalid");
  }
  if (selfDigest(compiled.manifest as unknown as Record<string, unknown>) !== compiled.manifest.digest) {
    throw new FoundationError("lifecycle.projection.content-digest", "Projection manifest self-digest is invalid");
  }
  const expectedCompiler = digestCanonical({ id: compiled.manifest.compiler.id, version: compiled.manifest.compiler.version });
  if (expectedCompiler !== compiled.manifest.compiler.digest) {
    throw new FoundationError("lifecycle.projection.content-digest", "Projection compiler self-digest is invalid");
  }
  const expectedProjectionId = `projection:${digestCanonical({
    compilerDigest: compiled.manifest.compiler.digest,
    requestDigest: compiled.manifest.basis.requestDigest,
  }).slice("sha256:".length)}`;
  if (compiled.manifest.projectionId !== expectedProjectionId) {
    throw new FoundationError("lifecycle.projection.content-digest", "Projection identity does not bind the exact request and compiler digests");
  }
  const basis = compiled.manifest.basis;
  if (compiled.manifest.class === "orientation") {
    if (compiled.manifest.role !== "reconnaissance" || compiled.manifest.core.class !== "orientation" ||
        basis.repositorySnapshotDigest !== null || basis.repositoryValidationDigest !== null ||
        basis.workBoundary !== null || basis.candidate !== null) {
      throw new FoundationError("lifecycle.projection.basis-mismatch", "Orientation Projection claims an Execution Snapshot, Work Boundary, candidate, or role");
    }
  } else if (compiled.manifest.role === "reconnaissance" || compiled.manifest.core.class !== "execution" ||
      basis.repositorySnapshotDigest === null || basis.repositoryValidationDigest === null ||
      basis.knowledgeSetDigest === null || basis.workBoundary === null ||
      compiled.manifest.core.requestDigest !== basis.requestDigest ||
      compiled.manifest.core.workBoundaryDigest !== basis.workBoundary.digest) {
    throw new FoundationError("lifecycle.projection.basis-mismatch", "Execution Projection lacks or contradicts its exact Snapshot, Knowledge Set, Work Boundary, request, or execution role");
  }
  if (compiled.manifest.core.class === "execution") {
    const core = compiled.manifest.core;
    assertProjectionPropositionOrder(core.propositions);
    assertStrictlyOrdered(core.disciplines.workTypeIds, (id) => id, "Execution Discipline work types");
    assertStrictlyOrdered(core.disciplines.records, (record) => record.id, "Execution Discipline records");
    for (const record of core.disciplines.records) {
      const admittedItemId = knowledgeOccurrenceItemId({ basis: "base", ...record });
      const selected = compiled.manifest.mandatory.filter((item) =>
        item.id === admittedItemId && item.sourceIdentity === record.id && item.kind === "discipline" &&
        item.revision === record.revision && item.sourceDigest === record.sourceDigest &&
        item.semanticDigest === record.semanticDigest && item.locator === record.path);
      if (selected.length !== 1 || selected[0]!.authority !== "discipline-guidance") {
        throw new FoundationError(
          "lifecycle.projection.discipline-invalid",
          `Selected Discipline ${record.id} is not bound to one exact admitted advisory occurrence`,
        );
      }
    }
  }
  if (compiled.manifest.profile !== compiled.manifest.omission.profile ||
      compiled.manifest.profileDigest !== compiled.manifest.omission.profileDigest ||
      selfDigest({
        id: compiled.manifest.profile,
        ...compiled.manifest.omission.bounds,
        digest: compiled.manifest.profileDigest,
      }) !== compiled.manifest.profileDigest) {
    throw new FoundationError("lifecycle.projection.profile-mismatch", "Projection profile identity, self-digest, bounds, and omission manifest disagree");
  }
  for (const item of compiled.manifest.mandatory) {
    if (item.kind === "discipline" && item.authority !== "discipline-guidance") {
      throw new FoundationError(
        "lifecycle.projection.discipline-invalid",
        `Discipline ${item.sourceIdentity} must retain advisory guidance authority in every Projection`,
      );
    }
  }
  const inventory = inventoryIndex(compiled.inventory);
  const tierTwo = [
    ...compiled.manifest.atlas,
    ...compiled.manifest.mandatory,
    ...compiled.manifest.implementation,
    ...compiled.manifest.bindings,
    ...compiled.manifest.sources,
  ];
  for (const item of tierTwo) {
    if (itemDigest(item as unknown as Record<string, unknown>) !== item.itemDigest) {
      throw new FoundationError("lifecycle.projection.content-digest", `Projection Tier-2 item digest is invalid: ${item.id}`);
    }
    const content = item.content;
    if (content.mode === "inline") {
      const bytes = Buffer.from(content.text, "utf8");
      if (bytes.byteLength !== content.byteLength || sha256Bytes(bytes) !== content.digest) {
        throw new FoundationError("lifecycle.projection.content-digest", `Inline content is corrupt: ${item.id}`);
      }
      continue;
    }
    const entry = inventory.get(content.path);
    if (entry === undefined || entry.tier !== "mandatory" || entry.digest !== content.digest || entry.byteLength !== content.byteLength) {
      throw new FoundationError("lifecycle.projection.content-digest", `Mounted Tier-2 content is missing or stale: ${item.id}`);
    }
  }
  const kindKey = (kind: string | null): string => String(KNOWLEDGE_KIND_ORDER.get(kind ?? "") ?? 99).padStart(2, "0");
  assertStrictlyOrdered(compiled.manifest.mandatory, (item) =>
    `${kindKey(item.kind)}\0${item.sourceIdentity}\0${revisionSortKey(item.revision)}\0${item.locator}\0${item.id}`, "Projection mandatory items");
  const atlasKindOrder = ["atlas", "map", "point-anchor", "point-context", "resource", "check", "publication-profile"];
  assertStrictlyOrdered(compiled.manifest.atlas, (item) =>
    `${String(atlasKindOrder.indexOf(item.unitKind)).padStart(2, "0")}\0${item.unitId}\0${item.mapId ?? ""}\0${item.sourcePath}\0${item.id}`, "Projection Atlas semantic units");
  assertStrictlyOrdered(compiled.manifest.implementation, (item) => `${item.path}\0${item.id}`, "Projection implementation items");
  assertStrictlyOrdered(compiled.manifest.bindings, (item) => `${item.id}\0${item.compatibleCheckIds.join("\0")}`, "Projection Binding items");
  assertStrictlyOrdered(compiled.manifest.sources, (item) => `${item.reference}\0${item.revision ?? ""}\0${item.id}`, "Projection source items");
  const evidenceIdentities = new Set<string>();
  for (const source of compiled.manifest.sources) {
    if (source.semantic.class !== "evidence") continue;
    if (evidenceIdentities.has(source.semantic.subjectId)) {
      throw new FoundationError(
        "lifecycle.projection.order-invalid",
        `Projection Evidence identity is duplicated: ${source.semantic.subjectId}`,
      );
    }
    evidenceIdentities.add(source.semantic.subjectId);
  }
  assertStrictlyOrdered(compiled.manifest.conflicts, (item) => `${item.code}\0${item.id}`, "Projection conflicts");
  assertStrictlyOrdered(compiled.manifest.unresolved, (item) =>
    `${item.required ? "0" : "1"}\0${item.reference}\0${item.id}`, "Projection unresolved items");
  for (const item of compiled.manifest.bindings) {
    if (selfDigest(item.binding as unknown as Record<string, unknown>) !== item.binding.digest ||
        item.binding.digest !== item.bindingDigest ||
        canonicalJson(item.binding.checkIds) !== canonicalJson(item.checkIds)) {
      throw new FoundationError("lifecycle.projection.content-digest", `Projection Binding carrier is stale: ${item.id}`);
    }
    assertStrictlyOrdered(item.compatibleCheckIds, (value) => value, `Projection Binding ${item.id} compatible Check identities`);
  }
  for (const item of compiled.manifest.reachable) {
    if (item.retrieval === "mounted") {
      const entry = item.mountedPath === null ? undefined : inventory.get(item.mountedPath);
      if (entry === undefined || entry.tier !== "reachable" || entry.key !== item.handle || entry.digest !== item.digest || entry.byteLength !== item.byteLength) {
        throw new FoundationError("lifecycle.projection.content-digest", `Mounted reachable content is missing or stale: ${item.id}`);
      }
    } else if (item.mountedPath !== null) {
      throw new FoundationError("lifecycle.projection.content-digest", `Non-mounted reachable content carries a bundle path: ${item.id}`);
    }
  }
  assertStrictlyOrdered(compiled.manifest.reachable, (item) =>
    `${String(REACHABLE_CATEGORY_ORDER.get(item.category) ?? 99).padStart(2, "0")}\0${item.id}\0${item.handle}`, "Projection reachable items");
  if (compiled.manifest.core.class === "orientation") {
    const core = compiled.manifest.core;
    parseOrientationObjective(core.objective);
    assertIndexDigest(core.knowledgeIndex, "Orientation Knowledge index");
    assertIndexDigest(core.disciplineIndex, "Orientation Discipline index");
    assertIndexDigest(core.coverageIndex, "Orientation coverage index");
    assertIndexDigest(core.bindingIndex, "Orientation Binding index");
    assertIndexDigest(core.capabilityIndex, "Orientation Capability index");
    assertIndexDigest(core.profileIndex, "Orientation profile index");
    assertIndexDigest(core.retrievalIndex, "Orientation retrieval index");
    if (digestCanonical({
      knowledgeIndexDigest: core.knowledgeIndex.digest,
      disciplineIndexDigest: core.disciplineIndex.digest,
      coverageIndexDigest: core.coverageIndex.digest,
      bindingIndexDigest: core.bindingIndex.digest,
      capabilityIndexDigest: core.capabilityIndex.digest,
      profileIndexDigest: core.profileIndex.digest,
      retrievalIndexDigest: core.retrievalIndex.digest,
    }) !== core.indexDigest) {
      throw new FoundationError("lifecycle.projection.index-invalid", "Orientation combined index digest is invalid");
    }
    const coverage = core.coverageIndex.summary;
    if (coverage.governedImplementationItems !== coverage.coveredItems + coverage.missingItems + coverage.ambiguousItems + coverage.exemptionItems) {
      throw new FoundationError("lifecycle.projection.index-invalid", "Orientation coverage summary does not enumerate every governed implementation item");
    }
    for (const entry of core.bindingIndex.entries) {
      if (selfDigest(entry.binding as unknown as Record<string, unknown>) !== entry.binding.digest ||
          entry.binding.digest !== entry.digest || canonicalJson(entry.binding.checkIds) !== canonicalJson(entry.checkIds)) {
        throw new FoundationError("lifecycle.projection.index-invalid", `Orientation Binding index entry is stale: ${entry.id}`);
      }
    }
    for (const entry of core.capabilityIndex.entries) {
      if (selfDigest(entry.profile as unknown as Record<string, unknown>) !== entry.profile.digest || entry.profile.digest !== entry.digest) {
        throw new FoundationError("lifecycle.projection.index-invalid", `Orientation Capability index entry is stale: ${entry.id}`);
      }
    }
    for (const entry of core.profileIndex.entries) {
      if (selfDigest(entry as unknown as Record<string, unknown>) !== entry.digest) {
        throw new FoundationError("lifecycle.projection.index-invalid", `Orientation profile index entry is stale: ${entry.id}`);
      }
    }
    const expectedRetrieval = compiled.manifest.reachable.map((entry) => ({
      handle: entry.handle,
      id: entry.id,
      kind: entry.kind,
      digest: entry.digest,
      byteLength: entry.byteLength,
      availability: entry.retrieval,
    }));
    if (canonicalJson(core.retrievalIndex.entries) !== canonicalJson(expectedRetrieval)) {
      throw new FoundationError("lifecycle.projection.index-invalid", "Orientation retrieval index differs from exact reachable material");
    }
  }
  const pair = (items: readonly { content: { byteLength: number } }[]) => ({
    items: items.length,
    bytes: items.reduce((total, item) => total + item.content.byteLength, 0),
  });
  const counts = compiled.manifest.counts;
  const expectedPairs = {
    atlas: pair(compiled.manifest.atlas),
    mandatory: pair(compiled.manifest.mandatory),
    implementation: pair(compiled.manifest.implementation),
    bindings: pair(compiled.manifest.bindings),
    sources: pair(compiled.manifest.sources),
    reachable: {
      items: compiled.manifest.reachable.length,
      bytes: compiled.manifest.reachable.reduce((total, item) => total + item.byteLength, 0),
    },
  };
  const coreBytes = Buffer.byteLength(canonicalJson(compiled.manifest.core), "utf8");
  const totalBytes = coreBytes + Object.values(expectedPairs).reduce((total, value) => total + value.bytes, 0);
  if (counts.coreBytes !== coreBytes || counts.totalBytes !== totalBytes ||
      counts.conflicts !== compiled.manifest.conflicts.length || counts.unresolved !== compiled.manifest.unresolved.length ||
      canonicalJson(counts.mandatory) !== canonicalJson(expectedPairs.mandatory) ||
      canonicalJson(counts.atlas) !== canonicalJson(expectedPairs.atlas) ||
      canonicalJson(counts.implementation) !== canonicalJson(expectedPairs.implementation) ||
      canonicalJson(counts.bindings) !== canonicalJson(expectedPairs.bindings) ||
      canonicalJson(counts.sources) !== canonicalJson(expectedPairs.sources) ||
      canonicalJson(counts.reachable) !== canonicalJson(expectedPairs.reachable)) {
    throw new FoundationError("lifecycle.projection.counts-invalid", "Projection count pairs or total bytes are not exact");
  }
  const bounds = compiled.manifest.omission.bounds;
  const mandatoryItems = counts.atlas.items + counts.mandatory.items + counts.implementation.items + counts.bindings.items + counts.sources.items;
  const mandatoryBytes = counts.coreBytes + counts.atlas.bytes + counts.mandatory.bytes + counts.implementation.bytes + counts.bindings.bytes + counts.sources.bytes;
  if (mandatoryItems > bounds.maximumMandatoryItems || mandatoryBytes > bounds.maximumMandatoryBytes ||
      counts.sources.bytes > bounds.maximumSourceBytes || tierTwo.some((item) => item.content.byteLength > bounds.maximumItemBytes)) {
    throw new FoundationError("lifecycle.projection.mandatory-too-large", "Projection violates its exact seven selected bounds");
  }
  if (counts.reachable.items > bounds.maximumReachableItems || counts.reachable.bytes > bounds.maximumReachableBytes) {
    throw new FoundationError("lifecycle.projection.bounds-invalid", "Projection reachable material violates its selected bounds");
  }
  if (compiled.manifest.omission.mandatoryOmissions !== 0) {
    throw new FoundationError("lifecycle.projection.mandatory-omission", "Projection omission manifest claims omitted mandatory material");
  }
  if (canonicalJson(compiled.manifest.omission.eligibleCategories) !== canonicalJson(FOUNDATION_PROJECTION_REACHABLE_CATEGORIES) ||
      compiled.manifest.omission.policy !== "category-code-point-prefix-v1" ||
      compiled.manifest.omission.categories.length !== FOUNDATION_PROJECTION_REACHABLE_CATEGORIES.length) {
    throw new FoundationError("lifecycle.projection.counts-invalid", "Projection omission policy or eligible categories are invalid");
  }
  for (let index = 0; index < FOUNDATION_PROJECTION_REACHABLE_CATEGORIES.length; index += 1) {
    const category = compiled.manifest.omission.categories[index]!;
    const reachable = compiled.manifest.reachable.filter((entry) => entry.category === category.category);
    if (category.category !== FOUNDATION_PROJECTION_REACHABLE_CATEGORIES[index] ||
        new Set(category.omittedIds).size !== category.omittedIds.length ||
        [...category.omittedIds].sort(compareCodePoints).some((value, itemIndex) => value !== category.omittedIds[itemIndex])) {
      throw new FoundationError("lifecycle.projection.order-invalid", `Projection omission category order is invalid: ${category.category}`);
    }
    if (!category.enumerationComplete || category.before.items !== category.after.items + category.omitted.items ||
        category.before.bytes !== category.after.bytes + category.omitted.bytes ||
        category.after.items !== reachable.length ||
        category.after.bytes !== reachable.reduce((total, entry) => total + entry.byteLength, 0) ||
        category.omitted.items !== category.omittedIds.length ||
        category.omitted.bytes < 0) {
      throw new FoundationError("lifecycle.projection.counts-invalid", `Projection omission category is not exact: ${category.category}`);
    }
  }
  if (canonicalJson(compiled.cacheKey.basis) !== canonicalJson(compiled.manifest.basis)) {
    throw new FoundationError("lifecycle.projection.cache-stale", "Projection cache basis differs from the manifest basis");
  }
  const usedPaths = new Set<string>();
  for (const item of tierTwo) if (item.content.mode === "mounted") usedPaths.add(item.content.path);
  for (const item of compiled.manifest.reachable) if (item.mountedPath !== null) usedPaths.add(item.mountedPath);
  if (usedPaths.size !== compiled.inventory.length || compiled.inventory.some((entry) => !usedPaths.has(entry.path))) {
    throw new FoundationError("lifecycle.projection.content-digest", "Projection byte inventory contains missing or unreferenced bundle entries");
  }
  const expectedCache = digestCanonical((({ digest: _digest, ...subject }) => subject)(compiled.cacheKey));
  if (expectedCache !== compiled.cacheKey.digest) {
    throw new FoundationError("lifecycle.projection.cache-stale", "Projection cache key self-digest is invalid");
  }
}

export function assertProjectionCacheHit(options: {
  compiled: FoundationCompiledProjection;
  expected: FoundationProjectionCacheKey;
}): void {
  verifyCompiledProjection(options.compiled);
  if (canonicalJson(options.compiled.cacheKey) !== canonicalJson(options.expected)) {
    throw new FoundationError("lifecycle.projection.cache-stale", "Cached Projection does not match every exact cache-key fact");
  }
}

export function projectionBundleFiles(compiled: FoundationCompiledProjection): readonly Readonly<{
  path: string;
  digest: Sha256;
  bytes: Uint8Array;
}>[] {
  verifyCompiledProjection(compiled);
  return Object.freeze([...compiled.inventory]
    .sort((left, right) => compareCodePoints(left.path, right.path))
    .map((entry) => Object.freeze({ path: entry.path, digest: entry.digest, bytes: Uint8Array.from(decodeInventoryBytes(entry)) })));
}

export async function materializeProjectionBundle(
  compiled: FoundationCompiledProjection,
  consume: (entry: Readonly<{ path: string; digest: Sha256; bytes: Uint8Array }>) => Promise<void>,
): Promise<void> {
  for (const entry of projectionBundleFiles(compiled)) await consume(entry);
}
