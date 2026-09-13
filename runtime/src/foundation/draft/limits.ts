/** Local observation bounds; these do not change any accepted Knowledge or Attempt profile. */
export const FOUNDATION_LOCAL_DRAFT_LIMITS = Object.freeze({
  maximumKnowledgeFiles: 1024,
  maximumKnowledgeTotalBytes: 64 * 1024 * 1024,
  maximumContractBytes: 4 * 1024 * 1024,
  maximumFileObservationBytes: 256 * 1024 * 1024,
});
export const FOUNDATION_LOCAL_DRAFT_PROFILE = "lifecycle.local-draft-assistance.v1" as const;
