import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { mkdtemp } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import { FOUNDATION_SPECIFICATION_REVISION } from "../../src/foundation/constants.js";
import { loadKnowledgeSet } from "../../src/foundation/knowledge/knowledge-set.js";
import type { FoundationKnowledgeSet } from "../../src/foundation/knowledge/types.js";
import { createFoundationAuthority } from "../../src/foundation/repository/authority.js";
import { createRepositoryContract, writeRepositoryContract } from "../../src/foundation/repository/contract.js";
import { git } from "../../src/foundation/repository/git.js";
import {
  bindHistoricalRepositorySnapshot,
  bindRepositorySnapshot,
  loadRepositoryEpoch,
  loadRepositoryEpochAtCommit,
} from "../../src/foundation/repository/snapshot.js";
import type { FoundationLoadedRepositoryEpoch } from "../../src/foundation/repository/types.js";
import {
  currentRepositoryValidationSupport,
  validateLoadedHistoricalRepositorySnapshot,
  validateLoadedRepositorySnapshot,
  validateRepository,
} from "../../src/foundation/repository/validate.js";
import { selfDigest, sha256Bytes, type Sha256 } from "../../src/foundation/validation/canonical.js";
import { FOUNDATION_GENERATED_PUBLICATION_DIGEST } from "../../src/foundation/validation/generated-schemas.js";
import { DiagnosticCollector, validationResultDigest } from "../../src/foundation/validation/result.js";
import { writeMinimalAtlas } from "../helpers/atlas-fixture.js";

const SECRET = "repository-validation-secret-at-least-thirty-two-bytes";
const PUBLICATION_DIGEST = FOUNDATION_GENERATED_PUBLICATION_DIGEST;
const OBSERVED_AT = "2026-08-22T16:00:00.000Z";

async function write(root: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content, "utf8");
}

function blueprintDocument(): string {
  const frontMatter = {
    schema: "lifecycle.knowledge-record.v1",
    kind: "blueprint",
    id: "blueprint.repository-validation",
    title: "Repository validation architecture",
    status: "current",
    revision: 1,
    supersedes: null,
    summary: "Repository validation binds one exact target epoch.",
    owners: ["founder"],
    sources: [],
    relationships: [],
    conflicts: [],
    tags: [],
    spec: {
      decision: "Bind repository validation to one exact target epoch.",
      scope: ["repository validation"],
      components: ["epoch loader", "Knowledge compiler", "snapshot binder"],
      constraints: ["ambient worktree bytes cannot supply authority"],
      interfaces: ["repository-v7"],
      dataFlows: ["exact tree to Knowledge and repository result"],
      tradeoffs: ["recompilation favors exactness over speed"],
      evolution: [],
    },
  };
  return `---\n${JSON.stringify(frontMatter, null, 2)}\n---\n\n# Repository validation architecture\n\n## Decision\n\nExact epoch validation.\n\n## Structure\n\nLoader, compiler, and binder.\n\n## Tradeoffs\n\nExactness over speed.\n\n## Evolution\n\nFresh Foundation only.\n`;
}

async function knowledge(epoch: FoundationLoadedRepositoryEpoch, options: {
  valid?: boolean;
  publicationDigest?: Sha256;
  subjectKind?: string;
  subjectId?: string;
  subjectRevision?: string | number | null;
  subjectLocator?: string | null;
} = {}): Promise<FoundationKnowledgeSet> {
  const exact = await loadKnowledgeSet(epoch);
  if (Object.keys(options).length === 0) return exact;
  const collector = new DiagnosticCollector();
  if (options.valid === false) {
    collector.add({
      stage: "manifest",
      code: "lifecycle.knowledge.authority-conflict",
      message: "Test Knowledge Set is intentionally invalid",
    });
  }
  const repository = exact.manifest.repository;
  const manifestBase = {
    schema: "lifecycle.knowledge-set.v1" as const,
    specificationRevision: FOUNDATION_SPECIFICATION_REVISION,
    profile: "knowledge-set-v1" as const,
    repository,
    records: exact.manifest.records,
    relationships: exact.manifest.relationships,
    sources: exact.manifest.sources,
    conflicts: exact.manifest.conflicts,
    coverage: exact.manifest.coverage,
    exemptions: exact.manifest.exemptions,
    bindings: exact.manifest.bindings,
    complete: true,
    valid: options.valid !== false,
  };
  const manifest = Object.freeze({ ...manifestBase, digest: selfDigest(manifestBase as unknown as Record<string, unknown>) });
  const validation = collector.result({
    profile: "knowledge-set-v1",
    publicationDigest: options.publicationDigest ?? epoch.contract.specification.publicationDigest,
    subjectKind: options.subjectKind ?? "repository-knowledge",
    subjectId: options.subjectId ?? epoch.contract.targetId,
    subjectDigest: manifest.digest,
    subjectRevision: options.subjectRevision === undefined ? epoch.epoch.commit : options.subjectRevision,
    subjectLocator: options.subjectLocator ?? null,
    stages: ["manifest"],
    observedAt: OBSERVED_AT,
  });
  return Object.freeze({
    ...exact,
    validation,
    manifest,
  });
}

