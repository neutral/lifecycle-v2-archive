import { installedHarness, type InstalledHarness, type AgentCellFixtureOutputProducer } from "../support/agent-cell-runtime-fixture.js";
import { FoundationError } from "../../src/foundation/error.js";
import { createFoundationDockerExecutionBackend, type FoundationDockerEngineDriverV1 } from "../../src/foundation/execution/docker-backend.js";
import { foundationDockerExecutionBackendProfileV1 } from "../../src/foundation/execution/docker-profile-v1.js";
import { createFoundationAgentCellOperatorV1, FoundationAgentCellInputTransportRegistryV1 } from "../../src/foundation/execution/installed-agent-runtime-v1.js";
import { createFoundationExecutionOutputStoreV1 } from "../../src/foundation/execution/output-store-v1.js";
import type { FoundationExecutionBackend } from "../../src/foundation/execution/backend.js";
import { openFoundationExecutionReclamationLedgerV1 } from "../../src/foundation/execution/reclamation-ledger-v1.js";
import { preDispatchAbsenceBackend } from "../support/pre-dispatch-absence-backend.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  compileProviderInputV4,
} from "../../src/foundation/attempt/provider-input-v4.js";
import {
  operateFoundationAgentCellV1,
} from "../../src/foundation/attempt/execution-cell-v1.js";
import {
  retainExecutionReceipt,
} from "../../src/foundation/control/execution-receipt.js";
import {
  openControlRecordStore,
  type ControlRecordStore,
} from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlJsonObject,
} from "../../src/foundation/control/types.js";
import {
  inspectFoundationAgentActivityV7,
  operateFoundationAgentActivityV7,
  recoverFoundationAgentActivityV7,
  type FoundationAgentOperationV7Options,
  type FoundationPreparationAgentOperationV7Input,
} from "../../src/foundation/process/agent-operation-v7.js";
import {
  defaultCapabilityProfiles,
  FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR,
} from "../../src/foundation/repository/contract.js";
import {
  FOUNDATION_GENERATED_PUBLICATION_DIGEST,
  FOUNDATION_GENERATED_SPECIFICATION_REVISION,
} from "../../src/foundation/validation/generated-schemas.js";
import {
  canonicalJsonLine,
  digestCanonical,
  selfDigest,
  sha256Bytes,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";
import {
  foundationAttemptProjectionFixture,
  type FoundationAttemptProjectionOrientationSubject,
} from "../helpers/foundation-attempt-projection-fixture.js";
import {
  executionContractFixture,
} from "../support/execution-contract-fixture.js";

const RUNTIME = "foundation-runtime";
const TARGET = "agent-operation-v7-target";
const DELIVERY = "agent-operation-v7-delivery";

function digest(label: string): Sha256 {
  return sha256Bytes(`foundation-agent-operation-v7:${label}`);
}

function object(value: unknown, label: string): ControlJsonObject {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), label);
  return value as ControlJsonObject;
}

function rootTokenSetDigest(): Sha256 {
  return digestCanonical(Object.freeze({
    schema: "lifecycle.agent-root-token-set.v3",
    tokens: Object.freeze(["input-bundle", "semantic-workspace"]),
  }));
}

function clock(start = "2026-09-01T00:00:01.000Z"): () => string {
  let value = Date.parse(start);
  return () => new Date(value += 1).toISOString();
}

function orientationSubject(): FoundationAttemptProjectionOrientationSubject {
  const objective = "Reconnoiter the fresh target and propose one exact Work Boundary.";
  const value = Object.freeze({
    kind: "orientation" as const,
    objective,
    objectiveDigest: sha256Bytes(Buffer.from(objective, "utf8")),
    atlasStateDigest: digest("preparation-atlas"),
    knowledgeObservationDigest: digest("preparation-knowledge-observation"),
    knowledgeSetDigest: null,
  });
  return Object.freeze({ ...value, digest: selfDigest(value) });
}

async function freshStore(root: string): Promise<ControlRecordStore> {
  const store = await openControlRecordStore({
    root,
    create: true,
    identity: Object.freeze({
      schema: CONTROL_RECORD_STORE_SCHEMA,
      storeId: "store-agent-operation-v7",
      targetId: TARGET,
      processKind: "delivery" as const,
      processId: DELIVERY,
      createdAt: "2026-09-01T00:00:00.000Z",
    }),
  });
  store.append({ event: Object.freeze({
    eventId: "event-delivery-created-agent-operation-v7",
    eventKind: "delivery-created",
    occurredAt: "2026-09-01T00:00:00.000Z",
    actor: Object.freeze({ kind: "runtime" as const, id: RUNTIME }),
    payload: Object.freeze({}),
  }) });
  return store;
}

