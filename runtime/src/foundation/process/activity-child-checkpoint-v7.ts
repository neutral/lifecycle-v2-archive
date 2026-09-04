import type {
  ControlJsonObject,
  ControlRecordFile,
  ControlRecordFileInput,
  ControlRecordOperationSupportCoordinate,
  ControlRecordStoreAppend,
  ControlRecordStoreAppendResult,
} from "../control/types.js";
import { FoundationError } from "../error.js";
import type {
  FoundationActivityKernelCheckpointAdapterV7,
  FoundationActivityKernelContextV7,
} from "./activity-kernel-v7.js";

export type FoundationActivityChildCheckpointLensV7<
  Parent extends ControlJsonObject,
  Child extends ControlJsonObject,
> = Readonly<{
  get(parent: Parent): ControlJsonObject | null;
  set(parent: Parent, child: Child | null): Parent;
  parse(value: ControlJsonObject): Child;
}>;

export type FoundationActivityChildCheckpointViewV7<
  Plan extends ControlJsonObject,
  Parent extends ControlJsonObject,
  Child extends ControlJsonObject,
> = Readonly<{
  context: FoundationActivityKernelContextV7<Plan, Parent>;
  coordinate: ControlRecordOperationSupportCoordinate;
  checkpoint: Child | null;
}>;

export type FoundationActivityChildCheckpointStepV7<Child extends ControlJsonObject> =
  | Readonly<{
      mode: "checkpoint";
      expected: ControlRecordOperationSupportCoordinate;
      checkpoint: Child | null;
    }>
  | Readonly<{
      mode: "append";
      expected: ControlRecordOperationSupportCoordinate;
      checkpoint: Child | null;
      append: ControlRecordStoreAppend;
    }>
  | Readonly<{
      mode: "append-with-files";
      expected: ControlRecordOperationSupportCoordinate;
      checkpoint: Child | null;
      append: ControlRecordStoreAppend;
      files: readonly ControlRecordFileInput[];
    }>;

export type FoundationActivityChildCheckpointStepResultV7<
  Plan extends ControlJsonObject,
  Parent extends ControlJsonObject,
  Child extends ControlJsonObject,
> = Readonly<{
  view: FoundationActivityChildCheckpointViewV7<Plan, Parent, Child>;
  append: ControlRecordStoreAppendResult | null;
  files: readonly ControlRecordFile[];
}>;

export type FoundationActivityChildCheckpointAdapterV7<
  Plan extends ControlJsonObject,
  Parent extends ControlJsonObject,
  Child extends ControlJsonObject,
> = Readonly<{
  current(): FoundationActivityChildCheckpointViewV7<Plan, Parent, Child>;
  step(
    input: FoundationActivityChildCheckpointStepV7<Child>,
  ): Promise<FoundationActivityChildCheckpointStepResultV7<Plan, Parent, Child>>;
}>;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.activity-child-checkpoint-v7.${code}`, message);
}

function sameCoordinate(
  left: ControlRecordOperationSupportCoordinate,
  right: ControlRecordOperationSupportCoordinate,
): boolean {
  return left.generation === right.generation && left.payloadDigest === right.payloadDigest;
}

/**
 * Focus one typed child recovery value inside an operation's complete kernel
 * checkpoint. The parent kernel remains the sole owner of parsing, CAS,
 * reducer/event legality, atomic retention, and immutable-plan enforcement.
 */
export function createFoundationActivityChildCheckpointAdapterV7<
  Plan extends ControlJsonObject,
  Parent extends ControlJsonObject,
  Child extends ControlJsonObject,
>(input: Readonly<{
  parent: FoundationActivityKernelCheckpointAdapterV7<Plan, Parent>;
  lens: FoundationActivityChildCheckpointLensV7<Parent, Child>;
  assertContext(
    context: FoundationActivityKernelContextV7<Plan, Parent>,
    parent: Parent,
  ): void;
}>): FoundationActivityChildCheckpointAdapterV7<Plan, Parent, Child> {
  const select = (
    context: FoundationActivityKernelContextV7<Plan, Parent>,
  ): FoundationActivityChildCheckpointViewV7<Plan, Parent, Child> => {
    const parent = context.envelope.checkpoint?.value;
    if (parent === undefined) {
      fail("parent", "Child recovery requires one exact parent activity checkpoint");
    }
    input.assertContext(context, parent);
    const selected = input.lens.get(parent);
    return Object.freeze({
      context,
      coordinate: context.coordinate,
      checkpoint: selected === null ? null : input.lens.parse(selected),
    });
  };

  return Object.freeze({
    current: () => select(input.parent.current()),
    async step(
      mutation: FoundationActivityChildCheckpointStepV7<Child>,
    ): Promise<FoundationActivityChildCheckpointStepResultV7<Plan, Parent, Child>> {
      const current = select(input.parent.current());
      if (!sameCoordinate(current.coordinate, mutation.expected)) {
        fail("checkpoint-cas", "Child checkpoint update substituted its exact support generation");
      }
      const parent = current.context.envelope.checkpoint!.value;
      const child = mutation.checkpoint === null ? null : input.lens.parse(mutation.checkpoint);
      const checkpoint = input.lens.set(parent, child);
      const committed = mutation.mode === "checkpoint"
        ? input.parent.commit({
            mode: "support-only",
            expected: current.coordinate,
            checkpoint,
          })
        : mutation.mode === "append"
          ? input.parent.commit({
              mode: "append",
              expected: current.coordinate,
              checkpoint,
              append: mutation.append,
            })
          : await input.parent.commitWithFiles({
              expected: current.coordinate,
              checkpoint,
              append: mutation.append,
              files: mutation.files,
            });
      return Object.freeze({
        view: select(committed.context),
        append: committed.append,
        files: committed.files,
      });
    },
  });
}

/** Add a stricter child parser without creating another parent support owner. */
export function narrowFoundationActivityChildCheckpointAdapterV7<
  Plan extends ControlJsonObject,
  Parent extends ControlJsonObject,
  Child extends ControlJsonObject,
>(input: Readonly<{
  adapter: FoundationActivityChildCheckpointAdapterV7<Plan, Parent, ControlJsonObject>;
  parse(value: ControlJsonObject): Child;
}>): FoundationActivityChildCheckpointAdapterV7<Plan, Parent, Child> {
  const view = (
    current: FoundationActivityChildCheckpointViewV7<Plan, Parent, ControlJsonObject>,
  ): FoundationActivityChildCheckpointViewV7<Plan, Parent, Child> => Object.freeze({
    context: current.context,
    coordinate: current.coordinate,
    checkpoint: current.checkpoint === null ? null : input.parse(current.checkpoint),
  });
  return Object.freeze({
    current: () => view(input.adapter.current()),
    async step(mutation) {
      const checkpoint = mutation.checkpoint === null ? null : input.parse(mutation.checkpoint);
      const committed = await input.adapter.step({ ...mutation, checkpoint });
      return Object.freeze({
        view: view(committed.view),
        append: committed.append,
        files: committed.files,
      });
    },
  });
}
