import { createHash, randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { FOUNDATION_RUNTIME_PROTOCOL } from "../constants.js";
import {
  importCandidateRevisionCarrierIntoRepository,
} from "../candidate/carrier-import.js";
import {
  verifyCandidateCarriersForStoreArchive,
} from "../candidate/carrier-archive-verifier.js";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
} from "../candidate/carrier-types.js";
import { createDeliveryActivityId } from "../control/activity.js";
import {
  compileClosureAppend,
  type ClosureCanonicalResult,
  type ClosureReclamationHandoff,
  type ClosureRuntimeCoordinates,
  type ClosureTerminalExecutions,
} from "../control/closure.js";
import { archiveDeliveryControlRecordStore } from "../control/delivery-custody.js";
import {
  compileFounderDecisionOpening,
  verifyRetainedFounderDecision,
  type FounderDecisionControlBinding,
  type FounderDecisionRepositoryBasis,
  type FounderDecisionSubject,
} from "../control/founder-decision.js";
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
import {
  foundationExecutionReclamationPreIntentRefusalSetDigestV1,
  foundationExecutionReclamationTerminalSubjectSetDigestV1,
  type FoundationExecutionReclamationPreIntentRefusalV1,
  type FoundationExecutionReclamationTerminalSubjectV1,
  type FoundationExecutionReclamationTerminalVerificationV1,
} from "../execution/reclamation-ledger-v1.js";
import { validateKnowledgeSet } from "../knowledge/knowledge-set.js";
import {
  canonicalRepository,
  exactTreeEntries,
  git,
  resolveAttachedEpoch,
  worktreePathInventory,
} from "../repository/git.js";
import { withTargetOperationLock } from "../repository/operation-lock.js";
import {
  bindHistoricalRepositorySnapshot,
  bindRepositorySnapshot,
  loadRepositoryEpoch,
  loadRepositoryEpochAtCommit,
} from "../repository/snapshot.js";
import type {
  FoundationGitObjectFormat,
  FoundationRepositoryContract,
} from "../repository/types.js";
import { validateLoadedRepositorySnapshot } from "../repository/validate.js";
import {
  canonicalJson,
  digestCanonical,
  type Sha256,
} from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import {
  advanceFoundationActivityKernelTransactionEffectV7,
  advanceFoundationActivityKernelV7,
  finishFoundationActivityKernelV7,
  finishFoundationTerminalActivityKernelV7,
  openFoundationActivityKernelV7,
  readFoundationActivityKernelV7,
  recoverFoundationActivityKernelV7,
  type FoundationActivityKernelCheckpointAdapterV7,
  type FoundationActivityKernelContextV7,
  type FoundationActivityKernelTerminalDefinitionV7,
} from "../process/activity-kernel-v7.js";
import {
  FOUNDATION_TERMINAL_ACCEPTANCE_OBSERVATION_FACTS_V1,
  FOUNDATION_TERMINAL_DETACHED_OBSERVATION_FACTS_V1,
  FOUNDATION_TERMINAL_FAILURE_OBSERVATION_FACTS_V1,
  FOUNDATION_TERMINAL_REPOSITORY_OBSERVATION_FACTS_V1,
  type FoundationTerminalAcceptanceObservationFactsV1,
  type FoundationTerminalDetachedObservationFactsV1,
  type FoundationTerminalFailureObservationFactsV1,
  type FoundationTerminalRepositoryObservationFactsV1,
  type FoundationTransactionObservationFactsV7,
} from "../process/transaction-observation-facts-v7.js";

const RUNTIME_COORDINATE = FOUNDATION_RUNTIME_PROTOCOL;
const TRANSACTION_RULES = "lifecycle.delivery-transaction-rules.v1" as const;
const PLAN_SCHEMA = "lifecycle.runtime-terminal-effect-plan.v1" as const;
const CHECKPOINT_SCHEMA = "lifecycle.runtime-terminal-checkpoint.v4" as const;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const GIT_OBJECT = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;
const GIT_REF = /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._\/-]*$/u;

const TERMINAL_IMPLEMENTATION_PROFILE = Object.freeze({
  schema: "lifecycle.runtime-terminal-transaction-implementation.v1",
  id: "foundation-terminal-transaction-v7",
  runtime: RUNTIME_COORDINATE,
  algorithms: Object.freeze([
    "founder-authenticated-terminal-opening",
    "verified-carrier-import-and-deterministic-candidate-tree-commit",
    "canonical-ref-compare-and-swap",
    "exact-effect-observation",
    "exact-candidate-treatment",
    "complete-execution-containment-and-retirement",
    "immutable-reclamation-handoff",
    "atomic-closure-and-support-disposal",
    "sealed-off-head-store-archive",
  ]),
});

const TERMINAL_RULE_SET = Object.freeze({
  schema: "lifecycle.runtime-terminal-transaction-rule-set.v1",
  id: "foundation-terminal-transaction-rules-v1",
  transactionRules: TRANSACTION_RULES,
  terminalEvent: "closure-recorded",
  acceptanceEffect: "deterministic-commit-and-ref-cas",
  noShipEffect: "exact-non-integration-observation",
});

export const FOUNDATION_TERMINAL_TRANSACTION_V7 = Object.freeze({
  id: TERMINAL_IMPLEMENTATION_PROFILE.id,
  implementationDigest: digestCanonical(TERMINAL_IMPLEMENTATION_PROFILE),
  ruleSetId: TERMINAL_RULE_SET.id,
  ruleSetDigest: digestCanonical(TERMINAL_RULE_SET),
});

type TerminalOperation = "delivery.accept" | "delivery.no-ship";
type TerminalDecision = "accept" | "no-ship";

type RevisionReference<Kind extends string> = Readonly<{
  kind: Kind;
  id: string;
  revision: number;
  digest: Sha256;
}>;

type CandidateState = Readonly<{
  tree: string;
  candidateDigest: Sha256;
  productStateDigest: Sha256;
  knowledgeSetDigest: Sha256;
  diffDigest: Sha256;
  pathInventoryDigest: Sha256;
  artifactSetDigest: Sha256;
  descriptionCoverageDigest: Sha256;
  unchangedFromPredecessor: boolean;
  changedSubjects: readonly ControlJsonValue[];
}>;

type TerminalCandidatePlan = Readonly<{
  reference: RevisionReference<"candidate-revision">;
  baseCommit: string;
  state: CandidateState;
  carrierManifest: Readonly<{
    digest: Sha256;
    byteLength: number;
    mediaType: typeof FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE;
    purpose: typeof FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE;
  }>;
}>;

type AcceptanceCommitTemplate = Readonly<{
  message: string;
  authorName: "Lifecycle Foundation Runtime";
  authorEmail: "lifecycle@invalid";
  authoredAtUnix: number;
  timezone: "+0000";
}>;

export type FoundationTerminalEffectPlanV7 = Readonly<{
  schema: typeof PLAN_SCHEMA;
  runtime: typeof RUNTIME_COORDINATE;
  transactionRules: typeof TRANSACTION_RULES;
  operation: TerminalOperation;
  decisionKind: TerminalDecision;
  targetId: string;
  storeId: string;
  processId: string;
  activityId: string;
  decision: RevisionReference<"founder-decision"> & Readonly<{ subjectDigest: Sha256 }>;
  boundary: RevisionReference<"work-boundary"> | null;
  candidate: TerminalCandidatePlan | null;
  seal: RevisionReference<"candidate-seal"> | null;
  evidence: RevisionReference<"evidence-packet"> | null;
  candidateTreatment: "integrated" | "abandoned" | "not-created";
  repository: FounderDecisionRepositoryBasis;
  canonical: Readonly<{
    ref: string;
    objectFormat: FoundationGitObjectFormat;
    expectedCommit: string;
    expectedTree: string;
  }>;
  acceptanceCommitTemplate: AcceptanceCommitTemplate | null;
}>;

export type FoundationCompiledTerminalEffectPlanV7 = Readonly<{
  plan: FoundationTerminalEffectPlanV7;
  effectDigest: Sha256;
  decision: ControlRecordRevision;
}>;

type TerminalOpeningTimes = Readonly<{
  startedAt: string;
  authorizedAt: string;
  verifiedAt: string;
}>;

type TerminalDispositionFact = Readonly<{
  terminalAt: string;
  canonicalResult: ClosureCanonicalResult | null;
  terminalExecutions: ClosureTerminalExecutions;
  reclamationHandoff: ClosureReclamationHandoff;
}>;

type TerminalCheckpoint = ControlJsonObject & Readonly<{
  schema: typeof CHECKPOINT_SCHEMA;
  acceptance: ClosureCanonicalResult | null;
  terminalDisposition: TerminalDispositionFact | null;
}>;

type TerminalPlan = ControlJsonObject & FoundationTerminalEffectPlanV7;
type TerminalKernelContext = FoundationActivityKernelContextV7<
  TerminalPlan,
  TerminalCheckpoint
>;
type TerminalCheckpointAdapter = FoundationActivityKernelCheckpointAdapterV7<
  TerminalPlan,
  TerminalCheckpoint
>;

export type FoundationTerminalRepositoryObservationV7 = Readonly<{
  repository: string;
  contract: FoundationRepositoryContract;
  basis: FounderDecisionRepositoryBasis;
  ref: string;
  objectFormat: FoundationGitObjectFormat;
}>;

export type FoundationTerminalV7Result = Readonly<{
  status: "completed" | "failed" | "recovery-required";
  activityId: string;
  decisionKind: TerminalDecision;
  effectDigest: Sha256;
  transactionOutcome: "applied" | "not-applied" | "indeterminate";
  decision: Readonly<{ id: string; revision: number; digest: Sha256 }>;
  closure: Readonly<{ id: string; revision: number; digest: Sha256 }> | null;
  canonicalCommit: string | null;
  archiveManifestDigest: Sha256 | null;
}>;

export type FoundationTerminalV7Stage =
  | "opening-committed"
  | "transaction-effect-intended"
  | "transaction-effect-observed"
  | "terminal-disposition-observed"
  | "closure-recorded"
  | "activity-completed"
  | "store-sealed"
  | "store-archived";

type TargetLock = <Value>(
  target: string,
  operation: string,
  action: () => Promise<Value>,
) => Promise<Value>;

type ArchiveResult = Readonly<{ manifestDigest: Sha256 }>;

type TerminalOwners = Readonly<{
  now: () => string;
  withTargetLock: TargetLock;
  observeRepository: (
    target: string,
    observedAt: string,
  ) => Promise<FoundationTerminalRepositoryObservationV7>;
  importCandidateCarrier: typeof importCandidateRevisionCarrierIntoRepository;
  verifyCandidateCarriers: typeof verifyCandidateCarriersForStoreArchive;
  observeReclamationHandoff: (input: Readonly<{
    machineHome: string;
    storeId: string;
    processId: string;
    subjects: readonly FoundationExecutionReclamationTerminalSubjectV1[];
    preIntentRefusals: readonly FoundationExecutionReclamationPreIntentRefusalV1[];
  }>) => Promise<FoundationExecutionReclamationTerminalVerificationV1>;
  archiveStore: (input: Readonly<{
    machineHome: string;
    targetId: string;
    deliveryId: string;
    archivedAt: string;
  }>) => Promise<ArchiveResult>;
  onStage: (stage: FoundationTerminalV7Stage) => void | Promise<void>;
}>;

export type FoundationTerminalV7Options = Readonly<{
  now?: () => string;
  withTargetLock?: TargetLock;
  observeRepository?: TerminalOwners["observeRepository"];
  importCandidateCarrier?: TerminalOwners["importCandidateCarrier"];
  verifyCandidateCarriers?: TerminalOwners["verifyCandidateCarriers"];
  observeReclamationHandoff?: TerminalOwners["observeReclamationHandoff"];
  archiveStore?: TerminalOwners["archiveStore"];
  onStage?: TerminalOwners["onStage"];
}>;

export type FoundationTerminalV7Input = Readonly<{
  target: string;
  machineHome: string;
  store: ControlRecordStore;
  authorityHome: string;
  authoritySecret: string;
  /** Required only for the Founder-authored no-ship rationale. */
  semanticMarkdown?: string;
  runtimeId: string;
}>;

export type FoundationTerminalRecoveryV7Input = Readonly<{
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
  throw new FoundationError(`lifecycle.terminal-v7.${code}`, message, { observedFacts });
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
  selected: FounderDecisionControlBinding,
): ControlRecordRevision {
  const revision = store.getRevision(selected.target.id, selected.target.revision);
  if (
    revision === null || revision.recordKind !== selected.target.kind ||
    revision.digest !== selected.target.digest
  ) {
    fail("selected-control", "Terminal selected Control binding does not resolve exactly");
  }
  assertDeliveryControlRecordPayload(revision);
  return revision;
}

function bindings(
  subject: FounderDecisionSubject,
  relation: FounderDecisionControlBinding["relation"],
): readonly FounderDecisionControlBinding[] {
  return subject.selectedControl.filter((value) => value.relation === relation);
}

function optionalBinding(
  subject: FounderDecisionSubject,
  relation: FounderDecisionControlBinding["relation"],
): FounderDecisionControlBinding | null {
  const selected = bindings(subject, relation);
  if (selected.length > 1) fail("selected-control", `Terminal Decision carries repeated ${relation}`);
  return selected[0] ?? null;
}

