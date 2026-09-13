import { receiveFoundationAuthorityCredential } from "../../src/foundation/repository/authority.js";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { validateKnowledgeSources } from "../../src/foundation/knowledge/sources.js";
import { createEmptyDisciplineRegistry } from "../../src/foundation/knowledge/discipline-registry.js";
import type { FoundationKnowledgeRecord, FoundationSourceBinding } from "../../src/foundation/knowledge/types.js";
import { createFoundationAuthority } from "../../src/foundation/repository/authority.js";
import { createRepositoryContract } from "../../src/foundation/repository/contract.js";
import { exactTreeEntries, git, resolveGitObjectFormat } from "../../src/foundation/repository/git.js";
import { selfDigest, sha256Bytes, type Sha256 } from "../../src/foundation/validation/canonical.js";
import { DiagnosticCollector } from "../../src/foundation/validation/result.js";
import { writeMinimalAtlas } from "../helpers/atlas-fixture.js";

const SECRET = "knowledge-source-test-secret-at-least-thirty-two-bytes";

async function write(root: string, path: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content, "utf8");
}

function record(
  sources: readonly FoundationSourceBinding[],
  options: {
    id?: string;
    kind?: "behavior" | "discipline";
    status?: "draft" | "current" | "superseded" | "retired";
    revision?: number;
  } = {},
): FoundationKnowledgeRecord {
  const digest = sha256Bytes("record");
  const kind = options.kind ?? "behavior";
  const id = options.id ?? `${kind}.source`;
  const revision = options.revision ?? 1;
  return {
    path: `records/${kind === "discipline" ? "disciplines" : kind}/${id.replaceAll(".", "-")}-${revision}.md`,
    mode: "100644",
    objectId: "a".repeat(40),
    sourceText: "",
    body: "",
    bodyNormalized: "",
    headings: [],
    frontMatter: {
      schema: "lifecycle.knowledge-record.v2",
      kind,
      id,
      title: "Source",
      status: options.status ?? "current",
      revision,
      supersedes: null,
      summary: "Source",
      owners: ["director"],
      sources,
      relationships: [],
      conflicts: [],
      tags: [],
      spec: kind === "behavior" ? {
        outcome: "Source",
        actors: ["caller"],
        conditions: [],
        included: ["source"],
        excluded: [],
        examples: [],
        falsifiers: ["missing"],
      } : {
        practice: "Treat provenance as optional advisory context.",
        appliesWhen: ["using this Discipline"],
        doesNotApplyWhen: [],
        guidance: ["Use judgment."],
        verification: [],
      },
      extensions: {},
      canonicalValue: {},
    },
    sourceDigest: digest,
    semanticDigest: digest,
  };
}

test("Discipline provenance cannot become a required Knowledge source", async () => {
  const fixture = await repository();
  const source = Object.freeze({
    id: "external-practice",
    required: true,
    reference: "https://example.invalid/practice",
    revision: "v1",
    digest: sha256Bytes("external practice"),
    role: "research" as const,
  });
  const discipline = record([source], { id: "discipline.source", kind: "discipline" });
  const registrySubject = {
    schema: "lifecycle.discipline-registry.v1" as const,
    packs: [{
      id: "source-practices",
      publisher: "director",
      version: "1.0.0",
      source: "https://example.invalid/source-practices",
      revision: "revision-1",
      manifestDigest: sha256Bytes("source-practices pack"),
    }],
    adoptions: [{
      id: discipline.frontMatter.id,
      revision: discipline.frontMatter.revision,
      path: discipline.path,
      sourceDigest: discipline.sourceDigest,
      semanticDigest: discipline.semanticDigest,
      packId: "source-practices",
    }],
    workTypes: [],
  };
  const registry = Object.freeze({ ...registrySubject, digest: selfDigest(registrySubject) });
  const collector = new DiagnosticCollector();
  const sourceResult = await validateKnowledgeSources({
    repository: fixture.root,
    commit: fixture.commit,
    contract: fixture.contract,
    treeEntries: fixture.treeEntries,
    records: [discipline],
    disciplineRegistry: registry,
    collector,
  });
  const result = collector.result({
    profile: "knowledge-set-v2",
    subjectKind: "test",
    subjectId: "discipline-source-required",
    stages: ["records", "sources"],
  });
  assert.equal(result.valid, false);
  assert(result.diagnostics.some(({ code }) => code === "lifecycle.discipline.source-required"));
  assert.equal(sourceResult.complete, true);
  assert.deepEqual(sourceResult.resolutions, []);
});

