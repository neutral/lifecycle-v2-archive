import assert from "node:assert/strict";
import {
  compileExecutionReclamationBinding,
  type FoundationExecutionBackend,
  type FoundationExecutionHandle,
} from "../../src/foundation/execution/backend.js";
import type { FoundationExecutionObservationV1 } from "../../src/foundation/execution/contracts.js";
import { digestCanonical, selfDigest } from "../../src/foundation/validation/canonical.js";

/** Supplies raw exact absence facts; Control, Containment, and Retirement remain real owners. */
export function preDispatchAbsenceBackend(input: Readonly<{
  delegate: FoundationExecutionBackend;
  remove(handle: FoundationExecutionHandle): void;
}>) {
  let handle: FoundationExecutionHandle | null = null;
  let previous: FoundationExecutionObservationV1 | null = null;
  let absent = false;
  const backend: FoundationExecutionBackend = {
    profile: input.delegate.profile,
    async allocate(specification, allocationKey) {
      assert.equal(absent, false, "Exact absence cannot allocate a replacement");
      handle = await input.delegate.allocate(specification, allocationKey);
      return handle;
    },
    async dispatch(selected) {
      assert.equal(absent, false, "Exact absence cannot dispatch");
      return await input.delegate.dispatch(selected);
    },
    async observe(selected) {
      assert.equal(selected, handle);
      if (!absent) {
        previous = await input.delegate.observe(selected);
        return previous;
      }
      assert(previous !== null);
      const subject = {
        ...previous,
        observationSequence: previous.observationSequence + 1,
        observedAt: new Date(Date.parse(previous.observedAt) + 1).toISOString(),
        allocationState: "absent" as const,
        dispatchState: "not-observed" as const,
        processState: "not-observed" as const,
        terminal: null,
        containmentFacts: {
          rootProcess: "unverified" as const,
          descendants: "absent" as const,
          writers: "absent" as const,
          credentials: "not-injected" as const,
          providerChannel: "not-granted" as const,
          outputMutation: "impossible" as const,
        },
        output: { disposition: "not-produced" as const, manifestDigest: null, carrierByteLength: null },
      };
      previous = Object.freeze({ ...subject, digest: selfDigest(subject) });
      return previous;
    },
    async cancel(selected) {
      assert.equal(absent, false, "Direct absence needs no cancellation");
      return await input.delegate.cancel(selected);
    },
    retrieve: input.delegate.retrieve.bind(input.delegate),
    async createReclamationBinding(binding) {
      if (!absent) return await input.delegate.createReclamationBinding(binding);
      assert.equal(binding.handle, handle);
      assert.equal(binding.dispatchAuthorityConsumed, false);
      return compileExecutionReclamationBinding({
        ...binding,
        backendBinding: {
          schema: "lifecycle.pre-dispatch-absence-test-binding.private.v1",
          physicalIdentityDigest: digestCanonical({
            handle, specificationDigest: binding.specification.digest,
          }),
        },
      });
    },
    // These tests prove durable Retirement/handoff, not physical Reclamation.
    reclaim: input.delegate.reclaim.bind(input.delegate),
  };
  return Object.freeze({
    backend,
    markAbsent() {
      assert(handle !== null && previous !== null);
      assert.equal(previous.dispatchState, "not-observed");
      input.remove(handle);
      absent = true;
    },
  });
}
