import { receiveFoundationAuthorityCredential } from "../../src/foundation/repository/authority.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createFoundationRuntimeOperationRequest,
  type FoundationRuntimeInspectRequest,
} from "@neutral/lifecycle-protocol";
import { createDeliveryControlRecordStore, openDeliveryControlRecordStore } from "../../src/foundation/control/delivery-custody.js";
import { compileDeliveryGeneration } from "../../src/foundation/control/delivery-view.js";
import {
  compileAgentPreIntentRefusalAppend,
  compileDeliveryActivityCompletionAppend,
} from "../../src/foundation/control/activity.js";
import { openAgentActivity } from "../../src/foundation/control/director-brief.js";
import {
  createFoundationInvocationPrivateAuthorizationRuntimeV1,
  digestFoundationInvocationPrivateAuthorizationSemanticInputV1,
  type FoundationInvocationPrivateAuthorizationExpectationV1,
} from "../../src/foundation/invocation-private-authorization-v1.js";
import {
  FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7,
} from "../../src/foundation/installed-configuration-v7.js";
import { git } from "../../src/foundation/repository/git.js";
import { initializeRepository } from "../../src/foundation/repository/initialize.js";
import { loadRepositoryIdentityEpoch } from "../../src/foundation/repository/snapshot.js";
import { createFoundationRuntimeReadSurface } from "../../src/foundation/runtime-read.js";
import {
  FOUNDATION_GENERATED_PUBLICATION_DIGEST,
} from "../../src/foundation/validation/generated-schemas.js";
import { writeMinimalAtlas } from "../helpers/atlas-fixture.js";

const NOW = "2026-09-04T14:00:00.000Z";
const SECRET = "invocation-private-director-secret-with-sufficient-entropy";
const NO_SHIP_MARKDOWN = "# Director No-Ship Decision\n\nClose this exact Delivery without integration.\n";

type Scenario = Readonly<{
  root: string;
  target: string;
  machineHome: string;
  targetId: string;
  deliveryId: string;
  environment: NodeJS.ProcessEnv;
  expectation: FoundationInvocationPrivateAuthorizationExpectationV1;
  initialEventCount: number;
}>;

