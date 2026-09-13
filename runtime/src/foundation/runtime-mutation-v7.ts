import { assertFoundationAuthorityCredential, assertFoundationAuthorityExecutionContext, type FoundationAuthorityCredential } from "./repository/authority.js";
import { randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { LifecycleError } from "../errors.js";
import {
  FoundationGitObjectSchema,
  FoundationRfc3339Schema,
  FoundationSha256Schema,
  type FoundationRuntimeAcceptRequest,
  type FoundationRuntimeAdmitRequest,
  type FoundationDeliveryGeneration,
  type FoundationRuntimeContinueRequest,
  type FoundationRuntimeEvaluateRequest,
  type FoundationRuntimeIntegrateRequest,
  type FoundationRuntimeNoShipRequest,
  type FoundationRuntimeOperationResult,
  type FoundationRuntimePrepareRequest,
  type FoundationRuntimeReaffirmRequest,
  type FoundationRuntimeRecoverRequest,
  type FoundationRuntimeReviseRequest,
  type FoundationSha256,
  type FoundationRuntimeWorkRequest,
} from "@neutral/lifecycle-protocol";
import { createDeliveryActivityId } from "./control/activity.js";
import {
  createDeliveryControlRecordStore,
  openDeliveryControlRecordStore,
  type OpenedDeliveryControlRecordStore,
} from "./control/delivery-custody.js";
import { executionReceiptSubmissionDiagnosticForActivity } from "./control/execution-receipt.js";
import { compileDeliveryGeneration } from "./control/delivery-view.js";
import { compileWorkDelegation } from "./control/work-delegation-compilation.js";
import { compileWorkDelegationStopAppend } from "./control/work-delegation-stop.js";
import { runWorkDelegation } from "./process/work-delegation-runtime.js";
import { selectWorkDelegationAgentResources } from "./process/work-delegation-reservation.js";
import type { AuthorizationReviewCore } from "./control/director-decision.js";
import { normalizeSemanticMarkdown } from "./control/model.js";
import type { DeliveryControlPhysicalDisposition } from "./control/public-view.js";
import type { ControlRecordStore } from "./control/store.js";
import { FoundationError } from "./error.js";
import type {
  FoundationRuntimeMutationExecutor,
  FoundationRuntimeMutationRequest,
} from "./facade.js";
import {
  selectFoundationProcessRuntimeConfigurationV7,
  type FoundationInstalledRuntimeConfigurationV7,
} from "./installed-configuration-v7.js";
import { bindFoundationInstalledAgentRuntimeV1 } from "./execution/installed-agent-runtime-v1.js";
import type { FoundationCheckCellOperatorV1 } from "./check/execution-cell-v1.js";
import {
  openFoundationInstalledCheckRuntimeV1,
  openFoundationInstalledReclamationObserverV1,
  type FoundationOpenedInstalledCheckRuntimeV1,
} from "./execution/installed-check-runtime-v1.js";
import type { FoundationAgentOperationV7Options } from "./process/agent-operation-v7.js";
import {
  operateFoundationCandidateAgentRuntimeV7,
  recoverFoundationCandidateAgentRuntimeV7,
  type FoundationCandidateAgentRuntimeV7Options,
} from "./process/candidate-agent-runtime-v7.js";
import {
  evaluateDeliveryV7,
  recoverDeliveryEvaluationV7,
  type FoundationEvaluationRuntimeV7Options,
} from "./process/evaluation-runtime-v7.js";
import {
  foundationMutationBeforeV7 as mutationBefore,
  foundationMutationResultV7 as mutationResult,
  foundationPreparationRefusalResultV7,
  foundationWorkStopAcknowledgmentV7,
  foundationWorkStopFoldFailureV7,
  type FoundationMutationBeforeV7 as MutationBefore,
} from "./process/mutation-result-v7.js";
import {
  preflightFoundationPreparationBasisV7,
} from "./process/preparation-context-v7.js";
import {
  operateFoundationPreparationRuntimeV7,
  openFoundationPreparationRuntimeV7,
  recoverFoundationPreparationRuntimeV7,
  type FoundationPreparationRuntimeV7Options,
} from "./process/preparation-runtime-v7.js";
import { operateFoundationIntegrationRuntimeV1, recoverFoundationIntegrationRuntimeV1 } from "./process/integration-runtime-v1.js";
import type { DeliveryActivity, DeliveryOperation } from "./process/delivery-state.js";
import { withDeliveryOperationLock } from "./control/delivery-operation-lock.js";
import {
  loadRepositoryIdentityEpoch,
} from "./repository/snapshot.js";
import type {
  FoundationLoadedRepositoryEpoch,
  FoundationLoadedRepositoryIdentityEpoch,
} from "./repository/types.js";
import {
  admitDeliveryV7,
  recoverAdmissionV7,
  type FoundationAdmissionV7Result,
} from "./transaction/admission-v7.js";
import {
  acceptDeliveryV7,
  noShipDeliveryV7,
  recoverTerminalDeliveryV7,
  type FoundationTerminalV7Result,
} from "./transaction/terminal-v7.js";
import { canonicalJson, sha256Bytes } from "./validation/canonical.js";
import { observeFoundationRepositoryIdentityForRead } from "./runtime-read.js";

const RUNTIME_ID = "lifecycle-runtime-foundation-v7";
const AGENT_ID = "codex-agent-provider-v6";

type CandidateRequest =
  | FoundationRuntimeContinueRequest
  | FoundationRuntimeReviseRequest
  | FoundationRuntimeReaffirmRequest;

type AgentRequest = CandidateRequest | FoundationRuntimeEvaluateRequest;

type TerminalRequest = FoundationRuntimeAcceptRequest | FoundationRuntimeNoShipRequest;

/** Private server-side locator retained with an authorization challenge. */
export type FoundationInvocationPrivateDeliveryLocatorV1 = Readonly<{
  target: string;
  deliveryId: string;
}>;

type InvocationPrivateAuthorizationRequest = FoundationRuntimeAdmitRequest | TerminalRequest;

export type FoundationInvocationPrivateAuthorizationExpectationV1 = Readonly<{
  schema: "lifecycle.invocation-private-director-authorization-expectation.v1";
  deliveryId: string;
  operation: InvocationPrivateAuthorizationRequest["operation"];
  normalizedSemanticInput: string | null;
  normalizedSemanticInputDigest: FoundationSha256;
  expectedGeneration: FoundationSha256;
  authorizationReviewDigest: FoundationSha256;
  authority: Readonly<{
    principalId: string;
    keyId: string;
    algorithm: "ed25519";
  }>;
}>;

export type FoundationInvocationPrivateAuthorizationClaimV1 = Readonly<{
  expectation: FoundationInvocationPrivateAuthorizationExpectationV1;
  /** Mark the one-shot challenge consumed after its Decision opening is durable. */
  consume(): void | Promise<void>;
  /** Settle the one-shot challenge as refused after any pre-opening failure. */
  refuse(): void | Promise<void>;
}>;

export type FoundationInvocationPrivateAuthorizationGateV1 = Readonly<{
  /** Atomically settle the invocation-private challenge as claimed or throw. */
  beginClaim(): FoundationInvocationPrivateAuthorizationClaimV1 |
    Promise<FoundationInvocationPrivateAuthorizationClaimV1>;
}>;

export type FoundationInvocationPrivateAuthorizationMutationV1 = Readonly<{
  request: InvocationPrivateAuthorizationRequest;
  context: Readonly<{ authorityCredential?: FoundationAuthorityCredential }>;
  configuration: FoundationInstalledRuntimeConfigurationV7;
  gate: FoundationInvocationPrivateAuthorizationGateV1;
}>;

export type FoundationRuntimeMutationExecutorV7 = FoundationRuntimeMutationExecutor & Readonly<{
  /** @internal Invocation-private Director authorization handoff; never a Facade operation. */
  authorizeInvocationPrivate(
    input: FoundationInvocationPrivateAuthorizationMutationV1,
  ): Promise<FoundationRuntimeOperationResult>;
}>;

export type FoundationRuntimeMutationV7Preparation = Readonly<{
  preflight: typeof preflightFoundationPreparationBasisV7;
  open?: typeof openFoundationPreparationRuntimeV7;
  operate: typeof operateFoundationPreparationRuntimeV7;
  recover: typeof recoverFoundationPreparationRuntimeV7;
}>;

export type FoundationRuntimeMutationV7Candidate = Readonly<{
  operate: typeof operateFoundationCandidateAgentRuntimeV7;
  recover: typeof recoverFoundationCandidateAgentRuntimeV7;
}>;

export type FoundationRuntimeMutationV7Evaluation = Readonly<{
  evaluate: typeof evaluateDeliveryV7;
  recover: typeof recoverDeliveryEvaluationV7;
}>;

export type FoundationRuntimeMutationV7Integration = Readonly<{
  operate: typeof operateFoundationIntegrationRuntimeV1;
  recover: typeof recoverFoundationIntegrationRuntimeV1;
}>;

export type FoundationRuntimeMutationV7Admission = Readonly<{
  admit: typeof admitDeliveryV7;
  recover: typeof recoverAdmissionV7;
}>;

export type FoundationRuntimeMutationV7Terminal = Readonly<{
  accept: typeof acceptDeliveryV7;
  noShip: typeof noShipDeliveryV7;
  recover: typeof recoverTerminalDeliveryV7;
}>;

type MutationOwners = Readonly<{
  now(): string;
  randomId(): string;
  createActivityId(operation: Exclude<DeliveryOperation, "delivery.recover">): string;
  preparation: FoundationRuntimeMutationV7Preparation;
  candidate: FoundationRuntimeMutationV7Candidate;
  evaluation: FoundationRuntimeMutationV7Evaluation;
  integration: FoundationRuntimeMutationV7Integration;
  admission: FoundationRuntimeMutationV7Admission;
  terminal: FoundationRuntimeMutationV7Terminal;
  agentOperation: FoundationAgentOperationV7Options;
  installedPreparation: boolean;
  installedCandidate: boolean;
  installedEvaluation: boolean;
  installedTerminal: boolean;
}>;

/**
 * Focused dependency seams for the public compositor. Operation-specific
 * physical and Control mechanics remain owned by the installed operation
 * definitions, not by this dispatcher.
 */
export type FoundationRuntimeMutationV7Options = Readonly<{
  now?: () => string;
  randomId?: () => string;
  createActivityId?: MutationOwners["createActivityId"];
  preparation?: FoundationRuntimeMutationV7Preparation;
  candidate?: FoundationRuntimeMutationV7Candidate;
  evaluation?: FoundationRuntimeMutationV7Evaluation;
  integration?: FoundationRuntimeMutationV7Integration;
  admission?: FoundationRuntimeMutationV7Admission;
  terminal?: FoundationRuntimeMutationV7Terminal;
  /** @internal Physical Agent seam used by operated-path fault injection. */
  agentOperation?: FoundationAgentOperationV7Options;
}>;

function fail(
  code: string,
  message: string,
  facts: Readonly<Record<string, unknown>> = {},
): never {
  throw new FoundationError(`lifecycle.runtime-mutation-v7.${code}`, message, {
    observedFacts: facts,
  });
}

function timestamp(owners: MutationOwners): string {
  return FoundationRfc3339Schema.parse(owners.now());
}

function within(parent: string, child: string): boolean {
  const displacement = relative(parent, child);
  return displacement === "" || (
    displacement !== ".." && !displacement.startsWith(`..${sep}`) &&
    !isAbsolute(displacement)
  );
}

async function assertCanonicalDirectory(path: string, label: string): Promise<string> {
  const canonical = await realpath(path);
  const state = await lstat(canonical);
  if (!state.isDirectory() || state.isSymbolicLink()) {
    fail("physical-boundary", `${label} must be one canonical regular directory`);
  }
  return canonical;
}

async function assertDisjointMachineAndTarget(
  machineHome: string,
  target: string,
): Promise<void> {
  const [home, repository] = await Promise.all([
    assertCanonicalDirectory(machineHome, "Lifecycle machine home"),
    assertCanonicalDirectory(target, "Target repository"),
  ]);
  if (within(home, repository) || within(repository, home)) {
    fail("physical-boundary", "Lifecycle machine home and target repository must remain disjoint");
  }
}

async function identityTarget(
  target: string,
  configuration: Pick<FoundationInstalledRuntimeConfigurationV7, "machineHome">,
): Promise<FoundationLoadedRepositoryIdentityEpoch> {
  const epoch = await loadRepositoryIdentityEpoch(target);
  await assertDisjointMachineAndTarget(configuration.machineHome, epoch.repository);
  return epoch;
}

async function withDeliveryMutationLock<Value>(
  input: Readonly<{
    request: Readonly<{ target: string; deliveryId: string }>;
    configuration: FoundationInstalledRuntimeConfigurationV7;
  }>,
  operation: string,
  action: () => Promise<Value>,
): Promise<Value> {
  const identity = await identityTarget(input.request.target, input.configuration);
  return withDeliveryOperationLock({
    machineHome: input.configuration.machineHome,
    targetId: identity.contract.targetId,
    deliveryId: input.request.deliveryId,
  }, operation, async () => {
    const current = await identityTarget(input.request.target, input.configuration);
    if (current.contract.targetId !== identity.contract.targetId) {
      fail("target-substitution", "The target identity changed before Delivery lock acquisition");
    }
    return action();
  });
}

function mutationAuthorityCredential(value: FoundationAuthorityCredential | undefined): FoundationAuthorityCredential {
  assertFoundationAuthorityCredential(value, "director-decision");
  return value;
}

function invocationPrivateGeneration(
  store: ControlRecordStore,
  epoch: FoundationLoadedRepositoryIdentityEpoch,
): FoundationDeliveryGeneration {
  return compileDeliveryGeneration({
    store,
    physical: Object.freeze({ disposition: "active", archiveManifestDigest: null }),
    repository: Object.freeze({
      headCommit: epoch.epoch.commit,
      headTree: epoch.epoch.tree,
      repositoryContractDigest: epoch.contract.digest,
    }),
  });
}

export function digestFoundationInvocationPrivateAuthorizationSemanticInputV1(
  value: string | null,
): FoundationSha256 {
  const domain = "lifecycle.invocation-private.authorization-semantic-input.v1\u0000";
  return sha256Bytes(value === null ? `${domain}none` : `${domain}markdown\u0000${value}`);
}

type InvocationPrivateClaimController = Readonly<{
  assertRequest(request: InvocationPrivateAuthorizationRequest): void;
  generationMatches(generation: FoundationDeliveryGeneration): boolean;
  beforeAuthenticate(review: AuthorizationReviewCore): Promise<void>;
  openingCommitted(): Promise<void>;
  refuse(): Promise<void>;
  isCommitted(): boolean;
}>;

async function acquireInvocationPrivateClaim(
  gate: FoundationInvocationPrivateAuthorizationGateV1,
): Promise<FoundationInvocationPrivateAuthorizationClaimV1> {
  const selected = await gate.beginClaim();
  if (
    selected === null || typeof selected !== "object" ||
    typeof selected.consume !== "function" || typeof selected.refuse !== "function"
  ) {
    fail(
      "invocation-private-claim",
      "Invocation-private authorization challenge could not be claimed exactly",
    );
  }
  if (selected.expectation === null || typeof selected.expectation !== "object") {
    await selected.refuse();
    fail(
      "invocation-private-expectation",
      "Claimed Director authorization has no exact retained expectation",
    );
  }
  return selected;
}

function invocationPrivateClaimController(
  claim: FoundationInvocationPrivateAuthorizationClaimV1,
): InvocationPrivateClaimController {
  let committed = false;
  let generation: FoundationDeliveryGeneration | null = null;
  let refused = false;
  let reviewed = false;
  return Object.freeze({
    assertRequest(request): void {
      const expected = claim.expectation;
      const normalizedSemanticInput = request.operation === "delivery.no-ship"
        ? normalizeSemanticMarkdown(request.input.semanticMarkdown)
        : null;
      if (
        expected.schema !== "lifecycle.invocation-private-director-authorization-expectation.v1" ||
        expected.deliveryId !== request.deliveryId || expected.operation !== request.operation ||
        expected.normalizedSemanticInput !== normalizedSemanticInput ||
        expected.normalizedSemanticInputDigest !==
          digestFoundationInvocationPrivateAuthorizationSemanticInputV1(normalizedSemanticInput)
      ) {
        fail(
          "invocation-private-expectation",
          "Claimed Director authorization selects another Delivery or operation",
        );
      }
      FoundationSha256Schema.parse(expected.normalizedSemanticInputDigest);
      FoundationSha256Schema.parse(expected.expectedGeneration);
      FoundationSha256Schema.parse(expected.authorizationReviewDigest);
    },
    generationMatches(observed): boolean {
      generation = observed;
      return claim.expectation.expectedGeneration === observed.digest;
    },
    async beforeAuthenticate(review): Promise<void> {
      const expected = claim.expectation;
      if (
        generation === null || refused || committed || reviewed ||
        review.processId !== expected.deliveryId || review.operation !== expected.operation ||
        (expected.operation === "delivery.no-ship" &&
          review.semanticMarkdown !== expected.normalizedSemanticInput) ||
        review.authorizationReviewDigest !== expected.authorizationReviewDigest ||
        review.authority.principalId !== expected.authority.principalId ||
        review.authority.keyId !== expected.authority.keyId ||
        review.authority.algorithm !== expected.authority.algorithm ||
        review.processId !== generation.processId || review.storeId !== generation.storeId ||
        review.journalHead.sequence !== generation.journal.eventCount ||
        review.journalHead.sequence !== generation.journal.headSequence ||
        review.journalHead.digest !== generation.journal.headDigest
      ) {
        fail(
          "invocation-private-binding",
          "Claimed Director authorization does not match the exact current Delivery review",
        );
      }
      reviewed = true;
    },
    async openingCommitted(): Promise<void> {
      if (generation === null || !reviewed || refused || committed) {
        fail(
          "invocation-private-claim",
          "Invocation-private authorization opening has no exact live challenge claim",
        );
      }
      // The Director Decision and Activity opening are already one durable Store
      // batch at this boundary. Never release that claim on a later failure.
      committed = true;
      await claim.consume();
    },
    async refuse(): Promise<void> {
      if (!refused && !committed) {
        refused = true;
        await claim.refuse();
      }
    },
    isCommitted(): boolean {
      return committed;
    },
  });
}

function staleInvocationPrivateGeneration(): FoundationError {
  return new FoundationError(
    "lifecycle.read-model.generation-stale",
    "Director authorization was composed against a different Delivery generation",
    { retryable: true },
  );
}

function assertActiveStore(opened: OpenedDeliveryControlRecordStore, operation: string): void {
  if (opened.disposition !== "active") {
    fail("store-disposition", `An archived Delivery cannot execute ${operation}`);
  }
}

function activity(
  store: ControlRecordStore,
  activityId: string,
  operation: DeliveryOperation,
): DeliveryActivity {
  const selected = store.state().activities.filter(({ id }) => id === activityId);
  if (selected.length !== 1 || selected[0]!.operation !== operation) {
    fail("activity-result", "Operation result does not bind one exact retained Activity", {
      activityId,
      operation,
    });
  }
  return selected[0]!;
}

function optionalActivity(
  store: ControlRecordStore,
  activityId: string,
  operation: DeliveryOperation,
): DeliveryActivity | null {
  const selected = store.state().activities.filter(({ id }) => id === activityId);
  if (selected.length === 0) return null;
  if (selected.length !== 1 || selected[0]!.operation !== operation) {
    fail("activity-result", "Activity identity resolves to a substituted operation", {
      activityId,
      operation,
    });
  }
  return selected[0]!;
}

function hasAgentPreIntentRefusal(
  store: ControlRecordStore,
  activityId: string,
): boolean {
  let after = 0;
  let matches = 0;
  for (;;) {
    const page = store.listEvents(after, 10_000);
    for (const event of page) {
      if (
        event.eventKind === "agent-pre-intent-refused" &&
        event.payload.activityId === activityId
      ) matches += 1;
    }
    if (page.length < 10_000) break;
    after = page.at(-1)!.sequence;
  }
  if (matches > 1) {
    fail("activity-result", "Agent Activity repeats its pre-intent refusal event", {
      activityId,
      matches,
    });
  }
  return matches === 1;
}

async function completedPreIntentRefusal(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  operation: "delivery.prepare" | AgentRequest["operation"];
  error: unknown;
}>): Promise<unknown | null> {
  const selected = optionalActivity(input.store, input.activityId, input.operation);
  if (
    selected?.stage !== "completed" || selected.recovery !== null ||
    !hasAgentPreIntentRefusal(input.store, input.activityId)
  ) return null;

  return input.error;
}

