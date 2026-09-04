import { basename } from "node:path";
import { FoundationError } from "../error.js";
import { FOUNDATION_KNOWLEDGE_SCHEMA } from "../constants.js";
import type { FoundationRepositoryContract } from "../repository/types.js";
import { digestCanonical, type Sha256 } from "../validation/canonical.js";
import { compareCodePoints as codePointCompare } from "../validation/ordering.js";
import {
  FOUNDATION_KNOWLEDGE_RECORD_SCHEMA_ID,
  assertFoundationSchema,
} from "../validation/schema-engine.js";
import {
  array,
  bool,
  enumeration,
  gitObject,
  integer,
  knowledgeId,
  opaqueId,
  ownerId,
  sha256,
  singleLine,
  text,
  uniqueStrings,
} from "../validation/value.js";
import { parseKnowledgeDocument } from "./front-matter.js";
import { exactKnowledgeKeys, knowledgeObject, normalizedKnowledgePath, type KnowledgeJsonObject } from "./structural.js";
import type {
  FoundationAssuranceSpec,
  FoundationBehaviorSpec,
  FoundationBlueprintSpec,
  FoundationCheckSpec,
  FoundationCoverageSelector,
  FoundationDescriptionSpec,
  FoundationDeclaredConflict,
  FoundationEvidenceKind,
  FoundationKnowledgeFrontMatter,
  FoundationKnowledgeKind,
  FoundationKnowledgeRecord,
  FoundationKnowledgeSpec,
  FoundationRelationship,
  FoundationSourceBinding,
} from "./types.js";

const STANDARD_FIELDS = ["schema", "kind", "id", "title", "status", "revision", "supersedes", "summary", "owners", "sources", "relationships", "conflicts", "tags", "spec"] as const;
const BODY_SECTIONS: Readonly<Record<FoundationKnowledgeKind, readonly string[]>> = Object.freeze({
  behavior: ["Meaning", "Boundaries", "Examples", "Rationale"],
  assurance: ["Obligation", "Failure Model", "Limits", "Rationale"],
  blueprint: ["Decision", "Structure", "Tradeoffs", "Evolution"],
  description: ["Responsibility", "Behavior", "Boundaries", "Rationale"],
  check: ["Proposition", "Evaluation", "Evidence", "Limits"],
});

function closedKeys(value: KnowledgeJsonObject, required: readonly string[], optional: readonly string[], code: string, label: string): void {
  exactKnowledgeKeys(value, required, optional, false, code, label);
}

function extensibleKeys(value: KnowledgeJsonObject, required: readonly string[], optional: readonly string[], code: string, label: string): void {
  exactKnowledgeKeys(value, required, optional, true, code, label);
}

function extensions(value: KnowledgeJsonObject, standard: readonly string[]): Readonly<Record<string, unknown>> {
  const allowed = new Set(standard);
  return Object.freeze(Object.fromEntries(Object.entries(value)
    .filter(([key]) => !allowed.has(key))
    .sort(([left], [right]) => codePointCompare(left, right))));
}

function stringList(value: unknown, label: string, minimum: number, maximum = 256): readonly string[] {
  const values = uniqueStrings(value, label, minimum, maximum, 16_384);
  return Object.freeze(values);
}

function sortedStringSet(value: unknown, label: string, minimum: number, maximum: number, itemMaximum: number): readonly string[] {
  return Object.freeze(uniqueStrings(value, label, minimum, maximum, itemMaximum).sort(codePointCompare));
}

function uriReference(value: unknown, label: string): string {
  const result = text(value, label, 8192);
  if (/\s|[\u0000-\u001f\u007f]/u.test(result)) {
    throw new FoundationError("lifecycle.knowledge.source-reference", `${label} must be one URI reference without whitespace or control characters`);
  }
  try {
    // WHATWG parsing with a fixed base validates both absolute and relative references.
    new URL(result, "https://lifecycle.invalid/");
  } catch {
    throw new FoundationError("lifecycle.knowledge.source-reference", `${label} is not a valid URI reference`);
  }
  return result;
}

