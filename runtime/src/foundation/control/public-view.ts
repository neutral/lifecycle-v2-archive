import {
  FoundationDeliveryStateSchema,
  type FoundationControlReference,
  type FoundationDeliveryState,
} from "@neutral/lifecycle-protocol";
import { FoundationError } from "../error.js";
import {
  composeDeliveryStoreDisposition,
  type ReducedDeliveryState,
} from "../process/delivery-reducer.js";
import { digestCanonical, type Sha256 } from "../validation/canonical.js";
import type { ControlRecordStore } from "./store.js";

export type DeliveryControlPhysicalDisposition = Readonly<{
  disposition: "active" | "archived";
  archiveManifestDigest: Sha256 | null;
}>;

type SubjectKind =
  | "work-boundary"
  | "candidate-revision"
  | "material-condition"
  | "candidate-seal"
  | "evidence-packet"
  | "closure";

function controlReference(
  kind: SubjectKind,
  value: ReducedDeliveryState["subjects"][keyof ReducedDeliveryState["subjects"]],
): FoundationControlReference | null {
  return value === null
    ? null
    : Object.freeze({ kind, id: value.id, revision: value.revision, digest: value.digest });
}

function storeDispositionState(
  store: ControlRecordStore,
  physical: DeliveryControlPhysicalDisposition,
): ReducedDeliveryState {
  const seal = store.getSeal();
  if (physical.disposition === "archived") {
    if (seal === null || physical.archiveManifestDigest === null) {
      throw new FoundationError(
        "lifecycle.control-public-view.archive",
        "An archived Delivery view requires its exact Store seal and archive manifest digest",
      );
    }
    return composeDeliveryStoreDisposition(store.state(), "archived-verified");
  }
  if (physical.archiveManifestDigest !== null) {
    throw new FoundationError(
      "lifecycle.control-public-view.archive",
      "An active Delivery cannot expose an archive manifest digest",
    );
  }
  return composeDeliveryStoreDisposition(
    store.state(),
    seal === null ? "active-unsealed" : "sealed-unarchived",
  );
}

export function publicDeliveryState(
  store: ControlRecordStore,
  physical: DeliveryControlPhysicalDisposition,
): FoundationDeliveryState {
  const state = storeDispositionState(store, physical);
  const recoveries = state.activities
    .filter(({ recovery }) => recovery !== null)
    .map(({ id, recovery }) => Object.freeze({ activityId: id, recovery: recovery! }));
  if (recoveries.length > 1) {
    throw new FoundationError(
      "lifecycle.control-public-view.recovery",
      "A Delivery cannot expose more than one exact recovery obligation",
    );
  }
  const activityRecovery = recoveries[0] ?? null;
  const seal = store.getSeal();
  const closureRecorded = state.subjects.closure !== null;
  const stage = physical.disposition === "archived"
    ? "archived"
    : seal !== null
      ? "sealed"
      : closureRecorded
        ? "closure-recorded"
        : "active";
  const source = {
    schema: "lifecycle.delivery-reduction.v2",
    storeId: store.identity.storeId,
    processId: store.identity.processId,
    standing: state.standing,
    candidateCondition: state.candidateCondition,
    activities: state.activities.map(({ id, operation, family, stage: activityStage }) => ({
      id,
      operation,
      family,
      stage: activityStage,
    })),
    recovery: activityRecovery !== null
      ? {
          scope: "activity",
          activityId: activityRecovery.activityId,
          kind: activityRecovery.recovery.kind,
          resumesAt: activityRecovery.recovery.resumesAt,
          exactEffectDigest: activityRecovery.recovery.exactEffectDigest,
        }
      : closureRecorded && physical.disposition !== "archived"
        ? {
            scope: "store-disposition",
            activityId: null,
            kind: "finalization",
            resumesAt: seal === null ? "store-seal" : "store-archive",
            exactEffectDigest: null,
          }
        : null,
    subjects: {
      proposedBoundary: controlReference("work-boundary", state.subjects.proposedBoundary),
      activeBoundary: controlReference("work-boundary", state.subjects.activeBoundary),
      candidate: controlReference("candidate-revision", state.subjects.candidate),
      materialCondition: controlReference("material-condition", state.subjects.materialCondition),
      seal: controlReference("candidate-seal", state.subjects.seal),
      evidence: controlReference("evidence-packet", state.subjects.evidence),
      closure: controlReference("closure", state.subjects.closure),
    },
    journal: {
      eventCount: state.journal.eventCount,
      headSequence: state.journal.eventCount === 0 ? null : state.journal.eventCount,
      headDigest: state.journal.headDigest,
    },
    storeDisposition: {
      stage,
      integrity: "verified",
      sealSubjectDigest: seal === null ? null : digestCanonical(seal),
      archiveManifestDigest: physical.archiveManifestDigest,
    },
    eligibleOperations: state.eligibleOperations,
  } as const;
  return FoundationDeliveryStateSchema.parse(source);
}
