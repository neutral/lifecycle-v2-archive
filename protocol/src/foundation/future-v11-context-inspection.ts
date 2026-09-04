import { z } from "zod/v4";
import {
  FoundationFutureV11AtlasOverviewSelectorSchema,
  FoundationFutureV11AtlasPointSelectorSchema,
  FoundationFutureV11AtlasResourceSelectorSchema,
} from "./future-v11-atlas-inspection.js";
import { FoundationFutureV11AuthorizationReviewSelectorSchema } from "./future-v11-authorization-review.js";
import { FoundationFutureV11SourceSelectorSchema } from "./future-v11-context-core.js";
import {
  FoundationFutureV11KnowledgeIndexSelectorSchema,
  FoundationFutureV11KnowledgeRecordSelectorSchema,
} from "./future-v11-knowledge-inspection.js";

/**
 * Private Foundation v11 protocol preparation.
 *
 * This aggregator deliberately does not participate in the current package
 * barrel, runtime request union, result union, or v10 constants.
 */

export {
  FOUNDATION_FUTURE_V11_ATLAS_RECORD_LIMIT,
  FOUNDATION_FUTURE_V11_ATLAS_RESOURCE_MAXIMUM_BYTES,
  FoundationFutureV11AtlasOverviewResultSchema,
  FoundationFutureV11AtlasOverviewSelectorSchema,
  FoundationFutureV11AtlasPointResultSchema,
  FoundationFutureV11AtlasPointSelectorSchema,
  FoundationFutureV11AtlasResourceResultSchema,
  FoundationFutureV11AtlasResourceSelectorSchema,
  type FoundationFutureV11AtlasOverviewResult,
  type FoundationFutureV11AtlasPointResult,
  type FoundationFutureV11AtlasResourceResult,
} from "./future-v11-atlas-inspection.js";
export {
  FoundationFutureV11AuthorizationReviewResultSchema,
  FoundationFutureV11AuthorizationReviewSelectorSchema,
  type FoundationFutureV11AuthorizationReviewResult,
  type FoundationFutureV11AuthorizationReviewSelector,
} from "./future-v11-authorization-review.js";
export {
  FOUNDATION_FUTURE_V11_CONTEXT_INDEX_LIMIT,
  FOUNDATION_FUTURE_V11_REPOSITORY_PATH_MAXIMUM_BYTES,
  FOUNDATION_FUTURE_V11_SOURCE_MAXIMUM_BYTES,
  FOUNDATION_FUTURE_V11_SOURCE_PAGE_MAXIMUM_BYTES,
  FoundationFutureV11ContextBasisSchema,
  FoundationFutureV11ContextSelectionSchema,
  FoundationFutureV11RepositoryRelativePathSchema,
  FoundationFutureV11SourceReferenceSchema,
  FoundationFutureV11SourceResultSchema,
  FoundationFutureV11SourceSelectorSchema,
  FoundationFutureV11WorkBoundaryReferenceSchema,
  type FoundationFutureV11ContextBasis,
  type FoundationFutureV11ContextSelection,
  type FoundationFutureV11SourceReference,
  type FoundationFutureV11SourceResult,
} from "./future-v11-context-core.js";
export {
  FoundationFutureV11KnowledgeIndexResultSchema,
  FoundationFutureV11KnowledgeIndexSelectorSchema,
  FoundationFutureV11KnowledgeRecordResultSchema,
  FoundationFutureV11KnowledgeRecordSelectorSchema,
  FoundationFutureV11KnowledgeReferenceSchema,
  type FoundationFutureV11KnowledgeIndexResult,
  type FoundationFutureV11KnowledgeRecordResult,
  type FoundationFutureV11KnowledgeReference,
} from "./future-v11-knowledge-inspection.js";

export const FoundationFutureV11ContextInspectionSelectorSchema = z.discriminatedUnion("kind", [
  FoundationFutureV11KnowledgeIndexSelectorSchema,
  FoundationFutureV11KnowledgeRecordSelectorSchema,
  FoundationFutureV11AtlasOverviewSelectorSchema,
  FoundationFutureV11AtlasPointSelectorSchema,
  FoundationFutureV11AtlasResourceSelectorSchema,
  FoundationFutureV11SourceSelectorSchema,
  FoundationFutureV11AuthorizationReviewSelectorSchema,
]);

export type FoundationFutureV11ContextInspectionSelector = z.output<typeof FoundationFutureV11ContextInspectionSelectorSchema>;