async function fixture(
  t: TestContext,
  salt: string,
  options: Readonly<{
    invalidAuthoringCarrier?: boolean;
    produceOutput?: AgentCellFixtureOutputProducer;
    now?: () => string;
    wrapBackend?: (backend: FoundationExecutionBackend) => FoundationExecutionBackend;
  }> = Object.freeze({}),
): Promise<Readonly<{
  store: ControlRecordStore;
  request: FoundationPreparationAgentOperationV7Input;
  harness: InstalledHarness;
}>> {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), `lifecycle-agent-op-${salt}-`)));
  const machineHome = join(workspace, "machine");
  const codexHome = join(machineHome, "codex-home");
  const targetRepository = join(workspace, "target");
  await mkdir(machineHome, { mode: 0o700 });
  await Promise.all([
    mkdir(codexHome, { mode: 0o700 }),
    mkdir(targetRepository, { mode: 0o700 }),
  ]);
  const store = await freshStore(join(machineHome, "store"));
  const capability = defaultCapabilityProfiles()["local-development-v1"]!;
  const projection = foundationAttemptProjectionFixture(orientationSubject(), {
    capability: Object.freeze({ profileId: capability.id, profileDigest: capability.digest }),
  });
  const roleSubject: ControlJsonObject = Object.freeze({
    schema: "lifecycle.preparation-role-subject.test.v1",
    objectiveDigest: digest("preparation-objective"),
    boundary: null,
    candidate: null,
    seal: null,
  });
  const directorSemanticMarkdown =
    "# Frame\n\nReconnoiter the fresh target and propose one coherent boundary.\n";
  const providerInput = compileProviderInputV4({
    projection,
    operation: "delivery.prepare",
    roleSubjectDigest: digestCanonical(roleSubject),
    rootTokenSetDigest: rootTokenSetDigest(),
    capability: Object.freeze({
      candidateWrites: false,
      temporaryWrites: capability.temporaryWrites,
      subprocesses: capability.subprocesses,
      network: "none" as const,
      credentials: "none" as const,
      externalEffects: Object.freeze([]),
    }),
    directorSemanticMarkdown,
  });
  const investmentValue = Object.freeze({
    id: "investment-agent-operation-v7",
    model: "gpt-5.6-sol",
    reasoning: "high",
    wallTimeMs: 30_000,
    limits: Object.freeze({
      tokens: null,
      events: 50,
      outputBytes: 64 * 1024,
      toolCalls: null,
      processes: 4,
      storageBytes: 1024 * 1024,
    }),
    rationale: "execution-cell-orchestration",
  });
  const selectedImage = executionContractFixture("agent-operation-v7").image;
  const now = options.now ?? clock();
  const request: FoundationPreparationAgentOperationV7Input = Object.freeze({
    store,
    configuration: Object.freeze({
      machineHome,
      installationId: `installation.lifecycle.${"1".repeat(64)}`,
      codexHome,
      model: "gpt-5.6-sol",
      reasoning: "high",
      specificationRevision: FOUNDATION_GENERATED_SPECIFICATION_REVISION,
      publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
      execution: Object.freeze({
        dockerExecutable: join(workspace, "docker"),
        dockerExecutableDigest: digest("docker-executable"),
        engineEndpoint: "unix:///private/test/docker.sock",
        dockerConfigDirectory: join(workspace, "docker-config"),
        image: Object.freeze({
          imageId: selectedImage.imageId,
          imageDigest: selectedImage.imageDigest,
          immutableReference: `${selectedImage.imageId}@${selectedImage.imageDigest}`,
          configurationDigest: digest("image-configuration"),
          platform: Object.freeze({ os: "linux" as const, architecture: "amd64" as const, variant: null }),
          nonRootUser: "65532:65532",
          runnerContractId: "lifecycle.execution-cell-runner.v1" as const,
          runnerContractDigest: digest("runner-contract"),
          runnerImplementationDigest: digest("runner-implementation"),
          toolInventoryDigest: digest("tool-inventory"),
          agentProvider: Object.freeze({
            codexVersion: "0.153.4",
            executableIdentity: digest("agent-executable"),
            adapterImplementationDigest: digest("runner-implementation"),
          }),
        }),
      }),
    }),
    activityId: `activity-prepare-${salt}`,
    operation: "delivery.prepare",
    preparationBasis: (() => {
      const snapshot = Object.freeze({
        targetId: TARGET, commit: "1".repeat(40), tree: "2".repeat(40), objectFormat: "sha1" as const,
        contractDigest: digest("contract"), productStateDigest: digest("product"),
        atlasStateDigest: digest("atlas"), atlasResolutionDigest: digest("atlas-resolution"),
        atlasNormalizedModelDigest: digest("atlas-normalized"), atlasResourceBindingsDigest: digest("atlas-resources"),
        knowledgeSetDigest: digest("knowledge"),
      });
      return Object.freeze({ snapshot: Object.freeze({ ...snapshot, digest: digestCanonical(snapshot) }), basisDigest: digest("preparation-basis") });
    })(),
    runtimeId: RUNTIME,
    agentId: "agent-reconnaissance-test",
    opening: Object.freeze({
      semanticMarkdown: directorSemanticMarkdown,
      submittedAt: "2026-09-01T00:00:00.001Z",
      startedAt: "2026-09-01T00:00:00.002Z",
      attemptCreatedAt: "2026-09-01T00:00:00.003Z",
      directorId: "director-test",
    }),
    boundary: null,
    candidate: null,
    seal: null,
    projection,
    providerInput,
    targetRepository,
    roleSubject,
    capabilityProfile: Object.freeze({ id: capability.id, digest: capability.digest }),
    investment: Object.freeze({ ...investmentValue, digest: digestCanonical(investmentValue) }),
    evidenceSetDigest: null,
    propositionSet: null,
    revalidateBeforeIntent: async () => undefined,
    finalizeRoleControl: async (context) => {
      assert.equal(context.operation, "delivery.prepare");
      assert.equal(context.workProduct, null);
      return Object.freeze({ outcome: "abandoned" as const });
    },
  });
  const harness = installedHarness({
    machineHome,
    now,
    invalidAuthoringCarrier: options.invalidAuthoringCarrier,
    produceOutput: options.produceOutput,
    wrapBackend: options.wrapBackend,
  });
  t.after(async () => {
    try { store.close(); } catch { /* already closed */ }
    await rm(workspace, { recursive: true, force: true });
  });
  return Object.freeze({ store, request, harness });
}

function activityEvents(store: ControlRecordStore, activityId: string) {
  return store.listEvents(0, 10_000).filter((event) => event.payload.activityId === activityId);
}

