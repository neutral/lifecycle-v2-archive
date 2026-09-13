import { TextDecoder } from "node:util";
import { consumeFoundationKnowledgeCompilation, validateKnowledgeSet } from "../knowledge/knowledge-set.js";
import type { FoundationKnowledgeSet } from "../knowledge/types.js";
import {
  FOUNDATION_SPECIFICATION_REVISION,
  FOUNDATION_VALIDATION_RESULT_SCHEMA,
} from "../constants.js";
import { FoundationError } from "../error.js";
import { assertIndependentGitRepository } from "./independent-git.js";
import { canonicalJson, digestCanonical, selfDigest, type Sha256 } from "../validation/canonical.js";
import {
  validationDigestSubject,
  validationResultDigest,
  type FoundationValidationResult,
} from "../validation/result.js";
import { parseStrictJson } from "../validation/strict-json.js";
import { buildAtlasState } from "./atlas-state.js";
import { resolveAtlas } from "../atlas/resolution.js";
import { FOUNDATION_REPOSITORY_CONTRACT_PATH, parseRepositoryContract } from "./contract.js";
import {
  assertRepositoryEpochUnmoved,
  blobBytes,
  canonicalRepository,
  exactTreeEntries,
  git,
  resolveAttachedEpoch,
  worktreePathInventory,
} from "./git.js";
import { buildProductState, pathWithin, productStateRole } from "./product-state.js";
import type {
  FoundationAuthoritativeWorktreeState,
  FoundationGitTreeEntry,
  FoundationLoadedRepositoryIdentityEpoch,
  FoundationLoadedRepositoryEpoch,
  FoundationLoadedRepositorySnapshot,
  FoundationRepositoryContract,
  FoundationRepositorySnapshotBasis,
  FoundationRepositorySnapshot,
} from "./types.js";

const CONTRACT_MAXIMUM_BYTES = 4 * 1024 * 1024;
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function decodeUtf8(bytes: Buffer, path: string): string {
  try {
    return UTF8.decode(bytes);
  } catch (error) {
    throw new FoundationError("lifecycle.text.utf8", `${path} is not valid UTF-8`, {
      observedFacts: { cause: error instanceof Error ? error.message : String(error), path },
    });
  }
}

function assertSha256(value: string, label: string): asserts value is Sha256 {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new FoundationError("lifecycle.repository.snapshot", `${label} must be one lowercase SHA-256 digest`);
  }
}

async function readExactContract(repository: string, commit: string, entries: readonly FoundationGitTreeEntry[]): Promise<FoundationRepositoryContract> {
  const entry = entries.find((candidate) => candidate.path === FOUNDATION_REPOSITORY_CONTRACT_PATH);
  if (entry === undefined) throw new FoundationError("lifecycle.repository.contract-missing", `Bound commit lacks ${FOUNDATION_REPOSITORY_CONTRACT_PATH}`);
  if (entry.type !== "blob" || entry.mode !== "100644") {
    throw new FoundationError("lifecycle.path.prohibited", `${FOUNDATION_REPOSITORY_CONTRACT_PATH} must be one tracked non-executable regular blob`, {
      observedFacts: { mode: entry.mode, objectId: entry.objectId, type: entry.type },
    });
  }
  const bytes = await blobBytes(repository, commit, FOUNDATION_REPOSITORY_CONTRACT_PATH, CONTRACT_MAXIMUM_BYTES);
  return parseRepositoryContract(parseStrictJson(decodeUtf8(bytes, FOUNDATION_REPOSITORY_CONTRACT_PATH), {
    source: FOUNDATION_REPOSITORY_CONTRACT_PATH,
  }));
}

function assertNoMixedPredecessorState(entries: readonly FoundationGitTreeEntry[]): void {
  for (const entry of entries) {
    if (!pathWithin(entry.path, "records/control") || !entry.path.endsWith(".json")) continue;
    throw new FoundationError(
      "lifecycle.repository.epoch-mixed",
      `Fresh Foundation snapshot refuses predecessor JSON Control state at ${entry.path}`,
      { observedFacts: { path: entry.path, mode: entry.mode, type: entry.type } },
    );
  }
}

