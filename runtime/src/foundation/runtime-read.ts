import {
  FoundationChangeFactsSchema,
  FoundationDeliveryInboxRowSchema,
  FoundationDiagnosticSchema,
  FoundationGitObjectSchema,
  FoundationRepositoryObservationSchema,
  FoundationRfc3339Schema,
  FoundationRuntimeObservationSchema,
  createFoundationRuntimeOperationResult,
  parseFoundationRuntimeOperationRequest,
  type FoundationChangeFacts,
  type FoundationControlEventReference,
  type FoundationDeliveryState,
  type FoundationDeliveryInboxRow,
  type FoundationDiagnostic,
  type FoundationRepositoryAtlasObservation,
  type FoundationRepositoryObservation,
  type FoundationRuntimeOperationRequest,
  type FoundationRuntimeOperationResult,
  type FoundationRuntimeOperationValue,
} from "@neutral/lifecycle-protocol";
import { asLifecycleError } from "../errors.js";
import {
  listDeliveryControlRecordStores,
  openDeliveryControlRecordStoreReadOnly,
  type OpenedDeliveryControlRecordStore,
} from "./control/delivery-custody.js";
import {
  compileDeliveryInbox,
  compileDeliveryInboxRow,
} from "./control/delivery-inbox.js";
import {
  compileDeliveryGeneration,
  compileDeliveryView,
} from "./control/delivery-view.js";
import { compileDeliveryDiff } from "./candidate/diff-view.js";
import {
  exportDeliveryControl,
  inspectDeliveryControl,
} from "./control/inspection.js";
import {
  publicDeliveryState,
  type DeliveryControlPhysicalDisposition,
} from "./control/public-view.js";
import type { ControlRecordStore } from "./control/store.js";
import { FoundationError } from "./error.js";
import { validateKnowledgeSet } from "./knowledge/knowledge-set.js";
import {
  bindRepositorySnapshot,
  loadRepositoryEpoch,
  loadRepositoryIdentityEpoch,
} from "./repository/snapshot.js";
import {
  validateLoadedRepositorySnapshot,
} from "./repository/validate.js";
import {
  canonicalJson,
  digestCanonical,
  type Sha256,
} from "./validation/canonical.js";
import type {
  FoundationValidationDiagnostic,
  FoundationValidationResult,
} from "./validation/result.js";

const READ_OPERATIONS = new Set([
  "repository.validate",
  "delivery.inbox",
  "delivery.status",
  "delivery.inspect",
  "delivery.diff",
  "delivery.watch",
  "delivery.export",
] as const);

type FoundationRuntimeReadOperation =
  | "repository.validate"
  | "delivery.inbox"
  | "delivery.status"
  | "delivery.inspect"
  | "delivery.diff"
  | "delivery.watch"
  | "delivery.export";

export type FoundationRuntimeReadRequest = Extract<
  FoundationRuntimeOperationRequest,
  { operation: FoundationRuntimeReadOperation }
>;

export type FoundationRepositoryReadObservation = Readonly<{
  repository: FoundationRepositoryObservation;
  diagnostics: readonly FoundationDiagnostic[];
}>;

export type FoundationRuntimeReadOwners = Readonly<{
  observeRepository(
    target: string,
    observedAt: string,
  ): Promise<FoundationRepositoryReadObservation>;
  observeRepositoryIdentity(
    target: string,
    observedAt: string,
  ): Promise<FoundationRepositoryReadObservation>;
  openDeliveryStore(input: Readonly<{
    machineHome: string;
    targetId: string;
    deliveryId: string;
    readOnly: true;
  }>): Promise<OpenedDeliveryControlRecordStore | null>;
  listDeliveryStores(input: Readonly<{
    machineHome: string;
    targetId: string;
    afterDeliveryId?: string;
    limit?: number;
  }>): ReturnType<typeof listDeliveryControlRecordStores>;
}>;

export type FoundationRuntimeReadSurface = Readonly<{
  execute(request: FoundationRuntimeReadRequest): Promise<FoundationRuntimeOperationResult>;
}>;

function publicFailure(error: unknown): FoundationDiagnostic {
  const failure = asLifecycleError(error);
  return FoundationDiagnosticSchema.parse({
    code: failure.code,
    severity: "error",
    message: "Runtime read could not establish the requested exact subject",
    retryable: failure.retryable,
    facts: {},
  });
}

function publicValidationDiagnostic(
  diagnostic: FoundationValidationDiagnostic,
): FoundationDiagnostic {
  return FoundationDiagnosticSchema.parse({
    code: diagnostic.code,
    severity: diagnostic.severity === "information" ? "info" : diagnostic.severity,
    message: diagnostic.message,
    retryable: false,
    facts: {
      stage: diagnostic.stage,
      jsonPointer: diagnostic.location.jsonPointer,
      line: diagnostic.location.line,
      column: diagnostic.location.column,
      length: diagnostic.location.length,
      related: diagnostic.related.map(({ kind, id, digest }) => ({ kind, id, digest })),
    },
  });
}

