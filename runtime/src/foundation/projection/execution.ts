import { TextDecoder } from "node:util";
import {
  assertDeliveryControlRecordPolicy,
} from "../control/kind-registry.js";
import { compileControlRecordRevision } from "../control/model.js";
import { assertDeliveryControlRecordPayload } from "../control/payload-registry.js";
import { resolveFailedIntegrationCorrectionV1, type FoundationFailedIntegrationCorrectionV1 } from "../control/integration-assessment.js";
import type {
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordRelationshipTarget,
  ControlRecordRevision,
} from "../control/types.js";
import { FoundationError } from "../error.js";
import { knowledgeOrControlPath } from "../knowledge/coverage.js";
import { knowledgeOccurrence, knowledgeOccurrenceItemId } from "../knowledge/identity.js";
import type {
  FoundationEvidenceKind,
  FoundationKnowledgeRecord,
  FoundationKnowledgeOccurrence,
  FoundationKnowledgeSet,
  FoundationKnowledgeSourceResolution,
} from "../knowledge/types.js";
import { exactBlobSizes, exactTreeEntries, objectBlobBytes } from "../repository/git.js";
import type { FoundationBuilderRepairRepositoryV1 } from "../candidate/repair-output.js";
import { buildProductState } from "../repository/product-state.js";
import type {
  FoundationCheckBinding,
  FoundationGitTreeEntry,
  FoundationLoadedRepositorySnapshot,
  FoundationProductState,
  FoundationProjectionProfile,
} from "../repository/types.js";
import {
  canonicalJson,
  canonicalPrettyJson,
  digestCanonical,
  selfDigest,
  sha256Bytes,
  type Sha256,
} from "../validation/canonical.js";
import { compareCodePoints, sortUniqueCodePoints } from "../validation/ordering.js";
import {
  buildMandatoryItem,
  buildTierTwoItem,
  ProjectionByteInventoryBuilder,
  projectionIndexBytes,
} from "./content.js";
import { foundationRepositorySourceMaterials } from "./source-context.js";
import type {
  FoundationExecutionProjectionRequest,
  FoundationExecutionProjectionSubject,
  FoundationProjectionBindingItem,
  FoundationProjectionByteInventoryEntry,
  FoundationProjectionConflict,
  FoundationProjectionImplementationItem,
  FoundationProjectionMandatoryItem,
  FoundationProjectionOmission,
  FoundationProjectionOmissionCategory,
  FoundationProjectionPresentationHint,
  FoundationProjectionReachableCategory,
  FoundationProjectionReachableItem,
  FoundationProjectionSourceItem,
  FoundationProjectionSourceRoot,
  FoundationProjectionUnresolved,
} from "./types.js";
import { buildClosure, descriptionsForPath, requireOneDescription, governedPath, seedSubject,
  type ClosureEntry, type ClosureSeed } from "./execution-closure.js";
import { assertProjectionPropositionOrder } from "./verification.js";
import { mandatoryProjectionItemSizeErrorV1 } from "./mandatory-refusal.js";

const KIND_ORDER = new Map([
  ["behavior", 0],
  ["assurance", 1],
  ["blueprint", 2],
  ["description", 3],
  ["check", 4],
  ["discipline", 5],
]);

const REACHABLE_CATEGORIES: readonly FoundationProjectionReachableCategory[] = Object.freeze([
  "related-knowledge",
  "atlas-context",
  "provenance-source",
  "historical-revision",
  "neighboring-description",
  "unaffected-implementation",
]);
const REACHABLE_CATEGORY_ORDER = new Map(REACHABLE_CATEGORIES.map((category, index) => [category, index]));
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * Exact retained and runtime-observed Candidate material consumed by reviewer
 * Projection. The Control revisions own the logical facts; the supplied tree,
 * Knowledge, and diff bytes are independently reproduced against those facts.
 */
export type FoundationReviewerProjectionObservation = Readonly<{
  seal: ControlRecordRevision;
  candidate: ControlRecordRevision;
  treeEntries: readonly FoundationGitTreeEntry[];
  knowledge: FoundationKnowledgeSet;
  diff: Readonly<{ digest: Sha256; bytes: Uint8Array }>;
}>;

/** A separately reopened, complete exact integration-parent observation. */
export type FoundationIntegrationProjectionRecords = Readonly<{
  assessment: ControlRecordRevision;
  sourceCandidate: ControlRecordRevision;
}>;

export type FoundationIntegrationParentProjectionInput = Readonly<{
  loaded: FoundationLoadedRepositorySnapshot;
  knowledge: FoundationKnowledgeSet;
}>;

export type FoundationFailedIntegrationProjectionInput = Readonly<{
  correction: FoundationFailedIntegrationCorrectionV1;
  parent: FoundationIntegrationParentProjectionInput;
}>;

/** Exact retained Agent claim and the Attempt subject it results from. */
export type FoundationAgentWorkProductProjectionEvidence = Readonly<{
  workProduct: ControlRecordRevision;
  attempt: ControlRecordRevision;
}>;

type FoundationReviewerCandidateChange = Readonly<{
  path: string;
  change: "added" | "modified" | "deleted" | "mode-changed" | "type-changed";
  beforeDigest: Sha256 | null;
  afterDigest: Sha256 | null;
}>;

type FoundationVerifiedReviewerProjectionObservation =
  FoundationReviewerProjectionObservation & Readonly<{
    seal: ControlRecordRevision;
    candidate: ControlRecordRevision;
    changes: readonly FoundationReviewerCandidateChange[];
    productState: FoundationProductState;
    candidateBaseCommit: string;
    candidateDigest: Sha256;
    sealedTree: string;
    diffDigest: Sha256;
  }>;

export type FoundationExecutionCompilation = Readonly<{
  mandatory: readonly FoundationProjectionMandatoryItem[];
  implementation: readonly FoundationProjectionImplementationItem[];
  bindings: readonly FoundationProjectionBindingItem[];
  sources: readonly FoundationProjectionSourceItem[];
  reachable: readonly FoundationProjectionReachableItem[];
  conflicts: readonly FoundationProjectionConflict[];
  unresolved: readonly FoundationProjectionUnresolved[];
  omission: FoundationProjectionOmission;
  inventory: readonly FoundationProjectionByteInventoryEntry[];
}>;

type ReachableCandidate = Readonly<{
  id: string;
  category: FoundationProjectionReachableCategory;
  kind: string;
  summary: string;
  sourceRevision: string | null;
  digest: Sha256;
  objectId: string | null;
  bytes: Buffer | null;
  byteLength: number;
}>;

function atOrBelow(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function stableId(prefix: string, value: unknown): string {
  return `${prefix}.${digestCanonical(value).slice("sha256:".length)}`;
}

function controlObject(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== "object") {
    throw new FoundationError("lifecycle.projection.control-invalid", `${label} must be one exact Control object`);
  }
  return value as ControlJsonObject;
}

function controlArray(value: ControlJsonValue | undefined, label: string): readonly ControlJsonValue[] {
  if (!Array.isArray(value)) {
    throw new FoundationError("lifecycle.projection.control-invalid", `${label} must be one exact Control array`);
  }
  return value;
}

function controlString(value: ControlJsonValue | undefined, label: string): string {
  if (typeof value !== "string") {
    throw new FoundationError("lifecycle.projection.control-invalid", `${label} must be retained text`);
  }
  return value;
}

function controlDigest(value: ControlJsonValue | undefined, label: string): Sha256 {
  const selected = controlString(value, label);
  if (!/^sha256:[a-f0-9]{64}$/u.test(selected)) {
    throw new FoundationError("lifecycle.projection.control-invalid", `${label} must be one lowercase SHA-256 digest`);
  }
  return selected as Sha256;
}

function exactControlRevision(
  supplied: ControlRecordRevision,
  expectedKind: string,
  label: string,
): ControlRecordRevision {
  if (supplied.recordKind !== expectedKind) {
    throw new FoundationError(
      "lifecycle.projection.control-invalid",
      `${label} substitutes ${supplied.recordKind} for ${expectedKind}`,
    );
  }
  const reproduced = compileControlRecordRevision(supplied.processId, {
    recordId: supplied.recordId,
    recordKind: supplied.recordKind,
    revision: supplied.revision,
    producer: supplied.producer,
    semanticAuthor: supplied.semanticAuthor,
    semanticAuthority: supplied.semanticAuthority,
    createdAt: supplied.createdAt,
    semanticMarkdown: supplied.semanticMarkdown,
    payload: supplied.payload,
    relationships: supplied.relationships,
  });
  assertDeliveryControlRecordPolicy(reproduced);
  assertDeliveryControlRecordPayload(reproduced);
  if (canonicalJson(reproduced) !== canonicalJson(supplied)) {
    throw new FoundationError(
      "lifecycle.projection.control-invalid",
      `${label} does not reproduce one exact retained logical revision`,
    );
  }
  return reproduced;
}

function exactRelationship(
  revision: ControlRecordRevision,
  relation: string,
  targetKind: string,
): ControlRecordRelationshipTarget {
  const matches = revision.relationships.filter(({ relation: selected }) => selected === relation);
  if (matches.length !== 1 || matches[0]!.target.kind !== targetKind) {
    throw new FoundationError(
      "lifecycle.projection.control-invalid",
      `${revision.recordKind} requires one exact ${relation} relationship to ${targetKind}`,
    );
  }
  return matches[0]!.target;
}

function sameControlReference(
  left: Readonly<{ kind: string; id: string; revision: number; digest: Sha256 }>,
  right: Readonly<{ kind: string; id: string; revision: number; digest: Sha256 }>,
): boolean {
  return left.kind === right.kind &&
    left.id === right.id &&
    left.revision === right.revision &&
    left.digest === right.digest;
}

