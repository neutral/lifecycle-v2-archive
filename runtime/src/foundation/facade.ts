import {
  FOUNDATION_RUNTIME_FACADE_SCHEMA as FOUNDATION_PROTOCOL_RUNTIME_FACADE_SCHEMA,
  FOUNDATION_RUNTIME_OBSERVATION_SCHEMA as FOUNDATION_PROTOCOL_RUNTIME_OBSERVATION_SCHEMA,
  FOUNDATION_RUNTIME_OPERATION_KINDS as FOUNDATION_PROTOCOL_RUNTIME_OPERATION_KINDS,
  FOUNDATION_RUNTIME_RESULT_SCHEMA as FOUNDATION_PROTOCOL_RUNTIME_RESULT_SCHEMA,
  FoundationChangeFactsSchema,
  FoundationRfc3339Schema,
  FoundationRuntimeObservationSchema,
  createFoundationRuntimeOperationResult,
  parseFoundationRuntimeOperationRequest,
  type FoundationDeliveryInbox,
  type FoundationRuntimeInitializeRequest,
  type FoundationRuntimeOperationKind as ProtocolRuntimeOperationKind,
  type FoundationRuntimeOperationRequest as ProtocolRuntimeOperationRequest,
  type FoundationRuntimeOperationResult as ProtocolRuntimeOperationResult,
} from "@neutral/lifecycle-protocol";
import { FoundationError } from "./error.js";
import {
  resolveFoundationInstalledMachineCustodyV7,
  resolveFoundationInstalledReadInvestmentV7,
  resolveFoundationInstalledRepositoryInitializationV7,
  resolveFoundationInstalledRuntimeConfigurationV7,
  type FoundationInstalledMachineCustodyV7,
  type FoundationInstalledRepositoryInitializationV7,
  type FoundationInstalledRuntimeConfigurationV7,
} from "./installed-configuration-v7.js";
import { parseFoundationCheckBindingRegistry } from "./repository/contract.js";
import {
  attachedHead,
  canonicalRepository,
} from "./repository/git.js";
import { initializeRepository } from "./repository/initialize.js";
import {
  createFoundationRuntimeReadSurface,
  observeFoundationRepositoryForRead,
  type FoundationRuntimeReadRequest,
  type FoundationRuntimeReadSurface,
} from "./runtime-read.js";
import { createFoundationRuntimeMutationExecutorV7, executeFoundationWorkStop } from "./runtime-mutation-v7.js";
import { assertFoundationAuthorityCredential, assertFoundationAuthorityExecutionContext, type FoundationAuthorityCredential } from "./repository/authority.js";

export const FOUNDATION_RUNTIME_FACADE_SCHEMA = FOUNDATION_PROTOCOL_RUNTIME_FACADE_SCHEMA;
export const FOUNDATION_RUNTIME_RESULT_SCHEMA = FOUNDATION_PROTOCOL_RUNTIME_RESULT_SCHEMA;
export const FOUNDATION_RUNTIME_OBSERVATION_SCHEMA = FOUNDATION_PROTOCOL_RUNTIME_OBSERVATION_SCHEMA;
export const FOUNDATION_RUNTIME_OPERATION_KINDS = FOUNDATION_PROTOCOL_RUNTIME_OPERATION_KINDS;

export type FoundationRuntimeOperationKind = ProtocolRuntimeOperationKind;
export type FoundationRuntimeOperationRequest = ProtocolRuntimeOperationRequest;
export type FoundationRuntimeOperationResult = ProtocolRuntimeOperationResult;
export type FoundationRuntimeOperationValue = ProtocolRuntimeOperationResult["value"];
export type FoundationRuntimeInitializeInput = FoundationRuntimeInitializeRequest["input"];

export type FoundationRuntimeExecutionContext = Readonly<{
  /** Opaque invocation custody; never enters a request, Store, result, or log. */
  authorityCredential?: FoundationAuthorityCredential;
}>;

