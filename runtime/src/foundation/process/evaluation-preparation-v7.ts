import { sealDeliveryCandidate } from "../candidate/sealer.js";
import {
  FOUNDATION_WORK_BOUNDARY_PAYLOAD_SCHEMA,
} from "../constants.js";
import { createDeliveryActivityId } from "../control/activity.js";
import type { AgentAttemptInvestment } from "../control/agent-attempt.js";
import type { WorkBoundaryKnowledgeFact } from "../control/work-boundary.js";
import { compileDelegatedAgentActivityOpening } from "../control/director-brief.js";
import type { WorkDelegationReservation } from "../control/work-delegation.js";
import { controlIdentifier, controlTimestamp } from "../control/model.js";
import type { ControlRecordStore } from "../control/store.js";
import type {
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordEvent,
  ControlRecordOperationSupportCoordinate,
  ControlRecordRevision,
} from "../control/types.js";
import { FoundationError } from "../error.js";
import type {
  FoundationCheckBinding,
  FoundationRepositoryContract,
} from "../repository/types.js";
import type { Sha256 } from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import type { FoundationCheckCellOperatorV1 } from "../check/execution-cell-v1.js";
import {
  compileFoundationReviewActivityOpeningV7,
  createFoundationAgentRoleCheckpointAdapterV7,
  narrowFoundationAgentRoleCheckpointAdapterV7,
  openFoundationReviewAgentActivityV7,
} from "./agent-operation-v7.js";
import {
  FOUNDATION_CHECK_CELL_OPERATION_V1_CHECKPOINT_SCHEMA,
  operateFoundationCheckV7,
  parseFoundationCheckOperationCheckpointV7,
  type FoundationCheckOperationCheckpointV7,
  type FoundationOperateCheckV7Options,
} from "./check-operation-v7.js";

type RevisionReference = Readonly<{
  id: string;
  revision: number;
  digest: Sha256;
}>;

export type FinalCheckSelection = Readonly<{
  id: string;
  definitionId: string;
  definition: WorkBoundaryKnowledgeFact;
  bindingId: string;
  binding: FoundationCheckBinding;
}>;

type EvaluationPreparationOwners = Readonly<{
  now(): string;
  createActivityId(): string;
  sealCandidate: typeof sealDeliveryCandidate;
  operateCheck: typeof operateFoundationCheckV7;
}>;

export type FoundationEvaluationPreparationV7Options = Readonly<{
  now?: () => string;
  createActivityId?: () => string;
  sealCandidate?: typeof sealDeliveryCandidate;
  operateCheck?: typeof operateFoundationCheckV7;
  checkOperation?: FoundationOperateCheckV7Options;
  /** @internal Exact installed execution composition for sealed Checks. */
  checkCellOperator?: FoundationCheckCellOperatorV1;
}>;

export type FoundationEvaluationPreparationV7Input = Readonly<{
  target: string;
  machineHome: string;
  store: ControlRecordStore;
  contract: FoundationRepositoryContract;
  semanticMarkdown: string;
  directorId: string;
  agentId: string;
  investment: AgentAttemptInvestment;
  runtimeId: string;
  reservation?: WorkDelegationReservation;
}>;

export type FoundationEvaluationPreparationRecoveryV7Input = Readonly<{
  target: string;
  machineHome: string;
  store: ControlRecordStore;
  contract: FoundationRepositoryContract;
  activityId: string;
  runtimeId: string;
}>;

export type FoundationEvaluationPreparationV7Result = Readonly<{
  activityId: string;
  boundary: RevisionReference;
  candidate: RevisionReference;
  seal: RevisionReference;
  finalChecks: readonly RevisionReference[];
  reviewSupport: ControlRecordOperationSupportCoordinate;
}>;

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const EVALUATION_SEAL_CHECKPOINT_SCHEMA =
  "lifecycle.evaluation-seal-checkpoint.v1" as const;

type EvaluationSealCheckpoint = Readonly<{
  schema: typeof EVALUATION_SEAL_CHECKPOINT_SCHEMA;
  sealedAt: string;
}>;

type EvaluationPreparationCheckpoint =
  | EvaluationSealCheckpoint
  | FoundationCheckOperationCheckpointV7;