function parseSource(value: unknown, index: number): FoundationSourceBinding {
  const source = knowledgeObject(value, "lifecycle.knowledge.source", `Knowledge source ${index}`);
  closedKeys(source, ["id", "required", "reference", "revision", "digest", "role"], [], "lifecycle.knowledge.source", `Knowledge source ${index}`);
  return Object.freeze({
    id: opaqueId(source.id, `Knowledge source ${index} id`),
    required: bool(source.required, `Knowledge source ${index} required`),
    reference: uriReference(source.reference, `Knowledge source ${index} reference`),
    revision: source.revision === null ? null : opaqueId(source.revision, `Knowledge source ${index} revision`),
    digest: source.digest === null ? null : sha256(source.digest, `Knowledge source ${index} digest`),
    role: enumeration(source.role, `Knowledge source ${index} role`, ["decision", "research", "policy", "incident", "atlas-context", "external-standard", "repository-reality", "other"] as const),
  });
}

function parseConflict(value: unknown, index: number): FoundationDeclaredConflict {
  const source = knowledgeObject(value, "lifecycle.knowledge.conflict", `Knowledge conflict ${index}`);
  closedKeys(source, ["type", "target", "localFact", "targetFact"], [], "lifecycle.knowledge.conflict", `Knowledge conflict ${index}`);
  return Object.freeze({
    type: enumeration(source.type, `Knowledge conflict ${index} type`, ["assurance-limit", "blueprint-constraint"] as const),
    target: knowledgeId(source.target, `Knowledge conflict ${index} target`),
    localFact: text(source.localFact, `Knowledge conflict ${index} local fact`),
    targetFact: text(source.targetFact, `Knowledge conflict ${index} target fact`),
  });
}

function parseRelationship(value: unknown, index: number): FoundationRelationship {
  const source = knowledgeObject(value, "lifecycle.relationship.shape", `Relationship ${index}`);
  extensibleKeys(source, ["type", "target", "required"], ["scope", "rationale"], "lifecycle.relationship.shape", `Relationship ${index}`);
  const type = enumeration(source.type, `Relationship ${index} type`, ["refines", "constrains", "realizes", "verified-by", "depends-on", "related-to"] as const);
  const required = bool(source.required, `Relationship ${index} required`);
  if (type === "related-to" && required) {
    throw new FoundationError("lifecycle.relationship.kind-invalid", "related-to relationships cannot be mandatory");
  }
  const scope = Object.hasOwn(source, "scope") && source.scope !== null ? text(source.scope, `Relationship ${index} scope`) : null;
  const rationale = Object.hasOwn(source, "rationale") && source.rationale !== null ? text(source.rationale, `Relationship ${index} rationale`) : null;
  const relationshipExtensions = extensions(source, ["type", "target", "required", "scope", "rationale"]);
  const canonicalValue = Object.freeze({
    type,
    target: knowledgeId(source.target, `Relationship ${index} target`),
    required,
    ...(Object.hasOwn(source, "scope") ? { scope } : {}),
    ...(Object.hasOwn(source, "rationale") ? { rationale } : {}),
    ...relationshipExtensions,
  });
  return Object.freeze({
    type,
    target: canonicalValue.target,
    required,
    scope,
    rationale,
    extensions: relationshipExtensions,
    canonicalValue,
  });
}

function parseBehavior(value: unknown): FoundationBehaviorSpec {
  const source = knowledgeObject(value, "lifecycle.knowledge.behavior", "Behavior spec");
  closedKeys(source, ["outcome", "actors", "conditions", "included", "excluded", "examples", "falsifiers"], [], "lifecycle.knowledge.behavior", "Behavior spec");
  return Object.freeze({
    outcome: text(source.outcome, "Behavior outcome"),
    actors: stringList(source.actors, "Behavior actors", 1),
    conditions: stringList(source.conditions, "Behavior conditions", 0),
    included: stringList(source.included, "Behavior included behavior", 1),
    excluded: stringList(source.excluded, "Behavior excluded behavior", 0),
    examples: stringList(source.examples, "Behavior examples", 0),
    falsifiers: stringList(source.falsifiers, "Behavior falsifiers", 1),
  });
}

function parseAssurance(value: unknown): FoundationAssuranceSpec {
  const source = knowledgeObject(value, "lifecycle.knowledge.assurance", "Assurance spec");
  closedKeys(source, ["obligation", "scope", "failureModes", "limits", "degradation", "falsifiers"], [], "lifecycle.knowledge.assurance", "Assurance spec");
  return Object.freeze({
    obligation: text(source.obligation, "Assurance obligation"),
    scope: stringList(source.scope, "Assurance scope", 1),
    failureModes: stringList(source.failureModes, "Assurance failure modes", 1),
    limits: stringList(source.limits, "Assurance limits", 1),
    degradation: stringList(source.degradation, "Assurance degradation", 0),
    falsifiers: stringList(source.falsifiers, "Assurance falsifiers", 1),
  });
}