function noBinding(
  subject: FounderDecisionSubject,
  relation: FounderDecisionControlBinding["relation"],
): void {
  if (bindings(subject, relation).length !== 0) {
    fail("selected-control", `Terminal Decision cannot carry ${relation}`);
  }
}

function sameReference(
  relationship: ControlRecordRevision,
  relation: string,
  expected: ControlRecordRevision,
): boolean {
  const matches = relationship.relationships.filter((value) => value.relation === relation);
  return matches.length === 1 &&
    matches[0]!.target.kind === expected.recordKind &&
    matches[0]!.target.id === expected.recordId &&
    matches[0]!.target.revision === expected.revision &&
    matches[0]!.target.digest === expected.digest;
}

function candidateState(revision: ControlRecordRevision): CandidateState {
  if (
    revision.payload.schema !== "lifecycle.candidate-revision-payload.v2"
  ) {
    fail("candidate", "Terminal Decision requires one exact reconstructible Candidate Revision");
  }
  const state = object(revision.payload.state, "Terminal Candidate state");
  const tree = string(state.tree, "Terminal Candidate tree");
  if (!GIT_OBJECT.test(tree)) fail("candidate", "Terminal Candidate tree must be one full Git object identity");
  return Object.freeze({
    tree,
    candidateDigest: digest(state.candidateDigest, "Terminal Candidate digest"),
    productStateDigest: digest(state.productStateDigest, "Terminal Candidate Product State digest"),
    knowledgeSetDigest: digest(state.knowledgeSetDigest, "Terminal Candidate Knowledge Set digest"),
    diffDigest: digest(state.diffDigest, "Terminal Candidate diff digest"),
    pathInventoryDigest: digest(state.pathInventoryDigest, "Terminal Candidate path inventory digest"),
    artifactSetDigest: digest(state.artifactSetDigest, "Terminal Candidate artifact set digest"),
    descriptionCoverageDigest: digest(
      state.descriptionCoverageDigest,
      "Terminal Candidate description coverage digest",
    ),
    unchangedFromPredecessor: state.unchangedFromPredecessor === true,
    changedSubjects: Object.freeze([...array(state.changedSubjects, "Terminal Candidate changed subjects")]),
  });
}

function candidateCarrierManifest(
  revision: ControlRecordRevision,
): TerminalCandidatePlan["carrierManifest"] {
  const carrier = object(
    revision.payload.carrierManifest,
    "Terminal Candidate Carrier manifest reference",
  );
  exactKeys(
    carrier,
    ["digest", "byteLength", "mediaType", "purpose"],
    "Terminal Candidate Carrier manifest reference",
  );
  if (
    carrier.mediaType !== FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE ||
    carrier.purpose !== FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE
  ) {
    fail("candidate", "Terminal Candidate does not select one exact Carrier manifest");
  }
  return Object.freeze({
    digest: digest(carrier.digest, "Terminal Candidate Carrier manifest digest"),
    byteLength: integer(carrier.byteLength, "Terminal Candidate Carrier manifest byte length"),
    mediaType: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
    purpose: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
  });
}

function acceptedCommitBytes(input: Readonly<{
  tree: string;
  parent: string;
  authoredAtUnix: number;
  message: string;
}>): Buffer {
  return Buffer.from([
    `tree ${input.tree}`,
    `parent ${input.parent}`,
    `author Lifecycle Foundation Runtime <lifecycle@invalid> ${input.authoredAtUnix} +0000`,
    `committer Lifecycle Foundation Runtime <lifecycle@invalid> ${input.authoredAtUnix} +0000`,
    "",
    input.message,
  ].join("\n"), "utf8");
}

function gitObjectDigest(
  bytes: Buffer,
  objectFormat: FoundationGitObjectFormat,
): string {
  const header = Buffer.from(`commit ${bytes.byteLength}\u0000`, "utf8");
  return createHash(objectFormat).update(header).update(bytes).digest("hex");
}

function acceptanceCommitTemplate(input: Readonly<{
  subject: FounderDecisionSubject;
  decision: ControlRecordRevision;
  candidate: ControlRecordRevision;
}>): AcceptanceCommitTemplate {
  const authoredAtUnix = Math.floor(Date.parse(input.subject.authorizedAt) / 1_000);
  if (!Number.isSafeInteger(authoredAtUnix) || authoredAtUnix < 0) {
    fail("commit", "Founder Decision authorization time cannot name a deterministic Git commit");
  }
  const message = [
    "Lifecycle acceptance",
    "",
    `Delivery: ${input.subject.processId}`,
    `Decision: ${input.decision.recordId} revision ${input.decision.revision} ${input.decision.digest}`,
    `Candidate: ${input.candidate.recordId} revision ${input.candidate.revision} ${input.candidate.digest}`,
    "",
  ].join("\n");
  return Object.freeze({
    message,
    authorName: "Lifecycle Foundation Runtime",
    authorEmail: "lifecycle@invalid",
    authoredAtUnix,
    timezone: "+0000",
  });
}

type AcceptanceCommitPlan = AcceptanceCommitTemplate & Readonly<{
  commit: string;
  tree: string;
  parent: string;
}>;

function instantiateAcceptanceCommit(input: Readonly<{
  template: AcceptanceCommitTemplate;
  tree: string;
  parent: string;
  objectFormat: FoundationGitObjectFormat;
}>): AcceptanceCommitPlan {
  const bytes = acceptedCommitBytes({
    tree: input.tree,
    parent: input.parent,
    authoredAtUnix: input.template.authoredAtUnix,
    message: input.template.message,
  });
  return Object.freeze({
    ...input.template,
    commit: gitObjectDigest(bytes, input.objectFormat),
    tree: input.tree,
    parent: input.parent,
  });
}

function planFromDecision(
  store: ControlRecordStore,
  decision: ControlRecordRevision,
  subject: FounderDecisionSubject,
  contract: FoundationRepositoryContract,
  objectFormat: FoundationGitObjectFormat,
): FoundationCompiledTerminalEffectPlanV7 {
  if (!(subject.operation === "delivery.accept" || subject.operation === "delivery.no-ship")) {
    fail("decision", "Terminal plan requires exact accept or no-ship authority");
  }
  const decisionKind = subject.operation === "delivery.accept" ? "accept" : "no-ship";
  if (subject.decision !== decisionKind) {
    fail("decision", "Terminal operation and authenticated Decision do not match");
  }
  if (contract.canonicalBranch.length > 1024 || !GIT_REF.test(contract.canonicalBranch)) {
    fail("repository", "Terminal repository contract does not select one exact canonical branch");
  }
  if (
    !GIT_OBJECT.test(subject.repository.canonicalCommit) ||
    !GIT_OBJECT.test(subject.repository.canonicalTree) ||
    subject.repository.canonicalCommit.length !== (objectFormat === "sha1" ? 40 : 64) ||
    subject.repository.canonicalTree.length !== (objectFormat === "sha1" ? 40 : 64)
  ) {
    fail("repository", "Terminal repository basis has an invalid Git object format");
  }
  noBinding(subject, "selects-baseline-receipt");
  noBinding(subject, "continues-from-boundary");

  const boundaryBinding = optionalBinding(subject, "selects-boundary");
  const boundary = boundaryBinding === null ? null : resolveBinding(store, boundaryBinding);
  const candidateBinding = optionalBinding(subject, "selects-candidate");
  const candidate = candidateBinding === null ? null : resolveBinding(store, candidateBinding);
  const sealBinding = optionalBinding(subject, "selects-seal");
  const seal = sealBinding === null ? null : resolveBinding(store, sealBinding);
  const evidenceBinding = optionalBinding(subject, "selects-evidence");
  const evidence = evidenceBinding === null ? null : resolveBinding(store, evidenceBinding);

  let selectedCandidate: TerminalCandidatePlan | null = null;
  let selectedSeal: RevisionReference<"candidate-seal"> | null = null;
  let selectedEvidence: RevisionReference<"evidence-packet"> | null = null;
  let commitTemplate: AcceptanceCommitTemplate | null = null;
  if (decisionKind === "accept") {
    if (boundary === null || candidate === null || seal === null || evidence === null) {
      fail("selected-control", "Acceptance requires exact Boundary, Candidate, Seal, and Evidence selections");
    }
    if (
      !sameReference(seal, "seals", candidate) ||
      !sameReference(seal, "governed-by", boundary) ||
      !sameReference(evidence, "evaluates", candidate) ||
      !sameReference(evidence, "uses-seal", seal) ||
      !sameReference(evidence, "governed-by", boundary) ||
      evidence.payload.readiness !== "acceptance-ready"
    ) {
      fail("evidence", "Acceptance selections do not prove the exact sealed Candidate as acceptance-ready");
    }
    const state = candidateState(candidate);
    const baseCommit = string(candidate.payload.candidateBaseCommit, "Terminal Candidate base commit");
    if (!GIT_OBJECT.test(baseCommit) || baseCommit !== subject.repository.canonicalCommit) {
      fail("candidate", "Accepted Candidate does not retain the exact admitted canonical parent");
    }
    const boundaryBasis = object(boundary.payload.basis, "Terminal Work Boundary basis");
    if (baseCommit !== string(
      boundaryBasis.productBaseCommit,
      "Terminal Work Boundary product base commit",
    )) {
      fail("candidate", "Accepted Candidate does not retain its exact admitted product base");
    }
    selectedCandidate = Object.freeze({
      reference: reference(candidate, "candidate-revision"),
      baseCommit,
      state,
      carrierManifest: candidateCarrierManifest(candidate),
    });
    selectedSeal = reference(seal, "candidate-seal");
    selectedEvidence = reference(evidence, "evidence-packet");
    commitTemplate = acceptanceCommitTemplate({
      subject,
      decision,
      candidate,
    });
  } else {
    noBinding(subject, "selects-seal");
    noBinding(subject, "selects-evidence");
    if (candidate !== null) {
      const baseCommit = string(candidate.payload.candidateBaseCommit, "Terminal Candidate base commit");
      if (!GIT_OBJECT.test(baseCommit)) fail("candidate", "No-ship Candidate base is not one Git commit");
      selectedCandidate = Object.freeze({
        reference: reference(candidate, "candidate-revision"),
        baseCommit,
        state: candidateState(candidate),
        carrierManifest: candidateCarrierManifest(candidate),
      });
    }
  }

  const candidateTreatment = decisionKind === "accept"
    ? "integrated" as const
    : selectedCandidate === null
      ? "not-created" as const
      : "abandoned" as const;
  const expectedDisposition = decisionKind === "accept"
    ? "not-applicable"
    : selectedCandidate === null ? "no-candidate" : "abandon";
  if (subject.candidateDisposition !== expectedDisposition) {
    fail("candidate", "Founder Decision Candidate disposition differs from exact terminal treatment");
  }

  const acceptanceCommit = selectedCandidate === null || commitTemplate === null
    ? null
    : instantiateAcceptanceCommit({
        template: commitTemplate,
        tree: selectedCandidate.state.tree,
        parent: subject.repository.canonicalCommit,
        objectFormat,
      });
  const plan: FoundationTerminalEffectPlanV7 = Object.freeze({
    schema: PLAN_SCHEMA,
    runtime: RUNTIME_COORDINATE,
    transactionRules: TRANSACTION_RULES,
    operation: subject.operation,
    decisionKind,
    targetId: store.identity.targetId,
    storeId: store.identity.storeId,
    processId: store.identity.processId,
    activityId: subject.activityId,
    decision: Object.freeze({
      ...reference(decision, "founder-decision"),
      subjectDigest: digest(decision.payload.subjectDigest, "Founder Decision subject digest"),
    }),
    boundary: boundary === null ? null : reference(boundary, "work-boundary"),
    candidate: selectedCandidate,
    seal: selectedSeal,
    evidence: selectedEvidence,
    candidateTreatment,
    repository: Object.freeze({ ...subject.repository }),
    canonical: Object.freeze({
      ref: contract.canonicalBranch,
      objectFormat,
      expectedCommit: acceptanceCommit?.commit ?? subject.repository.canonicalCommit,
      expectedTree: acceptanceCommit?.tree ?? subject.repository.canonicalTree,
    }),
    acceptanceCommitTemplate: commitTemplate,
  });
  return Object.freeze({ plan, effectDigest: digestCanonical(plan), decision });
}

/** Reproduce one terminal effect plan from its retained authenticated Decision. */
export async function compileFoundationTerminalEffectPlanV7(
  _target: string,
  store: ControlRecordStore,
  activityId: string,
  contract: FoundationRepositoryContract,
  objectFormat: FoundationGitObjectFormat,
): Promise<FoundationCompiledTerminalEffectPlanV7> {
  const verified = verifyRetainedFounderDecision({ store, activityId, contract });
  return planFromDecision(store, verified.revision, verified.subject, contract, objectFormat);
}

