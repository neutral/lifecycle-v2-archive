import { authenticateDirectorDecisionOpening, type FoundationAuthorityCredential } from "../repository/authority.js";
import { randomUUID } from "node:crypto";
import { FOUNDATION_RUNTIME_PROTOCOL } from "../constants.js";
import {
  candidateRevisionCarrierVerifierFromWorkBoundary,
  publishCandidateRevisionCarrierFromGitTree,
} from "../candidate/carrier-binding.js";
import {
  FOUNDATION_CANDIDATE_CARRIER_ADMITTED_CONTEXT_INVALID,
  FOUNDATION_CANDIDATE_CARRIER_ADMITTED_CONTEXT_UNAVAILABLE,
} from "../candidate/carrier-observation-context.js";
import {
  FOUNDATION_CANDIDATE_CARRIER_STATE_INVALID,
  FOUNDATION_CANDIDATE_CARRIER_STATE_UNAVAILABLE,
  FOUNDATION_CANDIDATE_REVISION_CARRIER_STATE_OBSERVER_V1,
} from "../candidate/carrier-state-observer.js";
import { createDeliveryActivityId } from "../control/activity.js";
import {
  prepareCandidateRevisionRetention,
  type CandidateRevisionState,
} from "../control/candidate-revision.js";
import {
  verifyRetainedDirectorDecision,
  type AuthorizationReviewGate,
  type DirectorDecisionControlBinding,
  type DirectorDecisionRepositoryBasis,
  type DirectorDecisionSubject,
} from "../control/director-decision.js";
import { controlIdentifier, controlTimestamp } from "../control/model.js";
import { assertDeliveryControlRecordPayload } from "../control/payload-registry.js";
import type { ControlRecordStore } from "../control/store.js";
import type {
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordEvent,
  ControlRecordRevision,
} from "../control/types.js";
import { FoundationError } from "../error.js";
import { withDeliveryOperationLock } from "../control/delivery-operation-lock.js";
import type { FoundationLoadedRepositorySnapshot, FoundationRepositoryContract } from "../repository/types.js";
import { openFoundationDeliveryGitBasisV1 } from "../repository/delivery-git-basis.js";
import {
  canonicalJson,
  digestCanonical,
  type Sha256,
} from "../validation/canonical.js";
import { sortUniqueCodePoints } from "../validation/ordering.js";
import {
  advanceFoundationActivityKernelTransactionEffectV7,
  advanceFoundationActivityKernelV7,
  finishFoundationActivityKernelV7,
  openFoundationActivityKernelV7,
  readFoundationActivityKernelV7,
  recoverFoundationActivityKernelV7,
  type FoundationActivityKernelCheckpointAdapterV7,
  type FoundationActivityKernelContextV7,
  type FoundationActivityKernelStandardDefinitionV7,
} from "../process/activity-kernel-v7.js";
import {
  commitPreparedCandidateRevisionThroughActivityV7,
} from "../process/candidate-revision-retention-v7.js";
import {
  FOUNDATION_ADMISSION_TRANSACTION_OBSERVATION_FACTS_V1,
  type FoundationAdmissionTransactionObservationFactsV1,
} from "../process/transaction-observation-facts-v7.js";

const RUNTIME_COORDINATE = FOUNDATION_RUNTIME_PROTOCOL;
const TRANSACTION_RULES = "lifecycle.delivery-transaction-rules.v1" as const;
const PLAN_SCHEMA = "lifecycle.runtime-admission-effect-plan.v2" as const;
const CHECKPOINT_SCHEMA = "lifecycle.runtime-admission-checkpoint.v3" as const;
const MAXIMUM_OBSERVATIONS = 8;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const GIT_OBJECT = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;

type RevisionReference<Kind extends string> = Readonly<{
  kind: Kind;
  id: string;
  revision: number;
  digest: Sha256;
}>;

export type FoundationAdmissionEffectPlanV7 = Readonly<{
  schema: typeof PLAN_SCHEMA;
  runtime: typeof RUNTIME_COORDINATE;
  transactionRules: typeof TRANSACTION_RULES;
  operation: "delivery.admit";
  decisionKind: "admit" | "readmit";
  targetId: string;
  storeId: string;
  processId: string;
  activityId: string;
  decision: RevisionReference<"director-decision"> & Readonly<{ subjectDigest: Sha256 }>;
  boundary: RevisionReference<"work-boundary">;
  baselineReceipts: readonly RevisionReference<"check-receipt">[];
  predecessorBoundary: RevisionReference<"work-boundary"> | null;
  materialCondition: RevisionReference<"material-condition"> | null;
  continuingCandidate: RevisionReference<"candidate-revision"> | null;
  repository: DirectorDecisionRepositoryBasis;
  candidate: Readonly<{
    deliveryId: string;
    baseCommit: string;
    requiredArtifactPaths: readonly string[];
    continuityProfile: "candidate-revision-carrier-v1";
    observerId: string;
    observerDigest: Sha256;
  }>;
}>;

export type FoundationCompiledAdmissionEffectPlanV7 = Readonly<{
  plan: FoundationAdmissionEffectPlanV7;
  effectDigest: Sha256;
  decision: ControlRecordRevision;
  boundary: ControlRecordRevision;
}>;

type AdmissionDisposition = Readonly<{
  outcome: "not-applied";
  reason: "repository-basis-mismatch" | "candidate-continuity-mismatch";
  observedFactsDigest: Sha256;
}>;

type AdmissionOpeningTimes = Readonly<{
  startedAt: string;
  authorizedAt: string;
  verifiedAt: string;
}>;

type AdmissionCandidateFailureFact = Readonly<{
  index: number;
  observedAt: string;
  availability: "invalid" | "unavailable";
  failureFactsDigest: Sha256;
}>;

type AdmissionCheckpoint = ControlJsonObject & Readonly<{
  schema: typeof CHECKPOINT_SCHEMA;
  candidateFailures: readonly AdmissionCandidateFailureFact[];
  disposition: AdmissionDisposition | null;
}>;

type AdmissionPlan = ControlJsonObject & FoundationAdmissionEffectPlanV7;
type AdmissionKernelContext = FoundationActivityKernelContextV7<
  AdmissionPlan,
  AdmissionCheckpoint
>;
type AdmissionCheckpointAdapter = FoundationActivityKernelCheckpointAdapterV7<
  AdmissionPlan,
  AdmissionCheckpoint
>;

export type FoundationAdmissionRepositoryObservationV7 = Readonly<{
  repository: string;
  contract: FoundationRepositoryContract;
  basis: DirectorDecisionRepositoryBasis;
}>;

export type FoundationAdmissionV7Result = Readonly<{
  status: "completed" | "failed" | "recovery-required";
  activityId: string;
  decisionKind: "admit" | "readmit";
  effectDigest: Sha256;
  transactionOutcome: "applied" | "not-applied" | "indeterminate";
  decision: Readonly<{ id: string; revision: number; digest: Sha256 }>;
  candidate: Readonly<{ id: string; revision: number; digest: Sha256 }> | null;
}>;

export type FoundationAdmissionV7Stage =
  | "opening-committed"
  | "transaction-effect-intended"
  | "transaction-effect-observed"
  | "candidate-observation-unavailable"
  | "candidate-revision-observed"
  | "activity-completed";