async function target(options: {
  canonicalBranch?: string;
  control?: Readonly<{ path: string; content: string }>;
  ignoreImplementation?: boolean;
  profileSelections?: readonly string[];
  providerDescriptorDigest?: Sha256;
  publicationDigest?: Sha256;
  runtimeCompatible?: string;
  specificationStatus?: "draft" | "accepted";
} = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-repository-validation-"));
  const home = await mkdtemp(join(tmpdir(), "lifecycle-repository-validation-home-"));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Lifecycle Test"]);
  await git(root, ["config", "user.email", "lifecycle@example.invalid"]);
  await writeMinimalAtlas(root);
  await write(root, "records/blueprint/repository-validation.md", blueprintDocument());
  await write(root, ".gitignore", options.ignoreImplementation ? "src/ignored.ts\n" : "node_modules/\n");
  const authority = await createFoundationAuthority(home, "repository-validation-target", SECRET);
  let contract = createRepositoryContract({
    targetId: "repository-validation-target",
    canonicalBranch: options.canonicalBranch ?? "refs/heads/main",
    authority,
    publicationDigest: options.publicationDigest ?? PUBLICATION_DIGEST,
    implementationRoots: options.ignoreImplementation ? ["src"] : [],
  });
  if (
    options.runtimeCompatible !== undefined ||
    options.profileSelections !== undefined ||
    options.providerDescriptorDigest !== undefined ||
    options.specificationStatus !== undefined
  ) {
    const mutable = structuredClone(contract) as unknown as Record<string, unknown>;
    if (options.runtimeCompatible !== undefined) {
      (mutable.runtime as Record<string, unknown>).compatible = options.runtimeCompatible;
    }
    if (options.profileSelections !== undefined) {
      (mutable.selections as Record<string, unknown>).profiles = [...options.profileSelections];
    }
    if (options.providerDescriptorDigest !== undefined) {
      (mutable.provider as Record<string, unknown>).defaultDescriptorDigest = options.providerDescriptorDigest;
    }
    if (options.specificationStatus !== undefined) {
      (mutable.specification as Record<string, unknown>).status = options.specificationStatus;
    }
    mutable.digest = selfDigest(mutable);
    contract = mutable as unknown as typeof contract;
  }
  await writeRepositoryContract(root, contract);
  if (options.control !== undefined) await write(root, options.control.path, options.control.content);
  await git(root, ["add", "--", "."]);
  await git(root, ["commit", "-m", "Create exact Foundation repository"]);
  return root;
}

