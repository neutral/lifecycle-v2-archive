import { receiveFoundationAuthorityCredential } from "../../src/foundation/repository/authority.js";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { createFoundationAuthority } from "../../src/foundation/repository/authority.js";
import { createRepositoryContract } from "../../src/foundation/repository/contract.js";
import type { FoundationRepositoryContract } from "../../src/foundation/repository/types.js";
import { sha256Bytes } from "../../src/foundation/validation/canonical.js";
import {
  KNOWLEDGE_MAXIMUM_FRONT_MATTER_BYTES,
  parseKnowledgeDocument,
  parseMarkdownHeadings,
} from "../../src/foundation/knowledge/front-matter.js";
import { parseKnowledgeRecord, parseKnowledgeSource } from "../../src/foundation/knowledge/records.js";
import { buildRevisionIndexes } from "../../src/foundation/knowledge/revisions.js";
import { DiagnosticCollector } from "../../src/foundation/validation/result.js";
import {
  FOUNDATION_KNOWLEDGE_RECORD_SCHEMA_ID,
  FOUNDATION_SCHEMA_ENGINE_IDENTITY,
  foundationSchemaIds,
} from "../../src/foundation/validation/schema-engine.js";
import {
  FOUNDATION_KNOWLEDGE_STRUCTURAL_LIMITATIONS,
  FOUNDATION_KNOWLEDGE_STRUCTURAL_LIMITS,
} from "../../src/foundation/knowledge/structural.js";

const SECRET = "structural-test-secret-that-is-at-least-thirty-two-bytes";
const PUBLICATION_DIGEST = sha256Bytes("structural-test-publication");

const BEHAVIOR_BODY = [
  "# Parser behavior",
  "",
  "## Meaning",
  "",
  "Meaning details.",
  "",
  "## Boundaries",
  "",
  "Boundary details.",
  "",
  "## Examples",
  "",
  "Example details.",
  "",
  "## Rationale",
  "",
  "Rationale details.",
  "",
].join("\n");

function behaviorFrontMatter(): Record<string, unknown> {
  return {
    schema: "lifecycle.knowledge-record.v2",
    kind: "behavior",
    id: "behavior.parser",
    title: "Parser behavior",
    status: "current",
    revision: 1,
    supersedes: null,
    summary: "The parser returns one bounded result.",
    owners: ["director"],
    sources: [],
    relationships: [],
    conflicts: [],
    tags: [],
    spec: {
      outcome: "Arbitrary input produces one bounded result.",
      actors: ["caller"],
      conditions: [],
      included: ["parse input"],
      excluded: ["execute input"],
      examples: ["empty input"],
      falsifiers: ["the process crashes"],
    },
  };
}

function document(frontMatter: Record<string, unknown> = behaviorFrontMatter(), body = BEHAVIOR_BODY): Buffer {
  return Buffer.from(`---\n${JSON.stringify(frontMatter)}\n---\n${body}`, "utf8");
}

function documentFromJson(frontMatter: string, body = "# Body\n"): Buffer {
  return Buffer.from(`---\n${frontMatter}\n---\n${body}`, "utf8");
}

function expectCode(operation: () => unknown, code: string): Error & { code?: unknown; diagnostics?: unknown } {
  let thrown: unknown;
  try {
    operation();
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof Error, `expected ${code} to be thrown`);
  assert.equal("code" in thrown ? thrown.code : undefined, code);
  return thrown as Error & { code?: unknown; diagnostics?: unknown };
}

let contractPromise: Promise<FoundationRepositoryContract> | null = null;
function contract(): Promise<FoundationRepositoryContract> {
  contractPromise ??= (async () => {
    const home = await mkdtemp(`${tmpdir()}/lifecycle-knowledge-structural-`);
    const authority = await createFoundationAuthority(home, "structural-target", receiveFoundationAuthorityCredential(SECRET, "initialize"));
    return createRepositoryContract({
      targetId: "structural-target",
      canonicalBranch: "refs/heads/main",
      authority,
      publicationDigest: PUBLICATION_DIGEST,
      implementationRoots: ["src"],
    });
  })();
  return contractPromise;
}

function parseRecord(bytes: Buffer, repositoryContract: FoundationRepositoryContract, path = "records/behavior/parser.md") {
  return parseKnowledgeRecord({
    path,
    mode: "100644",
    objectId: "a".repeat(40),
    bytes,
    contract: repositoryContract,
  });
}