async function scenario(label: string): Promise<Scenario> {
  const root = await realpath(await mkdtemp(join(tmpdir(), `lifecycle-private-authority-${label}-`)));
  const target = join(root, "target");
  const machineHome = join(root, "machine");
  await Promise.all([
    mkdir(target, { mode: 0o700 }),
    mkdir(join(machineHome, "codex-exec-home"), { mode: 0o700, recursive: true }),
  ]);
  await git(target, ["init", "-b", "main"]);
  await git(target, ["config", "user.name", "Lifecycle Test"]);
  await git(target, ["config", "user.email", "lifecycle@example.invalid"]);
  await writeMinimalAtlas(target);
  await git(target, ["add", "--", "atlas"]);
  await git(target, ["commit", "-m", "Initialize target"]);
  const contract = await initializeRepository(target, {
    targetId: `invocation-private-${label}-target`,
    directorPrincipal: `director:invocation-private-${label}`,
    home: machineHome,
    authorityCredential: receiveFoundationAuthorityCredential(SECRET, "initialize"),
    publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
    implementationRoots: [],
    stage: true,
  });
  await git(target, ["add", "--", "."]);
  await git(target, ["commit", "-m", "Initialize Lifecycle target"]);
  const deliveryId = `delivery-invocation-private-${label}`;
  const created = await createDeliveryControlRecordStore({
    machineHome,
    targetId: contract.targetId,
    deliveryId,
    createdAt: NOW,
    runtimeActorId: "lifecycle-runtime-foundation-v7",
  });
  const preparationActivityId = `activity-prepare-${label}`;
  openAgentActivity({
    store: created.store,
    activityId: preparationActivityId,
    operation: "delivery.prepare",
    semanticMarkdown: "Inspect the exact repository basis.",
    submittedAt: NOW,
    startedAt: NOW,
    directorId: contract.authority.principalId,
    runtimeId: "lifecycle-runtime-foundation-v7",
  });
  created.store.append(compileAgentPreIntentRefusalAppend({
    store: created.store,
    activityId: preparationActivityId,
    refusedAt: NOW,
    runtimeId: "lifecycle-runtime-foundation-v7",
    diagnosticCode: "lifecycle.provider.unavailable",
    refusalFactsDigest: `sha256:${"7".repeat(64)}`,
  }));
  created.store.append(compileDeliveryActivityCompletionAppend({
    store: created.store,
    activityId: preparationActivityId,
    outcome: "abandoned",
    completedAt: NOW,
    runtimeId: "lifecycle-runtime-foundation-v7",
  }));
  const epoch = await loadRepositoryIdentityEpoch(target);
  const generation = compileDeliveryGeneration({
    store: created.store,
    physical: Object.freeze({ disposition: "active", archiveManifestDigest: null }),
    repository: Object.freeze({
      headCommit: epoch.epoch.commit,
      headTree: epoch.epoch.tree,
      repositoryContractDigest: epoch.contract.digest,
    }),
  });
  const initialEventCount = created.store.state().journal.eventCount;
  created.store.close();
  const reviewResult = await createFoundationRuntimeReadSurface({
    machineHome,
    now: () => NOW,
  }).execute(createFoundationRuntimeOperationRequest({
    target,
    deliveryId,
    operation: "delivery.inspect",
    input: {
      kind: "authorization-review",
      expectedGeneration: generation.digest,
      operation: "delivery.no-ship",
      input: Object.freeze({ semanticMarkdown: NO_SHIP_MARKDOWN }),
    },
  }) as FoundationRuntimeInspectRequest);
  if (
    reviewResult.value === null || !("kind" in reviewResult.value) ||
    reviewResult.value.kind !== "authorization-review"
  ) throw new TypeError("Expected one exact Director authorization review");
  const review = reviewResult.value.review;
  const expectation: FoundationInvocationPrivateAuthorizationExpectationV1 = Object.freeze({
    schema: "lifecycle.invocation-private-director-authorization-expectation.v1",
    deliveryId,
    operation: "delivery.no-ship",
    normalizedSemanticInput: review.semanticMarkdown,
    normalizedSemanticInputDigest:
      digestFoundationInvocationPrivateAuthorizationSemanticInputV1(review.semanticMarkdown),
    expectedGeneration: generation.digest,
    authorizationReviewDigest: review.authorizationReviewDigest,
    authority: Object.freeze({ ...review.authority }),
  });
  return Object.freeze({
    root,
    target: await realpath(target),
    machineHome,
    targetId: contract.targetId,
    deliveryId,
    environment: Object.freeze({
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.machineHome]: machineHome,
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.model]: "test-model",
      [FOUNDATION_INSTALLED_CONFIGURATION_ENVIRONMENT_V7.reasoning]: "test-reasoning",
    }),
    expectation,
    initialEventCount,
  });
}

test("the private handoff consumes one exact no-ship claim at its durable opening", async () => {
  const selected = await scenario("complete");
  try {
    let claims = 0;
    let consumed = 0;
    let refused = 0;
    const runtime = createFoundationInvocationPrivateAuthorizationRuntimeV1({
      environment: selected.environment,
      now: () => NOW,
    });
    const result = await runtime.authorize({
      locator: Object.freeze({ target: selected.target, deliveryId: selected.deliveryId }),
      selection: Object.freeze({
        operation: "delivery.no-ship",
        input: Object.freeze({
          semanticMarkdown: NO_SHIP_MARKDOWN,
        }),
      }),
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
      beginClaim: () => {
        claims += 1;
        return Object.freeze({
          expectation: selected.expectation,
          consume: () => { consumed += 1; },
          refuse: () => { refused += 1; },
        });
      },
    });
    // This synthetic preparation has a Control refusal but deliberately no
    // matching private Reclamation-ledger row. The terminal operation must
    // enter recovery after, not before, its durable authority opening.
    assert.equal(result.status, "recovery-required");
    assert.equal(
      result.diagnostics[0]?.code,
      "lifecycle.execution.reclamation-ledger-v1.terminal-subject-set",
    );
    assert.equal(claims, 1);
    assert.equal(selected.expectation.deliveryId, selected.deliveryId);
    assert.equal(selected.expectation.operation, "delivery.no-ship");
    assert.equal(JSON.stringify(selected.expectation).includes(SECRET), false);
    assert.equal(JSON.stringify(result).includes(SECRET), false);
    assert.equal(consumed, 1);
    assert.equal(refused, 0);

    const reopened = await openDeliveryControlRecordStore({
      machineHome: selected.machineHome,
      targetId: selected.targetId,
      deliveryId: selected.deliveryId,
    });
    try {
      assert.equal(reopened.disposition, "active");
      assert.equal(reopened.store.listEvents().filter(({ eventKind }) =>
        eventKind === "director-decision-authenticated").length, 1);
    } finally {
      reopened.store.close();
    }
  } finally {
    await rm(selected.root, { recursive: true, force: true });
  }
});

