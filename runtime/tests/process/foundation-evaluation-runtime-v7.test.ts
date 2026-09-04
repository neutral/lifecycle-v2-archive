import assert from "node:assert/strict";
import test from "node:test";
import { compileControlRecordRevision } from "../../src/foundation/control/model.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlRecordRevision,
} from "../../src/foundation/control/types.js";
import type { FoundationInstalledRuntimeConfigurationV7 } from "../../src/foundation/installed-configuration-v7.js";
import type { FoundationAgentOperationV7Input } from "../../src/foundation/process/agent-operation-v7.js";
import type {
  FoundationEvaluationPreparationV7Input,
  FoundationEvaluationPreparationV7Options,
} from "../../src/foundation/process/evaluation-preparation-v7.js";
import {
  evaluateDeliveryV7,
  recoverDeliveryEvaluationV7,
  type FoundationEvaluationRuntimeV7Options,
} from "../../src/foundation/process/evaluation-runtime-v7.js";
import { digestCanonical, sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";
import type { DeliveryControlRecordKind } from "../../src/foundation/control/kind-registry.js";

const PROCESS = "delivery-evaluation-runtime-v7";
const TARGET = "target-evaluation-runtime-v7";
const ACTIVITY = "activity-evaluation-runtime-v7";
const RUNTIME = "runtime:evaluation-runtime-v7";
const CREATED = "2026-08-29T22:00:00.000Z";

function revision(kind: DeliveryControlRecordKind, id: string): ControlRecordRevision {
  return compileControlRecordRevision(PROCESS, {
    recordId: id,
    recordKind: kind,
    revision: 1,
    producer: Object.freeze({ kind: "runtime", id: RUNTIME }),
    semanticAuthor: Object.freeze({ kind: "runtime", id: RUNTIME }),
    semanticAuthority: "runtime-derived",
    createdAt: CREATED,
    semanticMarkdown: `# ${kind}\n`,
    payload: validDeliveryControlPayload(kind),
    relationships: Object.freeze([]),
  });
}

function configuration(): FoundationInstalledRuntimeConfigurationV7 {
  return Object.freeze({
    machineHome: "/tmp/evaluation-runtime-machine",
    installationId: `installation.lifecycle.${"1".repeat(64)}`,
    codexHome: "/tmp/evaluation-runtime-machine/codex-home",
    model: "gpt-evaluation-runtime",
    reasoning: "high",
    specificationRevision: "lifecycle.foundation.1.0.0-rc.10",
    publicationDigest: sha256Bytes("evaluation-runtime-publication"),
  });
}

function fixture(stage: "evaluation-opened" | "activity-opened") {
  const boundary = revision("work-boundary", "work-boundary-evaluation-runtime");
  const candidate = revision("candidate-revision", "candidate-evaluation-runtime");
  const seal = revision("candidate-seal", "candidate-seal-evaluation-runtime");
  const brief = revision("founder-brief", "founder-brief-evaluation-runtime");
  const attempt = revision("agent-attempt", "agent-attempt-evaluation-runtime");
  const retained = new Map([boundary, candidate, seal, brief, attempt].map((value) => [
    `${value.recordId}\0${value.revision}`,
    value,
  ]));
  const ref = (value: ControlRecordRevision) => Object.freeze({
    id: value.recordId,
    revision: value.revision,
    digest: value.digest,
  });
  let generation = 1;
  let currentStage = stage;
  const supportView = () => Object.freeze({
    operation: "delivery.evaluate" as const,
    role: "reviewer" as const,
    activityId: ACTIVITY,
    stage: currentStage,
    coordinate: null,
    execution: null,
    brief: ref(brief),
    attempt: currentStage === "evaluation-opened" ? null : ref(attempt),
    boundary: ref(boundary),
    attemptedCandidate: ref(candidate),
    seal: currentStage === "evaluation-opened" ? null : ref(seal),
    opening: Object.freeze({
      agentId: "agent:evaluation-runtime-v7",
      runtimeId: RUNTIME,
      founderId: "founder:evaluation-runtime-v7",
      submittedAt: CREATED,
      startedAt: "2026-08-29T22:00:01.000Z",
      founderSubmissionRawDigest: sha256Bytes("# Evaluate\n"),
      founderSubmissionRawByteLength: 11,
      founderSemanticDigest: sha256Bytes("# Evaluate\n"),
      founderSemanticByteLength: 11,
      investment: Object.freeze({
        id: "investment-evaluation-runtime",
        model: configuration().model,
        reasoning: configuration().reasoning,
        wallTimeMs: 1,
        limits: Object.freeze({
          tokens: null,
          events: 1,
          outputBytes: 1,
          toolCalls: null,
          processes: 1,
          storageBytes: 1,
        }),
        rationale: "fresh-independent-review",
        digest: sha256Bytes("retained-investment-placeholder"),
      }),
    }),
    plan: currentStage === "evaluation-opened" ? null : Object.freeze({
      attemptCreatedAt: "2026-08-29T22:00:04.000Z",
    }),
    promotedExecutionPlan: null,
    finalization: null,
    candidateObservationFailureDigest: null,
    resultCandidate: null,
    receipt: null,
    roleCheckpoint: null,
  });
  const store = {
    identity: Object.freeze({
      schema: CONTROL_RECORD_STORE_SCHEMA,
      storeId: "store-evaluation-runtime-v7",
      targetId: TARGET,
      processKind: "delivery",
      processId: PROCESS,
      createdAt: CREATED,
    }),
    state: () => Object.freeze({
      standing: "evaluating" as const,
      candidateCondition: "sealed-under-evaluation" as const,
      activities: Object.freeze([]),
      subjects: Object.freeze({
        proposedBoundary: null,
        activeBoundary: ref(boundary),
        candidate: ref(candidate),
        materialCondition: null,
        seal: ref(seal),
        evidence: null,
        closure: null,
      }),
      journal: Object.freeze({ eventCount: 1, headDigest: sha256Bytes("evaluation-head") }),
      eligibleOperations: Object.freeze([]),
    }),
    getRevision: (id: string, selected: number) => retained.get(`${id}\0${selected}`) ?? null,
    getOperationSupport: (activityId: string) => {
      assert.equal(activityId, ACTIVITY);
      return Object.freeze({
        schema: "lifecycle.control-record-operation-support.v1" as const,
        storeId: "store-evaluation-runtime-v7",
        processId: PROCESS,
        activityId: ACTIVITY,
        supportKind: "lifecycle.delivery-agent-activity-support.v1",
        generation,
        payload: Object.freeze({ schema: "test-support" }),
        payloadDigest: sha256Bytes(`evaluation-support-${generation}`),
      });
    },
  } as unknown as ControlRecordStore;
  const projection = Object.freeze({
    manifest: Object.freeze({
      projectionId: "projection-evaluation-runtime",
      class: "execution",
      role: "reviewer",
      profile: "execution-standard-v1",
      digest: sha256Bytes("evaluation-projection"),
      basis: Object.freeze({
        commit: "a".repeat(40),
        tree: "b".repeat(40),
        repositoryContractDigest: sha256Bytes("contract"),
        knowledgeSetDigest: sha256Bytes("knowledge"),
      }),
    }),
  });
  const investmentValue = Object.freeze({
    id: "investment-evaluation-runtime",
    model: configuration().model,
    reasoning: configuration().reasoning,
    wallTimeMs: 1,
    limits: Object.freeze({
      tokens: null,
      events: 1,
      outputBytes: 1,
      toolCalls: null,
      processes: 1,
      storageBytes: 1,
    }),
    rationale: "fresh-independent-review",
  });
  const investment = Object.freeze({ ...investmentValue, digest: digestCanonical(investmentValue) });
  const baseContext = Object.freeze({
    activityId: ACTIVITY,
    operation: "delivery.evaluate" as const,
    role: "reviewer" as const,
    semanticMarkdown: "# Evaluate\n",
    boundary,
    candidate,
    attemptSeal: seal,
    seal,
    materialCondition: null,
    epoch: Object.freeze({}),
    snapshot: Object.freeze({}),
    repositoryValidation: Object.freeze({}),
    knowledge: Object.freeze({}),
    request: Object.freeze({}),
    subject: Object.freeze({}),
    projection,
    roleSubject: Object.freeze({ schema: "review-role-subject" }),
    capabilityProfile: Object.freeze({ id: "capability", digest: sha256Bytes("capability") }),
    providerCapability: Object.freeze({ candidateWrites: false }),
    providerInput: Object.freeze({ role: "reviewer", operation: "delivery.evaluate" }),
    evidenceSet: Object.freeze({ subject: Object.freeze({}), digest: sha256Bytes("evidence-set") }),
    propositionSet: Object.freeze({ subject: Object.freeze({}), digest: sha256Bytes("propositions") }),
    investment,
    rootTokenSetDigest: sha256Bytes("roots"),
    configuration: configuration(),
    opening: Object.freeze({
      agentId: "agent:evaluation-runtime-v7",
      runtimeId: RUNTIME,
      founderId: "founder:evaluation-runtime-v7",
      submittedAt: CREATED,
      startedAt: "2026-08-29T22:00:01.000Z",
    }),
    brief,
  });
  return {
    store,
    boundary,
    candidate,
    seal,
    attempt,
    supportView,
    promote() {
      currentStage = "activity-opened";
      generation += 1;
    },
    context: baseContext,
    retainedContext: Object.freeze({
      ...baseContext,
      opening: Object.freeze({
        ...baseContext.opening,
        attemptCreatedAt: "2026-08-29T22:00:04.000Z",
      }),
      attempt,
      boundaryResolutionBasis: null,
    }),
  };
}

function runtimeOptions(value: ReturnType<typeof fixture>, calls: string[]): FoundationEvaluationRuntimeV7Options {
  return Object.freeze({
    now: () => "2026-08-29T22:00:04.000Z",
    owners: Object.freeze({
      inspect: () => Object.freeze({
        support: value.supportView(),
        coordinate: Object.freeze({
          generation: value.store.getOperationSupport(ACTIVITY)!.generation,
          payloadDigest: value.store.getOperationSupport(ACTIVITY)!.payloadDigest,
        }),
      }) as never,
      recoverPreparation: async () => {
        calls.push("recover-preparation");
        return Object.freeze({ activityId: ACTIVITY }) as never;
      },
      observeReviewer: async (input: Readonly<{ machineHome: string }>) => {
        assert.equal(input.machineHome, configuration().machineHome);
        calls.push("observe-reviewer");
        return Object.freeze({ activityId: ACTIVITY }) as never;
      },
      compileUnpromoted: async () => {
        calls.push("compile-unpromoted");
        return value.context as never;
      },
      compileRetained: async () => {
        calls.push("compile-retained");
        return value.retainedContext as never;
      },
      promote: () => {
        calls.push("promote");
        value.promote();
        return Object.freeze({ activityId: ACTIVITY }) as never;
      },
      advance: async (request: FoundationAgentOperationV7Input) => {
        calls.push("advance");
        await request.revalidateBeforeIntent(Object.freeze({
          store: value.store,
          activityId: ACTIVITY,
          operation: "delivery.evaluate",
          role: "reviewer",
          brief: value.boundary,
          boundary: value.boundary,
          candidate: value.candidate,
          seal: value.seal,
          projection: value.context.projection,
        }) as never);
        return Object.freeze({
          activityId: ACTIVITY,
          operation: "delivery.evaluate",
          outcome: "completed",
          attempt: Object.freeze({ id: value.attempt.recordId, revision: 1, digest: value.attempt.digest }),
          workProduct: null,
          candidate: Object.freeze({ id: value.candidate.recordId, revision: 1, digest: value.candidate.digest }),
          receipt: Object.freeze({ id: "receipt", revision: 1, digest: sha256Bytes("receipt") }),
          controls: Object.freeze([]),
        });
      },
    }),
  } as unknown as FoundationEvaluationRuntimeV7Options);
}

test("unpromoted evaluation recovery finishes preparation, promotes once, and revalidates before intent", async () => {
  const value = fixture("evaluation-opened");
  const calls: string[] = [];
  const result = await recoverDeliveryEvaluationV7({
    target: "/tmp/evaluation-runtime-target",
    store: value.store,
    contract: Object.freeze({ targetId: TARGET }) as never,
    configuration: configuration(),
    activityId: ACTIVITY,
    runtimeId: RUNTIME,
  }, runtimeOptions(value, calls));

  assert.equal(result.outcome, "completed");
  assert.deepEqual(calls, [
    "recover-preparation",
    "observe-reviewer",
    "compile-unpromoted",
    "promote",
    "advance",
    "observe-reviewer",
    "compile-retained",
  ]);
});

test("promoted evaluation recovery skips preparation and promotion and preserves its Attempt time", async () => {
  const value = fixture("activity-opened");
  const calls: string[] = [];
  const result = await recoverDeliveryEvaluationV7({
    target: "/tmp/evaluation-runtime-target",
    store: value.store,
    contract: Object.freeze({ targetId: TARGET }) as never,
    configuration: configuration(),
    activityId: ACTIVITY,
    runtimeId: RUNTIME,
  }, runtimeOptions(value, calls));

  assert.equal(result.outcome, "completed");
  assert.equal(calls.includes("recover-preparation"), false);
  assert.equal(calls.includes("compile-unpromoted"), false);
  assert.equal(calls.includes("promote"), false);
  assert.deepEqual(calls, [
    "observe-reviewer",
    "compile-retained",
    "advance",
    "observe-reviewer",
    "compile-retained",
  ]);
});

test("fresh evaluation fixes activity identity and Investment before preparation", async () => {
  const value = fixture("evaluation-opened");
  const calls: string[] = [];
  const baseOptions = runtimeOptions(value, calls);
  const options = Object.freeze({
    ...baseOptions,
    owners: Object.freeze({
      ...baseOptions.owners,
      prepare: async (
        input: FoundationEvaluationPreparationV7Input,
        preparation: FoundationEvaluationPreparationV7Options = {},
      ) => {
        calls.push("prepare");
        assert.equal(preparation.createActivityId?.(), ACTIVITY);
        assert.match(input.investment.id, /^investment-/u);
        assert.match(input.investment.digest, /^sha256:[a-f0-9]{64}$/u);
        return Object.freeze({ activityId: ACTIVITY }) as never;
      },
    }),
  }) as unknown as FoundationEvaluationRuntimeV7Options;
  const result = await evaluateDeliveryV7({
    target: "/tmp/evaluation-runtime-target",
    store: value.store,
    contract: Object.freeze({ targetId: TARGET }) as never,
    configuration: configuration(),
    semanticMarkdown: "# Evaluate\n",
    founderId: "founder:evaluation-runtime-v7",
    agentId: "agent:evaluation-runtime-v7",
    runtimeId: RUNTIME,
  }, Object.freeze({ ...options, createActivityId: () => ACTIVITY }));
  assert.equal(result.activityId, ACTIVITY);
  assert.equal(calls[0], "prepare");
  assert.equal(calls.includes("recover-preparation"), false);
});