/**
 * Bind the exact attached repository identity without resolving current Atlas
 * semantics. This is the public-dispatch coordinate for operations whose
 * context is an immutable historical Work Boundary. It deliberately does not
 * claim that the current repository is a complete valid context source.
 */
export async function loadRepositoryIdentityEpoch(
  path: string,
): Promise<FoundationLoadedRepositoryIdentityEpoch> {
  const repository = await canonicalRepository(path);
  await assertIndependentGitRepository(repository);
  const epoch = await resolveAttachedEpoch(repository);
  const treeEntries = await exactTreeEntries(repository, epoch.tree, epoch.objectFormat);
  const contract = await readExactContract(repository, epoch.commit, treeEntries);
  if (contract.canonicalBranch !== epoch.ref) {
    throw new FoundationError(
      "lifecycle.repository.branch-mismatch",
      "Attached branch does not match the exact repository contract",
      { observedFacts: { actual: epoch.ref, expected: contract.canonicalBranch } },
    );
  }
  assertNoMixedPredecessorState(treeEntries);
  await assertRepositoryEpochUnmoved(repository, epoch);
  return Object.freeze({ repository, contract, epoch, treeEntries });
}

function authoritativeWorktreePath(contract: FoundationRepositoryContract, path: string): boolean {
  return pathWithin(path, "records/control") || productStateRole(contract, path) !== null;
}

export async function authoritativeWorktreeState(repository: string, contract: FoundationRepositoryContract): Promise<FoundationAuthoritativeWorktreeState> {
  const inventory = await worktreePathInventory(repository);
  const modified = inventory.modified.filter((path) => authoritativeWorktreePath(contract, path));
  const untracked = inventory.untracked.filter((path) => authoritativeWorktreePath(contract, path));
  const ignored = inventory.ignored.filter((path) => authoritativeWorktreePath(contract, path));
  const state = Object.freeze({
    dirty: modified.length > 0 || untracked.length > 0 || ignored.length > 0,
    modified: Object.freeze(modified),
    untracked: Object.freeze(untracked),
    ignored: Object.freeze(ignored),
  });
  return state;
}

function assertNoUnboundWorktreeAuthority(state: FoundationAuthoritativeWorktreeState): void {
  if (state.untracked.length > 0 || state.ignored.length > 0) {
    throw new FoundationError("lifecycle.repository.untracked-authority", "Untracked or ignored material appears under an authoritative repository root", {
      observedFacts: { ignored: state.ignored, untracked: state.untracked },
    });
  }
}

function repositorySnapshot(options: {
  contract: FoundationRepositoryContract;
  commit: string;
  tree: string;
  objectFormat: "sha1" | "sha256";
  productStateDigest: Sha256;
  atlasStateDigest: Sha256;
  atlasResolutionDigest: Sha256;
  atlasNormalizedModelDigest: Sha256;
  atlasResourceBindingsDigest: Sha256;
  knowledgeSetDigest: Sha256;
}): FoundationRepositorySnapshot {
  const subject = {
    targetId: options.contract.targetId,
    commit: options.commit,
    tree: options.tree,
    objectFormat: options.objectFormat,
    contractDigest: options.contract.digest,
    productStateDigest: options.productStateDigest,
    atlasStateDigest: options.atlasStateDigest,
    atlasResolutionDigest: options.atlasResolutionDigest,
    atlasNormalizedModelDigest: options.atlasNormalizedModelDigest,
    atlasResourceBindingsDigest: options.atlasResourceBindingsDigest,
    knowledgeSetDigest: options.knowledgeSetDigest,
  };
  return Object.freeze({ ...subject, digest: digestCanonical(subject) });
}

