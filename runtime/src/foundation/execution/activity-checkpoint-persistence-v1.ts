import type { ControlJsonObject } from "../control/types.js";
import { FoundationError } from "../error.js";
import type {
  FoundationActivityChildCheckpointAdapterV7,
  FoundationActivityChildCheckpointViewV7,
} from "../process/activity-child-checkpoint-v7.js";
import type {
  FoundationActivityKernelContextV7,
} from "../process/activity-kernel-v7.js";
import {
  assertDigest,
  canonicalJson,
  digestCanonical,
  selfDigest,
  type Sha256,
} from "../validation/canonical.js";
import {
  FOUNDATION_EXECUTION_OPERATION_CHECKPOINT_SCHEMA,
  type FoundationExecutionOperationCheckpointCoordinateV1,
  type FoundationExecutionOperationCheckpointPersistenceV1,
  type FoundationExecutionOperationCheckpointV1,
  type FoundationRetainedExecutionOperationCheckpointV1,
} from "./operation-host.js";

function fail(code: string, message: string): never {
  throw new FoundationError(
    `lifecycle.execution.activity-checkpoint-persistence-v1.${code}`,
    message,
  );
}

function activityBinding<
  Plan extends ControlJsonObject,
  Parent extends ControlJsonObject,
>(context: FoundationActivityKernelContextV7<Plan, Parent>): Sha256 {
  if (
    context.support.activityId !== context.envelope.activityId ||
    context.coordinate.generation !== context.support.generation ||
    context.coordinate.payloadDigest !== context.support.payloadDigest ||
    context.support.payloadDigest !== digestCanonical(context.support.payload) ||
    canonicalJson(context.support.payload) !== canonicalJson(context.envelope)
  ) {
    fail("activity-substitution", "Execution persistence received an inconsistent Activity context");
  }
  return digestCanonical({
    schema: "lifecycle.execution-activity-persistence-owner.private.v1",
    storeId: context.support.storeId,
    processId: context.support.processId,
    activityId: context.support.activityId,
    activitySupportKind: context.support.supportKind,
    operation: context.envelope.operation,
    definitionId: context.envelope.definition.id,
    definitionDigest: context.envelope.definition.digest,
    planDigest: context.envelope.plan.digest,
  });
}

function persistenceDigest<
  Plan extends ControlJsonObject,
  Parent extends ControlJsonObject,
>(input: Readonly<{
  activityBindingDigest: Sha256;
  view: FoundationActivityChildCheckpointViewV7<
    Plan,
    Parent,
    FoundationExecutionOperationCheckpointV1
  >;
}>): Sha256 {
  if (input.view.checkpoint === null) {
    fail("checkpoint-cas", "A null execution child has no retained persistence coordinate");
  }
  return digestCanonical({
    schema: "lifecycle.execution-activity-checkpoint-coordinate.private.v1",
    activityBindingDigest: input.activityBindingDigest,
    supportGeneration: input.view.coordinate.generation,
    supportPayloadDigest: input.view.coordinate.payloadDigest,
    checkpointDigest: input.view.checkpoint.digest,
  });
}

function assertCheckpoint(
  checkpoint: FoundationExecutionOperationCheckpointV1,
  specificationDigest: Sha256,
): void {
  if (
    checkpoint.schema !== FOUNDATION_EXECUTION_OPERATION_CHECKPOINT_SCHEMA ||
    checkpoint.specificationDigest !== specificationDigest ||
    checkpoint.digest !== selfDigest(checkpoint, "digest")
  ) {
    fail(
      "specification-substitution",
      "Execution checkpoint does not bind the Activity's exact Execution Specification",
    );
  }
}

function assertCoordinate(
  coordinate: FoundationExecutionOperationCheckpointCoordinateV1,
): void {
  if (!Number.isSafeInteger(coordinate.revision) || coordinate.revision < 1) {
    fail("checkpoint-cas", "Execution checkpoint coordinate has an invalid revision");
  }
  try {
    assertDigest(coordinate.checkpointDigest, "Execution checkpoint coordinate digest");
    assertDigest(coordinate.persistenceDigest, "Execution checkpoint persistence binding");
  } catch {
    fail("checkpoint-cas", "Execution checkpoint coordinate has an invalid digest");
  }
}

/** Select an owner-atomic parent commit; `null` keeps the default child-only CAS. */
export type FoundationActivityExecutionOwnerCommitV1<
  Plan extends ControlJsonObject,
  Parent extends ControlJsonObject,
> = (
  input: Readonly<{
    selected: FoundationActivityChildCheckpointViewV7<
      Plan,
      Parent,
      FoundationExecutionOperationCheckpointV1
    >;
    proposed: FoundationExecutionOperationCheckpointV1;
  }>,
) => null | (() => void | Promise<void>);

