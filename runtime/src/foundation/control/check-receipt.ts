import { FoundationError } from "../error.js";
import type {
  FoundationExecutionBackendProfileReferenceV1,
  FoundationExecutionImageReferenceV1,
  FoundationExecutionInputSetReferenceV1,
} from "../execution/contracts.js";
import {
  canonicalJson,
  digestCanonical,
  type Sha256,
} from "../validation/canonical.js";
import {
  compareCodePoints,
  sortUniqueCodePoints,
} from "../validation/ordering.js";
import { assertDeliveryControlRecordPolicy } from "./kind-registry.js";
import {
  compileControlRecordRevision,
  controlIdentifier,
  controlRecordKind,
  controlTimestamp,
} from "./model.js";
import { assertDeliveryControlRecordPayload } from "./payload-registry.js";
import {
  compileControlRecordFile,
  type ControlRecordStore,
} from "./store.js";
import type {
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordEvent,
  ControlRecordFileInput,
  ControlRecordRelationship,
  ControlRecordRelationshipTarget,
  ControlRecordStoreAppend,
  ControlRecordRevision,
} from "./types.js";

export type CheckReceiptPhase = "baseline" | "final";
export type CheckReceiptModality =
  | "precondition"
  | "repair-target"
  | "regression-guard"
  | "postcondition"
  | "diagnostic";
export type CheckReceiptDisposition =
  | "pass"
  | "fail"
  | "indeterminate"
  | "not-run"
  | "unsupported"
  | "operational-error";

export type CheckReceiptResultFact = Readonly<{
  name: string;
  value: string | number | boolean | null;
}>;

export type CheckReceiptRawMaterial =
  | Readonly<{ availability: "retained"; file: ControlRecordFileInput }>
  | Readonly<{ availability: "not-retained" | "unavailable"; purpose: string }>;

export type CheckReceiptNotRunAuthorization =
  | Readonly<{ kind: "baseline-postcondition" }>
  | CheckReceiptUpstreamConditionAuthorization;

export type CheckReceiptUpstreamConditionAuthorization = Readonly<{
  kind: "upstream-condition";
  conditionId: string;
  conditionDigest: Sha256;
}>;

export type CheckReceiptOperationalFailure = Readonly<{
  stage: string;
  code: string;
  factsDigest: Sha256;
}>;

export type CheckReceiptExecutionOutput =
  | Readonly<{
      availability: "retrieved";
      carrierByteLength: number;
      carrierDigest: Sha256;
      manifestDigest: Sha256;
    }>
  | Readonly<{
      availability: "not-produced" | "unavailable";
      carrierByteLength: null;
      carrierDigest: null;
      manifestDigest: null;
    }>;

export type CheckReceiptExecution =
  | Readonly<{
      allocation: "allocated";
      backendProfile: FoundationExecutionBackendProfileReferenceV1;
      image: FoundationExecutionImageReferenceV1;
      inputSet: FoundationExecutionInputSetReferenceV1;
      specificationDigest: Sha256;
      runnerDigest: Sha256;
      observationDigest: Sha256;
      output: CheckReceiptExecutionOutput;
      exitCode: number | null;
      signal: string | null;
      timedOut: boolean;
      parserDisposition: "passed" | "failed" | "not-run";
    }>
  | Readonly<{ allocation: "not-allocated" }>;

export type CheckReceiptContainment =
  | Readonly<{ classification: "contained"; factsDigest: Sha256 }>
  | Readonly<{ classification: "not-required"; factsDigest: null }>;

export type CheckReceiptRetirement =
  | Readonly<{ classification: "retired"; factsDigest: Sha256 }>
  | Readonly<{ classification: "not-required"; factsDigest: null }>;

export type CheckReceiptObservation = Readonly<{
  startedAt: string | null;
  finishedAt: string | null;
  environment: Readonly<{
    identityDigest: Sha256;
    runtimeEnforced: readonly string[];
    founderManaged: readonly string[];
  }>;
  disposition: CheckReceiptDisposition;
  resultFacts: readonly CheckReceiptResultFact[];
  reasonCode: string | null;
  notRunAuthorization: CheckReceiptUpstreamConditionAuthorization | null;
  operationalFailure: CheckReceiptOperationalFailure | null;
  execution: CheckReceiptExecution;
  rawMaterials?: readonly CheckReceiptRawMaterial[];
  subjectIntegrity: "unchanged" | "changed" | "unverified";
  containment: CheckReceiptContainment;
  retirement: CheckReceiptRetirement;
  runner: Readonly<{ id: string; digest: Sha256 }>;
  parser: Readonly<{ id: string; digest: Sha256 }>;
  limitations?: readonly string[];
}>;

type CheckSelection = Readonly<{
  value: ControlJsonObject;
  id: string;
  definition: ControlJsonObject;
  bindings: readonly ControlJsonObject[];
  modality: CheckReceiptModality;
  requestedConditions: readonly string[];
}>;

