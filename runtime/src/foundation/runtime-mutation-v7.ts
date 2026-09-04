import { randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import {
  FoundationGitObjectSchema,
  FoundationRfc3339Schema,
  FoundationSha256Schema,
  type FoundationRuntimeAcceptRequest,
  type FoundationRuntimeAdmitRequest,
  type FoundationRuntimeContinueRequest,
  type FoundationRuntimeEvaluateRequest,
  type FoundationRuntimeNoShipRequest,
  type FoundationRuntimeOperationResult,
  type FoundationRuntimePrepareRequest,
  type FoundationRuntimeReaffirmRequest,
  type FoundationRuntimeRecoverRequest,
  type FoundationRuntimeReviseRequest,
} from "@neutral/lifecycle-protocol";
import { createDeliveryActivityId } from "./control/activity.js";
import {
  createDeliveryControlRecordStore,
  listDeliveryControlRecordStores,
  openDeliveryControlRecordStore,
  openDeliveryControlRecordStoreReadOnly,
  type OpenedDeliveryControlRecordStore,
} from "./control/delivery-custody.js";
import { executionReceiptSubmissionDiagnosticForActivity } from "./control/execution-receipt.js";
import { compileDeliveryGeneration } from "./control/delivery-view.js";
import type { DeliveryControlPhysicalDisposition } from "./control/public-view.js";
import type { ControlRecordStore } from "./control/store.js";
import { FoundationError } from "./error.js";
import type {
  FoundationRuntimeMutationExecutor,
  FoundationRuntimeMutationRequest,
} from "./facade.js";
import type { FoundationInstalledRuntimeConfigurationV7 } from "./installed-configuration-v7.js";
import type { FoundationCheckCellRuntimeV1 } from "./check/execution-cell-v1.js";
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
  type FoundationMutationBeforeV7 as MutationBefore,
} from "./process/mutation-result-v7.js";
import {
  preflightFoundationPreparationBasisV7,
} from "./process/preparation-context-v7.js";
import {
  operateFoundationPreparationRuntimeV7,
  recoverFoundationPreparationRuntimeV7,
  type FoundationPreparationRuntimeV7Options,
} from "./process/preparation-runtime-v7.js";
import type { DeliveryActivity, DeliveryOperation } from "./process/delivery-state.js";
import { withTargetOperationLock } from "./repository/operation-lock.js";
import { assertRepositoryEpochUnmoved } from "./repository/git.js";
import {
  authoritativeWorktreeState,
  loadRepositoryEpoch,
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

const RUNTIME_ID = "lifecycle-runtime-foundation-v7";
const AGENT_ID = "codex-agent-provider-v6";

type CandidateRequest =
  | FoundationRuntimeContinueRequest
  | FoundationRuntimeReviseRequest
  | FoundationRuntimeReaffirmRequest;

type AgentRequest = CandidateRequest | FoundationRuntimeEvaluateRequest;

type TerminalRequest = FoundationRuntimeAcceptRequest | FoundationRuntimeNoShipRequest;

export type FoundationRuntimeMutationV7Preparation = Readonly<{
  preflight: typeof preflightFoundationPreparationBasisV7;
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

async function exactTarget(
  target: string,
  configuration: FoundationInstalledRuntimeConfigurationV7,
): Promise<FoundationLoadedRepositoryEpoch> {
  const epoch = await loadRepositoryEpoch(target);
  await assertDisjointMachineAndTarget(configuration.machineHome, epoch.repository);
  return epoch;
}

async function identityTarget(
  target: string,
  configuration: FoundationInstalledRuntimeConfigurationV7,
): Promise<FoundationLoadedRepositoryIdentityEpoch> {
  const epoch = await loadRepositoryIdentityEpoch(target);
  await assertDisjointMachineAndTarget(configuration.machineHome, epoch.repository);
  return epoch;
}

function mutationAuthoritySecret(value: string | undefined): string {
  if (
    value === undefined || value.length === 0 || value.includes("\0") ||
    Buffer.byteLength(value, "utf8") > 4_096
  ) {
    fail("authority", "This operation requires one bounded ephemeral Founder authority secret");
  }
  return value;
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

function assertFrozenRepositoryCoordinate(input: Readonly<{
  epoch: FoundationLoadedRepositoryIdentityEpoch;
  expected: ReturnType<typeof boundaryRepositoryCoordinate>;
  phase: string;
}>): void {
  if (
    input.epoch.epoch.commit !== input.expected.headCommit ||
    input.epoch.epoch.tree !== input.expected.headTree ||
    input.epoch.contract.digest !== input.expected.repositoryContractDigest
  ) {
    fail(
      "repository-drift",
      `${input.phase} requires the canonical branch to remain at the selected Work Boundary repository coordinate`,
      {
        expectedCommit: input.expected.headCommit,
        expectedTree: input.expected.headTree,
        expectedRepositoryContractDigest: input.expected.repositoryContractDigest,
        observedCommit: input.epoch.epoch.commit,
        observedTree: input.epoch.epoch.tree,
        observedRepositoryContractDigest: input.epoch.contract.digest,
      },
    );
  }
}

async function assertCleanAuthoritativeCheckout(
  epoch: FoundationLoadedRepositoryIdentityEpoch,
  phase: string,
): Promise<void> {
  const worktree = await authoritativeWorktreeState(epoch.repository, epoch.contract);
  await assertRepositoryEpochUnmoved(epoch.repository, epoch.epoch);
  if (worktree.dirty) {
    fail(
      "repository-drift",
      `${phase} requires a clean authoritative target checkout`,
      {
        modified: worktree.modified,
        untracked: worktree.untracked,
        ignored: worktree.ignored,
      },
    );
  }
}

type ActiveDeliveryLeaseOwners = Readonly<{
  listDeliveryStores: typeof listDeliveryControlRecordStores;
  openDeliveryStoreReadOnly: typeof openDeliveryControlRecordStoreReadOnly;
}>;

const ACTIVE_DELIVERY_LEASE_OWNERS: ActiveDeliveryLeaseOwners = Object.freeze({
  listDeliveryStores: listDeliveryControlRecordStores,
  openDeliveryStoreReadOnly: openDeliveryControlRecordStoreReadOnly,
});

/**
 * Refuse initial admission while another unarchived Delivery for the target
 * already derives an active branch lease from its admitted Work Boundary.
 * Prepared proposals deliberately do not participate.
 */
export async function assertExclusiveActiveDeliveryLeaseV7(input: Readonly<{
  machineHome: string;
  targetId: string;
  deliveryId: string;
}>, owners: ActiveDeliveryLeaseOwners = ACTIVE_DELIVERY_LEASE_OWNERS): Promise<void> {
  let afterDeliveryId: string | undefined;
  for (;;) {
    const page = await owners.listDeliveryStores({
      machineHome: input.machineHome,
      targetId: input.targetId,
      ...(afterDeliveryId === undefined ? {} : { afterDeliveryId }),
      limit: 500,
    });
    for (const entry of page.deliveries) {
      if (entry.disposition !== "active" || entry.identity.processId === input.deliveryId) continue;
      const opened = await owners.openDeliveryStoreReadOnly({
        machineHome: input.machineHome,
        targetId: input.targetId,
        deliveryId: entry.identity.processId,
      });
      if (opened === null) {
        fail("active-delivery-lease", "Concurrent Delivery custody moved during lease inspection");
      }
      try {
        if (opened.disposition === "active" && opened.store.state().subjects.activeBoundary !== null) {
          fail(
            "active-delivery-lease",
            "Another admitted Delivery already holds the active-Delivery branch lease",
            { deliveryId: entry.identity.processId },
          );
        }
      } finally {
        opened.store.close();
      }
    }
    if (page.nextAfterDeliveryId === null) return;
    afterDeliveryId = page.nextAfterDeliveryId;
  }
}

function preparationOptions(
  configuration: FoundationInstalledRuntimeConfigurationV7,
  owners: MutationOwners,
  checkCellRuntime?: FoundationCheckCellRuntimeV1,
): FoundationPreparationRuntimeV7Options {
  return Object.freeze({
    agentOperation: Object.freeze({ ...owners.agentOperation, now: owners.now }),
    boundaryFinalization: Object.freeze({
      machineHome: configuration.machineHome,
      now: owners.now,
      checkOperation: Object.freeze({ now: owners.now }),
      ...(checkCellRuntime === undefined ? {} : { checkCellRuntime }),
    }),
  });
}

function candidateOptions(
  owners: MutationOwners,
  checkCellRuntime?: FoundationCheckCellRuntimeV1,
): FoundationCandidateAgentRuntimeV7Options {
  return Object.freeze({
    agentOperation: Object.freeze({ ...owners.agentOperation, now: owners.now }),
    candidateFinalization: Object.freeze({ now: owners.now }),
    boundaryFinalization: Object.freeze({
      now: owners.now,
      checkOperation: Object.freeze({ now: owners.now }),
      ...(checkCellRuntime === undefined ? {} : { checkCellRuntime }),
    }),
  });
}

function evaluationOptions(
  activityId: string,
  owners: MutationOwners,
  checkCellRuntime?: FoundationCheckCellRuntimeV1,
): FoundationEvaluationRuntimeV7Options {
  return Object.freeze({
    now: owners.now,
    createActivityId: () => activityId,
    preparation: Object.freeze({
      now: owners.now,
      createActivityId: () => activityId,
      checkOperation: Object.freeze({ now: owners.now }),
      ...(checkCellRuntime === undefined ? {} : { checkCellRuntime }),
    }),
    agentOperation: Object.freeze({ ...owners.agentOperation, now: owners.now }),
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
  const basis = await input.owners.preparation.preflight({
        target: input.request.target,
        semanticMarkdown: input.request.input.semanticMarkdown,
        observedAt: timestamp(input.owners),
      });
      await assertDisjointMachineAndTarget(input.configuration.machineHome, basis.epoch.repository);
      const deliveryId = `delivery-${input.owners.randomId()}`;
      const opened = await createDeliveryControlRecordStore({
        machineHome: input.configuration.machineHome,
        targetId: basis.epoch.contract.targetId,
        deliveryId,
        createdAt: timestamp(input.owners),
        runtimeActorId: RUNTIME_ID,
      });
      const store = opened.store;
      const activityId = input.owners.createActivityId("delivery.prepare");
      let installedCheck: FoundationOpenedInstalledCheckRuntimeV1 | null = null;
      try {
        assertActiveStore(opened, "delivery.prepare");
        if (input.owners.installedPreparation) {
          installedCheck = await openFoundationInstalledCheckRuntimeV1({
            configuration: input.configuration,
            now: input.owners.now,
          });
        }
        const result = await input.owners.preparation.operate({
          store,
          configuration: input.configuration,
          activityId,
          runtimeId: RUNTIME_ID,
          agentId: AGENT_ID,
          submittedAt: timestamp(input.owners),
          startedAt: timestamp(input.owners),
          attemptCreatedAt: timestamp(input.owners),
          basis,
        }, preparationOptions(input.configuration, input.owners, installedCheck?.runtime));
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
  return await withTargetOperationLock(
    input.request.target,
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
        if (expectedGeneration !== undefined) {
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
                "lifecycle.runtime-mutation-v7.generation-mismatch",
                "Founder semantic input was composed against a different Delivery generation",
                { retryable: true },
              ),
              observedAt: timestamp(input.owners),
              afterSequence,
              before,
              repositoryObservation,
            });
          }
        }
        assertFrozenRepositoryCoordinate({
          epoch,
          expected: boundaryRepositoryCoordinate(store, "active"),
          phase: input.request.operation,
        });
        await assertCleanAuthoritativeCheckout(epoch, input.request.operation);
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
              configuration: input.configuration,
              semanticMarkdown: input.request.input.semanticMarkdown,
              founderId: epoch.contract.authority.principalId,
              agentId: AGENT_ID,
              runtimeId: RUNTIME_ID,
            }, evaluationOptions(activityId, input.owners, installedCheck?.runtime))
          : await input.owners.candidate.operate({
              target: epoch.repository,
              store,
              configuration: input.configuration,
              activityId,
              operation: input.request.operation,
              runtimeId: RUNTIME_ID,
              agentId: AGENT_ID,
              opening: Object.freeze({
                semanticMarkdown: input.request.input.semanticMarkdown,
                submittedAt: observedAt,
                startedAt: observedAt,
                attemptCreatedAt: observedAt,
                founderId: epoch.contract.authority.principalId,
              }),
            }, candidateOptions(input.owners, installedCheck?.runtime));
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

async function executeAdmission(input: Readonly<{
  request: FoundationRuntimeAdmitRequest;
  context: Readonly<{ authoritySecret?: string }>;
  configuration: FoundationInstalledRuntimeConfigurationV7;
  owners: MutationOwners;
}>): Promise<FoundationRuntimeOperationResult> {
  return await withTargetOperationLock(
    input.request.target,
    "delivery-admit-mutation",
    async () => {
      const epoch = await identityTarget(input.request.target, input.configuration);
      const opened = await openDeliveryControlRecordStore({
        machineHome: input.configuration.machineHome,
        targetId: epoch.contract.targetId,
        deliveryId: input.request.deliveryId,
      });
      const store = opened.store;
      try {
        assertActiveStore(opened, "delivery.admit");
        assertFrozenRepositoryCoordinate({
          epoch,
          expected: boundaryRepositoryCoordinate(store, "proposed"),
          phase: "delivery.admit",
        });
        await assertCleanAuthoritativeCheckout(epoch, "delivery.admit");
        await assertExclusiveActiveDeliveryLeaseV7({
          machineHome: input.configuration.machineHome,
          targetId: epoch.contract.targetId,
          deliveryId: input.request.deliveryId,
        });
        const afterSequence = store.state().journal.eventCount;
        const before = mutationBefore(store, epoch.epoch.commit);
        const priorActivityIds = Object.freeze(store.state().activities.map(({ id }) => id));
        try {
          const outcome = await input.owners.admission.admit({
            target: epoch.repository,
            machineHome: input.configuration.machineHome,
            store,
            authorityHome: input.configuration.machineHome,
            authoritySecret: mutationAuthoritySecret(input.context.authoritySecret),
            runtimeId: RUNTIME_ID,
          }, {
            now: input.owners.now,
            withTargetLock: async (_target, _operation, action) => await action(),
          });
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
  context: Readonly<{ authoritySecret?: string }>;
  configuration: FoundationInstalledRuntimeConfigurationV7;
  owners: MutationOwners;
}>): Promise<FoundationRuntimeOperationResult> {
  return await withTargetOperationLock(
    input.request.target,
    "delivery-terminal-mutation",
    async () => {
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
        if (input.request.operation === "delivery.accept") {
          assertFrozenRepositoryCoordinate({
            epoch,
            expected: boundaryRepositoryCoordinate(opened.store, "active"),
            phase: "delivery.accept",
          });
          await assertCleanAuthoritativeCheckout(epoch, "delivery.accept");
        }
        const afterSequence = opened.store.state().journal.eventCount;
        const before = mutationBefore(opened.store, epoch.epoch.commit);
        const priorActivityIds = Object.freeze(
          opened.store.state().activities.map(({ id }) => id),
        );
        const authoritySecret = mutationAuthoritySecret(input.context.authoritySecret);
        if (input.owners.installedTerminal) {
          reclamationObserver = await openFoundationInstalledReclamationObserverV1({
            configuration: input.configuration,
            now: input.owners.now,
          });
        }
        transferred = true;
        return await concludeTerminalMutation({
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
                authoritySecret,
                runtimeId: RUNTIME_ID,
              }, {
                now: input.owners.now,
                withTargetLock: async (_target, _operation, action) => await action(),
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
                authoritySecret,
                semanticMarkdown: input.request.input.semanticMarkdown,
                runtimeId: RUNTIME_ID,
              }, {
                now: input.owners.now,
                withTargetLock: async (_target, _operation, action) => await action(),
                ...(reclamationObserver === null ? {} : {
                  observeReclamationHandoff: async (selected) =>
                    reclamationObserver!.observeTerminalReclamation(selected),
                }),
              }),
        });
      } finally {
        reclamationObserver?.close();
        if (!transferred) opened.store.close();
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
  checkCellRuntime?: FoundationCheckCellRuntimeV1;
}>): Promise<void> {
  const operation = input.selected.operation;
  let result;
  if (operation === "delivery.prepare") {
    result = await input.owners.preparation.recover({
      target: input.epoch.repository,
      store: input.store,
      configuration: input.configuration,
      activityId: input.selected.id,
      runtimeId: RUNTIME_ID,
      observedAt: timestamp(input.owners),
    }, preparationOptions(input.configuration, input.owners, input.checkCellRuntime));
  } else if (
    operation === "delivery.continue" || operation === "delivery.revise" ||
    operation === "delivery.reaffirm"
  ) {
    result = await input.owners.candidate.recover({
      target: input.epoch.repository,
      store: input.store,
      configuration: input.configuration,
      activityId: input.selected.id,
      operation,
    }, candidateOptions(input.owners, input.checkCellRuntime));
  } else if (operation === "delivery.evaluate") {
    result = await input.owners.evaluation.recover({
      target: input.epoch.repository,
      store: input.store,
      contract: input.epoch.contract,
      configuration: input.configuration,
      activityId: input.selected.id,
      runtimeId: RUNTIME_ID,
    }, evaluationOptions(input.selected.id, input.owners, input.checkCellRuntime));
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
  return await withTargetOperationLock(
    input.request.target,
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
        const compilesCurrentBoundary = selected.operation === "delivery.prepare";
        const epoch = compilesCurrentBoundary
          ? await exactTarget(input.request.target, input.configuration)
          : identity;
        if (epoch.contract.targetId !== store.identity.targetId) {
          fail("recovery-owner", "Recovery target differs from the retained Delivery target");
        }
        const repositoryObservation = compilesCurrentBoundary
          ? "complete-current" as const
          : "identity-current" as const;
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
                withTargetLock: async (_target, _operation, action) => await action(),
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
            const boundarySelection = store.state().subjects.activeBoundary === null
              ? "proposed" as const
              : "active" as const;
            assertFrozenRepositoryCoordinate({
              epoch: identity,
              expected: boundaryRepositoryCoordinate(store, boundarySelection),
              phase: "delivery.admit recovery",
            });
            await assertCleanAuthoritativeCheckout(identity, "delivery.admit recovery");
            await assertExclusiveActiveDeliveryLeaseV7({
              machineHome: input.configuration.machineHome,
              targetId: identity.contract.targetId,
              deliveryId: input.request.deliveryId,
            });
            const outcome = await input.owners.admission.recover({
              target: epoch.repository,
              machineHome: input.configuration.machineHome,
              store,
              runtimeId: RUNTIME_ID,
              activityId: selected.id,
            }, {
              now: input.owners.now,
              withTargetLock: async (_target, _operation, action) => await action(),
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
          if (
            selected.operation === "delivery.continue" ||
            selected.operation === "delivery.evaluate" ||
            selected.operation === "delivery.revise" ||
            selected.operation === "delivery.reaffirm"
          ) {
            assertFrozenRepositoryCoordinate({
              epoch: identity,
              expected: boundaryRepositoryCoordinate(store, "active"),
              phase: `${selected.operation} recovery`,
            });
            await assertCleanAuthoritativeCheckout(identity, `${selected.operation} recovery`);
          }
          await recoverAgent({
            request: input.request,
            selected,
            epoch,
            configuration: input.configuration,
            store,
            owners: input.owners,
            checkCellRuntime: installedCheck?.runtime,
          });
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
): FoundationRuntimeMutationExecutor {
  const owners: MutationOwners = Object.freeze({
    now: options.now ?? (() => new Date().toISOString()),
    randomId: options.randomId ?? randomUUID,
    createActivityId: options.createActivityId ?? createDeliveryActivityId,
    preparation: options.preparation ?? Object.freeze({
      preflight: preflightFoundationPreparationBasisV7,
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
      fail("operation", "Unsupported Foundation v7 mutation operation");
    },
  });
}
