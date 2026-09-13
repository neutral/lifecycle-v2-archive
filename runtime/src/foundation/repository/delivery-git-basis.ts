import { chmod, lstat, mkdir, mkdtemp, open, realpath, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { TextDecoder } from "node:util";
import {
  FOUNDATION_PROVIDER_PROTOCOL,
  FOUNDATION_REPOSITORY_SCHEMA,
  FOUNDATION_SPECIFICATION_REVISION,
  FOUNDATION_WORK_BOUNDARY_PAYLOAD_SCHEMA,
} from "../constants.js";
import type { ControlJsonObject, ControlJsonValue, ControlRecordRevision, ControlRecordStoreIdentity } from "../control/types.js";
import type { ControlRecordStore } from "../control/store.js";
import { controlIdentifier } from "../control/model.js";
import { FoundationError } from "../error.js";
import { LifecycleError } from "../../errors.js";
import { FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1 } from "../candidate/carrier-types.js";
import { validateKnowledgeSet } from "../knowledge/knowledge-set.js";
import type { FoundationKnowledgeSet } from "../knowledge/types.js";
import { canonicalJson, digestCanonical, selfDigest, type Sha256 } from "../validation/canonical.js";
import type { FoundationValidationResult } from "../validation/result.js";
import { parseStrictJson } from "../validation/strict-json.js";
import { FOUNDATION_REPOSITORY_CONTRACT_PATH, parseRepositoryContract } from "./contract.js";
import { blobBytes, canonicalRepository, git } from "./git.js";
import { assertIndependentGitRepository } from "./independent-git.js";
import { bindRepositorySnapshot, loadRepositoryEpoch } from "./snapshot.js";
import type { FoundationLoadedRepositorySnapshot, FoundationRepositorySnapshot } from "./types.js";

const GIT_OBJECT = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MAXIMUM_CONTRACT_BYTES = 4 * 1024 * 1024;
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const DURABLE_GIT = ["-c", "core.fsync=committed", "-c", "core.fsyncMethod=fsync"] as const;
const INVALID = "lifecycle.repository.git-basis-invalid";
const UNAVAILABLE = "lifecycle.repository.git-basis-unavailable";
const INCOMPLETE = "lifecycle.repository.git-basis-incomplete";

function invalid(message: string, observedFacts: Readonly<Record<string, unknown>> = {}): never {
  throw new FoundationError(INVALID, message, { observedFacts });
}

function unavailable(message: string): never {
  throw new FoundationError(UNAVAILABLE, message);
}

function sanitize(error: unknown): never {
  if (error instanceof FoundationError && [INVALID, UNAVAILABLE, INCOMPLETE].includes(error.code)) throw error;
  throw new FoundationError(INCOMPLETE, "Exact retained Delivery Git basis could not be reproduced", {
    retryable: true,
    observedFacts: { failureClass:
      error instanceof LifecycleError && ["command.interrupted", "runtime.interrupted"].includes(error.code) ? "interrupted"
        : error instanceof FoundationError ? "foundation"
          : error instanceof Error && typeof (error as NodeJS.ErrnoException).code === "string" &&
            /^[A-Z0-9_]+$/u.test((error as NodeJS.ErrnoException).code!) ? "filesystem" : "runtime" },
  });
}

type FoundationDeliveryWorkBoundaryBasisV1 = Readonly<{
  productBaseCommit: string;
  productBaseTree: string;
  productStateDigest: Sha256;
  atlasStateDigest: Sha256;
  atlasResolutionDigest: Sha256;
  atlasNormalizedModelDigest: Sha256;
  atlasResourceBindingsDigest: Sha256;
  repositoryContractDigest: Sha256;
  knowledgeSetDigest: Sha256;
  repositorySnapshotDigest: Sha256;
}>;

function object(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== "object") {
    invalid(`${label} must be one exact object`);
  }
  return value as ControlJsonObject;
}

function string(value: ControlJsonValue | undefined, label: string): string {
  if (typeof value !== "string") invalid(`${label} must be one exact string`);
  return value;
}

