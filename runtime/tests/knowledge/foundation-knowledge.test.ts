import { receiveFoundationAuthorityCredential } from "../../src/foundation/repository/authority.js";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createFoundationAuthority } from "../../src/foundation/repository/authority.js";
import { commandCheckBinding, initializeRepository } from "../../src/foundation/repository/initialize.js";
import { git, objectBlobBytes } from "../../src/foundation/repository/git.js";
import { selfDigest, sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { loadKnowledgeSet, restoreFoundationKnowledgeSetIndex, validateKnowledgeSet } from "../../src/foundation/knowledge/knowledge-set.js";
import { publishCandidateRevisionCarrierFromGitTree } from "../../src/foundation/candidate/carrier-binding.js";
import { importCandidateRevisionCarrierIntoRepository } from "../../src/foundation/candidate/carrier-import.js";
import { expectedKnowledgeKind, parseKnowledgeRecord } from "../../src/foundation/knowledge/records.js";
import { inspectFoundationKnowledgeDraft } from "../../src/foundation/draft/knowledge.js";
import { createRepositoryContract } from "../../src/foundation/repository/contract.js";
import { bindHistoricalRepositorySnapshot, bindRepositorySnapshot, loadRepositoryEpoch, loadRepositoryEpochAtCommit } from "../../src/foundation/repository/snapshot.js";
import { writeMinimalAtlas } from "../helpers/atlas-fixture.js";
import { foundationDisciplineAdoptionFixture, TEST_DISCIPLINE_PATH } from "../helpers/foundation-discipline-fixture.js";

const SECRET = "knowledge-test-secret-that-is-at-least-thirty-two-bytes";
const PUBLICATION_DIGEST = sha256Bytes("knowledge-test-publication");

type Relationship = Readonly<{ type: string; target: string; required: boolean; scope?: string; rationale?: string }>;

const SECTIONS = {
  behavior: ["Meaning", "Boundaries", "Examples", "Rationale"],
  assurance: ["Obligation", "Failure Model", "Limits", "Rationale"],
  blueprint: ["Decision", "Structure", "Tradeoffs", "Evolution"],
  description: ["Responsibility", "Behavior", "Boundaries", "Rationale"],
  check: ["Proposition", "Evaluation", "Evidence", "Limits"],
  discipline: ["Practice", "Applicability", "Guidance", "Verification"],
} as const;

function spec(kind: keyof typeof SECTIONS, coveragePath = "src/parser.ts"): Record<string, unknown> {
  switch (kind) {
    case "behavior": return {
      outcome: "Arbitrary parser input produces a bounded result.",
      actors: ["caller"], conditions: [], included: ["parse arbitrary bytes"], excluded: ["execute input"], examples: ["empty input"], falsifiers: ["process crash"],
    };
    case "assurance": return {
      obligation: "Parser input cannot crash the process.", scope: ["parser entrypoint"], failureModes: ["uncaught exception"], limits: ["campaign cannot prove absence of every defect"], degradation: [], falsifiers: ["crash"],
    };
    case "blueprint": return {
      decision: "All bytes enter through parse.", scope: ["parser"], components: ["parser"], constraints: ["one public input boundary"], interfaces: ["parse"], dataFlows: ["bytes to result"], tradeoffs: ["single boundary over specialized paths"], evolution: [],
    };
    case "description": return {
      responsibility: "Own parser input conversion.", coverage: [{ path: coveragePath, mode: "file", role: "primary", exclude: [] }], behavior: ["returns a result"], boundaries: ["does not execute input"], invariants: ["never throws"], dependencies: [], failure: ["returns an error"], rationale: ["one implementation unit"],
    };
    case "check": return {
      proposition: "A bounded fuzz campaign observes no parser crash.", subjects: [{ kind: "candidate", selector: "src/parser.ts" }], evidenceKinds: ["command"], requiredBindings: ["parser-fuzz"], evaluation: { pass: "campaign completes", fail: "crash observed", indeterminate: "campaign facts absent", notRun: "not executed" }, limits: ["one campaign is finite"], freshness: { subjectBinding: "exact", maximumAgeMs: null, environmentBinding: "exact" }, falsifiers: ["crash"],
    };
    case "discipline": return {
      practice: "Keep Go review changes small and directly testable.",
      appliesWhen: ["reviewing Go implementation changes"],
      doesNotApplyWhen: ["the repository contains no Go work"],
      guidance: ["Prefer focused tests near the changed behavior."],
      verification: ["Inspect the diff and focused test result."],
    };
  }
}

function document(options: {
  kind: keyof typeof SECTIONS;
  id: string;
  title: string;
  relationships?: readonly Relationship[];
  coveragePath?: string;
  sources?: readonly unknown[];
  owners?: readonly string[];
}): string {
  const frontMatter = {
    schema: "lifecycle.knowledge-record.v2",
    kind: options.kind,
    id: options.id,
    title: options.title,
    status: "current",
    revision: 1,
    supersedes: null,
    summary: `${options.title} summary.`,
    owners: options.owners ?? ["director"],
    sources: options.sources ?? [],
    relationships: options.relationships ?? [],
    conflicts: [],
    tags: [],
    spec: spec(options.kind, options.coveragePath),
  };
  return `---\n${JSON.stringify(frontMatter, null, 2)}\n---\n\n# ${options.title}\n\n${SECTIONS[options.kind].map((section) => `## ${section}\n\n${section} details.`).join("\n\n")}\n`;
}

async function write(root: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content, "utf8");
}

