import { z } from "zod/v4";
import { FoundationProtocolError } from "../protocol-error.js";
import {
  parseFoundationStrictJson,
  type FoundationStrictJsonLimits,
} from "../strict-json.js";
import {
  FOUNDATION_CONTROL_DOSSIERS,
  FOUNDATION_RUNTIME_FACADE_SCHEMA,
  FoundationControlRecordKindSchema,
  FoundationControlReferenceSchema,
  FoundationOpaqueIdSchema,
  FoundationPublicFactsSchema,
  FoundationSemanticMarkdownSchema,
  FoundationSha256Schema,
  canonicalFoundationJsonLine,
  digestFoundationCanonical,
  type FoundationSha256,
} from "./core.js";
import {
  FoundationNonnegativeSafeIntegerSchema,
  FoundationTargetSchema,
  protocolParse,
} from "./internal.js";

const FoundationRuntimeRequestBaseSchema = z.object({
  schema: z.literal(FOUNDATION_RUNTIME_FACADE_SCHEMA),
  target: FoundationTargetSchema,
});

export const FoundationRuntimeInitializeInputSchema = z.object({
  targetId: FoundationOpaqueIdSchema.optional(),
  founderPrincipal: FoundationOpaqueIdSchema.optional(),
  implementationRoots: z.array(z.string().min(1).max(4_096)).max(4_096).optional(),
  checkBindings: FoundationPublicFactsSchema.optional(),
  stage: z.boolean().optional(),
}).strict();

export const FoundationRuntimeInitializeRequestSchema = FoundationRuntimeRequestBaseSchema.extend({
  operation: z.literal("repository.initialize"),
  input: FoundationRuntimeInitializeInputSchema,
}).strict();

export const FoundationRuntimeValidateRequestSchema = FoundationRuntimeRequestBaseSchema.extend({
  operation: z.literal("repository.validate"),
  input: z.null(),
}).strict();

export const FoundationRuntimeInboxRequestSchema = FoundationRuntimeRequestBaseSchema.extend({
  operation: z.literal("delivery.inbox"),
  input: z.object({
    afterDeliveryId: FoundationOpaqueIdSchema.nullable(),
    limit: z.number().int().min(1).max(100),
  }).strict(),
}).strict();

export const FoundationRuntimeStatusRequestSchema = FoundationRuntimeRequestBaseSchema.extend({
  operation: z.literal("delivery.status"),
  deliveryId: FoundationOpaqueIdSchema,
  input: z.null(),
}).strict();

export const FoundationRuntimePrepareRequestSchema = FoundationRuntimeRequestBaseSchema.extend({
  operation: z.literal("delivery.prepare"),
  input: z.object({ semanticMarkdown: FoundationSemanticMarkdownSchema }).strict(),
}).strict();

const FoundationDeliveryRequestBaseSchema = FoundationRuntimeRequestBaseSchema.extend({
  deliveryId: FoundationOpaqueIdSchema,
});

export const FoundationRuntimeAdmitRequestSchema = FoundationDeliveryRequestBaseSchema.extend({
  operation: z.literal("delivery.admit"),
  input: z.null(),
}).strict();

function semanticDeliveryRequest<
  Operation extends "delivery.continue" | "delivery.evaluate" | "delivery.revise" | "delivery.reaffirm",
>(operation: Operation) {
  return FoundationDeliveryRequestBaseSchema.extend({
    operation: z.literal(operation),
    input: z.object({
      semanticMarkdown: FoundationSemanticMarkdownSchema,
      expectedGeneration: FoundationSha256Schema.optional(),
    }).strict(),
  }).strict();
}

export const FoundationRuntimeContinueRequestSchema = semanticDeliveryRequest("delivery.continue");
export const FoundationRuntimeEvaluateRequestSchema = semanticDeliveryRequest("delivery.evaluate");
export const FoundationRuntimeReviseRequestSchema = semanticDeliveryRequest("delivery.revise");
export const FoundationRuntimeReaffirmRequestSchema = semanticDeliveryRequest("delivery.reaffirm");

export const FoundationRuntimeAcceptRequestSchema = FoundationDeliveryRequestBaseSchema.extend({
  operation: z.literal("delivery.accept"),
  input: z.null(),
}).strict();

export const FoundationRuntimeNoShipRequestSchema = FoundationDeliveryRequestBaseSchema.extend({
  operation: z.literal("delivery.no-ship"),
  input: z.object({
    semanticMarkdown: FoundationSemanticMarkdownSchema,
  }).strict(),
}).strict();

