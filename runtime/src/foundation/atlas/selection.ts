import type { FoundationAtlasSelection } from "./types.js";

export const FOUNDATION_ATLAS_SELECTION: FoundationAtlasSelection = Object.freeze({
  release: "0.7.0",
  specificationRevision: "429fee62966f4d30e91ec2a15d27ecf353f5d68f",
  authoredFormat: 1,
  processorRevision: "746cbce73c51b28d617b96ca08f18d498ac749c4",
  validationProfile: "neutral.atlas-validator.resolved",
  validationResultSchema: "urn:atlas:schema:validation-result:1",
  normalizedModelSchema: "urn:atlas:schema:normalized:1",
  consumerProfile: "lifecycle.atlas-consumer.v1",
});

export const FOUNDATION_ATLAS_PROCESSOR = Object.freeze({
  id: "atlas-reference-validator" as const,
  version: "0.7.0" as const,
  // Canonical digest of the ordered installed distribution-file inventory.
  implementationDigest: "sha256:94e8a97eda6659327fd6ec34ae2764787326962c0b2bf0eec39a236ca70d0205" as const,
});
