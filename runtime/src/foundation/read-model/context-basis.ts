import {
  FoundationContextBasisSchema,
  type FoundationContextBasis,
  type FoundationContextSelection,
  type FoundationDeliveryGeneration,
} from "@neutral/lifecycle-protocol";
import { FoundationError } from "../error.js";
import { canonicalJson, digestCanonical, selfDigest } from "../validation/canonical.js";
import type { FoundationDeliveryQueryBasis } from "./delivery-query-basis.js";

/** Bind exact retained Context dependencies to their original inspection provenance. */
export function compileFoundationContextBasis(
  query: FoundationDeliveryQueryBasis,
  selection: FoundationContextSelection,
): FoundationContextBasis {
  if (selection.targetId !== query.repository.contract.targetId ||
      selection.boundary.role !== query.boundaryRole || canonicalJson(selection.boundary.reference) !== canonicalJson({
        kind: "work-boundary", id: query.boundary.recordId, revision: query.boundary.revision, digest: query.boundary.digest,
      })) {
    throw new FoundationError("lifecycle.read-model.inspection-selection", "Context basis does not reproduce its selected historical Boundary");
  }
  const subject = Object.freeze({
    schema: "lifecycle.context-basis.v2" as const,
    selection,
    repository: Object.freeze({
      repositorySnapshotDigest: query.basis.repositorySnapshotDigest,
      repositoryContractDigest: query.basis.repositoryContractDigest,
      canonicalCommit: query.basis.productBaseCommit,
      canonicalTree: query.basis.productBaseTree,
      productStateDigest: query.basis.productStateDigest,
      knowledgeSetDigest: query.basis.knowledgeSetDigest,
      atlasStateDigest: query.basis.atlasStateDigest,
      atlasResolutionDigest: query.basis.atlasResolutionDigest,
      atlasNormalizedModelDigest: query.basis.atlasNormalizedModelDigest,
      atlasResourceBindingsDigest: query.basis.atlasResourceBindingsDigest,
      checkBindingSetDigest: digestCanonical(query.repository.contract.checkBindings),
    }),
  });
  return FoundationContextBasisSchema.parse(Object.freeze({
    ...subject,
    digest: selfDigest(subject),
  }));
}

/** Refuse a stale selector before compiling or reopening any selected material. */
export function assertFoundationInspectionGeneration(
  expectedGeneration: string,
  generation: FoundationDeliveryGeneration,
): void {
  if (expectedGeneration !== generation.digest) {
    throw new FoundationError(
      "lifecycle.read-model.generation-stale",
      "Context inspection requires the exact current Delivery generation",
      {
        observedFacts: Object.freeze({
          expectedGeneration,
          actualGeneration: generation.digest,
        }),
        retryable: true,
      },
    );
  }
}
