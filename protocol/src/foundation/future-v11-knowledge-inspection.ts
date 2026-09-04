import { z } from "zod/v4";
import {
  FoundationGitObjectSchema,
  FoundationOpaqueIdSchema,
  FoundationSha256Schema,
} from "./core.js";
import {
  FOUNDATION_FUTURE_V11_CONTEXT_INDEX_LIMIT,
  FoundationFutureV11ContextBasisSchema,
  FoundationFutureV11ContextSelectionSchema,
  FoundationFutureV11RepositoryRelativePathSchema,
  FoundationFutureV11SourceReferenceSchema,
  FutureV11CursorSchema,
  FutureV11IndexLimitSchema,
  addFutureV11Issue,
  digestFutureV11InspectionCursor,
} from "./future-v11-context-core.js";
import {
  FoundationNonnegativeSafeIntegerSchema,
  FoundationPlainTextSchema,
  FoundationPositiveSafeIntegerSchema,
} from "./internal.js";

/** Private, unbarreled Foundation v11 Knowledge inspection preparation. */

const FoundationFutureV11KnowledgeIdSchema = z.string().min(1).max(160)
  .regex(/^(?:behavior|assurance|blueprint|description|check)(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/u);
const FoundationFutureV11KnowledgeOwnerIdSchema = z.string().min(1).max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u);
const FoundationFutureV11KnowledgeOpaqueIdSchema = z.string().min(1).max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const FoundationFutureV11KnowledgeSourceUriSchema = z.string().min(1).max(8_192)
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

const FUTURE_V11_KNOWLEDGE_KIND_ORDER = Object.freeze({
  behavior: 0,
  assurance: 1,
  blueprint: 2,
  description: 3,
  check: 4,
} as const);

function compareFutureV11CodePoints(left: string, right: string): number {
  const leftPoints = [...left];
  const rightPoints = [...right];
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftPoints[index]!.codePointAt(0)! - rightPoints[index]!.codePointAt(0)!;
    if (difference !== 0) return difference;
  }
  return leftPoints.length - rightPoints.length;
}

export const FoundationFutureV11KnowledgeReferenceSchema = z.object({
  id: FoundationFutureV11KnowledgeIdSchema,
  kind: z.enum(["behavior", "assurance", "blueprint", "description", "check"]),
  status: z.enum(["draft", "current", "superseded", "retired"]),
  revision: FoundationPositiveSafeIntegerSchema,
  path: FoundationFutureV11RepositoryRelativePathSchema,
  sourceDigest: FoundationSha256Schema,
  semanticDigest: FoundationSha256Schema,
}).strict().superRefine((value, context) => {
  if (!value.id.startsWith(`${value.kind}.`)) {
    addFutureV11Issue(context, ["id"], "Knowledge identity kind must match its reference kind");
  }
});

export const FoundationFutureV11KnowledgeIndexSelectorSchema = z.object({
  kind: z.literal("knowledge-index"),
  context: FoundationFutureV11ContextSelectionSchema,
  afterCursor: FutureV11CursorSchema,
  limit: FutureV11IndexLimitSchema,
}).strict();

export const FoundationFutureV11KnowledgeRecordSelectorSchema = z.object({
  kind: z.literal("knowledge-record"),
  context: FoundationFutureV11ContextSelectionSchema,
  reference: FoundationFutureV11KnowledgeReferenceSchema,
}).strict();

const FoundationFutureV11KnowledgeIndexRowSchema = z.object({
  cursor: FoundationSha256Schema,
  reference: FoundationFutureV11KnowledgeReferenceSchema,
  title: FoundationPlainTextSchema,
  summary: FoundationPlainTextSchema,
  owners: z.array(FoundationFutureV11KnowledgeOwnerIdSchema).min(1).max(32),
  tags: z.array(z.string().min(1).max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)).max(64),
  selectedByBoundary: z.boolean(),
}).strict().superRefine((value, context) => {
  if (new Set(value.owners).size !== value.owners.length) {
    addFutureV11Issue(context, ["owners"], "Knowledge owners cannot repeat");
  }
  if (new Set(value.tags).size !== value.tags.length) {
    addFutureV11Issue(context, ["tags"], "Knowledge tags cannot repeat");
  }
});

