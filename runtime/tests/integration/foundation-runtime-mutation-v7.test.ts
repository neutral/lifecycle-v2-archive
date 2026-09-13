import { assertFoundationAuthorityCredential, receiveFoundationAuthorityCredential } from "../../src/foundation/repository/authority.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createFoundationRuntimeOperationRequest,
  parseFoundationRuntimeOperationResultForRequest,
  type FoundationRuntimeOperationRequestInput,
} from "@neutral/lifecycle-protocol";
import {
  createDeliveryControlRecordStore,
  listDeliveryControlRecordStores,
  openDeliveryControlRecordStore,
} from "../../src/foundation/control/delivery-custody.js";
import { compileDeliveryGeneration } from "../../src/foundation/control/delivery-view.js";
import { withDeliveryOperationLock } from "../../src/foundation/control/delivery-operation-lock.js";
import { withTargetOperationLock } from "../../src/foundation/repository/operation-lock.js";
import {
  compileAgentPreIntentRefusalAppend,
  compileDeliveryActivityCompletionAppend,
} from "../../src/foundation/control/activity.js";
import { openAgentActivity } from "../../src/foundation/control/director-brief.js";
import { FoundationError } from "../../src/foundation/error.js";
import { LifecycleError } from "../../src/errors.js";
import { foundationExecutionBackendInterruptionFacts } from "../../src/foundation/execution/backend-diagnostic.js";
import type { FoundationInstalledRuntimeConfigurationV7 } from "../../src/foundation/installed-configuration-v7.js";
import { createFoundationRuntimeFacadeForTesting, type FoundationRuntimeMutationRequest } from "../../src/foundation/facade.js";
import { git } from "../../src/foundation/repository/git.js";
import { initializeRepository } from "../../src/foundation/repository/initialize.js";
import { loadRepositoryEpoch } from "../../src/foundation/repository/snapshot.js";
import {
  createFoundationRuntimeMutationExecutorV7,
  type FoundationRuntimeMutationV7Admission,
  type FoundationRuntimeMutationV7Candidate,
  type FoundationRuntimeMutationV7Evaluation,
  type FoundationRuntimeMutationV7Preparation,
} from "../../src/foundation/runtime-mutation-v7.js";
import { preflightFoundationPreparationBasisV7, type FoundationPreparationBasisV7 } from "../../src/foundation/process/preparation-context-v7.js";
import { compileKnowledgeProjection } from "../../src/foundation/projection/compiler.js";
import { parseProjectionRequest } from "../../src/foundation/projection/request.js";
import { completeMandatoryProjectionSizeErrorV1, foundationMandatoryProjectionRefusalV1, retainFoundationMandatoryProjectionRefusalV1 } from "../../src/foundation/projection/mandatory-refusal.js";
import { foundationMutationResultV7 } from "../../src/foundation/process/mutation-result-v7.js";
import {
  FOUNDATION_GENERATED_PUBLICATION_DIGEST,
  FOUNDATION_GENERATED_SPECIFICATION_REVISION,
} from "../../src/foundation/validation/generated-schemas.js";
import { writeMinimalAtlas } from "../helpers/atlas-fixture.js";
import { selfDigest, sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { createConnectedDeliveryFixture, writeConnectedFile } from "../support/connected-delivery-fixture.js";
import { prepareAndAdmit } from "../support/connected-delivery-assertions.js";
import { readConnectedCandidateFile } from "../support/connected-candidate-inspection.js";

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
      directorPrincipal: "director:runtime-compositor",
      home: machineHome,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "initialize"),
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