async function observeFoundationTerminalRepositoryV7(
  target: string,
  observedAt: string,
): Promise<FoundationTerminalRepositoryObservationV7> {
  const exactObservedAt = controlTimestamp(observedAt, "Terminal repository observation time");
  const epoch = await loadRepositoryEpoch(target);
  const knowledge = await validateKnowledgeSet(epoch);
  if (
    knowledge.knowledgeSet === null || !knowledge.validation.complete || !knowledge.validation.valid
  ) {
    fail("repository", "Terminal authority requires one complete valid Knowledge Set", {
      validationDigest: knowledge.validation.digest,
    });
  }
  const snapshot = await bindRepositorySnapshot(epoch, knowledge.knowledgeSet);
  const validation = await validateLoadedRepositorySnapshot(snapshot, {
    knowledge: knowledge.knowledgeSet,
    observedAt: exactObservedAt,
  });
  if (!validation.complete || !validation.valid) {
    fail("repository", "Terminal authority requires one complete valid repository snapshot", {
      validationDigest: validation.digest,
    });
  }
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
    ref: snapshot.epoch.ref,
    objectFormat: snapshot.epoch.objectFormat,
  });
}

function currentTerminalBoundary(
  store: ControlRecordStore,
): Readonly<{ id: string; revision: number; digest: Sha256 }> | null {
  const current = store.state().subjects.activeBoundary ?? store.state().subjects.proposedBoundary;
  if (current !== null) return current;
  const finalized = [...allEvents(store)].reverse().find(({ eventKind }) =>
    eventKind === "work-boundary-finalized");
  if (finalized?.subject === null || finalized?.subject === undefined) return null;
  return Object.freeze({
    id: finalized.subject.recordId,
    revision: finalized.subject.revision,
    digest: finalized.subject.digest,
  });
}

async function observeHistoricalTerminalRepositoryV7(
  target: string,
  store: ControlRecordStore,
  selected: Readonly<{ id: string; revision: number; digest: Sha256 }>,
  observedAt: string,
): Promise<FoundationTerminalRepositoryObservationV7> {
  const boundary = store.getRevision(selected.id, selected.revision);
  if (
    boundary === null || boundary.recordKind !== "work-boundary" ||
    boundary.digest !== selected.digest
  ) {
    fail("boundary", "Terminal historical Work Boundary does not resolve exactly");
  }
  const basis = object(boundary.payload.basis, "Acceptance Work Boundary basis");
  const commit = string(basis.productBaseCommit, "Acceptance Work Boundary product base commit");
  const tree = string(basis.productBaseTree, "Acceptance Work Boundary product base tree");
  if (!GIT_OBJECT.test(commit) || !GIT_OBJECT.test(tree)) {
    fail("boundary", "Acceptance Work Boundary basis has invalid Git object identities");
  }
  const epoch = await loadRepositoryEpochAtCommit(target, commit);
  const knowledge = await validateKnowledgeSet(epoch);
  if (
    knowledge.knowledgeSet === null || !knowledge.validation.complete || !knowledge.validation.valid
  ) {
    fail("repository", "Acceptance historical authority requires one complete valid Knowledge Set", {
      validationDigest: knowledge.validation.digest,
    });
  }
  const snapshot = await bindHistoricalRepositorySnapshot(epoch, knowledge.knowledgeSet);
  controlTimestamp(observedAt, "Acceptance historical repository observation time");
  const repositoryBasis = Object.freeze({
    repositorySnapshotDigest: digest(
      basis.repositorySnapshotDigest,
      "Acceptance Work Boundary repository Snapshot digest",
    ),
    canonicalCommit: commit,
    canonicalTree: tree,
    productStateDigest: digest(
      basis.productStateDigest,
      "Acceptance Work Boundary Product State digest",
    ),
    atlasStateDigest: digest(basis.atlasStateDigest, "Acceptance Work Boundary Atlas State digest"),
    atlasResolutionDigest: digest(
      basis.atlasResolutionDigest,
      "Acceptance Work Boundary Atlas Resolution digest",
    ),
    atlasNormalizedModelDigest: digest(
      basis.atlasNormalizedModelDigest,
      "Acceptance Work Boundary Atlas normalized-model digest",
    ),
    atlasResourceBindingsDigest: digest(
      basis.atlasResourceBindingsDigest,
      "Acceptance Work Boundary Atlas Resource bindings digest",
    ),
    repositoryContractDigest: digest(
      basis.repositoryContractDigest,
      "Acceptance Work Boundary repository contract digest",
    ),
    knowledgeSetDigest: digest(
      basis.knowledgeSetDigest,
      "Acceptance Work Boundary Knowledge Set digest",
    ),
    checkBindingSetDigest: digestCanonical(snapshot.contract.checkBindings),
  });
  const reproduced = Object.freeze({
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
  });
  if (
    boundary.payload.targetId !== store.identity.targetId ||
    snapshot.contract.targetId !== store.identity.targetId ||
    canonicalJson(reproduced) !== canonicalJson(repositoryBasis)
  ) {
    fail("repository", "Acceptance historical repository does not reproduce its admitted Work Boundary basis");
  }
  return Object.freeze({
    repository: snapshot.repository,
    contract: snapshot.contract,
    basis: repositoryBasis,
    ref: snapshot.epoch.ref,
    objectFormat: snapshot.epoch.objectFormat,
  });
}

async function observeEmptyReclamationHandoff(input: Readonly<{
  storeId: string;
  processId: string;
  subjects: readonly FoundationExecutionReclamationTerminalSubjectV1[];
  preIntentRefusals: readonly FoundationExecutionReclamationPreIntentRefusalV1[];
}>): Promise<FoundationExecutionReclamationTerminalVerificationV1> {
  if (input.subjects.length !== 0 || input.preIntentRefusals.length !== 0) {
    fail(
      "reclamation-handoff",
      "Terminal Closure requires the exact installation-private Reclamation ledger summary",
    );
  }
  return Object.freeze({
    terminalExecutionSetDigest:
      foundationExecutionReclamationTerminalSubjectSetDigestV1({
        storeId: input.storeId,
        processId: input.processId,
        subjects: input.subjects,
      }),
    executionCount: 0,
    preIntentRefusalSetDigest:
      foundationExecutionReclamationPreIntentRefusalSetDigestV1({
        storeId: input.storeId,
        processId: input.processId,
        preIntentRefusals: input.preIntentRefusals,
      }),
    preIntentRefusalCount: 0,
    obligationSetDigest: digestCanonical({
      schema: "lifecycle.execution-reclamation-obligation-set.private.v1",
      obligationDigests: Object.freeze([]),
    }),
    obligationCount: 0,
  });
}

function owners(options: FoundationTerminalV7Options): TerminalOwners {
  return Object.freeze({
    now: options.now ?? (() => new Date().toISOString()),
    withTargetLock: options.withTargetLock ?? withTargetOperationLock,
    observeRepository: options.observeRepository ?? observeFoundationTerminalRepositoryV7,
    importCandidateCarrier: options.importCandidateCarrier ??
      importCandidateRevisionCarrierIntoRepository,
    verifyCandidateCarriers: options.verifyCandidateCarriers ??
      verifyCandidateCarriersForStoreArchive,
    observeReclamationHandoff: options.observeReclamationHandoff ??
      observeEmptyReclamationHandoff,
    archiveStore: options.archiveStore ?? archiveDeliveryControlRecordStore,
    onStage: options.onStage ?? (() => undefined),
  });
}

function sampleTime(selected: TerminalOwners, label: string): string {
  return controlTimestamp(selected.now(), label);
}

function openingTimes(selected: TerminalOwners): TerminalOpeningTimes {
  return Object.freeze({
    startedAt: sampleTime(selected, "Terminal activity start time"),
    authorizedAt: sampleTime(selected, "Founder terminal authorization time"),
    verifiedAt: sampleTime(selected, "Founder terminal verification time"),
  });
}

function checkpointPayload(input: Readonly<{
  acceptance?: ClosureCanonicalResult | null;
  terminalDisposition?: TerminalDispositionFact | null;
}>): TerminalCheckpoint {
  return Object.freeze({
    schema: CHECKPOINT_SCHEMA,
    acceptance: input.acceptance ?? null,
    terminalDisposition: input.terminalDisposition ?? null,
  }) as TerminalCheckpoint;
}

function nextCheckpoint(input: Readonly<{
  current: TerminalCheckpoint;
  acceptance?: ClosureCanonicalResult | null;
  terminalDisposition?: TerminalDispositionFact | null;
}>): TerminalCheckpoint {
  return checkpointPayload({
    acceptance: input.acceptance === undefined ? input.current.acceptance : input.acceptance,
    terminalDisposition: input.terminalDisposition === undefined
      ? input.current.terminalDisposition
      : input.terminalDisposition,
  });
}

function parseCanonicalResult(value: ControlJsonValue | undefined): ClosureCanonicalResult | null {
  if (value === null) return null;
  const result = object(value, "Terminal canonical result");
  exactKeys(
    result,
    [
      "parentCommit",
      "parentTree",
      "commit",
      "tree",
      "candidateDigest",
      "productStateDigest",
      "knowledgeSetDigest",
    ],
    "Terminal canonical result",
  );
  const parentCommit = string(result.parentCommit, "Terminal canonical parent commit");
  const parentTree = string(result.parentTree, "Terminal canonical parent tree");
  const commit = string(result.commit, "Terminal canonical commit");
  const tree = string(result.tree, "Terminal canonical tree");
  if (
    !GIT_OBJECT.test(parentCommit) || !GIT_OBJECT.test(parentTree) ||
    !GIT_OBJECT.test(commit) || !GIT_OBJECT.test(tree)
  ) {
    fail("support", "Terminal canonical result requires full Git object identities");
  }
  return Object.freeze({
    parentCommit,
    parentTree,
    commit,
    tree,
    productStateDigest: digest(result.productStateDigest, "Terminal canonical Product State digest"),
    knowledgeSetDigest: digest(result.knowledgeSetDigest, "Terminal canonical Knowledge Set digest"),
    candidateDigest: digest(result.candidateDigest, "Terminal canonical Candidate digest"),
  });
}

function parseTerminalExecutions(
  value: ControlJsonValue | undefined,
): ClosureTerminalExecutions {
  const executions = object(value, "Terminal execution disposition");
  exactKeys(
    executions,
    ["terminalExecutionSetDigest", "executionCount", "containment", "retirement"],
    "Terminal execution disposition",
  );
  const containment = object(executions.containment, "Terminal execution Containment");
  const retirement = object(executions.retirement, "Terminal execution Retirement");
  exactKeys(containment, ["classification", "factsDigest"], "Terminal execution Containment");
  exactKeys(retirement, ["classification", "factsDigest"], "Terminal execution Retirement");
  if (containment.classification !== "complete" || retirement.classification !== "complete") {
    fail("support", "Terminal execution disposition is not completely contained and retired");
  }
  return Object.freeze({
    terminalExecutionSetDigest: digest(
      executions.terminalExecutionSetDigest,
      "Terminal execution-set digest",
    ),
    executionCount: integer(executions.executionCount, "Terminal execution count"),
    containment: Object.freeze({
      classification: "complete",
      factsDigest: digest(containment.factsDigest, "Terminal Containment facts digest"),
    }),
    retirement: Object.freeze({
      classification: "complete",
      factsDigest: digest(retirement.factsDigest, "Terminal Retirement facts digest"),
    }),
  });
}

function parseReclamationHandoff(
  value: ControlJsonValue | undefined,
): ClosureReclamationHandoff {
  const handoff = object(value, "Terminal Reclamation handoff");
  exactKeys(
    handoff,
    ["obligationSetDigest", "obligationCount"],
    "Terminal Reclamation handoff",
  );
  return Object.freeze({
    obligationSetDigest: digest(
      handoff.obligationSetDigest,
      "Terminal Reclamation obligation-set digest",
    ),
    obligationCount: integer(handoff.obligationCount, "Terminal Reclamation obligation count"),
  });
}

function parseTerminalDisposition(
  value: ControlJsonValue | undefined,
): TerminalDispositionFact | null {
  if (value === null) return null;
  const terminal = object(value, "Terminal disposition fact");
  exactKeys(
    terminal,
    ["terminalAt", "canonicalResult", "terminalExecutions", "reclamationHandoff"],
    "Terminal disposition fact",
  );
  const terminalExecutions = parseTerminalExecutions(terminal.terminalExecutions);
  const reclamationHandoff = parseReclamationHandoff(terminal.reclamationHandoff);
  if (reclamationHandoff.obligationCount < terminalExecutions.executionCount) {
    fail("support", "Terminal Reclamation handoff omits a terminal execution");
  }
  return Object.freeze({
    terminalAt: controlTimestamp(
      string(terminal.terminalAt, "Terminal disposition time"),
      "Terminal disposition time",
    ),
    canonicalResult: parseCanonicalResult(terminal.canonicalResult),
    terminalExecutions,
    reclamationHandoff,
  });
}

