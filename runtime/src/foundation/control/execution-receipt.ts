import { FoundationError } from "../error.js";
import { assertFoundationBuilderRepairMaterialsV1 } from "../candidate/repair-output.js";
import {
  canonicalJson,
  digestCanonical,
  sha256Bytes,
  type Sha256,
} from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import { assertDeliveryControlRecordPolicy } from "./kind-registry.js";
import {
  compileControlRecordRevision,
  controlIdentifier,
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
  ControlRecordRevision,
  ControlRecordStoreAppend,
} from "./types.js";

type AgentRole = "reconnaissance" | "builder" | "reviewer";
type ProviderEffectOutcome = "completed" | "failed" | "not-started";
type ProviderTerminalOutcome =
  | "natural-return"
  | "invalid-result"
  | "timeout"
  | "cancelled"
  | "forced-termination"
  | "provider-failure"
  | "capability-refusal"
  | "security-stop"
  | "runtime-failure";
type ProviderObservationStage =
  | "preflight"
  | "compatibility"
  | "dispatch"
  | "running"
  | "result-validation"
  | "evaluated";
type ProviderObservationTrigger =
  | "natural-return"
  | "timeout"
  | "cancellation"
  | "force-cancellation"
  | "safety-limit"
  | "provider-failure"
  | "capability-refusal"
  | "security-stop"
  | "runtime-failure"
  | "invalid-result";
type ParserDisposition = "valid" | "invalid" | "not-run";
type CompilerDisposition =
  | "retained"
  | "rejected"
  | "invalid-result"
  | "runtime-failure"
  | "not-run";

export type ExecutionReceiptSubmissionDiagnostic = Readonly<{
  code: string;
  stage: "syntax" | "template" | "semantic" | "compiler";
  factsDigest: Sha256;
}>;

export type ExecutionReceiptWorkspaceObservation =
  | Readonly<{
      availability: "available";
      rawByteLength: number;
      workspaceRawDigest: Sha256;
      semanticMarkdownDigest: Sha256 | null;
      parseResultDigest: Sha256 | null;
      failureFactsDigest: Sha256 | null;
      submissionDiagnostic: ExecutionReceiptSubmissionDiagnostic | null;
      fixedBindingSubjectDigest: Sha256 | null;
      parserDisposition: ParserDisposition;
      compilerDisposition: CompilerDisposition;
    }>
  | Readonly<{
      availability: "unavailable";
      failureFactsDigest: Sha256;
      submissionDiagnostic: null;
    }>;

export type ExecutionReceiptRawMaterial =
  | Readonly<{ availability: "retained"; file: ControlRecordFileInput }>
  | Readonly<{ availability: "not-retained" | "unavailable"; purpose: string }>;

/** Retain the exact bounded provider report bytes already validated by the Cell output owner. */
export function compileExecutionReceiptProviderFailureMaterial(input: Readonly<{
  store: ControlRecordStore;
  bytes: Uint8Array;
  createdAt: string;
}>): ExecutionReceiptRawMaterial {
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0 || input.bytes.byteLength > 16 * 1024) {
    fail("raw-material", "Provider failure material exceeds its bounded adjacent-file profile");
  }
  const existing = input.store.listRetainedFiles().find(({ digest }) => digest === sha256Bytes(input.bytes));
  const file = Object.freeze({
    bytes: Uint8Array.from(input.bytes),
    mediaType: "application/json",
    purpose: "raw-provider-output",
    createdAt: existing?.createdAt ?? input.createdAt,
  });
  const compiled = compileControlRecordFile(file);
  if (existing !== undefined && canonicalJson(existing) !== canonicalJson(compiled)) {
    fail("raw-material", "Provider failure material conflicts with its retained file descriptor");
  }
  return Object.freeze({ availability: "retained", file });
}

export type ExecutionReceiptProviderObservation = Readonly<{
  preparedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  executableIdentity: Sha256 | null;
  outcome: ProviderTerminalOutcome;
  stage: ProviderObservationStage;
  productiveStarted: boolean;
  firstTrigger: ProviderObservationTrigger;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  sessionId: string | null;
}>;

export type ExecutionReceiptExecutionFacts = Readonly<{
  backendProfile: Readonly<{
    profileId:
      | "lifecycle.execution-backend-profile.docker-local.v1"
      | "lifecycle.execution-backend-profile.fault-injection.v1";
    profileDigest: Sha256;
    implementationDigest: Sha256;
  }>;
  image: Readonly<{ imageId: string; imageDigest: Sha256 }>;
  inputSet: Readonly<{
    profileId: "lifecycle.execution-input-set.v2";
    digest: Sha256;
  }>;
  specificationDigest: Sha256;
  runnerDigest: Sha256;
  observationDigest: Sha256;
  output:
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
}>;

export type ExecutionReceiptContainment = Readonly<{
  factsDigest: Sha256;
  cancellationRequested: boolean;
  forced: boolean;
  parentLoss: "not-observed" | "contained";
}>;

export type ExecutionReceiptRetirement = Readonly<{
  factsDigest: Sha256;
  residualClass: "none" | "bounded-non-secret";
  residualFactsDigest: Sha256 | null;
}>;

export type ExecutionReceiptRuntimeCoordinates = Readonly<{
  implementationId: string;
  implementationDigest: Sha256;
  ruleSetId: string;
  ruleSetDigest: Sha256;
}>;

export type ExecutionReceiptSubmissionTrigger =
  | "explicit"
  | "clean-natural-completion"
  | null;

type AttemptFacts = Readonly<{
  role: AgentRole;
  model: string;
  descriptorId: string;
  descriptorDigest: Sha256;
  installedIdentityDigest: Sha256;
  roleBriefDigest: Sha256;
  contentInventoryDigest: Sha256;
  inputMaterialDigest: Sha256;
  execution: Readonly<{
    backendProfile: ControlJsonObject;
    image: ControlJsonObject;
    inputSet: ControlJsonObject;
  }>;
  submissionPolicy: "explicit" | "explicit-or-clean-natural-completion";
  adjacentFilePurposes: readonly string[];
}>;

