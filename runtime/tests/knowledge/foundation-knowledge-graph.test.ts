import assert from "node:assert/strict";
import test from "node:test";
import { resolveKnowledgeBindings } from "../../src/foundation/knowledge/bindings.js";
import { detectKnowledgeConflicts } from "../../src/foundation/knowledge/conflicts.js";
import { governedImplementationEntries } from "../../src/foundation/knowledge/coverage.js";
import { buildRelationshipEdges, validateRelationshipGraph } from "../../src/foundation/knowledge/relationships.js";
import type {
  FoundationBehaviorSpec,
  FoundationDeclaredConflict,
  FoundationKnowledgeKind,
  FoundationKnowledgeRecord,
  FoundationKnowledgeStatus,
  FoundationRelationshipType,
} from "../../src/foundation/knowledge/types.js";
import type { Sha256 } from "../../src/foundation/validation/canonical.js";
import { DiagnosticCollector } from "../../src/foundation/validation/result.js";
import type { FoundationCheckBinding, FoundationRepositoryContract } from "../../src/foundation/repository/types.js";

function digest(seed: number): Sha256 {
  return `sha256:${seed.toString(16).padStart(64, "0")}`;
}

type Edge = Readonly<{ type: FoundationRelationshipType; target: string; required: boolean }>;

function record(options: {
  id: string;
  kind?: FoundationKnowledgeKind;
  status?: FoundationKnowledgeStatus;
  relationships?: readonly Edge[];
  spec?: Record<string, unknown>;
  conflicts?: readonly FoundationDeclaredConflict[];
  extensions?: Record<string, unknown>;
  seed?: number;
}): FoundationKnowledgeRecord {
  const kind = options.kind ?? "blueprint";
  const seed = options.seed ?? 1;
  return {
    path: `records/${kind}/${options.id}.md`,
    mode: "100644",
    objectId: seed.toString(16).padStart(40, "0"),
    sourceText: "",
    body: "",
    bodyNormalized: "",
    headings: [],
    frontMatter: {
      schema: "lifecycle.knowledge-record.v1",
      kind,
      id: options.id,
      title: options.id,
      status: options.status ?? "current",
      revision: 1,
      supersedes: null,
      summary: options.id,
      owners: ["founder"],
      sources: [],
      relationships: (options.relationships ?? []).map((edge) => ({
        ...edge,
        scope: null,
        rationale: null,
        extensions: {},
        canonicalValue: edge,
      })),
      conflicts: options.conflicts ?? [],
      tags: [],
      spec: (options.spec ?? {
        decision: options.id,
        scope: [options.id],
        components: [options.id],
        constraints: [options.id],
        interfaces: [],
        dataFlows: [],
        tradeoffs: [options.id],
        evolution: [],
      }) as never,
      extensions: options.extensions ?? {},
      canonicalValue: {},
    },
    sourceDigest: digest(seed),
    semanticDigest: digest(seed + 1),
  };
}

function indexes(records: readonly FoundationKnowledgeRecord[]): {
  current: ReadonlyMap<string, FoundationKnowledgeRecord>;
  revisions: ReadonlyMap<string, readonly FoundationKnowledgeRecord[]>;
} {
  return {
    current: new Map(records.filter((entry) => entry.frontMatter.status === "current").map((entry) => [entry.frontMatter.id, entry])),
    revisions: new Map(records.map((entry) => [entry.frontMatter.id, [entry]])),
  };
}

