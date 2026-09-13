import { z } from "zod/v4";
import {
  FoundationGitObjectSchema,
  FoundationOpaqueIdSchema,
  FoundationSha256Schema,
} from "./core.js";
import {
  FOUNDATION_CONTEXT_INDEX_LIMIT,
  FoundationContextBasisSchema,
  FoundationContextSelectionSchema,
  FoundationRepositoryRelativePathSchema,
  FoundationSourceReferenceSchema,
  FoundationCursorSchema,
  FoundationIndexLimitSchema,
  addFoundationIssue,
  digestFoundationInspectionCursor,
  sameFoundationValue,
} from "./context-core.js";
import {
  FoundationNonnegativeSafeIntegerSchema,
  FoundationPlainTextSchema,
  FoundationPositiveSafeIntegerSchema,
} from "./internal.js";

/** Bounded Foundation Knowledge inspection contracts. */

const FoundationKnowledgeIdSchema = z.string().min(1).max(160)
  .regex(/^(?:behavior|assurance|blueprint|description|check|discipline)(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/u);
const FoundationKnowledgeOwnerIdSchema = z.string().min(1).max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u);
const FoundationKnowledgeOpaqueIdSchema = z.string().min(1).max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const FoundationKnowledgeSourceUriSchema = z.string().min(1).max(8_192)
  .refine((value) => !/\s|[\u0000-\u001f\u007f]/u.test(value), {
    message: "Knowledge source reference cannot contain whitespace or control characters",
  })
  .refine((value) => {
    try {
      new URL(value, "https://lifecycle.invalid/");
      return true;
    } catch {
      return false;
    }
  }, { message: "Knowledge source reference must be one valid URI reference" });

const FOUNDATION_KNOWLEDGE_KIND_ORDER = Object.freeze({
  behavior: 0,
  assurance: 1,
  blueprint: 2,
  description: 3,
  check: 4,
  discipline: 5,
} as const);

function compareFoundationCodePoints(left: string, right: string): number {
  const leftPoints = [...left];
  const rightPoints = [...right];
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index]!.codePointAt(0)! - rightPoints[index]!.codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

export const FoundationKnowledgeReferenceSchema = z.object({
  id: FoundationKnowledgeIdSchema,
  kind: z.enum(["behavior", "assurance", "blueprint", "description", "check", "discipline"]),
  status: z.enum(["draft", "current", "superseded", "retired"]),
  revision: FoundationPositiveSafeIntegerSchema,
  path: FoundationRepositoryRelativePathSchema,
  sourceDigest: FoundationSha256Schema,
  semanticDigest: FoundationSha256Schema,
}).strict().superRefine((value, context) => {
  if (!value.id.startsWith(`${value.kind}.`)) {
    addFoundationIssue(context, ["id"], "Knowledge identity kind must match its reference kind");
  }
});

export const FoundationKnowledgeIndexSelectorSchema = z.object({
  kind: z.literal("knowledge-index"),
  context: FoundationContextSelectionSchema,
  afterCursor: FoundationCursorSchema,
  limit: FoundationIndexLimitSchema,
}).strict();

export const FoundationKnowledgeRecordSelectorSchema = z.object({
  kind: z.literal("knowledge-record"),
  context: FoundationContextSelectionSchema,
  reference: FoundationKnowledgeReferenceSchema,
}).strict();

const FoundationKnowledgeIndexRowSchema = z.object({
  cursor: FoundationSha256Schema,
  reference: FoundationKnowledgeReferenceSchema,
  title: FoundationPlainTextSchema,
  summary: FoundationPlainTextSchema,
  owners: z.array(FoundationKnowledgeOwnerIdSchema).min(1).max(32),
  tags: z.array(z.string().min(1).max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)).max(64),
  selectedByBoundary: z.boolean(),
}).strict().superRefine((value, context) => {
  if (new Set(value.owners).size !== value.owners.length) {
    addFoundationIssue(context, ["owners"], "Knowledge owners cannot repeat");
  }
  if (new Set(value.tags).size !== value.tags.length) {
    addFoundationIssue(context, ["tags"], "Knowledge tags cannot repeat");
  }
});