function publicValidationDiagnostics(
  validation: FoundationValidationResult,
): readonly FoundationDiagnostic[] {
  const diagnostics = validation.diagnostics
    .slice(0, 1_024)
    .map(publicValidationDiagnostic);
  if ((!validation.complete || !validation.valid) && diagnostics.length === 0) {
    return Object.freeze([
      FoundationDiagnosticSchema.parse({
        code: "lifecycle.repository.invalid",
        severity: "error",
        message: "Repository validation did not establish one complete valid repository",
        retryable: false,
        facts: { complete: validation.complete, valid: validation.valid },
      }),
    ]);
  }
  return Object.freeze(diagnostics);
}

function emptyRepositoryObservation(): FoundationRepositoryObservation {
  return FoundationRepositoryObservationSchema.parse({
    schema: "lifecycle.repository-observation.v10",
    initialized: false,
    valid: false,
    targetId: null,
    repositoryContract: null,
    repositoryContractDigest: null,
    headCommit: null,
    headTree: null,
    productDigest: null,
    atlas: null,
    knowledgeDigest: null,
    checkBindingsDigest: null,
  });
}

function repositoryIdentityObservation(
  epoch: Awaited<ReturnType<typeof loadRepositoryIdentityEpoch>>,
): FoundationRepositoryObservation {
  return FoundationRepositoryObservationSchema.parse({
    schema: "lifecycle.repository-observation.v10",
    initialized: true,
    valid: false,
    targetId: epoch.contract.targetId,
    repositoryContract: "lifecycle.repository.v15",
    repositoryContractDigest: epoch.contract.digest,
    headCommit: epoch.epoch.commit,
    headTree: epoch.epoch.tree,
    productDigest: null,
    atlas: null,
    knowledgeDigest: null,
    checkBindingsDigest: digestCanonical(epoch.contract.checkBindings),
  });
}

function repositoryObservation(input: Readonly<{
  initialized: true;
  valid: boolean;
  targetId: string;
  repositoryContractDigest: Sha256;
  headCommit: string;
  headTree: string;
  productDigest: Sha256;
  atlas: FoundationRepositoryAtlasObservation;
  knowledgeDigest: Sha256 | null;
  checkBindingsDigest: Sha256;
}>): FoundationRepositoryObservation {
  return FoundationRepositoryObservationSchema.parse({
    schema: "lifecycle.repository-observation.v10",
    repositoryContract: "lifecycle.repository.v15",
    ...input,
  });
}

function repositoryAtlasObservation(
  epoch: Awaited<ReturnType<typeof loadRepositoryEpoch>>,
): FoundationRepositoryAtlasObservation {
  return Object.freeze({
    selection: epoch.contract.atlas.selection,
    processor: epoch.atlas.resolution.processor,
    stateDigest: epoch.atlasState.digest,
    resolutionDigest: epoch.atlas.resolution.digest,
    normalizedModelDigest: epoch.atlas.resolution.normalizedModelDigest,
    resourceBindingsDigest: epoch.atlas.resolution.resourceBindingsDigest,
    complete: true,
    valid: true,
  });
}

function partialRepositoryObservation(
  epoch: Awaited<ReturnType<typeof loadRepositoryEpoch>>,
  knowledgeDigest: Sha256 | null = null,
): FoundationRepositoryObservation {
  return repositoryObservation({
    initialized: true,
    valid: false,
    targetId: epoch.contract.targetId,
    repositoryContractDigest: epoch.contract.digest,
    headCommit: epoch.epoch.commit,
    headTree: epoch.epoch.tree,
    productDigest: epoch.productState.digest,
    atlas: repositoryAtlasObservation(epoch),
    knowledgeDigest,
    checkBindingsDigest: digestCanonical(epoch.contract.checkBindings),
  });
}

/**
 * Observe one repository-v15 epoch and compile only its bounded v10 public
 * facts. The exact loaded epoch, Knowledge values, and validation carrier stay
 * internal to the runtime.
 */
