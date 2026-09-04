import { digestCanonical } from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import type { DiagnosticCollector } from "../validation/result.js";
import type {
  FoundationAssuranceSpec,
  FoundationBehaviorSpec,
  FoundationBlueprintSpec,
  FoundationDeclaredConflict,
  FoundationKnowledgeConflictResult,
  FoundationKnowledgeRecord,
} from "./types.js";

const CONFLICT_STAGE = "conflicts";

function conflictKey(value: FoundationKnowledgeConflictResult): string {
  return `${value.type}\0${value.leftId}\0${value.leftRevision.toString().padStart(10, "0")}\0${value.leftFact}\0${value.rightId}\0${value.rightRevision.toString().padStart(10, "0")}\0${value.rightFact}`;
}

function result(options: {
  type: FoundationKnowledgeConflictResult["type"];
  left: FoundationKnowledgeRecord;
  leftFact: string;
  right: FoundationKnowledgeRecord;
  rightFact: string;
}): FoundationKnowledgeConflictResult {
  const swap = compareCodePoints(options.left.frontMatter.id, options.right.frontMatter.id) > 0 ||
    (options.left.frontMatter.id === options.right.frontMatter.id && compareCodePoints(options.leftFact, options.rightFact) > 0);
  const left = swap ? options.right : options.left;
  const right = swap ? options.left : options.right;
  const leftFact = swap ? options.rightFact : options.leftFact;
  const rightFact = swap ? options.leftFact : options.rightFact;
  const subject = {
    type: options.type,
    leftId: left.frontMatter.id,
    leftRevision: left.frontMatter.revision,
    leftFact,
    rightId: right.frontMatter.id,
    rightRevision: right.frontMatter.revision,
    rightFact,
  };
  return Object.freeze({ ...subject, digest: digestCanonical(subject) });
}

function addAuthorityConflict(
  collector: DiagnosticCollector,
  conflict: FoundationKnowledgeConflictResult,
  left: FoundationKnowledgeRecord,
  right: FoundationKnowledgeRecord,
): void {
  collector.add({
    stage: CONFLICT_STAGE,
    code: "lifecycle.knowledge.authority-conflict",
    message: `${conflict.leftId} and ${conflict.rightId} assert one exact ${conflict.type} conflict`,
    path: left.path,
    related: left.path === right.path ? [] : [right.path],
    facts: {
      conflictDigest: conflict.digest,
      leftFact: conflict.leftFact,
      leftId: conflict.leftId,
      rightFact: conflict.rightFact,
      rightId: conflict.rightId,
      type: conflict.type,
    },
  });
}

function behaviorConflicts(options: {
  currentRecords: readonly FoundationKnowledgeRecord[];
  collector: DiagnosticCollector;
}): readonly FoundationKnowledgeConflictResult[] {
  const results: FoundationKnowledgeConflictResult[] = [];
  const behaviors = options.currentRecords
    .filter((record) => record.frontMatter.kind === "behavior")
    .sort((left, right) => compareCodePoints(left.frontMatter.id, right.frontMatter.id));

  for (let leftIndex = 0; leftIndex < behaviors.length; leftIndex += 1) {
    const left = behaviors[leftIndex]!;
    const leftSpec = left.frontMatter.spec as FoundationBehaviorSpec;
    for (const fact of leftSpec.included.filter((value) => leftSpec.excluded.includes(value)).sort(compareCodePoints)) {
      const conflict = result({ type: "behavior-inclusion-exclusion", left, leftFact: fact, right: left, rightFact: fact });
      results.push(conflict);
      addAuthorityConflict(options.collector, conflict, left, left);
    }
    for (let rightIndex = leftIndex + 1; rightIndex < behaviors.length; rightIndex += 1) {
      const right = behaviors[rightIndex]!;
      const rightSpec = right.frontMatter.spec as FoundationBehaviorSpec;
      const facts = [
        ...leftSpec.included.filter((value) => rightSpec.excluded.includes(value)).map((fact) => ({ leftFact: fact, rightFact: fact })),
        ...leftSpec.excluded.filter((value) => rightSpec.included.includes(value)).map((fact) => ({ leftFact: fact, rightFact: fact })),
      ].sort((a, b) => compareCodePoints(`${a.leftFact}\0${a.rightFact}`, `${b.leftFact}\0${b.rightFact}`));
      for (const factsEntry of facts) {
        const conflict = result({ type: "behavior-inclusion-exclusion", left, right, ...factsEntry });
        results.push(conflict);
        addAuthorityConflict(options.collector, conflict, left, right);
      }
    }
  }
  return Object.freeze(results);
}

