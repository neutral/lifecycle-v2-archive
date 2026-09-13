import {
  chmod,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import { LifecycleError } from "../../errors.js";
import type {
  FoundationResolvedAtlas,
} from "../atlas/types.js";
import { resolveAtlas } from "../atlas/resolution.js";
import type {
  CandidateChangedSubject,
  CandidateRevisionState,
} from "../control/candidate-revision.js";
import { FoundationError } from "../error.js";
import { loadKnowledgeSet, validateKnowledgeSet } from "../knowledge/knowledge-set.js";
import type { FoundationKnowledgeSet } from "../knowledge/types.js";
import { buildAtlasState } from "../repository/atlas-state.js";
import {
  FOUNDATION_REPOSITORY_CONTRACT_PATH,
  parseRepositoryContract,
} from "../repository/contract.js";
import {
  canonicalRepository,
  exactTreeEntries,
  git,
  gitBytes,
  objectBlobBytes,
  resolveGitObjectFormat,
} from "../repository/git.js";
import {
  buildProductState,
  isDisciplineMaintenancePath,
  pathWithin,
} from "../repository/product-state.js";
import type {
  FoundationAtlasState,
  FoundationGitTreeEntry,
  FoundationLoadedRepositoryEpoch,
  FoundationRepositoryContract,
  FoundationRepositoryEpoch,
} from "../repository/types.js";
import {
  canonicalJson,
  digestCanonical,
  sha256Bytes,
  type Sha256,
} from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import { normalizedPath } from "../validation/value.js";
import { parseStrictJson } from "../validation/strict-json.js";
import { materializeCandidateRevisionCarrier } from "./carrier-materialization.js";
import { parseCandidateRevisionCarrierManifest } from "./carrier-manifest.js";
import {
  candidateRevisionCarrierVerificationParent,
  openCandidateRevisionCarrier,
} from "./carrier-store.js";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
} from "./carrier-types.js";
import { withVerifiedCandidateRevisionCarrierRepository } from "./git-object-closure.js";

const MAXIMUM_CONTRACT_BYTES = 4 * 1024 * 1024;
const MAXIMUM_CHANGED_BLOB_BYTES = 256 * 1024 * 1024;
const MAXIMUM_DIFF_BYTES = 256 * 1024 * 1024;
const MAXIMUM_CHANGED_SUBJECTS = 16_384;
const MAXIMUM_REQUESTED_CONTENT_DIGESTS = 4_096;
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
export const FOUNDATION_CANDIDATE_CARRIER_STATE_INVALID =
  "lifecycle.candidate.carrier-state-invalid" as const;
export const FOUNDATION_CANDIDATE_CARRIER_STATE_UNAVAILABLE =
  "lifecycle.candidate.carrier-state-unavailable" as const;
export const FOUNDATION_CANDIDATE_CARRIER_STATE_OBSERVATION_INCOMPLETE =
  "lifecycle.candidate.carrier-state-observation-incomplete" as const;

const CARRIER_STATE_OBSERVER_PROFILE = Object.freeze({
  schema: "lifecycle.candidate-revision-carrier-state-observer-profile.v1" as const,
  id: "candidate-revision-carrier-state-observer-v1" as const,
  version: "1" as const,
  algorithms: Object.freeze([
    "fresh-private-carrier-materialization",
    "fresh-independent-carrier-closure-reopen",
    "exact-application-base-object-import",
    "base-contract-product-atlas-and-knowledge-reproduction",
    "immutable-candidate-repository-contract-reproduction",
    "immutable-candidate-tree-and-path-observation",
    "product-state-and-knowledge-recompilation",
    "exact-binary-diff-and-changed-subject-observation",
    "complete-candidate-state-digest-reproduction",
  ]),
});

export const FOUNDATION_CANDIDATE_REVISION_CARRIER_STATE_OBSERVER_V1 =
  Object.freeze({
    id: CARRIER_STATE_OBSERVER_PROFILE.id,
    version: CARRIER_STATE_OBSERVER_PROFILE.version,
    implementationDigest: digestCanonical(CARRIER_STATE_OBSERVER_PROFILE),
  });

/**
 * Immutable application-base facts required to interpret one Carrier tree. The
 * observer independently reopens the exact base commit and reproduces every
 * supplied digest before using this context. No field is an expected
 * Candidate-state value. Governing Work Boundary context is retained separately;
 * after integration this physical base is P, and the observed contribution is P→I.
 * The existing `AdmittedContext` name denotes this physical base context, not
 * a replacement for the Work Boundary's separately retained governing basis.
 */
export type CandidateRevisionCarrierAdmittedContext = Readonly<{
  repository: string;
  contract: FoundationRepositoryContract;
  epoch: FoundationRepositoryEpoch;
  productStateDigest: Sha256;
  knowledgeSetDigest: Sha256;
  atlasState: FoundationAtlasState;
  atlas: FoundationResolvedAtlas;
}>;