function digest(value: ControlJsonValue | undefined, label: string): Sha256 {
  const selected = string(value, label);
  if (!SHA256.test(selected)) invalid(`${label} must be one lowercase SHA-256 digest`);
  return selected as Sha256;
}

async function exactHistoricalContract(
  repository: string,
  commit: string,
): Promise<ReturnType<typeof parseRepositoryContract>> {
  let bytes: Buffer;
  try {
    bytes = await blobBytes(
      repository,
      commit,
      FOUNDATION_REPOSITORY_CONTRACT_PATH,
      MAXIMUM_CONTRACT_BYTES,
    );
  } catch (error) {
    if (
      error instanceof FoundationError &&
      error.code === "lifecycle.repository.blob-bound"
    ) {
      invalid("Historical Repository Contract exceeds its exact byte bound");
    }
    throw error;
  }
  let source: string;
  try {
    source = STRICT_UTF8.decode(bytes);
  } catch {
    invalid("Historical Repository Contract is not exact UTF-8");
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
      invalid("Historical Repository Contract bytes are invalid", {
        failureCode: error.code,
      });
    }
    throw error;
  }
}

function workBoundaryBasis(
  boundary: ControlRecordRevision,
  targetId: string,
): FoundationDeliveryWorkBoundaryBasisV1 {
  if (
    boundary.recordKind !== "work-boundary" ||
    boundary.payload.schema !== FOUNDATION_WORK_BOUNDARY_PAYLOAD_SCHEMA ||
    boundary.payload.profileId !== "lifecycle.work-boundary.foundation-v3" ||
    boundary.payload.targetId !== targetId
  ) {
    invalid("Delivery Git basis reproduction requires the exact admitted Work Boundary", {
      expectedTargetId: targetId,
      observedKind: boundary.recordKind,
      observedSchema: boundary.payload.schema ?? null,
      observedTargetId: boundary.payload.targetId ?? null,
    });
  }
  const basis = object(boundary.payload.basis, "Work Boundary repository basis");
  if (
    basis.specificationRevision !== FOUNDATION_SPECIFICATION_REVISION ||
    basis.repositoryContract !== FOUNDATION_REPOSITORY_SCHEMA ||
    basis.providerAdapter !== FOUNDATION_PROVIDER_PROTOCOL
  ) {
    invalid("Delivery Git basis reproduction refuses a Work Boundary from another exact coordinate");
  }
  const productBaseCommit = string(
    basis.productBaseCommit,
    "Work Boundary product-base commit",
  );
  const productBaseTree = string(
    basis.productBaseTree,
    "Work Boundary product-base tree",
  );
  if (!GIT_OBJECT.test(productBaseCommit) || !GIT_OBJECT.test(productBaseTree)) {
    invalid("Work Boundary product base must contain exact full Git object identities");
  }
  return Object.freeze({
    productBaseCommit,
    productBaseTree,
    productStateDigest: digest(
      basis.productStateDigest,
      "Work Boundary Product State digest",
    ),
    atlasStateDigest: digest(
      basis.atlasStateDigest,
      "Work Boundary Atlas State digest",
    ),
    atlasResolutionDigest: digest(
      basis.atlasResolutionDigest,
      "Work Boundary Atlas Resolution digest",
    ),
    atlasNormalizedModelDigest: digest(
      basis.atlasNormalizedModelDigest,
      "Work Boundary Atlas normalized-model digest",
    ),
    atlasResourceBindingsDigest: digest(
      basis.atlasResourceBindingsDigest,
      "Work Boundary Atlas Resource-bindings digest",
    ),
    repositoryContractDigest: digest(
      basis.repositoryContractDigest,
      "Work Boundary Repository Contract digest",
    ),
    knowledgeSetDigest: digest(
      basis.knowledgeSetDigest,
      "Work Boundary Knowledge Set digest",
    ),
    repositorySnapshotDigest: digest(
      basis.repositorySnapshotDigest,
      "Work Boundary Repository Snapshot digest",
    ),
  });
}

type DeliveryGitIdentity = Pick<ControlRecordStoreIdentity, "targetId" | "storeId" | "processId">;

export type FoundationDeliveryGitCommitInputV1 = Readonly<{
  machineHome: string;
  repository: string;
  identity: DeliveryGitIdentity;
  commit: string;
  tree: string;
  canonicalBranch: string;
}>;

