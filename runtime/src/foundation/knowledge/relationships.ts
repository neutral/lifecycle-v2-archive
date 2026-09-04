import { digestCanonical } from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import { FOUNDATION_REPOSITORY_KNOWLEDGE_LIMITS } from "../repository/contract.js";
import type { FoundationKnowledgeLimits } from "../repository/types.js";
import type { DiagnosticCollector } from "../validation/result.js";
import type {
  FoundationKnowledgeIndex,
  FoundationKnowledgeKind,
  FoundationKnowledgeRecord,
  FoundationRelationshipEdge,
  FoundationRelationshipType,
} from "./types.js";

const GRAPH_STAGE = "relationships";
const MAXIMUM_GRAPH_NODES = FOUNDATION_REPOSITORY_KNOWLEDGE_LIMITS.maximumGraphNodes;
const MAXIMUM_GRAPH_EDGES = FOUNDATION_REPOSITORY_KNOWLEDGE_LIMITS.maximumGraphEdges;
const MAXIMUM_NODE_DEGREE = FOUNDATION_REPOSITORY_KNOWLEDGE_LIMITS.maximumNodeDegree;

const ALLOWED: Readonly<Record<FoundationRelationshipType, Readonly<{
  sources: readonly FoundationKnowledgeKind[];
  targets: readonly FoundationKnowledgeKind[];
  sameKind?: boolean;
}>>> = Object.freeze({
  "refines": Object.freeze({
    sources: ["behavior", "assurance", "blueprint", "check"] as const,
    targets: ["behavior", "assurance", "blueprint", "check"] as const,
    sameKind: true,
  }),
  "constrains": Object.freeze({
    sources: ["assurance"] as const,
    targets: ["behavior", "assurance", "blueprint", "description"] as const,
  }),
  "realizes": Object.freeze({
    sources: ["blueprint", "description"] as const,
    targets: ["behavior", "assurance", "blueprint", "description"] as const,
  }),
  "verified-by": Object.freeze({
    sources: ["behavior", "assurance", "blueprint", "description", "check"] as const,
    targets: ["check"] as const,
  }),
  "depends-on": Object.freeze({
    sources: ["blueprint", "description"] as const,
    targets: ["blueprint", "description"] as const,
  }),
  "related-to": Object.freeze({
    sources: ["behavior", "assurance", "blueprint", "description", "check"] as const,
    targets: ["behavior", "assurance", "blueprint", "description", "check"] as const,
  }),
});

function recordKey(record: FoundationKnowledgeRecord): string {
  return `${record.frontMatter.id}\0${record.frontMatter.revision.toString().padStart(10, "0")}\0${record.path}`;
}

function legalEdge(source: FoundationKnowledgeRecord, target: FoundationKnowledgeRecord, type: FoundationRelationshipType): boolean {
  const rules = ALLOWED[type];
  const sourceKind = source.frontMatter.kind;
  const targetKind = target.frontMatter.kind;
  if (!rules.sources.includes(sourceKind) || !rules.targets.includes(targetKind)) return false;
  if (rules.sameKind && sourceKind !== targetKind) return false;
  if (type === "realizes" && sourceKind === "blueprint" && targetKind === "description") return false;
  return true;
}

function latestRevision(
  revisionsByIdentity: ReadonlyMap<string, readonly FoundationKnowledgeRecord[]>,
  identity: string,
): FoundationKnowledgeRecord | null {
  const revisions = revisionsByIdentity.get(identity);
  if (revisions === undefined || revisions.length === 0) return null;
  return [...revisions].sort((left, right) =>
    right.frontMatter.revision - left.frontMatter.revision || compareCodePoints(left.path, right.path))[0]!;
}