function newOperationActivity(input: Readonly<{
  store: ControlRecordStore;
  operation: DeliveryOperation;
  priorActivityIds: readonly string[];
}>): DeliveryActivity | null {
  const prior = new Set(input.priorActivityIds);
  const selected = input.store.state().activities.filter((candidate) =>
    candidate.operation === input.operation && !prior.has(candidate.id));
  if (selected.length > 1) {
    fail("activity-result", "One invocation created more than one operation Activity", {
      operation: input.operation,
    });
  }
  return selected[0] ?? null;
}

function assertSettledActivity(
  store: ControlRecordStore,
  activityId: string,
  operation: DeliveryOperation,
): void {
  const selected = activity(store, activityId, operation);
  if (selected.stage !== "completed" || selected.recovery !== null) {
    fail("activity-result", "Settled operation left an incomplete or recoverable Activity", {
      activityId,
      operation,
      stage: selected.stage,
    });
  }
}

function exactRecoverableActivity(
  store: ControlRecordStore,
  expectedActivityId?: string,
  expectedOperation?: DeliveryOperation,
): DeliveryActivity | null {
  const selected = store.state().activities.filter(({ recovery }) => recovery !== null);
  if (selected.length === 0) return null;
  if (selected.length !== 1) {
    fail("recovery-owner", "Delivery has more than one retained recovery coordinate");
  }
  const value = selected[0]!;
  if (
    (expectedActivityId !== undefined && value.id !== expectedActivityId) ||
    (expectedOperation !== undefined && value.operation !== expectedOperation)
  ) {
    fail("recovery-owner", "Retained recovery coordinate belongs to a different Activity", {
      activityId: value.id,
      operation: value.operation,
    });
  }
  return value;
}

