import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { FOUNDATION_ATLAS_PROCESSOR_OUTPUT_MAXIMUM_BYTES } from "../../src/foundation/atlas/limits.js";
import { materializeAtlasState } from "../../src/foundation/atlas/materialization.js";
import { parseAtlasProcessorOutput } from "../../src/foundation/atlas/processor.js";
import { inventoryInstalledAtlasProcessor } from "../../src/foundation/atlas/processor-filesystem.js";
import {
  bindAtlasResourcesUnderPolicy,
  type FoundationAtlasResourceBindingHost,
  type FoundationAtlasResourceBindingLimits,
} from "../../src/foundation/atlas/resources.js";
import type { FoundationAtlasNormalizedModel, FoundationAtlasResource } from "../../src/foundation/atlas/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import type { FoundationGitTreeEntry } from "../../src/foundation/repository/types.js";
import { git, objectBlobBytes } from "../../src/foundation/repository/git.js";
import { digestCanonical, sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { minimalAtlasRepositoryState } from "../helpers/atlas-fixture.js";

const RESOURCE_LIMITS: FoundationAtlasResourceBindingLimits = Object.freeze({
  maximumResources: 8,
  maximumResourceBytes: 8,
  maximumAggregateBytes: 10,
  maximumElapsedMilliseconds: 10,
});

const PROCESSOR_LIMITS = Object.freeze({
  maximumEntries: 32,
  maximumDepth: 8,
  maximumFileBytes: 64,
  maximumAggregateBytes: 128,
  maximumElapsedMilliseconds: 1_000,
});

function modelWithResources(resources: readonly FoundationAtlasResource[]): FoundationAtlasNormalizedModel {
  const base = minimalAtlasRepositoryState().atlas.model;
  return Object.freeze({
    ...base,
    atlas: Object.freeze({ ...base.atlas, resources: Object.freeze(resources) }),
  });
}

function resource(id: string, uri: string): FoundationAtlasResource {
  return Object.freeze({ id, uri, title: id });
}

function treeEntry(path: string, objectId: string): FoundationGitTreeEntry {
  return Object.freeze({ path, mode: "100644", type: "blob", objectId });
}

function bindingOptions(
  resources: readonly FoundationAtlasResource[],
  treeEntries: readonly FoundationGitTreeEntry[] = Object.freeze([]),
): Parameters<typeof bindAtlasResourcesUnderPolicy>[0] {
  const state = minimalAtlasRepositoryState().atlasState;
  return {
    repository: "/private/unreadable-atlas-target",
    model: modelWithResources(resources),
    atlasState: state,
    treeEntries,
  };
}

function stableHost(readBlob: FoundationAtlasResourceBindingHost["readBlob"]): FoundationAtlasResourceBindingHost {
  return Object.freeze({ now: () => 0, readBlob });
}

function atlasFailure(error: unknown, code: string, excluded = ""): boolean {
  assert(error instanceof FoundationError);
  assert.equal(error.code, code);
  const publicFailure = JSON.stringify(error.toJSON());
  if (excluded.length > 0) assert.equal(publicFailure.includes(excluded), false);
  assert.equal(publicFailure.includes("/private/"), false);
  assert.equal(publicFailure.includes('"cause"'), false);
  return true;
}

test("Atlas Resource identity and count are preflight failures before any Git read", async () => {
  let reads = 0;
  const host = stableHost(async () => {
    reads += 1;
    throw new Error("must not read");
  });
  await assert.rejects(
    bindAtlasResourcesUnderPolicy(
      bindingOptions([resource("same", "one.md"), resource("same", "two.md")]),
      host,
      RESOURCE_LIMITS,
    ),
    (error: unknown) => atlasFailure(error, "lifecycle.atlas.result-invalid"),
  );
  await assert.rejects(
    bindAtlasResourcesUnderPolicy(
      bindingOptions([resource("a", "a.md"), resource("b", "b.md"), resource("c", "c.md")]),
      host,
      { ...RESOURCE_LIMITS, maximumResources: 2 },
    ),
    (error: unknown) => atlasFailure(error, "lifecycle.atlas.processing-incomplete"),
  );
  assert.equal(reads, 0);
});

test("Atlas Resource binding hashes each unique Git blob once", async () => {
  let reads = 0;
  const objectId = "a".repeat(40);
  const host = stableHost(async () => {
    reads += 1;
    return Buffer.from("shared", "utf8");
  });
  const result = await bindAtlasResourcesUnderPolicy(
    bindingOptions(
      [resource("first", "shared.md"), resource("second", "shared.md")],
      [treeEntry("atlas/shared.md", objectId)],
    ),
    host,
    RESOURCE_LIMITS,
  );
  assert.equal(reads, 1);
  assert.deepEqual(result.bindings.map(({ disposition }) => disposition), ["resolved", "resolved"]);
  assert.equal(result.bindings[0]!.byteDigest, result.bindings[1]!.byteDigest);
});

async function materializedResourceFixture() {
  const repository = await mkdtemp(join(tmpdir(), "lifecycle-atlas-resource-reuse-"));
  try {
    await git(repository, ["init", "-b", "main"]);
    const first = (await git(repository, ["hash-object", "-w", "--stdin"], { input: "shared" })).stdout.trim();
    const second = (await git(repository, ["hash-object", "-w", "--stdin"], { input: "second" })).stdout.trim();
    const entries = Object.freeze([
      Object.freeze({ path: "atlas/atlas.md", mode: "100644" as const, objectId: first }),
      Object.freeze({ path: "atlas/second.md", mode: "100644" as const, objectId: second }),
    ]);
    const atlasState = Object.freeze({ entries, digest: digestCanonical(entries) });
    const materialization = await materializeAtlasState(repository, atlasState, "atlas/atlas.md");
    let disposed = false;
    return {
      options: {
        repository, atlasState, materialization,
        treeEntries: Object.freeze(entries.map((entry) => Object.freeze({ ...entry, type: "blob" }))),
        model: modelWithResources([resource("first", "atlas.md"), resource("alias", "atlas.md")]),
      },
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        try { await materialization.cleanup(); }
        finally { await rm(repository, { recursive: true, force: true }); }
      },
    };
  } catch (error) {
    await rm(repository, { recursive: true, force: true });
    throw error;
  }
}