export const FoundationFutureV11KnowledgeIndexResultSchema = z.object({
  schema: z.literal("lifecycle.knowledge-index.v1"),
  basis: FoundationFutureV11ContextBasisSchema,
  records: z.array(FoundationFutureV11KnowledgeIndexRowSchema)
    .max(FOUNDATION_FUTURE_V11_CONTEXT_INDEX_LIMIT),
  nextAfterCursor: FutureV11CursorSchema,
}).strict().superRefine((value, context) => {
  const keys = value.records.map(({ reference }) => `${reference.id}\u0000${reference.revision}`);
  if (new Set(keys).size !== keys.length) {
    addFutureV11Issue(context, ["records"], "Knowledge index cannot repeat an exact record reference");
  }
  const cursors = value.records.map(({ cursor }) => cursor);
  if (new Set(cursors).size !== cursors.length) {
    addFutureV11Issue(context, ["records"], "Knowledge index cursors cannot repeat");
  }
  if (value.nextAfterCursor !== null && value.records.length === 0) {
    addFutureV11Issue(context, ["nextAfterCursor"], "An empty Knowledge page cannot advertise continuation");
  }
  for (let index = 0; index < value.records.length; index += 1) {
    const row = value.records[index]!;
    const expectedCursor = digestFutureV11InspectionCursor({
      basisDigest: value.basis.digest,
      collection: "knowledge-records",
      key: {
        kind: row.reference.kind,
        id: row.reference.id,
        revision: row.reference.revision,
      },
    });
    if (row.cursor !== expectedCursor) {
      addFutureV11Issue(context, ["records", index, "cursor"], "Knowledge cursor does not bind its context basis and exact record key");
    }
    if (index > 0) {
      const prior = value.records[index - 1]!.reference;
      const order = FUTURE_V11_KNOWLEDGE_KIND_ORDER[prior.kind] -
        FUTURE_V11_KNOWLEDGE_KIND_ORDER[row.reference.kind] ||
        compareFutureV11CodePoints(prior.id, row.reference.id) ||
        prior.revision - row.reference.revision;
      if (order >= 0) {
        addFutureV11Issue(context, ["records", index], "Knowledge index rows must use canonical record order");
      }
    }
  }
  if (
    value.nextAfterCursor !== null &&
    value.nextAfterCursor !== value.records.at(-1)?.cursor
  ) {
    addFutureV11Issue(context, ["nextAfterCursor"], "Knowledge continuation must equal the final returned row cursor");
  }
});

const FutureV11BoundedPlainTextListSchema = z.array(FoundationPlainTextSchema).max(256)
  .superRefine((value, context) => {
    if (new Set(value).size !== value.length) {
      addFutureV11Issue(context, [], "Knowledge specification entries cannot repeat");
    }
  });
const FutureV11NonemptyPlainTextListSchema = z.array(FoundationPlainTextSchema).min(1).max(256)
  .superRefine((value, context) => {
    if (new Set(value).size !== value.length) {
      addFutureV11Issue(context, [], "Knowledge specification entries cannot repeat");
    }
  });

const FoundationFutureV11BehaviorSpecSchema = z.object({
  outcome: FoundationPlainTextSchema,
  actors: FutureV11NonemptyPlainTextListSchema,
  conditions: FutureV11BoundedPlainTextListSchema,
  included: FutureV11NonemptyPlainTextListSchema,
  excluded: FutureV11BoundedPlainTextListSchema,
  examples: FutureV11BoundedPlainTextListSchema,
  falsifiers: FutureV11NonemptyPlainTextListSchema,
}).strict();

const FoundationFutureV11AssuranceSpecSchema = z.object({
  obligation: FoundationPlainTextSchema,
  scope: FutureV11NonemptyPlainTextListSchema,
  failureModes: FutureV11NonemptyPlainTextListSchema,
  limits: FutureV11NonemptyPlainTextListSchema,
  degradation: FutureV11BoundedPlainTextListSchema,
  falsifiers: FutureV11NonemptyPlainTextListSchema,
}).strict();

const FoundationFutureV11BlueprintSpecSchema = z.object({
  decision: FoundationPlainTextSchema,
  scope: FutureV11NonemptyPlainTextListSchema,
  components: FutureV11NonemptyPlainTextListSchema,
  constraints: FutureV11NonemptyPlainTextListSchema,
  interfaces: FutureV11BoundedPlainTextListSchema,
  dataFlows: FutureV11BoundedPlainTextListSchema,
  tradeoffs: FutureV11NonemptyPlainTextListSchema,
  evolution: FutureV11BoundedPlainTextListSchema,
}).strict();

const FoundationFutureV11CoverageSelectorSchema = z.object({
  path: FoundationFutureV11RepositoryRelativePathSchema,
  mode: z.enum(["file", "tree"]),
  role: z.literal("primary"),
  exclude: z.array(FoundationFutureV11RepositoryRelativePathSchema).max(512),
}).strict().superRefine((value, context) => {
  if (value.mode === "file" && value.exclude.length !== 0) {
    addFutureV11Issue(context, ["exclude"], "File coverage cannot carry exclusions");
  }
  if (new Set(value.exclude).size !== value.exclude.length) {
    addFutureV11Issue(context, ["exclude"], "Coverage exclusions cannot repeat");
  }
  for (let index = 0; index < value.exclude.length; index += 1) {
    const excluded = value.exclude[index]!;
    if (excluded === value.path || !excluded.startsWith(`${value.path}/`)) {
      addFutureV11Issue(context, ["exclude", index], "Coverage exclusion must be an exact descendant of its selected tree");
    }
  }
});