export function buildRelationshipEdges(options: {
  records: readonly FoundationKnowledgeRecord[];
  revisionsByIdentity: ReadonlyMap<string, readonly FoundationKnowledgeRecord[]>;
  currentByIdentity: ReadonlyMap<string, FoundationKnowledgeRecord>;
  collector: DiagnosticCollector;
  limits?: FoundationKnowledgeLimits;
}): readonly FoundationRelationshipEdge[] {
  const limits = options.limits ?? FOUNDATION_REPOSITORY_KNOWLEDGE_LIMITS;
  const edges: FoundationRelationshipEdge[] = [];
  let bounded = true;
  for (const source of [...options.records].sort((left, right) => compareCodePoints(recordKey(left), recordKey(right)))) {
    const sourceIsCurrent = options.currentByIdentity.get(source.frontMatter.id) === source;
    const seen = new Set<string>();
    for (const relationship of source.frontMatter.relationships) {
      if (edges.length >= limits.maximumGraphEdges) {
        options.collector.add({
          stage: GRAPH_STAGE,
          code: "lifecycle.knowledge.limit-exceeded",
          message: `Knowledge relationship graph exceeds its ${limits.maximumGraphEdges}-edge bound`,
          path: source.path,
          facts: { maximumEdges: limits.maximumGraphEdges },
        });
        bounded = false;
        break;
      }
      const identity = `${relationship.type}\0${relationship.target}`;
      if (seen.has(identity)) {
        options.collector.add({
          stage: GRAPH_STAGE,
          code: "lifecycle.relationship.duplicate",
          message: `${source.frontMatter.id} repeats relationship ${relationship.type} to ${relationship.target}`,
          path: source.path,
          facts: { target: relationship.target, type: relationship.type },
        });
        continue;
      }
      seen.add(identity);

      const currentTarget = options.currentByIdentity.get(relationship.target) ?? null;
      const historicalTarget = currentTarget === null ? latestRevision(options.revisionsByIdentity, relationship.target) : null;
      const target = currentTarget ?? historicalTarget;

      if (sourceIsCurrent && relationship.required && currentTarget === null) {
        options.collector.add({
          stage: GRAPH_STAGE,
          code: "lifecycle.relationship.target-missing",
          message: historicalTarget === null
            ? `${source.frontMatter.id} requires missing current target ${relationship.target}`
            : `${source.frontMatter.id} requires ${relationship.target}, but only ${historicalTarget.frontMatter.status} revision ${historicalTarget.frontMatter.revision} exists`,
          path: source.path,
          related: historicalTarget === null ? [relationship.target] : [historicalTarget.path],
          facts: {
            required: true,
            source: source.frontMatter.id,
            sourceRevision: source.frontMatter.revision,
            targetStatus: historicalTarget?.frontMatter.status ?? null,
            type: relationship.type,
          },
        });
      } else if (!relationship.required && currentTarget === null) {
        options.collector.add({
          stage: GRAPH_STAGE,
          code: historicalTarget === null ? "lifecycle.relationship.optional-target-missing" : "lifecycle.relationship.optional-target-historical",
          severity: "warning",
          message: historicalTarget === null
            ? `${source.frontMatter.id} revision ${source.frontMatter.revision} has non-authoritative optional relationship to missing ${relationship.target}`
            : `${source.frontMatter.id} revision ${source.frontMatter.revision} has non-authoritative optional relationship to ${historicalTarget.frontMatter.status} ${relationship.target}`,
          path: source.path,
          related: historicalTarget === null ? [relationship.target] : [historicalTarget.path],
          facts: {
            required: false,
            targetRevision: historicalTarget?.frontMatter.revision ?? null,
            targetStatus: historicalTarget?.frontMatter.status ?? null,
            type: relationship.type,
          },
        });
      } else if (!sourceIsCurrent && relationship.required && currentTarget === null) {
        options.collector.add({
          stage: GRAPH_STAGE,
          code: "lifecycle.relationship.historical-target-unresolved",
          severity: "warning",
          message: `${source.frontMatter.status} ${source.frontMatter.id} revision ${source.frontMatter.revision} has a non-authoritative unresolved historical relationship to ${relationship.target}`,
          path: source.path,
          related: historicalTarget === null ? [relationship.target] : [historicalTarget.path],
          facts: {
            sourceStatus: source.frontMatter.status,
            targetRevision: historicalTarget?.frontMatter.revision ?? null,
            targetStatus: historicalTarget?.frontMatter.status ?? null,
            type: relationship.type,
          },
        });
      }

      if (target !== null && !legalEdge(source, target, relationship.type)) {
        options.collector.add({
          stage: GRAPH_STAGE,
          code: "lifecycle.relationship.kind-invalid",
          message: `${relationship.type} cannot connect ${source.frontMatter.kind} ${source.frontMatter.id} to ${target.frontMatter.kind} ${target.frontMatter.id}`,
          path: source.path,
          related: [target.path],
          facts: { sourceKind: source.frontMatter.kind, targetKind: target.frontMatter.kind, type: relationship.type },
        });
      }
      if (source.frontMatter.id === relationship.target && relationship.type !== "depends-on" && relationship.type !== "related-to") {
        options.collector.add({
          stage: GRAPH_STAGE,
          code: "lifecycle.relationship.self",
          message: `${relationship.type} cannot target its source identity ${source.frontMatter.id}`,
          path: source.path,
          facts: { type: relationship.type },
        });
      }

      const subject = {
        source: source.frontMatter.id,
        sourceRevision: source.frontMatter.revision,
        sourcePath: source.path,
        sourceSemanticDigest: source.semanticDigest,
        type: relationship.type,
        target: relationship.target,
        targetRevision: target?.frontMatter.revision ?? null,
        targetStatus: target?.frontMatter.status ?? null,
        targetSemanticDigest: target?.semanticDigest ?? null,
        required: relationship.required,
        scope: relationship.scope,
      };
      edges.push(Object.freeze({ ...subject, digest: digestCanonical(subject) }));
    }
    if (!bounded) break;
  }
  return Object.freeze(edges.sort((left, right) => compareCodePoints(
    `${left.source}\0${left.sourceRevision.toString().padStart(10, "0")}\0${left.type}\0${left.target}`,
    `${right.source}\0${right.sourceRevision.toString().padStart(10, "0")}\0${right.type}\0${right.target}`,
  )));
}

