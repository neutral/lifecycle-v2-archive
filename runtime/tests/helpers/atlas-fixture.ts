import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { FOUNDATION_ATLAS_PROCESSOR, FOUNDATION_ATLAS_SELECTION } from "../../src/foundation/atlas/selection.js";
import type {
  FoundationAtlasState,
  FoundationGitTreeEntry,
} from "../../src/foundation/repository/types.js";
import type {
  FoundationAtlasNormalizedModel,
  FoundationResolvedAtlas,
} from "../../src/foundation/atlas/types.js";
import { digestCanonical, selfDigest, type Sha256 } from "../../src/foundation/validation/canonical.js";

export const MINIMAL_ATLAS_FILES = Object.freeze({
  "atlas/atlas.md": `---
{
  "type": "atlas",
  "format": 1,
  "id": "target",
  "title": "Target Atlas",
  "summary": "Exact project context for the Lifecycle target fixture.",
  "navigation": [
    {
      "title": "Project",
      "maps": [
        "project"
      ]
    }
  ]
}
---

# Target Atlas

This Atlas supplies one bounded current project-context model for Lifecycle tests.
`,
  "atlas/maps/project/map.md": `---
{
  "type": "map",
  "id": "project",
  "title": "Project",
  "summary": "Current project context for the Lifecycle target fixture.",
  "question": "What durable context governs this target fixture?",
  "status": "active",
  "areas": [
    {
      "id": "scope",
      "title": "Scope",
      "summary": "The bounded product scope exercised by this target fixture.",
      "question": "What belongs inside the current product scope?"
    }
  ]
}
---

# Project

This Map routes the target fixture's bounded and current project context.
`,
  "atlas/maps/project/points/project-scope.md": `---
{
  "type": "point",
  "record": "anchor",
  "id": "project-scope",
  "title": "Project scope",
  "summary": "The fixture exercises only its explicitly declared target behavior.",
  "kinds": [
    "constraint"
  ],
  "posture": "asserted",
  "lifecycle": "active",
  "areas": [
    {
      "area": "scope",
      "context": "This Point fixes the bounded scope exercised by the target fixture."
    }
  ]
}
---

# Project scope

The target fixture changes only behavior explicitly selected by its Lifecycle test.
`,
});

export async function writeMinimalAtlas(root: string): Promise<void> {
  for (const [path, source] of Object.entries(MINIMAL_ATLAS_FILES)) {
    const destination = join(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, source, "utf8");
  }
}

function gitBlobObjectId(source: string): string {
  const bytes = Buffer.from(source, "utf8");
  return createHash("sha1")
    .update(Buffer.from(`blob ${bytes.byteLength}\0`, "utf8"))
    .update(bytes)
    .digest("hex");
}

function authoredBody(source: string): string {
  const lines = source.replace(/\r\n/gu, "\n").split("\n");
  const closingDelimiter = lines.indexOf("---", 1);
  if (closingDelimiter < 0) throw new Error("Minimal Atlas fixture has unclosed front matter");
  return lines.slice(closingDelimiter + 1).join("\n");
}

/** One internally coherent synthetic raw Atlas boundary and its resolved model. */
export function minimalAtlasRepositoryState(): Readonly<{
  treeEntries: readonly FoundationGitTreeEntry[];
  atlasState: FoundationAtlasState;
  atlas: FoundationResolvedAtlas;
}> {
  const entries = Object.freeze(Object.entries(MINIMAL_ATLAS_FILES)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([path, source]) => Object.freeze({
      path,
      mode: "100644" as const,
      objectId: gitBlobObjectId(source),
    })));
  const atlasState = Object.freeze({ entries, digest: digestCanonical(entries) });
  return Object.freeze({
    treeEntries: Object.freeze(entries.map((entry) => Object.freeze({ ...entry, type: "blob" }))),
    atlasState,
    atlas: minimalResolvedAtlas(atlasState.digest),
  });
}

