export const FOUNDATION_ATLAS_RESOURCE_BINDING_LIMITS = Object.freeze({
  maximumResources: 16_384,
  maximumResourceBytes: 64 * 1024 * 1024,
  maximumAggregateBytes: 256 * 1024 * 1024,
  maximumElapsedMilliseconds: 15_000,
});

export const FOUNDATION_ATLAS_PROCESSOR_INVENTORY_LIMITS = Object.freeze({
  maximumEntries: 1_024,
  maximumDepth: 16,
  maximumFileBytes: 16 * 1024 * 1024,
  maximumAggregateBytes: 64 * 1024 * 1024,
  maximumElapsedMilliseconds: 15_000,
});

export const FOUNDATION_ATLAS_PROCESSOR_OUTPUT_MAXIMUM_BYTES = 64 * 1024 * 1024;
