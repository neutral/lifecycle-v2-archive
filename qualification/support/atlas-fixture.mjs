import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const QUALIFICATION_ATLAS_FILES = Object.freeze({
  "atlas/atlas.md": `---
{
  "type": "atlas",
  "format": 1,
  "id": "qualification-target",
  "title": "Qualification target Atlas",
  "summary": "Exact current project context for the disposable Lifecycle qualification target.",
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

# Qualification target Atlas

This separately maintained Atlas supplies bounded read-only context to Lifecycle.
`,
  "atlas/maps/project/map.md": `---
{
  "type": "map",
  "id": "project",
  "title": "Project",
  "summary": "Current project context for the disposable Lifecycle qualification target.",
  "question": "What durable context governs this qualification target?",
  "status": "active",
  "areas": [
    {
      "id": "scope",
      "title": "Scope",
      "summary": "The bounded scope exercised by the qualification route.",
      "question": "What belongs inside the current qualification scope?"
    }
  ]
}
---

# Project

This Map routes the qualification target's bounded current context.
`,
  "atlas/maps/project/points/project-scope.md": `---
{
  "type": "point",
  "record": "anchor",
  "id": "project-scope",
  "title": "Project scope",
  "summary": "The qualification route exercises only its explicitly declared target behavior.",
  "kinds": [
    "constraint"
  ],
  "posture": "asserted",
  "lifecycle": "active",
  "areas": [
    {
      "area": "scope",
      "context": "This Point fixes the bounded scope exercised by qualification."
    }
  ]
}
---

# Project scope

Qualification changes only behavior selected by its admitted Lifecycle boundary.
`,
});

export async function writeQualificationAtlas(root) {
  for (const [path, source] of Object.entries(QUALIFICATION_ATLAS_FILES)) {
    const destination = join(root, path);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, source, "utf8");
  }
}
