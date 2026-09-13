import { receiveFoundationAuthorityCredential } from "../../src/foundation/repository/authority.js";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  FOUNDATION_DEFAULT_PROVIDER_DESCRIPTOR_ID,
  FOUNDATION_PROVIDER_PROTOCOL,
  FOUNDATION_SPECIFICATION_REVISION,
} from "../../src/foundation/constants.js";
import { selfDigest, sha256Bytes } from "../../src/foundation/validation/canonical.js";
import {
  foundationRepositorySchemaIds,
  validateFoundationSchema,
} from "../../src/foundation/validation/schema-engine.js";
import { parseStrictJson } from "../../src/foundation/validation/strict-json.js";
import { gitObject } from "../../src/foundation/validation/value.js";
import { FOUNDATION_GENERATED_PUBLICATION_DIGEST } from "../../src/foundation/validation/generated-schemas.js";
import {
  createFoundationAuthority,
} from "../../src/foundation/repository/authority.js";
import {
  createRepositoryContract,
  attachRepository,
  defaultCapabilityProfiles,
  defaultProjectionProfiles,
  FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR,
  createFoundationCommandCheckBinding,
  installedProviderDescriptors,
  parseRepositoryContract,
  readRepositoryContract,
  writeRepositoryContract,
} from "../../src/foundation/repository/contract.js";
import { commandCheckBinding, initializeRepository } from "../../src/foundation/repository/initialize.js";
import { createEmptyDisciplineRegistry, parseDisciplineRegistry } from "../../src/foundation/knowledge/discipline-registry.js";
import { git } from "../../src/foundation/repository/git.js";
import { validateRepository } from "../../src/foundation/repository/validate.js";
import { FOUNDATION_ATLAS_SELECTION } from "../../src/foundation/atlas/selection.js";
import { MINIMAL_ATLAS_FILES, writeMinimalAtlas } from "../helpers/atlas-fixture.js";

const SECRET = "foundation-test-secret-that-is-at-least-thirty-two-bytes";
const PUBLICATION_DIGEST = sha256Bytes("foundation-test-publication");
const REPOSITORY_SCHEMA_ID = "urn:lifecycle:schema:repository-contract:v22";

test("authority secrets use exact UTF-8 byte bounds without trimming", () => {
  const receive = (secret: string | undefined) => receiveFoundationAuthorityCredential(secret as string, "initialize");
  assert.throws(() => receive(undefined), /32 to 4096 secret bytes/u);
  assert.throws(() => receive("a".repeat(31)), /32 to 4096 secret bytes/u);
  assert.doesNotThrow(() => receive("a".repeat(32)));
  assert.doesNotThrow(() => receive("a".repeat(4096)));
  assert.throws(() => receive("a".repeat(4097)), /32 to 4096 secret bytes/u);

  const multibyteMinimum = "é".repeat(16);
  assert.equal(Buffer.byteLength(multibyteMinimum, "utf8"), 32);
  assert.doesNotThrow(() => receive(multibyteMinimum));

  const withTrailingNewline = `${"a".repeat(32)}\n`;
  assert.doesNotThrow(() => receive(withTrailingNewline));
  assert.throws(
    () => receive(`${"a".repeat(32)}\0`),
    /32 to 4096 secret bytes/u,
  );
});

test("standard self-digests exclude their declared digest field", () => {
  assert.equal(selfDigest({ value: "subject", digest: null }), sha256Bytes('{"value":"subject"}'));
  assert.equal(selfDigest({ value: "subject", digest: "ignored" }), sha256Bytes('{"value":"subject"}'));
});

test("the installed Provider Descriptor exactly retains the published first-adapter value", async () => {
  const descriptor = FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR;
  assert.deepEqual(Object.keys(installedProviderDescriptors()), [FOUNDATION_DEFAULT_PROVIDER_DESCRIPTOR_ID]);
  assert.equal(descriptor.id, FOUNDATION_DEFAULT_PROVIDER_DESCRIPTOR_ID);
  assert.equal(descriptor.adapter.protocol, FOUNDATION_PROVIDER_PROTOCOL);
  assert.equal(descriptor.adapter.implementationDigest, selfDigest(descriptor.adapter, "implementationDigest"));
  assert.equal(descriptor.digest, selfDigest(descriptor));
  assert.equal(descriptor.provider.compatibleVersion, ">=0.153.4 <0.154.0");
  assert.equal(descriptor.digest, "sha256:4bcb41216dad08468d53d7208909d3417415c6f5b7b1078da72285650a92d021");
  assert.deepEqual(
    validateFoundationSchema("urn:lifecycle:schema:provider-descriptor:v7", descriptor, "installed-provider"),
    [],
  );
  const published = JSON.parse(await readFile(
    new URL("../../../../spec-source/examples/provider-descriptor-structural-valid/subject.json", import.meta.url),
    "utf8",
  )) as unknown;
  assert.deepEqual(descriptor, published);
});

