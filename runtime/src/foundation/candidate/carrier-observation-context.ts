import type { ControlRecordRevision } from "../control/types.js";
import type { ControlRecordStore } from "../control/store.js";
import { FoundationError } from "../error.js";
import {
  openFoundationDeliveryGitBasisV1,
  openFoundationDeliveryGitSnapshotV1,
} from "../repository/delivery-git-basis.js";
import type { FoundationRepositoryContract, FoundationRepositorySnapshot } from "../repository/types.js";
import { canonicalJson } from "../validation/canonical.js";
import {
  parseFoundationIntegrationAssessmentPayloadV1,
  resolveCandidateIntegrationProvenanceV1,
} from "../control/integration-assessment.js";
import type { CandidateRevisionCarrierAdmittedContext } from "./carrier-state-observer.js";

export const FOUNDATION_CANDIDATE_CARRIER_ADMITTED_CONTEXT_INVALID =
  "lifecycle.candidate.carrier-admitted-context-invalid" as const;
export const FOUNDATION_CANDIDATE_CARRIER_ADMITTED_CONTEXT_UNAVAILABLE =
  "lifecycle.candidate.carrier-admitted-context-unavailable" as const;
export const FOUNDATION_CANDIDATE_CARRIER_ADMITTED_CONTEXT_INCOMPLETE =
  "lifecycle.candidate.carrier-admitted-context-incomplete" as const;

export type CandidateRevisionCarrierWorkBoundaryContext = CandidateRevisionCarrierAdmittedContext & Readonly<{
  governing: Readonly<{
    boundary: ControlRecordRevision;
    contract: FoundationRepositoryContract;
    snapshot: FoundationRepositorySnapshot;
  }>;
}>;

function invalid(message: string): never {
  throw new FoundationError("lifecycle.repository.git-basis-invalid", message);
}

/** Governing W and the Candidate's immutable application base have separate jobs. */
export async function deriveCandidateRevisionCarrierAdmittedContext(input: Readonly<{
  machineHome: string;
  repository: string;
  store: ControlRecordStore;
  boundary: ControlRecordRevision;
  candidate?: ControlRecordRevision;
  integrationAssessment?: ControlRecordRevision;
  /** Exact immutable integration Activity input, before assessment publication. */
  integrationParent?: FoundationRepositorySnapshot;
}>): Promise<CandidateRevisionCarrierWorkBoundaryContext> {
  try {
    if ([input.candidate, input.integrationAssessment, input.integrationParent].filter((value) => value !== undefined).length > 1) {
      invalid("Candidate application context requires one exact Candidate, Integration Assessment, or planned integration parent");
    }
    const governing = await openFoundationDeliveryGitBasisV1(input);
    let parent: FoundationRepositorySnapshot | null = input.integrationParent ?? null;
    if (input.integrationAssessment !== undefined) {
      const assessment = input.store.getRevision(input.integrationAssessment.recordId, input.integrationAssessment.revision);
      if (assessment === null || assessment.recordKind !== "integration-assessment" ||
          assessment.processId !== input.store.identity.processId ||
          canonicalJson(assessment) !== canonicalJson(input.integrationAssessment)) {
        invalid("Candidate application context requires the exact retained Integration Assessment");
      }
      const governedBy = assessment.relationships.filter((item) => item.relation === "governed-by");
      const expectedBoundary = { kind: "work-boundary", id: input.boundary.recordId, revision: input.boundary.revision, digest: input.boundary.digest };
      if (governedBy.length !== 1 || canonicalJson(governedBy[0]!.target) !== canonicalJson(expectedBoundary)) {
        invalid("Integration application context must remain governed by its exact Work Boundary");
      }
      const payload = parseFoundationIntegrationAssessmentPayloadV1(assessment.payload);
      if (payload.outcome !== "constructed") invalid("Only a constructed Integration Assessment supplies a Candidate application base");
      parent = payload.canonicalParent;
    } else if (input.candidate !== undefined) {
      const provenance = resolveCandidateIntegrationProvenanceV1({ store: input.store, candidate: input.candidate });
      parent = provenance?.canonicalParent ?? null;
      if (input.candidate.payload.candidateBaseCommit !== (parent?.commit ?? governing.loaded.epoch.commit)) {
        invalid("Candidate application base must reproduce its exact retained lineage");
      }
    }
    const context = parent === null ? governing : await openFoundationDeliveryGitSnapshotV1({
      machineHome: input.machineHome, repository: input.repository,
      identity: input.store.identity, snapshot: parent,
    });
    return Object.freeze({
      repository: context.repository,
      contract: context.loaded.contract,
      epoch: context.loaded.epoch,
      productStateDigest: context.loaded.productState.digest,
      knowledgeSetDigest: context.loaded.snapshot.knowledgeSetDigest,
      atlasState: context.loaded.atlasState,
      atlas: context.loaded.atlas,
      governing: Object.freeze({ boundary: input.boundary, contract: governing.loaded.contract, snapshot: governing.loaded.snapshot }),
    });
  } catch (error) {
    const code = error instanceof FoundationError && error.code === "lifecycle.repository.git-basis-invalid"
      ? FOUNDATION_CANDIDATE_CARRIER_ADMITTED_CONTEXT_INVALID
      : error instanceof FoundationError && error.code === "lifecycle.repository.git-basis-unavailable"
        ? FOUNDATION_CANDIDATE_CARRIER_ADMITTED_CONTEXT_UNAVAILABLE
        : FOUNDATION_CANDIDATE_CARRIER_ADMITTED_CONTEXT_INCOMPLETE;
    throw new FoundationError(code,
      code === FOUNDATION_CANDIDATE_CARRIER_ADMITTED_CONTEXT_INVALID
        ? "Candidate Carrier application context differs from its exact retained basis"
        : code === FOUNDATION_CANDIDATE_CARRIER_ADMITTED_CONTEXT_UNAVAILABLE
          ? "Candidate Carrier application context is authoritatively unavailable"
          : "Candidate Carrier application-context observation did not complete",
      {
        retryable: code === FOUNDATION_CANDIDATE_CARRIER_ADMITTED_CONTEXT_INCOMPLETE,
        observedFacts: code === FOUNDATION_CANDIDATE_CARRIER_ADMITTED_CONTEXT_UNAVAILABLE
          ? { failureClass: "foundation" }
          : error instanceof FoundationError ? error.observedFacts : { failureClass: "runtime" },
      });
  }
}