export type FoundationDeliveryGitBasisV1 = Readonly<{
  repository: string;
  loaded: FoundationLoadedRepositorySnapshot;
  knowledge: FoundationKnowledgeSet;
  knowledgeValidation: FoundationValidationResult;
}>;

async function privateDirectory(path: string, create: boolean): Promise<string> {
  if (create) {
    try {
      await mkdir(path, { mode: 0o700 });
      await chmod(path, 0o700);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  const [metadata, physical] = await Promise.all([lstat(path), realpath(path)]);
  const uid = process.geteuid?.() ?? process.getuid?.();
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || physical !== path ||
      (uid !== undefined && metadata.uid !== uid) || (metadata.mode & 0o077) !== 0) {
    invalid("Delivery Git basis custody requires an exact private directory");
  }
  return physical;
}

async function subjectDirectory(machineHome: string, identity: DeliveryGitIdentity): Promise<string> {
  const home = await privateDirectory(resolve(machineHome), false);
  const subject = Object.freeze({
    targetId: controlIdentifier(identity.targetId, "Target identity"),
    storeId: controlIdentifier(identity.storeId, "Store identity"),
    processId: controlIdentifier(identity.processId, "Delivery identity"),
  });
  const support = await privateDirectory(join(home, "delivery-git-bases"), true);
  const version = await privateDirectory(join(support, "v1"), true);
  return await privateDirectory(join(version, digestCanonical(subject).slice("sha256:".length)), true);
}

async function present(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try { await handle.sync(); } finally { await handle.close(); }
}

/** Enumerate only the exact selected reachable history, before importing it. */
async function assertCompleteBoundedHistory(repository: string, commit: string): Promise<void> {
  if ((await git(repository, ["rev-parse", "--is-shallow-repository"])).stdout.trim() !== "false") {
    invalid("Delivery Git basis requires complete reachable history, not a shallow boundary");
  }
  const limits = FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1;
  const inventory = (await git(repository, ["rev-list", "--objects", "--no-object-names", commit], {
    maxStdoutBytes: limits.maximumObjects * 65,
  })).stdout.trim().split("\n");
  if (inventory.length === 0 || inventory.length > limits.maximumObjects ||
      inventory.some((id) => !GIT_OBJECT.test(id) || id.length !== commit.length)) {
    invalid("Delivery Git basis reachable history exceeds its exact object bound");
  }
  const objects = (await git(repository, ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], {
    input: `${inventory.join("\n")}\n`,
    maxStdoutBytes: limits.maximumObjects * 112,
  })).stdout.trim().split("\n");
  let aggregate = 0;
  if (objects.length !== inventory.length) invalid("Delivery Git basis history inventory is incomplete");
  for (let index = 0; index < objects.length; index += 1) {
    const match = /^([a-f0-9]+) (commit|tree|blob) (\d+)$/u.exec(objects[index]!);
    const size = match === null ? NaN : Number(match[3]);
    aggregate += size;
    if (match?.[1] !== inventory[index] || !Number.isSafeInteger(size) || size < 0 ||
        !Number.isSafeInteger(aggregate) || aggregate > limits.maximumAggregateObjectBytes) {
      invalid("Delivery Git basis history lacks complete bounded commit, tree, and blob objects");
    }
  }
}