test("repository-v7 composes exact Product State, resolved Atlas, Knowledge, and repository snapshot carriers", async () => {
  const root = await target();
  const epoch = await loadRepositoryEpoch(root);
  const basis = await knowledge(epoch);
  const loaded = await bindRepositorySnapshot(epoch, basis);
  const first = await validateLoadedRepositorySnapshot(loaded, {
    knowledge: basis,
    observedAt: OBSERVED_AT,
  });
  const second = await validateLoadedRepositorySnapshot(loaded, {
    knowledge: basis,
    observedAt: "2026-08-22T16:01:00.000Z",
  });
  assert.equal(first.profile, "repository-v7");
  assert.equal(first.complete, true);
  assert.equal(first.valid, true);
  assert.equal(first.subject.digest, loaded.snapshot.digest);
  assert.equal(first.digest, second.digest);
  assert.equal(first.publicationDigest, FOUNDATION_GENERATED_PUBLICATION_DIGEST);
  assert.equal(currentRepositoryValidationSupport().publicationDigest, FOUNDATION_GENERATED_PUBLICATION_DIGEST);
  assert.deepEqual(first.implementation.supportedProfiles, ["knowledge-set-v1", "knowledge-structural-v1", "repository-v7"]);
  const composed = await validateRepository(root, { observedAt: OBSERVED_AT });
  assert.equal(composed.complete, true, JSON.stringify(composed, null, 2));
  assert.equal(composed.valid, true);
  assert.equal(composed.subject.digest, loaded.snapshot.digest);

  const schemasRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../spec-source/schemas");
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false });
  for (const name of ["common", "capability-profile", "repository-contract", "product-state", "atlas-state", "atlas-resolution", "repository-snapshot"]) {
    ajv.addSchema(JSON.parse(await readFile(resolve(schemasRoot, `${name}.schema.json`), "utf8")));
  }
  const validateProduct = ajv.getSchema("urn:lifecycle:schema:product-state:v1");
  const validateAtlas = ajv.getSchema("urn:lifecycle:schema:atlas-state:v1");
  const validateAtlasResolution = ajv.getSchema("urn:lifecycle:schema:atlas-resolution:v2");
  const validateSnapshot = ajv.getSchema("urn:lifecycle:schema:repository-snapshot:v1");
  assert(validateProduct && validateAtlas && validateAtlasResolution && validateSnapshot);
  assert.equal(validateProduct(loaded.productState), true, JSON.stringify(validateProduct.errors));
  assert.equal(validateAtlas(loaded.atlasState), true, JSON.stringify(validateAtlas.errors));
  assert.equal(validateAtlasResolution(loaded.atlas.resolution), true, JSON.stringify(validateAtlasResolution.errors));
  assert.equal(loaded.atlas.resolution.atlasStateDigest, loaded.atlasState.digest);
  assert.equal(loaded.atlas.resolution.complete, true);
  assert.equal(loaded.atlas.resolution.valid, true);
  assert.equal(loaded.atlas.model.format, loaded.contract.atlas.selection.authoredFormat);
  assert.equal(loaded.snapshot.atlasResolutionDigest, loaded.atlas.resolution.digest);
  assert.equal(loaded.snapshot.atlasNormalizedModelDigest, loaded.atlas.resolution.normalizedModelDigest);
  assert.equal(validateSnapshot(loaded.snapshot), true, JSON.stringify(validateSnapshot.errors));
  const withoutContract = {
    entries: loaded.productState.entries.filter((entry) => entry.path !== ".lifecycle/repository.json"),
    digest: loaded.productState.digest,
  };
  assert.equal(validateProduct(withoutContract), false, "Product State must carry the exact repository contract entry");
  const wrongObjectLength = structuredClone(loaded.productState);
  (wrongObjectLength.entries[0] as { objectId: string }).objectId = "a".repeat(41);
  assert.equal(validateProduct(wrongObjectLength), false, "Git objects must contain exactly 40 or 64 hexadecimal digits");
});

test("repository-v7 refuses tracked, untracked, and ignored authoritative worktree bytes", async () => {
  const dirtyRoot = await target();
  await writeFile(join(dirtyRoot, "atlas", "atlas.md"), "# Dirty Atlas\n", "utf8");
  const dirtyEpoch = await loadRepositoryEpoch(dirtyRoot);
  const basis = await knowledge(dirtyEpoch);
  const dirtySnapshot = await bindRepositorySnapshot(dirtyEpoch, basis);
  const dirty = await validateLoadedRepositorySnapshot(dirtySnapshot, {
    knowledge: basis,
    observedAt: OBSERVED_AT,
  });
  assert.equal(dirty.complete, true);
  assert.equal(dirty.valid, false);
  assert(dirty.diagnostics.some((diagnostic) => diagnostic.code === "lifecycle.source.unbound"));

  const untrackedRoot = await target();
  await write(untrackedRoot, "atlas/untracked.md", "unbound\n");
  await assert.rejects(loadRepositoryEpoch(untrackedRoot), (error: unknown) => (
    error instanceof Error && "code" in error && error.code === "lifecycle.repository.untracked-authority"
  ));

  const ignoredRoot = await target({ ignoreImplementation: true });
  await write(ignoredRoot, "src/ignored.ts", "ignored authority\n");
  await assert.rejects(loadRepositoryEpoch(ignoredRoot), (error: unknown) => (
    error instanceof Error && "code" in error && error.code === "lifecycle.repository.untracked-authority"
  ));
});