type CheckCoordinate = Readonly<{
  phase: CheckReceiptPhase;
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision | null;
  seal: ControlRecordRevision | null;
  proofSubject: ControlRecordRevision;
}>;

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SINGLE_LINE_PATTERN = /^[^\u0000-\u001f\u007f-\u009f\u2028\u2029]+$/u;
const SIGNAL_PATTERN = /^[A-Z0-9]+$/u;
const BASELINE_OPERATIONS = Object.freeze([
  "delivery.prepare",
  "delivery.revise",
  "delivery.reaffirm",
] as const);
const MODALITIES = Object.freeze([
  "precondition",
  "repair-target",
  "regression-guard",
  "postcondition",
  "diagnostic",
] as const);
const DISPOSITIONS = Object.freeze([
  "pass",
  "fail",
  "indeterminate",
  "not-run",
  "unsupported",
  "operational-error",
] as const);

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.control-check-receipt.${code}`, message);
}

function object(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== "object") {
    fail("retained-fact", `${label} must be one exact retained object`);
  }
  return value as ControlJsonObject;
}

function array(value: ControlJsonValue | undefined, label: string): readonly ControlJsonValue[] {
  if (!Array.isArray(value)) fail("retained-fact", `${label} must be one exact retained array`);
  return value;
}

function string(value: ControlJsonValue | undefined, label: string): string {
  if (typeof value !== "string") fail("retained-fact", `${label} must be one exact retained string`);
  return value;
}

function digest(value: unknown, label: string): Sha256 {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail("digest", `${label} must be one lowercase SHA-256 digest`);
  }
  return value as Sha256;
}

function positiveInteger(value: ControlJsonValue | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    fail("retained-fact", `${label} must be one positive safe integer`);
  }
  return value;
}

function singleLine(value: string, label: string): string {
  if (
    value.length < 1 || value.length > 1_024 ||
    Buffer.byteLength(value, "utf8") > 4_096 ||
    !SINGLE_LINE_PATTERN.test(value)
  ) {
    fail("text", `${label} must be one bounded printable line`);
  }
  return value;
}

function exactStringSet(
  values: readonly string[],
  label: string,
  maximum = 128,
): readonly string[] {
  if (!Array.isArray(values) || values.length > maximum) {
    fail("bound", `${label} exceeds the bounded Check Receipt profile`);
  }
  return Object.freeze(sortUniqueCodePoints(values.map((value) => {
    if (typeof value !== "string") fail("text", `${label} must contain only text`);
    return singleLine(value, label);
  })));
}

function reference(revision: ControlRecordRevision): ControlRecordRelationshipTarget {
  return Object.freeze({
    kind: revision.recordKind,
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function sameReference(
  left: Readonly<{ id: string; revision: number; digest: Sha256 }> | null,
  right: ControlRecordRevision,
): boolean {
  return left !== null && left.id === right.recordId && left.revision === right.revision &&
    left.digest === right.digest;
}

function allEvents(store: ControlRecordStore): readonly ControlRecordEvent[] {
  const events: ControlRecordEvent[] = [];
  let cursor = 0;
  for (;;) {
    const page = store.listEvents(cursor, 10_000);
    events.push(...page);
    if (page.length < 10_000) return Object.freeze(events);
    cursor = page.at(-1)!.sequence;
    if (events.length > 100_000) fail("journal", "Check Receipt lookup exceeds the Journal bound");
  }
}

function exactRetainedSubject(
  store: ControlRecordStore,
  event: ControlRecordEvent,
  expectedKind: string,
): ControlRecordRevision {
  if (event.subject === null) fail("journal", `${event.eventKind} has no exact retained subject`);
  const revision = store.getRevision(event.subject.recordId, event.subject.revision);
  if (
    revision === null || revision.recordKind !== expectedKind ||
    revision.digest !== event.subject.digest
  ) {
    fail("journal", `${event.eventKind} does not resolve to one exact ${expectedKind} revision`);
  }
  return revision;
}

function uniqueActivityEvent(
  store: ControlRecordStore,
  activityId: string,
  eventKind: string,
): ControlRecordEvent {
  const matches = allEvents(store).filter((event) =>
    event.eventKind === eventKind && event.payload.activityId === activityId);
  if (matches.length !== 1) {
    fail("journal", `Activity must have exactly one ${eventKind} event`);
  }
  return matches[0]!;
}

function relationshipTarget(
  revision: ControlRecordRevision,
  relation: string,
  expectedKind: string,
): ControlRecordRelationshipTarget {
  const matches = revision.relationships.filter((value) => value.relation === relation);
  if (matches.length !== 1 || matches[0]!.target.kind !== expectedKind) {
    fail("relationship", `${revision.recordKind} must have one exact ${relation} to ${expectedKind}`);
  }
  return matches[0]!.target;
}

function retainedTarget(
  store: ControlRecordStore,
  target: ControlRecordRelationshipTarget,
): ControlRecordRevision {
  const revision = store.getRevision(target.id, target.revision);
  if (revision === null || revision.recordKind !== target.kind || revision.digest !== target.digest) {
    fail("relationship", `Relationship does not resolve to one exact ${target.kind} revision`);
  }
  return revision;
}

function checkCoordinate(store: ControlRecordStore, activityId: string): CheckCoordinate {
  const state = store.state();
  const activity = state.activities.find(({ id }) => id === activityId);
  if (
    activity === undefined || activity.family !== "agent" || activity.stage !== "finalizing" ||
    activity.recovery?.kind !== "finalization"
  ) {
    fail("activity", "Check Receipt requires one exact active Check finalization coordinate");
  }

  if ((BASELINE_OPERATIONS as readonly string[]).includes(activity.operation)) {
    if (activity.recovery.resumesAt !== "baseline-checks") {
      fail("activity", "Baseline Check Receipt is not eligible at the exact Journal head");
    }
    const boundary = exactRetainedSubject(
      store,
      uniqueActivityEvent(store, activityId, "work-boundary-finalized"),
      "work-boundary",
    );
    return Object.freeze({
      phase: "baseline",
      boundary,
      candidate: null,
      seal: null,
      proofSubject: boundary,
    });
  }

  if (activity.operation !== "delivery.evaluate" || activity.recovery.resumesAt !== "evaluation-checks") {
    fail("activity", "Only boundary baseline or Candidate evaluation can retain a Check Receipt");
  }
  const seal = exactRetainedSubject(
    store,
    uniqueActivityEvent(store, activityId, "candidate-sealed"),
    "candidate-seal",
  );
  const boundary = retainedTarget(store, relationshipTarget(seal, "governed-by", "work-boundary"));
  const candidate = retainedTarget(store, relationshipTarget(seal, "seals", "candidate-revision"));
  if (
    !sameReference(state.subjects.activeBoundary, boundary) ||
    !sameReference(state.subjects.candidate, candidate) ||
    !sameReference(state.subjects.seal, seal)
  ) {
    fail("subject", "Final Check Receipt does not bind the exact current Boundary, Candidate, and Seal");
  }
  return Object.freeze({ phase: "final", boundary, candidate, seal, proofSubject: seal });
}

function checkSelection(
  boundary: ControlRecordRevision,
  selectionId: string,
  expectedTargetId: string,
): CheckSelection {
  if (
    boundary.payload.schema !== "lifecycle.work-boundary-payload.v4" ||
    boundary.payload.targetId !== expectedTargetId
  ) {
    fail("boundary", "Check Receipt requires one Foundation Work Boundary for the exact Store target");
  }
  const checks = array(object(boundary.payload.mandate, "Work Boundary mandate").checks, "Work Boundary checks");
  const seen = new Set<string>();
  let selected: ControlJsonObject | null = null;
  for (const value of checks) {
    const check = object(value, "Work Boundary Check selection");
    const id = controlIdentifier(string(check.id, "Work Boundary Check identity"), "Work Boundary Check identity");
    if (seen.has(id)) fail("boundary", `Work Boundary repeats Check selection ${id}`);
    seen.add(id);
    if (id === selectionId) selected = check;
  }
  if (selected === null) fail("selection", `Work Boundary has no Check selection ${selectionId}`);

  const modality = string(selected.modality, "Work Boundary Check modality");
  if (!(MODALITIES as readonly string[]).includes(modality)) {
    fail("boundary", "Work Boundary Check has an unsupported modality");
  }
  const definitionValue = object(selected.definition, "Work Boundary Check Definition");
  const definition = Object.freeze({
    id: controlIdentifier(string(definitionValue.id, "Check Definition identity"), "Check Definition identity"),
    revision: positiveInteger(definitionValue.revision, "Check Definition revision"),
    sourceDigest: digest(definitionValue.sourceDigest, "Check Definition source digest"),
    semanticDigest: digest(definitionValue.semanticDigest, "Check Definition semantic digest"),
  });
  const bindings = Object.freeze(array(selected.bindings, "Work Boundary Check Bindings").map((value) => {
    const binding = object(value, "Work Boundary Check Binding");
    return Object.freeze({
      id: controlIdentifier(string(binding.id, "Check Binding identity"), "Check Binding identity"),
      digest: digest(binding.digest, "Check Binding digest"),
      implementationDigest: digest(binding.implementationDigest, "Check Binding implementation digest"),
    });
  }));
  if (bindings.length < 1 || new Set(bindings.map(({ id }) => id)).size !== bindings.length) {
    fail("boundary", "Work Boundary Check must have a nonempty unique Binding set");
  }
  const requestedConditions = exactStringSet(
    array(selected.environmentRequirements, "Check environment requirements").map((value) =>
      string(value, "Check environment requirement")),
    "Check environment requirements",
  );
  return Object.freeze({
    value: selected,
    id: selectionId,
    definition,
    bindings,
    modality: modality as CheckReceiptModality,
    requestedConditions,
  });
}

function selectedBinding(selection: CheckSelection, bindingId: string): ControlJsonObject {
  const matches = selection.bindings.filter(({ id }) => id === bindingId);
  if (matches.length !== 1) {
    fail("binding", `Check selection ${selection.id} has no unique Binding ${bindingId}`);
  }
  return matches[0]!;
}

function assertNoPriorReceipt(
  store: ControlRecordStore,
  activityId: string,
  phase: CheckReceiptPhase,
  selectionId: string,
): void {
  for (const event of allEvents(store)) {
    if (event.eventKind !== "check-receipt-recorded" || event.payload.activityId !== activityId) continue;
    const revision = exactRetainedSubject(store, event, "check-receipt");
    if (revision.payload.phase === phase && revision.payload.selectionId === selectionId) {
      fail("duplicate", `Activity already retained the ${phase} Check Receipt for ${selectionId}`);
    }
  }
}

function normalizedFacts(values: readonly CheckReceiptResultFact[]): readonly ControlJsonObject[] {
  if (!Array.isArray(values) || values.length > 256) {
    fail("result", "Check result facts exceed the bounded Receipt profile");
  }
  const byName = new Map<string, ControlJsonObject>();
  for (const value of values) {
    const name = controlRecordKind(value.name, "Check result fact name");
    let normalizedValue: string | number | boolean | null = value.value;
    if (typeof normalizedValue === "string") {
      normalizedValue = singleLine(normalizedValue, `Check result fact ${name}`);
    } else if (typeof normalizedValue === "number" && !Number.isFinite(normalizedValue)) {
      fail("result", `Check result fact ${name} must be one finite JSON number`);
    } else if (
      normalizedValue !== null && typeof normalizedValue !== "number" &&
      typeof normalizedValue !== "boolean"
    ) {
      fail("result", `Check result fact ${name} must be one normalized scalar`);
    }
    const normalized = Object.freeze({ name, value: normalizedValue });
    const prior = byName.get(name);
    if (prior !== undefined && digestCanonical(prior) !== digestCanonical(normalized)) {
      fail("result", `Check result fact ${name} has conflicting values`);
    }
    byName.set(name, normalized);
  }
  return Object.freeze([...byName.values()].sort((left, right) =>
    compareCodePoints(String(left.name), String(right.name))));
}

function normalizedEnvironment(
  observation: CheckReceiptObservation["environment"],
  requested: readonly string[],
): ControlJsonObject {
  const runtimeEnforced = exactStringSet(observation.runtimeEnforced, "Runtime-enforced conditions");
  const founderManaged = exactStringSet(observation.founderManaged, "Founder-managed conditions");
  const runtimeSet = new Set(runtimeEnforced);
  const founderSet = new Set(founderManaged);
  if (runtimeEnforced.some((value) => founderSet.has(value))) {
    fail("environment", "One environment condition cannot be both runtime-enforced and Founder-managed");
  }
  if (requested.some((value) => !runtimeSet.has(value) && !founderSet.has(value))) {
    fail("environment", "Every requested Work Boundary condition requires one observed custody class");
  }
  return Object.freeze({
    identityDigest: digest(observation.identityDigest, "Check environment identity digest"),
    requested,
    runtimeEnforced,
    founderManaged,
  });
}

function normalizedExecution(
  coordinate: CheckCoordinate,
  modality: CheckReceiptModality,
  observation: CheckReceiptObservation,
  facts: readonly ControlJsonObject[],
  environment: ControlJsonObject,
): Readonly<{
  startedAt: string | null;
  finishedAt: string | null;
  disposition: CheckReceiptDisposition;
  execution: ControlJsonObject;
  subjectIntegrity: CheckReceiptObservation["subjectIntegrity"];
  containment: ControlJsonObject;
  retirement: ControlJsonObject;
  reasonCode: string | null;
  notRunAuthorization: ControlJsonObject | null;
  operationalFailure: ControlJsonObject | null;
}> {
  const startedAt = observation.startedAt === null
    ? null
    : controlTimestamp(observation.startedAt, "Check start time");
  const finishedAt = observation.finishedAt === null
    ? null
    : controlTimestamp(observation.finishedAt, "Check finish time");
  if ((startedAt === null) !== (finishedAt === null)) {
    fail("time", "Check start and finish observations must be available together");
  }
  if (startedAt !== null && Date.parse(finishedAt!) < Date.parse(startedAt)) {
    fail("time", "Check finish time cannot precede its start time");
  }
  if (!(DISPOSITIONS as readonly string[]).includes(observation.disposition)) {
    fail("disposition", "Check disposition is outside check-disposition-v2");
  }
  const execution = observation.execution;
  const reasonCode = observation.reasonCode === null
    ? null
    : controlRecordKind(observation.reasonCode, "Check result reason code");
  let notRunAuthorization: ControlJsonObject | null = null;
  const baselinePostcondition = coordinate.phase === "baseline" && modality === "postcondition";
  if (baselinePostcondition && observation.disposition === "not-run") {
    if (observation.notRunAuthorization !== null) {
      fail("disposition", "Caller cannot substitute the runtime-derived baseline postcondition authorization");
    }
    notRunAuthorization = Object.freeze({ kind: "baseline-postcondition" });
  } else if (observation.notRunAuthorization !== null) {
    notRunAuthorization = Object.freeze({
      kind: "upstream-condition",
      conditionId: controlIdentifier(
        observation.notRunAuthorization.conditionId,
        "Upstream condition identity",
      ),
      conditionDigest: digest(
        observation.notRunAuthorization.conditionDigest,
        "Upstream condition digest",
      ),
    });
  }
  const operationalFailure = observation.operationalFailure === null
    ? null
    : Object.freeze({
        stage: controlRecordKind(observation.operationalFailure.stage, "Operational failure stage"),
        code: controlRecordKind(observation.operationalFailure.code, "Operational failure code"),
        factsDigest: digest(observation.operationalFailure.factsDigest, "Operational failure facts digest"),
      });
  const started = startedAt !== null;
  let normalizedExecution: ControlJsonObject;
  let parserDisposition: "passed" | "failed" | "not-run" = "not-run";
  let executionFailure = false;
  if (execution.allocation === "not-allocated") {
    if (started) fail("execution", "An unallocated Check cannot report execution times");
    if (
      observation.containment.classification !== "not-required" ||
      observation.containment.factsDigest !== null ||
      observation.retirement.classification !== "not-required" ||
      observation.retirement.factsDigest !== null
    ) {
      fail("execution", "An unallocated Check requires exact not-required Containment and Retirement");
    }
    normalizedExecution = Object.freeze({ allocation: "not-allocated" });
  } else {
    if (
      execution.exitCode !== null &&
      (!Number.isSafeInteger(execution.exitCode) || execution.exitCode < -2_147_483_648 || execution.exitCode > 2_147_483_647)
    ) fail("execution", "Check exit code is outside the bounded signed 32-bit range");
    if (execution.signal !== null && (execution.signal.length > 64 || !SIGNAL_PATTERN.test(execution.signal))) {
      fail("execution", "Check signal is invalid");
    }
    if (execution.signal !== null && execution.exitCode !== null) {
      fail("execution", "A signaled Check cannot also report an exit code");
    }
    if (!(execution.parserDisposition === "passed" || execution.parserDisposition === "failed" || execution.parserDisposition === "not-run")) {
      fail("execution", "Check parser disposition is invalid");
    }
    parserDisposition = execution.parserDisposition;
    digest(execution.backendProfile.profileDigest, "Check Backend Profile digest");
    digest(execution.backendProfile.implementationDigest, "Check Backend implementation digest");
    controlIdentifier(execution.image.imageId, "Check Execution Image identity");
    digest(execution.image.imageDigest, "Check Execution Image digest");
    digest(execution.inputSet.digest, "Check Input Set digest");
    digest(execution.specificationDigest, "Check Execution Specification digest");
    digest(execution.runnerDigest, "Check cell-side runner digest");
    digest(execution.observationDigest, "Check terminal Observation digest");
    if (execution.runnerDigest !== observation.runner.digest) {
      fail("execution", "Check Execution runner digest differs from the retained runner implementation");
    }
    if (execution.output.availability === "retrieved") {
      if (!Number.isSafeInteger(execution.output.carrierByteLength) || execution.output.carrierByteLength < 0) {
        fail("execution", "Retrieved Check output requires one nonnegative safe byte length");
      }
      digest(execution.output.carrierDigest, "Check Output Carrier digest");
      digest(execution.output.manifestDigest, "Check Output Manifest digest");
    } else if (
      execution.output.carrierByteLength !== null || execution.output.carrierDigest !== null ||
      execution.output.manifestDigest !== null
    ) {
      fail("execution", "Unavailable Check output cannot carry placeholder byte or digest facts");
    }
    if (
      observation.containment.classification !== "contained" ||
      observation.retirement.classification !== "retired"
    ) {
      fail("execution", "Every allocated Check requires completed Containment and Retirement");
    }
    digest(observation.containment.factsDigest, "Check Containment facts digest");
    digest(observation.retirement.factsDigest, "Check Retirement facts digest");
    if (!started && (execution.exitCode !== null || execution.signal !== null || execution.timedOut)) {
      fail("execution", "An unstarted Check cannot report process terminal facts");
    }
    executionFailure = execution.signal !== null || execution.timedOut ||
      execution.parserDisposition === "failed" ||
      (started && execution.output.availability !== "retrieved");
    normalizedExecution = Object.freeze({
      allocation: "allocated",
      backendProfile: Object.freeze({ ...execution.backendProfile }),
      image: Object.freeze({ ...execution.image }),
      inputSet: Object.freeze({ ...execution.inputSet }),
      specificationDigest: execution.specificationDigest,
      runnerDigest: execution.runnerDigest,
      observationDigest: execution.observationDigest,
      output: Object.freeze({ ...execution.output }),
      exitCode: execution.exitCode,
      signal: execution.signal,
      timedOut: execution.timedOut,
      parserDisposition: execution.parserDisposition,
    });
  }
  const containment: ControlJsonObject = observation.containment.classification === "contained"
    ? Object.freeze({ classification: "contained", factsDigest: observation.containment.factsDigest })
    : Object.freeze({ classification: "not-required", factsDigest: null });
  const retirement: ControlJsonObject = observation.retirement.classification === "retired"
    ? Object.freeze({ classification: "retired", factsDigest: observation.retirement.factsDigest })
    : Object.freeze({ classification: "not-required", factsDigest: null });
  const lifecycleFailure = executionFailure || observation.subjectIntegrity === "changed" ||
    (started && observation.subjectIntegrity === "unverified");
  const semantic = observation.disposition === "pass" || observation.disposition === "fail" ||
    observation.disposition === "indeterminate";
  const runtimeEnforced = new Set(array(
    environment.runtimeEnforced,
    "Runtime-enforced conditions",
  ).map((value) => string(value, "Runtime-enforced condition")));
  if (semantic && (
    execution.allocation !== "allocated" || !started || parserDisposition !== "passed" ||
    lifecycleFailure || facts.length < 1 ||
    !runtimeEnforced.has("descendant-containment") || !runtimeEnforced.has("protected-environment")
  )) {
    fail("disposition", `${observation.disposition} requires a contained exact-subject execution and normalized result facts`);
  }
  if (semantic && (reasonCode !== null || notRunAuthorization !== null || operationalFailure !== null)) {
    fail("disposition", "A semantic Check result cannot carry non-execution or operational-failure facts");
  }
  if (lifecycleFailure && observation.disposition !== "operational-error") {
    fail("disposition", "A Check lifecycle, parser, output, or subject-integrity failure requires operational-error");
  }
  if (parserDisposition === "not-run" && started && observation.disposition !== "operational-error") {
    fail("disposition", "A started Check without parser execution requires operational-error");
  }
  if (observation.disposition === "not-run") {
    if (
      started || execution.allocation !== "not-allocated" || reasonCode === null ||
      notRunAuthorization === null || operationalFailure !== null
    ) {
      fail("disposition", "not-run requires one exact authorization and an unstarted mechanism");
    }
    if (
      (notRunAuthorization.kind === "baseline-postcondition") !== baselinePostcondition
    ) {
      fail("disposition", "Check not-run authorization differs from its exact phase and modality");
    }
  } else if (notRunAuthorization !== null) {
    fail("disposition", "Only not-run can retain a Check non-execution authorization");
  }
  if (coordinate.phase === "baseline" && modality === "postcondition" && observation.disposition !== "not-run") {
    fail("disposition", "A baseline postcondition must retain not-run disposition");
  }
  if (observation.disposition === "unsupported" && (
    started || reasonCode === null || notRunAuthorization !== null || operationalFailure !== null
  )) {
    fail("disposition", "unsupported requires an unstarted mechanism and exact unavailability facts");
  }
  if (observation.disposition === "operational-error" && (
    reasonCode === null || operationalFailure === null || notRunAuthorization !== null
  )) {
    fail("disposition", "operational-error requires exact typed operational failure facts");
  }
  if (observation.disposition !== "operational-error" && operationalFailure !== null) {
    fail("disposition", "Check failure facts differ from the selected disposition");
  }
  if (parserDisposition === "failed" && observation.disposition !== "operational-error") {
    fail("disposition", "Parser failure requires operational-error disposition");
  }
  return Object.freeze({
    startedAt,
    finishedAt,
    disposition: observation.disposition,
    execution: normalizedExecution,
    subjectIntegrity: observation.subjectIntegrity,
    containment,
    retirement,
    reasonCode,
    notRunAuthorization,
    operationalFailure,
  });
}

function normalizedRawMaterials(
  store: ControlRecordStore,
  values: readonly CheckReceiptRawMaterial[],
  recordedAt: string,
  mechanismStarted: boolean,
  disposition: CheckReceiptDisposition,
): Readonly<{ payload: readonly ControlJsonObject[]; files: readonly ControlRecordFileInput[] }> {
  if (!Array.isArray(values) || values.length > 16) {
    fail("raw-material", "Check raw material exceeds the bounded Receipt profile");
  }
  if (!mechanismStarted && (disposition === "not-run" || disposition === "unsupported") && values.length > 0) {
    fail("raw-material", `${disposition} Check Receipt cannot claim raw mechanism output`);
  }
  const byPurpose = new Map<string, Readonly<{ payload: ControlJsonObject; file: ControlRecordFileInput | null }>>();
  const byDigest = new Map<Sha256, string>();
  for (const value of values) {
    const purpose = controlIdentifier(
      value.availability === "retained" ? value.file.purpose : value.purpose,
      "Check raw-material purpose",
    );
    let payload: ControlJsonObject;
    let file: ControlRecordFileInput | null = null;
    if (value.availability === "retained") {
      const createdAt = controlTimestamp(value.file.createdAt, "Check raw-material creation time");
      if (Date.parse(createdAt) > Date.parse(recordedAt)) {
        fail("time", "Check raw material cannot be created after its Receipt");
      }
      const proposedFile = Object.freeze({ ...value.file, purpose, createdAt });
      const proposedDescriptor = compileControlRecordFile(proposedFile);
      const existing = store.listRetainedFiles().find(
        ({ digest }) => digest === proposedDescriptor.digest,
      );
      let descriptor = proposedDescriptor;
      file = proposedFile;
      if (existing !== undefined) {
        if (
          existing.byteLength !== proposedDescriptor.byteLength ||
          existing.mediaType !== proposedDescriptor.mediaType ||
          existing.purpose !== proposedDescriptor.purpose
        ) {
          fail(
            "raw-material",
            "Check raw-material bytes conflict with an existing adjacent-file descriptor",
          );
        }
        if (Date.parse(existing.createdAt) > Date.parse(recordedAt)) {
          fail("time", "Existing Check raw material cannot be created after its Receipt");
        }
        const reusedFile = Object.freeze({ ...proposedFile, createdAt: existing.createdAt });
        file = reusedFile;
        descriptor = compileControlRecordFile(reusedFile);
        if (canonicalJson(descriptor) !== canonicalJson(existing)) {
          fail(
            "raw-material",
            "Check raw material does not reproduce its existing adjacent-file descriptor",
          );
        }
      }
      const previousPurpose = byDigest.get(descriptor.digest);
      if (previousPurpose !== undefined && previousPurpose !== purpose) {
        fail("raw-material", "One retained Check file digest cannot bind different purposes");
      }
      byDigest.set(descriptor.digest, purpose);
      payload = Object.freeze({
        availability: "retained",
        reference: Object.freeze({
          digest: descriptor.digest,
          byteLength: descriptor.byteLength,
          mediaType: descriptor.mediaType,
          purpose: descriptor.purpose,
        }),
      });
    } else {
      payload = Object.freeze({ availability: value.availability, purpose });
    }
    const prior = byPurpose.get(purpose);
    if (prior !== undefined && digestCanonical(prior.payload) !== digestCanonical(payload)) {
      fail("raw-material", `Check raw-material purpose ${purpose} has conflicting availability facts`);
    }
    byPurpose.set(purpose, Object.freeze({ payload, file }));
  }
  const ordered = [...byPurpose.entries()].sort(([left], [right]) => compareCodePoints(left, right));
  return Object.freeze({
    payload: Object.freeze(ordered.map(([, value]) => value.payload)),
    files: Object.freeze(ordered.flatMap(([, value]) => value.file === null ? [] : [value.file])),
  });
}

function implementation(
  value: Readonly<{ id: string; digest: Sha256 }>,
  label: string,
): ControlJsonObject {
  return Object.freeze({
    id: controlIdentifier(value.id, `${label} identity`),
    digest: digest(value.digest, `${label} digest`),
  });
}

function proofRequestDigest(input: Readonly<{
  store: ControlRecordStore;
  coordinate: CheckCoordinate;
  selection: CheckSelection;
  binding: ControlJsonObject;
  environment: ControlJsonObject;
}>): Sha256 {
  return digestCanonical({
    schema: "lifecycle.check-proof-request.v1",
    targetId: input.store.identity.targetId,
    processId: input.store.identity.processId,
    phase: input.coordinate.phase,
    proofSubject: reference(input.coordinate.proofSubject),
    boundary: reference(input.coordinate.boundary),
    candidate: input.coordinate.candidate === null ? null : reference(input.coordinate.candidate),
    seal: input.coordinate.seal === null ? null : reference(input.coordinate.seal),
    selection: {
      id: input.selection.id,
      digest: digestCanonical(input.selection.value),
      binding: input.binding,
    },
    environment: {
      identityDigest: input.environment.identityDigest,
      requested: input.environment.requested,
    },
  });
}

function identities(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  phase: CheckReceiptPhase;
  selectionId: string;
  bindingId: string;
  subject: ControlRecordRevision;
}>): Readonly<{ recordId: string; eventId: string }> {
  const suffix = digestCanonical({
    recordKind: "check-receipt",
    storeId: input.store.identity.storeId,
    processId: input.store.identity.processId,
    activityId: input.activityId,
    phase: input.phase,
    selectionId: input.selectionId,
    bindingId: input.bindingId,
    subject: reference(input.subject),
  }).slice("sha256:".length);
  return Object.freeze({
    recordId: `check-receipt-${suffix}`,
    eventId: `event-check-receipt-recorded-${suffix}`,
  });
}

function semanticMarkdown(input: Readonly<{
  phase: CheckReceiptPhase;
  selection: CheckSelection;
  binding: ControlJsonObject;
  subject: ControlRecordRevision;
  disposition: CheckReceiptDisposition;
  startedAt: string | null;
  finishedAt: string | null;
  limitations: readonly string[];
}>): string {
  const lines = [
    "# Check Receipt",
    "",
    `- Phase: ${input.phase}`,
    `- Check selection: ${input.selection.id}`,
    `- Check Definition: ${String(input.selection.definition.id)} revision ${String(input.selection.definition.revision)}`,
    `- Check Binding: ${String(input.binding.id)}`,
    `- Modality: ${input.selection.modality}`,
    `- Proof subject: ${input.subject.recordKind} ${input.subject.recordId} revision ${input.subject.revision}`,
    `- Disposition: ${input.disposition}`,
    `- Started: ${input.startedAt ?? "not started"}`,
    `- Finished: ${input.finishedAt ?? "not started"}`,
  ];
  if (input.limitations.length > 0) {
    lines.push("", "## Limitations", "", ...input.limitations.map((value) => `- ${value}`));
  }
  lines.push("", "This Receipt retains the runtime-observed outcome for the exact selected proof request.", "");
  return lines.join("\n");
}

/**
 * Compile one exact-subject Check Receipt append. Callers select only a Work
 * Boundary Check and Binding and supply fresh runtime observations; the Store,
 * activity, phase, subjects, Definition, Binding, modality, requested
 * conditions, proof-request digest, identities, and relationships are
 * runtime-derived. The retention owner may commit this append with an exact
 * operation-support advance.
 */
export type CompileCheckReceiptAppendInput = Readonly<{
  store: ControlRecordStore;
  activityId: string;
  selectionId: string;
  bindingId: string;
  observation: CheckReceiptObservation;
  recordedAt: string;
  runtimeId: string;
}>;

export type CompiledCheckReceiptAppend = Readonly<{
  revision: ControlRecordRevision;
  append: ControlRecordStoreAppend;
  files: readonly ControlRecordFileInput[];
}>;

/** Compile one exact Check Receipt without crossing its retention boundary. */
export function compileCheckReceiptAppend(
  input: CompileCheckReceiptAppendInput,
): CompiledCheckReceiptAppend {
  const activityId = controlIdentifier(input.activityId, "Check Receipt activity identity");
  const selectionId = controlIdentifier(input.selectionId, "Check selection identity");
  const bindingId = controlIdentifier(input.bindingId, "Check Binding identity");
  const recordedAt = controlTimestamp(input.recordedAt, "Check Receipt retention time");
  const runtimeId = controlIdentifier(input.runtimeId, "Check Receipt runtime identity");
  const coordinate = checkCoordinate(input.store, activityId);
  const selection = checkSelection(coordinate.boundary, selectionId, input.store.identity.targetId);
  const binding = selectedBinding(selection, bindingId);
  assertNoPriorReceipt(input.store, activityId, coordinate.phase, selectionId);
  const resultFacts = normalizedFacts(input.observation.resultFacts);
  const environment = normalizedEnvironment(input.observation.environment, selection.requestedConditions);
  const execution = normalizedExecution(
    coordinate,
    selection.modality,
    input.observation,
    resultFacts,
    environment,
  );
  if (execution.finishedAt !== null && Date.parse(recordedAt) < Date.parse(execution.finishedAt)) {
    fail("time", "Check Receipt cannot be retained before mechanism completion");
  }
  const rawMaterials = normalizedRawMaterials(
    input.store,
    input.observation.rawMaterials ?? [],
    recordedAt,
    execution.startedAt !== null,
    execution.disposition,
  );
  const limitations = exactStringSet(input.observation.limitations ?? [], "Check limitations");
  const payload: ControlJsonObject = Object.freeze({
    schema: "lifecycle.check-receipt-payload.v2",
    profileId: "lifecycle.check-receipt.foundation-v1",
    selectionId,
    definition: selection.definition,
    binding,
    phase: coordinate.phase,
    modality: selection.modality,
    proofRequestDigest: proofRequestDigest({
      store: input.store,
      coordinate,
      selection,
      binding,
      environment,
    }),
    startedAt: execution.startedAt,
    finishedAt: execution.finishedAt,
    environment,
    disposition: execution.disposition,
    resultFacts,
    reasonCode: execution.reasonCode,
    notRunAuthorization: execution.notRunAuthorization,
    operationalFailure: execution.operationalFailure,
    execution: execution.execution,
    rawMaterials: rawMaterials.payload,
    subjectIntegrity: execution.subjectIntegrity,
    containment: execution.containment,
    retirement: execution.retirement,
    runner: implementation(input.observation.runner, "Check runner"),
    parser: implementation(input.observation.parser, "Check parser"),
    limitations,
  });
  const owned = identities({
    store: input.store,
    activityId,
    phase: coordinate.phase,
    selectionId,
    bindingId,
    subject: coordinate.proofSubject,
  });
  const relationships: readonly ControlRecordRelationship[] = Object.freeze([
    Object.freeze({
      relation: coordinate.phase === "baseline" ? "checks-boundary" : "checks-seal",
      target: reference(coordinate.proofSubject),
    }),
  ]);
  const revisionInput = Object.freeze({
    recordId: owned.recordId,
    recordKind: "check-receipt",
    revision: 1,
    producer: Object.freeze({ kind: "runtime" as const, id: runtimeId }),
    semanticAuthor: Object.freeze({ kind: "runtime" as const, id: runtimeId }),
    semanticAuthority: "runtime-observed" as const,
    createdAt: recordedAt,
    semanticMarkdown: semanticMarkdown({
      phase: coordinate.phase,
      selection,
      binding,
      subject: coordinate.proofSubject,
      disposition: execution.disposition,
      startedAt: execution.startedAt,
      finishedAt: execution.finishedAt,
      limitations,
    }),
    payload,
    relationships,
  });
  const compiled = compileControlRecordRevision(input.store.identity.processId, revisionInput);
  assertDeliveryControlRecordPolicy(compiled);
  assertDeliveryControlRecordPayload(compiled);
  const append = Object.freeze({
    revision: revisionInput,
    event: {
      eventId: owned.eventId,
      eventKind: "check-receipt-recorded",
      occurredAt: recordedAt,
      actor: { kind: "runtime" as const, id: runtimeId },
      subject: {
        recordId: compiled.recordId,
        revision: compiled.revision,
        digest: compiled.digest,
      },
      payload: { activityId },
    },
  });
  return Object.freeze({ revision: compiled, append, files: rawMaterials.files });
}

export async function retainCheckReceipt(
  input: CompileCheckReceiptAppendInput,
): Promise<Readonly<{ revision: ControlRecordRevision; event: ControlRecordEvent }>> {
  const compiled = compileCheckReceiptAppend(input);
  const retained = compiled.files.length === 0
    ? input.store.append(compiled.append)
    : (await input.store.appendWithFiles({
        files: compiled.files,
        appends: [compiled.append],
      })).appends[0]!;
  if (retained.revision === null) fail("retention", "Check Receipt revision was not retained");
  return Object.freeze({ revision: retained.revision, event: retained.event });
}
