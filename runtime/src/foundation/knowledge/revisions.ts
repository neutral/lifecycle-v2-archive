import type { FoundationKnowledgeSourceRecord } from "./records.js";
import type { FoundationKnowledgeKind } from "./types.js";
import { compareCodePoints } from "../validation/ordering.js";
import type { DiagnosticCollector } from "../validation/result.js";

const KIND_ORDER: Readonly<Record<FoundationKnowledgeKind, number>> = Object.freeze({
  behavior: 0,
  assurance: 1,
  blueprint: 2,
  description: 3,
  check: 4,
  discipline: 5,
});
function recordIdentityRevision(record: FoundationKnowledgeSourceRecord): string {
  return `${record.frontMatter.id}@${record.frontMatter.revision}`;
}

export function compareKnowledgeRecords(left: FoundationKnowledgeSourceRecord, right: FoundationKnowledgeSourceRecord): number {
  return KIND_ORDER[left.frontMatter.kind] - KIND_ORDER[right.frontMatter.kind] ||
    compareCodePoints(left.frontMatter.id, right.frontMatter.id) ||
    left.frontMatter.revision - right.frontMatter.revision ||
    compareCodePoints(left.path, right.path);
}

export function buildRevisionIndexes<Record extends FoundationKnowledgeSourceRecord>(options: {
  records: readonly Record[];
  collector: DiagnosticCollector;
}): Readonly<{
  byIdentityRevision: ReadonlyMap<string, Record>;
  revisionsByIdentity: ReadonlyMap<string, readonly Record[]>;
  currentByIdentity: ReadonlyMap<string, Record>;
  currentRecords: readonly Record[];
  historicalRecords: readonly Record[];
}> {
  const byIdentityRevision = new Map<string, Record>();
  const revisionsByIdentity = new Map<string, Record[]>();

  for (const record of options.records) {
    const key = recordIdentityRevision(record);
    const prior = byIdentityRevision.get(key);
    if (prior !== undefined) {
      options.collector.add({
        stage: "revision",
        code: "lifecycle.knowledge.id-duplicate",
        message: `Knowledge revision ${key} is declared more than once`,
        path: record.path,
        related: [prior.path],
      });
      continue;
    }
    byIdentityRevision.set(key, record);
    const values = revisionsByIdentity.get(record.frontMatter.id) ?? [];
    values.push(record);
    revisionsByIdentity.set(record.frontMatter.id, values);
  }

  const currentByIdentity = new Map<string, Record>();
  for (const [identity, revisions] of [...revisionsByIdentity].sort(([left], [right]) => compareCodePoints(left, right))) {
    revisions.sort((left, right) => left.frontMatter.revision - right.frontMatter.revision || compareCodePoints(left.path, right.path));
    for (let index = 0; index < revisions.length; index += 1) {
      const record = revisions[index]!;
      // Adopted publisher revisions are exact advisory provenance. The target
      // does not import or rewrite the publisher's preceding record history.
      // Record parsing still checks the same-id, n-1 supersedes structure;
      // Registry validation binds the selected current bytes and publisher.
      if (record.frontMatter.kind === "discipline") continue;
      const expectedRevision = index + 1;
      if (record.frontMatter.revision !== expectedRevision) {
        options.collector.add({
          stage: "revision",
          code: "lifecycle.knowledge.revision-gap",
          message: `${identity} expected revision ${expectedRevision} but found ${record.frontMatter.revision}`,
          path: record.path,
          facts: { expectedRevision, actualRevision: record.frontMatter.revision },
        });
      }
      const previous = index === 0 ? undefined : revisions[index - 1];
      if (previous !== undefined) {
        const supersedes = record.frontMatter.supersedes;
        if (supersedes === null || supersedes.id !== identity || supersedes.revision !== previous.frontMatter.revision ||
            supersedes.sourceDigest !== previous.sourceDigest || supersedes.semanticDigest !== previous.semanticDigest) {
          options.collector.add({
            stage: "revision",
            code: "lifecycle.knowledge.supersession-invalid",
            message: `${identity} revision ${record.frontMatter.revision} does not bind the exact preceding revision`,
            path: record.path,
            related: [previous.path],
            facts: {
              expectedRevision: previous.frontMatter.revision,
              expectedSourceDigest: previous.sourceDigest,
              expectedSemanticDigest: previous.semanticDigest,
            },
          });
        }
        if (record.frontMatter.status === "current" && previous.frontMatter.status !== "superseded") {
          options.collector.add({
            stage: "revision",
            code: "lifecycle.knowledge.supersession-invalid",
            message: `${identity} prior revision ${previous.frontMatter.revision} must be superseded when revision ${record.frontMatter.revision} becomes current`,
            path: previous.path,
            related: [record.path],
            facts: { priorStatus: previous.frontMatter.status },
          });
        }
      }
    }
    const currents = revisions.filter((record) => record.frontMatter.status === "current");
    if (currents.length > 1) {
      for (const record of currents) {
        options.collector.add({
          stage: "revision",
          code: "lifecycle.knowledge.current-duplicate",
          message: `${identity} has ${currents.length} current revisions`,
          path: record.path,
          related: currents.filter((entry) => entry !== record).map((entry) => entry.path),
        });
      }
    } else if (currents.length === 1) {
      const current = currents[0]!;
      currentByIdentity.set(identity, current);
      // Product drafts can extend the exact local chain without replacing its
      // explicit current owner. Advisory adoptions remain publisher-current.
      const later = revisions.filter((record) => record.frontMatter.revision > current.frontMatter.revision);
      if (later.some((record) => record.frontMatter.kind === "discipline" || record.frontMatter.status !== "draft")) {
        options.collector.add({
          stage: "revision",
          code: "lifecycle.knowledge.current-not-latest",
          message: `${identity} current revision may be followed only by non-governing Product drafts`,
          path: current.path,
          related: [revisions.at(-1)!.path],
        });
      }
    }
  }

  const currentRecords = [...currentByIdentity.values()].sort((left, right) => compareCodePoints(left.frontMatter.id, right.frontMatter.id));
  const currentKeys = new Set(currentRecords.map(recordIdentityRevision));
  const historicalRecords = options.records.filter((record) => !currentKeys.has(recordIdentityRevision(record)))
    .sort(compareKnowledgeRecords);
  return Object.freeze({
    byIdentityRevision,
    revisionsByIdentity: new Map([...revisionsByIdentity].sort(([left], [right]) => compareCodePoints(left, right))
      .map(([key, values]) => [key, Object.freeze(values)])),
    currentByIdentity,
    currentRecords: Object.freeze(currentRecords),
    historicalRecords: Object.freeze(historicalRecords),
  });
}