type AdmissionOwners = Readonly<{
  now: () => string;
  withDeliveryLock: typeof withDeliveryOperationLock;
  observeRepository: (
    target: string,
    observedAt: string,
    historicalCommit: string,
  ) => Promise<FoundationAdmissionRepositoryObservationV7>;
  publishCandidateCarrier: typeof publishCandidateRevisionCarrierFromGitTree;
  carrierVerifier: typeof candidateRevisionCarrierVerifierFromWorkBoundary;
  beforeAuthenticate: AuthorizationReviewGate;
  onStage: (stage: FoundationAdmissionV7Stage) => void | Promise<void>;
}>;

export type FoundationAdmissionV7Options = Readonly<{
  now?: () => string;
  withDeliveryLock?: typeof withDeliveryOperationLock;
  observeRepository?: AdmissionOwners["observeRepository"];
  publishCandidateCarrier?: AdmissionOwners["publishCandidateCarrier"];
  carrierVerifier?: AdmissionOwners["carrierVerifier"];
  beforeAuthenticate?: AdmissionOwners["beforeAuthenticate"];
  onStage?: AdmissionOwners["onStage"];
}>;

export type FoundationAdmissionV7Input = Readonly<{
  target: string;
  machineHome: string;
  store: ControlRecordStore;
  authorityHome: string;
  authorityCredential: FoundationAuthorityCredential;
  runtimeId: string;
}>;

export type FoundationAdmissionRecoveryV7Input = Readonly<{
  target: string;
  machineHome: string;
  store: ControlRecordStore;
  runtimeId: string;
  activityId?: string;
}>;

function fail(
  code: string,
  message: string,
  observedFacts: Readonly<Record<string, unknown>> = {},
): never {
  throw new FoundationError(`lifecycle.admission-v7.${code}`, message, { observedFacts });
}

function object(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
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
  if (!DIGEST.test(selected)) fail("retained-fact", `${label} must be one lowercase SHA-256 digest`);
  return selected as Sha256;
}

function integer(value: ControlJsonValue | undefined, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail("retained-fact", `${label} must be one nonnegative safe integer`);
  }
  return value as number;
}

function exactKeys(value: ControlJsonObject, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail("retained-fact", `${label} has unsupported or missing fields`);
  }
}

function positiveInteger(value: ControlJsonValue | undefined, label: string): number {
  const selected = integer(value, label);
  if (selected < 1) fail("retained-fact", `${label} must be one positive safe integer`);
  return selected;
}

function validateRevisionReference(
  value: ControlJsonValue | undefined,
  kind: string,
  label: string,
  subjectDigest = false,
): void {
  const selected = object(value, label);
  exactKeys(
    selected,
    subjectDigest
      ? ["kind", "id", "revision", "digest", "subjectDigest"]
      : ["kind", "id", "revision", "digest"],
    label,
  );
  if (selected.kind !== kind) fail("retained-fact", `${label} has the wrong record kind`);
  controlIdentifier(string(selected.id, `${label} identity`), `${label} identity`);
  positiveInteger(selected.revision, `${label} revision`);
  digest(selected.digest, `${label} digest`);
  if (subjectDigest) digest(selected.subjectDigest, `${label} subject digest`);
}

function validateRepositoryBasis(
  value: ControlJsonValue | undefined,
  label: string,
): void {
  const selected = object(value, label);
  exactKeys(selected, [
    "repositorySnapshotDigest",
    "canonicalCommit",
    "canonicalTree",
    "productStateDigest",
    "atlasStateDigest",
    "atlasResolutionDigest",
    "atlasNormalizedModelDigest",
    "atlasResourceBindingsDigest",
    "repositoryContractDigest",
    "knowledgeSetDigest",
    "checkBindingSetDigest",
  ], label);
  digest(selected.repositorySnapshotDigest, `${label} Snapshot digest`);
  const canonicalCommit = string(selected.canonicalCommit, `${label} canonical commit`);
  const canonicalTree = string(selected.canonicalTree, `${label} canonical tree`);
  if (!GIT_OBJECT.test(canonicalCommit) || !GIT_OBJECT.test(canonicalTree)) {
    fail("retained-fact", `${label} Git objects must be full lowercase object identities`);
  }
  for (const member of [
    "productStateDigest",
    "atlasStateDigest",
    "atlasResolutionDigest",
    "atlasNormalizedModelDigest",
    "atlasResourceBindingsDigest",
    "repositoryContractDigest",
    "knowledgeSetDigest",
    "checkBindingSetDigest",
  ] as const) {
    digest(selected[member], `${label} ${member}`);
  }
}

function parseAdmissionPlan(value: ControlJsonObject): AdmissionPlan {
  exactKeys(value, [
    "schema",
    "runtime",
    "transactionRules",
    "operation",
    "decisionKind",
    "targetId",
    "storeId",
    "processId",
    "activityId",
    "decision",
    "boundary",
    "baselineReceipts",
    "predecessorBoundary",
    "materialCondition",
    "continuingCandidate",
    "repository",
    "candidate",
  ], "Admission effect plan");
  if (
    value.schema !== PLAN_SCHEMA || value.runtime !== RUNTIME_COORDINATE ||
    value.transactionRules !== TRANSACTION_RULES || value.operation !== "delivery.admit"
  ) {
    fail("retained-fact", "Admission effect plan has unsupported fixed coordinates");
  }
  if (value.decisionKind !== "admit" && value.decisionKind !== "readmit") {
    fail("retained-fact", "Admission effect plan has an unsupported Decision kind");
  }
  for (const member of ["targetId", "storeId", "processId", "activityId"] as const) {
    controlIdentifier(string(value[member], `Admission ${member}`), `Admission ${member}`);
  }
  validateRevisionReference(value.decision, "director-decision", "Admission Decision", true);
  validateRevisionReference(value.boundary, "work-boundary", "Admission Boundary");
  const baselineReceipts = array(value.baselineReceipts, "Admission baseline Receipts");
  if (baselineReceipts.length < 1) {
    fail("retained-fact", "Admission effect plan requires at least one baseline Receipt");
  }
  baselineReceipts.forEach((selected, index) => validateRevisionReference(
    selected,
    "check-receipt",
    `Admission baseline Receipt ${index}`,
  ));
  const optionalReference = (
    selected: ControlJsonValue | undefined,
    kind: string,
    label: string,
  ): void => {
    if (selected !== null) validateRevisionReference(selected, kind, label);
  };
  optionalReference(value.predecessorBoundary, "work-boundary", "Admission predecessor Boundary");
  optionalReference(value.materialCondition, "material-condition", "Admission Material Condition");
  optionalReference(value.continuingCandidate, "candidate-revision", "Admission continuing Candidate");
  const readmit = value.decisionKind === "readmit";
  if (
    [value.predecessorBoundary, value.materialCondition, value.continuingCandidate]
      .some((selected) => (selected !== null) !== readmit)
  ) {
    fail("retained-fact", "Admission Decision kind and continuity bindings differ");
  }
  validateRepositoryBasis(value.repository, "Admission repository basis");
  const candidate = object(value.candidate, "Admission Candidate plan");
  exactKeys(candidate, [
    "deliveryId",
    "baseCommit",
    "requiredArtifactPaths",
    "continuityProfile",
    "observerId",
    "observerDigest",
  ], "Admission Candidate plan");
  controlIdentifier(
    string(candidate.deliveryId, "Admission Candidate Delivery identity"),
    "Admission Candidate Delivery identity",
  );
  if (!GIT_OBJECT.test(string(candidate.baseCommit, "Admission Candidate base commit"))) {
    fail("retained-fact", "Admission Candidate base must be one full lowercase Git object");
  }
  const paths = array(
    candidate.requiredArtifactPaths,
    "Admission Candidate required artifact paths",
  ).map((selected, index) => string(selected, `Admission Candidate artifact path ${index}`));
  if (canonicalJson(paths) !== canonicalJson(sortUniqueCodePoints(paths))) {
    fail("retained-fact", "Admission Candidate artifact paths must be unique and code-point ordered");
  }
  if (candidate.continuityProfile !== "candidate-revision-carrier-v1") {
    fail("retained-fact", "Admission Candidate plan has an unsupported continuity profile");
  }
  controlIdentifier(
    string(candidate.observerId, "Admission Candidate observer identity"),
    "Admission Candidate observer identity",
  );
  digest(candidate.observerDigest, "Admission Candidate observer digest");
  return value as AdmissionPlan;
}