test("Agent orchestration runs one exact Attempt through a retired Execution Cell", async (t) => {
  const selected = await fixture(t, "success");
  const result = await operateFoundationAgentActivityV7(
    selected.request,
    selected.harness.options,
  );
  assert.equal(result.outcome, "abandoned");
  assert.equal(result.workProduct, null);
  const attempt = selected.store.getRevision(result.attempt.id, result.attempt.revision)!;
  const receipt = selected.store.getRevision(result.receipt.id, result.receipt.revision)!;
  const attemptProvider = object(attempt.payload.provider, "Attempt Provider binding");
  const attemptExecution = object(attempt.payload.execution, "Attempt Execution binding");
  const attemptInputSet = object(attemptExecution.inputSet, "Attempt Input Set binding");
  const attemptExecutionPolicy = object(
    attempt.payload.executionPolicy,
    "Attempt execution policy",
  );
  const receiptExecution = object(receipt.payload.execution, "Receipt Execution facts");
  const receiptContainment = object(receipt.payload.containment, "Receipt containment facts");
  const receiptRetirement = object(receipt.payload.retirement, "Receipt retirement facts");
  assert.equal(attempt.payload.schema, "lifecycle.agent-attempt-payload.v3");
  assert.equal(attemptProvider.adapter, "lifecycle.provider-adapter.v7");
  assert.equal(attemptProvider.executableIdentityClass,
    FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR.provider.executableIdentityClass);
  assert.equal(attemptInputSet.profileId, "lifecycle.execution-input-set.v2");
  assert.deepEqual(Object.keys(attemptExecutionPolicy).sort(), [
    "cancellationPolicyDigest",
    "containmentPolicyDigest",
    "parentLossPolicyDigest",
    "recoveryPolicyDigest",
    "retirementPolicyDigest",
  ]);
  assert.equal(receipt.payload.schema, "lifecycle.execution-receipt-payload.v3");
  assert.equal(receiptExecution.specificationDigest, selected.harness.specificationDigest());
  assert.equal(receiptContainment.classification, "contained");
  assert.equal(receiptRetirement.classification, "retired");
  const events = activityEvents(selected.store, selected.request.activityId);
  const attemptEvent = events.find(({ eventKind }) => eventKind === "agent-attempt-prepared")!;
  const intentEvent = events.find(({ eventKind }) => eventKind === "provider-effect-intended")!;
  assert.equal(intentEvent.sequence, attemptEvent.sequence + 1);
  assert.equal(intentEvent.payload.effectDigest, receiptExecution.specificationDigest);
  assert.equal(events.filter(({ eventKind }) => eventKind === "provider-effect-observed").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "execution-receipt-recorded").length, 1);
  assert.equal(selected.harness.engine.productiveStartCount(
    receiptExecution.specificationDigest as Sha256,
  ), 1);
  assert.equal(selected.store.getOperationSupport(selected.request.activityId), null);
});

test("Agent recovery observes the same dispatched Handle without redispatch", async (t) => {
  const selected = await fixture(t, "recovery");
  selected.harness.engine.armFault("dispatch-after-start-before-return");
  await assert.rejects(operateFoundationAgentActivityV7(
    selected.request,
    selected.harness.options,
  ));
  const interrupted = inspectFoundationAgentActivityV7(
    selected.store,
    selected.request.activityId,
    "delivery.prepare",
  );
  assert.equal(interrupted.stage, "effect-intended");
  assert.notEqual(interrupted.execution?.dispatchAuthorityConsumedAt, null);
  assert.notEqual(interrupted.executionSelection,null);
  const oldImage = interrupted.executionSelection!.image;
  const configuration = Object.freeze({...selected.request.configuration,model:"new-default-model",reasoning:"new-default-reasoning",
    execution:Object.freeze({image:Object.freeze({...selected.request.configuration.execution!.image,
      imageId:"image.new-default",imageDigest:digest("new-default-image"),
      immutableReference:`registry.example/new@${digest("new-default-image")}`,
      configurationDigest:digest("new-default-image-configuration"),
    })})});
  const recovered = await recoverFoundationAgentActivityV7(
    {...selected.request,configuration},
    {...selected.harness.options,
      compileInstalled:() => {throw new Error("Recovery must not reselect today's installed defaults");},
      openInstalled:async (input) => {
        assert.deepEqual(input.image,oldImage);
        assert.deepEqual(input.installed,interrupted.executionSelection!.compiled.installed);
        return selected.harness.options.openInstalled!(input);
      },
    },
  );
  const receipt = selected.store.getRevision(recovered.receipt.id, recovered.receipt.revision)!;
  const specificationDigest = object(
    receipt.payload.execution,
    "Recovered Receipt Execution facts",
  ).specificationDigest as Sha256;
  assert.equal(selected.harness.engine.productiveStartCount(specificationDigest), 1);
  const events = activityEvents(selected.store, selected.request.activityId);
  assert.equal(events.filter(({ eventKind }) => eventKind === "agent-attempt-prepared").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "provider-effect-intended").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "execution-receipt-recorded").length, 1);
});

test("pre-intent refusal remains subjectless and allocates no productive execution", async (t) => {
  const selected = await fixture(t, "pre-intent-refusal");
  const request: FoundationPreparationAgentOperationV7Input = Object.freeze({
    ...selected.request,
    revalidateBeforeIntent: async () => {
      throw new Error("pre-intent-refused-by-test");
    },
  });
  await assert.rejects(
    operateFoundationAgentActivityV7(request, selected.harness.options),
    /pre-intent refusal/u,
  );
  const events = activityEvents(selected.store, request.activityId);
  const refusal = events.filter(({ eventKind }) => eventKind === "agent-pre-intent-refused");
  assert.equal(refusal.length, 1);
  assert.equal(refusal[0]!.subject, null);
  assert.equal(events.filter(({ eventKind }) => eventKind === "agent-attempt-prepared").length, 0);
  assert.equal(events.filter(({ eventKind }) => eventKind === "provider-effect-intended").length, 0);
  assert.equal(events.filter(({ eventKind }) => eventKind === "execution-receipt-recorded").length, 0);
  const specificationDigest = selected.harness.specificationDigest();
  assert.notEqual(specificationDigest, null);
  assert.equal(selected.harness.engine.productiveStartCount(specificationDigest!), 0);
  assert.equal(selected.store.getOperationSupport(request.activityId), null);
});