test("optional relationships retain historical or missing targets without becoming authoritative", () => {
  const retired = record({ id: "blueprint.retired", status: "retired", seed: 10 });
  const peer = record({ id: "blueprint.peer", seed: 20 });
  const source = record({
    id: "blueprint.source",
    seed: 30,
    relationships: [
      { type: "depends-on", target: peer.frontMatter.id, required: true },
      { type: "depends-on", target: retired.frontMatter.id, required: false },
      { type: "related-to", target: "blueprint.absent", required: false },
    ],
  });
  const records = [retired, peer, source];
  const { current, revisions } = indexes(records);
  const collector = new DiagnosticCollector();
  const edges = buildRelationshipEdges({ records, revisionsByIdentity: revisions, currentByIdentity: current, collector });
  const graph = validateRelationshipGraph({ edges, currentByIdentity: current, collector });
  const result = collector.result({
    profile: "knowledge-set-v1",
    subjectKind: "test",
    subjectId: "optional-relationships",
    stages: ["relationships"],
  });
  assert.equal(result.valid, true);
  assert.equal(graph.complete, true);
  assert.equal(edges.find((edge) => edge.target === retired.frontMatter.id)?.targetStatus, "retired");
  assert.equal(edges.find((edge) => edge.target === "blueprint.absent")?.targetRevision, null);
  assert(result.diagnostics.some((entry) => entry.code === "lifecycle.relationship.optional-target-historical"));
  assert(result.diagnostics.some((entry) => entry.code === "lifecycle.relationship.optional-target-missing"));
});

test("required historical targets, duplicate edge identities, and iterative graph cycles fail deterministically", () => {
  const retired = record({ id: "blueprint.retired", status: "retired", seed: 40 });
  const left = record({
    id: "blueprint.left",
    seed: 50,
    relationships: [
      { type: "depends-on", target: "blueprint.right", required: true },
      { type: "depends-on", target: "blueprint.retired", required: true },
      { type: "related-to", target: "blueprint.right", required: false },
      { type: "related-to", target: "blueprint.right", required: false },
    ],
  });
  const right = record({ id: "blueprint.right", seed: 60, relationships: [{ type: "depends-on", target: "blueprint.left", required: true }] });
  const records = [retired, left, right];
  const { current, revisions } = indexes(records);
  const collector = new DiagnosticCollector();
  const edges = buildRelationshipEdges({ records, revisionsByIdentity: revisions, currentByIdentity: current, collector });
  const graph = validateRelationshipGraph({ edges, currentByIdentity: current, collector });
  const result = collector.result({ profile: "knowledge-set-v1", subjectKind: "test", subjectId: "required", stages: ["relationships"] });
  assert.equal(result.valid, false);
  assert(result.diagnostics.some((entry) => entry.code === "lifecycle.relationship.target-missing"));
  assert(result.diagnostics.some((entry) => entry.code === "lifecycle.relationship.duplicate"));
  assert(graph.dependencyComponents.some((component) => component.join(",") === "blueprint.left,blueprint.right"));

  const chain = Array.from({ length: 12_000 }, (_, index) => record({
    id: `blueprint.chain-${index.toString().padStart(5, "0")}`,
    seed: 100 + index * 2,
    relationships: index === 0 ? [] : [{ type: "refines", target: `blueprint.chain-${(index - 1).toString().padStart(5, "0")}`, required: true }],
  }));
  const chainIndexes = indexes(chain);
  const chainCollector = new DiagnosticCollector();
  const chainEdges = buildRelationshipEdges({
    records: chain,
    revisionsByIdentity: chainIndexes.revisions,
    currentByIdentity: chainIndexes.current,
    collector: chainCollector,
  });
  assert.doesNotThrow(() => validateRelationshipGraph({ edges: chainEdges, currentByIdentity: chainIndexes.current, collector: chainCollector }));
});

