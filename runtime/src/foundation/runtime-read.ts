import {
  FoundationChangeFactsSchema,
  FoundationDeliveryInboxRowSchema,
  FoundationDiagnosticSchema,
  FoundationRepositoryObservationSchema,
  FoundationRfc3339Schema,
  FoundationRuntimeObservationSchema,
  createFoundationRuntimeOperationResult,
  parseFoundationRuntimeOperationRequest,
  type FoundationChangeFacts,
  type FoundationContextInspectionSelector,
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
import { compileFoundationContextInspection, foundationArtifactInspectionSelection } from "./read-model/context-inspection-runtime.js";
import { resolveFoundationInspectionSelection } from "./read-model/inspection-selection.js";
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

const CONTEXT_INSPECTION_KINDS = new Set<FoundationContextInspectionSelector["kind"]>([
  "knowledge-index",
  "knowledge-record",
  "code-index",
  "code-file",
  "atlas-overview",
  "atlas-point",
  "atlas-resource",
  "source",
  "authorization-review",
]);

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

type FoundationRuntimeInspectSelector = Extract<
  FoundationRuntimeReadRequest,
  { operation: "delivery.inspect" }
>["input"];

function isContextInspectionSelector(
  selector: FoundationRuntimeInspectSelector,
): selector is FoundationContextInspectionSelector {
  return CONTEXT_INSPECTION_KINDS.has(selector.kind as FoundationContextInspectionSelector["kind"]);
}

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
    schema: "lifecycle.repository-observation.v17",
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
    schema: "lifecycle.repository-observation.v17",
    initialized: true,
    valid: false,
    targetId: epoch.contract.targetId,
    repositoryContract: "lifecycle.repository.v22",
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
    schema: "lifecycle.repository-observation.v17",
    repositoryContract: "lifecycle.repository.v22",
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
 * Observe one repository-v22 epoch and compile only its bounded v17 public
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
    repository.repositoryContract === "lifecycle.repository.v22" &&
    repository.repositoryContractDigest !== null &&
    repository.headCommit !== null &&
    repository.headTree !== null &&
    repository.productDigest !== null &&
    repository.atlas !== null &&
    repository.checkBindingsDigest !== null;
  const identityComplete = repository.targetId !== null &&
    repository.repositoryContract === "lifecycle.repository.v22" &&
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
      "A valid repository observation must bind one complete initialized repository-v22 epoch",
    );
  }
  if (repository.initialized && !coreComplete && !identityComplete) {
    throw new FoundationError(
      "lifecycle.runtime-read.repository-observation",
      "An initialized repository observation must bind either its complete repository-v22 core or exact raw identity",
    );
  }
  if (!repository.initialized && boundValues.some((value) => value !== null)) {
    throw new FoundationError(
      "lifecycle.runtime-read.repository-observation",
      "An uninitialized repository observation cannot expose repository-v22 epoch fields",
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
    schema: "lifecycle.foundation-runtime-observation.v17",
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

type StableInspectionSelector = Extract<FoundationRuntimeInspectSelector, { kind: "record" }> |
  Exclude<FoundationContextInspectionSelector, { kind: "authorization-review" }>;

/** An exact retained artifact is independent of later operation checkpoints and Journal appends. */
async function readStableInspection(input: Readonly<{
  request: Extract<FoundationRuntimeReadRequest, { operation: "delivery.inspect" }> & Readonly<{
    input: StableInspectionSelector;
  }>;
  machineHome: string;
  owners: FoundationRuntimeReadOwners;
  opened: OpenedDeliveryControlRecordStore;
  delivery: FoundationDeliveryState;
  repository: FoundationRepositoryReadObservation;
  now: () => string;
}>): Promise<FoundationRuntimeOperationResult> {
  const physical = physicalDisposition(input.opened);
  const originalHead = headReference(input.opened.store, input.delivery);
  const value = input.request.input.kind === "record"
    ? inspectDeliveryControl(input.opened.store, physical, input.request.input)
    : await compileFoundationContextInspection({
        machineHome: input.machineHome, target: input.request.target, store: input.opened.store,
        state: input.delivery, selector: input.request.input,
        generation: compileDeliveryGeneration({ store: input.opened.store, physical, repository: input.repository.repository, state: input.delivery }),
      });

  const observedAt = FoundationRfc3339Schema.parse(input.now());
  const repository = await observeDeliveryRepositoryForRead({
    owners: input.owners, target: input.request.target, observedAt,
  });
  if (
    repository.repository.targetId !== input.repository.repository.targetId ||
    repository.repository.repositoryContract !== input.repository.repository.repositoryContract ||
    !repository.repository.initialized
  ) {
    throw new FoundationError(
      "lifecycle.runtime-read.repository-epoch-mixed",
      "Exact artifact inspection lost the selected target and repository contract identity",
      { retryable: true },
    );
  }

  const final = await input.owners.openDeliveryStore({
    machineHome: input.machineHome,
    targetId: repository.repository.targetId!,
    deliveryId: input.request.deliveryId,
    readOnly: true,
  });
  if (final === null) {
    throw new FoundationError(
      "lifecycle.runtime-read.delivery-absent",
      "Exact artifact inspection lost its selected Control Record Store custody",
      { retryable: true },
    );
  }
  try {
    const finalPhysical = physicalDisposition(final);
    if (
      canonicalJson(final.identity) !== canonicalJson(input.opened.identity) ||
      canonicalJson(finalPhysical) !== canonicalJson(physical)
    ) {
      throw new FoundationError(
        "lifecycle.runtime-read.control-epoch-mixed",
        "Exact artifact inspection requires unchanged Store identity and physical custody",
        { retryable: true },
      );
    }
    // verifyIntegrity updates the Store-owned replay. Read its state afterwards;
    // the first connection's replay cannot establish the final selection.
    await final.store.verifyIntegrity();
    const delivery = publicDeliveryState(final.store, finalPhysical);
    const retainedHead = originalHead === null ? null
      : final.store.listEvents(originalHead.sequence - 1, 1)[0] ?? null;
    if (
      delivery.journal.eventCount < input.delivery.journal.eventCount ||
      (originalHead !== null && (
        retainedHead === null || retainedHead.sequence !== originalHead.sequence ||
        retainedHead.eventId !== originalHead.eventId || retainedHead.digest !== originalHead.digest
      ))
    ) {
      throw new FoundationError(
        "lifecycle.runtime-read.control-epoch-mixed",
        "Exact artifact inspection requires the original Journal head to remain an exact prefix",
        { retryable: true },
      );
    }
    if (input.request.input.kind === "record") {
      const retained = inspectDeliveryControl(final.store, finalPhysical, input.request.input);
      if (retained.kind !== "record" || value.kind !== "record" || canonicalJson(retained.record) !== canonicalJson(value.record)) {
        throw new FoundationError("lifecycle.control-inspection.reference", "Exact artifact inspection does not reproduce the original complete retained revision");
      }
    } else {
      const selection = foundationArtifactInspectionSelection(input.request.input);
      if (selection === null) throw new TypeError("Stable inspection requires an artifact selection");
      resolveFoundationInspectionSelection(final.store, selection);
    }
    return readResult({
      request: input.request, observedAt, repository: repository.repository,
      delivery, head: headReference(final.store, delivery), status: "completed",
      diagnostics: repository.diagnostics, value,
    });
  } finally {
    final.store.close();
  }
}

function readOperation(value: FoundationRuntimeOperationRequest): value is FoundationRuntimeReadRequest {
  return READ_OPERATIONS.has(value.operation as FoundationRuntimeReadOperation);
}

function readInvestment(
  value: Readonly<{ model: string; reasoning: string }> | null | undefined,
): Readonly<{ model: string; reasoning: string }> | null {
  return value == null ? null : Object.freeze(value);
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
 * Construct the read-only v17 operation surface. Store discovery is exact and
 * no read path appends an event, creates a revision, or changes repository
 * state.
 */
export function createFoundationRuntimeReadSurface(options: Readonly<{
  machineHome: string | null;
  investment?: Readonly<{ model: string; reasoning: string }> | null;
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
          "The read surface accepts only repository validation and Delivery read operations",
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
          if (request.operation === "delivery.inspect" && (request.input.kind === "record" ||
              (isContextInspectionSelector(request.input) && request.input.kind !== "authorization-review"))) {
            return await readStableInspection({
              request: { ...request, input: request.input }, machineHome: machineHome!,
              owners, opened, delivery, repository: observed, now,
            });
          }
          const generation = compileDeliveryGeneration({
            store: opened.store,
            physical,
            repository: observed.repository,
            state: delivery,
          });
          const value = request.operation === "delivery.inspect"
            ? isContextInspectionSelector(request.input)
              ? await compileFoundationContextInspection({
                  machineHome: machineHome!,
                  target: request.target,
                  store: opened.store,
                  state: delivery,
                  generation,
                  selector: request.input,
                })
              : inspectDeliveryControl(opened.store, physical, request.input, {
                  repository: observed.repository,
                  investment: readInvestment(options.investment),
                  generation,
                  observedAt,
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
                        observedAt,
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
