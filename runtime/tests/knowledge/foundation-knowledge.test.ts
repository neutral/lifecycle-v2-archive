import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createFoundationAuthority } from "../../src/foundation/repository/authority.js";
import { commandCheckBinding, initializeRepository } from "../../src/foundation/repository/initialize.js";
import { git, objectBlobBytes } from "../../src/foundation/repository/git.js";
import { selfDigest, sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { loadKnowledgeSet, validateKnowledgeSet } from "../../src/foundation/knowledge/knowledge-set.js";
import { expectedKnowledgeKind, parseKnowledgeRecord } from "../../src/foundation/knowledge/records.js";
import { createRepositoryContract } from "../../src/foundation/repository/contract.js";
import { loadRepositoryEpoch } from "../../src/foundation/repository/snapshot.js";
import { writeMinimalAtlas } from "../helpers/atlas-fixture.js";

const SECRET = "knowledge-test-secret-that-is-at-least-thirty-two-bytes";
const PUBLICATION_DIGEST = sha256Bytes("knowledge-test-publication");

type Relationship = Readonly<{ type: string; target: string; required: boolean; scope?: string; rationale?: string }>;

const SECTIONS = {
  behavior: ["Meaning", "Boundaries", "Examples", "Rationale"],
  assurance: ["Obligation", "Failure Model", "Limits", "Rationale"],
  blueprint: ["Decision", "Structure", "Tradeoffs", "Evolution"],
  description: ["Responsibility", "Behavior", "Boundaries", "Rationale"],
  check: ["Proposition", "Evaluation", "Evidence", "Limits"],
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
  }
}

function document(options: {
  kind: keyof typeof SECTIONS;
  id: string;
  title: string;
  relationships?: readonly Relationship[];
  coveragePath?: string;
  sources?: readonly unknown[];
}): string {
  const frontMatter = {
    schema: "lifecycle.knowledge-record.v1",
    kind: options.kind,
    id: options.id,
    title: options.title,
    status: "current",
    revision: 1,
    supersedes: null,
    summary: `${options.title} summary.`,
    owners: ["founder"],
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
    founderPrincipal: "founder",
    home,
    authoritySecret: SECRET,
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
    founderPrincipal: "founder",
    home,
    authoritySecret: SECRET,
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
  const authority = await createFoundationAuthority(home, "parse-target", SECRET);
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