test("delayed recovery before dispatch abandons through one subjectless refusal and permits fresh work", async (t) => {
  let milliseconds = Date.parse("2026-09-01T00:00:01.000Z");
  const selected = await fixture(t, "delayed-before-dispatch", {
    now: () => new Date(milliseconds += 1).toISOString(),
  });
  let interrupted = false;
  const options: FoundationAgentOperationV7Options = {
    ...selected.harness.options,
    async openInstalled(selection) {
      const opened = await selected.harness.options.openInstalled!(selection);
      return {
        ...opened,
        async operate(input) {
          const delegate = input.activityOwner;
          return await opened.operate({
            ...input,
            activityOwner: {
              ...delegate,
              async commitSupport(mutation) {
                const retained = await delegate.commitSupport(mutation);
                if (!interrupted && mutation.checkpoint.handle === null) {
                  interrupted = true;
                  throw new Error("Interrupted after durable Cell opening");
                }
                return retained;
              },
            },
          });
        },
      };
    },
  };
  await assert.rejects(operateFoundationAgentActivityV7(selected.request, options));
  const original = inspectFoundationAgentActivityV7(selected.store, selected.request.activityId, "delivery.prepare");
  assert.equal(original.stage, "activity-opened");
  assert.equal(original.execution?.handle, null);
  assert.equal(original.execution?.dispatchAuthorityConsumedAt, null);
  milliseconds += 47 * 60 * 1000;
  await assert.rejects(recoverFoundationAgentActivityV7(selected.request, options), (error: unknown) =>
    error instanceof FoundationError && error.code === "lifecycle.agent-execution-cell-v1.pre-intent-contained");
  const events = activityEvents(selected.store, selected.request.activityId);
  const refusals = events.filter(({ eventKind }) => eventKind === "agent-pre-intent-refused");
  assert.equal(refusals.length, 1);
  assert.equal(refusals[0]!.subject, null);
  assert.equal(refusals[0]!.payload.resolution, "none");
  const recovery = events.find(({ eventKind }) => eventKind === "activity-recovery-recorded")!;
  assert(Date.parse(refusals[0]!.occurredAt) >= Date.parse(recovery.occurredAt));
  assert.equal(events.find(({ eventKind }) => eventKind === "activity-completed")!.payload.outcome, "abandoned");
  assert.equal(events.filter(({ eventKind }) => [
    "agent-attempt-prepared", "provider-effect-intended", "execution-receipt-recorded",
  ].includes(eventKind)).length, 0);
  assert.equal(selected.harness.dispatchCount(), 0);
  assert.equal(await selected.harness.reclamationCount(), 1);
  assert.equal(selected.store.getOperationSupport(selected.request.activityId), null);

  const fresh = await fixture(t, "fresh-after-delayed-refusal");
  const result = await operateFoundationAgentActivityV7(fresh.request, fresh.harness.options);
  assert.notEqual(result.receipt, null);
  assert.equal(fresh.harness.dispatchCount(), 1);
});

test("direct pre-dispatch absence abandons without inventing a containment request", async (t) => {
  const absence: { value: ReturnType<typeof preDispatchAbsenceBackend> | null } = { value: null };
  const selected = await fixture(t, "absent-before-dispatch", {
    wrapBackend(delegate) {
      absence.value = preDispatchAbsenceBackend({
        delegate,
        remove: (handle) => selected.harness.engine.removePhysicalAllocationWithoutObservation(handle),
      });
      return absence.value.backend;
    },
  });
  let removed = false;
  let terminal: ReturnType<typeof inspectFoundationAgentActivityV7>["execution"] = null;
  const options: FoundationAgentOperationV7Options = {
    ...selected.harness.options,
    async openInstalled(selection) {
      const opened = await selected.harness.options.openInstalled!(selection);
      return {
        ...opened,
        async operate(input) {
          const delegate = input.activityOwner;
          const result = await opened.operate({
            ...input,
            activityOwner: {
              ...delegate,
              async commitSupport(mutation) {
                const retained = await delegate.commitSupport(mutation);
                if (!removed && mutation.checkpoint.handle !== null) {
                  removed = true;
                  assert(absence.value !== null);
                  absence.value.markAbsent();
                }
                return retained;
              },
            },
          });
          terminal = inspectFoundationAgentActivityV7(selected.store, selected.request.activityId, "delivery.prepare").execution;
          return result;
        },
      };
    },
  };
  await assert.rejects(operateFoundationAgentActivityV7(selected.request, options), (error: unknown) =>
    error instanceof FoundationError && error.code === "lifecycle.agent-execution-cell-v1.pre-intent-contained");
  assert(terminal !== null);
  const retained = terminal as NonNullable<ReturnType<typeof inspectFoundationAgentActivityV7>["execution"]>;
  assert.equal(retained.containmentRequestedAt, null);
  assert.equal(retained.observation?.allocationState, "absent");
  assert.equal(retained.retirement?.dispatchAuthorityConsumed, false);
  const events = activityEvents(selected.store, selected.request.activityId);
  assert.equal(events.filter(({ eventKind }) => eventKind === "agent-pre-intent-refused").length, 1);
  assert.equal(events.find(({ eventKind }) => eventKind === "activity-completed")!.payload.outcome, "abandoned");
  assert.equal(events.filter(({ eventKind }) => [
    "agent-attempt-prepared", "provider-effect-intended", "execution-receipt-recorded",
  ].includes(eventKind)).length, 0);
  assert.equal(selected.harness.dispatchCount(), 0);
  assert.equal(await selected.harness.reclamationCount(), 1);
  assert.equal(selected.store.getOperationSupport(selected.request.activityId), null);
});