export const FoundationKnowledgeIndexResultSchema = z.object({
  schema: z.literal("lifecycle.knowledge-index.v1"),
  kind: z.literal("knowledge-index"),
  basis: FoundationContextBasisSchema,
  records: z.array(FoundationKnowledgeIndexRowSchema)
    .max(FOUNDATION_CONTEXT_INDEX_LIMIT),
  nextAfterCursor: FoundationCursorSchema,
}).strict().superRefine((value, context) => {
  const keys = value.records.map(({ reference }) => `${reference.id}\u0000${reference.revision}`);
  if (new Set(keys).size !== keys.length) {
    addFoundationIssue(context, ["records"], "Knowledge index cannot repeat an exact record reference");
  }
  const cursors = value.records.map(({ cursor }) => cursor);
  if (new Set(cursors).size !== cursors.length) {
    addFoundationIssue(context, ["records"], "Knowledge index cursors cannot repeat");
  }
  if (value.nextAfterCursor !== null && value.records.length === 0) {
    addFoundationIssue(context, ["nextAfterCursor"], "An empty Knowledge page cannot advertise continuation");
  }
  for (let index = 0; index < value.records.length; index += 1) {
    const row = value.records[index]!;
    const expectedCursor = digestFoundationInspectionCursor({
      basisDigest: value.basis.digest,
      collection: "knowledge-records",
      key: {
        kind: row.reference.kind,
        id: row.reference.id,
        revision: row.reference.revision,
      },
    });
    if (row.cursor !== expectedCursor) {
      addFoundationIssue(context, ["records", index, "cursor"], "Knowledge cursor does not bind its context basis and exact record key");
    }
    if (index > 0) {
      const prior = value.records[index - 1]!.reference;
      const order = FOUNDATION_KNOWLEDGE_KIND_ORDER[prior.kind] -
        FOUNDATION_KNOWLEDGE_KIND_ORDER[row.reference.kind] ||
        compareFoundationCodePoints(prior.id, row.reference.id) ||
        prior.revision - row.reference.revision;
      if (order >= 0) {
        addFoundationIssue(context, ["records", index], "Knowledge index rows must use canonical record order");
      }
    }
  }
  if (
    value.nextAfterCursor !== null &&
    value.nextAfterCursor !== value.records.at(-1)?.cursor
  ) {
    addFoundationIssue(context, ["nextAfterCursor"], "Knowledge continuation must equal the final returned row cursor");
  }
});

const FoundationBoundedPlainTextListSchema = z.array(FoundationPlainTextSchema).max(256)
  .superRefine((value, context) => {
    if (new Set(value).size !== value.length) {
      addFoundationIssue(context, [], "Knowledge specification entries cannot repeat");
    }
  });
const FoundationNonemptyPlainTextListSchema = z.array(FoundationPlainTextSchema).min(1).max(256)
  .superRefine((value, context) => {
    if (new Set(value).size !== value.length) {
      addFoundationIssue(context, [], "Knowledge specification entries cannot repeat");
    }
  });

const FoundationBehaviorSpecSchema = z.object({
  outcome: FoundationPlainTextSchema,
  actors: FoundationNonemptyPlainTextListSchema,
  conditions: FoundationBoundedPlainTextListSchema,
  included: FoundationNonemptyPlainTextListSchema,
  excluded: FoundationBoundedPlainTextListSchema,
  examples: FoundationBoundedPlainTextListSchema,
  falsifiers: FoundationNonemptyPlainTextListSchema,
}).strict();

const FoundationAssuranceSpecSchema = z.object({
  obligation: FoundationPlainTextSchema,
  scope: FoundationNonemptyPlainTextListSchema,
  failureModes: FoundationNonemptyPlainTextListSchema,
  limits: FoundationNonemptyPlainTextListSchema,
  degradation: FoundationBoundedPlainTextListSchema,
  falsifiers: FoundationNonemptyPlainTextListSchema,
}).strict();

const FoundationBlueprintSpecSchema = z.object({
  decision: FoundationPlainTextSchema,
  scope: FoundationNonemptyPlainTextListSchema,
  components: FoundationNonemptyPlainTextListSchema,
  constraints: FoundationNonemptyPlainTextListSchema,
  interfaces: FoundationBoundedPlainTextListSchema,
  dataFlows: FoundationBoundedPlainTextListSchema,
  tradeoffs: FoundationNonemptyPlainTextListSchema,
  evolution: FoundationBoundedPlainTextListSchema,
}).strict();