function replaceFrontMatter(input: string, fields: Record<string, unknown>): string {
  const original = input.split("---\n")[1]!;
  return input.replace(original, `${JSON.stringify({ ...JSON.parse(original) as Record<string, unknown>, ...fields }, null, 2)}\n`);
}

async function adoptPublisherRevision(root: string, revision: number, predecessor?: ReturnType<typeof parseKnowledgeRecord>) {
  const epoch = await loadRepositoryEpoch(root);
  const fixture = foundationDisciplineAdoptionFixture(epoch.contract);
  const document = replaceFrontMatter(fixture.document, {
    revision,
    supersedes: revision === 1 ? null : {
      id: fixture.record.frontMatter.id,
      revision: revision - 1,
      sourceDigest: predecessor?.sourceDigest ?? sha256Bytes(`publisher source revision ${revision - 1}`),
      semanticDigest: predecessor?.semanticDigest ?? sha256Bytes(`publisher meaning revision ${revision - 1}`),
    },
  }).replaceAll("Prefer", `Revision ${revision} practice: prefer`);
  const record = parseKnowledgeRecord({ path: TEST_DISCIPLINE_PATH, mode: "100644", objectId: "a".repeat(40), bytes: Buffer.from(document), contract: epoch.contract });
  const registrySubject = {
    ...fixture.registry,
    packs: fixture.registry.packs.map((pack) => ({ ...pack, revision: `publisher-release-${revision}`, version: `${revision}.0.0`, manifestDigest: sha256Bytes(`publisher manifest ${revision}`) })),
    adoptions: [{ ...fixture.registry.adoptions[0]!, revision, sourceDigest: record.sourceDigest, semanticDigest: record.semanticDigest }],
  };
  const registry = { ...registrySubject, digest: selfDigest(registrySubject) };
  await write(root, TEST_DISCIPLINE_PATH, document);
  await write(root, epoch.contract.knowledge.roots.disciplineRegistry, `${JSON.stringify(registry, null, 2)}\n`);
  await git(root, ["add", "--", "records/disciplines"]);
  await git(root, ["commit", "-m", `Adopt exact publisher Discipline revision ${revision}`]);
  return { document, record, registry };
}

async function target(): Promise<{ root: string; home: string }> {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-foundation-knowledge-"));
  const home = await mkdtemp(join(tmpdir(), "lifecycle-foundation-home-"));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Lifecycle Test"]);
  await git(root, ["config", "user.email", "lifecycle@example.invalid"]);
  await writeMinimalAtlas(root);
  await write(root, ".gitignore", "node_modules/\n");
  await git(root, ["add", "--", "atlas", ".gitignore"]);
  await git(root, ["commit", "-m", "Initialize target"]);

  const binding = commandCheckBinding({
    id: "parser-fuzz",
    checkIds: ["check.parser-fuzz"],
    subjectSelectors: [{ kind: "candidate", selector: "src/parser.ts" }],
    executable: { relativeTo: "execution-image", path: "usr/bin/true" },
    resultParser: "fuzz-campaign-v1",
  });
  await initializeRepository(root, {
    targetId: "knowledge-target",
    directorPrincipal: "director",
    home,
    authorityCredential: receiveFoundationAuthorityCredential(SECRET, "initialize"),
    publicationDigest: PUBLICATION_DIGEST,
    implementationRoots: ["src"],
    checkBindings: { [binding.id]: binding },
    stage: true,
  });
  await write(root, "src/parser.ts", "export function parse(value: Uint8Array): number { return value.length; }\n");
  await write(root, "records/behavior/parser.md", document({
    kind: "behavior", id: "behavior.parser", title: "Parser behavior",
    relationships: [{ type: "verified-by", target: "check.parser-fuzz", required: true }],
  }));
  await write(root, "records/assurance/parser-safety.md", document({
    kind: "assurance", id: "assurance.parser-safety", title: "Parser safety",
    relationships: [
      { type: "constrains", target: "behavior.parser", required: true },
      { type: "verified-by", target: "check.parser-fuzz", required: true },
    ],
  }));
  await write(root, "records/blueprint/parser.md", document({
    kind: "blueprint", id: "blueprint.parser", title: "Parser architecture",
    relationships: [{ type: "realizes", target: "behavior.parser", required: true }],
  }));
  await write(root, "src/_parser.desc.md", document({
    kind: "description", id: "description.parser", title: "Parser implementation",
    relationships: [
      { type: "realizes", target: "behavior.parser", required: true },
      { type: "verified-by", target: "check.parser-fuzz", required: true },
    ],
  }));
  await write(root, "records/checks/parser-fuzz.md", document({ kind: "check", id: "check.parser-fuzz", title: "Parser fuzz check" }));
  await git(root, ["add", "--", "."]);
  await git(root, ["commit", "-m", "Add governed parser knowledge"]);
  return { root, home };
}