test("historical validation requires the full authoritative worktree, including Atlas, to stay clean", async () => {
  const root = await target();
  const admitted = await loadRepositoryEpoch(root);
  const admittedKnowledge = await knowledge(admitted);

  await writeFile(join(root, "atlas", "atlas.md"), "invalid live Atlas\n", "utf8");
  const historical = await loadRepositoryEpochAtCommit(root, admitted.epoch.commit);
  const historicalSnapshot = await bindHistoricalRepositorySnapshot(
    historical,
    admittedKnowledge,
  );
  const atlasChanged = await validateLoadedHistoricalRepositorySnapshot(historicalSnapshot, {
    knowledge: admittedKnowledge,
    observedAt: OBSERVED_AT,
  });
  assert.equal(atlasChanged.valid, false);
  assert(atlasChanged.diagnostics.some(({ code }) => code === "lifecycle.source.unbound"));

  await write(root, "atlas/untracked-live.md", "untracked live Atlas\n");
  await assert.rejects(
    loadRepositoryEpochAtCommit(root, admitted.epoch.commit),
    (error: unknown) => error instanceof Error && "code" in error &&
      error.code === "lifecycle.repository.untracked-authority",
  );
});

test("repository-v7 rejects incompatible publication, runtime, profile, and Knowledge selections", async () => {
  const wrongPublicationRoot = await target({ publicationDigest: sha256Bytes("other-publication") });
  const wrongPublicationEpoch = await loadRepositoryEpoch(wrongPublicationRoot);
  const wrongPublicationBasis = await knowledge(wrongPublicationEpoch);
  const wrongPublication = await validateLoadedRepositorySnapshot(
    await bindRepositorySnapshot(wrongPublicationEpoch, wrongPublicationBasis),
    {
      knowledge: wrongPublicationBasis,
      observedAt: OBSERVED_AT,
    },
  );
  assert(wrongPublication.diagnostics.some((diagnostic) => diagnostic.code === "lifecycle.repository.contract-invalid"));

  const wrongStatusRoot = await target({ specificationStatus: "accepted" });
  const wrongStatusEpoch = await loadRepositoryEpoch(wrongStatusRoot);
  const wrongStatusBasis = await knowledge(wrongStatusEpoch);
  const wrongStatus = await validateLoadedRepositorySnapshot(
    await bindRepositorySnapshot(wrongStatusEpoch, wrongStatusBasis),
    {
      knowledge: wrongStatusBasis,
      observedAt: OBSERVED_AT,
    },
  );
  const wrongStatusDiagnostic = wrongStatus.diagnostics.find(
    (diagnostic) => diagnostic.code === "lifecycle.repository.contract-invalid",
  );
  assert(wrongStatusDiagnostic);
  assert("specification" in wrongStatusDiagnostic.facts);

  const wrongRuntimeRoot = await target({ runtimeCompatible: ">=2.0.0 <3.0.0" });
  await assert.rejects(
    loadRepositoryEpoch(wrongRuntimeRoot),
    (error: unknown) => error instanceof Error && "code" in error &&
      error.code === "lifecycle.schema.invalid",
  );
  const wrongRuntime = await validateRepository(wrongRuntimeRoot, { observedAt: OBSERVED_AT });
  assert.equal(wrongRuntime.complete, false);
  assert(wrongRuntime.diagnostics.some((diagnostic) => diagnostic.code === "lifecycle.schema.invalid"));

  const wrongProviderRoot = await target({ providerDescriptorDigest: sha256Bytes("other-provider-descriptor") });
  const wrongProviderEpoch = await loadRepositoryEpoch(wrongProviderRoot);
  const wrongProviderBasis = await knowledge(wrongProviderEpoch);
  const wrongProvider = await validateLoadedRepositorySnapshot(
    await bindRepositorySnapshot(wrongProviderEpoch, wrongProviderBasis),
    {
      knowledge: wrongProviderBasis,
      observedAt: OBSERVED_AT,
    },
  );
  const wrongProviderDiagnostic = wrongProvider.diagnostics.find(
    (diagnostic) => diagnostic.code === "lifecycle.repository.contract-invalid",
  );
  assert(wrongProviderDiagnostic);
  assert("provider" in wrongProviderDiagnostic.facts);

  const missingProfiles = await validateRepository(await target({ profileSelections: [] }), {
    observedAt: OBSERVED_AT,
  });
  assert.equal(missingProfiles.complete, false);
  assert.equal(missingProfiles.stages.find(({ id }) => id === "repository-contract")?.complete, false);
  assert(missingProfiles.diagnostics.some((diagnostic) =>
    diagnostic.code === "lifecycle.schema.invalid" || diagnostic.code === "lifecycle.repository.selection"));

  const root = await target();
  const epoch = await loadRepositoryEpoch(root);
  const basis = await knowledge(epoch);
  const loaded = await bindRepositorySnapshot(epoch, basis);
  const invalidBasis = await knowledge(epoch, { valid: false });
  await assert.rejects(bindRepositorySnapshot(epoch, invalidBasis), (error: unknown) => (
    error instanceof Error && "code" in error && error.code === "lifecycle.repository.knowledge-invalid"
  ));
  const invalidKnowledge = await validateLoadedRepositorySnapshot(loaded, {
    knowledge: invalidBasis,
    observedAt: OBSERVED_AT,
  });
  assert(invalidKnowledge.diagnostics.some((diagnostic) => diagnostic.code === "lifecycle.repository.knowledge-invalid"));
});