function terminalClosureSettlementActivity(store: ControlRecordStore): DeliveryActivity | null {
  const state = store.state();
  const closure = state.subjects.closure;
  if (closure === null) return null;
  if (state.journal.eventCount < 1) {
    fail("recovery-owner", "Terminal Closure has no exact Journal head");
  }
  const events = store.listEvents(state.journal.eventCount - 1, 2);
  const head = events[0];
  if (
    events.length !== 1 || head === undefined || head.eventKind !== "closure-recorded" ||
    head.subject === null || head.subject.recordId !== closure.id ||
    head.subject.revision !== closure.revision || head.subject.digest !== closure.digest ||
    typeof head.payload.activityId !== "string"
  ) {
    fail("recovery-owner", "Terminal Closure is not the exact final Journal subject");
  }
  const matches = state.activities.filter(({ id }) => id === head.payload.activityId);
  const selected = matches[0];
  if (
    matches.length !== 1 || selected === undefined ||
    (selected.operation !== "delivery.accept" && selected.operation !== "delivery.no-ship")
  ) {
    fail("recovery-owner", "Terminal Closure belongs to a nonterminal Activity");
  }
  if (selected.stage !== "completed" || selected.recovery !== null) {
    fail("recovery-owner", "Terminal Closure belongs to an unsettled logical Activity");
  }
  return selected;
}

function exactTerminalInvocationActivity(input: Readonly<{
  store: ControlRecordStore;
  operation: "delivery.accept" | "delivery.no-ship";
  activityId?: string;
  priorActivityIds?: readonly string[];
}>): DeliveryActivity | null {
  const prior = new Set(input.priorActivityIds ?? []);
  const matches = input.store.state().activities.filter((candidate) =>
    candidate.operation === input.operation &&
    (input.activityId === undefined
      ? !prior.has(candidate.id)
      : candidate.id === input.activityId));
  if (matches.length === 0) return null;
  if (matches.length !== 1) {
    fail("terminal-result", "Terminal invocation does not select one exact Activity", {
      operation: input.operation,
      activityId: input.activityId ?? null,
    });
  }
  return matches[0]!;
}

function assertSameActivity(left: DeliveryActivity, right: DeliveryActivity): void {
  if (left.id !== right.id || left.operation !== right.operation) {
    fail("activity-result", "Physical terminal disposition belongs to a different Activity");
  }
}

function selectedRecoveryActivity(store: ControlRecordStore): DeliveryActivity {
  const recoverable = exactRecoverableActivity(store);
  if (recoverable !== null) return recoverable;
  const terminal = terminalClosureSettlementActivity(store);
  if (terminal !== null) return terminal;
  fail("recovery-owner", "Recovery requires one exact retained Delivery Activity");
}

function recoveryDiagnostic(operation: DeliveryOperation): FoundationError {
  return new FoundationError(
    "lifecycle.runtime-mutation-v7.recovery-required",
    `${operation} remains at one exact retained recovery coordinate`,
    { retryable: true },
  );
}

function boundaryRepositoryCoordinate(
  store: ControlRecordStore,
  selection: "active" | "proposed",
): Readonly<{
  headCommit: string;
  headTree: string;
  repositoryContractDigest: `sha256:${string}`;
}> {
  const reference = selection === "active"
    ? store.state().subjects.activeBoundary
    : store.state().subjects.proposedBoundary;
  if (reference === null) {
    fail("repository-drift", `Delivery has no exact ${selection} Work Boundary coordinate`);
  }
  const boundary = store.getRevision(reference.id, reference.revision);
  if (
    boundary === null || boundary.recordKind !== "work-boundary" ||
    boundary.digest !== reference.digest
  ) {
    fail(
      "repository-drift",
      `${selection === "active" ? "Active" : "Proposed"} Work Boundary does not resolve its exact retained revision`,
    );
  }
  const basis = boundary.payload.basis;
  if (basis === null || typeof basis !== "object" || Array.isArray(basis)) {
    fail("repository-drift", "Selected Work Boundary lacks its exact repository basis");
  }
  const repositoryBasis = basis as Readonly<Record<string, unknown>>;
  return Object.freeze({
    headCommit: FoundationGitObjectSchema.parse(repositoryBasis.productBaseCommit),
    headTree: FoundationGitObjectSchema.parse(repositoryBasis.productBaseTree),
    repositoryContractDigest: FoundationSha256Schema.parse(
      repositoryBasis.repositoryContractDigest,
    ),
  });
}

function preparationOptions(
  configuration: FoundationInstalledRuntimeConfigurationV7,
  owners: MutationOwners,
  checkCellOperator?: FoundationCheckCellOperatorV1,
): FoundationPreparationRuntimeV7Options {
  return Object.freeze({
    agentOperation: Object.freeze({
      ...owners.agentOperation,
      openInstalled: owners.agentOperation?.openInstalled ?? bindFoundationInstalledAgentRuntimeV1(configuration),
      now: owners.now,
    }),
    boundaryFinalization: Object.freeze({
      machineHome: configuration.machineHome,
      now: owners.now,
      checkOperation: Object.freeze({ now: owners.now }),
      ...(checkCellOperator === undefined ? {} : { checkCellOperator }),
    }),
  });
}

function candidateOptions(
  configuration: FoundationInstalledRuntimeConfigurationV7,
  owners: MutationOwners,
  checkCellOperator?: FoundationCheckCellOperatorV1,
): FoundationCandidateAgentRuntimeV7Options {
  return Object.freeze({
    agentOperation: Object.freeze({
      ...owners.agentOperation,
      openInstalled: owners.agentOperation?.openInstalled ?? bindFoundationInstalledAgentRuntimeV1(configuration),
      now: owners.now,
    }),
    candidateFinalization: Object.freeze({ now: owners.now }),
    boundaryFinalization: Object.freeze({
      now: owners.now,
      checkOperation: Object.freeze({ now: owners.now }),
      ...(checkCellOperator === undefined ? {} : { checkCellOperator }),
    }),
  });
}

function evaluationOptions(
  configuration: FoundationInstalledRuntimeConfigurationV7,
  activityId: string,
  owners: MutationOwners,
  checkCellOperator?: FoundationCheckCellOperatorV1,
): FoundationEvaluationRuntimeV7Options {
  return Object.freeze({
    now: owners.now,
    createActivityId: () => activityId,
    preparation: Object.freeze({
      now: owners.now,
      createActivityId: () => activityId,
      checkOperation: Object.freeze({ now: owners.now }),
      ...(checkCellOperator === undefined ? {} : { checkCellOperator }),
    }),
    agentOperation: Object.freeze({
      ...owners.agentOperation,
      openInstalled: owners.agentOperation?.openInstalled ?? bindFoundationInstalledAgentRuntimeV1(configuration),
      now: owners.now,
    }),
    finalization: Object.freeze({ now: owners.now }),
  });
}

async function recoveryResult(input: Readonly<{
  request: FoundationRuntimeMutationRequest;
  store: ControlRecordStore;
  error: unknown;
  owners: MutationOwners;
  afterSequence: number;
  before?: MutationBefore;
  repositoryObservation?: "complete-current" | "identity-current";
}>): Promise<FoundationRuntimeOperationResult> {
  return await mutationResult({
    request: input.request,
    store: input.store,
    status: "recovery-required",
    error: input.error,
    observedAt: timestamp(input.owners),
    afterSequence: input.afterSequence,
    ...(input.before === undefined ? {} : { before: input.before }),
    ...(input.repositoryObservation === undefined
      ? {}
      : { repositoryObservation: input.repositoryObservation }),
  });
}