test("Product draft successors retain the current owner through Carrier reopening and exact later promotion", async (t) => {
  const selected = await target();
  const root = await realpath(selected.root);
  const home = await realpath(selected.home);
  const reopened = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-knowledge-draft-carrier-")));
  t.after(async () => { await Promise.all([root, home, reopened].map((path) => rm(path, { recursive: true, force: true }))); });
  const epoch = await loadRepositoryEpoch(root);
  const original = (await loadKnowledgeSet(epoch)).index.currentByIdentity.get("blueprint.parser")!;
  const revision = (number: number, status: "draft" | "current", predecessor: typeof original) => replaceFrontMatter(original.sourceText, {
    revision: number, status,
    supersedes: { id: predecessor.frontMatter.id, revision: number - 1,
      sourceDigest: predecessor.sourceDigest, semanticDigest: predecessor.semanticDigest },
  });
  const parse = (path: string, text: string) => parseKnowledgeRecord({
    path, mode: "100644", objectId: "a".repeat(40), bytes: Buffer.from(text), contract: epoch.contract,
  });
  const secondPath = "records/blueprint/parser-r2.md";
  const thirdPath = "records/blueprint/parser-r3.md";
  const secondText = revision(2, "draft", original);
  const second = parse(secondPath, secondText);
  const thirdText = revision(3, "draft", second);
  await write(root, secondPath, secondText);
  await write(root, thirdPath, thirdText);
  await git(root, ["add", "--", "records/blueprint"]);
  await git(root, ["commit", "-m", "Retain non-governing Product draft successors"]);
  const withDrafts = await loadKnowledgeSet(await loadRepositoryEpoch(root));
  assert.equal(withDrafts.index.currentByIdentity.get(original.frontMatter.id)?.sourceDigest, original.sourceDigest);
  assert.deepEqual(withDrafts.index.revisionsByIdentity.get(original.frontMatter.id)?.map(({ frontMatter }) => frontMatter.status), ["current", "draft", "draft"]);
  assert.equal(withDrafts.currentRecords.some(({ frontMatter }) => frontMatter.id === original.frontMatter.id && frontMatter.revision > 1), false);
  const { index: _index, ...canonical } = withDrafts;
  const restored = restoreFoundationKnowledgeSetIndex(JSON.parse(JSON.stringify(canonical)));
  assert.equal(restored.index.currentByIdentity.get(original.frontMatter.id)?.sourceDigest, original.sourceDigest);
  assert.equal(restored.index.byIdentityRevision.get(`${original.frontMatter.id}@3`)?.sourceText, thirdText);

  const tree = (await git(root, ["rev-parse", "HEAD^{tree}"])).stdout.trim();
  const carrier = await publishCandidateRevisionCarrierFromGitTree({ machineHome: home, repository: root, rootTree: tree });
  await git(reopened, ["init", "-b", "main"]);
  await git(reopened, ["config", "user.name", "Lifecycle Test"]);
  await git(reopened, ["config", "user.email", "lifecycle@example.invalid"]);
  await importCandidateRevisionCarrierIntoRepository({ machineHome: home, repository: reopened, manifestBytes: carrier.manifestBytes, expectedRootTree: tree });
  const commit = (await git(reopened, ["commit-tree", tree, "-m", "Reopen retained draft Carrier"])).stdout.trim();
  await git(reopened, ["update-ref", "refs/heads/main", commit]);
  await git(reopened, ["reset", "--hard", commit]);
  const retained = await loadKnowledgeSet(await loadRepositoryEpoch(reopened));
  assert.equal(retained.index.currentByIdentity.get(original.frontMatter.id)?.sourceDigest, original.sourceDigest);
  assert.equal(retained.index.byIdentityRevision.get(`${original.frontMatter.id}@2`)?.sourceText, secondText);
  assert.equal(retained.index.byIdentityRevision.get(`${original.frontMatter.id}@3`)?.sourceText, thirdText);

  // Promotion rewrites status-bearing local predecessor bytes first, then
  // binds each successor to those exact bytes. No predecessor points forward.
  const historicalText = replaceFrontMatter(original.sourceText, { status: "superseded" });
  const historical = parse(original.path, historicalText);
  const promotedText = revision(2, "current", historical);
  const promoted = parse(secondPath, promotedText);
  await write(root, original.path, historicalText);
  await write(root, secondPath, promotedText);
  await write(root, thirdPath, revision(3, "draft", promoted));
  await git(root, ["add", "--", "records/blueprint"]);
  await git(root, ["commit", "-m", "Promote one exact Product revision while retaining a later draft"]);
  const current = await loadKnowledgeSet(await loadRepositoryEpoch(root));
  assert.equal(current.index.currentByIdentity.get(original.frontMatter.id)?.frontMatter.revision, 2);
  assert.equal(current.index.currentByIdentity.get(original.frontMatter.id)?.sourceDigest, promoted.sourceDigest);
  assert.notEqual(historical.sourceDigest, original.sourceDigest);
  assert.notEqual(historical.semanticDigest, original.semanticDigest);
  assert.equal(new TextDecoder().decode(await objectBlobBytes(root, original.objectId)), original.sourceText);
  assert.equal(retained.index.currentByIdentity.get(original.frontMatter.id)?.frontMatter.revision, 1);
  await write(root, secondPath, revision(2, "current", original));
  await git(root, ["add", "--", secondPath]);
  await git(root, ["commit", "-m", "Refuse stale pre-promotion predecessor digests"]);
  const stale = await validateKnowledgeSet(await loadRepositoryEpoch(root));
  assert.equal(stale.validation.valid, false);
  assert(stale.validation.diagnostics.some(({ code }) => code === "lifecycle.knowledge.supersession-invalid"));
});

