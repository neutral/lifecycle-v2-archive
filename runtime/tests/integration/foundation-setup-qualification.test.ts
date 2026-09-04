import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createFoundationRuntimeFacadeForTesting,
  FOUNDATION_RUNTIME_FACADE_SCHEMA,
  renderFoundationRuntimeHuman,
  type FoundationRuntimeFacade,
} from "../../src/foundation/facade.js";
import { attachRepository } from "../../src/foundation/repository/contract.js";
import { git } from "../../src/foundation/repository/git.js";
import {
  FOUNDATION_GENERATED_PUBLICATION_DIGEST,
  FOUNDATION_GENERATED_SPECIFICATION_REVISION,
} from "../../src/foundation/validation/generated-schemas.js";
import { writeMinimalAtlas } from "../helpers/atlas-fixture.js";

const AUTHORITY_SECRET = "foundation-setup-qualification-secret-32-bytes";
const OBSERVED_AT = "2026-08-23T12:00:00.000Z";

function runtimeFor(home: string): FoundationRuntimeFacade {
  return createFoundationRuntimeFacadeForTesting({
    configuration: {
      machineHome: home,
      installationId: `installation.lifecycle.${"1".repeat(64)}`,
      codexHome: join(home, "codex-exec-home"),
      model: "foundation-setup-qualification-model",
      reasoning: "low",
      specificationRevision: FOUNDATION_GENERATED_SPECIFICATION_REVISION,
      publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
    },
    now: () => OBSERVED_AT,
  });
}

async function freshTarget(context: test.TestContext): Promise<Readonly<{ root: string; home: string }>> {
  const parent = await mkdtemp(join(tmpdir(), "lifecycle-foundation-setup-"));
  context.after(async () => await rm(parent, { recursive: true, force: true }));
  const root = join(parent, "target");
  const home = join(parent, "machine-home");
  await Promise.all([mkdir(root), mkdir(home)]);
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Lifecycle Qualification"]);
  await git(root, ["config", "user.email", "qualification@example.invalid"]);
  await writeMinimalAtlas(root);
  await writeFile(join(root, ".gitignore"), "node_modules/\n", "utf8");
  await git(root, ["add", "--", ".gitignore", "atlas"]);
  await git(root, ["commit", "-m", "Create fresh target"]);
  return Object.freeze({ root, home });
}

test("compiled Foundation facade initializes, validates, and detects canonical drift on a disposable target", async (context) => {
  const target = await freshTarget(context);
  const runtime = runtimeFor(target.home);
  const initialized = await runtime.execute({
    schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
    target: target.root,
    operation: "repository.initialize",
    input: {
      targetId: "qualification-target",
      implementationRoots: [],
      stage: true,
    },
  }, { authoritySecret: AUTHORITY_SECRET });

  assert.equal(initialized.status, "completed");
  assert.equal(initialized.targetId, "qualification-target");
  assert.equal(initialized.deliveryId, null);
  assert.equal(initialized.value, null);
  assert.equal(initialized.observation.delivery, null);
  assert.equal(JSON.stringify(initialized).includes(AUTHORITY_SECRET), false);
  assert.equal(JSON.stringify(initialized).includes(target.home), false);
  const contract = JSON.parse(
    await readFile(join(target.root, ".lifecycle", "repository.json"), "utf8"),
  ) as {
    $schema: string;
    schemaVersion: number;
    specification: { revision: string };
    runtime: { compatible: string; interface: string };
    selections: Record<string, unknown>;
    provider: { protocol: string; defaultDescriptorId: string; defaultDescriptorDigest: string };
  };
  assert.equal(contract.$schema, "lifecycle.repository.v15");
  assert.equal(contract.schemaVersion, 15);
  assert.equal(contract.specification.revision, "lifecycle.foundation.1.0.0-rc.10");
  assert.equal(contract.runtime.compatible, "lifecycle.runtime.foundation.v10");
  assert.equal(contract.runtime.interface, "lifecycle.interface.foundation.v10");
  assert.equal(Object.hasOwn(contract.runtime, "protocol"), false);
  assert.equal(Object.hasOwn(contract.selections, "interfaceProtocol"), false);
  assert.equal(contract.provider.protocol, "lifecycle.provider-adapter.v6");
  assert.equal(contract.provider.defaultDescriptorId, "codex-exec-standard-v6");
  assert.equal(
    contract.provider.defaultDescriptorDigest,
    "sha256:2e7d6aa152145518c6ce35b561384eb9f0e49dd2736ea019f18d47d5f095fc9e",
  );
  assert.deepEqual(
    (await git(target.root, ["diff", "--cached", "--name-only"])).stdout.trim().split("\n").filter(Boolean).sort(),
    [
      ".lifecycle/repository.json",
      "records/assurance/.gitkeep",
      "records/behavior/.gitkeep",
      "records/blueprint/.gitkeep",
      "records/checks/.gitkeep",
    ],
  );
  await assert.rejects(readdir(join(target.root, "records", "control")), /ENOENT/u);
  await assert.rejects(readdir(join(target.home, "control-record-stores")), /ENOENT/u);
  assert.equal(
    (await git(target.root, ["check-ignore", "--quiet", "--", ".lifecycle/runtime/attempts/qualification"], { allowFailure: true })).exitCode,
    1,
  );

  await git(target.root, ["commit", "-m", "Initialize Lifecycle Foundation"]);
  const validated = await runtime.execute({
    schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
    target: target.root,
    operation: "repository.validate",
    input: null,
  });
  assert.equal(validated.status, "completed", JSON.stringify(validated, null, 2));
  assert.equal(validated.observation.repository.initialized, true);
  assert.equal(validated.observation.repository.valid, true);
  assert.equal(validated.observation.delivery, null);
  assert.equal(validated.value, null);

  const attachment = await attachRepository(target.root);
  assert.equal(validated.observation.repository.headCommit, attachment.headCommit);
  assert.match(renderFoundationRuntimeHuman(validated), /^repository\.validate: completed\n/u);
  assert.equal((await git(target.root, ["status", "--short"])).stdout, "");

  await writeFile(join(target.root, "README.md"), "# Canonical drift\n", "utf8");
  await git(target.root, ["add", "--", "README.md"]);
  await git(target.root, ["commit", "-m", "Move canonical target"]);
  const moved = await runtime.execute({
    schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
    target: target.root,
    operation: "repository.validate",
    input: null,
  });
  assert.equal(moved.observation.repository.headCommit, (await attachRepository(target.root)).headCommit);
  assert.notEqual(moved.observation.repository.headCommit, attachment.headCommit);
});