test("unavailable selected execution custody preserves the retained Cell for a later recovery", async (t) => {
  const selected = await fixture(t, "selected-resource-unavailable");
  selected.harness.engine.armFault("dispatch-after-start-before-return");
  await assert.rejects(operateFoundationAgentActivityV7(selected.request, selected.harness.options));
  const before = inspectFoundationAgentActivityV7(selected.store, selected.request.activityId, "delivery.prepare");
  const eventCount = activityEvents(selected.store, selected.request.activityId).length;
  await assert.rejects(recoverFoundationAgentActivityV7(selected.request, {
    ...selected.harness.options,
    compileInstalled: () => { throw new Error("Recovery must not choose replacement execution resources"); },
    openInstalled: async (input) => {
      assert.deepEqual(input.image, before.executionSelection!.image);
      throw new Error("selected immutable execution resource is temporarily unavailable");
    },
  }), /selected immutable execution resource is temporarily unavailable/u);
  const after = inspectFoundationAgentActivityV7(selected.store, selected.request.activityId, "delivery.prepare");
  assert.deepEqual(after.executionSelection, before.executionSelection);
  assert.deepEqual(after.execution, before.execution);
  assert.deepEqual(activityEvents(selected.store, selected.request.activityId).slice(eventCount)
    .map(({eventKind}) => eventKind), ["activity-recovery-recorded"]);
  assert.equal(selected.harness.engine.snapshot().allocations.length, 1);
  const recovered = await recoverFoundationAgentActivityV7(selected.request, selected.harness.options);
  const receipt = selected.store.getRevision(recovered.receipt.id, recovered.receipt.revision)!;
  assert.equal(selected.harness.engine.productiveStartCount(
    object(receipt.payload.execution, "Recovered selected Cell").specificationDigest as Sha256,
  ), 1);
  assert.equal(activityEvents(selected.store, selected.request.activityId)
    .filter(({eventKind}) => eventKind === "provider-effect-intended").length, 1);
  assert.equal(object(receipt.payload.containment,"Recovered Cell containment").classification,"contained");
  assert.equal(object(receipt.payload.retirement,"Recovered Cell Retirement").classification,"retired");
  assert.equal(selected.store.getOperationSupport(selected.request.activityId),null);
});