test("Product draft coexistence preserves exact revision, status, and predecessor refusals", async (t) => {
  const { root, home } = await target();
  t.after(async () => { await Promise.all([root, home].map((path) => rm(path, { recursive: true, force: true }))); });
  const epoch = await loadRepositoryEpoch(root);
  const original = (await loadKnowledgeSet(epoch)).index.currentByIdentity.get("blueprint.parser")!;
  const draftPath = "records/blueprint/parser-r2.md";
  const reference = { id: original.frontMatter.id, revision: 1, sourceDigest: original.sourceDigest, semanticDigest: original.semanticDigest };
  const cases = [
    { label: "duplicate current", fields: { status: "current", revision: 2, supersedes: reference }, code: "lifecycle.knowledge.current-duplicate" },
    { label: "retired successor", fields: { status: "retired", revision: 2, supersedes: reference }, code: "lifecycle.knowledge.current-not-latest" },
    { label: "superseded successor", fields: { status: "superseded", revision: 2, supersedes: reference }, code: "lifecycle.knowledge.current-not-latest" },
    { label: "revision gap", fields: { status: "draft", revision: 3, supersedes: { ...reference, revision: 2 } }, code: "lifecycle.knowledge.revision-gap" },
    { label: "wrong predecessor source", fields: { status: "draft", revision: 2, supersedes: { ...reference, sourceDigest: sha256Bytes("wrong predecessor bytes") } }, code: "lifecycle.knowledge.supersession-invalid" },
    { label: "wrong predecessor meaning", fields: { status: "draft", revision: 2, supersedes: { ...reference, semanticDigest: sha256Bytes("wrong predecessor meaning") } }, code: "lifecycle.knowledge.supersession-invalid" },
  ];
  for (const scenario of cases) {
    await write(root, draftPath, replaceFrontMatter(original.sourceText, scenario.fields));
    await git(root, ["add", "--", draftPath]);
    await git(root, ["commit", "-m", `Observe ${scenario.label}`]);
    const result = await validateKnowledgeSet(await loadRepositoryEpoch(root));
    assert.equal(result.validation.valid, false, scenario.label);
    assert(result.validation.diagnostics.some(({ code }) => code === scenario.code), scenario.label);
  }
  const duplicate = replaceFrontMatter(original.sourceText, { status: "draft", revision: 2, supersedes: reference });
  await write(root, draftPath, duplicate);
  await write(root, "records/blueprint/parser-duplicate.md", duplicate);
  await git(root, ["add", "--", "records/blueprint"]);
  await git(root, ["commit", "-m", "Refuse duplicate draft revision identity"]);
  const repeated = await validateKnowledgeSet(await loadRepositoryEpoch(root));
  assert.equal(repeated.validation.valid, false);
  assert(repeated.validation.diagnostics.some(({ code }) => code === "lifecycle.knowledge.id-duplicate"));
});

test("local draft inspection sees untracked successor bytes, explains stale promotion, and preserves canonical HEAD", async () => {
  const { root } = await target();
  const knowledge = await loadKnowledgeSet(await loadRepositoryEpoch(root));
  const original = knowledge.index.currentByIdentity.get("blueprint.parser")!;
  const head = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
  const secondPath = "records/blueprint/parser-r2.md";
  const predecessor = { id: original.frontMatter.id, revision: 1, sourceDigest: original.sourceDigest, semanticDigest: original.semanticDigest };
  await write(root, secondPath, replaceFrontMatter(original.sourceText, { revision: 2, status: "draft", supersedes: predecessor }));
  const first = await inspectFoundationKnowledgeDraft({ workspace: root, paths: [original.path, secondPath] });
  assert.equal(first.status, "valid-for-checked-scope");
  assert.deepEqual(first.records.map(({ status }) => status), ["current", "draft"]);
  assert.equal(first.localCurrent[0]!.revision, 1);
  await write(root, secondPath, replaceFrontMatter(original.sourceText, { revision: 2, status: "current", supersedes: predecessor }));
  const duplicate = await inspectFoundationKnowledgeDraft({ workspace: root, paths: [original.path, secondPath] });
  assert(duplicate.diagnostics.some(({ code }) => code === "lifecycle.knowledge.current-duplicate"));
  await write(root, original.path, replaceFrontMatter(original.sourceText, { status: "superseded" }));
  const stale = await inspectFoundationKnowledgeDraft({ workspace: root, paths: [original.path, secondPath] });
  const prior = stale.records.find(({ revision }) => revision === 1)!;
  assert(stale.diagnostics.some(({ code }) => code === "lifecycle.knowledge.supersession-invalid"));
  await write(root, secondPath, replaceFrontMatter(original.sourceText, { revision: 2, status: "current", supersedes: {
    ...predecessor, sourceDigest: prior.sourceDigest, semanticDigest: prior.semanticDigest,
  } }));
  const corrected = await inspectFoundationKnowledgeDraft({ workspace: root, paths: [secondPath, original.path] });
  assert.equal(corrected.status, "valid-for-checked-scope");
  assert.equal(corrected.localCurrent[0]!.revision, 2);
  assert(corrected.excluded.some((value) => value.includes("Candidate validity")));
  assert.equal((await git(root, ["rev-parse", "HEAD"])).stdout.trim(), head);
  assert.equal((await git(root, ["ls-files", "--", secondPath])).stdout.trim(), "");
});