test("local Knowledge source parsing preserves Runtime digests without manufacturing Git retention, and promotion uses the same lineage owner", async () => {
  const policy = await contract();
  const path = "records/behavior/parser.md";
  const source = documentFromJson(JSON.stringify(behaviorFrontMatter()), BEHAVIOR_BODY);
  const parsed = parseKnowledgeSource({ path, bytes: source, contract: policy });
  const { mode: _mode, objectId: _objectId, ...retained } = parseRecord(source, policy);
  assert.deepEqual(parsed, retained);
  assert.equal("objectId" in parsed, false);
  assert.equal("mode" in parsed, false);
  const predecessor = { id: parsed.frontMatter.id, revision: 1, sourceDigest: parsed.sourceDigest, semanticDigest: parsed.semanticDigest };
  const next = (status: string, supersedes = predecessor) => parseKnowledgeSource({
    path: "records/behavior/parser-r2.md", contract: policy,
    bytes: documentFromJson(JSON.stringify({ ...behaviorFrontMatter(), revision: 2, status, supersedes }), BEHAVIOR_BODY),
  });
  const draft = next("draft");
  const first = new DiagnosticCollector();
  assert.equal(buildRevisionIndexes({ records: [parsed, draft], collector: first }).currentByIdentity.get(parsed.frontMatter.id), parsed);
  assert.deepEqual(first.diagnostics, []);
  const twoCurrent = new DiagnosticCollector();
  buildRevisionIndexes({ records: [parsed, next("current")], collector: twoCurrent });
  assert(twoCurrent.diagnostics.some(({ code }) => code === "lifecycle.knowledge.current-duplicate"));
  const prior = parseKnowledgeSource({ path, contract: policy, bytes: documentFromJson(JSON.stringify({ ...behaviorFrontMatter(), status: "superseded" }), BEHAVIOR_BODY) });
  assert.notEqual(prior.sourceDigest, predecessor.sourceDigest);
  const stale = new DiagnosticCollector();
  buildRevisionIndexes({ records: [prior, next("current")], collector: stale });
  assert(stale.diagnostics.some(({ code }) => code === "lifecycle.knowledge.supersession-invalid"));
  const promoted = next("current", { ...predecessor, sourceDigest: prior.sourceDigest, semanticDigest: prior.semanticDigest });
  const final = new DiagnosticCollector();
  assert.equal(buildRevisionIndexes({ records: [prior, promoted], collector: final }).currentByIdentity.get(parsed.frontMatter.id), promoted);
  assert.deepEqual(final.diagnostics, []);
  assert.equal(parsed.frontMatter.status, "current", "The separate admitted occurrence remains unchanged");
});

test("Knowledge document parsing accepts CRLF while preserving source identity and rejects unsafe text encodings", () => {
  const lf = documentFromJson("{}", "# Body\n");
  const crlf = Buffer.from(lf.toString("utf8").replaceAll("\n", "\r\n"), "utf8");
  const parsed = parseKnowledgeDocument("records/behavior/body.md", crlf);
  assert.match(parsed.body, /\r\n/u);
  assert.doesNotMatch(parsed.bodyNormalized, /\r/u);
  assert.notEqual(parsed.sourceDigest, parseKnowledgeDocument("records/behavior/body.md", lf).sourceDigest);

  expectCode(
    () => parseKnowledgeDocument("records/behavior/bom.md", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), lf])),
    "lifecycle.knowledge.bom",
  );
  expectCode(
    () => parseKnowledgeDocument("records/behavior/utf8.md", Buffer.concat([lf, Buffer.from([0xc3, 0x28])])),
    "lifecycle.knowledge.utf8",
  );
  expectCode(
    () => parseKnowledgeDocument("records/behavior/cr.md", Buffer.from("---\r{}\r---\r# Body\r", "utf8")),
    "lifecycle.knowledge.line-ending",
  );
  expectCode(
    () => parseKnowledgeDocument("records/behavior/limited.md", lf, {
      ...FOUNDATION_KNOWLEDGE_STRUCTURAL_LIMITS,
      maximumFileBytes: lf.byteLength - 1,
    }),
    "lifecycle.knowledge.file-too-large",
  );
});

test("Knowledge front matter rejects duplicate keys, unsafe numbers, malformed Unicode, prototype keys, depth, and array bounds", () => {
  expectCode(
    () => parseKnowledgeDocument("records/behavior/duplicate.md", documentFromJson('{"kind":"behavior","kind":"behavior"}')),
    "foundation.json.parse",
  );
  expectCode(
    () => parseKnowledgeDocument("records/behavior/number.md", documentFromJson('{"revision":9007199254740992}')),
    "foundation.json.parse",
  );
  expectCode(
    () => parseKnowledgeDocument("records/behavior/unicode.md", documentFromJson('{"title":"\\ud800"}')),
    "foundation.json.parse",
  );
  expectCode(
    () => parseKnowledgeDocument("records/behavior/prototype.md", documentFromJson('{"\\u005f\\u005fproto__":null}')),
    "lifecycle.knowledge.json-key",
  );

  const depth = FOUNDATION_KNOWLEDGE_STRUCTURAL_LIMITS.maximumJsonDepth + 1;
  expectCode(
    () => parseKnowledgeDocument("records/behavior/depth.md", documentFromJson(`{"x-depth":${"[".repeat(depth)}0${"]".repeat(depth)}}`)),
    "lifecycle.knowledge.json-depth",
  );
  const oversizedArray = new Array(FOUNDATION_KNOWLEDGE_STRUCTURAL_LIMITS.maximumArrayItems + 1).fill(0);
  expectCode(
    () => parseKnowledgeDocument("records/behavior/array.md", documentFromJson(JSON.stringify({ "x-items": oversizedArray }))),
    "lifecycle.knowledge.json-array",
  );
});

