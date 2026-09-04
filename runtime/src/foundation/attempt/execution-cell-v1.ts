import { setTimeout as delay } from "node:timers/promises";
import {
  parseCandidateRevisionCarrierManifest,
} from "../candidate/carrier-manifest.js";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
} from "../candidate/carrier-types.js";
import {
  publishCandidateRevisionCarrierFromCandidateOutput,
  type FoundationPublishedCandidateOutputCarrierV1,
} from "../candidate/candidate-output-carrier.js";
import {
  compileAgentPreIntentRefusalAppend,
  compileProviderEffectIntentBesideAttemptAppend,
} from "../control/activity.js";
import type {
  ExecutionReceiptContainment,
  ExecutionReceiptExecutionFacts,
  ExecutionReceiptProviderObservation,
  ExecutionReceiptRetirement,
} from "../control/execution-receipt.js";
import {
  compileControlRecordRevision,
  controlIdentifier,
} from "../control/model.js";
import type { ControlRecordStore } from "../control/store.js";
import type {
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordEvent,
  ControlRecordEventInput,
  ControlRecordStoreAppend,
  ControlRecordStoreAppendResult,
  ControlRecordRevision,
} from "../control/types.js";
import { FoundationError } from "../error.js";
import type { FoundationExecutionBackend } from "../execution/backend.js";
import {
  parseFoundationExecutionBackendProfile,
  parseFoundationExecutionSpecification,
  type FoundationExecutionBackendProfileV1,
  type FoundationExecutionImageReferenceV1,
  type FoundationExecutionSpecificationV1,
} from "../execution/contracts.js";
import {
  compileFoundationExecutionInputSet,
  parseFoundationExecutionInputSet,
  type FoundationExecutionInputCandidateBindingV1,
  type FoundationExecutionInputEntryPlanV1,
  type FoundationExecutionInputResolverV1,
  type FoundationExecutionInputSetV1,
  type FoundationExecutionInputSubjectKindV1,
  type FoundationExecutionInputSubjectV1,
  type FoundationVerifiedExecutionInputEntryV1,
  type FoundationVerifiedExecutionInputSubjectV1,
} from "../execution/input-set.js";
import {
  FoundationExecutionOperationHostV1,
  type FoundationExecutionOwnerTerminalCompletionResultV1,
  type FoundationExecutionPreDispatchCommitV1,
  type FoundationExecutionOperationCheckpointCoordinateV1,
  type FoundationExecutionOperationCheckpointPersistenceV1,
  type FoundationExecutionOperationCheckpointV1,
  type FoundationRetainedExecutionOperationCheckpointV1,
} from "../execution/operation-host.js";
import type { FoundationExecutionOutputStoreV1 } from "../execution/output-store-v1.js";
import type {
  FoundationExecutionReclamationLedgerV1,
} from "../execution/reclamation-ledger-v1.js";
import {
  reopenFoundationValidatedExecutionOutput,
  type FoundationValidatedExecutionOutputArtifactV1,
  type FoundationValidatedExecutionOutputV1,
} from "../execution/output-validation.js";
import type { FoundationGitObjectFormat } from "../repository/types.js";
import {
  canonicalJson,
  digestCanonical,
  selfDigest,
  sha256Bytes,
  type Sha256,
} from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import {
  FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1,
  foundationAgentExecutionCellOutputContractV1,
  inspectFoundationAgentExecutionCellOutputV1,
  observeFoundationAgentProviderTerminalCompletionV1,
  readFoundationAgentProviderResultV1,
  readFoundationAgentProviderTerminalObservationV1,
  type FoundationAgentExecutionCellOwnedOutputV1,
  type FoundationAgentExecutionCellProviderResultV1,
  type FoundationAgentExecutionCellProviderTerminalObservationV1,
  type FoundationAgentExecutionCellRoleV1,
} from "../../util/agent-execution-cell-operation-v1.js";

const MAXIMUM_OPERATION_STEPS = 100_000;
const MAXIMUM_INPUT_SUBJECTS = 64;
const MAXIMUM_INPUT_ENTRIES = 4_096;
const MAXIMUM_INPUT_ITEM_BYTES = 512 * 1024 * 1024;
const MAXIMUM_INPUT_AGGREGATE_BYTES = 1024 * 1024 * 1024;
const MAXIMUM_ACTIVITY_EVENTS = 100_000;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

export const FOUNDATION_AGENT_EXECUTION_CELL_INPUT_V1 = Object.freeze({
  candidateManifestPath: "candidate/carrier-manifest.json" as const,
  candidateArtifactPath: "candidate/carrier.pack" as const,
  roleBriefPath: "role-brief.md" as const,
  semanticTemplatePath: "semantic/template.md" as const,
});

export type FoundationAgentCellImageV1 = FoundationExecutionImageReferenceV1 & Readonly<{
  runnerContractDigest: Sha256;
  runnerImplementationDigest: Sha256;
  toolInventoryDigest: Sha256;
}>;

export type FoundationAgentCellImmutableSubjectV1 = Readonly<{
  subject: FoundationExecutionInputSubjectV1;
  bytes: Uint8Array;
  candidateBinding: FoundationExecutionInputCandidateBindingV1 | null;
}>;

export type FoundationAgentCellImmutableEntryV1 = Readonly<{
  plan: FoundationExecutionInputEntryPlanV1;
  bytes: Uint8Array;
}>;

export type FoundationAgentCellTransportEntryV1 = Readonly<{
  path: string;
  purpose: FoundationExecutionInputEntryPlanV1["purpose"];
  mediaType: string;
  modeClass: "regular" | "executable";
  sourceSubjectDigest: Sha256;
  byteLength: number;
  digest: Sha256;
  bytes: Uint8Array;
}>;

export type FoundationCompiledAgentCellInputV1 = Readonly<{
  inputSet: FoundationExecutionInputSetV1;
  resolver: FoundationExecutionInputResolverV1;
  transportEntries: readonly FoundationAgentCellTransportEntryV1[];
}>;

export type FoundationAgentCellAttemptPreparationV1 = Readonly<{
  revision: ControlRecordRevision;
  append: ControlRecordStoreAppend;
}>;

/** Trusted installed selection. Caller policy prose is not accepted. */
export type FoundationAgentCellInstalledInputsV1 = Readonly<{
  profile: FoundationExecutionBackendProfileV1;
  image: FoundationAgentCellImageV1;
  provider: Readonly<{
    descriptorId: string;
    descriptorDigest: Sha256;
    executableIdentityClass: string;
    installedIdentityDigest: Sha256;
  }>;
  adapterImplementationDigest: Sha256;
  environment: FoundationExecutionSpecificationV1["environment"];
  capabilities: Readonly<{
    temporaryWrites: boolean;
    subprocesses: "none" | "repository-toolchain";
    externalEffects: boolean;
  }>;
  networkPolicy: FoundationExecutionSpecificationV1["networkPolicy"];
  credentialPolicy: FoundationExecutionSpecificationV1["credentialPolicy"];
}>;

export type FoundationAgentCellPersistenceBindingV1 = Readonly<{
  storeId: string;
  processId: string;
  activityId: string;
  attempt: Readonly<{ id: string; revision: number; digest: Sha256 }>;
  inputSetDigest: Sha256;
  specificationDigest: Sha256;
  digest: Sha256;
}>;

export type FoundationAgentCellDispatchOwnerCommitResultV1 = Readonly<{
  retained: FoundationRetainedExecutionOperationCheckpointV1;
  appends: readonly [ControlRecordStoreAppendResult, ControlRecordStoreAppendResult];
}>;

export type FoundationAgentCellPreIntentRefusalCommitResultV1 = Readonly<{
  retained: FoundationRetainedExecutionOperationCheckpointV1;
  append: ControlRecordStoreAppendResult;
}>;

/**
 * Activity-owned persistence. Support-only open/allocation may use `commitSupport`.
 * The sole null-to-consumed dispatch transition must use `ownerCommitDispatch`,
 * whose implementation atomically commits the proposed child and ordered
 * Attempt/effect-intent appends in the owning Activity transaction.
 */
export type FoundationAgentCellActivityOwnerV1 = Readonly<{
  read(
    binding: FoundationAgentCellPersistenceBindingV1,
  ): Promise<FoundationRetainedExecutionOperationCheckpointV1 | null>;
  commitSupport(input: Readonly<{
    binding: FoundationAgentCellPersistenceBindingV1;
    expected: FoundationExecutionOperationCheckpointCoordinateV1 | null;
    checkpoint: FoundationExecutionOperationCheckpointV1;
  }>): Promise<FoundationRetainedExecutionOperationCheckpointV1>;
  ownerCommitDispatch(input: Readonly<{
    binding: FoundationAgentCellPersistenceBindingV1;
    expected: FoundationExecutionOperationCheckpointCoordinateV1;
    checkpoint: FoundationExecutionOperationCheckpointV1;
    attempt: FoundationAgentCellAttemptPreparationV1;
    appends: readonly [ControlRecordStoreAppend, ControlRecordStoreAppend];
  }>): Promise<FoundationAgentCellDispatchOwnerCommitResultV1>;
  ownerCommitPreIntentRefusal(input: Readonly<{
    binding: FoundationAgentCellPersistenceBindingV1;
    expected: FoundationExecutionOperationCheckpointCoordinateV1;
    checkpoint: FoundationExecutionOperationCheckpointV1;
    append: ControlRecordStoreAppend;
  }>): Promise<FoundationAgentCellPreIntentRefusalCommitResultV1>;
}>;

export type FoundationAgentCellSemanticValidatorV1 = (
  input: Readonly<{
    attempt: ControlRecordRevision;
    inputSet: FoundationExecutionInputSetV1;
    specification: FoundationExecutionSpecificationV1;
    output: FoundationValidatedExecutionOutputV1;
    artifact: FoundationValidatedExecutionOutputArtifactV1;
  }>,
) => Promise<Readonly<{ disposition: "valid" | "invalid" }>>;