test("Knowledge Set construction is deterministic, typed, covered, and binding-complete", async () => {
  const { root } = await target();
  const epoch = await loadRepositoryEpoch(root);
  const first = await loadKnowledgeSet(epoch);
  const second = await loadKnowledgeSet(epoch);
  assert.equal(first.validation.valid, true);
  assert.equal(first.validation.complete, true);
  assert.equal(first.manifest.digest, second.manifest.digest);
  assert.equal(first.validation.digest, second.validation.digest);
  assert.equal(first.validation.subject.digest, first.manifest.digest);
  assert.equal(Object.isFrozen(first.validation), true);
  assert.equal("validationDigest" in first.manifest, false);
  assert.deepEqual(first.manifest.sources, []);
  assert.deepEqual(first.manifest.conflicts, []);
  const { digest: _manifestDigest, ...manifestSubject } = first.manifest;
  const sourceResolution = {
    recordId: "behavior.parser",
    recordRevision: 1,
    sourceId: "parser-source",
    required: true,
    reference: "../../../src/parser.ts",
    role: "repository-reality",
    kind: "repository",
    locator: "src/parser.ts",
    declaredRevision: null,
    declaredDigest: null,
    objectId: "a".repeat(40),
    resolvedDigest: sha256Bytes("parser source"),
    disposition: "resolved",
  } as const;
  const resolvedSourceManifestDigest = selfDigest({ ...manifestSubject, sources: [sourceResolution] } as unknown as Record<string, unknown>);
  const missingSourceManifestDigest = selfDigest({
    ...manifestSubject,
    sources: [{ ...sourceResolution, locator: null, objectId: null, resolvedDigest: null, disposition: "missing" }],
  } as unknown as Record<string, unknown>);
  assert.notEqual(resolvedSourceManifestDigest, missingSourceManifestDigest);
  assert.equal(first.validation.implementation.schemaEngine.implementation, "ajv");
  assert.equal(first.validation.implementation.schemaEngine.schemaSetDigest.startsWith("sha256:"), true);
  assert.deepEqual(first.validation.implementation.supportedProfiles, epoch.contract.selections.profiles);
  assert.deepEqual(first.manifest.repository, {
    targetId: epoch.contract.targetId,
    commit: epoch.epoch.commit,
    tree: epoch.epoch.tree,
    objectFormat: epoch.epoch.objectFormat,
    contractDigest: epoch.contract.digest,
    productStateDigest: epoch.productState.digest,
    atlasStateDigest: epoch.atlasState.digest,
    atlasResolutionDigest: epoch.atlas.resolution.digest,
    atlasNormalizedModelDigest: epoch.atlas.resolution.normalizedModelDigest,
    atlasResourceBindingsDigest: epoch.atlas.resolution.resourceBindingsDigest,
  });
  assert.equal(first.currentRecords.length, 5);
  assert.equal(first.index.currentByIdentity.get("behavior.parser")?.frontMatter.kind, "behavior");
  assert.equal(first.index.coverageByPath.get("src/parser.ts")?.descriptionId, "description.parser");
  assert.equal(first.index.bindingsByCheck.get("check.parser-fuzz")?.[0]?.id, "parser-fuzz");
  assert(first.relationships.some((edge) => edge.source === "assurance.parser-safety" && edge.type === "constrains"));
});