export function minimalResolvedAtlas(atlasStateDigest: Sha256): FoundationResolvedAtlas {
  const model: FoundationAtlasNormalizedModel = Object.freeze({
    format: 1,
    atlas: Object.freeze({
      id: "target",
      title: "Target Atlas",
      summary: "Exact project context for the Lifecycle target fixture.",
      navigation: Object.freeze([Object.freeze({ title: "Project", maps: Object.freeze(["project"]) })]),
      resources: Object.freeze([]),
      content: Object.freeze([]),
      references: Object.freeze([]),
      extensions: Object.freeze({}),
      body: authoredBody(MINIMAL_ATLAS_FILES["atlas/atlas.md"]),
    }),
    maps: Object.freeze([Object.freeze({
      id: "project",
      title: "Project",
      summary: "Current project context for the Lifecycle target fixture.",
      question: "What durable context governs this target fixture?",
      status: "active",
      path: "maps/project/map.md",
      areas: Object.freeze([Object.freeze({
        id: "scope",
        title: "Scope",
        summary: "The bounded product scope exercised by this target fixture.",
        question: "What belongs inside the current product scope?",
      })]),
      content: Object.freeze([]),
      references: Object.freeze([]),
      extensions: Object.freeze({}),
      body: authoredBody(MINIMAL_ATLAS_FILES["atlas/maps/project/map.md"]),
      pointIds: Object.freeze(["project-scope"]),
      anchorPointIds: Object.freeze(["project-scope"]),
      contextPointIds: Object.freeze([]),
    })]),
    points: Object.freeze([Object.freeze({
      id: "project-scope",
      title: "Project scope",
      summary: "The fixture exercises only its explicitly declared target behavior.",
      kinds: Object.freeze(["constraint"]),
      posture: "asserted",
      lifecycle: "active",
      primaryMap: "project",
      anchorPath: "maps/project/points/project-scope.md",
      records: Object.freeze([Object.freeze({
        kind: "anchor",
        map: "project",
        path: "maps/project/points/project-scope.md",
        summary: "The fixture exercises only its explicitly declared target behavior.",
        areas: Object.freeze([Object.freeze({
          area: "scope",
          context: "This Point fixes the bounded scope exercised by the target fixture.",
        })]),
        content: Object.freeze([]),
        references: Object.freeze([]),
        extensions: Object.freeze({}),
        body: authoredBody(MINIMAL_ATLAS_FILES["atlas/maps/project/points/project-scope.md"]),
      })]),
      relations: Object.freeze([]),
      incomingRelations: Object.freeze([]),
      review: null,
      extensions: Object.freeze({}),
    })]),
    checks: Object.freeze([]),
    publicationProfiles: Object.freeze([]),
    relatedMaps: Object.freeze([]),
  });
  const validationResult = Object.freeze({
    profile: FOUNDATION_ATLAS_SELECTION.validationProfile,
    complete: true as const,
    valid: true as const,
    specificationRevision: FOUNDATION_ATLAS_SELECTION.specificationRevision,
    implementation: Object.freeze({ name: "atlas-reference-validator" as const, version: "0.8.0" as const, status: "stable" as const }),
    diagnostics: Object.freeze([]),
    normalized: model,
  });
  const resourceBindings = Object.freeze([]);
  const subject = {
    schema: "lifecycle.atlas-resolution.v2" as const,
    selection: FOUNDATION_ATLAS_SELECTION,
    atlasStateDigest,
    resourceBindings,
    resourceBindingsDigest: digestCanonical(resourceBindings),
    processor: FOUNDATION_ATLAS_PROCESSOR,
    externalValidationResultDigest: digestCanonical(validationResult),
    normalizedModelDigest: digestCanonical(model),
    complete: true as const,
    valid: true as const,
  };
  return Object.freeze({
    resolution: Object.freeze({ ...subject, digest: selfDigest(subject) }),
    validationResult,
    model,
  });
}