function fail(
  code: string,
  message: string,
  observedFacts: Readonly<Record<string, unknown>> = {},
): never {
  throw new FoundationError(`lifecycle.evaluation-preparation-v7.${code}`, message, {
    observedFacts,
  });
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

function boolean(value: ControlJsonValue | undefined, label: string): boolean {
  if (typeof value !== "boolean") fail("retained-fact", `${label} must be one exact boolean`);
  return value;
}

function digest(value: ControlJsonValue | undefined, label: string): Sha256 {
  const selected = string(value, label);
  if (!DIGEST.test(selected)) fail("retained-fact", `${label} must be one lowercase SHA-256 digest`);
  return selected as Sha256;
}

function reference(revision: ControlRecordRevision): RevisionReference {
  return Object.freeze({
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function sameReference(
  left: RevisionReference | null,
  right: ControlRecordRevision,
): boolean {
  return left !== null && left.id === right.recordId &&
    left.revision === right.revision && left.digest === right.digest;
}

function currentRevision(
  store: ControlRecordStore,
  kind: "work-boundary" | "candidate-revision" | "candidate-seal",
): ControlRecordRevision {
  const state = store.state();
  const selected = kind === "work-boundary"
    ? state.subjects.activeBoundary
    : kind === "candidate-revision"
      ? state.subjects.candidate
      : state.subjects.seal;
  if (selected === null) fail("current-subject", `Evaluation preparation requires one current ${kind}`);
  const revision = store.getRevision(selected.id, selected.revision);
  if (revision === null || revision.recordKind !== kind || revision.digest !== selected.digest) {
    fail("current-subject", `Current ${kind} does not resolve to one exact retained revision`);
  }
  return revision;
}

function candidateBase(candidate: ControlRecordRevision): string {
  if (
    candidate.payload.schema !== "lifecycle.candidate-revision-payload.v3" ||
    candidate.payload.state === null || Array.isArray(candidate.payload.state) ||
    typeof candidate.payload.state !== "object"
  ) {
    fail("candidate-invalid", "Evaluation preparation requires one exact reconstructible Candidate Revision");
  }
  const base = string(candidate.payload.candidateBaseCommit, "Candidate immutable base commit");
  if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(base)) {
    fail("candidate-base", "Candidate immutable base must be one full Git object identity");
  }
  return base;
}

function assertContractBasis(
  store: ControlRecordStore,
  contract: FoundationRepositoryContract,
  boundary: ControlRecordRevision,
): void {
  if (contract.targetId !== store.identity.targetId) {
    fail("target", "Repository contract and Delivery Store target identities differ");
  }
  if (
    boundary.payload.schema !== FOUNDATION_WORK_BOUNDARY_PAYLOAD_SCHEMA ||
    boundary.payload.targetId !== store.identity.targetId
  ) {
    fail("boundary", "Active Work Boundary is not one Foundation Boundary for this target");
  }
  const basis = object(boundary.payload.basis, "Work Boundary basis");
  if (basis.repositoryContractDigest !== contract.digest) {
    fail("repository-drift", "Repository contract differs from the active Work Boundary basis");
  }
}

/** The same exact final-Check selection feeds reservation and actual evaluation. */
export function finalCheckSelections(
  boundary: ControlRecordRevision,
  contract: FoundationRepositoryContract,
): readonly FinalCheckSelection[] {
  const mandate = object(boundary.payload.mandate, "Work Boundary mandate");
  const ids = new Set<string>();
  const selections: FinalCheckSelection[] = [];
  for (const value of array(mandate.checks, "Work Boundary Checks")) {
    const check = object(value, "Work Boundary Check");
    if (!boolean(check.finalRequired, "Work Boundary final-Check requirement")) continue;
    const id = controlIdentifier(string(check.id, "Work Boundary Check identity"), "Work Boundary Check identity");
    if (ids.has(id)) fail("check-selection", `Work Boundary repeats final Check selection ${id}`);
    ids.add(id);
    const definition = object(check.definition, "Work Boundary Check Definition");
    const definitionId = controlIdentifier(
      string(definition.id, "Work Boundary Check Definition identity"),
      "Work Boundary Check Definition identity",
    );
    if (typeof definition.revision !== "number" || !Number.isSafeInteger(definition.revision) || definition.revision < 1) {
      fail("check-selection", "A final Check requires its exact positive Definition revision");
    }
    const definitionReference = Object.freeze({ id: definitionId, revision: definition.revision,
      sourceDigest: digest(definition.sourceDigest, "Check Definition source digest"),
      semanticDigest: digest(definition.semanticDigest, "Check Definition semantic digest") });
    const bindings = array(check.bindings, "Work Boundary Check Bindings");
    if (bindings.length !== 1) {
      fail(
        "check-binding-cardinality",
        "Each final Check selection requires exactly one retained Check Binding under the current Check Receipt contract",
        { selectionId: id, observedBindings: bindings.length },
      );
    }
    const selected = object(bindings[0], "Work Boundary Check Binding");
    const bindingId = controlIdentifier(
      string(selected.id, "Work Boundary Check Binding identity"),
      "Work Boundary Check Binding identity",
    );
    const binding = contract.checkBindings[bindingId];
    if (
      binding === undefined || binding.id !== bindingId ||
      binding.digest !== digest(selected.digest, "Work Boundary Check Binding digest") ||
      binding.implementationDigest !== digest(
        selected.implementationDigest,
        "Work Boundary Check Binding implementation digest",
      ) ||
      !binding.checkIds.includes(definitionId)
    ) {
      fail("check-binding", `Final Check selection ${id} does not bind one exact registered mechanism`);
    }
    selections.push(Object.freeze({ id, definitionId, definition: definitionReference, bindingId, binding }));
  }
  if (selections.length < 1) fail("final-checks", "Evaluation requires at least one final Check selection");
  return Object.freeze(selections.sort((left, right) => compareCodePoints(left.id, right.id)));
}

function allEvents(store: ControlRecordStore): readonly ControlRecordEvent[] {
  const events: ControlRecordEvent[] = [];
  let after = 0;
  for (;;) {
    const page = store.listEvents(after, 10_000);
    events.push(...page);
    if (page.length < 10_000) return Object.freeze(events);
    after = page.at(-1)!.sequence;
    if (events.length > 100_000) fail("journal", "Evaluation Journal lookup exceeds its fixed bound");
  }
}

function exactEventRevision(
  store: ControlRecordStore,
  event: ControlRecordEvent,
  kind: "candidate-seal" | "check-receipt",
): ControlRecordRevision {
  if (event.subject === null) fail("journal", `${event.eventKind} lacks its exact subject`);
  const revision = store.getRevision(event.subject.recordId, event.subject.revision);
  if (revision === null || revision.recordKind !== kind || revision.digest !== event.subject.digest) {
    fail("journal", `${event.eventKind} does not resolve one exact retained ${kind}`);
  }
  return revision;
}

function retainedFinalChecks(
  store: ControlRecordStore,
  activityId: string,
  selections: readonly FinalCheckSelection[],
): ReadonlyMap<string, ControlRecordRevision> {
  const expected = new Map(selections.map((selection) => [selection.id, selection]));
  const retained = new Map<string, ControlRecordRevision>();
  for (const event of allEvents(store)) {
    if (event.eventKind !== "check-receipt-recorded" || event.payload.activityId !== activityId) continue;
    const revision = exactEventRevision(store, event, "check-receipt");
    const phase = string(revision.payload.phase, "Evaluation Check Receipt phase");
    const selectionId = controlIdentifier(
      string(revision.payload.selectionId, "Evaluation Check selection identity"),
      "Evaluation Check selection identity",
    );
    const binding = object(revision.payload.binding, "Evaluation Check Receipt Binding");
    const bindingId = controlIdentifier(
      string(binding.id, "Evaluation Check Receipt Binding identity"),
      "Evaluation Check Receipt Binding identity",
    );
    if (
      phase !== "final" || expected.get(selectionId)?.bindingId !== bindingId ||
      retained.has(selectionId)
    ) {
      fail("check-receipt", "Evaluation activity contains an unexpected or duplicate final Check Receipt");
    }
    retained.set(selectionId, revision);
  }
  return retained;
}

function activity(
  store: ControlRecordStore,
  activityId: string,
): ReturnType<ControlRecordStore["state"]>["activities"][number] {
  const selected = store.state().activities.filter(({ id }) => id === activityId);
  if (selected.length !== 1 || selected[0]!.operation !== "delivery.evaluate" || selected[0]!.family !== "agent") {
    fail("activity", "Evaluation preparation requires one exact active evaluation activity");
  }
  if (selected[0]!.stage === "completed") fail("activity", "Completed evaluation cannot be prepared again");
  return selected[0]!;
}

function owners(
  options: FoundationEvaluationPreparationV7Options,
): EvaluationPreparationOwners {
  return Object.freeze({
    now: options.now ?? (() => new Date().toISOString()),
    createActivityId: options.createActivityId ?? (() => createDeliveryActivityId("delivery.evaluate")),
    sealCandidate: options.sealCandidate ?? sealDeliveryCandidate,
    operateCheck: options.operateCheck ?? operateFoundationCheckV7,
  });
}

function sampleTime(selected: EvaluationPreparationOwners, label: string): string {
  return controlTimestamp(selected.now(), label);
}

function sealCheckpoint(sealedAt: string): EvaluationSealCheckpoint {
  return Object.freeze({
    schema: EVALUATION_SEAL_CHECKPOINT_SCHEMA,
    sealedAt,
  });
}

function parseSealCheckpoint(value: ControlJsonObject): EvaluationSealCheckpoint {
  if (
    Object.keys(value).sort().join("\0") !==
      ["schema", "sealedAt"].sort().join("\0") ||
    value.schema !== EVALUATION_SEAL_CHECKPOINT_SCHEMA
  ) {
    fail("checkpoint", "Evaluation Seal checkpoint does not have its exact closed shape");
  }
  return Object.freeze({
    schema: EVALUATION_SEAL_CHECKPOINT_SCHEMA,
    sealedAt: controlTimestamp(
      string(value.sealedAt, "Evaluation Candidate Seal time"),
      "Evaluation Candidate Seal time",
    ),
  });
}

function parseEvaluationPreparationCheckpoint(
  value: ControlJsonObject,
): EvaluationPreparationCheckpoint {
  if (value.schema === EVALUATION_SEAL_CHECKPOINT_SCHEMA) {
    return parseSealCheckpoint(value);
  }
  if (value.schema === FOUNDATION_CHECK_CELL_OPERATION_V1_CHECKPOINT_SCHEMA) {
    return parseFoundationCheckOperationCheckpointV7(value);
  }
  return fail(
    "checkpoint",
    "Evaluation preparation checkpoint does not select the Seal or final-Check owner",
  );
}

async function resume(input: Readonly<{
  target: string;
  machineHome: string;
  store: ControlRecordStore;
  contract: FoundationRepositoryContract;
  activityId: string;
  runtimeId: string;
  owners: EvaluationPreparationOwners;
  checkOperation: FoundationOperateCheckV7Options;
  checkCellOperator?: FoundationCheckCellOperatorV1;
}>): Promise<FoundationEvaluationPreparationV7Result> {
  const activityId = controlIdentifier(input.activityId, "Evaluation activity identity");
  let currentActivity = activity(input.store, activityId);
  const boundary = currentRevision(input.store, "work-boundary");
  const candidate = currentRevision(input.store, "candidate-revision");
  candidateBase(candidate);
  assertContractBasis(input.store, input.contract, boundary);
  const selections = finalCheckSelections(boundary, input.contract);
  const preparationSupport = createFoundationAgentRoleCheckpointAdapterV7({
    store: input.store,
    activityId,
    operation: "delivery.evaluate",
    scope: "review-preparation",
    parseCheckpoint: parseEvaluationPreparationCheckpoint,
  });
  const sealSupport = narrowFoundationAgentRoleCheckpointAdapterV7(
    preparationSupport,
    parseSealCheckpoint,
  );

  if (
    currentActivity.recovery?.kind === "finalization" &&
    currentActivity.recovery.resumesAt === "candidate-sealed"
  ) {
    if (currentActivity.stage !== "started") {
      fail("activity", "Candidate sealing requires the exact started evaluation coordinate");
    }
    let retainedSupport = sealSupport.current();
    let sealedAt: string;
    if (retainedSupport.checkpoint === null) {
      sealedAt = sampleTime(input.owners, "Evaluation Candidate Seal time");
      const checkpoint = sealCheckpoint(sealedAt);
      const committed = await sealSupport.step({
        mode: "checkpoint",
        expected: retainedSupport.coordinate,
        checkpoint,
      });
      retainedSupport = committed.view;
    } else {
      sealedAt = retainedSupport.checkpoint.sealedAt;
    }
    await input.owners.sealCandidate({
      store: input.store,
      activityId,
      machineHome: input.machineHome,
      targetRepository: input.target,
      contract: input.contract,
      sealedAt,
      runtimeId: input.runtimeId,
    });
    currentActivity = activity(input.store, activityId);
  }

  if (
    currentActivity.recovery?.kind !== "finalization" ||
    currentActivity.recovery.resumesAt !== "evaluation-checks" ||
    currentActivity.stage !== "finalizing"
  ) {
    fail(
      "recovery-coordinate",
      "Evaluation preparation can resume only Candidate sealing or the exact final Check set",
      { resumesAt: currentActivity.recovery?.resumesAt ?? null },
    );
  }
  const seal = currentRevision(input.store, "candidate-seal");
  if (!sameReference(input.store.state().subjects.activeBoundary, boundary) ||
      !sameReference(input.store.state().subjects.candidate, candidate) ||
      !sameReference(input.store.state().subjects.seal, seal)) {
    fail("subject-drift", "Evaluation subjects changed while preparing exact proof");
  }

  const afterSeal = preparationSupport.current();
  if (afterSeal.checkpoint?.schema === EVALUATION_SEAL_CHECKPOINT_SCHEMA) {
    await sealSupport.step({
      mode: "checkpoint",
      expected: afterSeal.coordinate,
      checkpoint: null,
    });
  }

  const checkSupport = narrowFoundationAgentRoleCheckpointAdapterV7(
    preparationSupport,
    parseFoundationCheckOperationCheckpointV7,
  );

  const retained = new Map(retainedFinalChecks(input.store, activityId, selections));
  for (const selection of selections) {
    if (retained.has(selection.id)) continue;
    const revision = await input.owners.operateCheck({
      target: input.target,
      machineHome: input.machineHome,
      store: input.store,
      activityId,
      boundary,
      selectionId: selection.id,
      bindingId: selection.bindingId,
      binding: selection.binding,
      runtimeId: input.runtimeId,
      support: checkSupport,
      cellOperator: input.checkCellOperator,
    }, input.checkOperation);
    if (
      revision.recordKind !== "check-receipt" || revision.payload.phase !== "final" ||
      revision.payload.selectionId !== selection.id
    ) {
      fail("check-retention", "Final Check owner returned a different retained Check Receipt");
    }
    retained.set(selection.id, revision);
  }

  const reproduced = retainedFinalChecks(input.store, activityId, selections);
  if (
    reproduced.size !== selections.length ||
    selections.some(({ id }) => !reproduced.has(id))
  ) {
    fail("final-checks", "Evaluation did not retain every-and-only required final Check Receipt");
  }
  const finalChecks = Object.freeze(selections.map(({ id }) => reference(reproduced.get(id)!)));
  return Object.freeze({
    activityId,
    boundary: reference(boundary),
    candidate: reference(candidate),
    seal: reference(seal),
    finalChecks,
    reviewSupport: checkSupport.current().coordinate,
  });
}

/**
 * Open one fresh evaluation and durably prepare its exact Seal and complete
 * final Check set. Reviewer Attempt preparation is the next legal boundary.
 */
export async function prepareDeliveryEvaluationV7(
  input: FoundationEvaluationPreparationV7Input,
  options: FoundationEvaluationPreparationV7Options = {},
): Promise<FoundationEvaluationPreparationV7Result> {
  const selected = owners(options);
  const state = input.store.state();
  if (!state.eligibleOperations.includes("delivery.evaluate")) {
    fail("eligibility", "delivery.evaluate is not eligible at the exact Journal head");
  }
  const boundary = currentRevision(input.store, "work-boundary");
  const candidate = currentRevision(input.store, "candidate-revision");
  assertContractBasis(input.store, input.contract, boundary);
  finalCheckSelections(boundary, input.contract);
  candidateBase(candidate);
  const activityId = controlIdentifier(input.reservation !== undefined && options.createActivityId === undefined
    ? input.reservation.activityId : selected.createActivityId(), "Evaluation activity identity");
  const freshSubmittedAt = input.reservation === undefined ? sampleTime(selected, "Evaluation Director Brief time") : null;
  const startedAt = sampleTime(selected, "Evaluation activity start time");
  const standing = input.reservation === undefined ? null : compileDelegatedAgentActivityOpening({
    store: input.store, activityId, operation: "delivery.evaluate", reservation: input.reservation, startedAt, runtimeId: input.runtimeId,
  });
  const submittedAt = standing?.revision.createdAt ?? freshSubmittedAt!;
  const opening = compileFoundationReviewActivityOpeningV7({
    store: input.store,
    activityId,
    runtimeId: input.runtimeId,
    agentId: input.agentId,
    opening: Object.freeze({
      semanticMarkdown: input.semanticMarkdown,
      submittedAt,
      startedAt,
      directorId: input.directorId,
      ...(input.reservation === undefined ? {} : { reservation: input.reservation }),
    }),
    boundary,
    candidate,
    investment: input.investment,
  });
  openFoundationReviewAgentActivityV7(input.store, activityId, opening);
  return resume({
    ...input,
    activityId,
    owners: selected,
    checkOperation: options.checkOperation ?? Object.freeze({}),
    checkCellOperator: options.checkCellOperator,
  });
}

/** Resume only the exact open evaluation Seal-or-final-Check coordinate. */
export async function recoverDeliveryEvaluationPreparationV7(
  input: FoundationEvaluationPreparationRecoveryV7Input,
  options: FoundationEvaluationPreparationV7Options = {},
): Promise<FoundationEvaluationPreparationV7Result> {
  return resume({
    ...input,
    owners: owners(options),
    checkOperation: options.checkOperation ?? Object.freeze({}),
    checkCellOperator: options.checkCellOperator,
  });
}
