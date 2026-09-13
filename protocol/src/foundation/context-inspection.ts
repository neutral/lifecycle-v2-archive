import { z } from "zod/v4";
import {
  FoundationAtlasOverviewResultSchema,
  FoundationAtlasOverviewSelectorSchema,
  FoundationAtlasPointResultSchema,
  FoundationAtlasPointSelectorSchema,
  FoundationAtlasResourceResultSchema,
  FoundationAtlasResourceSelectorSchema,
} from "./atlas-inspection.js";
import {
  FoundationAuthorizationReviewResultSchema,
  FoundationAuthorizationReviewSelectorSchema,
} from "./authorization-review.js";
import {
  FoundationCodeFileResultSchema,
  FoundationCodeFileSelectorSchema,
  FoundationCodeIndexResultSchema,
  FoundationCodeIndexSelectorSchema,
} from "./code-inspection.js";
import {
  FoundationSourceResultSchema,
  FoundationSourceSelectorSchema,
} from "./context-core.js";
import {
  FoundationKnowledgeIndexResultSchema,
  FoundationKnowledgeIndexSelectorSchema,
  FoundationKnowledgeRecordResultSchema,
  FoundationKnowledgeRecordSelectorSchema,
} from "./knowledge-inspection.js";

/** Public Foundation context, source, and authorization-review contract. */

export {
  FOUNDATION_ATLAS_RECORD_LIMIT,
  FOUNDATION_ATLAS_RESOURCE_MAXIMUM_BYTES,
  FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_ARRAY_ITEMS,
  FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_BYTES,
  FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_DEPTH,
  FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_NODES,
  FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_OBJECT_PROPERTIES,
  FOUNDATION_ATLAS_RESULT_JSON_MAXIMUM_STRING_CODE_UNITS,
  FOUNDATION_ATLAS_RESULT_JSON_PROFILE,
  selectFoundationAtlasResultJsonLimits,
  FoundationAtlasOverviewResultSchema,
  FoundationAtlasOverviewSelectorSchema,
  FoundationAtlasPointResultSchema,
  FoundationAtlasPointSelectorSchema,
  FoundationAtlasResourceResultSchema,
  FoundationAtlasResourceSelectorSchema,
  type FoundationAtlasOverviewResult,
  type FoundationAtlasPointResult,
  type FoundationAtlasResourceResult,
} from "./atlas-inspection.js";
export {
  FOUNDATION_AUTHORIZATION_REVIEW_CONTROL_BINDING_LIMIT,
  FoundationAuthorizationReviewResultSchema,
  FoundationAuthorizationReviewSelectorSchema,
  type FoundationAuthorizationReviewResult,
  type FoundationAuthorizationReviewSelector,
} from "./authorization-review.js";
export {
  FOUNDATION_CODE_CHANGED_PATH_LIMIT,
  FOUNDATION_CODE_EXACT_DIFF_MAXIMUM_BYTES,
  FOUNDATION_CODE_RETURNED_DIFF_MAXIMUM_BYTES,
  FoundationCodeBasisSchema,
  FoundationCodeFileDifferenceSchema,
  FoundationCodeFileObjectSchema,
  FoundationCodeFileResultSchema,
  FoundationCodeFileRowSchema,
  FoundationCodeFileSelectorSchema,
  FoundationCodeIndexResultSchema,
  FoundationCodeIndexSelectorSchema,
  type FoundationCodeBasis,
  type FoundationCodeFileResult,
  type FoundationCodeFileRow,
  type FoundationCodeFileSelector,
  type FoundationCodeIndexResult,
  type FoundationCodeIndexSelector,
} from "./code-inspection.js";
export {
  FOUNDATION_CONTEXT_INDEX_LIMIT,
  FOUNDATION_REPOSITORY_PATH_MAXIMUM_BYTES,
  FOUNDATION_SOURCE_MAXIMUM_BYTES,
  FOUNDATION_SOURCE_PAGE_MAXIMUM_BYTES,
  digestFoundationInspectionCursor,
  createFoundationContextSelection,
  createFoundationCodeSelection,
  foundationContextSelectionOf,
  FoundationCodeSelectionSchema,
  FoundationInspectionSelectionSchema,
  FoundationContextBasisSchema,
  FoundationContextSelectionSchema,
  FoundationRepositoryRelativePathSchema,
  FoundationSourceReferenceSchema,
  FoundationSourceResultSchema,
  FoundationSourceSelectorSchema,
  FoundationWorkBoundaryReferenceSchema,
  type FoundationContextBasis,
  type FoundationContextSelection,
  type FoundationCodeSelection,
  type FoundationInspectionSelection,
  type FoundationInspectionCursorCollection,
  type FoundationSourceReference,
  type FoundationSourceResult,
} from "./context-core.js";
export {
  FoundationKnowledgeIndexResultSchema,
  FoundationKnowledgeIndexSelectorSchema,
  FoundationKnowledgeRecordResultSchema,
  FoundationKnowledgeRecordSelectorSchema,
  FoundationKnowledgeReferenceSchema,
  type FoundationKnowledgeIndexResult,
  type FoundationKnowledgeRecordResult,
  type FoundationKnowledgeReference,
} from "./knowledge-inspection.js";

export const FoundationContextInspectionSelectorSchema = z.discriminatedUnion("kind", [
  FoundationKnowledgeIndexSelectorSchema,
  FoundationKnowledgeRecordSelectorSchema,
  FoundationCodeIndexSelectorSchema,
  FoundationCodeFileSelectorSchema,
  FoundationAtlasOverviewSelectorSchema,
  FoundationAtlasPointSelectorSchema,
  FoundationAtlasResourceSelectorSchema,
  FoundationSourceSelectorSchema,
  FoundationAuthorizationReviewSelectorSchema,
]);

export const FoundationContextInspectionResultSchema = z.union([
  FoundationKnowledgeIndexResultSchema,
  FoundationKnowledgeRecordResultSchema,
  FoundationCodeIndexResultSchema,
  FoundationCodeFileResultSchema,
  FoundationAtlasOverviewResultSchema,
  FoundationAtlasPointResultSchema,
  FoundationAtlasResourceResultSchema,
  FoundationSourceResultSchema,
  FoundationAuthorizationReviewResultSchema,
]);

export type FoundationContextInspectionSelector = z.output<typeof FoundationContextInspectionSelectorSchema>;
export type FoundationContextInspectionResult = z.output<typeof FoundationContextInspectionResultSchema>;