async function executePrepare(input: Readonly<{
  request: FoundationRuntimePrepareRequest;
  configuration: FoundationInstalledRuntimeConfigurationV7;
  owners: MutationOwners;
}>): Promise<FoundationRuntimeOperationResult> {
  let basis: Awaited<ReturnType<FoundationRuntimeMutationV7Preparation["preflight"]>>;
  try {
    basis = await input.owners.preparation.preflight({
        target: input.request.target,
        semanticMarkdown: input.request.input.semanticMarkdown,
        observedAt: timestamp(input.owners),
      });
  } catch (error) {
    // Preflight observes context only. This catch must end before Store
    // publication or any execution owner can begin an effect.
    if (!(error instanceof FoundationError) || error.repositoryChanged !== false || error.operationalStateChanged !== false) throw error;
    return await foundationPreparationRefusalResultV7({
      request: input.request,
      error,
      observedAt: timestamp(input.owners),
    });
  }
      await assertDisjointMachineAndTarget(input.configuration.machineHome, basis.epoch.repository);
      const deliveryId = `delivery-${input.owners.randomId()}`;
      const activityId = input.owners.createActivityId("delivery.prepare");
      const createdAt = timestamp(input.owners);
      const submittedAt = timestamp(input.owners);
      const startedAt = timestamp(input.owners);
      const attemptCreatedAt = timestamp(input.owners);
      let installedCheck: FoundationOpenedInstalledCheckRuntimeV1 | null = null;
      let opened: OpenedDeliveryControlRecordStore;
      try {
        if (input.owners.installedPreparation) {
          installedCheck = await openFoundationInstalledCheckRuntimeV1({ configuration: input.configuration, now: input.owners.now });
        }
        opened = await createDeliveryControlRecordStore({
          machineHome: input.configuration.machineHome, targetId: basis.epoch.contract.targetId,
          deliveryId, createdAt, runtimeActorId: RUNTIME_ID,
          ...(input.owners.preparation.open === undefined ? {} : {
            initializeBeforePublication: async (store: ControlRecordStore) => await input.owners.preparation.open!({
              store, configuration: selectFoundationProcessRuntimeConfigurationV7(input.configuration), activityId,
              runtimeId: RUNTIME_ID, agentId: AGENT_ID, submittedAt, startedAt, attemptCreatedAt, basis,
            }, preparationOptions(input.configuration, input.owners, installedCheck?.operator)),
          }),
        });
      } catch (error) {
        installedCheck?.close();
        throw error;
      }
      const store = opened.store;
      try {
        assertActiveStore(opened, "delivery.prepare");
        if (opened.initializationError !== undefined) throw opened.initializationError;
        const result = await input.owners.preparation.operate({
          store,
          configuration: selectFoundationProcessRuntimeConfigurationV7(input.configuration),
          activityId,
          runtimeId: RUNTIME_ID,
          agentId: AGENT_ID,
          submittedAt,
          startedAt,
          attemptCreatedAt,
          basis,
        }, preparationOptions(input.configuration, input.owners, installedCheck?.operator));
        if (result.activityId !== activityId || result.operation !== "delivery.prepare") {
          fail("activity-result", "Preparation owner returned a substituted Activity result");
        }
        assertSettledActivity(store, activityId, "delivery.prepare");
        return await mutationResult({
          request: input.request,
          store,
          status: "completed",
          observedAt: timestamp(input.owners),
          afterSequence: 0,
          submissionDiagnostic: executionReceiptSubmissionDiagnosticForActivity(store, activityId),
        });
      } catch (error) {
        const retained = optionalActivity(store, activityId, "delivery.prepare");
        const refusal = await completedPreIntentRefusal({
          store,
          activityId,
          operation: "delivery.prepare",
          error,
        });
        if (refusal !== null) {
          return await mutationResult({
            request: input.request,
            store,
            status: "refused",
            error: refusal,
            observedAt: timestamp(input.owners),
            afterSequence: 0,
          });
        }
        if (retained?.stage === "completed" && retained.recovery === null) {
          return await mutationResult({
            request: input.request,
            store,
            status: "completed",
            observedAt: timestamp(input.owners),
            afterSequence: 0,
            submissionDiagnostic: executionReceiptSubmissionDiagnosticForActivity(store, activityId),
          });
        }
        if (retained === null || retained.recovery === null) throw error;
        return await recoveryResult({
          request: input.request,
          store,
          error,
          owners: input.owners,
          afterSequence: 0,
        });
      } finally {
        installedCheck?.close();
        store.close();
      }
}

async function executeAgent(input: Readonly<{
  request: AgentRequest;
  configuration: FoundationInstalledRuntimeConfigurationV7;
  owners: MutationOwners;
}>): Promise<FoundationRuntimeOperationResult> {
  return await withDeliveryMutationLock(
    input,
    `delivery-${input.request.operation.slice("delivery.".length)}-mutation`,
    async () => {
      const epoch = await identityTarget(input.request.target, input.configuration);
      const repositoryObservation = "identity-current" as const;
      const opened = await openDeliveryControlRecordStore({
        machineHome: input.configuration.machineHome,
        targetId: epoch.contract.targetId,
        deliveryId: input.request.deliveryId,
      });
      const store = opened.store;
      const afterSequence = store.state().journal.eventCount;
      const before = mutationBefore(store, epoch.epoch.commit);
      let activityId: string | null = null;
      let installedCheck: FoundationOpenedInstalledCheckRuntimeV1 | null = null;
      try {
        assertActiveStore(opened, input.request.operation);
        const expectedGeneration = input.request.input.expectedGeneration;
        const currentGeneration = compileDeliveryGeneration({
          store,
          physical: Object.freeze({ disposition: "active", archiveManifestDigest: null }),
          repository: Object.freeze({
            headCommit: epoch.epoch.commit,
            headTree: epoch.epoch.tree,
            repositoryContractDigest: epoch.contract.digest,
          }),
        });
        if (currentGeneration.digest !== expectedGeneration) {
          return await mutationResult({
            request: input.request,
            store,
            status: "refused",
            error: new FoundationError(
              "lifecycle.read-model.generation-stale",
              "Director semantic input was composed against a different Delivery generation",
              { retryable: true },
            ),
            observedAt: timestamp(input.owners),
            afterSequence,
            before,
            repositoryObservation,
          });
        }
        boundaryRepositoryCoordinate(store, "active");
        activityId = input.owners.createActivityId(input.request.operation);
        const observedAt = timestamp(input.owners);
        if (
          input.request.operation === "delivery.evaluate" && input.owners.installedEvaluation ||
          (input.request.operation === "delivery.revise" || input.request.operation === "delivery.reaffirm") &&
            input.owners.installedCandidate
        ) {
          installedCheck = await openFoundationInstalledCheckRuntimeV1({
            configuration: input.configuration,
            now: input.owners.now,
          });
        }
        const result = input.request.operation === "delivery.evaluate"
          ? await input.owners.evaluation.evaluate({
              target: epoch.repository,
              store,
              contract: epoch.contract,
              configuration: selectFoundationProcessRuntimeConfigurationV7(input.configuration),
              semanticMarkdown: input.request.input.semanticMarkdown,
              directorId: epoch.contract.authority.principalId,
              agentId: AGENT_ID,
              runtimeId: RUNTIME_ID,
            }, evaluationOptions(input.configuration, activityId, input.owners, installedCheck?.operator))
          : await input.owners.candidate.operate({
              target: epoch.repository,
              store,
              configuration: selectFoundationProcessRuntimeConfigurationV7(input.configuration),
              activityId,
              operation: input.request.operation,
              runtimeId: RUNTIME_ID,
              agentId: AGENT_ID,
              opening: Object.freeze({
                semanticMarkdown: input.request.input.semanticMarkdown,
                submittedAt: observedAt,
                startedAt: observedAt,
                attemptCreatedAt: observedAt,
                directorId: epoch.contract.authority.principalId,
              }),
            }, candidateOptions(input.configuration, input.owners, installedCheck?.operator));
        if (result.activityId !== activityId || result.operation !== input.request.operation) {
          fail("activity-result", "Agent owner returned a substituted Activity result");
        }
        assertSettledActivity(store, activityId, input.request.operation);
        return await mutationResult({
          request: input.request,
          store,
          status: "completed",
          observedAt: timestamp(input.owners),
          afterSequence,
          before,
          submissionDiagnostic: executionReceiptSubmissionDiagnosticForActivity(store, activityId),
          repositoryObservation,
        });
      } catch (error) {
        if (activityId === null) throw error;
        const retained = optionalActivity(store, activityId, input.request.operation);
        const state = store.state();
        // The locked invocation has checked its generation and governing
        // Boundary, but context compilation can refuse before opening an
        // Activity. Report only a typed, unchanged pre-Activity boundary;
        // absence alone cannot classify an unknown or effect-bearing error.
        if (
          retained === null && error instanceof LifecycleError &&
          error.repositoryChanged === false && error.operationalStateChanged === false &&
          error.recoveryActions.length === 0 &&
          state.activities.every(({ recovery }) => recovery === null) &&
          state.journal.eventCount === afterSequence &&
          state.journal.headDigest === (before.controlHead?.digest ?? null)
        ) {
          return await mutationResult({
            request: input.request,
            store,
            status: "refused",
            error: new FoundationError(
              error.code,
              "The operation was refused before opening an Activity",
              { retryable: error.retryable },
            ),
            observedAt: timestamp(input.owners),
            afterSequence,
            before,
            repositoryObservation,
          });
        }
        const refusal = await completedPreIntentRefusal({
          store,
          activityId,
          operation: input.request.operation,
          error,
        });
        if (refusal !== null) {
          return await mutationResult({
            request: input.request,
            store,
            status: "refused",
            error: refusal,
            observedAt: timestamp(input.owners),
            afterSequence,
            before,
            repositoryObservation,
          });
        }
        if (retained?.stage === "completed" && retained.recovery === null) {
          return await mutationResult({
            request: input.request,
            store,
            status: "completed",
            observedAt: timestamp(input.owners),
            afterSequence,
            before,
            submissionDiagnostic: executionReceiptSubmissionDiagnosticForActivity(store, activityId),
            repositoryObservation,
          });
        }
        if (retained === null || retained.recovery === null) throw error;
        return await recoveryResult({
          request: input.request,
          store,
          error,
          owners: input.owners,
          afterSequence,
          before,
          repositoryObservation,
        });
      } finally {
        installedCheck?.close();
        store.close();
      }
    },
  );
}