function validateRetainedPlan(
  value: ControlJsonObject,
): TerminalPlan {
  const plan = value as TerminalPlan;
  if (
    plan.schema !== PLAN_SCHEMA || plan.runtime !== RUNTIME_COORDINATE ||
    plan.transactionRules !== TRANSACTION_RULES ||
    !(plan.operation === "delivery.accept" || plan.operation === "delivery.no-ship") ||
    plan.decisionKind !== (plan.operation === "delivery.accept" ? "accept" : "no-ship") ||
    typeof plan.activityId !== "string" || typeof plan.targetId !== "string" ||
    typeof plan.storeId !== "string" || typeof plan.processId !== "string" ||
    !GIT_REF.test(plan.canonical?.ref ?? "") ||
    !(plan.canonical?.objectFormat === "sha1" || plan.canonical?.objectFormat === "sha256") ||
    !GIT_OBJECT.test(plan.repository?.canonicalCommit ?? "") ||
    !GIT_OBJECT.test(plan.repository?.canonicalTree ?? "") ||
    !GIT_OBJECT.test(plan.canonical?.expectedCommit ?? "") ||
    !GIT_OBJECT.test(plan.canonical?.expectedTree ?? "")
  ) {
    fail("support", "Terminal support carries an invalid effect plan envelope");
  }
  const acceptance = plan.decisionKind === "accept";
  const candidate = plan.candidate;
  if (candidate !== null) {
    const carrier = candidate.carrierManifest;
    if (
      carrier === undefined ||
      !GIT_OBJECT.test(candidate.baseCommit) ||
      !GIT_OBJECT.test(candidate.state?.tree ?? "") ||
      carrier.mediaType !== FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE ||
      carrier.purpose !== FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE ||
      !DIGEST.test(carrier.digest) ||
      !Number.isSafeInteger(carrier.byteLength) || carrier.byteLength <= 0
    ) {
      fail("support", "Terminal support carries an invalid exact Candidate Carrier plan");
    }
  }
  const expectedTreatment = acceptance
    ? "integrated"
    : candidate === null ? "not-created" : "abandoned";
  if (
    plan.candidateTreatment !== expectedTreatment ||
    (plan.acceptanceCommitTemplate === null) !== !acceptance ||
    (acceptance && (
      candidate === null ||
      plan.canonical.expectedTree !== candidate.state.tree ||
      plan.repository.canonicalCommit !== candidate.baseCommit
    )) ||
    (!acceptance && (
      plan.canonical.expectedCommit !== plan.repository.canonicalCommit ||
      plan.canonical.expectedTree !== plan.repository.canonicalTree
    ))
  ) {
    fail("support", "Terminal support carries an invalid exact acceptance transaction plan");
  }
  return plan;
}

function parseTerminalCheckpoint(payload: ControlJsonObject): TerminalCheckpoint {
  exactKeys(payload, ["schema", "acceptance", "terminalDisposition"], "Terminal checkpoint");
  if (payload.schema !== CHECKPOINT_SCHEMA) {
    fail("support", "Terminal checkpoint has an unsupported schema");
  }
  return Object.freeze({
    schema: CHECKPOINT_SCHEMA,
    acceptance: parseCanonicalResult(payload.acceptance),
    terminalDisposition: parseTerminalDisposition(payload.terminalDisposition),
  }) as TerminalCheckpoint;
}

function terminalDefinition(
  operation: TerminalOperation,
): FoundationActivityKernelTerminalDefinitionV7<TerminalPlan, TerminalCheckpoint> {
  return operation === "delivery.accept"
    ? FOUNDATION_TERMINAL_ACTIVITY_DEFINITIONS_V7.accept
    : FOUNDATION_TERMINAL_ACTIVITY_DEFINITIONS_V7.noShip;
}

const FOUNDATION_TERMINAL_ACTIVITY_DEFINITIONS_V7 = Object.freeze({
  accept: Object.freeze({
    id: "foundation.terminal.accept.activity.v1",
    digest: digestCanonical(Object.freeze({
      schema: "lifecycle.activity-definition.v1",
      id: "foundation.terminal.accept.activity.v1",
      operation: "delivery.accept",
      planSchema: PLAN_SCHEMA,
      checkpointSchema: CHECKPOINT_SCHEMA,
      implementationDigest: FOUNDATION_TERMINAL_TRANSACTION_V7.implementationDigest,
      ruleSetDigest: FOUNDATION_TERMINAL_TRANSACTION_V7.ruleSetDigest,
    })),
    operation: "delivery.accept" as const,
    terminal: true as const,
    parsePlan: validateRetainedPlan,
    parseCheckpoint: parseTerminalCheckpoint,
  }),
  noShip: Object.freeze({
    id: "foundation.terminal.no-ship.activity.v1",
    digest: digestCanonical(Object.freeze({
      schema: "lifecycle.activity-definition.v1",
      id: "foundation.terminal.no-ship.activity.v1",
      operation: "delivery.no-ship",
      planSchema: PLAN_SCHEMA,
      checkpointSchema: CHECKPOINT_SCHEMA,
      implementationDigest: FOUNDATION_TERMINAL_TRANSACTION_V7.implementationDigest,
      ruleSetDigest: FOUNDATION_TERMINAL_TRANSACTION_V7.ruleSetDigest,
    })),
    operation: "delivery.no-ship" as const,
    terminal: true as const,
    parsePlan: validateRetainedPlan,
    parseCheckpoint: parseTerminalCheckpoint,
  }),
});

function terminalCheckpoint(context: TerminalKernelContext): TerminalCheckpoint {
  const checkpoint = context.envelope.checkpoint?.value ?? null;
  if (checkpoint === null) fail("support", "Terminal activity requires one exact checkpoint");
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
    if (events.length > 100_000) fail("journal", "Terminal Journal lookup exceeds its fixed bound");
  }
}

function assertContextMatchesDecision(input: Readonly<{
  store: ControlRecordStore;
  context: TerminalKernelContext;
  compiled: FoundationCompiledTerminalEffectPlanV7;
}>): void {
  const checkpoint = terminalCheckpoint(input.context);
  if (
    input.context.activity.id !== input.compiled.plan.activityId ||
    input.context.envelope.plan.digest !== input.compiled.effectDigest ||
    canonicalJson(input.context.envelope.plan.value) !== canonicalJson(input.compiled.plan) ||
    input.context.envelope.plan.value.targetId !== input.store.identity.targetId ||
    input.context.envelope.plan.value.storeId !== input.store.identity.storeId ||
    input.context.envelope.plan.value.processId !== input.store.identity.processId
  ) {
    fail("support-substitution", "Terminal support differs from the reverified retained Decision plan");
  }
  if (
    (checkpoint.acceptance !== null || checkpoint.terminalDisposition !== null) &&
    input.context.recovery.resumesAt !== "transaction-finalization"
  ) {
    fail("support-stage", "Terminal checkpoint facts differ from reducer-derived recovery");
  }
  if (
    (checkpoint.acceptance !== null) !==
      (input.compiled.plan.operation === "delivery.accept" &&
        input.context.recovery.resumesAt === "transaction-finalization") ||
    (checkpoint.terminalDisposition?.canonicalResult ?? null) !== null &&
      canonicalJson(checkpoint.terminalDisposition?.canonicalResult) !==
        canonicalJson(checkpoint.acceptance)
  ) {
    fail("support-stage", "Terminal checkpoint acceptance differs from its terminal disposition");
  }
}

function assertAppliedAcceptanceCheckpoint(input: Readonly<{
  store: ControlRecordStore;
  compiled: FoundationCompiledTerminalEffectPlanV7;
  acceptance: ClosureCanonicalResult | null;
}>): void {
  if (input.compiled.plan.operation !== "delivery.accept") return;
  if (input.acceptance === null) {
    fail("support-stage", "Applied acceptance lacks its exact retained canonical result");
  }
  const observation = allEvents(input.store).filter((event) =>
    event.eventKind === "transaction-effect-observed" &&
    event.payload.activityId === input.compiled.plan.activityId).at(-1);
  const facts = observation === undefined
    ? null
    : object(observation.payload.facts, "Applied acceptance observation facts");
  if (
    observation === undefined || observation.payload.outcome !== "applied" ||
    observation.payload.effectDigest !== input.compiled.effectDigest || facts === null ||
    facts.schema !== FOUNDATION_TERMINAL_ACCEPTANCE_OBSERVATION_FACTS_V1 ||
    facts.ref !== input.compiled.plan.canonical.ref ||
    facts.objectFormat !== input.compiled.plan.canonical.objectFormat ||
    facts.commit !== input.acceptance.commit || facts.tree !== input.acceptance.tree ||
    facts.canonicalResultDigest !== digestCanonical(input.acceptance)
  ) {
    fail(
      "support-substitution",
      "Applied acceptance checkpoint does not reproduce its exact Journal observation",
    );
  }
}

type RepositoryEffectObservation = Readonly<{
  outcome: "applied" | "not-applied" | "indeterminate";
  facts: FoundationTransactionObservationFactsV7;
  acceptance: ClosureCanonicalResult | null;
}>;

function repositoryFacts(input: Readonly<{
  ref: string;
  commit: string;
  tree: string;
  objectFormat: FoundationGitObjectFormat;
}>): FoundationTerminalRepositoryObservationFactsV1 {
  return Object.freeze({
    schema: FOUNDATION_TERMINAL_REPOSITORY_OBSERVATION_FACTS_V1,
    ref: input.ref,
    commit: input.commit,
    tree: input.tree,
    objectFormat: input.objectFormat,
  }) as FoundationTerminalRepositoryObservationFactsV1;
}

function acceptanceFacts(
  input: Readonly<{
    ref: string;
    commit: string;
    tree: string;
    objectFormat: FoundationGitObjectFormat;
  }>,
  result: ClosureCanonicalResult,
): FoundationTerminalAcceptanceObservationFactsV1 {
  return Object.freeze({
    schema: FOUNDATION_TERMINAL_ACCEPTANCE_OBSERVATION_FACTS_V1,
    ref: input.ref,
    commit: input.commit,
    tree: input.tree,
    objectFormat: input.objectFormat,
    canonicalResultDigest: digestCanonical(result),
  }) as FoundationTerminalAcceptanceObservationFactsV1;
}

function terminalFailureFacts(
  stage: FoundationTerminalFailureObservationFactsV1["stage"],
  code: string,
): FoundationTerminalFailureObservationFactsV1 {
  return Object.freeze({
    schema: FOUNDATION_TERMINAL_FAILURE_OBSERVATION_FACTS_V1,
    stage,
    code,
  }) as FoundationTerminalFailureObservationFactsV1;
}

async function currentRepositoryEffectFacts(
  target: string,
): Promise<Readonly<{
  repository: string;
  ref: string;
  commit: string;
  tree: string;
  objectFormat: FoundationGitObjectFormat;
}>> {
  const repository = await canonicalRepository(target);
  const epoch = await resolveAttachedEpoch(repository);
  return Object.freeze({ repository, ...epoch });
}

async function plannedCanonicalRefFacts(
  repository: string,
  plan: FoundationTerminalEffectPlanV7,
): Promise<Readonly<{ commit: string; tree: string }>> {
  const commit = (await git(repository, [
    "rev-parse", "--verify", "--end-of-options", `${plan.canonical.ref}^{commit}`,
  ])).stdout.trim();
  const tree = (await git(repository, [
    "rev-parse", "--verify", "--end-of-options", `${commit}^{tree}`,
  ])).stdout.trim();
  const length = plan.canonical.objectFormat === "sha1" ? 40 : 64;
  if (commit.length !== length || tree.length !== length ||
      !GIT_OBJECT.test(commit) || !GIT_OBJECT.test(tree)) {
    fail("repository-effect", "Canonical transaction ref has invalid Git object identities");
  }
  return Object.freeze({ commit, tree });
}

function matchesAcceptedResult(
  observed: Readonly<{ ref: string; commit: string; tree: string; objectFormat: FoundationGitObjectFormat }>,
  plan: FoundationTerminalEffectPlanV7,
  result: ClosureCanonicalResult,
): boolean {
  return observed.ref === plan.canonical.ref &&
    observed.commit === result.commit &&
    observed.tree === result.tree &&
    observed.objectFormat === plan.canonical.objectFormat;
}

async function synchronizeAcceptedWorktree(
  repository: string,
  plan: FoundationTerminalEffectPlanV7,
  result: ClosureCanonicalResult,
): Promise<void> {
  const attached = await resolveAttachedEpoch(repository);
  if (!matchesAcceptedResult(attached, plan, result)) {
    fail("repository-effect", "Accepted canonical ref is not the exact attached target epoch");
  }
  const indexTree = (await git(repository, ["write-tree"], { timeoutMs: 120_000 })).stdout.trim();
  if (!GIT_OBJECT.test(indexTree)) {
    fail("repository-effect", "Canonical target index does not resolve to one exact tree");
  }
  const unstaged = await git(repository, ["diff", "--quiet", "--"], {
    allowFailure: true,
    timeoutMs: 120_000,
  });
  if (unstaged.exitCode !== 0) {
    fail("repository-effect", "Canonical target worktree changed during acceptance");
  }
  if (indexTree === result.parentTree) {
    const [parentEntries, acceptedEntries, inventory] = await Promise.all([
      exactTreeEntries(repository, result.parentTree, plan.canonical.objectFormat),
      exactTreeEntries(repository, result.tree, plan.canonical.objectFormat),
      worktreePathInventory(repository),
    ]);
    const parent = new Map(parentEntries.map((entry) => [entry.path, entry]));
    const changedAcceptedPaths = acceptedEntries.filter((entry) => {
      const prior = parent.get(entry.path);
      return prior === undefined || prior.mode !== entry.mode || prior.type !== entry.type ||
        prior.objectId !== entry.objectId;
    }).map(({ path }) => path);
    const collision = [...inventory.untracked, ...inventory.ignored].some((path) =>
      changedAcceptedPaths.some((acceptedPath) =>
        path === acceptedPath || path.startsWith(`${acceptedPath}/`) ||
        acceptedPath.startsWith(`${path}/`)));
    if (collision) {
      fail("repository-effect", "Acceptance would overwrite noncanonical worktree material");
    }
    await git(repository, [
      "read-tree", "-u", "-m",
      result.parentCommit,
      result.commit,
    ], { timeoutMs: 120_000 });
  } else if (indexTree !== result.tree) {
    fail("repository-effect", "Canonical target index differs from both retained transaction trees");
  }
  const [worktree, index] = await Promise.all([
    git(repository, ["diff", "--quiet", result.commit, "--"], {
      allowFailure: true,
      timeoutMs: 120_000,
    }),
    git(repository, ["diff", "--cached", "--quiet", result.commit, "--"], {
      allowFailure: true,
      timeoutMs: 120_000,
    }),
  ]);
  if (worktree.exitCode !== 0 || index.exitCode !== 0) {
    fail("repository-effect", "Accepted canonical ref does not have its exact tracked checkout");
  }
}

