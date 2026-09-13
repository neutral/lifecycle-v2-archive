import type { FoundationDisciplineRegistry } from "../../src/foundation/knowledge/types.js";
import { parseKnowledgeRecord } from "../../src/foundation/knowledge/records.js";
import type { FoundationRepositoryContract } from "../../src/foundation/repository/types.js";
import { canonicalPrettyJson, selfDigest, sha256Bytes } from "../../src/foundation/validation/canonical.js";

export const TEST_DISCIPLINE_ID = "discipline.go-review" as const;
export const TEST_DISCIPLINE_PATH = "records/disciplines/go-review.md" as const;
export const TEST_DISCIPLINE_WORK_TYPE_ID = "go-development" as const;

export function foundationDisciplineAdoptionFixture(contract: FoundationRepositoryContract): Readonly<{
  document: string;
  record: ReturnType<typeof parseKnowledgeRecord>;
  registry: FoundationDisciplineRegistry;
  registryDocument: string;
}> {
  const publisher = "neutral.disciplines";
  const title = "Focused Go review";
  const frontMatter = {
    schema: "lifecycle.knowledge-record.v2",
    kind: "discipline",
    id: TEST_DISCIPLINE_ID,
    title,
    status: "current",
    revision: 1,
    supersedes: null,
    summary: "Use focused review and tests for Go implementation changes.",
    owners: [publisher],
    sources: [],
    relationships: [],
    conflicts: [],
    tags: ["go", "review"],
    spec: {
      practice: "Keep Go review changes small, explicit, and directly testable.",
      appliesWhen: ["developing or reviewing Go implementation changes"],
      doesNotApplyWhen: ["the selected work contains no Go implementation"],
      guidance: ["Prefer focused tests beside the changed behavior."],
      verification: ["Inspect the exact diff and focused test result."],
    },
  };
  const document = `---\n${JSON.stringify(frontMatter, null, 2)}\n---\n\n# ${title}\n\n## Practice\n\nKeep the change focused.\n\n## Applicability\n\nUse this record when the selected work includes Go implementation.\n\n## Guidance\n\nPrefer a focused test near the changed behavior.\n\n## Verification\n\nInspect the exact diff and focused test result.\n`;
  const record = parseKnowledgeRecord({
    path: TEST_DISCIPLINE_PATH,
    mode: "100644",
    objectId: "d".repeat(40),
    bytes: Buffer.from(document, "utf8"),
    contract,
  });
  const registrySubject = {
    schema: "lifecycle.discipline-registry.v1" as const,
    packs: Object.freeze([Object.freeze({
      id: "neutral-go",
      publisher,
      version: "1.0.0",
      source: "https://example.invalid/neutral-go",
      revision: "pack-revision-1",
      manifestDigest: sha256Bytes("neutral-go-pack"),
    })]),
    adoptions: Object.freeze([Object.freeze({
      id: record.frontMatter.id,
      revision: record.frontMatter.revision,
      path: record.path,
      sourceDigest: record.sourceDigest,
      semanticDigest: record.semanticDigest,
      packId: "neutral-go",
    })]),
    workTypes: Object.freeze([Object.freeze({
      id: TEST_DISCIPLINE_WORK_TYPE_ID,
      title: "Go development",
      description: "Implementation and review of Go software.",
      disciplineIds: Object.freeze([record.frontMatter.id]),
    })]),
  };
  const registry: FoundationDisciplineRegistry = Object.freeze({
    ...registrySubject,
    digest: selfDigest(registrySubject),
  });
  return Object.freeze({
    document,
    record,
    registry,
    registryDocument: canonicalPrettyJson(registry),
  });
}