export type FoundationRuntimeMutationRequest = Exclude<
  FoundationRuntimeOperationRequest,
  FoundationRuntimeInitializeRequest | FoundationRuntimeReadRequest
>;

export type FoundationRuntimeMutationExecutor = Readonly<{
  execute(input: Readonly<{
    request: FoundationRuntimeMutationRequest;
    context: FoundationRuntimeExecutionContext;
    configuration: FoundationInstalledRuntimeConfigurationV7;
  }>): Promise<FoundationRuntimeOperationResult>;
}>;

export type FoundationRuntimeFacade = Readonly<{
  execute(
    request: FoundationRuntimeOperationRequest,
    context?: FoundationRuntimeExecutionContext,
  ): Promise<FoundationRuntimeOperationResult>;
}>;

type FoundationInstalledMutationFactory = (input: Readonly<{
  configuration: FoundationInstalledRuntimeConfigurationV7;
  now: () => string;
}>) => FoundationRuntimeMutationExecutor;

type FoundationRuntimeFacadeOwners = Readonly<{
  resolveMachineCustody(): Promise<FoundationInstalledMachineCustodyV7>;
  resolveReadInvestment(): Readonly<{ model: string; reasoning: string }> | null;
  resolveInitialization(): Promise<FoundationInstalledRepositoryInitializationV7>;
  resolveConfiguration(): Promise<FoundationInstalledRuntimeConfigurationV7>;
  initialize: typeof initializeRepository;
  createReadSurface(input: Readonly<{
    machineHome: string | null;
    investment?: Readonly<{ model: string; reasoning: string }> | null;
    now: () => string;
  }>): FoundationRuntimeReadSurface;
  mutation: FoundationRuntimeMutationExecutor | null;
  createInstalledMutation: FoundationInstalledMutationFactory;
}>;

