import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { FOUNDATION_SPECIFICATION_REVISION } from "../../src/foundation/constants.js";
import { compileProviderInputV4 } from "../../src/foundation/attempt/provider-input-v4.js";
import { compileControlRecordRevision } from "../../src/foundation/control/model.js";
import { FoundationError } from "../../src/foundation/error.js";
import { validateKnowledgeSet } from "../../src/foundation/knowledge/knowledge-set.js";
import type { FoundationKnowledgeSetResult } from "../../src/foundation/knowledge/types.js";
import { compileKnowledgeProjection } from "../../src/foundation/projection/compiler.js";
import {
  FOUNDATION_PROJECTION_COMPILER_IDENTITY,
  selectProjectionReachablePrefix,
} from "../../src/foundation/projection/orientation.js";
import { atlasResourceSourceId } from "../../src/foundation/projection/source-context.js";
import { projectionRepositoryEpochDigest } from "../../src/foundation/projection/request.js";
import type { FoundationCompiledProjection, FoundationOrientationProjectionRequest } from "../../src/foundation/projection/types.js";
import {
  materializeProjectionBundle,
  projectionBundleFiles,
  verifyCompiledProjection,
} from "../../src/foundation/projection/verification.js";
import { commandCheckBinding, initializeRepository } from "../../src/foundation/repository/initialize.js";
import { git } from "../../src/foundation/repository/git.js";
import {
  bindRepositorySnapshot,
  loadRepositoryEpoch,
  loadRepositoryEpochAtCommit,
} from "../../src/foundation/repository/snapshot.js";
import type { FoundationLoadedRepositoryEpoch } from "../../src/foundation/repository/types.js";
import { validateLoadedRepositorySnapshot } from "../../src/foundation/repository/validate.js";
import { canonicalJson, digestCanonical, selfDigest, sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { FOUNDATION_GENERATED_PUBLICATION_DIGEST } from "../../src/foundation/validation/generated-schemas.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";
import { MINIMAL_ATLAS_FILES, writeMinimalAtlas } from "../helpers/atlas-fixture.js";

const SECRET = "projection-test-secret-that-is-at-least-thirty-two-bytes";
const PUBLICATION_DIGEST = FOUNDATION_GENERATED_PUBLICATION_DIGEST;

function checkKnowledge(): string {
  const frontMatter = {
    schema: "lifecycle.knowledge-record.v1",
    kind: "check",
    id: "check.delivery-prepare",
    title: "Delivery preparation check",
    status: "current",
    revision: 1,
    supersedes: null,
    summary: "Observe the bounded preparation route.",
    owners: ["founder"],
    sources: [],
    relationships: [],
    conflicts: [],
    tags: [],
    spec: {
      proposition: "The preparation route compiles one exact Work Boundary.",
      subjects: [{ kind: "repository", selector: "." }],
      evidenceKinds: ["command"],
      requiredBindings: ["registered-unreferenced"],
      evaluation: {
        pass: "The preparation route is observed.",
        fail: "The preparation route is not observed.",
        indeterminate: "The observation is incomplete.",
        notRun: "The postcondition is not run at baseline.",
      },
      limits: ["This Check observes only the selected preparation route."],
      freshness: {
        subjectBinding: "exact",
        maximumAgeMs: null,
        environmentBinding: "exact",
      },
      falsifiers: ["The exact Work Boundary cannot be compiled."],
    },
  };
  const sections = ["Proposition", "Evaluation", "Evidence", "Limits"]
    .map((section) => `## ${section}\n\n${section} details.`)
    .join("\n\n");
  return `---\n${JSON.stringify(frontMatter, null, 2)}\n---\n\n# Delivery preparation check\n\n${sections}\n`;
}

async function write(root: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content, "utf8");
}

