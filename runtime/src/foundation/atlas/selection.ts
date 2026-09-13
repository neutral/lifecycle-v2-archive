import type { FoundationAtlasSelection } from "./types.js";

export const FOUNDATION_ATLAS_SELECTION: FoundationAtlasSelection = Object.freeze({
  release: "0.8.0",
  specificationRevision: "2c7a78540ac30138218b12803f1c045cee8b109a",
  authoredFormat: 1,
  processorRevision: "2c7a78540ac30138218b12803f1c045cee8b109a",
  validationProfile: "neutral.atlas-validator.resolved",
  validationResultSchema: "urn:atlas:schema:validation-result:1",
  normalizedModelSchema: "urn:atlas:schema:normalized:1",
  consumerProfile: "lifecycle.atlas-consumer.v2",
});

export const FOUNDATION_ATLAS_PROCESSOR = Object.freeze({
  id: "atlas-reference-validator" as const,
  version: "0.8.0" as const,
  // Canonical digest of the ordered installed distribution-file inventory.
  implementationDigest: "sha256:7432f9d49b9efdc828fbbc573fa32f395def8e201c628d7741ba56b2acf230be" as const,
});
