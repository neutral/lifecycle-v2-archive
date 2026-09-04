import {
  operateFoundationCheckCellV1,
  type FoundationCheckCellRuntimeV1,
} from "../check/execution-cell-v1.js";
import {
  compileCheckReceiptAppend,
  type CheckReceiptObservation,
  type CompiledCheckReceiptAppend,
} from "../control/check-receipt.js";
import { controlTimestamp } from "../control/model.js";
import type { ControlRecordStore } from "../control/store.js";
import type {
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordEvent,
  ControlRecordRelationshipTarget,
  ControlRecordRevision,
} from "../control/types.js";
import { FoundationError } from "../error.js";
import type { FoundationCheckBinding } from "../repository/types.js";
import {
  createFoundationActivityExecutionCheckpointPersistenceV1,
} from "../execution/activity-checkpoint-persistence-v1.js";
import type {
  FoundationExecutionInputSetV1,
} from "../execution/input-set.js";
import type {
  FoundationExecutionOperationCheckpointV1,
} from "../execution/operation-host.js";
import type {
  FoundationExecutionSpecificationV1,
} from "../execution/contracts.js";
import {
  canonicalJson,
  digestCanonical,
  type Sha256,
} from "../validation/canonical.js";
import type {
  FoundationActivityChildCheckpointAdapterV7,
} from "./activity-child-checkpoint-v7.js";

export const FOUNDATION_CHECK_CELL_OPERATION_V1_CHECKPOINT_SCHEMA =
  "lifecycle.check-cell-operation-checkpoint.v1" as const;

const MAXIMUM_JOURNAL_EVENTS = 100_000;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const BASELINE_OPERATIONS = new Set(["delivery.prepare", "delivery.revise", "delivery.reaffirm"]);

export type FoundationCheckCellOperationCheckpointV1 = Readonly<{
  schema: typeof FOUNDATION_CHECK_CELL_OPERATION_V1_CHECKPOINT_SCHEMA;
  phase: "baseline" | "final";
  selectionId: string;
  bindingId: string;
  proofSubject: ControlRecordRelationshipTarget;
  specificationDigest: Sha256;
  inputSetDigest: Sha256;
  execution: FoundationExecutionOperationCheckpointV1 | null;
}>;

export type FoundationCheckOperationCheckpointV7 = FoundationCheckCellOperationCheckpointV1;

export type FoundationCheckOperationSupportV7<
  Child extends ControlJsonObject = FoundationCheckOperationCheckpointV7,
> = FoundationActivityChildCheckpointAdapterV7<ControlJsonObject, ControlJsonObject, Child>;

export type FoundationOperateCheckV7Input = Readonly<{
  target: string;
  machineHome?: string;
  store: ControlRecordStore;
  activityId: string;
  boundary: ControlRecordRevision;
  selectionId: string;
  bindingId: string;
  binding: FoundationCheckBinding;
  runtimeId: string;
  support: FoundationCheckOperationSupportV7;
  cellRuntime?: FoundationCheckCellRuntimeV1;
}>;

type CheckOwners = Readonly<{
  now(): string;
  compileReceipt(input: Parameters<typeof compileCheckReceiptAppend>[0]): CompiledCheckReceiptAppend;
}>;

export type FoundationOperateCheckV7Options = Partial<CheckOwners>;

type ExactCoordinate = Readonly<{
  phase: "baseline" | "final";
  boundary: ControlRecordRevision;
  proofSubject: ControlRecordRevision;
}>;

type ExactSelection = Readonly<{
  modality: "precondition" | "repair-target" | "regression-guard" | "postcondition" | "diagnostic";
  requestedConditions: readonly string[];
  definition: Readonly<{
    id: string;
    revision: number;
    sourceDigest: Sha256;
    semanticDigest: Sha256;
  }>;
}>;

function fail(
  code: string,
  message: string,
  observedFacts: Readonly<Record<string, unknown>> = {},
): never {
  throw new FoundationError(`lifecycle.check-operation-v7.${code}`, message, { observedFacts });
}

function object(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== "object") {
    fail("retained-fact", `${label} must be one exact object`);
  }
  return value as ControlJsonObject;
}