test("integration checks the exact Delivery generation before its generation-only owner dispatch", async () => {
  await withScenario(async (scenario) => {
    const deliveryId = "delivery-integration-dispatch";
    const created = await createStore(scenario, deliveryId);
    const epoch = await loadRepositoryEpoch(scenario.target);
    const before = created.store.state();
    const expectedGeneration = compileDeliveryGeneration({
      store: created.store,
      physical: { disposition: "active", archiveManifestDigest: null },
      repository: { headCommit: epoch.epoch.commit, headTree: epoch.epoch.tree, repositoryContractDigest: epoch.contract.digest },
    }).digest;
    created.store.close();
    let activityIds = 0;
    let integrationCalls = 0;
    const mutation = createFoundationRuntimeMutationExecutorV7({
      now: () => NOW,
      createActivityId: (operation) => {
        assert.equal(operation, "delivery.integrate");
        activityIds += 1;
        return "activity-integrate-dispatch";
      },
      integration: {
        operate: async (input, options) => {
          integrationCalls += 1;
          assert.equal(input.target, scenario.target);
          assert.equal(input.machineHome, scenario.machineHome);
          assert.equal(input.store.identity.processId, deliveryId);
          assert.equal(input.activityId, "activity-integrate-dispatch");
          assert.deepEqual(Object.keys(input).sort(), ["activityId", "machineHome", "runtimeId", "store", "target"]);
          assert.equal(options?.now?.(), NOW);
          // The operation owner owns eligibility; this routing fixture stops
          // before it can synthesize any valid integration state.
          throw sentinel("exact-integration-owner");
        },
        recover: async () => { throw sentinel("unexpected-integration-recovery"); },
      },
    });
    const invoke = (generation: typeof expectedGeneration) => mutation.execute({
      request: request({ target: scenario.target, deliveryId, operation: "delivery.integrate", input: { expectedGeneration: generation } }),
      context: {}, configuration: scenario.configuration,
    });
    const refused = await invoke(`sha256:${"f".repeat(64)}`);
    assert.equal(refused.status, "refused");
    assert.equal(refused.diagnostics[0]?.code, "lifecycle.read-model.generation-stale");
    assert.equal(activityIds, 0);
    assert.equal(integrationCalls, 0);
    await assert.rejects(invoke(expectedGeneration), /sentinel:exact-integration-owner/u);
    assert.equal(activityIds, 1);
    assert.equal(integrationCalls, 1);
    const reopened = await openDeliveryControlRecordStore({ machineHome: scenario.machineHome, targetId: scenario.targetId, deliveryId });
    try {
      assert.deepEqual(reopened.store.state().journal, before.journal);
    } finally {
      reopened.store.close();
    }
  });
});

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

test("mutation recovery diagnostics disclose only closed Backend stage and failure class", async () => {
  await withScenario(async (scenario) => {
    const created = await createStore(scenario, "delivery-public-backend-diagnostic");
    try {
      const prepare = request({
        target: scenario.target, operation: "delivery.prepare",
        input: { semanticMarkdown: "Inspect this target." },
      });
      const selected = foundationExecutionBackendInterruptionFacts("terminal-retrieval", new FoundationError(
        "lifecycle.execution.docker-cli-driver.command-timeout", "fixture-secret-provider-text",
      ));
      const cases = [
        { code: "lifecycle.execution.operation-host.backend-interrupted",
          facts: { ...selected, privatePath: "/private/fixture-secret-path", stderr: "fixture-secret-provider-text" },
          expected: selected },
        { code: "lifecycle.execution.operation-host.backend-interrupted",
          facts: { backendOperation: "fixture-secret-stage", backendFailureClass: "command-timeout" },
          expected: {} },
        { code: "lifecycle.execution.operation-host.backend-interrupted",
          facts: { backendOperation: "observe", backendFailureClass: "fixture-secret-code" },
          expected: {} },
        { code: "lifecycle.execution.operation-host.persistence", facts: selected, expected: {} },
      ];
      const before = created.store.state().journal;
      for (const row of cases) {
        const result = await foundationMutationResultV7({
          request: prepare, store: created.store, status: "recovery-required",
          error: new FoundationError(row.code, "fixture-secret-message", { observedFacts: row.facts }),
          observedAt: NOW, afterSequence: 0,
        });
        assert.equal(result.status, "recovery-required");
        assert.equal(result.diagnostics[0]?.code, row.code);
        assert.equal(result.diagnostics[0]?.retryable, true);
        assert.deepEqual(result.diagnostics[0]?.facts, row.expected);
        assert.equal(JSON.stringify(result).includes("fixture-secret"), false);
        assert.deepEqual(created.store.state().journal, before);
      }
    } finally {
      created.store.close();
    }
  });
});