export async function observeFoundationRepositoryForRead(
  target: string,
  observedAt: string,
): Promise<FoundationRepositoryReadObservation> {
  FoundationRfc3339Schema.parse(observedAt);
  let epoch: Awaited<ReturnType<typeof loadRepositoryEpoch>>;
  try {
    epoch = await loadRepositoryEpoch(target);
  } catch (error) {
    return Object.freeze({
      repository: emptyRepositoryObservation(),
      diagnostics: Object.freeze([publicFailure(error)]),
    });
  }

  let knowledge: Awaited<ReturnType<typeof validateKnowledgeSet>>;
  try {
    knowledge = await validateKnowledgeSet(epoch);
  } catch (error) {
    return Object.freeze({
      repository: partialRepositoryObservation(epoch),
      diagnostics: Object.freeze([publicFailure(error)]),
    });
  }
  if (
    knowledge.knowledgeSet === null ||
    !knowledge.validation.complete ||
    !knowledge.validation.valid
  ) {
    return Object.freeze({
      repository: partialRepositoryObservation(
        epoch,
        knowledge.knowledgeSet?.manifest.digest ?? null,
      ),
      diagnostics: publicValidationDiagnostics(knowledge.validation),
    });
  }

  let snapshot: Awaited<ReturnType<typeof bindRepositorySnapshot>>;
  try {
    snapshot = await bindRepositorySnapshot(epoch, knowledge.knowledgeSet);
  } catch (error) {
    return Object.freeze({
      repository: partialRepositoryObservation(epoch, knowledge.knowledgeSet.manifest.digest),
      diagnostics: Object.freeze([publicFailure(error)]),
    });
  }
  let validation: Awaited<ReturnType<typeof validateLoadedRepositorySnapshot>>;
  try {
    validation = await validateLoadedRepositorySnapshot(snapshot, {
      knowledge: knowledge.knowledgeSet,
      observedAt,
    });
  } catch (error) {
    return Object.freeze({
      repository: partialRepositoryObservation(epoch, snapshot.snapshot.knowledgeSetDigest),
      diagnostics: Object.freeze([publicFailure(error)]),
    });
  }
  return Object.freeze({
    repository: repositoryObservation({
      initialized: true,
      valid: validation.complete && validation.valid,
      targetId: snapshot.contract.targetId,
      repositoryContractDigest: snapshot.contract.digest,
      headCommit: snapshot.epoch.commit,
      headTree: snapshot.epoch.tree,
      productDigest: snapshot.snapshot.productStateDigest,
      atlas: repositoryAtlasObservation(snapshot),
      knowledgeDigest: snapshot.snapshot.knowledgeSetDigest,
      checkBindingsDigest: digestCanonical(snapshot.contract.checkBindings),
    }),
    diagnostics: publicValidationDiagnostics(validation),
  });
}

/**
 * Observe only the exact current repository and Contract coordinate. This is
 * used when Delivery semantics come from an immutable historical Work
 * Boundary and therefore must not interpret the current Atlas as context.
 */
export async function observeFoundationRepositoryIdentityForRead(
  target: string,
  observedAt: string,
): Promise<FoundationRepositoryReadObservation> {
  FoundationRfc3339Schema.parse(observedAt);
  try {
    const epoch = await loadRepositoryIdentityEpoch(target);
    return Object.freeze({
      repository: repositoryIdentityObservation(epoch),
      diagnostics: Object.freeze([]),
    });
  } catch (error) {
    return Object.freeze({
      repository: emptyRepositoryObservation(),
      diagnostics: Object.freeze([publicFailure(error)]),
    });
  }
}

function normalizedRepositoryRead(
  input: FoundationRepositoryReadObservation,
): FoundationRepositoryReadObservation {
  const repository = FoundationRepositoryObservationSchema.parse(input.repository);
  const diagnostics = Object.freeze(input.diagnostics.map((entry) =>
    FoundationDiagnosticSchema.parse(entry)));
  const boundValues = [
    repository.targetId,
    repository.repositoryContract,
    repository.repositoryContractDigest,
    repository.headCommit,
    repository.headTree,
    repository.productDigest,
    repository.atlas,
    repository.knowledgeDigest,
    repository.checkBindingsDigest,
  ];
  const coreComplete = repository.targetId !== null &&
    repository.repositoryContract === "lifecycle.repository.v15" &&
    repository.repositoryContractDigest !== null &&
    repository.headCommit !== null &&
    repository.headTree !== null &&
    repository.productDigest !== null &&
    repository.atlas !== null &&
    repository.checkBindingsDigest !== null;
  const identityComplete = repository.targetId !== null &&
    repository.repositoryContract === "lifecycle.repository.v15" &&
    repository.repositoryContractDigest !== null &&
    repository.headCommit !== null &&
    repository.headTree !== null &&
    repository.productDigest === null &&
    repository.atlas === null &&
    repository.knowledgeDigest === null &&
    repository.checkBindingsDigest !== null;
  const complete = coreComplete && repository.knowledgeDigest !== null;
  if (repository.valid && (!repository.initialized || !complete)) {
    throw new FoundationError(
      "lifecycle.runtime-read.repository-observation",
      "A valid repository observation must bind one complete initialized repository-v15 epoch",
    );
  }
  if (repository.initialized && !coreComplete && !identityComplete) {
    throw new FoundationError(
      "lifecycle.runtime-read.repository-observation",
      "An initialized repository observation must bind either its complete repository-v15 core or exact raw identity",
    );
  }
  if (!repository.initialized && boundValues.some((value) => value !== null)) {
    throw new FoundationError(
      "lifecycle.runtime-read.repository-observation",
      "An uninitialized repository observation cannot expose repository-v15 epoch fields",
    );
  }
  if (repository.valid && diagnostics.some(({ severity }) => severity === "error")) {
    throw new FoundationError(
      "lifecycle.runtime-read.repository-observation",
      "A valid repository observation cannot carry an error diagnostic",
    );
  }
  if (!repository.valid && !diagnostics.some(({ severity }) => severity === "error")) {
    return Object.freeze({
      repository,
      diagnostics: Object.freeze([
        ...diagnostics,
        FoundationDiagnosticSchema.parse({
          code: "lifecycle.repository.invalid",
          severity: "error",
          message: "Repository observation is not complete and valid",
          retryable: false,
          facts: { initialized: repository.initialized },
        }),
      ]),
    });
  }
  return Object.freeze({ repository, diagnostics });
}

