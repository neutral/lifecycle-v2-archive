import { assertDeliveryControlRecordPayload } from "../control/payload-registry.js";
import type { ControlJsonObject, ControlJsonValue, ControlRecordRevision } from "../control/types.js";
import { FoundationError } from "../error.js";
import { governedImplementationPath, knowledgeOrControlPath } from "../knowledge/coverage.js";
import { expectedKnowledgeKind } from "../knowledge/records.js";
import type { FoundationDescriptionSpec, FoundationKnowledgeRecord, FoundationKnowledgeSet, FoundationRelationshipEdge } from "../knowledge/types.js";
import type { FoundationLoadedRepositorySnapshot } from "../repository/types.js";
import type { Sha256 } from "../validation/canonical.js";
import { compareCodePoints, sortUniqueCodePoints } from "../validation/ordering.js";
import type { FoundationExecutionProjectionRequest, FoundationExecutionProjectionSubject } from "./types.js";

/** The exact semantic inputs to closure; execution packaging and policy bytes are separate. */
export type FoundationExecutionClosureSubject = Readonly<{
  knowledgeRoots: FoundationExecutionProjectionSubject["knowledgeRoots"];
  sourceRoots: readonly Readonly<{ sourceId: string }>[];
  implementationRoots: FoundationExecutionProjectionSubject["implementationRoots"];
  core: Readonly<{
    obligations: readonly Readonly<{ id: string; sourceIds: readonly string[] }>[];
    checks: readonly Readonly<{ id: string; checkId: string }>[];
    requiredArtifacts: readonly Readonly<{ id: string; path: string; role: string }>[];
  }>;
}>;

function atOrBelow(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

export type ClosureEntry = {
  record: FoundationKnowledgeRecord;
  reasons: Set<string>;
  paths: Map<string, readonly string[]>;
};

export type ClosureSeed = Readonly<{ id: string; reason: string }>;

function controlObject(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== "object") {
    throw new FoundationError("lifecycle.projection.control-invalid", `${label} must be one exact Control object`);
  }
  return value as ControlJsonObject;
}

function controlArray(value: ControlJsonValue | undefined, label: string): readonly ControlJsonValue[] {
  if (!Array.isArray(value)) {
    throw new FoundationError("lifecycle.projection.control-invalid", `${label} must be one exact Control array`);
  }
  return value;
}

function controlString(value: ControlJsonValue | undefined, label: string): string {
  if (typeof value !== "string") {
    throw new FoundationError("lifecycle.projection.control-invalid", `${label} must be retained text`);
  }
  return value;
}

function controlDigest(value: ControlJsonValue | undefined, label: string): Sha256 {
  const selected = controlString(value, label);
  if (!/^sha256:[a-f0-9]{64}$/u.test(selected)) {
    throw new FoundationError("lifecycle.projection.control-invalid", `${label} must be one lowercase SHA-256 digest`);
  }
  return selected as Sha256;
}

function controlRevision(value: ControlJsonValue | undefined): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new FoundationError("lifecycle.projection.control-invalid", "Knowledge root revision must be a positive integer");
  }
  return value;
}

function edgeOrder(left: FoundationRelationshipEdge, right: FoundationRelationshipEdge): number {
  return compareCodePoints(
    `${left.source}\0${left.type}\0${left.target}\0${left.digest}`,
    `${right.source}\0${right.type}\0${right.target}\0${right.digest}`,
  );
}

function currentEdges(knowledge: FoundationKnowledgeSet): readonly FoundationRelationshipEdge[] {
  return Object.freeze(knowledge.relationships.filter((edge) => {
    const source = knowledge.index.currentByIdentity.get(edge.source);
    const target = knowledge.index.currentByIdentity.get(edge.target);
    return source !== undefined && target !== undefined &&
      edge.sourceRevision === source.frontMatter.revision &&
      edge.targetRevision === target.frontMatter.revision;
  }).sort(edgeOrder));
}