type ActivityRecords = Readonly<{
  attempt: ControlRecordRevision;
  effectDigest: Sha256;
  providerOutcome: ProviderEffectOutcome;
  workProduct: ControlRecordRevision | null;
  inputCandidate: ControlRecordRevision | null;
  successorCandidate: ControlRecordRevision | null;
}>;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.control-execution-receipt.${code}`, message);
}

function object(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    fail("retained-fact", `${label} is not one exact object`);
  }
  return value as ControlJsonObject;
}

function string(value: ControlJsonValue | undefined, label: string): string {
  if (typeof value !== "string") fail("retained-fact", `${label} is not one exact string`);
  return value;
}

function digest(value: ControlJsonValue | undefined, label: string): Sha256 {
  const result = string(value, label);
  if (!/^sha256:[a-f0-9]{64}$/u.test(result)) {
    fail("retained-fact", `${label} is not one lowercase SHA-256 digest`);
  }
  return result as Sha256;
}

function normalizedSubmissionDiagnostic(
  value: ControlJsonValue | undefined,
  label: string,
): ExecutionReceiptSubmissionDiagnostic | null {
  if (value === null) return null;
  const selected = object(value, label);
  const keys = Object.keys(selected).sort(compareCodePoints);
  if (keys.join("\u0000") !== ["code", "factsDigest", "stage"].join("\u0000")) {
    fail("submission-diagnostic", `${label} is not one exact closed diagnostic object`);
  }
  const code = string(selected.code, `${label} code`);
  if (
    code.length > 160 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(code)
  ) {
    fail("submission-diagnostic", `${label} code is outside its bounded identity domain`);
  }
  const stage = string(selected.stage, `${label} stage`);
  if (!(stage === "syntax" || stage === "template" || stage === "semantic" || stage === "compiler")) {
    fail("submission-diagnostic", `${label} stage is unsupported`);
  }
  return Object.freeze({
    code,
    stage,
    factsDigest: digest(selected.factsDigest, `${label} facts digest`),
  });
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
  left: ControlRecordRelationshipTarget,
  right: ControlRecordRelationshipTarget,
): boolean {
  return left.kind === right.kind && left.id === right.id && left.revision === right.revision &&
    left.digest === right.digest;
}

function exactRetainedSubject(
  store: ControlRecordStore,
  event: ControlRecordEvent,
  expectedKind: string,
): ControlRecordRevision {
  if (event.subject === null) fail("journal", `${event.eventKind} has no retained subject`);
  const revision = store.getRevision(event.subject.recordId, event.subject.revision);
  if (
    revision === null || revision.recordKind !== expectedKind ||
    revision.digest !== event.subject.digest
  ) {
    fail("journal", `${event.eventKind} does not bind one exact retained ${expectedKind} revision`);
  }
  return revision;
}

function exactEventSubject(event: ControlRecordEvent, revision: ControlRecordRevision): boolean {
  return event.subject !== null && event.subject.recordId === revision.recordId &&
    event.subject.revision === revision.revision && event.subject.digest === revision.digest;
}

function activityId(event: ControlRecordEvent): string | null {
  const value = event.payload.activityId;
  return typeof value === "string" ? value : null;
}

function allEvents(store: ControlRecordStore): readonly ControlRecordEvent[] {
  const events: ControlRecordEvent[] = [];
  let cursor = 0;
  for (;;) {
    const page = store.listEvents(cursor, 10_000);
    events.push(...page);
    if (page.length < 10_000) return Object.freeze(events);
    cursor = page.at(-1)!.sequence;
    if (events.length > 100_000) fail("journal", "Execution Receipt lookup exceeds the Journal bound");
  }
}

function oneEvent(
  events: readonly ControlRecordEvent[],
  kind: string,
  required: boolean,
): ControlRecordEvent | null {
  const matches = events.filter((event) => event.eventKind === kind);
  if (matches.length > 1 || (required && matches.length !== 1)) {
    fail("journal", `Activity must have ${required ? "exactly" : "at most"} one ${kind} event`);
  }
  return matches[0] ?? null;
}

function relationshipTarget(
  revision: ControlRecordRevision,
  relation: string,
  expectedKind: string,
  required: boolean,
): ControlRecordRelationshipTarget | null {
  const matches = revision.relationships.filter((item) => item.relation === relation);
  if (matches.length > 1 || (required && matches.length !== 1)) {
    fail("relationship", `${revision.recordKind} must have ${required ? "exactly" : "at most"} one ${relation} relationship`);
  }
  const target = matches[0]?.target ?? null;
  if (target !== null && target.kind !== expectedKind) {
    fail("relationship", `${relation} must target ${expectedKind}`);
  }
  return target;
}

function retainedTarget(
  store: ControlRecordStore,
  target: ControlRecordRelationshipTarget,
): ControlRecordRevision {
  const retained = store.getRevision(target.id, target.revision);
  if (retained === null || retained.recordKind !== target.kind || retained.digest !== target.digest) {
    fail("relationship", `Relationship does not bind one exact retained ${target.kind} revision`);
  }
  return retained;
}

function activityRecords(store: ControlRecordStore, exactActivityId: string): ActivityRecords {
  const events = allEvents(store).filter((event) => activityId(event) === exactActivityId);
  const attemptEvent = oneEvent(events, "agent-attempt-prepared", true)!;
  const attempt = exactRetainedSubject(store, attemptEvent, "agent-attempt");
  if (attempt.payload.activityId !== exactActivityId) {
    fail("journal", "Agent Attempt activity identity differs from its Journal event");
  }
  const intended = oneEvent(events, "provider-effect-intended", true)!;
  const observed = oneEvent(events, "provider-effect-observed", true)!;
  if (!exactEventSubject(intended, attempt) || !exactEventSubject(observed, attempt)) {
    fail("journal", "Provider effect milestones do not bind the exact Agent Attempt");
  }
  const effectDigest = digest(intended.payload.effectDigest, "Provider effect intent digest");
  if (digest(observed.payload.effectDigest, "Provider effect observation digest") !== effectDigest) {
    fail("journal", "Provider effect intent and observation digests differ");
  }
  const providerOutcome = string(observed.payload.outcome, "Provider effect outcome");
  if (!(providerOutcome === "completed" || providerOutcome === "failed" || providerOutcome === "not-started")) {
    fail("journal", "Provider effect observation has an unsupported outcome");
  }

  const submitted = oneEvent(events, "agent-work-product-submitted", false);
  const abandoned = oneEvent(events, "agent-work-product-abandoned", false);
  if ((submitted === null) === (abandoned === null)) {
    fail("journal", "Activity must have exactly one Work Product submission or abandonment milestone");
  }
  const workProduct = submitted === null
    ? null
    : exactRetainedSubject(store, submitted, "agent-work-product");
  if (workProduct !== null) {
    const resultOf = relationshipTarget(workProduct, "result-of", "agent-attempt", true)!;
    if (!sameReference(resultOf, reference(attempt))) {
      fail("relationship", "Agent Work Product does not bind the exact Agent Attempt");
    }
  } else if (!exactEventSubject(abandoned!, attempt)) {
    fail("journal", "Work Product abandonment does not bind the exact Agent Attempt");
  }

  const role = attempt.payload.role;
  const candidateEvent = oneEvent(events, "candidate-revision-observed", false);
  let inputCandidate: ControlRecordRevision | null = null;
  let successorCandidate: ControlRecordRevision | null = null;
  if (role === "builder") {
    const attemptCandidate = relationshipTarget(attempt, "uses-candidate", "candidate-revision", true)!;
    inputCandidate = retainedTarget(store, attemptCandidate);
    if (candidateEvent !== null) {
      successorCandidate = exactRetainedSubject(store, candidateEvent, "candidate-revision");
      const predecessor = relationshipTarget(
        successorCandidate,
        "revises",
        "candidate-revision",
        true,
      )!;
      const resultOf = relationshipTarget(
        successorCandidate,
        "result-of",
        "agent-attempt",
        true,
      )!;
      if (!sameReference(predecessor, attemptCandidate)) {
        fail("relationship", "Builder Candidate successor does not revise the exact input Candidate");
      }
      if (!sameReference(resultOf, reference(attempt))) {
        fail("relationship", "Builder Candidate successor does not bind the exact creating Attempt");
      }
      if (successorCandidate.payload.observation !== "builder-successor") {
        fail("relationship", "Builder Candidate event does not retain one builder-successor Revision");
      }
    }
  } else if (role === "reviewer") {
    if (candidateEvent !== null) fail("journal", "Reviewer activity cannot create a Candidate observation");
    const attempted = relationshipTarget(attempt, "uses-candidate", "candidate-revision", true)!;
    inputCandidate = retainedTarget(store, attempted);
  } else if (role === "reconnaissance") {
    if (candidateEvent !== null) fail("journal", "Reconnaissance activity cannot create a Candidate observation");
    const resolution = attempt.payload.operation === "delivery.revise" ||
      attempt.payload.operation === "delivery.reaffirm";
    if (!resolution && attempt.payload.operation !== "delivery.prepare") {
      fail("relationship", "Reconnaissance Attempt does not select a preparation or resolution operation");
    }
    const attempted = relationshipTarget(attempt, "uses-candidate", "candidate-revision", resolution);
    if (!resolution && attempted !== null) {
      fail("relationship", "Initial preparation Attempt cannot bind an input Candidate");
    }
    // Resolution retains the frozen input through its observed Attempt. It
    // does not produce Receipt Candidate observation or successor facts.
    if (attempted !== null) retainedTarget(store, attempted);
  } else {
    fail("retained-fact", "Agent Attempt role is unsupported");
  }
  // Retention is an exact idempotent boundary. A process can lose ownership
  // after the Receipt append commits but before its operation-support stage is
  // advanced. The compiler therefore reproduces the same Receipt and lets the
  // Store's event/revision replay checks accept only byte-identical content.
  return Object.freeze({
    attempt,
    effectDigest,
    providerOutcome,
    workProduct,
    inputCandidate,
    successorCandidate,
  });
}

function attemptFacts(attempt: ControlRecordRevision): AttemptFacts {
  const provider = object(attempt.payload.provider, "Agent Attempt provider");
  const execution = object(attempt.payload.execution, "Agent Attempt execution selection");
  const authoring = object(attempt.payload.authoring, "Agent Attempt authoring");
  const attemptInput = object(attempt.payload.input, "Agent Attempt input");
  const role = string(attempt.payload.role, "Agent Attempt role");
  if (!(role === "reconnaissance" || role === "builder" || role === "reviewer")) {
    fail("retained-fact", "Agent Attempt role is unsupported");
  }
  const submissionPolicy = string(authoring.submissionPolicy, "Agent Attempt submission policy");
  if (!(submissionPolicy === "explicit" || submissionPolicy === "explicit-or-clean-natural-completion")) {
    fail("retained-fact", "Agent Attempt submission policy is unsupported");
  }
  const purposes = attempt.payload.adjacentFilePurposes;
  if (!Array.isArray(purposes) || purposes.some((purpose) => typeof purpose !== "string")) {
    fail("retained-fact", "Agent Attempt adjacent-file purposes are invalid");
  }
  if (attempt.payload.schema !== "lifecycle.agent-attempt-payload.v3") {
    fail("retained-fact", "Agent Attempt does not use the Foundation v3 payload");
  }
  if (provider.adapter !== "lifecycle.provider-adapter.v7") {
    fail("retained-fact", "Agent Attempt does not bind provider adapter v6");
  }
  return Object.freeze({
    role,
    model: string(object(attempt.payload.investment, "Agent Attempt Investment").model, "Agent Attempt model"),
    descriptorId: string(provider.descriptorId, "Provider descriptor identity"),
    descriptorDigest: digest(provider.descriptorDigest, "Provider descriptor digest"),
    installedIdentityDigest: digest(
      provider.installedIdentityDigest,
      "Installed provider executable identity",
    ),
    roleBriefDigest: digest(authoring.roleBriefDigest, "Role Brief digest"),
    contentInventoryDigest: digest(attemptInput.contentInventoryDigest, "Content inventory digest"),
    inputMaterialDigest: digest(attemptInput.inputMaterialDigest, "Input material digest"),
    execution: Object.freeze({
      backendProfile: object(execution.backendProfile, "Agent Attempt Backend Profile"),
      image: object(execution.image, "Agent Attempt Execution Image"),
      inputSet: object(execution.inputSet, "Agent Attempt Execution Input Set"),
    }),
    submissionPolicy,
    adjacentFilePurposes: Object.freeze(purposes as string[]),
  });
}

function mappedProviderOutcome(terminal: ExecutionReceiptProviderObservation): ProviderEffectOutcome {
  if (terminal.outcome === "natural-return" || terminal.outcome === "invalid-result") return "completed";
  if (!terminal.productiveStarted) return "not-started";
  return "failed";
}

function firstTrigger(
  terminal: ExecutionReceiptProviderObservation,
  submission: ExecutionReceiptSubmissionTrigger,
  parentLoss: "not-observed" | "contained",
): string {
  if (parentLoss !== "not-observed") return "parent-loss";
  if (submission === "explicit") return "submission";
  switch (terminal.firstTrigger) {
    case "natural-return":
    case "invalid-result": return "natural";
    case "timeout": return "timeout";
    case "cancellation":
    case "force-cancellation": return "cancellation";
    case "security-stop": return "security-stop";
    case "capability-refusal": return "not-started";
    case "safety-limit":
    case "provider-failure":
    case "runtime-failure": return "runtime-stop";
  }
}

function terminalReason(
  terminal: ExecutionReceiptProviderObservation,
  workspace: ExecutionReceiptWorkspaceObservation,
  workProductAvailable: boolean,
  providerIdentityMatches: boolean,
): string {
  if (!providerIdentityMatches) return "security-stop";
  if (workspace.availability === "available") {
    if (workspace.compilerDisposition === "retained") return "valid-submission";
    if (workspace.parserDisposition === "invalid" ||
        workspace.compilerDisposition === "invalid-result" ||
        workspace.compilerDisposition === "rejected") {
      return "invalid-submission";
    }
    if (workspace.compilerDisposition === "runtime-failure") return "runtime-failure";
  }
  if (workProductAvailable) return "valid-submission";
  switch (terminal.outcome) {
    case "natural-return": return terminal.productiveStarted ? "natural-completion" : "not-started";
    case "invalid-result": return "invalid-submission";
    case "timeout": return "timeout";
    case "cancelled": return "cancelled";
    case "forced-termination": return "forced-termination";
    case "provider-failure": return "provider-failure";
    case "capability-refusal": return "capability-refusal";
    case "security-stop": return "security-stop";
    case "runtime-failure": return "runtime-failure";
  }
}

function normalizedWorkspace(
  workspace: ExecutionReceiptWorkspaceObservation,
  workProduct: ControlRecordRevision | null,
): ControlJsonObject {
  const workProductAvailable = workProduct !== null;
  if (workspace.availability === "unavailable") {
    if (workProductAvailable) fail("workspace", "Unavailable workspace cannot have a retained Work Product");
    if (workspace.submissionDiagnostic !== null) {
      fail("workspace", "Unavailable workspace cannot carry a semantic submission diagnostic");
    }
    return Object.freeze({
      availability: "unavailable",
      rawByteLength: null,
      workspaceRawDigest: null,
      semanticMarkdownDigest: null,
      parseResultDigest: null,
      failureFactsDigest: workspace.failureFactsDigest,
      submissionDiagnostic: null,
      fixedBindingSubjectDigest: null,
      parserDisposition: "not-run",
      compilerDisposition: "not-run",
    });
  }
  if (!Number.isSafeInteger(workspace.rawByteLength) || workspace.rawByteLength < 0) {
    fail("workspace", "Available workspace requires one nonnegative safe byte length");
  }
  const submissionDiagnostic = normalizedSubmissionDiagnostic(
    workspace.submissionDiagnostic,
    "Workspace submission diagnostic",
  );
  if ((workspace.compilerDisposition === "retained") !== workProductAvailable) {
    fail("workspace", "Compiler retention and exact Work Product availability differ");
  }
  if (workspace.parserDisposition === "not-run") {
    if (
      workspace.parseResultDigest !== null || workspace.fixedBindingSubjectDigest !== null ||
      workspace.compilerDisposition !== "not-run" || workspace.failureFactsDigest !== null ||
      submissionDiagnostic !== null
    ) fail("workspace", "A parser that did not run cannot produce parse, binding, or compiler facts");
  } else if (workspace.parserDisposition === "invalid") {
    if (
      workspace.parseResultDigest !== null || workspace.fixedBindingSubjectDigest !== null ||
      workspace.compilerDisposition !== "not-run" || workspace.failureFactsDigest === null ||
      submissionDiagnostic === null ||
      submissionDiagnostic.factsDigest !== workspace.failureFactsDigest ||
      !submissionDiagnostic.code.startsWith("lifecycle.agent-work-product.invalid.") ||
      submissionDiagnostic.stage === "compiler"
    ) fail("workspace", "Invalid parser observation must retain only its exact failure facts");
  } else {
    if (
      workspace.semanticMarkdownDigest === null || workspace.parseResultDigest === null ||
      workspace.fixedBindingSubjectDigest === null
    ) {
      fail("workspace", "Valid parsing requires exact semantic, parse-result, and fixed-binding digests");
    }
    if (workspace.compilerDisposition === "not-run") {
      fail("workspace", "Valid parsing requires one exact compiler disposition");
    }
    if (workspace.compilerDisposition === "retained" && workspace.failureFactsDigest !== null) {
      fail("workspace", "Retained compilation cannot carry failure facts");
    }
    if (workspace.compilerDisposition !== "retained" && workspace.failureFactsDigest === null) {
      fail("workspace", "Failed compilation requires exact failure facts");
    }
    if (workspace.compilerDisposition === "retained" && submissionDiagnostic !== null) {
      fail("workspace", "Retained compilation cannot carry a submission diagnostic");
    }
    if (workspace.compilerDisposition !== "retained" && (
      submissionDiagnostic === null ||
      submissionDiagnostic.factsDigest !== workspace.failureFactsDigest
    )) {
      fail("workspace", "Failed compilation requires its exact submission diagnostic");
    }
    if (
      (workspace.compilerDisposition === "invalid-result" ||
        workspace.compilerDisposition === "rejected") &&
      (
        !submissionDiagnostic!.code.startsWith("lifecycle.agent-work-product.invalid.") ||
        !(submissionDiagnostic!.stage === "semantic" || submissionDiagnostic!.stage === "compiler")
      )
    ) {
      fail("workspace", "Invalid compiler result requires an exact semantic diagnostic");
    }
    if (
      workspace.compilerDisposition === "runtime-failure" &&
      (
        !submissionDiagnostic!.code.startsWith("lifecycle.agent-work-product.runtime.") ||
        submissionDiagnostic!.stage !== "compiler"
      )
    ) {
      fail("workspace", "Runtime compiler failure requires an exact compiler diagnostic");
    }
  }
  if (workProduct !== null) {
    const body = object(workProduct.payload.body, "Agent Work Product body binding");
    if (
      digest(body.digest, "Agent Work Product body digest") !== sha256Bytes(workProduct.semanticMarkdown) ||
      digest(workProduct.payload.parseResultDigest, "Agent Work Product parse-result digest") !== workspace.parseResultDigest ||
      digest(workProduct.payload.fixedBindingSubjectDigest, "Agent Work Product fixed-binding digest") !== workspace.fixedBindingSubjectDigest
    ) fail("workspace", "Workspace compiler facts differ from the exact retained Work Product");
  }
  return Object.freeze({
    ...workspace,
    submissionDiagnostic,
  });
}

/**
 * Project only the bounded semantic-submission diagnostic from one exact
 * retained Receipt. The Receipt remains the durable source; public operation
 * results and derived views do not acquire a second diagnostic authority.
 */
export function executionReceiptSubmissionDiagnostic(
  receipt: ControlRecordRevision,
): ExecutionReceiptSubmissionDiagnostic | null {
  if (receipt.recordKind !== "execution-receipt") {
    fail("submission-diagnostic", "Submission diagnostic projection requires one Execution Receipt");
  }
  const workspace = object(receipt.payload.workspace, "Execution Receipt workspace");
  const diagnostic = normalizedSubmissionDiagnostic(
    workspace.submissionDiagnostic,
    "Execution Receipt submission diagnostic",
  );
  const availability = string(workspace.availability, "Execution Receipt workspace availability");
  if (availability === "unavailable") {
    if (diagnostic !== null) {
      fail("submission-diagnostic", "Unavailable workspace carries a semantic submission diagnostic");
    }
    return null;
  }
  if (availability !== "available") {
    fail("submission-diagnostic", "Execution Receipt workspace availability is unsupported");
  }
  const failureFactsDigest = workspace.failureFactsDigest === null
    ? null
    : digest(workspace.failureFactsDigest, "Execution Receipt submission failure facts");
  const parserDisposition = string(
    workspace.parserDisposition,
    "Execution Receipt parser disposition",
  );
  const compilerDisposition = string(
    workspace.compilerDisposition,
    "Execution Receipt compiler disposition",
  );
  if (diagnostic === null) {
    if (failureFactsDigest !== null || parserDisposition === "invalid" ||
        compilerDisposition === "invalid-result" || compilerDisposition === "runtime-failure") {
      fail("submission-diagnostic", "Execution Receipt loses its exact semantic failure diagnostic");
    }
    return null;
  }
  if (diagnostic.factsDigest !== failureFactsDigest) {
    fail("submission-diagnostic", "Execution Receipt diagnostic and failure facts digests differ");
  }
  const parserFailure = parserDisposition === "invalid" && compilerDisposition === "not-run";
  const invalidCompilation = parserDisposition === "valid" &&
    (compilerDisposition === "invalid-result" || compilerDisposition === "rejected");
  const runtimeCompilation = parserDisposition === "valid" && compilerDisposition === "runtime-failure";
  if (
    parserFailure &&
    diagnostic.code.startsWith("lifecycle.agent-work-product.invalid.") &&
    diagnostic.stage !== "compiler"
  ) return diagnostic;
  if (
    invalidCompilation &&
    diagnostic.code.startsWith("lifecycle.agent-work-product.invalid.") &&
    (diagnostic.stage === "semantic" || diagnostic.stage === "compiler")
  ) return diagnostic;
  if (
    runtimeCompilation &&
    diagnostic.code.startsWith("lifecycle.agent-work-product.runtime.") &&
    diagnostic.stage === "compiler"
  ) return diagnostic;
  fail("submission-diagnostic", "Execution Receipt diagnostic contradicts parser or compiler disposition");
}

/** Resolve the one immutable Receipt retained for an exact Agent activity. */
export function executionReceiptSubmissionDiagnosticForActivity(
  store: ControlRecordStore,
  exactActivityId: string,
): ExecutionReceiptSubmissionDiagnostic | null {
  const selectedActivityId = controlIdentifier(
    exactActivityId,
    "Execution Receipt diagnostic activity identity",
  );
  const events = allEvents(store).filter((event) => activityId(event) === selectedActivityId);
  const receiptEvent = oneEvent(events, "execution-receipt-recorded", true)!;
  return executionReceiptSubmissionDiagnostic(
    exactRetainedSubject(store, receiptEvent, "execution-receipt"),
  );
}

function normalizedRawMaterials(
  values: readonly ExecutionReceiptRawMaterial[],
  declaredPurposes: readonly string[],
): Readonly<{
  payload: readonly ControlJsonObject[];
  files: readonly ControlRecordFileInput[];
}> {
  const declared = new Set(declaredPurposes);
  const byPurpose = new Map<string, ControlJsonObject>();
  const retainedFiles = new Map<string, ControlRecordFileInput>();
  for (const value of values) {
    const compiled = value.availability === "retained"
      ? compileControlRecordFile(value.file)
      : null;
    const purpose = controlIdentifier(
      value.availability === "retained" ? value.file.purpose : value.purpose,
      "Adjacent-file purpose",
    );
    if (!declared.has(purpose)) fail("raw-material", `Adjacent-file purpose ${purpose} was not declared by the Attempt`);
    const normalized: ControlJsonObject = compiled !== null
      ? Object.freeze({
          availability: "retained",
          reference: Object.freeze({
            digest: compiled.digest,
            byteLength: compiled.byteLength,
            mediaType: compiled.mediaType,
            purpose,
          }),
        })
      : Object.freeze({ availability: value.availability, purpose });
    const previous = byPurpose.get(purpose);
    if (previous !== undefined && digestCanonical(previous) !== digestCanonical(normalized)) {
      fail("raw-material", `Adjacent-file purpose ${purpose} has conflicting availability facts`);
    }
    byPurpose.set(purpose, normalized);
    if (value.availability === "retained") retainedFiles.set(purpose, value.file);
  }
  const entries = [...byPurpose.entries()].sort(([left], [right]) => compareCodePoints(left, right));
  return Object.freeze({
    payload: Object.freeze(entries.map(([, value]) => value)),
    files: Object.freeze(entries.flatMap(([purpose]) => {
      const file = retainedFiles.get(purpose);
      return file === undefined ? [] : [file];
    })),
  });
}

function normalizedExecution(
  execution: ExecutionReceiptExecutionFacts,
  attempt: AttemptFacts,
): ControlJsonObject {
  if (canonicalJson(execution.backendProfile) !== canonicalJson(attempt.execution.backendProfile) ||
      canonicalJson(execution.image) !== canonicalJson(attempt.execution.image) ||
      canonicalJson(execution.inputSet) !== canonicalJson(attempt.execution.inputSet)) {
    fail("execution", "Execution facts do not bind the exact Backend Profile, Image, and Input Set selected by the Attempt");
  }
  digest(execution.specificationDigest, "Execution Specification digest");
  digest(execution.runnerDigest, "Execution runner digest");
  digest(execution.observationDigest, "Execution Observation digest");
  const output = execution.output;
  if (output.availability === "retrieved") {
    if (!Number.isSafeInteger(output.carrierByteLength) || output.carrierByteLength < 0) {
      fail("execution-output", "Retrieved Execution output requires one nonnegative safe byte length");
    }
    digest(output.carrierDigest, "Execution Output Carrier digest");
    digest(output.manifestDigest, "Execution Output Manifest digest");
  } else if (output.carrierByteLength !== null || output.carrierDigest !== null ||
      output.manifestDigest !== null) {
    fail("execution-output", "Unavailable Execution output cannot carry placeholder byte or digest facts");
  }
  return Object.freeze({
    backendProfile: Object.freeze({ ...execution.backendProfile }),
    image: Object.freeze({ ...execution.image }),
    inputSet: Object.freeze({ ...execution.inputSet }),
    specificationDigest: execution.specificationDigest,
    runnerDigest: execution.runnerDigest,
    observationDigest: execution.observationDigest,
    output: Object.freeze({ ...output }),
  });
}

function candidateBinding(revision: ControlRecordRevision): ControlJsonObject {
  if (revision.recordKind !== "candidate-revision" ||
      revision.payload.schema !== "lifecycle.candidate-revision-payload.v3") {
    fail("candidate", "Execution Receipt Candidate binding requires one Candidate Revision with the selected v3 payload");
  }
  const carrier = object(revision.payload.carrierManifest, "Candidate Revision Carrier manifest");
  return Object.freeze({
    revision: reference(revision),
    carrierManifestDigest: digest(carrier.digest, "Candidate Revision Carrier manifest digest"),
  });
}

function normalizedCandidate(input: Readonly<{
  role: AgentRole;
  records: ActivityRecords;
  successorDisposition: "promoted" | "not-produced" | "unavailable" | "invalid" | null;
  outputAvailability: ExecutionReceiptExecutionFacts["output"]["availability"];
}>): ControlJsonObject {
  if (input.role === "reconnaissance") {
    if (input.records.inputCandidate !== null || input.records.successorCandidate !== null ||
        input.successorDisposition !== null) {
      fail("candidate", "Reconnaissance Receipt cannot bind Candidate input or successor facts");
    }
    return Object.freeze({
      input: null,
      successorDisposition: null,
      successor: null,
      contentDisposition: null,
    });
  }
  if (input.records.inputCandidate === null) {
    fail("candidate", `${input.role} Receipt lacks its exact input Candidate Revision`);
  }
  const candidateInput = candidateBinding(input.records.inputCandidate);
  if (input.role === "reviewer") {
    if (input.records.successorCandidate !== null || input.successorDisposition !== null) {
      fail("candidate", "Reviewer Receipt cannot bind Candidate successor facts");
    }
    return Object.freeze({
      input: candidateInput,
      successorDisposition: null,
      successor: null,
      contentDisposition: null,
    });
  }
  if (input.successorDisposition === null) {
    fail("candidate", "Builder Receipt requires one exact Candidate successor disposition");
  }
  const expectedOutputAvailability = input.successorDisposition === "promoted" ||
    input.successorDisposition === "invalid"
    ? "retrieved"
    : input.successorDisposition;
  if (input.outputAvailability !== expectedOutputAvailability) {
    fail("candidate", "Builder Candidate successor disposition contradicts Execution output availability");
  }
  if (input.successorDisposition !== "promoted") {
    if (input.records.successorCandidate !== null) {
      fail("candidate", "A non-promoted builder result cannot retain a Candidate successor");
    }
    return Object.freeze({
      input: candidateInput,
      successorDisposition: input.successorDisposition,
      successor: null,
      contentDisposition: null,
    });
  }
  if (input.records.successorCandidate === null) {
    fail("candidate", "Promoted builder output lacks its exact retained Candidate successor");
  }
  const state = object(input.records.successorCandidate.payload.state, "Builder Candidate successor state");
  if (typeof state.unchangedFromPredecessor !== "boolean") {
    fail("candidate", "Builder Candidate successor lacks exact content-disposition state");
  }
  return Object.freeze({
    input: candidateInput,
    successorDisposition: "promoted",
    successor: candidateBinding(input.records.successorCandidate),
    contentDisposition: state.unchangedFromPredecessor ? "unchanged" : "changed",
  });
}

/** Reopen the Receipt-owned input/optional-successor facts for builder finalization. */
export function assertBuilderExecutionReceiptCandidateSubjects(input: Readonly<{
  receipt: ControlRecordRevision;
  inputCandidate: ControlRecordRevision;
  resultCandidate: ControlRecordRevision;
}>): "promoted" | "invalid" | "unavailable" | "not-produced" {
  if (input.receipt.recordKind !== "execution-receipt" || input.receipt.payload.role !== "builder") {
    fail("candidate", "Builder Candidate finalization requires its exact builder Receipt");
  }
  const candidate = object(input.receipt.payload.candidate, "Builder Receipt Candidate outcome");
  if (canonicalJson(candidate.input) !== canonicalJson(candidateBinding(input.inputCandidate))) {
    fail("candidate", "Builder Receipt does not bind the exact input Candidate and Carrier");
  }
  const observed = relationshipTarget(input.receipt, "observes-candidate", "candidate-revision", false);
  const disposition = candidate.successorDisposition;
  if (disposition === "promoted") {
    if (observed === null || !sameReference(observed, reference(input.resultCandidate)) ||
      canonicalJson(candidate.successor) !== canonicalJson(candidateBinding(input.resultCandidate))) {
      fail("candidate", "Builder Receipt does not bind the exact promoted Candidate and Carrier");
    }
  } else if (
    (disposition !== "invalid" && disposition !== "unavailable" && disposition !== "not-produced") ||
    candidate.successor !== null || candidate.contentDisposition !== null || observed !== null ||
    !sameReference(reference(input.inputCandidate), reference(input.resultCandidate))
  ) {
    fail("candidate", "A non-promoted builder Receipt must preserve its exact input Candidate");
  }
  return disposition;
}

function normalizedContainment(
  containment: ExecutionReceiptContainment,
  provider: ExecutionReceiptProviderObservation,
): ControlJsonObject {
  digest(containment.factsDigest, "Execution Containment facts digest");
  if (containment.forced && !containment.cancellationRequested) {
    fail("containment", "Forced Execution Containment requires a cancellation request");
  }
  if ((provider.outcome === "cancelled" || provider.outcome === "forced-termination") &&
      !containment.cancellationRequested) {
    fail("containment", "Cancelled provider execution requires requested Containment");
  }
  if (provider.outcome === "forced-termination" && !containment.forced) {
    fail("containment", "Forced provider termination requires forced Containment");
  }
  return Object.freeze({
    classification: "contained",
    factsDigest: containment.factsDigest,
    cancellationRequested: containment.cancellationRequested,
    forced: containment.forced,
    parentLoss: containment.parentLoss,
  });
}

function normalizedRetirement(retirement: ExecutionReceiptRetirement): ControlJsonObject {
  digest(retirement.factsDigest, "Execution Retirement facts digest");
  if ((retirement.residualClass === "none") !== (retirement.residualFactsDigest === null)) {
    fail("retirement", "Execution Retirement residual class and facts digest disagree");
  }
  if (retirement.residualFactsDigest !== null) {
    digest(retirement.residualFactsDigest, "Execution Retirement residual facts digest");
  }
  return Object.freeze({
    classification: "retired",
    factsDigest: retirement.factsDigest,
    residualClass: retirement.residualClass,
    residualFactsDigest: retirement.residualFactsDigest,
  });
}

function recordIdentity(store: ControlRecordStore, activity: string, attempt: ControlRecordRevision): string {
  const suffix = digestCanonical({
    recordKind: "execution-receipt",
    storeId: store.identity.storeId,
    processId: store.identity.processId,
    activityId: activity,
    attemptDigest: attempt.digest,
  }).slice("sha256:".length);
  return `execution-receipt-${suffix}`;
}

function eventIdentity(store: ControlRecordStore, activity: string, receiptId: string): string {
  const suffix = digestCanonical({
    eventKind: "execution-receipt-recorded",
    storeId: store.identity.storeId,
    processId: store.identity.processId,
    activityId: activity,
    receiptId,
  }).slice("sha256:".length);
  return `event-execution-receipt-recorded-${suffix}`;
}

function semanticMarkdown(input: Readonly<{
  role: AgentRole;
  providerOutcome: ProviderEffectOutcome;
  terminalReason: string;
  workProductAvailable: boolean;
  candidateSuccessorDisposition: string | null;
  submissionDiagnostic: ExecutionReceiptSubmissionDiagnostic | null;
  rawProviderMaterialRetained: boolean;
}>): string {
  return [
    "# Execution Receipt",
    "",
    `- Attempt role: ${input.role}`,
    `- Provider effect: ${input.providerOutcome}`,
    `- Terminal reason: ${input.terminalReason}`,
    `- Work Product retained: ${input.workProductAvailable ? "yes" : "no"}`,
    `- Candidate successor: ${input.candidateSuccessorDisposition ?? "not-applicable"}`,
    `- Submission diagnostic: ${input.submissionDiagnostic === null
      ? "none"
      : `${input.submissionDiagnostic.code} · ${input.submissionDiagnostic.stage} · ${input.submissionDiagnostic.factsDigest}`}`,
    "- Execution Containment: contained",
    "- Execution Retirement: retired",
    "",
    "This Receipt is the runtime-observed terminal account of one exact Agent Attempt.",
    ...(input.rawProviderMaterialRetained ? [
      "",
      "Bounded provider-reported material is retained through the rawMaterials file descriptor. Its contents are untrusted operational material, not Runtime terminal facts or an Agent Work Product.",
    ] : []),
    "",
  ].join("\n");
}

/**
 * Compile and atomically retain one runtime-observed terminal Receipt from the
 * exact durable activity facts. Callers supply observations, never Control
 * identities, relationships, availability flags, or digests of this record.
 */
export async function retainExecutionReceipt(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  provider: ExecutionReceiptProviderObservation;
  submissionTrigger: ExecutionReceiptSubmissionTrigger;
  execution: ExecutionReceiptExecutionFacts;
  workspace: ExecutionReceiptWorkspaceObservation;
  candidateSuccessorDisposition: "promoted" | "not-produced" | "unavailable" | "invalid" | null;
  containment: ExecutionReceiptContainment;
  retirement: ExecutionReceiptRetirement;
  rawMaterials?: readonly ExecutionReceiptRawMaterial[];
  runtime: ExecutionReceiptRuntimeCoordinates;
  recordedAt: string;
  runtimeId: string;
}>): Promise<Readonly<{ revision: ControlRecordRevision; event: ControlRecordEvent }>> {
  const exactActivityId = controlIdentifier(input.activityId, "Execution Receipt activity identity");
  controlTimestamp(input.provider.preparedAt, "Provider preparation time");
  if (input.provider.startedAt !== null) controlTimestamp(input.provider.startedAt, "Provider start time");
  if (input.provider.finishedAt !== null) controlTimestamp(input.provider.finishedAt, "Provider finish time");
  controlTimestamp(input.recordedAt, "Execution Receipt time");
  const preparedTime = Date.parse(input.provider.preparedAt);
  const startedTime = input.provider.startedAt === null ? null : Date.parse(input.provider.startedAt);
  const finishedTime = input.provider.finishedAt === null ? null : Date.parse(input.provider.finishedAt);
  const recordedTime = Date.parse(input.recordedAt);
  if (
    (input.provider.productiveStarted && (input.provider.startedAt === null ||
      input.provider.finishedAt === null)) ||
    ((input.provider.outcome === "natural-return" || input.provider.outcome === "invalid-result") &&
      !input.provider.productiveStarted) ||
    (startedTime !== null && startedTime < preparedTime) ||
    (finishedTime !== null && finishedTime < (startedTime ?? preparedTime)) ||
    recordedTime < (finishedTime ?? preparedTime)
  ) fail("time", "Provider preparation, productive start, finish, and Receipt times are incoherent");

  const records = activityRecords(input.store, exactActivityId);
  const facts = attemptFacts(records.attempt);
  if (records.workProduct !== null && records.workProduct.payload.role !== facts.role) {
    fail("relationship", "Agent Work Product role differs from the exact Agent Attempt role");
  }
  const providerOutcome = mappedProviderOutcome(input.provider);
  if (providerOutcome !== records.providerOutcome) {
    fail("provider-effect", "Provider terminal classification differs from the durable effect observation");
  }
  const providerIdentityMatches =
    input.provider.executableIdentity === facts.installedIdentityDigest;
  if (
    !providerIdentityMatches &&
    (records.workProduct !== null || input.submissionTrigger !== null)
  ) {
    fail(
      "provider-identity",
      "A mismatched provider executable identity cannot produce a governed semantic submission",
    );
  }
  if (
    input.submissionTrigger === "clean-natural-completion" &&
    (facts.submissionPolicy !== "explicit-or-clean-natural-completion" ||
      input.provider.outcome !== "natural-return" || input.provider.firstTrigger !== "natural-return")
  ) fail("submission", "Clean natural completion is not eligible under this exact Attempt");
  if (input.submissionTrigger !== null && input.workspace.availability === "unavailable") {
    fail("submission", "Unavailable workspace cannot report a semantic submission trigger");
  }
  if (records.workProduct !== null && input.submissionTrigger === null) {
    fail("submission", "Retained Work Product requires one governed submission trigger");
  }
  if (input.provider.outcome === "invalid-result" && records.workProduct !== null) {
    fail("submission", "Invalid provider result cannot retain a Work Product");
  }
  const workspace = normalizedWorkspace(input.workspace, records.workProduct);
  const reason = terminalReason(
    input.provider,
    input.workspace,
    records.workProduct !== null,
    providerIdentityMatches,
  );
  const execution = normalizedExecution(input.execution, facts);
  const candidate = normalizedCandidate({
    role: facts.role,
    records,
    successorDisposition: input.candidateSuccessorDisposition,
    outputAvailability: input.execution.output.availability,
  });
  const containment = normalizedContainment(input.containment, input.provider);
  const retirement = normalizedRetirement(input.retirement);
  assertFoundationBuilderRepairMaterialsV1({ store: input.store, attempt: records.attempt, candidate: records.inputCandidate,
    successorDisposition: input.candidateSuccessorDisposition, materials: input.rawMaterials ?? [] });
  const rawMaterials = normalizedRawMaterials(
    input.rawMaterials ?? [],
    facts.adjacentFilePurposes,
  );
  const sessionId = input.provider.sessionId;
  if (sessionId !== null) controlIdentifier(sessionId, "Provider session identity");
  const inputAvailable = input.provider.productiveStarted;
  const payload: ControlJsonObject = Object.freeze({
    schema: "lifecycle.execution-receipt-payload.v3",
    activityId: exactActivityId,
    role: facts.role,
    providerEffect: Object.freeze({ effectDigest: records.effectDigest, outcome: providerOutcome }),
    productiveExecutionStarted: input.provider.productiveStarted,
    inputBindings: Object.freeze({
      roleBriefDigest: inputAvailable ? facts.roleBriefDigest : null,
      contentInventoryDigest: inputAvailable ? facts.contentInventoryDigest : null,
      inputMaterialDigest: inputAvailable ? facts.inputMaterialDigest : null,
    }),
    provider: Object.freeze({
      descriptorId: facts.descriptorId,
      descriptorDigest: facts.descriptorDigest,
      adapter: "lifecycle.provider-adapter.v7",
      installedIdentityDigest: facts.installedIdentityDigest,
      observedExecutableIdentity: input.provider.executableIdentity,
      model: facts.model,
      sessionId,
      firstTrigger: firstTrigger(
        input.provider,
        input.submissionTrigger,
        input.containment.parentLoss,
      ),
      terminalReason: reason,
      stage: input.provider.stage,
      startedAt: input.provider.startedAt,
      finishedAt: input.provider.finishedAt,
      exitCode: input.provider.exitCode,
      signal: input.provider.signal,
    }),
    execution,
    workspace,
    workProduct: records.workProduct === null
      ? Object.freeze({ disposition: "abandoned", reference: null })
      : Object.freeze({ disposition: "submitted", reference: reference(records.workProduct) }),
    candidate,
    containment,
    retirement,
    rawMaterials: rawMaterials.payload,
    runtime: Object.freeze({ ...input.runtime }),
  });
  const receiptId = recordIdentity(input.store, exactActivityId, records.attempt);
  const relationships: readonly ControlRecordRelationship[] = Object.freeze([
    Object.freeze({ relation: "observes-attempt", target: reference(records.attempt) }),
    ...(records.workProduct === null
      ? []
      : [Object.freeze({ relation: "observes-work-product", target: reference(records.workProduct) })]),
    ...(records.successorCandidate === null
      ? []
      : [Object.freeze({
          relation: "observes-candidate",
          target: reference(records.successorCandidate),
        })]),
  ]);
  const revisionInput = Object.freeze({
    recordId: receiptId,
    recordKind: "execution-receipt",
    revision: 1,
    producer: Object.freeze({ kind: "runtime" as const, id: input.runtimeId }),
    semanticAuthor: Object.freeze({ kind: "runtime" as const, id: input.runtimeId }),
    semanticAuthority: "runtime-observed" as const,
    createdAt: input.recordedAt,
    semanticMarkdown: semanticMarkdown({
      role: facts.role,
      providerOutcome,
      terminalReason: reason,
      workProductAvailable: records.workProduct !== null,
      candidateSuccessorDisposition: input.candidateSuccessorDisposition,
      submissionDiagnostic: input.workspace.submissionDiagnostic,
      rawProviderMaterialRetained: rawMaterials.files.some(({ purpose }) => purpose === "raw-provider-output"),
    }),
    payload,
    relationships,
  });
  const compiled = compileControlRecordRevision(input.store.identity.processId, revisionInput);
  assertDeliveryControlRecordPolicy(compiled);
  assertDeliveryControlRecordPayload(compiled);
  const append: ControlRecordStoreAppend = Object.freeze({
    revision: revisionInput,
    event: {
      eventId: eventIdentity(input.store, exactActivityId, receiptId),
      eventKind: "execution-receipt-recorded",
      occurredAt: input.recordedAt,
      actor: { kind: "runtime" as const, id: input.runtimeId },
      subject: { recordId: compiled.recordId, revision: compiled.revision, digest: compiled.digest },
      payload: { activityId: exactActivityId },
    },
  });
  const retained = rawMaterials.files.length === 0
    ? input.store.append(append)
    : (await input.store.appendWithFiles({
        files: rawMaterials.files,
        appends: [append],
      })).appends[0]!;
  if (retained.revision === null) fail("retention", "Execution Receipt revision was not retained");
  return Object.freeze({ revision: retained.revision, event: retained.event });
}