async function synchronizeRetainedAcceptanceIfCurrent(
  repository: string,
  plan: FoundationTerminalEffectPlanV7,
  result: ClosureCanonicalResult,
): Promise<void> {
  const attached = await resolveAttachedEpoch(repository);
  if (matchesAcceptedResult(attached, plan, result)) {
    await synchronizeAcceptedWorktree(repository, plan, result);
  }
}

async function assertAcceptanceCheckoutBasis(
  repository: string,
  tree: string,
): Promise<void> {
  const [indexTree, unstaged, worktree] = await Promise.all([
    git(repository, ["write-tree"], { timeoutMs: 120_000 }),
    git(repository, ["diff", "--quiet", "--"], {
      allowFailure: true,
      timeoutMs: 120_000,
    }),
    worktreePathInventory(repository),
  ]);
  if (
    indexTree.stdout.trim() !== tree || unstaged.exitCode !== 0 ||
    worktree.modified.length > 0 || worktree.untracked.length > 0 || worktree.ignored.length > 0
  ) {
    fail("repository-effect", "Acceptance canonical checkout no longer equals its observed effect parent");
  }
}

async function importAcceptanceCandidate(input: Readonly<{
  repository: string;
  machineHome: string;
  store: ControlRecordStore;
  compiled: FoundationCompiledTerminalEffectPlanV7;
  selected: TerminalOwners;
}>): Promise<void> {
  const candidate = input.compiled.plan.candidate;
  if (candidate === null) {
    fail("candidate", "Acceptance effect omits its exact Candidate state");
  }
  const retained = await input.store.readRetainedFile(candidate.carrierManifest.digest);
  if (
    retained === null ||
    retained.descriptor.digest !== candidate.carrierManifest.digest ||
    retained.descriptor.byteLength !== candidate.carrierManifest.byteLength ||
    retained.descriptor.mediaType !== candidate.carrierManifest.mediaType ||
    retained.descriptor.purpose !== candidate.carrierManifest.purpose
  ) {
    fail("candidate", "Acceptance Candidate Carrier manifest is unavailable or substituted");
  }
  const imported = await input.selected.importCandidateCarrier({
    machineHome: input.machineHome,
    manifestBytes: retained.bytes,
    repository: input.repository,
    expectedRootTree: candidate.state.tree,
  });
  if (imported.rootTree !== candidate.state.tree) {
    fail("candidate-mismatch", "Acceptance imported another Candidate Carrier root tree");
  }
}

function exactAcceptanceResult(
  plan: FoundationTerminalEffectPlanV7,
): ClosureCanonicalResult {
  const candidate = plan.candidate;
  const template = plan.acceptanceCommitTemplate;
  if (candidate === null || template === null) {
    fail("candidate", "Acceptance effect lacks its exact Candidate state and commit template");
  }
  if (
    candidate.baseCommit !== plan.repository.canonicalCommit ||
    candidate.state.tree !== plan.canonical.expectedTree
  ) {
    fail("candidate", "Acceptance plan does not bind the exact admitted parent and Candidate tree");
  }
  const commit = instantiateAcceptanceCommit({
    template,
    tree: candidate.state.tree,
    parent: plan.repository.canonicalCommit,
    objectFormat: plan.canonical.objectFormat,
  });
  if (
    commit.commit !== plan.canonical.expectedCommit ||
    commit.tree !== plan.canonical.expectedTree
  ) {
    fail("commit", "Acceptance plan does not reproduce its exact deterministic commit");
  }
  return Object.freeze({
    parentCommit: plan.repository.canonicalCommit,
    parentTree: plan.repository.canonicalTree,
    commit: commit.commit,
    tree: commit.tree,
    candidateDigest: candidate.state.candidateDigest,
    productStateDigest: candidate.state.productStateDigest,
    knowledgeSetDigest: candidate.state.knowledgeSetDigest,
  });
}

async function acceptedCommitParent(input: Readonly<{
  repository: string;
  observed: Readonly<{ commit: string; tree: string }>;
  template: AcceptanceCommitTemplate;
}>): Promise<string | null> {
  const raw = (await git(input.repository, [
    "cat-file", "-p", input.observed.commit,
  ], { maxStdoutBytes: 1024 * 1024 })).stdout;
  const separator = raw.indexOf("\n\n");
  if (separator < 0 || raw.slice(separator + 2) !== input.template.message) return null;
  const headers = raw.slice(0, separator).split("\n");
  const author = `Lifecycle Foundation Runtime <lifecycle@invalid> ${input.template.authoredAtUnix} +0000`;
  if (
    headers.length !== 4 || headers[0] !== `tree ${input.observed.tree}` ||
    !headers[1]?.startsWith("parent ") || headers[2] !== `author ${author}` ||
    headers[3] !== `committer ${author}`
  ) return null;
  const parent = headers[1].slice("parent ".length);
  return GIT_OBJECT.test(parent) ? parent : null;
}

async function recognizeAcceptedAtHead(input: Readonly<{
  observed: Readonly<{
    repository: string;
    ref: string;
    commit: string;
    tree: string;
    objectFormat: FoundationGitObjectFormat;
  }>;
  compiled: FoundationCompiledTerminalEffectPlanV7;
}>): Promise<ClosureCanonicalResult | null> {
  const template = input.compiled.plan.acceptanceCommitTemplate;
  if (template === null) return null;
  const result = exactAcceptanceResult(input.compiled.plan);
  if (
    input.observed.ref !== input.compiled.plan.canonical.ref ||
    input.observed.objectFormat !== input.compiled.plan.canonical.objectFormat ||
    input.observed.commit !== result.commit ||
    input.observed.tree !== result.tree
  ) return null;
  const parentCommit = await acceptedCommitParent({
    repository: input.observed.repository,
    observed: input.observed,
    template,
  });
  return parentCommit === result.parentCommit ? result : null;
}

async function writeAcceptedCommit(
  repository: string,
  plan: FoundationTerminalEffectPlanV7,
  result: ClosureCanonicalResult,
): Promise<void> {
  const template = plan.acceptanceCommitTemplate;
  if (template === null) fail("commit", "Acceptance effect has no deterministic commit template");
  const commit = instantiateAcceptanceCommit({
    template,
    tree: result.tree,
    parent: result.parentCommit,
    objectFormat: plan.canonical.objectFormat,
  });
  const bytes = acceptedCommitBytes({
    tree: commit.tree,
    parent: commit.parent,
    authoredAtUnix: commit.authoredAtUnix,
    message: commit.message,
  });
  if (gitObjectDigest(bytes, plan.canonical.objectFormat) !== commit.commit) {
    fail("commit", "Retained acceptance commit plan does not reproduce its object identity");
  }
  const tree = await git(repository, [
    "rev-parse", "--verify", "--end-of-options", `${commit.tree}^{tree}`,
  ], { allowFailure: true });
  if (tree.exitCode !== 0 || tree.stdout.trim() !== commit.tree) {
    fail("candidate", "Accepted Candidate tree is unavailable from the shared object database");
  }
  const retained = await git(repository, ["hash-object", "-w", "-t", "commit", "--stdin"], {
    input: bytes.toString("utf8"),
  });
  if (retained.stdout.trim() !== commit.commit) {
    fail("commit", "Git retained a different acceptance commit identity");
  }
}

async function observeAcceptanceEffect(input: Readonly<{
  target: string;
  machineHome: string;
  store: ControlRecordStore;
  compiled: FoundationCompiledTerminalEffectPlanV7;
  selected: TerminalOwners;
}>): Promise<RepositoryEffectObservation> {
  let observed;
  try {
    observed = await currentRepositoryEffectFacts(input.target);
  } catch (error) {
    return Object.freeze({
      outcome: "indeterminate",
      facts: terminalFailureFacts(
        "repository-observation",
        error instanceof FoundationError ? error.code : "observation-unavailable",
      ),
      acceptance: null,
    });
  }
  if (observed.ref !== input.compiled.plan.canonical.ref) {
    try {
      const canonical = await plannedCanonicalRefFacts(observed.repository, input.compiled.plan);
      return Object.freeze({
        outcome: "not-applied",
        facts: Object.freeze({
          schema: FOUNDATION_TERMINAL_DETACHED_OBSERVATION_FACTS_V1,
          attached: Object.freeze({
            ref: observed.ref,
            commit: observed.commit,
            tree: observed.tree,
            objectFormat: observed.objectFormat,
          }),
          canonicalRef: input.compiled.plan.canonical.ref,
          canonicalCommit: canonical.commit,
          canonicalTree: canonical.tree,
        }) as FoundationTerminalDetachedObservationFactsV1,
        acceptance: null,
      });
    } catch {
      return Object.freeze({ outcome: "indeterminate", facts: repositoryFacts(observed), acceptance: null });
    }
  }
  await contractForRetainedPlan(input.target, input.compiled.plan);
  try {
    const recognized = await recognizeAcceptedAtHead({
      observed,
      compiled: input.compiled,
    });
    if (recognized !== null) {
      await synchronizeAcceptedWorktree(observed.repository, input.compiled.plan, recognized);
      return Object.freeze({
        outcome: "applied",
        facts: acceptanceFacts(observed, recognized),
        acceptance: recognized,
      });
    }
    if (
      observed.objectFormat !== input.compiled.plan.canonical.objectFormat ||
      observed.commit !== input.compiled.plan.repository.canonicalCommit ||
      observed.tree !== input.compiled.plan.repository.canonicalTree
    ) {
      return Object.freeze({
        outcome: "not-applied",
        facts: repositoryFacts(observed),
        acceptance: null,
      });
    }
    await assertAcceptanceCheckoutBasis(
      observed.repository,
      input.compiled.plan.repository.canonicalTree,
    );
    await importAcceptanceCandidate({
      repository: observed.repository,
      machineHome: input.machineHome,
      store: input.store,
      compiled: input.compiled,
      selected: input.selected,
    });
    const proposed = exactAcceptanceResult(input.compiled.plan);
    await writeAcceptedCommit(observed.repository, input.compiled.plan, proposed);
    await git(observed.repository, [
      "update-ref",
      "--no-deref",
      input.compiled.plan.canonical.ref,
      proposed.commit,
      input.compiled.plan.repository.canonicalCommit,
    ]);
    await synchronizeAcceptedWorktree(observed.repository, input.compiled.plan, proposed);
    const applied = Object.freeze({
      ...observed,
      commit: proposed.commit,
      tree: proposed.tree,
    });
    return Object.freeze({
      outcome: "applied",
      facts: acceptanceFacts(applied, proposed),
      acceptance: proposed,
    });
  } catch (error) {
    let after;
    try {
      after = await currentRepositoryEffectFacts(input.target);
    } catch {
      return Object.freeze({
        outcome: "indeterminate",
        facts: terminalFailureFacts(
          "acceptance-effect",
          error instanceof FoundationError ? error.code : "effect-unavailable",
        ),
        acceptance: null,
      });
    }
    try {
      const recognized = await recognizeAcceptedAtHead({
        observed: after,
        compiled: input.compiled,
      });
      if (recognized !== null) {
        try {
          await synchronizeAcceptedWorktree(after.repository, input.compiled.plan, recognized);
        } catch (synchronizationError) {
          return Object.freeze({
            outcome: "indeterminate",
            facts: terminalFailureFacts(
              "accepted-checkout",
              synchronizationError instanceof FoundationError
                ? synchronizationError.code
                : "checkout-unavailable",
            ),
            acceptance: null,
          });
        }
        return Object.freeze({
          outcome: "applied",
          facts: acceptanceFacts(Object.freeze({
            ...after,
            commit: recognized.commit,
            tree: recognized.tree,
          }), recognized),
          acceptance: recognized,
        });
      }
      return Object.freeze({ outcome: "not-applied", facts: repositoryFacts(after), acceptance: null });
    } catch {
      return Object.freeze({ outcome: "not-applied", facts: repositoryFacts(after), acceptance: null });
    }
  }
}

