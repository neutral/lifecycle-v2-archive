import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { z } from "zod/v4";
import { FoundationProtocolError } from "../protocol-error.js";
import {
  parseFoundationStrictJson,
  type FoundationStrictJsonLimits,
} from "../strict-json.js";
import {
  FOUNDATION_CONTROL_DOSSIERS,
  FOUNDATION_CONTROL_RECORD_KINDS,
  FOUNDATION_INTERFACE_PROTOCOL,
  FOUNDATION_RUNTIME_PROTOCOL,
  FOUNDATION_RUNTIME_RESULT_SCHEMA,
  FoundationChangeFactsSchema,
  FoundationControlEventSchema,
  FoundationControlFamilySummarySchema,
  FoundationControlRecordKindSchema,
  FoundationControlReferenceSchema,
  FoundationControlRevisionSchema,
  FoundationDeliveryDiffSchema,
  FoundationDeliveryGenerationSchema,
  FoundationDeliveryInboxSchema,
  FoundationDeliveryStateSchema,
  FoundationDeliveryViewSchema,
  FoundationDiagnosticSchema,
  FoundationOpaqueIdSchema,
  FoundationRfc3339Schema,
  FoundationRuntimeObservationSchema,
  FoundationRuntimeOperationKindSchema,
  FoundationSha256Schema,
  canonicalFoundationJson,
  canonicalFoundationJsonLine,
  selfDigestFoundationCarrier,
  type FoundationChangeFacts,
  type FoundationControlEvent,
  type FoundationControlReference,
  type FoundationDiagnostic,
  type FoundationRuntimeObservation,
} from "./core.js";
import {
  digestFoundationRuntimeOperationRequest,
  parseFoundationRuntimeOperationRequest,
  type FoundationRuntimeOperationRequest,
} from "./requests.js";
import { FoundationAttemptViewSchema } from "./attempt-view.js";
import {
  FoundationNonnegativeSafeIntegerSchema,
  FoundationPositiveSafeIntegerSchema,
  protocolParse,
  type FoundationDeepReadonly,
} from "./internal.js";

export const FoundationInspectionResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("summary"), state: FoundationDeliveryStateSchema }).strict(),
  z.object({
    kind: z.literal("events"),
    events: z.array(FoundationControlEventSchema).max(500),
    nextAfterSequence: FoundationNonnegativeSafeIntegerSchema.max(100_000).nullable(),
  }).strict(),
  z.object({
    kind: z.literal("dossier"),
    dossier: z.enum(FOUNDATION_CONTROL_DOSSIERS),
    records: z.array(FoundationControlRevisionSchema).max(200),
    nextAfterRecordId: FoundationOpaqueIdSchema.nullable(),
  }).strict(),
  z.object({ kind: z.literal("record"), record: FoundationControlRevisionSchema }).strict(),
  z.object({
    kind: z.literal("attempt-view"),
    view: FoundationAttemptViewSchema.nullable(),
  }).strict(),
  z.object({
    kind: z.literal("delivery-view"),
    view: FoundationDeliveryViewSchema,
  }).strict(),
  z.object({
    kind: z.literal("families"),
    generation: FoundationDeliveryGenerationSchema,
    families: z.array(FoundationControlFamilySummarySchema).max(FOUNDATION_CONTROL_RECORD_KINDS.length),
  }).strict(),
  z.object({
    kind: z.literal("family"),
    generation: FoundationDeliveryGenerationSchema,
    recordKind: FoundationControlRecordKindSchema,
    records: z.array(FoundationControlRevisionSchema).max(200),
    nextAfterRecordId: FoundationOpaqueIdSchema.nullable(),
  }).strict(),
  z.object({
    kind: z.literal("revisions"),
    generation: FoundationDeliveryGenerationSchema,
    recordId: FoundationOpaqueIdSchema,
    records: z.array(FoundationControlRevisionSchema).max(200),
    nextAfterRevision: FoundationPositiveSafeIntegerSchema.nullable(),
  }).strict(),
]);

