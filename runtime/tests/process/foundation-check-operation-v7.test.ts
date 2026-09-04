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
  FoundationCheckCellInputTransportRegistryV1,
  type FoundationCheckCellRuntimeV1,
} from "../../src/foundation/check/execution-cell-v1.js";
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
import { FoundationError } from "../../src/foundation/error.js";
import type {
  FoundationExecutionBackend,
  FoundationExecutionHandle,
  FoundationRetrievedExecutionOutputV1,
} from "../../src/foundation/execution/backend.js";
import type {
  FoundationExecutionOutputManifestEntryV1,
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
  canonicalJsonLine,
  digestCanonical,
  selfDigest,
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
          schema: "lifecycle.candidate-revision-payload.v2",
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
      proposedBoundary: null,
      activeBoundary: phase === "final" ? reference(boundary) : null,
      candidate: candidate === null ? null : reference(candidate),
      materialCondition: null,
      seal: seal === null ? null : reference(seal),
      evidence: null,
      closure: null,
    }),
    journal: Object.freeze({ eventCount: events.length, headDigest: predecessorDigest }),
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
    cellRuntime: FoundationCheckCellRuntimeV1;
  }> | null = null,
) {
  return Object.freeze({
    target: execution?.target ?? "/target",
    ...(execution === null ? {} : {
      machineHome: execution.machineHome,
      cellRuntime: execution.cellRuntime,
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

function checkExecutionOutput(
  specification: FoundationExecutionSpecificationV1,
): FoundationRetrievedExecutionOutputV1 {
  const subjectDigest = digest(`proof-subject-${specification.digest}`);
  const proofSubject = Object.freeze({
    schema: "lifecycle.check-cell-proof.v1" as const,
    startedAt: "2026-09-01T00:00:00.010Z",
    finishedAt: "2026-09-01T00:00:00.020Z",
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    parserId: "exit-code-v1" as const,
    parserDisposition: "passed" as const,
    subjectBeforeDigest: subjectDigest,
    subjectAfterDigest: subjectDigest,
    subjectIntegrity: "unchanged" as const,
    resultFacts: Object.freeze([Object.freeze({ name: "exit-code", value: 0 })]),
  });
  const proof = Object.freeze({ ...proofSubject, digest: selfDigest(proofSubject) });
  const raw = Object.freeze({
    schema: "lifecycle.check-cell-raw-streams.v1" as const,
    stdoutBase64: Buffer.from("deterministic Check passed\n", "utf8").toString("base64"),
    stderrBase64: "",
  });
  const values = Object.freeze([
    Object.freeze({
      path: "check-proof/result.json",
      purpose: "check-proof" as const,
      mediaType: "application/json",
      bytes: Uint8Array.from(Buffer.from(canonicalJsonLine(proof), "utf8")),
    }),
    Object.freeze({
      path: "raw-check-output/streams.json",
      purpose: "raw-check-output" as const,
      mediaType: "application/json",
      bytes: Uint8Array.from(Buffer.from(canonicalJsonLine(raw), "utf8")),
    }),
  ]);
  const entries: readonly FoundationExecutionOutputManifestEntryV1[] = Object.freeze(
    values.map((value) => Object.freeze({
      path: value.path,
      entryKind: "file" as const,
      purpose: value.purpose,
      mediaType: value.mediaType,
      modeClass: "regular" as const,
      byteLength: value.bytes.byteLength,
      digest: sha256Bytes(value.bytes),
    })),
  );
  const aggregateByteLength = entries.reduce((sum, entry) => sum + entry.byteLength, 0);
  const manifestSubject = Object.freeze({
    schema: "lifecycle.execution-output-manifest.v1" as const,
    specificationDigest: specification.digest,
    inputSetDigest: specification.inputSet.digest,
    imageDigest: specification.image.imageDigest,
    outputContractDigest: specification.outputContract.digest,
    runnerDigest: specification.runner.contractDigest,
    completedAt: "2026-09-01T00:00:00.100Z",
    entries,
    entryCount: entries.length,
    aggregateByteLength,
    entryInventoryDigest: digestCanonical(entries),
  });
  return Object.freeze({
    manifest: Object.freeze({
      ...manifestSubject,
      digest: selfDigest(manifestSubject),
    }),
    carrierByteLength: aggregateByteLength,
    async *entries() {
      for (let index = 0; index < entries.length; index += 1) {
        const descriptor = entries[index]!;
        const bytes = values[index]!.bytes;
        yield Object.freeze({
          path: descriptor.path,
          byteLength: descriptor.byteLength,
          digest: descriptor.digest,
          async *read() { yield Uint8Array.from(bytes); },
        });
      }
    },
  });
}

function outputBackend(input: Readonly<{
  engine: InMemoryExecutionBackendEngine;
  profile: FoundationCheckCellRuntimeV1["profile"];
  onSpecification(specification: FoundationExecutionSpecificationV1): void;
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
        await input.engine.provideOutput(specification, checkExecutionOutput(specification));
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
): Promise<Readonly<{
  selected: ReturnType<typeof fixture>;
  operation: ReturnType<typeof request>;
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
  const selected = fixture("precondition", phase, physical);
  const contract = executionContractFixture(`check-operation-${phase}`);
  const image = Object.freeze({
    ...contract.image,
    runnerContractDigest: digest("runner-contract"),
    runnerImplementationDigest: digest("runner-implementation"),
    toolInventoryDigest: digest("tool-inventory"),
  });
  const clock = operationClock();
  const engine = new InMemoryExecutionBackendEngine(
    phase === "baseline" ? "2".repeat(64) : "3".repeat(64),
  );
  let specificationDigest: Sha256 | null = null;
  const backend = outputBackend({
    engine,
    profile: contract.profile,
    onSpecification(specification) { specificationDigest = specification.digest; },
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
  context.after(async () => {
    try { reclamation.close(); } catch { /* already closed by a failed test */ }
    await rm(workspace, { recursive: true, force: true });
  });
  return Object.freeze({
    selected,
    operation: request(selected, { target, machineHome, cellRuntime }),
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
