import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { FoundationError } from "../../src/foundation/error.js";
import {
  createEmptyDisciplineRegistry,
  parseDisciplineRegistry,
  validateDisciplineRegistryRecords,
} from "../../src/foundation/knowledge/discipline-registry.js";
import { expectedKnowledgeKind, parseKnowledgeRecord } from "../../src/foundation/knowledge/records.js";
import type { FoundationDisciplineRegistry } from "../../src/foundation/knowledge/types.js";
import { createFoundationAuthority, receiveFoundationAuthorityCredential } from "../../src/foundation/repository/authority.js";
import { createRepositoryContract } from "../../src/foundation/repository/contract.js";
import { isDisciplineMaintenancePath, productStateRole } from "../../src/foundation/repository/product-state.js";
import type { FoundationRepositoryContract } from "../../src/foundation/repository/types.js";
import { canonicalPrettyJson, selfDigest, sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { foundationDisciplineAdoptionFixture, TEST_DISCIPLINE_PATH } from "../helpers/foundation-discipline-fixture.js";

let contractPromise: Promise<FoundationRepositoryContract> | undefined;
function contract(): Promise<FoundationRepositoryContract> {
  contractPromise ??= (async () => {
    const home = await mkdtemp(`${tmpdir()}/lifecycle-discipline-registry-`);
    const authority = await createFoundationAuthority(home, "discipline-registry-target", receiveFoundationAuthorityCredential(
      "discipline-registry-test-secret-at-least-thirty-two-bytes", "initialize",
    ));
    return createRepositoryContract({
      targetId: "discipline-registry-target",
      canonicalBranch: "refs/heads/main",
      authority,
      publicationDigest: sha256Bytes("discipline-registry-publication"),
      implementationRoots: [],
    });
  })();
  return contractPromise;
}

function rehash(registry: FoundationDisciplineRegistry): FoundationDisciplineRegistry {
  return { ...registry, digest: selfDigest(registry) };
}

function encoded(registry: FoundationDisciplineRegistry): Buffer {
  return Buffer.from(canonicalPrettyJson(registry));
}

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof FoundationError && error.code === code;
}

test("empty and adopted Registries round trip with exact publisher and Work Type discovery facts", async () => {
  const policy = await contract();
  const empty = createEmptyDisciplineRegistry();
  assert.deepEqual(parseDisciplineRegistry(encoded(empty), policy), empty);
  validateDisciplineRegistryRecords(empty, []);
  const fixture = foundationDisciplineAdoptionFixture(policy);
  const parsed = parseDisciplineRegistry(encoded(fixture.registry), policy);
  assert.deepEqual(parsed, fixture.registry);
  validateDisciplineRegistryRecords(parsed, [fixture.record]);
  assert.equal(parsed.packs[0]!.publisher, fixture.record.frontMatter.owners[0]);
  assert.deepEqual(parsed.workTypes[0]!.disciplineIds, [fixture.record.frontMatter.id]);
});

test("Registry rejects a leading UTF-8 BOM through the existing strict JSON parser", async () => {
  const policy = await contract();
  const registry = foundationDisciplineAdoptionFixture(policy).registry;
  const bytes = encoded(registry);
  assert.deepEqual(parseDisciplineRegistry(bytes, policy), registry);
  assert.throws(
    () => parseDisciplineRegistry(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]), policy),
    { code: "foundation.json.parse" },
  );
});

test("Registry adoption binds identity, revision, path, exact source bytes, and semantic digest independently", async () => {
  const policy = await contract();
  const fixture = foundationDisciplineAdoptionFixture(policy);
  const original = fixture.registry.adoptions[0]!;
  const mutations = [
    { id: "discipline.another" },
    { revision: original.revision + 1 },
    { path: "records/disciplines/another.md" },
    { sourceDigest: sha256Bytes("other source") },
    { semanticDigest: sha256Bytes("other semantic value") },
  ] as const;
  for (const mutation of mutations) {
    const substituted = rehash({ ...fixture.registry, adoptions: [{ ...original, ...mutation }], workTypes: [] });
    const parsed = parseDisciplineRegistry(encoded(substituted), policy);
    assert.throws(() => validateDisciplineRegistryRecords(parsed, [fixture.record]),
      hasCode("lifecycle.discipline.registry-adoption-mismatch"), JSON.stringify(mutation));
  }
  const changedBytes = parseKnowledgeRecord({
    path: fixture.record.path,
    mode: "100644",
    objectId: "e".repeat(40),
    bytes: Buffer.from(fixture.document.replaceAll("\n", "\r\n")),
    contract: policy,
  });
  assert.equal(changedBytes.semanticDigest, fixture.record.semanticDigest);
  assert.notEqual(changedBytes.sourceDigest, fixture.record.sourceDigest);
  assert.throws(() => validateDisciplineRegistryRecords(fixture.registry, [changedBytes]),
    hasCode("lifecycle.discipline.registry-adoption-mismatch"));
  assert.throws(() => validateDisciplineRegistryRecords(createEmptyDisciplineRegistry(), [fixture.record]),
    hasCode("lifecycle.discipline.registry-coverage"));
  assert.throws(() => validateDisciplineRegistryRecords(fixture.registry, []),
    hasCode("lifecycle.discipline.registry-coverage"));
});

