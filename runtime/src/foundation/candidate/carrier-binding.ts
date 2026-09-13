import {
  prepareCandidateRevisionCarrier,
  publishCandidateRevisionCarrier,
} from "./carrier-store.js";
import type {
  CandidateRevisionCarrierVerifier,
} from "../control/candidate-revision.js";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_STATE_OBSERVER_V1,
  observeCandidateRevisionCarrierState,
  type CandidateRevisionCarrierAdmittedContext,
  type CandidateRevisionCarrierPredecessor,
} from "./carrier-state-observer.js";
import type { ControlRecordRevision } from "../control/types.js";
import type { ControlRecordStore } from "../control/store.js";
import type { FoundationRepositorySnapshot } from "../repository/types.js";
import {
  deriveCandidateRevisionCarrierAdmittedContext,
} from "./carrier-observation-context.js";

/**
 * Publish the Git object closure for one already validated tree. Publication
 * alone grants no Candidate or Delivery standing; the owning Control
 * transition must still independently reopen and select these exact bytes.
 */
export async function publishCandidateRevisionCarrierFromGitTree(input: Readonly<{
  machineHome: string;
  repository: string;
  rootTree: string;
}>): Promise<Readonly<{ manifestBytes: Uint8Array }>> {
  const prepared = await prepareCandidateRevisionCarrier(input);
  const published = await publishCandidateRevisionCarrier({
    machineHome: input.machineHome,
    prepared,
  });
  return Object.freeze({
    manifestBytes: Uint8Array.from(published.manifestBytes),
  });
}

/**
 * Create the private physical verifier injected into Candidate Control. The
 * exact application-base context remains in the closure; only stable manifest and
 * reproduced-state facts plus their observer identity cross the locator-free
 * Control seam.
 */
export function candidateRevisionCarrierVerifier(
  input: Readonly<{
    machineHome: string;
    admitted: CandidateRevisionCarrierAdmittedContext;
    predecessor: CandidateRevisionCarrierPredecessor | null;
  }>,
): CandidateRevisionCarrierVerifier {
  return async ({ manifestBytes }) => {
    const observation = await observeCandidateRevisionCarrierState({
      machineHome: input.machineHome,
      manifestBytes,
      admitted: input.admitted,
      predecessor: input.predecessor,
    });
    return Object.freeze({
      manifestFileDigest: observation.manifestFileDigest,
      state: observation.state,
      observer: Object.freeze({
        implementationId: FOUNDATION_CANDIDATE_REVISION_CARRIER_STATE_OBSERVER_V1.id,
        implementationDigest:
          FOUNDATION_CANDIDATE_REVISION_CARRIER_STATE_OBSERVER_V1.implementationDigest,
      }),
    });
  };
}

/**
 * Construct the production verifier from governing W and exact Candidate or
 * Integration Assessment application provenance. This private adapter derives that context before
 * closing it over the locator-free Candidate Control verifier seam.
 */
export async function candidateRevisionCarrierVerifierFromWorkBoundary(
  input: Readonly<{
    machineHome: string;
    repository: string;
    store: ControlRecordStore;
    boundary: ControlRecordRevision;
    candidate?: ControlRecordRevision;
    integrationAssessment?: ControlRecordRevision;
    integrationParent?: FoundationRepositorySnapshot;
    predecessor: CandidateRevisionCarrierPredecessor | null;
  }>,
): Promise<CandidateRevisionCarrierVerifier> {
  const admitted = await deriveCandidateRevisionCarrierAdmittedContext({
    machineHome: input.machineHome,
    repository: input.repository,
    store: input.store,
    boundary: input.boundary,
    ...(input.candidate === undefined ? {} : { candidate: input.candidate }),
    ...(input.integrationAssessment === undefined ? {} : { integrationAssessment: input.integrationAssessment }),
    ...(input.integrationParent === undefined ? {} : { integrationParent: input.integrationParent }),
  });
  return candidateRevisionCarrierVerifier({
    machineHome: input.machineHome,
    admitted,
    predecessor: input.predecessor,
  });
}