test("the published fresh repository-v22 fixture parses through the runtime contract owner", async () => {
  const published = JSON.parse(await readFile(
    new URL("../../../../spec-source/examples/repository-v22-fresh-valid/.lifecycle/repository.json", import.meta.url),
    "utf8",
  )) as unknown;
  const contract = parseRepositoryContract(published);
  assert.equal(contract.knowledge.roots.behavior, "records/behavior");
  assert.deepEqual(contract.productState.roots, [
    ".lifecycle/repository.json",
    "atlas",
    "records/assurance",
    "records/behavior",
    "records/blueprint",
    "records/checks",
    "records/disciplines",
  ]);
  assert.equal(contract.digest, selfDigest(contract));
});

test("strict JSON rejects unsafe integers regardless of lexical notation", () => {
  assert.throws(() => parseStrictJson('{"value":9007199254740992}'), /safe interoperable range/);
  assert.throws(() => parseStrictJson('{"value":9007199254740992.0}'), /safe interoperable range/);
  assert.throws(() => parseStrictJson('{"value":9.007199254740992e15}'), /safe interoperable range/);
});

test("repository identities and contract collections use exact scalar semantics", async () => {
  assert.equal(gitObject("a".repeat(40), "object"), "a".repeat(40));
  assert.equal(gitObject("b".repeat(64), "object"), "b".repeat(64));
  assert.throws(() => gitObject("c".repeat(41), "object"), /Git object identity/);

  const { home } = await repository();
  const authority = await createFoundationAuthority(home, "scalar-order-target", receiveFoundationAuthorityCredential(SECRET, "initialize"));
  const contract = createRepositoryContract({
    targetId: "scalar-order-target",
    canonicalBranch: "refs/heads/main",
    authority,
    publicationDigest: PUBLICATION_DIGEST,
    implementationRoots: ["\u{10000}", "\u{e000}"],
  });
  assert.deepEqual(contract.productState.governedImplementationRoots, ["\u{e000}", "\u{10000}"]);
  assert.equal(parseRepositoryContract(structuredClone(contract)).digest, contract.digest);
  const binding = commandCheckBinding({
    id: "scalar-order-check",
    checkIds: ["check.\u{10000}", "check.\u{e000}"],
    subjectSelectors: [
      { kind: "other", selector: "\u{10000}" },
      { kind: "other", selector: "\u{e000}" },
    ],
    executable: { relativeTo: "execution-image" as const, path: "usr/bin/true" },
    limitations: ["\u{10000}", "\u{e000}"],
  });
  assert.deepEqual(binding.checkIds, ["check.\u{e000}", "check.\u{10000}"]);
  assert.deepEqual(binding.subjectSelectors.map(({ selector }) => selector), ["\u{e000}", "\u{10000}"]);
  assert.deepEqual(binding.limitations, ["\u{e000}", "\u{10000}"]);
});

async function repository(): Promise<{ root: string; home: string }> {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-foundation-repository-"));
  const home = await mkdtemp(join(tmpdir(), "lifecycle-foundation-home-"));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Lifecycle Test"]);
  await git(root, ["config", "user.email", "lifecycle@example.invalid"]);
  await writeMinimalAtlas(root);
  await writeFile(join(root, ".gitignore"), "node_modules/\n", "utf8");
  await git(root, ["add", "--", "atlas", ".gitignore"]);
  await git(root, ["commit", "-m", "Initialize target"]);
  return { root, home };
}