async function verifyRetainedCommit(repository: string, input: FoundationDeliveryGitCommitInputV1): Promise<void> {
  await privateDirectory(repository, false);
  const pin = `refs/lifecycle/bases/${input.commit}`;
  await assertIndependentGitRepository(repository, [pin]);
  if (await canonicalRepository(repository) !== repository) {
    invalid("Retained Delivery Git basis cannot redirect its working root");
  }
  // These are the local settings produced by an empty-template Git init on
  // supported hosts. No copied source configuration or later remote, include,
  // filter, hook, alternate, or working-root selection participates in a pin.
  const permittedConfiguration = new Set([
    "core.repositoryformatversion", "core.filemode", "core.bare", "core.logallrefupdates",
    "core.ignorecase", "core.precomposeunicode", "extensions.objectformat",
  ]);
  const configuration = (await git(repository, ["config", "--local", "--no-includes", "--name-only", "--list"])).stdout.trim().split("\n");
  if (configuration.some((key) => !permittedConfiguration.has(key.toLowerCase()))) {
    invalid("Retained Delivery Git basis contains configuration outside its fixed construction");
  }
  const [head, tree, branch, refs] = await Promise.all([
    git(repository, ["rev-parse", "--verify", "HEAD"]),
    git(repository, ["rev-parse", "--verify", `${input.commit}^{tree}`]),
    git(repository, ["symbolic-ref", "--quiet", "HEAD"]),
    git(repository, ["for-each-ref", "--format=%(refname) %(objectname)"]),
  ]);
  const expectedRefs = [`${input.canonicalBranch} ${input.commit}`, `${pin} ${input.commit}`].sort();
  if (head.stdout.trim() !== input.commit || tree.stdout.trim() !== input.tree ||
      branch.stdout.trim() !== input.canonicalBranch ||
      canonicalJson(refs.stdout.trim().split("\n").sort()) !== canonicalJson(expectedRefs)) {
    invalid("Retained Delivery Git basis differs from its explicit immutable commit, tree, or refs");
  }
  await assertCompleteBoundedHistory(repository, input.commit);
  await git(repository, ["fsck", "--full", "--no-reflogs", "--no-dangling", input.commit]);
}

/**
 * Pin full history in one independent exact-commit repository for the Store's
 * lifetime, including archive. Its path and HEAD are private support; the
 * caller's explicit subject always owns selection. Existing published support
 * is verified without consulting the current canonical checkout or its refs.
 */