async function observeNoShipEffect(input: Readonly<{
  compiled: FoundationCompiledTerminalEffectPlanV7;
}>): Promise<RepositoryEffectObservation> {
  return Object.freeze({
    outcome: "applied",
    facts: repositoryFacts({
      ref: input.compiled.plan.canonical.ref,
      commit: input.compiled.plan.repository.canonicalCommit,
      tree: input.compiled.plan.repository.canonicalTree,
      objectFormat: input.compiled.plan.canonical.objectFormat,
    }),
    acceptance: null,
  });
}

async function observeEffect(input: Readonly<{
  target: string;
  machineHome: string;
  store: ControlRecordStore;
  compiled: FoundationCompiledTerminalEffectPlanV7;
  selected: TerminalOwners;
}>): Promise<RepositoryEffectObservation> {
  return input.compiled.plan.operation === "delivery.accept"
    ? observeAcceptanceEffect(input)
    : observeNoShipEffect(input);
}

async function failTerminalActivity(input: Readonly<{
  store: ControlRecordStore;
  context: TerminalKernelContext;
  runtimeId: string;
  selected: TerminalOwners;
}>): Promise<void> {
  finishFoundationActivityKernelV7({
    store: input.store,
    activityId: input.context.activity.id,
    definition: terminalDefinition(input.context.activity.operation as TerminalOperation),
    outcome: "failed",
    runtimeId: input.runtimeId,
    sampleCompletedAt: () => sampleTime(
      input.selected,
      "Failed terminal activity completion time",
    ),
  });
  await input.selected.onStage("activity-completed");
}

type TerminalExecutionSubject = Readonly<{
  kind: "execution-receipt" | "check-receipt";
  id: string;
  revision: number;
  digest: Sha256;
  owner: Readonly<{
    activityId: string;
    kind: "agent-attempt" | "check";
    subjectDigest: Sha256;
  }>;
  containmentFactsDigest: Sha256;
  retirementFactsDigest: Sha256;
}>;

function terminalExecutionOwner(
  store: ControlRecordStore,
  revision: ControlRecordRevision,
): TerminalExecutionSubject["owner"] {
  const expectedEvent = revision.recordKind === "execution-receipt"
    ? "execution-receipt-recorded"
    : "check-receipt-recorded";
  const events = allEvents(store).filter((event) =>
    event.eventKind === expectedEvent &&
    event.subject?.recordId === revision.recordId &&
    event.subject.revision === revision.revision &&
    event.subject.digest === revision.digest
  );
  if (events.length !== 1) {
    fail("terminal-executions", "Terminal Receipt lacks one exact finalization event");
  }
  const activityId = string(
    events[0]!.payload.activityId,
    "Terminal execution Activity identity",
  );
  if (revision.recordKind === "execution-receipt") {
    if (revision.payload.activityId !== activityId) {
      fail("terminal-executions", "Execution Receipt and finalization event Activity identities differ");
    }
    const attempts = revision.relationships.filter(({ relation }) =>
      relation === "observes-attempt");
    if (attempts.length !== 1 || attempts[0]!.target.kind !== "agent-attempt") {
      fail("terminal-executions", "Execution Receipt lacks one exact Agent Attempt owner");
    }
    return Object.freeze({
      activityId,
      kind: "agent-attempt",
      subjectDigest: attempts[0]!.target.digest,
    });
  }
  const proofSubjects = revision.relationships.filter(({ relation }) =>
    relation === "checks-boundary" || relation === "checks-seal");
  if (
    proofSubjects.length !== 1 ||
    !(
      proofSubjects[0]!.target.kind === "work-boundary" ||
      proofSubjects[0]!.target.kind === "candidate-seal"
    )
  ) {
    fail("terminal-executions", "Check Receipt lacks one exact proof-subject owner");
  }
  return Object.freeze({
    activityId,
    kind: "check",
    subjectDigest: proofSubjects[0]!.target.digest,
  });
}

function terminalExecutionSubjects(store: ControlRecordStore): readonly TerminalExecutionSubject[] {
  const revisions: ControlRecordRevision[] = [];
  let afterRecordId: string | null = null;
  for (;;) {
    const page = store.listCurrentRevisions({
      recordKinds: Object.freeze(["execution-receipt", "check-receipt"]),
      afterRecordId,
      limit: 1_000,
    });
    revisions.push(...page);
    if (page.length < 1_000) break;
    afterRecordId = page.at(-1)!.recordId;
    if (revisions.length > 10_000) {
      fail("terminal-executions", "Terminal execution subject set exceeds its Control bound");
    }
  }
  const subjects: TerminalExecutionSubject[] = [];
  for (const revision of revisions) {
    const containment = object(
      revision.payload.containment,
      `${revision.recordKind} Execution Containment`,
    );
    const retirement = object(
      revision.payload.retirement,
      `${revision.recordKind} Execution Retirement`,
    );
    if (revision.recordKind === "check-receipt") {
      const execution = object(revision.payload.execution, "Check Receipt execution");
      if (execution.allocation === "not-allocated") {
        if (
          containment.classification !== "not-required" || containment.factsDigest !== null ||
          retirement.classification !== "not-required" || retirement.factsDigest !== null
        ) {
          fail("terminal-executions", "Unallocated Check claims a terminal Cell disposition");
        }
        continue;
      }
      if (execution.allocation !== "allocated") {
        fail("terminal-executions", "Check Receipt has an unsupported allocation disposition");
      }
    }
    if (
      containment.classification !== "contained" ||
      retirement.classification !== "retired"
    ) {
      fail(
        "terminal-executions",
        `${revision.recordKind} is not completely contained and Runtime-retired`,
      );
    }
    subjects.push(Object.freeze({
      kind: revision.recordKind as "execution-receipt" | "check-receipt",
      id: revision.recordId,
      revision: revision.revision,
      digest: revision.digest,
      owner: terminalExecutionOwner(store, revision),
      containmentFactsDigest: digest(
        containment.factsDigest,
        `${revision.recordKind} Containment facts digest`,
      ),
      retirementFactsDigest: digest(
        retirement.factsDigest,
        `${revision.recordKind} Retirement facts digest`,
      ),
    }));
  }
  subjects.sort((left, right) => compareCodePoints(
    `${left.kind}\u0000${left.id}\u0000${left.revision}\u0000${left.digest}`,
    `${right.kind}\u0000${right.id}\u0000${right.revision}\u0000${right.digest}`,
  ));
  return Object.freeze(subjects);
}

function terminalPreIntentRefusals(
  store: ControlRecordStore,
): readonly FoundationExecutionReclamationPreIntentRefusalV1[] {
  const events = allEvents(store);
  const state = store.state();
  const activityById = new Map<string, (typeof state.activities)[number]>();
  for (const activity of state.activities) {
    if (activityById.has(activity.id)) {
      fail("terminal-executions", "Reduced state repeats one Agent Activity");
    }
    activityById.set(activity.id, activity);
  }
  const eventsByActivity = new Map<string, ControlRecordEvent[]>();
  const refusals: ControlRecordEvent[] = [];
  for (const event of events) {
    const activityId = event.payload.activityId;
    if (typeof activityId === "string") {
      const activityEvents = eventsByActivity.get(activityId) ?? [];
      activityEvents.push(event);
      eventsByActivity.set(activityId, activityEvents);
    }
    if (event.eventKind === "agent-pre-intent-refused") refusals.push(event);
  }
  if (refusals.length > 10_000) {
    fail("terminal-executions", "Pre-intent refusal selector set exceeds its Control bound");
  }
  const activityIds = new Set<string>();
  const selectors = refusals.map((event) => {
    if (event.subject !== null) {
      fail("terminal-executions", "Pre-intent refusal unexpectedly names a Control subject");
    }
    exactKeys(
      event.payload,
      ["activityId", "diagnosticCode", "refusalFactsDigest"],
      "Pre-intent refusal event payload",
    );
    const activityId = controlIdentifier(
      string(event.payload.activityId, "Pre-intent refusal Activity identity"),
      "Pre-intent refusal Activity identity",
    );
    controlIdentifier(
      string(event.payload.diagnosticCode, "Pre-intent refusal diagnostic code"),
      "Pre-intent refusal diagnostic code",
    );
    digest(event.payload.refusalFactsDigest, "Pre-intent refusal facts digest");
    if (activityIds.has(activityId)) {
      fail("terminal-executions", "Pre-intent refusal repeats one Agent Activity");
    }
    activityIds.add(activityId);
    const activity = activityById.get(activityId);
    const activityEvents = eventsByActivity.get(activityId) ?? [];
    const completions = activityEvents.filter(({ eventKind }) =>
      eventKind === "activity-completed"
    );
    if (
      activity === undefined || activity.family !== "agent" ||
      activity.stage !== "completed" || completions.length !== 1 ||
      completions[0]!.sequence <= event.sequence || completions[0]!.subject !== null
    ) {
      fail(
        "terminal-executions",
        "Pre-intent refusal does not resolve one completed Agent Activity",
      );
    }
    exactKeys(
      completions[0]!.payload,
      ["activityId", "outcome"],
      "Pre-intent refusal Activity completion payload",
    );
    if (completions[0]!.payload.outcome !== "abandoned") {
      fail("terminal-executions", "Pre-intent refusal Activity was not abandoned");
    }
    const forbidden = new Set([
      "agent-attempt-prepared",
      "provider-effect-intended",
      "provider-effect-observed",
      "agent-work-product-submitted",
      "agent-work-product-abandoned",
      "execution-receipt-recorded",
    ]);
    if (activityEvents.some(({ eventKind }) => forbidden.has(eventKind))) {
      fail(
        "terminal-executions",
        "Pre-intent refusal Activity retained an Attempt, provider effect, Work Product, or Receipt",
      );
    }
    return Object.freeze({
      event: Object.freeze({
        sequence: event.sequence,
        eventId: event.eventId,
        digest: event.digest,
      }),
      activityId,
    });
  });
  selectors.sort((left, right) => compareCodePoints(canonicalJson(left), canonicalJson(right)));
  return Object.freeze(selectors);
}

function compileTerminalExecutions(
  subjects: readonly TerminalExecutionSubject[],
  terminalExecutionSetDigest: Sha256,
): ClosureTerminalExecutions {
  const containment = subjects.map((subject) => Object.freeze({
    subject: Object.freeze({
      kind: subject.kind,
      id: subject.id,
      revision: subject.revision,
      digest: subject.digest,
    }),
    factsDigest: subject.containmentFactsDigest,
  }));
  const retirement = subjects.map((subject) => Object.freeze({
    subject: Object.freeze({
      kind: subject.kind,
      id: subject.id,
      revision: subject.revision,
      digest: subject.digest,
    }),
    factsDigest: subject.retirementFactsDigest,
  }));
  return Object.freeze({
    terminalExecutionSetDigest,
    executionCount: subjects.length,
    containment: Object.freeze({
      classification: "complete",
      factsDigest: digestCanonical({
        schema: "lifecycle.terminal-execution-containment-set.private.v1",
        subjects: Object.freeze(containment),
      }),
    }),
    retirement: Object.freeze({
      classification: "complete",
      factsDigest: digestCanonical({
        schema: "lifecycle.terminal-execution-retirement-set.private.v1",
        subjects: Object.freeze(retirement),
      }),
    }),
  });
}

function reclamationTerminalSubjects(input: Readonly<{
  storeId: string;
  processId: string;
  subjects: readonly TerminalExecutionSubject[];
}>): readonly FoundationExecutionReclamationTerminalSubjectV1[] {
  return Object.freeze(input.subjects.map((subject) => Object.freeze({
    receipt: Object.freeze({
      kind: subject.kind,
      id: subject.id,
      revision: subject.revision,
      digest: subject.digest,
    }),
    owner: Object.freeze({
      storeId: input.storeId,
      processId: input.processId,
      activityId: subject.owner.activityId,
      kind: subject.owner.kind,
      subjectDigest: subject.owner.subjectDigest,
    }),
    retirementFactsDigest: subject.retirementFactsDigest,
  })));
}

function verifiedReclamationHandoff(input: Readonly<{
  value: FoundationExecutionReclamationTerminalVerificationV1;
  expectedTerminalExecutionSetDigest: Sha256;
  expectedExecutionCount: number;
  expectedPreIntentRefusalSetDigest: Sha256;
  expectedPreIntentRefusalCount: number;
  expectedObligationCount: number;
}>): ClosureReclamationHandoff {
  const value = input.value as unknown as ControlJsonObject;
  exactKeys(
    value,
    [
      "executionCount",
      "obligationCount",
      "obligationSetDigest",
      "preIntentRefusalCount",
      "preIntentRefusalSetDigest",
      "terminalExecutionSetDigest",
    ],
    "Terminal Reclamation verification",
  );
  const terminalExecutionSetDigest = digest(
    value.terminalExecutionSetDigest,
    "Terminal Reclamation execution-set digest",
  );
  const executionCount = integer(
    value.executionCount,
    "Terminal Reclamation execution count",
  );
  const obligationSetDigest = digest(
    value.obligationSetDigest,
    "Terminal Reclamation obligation-set digest",
  );
  const obligationCount = integer(
    value.obligationCount,
    "Terminal Reclamation obligation count",
  );
  const preIntentRefusalSetDigest = digest(
    value.preIntentRefusalSetDigest,
    "Terminal Reclamation pre-intent-refusal-set digest",
  );
  const preIntentRefusalCount = integer(
    value.preIntentRefusalCount,
    "Terminal Reclamation pre-intent refusal count",
  );
  if (
    terminalExecutionSetDigest !== input.expectedTerminalExecutionSetDigest ||
    executionCount !== input.expectedExecutionCount ||
    preIntentRefusalSetDigest !== input.expectedPreIntentRefusalSetDigest ||
    preIntentRefusalCount !== input.expectedPreIntentRefusalCount ||
    obligationCount !== input.expectedObligationCount
  ) {
    fail(
      "reclamation-handoff",
      "Terminal Reclamation verification does not bind the exact execution subject set",
    );
  }
  return Object.freeze({ obligationSetDigest, obligationCount });
}