function controlRevisionReference(revision: ControlRecordRevision): Readonly<{
  kind: string;
  id: string;
  revision: number;
  digest: Sha256;
}> {
  return Object.freeze({
    kind: revision.recordKind,
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

/**
 * Render one exact logical Control revision for provider-visible Projection.
 *
 * The SQLite value remains the retained authority. This deterministic view
 * keeps runtime-owned typed facts and relationships visible beside the
 * retained semantic Markdown without pretending the rendering is a second
 * retained record or the revision's logical identity.
 */
function controlProjectionBytes(revision: ControlRecordRevision): Buffer {
  const operational = canonicalPrettyJson({
    schema: revision.schema,
    processId: revision.processId,
    recordId: revision.recordId,
    recordKind: revision.recordKind,
    revision: revision.revision,
    digest: revision.digest,
    producer: revision.producer,
    semanticAuthor: revision.semanticAuthor,
    semanticAuthority: revision.semanticAuthority,
    createdAt: revision.createdAt,
    payload: revision.payload,
    relationships: revision.relationships,
  }).trimEnd();
  return Buffer.from([
    "---",
    operational,
    "---",
    revision.semanticMarkdown.trimEnd(),
    "",
  ].join("\n"), "utf8");
}

function exactBoundaryRevision(
  request: FoundationExecutionProjectionRequest,
  supplied: ControlRecordRevision | null,
): ControlRecordRevision {
  if (supplied === null) {
    throw new FoundationError(
      "lifecycle.projection.boundary-invalid",
      "Execution Projection requires the exact retained Work Boundary revision",
    );
  }
  const boundary = exactControlRevision(supplied, "work-boundary", "Work Boundary");
  const basis = controlObject(boundary.payload.basis, "Work Boundary basis");
  if (
    basis.atlasStateDigest !== request.atlas.stateDigest ||
    basis.atlasResolutionDigest !== request.atlas.resolutionDigest ||
    basis.atlasNormalizedModelDigest !== request.atlas.normalizedModelDigest ||
    basis.atlasResourceBindingsDigest !== request.atlas.resourceBindingsDigest
  ) {
    throw new FoundationError(
      "lifecycle.projection.basis-mismatch",
      "Retained Work Boundary Atlas snapshot differs from the exact Execution request",
    );
  }
  if (
    boundary.recordId !== request.subject.workBoundary.id ||
    boundary.revision !== request.subject.workBoundary.revision ||
    boundary.digest !== request.subject.workBoundary.digest ||
    boundary.payload.targetId !== request.target.id ||
    basis.productBaseCommit !== request.repository.commit ||
    basis.productBaseTree !== request.repository.tree ||
    basis.productStateDigest !== request.repository.productStateDigest ||
    basis.repositoryContractDigest !== request.repository.repositoryContractDigest ||
    basis.knowledgeSetDigest !== request.knowledge.knowledgeSetDigest ||
    basis.repositorySnapshotDigest !== request.repository.repositorySnapshotDigest
  ) {
    throw new FoundationError(
      "lifecycle.projection.boundary-invalid",
      "Retained Work Boundary does not bind the exact Execution request and admitted product basis",
    );
  }
  return boundary;
}

async function mandatoryBlobBytes(options: {
  repository: string;
  profile: FoundationProjectionProfile;
  objectId: string;
  id: string;
  locator: string;
  category: "candidate-change" | "implementation" | "source" | "candidate-context";
}): Promise<Buffer> {
  const observedBytes = (await exactBlobSizes(options.repository, [options.objectId])).get(options.objectId);
  if (observedBytes === undefined) {
    throw new FoundationError("lifecycle.projection.content-digest", `Mandatory ${options.category} ${options.locator} has no exact Git blob size`, {
      observedFacts: { category: options.category, id: options.id, locator: options.locator, objectId: options.objectId },
    });
  }
  if (observedBytes > options.profile.maximumItemBytes) {
    throw mandatoryProjectionItemSizeErrorV1({ profile: options.profile, category: options.category,
      id: options.id, locator: options.locator, objectId: options.objectId, observedBytes });
  }
  return objectBlobBytes(options.repository, options.objectId, observedBytes);
}

function gitMaterialPresentation(
  bytes: Uint8Array,
  textHint: "source" | "plain-text",
): Readonly<{
  presentationHint: "source" | "plain-text" | "binary";
  mediaType: "text/plain" | "application/octet-stream";
  encoding: "utf-8" | "binary";
}> {
  try {
    STRICT_UTF8.decode(bytes);
    return Object.freeze({ presentationHint: textHint, mediaType: "text/plain", encoding: "utf-8" });
  } catch {
    return Object.freeze({ presentationHint: "binary", mediaType: "application/octet-stream", encoding: "binary" });
  }
}

function recordOrder(left: FoundationKnowledgeRecord, right: FoundationKnowledgeRecord): number {
  return (KIND_ORDER.get(left.frontMatter.kind) ?? 99) - (KIND_ORDER.get(right.frontMatter.kind) ?? 99) ||
    compareCodePoints(left.frontMatter.id, right.frontMatter.id) ||
    left.frontMatter.revision - right.frontMatter.revision ||
    compareCodePoints(left.path, right.path);
}


function sameTreeEntry(
  left: FoundationGitTreeEntry | undefined,
  right: FoundationGitTreeEntry | undefined,
): boolean {
  return left?.mode === right?.mode && left?.type === right?.type && left?.objectId === right?.objectId;
}

function candidateChangeKind(
  prior: FoundationGitTreeEntry | undefined,
  next: FoundationGitTreeEntry | undefined,
): FoundationReviewerCandidateChange["change"] {
  if (prior === undefined) return "added";
  if (next === undefined) return "deleted";
  if (prior.type !== next.type) return "type-changed";
  if (prior.mode !== next.mode) return "mode-changed";
  return "modified";
}

async function candidateEntryDigest(options: {
  repository: string;
  profile: FoundationProjectionProfile;
  entry: FoundationGitTreeEntry | undefined;
  path: string;
}): Promise<Sha256 | null> {
  if (options.entry === undefined) return null;
  if (options.entry.type !== "blob") {
    return digestCanonical({
      mode: options.entry.mode,
      objectId: options.entry.objectId,
      type: options.entry.type,
    });
  }
  return sha256Bytes(await mandatoryBlobBytes({
    repository: options.repository,
    profile: options.profile,
    objectId: options.entry.objectId,
    id: options.path,
    locator: options.path,
    category: "candidate-change",
  }));
}

async function observedCandidateChanges(options: {
  request: FoundationExecutionProjectionRequest;
  repository: string;
  baseEntries: readonly FoundationGitTreeEntry[];
  candidateEntries: readonly FoundationGitTreeEntry[];
}): Promise<readonly FoundationReviewerCandidateChange[]> {
  const base = new Map(options.baseEntries.map((entry) => [entry.path, entry]));
  const candidate = new Map(options.candidateEntries.map((entry) => [entry.path, entry]));
  if (base.size !== options.baseEntries.length || candidate.size !== options.candidateEntries.length) {
    throw new FoundationError("lifecycle.projection.reviewer-seal", "Candidate tree inventory repeats one path");
  }
  const values: FoundationReviewerCandidateChange[] = [];
  for (const path of sortUniqueCodePoints([...base.keys(), ...candidate.keys()])) {
    const prior = base.get(path);
    const next = candidate.get(path);
    if (sameTreeEntry(prior, next)) continue;
    values.push(Object.freeze({
      path,
      change: candidateChangeKind(prior, next),
      beforeDigest: await candidateEntryDigest({
        repository: options.repository,
        profile: options.request.profile,
        entry: prior,
        path,
      }),
      afterDigest: await candidateEntryDigest({
        repository: options.repository,
        profile: options.request.profile,
        entry: next,
        path,
      }),
    }));
  }
  return Object.freeze(values);
}

async function verifyCandidateObservation(options: {
  request: FoundationExecutionProjectionRequest;
  loaded: FoundationLoadedRepositorySnapshot;
  objectRepository: string;
  boundary: ControlRecordRevision;
  observation: FoundationReviewerProjectionObservation | null;
}): Promise<FoundationVerifiedReviewerProjectionObservation> {
  if (options.request.role !== "reviewer") {
    if (options.observation !== null) throw new FoundationError("lifecycle.projection.reviewer-seal", "Only reviewer Projection accepts a sealed candidate observation");
    throw new FoundationError("lifecycle.projection.reviewer-seal", "Candidate observation requested for a non-reviewer role");
  }
  const observation = options.observation;
  const requested = options.request.subject.candidate;
  if (observation === null || requested === null || requested.seal === null || requested.sealedTree === null) {
    throw new FoundationError("lifecycle.projection.reviewer-seal", "Reviewer Projection requires one complete sealed candidate observation");
  }
  const candidateRevision = exactControlRevision(
    observation.candidate,
    "candidate-revision",
    "Candidate Revision",
  );
  const seal = exactControlRevision(observation.seal, "candidate-seal", "Candidate Seal");
  const sealedCandidate = exactRelationship(seal, "seals", "candidate-revision");
  const sealBoundary = exactRelationship(seal, "governed-by", "work-boundary");
  const candidateBoundary = exactRelationship(candidateRevision, "governed-by", "work-boundary");
  const state = controlObject(candidateRevision.payload.state, "Candidate state");
  const candidateBaseCommit = controlString(
    candidateRevision.payload.candidateBaseCommit,
    "Candidate base commit",
  );
  const sealedTree = controlString(state.tree, "Candidate sealed tree");
  const candidateDigest = controlDigest(state.candidateDigest, "Candidate digest");
  const carrierManifest = controlObject(
    candidateRevision.payload.carrierManifest,
    "Candidate Carrier manifest binding",
  );
  const carrierManifestDigest = controlDigest(
    carrierManifest.digest,
    "Candidate Carrier manifest digest",
  );
  const diffDigest = controlDigest(state.diffDigest, "Candidate diff digest");
  if (
    candidateRevision.processId !== options.boundary.processId ||
    seal.processId !== options.boundary.processId ||
    candidateRevision.payload.schema !== "lifecycle.candidate-revision-payload.v3" ||
    !sameControlReference(sealedCandidate, controlRevisionReference(candidateRevision)) ||
    !sameControlReference(sealBoundary, controlRevisionReference(options.boundary)) ||
    !sameControlReference(candidateBoundary, controlRevisionReference(options.boundary)) ||
    !sameControlReference(controlRevisionReference(seal), requested.seal) ||
    !sameControlReference(controlRevisionReference(candidateRevision), requested.revision) ||
    candidateBaseCommit !== requested.baseCommit ||
    sealedTree !== requested.sealedTree ||
    candidateDigest !== requested.stateDigest ||
    carrierManifestDigest !== requested.carrierManifestDigest
  ) {
    throw new FoundationError(
      "lifecycle.projection.reviewer-seal",
      "Candidate Seal and Candidate Revision do not bind the requested Work Boundary and exact sealed Candidate",
    );
  }
  const sealedTreeEntries = await exactTreeEntries(
    options.objectRepository,
    sealedTree,
    options.loaded.epoch.objectFormat,
  );
  const firstTreeMismatch = (() => {
    const length = Math.max(sealedTreeEntries.length, observation.treeEntries.length);
    for (let index = 0; index < length; index += 1) {
      const actual = sealedTreeEntries[index];
      const supplied = observation.treeEntries[index];
      if (actual?.path !== supplied?.path || actual?.mode !== supplied?.mode || actual?.type !== supplied?.type || actual?.objectId !== supplied?.objectId) {
        return Object.freeze({ index, actual: actual ?? null, supplied: supplied ?? null });
      }
    }
    return null;
  })();
  if (firstTreeMismatch !== null) {
    throw new FoundationError("lifecycle.projection.reviewer-seal", "Reviewer Candidate tree inventory does not equal the independently loaded sealed tree", {
      observedFacts: {
        sealedTree,
        actualEntries: sealedTreeEntries.length,
        suppliedEntries: observation.treeEntries.length,
        actualInventoryDigest: digestCanonical(sealedTreeEntries),
        suppliedInventoryDigest: digestCanonical(observation.treeEntries),
        firstMismatch: firstTreeMismatch,
      },
    });
  }
  const productState = buildProductState(options.loaded.contract, sealedTreeEntries);
  if (
    !observation.knowledge.validation.complete ||
    !observation.knowledge.validation.valid ||
    observation.knowledge.manifest.digest !== state.knowledgeSetDigest ||
    observation.knowledge.manifest.repository.tree !== sealedTree ||
    observation.knowledge.manifest.repository.productStateDigest !== state.productStateDigest ||
    productState.digest !== state.productStateDigest ||
    digestCanonical(productState.entries) !== state.artifactSetDigest ||
    digestCanonical(observation.knowledge.manifest.coverage) !== state.descriptionCoverageDigest
  ) {
    throw new FoundationError("lifecycle.projection.reviewer-seal", "Candidate Knowledge observation or Description coverage does not bind the Seal");
  }
  const diffBytes = Buffer.from(observation.diff.bytes);
  if (observation.diff.digest !== diffDigest || sha256Bytes(diffBytes) !== diffDigest) {
    throw new FoundationError("lifecycle.projection.reviewer-seal", "Exact Candidate diff bytes do not bind the Seal");
  }
  const candidateBaseEntries = await exactTreeEntries(
    options.objectRepository,
    candidateBaseCommit,
    options.loaded.epoch.objectFormat,
  );
  const changes = await observedCandidateChanges({
    request: options.request,
    repository: options.objectRepository,
    baseEntries: candidateBaseEntries,
    candidateEntries: sealedTreeEntries,
  });
  if (
    canonicalJson(changes) !== canonicalJson(controlArray(state.changedSubjects, "Candidate changed subjects")) ||
    digestCanonical(sealedTreeEntries.map((entry) => Object.freeze({
      path: entry.path,
      mode: entry.mode,
      type: entry.type,
      objectId: entry.objectId,
    }))) !== state.pathInventoryDigest
  ) {
    throw new FoundationError(
      "lifecycle.projection.reviewer-seal",
      "Candidate Revision changed subjects or path inventory do not reproduce the exact sealed tree",
    );
  }
  return Object.freeze({
    ...observation,
    seal,
    candidate: candidateRevision,
    treeEntries: sealedTreeEntries,
    changes,
    productState,
    candidateBaseCommit,
    candidateDigest,
    sealedTree,
    diffDigest,
  });
}

async function mandatoryRecordItem(options: {
  record: FoundationKnowledgeRecord;
  basis: FoundationKnowledgeOccurrence["basis"];
  closure: ClosureEntry;
  inventory: ProjectionByteInventoryBuilder;
}): Promise<FoundationProjectionMandatoryItem> {
  const bytes = Buffer.from(options.record.sourceText, "utf8");
  const occurrence = knowledgeOccurrence(options.record, options.basis);
  const key = `knowledge:${options.basis}:${options.record.frontMatter.id}:r${options.record.frontMatter.revision}`;
  const stored = options.inventory.add({
    tier: "mandatory",
    key,
    bytes,
    declaredDigest: options.record.sourceDigest,
    mediaType: "text/markdown",
    encoding: "utf-8",
  });
  return buildMandatoryItem({
    id: knowledgeOccurrenceItemId(occurrence),
    category: "knowledge",
    sourceIdentity: options.record.frontMatter.id,
    kind: options.record.frontMatter.kind,
    authority: options.record.frontMatter.kind === "discipline" ? "discipline-guidance" : "product-knowledge",
    locator: options.record.path,
    revision: options.record.frontMatter.revision,
    sourceDigest: options.record.sourceDigest,
    semanticDigest: options.record.semanticDigest,
    inclusionReasons: [...options.closure.reasons],
    relationshipPaths: [...options.closure.paths.values()],
    content: stored.content,
    presentationHint: "markdown",
    useLimit: `${options.basis === "base" ? "Admitted" : "Candidate"} basis occurrence of ${occurrence.id} revision ${occurrence.revision}. ${options.record.frontMatter.kind === "discipline"
      ? "Advisory Discipline guidance supports agent judgment; it does not create product meaning, mandatory proof, capability, or authority."
      : "The record retains its declared kind and owner authority; inclusion does not transfer ownership."}`,
  });
}

function artifactKind(path: string, reasons: readonly string[]): FoundationProjectionImplementationItem["artifactKind"] {
  if (reasons.some((reason) => reason.includes("test")) || /(?:^|\/)(?:test|tests|spec)(?:\/|\.|$)/u.test(path)) return "test";
  if (/\.(?:md|mdx|txt|rst)$/u.test(path)) return "documentation";
  if (/\.(?:json|ya?ml|toml|ini|config|conf)$/u.test(path)) return "configuration";
  return "code";
}

async function implementationItems(options: {
  loaded: FoundationLoadedRepositorySnapshot;
  objectRepository: string;
  profile: FoundationProjectionProfile;
  knowledge: FoundationKnowledgeSet;
  paths: ReadonlyMap<string, readonly string[]>;
  candidate?: FoundationReviewerProjectionObservation | null;
  inventory: ProjectionByteInventoryBuilder;
}): Promise<readonly FoundationProjectionImplementationItem[]> {
  const base = new Map(options.loaded.treeEntries.map((entry) => [entry.path, entry]));
  const candidate = options.candidate === null || options.candidate === undefined
    ? null
    : new Map(options.candidate.treeEntries.map((entry) => [entry.path, entry]));
  const items: FoundationProjectionImplementationItem[] = [];
  for (const [path, reasons] of [...options.paths].sort(([left], [right]) => compareCodePoints(left, right))) {
    const entry = candidate?.get(path) ?? base.get(path);
    if (entry === undefined) continue;
    if (entry.type !== "blob" || (entry.mode !== "100644" && entry.mode !== "100755")) {
      throw new FoundationError("lifecycle.projection.content-digest", `Required implementation ${path} is not one supported regular blob`);
    }
    const bytes = await mandatoryBlobBytes({
      repository: options.objectRepository,
      profile: options.profile,
      objectId: entry.objectId,
      id: path,
      locator: path,
      category: "implementation",
    });
    const digest = sha256Bytes(bytes);
    const descriptions = descriptionsForPath(options.knowledge, path);
    const presentation = gitMaterialPresentation(bytes, "source");
    const stored = options.inventory.add({
      tier: "mandatory",
      key: `implementation:${path}`,
      bytes,
      declaredDigest: digest,
      mediaType: presentation.mediaType,
      encoding: presentation.encoding,
    });
    const baseItem = {
      id: `implementation:${digestCanonical(path).slice("sha256:".length)}`,
      path,
      artifactKind: artifactKind(path, reasons),
      digest,
      descriptionIds: descriptions,
      inclusionReasons: reasons,
      presentationHint: presentation.presentationHint as FoundationProjectionPresentationHint,
      content: stored.content,
      useLimit: "Repository reality is implementation input; Work Boundary and Knowledge retain semantic authority.",
    };
    items.push(buildTierTwoItem(baseItem));
  }
  return Object.freeze(items.sort((left, right) => compareCodePoints(`${left.path}\0${left.id}`, `${right.path}\0${right.id}`)));
}

function sourceKey(source: FoundationKnowledgeSourceResolution): string {
  return `${source.recordId}\0${source.recordRevision}\0${source.sourceId}`;
}

function reachableSourceCandidate(
  source: FoundationKnowledgeSourceResolution,
  sizes: ReadonlyMap<string, number>,
): ReachableCandidate | null {
  const id = stableId("source", {
    recordId: source.recordId,
    recordRevision: source.recordRevision,
    sourceId: source.sourceId,
  });
  if (source.disposition === "resolved" && source.objectId !== null && source.resolvedDigest !== null) {
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

type FoundationKnowledgeSourceRoot = Extract<FoundationProjectionSourceRoot, Readonly<{ owner: "knowledge" }>>;
type FoundationAnchorSourceRoot = Extract<FoundationProjectionSourceRoot, Readonly<{ owner: "source-anchor" }>>;

function knowledgeSourceAuthority(
  source: FoundationKnowledgeSourceResolution,
): FoundationKnowledgeSourceRoot["authority"] {
  return source.kind === "atlas" ? "atlas"
    : source.kind === "repository" ? "repository-reality"
      : "informational-source";
}

async function sourceItems(options: {
  loaded: FoundationLoadedRepositorySnapshot;
  objectRepository: string;
  profile: FoundationProjectionProfile;
  knowledge: FoundationKnowledgeSet;
  basis: FoundationKnowledgeOccurrence["basis"];
  includedIds: ReadonlySet<string>;
  roots: readonly FoundationExecutionProjectionSubject["sourceRoots"][number][];
  candidateDiff?: Readonly<{ digest: Sha256; bytes: Uint8Array }>;
  candidateArtifacts?: Readonly<{
    digest: Sha256;
    values: readonly FoundationProductState["entries"][number][];
  }>;
  inventory: ProjectionByteInventoryBuilder;
}): Promise<Readonly<{
  items: readonly FoundationProjectionSourceItem[];
  unresolved: readonly FoundationProjectionUnresolved[];
  selectedKeys: readonly string[];
}>> {
  const explicit = new Map<string, FoundationKnowledgeSourceRoot>();
  const anchorRoots: FoundationAnchorSourceRoot[] = [];
  for (const root of options.roots) {
    if (root.owner === "source-anchor") {
      if (anchorRoots.some(({ sourceId }) => sourceId === root.sourceId)) {
        throw new FoundationError("lifecycle.projection.source-stale", `Mandatory source anchor ${root.sourceId} is repeated`);
      }
      anchorRoots.push(root);
      continue;
    }
    const current = options.knowledge.index.currentByIdentity.get(root.recordId);
    if (current === undefined || current.frontMatter.revision !== root.recordRevision) {
      throw new FoundationError("lifecycle.projection.source-stale", `Mandatory source ${root.sourceId} does not cite the exact current revision of ${root.recordId}`, {
        observedFacts: {
          recordId: root.recordId,
          sourceId: root.sourceId,
          declaredRecordRevision: root.recordRevision,
          currentRecordRevision: current?.frontMatter.revision ?? null,
        },
      });
    }
    const key = `${root.recordId}\0${root.recordRevision}\0${root.sourceId}`;
    if (explicit.has(key)) {
      throw new FoundationError("lifecycle.projection.source-stale", `Mandatory source root ${root.sourceId} is repeated for ${root.recordId} revision ${root.recordRevision}`);
    }
    explicit.set(key, root);
  }
  const selected = options.knowledge.sources.filter((source) =>
    explicit.has(sourceKey(source)) ||
    (options.includedIds.has(source.recordId) && source.required &&
      options.knowledge.index.currentByIdentity.get(source.recordId)?.frontMatter.revision === source.recordRevision));
  for (const [key, root] of explicit) {
    if (!selected.some((source) => sourceKey(source) === key)) {
      throw new FoundationError("lifecycle.projection.source-inaccessible", `Mandatory source ${root.sourceId} has no exact resolution for ${root.recordId} revision ${root.recordRevision}`, {
        observedFacts: { recordId: root.recordId, recordRevision: root.recordRevision, sourceId: root.sourceId },
      });
    }
  }
  const items: FoundationProjectionSourceItem[] = [];
  const unresolved: FoundationProjectionUnresolved[] = [];
  for (const source of selected.sort((left, right) => compareCodePoints(sourceKey(left), sourceKey(right)))) {
    const currentRevision = options.knowledge.index.currentByIdentity.get(source.recordId)?.frontMatter.revision ?? null;
    if (currentRevision !== source.recordRevision) {
      throw new FoundationError("lifecycle.projection.source-stale", `Mandatory source ${source.sourceId} does not belong to the exact current revision of ${source.recordId}`, {
        observedFacts: { recordId: source.recordId, sourceId: source.sourceId, sourceRecordRevision: source.recordRevision, currentRecordRevision: currentRevision },
      });
    }
    const root = explicit.get(sourceKey(source));
    const effectiveDigest = source.resolvedDigest ?? source.declaredDigest;
    if (root !== undefined && (
      source.reference !== root.reference ||
      source.declaredRevision !== root.revision ||
      effectiveDigest !== root.digest ||
      knowledgeSourceAuthority(source) !== root.authority ||
      source.required !== root.required
    )) {
      throw new FoundationError("lifecycle.projection.source-stale", `Mandatory source ${source.sourceId} no longer matches its exact Work Boundary citation`, {
        observedFacts: {
          sourceId: source.sourceId,
          expected: root,
          actual: {
            reference: source.reference,
            revision: source.declaredRevision,
            digest: effectiveDigest,
            authority: knowledgeSourceAuthority(source),
            required: source.required,
          },
        },
      });
    }
    if (source.disposition !== "resolved" || source.objectId === null || source.resolvedDigest === null) {
      const value = Object.freeze({
        id: `unresolved.${digestCanonical(source).slice("sha256:".length)}`,
        code: source.disposition === "retrieval-denied" ? "lifecycle.projection.external-denied" : "lifecycle.projection.source-inaccessible",
        required: source.required || root !== undefined,
        reference: source.reference,
        detail: `Source ${source.sourceId} for ${source.recordId} is ${source.disposition}`,
      });
      unresolved.push(value);
      if (value.required) {
        throw new FoundationError(value.code, `Required source ${source.sourceId} for ${source.recordId} is ${source.disposition}`, {
          observedFacts: { source },
        });
      }
      continue;
    }
    const bytes = await mandatoryBlobBytes({
      repository: options.objectRepository,
      profile: options.profile,
      objectId: source.objectId,
      id: `${source.recordId}:${source.sourceId}`,
      locator: source.reference,
      category: "source",
    });
    const presentation = gitMaterialPresentation(bytes, "plain-text");
    const stored = options.inventory.add({
      tier: "mandatory",
      key: `source:${options.basis}:${sourceKey(source)}`,
      bytes,
      declaredDigest: source.resolvedDigest,
      mediaType: presentation.mediaType,
      encoding: presentation.encoding,
    });
    const id = stableId("source", { basis: options.basis, recordId: source.recordId, recordRevision: source.recordRevision, sourceId: source.sourceId, digest: source.resolvedDigest });
    items.push(buildTierTwoItem({
      id,
      reference: source.reference,
      revision: source.objectId,
      digest: source.resolvedDigest,
      authority: source.kind === "atlas" ? "atlas" as const : source.kind === "repository" ? "repository-reality" as const : "informational-source" as const,
      semantic: Object.freeze({
        class: "source" as const,
        subjectId: stableId("source.subject", {
          recordId: source.recordId,
          recordRevision: source.recordRevision,
          sourceId: source.sourceId,
        }),
        subjectDigest: source.resolvedDigest,
        evidenceKind: null,
      }),
      inclusionReasons: Object.freeze(sortUniqueCodePoints([
        ...(root === undefined ? [] : [`work-boundary:${root.reason}`]),
        ...(source.required ? [`required-source:${source.recordId}`] : []),
      ])),
      presentationHint: presentation.presentationHint,
      content: stored.content,
      useLimit: "Source bytes retain their declared authority role and do not override governed Knowledge.",
    }));
  }
  const anchorMaterials = await foundationRepositorySourceMaterials({
    loaded: options.loaded,
    maximumItemBytes: options.profile.maximumItemBytes,
    sourceIds: new Set(anchorRoots.map(({ sourceId }) => sourceId)),
  });
  for (const root of anchorRoots.sort((left, right) => compareCodePoints(left.sourceId, right.sourceId))) {
    const current = anchorMaterials.find(({ id }) => id === root.sourceId);
    if (current === undefined) {
      throw new FoundationError("lifecycle.projection.source-inaccessible", `Mandatory source anchor ${root.sourceId} is not available from the exact repository basis`, {
        observedFacts: { sourceId: root.sourceId, reference: root.reference },
      });
    }
    if (current.reference !== root.reference ||
        current.revision !== root.revision ||
        current.digest !== root.digest ||
        current.authority !== root.authority ||
        current.required !== root.required) {
      throw new FoundationError("lifecycle.projection.source-stale", `Mandatory source anchor ${root.sourceId} no longer matches its exact Work Boundary citation`, {
        observedFacts: {
          expected: root,
          actual: {
            sourceId: current.id,
            reference: current.reference,
            revision: current.revision,
            digest: current.digest,
            authority: current.authority,
            required: current.required,
          },
        },
      });
    }
    const stored = options.inventory.add({
      tier: "mandatory",
      key: `source:${options.basis}:anchor:${root.sourceId}`,
      bytes: current.bytes,
      declaredDigest: root.digest,
      mediaType: current.mediaType,
      encoding: current.encoding,
    });
    const occurrenceId = options.basis === "base" ? root.sourceId
      : stableId("source.anchor", { basis: options.basis, sourceId: root.sourceId, digest: root.digest });
    items.push(buildTierTwoItem({
      id: occurrenceId,
      reference: root.reference,
      revision: root.revision,
      digest: root.digest,
      authority: root.authority,
      semantic: Object.freeze({
        class: "source" as const,
        subjectId: occurrenceId,
        subjectDigest: root.digest,
        evidenceKind: null,
      }),
      inclusionReasons: Object.freeze([`work-boundary:${root.reason}`]),
      presentationHint: current.presentationHint,
      content: stored.content,
      useLimit: current.useLimit,
    }));
  }
  if (options.candidateDiff !== undefined) {
    const bytes = Buffer.from(options.candidateDiff.bytes);
    const stored = options.inventory.add({ tier: "mandatory", key: "source:candidate-diff", bytes, declaredDigest: options.candidateDiff.digest, mediaType: "text/x-diff", encoding: "utf-8" });
    items.push(buildTierTwoItem({
      id: "source.candidate-diff",
      reference: "candidate:sealed-diff",
      revision: options.candidateDiff.digest,
      digest: options.candidateDiff.digest,
      authority: "runtime-authenticated-fact" as const,
      semantic: Object.freeze({
        class: "candidate" as const,
        subjectId: "candidate.diff",
        subjectDigest: options.candidateDiff.digest,
        evidenceKind: null,
      }),
      inclusionReasons: Object.freeze(["reviewer-sealed-candidate"]),
      presentationHint: "diff" as const,
      content: stored.content,
      useLimit: "The diff is a runtime-authenticated Candidate fact, not acceptance judgment.",
    }));
  }
  if (options.candidateArtifacts !== undefined) {
    const bytes = projectionIndexBytes(options.candidateArtifacts.values);
    const stored = options.inventory.add({
      tier: "mandatory",
      key: "source:candidate-artifact-set",
      bytes,
      declaredDigest: options.candidateArtifacts.digest,
      mediaType: "application/json",
      encoding: "utf-8",
    });
    items.push(buildTierTwoItem({
      id: "source.candidate-artifact-set",
      reference: "candidate:artifact-set",
      revision: options.candidateArtifacts.digest,
      digest: options.candidateArtifacts.digest,
      authority: "runtime-authenticated-fact" as const,
      semantic: Object.freeze({
        class: "candidate" as const,
        subjectId: "candidate.artifact-set",
        subjectDigest: options.candidateArtifacts.digest,
        evidenceKind: null,
      }),
      inclusionReasons: Object.freeze(["reviewer-sealed-candidate"]),
      presentationHint: "json" as const,
      content: stored.content,
      useLimit: "The exact Candidate Product State inventory is a runtime-authenticated fact; acceptance judgment remains with the reviewer and Director.",
    }));
  }
  return Object.freeze({
    items: Object.freeze(items.sort((left, right) => compareCodePoints(`${left.reference}\0${left.revision ?? ""}\0${left.id}`, `${right.reference}\0${right.revision ?? ""}\0${right.id}`))),
    unresolved: Object.freeze(unresolved.sort((left, right) => compareCodePoints(`${left.required ? "0" : "1"}\0${left.reference}\0${left.id}`, `${right.required ? "0" : "1"}\0${right.reference}\0${right.id}`))),
    selectedKeys: Object.freeze(sortUniqueCodePoints(selected.map(sourceKey))),
  });
}

async function candidateContextItems(options: {
  loaded: FoundationLoadedRepositorySnapshot;
  objectRepository: string;
  profile: FoundationProjectionProfile;
  subject: FoundationExecutionProjectionSubject;
  observation: FoundationVerifiedReviewerProjectionObservation;
  inventory: ProjectionByteInventoryBuilder;
}): Promise<readonly FoundationProjectionSourceItem[]> {
  const baseEntries = await exactTreeEntries(
    options.objectRepository,
    options.observation.candidateBaseCommit,
    options.loaded.epoch.objectFormat,
  );
  const base = new Map(baseEntries.map((entry) => [entry.path, entry]));
  const candidate = new Map(options.observation.treeEntries.map((entry) => [entry.path, entry]));
  const items: FoundationProjectionSourceItem[] = [];
  for (const change of options.observation.changes) {
    const artifact = options.subject.core.requiredArtifacts.find((entry) =>
      (entry.path === change.path || atOrBelow(change.path, entry.path)) &&
      entry.role === "external-source");
    if (artifact === undefined) continue;
    const path = change.path;
    const entry = change.change === "deleted" ? base.get(path) : candidate.get(path);
    if (entry === undefined || entry.type !== "blob") continue;
    const bytes = await mandatoryBlobBytes({
      repository: options.objectRepository,
      profile: options.profile,
      objectId: entry.objectId,
      id: path,
      locator: path,
      category: "candidate-context",
    });
    const digest = sha256Bytes(bytes);
    const stored = options.inventory.add({
      tier: "mandatory",
      key: `source:candidate-context:${path}`,
      bytes,
      declaredDigest: digest,
      mediaType: path.endsWith(".md") ? "text/markdown" : "application/octet-stream",
      encoding: path.endsWith(".md") ? "utf-8" : "binary",
    });
    const id = stableId("source.candidate-context", { path, digest, change: change.change });
    items.push(buildTierTwoItem({
      id,
      reference: `candidate:${path}`,
      revision: entry.objectId,
      digest,
      authority: "runtime-authenticated-fact" as const,
      semantic: Object.freeze({
        class: "candidate" as const,
        subjectId: id,
        subjectDigest: digest,
        evidenceKind: null,
      }),
      inclusionReasons: Object.freeze([`candidate-changed:${change.change}`, "candidate-role:external-source"]),
      presentationHint: path.endsWith(".md") ? "markdown" as const : "binary" as const,
      content: stored.content,
      useLimit: "External source material retains its external owner and remains proposed Candidate material.",
    }));
  }
  return Object.freeze(items.sort((left, right) => compareCodePoints(`${left.reference}\0${left.id}`, `${right.reference}\0${right.id}`)));
}

function checkReceiptItems(options: {
  receipts: readonly ControlRecordRevision[];
  request: FoundationExecutionProjectionRequest;
  seal: ControlRecordRevision | null;
  boundary: ControlRecordRevision;
  inventory: ProjectionByteInventoryBuilder;
}): readonly FoundationProjectionSourceItem[] {
  const values: FoundationProjectionSourceItem[] = [];
  const identities = new Set<string>();
  if (options.receipts.length > 0 && (options.request.role !== "reviewer" || options.seal === null)) {
    throw new FoundationError(
      "lifecycle.projection.evidence-invalid",
      "Check Receipts require one resolved reviewer Candidate Seal",
    );
  }
  const seal = options.seal;
  const mandate = controlObject(options.boundary.payload.mandate, "Work Boundary mandate");
  const selections = controlArray(mandate.checks, "Work Boundary Check selections");
  for (const supplied of options.receipts) {
    const receipt = exactControlRevision(supplied, "check-receipt", "Check Receipt");
    if (identities.has(receipt.recordId)) {
      throw new FoundationError(
        "lifecycle.projection.evidence-invalid",
        `Reviewer Projection received duplicate Check Receipt ${receipt.recordId}`,
      );
    }
    identities.add(receipt.recordId);
    const selectionId = controlString(receipt.payload.selectionId, "Check Receipt selection identity");
    const selection = selections
      .map((value) => controlObject(value, "Work Boundary Check selection"))
      .find((value) => value.id === selectionId);
    const phase = receipt.payload.phase;
    const subject = phase === "baseline"
      ? exactRelationship(receipt, "checks-boundary", "work-boundary")
      : exactRelationship(receipt, "checks-seal", "candidate-seal");
    const selectedBindings = selection === undefined
      ? Object.freeze([])
      : controlArray(selection.bindings, "Work Boundary Check Bindings");
    const exactBinding = selectedBindings.some((value) =>
      canonicalJson(controlObject(value, "Work Boundary Check Binding")) ===
        canonicalJson(receipt.payload.binding));
    if (
      seal === null ||
      receipt.processId !== seal.processId ||
      !sameControlReference(subject, controlRevisionReference(phase === "baseline" ? options.boundary : seal)) ||
      (phase !== "baseline" && phase !== "final") ||
      selection === undefined ||
      canonicalJson(selection.definition) !== canonicalJson(receipt.payload.definition) ||
      selection.modality !== receipt.payload.modality ||
      (phase === "baseline" ? selection.baselineRequired !== true : selection.finalRequired !== true) ||
      !exactBinding
    ) {
      throw new FoundationError(
        "lifecycle.projection.evidence-invalid",
        `Reviewer Check Receipt ${receipt.recordId} does not bind its exact original baseline Boundary or final Candidate Seal and admitted Check selection`,
      );
    }
    const bytes = controlProjectionBytes(receipt);
    const stored = options.inventory.add({
      tier: "mandatory",
      key: `source:check-receipt:${receipt.recordId}:r${receipt.revision}`,
      bytes,
      mediaType: "text/markdown",
      encoding: "utf-8",
    });
    values.push(buildTierTwoItem({
      id: stableId("source.check-receipt", {
        id: receipt.recordId,
        revision: receipt.revision,
        digest: receipt.digest,
      }),
      reference: `evidence:check-receipt:${receipt.recordId}`,
      revision: receipt.digest,
      digest: receipt.digest,
      authority: "runtime-authenticated-fact" as const,
      semantic: Object.freeze({
        class: "evidence" as const,
        subjectId: receipt.recordId,
        subjectDigest: receipt.digest,
        evidenceKind: "check-receipt" as const,
      }),
      inclusionReasons: Object.freeze(["delivery-evaluation-required-check-receipt"]),
      presentationHint: "markdown" as const,
      content: stored.content,
      useLimit: "The Receipt is one runtime-authenticated result, not acceptance judgment.",
    }));
  }
  return Object.freeze(values.sort((left, right) =>
    compareCodePoints(`${left.reference}\0${left.revision ?? ""}\0${left.id}`, `${right.reference}\0${right.revision ?? ""}\0${right.id}`)));
}

function agentWorkProductItems(options: {
  evidence: readonly FoundationAgentWorkProductProjectionEvidence[];
  request: FoundationExecutionProjectionRequest;
  boundary: ControlRecordRevision;
  inventory: ProjectionByteInventoryBuilder;
}): readonly FoundationProjectionSourceItem[] {
  if (
    options.evidence.length > 0 &&
    options.request.role !== "builder" && options.request.role !== "reviewer"
  ) {
    throw new FoundationError(
      "lifecycle.projection.evidence-invalid",
      "Only builder and reviewer Projection accept Agent Work Product Evidence",
    );
  }
  const values: FoundationProjectionSourceItem[] = [];
  const identities = new Set<string>();
  for (const supplied of options.evidence) {
    const attempt = exactControlRevision(supplied.attempt, "agent-attempt", "Evidence Agent Attempt");
    const workProduct = exactControlRevision(
      supplied.workProduct,
      "agent-work-product",
      "Agent Work Product Evidence",
    );
    if (identities.has(workProduct.recordId)) {
      throw new FoundationError(
        "lifecycle.projection.evidence-invalid",
        `Execution Projection received duplicate Agent Work Product ${workProduct.recordId}`,
      );
    }
    identities.add(workProduct.recordId);
    const resultOf = exactRelationship(workProduct, "result-of", "agent-attempt");
    const usesBoundary = exactRelationship(attempt, "uses-boundary", "work-boundary");
    if (
      workProduct.processId !== options.boundary.processId ||
      attempt.processId !== options.boundary.processId ||
      workProduct.payload.schema !== "lifecycle.agent-work-product-payload.v5" ||
      attempt.payload.schema !== "lifecycle.agent-attempt-payload.v3" ||
      workProduct.semanticAuthority !== "agent-proposed" ||
      workProduct.semanticAuthor.kind !== "agent" ||
      !sameControlReference(resultOf, controlRevisionReference(attempt)) ||
      !sameControlReference(usesBoundary, controlRevisionReference(options.boundary))
    ) {
      throw new FoundationError(
        "lifecycle.projection.evidence-invalid",
        `Agent Work Product ${workProduct.recordId} does not bind one exact admitted Attempt subject`,
      );
    }
    const bytes = controlProjectionBytes(workProduct);
    const stored = options.inventory.add({
      tier: "mandatory",
      key: `source:agent-work-product:${workProduct.recordId}:r${workProduct.revision}`,
      bytes,
      mediaType: "text/markdown",
      encoding: "utf-8",
    });
    values.push(buildTierTwoItem({
      id: stableId("source.agent-work-product", {
        id: workProduct.recordId,
        revision: workProduct.revision,
        digest: workProduct.digest,
      }),
      reference: `evidence:agent-work-product:${workProduct.recordId}`,
      revision: workProduct.digest,
      digest: workProduct.digest,
      authority: "agent-proposed-claim" as const,
      semantic: Object.freeze({
        class: "evidence" as const,
        subjectId: workProduct.recordId,
        subjectDigest: workProduct.digest,
        evidenceKind: "agent-work-product" as const,
      }),
      inclusionReasons: Object.freeze(["delivery-applicable-agent-work-product"]),
      presentationHint: "markdown" as const,
      content: stored.content,
      useLimit: "The Work Product contains Agent-authored claims and judgments; it is not a Runtime observation or Director acceptance decision.",
    }));
  }
  return Object.freeze(values.sort((left, right) =>
    compareCodePoints(
      `${left.reference}\0${left.revision ?? ""}\0${left.id}`,
      `${right.reference}\0${right.revision ?? ""}\0${right.id}`,
    )));
}

function candidateSealItem(options: {
  request: FoundationExecutionProjectionRequest;
  seal: ControlRecordRevision | null;
  inventory: ProjectionByteInventoryBuilder;
}): readonly FoundationProjectionSourceItem[] {
  if (options.seal === null) return Object.freeze([]);
  if (options.request.role !== "reviewer") {
    throw new FoundationError(
      "lifecycle.projection.reviewer-seal",
      "Only reviewer Projection accepts retained Candidate Seal bytes",
    );
  }
  const seal = exactControlRevision(options.seal, "candidate-seal", "Candidate Seal");
  const bytes = controlProjectionBytes(seal);
  const stored = options.inventory.add({
    tier: "mandatory",
    key: `source:candidate-seal:${seal.recordId}:r${seal.revision}`,
    bytes,
    mediaType: "text/markdown",
    encoding: "utf-8",
  });
  return Object.freeze([buildTierTwoItem({
    id: stableId("source.candidate-seal", {
      id: seal.recordId,
      revision: seal.revision,
      digest: seal.digest,
    }),
    reference: `candidate:candidate-seal:${seal.recordId}`,
    revision: seal.digest,
    digest: seal.digest,
    authority: "runtime-authenticated-fact" as const,
    semantic: Object.freeze({
      class: "candidate" as const,
      subjectId: seal.recordId,
      subjectDigest: seal.digest,
      evidenceKind: null,
    }),
    inclusionReasons: Object.freeze(["delivery-evaluation-candidate-seal"]),
    presentationHint: "markdown" as const,
    content: stored.content,
    useLimit: "The Candidate Seal is one runtime-authenticated sealed-subject fact, not acceptance judgment.",
  })]);
}

function bindingItems(options: {
  loaded: FoundationLoadedRepositorySnapshot;
  inputs: readonly Readonly<{ knowledge: FoundationKnowledgeSet; closure: ReadonlyMap<string, ClosureEntry> }>[];
  inventory: ProjectionByteInventoryBuilder;
}): readonly FoundationProjectionBindingItem[] {
  const byBinding = new Map<string, { binding: FoundationCheckBinding; checkIds: Set<string>; evidenceKinds: Set<FoundationEvidenceKind> }>();
  for (const input of options.inputs) {
    for (const entry of input.closure.values()) {
      if (entry.record.frontMatter.kind !== "check") continue;
      const check = entry.record.frontMatter.spec as import("../knowledge/types.js").FoundationCheckSpec;
      const compatible = input.knowledge.bindings.filter((binding) => binding.checkId === entry.record.frontMatter.id);
      for (const requiredId of check.requiredBindings) {
        if (!compatible.some(({ binding }) => binding.id === requiredId)) {
          throw new FoundationError("lifecycle.projection.check-binding-missing", `Included Check ${entry.record.frontMatter.id} requires unavailable compatible Binding ${requiredId}`);
        }
      }
      for (const compatibleEntry of compatible.filter(({ binding }) => check.requiredBindings.includes(binding.id))) {
        const value = byBinding.get(compatibleEntry.binding.id) ?? {
          binding: compatibleEntry.binding,
          checkIds: new Set<string>(),
          evidenceKinds: new Set<FoundationEvidenceKind>(),
        };
        if (value.binding.digest !== compatibleEntry.binding.digest) {
          throw new FoundationError("lifecycle.projection.check-binding-mismatch", `Candidate and base Knowledge resolve different bytes for Binding ${compatibleEntry.binding.id}`);
        }
        value.checkIds.add(entry.record.frontMatter.id);
        for (const kind of check.evidenceKinds) value.evidenceKinds.add(kind);
        byBinding.set(compatibleEntry.binding.id, value);
      }
    }
  }
  return Object.freeze([...byBinding.values()].sort((left, right) => compareCodePoints(left.binding.id, right.binding.id)).map((entry) => {
    const bytes = projectionIndexBytes(entry.binding);
    const stored = options.inventory.add({ tier: "mandatory", key: `binding:${entry.binding.id}`, bytes, mediaType: "application/json", encoding: "utf-8" });
    return buildTierTwoItem({
      id: entry.binding.id,
      binding: entry.binding,
      checkIds: Object.freeze([...entry.binding.checkIds].sort(compareCodePoints)),
      compatibleCheckIds: Object.freeze([...entry.checkIds].sort(compareCodePoints)),
      bindingDigest: entry.binding.digest,
      evidenceKinds: Object.freeze([...entry.evidenceKinds].sort(compareCodePoints)),
      inclusionReasons: Object.freeze([...entry.checkIds].sort(compareCodePoints).map((checkId) => `required-by:${checkId}`)),
      presentationHint: "json" as const,
      content: stored.content,
      useLimit: "Binding bytes are execution guidance; only an authenticated Check Receipt establishes a disposition.",
    });
  }));
}

function omission(
  profile: FoundationProjectionProfile,
  candidates: readonly ReachableCandidate[],
  included: readonly ReachableCandidate[],
): FoundationProjectionOmission {
  const includedKeys = new Set(included.map((entry) => `${entry.category}\0${entry.id}`));
  const categories: FoundationProjectionOmissionCategory[] = REACHABLE_CATEGORIES.map((category) => {
    const before = candidates.filter((entry) => entry.category === category);
    const after = before.filter((entry) => includedKeys.has(`${entry.category}\0${entry.id}`));
    const omitted = before.filter((entry) => !includedKeys.has(`${entry.category}\0${entry.id}`));
    return Object.freeze({
      category,
      before: Object.freeze({ items: before.length, bytes: before.reduce((total, entry) => total + entry.byteLength, 0) }),
      after: Object.freeze({ items: after.length, bytes: after.reduce((total, entry) => total + entry.byteLength, 0) }),
      omitted: Object.freeze({ items: omitted.length, bytes: omitted.reduce((total, entry) => total + entry.byteLength, 0) }),
      omittedIds: Object.freeze(omitted.map((entry) => entry.id)),
      enumerationComplete: true as const,
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
    eligibleCategories: REACHABLE_CATEGORIES,
    categories: Object.freeze(categories),
    policy: "category-code-point-prefix-v1",
    mandatoryOmissions: 0,
  });
}

async function reachableItems(options: {
  request: FoundationExecutionProjectionRequest;
  loaded: FoundationLoadedRepositorySnapshot;
  objectRepository: string;
  knowledge: FoundationKnowledgeSet;
  provenanceKnowledge: FoundationKnowledgeSet;
  mandatorySourceKeys: ReadonlySet<string>;
  includedIds: ReadonlySet<string>;
  implementationPaths: ReadonlySet<string>;
  inventory: ProjectionByteInventoryBuilder;
}): Promise<Readonly<{ items: readonly FoundationProjectionReachableItem[]; omission: FoundationProjectionOmission }>> {
  const candidates: ReachableCandidate[] = [];
  for (const record of options.knowledge.currentRecords) {
    if (options.includedIds.has(record.frontMatter.id)) continue;
    const bytes = Buffer.from(record.sourceText, "utf8");
    candidates.push(Object.freeze({
      id: record.frontMatter.id,
      category: record.frontMatter.kind === "description" ? "neighboring-description" : "related-knowledge",
      kind: record.frontMatter.kind,
      summary: record.frontMatter.summary,
      sourceRevision: String(record.frontMatter.revision),
      digest: record.sourceDigest,
      objectId: record.objectId,
      bytes,
      byteLength: bytes.byteLength,
    }));
  }
  if (options.request.features.historical) {
    for (const record of options.knowledge.historicalRecords) {
      const bytes = Buffer.from(record.sourceText, "utf8");
      candidates.push(Object.freeze({
        id: stableId("historical", { id: record.frontMatter.id, revision: record.frontMatter.revision, sourceDigest: record.sourceDigest }),
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
  const currentSourceRevisions = new Map(options.provenanceKnowledge.currentRecords.map((record) => [
    record.frontMatter.id,
    record.frontMatter.revision,
  ]));
  const provenanceSources = options.provenanceKnowledge.sources.filter((source) =>
    currentSourceRevisions.get(source.recordId) === source.recordRevision &&
    !options.mandatorySourceKeys.has(sourceKey(source)));
  const objectIds = [
    ...provenanceSources.filter((source) => source.disposition === "resolved" && source.objectId !== null).map((source) => source.objectId!),
    ...(options.request.features.reachable ? options.loaded.productState.entries.filter((entry) => entry.role === "governed-implementation" && !options.implementationPaths.has(entry.path)).map((entry) => entry.objectId) : []),
  ];
  const sizes = await exactBlobSizes(options.objectRepository, objectIds);
  for (const source of provenanceSources) {
    const candidate = reachableSourceCandidate(source, sizes);
    if (candidate !== null) candidates.push(candidate);
  }
  if (options.request.features.reachable) {
    for (const entry of options.loaded.productState.entries.filter((value) => value.role === "governed-implementation" && !options.implementationPaths.has(value.path))) {
      candidates.push(Object.freeze({
        id: stableId("implementation", { path: entry.path, objectId: entry.objectId }),
        category: "unaffected-implementation",
        kind: "implementation",
        summary: `Exact unaffected implementation at ${entry.path}`,
        sourceRevision: entry.objectId,
        digest: sha256Bytes(entry.objectId),
        objectId: entry.objectId,
        bytes: null,
        byteLength: sizes.get(entry.objectId) ?? 0,
      }));
    }
  }
  candidates.sort((left, right) =>
    REACHABLE_CATEGORY_ORDER.get(left.category)! - REACHABLE_CATEGORY_ORDER.get(right.category)! ||
    compareCodePoints(left.id, right.id) || compareCodePoints(left.sourceRevision ?? "", right.sourceRevision ?? ""));
  const selected: ReachableCandidate[] = [];
  let totalBytes = 0;
  const stopped = new Set<FoundationProjectionReachableCategory>();
  for (const candidate of candidates) {
    if (stopped.has(candidate.category)) continue;
    if (selected.length + 1 > options.request.profile.maximumReachableItems ||
        totalBytes + candidate.byteLength > options.request.profile.maximumReachableBytes) {
      stopped.add(candidate.category);
      continue;
    }
    let resolved = candidate;
    if (candidate.bytes === null && candidate.objectId !== null) {
      const bytes = await objectBlobBytes(options.objectRepository, candidate.objectId, candidate.byteLength);
      resolved = Object.freeze({ ...candidate, bytes, digest: sha256Bytes(bytes) });
    }
    selected.push(resolved);
    totalBytes += resolved.byteLength;
  }
  const items: FoundationProjectionReachableItem[] = [];
  for (const candidate of selected) {
    const handle = `retrieval.${digestCanonical({ requestDigest: options.request.digest, category: candidate.category, id: candidate.id, revision: candidate.sourceRevision, digest: candidate.digest }).slice("sha256:".length)}`;
    if (candidate.bytes === null) {
      items.push(Object.freeze({
        handle,
        id: candidate.id,
        category: candidate.category,
        kind: candidate.kind,
        summary: candidate.summary,
        sourceRevision: candidate.sourceRevision,
        digest: candidate.digest,
        byteLength: 0,
        retrieval: "inaccessible",
        mountedPath: null,
      }));
      continue;
    }
    const stored = options.inventory.add({ tier: "reachable", key: handle, bytes: candidate.bytes, declaredDigest: candidate.digest });
    items.push(Object.freeze({
      handle,
      id: candidate.id,
      category: candidate.category,
      kind: candidate.kind,
      summary: candidate.summary,
      sourceRevision: candidate.sourceRevision,
      digest: candidate.digest,
      byteLength: stored.byteLength,
      retrieval: "mounted",
      mountedPath: stored.path,
    }));
  }
  return Object.freeze({ items: Object.freeze(items), omission: omission(options.request.profile, candidates, selected) });
}

async function failedIntegrationItems(options: Readonly<{
  input: FoundationFailedIntegrationProjectionInput;
  request: FoundationExecutionProjectionRequest;
  boundary: ControlRecordRevision;
  inventory: ProjectionByteInventoryBuilder;
}>): Promise<readonly FoundationProjectionSourceItem[]> {
  const { correction, parent } = options.input;
  const current = correction.candidateLineage[0];
  if (options.request.role !== "builder" || current === undefined || options.request.subject.candidate === null ||
      !sameControlReference(controlRevisionReference(current), options.request.subject.candidate.revision)) {
    throw new FoundationError("lifecycle.projection.control-invalid", "Failed integration correction must bind the exact current builder Candidate");
  }
  const records = [options.boundary, correction.assessment, ...correction.candidateLineage].map((record) =>
    exactControlRevision(record, record.recordKind, "Failed integration correction record"));
  const retained = new Map(records.map((record) => [`${record.recordId}\0${record.revision}`, record]));
  const verified = resolveFailedIntegrationCorrectionV1({
    store: { identity: { targetId: options.request.target.id, storeId: "projection-correction", processId: options.boundary.processId },
      getRevision: (id, revision) => retained.get(`${id}\0${revision}`) ?? null },
    assessment: controlRevisionReference(correction.assessment), boundary: options.boundary, candidate: current,
  });
  if (verified === null || canonicalJson(verified) !== canonicalJson(correction) ||
      !parent.knowledge.validation.complete || !parent.knowledge.validation.valid ||
      canonicalJson(parent.loaded.snapshot) !== canonicalJson(verified.canonicalParent) ||
      selfDigest(parent.loaded.snapshot) !== verified.canonicalParent.digest ||
      parent.loaded.epoch.commit !== verified.canonicalParent.commit || parent.loaded.epoch.tree !== verified.canonicalParent.tree ||
      parent.knowledge.manifest.digest !== verified.canonicalParent.knowledgeSetDigest) {
    throw new FoundationError("lifecycle.projection.basis-mismatch", "Failed integration correction requires the exact complete retained attempted parent");
  }
  const entries = await exactTreeEntries(parent.loaded.repository, verified.canonicalParent.tree, verified.canonicalParent.objectFormat);
  if (canonicalJson(entries) !== canonicalJson(parent.loaded.treeEntries)) {
    throw new FoundationError("lifecycle.projection.content-digest", "Attempted parent inventory differs from its exact retained tree");
  }
  const selectedEntries = new Map<string, FoundationGitTreeEntry>();
  const payload = correction.assessment.payload;
  const conflicts = payload.conflicts as readonly Readonly<{ path: string; kind: string }>[];
  const paths = sortUniqueCodePoints(conflicts.map(({ path }) => path)).map((path) => {
    const exact = entries.find((entry) => entry.path === path);
    const descendants = entries.filter((entry) => entry.path.startsWith(`${path}/`));
    const blockingAncestor = entries.find((entry) => path.startsWith(`${entry.path}/`)) ?? null;
    for (const entry of [...(exact === undefined ? [] : [exact]), ...descendants, ...(blockingAncestor === null ? [] : [blockingAncestor])]) {
      selectedEntries.set(entry.path, entry);
    }
    return Object.freeze({ path, disposition: exact !== undefined ? "entry" : descendants.length > 0 ? "directory" : "absent",
      exact: exact ?? null, descendants: Object.freeze(descendants.map(({ path }) => path)), blockingAncestor });
  });
  const result: FoundationProjectionSourceItem[] = [];
  const sourceReference = (key: string) => `candidate:integration-correction:${key.startsWith("parent:")
    ? `parent:${sha256Bytes(key.slice(7)).slice(7)}` : key}`;
  const useLimit = "Read-only failed integration correction input. The attempted parent does not replace the governing Work Boundary or the selected Candidate application base; a fresh integration must assess the corrected Candidate.";
  const add = (key: string, bytes: Uint8Array, options: Readonly<{ authority: FoundationProjectionSourceItem["authority"];
    subjectId: string; subjectDigest: Sha256; presentationHint: FoundationProjectionPresentationHint;
    mediaType: string; encoding: "utf-8" | "binary" }>) => {
    const stored = optionsInventory.add({ tier: "mandatory", key: `source:failed-integration:${key}`, bytes,
      mediaType: options.mediaType, encoding: options.encoding });
    result.push(buildTierTwoItem({ id: stableId("source.integration-correction", { key, digest: stored.digest }),
      reference: sourceReference(key), revision: correction.assessment.digest, digest: stored.digest,
      authority: options.authority, semantic: { class: options.authority === "runtime-authenticated-fact" ? "candidate" : "source", subjectId: options.subjectId,
        subjectDigest: options.subjectDigest, evidenceKind: null }, inclusionReasons: ["builder-failed-integration-correction"],
      presentationHint: options.presentationHint, content: stored.content, useLimit }));
  };
  const optionsInventory = options.inventory;
  for (const [name, record] of [["assessment", verified.assessment], ["source-candidate", verified.sourceCandidate]] as const) {
    add(name, controlProjectionBytes(record), { authority: "runtime-authenticated-fact", subjectId: record.recordId,
      subjectDigest: record.digest, presentationHint: "markdown", mediaType: "text/markdown", encoding: "utf-8" });
  }
  const selected = [...selectedEntries.values()].sort((a, b) => compareCodePoints(a.path, b.path));
  const descriptor = { schema: "lifecycle.integration-correction-input.v1", assessment: controlRevisionReference(verified.assessment),
    workBoundary: controlRevisionReference(options.boundary), currentCandidate: controlRevisionReference(current),
    sourceCandidate: controlRevisionReference(verified.sourceCandidate), parent: verified.canonicalParent,
    completeConflictPaths: true, paths, entries: selected.map((entry) => ({ ...entry,
      sourceReference: entry.type === "blob" ? sourceReference(`parent:${entry.path}`) : null })) };
  const descriptorDigest = digestCanonical(descriptor);
  add("parent-paths", projectionIndexBytes(descriptor), { authority: "runtime-authenticated-fact",
    subjectId: stableId("integration-correction.paths", descriptorDigest), subjectDigest: descriptorDigest,
    presentationHint: "plain-text", mediaType: "application/json", encoding: "utf-8" });
  for (const entry of selected) {
    if (entry.type !== "blob") continue; // The exact non-blob entry remains explicit in the complete path descriptor.
    const id = stableId("integration-correction.parent", { assessment: verified.assessment.digest, path: entry.path, objectId: entry.objectId });
    const bytes = await mandatoryBlobBytes({ repository: parent.loaded.repository, profile: options.request.profile,
      objectId: entry.objectId, id, locator: entry.path, category: "source" });
    const presentation = gitMaterialPresentation(bytes, "source");
    add(`parent:${entry.path}`, bytes, { authority: "repository-reality", subjectId: id,
      subjectDigest: sha256Bytes(bytes), ...presentation });
  }
  return Object.freeze(result);
}

async function builderRepairItems(options: Readonly<{
  input: FoundationBuilderRepairRepositoryV1; request: FoundationExecutionProjectionRequest;
  boundary: ControlRecordRevision; inventory: ProjectionByteInventoryBuilder;
}>): Promise<readonly FoundationProjectionSourceItem[]> {
  const { retained, repository, closure } = options.input;
  const current = controlRevisionReference(retained.currentCandidate);
  if (options.request.role !== "builder" || options.request.subject.candidate === null ||
      !sameControlReference(current, options.request.subject.candidate.revision) ||
      canonicalJson(retained.currentBoundary) !== canonicalJson(options.boundary) ||
      sha256Bytes(retained.manifestBytes) !== retained.descriptor.carrierManifest.digest ||
      closure.rootTree !== retained.descriptor.rejection.candidateTree) {
    throw new FoundationError("lifecycle.projection.control-invalid", "Builder repair context differs from exact current and rejected subjects");
  }
  const currentEntries = await exactTreeEntries(options.input.currentRepository, controlString(
    controlObject(retained.currentCandidate.payload.state, "Repair current Candidate state").tree, "Repair current Candidate tree"), closure.objectFormat);
  if (canonicalJson(currentEntries) !== canonicalJson(options.input.currentEntries)) {
    throw new FoundationError("lifecycle.projection.content-digest", "Repair comparison inventory differs from its exact current Candidate");
  }
  const rejectedEntries = await exactTreeEntries(repository, closure.rootTree, closure.objectFormat);
  const before = new Map(currentEntries.map((entry) => [entry.path, entry]));
  const after = new Map(rejectedEntries.map((entry) => [entry.path, entry]));
  const paths = sortUniqueCodePoints([...before.keys(), ...after.keys()]).flatMap((path) => {
    const prior = before.get(path) ?? null;
    const next = after.get(path) ?? null;
    return canonicalJson(prior) === canonicalJson(next) ? [] : [Object.freeze({ path, prior, next })];
  });
  const sourceReference = (path: string) => `candidate:builder-repair:${sha256Bytes(path).slice(7)}`;
  const useLimit = "Read-only unselected Product output from a failed builder. These bytes and malformed Knowledge are repair material, not the current Candidate, governing Knowledge, or authority. The writable workspace starts from the exact current Candidate.";
  const items: FoundationProjectionSourceItem[] = [];
  const add = (key: string, bytes: Uint8Array, authority: FoundationProjectionSourceItem["authority"], presentation: Readonly<{
    presentationHint: FoundationProjectionPresentationHint; mediaType: string; encoding: "utf-8" | "binary";
  }>) => {
    const stored = options.inventory.add({ tier: "mandatory", key: `source:builder-repair:${key}`, bytes,
      mediaType: presentation.mediaType, encoding: presentation.encoding });
    items.push(buildTierTwoItem({ id: stableId("source.builder-repair", { key, receipt: retained.receipt.digest, digest: stored.digest }),
      reference: sourceReference(key), revision: retained.receipt.digest, digest: stored.digest, authority,
      semantic: { class: authority === "runtime-authenticated-fact" ? "candidate" : "source", subjectId: stableId("builder-repair.source", { receipt: retained.receipt.digest, key }), subjectDigest: stored.digest, evidenceKind: null },
      inclusionReasons: ["builder-failed-output-repair"], presentationHint: presentation.presentationHint, content: stored.content, useLimit }));
  };
  const index = Object.freeze({ schema: "lifecycle.builder-repair-projection.v1", receipt: controlRevisionReference(retained.receipt),
    descriptor: retained.descriptor, currentCandidate: current, currentBoundary: controlRevisionReference(options.boundary),
    completeChangedPaths: true, paths: paths.map((path) => ({ ...path, sourceReference: path.next === null ? null : sourceReference(`file:${path.path}`) })) });
  add("inventory", projectionIndexBytes(index), "runtime-authenticated-fact", { presentationHint: "plain-text", mediaType: "application/json", encoding: "utf-8" });
  for (const path of paths) {
    if (path.next === null) continue;
    if (path.next.type !== "blob") throw new FoundationError("lifecycle.projection.content-digest", "Repair output contains a non-regular Product entry");
    const bytes = await mandatoryBlobBytes({ repository, profile: options.request.profile,
      objectId: path.next.objectId, id: stableId("source.builder-repair", { path: path.path, objectId: path.next.objectId }),
      locator: path.path, category: "source" });
    add(`file:${path.path}`, bytes, "informational-source", gitMaterialPresentation(bytes, "source"));
  }
  return Object.freeze(items);
}

export async function compileExecution(options: {
  request: FoundationExecutionProjectionRequest;
  loaded: FoundationLoadedRepositorySnapshot;
  knowledge: FoundationKnowledgeSet;
  subject: FoundationExecutionProjectionSubject;
  workBoundary: ControlRecordRevision;
  inventory: ProjectionByteInventoryBuilder;
  candidateObservation?: FoundationReviewerProjectionObservation | null;
  integrationParent?: FoundationIntegrationParentProjectionInput | null;
  integrationRecords?: FoundationIntegrationProjectionRecords | null;
  failedIntegration?: FoundationFailedIntegrationProjectionInput | null;
  builderRepair?: FoundationBuilderRepairRepositoryV1 | null;
  /** Private scoped repository containing the verified Candidate Carrier and exact admitted base. */
  candidateObjectRepository?: string | null;
  checkReceipts?: readonly ControlRecordRevision[];
  agentWorkProducts?: readonly FoundationAgentWorkProductProjectionEvidence[];
}): Promise<FoundationExecutionCompilation> {
  if (!options.knowledge.validation.complete || !options.knowledge.validation.valid) {
    throw new FoundationError("lifecycle.projection.knowledge-invalid", "Execution Projection requires one complete valid Knowledge Set");
  }
  const boundary = exactBoundaryRevision(options.request, options.workBoundary);
  const capabilityBinding = options.subject.core.capability;
  const registeredCapability = options.loaded.contract.capabilityProfiles[capabilityBinding.profileId];
  if (registeredCapability === undefined ||
      registeredCapability.id !== capabilityBinding.profileId ||
      registeredCapability.digest !== capabilityBinding.profileDigest) {
    throw new FoundationError(
      "lifecycle.projection.basis-mismatch",
      "Execution Projection requires one exact repository-registered Capability Profile",
      {
        observedFacts: {
          profileId: capabilityBinding.profileId,
          profileDigest: capabilityBinding.profileDigest,
          registeredDigest: registeredCapability?.digest ?? null,
        },
      },
    );
  }
  assertProjectionPropositionOrder(options.subject.core.propositions);
  const disciplines = options.subject.core.disciplines;
  const disciplineRoots = options.subject.knowledgeRoots.filter(({ id }) => id.startsWith("discipline."));
  const exactDisciplines = disciplineRoots.map(({ id, revision, sourceDigest, semanticDigest }) => {
    const record = options.knowledge.index.currentByIdentity.get(id);
    return {
      id, revision, sourceDigest, semanticDigest,
      title: record?.frontMatter.title,
      summary: record?.frontMatter.summary,
      path: record?.path,
    };
  }).sort((left, right) => compareCodePoints(left.id, right.id));
  const workTypes = new Set(options.knowledge.disciplineRegistry.workTypes.map(({ id }) => id));
  if (disciplines.registryDigest !== options.knowledge.disciplineRegistry.digest ||
      disciplines.workTypeIds.some((id, index) => !workTypes.has(id) ||
        (index > 0 && compareCodePoints(disciplines.workTypeIds[index - 1]!, id) >= 0)) ||
      canonicalJson(disciplines.records) !== canonicalJson(exactDisciplines)) {
    throw new FoundationError(
      "lifecycle.projection.discipline-invalid",
      "Execution Discipline guidance must bind the admitted Registry and exact selected Knowledge roots",
    );
  }
  const candidateObjectRepository = options.candidateObjectRepository ?? null;
  if ((options.request.role === "reviewer") !== (candidateObjectRepository !== null)) {
    throw new FoundationError(
      "lifecycle.projection.reviewer-seal",
      options.request.role === "reviewer"
        ? "Reviewer Projection requires one scoped verified Candidate object repository"
        : "Only reviewer Projection accepts a Candidate object repository",
    );
  }
  const parent = options.integrationParent ?? null;
  const integration = options.request.subject.candidate?.integration ?? null;
  if (options.request.role === "reviewer") {
    if (parent === null || integration === null ||
        !parent.knowledge.validation.complete || !parent.knowledge.validation.valid ||
        parent.loaded.snapshot.digest !== integration.canonicalParent.digest ||
        parent.loaded.snapshot.targetId !== options.loaded.snapshot.targetId ||
        options.request.subject.candidate?.baseCommit !== integration.canonicalParent.commit) {
      throw new FoundationError("lifecycle.projection.reviewer-seal", "Reviewer Projection requires the exact complete valid integration-parent context");
    }
  } else if (parent !== null) {
    throw new FoundationError("lifecycle.projection.reviewer-seal", "Only reviewer Projection accepts integration-parent context");
  }
  const integrationSources: FoundationProjectionSourceItem[] = [];
  const correctionSources = options.failedIntegration == null ? Object.freeze([]) : await failedIntegrationItems({
    input: options.failedIntegration, request: options.request, boundary, inventory: options.inventory,
  });
  const repairSources = options.builderRepair == null ? Object.freeze([]) : await builderRepairItems({
    input: options.builderRepair, request: options.request, boundary, inventory: options.inventory,
  });
  if (options.request.role === "reviewer") {
    const records = options.integrationRecords;
    if (records == null) throw new FoundationError("lifecycle.projection.reviewer-seal", "Reviewer requires exact integration Assessment and source Candidate records");
    for (const [name, kind] of [["assessment", "integration-assessment"], ["sourceCandidate", "candidate-revision"]] as const) {
      const record = exactControlRevision(records[name], kind, "Integration review record");
      if (record.processId !== boundary.processId ||
          !sameControlReference(controlRevisionReference(record), integration![name])) {
        throw new FoundationError("lifecycle.projection.reviewer-seal", "Integration review record differs from its exact request binding");
      }
      const bytes = controlProjectionBytes(record);
      const stored = options.inventory.add({ tier: "mandatory", key: `source:integration:${name}`, bytes,
        mediaType: "text/markdown", encoding: "utf-8" });
      integrationSources.push(buildTierTwoItem({
        id: stableId("source.integration", { name, digest: record.digest }),
        reference: `candidate:integration-${name}`, revision: record.digest, digest: record.digest,
        authority: "runtime-authenticated-fact", semantic: { class: "candidate", subjectId: record.recordId,
          subjectDigest: record.digest, evidenceKind: null },
        inclusionReasons: ["reviewer-integration-applicability"], presentationHint: "markdown", content: stored.content,
        useLimit: "Exact integration provenance is runtime-observed context; the reviewer independently judges mandate and baseline applicability.",
      }));
    }
    if (!sameControlReference(exactRelationship(records.assessment, "integrates", "candidate-revision"),
        controlRevisionReference(records.sourceCandidate)) ||
        canonicalJson(records.assessment.payload.canonicalParent) !== canonicalJson(integration!.canonicalParent)) {
      throw new FoundationError("lifecycle.projection.reviewer-seal", "Integration Assessment source and parent do not reproduce the exact request");
    }
  } else if (options.integrationRecords != null) {
    throw new FoundationError("lifecycle.projection.reviewer-seal", "Only reviewer Projection accepts integration review records");
  }
  const objectRepository = candidateObjectRepository ?? options.loaded.repository;
  const reviewer = options.request.role === "reviewer"
    ? await verifyCandidateObservation({
      request: options.request,
      loaded: options.loaded,
      objectRepository,
      boundary,
      observation: options.candidateObservation ?? null,
    })
    : null;
  if (options.request.role !== "reviewer" && options.candidateObservation != null) {
    throw new FoundationError("lifecycle.projection.reviewer-seal", "Only reviewer Projection accepts a sealed candidate observation");
  }
  if (options.request.role !== "reviewer" && (options.checkReceipts?.length ?? 0) > 0) {
    throw new FoundationError(
      "lifecycle.projection.evidence-invalid",
      "Only reviewer Projection accepts runtime-authenticated Check Receipts",
    );
  }
  const seeded = seedSubject({
    loaded: options.loaded,
    knowledge: options.knowledge,
    subject: options.subject,
    boundary,
  });
  const closure = buildClosure({
    knowledge: options.knowledge,
    seeds: seeded.seeds,
    role: options.request.role,
    maximumDepth: options.request.profile.maximumRelationshipDepth,
  });
  const parentSeeded = parent === null ? null : seedSubject({
    loaded: parent.loaded, knowledge: parent.knowledge, subject: options.subject, boundary, currentRoots: true,
  });
  const parentSeeds = [...(parentSeeded?.seeds ?? [])];
  if (reviewer !== null && parent !== null) {
    for (const change of reviewer.changes) {
      const prior = parent.knowledge.currentRecords.find((entry) => entry.path === change.path);
      if (prior !== undefined) parentSeeds.push({ id: prior.frontMatter.id, reason: `integration-parent-prior:${change.path}` });
    }
  }
  const parentClosure = parent === null ? new Map<string, ClosureEntry>() : buildClosure({
    knowledge: parent.knowledge, seeds: parentSeeds, role: "reviewer",
    maximumDepth: options.request.profile.maximumRelationshipDepth,
  });

  const implementationReasons = new Map(seeded.implementationReasons);
  let candidateClosure: ReadonlyMap<string, ClosureEntry> = new Map();
  if (reviewer !== null) {
    const candidateSeeds: ClosureSeed[] = [...closure.keys()].filter((id) => reviewer.knowledge.index.currentByIdentity.has(id))
      .map((id) => ({ id, reason: "candidate-governing-context" }));
    for (const change of reviewer.changes) {
      const record = reviewer.knowledge.currentRecords.find((entry) => entry.path === change.path);
      if (record !== undefined) {
        candidateSeeds.push({
          id: record.frontMatter.id,
          reason: `candidate-changed-${record.frontMatter.kind}:${change.path}`,
        });
      }
      const admittedArtifact = options.subject.core.requiredArtifacts.find((artifact) =>
        artifact.path === change.path || atOrBelow(change.path, artifact.path));
      if (
        !knowledgeOrControlPath(change.path, options.loaded.contract) && (
          governedPath(options.loaded, change.path) ||
          admittedArtifact !== undefined && ["code", "test", "documentation"].includes(admittedArtifact.role)
        )
      ) {
        const path = change.path;
        const values = new Set(implementationReasons.get(path) ?? []);
        values.add(`candidate-changed:${change.change}`);
        implementationReasons.set(path, Object.freeze([...values].sort(compareCodePoints)));
        const knowledge = change.change === "deleted" ? parent!.knowledge : reviewer.knowledge;
        const descriptionId = requireOneDescription(knowledge, path);
        if (descriptionId !== "" && reviewer.knowledge.index.currentByIdentity.has(descriptionId)) candidateSeeds.push({ id: descriptionId, reason: `candidate-coverage:${path}` });
      }
    }
    candidateClosure = buildClosure({
      knowledge: reviewer.knowledge,
      seeds: candidateSeeds,
      role: "reviewer",
      maximumDepth: options.request.profile.maximumRelationshipDepth,
    });
  }

  const conflicts = options.knowledge.conflicts.filter((entry) => closure.has(entry.leftId) || closure.has(entry.rightId));
  const candidateConflicts = reviewer === null ? [] : reviewer.knowledge.conflicts.filter((entry) => candidateClosure.has(entry.leftId) || candidateClosure.has(entry.rightId));
  const parentConflicts = parent?.knowledge.conflicts.filter((entry) => parentClosure.has(entry.leftId) || parentClosure.has(entry.rightId)) ?? [];
  if (conflicts.length > 0 || parentConflicts.length > 0 || candidateConflicts.length > 0) {
    throw new FoundationError("lifecycle.projection.authority-conflict", "Execution Projection closure contains an unresolved Knowledge conflict", {
      observedFacts: { conflictDigests: [...conflicts, ...parentConflicts, ...candidateConflicts].map((entry) => entry.digest).sort(compareCodePoints) },
    });
  }

  const mandatory: FoundationProjectionMandatoryItem[] = [];
  for (const entry of [...closure.values()].sort((left, right) => recordOrder(left.record, right.record))) {
    mandatory.push(await mandatoryRecordItem({ record: entry.record, basis: "base", closure: entry, inventory: options.inventory }));
  }
  for (const entry of [...parentClosure.values()].sort((left, right) => recordOrder(left.record, right.record))) {
    mandatory.push(await mandatoryRecordItem({ record: entry.record, basis: "integration-parent", closure: entry, inventory: options.inventory }));
  }
  for (const entry of [...candidateClosure.values()].sort((left, right) => recordOrder(left.record, right.record))) {
    mandatory.push(await mandatoryRecordItem({ record: entry.record, basis: "candidate", closure: entry, inventory: options.inventory }));
  }

  const effectiveCoverage = reviewer?.knowledge ?? options.knowledge;
  const implementation = await implementationItems({
    loaded: options.loaded,
    objectRepository,
    profile: options.request.profile,
    knowledge: effectiveCoverage,
    paths: implementationReasons,
    candidate: reviewer,
    inventory: options.inventory,
  });
  const bindings = bindingItems({
    loaded: options.loaded,
    inputs: Object.freeze([
      Object.freeze({ knowledge: options.knowledge, closure }),
      ...(parent === null ? [] : [Object.freeze({ knowledge: parent.knowledge, closure: parentClosure })]),
      ...(reviewer === null ? [] : [Object.freeze({ knowledge: reviewer.knowledge, closure: candidateClosure })]),
    ]),
    inventory: options.inventory,
  });
  const includedIds = new Set([...closure.keys(), ...parentClosure.keys(), ...candidateClosure.keys()]);
  const baseSources = await sourceItems({
    loaded: options.loaded,
    objectRepository: options.loaded.repository,
    profile: options.request.profile,
    knowledge: options.knowledge,
    basis: "base",
    includedIds: new Set(closure.keys()),
    roots: options.subject.sourceRoots,
    candidateDiff: reviewer?.diff,
    candidateArtifacts: reviewer === null ? undefined : Object.freeze({
      digest: controlDigest(
        controlObject(reviewer.candidate.payload.state, "Candidate state").artifactSetDigest,
        "Candidate artifact-set digest",
      ),
      values: reviewer.productState.entries,
    }),
    inventory: options.inventory,
  });
  const parentSources = parent === null ? null : await sourceItems({
    loaded: parent.loaded, objectRepository: parent.loaded.repository,
    profile: options.request.profile, knowledge: parent.knowledge, basis: "integration-parent",
    includedIds: new Set(parentClosure.keys()), roots: options.subject.sourceRoots,
    inventory: options.inventory,
  });
  const candidateSources = reviewer === null ? null : await sourceItems({
    loaded: options.loaded,
    objectRepository,
    profile: options.request.profile,
    knowledge: reviewer.knowledge,
    basis: "candidate",
    includedIds: new Set(candidateClosure.keys()),
    roots: Object.freeze([]),
    inventory: options.inventory,
  });
  const candidateContext = reviewer === null ? Object.freeze([]) : await candidateContextItems({
    loaded: options.loaded,
    objectRepository,
    profile: options.request.profile,
    subject: options.subject,
    observation: reviewer,
    inventory: options.inventory,
  });
  const candidateSealSource = candidateSealItem({
    request: options.request,
    seal: reviewer?.seal ?? null,
    inventory: options.inventory,
  });
  const receiptSources = checkReceiptItems({
    receipts: options.checkReceipts ?? Object.freeze([]),
    request: options.request,
    seal: reviewer?.seal ?? null,
    boundary,
    inventory: options.inventory,
  });
  const workProductSources = agentWorkProductItems({
    evidence: options.agentWorkProducts ?? Object.freeze([]),
    request: options.request,
    boundary,
    inventory: options.inventory,
  });
  const reachable = await reachableItems({
    request: options.request,
    loaded: parent?.loaded ?? options.loaded,
    objectRepository,
    knowledge: options.knowledge,
    provenanceKnowledge: reviewer?.knowledge ?? options.knowledge,
    mandatorySourceKeys: new Set([...(baseSources.selectedKeys), ...(parentSources?.selectedKeys ?? []), ...(candidateSources?.selectedKeys ?? [])]),
    includedIds,
    implementationPaths: new Set(implementationReasons.keys()),
    inventory: options.inventory,
  });
  return Object.freeze({
    mandatory: Object.freeze(mandatory),
    implementation,
    bindings,
    sources: Object.freeze([...(baseSources.items), ...(parentSources?.items ?? []), ...(candidateSources?.items ?? []), ...integrationSources, ...correctionSources, ...repairSources, ...candidateContext, ...candidateSealSource, ...receiptSources, ...workProductSources].sort((left, right) =>
      compareCodePoints(`${left.reference}\0${left.revision ?? ""}\0${left.id}`, `${right.reference}\0${right.revision ?? ""}\0${right.id}`))),
    reachable: reachable.items,
    conflicts: Object.freeze([]),
    unresolved: Object.freeze([...(baseSources.unresolved), ...(parentSources?.unresolved ?? []), ...(candidateSources?.unresolved ?? [])].sort((left, right) =>
      compareCodePoints(`${left.required ? "0" : "1"}\0${left.reference}\0${left.id}`, `${right.required ? "0" : "1"}\0${right.reference}\0${right.id}`))),
    omission: reachable.omission,
    inventory: options.inventory.entries(),
  });
}