const FoundationCoverageSelectorSchema = z.object({
  path: FoundationRepositoryRelativePathSchema,
  mode: z.enum(["file", "tree"]),
  role: z.literal("primary"),
  exclude: z.array(FoundationRepositoryRelativePathSchema).max(512),
}).strict().superRefine((value, context) => {
  if (value.mode === "file" && value.exclude.length !== 0) {
    addFoundationIssue(context, ["exclude"], "File coverage cannot carry exclusions");
  }
  if (new Set(value.exclude).size !== value.exclude.length) {
    addFoundationIssue(context, ["exclude"], "Coverage exclusions cannot repeat");
  }
  for (let index = 0; index < value.exclude.length; index += 1) {
    const excluded = value.exclude[index]!;
    if (excluded === value.path || !excluded.startsWith(`${value.path}/`)) {
      addFoundationIssue(context, ["exclude", index], "Coverage exclusion must be an exact descendant of its selected tree");
    }
  }
});

const FoundationDescriptionSpecSchema = z.object({
  responsibility: FoundationPlainTextSchema,
  coverage: z.array(FoundationCoverageSelectorSchema).min(1).max(512),
  behavior: FoundationNonemptyPlainTextListSchema,
  boundaries: FoundationNonemptyPlainTextListSchema,
  invariants: FoundationBoundedPlainTextListSchema,
  dependencies: FoundationBoundedPlainTextListSchema,
  failure: FoundationBoundedPlainTextListSchema,
  rationale: FoundationNonemptyPlainTextListSchema,
}).strict().superRefine((value, context) => {
  const keys = value.coverage.map(({ path, mode }) => `${path}\u0000${mode}`);
  if (new Set(keys).size !== keys.length) {
    addFoundationIssue(context, ["coverage"], "Description coverage selectors cannot repeat");
  }
});

const FoundationCheckSpecSchema = z.object({
  proposition: FoundationPlainTextSchema,
  subjects: z.array(z.object({
    kind: z.enum(["knowledge", "implementation", "candidate", "repository", "evidence", "other"]),
    selector: FoundationPlainTextSchema,
  }).strict()).min(1).max(64),
  evidenceKinds: z.array(z.enum(["command", "inspection", "artifact", "diff", "analysis", "mixed"]))
    .min(1).max(6),
  requiredBindings: z.array(FoundationOpaqueIdSchema).min(1).max(64),
  evaluation: z.object({
    pass: FoundationPlainTextSchema,
    fail: FoundationPlainTextSchema,
    indeterminate: FoundationPlainTextSchema,
    notRun: FoundationPlainTextSchema,
  }).strict(),
  limits: FoundationNonemptyPlainTextListSchema,
  freshness: z.object({
    subjectBinding: z.literal("exact"),
    maximumAgeMs: FoundationNonnegativeSafeIntegerSchema.nullable(),
    environmentBinding: z.enum(["exact", "class", "declared", "none"]),
  }).strict(),
  falsifiers: FoundationNonemptyPlainTextListSchema,
}).strict().superRefine((value, context) => {
  const subjects = value.subjects.map(({ kind, selector }) => `${kind}\u0000${selector}`);
  if (new Set(subjects).size !== subjects.length) {
    addFoundationIssue(context, ["subjects"], "Check subjects cannot repeat");
  }
  if (new Set(value.evidenceKinds).size !== value.evidenceKinds.length) {
    addFoundationIssue(context, ["evidenceKinds"], "Check evidence kinds cannot repeat");
  }
  if (new Set(value.requiredBindings).size !== value.requiredBindings.length) {
    addFoundationIssue(context, ["requiredBindings"], "Check bindings cannot repeat");
  }
});

const FoundationDisciplineSpecSchema = z.object({
  practice: FoundationPlainTextSchema,
  appliesWhen: FoundationNonemptyPlainTextListSchema,
  doesNotApplyWhen: FoundationBoundedPlainTextListSchema,
  guidance: FoundationNonemptyPlainTextListSchema,
  verification: FoundationBoundedPlainTextListSchema,
}).strict();

const FoundationKnowledgeSpecSchema = z.union([
  FoundationBehaviorSpecSchema,
  FoundationAssuranceSpecSchema,
  FoundationBlueprintSpecSchema,
  FoundationDescriptionSpecSchema,
  FoundationCheckSpecSchema,
  FoundationDisciplineSpecSchema,
]);