export type CandidateRevisionCarrierPredecessor = Readonly<{
  candidateDigest: Sha256;
}>;

export type CandidateRevisionCarrierStateObservation = Readonly<{
  /** SHA-256 of the exact canonical manifest bytes reopened for this replay. */
  manifestFileDigest: Sha256;
  /** Complete state derived from the Carrier and its exact application-base context. */
  state: CandidateRevisionState;
  /** Exact path inventory reproduced from the independently verified Carrier closure. */
  treeEntries: readonly FoundationGitTreeEntry[];
  /** Optional immutable material compiled only for final Evidence observation. */
  evidenceMaterial?: CandidateRevisionCarrierEvidenceMaterial;
}>;

export type CandidateRevisionCarrierEvidenceMaterial = Readonly<{
  /** Exact application-base inventory used to reproduce the Candidate difference. */
  baseTreeEntries: readonly FoundationGitTreeEntry[];
  /** Complete valid Knowledge compiled from the independently verified Carrier. */
  knowledge: FoundationKnowledgeSet;
  /** Exact bounded binary difference from the application base to the Carrier tree. */
  diff: Readonly<{ digest: Sha256; bytes: Uint8Array }>;
  /** SHA-256 content facts for the exact requested regular-file paths that exist. */
  contentDigests: readonly Readonly<{ path: string; digest: Sha256 }>[];
}>;

export type CandidateRevisionCarrierStateObservationInput = Readonly<{
  machineHome: string;
  manifestBytes: Uint8Array;
  admitted: CandidateRevisionCarrierAdmittedContext;
  predecessor: CandidateRevisionCarrierPredecessor | null;
  evidence?: Readonly<{ contentDigestPaths: readonly string[] }>;
}>;

export type CandidateRevisionCarrierStateRepositoryOperation<T> = (
  repository: string,
  observation: CandidateRevisionCarrierStateObservation,
) => Promise<T>;

type TreeDelta = Readonly<{
  path: string;
  prior: FoundationGitTreeEntry | null;
  next: FoundationGitTreeEntry | null;
}>;

class CandidateCarrierStateInvalidError extends FoundationError {
  constructor(message: string, observedFacts?: unknown) {
    super(FOUNDATION_CANDIDATE_CARRIER_STATE_INVALID, message, { observedFacts });
  }
}

/** Conclusive Candidate-rule refusal after the exact tree and base were reopened. */
export type FoundationCandidateOutputRejectionV1 = Readonly<{
  schema: "lifecycle.candidate-output-rejection.v1";
  manifestFileDigest: Sha256;
  candidateTree: string;
  applicationBaseCommit: string;
  explanation: string;
  validationResultDigest: Sha256 | null;
  knowledgeDiagnostic: Readonly<{ code: string; locator: string | null }> | null;
  violationDigest: Sha256;
  digest: Sha256;
}>;

const candidateOutputRejections = new WeakMap<object, FoundationCandidateOutputRejectionV1>();

/** A diagnostic with the same code is not an owner-issued observation. */
export function candidateOutputRejectionV1(error: unknown): FoundationCandidateOutputRejectionV1 | null {
  return error !== null && typeof error === "object" ? candidateOutputRejections.get(error) ?? null : null;
}

export function parseCandidateOutputRejectionV1(value: unknown): FoundationCandidateOutputRejectionV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) invalid("Candidate output rejection must be one exact retained value");
  const exact = value as Record<string, unknown>;
  if (canonicalJson(Object.keys(exact).sort()) !== canonicalJson([
    "applicationBaseCommit", "candidateTree", "digest", "explanation", "knowledgeDiagnostic", "manifestFileDigest", "schema", "validationResultDigest", "violationDigest",
  ]) || exact.schema !== "lifecycle.candidate-output-rejection.v1" ||
      !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(String(exact.candidateTree)) ||
      !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(String(exact.applicationBaseCommit))) {
    invalid("Candidate output rejection does not bind exact Carrier and application subjects");
  }
  if (typeof exact.explanation !== "string" || exact.explanation.length === 0 || Buffer.byteLength(exact.explanation, "utf8") > 16_384) {
    invalid("Candidate rejection explanation must be one bounded owner-authored value");
  }
  let knowledgeDiagnostic: FoundationCandidateOutputRejectionV1["knowledgeDiagnostic"] = null;
  if (exact.knowledgeDiagnostic !== null) {
    const diagnostic = exact.knowledgeDiagnostic as Record<string, unknown>;
    if (diagnostic === null || typeof diagnostic !== "object" || Array.isArray(diagnostic) ||
        canonicalJson(Object.keys(diagnostic).sort()) !== canonicalJson(["code", "locator"]) ||
        typeof diagnostic.code !== "string" || diagnostic.code.length === 0 || diagnostic.code.length > 256 ||
        (diagnostic.locator !== null && (typeof diagnostic.locator !== "string" || Buffer.byteLength(diagnostic.locator, "utf8") > 4096))) {
      invalid("Candidate rejection diagnostic must be one bounded Knowledge location");
    }
    if (diagnostic.locator !== null) {
      try { normalizedPath(diagnostic.locator, "Candidate rejection Knowledge location"); }
      catch { invalid("Candidate rejection Knowledge location must remain repository-relative"); }
    }
    knowledgeDiagnostic = Object.freeze({ code: diagnostic.code, locator: diagnostic.locator as string | null });
  }
  const subject = Object.freeze({
    schema: "lifecycle.candidate-output-rejection.v1" as const,
    manifestFileDigest: exactDigest(String(exact.manifestFileDigest), "Rejected Carrier manifest"),
    candidateTree: String(exact.candidateTree), applicationBaseCommit: String(exact.applicationBaseCommit),
    explanation: exact.explanation, knowledgeDiagnostic,
    validationResultDigest: exact.validationResultDigest === null ? null : exactDigest(String(exact.validationResultDigest), "Candidate validation result"),
    violationDigest: exactDigest(String(exact.violationDigest), "Candidate rejection facts"),
  });
  const digest = digestCanonical(subject);
  if (exact.digest !== digest) invalid("Candidate output rejection digest changed");
  return Object.freeze({ ...subject, digest });
}

