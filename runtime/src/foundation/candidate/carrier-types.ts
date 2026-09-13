import type { FoundationGitObjectFormat } from "../repository/types.js";
import type { Sha256 } from "../validation/canonical.js";

export const FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_SCHEMA =
  "lifecycle.candidate-revision-carrier-manifest.v1" as const;
export const FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_SCHEMA_ID =
  "urn:lifecycle:schema:candidate-revision-carrier-manifest:v1" as const;
export const FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE =
  "application/vnd.lifecycle.candidate-revision-carrier-manifest+json" as const;
export const FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE =
  "candidate-revision-carrier-manifest" as const;
export const FOUNDATION_BUILDER_REPAIR_OUTPUT_PURPOSE = "builder-repair-output" as const;
export const FOUNDATION_CANDIDATE_REVISION_CARRIER_FORMAT = "git-pack-v2" as const;
export const FOUNDATION_CANDIDATE_REVISION_CARRIER_TREE_MODES = Object.freeze([
  "040000",
  "100644",
  "100755",
] as const);

export type FoundationCandidateRevisionCarrierObjectV1 = Readonly<{
  objectId: string;
  objectType: "blob" | "tree";
  /** Uncompressed Git object payload bytes, excluding the Git object header. */
  byteLength: number;
}>;

export type FoundationCandidateRevisionCarrierArtifactV1 = Readonly<{
  format: typeof FOUNDATION_CANDIDATE_REVISION_CARRIER_FORMAT;
  byteLength: number;
  digest: Sha256;
}>;

export type FoundationCandidateRevisionCarrierManifestV1 = Readonly<{
  schema: typeof FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_SCHEMA;
  objectFormat: FoundationGitObjectFormat;
  rootTree: string;
  allowedTreeModes: typeof FOUNDATION_CANDIDATE_REVISION_CARRIER_TREE_MODES;
  objectInventory: readonly FoundationCandidateRevisionCarrierObjectV1[];
  objectCount: number;
  aggregateObjectBytes: number;
  objectInventoryDigest: Sha256;
  carrierArtifact: FoundationCandidateRevisionCarrierArtifactV1;
  digest: Sha256;
}>;

export type FoundationCandidateRevisionCarrierTreeEntryV1 = Readonly<{
  path: string;
  objectId: string;
  mode: "100644" | "100755";
  byteLength: number;
}>;

export type FoundationCandidateRevisionCarrierLimitsV1 = Readonly<{
  maximumObjects: number;
  maximumTreeEntries: number;
  maximumTreeDepth: number;
  maximumRepositoryPathBytes: number;
  maximumAggregateObjectBytes: number;
  maximumCarrierArtifactBytes: number;
  maximumManifestBytes: number;
  commandTimeoutMs: number;
}>;

export const FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1:
FoundationCandidateRevisionCarrierLimitsV1 = Object.freeze({
  maximumObjects: 1_000_000,
  maximumTreeEntries: 1_000_000,
  maximumTreeDepth: 256,
  maximumRepositoryPathBytes: 4096,
  maximumAggregateObjectBytes: Number.MAX_SAFE_INTEGER,
  maximumCarrierArtifactBytes: Number.MAX_SAFE_INTEGER,
  maximumManifestBytes: 256 * 1024 * 1024,
  commandTimeoutMs: 5 * 60_000,
});

/** Runtime-private preparation. Its physical coordinate must never be serialized. */
export type FoundationPreparedCandidateRevisionCarrierV1 = Readonly<{
  manifest: FoundationCandidateRevisionCarrierManifestV1;
  manifestBytes: Uint8Array;
  stagingRoot: string;
  artifactPath: string;
}>;

/** Stable publication facts. They contain no Carrier Store coordinate. */
export type FoundationPublishedCandidateRevisionCarrierV1 = Readonly<{
  manifest: FoundationCandidateRevisionCarrierManifestV1;
  manifestBytes: Uint8Array;
}>;

/** Runtime-private open handle. It must not cross Control or protocol boundaries. */
export type FoundationOpenedCandidateRevisionCarrierV1 = Readonly<{
  manifest: FoundationCandidateRevisionCarrierManifestV1;
  manifestBytes: Uint8Array;
  artifactPath: string;
}>;