test("adopted Discipline registry provenance is digest-bound and Pack publisher ownership is exact", async () => {
  const { root } = await target();
  const disciplinePath = "records/disciplines/go-review.md";
  const publisher = "neutral.dev/disciplines";
  const discipline = document({
    kind: "discipline",
    id: "discipline.go-review",
    title: "Go review",
    owners: [publisher],
  });
  const initialEpoch = await loadRepositoryEpoch(root);
  const requiredSource = document({
    kind: "discipline",
    id: "discipline.required-source",
    title: "Invalid required source",
    owners: [publisher],
    sources: [{
      id: "external-practice",
      required: true,
      reference: "https://example.invalid/practice",
      revision: "v1",
      digest: sha256Bytes("external practice"),
      role: "research",
    }],
  });
  assert.throws(
    () => parseKnowledgeRecord({
      path: "records/disciplines/required-source.md",
      mode: "100644",
      objectId: "c".repeat(40),
      bytes: Buffer.from(requiredSource),
      contract: initialEpoch.contract,
    }),
    (error: unknown) => error instanceof Error && "code" in error &&
      error.code === "lifecycle.discipline.source-required",
  );
  const parsed = parseKnowledgeRecord({
    path: disciplinePath,
    mode: "100644",
    objectId: "d".repeat(40),
    bytes: Buffer.from(discipline),
    contract: initialEpoch.contract,
  });
  const registrySubject = {
    schema: "lifecycle.discipline-registry.v1" as const,
    packs: [{
      id: "neutral-go",
      publisher,
      version: "1.0.0",
      source: "https://example.invalid/neutral-go",
      revision: "pack-revision-1",
      manifestDigest: sha256Bytes("neutral-go-pack"),
    }],
    adoptions: [{
      id: parsed.frontMatter.id,
      revision: parsed.frontMatter.revision,
      path: disciplinePath,
      sourceDigest: parsed.sourceDigest,
      semanticDigest: parsed.semanticDigest,
      packId: "neutral-go",
    }],
    workTypes: [{
      id: "go-development",
      title: "Go development",
      description: "Implementation and review of Go software.",
      disciplineIds: [parsed.frontMatter.id],
    }],
  };
  const registry = { ...registrySubject, digest: selfDigest(registrySubject) };
  await write(root, disciplinePath, discipline);
  await write(root, "records/disciplines/registry.json", `${JSON.stringify(registry, null, 2)}\n`);
  await git(root, ["add", "--", disciplinePath, "records/disciplines/registry.json"]);
  await git(root, ["commit", "-m", "Adopt Go review Discipline"]);

  const adopted = await loadKnowledgeSet(await loadRepositoryEpoch(root));
  assert.equal(adopted.disciplineRegistry.digest, registry.digest);
  assert.deepEqual(adopted.manifest.disciplineRegistry, adopted.disciplineRegistry);
  assert.equal(adopted.index.currentByIdentity.get(parsed.frontMatter.id)?.frontMatter.kind, "discipline");
  const { digest: _manifestDigest, ...manifestSubject } = adopted.manifest;
  const otherRegistrySubject = {
    ...adopted.manifest.disciplineRegistry,
    packs: adopted.manifest.disciplineRegistry.packs.map((pack) => ({ ...pack, publisher: "another.publisher" })),
  };
  const { digest: _registryDigest, ...otherRegistryFields } = otherRegistrySubject;
  const otherRegistry = { ...otherRegistryFields, digest: selfDigest(otherRegistryFields) };
  assert.notEqual(
    selfDigest(manifestSubject as unknown as Record<string, unknown>),
    selfDigest({ ...manifestSubject, disciplineRegistry: otherRegistry } as unknown as Record<string, unknown>),
  );

  const wrongOwner = document({
    kind: "discipline",
    id: "discipline.go-review",
    title: "Go review",
    owners: ["target.director"],
  });
  const wrongParsed = parseKnowledgeRecord({
    path: disciplinePath,
    mode: "100644",
    objectId: "e".repeat(40),
    bytes: Buffer.from(wrongOwner),
    contract: initialEpoch.contract,
  });
  const wrongRegistrySubject = {
    ...registrySubject,
    adoptions: [{
      ...registrySubject.adoptions[0]!,
      sourceDigest: wrongParsed.sourceDigest,
      semanticDigest: wrongParsed.semanticDigest,
    }],
  };
  const wrongRegistry = { ...wrongRegistrySubject, digest: selfDigest(wrongRegistrySubject) };
  await write(root, disciplinePath, wrongOwner);
  await write(root, "records/disciplines/registry.json", `${JSON.stringify(wrongRegistry, null, 2)}\n`);
  await git(root, ["add", "--", disciplinePath, "records/disciplines/registry.json"]);
  await git(root, ["commit", "-m", "Create mismatched Discipline publisher"]);
  const mismatch = await validateKnowledgeSet(await loadRepositoryEpoch(root));
  assert.equal(mismatch.validation.valid, false);
  assert(mismatch.validation.diagnostics.some((diagnostic) =>
    diagnostic.code === "lifecycle.discipline.publisher-owner" &&
    diagnostic.location.locator === disciplinePath));
});

test("first Discipline adoption accepts publisher revision seven without importing publisher history", async () => {
  const { root } = await target();
  const adoption = await adoptPublisherRevision(root, 7);
  const epoch = await loadRepositoryEpoch(root);
  const knowledge = await loadKnowledgeSet(epoch);
  const record = knowledge.index.currentByIdentity.get(adoption.record.frontMatter.id)!;
  assert.equal(record.frontMatter.revision, 7);
  assert.equal(record.frontMatter.supersedes?.revision, 6);
  assert.equal(record.sourceText, adoption.document);
  assert.equal(knowledge.index.revisionsByIdentity.get(record.frontMatter.id)?.length, 1);
  assert.deepEqual(knowledge.disciplineRegistry, adoption.registry);

  // The publisher exception does not relax the target-owned Product Knowledge chain.
  const blueprint = knowledge.index.currentByIdentity.get("blueprint.parser")!;
  const missingHistory = replaceFrontMatter(blueprint.sourceText, {
    revision: 7,
    supersedes: { id: blueprint.frontMatter.id, revision: 6, sourceDigest: sha256Bytes("missing local source"), semanticDigest: sha256Bytes("missing local meaning") },
  });
  await write(root, blueprint.path, missingHistory);
  await git(root, ["add", "--", blueprint.path]);
  await git(root, ["commit", "-m", "Declare Product Knowledge without its required local history"]);
  const invalid = await validateKnowledgeSet(await loadRepositoryEpoch(root));
  assert.equal(invalid.validation.valid, false);
  assert(invalid.validation.diagnostics.some(({ code, location }) => code === "lifecycle.knowledge.revision-gap" && location.locator === blueprint.path));
  assert(!invalid.validation.diagnostics.some(({ code, location }) => code === "lifecycle.knowledge.revision-gap" && location.locator === record.path));
});