const FoundationKnowledgeSupersessionSchema = z.object({
  id: FoundationKnowledgeIdSchema,
  revision: FoundationPositiveSafeIntegerSchema,
  sourceDigest: FoundationSha256Schema,
  semanticDigest: FoundationSha256Schema,
}).strict();

const FoundationKnowledgeRelationshipSchema = z.object({
  type: z.enum(["refines", "constrains", "realizes", "verified-by", "depends-on", "related-to"]),
  target: z.object({
    id: FoundationKnowledgeIdSchema,
    revision: FoundationPositiveSafeIntegerSchema.nullable(),
    status: z.enum(["draft", "current", "superseded", "retired"]).nullable(),
    semanticDigest: FoundationSha256Schema.nullable(),
  }).strict(),
  required: z.boolean(),
  scope: FoundationPlainTextSchema.nullable(),
  rationale: FoundationPlainTextSchema.nullable(),
  digest: FoundationSha256Schema,
}).strict().superRefine((value, context) => {
  if (value.type === "related-to" && value.required) {
    addFoundationIssue(context, ["required"], "A related-to relationship cannot be required");
  }
  const targetFacts = [value.target.revision, value.target.status, value.target.semanticDigest];
  if (targetFacts.some((entry) => entry === null) && targetFacts.some((entry) => entry !== null)) {
    addFoundationIssue(context, ["target"], "Resolved relationship target facts are complete or all absent");
  }
  if (value.required && targetFacts.every((entry) => entry === null)) {
    addFoundationIssue(context, ["target"], "A required relationship cannot have an unresolved target");
  }
});

const FoundationKnowledgeConflictSchema = z.object({
  type: z.enum(["behavior-inclusion-exclusion", "assurance-limit", "blueprint-constraint"]),
  leftId: FoundationKnowledgeIdSchema,
  leftRevision: FoundationPositiveSafeIntegerSchema,
  leftFact: FoundationPlainTextSchema,
  rightId: FoundationKnowledgeIdSchema,
  rightRevision: FoundationPositiveSafeIntegerSchema,
  rightFact: FoundationPlainTextSchema,
  digest: FoundationSha256Schema,
}).strict();

const FoundationKnowledgeSourceSchema = z.object({
  id: FoundationKnowledgeOpaqueIdSchema,
  required: z.boolean(),
  reference: FoundationKnowledgeSourceUriSchema,
  revision: FoundationKnowledgeOpaqueIdSchema.nullable(),
  digest: FoundationSha256Schema.nullable(),
  role: z.enum([
    "decision",
    "research",
    "policy",
    "incident",
    "atlas-context",
    "external-standard",
    "repository-reality",
    "other",
  ]),
  resolution: z.object({
    kind: z.enum(["repository", "atlas", "external"]),
    locator: FoundationRepositoryRelativePathSchema.nullable(),
    objectId: FoundationGitObjectSchema.nullable(),
    resolvedDigest: FoundationSha256Schema.nullable(),
    disposition: z.enum([
      "resolved",
      "retrieval-denied",
      "missing",
      "unreadable",
      "digest-mismatch",
      "revision-mismatch",
      "role-mismatch",
    ]),
  }).strict(),
}).strict().superRefine((value, context) => {
  const resolved = value.resolution.disposition === "resolved";
  if (resolved && value.resolution.resolvedDigest === null) {
    addFoundationIssue(context, ["resolution", "resolvedDigest"], "A resolved Knowledge source requires its observed digest");
  }
  if (value.resolution.kind === "repository" && resolved && value.resolution.objectId === null) {
    addFoundationIssue(context, ["resolution", "objectId"], "A resolved repository source requires its Git object");
  }
  if (resolved && value.resolution.kind !== "external" && value.resolution.locator === null) {
    addFoundationIssue(context, ["resolution", "locator"], "A resolved local Knowledge source requires its repository path");
  }
});