async function observeDeliveryRepositoryForRead(input: Readonly<{
  owners: FoundationRuntimeReadOwners;
  target: string;
  observedAt: string;
}>): Promise<FoundationRepositoryReadObservation> {
  const complete = normalizedRepositoryRead(
    await input.owners.observeRepository(input.target, input.observedAt),
  );
  if (complete.repository.valid) return complete;
  const identity = await input.owners.observeRepositoryIdentity(input.target, input.observedAt);
  return normalizedRepositoryRead(Object.freeze({
    repository: identity.repository,
    diagnostics: Object.freeze([
      ...complete.diagnostics,
      ...identity.diagnostics.filter((candidate) =>
        !complete.diagnostics.some(({ code }) => code === candidate.code)),
    ]),
  }));
}

function runtimeObservation(
  observedAt: string,
  repository: FoundationRepositoryObservation,
  delivery: FoundationDeliveryState | null,
) {
  return FoundationRuntimeObservationSchema.parse({
    schema: "lifecycle.foundation-runtime-observation.v10",
    observedAt,
    repository,
    delivery,
  });
}

function headReference(
  store: ControlRecordStore,
  delivery: FoundationDeliveryState,
): FoundationControlEventReference | null {
  if (delivery.journal.eventCount === 0) return null;
  const sequence = delivery.journal.headSequence;
  if (sequence === null || delivery.journal.headDigest === null) {
    throw new FoundationError(
      "lifecycle.runtime-read.control-head",
      "A nonempty Delivery Journal must expose one exact head",
    );
  }
  const events = store.listEvents(sequence - 1, 1);
  const event = events[0];
  if (
    events.length !== 1 ||
    event === undefined ||
    event.sequence !== sequence ||
    event.digest !== delivery.journal.headDigest
  ) {
    throw new FoundationError(
      "lifecycle.runtime-read.control-head",
      "Delivery public state does not match the exact retained Journal head",
    );
  }
  return Object.freeze({
    sequence: event.sequence,
    eventId: event.eventId,
    digest: event.digest,
  });
}

function changeFacts(
  repository: FoundationRepositoryObservation,
  delivery: FoundationDeliveryState | null,
  head: FoundationControlEventReference | null,
): FoundationChangeFacts {
  const candidate = delivery?.subjects.candidate ?? null;
  return FoundationChangeFactsSchema.parse({
    repository: {
      changed: false,
      beforeCommit: repository.headCommit,
      afterCommit: repository.headCommit,
    },
    candidate: { changed: false, before: candidate, after: candidate },
    control: { advanced: false, beforeHead: head, afterHead: head },
  });
}

function readResult(input: Readonly<{
  request: FoundationRuntimeReadRequest;
  observedAt: string;
  repository: FoundationRepositoryObservation;
  delivery: FoundationDeliveryState | null;
  head: FoundationControlEventReference | null;
  status: "completed" | "refused";
  diagnostics: readonly FoundationDiagnostic[];
  value?: FoundationRuntimeOperationValue;
}>): FoundationRuntimeOperationResult {
  return createFoundationRuntimeOperationResult({
    request: input.request,
    observedAt: input.observedAt,
    status: input.status,
    targetId: input.repository.targetId,
    deliveryId: "deliveryId" in input.request ? input.request.deliveryId : null,
    observation: runtimeObservation(input.observedAt, input.repository, input.delivery),
    changes: changeFacts(input.repository, input.delivery, input.head),
    diagnostics: input.diagnostics,
    value: input.value ?? null,
  });
}

function physicalDisposition(
  opened: OpenedDeliveryControlRecordStore,
): DeliveryControlPhysicalDisposition {
  return Object.freeze({
    disposition: opened.disposition,
    archiveManifestDigest: opened.archiveManifestDigest,
  });
}