test("compiled Foundation facade refuses predecessor Control before authority creation", async (context) => {
  const target = await freshTarget(context);
  await mkdir(join(target.root, "records", "control", "delivery"), { recursive: true });
  await writeFile(
    join(target.root, "records", "control", "delivery", "attempt.json"),
    '{"schema":"lifecycle.delivery-attempt.v4"}\n',
    "utf8",
  );
  await git(target.root, ["add", "--", "records/control/delivery/attempt.json"]);
  await git(target.root, ["commit", "-m", "Add predecessor Control"]);

  await assert.rejects(
    runtimeFor(target.home).execute({
      schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
      target: target.root,
      operation: "repository.initialize",
      input: {
        targetId: "must-not-exist",
      },
    }, { authoritySecret: AUTHORITY_SECRET }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "lifecycle.repository.predecessor-unsupported",
  );
  await assert.rejects(readFile(join(target.root, ".lifecycle", "repository.json")), /ENOENT/u);
  await assert.rejects(readdir(join(target.home, "authorities")), /ENOENT/u);
});

test("compiled Foundation facade rejects target-contained and Git-contained machine homes without effects", async (context) => {
  for (const placement of ["target", "git-common"] as const) {
    const target = await freshTarget(context);
    const home = placement === "target"
      ? join(target.root, "machine-home")
      : join(target.root, ".git", "machine-home");
    await mkdir(home);

    await assert.rejects(
      runtimeFor(home).execute({
        schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
        target: target.root,
        operation: "repository.initialize",
        input: {
          targetId: `qualification-machine-home-${placement}`,
        },
      }, { authoritySecret: AUTHORITY_SECRET }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "lifecycle.repository.machine-home-isolation",
    );

    assert.deepEqual(await readdir(home), []);
    await assert.rejects(readFile(join(target.root, ".lifecycle", "repository.json")), /ENOENT/u);
    await assert.rejects(readdir(join(target.root, "records")), /ENOENT/u);
    assert.equal((await git(target.root, ["status", "--short"])).stdout, "");
  }
});

test("compiled Foundation initialization rolls back a post-contract staging fault and retries cleanly", async (context) => {
  const target = await freshTarget(context);
  const runtime = runtimeFor(target.home);
  const initialIgnore = await readFile(join(target.root, ".gitignore"));
  const indexLock = join(target.root, ".git", "index.lock");
  const request = {
    schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
    target: target.root,
    operation: "repository.initialize" as const,
    input: {
      targetId: "qualification-recovery-target",
      implementationRoots: [],
      stage: true,
    },
  };

  await writeFile(indexLock, "qualification fault\n", "utf8");
  try {
    await assert.rejects(
      runtime.execute(request, { authoritySecret: AUTHORITY_SECRET }),
      (error: unknown) => error instanceof Error
        && (!('code' in error) || error.code !== "lifecycle.repository.initialization-recovery"),
    );
  } finally {
    await rm(indexLock, { force: true });
  }

  assert.deepEqual(await readFile(join(target.root, ".gitignore")), initialIgnore);
  await assert.rejects(readFile(join(target.root, ".lifecycle", "repository.json")), /ENOENT/u);
  await assert.rejects(readdir(join(target.root, ".lifecycle")), /ENOENT/u);
  await assert.rejects(readdir(join(target.root, "records")), /ENOENT/u);
  assert.deepEqual(await readdir(target.home), []);
  assert.equal((await git(target.root, ["status", "--short"])).stdout, "");

  const initialized = await runtime.execute(request, { authoritySecret: AUTHORITY_SECRET });
  assert.equal(initialized.status, "completed");
  const contract = JSON.parse(await readFile(join(target.root, ".lifecycle", "repository.json"), "utf8")) as {
    authority: { keyId: string };
  };
  assert.deepEqual(
    await readdir(join(target.home, "authorities", "qualification-recovery-target")),
    [`${contract.authority.keyId}.pem`],
  );
});