test("repository contract v22 is self-digested and rejects silent mutation", async () => {
  const { root, home } = await repository();
  const authority = await createFoundationAuthority(home, "target-one", receiveFoundationAuthorityCredential(SECRET, "initialize"));
  const binding = commandCheckBinding({
    id: "repository-check",
    subjectSelectors: [{ kind: "repository", selector: "." }],
    executable: { relativeTo: "execution-image" as const, path: "usr/bin/true" },
    args: ["same", "same"],
  });
  const contract = createRepositoryContract({
    targetId: "target-one",
    canonicalBranch: "refs/heads/main",
    authority,
    publicationDigest: PUBLICATION_DIGEST,
    implementationRoots: ["src"],
    checkBindings: { [binding.id]: binding },
  });
  assert.equal(contract.$schema, "lifecycle.repository.v22");
  assert.equal(contract.specification.revision, FOUNDATION_SPECIFICATION_REVISION);
  assert.deepEqual(contract.sourcePolicy, { repository: "exact-bound-tree", externalLocal: "denied", network: "denied" });
  assert.deepEqual(contract.atlas, {
    root: "atlas",
    entrypoint: "atlas/atlas.md",
    readOnly: true,
    selection: FOUNDATION_ATLAS_SELECTION,
  });
  assert.deepEqual(contract.selections.schemas, foundationRepositorySchemaIds());
  assert(contract.selections.schemas.length > 0);
  assert.deepEqual(contract.runtime, {
    compatible: "lifecycle.runtime.foundation.v17",
    interface: "lifecycle.interface.foundation.v17",
  });
  assert.equal(Object.hasOwn(contract.runtime, "protocol"), false);
  assert.deepEqual(contract.selections.profiles, ["knowledge-set-v2", "knowledge-structural-v2", "repository-v9"]);
  assert.deepEqual(contract.selections, {
    schemas: foundationRepositorySchemaIds(),
    profiles: ["knowledge-set-v2", "knowledge-structural-v2", "repository-v9"],
    controlStore: "lifecycle.control-record-store.v2",
    controlLifecycleProfile: "foundation-delivery-control-lifecycle-v7",
    controlRecordRevision: "lifecycle.control-record-revision.v2",
    controlRecordEvent: "lifecycle.control-record-event.v6",
    controlReferencedFile: "lifecycle.control-record-file.v1",
    controlStoreSeal: "lifecycle.control-record-store-seal.v1",
    controlStoreArchive: "lifecycle.control-record-store-archive.v1",
    deliveryReduction: "lifecycle.delivery-reduction.v5",
    candidateRevisionCarrierManifest: "lifecycle.candidate-revision-carrier-manifest.v1",
    executionBackendProfile: "lifecycle.execution-backend-profile.docker-local.v1",
    executionCellRunner: "lifecycle.execution-cell-runner.v1",
    executionSpecification: "lifecycle.execution-specification.v1",
    executionInputSet: "lifecycle.execution-input-set.v2",
    executionImage: "lifecycle.execution-image.v1",
    executionObservation: "lifecycle.execution-observation.v1",
    executionOutputManifest: "lifecycle.execution-output-manifest.v1",
    extensions: [],
  });
  assert.equal(Object.hasOwn(contract.selections, "interfaceProtocol"), false);
  assert.deepEqual(contract.selections.extensions, []);
  assert.equal(contract.knowledge.roots.behavior, "records/behavior");
  assert(contract.productState.roots.includes("records/behavior"));
  assert.equal(contract.knowledge.limits.maximumFileBytes, 4 * 1024 * 1024);
  assert.equal(contract.knowledge.limits.maximumTotalSourceBytes, 256 * 1024 * 1024);
  assert.equal(contract.digest, selfDigest(contract));
  assert.deepEqual(Object.keys(defaultCapabilityProfiles()), ["local-development-v1"]);
  assert.deepEqual(Object.keys(defaultProjectionProfiles()), ["orientation-standard-v1", "execution-standard-v1", "execution-large-v1", "orientation-large-v1"]);
  assert.equal(contract.defaults.orientationProjectionProfileId, "orientation-standard-v1");
  assert.equal(contract.projectionProfiles["orientation-standard-v1"]!.maximumMandatoryItems, 256);
  assert.equal(contract.projectionProfiles["orientation-large-v1"]!.maximumMandatoryItems, 512);
  assert.deepEqual(contract.provider, {
    defaultDescriptorId: FOUNDATION_DEFAULT_PROVIDER_DESCRIPTOR_ID,
    defaultDescriptorDigest: FOUNDATION_INSTALLED_PROVIDER_DESCRIPTOR.digest,
    protocol: FOUNDATION_PROVIDER_PROTOCOL,
  });
  assert.equal(contract.defaults.providerDescriptorId, FOUNDATION_DEFAULT_PROVIDER_DESCRIPTOR_ID);
  assert.equal(parseRepositoryContract(structuredClone(contract)).digest, contract.digest);
  assert.deepEqual(validateFoundationSchema(REPOSITORY_SCHEMA_ID, structuredClone(contract), ".lifecycle/repository.json"), []);
  const unsupportedAtlas = structuredClone(contract) as unknown as Record<string, unknown>;
  const unsupportedAtlasBinding = unsupportedAtlas.atlas as Record<string, unknown>;
  const unsupportedAtlasSelection = unsupportedAtlasBinding.selection as Record<string, unknown>;
  unsupportedAtlasSelection.release = "0.6.0";
  assert.throws(() => parseRepositoryContract(unsupportedAtlas), (error: unknown) => (
    error instanceof Error && "code" in error &&
    error.code === "lifecycle.atlas.selection-unsupported" &&
    "observedFacts" in error &&
    (error.observedFacts as Record<string, unknown>).expected === FOUNDATION_ATLAS_SELECTION
  ));
  const retiredBehaviorRoot = structuredClone(contract) as unknown as Record<string, unknown>;
  const retiredKnowledge = retiredBehaviorRoot.knowledge as Record<string, unknown>;
  const retiredRoots = retiredKnowledge.roots as Record<string, unknown>;
  retiredRoots.behavior = "records/intent";
  assert(validateFoundationSchema(REPOSITORY_SCHEMA_ID, retiredBehaviorRoot, ".lifecycle/repository.json").length > 0);
  assert.throws(() => parseRepositoryContract(retiredBehaviorRoot), (error: unknown) => (
    error instanceof Error && "code" in error && error.code === "lifecycle.schema.invalid"
  ));
  const mutated = structuredClone(contract) as unknown as Record<string, unknown>;
  (mutated.defaults as Record<string, unknown>).capabilityProfileId = "missing";
  assert.deepEqual(validateFoundationSchema(REPOSITORY_SCHEMA_ID, mutated, ".lifecycle/repository.json"), []);
  assert.throws(() => parseRepositoryContract(mutated), /Default capability profile/);
  const mismatchedProviderDefault = structuredClone(contract) as unknown as Record<string, unknown>;
  (mismatchedProviderDefault.defaults as Record<string, unknown>).providerDescriptorId = "other-provider-v1";
  mismatchedProviderDefault.digest = selfDigest(mismatchedProviderDefault);
  assert.deepEqual(validateFoundationSchema(REPOSITORY_SCHEMA_ID, mismatchedProviderDefault, ".lifecycle/repository.json"), []);
  assert.throws(() => parseRepositoryContract(mismatchedProviderDefault), /Default Provider Descriptor/);
  const unsupportedSelection = structuredClone(contract) as unknown as Record<string, unknown>;
  (unsupportedSelection.selections as Record<string, unknown>).profiles = ["knowledge-set-v2", "knowledge-structural-v2", "unsupported-v1"];
  assert(validateFoundationSchema(REPOSITORY_SCHEMA_ID, unsupportedSelection, ".lifecycle/repository.json").length > 0);
  assert.throws(() => parseRepositoryContract(unsupportedSelection), (error: unknown) => (
    error instanceof Error && "code" in error && error.code === "lifecycle.schema.invalid"
  ));
  const boundedEgress = structuredClone(contract) as unknown as Record<string, unknown>;
  const boundedProfiles = boundedEgress.capabilityProfiles as Record<string, Record<string, unknown>>;
  const boundedProfile = boundedProfiles["local-development-v1"]!;
  boundedProfile.network = { mode: "bounded-egress" };
  boundedProfile.digest = selfDigest(boundedProfile);
  boundedEgress.digest = selfDigest(boundedEgress);
  assert.deepEqual(
    validateFoundationSchema(REPOSITORY_SCHEMA_ID, boundedEgress, ".lifecycle/repository.json"),
    [],
  );
  assert.equal(
    parseRepositoryContract(boundedEgress).capabilityProfiles["local-development-v1"]?.network.mode,
    "bounded-egress",
  );
  await writeRepositoryContract(root, contract);
  assert.equal((await readRepositoryContract(root)).digest, contract.digest);
  const raw = await readFile(join(root, ".lifecycle", "repository.json"), "utf8");
  assert.match(raw, /"\$schema": "lifecycle.repository.v22"/);
});