test("the pre-Knowledge epoch loader refuses branch and predecessor Control mismatch", async () => {
  const branchRoot = await target({ canonicalBranch: "refs/heads/not-main" });
  await assert.rejects(loadRepositoryEpoch(branchRoot), (error: unknown) => (
    error instanceof Error && "code" in error && error.code === "lifecycle.repository.branch-mismatch"
  ));
  const branchResult = await validateRepository(branchRoot, { observedAt: OBSERVED_AT });
  assert.equal(branchResult.complete, false);
  assert.equal(branchResult.subject.digest, null);
  assert(branchResult.diagnostics.some((diagnostic) => diagnostic.code === "lifecycle.repository.branch-mismatch"));

  const mixedRoot = await target();
  await write(mixedRoot, "records/control/delivery/work-boundaries/old.json", "{\"schema\":\"lifecycle.delivery-work-boundary.v3\"}\n");
  await git(mixedRoot, ["add", "--", "records/control/delivery/work-boundaries/old.json"]);
  await git(mixedRoot, ["commit", "-m", "Add predecessor Control"]);
  await assert.rejects(loadRepositoryEpoch(mixedRoot), (error: unknown) => (
    error instanceof Error && "code" in error && error.code === "lifecycle.repository.epoch-mixed"
  ));
});

test("repository snapshot binding refuses Knowledge built from another epoch", async () => {
  const root = await target();
  const epoch = await loadRepositoryEpoch(root);
  const otherRoot = await target();
  const otherEpoch = await loadRepositoryEpoch(otherRoot);
  const mismatched = await knowledge(otherEpoch);
  await assert.rejects(bindRepositorySnapshot(epoch, mismatched), (error: unknown) => (
    error instanceof Error && "code" in error && error.code === "lifecycle.repository.epoch-mixed"
  ));
});

test("repository snapshot binding recomputes the full Knowledge artifact and exact validation subject", async () => {
  const root = await target();
  const epoch = await loadRepositoryEpoch(root);
  const basis = await knowledge(epoch);
  const tampered = Object.freeze({
    ...basis,
    conflicts: Object.freeze([{
      type: "assurance-limit",
      leftId: "left",
      leftRevision: 1,
      leftFact: "left fact",
      rightId: "right",
      rightRevision: 1,
      rightFact: "right fact",
      digest: sha256Bytes("fabricated-conflict"),
    }]),
  }) as FoundationKnowledgeSet;
  await assert.rejects(bindRepositorySnapshot(epoch, tampered), (error: unknown) => (
    error instanceof Error && "code" in error && error.code === "lifecycle.repository.knowledge-invalid"
  ));
  await assert.rejects(bindRepositorySnapshot(epoch, await knowledge(epoch, { subjectKind: "knowledge-set" })), (error: unknown) => (
    error instanceof Error && "code" in error && error.code === "lifecycle.repository.knowledge-invalid"
  ));
  await assert.rejects(bindRepositorySnapshot(epoch, await knowledge(epoch, { subjectRevision: null })), (error: unknown) => (
    error instanceof Error && "code" in error && error.code === "lifecycle.repository.knowledge-invalid"
  ));
});