test("a stale private generation claims once, refuses terminally, and leaves Control unchanged", async () => {
  const selected = await scenario("stale");
  try {
    let claims = 0;
    let consumed = 0;
    let refused = 0;
    const runtime = createFoundationInvocationPrivateAuthorizationRuntimeV1({
      environment: selected.environment,
      now: () => NOW,
    });
    const result = await runtime.authorize({
      locator: Object.freeze({ target: selected.target, deliveryId: selected.deliveryId }),
      selection: Object.freeze({
        operation: "delivery.no-ship",
        input: Object.freeze({ semanticMarkdown: NO_SHIP_MARKDOWN }),
      }),
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
      beginClaim: () => {
        claims += 1;
        return Object.freeze({
          expectation: Object.freeze({
            ...selected.expectation,
            expectedGeneration: `sha256:${"f".repeat(64)}` as const,
          }),
          consume: () => { consumed += 1; },
          refuse: () => { refused += 1; },
        });
      },
    });
    assert.equal(result.status, "refused");
    assert.equal(result.diagnostics[0]?.code, "lifecycle.read-model.generation-stale");
    assert.equal(claims, 1);
    assert.equal(consumed, 0);
    assert.equal(refused, 1);

    const reopened = await openDeliveryControlRecordStore({
      machineHome: selected.machineHome,
      targetId: selected.targetId,
      deliveryId: selected.deliveryId,
    });
    try {
      assert.equal(reopened.disposition, "active");
      assert.equal(reopened.store.state().journal.eventCount, selected.initialEventCount);
    } finally {
      reopened.store.close();
    }
  } finally {
    await rm(selected.root, { recursive: true, force: true });
  }
});

test("a claimed challenge is refused when authentication fails before the opening batch", async () => {
  const selected = await scenario("authentication-failure");
  try {
    let claims = 0;
    let consumed = 0;
    let refused = 0;
    const runtime = createFoundationInvocationPrivateAuthorizationRuntimeV1({
      environment: selected.environment,
      now: () => NOW,
    });
    await assert.rejects(runtime.authorize({
      locator: Object.freeze({ target: selected.target, deliveryId: selected.deliveryId }),
      selection: Object.freeze({
        operation: "delivery.no-ship",
        input: Object.freeze({ semanticMarkdown: NO_SHIP_MARKDOWN }),
      }),
      authorityCredential: receiveFoundationAuthorityCredential("incorrect-invocation-private-secret-with-sufficient-entropy", "director-decision"),
      beginClaim: () => {
        claims += 1;
        return Object.freeze({
          expectation: selected.expectation,
          consume: () => { consumed += 1; },
          refuse: () => { refused += 1; },
        });
      },
    }));
    assert.equal(claims, 1);
    assert.equal(consumed, 0);
    assert.equal(refused, 1);

    const reopened = await openDeliveryControlRecordStore({
      machineHome: selected.machineHome,
      targetId: selected.targetId,
      deliveryId: selected.deliveryId,
    });
    try {
      assert.equal(reopened.disposition, "active");
      assert.equal(reopened.store.state().journal.eventCount, selected.initialEventCount);
      assert.equal(reopened.store.listEvents().some(({ eventKind }) =>
        eventKind === "director-decision-authenticated"), false);
    } finally {
      reopened.store.close();
    }
  } finally {
    await rm(selected.root, { recursive: true, force: true });
  }
});
