import { receiveFoundationAuthorityCredential } from "../../src/foundation/repository/authority.js";
import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createFoundationRuntimeOperationRequest,
  createFoundationRuntimeOperationResult,
  FoundationChangeFactsSchema,
  FoundationRepositoryObservationSchema,
  FoundationRuntimeObservationSchema,
  type FoundationRuntimeOperationRequest,
} from "@neutral/lifecycle-protocol";
import {
  createFoundationRuntimeFacade,
  createFoundationRuntimeFacadeForTesting,
  renderFoundationRuntimeHuman,
  type FoundationRuntimeMutationExecutor,
  type FoundationRuntimeExecutionContext,
} from "../../src/foundation/facade.js";
import type { FoundationInstalledRuntimeConfigurationV7 } from
  "../../src/foundation/installed-configuration-v7.js";
import { git } from "../../src/foundation/repository/git.js";
import type { FoundationRuntimeReadSurface } from "../../src/foundation/runtime-read.js";
import { FOUNDATION_GENERATED_PUBLICATION_DIGEST } from
  "../../src/foundation/validation/generated-schemas.js";
import { writeMinimalAtlas } from "../helpers/atlas-fixture.js";

const NOW = "2026-08-29T12:00:00.000Z";
const GENERATION = `sha256:${"a".repeat(64)}` as const;

function configuration(machineHome: string): FoundationInstalledRuntimeConfigurationV7 {
  return Object.freeze({
    machineHome,
    installationId: `installation.lifecycle.${"1".repeat(64)}`,
    codexHome: join(machineHome, "codex-exec-home"),
    model: "test-model",
    reasoning: "high",
    specificationRevision: "lifecycle.foundation.1.0.0-rc.17",
    publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
  });
}