async function observeTerminalDisposition(input: Readonly<{
  target: string;
  machineHome: string;
  store: ControlRecordStore;
  context: TerminalKernelContext;
  kernel: TerminalCheckpointAdapter;
  compiled: FoundationCompiledTerminalEffectPlanV7;
  selected: TerminalOwners;
}>): Promise<TerminalKernelContext> {
  const checkpoint = terminalCheckpoint(input.context);
  if (
    input.context.recovery.resumesAt !== "transaction-finalization" ||
    checkpoint.terminalDisposition !== null ||
    (input.compiled.plan.operation === "delivery.accept") !== (checkpoint.acceptance !== null)
  ) {
    fail("support-stage", "Terminal disposition requires exact applied reducer recovery");
  }
  assertAppliedAcceptanceCheckpoint({
    store: input.store,
    compiled: input.compiled,
    acceptance: checkpoint.acceptance,
  });
  if (checkpoint.acceptance !== null) {
    await synchronizeRetainedAcceptanceIfCurrent(
      input.target,
      input.compiled.plan,
      checkpoint.acceptance,
    );
  }
  const executionSubjects = terminalExecutionSubjects(input.store);
  const preIntentRefusals = terminalPreIntentRefusals(input.store);
  const reclamationSubjects = reclamationTerminalSubjects({
    storeId: input.store.identity.storeId,
    processId: input.store.identity.processId,
    subjects: executionSubjects,
  });
  const terminalExecutionSetDigest =
    foundationExecutionReclamationTerminalSubjectSetDigestV1({
      storeId: input.store.identity.storeId,
      processId: input.store.identity.processId,
      subjects: reclamationSubjects,
    });
  const preIntentRefusalSetDigest =
    foundationExecutionReclamationPreIntentRefusalSetDigestV1({
      storeId: input.store.identity.storeId,
      processId: input.store.identity.processId,
      preIntentRefusals,
    });
  const verification = await input.selected.observeReclamationHandoff({
    machineHome: input.machineHome,
    storeId: input.store.identity.storeId,
    processId: input.store.identity.processId,
    subjects: reclamationSubjects,
    preIntentRefusals,
  });
  const reclamationHandoff = verifiedReclamationHandoff({
    value: verification,
    expectedTerminalExecutionSetDigest: terminalExecutionSetDigest,
    expectedExecutionCount: executionSubjects.length,
    expectedPreIntentRefusalSetDigest: preIntentRefusalSetDigest,
    expectedPreIntentRefusalCount: preIntentRefusals.length,
    expectedObligationCount: executionSubjects.length + preIntentRefusals.length,
  });
  const terminalExecutions = compileTerminalExecutions(
    executionSubjects,
    terminalExecutionSetDigest,
  );
  const terminalAt = sampleTime(input.selected, "Terminal disposition completion time");
  const next = nextCheckpoint({
    current: checkpoint,
    terminalDisposition: Object.freeze({
      terminalAt,
      canonicalResult: checkpoint.acceptance === null
        ? null
        : Object.freeze({ ...checkpoint.acceptance }),
      terminalExecutions,
      reclamationHandoff: Object.freeze({ ...reclamationHandoff }),
    }),
  });
  const retained = input.kernel.commit({
    mode: "support-only",
    expected: input.context.coordinate,
    checkpoint: next,
  });
  await input.selected.onStage("terminal-disposition-observed");
  return retained.context;
}

function closureRuntimeCoordinates(): ClosureRuntimeCoordinates {
  return Object.freeze({
    implementationId: FOUNDATION_TERMINAL_TRANSACTION_V7.id,
    implementationDigest: FOUNDATION_TERMINAL_TRANSACTION_V7.implementationDigest,
    ruleSetId: FOUNDATION_TERMINAL_TRANSACTION_V7.ruleSetId,
    ruleSetDigest: FOUNDATION_TERMINAL_TRANSACTION_V7.ruleSetDigest,
  });
}

async function retainTerminalClosure(input: Readonly<{
  machineHome: string;
  store: ControlRecordStore;
  context: TerminalKernelContext;
  compiled: FoundationCompiledTerminalEffectPlanV7;
  runtimeId: string;
  selected: TerminalOwners;
}>): Promise<ControlRecordRevision> {
  const checkpoint = terminalCheckpoint(input.context);
  if (
    input.context.recovery.resumesAt !== "transaction-finalization" ||
    checkpoint.terminalDisposition === null
  ) {
    fail("support-stage", "Terminal Closure requires exact retained terminal disposition facts");
  }
  assertAppliedAcceptanceCheckpoint({
    store: input.store,
    compiled: input.compiled,
    acceptance: checkpoint.acceptance,
  });
  await input.selected.verifyCandidateCarriers({
    machineHome: input.machineHome,
    store: input.store,
  });
  const currentExecutionSubjects = terminalExecutionSubjects(input.store);
  const currentPreIntentRefusals = terminalPreIntentRefusals(input.store);
  const currentReclamationSubjects = reclamationTerminalSubjects({
    storeId: input.store.identity.storeId,
    processId: input.store.identity.processId,
    subjects: currentExecutionSubjects,
  });
  const currentExecutionSetDigest =
    foundationExecutionReclamationTerminalSubjectSetDigestV1({
      storeId: input.store.identity.storeId,
      processId: input.store.identity.processId,
      subjects: currentReclamationSubjects,
    });
  const currentPreIntentRefusalSetDigest =
    foundationExecutionReclamationPreIntentRefusalSetDigestV1({
      storeId: input.store.identity.storeId,
      processId: input.store.identity.processId,
      preIntentRefusals: currentPreIntentRefusals,
    });
  const currentVerification = await input.selected.observeReclamationHandoff({
    machineHome: input.machineHome,
    storeId: input.store.identity.storeId,
    processId: input.store.identity.processId,
    subjects: currentReclamationSubjects,
    preIntentRefusals: currentPreIntentRefusals,
  });
  const currentHandoff = verifiedReclamationHandoff({
    value: currentVerification,
    expectedTerminalExecutionSetDigest: currentExecutionSetDigest,
    expectedExecutionCount: currentExecutionSubjects.length,
    expectedPreIntentRefusalSetDigest: currentPreIntentRefusalSetDigest,
    expectedPreIntentRefusalCount: currentPreIntentRefusals.length,
    expectedObligationCount:
      currentExecutionSubjects.length + currentPreIntentRefusals.length,
  });
  const currentExecutions = compileTerminalExecutions(
    currentExecutionSubjects,
    currentExecutionSetDigest,
  );
  if (
    canonicalJson(currentExecutions) !==
      canonicalJson(checkpoint.terminalDisposition.terminalExecutions) ||
    canonicalJson(currentHandoff) !==
      canonicalJson(checkpoint.terminalDisposition.reclamationHandoff)
  ) {
    fail(
      "terminal-disposition",
      "Terminal execution or immutable Reclamation handoff facts changed before Closure",
    );
  }
  const drafts = await readdir(input.store.paths.drafts);
  if (drafts.length !== 0) {
    fail(
      "terminal-disposition",
      "Terminal Closure requires the governed Control drafts area to be exactly empty",
      { entryCount: drafts.length },
    );
  }
  const definition = terminalDefinition(input.compiled.plan.operation);
  const retained = finishFoundationTerminalActivityKernelV7({
    store: input.store,
    activityId: input.context.activity.id,
    definition,
    outcome: "completed",
    sampleCompletedAt: () => checkpoint.terminalDisposition!.terminalAt,
    compileOperationAppend: (current, completedAt) => {
      const currentDisposition = terminalCheckpoint(current).terminalDisposition;
      if (currentDisposition === null || currentDisposition.terminalAt !== completedAt) {
        fail("closure", "Terminal completion differs from retained disposition time");
      }
      return compileClosureAppend({
        store: input.store,
        activityId: input.compiled.plan.activityId,
        canonicalResult: currentDisposition.canonicalResult,
        terminalExecutions: currentDisposition.terminalExecutions,
        reclamationHandoff: currentDisposition.reclamationHandoff,
        runtime: closureRuntimeCoordinates(),
        terminalAt: completedAt,
        runtimeId: input.runtimeId,
      }).append;
    },
  });
  const revision = retained.revision;
  if (revision === null || revision.recordKind !== "closure") {
    fail("closure", "Terminal transaction did not retain its exact compiled Closure");
  }
  await input.selected.onStage("closure-recorded");
  return revision;
}

function result(input: Readonly<{
  status: FoundationTerminalV7Result["status"];
  compiled: FoundationCompiledTerminalEffectPlanV7;
  transactionOutcome: FoundationTerminalV7Result["transactionOutcome"];
  closure?: ControlRecordRevision | null;
  archiveManifestDigest?: Sha256 | null;
}>): FoundationTerminalV7Result {
  const retainedCanonical = input.closure === undefined || input.closure === null ||
      input.closure.payload.canonicalResult === null
    ? null
    : string(
        object(input.closure.payload.canonicalResult, "Closure canonical result").commit,
        "Closure canonical commit",
      );
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
    closure: input.closure === undefined || input.closure === null
      ? null
      : Object.freeze({
          id: input.closure.recordId,
          revision: input.closure.revision,
          digest: input.closure.digest,
        }),
    canonicalCommit: input.transactionOutcome === "applied" &&
        input.compiled.plan.operation === "delivery.accept"
      ? retainedCanonical
      : null,
    archiveManifestDigest: input.archiveManifestDigest ?? null,
  });
}

async function sealAndArchive(input: Readonly<{
  machineHome: string;
  store: ControlRecordStore;
  closure: ControlRecordRevision;
  terminalAt: string;
  compiled: FoundationCompiledTerminalEffectPlanV7;
  selected: TerminalOwners;
}>): Promise<FoundationTerminalV7Result> {
  await input.selected.verifyCandidateCarriers({
    machineHome: input.machineHome,
    store: input.store,
  });
  const existingSeal = input.store.getSeal();
  if (existingSeal === null) {
    await input.store.seal({
      closure: Object.freeze({
        recordId: input.closure.recordId,
        revision: input.closure.revision,
        digest: input.closure.digest,
      }),
      sealedAt: input.terminalAt,
    });
  } else if (
    existingSeal.closure.recordId !== input.closure.recordId ||
    existingSeal.closure.revision !== input.closure.revision ||
    existingSeal.closure.digest !== input.closure.digest ||
    existingSeal.sealedAt !== input.terminalAt
  ) {
    fail("seal", "Retained Store seal differs from the exact terminal Closure disposition");
  }
  await input.selected.onStage("store-sealed");
  input.store.close();
  const archived = await input.selected.archiveStore({
    machineHome: input.machineHome,
    targetId: input.compiled.plan.targetId,
    deliveryId: input.compiled.plan.processId,
    archivedAt: input.terminalAt,
  });
  await input.selected.onStage("store-archived");
  return result({
    status: "completed",
    compiled: input.compiled,
    transactionOutcome: "applied",
    closure: input.closure,
    archiveManifestDigest: archived.manifestDigest,
  });
}

async function stepTerminal(input: Readonly<{
  target: string;
  machineHome: string;
  store: ControlRecordStore;
  context: TerminalKernelContext;
  kernel: TerminalCheckpointAdapter;
  compiled: FoundationCompiledTerminalEffectPlanV7;
  runtimeId: string;
  selected: TerminalOwners;
}>): Promise<
  | Readonly<{ status: "continue" }>
  | Readonly<{ status: "deferred"; value: FoundationTerminalV7Result }>
  | Readonly<{ status: "settled"; value: FoundationTerminalV7Result }>
