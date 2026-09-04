import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { processMaterializedAtlas } from "../../src/foundation/atlas/processor.js";
import { resolveAtlas } from "../../src/foundation/atlas/resolution.js";
import { FoundationError } from "../../src/foundation/error.js";
import type { FoundationAtlasState } from "../../src/foundation/repository/types.js";
import { digestCanonical } from "../../src/foundation/validation/canonical.js";

function sanitizedFailure(error: unknown, marker: string, code: string): boolean {
  assert(error instanceof FoundationError);
  assert.equal(error.code, code);
  const json = JSON.stringify(error.toJSON());
  assert.equal(json.includes(marker), false);
  assert.equal(json.includes(tmpdir()), false);
  assert.equal(json.includes('"cause"'), false);
  return true;
}

test("Atlas Worker failures expose no raw caught message or private entrypoint", async () => {
  const marker = "private-atlas-worker-marker";
  const privateEntrypoint = `${join(tmpdir(), marker, "atlas.md")}\u0000`;
  await assert.rejects(
    processMaterializedAtlas(privateEntrypoint),
    (error: unknown) => sanitizedFailure(
      error,
      marker,
      "lifecycle.atlas.processing-incomplete",
    ),
  );
});

test("Atlas materialization masks the private repository path in underlying Git failures", async () => {
  const marker = "private-atlas-repository-marker";
  const repository = join(tmpdir(), marker, "target");
  const entries = Object.freeze([Object.freeze({
    path: "atlas/atlas.md",
    mode: "100644" as const,
    objectId: "a".repeat(40),
  })]);
  const atlasState: FoundationAtlasState = Object.freeze({
    entries,
    digest: digestCanonical(entries),
  });
  await assert.rejects(resolveAtlas({
    repository,
    entrypoint: "atlas/atlas.md",
    atlasState,
    treeEntries: Object.freeze([]),
  }), (error: unknown) => sanitizedFailure(
    error,
    marker,
    "lifecycle.atlas.processing-incomplete",
  ));
});