export const FoundationInboxResultSchema = z.object({
  kind: z.literal("inbox"),
  view: FoundationDeliveryInboxSchema,
}).strict();

export const FoundationDiffResultSchema = z.object({
  kind: z.literal("diff"),
  view: FoundationDeliveryDiffSchema,
}).strict();

export const FoundationWatchResultSchema = z.object({
  kind: z.literal("watch"),
  scope: z.enum(["inbox", "delivery"]),
  changed: z.boolean(),
  generation: FoundationSha256Schema,
  inbox: FoundationDeliveryInboxSchema.nullable(),
  delivery: FoundationDeliveryViewSchema.nullable(),
}).strict().superRefine((value, context) => {
  if ((value.scope === "inbox") !== (value.inbox !== null) ||
      (value.scope === "delivery") !== (value.delivery !== null)) {
    context.addIssue({ code: "custom", path: ["scope"], message: "Watch scope must select one complete snapshot" });
  }
});

export const FoundationExportResultSchema = z.object({
  format: z.literal("markdown"),
  mediaType: z.literal("text/markdown"),
  byteLength: FoundationNonnegativeSafeIntegerSchema.max(268_435_456),
  digest: FoundationSha256Schema,
  content: z.string().max(268_435_456).refine((value) => !value.includes("\u0000")),
}).strict().superRefine((value, context) => {
  const bytes = new TextEncoder().encode(value.content);
  if (bytes.byteLength !== value.byteLength) {
    context.addIssue({ code: "custom", path: ["byteLength"], message: "Export byte length mismatch" });
  }
  const digest = `sha256:${bytesToHex(sha256(bytes))}`;
  if (value.digest !== digest) {
    context.addIssue({ code: "custom", path: ["digest"], message: "Export content digest mismatch" });
  }
});

export const FoundationRuntimeResultValueSchema = z.union([
  z.null(),
  FoundationInspectionResultSchema,
  FoundationExportResultSchema,
  FoundationInboxResultSchema,
  FoundationDiffResultSchema,
  FoundationWatchResultSchema,
]);