test("mutation results retain bounded Projection codes and validation identity without changing the selected outcome", async () => {
  await withScenario(async (scenario) => {
    const created = await createStore(scenario, "delivery-public-projection-diagnostic");
    try {
      const prepare = request({ target: scenario.target, operation: "delivery.prepare",
        input: { semanticMarkdown: "Inspect this target." } });
      const validationDigest = sha256Bytes("exact completed invalid reviewer Projection validation");
      const diagnosticCodes = ["lifecycle.projection.discipline-invalid"];
      const before = created.store.state();
      for (const status of ["refused", "recovery-required"] as const) {
        const result = await foundationMutationResultV7({
          request: prepare, store: created.store, status, observedAt: NOW, afterSequence: 0,
          error: new FoundationError("lifecycle.operation-context-v7.projection", "fixture-private-message", {
            observedFacts: { validationDigest, diagnostics: diagnosticCodes, path: "/private/fixture-private-path" },
          }),
        });
        assert.equal(result.status, status);
        assert.equal(result.diagnostics[0]?.code, "lifecycle.operation-context-v7.projection");
        assert.equal(result.diagnostics[0]?.retryable, status === "recovery-required");
        assert.deepEqual(result.diagnostics[0]?.facts, { validationDigest, diagnosticCodes });
        assert.equal(JSON.stringify(result).includes("fixture-private"), false);
        assert.deepEqual(created.store.state(), before);
      }
    } finally { created.store.close(); }
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

test("Facade returns a pre-Store context refusal without losing its diagnostic or inventing a Delivery", async () => {
  await withScenario(async (scenario) => {
    let expectedLimit = 0;
    let dispatched = false;
    const mutation = createFoundationRuntimeMutationExecutorV7({
      preparation: {
        preflight: async (input) => await preflightFoundationPreparationBasisV7(input, {
          compileKnowledgeProjection: async (input) => {
            const request = parseProjectionRequest(input.request);
            expectedLimit = request.profile.maximumMandatoryItems;
            const failure = completeMandatoryProjectionSizeErrorV1(request, {
              mandatoryItems: expectedLimit + 16,
              mandatoryBytes: 0,
              sourceBytes: 0,
              maximumMandatoryItems: expectedLimit,
              maximumMandatoryBytes: request.profile.maximumMandatoryBytes,
              maximumItemBytes: request.profile.maximumItemBytes,
              maximumSourceBytes: request.profile.maximumSourceBytes,
              oversized: [],
            });
            const compiled = Object.freeze({ ...await compileKnowledgeProjection(input), projection: null });
            const refusal = foundationMandatoryProjectionRefusalV1(failure);
            assert.ok(refusal);
            retainFoundationMandatoryProjectionRefusalV1(compiled, refusal);
            return compiled;
          },
        }),
        operate: async () => { dispatched = true; throw sentinel("unexpected-dispatch"); },
        recover: async () => { throw sentinel("unexpected-recovery"); },
      },
      now: () => NOW,
      randomId: () => { throw sentinel("unexpected-delivery-allocation"); },
    });
    const facade = createFoundationRuntimeFacadeForTesting({
      configuration: scenario.configuration, mutation, now: () => NOW,
    });
    const prepare = request({
      target: scenario.target, operation: "delivery.prepare",
      input: { semanticMarkdown: "Preserve this exact useful direction." },
    });
    const result = parseFoundationRuntimeOperationResultForRequest(await facade.execute(prepare), prepare);
    assert.equal(result.status, "refused");
    assert.equal(result.deliveryId, null);
    assert.equal(result.observation.delivery, null);
    assert.equal(result.targetId, scenario.targetId);
    assert.equal(result.observation.repository.valid, true);
    assert.equal(result.diagnostics[0]?.code, "lifecycle.projection.mandatory-too-large");
    assert.match(result.diagnostics[0]!.message, /before creating a Delivery or starting Agent execution/u);
    assert.ok(result.diagnostics[0]!.message.includes(`${expectedLimit + 16} mandatory items exceed the ${expectedLimit} item limit`));
    assert.deepEqual(result.diagnostics[0]?.facts, {});
    assert.equal(result.changes.control.advanced, false);
    assert.deepEqual(result.events, []);
    assert.deepEqual(result.control, []);
    assert.equal(dispatched, false);
    assert.deepEqual((await listDeliveryControlRecordStores({
      machineHome: scenario.machineHome, targetId: scenario.targetId,
    })).deliveries, []);
    assert.equal(JSON.stringify(result).includes(scenario.root), false);
  });
});

test("a pre-Store Projection compiler refusal exposes its exact validation digest and code", async () => {
  await withScenario(async (scenario) => {
    let expectedFacts: { validationDigest: string; diagnosticCodes: string[] } | null = null;
    const mutation = createFoundationRuntimeMutationExecutorV7({
      preparation: {
        preflight: async (input) => await preflightFoundationPreparationBasisV7(input, {
          compileKnowledgeProjection: async (input) => {
            const selected = parseProjectionRequest(input.request);
            assert.equal(selected.class, "orientation");
            if (selected.class !== "orientation") assert.fail("Preparation requires Orientation");
            // The compiler receives one invalid request through its normal parser;
            // its diagnostic and validation identity are not fabricated by the fixture.
            const changed = { ...selected, subject: { ...selected.subject, objective: "", objectiveDigest: sha256Bytes("") } };
            const compiled = await compileKnowledgeProjection({ ...input, request: { ...changed, digest: selfDigest(changed) } });
            assert.equal(compiled.projection, null);
            assert.equal(compiled.validation.valid, false);
            expectedFacts = { validationDigest: compiled.validation.digest,
              diagnosticCodes: compiled.validation.diagnostics.map(({ code }) => code) };
            assert.deepEqual(expectedFacts.diagnosticCodes, ["lifecycle.schema.invalid"]);
            return compiled;
          },
        }),
        operate: async () => { throw sentinel("unexpected-dispatch"); },
        recover: async () => { throw sentinel("unexpected-recovery"); },
      },
      now: () => NOW,
      randomId: () => { throw sentinel("unexpected-delivery-allocation"); },
    });
    const facade = createFoundationRuntimeFacadeForTesting({ configuration: scenario.configuration, mutation, now: () => NOW });
    const prepare = request({ target: scenario.target, operation: "delivery.prepare",
      input: { semanticMarkdown: "Inspect this exact target." } });
    const result = parseFoundationRuntimeOperationResultForRequest(await facade.execute(prepare), prepare);
    assert(expectedFacts !== null);
    assert.equal(result.status, "refused");
    assert.equal(result.deliveryId, null);
    assert.equal(result.observation.delivery, null);
    assert.equal(result.diagnostics[0]?.code, "lifecycle.preparation-context-v7.projection");
    assert.deepEqual(result.diagnostics[0]?.facts, expectedFacts);
    assert.equal(result.changes.control.advanced, false);
    assert.deepEqual(result.events, []);
    assert.deepEqual(result.control, []);
    assert.equal(JSON.stringify(result).includes(scenario.root), false);
    assert.deepEqual((await listDeliveryControlRecordStores({ machineHome: scenario.machineHome,
      targetId: scenario.targetId })).deliveries, []);
  });
});

test("preparation does not flatten uncertain failures or a same-code failure after Store creation into a preflight refusal", async () => {
  await withScenario(async (scenario) => {
    const prepare = request({ target: scenario.target, operation: "delivery.prepare", input: { semanticMarkdown: "Inspect this target." } });
    const epoch = await loadRepositoryEpoch(scenario.target);
    for (const failure of [new Error("unexpected preflight"), new FoundationError("lifecycle.test.uncertain", "uncertain", { operationalStateChanged: true }),
      Object.assign(new FoundationError("lifecycle.test.uncertain", "Unknown repository effects"), { repositoryChanged: null }),
      Object.assign(new FoundationError("lifecycle.test.uncertain", "Unknown operational effects"), { operationalStateChanged: null })]) {
      const mutation = createFoundationRuntimeMutationExecutorV7({
        preparation: {
          preflight: async () => { throw failure; },
          operate: async () => { throw sentinel("unexpected-dispatch"); },
          recover: async () => { throw sentinel("unexpected-recovery"); },
        },
        now: () => NOW,
      });
      await assert.rejects(mutation.execute({ request: prepare, context: {}, configuration: scenario.configuration }), (error) => error === failure);
    }
    const failure = new FoundationError("lifecycle.projection.mandatory-too-large", "Private detail must not become a no-effect claim");
    const mutation = createFoundationRuntimeMutationExecutorV7({
      preparation: {
        preflight: async () => Object.freeze({ epoch }) as FoundationPreparationBasisV7,
        operate: async () => { throw failure; },
        recover: async () => { throw sentinel("unexpected-recovery"); },
      },
      now: () => NOW,
      randomId: () => "post-store-failure",
    });
    await assert.rejects(mutation.execute({ request: prepare, context: {}, configuration: scenario.configuration }), (error) => error === failure);
    assert.deepEqual((await listDeliveryControlRecordStores({
      machineHome: scenario.machineHome, targetId: scenario.targetId,
    })).deliveries.map(({ identity }) => identity.processId), ["delivery-post-store-failure"]);
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

test("mutation entry excludes only its exact Delivery and leaves the canonical publication lock independent", async () => {
  await withScenario(async (scenario) => {
    const first = await createStore(scenario, "delivery-lock-first");
    const second = await createStore(scenario, "delivery-lock-second");
    first.store.close();
    second.store.close();
    const dispatched: string[] = [];
    const mutation = createFoundationRuntimeMutationExecutorV7({
      now: () => NOW,
      terminal: {
        accept: async () => { throw sentinel("unexpected-accept"); },
        recover: async () => { throw sentinel("unexpected-recover"); },
        noShip: async (input) => {
          dispatched.push(input.store.identity.processId);
          throw sentinel("selected-no-ship");
        },
      },
    });
    const invoke = (deliveryId: string) => mutation.execute({
      request: request({
        target: scenario.target,
        deliveryId,
        operation: "delivery.no-ship",
        input: { semanticMarkdown: "Close this exact Delivery." },
      }),
      configuration: scenario.configuration,
      context: { authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision") },
    });
    await withDeliveryOperationLock({
      machineHome: scenario.machineHome,
      targetId: scenario.targetId,
      deliveryId: first.identity.processId,
    }, "test-first-holder", async () => {
      await assert.rejects(invoke(first.identity.processId), (error: unknown) =>
        error instanceof FoundationError && error.code === "operation.busy");
      await withTargetOperationLock(scenario.target, "test-publication-holder", async () => {
        await writeFile(join(scenario.target, "unrelated-dirty-work.txt"), "preserve live checkout\n");
        await assert.rejects(invoke(second.identity.processId), /sentinel:selected-no-ship/u);
      });
    });
    assert.deepEqual(dispatched, [second.identity.processId]);
    await assert.rejects(invoke(first.identity.processId), /sentinel:selected-no-ship/u);
    assert.deepEqual(dispatched, [second.identity.processId, first.identity.processId]);
  });
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
          directorId: epoch.contract.authority.principalId,
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

test("the public compositor refuses active Agent work before owner dispatch without an exact active Work Boundary", async () => {
  await withScenario(async (scenario) => {
    const deliveryId = "delivery-agent-routing";
    const created = await createStore(scenario, deliveryId);
    const epoch = await loadRepositoryEpoch(scenario.target);
    const expectedGeneration = compileDeliveryGeneration({
      store: created.store,
      physical: Object.freeze({ disposition: "active", archiveManifestDigest: null }),
      repository: Object.freeze({
        headCommit: epoch.epoch.commit,
        headTree: epoch.epoch.tree,
        repositoryContractDigest: epoch.contract.digest,
      }),
    }).digest;
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
        input: { semanticMarkdown: `Semantics for ${operation}.`, expectedGeneration },
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

test("Facade reports a typed pre-Activity context refusal and preserves the corrected productive course", async (context) => {
  const fixture = await createConnectedDeliveryFixture({ id: "facade-pre-activity-refusal" });
  try {
    await prepareAndAdmit(fixture);
    const before = fixture.store.state();
    const candidate = fixture.current("candidate");
    const dispatches = fixture.invocations.length;
    const basis = await preflightFoundationPreparationBasisV7({
      target: fixture.target, semanticMarkdown: "# Context\n\nObserve the exact current basis.\n", observedAt: fixture.now(),
    });
    const objective = "x".repeat(1_048_577);
    const oversized = { ...basis.request, subject: { ...basis.request.subject, objective, objectiveDigest: sha256Bytes(objective) } };
    const invalidRequest = { ...oversized, digest: selfDigest(oversized) };
    let ownerFailure: FoundationError | null = null;
    let selectedFailure: Error | null = null;
    let openBeforeFailure = false;
    let activitySequence = 0;
    // Parsing this bounded invalid request exercises the actual schema owner.
    // The substitute is confined to context compilation; no finalized Control
    // record or physical-effect observation is manufactured by this refusal.
    const mutation = createFoundationRuntimeMutationExecutorV7({
      now: fixture.now,
      createActivityId: () => `context-refusal-${++activitySequence}`,
      candidate: {
        operate: async (input) => {
          if (selectedFailure !== null) throw selectedFailure;
          if (openBeforeFailure) {
            openAgentActivity({ store: input.store, activityId: input.activityId, operation: input.operation,
              semanticMarkdown: input.opening.semanticMarkdown, submittedAt: input.opening.submittedAt,
              startedAt: input.opening.startedAt, directorId: input.opening.directorId, runtimeId: input.runtimeId });
          }
          try { parseProjectionRequest(invalidRequest); }
          catch (error) {
            assert(error instanceof FoundationError);
            assert.equal(error.code, "lifecycle.schema.invalid");
            assert(error.diagnostics.some(({ facts }) => facts.keyword === "maxLength"));
            ownerFailure = error;
            throw error;
          }
          throw new Error("Oversized Orientation unexpectedly passed its owning schema");
        },
        recover: async () => { throw new Error("This test does not operate recovery"); },
      },
    });
    const { execution: _execution, ...processConfiguration } = fixture.configuration;
    const facade = createFoundationRuntimeFacadeForTesting({
      configuration: { ...processConfiguration, codexHome: join(fixture.workspace, "unused-provider-home") },
      mutation, now: fixture.now,
    });
    const selectedRequest = async () => {
      const epoch = await loadRepositoryEpoch(fixture.target);
      const expectedGeneration = compileDeliveryGeneration({ store: fixture.store,
        physical: { disposition: "active", archiveManifestDigest: null },
        repository: { headCommit: epoch.epoch.commit, headTree: epoch.epoch.tree, repositoryContractDigest: epoch.contract.digest },
      }).digest;
      return request({ target: fixture.target, deliveryId: fixture.deliveryId, operation: "delivery.continue",
        input: { semanticMarkdown: "# Continue\n\nPreserve the admitted source change.\n", expectedGeneration } });
    };
    const selected = await selectedRequest();
    context.diagnostic(JSON.stringify({ starting: before.subjects, sequence: ["context schema refusal", "reopen", "corrected continue"],
      fault: "Orientation objective has 1,048,577 ASCII bytes against the 1,048,576-byte owner limit",
      intendedOutcome: "Refusal retains the same Journal and Candidate; corrected input advances the exact retained Product without redispatch" }));
    const refused = parseFoundationRuntimeOperationResultForRequest(await facade.execute(selected), selected);
    assert.equal(refused.status, "refused");
    assert.equal(refused.diagnostics[0]?.code, "lifecycle.schema.invalid");
    assert.deepEqual(refused.diagnostics[0]?.facts, {});
    assert.equal(refused.targetId, fixture.contract.targetId);
    assert.equal(refused.deliveryId, fixture.deliveryId);
    assert.deepEqual(refused.observation.delivery?.subjects, {
      ...before.subjects,
      activeBoundary: before.subjects.activeBoundary === null ? null : {
        kind: "work-boundary", ...before.subjects.activeBoundary,
      },
      candidate: before.subjects.candidate === null ? null : {
        kind: "candidate-revision", ...before.subjects.candidate,
      },
    });
    assert.equal(refused.changes.repository.changed, false);
    assert.equal(refused.changes.candidate.changed, false);
    assert.equal(refused.changes.control.advanced, false);
    assert.deepEqual(refused.events, []);
    assert.deepEqual(refused.control, []);
    assert.equal(fixture.invocations.length, dispatches);
    assert.equal(JSON.stringify(refused).includes(objective), false);
    assert.equal(JSON.stringify(refused).includes(fixture.machineHome), false);
    await fixture.reopenStore();
    assert.deepEqual(fixture.store.state(), before);

    for (const failure of [
      new Error("Unexpected context failure"),
      new LifecycleError({ code: "foundation.value.text", message: "Private reason", repositoryChanged: true }),
      new LifecycleError({ code: "runtime.authorization-result-unavailable", message: "Unknown effects", repositoryChanged: null, operationalStateChanged: null,
        observedFacts: { invocationId: "a1111111-1111-4111-8111-111111111111", authorizationSubmission: "may-have-started" } }),
      new FoundationError("lifecycle.schema.invalid", "Private reason", { operationalStateChanged: true }),
      new LifecycleError({ code: "foundation.value.text", message: "Private reason", recoveryActions: [{ action: "observe", detail: "private obligation" }] }),
    ]) {
      selectedFailure = failure;
      await assert.rejects(facade.execute(selected), (error) => error === failure);
      assert.deepEqual(fixture.store.state(), before);
    }
    selectedFailure = new LifecycleError({ code: "foundation.value.text", message: "private-marker", observedFacts: { path: fixture.machineHome } });
    const typed = await facade.execute(selected);
    assert.equal(typed.status, "refused");
    assert.equal(typed.diagnostics[0]?.code, "foundation.value.text");
    assert.equal(JSON.stringify(typed).includes("private-marker"), false);
    assert.deepEqual(typed.diagnostics[0]?.facts, {});
    selectedFailure = null;

    // A fresh explicit correction uses the normal context, Agent, semantic
    // finalization and Candidate retention owners with bounded backend output.
    const product = "export const value = 'continued-after-context-refusal';\n";
    const continued = await fixture.continue({
      direction: "# Continue\n\nComplete the admitted source change with the bounded context.\n",
      edit: (repository) => writeConnectedFile(repository, "src/demo.ts", product),
    });
    assert.equal(continued.outcome, "completed");
    assert.equal(fixture.invocations.length, dispatches + 1);
    const successor = fixture.current("candidate");
    assert.equal(successor.revision, candidate.revision + 1);
    assert.deepEqual(successor.relationships.find(({ relation }) => relation === "revises")?.target,
      { kind: "candidate-revision", id: candidate.recordId, revision: candidate.revision, digest: candidate.digest });
    assert.deepEqual(fixture.store.state().subjects.activeBoundary, before.subjects.activeBoundary);
    assert.equal(await readConnectedCandidateFile(fixture, "src/demo.ts"), product);
    assert.equal((await git(fixture.target, ["show", "HEAD:src/demo.ts"])).stdout, "export const value = 'base';\n");

    openBeforeFailure = true;
    const openedRequest = await selectedRequest();
    const unresolved = await facade.execute(openedRequest);
    assert(ownerFailure !== null);
    assert.equal(unresolved.status, "recovery-required", "The same schema error after an Activity opening must retain its recovery course");
    assert.equal(unresolved.changes.control.advanced, true);
    assert.notEqual(unresolved.observation.delivery?.recovery, null);
  } finally { await fixture.dispose(); }
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
    assert.equal(result.diagnostics[0]?.code, "lifecycle.read-model.generation-stale");
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
        assertFoundationAuthorityCredential(input.authorityCredential, "director-decision");
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
        context: { authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision") },
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
      directorId: "director:runtime-compositor",
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