test("Behavior facts and explicit Assurance or Blueprint declarations surface exact authority conflicts", () => {
  const included = record({
    id: "behavior.included",
    kind: "behavior",
    seed: 70,
    spec: { included: ["accept-input"], excluded: [] } satisfies Partial<FoundationBehaviorSpec> as Record<string, unknown>,
  });
  const excluded = record({
    id: "behavior.excluded",
    kind: "behavior",
    seed: 80,
    spec: { included: ["different"], excluded: ["accept-input"] } satisfies Partial<FoundationBehaviorSpec> as Record<string, unknown>,
  });
  const assurance = record({
    id: "assurance.limit-a",
    kind: "assurance",
    seed: 90,
    spec: {
      obligation: "Keep the limit.", scope: ["system"], failureModes: ["limit lost"], limits: ["must-allow"], degradation: [], falsifiers: ["limit absent"],
    },
    conflicts: [{ type: "assurance-limit", target: "assurance.limit-b", localFact: "must-allow", targetFact: "must-deny" }],
  });
  const assurancePeer = record({
    id: "assurance.limit-b",
    kind: "assurance",
    seed: 100,
    spec: {
      obligation: "Keep the peer limit.", scope: ["system"], failureModes: ["limit lost"], limits: ["must-deny"], degradation: [], falsifiers: ["limit absent"],
    },
    conflicts: [{ type: "assurance-limit", target: "assurance.limit-a", localFact: "must-deny", targetFact: "must-allow" }],
  });
  const records = [included, excluded, assurance, assurancePeer];
  const current = new Map(records.map((entry) => [entry.frontMatter.id, entry]));
  const collector = new DiagnosticCollector();
  const conflicts = detectKnowledgeConflicts({ currentRecords: records, currentByIdentity: current, collector });
  const result = collector.result({ profile: "knowledge-set-v1", subjectKind: "test", subjectId: "conflicts", stages: ["conflicts"] });
  assert.equal(result.valid, false);
  assert.equal(result.diagnostics.filter((entry) => entry.code === "lifecycle.knowledge.authority-conflict").length, 2);
  assert.equal(conflicts.length, 2);
  assert.equal(conflicts.filter((entry) => entry.type === "assurance-limit").length, 1);
  assert.equal(result.diagnostics.filter((entry) =>
    entry.code === "lifecycle.knowledge.authority-conflict" && entry.facts.type === "assurance-limit").length, 1);
});

test("unilateral, missing-fact, and wrong-kind conflict declarations remain distinct errors", () => {
  const unilateral = record({
    id: "assurance.unilateral",
    kind: "assurance",
    seed: 110,
    spec: {
      obligation: "Keep one limit.", scope: ["system"], failureModes: ["lost"], limits: ["allow"], degradation: [], falsifiers: ["absent"],
    },
    conflicts: [{ type: "assurance-limit", target: "assurance.peer", localFact: "allow", targetFact: "deny" }],
  });
  const peer = record({
    id: "assurance.peer",
    kind: "assurance",
    seed: 120,
    spec: {
      obligation: "Keep peer limit.", scope: ["system"], failureModes: ["lost"], limits: ["deny"], degradation: [], falsifiers: ["absent"],
    },
  });
  const missingFact = record({
    id: "assurance.missing-fact",
    kind: "assurance",
    seed: 130,
    spec: {
      obligation: "Keep declared facts exact.", scope: ["system"], failureModes: ["lost"], limits: ["present"], degradation: [], falsifiers: ["absent"],
    },
    conflicts: [{ type: "assurance-limit", target: "assurance.peer", localFact: "absent", targetFact: "deny" }],
  });
  const wrongKind = record({
    id: "blueprint.wrong-kind",
    kind: "blueprint",
    seed: 140,
    spec: {
      decision: "Keep a constraint.", scope: ["system"], components: ["unit"], constraints: ["deny"], interfaces: [], dataFlows: [], tradeoffs: ["strict"], evolution: [],
    },
    conflicts: [{ type: "assurance-limit", target: "assurance.peer", localFact: "deny", targetFact: "deny" }],
  });
  const records = [unilateral, peer, missingFact, wrongKind];
  const current = new Map(records.map((entry) => [entry.frontMatter.id, entry]));
  const collector = new DiagnosticCollector();
  const conflicts = detectKnowledgeConflicts({ currentRecords: records, currentByIdentity: current, collector });
  const result = collector.result({ profile: "knowledge-set-v1", subjectKind: "test", subjectId: "malformed-conflicts", stages: ["conflicts"] });
  assert.equal(conflicts.length, 0);
  assert(result.diagnostics.some((entry) => entry.code === "lifecycle.knowledge.conflict-unilateral"));
  assert(result.diagnostics.some((entry) => entry.code === "lifecycle.knowledge.conflict-fact"));
  assert(result.diagnostics.some((entry) => entry.code === "lifecycle.knowledge.conflict-kind"));
});