export const FoundationRuntimeRecoverRequestSchema = FoundationDeliveryRequestBaseSchema.extend({
  operation: z.literal("delivery.recover"),
  input: z.null(),
}).strict();

export const FoundationAttemptViewSelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("latest-attempt") }).strict(),
  z.object({
    kind: z.literal("attempt"),
    attemptId: FoundationOpaqueIdSchema,
  }).strict(),
]);

export const FoundationInspectQuerySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("summary") }).strict(),
  z.object({
    kind: z.literal("events"),
    afterSequence: FoundationNonnegativeSafeIntegerSchema.max(100_000),
    limit: z.number().int().min(1).max(500),
  }).strict(),
  z.object({
    kind: z.literal("dossier"),
    dossier: z.enum(FOUNDATION_CONTROL_DOSSIERS),
    afterRecordId: FoundationOpaqueIdSchema.nullable(),
    limit: z.number().int().min(1).max(200),
  }).strict(),
  z.object({
    kind: z.literal("record"),
    reference: FoundationControlReferenceSchema,
  }).strict(),
  z.object({
    kind: z.literal("attempt-view"),
    selection: FoundationAttemptViewSelectionSchema,
  }).strict(),
  z.object({ kind: z.literal("delivery-view") }).strict(),
  z.object({ kind: z.literal("families") }).strict(),
  z.object({
    kind: z.literal("family"),
    recordKind: FoundationControlRecordKindSchema,
    afterRecordId: FoundationOpaqueIdSchema.nullable(),
    limit: z.number().int().min(1).max(200),
  }).strict(),
  z.object({
    kind: z.literal("revisions"),
    recordId: FoundationOpaqueIdSchema,
    afterRevision: FoundationNonnegativeSafeIntegerSchema,
    limit: z.number().int().min(1).max(200),
  }).strict(),
]);

export const FoundationRuntimeInspectRequestSchema = FoundationDeliveryRequestBaseSchema.extend({
  operation: z.literal("delivery.inspect"),
  input: FoundationInspectQuerySchema,
}).strict();

export const FoundationRuntimeDiffRequestSchema = FoundationDeliveryRequestBaseSchema.extend({
  operation: z.literal("delivery.diff"),
  input: z.object({
    subject: z.enum(["candidate", "decision"]),
    maximumBytes: z.number().int().min(1).max(16 * 1024 * 1024),
  }).strict(),
}).strict();

export const FoundationRuntimeWatchRequestSchema = FoundationRuntimeRequestBaseSchema.extend({
  operation: z.literal("delivery.watch"),
  deliveryId: FoundationOpaqueIdSchema.nullable(),
  input: z.object({
    scope: z.enum(["inbox", "delivery"]),
    afterGeneration: FoundationSha256Schema.nullable(),
    timeoutMs: z.number().int().min(0).max(60_000),
  }).strict(),
}).strict();

export const FoundationExportSelectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("delivery") }).strict(),
  z.object({ kind: z.literal("dossier"), dossier: z.enum(FOUNDATION_CONTROL_DOSSIERS) }).strict(),
  z.object({ kind: z.literal("record"), reference: FoundationControlReferenceSchema }).strict(),
]);

export const FoundationRuntimeExportRequestSchema = FoundationDeliveryRequestBaseSchema.extend({
  operation: z.literal("delivery.export"),
  input: z.object({
    format: z.literal("markdown"),
    selection: FoundationExportSelectionSchema,
  }).strict(),
}).strict();

export const FoundationRuntimeOperationRequestSchema = z.discriminatedUnion("operation", [
  FoundationRuntimeInitializeRequestSchema,
  FoundationRuntimeValidateRequestSchema,
  FoundationRuntimeInboxRequestSchema,
  FoundationRuntimeStatusRequestSchema,
  FoundationRuntimePrepareRequestSchema,
  FoundationRuntimeAdmitRequestSchema,
  FoundationRuntimeContinueRequestSchema,
  FoundationRuntimeEvaluateRequestSchema,
  FoundationRuntimeReviseRequestSchema,
  FoundationRuntimeReaffirmRequestSchema,
  FoundationRuntimeAcceptRequestSchema,
  FoundationRuntimeNoShipRequestSchema,
  FoundationRuntimeRecoverRequestSchema,
  FoundationRuntimeInspectRequestSchema,
  FoundationRuntimeDiffRequestSchema,
  FoundationRuntimeWatchRequestSchema,
  FoundationRuntimeExportRequestSchema,
]);