async function target(options: { implementation?: boolean; binding?: boolean; oversizedAtlasEntrypoint?: boolean; atlasResource?: boolean } = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-foundation-projection-"));
  const home = await mkdtemp(join(tmpdir(), "lifecycle-foundation-projection-home-"));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Lifecycle Test"]);
  await git(root, ["config", "user.email", "lifecycle@example.invalid"]);
  await writeMinimalAtlas(root);
  if (options.atlasResource) {
    const atlas = MINIMAL_ATLAS_FILES["atlas/atlas.md"].replace(
      "---\n\n# Target Atlas",
      `resources:
- id: architecture
  uri: sources/architecture.md
  title: Target architecture
  media-type: text/markdown
content:
- resource: architecture
---

# Target Atlas`,
    );
    await write(root, "atlas/atlas.md", atlas);
    await write(root, "atlas/sources/architecture.md", "# Target architecture\n\nThe exact Resource bytes reach the provider through the admitted Projection.\n");
  }
  if (options.oversizedAtlasEntrypoint) {
    await write(root, "atlas/atlas.md", `${MINIMAL_ATLAS_FILES["atlas/atlas.md"]}\n${"x".repeat(1024 * 1024)}\n`);
  }
  await git(root, ["add", "--", "atlas"]);
  await git(root, ["commit", "-m", "Initialize target"]);

  const binding = commandCheckBinding({
    id: "registered-unreferenced",
    checkIds: options.binding ? ["check.delivery-prepare"] : [],
    subjectSelectors: [{ kind: "repository", selector: "." }],
    executable: { relativeTo: "execution-image", path: "usr/bin/true" },
    allowedModalities: ["postcondition"],
  });
  await initializeRepository(root, {
    targetId: "projection-target",
    founderPrincipal: "founder",
    home,
    authoritySecret: SECRET,
    publicationDigest: PUBLICATION_DIGEST,
    implementationRoots: options.implementation ? ["src"] : [],
    checkBindings: options.binding ? { [binding.id]: binding } : {},
    stage: true,
  });
  if (options.binding) {
    await write(root, "records/checks/delivery-prepare.md", checkKnowledge());
  }
  if (options.implementation) await write(root, "src/application.ts", "export const application = true;\n");
  await git(root, ["add", "--", "."]);
  await git(root, ["commit", "-m", "Attach Lifecycle"]);
  return root;
}

function request(
  loaded: FoundationLoadedRepositoryEpoch,
  knowledge: FoundationKnowledgeSetResult,
  objective = "Understand the exact product before proposing work.",
): FoundationOrientationProjectionRequest {
  const observation = knowledge.observation;
  const base = {
    schema: "lifecycle.projection-request.v4" as const,
    class: "orientation" as const,
    role: "reconnaissance" as const,
    specificationRevision: FOUNDATION_SPECIFICATION_REVISION,
    target: { id: loaded.contract.targetId, generation: loaded.contract.generation },
    repository: {
      commit: loaded.epoch.commit,
      tree: loaded.epoch.tree,
      objectFormat: loaded.epoch.objectFormat,
      repositoryEpochDigest: projectionRepositoryEpochDigest(loaded),
      productStateDigest: loaded.productState.digest,
      repositoryContractDigest: loaded.contract.digest,
      repositorySnapshotDigest: null,
      validationDigest: null,
      complete: null,
      valid: null,
    },
    atlas: {
      root: loaded.contract.atlas.root,
      entrypoint: loaded.contract.atlas.entrypoint,
      specificationRevision: loaded.contract.atlas.selection.specificationRevision,
      processorRevision: loaded.contract.atlas.selection.processorRevision,
      stateDigest: loaded.atlasState.digest,
      resolutionDigest: loaded.atlas.resolution.digest,
      normalizedModelDigest: loaded.atlas.resolution.normalizedModelDigest,
      resourceBindingsDigest: loaded.atlas.resolution.resourceBindingsDigest,
      complete: true as const,
      valid: true as const,
    },
    knowledge: {
      knowledgeObservationDigest: observation.manifest.digest,
      knowledgeSetDigest: observation.validation.complete && observation.validation.valid ? observation.manifest.digest : null,
      knowledgeValidationDigest: observation.validation.digest,
      complete: observation.validation.complete,
      valid: observation.validation.valid,
    },
    profile: loaded.contract.projectionProfiles[loaded.contract.defaults.orientationProjectionProfileId]!,
    subject: { class: "orientation" as const, objective, objectiveDigest: sha256Bytes(Buffer.from(objective, "utf8")) },
    features: { historical: true, reachable: true },
    retrieval: { externalLocal: "denied" as const, network: "denied" as const, authoritySubjectDigest: null, sources: [] },
  };
  return Object.freeze({ ...base, digest: selfDigest(base) });
}