test("replacing adopted Discipline revision one with revision two preserves exact historical bytes without rewriting publisher status", async () => {
  const { root } = await target();
  const first = await adoptPublisherRevision(root, 1);
  const firstEpoch = await loadRepositoryEpoch(root);
  const firstKnowledge = await loadKnowledgeSet(firstEpoch);
  const firstSnapshot = await bindRepositorySnapshot(firstEpoch, firstKnowledge);
  const second = await adoptPublisherRevision(root, 2, first.record);
  const current = await loadKnowledgeSet(await loadRepositoryEpoch(root));
  const currentRecord = current.index.currentByIdentity.get(second.record.frontMatter.id)!;
  assert.equal(currentRecord.frontMatter.revision, 2);
  assert.equal(currentRecord.frontMatter.status, "current");
  assert.equal(currentRecord.sourceText, second.document);
  assert.equal(current.index.revisionsByIdentity.get(currentRecord.frontMatter.id)?.length, 1);
  assert.equal(current.index.byIdentityRevision.has(`${currentRecord.frontMatter.id}@1`), false);
  assert.deepEqual(currentRecord.frontMatter.supersedes, {
    id: first.record.frontMatter.id, revision: 1, sourceDigest: first.record.sourceDigest, semanticDigest: first.record.semanticDigest,
  });

  const historicalEpoch = await loadRepositoryEpochAtCommit(root, firstEpoch.epoch.commit);
  const historical = await loadKnowledgeSet(historicalEpoch);
  const historicalSnapshot = await bindHistoricalRepositorySnapshot(historicalEpoch, historical);
  const retained = historical.index.currentByIdentity.get(first.record.frontMatter.id)!;
  assert.equal(retained.frontMatter.status, "current");
  assert.equal(retained.sourceText, first.document);
  assert.equal(retained.sourceDigest, first.record.sourceDigest);
  assert.deepEqual(historical.disciplineRegistry, first.registry);
  assert.equal(historicalSnapshot.snapshot.digest, firstSnapshot.snapshot.digest);
  const entry = historicalEpoch.treeEntries.find(({ path }) => path === TEST_DISCIPLINE_PATH)!;
  assert.equal((await objectBlobBytes(root, entry.objectId, historicalEpoch.contract.knowledge.limits.maximumFileBytes)).toString("utf8"), first.document);

  // Retaining two publisher-current copies in one target tree is still invalid.
  await write(root, "records/disciplines/prior-current.md", first.document);
  await git(root, ["add", "--", "records/disciplines/prior-current.md"]);
  await git(root, ["commit", "-m", "Declare two current copies of one adopted identity"]);
  const duplicate = await validateKnowledgeSet(await loadRepositoryEpoch(root));
  assert.equal(duplicate.validation.valid, false);
  assert(duplicate.validation.diagnostics.some(({ code }) => code === "lifecycle.knowledge.current-duplicate"));
});

test("a fresh repository with no Knowledge records has a complete empty Knowledge Set", async () => {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-foundation-empty-knowledge-"));
  const home = await mkdtemp(join(tmpdir(), "lifecycle-foundation-home-"));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Lifecycle Test"]);
  await git(root, ["config", "user.email", "lifecycle@example.invalid"]);
  await writeMinimalAtlas(root);
  await git(root, ["add", "--", "atlas"]);
  await git(root, ["commit", "-m", "Initialize empty target"]);
  await initializeRepository(root, {
    targetId: "empty-knowledge-target",
    directorPrincipal: "director",
    home,
    authorityCredential: receiveFoundationAuthorityCredential(SECRET, "initialize"),
    publicationDigest: PUBLICATION_DIGEST,
    implementationRoots: [],
    stage: true,
  });
  await git(root, ["commit", "-m", "Attach Lifecycle"]);

  const result = await validateKnowledgeSet(await loadRepositoryEpoch(root));
  assert.equal(result.validation.complete, true);
  assert.equal(result.validation.valid, true);
  assert.equal(result.knowledgeSet?.records.length, 0);
  assert.equal(result.knowledgeSet?.manifest.records.length, 0);
  assert.equal(
    result.validation.diagnostics.find((diagnostic) => diagnostic.code === "lifecycle.knowledge.discovery-empty")?.severity,
    "information",
  );
});