export const FoundationRuntimeOperationResultSchema = z.object({
  schema: z.literal(FOUNDATION_RUNTIME_RESULT_SCHEMA),
  interfaceProtocol: z.literal(FOUNDATION_INTERFACE_PROTOCOL),
  runtimeProtocol: z.literal(FOUNDATION_RUNTIME_PROTOCOL),
  requestDigest: FoundationSha256Schema,
  observedAt: FoundationRfc3339Schema,
  operation: FoundationRuntimeOperationKindSchema,
  status: z.enum(["completed", "refused", "recovery-required"]),
  targetId: FoundationOpaqueIdSchema.nullable(),
  deliveryId: FoundationOpaqueIdSchema.nullable(),
  observation: FoundationRuntimeObservationSchema,
  changes: FoundationChangeFactsSchema,
  events: z.array(FoundationControlEventSchema).max(256),
  control: z.array(FoundationControlReferenceSchema).max(256),
  diagnostics: z.array(FoundationDiagnosticSchema).max(1_024),
  value: FoundationRuntimeResultValueSchema,
  digest: FoundationSha256Schema,
}).strict().superRefine((value, context) => {
  const sameCoordinate = (left: unknown, right: unknown) =>
    canonicalFoundationJson(left) === canonicalFoundationJson(right);
  const requireSameCoordinate = (
    left: unknown,
    right: unknown,
    path: readonly (string | number)[],
    message: string,
  ) => {
    if (!sameCoordinate(left, right)) {
      context.addIssue({ code: "custom", path: [...path], message });
    }
  };
  const selectedKind = value.value !== null && "kind" in value.value ? value.value.kind : null;
  const inspectionKinds = new Set([
    "summary", "events", "dossier", "record", "attempt-view", "delivery-view",
    "families", "family", "revisions",
  ]);
  const repositoryCoordinate = {
    headCommit: value.observation.repository.headCommit,
    headTree: value.observation.repository.headTree,
    repositoryContractDigest: value.observation.repository.repositoryContractDigest,
  };
  const bindGeneration = (
    generation: z.output<typeof FoundationDeliveryGenerationSchema>,
    path: readonly (string | number)[],
  ) => {
    const delivery = value.observation.delivery;
    if (delivery === null) {
      context.addIssue({
        code: "custom",
        path: [...path],
        message: "A Delivery generation requires the directly observed Delivery reduction",
      });
    } else {
      requireSameCoordinate(
        {
          storeId: generation.storeId,
          processId: generation.processId,
          journal: generation.journal,
          storeDisposition: generation.storeDisposition,
        },
        {
          storeId: delivery.storeId,
          processId: delivery.processId,
          journal: delivery.journal,
          storeDisposition: delivery.storeDisposition,
        },
        path,
        "Delivery generation must bind the directly observed Delivery coordinate",
      );
    }
    requireSameCoordinate(
      generation.repository,
      repositoryCoordinate,
      [...path, "repository"],
      "Delivery generation must bind the directly observed repository coordinate",
    );
  };
  const bindDeliveryView = (
    view: z.output<typeof FoundationDeliveryViewSchema>,
    path: readonly (string | number)[],
  ) => {
    requireSameCoordinate(
      view.state,
      value.observation.delivery,
      [...path, "state"],
      "Selected Delivery View and direct observation must bind one Delivery reduction",
    );
    bindGeneration(view.generation, [...path, "generation"]);
  };
  const bindRecordProcesses = (
    records: readonly z.output<typeof FoundationControlRevisionSchema>[],
    path: readonly (string | number)[],
  ) => {
    for (const [index, record] of records.entries()) {
      requireSameCoordinate(
        record.processId,
        value.deliveryId,
        [...path, index, "processId"],
        "Inspected Control revision must bind the selected Delivery",
      );
    }
  };
  const bindInbox = (
    inbox: z.output<typeof FoundationDeliveryInboxSchema>,
    path: readonly (string | number)[],
  ) => {
    requireSameCoordinate(
      inbox.targetId,
      value.targetId,
      [...path, "targetId"],
      "Delivery Inbox must bind the selected Target",
    );
    for (const [index, row] of inbox.rows.entries()) {
      if (row.status !== "available") continue;
      requireSameCoordinate(
        row.generation.processId,
        row.deliveryId,
        [...path, "rows", index, "generation", "processId"],
        "Delivery Inbox row generation must bind its Delivery identity",
      );
      requireSameCoordinate(
        row.generation.repository,
        repositoryCoordinate,
        [...path, "rows", index, "generation", "repository"],
        "Delivery Inbox row generation must bind the Inbox repository coordinate",
      );
    }
  };
  requireSameCoordinate(
    value.observation.observedAt,
    value.observedAt,
    ["observation", "observedAt"],
    "Runtime result and direct observation must bind one observation time",
  );
  // Identity-only failure observations can be null while the selected outer
  // identity remains known. Any identity that was directly observed must bind
  // that outer selection exactly.
  if (value.observation.repository.targetId !== null) {
    requireSameCoordinate(
      value.observation.repository.targetId,
      value.targetId,
      ["observation", "repository", "targetId"],
      "Runtime result and direct observation must bind one Target identity",
    );
  }
  if (value.observation.delivery !== null) {
    requireSameCoordinate(
      value.observation.delivery.processId,
      value.deliveryId,
      ["observation", "delivery", "processId"],
      "Runtime result and direct observation must bind one Delivery identity",
    );
  }
  if (value.operation === "delivery.inspect") {
    if (value.status === "completed" && (selectedKind === null || !inspectionKinds.has(selectedKind))) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Completed inspection requires an inspection value",
      });
    } else if (selectedKind !== null && !inspectionKinds.has(selectedKind)) {
      context.addIssue({ code: "custom", path: ["value"], message: "Inspection cannot return an export value" });
    }
    // These are coordinate joins only. The nested schemas own their internal
    // semantics; the result envelope binds a completed selection to the direct
    // observation it accompanies.
    if (value.status === "completed" && value.value !== null && "kind" in value.value) {
      switch (value.value.kind) {
        case "summary":
          requireSameCoordinate(
            value.value.state,
            value.observation.delivery,
            ["value", "state"],
            "Delivery summary and direct observation must bind one reduction",
          );
          break;
        case "events":
          for (const [index, event] of value.value.events.entries()) {
            requireSameCoordinate(
              { storeId: event.storeId, processId: event.processId },
              {
                storeId: value.observation.delivery?.storeId ?? null,
                processId: value.deliveryId,
              },
              ["value", "events", index],
              "Inspected Control event must bind the selected Delivery Store",
            );
          }
          break;
        case "dossier":
          bindRecordProcesses(value.value.records, ["value", "records"]);
          break;
        case "record":
          requireSameCoordinate(
            value.value.record.processId,
            value.deliveryId,
            ["value", "record", "processId"],
            "Inspected Control revision must bind the selected Delivery",
          );
          break;
        case "attempt-view":
          if (value.value.view !== null) {
            const attemptView = value.value.view;
            const coordinate = attemptView.coordinate;
            const delivery = value.observation.delivery;
            const unresolvedActivity = delivery?.activities.find(({ stage }) => stage !== "completed") ?? null;
            const activityRecovery = delivery?.recovery?.scope === "activity"
              ? {
                  kind: delivery.recovery.kind,
                  resumesAt: delivery.recovery.resumesAt,
                  exactEffectDigest: delivery.recovery.exactEffectDigest,
                }
              : null;
            requireSameCoordinate(
              {
                storeId: coordinate.storeId,
                processId: coordinate.processId,
                journal: coordinate.journal,
                currentBoundary: coordinate.currentBoundary,
                currentCandidate: coordinate.currentCandidate,
                activeActivity: coordinate.activeActivity,
              },
              {
                storeId: delivery?.storeId ?? null,
                processId: value.deliveryId,
                journal: delivery === null ||
                    delivery.journal.headSequence === null ||
                    delivery.journal.headDigest === null
                  ? null
                  : {
                      headSequence: delivery.journal.headSequence,
                      headDigest: delivery.journal.headDigest,
                    },
                currentBoundary: delivery?.subjects.activeBoundary ??
                  delivery?.subjects.proposedBoundary ?? null,
                currentCandidate: delivery?.subjects.candidate ?? null,
                activeActivity: unresolvedActivity === null
                  ? null
                  : {
                      id: unresolvedActivity.id,
                      operation: unresolvedActivity.operation,
                      stage: unresolvedActivity.stage,
                      recovery: activityRecovery,
                    },
              },
              ["value", "view", "coordinate"],
              "Attempt View must bind the directly observed Delivery coordinate",
            );
            requireSameCoordinate(
              {
                standing: attemptView.processAndProof.standing,
                candidateCondition: attemptView.processAndProof.candidateCondition,
                proposedBoundary: attemptView.processAndProof.proposedBoundary,
                activeBoundary: attemptView.processAndProof.activeBoundary,
                materialCondition: attemptView.processAndProof.materialCondition?.reference ?? null,
                seal: attemptView.processAndProof.seal,
                evidence: attemptView.processAndProof.evidence?.reference ?? null,
                eligibleOperations: attemptView.processAndProof.eligibleOperations,
              },
              delivery === null
                ? null
                : {
                    standing: delivery.standing,
                    candidateCondition: delivery.candidateCondition,
                    proposedBoundary: delivery.subjects.proposedBoundary,
                    activeBoundary: delivery.subjects.activeBoundary,
                    materialCondition: delivery.subjects.materialCondition,
                    seal: delivery.subjects.seal,
                    evidence: delivery.subjects.evidence,
                    eligibleOperations: delivery.eligibleOperations,
                  },
              ["value", "view", "processAndProof"],
              "Attempt View Process and Proof must bind the directly observed Delivery reduction",
            );
          }
          break;
        case "delivery-view":
          bindDeliveryView(value.value.view, ["value", "view"]);
          break;
        case "families":
        case "family":
        case "revisions":
          bindGeneration(value.value.generation, ["value", "generation"]);
          if (value.value.kind === "family" || value.value.kind === "revisions") {
            bindRecordProcesses(value.value.records, ["value", "records"]);
          }
          break;
      }
    }
  } else if (value.operation === "delivery.export") {
    if (value.status === "completed" && (value.value === null || !("format" in value.value))) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Completed export requires a Markdown value",
      });
    } else if (value.value !== null && !("format" in value.value)) {
      context.addIssue({ code: "custom", path: ["value"], message: "Export cannot return an inspection value" });
    }
  } else if (value.operation === "delivery.inbox") {
    if (value.status === "completed" && selectedKind !== "inbox") {
      context.addIssue({ code: "custom", path: ["value"], message: "Completed Inbox read requires an Inbox value" });
    } else if (selectedKind !== null && selectedKind !== "inbox") {
      context.addIssue({ code: "custom", path: ["value"], message: "Inbox read returned another value kind" });
    }
    if (
      value.status === "completed" && value.value !== null &&
      "kind" in value.value && value.value.kind === "inbox"
    ) bindInbox(value.value.view, ["value", "view"]);
  } else if (value.operation === "delivery.diff") {
    if (value.status === "completed" && selectedKind !== "diff") {
      context.addIssue({ code: "custom", path: ["value"], message: "Completed diff read requires a diff value" });
    } else if (selectedKind !== null && selectedKind !== "diff") {
      context.addIssue({ code: "custom", path: ["value"], message: "Diff read returned another value kind" });
    }
    if (
      value.status === "completed" && value.value !== null &&
      "kind" in value.value && value.value.kind === "diff"
    ) {
      bindGeneration(value.value.view.generation, ["value", "view", "generation"]);
      requireSameCoordinate(
        value.value.view.candidate,
        value.observation.delivery?.subjects.candidate ?? null,
        ["value", "view", "candidate"],
        "Candidate difference must bind the directly observed Candidate",
      );
      requireSameCoordinate(
        value.value.view.seal,
        value.observation.delivery?.subjects.seal ?? null,
        ["value", "view", "seal"],
        "Candidate difference must bind the directly observed Seal",
      );
    }
  } else if (value.operation === "delivery.watch") {
    if (value.status === "completed" && selectedKind !== "watch") {
      context.addIssue({ code: "custom", path: ["value"], message: "Completed watch requires a watch value" });
    } else if (selectedKind !== null && selectedKind !== "watch") {
      context.addIssue({ code: "custom", path: ["value"], message: "Watch returned another value kind" });
    }
    if (
      value.status === "completed" && value.value !== null &&
      "kind" in value.value && value.value.kind === "watch"
    ) {
      if (value.value.scope === "delivery" && value.value.delivery !== null) {
        bindDeliveryView(value.value.delivery, ["value", "delivery"]);
        requireSameCoordinate(
          value.value.generation,
          value.value.delivery.generation.digest,
          ["value", "generation"],
          "Delivery watch generation must match its selected Delivery View",
        );
      } else if (value.value.scope === "inbox" && value.value.inbox !== null) {
        bindInbox(value.value.inbox, ["value", "inbox"]);
        requireSameCoordinate(
          value.value.generation,
          value.value.inbox.generation,
          ["value", "generation"],
          "Inbox watch generation must match its selected Inbox",
        );
      }
    }
  } else if (value.value !== null) {
    context.addIssue({
      code: "custom",
      path: ["value"],
      message: "This operation cannot return a read-model value",
    });
  }
  if (value.digest !== selfDigestFoundationCarrier(value)) {
    context.addIssue({ code: "custom", path: ["digest"], message: "Runtime result digest mismatch" });
  }
});