export type FoundationAgentCellRuntimeV1 = Readonly<{
  machineHome: string;
  backend: FoundationExecutionBackend;
  registerOperation(input: Readonly<{
    specification: FoundationExecutionSpecificationV1;
    persistence: FoundationExecutionOperationCheckpointPersistenceV1;
  }>): void;
  outputStore: FoundationExecutionOutputStoreV1;
  reclamation: FoundationExecutionReclamationLedgerV1;
  clock: Readonly<{ now(): string }>;
  pollMilliseconds?: number;
  publishCandidateOutput?: typeof publishCandidateRevisionCarrierFromCandidateOutput;
}>;

export type FoundationAgentCellOperationInputV1 = Readonly<{
  store: ControlRecordStore;
  activityId: string;
  attempt: FoundationAgentCellAttemptPreparationV1;
  compiledInput: FoundationCompiledAgentCellInputV1;
  installed: FoundationAgentCellInstalledInputsV1;
  activityOwner: FoundationAgentCellActivityOwnerV1;
  revalidateBeforeIntent(input: Readonly<{
    attempt: ControlRecordRevision;
    inputSet: FoundationExecutionInputSetV1;
    specification: FoundationExecutionSpecificationV1;
  }>): Promise<void>;
  validateSemanticOutput: FoundationAgentCellSemanticValidatorV1;
  runtime: FoundationAgentCellRuntimeV1;
}>;

export type FoundationAgentCellSemanticDispositionV1 = Readonly<{
  disposition: "valid" | "invalid" | "not-produced" | "unavailable";
  artifact: FoundationValidatedExecutionOutputArtifactV1 | null;
}>;

export type FoundationAgentCellCandidateDispositionV1 = Readonly<{
  disposition: "valid" | "invalid" | "not-applicable" | "unavailable";
  carrier: FoundationPublishedCandidateOutputCarrierV1 | null;
}>;

export type FoundationAgentCellReceiptFactsV1 = Readonly<{
  provider: ExecutionReceiptProviderObservation | null;
  execution: ExecutionReceiptExecutionFacts;
  containment: ExecutionReceiptContainment;
  retirement: ExecutionReceiptRetirement;
}>;

export type FoundationAgentCellOperationResultV1 = Readonly<{
  preIntentRefused: boolean;
  specification: FoundationExecutionSpecificationV1;
  inputSet: FoundationExecutionInputSetV1;
  validatedOutput: FoundationValidatedExecutionOutputV1 | null;
  providerResult: FoundationAgentExecutionCellProviderResultV1 | null;
  semantic: FoundationAgentCellSemanticDispositionV1;
  candidate: FoundationAgentCellCandidateDispositionV1;
  receiptFacts: FoundationAgentCellReceiptFactsV1;
  terminal: Readonly<{
    observationDigest: Sha256;
    containmentDigest: Sha256;
    outputDigest: Sha256;
    outputValidation: "not-applicable" | "valid" | "invalid" | "unavailable";
    retirementDigest: Sha256;
    reclamationObligationDigest: Sha256;
  }>;
}>;