test("unallocated image refusal settles its original selection and a fresh Delivery can execute", async (t) => {
  const selected = await fixture(t, "unallocated-image-refusal");
  const profile = foundationDockerExecutionBackendProfileV1();
  let imageFailure: unknown = new Error("temporarily unavailable image observation");
  let interruptCompletion = false;
  let imageReads = 0;
  let absenceReads = 0;
  let creates = 0;
  const never = async (): Promise<never> => { throw new Error("No physical Cell operation is allowed"); };
  const driver: FoundationDockerEngineDriverV1 = {
    async describe() { return {
      schema: "lifecycle.docker-engine-description.private.v1",
      engineIdentityDigest: digest("unallocated-engine"),
      contractDigest: profile.engineContract.contractDigest,
      compatibilityProfileId: profile.engineContract.compatibilityProfileId,
      compatibleVersion: profile.engineContract.compatibleVersion,
      platform: profile.platforms[0]!,
    }; },
    async inspectImage() { imageReads += 1; throw imageFailure; },
    async allocationResourcesAbsent() { absenceReads += 1; return true; },
    async findCells() { return { cells: [], truncated: false }; },
    inspectCell: never,
    async createCell() { creates += 1; return await never(); },
    consumeDispatch: never, startCell: never, cancelCell: never,
    retrieveOutput: never, removeCell: never,
  };
  const options: FoundationAgentOperationV7Options = {
    ...selected.harness.options,
    now() {
      if (interruptCompletion && activityEvents(selected.store, selected.request.activityId)
        .some(({eventKind}) => eventKind === "agent-pre-intent-refused")) {
        throw new Error("interrupted after refusal retention before completion");
      }
      return selected.harness.options.now!();
    },
    compileInstalled(input) {
      const compiled = selected.harness.options.compileInstalled!(input);
      return { ...compiled, installed: { ...compiled.installed, profile } };
    },
    async openInstalled(input) {
      assert.equal(input.image.imageDigest, selected.request.configuration.execution!.image.imageDigest);
      const ledger = await openFoundationExecutionReclamationLedgerV1({
        machineHome: selected.request.configuration.machineHome,
        installationId: "installation-agent-operation-v7", create: true,
        clock: { now: input.now },
      });
      const backend = await createFoundationDockerExecutionBackend({ profile, driver, now: input.now });
      const operator = createFoundationAgentCellOperatorV1({
        installed: input.installed,
        inputTransport: new FoundationAgentCellInputTransportRegistryV1(),
        runtime: {
          machineHome: selected.request.configuration.machineHome, backend,
          registerOperation() {},
          outputStore: createFoundationExecutionOutputStoreV1({ machineHome: selected.request.configuration.machineHome }),
          reclamation: ledger, clock: { now: input.now }, pollMilliseconds: 0,
        },
      });
      return { ...operator, async reclaimNext() { return false; }, close() { ledger.close(); } };
    },
  };
  await assert.rejects(operateFoundationAgentActivityV7(selected.request, options));
  const original = inspectFoundationAgentActivityV7(selected.store, selected.request.activityId, "delivery.prepare");
  assert.equal(original.stage, "activity-opened");
  assert.equal(original.execution!.handle, null);
  assert.equal(absenceReads, 0);
  imageFailure = new FoundationError("lifecycle.execution.docker-cli-driver.image-substitution", "Exact installed Image is invalid");
  interruptCompletion = true;
  const changedDefaults = { ...selected.request, configuration: {
    ...selected.request.configuration, execution: { image: {
      ...selected.request.configuration.execution!.image,
      imageId: "corrected-image-default", imageDigest: digest("corrected-image-default"),
    } },
  } };
  await assert.rejects(recoverFoundationAgentActivityV7(changedDefaults, options), /interrupted after refusal/u);
  const refused = inspectFoundationAgentActivityV7(selected.store, selected.request.activityId, "delivery.prepare");
  assert.equal(refused.stage, "pre-intent-refused");
  assert.deepEqual(refused.executionSelection, original.executionSelection);
  assert.deepEqual(refused.execution, original.execution);
  const readsAtRefusal = imageReads;
  interruptCompletion = false;
  await assert.rejects(recoverFoundationAgentActivityV7(changedDefaults, {
    ...options,
    compileInstalled() { throw new Error("Retained refusal must not select new defaults"); },
    openInstalled: never,
  }), (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.execution.docker-cli-driver.image-substitution");
  assert.equal(imageReads, readsAtRefusal);
  assert.equal(absenceReads, 1);
  assert.equal(creates, 0);
  assert.equal(selected.store.getOperationSupport(selected.request.activityId), null);
  const events = activityEvents(selected.store, selected.request.activityId);
  assert.equal(events.filter(({eventKind}) => eventKind === "agent-pre-intent-refused").length, 1);
  assert.equal(events.find(({eventKind}) => eventKind === "activity-completed")!.payload.outcome, "abandoned");
  assert.equal(events.filter(({eventKind}) => ["agent-attempt-prepared", "provider-effect-intended", "execution-receipt-recorded"].includes(eventKind)).length, 0);
  assert.equal(await selected.harness.reclamationCount(), 0);
  const corrected = await fixture(t, "corrected-image-selection");
  const next = await operateFoundationAgentActivityV7(corrected.request, corrected.harness.options);
  assert.notEqual(next.receipt, null);
  assert.equal(corrected.harness.dispatchCount(), 1);
});

test("lost refusal commit response resumes the same inert Cell through Retirement", async (t) => {
  const selected = await fixture(t, "pre-intent-refusal-recovery");
  let lostResponse = false;
  let revalidations = 0;
  const request: FoundationPreparationAgentOperationV7Input = Object.freeze({
    ...selected.request,
    revalidateBeforeIntent: async () => {
      revalidations += 1;
      throw new Error("pre-intent-refused-before-lost-response");
    },
  });
  const options: FoundationAgentOperationV7Options = Object.freeze({
    ...selected.harness.options,
    async openInstalled(selection) {
      const opened = await selected.harness.options.openInstalled!(selection);
      return Object.freeze({
        ...opened,
        async operate(input) {
          const delegate = input.activityOwner;
          return await opened.operate(Object.freeze({
            ...input,
            activityOwner: Object.freeze({
              read: delegate.read.bind(delegate),
              commitSupport: delegate.commitSupport.bind(delegate),
              ownerCommitDispatch: delegate.ownerCommitDispatch.bind(delegate),
              async ownerCommitPreIntentRefusal(
                mutation: Parameters<typeof delegate.ownerCommitPreIntentRefusal>[0],
              ) {
                const retained = await delegate.ownerCommitPreIntentRefusal(mutation);
                if (!lostResponse) {
                  lostResponse = true;
                  throw new Error("injected-lost-refusal-owner-response");
                }
                return retained;
              },
            }),
          }));
        },
      });
    },
  });
  await assert.rejects(operateFoundationAgentActivityV7(request, options));
  const interrupted = inspectFoundationAgentActivityV7(
    selected.store,
    request.activityId,
    "delivery.prepare",
  );
  assert.equal(interrupted.stage, "pre-intent-refused");
  assert.equal(interrupted.attempt, null);
  assert.notEqual(interrupted.execution?.handle, null);
  assert.equal(interrupted.execution?.dispatchAuthorityConsumedAt, null);
  assert.notEqual(interrupted.execution?.containment, null);
  assert.equal(interrupted.execution?.output, null);
  assert.equal(interrupted.execution?.retirement, null);
  const handle = interrupted.execution!.handle;
  assert.equal(await selected.harness.reclamationCount(), 0);

  await assert.rejects(
    recoverFoundationAgentActivityV7(request, options),
    /pre-intent refusal/u,
  );
  assert.equal(revalidations, 1);
  assert.equal(selected.harness.engine.snapshot().allocations.length, 1);
  assert.equal(selected.harness.engine.snapshot().allocations[0]?.handle, handle);
  assert.equal(selected.harness.engine.productiveStartCount(
    selected.harness.specificationDigest()!,
  ), 0);
  assert.equal(await selected.harness.reclamationCount(), 1);
  const events = activityEvents(selected.store, request.activityId);
  assert.equal(events.filter(({ eventKind }) => eventKind === "agent-pre-intent-refused").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "agent-attempt-prepared").length, 0);
  assert.equal(events.filter(({ eventKind }) => eventKind === "provider-effect-intended").length, 0);
  assert.equal(selected.store.getOperationSupport(request.activityId), null);
});

test("lost Receipt owner response reuses one Receipt and one productive Cell", async (t) => {
  const selected = await fixture(t, "receipt-recovery");
  let lostResponse = false;
  const options: FoundationAgentOperationV7Options = Object.freeze({
    ...selected.harness.options,
    async retainReceipt(input) {
      const retained = await retainExecutionReceipt(input);
      if (!lostResponse) {
        lostResponse = true;
        throw new Error("injected-lost-receipt-owner-response");
      }
      return retained;
    },
  });
  await assert.rejects(operateFoundationAgentActivityV7(selected.request, options));
  let events = activityEvents(selected.store, selected.request.activityId);
  assert.equal(events.filter(({ eventKind }) => eventKind === "execution-receipt-recorded").length, 1);
  assert.notEqual(selected.store.getOperationSupport(selected.request.activityId), null);

  const recovered = await recoverFoundationAgentActivityV7(selected.request, options);
  const receipt = selected.store.getRevision(recovered.receipt.id, recovered.receipt.revision)!;
  const specificationDigest = object(
    receipt.payload.execution,
    "Recovered Receipt Execution facts",
  ).specificationDigest as Sha256;
  assert.equal(selected.harness.engine.productiveStartCount(specificationDigest), 1);
  events = activityEvents(selected.store, selected.request.activityId);
  assert.equal(events.filter(({ eventKind }) => eventKind === "agent-attempt-prepared").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "provider-effect-intended").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "execution-receipt-recorded").length, 1);
  assert.equal(selected.store.getOperationSupport(selected.request.activityId), null);
});

