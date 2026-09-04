import assert from "node:assert/strict";
import test from "node:test";
import type {
  ControlJsonObject,
  ControlRecordFile,
  ControlRecordOperationSupportCoordinate,
  ControlRecordStoreAppend,
  ControlRecordStoreAppendResult,
} from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import {
  createFoundationActivityChildCheckpointAdapterV7,
} from "../../src/foundation/process/activity-child-checkpoint-v7.js";
import type {
  FoundationActivityKernelCheckpointAdapterV7,
  FoundationActivityKernelContextV7,
} from "../../src/foundation/process/activity-kernel-v7.js";
import { digestCanonical } from "../../src/foundation/validation/canonical.js";

type Plan = Readonly<{ schema: "example.plan.v1"; fact: string }>;
type Parent = Readonly<{
  schema: "example.parent.v1";
  sibling: string;
  child: ControlJsonObject | null;
}>;
type Child = Readonly<{ schema: "example.child.v1"; fact: string }>;

const plan: Plan = Object.freeze({ schema: "example.plan.v1", fact: "immutable" });

function parseChild(value: ControlJsonObject): Child {
  if (
    Object.keys(value).sort().join("\0") !== ["fact", "schema"].join("\0") ||
    value.schema !== "example.child.v1" || typeof value.fact !== "string"
  ) {
    throw new FoundationError(
      "lifecycle.test.activity-child-checkpoint.child",
      "Child checkpoint does not have its exact shape",
    );
  }
  return Object.freeze({ schema: "example.child.v1", fact: value.fact });
}

function harness() {
  let generation = 1;
  let parent: Parent = Object.freeze({
    schema: "example.parent.v1",
    sibling: "preserved",
    child: null,
  });
  const calls: string[] = [];
  const coordinate = (): ControlRecordOperationSupportCoordinate => Object.freeze({
    generation,
    payloadDigest: digestCanonical(parent),
  });
  const context = (): FoundationActivityKernelContextV7<Plan, Parent> => ({
    coordinate: coordinate(),
    envelope: Object.freeze({
      plan: Object.freeze({ value: plan, digest: digestCanonical(plan) }),
      checkpoint: Object.freeze({ value: parent, digest: digestCanonical(parent) }),
    }),
  }) as unknown as FoundationActivityKernelContextV7<Plan, Parent>;
  const commit = (input: Readonly<{
    expected: ControlRecordOperationSupportCoordinate;
    checkpoint: ControlJsonObject | null;
    append?: ControlRecordStoreAppend;
    files?: boolean;
  }>) => {
    assert.deepEqual(input.expected, coordinate());
    assert(input.checkpoint !== null);
    parent = input.checkpoint as Parent;
    generation += 1;
    const retained: ControlRecordStoreAppendResult | null = input.append === undefined
      ? null
      : Object.freeze({ revision: null, event: Object.freeze({}) }) as ControlRecordStoreAppendResult;
    const files: readonly ControlRecordFile[] = input.files
      ? Object.freeze([Object.freeze({ digest: digestCanonical({ file: true }) }) as ControlRecordFile])
      : Object.freeze([]);
    return Object.freeze({ context: context(), append: retained, files });
  };
  const kernel = Object.freeze({
    current: context,
    commit(input: Parameters<FoundationActivityKernelCheckpointAdapterV7<Plan, Parent>["commit"]>[0]) {
      calls.push(input.mode);
      return commit({
        expected: input.expected,
        checkpoint: input.checkpoint,
        ...(input.mode === "append" ? { append: input.append } : {}),
      });
    },
    async commitWithFiles(
      input: Parameters<FoundationActivityKernelCheckpointAdapterV7<Plan, Parent>["commitWithFiles"]>[0],
    ) {
      calls.push("append-with-files");
      return commit({
        expected: input.expected,
        checkpoint: input.checkpoint,
        append: input.append,
        files: true,
      });
    },
  }) as FoundationActivityKernelCheckpointAdapterV7<Plan, Parent>;
  const adapter = createFoundationActivityChildCheckpointAdapterV7({
    parent: kernel,
    lens: Object.freeze({
      get: (value: Parent) => value.child,
      set: (value: Parent, child: Child | null): Parent => Object.freeze({ ...value, child }),
      parse: parseChild,
    }),
    assertContext(_context, value) {
      if (value.sibling !== "preserved") {
        throw new FoundationError(
          "lifecycle.test.activity-child-checkpoint.context",
          "Parent semantic coordinate changed",
        );
      }
    },
  });
  return Object.freeze({ adapter, calls, parent: () => parent });
}

test("a typed child step preserves the complete parent checkpoint and immutable plan", async () => {
  const selected = harness();
  const opened = selected.adapter.current();
  const retained = await selected.adapter.step({
    mode: "checkpoint",
    expected: opened.coordinate,
    checkpoint: Object.freeze({ schema: "example.child.v1", fact: "retained" }),
  });
  assert.deepEqual(selected.parent(), {
    schema: "example.parent.v1",
    sibling: "preserved",
    child: { schema: "example.child.v1", fact: "retained" },
  });
  assert.equal(retained.view.context.envelope.plan.value.fact, "immutable");
  assert.equal(retained.view.checkpoint?.fact, "retained");
  assert.deepEqual(selected.calls, ["support-only"]);
});

test("child append and file steps select the parent's atomic commit paths", async () => {
  const selected = harness();
  let view = selected.adapter.current();
  const append = Object.freeze({ event: Object.freeze({}) }) as ControlRecordStoreAppend;
  const appended = await selected.adapter.step({
    mode: "append",
    expected: view.coordinate,
    checkpoint: Object.freeze({ schema: "example.child.v1", fact: "append" }),
    append,
  });
  assert(appended.append !== null);
  view = appended.view;
  const withFiles = await selected.adapter.step({
    mode: "append-with-files",
    expected: view.coordinate,
    checkpoint: Object.freeze({ schema: "example.child.v1", fact: "files" }),
    append,
    files: Object.freeze([Object.freeze({}) as never]),
  });
  assert.equal(withFiles.files.length, 1);
  assert.deepEqual(selected.calls, ["append", "append-with-files"]);
});

test("child steps reject stale coordinates and malformed retained children", async () => {
  const selected = harness();
  const opened = selected.adapter.current();
  await selected.adapter.step({
    mode: "checkpoint",
    expected: opened.coordinate,
    checkpoint: Object.freeze({ schema: "example.child.v1", fact: "first" }),
  });
  await assert.rejects(
    selected.adapter.step({
      mode: "checkpoint",
      expected: opened.coordinate,
      checkpoint: Object.freeze({ schema: "example.child.v1", fact: "stale" }),
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.activity-child-checkpoint-v7.checkpoint-cas",
  );
  await assert.rejects(
    selected.adapter.step({
      mode: "checkpoint",
      expected: selected.adapter.current().coordinate,
      checkpoint: Object.freeze({ schema: "example.child.v1" }) as unknown as Child,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.test.activity-child-checkpoint.child",
  );
});