function parseBlueprint(value: unknown): FoundationBlueprintSpec {
  const source = knowledgeObject(value, "lifecycle.knowledge.blueprint", "Blueprint spec");
  closedKeys(source, ["decision", "scope", "components", "constraints", "interfaces", "dataFlows", "tradeoffs", "evolution"], [], "lifecycle.knowledge.blueprint", "Blueprint spec");
  return Object.freeze({
    decision: text(source.decision, "Blueprint decision"),
    scope: stringList(source.scope, "Blueprint scope", 1),
    components: stringList(source.components, "Blueprint components", 1),
    constraints: stringList(source.constraints, "Blueprint constraints", 1),
    interfaces: stringList(source.interfaces, "Blueprint interfaces", 0),
    dataFlows: stringList(source.dataFlows, "Blueprint data flows", 0),
    tradeoffs: stringList(source.tradeoffs, "Blueprint tradeoffs", 1),
    evolution: stringList(source.evolution, "Blueprint evolution", 0),
  });
}

function parseCoverageSelector(value: unknown, index: number, maximumPathBytes: number): FoundationCoverageSelector {
  const source = knowledgeObject(value, "lifecycle.description.coverage", `Description coverage selector ${index}`);
  closedKeys(source, ["path", "mode", "role", "exclude"], [], "lifecycle.description.coverage", `Description coverage selector ${index}`);
  const mode = enumeration(source.mode, `Description coverage selector ${index} mode`, ["file", "tree"] as const);
  const exclude = sortedStringSet(source.exclude, `Description coverage selector ${index} exclusions`, 0, 512, 4096)
    .map((entry, exclusionIndex) => normalizedKnowledgePath(entry, `Description coverage selector ${index} exclusion ${exclusionIndex}`, maximumPathBytes));
  if (mode === "file" && exclude.length > 0) {
    throw new FoundationError("lifecycle.description.coverage-selector", `File coverage selector ${index} cannot declare exclusions`);
  }
  const path = normalizedKnowledgePath(source.path, `Description coverage selector ${index} path`, maximumPathBytes);
  for (const excluded of exclude) {
    if (excluded === path || !excluded.startsWith(`${path}/`)) {
      throw new FoundationError("lifecycle.description.coverage-selector", `Coverage exclusion ${excluded} must be an exact descendant of ${path}`);
    }
  }
  return Object.freeze({ path, mode, role: enumeration(source.role, `Description coverage selector ${index} role`, ["primary"] as const), exclude: Object.freeze(exclude) });
}

function parseDescription(value: unknown, maximumPathBytes: number): FoundationDescriptionSpec {
  const source = knowledgeObject(value, "lifecycle.knowledge.description", "Description spec");
  closedKeys(source, ["responsibility", "coverage", "behavior", "boundaries", "invariants", "dependencies", "failure", "rationale"], [], "lifecycle.knowledge.description", "Description spec");
  const coverage = array(source.coverage, "Description coverage", 1, 512).map((entry, index) => parseCoverageSelector(entry, index, maximumPathBytes))
    .sort((left, right) => codePointCompare(`${left.path}\0${left.mode}`, `${right.path}\0${right.mode}`));
  const keys = coverage.map((entry) => `${entry.path}\0${entry.mode}`);
  if (new Set(keys).size !== keys.length) throw new FoundationError("lifecycle.description.coverage-duplicate", "Description repeats one coverage selector");
  return Object.freeze({
    responsibility: text(source.responsibility, "Description responsibility"),
    coverage: Object.freeze(coverage),
    behavior: stringList(source.behavior, "Description behavior", 1),
    boundaries: stringList(source.boundaries, "Description boundaries", 1),
    invariants: stringList(source.invariants, "Description invariants", 0),
    dependencies: stringList(source.dependencies, "Description dependencies", 0),
    failure: stringList(source.failure, "Description failure", 0),
    rationale: stringList(source.rationale, "Description rationale", 1),
  });
}