test("Knowledge document parsing enforces front-matter, body-line, and heading bounds", () => {
  const oversizedFrontMatter = JSON.stringify({ "x-payload": "a".repeat(KNOWLEDGE_MAXIMUM_FRONT_MATTER_BYTES) });
  expectCode(
    () => parseKnowledgeDocument("records/behavior/front-matter.md", documentFromJson(oversizedFrontMatter)),
    "lifecycle.knowledge.front-matter-size",
  );

  const tooManyLines = "body\n".repeat(FOUNDATION_KNOWLEDGE_STRUCTURAL_LIMITS.maximumBodyLines);
  expectCode(() => parseMarkdownHeadings(tooManyLines), "lifecycle.knowledge.body-lines");

  const tooManyHeadings = "### bounded\n".repeat(FOUNDATION_KNOWLEDGE_STRUCTURAL_LIMITS.maximumHeadings + 1);
  expectCode(() => parseMarkdownHeadings(tooManyHeadings), "lifecycle.knowledge.heading-count");

  const oversizedHeading = `# ${"a".repeat(FOUNDATION_KNOWLEDGE_STRUCTURAL_LIMITS.maximumHeadingBytes + 1)}\n`;
  expectCode(() => parseMarkdownHeadings(oversizedHeading), "lifecycle.knowledge.heading-size");
});

test("pinned CommonMark parsing derives exact top-level ATX and Setext heading labels", () => {
  const headings = parseMarkdownHeadings([
    "# **Parser** &amp; `input` [reference](https://example.invalid) ![diagram](diagram.png) <span>now</span> ###",
    "",
    "Setext *section*",
    "----------------",
    "",
    "> # Quoted heading",
    "",
    "```md",
    "# Fenced heading",
    "```",
    "",
    "#not-an-atx-heading",
    "",
    "### Lower level",
  ].join("\n"));
  assert.deepEqual(headings, [
    { level: 1, text: "Parser & input reference diagram now", line: 1 },
    { level: 2, text: "Setext section", line: 3 },
  ]);

  assert.deepEqual(parseMarkdownHeadings("First line\nsecond line\n===========\n"), [
    { level: 1, text: "First line\nsecond line", line: 1 },
  ]);
  assert.deepEqual(parseMarkdownHeadings("ATX title\r\n=========\r\n"), [
    { level: 1, text: "ATX title", line: 1 },
  ]);
});

