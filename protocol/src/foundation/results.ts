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
  FOUNDATION_WORK_DELEGATION_STOP_REASONS,
  FoundationWorkDelegationOperationSchema,
  FoundationWorkDelegationReferenceSchema,
  FoundationWorkDelegationStopRequestSchema,
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
import { FoundationContextInspectionResultSchema, type FoundationInspectionSelection } from "./context-inspection.js";
import {
  FoundationNonnegativeSafeIntegerSchema,
  FoundationPositiveSafeIntegerSchema,
  protocolParse,
  type FoundationDeepReadonly,
} from "./internal.js";

const FoundationControlInspectionResultSchema = z.discriminatedUnion("kind", [
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

export const FoundationInspectionResultSchema = z.union([
  FoundationControlInspectionResultSchema,
  FoundationContextInspectionResultSchema,
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

export const FoundationWorkControlResultSchema = z.object({
  kind: z.literal("work-control"), action: z.enum(["set", "run", "stop"]),
  delegation: FoundationWorkDelegationReferenceSchema,
  eventProjection: z.literal("journal-coordinates-only"),
  completedOperations: FoundationNonnegativeSafeIntegerSchema,
  lastActivity: z.object({ activityId: FoundationOpaqueIdSchema, operation: FoundationWorkDelegationOperationSchema }).strict().nullable(),
  stop: z.object({ disposition: z.enum(["pending", "stopped"]), request: FoundationWorkDelegationStopRequestSchema }).strict().nullable(),
  reason: z.enum([...FOUNDATION_WORK_DELEGATION_STOP_REASONS, "delegation-set", "stop-pending"]),
}).strict().superRefine((value, context) => {
  if (value.action !== "run" && (value.completedOperations !== 0 || value.lastActivity !== null)) {
    context.addIssue({ code: "custom", message: "Set and stop do not report completed productive operations or an Activity" });
  }
  if (value.completedOperations > 0 && value.lastActivity === null) context.addIssue({ code: "custom", path: ["lastActivity"],
    message: "A counted settled course requires its exact latest Activity" });
  if (value.action === "set" && (value.stop !== null || value.reason !== "delegation-set")) {
    context.addIssue({ code: "custom", message: "Set reports one saved grant without a stop result" });
  }
  if (value.action === "stop" && (value.stop === null ||
      value.reason !== (value.stop.disposition === "pending" ? "stop-pending" : "delegation-stopped"))) {
    context.addIssue({ code: "custom", message: "Stop must report its exact pending or folded request" });
  }
  if (value.action === "run" && (value.reason === "delegation-set" || value.reason === "stop-pending")) {
    context.addIssue({ code: "custom", path: ["reason"], message: "Run reports its bounded continuation stopping reason" });
  }
  if (value.stop !== null && canonicalFoundationJson(value.stop.request.delegation) !== canonicalFoundationJson(value.delegation)) {
    context.addIssue({ code: "custom", path: ["stop", "request", "delegation"], message: "Stop result must bind the exact course grant" });
  }
});

export const FoundationRuntimeResultValueSchema = z.union([
  z.null(),
  FoundationInspectionResultSchema,
  FoundationExportResultSchema,
  FoundationInboxResultSchema,
  FoundationDiffResultSchema,
  FoundationWatchResultSchema,
  FoundationWorkControlResultSchema,
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
    "knowledge-index", "knowledge-record", "code-index", "code-file",
    "atlas-overview", "atlas-point", "atlas-resource", "source",
    "authorization-review",
  ]);
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
    // A Delivery generation binds its retained governing basis. The separately
    // observed canonical repository can advance while that Delivery works.
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
  const bindInspectionSelection = (selection: FoundationInspectionSelection, path: readonly (string | number)[]) => {
    const delivery = value.observation.delivery;
    if (delivery === null || selection.targetId !== value.targetId || selection.storeId !== delivery.storeId ||
        selection.processId !== delivery.processId || selection.origin.sequence > delivery.journal.eventCount ||
        (selection.origin.sequence === delivery.journal.headSequence && selection.origin.digest !== delivery.journal.headDigest)) {
      context.addIssue({ code: "custom", path: [...path], message: "Inspection selection must precede or equal the separately observed exact Store and Delivery" });
    }
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
  if (value.operation === "delivery.work") {
    if (value.events.length !== 0 || value.control.length !== 0) context.addIssue({ code: "custom",
      message: "Work control projects Journal coordinates, never a partial flattened event or revision list" });
    if (value.status === "completed" && selectedKind !== "work-control") context.addIssue({ code: "custom", path: ["value"],
      message: "Completed work control requires its exact action result" });
    if (selectedKind !== null && selectedKind !== "work-control") context.addIssue({ code: "custom", path: ["value"],
      message: "Work control cannot return another result kind" });
    const { beforeHead, afterHead, advanced } = value.changes.control;
    requireSameCoordinate(advanced, !sameCoordinate(beforeHead, afterHead), ["changes", "control", "advanced"],
      "Work Journal advancement comes from exact head comparison, not the deliberately empty event projection");
    if ((afterHead?.sequence ?? 0) < (beforeHead?.sequence ?? 0) ||
        (beforeHead !== null && afterHead?.sequence === beforeHead.sequence && !sameCoordinate(beforeHead, afterHead))) {
      context.addIssue({ code: "custom", path: ["changes", "control"], message: "Work control must retain one nonregressing exact Journal range" });
    }
    const delivery = value.observation.delivery;
    if (delivery !== null) requireSameCoordinate(
      { sequence: afterHead?.sequence ?? null, digest: afterHead?.digest ?? null },
      { sequence: delivery.journal.headSequence, digest: delivery.journal.headDigest },
      ["changes", "control", "afterHead"], "Work range must end at the directly observed Journal head");
    if (value.value !== null && "kind" in value.value && value.value.kind === "work-control") {
      const work = value.value;
      if (delivery === null) context.addIssue({ code: "custom", path: ["observation", "delivery"],
        message: "A retained work result requires the directly observed Delivery" });
      if (work.action === "set") requireSameCoordinate(work.delegation, delivery?.delegation.current?.reference ?? null,
        ["value", "delegation"], "Saved work grant must bind the observed retained revision");
      if (work.lastActivity !== null) {
        const activity = delivery?.activities.find(item => item.id === work.lastActivity!.activityId);
        requireSameCoordinate(activity === undefined ? null : { activityId: activity.id, operation: activity.operation },
          work.lastActivity, ["value", "lastActivity"], "Work course must name one exact observed Activity and operation");
      }
      if (work.completedOperations > (afterHead?.sequence ?? 0) - (beforeHead?.sequence ?? 0)) {
        context.addIssue({ code: "custom", path: ["value", "completedOperations"],
          message: "Settled operation count cannot exceed the observed Journal advancement" });
      }
      if (work.stop !== null) {
        requireSameCoordinate({ storeId: work.stop.request.storeId, processId: work.stop.request.processId,
          delegation: work.stop.request.delegation },
        { storeId: delivery?.storeId ?? null, processId: value.deliveryId, delegation: work.delegation },
        ["value", "stop", "request"], "Work stop result must bind the exact observed Store and Delivery grant");
        requireSameCoordinate(delivery?.delegation.current ?? null,
          { reference: work.delegation, stopped: work.stop.disposition === "stopped" },
          ["value", "stop", "disposition"], "Stop disposition must match the exact observed grant's Journal standing");
      }
    }
  } else if (value.operation === "delivery.inspect") {
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
        case "knowledge-index":
        case "knowledge-record":
        case "atlas-overview":
        case "atlas-point":
        case "atlas-resource":
        case "source":
          bindInspectionSelection(value.value.basis.selection, ["value", "basis", "selection"]);
          break;
        case "code-index":
        case "code-file":
          if (value.value.status === "available") {
            bindInspectionSelection(
              value.value.basis.selection,
              ["value", "basis", "selection"],
            );
          } else {
            bindInspectionSelection(value.value.selection, ["value", "selection"]);
          }
          break;
        case "authorization-review":
          bindGeneration(value.value.generation, ["value", "generation"]);
          requireSameCoordinate(
            value.value.review.targetId,
            value.targetId,
            ["value", "review", "targetId"],
            "Authorization Review must bind the directly observed Target",
          );
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
export type FoundationWorkControlResult = z.output<typeof FoundationWorkControlResultSchema>;
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
  if (parsedRequest.operation === "delivery.work" && result.value !== null &&
      "kind" in result.value && result.value.kind === "work-control") {
    if (result.value.action !== parsedRequest.input.action ||
        (parsedRequest.input.action !== "set" && canonicalFoundationJson(result.value.delegation) !== canonicalFoundationJson(parsedRequest.input.delegation))) {
      throw new FoundationProtocolError("lifecycle.interface.request-result-selection",
        "Work result must answer the exact requested action and grant", ["value"]);
    }
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
      const bindContextSelection = (
        selection: unknown,
        basis: Readonly<{ selection: unknown }>,
        path: readonly (string | number)[],
      ): void => {
        if (canonicalFoundationJson(basis.selection) !== canonicalFoundationJson(selection)) {
          selectionFailure(
            "Context inspection returned another exact selection or provenance",
            [...path, "selection"],
          );
        }
      };
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
      if (
        parsedRequest.input.kind === "knowledge-index" &&
        inspectionValue.kind === "knowledge-index"
      ) {
        bindContextSelection(parsedRequest.input.context, inspectionValue.basis, ["value", "basis"]);
        if (inspectionValue.records.length > parsedRequest.input.limit) {
          selectionFailure("Knowledge inspection exceeded the requested page limit", ["value", "records"]);
        }
      }
      if (
        parsedRequest.input.kind === "knowledge-record" &&
        inspectionValue.kind === "knowledge-record"
      ) {
        bindContextSelection(parsedRequest.input.context, inspectionValue.basis, ["value", "basis"]);
        if (
          canonicalFoundationJson(inspectionValue.reference) !==
          canonicalFoundationJson(parsedRequest.input.reference)
        ) {
          selectionFailure("Knowledge inspection returned another record", ["value", "reference"]);
        }
      }
      if (
        parsedRequest.input.kind === "atlas-overview" &&
        inspectionValue.kind === "atlas-overview"
      ) {
        bindContextSelection(parsedRequest.input.context, inspectionValue.basis, ["value", "basis"]);
        if (
          inspectionValue.maps.length > parsedRequest.input.mapLimit ||
          inspectionValue.points.length > parsedRequest.input.pointLimit ||
          inspectionValue.resources.length > parsedRequest.input.resourceLimit
        ) {
          selectionFailure("Atlas overview exceeded a requested page limit", ["value"]);
        }
      }
      if (
        parsedRequest.input.kind === "atlas-point" &&
        inspectionValue.kind === "atlas-point"
      ) {
        bindContextSelection(parsedRequest.input.context, inspectionValue.basis, ["value", "basis"]);
        if (inspectionValue.point.cursor !== parsedRequest.input.pointCursor) {
          selectionFailure("Atlas inspection returned another Point", ["value", "point", "cursor"]);
        }
        if (
          inspectionValue.records.length > parsedRequest.input.recordLimit ||
          inspectionValue.relations.length > parsedRequest.input.relationLimit
        ) {
          selectionFailure("Atlas Point inspection exceeded a requested page limit", ["value"]);
        }
      }
      if (
        parsedRequest.input.kind === "atlas-resource" &&
        inspectionValue.kind === "atlas-resource"
      ) {
        bindContextSelection(parsedRequest.input.context, inspectionValue.basis, ["value", "basis"]);
        if (inspectionValue.registration.id !== parsedRequest.input.resourceId) {
          selectionFailure("Atlas inspection returned another Resource", ["value", "registration", "id"]);
        }
      }
      if (
        parsedRequest.input.kind === "code-index" &&
        inspectionValue.kind === "code-index"
      ) {
        const selection = inspectionValue.status === "available"
          ? inspectionValue.basis.selection
          : inspectionValue.selection;
        const subject = inspectionValue.status === "available"
          ? inspectionValue.basis.subject
          : inspectionValue.subject;
        if (canonicalFoundationJson(selection) !== canonicalFoundationJson(parsedRequest.input.selection)) {
          selectionFailure("Code inspection returned another exact selection or provenance", ["value"]);
        }
        if (subject !== parsedRequest.input.subject) {
          selectionFailure("Code inspection returned another subject", ["value"]);
        }
        if (
          inspectionValue.status === "available" &&
          inspectionValue.files.length > parsedRequest.input.limit
        ) {
          selectionFailure("Code inspection exceeded the requested page limit", ["value", "files"]);
        }
      }
      if (
        parsedRequest.input.kind === "code-file" &&
        inspectionValue.kind === "code-file"
      ) {
        const selection = inspectionValue.status === "available"
          ? inspectionValue.basis.selection
          : inspectionValue.selection;
        const subject = inspectionValue.status === "available"
          ? inspectionValue.basis.subject
          : inspectionValue.subject;
        if (canonicalFoundationJson(selection) !== canonicalFoundationJson(parsedRequest.input.selection)) {
          selectionFailure("Code inspection returned another exact selection or provenance", ["value"]);
        }
        if (subject !== parsedRequest.input.subject) {
          selectionFailure("Code inspection returned another subject", ["value"]);
        }
        if (
          inspectionValue.status === "available" &&
          inspectionValue.file.cursor !== parsedRequest.input.fileCursor
        ) {
          selectionFailure("Code inspection returned another file", ["value", "file", "cursor"]);
        }
        if (
          inspectionValue.status === "available" &&
          inspectionValue.difference.returnedByteLength > parsedRequest.input.maximumDiffBytes
        ) {
          selectionFailure("Code inspection exceeded the requested difference bound", ["value", "difference"]);
        }
      }
      if (parsedRequest.input.kind === "source" && inspectionValue.kind === "source") {
        if (
          canonicalFoundationJson(inspectionValue.reference) !==
          canonicalFoundationJson(parsedRequest.input.reference)
        ) {
          selectionFailure("Source inspection returned another reference", ["value", "reference"]);
        }
        if (inspectionValue.startByte !== parsedRequest.input.startByte) {
          selectionFailure("Source inspection returned another range", ["value", "startByte"]);
        }
        if (inspectionValue.byteLength > parsedRequest.input.maximumBytes) {
          selectionFailure("Source inspection exceeded the requested byte bound", ["value", "byteLength"]);
        }
      }
      if (
        parsedRequest.input.kind === "authorization-review" &&
        inspectionValue.kind === "authorization-review"
      ) {
        if (inspectionValue.generation.digest !== parsedRequest.input.expectedGeneration) {
          selectionFailure("Authorization Review returned another Delivery generation", ["value", "generation"]);
        }
        if (inspectionValue.review.operation !== parsedRequest.input.operation) {
          selectionFailure("Authorization Review returned another operation", ["value", "review", "operation"]);
        }
        if (
          parsedRequest.input.operation === "delivery.no-ship" &&
          parsedRequest.input.input !== null
        ) {
          const normalized = `${parsedRequest.input.input.semanticMarkdown
            .replaceAll("\r\n", "\n")
            .replace(/\n+$/u, "")}\n`;
          if (inspectionValue.review.semanticMarkdown !== normalized) {
            selectionFailure(
              "Authorization Review returned another semantic input",
              ["value", "review", "semanticMarkdown"],
            );
          }
        }
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