function emptyRepository() {
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

function readResult(request: FoundationRuntimeOperationRequest) {
  const observation = FoundationRuntimeObservationSchema.parse({
    schema: "lifecycle.foundation-runtime-observation.v17",
    observedAt: NOW,
    repository: emptyRepository(),
    delivery: null,
  });
  return createFoundationRuntimeOperationResult({
    request,
    observedAt: NOW,
    status: "completed",
    targetId: null,
    deliveryId: "deliveryId" in request ? request.deliveryId : null,
    observation,
    changes: FoundationChangeFactsSchema.parse({
      repository: { changed: false, beforeCommit: null, afterCommit: null },
      candidate: { changed: false, before: null, after: null },
      control: { advanced: false, beforeHead: null, afterHead: null },
    }),
  });
}

function refusedMutationResult(request: FoundationRuntimeOperationRequest) {
  const observation = FoundationRuntimeObservationSchema.parse({
    schema: "lifecycle.foundation-runtime-observation.v17",
    observedAt: NOW,
    repository: emptyRepository(),
    delivery: null,
  });
  return createFoundationRuntimeOperationResult({
    request,
    observedAt: NOW,
    status: "refused",
    targetId: null,
    deliveryId: "deliveryId" in request ? request.deliveryId : null,
    observation,
    changes: FoundationChangeFactsSchema.parse({
      repository: { changed: false, beforeCommit: null, afterCommit: null },
      candidate: { changed: false, before: null, after: null },
      control: { advanced: false, beforeHead: null, afterHead: null },
    }),
  });
}

test("Facade routes exact read requests without private mutation mechanics", async () => {
  const machineHome = await mkdtemp(join(tmpdir(), "lifecycle-facade-read-home-"));
  const seen: FoundationRuntimeOperationRequest[] = [];
  const readSurface: FoundationRuntimeReadSurface = Object.freeze({
    async execute(request) {
      seen.push(request);
      return readResult(request);
    },
  });
  const facade = createFoundationRuntimeFacadeForTesting({
    configuration: configuration(machineHome),
    readSurface,
    now: () => NOW,
  });
  const request = createFoundationRuntimeOperationRequest({
    operation: "repository.validate",
    target: "/target",
    input: null,
  });
  const result = await facade.execute(request);
  assert.equal(result.operation, "repository.validate");
  assert.deepEqual(seen, [request]);
  assert.match(renderFoundationRuntimeHuman(result), /repository: uninitialized/u);
});

test("installed facade resolves configuration at the exact operation boundary", async () => {
  const target = await mkdtemp(join(tmpdir(), "lifecycle-facade-config-target-"));
  const machineHome = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-facade-config-home-")));
  try {
    await mkdir(join(machineHome, "codex-exec-home"), { mode: 0o700 });
    const validation = await createFoundationRuntimeFacade({
      environment: {},
      now: () => NOW,
    }).execute(createFoundationRuntimeOperationRequest({
      operation: "repository.validate",
      target,
      input: null,
    }));
    assert.equal(validation.status, "completed");
    assert.equal(validation.observation.repository.initialized, false);

    const machineOnly = createFoundationRuntimeFacade({
      environment: { LIFECYCLE_MACHINE_HOME: machineHome },
      now: () => NOW,
    });
    const status = await machineOnly.execute(createFoundationRuntimeOperationRequest({
      operation: "delivery.status",
      target,
      deliveryId: "delivery-config-boundary",
      input: null,
    }));
    assert.equal(status.status, "refused");
    assert.equal(status.observation.repository.initialized, false);

    await assert.rejects(
      machineOnly.execute(createFoundationRuntimeOperationRequest({
        operation: "delivery.prepare",
        target,
        input: { semanticMarkdown: "# Complete fresh brief\n" },
      })),
      (error: unknown) => error instanceof Error && "code" in error &&
        error.code === "lifecycle.installed-configuration-v7.environment",
    );
  } finally {
    await Promise.all([
      rm(target, { recursive: true, force: true }),
      rm(machineHome, { recursive: true, force: true }),
    ]);
  }
});

test("installed Facade initializes from machine custody without Provider configuration", async () => {
  const target = await mkdtemp(join(tmpdir(), "lifecycle-facade-init-target-"));
  const machineHome = await mkdtemp(join(tmpdir(), "lifecycle-facade-init-home-"));
  await chmod(machineHome, 0o700);
  try {
    await git(target, ["init", "-b", "main"]);
    await git(target, ["config", "user.name", "Lifecycle Test"]);
    await git(target, ["config", "user.email", "lifecycle@example.invalid"]);
    await writeMinimalAtlas(target);
    await git(target, ["add", "--", "atlas"]);
    await git(target, ["commit", "-m", "Create target"]);
    const request = createFoundationRuntimeOperationRequest({
      operation: "repository.initialize",
      target,
      input: { targetId: "target-facade-v7", implementationRoots: [] },
    });
    const result = await createFoundationRuntimeFacade({
      environment: { LIFECYCLE_MACHINE_HOME: await realpath(machineHome) },
      now: () => NOW,
    }).execute(request, {
      authorityCredential: receiveFoundationAuthorityCredential("facade-test-director-secret-at-least-thirty-two-bytes", "initialize"),
    });
    assert.equal(result.status, "completed");
    assert.equal(result.targetId, "target-facade-v7");
    assert.equal(result.deliveryId, null);
    assert.equal(result.observation.repository.initialized, false);
    assert.equal(result.changes.repository.changed, false);
    assert.equal(result.events.length, 0);
    assert.equal(result.control.length, 0);
    assert.equal(result.value, null);
  } finally {
    await Promise.all([
      rm(target, { recursive: true, force: true }),
      rm(machineHome, { recursive: true, force: true }),
    ]);
  }
});

test("Facade passes only exact mutation request, context, and installed configuration", async () => {
  const machineHome = await mkdtemp(join(tmpdir(), "lifecycle-facade-mutation-home-"));
  const selected = configuration(machineHome);
  const observed: unknown[] = [];
  let installedFactoryCalls = 0;
  const mutation: FoundationRuntimeMutationExecutor = Object.freeze({
    async execute(input) {
      observed.push(input);
      return refusedMutationResult(input.request);
    },
  });
  const request = createFoundationRuntimeOperationRequest({
    operation: "delivery.prepare",
    target: "/target",
    input: { semanticMarkdown: "# Prepare\n" },
  });
  const context = Object.freeze({});
  const result = await createFoundationRuntimeFacadeForTesting({
    configuration: selected,
    mutation,
    installedMutationFactory() {
      installedFactoryCalls += 1;
      return mutation;
    },
    now: () => NOW,
  }).execute(request, context);
  assert.equal(result.status, "refused");
  assert.deepEqual(observed, [{ request, context, configuration: selected }]);
  assert.equal(installedFactoryCalls, 0);
});

test("installed Facade delegates locking to each mutation owner", async () => {
  const machineHome = await mkdtemp(join(tmpdir(), "lifecycle-facade-installed-mutation-home-"));
  const selected = configuration(machineHome);
  const now = () => NOW;
  const trace: string[] = [];
  const requests = [
    createFoundationRuntimeOperationRequest({
      operation: "delivery.prepare",
      target: "/target",
      input: { semanticMarkdown: "# Prepare\n" },
    }),
    createFoundationRuntimeOperationRequest({
      operation: "delivery.admit",
      target: "/target",
      deliveryId: "delivery-1",
      input: null,
    }),
    createFoundationRuntimeOperationRequest({
      operation: "delivery.continue",
      target: "/target",
      deliveryId: "delivery-1",
      input: { semanticMarkdown: "Continue.\n", expectedGeneration: GENERATION },
    }),
    createFoundationRuntimeOperationRequest({
      operation: "delivery.evaluate",
      target: "/target",
      deliveryId: "delivery-1",
      input: { semanticMarkdown: "Evaluate.\n", expectedGeneration: GENERATION },
    }),
    createFoundationRuntimeOperationRequest({
      operation: "delivery.revise",
      target: "/target",
      deliveryId: "delivery-1",
      input: { semanticMarkdown: "Revise.\n", expectedGeneration: GENERATION },
    }),
    createFoundationRuntimeOperationRequest({
      operation: "delivery.reaffirm",
      target: "/target",
      deliveryId: "delivery-1",
      input: { semanticMarkdown: "Reaffirm.\n", expectedGeneration: GENERATION },
    }),
    createFoundationRuntimeOperationRequest({
      operation: "delivery.accept",
      target: "/target",
      deliveryId: "delivery-1",
      input: null,
    }),
    createFoundationRuntimeOperationRequest({
      operation: "delivery.no-ship",
      target: "/target",
      deliveryId: "delivery-1",
      input: { semanticMarkdown: "Do not ship.\n" },
    }),
    createFoundationRuntimeOperationRequest({
      operation: "delivery.recover",
      target: "/target",
      deliveryId: "delivery-1",
      input: null,
    }),
  ];
  const facade = createFoundationRuntimeFacadeForTesting({
    configuration: selected,
    now,
    installedMutationFactory(input) {
      assert.equal(input.configuration, selected);
      assert.equal(input.now, now);
      trace.push("factory");
      return Object.freeze({
        async execute(invocation) {
          trace.push(`execute:${invocation.request.operation}`);
          assert.equal(invocation.configuration, selected);
          return refusedMutationResult(invocation.request);
        },
      });
    },
  });

  for (const request of requests) {
    const result = await facade.execute(request);
    assert.equal(result.status, "refused");
  }
  assert.deepEqual(trace, requests.flatMap((request) => [
    "factory",
    `execute:${request.operation}`,
  ]));
});


test("facade rejects legacy and opaque authority custody on reads, productive work, and recovery before dispatch", async () => {
  let dispatches = 0;
  const forbiddenOwner = async (): Promise<never> => {
    dispatches += 1;
    throw new Error("authority material reached an ordinary owner");
  };
  const facade = createFoundationRuntimeFacadeForTesting({
    configuration: configuration("/unused-machine-custody"),
    readSurface: { execute: forbiddenOwner },
    mutation: { execute: forbiddenOwner },
    now: () => NOW,
  });
  const requests = [
    createFoundationRuntimeOperationRequest({ operation: "repository.validate", target: "/target", input: null }),
    createFoundationRuntimeOperationRequest({ operation: "delivery.status", target: "/target", deliveryId: "delivery-1", input: null }),
    createFoundationRuntimeOperationRequest({ operation: "delivery.prepare", target: "/target", input: { semanticMarkdown: "Prepare.\n" } }),
    ...(["delivery.continue", "delivery.evaluate", "delivery.revise", "delivery.reaffirm"] as const).map((operation) =>
      createFoundationRuntimeOperationRequest({ operation, target: "/target", deliveryId: "delivery-1", input: { semanticMarkdown: "Exact input.\n", expectedGeneration: GENERATION } })),
    createFoundationRuntimeOperationRequest({ operation: "delivery.recover", target: "/target", deliveryId: "delivery-1", input: null }),
  ];
  const secret = "facade-credential-refusal-secret-at-least-thirty-two-bytes";
  const contexts: unknown[] = [
    { authoritySecret: secret },
    { authorityCredential: receiveFoundationAuthorityCredential(secret, "initialize") },
    { authorityCredential: receiveFoundationAuthorityCredential(secret, "director-decision") },
    { authorityCredential: Object.freeze({}) },
    { authorityCredential: undefined },
    Object.defineProperty({}, "authoritySecret", { value: secret, enumerable: false }),
    Object.create({ authoritySecret: secret }),
  ];
  for (const request of requests) {
    for (const context of contexts) {
      await assert.rejects(facade.execute(request, context as FoundationRuntimeExecutionContext), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal((error as { code?: string }).code, "lifecycle.authority.context");
        assert.equal(JSON.stringify(error).includes(secret), false);
        return true;
      });
    }
  }
  const admit = createFoundationRuntimeOperationRequest({ operation: "delivery.admit", target: "/target", deliveryId: "delivery-1", input: null });
  await assert.rejects(facade.execute(admit, { authoritySecret: secret } as never), /opaque Director credential/u);
  await assert.rejects(facade.execute(admit, { authorityCredential: Object.freeze({}) } as never), /live credential/u);
  await assert.rejects(facade.execute(admit, { authorityCredential: receiveFoundationAuthorityCredential(secret, "initialize") }), /exact purpose/u);
  assert.equal(dispatches, 0);
});
