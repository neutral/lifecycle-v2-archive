import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createFoundationRuntimeOperationRequest,
  type FoundationRuntimeOperationRequestInput,
} from "@neutral/lifecycle-protocol";
import {
  createDeliveryControlRecordStore,
  openDeliveryControlRecordStore,
} from "../../src/foundation/control/delivery-custody.js";
import {
  compileAgentPreIntentRefusalAppend,
  compileDeliveryActivityCompletionAppend,
} from "../../src/foundation/control/activity.js";
import { openAgentActivity } from "../../src/foundation/control/founder-brief.js";
import { FoundationError } from "../../src/foundation/error.js";
import type { FoundationInstalledRuntimeConfigurationV7 } from "../../src/foundation/installed-configuration-v7.js";
import type { FoundationRuntimeMutationRequest } from "../../src/foundation/facade.js";
import { git } from "../../src/foundation/repository/git.js";
import { initializeRepository } from "../../src/foundation/repository/initialize.js";
import { loadRepositoryEpoch } from "../../src/foundation/repository/snapshot.js";
import {
  assertExclusiveActiveDeliveryLeaseV7,
  createFoundationRuntimeMutationExecutorV7,
  type FoundationRuntimeMutationV7Admission,
  type FoundationRuntimeMutationV7Candidate,
  type FoundationRuntimeMutationV7Evaluation,
  type FoundationRuntimeMutationV7Preparation,
} from "../../src/foundation/runtime-mutation-v7.js";
import type { FoundationPreparationBasisV7 } from "../../src/foundation/process/preparation-context-v7.js";
import { foundationMutationResultV7 } from "../../src/foundation/process/mutation-result-v7.js";
import {
  FOUNDATION_GENERATED_PUBLICATION_DIGEST,
  FOUNDATION_GENERATED_SPECIFICATION_REVISION,
} from "../../src/foundation/validation/generated-schemas.js";
import { writeMinimalAtlas } from "../helpers/atlas-fixture.js";

const NOW = "2026-08-29T18:00:00.000Z";
const SECRET = "runtime-mutation-compositor-secret-with-at-least-thirty-two-bytes";
const RUNTIME_ID = "lifecycle-runtime-foundation-v7";

type Scenario = Readonly<{
  root: string;
  target: string;
  machineHome: string;
  configuration: FoundationInstalledRuntimeConfigurationV7;
  targetId: string;
}>;