const FoundationFutureV11DescriptionSpecSchema = z.object({
  responsibility: FoundationPlainTextSchema,
  coverage: z.array(FoundationFutureV11CoverageSelectorSchema).min(1).max(512),
  behavior: FutureV11NonemptyPlainTextListSchema,
  boundaries: FutureV11NonemptyPlainTextListSchema,
  invariants: FutureV11BoundedPlainTextListSchema,
  dependencies: FutureV11BoundedPlainTextListSchema,
  failure: FutureV11BoundedPlainTextListSchema,
  rationale: FutureV11NonemptyPlainTextListSchema,
}).strict().superRefine((value, context) => {
  const keys = value.coverage.map(({ path, mode }) => `${path}\u0000${mode}`);
  if (new Set(keys).size !== keys.length) {
    addFutureV11Issue(context, ["coverage"], "Description coverage selectors cannot repeat");
  }
});

const FoundationFutureV11CheckSpecSchema = z.object({
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
  limits: FutureV11NonemptyPlainTextListSchema,
  freshness: z.object({
    subjectBinding: z.literal("exact"),
    maximumAgeMs: FoundationNonnegativeSafeIntegerSchema.nullable(),
    environmentBinding: z.enum(["exact", "class", "declared", "none"]),
  }).strict(),
  falsifiers: FutureV11NonemptyPlainTextListSchema,
}).strict().superRefine((value, context) => {
  const subjects = value.subjects.map(({ kind, selector }) => `${kind}\u0000${selector}`);
  if (new Set(subjects).size !== subjects.length) {
    addFutureV11Issue(context, ["subjects"], "Check subjects cannot repeat");
  }
  if (new Set(value.evidenceKinds).size !== value.evidenceKinds.length) {
    addFutureV11Issue(context, ["evidenceKinds"], "Check evidence kinds cannot repeat");
  }
  if (new Set(value.requiredBindings).size !== value.requiredBindings.length) {
    addFutureV11Issue(context, ["requiredBindings"], "Check bindings cannot repeat");
  }
});

const FoundationFutureV11KnowledgeSpecSchema = z.union([
  FoundationFutureV11BehaviorSpecSchema,
  FoundationFutureV11AssuranceSpecSchema,
  FoundationFutureV11BlueprintSpecSchema,
  FoundationFutureV11DescriptionSpecSchema,
  FoundationFutureV11CheckSpecSchema,
]);

const FoundationFutureV11KnowledgeSupersessionSchema = z.object({
  id: FoundationFutureV11KnowledgeIdSchema,
  revision: FoundationPositiveSafeIntegerSchema,
  sourceDigest: FoundationSha256Schema,
  semanticDigest: FoundationSha256Schema,
}).strict();

const FoundationFutureV11KnowledgeRelationshipSchema = z.object({
  type: z.enum(["refines", "constrains", "realizes", "verified-by", "depends-on", "related-to"]),
  target: z.object({
    id: FoundationFutureV11KnowledgeIdSchema,
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
    addFutureV11Issue(context, ["required"], "A related-to relationship cannot be required");
  }
  const targetFacts = [value.target.revision, value.target.status, value.target.semanticDigest];
  if (targetFacts.some((entry) => entry === null) && targetFacts.some((entry) => entry !== null)) {
    addFutureV11Issue(context, ["target"], "Resolved relationship target facts are complete or all absent");
  }
  if (value.required && targetFacts.every((entry) => entry === null)) {
    addFutureV11Issue(context, ["target"], "A required relationship cannot have an unresolved target");
  }
});

const FoundationFutureV11KnowledgeConflictSchema = z.object({
  type: z.enum(["behavior-inclusion-exclusion", "assurance-limit", "blueprint-constraint"]),
  leftId: FoundationFutureV11KnowledgeIdSchema,
  leftRevision: FoundationPositiveSafeIntegerSchema,
  leftFact: FoundationPlainTextSchema,
  rightId: FoundationFutureV11KnowledgeIdSchema,
  rightRevision: FoundationPositiveSafeIntegerSchema,
  rightFact: FoundationPlainTextSchema,
  digest: FoundationSha256Schema,
}).strict();

const FoundationFutureV11KnowledgeSourceSchema = z.object({
  id: FoundationFutureV11KnowledgeOpaqueIdSchema,
  required: z.boolean(),
  reference: FoundationFutureV11KnowledgeSourceUriSchema,
  revision: FoundationFutureV11KnowledgeOpaqueIdSchema.nullable(),
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
    locator: FoundationFutureV11RepositoryRelativePathSchema.nullable(),
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
    addFutureV11Issue(context, ["resolution", "resolvedDigest"], "A resolved Knowledge source requires its observed digest");
  }
  if (value.resolution.kind === "repository" && resolved && value.resolution.objectId === null) {
    addFutureV11Issue(context, ["resolution", "objectId"], "A resolved repository source requires its Git object");
  }
  if (resolved && value.resolution.kind !== "external" && value.resolution.locator === null) {
    addFutureV11Issue(context, ["resolution", "locator"], "A resolved local Knowledge source requires its repository path");
  }
});