function activeDeliveryLeaseDiagnostic(input: Readonly<{
  store: ControlRecordStore;
  physical: DeliveryControlPhysicalDisposition;
  delivery: FoundationDeliveryState;
  repository: FoundationRepositoryObservation;
}>): FoundationDiagnostic | null {
  const selected = input.delivery.subjects.activeBoundary;
  if (input.physical.disposition !== "active" || selected === null) return null;
  const boundary = input.store.getRevision(selected.id, selected.revision);
  if (
    boundary === null || boundary.recordKind !== "work-boundary" ||
    boundary.digest !== selected.digest
  ) {
    throw new FoundationError(
      "lifecycle.runtime-read.active-delivery-lease",
      "Active Delivery lease does not resolve its exact Work Boundary",
    );
  }
  const basis = boundary.payload.basis;
  if (basis === null || typeof basis !== "object" || Array.isArray(basis)) {
    throw new FoundationError(
      "lifecycle.runtime-read.active-delivery-lease",
      "Active Work Boundary does not retain its exact repository basis",
    );
  }
  const repositoryBasis = basis as Readonly<Record<string, unknown>>;
  let expectedCommit = FoundationGitObjectSchema.parse(repositoryBasis.productBaseCommit);
  let expectedTree = FoundationGitObjectSchema.parse(repositoryBasis.productBaseTree);
  let expectedState = "admitted repository basis";
  if (input.delivery.standing === "closed") {
    const selectedClosure = input.delivery.subjects.closure;
    if (selectedClosure === null) {
      throw new FoundationError(
        "lifecycle.runtime-read.active-delivery-lease",
        "Closed Delivery lease does not resolve its exact Closure",
      );
    }
    const closure = input.store.getRevision(selectedClosure.id, selectedClosure.revision);
    if (
      closure === null || closure.recordKind !== "closure" ||
      closure.digest !== selectedClosure.digest
    ) {
      throw new FoundationError(
        "lifecycle.runtime-read.active-delivery-lease",
        "Closed Delivery lease does not resolve its exact Closure",
      );
    }
    if (closure.payload.disposition === "accepted") {
      const canonicalResult = closure.payload.canonicalResult;
      if (
        canonicalResult === null || typeof canonicalResult !== "object" ||
        Array.isArray(canonicalResult)
      ) {
        throw new FoundationError(
          "lifecycle.runtime-read.active-delivery-lease",
          "Accepted Closure does not retain its exact canonical result",
        );
      }
      const accepted = canonicalResult as Readonly<Record<string, unknown>>;
      expectedCommit = FoundationGitObjectSchema.parse(accepted.commit);
      expectedTree = FoundationGitObjectSchema.parse(accepted.tree);
      expectedState = "accepted canonical result";
    } else if (closure.payload.disposition !== "no-ship") {
      throw new FoundationError(
        "lifecycle.runtime-read.active-delivery-lease",
        "Closed Delivery lease has an unsupported Closure disposition",
      );
    }
  }
  if (
    input.repository.headCommit === expectedCommit &&
    input.repository.headTree === expectedTree
  ) return null;
  return FoundationDiagnosticSchema.parse({
    code: "lifecycle.delivery.branch-lease-violation",
    severity: "error",
    message: `The canonical branch moved from the active Delivery's ${expectedState}`,
    retryable: false,
    facts: {
      expectedCommit,
      expectedTree,
      observedCommit: input.repository.headCommit,
      observedTree: input.repository.headTree,
    },
  });
}

function assertStableStoreRead(input: Readonly<{
  before: Awaited<ReturnType<ControlRecordStore["verifyIntegrity"]>>;
  after: Awaited<ReturnType<ControlRecordStore["verifyIntegrity"]>>;
  delivery: FoundationDeliveryState;
  afterDelivery: FoundationDeliveryState;
  head: FoundationControlEventReference | null;
}>): void {
  if (
    input.before.eventCount !== input.after.eventCount ||
    input.before.headDigest !== input.after.headDigest ||
    input.delivery.journal.eventCount !== input.after.eventCount ||
    input.delivery.journal.headDigest !== input.after.headDigest ||
    canonicalJson(input.delivery) !== canonicalJson(input.afterDelivery) ||
    (input.head?.sequence ?? null) !== input.delivery.journal.headSequence ||
    (input.head?.digest ?? null) !== input.delivery.journal.headDigest
  ) {
    throw new FoundationError(
      "lifecycle.runtime-read.control-epoch-mixed",
      "Control Record Store changed while its read-only result was being derived",
      { retryable: true },
    );
  }
}

function assertStableRepositoryRead(
  before: FoundationRepositoryReadObservation,
  after: FoundationRepositoryReadObservation,
): void {
  if (
    canonicalJson(before.repository) !== canonicalJson(after.repository)
  ) {
    throw new FoundationError(
      "lifecycle.runtime-read.repository-epoch-mixed",
      "Repository epoch changed while its coherent read model was compiled",
      { retryable: true },
    );
  }
}