test("repository-v7 cannot bind self-consistent forged Knowledge validation stages and limits", async () => {
  const root = await target();
  const epoch = await loadRepositoryEpoch(root);
  const basis = await knowledge(epoch);
  const { digest: _digest, ...validationBase } = basis.validation;
  const forgedBase = {
    ...validationBase,
    stages: [{
      id: "manifest",
      complete: true,
      valid: true,
      diagnosticCount: 0,
      durationMs: 0,
    }],
    limits: { forgedRepositoryValidityBound: 1 },
  };
  const forgedValidation = Object.freeze({
    ...forgedBase,
    digest: validationResultDigest(forgedBase),
  });
  const forged = Object.freeze({
    ...basis,
    validation: forgedValidation,
  }) as FoundationKnowledgeSet;

  assert.equal(forged.validation.complete, true);
  assert.equal(forged.validation.valid, true);
  assert.equal(forged.validation.digest, validationResultDigest(forged.validation));
  assert.equal(forged.manifest.digest, basis.manifest.digest);
  assert.deepEqual(forged.validation.implementation, basis.validation.implementation);
  await assert.rejects(bindRepositorySnapshot(epoch, forged), (error: unknown) => (
    error instanceof Error && "code" in error && error.code === "lifecycle.repository.knowledge-invalid"
  ));
});

test("repository snapshot bind and result emission each re-inventory authoritative worktree state", async () => {
  const bindRoot = await target();
  const bindEpoch = await loadRepositoryEpoch(bindRoot);
  const bindKnowledge = await knowledge(bindEpoch);
  await write(bindRoot, "atlas/appeared-after-compilation.md", "unbound\n");
  await assert.rejects(bindRepositorySnapshot(bindEpoch, bindKnowledge), (error: unknown) => (
    error instanceof Error && "code" in error && error.code === "lifecycle.repository.untracked-authority"
  ));

  const resultRoot = await target();
  const resultEpoch = await loadRepositoryEpoch(resultRoot);
  const resultKnowledge = await knowledge(resultEpoch);
  const loaded = await bindRepositorySnapshot(resultEpoch, resultKnowledge);
  await writeFile(join(resultRoot, "atlas", "atlas.md"), "# Changed after binding\n", "utf8");
  const result = await validateLoadedRepositorySnapshot(loaded, {
    knowledge: resultKnowledge,
    observedAt: OBSERVED_AT,
  });
  assert.equal(result.complete, true);
  assert.equal(result.valid, false);
  assert(result.diagnostics.some((diagnostic) => diagnostic.code === "lifecycle.source.unbound"));
});

test("repository-v7 hard-cut epoch loading refuses every repository-visible Control carrier", async () => {
  const cases = [
    {
      path: "records/control/delivery/work-boundaries/wb.attempt-1.r1.json",
      content: '{"schema":"lifecycle.unknown-control.v1","attemptId":"attempt-1","targetId":"repository-validation-target","revision":1}\n',
      reason: "unknown-schema",
    },
    {
      path: "records/control/delivery/work-boundaries/wb.attempt-1.r1.json",
      content: '{"schema":"lifecycle.delivery-work-boundary.v1","attemptId":"attempt-1","targetId":"repository-validation-target","revision":1}\n',
      reason: "schema-invalid",
    },
    {
      path: "records/control/delivery/work-boundaries/arbitrary.json",
      content: '{"schema":"lifecycle.delivery-work-boundary.v1","attemptId":"attempt-1","targetId":"repository-validation-target","revision":1}\n',
      reason: "schema-locator-mismatch",
    },
  ] as const;
  for (const entry of cases) {
    const root = await target({ control: entry });
    await assert.rejects(
      () => loadRepositoryEpoch(root),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        error.code === "lifecycle.repository.epoch-mixed",
      `predecessor Control carrier was not refused for ${entry.reason}`,
    );
  }
});
