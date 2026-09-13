import { settleFoundationUnallocatedReviewV7 } from "../../src/foundation/process/agent-operation-v7.js";
import { bindFoundationMandatoryProjectionRefusalV1, completeMandatoryProjectionSizeErrorV1, mandatoryProjectionItemSizeErrorV1 } from "../../src/foundation/projection/mandatory-refusal.js";
import type { FoundationExecutionProjectionRequest } from "../../src/foundation/projection/types.js";
import { defaultProjectionProfiles } from "../../src/foundation/repository/contract.js";
import assert from "node:assert/strict";
import test from "node:test";
import type { AgentAttemptInvestment } from "../../src/foundation/control/agent-attempt.js";
import {
  compileControlRecordEvent,
  compileControlRecordRevision,
} from "../../src/foundation/control/model.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  CONTROL_RECORD_OPERATION_SUPPORT_SCHEMA,
  type ControlJsonObject,
  type ControlRecordEvent,
  type ControlRecordOperationSupport,
  type ControlRecordOperationSupportCoordinate,
  type ControlRecordOperationSupportPut,
  type ControlRecordRevision,
  type ControlRecordRevisionInput,
  type ControlRecordStoreAppend,
  type ControlRecordStoreAppendResult,
  type ControlRecordStoreIdentity,
  type ControlRecordStoreOperationBatch,
  type ControlRecordStoreOperationBatchResult,
} from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import type { ReducedDeliveryState } from "../../src/foundation/process/delivery-reducer.js";
import {
  prepareDeliveryEvaluationV7,
  recoverDeliveryEvaluationPreparationV7,
} from "../../src/foundation/process/evaluation-preparation-v7.js";
import type {
  FoundationCheckBinding,
  FoundationRepositoryContract,
} from "../../src/foundation/repository/types.js";
import { digestCanonical, sha256Bytes, type Sha256 } from "../../src/foundation/validation/canonical.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

const CREATED = "2026-08-29T20:00:00.000Z";
const RUNTIME = "foundation-runtime-v7";
const TARGET = "target-evaluation-preparation";
const DELIVERY = "delivery-evaluation-preparation";
const AGENT = "reviewer-agent-v7";

function digest(value: string): Sha256 {
  return sha256Bytes(value);
}

function investment(): AgentAttemptInvestment {
  const value = Object.freeze({
    id: "investment-evaluation-preparation",
    model: "codex-test",
    reasoning: "high",
    wallTimeMs: 60_000,
    limits: Object.freeze({
      tokens: null,
      events: 1_000,
      outputBytes: 1_048_576,
      toolCalls: null,
      processes: 8,
      storageBytes: 16_777_216,
    }),
    rationale: "independent-review",
  });
  return Object.freeze({ ...value, digest: digestCanonical(value) });
}