async function executeIntegration(input: Readonly<{
  request: FoundationRuntimeIntegrateRequest;
  configuration: FoundationInstalledRuntimeConfigurationV7;
  owners: MutationOwners;
}>): Promise<FoundationRuntimeOperationResult> {
  return await withDeliveryMutationLock(input, "delivery-integrate-mutation", async () => {
    const epoch = await identityTarget(input.request.target, input.configuration);
    const opened = await openDeliveryControlRecordStore({ machineHome: input.configuration.machineHome,
      targetId: epoch.contract.targetId, deliveryId: input.request.deliveryId });
    const store = opened.store;
    const afterSequence = store.state().journal.eventCount;
    const before = mutationBefore(store, epoch.epoch.commit);
    const repositoryObservation = "identity-current" as const;
    let activityId: string | null = null;
    try {
      assertActiveStore(opened, input.request.operation);
      const generation = compileDeliveryGeneration({ store,
        physical: { disposition: "active", archiveManifestDigest: null },
        repository: { headCommit: epoch.epoch.commit, headTree: epoch.epoch.tree, repositoryContractDigest: epoch.contract.digest } });
      if (generation.digest !== input.request.input.expectedGeneration) {
        return await mutationResult({ request: input.request, store, status: "refused",
          error: new FoundationError("lifecycle.read-model.generation-stale", "Integration was requested against a different Delivery generation", { retryable: true }),
          observedAt: timestamp(input.owners), afterSequence, before, repositoryObservation });
      }
      activityId = input.owners.createActivityId("delivery.integrate");
      const result = await input.owners.integration.operate({ target: epoch.repository, machineHome: input.configuration.machineHome,
        store, activityId, runtimeId: RUNTIME_ID }, { now: input.owners.now });
      if (result.activityId !== activityId || result.operation !== input.request.operation) fail("activity-result", "Integration owner returned a substituted Activity result");
      assertSettledActivity(store, activityId, input.request.operation);
      return await mutationResult({ request: input.request, store, status: "completed",
        observedAt: timestamp(input.owners), afterSequence, before, repositoryObservation });
    } catch (error) {
      const retained = activityId === null ? null : optionalActivity(store, activityId, input.request.operation);
      if (retained?.stage === "completed" && retained.recovery === null) {
        return await mutationResult({ request: input.request, store, status: "completed",
          observedAt: timestamp(input.owners), afterSequence, before, repositoryObservation });
      }
      if (retained === null || retained.recovery === null) throw error;
      return await recoveryResult({ request: input.request, store, error, owners: input.owners,
        afterSequence, before, repositoryObservation });
    } finally {
      store.close();
    }
  });
}

/** Resource Stop is independent of installed execution defaults and the long writer lock. */
export async function executeFoundationWorkStop(input: Readonly<{
  request: FoundationRuntimeWorkRequest;
  machineHome: string;
  now: () => string;
}>): Promise<FoundationRuntimeOperationResult> {
  if (input.request.input.action !== "stop") fail("work-action", "The stop owner accepts only an exact resource stop");
  const request = input.request;
  const selection = input.request.input;
  const epoch = await identityTarget(request.target, { machineHome: input.machineHome });
  const opened = await openDeliveryControlRecordStore({ machineHome: input.machineHome,
    targetId: epoch.contract.targetId, deliveryId: request.deliveryId });
  const store = opened.store;
  try {
    assertActiveStore(opened, request.operation);
    const observed = await observeFoundationRepositoryIdentityForRead(request.target, FoundationRfc3339Schema.parse(input.now()));
    if (observed.repository.targetId !== epoch.contract.targetId) fail("target-substitution", "Stop requires its exact Target identity");
    const requestStop = (selectedStore: ControlRecordStore) => selectedStore.requestWorkDelegationStop({
      delegation: selection.delegation, requestedBy: epoch.contract.authority.principalId,
      requestedAt: FoundationRfc3339Schema.parse(input.now()) });
    const stopped = requestStop(store);
    // Capture the complete known acknowledgment before any awaited lock, file
    // observation or optional Journal fold can fail or observe later work.
    let acknowledgment = foundationWorkStopAcknowledgmentV7({ request, identity: store.identity,
      acknowledgment: stopped, observed, observedAt: FoundationRfc3339Schema.parse(input.now()) });
    if (stopped.disposition === "pending" && stopped.observation.state.activities.every(activity =>
      activity.stage === "completed" && activity.recovery === null)) {
      try {
        acknowledgment = await withDeliveryOperationLock({ machineHome: input.machineHome,
          targetId: epoch.contract.targetId, deliveryId: request.deliveryId }, "delivery-work-stop", async () => {
          const current = await openDeliveryControlRecordStore({ machineHome: input.machineHome,
            targetId: epoch.contract.targetId, deliveryId: request.deliveryId });
          try {
            let captured = requestStop(current.store);
            const beforeFold = foundationWorkStopAcknowledgmentV7({ request, identity: current.store.identity,
              acknowledgment: captured, observed, observedAt: FoundationRfc3339Schema.parse(input.now()) });
            if (captured.disposition === "pending" && captured.observation.state.activities.every(activity =>
              activity.stage === "completed" && activity.recovery === null)) {
              current.store.append(compileWorkDelegationStopAppend({ request: captured.request,
                runtimeId: RUNTIME_ID, stoppedAt: FoundationRfc3339Schema.parse(input.now()) }));
              captured = requestStop(current.store);
            }
            return foundationWorkStopAcknowledgmentV7({ request, identity: current.store.identity,
              acknowledgment: captured, observed, observedAt: FoundationRfc3339Schema.parse(input.now()),
              before: { repositoryCommit: beforeFold.changes.repository.afterCommit,
                candidate: beforeFold.changes.candidate.after, controlHead: beforeFold.changes.control.afterHead } });
          } finally { current.store.close(); }
        });
      } catch (error) {
        if (!(error instanceof FoundationError) || error.code !== "operation.busy") {
          acknowledgment = foundationWorkStopFoldFailureV7({ request, acknowledgment, error });
        }
      }
    }
    return acknowledgment;
  } finally { store.close(); }
}

async function executeWork(input: Readonly<{
  request: FoundationRuntimeWorkRequest;
  configuration: FoundationInstalledRuntimeConfigurationV7;
  owners: MutationOwners;
}>): Promise<FoundationRuntimeOperationResult> {
  if (input.request.input.action === "stop") return executeFoundationWorkStop({ request: input.request,
    machineHome: input.configuration.machineHome, now: input.owners.now });
  const choice = input.request.input;
  return withDeliveryMutationLock(input, "delivery-work", async () => {
    let epoch = await identityTarget(input.request.target, input.configuration);
    const opened = await openDeliveryControlRecordStore({ machineHome: input.configuration.machineHome,
      targetId: epoch.contract.targetId, deliveryId: input.request.deliveryId });
    const store = opened.store;
    const before = mutationBefore(store, epoch.epoch.commit);
    const afterSequence = store.state().journal.eventCount;
    const physical = { disposition: "active" as const, archiveManifestDigest: null };
    try {
      assertActiveStore(opened, input.request.operation);
      const generation = compileDeliveryGeneration({ store, physical, repository: {
        headCommit: epoch.epoch.commit, headTree: epoch.epoch.tree, repositoryContractDigest: epoch.contract.digest } });
      if (generation.digest !== choice.expectedGeneration) {
        return await mutationResult({ request: input.request, store, status: "refused", before, afterSequence,
          observedAt: timestamp(input.owners), repositoryObservation: "identity-current",
          error: new FoundationError("lifecycle.read-model.generation-stale",
            "Resource permission was requested against a different Delivery generation", { retryable: true }) });
      }
      if (choice.action === "set") {
        const selectAgent = (operation: "delivery.continue" | "delivery.evaluate") => {
          const selected = operation === "delivery.continue" ? choice.agentChoices.builder : choice.agentChoices.reviewer;
          return selected === null ? null : selectWorkDelegationAgentResources({ operation,
            configuration: { ...selectFoundationProcessRuntimeConfigurationV7(input.configuration), ...selected } });
        };
        const grant = compileWorkDelegation({ store, directorId: epoch.contract.authority.principalId,
          runtimeId: RUNTIME_ID, submittedAt: timestamp(input.owners),
          semanticMarkdown: ["# Work Delegation", "", "Permit finite reversible labor under the admitted mandate.", "",
            `Permitted operations: ${choice.allowedOperations.join(", ")}.`,
            `Delivery lifetime ceilings: ${choice.ceilings.operations} operations; ${choice.ceilings.agentAttempts} Agent Attempts; ${choice.ceilings.reservedCellWallTimeMs} reserved Cell milliseconds.`,
            `Expiry: ${choice.expiresAt ?? "none"}.`, "",
            "Keep the exact linked standing directions. Finish a reserved operation before stopping.", ""].join("\n"),
          allowedOperations: choice.allowedOperations, directions: choice.directions,
          agentSelections: { builder: selectAgent("delivery.continue"), reviewer: selectAgent("delivery.evaluate") },
          ceilings: choice.ceilings, expiresAt: choice.expiresAt });
        store.appendBatch(grant.appends);
        return await mutationResult({ request: input.request, store, status: "completed", before, afterSequence,
          observedAt: timestamp(input.owners), repositoryObservation: "identity-current",
          work: { kind: "work-control", action: "set", delegation: { kind: "work-delegation",
            id: grant.revision.recordId, revision: grant.revision.revision, digest: grant.revision.digest },
          eventProjection: "journal-coordinates-only", completedOperations: 0, lastActivity: null,
          stop: null, reason: "delegation-set" } });
      }
      const current = store.state().delegation.current;
      if (current === null || canonicalJson({ kind: "work-delegation", ...current.reference }) !== canonicalJson(choice.delegation)) {
        return await mutationResult({ request: input.request, store, status: "refused", before, afterSequence,
          observedAt: timestamp(input.owners), repositoryObservation: "identity-current",
          error: new FoundationError("lifecycle.work-delegation.current-subject",
            "Run requires the exact current Work Delegation") });
      }
      const result = await runWorkDelegation({ store, runtimeId: RUNTIME_ID,
        observe: async () => {
          epoch = await identityTarget(input.request.target, input.configuration);
          if (epoch.contract.targetId !== store.identity.targetId) fail("target-substitution", "Work must retain its exact Target");
          return { physical, contract: epoch.contract,
            configuration: selectFoundationProcessRuntimeConfigurationV7(input.configuration) };
        },
        dispatch: async dispatch => {
          if (dispatch.operation === "delivery.integrate") return input.owners.integration.operate({
            target: epoch.repository, machineHome: input.configuration.machineHome, store,
            activityId: dispatch.activityId, runtimeId: RUNTIME_ID, reservation: dispatch.reservation }, { now: input.owners.now });
          const brief = dispatch.standingBrief;
          let installedCheck: FoundationOpenedInstalledCheckRuntimeV1 | null = null;
          try {
            if (dispatch.operation === "delivery.evaluate" && input.owners.installedEvaluation) {
              installedCheck = await openFoundationInstalledCheckRuntimeV1({ configuration: input.configuration, now: input.owners.now });
            }
            const result = dispatch.operation === "delivery.evaluate"
              ? await input.owners.evaluation.evaluate({ target: epoch.repository, store, contract: dispatch.observation.contract,
                  configuration: dispatch.observation.configuration, semanticMarkdown: brief.semanticMarkdown,
                  directorId: brief.semanticAuthor.id, agentId: AGENT_ID, runtimeId: RUNTIME_ID,
                  reservation: dispatch.reservation },
                evaluationOptions(input.configuration, dispatch.activityId, input.owners, installedCheck?.operator))
              : await input.owners.candidate.operate({ target: epoch.repository, store,
                  configuration: dispatch.observation.configuration, activityId: dispatch.activityId,
                  operation: dispatch.operation, runtimeId: RUNTIME_ID, agentId: AGENT_ID,
                  opening: { semanticMarkdown: brief.semanticMarkdown, submittedAt: brief.createdAt,
                    startedAt: dispatch.startedAt, attemptCreatedAt: dispatch.startedAt,
                    directorId: brief.semanticAuthor.id, reservation: dispatch.reservation } },
                candidateOptions(input.configuration, input.owners));
            if (result.operation !== dispatch.operation) {
              fail("work-operation-substitution", "Work must return the exact reserved operation");
            }
            return { activityId: result.activityId, operation: dispatch.operation };
          } finally { installedCheck?.close(); }
        },
      }, { now: input.owners.now, createActivityId: input.owners.createActivityId });
      const needsRecovery = store.state().activities.some(activity => activity.recovery !== null || activity.stage !== "completed");
      return await mutationResult({ request: input.request, store,
        status: needsRecovery ? "recovery-required" : result.diagnostic === null ? "completed" : "refused",
        before, afterSequence, observedAt: timestamp(input.owners), repositoryObservation: "identity-current",
        ...(result.diagnostic === null ? {} : { error: new FoundationError(result.diagnostic.code,
          "The foreground work request stopped at its retained boundary", { retryable: result.diagnostic.retryable }) }),
        work: { kind: "work-control", action: "run", delegation: choice.delegation,
          eventProjection: "journal-coordinates-only", completedOperations: result.completedOperations,
          lastActivity: result.latestActivity, stop: null, reason: result.stopReason } });
    } finally { store.close(); }
  });
}