test("Orientation deterministically compiles exact indexes, every registered Binding, and immutable retrieval bytes", async () => {
  const root = await target({ binding: true });
  const epoch = await loadRepositoryEpoch(root);
  const knowledge = await validateKnowledgeSet(epoch);
  assert.equal(knowledge.validation.complete, true);
  assert.equal(knowledge.validation.valid, true);
  const projectionRequest = request(epoch, knowledge);

  const first = await compileKnowledgeProjection({ request: projectionRequest, repository: epoch, knowledge, observedAt: "2026-08-22T00:00:00.000Z" });
  const second = await compileKnowledgeProjection({ request: projectionRequest, repository: epoch, knowledge, observedAt: "2026-08-22T00:00:00.000Z" });
  assert.equal(first.validation.complete, true, canonicalJson(first.validation.diagnostics));
  assert.equal(first.validation.valid, true, canonicalJson(first.validation.diagnostics));
  assert(first.projection !== null);
  assert(second.projection !== null);
  assert.equal(canonicalJson(first.projection), canonicalJson(second.projection));
  assert.equal(first.projection.manifest.basis.repositorySnapshotDigest, null);
  assert.equal(first.projection.manifest.basis.repositoryValidationDigest, null);
  assert.equal(first.projection.manifest.basis.knowledgeObservationDigest, knowledge.observation.manifest.digest);
  assert.equal(first.projection.manifest.basis.knowledgeSetDigest, knowledge.knowledgeSet?.manifest.digest);
  assert.equal(
    first.projection.manifest.projectionId,
    `projection:${digestCanonical({ compilerDigest: FOUNDATION_PROJECTION_COMPILER_IDENTITY.digest, requestDigest: projectionRequest.digest }).slice("sha256:".length)}`,
  );

  const repositorySource = first.projection.manifest.sources.find((item) => item.id === "source.repository-context");
  assert(repositorySource !== undefined);
  assert.equal(first.projection.manifest.sources.some((item) => item.reference.startsWith("atlas/")), false);
  assert.deepEqual(first.projection.manifest.atlas.map(({ unitKind, unitId, mapId, pointId, recordKind }) => ({
    unitKind,
    unitId,
    mapId,
    pointId,
    recordKind,
  })), [
    { unitKind: "atlas", unitId: "target", mapId: null, pointId: null, recordKind: null },
    { unitKind: "map", unitId: "project", mapId: "project", pointId: null, recordKind: null },
    { unitKind: "point-anchor", unitId: "project-scope:project", mapId: "project", pointId: "project-scope", recordKind: "anchor" },
  ]);
  assert.deepEqual(repositorySource.semantic, {
    class: "source",
    subjectId: "source.repository-context",
    subjectDigest: repositorySource.digest,
    evidenceKind: null,
  });

  const bindingIndex = first.projection.manifest.core.class === "orientation"
    ? first.projection.manifest.core.bindingIndex.entries[0]
    : null;
  if (bindingIndex === null || bindingIndex === undefined) assert.fail("registered Binding is absent from the Orientation index");
  assert.equal(bindingIndex.id, "registered-unreferenced");
  assert.deepEqual(bindingIndex.checkIds, ["check.delivery-prepare"]);
  assert.equal(bindingIndex.binding.digest, bindingIndex.digest);
  const bindingItem = first.projection.manifest.bindings[0]!;
  assert.equal(bindingItem.id, "registered-unreferenced");
  assert.deepEqual(bindingItem.checkIds, ["check.delivery-prepare"]);
  assert.deepEqual(bindingItem.compatibleCheckIds, ["check.delivery-prepare"]);
  assert.deepEqual(bindingItem.binding, bindingIndex.binding);

  const projectedCheck = first.projection.manifest.mandatory.find((item) =>
    item.sourceIdentity === "check.delivery-prepare");
  assert(projectedCheck !== undefined);
  assert.equal(projectedCheck.kind, "check");
  assert.equal(projectedCheck.authority, "product-knowledge");
  assert.notEqual(projectedCheck.semanticDigest, null);
  assert.equal(
    first.projection.manifest.reachable.some(({ id }) => id === "check.delivery-prepare"),
    false,
  );
  const providerInput = compileProviderInputV4({
    projection: first.projection,
    operation: "delivery.prepare",
    roleSubjectDigest: sha256Bytes("orientation-current-knowledge-role-subject"),
    rootTokenSetDigest: sha256Bytes("orientation-current-knowledge-root-tokens"),
    capability: Object.freeze({
      candidateWrites: false,
      temporaryWrites: true,
      subprocesses: "none" as const,
      network: "none" as const,
      credentials: "none" as const,
      externalEffects: Object.freeze([]),
    }),
    founderSemanticMarkdown: "Orient to the current repository and propose a bounded delivery.\n",
  });
  const checkCitation = providerInput.citationRegistry.find(({ id }) => id === "check.delivery-prepare");
  assert(checkCitation !== undefined);
  assert.equal(checkCitation.kind, "knowledge");
  assert.equal(checkCitation.digest, projectedCheck.semanticDigest);
  assert.equal(checkCitation.authorityClass, "repository-authored");

  assert.equal(first.projection.manifest.reachable.some((entry) => entry.category === "atlas-context"), false);

  verifyCompiledProjection(first.projection);
  const files = projectionBundleFiles(first.projection);
  assert.equal(files.length, first.projection.inventory.length);
  assert(
    first.projection.inventory
      .filter((entry) => entry.tier === "mandatory")
      .every((entry) => entry.path.startsWith("projection/material/")),
  );
  const materialized: string[] = [];
  await materializeProjectionBundle(first.projection, async (entry) => { materialized.push(entry.path); });
  assert.deepEqual(materialized, files.map((entry) => entry.path));
  const firstInventory = first.projection.inventory[0]!;
  const corrupt = {
    ...first.projection,
    inventory: [{ ...firstInventory, bytes: Buffer.from("corrupt").toString("base64") }, ...first.projection.inventory.slice(1)],
  };
  assert.throws(() => verifyCompiledProjection(corrupt), /corrupt|digest/u);
});