async function withScenario(
  verify: (scenario: Scenario) => void | Promise<void>,
): Promise<void> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-runtime-compositor-")));
  const target = join(root, "target");
  const machineHome = join(root, "machine");
  await Promise.all([
    mkdir(target, { mode: 0o700 }),
    mkdir(machineHome, { mode: 0o700 }),
  ]);
  try {
    await git(target, ["init", "-b", "main"]);
    await git(target, ["config", "user.name", "Lifecycle Test"]);
    await git(target, ["config", "user.email", "lifecycle@example.invalid"]);
    await writeMinimalAtlas(target);
    await git(target, ["add", "--", "atlas"]);
    await git(target, ["commit", "-m", "Initialize target"]);
    const contract = await initializeRepository(target, {
      targetId: "runtime-compositor-target",
      founderPrincipal: "founder:runtime-compositor",
      home: machineHome,
      authoritySecret: SECRET,
      publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
      implementationRoots: [],
      stage: true,
    });
    await git(target, ["add", "--", "."]);
    await git(target, ["commit", "-m", "Initialize Lifecycle target"]);
    await verify(Object.freeze({
      root,
      target: await realpath(target),
      machineHome,
      targetId: contract.targetId,
      configuration: Object.freeze({
        machineHome,
        installationId: `installation.lifecycle.${"1".repeat(64)}`,
        codexHome: join(root, "unused-codex-home"),
        model: "test-model",
        reasoning: "test-reasoning",
        specificationRevision: FOUNDATION_GENERATED_SPECIFICATION_REVISION,
        publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
      }),
    }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function createStore(
  scenario: Scenario,
  deliveryId: string,
) {
  return await createDeliveryControlRecordStore({
    machineHome: scenario.machineHome,
    targetId: scenario.targetId,
    deliveryId,
    createdAt: NOW,
    runtimeActorId: RUNTIME_ID,
  });
}

type MutationRequestInput = FoundationRuntimeMutationRequest extends infer Request
  ? Request extends unknown ? Omit<Request, "schema"> : never
  : never;

function request(input: MutationRequestInput): FoundationRuntimeMutationRequest {
  return createFoundationRuntimeOperationRequest(
    input as FoundationRuntimeOperationRequestInput,
  ) as FoundationRuntimeMutationRequest;
}

function sentinel(label: string): Error {
  return new Error(`sentinel:${label}`);
}

test("completed mutation results expose one bounded durable submission diagnostic", async () => {
  await withScenario(async (scenario) => {
    const created = await createStore(scenario, "delivery-public-submission-diagnostic");
    try {
      const prepare = request({
        target: scenario.target,
        operation: "delivery.prepare",
        input: { semanticMarkdown: "Inspect this target." },
      });
      const factsDigest = `sha256:${"7".repeat(64)}` as const;
      const result = await foundationMutationResultV7({
        request: prepare,
        store: created.store,
        status: "completed",
        observedAt: NOW,
        afterSequence: 0,
        submissionDiagnostic: {
          code: "lifecycle.agent-work-product.invalid.title",
          stage: "template",
          factsDigest,
        },
      });
      assert.equal(result.status, "completed");
      assert.deepEqual(result.diagnostics, [{
        code: "lifecycle.agent-work-product.invalid.title",
        severity: "error",
        message: "The governed Agent semantic submission did not satisfy its exact profile",
        retryable: false,
        facts: { stage: "template", factsDigest },
      }]);
    } finally {
      created.store.close();
    }
  });
});

test("retained terminal results remain public when the current Atlas is invalid", async () => {
  await withScenario(async (scenario) => {
    const deliveryId = "delivery-terminal-invalid-current-atlas";
    const created = await createStore(scenario, deliveryId);
    try {
      await writeFile(join(scenario.target, "atlas/atlas.md"), "invalid current Atlas\n", "utf8");
      await git(scenario.target, ["add", "--", "atlas/atlas.md"]);
      await git(scenario.target, ["commit", "-m", "Make current Atlas invalid"]);
      const headCommit = (await git(scenario.target, ["rev-parse", "HEAD"])).stdout.trim();
      const accept = request({
        target: scenario.target,
        operation: "delivery.accept",
        deliveryId,
        input: null,
      });
      await assert.rejects(foundationMutationResultV7({
        request: accept,
        store: created.store,
        status: "recovery-required",
        error: new FoundationError("lifecycle.atlas.invalid", "Current Atlas is invalid", {
          retryable: true,
        }),
        observedAt: NOW,
        afterSequence: 0,
      }), /Post-operation observation is not the exact valid target/u);

      const waiting = await foundationMutationResultV7({
        request: accept,
        store: created.store,
        status: "recovery-required",
        error: new FoundationError("lifecycle.atlas.invalid", "Current Atlas is invalid", {
          retryable: true,
        }),
        observedAt: NOW,
        afterSequence: 0,
        repositoryObservation: "identity-current",
      });
      assert.equal(waiting.status, "recovery-required");
      assert.equal(waiting.observation.repository.initialized, true);
      assert.equal(waiting.observation.repository.valid, false);
      assert.equal(waiting.observation.repository.targetId, scenario.targetId);
      assert.equal(waiting.observation.repository.headCommit, headCommit);
      assert.equal(waiting.observation.repository.atlas, null);
      assert.deepEqual(waiting.diagnostics.map(({ code, retryable }) => ({ code, retryable })), [{
        code: "lifecycle.atlas.invalid",
        retryable: true,
      }]);

      const noShip = request({
        target: scenario.target,
        operation: "delivery.no-ship",
        deliveryId,
        input: { semanticMarkdown: "# No ship\n\nClose without integration.\n" },
      });
      const completed = await foundationMutationResultV7({
        request: noShip,
        store: created.store,
        status: "completed",
        observedAt: NOW,
        afterSequence: 0,
        repositoryObservation: "identity-current",
      });
      assert.equal(completed.status, "completed");
      assert.equal(completed.observation.repository.headCommit, headCommit);
      assert.equal(completed.observation.repository.atlas, null);
    } finally {
      created.store.close();
    }
  });
});

test("fresh preparation remains independently parallel and delegates one exact preflight basis", async () => {
  await withScenario(async (scenario) => {
    const epoch = await loadRepositoryEpoch(scenario.target);
    const basis = Object.freeze({ epoch }) as unknown as FoundationPreparationBasisV7;
    let preflights = 0;
    let maximumConcurrent = 0;
    let active = 0;
    let releaseBoth!: () => void;
    const bothEntered = new Promise<void>((resolve) => { releaseBoth = resolve; });
    const operated: string[] = [];
    const preparation: FoundationRuntimeMutationV7Preparation = Object.freeze({
      preflight: async (input) => {
        assert.equal(input.target, scenario.target);
        assert.equal(input.semanticMarkdown, "Inspect this target.");
        preflights += 1;
        active += 1;
        maximumConcurrent = Math.max(maximumConcurrent, active);
        if (preflights === 2) releaseBoth();
        await bothEntered;
        active -= 1;
        return basis;
      },
      operate: async (input, options) => {
        assert.equal(input.basis, basis);
        assert.equal(input.agentId, "codex-agent-provider-v6");
        assert.equal(input.store.identity.targetId, scenario.targetId);
        assert.equal(options?.agentOperation?.now?.(), NOW);
        assert.equal(options?.boundaryFinalization.checkOperation?.now?.(), NOW);
        operated.push(input.store.identity.processId);
        throw sentinel("prepare");
      },
      recover: async () => { throw sentinel("unexpected-prepare-recovery"); },
    });
    let deliverySequence = 0;
    const mutation = createFoundationRuntimeMutationExecutorV7({
      preparation,
      now: () => NOW,
      randomId: () => `parallel-${++deliverySequence}`,
      createActivityId: (operation) => `activity-${operation.slice("delivery.".length)}-${deliverySequence}`,
    });
    const prepare = request({
      target: scenario.target,
      operation: "delivery.prepare",
      input: { semanticMarkdown: "Inspect this target." },
    });
    const results = await Promise.allSettled([
      mutation.execute({ request: prepare, context: {}, configuration: scenario.configuration }),
      mutation.execute({ request: prepare, context: {}, configuration: scenario.configuration }),
    ]);
    assert.equal(maximumConcurrent, 2, "fresh reconnaissance was serialized by a target-global lock");
    assert.deepEqual(operated.sort(), ["delivery-parallel-1", "delivery-parallel-2"]);
    for (const result of results) {
      assert.equal(result.status, "rejected");
      assert.match(String(result.status === "rejected" ? result.reason : ""), /sentinel:prepare/u);
    }
  });
});

test("the cross-Delivery lease permits preparations and refuses another admitted active Delivery", async () => {
  const targetId = "runtime-lease-target";
  const selectedDeliveryId = "delivery-selected-for-admission";
  const otherDeliveryId = "delivery-other-preparation";
  const identity = (deliveryId: string) => Object.freeze({
    schema: "lifecycle.control-record-store.v1" as const,
    storeId: `store-${deliveryId}`,
    targetId,
    processKind: "delivery" as const,
    processId: deliveryId,
    createdAt: NOW,
  });
  let otherActiveBoundary: Readonly<Record<string, unknown>> | null = null;
  let closes = 0;
  const owners = Object.freeze({
    async listDeliveryStores() {
      return Object.freeze({
        deliveries: Object.freeze([
          Object.freeze({ identity: identity(selectedDeliveryId), disposition: "active" as const }),
          Object.freeze({ identity: identity(otherDeliveryId), disposition: "active" as const }),
          Object.freeze({ identity: identity("delivery-archived"), disposition: "archived" as const }),
        ]),
        nextAfterDeliveryId: null,
        inventoryDigest: `sha256:${"1".repeat(64)}` as const,
      });
    },
    async openDeliveryStoreReadOnly() {
      return Object.freeze({
        identity: identity(otherDeliveryId),
        disposition: "active" as const,
        archiveManifestDigest: null,
        store: Object.freeze({
          state: () => Object.freeze({
            subjects: Object.freeze({ activeBoundary: otherActiveBoundary }),
          }),
          close: () => { closes += 1; },
        }),
      });
    },
  }) as unknown as NonNullable<
    Parameters<typeof assertExclusiveActiveDeliveryLeaseV7>[1]
  >;

  await assertExclusiveActiveDeliveryLeaseV7({
    machineHome: "/runtime/machine",
    targetId,
    deliveryId: selectedDeliveryId,
  }, owners);
  assert.equal(closes, 1, "another preparation was treated as an active branch lease");

  otherActiveBoundary = Object.freeze({
    id: "work-boundary-other",
    revision: 1,
    digest: `sha256:${"2".repeat(64)}`,
  });
  await assert.rejects(
    assertExclusiveActiveDeliveryLeaseV7({
      machineHome: "/runtime/machine",
      targetId,
      deliveryId: selectedDeliveryId,
    }, owners),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.runtime-mutation-v7.active-delivery-lease",
  );
  assert.equal(closes, 2, "conflicting Store was not closed after lease refusal");
});

test("a completed pre-intent refusal is returned as refusal rather than successful preparation", async () => {
  await withScenario(async (scenario) => {
    const epoch = await loadRepositoryEpoch(scenario.target);
    const basis = Object.freeze({ epoch }) as unknown as FoundationPreparationBasisV7;
    const activityId = "activity-prepare-pre-intent-refused";
    const preparation: FoundationRuntimeMutationV7Preparation = Object.freeze({
      preflight: async () => basis,
      operate: async (input) => {
        openAgentActivity({
          store: input.store,
          activityId,
          operation: "delivery.prepare",
          semanticMarkdown: "Inspect the exact repository basis.",
          submittedAt: NOW,
          startedAt: NOW,
          founderId: epoch.contract.authority.principalId,
          runtimeId: RUNTIME_ID,
        });
        input.store.append(compileAgentPreIntentRefusalAppend({
          store: input.store,
          activityId,
          refusedAt: NOW,
          runtimeId: RUNTIME_ID,
          diagnosticCode: "lifecycle.repository.epoch-moved",
          refusalFactsDigest: `sha256:${"8".repeat(64)}`,
        }));
        input.store.append(compileDeliveryActivityCompletionAppend({
          store: input.store,
          activityId,
          outcome: "abandoned",
          completedAt: NOW,
          runtimeId: RUNTIME_ID,
        }));
        throw new FoundationError(
          "lifecycle.repository.epoch-moved",
          "Repository moved at the exact pre-intent boundary",
          { retryable: true },
        );
      },
      recover: async () => { throw sentinel("unexpected-preparation-recovery"); },
    });
    const mutation = createFoundationRuntimeMutationExecutorV7({
      preparation,
      now: () => NOW,
      randomId: () => "pre-intent-refused",
      createActivityId: () => activityId,
    });
    const result = await mutation.execute({
      request: request({
        target: scenario.target,
        operation: "delivery.prepare",
        input: { semanticMarkdown: "Inspect the exact repository basis." },
      }),
      context: {},
      configuration: scenario.configuration,
    });

    assert.equal(result.status, "refused");
    assert.equal(result.diagnostics[0]?.code, "lifecycle.repository.epoch-moved");
    assert.equal(result.observation.delivery?.activities[0]?.stage, "completed");
    const reopened = await openDeliveryControlRecordStore({
      machineHome: scenario.machineHome,
      targetId: scenario.targetId,
      deliveryId: "delivery-pre-intent-refused",
    });
    try {
      const events = reopened.store.listEvents();
      const completion = events.find(({ eventKind }) => eventKind === "activity-completed");
      assert.equal(completion?.payload.outcome, "abandoned");
      assert.equal(events.some(({ eventKind }) =>
        eventKind === "agent-attempt-prepared" || eventKind === "provider-effect-intended"), false);
    } finally {
      reopened.store.close();
    }
  });
});

test("the public compositor refuses active Agent work before owner dispatch without an admitted branch lease", async () => {
  await withScenario(async (scenario) => {
    const deliveryId = "delivery-agent-routing";
    const created = await createStore(scenario, deliveryId);
    created.store.close();
    const observed: string[] = [];
    const candidate: FoundationRuntimeMutationV7Candidate = Object.freeze({
      operate: async (input, options) => {
        observed.push(input.operation);
        assert.equal(input.target, scenario.target);
        assert.equal(input.store.identity.processId, deliveryId);
        assert.equal(input.opening.semanticMarkdown, `Semantics for ${input.operation}.`);
        assert.equal(options?.agentOperation?.now?.(), NOW);
        assert.equal(options?.candidateFinalization?.now?.(), NOW);
        assert.equal(options?.boundaryFinalization?.checkOperation?.now?.(), NOW);
        throw sentinel(input.operation);
      },
      recover: async () => { throw sentinel("unexpected-candidate-recovery"); },
    });
    const evaluation: FoundationRuntimeMutationV7Evaluation = Object.freeze({
      evaluate: async (input, options) => {
        observed.push("delivery.evaluate");
        assert.equal(input.target, scenario.target);
        assert.equal(input.semanticMarkdown, "Semantics for delivery.evaluate.");
        assert.equal(options?.agentOperation?.now?.(), NOW);
        assert.equal(options?.preparation?.checkOperation?.now?.(), NOW);
        assert.equal(options?.finalization?.now?.(), NOW);
        throw sentinel("delivery.evaluate");
      },
      recover: async () => { throw sentinel("unexpected-evaluation-recovery"); },
    });
    let activitySequence = 0;
    const mutation = createFoundationRuntimeMutationExecutorV7({
      candidate,
      evaluation,
      now: () => NOW,
      createActivityId: (operation) =>
        `activity-${operation.slice("delivery.".length)}-${++activitySequence}`,
    });
    for (const operation of [
      "delivery.continue",
      "delivery.evaluate",
      "delivery.revise",
      "delivery.reaffirm",
    ] as const) {
      const selected = request({
        target: scenario.target,
        deliveryId,
        operation,
        input: { semanticMarkdown: `Semantics for ${operation}.` },
      });
      await assert.rejects(
        mutation.execute({ request: selected, context: {}, configuration: scenario.configuration }),
        /Delivery has no exact active Work Boundary coordinate/u,
      );
    }
    assert.deepEqual(observed, []);
    assert.equal(activitySequence, 0);
  });
});

test("a stale semantic generation refuses before allocating or opening an Activity", async () => {
  await withScenario(async (scenario) => {
    const deliveryId = "delivery-stale-semantic-generation";
    const created = await createStore(scenario, deliveryId);
    const before = created.store.state();
    created.store.close();
    let activityIds = 0;
    let candidateCalls = 0;
    const mutation = createFoundationRuntimeMutationExecutorV7({
      candidate: Object.freeze({
        operate: async () => {
          candidateCalls += 1;
          throw sentinel("unexpected-candidate");
        },
        recover: async () => { throw sentinel("unexpected-candidate-recovery"); },
      }),
      now: () => NOW,
      createActivityId: () => {
        activityIds += 1;
        return "activity-must-not-be-created";
      },
    });
    const selected = request({
      target: scenario.target,
      deliveryId,
      operation: "delivery.continue",
      input: {
        semanticMarkdown: "Continue from the reviewed Delivery view.",
        expectedGeneration: `sha256:${"f".repeat(64)}`,
      },
    });
    const result = await mutation.execute({
      request: selected,
      context: {},
      configuration: scenario.configuration,
    });
    assert.equal(result.status, "refused");
    assert.equal(result.diagnostics[0]?.code, "lifecycle.runtime-mutation-v7.generation-mismatch");
    assert.equal(activityIds, 0);
    assert.equal(candidateCalls, 0);

    const reopened = await openDeliveryControlRecordStore({
      machineHome: scenario.machineHome,
      targetId: scenario.targetId,
      deliveryId,
    });
    try {
      const after = reopened.store.state();
      assert.equal(after.journal.eventCount, before.journal.eventCount);
      assert.equal(after.journal.headDigest, before.journal.headDigest);
      assert.deepEqual(after.activities, before.activities);
    } finally {
      reopened.store.close();
    }
  });
});

test("the public compositor refuses admission before authority dispatch without an exact proposal coordinate", async () => {
  await withScenario(async (scenario) => {
    const deliveryId = "delivery-admission-routing";
    const created = await createStore(scenario, deliveryId);
    created.store.close();
    let calls = 0;
    const admission: FoundationRuntimeMutationV7Admission = Object.freeze({
      admit: async (input, options) => {
        calls += 1;
        assert.equal(input.target, scenario.target);
        assert.equal(input.store.identity.processId, deliveryId);
        assert.equal(input.authoritySecret, SECRET);
        assert.equal(options?.now?.(), NOW);
        throw sentinel("admission");
      },
      recover: async () => { throw sentinel("unexpected-admission-recovery"); },
    });
    const mutation = createFoundationRuntimeMutationExecutorV7({ admission, now: () => NOW });
    const admit = request({
      target: scenario.target,
      deliveryId,
      operation: "delivery.admit",
      input: null,
    });
    await assert.rejects(
      mutation.execute({
        request: admit,
        context: { authoritySecret: SECRET },
        configuration: scenario.configuration,
      }),
      /Delivery has no exact proposed Work Boundary coordinate/u,
    );
    assert.equal(calls, 0);
  });
});

test("recovery dispatches preparation from the reducer coordinate without a route stage parser", async () => {
  await withScenario(async (scenario) => {
    const deliveryId = "delivery-prepare-recovery-routing";
    const activityId = "activity-prepare-recovery-routing";
    const created = await createStore(scenario, deliveryId);
    openAgentActivity({
      store: created.store,
      activityId,
      operation: "delivery.prepare",
      semanticMarkdown: "Resume this exact preparation.",
      submittedAt: NOW,
      startedAt: NOW,
      founderId: "founder:runtime-compositor",
      runtimeId: RUNTIME_ID,
    });
    created.store.close();
    let calls = 0;
    const preparation: FoundationRuntimeMutationV7Preparation = Object.freeze({
      preflight: async () => { throw sentinel("unexpected-preflight"); },
      operate: async () => { throw sentinel("unexpected-prepare"); },
      recover: async (input, options) => {
        calls += 1;
        assert.equal(input.activityId, activityId);
        assert.equal(input.store.identity.processId, deliveryId);
        assert.equal(options?.agentOperation?.now?.(), NOW);
        throw sentinel("retained-preparation");
      },
    });
    const mutation = createFoundationRuntimeMutationExecutorV7({ preparation, now: () => NOW });
    const recover = request({
      target: scenario.target,
      deliveryId,
      operation: "delivery.recover",
      input: null,
    });
    const result = await mutation.execute({
      request: recover,
      context: {},
      configuration: scenario.configuration,
    });
    assert.equal(result.status, "recovery-required");
    assert.equal(calls, 1);
    assert.deepEqual(result.observation.delivery?.eligibleOperations, ["delivery.recover"]);
  });
});