const READ_OPERATIONS = new Set<FoundationRuntimeOperationKind>([
  "repository.validate",
  "delivery.inbox",
  "delivery.status",
  "delivery.inspect",
  "delivery.diff",
  "delivery.watch",
  "delivery.export",
]);

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.foundation.facade-v8.${code}`, message);
}

function readRequest(
  request: FoundationRuntimeOperationRequest,
): request is FoundationRuntimeReadRequest {
  return READ_OPERATIONS.has(request.operation);
}

function mutationRequest(
  request: FoundationRuntimeOperationRequest,
): request is FoundationRuntimeMutationRequest {
  return request.operation !== "repository.initialize" && !readRequest(request);
}

function readRequiresInstalledInvestment(request: FoundationRuntimeReadRequest): boolean {
  return (request.operation === "delivery.inspect" && request.input.kind === "delivery-view") ||
    (request.operation === "delivery.watch" && request.input.scope === "delivery");
}

function initializationCredential(context: FoundationRuntimeExecutionContext): FoundationAuthorityCredential {
  assertFoundationAuthorityCredential(context.authorityCredential, "initialize");
  return context.authorityCredential;
}

async function executeInitialization(input: Readonly<{
  request: FoundationRuntimeInitializeRequest;
  context: FoundationRuntimeExecutionContext;
  initialization: FoundationInstalledRepositoryInitializationV7;
  initialize: typeof initializeRepository;
  now: () => string;
}>): Promise<FoundationRuntimeOperationResult> {
  const observedAt = FoundationRfc3339Schema.parse(input.now());
  const repository = await canonicalRepository(input.request.target);
  const before = await attachedHead(repository);
  const contract = await input.initialize(repository, {
    targetId: input.request.input.targetId,
    directorPrincipal: input.request.input.directorPrincipal,
    home: input.initialization.machineHome,
    authorityCredential: initializationCredential(input.context),
    publicationDigest: input.initialization.publicationDigest,
    implementationRoots: input.request.input.implementationRoots,
    checkBindings: parseFoundationCheckBindingRegistry(input.request.input.checkBindings ?? {}),
    stage: input.request.input.stage,
  });
  const after = await attachedHead(repository);
  const observed = await observeFoundationRepositoryForRead(repository, observedAt);
  const observation = FoundationRuntimeObservationSchema.parse({
    schema: FOUNDATION_RUNTIME_OBSERVATION_SCHEMA,
    observedAt,
    repository: observed.repository,
    delivery: null,
  });
  const changes = FoundationChangeFactsSchema.parse({
    repository: {
      changed: before.commit !== after.commit,
      beforeCommit: before.commit,
      afterCommit: after.commit,
    },
    candidate: { changed: false, before: null, after: null },
    control: { advanced: false, beforeHead: null, afterHead: null },
  });
  return createFoundationRuntimeOperationResult({
    request: input.request,
    observedAt,
    status: "completed",
    targetId: contract.targetId,
    deliveryId: null,
    observation,
    changes,
  });
}

function createInstalledMutation(input: Readonly<{
  configuration: FoundationInstalledRuntimeConfigurationV7;
  now: () => string;
}>): FoundationRuntimeMutationExecutor {
  return createFoundationRuntimeMutationExecutorV7({
    now: input.now,
  });
}

function buildFoundationRuntimeFacade(input: Readonly<{
  owners: FoundationRuntimeFacadeOwners;
  now: () => string;
}>): FoundationRuntimeFacade {
  return Object.freeze({
    async execute(
      supplied: FoundationRuntimeOperationRequest,
      context: FoundationRuntimeExecutionContext = {},
    ): Promise<FoundationRuntimeOperationResult> {
      const request = parseFoundationRuntimeOperationRequest(supplied);
      assertFoundationAuthorityExecutionContext(context, request.operation);
      if (request.operation === "repository.validate") {
        return input.owners.createReadSurface({
          machineHome: null,
          now: input.now,
        }).execute(request);
      }
      if (readRequest(request)) {
        const custody = await input.owners.resolveMachineCustody();
        return input.owners.createReadSurface({
          machineHome: custody.machineHome,
          ...(readRequiresInstalledInvestment(request) ? { investment: input.owners.resolveReadInvestment() } : {}),
          now: input.now,
        }).execute(request);
      }
      if (request.operation === "delivery.work" && request.input.action === "stop") {
        const custody = await input.owners.resolveMachineCustody();
        return executeFoundationWorkStop({ request, machineHome: custody.machineHome, now: input.now });
      }
      if (request.operation === "repository.initialize") {
        const initialization = await input.owners.resolveInitialization();
        return executeInitialization({
          request,
          context,
          initialization,
          initialize: input.owners.initialize,
          now: input.now,
        });
      }
      if (!mutationRequest(request)) fail("operation", "Unsupported Foundation operation");
      const configuration = await input.owners.resolveConfiguration();
      const invocation = Object.freeze({ request, context, configuration });
      if (input.owners.mutation !== null) {
        return input.owners.mutation.execute(invocation);
      }
      return input.owners.createInstalledMutation({
        configuration,
        now: input.now,
      }).execute(invocation);
    },
  });
}

/** Create the installed Runtime Facade for the selected public Foundation protocol. */
export function createFoundationRuntimeFacade(options: Readonly<{
  mutation?: FoundationRuntimeMutationExecutor;
  environment?: NodeJS.ProcessEnv;
  now?: () => string;
}> = {}): FoundationRuntimeFacade {
  const now = options.now ?? (() => new Date().toISOString());
  return buildFoundationRuntimeFacade({
    now,
    owners: Object.freeze({
      resolveMachineCustody: async () => resolveFoundationInstalledMachineCustodyV7({
        environment: options.environment,
      }),
      resolveReadInvestment: () => resolveFoundationInstalledReadInvestmentV7({ environment: options.environment }),
      resolveInitialization: async () => resolveFoundationInstalledRepositoryInitializationV7({
        environment: options.environment,
      }),
      resolveConfiguration: async () => resolveFoundationInstalledRuntimeConfigurationV7({
        environment: options.environment,
      }),
      initialize: initializeRepository,
      createReadSurface: ({ machineHome, investment, now: readNow }) =>
        createFoundationRuntimeReadSurface({ machineHome, investment, now: readNow }),
      mutation: options.mutation ?? null,
      createInstalledMutation,
    }),
  });
}

/** @internal Focused dependency seam; installed callers use createFoundationRuntimeFacade. */
export function createFoundationRuntimeFacadeForTesting(options: Readonly<{
  configuration: FoundationInstalledRuntimeConfigurationV7;
  initialize?: typeof initializeRepository;
  readSurface?: FoundationRuntimeReadSurface;
  mutation?: FoundationRuntimeMutationExecutor;
  installedMutationFactory?: FoundationInstalledMutationFactory;
  now?: () => string;
}>): FoundationRuntimeFacade {
  const now = options.now ?? (() => new Date().toISOString());
  return buildFoundationRuntimeFacade({
    now,
    owners: Object.freeze({
      resolveMachineCustody: async () => Object.freeze({
        machineHome: options.configuration.machineHome,
      }),
      resolveReadInvestment: () => Object.freeze({ model: options.configuration.model, reasoning: options.configuration.reasoning }),
      resolveInitialization: async () => Object.freeze({
        machineHome: options.configuration.machineHome,
        installationId: options.configuration.installationId,
        publicationDigest: options.configuration.publicationDigest,
      }),
      resolveConfiguration: async () => options.configuration,
      initialize: options.initialize ?? initializeRepository,
      createReadSurface: ({ machineHome, investment, now: readNow }) => options.readSurface ??
        createFoundationRuntimeReadSurface({ machineHome, investment, now: readNow }),
      mutation: options.mutation ?? null,
      createInstalledMutation: options.installedMutationFactory ?? createInstalledMutation,
    }),
  });
}

export const foundationRuntime = createFoundationRuntimeFacade();

// Explanations of observed values only. Eligibility remains the Runtime's supplied set.
const HUMAN_STANDING = {
  framing: "Preparing the proposed scope of this change.",
  "awaiting-admission": "Review and approve the proposed scope before development begins.",
  active: "Work is governed by the approved scope; the proposed result remains separate from canonical.",
  "boundary-paused": "The governing context needs a decision before work can resume.",
  "awaiting-readmission": "Review and approve the resolved scope before work resumes.",
  "decision-ready": "The evaluated result is ready for your publication decision.",
  closed: "This Delivery has ended; check its result and any remaining recovery below.",
} as const;

const HUMAN_CANDIDATE = {
  absent: "No proposed result has been retained yet.",
  "ready-for-work": "Saved proposed result is ready for development.",
  "in-progress": "Development is in progress; retained revisions preserve prior work.",
  "needs-correction": "Saved proposed result needs correction before it can proceed.",
  "paused-for-boundary": "Saved proposed result is paused while the governing scope is resolved.",
  "sealed-under-evaluation": "An exact proposed result is fixed for checks and independent review.",
  "ready-for-decision": "The exact evaluated result awaits your decision; it is not published yet.",
  "terminal-recovery": "A terminal operation needs reconciliation; completion is not established here.",
  accepted: "The accepted result was applied to canonical repository state.",
  abandoned: "This Delivery ended without publishing its proposed result.",
} as const;

const HUMAN_COURSES = {
  "delivery.prepare": "Describe new work and prepare its proposed scope.",
  "delivery.admit": "Approve the exact proposed scope to start or resume work. Director authorization required.",
  "delivery.continue": "Develop or correct the saved proposed result with fresh direction.",
  "delivery.integrate": "Combine the proposed result with the current canonical parent for assessment.",
  "delivery.evaluate": "Check and independently review the exact integrated result.",
  "delivery.revise": "Propose changed requirements or permissions to resolve the frozen Condition.",
  "delivery.reaffirm": "Propose the same mandate under refreshed context to resolve the frozen Condition.",
  "delivery.accept": "Apply the exact evaluated result if its parent still matches. Director authorization required.",
  "delivery.no-ship": "End this Delivery without publishing its proposed result. Director authorization required.",
  "delivery.recover": "Reconcile the retained interruption before starting new work; do not redispatch it.",
} as const;

function humanInboxLines(inbox: FoundationDeliveryInbox): string[] {
  const lines = ["", "Deliveries (one governed change per row):"];
  for (const row of inbox.rows) {
    if (row.status === "unavailable") {
      lines.push(`  ${row.deliveryId ?? "<unresolved>"} | unavailable | ${row.diagnostic.code}: ${row.diagnostic.message}`);
    } else {
      lines.push(
        `  ${row.deliveryId} | ${row.label}`,
        `    ${row.standing} | proposed result: ${row.candidateCondition} | attention: ${row.attentionOwner}${row.recoveryRequired ? " | recovery required" : ""}`,
      );
    }
  }
  if (inbox.rows.length === 0) lines.push("  No Deliveries in this page. Use lifecycle help prepare to describe new work.");
  if (inbox.nextAfterDeliveryId !== null) {
    lines.push(`More Deliveries remain; next afterDeliveryId: ${inbox.nextAfterDeliveryId}`);
  }
  lines.push("Use status with a listed Delivery identity to review its saved work and available actions.");
  return lines;
}

export function renderFoundationRuntimeHuman(value: FoundationRuntimeOperationResult): string {
  const repository = value.observation.repository;
  const delivery = value.observation.delivery;
  if (value.value !== null && "kind" in value.value && value.value.kind === "diff") {
    const diff = value.value.view;
    const lines = [
      `${value.operation}: ${value.status}`,
      `Changes: ${diff.subject === "decision" ? "sealed result for decision" : "retained working result"} | ${diff.currentness}`,
      `target: ${value.targetId ?? "<unresolved>"} | delivery: ${value.deliveryId ?? "<none>"}`,
      `Candidate: ${diff.candidate === null ? "<none>" : `${diff.candidate.id}@${diff.candidate.revision}`}`,
      ...(diff.seal === null ? [] : [`Seal: ${diff.seal.id}@${diff.seal.revision}`]),
      `Base: ${diff.baseCommit ?? "<unavailable>"} -> tree: ${diff.tree ?? "<unavailable>"}`,
      `Read generation: ${diff.generation.digest}`,
    ];
    if (diff.currentness === "potentially-advancing") {
      lines.push("Development is active. These retained bytes may be followed by a newer Candidate; read again before deciding.");
    }
    if (diff.currentness === "unavailable" || diff.content === null) {
      lines.push(`Diff unavailable: ${diff.unavailableReason ?? "Runtime supplied no diff content."}`);
      lines.push("Inspect this Delivery's current status and retained subjects before requesting the diff again.");
    } else {
      lines.push(`Displayed diff: ${diff.byteLength} bytes${diff.truncated ? " | INCOMPLETE — bounded excerpt" : ""}`);
      lines.push("", diff.content.length === 0 ? "No textual differences in this exact diff." : diff.content);
      if (diff.truncated) lines.push("End of bounded excerpt. Omitted content must not be treated as reviewed.",
        "maximumBytes can be raised up to 16777216; use exact source inspection for larger results.");
    }
    lines.push("Exact diff and displayed-content digests are available with --format json.");
    for (const diagnostic of value.diagnostics) lines.push(`${diagnostic.severity}: ${diagnostic.code} · ${diagnostic.message}`);
    return `${lines.join("\n")}\n`;
  }
  const lines = [
    `${value.operation}: ${value.status}`,
    value.status === "recovery-required"
      ? "Attention: an interrupted operation needs reconciliation. Its completion is not established."
      : value.status === "refused"
      ? "Attention: the requested operation was refused. Review the observations and reason below."
      : "The command completed. The observations below establish the work's actual state.",
    `target: ${value.targetId ?? "<unresolved>"}`,
    `delivery: ${value.deliveryId ?? "<none>"}`,
    `repository: ${repository.initialized ? repository.valid ? "valid" : "validity not established" : "uninitialized"}`,
    `canonical-head: ${repository.headCommit ?? "<none>"}`,
  ];
  if (delivery !== null) {
    lines.push(
      "",
      `Situation: ${HUMAN_STANDING[delivery.standing]}`,
      `Proposed result: ${HUMAN_CANDIDATE[delivery.candidateCondition]}`,
      `standing: ${delivery.standing} | candidate: ${delivery.candidateCondition}`,
    );
    for (const [label, reference] of [
      ["approved scope (Work Boundary)", delivery.subjects.activeBoundary],
      ["proposed scope", delivery.subjects.proposedBoundary],
      ["saved result (Candidate)", delivery.subjects.candidate],
      ["checks and review (Evidence)", delivery.subjects.evidence],
    ] as const) {
      if (reference !== null) lines.push(`${label}: ${reference.id}@${reference.revision} ${reference.digest}`);
    }
    lines.push(
      `journal-events: ${delivery.journal.eventCount}`,
      `control-store: ${delivery.storeDisposition.stage}`,
      `eligible: ${delivery.eligibleOperations.join(", ") || "<none>"}`,
      `recovery: ${delivery.recovery?.resumesAt ?? "<none>"}`,
    );
    if (value.changes.candidate.changed) {
      const { before, after } = value.changes.candidate;
      lines.push(`Saved result reference changed: ${before === null ? "<none>" : `${before.id}@${before.revision}`} -> ${after === null ? "<none>" : `${after.id}@${after.revision}`}. Review its condition above.`);
    }
    if (value.changes.repository.changed) {
      lines.push(`Observed repository change: ${value.changes.repository.beforeCommit ?? "<none>"} -> ${value.changes.repository.afterCommit ?? "<none>"}`);
    }
    lines.push("", "Available actions (Runtime rechecks each request):");
    for (const operation of delivery.eligibleOperations) {
      lines.push(`  ${operation.slice("delivery.".length).padEnd(10)} ${HUMAN_COURSES[operation]}`);
    }
    if (delivery.eligibleOperations.length === 0) lines.push("  No mutation is currently eligible. Inspect status and diagnostics for the observed state.");
    lines.push("Use lifecycle help COMMAND for the required input and exact invocation.");
    lines.push('For the current read generation, inspect with input {"kind":"delivery-view"}.');
  }
  if (value.value !== null && "format" in value.value) {
    lines.push(`export: ${value.value.byteLength} bytes @ ${value.value.digest}`);
  } else if (value.value !== null && "kind" in value.value) {
    lines.push(`inspection: ${value.value.kind}`);
    if (value.value.kind === "delivery-view") {
      lines.push(`reviewed-generation: ${value.value.view.generation.digest}`);
    }
    if (value.value.kind === "inbox") lines.push(...humanInboxLines(value.value.view));
    if (value.value.kind === "watch") {
      lines.push(value.value.changed
        ? "Watch: new observation (initial snapshot or changed generation)."
        : "Watch: no generation change observed during this wait.");
      lines.push(`Watch generation: ${value.value.generation}`);
      if (value.value.inbox !== null) lines.push(...humanInboxLines(value.value.inbox));
      lines.push("To wait again, use this watch generation as afterGeneration. A watch return does not complete work.");
    }
    lines.push("Exact inspection content is available with --format json.");
  }
  for (const diagnostic of value.diagnostics) {
    lines.push(`${diagnostic.severity}: ${diagnostic.code} · ${diagnostic.message}`);
  }
  return `${lines.join("\n")}\n`;
}