test("Orientation binds an exactly referenced Atlas Resource as provider-readable source bytes", async () => {
  const root = await target({ atlasResource: true });
  const epoch = await loadRepositoryEpoch(root);
  const knowledge = await validateKnowledgeSet(epoch);
  const result = await compileKnowledgeProjection({ request: request(epoch, knowledge), repository: epoch, knowledge });
  assert.equal(result.validation.valid, true, canonicalJson(result.validation.diagnostics));
  assert(result.projection !== null);

  const sourceId = atlasResourceSourceId(epoch.atlas.model.atlas.id, "architecture");
  const source = result.projection.manifest.sources.find(({ id }) => id === sourceId);
  assert(source !== undefined);
  assert.equal(source.authority, "atlas");
  assert.equal(source.reference, "atlas/sources/architecture.md");
  assert.equal(source.digest, epoch.atlas.resolution.resourceBindings[0]?.byteDigest);
  assert.deepEqual(source.semantic, {
    class: "source",
    subjectId: sourceId,
    subjectDigest: source.digest,
    evidenceKind: null,
  });
  assert(result.projection.manifest.atlas.some(({ unitKind, unitId }) =>
    unitKind === "resource" && unitId === "architecture"));

  const providerInput = compileProviderInputV4({
    projection: result.projection,
    operation: "delivery.prepare",
    roleSubjectDigest: sha256Bytes("atlas-resource-role-subject"),
    rootTokenSetDigest: sha256Bytes("atlas-resource-root-token-set"),
    capability: Object.freeze({
      candidateWrites: false,
      temporaryWrites: true,
      subprocesses: "none" as const,
      network: "none" as const,
      credentials: "none" as const,
      externalEffects: Object.freeze([]),
    }),
    founderSemanticMarkdown: "Use the exact Atlas Resource while proposing the Boundary.\n",
  });
  const citation = providerInput.citationRegistry.find(({ id }) => id === sourceId);
  assert(citation !== undefined);
  const projected = providerInput.contents.find(({ path }) => path === citation.locator);
  assert(projected !== undefined);
  assert.deepEqual(
    Buffer.from(projected.bytes),
    Buffer.from("# Target architecture\n\nThe exact Resource bytes reach the provider through the admitted Projection.\n", "utf8"),
  );
});

test("historical Projection source resolution keeps admitted Atlas Resource bytes after canonical Atlas advances", async () => {
  const root = await target({ atlasResource: true });
  const admitted = await loadRepositoryEpoch(root);
  await write(
    root,
    "atlas/sources/architecture.md",
    "# Target architecture\n\nA later Founder-managed Atlas revision must not replace admitted context.\n",
  );
  await git(root, ["add", "--", "atlas/sources/architecture.md"]);
  await git(root, ["commit", "-m", "Advance Founder-managed Atlas"]);
  const current = await loadRepositoryEpoch(root);
  assert.notEqual(current.atlasState.digest, admitted.atlasState.digest);

  const historical = await loadRepositoryEpochAtCommit(root, admitted.epoch.commit);
  const knowledge = await validateKnowledgeSet(historical);
  const result = await compileKnowledgeProjection({
    request: request(historical, knowledge),
    repository: historical,
    knowledge,
  });
  assert.equal(result.validation.valid, true, canonicalJson(result.validation.diagnostics));
  assert(result.projection !== null);
  assert.equal(result.projection.manifest.basis.atlas.stateDigest, admitted.atlasState.digest);
  assert.notEqual(result.projection.manifest.basis.atlas.stateDigest, current.atlasState.digest);

  const providerInput = compileProviderInputV4({
    projection: result.projection,
    operation: "delivery.prepare",
    roleSubjectDigest: sha256Bytes("historical-atlas-resource-role-subject"),
    rootTokenSetDigest: sha256Bytes("historical-atlas-resource-root-token-set"),
    capability: Object.freeze({
      candidateWrites: false,
      temporaryWrites: true,
      subprocesses: "none" as const,
      network: "none" as const,
      credentials: "none" as const,
      externalEffects: Object.freeze([]),
    }),
    founderSemanticMarkdown: "Use only the Atlas Resource bytes admitted with this context.\n",
  });
  const sourceId = atlasResourceSourceId(historical.atlas.model.atlas.id, "architecture");
  const citation = providerInput.citationRegistry.find(({ id }) => id === sourceId);
  assert(citation !== undefined);
  const projected = providerInput.contents.find(({ path }) => path === citation.locator);
  assert(projected !== undefined);
  assert.deepEqual(
    Buffer.from(projected.bytes),
    Buffer.from(
      "# Target architecture\n\nThe exact Resource bytes reach the provider through the admitted Projection.\n",
      "utf8",
    ),
  );
});