async function repository(): Promise<{
  root: string;
  commit: string;
  objectId: string;
  sourceDigest: Sha256;
  treeEntries: Awaited<ReturnType<typeof exactTreeEntries>>;
  contract: ReturnType<typeof createRepositoryContract>;
}> {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-knowledge-source-"));
  const home = await mkdtemp(join(tmpdir(), "lifecycle-knowledge-source-home-"));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Lifecycle Test"]);
  await git(root, ["config", "user.email", "lifecycle@example.invalid"]);
  const content = "exact source bytes\n";
  await write(root, "docs/source.txt", content);
  await writeMinimalAtlas(root);
  await git(root, ["add", "--", "."]);
  await git(root, ["commit", "-m", "Create exact source"]);
  const commit = (await git(root, ["rev-parse", "HEAD"])).stdout.trim();
  const tree = (await git(root, ["rev-parse", "HEAD^{tree}"])).stdout.trim();
  const objectFormat = await resolveGitObjectFormat(root);
  const treeEntries = await exactTreeEntries(root, tree, objectFormat);
  const objectId = treeEntries.find((entry) => entry.path === "docs/source.txt")!.objectId;
  const authority = await createFoundationAuthority(home, "knowledge-source-target", receiveFoundationAuthorityCredential(SECRET, "initialize"));
  const contract = createRepositoryContract({
    targetId: "knowledge-source-target",
    canonicalBranch: "refs/heads/main",
    authority,
    publicationDigest: sha256Bytes("publication"),
    implementationRoots: [],
  });
  return { root, commit, objectId, sourceDigest: sha256Bytes(content), treeEntries, contract };
}

test("repository sources bind exact tree blobs even when live worktree bytes change", async () => {
  const fixture = await repository();
  await write(fixture.root, "docs/source.txt", "dirty live bytes\n");
  const source: FoundationSourceBinding = Object.freeze({
    id: "decision-source",
    required: true,
    reference: "../../docs/source.txt",
    revision: fixture.objectId,
    digest: fixture.sourceDigest,
    role: "decision",
  });
  const collector = new DiagnosticCollector();
  const sourceResult = await validateKnowledgeSources({
    repository: fixture.root,
    commit: fixture.commit,
    contract: fixture.contract,
    treeEntries: fixture.treeEntries,
    records: [record([source])],
    disciplineRegistry: createEmptyDisciplineRegistry(),
    collector,
  });
  const result = collector.result({ profile: "knowledge-set-v2", subjectKind: "test", subjectId: "source", stages: ["records", "sources"] });
  assert.equal(result.valid, true);
  assert.equal(sourceResult.complete, true);
  assert.equal(sourceResult.resolutions[0]?.disposition, "resolved");
  assert.equal(sourceResult.resolutions[0]?.objectId, fixture.objectId);
  assert.equal(sourceResult.resolutions[0]?.resolvedDigest, fixture.sourceDigest);
});

test("local digest mismatch and denied authority claims fail while external research stays non-authoritative", async () => {
  const fixture = await repository();
  const sources: FoundationSourceBinding[] = [
    Object.freeze({
      id: "wrong-digest",
      required: true,
      reference: "../../docs/source.txt",
      revision: fixture.commit,
      digest: sha256Bytes("wrong"),
      role: "policy",
    }),
    Object.freeze({
      id: "external-research",
      required: false,
      reference: "https://example.invalid/research",
      revision: "v1",
      digest: sha256Bytes("external"),
      role: "research",
    }),
    Object.freeze({
      id: "false-repository-reality",
      required: true,
      reference: "file:///tmp/unbound",
      revision: null,
      digest: null,
      role: "repository-reality",
    }),
  ];
  const collector = new DiagnosticCollector();
  const sourceResult = await validateKnowledgeSources({
    repository: fixture.root,
    commit: fixture.commit,
    contract: fixture.contract,
    treeEntries: fixture.treeEntries,
    records: [record(sources)],
    disciplineRegistry: createEmptyDisciplineRegistry(),
    collector,
  });
  const result = collector.result({ profile: "knowledge-set-v2", subjectKind: "test", subjectId: "source-errors", stages: ["records", "sources"] });
  assert.equal(result.valid, false);
  assert.equal(sourceResult.complete, false);
  assert(result.diagnostics.some((entry) => entry.code === "lifecycle.knowledge.source-unresolved" && entry.severity === "error"));
  assert(result.diagnostics.some((entry) => entry.code === "lifecycle.knowledge.source-unresolved" && entry.severity === "warning"));
  assert.deepEqual(sourceResult.resolutions.map((entry) => entry.disposition), ["retrieval-denied", "role-mismatch", "digest-mismatch"]);
});