async function executeAdmission(input: Readonly<{
  request: FoundationRuntimeAdmitRequest;
  context: Readonly<{ authorityCredential?: FoundationAuthorityCredential }>;
  configuration: FoundationInstalledRuntimeConfigurationV7;
  owners: MutationOwners;
  invocationPrivateGate?: FoundationInvocationPrivateAuthorizationGateV1;
}>): Promise<FoundationRuntimeOperationResult> {
  return await withDeliveryMutationLock(
    input,
    "delivery-admit-mutation",
    async () => {
      const privateClaim = input.invocationPrivateGate === undefined
        ? null
        : invocationPrivateClaimController(
            await acquireInvocationPrivateClaim(input.invocationPrivateGate),
          );
      try {
        privateClaim?.assertRequest(input.request);
        const epoch = await identityTarget(input.request.target, input.configuration);
        const opened = await openDeliveryControlRecordStore({
          machineHome: input.configuration.machineHome,
          targetId: epoch.contract.targetId,
          deliveryId: input.request.deliveryId,
        });
        const store = opened.store;
        try {
          assertActiveStore(opened, "delivery.admit");
          const afterSequence = store.state().journal.eventCount;
          const before = mutationBefore(store, epoch.epoch.commit);
          if (
            privateClaim !== null &&
            !privateClaim.generationMatches(invocationPrivateGeneration(store, epoch))
          ) {
            await privateClaim.refuse();
            return await mutationResult({
              request: input.request,
              store,
              status: "refused",
              error: staleInvocationPrivateGeneration(),
              observedAt: timestamp(input.owners),
              afterSequence,
              before,
              repositoryObservation: "identity-current",
            });
          }
          boundaryRepositoryCoordinate(store, "proposed");
          const priorActivityIds = Object.freeze(store.state().activities.map(({ id }) => id));
          try {
            const outcome = await input.owners.admission.admit({
              target: epoch.repository,
              machineHome: input.configuration.machineHome,
              store,
              authorityHome: input.configuration.machineHome,
              authorityCredential: mutationAuthorityCredential(input.context.authorityCredential),
              runtimeId: RUNTIME_ID,
            }, {
              now: input.owners.now,
              withDeliveryLock: async (_selection, _operation, action) => await action(),
              ...(privateClaim === null ? {} : {
                beforeAuthenticate: privateClaim.beforeAuthenticate,
                onStage: async (stage) => {
                  if (stage === "opening-committed") {
                    await privateClaim.openingCommitted();
                  }
                },
              }),
            });
            if (privateClaim !== null && !privateClaim.isCommitted()) {
              fail(
                "invocation-private-claim",
                "Invocation-private admission returned without one durable claimed Decision opening",
              );
            }
            return await admissionResult({
              request: input.request,
              store,
              outcome,
              owners: input.owners,
              afterSequence,
              before,
              priorActivityIds,
            });
          } catch (error) {
            await privateClaim?.refuse();
            const retained = newOperationActivity({
              store,
              operation: "delivery.admit",
              priorActivityIds,
            });
            if (retained?.stage === "completed" && retained.recovery === null) {
              return await mutationResult({
                request: input.request,
                store,
                status: "completed",
                observedAt: timestamp(input.owners),
                afterSequence,
                before,
                repositoryObservation: "identity-current",
              });
            }
            if (retained === null || retained.recovery === null) throw error;
            return await recoveryResult({
              request: input.request,
              store,
              error,
              owners: input.owners,
              afterSequence,
              before,
              repositoryObservation: "identity-current",
            });
          }
        } finally {
          store.close();
        }
      } catch (error) {
        await privateClaim?.refuse();
        throw error;
      }
    },
  );
}

async function admissionResult(input: Readonly<{
  request: FoundationRuntimeAdmitRequest | FoundationRuntimeRecoverRequest;
  store: ControlRecordStore;
  outcome: FoundationAdmissionV7Result;
  owners: MutationOwners;
  afterSequence: number;
  before: MutationBefore;
  expectedActivityId?: string;
  priorActivityIds?: readonly string[];
}>): Promise<FoundationRuntimeOperationResult> {
  if (
    (input.expectedActivityId !== undefined && input.outcome.activityId !== input.expectedActivityId) ||
    (input.priorActivityIds ?? []).includes(input.outcome.activityId)
  ) {
    fail("admission-result", "Admission owner returned a substituted or historical Activity result");
  }
  const selected = activity(input.store, input.outcome.activityId, "delivery.admit");
  const recoveryRequired = input.outcome.status === "recovery-required";
  if (recoveryRequired !== (selected.recovery !== null)) {
    fail("admission-result", "Admission outcome differs from its reducer-derived recovery coordinate");
  }
  if (!recoveryRequired && selected.stage !== "completed") {
    fail("admission-result", "Settled admission did not complete its exact Activity");
  }
  return await mutationResult({
    request: input.request,
    store: input.store,
    status: recoveryRequired ? "recovery-required" : "completed",
    ...(recoveryRequired ? { error: recoveryDiagnostic("delivery.admit") } : {}),
    observedAt: timestamp(input.owners),
    afterSequence: input.afterSequence,
    before: input.before,
    repositoryObservation: "identity-current",
  });
}