function declarationFacts(record: FoundationKnowledgeRecord): readonly string[] {
  if (record.frontMatter.kind === "assurance") return (record.frontMatter.spec as FoundationAssuranceSpec).limits;
  if (record.frontMatter.kind === "blueprint") return (record.frontMatter.spec as FoundationBlueprintSpec).constraints;
  return Object.freeze([]);
}

function mirrorOf(candidate: FoundationDeclaredConflict, sourceId: string, declaration: FoundationDeclaredConflict): boolean {
  return candidate.type === declaration.type &&
    candidate.target === sourceId &&
    candidate.localFact === declaration.targetFact &&
    candidate.targetFact === declaration.localFact;
}

function declaredConflicts(options: {
  currentRecords: readonly FoundationKnowledgeRecord[];
  currentByIdentity: ReadonlyMap<string, FoundationKnowledgeRecord>;
  collector: DiagnosticCollector;
}): readonly FoundationKnowledgeConflictResult[] {
  const results: FoundationKnowledgeConflictResult[] = [];
  const emitted = new Set<string>();
  const records = [...options.currentRecords]
    .filter((record) => record.frontMatter.conflicts.length > 0)
    .sort((left, right) => compareCodePoints(left.frontMatter.id, right.frontMatter.id));

  for (const source of records) {
    const localFacts = declarationFacts(source);
    for (const declaration of source.frontMatter.conflicts) {
      const target = options.currentByIdentity.get(declaration.target);
      let malformed = false;
      if (!localFacts.includes(declaration.localFact)) {
        malformed = true;
        options.collector.add({
          stage: CONFLICT_STAGE,
          code: "lifecycle.knowledge.conflict-fact",
          message: `${source.frontMatter.id} conflict localFact is not an exact current ${declaration.type} fact`,
          path: source.path,
          facts: { localFact: declaration.localFact, target: declaration.target, type: declaration.type },
        });
      }
      if (target === undefined) {
        options.collector.add({
          stage: CONFLICT_STAGE,
          code: "lifecycle.knowledge.conflict-target-missing",
          message: `${source.frontMatter.id} conflict targets unavailable current record ${declaration.target}`,
          path: source.path,
          related: [declaration.target],
          facts: { type: declaration.type },
        });
        continue;
      }
      const expectedKind = declaration.type === "assurance-limit" ? "assurance" : "blueprint";
      if (source.frontMatter.kind !== expectedKind || target.frontMatter.kind !== expectedKind) {
        malformed = true;
        options.collector.add({
          stage: CONFLICT_STAGE,
          code: "lifecycle.knowledge.conflict-kind",
          message: `${declaration.type} must connect two current ${expectedKind} records`,
          path: source.path,
          related: [target.path],
          facts: { sourceKind: source.frontMatter.kind, targetKind: target.frontMatter.kind },
        });
      }
      if (!declarationFacts(target).includes(declaration.targetFact)) {
        malformed = true;
        options.collector.add({
          stage: CONFLICT_STAGE,
          code: "lifecycle.knowledge.conflict-fact",
          message: `${source.frontMatter.id} conflict targetFact is not an exact current ${declaration.type} fact on ${target.frontMatter.id}`,
          path: source.path,
          related: [target.path],
          facts: { targetFact: declaration.targetFact, type: declaration.type },
        });
      }
      const mirrored = target.frontMatter.conflicts.some((candidate) => mirrorOf(candidate, source.frontMatter.id, declaration));
      if (!mirrored) {
        malformed = true;
        options.collector.add({
          stage: CONFLICT_STAGE,
          code: "lifecycle.knowledge.conflict-unilateral",
          message: `${source.frontMatter.id} conflict with ${target.frontMatter.id} lacks an exact reciprocal declaration`,
          path: source.path,
          related: [target.path],
          facts: { localFact: declaration.localFact, targetFact: declaration.targetFact, type: declaration.type },
        });
      }
      if (malformed) continue;
      const conflict = result({
        type: declaration.type,
        left: source,
        leftFact: declaration.localFact,
        right: target,
        rightFact: declaration.targetFact,
      });
      const key = conflictKey(conflict);
      if (emitted.has(key)) continue;
      emitted.add(key);
      results.push(conflict);
      addAuthorityConflict(options.collector, conflict, source, target);
    }
  }
  return Object.freeze(results.sort((left, right) => compareCodePoints(conflictKey(left), conflictKey(right))));
}

/** Detect only conflicts established by exact structured facts. */
export function detectKnowledgeConflicts(options: {
  currentRecords: readonly FoundationKnowledgeRecord[];
  currentByIdentity: ReadonlyMap<string, FoundationKnowledgeRecord>;
  collector: DiagnosticCollector;
}): readonly FoundationKnowledgeConflictResult[] {
  return Object.freeze([...behaviorConflicts(options), ...declaredConflicts(options)]
    .sort((left, right) => compareCodePoints(conflictKey(left), conflictKey(right))));
}