test("Atlas Resource binding reuses only exact materialization observations with unchanged output", async (context) => {
  const fixture = await materializedResourceFixture();
  context.after(fixture.dispose);
  // Real Git startup is outside this equivalence assertion; clock-bound cases retain the small policy.
  const limits = { ...RESOURCE_LIMITS, maximumElapsedMilliseconds: 10_000 };
  let reads = 0;
  const host = stableHost(async (...args) => { reads += 1; return objectBlobBytes(...args); });
  const { materialization: _materialization, ...withoutMaterialization } = fixture.options;
  const original = await bindAtlasResourcesUnderPolicy(withoutMaterialization, host, limits);
  assert.equal(reads, 1);
  reads = 0;
  const reused = await bindAtlasResourcesUnderPolicy(fixture.options, host, limits);
  assert.deepEqual(reused, original);
  assert.equal(reads, 0);
  assert.equal(reused.bindings[0]!.byteDigest, sha256Bytes(Buffer.from("shared")));
  assert.equal(reused.digest, digestCanonical(reused.bindings));
});

test("Atlas materialization reuse cannot substitute a repository, State, path, mode, object, or lifetime", async (context) => {
  const fixture = await materializedResourceFixture();
  context.after(fixture.dispose);
  const options = fixture.options;
  let reads = 0;
  const fallbackBytes = Buffer.from("fresh");
  const host = stableHost(async () => { reads += 1; return fallbackBytes; });
  const mutations: readonly Parameters<typeof bindAtlasResourcesUnderPolicy>[0][] = [
    { ...options, repository: `${options.repository}/another` },
    { ...options, atlasState: Object.freeze({ ...options.atlasState }) },
    { ...options, model: modelWithResources([resource("moved", "moved.md")]),
      treeEntries: [treeEntry("atlas/moved.md", options.treeEntries[0]!.objectId)] },
    { ...options, model: modelWithResources([resource("outside", "../src/external.md")]),
      treeEntries: [treeEntry("src/external.md", options.treeEntries[0]!.objectId)] },
    { ...options, treeEntries: [treeEntry("atlas/atlas.md", options.treeEntries[1]!.objectId)] },
    { ...options, materialization: Object.freeze({ ...options.materialization }) },
  ];
  for (const mutated of mutations) {
    reads = 0;
    const result = await bindAtlasResourcesUnderPolicy(mutated, host, RESOURCE_LIMITS);
    assert.equal(reads, 1);
    assert.equal(result.bindings[0]!.byteDigest, sha256Bytes(fallbackBytes));
  }
  for (const entry of [
    { ...options.treeEntries[0]!, mode: "100755" },
    { ...options.treeEntries[0]!, type: "commit" },
  ]) {
    reads = 0;
    const result = await bindAtlasResourcesUnderPolicy({ ...options, treeEntries: [entry] }, host, RESOURCE_LIMITS);
    assert.equal(reads, 0);
    assert(result.bindings.every(({ disposition }) => disposition === "unreadable"));
  }
  reads = 0;
  const missing = await bindAtlasResourcesUnderPolicy({ ...options, treeEntries: [] }, host, RESOURCE_LIMITS);
  assert.equal(reads, 0);
  assert(missing.bindings.every(({ disposition }) => disposition === "missing"));
  await fixture.dispose();
  reads = 0;
  const expired = await bindAtlasResourcesUnderPolicy(options, host, RESOURCE_LIMITS);
  assert.equal(reads, 1);
  assert.equal(expired.bindings[0]!.byteDigest, sha256Bytes(fallbackBytes));
});