type AttemptFacts = Readonly<{
  role: FoundationAgentExecutionCellRoleV1;
  provider: ControlJsonObject;
  capability: ControlJsonObject;
  investment: ControlJsonObject;
  authoring: ControlJsonObject;
  attemptInput: ControlJsonObject;
  executionPolicy: ControlJsonObject;
}>;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.agent-execution-cell-v1.${code}`, message);
}

function object(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== "object") {
    fail("attempt", `${label} must be one exact object`);
  }
  return value as ControlJsonObject;
}

function text(value: ControlJsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0) fail("attempt", `${label} must be text`);
  return value;
}

function exactDigest(value: ControlJsonValue | undefined, label: string): Sha256 {
  const selected = text(value, label);
  if (!SHA256.test(selected)) fail("attempt", `${label} must be one exact SHA-256 digest`);
  return selected as Sha256;
}

function exactRole(value: ControlJsonValue | undefined): FoundationAgentExecutionCellRoleV1 {
  if (value !== "reconnaissance" && value !== "builder" && value !== "reviewer") {
    return fail("attempt", "Agent Attempt role is unsupported");
  }
  return value;
}

function canonicalCopy<Value>(value: Value): Value {
  return JSON.parse(canonicalJson(value)) as Value;
}

function safeAdd(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result) || result > MAXIMUM_INPUT_AGGREGATE_BYTES) {
    fail("input-bound", `${label} exceeds the fixed aggregate input-byte bound`);
  }
  return result;
}

export function foundationAgentCellAttemptIdV1(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
}>): string {
  const activityId = controlIdentifier(input.activityId, "Agent Cell activity identity");
  const suffix = digestCanonical({
    recordKind: "agent-attempt",
    storeId: input.store.identity.storeId,
    processId: input.store.identity.processId,
    activityId,
  }).slice("sha256:".length);
  return `agent-attempt-${suffix}`;
}

function boundedImmutableInput(input: Readonly<{
  subjects: readonly FoundationAgentCellImmutableSubjectV1[];
  entries: readonly FoundationAgentCellImmutableEntryV1[];
}>): Readonly<{
  subjects: readonly FoundationAgentCellImmutableSubjectV1[];
  entries: readonly FoundationAgentCellImmutableEntryV1[];
}> {
  if (!Array.isArray(input.subjects) || input.subjects.length < 1 ||
      input.subjects.length > MAXIMUM_INPUT_SUBJECTS || !Array.isArray(input.entries) ||
      input.entries.length < 1 || input.entries.length > MAXIMUM_INPUT_ENTRIES) {
    fail("input-bound", "Agent input counts exceed their fixed pre-copy bounds");
  }
  const subjects = input.subjects.map((raw) => Object.freeze({
    subject: raw.subject,
    bytes: raw.bytes,
    candidateBinding: raw.candidateBinding,
  }));
  const entries = input.entries.map((raw) => Object.freeze({
    plan: raw.plan,
    bytes: raw.bytes,
  }));
  let aggregate = 0;
  for (const value of [...subjects, ...entries]) {
    const byteLength = value.bytes instanceof Uint8Array ? value.bytes.byteLength : -1;
    if (byteLength < 1 || byteLength > MAXIMUM_INPUT_ITEM_BYTES) {
      fail("input-bound", "Agent input item exceeds its fixed pre-copy byte bound");
    }
    aggregate = safeAdd(aggregate, byteLength, "Agent inputs");
  }
  return Object.freeze({
    subjects: Object.freeze(subjects.map((raw) => Object.freeze({
      subject: canonicalCopy(raw.subject),
      bytes: Uint8Array.from(raw.bytes),
      candidateBinding: raw.candidateBinding === null
        ? null
        : Object.freeze({ ...raw.candidateBinding }),
    }))),
    entries: Object.freeze(entries.map((raw) => Object.freeze({
      plan: canonicalCopy(raw.plan),
      bytes: Uint8Array.from(raw.bytes),
    }))),
  });
}

function immutableInputResolver(input: Readonly<{
  subjects: readonly FoundationAgentCellImmutableSubjectV1[];
  entries: readonly FoundationAgentCellImmutableEntryV1[];
}>): FoundationExecutionInputResolverV1 {
  const subjects = new Map(input.subjects.map((raw) => [raw.subject.digest, raw]));
  const entries = new Map(input.entries.map((raw) => [raw.plan.path, raw]));
  if (subjects.size !== input.subjects.length || entries.size !== input.entries.length) {
    fail("input-substitution", "Agent inputs repeat a logical subject digest or entry path");
  }
  return Object.freeze({
    async verifySubject(subject): Promise<FoundationVerifiedExecutionInputSubjectV1> {
      const retained = subjects.get(subject.digest);
      if (retained === undefined || canonicalJson(retained.subject) !== canonicalJson(subject)) {
        fail("input-substitution", `Agent Input Set substituted ${subject.kind}`);
      }
      const bytes = Uint8Array.from(retained.bytes);
      return Object.freeze({
        subject,
        immutable: true,
        byteLength: bytes.byteLength,
        bytesDigest: sha256Bytes(bytes),
        bytes,
        candidateBinding: retained.candidateBinding,
      });
    },
    async verifyEntry(plan): Promise<FoundationVerifiedExecutionInputEntryV1> {
      const retained = entries.get(plan.path);
      if (retained === undefined || canonicalJson(retained.plan) !== canonicalJson(plan)) {
        fail("input-substitution", `Agent Input Set substituted entry ${plan.path}`);
      }
      const bytes = Uint8Array.from(retained.bytes);
      return Object.freeze({
        descriptor: Object.freeze({
          ...plan,
          byteLength: bytes.byteLength,
          digest: sha256Bytes(bytes),
        }),
        immutable: true,
        bytes,
      });
    },
  });
}

/** Compile exact immutable Agent inputs before the Attempt itself is retained. */
export async function compileFoundationAgentCellInputV1(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  role: FoundationAgentExecutionCellRoleV1;
  ownerSubjectDigest: Sha256;
  inputMaterialDigest: Sha256;
  subjects: readonly FoundationAgentCellImmutableSubjectV1[];
  entries: readonly FoundationAgentCellImmutableEntryV1[];
  runnerContractDigest: Sha256;
  toolInventoryDigest: Sha256;
}>): Promise<FoundationCompiledAgentCellInputV1> {
  const retained = boundedImmutableInput(input);
  const resolver = immutableInputResolver(retained);
  const inputSet = await compileFoundationExecutionInputSet({
    owner: Object.freeze({
      kind: "agent-attempt" as const,
      activityId: controlIdentifier(input.activityId, "Agent Cell activity identity"),
      attemptId: foundationAgentCellAttemptIdV1(input),
      role: input.role,
      ownerSubjectDigest: input.ownerSubjectDigest,
    }),
    inputMaterialDigest: input.inputMaterialDigest,
    subjects: retained.subjects.map(({ subject }) => subject),
    entries: retained.entries.map(({ plan }) => plan),
    runnerContractDigest: input.runnerContractDigest,
    toolInventoryDigest: input.toolInventoryDigest,
    resolver,
  });
  const transportEntries = Object.freeze(inputSet.entries.map((descriptor) => {
    const raw = retained.entries.find(({ plan }) => plan.path === descriptor.path);
    if (raw === undefined) fail("input-substitution", "Compiled input entry bytes disappeared");
    return Object.freeze({ ...descriptor, bytes: Uint8Array.from(raw.bytes) });
  }));
  return Object.freeze({ inputSet, resolver, transportEntries });
}

async function exactCandidateObjectFormat(input: Readonly<{
  inputSet: FoundationExecutionInputSetV1;
  resolver: FoundationExecutionInputResolverV1;
}>): Promise<FoundationGitObjectFormat | null> {
  const selected = input.inputSet.subjects.filter(
    ({ kind }) => kind === "candidate-revision-carrier-manifest",
  );
  if (selected.length === 0) return null;
  if (selected.length !== 1) {
    fail("candidate-input", "Agent Input Set does not select one exact Candidate Carrier manifest");
  }
  const subject = selected[0]!;
  let proof: FoundationVerifiedExecutionInputSubjectV1;
  try {
    proof = await input.resolver.verifySubject(subject);
  } catch (error) {
    if (error instanceof FoundationError) throw error;
    fail("candidate-input", "Candidate Carrier manifest could not be reopened exactly");
  }
  const suppliedBytes = proof?.bytes;
  if (proof === null || typeof proof !== "object" || proof.immutable !== true ||
      canonicalJson(proof.subject) !== canonicalJson(subject) ||
      !(suppliedBytes instanceof Uint8Array) || suppliedBytes.byteLength < 1 ||
      suppliedBytes.byteLength > MAXIMUM_INPUT_ITEM_BYTES) {
    fail("candidate-input", "Candidate Carrier manifest proof is incomplete or substituted");
  }
  const bytes = Uint8Array.from(suppliedBytes);
  const bytesDigest = sha256Bytes(bytes);
  if (proof.byteLength !== bytes.byteLength || proof.bytesDigest !== bytesDigest ||
      bytesDigest !== subject.digest || proof.candidateBinding !== null) {
    fail("candidate-input", "Candidate Carrier manifest proof differs from its exact bytes");
  }
  try {
    return parseCandidateRevisionCarrierManifest(
      bytes,
      FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
    ).objectFormat;
  } catch {
    fail("candidate-input", "Candidate Carrier manifest bytes are invalid");
  }
}

function singleton(
  inputSet: FoundationExecutionInputSetV1,
  kind: FoundationExecutionInputSubjectKindV1,
): FoundationExecutionInputSubjectV1 {
  const selected = inputSet.subjects.filter((subject) => subject.kind === kind);
  if (selected.length !== 1) fail("input-binding", `Agent Input Set lacks one exact ${kind}`);
  return selected[0]!;
}

function exactRelationship(
  store: ControlRecordStore,
  attempt: ControlRecordRevision,
  relation: string,
  kind: string,
  required: boolean,
): ControlRecordRevision | null {
  const selected = attempt.relationships.filter(({ relation: value }) => value === relation);
  if (selected.length !== (required ? 1 : 0)) {
    fail("attempt-relationship", `Agent Attempt ${relation} relationship has the wrong cardinality`);
  }
  if (!required) return null;
  const target = selected[0]!.target;
  if (target.kind !== kind) fail("attempt-relationship", `Agent Attempt ${relation} kind is invalid`);
  const revision = store.getRevision(target.id, target.revision);
  if (revision === null || revision.recordKind !== kind || revision.digest !== target.digest) {
    fail("attempt-relationship", `Agent Attempt ${relation} target cannot be reopened exactly`);
  }
  return revision;
}

function exactAttemptPreparation(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  attempt: FoundationAgentCellAttemptPreparationV1;
}>): ControlRecordRevision {
  const attempt = input.attempt.revision;
  const revisionInput = input.attempt.append.revision;
  if (revisionInput === undefined || attempt.recordKind !== "agent-attempt" || attempt.revision !== 1 ||
      attempt.payload.schema !== "lifecycle.agent-attempt-payload.v3" ||
      attempt.recordId !== foundationAgentCellAttemptIdV1(input) ||
      attempt.payload.activityId !== input.activityId ||
      canonicalJson(compileControlRecordRevision(input.store.identity.processId, revisionInput)) !==
        canonicalJson(attempt)) {
    fail("attempt-preparation", "Agent Cell did not receive one exact real compiled Attempt preparation");
  }
  const event = input.attempt.append.event;
  if (event.eventKind !== "agent-attempt-prepared" || event.subject === undefined ||
      event.subject === null || event.subject.recordId !== attempt.recordId ||
      event.subject.revision !== attempt.revision || event.subject.digest !== attempt.digest ||
      event.payload.activityId !== input.activityId) {
    fail("attempt-preparation", "Agent Attempt append does not bind its exact revision and Activity");
  }
  const retained = input.store.getRevision(attempt.recordId, attempt.revision);
  if (retained !== null && canonicalJson(retained) !== canonicalJson(attempt)) {
    fail("attempt-substitution", "Owning Store retained another Agent Attempt revision");
  }
  return attempt;
}

function subjectMatches(
  subject: FoundationExecutionInputSubjectV1,
  expected: Readonly<{ id?: string; revision?: number | null; digest: Sha256 }>,
  label: string,
): void {
  if ((expected.id !== undefined && subject.id !== expected.id) ||
      (expected.revision !== undefined && subject.revision !== expected.revision) ||
      subject.digest !== expected.digest) {
    fail("input-binding", `${label} differs from the exact Agent Attempt selection`);
  }
}

function exactEntry(inputSet: FoundationExecutionInputSetV1, input: Readonly<{
  path: string;
  purpose: FoundationExecutionInputEntryPlanV1["purpose"];
  mediaType: string;
  modeClass: FoundationExecutionInputEntryPlanV1["modeClass"];
  sourceSubjectDigest: Sha256;
}>): void {
  const selected = inputSet.entries.filter(({ path }) => path === input.path);
  if (selected.length !== 1) {
    fail("input-binding", `Agent Input Set lacks exact transported member ${input.path}`);
  }
  const entry = selected[0]!;
  if (entry.purpose !== input.purpose || entry.mediaType !== input.mediaType ||
      entry.modeClass !== input.modeClass ||
      entry.sourceSubjectDigest !== input.sourceSubjectDigest) {
    fail("input-binding", `Agent transported member ${input.path} differs from its exact owner`);
  }
}

function attemptFacts(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  attempt: FoundationAgentCellAttemptPreparationV1;
  inputSet: FoundationExecutionInputSetV1;
  installed: FoundationAgentCellInstalledInputsV1;
}>): AttemptFacts {
  const attempt = exactAttemptPreparation(input);
  const role = exactRole(attempt.payload.role);
  const operation = text(attempt.payload.operation, "Agent Attempt operation");
  const expectedRole = operation === "delivery.continue" ? "builder" :
    operation === "delivery.evaluate" ? "reviewer" : "reconnaissance";
  if (role !== expectedRole || input.inputSet.owner.kind !== "agent-attempt" ||
      input.inputSet.owner.activityId !== input.activityId ||
      input.inputSet.owner.attemptId !== attempt.recordId || input.inputSet.owner.role !== role ||
      input.inputSet.owner.ownerSubjectDigest !== attempt.payload.roleSubjectDigest) {
    fail("attempt", "Attempt, operation, role, Activity, and Input Set owner do not agree");
  }
  const relationships = new Set(attempt.relationships.map(({ relation }) => relation));
  const allowed = new Set(["uses-brief", ...(operation === "delivery.prepare" ? [] : [
    "uses-boundary", "uses-candidate", ...(role === "reviewer" ? ["uses-seal"] : []),
  ])]);
  if (relationships.size !== attempt.relationships.length || relationships.size !== allowed.size ||
      [...relationships].some((value) => !allowed.has(value))) {
    fail("attempt-relationship", "Agent Attempt relationships are not the exact role-owned set");
  }
  const brief = exactRelationship(input.store, attempt, "uses-brief", "founder-brief", true)!;
  exactRelationship(input.store, attempt, "uses-boundary", "work-boundary", operation !== "delivery.prepare");
  const candidate = exactRelationship(
    input.store,
    attempt,
    "uses-candidate",
    "candidate-revision",
    operation !== "delivery.prepare",
  );
  exactRelationship(input.store, attempt, "uses-seal", "candidate-seal", role === "reviewer");

  const projection = object(attempt.payload.projection, "Agent Attempt projection");
  const provider = object(attempt.payload.provider, "Agent Attempt provider");
  const capability = object(attempt.payload.capability, "Agent Attempt capability");
  const investment = object(attempt.payload.investment, "Agent Attempt investment");
  const authoring = object(attempt.payload.authoring, "Agent Attempt authoring");
  const attemptInput = object(attempt.payload.input, "Agent Attempt input");
  const execution = object(attempt.payload.execution, "Agent Attempt execution");
  const executionPolicy = object(attempt.payload.executionPolicy, "Agent Attempt execution policy");

  const expectedBackend = Object.freeze({
    profileId: input.installed.profile.profileId,
    profileDigest: input.installed.profile.digest,
    implementationDigest: input.installed.profile.implementation.implementationDigest,
  });
  const expectedImage = Object.freeze({
    imageId: input.installed.image.imageId,
    imageDigest: input.installed.image.imageDigest,
  });
  const expectedInputSet = Object.freeze({
    profileId: "lifecycle.execution-input-set.v1" as const,
    digest: input.inputSet.digest,
  });
  if (canonicalJson(execution.backendProfile) !== canonicalJson(expectedBackend) ||
      canonicalJson(execution.image) !== canonicalJson(expectedImage) ||
      canonicalJson(execution.inputSet) !== canonicalJson(expectedInputSet) ||
      provider.descriptorId !== input.installed.provider.descriptorId ||
      provider.descriptorDigest !== input.installed.provider.descriptorDigest ||
      provider.executableIdentityClass !== input.installed.provider.executableIdentityClass ||
      provider.installedIdentityDigest !== input.installed.provider.installedIdentityDigest ||
      provider.adapter !== "lifecycle.provider-adapter.v6") {
    fail("installed-binding", "Attempt differs from the exact installed execution selection");
  }
  if (attemptInput.inputMaterialDigest !== input.inputSet.inputMaterialDigest ||
      attemptInput.contentInventoryDigest !== input.inputSet.contentInventoryDigest) {
    fail("input-binding", "Attempt aggregate input facts differ from the exact Input Set");
  }

  subjectMatches(singleton(input.inputSet, "projection"), {
    id: text(projection.id, "Projection identity"),
    digest: exactDigest(projection.digest, "Projection digest"),
  }, "Projection subject");
  subjectMatches(singleton(input.inputSet, "role-subject"), {
    digest: exactDigest(attempt.payload.roleSubjectDigest, "Role subject digest"),
  }, "Role subject");
  subjectMatches(singleton(input.inputSet, "founder-direction"), {
    id: brief.recordId,
    revision: brief.revision,
    digest: brief.digest,
  }, "Founder direction subject");
  const roleBriefSubject = singleton(input.inputSet, "role-brief");
  subjectMatches(roleBriefSubject, {
    digest: exactDigest(authoring.roleBriefDigest, "Role Brief digest"),
  }, "Role Brief subject");
  const templateSubject = singleton(input.inputSet, "semantic-template");
  subjectMatches(templateSubject, {
    id: text(authoring.templateProfileId, "Semantic template identity"),
    digest: exactDigest(authoring.templateDigest, "Semantic template digest"),
  }, "Semantic template subject");
  subjectMatches(singleton(input.inputSet, "capability-profile"), {
    id: text(capability.profileId, "Capability Profile identity"),
    digest: exactDigest(capability.profileDigest, "Capability Profile digest"),
  }, "Capability Profile subject");
  subjectMatches(singleton(input.inputSet, "provider-descriptor"), {
    id: text(provider.descriptorId, "Provider Descriptor identity"),
    digest: exactDigest(provider.descriptorDigest, "Provider Descriptor digest"),
  }, "Provider Descriptor subject");
  subjectMatches(singleton(input.inputSet, "investment"), {
    id: text(investment.id, "Investment identity"),
    digest: exactDigest(investment.digest, "Investment digest"),
  }, "Investment subject");
  subjectMatches(singleton(input.inputSet, "runner"), {
    digest: input.installed.image.runnerContractDigest,
  }, "Runner subject");
  exactEntry(input.inputSet, {
    path: FOUNDATION_AGENT_EXECUTION_CELL_INPUT_V1.roleBriefPath,
    purpose: "role-brief",
    mediaType: "text/markdown; charset=utf-8",
    modeClass: "regular",
    sourceSubjectDigest: roleBriefSubject.digest,
  });
  exactEntry(input.inputSet, {
    path: FOUNDATION_AGENT_EXECUTION_CELL_INPUT_V1.semanticTemplatePath,
    purpose: "semantic-template",
    mediaType: "text/markdown; charset=utf-8",
    modeClass: "regular",
    sourceSubjectDigest: templateSubject.digest,
  });

  const policyDigests = Object.values(executionPolicy).map((value) =>
    exactDigest(value, "Execution policy digest")).sort(compareCodePoints);
  const subjectPolicyDigests = input.inputSet.subjects
    .filter(({ kind }) => kind === "policy")
    .map(({ digest }) => digest)
    .sort(compareCodePoints);
  if (canonicalJson(policyDigests) !== canonicalJson(subjectPolicyDigests)) {
    fail("policy-binding", "Input Set policy subjects differ from the complete Attempt policy selection");
  }
  const allowedBindings = new Set([
    ...input.inputSet.subjects.map(({ digest }) => digest),
    input.installed.image.imageDigest,
    input.installed.profile.digest,
  ]);
  if (input.installed.environment.some(({ bindingDigest }) => !allowedBindings.has(bindingDigest)) ||
      !policyDigests.includes(input.installed.networkPolicy.agentPolicyDigest) ||
      (input.installed.networkPolicy.providerPolicyDigest !== null &&
        !policyDigests.includes(input.installed.networkPolicy.providerPolicyDigest)) ||
      input.installed.credentialPolicy.bindings.some(({ policyDigest }) =>
        !policyDigests.includes(policyDigest))) {
    fail("policy-binding", "Installed environment, network, or credential policy is not Input-bound");
  }

  if (candidate !== null) {
    subjectMatches(singleton(input.inputSet, "candidate-revision"), {
      id: candidate.recordId,
      revision: candidate.revision,
      digest: candidate.digest,
    }, "Candidate Revision subject");
    const carrier = object(candidate.payload.carrierManifest, "Candidate Carrier manifest");
    const manifestSubject = singleton(input.inputSet, "candidate-revision-carrier-manifest");
    subjectMatches(manifestSubject, {
      digest: exactDigest(carrier.digest, "Candidate Carrier manifest digest"),
    }, "Candidate Carrier manifest subject");
    exactEntry(input.inputSet, {
      path: FOUNDATION_AGENT_EXECUTION_CELL_INPUT_V1.candidateManifestPath,
      purpose: "operation-input",
      mediaType: "application/json",
      modeClass: "regular",
      sourceSubjectDigest: manifestSubject.digest,
    });
    exactEntry(input.inputSet, {
      path: FOUNDATION_AGENT_EXECUTION_CELL_INPUT_V1.candidateArtifactPath,
      purpose: "candidate-carrier-artifact",
      mediaType: "application/octet-stream",
      modeClass: "regular",
      sourceSubjectDigest: manifestSubject.digest,
    });
  }
  return Object.freeze({ role, provider, capability, investment, authoring, attemptInput, executionPolicy });
}

function selectedLimit(value: ControlJsonValue | undefined, maximum: number): number {
  if (value === null) return maximum;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    fail("limit", "Attempt Investment limit exceeds the installed Backend Profile");
  }
  return value as number;
}

/** Compile the Specification solely from the Attempt, Input Set, and installed selection. */
export function compileFoundationAgentCellSpecificationV1(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  attempt: FoundationAgentCellAttemptPreparationV1;
  compiledInput: FoundationCompiledAgentCellInputV1;
  installed: FoundationAgentCellInstalledInputsV1;
}>): FoundationExecutionSpecificationV1 {
  const profile = parseFoundationExecutionBackendProfile(input.installed.profile);
  const inputSet = input.compiledInput.inputSet;
  const facts = attemptFacts({ ...input, inputSet });
  if (inputSet.runnerContractDigest !== input.installed.image.runnerContractDigest ||
      inputSet.toolInventoryDigest !== input.installed.image.toolInventoryDigest ||
      !SHA256.test(input.installed.adapterImplementationDigest)) {
    fail("runner", "Input Set, Image, or adapter inventory is not exactly installed");
  }
  const investmentLimits = object(facts.investment.limits, "Attempt Investment limits");
  const wallTimeMilliseconds = selectedLimit(
    facts.investment.wallTimeMs,
    profile.limits.maximumWallTimeMilliseconds,
  );
  const limits = Object.freeze({
    wallTimeMilliseconds,
    processes: selectedLimit(investmentLimits.processes, profile.limits.maximumProcesses),
    storageBytes: selectedLimit(investmentLimits.storageBytes, profile.limits.maximumStorageBytes),
    outputEntries: profile.limits.maximumOutputEntries,
    outputBytes: selectedLimit(investmentLimits.outputBytes, profile.limits.maximumOutputBytes),
    outputEntryBytes: Math.min(
      selectedLimit(investmentLimits.outputBytes, profile.limits.maximumOutputBytes),
      profile.limits.maximumOutputEntryBytes,
    ),
    events: selectedLimit(investmentLimits.events, profile.limits.maximumEvents),
  });
  const environment = Object.freeze(input.installed.environment
    .map((entry) => Object.freeze({ ...entry }))
    .sort((left, right) => compareCodePoints(left.name, right.name)));
  const outputContract = foundationAgentExecutionCellOutputContractV1({ role: facts.role, limits });
  const attempt = input.attempt.revision;
  const runnerArgumentsDigest = digestCanonical(Object.freeze({
    schema: "lifecycle.agent-execution-cell-runner-arguments.v1",
    attemptDigest: attempt.digest,
    role: facts.role,
    inputSetDigest: inputSet.digest,
    providerDescriptorDigest: facts.provider.descriptorDigest,
    adapterImplementationDigest: input.installed.adapterImplementationDigest,
  }));
  const subject = {
    schema: "lifecycle.execution-specification.v1" as const,
    owner: Object.freeze({
      kind: "agent-attempt" as const,
      activityId: input.activityId,
      attempt: Object.freeze({
        kind: "agent-attempt" as const,
        id: attempt.recordId,
        revision: attempt.revision,
        digest: attempt.digest,
      }),
    }),
    backendProfile: Object.freeze({
      profileId: profile.profileId,
      profileDigest: profile.digest,
      implementationDigest: profile.implementation.implementationDigest,
    }),
    image: Object.freeze({
      imageId: input.installed.image.imageId,
      imageDigest: input.installed.image.imageDigest,
    }),
    inputSet: Object.freeze({ profileId: "lifecycle.execution-input-set.v1" as const, digest: inputSet.digest }),
    operation: Object.freeze({
      kind: "agent-attempt" as const,
      role: facts.role,
      providerDescriptorDigest: exactDigest(facts.provider.descriptorDigest, "Provider digest"),
      adapterImplementationDigest: input.installed.adapterImplementationDigest,
    }),
    runner: Object.freeze({
      contractId: FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.runnerContractId,
      contractDigest: input.installed.image.runnerContractDigest,
      operationId: `agent-attempt.${facts.role}`,
      argumentsDigest: runnerArgumentsDigest,
    }),
    environment,
    capabilities: Object.freeze({
      capabilityProfileDigest: exactDigest(facts.capability.profileDigest, "Capability digest"),
      candidateWrites: facts.role === "builder",
      ...input.installed.capabilities,
      dockerDaemonAccess: false as const,
    }),
    networkPolicy: Object.freeze({ ...input.installed.networkPolicy }),
    credentialPolicy: Object.freeze({
      ...input.installed.credentialPolicy,
      bindings: Object.freeze(input.installed.credentialPolicy.bindings.map((entry) =>
        Object.freeze({ ...entry }))),
    }),
    limits,
    outputContract,
    terminalPolicy: Object.freeze({
      directObservationRequired: true as const,
      containmentRequired: true as const,
      retrievalAfterContainment: true as const,
      retirementRequired: true as const,
      reclamation: "asynchronous-private" as const,
    }),
  };
  const exactSubject = Object.freeze(subject);
  return parseFoundationExecutionSpecification({
    value: Object.freeze({ ...exactSubject, digest: selfDigest(exactSubject) }),
    backendProfile: profile,
    image: exactSubject.image,
    inputSet: exactSubject.inputSet,
  });
}

function persistenceBinding(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  attempt: ControlRecordRevision;
  inputSet: FoundationExecutionInputSetV1;
  specification: FoundationExecutionSpecificationV1;
}>): FoundationAgentCellPersistenceBindingV1 {
  const subject = Object.freeze({
    storeId: input.store.identity.storeId,
    processId: input.store.identity.processId,
    activityId: input.activityId,
    attempt: Object.freeze({
      id: input.attempt.recordId,
      revision: input.attempt.revision,
      digest: input.attempt.digest,
    }),
    inputSetDigest: input.inputSet.digest,
    specificationDigest: input.specification.digest,
  });
  return Object.freeze({ ...subject, digest: digestCanonical(subject) });
}

function activityEvents(store: ControlRecordStore, activityId: string): readonly ControlRecordEvent[] {
  const values: ControlRecordEvent[] = [];
  let cursor = 0;
  for (;;) {
    const page = store.listEvents(cursor, 10_000);
    for (const event of page) if (event.payload.activityId === activityId) values.push(event);
    if (page.length < 10_000) break;
    cursor = page.at(-1)!.sequence;
    if (values.length > MAXIMUM_ACTIVITY_EVENTS) fail("event-bound", "Agent Activity event scan exceeded its bound");
  }
  return Object.freeze(values);
}

function eventMatchesInput(event: ControlRecordEvent, input: ControlRecordEventInput): boolean {
  return event.eventId === input.eventId && event.eventKind === input.eventKind &&
    event.occurredAt === input.occurredAt && canonicalJson(event.actor) === canonicalJson(input.actor) &&
    canonicalJson(event.subject) === canonicalJson(input.subject ?? null) &&
    canonicalJson(event.payload) === canonicalJson(input.payload);
}

function providerIntentEventIdentity(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
}>): string {
  const suffix = digestCanonical({
    eventKind: "provider-effect-intended",
    storeId: input.store.identity.storeId,
    processId: input.store.identity.processId,
    activityId: input.activityId,
    discriminator: Object.freeze({}),
  }).slice("sha256:".length);
  return `event-provider-effect-intended-${suffix}`;
}

function preIntentRefusalFacts(error: unknown): Readonly<{
  diagnosticCode: string;
  refusalFactsDigest: Sha256;
}> {
  const diagnosticCode = controlIdentifier(
    error instanceof FoundationError
      ? error.code
      : "lifecycle.agent-execution-cell-v1.pre-intent-revalidation",
    "Agent pre-intent refusal diagnostic code",
  );
  const message = error instanceof Error
    ? error.message
    : "Agent pre-intent revalidation refused without an Error value";
  return Object.freeze({
    diagnosticCode,
    refusalFactsDigest: digestCanonical(Object.freeze({
      schema: "lifecycle.agent-pre-intent-refusal-facts.v1",
      diagnosticCode,
      messageDigest: sha256Bytes(Buffer.from(message, "utf8")),
    })),
  });
}

function assertDurablePreIntentRefusal(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  attempt: FoundationAgentCellAttemptPreparationV1;
  checkpoint: FoundationExecutionOperationCheckpointV1;
}>): void {
  if (input.checkpoint.dispatchAuthorityConsumedAt !== null ||
      input.checkpoint.handle === null || input.checkpoint.containmentRequestedAt === null ||
      input.checkpoint.containment === null || input.checkpoint.observation === null) {
    fail("pre-intent-refusal", "Agent pre-intent refusal lacks one inert contained Cell checkpoint");
  }
  if (input.store.getRevision(
    input.attempt.revision.recordId,
    input.attempt.revision.revision,
  ) !== null) {
    fail("pre-intent-refusal", "Agent pre-intent refusal retained an Agent Attempt");
  }
  const events = activityEvents(input.store, input.activityId);
  const refused = events.filter(({ eventKind }) => eventKind === "agent-pre-intent-refused");
  const prepared = events.filter(({ eventKind }) => eventKind === "agent-attempt-prepared");
  const intended = events.filter(({ eventKind }) => eventKind === "provider-effect-intended");
  const selected = refused[0];
  if (refused.length !== 1 || prepared.length !== 0 || intended.length !== 0 ||
      selected === undefined || selected.subject !== null ||
      selected.occurredAt !== input.checkpoint.containmentRequestedAt ||
      canonicalJson(selected.actor) !== canonicalJson(Object.freeze({
        kind: "runtime" as const,
        id: input.attempt.revision.producer.id,
      })) || selected.payload.activityId !== input.activityId ||
      typeof selected.payload.diagnosticCode !== "string" ||
      !SHA256.test(String(selected.payload.refusalFactsDigest))) {
    fail("pre-intent-refusal", "Agent refusal event and contained checkpoint are not one exact subject");
  }
}

function assertDurableDispatch(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  attempt: FoundationAgentCellAttemptPreparationV1;
  specification: FoundationExecutionSpecificationV1;
  checkpoint: FoundationExecutionOperationCheckpointV1;
}>): void {
  if (input.checkpoint.dispatchAuthorityConsumedAt === null) {
    fail("dispatch-proof", "Dispatch proof requires one consumed checkpoint");
  }
  const retained = input.store.getRevision(input.attempt.revision.recordId, input.attempt.revision.revision);
  if (retained === null || canonicalJson(retained) !== canonicalJson(input.attempt.revision)) {
    fail("dispatch-proof", "Dispatch authority was consumed without the exact retained Attempt");
  }
  const events = activityEvents(input.store, input.activityId);
  const prepared = events.filter(({ eventKind }) => eventKind === "agent-attempt-prepared");
  const intended = events.filter(({ eventKind }) => eventKind === "provider-effect-intended");
  const refused = events.filter(({ eventKind }) => eventKind === "agent-pre-intent-refused");
  const exactIntentPayload = Object.freeze({
    activityId: input.activityId,
    effectDigest: input.specification.digest,
  });
  if (prepared.length !== 1 || intended.length !== 1 || refused.length !== 0 ||
      !eventMatchesInput(prepared[0]!, input.attempt.append.event) ||
      intended[0]!.eventId !== providerIntentEventIdentity(input) ||
      intended[0]!.occurredAt !== input.checkpoint.dispatchAuthorityConsumedAt ||
      canonicalJson(intended[0]!.actor) !== canonicalJson(Object.freeze({
        kind: "runtime" as const,
        id: input.attempt.revision.producer.id,
      })) ||
      intended[0]!.subject?.recordId !== retained.recordId ||
      intended[0]!.subject?.revision !== retained.revision ||
      intended[0]!.subject?.digest !== retained.digest ||
      canonicalJson(intended[0]!.payload) !== canonicalJson(exactIntentPayload)) {
    fail("dispatch-proof", "Attempt, provider intent, and consumed checkpoint are not one exact subject");
  }
}

function sameCoordinate(
  left: FoundationExecutionOperationCheckpointCoordinateV1 | null,
  right: FoundationExecutionOperationCheckpointCoordinateV1 | null,
): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function agentPersistence(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  attempt: FoundationAgentCellAttemptPreparationV1;
  inputSet: FoundationExecutionInputSetV1;
  specification: FoundationExecutionSpecificationV1;
  owner: FoundationAgentCellActivityOwnerV1;
  revalidateBeforeIntent: FoundationAgentCellOperationInputV1["revalidateBeforeIntent"];
}>): Readonly<{
  checkpoints: FoundationExecutionOperationCheckpointPersistenceV1;
  commitPreDispatch: FoundationExecutionPreDispatchCommitV1;
}> {
  const binding = persistenceBinding({
    ...input,
    attempt: input.attempt.revision,
  });
  const read = async (): Promise<FoundationRetainedExecutionOperationCheckpointV1 | null> => {
    const retained = await input.owner.read(binding);
    if (retained !== null && retained.checkpoint.specificationDigest !== binding.specificationDigest) {
      fail("specification-substitution", "Activity retained another Specification for this Attempt");
    }
    if (retained?.checkpoint.dispatchAuthorityConsumedAt !== null &&
        retained?.checkpoint.dispatchAuthorityConsumedAt !== undefined) {
      assertDurableDispatch({ ...input, checkpoint: retained.checkpoint });
    } else {
      const attempt = input.store.getRevision(
        input.attempt.revision.recordId,
        input.attempt.revision.revision,
      );
      const events = activityEvents(input.store, input.activityId);
      const intents = events.filter(
        ({ eventKind }) => eventKind === "provider-effect-intended",
      );
      if (attempt !== null || intents.length !== 0) {
        fail("dispatch-split", "Attempt or provider intent exists without consumed dispatch authority");
      }
      const refused = events.filter(({ eventKind }) => eventKind === "agent-pre-intent-refused");
      if (refused.length > 1 || (refused.length === 1 && retained === null)) {
        fail("pre-intent-refusal", "Agent pre-intent refusal lacks one exact retained checkpoint");
      }
      if (refused.length === 1 && retained !== null) {
        assertDurablePreIntentRefusal({ ...input, checkpoint: retained.checkpoint });
      }
    }
    return retained;
  };
  const persistence: FoundationExecutionOperationCheckpointPersistenceV1 = Object.freeze({
    async read(
      specificationDigest: Sha256,
    ): Promise<FoundationRetainedExecutionOperationCheckpointV1 | null> {
      if (specificationDigest !== binding.specificationDigest) {
        fail("specification-substitution", "Persistence read selected another Specification");
      }
      return await read();
    },
    async compareExchange(mutation: Readonly<{
      specificationDigest: Sha256;
      expected: FoundationExecutionOperationCheckpointCoordinateV1 | null;
      checkpoint: FoundationExecutionOperationCheckpointV1;
    }>): Promise<FoundationRetainedExecutionOperationCheckpointV1> {
      if (mutation.specificationDigest !== binding.specificationDigest ||
          mutation.checkpoint.specificationDigest !== binding.specificationDigest) {
        fail("specification-substitution", "Persistence mutation selected another Specification");
      }
      const current = await read();
      if (!sameCoordinate(current?.coordinate ?? null, mutation.expected)) {
        fail("checkpoint-cas", "Activity persistence substituted the exact Agent checkpoint coordinate");
      }
      let retained: FoundationRetainedExecutionOperationCheckpointV1;
      const consumesDispatch = current !== null &&
        current.checkpoint.dispatchAuthorityConsumedAt === null &&
        mutation.checkpoint.dispatchAuthorityConsumedAt !== null;
      if (consumesDispatch) {
        fail(
          "dispatch-transition",
          "Agent dispatch consumption must use its exact pre-dispatch owner boundary",
        );
      } else {
        if ((current === null && mutation.checkpoint.dispatchAuthorityConsumedAt !== null) ||
            (current !== null && current.checkpoint.dispatchAuthorityConsumedAt !== null &&
              mutation.checkpoint.dispatchAuthorityConsumedAt === null)) {
          fail("dispatch-transition", "Support-only CAS cannot consume or revoke dispatch authority");
        }
        retained = await input.owner.commitSupport({
          binding,
          expected: mutation.expected,
          checkpoint: mutation.checkpoint,
        });
      }
      const reopened = await read();
      if (reopened === null || canonicalJson(reopened.checkpoint) !== canonicalJson(mutation.checkpoint) ||
          canonicalJson(retained) !== canonicalJson(reopened)) {
        fail("persistence-substitution", "Activity commit did not reopen the exact proposed checkpoint");
      }
      return reopened;
    },
  });
  const commitPreDispatch: FoundationExecutionPreDispatchCommitV1 = async (boundary) => {
    if (boundary.specification.digest !== binding.specificationDigest ||
        boundary.dispatchCheckpoint.specificationDigest !== binding.specificationDigest ||
        boundary.refusalCheckpoint.specificationDigest !== binding.specificationDigest ||
        !sameCoordinate(boundary.current.coordinate, (await read())?.coordinate ?? null)) {
      fail("dispatch-transition", "Agent pre-dispatch boundary substituted its exact retained Cell");
    }
    let refusal: ReturnType<typeof preIntentRefusalFacts> | null = null;
    try {
      await input.revalidateBeforeIntent(Object.freeze({
        attempt: input.attempt.revision,
        inputSet: input.inputSet,
        specification: input.specification,
      }));
    } catch (error) {
      refusal = preIntentRefusalFacts(error);
    }
    if (refusal === null) {
      const intendedAt = boundary.dispatchCheckpoint.dispatchAuthorityConsumedAt;
      if (intendedAt === null || boundary.refusalCheckpoint.dispatchAuthorityConsumedAt !== null) {
        fail("dispatch-transition", "Agent pre-dispatch boundary lacks exact dispatch alternatives");
      }
      const intended = compileProviderEffectIntentBesideAttemptAppend({
        store: input.store,
        activityId: input.activityId,
        effectDigest: input.specification.digest,
        intendedAt,
        runtimeId: input.attempt.revision.producer.id,
        attempt: input.attempt.revision,
      });
      const result = await input.owner.ownerCommitDispatch({
        binding,
        expected: boundary.current.coordinate,
        checkpoint: boundary.dispatchCheckpoint,
        attempt: input.attempt,
        appends: Object.freeze([input.attempt.append, intended]),
      });
      if (result.appends.length !== 2 || result.appends[0].revision === null ||
          canonicalJson(result.appends[0].revision) !== canonicalJson(input.attempt.revision) ||
          result.appends[1].revision !== null ||
          !eventMatchesInput(result.appends[1].event, intended.event)) {
        fail("dispatch-proof", "Atomic Activity dispatch commit returned another append result");
      }
      const reopened = await read();
      if (reopened === null || canonicalJson(result.retained) !== canonicalJson(reopened) ||
          canonicalJson(reopened.checkpoint) !== canonicalJson(boundary.dispatchCheckpoint)) {
        fail("persistence-substitution", "Atomic Activity dispatch commit retained another checkpoint");
      }
      return Object.freeze({ disposition: "dispatch" as const, retained: reopened });
    }

    const refusedAt = boundary.refusalCheckpoint.containmentRequestedAt;
    if (refusedAt === null || boundary.dispatchCheckpoint.dispatchAuthorityConsumedAt === null ||
        boundary.refusalCheckpoint.dispatchAuthorityConsumedAt !== null ||
        boundary.refusalCheckpoint.containment === null) {
      fail("dispatch-transition", "Agent pre-dispatch boundary lacks one inert refusal alternative");
    }
    const append = compileAgentPreIntentRefusalAppend({
      store: input.store,
      activityId: input.activityId,
      refusedAt,
      runtimeId: input.attempt.revision.producer.id,
      ...refusal,
    });
    const result = await input.owner.ownerCommitPreIntentRefusal({
      binding,
      expected: boundary.current.coordinate,
      checkpoint: boundary.refusalCheckpoint,
      append,
    });
    if (result.append.revision !== null || !eventMatchesInput(result.append.event, append.event)) {
      fail("pre-intent-refusal", "Atomic Activity refusal commit returned another append result");
    }
    const reopened = await read();
    if (reopened === null || canonicalJson(result.retained) !== canonicalJson(reopened) ||
        canonicalJson(reopened.checkpoint) !== canonicalJson(boundary.refusalCheckpoint)) {
      fail("persistence-substitution", "Atomic Activity refusal commit retained another checkpoint");
    }
    return Object.freeze({ disposition: "refused" as const, retained: reopened });
  };
  return Object.freeze({ checkpoints: persistence, commitPreDispatch });
}

function exactValidatorResult(value: unknown): "valid" | "invalid" {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).length !== 1 ||
      ((value as { disposition?: unknown }).disposition !== "valid" &&
        (value as { disposition?: unknown }).disposition !== "invalid")) {
    fail("semantic-validation", "Agent final semantic validation returned an invalid result");
  }
  return (value as { disposition: "valid" | "invalid" }).disposition;
}

function providerObservation(
  result:
    | FoundationAgentExecutionCellProviderResultV1
    | FoundationAgentExecutionCellProviderTerminalObservationV1,
): ExecutionReceiptProviderObservation {
  return Object.freeze({
    preparedAt: result.preparedAt,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    executableIdentity: result.executableIdentity,
    outcome: result.outcome,
    stage: result.stage,
    productiveStarted: result.productiveStarted,
    firstTrigger: result.firstTrigger,
    exitCode: result.exitCode,
    signal: result.signal,
    sessionId: result.sessionId,
  });
}

function runtimeObservedNotStartedProvider(
  input: Readonly<{
    preparedAt: string;
    checkpoint: FoundationExecutionOperationCheckpointV1;
  }>,
): ExecutionReceiptProviderObservation | null {
  const { checkpoint } = input;
  const observation = checkpoint.observation;
  if (
    checkpoint.dispatchAuthorityConsumedAt === null ||
    checkpoint.containment === null ||
    checkpoint.output?.validation !== "not-applicable" ||
    observation === null ||
    observation.allocationState !== "allocated" ||
    (observation.dispatchState !== "not-observed" &&
      observation.dispatchState !== "accepted") ||
    observation.processState !== "not-started" ||
    observation.terminal !== null ||
    observation.output.disposition !== "not-produced"
  ) return null;
  return Object.freeze({
    preparedAt: input.preparedAt,
    startedAt: null,
    finishedAt: null,
    executableIdentity: null,
    outcome: "runtime-failure" as const,
    stage: "dispatch" as const,
    productiveStarted: false,
    firstTrigger: "runtime-failure" as const,
    exitCode: null,
    signal: null,
    sessionId: null,
  });
}

async function reopenRetainedProviderTerminalCompletion(input: Readonly<{
  value: ControlJsonObject;
  specification: FoundationExecutionSpecificationV1;
  attemptDigest: Sha256;
  executableIdentity: Sha256;
  runnerImplementationDigest: Sha256;
}>): Promise<FoundationAgentExecutionCellProviderTerminalObservationV1> {
  const bytes = Uint8Array.from(Buffer.from(`${canonicalJson(input.value)}\n`, "utf8"));
  const artifact: FoundationValidatedExecutionOutputArtifactV1 = Object.freeze({
    path: FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.providerTerminalObservationPath,
    entryKind: "file" as const,
    purpose: "operational-artifact" as const,
    mediaType: FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.providerTerminalObservationMediaType,
    modeClass: "regular" as const,
    byteLength: bytes.byteLength,
    digest: sha256Bytes(bytes),
    candidateRepositoryPath: null,
    candidateGitMode: null,
    async *read() {
      yield Uint8Array.from(bytes);
    },
  });
  return await readFoundationAgentProviderTerminalObservationV1({
    artifact,
    specification: input.specification,
    attemptDigest: input.attemptDigest,
    executableIdentity: input.executableIdentity,
    runnerImplementationDigest: input.runnerImplementationDigest,
  });
}

function providerResultMatchesTerminal(input: Readonly<{
  result: FoundationAgentExecutionCellProviderResultV1;
  terminal: FoundationAgentExecutionCellProviderTerminalObservationV1;
}>): boolean {
  return input.result.attemptDigest === input.terminal.attemptDigest &&
    input.result.specificationDigest === input.terminal.specificationDigest &&
    input.result.providerDescriptorDigest === input.terminal.providerDescriptorDigest &&
    input.result.adapterImplementationDigest === input.terminal.adapterImplementationDigest &&
    canonicalJson(providerObservation(input.result)) ===
      canonicalJson(providerObservation(input.terminal));
}

function carrierDigest(output: FoundationValidatedExecutionOutputV1): Sha256 {
  return digestCanonical(Object.freeze({
    schema: "lifecycle.execution-output-carrier-binding.v1",
    manifestDigest: output.manifest.digest,
    carrierByteLength: output.carrierByteLength,
    entries: output.artifacts.map(({ read: _read, ...artifact }) => artifact),
  }));
}

/** Operate one exact Agent Attempt through the shared execution host. */
export async function operateFoundationAgentCellV1(
  input: FoundationAgentCellOperationInputV1,
): Promise<FoundationAgentCellOperationResultV1> {
  const inputSet = await parseFoundationExecutionInputSet({
    value: input.compiledInput.inputSet,
    resolver: input.compiledInput.resolver,
  });
  const compiledInput: FoundationCompiledAgentCellInputV1 = Object.freeze({
    inputSet,
    resolver: input.compiledInput.resolver,
    transportEntries: input.compiledInput.transportEntries,
  });
  const candidateObjectFormat = await exactCandidateObjectFormat(compiledInput);
  const role = inputSet.owner.kind === "agent-attempt" ? inputSet.owner.role :
    fail("owner", "Agent operation reopened a non-Agent Input Set");
  if ((role === "reconnaissance") !== (candidateObjectFormat === null)) {
    fail("candidate-input", "Candidate object format does not follow the exact Attempt role and Carrier");
  }
  const specification = compileFoundationAgentCellSpecificationV1({
    store: input.store,
    activityId: input.activityId,
    attempt: input.attempt,
    compiledInput,
    installed: input.installed,
  });
  const persistence = agentPersistence({
    store: input.store,
    activityId: input.activityId,
    attempt: input.attempt,
    inputSet,
    specification,
    owner: input.activityOwner,
    revalidateBeforeIntent: input.revalidateBeforeIntent,
  });
  input.runtime.registerOperation({ specification, persistence: persistence.checkpoints });
  let ownedOutput: FoundationAgentExecutionCellOwnedOutputV1 | null = null;
  let providerTerminal: FoundationAgentExecutionCellProviderTerminalObservationV1 | null = null;
  let providerResult: FoundationAgentExecutionCellProviderResultV1 | null = null;
  let semantic: FoundationAgentCellSemanticDispositionV1 | null = null;
  let candidate: FoundationAgentCellCandidateDispositionV1 | null = null;
  const publisher = input.runtime.publishCandidateOutput ??
    publishCandidateRevisionCarrierFromCandidateOutput;

  const observeTerminalCompletion = async (
    output: Parameters<typeof observeFoundationAgentProviderTerminalCompletionV1>[0]["output"],
    expectedManifestDigest: Sha256,
  ): Promise<FoundationExecutionOwnerTerminalCompletionResultV1> => {
    let terminal: FoundationAgentExecutionCellProviderTerminalObservationV1;
    try {
      terminal = await observeFoundationAgentProviderTerminalCompletionV1({
        output,
        specification,
        expectedManifestDigest,
        attemptDigest: input.attempt.revision.digest,
        executableIdentity: input.installed.provider.installedIdentityDigest,
        runnerImplementationDigest: input.installed.image.runnerImplementationDigest,
      });
    } catch (error) {
      if (error instanceof FoundationError &&
          error.code.startsWith(
            "lifecycle.agent-execution-cell-operation-v1.provider-terminal-observation",
          )) {
        return Object.freeze({
          disposition: "invalid" as const,
          failureFactsDigest: digestCanonical(Object.freeze({
            schema: "lifecycle.agent-terminal-completion-failure.private.v1",
            specificationDigest: specification.digest,
            attemptDigest: input.attempt.revision.digest,
            code: error.code,
            diagnosticsDigest: error.diagnostics.length === 0
              ? null
              : digestCanonical(error.diagnostics),
          })),
        });
      }
      throw error;
    }
    if (providerTerminal !== null &&
        canonicalJson(providerTerminal) !== canonicalJson(terminal)) {
      fail(
        "provider-terminal-observation",
        "Separate Provider terminal completion changed across exact retrieval",
      );
    }
    providerTerminal = terminal;
    return Object.freeze({
      disposition: "observed" as const,
      value: terminal as unknown as ControlJsonObject,
    });
  };

  const validateOwnedOutput = async (
    output: FoundationValidatedExecutionOutputV1,
  ): Promise<Readonly<{ disposition: "valid" }>> => {
    const selected = inspectFoundationAgentExecutionCellOutputV1({
      role: inputSet.owner.kind === "agent-attempt" ? inputSet.owner.role :
        fail("owner", "Agent operation reopened a non-Agent Input Set"),
      output,
    });
    const terminal = await readFoundationAgentProviderTerminalObservationV1({
      artifact: selected.providerTerminalObservation,
      specification,
      attemptDigest: input.attempt.revision.digest,
      executableIdentity: input.installed.provider.installedIdentityDigest,
      runnerImplementationDigest: input.installed.image.runnerImplementationDigest,
    });
    if (providerTerminal !== null &&
        canonicalJson(providerTerminal) !== canonicalJson(terminal)) {
      fail(
        "provider-terminal-observation",
        "Validated Carrier changed the separately retained Provider terminal completion",
      );
    }
    let normalizedProvider: FoundationAgentExecutionCellProviderResultV1 | null = null;
    try {
      if (selected.providerResult === null) throw new FoundationError(
        "lifecycle.agent-execution-cell-operation-v1.provider-result",
        "Agent Provider Result was not produced",
      );
      normalizedProvider = await readFoundationAgentProviderResultV1({
        artifact: selected.providerResult,
        specification,
        attemptDigest: input.attempt.revision.digest,
        executableIdentity: input.installed.provider.installedIdentityDigest,
      });
      if (!providerResultMatchesTerminal({ result: normalizedProvider, terminal })) {
        normalizedProvider = null;
      }
    } catch (error) {
      if (!(error instanceof FoundationError) ||
          error.code !== "lifecycle.agent-execution-cell-operation-v1.provider-result") {
        throw error;
      }
      // Provider normalization is an independent Agent-owned result branch.
      // Malformed provider bytes do not erase independently observed semantic
      // or Candidate output, and null records this branch's deterministic invalidity.
    }

    let semanticResult: FoundationAgentCellSemanticDispositionV1;
    if (selected.semantic.disposition === "not-produced") {
      semanticResult = Object.freeze({ disposition: "not-produced" as const, artifact: null });
    } else if (selected.semantic.disposition === "invalid" || selected.semantic.artifact === null) {
      semanticResult = Object.freeze({ disposition: "invalid" as const, artifact: null });
    } else {
      const disposition = exactValidatorResult(await input.validateSemanticOutput({
        attempt: input.attempt.revision,
        inputSet,
        specification,
        output,
        artifact: selected.semantic.artifact,
      }));
      semanticResult = Object.freeze({ disposition, artifact: selected.semantic.artifact });
    }

    let candidateResult: FoundationAgentCellCandidateDispositionV1;
    if (selected.candidate.disposition === "not-applicable") {
      candidateResult = Object.freeze({ disposition: "not-applicable" as const, carrier: null });
    } else if (selected.candidate.disposition === "invalid" || selected.candidate.output === null ||
        candidateObjectFormat === null) {
      candidateResult = Object.freeze({ disposition: "invalid" as const, carrier: null });
    } else {
      try {
        const published = await publisher({
          machineHome: input.runtime.machineHome,
          objectFormat: candidateObjectFormat,
          candidateOutput: selected.candidate.output,
        });
        candidateResult = Object.freeze({ disposition: "valid" as const, carrier: published });
      } catch (error) {
        if (error instanceof FoundationError &&
            error.code === "lifecycle.candidate.output-carrier-invalid") {
          candidateResult = Object.freeze({ disposition: "invalid" as const, carrier: null });
        } else {
          throw error;
        }
      }
    }
    ownedOutput = selected;
    providerTerminal = terminal;
    providerResult = normalizedProvider;
    semantic = semanticResult;
    candidate = candidateResult;
    // Generic bytes remain valid even when either owner branch is invalid.
    return Object.freeze({ disposition: "valid" as const });
  };

  const host = new FoundationExecutionOperationHostV1({
    backend: input.runtime.backend,
    checkpoints: persistence.checkpoints,
    clock: input.runtime.clock,
    outputStore: input.runtime.outputStore,
    commitPreDispatch: persistence.commitPreDispatch,
    observeTerminalCompletion: async ({
      specification: selected,
      expectedManifestDigest,
      output,
    }) => {
      if (selected.digest !== specification.digest) {
        fail("owner", "Agent terminal observer received another Specification");
      }
      return await observeTerminalCompletion(output, expectedManifestDigest);
    },
    validateOwnerOutput: async ({ specification: selected, output }) => {
      if (selected.digest !== specification.digest) {
        fail("owner", "Agent output validator received another Specification");
      }
      return await validateOwnedOutput(output);
    },
  });
  const pollMilliseconds = input.runtime.pollMilliseconds ?? 100;
  if (!Number.isSafeInteger(pollMilliseconds) || pollMilliseconds < 0 ||
      pollMilliseconds > 60_000) {
    fail("poll-bound", "Agent Cell polling interval is outside its fixed bound");
  }
  const effectivePollMilliseconds = Math.max(1, pollMilliseconds);
  const activeStepBound = Math.min(
    MAXIMUM_OPERATION_STEPS - 1_024,
    Math.ceil(specification.limits.wallTimeMilliseconds / effectivePollMilliseconds) + 16,
  );
  const totalStepBound = activeStepBound + 1_024;
  let openedAtMilliseconds: number | null = null;
  let validatedOutput: FoundationValidatedExecutionOutputV1 | null = null;
  for (let step = 0; step < totalStepBound; step += 1) {
    const before = await host.read(specification);
    if (before !== null && openedAtMilliseconds === null) {
      openedAtMilliseconds = Date.parse(before.checkpoint.openedAt);
      if (!Number.isFinite(openedAtMilliseconds)) fail("clock", "Retained Cell opening time is invalid");
    }
    if (before !== null && before.checkpoint.handle === null) {
      input.runtime.reclamation.assertAllocationAvailable();
    }
    if (before?.checkpoint.output !== null && before?.checkpoint.output !== undefined) break;
    let deadlineReached = step >= activeStepBound;
    if (!deadlineReached && openedAtMilliseconds !== null) {
      const sampled = input.runtime.clock.now();
      const sampledMilliseconds = Date.parse(sampled);
      if (!Number.isFinite(sampledMilliseconds) || new Date(sampledMilliseconds).toISOString() !== sampled) {
        fail("clock", "Agent Cell recovery clock is invalid");
      }
      deadlineReached = sampledMilliseconds - openedAtMilliseconds >=
        specification.limits.wallTimeMilliseconds;
    }
    const advanced = await host.advance({
      specification,
      runnerDigest: input.installed.image.runnerContractDigest,
      requestContainment: deadlineReached,
    });
    if (advanced.validatedOutput !== null) validatedOutput = advanced.validatedOutput;
    if (advanced.retained.checkpoint.output !== null) break;
    if (pollMilliseconds !== 0) await delay(pollMilliseconds);
  }
  let current = await host.read(specification);
  if (current === null || current.checkpoint.output === null ||
      current.checkpoint.containment === null || current.checkpoint.observation === null ||
      current.checkpoint.handle === null) {
    fail("recovery-bound", "Agent Cell did not reach final contained output within its bound");
  }
  if (current.checkpoint.output.validation === "valid" && validatedOutput === null &&
      current.checkpoint.retirement === null) {
    validatedOutput = (await host.advance({
      specification,
      runnerDigest: input.installed.image.runnerContractDigest,
    })).validatedOutput;
  }
  if (current.checkpoint.output.validation === "valid" && validatedOutput === null &&
      current.checkpoint.retirement !== null) {
    const binding = current.checkpoint.output.outputStoreBinding;
    if (binding === null) fail("output", "Retired valid Agent output lacks its Store binding");
    validatedOutput = (await reopenFoundationValidatedExecutionOutput({
      outputStore: input.runtime.outputStore,
      outputStoreBinding: binding,
      specification,
      backendProfile: input.installed.profile,
      runnerDigest: input.installed.image.runnerContractDigest,
    })).output;
    await validateOwnedOutput(validatedOutput);
  }
  const retainedTerminalCompletion = current.checkpoint.terminalCompletion;
  if (retainedTerminalCompletion?.disposition === "observed") {
    const retainedTerminal = await reopenRetainedProviderTerminalCompletion({
      value: retainedTerminalCompletion.value,
      specification,
      attemptDigest: input.attempt.revision.digest,
      executableIdentity: input.installed.provider.installedIdentityDigest,
      runnerImplementationDigest: input.installed.image.runnerImplementationDigest,
    });
    if (providerTerminal !== null &&
        canonicalJson(providerTerminal) !== canonicalJson(retainedTerminal)) {
      fail(
        "provider-terminal-observation",
        "Retained Provider terminal completion differs from its exact Carrier observation",
      );
    }
    providerTerminal = retainedTerminal;
  }
  current = await host.retire(specification);
  const checkpoint = current.checkpoint;
  if (checkpoint.retirement === null || checkpoint.handle === null ||
      checkpoint.containment === null || checkpoint.output === null ||
      checkpoint.observation === null) {
    fail("retirement", "Agent Cell did not retain exact Retirement facts");
  }
  input.runtime.reclamation.accept({
    owner: Object.freeze({
      storeId: input.store.identity.storeId,
      processId: input.store.identity.processId,
      activityId: input.activityId,
      kind: "agent-attempt",
      subjectDigest: input.attempt.revision.digest,
    }),
    specification,
    handle: checkpoint.handle,
    reclamationBinding: checkpoint.retirement.reclamationBinding,
    obligation: checkpoint.retirement.reclamationObligation,
    retirementDigest: checkpoint.retirement.digest,
    dispatchAuthorityConsumed: checkpoint.retirement.dispatchAuthorityConsumed,
  });
  const finalizedProviderTerminal = providerTerminal as
    FoundationAgentExecutionCellProviderTerminalObservationV1 | null;
  const preIntentRefused = activityEvents(input.store, input.activityId)
    .filter(({ eventKind }) => eventKind === "agent-pre-intent-refused").length === 1;
  const finalizedProviderObservation = finalizedProviderTerminal === null
    ? runtimeObservedNotStartedProvider({
        preparedAt: input.attempt.revision.createdAt,
        checkpoint,
      })
    : providerObservation(finalizedProviderTerminal);
  if (!preIntentRefused && finalizedProviderObservation === null) {
    fail(
      "provider-terminal-observation",
      "Dispatched Agent Cell lacks either retained runner-owned Provider terminal facts or one exact direct not-started observation",
    );
  }
  if (checkpoint.output.validation === "valid" &&
      (validatedOutput === null || ownedOutput === null || semantic === null || candidate === null)) {
    fail("output", "Valid Agent output could not be reopened and finalized after Retirement");
  }
  const finalSemantic = semantic ?? Object.freeze({
    disposition: "unavailable" as const,
    artifact: null,
  });
  const finalCandidate = candidate ?? Object.freeze({
    disposition: role === "builder" ? "unavailable" as const : "not-applicable" as const,
    carrier: null,
  });
  const executionOutput: ExecutionReceiptExecutionFacts["output"] = validatedOutput === null
    ? Object.freeze({
        availability: checkpoint.output.validation === "not-applicable"
          ? "not-produced" as const
          : "unavailable" as const,
        carrierByteLength: null,
        carrierDigest: null,
        manifestDigest: null,
      })
    : Object.freeze({
        availability: "retrieved" as const,
        carrierByteLength: validatedOutput.carrierByteLength,
        carrierDigest: carrierDigest(validatedOutput),
        manifestDigest: validatedOutput.manifest.digest,
      });
  const finalizedProviderResult = providerResult as
    FoundationAgentExecutionCellProviderResultV1 | null;
  const receiptFacts = Object.freeze({
    provider: finalizedProviderObservation,
    execution: Object.freeze({
      backendProfile: specification.backendProfile,
      image: specification.image,
      inputSet: specification.inputSet,
      specificationDigest: specification.digest,
      runnerDigest: specification.runner.contractDigest,
      observationDigest: checkpoint.observation.digest,
      output: executionOutput,
    }),
    containment: Object.freeze({
      factsDigest: checkpoint.containment.digest,
      cancellationRequested: checkpoint.containmentRequestedAt !== null,
      forced: finalizedProviderTerminal?.outcome === "forced-termination",
      parentLoss: checkpoint.observation.terminal?.reason === "parent-loss"
        ? "contained" as const
        : "not-observed" as const,
    }),
    retirement: Object.freeze({
      factsDigest: checkpoint.retirement.digest,
      residualClass: "bounded-non-secret" as const,
      residualFactsDigest: checkpoint.retirement.reclamationObligation.digest,
    }),
  });
  return Object.freeze({
    preIntentRefused,
    specification,
    inputSet,
    validatedOutput,
    providerResult: finalizedProviderResult,
    semantic: finalSemantic,
    candidate: finalCandidate,
    receiptFacts,
    terminal: Object.freeze({
      observationDigest: checkpoint.observation.digest,
      containmentDigest: checkpoint.containment.digest,
      outputDigest: checkpoint.output.digest,
      outputValidation: checkpoint.output.validation,
      retirementDigest: checkpoint.retirement.digest,
      reclamationObligationDigest: checkpoint.retirement.reclamationObligation.digest,
    }),
  });
}