export const FoundationFutureV11KnowledgeRecordResultSchema = z.object({
  schema: z.literal("lifecycle.knowledge-record-inspection.v1"),
  basis: FoundationFutureV11ContextBasisSchema,
  reference: FoundationFutureV11KnowledgeReferenceSchema,
  title: FoundationPlainTextSchema,
  summary: FoundationPlainTextSchema,
  owners: z.array(FoundationFutureV11KnowledgeOwnerIdSchema).min(1).max(32),
  supersedes: FoundationFutureV11KnowledgeSupersessionSchema.nullable(),
  tags: z.array(z.string().min(1).max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)).max(64),
  spec: FoundationFutureV11KnowledgeSpecSchema,
  relationships: z.array(FoundationFutureV11KnowledgeRelationshipSchema).max(512),
  conflicts: z.array(FoundationFutureV11KnowledgeConflictSchema).max(512),
  sources: z.array(FoundationFutureV11KnowledgeSourceSchema).max(128),
  selectedByBoundary: z.boolean(),
  body: FoundationFutureV11SourceReferenceSchema,
}).strict().superRefine((value, context) => {
  if (value.body.generationDigest !== value.basis.generation.digest) {
    addFutureV11Issue(context, ["body", "generationDigest"], "Knowledge body uses another read generation");
  }
  if (value.body.basisDigest !== value.basis.digest) {
    addFutureV11Issue(context, ["body", "basisDigest"], "Knowledge body uses another context basis");
  }
  if (
    value.body.sourceKind !== "knowledge-body" ||
    value.body.subject.kind !== "knowledge-record" ||
    value.body.subject.id !== value.reference.id ||
    value.body.subject.revision !== value.reference.revision ||
    value.body.subject.digest !== value.reference.semanticDigest ||
    value.body.path !== value.reference.path
  ) {
    addFutureV11Issue(context, ["body"], "Knowledge body does not bind the inspected record");
  }
  if (new Set(value.owners).size !== value.owners.length) {
    addFutureV11Issue(context, ["owners"], "Knowledge owners cannot repeat");
  }
  if (new Set(value.tags).size !== value.tags.length) {
    addFutureV11Issue(context, ["tags"], "Knowledge tags cannot repeat");
  }
  if ((value.reference.revision === 1) !== (value.supersedes === null)) {
    addFutureV11Issue(context, ["supersedes"], "Knowledge supersession presence must match the revision");
  }
  if (value.supersedes !== null && (
    value.supersedes.id !== value.reference.id ||
    value.supersedes.revision !== value.reference.revision - 1
  )) {
    addFutureV11Issue(context, ["supersedes"], "Knowledge supersession must name the immediate predecessor revision of the same identity");
  }
  for (let index = 0; index < value.conflicts.length; index += 1) {
    const conflict = value.conflicts[index]!;
    if (conflict.leftId !== value.reference.id && conflict.rightId !== value.reference.id) {
      addFutureV11Issue(context, ["conflicts", index], "Displayed Knowledge conflict must involve the inspected record");
    }
  }
  if (new Set(value.sources.map(({ id }) => id)).size !== value.sources.length) {
    addFutureV11Issue(context, ["sources"], "Knowledge sources cannot repeat one identity");
  }
  const specifications = {
    behavior: FoundationFutureV11BehaviorSpecSchema,
    assurance: FoundationFutureV11AssuranceSpecSchema,
    blueprint: FoundationFutureV11BlueprintSpecSchema,
    description: FoundationFutureV11DescriptionSpecSchema,
    check: FoundationFutureV11CheckSpecSchema,
  } as const;
  if (!specifications[value.reference.kind].safeParse(value.spec).success) {
    addFutureV11Issue(context, ["spec"], "Knowledge public specification does not match the record kind");
  }
});

export type FoundationFutureV11KnowledgeReference = z.output<typeof FoundationFutureV11KnowledgeReferenceSchema>;
export type FoundationFutureV11KnowledgeIndexResult = z.output<typeof FoundationFutureV11KnowledgeIndexResultSchema>;
export type FoundationFutureV11KnowledgeRecordResult = z.output<typeof FoundationFutureV11KnowledgeRecordResultSchema>;