test("semantic Check Binding construction rejects runtime-owned environment names", () => {
  const base = {
    id: "protected-environment-check",
    checkIds: ["check.protected-environment"],
    subjectSelectors: [{ kind: "repository" as const, selector: "." }],
    executable: { relativeTo: "execution-image" as const, path: "usr/bin/true" },
    args: [],
    cwd: ".",
    network: "none" as const,
    timeoutMs: 1_000,
    allowedModalities: ["diagnostic" as const],
    capabilityProfileId: null,
    resultParser: "exit-code-v1" as const,
    implementationDigest: sha256Bytes("protected-environment-check"),
    limitations: [],
  };
  assert.throws(
    () => createFoundationCommandCheckBinding({ ...base, environment: { PATH: "/invented" } }),
    (error: unknown) => error instanceof Error && "code" in error &&
      error.code === "lifecycle.repository.binding-environment-protected",
  );
  const binding = createFoundationCommandCheckBinding({ ...base, environment: { LIFECYCLE_TEST_MODE: "1" } });
  assert.deepEqual(binding.environment, { LIFECYCLE_TEST_MODE: "1" });
  assert.equal(
    createFoundationCommandCheckBinding({ ...base, environment: { NODE_OPTIONS: "--trace-warnings" } })
      .environment.NODE_OPTIONS,
    "--trace-warnings",
  );
});