function adjacencyFor(options: {
  edges: readonly FoundationRelationshipEdge[];
  current: ReadonlyMap<string, FoundationKnowledgeRecord>;
  type: "refines" | "verified-by" | "depends-on";
  requiredOnly?: boolean;
}): ReadonlyMap<string, readonly string[]> {
  const adjacency = new Map<string, string[]>();
  for (const edge of options.edges) {
    const source = options.current.get(edge.source);
    const target = options.current.get(edge.target);
    if (
      source === undefined || target === undefined || edge.type !== options.type ||
      edge.sourceRevision !== source.frontMatter.revision || edge.targetRevision !== target.frontMatter.revision ||
      (options.requiredOnly === true && !edge.required)
    ) continue;
    if (options.type === "verified-by" && (source.frontMatter.kind !== "check" || target.frontMatter.kind !== "check")) continue;
    const values = adjacency.get(edge.source) ?? [];
    values.push(edge.target);
    adjacency.set(edge.source, values);
    if (!adjacency.has(edge.target)) adjacency.set(edge.target, []);
  }
  return new Map([...adjacency].sort(([left], [right]) => compareCodePoints(left, right)).map(([key, values]) => [
    key,
    Object.freeze([...new Set(values)].sort(compareCodePoints)),
  ]));
}

