import { assertFoundationSchema } from "../validation/schema-engine.js";
import { deliveryControlRecordPolicy } from "./kind-registry.js";
import type { ControlRecordRevision } from "./types.js";

/**
 * Validate one revision payload through the independent profile selected by
 * its closed record-family registry entry. The common revision schema does not
 * embed a union of every family payload and therefore does not create a schema
 * closure cascade for unrelated Control families.
 */
export function assertDeliveryControlRecordPayload(
  revision: ControlRecordRevision,
): void {
  const policy = deliveryControlRecordPolicy(revision.recordKind);
  assertFoundationSchema(
    policy.payloadSchemaId,
    revision.payload,
    `${revision.recordKind}:${revision.recordId}:revision-${revision.revision}:payload`,
  );
}