export const FoundationKnowledgeRecordResultSchema = z.object({
  schema: z.literal("lifecycle.knowledge-record-inspection.v1"),
  kind: z.literal("knowledge-record"),
  basis: FoundationContextBasisSchema,
  reference: FoundationKnowledgeReferenceSchema,
  title: FoundationPlainTextSchema,
  summary: FoundationPlainTextSchema,
  owners: z.array(FoundationKnowledgeOwnerIdSchema).min(1).max(32),
  supersedes: FoundationKnowledgeSupersessionSchema.nullable(),
  tags: z.array(z.string().min(1).max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)).max(64),
  spec: FoundationKnowledgeSpecSchema,
  relationships: z.array(FoundationKnowledgeRelationshipSchema).max(512),
  conflicts: z.array(FoundationKnowledgeConflictSchema).max(512),
  sources: z.array(FoundationKnowledgeSourceSchema).max(128),
  selectedByBoundary: z.boolean(),
  bodyRepresentation: z.literal("normalized-semantic-body"),
  body: FoundationSourceReferenceSchema,
}).strict().superRefine((value, context) => {
  if (!sameFoundationValue(value.body.selection, value.basis.selection)) {
    addFoundationIssue(context, ["body", "selection"], "Knowledge body uses another inspection selection");
  }
  if (value.body.basisDigest !== value.basis.digest) {
    addFoundationIssue(context, ["body", "basisDigest"], "Knowledge body uses another context basis");
  }
  if (
    value.body.sourceKind !== "knowledge-body" ||
    value.body.subject.kind !== "knowledge-record" ||
    value.body.subject.id !== value.reference.id ||
    value.body.subject.revision !== value.reference.revision ||
    value.body.subject.digest !== value.reference.semanticDigest ||
    value.body.path !== value.reference.path
  ) {
    addFoundationIssue(context, ["body"], "Knowledge body does not bind the inspected record");
  }
  if (new Set(value.owners).size !== value.owners.length) {
    addFoundationIssue(context, ["owners"], "Knowledge owners cannot repeat");
  }
  if (new Set(value.tags).size !== value.tags.length) {
    addFoundationIssue(context, ["tags"], "Knowledge tags cannot repeat");
  }
  if ((value.reference.revision === 1) !== (value.supersedes === null)) {
    addFoundationIssue(context, ["supersedes"], "Knowledge supersession presence must match the revision");
  }
  if (value.supersedes !== null && (
    value.supersedes.id !== value.reference.id ||
    value.supersedes.revision !== value.reference.revision - 1
  )) {
    addFoundationIssue(context, ["supersedes"], "Knowledge supersession must name the immediate predecessor revision of the same identity");
  }
  for (let index = 0; index < value.conflicts.length; index += 1) {
    const conflict = value.conflicts[index]!;
    if (conflict.leftId !== value.reference.id && conflict.rightId !== value.reference.id) {
      addFoundationIssue(context, ["conflicts", index], "Displayed Knowledge conflict must involve the inspected record");
    }
  }
  if (new Set(value.sources.map(({ id }) => id)).size !== value.sources.length) {
    addFoundationIssue(context, ["sources"], "Knowledge sources cannot repeat one identity");
  }
  const specifications = {
    behavior: FoundationBehaviorSpecSchema,
    assurance: FoundationAssuranceSpecSchema,
    blueprint: FoundationBlueprintSpecSchema,
    description: FoundationDescriptionSpecSchema,
    check: FoundationCheckSpecSchema,
    discipline: FoundationDisciplineSpecSchema,
  } as const;
  if (!specifications[value.reference.kind].safeParse(value.spec).success) {
    addFoundationIssue(context, ["spec"], "Knowledge public specification does not match the record kind");
  }
  if (value.reference.kind === "discipline") {
    if (value.owners.length !== 1) {
      addFoundationIssue(context, ["owners"], "An adopted Discipline has one Pack publisher owner");
    }
    if (value.conflicts.length !== 0) {
      addFoundationIssue(context, ["conflicts"], "Advisory Discipline guidance cannot carry product conflicts");
    }
    if (value.sources.some(({ required }) => required)) {
      addFoundationIssue(context, ["sources"], "Advisory Discipline sources cannot be required");
    }
  }
  for (let index = 0; index < value.relationships.length; index += 1) {
    const edge = value.relationships[index]!;
    if ((value.reference.kind === "discipline" || edge.target.id.startsWith("discipline.")) &&
        (edge.type !== "related-to" || edge.required)) {
      addFoundationIssue(context, ["relationships", index], "Discipline relationships are optional related-to guidance");
    }
  }
});

export type FoundationKnowledgeReference = z.output<typeof FoundationKnowledgeReferenceSchema>;
export type FoundationKnowledgeIndexResult = z.output<typeof FoundationKnowledgeIndexResultSchema>;
export type FoundationKnowledgeRecordResult = z.output<typeof FoundationKnowledgeRecordResultSchema>;