test("Orientation reports an invalid partial Knowledge observation without claiming a usable Knowledge Set", async () => {
  const root = await target({ implementation: true });
  const epoch = await loadRepositoryEpoch(root);
  const knowledge = await validateKnowledgeSet(epoch);
  assert.equal(knowledge.validation.complete, true);
  assert.equal(knowledge.validation.valid, false);
  assert.equal(knowledge.knowledgeSet, null);
  assert(knowledge.validation.diagnostics.some((diagnostic) => diagnostic.code === "lifecycle.description.coverage-missing"));

  const compiled = await compileKnowledgeProjection({ request: request(epoch, knowledge), repository: epoch, knowledge });
  assert.equal(compiled.validation.complete, true, canonicalJson(compiled.validation.diagnostics));
  assert.equal(compiled.validation.valid, true, canonicalJson(compiled.validation.diagnostics));
  assert(compiled.projection !== null);
  assert.equal(compiled.projection.manifest.basis.knowledgeObservationDigest, knowledge.observation.manifest.digest);
  assert.equal(compiled.projection.manifest.basis.knowledgeSetDigest, null);
  assert.equal(compiled.projection.manifest.basis.repositorySnapshotDigest, null);
  assert.equal(compiled.projection.manifest.core.class, "orientation");
  assert(compiled.projection.manifest.core.class === "orientation" &&
    compiled.projection.manifest.core.conditions.some((condition) => condition.code === "lifecycle.description.coverage-missing"));
  assert(compiled.projection.manifest.core.class === "orientation" &&
    compiled.projection.manifest.core.coverageIndex.summary.missingItems === 1);
});

test("Orientation rejects a prior-commit Knowledge observation from the same repository", async () => {
  const root = await target();
  const priorEpoch = await loadRepositoryEpoch(root);
  const priorKnowledge = await validateKnowledgeSet(priorEpoch);
  await write(root, "atlas/maps/project/points/project-scope.md", `${MINIMAL_ATLAS_FILES["atlas/maps/project/points/project-scope.md"]}\nThe current Atlas meaning advanced.\n`);
  await git(root, ["add", "--", "atlas/maps/project/points/project-scope.md"]);
  await git(root, ["commit", "-m", "Advance exact repository epoch"]);
  const currentEpoch = await loadRepositoryEpoch(root);

  const compiled = await compileKnowledgeProjection({
    request: request(currentEpoch, priorKnowledge),
    repository: currentEpoch,
    knowledge: priorKnowledge,
  });
  assert.equal(compiled.validation.valid, false);
  assert.equal(compiled.projection, null);
  assert(compiled.validation.diagnostics.some((diagnostic) => diagnostic.code === "lifecycle.projection.basis-mismatch"));
});

test("the common compiler publishes bounded descriptors instead of captured command bytes", async () => {
  const root = await target();
  const epoch = await loadRepositoryEpoch(root);
  const knowledge = await validateKnowledgeSet(epoch);
  const stderrBytes = Buffer.from("fatal: private path /private/tmp/projection-secret\n", "utf8");
  const stdoutBytes = Buffer.from("private command output", "utf8");
  const pathBytes = new Uint8Array([0x2f, 0x70, 0x72, 0x69, 0x76, 0x61, 0x74, 0x65]);
  const failingRequest = new Proxy(request(epoch, knowledge), {
    get(value, property, receiver) {
      if (property === "schema") {
        throw new FoundationError("command.failed", "Synthetic command failure", {
          observedFacts: {
            exitCode: 128,
            signal: null,
            stderr: stderrBytes.toString("utf8"),
            stderrBytes,
            stdout: stdoutBytes,
            nested: { pathBytes },
            stderrTruncated: false,
            stdoutTruncated: false,
          },
        });
      }
      return Reflect.get(value, property, receiver);
    },
  });

  const compiled = await compileKnowledgeProjection({ request: failingRequest, repository: epoch, knowledge });
  assert.equal(compiled.projection, null);
  assert.equal(compiled.validation.valid, false);
  const diagnostic = compiled.validation.diagnostics.find((entry) => entry.code === "lifecycle.projection.compiler-failure");
  assert(diagnostic !== undefined);
  assert.equal(diagnostic.message, "Projection compilation failed during closure");
  assert.deepEqual(diagnostic.facts, {
    exitCode: 128,
    nested: { pathBytes: { byteLength: pathBytes.byteLength, digest: sha256Bytes(pathBytes) } },
    signal: null,
    stderr: { byteLength: stderrBytes.byteLength, digest: sha256Bytes(stderrBytes) },
    stderrBytes: { byteLength: stderrBytes.byteLength, digest: sha256Bytes(stderrBytes) },
    stderrTruncated: false,
    stdout: { byteLength: stdoutBytes.byteLength, digest: sha256Bytes(stdoutBytes) },
    stdoutTruncated: false,
  });
  assert.doesNotMatch(canonicalJson(diagnostic), /(?:private path|projection-secret|private command output)/u);
});

