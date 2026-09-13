import {
  FoundationAuthorizationReviewResultSchema,
  type FoundationAuthorizationReviewResult,
  type FoundationAuthorizationReviewSelector,
  type FoundationDeliveryGeneration,
} from "@neutral/lifecycle-protocol";
import {
  compileAuthorizationReviewCore,
  type DirectorDecisionRepositoryBasis,
} from "../control/director-decision.js";
import type { ControlRecordStore } from "../control/store.js";
import { FoundationError } from "../error.js";
import type {
  FoundationLoadedRepositorySnapshot,
  FoundationRepositoryContract,
} from "../repository/types.js";
import { digestCanonical } from "../validation/canonical.js";
import { assertFoundationInspectionGeneration } from "./context-basis.js";
import type { FoundationDeliveryQueryBasis } from "./delivery-query-basis.js";

const ADMISSION_SEMANTICS = [
  "# Director Admission Decision",
  "",
  "Authorize the exact selected admission Control subjects on the observed repository basis.",
  "",
].join("\n");

const ACCEPTANCE_SEMANTICS = [
  "# Director Acceptance Decision",
  "",
  "Accept the exact evidenced sealed Candidate selected by this authenticated Decision.",
  "",
].join("\n");

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.context-inspection.authorization-${code}`, message);
}

function historicalBasis(query: FoundationDeliveryQueryBasis): DirectorDecisionRepositoryBasis {
  return Object.freeze({
    repositorySnapshotDigest: query.basis.repositorySnapshotDigest,
    canonicalCommit: query.basis.productBaseCommit,
    canonicalTree: query.basis.productBaseTree,
    productStateDigest: query.basis.productStateDigest,
    atlasStateDigest: query.basis.atlasStateDigest,
    atlasResolutionDigest: query.basis.atlasResolutionDigest,
    atlasNormalizedModelDigest: query.basis.atlasNormalizedModelDigest,
    atlasResourceBindingsDigest: query.basis.atlasResourceBindingsDigest,
    repositoryContractDigest: query.basis.repositoryContractDigest,
    knowledgeSetDigest: query.basis.knowledgeSetDigest,
    checkBindingSetDigest: digestCanonical(query.repository.contract.checkBindings),
  });
}

function currentBasis(snapshot: FoundationLoadedRepositorySnapshot): DirectorDecisionRepositoryBasis {
  return Object.freeze({
    repositorySnapshotDigest: snapshot.snapshot.digest,
    canonicalCommit: snapshot.epoch.commit,
    canonicalTree: snapshot.epoch.tree,
    productStateDigest: snapshot.productState.digest,
    atlasStateDigest: snapshot.atlasState.digest,
    atlasResolutionDigest: snapshot.atlas.resolution.digest,
    atlasNormalizedModelDigest: snapshot.atlas.resolution.normalizedModelDigest,
    atlasResourceBindingsDigest: snapshot.atlas.resolution.resourceBindingsDigest,
    repositoryContractDigest: snapshot.contract.digest,
    knowledgeSetDigest: snapshot.snapshot.knowledgeSetDigest,
    checkBindingSetDigest: digestCanonical(snapshot.contract.checkBindings),
  });
}

/** Compile a deterministic review only; this creates no Activity, signature, or authority. */
export function compileFoundationAuthorizationReviewInspection(input: Readonly<{
  store: ControlRecordStore;
  generation: FoundationDeliveryGeneration;
  selector: FoundationAuthorizationReviewSelector;
  query: FoundationDeliveryQueryBasis | null;
  currentRepository: FoundationLoadedRepositorySnapshot | null;
}>): FoundationAuthorizationReviewResult {
  assertFoundationInspectionGeneration(input.selector.expectedGeneration, input.generation);
  if (input.query === null && input.currentRepository === null) {
    fail("basis-absent", "Authorization Review requires one exact historical or current repository basis");
  }
  const contract: FoundationRepositoryContract = input.query?.repository.contract ??
    input.currentRepository!.contract;
  if (
    input.query !== null && input.currentRepository !== null &&
    input.query.repository.contract.digest !== input.currentRepository.contract.digest
  ) fail("basis-substituted", "Authorization Review repository bases disagree on the exact contract");
  const repository = input.query === null
    ? currentBasis(input.currentRepository!)
    : historicalBasis(input.query);
  const semanticMarkdown = input.selector.operation === "delivery.admit"
    ? ADMISSION_SEMANTICS
    : input.selector.operation === "delivery.accept"
      ? ACCEPTANCE_SEMANTICS
      : input.selector.input?.semanticMarkdown;
  if (semanticMarkdown === undefined) {
    fail("semantic-input", "No-ship Authorization Review requires exact Director semantic Markdown");
  }
  const review = compileAuthorizationReviewCore({
    store: input.store,
    operation: input.selector.operation,
    semanticMarkdown,
    repository,
    contract,
  });
  return FoundationAuthorizationReviewResultSchema.parse(Object.freeze({
    schema: "lifecycle.authorization-review-inspection.v1",
    kind: "authorization-review",
    generation: input.generation,
    review,
  }));
}
