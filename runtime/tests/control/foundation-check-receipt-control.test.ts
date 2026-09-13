import assert from "node:assert/strict";
import test from "node:test";
import {
  retainCheckReceipt,
  type CheckReceiptModality,
  type CheckReceiptObservation,
} from "../../src/foundation/control/check-receipt.js";
import {
  compileControlRecordEvent,
  compileControlRecordRevision,
} from "../../src/foundation/control/model.js";
import { assertDeliveryControlRecordPayload } from "../../src/foundation/control/payload-registry.js";
import {
  compileControlRecordFile,
  type ControlRecordStore,
} from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlJsonObject,
  type ControlRecordEvent,
  type ControlRecordEventInput,
  type ControlRecordFile,
  type ControlRecordRevision,
  type ControlRecordStoreAppend,
  type ControlRecordStoreAppendWithFiles,
  type ControlRecordStoreIdentity,
} from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import type { ReducedDeliveryState } from "../../src/foundation/process/delivery-reducer.js";
import {
  sha256Bytes,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

const CREATED = "2026-08-29T20:00:00.000Z";
const STARTED = "2026-08-29T20:00:01.000Z";
const FINISHED = "2026-08-29T20:00:02.000Z";
const RECORDED = "2026-08-29T20:00:03.000Z";
const RUNTIME = "foundation-runtime";
const ACTIVITY = "activity-checks";
const SELECTION = "selection.check.demo";
const BINDING = "binding.check.demo";

function digest(value: string): Sha256 {
  return sha256Bytes(value);
}

const identity: ControlRecordStoreIdentity = Object.freeze({
  schema: CONTROL_RECORD_STORE_SCHEMA,
  storeId: "store-check-receipt-compiler",
  targetId: "target-check-receipt-compiler",
  processKind: "delivery",
  processId: "delivery-check-receipt-compiler",
  createdAt: CREATED,
});

function target(revision: ControlRecordRevision) {
  return Object.freeze({
    kind: revision.recordKind,
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function subject(revision: ControlRecordRevision) {
  return Object.freeze({
    recordId: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function reference(revision: ControlRecordRevision) {
  return Object.freeze({
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function boundaryPayload(modality: CheckReceiptModality): ControlJsonObject {
  const base = validDeliveryControlPayload("work-boundary");
  const mandate = base.mandate as ControlJsonObject;
  const selected = (mandate.checks as readonly ControlJsonObject[])[0]!;
  return Object.freeze({
    ...base,
    targetId: identity.targetId,
    mandate: Object.freeze({
      ...mandate,
      checks: Object.freeze([Object.freeze({
        ...selected,
        id: SELECTION,
        modality,
        environmentRequirements: Object.freeze(["node", "darwin"]),
      })]),
    }),
  });
}

function revision(input: Readonly<{
  id: string;
  kind: string;
  payload: ControlJsonObject;
  relationships?: readonly Readonly<{
    relation: string;
    target: ReturnType<typeof target>;
  }>[];
}>): ControlRecordRevision {
  return compileControlRecordRevision(identity.processId, {
    recordId: input.id,
    recordKind: input.kind,
    revision: 1,
    producer: { kind: "runtime", id: RUNTIME },
    semanticAuthor: { kind: "runtime", id: RUNTIME },
    semanticAuthority: "runtime-observed",
    createdAt: CREATED,
    semanticMarkdown: `# ${input.kind}\n`,
    payload: input.payload,
    relationships: input.relationships ?? [],
  });
}

type Phase = "baseline" | "final";

function fakeStore(input: Readonly<{
  phase: Phase;
  modality?: CheckReceiptModality;
  staleFinalSubject?: boolean;
  retainedFiles?: readonly ControlRecordFile[];
}>): Readonly<{
  store: ControlRecordStore;
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision | null;
  seal: ControlRecordRevision | null;
  events: readonly ControlRecordEvent[];
  normalAppends: () => number;
  fileBatches: () => number;
  retainedFileInventory: () => readonly ControlRecordFile[];
}> {
  const boundary = revision({
    id: "boundary-check-receipt",
    kind: "work-boundary",
    payload: boundaryPayload(input.modality ?? "precondition"),
  });
  const candidate = input.phase === "final"
    ? revision({
        id: "candidate-check-receipt",
        kind: "candidate-revision",
        payload: validDeliveryControlPayload("candidate-revision"),
        relationships: [{ relation: "governed-by", target: target(boundary) }],
      })
    : null;
  const seal = candidate === null
    ? null
    : revision({
        id: "seal-check-receipt",
        kind: "candidate-seal",
        payload: validDeliveryControlPayload("candidate-seal"),
        relationships: [
          { relation: "governed-by", target: target(boundary) },
          { relation: "seals", target: target(candidate) },
        ],
      });
  const revisions = new Map<string, ControlRecordRevision>();
  for (const value of [boundary, candidate, seal]) {
    if (value !== null) revisions.set(`${value.recordId}\u0000${value.revision}`, value);
  }
  const events: ControlRecordEvent[] = [];
  let predecessorDigest: Sha256 | null = null;
  let normalAppends = 0;
  let fileBatches = 0;
  const retainedFiles = new Map<Sha256, ControlRecordFile>(
    (input.retainedFiles ?? []).map((file) => [file.digest, file]),
  );
  const compileEvent = (event: ControlRecordEventInput): ControlRecordEvent => {
    const compiled = compileControlRecordEvent({
      storeId: identity.storeId,
      processId: identity.processId,
      sequence: events.length + 1,
      predecessorDigest,
      event,
    });
    predecessorDigest = compiled.digest;
    events.push(compiled);
    return compiled;
  };
  compileEvent({
    eventId: input.phase === "baseline" ? "event-boundary" : "event-seal",
    eventKind: input.phase === "baseline" ? "work-boundary-finalized" : "candidate-sealed",
    occurredAt: CREATED,
    actor: { kind: "runtime", id: RUNTIME },
    subject: subject(input.phase === "baseline" ? boundary : seal!),
    payload: { activityId: ACTIVITY },
  });
  const state: ReducedDeliveryState = Object.freeze({
    standing: input.phase === "baseline" ? "framing" : "active",
    candidateCondition: input.phase === "baseline" ? "absent" : "sealed-under-evaluation",
    activities: Object.freeze([Object.freeze({
      id: ACTIVITY,
      operation: input.phase === "baseline" ? "delivery.prepare" : "delivery.evaluate",
      family: "agent" as const,
      stage: "finalizing" as const,
      recovery: Object.freeze({
        kind: "finalization" as const,
        resumesAt: input.phase === "baseline" ? "baseline-checks" as const : "evaluation-checks" as const,
        exactEffectDigest: null,
      }),
    })]),
    subjects: Object.freeze({
      integrationAssessment: null,
      proposedBoundary: null,
      activeBoundary: input.phase === "final" ? reference(boundary) : null,
      candidate: input.phase === "final"
        ? input.staleFinalSubject
          ? Object.freeze({ ...reference(candidate!), digest: digest("stale-candidate") })
          : reference(candidate!)
        : null,
      materialCondition: null,
      seal: input.phase === "final" ? reference(seal!) : null,
      evidence: null,
      closure: null,
    }),
    delegation: { admission: null, current: null, charged: { operations: 0, agentAttempts: 0, reservedCellWallTimeMs: 0 } },
    journal: Object.freeze({ eventCount: 1, headDigest: events[0]!.digest }),
    eligibleOperations: Object.freeze([]),
  });
  const retainAppend = (append: ControlRecordStoreAppend) => {
    const retained = append.revision === undefined
      ? null
      : compileControlRecordRevision(identity.processId, append.revision);
    if (retained !== null) {
      assertDeliveryControlRecordPayload(retained);
      revisions.set(`${retained.recordId}\u0000${retained.revision}`, retained);
    }
    return Object.freeze({ revision: retained, event: compileEvent(append.event) });
  };
  const store = {
    identity,
    state: () => state,
    listEvents(afterSequence = 0, limit = 1_000) {
      return Object.freeze(events.filter(({ sequence }) => sequence > afterSequence).slice(0, limit));
    },
    getRevision(recordId: string, selectedRevision: number) {
      return revisions.get(`${recordId}\u0000${selectedRevision}`) ?? null;
    },
    listRetainedFiles() {
      return Object.freeze([...retainedFiles.values()]);
    },
    append(append: ControlRecordStoreAppend) {
      normalAppends += 1;
      return retainAppend(append);
    },
    async appendWithFiles(batch: ControlRecordStoreAppendWithFiles) {
      fileBatches += 1;
      const files = Object.freeze(batch.files.map(compileControlRecordFile));
      for (const file of files) {
        const existing = retainedFiles.get(file.digest);
        if (existing !== undefined) assert.deepEqual(file, existing);
        retainedFiles.set(file.digest, file);
      }
      const appends = Object.freeze(batch.appends.map(retainAppend));
      return Object.freeze({ files, appends });
    },
  } as unknown as ControlRecordStore;
  return Object.freeze({
    store,
    boundary,
    candidate,
    seal,
    events,
    normalAppends: () => normalAppends,
    fileBatches: () => fileBatches,
    retainedFileInventory: () => Object.freeze([...retainedFiles.values()]),
  });
}

function successfulObservation(): CheckReceiptObservation {
  return Object.freeze({
    startedAt: STARTED,
    finishedAt: FINISHED,
    environment: Object.freeze({
      identityDigest: digest("check-environment"),
      runtimeEnforced: Object.freeze([
        "protected-environment",
        "node",
        "descendant-containment",
        "darwin",
      ]),
      directorManaged: Object.freeze([]),
    }),
    disposition: "pass",
    resultFacts: Object.freeze([Object.freeze({ name: "exit-code", value: 0 })]),
    reasonCode: null,
    notRunAuthorization: null,
    operationalFailure: null,
    execution: Object.freeze({
      allocation: "allocated",
      backendProfile: Object.freeze({
        profileId: "lifecycle.execution-backend-profile.fault-injection.v1",
        profileDigest: digest("check-backend-profile"),
        implementationDigest: digest("check-backend-implementation"),
      }),
      image: Object.freeze({
        imageId: "check-execution-image",
        imageDigest: digest("check-execution-image"),
      }),
      inputSet: Object.freeze({
        profileId: "lifecycle.execution-input-set.v2",
        digest: digest("check-input-set"),
      }),
      specificationDigest: digest("check-execution-specification"),
      runnerDigest: digest("check-runner"),
      observationDigest: digest("check-execution-observation"),
      output: Object.freeze({
        availability: "retrieved",
        carrierByteLength: 128,
        carrierDigest: digest("check-output-carrier"),
        manifestDigest: digest("check-output-manifest"),
      }),
      exitCode: 0,
      signal: null,
      timedOut: false,
      parserDisposition: "passed",
    }),
    subjectIntegrity: "unchanged",
    containment: Object.freeze({
      classification: "contained",
      factsDigest: digest("check-containment"),
    }),
    retirement: Object.freeze({
      classification: "retired",
      factsDigest: digest("check-retirement"),
    }),
    runner: Object.freeze({ id: "runtime.check-runner", digest: digest("check-runner") }),
    parser: Object.freeze({ id: "runtime.check-parser", digest: digest("check-parser") }),
    limitations: Object.freeze(["Zulu limitation", "Alpha limitation", "Alpha limitation"]),
  });
}

async function retain(
  fixture: ReturnType<typeof fakeStore>,
  observation: CheckReceiptObservation = successfulObservation(),
) {
  return retainCheckReceipt({
    store: fixture.store,
    activityId: ACTIVITY,
    selectionId: SELECTION,
    bindingId: BINDING,
    observation,
    recordedAt: RECORDED,
    runtimeId: RUNTIME,
  });
}

test("Check Receipt derives the exact baseline contract and atomically retains raw output", async () => {
  const fixture = fakeStore({ phase: "baseline" });
  const raw = Object.freeze({
    bytes: new TextEncoder().encode("check output\n"),
    mediaType: "text/plain",
    purpose: "raw-check-output",
    createdAt: FINISHED,
  });
  const retained = await retain(fixture, Object.freeze({
    ...successfulObservation(),
    rawMaterials: Object.freeze([
      Object.freeze({ availability: "retained" as const, file: raw }),
      Object.freeze({ availability: "retained" as const, file: raw }),
    ]),
  }));

  assert.equal(fixture.normalAppends(), 0);
  assert.equal(fixture.fileBatches(), 1);
  assert.equal(retained.revision.payload.phase, "baseline");
  assert.equal(retained.revision.payload.selectionId, SELECTION);
  assert.equal(retained.revision.payload.modality, "precondition");
  assert.deepEqual(retained.revision.payload.definition,
    ((fixture.boundary.payload.mandate as ControlJsonObject).checks as readonly ControlJsonObject[])[0]!.definition);
  assert.equal((retained.revision.payload.binding as ControlJsonObject).id, BINDING);
  assert.deepEqual(
    (retained.revision.payload.environment as ControlJsonObject).requested,
    ["darwin", "node"],
  );
  assert.match(String(retained.revision.payload.proofRequestDigest), /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(retained.revision.relationships.map(({ relation }) => relation), ["checks-boundary"]);
  assert.equal(retained.revision.relationships[0]!.target.digest, fixture.boundary.digest);
  assert.deepEqual(retained.revision.payload.limitations, ["Alpha limitation", "Zulu limitation"]);
  assert.equal((retained.revision.payload.rawMaterials as readonly unknown[]).length, 1);
  assert.equal(retained.event.eventKind, "check-receipt-recorded");
  assert.deepEqual(retained.event.payload, { activityId: ACTIVITY });
  assert.match(retained.revision.semanticMarkdown, /Proof subject: work-boundary/u);
  assertDeliveryControlRecordPayload(retained.revision);
});

test("Check Receipt reuses the exact retained descriptor for repeated raw output bytes", async () => {
  const bytes = new TextEncoder().encode("same check output\n");
  const existing = compileControlRecordFile(Object.freeze({
    bytes,
    mediaType: "text/plain",
    purpose: "raw-check-output",
    createdAt: STARTED,
  }));
  const fixture = fakeStore({ phase: "final", retainedFiles: [existing] });
  const retained = await retain(fixture, Object.freeze({
    ...successfulObservation(),
    rawMaterials: Object.freeze([Object.freeze({
      availability: "retained" as const,
      file: Object.freeze({
        bytes,
        mediaType: "text/plain",
        purpose: "raw-check-output",
        createdAt: FINISHED,
      }),
    })]),
  }));

  assert.equal(fixture.normalAppends(), 0);
  assert.equal(fixture.fileBatches(), 1);
  assert.deepEqual(fixture.retainedFileInventory(), [existing]);
  assert.equal(retained.revision.payload.finishedAt, FINISHED);
  assert.deepEqual(retained.revision.payload.rawMaterials, [Object.freeze({
    availability: "retained",
    reference: Object.freeze({
      digest: existing.digest,
      byteLength: existing.byteLength,
      mediaType: existing.mediaType,
      purpose: existing.purpose,
    }),
  })]);
});

test("Check Receipt refuses conflicting or future reuse of retained raw output", async () => {
  const bytes = new TextEncoder().encode("same check output\n");
  const conflicting = fakeStore({
    phase: "final",
    retainedFiles: [compileControlRecordFile(Object.freeze({
      bytes,
      mediaType: "application/json",
      purpose: "raw-check-output",
      createdAt: STARTED,
    }))],
  });
  const rawMaterial = Object.freeze({
    availability: "retained" as const,
    file: Object.freeze({
      bytes,
      mediaType: "text/plain",
      purpose: "raw-check-output",
      createdAt: FINISHED,
    }),
  });
  await assert.rejects(
    retain(conflicting, Object.freeze({
      ...successfulObservation(),
      rawMaterials: Object.freeze([rawMaterial]),
    })),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.control-check-receipt.raw-material",
  );
  assert.equal(conflicting.fileBatches(), 0);

  const reusable = compileControlRecordFile(Object.freeze({
    bytes,
    mediaType: "text/plain",
    purpose: "raw-check-output",
    createdAt: STARTED,
  }));
  const future = fakeStore({ phase: "final", retainedFiles: [reusable] });
  await assert.rejects(
    retain(future, Object.freeze({
      ...successfulObservation(),
      rawMaterials: Object.freeze([Object.freeze({
        ...rawMaterial,
        file: Object.freeze({
          ...rawMaterial.file,
          createdAt: "2026-08-29T20:00:04.000Z",
        }),
      })]),
    })),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.control-check-receipt.time",
  );
  assert.equal(future.fileBatches(), 0);
});

test("Check Receipt derives final Candidate Seal coordinates without caller subject facts", async () => {
  const firstFixture = fakeStore({ phase: "final" });
  const first = await retain(firstFixture);
  const second = await retain(fakeStore({ phase: "final" }));

  assert.equal(firstFixture.normalAppends(), 1);
  assert.equal(firstFixture.fileBatches(), 0);
  assert.equal(first.revision.recordId, second.revision.recordId);
  assert.equal(first.revision.digest, second.revision.digest);
  assert.equal(first.event.eventId, second.event.eventId);
  assert.equal(first.revision.payload.phase, "final");
  assert.deepEqual(first.revision.relationships.map(({ relation }) => relation), ["checks-seal"]);
  assert.equal(first.revision.relationships[0]!.target.digest, firstFixture.seal!.digest);
  assert.match(first.revision.semanticMarkdown, /Proof subject: candidate-seal/u);
});

test("Check Receipt preserves authorized baseline postcondition not-run semantics", async () => {
  const fixture = fakeStore({ phase: "baseline", modality: "postcondition" });
  const retained = await retain(fixture, Object.freeze({
    ...successfulObservation(),
    startedAt: null,
    finishedAt: null,
    disposition: "not-run",
    resultFacts: Object.freeze([Object.freeze({
      name: "authorization",
      value: "baseline-postcondition",
    })]),
    reasonCode: "baseline-postcondition",
    execution: Object.freeze({ allocation: "not-allocated" }),
    containment: Object.freeze({ classification: "not-required", factsDigest: null }),
    retirement: Object.freeze({ classification: "not-required", factsDigest: null }),
  }));

  assert.equal(retained.revision.payload.modality, "postcondition");
  assert.equal(retained.revision.payload.disposition, "not-run");
  assert.equal(retained.revision.payload.startedAt, null);
  assert.deepEqual(retained.revision.payload.notRunAuthorization, {
    kind: "baseline-postcondition",
  });
});

test("Check Receipt preserves an exact upstream-condition not-run authorization", async () => {
  const fixture = fakeStore({ phase: "final", modality: "diagnostic" });
  const retained = await retain(fixture, Object.freeze({
    ...successfulObservation(),
    startedAt: null,
    finishedAt: null,
    disposition: "not-run",
    resultFacts: Object.freeze([]),
    reasonCode: "upstream-condition",
    notRunAuthorization: Object.freeze({
      kind: "upstream-condition",
      conditionId: "check.precondition",
      conditionDigest: digest("upstream-condition"),
    }),
    execution: Object.freeze({ allocation: "not-allocated" }),
    subjectIntegrity: "unverified",
    containment: Object.freeze({ classification: "not-required", factsDigest: null }),
    retirement: Object.freeze({ classification: "not-required", factsDigest: null }),
  }));

  assert.deepEqual(retained.revision.payload.notRunAuthorization, {
    kind: "upstream-condition",
    conditionId: "check.precondition",
    conditionDigest: digest("upstream-condition"),
  });
  assert.equal(retained.revision.payload.reasonCode, "upstream-condition");
});

test("Check Receipt preserves typed operational-error facts without coercing product failure", async () => {
  const fixture = fakeStore({ phase: "final" });
  const retained = await retain(fixture, Object.freeze({
    ...successfulObservation(),
    disposition: "operational-error",
    resultFacts: Object.freeze([]),
    reasonCode: "mechanism-timeout",
    operationalFailure: Object.freeze({
      stage: "execution",
      code: "timeout",
      factsDigest: digest("timeout-facts"),
    }),
    execution: Object.freeze({
      ...successfulObservation().execution,
      exitCode: null,
      signal: null,
      timedOut: true,
      parserDisposition: "not-run",
      output: Object.freeze({
        availability: "unavailable",
        carrierByteLength: null,
        carrierDigest: null,
        manifestDigest: null,
      }),
    }),
  }));

  assert.equal(retained.revision.payload.disposition, "operational-error");
  assert.equal(retained.revision.payload.reasonCode, "mechanism-timeout");
  assert.deepEqual(retained.revision.payload.operationalFailure, {
    stage: "execution",
    code: "timeout",
    factsDigest: digest("timeout-facts"),
  });
});

test("Check Receipt refuses stale subjects, contract substitutions, and duplicate selection results", async () => {
  const stale = fakeStore({ phase: "final", staleFinalSubject: true });
  await assert.rejects(retain(stale), (error: unknown) =>
    error instanceof FoundationError && error.code === "lifecycle.control-check-receipt.subject");

  const selection = fakeStore({ phase: "baseline" });
  await assert.rejects(retainCheckReceipt({
    store: selection.store,
    activityId: ACTIVITY,
    selectionId: "selection.absent",
    bindingId: BINDING,
    observation: successfulObservation(),
    recordedAt: RECORDED,
    runtimeId: RUNTIME,
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-check-receipt.selection");

  const binding = fakeStore({ phase: "baseline" });
  await assert.rejects(retainCheckReceipt({
    store: binding.store,
    activityId: ACTIVITY,
    selectionId: SELECTION,
    bindingId: "binding.substituted",
    observation: successfulObservation(),
    recordedAt: RECORDED,
    runtimeId: RUNTIME,
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-check-receipt.binding");

  const duplicate = fakeStore({ phase: "baseline" });
  await retain(duplicate);
  await assert.rejects(retain(duplicate), (error: unknown) =>
    error instanceof FoundationError && error.code === "lifecycle.control-check-receipt.duplicate");
});

test("Check Receipt refuses semantic dispositions without exact Containment and Retirement", async () => {
  const fixture = fakeStore({ phase: "baseline" });
  await assert.rejects(retain(fixture, Object.freeze({
    ...successfulObservation(),
    containment: Object.freeze({ classification: "not-required", factsDigest: null }),
  })), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-check-receipt.execution");

  const environment = fakeStore({ phase: "baseline" });
  await assert.rejects(retain(environment, Object.freeze({
    ...successfulObservation(),
    environment: Object.freeze({
      ...successfulObservation().environment,
      runtimeEnforced: Object.freeze(["descendant-containment", "protected-environment"]),
    }),
  })), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-check-receipt.environment");

  const postcondition = fakeStore({ phase: "baseline", modality: "postcondition" });
  await assert.rejects(retain(postcondition), (error: unknown) =>
    error instanceof FoundationError && error.code === "lifecycle.control-check-receipt.disposition");
});