function array(value: ControlJsonValue | undefined, label: string): readonly ControlJsonValue[] {
  if (!Array.isArray(value)) fail("retained-fact", `${label} must be one exact array`);
  return value;
}

function string(value: ControlJsonValue | undefined, label: string): string {
  if (typeof value !== "string") fail("retained-fact", `${label} must be one exact string`);
  return value;
}

function digest(value: ControlJsonValue | undefined, label: string): Sha256 {
  const selected = string(value, label);
  if (!SHA256_PATTERN.test(selected)) fail("retained-fact", `${label} must be one lowercase SHA-256 digest`);
  return selected as Sha256;
}

function positiveInteger(value: ControlJsonValue | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    fail("retained-fact", `${label} must be one positive safe integer`);
  }
  return value;
}

function reference(revision: ControlRecordRevision): ControlRecordRelationshipTarget {
  return Object.freeze({
    kind: revision.recordKind,
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function parseReference(value: ControlJsonValue | undefined, label: string): ControlRecordRelationshipTarget {
  const selected = object(value, label);
  if (Object.keys(selected).sort().join("\0") !== ["digest", "id", "kind", "revision"].join("\0")) {
    fail("checkpoint", `${label} does not have its exact closed shape`);
  }
  return Object.freeze({
    kind: string(selected.kind, `${label} kind`),
    id: string(selected.id, `${label} identity`),
    revision: positiveInteger(selected.revision, `${label} revision`),
    digest: digest(selected.digest, `${label} digest`),
  });
}

function exactRevision(
  store: ControlRecordStore,
  supplied: ControlRecordRevision,
  kind: string,
  label: string,
): ControlRecordRevision {
  const retained = store.getRevision(supplied.recordId, supplied.revision);
  if (
    retained === null || retained.processId !== store.identity.processId ||
    retained.recordKind !== kind || retained.digest !== supplied.digest ||
    canonicalJson(retained) !== canonicalJson(supplied)
  ) fail("substitution", `${label} is not one exact retained ${kind} revision`);
  return retained;
}

function retainedReference(
  store: ControlRecordStore,
  selected: Readonly<{ id: string; revision: number; digest: Sha256 }> | null,
  kind: string,
  label: string,
): ControlRecordRevision {
  if (selected === null) fail("coordinate", `${label} is absent`);
  const revision = store.getRevision(selected.id, selected.revision);
  if (revision === null || revision.recordKind !== kind || revision.digest !== selected.digest) {
    fail("coordinate", `${label} does not resolve one exact ${kind}`);
  }
  return revision;
}

function relationship(
  revision: ControlRecordRevision,
  relation: string,
  kind: string,
): ControlRecordRelationshipTarget {
  const selected = revision.relationships.filter((entry) => entry.relation === relation);
  if (selected.length !== 1 || selected[0]!.target.kind !== kind) {
    fail("relationship", `${revision.recordKind} must bind one exact ${relation} ${kind}`);
  }
  return selected[0]!.target;
}

function sameReference(left: ControlRecordRelationshipTarget, right: ControlRecordRevision): boolean {
  return canonicalJson(left) === canonicalJson(reference(right));
}

function allEvents(store: ControlRecordStore): readonly ControlRecordEvent[] {
  const events: ControlRecordEvent[] = [];
  let cursor = 0;
  for (;;) {
    const page = store.listEvents(cursor, 10_000);
    events.push(...page);
    if (events.length > MAXIMUM_JOURNAL_EVENTS) fail("journal-bound", "Check inventory exceeds the Journal bound");
    if (page.length < 10_000) return Object.freeze(events);
    cursor = page.at(-1)!.sequence;
  }
}

function eventSubject(store: ControlRecordStore, event: ControlRecordEvent, kind: string): ControlRecordRevision {
  if (event.subject === null) fail("journal", `${event.eventKind} has no exact subject`);
  const revision = store.getRevision(event.subject.recordId, event.subject.revision);
  if (revision === null || revision.recordKind !== kind || revision.digest !== event.subject.digest) {
    fail("journal", `${event.eventKind} does not resolve one exact ${kind}`);
  }
  return revision;
}

function oneActivitySubject(
  store: ControlRecordStore,
  activityId: string,
  eventKind: string,
  kind: string,
): ControlRecordRevision {
  const events = allEvents(store).filter((event) =>
    event.eventKind === eventKind && event.payload.activityId === activityId);
  if (events.length !== 1) fail("journal", `Activity must retain exactly one ${eventKind}`);
  return eventSubject(store, events[0]!, kind);
}

function exactCoordinate(input: FoundationOperateCheckV7Input): ExactCoordinate {
  const suppliedBoundary = exactRevision(input.store, input.boundary, "work-boundary", "Check Work Boundary");
  const activity = input.store.state().activities.find(({ id }) => id === input.activityId);
  if (
    activity === undefined || activity.family !== "agent" || activity.stage !== "finalizing" ||
    activity.recovery?.kind !== "finalization"
  ) fail("coordinate", "Check operation is not at one exact active finalization coordinate");
  if (BASELINE_OPERATIONS.has(activity.operation)) {
    if (
      activity.recovery.resumesAt !== "baseline-checks" &&
      activity.recovery.resumesAt !== "activity-completed"
    ) fail("coordinate", "Baseline Check is not at its execution or post-retention recovery coordinate");
    const boundary = oneActivitySubject(
      input.store,
      input.activityId,
      "work-boundary-finalized",
      "work-boundary",
    );
    if (canonicalJson(boundary) !== canonicalJson(suppliedBoundary)) {
      fail("substitution", "Caller-supplied Boundary differs from the exact finalized Work Boundary");
    }
    return Object.freeze({ phase: "baseline", boundary, proofSubject: boundary });
  }
  if (activity.operation !== "delivery.evaluate" || activity.recovery.resumesAt !== "evaluation-checks") {
    fail("coordinate", "Check operation is neither an exact baseline nor evaluation Check");
  }
  const seal = oneActivitySubject(
    input.store,
    input.activityId,
    "candidate-sealed",
    "candidate-seal",
  );
  const boundary = retainedReference(
    input.store,
    Object.freeze({
      id: relationship(seal, "governed-by", "work-boundary").id,
      revision: relationship(seal, "governed-by", "work-boundary").revision,
      digest: relationship(seal, "governed-by", "work-boundary").digest,
    }),
    "work-boundary",
    "Evaluation Work Boundary",
  );
  if (canonicalJson(boundary) !== canonicalJson(suppliedBoundary)) {
    fail("substitution", "Caller-supplied Boundary differs from the sealed Candidate Boundary");
  }
  return Object.freeze({ phase: "final", boundary, proofSubject: seal });
}

function validateSelection(
  coordinate: ExactCoordinate,
  selectionId: string,
  bindingId: string,
  binding: FoundationCheckBinding,
): ExactSelection {
  const mandate = object(coordinate.boundary.payload.mandate, "Work Boundary mandate");
  const checks = array(mandate.checks, "Work Boundary Checks");
  const selected = checks.map((value) => object(value, "Work Boundary Check"))
    .filter((check) => check.id === selectionId);
  if (selected.length !== 1) fail("selection", `Work Boundary does not select exactly one ${selectionId}`);
  const bindings = array(selected[0]!.bindings, "Work Boundary Check Bindings")
    .map((value) => object(value, "Work Boundary Check Binding"))
    .filter((value) => value.id === bindingId);
  if (bindings.length !== 1) fail("binding", `Work Boundary does not select exactly one ${bindingId}`);
  const selectedBinding = bindings[0]!;
  if (
    binding.id !== bindingId || binding.digest !== selectedBinding.digest ||
    binding.implementationDigest !== selectedBinding.implementationDigest
  ) fail("substitution", "Caller-supplied Check Binding differs from the exact retained selection");
  const modality = string(selected[0]!.modality, "Work Boundary Check modality");
  if (![
    "precondition", "repair-target", "regression-guard", "postcondition", "diagnostic",
  ].includes(modality)) fail("selection", "Work Boundary Check has an unsupported modality");
  if (!binding.allowedModalities.includes(modality as ExactSelection["modality"])) {
    fail("substitution", "Caller-supplied Check Binding does not allow the exact selected modality");
  }
  const definition = object(selected[0]!.definition, "Work Boundary Check Definition");
  const definitionId = string(definition.id, "Work Boundary Check Definition identity");
  if (!binding.checkIds.includes(definitionId)) {
    fail("substitution", "Caller-supplied Check Binding does not bind the selected Check Definition");
  }
  return Object.freeze({
    modality: modality as ExactSelection["modality"],
    requestedConditions: Object.freeze(array(
      selected[0]!.environmentRequirements,
      "Work Boundary Check environment requirements",
    ).map((value) => string(value, "Work Boundary Check environment requirement"))),
    definition: Object.freeze({
      id: definitionId,
      revision: positiveInteger(definition.revision, "Work Boundary Check Definition revision"),
      sourceDigest: digest(definition.sourceDigest, "Work Boundary Check Definition source digest"),
      semanticDigest: digest(definition.semanticDigest, "Work Boundary Check Definition semantic digest"),
    }),
  });
}

export function parseFoundationCheckOperationCheckpointV7(
  value: ControlJsonObject,
): FoundationCheckOperationCheckpointV7 {
  if (value.schema === FOUNDATION_CHECK_CELL_OPERATION_V1_CHECKPOINT_SCHEMA) {
    if (Object.keys(value).sort().join("\0") !== [
      "bindingId", "execution", "inputSetDigest", "phase", "proofSubject", "schema",
      "selectionId", "specificationDigest",
    ].sort().join("\0")) fail("checkpoint", "Check Cell checkpoint does not have its exact closed shape");
    if (!(value.phase === "baseline" || value.phase === "final")) {
      fail("checkpoint", "Check Cell checkpoint must select one exact proof phase");
    }
    if (value.execution !== null && (Array.isArray(value.execution) || typeof value.execution !== "object")) {
      fail("checkpoint", "Check Cell execution checkpoint is invalid");
    }
    return Object.freeze({
      schema: FOUNDATION_CHECK_CELL_OPERATION_V1_CHECKPOINT_SCHEMA,
      phase: value.phase,
      selectionId: string(value.selectionId, "Check Cell checkpoint selection"),
      bindingId: string(value.bindingId, "Check Cell checkpoint Binding"),
      proofSubject: parseReference(value.proofSubject, "Check Cell checkpoint proof subject"),
      specificationDigest: digest(value.specificationDigest, "Check Cell Specification digest"),
      inputSetDigest: digest(value.inputSetDigest, "Check Cell Input Set digest"),
      execution: value.execution as FoundationExecutionOperationCheckpointV1 | null,
    });
  }
  fail(
    "hard-cut",
    "Foundation Check recovery refuses an unsupported Check checkpoint profile",
    { schema: value.schema ?? null },
  );
}

function cellCheckpointValue(input: Readonly<{
  operation: FoundationOperateCheckV7Input;
  coordinate: ExactCoordinate;
  specification: FoundationExecutionSpecificationV1;
  inputSet: FoundationExecutionInputSetV1;
  execution: FoundationExecutionOperationCheckpointV1 | null;
}>): FoundationCheckCellOperationCheckpointV1 {
  return Object.freeze({
    schema: FOUNDATION_CHECK_CELL_OPERATION_V1_CHECKPOINT_SCHEMA,
    phase: input.coordinate.phase,
    selectionId: input.operation.selectionId,
    bindingId: input.operation.bindingId,
    proofSubject: reference(input.coordinate.proofSubject),
    specificationDigest: input.specification.digest,
    inputSetDigest: input.inputSet.digest,
    execution: input.execution,
  });
}

function validateCellCheckpoint(input: Readonly<{
  checkpoint: FoundationCheckCellOperationCheckpointV1;
  operation: FoundationOperateCheckV7Input;
  coordinate: ExactCoordinate;
  specification: FoundationExecutionSpecificationV1;
  inputSet: FoundationExecutionInputSetV1;
}>): void {
  if (
    input.checkpoint.phase !== input.coordinate.phase ||
    input.checkpoint.selectionId !== input.operation.selectionId ||
    input.checkpoint.bindingId !== input.operation.bindingId ||
    !sameReference(input.checkpoint.proofSubject, input.coordinate.proofSubject) ||
    input.checkpoint.specificationDigest !== input.specification.digest ||
    input.checkpoint.inputSetDigest !== input.inputSet.digest
  ) fail("substitution", "Retained Check Cell checkpoint differs from the exact proof obligation");
}

function cellExecutionPersistence(input: Readonly<{
  operation: FoundationOperateCheckV7Input;
  coordinate: ExactCoordinate;
  specification: FoundationExecutionSpecificationV1;
  inputSet: FoundationExecutionInputSetV1;
}>) {
  const executionChild: FoundationCheckOperationSupportV7<FoundationExecutionOperationCheckpointV1> =
    Object.freeze({
      current: () => {
        const selected = input.operation.support.current();
        const checkpoint = selected.checkpoint === null
          ? null
          : parseFoundationCheckOperationCheckpointV7(selected.checkpoint);
        if (checkpoint !== null) {
          validateCellCheckpoint({
            checkpoint,
            operation: input.operation,
            coordinate: input.coordinate,
            specification: input.specification,
            inputSet: input.inputSet,
          });
        }
        return Object.freeze({
          context: selected.context,
          coordinate: selected.coordinate,
          checkpoint: checkpoint?.execution ?? null,
        });
      },
      async step(mutation) {
        const selected = input.operation.support.current();
        const current = selected.checkpoint === null
          ? null
          : parseFoundationCheckOperationCheckpointV7(selected.checkpoint);
        if (current !== null) {
          validateCellCheckpoint({
            checkpoint: current,
            operation: input.operation,
            coordinate: input.coordinate,
            specification: input.specification,
            inputSet: input.inputSet,
          });
        }
        const wrapped = cellCheckpointValue({
          operation: input.operation,
          coordinate: input.coordinate,
          specification: input.specification,
          inputSet: input.inputSet,
          execution: mutation.checkpoint,
        });
        const committed = await input.operation.support.step({ ...mutation, checkpoint: wrapped });
        const next = parseFoundationCheckOperationCheckpointV7(committed.view.checkpoint!);
        return Object.freeze({
          view: Object.freeze({
            context: committed.view.context,
            coordinate: committed.view.coordinate,
            checkpoint: next.execution,
          }),
          append: committed.append,
          files: committed.files,
        });
      },
    });
  return createFoundationActivityExecutionCheckpointPersistenceV1({
    context: input.operation.support.current().context,
    child: executionChild,
    specificationDigest: input.specification.digest,
  });
}

async function operateCheckCell(input: Readonly<{
  operation: FoundationOperateCheckV7Input;
  coordinate: ExactCoordinate;
  selection: ExactSelection;
  existing: ControlRecordRevision | null;
}>): Promise<ControlRecordRevision> {
  const retainedSupport = input.operation.support.current();
  if (input.existing !== null) {
    if (retainedSupport.checkpoint !== null) {
      fail(
        "receipt-support-conflict",
        "Retained Check Receipt cannot coexist with live Execution Cell support",
      );
    }
    return input.existing;
  }
  if (input.operation.machineHome === undefined || input.operation.cellRuntime === undefined) {
    fail(
      "execution-backend-unavailable",
      "Executable Check requires the exact installed Docker Execution Backend and machine custody",
    );
  }
  const candidate = input.coordinate.phase === "final"
    ? (() => {
        const candidateTarget = relationship(
          input.coordinate.proofSubject,
          "seals",
          "candidate-revision",
        );
        return retainedReference(
          input.operation.store,
          Object.freeze({
            id: candidateTarget.id,
            revision: candidateTarget.revision,
            digest: candidateTarget.digest,
          }),
          "candidate-revision",
          "Final Check Candidate Revision",
        );
      })()
    : null;
  const productBase = input.coordinate.phase === "baseline"
    ? (() => {
        const basis = object(input.coordinate.boundary.payload.basis, "Work Boundary basis");
        return Object.freeze({
          repository: input.operation.target,
          commit: string(basis.productBaseCommit, "Work Boundary product-base commit"),
          tree: string(basis.productBaseTree, "Work Boundary product-base tree"),
        });
      })()
    : null;
  const common = {
    machineHome: input.operation.machineHome,
    store: input.operation.store,
    activityId: input.operation.activityId,
    selectionId: input.operation.selectionId,
    bindingId: input.operation.bindingId,
    binding: input.operation.binding,
    definition: input.selection.definition,
    requestedConditions: input.selection.requestedConditions,
    proofSubject: input.coordinate.proofSubject,
    persistence: (
      specification: FoundationExecutionSpecificationV1,
      inputSet: FoundationExecutionInputSetV1,
    ) => cellExecutionPersistence({
      operation: input.operation,
      coordinate: input.coordinate,
      specification,
      inputSet,
    }),
    runtime: input.operation.cellRuntime,
  } as const;
  const operated = input.coordinate.phase === "baseline"
    ? await operateFoundationCheckCellV1({
        ...common,
        phase: "baseline",
        candidate: null,
        productBase: productBase!,
      })
    : await operateFoundationCheckCellV1({
        ...common,
        phase: "final",
        candidate: candidate!,
        productBase: null,
      });
  let support = input.operation.support.current();
  const compiled = compileCheckReceiptAppend({
    store: input.operation.store,
    activityId: input.operation.activityId,
    selectionId: input.operation.selectionId,
    bindingId: input.operation.bindingId,
    observation: operated.observation,
    recordedAt: controlTimestamp(
      input.operation.cellRuntime.clock.now(),
      "Check Receipt retention time",
    ),
    runtimeId: input.operation.runtimeId,
  });
  const result = compiled.files.length === 0
    ? await input.operation.support.step({
        mode: "append",
        expected: support.coordinate,
        checkpoint: null,
        append: compiled.append,
      })
    : await input.operation.support.step({
        mode: "append-with-files",
        expected: support.coordinate,
        checkpoint: null,
        append: compiled.append,
        files: compiled.files,
      });
  if (result.append?.revision === null || result.append?.revision?.digest !== compiled.revision.digest) {
    fail("retention", "Check Receipt, Retirement handoff, and Activity completion did not commit exactly");
  }
  support = result.view;
  if (support.checkpoint !== null) fail("retention", "Check retained live support after Receipt commit");
  return result.append.revision;
}

function retainedReceipt(
  input: FoundationOperateCheckV7Input,
  coordinate: ExactCoordinate,
): ControlRecordRevision | null {
  const matches = allEvents(input.store).filter((event) =>
    event.eventKind === "check-receipt-recorded" && event.payload.activityId === input.activityId)
    .map((event) => eventSubject(input.store, event, "check-receipt"))
    .filter((revision) => revision.payload.selectionId === input.selectionId);
  if (matches.length > 1) fail("receipt", "Activity repeats one exact Check Receipt selection");
  if (matches.length === 0) return null;
  const receipt = matches[0]!;
  if (receipt.payload.phase !== coordinate.phase) fail("receipt", "Retained Check Receipt changes phase");
  const binding = object(receipt.payload.binding, "Retained Check Receipt Binding");
  if (
    binding.id !== input.bindingId || binding.digest !== input.binding.digest ||
    binding.implementationDigest !== input.binding.implementationDigest
  ) fail("receipt", "Retained Check Receipt changes its exact Binding");
  const expectedRelation = coordinate.phase === "baseline" ? "checks-boundary" : "checks-seal";
  if (!sameReference(relationship(receipt, expectedRelation, coordinate.proofSubject.recordKind), coordinate.proofSubject)) {
    fail("receipt", "Retained Check Receipt changes its exact proof subject");
  }
  return receipt;
}

const FOUNDATION_BASELINE_POSTCONDITION_MECHANISM_V1 = Object.freeze({
  runner: Object.freeze({
    id: "foundation-baseline-postcondition-not-run-v1",
    digest: digestCanonical(Object.freeze({
      schema: "lifecycle.check-baseline-postcondition-runner.v1",
      effect: "none",
    })),
  }),
  parser: Object.freeze({
    id: "foundation-baseline-postcondition-parser-v1",
    digest: digestCanonical(Object.freeze({
      schema: "lifecycle.check-baseline-postcondition-parser.v1",
      disposition: "not-run",
    })),
  }),
});

function baselinePostconditionObservation(selection: ExactSelection): CheckReceiptObservation {
  return Object.freeze({
    startedAt: null,
    finishedAt: null,
    environment: Object.freeze({
      identityDigest: digestCanonical(Object.freeze({
        schema: "lifecycle.check-baseline-postcondition-environment.v1",
        requestedConditions: selection.requestedConditions,
      })),
      runtimeEnforced: Object.freeze([]),
      founderManaged: Object.freeze([...selection.requestedConditions]),
    }),
    disposition: "not-run",
    resultFacts: Object.freeze([Object.freeze({
      name: "authorization",
      value: "baseline-postcondition",
    })]),
    reasonCode: "baseline-postcondition",
    notRunAuthorization: null,
    operationalFailure: null,
    execution: Object.freeze({ allocation: "not-allocated" }),
    rawMaterials: Object.freeze([]),
    subjectIntegrity: "unverified",
    containment: Object.freeze({ classification: "not-required", factsDigest: null }),
    retirement: Object.freeze({ classification: "not-required", factsDigest: null }),
    runner: FOUNDATION_BASELINE_POSTCONDITION_MECHANISM_V1.runner,
    parser: FOUNDATION_BASELINE_POSTCONDITION_MECHANISM_V1.parser,
    limitations: Object.freeze(["Baseline postconditions are authorized non-executions."]),
  });
}

function owners(options: FoundationOperateCheckV7Options): CheckOwners {
  return Object.freeze({
    now: options.now ?? (() => new Date().toISOString()),
    compileReceipt: typeof options.compileReceipt === "function"
      ? options.compileReceipt
      : compileCheckReceiptAppend,
  });
}

/**
 * Operate one exact baseline or final Check through the existing Activity's
 * child checkpoint. Executed Checks use one Specification and one permanently
 * non-redispatchable Cell Handle. An authorized baseline postcondition retains
 * `not-run` before Specification compilation or Backend allocation.
 */
export async function operateFoundationCheckV7(
  input: FoundationOperateCheckV7Input,
  options: FoundationOperateCheckV7Options = {},
): Promise<ControlRecordRevision> {
  const selectedOwners = owners(options);
  const coordinate = exactCoordinate(input);
  const selection = validateSelection(coordinate, input.selectionId, input.bindingId, input.binding);
  let support = input.support.current();
  const existing = retainedReceipt(input, coordinate);
  if (existing !== null) {
    if (support.checkpoint !== null) {
      fail("receipt-support-conflict", "Retained Check Receipt cannot coexist with live support");
    }
    return existing;
  }
  if (coordinate.phase === "baseline" && selection.modality === "postcondition") {
    if (support.checkpoint !== null) {
      fail(
        "postcondition-support",
        "Baseline postcondition cannot retain or resume Execution Cell support",
      );
    }
    const compiled = selectedOwners.compileReceipt({
      store: input.store,
      activityId: input.activityId,
      selectionId: input.selectionId,
      bindingId: input.bindingId,
      observation: baselinePostconditionObservation(selection),
      recordedAt: controlTimestamp(selectedOwners.now(), "Check Receipt retention time"),
      runtimeId: input.runtimeId,
    });
    if (compiled.files.length !== 0) fail("raw-material", "Baseline postcondition cannot retain raw material");
    const result = await input.support.step({
      mode: "append",
      expected: support.coordinate,
      checkpoint: null,
      append: compiled.append,
    });
    if (result.append?.revision === null || result.append?.revision?.digest !== compiled.revision.digest) {
      fail("retention", "Baseline postcondition Receipt did not commit atomically");
    }
    return result.append.revision;
  }
  return await operateCheckCell({ operation: input, coordinate, selection, existing });
}