/** Bind the exact pre-Knowledge repository epoch without reading authority from live worktree bytes. */
export async function loadRepositoryEpoch(path: string): Promise<FoundationLoadedRepositoryEpoch> {
  const repository = await canonicalRepository(path);
  await assertIndependentGitRepository(repository);
  const epoch = await resolveAttachedEpoch(repository);
  const treeEntries = await exactTreeEntries(repository, epoch.tree, epoch.objectFormat);
  const contract = await readExactContract(repository, epoch.commit, treeEntries);
  if (contract.canonicalBranch !== epoch.ref) {
    throw new FoundationError("lifecycle.repository.branch-mismatch", "Attached branch does not match the exact repository contract", {
      observedFacts: { actual: epoch.ref, expected: contract.canonicalBranch },
    });
  }
  assertNoMixedPredecessorState(treeEntries);
  const productState = buildProductState(contract, treeEntries);
  const atlasState = buildAtlasState(contract, treeEntries);
  const atlas = await resolveAtlas({ repository, entrypoint: contract.atlas.entrypoint, atlasState, treeEntries });
  const worktree = await authoritativeWorktreeState(repository, contract);
  assertNoUnboundWorktreeAuthority(worktree);
  await assertRepositoryEpochUnmoved(repository, epoch);
  return Object.freeze({ repository, contract, epoch, treeEntries, productState, atlasState, atlas, worktree });
}

/**
 * Load one exact historical commit and check that the attached epoch stayed
 * unchanged during reproduction. Lock ownership remains with the caller.
 * Later canonical Product commits do not rewrite this historical Knowledge
 * and Atlas basis; Delivery Control remains outside canonical Git.
 */
export async function loadRepositoryEpochAtCommit(
  path: string,
  commit: string,
): Promise<FoundationLoadedRepositoryEpoch> {
  const repository = await canonicalRepository(path);
  await assertIndependentGitRepository(repository);
  const attached = await resolveAttachedEpoch(repository);
  const resolvedCommit = (await git(repository, [
    "rev-parse", "--verify", "--end-of-options", `${commit}^{commit}`,
  ])).stdout.trim();
  if (resolvedCommit !== commit) {
    throw new FoundationError(
      "lifecycle.repository.object-id",
      "Historical repository epoch requires one exact full commit identity",
      { observedFacts: { actual: resolvedCommit, expected: commit } },
    );
  }
  const tree = (await git(repository, [
    "rev-parse", "--verify", "--end-of-options", `${resolvedCommit}^{tree}`,
  ])).stdout.trim();
  const epoch = Object.freeze({
    ref: attached.ref,
    commit: resolvedCommit,
    tree,
    objectFormat: attached.objectFormat,
  });
  const treeEntries = await exactTreeEntries(repository, tree, attached.objectFormat);
  const contract = await readExactContract(repository, resolvedCommit, treeEntries);
  if (contract.canonicalBranch !== attached.ref) {
    throw new FoundationError("lifecycle.repository.branch-mismatch", "Attached branch does not match the exact historical repository contract", {
      observedFacts: { actual: attached.ref, expected: contract.canonicalBranch },
    });
  }
  assertNoMixedPredecessorState(treeEntries);
  const productState = buildProductState(contract, treeEntries);
  const atlasState = buildAtlasState(contract, treeEntries);
  const atlas = await resolveAtlas({ repository, entrypoint: contract.atlas.entrypoint, atlasState, treeEntries });
  const worktree = await authoritativeWorktreeState(repository, contract);
  assertNoUnboundWorktreeAuthority(worktree);
  await assertRepositoryEpochUnmoved(repository, attached);
  return Object.freeze({ repository, contract, epoch, treeEntries, productState, atlasState, atlas, worktree });
}

function epochBasis(loaded: FoundationLoadedRepositoryEpoch): FoundationRepositorySnapshotBasis {
  return Object.freeze({
    targetId: loaded.contract.targetId,
    commit: loaded.epoch.commit,
    tree: loaded.epoch.tree,
    objectFormat: loaded.epoch.objectFormat,
    contractDigest: loaded.contract.digest,
    productStateDigest: loaded.productState.digest,
    atlasStateDigest: loaded.atlasState.digest,
    atlasResolutionDigest: loaded.atlas.resolution.digest,
    atlasNormalizedModelDigest: loaded.atlas.resolution.normalizedModelDigest,
    atlasResourceBindingsDigest: loaded.atlas.resolution.resourceBindingsDigest,
  });
}