export type FoundationRuntimeInitializeRequest = z.output<typeof FoundationRuntimeInitializeRequestSchema>;
export type FoundationRuntimeValidateRequest = z.output<typeof FoundationRuntimeValidateRequestSchema>;
export type FoundationRuntimeInboxRequest = z.output<typeof FoundationRuntimeInboxRequestSchema>;
export type FoundationRuntimeStatusRequest = z.output<typeof FoundationRuntimeStatusRequestSchema>;
export type FoundationRuntimePrepareRequest = z.output<typeof FoundationRuntimePrepareRequestSchema>;
export type FoundationRuntimeAdmitRequest = z.output<typeof FoundationRuntimeAdmitRequestSchema>;
export type FoundationRuntimeContinueRequest = z.output<typeof FoundationRuntimeContinueRequestSchema>;
export type FoundationRuntimeEvaluateRequest = z.output<typeof FoundationRuntimeEvaluateRequestSchema>;
export type FoundationRuntimeReviseRequest = z.output<typeof FoundationRuntimeReviseRequestSchema>;
export type FoundationRuntimeReaffirmRequest = z.output<typeof FoundationRuntimeReaffirmRequestSchema>;
export type FoundationRuntimeAcceptRequest = z.output<typeof FoundationRuntimeAcceptRequestSchema>;
export type FoundationRuntimeNoShipRequest = z.output<typeof FoundationRuntimeNoShipRequestSchema>;
export type FoundationRuntimeRecoverRequest = z.output<typeof FoundationRuntimeRecoverRequestSchema>;
export type FoundationRuntimeInspectRequest = z.output<typeof FoundationRuntimeInspectRequestSchema>;
export type FoundationRuntimeDiffRequest = z.output<typeof FoundationRuntimeDiffRequestSchema>;
export type FoundationRuntimeWatchRequest = z.output<typeof FoundationRuntimeWatchRequestSchema>;
export type FoundationRuntimeExportRequest = z.output<typeof FoundationRuntimeExportRequestSchema>;
export type FoundationRuntimeOperationRequest = z.output<typeof FoundationRuntimeOperationRequestSchema>;

export type FoundationRuntimeOperationRequestInput =
  FoundationRuntimeOperationRequest extends infer Request
    ? Request extends { schema: typeof FOUNDATION_RUNTIME_FACADE_SCHEMA }
      ? Omit<Request, "schema">
      : never
    : never;

export function parseFoundationRuntimeOperationRequest(value: unknown): FoundationRuntimeOperationRequest {
  const request = protocolParse(
    FoundationRuntimeOperationRequestSchema,
    value,
    "lifecycle.interface.request-invalid",
    "Foundation Runtime request",
  );
  if (
    request.operation === "delivery.watch" &&
    ((request.input.scope === "delivery") !== (request.deliveryId !== null))
  ) {
    throw new FoundationProtocolError(
      "lifecycle.interface.watch-scope",
      "Delivery watch requires one exact Delivery identity; Inbox watch forbids a Delivery identity",
      ["deliveryId"],
    );
  }
  return request;
}

export function createFoundationRuntimeOperationRequest(
  input: FoundationRuntimeOperationRequestInput,
): FoundationRuntimeOperationRequest {
  return parseFoundationRuntimeOperationRequest({ schema: FOUNDATION_RUNTIME_FACADE_SCHEMA, ...input });
}

export function digestFoundationRuntimeOperationRequest(value: unknown): FoundationSha256 {
  return digestFoundationCanonical(parseFoundationRuntimeOperationRequest(value));
}

export function parseFoundationRuntimeOperationRequestJson(
  input: string | Uint8Array,
  limits: FoundationStrictJsonLimits = {},
): FoundationRuntimeOperationRequest {
  return parseFoundationRuntimeOperationRequest(parseFoundationStrictJson(input, {
    ...limits,
    source: limits.source ?? "Foundation Runtime request JSON",
  }));
}

export function serializeFoundationRuntimeOperationRequest(value: unknown): string {
  return canonicalFoundationJsonLine(parseFoundationRuntimeOperationRequest(value));
}

export type FoundationAttemptViewSelection = z.output<typeof FoundationAttemptViewSelectionSchema>;
