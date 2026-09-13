import assert from "node:assert/strict";
import {
  createFoundationContextSelection,
  type FoundationDeliveryGeneration,
} from "@neutral/lifecycle-protocol";
import type { FoundationDeliveryQueryBasis } from "../../src/foundation/read-model/delivery-query-basis.js";

/** Construct a fixture selection from its independently supplied exact owner facts. */
export function contextInspectionSelection(query: FoundationDeliveryQueryBasis, generation: FoundationDeliveryGeneration) {
  assert(generation.journal.headSequence !== null && generation.journal.headDigest !== null);
  return createFoundationContextSelection({
    targetId: query.repository.contract.targetId,
    storeId: generation.storeId, processId: generation.processId,
    origin: { sequence: generation.journal.headSequence, digest: generation.journal.headDigest },
    boundary: { role: query.boundaryRole, reference: {
      kind: "work-boundary", id: query.boundary.recordId,
      revision: query.boundary.revision, digest: query.boundary.digest,
    } },
  });
}