class CandidateCarrierStateRepositoryOperationError {
  constructor(readonly cause: unknown) {}
}

function invalid(message: string, observedFacts?: unknown): never {
  throw new CandidateCarrierStateInvalidError(message, observedFacts);
}

function privateFailureClass(
  error: unknown,
): "filesystem" | "foundation" | "interrupted" | "runtime" {
  if (error instanceof LifecycleError && [
    "command.interrupted",
    "runtime.interrupted",
  ].includes(error.code)) return "interrupted";
  if (error instanceof FoundationError) return "foundation";
  const code = error instanceof Error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
  return typeof code === "string" && /^[A-Z0-9_]+$/u.test(code)
    ? "filesystem"
    : "runtime";
}

function sanitizePrivateFailure(error: unknown): never {
  if (error instanceof CandidateCarrierStateInvalidError) throw error;
  const selectedClass = privateFailureClass(error);
  const authoritativeAbsence = error instanceof FoundationError && (
    error.code === "lifecycle.candidate.carrier-unavailable" ||
    error.code === FOUNDATION_CANDIDATE_CARRIER_STATE_UNAVAILABLE
  );
  throw new FoundationError(
    authoritativeAbsence
      ? FOUNDATION_CANDIDATE_CARRIER_STATE_UNAVAILABLE
      : FOUNDATION_CANDIDATE_CARRIER_STATE_OBSERVATION_INCOMPLETE,
    selectedClass === "interrupted"
      ? "Candidate Carrier state reproduction was interrupted"
      : authoritativeAbsence
        ? "Candidate Carrier state is authoritatively unavailable"
        : "Candidate Carrier state observation did not complete",
    {
      retryable: !authoritativeAbsence,
      observedFacts: { failureClass: selectedClass },
    },
  );
}

function deterministicCandidateContentFailure(
  error: unknown,
  message: string,
): never {
  if (error instanceof CandidateCarrierStateInvalidError) throw error;
  if (error instanceof FoundationError) {
    invalid(message, { failureCode: error.code });
  }
  throw error;
}

function carrierContentFailure(error: unknown): never {
  if (
    error instanceof FoundationError &&
    (
      error.code === "lifecycle.candidate.carrier-invalid" ||
      error.code === "lifecycle.candidate.materialization-invalid"
    )
  ) {
    invalid("Candidate Carrier bytes do not reproduce one exact state", {
      failureCode: error.code,
    });
  }
  throw error;
}

function exactDigest(value: string, label: string): Sha256 {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) {
    invalid(`${label} is not one lowercase SHA-256 digest`);
  }
  return value as Sha256;
}

function decodeContract(bytes: Buffer): FoundationRepositoryContract {
  let source: string;
  try {
    source = STRICT_UTF8.decode(bytes);
  } catch {
    invalid("Application-base Repository Contract is not exact UTF-8");
  }
  try {
    return parseRepositoryContract(parseStrictJson(source, {
      maximumBytes: MAXIMUM_CONTRACT_BYTES,
      maximumDepth: 16,
      maximumNodes: 16_384,
      maximumObjectProperties: 4_096,
      maximumArrayItems: 4_096,
      source: FOUNDATION_REPOSITORY_CONTRACT_PATH,
    }));
  } catch (error) {
    if (error instanceof FoundationError) {
      invalid("Application-base Repository Contract bytes are invalid", {
        failureCode: error.code,
      });
    }
    throw error;
  }
}

function sameTreeEntry(
  left: FoundationGitTreeEntry | undefined,
  right: FoundationGitTreeEntry | undefined,
): boolean {
  return left?.mode === right?.mode &&
    left?.type === right?.type &&
    left?.objectId === right?.objectId;
}