test("repository initialization creates only Foundation roots and stages exact carriers", async () => {
  const { root, home } = await repository();
  const contract = await initializeRepository(root, {
    targetId: "target-init",
    directorPrincipal: "director",
    home,
    authorityCredential: receiveFoundationAuthorityCredential(SECRET, "initialize"),
    publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
    implementationRoots: ["src"],
    stage: true,
  });
  assert.equal(contract.targetId, "target-init");
  assert.equal(contract.canonicalBranch, "refs/heads/main");
  const staged = (await git(root, ["diff", "--cached", "--name-only"])).stdout.trim().split("\n").filter(Boolean).sort();
  assert.deepEqual(staged, [
    ".lifecycle/repository.json",
    "records/assurance/.gitkeep",
    "records/behavior/.gitkeep",
    "records/blueprint/.gitkeep",
    "records/checks/.gitkeep",
    "records/disciplines/.gitkeep",
    "records/disciplines/registry.json",
  ]);
  assert.deepEqual((await readdir(join(root, "records"))).sort(), ["assurance", "behavior", "blueprint", "checks", "disciplines"]);
  assert.deepEqual(
    parseDisciplineRegistry(await readFile(join(root, "records/disciplines/registry.json")), contract),
    createEmptyDisciplineRegistry(),
  );
  await assert.rejects(readdir(join(root, "records", "control")), /ENOENT/u);
  assert.deepEqual(await readdir(join(root, ".lifecycle")), ["repository.json"]);
  await assert.rejects(readdir(join(root, ".lifecycle", "runtime")), /ENOENT/u);
  await git(root, ["commit", "-m", "Initialize Lifecycle foundation"]);
  const validation = await validateRepository(root, { observedAt: "2026-08-23T12:00:00.000Z" });
  assert.equal(validation.complete, true, JSON.stringify(validation, null, 2));
  assert.equal(validation.valid, true, JSON.stringify(validation, null, 2));
  assert.equal(validation.profile, "repository-v9");
  assert.equal((await git(root, ["status", "--short"])).stdout, "");
});

test("repository v22 refuses repository-visible Control without interpreting its bytes", async () => {
  const { root, home } = await repository();
  await initializeRepository(root, {
    targetId: "target-alpha",
    home,
    authorityCredential: receiveFoundationAuthorityCredential(SECRET, "initialize"),
    publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
    implementationRoots: ["src"],
    stage: true,
  });
  await git(root, ["commit", "-m", "Initialize repository v22 target"]);
  const predecessorPath = "records/control/delivery/work-boundaries/predecessor.md";
  await mkdir(join(root, "records", "control", "delivery", "work-boundaries"), { recursive: true });
  await writeFile(join(root, predecessorPath), "# Repository-visible predecessor Control\n", "utf8");
  await git(root, ["add", "--", predecessorPath]);
  await git(root, ["commit", "-m", "Add predecessor repository-visible Control"]);
  await assert.rejects(
    attachRepository(root),
    (error: unknown) => error instanceof Error && "code" in error &&
      error.code === "lifecycle.repository.epoch-mixed",
  );
  const invalid = await validateRepository(root, { observedAt: "2026-08-27T12:01:00.000Z" });
  assert.equal(invalid.complete, false);
  assert.equal(invalid.valid, false);
  assert(invalid.diagnostics.some(({ code }) => code === "lifecycle.repository.epoch-mixed"));
});