test("Knowledge records preserve allowed extensions, apply exact schema shape first, and preserve optional-field presence", async () => {
  const repositoryContract = await contract();
  const extended = behaviorFrontMatter();
  extended["x-owner-metadata"] = { nested: ["preserved"] };
  extended.relationships = [{
    type: "related-to",
    target: "behavior.other",
    required: false,
    "x-weight": { value: 1 },
  }];
  const record = parseRecord(document(extended), repositoryContract);
  assert.deepEqual(JSON.parse(JSON.stringify(record.frontMatter.extensions["x-owner-metadata"])), { nested: ["preserved"] });
  assert.deepEqual(JSON.parse(JSON.stringify(record.frontMatter.relationships[0]!.extensions["x-weight"])), { value: 1 });
  assert.equal(Object.isFrozen(record.frontMatter.extensions["x-owner-metadata"]), true);
  assert.equal(Object.hasOwn(record.frontMatter.relationships[0]!.canonicalValue, "scope"), false);
  assert.equal(record.frontMatter.relationships[0]!.scope, null);

  const explicitNull = structuredClone(extended);
  explicitNull.relationships = [{
    type: "related-to",
    target: "behavior.other",
    required: false,
    scope: null,
    rationale: null,
    "x-weight": { value: 1 },
  }];
  const explicitRecord = parseRecord(document(explicitNull), repositoryContract);
  assert.equal(Object.hasOwn(explicitRecord.frontMatter.relationships[0]!.canonicalValue, "scope"), true);
  assert.notEqual(record.semanticDigest, explicitRecord.semanticDigest);

  const closedSpec = behaviorFrontMatter();
  (closedSpec.spec as Record<string, unknown>)["x-not-allowed"] = true;
  expectCode(() => parseRecord(document(closedSpec), repositoryContract), "lifecycle.schema.invalid");

  const closedSource = behaviorFrontMatter();
  closedSource.sources = [{
    id: "source-one",
    reference: "https://example.invalid/source",
    revision: null,
    digest: null,
    required: false,
    role: "research",
    "x-not-allowed": true,
  }];
  expectCode(() => parseRecord(document(closedSource), repositoryContract), "lifecycle.schema.invalid");

  const missingStatus = behaviorFrontMatter();
  delete missingStatus.status;
  expectCode(() => parseRecord(document(missingStatus), repositoryContract), "lifecycle.schema.invalid");

  const missingSourceRevision = behaviorFrontMatter();
  missingSourceRevision.sources = [{
    id: "source-one",
    required: false,
    reference: "https://example.invalid/source",
    digest: null,
    role: "research",
  }];
  expectCode(() => parseRecord(document(missingSourceRevision), repositoryContract), "lifecycle.schema.invalid");

  const missingSourceRequiredness = behaviorFrontMatter();
  missingSourceRequiredness.sources = [{
    id: "source-one",
    reference: "https://example.invalid/source",
    revision: null,
    digest: null,
    role: "research",
  }];
  expectCode(() => parseRecord(document(missingSourceRequiredness), repositoryContract), "lifecycle.schema.invalid");
});

test("the generated Draft 2020-12 engine asserts formats and emits deterministic Ajv diagnostics", async () => {
  const repositoryContract = await contract();
  const schemaIds = foundationSchemaIds();
  assert(schemaIds.includes("urn:lifecycle:schema:common:v2"));
  assert(schemaIds.includes(FOUNDATION_KNOWLEDGE_RECORD_SCHEMA_ID));
  assert.equal(new Set(schemaIds).size, schemaIds.length);
  assert.equal(FOUNDATION_SCHEMA_ENGINE_IDENTITY.version, "8.18.0");
  assert.equal(FOUNDATION_SCHEMA_ENGINE_IDENTITY.formats, "ajv-formats-full-3.0.1");

  const invalid = behaviorFrontMatter();
  invalid.sources = [{
    id: "source-one",
    required: false,
    reference: "http://[",
    revision: null,
    digest: null,
    role: "research",
  }];
  const first = expectCode(() => parseRecord(document(invalid), repositoryContract), "lifecycle.schema.invalid");
  const second = expectCode(() => parseRecord(document(invalid), repositoryContract), "lifecycle.schema.invalid");
  assert(Array.isArray(first.diagnostics));
  assert.deepEqual(first.diagnostics, second.diagnostics);
  const diagnostics = first.diagnostics as readonly { pointer: string | null; facts: Record<string, unknown> }[];
  assert(diagnostics.some((diagnostic) => diagnostic.pointer === "/sources/0/reference" && diagnostic.facts.keyword === "format"));
});

test("Knowledge records enforce byte-bounded normalized physical and coverage paths", async () => {
  const repositoryContract = await contract();
  const oversizedPath = `records/behavior/${"é".repeat(2_041)}.md`;
  expectCode(() => parseRecord(document(), repositoryContract, oversizedPath), "lifecycle.path.invalid");
  expectCode(() => parseRecord(document(), repositoryContract, "records/behavior/parser%2falias.md"), "lifecycle.path.invalid");
  expectCode(() => parseRecord(document(), repositoryContract, "records/behavior/parser?draft.md"), "lifecycle.path.invalid");

  const description = behaviorFrontMatter();
  description.kind = "description";
  description.id = "description.parser";
  description.title = "Parser description";
  description.spec = {
    responsibility: "Own parser behavior.",
    coverage: [{ path: `src/${"é".repeat(2_047)}`, mode: "file", role: "primary", exclude: [] }],
    behavior: ["parse input"],
    boundaries: ["do not execute input"],
    invariants: [],
    dependencies: [],
    failure: [],
    rationale: ["one owner"],
  };
  const descriptionBody = BEHAVIOR_BODY
    .replace("Parser behavior", "Parser description")
    .replace("Meaning", "Responsibility")
    .replace("Examples", "Behavior");
  expectCode(
    () => parseRecord(document(description, descriptionBody), repositoryContract, "src/_parser.desc.md"),
    "lifecycle.path.invalid",
  );
});

test("runtime has no disclosed direct structural parser limitation", () => {
  assert.deepEqual(FOUNDATION_KNOWLEDGE_STRUCTURAL_LIMITATIONS, []);
});
