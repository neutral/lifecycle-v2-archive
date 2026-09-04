import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createFoundationRuntimeOperationRequest,
  type FoundationRuntimeAcceptRequest,
  type FoundationRuntimeNoShipRequest,
} from "@neutral/lifecycle-protocol";
import { createDeliveryControlRecordStore } from "../../src/foundation/control/delivery-custody.js";
import type { FoundationInstalledRuntimeConfigurationV7 } from "../../src/foundation/installed-configuration-v7.js";
import { git } from "../../src/foundation/repository/git.js";
import { initializeRepository } from "../../src/foundation/repository/initialize.js";
import {
  createFoundationRuntimeMutationExecutorV7,
  type FoundationRuntimeMutationV7Terminal,
} from "../../src/foundation/runtime-mutation-v7.js";
import {
  FOUNDATION_GENERATED_PUBLICATION_DIGEST,
  FOUNDATION_GENERATED_SPECIFICATION_REVISION,
} from "../../src/foundation/validation/generated-schemas.js";
import { writeMinimalAtlas } from "../helpers/atlas-fixture.js";

const NOW = "2026-08-29T22:00:00.000Z";
const SECRET = "runtime-terminal-wiring-secret-with-sufficient-entropy";

test("the mutation surface guards accept but still routes no-ship without resolving invalid current Atlas", async () => {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-runtime-terminal-wiring-"));
  const target = join(root, "target");
  const machineHome = join(root, "machine");
  const deliveryId = "delivery-runtime-terminal-wiring";
  await Promise.all([mkdir(target, { mode: 0o700 }), mkdir(machineHome, { mode: 0o700 })]);
  try {
    const canonicalTarget = await realpath(target);
    await git(target, ["init", "-b", "main"]);
    await git(target, ["config", "user.name", "Lifecycle Test"]);
    await git(target, ["config", "user.email", "lifecycle@example.invalid"]);
    await writeMinimalAtlas(target);
    await git(target, ["add", "--", "atlas"]);
    await git(target, ["commit", "-m", "Initialize target"]);
    const contract = await initializeRepository(target, {
      targetId: "runtime-terminal-wiring-target",
      founderPrincipal: "founder:runtime-terminal-wiring",
      home: machineHome,
      authoritySecret: SECRET,
      publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
      implementationRoots: [],
      stage: true,
    });
    await git(target, ["add", "--", "."]);
    await git(target, ["commit", "-m", "Initialize Lifecycle target"]);
    const created = await createDeliveryControlRecordStore({
      machineHome,
      targetId: contract.targetId,
      deliveryId,
      createdAt: NOW,
      runtimeActorId: "foundation-runtime-v7",
    });
    created.store.close();
    await writeFile(join(target, "atlas/atlas.md"), "invalid current Atlas\n", "utf8");
    await git(target, ["add", "--", "atlas/atlas.md"]);
    await git(target, ["commit", "-m", "Make current Atlas invalid"]);

    const captured: Array<Readonly<Record<string, unknown>>> = [];
    const terminal: FoundationRuntimeMutationV7Terminal = Object.freeze({
      accept: async (input) => {
        captured.push(Object.freeze({
          operation: "delivery.accept",
          target: input.target,
          deliveryId: input.store.identity.processId,
          authoritySecret: input.authoritySecret,
          carriesSemanticMarkdown: Object.hasOwn(input, "semanticMarkdown"),
        }));
        throw new Error("accept-terminal-sentinel");
      },
      noShip: async (input) => {
        captured.push(Object.freeze({
          operation: "delivery.no-ship",
          target: input.target,
          deliveryId: input.store.identity.processId,
          authoritySecret: input.authoritySecret,
          semanticMarkdown: input.semanticMarkdown,
        }));
        input.store.close();
        assert.throws(
          () => input.store.getSeal(),
          (error: unknown) => error instanceof Error &&
            (error as NodeJS.ErrnoException).code === "ERR_INVALID_STATE",
        );
        throw new Error("no-ship-terminal-sentinel");
      },
      recover: async () => {
        throw new Error("unexpected terminal recovery");
      },
    });
    const configuration: FoundationInstalledRuntimeConfigurationV7 = Object.freeze({
      machineHome,
      installationId: `installation.lifecycle.${"1".repeat(64)}`,
      codexHome: join(root, "unused-codex-home"),
      model: "unused-model",
      reasoning: "unused-reasoning",
      specificationRevision: FOUNDATION_GENERATED_SPECIFICATION_REVISION,
      publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
    });
    const mutation = createFoundationRuntimeMutationExecutorV7({
      terminal,
      now: () => NOW,
    });
    const accept = createFoundationRuntimeOperationRequest({
      target,
      operation: "delivery.accept",
      deliveryId,
      input: null,
    }) as FoundationRuntimeAcceptRequest;
    await assert.rejects(
      mutation.execute({ request: accept, context: { authoritySecret: SECRET }, configuration }),
      /Delivery has no exact active Work Boundary coordinate/u,
    );
    const noShipMarkdown = "# No-ship rationale\n\nClose this Delivery without integration.\n";
    const noShip = createFoundationRuntimeOperationRequest({
      target,
      operation: "delivery.no-ship",
      deliveryId,
      input: { semanticMarkdown: noShipMarkdown },
    }) as FoundationRuntimeNoShipRequest;
    await assert.rejects(
      mutation.execute({ request: noShip, context: { authoritySecret: SECRET }, configuration }),
      /no-ship-terminal-sentinel/u,
    );
    assert.deepEqual(captured, [
      {
        operation: "delivery.no-ship",
        target: canonicalTarget,
        deliveryId,
        authoritySecret: SECRET,
        semanticMarkdown: noShipMarkdown,
      },
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
