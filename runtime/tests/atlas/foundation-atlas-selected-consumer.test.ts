import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { processMaterializedAtlas } from "../../src/foundation/atlas/processor.js";
import { FOUNDATION_ATLAS_PROCESSOR, FOUNDATION_ATLAS_SELECTION } from "../../src/foundation/atlas/selection.js";
import { FoundationError } from "../../src/foundation/error.js";
import { MINIMAL_ATLAS_FILES, writeMinimalAtlas } from "../helpers/atlas-fixture.js";

test("Selected Atlas 0.8 processor accepts strict JSON and summary-only anchors", async () => {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-atlas-consumer-"));
  try {
    await writeMinimalAtlas(root);
    const path = "atlas/maps/project/points/project-scope.md";
    const source = MINIMAL_ATLAS_FILES[path];
    const close = source.indexOf("\n---", 4);
    await writeFile(join(root, path), source.slice(0, close + 4) + "\n", "utf8");
    const processed = await processMaterializedAtlas(join(root, "atlas/atlas.md"));
    assert.equal(processed.result.complete, true);
    assert.equal(processed.result.valid, true);
    assert.equal(processed.result.specificationRevision, FOUNDATION_ATLAS_SELECTION.specificationRevision);
    assert.equal(processed.result.implementation.version, FOUNDATION_ATLAS_PROCESSOR.version);
    assert.equal(processed.result.implementation.status, "stable");
    assert.equal(processed.model.points[0]?.records[0]?.body, "");
    assert.equal(processed.model.points[0]?.id, "project-scope");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Selected Atlas consumer refuses YAML and duplicate decoded JSON member names", async () => {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-atlas-consumer-"));
  try {
    await writeMinimalAtlas(root);
    const valid = MINIMAL_ATLAS_FILES["atlas/atlas.md"];
    const invalidSources = [
      "---\ntype: atlas\nformat: 1\nid: target\ntitle: Target Atlas\nsummary: Previous YAML format\n---\n",
      valid.replace('"type": "atlas",', '"type": "atlas", "ty\\u0070e": "atlas",'),
    ];
    for (const source of invalidSources) {
      await writeFile(join(root, "atlas/atlas.md"), source, "utf8");
      await assert.rejects(processMaterializedAtlas(join(root, "atlas/atlas.md")), (error: unknown) => {
        assert(error instanceof FoundationError);
        assert.equal(error.code, "lifecycle.atlas.invalid");
        return true;
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