function parseCheck(value: unknown): FoundationCheckSpec {
  const source = knowledgeObject(value, "lifecycle.knowledge.check", "Check spec");
  closedKeys(source, ["proposition", "subjects", "evidenceKinds", "requiredBindings", "evaluation", "limits", "freshness", "falsifiers"], [], "lifecycle.knowledge.check", "Check spec");
  const subjects = array(source.subjects, "Check subjects", 1, 64).map((entry, index) => {
    const subject = knowledgeObject(entry, "lifecycle.knowledge.check-subject", `Check subject ${index}`);
    closedKeys(subject, ["kind", "selector"], [], "lifecycle.knowledge.check-subject", `Check subject ${index}`);
    return Object.freeze({
      kind: enumeration(subject.kind, `Check subject ${index} kind`, ["knowledge", "implementation", "candidate", "repository", "evidence", "other"] as const),
      selector: text(subject.selector, `Check subject ${index} selector`),
    });
  }).sort((left, right) => codePointCompare(`${left.kind}\0${left.selector}`, `${right.kind}\0${right.selector}`));
  if (new Set(subjects.map(({ kind, selector }) => `${kind}\0${selector}`)).size !== subjects.length) {
    throw new FoundationError("lifecycle.knowledge.check-subject-duplicate", "Check subjects contain duplicate kind and selector pairs");
  }
  const evaluation = knowledgeObject(source.evaluation, "lifecycle.knowledge.check-evaluation", "Check evaluation");
  closedKeys(evaluation, ["pass", "fail", "indeterminate", "notRun"], [], "lifecycle.knowledge.check-evaluation", "Check evaluation");
  const freshness = knowledgeObject(source.freshness, "lifecycle.knowledge.check-freshness", "Check freshness");
  closedKeys(freshness, ["subjectBinding", "maximumAgeMs", "environmentBinding"], [], "lifecycle.knowledge.check-freshness", "Check freshness");
  const evidenceKinds = array(source.evidenceKinds, "Check evidence kinds", 1, 6)
    .map((entry, index) => enumeration(entry, `Check evidence kind ${index}`, ["command", "inspection", "artifact", "diff", "analysis", "mixed"] as const))
    .sort(codePointCompare) as FoundationEvidenceKind[];
  if (new Set(evidenceKinds).size !== evidenceKinds.length) throw new FoundationError("lifecycle.knowledge.check-evidence-duplicate", "Check evidence kinds contain duplicates");
  return Object.freeze({
    proposition: text(source.proposition, "Check proposition"),
    subjects: Object.freeze(subjects),
    evidenceKinds: Object.freeze(evidenceKinds),
    requiredBindings: sortedStringSet(source.requiredBindings, "Check required bindings", 1, 64, 160).map((entry, index) => opaqueId(entry, `Check required binding ${index}`)),
    evaluation: Object.freeze({
      pass: text(evaluation.pass, "Check pass semantics"),
      fail: text(evaluation.fail, "Check fail semantics"),
      indeterminate: text(evaluation.indeterminate, "Check indeterminate semantics"),
      notRun: text(evaluation.notRun, "Check not-run semantics"),
    }),
    limits: stringList(source.limits, "Check limits", 1),
    freshness: Object.freeze({
      subjectBinding: enumeration(freshness.subjectBinding, "Check subject binding", ["exact"] as const),
      maximumAgeMs: freshness.maximumAgeMs === null ? null : integer(freshness.maximumAgeMs, "Check maximum age", 0),
      environmentBinding: enumeration(freshness.environmentBinding, "Check environment binding", ["exact", "class", "declared", "none"] as const),
    }),
    falsifiers: stringList(source.falsifiers, "Check falsifiers", 1),
  });
}

function parseSpec(kind: FoundationKnowledgeKind, value: unknown, maximumPathBytes: number): FoundationKnowledgeSpec {
  switch (kind) {
    case "behavior": return parseBehavior(value);
    case "assurance": return parseAssurance(value);
    case "blueprint": return parseBlueprint(value);
    case "description": return parseDescription(value, maximumPathBytes);
    case "check": return parseCheck(value);
  }
}

function specValue(spec: FoundationKnowledgeSpec): unknown {
  return spec;
}

export function expectedKnowledgeKind(path: string, contract: FoundationRepositoryContract): FoundationKnowledgeKind | null {
  const roots = contract.knowledge.roots;
  if (path.startsWith(`${roots.behavior}/`) && path.endsWith(".md")) return "behavior";
  if (path.startsWith(`${roots.assurance}/`) && path.endsWith(".md")) return "assurance";
  if (path.startsWith(`${roots.blueprint}/`) && path.endsWith(".md")) return "blueprint";
  if (path.startsWith(`${roots.check}/`) && path.endsWith(".md")) return "check";
  const forbidden = [".lifecycle/", "records/control/", `${contract.atlas.root}/`];
  if (forbidden.some((prefix) => path.startsWith(prefix))) return null;
  if (basename(path).startsWith("_") && basename(path).endsWith(".desc.md")) return "description";
  return null;
}