function readOperation(value: FoundationRuntimeOperationRequest): value is FoundationRuntimeReadRequest {
  return READ_OPERATIONS.has(value.operation as FoundationRuntimeReadOperation);
}

function readInvestment(
  value: Readonly<{ model: string; reasoning: string }> | undefined,
): Readonly<{ model: string; reasoning: string }> {
  return Object.freeze(value ?? { model: "installed-provider", reasoning: "installed-selection" });
}

async function compileInboxSnapshot(input: Readonly<{
  owners: FoundationRuntimeReadOwners;
  machineHome: string;
  targetId: string;
  repository: FoundationRepositoryObservation;
  afterDeliveryId: string | null;
  limit: number;
}>) {
  const selected = await input.owners.listDeliveryStores({
    machineHome: input.machineHome,
    targetId: input.targetId,
    ...(input.afterDeliveryId === null ? {} : { afterDeliveryId: input.afterDeliveryId }),
    limit: input.limit,
  });
  const rows: FoundationDeliveryInboxRow[] = [];
  for (const entry of selected.deliveries) {
    let opened: OpenedDeliveryControlRecordStore | null = null;
    try {
      opened = await input.owners.openDeliveryStore({
        machineHome: input.machineHome,
        targetId: input.targetId,
        deliveryId: entry.identity.processId,
        readOnly: true,
      });
      if (opened === null) {
        throw new FoundationError(
          "lifecycle.runtime-read.delivery-absent",
          "Inbox selection disappeared before its exact row was compiled",
          { retryable: true },
        );
      }
      const before = await opened.store.verifyIntegrity();
      const physical = physicalDisposition(opened);
      const delivery = publicDeliveryState(opened.store, physical);
      const row = compileDeliveryInboxRow({
        store: opened.store,
        physical,
        repository: input.repository,
        state: delivery,
      });
      const head = headReference(opened.store, delivery);
      const afterDelivery = publicDeliveryState(opened.store, physical);
      const afterGeneration = compileDeliveryGeneration({
        store: opened.store,
        physical,
        repository: input.repository,
        state: afterDelivery,
      });
      const after = await opened.store.verifyIntegrity();
      assertStableStoreRead({ before, after, delivery, afterDelivery, head });
      if (row.status !== "available" || row.generation.digest !== afterGeneration.digest) {
        throw new FoundationError(
          "lifecycle.runtime-read.inbox-generation-mixed",
          "Delivery changed while its exact Inbox row was being compiled",
          { retryable: true },
        );
      }
      rows.push(row);
    } catch (error) {
      rows.push(FoundationDeliveryInboxRowSchema.parse({
        status: "unavailable",
        deliveryId: entry.identity.processId,
        coordinateDigest: digestCanonical({
          targetId: input.targetId,
          storeId: entry.identity.storeId,
          processId: entry.identity.processId,
          disposition: entry.disposition,
        }),
        diagnostic: publicFailure(error),
      }));
    } finally {
      opened?.store.close();
    }
  }
  const afterSelected = await input.owners.listDeliveryStores({
    machineHome: input.machineHome,
    targetId: input.targetId,
    ...(input.afterDeliveryId === null ? {} : { afterDeliveryId: input.afterDeliveryId }),
    limit: input.limit,
  });
  if (afterSelected.inventoryDigest !== selected.inventoryDigest) {
    throw new FoundationError(
      "lifecycle.runtime-read.inbox-registry-epoch-mixed",
      "Delivery registry changed while its exact Inbox page was being compiled",
      { retryable: true },
    );
  }
  return compileDeliveryInbox({
    targetId: input.targetId,
    repository: input.repository,
    registryInventoryDigest: selected.inventoryDigest,
    rows: Object.freeze(rows),
    nextAfterDeliveryId: selected.nextAfterDeliveryId,
  });
}