function reference<Kind extends string>(
  revision: ControlRecordRevision,
  kind: Kind,
): RevisionReference<Kind> {
  if (revision.recordKind !== kind) fail("reference", `Expected one exact ${kind} revision`);
  return Object.freeze({
    kind,
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function resolveBinding(
  store: ControlRecordStore,
  selected: DirectorDecisionControlBinding,
): ControlRecordRevision {
  const revision = store.getRevision(selected.target.id, selected.target.revision);
  if (
    revision === null || revision.recordKind !== selected.target.kind ||
    revision.digest !== selected.target.digest
  ) {
    fail("selected-control", "Admission selected Control binding does not resolve exactly");
  }
  assertDeliveryControlRecordPayload(revision);
  return revision;
}

function oneBinding(
  subject: DirectorDecisionSubject,
  relation: DirectorDecisionControlBinding["relation"],
): DirectorDecisionControlBinding {
  const selected = subject.selectedControl.filter((value) => value.relation === relation);
  if (selected.length !== 1) fail("selected-control", `Admission requires exactly one ${relation} binding`);
  return selected[0]!;
}

function noBinding(
  subject: DirectorDecisionSubject,
  relation: DirectorDecisionControlBinding["relation"],
): void {
  if (subject.selectedControl.some((value) => value.relation === relation)) {
    fail("selected-control", `Admission variant cannot carry ${relation}`);
  }
}

function requiredArtifactPaths(boundary: ControlRecordRevision): readonly string[] {
  const mandate = object(boundary.payload.mandate, "Work Boundary mandate");
  if (!Array.isArray(mandate.artifacts)) {
    fail("boundary", "Work Boundary mandate must retain its exact artifact set");
  }
  const paths = mandate.artifacts.map((value, index) =>
    string(object(value, `Work Boundary artifact ${index}`).path, `Work Boundary artifact ${index} path`));
  const normalized = sortUniqueCodePoints(paths);
  if (normalized.length !== paths.length) fail("boundary", "Work Boundary artifact paths must be unique");
  return normalized;
}

function planFromDecision(
  store: ControlRecordStore,
  decision: ControlRecordRevision,
  subject: DirectorDecisionSubject,
): FoundationCompiledAdmissionEffectPlanV7 {
  if (subject.operation !== "delivery.admit") fail("decision", "Admission plan requires delivery.admit authority");
  if (subject.decision !== "admit" && subject.decision !== "readmit") {
    fail("decision", "Admission plan requires one exact admit or readmit Decision");
  }
  const decisionKind = subject.decision;
  const boundary = resolveBinding(store, oneBinding(subject, "selects-boundary"));
  const baselineBindings = subject.selectedControl.filter(({ relation }) =>
    relation === "selects-baseline-receipt");
  if (baselineBindings.length < 1) fail("baseline", "Admission plan requires baseline Check Receipts");
  const baselineReceipts = Object.freeze(baselineBindings.map((selected) =>
    reference(resolveBinding(store, selected), "check-receipt")));

  let predecessorBoundary: RevisionReference<"work-boundary"> | null = null;
  let materialCondition: RevisionReference<"material-condition"> | null = null;
  let continuingCandidate: RevisionReference<"candidate-revision"> | null = null;
  if (decisionKind === "readmit") {
    predecessorBoundary = reference(
      resolveBinding(store, oneBinding(subject, "continues-from-boundary")),
      "work-boundary",
    );
    materialCondition = reference(
      resolveBinding(store, oneBinding(subject, "resolves")),
      "material-condition",
    );
    continuingCandidate = reference(
      resolveBinding(store, oneBinding(subject, "selects-candidate")),
      "candidate-revision",
    );
  } else {
    noBinding(subject, "continues-from-boundary");
    noBinding(subject, "resolves");
    noBinding(subject, "selects-candidate");
  }
  noBinding(subject, "selects-seal");
  noBinding(subject, "selects-evidence");
  const basis = object(boundary.payload.basis, "Work Boundary repository basis");
  const baseCommit = decisionKind === "admit"
    ? string(basis.productBaseCommit, "Initial Candidate base commit")
    : string(
        resolveBinding(store, oneBinding(subject, "selects-candidate")).payload.candidateBaseCommit,
        "Continuing Candidate base commit",
      );
  if (!GIT_OBJECT.test(baseCommit)) fail("candidate", "Admission Candidate base must be one full Git object");
  const plan: FoundationAdmissionEffectPlanV7 = Object.freeze({
    schema: PLAN_SCHEMA,
    runtime: RUNTIME_COORDINATE,
    transactionRules: TRANSACTION_RULES,
    operation: "delivery.admit",
    decisionKind,
    targetId: store.identity.targetId,
    storeId: store.identity.storeId,
    processId: store.identity.processId,
    activityId: subject.activityId,
    decision: Object.freeze({
      ...reference(decision, "director-decision"),
      subjectDigest: digest(decision.payload.subjectDigest, "Director Decision subject digest"),
    }),
    boundary: reference(boundary, "work-boundary"),
    baselineReceipts,
    predecessorBoundary,
    materialCondition,
    continuingCandidate,
    repository: Object.freeze({ ...subject.repository }),
    candidate: Object.freeze({
      deliveryId: store.identity.processId,
      baseCommit,
      requiredArtifactPaths: requiredArtifactPaths(boundary),
      continuityProfile: "candidate-revision-carrier-v1",
      observerId: FOUNDATION_CANDIDATE_REVISION_CARRIER_STATE_OBSERVER_V1.id,
      observerDigest:
        FOUNDATION_CANDIDATE_REVISION_CARRIER_STATE_OBSERVER_V1.implementationDigest,
    }),
  });
  return Object.freeze({ plan, effectDigest: digestCanonical(plan), decision, boundary });
}

/** Reproduce one effect plan from a retained and reverified Director Decision. */
export function compileFoundationAdmissionEffectPlanV7(
  store: ControlRecordStore,
  activityId: string,
  contract: FoundationRepositoryContract,
): FoundationCompiledAdmissionEffectPlanV7 {
  const verified = verifyRetainedDirectorDecision({ store, activityId, contract });
  return planFromDecision(store, verified.revision, verified.subject);
}

function admissionRepositoryObservation(snapshot: FoundationLoadedRepositorySnapshot): FoundationAdmissionRepositoryObservationV7 {
  return Object.freeze({
    repository: snapshot.repository,
    contract: snapshot.contract,
    basis: Object.freeze({
      repositorySnapshotDigest: snapshot.snapshot.digest,
      canonicalCommit: snapshot.epoch.commit,
      canonicalTree: snapshot.epoch.tree,
      productStateDigest: snapshot.snapshot.productStateDigest,
      atlasStateDigest: snapshot.snapshot.atlasStateDigest,
      atlasResolutionDigest: snapshot.snapshot.atlasResolutionDigest,
      atlasNormalizedModelDigest: snapshot.snapshot.atlasNormalizedModelDigest,
      atlasResourceBindingsDigest: snapshot.snapshot.atlasResourceBindingsDigest,
      repositoryContractDigest: snapshot.contract.digest,
      knowledgeSetDigest: snapshot.snapshot.knowledgeSetDigest,
      checkBindingSetDigest: digestCanonical(snapshot.contract.checkBindings),
    }),
  });
}

async function observeRetainedAdmissionRepository(
  input: Pick<FoundationAdmissionV7Input, "machineHome" | "store">,
  repository: string,
  observedAt: string,
  historicalCommit: string,
): Promise<FoundationAdmissionRepositoryObservationV7> {
  controlTimestamp(observedAt, "Admission repository observation time");
  const state = input.store.state();
  const selected = state.subjects.proposedBoundary ?? state.subjects.activeBoundary;
  if (selected === null) fail("boundary", "Admission requires its exact retained Work Boundary");
  const boundary = input.store.getRevision(selected.id, selected.revision);
  if (boundary === null || boundary.recordKind !== "work-boundary" || boundary.digest !== selected.digest) {
    fail("boundary", "Admission Work Boundary does not resolve exactly");
  }
  const retained = await openFoundationDeliveryGitBasisV1({
    machineHome: input.machineHome, repository, store: input.store, boundary,
  });
  if (retained.loaded.epoch.commit !== historicalCommit) {
    fail("repository", "Admission retained repository differs from its exact selected commit");
  }
  return admissionRepositoryObservation(retained.loaded);
}

function owners(
  options: FoundationAdmissionV7Options,
  input: Pick<FoundationAdmissionV7Input, "machineHome" | "store">,
): AdmissionOwners {
  return Object.freeze({
    now: options.now ?? (() => new Date().toISOString()),
    withDeliveryLock: options.withDeliveryLock ?? withDeliveryOperationLock,
    observeRepository: options.observeRepository ?? ((repository, observedAt, commit) =>
      observeRetainedAdmissionRepository(input, repository, observedAt, commit)),
    publishCandidateCarrier:
      options.publishCandidateCarrier ?? publishCandidateRevisionCarrierFromGitTree,
    carrierVerifier:
      options.carrierVerifier ?? candidateRevisionCarrierVerifierFromWorkBoundary,
    beforeAuthenticate: options.beforeAuthenticate ?? (() => undefined),
    onStage: options.onStage ?? (() => undefined),
  });
}

function sampleTime(selected: AdmissionOwners, label: string): string {
  return controlTimestamp(selected.now(), label);
}

function openingTimes(selected: AdmissionOwners): AdmissionOpeningTimes {
  return Object.freeze({
    startedAt: sampleTime(selected, "Admission activity start time"),
    authorizedAt: sampleTime(selected, "Director admission authorization time"),
    verifiedAt: sampleTime(selected, "Director admission verification time"),
  });
}

function checkpointPayload(input: Readonly<{
  candidateFailures?: readonly AdmissionCandidateFailureFact[];
  disposition?: AdmissionDisposition | null;
}>): AdmissionCheckpoint {
  return Object.freeze({
    schema: CHECKPOINT_SCHEMA,
    candidateFailures: Object.freeze([...(input.candidateFailures ?? [])]),
    disposition: input.disposition ?? null,
  }) as AdmissionCheckpoint;
}

function nextCheckpoint(input: Readonly<{
  current: AdmissionCheckpoint;
  candidateFailures?: readonly AdmissionCandidateFailureFact[];
  disposition?: AdmissionDisposition | null;
}>): AdmissionCheckpoint {
  return checkpointPayload({
    candidateFailures: input.candidateFailures ?? input.current.candidateFailures,
    disposition: input.disposition === undefined
      ? input.current.disposition
      : input.disposition,
  });
}

function parseAdmissionCheckpoint(payload: ControlJsonObject): AdmissionCheckpoint {
  exactKeys(payload, [
    "schema", "candidateFailures", "disposition",
  ], "Admission checkpoint");
  if (payload.schema !== CHECKPOINT_SCHEMA) {
    fail("support", "Admission checkpoint has an unsupported schema");
  }
  const candidateFailures = array(
    payload.candidateFailures,
    "Admission Candidate failures",
  ).map((value, index): AdmissionCandidateFailureFact => {
    const failure = object(value, `Admission Candidate failure ${index}`);
    exactKeys(
      failure,
      ["index", "observedAt", "availability", "failureFactsDigest"],
      "Admission Candidate failure",
    );
    const retainedIndex = integer(failure.index, "Candidate observation index");
    if (retainedIndex !== index + 1) {
      fail("support", "Admission Candidate observation indexes must be exact and contiguous");
    }
    if (failure.availability !== "invalid" && failure.availability !== "unavailable") {
      fail("support", "Admission Candidate failure has an unsupported availability");
    }
    return Object.freeze({
      index: retainedIndex,
      observedAt: controlTimestamp(
        string(failure.observedAt, "Candidate observation time"),
        "Candidate observation time",
      ),
      availability: failure.availability,
      failureFactsDigest: digest(failure.failureFactsDigest, "Candidate failure facts digest"),
    });
  });
  if (candidateFailures.length > MAXIMUM_OBSERVATIONS) {
    fail("support", "Admission observation history exceeds its retained fixed bound");
  }
  if (candidateFailures.some((failure, index) =>
    index > 0 &&
    Date.parse(failure.observedAt) <= Date.parse(candidateFailures[index - 1]!.observedAt))) {
    fail(
      "support-stage",
      "Admission Candidate failure times must be strictly increasing",
    );
  }
  let disposition: AdmissionDisposition | null = null;
  if (payload.disposition !== null) {
    const selected = object(payload.disposition, "Admission not-applied disposition");
    exactKeys(selected, ["outcome", "reason", "observedFactsDigest"], "Admission not-applied disposition");
    if (
      selected.outcome !== "not-applied" ||
      (selected.reason !== "repository-basis-mismatch" &&
        selected.reason !== "candidate-continuity-mismatch")
    ) {
      fail("support", "Admission not-applied disposition has an unsupported value");
    }
    disposition = Object.freeze({
      outcome: "not-applied",
      reason: selected.reason,
      observedFactsDigest: digest(selected.observedFactsDigest, "Admission disposition facts digest"),
    });
  }
  return Object.freeze({
    schema: CHECKPOINT_SCHEMA,
    candidateFailures: Object.freeze(candidateFailures),
    disposition,
  }) as AdmissionCheckpoint;
}

const FOUNDATION_ADMISSION_ACTIVITY_DEFINITION_V7:
FoundationActivityKernelStandardDefinitionV7<AdmissionPlan, AdmissionCheckpoint> = Object.freeze({
  id: "foundation.admission.activity.v1",
  digest: digestCanonical(Object.freeze({
    schema: "lifecycle.activity-definition.v1",
    id: "foundation.admission.activity.v1",
    operation: "delivery.admit",
    planSchema: PLAN_SCHEMA,
    checkpointSchema: CHECKPOINT_SCHEMA,
    transactionRules: TRANSACTION_RULES,
  })),
  operation: "delivery.admit",
  terminal: false,
  parsePlan: parseAdmissionPlan,
  parseCheckpoint: parseAdmissionCheckpoint,
});

function admissionCheckpoint(context: AdmissionKernelContext): AdmissionCheckpoint {
  const checkpoint = context.envelope.checkpoint?.value ?? null;
  if (checkpoint === null) fail("support", "Admission requires one exact retained checkpoint");
  return checkpoint;
}

function allEvents(store: ControlRecordStore): readonly ControlRecordEvent[] {
  const events: ControlRecordEvent[] = [];
  let cursor = 0;
  for (;;) {
    const page = store.listEvents(cursor, 10_000);
    events.push(...page);
    if (page.length < 10_000) return Object.freeze(events);
    cursor = page.at(-1)!.sequence;
    if (events.length > 100_000) {
      fail("journal", "Admission Journal lookup exceeds its fixed bound");
    }
  }
}

function assertRepositoryBasis(
  store: ControlRecordStore,
  observed: FoundationAdmissionRepositoryObservationV7,
  expected: DirectorDecisionRepositoryBasis,
): void {
  if (
    observed.basis.atlasStateDigest !== expected.atlasStateDigest ||
    observed.basis.atlasResolutionDigest !== expected.atlasResolutionDigest ||
    observed.basis.atlasNormalizedModelDigest !== expected.atlasNormalizedModelDigest ||
    observed.basis.atlasResourceBindingsDigest !== expected.atlasResourceBindingsDigest
  ) {
    fail(
      "atlas-basis-mismatch",
      "Admission historical repository does not reproduce its authenticated Atlas basis",
      {
        expectedStateDigest: expected.atlasStateDigest,
        observedStateDigest: observed.basis.atlasStateDigest,
        expectedResolutionDigest: expected.atlasResolutionDigest,
        observedResolutionDigest: observed.basis.atlasResolutionDigest,
        expectedNormalizedModelDigest: expected.atlasNormalizedModelDigest,
        observedNormalizedModelDigest: observed.basis.atlasNormalizedModelDigest,
        expectedResourceBindingsDigest: expected.atlasResourceBindingsDigest,
        observedResourceBindingsDigest: observed.basis.atlasResourceBindingsDigest,
      },
    );
  }
  if (
    observed.contract.targetId !== store.identity.targetId ||
    observed.contract.digest !== expected.repositoryContractDigest ||
    canonicalJson(observed.basis) !== canonicalJson(expected)
  ) {
    fail("repository-drift", "Admission repository no longer matches its exact authenticated basis");
  }
}

function assertCandidateFailureChronology(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  candidateFailures: readonly AdmissionCandidateFailureFact[];
}>): void {
  if (input.candidateFailures.length === 0) return;
  const transactionObservations = allEvents(input.store).filter((event) =>
    event.eventKind === "transaction-effect-observed" &&
    event.payload.activityId === input.activityId);
  const boundary = transactionObservations.at(-1);
  if (boundary === undefined || boundary.payload.outcome !== "applied") {
    fail(
      "support-stage",
      "Admission Candidate failures require one exact applied transaction boundary",
    );
  }
  if (input.candidateFailures.some((failure) =>
    Date.parse(failure.observedAt) < Date.parse(boundary.occurredAt))) {
    fail(
      "support-stage",
      "Admission Candidate failure time precedes its retained transaction boundary",
    );
  }
}

function assertContextMatchesDecision(input: Readonly<{
  store: ControlRecordStore;
  context: AdmissionKernelContext;
  compiled: FoundationCompiledAdmissionEffectPlanV7;
}>): void {
  const checkpoint = admissionCheckpoint(input.context);
  if (
    input.context.activity.id !== input.compiled.plan.activityId ||
    input.context.envelope.plan.digest !== input.compiled.effectDigest ||
    canonicalJson(input.context.envelope.plan.value) !== canonicalJson(input.compiled.plan) ||
    input.context.envelope.plan.value.targetId !== input.store.identity.targetId ||
    input.context.envelope.plan.value.storeId !== input.store.identity.storeId ||
    input.context.envelope.plan.value.processId !== input.store.identity.processId
  ) {
    fail("support-substitution", "Admission support differs from the reverified retained Decision plan");
  }
  assertCandidateFailureChronology({
    store: input.store,
    activityId: input.context.activity.id,
    candidateFailures: checkpoint.candidateFailures,
  });
  if (
    checkpoint.disposition !== null &&
    input.context.recovery.resumesAt !== "activity-completed"
  ) {
    fail("support-stage", "Admission semantic disposition differs from reducer-derived recovery");
  }
}

function availableCandidateState(
  revision: ControlRecordRevision,
): CandidateRevisionState {
  if (revision.payload.schema !== "lifecycle.candidate-revision-payload.v3") {
    fail("candidate", "Continuing Candidate Revision does not use the current exact payload");
  }
  return object(
    revision.payload.state,
    "Continuing Candidate state",
  ) as unknown as CandidateRevisionState;
}

async function retainedCandidateCarrierManifestBytes(
  store: ControlRecordStore,
  revision: ControlRecordRevision,
): Promise<Uint8Array> {
  const reference = object(
    revision.payload.carrierManifest,
    "Candidate Revision Carrier manifest reference",
  );
  const manifestDigest = digest(
    reference.digest,
    "Candidate Revision Carrier manifest digest",
  );
  const retained = await store.readRetainedFile(manifestDigest);
  if (
    retained === null ||
    retained.descriptor.byteLength !== integer(
      reference.byteLength,
      "Candidate Revision Carrier manifest byte length",
    ) ||
    retained.descriptor.mediaType !== reference.mediaType ||
    retained.descriptor.purpose !== reference.purpose
  ) {
    fail(
      "candidate-carrier",
      "Candidate Revision does not reopen its exact retained Carrier manifest",
    );
  }
  return Uint8Array.from(retained.bytes);
}

type EffectObservation = Readonly<{
  outcome: "applied" | "not-applied" | "indeterminate";
  disposition: AdmissionDisposition | null;
  repository: FoundationAdmissionRepositoryObservationV7 | null;
}>;

async function observeEffect(input: Readonly<{
  target: string;
  store: ControlRecordStore;
  compiled: FoundationCompiledAdmissionEffectPlanV7;
  observedAt: string;
  selected: AdmissionOwners;
}>): Promise<EffectObservation> {
  let repository: FoundationAdmissionRepositoryObservationV7;
  try {
    repository = await input.selected.observeRepository(
      input.target,
      input.observedAt,
      input.compiled.plan.repository.canonicalCommit,
    );
  } catch (error) {
    if (
      error instanceof FoundationError &&
      error.code === "lifecycle.admission-v7.repository-drift"
    ) {
      return Object.freeze({
        outcome: "not-applied" as const,
        disposition: Object.freeze({
          outcome: "not-applied" as const,
          reason: "repository-basis-mismatch" as const,
          observedFactsDigest: digestCanonical(error.observedFacts ?? {
            failureCode: error.code,
          }),
        }),
        repository: null,
      });
    }
    return Object.freeze({
      outcome: "indeterminate",
      disposition: null,
      repository: null,
    });
  }
  if (
    repository.contract.targetId !== input.store.identity.targetId ||
    canonicalJson(repository.basis) !== canonicalJson(input.compiled.plan.repository)
  ) {
    return Object.freeze({
      outcome: "not-applied",
      disposition: Object.freeze({
        outcome: "not-applied",
        reason: "repository-basis-mismatch",
        observedFactsDigest: digestCanonical(repository.basis),
      }),
      repository,
    });
  }
  return Object.freeze({
    outcome: "applied",
    disposition: null,
    repository,
  });
}

function result(input: Readonly<{
  status: FoundationAdmissionV7Result["status"];
  compiled: FoundationCompiledAdmissionEffectPlanV7;
  transactionOutcome: FoundationAdmissionV7Result["transactionOutcome"];
  candidate?: ControlRecordRevision | null;
}>): FoundationAdmissionV7Result {
  return Object.freeze({
    status: input.status,
    activityId: input.compiled.plan.activityId,
    decisionKind: input.compiled.plan.decisionKind,
    effectDigest: input.compiled.effectDigest,
    transactionOutcome: input.transactionOutcome,
    decision: Object.freeze({
      id: input.compiled.decision.recordId,
      revision: input.compiled.decision.revision,
      digest: input.compiled.decision.digest,
    }),
    candidate: input.candidate === undefined || input.candidate === null
      ? null
      : Object.freeze({
          id: input.candidate.recordId,
          revision: input.candidate.revision,
          digest: input.candidate.digest,
        }),
  });
}

function checkpointAfterEffectObservation(input: Readonly<{
  checkpoint: AdmissionCheckpoint;
  observation: EffectObservation;
}>): AdmissionCheckpoint {
  const checkpoint = input.checkpoint;
  const observation = input.observation;
  const next = nextCheckpoint({
    current: checkpoint,
    disposition: observation.disposition,
  });
  return next;
}

function effectObservationFacts(
  observation: EffectObservation,
): FoundationAdmissionTransactionObservationFactsV1 {
  return Object.freeze({
    schema: FOUNDATION_ADMISSION_TRANSACTION_OBSERVATION_FACTS_V1,
    outcome: observation.outcome,
    disposition: observation.disposition,
    repositoryBasisDigest: observation.repository === null
      ? null
      : digestCanonical(observation.repository.basis),
  }) as FoundationAdmissionTransactionObservationFactsV1;
}

function sanitizedCandidateFailure(
  error: unknown,
): Readonly<{
  availability: "invalid" | "unavailable";
  failureFactsDigest: Sha256;
}> {
  if (!(error instanceof FoundationError)) throw error;
  const invalidCodes = new Set<string>([
    FOUNDATION_CANDIDATE_CARRIER_STATE_INVALID,
    FOUNDATION_CANDIDATE_CARRIER_ADMITTED_CONTEXT_INVALID,
    "lifecycle.candidate.carrier-invalid",
    "lifecycle.candidate.materialization-invalid",
  ]);
  const unavailableCodes = new Set<string>([
    FOUNDATION_CANDIDATE_CARRIER_STATE_UNAVAILABLE,
    FOUNDATION_CANDIDATE_CARRIER_ADMITTED_CONTEXT_UNAVAILABLE,
    "lifecycle.candidate.carrier-unavailable",
  ]);
  if (!invalidCodes.has(error.code) && !unavailableCodes.has(error.code)) {
    throw error;
  }
  const failureCode = error.code;
  return Object.freeze({
    availability: invalidCodes.has(failureCode) ? "invalid" : "unavailable",
    failureFactsDigest: digestCanonical({
      schema: "lifecycle.admission-candidate-failure.v1",
      failureCode,
    }),
  });
}

async function retainCandidateFailure(input: Readonly<{
  store: ControlRecordStore;
  context: AdmissionKernelContext;
  kernel: AdmissionCheckpointAdapter;
  observedAt: string;
  observation: Readonly<{
    availability: "invalid" | "unavailable";
    failureFactsDigest: Sha256;
  }>;
}>): Promise<AdmissionKernelContext> {
  const checkpoint = admissionCheckpoint(input.context);
  if (checkpoint.candidateFailures.length >= MAXIMUM_OBSERVATIONS) {
    fail("observation-bound", "Admission Candidate observation reached its retained fixed bound");
  }
  const index = checkpoint.candidateFailures.length + 1;
  const next = nextCheckpoint({
    current: checkpoint,
    candidateFailures: Object.freeze([
      ...checkpoint.candidateFailures,
      Object.freeze({
        index,
        observedAt: input.observedAt,
        availability: input.observation.availability,
        failureFactsDigest: input.observation.failureFactsDigest,
      }),
    ]),
  });
  assertCandidateFailureChronology({
    store: input.store,
    activityId: input.context.activity.id,
    candidateFailures: next.candidateFailures,
  });
  const retained = await input.kernel.commit({
    mode: "support-only",
    expected: input.context.coordinate,
    checkpoint: next,
  });
  return retained.context;
}

async function observeAdmittedCandidate(input: Readonly<{
  target: string;
  machineHome: string;
  store: ControlRecordStore;
  context: AdmissionKernelContext;
  kernel: AdmissionCheckpointAdapter;
  compiled: FoundationCompiledAdmissionEffectPlanV7;
  runtimeId: string;
  selected: AdmissionOwners;
}>): Promise<Readonly<{
  status: "continue" | "deferred";
  context: AdmissionKernelContext;
  revision: ControlRecordRevision | null;
}>> {
  let context = input.context;
  const checkpoint = admissionCheckpoint(context);
  if (checkpoint.candidateFailures.length >= MAXIMUM_OBSERVATIONS) {
    fail(
      "observation-bound",
      "Admission Candidate observation reached its retained fixed bound",
    );
  }
  const observedAt = sampleTime(input.selected, "Admission Candidate observation time");
  let prepared: Awaited<ReturnType<typeof prepareCandidateRevisionRetention>>;
  try {
    const repository = await input.selected.observeRepository(
      input.target,
      observedAt,
      input.compiled.plan.repository.canonicalCommit,
    );
    assertRepositoryBasis(input.store, repository, input.compiled.plan.repository);
    const continuingCandidate = input.compiled.plan.continuingCandidate === null
      ? null
      : resolveStateCandidate(input.store, input.compiled.plan.continuingCandidate);
    if (input.compiled.plan.decisionKind === "readmit" && continuingCandidate === null) {
      fail("candidate", "Readmission plan omits its exact continuing Candidate");
    }
    const predecessor = input.compiled.plan.continuingCandidate;
    const retainedState = continuingCandidate === null
      ? null
      : availableCandidateState(continuingCandidate);
    const carrierManifestBytes = continuingCandidate === null
      ? (await input.selected.publishCandidateCarrier({
          machineHome: input.machineHome,
          repository: repository.repository,
          rootTree: input.compiled.plan.repository.canonicalTree,
        })).manifestBytes
      : await retainedCandidateCarrierManifestBytes(input.store, continuingCandidate);
    prepared = await prepareCandidateRevisionRetention({
      store: input.store,
      activityId: input.compiled.plan.activityId,
      observation: predecessor === null ? "initialization" : "readmission-rebind",
      candidateBaseCommit: input.compiled.plan.candidate.baseCommit,
      carrierManifestBytes,
      verifyCarrier: await input.selected.carrierVerifier({
        machineHome: input.machineHome,
        repository: input.target,
        store: input.store,
        boundary: input.compiled.boundary,
        ...(continuingCandidate === null ? {} : { candidate: continuingCandidate }),
        predecessor: retainedState === null
          ? null
          : Object.freeze({
              candidateDigest: digest(
                retainedState.candidateDigest,
                "Continuing Candidate digest",
              ),
            }),
      }),
      boundary: input.compiled.plan.boundary,
      predecessor,
      observedAt,
      runtimeId: input.runtimeId,
    });
  } catch (error) {
    const observation = sanitizedCandidateFailure(error);
    context = await retainCandidateFailure({
      store: input.store,
      context,
      kernel: input.kernel,
      observedAt,
      observation,
    });
    await input.selected.onStage("candidate-observation-unavailable");
    return Object.freeze({ status: "deferred" as const, context, revision: null });
  }
  const committed = await commitPreparedCandidateRevisionThroughActivityV7({
    activity: input.kernel,
    expected: context.coordinate,
    checkpoint,
    prepared,
  });
  await input.selected.onStage("candidate-revision-observed");
  return Object.freeze({
    status: "continue" as const,
    context: committed.context,
    revision: committed.retained.revision,
  });
}

function resolveStateCandidate(
  store: ControlRecordStore,
  referenceValue: Readonly<{ id: string; revision: number; digest: Sha256 }> | null,
): ControlRecordRevision | null {
  if (referenceValue === null) return null;
  const revision = store.getRevision(referenceValue.id, referenceValue.revision);
  if (
    revision === null || revision.recordKind !== "candidate-revision" ||
    revision.digest !== referenceValue.digest
  ) {
    fail("candidate", "Delivery state Candidate does not resolve exactly");
  }
  return revision;
}

async function stepAdmission(input: Readonly<{
  target: string;
  machineHome: string;
  store: ControlRecordStore;
  context: AdmissionKernelContext;
  kernel: AdmissionCheckpointAdapter;
  compiled: FoundationCompiledAdmissionEffectPlanV7;
  runtimeId: string;
  selected: AdmissionOwners;
}>): Promise<
  | Readonly<{ status: "continue" }>
  | Readonly<{ status: "deferred"; value: FoundationAdmissionV7Result }>
  | Readonly<{ status: "settled"; value: FoundationAdmissionV7Result }>
> {
  assertContextMatchesDecision({
    store: input.store,
    context: input.context,
    compiled: input.compiled,
  });
  const checkpoint = admissionCheckpoint(input.context);
  const transaction = await advanceFoundationActivityKernelTransactionEffectV7({
    store: input.store,
    context: input.context,
    checkpoint: input.kernel,
    effectDigest: input.compiled.effectDigest,
    runtimeId: input.runtimeId,
    maximumObservations: MAXIMUM_OBSERVATIONS,
    sampleIntendedAt: () => sampleTime(input.selected, "Admission transaction intent time"),
    sampleObservedAt: () => sampleTime(
      input.selected,
      "Admission transaction effect observation time",
    ),
    observe: async ({ checkpoint: retained, observedAt }) => {
      if (retained === null) fail("support", "Admission transaction requires its exact checkpoint");
      const observation = await observeEffect({
        target: input.target,
        store: input.store,
        compiled: input.compiled,
        observedAt,
        selected: input.selected,
      });
      return Object.freeze({
        outcome: observation.outcome,
        facts: effectObservationFacts(observation),
        checkpoint: checkpointAfterEffectObservation({
          checkpoint: retained,
          observation,
        }),
      });
    },
    onCommitted: async ({ eventKind }) => input.selected.onStage(eventKind),
  });
  if (transaction.status === "deferred") {
    return Object.freeze({
      status: "deferred" as const,
      value: result({
        status: "recovery-required",
        compiled: input.compiled,
        transactionOutcome: "indeterminate",
      }),
    });
  }
  if (transaction.status === "continue") {
    return Object.freeze({ status: "continue" as const });
  }
  if (input.context.recovery.resumesAt === "activity-completed") {
    if (transaction.outcome === "not-applied") {
      if (checkpoint.disposition === null) {
        fail("disposition", "Not-applied admission lacks its exact semantic disposition");
      }
      finishFoundationActivityKernelV7({
        store: input.store,
        activityId: input.context.activity.id,
        definition: FOUNDATION_ADMISSION_ACTIVITY_DEFINITION_V7,
        outcome: "failed",
        runtimeId: input.runtimeId,
        sampleCompletedAt: () => sampleTime(
          input.selected,
          "Admission activity completion time",
        ),
      });
      await input.selected.onStage("activity-completed");
      return Object.freeze({
        status: "settled" as const,
        value: result({
          status: "failed",
          compiled: input.compiled,
          transactionOutcome: "not-applied",
        }),
      });
    }
    if (transaction.outcome === "applied") {
      const state = input.store.state();
      const candidate = resolveStateCandidate(input.store, state.subjects.candidate);
      if (candidate === null) {
        fail("candidate", "Initial admission completion requires its observed Candidate revision");
      }
      finishFoundationActivityKernelV7({
        store: input.store,
        activityId: input.context.activity.id,
        definition: FOUNDATION_ADMISSION_ACTIVITY_DEFINITION_V7,
        outcome: "completed",
        runtimeId: input.runtimeId,
        sampleCompletedAt: () => sampleTime(
          input.selected,
          "Admission activity completion time",
        ),
      });
      await input.selected.onStage("activity-completed");
      return Object.freeze({
        status: "settled" as const,
        value: result({
          status: "completed",
          compiled: input.compiled,
          transactionOutcome: "applied",
          candidate,
        }),
      });
    }
    fail("completion", "Admission completion has no exact determinate transaction outcome");
  }
  if (input.context.recovery.resumesAt !== "candidate-revision-observed") {
    fail("support-stage", "Admission is not at its exact Candidate recovery coordinate");
  }
  const candidate = await observeAdmittedCandidate({
      target: input.target,
      machineHome: input.machineHome,
      store: input.store,
      context: input.context,
      kernel: input.kernel,
      compiled: input.compiled,
      runtimeId: input.runtimeId,
      selected: input.selected,
  });
  if (candidate.status === "deferred") {
    return Object.freeze({
      status: "deferred" as const,
      value: result({
        status: "recovery-required",
        compiled: input.compiled,
        transactionOutcome: "applied",
      }),
    });
  }
  return Object.freeze({ status: "continue" as const });
}

function settledCandidate(
  store: ControlRecordStore,
  compiled: FoundationCompiledAdmissionEffectPlanV7,
): ControlRecordRevision | null {
  const events = allEvents(store).filter((event) =>
    event.eventKind === "candidate-revision-observed" &&
    event.payload.activityId === compiled.plan.activityId);
  if (events.length !== 1 || events[0]!.subject === null) {
    return null;
  }
  return resolveStateCandidate(store, Object.freeze({
    id: events[0]!.subject!.recordId,
    revision: events[0]!.subject!.revision,
    digest: events[0]!.subject!.digest,
  }));
}

function settledAdmissionResult(
  store: ControlRecordStore,
  compiled: FoundationCompiledAdmissionEffectPlanV7,
): FoundationAdmissionV7Result {
  const completions = allEvents(store).filter((event) =>
    event.eventKind === "activity-completed" &&
    event.payload.activityId === compiled.plan.activityId);
  if (completions.length !== 1) {
    fail("support", "Incomplete admission cannot recover without exact live operation support");
  }
  const outcome = completions[0]!.payload.outcome;
  if (outcome === "completed") {
    const candidate = settledCandidate(store, compiled);
    if (candidate === null) fail("candidate", "Completed admission omits its exact Candidate");
    return result({
      status: "completed",
      compiled,
      transactionOutcome: "applied",
      candidate,
    });
  }
  if (outcome !== "failed") {
    fail("completion", "Admission has an unsupported retained completion outcome");
  }
  return result({
    status: "failed",
    compiled,
    transactionOutcome: "not-applied",
  });
}

function proposedBoundaryBaseCommit(store: ControlRecordStore): string {
  const proposed = store.state().subjects.proposedBoundary;
  if (proposed === null) fail("boundary", "Admission has no exact proposed Work Boundary");
  const boundary = store.getRevision(proposed.id, proposed.revision);
  if (
    boundary === null || boundary.recordKind !== "work-boundary" ||
    boundary.digest !== proposed.digest
  ) {
    fail("boundary", "Admission proposed Work Boundary does not resolve exactly");
  }
  return string(
    object(boundary.payload.basis, "Proposed Work Boundary basis").productBaseCommit,
    "Proposed Work Boundary product-base commit",
  );
}

function unverifiedAdmissionRepositoryBasis(
  store: ControlRecordStore,
  activityId: string,
): DirectorDecisionRepositoryBasis {
  const decisions = allEvents(store).filter((event) =>
    event.eventKind === "director-decision-authenticated" &&
    event.payload.activityId === activityId);
  if (decisions.length !== 1 || decisions[0]!.subject === null) {
    fail("decision", "Admission recovery requires one exact retained Director Decision");
  }
  const selected = decisions[0]!.subject!;
  const revision = store.getRevision(selected.recordId, selected.revision);
  if (
    revision === null || revision.recordKind !== "director-decision" ||
    revision.digest !== selected.digest
  ) {
    fail("decision", "Admission recovery Director Decision does not resolve exactly");
  }
  const subject = object(revision.payload.subject, "Director Decision subject");
  if (subject.activityId !== activityId) {
    fail("decision", "Admission recovery Director Decision selects another activity");
  }
  const repository = object(subject.repository, "Director Decision repository basis");
  validateRepositoryBasis(repository, "Director Decision repository basis");
  return repository as unknown as DirectorDecisionRepositoryBasis;
}

/**
 * Authenticate and operate one admission without exposing a separately
 * retainable activity-start or authorization step.
 */
export async function admitDeliveryV7(
  input: FoundationAdmissionV7Input,
  options: FoundationAdmissionV7Options = {},
): Promise<FoundationAdmissionV7Result> {
  const selected = owners(options, input);
  return selected.withDeliveryLock({
    machineHome: input.machineHome,
    targetId: input.store.identity.targetId,
    deliveryId: input.store.identity.processId,
  }, "delivery-admit", async () => {
    const state = input.store.state();
    if (!state.eligibleOperations.includes("delivery.admit")) {
      fail("standing", "Delivery is not eligible for one exact admission opening");
    }
    const historicalCommit = proposedBoundaryBaseCommit(input.store);
    const basisObservedAt = sampleTime(selected, "Admission pre-authorization repository observation time");
    const repository = await selected.observeRepository(
      input.target,
      basisObservedAt,
      historicalCommit,
    );
    if (repository.contract.targetId !== input.store.identity.targetId) {
      fail("repository", "Admission repository contract does not bind the exact Store target");
    }
    const times = openingTimes(selected);
    const activityId = createDeliveryActivityId("delivery.admit");
    const opening = await authenticateDirectorDecisionOpening({
      store: input.store,
      activityId,
      operation: "delivery.admit",
      semanticMarkdown: [
        "# Director Admission Decision",
        "",
        "Authorize the exact selected admission Control subjects on the observed repository basis.",
        "",
      ].join("\n"),
      repository: repository.basis,
      contract: repository.contract,
      authorityHome: input.authorityHome,
      authorityCredential: input.authorityCredential,
      startedAt: times.startedAt,
      authorizedAt: times.authorizedAt,
      expiresAt: null,
      nonce: `admission-${randomUUID()}`,
      verifiedAt: times.verifiedAt,
      runtimeId: input.runtimeId,
      beforeAuthenticate: selected.beforeAuthenticate,
    });
    const compiled = planFromDecision(input.store, opening.revision, opening.subject);
    openFoundationActivityKernelV7({
      store: input.store,
      activityId,
      definition: FOUNDATION_ADMISSION_ACTIVITY_DEFINITION_V7,
      plan: compiled.plan as AdmissionPlan,
      checkpoint: checkpointPayload({}),
      appends: Object.freeze([opening.activityAppend, opening.decisionAppend]),
    });
    await selected.onStage("opening-committed");
    return advanceFoundationActivityKernelV7({
      store: input.store,
      activityId,
      definition: FOUNDATION_ADMISSION_ACTIVITY_DEFINITION_V7,
      runtimeId: input.runtimeId,
      advance: ({ context, checkpoint }) => stepAdmission({
        target: input.target,
        machineHome: input.machineHome,
        store: input.store,
        context,
        kernel: checkpoint,
        compiled,
        runtimeId: input.runtimeId,
        selected,
      }),
    });
  });
}

/** Reverify and continue one exact retained admission activity. */
export async function recoverAdmissionV7(
  input: FoundationAdmissionRecoveryV7Input,
  options: FoundationAdmissionV7Options = {},
): Promise<FoundationAdmissionV7Result> {
  const selected = owners(options, input);
  return selected.withDeliveryLock({
    machineHome: input.machineHome,
    targetId: input.store.identity.targetId,
    deliveryId: input.store.identity.processId,
  }, "delivery-admit", async () => {
    const state = input.store.state();
    const activityId = input.activityId === undefined
      ? (() => {
          const incomplete = state.activities.filter((activity) =>
            activity.operation === "delivery.admit" && activity.stage !== "completed");
          if (incomplete.length !== 1) {
            fail("recovery", "Admission recovery requires one exact incomplete activity identity");
          }
          return incomplete[0]!.id;
        })()
      : controlIdentifier(input.activityId, "Admission recovery activity identity");
    const activity = state.activities.find(({ id }) => id === activityId);
    if (activity === undefined || activity.operation !== "delivery.admit") {
      fail("recovery", "Admission recovery activity does not resolve exactly");
    }
    const verifiedAt = sampleTime(selected, "Admission recovery Decision verification time");
    const unverifiedBasis = unverifiedAdmissionRepositoryBasis(input.store, activityId);
    const repository = await selected.observeRepository(
      input.target,
      verifiedAt,
      unverifiedBasis.canonicalCommit,
    );
    const compiled = compileFoundationAdmissionEffectPlanV7(
      input.store,
      activityId,
      repository.contract,
    );
    assertRepositoryBasis(input.store, repository, compiled.plan.repository);
    if (activity.stage === "completed") return settledAdmissionResult(input.store, compiled);
    const context = readFoundationActivityKernelV7({
      store: input.store,
      activityId,
      definition: FOUNDATION_ADMISSION_ACTIVITY_DEFINITION_V7,
    });
    assertContextMatchesDecision({ store: input.store, context, compiled });
    return recoverFoundationActivityKernelV7({
      store: input.store,
      activityId,
      definition: FOUNDATION_ADMISSION_ACTIVITY_DEFINITION_V7,
      runtimeId: input.runtimeId,
      now: selected.now,
      resume: ({ context: current, checkpoint }) => stepAdmission({
          target: input.target,
          machineHome: input.machineHome,
          store: input.store,
          context: current,
          kernel: checkpoint,
          compiled,
          runtimeId: input.runtimeId,
          selected,
      }),
    });
  });
}