test("Registry refuses substituted digest, unknown Pack or adoption, duplicate identities, and target-external paths", async () => {
  const policy = await contract();
  const fixture = foundationDisciplineAdoptionFixture(policy);
  const registry = fixture.registry;
  assert.throws(() => parseDisciplineRegistry(encoded({ ...registry, digest: sha256Bytes("different") }), policy),
    hasCode("lifecycle.discipline.registry-digest"));
  assert.throws(() => parseDisciplineRegistry(encoded(rehash({ ...registry, packs: [] })), policy),
    hasCode("lifecycle.discipline.registry-pack-missing"));
  assert.throws(() => parseDisciplineRegistry(encoded(rehash({ ...registry, adoptions: [] })), policy),
    hasCode("lifecycle.discipline.registry-adoption-missing"));
  const duplicate = rehash({ ...registry, packs: [...registry.packs, { ...registry.packs[0]!, version: "2.0.0" }] });
  assert.throws(() => parseDisciplineRegistry(encoded(duplicate), policy), hasCode("lifecycle.discipline.registry-duplicate"));
  for (const path of ["../outside.md", "records/discipline/old.md", "records/disciplines/../outside.md", "src/advisory.md"]) {
    const substituted = rehash({ ...registry, adoptions: [{ ...registry.adoptions[0]!, path }] });
    assert.throws(() => parseDisciplineRegistry(encoded(substituted), policy), FoundationError, path);
  }
});

test("Work Types are overlapping discovery groups whose ordering is canonical, not mandatory adoption sets", async () => {
  const policy = await contract();
  const fixture = foundationDisciplineAdoptionFixture(policy);
  const secondPack = { ...fixture.registry.packs[0]!, id: "another-pack", version: "2.0.0" };
  const firstWorkType = fixture.registry.workTypes[0]!;
  const secondWorkType = { ...firstWorkType, id: "focused-review", title: "Focused review" };
  const canonical = rehash({
    ...fixture.registry,
    packs: [secondPack, fixture.registry.packs[0]!],
    workTypes: [secondWorkType, firstWorkType],
  });
  // Enumerate every permutation of these two independent two-item groups.
  for (const reversePacks of [false, true]) {
    for (const reverseWorkTypes of [false, true]) {
      const reordered = {
        ...canonical,
        packs: reversePacks ? [...canonical.packs].reverse() : canonical.packs,
        workTypes: reverseWorkTypes ? [...canonical.workTypes].reverse() : canonical.workTypes,
      };
      assert.deepEqual(parseDisciplineRegistry(encoded(reordered), policy), canonical);
    }
  }
  const ungrouped = rehash({ ...fixture.registry, workTypes: [] });
  validateDisciplineRegistryRecords(parseDisciplineRegistry(encoded(ungrouped), policy), [fixture.record]);
});

test("the entire adopted Discipline root has Knowledge custody and is maintained outside Delivery", async () => {
  const policy = await contract();
  for (const path of ["records/disciplines", "records/disciplines/registry.json", TEST_DISCIPLINE_PATH, "records/disciplines/nested/extra.json"]) {
    assert.equal(isDisciplineMaintenancePath(policy, path), true, path);
    assert.equal(productStateRole(policy, path), "knowledge", path);
  }
  for (const path of ["records/discipline/old.md", "records/disciplines-other/record.md", "src/a.ts"]) {
    assert.equal(isDisciplineMaintenancePath(policy, path), false, path);
  }
  assert.equal(expectedKnowledgeKind(TEST_DISCIPLINE_PATH, policy), "discipline");
  assert.equal(expectedKnowledgeKind("records/disciplines/registry.json", policy), null);
});

test("Discipline records carry optional provenance and related-to context without authority-bearing edges", async () => {
  const policy = await contract();
  const fixture = foundationDisciplineAdoptionFixture(policy);
  const frontMatterText = fixture.document.split("---\n")[1]!;
  const frontMatter = JSON.parse(frontMatterText) as Record<string, unknown>;
  const parse = (fields: Record<string, unknown>) => parseKnowledgeRecord({
    path: TEST_DISCIPLINE_PATH, mode: "100644", objectId: "a".repeat(40), contract: policy,
    bytes: Buffer.from(fixture.document.replace(frontMatterText, `${JSON.stringify({ ...frontMatter, ...fields }, null, 2)}\n`)),
  });
  assert.doesNotThrow(() => parse({ relationships: [{ type: "related-to", target: "discipline.other", required: false }] }));
  for (const relationship of [
    { type: "related-to", target: "discipline.other", required: true },
    { type: "depends-on", target: "discipline.other", required: false },
    { type: "constrains", target: "behavior.target", required: false },
  ]) assert.throws(() => parse({ relationships: [relationship] }), FoundationError);
  const source = { id: "publisher-notes", required: false, reference: "https://example.invalid/notes", revision: "v1", digest: sha256Bytes("notes"), role: "research" };
  assert.doesNotThrow(() => parse({ sources: [source] }));
  assert.throws(() => parse({ sources: [{ ...source, required: true }] }), hasCode("lifecycle.discipline.source-required"));
  assert.throws(() => parse({ schema: "lifecycle.knowledge-record.v1" }), FoundationError);
});