function compiledKnowledgeManifestSubject(knowledge: FoundationKnowledgeSet): Record<string, unknown> {
  return {
    schema: "lifecycle.knowledge-set.v2",
    specificationRevision: FOUNDATION_SPECIFICATION_REVISION,
    profile: "knowledge-set-v2",
    repository: {
      targetId: knowledge.repository.contract.targetId,
      commit: knowledge.repository.commit,
      tree: knowledge.repository.tree,
      objectFormat: knowledge.repository.objectFormat,
      contractDigest: knowledge.repository.contract.digest,
      productStateDigest: knowledge.repository.productStateDigest,
      atlasStateDigest: knowledge.repository.atlasStateDigest,
      atlasResolutionDigest: knowledge.repository.atlasResolutionDigest,
      atlasNormalizedModelDigest: knowledge.repository.atlasNormalizedModelDigest,
      atlasResourceBindingsDigest: knowledge.repository.atlasResourceBindingsDigest,
    },
    disciplineRegistry: knowledge.disciplineRegistry,
    records: knowledge.records.map((record) => ({
      kind: record.frontMatter.kind,
      id: record.frontMatter.id,
      status: record.frontMatter.status,
      revision: record.frontMatter.revision,
      path: record.path,
      sourceDigest: record.sourceDigest,
      semanticDigest: record.semanticDigest,
    })),
    relationships: knowledge.relationships,
    sources: knowledge.sources,
    conflicts: knowledge.conflicts,
    coverage: knowledge.coverage.map((entry) => ({
      path: entry.path,
      descriptionId: entry.descriptionId,
      descriptionRevision: entry.descriptionRevision,
      selectorPath: entry.selectorPath,
      selectorMode: entry.selectorMode,
    })),
    exemptions: knowledge.exemptions,
    bindings: knowledge.bindings.map((entry) => ({
      checkId: entry.checkId,
      bindingId: entry.binding.id,
      bindingDigest: entry.binding.digest,
    })),
    complete: knowledge.validation.complete,
    valid: knowledge.validation.valid,
  };
}

export function compiledKnowledgeManifestDigest(knowledge: FoundationKnowledgeSet): Sha256 {
  return selfDigest(compiledKnowledgeManifestSubject(knowledge));
}

export function compiledKnowledgeManifestMatches(knowledge: FoundationKnowledgeSet): boolean {
  const subject = compiledKnowledgeManifestSubject(knowledge);
  return canonicalJson(knowledge.manifest) === canonicalJson({
    ...subject,
    digest: selfDigest(subject),
  });
}

function validationBindingSubject(validation: FoundationValidationResult): Record<string, unknown> {
  return {
    digest: validation.digest,
    digestSubject: validationDigestSubject(validation),
    stages: validation.stages.map(({ id, complete, valid, diagnosticCount }) => ({
      id,
      complete,
      valid,
      diagnosticCount,
    })),
    implementation: validation.implementation,
  };
}