test("source requiredness and record currentness alone determine source-stage completeness", async () => {
  const fixture = await repository();
  const unresolved = (required: boolean): FoundationSourceBinding => Object.freeze({
    id: "unavailable",
    required,
    reference: "https://example.invalid/source",
    revision: "v1",
    digest: sha256Bytes("unavailable source"),
    role: "research",
  });

  for (const scenario of [
    { id: "behavior.current-required", status: "current" as const, required: true, complete: false, severity: "error" },
    { id: "behavior.current-optional", status: "current" as const, required: false, complete: true, severity: "warning" },
    { id: "behavior.historical-required", status: "retired" as const, required: true, complete: true, severity: "warning" },
  ]) {
    const collector = new DiagnosticCollector();
    const sourceResult = await validateKnowledgeSources({
      repository: fixture.root,
      commit: fixture.commit,
      contract: fixture.contract,
      treeEntries: fixture.treeEntries,
      records: [record([unresolved(scenario.required)], { id: scenario.id, status: scenario.status })],
      disciplineRegistry: createEmptyDisciplineRegistry(),
      collector,
    });
    const result = collector.result({
      profile: "knowledge-set-v2",
      subjectKind: "test",
      subjectId: scenario.id,
      stages: ["records", { id: "sources", complete: sourceResult.complete }],
    });
    assert.equal(sourceResult.complete, scenario.complete, scenario.id);
    assert.equal(result.complete, scenario.complete, scenario.id);
    assert.equal(sourceResult.resolutions[0]?.required, scenario.required, scenario.id);
    assert.equal(sourceResult.resolutions[0]?.disposition, "retrieval-denied", scenario.id);
    assert.equal(result.diagnostics[0]?.severity, scenario.severity, scenario.id);
  }
});

test("aggregate source count and byte bounds accept the limit and reject limit plus one", async () => {
  const fixture = await repository();
  const local = (id: string): FoundationSourceBinding => Object.freeze({
    id,
    required: true,
    reference: "../../docs/source.txt",
    revision: fixture.objectId,
    digest: fixture.sourceDigest,
    role: "decision",
  });
  const sources = [local("source-a"), local("source-b")];
  const sourceBytes = Buffer.byteLength("exact source bytes\n", "utf8");
  const withLimits = (maximumSources: number, maximumTotalSourceBytes: number) => ({
    ...fixture.contract,
    knowledge: {
      ...fixture.contract.knowledge,
      limits: { ...fixture.contract.knowledge.limits, maximumSources, maximumTotalSourceBytes },
    },
  });
  const validate = async (maximumSources: number, maximumTotalSourceBytes: number) => {
    const collector = new DiagnosticCollector();
    const sourceResult = await validateKnowledgeSources({
      repository: fixture.root,
      commit: fixture.commit,
      contract: withLimits(maximumSources, maximumTotalSourceBytes),
      treeEntries: fixture.treeEntries,
      records: [record(sources)],
      disciplineRegistry: createEmptyDisciplineRegistry(),
      collector,
    });
    const result = collector.result({
      profile: "knowledge-set-v2",
      subjectKind: "test",
      subjectId: `source-limits-${maximumSources}-${maximumTotalSourceBytes}`,
      stages: ["records", { id: "sources", complete: sourceResult.complete }],
    });
    return { sourceResult, result };
  };

  const exactCount = await validate(2, sourceBytes * 2);
  assert.equal(exactCount.sourceResult.complete, true);
  assert.equal(exactCount.sourceResult.observedCount, 2);
  assert.equal(exactCount.sourceResult.observedBytes, sourceBytes * 2);
  assert.equal(exactCount.result.valid, true);

  const countPlusOne = await validate(1, sourceBytes * 2);
  assert.equal(countPlusOne.sourceResult.complete, false);
  assert.equal(countPlusOne.sourceResult.observedCount, 2);
  assert(countPlusOne.result.diagnostics.some((entry) => entry.code === "lifecycle.knowledge.limit-exceeded"));

  const bytesPlusOne = await validate(2, sourceBytes * 2 - 1);
  assert.equal(bytesPlusOne.sourceResult.complete, false);
  assert.equal(bytesPlusOne.sourceResult.observedBytes, sourceBytes);
  assert(bytesPlusOne.result.diagnostics.some((entry) =>
    entry.code === "lifecycle.knowledge.limit-exceeded" &&
    entry.facts.maximumTotalSourceBytes === sourceBytes * 2 - 1));
});