test("provider failure detail survives a lost Receipt return and disk reopen without another dispatch", async (t) => {
  const bytes = Uint8Array.from(Buffer.from(canonicalJsonLine({
    schema: "lifecycle.agent-provider-failure-diagnostic.private.v1", source: "provider-reported",
    observation: "untrusted-operational-material", truncated: false,
    entries: [{ stream: "stdout-json", eventType: "turn.failed", message: "Selected provider model is unavailable." }],
  }), "utf8"));
  const selected = await fixture(t, "provider-failure-retained", { produceOutput: async () => ({
    providerOutcome: "provider-failure", providerExitCode: 1, entries: [{
      path: "provider-result/failure.json", purpose: "raw-provider-output", mediaType: "application/json",
      modeClass: "regular", bytes,
    }],
  }) });
  let lost = false;
  const options: FoundationAgentOperationV7Options = {
    ...selected.harness.options,
    async retainReceipt(input) {
      const retained = await retainExecutionReceipt(input);
      if (!lost) { lost = true; throw new Error("lost-provider-failure-receipt-return"); }
      return retained;
    },
  };
  await assert.rejects(operateFoundationAgentActivityV7(selected.request, options), /lost-provider-failure-receipt-return/u);
  const firstDescriptor = selected.store.listRetainedFiles().find(({ digest }) => digest === sha256Bytes(bytes));
  assert(firstDescriptor);
  const storeRoot = selected.store.paths.root;
  const identity = selected.store.identity;
  selected.store.close();
  const reopened = await openControlRecordStore({ root: storeRoot, identity, create: false });
  t.after(() => reopened.close());
  const result = await recoverFoundationAgentActivityV7({ ...selected.request, store: reopened }, options);
  const receipt = reopened.getRevision(result.receipt.id, result.receipt.revision)!;
  const materials = receipt.payload.rawMaterials;
  assert(Array.isArray(materials));
  assert.deepEqual(materials, [{ availability: "retained", reference: {
    digest: sha256Bytes(bytes), byteLength: bytes.byteLength, mediaType: "application/json", purpose: "raw-provider-output",
  } }]);
  assert.doesNotMatch(receipt.semanticMarkdown, /Selected provider model is unavailable/u);
  assert.match(receipt.semanticMarkdown, /untrusted operational material/u);
  const retained = await reopened.readRetainedFile(sha256Bytes(bytes));
  assert.deepEqual(retained, { descriptor: firstDescriptor, bytes });
  assert.equal(object(receipt.payload.provider, "Provider facts").terminalReason, "provider-failure");
  assert.equal(selected.harness.engine.productiveStartCount(
    object(receipt.payload.execution, "Execution").specificationDigest as Sha256), 1);
  assert.equal(activityEvents(reopened, selected.request.activityId)
    .filter(({ eventKind }) => eventKind === "execution-receipt-recorded").length, 1);
  assert.equal(reopened.getOperationSupport(selected.request.activityId), null);
});

test("invalid authoring Carrier retains exact terminal Receipt facts through recovery", async (t) => {
  const selected = await fixture(t, "invalid-authoring-receipt-recovery", {
    invalidAuthoringCarrier: true,
  });
  let lostResponse = false;
  const cellResults: Awaited<ReturnType<typeof operateFoundationAgentCellV1>>[] = [];
  const options: FoundationAgentOperationV7Options = Object.freeze({
    ...selected.harness.options,
    async openInstalled(selection) {
      const opened = await selected.harness.options.openInstalled!(selection);
      return Object.freeze({
        ...opened,
        async operate(input) {
          const result = await opened.operate(input);
          cellResults.push(result);
          return result;
        },
      });
    },
    async retainReceipt(input) {
      const retained = await retainExecutionReceipt(input);
      if (!lostResponse) {
        lostResponse = true;
        throw new Error("injected-lost-invalid-authoring-receipt-response");
      }
      return retained;
    },
  });

  await assert.rejects(
    operateFoundationAgentActivityV7(selected.request, options),
    /injected-lost-invalid-authoring-receipt-response/u,
  );
  assert.equal(cellResults.length, 1);
  const firstCell = cellResults[0]!;
  assert.equal(firstCell.terminal.outputValidation, "invalid");
  assert.equal(firstCell.validatedOutput, null);
  assert.equal(firstCell.providerResult, null);
  assert.equal(firstCell.semantic.disposition, "unavailable");
  assert.equal(firstCell.candidate.disposition, "not-applicable");
  assert.deepEqual(firstCell.receiptFacts.execution.output, {
    availability: "unavailable",
    carrierByteLength: null,
    carrierDigest: null,
    manifestDigest: null,
  });
  assert.equal(firstCell.receiptFacts.provider?.outcome, "natural-return");
  assert.equal(firstCell.receiptFacts.provider?.stage, "evaluated");
  assert.equal(firstCell.receiptFacts.provider?.productiveStarted, true);
  assert.equal(firstCell.receiptFacts.provider?.exitCode, 0);
  assert.equal(firstCell.receiptFacts.provider?.signal, null);
  assert.equal(firstCell.receiptFacts.provider?.sessionId, "agent-operation-v7-session");

  let events = activityEvents(selected.store, selected.request.activityId);
  assert.equal(events.filter(({ eventKind }) => eventKind === "execution-receipt-recorded").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "activity-completed").length, 0);
  assert.equal(events.filter(({ eventKind }) => eventKind === "candidate-revision-observed").length, 0);
  const interrupted = inspectFoundationAgentActivityV7(
    selected.store,
    selected.request.activityId,
    "delivery.prepare",
  );
  assert.notEqual(interrupted.execution?.terminalCompletion, null);
  assert.equal(interrupted.execution?.output?.validation, "invalid");
  assert.notEqual(interrupted.execution?.retirement, null);
  assert.equal(
    interrupted.execution?.retirement?.terminalCompletionDigest,
    interrupted.execution?.terminalCompletion?.digest,
  );
  assert.equal(selected.harness.dispatchCount(), 1);
  assert.equal(selected.harness.engine.productiveStartCount(firstCell.specification.digest), 1);
  assert.equal(await selected.harness.reclamationCount(), 1);

  const recovered = await recoverFoundationAgentActivityV7(selected.request, options);
  assert.equal(recovered.outcome, "abandoned");
  assert.equal(recovered.workProduct, null);
  assert.equal(recovered.candidate, null);
  assert.equal(cellResults.length, 2);
  assert.deepEqual(cellResults[1]!.receiptFacts, firstCell.receiptFacts);
  assert.deepEqual(cellResults[1]!.terminal, firstCell.terminal);
  assert.equal(selected.harness.dispatchCount(), 1);
  assert.equal(selected.harness.engine.productiveStartCount(firstCell.specification.digest), 1);
  assert.equal(await selected.harness.reclamationCount(), 1);

  const receipt = selected.store.getRevision(recovered.receipt.id, recovered.receipt.revision)!;
  const attempt = selected.store.getRevision(recovered.attempt.id, recovered.attempt.revision)!;
  const attemptProvider = object(attempt.payload.provider, "Recovered Attempt Provider facts");
  const provider = object(receipt.payload.provider, "Recovered Receipt Provider facts");
  const providerEffect = object(
    receipt.payload.providerEffect,
    "Recovered Receipt provider effect",
  );
  const execution = object(receipt.payload.execution, "Recovered Receipt Execution facts");
  const output = object(execution.output, "Recovered Receipt Output facts");
  const workspace = object(receipt.payload.workspace, "Recovered Receipt workspace facts");
  const workProduct = object(receipt.payload.workProduct, "Recovered Receipt Work Product facts");
  const candidate = object(receipt.payload.candidate, "Recovered Receipt Candidate facts");
  const containment = object(receipt.payload.containment, "Recovered Receipt Containment facts");
  const retirement = object(receipt.payload.retirement, "Recovered Receipt Retirement facts");
  assert.equal(providerEffect.outcome, "completed");
  assert.equal(receipt.payload.productiveExecutionStarted, true);
  assert.equal(provider.observedExecutableIdentity, attemptProvider.installedIdentityDigest);
  assert.equal(provider.sessionId, "agent-operation-v7-session");
  assert.equal(provider.firstTrigger, "natural");
  assert.equal(provider.terminalReason, "natural-completion");
  assert.equal(provider.stage, "evaluated");
  assert.equal(provider.startedAt, "2026-09-01T00:00:00.020Z");
  assert.equal(provider.finishedAt, "2026-09-01T00:00:00.030Z");
  assert.equal(provider.exitCode, 0);
  assert.equal(provider.signal, null);
  assert.deepEqual(output, {
    availability: "unavailable",
    carrierByteLength: null,
    carrierDigest: null,
    manifestDigest: null,
  });
  assert.equal(workspace.availability, "unavailable");
  assert.notEqual(workspace.failureFactsDigest, null);
  assert.equal(workspace.parserDisposition, "not-run");
  assert.equal(workspace.compilerDisposition, "not-run");
  assert.deepEqual(workProduct, { disposition: "abandoned", reference: null });
  assert.deepEqual(candidate, {
    input: null,
    successorDisposition: null,
    successor: null,
    contentDisposition: null,
  });
  assert.equal(containment.classification, "contained");
  assert.equal(retirement.classification, "retired");
  assert.equal(
    retirement.residualFactsDigest,
    interrupted.execution?.retirement?.reclamationObligation.digest,
  );

  events = activityEvents(selected.store, selected.request.activityId);
  assert.equal(events.filter(({ eventKind }) => eventKind === "agent-attempt-prepared").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "provider-effect-intended").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "provider-effect-observed").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "agent-work-product-abandoned").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "execution-receipt-recorded").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "candidate-revision-observed").length, 0);
  assert.equal(events.filter(({ eventKind }) => eventKind === "activity-completed").length, 1);
  assert.equal(selected.store.getOperationSupport(selected.request.activityId), null);
});