/** Iterative Kosaraju traversal; repository data never consumes the JS stack. */
function stronglyConnectedComponents(adjacency: ReadonlyMap<string, readonly string[]>): readonly string[][] {
  const nodes = [...adjacency.keys()].sort(compareCodePoints);
  const visited = new Set<string>();
  const order: string[] = [];
  for (const start of nodes) {
    if (visited.has(start)) continue;
    visited.add(start);
    const stack: { node: string; next: number }[] = [{ node: start, next: 0 }];
    while (stack.length > 0) {
      const frame = stack.at(-1)!;
      const neighbors = adjacency.get(frame.node) ?? [];
      if (frame.next < neighbors.length) {
        const next = neighbors[frame.next]!;
        frame.next += 1;
        if (!visited.has(next)) {
          visited.add(next);
          stack.push({ node: next, next: 0 });
        }
      } else {
        order.push(frame.node);
        stack.pop();
      }
    }
  }

  const reverse = new Map<string, string[]>();
  for (const node of nodes) reverse.set(node, []);
  for (const [source, targets] of adjacency) {
    for (const target of targets) {
      const values = reverse.get(target) ?? [];
      values.push(source);
      reverse.set(target, values);
    }
  }
  for (const values of reverse.values()) values.sort(compareCodePoints);

  visited.clear();
  const components: string[][] = [];
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const start = order[index]!;
    if (visited.has(start)) continue;
    visited.add(start);
    const component: string[] = [];
    const stack = [start];
    while (stack.length > 0) {
      const node = stack.pop()!;
      component.push(node);
      const neighbors = reverse.get(node) ?? [];
      for (let neighborIndex = neighbors.length - 1; neighborIndex >= 0; neighborIndex -= 1) {
        const next = neighbors[neighborIndex]!;
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }
    components.push(component.sort(compareCodePoints));
  }
  return Object.freeze(components.sort((left, right) => compareCodePoints(left.join("\0"), right.join("\0"))));
}

function cyclicComponents(adjacency: ReadonlyMap<string, readonly string[]>): readonly string[][] {
  return Object.freeze(stronglyConnectedComponents(adjacency).filter((component) =>
    component.length > 1 || (component.length === 1 && (adjacency.get(component[0]!) ?? []).includes(component[0]!))));
}

export function validateRelationshipGraph(options: {
  edges: readonly FoundationRelationshipEdge[];
  currentByIdentity: ReadonlyMap<string, FoundationKnowledgeRecord>;
  collector: DiagnosticCollector;
  limits?: FoundationKnowledgeLimits;
}): Readonly<{ dependencyComponents: readonly string[][]; complete: boolean }> {
  const limits = options.limits ?? FOUNDATION_REPOSITORY_KNOWLEDGE_LIMITS;
  const priorLimit = options.collector.diagnostics.some((diagnostic) =>
    diagnostic.stage === GRAPH_STAGE && diagnostic.code === "lifecycle.knowledge.limit-exceeded");
  if (priorLimit || options.currentByIdentity.size > limits.maximumGraphNodes || options.edges.length > limits.maximumGraphEdges) {
    options.collector.add({
      stage: GRAPH_STAGE,
      code: "lifecycle.knowledge.limit-exceeded",
      message: "Knowledge relationship graph exceeds its bounded node or edge profile",
      facts: {
        edgeCount: options.edges.length,
        maximumEdges: limits.maximumGraphEdges,
        maximumNodes: limits.maximumGraphNodes,
        nodeCount: options.currentByIdentity.size,
      },
    });
    return Object.freeze({ dependencyComponents: Object.freeze([]), complete: false });
  }

  const degrees = new Map<string, number>();
  for (const edge of options.edges) degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1);
  const overDegree = [...degrees].filter(([, count]) => count > limits.maximumNodeDegree)
    .sort(([left], [right]) => compareCodePoints(left, right));
  if (overDegree.length > 0) {
    for (const [identity, count] of overDegree) {
      options.collector.add({
        stage: GRAPH_STAGE,
        code: "lifecycle.knowledge.limit-exceeded",
        message: `Knowledge relationship degree for ${identity} exceeds its ${limits.maximumNodeDegree}-edge bound`,
        related: [identity],
        facts: { count, maximumNodeDegree: limits.maximumNodeDegree },
      });
    }
    return Object.freeze({ dependencyComponents: Object.freeze([]), complete: false });
  }

  for (const type of ["refines", "verified-by"] as const) {
    const adjacency = adjacencyFor({ edges: options.edges, current: options.currentByIdentity, type });
    for (const component of cyclicComponents(adjacency)) {
      options.collector.add({
        stage: GRAPH_STAGE,
        code: "lifecycle.relationship.cycle",
        message: `${type} relationship cycle contains ${component.join(", ")}`,
        related: component,
        facts: { component, type },
      });
    }
  }

  const dependencyAdjacency = adjacencyFor({
    edges: options.edges,
    current: options.currentByIdentity,
    type: "depends-on",
    requiredOnly: true,
  });
  const components = stronglyConnectedComponents(dependencyAdjacency);
  for (const component of components) {
    if (component.length > 32) {
      options.collector.add({
        stage: GRAPH_STAGE,
        code: "lifecycle.relationship.dependency-large",
        severity: "warning",
        message: `Required dependency component contains ${component.length} records`,
        related: component,
        facts: { digest: digestCanonical(component), count: component.length },
      });
    }
  }

  const currentEdges = options.edges.filter((edge) =>
    options.currentByIdentity.get(edge.source)?.frontMatter.revision === edge.sourceRevision &&
    options.currentByIdentity.get(edge.target)?.frontMatter.revision === edge.targetRevision);
  for (const edge of options.edges) {
    const source = options.currentByIdentity.get(edge.source);
    if (edge.type === "depends-on" && edge.required && source?.frontMatter.revision === edge.sourceRevision &&
      options.currentByIdentity.get(edge.target)?.frontMatter.revision !== edge.targetRevision) {
      options.collector.add({
        stage: GRAPH_STAGE,
        code: "lifecycle.relationship.dependency-incomplete",
        message: `Required dependency from ${edge.source} to ${edge.target} is incomplete`,
        path: edge.sourcePath,
        related: [edge.target],
        facts: { edgeDigest: edge.digest },
      });
    }
  }
  for (const record of [...options.currentByIdentity.values()].sort((left, right) => compareCodePoints(left.frontMatter.id, right.frontMatter.id))) {
    if (record.frontMatter.kind !== "behavior" && record.frontMatter.kind !== "assurance") continue;
    const verified = currentEdges.some((edge) =>
      edge.source === record.frontMatter.id && edge.type === "verified-by" && edge.required &&
      options.currentByIdentity.get(edge.target)?.frontMatter.kind === "check");
    if (!verified) {
      options.collector.add({
        stage: GRAPH_STAGE,
        code: "lifecycle.check.required-missing",
        message: `Current ${record.frontMatter.kind} ${record.frontMatter.id} lacks a required verified-by Check`,
        path: record.path,
        facts: { identity: record.frontMatter.id },
      });
    }
  }

  return Object.freeze({ dependencyComponents: components, complete: true });
}