test("reused Atlas Resource facts still consume all Resource bounds", async (context) => {
  const fixture = await materializedResourceFixture();
  context.after(fixture.dispose);
  let reads = 0;
  const host = stableHost(async () => { reads += 1; throw new Error("reused blob must not be read"); });
  const options = fixture.options;
  const unique = await bindAtlasResourcesUnderPolicy(options, host, { ...RESOURCE_LIMITS, maximumAggregateBytes: 6 });
  assert(unique.bindings.every(({ disposition }) => disposition === "resolved"));
  const oversized = await bindAtlasResourcesUnderPolicy(options, host, { ...RESOURCE_LIMITS, maximumResourceBytes: 5 });
  assert(oversized.bindings.every(({ disposition }) => disposition === "unreadable"));
  for (const [input, limits] of [
    [options, { ...RESOURCE_LIMITS, maximumResources: 1 }],
    [{ ...options, model: modelWithResources([resource("first", "atlas.md"), resource("second", "second.md")]) }, RESOURCE_LIMITS],
  ] as const) {
    await assert.rejects(bindAtlasResourcesUnderPolicy(input, host, limits),
      (error: unknown) => atlasFailure(error, "lifecycle.atlas.processing-incomplete"));
  }
  await assert.rejects(bindAtlasResourcesUnderPolicy({ ...options,
    model: modelWithResources([resource("same", "atlas.md"), resource("same", "second.md")]),
  }, host, RESOURCE_LIMITS), (error: unknown) => atlasFailure(error, "lifecycle.atlas.result-invalid"));
  let clockReads = 0;
  await assert.rejects(bindAtlasResourcesUnderPolicy(options, {
    ...host, now: () => clockReads++ < 2 ? 0 : 11,
  }, RESOURCE_LIMITS), (error: unknown) => atlasFailure(error, "lifecycle.atlas.processing-incomplete"));
  assert.equal(reads, 0);
});

test("Atlas Resource aggregate bytes and elapsed time fail closed without source disclosure", async () => {
  const aggregateMarker = "secret";
  const aggregateHost = stableHost(async (_repository, objectId) => Buffer.from(
    objectId.startsWith("a") ? aggregateMarker : "hidden",
    "utf8",
  ));
  await assert.rejects(
    bindAtlasResourcesUnderPolicy(
      bindingOptions(
        [resource("first", "first.md"), resource("second", "second.md")],
        [treeEntry("atlas/first.md", "a".repeat(40)), treeEntry("atlas/second.md", "b".repeat(40))],
      ),
      aggregateHost,
      RESOURCE_LIMITS,
    ),
    (error: unknown) => atlasFailure(error, "lifecycle.atlas.processing-incomplete", aggregateMarker),
  );

  let clockReads = 0;
  const elapsedHost: FoundationAtlasResourceBindingHost = Object.freeze({
    now: () => clockReads++ < 3 ? 0 : 11,
    readBlob: async () => Buffer.from("private-elapsed-resource", "utf8"),
  });
  await assert.rejects(
    bindAtlasResourcesUnderPolicy(
      bindingOptions(
        [resource("elapsed", "elapsed.md")],
        [treeEntry("atlas/elapsed.md", "c".repeat(40))],
      ),
      elapsedHost,
      RESOURCE_LIMITS,
    ),
    (error: unknown) => atlasFailure(
      error,
      "lifecycle.atlas.processing-incomplete",
      "private-elapsed-resource",
    ),
  );
});