test("execution operator refuses a substituted installed selection before allocation", async (t) => {
  const selected = await fixture(t, "execution-operator-substitution");
  const options: FoundationAgentOperationV7Options = Object.freeze({
    ...selected.harness.options,
    async openInstalled(selection) {
      const opened = await selected.harness.options.openInstalled!(selection);
      return Object.freeze({
        ...opened,
        operate: async (request) => await opened.operate({
          ...request,
          installed: Object.freeze({
            ...request.installed,
            image: Object.freeze({
              ...request.installed.image,
              imageDigest: digest("substituted-execution-image"),
            }),
          }),
        }),
      });
    },
  });
  await assert.rejects(
    operateFoundationAgentActivityV7(selected.request, options),
    /Agent execution request selected another installed Cell/u,
  );
  assert.equal(selected.harness.engine.snapshot().allocations.length, 0);
  assert.equal(selected.harness.dispatchCount(), 0);
});

test("missing execution owner refuses without opening production mechanics", async (t) => {
  const selected = await fixture(t, "execution-owner-unavailable");
  const { openInstalled: _openInstalled, ...options } = selected.harness.options;
  await assert.rejects(
    operateFoundationAgentActivityV7(selected.request, options),
    /Agent execution requires the installed execution owner/u,
  );
  assert.equal(selected.harness.engine.snapshot().allocations.length, 0);
  assert.equal(selected.harness.dispatchCount(), 0);
});

test("missing Execution Backend refuses without a Runtime-host fallback", async (t) => {
  const selected = await fixture(t, "execution-backend-unavailable");
  const { execution: _execution, ...unconfigured } = selected.request.configuration;
  const request: FoundationPreparationAgentOperationV7Input = Object.freeze({
    ...selected.request,
    configuration: Object.freeze(unconfigured),
  });
  await assert.rejects(
    operateFoundationAgentActivityV7(request, selected.harness.options),
    /requires one installed Execution Image with Agent provider support/u,
  );
  const events = activityEvents(selected.store, request.activityId);
  assert.equal(events.filter(({ eventKind }) => eventKind === "agent-attempt-prepared").length, 0);
  assert.equal(events.filter(({ eventKind }) => eventKind === "provider-effect-intended").length, 0);
  assert.equal(events.filter(({ eventKind }) => eventKind === "agent-pre-intent-refused").length, 0);
  assert.equal(selected.harness.engine.snapshot().allocations.length, 0);
  assert.equal(selected.harness.specificationDigest(), null);
  assert.notEqual(selected.store.getOperationSupport(request.activityId), null);
});