async function bindRepositorySnapshotWithGuard(
  loaded: FoundationLoadedRepositoryEpoch,
  knowledge: FoundationKnowledgeSet,
  attachedEpochGuard: Awaited<ReturnType<typeof resolveAttachedEpoch>>,
): Promise<FoundationLoadedRepositorySnapshot> {
  assertSha256(knowledge.manifest.digest, "Knowledge Set digest");
  const expected = epochBasis(loaded);
  const validation = knowledge.validation;
  const manifest = knowledge.manifest;
  const invalidKnowledge = validation.schema !== FOUNDATION_VALIDATION_RESULT_SCHEMA ||
    validation.specificationRevision !== FOUNDATION_SPECIFICATION_REVISION ||
    validation.profile !== "knowledge-set-v2" ||
    validation.subject.kind !== "repository-knowledge" ||
    validation.subject.id !== manifest.repository.targetId ||
    validation.subject.revision !== manifest.repository.commit ||
    validation.subject.locator !== null ||
    !validation.complete ||
    !validation.valid ||
    validation.digest !== validationResultDigest(validation) ||
    !compiledKnowledgeManifestMatches(knowledge) ||
    validation.subject.digest !== manifest.digest ||
    validation.publicationDigest !== knowledge.repository.contract.specification.publicationDigest ||
    manifest.schema !== "lifecycle.knowledge-set.v2" ||
    manifest.specificationRevision !== FOUNDATION_SPECIFICATION_REVISION ||
    manifest.profile !== "knowledge-set-v2" ||
    !manifest.complete ||
    !manifest.valid;
  if (invalidKnowledge) {
    throw new FoundationError("lifecycle.repository.knowledge-invalid", "Repository snapshot binding requires one complete valid Knowledge Set result", {
      observedFacts: {
        manifestDigest: manifest.digest,
        manifestOutcome: { complete: manifest.complete, valid: manifest.valid },
        validationDigest: validation.digest,
        validationOutcome: { complete: validation.complete, valid: validation.valid },
        validationProfile: validation.profile,
        validationSubjectDigest: validation.subject.digest,
      },
    });
  }
  if (
    digestCanonical(manifest.repository) !== digestCanonical(expected) ||
    knowledge.repository.path !== loaded.repository ||
    validation.publicationDigest !== loaded.contract.specification.publicationDigest
  ) {
    throw new FoundationError("lifecycle.repository.epoch-mixed", "Knowledge Set basis does not match the exact loaded repository epoch", {
      observedFacts: {
        actual: manifest.repository,
        actualPath: knowledge.repository.path,
        expected,
        expectedPath: loaded.repository,
      },
    });
  }
  const recomputed = consumeFoundationKnowledgeCompilation(loaded, knowledge) ?? await validateKnowledgeSet(loaded);
  if (
    recomputed.knowledgeSet === null ||
    !recomputed.validation.complete ||
    !recomputed.validation.valid ||
    canonicalJson(recomputed.knowledgeSet.manifest) !== canonicalJson(manifest) ||
    canonicalJson(validationBindingSubject(recomputed.validation)) !== canonicalJson(validationBindingSubject(validation))
  ) {
    throw new FoundationError("lifecycle.repository.knowledge-invalid", "Repository snapshot binding requires the exact Knowledge compiler artifact for the loaded epoch", {
      observedFacts: {
        actualManifestDigest: manifest.digest,
        recomputedManifestDigest: recomputed.knowledgeSet?.manifest.digest ?? null,
        recomputedOutcome: {
          complete: recomputed.validation.complete,
          valid: recomputed.validation.valid,
        },
        actualValidationDigest: validation.digest,
        recomputedValidationDigest: recomputed.validation.digest,
        actualValidationStages: validation.stages.map(({ id, complete, valid, diagnosticCount }) => ({ id, complete, valid, diagnosticCount })),
        recomputedValidationStages: recomputed.validation.stages.map(({ id, complete, valid, diagnosticCount }) => ({ id, complete, valid, diagnosticCount })),
        actualValidationLimits: validation.limits,
        recomputedValidationLimits: recomputed.validation.limits,
      },
    });
  }
  const worktree = await authoritativeWorktreeState(loaded.repository, loaded.contract);
  assertNoUnboundWorktreeAuthority(worktree);
  await assertRepositoryEpochUnmoved(loaded.repository, attachedEpochGuard);
  const snapshot = repositorySnapshot({
    contract: loaded.contract,
    commit: loaded.epoch.commit,
    tree: loaded.epoch.tree,
    objectFormat: loaded.epoch.objectFormat,
    productStateDigest: loaded.productState.digest,
    atlasStateDigest: loaded.atlasState.digest,
    atlasResolutionDigest: loaded.atlas.resolution.digest,
    atlasNormalizedModelDigest: loaded.atlas.resolution.normalizedModelDigest,
    atlasResourceBindingsDigest: loaded.atlas.resolution.resourceBindingsDigest,
    knowledgeSetDigest: manifest.digest,
  });
  return Object.freeze({ ...loaded, worktree, snapshot });
}

/** Bind a completed Knowledge Set to the exact current attached epoch from which it was built. */
export async function bindRepositorySnapshot(
  loaded: FoundationLoadedRepositoryEpoch,
  knowledge: FoundationKnowledgeSet,
): Promise<FoundationLoadedRepositorySnapshot> {
  return bindRepositorySnapshotWithGuard(loaded, knowledge, loaded.epoch);
}

/**
 * Bind an immutable historical epoch while independently proving that the
 * currently attached canonical epoch does not move during reproduction.
 */
export async function bindHistoricalRepositorySnapshot(
  loaded: FoundationLoadedRepositoryEpoch,
  knowledge: FoundationKnowledgeSet,
): Promise<FoundationLoadedRepositorySnapshot> {
  const attachedEpochGuard = await resolveAttachedEpoch(loaded.repository);
  return bindRepositorySnapshotWithGuard(loaded, knowledge, attachedEpochGuard);
}
