import {
  FoundationDeliveryInboxSchema,
  FoundationDeliveryInboxRowSchema,
  type FoundationDeliveryInbox,
  type FoundationDeliveryInboxRow,
  type FoundationDeliveryState,
  type FoundationRepositoryObservation,
} from "@neutral/lifecycle-protocol";
import { digestCanonical, type Sha256 } from "../validation/canonical.js";
import {
  compileDeliveryGeneration,
  deliveryLabel,
  latestMilestone,
} from "./delivery-view.js";
import { publicDeliveryState, type DeliveryControlPhysicalDisposition } from "./public-view.js";
import type { ControlRecordStore } from "./store.js";

function evidenceReadiness(store: ControlRecordStore, state: ReturnType<typeof publicDeliveryState>) {
  const selected = state.subjects.evidence;
  if (selected === null) return null;
  const revision = store.getRevision(selected.id, selected.revision);
  if (revision === null || revision.recordKind !== "evidence-packet" || revision.digest !== selected.digest) {
    return null;
  }
  const readiness = revision.payload.readiness;
  return readiness === "acceptance-ready" || readiness === "correctable" ||
      readiness === "revision-required" || readiness === "no-ship-recommended"
    ? readiness
    : null;
}

function attentionOwner(
  state: ReturnType<typeof publicDeliveryState>,
  activity: ReturnType<typeof compileDeliveryGeneration>["activeOperation"],
) {
  if (state.recovery !== null) return "director" as const;
  if (activity !== null) {
    if (activity.stage === "provider-running") return "provider" as const;
    if (activity.operation === "delivery.evaluate") return "reviewer" as const;
    return "runtime" as const;
  }
  if (
    state.standing === "awaiting-admission" || state.standing === "awaiting-readmission" ||
    state.standing === "boundary-paused" || state.standing === "decision-ready"
  ) return "director" as const;
  return "none" as const;
}

export function compileDeliveryInboxRow(input: Readonly<{
  store: ControlRecordStore;
  physical: DeliveryControlPhysicalDisposition;
  repository: FoundationRepositoryObservation;
  state?: FoundationDeliveryState;
}>): FoundationDeliveryInboxRow {
  const state = input.state ?? publicDeliveryState(input.store, input.physical);
  const generation = compileDeliveryGeneration({ ...input, state });
  return FoundationDeliveryInboxRowSchema.parse({
    status: "available",
    deliveryId: state.processId,
    label: deliveryLabel(input.store),
    standing: state.standing,
    candidateCondition: state.candidateCondition,
    activity: generation.activeOperation,
    attentionOwner: attentionOwner(state, generation.activeOperation),
    evidenceReadiness: evidenceReadiness(input.store, state),
    recoveryRequired: state.recovery !== null,
    latestMilestone: latestMilestone(input.store, state),
    generation,
  });
}

export function compileDeliveryInbox(input: Readonly<{
  targetId: string;
  repository: FoundationRepositoryObservation;
  registryInventoryDigest: Sha256;
  rows: readonly FoundationDeliveryInboxRow[];
  nextAfterDeliveryId: string | null;
}>): FoundationDeliveryInbox {
  const source = {
    schema: "lifecycle.delivery-inbox.v1",
    targetId: input.targetId,
    rows: input.rows,
    nextAfterDeliveryId: input.nextAfterDeliveryId,
  } as const;
  return FoundationDeliveryInboxSchema.parse({
    ...source,
    generation: digestCanonical({
      schema: "lifecycle.delivery-inbox-generation.v1",
      targetId: input.targetId,
      repository: {
        contract: input.repository.repositoryContract,
        contractDigest: input.repository.repositoryContractDigest,
        headCommit: input.repository.headCommit,
        headTree: input.repository.headTree,
        productDigest: input.repository.productDigest,
        atlas: input.repository.atlas,
        knowledgeDigest: input.repository.knowledgeDigest,
        checkBindingsDigest: input.repository.checkBindingsDigest,
      },
      registryInventoryDigest: input.registryInventoryDigest,
    }),
  });
}