test("repository initialization adds placeholders only to empty Knowledge roots", async () => {
  const { root, home } = await repository();
  await mkdir(join(root, "records", "checks"), { recursive: true });
  await writeFile(join(root, "records", "checks", "existing.md"), "# Existing Check\n", "utf8");
  await git(root, ["add", "--", "records/checks/existing.md"]);
  await git(root, ["commit", "-m", "Add existing Check record"]);

  await initializeRepository(root, {
    targetId: "target-with-check",
    home,
    authorityCredential: receiveFoundationAuthorityCredential(SECRET, "initialize"),
    publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
    stage: true,
  });

  assert.deepEqual(await readdir(join(root, "records", "checks")), ["existing.md"]);
  const staged = (await git(root, ["diff", "--cached", "--name-only"])).stdout.trim().split("\n").filter(Boolean).sort();
  assert.deepEqual(staged, [
    ".lifecycle/repository.json",
    "records/assurance/.gitkeep",
    "records/behavior/.gitkeep",
    "records/blueprint/.gitkeep",
    "records/disciplines/.gitkeep",
    "records/disciplines/registry.json",
  ]);
});

test("failed initialization preserves a pre-existing non-empty Knowledge root exactly", async () => {
  const { root, home } = await repository();
  const checkPath = join(root, "records", "checks", "existing.md");
  await mkdir(join(root, "records", "checks"), { recursive: true });
  await writeFile(checkPath, "# Existing Check\n", "utf8");
  await git(root, ["add", "--", "records/checks/existing.md"]);
  await git(root, ["commit", "-m", "Add existing Check record"]);

  const indexLock = join(root, ".git", "index.lock");
  await writeFile(indexLock, "initialization fault\n", "utf8");
  try {
    await assert.rejects(initializeRepository(root, {
      targetId: "target-with-check-recovery",
      home,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "initialize"),
      publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
      stage: true,
    }));
  } finally {
    await rm(indexLock, { force: true });
  }

  assert.equal(await readFile(checkPath, "utf8"), "# Existing Check\n");
  assert.deepEqual(await readdir(join(root, "records", "checks")), ["existing.md"]);
  await assert.rejects(readFile(join(root, "records", "checks", ".gitkeep")), /ENOENT/u);
  await assert.rejects(readFile(join(root, ".lifecycle", "repository.json")), /ENOENT/u);
  await assert.rejects(readdir(join(home, "authorities")), /ENOENT/u);
  await assert.rejects(readdir(join(root, "records", "disciplines")), /ENOENT/u);
  assert.equal((await git(root, ["status", "--short"])).stdout, "");
});