async function concludeTerminalMutation(input: Readonly<{
  request: TerminalRequest | FoundationRuntimeRecoverRequest;
  configuration: FoundationInstalledRuntimeConfigurationV7;
  opened: OpenedDeliveryControlRecordStore;
  afterSequence: number;
  before: MutationBefore;
  owners: MutationOwners;
  expectedOperation: "delivery.accept" | "delivery.no-ship";
  expectedActivityId?: string;
  priorActivityIds?: readonly string[];
  invoke(store: ControlRecordStore): Promise<FoundationTerminalV7Result>;
}>): Promise<FoundationRuntimeOperationResult> {
  const identity = input.opened.identity;
  const original = input.opened.store;
  let outcome: FoundationTerminalV7Result | null = null;
  let failure: unknown = null;
  try {
    outcome = await input.invoke(original);
  } catch (error) {
    failure = error;
  } finally {
    original.close();
  }

  const reopened = await openDeliveryControlRecordStore({
    machineHome: input.configuration.machineHome,
    targetId: identity.targetId,
    deliveryId: identity.processId,
  });
  try {
    const physical: DeliveryControlPhysicalDisposition = Object.freeze({
      disposition: reopened.disposition,
      archiveManifestDigest: reopened.archiveManifestDigest,
    });
    const selected = exactTerminalInvocationActivity({
      store: reopened.store,
      operation: input.expectedOperation,
      ...(input.expectedActivityId === undefined
        ? { priorActivityIds: input.priorActivityIds ?? Object.freeze([]) }
        : { activityId: input.expectedActivityId }),
    });
    if (failure !== null) {
      if (selected === null) throw failure;
      const closure = terminalClosureSettlementActivity(reopened.store);
      if (closure !== null) assertSameActivity(selected, closure);
      if (reopened.disposition === "archived") {
        if (closure === null) throw failure;
        return await mutationResult({
          request: input.request,
          store: reopened.store,
          status: "completed",
          observedAt: timestamp(input.owners),
          afterSequence: input.afterSequence,
          before: input.before,
          physical,
          repositoryObservation: "identity-current",
        });
      }
      const recoverable = exactRecoverableActivity(
        reopened.store,
        selected.id,
        selected.operation,
      );
      if (recoverable === null && closure === null) throw failure;
      return await mutationResult({
        request: input.request,
        store: reopened.store,
        status: "recovery-required",
        error: failure,
        observedAt: timestamp(input.owners),
        afterSequence: input.afterSequence,
        before: input.before,
        physical,
        repositoryObservation: "identity-current",
      });
    }
    if (outcome === null) fail("terminal-result", "Terminal owner returned no exact outcome");
    if (selected === null) {
      fail("terminal-result", "Terminal owner returned a result without a new exact Activity");
    }
    const closure = terminalClosureSettlementActivity(reopened.store);
    if (closure !== null) assertSameActivity(selected, closure);
    if (
      outcome.activityId !== selected.id ||
      (outcome.decisionKind === "accept" ? "delivery.accept" : "delivery.no-ship") !==
        selected.operation
    ) {
      fail("terminal-result", "Terminal owner returned a substituted Activity result");
    }
    if (
      outcome.status === "completed" &&
      (reopened.disposition !== "archived" || closure === null)
    ) {
      fail("terminal-archive", "Completed terminal disposition did not archive the Control Record Store");
    }
    if (outcome.status !== "completed" && reopened.disposition !== "active") {
      fail("terminal-archive", "Incomplete terminal disposition cannot archive the Control Record Store");
    }
    const recoveryRequired = outcome.status === "recovery-required";
    if (recoveryRequired !== (selected.recovery !== null)) {
      fail("terminal-result", "Terminal outcome differs from its reducer-derived recovery coordinate");
    }
    if (outcome.status === "failed" && selected.stage !== "completed") {
      fail("terminal-result", "Failed terminal outcome did not complete its exact Activity");
    }
    return await mutationResult({
      request: input.request,
      store: reopened.store,
      status: recoveryRequired ? "recovery-required" : "completed",
      ...(recoveryRequired ? { error: recoveryDiagnostic(selected.operation) } : {}),
      observedAt: timestamp(input.owners),
      afterSequence: input.afterSequence,
      before: input.before,
      physical,
      repositoryObservation: "identity-current",
    });
  } finally {
    reopened.store.close();
  }
}

async function executeTerminal(input: Readonly<{
  request: TerminalRequest;
  context: Readonly<{ authorityCredential?: FoundationAuthorityCredential }>;
  configuration: FoundationInstalledRuntimeConfigurationV7;
  owners: MutationOwners;
  invocationPrivateGate?: FoundationInvocationPrivateAuthorizationGateV1;
}>): Promise<FoundationRuntimeOperationResult> {
  return await withDeliveryMutationLock(
    input,
    "delivery-terminal-mutation",
    async () => {
      const privateClaim = input.invocationPrivateGate === undefined
        ? null
        : invocationPrivateClaimController(
            await acquireInvocationPrivateClaim(input.invocationPrivateGate),
          );
      try {
        privateClaim?.assertRequest(input.request);
        const epoch = await identityTarget(input.request.target, input.configuration);
        const opened = await openDeliveryControlRecordStore({
          machineHome: input.configuration.machineHome,
          targetId: epoch.contract.targetId,
          deliveryId: input.request.deliveryId,
        });
        let transferred = false;
        let reclamationObserver: Awaited<ReturnType<
          typeof openFoundationInstalledReclamationObserverV1
        >> | null = null;
        try {
          assertActiveStore(opened, input.request.operation);
          const afterSequence = opened.store.state().journal.eventCount;
          const before = mutationBefore(opened.store, epoch.epoch.commit);
          if (
            privateClaim !== null &&
            !privateClaim.generationMatches(invocationPrivateGeneration(opened.store, epoch))
          ) {
            await privateClaim.refuse();
            return await mutationResult({
              request: input.request,
              store: opened.store,
              status: "refused",
              error: staleInvocationPrivateGeneration(),
              observedAt: timestamp(input.owners),
              afterSequence,
              before,
              repositoryObservation: "identity-current",
            });
          }
          if (input.request.operation === "delivery.accept") {
            boundaryRepositoryCoordinate(opened.store, "active");
          }
          const priorActivityIds = Object.freeze(
            opened.store.state().activities.map(({ id }) => id),
          );
          const authorityCredential = mutationAuthorityCredential(input.context.authorityCredential);
          if (input.owners.installedTerminal) {
            reclamationObserver = await openFoundationInstalledReclamationObserverV1({
              configuration: input.configuration,
              now: input.owners.now,
            });
          }
          try {
            transferred = true;
            const result = await concludeTerminalMutation({
              request: input.request,
              configuration: input.configuration,
              opened,
              afterSequence,
              before,
              owners: input.owners,
              expectedOperation: input.request.operation,
              priorActivityIds,
              invoke: async (store) => input.request.operation === "delivery.accept"
                ? await input.owners.terminal.accept({
                    target: epoch.repository,
                    machineHome: input.configuration.machineHome,
                    store,
                    authorityHome: input.configuration.machineHome,
                    authorityCredential,
                    runtimeId: RUNTIME_ID,
                  }, {
                    now: input.owners.now,
                    withDeliveryLock: async (_selection, _operation, action) => await action(),
                    ...(privateClaim === null ? {} : {
                      beforeAuthenticate: privateClaim.beforeAuthenticate,
                      onStage: async (stage) => {
                        if (stage === "opening-committed") {
                          await privateClaim.openingCommitted();
                        }
                      },
                    }),
                    ...(reclamationObserver === null ? {} : {
                      observeReclamationHandoff: async (selected) =>
                        reclamationObserver!.observeTerminalReclamation(selected),
                    }),
                  })
                : await input.owners.terminal.noShip({
                    target: epoch.repository,
                    machineHome: input.configuration.machineHome,
                    store,
                    authorityHome: input.configuration.machineHome,
                    authorityCredential,
                    semanticMarkdown: input.request.input.semanticMarkdown,
                    runtimeId: RUNTIME_ID,
                  }, {
                    now: input.owners.now,
                    withDeliveryLock: async (_selection, _operation, action) => await action(),
                    ...(privateClaim === null ? {} : {
                      beforeAuthenticate: privateClaim.beforeAuthenticate,
                      onStage: async (stage) => {
                        if (stage === "opening-committed") {
                          await privateClaim.openingCommitted();
                        }
                      },
                    }),
                    ...(reclamationObserver === null ? {} : {
                      observeReclamationHandoff: async (selected) =>
                        reclamationObserver!.observeTerminalReclamation(selected),
                    }),
                  }),
            });
            if (privateClaim !== null && !privateClaim.isCommitted()) {
              fail(
                "invocation-private-claim",
                "Invocation-private terminal operation returned without one durable claimed Decision opening",
              );
            }
            return result;
          } catch (error) {
            await privateClaim?.refuse();
            throw error;
          }
        } finally {
          reclamationObserver?.close();
          if (!transferred) opened.store.close();
        }
      } catch (error) {
        await privateClaim?.refuse();
        throw error;
      }
    },
  );
}

async function recoverAgent(input: Readonly<{
  request: FoundationRuntimeRecoverRequest;
  selected: DeliveryActivity;
  epoch: FoundationLoadedRepositoryEpoch | FoundationLoadedRepositoryIdentityEpoch;
  configuration: FoundationInstalledRuntimeConfigurationV7;
  store: ControlRecordStore;
  owners: MutationOwners;
  checkCellOperator?: FoundationCheckCellOperatorV1;
}>): Promise<void> {
  const operation = input.selected.operation;
  let result;
  if (operation === "delivery.prepare") {
    result = await input.owners.preparation.recover({
      target: input.epoch.repository,
      store: input.store,
      configuration: selectFoundationProcessRuntimeConfigurationV7(input.configuration),
      activityId: input.selected.id,
      runtimeId: RUNTIME_ID,
      observedAt: timestamp(input.owners),
    }, preparationOptions(input.configuration, input.owners, input.checkCellOperator));
  } else if (
    operation === "delivery.continue" || operation === "delivery.revise" ||
    operation === "delivery.reaffirm"
  ) {
    result = await input.owners.candidate.recover({
      target: input.epoch.repository,
      store: input.store,
      configuration: selectFoundationProcessRuntimeConfigurationV7(input.configuration),
      activityId: input.selected.id,
      operation,
    }, candidateOptions(input.configuration, input.owners, input.checkCellOperator));
  } else if (operation === "delivery.evaluate") {
    result = await input.owners.evaluation.recover({
      target: input.epoch.repository,
      store: input.store,
      contract: input.epoch.contract,
      configuration: selectFoundationProcessRuntimeConfigurationV7(input.configuration),
      activityId: input.selected.id,
      runtimeId: RUNTIME_ID,
    }, evaluationOptions(input.configuration, input.selected.id, input.owners, input.checkCellOperator));
  } else {
    fail("recovery-owner", `${operation} is not an Agent Activity recovery route`);
  }
  if (result.activityId !== input.selected.id || result.operation !== operation) {
    fail("activity-result", "Agent recovery owner returned a substituted Activity result");
  }
  assertSettledActivity(input.store, input.selected.id, operation);
}