export type FoundationInspectionResult = z.output<typeof FoundationInspectionResultSchema>;
export type FoundationInboxResult = z.output<typeof FoundationInboxResultSchema>;
export type FoundationDiffResult = z.output<typeof FoundationDiffResultSchema>;
export type FoundationWatchResult = z.output<typeof FoundationWatchResultSchema>;
export type FoundationExportResult = z.output<typeof FoundationExportResultSchema>;
export type FoundationRuntimeOperationResult = z.output<typeof FoundationRuntimeOperationResultSchema>;
export type FoundationRuntimeOperationValue = FoundationRuntimeOperationResult["value"];

export type FoundationRuntimeOperationResultInput = Readonly<{
  request: FoundationDeepReadonly<FoundationRuntimeOperationRequest>;
  observedAt: string;
  status: FoundationRuntimeOperationResult["status"];
  targetId: string | null;
  deliveryId: string | null;
  observation: FoundationDeepReadonly<FoundationRuntimeObservation>;
  changes: FoundationDeepReadonly<FoundationChangeFacts>;
  events?: readonly FoundationDeepReadonly<FoundationControlEvent>[];
  control?: readonly FoundationDeepReadonly<FoundationControlReference>[];
  diagnostics?: readonly FoundationDeepReadonly<FoundationDiagnostic>[];
  value?: FoundationDeepReadonly<FoundationRuntimeOperationValue>;
}>;