test("Check Binding compatibility rejects partial subject sets and a parser that changes state order", () => {
  const check = record({
    id: "check.subjects",
    kind: "check",
    seed: 150,
    spec: {
      proposition: "The exact candidate and repository subjects pass.",
      subjects: [
        { kind: "candidate", selector: "src/parser.ts" },
        { kind: "repository", selector: "records/behavior/parser.md" },
      ],
      evidenceKinds: ["command"],
      requiredBindings: ["binding.subjects"],
      evaluation: { pass: "passes", fail: "fails", indeterminate: "unknown", notRun: "not run" },
      limits: ["bounded"],
      freshness: { subjectBinding: "exact", maximumAgeMs: null, environmentBinding: "exact" },
      falsifiers: ["fails"],
    },
  });
  const binding = {
    id: "binding.subjects",
    checkIds: ["check.subjects"],
    subjectSelectors: [{ kind: "candidate", selector: "src/parser.ts" }],
    kind: "command",
    executable: "/usr/bin/true",
    args: [],
    cwd: ".",
    network: "none",
    timeoutMs: 1_000,
    allowedModalities: ["postcondition"],
    capabilityProfileId: null,
    environment: {},
    resultParser: {
      id: "exit-code-v1",
      stateModel: "check-disposition-v2",
      states: ["fail", "pass", "indeterminate", "not-run", "unsupported", "operational-error"],
    },
    mutation: "forbidden",
    implementationDigest: digest(151),
    limitations: [],
    digest: digest(152),
  } as unknown as FoundationCheckBinding;
  const contract = {
    checkBindings: { [binding.id]: binding },
    capabilityProfiles: {},
  } as unknown as FoundationRepositoryContract;
  const collector = new DiagnosticCollector();
  const resolved = resolveKnowledgeBindings({
    contract,
    treeEntries: [],
    currentByIdentity: new Map([[check.frontMatter.id, check]]),
    collector,
  });
  const result = collector.result({ profile: "knowledge-set-v1", subjectKind: "test", subjectId: "binding-mismatch", stages: ["bindings"] });
  const diagnostic = result.diagnostics.find((entry) => entry.code === "lifecycle.check.binding-incompatible");
  assert.deepEqual(diagnostic?.facts.failures, ["result-states", "subject-selectors"]);
  assert.equal(resolved.length, 0);
});

test("Description discovery uses only underscore records and Product State exclusions do not waive coverage", () => {
  const contract = {
    knowledge: { roots: { behavior: "records/behavior", assurance: "records/assurance", blueprint: "records/blueprint", check: "records/checks" } },
    atlas: { root: "atlas" },
    evidence: { controlRoot: "records/control/delivery" },
    productState: {
      governedImplementationRoots: ["src", "records"],
      exclusions: ["src/app.ts", "src/plain.desc.md"],
      coverageExemptions: [],
    },
  } as unknown as FoundationRepositoryContract;
  const collector = new DiagnosticCollector();
  const entries = governedImplementationEntries({
    contract,
    treeEntries: [
      { path: "src/_app.desc.md", mode: "100644", type: "blob", objectId: "a".repeat(40) },
      { path: "src/app.ts", mode: "100644", type: "blob", objectId: "b".repeat(40) },
      { path: "src/plain.desc.md", mode: "100644", type: "blob", objectId: "c".repeat(40) },
      { path: "records/control/unrelated.ts", mode: "100644", type: "blob", objectId: "d".repeat(40) },
    ],
    collector,
  });
  assert.deepEqual(entries.map((entry) => entry.path), ["src/app.ts", "src/plain.desc.md"]);
});