test("reachable bounds take the longest prefix independently within each schema category", () => {
  const selected = selectProjectionReachablePrefix([
    { id: "atlas-a-too-large", category: "atlas-context" as const, sourceRevision: "1", byteLength: 11 },
    { id: "atlas-z-after-stop", category: "atlas-context" as const, sourceRevision: "2", byteLength: 1 },
    { id: "knowledge-small", category: "related-knowledge" as const, sourceRevision: "1", byteLength: 2 },
    { id: "description-small", category: "neighboring-description" as const, sourceRevision: "1", byteLength: 2 },
  ], { maximumReachableItems: 4, maximumReachableBytes: 10 });
  assert.deepEqual(selected.map((entry) => entry.id), ["knowledge-small", "description-small"]);
});

test("Orientation returns a typed incomplete Validation Result when exact Tier-2 bytes exceed the profile", async () => {
  const root = await target({ oversizedAtlasEntrypoint: true });
  const epoch = await loadRepositoryEpoch(root);
  const knowledge = await validateKnowledgeSet(epoch);
  const compiled = await compileKnowledgeProjection({ request: request(epoch, knowledge), repository: epoch, knowledge });
  assert.equal(compiled.projection, null);
  assert.equal(compiled.validation.valid, false);
  assert.equal(compiled.validation.complete, false);
  const diagnostic = compiled.validation.diagnostics.find((entry) => entry.code === "lifecycle.projection.mandatory-too-large");
  assert(diagnostic !== undefined);
  assert(Array.isArray(diagnostic.facts.oversized));
  const oversized = diagnostic.facts.oversized as readonly Readonly<{ id: string; bytes: number }>[];
  assert.equal(oversized.length, 1);
  assert.match(oversized[0]!.id, /^atlas\.atlas\./u);
  assert(oversized[0]!.bytes > epoch.contract.projectionProfiles[epoch.contract.defaults.orientationProjectionProfileId]!.maximumItemBytes);
  assert.equal(compiled.validation.limits.observedMandatoryBytes, diagnostic.facts.mandatoryBytes);
  assert.equal(compiled.validation.stages.find((stage) => stage.id === "content")?.complete, true);
  assert.equal(compiled.validation.stages.find((stage) => stage.id === "bounds")?.complete, false);
});