function treeDeltas(
  base: readonly FoundationGitTreeEntry[],
  candidate: readonly FoundationGitTreeEntry[],
): readonly TreeDelta[] {
  const prior = new Map(base.map((entry) => [entry.path, entry]));
  const next = new Map(candidate.map((entry) => [entry.path, entry]));
  const paths = [...new Set([...prior.keys(), ...next.keys()])]
    .sort(compareCodePoints);
  const deltas = paths
    .filter((path) => !sameTreeEntry(prior.get(path), next.get(path)))
    .map((path) => Object.freeze({
      path,
      prior: prior.get(path) ?? null,
      next: next.get(path) ?? null,
    }));
  if (deltas.length > MAXIMUM_CHANGED_SUBJECTS) {
    invalid("Candidate changed-subject count exceeds its bound");
  }
  return Object.freeze(deltas);
}

function changedKind(delta: TreeDelta): CandidateChangedSubject["change"] {
  if (delta.prior === null) return "added";
  if (delta.next === null) return "deleted";
  if (delta.prior.type !== delta.next.type) return "type-changed";
  if (delta.prior.mode !== delta.next.mode) return "mode-changed";
  return "modified";
}

async function entryDigest(
  repository: string,
  entry: FoundationGitTreeEntry | null,
  cache: Map<string, Sha256>,
): Promise<Sha256 | null> {
  if (entry === null) return null;
  const cacheKey = `${entry.mode}\u0000${entry.type}\u0000${entry.objectId}`;
  const retained = cache.get(cacheKey);
  if (retained !== undefined) return retained;
  const digest = entry.type === "blob"
    ? sha256Bytes(await objectBlobBytes(
        repository,
        entry.objectId,
        MAXIMUM_CHANGED_BLOB_BYTES,
      ))
    : digestCanonical({
        mode: entry.mode,
        objectId: entry.objectId,
        type: entry.type,
      });
  cache.set(cacheKey, digest);
  return digest;
}

async function changedSubjects(
  repository: string,
  deltas: readonly TreeDelta[],
): Promise<readonly CandidateChangedSubject[]> {
  const cache = new Map<string, Sha256>();
  const subjects: CandidateChangedSubject[] = [];
  for (const delta of deltas) {
    subjects.push(Object.freeze({
      path: delta.path,
      change: changedKind(delta),
      beforeDigest: await entryDigest(repository, delta.prior, cache),
      afterDigest: await entryDigest(repository, delta.next, cache),
    }));
  }
  return Object.freeze(subjects);
}

function knowledgeEpoch(input: Readonly<{
  repository: string;
  contract: FoundationRepositoryContract;
  baseCommit: string;
  tree: string;
  objectFormat: "sha1" | "sha256";
  treeEntries: readonly FoundationGitTreeEntry[];
  productState: ReturnType<typeof buildProductState>;
  atlasState: FoundationAtlasState;
  atlas: FoundationResolvedAtlas;
}>): FoundationLoadedRepositoryEpoch {
  return Object.freeze({
    repository: input.repository,
    contract: input.contract,
    epoch: Object.freeze({
      ref: input.contract.canonicalBranch,
      commit: input.baseCommit,
      tree: input.tree,
      objectFormat: input.objectFormat,
    }),
    treeEntries: input.treeEntries,
    productState: input.productState,
    atlasState: input.atlasState,
    atlas: input.atlas,
    worktree: Object.freeze({
      dirty: false,
      modified: Object.freeze([]),
      untracked: Object.freeze([]),
      ignored: Object.freeze([]),
    }),
  });
}

async function exactBaseRepository(
  context: CandidateRevisionCarrierAdmittedContext,
): Promise<string> {
  exactDigest(context.productStateDigest, "Application-base Product State digest");
  exactDigest(context.knowledgeSetDigest, "Application-base Knowledge Set digest");
  if (context.epoch.ref !== context.contract.canonicalBranch) {
    invalid("Application-base repository ref differs from its exact Repository Contract");
  }
  const repository = await canonicalRepository(context.repository);
  const objectFormat = await resolveGitObjectFormat(repository);
  if (objectFormat !== context.epoch.objectFormat) {
    invalid("Application-base Git object format is unavailable from the selected repository");
  }
  const resolvedCommit = (await git(repository, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${context.epoch.commit}^{commit}`,
  ])).stdout.trim();
  const resolvedTree = (await git(repository, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${resolvedCommit}^{tree}`,
  ])).stdout.trim();
  if (
    resolvedCommit !== context.epoch.commit ||
    resolvedTree !== context.epoch.tree
  ) {
    invalid("Application-base commit and tree do not reopen exactly");
  }
  return repository;
}

