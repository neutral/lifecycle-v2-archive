import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  FOUNDATION_RUNTIME_FACADE_SCHEMA,
  createFoundationCommandCheckBinding,
  type FoundationCommandCheckBindingInput,
} from "../../src/index.js";
import { createFoundationRuntimeFacadeForTesting } from
  "../../src/foundation/facade.js";
import {
  createRepositoryContract,
  parseFoundationCheckBinding,
  parseFoundationCheckBindingRegistry,
} from "../../src/foundation/repository/contract.js";
import { git } from "../../src/foundation/repository/git.js";
import { initializeRepository } from "../../src/foundation/repository/initialize.js";
import { selfDigest, sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { FOUNDATION_GENERATED_PUBLICATION_DIGEST } from "../../src/foundation/validation/generated-schemas.js";
import { writeMinimalAtlas } from "../helpers/atlas-fixture.js";

const SECRET = "foundation-binding-initialization-secret-at-least-thirty-two-bytes";

function input(): FoundationCommandCheckBindingInput {
  return Object.freeze({
    id: "binding.npm-test",
    checkIds: Object.freeze(["check.zeta", "check.alpha"]),
    subjectSelectors: Object.freeze([
      Object.freeze({ kind: "repository" as const, selector: "." }),
      Object.freeze({ kind: "implementation" as const, selector: "src/**" }),
    ]),
    executable: Object.freeze({ relativeTo: "execution-image" as const, path: "usr/bin/env" }),
    args: Object.freeze(["npm", "test"]),
    cwd: ".",
    network: "none" as const,
    timeoutMs: 600_000,
    allowedModalities: Object.freeze(["precondition" as const, "postcondition" as const]),
    capabilityProfileId: null,
    environment: Object.freeze({ NODE_ENV: "test", CI: "1" }),
    resultParser: "exit-code-v1" as const,
    implementationDigest: sha256Bytes("txkit npm test implementation"),
    limitations: Object.freeze(["Whole repository only.", "No external services."]),
  });
}

test("package-root Check Binding construction validates Founder input and derives only fixed carrier fields", () => {
  const semantic = input();
  const binding = createFoundationCommandCheckBinding(semantic);

  assert.equal(binding.kind, "command");
  assert.equal(binding.mutation, "forbidden");
  assert.deepEqual(binding.resultParser, {
    id: "exit-code-v1",
    stateModel: "check-disposition-v2",
    states: ["pass", "fail", "indeterminate", "not-run", "unsupported", "operational-error"],
  });
  assert.equal(binding.implementationDigest, semantic.implementationDigest);
  assert.deepEqual(binding.executable, { relativeTo: "execution-image", path: "usr/bin/env" });
  assert.deepEqual(binding.checkIds, ["check.alpha", "check.zeta"]);
  assert.deepEqual(binding.subjectSelectors, [
    { kind: "implementation", selector: "src/**" },
    { kind: "repository", selector: "." },
  ]);
  assert.deepEqual(binding.args, ["npm", "test"]);
  assert.deepEqual(binding.allowedModalities, ["postcondition", "precondition"]);
  assert.deepEqual(Object.keys(binding.environment), ["CI", "NODE_ENV"]);
  assert.deepEqual(binding.limitations, ["No external services.", "Whole repository only."]);
  assert.equal(binding.digest, selfDigest(binding));
  assert.deepEqual(parseFoundationCheckBinding(structuredClone(binding), binding.id), binding);
  assert.equal(Object.isFrozen(binding), true);
  assert.equal(Object.isFrozen(binding.args), true);
  assert.equal(Object.isFrozen(binding.resultParser), true);

  assert.throws(
    () => parseFoundationCheckBinding({
      ...structuredClone(binding),
      resultParser: {
        ...structuredClone(binding.resultParser),
        stateModel: "check-disposition-v1",
      },
    }),
    /result state model/u,
  );
  assert.throws(
    () => parseFoundationCheckBinding({
      ...structuredClone(binding),
      resultParser: {
        ...structuredClone(binding.resultParser),
        states: ["pass", "fail", "indeterminate", "not-run", "unsupported", "unsupported"],
      },
    }),
    /exact check-disposition-v2 state order/u,
  );

  assert.throws(
    () => createFoundationCommandCheckBinding({ ...semantic, digest: binding.digest } as unknown as FoundationCommandCheckBindingInput),
    /unsupported field digest/u,
  );
  assert.throws(
    () => createFoundationCommandCheckBinding({
      ...semantic,
      allowedModalities: ["postcondition", "postcondition"],
    }),
    /duplicate/u,
  );
  assert.throws(
    () => createFoundationCommandCheckBinding({ ...semantic, checkIds: ["not-a-check"] }),
    /Knowledge identity/u,
  );
  assert.throws(
    () => createFoundationCommandCheckBinding({ ...semantic, implementationDigest: "not-a-digest" as never }),
    /SHA-256/u,
  );
  assert.throws(
    () => createFoundationCommandCheckBinding({ ...semantic, executable: "/usr/bin/env" as never }),
    /must be one JSON object/u,
  );
  assert.throws(
    () => createFoundationCommandCheckBinding({
      ...semantic,
      executable: { relativeTo: "execution-image", path: "/usr/bin/env" },
    }),
    /normalized repository-relative path/u,
  );
  const boundedEnvironment = Object.fromEntries(Array.from(
    { length: 128 },
    (_, index) => [`LIFECYCLE_BOUND_${String(index).padStart(3, "0")}`, String(index)],
  ));
  assert.equal(
    Object.keys(createFoundationCommandCheckBinding({ ...semantic, environment: boundedEnvironment }).environment).length,
    128,
  );
  assert.throws(
    () => createFoundationCommandCheckBinding({
      ...semantic,
      environment: { ...boundedEnvironment, LIFECYCLE_BOUND_128: "128" },
    }),
    /more than 128 variables/u,
  );
});

test("Check Binding registries reject identity substitution and contract creation rejects malformed nested input", () => {
  const binding = createFoundationCommandCheckBinding(input());
  assert.deepEqual(parseFoundationCheckBindingRegistry({ [binding.id]: binding }), { [binding.id]: binding });
  assert.throws(
    () => parseFoundationCheckBindingRegistry({ "binding.other": binding }),
    /identity is invalid/u,
  );
  assert.throws(
    () => createRepositoryContract({
      targetId: "target.invalid-binding",
      canonicalBranch: "refs/heads/main",
      authority: {
        principalId: "founder",
        keyId: "key.test",
        publicKey: "ed25519:dGVzdA==",
      },
      publicationDigest: sha256Bytes("publication"),
      checkBindings: { "binding.broken": { id: "binding.broken" } } as never,
    }),
    /fails urn:lifecycle:schema:repository-contract:v15/u,
  );
});

test("facade initialization rejects malformed nested Check Bindings before invoking the repository owner", async () => {
  let initialized = 0;
  const facade = createFoundationRuntimeFacadeForTesting({
    configuration: {
      machineHome: "/tmp/foundation-invalid-binding-home",
      installationId: `installation.lifecycle.${"1".repeat(64)}`,
      codexHome: "/tmp/foundation-invalid-binding-codex-home",
      model: "foundation-invalid-binding-model",
      reasoning: "low",
      specificationRevision: "lifecycle.foundation.1.0.0-rc.10",
      publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
    },
    initialize: async () => {
      initialized += 1;
      return {} as never;
    },
  });

  await assert.rejects(
    facade.execute({
      schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
      target: "/tmp/foundation-invalid-binding-target",
      operation: "repository.initialize",
      input: {
        checkBindings: { "binding.broken": { id: "binding.broken" } } as never,
      },
    }, { authoritySecret: SECRET }),
  );
  assert.equal(initialized, 0);
});

test("direct initialization rejects malformed Check Bindings without repository or authority effects", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-foundation-binding-target-"));
  const home = await mkdtemp(join(tmpdir(), "lifecycle-foundation-binding-home-"));
  context.after(async () => {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(home, { recursive: true, force: true }),
    ]);
  });
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Lifecycle Test"]);
  await git(root, ["config", "user.email", "lifecycle@example.invalid"]);
  await writeMinimalAtlas(root);
  await writeFile(join(root, ".gitignore"), "node_modules/\n", "utf8");
  await git(root, ["add", "--", "atlas", ".gitignore"]);
  await git(root, ["commit", "-m", "Initialize target"]);

  await assert.rejects(initializeRepository(root, {
    targetId: "target.invalid-binding",
    home,
    authoritySecret: SECRET,
    publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
    checkBindings: { "binding.broken": { id: "binding.broken" } } as never,
  }));

  await assert.rejects(readFile(join(root, ".lifecycle", "repository.json")), /ENOENT/u);
  await assert.rejects(readdir(join(root, "records")), /ENOENT/u);
  assert.deepEqual(await readdir(home), []);
  assert.equal((await git(root, ["status", "--short"])).stdout, "");
});