function ref(revision: ControlRecordRevision) {
  return Object.freeze({
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function relationship(kind: string, revision: ControlRecordRevision) {
  return Object.freeze({
    relation: kind,
    target: Object.freeze({
      kind: revision.recordKind,
      id: revision.recordId,
      revision: revision.revision,
      digest: revision.digest,
    }),
  });
}

function checkBinding(id: string, checkId: string): FoundationCheckBinding {
  const base = Object.freeze({
    id,
    checkIds: Object.freeze([checkId]),
    subjectSelectors: Object.freeze([]),
    kind: "command" as const,
    executable: Object.freeze({ relativeTo: "execution-image" as const, path: "node" }),
    args: Object.freeze(["--version"]),
    cwd: ".",
    network: "none" as const,
    timeoutMs: 30_000,
    allowedModalities: Object.freeze(["postcondition" as const]),
    capabilityProfileId: null,
    environment: Object.freeze({}),
    resultParser: Object.freeze({
      id: "exit-code-v1" as const,
      stateModel: "check-disposition-v2" as const,
      states: Object.freeze([
        "pass", "fail", "indeterminate", "not-run", "unsupported", "operational-error",
      ] as const),
    }),
    mutation: "forbidden" as const,
    implementationDigest: digest(`implementation:${id}`),
    limitations: Object.freeze([]),
  });
  return Object.freeze({ ...base, digest: digestCanonical(base) });
}

type Fixture = Readonly<{
  store: ControlRecordStore;
  contract: FoundationRepositoryContract;
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
  events: readonly ControlRecordEvent[];
  appendSeal(activityId: string): Readonly<{ revision: ControlRecordRevision; event: ControlRecordEvent }>;
  appendCheck(
    activityId: string,
    selectionId: string,
    bindingId: string,
  ): Readonly<{ revision: ControlRecordRevision; event: ControlRecordEvent }>;
}>;

function fixture(options: Readonly<{
  multipleBindings?: boolean;
  priorCandidateCondition?: "needs-correction" | "sealed-under-evaluation";
}> = {}): Fixture {
  const identity: ControlRecordStoreIdentity = Object.freeze({
    schema: CONTROL_RECORD_STORE_SCHEMA,
    storeId: "store-evaluation-preparation",
    targetId: TARGET,
    processKind: "delivery",
    processId: DELIVERY,
    createdAt: CREATED,
  });
  const bindingA = checkBinding("binding-a", "check-a");
  const bindingB = checkBinding("binding-b", "check-b");
  const extra = checkBinding("binding-extra", "check-a");
  const contractDigest = digest("repository-contract");
  const contract = Object.freeze({
    targetId: TARGET,
    digest: contractDigest,
    checkBindings: Object.freeze({
      [bindingA.id]: bindingA,
      [bindingB.id]: bindingB,
      [extra.id]: extra,
    }),
  }) as unknown as FoundationRepositoryContract;
  const check = (
    id: string,
    definitionId: string,
    bindings: readonly FoundationCheckBinding[],
  ): ControlJsonObject => Object.freeze({
    id,
    definition: Object.freeze({
      id: definitionId,
      revision: 1,
      sourceDigest: digest(`source:${definitionId}`),
      semanticDigest: digest(`semantic:${definitionId}`),
    }),
    bindings: Object.freeze(bindings.map((binding) => Object.freeze({
      id: binding.id,
      digest: binding.digest,
      implementationDigest: binding.implementationDigest,
    }))),
    modality: "postcondition",
    purpose: `Prove ${id}`,
    baselineRequired: false,
    finalRequired: true,
    obligationIds: Object.freeze([`obligation-${id}`]),
      environmentRequirements: Object.freeze([]),
  });
  const boundaryPayload = validDeliveryControlPayload("work-boundary");
  const boundaryBasis = boundaryPayload.basis as ControlJsonObject;
  const boundaryMandate = boundaryPayload.mandate as ControlJsonObject;
  const boundary = compileControlRecordRevision(DELIVERY, {
    recordId: "work-boundary-evaluation-preparation",
    recordKind: "work-boundary",
    revision: 1,
    producer: { kind: "runtime", id: RUNTIME },
    semanticAuthor: { kind: "runtime", id: RUNTIME },
    semanticAuthority: "runtime-derived",
    createdAt: CREATED,
    semanticMarkdown: "# Work Boundary\n",
    payload: {
      ...boundaryPayload,
      targetId: TARGET,
      basis: { ...boundaryBasis, repositoryContractDigest: contractDigest },
      mandate: {
        ...boundaryMandate,
        checks: [
          check("selection-b", "check-b", [bindingB]),
          check("selection-a", "check-a", options.multipleBindings ? [bindingA, extra] : [bindingA]),
        ],
      },
    },
    relationships: [],
  });
  const candidatePayload = validDeliveryControlPayload("candidate-revision");
  const candidate = compileControlRecordRevision(DELIVERY, {
    recordId: "candidate-evaluation-preparation",
    recordKind: "candidate-revision",
    revision: 1,
    producer: { kind: "runtime", id: RUNTIME },
    semanticAuthor: { kind: "runtime", id: RUNTIME },
    semanticAuthority: "runtime-observed",
    createdAt: CREATED,
    semanticMarkdown: "# Candidate Revision\n",
    payload: {
      ...candidatePayload,
      candidateBaseCommit: "a".repeat(40),
      state: {
        ...(candidatePayload.state as ControlJsonObject),
        candidateDigest: digest("candidate-current"),
        tree: "b".repeat(40),
      },
    },
    relationships: [relationship("governed-by", boundary)],
  });
  const revisions = new Map<string, ControlRecordRevision>([
    [`${boundary.recordId}\0${boundary.revision}`, boundary],
    [`${candidate.recordId}\0${candidate.revision}`, candidate],
  ]);
  const priorSeal = options.priorCandidateCondition === undefined ? null :
    compileControlRecordRevision(DELIVERY, {
      recordId: "candidate-seal-prior-evaluation",
      recordKind: "candidate-seal",
      revision: 1,
      producer: { kind: "runtime", id: RUNTIME },
      semanticAuthor: { kind: "runtime", id: RUNTIME },
      semanticAuthority: "runtime-observed",
      createdAt: CREATED,
      semanticMarkdown: "# Prior Candidate Seal\n",
      payload: validDeliveryControlPayload("candidate-seal"),
      relationships: [relationship("seals", candidate), relationship("governed-by", boundary)],
    });
  if (priorSeal !== null) revisions.set(`${priorSeal.recordId}\0${priorSeal.revision}`, priorSeal);
  const retainedEvents: ControlRecordEvent[] = [];
  let sequence = 0;
  let predecessorDigest: Sha256 | null = null;
  let operationSupport: ControlRecordOperationSupport | null = null;
  let currentState: ReducedDeliveryState = Object.freeze({
    standing: "active",
    candidateCondition: options.priorCandidateCondition ?? "ready-for-work",
    activities: Object.freeze([]),
    subjects: Object.freeze({
      integrationAssessment: null,
      proposedBoundary: null,
      activeBoundary: ref(boundary),
      candidate: ref(candidate),
      materialCondition: null,
      seal: priorSeal === null ? null : ref(priorSeal),
      evidence: null,
      closure: null,
    }),
    delegation: { admission: null, current: null, charged: { operations: 0, agentAttempts: 0, reservedCellWallTimeMs: 0 } },
    journal: Object.freeze({ eventCount: 0, headDigest: null }),
    eligibleOperations: Object.freeze([
      "delivery.continue" as const,
      "delivery.evaluate" as const,
      "delivery.no-ship" as const,
    ]),
  });

  const supportCoordinate = (
    value: ControlRecordOperationSupport,
  ): ControlRecordOperationSupportCoordinate => Object.freeze({
    generation: value.generation,
    payloadDigest: value.payloadDigest,
  });

  const putSupport = (input: ControlRecordOperationSupportPut): ControlRecordOperationSupport => {
    if (input.expected === null) {
      assert.equal(operationSupport, null);
    } else {
      assert.notEqual(operationSupport, null);
      assert.deepEqual(supportCoordinate(operationSupport!), input.expected);
    }
    operationSupport = Object.freeze({
      schema: CONTROL_RECORD_OPERATION_SUPPORT_SCHEMA,
      storeId: identity.storeId,
      processId: identity.processId,
      activityId: input.activityId,
      supportKind: input.supportKind,
      generation: (operationSupport?.generation ?? 0) + 1,
      payload: input.payload,
      payloadDigest: digestCanonical(input.payload),
    });
    return operationSupport;
  };

  const retain = (append: ControlRecordStoreAppend): ControlRecordStoreAppendResult => {
    const revision = append.revision === undefined
      ? null
      : compileControlRecordRevision(identity.processId, append.revision);
    if (revision !== null) {
      revisions.set(`${revision.recordId}\0${revision.revision}`, revision);
    }
    sequence += 1;
    const event = compileControlRecordEvent({
      storeId: identity.storeId,
      processId: identity.processId,
      sequence,
      predecessorDigest,
      event: append.event,
    });
    predecessorDigest = event.digest;
    retainedEvents.push(event);
    if (event.eventKind === "activity-started") {
      const activityId = String(event.payload.activityId);
      currentState = Object.freeze({
        ...currentState,
        candidateCondition: "in-progress",
        activities: Object.freeze([Object.freeze({
          id: activityId,
          operation: "delivery.evaluate" as const,
          family: "agent" as const,
          stage: "started" as const,
          recovery: Object.freeze({
            kind: "finalization" as const,
            resumesAt: "candidate-sealed" as const,
            exactEffectDigest: null,
          }),
        })]),
        journal: Object.freeze({ eventCount: sequence, headDigest: event.digest }),
        eligibleOperations: Object.freeze([]),
      });
    } else if (event.eventKind === "candidate-sealed") {
      assert(revision !== null);
      currentState = Object.freeze({
        ...currentState,
        activities: Object.freeze([Object.freeze({
          ...currentState.activities[0]!,
          stage: "finalizing" as const,
          recovery: Object.freeze({
            kind: "finalization" as const,
            resumesAt: "evaluation-checks" as const,
            exactEffectDigest: null,
          }),
        })]),
        subjects: Object.freeze({ ...currentState.subjects, seal: ref(revision) }),
        journal: Object.freeze({ eventCount: sequence, headDigest: event.digest }),
      });
    } else if (event.eventKind === "agent-pre-intent-refused" || event.eventKind === "material-condition-frozen" || event.eventKind === "activity-completed") {
      const completed = event.eventKind === "activity-completed";
      currentState = Object.freeze({ ...currentState,
        activities: Object.freeze([{ ...currentState.activities[0]!, stage: completed ? "completed" as const : "finalizing" as const,
          recovery: completed ? null : Object.freeze({ kind: "finalization" as const,
            resumesAt: event.eventKind === "agent-pre-intent-refused" ? "activity-finalization" as const : "activity-completed" as const,
            exactEffectDigest: null }) }]),
        subjects: Object.freeze({ ...currentState.subjects,
          ...(event.eventKind === "material-condition-frozen" ? { materialCondition: ref(revision!) } : {}) }),
        journal: Object.freeze({ eventCount: sequence, headDigest: event.digest }),
      });
    } else {
      currentState = Object.freeze({
        ...currentState,
        journal: Object.freeze({ eventCount: sequence, headDigest: event.digest }),
      });
    }
    return Object.freeze({ revision, event });
  };

  const store = {
    identity,
    paths: Object.freeze({
      root: "/private/tmp/evaluation-preparation-store",
      database: "/private/tmp/evaluation-preparation-store/control-record-store.sqlite",
      files: "/private/tmp/evaluation-preparation-store/files",
      drafts: "/private/tmp/evaluation-preparation-store/drafts",
    }),
    state: () => currentState,
    getRevision: (recordId: string, revision: number) =>
      revisions.get(`${recordId}\0${revision}`) ?? null,
    listEvents: (after: number, limit: number) =>
      Object.freeze(retainedEvents.filter(({ sequence: value }) => value > after).slice(0, limit)),
    append: retain,
    appendBatch: (values: readonly ControlRecordStoreAppend[]) => Object.freeze(values.map(retain)),
    getOperationSupport: (activityId: string) =>
      operationSupport?.activityId === activityId ? operationSupport : null,
    putOperationSupport: putSupport,
    commitOperationBatch: (
      batch: ControlRecordStoreOperationBatch,
    ): ControlRecordStoreOperationBatchResult => {
      assert.equal(batch.supportMutations.length, 1);
      const mutation = batch.supportMutations[0]!;
      if (mutation.action === "delete") {
        assert(operationSupport !== null);
        assert.deepEqual(supportCoordinate(operationSupport), mutation.expected);
        const appends = Object.freeze(batch.appends.map(retain));
        operationSupport = null;
        return Object.freeze({ appends, supportMutations: Object.freeze([{ action: "delete" as const, activityId: mutation.activityId, support: null }]) });
      }
      const appends = Object.freeze(batch.appends.map(retain));
      const support = putSupport(mutation.value);
      return Object.freeze({
        appends,
        supportMutations: Object.freeze([Object.freeze({
          action: "put" as const,
          activityId: support.activityId,
          support,
        })]),
      });
    },
  } as unknown as ControlRecordStore;

  const appendSeal = (activityId: string) => {
    const revision: ControlRecordRevisionInput = Object.freeze({
      recordId: `candidate-seal-${activityId}`,
      recordKind: "candidate-seal",
      revision: 1,
      producer: { kind: "runtime" as const, id: RUNTIME },
      semanticAuthor: { kind: "runtime" as const, id: RUNTIME },
      semanticAuthority: "runtime-observed",
      createdAt: "2026-08-29T20:00:03.000Z",
      semanticMarkdown: "# Candidate Seal\n",
      payload: validDeliveryControlPayload("candidate-seal"),
      relationships: [
        relationship("seals", candidate),
        relationship("governed-by", boundary),
      ],
    });
    const compiled = compileControlRecordRevision(DELIVERY, revision);
    const result = retain({
      revision,
      event: {
        eventId: `event-candidate-sealed-${activityId}`,
        eventKind: "candidate-sealed",
        occurredAt: revision.createdAt,
        actor: { kind: "runtime", id: RUNTIME },
        subject: {
          recordId: compiled.recordId,
          revision: compiled.revision,
          digest: compiled.digest,
        },
        payload: { activityId },
      },
    });
    assert(result.revision !== null);
    return Object.freeze({ revision: result.revision, event: result.event });
  };

  const appendCheck = (activityId: string, selectionId: string, bindingId: string) => {
    const payload = validDeliveryControlPayload("check-receipt");
    const selectedBinding = payload.binding as ControlJsonObject;
    const revision: ControlRecordRevisionInput = Object.freeze({
      recordId: `check-receipt-${activityId}-${selectionId}`,
      recordKind: "check-receipt",
      revision: 1,
      producer: { kind: "runtime" as const, id: RUNTIME },
      semanticAuthor: { kind: "runtime" as const, id: RUNTIME },
      semanticAuthority: "runtime-observed",
      createdAt: "2026-08-29T20:00:04.000Z",
      semanticMarkdown: "# Check Receipt\n",
      payload: {
        ...payload,
        phase: "final",
        modality: "postcondition",
        selectionId,
        binding: { ...selectedBinding, id: bindingId },
      },
      relationships: [],
    });
    const compiled = compileControlRecordRevision(DELIVERY, revision);
    const result = retain({
      revision,
      event: {
        eventId: `event-check-receipt-${activityId}-${selectionId}`,
        eventKind: "check-receipt-recorded",
        occurredAt: revision.createdAt,
        actor: { kind: "runtime", id: RUNTIME },
        subject: {
          recordId: compiled.recordId,
          revision: compiled.revision,
          digest: compiled.digest,
        },
        payload: { activityId },
      },
    });
    assert(result.revision !== null);
    return Object.freeze({ revision: result.revision, event: result.event });
  };

  return Object.freeze({
    store,
    contract,
    boundary,
    candidate,
    events: retainedEvents,
    appendSeal,
    appendCheck,
  });
}

function times(): () => string {
  let value = Date.parse(CREATED);
  return () => new Date(value += 1_000).toISOString();
}

test("evaluation preparation seals before every deterministic final Check and recovers idempotently", async () => {
  const selected = fixture();
  const order: string[] = [];
  const result = await prepareDeliveryEvaluationV7({
    target: "/target",
    machineHome: "/machine-home",
    store: selected.store,
    contract: selected.contract,
    semanticMarkdown: "# Review direction\n\nReview the exact Candidate.\n",
    directorId: "director:test",
    agentId: AGENT,
    investment: investment(),
    runtimeId: RUNTIME,
  }, {
    now: times(),
    createActivityId: () => "activity-evaluate-v7",
    sealCandidate: async ({ activityId, machineHome, targetRepository }) => {
      assert.equal(machineHome, "/machine-home");
      assert.equal(targetRepository, "/target");
      order.push("candidate-sealed");
      return selected.appendSeal(activityId);
    },
    operateCheck: async ({ activityId, selectionId, bindingId }) => {
      order.push(`check:${selectionId}`);
      return selected.appendCheck(activityId, selectionId, bindingId).revision;
    },
  });

  assert.equal(result.activityId, "activity-evaluate-v7");
  assert.deepEqual(order, [
    "candidate-sealed",
    "check:selection-a",
    "check:selection-b",
  ]);
  assert.deepEqual(
    result.finalChecks.map(({ id }) => id),
    [
      "check-receipt-activity-evaluate-v7-selection-a",
      "check-receipt-activity-evaluate-v7-selection-b",
    ],
  );
  assert.deepEqual(selected.events.map(({ eventKind }) => eventKind), [
    "director-brief-submitted",
    "activity-started",
    "candidate-sealed",
    "check-receipt-recorded",
    "check-receipt-recorded",
  ]);

  let repeated = 0;
  const recovered = await recoverDeliveryEvaluationPreparationV7({
    target: "/target",
    machineHome: "/machine-home",
    store: selected.store,
    contract: selected.contract,
    activityId: result.activityId,
    runtimeId: RUNTIME,
  }, {
    sealCandidate: async () => {
      repeated += 1;
      return selected.appendSeal(result.activityId);
    },
    operateCheck: async () => {
      repeated += 1;
      throw new Error("No Check may repeat");
    },
  });
  assert.equal(repeated, 0);
  assert.deepEqual(recovered.finalChecks, result.finalChecks);
});

for (const priorCandidateCondition of ["needs-correction", "sealed-under-evaluation"] as const) {
  test(`eligible reevaluation from ${priorCandidateCondition} retains the prior Seal and selects one new exact Seal`, async () => {
    const selected = fixture({ priorCandidateCondition });
    const previous = selected.store.state().subjects.seal!;
    const previousRevision = selected.store.getRevision(previous.id, previous.revision);
    const order: string[] = [];
    const result = await prepareDeliveryEvaluationV7({
      target: "/target",
      machineHome: "/machine-home",
      store: selected.store,
      contract: selected.contract,
      semanticMarkdown: "# Review direction\n\nEvaluate the exact Candidate again under the same mandate.\n",
      directorId: "director:test",
      agentId: AGENT,
      investment: investment(),
      runtimeId: RUNTIME,
    }, {
      now: times(),
      createActivityId: () => `activity-reevaluate-${priorCandidateCondition}`,
      sealCandidate: async ({ activityId }) => {
        order.push("new-seal");
        assert.deepEqual(selected.store.state().subjects.seal, previous);
        return selected.appendSeal(activityId);
      },
      operateCheck: async ({ activityId, selectionId, bindingId }) => {
        order.push(selectionId);
        assert.notDeepEqual(selected.store.state().subjects.seal, previous);
        return selected.appendCheck(activityId, selectionId, bindingId).revision;
      },
    });
    assert.deepEqual(order, ["new-seal", "selection-a", "selection-b"]);
    assert.notEqual(result.seal.id, previous.id);
    assert.deepEqual(selected.store.state().subjects.seal, result.seal);
    assert.deepEqual(selected.store.state().subjects.candidate, ref(selected.candidate));
    assert.deepEqual(selected.store.state().subjects.activeBoundary, ref(selected.boundary));
    assert.deepEqual(selected.store.getRevision(previous.id, previous.revision), previousRevision);
  });
}

test("evaluation sealing retains only one stage-free time fact and reuses it on recovery", async () => {
  const selected = fixture();
  let samples = 0;
  const now = () => {
    samples += 1;
    return new Date(Date.parse(CREATED) + samples * 1_000).toISOString();
  };
  await assert.rejects(prepareDeliveryEvaluationV7({
    target: "/target",
    machineHome: "/machine-home",
    store: selected.store,
    contract: selected.contract,
    semanticMarkdown: "# Review direction\n\nReview exact proof.\n",
    directorId: "director:test",
    agentId: AGENT,
    investment: investment(),
    runtimeId: RUNTIME,
  }, {
    now,
    createActivityId: () => "activity-evaluate-seal-checkpoint",
    sealCandidate: async () => {
      throw new Error("lost before durable Seal append");
    },
  }), /lost before durable Seal append/u);

  const envelope = selected.store.getOperationSupport("activity-evaluate-seal-checkpoint")!.payload;
  const parent = (envelope.checkpoint as ControlJsonObject).value as ControlJsonObject;
  assert.deepEqual(parent.roleCheckpoint, {
    schema: "lifecycle.evaluation-seal-checkpoint.v1",
    sealedAt: "2026-08-29T20:00:03.000Z",
  });
  assert.equal(Object.hasOwn(parent.roleCheckpoint as object, "stage"), false);
  assert.equal(Object.hasOwn(parent.roleCheckpoint as object, "activityId"), false);

  let recoveredSealedAt: string | null = null;
  await recoverDeliveryEvaluationPreparationV7({
    target: "/target",
    machineHome: "/machine-home",
    store: selected.store,
    contract: selected.contract,
    activityId: "activity-evaluate-seal-checkpoint",
    runtimeId: RUNTIME,
  }, {
    now,
    sealCandidate: async ({ activityId, sealedAt }) => {
      recoveredSealedAt = sealedAt;
      return selected.appendSeal(activityId);
    },
    operateCheck: async ({ activityId, selectionId, bindingId }) =>
      selected.appendCheck(activityId, selectionId, bindingId).revision,
  });
  assert.equal(recoveredSealedAt, "2026-08-29T20:00:03.000Z");
  assert.equal(samples, 3);
});

test("evaluation recovery continues after a Seal append whose caller did not observe return", async () => {
  const selected = fixture();
  await assert.rejects(prepareDeliveryEvaluationV7({
    target: "/target",
    machineHome: "/machine-home",
    store: selected.store,
    contract: selected.contract,
    semanticMarkdown: "# Review direction\n\nReview exact proof.\n",
    directorId: "director:test",
    agentId: AGENT,
    investment: investment(),
    runtimeId: RUNTIME,
  }, {
    now: times(),
    createActivityId: () => "activity-evaluate-seal-interruption",
    sealCandidate: async ({ activityId }) => {
      selected.appendSeal(activityId);
      throw new Error("caller lost after durable Seal");
    },
  }), /caller lost/u);

  let sealRepeated = false;
  const result = await recoverDeliveryEvaluationPreparationV7({
    target: "/target",
    machineHome: "/machine-home",
    store: selected.store,
    contract: selected.contract,
    activityId: "activity-evaluate-seal-interruption",
    runtimeId: RUNTIME,
  }, {
    now: times(),
    sealCandidate: async () => {
      sealRepeated = true;
      throw new Error("Seal repeated");
    },
    operateCheck: async ({ activityId, selectionId, bindingId }) =>
      selected.appendCheck(activityId, selectionId, bindingId).revision,
  });
  assert.equal(sealRepeated, false);
  assert.equal(result.finalChecks.length, 2);
});

test("evaluation recovery routes a live final-Check checkpoint without reparsing it as Seal support", async () => {
  const selected = fixture();
  const activityId = "activity-evaluate-live-check-checkpoint";
  await assert.rejects(prepareDeliveryEvaluationV7({
    target: "/target",
    machineHome: "/machine-home",
    store: selected.store,
    contract: selected.contract,
    semanticMarkdown: "# Review direction\n\nReview exact proof.\n",
    directorId: "director:test",
    agentId: AGENT,
    investment: investment(),
    runtimeId: RUNTIME,
  }, {
    now: times(),
    createActivityId: () => activityId,
    sealCandidate: async ({ activityId: selectedActivityId }) =>
      selected.appendSeal(selectedActivityId),
    operateCheck: async (input) => {
      const seal = selected.store.state().subjects.seal;
      assert.notEqual(seal, null);
      const support = input.support.current();
      await input.support.step({
        mode: "checkpoint",
        expected: support.coordinate,
        checkpoint: Object.freeze({
          schema: "lifecycle.check-cell-operation-checkpoint.v1",
          phase: "final",
          selectionId: input.selectionId,
          bindingId: input.bindingId,
          proofSubject: Object.freeze({ kind: "candidate-seal", ...seal! }),
          specificationDigest: digest("retained-final-check-specification"),
          inputSetDigest: digest("retained-final-check-input-set"),
          execution: null,
        }),
      });
      throw new Error("lost while the final Check checkpoint remained live");
    },
  }), /final Check checkpoint remained live/u);

  let sealRepeated = false;
  const recoveredSelections: string[] = [];
  const recovered = await recoverDeliveryEvaluationPreparationV7({
    target: "/target",
    machineHome: "/machine-home",
    store: selected.store,
    contract: selected.contract,
    activityId,
    runtimeId: RUNTIME,
  }, {
    now: times(),
    sealCandidate: async () => {
      sealRepeated = true;
      throw new Error("Final-Check recovery must not repeat the Seal");
    },
    operateCheck: async (input) => {
      recoveredSelections.push(input.selectionId);
      const support = input.support.current();
      if (input.selectionId === "selection-a") {
        assert.equal(
          support.checkpoint?.schema,
          "lifecycle.check-cell-operation-checkpoint.v1",
        );
        assert.equal(support.checkpoint?.selectionId, input.selectionId);
        await input.support.step({
          mode: "checkpoint",
          expected: support.coordinate,
          checkpoint: null,
        });
      } else {
        assert.equal(support.checkpoint, null);
      }
      return selected.appendCheck(activityId, input.selectionId, input.bindingId).revision;
    },
  });

  assert.equal(sealRepeated, false);
  assert.deepEqual(recoveredSelections, ["selection-a", "selection-b"]);
  assert.equal(recovered.finalChecks.length, 2);
  const envelope = selected.store.getOperationSupport(activityId)!.payload;
  const parent = (envelope.checkpoint as ControlJsonObject).value as ControlJsonObject;
  assert.equal(parent.roleCheckpoint, null);
});

test("evaluation recovery does not repeat a final Check retained before caller loss", async () => {
  const selected = fixture();
  const observed: string[] = [];
  await assert.rejects(prepareDeliveryEvaluationV7({
    target: "/target",
    machineHome: "/machine-home",
    store: selected.store,
    contract: selected.contract,
    semanticMarkdown: "# Review direction\n\nReview exact proof.\n",
    directorId: "director:test",
    agentId: AGENT,
    investment: investment(),
    runtimeId: RUNTIME,
  }, {
    now: times(),
    createActivityId: () => "activity-evaluate-check-interruption",
    sealCandidate: async ({ activityId }) => selected.appendSeal(activityId),
    operateCheck: async ({ activityId, selectionId, bindingId }) => {
      observed.push(selectionId);
      const retained = selected.appendCheck(activityId, selectionId, bindingId);
      throw new Error(`caller lost after durable ${retained.revision.recordId}`);
    },
  }), /caller lost after durable/u);

  const result = await recoverDeliveryEvaluationPreparationV7({
    target: "/target",
    machineHome: "/machine-home",
    store: selected.store,
    contract: selected.contract,
    activityId: "activity-evaluate-check-interruption",
    runtimeId: RUNTIME,
  }, {
    now: times(),
    sealCandidate: async () => {
      throw new Error("Final-Check recovery must not repeat the Seal");
    },
    operateCheck: async ({ activityId, selectionId, bindingId }) => {
      observed.push(selectionId);
      return selected.appendCheck(activityId, selectionId, bindingId).revision;
    },
  });

  assert.deepEqual(observed, ["selection-a", "selection-b"]);
  assert.equal(result.finalChecks.length, 2);
  assert.deepEqual(
    selected.events.filter(({ eventKind }) => eventKind === "check-receipt-recorded")
      .map(({ subject }) => subject?.recordId),
    [
      "check-receipt-activity-evaluate-check-interruption-selection-a",
      "check-receipt-activity-evaluate-check-interruption-selection-b",
    ],
  );
});

test("evaluation refuses unsupported Check Binding cardinality before opening activity", async () => {
  const selected = fixture({ multipleBindings: true });
  await assert.rejects(prepareDeliveryEvaluationV7({
    target: "/target",
    machineHome: "/machine-home",
    store: selected.store,
    contract: selected.contract,
    semanticMarkdown: "# Review direction\n\nReview.\n",
    directorId: "director:test",
    agentId: AGENT,
    investment: investment(),
    runtimeId: RUNTIME,
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.evaluation-preparation-v7.check-binding-cardinality");
  assert.equal(selected.events.length, 0);
});


test("aggregate Projection refusal cannot mint a witness from non-excess, malformed counts, or another profile's limits", () => {
  const profile = defaultProjectionProfiles()["execution-standard-v1"]!;
  const request = { profile, digest: digest("aggregate-refusal-request") } as FoundationExecutionProjectionRequest;
  const facts = { mandatoryItems: 1, mandatoryBytes: 1, sourceBytes: 0,
    maximumMandatoryItems: profile.maximumMandatoryItems, maximumMandatoryBytes: profile.maximumMandatoryBytes,
    maximumItemBytes: profile.maximumItemBytes, maximumSourceBytes: profile.maximumSourceBytes, oversized: [] };
  for (const invalid of [facts, { ...facts, mandatoryItems: -1 },
    { ...facts, mandatoryBytes: Number.MAX_SAFE_INTEGER + 1 },
    { ...facts, mandatoryItems: profile.maximumMandatoryItems + 1, maximumMandatoryItems: 0 },
    { ...facts, oversized: [{ id: "source", bytes: profile.maximumItemBytes }] }]) {
    assert.throws(() => completeMandatoryProjectionSizeErrorV1(request, invalid), /exact measured excess/);
  }
  const error = completeMandatoryProjectionSizeErrorV1(request, { ...facts, mandatoryItems: profile.maximumMandatoryItems + 1 });
  const refusal = bindFoundationMandatoryProjectionRefusalV1(error, request);
  assert.equal(refusal?.measurement.kind, "complete-closure");
});

for (const interrupted of [false, true]) test(`measured reviewer refusal retains a Condition and settles without an Attempt (completion interruption ${interrupted})`, async () => {
  const selected = fixture();
  const activityId = "evaluation-measured-refusal";
  await prepareDeliveryEvaluationV7({ target: "/target", machineHome: "/machine-home", store: selected.store,
    contract: selected.contract, semanticMarkdown: "# Review\n", directorId: "director:test", agentId: AGENT,
    investment: investment(), runtimeId: RUNTIME,
  }, { now: times(), createActivityId: () => activityId,
    sealCandidate: async ({ activityId: id }) => selected.appendSeal(id),
    operateCheck: async ({ activityId: id, selectionId, bindingId }) => selected.appendCheck(id, selectionId, bindingId).revision,
  });
  const state = selected.store.state();
  const profile = defaultProjectionProfiles()["execution-standard-v1"]!;
  // Exact compiler selection is injected here; real compiler measurement and
  // refusal classification are separately exercised by Projection fixtures.
  const request = { class: "execution", role: "reviewer", target: { id: TARGET, generation: 1 }, profile,
    digest: digest("exact-reviewer-request"), subject: { class: "execution",
      workBoundary: { kind: "work-boundary", ...state.subjects.activeBoundary },
      candidate: { revision: { kind: "candidate-revision", ...state.subjects.candidate },
        seal: { kind: "candidate-seal", ...state.subjects.seal } } },
  } as unknown as FoundationExecutionProjectionRequest;
  const error = mandatoryProjectionItemSizeErrorV1({ profile, category: "implementation", id: "mandatory.source",
    locator: "src/large.ts", objectId: "a".repeat(40), observedBytes: profile.maximumItemBytes + 1 });
  const refusal = bindFoundationMandatoryProjectionRefusalV1(error, request);
  assert(refusal !== null);
  const originalBatch = selected.store.appendBatch.bind(selected.store);
  let refusalBatches = 0;
  selected.store.appendBatch = (appends) => {
    assert.deepEqual(appends.map(({ event }) => event.eventKind), ["agent-pre-intent-refused", "material-condition-frozen"]);
    refusalBatches += 1;
    const result = originalBatch(appends);
    if (interrupted) throw new Error("lost return after atomic refusal and Condition");
    return result;
  };
  assert.throws(() => settleFoundationUnallocatedReviewV7({ store: selected.store, activityId, runtimeId: RUNTIME, refusal,
    now: () => "2026-08-29T20:01:00.000Z" }), interrupted ? /lost return/ : /requires boundary resolution/);
  assert.equal(refusalBatches, 1);
  const frozen = selected.store.state().subjects.materialCondition;
  assert(frozen !== null);
  const condition = selected.store.getRevision(frozen.id, frozen.revision)!;
  assert.equal(condition.payload.conditionClass, "projection-closure-exceeded");
  assert.equal((condition.payload.source as ControlJsonObject).requestDigest, request.digest);
  assert.equal(selected.events.some(({ eventKind }) => eventKind === "agent-attempt-prepared" || eventKind === "provider-effect-intended"), false);
  if (interrupted) {
    assert(selected.store.getOperationSupport(activityId) !== null);
    assert.throws(() => settleFoundationUnallocatedReviewV7({ store: selected.store, activityId, runtimeId: RUNTIME, refusal: null,
      now: () => "2026-08-29T20:01:01.000Z" }), /requires boundary resolution/);
    assert.equal(refusalBatches, 1);
  }
  assert.equal(selected.store.state().activities[0]?.stage, "completed");
  assert.equal(selected.store.getOperationSupport(activityId), null);
  assert.equal(selected.events.at(-1)?.payload.outcome, "abandoned");
});