test("repository initialization rejects target-contained and Git-contained machine homes without effects", async () => {
  for (const placement of ["target", "git-common"] as const) {
    const { root } = await repository();
    const home = placement === "target"
      ? join(root, "machine-home")
      : join(root, ".git", "machine-home");
    await mkdir(home);

    await assert.rejects(
      initializeRepository(root, {
        targetId: `isolated-home-${placement}`,
        directorPrincipal: "director",
        home,
        authorityCredential: receiveFoundationAuthorityCredential(SECRET, "initialize"),
        publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
      }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "lifecycle.repository.machine-home-isolation",
    );

    assert.deepEqual(await readdir(home), []);
    await assert.rejects(readFile(join(root, ".lifecycle", "repository.json")), /ENOENT/u);
    await assert.rejects(readdir(join(root, "records")), /ENOENT/u);
    assert.equal((await git(root, ["status", "--short"])).stdout, "");
  }
});

test("fresh initialization preserves a pre-existing Discipline Registry and rolls back its other carriers", async () => {
  const { root, home } = await repository();
  const registryPath = join(root, "records", "disciplines", "registry.json");
  const original = "existing publisher adoption state is not an initialization input\n";
  await mkdir(join(root, "records", "disciplines"), { recursive: true });
  await writeFile(registryPath, original, "utf8");
  await git(root, ["add", "--", "records/disciplines/registry.json"]);
  await git(root, ["commit", "-m", "Preserve existing Discipline Registry"]);

  await assert.rejects(initializeRepository(root, {
    targetId: "existing-discipline-registry",
    home,
    authorityCredential: receiveFoundationAuthorityCredential(SECRET, "initialize"),
    publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
    stage: true,
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "lifecycle.repository.exists");

  assert.equal(await readFile(registryPath, "utf8"), original);
  assert.deepEqual(await readdir(join(root, "records")), ["disciplines"]);
  assert.deepEqual(await readdir(join(root, "records", "disciplines")), ["registry.json"]);
  await assert.rejects(readFile(join(root, ".lifecycle", "repository.json")), /ENOENT/u);
  await assert.rejects(readdir(join(home, "authorities")), /ENOENT/u);
  assert.equal((await git(root, ["status", "--short"])).stdout, "");
});

test("retired repository discriminators fail closed for repository v22 attachment", async () => {
  for (const version of [12, 13, 14, 15, 16, 17, 18, 19, 20]) {
    const { root } = await repository();
    await mkdir(join(root, ".lifecycle"), { recursive: true });
    await writeFile(
      join(root, ".lifecycle", "repository.json"),
      `${JSON.stringify({ $schema: `lifecycle.repository.v${version}` })}\n`,
      "utf8",
    );
    await assert.rejects(
      attachRepository(root),
      (error: unknown) => error instanceof Error && "code" in error &&
        error.code === "lifecycle.repository.predecessor-unsupported",
      `repository v${version} was not refused as a retired discriminator`,
    );
  }
});

test("Foundation repository contracts reject migration provenance", async () => {
  const { home } = await repository();
  const authority = await createFoundationAuthority(home, "fresh-target", receiveFoundationAuthorityCredential(SECRET, "initialize"));
  const contract = createRepositoryContract({
    targetId: "fresh-target",
    canonicalBranch: "refs/heads/main",
    authority,
    publicationDigest: PUBLICATION_DIGEST,
  });
  const withMigration = structuredClone(contract) as unknown as Record<string, unknown>;
  withMigration.migration = null;
  assert(validateFoundationSchema(REPOSITORY_SCHEMA_ID, withMigration, ".lifecycle/repository.json").length > 0);
  assert.throws(() => parseRepositoryContract(withMigration), (error: unknown) => (
    error instanceof Error && "code" in error && error.code === "lifecycle.schema.invalid"
  ));
});

test("fresh initialization rejects predecessor Control before creating authority", async () => {
  const { root, home } = await repository();
  await mkdir(join(root, "records", "control", "delivery"), { recursive: true });
  await writeFile(
    join(root, "records", "control", "delivery", "predecessor.json"),
    '{"schema":"lifecycle.delivery-attempt.v4"}\n',
    "utf8",
  );
  await git(root, ["add", "--", "records/control/delivery/predecessor.json"]);
  await git(root, ["commit", "-m", "Add predecessor Control"]);
  await assert.rejects(
    initializeRepository(root, {
      targetId: "mixed-target",
      directorPrincipal: "director",
      home,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "initialize"),
      publicationDigest: PUBLICATION_DIGEST,
    }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "lifecycle.repository.predecessor-unsupported",
  );
  await assert.rejects(readFile(join(root, ".lifecycle", "repository.json")), /ENOENT/);
  await assert.rejects(readdir(join(home, "authorities")), /ENOENT/);
});

test("fresh initialization rejects retired repository discriminators without effects", async () => {
  for (const version of [11, 13, 14]) {
    const { root, home } = await repository();
    await mkdir(join(root, ".lifecycle"), { recursive: true });
    await writeFile(
      join(root, ".lifecycle", "repository.json"),
      `${JSON.stringify({ $schema: `lifecycle.repository.v${version}` })}\n`,
      "utf8",
    );
    await git(root, ["add", "--", ".lifecycle/repository.json"]);
    await git(root, ["commit", "-m", `Add minimum repository-v${version} discriminator`]);
    await assert.rejects(
      initializeRepository(root, {
        targetId: `predecessor-target-v${version}`,
        directorPrincipal: "director",
        home,
        authorityCredential: receiveFoundationAuthorityCredential(SECRET, "initialize"),
        publicationDigest: PUBLICATION_DIGEST,
      }),
      (error: unknown) => error instanceof Error && "code" in error &&
        error.code === "lifecycle.repository.predecessor-unsupported",
      `repository v${version} was not refused before initialization`,
    );
    await assert.rejects(readdir(join(home, "authorities")), /ENOENT/);
    assert.equal((await git(root, ["status", "--short"])).stdout, "");
  }
});

test("fresh initialization rejects unbound Atlas files before creating authority", async () => {
  const { root, home } = await repository();
  await writeFile(join(root, ".gitignore"), "node_modules/\natlas/ignored.md\n", "utf8");
  await git(root, ["add", "--", ".gitignore"]);
  await git(root, ["commit", "-m", "Ignore one local Atlas path"]);
  await writeFile(join(root, "atlas", "ignored.md"), "# Unbound Atlas\n", "utf8");

  await assert.rejects(
    initializeRepository(root, {
      targetId: "unbound-atlas-target",
      home,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "initialize"),
      publicationDigest: PUBLICATION_DIGEST,
    }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "lifecycle.repository.untracked-authority",
  );
  await assert.rejects(readdir(join(home, "authorities")), /ENOENT/);
});

test("fresh initialization rejects an unsupported Atlas authored format before creating authority", async () => {
  const { root, home } = await repository();
  await writeFile(
    join(root, "atlas", "atlas.md"),
    MINIMAL_ATLAS_FILES["atlas/atlas.md"].replace('"format": 1', '"format": 0'),
    "utf8",
  );
  await git(root, ["add", "--", "atlas/atlas.md"]);
  await git(root, ["commit", "-m", "Regress Atlas authored format"]);

  await assert.rejects(
    initializeRepository(root, {
      targetId: "unsupported-atlas-format-target",
      directorPrincipal: "director",
      home,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "initialize"),
      publicationDigest: PUBLICATION_DIGEST,
    }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "lifecycle.atlas.invalid",
  );
  await assert.rejects(readdir(join(home, "authorities")), /ENOENT/u);
  await assert.rejects(readFile(join(root, ".lifecycle", "repository.json")), /ENOENT/u);
});

test("fresh initialization rejects mixed Foundation contract and predecessor Control before new authority", async () => {
  const { root, home } = await repository();
  const existingAuthority = await createFoundationAuthority(home, "existing-foundation", receiveFoundationAuthorityCredential(SECRET, "initialize"));
  const contract = createRepositoryContract({
    targetId: "existing-foundation",
    canonicalBranch: "refs/heads/main",
    authority: existingAuthority,
    publicationDigest: PUBLICATION_DIGEST,
    implementationRoots: [],
  });
  await writeRepositoryContract(root, contract);
  await mkdir(join(root, "records", "control", "delivery", "work-boundaries"), { recursive: true });
  await writeFile(
    join(root, "records", "control", "delivery", "work-boundaries", "wb.predecessor.json"),
    '{"schema":"lifecycle.delivery-work-boundary.v3"}\n',
    "utf8",
  );
  await git(root, ["add", "--", ".lifecycle/repository.json", "records/control/delivery/work-boundaries/wb.predecessor.json"]);
  await git(root, ["commit", "-m", "Create mixed Lifecycle state"]);

  await assert.rejects(
    initializeRepository(root, {
      targetId: "must-not-exist",
      home,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "initialize"),
      publicationDigest: PUBLICATION_DIGEST,
    }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "lifecycle.repository.epoch-mixed",
  );
  await assert.rejects(readdir(join(home, "authorities", "must-not-exist")), /ENOENT/);
});

test("fresh initialization never replaces an existing machine authority identity", async () => {
  const { root, home } = await repository();
  const existing = await createFoundationAuthority(home, "authority-collision", receiveFoundationAuthorityCredential(SECRET, "initialize"));
  const authorityDirectory = join(home, "authorities", "authority-collision");
  const authorityPath = join(authorityDirectory, `${existing.keyId}.pem`);
  const originalKey = await readFile(authorityPath);

  await assert.rejects(
    initializeRepository(root, {
      targetId: "authority-collision",
      directorPrincipal: "director",
      home,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "initialize"),
      publicationDigest: PUBLICATION_DIGEST,
    }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "lifecycle.repository.authority-exists",
  );

  assert.deepEqual(await readdir(authorityDirectory), [`${existing.keyId}.pem`]);
  assert.deepEqual(await readFile(authorityPath), originalKey);
  await assert.rejects(readFile(join(root, ".lifecycle", "repository.json")), /ENOENT/);
  assert.equal((await git(root, ["status", "--short"])).stdout, "");
});

test("Foundation attachment rejects tracked predecessor Control beside a v22 contract", async () => {
  const { root, home } = await repository();
  const authority = await createFoundationAuthority(home, "mixed-attachment", receiveFoundationAuthorityCredential(SECRET, "initialize"));
  const contract = createRepositoryContract({
    targetId: "mixed-attachment",
    canonicalBranch: "refs/heads/main",
    authority,
    publicationDigest: PUBLICATION_DIGEST,
    implementationRoots: [],
  });
  await writeRepositoryContract(root, contract);
  await mkdir(join(root, "records", "control", "delivery", "work-boundaries"), { recursive: true });
  await writeFile(
    join(root, "records", "control", "delivery", "work-boundaries", "wb.predecessor-attempt.json"),
    '{"schema":"lifecycle.delivery-work-boundary.v3","attemptId":"predecessor-attempt"}\n',
    "utf8",
  );
  await git(root, ["add", "--", ".lifecycle/repository.json", "records/control/delivery/work-boundaries/wb.predecessor-attempt.json"]);
  await git(root, ["commit", "-m", "Create mixed Foundation and predecessor state"]);
  await assert.rejects(
    attachRepository(root),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "lifecycle.repository.epoch-mixed",
  );
});