async function processorFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-atlas-processor-private-"));
  await Promise.all([
    mkdir(join(root, "bin")),
    mkdir(join(root, "schemas")),
    mkdir(join(root, "src")),
    writeFile(join(root, "README.md"), "readme", "utf8"),
    writeFile(join(root, "package.json"), "{}", "utf8"),
  ]);
  return root;
}

test("installed Atlas processor inventory is bounded before payload reads", async (context) => {
  const root = await processorFixture();
  context.after(async () => await rm(root, { recursive: true, force: true }));

  const healthy = await inventoryInstalledAtlasProcessor(root, PROCESSOR_LIMITS, () => 0);
  assert.deepEqual(healthy.map(({ path }) => path), ["README.md", "package.json"]);

  await writeFile(join(root, "bin", "extra"), "x", "utf8");
  await assert.rejects(
    inventoryInstalledAtlasProcessor(root, { ...PROCESSOR_LIMITS, maximumEntries: 5 }, () => 0),
    (error: unknown) => atlasFailure(error, "lifecycle.atlas.processor-unavailable", root),
  );
  await assert.rejects(
    inventoryInstalledAtlasProcessor(root, { ...PROCESSOR_LIMITS, maximumDepth: 1 }, () => 0),
    (error: unknown) => atlasFailure(error, "lifecycle.atlas.processor-unavailable", root),
  );
  await assert.rejects(
    inventoryInstalledAtlasProcessor(root, { ...PROCESSOR_LIMITS, maximumFileBytes: 5 }, () => 0),
    (error: unknown) => atlasFailure(error, "lifecycle.atlas.processor-unavailable", root),
  );
  await assert.rejects(
    inventoryInstalledAtlasProcessor(root, { ...PROCESSOR_LIMITS, maximumAggregateBytes: 8 }, () => 0),
    (error: unknown) => atlasFailure(error, "lifecycle.atlas.processor-unavailable", root),
  );

  let clockReads = 0;
  await assert.rejects(
    inventoryInstalledAtlasProcessor(
      root,
      { ...PROCESSOR_LIMITS, maximumElapsedMilliseconds: 10 },
      () => clockReads++ === 0 ? 0 : 11,
    ),
    (error: unknown) => atlasFailure(error, "lifecycle.atlas.processor-unavailable", root),
  );
});

test("Atlas processor output parsing uses the Worker's explicit maximum", () => {
  const aboveStrictJsonDefault = JSON.stringify("x".repeat(4 * 1024 * 1024));
  assert.ok(Buffer.byteLength(aboveStrictJsonDefault, "utf8") < FOUNDATION_ATLAS_PROCESSOR_OUTPUT_MAXIMUM_BYTES);
  assert.equal(parseAtlasProcessorOutput(aboveStrictJsonDefault), "x".repeat(4 * 1024 * 1024));

  assert.throws(
    () => parseAtlasProcessorOutput(`{"duplicate":1,"duplicate":2}`),
    (error: unknown) => atlasFailure(error, "lifecycle.atlas.result-invalid"),
  );
});

test("Atlas Resource binding digest remains canonical under cached reads", async () => {
  const objectId = "d".repeat(40);
  const host = stableHost(async () => Buffer.from("bytes", "utf8"));
  const result = await bindAtlasResourcesUnderPolicy(
    bindingOptions([resource("one", "shared.md")], [treeEntry("atlas/shared.md", objectId)]),
    host,
    RESOURCE_LIMITS,
  );
  assert.equal(result.digest, digestCanonical(result.bindings));
});