test("the common compiler emits one exact verified builder Execution Projection", async () => {
  const root = await target();
  const epoch = await loadRepositoryEpoch(root);
  const knowledgeResult = await validateKnowledgeSet(epoch);
  if (knowledgeResult.knowledgeSet === null) assert.fail("empty exact Knowledge Set is invalid");
  const loaded = await bindRepositorySnapshot(epoch, knowledgeResult.knowledgeSet);
  const repositoryValidation = await validateLoadedRepositorySnapshot(loaded, { knowledge: knowledgeResult.knowledgeSet });
  assert.equal(repositoryValidation.valid, true, canonicalJson(repositoryValidation.diagnostics));
  const boundaryDigest = sha256Bytes("empty-builder-boundary");
  const candidate = Object.freeze({
    baseCommit: loaded.epoch.commit,
    revision: Object.freeze({
      kind: "candidate-revision" as const,
      id: "candidate.projection-orientation-builder",
      revision: 1,
      digest: sha256Bytes("candidate.projection-orientation-builder"),
    }),
    stateDigest: sha256Bytes("empty-builder-candidate"),
    carrierManifestDigest: sha256Bytes("empty-builder-candidate-carrier-manifest"),
    sealedTree: null,
    seal: null,
  });
  const requestBase = {
    schema: "lifecycle.projection-request.v4" as const,
    class: "execution" as const,
    role: "builder" as const,
    specificationRevision: FOUNDATION_SPECIFICATION_REVISION,
    target: { id: loaded.contract.targetId, generation: loaded.contract.generation },
    repository: {
      commit: loaded.snapshot.commit,
      tree: loaded.snapshot.tree,
      objectFormat: loaded.snapshot.objectFormat,
      repositoryEpochDigest: projectionRepositoryEpochDigest(loaded),
      productStateDigest: loaded.snapshot.productStateDigest,
      repositoryContractDigest: loaded.snapshot.contractDigest,
      repositorySnapshotDigest: loaded.snapshot.digest,
      validationDigest: repositoryValidation.digest,
      complete: true,
      valid: true,
    },
    atlas: {
      root: loaded.contract.atlas.root,
      entrypoint: loaded.contract.atlas.entrypoint,
      specificationRevision: loaded.contract.atlas.selection.specificationRevision,
      processorRevision: loaded.contract.atlas.selection.processorRevision,
      stateDigest: loaded.snapshot.atlasStateDigest,
      resolutionDigest: loaded.snapshot.atlasResolutionDigest,
      normalizedModelDigest: loaded.snapshot.atlasNormalizedModelDigest,
      resourceBindingsDigest: loaded.atlas.resolution.resourceBindingsDigest,
      complete: true as const,
      valid: true as const,
    },
    knowledge: {
      knowledgeObservationDigest: knowledgeResult.knowledgeSet.manifest.digest,
      knowledgeSetDigest: knowledgeResult.knowledgeSet.manifest.digest,
      knowledgeValidationDigest: knowledgeResult.knowledgeSet.validation.digest,
      complete: true,
      valid: true,
    },
    profile: loaded.contract.projectionProfiles[loaded.contract.defaults.executionProjectionProfileId]!,
    subject: {
      class: "execution" as const,
      workBoundary: { id: "boundary.empty-builder", revision: 1, digest: boundaryDigest },
      candidate,
    },
    features: { historical: false, reachable: false },
    retrieval: { externalLocal: "denied" as const, network: "denied" as const, authoritySubjectDigest: null, sources: [] },
  };
  const projectionRequest = Object.freeze({ ...requestBase, digest: selfDigest(requestBase) });
  const capability = loaded.contract.capabilityProfiles[loaded.contract.defaults.capabilityProfileId]!;
  const core = Object.freeze({
    class: "execution" as const,
    objective: "Execute the exact empty boundary.",
    selectedMeaning: "The authenticated boundary carries the selected meaning.",
    included: ["the authenticated boundary"],
    excluded: ["unadmitted work"],
    assumptions: [],
    falsifiers: ["the boundary identity changes"],
    obligations: [{ id: "obligation.empty-builder", kind: "acceptance" as const, statement: "Preserve the exact boundary.", sourceIds: [], requiredEvidenceIds: [] }],
    requiredArtifacts: [],
    effects: [],
    risks: [],
    checks: [],
    propositions: [{ id: "proposition.empty-builder", claim: "The exact boundary is preserved.", evidenceKinds: ["analysis" as const], evidenceIds: [], obligationIds: ["obligation.empty-builder"], effectIds: [], riskIds: [], path: null, checkId: null, allowNotApplicable: false, notApplicableCondition: null }],
    capability: { profileId: capability.id, profileDigest: capability.digest },
    capabilitySummary: "No candidate material is selected by this compiler fixture.",
    prohibitedEffects: ["unadmitted repository mutation"],
    materialConditionPolicy: "Return a Material Condition if the exact boundary changes.",
    completionReturnRules: ["Return only against the exact bound subject."],
    requestDigest: projectionRequest.digest,
    workBoundaryDigest: boundaryDigest,
  });
  const subjectBase = {
    workBoundary: projectionRequest.subject.workBoundary,
    core,
    knowledgeRoots: [],
    implementationRoots: [],
    sourceRoots: [],
    candidate,
  };
  const workBoundaryPayload = validDeliveryControlPayload("work-boundary");
  const workBoundary = compileControlRecordRevision("delivery.projection-orientation-builder", {
    recordId: projectionRequest.subject.workBoundary.id,
    recordKind: "work-boundary",
    revision: projectionRequest.subject.workBoundary.revision,
    producer: Object.freeze({ kind: "runtime", id: "runtime.projection-test" }),
    semanticAuthor: Object.freeze({ kind: "runtime", id: "runtime.projection-test" }),
    semanticAuthority: "runtime-derived",
    createdAt: "2026-08-22T00:00:00.000Z",
    semanticMarkdown: "# Work Boundary\n\nExecute the exact empty boundary.\n",
    payload: Object.freeze({
      ...workBoundaryPayload,
      targetId: loaded.contract.targetId,
      basis: Object.freeze({
        specificationRevision: loaded.contract.specification.revision,
        repositoryContract: "lifecycle.repository.v15",
        providerAdapter: "lifecycle.provider-adapter.v6",
        productBaseCommit: loaded.snapshot.commit,
        productBaseTree: loaded.snapshot.tree,
        productStateDigest: loaded.snapshot.productStateDigest,
        atlasStateDigest: loaded.snapshot.atlasStateDigest,
        atlasResolutionDigest: loaded.snapshot.atlasResolutionDigest,
        atlasNormalizedModelDigest: loaded.snapshot.atlasNormalizedModelDigest,
        atlasResourceBindingsDigest: loaded.snapshot.atlasResourceBindingsDigest,
        repositoryContractDigest: loaded.snapshot.contractDigest,
        knowledgeSetDigest: knowledgeResult.knowledgeSet.manifest.digest,
        repositorySnapshotDigest: loaded.snapshot.digest,
      }),
    }),
    relationships: Object.freeze([
      Object.freeze({
        relation: "uses-brief",
        target: Object.freeze({
          kind: "founder-brief",
          id: "brief.projection-orientation-builder",
          revision: 1,
          digest: sha256Bytes("brief.projection-orientation-builder"),
        }),
      }),
      Object.freeze({
        relation: "proposed-from",
        target: Object.freeze({
          kind: "agent-work-product",
          id: "work-product.projection-orientation-builder",
          revision: 1,
          digest: sha256Bytes("work-product.projection-orientation-builder"),
        }),
      }),
    ]),
  });
  const reboundRequestBase = {
    ...projectionRequest,
    subject: Object.freeze({
      ...projectionRequest.subject,
      workBoundary: Object.freeze({
        kind: "work-boundary" as const,
        id: workBoundary.recordId,
        revision: workBoundary.revision,
        digest: workBoundary.digest,
      }),
    }),
  };
  const { digest: _oldRequestDigest, ...reboundRequestFields } = reboundRequestBase;
  const reboundRequest = Object.freeze({
    ...reboundRequestFields,
    digest: selfDigest(reboundRequestFields),
  });
  const reboundCore = Object.freeze({
    ...core,
    requestDigest: reboundRequest.digest,
    workBoundaryDigest: workBoundary.digest,
  });
  const reboundSubjectBase = {
    ...subjectBase,
    workBoundary: reboundRequest.subject.workBoundary,
    core: reboundCore,
    candidate: reboundRequest.subject.candidate,
  };
  const reboundSubject = Object.freeze({
    ...reboundSubjectBase,
    subjectDigest: digestCanonical(reboundSubjectBase),
  });
  const result = await compileKnowledgeProjection({
    request: reboundRequest,
    repository: loaded,
    repositoryValidation,
    knowledge: knowledgeResult.knowledgeSet,
    subject: reboundSubject,
    workBoundary,
  });
  assert.equal(result.validation.complete, true, canonicalJson(result.validation.diagnostics));
  assert.equal(result.validation.valid, true, canonicalJson(result.validation.diagnostics));
  assert(result.projection !== null);
  assert.equal(result.projection.manifest.class, "execution");
  assert.equal(result.projection.manifest.basis.repositorySnapshotDigest, loaded.snapshot.digest);
  verifyCompiledProjection(result.projection);
  if (result.projection.manifest.core.class !== "execution") assert.fail("Execution Projection has an Orientation core");
  assert.deepEqual(result.projection.manifest.core.capability, {
    profileId: capability.id,
    profileDigest: capability.digest,
  });
  assert.deepEqual(result.projection.manifest.core.propositions, [{
    id: "proposition.empty-builder",
    claim: "The exact boundary is preserved.",
    evidenceKinds: ["analysis"],
    evidenceIds: [],
    obligationIds: ["obligation.empty-builder"],
    effectIds: [],
    riskIds: [],
    path: null,
    checkId: null,
    allowNotApplicable: false,
    notApplicableCondition: null,
  }]);
  const tampered = (field: "requestDigest" | "workBoundaryDigest") => {
    const { digest: _digest, ...manifestSubject } = result.projection!.manifest;
    const manifestBase = {
      ...manifestSubject,
      core: {
        ...result.projection!.manifest.core,
        [field]: sha256Bytes(`wrong-${field}`),
      },
    };
    return {
      ...result.projection!,
      manifest: { ...manifestBase, digest: selfDigest(manifestBase) },
    } as FoundationCompiledProjection;
  };
  for (const field of ["requestDigest", "workBoundaryDigest"] as const) {
    assert.throws(
      () => verifyCompiledProjection(tampered(field)),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "lifecycle.projection.basis-mismatch",
    );
  }
});