> {
  assertContextMatchesDecision({
    store: input.store,
    context: input.context,
    compiled: input.compiled,
  });
  const transaction = await advanceFoundationActivityKernelTransactionEffectV7({
    store: input.store,
    context: input.context,
    checkpoint: input.kernel,
    effectDigest: input.compiled.effectDigest,
    runtimeId: input.runtimeId,
    sampleIntendedAt: () => sampleTime(
      input.selected,
      "Terminal transaction effect intent time",
    ),
    sampleObservedAt: () => sampleTime(
      input.selected,
      "Terminal transaction effect observation time",
    ),
    observe: async ({ checkpoint }) => {
      if (checkpoint === null) fail("support", "Terminal transaction requires its exact checkpoint");
      const observation = await observeEffect({
        target: input.target,
        machineHome: input.machineHome,
        store: input.store,
        compiled: input.compiled,
        selected: input.selected,
      });
      return Object.freeze({
        outcome: observation.outcome,
        facts: observation.facts,
        checkpoint: observation.outcome === "applied"
          ? nextCheckpoint({ current: checkpoint, acceptance: observation.acceptance })
          : checkpoint,
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
    if (transaction.outcome !== "not-applied") {
      fail("support-stage", "Failed terminal completion lacks an exact not-applied observation");
    }
    await failTerminalActivity({
      store: input.store,
      context: input.context,
      runtimeId: input.runtimeId,
      selected: input.selected,
    });
    return Object.freeze({
      status: "settled" as const,
      value: result({
        status: "failed",
        compiled: input.compiled,
        transactionOutcome: "not-applied",
      }),
    });
  }
  if (
    input.context.recovery.resumesAt !== "transaction-finalization" ||
    transaction.outcome !== "applied"
  ) {
    fail("support-stage", "Terminal operation has an unsupported reducer recovery coordinate");
  }
  const checkpoint = terminalCheckpoint(input.context);
  if (checkpoint.terminalDisposition === null) {
    await observeTerminalDisposition({
      target: input.target,
      machineHome: input.machineHome,
      store: input.store,
      context: input.context,
      kernel: input.kernel,
      compiled: input.compiled,
      selected: input.selected,
    });
    return Object.freeze({ status: "continue" as const });
  }
  const closure = await retainTerminalClosure({
    machineHome: input.machineHome,
    store: input.store,
    context: input.context,
    compiled: input.compiled,
    runtimeId: input.runtimeId,
    selected: input.selected,
  });
  return Object.freeze({
    status: "settled" as const,
    value: result({
      status: "completed",
      closure,
      compiled: input.compiled,
      transactionOutcome: "applied",
    }),
  });
}

async function contractForRetainedPlan(
  target: string,
  plan: FoundationTerminalEffectPlanV7,
): Promise<Readonly<{
  contract: FoundationRepositoryContract;
  objectFormat: FoundationGitObjectFormat;
}>> {
  const historical = await loadRepositoryEpochAtCommit(target, plan.repository.canonicalCommit);
  if (
    historical.contract.digest !== plan.repository.repositoryContractDigest ||
    historical.contract.targetId !== plan.targetId ||
    historical.epoch.objectFormat !== plan.canonical.objectFormat ||
    historical.epoch.tree !== plan.repository.canonicalTree ||
    historical.epoch.ref !== plan.canonical.ref
  ) {
    fail("repository", "Historical repository contract does not reproduce retained terminal support");
  }
  return Object.freeze({
    contract: historical.contract,
    objectFormat: historical.epoch.objectFormat,
  });
}

function unverifiedDecisionPlanBasis(
  store: ControlRecordStore,
  activityId: string,
): Readonly<{
  canonicalCommit: string;
  canonicalTree: string;
  repositoryContractDigest: Sha256;
}> {
  const decisionEvent = allEvents(store).filter((event) =>
    event.eventKind === "founder-decision-authenticated" &&
    event.payload.activityId === activityId);
  if (decisionEvent.length !== 1 || decisionEvent[0]!.subject === null) {
    fail("decision", "Terminal recovery requires one exact retained Founder Decision");
  }
  const selected = decisionEvent[0]!.subject!;
  const revision = store.getRevision(selected.recordId, selected.revision);
  if (
    revision === null || revision.recordKind !== "founder-decision" ||
    revision.digest !== selected.digest
  ) {
    fail("decision", "Terminal recovery Founder Decision does not resolve exactly");
  }
  const subject = object(revision.payload.subject, "Founder Decision subject");
  const repository = object(subject.repository, "Founder Decision repository basis");
  const canonicalCommit = string(repository.canonicalCommit, "Founder Decision canonical commit");
  const canonicalTree = string(repository.canonicalTree, "Founder Decision canonical tree");
  if (!GIT_OBJECT.test(canonicalCommit) || !GIT_OBJECT.test(canonicalTree)) {
    fail("decision", "Founder Decision repository basis has invalid Git object identities");
  }
  return Object.freeze({
    canonicalCommit,
    canonicalTree,
    repositoryContractDigest: digest(
      repository.repositoryContractDigest,
      "Founder Decision repository contract digest",
    ),
  });
}

async function compiledForRecovery(input: Readonly<{
  target: string;
  store: ControlRecordStore;
  activityId: string;
  context: TerminalKernelContext | null;
}>): Promise<FoundationCompiledTerminalEffectPlanV7> {
  if (input.context !== null) {
    const plan = input.context.envelope.plan.value;
    const historical = await contractForRetainedPlan(input.target, plan);
    return compileFoundationTerminalEffectPlanV7(
      input.target,
      input.store,
      input.activityId,
      historical.contract,
      historical.objectFormat,
    );
  }
  const basis = unverifiedDecisionPlanBasis(input.store, input.activityId);
  const historical = await loadRepositoryEpochAtCommit(input.target, basis.canonicalCommit);
  if (
    historical.contract.digest !== basis.repositoryContractDigest ||
    historical.epoch.tree !== basis.canonicalTree
  ) {
    fail("repository", "Terminal recovery historical contract differs from the retained Decision basis");
  }
  return compileFoundationTerminalEffectPlanV7(
    input.target,
    input.store,
    input.activityId,
    historical.contract,
    historical.epoch.objectFormat,
  );
}

function retainedClosure(
  store: ControlRecordStore,
  compiled: FoundationCompiledTerminalEffectPlanV7,
): ControlRecordRevision | null {
  const selected = store.state().subjects.closure;
  if (selected === null) return null;
  const revision = store.getRevision(selected.id, selected.revision);
  if (
    revision === null || revision.recordKind !== "closure" ||
    revision.digest !== selected.digest ||
    revision.payload.disposition !== (compiled.plan.operation === "delivery.accept" ? "accepted" : "no-ship")
  ) {
    fail("closure", "Terminal state Closure does not resolve to the exact retained disposition");
  }
  return revision;
}

async function settledTerminalResult(input: Readonly<{
  machineHome: string;
  store: ControlRecordStore;
  compiled: FoundationCompiledTerminalEffectPlanV7;
  selected: TerminalOwners;
}>): Promise<FoundationTerminalV7Result> {
  const closure = retainedClosure(input.store, input.compiled);
  if (closure !== null) {
    const terminalAt = controlTimestamp(
      string(closure.payload.terminalAt, "Retained Closure terminal time"),
      "Retained Closure terminal time",
    );
    return sealAndArchive({
      machineHome: input.machineHome,
      store: input.store,
      closure,
      terminalAt,
      compiled: input.compiled,
      selected: input.selected,
    });
  }
  const activity = input.store.state().activities.find(({ id }) =>
    id === input.compiled.plan.activityId);
  const events = allEvents(input.store).filter((event) =>
    event.payload.activityId === input.compiled.plan.activityId);
  const observations = events.filter(({ eventKind }) => eventKind === "transaction-effect-observed");
  const completions = events.filter(({ eventKind }) => eventKind === "activity-completed");
  if (
    activity?.stage === "completed" && observations.at(-1)?.payload.outcome === "not-applied" &&
    completions.length === 1 && completions[0]!.payload.outcome === "failed"
  ) {
    return result({
      status: "failed",
      compiled: input.compiled,
      transactionOutcome: "not-applied",
    });
  }
  fail("support", "Incomplete terminal transaction cannot recover without exact live operation support");
}

async function beginTerminal(
  operation: TerminalOperation,
  input: FoundationTerminalV7Input,
  options: FoundationTerminalV7Options,
): Promise<FoundationTerminalV7Result> {
  const selected = owners(options);
  return selected.withTargetLock(input.target, "delivery-terminal", async () => {
    const state = input.store.state();
    if (!state.eligibleOperations.includes(operation)) {
      fail("standing", `Delivery is not eligible for one exact ${operation} opening`);
    }
    const basisObservedAt = sampleTime(selected, "Terminal pre-authorization repository observation time");
    const historicalBoundary = operation === "delivery.accept"
      ? state.subjects.activeBoundary
      : currentTerminalBoundary(input.store);
    if (operation === "delivery.accept" && historicalBoundary === null) {
      fail("boundary", "Acceptance authority requires one exact active Work Boundary");
    }
    const repository = historicalBoundary !== null
      ? await observeHistoricalTerminalRepositoryV7(
          input.target,
          input.store,
          historicalBoundary,
          basisObservedAt,
        )
      : await selected.observeRepository(input.target, basisObservedAt);
    if (
      repository.contract.targetId !== input.store.identity.targetId ||
      repository.ref !== repository.contract.canonicalBranch ||
      repository.basis.repositoryContractDigest !== repository.contract.digest
    ) {
      fail("repository", "Terminal repository observation does not bind the exact Store target and branch");
    }
    const times = openingTimes(selected);
    const activityId = createDeliveryActivityId(operation);
    const semanticMarkdown = operation === "delivery.accept"
      ? [
          "# Founder Acceptance Decision",
          "",
          "Accept the exact evidenced sealed Candidate selected by this authenticated Decision.",
          "",
        ].join("\n")
      : input.semanticMarkdown;
    if (semanticMarkdown === undefined) {
      fail("semantic-input", "No-ship requires one exact Founder-supplied semantic rationale");
    }
    const opening = await compileFounderDecisionOpening({
      store: input.store,
      activityId,
      operation,
      semanticMarkdown,
      repository: repository.basis,
      contract: repository.contract,
      authorityHome: input.authorityHome,
      authoritySecret: input.authoritySecret,
      startedAt: times.startedAt,
      authorizedAt: times.authorizedAt,
      expiresAt: null,
      nonce: `terminal-${randomUUID()}`,
      verifiedAt: times.verifiedAt,
      runtimeId: input.runtimeId,
    });
    const compiled = planFromDecision(
      input.store,
      opening.revision,
      opening.subject,
      repository.contract,
      repository.objectFormat,
    );
    const definition = terminalDefinition(operation);
    openFoundationActivityKernelV7({
      store: input.store,
      activityId,
      definition,
      plan: compiled.plan as TerminalPlan,
      checkpoint: checkpointPayload({}),
      appends: Object.freeze([opening.activityAppend, opening.decisionAppend]),
    });
    await selected.onStage("opening-committed");
    const advanced = await advanceFoundationActivityKernelV7({
      store: input.store,
      activityId,
      definition,
      runtimeId: input.runtimeId,
      advance: ({ context, checkpoint }) => stepTerminal({
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
    return advanced.status === "completed"
      ? settledTerminalResult({
          machineHome: input.machineHome,
          store: input.store,
          compiled,
          selected,
        })
      : advanced;
  });
}

/** Authenticate and execute exact acceptance, including Store seal and archive. */
export async function acceptDeliveryV7(
  input: FoundationTerminalV7Input,
  options: FoundationTerminalV7Options = {},
): Promise<FoundationTerminalV7Result> {
  return beginTerminal("delivery.accept", input, options);
}

/** Authenticate and execute exact no-ship without integrating Candidate bytes. */
export async function noShipDeliveryV7(
  input: FoundationTerminalV7Input,
  options: FoundationTerminalV7Options = {},
): Promise<FoundationTerminalV7Result> {
  return beginTerminal("delivery.no-ship", input, options);
}

/** Reverify and continue one exact retained acceptance or no-ship transaction. */
export async function recoverTerminalDeliveryV7(
  input: FoundationTerminalRecoveryV7Input,
  options: FoundationTerminalV7Options = {},
): Promise<FoundationTerminalV7Result> {
  const selected = owners(options);
  return selected.withTargetLock(input.target, "delivery-terminal", async () => {
    const state = input.store.state();
    const activityId = input.activityId === undefined
      ? (() => {
          const terminal = state.activities.filter((activity) =>
            (activity.operation === "delivery.accept" || activity.operation === "delivery.no-ship") &&
            (activity.stage !== "completed" || state.subjects.closure !== null));
          if (terminal.length !== 1) {
            fail("recovery", "Terminal recovery requires one exact terminal activity identity");
          }
          return terminal[0]!.id;
        })()
      : controlIdentifier(input.activityId, "Terminal recovery activity identity");
    const activity = state.activities.find(({ id }) => id === activityId);
    if (
      activity === undefined ||
      !(activity.operation === "delivery.accept" || activity.operation === "delivery.no-ship")
    ) {
      fail("recovery", "Terminal recovery activity does not resolve exactly");
    }
    const definition = terminalDefinition(activity.operation);
    const context = activity.stage === "completed"
      ? null
      : readFoundationActivityKernelV7({
          store: input.store,
          activityId,
          definition,
        });
    const compiled = await compiledForRecovery({
      target: input.target,
      store: input.store,
      activityId,
      context,
    });
    if (context === null) {
      return settledTerminalResult({
        machineHome: input.machineHome,
        store: input.store,
        compiled,
        selected,
      });
    }
    assertContextMatchesDecision({ store: input.store, context, compiled });
    const advanced = await recoverFoundationActivityKernelV7({
      store: input.store,
      activityId,
      definition,
      runtimeId: input.runtimeId,
      now: selected.now,
      resume: ({ context: current, checkpoint }) => stepTerminal({
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
    return advanced.status === "completed"
      ? settledTerminalResult({
          machineHome: input.machineHome,
          store: input.store,
          compiled,
          selected,
        })
      : advanced;
  });
}
