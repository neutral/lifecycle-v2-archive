import {
  chmod,
  mkdtemp,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { TextDecoder } from "node:util";
import { LifecycleError } from "../../errors.js";
import {
  FOUNDATION_PROVIDER_PROTOCOL,
  FOUNDATION_REPOSITORY_SCHEMA,
  FOUNDATION_SPECIFICATION_REVISION,
  FOUNDATION_WORK_BOUNDARY_PAYLOAD_SCHEMA,
} from "../constants.js";
import type {
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordRevision,
} from "../control/types.js";
import type { ControlRecordStore } from "../control/store.js";
import { FoundationError } from "../error.js";
import { validateKnowledgeSet } from "../knowledge/knowledge-set.js";
import {
  bindRepositorySnapshot,
  loadRepositoryEpoch,
} from "../repository/snapshot.js";
import {
  canonicalRepository,
  blobBytes,
  git,
  resolveGitObjectFormat,
} from "../repository/git.js";
import {
  FOUNDATION_REPOSITORY_CONTRACT_PATH,
  parseRepositoryContract,
} from "../repository/contract.js";
import {
  canonicalJson,
  type Sha256,
} from "../validation/canonical.js";
import { parseStrictJson } from "../validation/strict-json.js";
import type {
  CandidateRevisionCarrierAdmittedContext,
} from "./carrier-state-observer.js";
import {
  candidateRevisionCarrierVerificationParent,
} from "./carrier-store.js";

const GIT_OBJECT = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const MAXIMUM_CONTRACT_BYTES = 4 * 1024 * 1024;
const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
export const FOUNDATION_CANDIDATE_CARRIER_ADMITTED_CONTEXT_INVALID =
  "lifecycle.candidate.carrier-admitted-context-invalid" as const;
export const FOUNDATION_CANDIDATE_CARRIER_ADMITTED_CONTEXT_UNAVAILABLE =
  "lifecycle.candidate.carrier-admitted-context-unavailable" as const;
export const FOUNDATION_CANDIDATE_CARRIER_ADMITTED_CONTEXT_INCOMPLETE =
  "lifecycle.candidate.carrier-admitted-context-incomplete" as const;

type CarrierWorkBoundaryBasis = Readonly<{
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

class CandidateCarrierAdmittedContextInvalidError extends FoundationError {
  constructor(
    message: string,
    observedFacts: Readonly<Record<string, unknown>> = {},
  ) {
    super(FOUNDATION_CANDIDATE_CARRIER_ADMITTED_CONTEXT_INVALID, message, { observedFacts });
  }
}

function invalid(
  message: string,
  observedFacts: Readonly<Record<string, unknown>> = {},
): never {
  throw new CandidateCarrierAdmittedContextInvalidError(message, observedFacts);
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
  if (error instanceof CandidateCarrierAdmittedContextInvalidError) throw error;
  const selectedClass = privateFailureClass(error);
  const authoritativeAbsence = error instanceof FoundationError && (
    error.code === "lifecycle.control.reference-unavailable" ||
    error.code === FOUNDATION_CANDIDATE_CARRIER_ADMITTED_CONTEXT_UNAVAILABLE
  );
  throw new FoundationError(
    authoritativeAbsence
      ? FOUNDATION_CANDIDATE_CARRIER_ADMITTED_CONTEXT_UNAVAILABLE
      : FOUNDATION_CANDIDATE_CARRIER_ADMITTED_CONTEXT_INCOMPLETE,
    selectedClass === "interrupted"
      ? "Candidate Carrier admitted-context reproduction was interrupted"
      : authoritativeAbsence
        ? "Candidate Carrier admitted context is authoritatively unavailable"
        : "Candidate Carrier admitted-context observation did not complete",
    {
      retryable: !authoritativeAbsence,
      observedFacts: { failureClass: selectedClass },
    },
  );
}

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
): CarrierWorkBoundaryBasis {
  if (
    boundary.recordKind !== "work-boundary" ||
    boundary.payload.schema !== FOUNDATION_WORK_BOUNDARY_PAYLOAD_SCHEMA ||
    boundary.payload.profileId !== "lifecycle.work-boundary.foundation-v1" ||
    boundary.payload.targetId !== targetId
  ) {
    invalid("Candidate Carrier replay requires the exact admitted Work Boundary", {
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
    invalid("Candidate Carrier replay refuses a Work Boundary from another exact coordinate");
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

/**
 * Reopen the immutable repository epoch selected by one admitted Work
 * Boundary and derive the complete private context needed to interpret a
 * Candidate Revision Carrier. The repository locator never enters Control;
 * all logical expectations come from the retained Work Boundary, and every
 * supplied digest is independently reproduced before this context is usable.
 */
async function deriveCandidateRevisionCarrierAdmittedContextPrivate(input: Readonly<{
  machineHome: string;
  repository: string;
  store: ControlRecordStore;
  boundary: ControlRecordRevision;
}>): Promise<CandidateRevisionCarrierAdmittedContext> {
  const retainedBoundary = input.store.getRevision(
    input.boundary.recordId,
    input.boundary.revision,
  );
  if (retainedBoundary === null) {
    throw new FoundationError(
      "lifecycle.control.reference-unavailable",
      "Candidate Carrier replay cannot reopen its retained Work Boundary revision",
    );
  }
  if (
    retainedBoundary.digest !== input.boundary.digest ||
    canonicalJson(retainedBoundary) !== canonicalJson(input.boundary)
  ) {
    invalid("Candidate Carrier replay requires the exact retained Work Boundary revision");
  }
  const targetId = input.store.identity.targetId;
  const basis = workBoundaryBasis(retainedBoundary, targetId);
  const source = await canonicalRepository(input.repository);
  const objectFormat = await resolveGitObjectFormat(source);
  const verificationParent = await candidateRevisionCarrierVerificationParent(
    input.machineHome,
  );
  const root = await mkdtemp(join(
    verificationParent,
    "candidate-admitted-context-",
  ));
  try {
    await chmod(root, 0o700);
    await git(root, [
      "init",
      `--object-format=${objectFormat}`,
      "-b",
      "candidate-admitted-context-staging",
    ]);
    await git(root, [
      "-c",
      "protocol.file.allow=always",
      "fetch",
      "--no-tags",
      "--no-write-fetch-head",
      "--no-auto-maintenance",
      source,
      basis.productBaseCommit,
    ]);
    const contract = await exactHistoricalContract(root, basis.productBaseCommit);
    if (
      contract.targetId !== targetId ||
      contract.digest !== basis.repositoryContractDigest ||
      !contract.canonicalBranch.startsWith("refs/heads/") ||
      contract.canonicalBranch.length === "refs/heads/".length
    ) {
      invalid("Historical Repository Contract differs from the admitted target basis");
    }
    await git(root, ["symbolic-ref", "HEAD", contract.canonicalBranch]);
    await git(root, ["reset", "--hard", basis.productBaseCommit]);
    const epoch = await loadRepositoryEpoch(root);
    const observedBasis = Object.freeze({
      productBaseCommit: epoch.epoch.commit,
      productBaseTree: epoch.epoch.tree,
      productStateDigest: epoch.productState.digest,
      atlasStateDigest: epoch.atlasState.digest,
      atlasResolutionDigest: epoch.atlas.resolution.digest,
      atlasNormalizedModelDigest: epoch.atlas.resolution.normalizedModelDigest,
      atlasResourceBindingsDigest: epoch.atlas.resolution.resourceBindingsDigest,
      repositoryContractDigest: epoch.contract.digest,
    });
    const expectedEpochBasis = Object.freeze({
      productBaseCommit: basis.productBaseCommit,
      productBaseTree: basis.productBaseTree,
      productStateDigest: basis.productStateDigest,
      atlasStateDigest: basis.atlasStateDigest,
      atlasResolutionDigest: basis.atlasResolutionDigest,
      atlasNormalizedModelDigest: basis.atlasNormalizedModelDigest,
      atlasResourceBindingsDigest: basis.atlasResourceBindingsDigest,
      repositoryContractDigest: basis.repositoryContractDigest,
    });
    if (
      epoch.contract.targetId !== targetId ||
      canonicalJson(observedBasis) !== canonicalJson(expectedEpochBasis)
    ) {
      invalid(
        "Historical repository reproduction differs from the exact admitted Work Boundary basis",
        { expected: expectedEpochBasis, observed: observedBasis },
      );
    }

    const knowledgeResult = await validateKnowledgeSet(epoch);
    const knowledge = knowledgeResult.knowledgeSet;
    if (
      knowledge === null ||
      !knowledgeResult.validation.complete ||
      !knowledgeResult.validation.valid ||
      knowledge.manifest.digest !== basis.knowledgeSetDigest
    ) {
      invalid(
        "Historical Knowledge reproduction differs from the exact admitted Work Boundary basis",
        {
          expectedKnowledgeSetDigest: basis.knowledgeSetDigest,
          observedKnowledgeSetDigest: knowledge?.manifest.digest ?? null,
          validationDigest: knowledgeResult.validation.digest,
          validationOutcome: Object.freeze({
            complete: knowledgeResult.validation.complete,
            valid: knowledgeResult.validation.valid,
          }),
        },
      );
    }
    const snapshot = await bindRepositorySnapshot(epoch, knowledge);
    if (
      snapshot.snapshot.digest !== basis.repositorySnapshotDigest ||
      snapshot.snapshot.knowledgeSetDigest !== basis.knowledgeSetDigest
    ) {
      invalid(
        "Historical Repository Snapshot differs from the exact admitted Work Boundary basis",
        {
          expectedRepositorySnapshotDigest: basis.repositorySnapshotDigest,
          observedRepositorySnapshotDigest: snapshot.snapshot.digest,
          expectedKnowledgeSetDigest: basis.knowledgeSetDigest,
          observedKnowledgeSetDigest: snapshot.snapshot.knowledgeSetDigest,
        },
      );
    }
    return Object.freeze({
      repository: source,
      contract: snapshot.contract,
      epoch: snapshot.epoch,
      productStateDigest: snapshot.productState.digest,
      knowledgeSetDigest: snapshot.snapshot.knowledgeSetDigest,
      atlasState: snapshot.atlasState,
      atlas: snapshot.atlas,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function deriveCandidateRevisionCarrierAdmittedContext(input: Readonly<{
  machineHome: string;
  repository: string;
  store: ControlRecordStore;
  boundary: ControlRecordRevision;
}>): Promise<CandidateRevisionCarrierAdmittedContext> {
  try {
    return await deriveCandidateRevisionCarrierAdmittedContextPrivate(input);
  } catch (error) {
    sanitizePrivateFailure(error);
  }
}
