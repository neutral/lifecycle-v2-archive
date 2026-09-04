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
  type FoundationRuntimeInitializeRequest,
  type FoundationRuntimeOperationKind as ProtocolRuntimeOperationKind,
  type FoundationRuntimeOperationRequest as ProtocolRuntimeOperationRequest,
  type FoundationRuntimeOperationResult as ProtocolRuntimeOperationResult,
} from "@neutral/lifecycle-protocol";
import { FoundationError } from "./error.js";
import {
  resolveFoundationInstalledMachineCustodyV7,
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
import { createFoundationRuntimeMutationExecutorV7 } from "./runtime-mutation-v7.js";

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
  /** Ephemeral Founder secret; never enters a request, Store, result, or log. */
  authoritySecret?: string;
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
  resolveInitialization(): Promise<FoundationInstalledRepositoryInitializationV7>;
  resolveConfiguration(): Promise<FoundationInstalledRuntimeConfigurationV7>;
  initialize: typeof initializeRepository;
  createReadSurface(input: Readonly<{
    machineHome: string | null;
    investment?: Readonly<{ model: string; reasoning: string }>;
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

function exactSecret(context: FoundationRuntimeExecutionContext): string {
  const value = context.authoritySecret;
  if (
    value === undefined || value.length === 0 || value.includes("\0") ||
    Buffer.byteLength(value, "utf8") > 4_096
  ) {
    fail("authority", "This operation requires one bounded ephemeral Founder authority secret");
  }
  return value;
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
    founderPrincipal: input.request.input.founderPrincipal,
    home: input.initialization.machineHome,
    authoritySecret: exactSecret(input.context),
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
      if (request.operation === "repository.validate") {
        return input.owners.createReadSurface({
          machineHome: null,
          now: input.now,
        }).execute(request);
      }
      if (readRequest(request)) {
        if (readRequiresInstalledInvestment(request)) {
          const configuration = await input.owners.resolveConfiguration();
          return input.owners.createReadSurface({
            machineHome: configuration.machineHome,
            investment: Object.freeze({
              model: configuration.model,
              reasoning: configuration.reasoning,
            }),
            now: input.now,
          }).execute(request);
        }
        const custody = await input.owners.resolveMachineCustody();
        return input.owners.createReadSurface({
          machineHome: custody.machineHome,
          now: input.now,
        }).execute(request);
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
      if (!mutationRequest(request)) fail("operation", "Unsupported Foundation v8 operation");
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

/** Create the sole installed Foundation v8 facade. */
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

export function renderFoundationRuntimeHuman(value: FoundationRuntimeOperationResult): string {
  const repository = value.observation.repository;
  const delivery = value.observation.delivery;
  const lines = [
    `${value.operation}: ${value.status}`,
    `target: ${value.targetId ?? "<unresolved>"}`,
    `delivery: ${value.deliveryId ?? "<none>"}`,
    `repository: ${repository.initialized ? repository.valid ? "valid" : "invalid" : "uninitialized"}`,
    `canonical-head: ${repository.headCommit ?? "<none>"}`,
  ];
  if (delivery !== null) {
    lines.push(
      `standing: ${delivery.standing}`,
      `candidate: ${delivery.candidateCondition}`,
      `journal-events: ${delivery.journal.eventCount}`,
      `control-store: ${delivery.storeDisposition.stage}`,
      `eligible: ${delivery.eligibleOperations.join(", ") || "<none>"}`,
      `recovery: ${delivery.recovery?.resumesAt ?? "<none>"}`,
    );
  }
  if (value.value !== null && "format" in value.value) {
    lines.push(`export: ${value.value.byteLength} bytes @ ${value.value.digest}`);
  } else if (value.value !== null && "kind" in value.value) {
    lines.push(`inspection: ${value.value.kind}`);
  }
  for (const diagnostic of value.diagnostics) {
    lines.push(`${diagnostic.severity}: ${diagnostic.code} · ${diagnostic.message}`);
  }
  return `${lines.join("\n")}\n`;
}