/** Iterative Kosaraju traversal over required dependency edges. */
function dependencyComponents(
  current: ReadonlyMap<string, FoundationKnowledgeRecord>,
  edges: readonly FoundationRelationshipEdge[],
): ReadonlyMap<string, readonly string[]> {
  const adjacency = new Map<string, string[]>();
  for (const id of current.keys()) adjacency.set(id, []);
  for (const edge of edges) {
    if (edge.type === "depends-on" && edge.required) adjacency.get(edge.source)?.push(edge.target);
  }
  for (const values of adjacency.values()) values.sort(compareCodePoints);
  const nodes = [...adjacency.keys()].sort(compareCodePoints);
  const visited = new Set<string>();
  const order: string[] = [];
  for (const start of nodes) {
    if (visited.has(start)) continue;
    visited.add(start);
    const stack: Array<{ node: string; next: number }> = [{ node: start, next: 0 }];
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
  const reverse = new Map(nodes.map((node) => [node, [] as string[]]));
  for (const [source, targets] of adjacency) for (const target of targets) reverse.get(target)?.push(source);
  for (const values of reverse.values()) values.sort(compareCodePoints);
  visited.clear();
  const byIdentity = new Map<string, readonly string[]>();
  for (let index = order.length - 1; index >= 0; index -= 1) {
    const start = order[index]!;
    if (visited.has(start)) continue;
    const component: string[] = [];
    const stack = [start];
    visited.add(start);
    while (stack.length > 0) {
      const node = stack.pop()!;
      component.push(node);
      const neighbors = reverse.get(node) ?? [];
      for (let neighbor = neighbors.length - 1; neighbor >= 0; neighbor -= 1) {
        const next = neighbors[neighbor]!;
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }
    component.sort(compareCodePoints);
    const frozen = Object.freeze(component);
    for (const id of component) byIdentity.set(id, frozen);
  }
  return byIdentity;
}

export function buildClosure(options: {
  knowledge: FoundationKnowledgeSet;
  seeds: readonly ClosureSeed[];
  role: FoundationExecutionProjectionRequest["role"];
  maximumDepth: number;
}): ReadonlyMap<string, ClosureEntry> {
  const current = options.knowledge.index.currentByIdentity;
  const edges = currentEdges(options.knowledge);
  const outgoing = new Map<string, FoundationRelationshipEdge[]>();
  const incoming = new Map<string, FoundationRelationshipEdge[]>();
  for (const edge of edges) {
    const out = outgoing.get(edge.source) ?? [];
    out.push(edge);
    outgoing.set(edge.source, out);
    const into = incoming.get(edge.target) ?? [];
    into.push(edge);
    incoming.set(edge.target, into);
  }
  const components = dependencyComponents(current, edges);
  const closure = new Map<string, ClosureEntry>();
  const minimumDepth = new Map<string, number>();
  const queue: Array<Readonly<{ id: string; reason: string; depth: number; path: readonly string[] }>> = [];

  const include = (id: string, reason: string, depth: number, path: readonly string[]): void => {
    const record = current.get(id);
    if (record === undefined) {
      throw new FoundationError("lifecycle.projection.root-unresolved", `Execution Projection requires missing current Knowledge ${id}`, {
        observedFacts: { id, reason },
      });
    }
    if (depth > options.maximumDepth) {
      throw new FoundationError("lifecycle.projection.bounds-invalid", `Knowledge closure exceeds the selected ${options.maximumDepth}-edge relationship bound`, {
        observedFacts: { id, path, depth, maximumRelationshipDepth: options.maximumDepth },
      });
    }
    let entry = closure.get(id);
    if (entry === undefined) {
      entry = { record, reasons: new Set(), paths: new Map() };
      closure.set(id, entry);
    }
    entry.reasons.add(reason);
    entry.paths.set(path.join("\0"), Object.freeze([...path]));
    const priorDepth = minimumDepth.get(id);
    if (priorDepth === undefined || depth < priorDepth) {
      minimumDepth.set(id, depth);
      queue.push(Object.freeze({ id, reason, depth, path: Object.freeze([...path]) }));
    }
  };

  for (const seed of [...options.seeds].sort((left, right) => compareCodePoints(`${left.id}\0${left.reason}`, `${right.id}\0${right.reason}`))) {
    include(seed.id, seed.reason, 0, [seed.id]);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const item = queue[cursor]!;
    const addEdge = (target: string, label: string): void => {
      include(target, label, item.depth + 1, [...item.path, target]);
    };
    for (const edge of outgoing.get(item.id) ?? []) {
      if (!edge.required || !["refines", "verified-by", "depends-on"].includes(edge.type)) continue;
      addEdge(edge.target, `${edge.type}:${edge.source}->${edge.target}`);
    }
    for (const edge of incoming.get(item.id) ?? []) {
      if (edge.type === "constrains" && edge.required) {
        addEdge(edge.source, `incoming-constrains:${edge.source}->${edge.target}`);
      } else if (edge.type === "realizes" && (options.role === "builder" || options.role === "reviewer")) {
        // Format v1 scopes are prose. Including every current realization is the
        // deterministic conservative role addition; no model judges scope here.
        addEdge(edge.source, `incoming-realizes:${edge.source}->${edge.target}`);
      }
    }
    for (const member of components.get(item.id) ?? []) {
      if (member !== item.id) include(member, `dependency-component:${item.id}`, item.depth + 1, [...item.path, member]);
    }
  }
  return closure;
}

function matchesDescription(path: string, selector: FoundationDescriptionSpec["coverage"][number]): boolean {
  if (selector.mode === "file") return selector.path === path;
  return path !== selector.path && atOrBelow(path, selector.path) && !selector.exclude.some((entry) => atOrBelow(path, entry));
}

export function descriptionsForPath(knowledge: FoundationKnowledgeSet, path: string): readonly string[] {
  const exact = knowledge.coverage.filter((entry) => entry.path === path).map((entry) => entry.descriptionId);
  if (exact.length > 0) return Object.freeze(sortUniqueCodePoints(exact));
  const candidates = knowledge.currentRecords.filter((record) => record.frontMatter.kind === "description" &&
    (record.frontMatter.spec as FoundationDescriptionSpec).coverage.some((selector) => matchesDescription(path, selector)))
    .map((record) => record.frontMatter.id);
  return Object.freeze(sortUniqueCodePoints(candidates));
}

function requireDescriptionIdentity(knowledge: FoundationKnowledgeSet, path: string, descriptions: readonly string[]): string {
  const exempt = knowledge.exemptions.some((entry) => entry.matched && atOrBelow(path, entry.path));
  if (descriptions.length === 0 && exempt) return "";
  if (descriptions.length !== 1) {
    throw new FoundationError(
      descriptions.length === 0 ? "lifecycle.projection.description-missing" : "lifecycle.projection.description-ambiguous",
      `Execution Projection requires exactly one primary Description for ${path}`,
      { observedFacts: { path, descriptionIds: descriptions } },
    );
  }
  return descriptions[0]!;
}

export function requireOneDescription(knowledge: FoundationKnowledgeSet, path: string): string {
  return requireDescriptionIdentity(knowledge, path, descriptionsForPath(knowledge, path));
}

export function governedPath(loaded: FoundationLoadedRepositorySnapshot, path: string): boolean {
  return governedImplementationPath(loaded.contract, path);
}

function knowledgeRole(role: string): role is "behavior" | "assurance" | "blueprint" | "description" | "check" {
  return ["behavior", "assurance", "blueprint", "description", "check"].includes(role);
}

export function seedSubject(options: {
  loaded: FoundationLoadedRepositorySnapshot;
  knowledge: FoundationKnowledgeSet;
  subject: FoundationExecutionClosureSubject;
  boundary: ControlRecordRevision;
  /** Comparison follows selected identities at P without relabeling their old revisions. */
  currentRoots?: boolean;
}): Readonly<{ seeds: readonly ClosureSeed[]; implementationReasons: ReadonlyMap<string, readonly string[]> }> {
  const seeds: ClosureSeed[] = [];
  const reasons = new Map<string, Set<string>>();
  const addPath = (path: string, reason: string): void => {
    if (knowledgeOrControlPath(path, options.loaded.contract)) {
      const record = options.knowledge.currentRecords.find((entry) => entry.path === path);
      if (record === undefined) {
        throw new FoundationError("lifecycle.projection.root-unresolved", `Selected path ${path} is neither governed implementation nor current Knowledge`);
      }
      seeds.push({ id: record.frontMatter.id, reason });
      return;
    }
    const values = reasons.get(path) ?? new Set<string>();
    values.add(reason);
    reasons.set(path, values);
  };
  const addImplementation = (path: string, reason: string): void => {
    const matches = options.loaded.productState.entries.filter((entry) =>
      entry.role === "governed-implementation" && atOrBelow(entry.path, path));
    if (matches.length === 0) addPath(path, reason);
    for (const match of matches) addPath(match.path, reason);
  };
  for (const root of options.subject.knowledgeRoots) {
    const record = options.knowledge.index.currentByIdentity.get(root.id);
    if (record === undefined || !options.currentRoots && (record.frontMatter.revision !== root.revision ||
        record.sourceDigest !== root.sourceDigest || record.semanticDigest !== root.semanticDigest)) {
      throw new FoundationError("lifecycle.projection.root-unresolved", `Work Boundary Knowledge root ${root.id} is stale or mismatched`, {
        observedFacts: { root, currentRevision: record?.frontMatter.revision ?? null },
      });
    }
    seeds.push({ id: root.id, reason: `work-boundary:${root.reason}` });
  }
  const sourceRootIds = new Set(options.subject.sourceRoots.map(({ sourceId }) => sourceId));
  const knowledgeRootIds = new Set(options.subject.knowledgeRoots.map(({ id }) => id));
  const boundaryMandate = controlObject(options.boundary.payload.mandate, "Work Boundary mandate");
  const boundaryDirection = controlObject(boundaryMandate.direction, "Work Boundary direction");
  const boundaryDirectionId = controlString(boundaryDirection.id, "Work Boundary direction identity");
  for (const obligation of options.subject.core.obligations) {
    for (const id of obligation.sourceIds) {
      const isKnowledge = knowledgeRootIds.has(id);
      const isSource = sourceRootIds.has(id);
      const isBoundaryMandate = id === boundaryDirectionId;
      if (Number(isKnowledge) + Number(isSource) + Number(isBoundaryMandate) !== 1) {
        throw new FoundationError("lifecycle.projection.root-unresolved", `Obligation ${obligation.id} source ${id} does not resolve to exactly one Knowledge, source, or fixed-mandate subject`, {
          observedFacts: {
            obligationId: obligation.id,
            sourceId: id,
            knowledgeMatches: isKnowledge ? 1 : 0,
            sourceMatches: isSource ? 1 : 0,
            fixedMandateMatches: isBoundaryMandate ? 1 : 0,
          },
        });
      }
      if (isKnowledge) seeds.push({ id, reason: `obligation:${obligation.id}` });
    }
  }
  for (const check of options.subject.core.checks) seeds.push({ id: check.checkId, reason: `check:${check.id}` });
  for (const root of options.subject.implementationRoots) {
    addImplementation(root.path, `work-boundary:${root.reason}`);
  }
  for (const artifact of options.subject.core.requiredArtifacts) {
    const selectsKnowledge = knowledgeRole(artifact.role);
    const record = options.knowledge.currentRecords.find((entry) =>
      entry.path === artifact.path || selectsKnowledge && entry.frontMatter.id === artifact.id);
    if (selectsKnowledge || record !== undefined) {
      if (record === undefined) {
        const retained = options.knowledge.records.find((entry) => entry.path === artifact.path);
        // Artifact paths describe required Product outputs, not additional
        // assertions that every output is already governing Current Knowledge.
        // The complete validated Set establishes any Draft/Superseded bytes;
        // the exact tree establishes absence for a declared new record.
        const noncurrentOutput = retained !== undefined && retained.frontMatter.kind === artifact.role &&
          retained.frontMatter.status !== "current";
        const newOutput = retained === undefined &&
          expectedKnowledgeKind(artifact.path, options.loaded.contract) === artifact.role &&
          !options.loaded.treeEntries.some((entry) => atOrBelow(entry.path, artifact.path));
        if (noncurrentOutput || newOutput) continue;
        throw new FoundationError("lifecycle.projection.root-unresolved", `Required ${artifact.role} artifact ${artifact.id} has no current Knowledge record`);
      }
      seeds.push({ id: record.frontMatter.id, reason: `required-artifact:${artifact.id}` });
    } else if (governedPath(options.loaded, artifact.path)) {
      addImplementation(artifact.path, `required-artifact:${artifact.id}`);
    }
  }
  for (const path of reasons.keys()) {
    // A required future directory can have a Current tree Description before
    // its first implementation file. The selector owns future descendants;
    // it does not turn the directory scope into an implementation blob.
    const futureTreeOwners = options.subject.core.requiredArtifacts.some((artifact) =>
      artifact.path === path && !knowledgeRole(artifact.role)) && governedPath(options.loaded, path) &&
      !options.loaded.treeEntries.some((entry) => entry.path === path) &&
      !options.loaded.productState.entries.some((entry) =>
        entry.role === "governed-implementation" && atOrBelow(entry.path, path))
      ? options.knowledge.currentRecords.filter((record) => record.frontMatter.kind === "description" &&
        (record.frontMatter.spec as FoundationDescriptionSpec).coverage.some((selector) =>
          selector.mode === "tree" && selector.role === "primary" && selector.path === path))
        .map((record) => record.frontMatter.id)
      : [];
    const descriptionId = futureTreeOwners.length === 0
      ? requireOneDescription(options.knowledge, path)
      : requireDescriptionIdentity(options.knowledge, path,
        sortUniqueCodePoints([...futureTreeOwners, ...descriptionsForPath(options.knowledge, path)]));
    if (futureTreeOwners.length > 0) reasons.delete(path);
    if (descriptionId !== "") seeds.push({ id: descriptionId,
      reason: `${futureTreeOwners.length > 0 ? "required-artifact-tree" : "description-coverage"}:${path}` });
  }
  return Object.freeze({
    seeds: Object.freeze(seeds),
    implementationReasons: new Map([...reasons].sort(([left], [right]) => compareCodePoints(left, right)).map(([path, values]) => [
      path,
      Object.freeze([...values].sort(compareCodePoints)),
    ])),
  });
}

/** Reuse the exact execution seeding and closure rules for integration comparison. */
export function foundationIntegrationClosureV1(options: Readonly<{
  loaded: FoundationLoadedRepositorySnapshot;
  knowledge: FoundationKnowledgeSet;
  boundary: ControlRecordRevision;
  currentRoots: boolean;
}>): Readonly<{ closure: ReadonlyMap<string, ClosureEntry>; implementationPaths: readonly string[] }> {
  assertDeliveryControlRecordPayload(options.boundary);
  const mandate = controlObject(options.boundary.payload.mandate, "Work Boundary mandate");
  const roots = controlArray(options.boundary.payload.knowledge, "Work Boundary Knowledge");
  const artifacts = controlArray(mandate.artifacts, "Work Boundary artifacts").map((value) => {
    const artifact = controlObject(value, "Work Boundary artifact");
    return { id: controlString(artifact.id, "Artifact identity"), path: controlString(artifact.path, "Artifact path"),
      role: controlString(artifact.role, "Artifact role") };
  });
  const subject: FoundationExecutionClosureSubject = {
    knowledgeRoots: roots.map((entry) => {
      const root = controlObject(entry, "Work Boundary Knowledge root");
      return { id: controlString(root.id, "Knowledge root identity"), revision: controlRevision(root.revision),
        sourceDigest: controlDigest(root.sourceDigest, "Knowledge root source digest"),
        semanticDigest: controlDigest(root.semanticDigest, "Knowledge root semantic digest"), reason: "integration-governing-root" };
    }),
    sourceRoots: controlArray(options.boundary.payload.externalSources, "Work Boundary external sources").map((entry) => ({
      sourceId: controlString(controlObject(entry, "Boundary source").sourceId, "Boundary source identity"),
    })),
    implementationRoots: artifacts.filter(({ role, path }) => ["code", "test", "documentation"].includes(role) &&
      governedPath(options.loaded, path)).map(({ path }) => ({ path, reason: "integration-artifact-coverage" })),
    core: {
      obligations: controlArray(mandate.obligations, "Work Boundary obligations").map((value) => {
        const obligation = controlObject(value, "Work Boundary obligation");
        return { id: controlString(obligation.id, "Obligation identity"),
          sourceIds: controlArray(obligation.sourceIds, "Obligation sources").map((id) => controlString(id, "Obligation source identity")) };
      }),
      checks: controlArray(mandate.checks, "Work Boundary checks").map((value) => {
        const check = controlObject(value, "Work Boundary Check");
        return { id: controlString(check.id, "Check selection identity"),
          checkId: controlString(controlObject(check.definition, "Check definition").id, "Check identity") };
      }),
      requiredArtifacts: artifacts,
    },
  };
  const seeded = seedSubject({ ...options, subject });
  const profile = controlObject(options.boundary.payload.projectionProfile, "Work Boundary Projection profile");
  const maximumDepth = options.loaded.contract.projectionProfiles[controlString(profile.id, "Projection profile identity")]?.maximumRelationshipDepth;
  if (maximumDepth === undefined) {
    throw new FoundationError("lifecycle.projection.profile-unsupported", "Integration context requires the selected Projection closure bounds");
  }
  return Object.freeze({
    closure: buildClosure({ knowledge: options.knowledge, seeds: seeded.seeds, role: "reviewer", maximumDepth }),
    implementationPaths: Object.freeze([...seeded.implementationReasons.keys()]),
  });
}
