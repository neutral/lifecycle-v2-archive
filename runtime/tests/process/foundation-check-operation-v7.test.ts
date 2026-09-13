import { checkExecutionOutput } from "../support/check-cell-output-fixture.js";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  publishCandidateRevisionCarrierFromGitTree,
} from "../../src/foundation/candidate/carrier-binding.js";
import {
  compileFoundationCheckCellResourceSelectionV1,
  FoundationCheckCellInputTransportRegistryV1,
  type FoundationCheckCellOperatorV1,
  type FoundationCheckCellRuntimeV1,
} from "../../src/foundation/check/execution-cell-v1.js";
import { createFoundationCheckCellOperatorV1 } from "../../src/foundation/execution/installed-check-runtime-v1.js";
import {
  compileControlRecordEvent,
  compileControlRecordRevision,
} from "../../src/foundation/control/model.js";
import {
  compileControlRecordFile,
  type ControlRecordStore,
} from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_OPERATION_SUPPORT_SCHEMA,
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlJsonObject,
  type ControlRecordEvent,
  type ControlRecordFile,
  type ControlRecordRevision,
  type ControlRecordStoreAppend,
  type ControlRecordStoreIdentity,
} from "../../src/foundation/control/types.js";
import {
  compileWorkDelegationReservation,
  WORK_DELEGATION_RESERVATION_SCHEMA,
  type WorkDelegationExecutionSlot,
} from "../../src/foundation/control/work-delegation.js";
import { FoundationError } from "../../src/foundation/error.js";
import type {
  FoundationExecutionBackend,
  FoundationExecutionHandle,
} from "../../src/foundation/execution/backend.js";
import type {
  FoundationExecutionSpecificationV1,
} from "../../src/foundation/execution/contracts.js";
import {
  FoundationDockerExecutionBindingRegistryV1,
} from "../../src/foundation/execution/docker-binding-registry-v1.js";
import {
  createFoundationExecutionOutputStoreV1,
} from "../../src/foundation/execution/output-store-v1.js";
import {
  openFoundationExecutionReclamationLedgerV1,
} from "../../src/foundation/execution/reclamation-ledger-v1.js";
import {
  operateFoundationCheckV7,
  parseFoundationCheckOperationCheckpointV7,
  type FoundationCheckOperationCheckpointV7,
  type FoundationCheckOperationSupportV7,
} from "../../src/foundation/process/check-operation-v7.js";
import type { ReducedDeliveryState } from "../../src/foundation/process/delivery-reducer.js";
import { git } from "../../src/foundation/repository/git.js";
import type { FoundationCheckBinding } from "../../src/foundation/repository/types.js";
import {
  digestCanonical,
  sha256Bytes,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";
import {
  executionContractFixture,
} from "../support/execution-contract-fixture.js";
import {
  InMemoryExecutionBackendEngine,
} from "../support/in-memory-execution-backend.js";

const CREATED = "2026-08-29T20:00:00.000Z";
const STARTED = "2026-08-29T20:00:01.000Z";
const FINISHED = "2026-08-29T20:00:02.000Z";
const RECORDED = "2026-08-29T20:00:03.000Z";
const ACTIVITY = "activity-check-operation-v7";
const RUNTIME = "foundation-runtime";
const SELECTION = "selection.check.demo";
const BINDING = "binding.check.demo";

function digest(value: string): Sha256 {
  return sha256Bytes(`foundation-check-operation-v7:${value}`);
}

const identity: ControlRecordStoreIdentity = Object.freeze({
  schema: CONTROL_RECORD_STORE_SCHEMA,
  storeId: "store-check-operation-v7",
  targetId: "target-check-operation-v7",
  processKind: "delivery",
  processId: "delivery-check-operation-v7",
  createdAt: CREATED,
});

const binding: FoundationCheckBinding = Object.freeze({
  id: BINDING,
  checkIds: Object.freeze(["check.demo"]),
  subjectSelectors: Object.freeze([Object.freeze({ kind: "repository" as const, selector: "." })]),
  kind: "command",
  executable: Object.freeze({ relativeTo: "execution-image", path: "node" }),
  args: Object.freeze(["--version"]),
  cwd: ".",
  network: "none",
  timeoutMs: 1_000,
  allowedModalities: Object.freeze(["precondition" as const, "postcondition" as const]),
  capabilityProfileId: null,
  environment: Object.freeze({}),
  resultParser: Object.freeze({
    id: "exit-code-v1",
    stateModel: "check-disposition-v2",
    states: Object.freeze([
      "pass", "fail", "indeterminate", "not-run", "unsupported", "operational-error",
    ] as const),
  }),
  mutation: "forbidden",
  implementationDigest: "sha256:6666666666666666666666666666666666666666666666666666666666666666",
  limitations: Object.freeze([]),
  digest: "sha256:5555555555555555555555555555555555555555555555555555555555555555",
});

test("pure Check resource selection includes runner time and preserves exact selected facts", () => {
  const selected = executionContractFixture("check-resource-selection");
  const image = Object.freeze({ ...selected.image, runnerContractDigest: digest("runner-contract"), runnerImplementationDigest: digest("runner-implementation"), toolInventoryDigest: digest("tool-inventory") });
  const before = structuredClone({ binding, profile: selected.profile, image });
  const resources = compileFoundationCheckCellResourceSelectionV1({ binding, profile: selected.profile, image });
  assert.deepEqual(resources, {
    backendProfile: { profileId: selected.profile.profileId, profileDigest: selected.profile.digest, implementationDigest: selected.profile.implementation.implementationDigest },
    image: selected.image,
    limits: { wallTimeMilliseconds: 31_000, processes: 8, storageBytes: 1_048_576, outputEntries: 3, outputBytes: 1_048_576, outputEntryBytes: 1_048_576, events: 100 },
  });
  assert.deepEqual({ binding, profile: selected.profile, image }, before);
  assert.equal(Object.isFrozen(resources), true);
  assert.equal(Object.isFrozen(resources.limits), true);
  for (const [timeoutMs, expected] of [[1, 30_001], [30_000, 60_000], [30_001, 60_000]] as const) {
    assert.equal(compileFoundationCheckCellResourceSelectionV1({ binding: { ...binding, timeoutMs }, profile: selected.profile, image }).limits.wallTimeMilliseconds, expected);
  }
  const changedImage = { ...image, imageDigest: digest("explicitly-selected-other-image") };
  assert.deepEqual(compileFoundationCheckCellResourceSelectionV1({ binding, profile: selected.profile, image: changedImage }).image,
    { imageId: changedImage.imageId, imageDigest: changedImage.imageDigest });
});

function reference(revision: ControlRecordRevision) {
  return Object.freeze({
    kind: revision.recordKind,
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

type SupportHarness = Readonly<{
  adapter: FoundationCheckOperationSupportV7;
  checkpoint(): ControlJsonObject | null;
  commitCount(): number;
  fileCommitCount(): number;
  loseReceiptReturnOnce(): void;
}>;

type FixturePhase = "baseline" | "final";

type PhysicalFixture = Readonly<{
  target: string;
  machineHome: string;
  productBaseCommit: string;
  productBaseTree: string;
  carrier: Readonly<{
    manifestBytes: Uint8Array;
    descriptor: ControlRecordFile;
  }> | null;
}>;

function fixture(
  modality: "precondition" | "postcondition" = "precondition",
  phase: FixturePhase = "baseline",
  physical: PhysicalFixture | null = null,
  delegatedResources: ReturnType<typeof compileFoundationCheckCellResourceSelectionV1> | null = null,
): Readonly<{
  store: ControlRecordStore;
  boundary: ControlRecordRevision;
  support: SupportHarness;
  receipt(): ControlRecordRevision | null;
}> {
  if (phase === "final" && (physical === null || physical.carrier === null)) {
    throw new TypeError("Final Check fixture requires one published Candidate Carrier");
  }
  const payload = validDeliveryControlPayload("work-boundary");
  const mandate = payload.mandate as ControlJsonObject;
  const basis = payload.basis as ControlJsonObject;
  const boundary = compileControlRecordRevision(identity.processId, {
    recordId: "boundary-check-operation-v7",
    recordKind: "work-boundary",
    revision: 1,
    producer: { kind: "runtime", id: RUNTIME },
    semanticAuthor: { kind: "runtime", id: RUNTIME },
    semanticAuthority: "runtime-derived",
    createdAt: CREATED,
    semanticMarkdown: "# Work Boundary\n",
    payload: Object.freeze({
      ...payload,
      targetId: identity.targetId,
      basis: Object.freeze({
        ...basis,
        ...(physical === null ? {} : {
          productBaseCommit: physical.productBaseCommit,
          productBaseTree: physical.productBaseTree,
        }),
      }),
      mandate: Object.freeze({
        ...mandate,
        checks: Object.freeze((mandate.checks as readonly ControlJsonObject[]).map((check, index) =>
          index === 0 ? Object.freeze({ ...check, modality }) : check)),
      }),
    }),
    relationships: [],
  });
  const candidate = phase === "final"
    ? compileControlRecordRevision(identity.processId, {
        recordId: "candidate-check-operation-v7",
        recordKind: "candidate-revision",
        revision: 1,
        producer: { kind: "runtime", id: RUNTIME },
        semanticAuthor: { kind: "runtime", id: RUNTIME },
        semanticAuthority: "runtime-derived",
        createdAt: STARTED,
        semanticMarkdown: "# Candidate Revision\n",
        payload: Object.freeze({
          schema: "lifecycle.candidate-revision-payload.v3",
          candidateBaseCommit: physical!.productBaseCommit,
          carrierManifest: Object.freeze({
            digest: physical!.carrier!.descriptor.digest,
            byteLength: physical!.carrier!.descriptor.byteLength,
            mediaType: physical!.carrier!.descriptor.mediaType,
            purpose: physical!.carrier!.descriptor.purpose,
          }),
          state: Object.freeze({
            tree: physical!.productBaseTree,
            pathInventoryDigest: digest("candidate-path-inventory"),
            changedSubjects: Object.freeze([]),
          }),
        }),
        relationships: Object.freeze([Object.freeze({
          relation: "governed-by",
          target: reference(boundary),
        })]),
      })
    : null;
  const seal = candidate === null
    ? null
    : compileControlRecordRevision(identity.processId, {
        recordId: "seal-check-operation-v7",
        recordKind: "candidate-seal",
        revision: 1,
        producer: { kind: "runtime", id: RUNTIME },
        semanticAuthor: { kind: "runtime", id: RUNTIME },
        semanticAuthority: "runtime-derived",
        createdAt: FINISHED,
        semanticMarkdown: "# Candidate Seal\n",
        payload: Object.freeze({ schema: "lifecycle.candidate-seal-payload.v2" }),
        relationships: Object.freeze([
          Object.freeze({ relation: "governed-by", target: reference(boundary) }),
          Object.freeze({ relation: "seals", target: reference(candidate) }),
        ]),
      });
  const revisions = new Map<string, ControlRecordRevision>([
    [`${boundary.recordId}\0${boundary.revision}`, boundary],
    ...(candidate === null ? [] : [[
      `${candidate.recordId}\0${candidate.revision}`,
      candidate,
    ] as const]),
    ...(seal === null ? [] : [[`${seal.recordId}\0${seal.revision}`, seal] as const]),
  ]);
  const events: ControlRecordEvent[] = [];
  const retainedFiles = new Map<Sha256, Readonly<{
    descriptor: ControlRecordFile;
    bytes: Uint8Array;
  }>>();
  let predecessorDigest: Sha256 | null = null;
  let activityComplete = false;
  const appendEvent = (append: ControlRecordStoreAppend): ControlRecordRevision | null => {
    const revision = append.revision === undefined
      ? null
      : compileControlRecordRevision(identity.processId, append.revision);
    if (revision !== null) revisions.set(`${revision.recordId}\0${revision.revision}`, revision);
    const event = compileControlRecordEvent({
      storeId: identity.storeId,
      processId: identity.processId,
      sequence: events.length + 1,
      predecessorDigest,
      event: append.event,
    });
    predecessorDigest = event.digest;
    events.push(event);
    if (event.eventKind === "check-receipt-recorded") activityComplete = true;
    return revision;
  };
  const openingSubject = phase === "final" ? seal! : boundary;
  if (delegatedResources !== null && phase !== "final") throw new TypeError("Only final Checks have delegated slots");
  if (delegatedResources !== null) {
    // This existing owner fixture is a partial retained-Control double, not a
    // full delegation/reducer history. Give its reservation an exact predecessor.
    appendEvent({ event: {
      eventId: "event-prior-boundary-check-operation-v7", eventKind: "work-boundary-finalized", occurredAt: CREATED,
      actor: { kind: "runtime", id: RUNTIME }, subject: { recordId: boundary.recordId, revision: boundary.revision, digest: boundary.digest },
      payload: { activityId: "activity.prior-preparation" },
    } });
  }
  const reservedDefinition = ((boundary.payload.mandate as ControlJsonObject).checks as readonly ControlJsonObject[])[0]!.definition;
  const reservation = delegatedResources === null ? null : compileWorkDelegationReservation({
    schema: WORK_DELEGATION_RESERVATION_SCHEMA, reservationId: "reservation.check-evaluation", activityId: ACTIVITY, operation: "delivery.evaluate",
    delegation: { kind: "work-delegation", id: "delegation.check-evaluation", revision: 1, digest: digest("retained-delegation") },
    decision: { journalHead: { sequence: events.length, digest: predecessorDigest! }, basisDigest: digest("opening-facts"), reason: "evaluate-integrated-candidate" },
    slots: [
      { slotId: "slot.check", purpose: "check", phase: "final", selectionId: SELECTION,
        definition: reservedDefinition as unknown as Extract<WorkDelegationExecutionSlot, { purpose: "check" }>["definition"],
        binding: { id: binding.id, digest: binding.digest }, ...delegatedResources, wallTimeMs: delegatedResources.limits.wallTimeMilliseconds },
      { slotId: "slot.reviewer", purpose: "agent", role: "reviewer", selection: {
        providerDescriptor: { id: "descriptor.fixture", digest: digest("provider") }, backendProfile: delegatedResources.backendProfile,
        image: delegatedResources.image, model: "model.fixture", reasoning: "high", wallTimeMs: 1_000,
        limits: { tokens: null, events: 100, outputBytes: 1_048_576, toolCalls: null, processes: 8, storageBytes: 1_048_576 },
      } },
    ],
  });
  appendEvent({ event: {
    eventId: "event-activity-started-check-operation-v7", eventKind: "activity-started", occurredAt: CREATED,
    actor: { kind: "runtime", id: RUNTIME },
    payload: { activityId: ACTIVITY, operation: phase === "final" ? "delivery.evaluate" : "delivery.prepare", ...(reservation === null ? {} : { reservation }) },
  } });
  appendEvent(Object.freeze({
    event: Object.freeze({
      eventId: phase === "final"
        ? "event-candidate-sealed-check-operation-v7"
        : "event-work-boundary-check-operation-v7",
      eventKind: phase === "final" ? "candidate-sealed" : "work-boundary-finalized",
      occurredAt: CREATED,
      actor: Object.freeze({ kind: "runtime" as const, id: RUNTIME }),
      subject: Object.freeze({
        recordId: openingSubject.recordId,
        revision: openingSubject.revision,
        digest: openingSubject.digest,
      }),
      payload: Object.freeze({ activityId: ACTIVITY }),
    }),
  }));
  const state = (): ReducedDeliveryState => Object.freeze({
    standing: phase === "final" ? "active" : "framing",
    candidateCondition: phase === "final" ? "sealed-under-evaluation" : "absent",
    activities: Object.freeze([Object.freeze({
      id: ACTIVITY,
      operation: phase === "final" ? "delivery.evaluate" : "delivery.prepare",
      family: "agent" as const,
      stage: "finalizing" as const,
      recovery: Object.freeze({
        kind: "finalization" as const,
        resumesAt: phase === "final"
          ? "evaluation-checks" as const
          : activityComplete ? "activity-completed" as const : "baseline-checks" as const,
        exactEffectDigest: null,
      }),
    })]),
    subjects: Object.freeze({
      integrationAssessment: null,
      proposedBoundary: null,
      activeBoundary: phase === "final" ? reference(boundary) : null,
      candidate: candidate === null ? null : reference(candidate),
      materialCondition: null,
      seal: seal === null ? null : reference(seal),
      evidence: null,
      closure: null,
    }),
    journal: Object.freeze({ eventCount: events.length, headDigest: predecessorDigest }),
    delegation: Object.freeze({ admission: null, current: null, charged: Object.freeze({ operations: 0, agentAttempts: 0, reservedCellWallTimeMs: 0 }) }),
    eligibleOperations: Object.freeze([]),
  });
  const store = {
    identity,
    paths: Object.freeze({ root: "/store", database: "/store/db", files: "/store/files", drafts: "/store/drafts" }),
    state,
    listEvents(afterSequence = 0, limit = 1_000) {
      return Object.freeze(events.filter(({ sequence }) => sequence > afterSequence).slice(0, limit));
    },
    getRevision(recordId: string, selectedRevision: number) {
      return revisions.get(`${recordId}\0${selectedRevision}`) ?? null;
    },
    listRetainedFiles() {
      return Object.freeze([...retainedFiles.values()].map(({ descriptor }) => descriptor));
    },
    async readRetainedFile(selected: Sha256) {
      if (
        physical !== null && physical.carrier !== null &&
        physical.carrier.descriptor.digest === selected
      ) {
        return Object.freeze({
          descriptor: physical.carrier.descriptor,
          bytes: Uint8Array.from(physical.carrier.manifestBytes),
        });
      }
      const retained = retainedFiles.get(selected);
      return retained === undefined
        ? null
        : Object.freeze({
            descriptor: retained.descriptor,
            bytes: Uint8Array.from(retained.bytes),
          });
    },
  } as unknown as ControlRecordStore;

  let checkpoint: ControlJsonObject | null = null;
  let generation = 1;
  let commits = 0;
  let fileCommits = 0;
  let loseReceiptReturn = false;
  const current = () => {
    const selectedState = state();
    const activity = selectedState.activities[0]!;
    const parentCheckpoint = Object.freeze({
      schema: "lifecycle.check-operation-test-parent-checkpoint.v1",
      check: checkpoint,
    });
    const plan = Object.freeze({
      schema: "lifecycle.check-operation-test-plan.v1",
      phase,
    });
    const envelope = Object.freeze({
      schema: "lifecycle.delivery-activity-kernel-support.v1",
      activityId: ACTIVITY,
      operation: activity.operation,
      definition: Object.freeze({
        id: "lifecycle.check-operation-test-definition.v1",
        digest: digest("activity-definition"),
      }),
      plan: Object.freeze({ value: plan, digest: digestCanonical(plan) }),
      checkpoint: Object.freeze({
        value: parentCheckpoint,
        digest: digestCanonical(parentCheckpoint),
      }),
      completion: null,
    });
    const payloadDigest = digestCanonical(envelope);
    const coordinate = Object.freeze({ generation, payloadDigest });
    return Object.freeze({
      context: Object.freeze({
        support: Object.freeze({
          schema: CONTROL_RECORD_OPERATION_SUPPORT_SCHEMA,
          storeId: identity.storeId,
          processId: identity.processId,
          activityId: ACTIVITY,
          supportKind: "delivery-activity-kernel-v7",
          generation,
          payload: envelope,
          payloadDigest,
        }),
        coordinate,
        envelope,
        activity,
        recovery: activity.recovery!,
        descriptor: Object.freeze({
          kind: "finalization",
          resumesAt: phase === "final" ? "evaluation-checks" : "baseline-checks",
          next: Object.freeze({
            type: "event",
            eventKinds: Object.freeze(["check-receipt-recorded"]),
          }),
          support: "check-execution",
          lockScope: "delivery",
          idempotence: "exact-record-finalization",
        }),
        journal: selectedState.journal,
      }),
      coordinate,
      checkpoint: checkpoint as FoundationCheckOperationCheckpointV7 | null,
    });
  };
  const applyCommit = (update: Readonly<{
    expected: Readonly<{ generation: number; payloadDigest: Sha256 }>;
    checkpoint: FoundationCheckOperationCheckpointV7 | null;
    append?: ControlRecordStoreAppend;
  }>) => {
    assert.deepEqual(update.expected, current().coordinate);
    commits += 1;
    let revision: ControlRecordRevision | null = null;
    if (update.append !== undefined) revision = appendEvent(update.append);
    checkpoint = update.checkpoint;
    generation += 1;
    if (loseReceiptReturn && update.append !== undefined) {
      loseReceiptReturn = false;
      throw new Error("lost atomic Receipt return");
    }
    return revision;
  };
  type Step = Parameters<FoundationCheckOperationSupportV7["step"]>[0];
  const adapter = Object.freeze({
    current,
    async step(update: Step) {
      let files: readonly ControlRecordFile[] = Object.freeze([]);
      if (update.mode === "append-with-files") {
        assert(update.files.length > 0);
        fileCommits += 1;
        files = Object.freeze(update.files.map((file) => compileControlRecordFile(file)));
        for (let index = 0; index < files.length; index += 1) {
          retainedFiles.set(files[index]!.digest, Object.freeze({
            descriptor: files[index]!,
            bytes: Uint8Array.from(update.files[index]!.bytes),
          }));
        }
      }
      const revision = applyCommit({
        expected: update.expected,
        checkpoint: update.checkpoint,
        ...(update.mode === "checkpoint" ? {} : { append: update.append }),
      });
      return Object.freeze({
        view: current(),
        append: update.mode === "checkpoint" ? null : Object.freeze({ revision, event: events.at(-1)! }),
        files,
      });
    },
  }) as unknown as FoundationCheckOperationSupportV7;
  return Object.freeze({
    store,
    boundary,
    support: Object.freeze({
      adapter,
      checkpoint: () => checkpoint,
      commitCount: () => commits,
      fileCommitCount: () => fileCommits,
      loseReceiptReturnOnce: () => { loseReceiptReturn = true; },
    }),
    receipt: () => [...revisions.values()].find(({ recordKind }) => recordKind === "check-receipt") ?? null,
  });
}

function request(
  selected: ReturnType<typeof fixture>,
  execution: Readonly<{
    target: string;
    machineHome: string;
    cellOperator: FoundationCheckCellOperatorV1;
  }> | null = null,
) {
  return Object.freeze({
    target: execution?.target ?? "/target",
    ...(execution === null ? {} : {
      machineHome: execution.machineHome,
      cellOperator: execution.cellOperator,
    }),
    store: selected.store,
    activityId: ACTIVITY,
    boundary: selected.boundary,
    selectionId: SELECTION,
    bindingId: BINDING,
    binding,
    runtimeId: RUNTIME,
    support: selected.support.adapter,
  });
}

function operationClock(): Readonly<{ now(): string }> {
  let value = Date.parse("2026-09-01T00:01:00.000Z");
  return Object.freeze({ now: () => new Date(value += 1).toISOString() });
}


function outputBackend(input: Readonly<{
  engine: InMemoryExecutionBackendEngine;
  profile: FoundationCheckCellRuntimeV1["profile"];
  onSpecification(specification: FoundationExecutionSpecificationV1): void;
  exitCode?: number;
}>): FoundationExecutionBackend {
  const delegate = input.engine.facade(input.profile);
  let specification: FoundationExecutionSpecificationV1 | null = null;
  let supplied = false;
  return Object.freeze({
    profile: delegate.profile,
    async allocate(
      selected: FoundationExecutionSpecificationV1,
      allocationKey: Parameters<FoundationExecutionBackend["allocate"]>[1],
    ) {
      specification = selected;
      input.onSpecification(selected);
      return await delegate.allocate(selected, allocationKey);
    },
    async dispatch(handle: FoundationExecutionHandle) {
      if (!supplied) {
        assert(specification !== null);
        await input.engine.provideOutput(specification, checkExecutionOutput(specification, { exitCode: input.exitCode }));
        supplied = true;
      }
      return await delegate.dispatch(handle);
    },
    observe: delegate.observe.bind(delegate),
    cancel: delegate.cancel.bind(delegate),
    retrieve: delegate.retrieve.bind(delegate),
    createReclamationBinding: delegate.createReclamationBinding.bind(delegate),
    reclaim: delegate.reclaim.bind(delegate),
  });
}

async function successfulCellFixture(
  context: TestContext,
  phase: FixturePhase,
  exitCode = 0,
  delegated = false,
): Promise<Readonly<{
  selected: ReturnType<typeof fixture>;
  operation: ReturnType<typeof request>;
  operationWithImage(imageDigest: Sha256): ReturnType<typeof request>;
  engine: InMemoryExecutionBackendEngine;
  specificationDigest(): Sha256 | null;
  reclamation: Awaited<ReturnType<typeof openFoundationExecutionReclamationLedgerV1>>;
}>> {
  const workspace = await realpath(await mkdtemp(join(
    tmpdir(),
    `lifecycle-check-operation-${phase}-`,
  )));
  const target = join(workspace, "target");
  const machineHome = join(workspace, "machine");
  await Promise.all([
    mkdir(target, { mode: 0o700 }),
    mkdir(machineHome, { mode: 0o700 }),
  ]);
  await git(target, ["init", "-b", "main"]);
  await git(target, ["config", "user.name", "Lifecycle Test"]);
  await git(target, ["config", "user.email", "lifecycle@example.invalid"]);
  await writeFile(join(target, "product.txt"), "deterministic Check subject\n", "utf8");
  await git(target, ["add", "--", "product.txt"]);
  await git(target, ["commit", "-m", "Create Check subject"]);
  const productBaseCommit = (await git(target, ["rev-parse", "HEAD"])).stdout.trim();
  const productBaseTree = (await git(target, ["rev-parse", "HEAD^{tree}"])).stdout.trim();
  const carrier = phase === "final"
    ? await publishCandidateRevisionCarrierFromGitTree({
        machineHome,
        repository: target,
        rootTree: productBaseTree,
      })
    : null;
  const physical: PhysicalFixture = Object.freeze({
    target,
    machineHome,
    productBaseCommit,
    productBaseTree,
    carrier: carrier === null
      ? null
      : Object.freeze({
          manifestBytes: Uint8Array.from(carrier.manifestBytes),
          descriptor: compileControlRecordFile({
            bytes: carrier.manifestBytes,
            mediaType:
              "application/vnd.lifecycle.candidate-revision-carrier-manifest+json",
            purpose: "candidate-revision-carrier-manifest",
            createdAt: STARTED,
          }),
        }),
  });
  const contract = executionContractFixture(`check-operation-${phase}`);
  const image = Object.freeze({
    ...contract.image,
    runnerContractDigest: digest("runner-contract"),
    runnerImplementationDigest: digest("runner-implementation"),
    toolInventoryDigest: digest("tool-inventory"),
  });
  const reservedResources = compileFoundationCheckCellResourceSelectionV1({ binding, profile: contract.profile, image });
  const selected = fixture("precondition", phase, physical, delegated ? reservedResources : null);
  const clock = operationClock();
  const engine = new InMemoryExecutionBackendEngine(
    phase === "baseline" ? "2".repeat(64) : "3".repeat(64),
  );
  let specificationDigest: Sha256 | null = null;
  const backend = outputBackend({
    engine,
    exitCode,
    profile: contract.profile,
    onSpecification(specification) {
      specificationDigest = specification.digest;
      assert.deepEqual({ backendProfile: specification.backendProfile, image: specification.image, limits: specification.limits }, reservedResources,
        "The allocated Check uses the exact resource projection available before opening");
    },
  });
  const reclamation = await openFoundationExecutionReclamationLedgerV1({
    machineHome,
    installationId: `installation-check-operation-${phase}`,
    create: true,
    clock,
  });
  const cellRuntime: FoundationCheckCellRuntimeV1 = Object.freeze({
    backend,
    profile: contract.profile,
    engineIdentityDigest: digest(`engine-${phase}`),
    bindingRegistry: new FoundationDockerExecutionBindingRegistryV1(),
    image,
    outputStore: createFoundationExecutionOutputStoreV1({ machineHome }),
    reclamation,
    inputTransport: new FoundationCheckCellInputTransportRegistryV1(),
    clock,
    pollMilliseconds: 0,
  });
  const operator = createFoundationCheckCellOperatorV1(cellRuntime);
  assert.deepEqual(Object.keys(operator).sort(), ["clock", "operate"]);
  context.after(async () => {
    try { reclamation.close(); } catch { /* already closed by a failed test */ }
    await rm(workspace, { recursive: true, force: true });
  });
  return Object.freeze({
    selected,
    operation: request(selected, {
      target,
      machineHome,
      cellOperator: operator,
    }),
    operationWithImage: imageDigest => request(selected, { target, machineHome,
      cellOperator: createFoundationCheckCellOperatorV1({ ...cellRuntime, image: { ...image, imageDigest } }),
    }),
    engine,
    specificationDigest: () => specificationDigest,
    reclamation,
  });
}

test("baseline postconditions retain their authorized non-execution without Cell allocation", async () => {
  const selected = fixture("postcondition");
  const receipt = await operateFoundationCheckV7(request(selected), { now: () => RECORDED });

  assert.equal(receipt.payload.modality, "postcondition");
  assert.equal(receipt.payload.disposition, "not-run");
  assert.deepEqual(receipt.payload.notRunAuthorization, { kind: "baseline-postcondition" });
  assert.equal(selected.support.checkpoint(), null);
  assert.equal(selected.support.commitCount(), 1);
});

test("baseline postconditions refuse retained Cell support instead of allocating or resuming", async () => {
  const selected = fixture("postcondition");
  await selected.support.adapter.step({
    mode: "checkpoint",
    expected: selected.support.adapter.current().coordinate,
    checkpoint: Object.freeze({
      schema: "lifecycle.check-cell-operation-checkpoint.v1",
      phase: "baseline",
      selectionId: SELECTION,
      bindingId: BINDING,
      proofSubject: reference(selected.boundary),
      specificationDigest: digest("postcondition-specification"),
      inputSetDigest: digest("postcondition-input-set"),
      execution: null,
    }),
  });
  await assert.rejects(
    operateFoundationCheckV7(request(selected)),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.check-operation-v7.postcondition-support",
  );
  assert.equal(selected.receipt(), null);
});

test("executable baseline Checks route to the required Cell backend without inventing Candidate support", async () => {
  const selected = fixture("precondition");
  await assert.rejects(
    operateFoundationCheckV7(request(selected)),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.check-operation-v7.execution-backend-unavailable",
  );
  assert.equal(selected.support.checkpoint(), null);
  assert.equal(selected.receipt(), null);
});

test("baseline Check Cell recovery returns its atomic retained Receipt without redispatch", async (context) => {
  const value = await successfulCellFixture(context, "baseline");
  value.selected.support.loseReceiptReturnOnce();

  await assert.rejects(
    operateFoundationCheckV7(value.operation),
    /lost atomic Receipt return/u,
  );
  const retained = value.selected.receipt();
  assert.notEqual(retained, null);
  assert.equal(retained!.payload.phase, "baseline");
  assert.equal(retained!.payload.disposition, "pass");
  assert.equal(value.selected.support.checkpoint(), null);
  assert.equal(value.selected.support.fileCommitCount(), 1);
  assert.equal(value.reclamation.list().length, 1);
  const specificationDigest = value.specificationDigest();
  assert.notEqual(specificationDigest, null);
  assert.equal(value.engine.productiveStartCount(specificationDigest!), 1);
  const commitsBeforeRecovery = value.selected.support.commitCount();

  const recovered = await operateFoundationCheckV7(value.operation);
  assert.deepEqual(recovered, retained);
  assert.equal(value.selected.support.commitCount(), commitsBeforeRecovery);
  assert.equal(value.engine.productiveStartCount(specificationDigest!), 1);
  assert.equal(recovered.relationships.some(({ relation }) => relation === "checks-boundary"), true);
});

test("final Check Cell recovery returns its atomic Carrier-bound Receipt without redispatch", async (context) => {
  const value = await successfulCellFixture(context, "final");
  value.selected.support.loseReceiptReturnOnce();

  await assert.rejects(
    operateFoundationCheckV7(value.operation),
    /lost atomic Receipt return/u,
  );
  const retained = value.selected.receipt();
  assert.notEqual(retained, null);
  assert.equal(retained!.payload.phase, "final");
  assert.equal(retained!.payload.disposition, "pass");
  assert.equal(value.selected.support.checkpoint(), null);
  assert.equal(value.selected.support.fileCommitCount(), 1);
  assert.equal(value.reclamation.list().length, 1);
  const specificationDigest = value.specificationDigest();
  assert.notEqual(specificationDigest, null);
  assert.equal(value.engine.productiveStartCount(specificationDigest!), 1);
  const commitsBeforeRecovery = value.selected.support.commitCount();

  const recovered = await operateFoundationCheckV7(value.operation);
  assert.deepEqual(recovered, retained);
  assert.equal(value.selected.support.commitCount(), commitsBeforeRecovery);
  assert.equal(value.engine.productiveStartCount(specificationDigest!), 1);
  assert.equal(recovered.relationships.some(({ relation }) => relation === "checks-seal"), true);
});

test("delegated final Check rejects an unreserved Image before checkpoint or allocation", async (context) => {
  const value = await successfulCellFixture(context, "final", 0, true);
  await assert.rejects(operateFoundationCheckV7(value.operationWithImage(digest("unreserved-image"))),
    (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.check-cell-v1.work-delegation-binding");
  assert.equal(value.specificationDigest(), null);
  assert.equal(value.selected.support.checkpoint(), null);
  assert.equal(value.selected.receipt(), null);
  assert.equal(value.engine.snapshot().allocations.length, 0);
  assert.equal(value.reclamation.list().length, 0);

  const receipt = await operateFoundationCheckV7(value.operation);
  assert.equal(receipt.payload.disposition, "pass");
  assert.equal(value.engine.productiveStartCount(value.specificationDigest()!), 1);
});

test("delegated Check recovery retains the original slot and allocation after a lost create return", async (context) => {
  const value = await successfulCellFixture(context, "final", 0, true);
  value.engine.armFault("allocate-after-create-before-return");
  await assert.rejects(operateFoundationCheckV7(value.operation), (error: unknown) => {
    assert.ok(error instanceof FoundationError);
    assert.equal(error.code, "lifecycle.execution.operation-host.backend-interrupted");
    assert.equal(error.operationalStateChanged, true);
    assert.deepEqual(error.observedFacts, { backendOperation: "allocate", backendFailureClass: "unknown" });
    return true;
  });
  const originalCheckpoint = value.selected.support.checkpoint();
  const originalSpecification = value.specificationDigest();
  assert.ok(originalCheckpoint);
  assert.ok(originalSpecification);
  assert.equal(value.selected.receipt(), null);
  assert.equal(value.engine.productiveStartCount(originalSpecification), 0);
  const originalAllocations = value.engine.snapshot().allocations;
  assert.equal(originalAllocations.length, 1);

  await assert.rejects(operateFoundationCheckV7(value.operationWithImage(digest("changed-recovery-default"))),
    (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.check-cell-v1.work-delegation-binding");
  assert.deepEqual(value.selected.support.checkpoint(), originalCheckpoint);
  assert.deepEqual(value.engine.snapshot().allocations, originalAllocations);
  assert.equal(value.selected.receipt(), null);

  value.selected.support.loseReceiptReturnOnce();
  await assert.rejects(operateFoundationCheckV7(value.operation), /lost atomic Receipt return/u);
  const retainedReceipt = value.selected.receipt();
  assert.ok(retainedReceipt);
  assert.equal(value.specificationDigest(), originalSpecification);
  assert.equal(value.engine.snapshot().allocations.length, 1);
  assert.equal(value.engine.snapshot().allocations[0]!.handle, originalAllocations[0]!.handle);
  assert.equal(value.engine.productiveStartCount(originalSpecification), 1);
  assert.equal(value.reclamation.list().length, 1);
  assert.equal(value.selected.support.checkpoint(), null);
  assert.deepEqual(await operateFoundationCheckV7(value.operation), retainedReceipt);
  assert.equal(value.engine.productiveStartCount(originalSpecification), 1);
  assert.equal(retainedReceipt.payload.disposition, "pass");
  assert.equal(retainedReceipt.relationships.some(({ relation }) => relation === "checks-seal"), true);
});

test("a parsed nonzero Check exit retains a failed Check rather than an operational error", async (context) => {
  const value = await successfulCellFixture(context, "final", 1);
  const receipt = await operateFoundationCheckV7(value.operation);
  assert.equal(receipt.payload.phase, "final");
  assert.equal(receipt.payload.disposition, "fail");
  assert.equal(value.engine.productiveStartCount(value.specificationDigest()!), 1);
  assert.equal(value.reclamation.list().length, 1);
  assert.equal(receipt.relationships.some(({ relation }) => relation === "checks-seal"), true);
});

test("Check Cell recovery checkpoint binds the exact baseline phase and proof subject", () => {
  const selected = fixture("precondition");
  const checkpoint = parseFoundationCheckOperationCheckpointV7(Object.freeze({
    schema: "lifecycle.check-cell-operation-checkpoint.v1",
    phase: "baseline",
    selectionId: SELECTION,
    bindingId: BINDING,
    proofSubject: reference(selected.boundary),
    specificationDigest: digest("baseline-specification"),
    inputSetDigest: digest("baseline-input-set"),
    execution: null,
  }));
  assert.equal(checkpoint.phase, "baseline");
  assert.deepEqual(checkpoint.proofSubject, reference(selected.boundary));
});

test("Check operation refuses caller substitution and an unsupported checkpoint profile", async () => {
  const selected = fixture();
  await assert.rejects(
    operateFoundationCheckV7(Object.freeze({
      ...request(selected),
      binding: Object.freeze({ ...binding, implementationDigest: digest("substituted") }),
    })),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.check-operation-v7.substitution",
  );
  assert.equal(selected.support.checkpoint(), null);
  assert.throws(
    () => parseFoundationCheckOperationCheckpointV7(Object.freeze({
      schema: "lifecycle.check-operation-checkpoint.v1",
      phase: "final",
      selectionId: SELECTION,
      bindingId: BINDING,
      proofSubject: reference(selected.boundary),
      coordinate: Object.freeze({}),
    })),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.check-operation-v7.hard-cut",
  );
});