/**
 * Bind the execution host's private checkpoint seam to one exact child slot in
 * one already-open Activity. The Activity kernel remains the sole support CAS
 * and immutable-plan owner; this adapter creates no second recovery lineage.
 */
export function createFoundationActivityExecutionCheckpointPersistenceV1<
  Plan extends ControlJsonObject,
  Parent extends ControlJsonObject,
>(input: Readonly<{
  context: FoundationActivityKernelContextV7<Plan, Parent>;
  child: FoundationActivityChildCheckpointAdapterV7<
    Plan,
    Parent,
    FoundationExecutionOperationCheckpointV1
  >;
  specificationDigest: Sha256;
  ownerCommit?: FoundationActivityExecutionOwnerCommitV1<Plan, Parent>;
}>): FoundationExecutionOperationCheckpointPersistenceV1 {
  try {
    assertDigest(input.specificationDigest, "Execution Specification digest");
  } catch {
    fail("specification-substitution", "Execution persistence requires one exact Specification digest");
  }
  const boundActivity = activityBinding(input.context);

  const current = (): FoundationActivityChildCheckpointViewV7<
    Plan,
    Parent,
    FoundationExecutionOperationCheckpointV1
  > => {
    const view = input.child.current();
    if (activityBinding(view.context) !== boundActivity) {
      fail("activity-substitution", "Execution persistence substituted its exact Activity owner");
    }
    if (view.checkpoint !== null) {
      assertCheckpoint(view.checkpoint, input.specificationDigest);
    }
    return view;
  };

  const retained = (
    view: FoundationActivityChildCheckpointViewV7<
      Plan,
      Parent,
      FoundationExecutionOperationCheckpointV1
    >,
  ): FoundationRetainedExecutionOperationCheckpointV1 | null => {
    if (view.checkpoint === null) return null;
    return Object.freeze({
      coordinate: Object.freeze({
        revision: view.coordinate.generation,
        checkpointDigest: view.checkpoint.digest,
        persistenceDigest: persistenceDigest({
          activityBindingDigest: boundActivity,
          view,
        }),
      }),
      checkpoint: view.checkpoint,
    });
  };

  const assertSpecification = (specificationDigest: Sha256): void => {
    if (specificationDigest !== input.specificationDigest) {
      fail("specification-substitution", "Execution persistence selected another Specification");
    }
  };

  return Object.freeze({
    async read(
      specificationDigest: Sha256,
    ): Promise<FoundationRetainedExecutionOperationCheckpointV1 | null> {
      assertSpecification(specificationDigest);
      return retained(current());
    },

    async compareExchange(mutation: Readonly<{
      specificationDigest: Sha256;
      expected: FoundationExecutionOperationCheckpointCoordinateV1 | null;
      checkpoint: FoundationExecutionOperationCheckpointV1;
    }>): Promise<FoundationRetainedExecutionOperationCheckpointV1> {
      assertSpecification(mutation.specificationDigest);
      assertCheckpoint(mutation.checkpoint, input.specificationDigest);
      const selected = current();
      if (mutation.expected === null) {
        if (selected.checkpoint !== null) {
          fail("checkpoint-cas", "Execution checkpoint creation replaced a retained child value");
        }
      } else {
        assertCoordinate(mutation.expected);
        const selectedRetained = retained(selected);
        if (
          selectedRetained === null ||
          mutation.expected.revision !== selectedRetained.coordinate.revision ||
          mutation.expected.checkpointDigest !== selectedRetained.coordinate.checkpointDigest ||
          mutation.expected.persistenceDigest !== selectedRetained.coordinate.persistenceDigest
        ) {
          fail("checkpoint-cas", "Execution checkpoint update substituted its exact child coordinate");
        }
      }

      const ownerCommit = input.ownerCommit?.(Object.freeze({
        selected,
        proposed: mutation.checkpoint,
      })) ?? null;
      if (ownerCommit === null) {
        await input.child.step({
          mode: "checkpoint",
          expected: selected.coordinate,
          checkpoint: mutation.checkpoint,
        });
      } else {
        await ownerCommit();
      }
      const committed = current();
      if (activityBinding(committed.context) !== boundActivity) {
        fail("activity-substitution", "Execution checkpoint commit returned another Activity owner");
      }
      if (
        committed.coordinate.generation !== selected.coordinate.generation + 1 ||
        committed.checkpoint === null ||
        committed.checkpoint.digest !== mutation.checkpoint.digest ||
        canonicalJson(committed.checkpoint) !== canonicalJson(mutation.checkpoint)
      ) {
        fail("persistence-substitution", "Activity persistence committed another checkpoint value");
      }
      assertCheckpoint(committed.checkpoint, input.specificationDigest);
      return retained(committed)!;
    },
  });
}
