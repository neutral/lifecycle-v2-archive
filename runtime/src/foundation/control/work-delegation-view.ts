import type { FoundationDeliveryState } from "@neutral/lifecycle-protocol";
import { compileWorkDelegationDecision } from "../process/work-delegation-policy.js";
import type { DeliveryControlPhysicalDisposition } from "./public-view.js";
import type { ControlRecordStore } from "./store.js";
import type { WorkDelegationStopRequest } from "./work-delegation-stop.js";
import { parseWorkDelegationPayload } from "./work-delegation.js";

/** Display exact retained resource permission; this neither funds nor starts work. */
export function compileWorkDelegationView(input: Readonly<{
  store: ControlRecordStore;
  state: FoundationDeliveryState;
  physical: DeliveryControlPhysicalDisposition;
  observedAt: string;
  pendingStop: WorkDelegationStopRequest | null;
}>) {
  const selected = input.state.delegation.current;
  const current = (() => {
    if (selected === null) return null;
    const revision = input.store.getRevision(selected.reference.id, selected.reference.revision);
    if (revision === null || revision.recordKind !== "work-delegation" ||
        revision.processId !== input.state.processId || revision.digest !== selected.reference.digest) {
      throw new TypeError("Work presentation requires the exact retained delegation");
    }
    const { schema: _schema, replaces: _replaces, ...permission } = parseWorkDelegationPayload(revision.payload);
    return Object.freeze({ reference: selected.reference, ...permission });
  })();
  // The fixed policy owns why another operation is useful. This projection
  // discloses its conclusion without accepting a client-supplied next step.
  const decision = compileWorkDelegationDecision({ store: input.store,
    physical: input.physical, observedAt: input.observedAt });
  const continuation = decision.kind === "operation"
    ? Object.freeze({ kind: decision.kind, operation: decision.operation, reason: decision.reason })
    : Object.freeze({ kind: decision.kind, reason: decision.reason });
  return Object.freeze({ current, pendingStop: input.pendingStop, continuation });
}