async function executeRecover(input: Readonly<{
  request: FoundationRuntimeRecoverRequest;
  configuration: FoundationInstalledRuntimeConfigurationV7;
  owners: MutationOwners;
}>): Promise<FoundationRuntimeOperationResult> {
  return await withDeliveryMutationLock(
    input,
    "delivery-recover-mutation",
    async () => {
      const identity = await identityTarget(input.request.target, input.configuration);
      const opened = await openDeliveryControlRecordStore({
        machineHome: input.configuration.machineHome,
        targetId: identity.contract.targetId,
        deliveryId: input.request.deliveryId,
      });
      const store = opened.store;
      let transferred = false;
      let installedCheck: FoundationOpenedInstalledCheckRuntimeV1 | null = null;
      try {
        assertActiveStore(opened, "delivery.recover");
        const selected = selectedRecoveryActivity(store);
        if (
          selected.operation === "delivery.prepare" && input.owners.installedPreparation ||
          selected.operation === "delivery.evaluate" && input.owners.installedEvaluation ||
          (selected.operation === "delivery.revise" || selected.operation === "delivery.reaffirm") &&
            input.owners.installedCandidate
        ) {
          installedCheck = await openFoundationInstalledCheckRuntimeV1({
            configuration: input.configuration,
            now: input.owners.now,
          });
        }
        const epoch = identity;
        if (epoch.contract.targetId !== store.identity.targetId) {
          fail("recovery-owner", "Recovery target differs from the retained Delivery target");
        }
        const repositoryObservation = "identity-current" as const;
        const afterSequence = store.state().journal.eventCount;
        const before = mutationBefore(store, epoch.epoch.commit);
        if (selected.operation === "delivery.accept" || selected.operation === "delivery.no-ship") {
          const reclamationObserver = input.owners.installedTerminal
            ? await openFoundationInstalledReclamationObserverV1({
                configuration: input.configuration,
                now: input.owners.now,
              })
            : null;
          try {
            transferred = true;
            return await concludeTerminalMutation({
              request: input.request,
              configuration: input.configuration,
              opened,
              afterSequence,
              before,
              owners: input.owners,
              expectedOperation: selected.operation,
              expectedActivityId: selected.id,
              invoke: async (selectedStore) => await input.owners.terminal.recover({
                target: epoch.repository,
                machineHome: input.configuration.machineHome,
                store: selectedStore,
                runtimeId: RUNTIME_ID,
                activityId: selected.id,
              }, {
                now: input.owners.now,
                withDeliveryLock: async (_selection, _operation, action) => await action(),
                ...(reclamationObserver === null ? {} : {
                  observeReclamationHandoff: async (selectedInput) =>
                    reclamationObserver.observeTerminalReclamation(selectedInput),
                }),
              }),
            });
          } finally {
            reclamationObserver?.close();
          }
        }
        try {
          if (selected.operation === "delivery.admit") {
            const outcome = await input.owners.admission.recover({
              target: epoch.repository,
              machineHome: input.configuration.machineHome,
              store,
              runtimeId: RUNTIME_ID,
              activityId: selected.id,
            }, {
              now: input.owners.now,
              withDeliveryLock: async (_selection, _operation, action) => await action(),
            });
            return await admissionResult({
              request: input.request,
              store,
              outcome,
              owners: input.owners,
              afterSequence,
              before,
              expectedActivityId: selected.id,
            });
          }
          if (selected.operation === "delivery.integrate") {
            const result = await input.owners.integration.recover({
              target: epoch.repository, machineHome: input.configuration.machineHome,
              store, activityId: selected.id, runtimeId: RUNTIME_ID,
            }, { now: input.owners.now });
            if (result.activityId !== selected.id || result.operation !== selected.operation) {
              fail("activity-result", "Integration recovery returned a substituted Activity result");
            }
            assertSettledActivity(store, selected.id, selected.operation);
          } else {
            await recoverAgent({
              request: input.request, selected, epoch, configuration: input.configuration,
              store, owners: input.owners, checkCellOperator: installedCheck?.operator,
            });
          }
          return await mutationResult({
            request: input.request,
            store,
            status: "completed",
            observedAt: timestamp(input.owners),
            afterSequence,
            before,
            submissionDiagnostic: executionReceiptSubmissionDiagnosticForActivity(
              store,
              selected.id,
            ),
            repositoryObservation,
          });
        } catch (error) {
          const retained = optionalActivity(store, selected.id, selected.operation);
          const refusal = (
            selected.operation === "delivery.prepare" ||
            selected.operation === "delivery.continue" ||
            selected.operation === "delivery.evaluate" ||
            selected.operation === "delivery.revise" ||
            selected.operation === "delivery.reaffirm"
          ) ? await completedPreIntentRefusal({
              store,
              activityId: selected.id,
              operation: selected.operation,
              error,
            }) : null;
          if (refusal !== null) {
            return await mutationResult({
              request: input.request,
              store,
              status: "refused",
              error: refusal,
              observedAt: timestamp(input.owners),
              afterSequence,
              before,
              repositoryObservation,
            });
          }
          if (retained?.stage === "completed" && retained.recovery === null) {
            return await mutationResult({
              request: input.request,
              store,
              status: "completed",
              observedAt: timestamp(input.owners),
              afterSequence,
              before,
              submissionDiagnostic: executionReceiptSubmissionDiagnosticForActivity(
                store,
                selected.id,
              ),
              repositoryObservation,
            });
          }
          if (retained === null || retained.recovery === null) throw error;
          return await recoveryResult({
            request: input.request,
            store,
            error,
            owners: input.owners,
            afterSequence,
            before,
            repositoryObservation,
          });
        }
      } finally {
        installedCheck?.close();
        if (!transferred) store.close();
      }
    },
  );
}

function prepareRequest(
  request: FoundationRuntimeMutationRequest,
): request is FoundationRuntimePrepareRequest {
  return request.operation === "delivery.prepare";
}

function agentRequest(request: FoundationRuntimeMutationRequest): request is AgentRequest {
  return request.operation === "delivery.continue" || request.operation === "delivery.evaluate" ||
    request.operation === "delivery.revise" || request.operation === "delivery.reaffirm";
}

function admissionRequest(
  request: FoundationRuntimeMutationRequest,
): request is FoundationRuntimeAdmitRequest {
  return request.operation === "delivery.admit";
}

function terminalRequest(request: FoundationRuntimeMutationRequest): request is TerminalRequest {
  return request.operation === "delivery.accept" || request.operation === "delivery.no-ship";
}

function recoverRequest(
  request: FoundationRuntimeMutationRequest,
): request is FoundationRuntimeRecoverRequest {
  return request.operation === "delivery.recover";
}

/**
 * Construct the sole public mutation compositor. It selects one semantic
 * operation definition; the common Activity kernel below those definitions
 * owns durable execution and recovery bookkeeping.
 */
export function createFoundationRuntimeMutationExecutorV7(
  options: FoundationRuntimeMutationV7Options = {},
): FoundationRuntimeMutationExecutorV7 {
  const owners: MutationOwners = Object.freeze({
    now: options.now ?? (() => new Date().toISOString()),
    randomId: options.randomId ?? randomUUID,
    createActivityId: options.createActivityId ?? createDeliveryActivityId,
    preparation: options.preparation ?? Object.freeze({
      preflight: preflightFoundationPreparationBasisV7,
      open: openFoundationPreparationRuntimeV7,
      operate: operateFoundationPreparationRuntimeV7,
      recover: recoverFoundationPreparationRuntimeV7,
    }),
    candidate: options.candidate ?? Object.freeze({
      operate: operateFoundationCandidateAgentRuntimeV7,
      recover: recoverFoundationCandidateAgentRuntimeV7,
    }),
    evaluation: options.evaluation ?? Object.freeze({
      evaluate: evaluateDeliveryV7,
      recover: recoverDeliveryEvaluationV7,
    }),
    integration: options.integration ?? Object.freeze({
      operate: operateFoundationIntegrationRuntimeV1,
      recover: recoverFoundationIntegrationRuntimeV1,
    }),
    admission: options.admission ?? Object.freeze({
      admit: admitDeliveryV7,
      recover: recoverAdmissionV7,
    }),
    terminal: options.terminal ?? Object.freeze({
      accept: acceptDeliveryV7,
      noShip: noShipDeliveryV7,
      recover: recoverTerminalDeliveryV7,
    }),
    agentOperation: Object.freeze({ ...(options.agentOperation ?? {}) }),
    installedPreparation: options.preparation === undefined,
    installedCandidate: options.candidate === undefined,
    installedEvaluation: options.evaluation === undefined,
    installedTerminal: options.terminal === undefined,
  });
  return Object.freeze({
    async execute(input): Promise<FoundationRuntimeOperationResult> {
      assertFoundationAuthorityExecutionContext(input.context, input.request.operation);
      if (input.request.operation === "delivery.work") {
        return executeWork({ request: input.request, configuration: input.configuration, owners });
      }
      if (prepareRequest(input.request)) {
        return await executePrepare({
          request: input.request,
          configuration: input.configuration,
          owners,
        });
      }
      if (agentRequest(input.request)) {
        return await executeAgent({
          request: input.request,
          configuration: input.configuration,
          owners,
        });
      }
      if (input.request.operation === "delivery.integrate") {
        return await executeIntegration({ request: input.request, configuration: input.configuration, owners });
      }
      if (admissionRequest(input.request)) {
        return await executeAdmission({
          request: input.request,
          context: input.context,
          configuration: input.configuration,
          owners,
        });
      }
      if (terminalRequest(input.request)) {
        return await executeTerminal({
          request: input.request,
          context: input.context,
          configuration: input.configuration,
          owners,
        });
      }
      if (recoverRequest(input.request)) {
        return await executeRecover({
          request: input.request,
          configuration: input.configuration,
          owners,
        });
      }
      fail("operation", "Unsupported Foundation mutation operation");
    },
    async authorizeInvocationPrivate(input): Promise<FoundationRuntimeOperationResult> {
      assertFoundationAuthorityExecutionContext(input.context, input.request.operation);
      const gate = Object.freeze({
        beginClaim: input.gate.beginClaim,
      });
      if (admissionRequest(input.request)) {
        return await executeAdmission({
          request: input.request,
          context: input.context,
          configuration: input.configuration,
          owners,
          invocationPrivateGate: gate,
        });
      }
      if (terminalRequest(input.request)) {
        return await executeTerminal({
          request: input.request,
          context: input.context,
          configuration: input.configuration,
          owners,
          invocationPrivateGate: gate,
        });
      }
      fail(
        "invocation-private-operation",
        "Invocation-private Director authorization supports only admit, accept, or no-ship",
      );
    },
  });
}
