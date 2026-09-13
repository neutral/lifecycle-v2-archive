import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { parseDisciplinePack, verifyDisciplinePackRecords } from "../../src/foundation/knowledge/discipline-pack.js";
import { parseKnowledgeRecord } from "../../src/foundation/knowledge/records.js";
import { FOUNDATION_REPOSITORY_KNOWLEDGE_LIMITS } from "../../src/foundation/repository/contract.js";
import { selfDigest } from "../../src/foundation/validation/canonical.js";

function fixture(revision = 1) {
  const frontMatter = {
    schema: "lifecycle.knowledge-record.v2", kind: "discipline", id: "discipline.go.review",
    title: "Focused review", status: "current", revision, supersedes: revision === 1 ? null : { id: "discipline.go.review", revision: revision - 1, sourceDigest: `sha256:${"a".repeat(64)}`, semanticDigest: `sha256:${"b".repeat(64)}` },
    summary: "Review the changed behavior.", owners: ["publisher.example"], sources: [], relationships: [], conflicts: [], tags: [],
    spec: { practice: "Keep reviews focused.", appliesWhen: ["Go development"], doesNotApplyWhen: [], guidance: ["Read the exact diff."], verification: [] },
  };
  const bytes = Buffer.from(`---\n${JSON.stringify(frontMatter)}\n---\n\n# Focused review\n\n${["Practice", "Applicability", "Guidance", "Verification"].map((heading) => `## ${heading}\n\nReview with judgment.\n`).join("\n")}`);
  const record = parseKnowledgeRecord({
    path: "records/disciplines/go.md", mode: "100644", objectId: "a".repeat(40), bytes,
    contract: { atlas: { root: "atlas" }, knowledge: { limits: FOUNDATION_REPOSITORY_KNOWLEDGE_LIMITS,
      roots: { behavior: "records/behavior", assurance: "records/assurance", blueprint: "records/blueprint", check: "records/checks", discipline: "records/disciplines", disciplineRegistry: "records/disciplines/registry.json", descriptionPattern: "**/_*.desc.md" } } },
  });
  const subject = {
    schema: "lifecycle.discipline-pack.v1", id: "example.go", title: "Go review", version: "1.0.0", publisher: "publisher.example",
    contract: { specificationRevision: "lifecycle.foundation.1.0.0-rc.9", knowledgeRecordSchema: "urn:lifecycle:schema:knowledge-record:v2" },
    records: [{ id: record.frontMatter.id, path: "records/go.md", revision, sourceDigest: record.sourceDigest, semanticDigest: record.semanticDigest }],
    sets: [{ id: "go-review", title: "Go review", description: "Focused Go work", recordIds: [record.frontMatter.id] }],
  };
  return { subject, bytes, entries: [{ path: "records/go.md", mode: "100644", bytes }] };
}

const manifest = (subject: Record<string, unknown>) => Buffer.from(JSON.stringify({ ...subject, digest: selfDigest(subject) }));

test("Pack validation reuses current Knowledge semantics while retaining exact authoring provenance", () => {
  const { subject, entries } = fixture();
  const bytes = manifest(subject);
  const pack = parseDisciplinePack(bytes);
  assert.equal(verifyDisciplinePackRecords(pack, entries), pack);
  assert.equal(pack.contract.specificationRevision, "lifecycle.foundation.1.0.0-rc.9");
  assert.equal(pack.digest, selfDigest(subject));
  const later = fixture(7);
  assert.equal(verifyDisciplinePackRecords(parseDisciplinePack(manifest(later.subject)), later.entries).records[0]!.revision, 7);
  assert.throws(() => parseDisciplinePack(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes])));
  const sets = [{ ...subject.sets[0]!, id: "z-first" }, { ...subject.sets[0]!, id: "a-next" }];
  assert.deepEqual(parseDisciplinePack(manifest({ ...subject, sets })).sets, sets);
  assert.throws(() => parseDisciplinePack(manifest({ ...subject, contract: { ...subject.contract, knowledgeRecordSchema: "urn:lifecycle:schema:knowledge-record:v1" } })));
});

test("Pack mutation campaign rejects wrong inventory, source bytes, publisher, Set membership and unsafe paths", () => {
  const { subject, entries } = fixture();
  for (const mutated of [
    { ...subject, publisher: "another.publisher" },
    { ...subject, records: [{ ...subject.records[0]!, revision: 2 }] },
    { ...subject, records: [{ ...subject.records[0]!, sourceDigest: `sha256:${"0".repeat(64)}` }] },
    { ...subject, records: [{ ...subject.records[0]!, semanticDigest: `sha256:${"0".repeat(64)}` }] },
    { ...subject, records: [subject.records[0], subject.records[0]] },
    { ...subject, records: [{ ...subject.records[0]!, path: "../outside.md" }] },
    { ...subject, sets: [{ ...subject.sets[0]!, recordIds: ["discipline.absent"] }] },
  ]) {
    assert.throws(() => verifyDisciplinePackRecords(parseDisciplinePack(manifest(mutated)), entries));
  }
  const pack = parseDisciplinePack(manifest(subject));
  assert.throws(() => verifyDisciplinePackRecords(pack, []));
  assert.throws(() => verifyDisciplinePackRecords(pack, [{ ...entries[0]!, mode: "100755" }]));
  assert.throws(() => verifyDisciplinePackRecords(pack, [{ ...entries[0]!, bytes: Buffer.concat([entries[0]!.bytes, Buffer.from("\n")]) }]));
  assert.throws(() => parseDisciplinePack(Buffer.from(JSON.stringify({ ...subject, digest: `sha256:${"0".repeat(64)}` }))));
});

test("repository Pack validation helper reads exact files and refuses a symlink record", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-discipline-pack-"));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const { subject, bytes } = fixture();
  await mkdir(join(root, "records"));
  await writeFile(join(root, "pack.json"), manifest(subject));
  await writeFile(join(root, "records/go.md"), bytes);
  const script = new URL("../../../scripts/validate-discipline-pack.mjs", import.meta.url);
  const run = () => execFileSync(process.execPath, [script.pathname, root], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const result = JSON.parse(run());
  assert.equal(result.valid, true);
  assert.equal(result.pack.manifestDigest, selfDigest(subject));
  await rm(join(root, "records/go.md"));
  await writeFile(join(root, "outside.md"), bytes);
  await symlink("../outside.md", join(root, "records/go.md"));
  assert.throws(run);
});