export function relationshipIndexes(options: {
  records: readonly FoundationKnowledgeRecord[];
  edges: readonly FoundationRelationshipEdge[];
}): Pick<FoundationKnowledgeIndex, "outgoingByIdentity" | "incomingByIdentity"> {
  const outgoing = new Map<string, FoundationRelationshipEdge[]>();
  const incoming = new Map<string, FoundationRelationshipEdge[]>();
  for (const edge of options.edges) {
    const outgoingValues = outgoing.get(edge.source) ?? [];
    outgoingValues.push(edge);
    outgoing.set(edge.source, outgoingValues);
    const incomingValues = incoming.get(edge.target) ?? [];
    incomingValues.push(edge);
    incoming.set(edge.target, incomingValues);
  }
  const sort = (values: FoundationRelationshipEdge[]): readonly FoundationRelationshipEdge[] => Object.freeze(values.sort((left, right) => compareCodePoints(
    `${left.type}\0${left.target}\0${left.sourceRevision.toString().padStart(10, "0")}`,
    `${right.type}\0${right.target}\0${right.sourceRevision.toString().padStart(10, "0")}`,
  )));
  return Object.freeze({
    outgoingByIdentity: new Map([...outgoing].sort(([left], [right]) => compareCodePoints(left, right)).map(([key, values]) => [key, sort(values)])),
    incomingByIdentity: new Map([...incoming].sort(([left], [right]) => compareCodePoints(left, right)).map(([key, values]) => [key, sort(values)])),
  });
}

export const FOUNDATION_KNOWLEDGE_GRAPH_LIMITS = Object.freeze({
  maximumEdges: MAXIMUM_GRAPH_EDGES,
  maximumNodeDegree: MAXIMUM_NODE_DEGREE,
  maximumNodes: MAXIMUM_GRAPH_NODES,
});