function validateBody(path: string, kind: FoundationKnowledgeKind, title: string, body: string, headings: FoundationKnowledgeRecord["headings"]): void {
  const firstNonblankLine = body.split("\n").findIndex((line) => line.trim().length > 0) + 1;
  const levelOne = headings.filter((heading) => heading.level === 1);
  if (levelOne.length !== 1 || levelOne[0]!.line !== firstNonblankLine || levelOne[0]!.text !== title) {
    throw new FoundationError("lifecycle.knowledge.body-title", `${path} must begin with exactly one level-one title matching ${JSON.stringify(title)}`);
  }
  const levelTwo = headings.filter((heading) => heading.level === 2);
  for (const required of BODY_SECTIONS[kind]) {
    const matches = levelTwo.filter((heading) => heading.text === required);
    if (matches.length !== 1) {
      throw new FoundationError("lifecycle.knowledge.body-section", `${path} must contain exactly one level-two ${required} section`);
    }
  }
}

export function parseKnowledgeRecord(options: {
  path: string;
  mode: string;
  objectId: string;
  bytes: Buffer;
  contract: FoundationRepositoryContract;
}): FoundationKnowledgeRecord {
  if (options.mode !== "100644") {
    throw new FoundationError("lifecycle.knowledge.file-mode", `${options.path} must be one non-executable regular Git blob`);
  }
  const path = normalizedKnowledgePath(options.path, "Knowledge record path", options.contract.knowledge.limits.maximumPathBytes);
  gitObject(options.objectId, `${path} Git object`);
  const expected = expectedKnowledgeKind(path, options.contract);
  if (expected === null) throw new FoundationError("lifecycle.knowledge.kind-location", `${path} is not one standard Knowledge locator`);
  const document = parseKnowledgeDocument(path, options.bytes, options.contract.knowledge.limits);
  assertFoundationSchema(FOUNDATION_KNOWLEDGE_RECORD_SCHEMA_ID, document.frontMatterValue, path);
  const source = knowledgeObject(document.frontMatterValue, "lifecycle.knowledge.front-matter-object", `${path} front matter`);
  extensibleKeys(source, STANDARD_FIELDS, [], "lifecycle.knowledge.front-matter-fields", `${path} front matter`);

  const kind = enumeration(source.kind, `${path} kind`, ["behavior", "assurance", "blueprint", "description", "check"] as const);
  if (kind !== expected) throw new FoundationError("lifecycle.knowledge.kind-location", `${path} physically requires kind ${expected}, not ${kind}`);
  const id = knowledgeId(source.id, `${path} id`);
  if (!id.startsWith(`${kind}.`)) throw new FoundationError("lifecycle.knowledge.id-kind", `${id} does not match kind ${kind}`);
  const revision = integer(source.revision, `${path} revision`, 1, 2_147_483_647);
  const supersedes = source.supersedes === null ? null : (() => {
    const value = knowledgeObject(source.supersedes, "lifecycle.knowledge.supersession-invalid", `${path} supersedes`);
    closedKeys(value, ["id", "revision", "sourceDigest", "semanticDigest"], [], "lifecycle.knowledge.supersession-invalid", `${path} supersedes`);
    return Object.freeze({
      id: knowledgeId(value.id, `${path} superseded id`),
      revision: integer(value.revision, `${path} superseded revision`, 1),
      sourceDigest: sha256(value.sourceDigest, `${path} superseded source digest`),
      semanticDigest: sha256(value.semanticDigest, `${path} superseded semantic digest`),
    });
  })();
  if ((revision === 1) !== (supersedes === null)) {
    throw new FoundationError("lifecycle.knowledge.supersession-invalid", `${path} revision and supersedes relationship disagree`);
  }
  if (supersedes !== null && (supersedes.id !== id || supersedes.revision !== revision - 1)) {
    throw new FoundationError("lifecycle.knowledge.supersession-invalid", `${path} must supersede revision ${revision - 1} of ${id}`);
  }

  const owners = sortedStringSet(source.owners, `${path} owners`, 1, 32, 160).map((entry, index) => ownerId(entry, `${path} owner ${index}`));
  const sources = array(source.sources, `${path} sources`, 0, options.contract.knowledge.limits.maximumSourcesPerRecord).map(parseSource)
    .sort((left, right) => codePointCompare(`${left.id}\0${left.reference}\0${left.revision ?? ""}`, `${right.id}\0${right.reference}\0${right.revision ?? ""}`));
  const relationships = array(source.relationships, `${path} relationships`, 0, 512).map(parseRelationship)
    .sort((left, right) => codePointCompare(`${left.type}\0${left.target}\0${left.scope ?? ""}`, `${right.type}\0${right.target}\0${right.scope ?? ""}`));
  const relationshipKeys = relationships.map((entry) => `${entry.type}\0${entry.target}`);
  if (new Set(relationshipKeys).size !== relationshipKeys.length) {
    throw new FoundationError("lifecycle.relationship.duplicate", `${path} repeats a relationship type and target`);
  }
  const conflicts = array(source.conflicts, `${path} conflicts`, 0, 512).map(parseConflict)
    .sort((left, right) => codePointCompare(
      `${left.type}\0${left.target}\0${left.localFact}\0${left.targetFact}`,
      `${right.type}\0${right.target}\0${right.localFact}\0${right.targetFact}`,
    ));
  const conflictKeys = conflicts.map((entry) => `${entry.type}\0${entry.target}\0${entry.localFact}\0${entry.targetFact}`);
  if (new Set(conflictKeys).size !== conflictKeys.length) {
    throw new FoundationError("lifecycle.knowledge.conflict-duplicate", `${path} repeats one exact conflict declaration`);
  }
  if ((kind === "behavior" || kind === "description" || kind === "check") && conflicts.length > 0) {
    throw new FoundationError("lifecycle.knowledge.conflict-kind", `${path} kind ${kind} cannot declare structured conflicts`);
  }
  if (kind === "assurance" && conflicts.some((entry) => entry.type !== "assurance-limit" || !entry.target.startsWith("assurance."))) {
    throw new FoundationError("lifecycle.knowledge.conflict-kind", `${path} Assurance conflicts must target Assurance limits`);
  }
  if (kind === "blueprint" && conflicts.some((entry) => entry.type !== "blueprint-constraint" || !entry.target.startsWith("blueprint."))) {
    throw new FoundationError("lifecycle.knowledge.conflict-kind", `${path} Blueprint conflicts must target Blueprint constraints`);
  }
  const spec = parseSpec(kind, source.spec, options.contract.knowledge.limits.maximumPathBytes);
  const topExtensions = extensions(source, STANDARD_FIELDS);
  const canonicalValue: Record<string, unknown> = {
    schema: enumeration(source.schema, `${path} schema`, [FOUNDATION_KNOWLEDGE_SCHEMA] as const),
    kind,
    id,
    title: singleLine(source.title, `${path} title`, 1024),
    status: enumeration(source.status, `${path} status`, ["draft", "current", "superseded", "retired"] as const),
    revision,
    supersedes,
    summary: text(source.summary, `${path} summary`),
    owners,
    sources,
    relationships: relationships.map((entry) => entry.canonicalValue),
    conflicts,
    tags: sortedStringSet(source.tags, `${path} tags`, 0, 64, 80).map((entry) => {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(entry)) throw new FoundationError("lifecycle.knowledge.tag", `${path} tag ${entry} is invalid`);
      return entry;
    }),
    spec: specValue(spec),
    ...topExtensions,
  };
  const frontMatter: FoundationKnowledgeFrontMatter = Object.freeze({
    schema: FOUNDATION_KNOWLEDGE_SCHEMA,
    kind,
    id,
    title: canonicalValue.title as string,
    status: canonicalValue.status as FoundationKnowledgeFrontMatter["status"],
    revision,
    supersedes,
    summary: canonicalValue.summary as string,
    owners: Object.freeze(owners),
    sources: Object.freeze(sources),
    relationships: Object.freeze(relationships),
    conflicts: Object.freeze(conflicts),
    tags: Object.freeze(canonicalValue.tags as string[]),
    spec,
    extensions: topExtensions,
    canonicalValue: Object.freeze(canonicalValue),
  });
  validateBody(path, kind, frontMatter.title, document.bodyNormalized, document.headings);
  const semanticDigest = digestCanonical({ body: document.bodyNormalized, frontMatter: canonicalValue }) as Sha256;
  return Object.freeze({
    path,
    mode: "100644",
    objectId: options.objectId,
    sourceText: document.sourceText,
    body: document.body,
    bodyNormalized: document.bodyNormalized,
    headings: document.headings,
    frontMatter,
    sourceDigest: document.sourceDigest,
    semanticDigest,
  });
}