async function importExactBase(input: Readonly<{
  repository: string;
  source: string;
  epoch: FoundationRepositoryEpoch;
}>): Promise<void> {
  await git(input.repository, [
    "-c",
    "protocol.file.allow=always",
    "fetch",
    "--no-tags",
    "--no-write-fetch-head",
    "--no-auto-maintenance",
    input.source,
    input.epoch.commit,
  ], {
    timeoutMs: FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1.commandTimeoutMs,
    maxStdoutBytes: 1024 * 1024,
  });
  const resolvedCommit = (await git(input.repository, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${input.epoch.commit}^{commit}`,
  ])).stdout.trim();
  const resolvedTree = (await git(input.repository, [
    "rev-parse",
    "--verify",
    "--end-of-options",
    `${resolvedCommit}^{tree}`,
  ])).stdout.trim();
  if (resolvedCommit !== input.epoch.commit || resolvedTree !== input.epoch.tree) {
    invalid("Imported application base does not reproduce its exact commit and tree");
  }
}

async function reproduceAdmittedContext(input: Readonly<{
  repository: string;
  context: CandidateRevisionCarrierAdmittedContext;
}>): Promise<Readonly<{
  contract: FoundationRepositoryContract;
  baseEntries: readonly FoundationGitTreeEntry[];
  atlasState: FoundationAtlasState;
  atlas: FoundationResolvedAtlas;
}>> {
  const baseEntries = await exactTreeEntries(
    input.repository,
    input.context.epoch.tree,
    input.context.epoch.objectFormat,
  );
  const contractEntry = baseEntries.find(
    ({ path }) => path === FOUNDATION_REPOSITORY_CONTRACT_PATH,
  );
  if (
    contractEntry === undefined ||
    contractEntry.type !== "blob" ||
    contractEntry.mode !== "100644"
  ) {
    invalid("Application base lacks one exact Repository Contract blob");
  }
  const contract = decodeContract(await objectBlobBytes(
    input.repository,
    contractEntry.objectId,
    MAXIMUM_CONTRACT_BYTES,
  ));
  if (canonicalJson(contract) !== canonicalJson(input.context.contract)) {
    invalid("Application-base Repository Contract does not reproduce its exact base bytes");
  }
  const productState = buildProductState(contract, baseEntries);
  if (productState.digest !== input.context.productStateDigest) {
    invalid("Application-base Product State does not reproduce from the exact base");
  }
  const atlasState = buildAtlasState(contract, baseEntries);
  if (canonicalJson(atlasState) !== canonicalJson(input.context.atlasState)) {
    invalid("Application-base Atlas State does not reproduce from the exact base");
  }
  const atlas = await resolveAtlas({
    repository: input.repository,
    entrypoint: contract.atlas.entrypoint,
    atlasState,
    treeEntries: baseEntries,
  });
  if (
    canonicalJson(atlas.resolution) !==
      canonicalJson(input.context.atlas.resolution) ||
    canonicalJson(atlas.validationResult) !==
      canonicalJson(input.context.atlas.validationResult) ||
    canonicalJson(atlas.model) !== canonicalJson(input.context.atlas.model)
  ) {
    invalid("Application-base Atlas Resolution does not reproduce from the exact base");
  }
  const knowledge = await loadKnowledgeSet(knowledgeEpoch({
    repository: input.repository,
    contract,
    baseCommit: input.context.epoch.commit,
    tree: input.context.epoch.tree,
    objectFormat: input.context.epoch.objectFormat,
    treeEntries: baseEntries,
    productState,
    atlasState,
    atlas,
  }));
  if (knowledge.manifest.digest !== input.context.knowledgeSetDigest) {
    invalid("Application-base Knowledge Set does not reproduce from the exact base");
  }
  return Object.freeze({ contract, baseEntries, atlasState, atlas });
}

async function reproduceCandidateState(input: Readonly<{
  repository: string;
  context: CandidateRevisionCarrierAdmittedContext;
  contract: FoundationRepositoryContract;
  baseEntries: readonly FoundationGitTreeEntry[];
  atlasState: FoundationAtlasState;
  atlas: FoundationResolvedAtlas;
  candidateTree: string;
  candidateEntries: readonly FoundationGitTreeEntry[];
  predecessor: CandidateRevisionCarrierPredecessor | null;
}>): Promise<Readonly<{
  state: CandidateRevisionState;
  knowledge: FoundationKnowledgeSet;
  diff: Readonly<{ digest: Sha256; bytes: Uint8Array }>;
}>> {
  const admittedContractEntry = input.baseEntries.find(
    ({ path }) => path === FOUNDATION_REPOSITORY_CONTRACT_PATH,
  );
  if (
    admittedContractEntry === undefined ||
    admittedContractEntry.type !== "blob" ||
    admittedContractEntry.mode !== "100644"
  ) {
    invalid("Application base lacks one exact Repository Contract blob");
  }
  const candidateContractEntry = input.candidateEntries.find(
    ({ path }) => path === FOUNDATION_REPOSITORY_CONTRACT_PATH,
  );
  if (candidateContractEntry === undefined) {
    invalid("Candidate Carrier omits or changes the type of the application-base Repository Contract");
  }
  if (candidateContractEntry.type !== admittedContractEntry.type) {
    invalid("Candidate Carrier changes the application-base Repository Contract object type");
  }
  if (candidateContractEntry.mode !== admittedContractEntry.mode) {
    invalid("Candidate Carrier changes the application-base Repository Contract mode");
  }
  const [admittedContractBytes, candidateContractBytes] = await Promise.all([
    objectBlobBytes(
      input.repository,
      admittedContractEntry.objectId,
      MAXIMUM_CONTRACT_BYTES,
    ),
    objectBlobBytes(
      input.repository,
      candidateContractEntry.objectId,
      MAXIMUM_CONTRACT_BYTES,
    ),
  ]);
  if (
    candidateContractEntry.objectId !== admittedContractEntry.objectId ||
    !candidateContractBytes.equals(admittedContractBytes)
  ) {
    invalid("Candidate Carrier changes the application-base Repository Contract bytes");
  }
  const deltas = treeDeltas(input.baseEntries, input.candidateEntries);
  if (deltas.some(({ path }) => pathWithin(path, input.contract.atlas.root))) {
    invalid("Candidate Carrier changes the application base's read-only Atlas State");
  }
  if (deltas.some(({ path }) => isDisciplineMaintenancePath(input.contract, path))) {
    invalid("Candidate Carrier changes the application base's read-only Discipline registry or guidance");
  }
  let candidateAtlasState: FoundationAtlasState;
  try {
    candidateAtlasState = buildAtlasState(input.contract, input.candidateEntries);
  } catch (error) {
    deterministicCandidateContentFailure(error, "Candidate Atlas State is invalid");
  }
  if (canonicalJson(candidateAtlasState) !== canonicalJson(input.atlasState)) {
    invalid("Candidate Carrier does not reproduce the exact application-base Atlas State");
  }
  const subjects = await changedSubjects(input.repository, deltas);
  const pathInventoryDigest = digestCanonical(input.candidateEntries.map((entry) =>
    Object.freeze({
      path: entry.path,
      mode: entry.mode,
      type: entry.type,
      objectId: entry.objectId,
    })));
  let productState: ReturnType<typeof buildProductState>;
  try {
    productState = buildProductState(input.contract, input.candidateEntries);
  } catch (error) {
    deterministicCandidateContentFailure(error, "Candidate Product State is invalid");
  }
  const artifactSetDigest = digestCanonical(productState.entries);
  let knowledge: Awaited<ReturnType<typeof loadKnowledgeSet>>;
  try {
    const observedKnowledge = await validateKnowledgeSet(knowledgeEpoch({
      repository: input.repository,
      contract: input.contract,
      baseCommit: input.context.epoch.commit,
      tree: input.candidateTree,
      objectFormat: input.context.epoch.objectFormat,
      treeEntries: input.candidateEntries,
      productState,
      atlasState: input.atlasState,
      atlas: input.atlas,
    }));
    if (!observedKnowledge.validation.complete) {
      throw new FoundationError(FOUNDATION_CANDIDATE_CARRIER_STATE_OBSERVATION_INCOMPLETE,
        "Candidate Knowledge validation did not complete", {
          observedFacts: { validationResultDigest: observedKnowledge.validation.digest },
        });
    }
    if (observedKnowledge.knowledgeSet === null || !observedKnowledge.validation.valid) {
      const diagnostic = observedKnowledge.validation.diagnostics.find((item) => item.severity === "error");
      invalid("Candidate Knowledge Set is invalid", {
        validationResultDigest: observedKnowledge.validation.digest,
        knowledgeDiagnostic: diagnostic === undefined ? null : { code: diagnostic.code, locator: diagnostic.location.locator },
      });
    }
    knowledge = observedKnowledge.knowledgeSet;
  } catch (error) {
    if (
      error instanceof FoundationError &&
      error.code === "lifecycle.knowledge.invalid"
    ) {
      invalid("Candidate Knowledge Set is invalid", { failureCode: error.code });
    }
    throw error;
  }
  if (
    knowledge.manifest.repository.tree !== input.candidateTree ||
    knowledge.manifest.repository.productStateDigest !== productState.digest
  ) {
    invalid("Candidate Knowledge Set does not bind its exact Carrier tree");
  }
  const descriptionCoverageDigest = digestCanonical(knowledge.manifest.coverage);
  const diff = await gitBytes(input.repository, [
    "diff",
    "--binary",
    "--full-index",
    "--no-color",
    "--no-ext-diff",
    "--no-renames",
    input.context.epoch.commit,
    input.candidateTree,
    "--",
  ], { maxStdoutBytes: MAXIMUM_DIFF_BYTES });
  if (diff.stdoutTruncated) {
    invalid("Candidate binary difference exceeds its exact byte bound");
  }
  const diffDigest = sha256Bytes(diff.stdout);
  const candidateDigest = digestCanonical({
    schema: "lifecycle.delivery-candidate-state.v1",
    candidateBaseCommit: input.context.epoch.commit,
    tree: input.candidateTree,
    productStateDigest: productState.digest,
    knowledgeSetDigest: knowledge.manifest.digest,
    diffDigest,
    pathInventoryDigest,
    artifactSetDigest,
    descriptionCoverageDigest,
    changedSubjects: subjects,
  });
  const state: CandidateRevisionState = Object.freeze({
    tree: input.candidateTree,
    candidateDigest,
    productStateDigest: productState.digest,
    knowledgeSetDigest: knowledge.manifest.digest,
    diffDigest,
    pathInventoryDigest,
    artifactSetDigest,
    descriptionCoverageDigest,
    unchangedFromPredecessor: input.predecessor === null
      ? input.candidateTree === input.context.epoch.tree
      : candidateDigest === exactDigest(
          input.predecessor.candidateDigest,
          "Predecessor Candidate digest",
        ),
    changedSubjects: subjects,
  });
  return Object.freeze({
    state,
    knowledge,
    diff: Object.freeze({
      digest: diffDigest,
      bytes: Uint8Array.from(diff.stdout),
    }),
  });
}

function requestedContentDigestPaths(
  values: readonly string[] | undefined,
): readonly string[] {
  if (values === undefined) return Object.freeze([]);
  if (!Array.isArray(values) || values.length > MAXIMUM_REQUESTED_CONTENT_DIGESTS) {
    invalid("Candidate Carrier content-digest request exceeds its exact bound");
  }
  const selected = values.map((value) => {
    if (
      typeof value !== "string" || value.length < 1 || value.length > 4_096 ||
      value.startsWith("/") || value.includes("\\") || value.includes("\u0000") ||
      value.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
    ) {
      invalid("Candidate Carrier content-digest request contains an invalid repository path");
    }
    return value;
  }).sort(compareCodePoints);
  if (new Set(selected).size !== selected.length) {
    invalid("Candidate Carrier content-digest request repeats a repository path");
  }
  return Object.freeze(selected);
}

/**
 * Reopen one immutable Carrier through two fresh physical views: a verified
 * filesystem materialization and a separately verified Git object repository.
 * The latter imports the exact application-base commit, reproduces that
 * base context, and derives the complete Candidate Revision state. The
 * disposable views are removed before returning and never become continuity.
 */
async function withCandidateRevisionCarrierStateRepositoryPrivate<T>(
  input: CandidateRevisionCarrierStateObservationInput,
  operation: CandidateRevisionCarrierStateRepositoryOperation<T>,
): Promise<T> {
  const manifestBytes = Uint8Array.from(input.manifestBytes);
  const requestedPaths = requestedContentDigestPaths(
    input.evidence?.contentDigestPaths,
  );
  try {
    parseCandidateRevisionCarrierManifest(
      manifestBytes,
      FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
    );
  } catch (error) {
    carrierContentFailure(error);
  }
  const baseRepository = await exactBaseRepository(input.admitted);
  if (input.predecessor !== null) {
    exactDigest(input.predecessor.candidateDigest, "Predecessor Candidate digest");
  }
  const verificationParent = await candidateRevisionCarrierVerificationParent(
    input.machineHome,
  );
  const observationRoot = await mkdtemp(join(
    verificationParent,
    "candidate-state-observer-",
  ));
  try {
    await chmod(observationRoot, 0o700);
    let materialized: Awaited<ReturnType<typeof materializeCandidateRevisionCarrier>>;
    try {
      materialized = await materializeCandidateRevisionCarrier({
        machineHome: input.machineHome,
        manifestBytes,
        destination: join(observationRoot, "materialization"),
      });
    } catch (error) {
      carrierContentFailure(error);
    }
    let opened: Awaited<ReturnType<typeof openCandidateRevisionCarrier>>;
    try {
      opened = await openCandidateRevisionCarrier({
        machineHome: input.machineHome,
        manifestBytes,
      });
    } catch (error) {
      carrierContentFailure(error);
    }
    if (materialized.rootTree !== opened.manifest.rootTree) {
      invalid("Fresh Candidate materialization and reopened Carrier select different trees");
    }
    try {
      return await withVerifiedCandidateRevisionCarrierRepository({
        artifactPath: opened.artifactPath,
        manifest: opened.manifest,
        verificationParent,
        limits: FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
        operation: async (repository, closure) => {
          await importExactBase({
            repository,
            source: baseRepository,
            epoch: input.admitted.epoch,
          });
          const admitted = await reproduceAdmittedContext({
            repository,
            context: input.admitted,
          });
          const candidateEntries = await exactTreeEntries(
            repository,
            closure.rootTree,
            closure.objectFormat,
          );
          const closureEntries = closure.treeEntries.map((entry) => Object.freeze({
            path: entry.path,
            mode: entry.mode,
            type: "blob",
            objectId: entry.objectId,
          }));
          if (canonicalJson(candidateEntries) !== canonicalJson(closureEntries)) {
            invalid("Reopened Carrier tree does not reproduce its verified closure inventory");
          }
          let material: Awaited<ReturnType<typeof reproduceCandidateState>>;
          try {
            material = await reproduceCandidateState({
              repository,
              context: input.admitted,
              contract: admitted.contract,
              baseEntries: admitted.baseEntries,
              atlasState: admitted.atlasState,
              atlas: admitted.atlas,
              candidateTree: closure.rootTree,
              candidateEntries,
              predecessor: input.predecessor,
            });
          } catch (error) {
            if (error instanceof CandidateCarrierStateInvalidError) {
              // Complete Carrier closure and application-base reproduction precede this
              // boundary. Only the Candidate's own conclusive rule failures qualify.
              const subject = Object.freeze({
                schema: "lifecycle.candidate-output-rejection.v1" as const,
                manifestFileDigest: sha256Bytes(opened.manifestBytes),
                candidateTree: closure.rootTree,
                applicationBaseCommit: input.admitted.epoch.commit,
                explanation: error.message,
                validationResultDigest: error.observedFacts !== null && typeof error.observedFacts === "object" &&
                  "validationResultDigest" in error.observedFacts
                  ? (error.observedFacts as { validationResultDigest: Sha256 }).validationResultDigest : null,
                knowledgeDiagnostic: error.observedFacts !== null && typeof error.observedFacts === "object" &&
                  "knowledgeDiagnostic" in error.observedFacts
                  ? (error.observedFacts as { knowledgeDiagnostic: FoundationCandidateOutputRejectionV1["knowledgeDiagnostic"] }).knowledgeDiagnostic : null,
                violationDigest: digestCanonical({ message: error.message, facts: error.observedFacts ?? null }),
              });
              candidateOutputRejections.set(error, parseCandidateOutputRejectionV1({ ...subject, digest: digestCanonical(subject) }));
            }
            throw error;
          }
          const entries = new Map(candidateEntries.map((entry) => [entry.path, entry]));
          const digestCache = new Map<string, Sha256>();
          const contentDigests: Array<Readonly<{ path: string; digest: Sha256 }>> = [];
          for (const path of requestedPaths) {
            const entry = entries.get(path);
            if (entry === undefined || entry.type !== "blob") continue;
            const contentDigest = await entryDigest(repository, entry, digestCache);
            if (contentDigest === null) {
              invalid("Candidate Carrier requested content digest is unexpectedly absent");
            }
            contentDigests.push(Object.freeze({ path, digest: contentDigest }));
          }
          const reproduced = Object.freeze({
            state: material.state,
            treeEntries: Object.freeze(candidateEntries.map((entry) =>
              Object.freeze({ ...entry }))),
            ...(input.evidence === undefined
              ? {}
              : {
                  evidenceMaterial: Object.freeze({
                    baseTreeEntries: Object.freeze(admitted.baseEntries.map((entry) =>
                      Object.freeze({ ...entry }))),
                    knowledge: Object.freeze({
                      ...material.knowledge,
                      repository: Object.freeze({
                        ...material.knowledge.repository,
                        path: input.admitted.repository,
                      }),
                    }),
                    diff: Object.freeze({
                      digest: material.diff.digest,
                      bytes: Uint8Array.from(material.diff.bytes),
                    }),
                    contentDigests: Object.freeze(contentDigests),
                  }),
                }),
          });
          const observation = Object.freeze({
            manifestFileDigest: sha256Bytes(opened.manifestBytes),
            state: reproduced.state,
            treeEntries: reproduced.treeEntries,
            ...(reproduced.evidenceMaterial === undefined
              ? {}
              : { evidenceMaterial: reproduced.evidenceMaterial }),
          });
          try {
            return await operation(repository, observation);
          } catch (error) {
            throw new CandidateCarrierStateRepositoryOperationError(error);
          }
        },
      });
    } catch (error) {
      if (error instanceof CandidateCarrierStateRepositoryOperationError) throw error;
      carrierContentFailure(error);
    }
  } finally {
    await rm(observationRoot, { recursive: true, force: true });
  }
}

/**
 * Reproduce one Candidate state and expose its independently verified Git
 * repository only for the lifetime of one callback. The repository is removed
 * before this function resolves successfully. Callback failures retain their
 * exact identity when cleanup succeeds; cleanup failure prevents the scope
 * from claiming completion.
 */
export async function withCandidateRevisionCarrierStateRepository<T>(
  input: CandidateRevisionCarrierStateObservationInput,
  operation: CandidateRevisionCarrierStateRepositoryOperation<T>,
): Promise<T> {
  try {
    return await withCandidateRevisionCarrierStateRepositoryPrivate(
      input,
      operation,
    );
  } catch (error) {
    if (error instanceof CandidateCarrierStateRepositoryOperationError) {
      throw error.cause;
    }
    sanitizePrivateFailure(error);
  }
}

export async function observeCandidateRevisionCarrierState(
  input: CandidateRevisionCarrierStateObservationInput,
): Promise<CandidateRevisionCarrierStateObservation> {
  return await withCandidateRevisionCarrierStateRepository(
    input,
    async (_repository, observation) => observation,
  );
}