export function parseFoundationRuntimeOperationResult(value: unknown): FoundationRuntimeOperationResult {
  return protocolParse(
    FoundationRuntimeOperationResultSchema,
    value,
    "lifecycle.interface.result-invalid",
    "Foundation Runtime result",
  );
}

export function parseFoundationRuntimeOperationResultJson(
  input: string | Uint8Array,
  limits: FoundationStrictJsonLimits = {},
): FoundationRuntimeOperationResult {
  return parseFoundationRuntimeOperationResult(parseFoundationStrictJson(input, {
    ...limits,
    source: limits.source ?? "Foundation Runtime result JSON",
  }));
}

export function parseFoundationRuntimeOperationResultForRequest(
  value: unknown,
  request: unknown,
): FoundationRuntimeOperationResult {
  const parsedRequest = parseFoundationRuntimeOperationRequest(request);
  const result = parseFoundationRuntimeOperationResult(value);
  if (
    result.operation !== parsedRequest.operation ||
    result.requestDigest !== digestFoundationRuntimeOperationRequest(parsedRequest)
  ) {
    throw new FoundationProtocolError(
      "lifecycle.interface.request-result-substitution",
      "Foundation Runtime result does not bind the exact originating request",
    );
  }
  const expectedDeliveryId = "deliveryId" in parsedRequest ? parsedRequest.deliveryId : null;
  if (parsedRequest.operation !== "delivery.prepare" && result.deliveryId !== expectedDeliveryId) {
    throw new FoundationProtocolError(
      "lifecycle.interface.request-result-delivery",
      "Foundation Runtime result does not bind the selected Delivery",
    );
  }
  if (parsedRequest.operation === "delivery.prepare" && result.status === "completed" && result.deliveryId === null) {
    throw new FoundationProtocolError(
      "lifecycle.interface.result-delivery-missing",
      "Completed preparation must return the created Delivery identity",
    );
  }
  if (
    parsedRequest.operation === "repository.initialize" &&
    parsedRequest.input.targetId !== undefined &&
    result.targetId !== parsedRequest.input.targetId
  ) {
    throw new FoundationProtocolError(
      "lifecycle.interface.request-result-target",
      "Initialization result does not bind the requested target identity",
    );
  }
  if (result.status === "completed") {
    const selectionFailure = (message: string, path: readonly (string | number)[]): never => {
      throw new FoundationProtocolError(
        "lifecycle.interface.request-result-selection",
        message,
        path,
      );
    };
    if (parsedRequest.operation === "delivery.inspect") {
      if (result.value === null || !("kind" in result.value)) {
        selectionFailure(
          "Completed Delivery inspection does not answer the exact requested selector",
          ["value", "kind"],
        );
      }
      const inspectionValue = result.value as FoundationInspectionResult;
      if (inspectionValue.kind !== parsedRequest.input.kind) {
        selectionFailure(
          "Completed Delivery inspection does not answer the exact requested selector",
          ["value", "kind"],
        );
      }
      if (
        parsedRequest.input.kind === "dossier" && inspectionValue.kind === "dossier" &&
        inspectionValue.dossier !== parsedRequest.input.dossier
      ) {
        selectionFailure("Delivery inspection returned another dossier", ["value", "dossier"]);
      }
      if (parsedRequest.input.kind === "record" && inspectionValue.kind === "record") {
        const recordReference = {
          kind: inspectionValue.record.recordKind,
          id: inspectionValue.record.recordId,
          revision: inspectionValue.record.revision,
          digest: inspectionValue.record.digest,
        };
        if (canonicalFoundationJson(recordReference) !== canonicalFoundationJson(parsedRequest.input.reference)) {
          selectionFailure("Delivery inspection returned another Control revision", ["value", "record"]);
        }
      }
      if (
        parsedRequest.input.kind === "attempt-view" &&
        parsedRequest.input.selection.kind === "attempt" &&
        inspectionValue.kind === "attempt-view" &&
        (
          inspectionValue.view === null ||
          inspectionValue.view.coordinate.attempt.id !== parsedRequest.input.selection.attemptId
        )
      ) {
        selectionFailure(
          "Delivery inspection returned another Agent Attempt",
          ["value", "view", "coordinate", "attempt"],
        );
      }
      if (
        parsedRequest.input.kind === "family" && inspectionValue.kind === "family" &&
        inspectionValue.recordKind !== parsedRequest.input.recordKind
      ) {
        selectionFailure("Delivery inspection returned another Control family", ["value", "recordKind"]);
      }
      if (
        parsedRequest.input.kind === "revisions" && inspectionValue.kind === "revisions" &&
        inspectionValue.recordId !== parsedRequest.input.recordId
      ) {
        selectionFailure(
          "Delivery inspection returned revisions for another Control record",
          ["value", "recordId"],
        );
      }
    } else if (parsedRequest.operation === "delivery.diff") {
      if (
        result.value === null || !("kind" in result.value) || result.value.kind !== "diff" ||
        result.value.view.subject !== parsedRequest.input.subject
      ) {
        selectionFailure(
          "Completed Candidate difference does not answer the exact requested subject",
          ["value", "view", "subject"],
        );
      }
    } else if (parsedRequest.operation === "delivery.watch") {
      if (
        result.value === null || !("kind" in result.value) || result.value.kind !== "watch" ||
        result.value.scope !== parsedRequest.input.scope
      ) {
        selectionFailure(
          "Completed watch does not answer the exact requested scope",
          ["value", "scope"],
        );
      }
    }
  }
  return result;
}

export function createFoundationRuntimeOperationResult(
  input: FoundationRuntimeOperationResultInput,
): FoundationRuntimeOperationResult {
  const request = parseFoundationRuntimeOperationRequest(input.request);
  const source = {
    schema: FOUNDATION_RUNTIME_RESULT_SCHEMA,
    interfaceProtocol: FOUNDATION_INTERFACE_PROTOCOL,
    runtimeProtocol: FOUNDATION_RUNTIME_PROTOCOL,
    requestDigest: digestFoundationRuntimeOperationRequest(request),
    observedAt: input.observedAt,
    operation: request.operation,
    status: input.status,
    targetId: input.targetId,
    deliveryId: input.deliveryId,
    observation: input.observation,
    changes: input.changes,
    events: input.events ?? [],
    control: input.control ?? [],
    diagnostics: input.diagnostics ?? [],
    value: input.value ?? null,
  } as const;
  return parseFoundationRuntimeOperationResult({
    ...source,
    digest: selfDigestFoundationCarrier(source as unknown as Readonly<Record<string, unknown>>),
  });
}

export function serializeFoundationRuntimeOperationResult(value: unknown): string {
  return canonicalFoundationJsonLine(parseFoundationRuntimeOperationResult(value));
}
