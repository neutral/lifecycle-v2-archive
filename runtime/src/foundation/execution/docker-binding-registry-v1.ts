import { FoundationError } from "../error.js";
import {
  canonicalJson,
  selfDigest,
  type Sha256,
} from "../validation/canonical.js";
import {
  foundationExecutionAllocationKeyBindingDigest,
  privateFoundationExecutionHandle,
  type FoundationExecutionHandle,
} from "./backend.js";
import type { FoundationExecutionSpecificationV1 } from "./contracts.js";
import type {
  FoundationDockerExecutionBindingResolverV1,
  FoundationDockerExecutionBindingV1,
} from "./docker-backend.js";
import type {
  FoundationExecutionOperationCheckpointPersistenceV1,
} from "./operation-host.js";

const MAXIMUM_REGISTERED_OPERATIONS = 10_000;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

type RegisteredOperation = Readonly<{
  specification: FoundationExecutionSpecificationV1;
  engineIdentityDigest: Sha256;
  persistence: FoundationExecutionOperationCheckpointPersistenceV1;
}>;

function fail(code: string, message: string): never {
  throw new FoundationError(
    `lifecycle.execution.docker-binding-registry-v1.${code}`,
    message,
  );
}

/**
 * Process-private bridge from durable operation checkpoints to the Docker
 * Backend's recovery binding. It invents no state: every returned fact is
 * recomputed from the exact retained checkpoint selected by its Specification.
 */
export class FoundationDockerExecutionBindingRegistryV1 {
  readonly #operations = new Map<Sha256, RegisteredOperation>();
  readonly #volatileObservationSequences = new Map<string, number>();

  /** Release only this invocation's reader when its checkpoint custody ends. */
  register(input: RegisteredOperation): () => void {
    if (!SHA256.test(input.engineIdentityDigest) ||
        input.specification.digest !== selfDigest(input.specification, "digest")) {
      fail("registration", "Docker recovery binding registration is invalid");
    }
    const existing = this.#operations.get(input.specification.digest);
    if (existing !== undefined && (
      canonicalJson(existing.specification) !== canonicalJson(input.specification) ||
      existing.engineIdentityDigest !== input.engineIdentityDigest
    )) {
      fail("substitution", "Docker recovery binding registration substituted retained facts");
    }
    if (existing === undefined && this.#operations.size >= MAXIMUM_REGISTERED_OPERATIONS) {
      fail("bound", "Docker recovery binding registry exceeded its fixed operation bound");
    }
    const registration = Object.freeze({ ...input });
    this.#operations.set(input.specification.digest, registration);
    return () => {
      if (this.#operations.get(input.specification.digest) === registration) {
        this.#operations.delete(input.specification.digest);
      }
    };
  }

  readonly resolve: FoundationDockerExecutionBindingResolverV1 = async (
    handle: FoundationExecutionHandle,
  ): Promise<FoundationDockerExecutionBindingV1 | null> => {
    const matches: Array<Readonly<{
      operation: RegisteredOperation;
      checkpoint: NonNullable<Awaited<ReturnType<
        FoundationExecutionOperationCheckpointPersistenceV1["read"]
      >>>["checkpoint"];
    }>> = [];
    for (const operation of this.#operations.values()) {
      const retained = await operation.persistence.read(operation.specification.digest);
      if (retained?.checkpoint.handle === handle) {
        matches.push(Object.freeze({ operation, checkpoint: retained.checkpoint }));
      }
    }
    if (matches.length > 1) {
      return fail("ambiguous", "Docker Handle resolves through more than one durable operation");
    }
    if (matches.length === 0) return null;
    const selected = matches[0]!;
    const checkpoint = selected.checkpoint;
    return Object.freeze({
      specification: selected.operation.specification,
      allocationKeyDigest: foundationExecutionAllocationKeyBindingDigest(
        checkpoint.allocationKey,
      ),
      engineIdentityDigest: selected.operation.engineIdentityDigest,
      dispatchAuthorityConsumed: checkpoint.dispatchAuthorityConsumedAt !== null,
      retainedObservationSequence: checkpoint.observation?.observationSequence ?? null,
      retirementCheckpointDigest: checkpoint.retirement?.digest ?? null,
    });
  };

  /**
   * Observation sequence owner derived from the same exact durable Activity
   * checkpoint. Process memory only advances observations not yet committed;
   * restart resumes strictly after the retained sequence for the same Handle.
   */
  readonly observationSequence = Object.freeze({
    next: async (cellId: string): Promise<number> => {
      if (!/^[a-f0-9]{64}$/u.test(cellId)) {
        return fail("observation-sequence", "Docker Cell identity is invalid");
      }
      const handle = privateFoundationExecutionHandle(`execution-handle-v1:${cellId}`);
      const retained = await this.resolve(handle);
      const durable = retained?.retainedObservationSequence ?? 0;
      const volatile = this.#volatileObservationSequences.get(cellId) ?? 0;
      const next = Math.max(durable, volatile) + 1;
      if (!Number.isSafeInteger(next)) {
        return fail("observation-sequence", "Docker observation sequence exceeded its fixed domain");
      }
      this.#volatileObservationSequences.set(cellId, next);
      return next;
    },
  });
}