async function waitForReadChange(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

const DEFAULT_READ_OWNERS: FoundationRuntimeReadOwners = Object.freeze({
  observeRepository: observeFoundationRepositoryForRead,
  observeRepositoryIdentity: observeFoundationRepositoryIdentityForRead,
  openDeliveryStore: async ({ machineHome, targetId, deliveryId }) =>
    openDeliveryControlRecordStoreReadOnly({ machineHome, targetId, deliveryId }),
  listDeliveryStores: listDeliveryControlRecordStores,
});

/**
 * Construct the read-only v10 operation surface. Store discovery is exact and
 * no read path appends an event, creates a revision, or changes repository
 * state.
 */
export function createFoundationRuntimeReadSurface(options: Readonly<{
  machineHome: string | null;
  investment?: Readonly<{ model: string; reasoning: string }>;
  owners?: Partial<FoundationRuntimeReadOwners>;
  now?: () => string;
}>): FoundationRuntimeReadSurface {
  const owners: FoundationRuntimeReadOwners = Object.freeze({
    ...DEFAULT_READ_OWNERS,
    ...(options.owners ?? {}),
  });
  const now = options.now ?? (() => new Date().toISOString());

  return Object.freeze({
    async execute(supplied: FoundationRuntimeReadRequest): Promise<FoundationRuntimeOperationResult> {
      const request = parseFoundationRuntimeOperationRequest(supplied);
      if (!readOperation(request)) {
        throw new FoundationError(
          "lifecycle.runtime-read.operation",
          "The read surface accepts only repository validation, Delivery status, inspection, and export",
        );
      }
      if (request.operation !== "repository.validate" && options.machineHome === null) {
        throw new FoundationError(
          "lifecycle.runtime-read.machine-custody",
          "A Delivery read requires exact installed machine custody",
        );
      }
      const machineHome = options.machineHome;
      let observedAt = FoundationRfc3339Schema.parse(now());
      let observed: FoundationRepositoryReadObservation;
      try {
        observed = request.operation === "repository.validate"
          ? normalizedRepositoryRead(await owners.observeRepository(request.target, observedAt))
          : await observeDeliveryRepositoryForRead({
              owners,
              target: request.target,
              observedAt,
            });
      } catch (error) {
        observed = Object.freeze({
          repository: emptyRepositoryObservation(),
          diagnostics: Object.freeze([publicFailure(error)]),
        });
      }

      if (request.operation === "repository.validate") {
        return readResult({
          request,
          observedAt,
          repository: observed.repository,
          delivery: null,
          head: null,
          status: "completed",
          diagnostics: observed.diagnostics,
        });
      }
      if (observed.repository.targetId === null) {
        return readResult({
          request,
          observedAt,
          repository: observed.repository,
          delivery: null,
          head: null,
          status: "refused",
          diagnostics: observed.diagnostics,
        });
      }

      const inboxRequest = request.operation === "delivery.inbox" ||
        (request.operation === "delivery.watch" && request.input.scope === "inbox");
      if (inboxRequest) {
        const afterGeneration = request.operation === "delivery.watch"
          ? request.input.afterGeneration
          : null;
        const timeoutMs = request.operation === "delivery.watch" ? request.input.timeoutMs : 0;
        const deadline = Date.now() + timeoutMs;
        try {
          for (;;) {
            const inbox = await compileInboxSnapshot({
              owners,
              machineHome: machineHome!,
              targetId: observed.repository.targetId!,
              repository: observed.repository,
              afterDeliveryId: request.operation === "delivery.inbox"
                ? request.input.afterDeliveryId
                : null,
              limit: request.operation === "delivery.inbox" ? request.input.limit : 100,
            });
            const afterRepository = await observeDeliveryRepositoryForRead({
              owners,
              target: request.target,
              observedAt: FoundationRfc3339Schema.parse(now()),
            });
            assertStableRepositoryRead(observed, afterRepository);
            if (request.operation === "delivery.inbox") {
              return readResult({
                request,
                observedAt,
                repository: observed.repository,
                delivery: null,
                head: null,
                status: "completed",
                diagnostics: observed.diagnostics,
                value: Object.freeze({ kind: "inbox", view: inbox }),
              });
            }
            const changed = afterGeneration === null || inbox.generation !== afterGeneration;
            if (changed || Date.now() >= deadline) {
              return readResult({
                request,
                observedAt,
                repository: observed.repository,
                delivery: null,
                head: null,
                status: "completed",
                diagnostics: observed.diagnostics,
                value: Object.freeze({
                  kind: "watch",
                  scope: "inbox",
                  changed,
                  generation: inbox.generation,
                  inbox,
                  delivery: null,
                }),
              });
            }
            await waitForReadChange(Math.min(250, Math.max(1, deadline - Date.now())));
            observedAt = FoundationRfc3339Schema.parse(now());
            observed = await observeDeliveryRepositoryForRead({
              owners,
              target: request.target,
              observedAt,
            });
            if (observed.repository.targetId === null) {
              throw new FoundationError(
                "lifecycle.runtime-read.watch-repository",
                "Repository validity changed while Inbox watch was waiting",
                { retryable: true },
              );
            }
          }
        } catch (error) {
          return readResult({
            request,
            observedAt,
            repository: observed.repository,
            delivery: null,
            head: null,
            status: "refused",
            diagnostics: Object.freeze([...observed.diagnostics, publicFailure(error)]),
          });
        }
      }

      const deliveryId = request.deliveryId;
      if (deliveryId === null) {
        return readResult({
          request,
          observedAt,
          repository: observed.repository,
          delivery: null,
          head: null,
          status: "refused",
          diagnostics: Object.freeze([
            ...observed.diagnostics,
            publicFailure(new FoundationError(
              "lifecycle.runtime-read.delivery-identity",
              "Selected Delivery read requires one exact Delivery identity",
            )),
          ]),
        });
      }

      const watchDeadline = request.operation === "delivery.watch"
        ? Date.now() + request.input.timeoutMs
        : 0;
      for (;;) {
        let opened: OpenedDeliveryControlRecordStore | null = null;
        try {
          const selected = await owners.openDeliveryStore({
            machineHome: machineHome!,
            targetId: observed.repository.targetId,
            deliveryId,
            readOnly: true,
          });
          if (selected === null) {
            throw new FoundationError(
              "lifecycle.runtime-read.delivery-absent",
              "No Control Record Store exists for the exact target and Delivery selection",
            );
          }
          opened = selected;
          const before = await opened.store.verifyIntegrity();
          const physical = physicalDisposition(opened);
          const delivery = publicDeliveryState(opened.store, physical);
          const leaseDiagnostic = activeDeliveryLeaseDiagnostic({
            store: opened.store,
            physical,
            delivery,
            repository: observed.repository,
          });
          const generation = compileDeliveryGeneration({
            store: opened.store,
            physical,
            repository: observed.repository,
            state: delivery,
          });
          const value = request.operation === "delivery.inspect"
            ? inspectDeliveryControl(opened.store, physical, request.input, {
                repository: observed.repository,
                investment: readInvestment(options.investment),
                generation,
              })
            : request.operation === "delivery.export"
              ? exportDeliveryControl(opened.store, physical, request.input)
              : request.operation === "delivery.diff"
                ? Object.freeze({
                    kind: "diff" as const,
                    view: await compileDeliveryDiff({
                      machineHome: machineHome!,
                      repository: request.target,
                      store: opened.store,
                      state: delivery,
                      generation,
                      subject: request.input.subject,
                      maximumBytes: request.input.maximumBytes,
                    }),
                  })
                : request.operation === "delivery.watch"
                  ? Object.freeze({
                      kind: "watch" as const,
                      scope: "delivery" as const,
                      changed: request.input.afterGeneration === null ||
                        request.input.afterGeneration !== generation.digest,
                      generation: generation.digest,
                      inbox: null,
                      delivery: compileDeliveryView({
                        store: opened.store,
                        physical,
                        repository: observed.repository,
                        investment: readInvestment(options.investment),
                      }),
                    })
                  : null;
          const head = headReference(opened.store, delivery);
          const afterDelivery = publicDeliveryState(opened.store, physical);
          const afterGeneration = compileDeliveryGeneration({
            store: opened.store,
            physical,
            repository: observed.repository,
            state: afterDelivery,
          });
          const after = await opened.store.verifyIntegrity();
          assertStableStoreRead({ before, after, delivery, afterDelivery, head });
          if (generation.digest !== afterGeneration.digest) {
            throw new FoundationError(
              "lifecycle.runtime-read.control-generation-mixed",
              "Delivery generation changed while its coherent read model was compiled",
              { retryable: true },
            );
          }
          const afterRepository = await observeDeliveryRepositoryForRead({
            owners,
            target: request.target,
            observedAt: FoundationRfc3339Schema.parse(now()),
          });
          assertStableRepositoryRead(observed, afterRepository);
          if (
            request.operation !== "delivery.watch" ||
            value === null || !("kind" in value) || value.kind !== "watch" ||
            value.changed || Date.now() >= watchDeadline
          ) {
            return readResult({
              request,
              observedAt,
              repository: observed.repository,
              delivery,
              head,
              status: "completed",
              diagnostics: Object.freeze([
                ...observed.diagnostics,
                ...(leaseDiagnostic === null ? [] : [leaseDiagnostic]),
              ]),
              value,
            });
          }
        } catch (error) {
          return readResult({
            request,
            observedAt,
            repository: observed.repository,
            delivery: null,
            head: null,
            status: "refused",
            diagnostics: Object.freeze([...observed.diagnostics, publicFailure(error)]),
          });
        } finally {
          opened?.store.close();
        }
        await waitForReadChange(Math.min(250, Math.max(1, watchDeadline - Date.now())));
        observedAt = FoundationRfc3339Schema.parse(now());
        try {
          observed = await observeDeliveryRepositoryForRead({
            owners,
            target: request.target,
            observedAt,
          });
        } catch (error) {
          observed = Object.freeze({
            repository: emptyRepositoryObservation(),
            diagnostics: Object.freeze([publicFailure(error)]),
          });
        }
        if (observed.repository.targetId === null) {
          return readResult({
            request,
            observedAt,
            repository: observed.repository,
            delivery: null,
            head: null,
            status: "refused",
            diagnostics: observed.diagnostics,
          });
        }
      }
    },
  });
}