export async function retainFoundationDeliveryGitCommitV1(
  input: FoundationDeliveryGitCommitInputV1,
): Promise<string> {
  try {
    if (!GIT_OBJECT.test(input.commit) || !GIT_OBJECT.test(input.tree) || input.commit.length !== input.tree.length ||
        !input.canonicalBranch.startsWith("refs/heads/")) {
      invalid("Delivery Git basis requires exact full commit/tree identities and an attached local branch");
    }
    const parent = await subjectDirectory(input.machineHome, input.identity);
    const repository = join(parent, input.commit);
    if (await present(repository)) {
      await verifyRetainedCommit(repository, input);
      return repository;
    }
    const source = await canonicalRepository(input.repository);
    await assertIndependentGitRepository(source);
    if ((await git(source, ["cat-file", "-e", `${input.commit}^{commit}`], { allowFailure: true })).exitCode !== 0) {
      unavailable("The selected Delivery Git basis is absent from both retained custody and its acquisition source");
    }
    await assertCompleteBoundedHistory(source, input.commit);
    const staging = await mkdtemp(join(parent, ".staging-"));
    try {
      await chmod(staging, 0o700);
      await git(staging, [
        ...DURABLE_GIT, "init", "--template=", `--object-format=${input.commit.length === 40 ? "sha1" : "sha256"}`,
        "-b", "delivery-basis-staging",
      ]);
      await git(staging, [
        ...DURABLE_GIT, "-c", "protocol.file.allow=always", "fetch", "--no-tags", "--no-write-fetch-head",
        "--no-auto-maintenance", source, input.commit,
      ]);
      await git(staging, ["symbolic-ref", "HEAD", input.canonicalBranch]);
      await git(staging, [...DURABLE_GIT, "reset", "--hard", input.commit]);
      await git(staging, [...DURABLE_GIT, "update-ref", `refs/lifecycle/bases/${input.commit}`, input.commit, "0".repeat(input.commit.length)]);
      await verifyRetainedCommit(staging, input);
      await syncDirectory(join(staging, ".git"));
      await syncDirectory(staging);
      try {
        await rename(staging, repository);
      } catch (error) {
        if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        // Another reader may have published the same immutable subject. Its
        // complete value must reproduce; it is never overwritten or repaired.
      }
      await syncDirectory(parent);
      await verifyRetainedCommit(repository, input);
      return repository;
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  } catch (error) {
    sanitize(error);
  }
}

/** Reproduce one explicit B or P Snapshot; this does not select currentness. */
export async function openFoundationDeliveryGitSnapshotV1(input: Readonly<{
  machineHome: string;
  repository: string;
  identity: DeliveryGitIdentity;
  snapshot: FoundationRepositorySnapshot;
}>): Promise<FoundationDeliveryGitBasisV1> {
  try {
    const { identity, snapshot } = input;
    if (snapshot.targetId !== identity.targetId || selfDigest(snapshot) !== snapshot.digest ||
        !GIT_OBJECT.test(snapshot.commit) || !GIT_OBJECT.test(snapshot.tree)) {
      invalid("Delivery Git basis requires one exact Snapshot for its owning Target");
    }
    const parent = await subjectDirectory(input.machineHome, identity);
    const existing = join(parent, snapshot.commit);
    const contractSource = await present(existing) ? existing : await canonicalRepository(input.repository);
    await assertIndependentGitRepository(contractSource);
    const contract = await exactHistoricalContract(contractSource, snapshot.commit);
    if (contract.targetId !== identity.targetId || contract.digest !== snapshot.contractDigest) {
      invalid("Historical Repository Contract differs from the selected Snapshot");
    }
    const repository = await retainFoundationDeliveryGitCommitV1({
      machineHome: input.machineHome, repository: input.repository, identity,
      commit: snapshot.commit, tree: snapshot.tree, canonicalBranch: contract.canonicalBranch,
    });
    const epoch = await loadRepositoryEpoch(repository);
    const knowledgeResult = await validateKnowledgeSet(epoch);
    const knowledge = knowledgeResult.knowledgeSet;
    if (knowledge === null || !knowledgeResult.validation.complete || !knowledgeResult.validation.valid) {
      invalid("Historical Knowledge is not one complete valid governing context", {
        validationDigest: knowledgeResult.validation.digest,
      });
    }
    const loaded = await bindRepositorySnapshot(epoch, knowledge);
    if (canonicalJson(loaded.snapshot) !== canonicalJson(snapshot)) {
      invalid("Historical repository reproduction differs from the exact selected Snapshot", { expected: snapshot, observed: loaded.snapshot });
    }
    return Object.freeze({ repository, loaded, knowledge, knowledgeValidation: knowledgeResult.validation });
  } catch (error) {
    sanitize(error);
  }
}

/** Reproduce all governing context from the retained Boundary, never cache HEAD. */
export async function openFoundationDeliveryGitBasisV1(input: Readonly<{
  machineHome: string;
  repository: string;
  store: Pick<ControlRecordStore, "identity" | "getRevision">;
  boundary: ControlRecordRevision;
}>): Promise<FoundationDeliveryGitBasisV1> {
  try {
    const retained = input.store.getRevision(input.boundary.recordId, input.boundary.revision);
    if (retained === null) unavailable("The exact retained Work Boundary for Delivery Git basis is unavailable");
    if (canonicalJson(retained) !== canonicalJson(input.boundary)) {
      invalid("Delivery Git basis requires the exact retained Work Boundary revision");
    }
    const identity = input.store.identity;
    if (retained.processId !== identity.processId) {
      invalid("Delivery Git basis requires the Work Boundary from its exact owning Delivery");
    }
    const basis = workBoundaryBasis(retained, identity.targetId);
    return await openFoundationDeliveryGitSnapshotV1({
      machineHome: input.machineHome, repository: input.repository, identity,
      snapshot: Object.freeze({
        targetId: identity.targetId,
        commit: basis.productBaseCommit,
        tree: basis.productBaseTree,
        objectFormat: basis.productBaseCommit.length === 40 ? "sha1" : "sha256",
        contractDigest: basis.repositoryContractDigest,
        productStateDigest: basis.productStateDigest,
        atlasStateDigest: basis.atlasStateDigest,
        atlasResolutionDigest: basis.atlasResolutionDigest,
        atlasNormalizedModelDigest: basis.atlasNormalizedModelDigest,
        atlasResourceBindingsDigest: basis.atlasResourceBindingsDigest,
        knowledgeSetDigest: basis.knowledgeSetDigest,
        digest: basis.repositorySnapshotDigest,
      }),
    });
  } catch (error) {
    sanitize(error);
  }
}