test("aggregate Knowledge record count and byte bounds accept the limit and reject limit plus one", async () => {
  const { root } = await target();
  const epoch = await loadRepositoryEpoch(root);
  const candidates = epoch.treeEntries.filter((entry) => expectedKnowledgeKind(entry.path, epoch.contract) !== null);
  const sizes = await Promise.all(candidates.map(async (entry) =>
    (await objectBlobBytes(root, entry.objectId, epoch.contract.knowledge.limits.maximumFileBytes)).byteLength));
  const totalBytes = sizes.reduce((sum, value) => sum + value, 0);
  const maximumFileBytes = Math.max(...sizes);
  const withLimits = (maximumRecords: number, maximumTotalRecordBytes: number) => ({
    ...epoch,
    contract: {
      ...epoch.contract,
      knowledge: {
        ...epoch.contract.knowledge,
        limits: {
          ...epoch.contract.knowledge.limits,
          maximumRecords,
          maximumFileBytes,
          maximumTotalRecordBytes,
        },
      },
    },
  });

  const exact = await validateKnowledgeSet(withLimits(candidates.length, totalBytes));
  assert.equal(exact.validation.complete, true);
  assert.equal(exact.validation.valid, true);
  assert.equal(exact.validation.limits.observedCandidateRecords, candidates.length);
  assert.equal(exact.validation.limits.observedRecordBytes, totalBytes);

  const countPlusOne = await validateKnowledgeSet(withLimits(candidates.length - 1, totalBytes));
  assert.equal(countPlusOne.validation.complete, false);
  assert.equal(countPlusOne.knowledgeSet, null);
  assert(countPlusOne.validation.diagnostics.some((diagnostic) =>
    diagnostic.code === "lifecycle.knowledge.limit-exceeded" &&
    diagnostic.facts.maximumRecords === candidates.length - 1));

  const bytesPlusOne = await validateKnowledgeSet(withLimits(candidates.length, totalBytes - 1));
  assert.equal(bytesPlusOne.validation.complete, false);
  assert.equal(bytesPlusOne.knowledgeSet, null);
  assert(bytesPlusOne.validation.diagnostics.some((diagnostic) =>
    diagnostic.code === "lifecycle.knowledge.limit-exceeded" &&
    diagnostic.facts.maximumTotalRecordBytes === totalBytes - 1));
});

test("Knowledge validation reports ambiguous Description ownership without collapsing records", async () => {
  const { root } = await target();
  await write(root, "src/_parser-alternate.desc.md", document({
    kind: "description", id: "description.parser-alternate", title: "Alternate parser implementation", coveragePath: "src/parser.ts",
  }));
  await git(root, ["add", "--", "src/_parser-alternate.desc.md"]);
  await git(root, ["commit", "-m", "Create conflicting coverage"]);
  const result = await validateKnowledgeSet(await loadRepositoryEpoch(root));
  assert.equal(result.validation.valid, false);
  assert.equal(result.knowledgeSet, null);
  assert.equal(result.observation.currentRecords.length, 6);
  assert(result.validation.diagnostics.some((diagnostic) => diagnostic.code === "lifecycle.description.coverage-ambiguous"));
});

test("Knowledge Set validation preserves every nested schema diagnostic with its record location", async () => {
  const { root } = await target();
  await write(root, "records/behavior/parser.md", document({
    kind: "behavior",
    id: "behavior.parser",
    title: "Parser behavior",
    relationships: [{ type: "verified-by", target: "check.parser-fuzz", required: true }],
    sources: [{
      id: "invalid-source",
      required: "yes",
      reference: "http://[",
      revision: null,
      digest: null,
      role: "research",
    }],
  }));
  await git(root, ["add", "--", "records/behavior/parser.md"]);
  await git(root, ["commit", "-m", "Add invalid nested source fields"]);

  const result = await validateKnowledgeSet(await loadRepositoryEpoch(root));
  const schemaDiagnostics = result.validation.diagnostics.filter((diagnostic) =>
    diagnostic.code === "lifecycle.schema.invalid" &&
    diagnostic.location.locator === "records/behavior/parser.md");
  assert(schemaDiagnostics.length >= 2);
  assert(schemaDiagnostics.some((diagnostic) =>
    diagnostic.location.jsonPointer === "/sources/0/required" && diagnostic.facts.keyword === "type"));
  assert(schemaDiagnostics.some((diagnostic) =>
    diagnostic.location.jsonPointer === "/sources/0/reference" && diagnostic.facts.keyword === "format"));
});

test("Knowledge parsing rejects duplicate JSON keys and preserves semantic line-ending equivalence", async () => {
  const home = await mkdtemp(join(tmpdir(), "lifecycle-foundation-home-"));
  const authority = await createFoundationAuthority(home, "parse-target", receiveFoundationAuthorityCredential(SECRET, "initialize"));
  const contract = createRepositoryContract({
    targetId: "parse-target",
    canonicalBranch: "refs/heads/main",
    authority,
    publicationDigest: PUBLICATION_DIGEST,
    implementationRoots: [],
  });
  const valid = document({ kind: "behavior", id: "behavior.lines", title: "Line endings", relationships: [] });
  const lf = parseKnowledgeRecord({ path: "records/behavior/lines.md", mode: "100644", objectId: "a".repeat(40), bytes: Buffer.from(valid), contract });
  const crlf = parseKnowledgeRecord({ path: "records/behavior/lines.md", mode: "100644", objectId: "b".repeat(40), bytes: Buffer.from(valid.replaceAll("\n", "\r\n")), contract });
  assert.notEqual(lf.sourceDigest, crlf.sourceDigest);
  assert.equal(lf.semanticDigest, crlf.semanticDigest);
  const duplicate = valid.replace('"kind": "behavior",', '"kind": "behavior",\n  "kind": "behavior",');
  assert.throws(() => parseKnowledgeRecord({ path: "records/behavior/duplicate.md", mode: "100644", objectId: "c".repeat(40), bytes: Buffer.from(duplicate), contract }), /duplicate JSON object key/);
});
