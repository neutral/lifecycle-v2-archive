import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { z } from "zod/v4";
import {
  FoundationDeliveryGenerationSchema,
  FoundationGitObjectSchema,
  FoundationOpaqueIdSchema,
  FoundationSemanticMarkdownSchema,
  FoundationSha256Schema,
  digestFoundationCanonical,
  type FoundationSha256,
} from "./core.js";
import {
  FoundationPlainTextSchema,
  FoundationPositiveSafeIntegerSchema,
} from "./internal.js";

/** Private, unbarreled Foundation v11 authorization-review preparation. */

const FoundationFutureV11AuthorizationReviewOperationSchema = z.enum([
  "delivery.admit",
  "delivery.accept",
  "delivery.no-ship",
]);

const FoundationFutureV11NormalizedSemanticMarkdownSchema = FoundationSemanticMarkdownSchema
  .refine((value) => value.trim().length > 0, {
    message: "Authorization review semantics cannot be whitespace-only",
  })
  .refine((value) => value === `${value.replace(/\n+$/u, "")}\n`, {
    message: "Authorization review semantics must use one canonical trailing LF",
  });

const FoundationFutureV11AuthorizationReviewInputSchema = z.union([
  z.null(),
  z.object({ semanticMarkdown: FoundationSemanticMarkdownSchema }).strict(),
]);

export const FoundationFutureV11AuthorizationReviewSelectorSchema = z.object({
  kind: z.literal("authorization-review"),
  expectedGeneration: FoundationSha256Schema,
  operation: FoundationFutureV11AuthorizationReviewOperationSchema,
  input: FoundationFutureV11AuthorizationReviewInputSchema,
}).strict().superRefine((value, context) => {
  if (value.operation === "delivery.no-ship" && value.input === null) {
    context.addIssue({
      code: "custom",
      path: ["input"],
      message: "No-ship authorization review requires exact semantic Markdown",
      input: undefined,
    });
  }
  if (value.operation !== "delivery.no-ship" && value.input !== null) {
    context.addIssue({
      code: "custom",
      path: ["input"],
      message: "Only no-ship authorization review accepts semantic input",
      input: undefined,
    });
  }
});

const FoundationFutureV11FounderDecisionRepositoryBasisSchema = z.object({
  repositorySnapshotDigest: FoundationSha256Schema,
  canonicalCommit: FoundationGitObjectSchema,
  canonicalTree: FoundationGitObjectSchema,
  productStateDigest: FoundationSha256Schema,
  atlasStateDigest: FoundationSha256Schema,
  atlasResolutionDigest: FoundationSha256Schema,
  atlasNormalizedModelDigest: FoundationSha256Schema,
  atlasResourceBindingsDigest: FoundationSha256Schema,
  repositoryContractDigest: FoundationSha256Schema,
  knowledgeSetDigest: FoundationSha256Schema,
  checkBindingSetDigest: FoundationSha256Schema,
}).strict();

const FoundationFutureV11FounderDecisionControlTargetBaseSchema = z.object({
  id: FoundationOpaqueIdSchema,
  revision: FoundationPositiveSafeIntegerSchema,
  digest: FoundationSha256Schema,
});

const FoundationFutureV11FounderDecisionControlBindingSchema = z.discriminatedUnion("relation", [
  z.object({
    relation: z.literal("selects-boundary"),
    target: FoundationFutureV11FounderDecisionControlTargetBaseSchema.extend({
      kind: z.literal("work-boundary"),
    }).strict(),
  }).strict(),
  z.object({
    relation: z.literal("selects-baseline-receipt"),
    target: FoundationFutureV11FounderDecisionControlTargetBaseSchema.extend({
      kind: z.literal("check-receipt"),
    }).strict(),
  }).strict(),
  z.object({
    relation: z.literal("continues-from-boundary"),
    target: FoundationFutureV11FounderDecisionControlTargetBaseSchema.extend({
      kind: z.literal("work-boundary"),
    }).strict(),
  }).strict(),
  z.object({
    relation: z.literal("resolves"),
    target: FoundationFutureV11FounderDecisionControlTargetBaseSchema.extend({
      kind: z.literal("material-condition"),
    }).strict(),
  }).strict(),
  z.object({
    relation: z.literal("selects-candidate"),
    target: FoundationFutureV11FounderDecisionControlTargetBaseSchema.extend({
      kind: z.literal("candidate-revision"),
    }).strict(),
  }).strict(),
  z.object({
    relation: z.literal("selects-seal"),
    target: FoundationFutureV11FounderDecisionControlTargetBaseSchema.extend({
      kind: z.literal("candidate-seal"),
    }).strict(),
  }).strict(),
  z.object({
    relation: z.literal("selects-evidence"),
    target: FoundationFutureV11FounderDecisionControlTargetBaseSchema.extend({
      kind: z.literal("evidence-packet"),
    }).strict(),
  }).strict(),
]);

type FutureV11FounderDecisionControlBinding = z.output<
  typeof FoundationFutureV11FounderDecisionControlBindingSchema
>;

function bindingKey(value: FutureV11FounderDecisionControlBinding): string {
  return [
    value.relation,
    value.target.kind,
    value.target.id,
    String(value.target.revision),
    value.target.digest,
  ].join("\u0000");
}

function countRelation(
  values: readonly FutureV11FounderDecisionControlBinding[],
  relation: FutureV11FounderDecisionControlBinding["relation"],
): number {
  return values.filter((value) => value.relation === relation).length;
}

const FOUNDER_DECISION_CONSEQUENCES = Object.freeze({
  admit: "Establish the selected Work Boundary as the active mandate for this Delivery.",
  readmit:
    "Replace the active Work Boundary with the selected successor and continue the exact retained Candidate.",
  accept:
    "Apply the selected sealed and evidenced Candidate to canonical Product State and close the Delivery.",
  "no-ship": "Close the Delivery without changing canonical Product State.",
} as const);

function digestUtf8(value: string): FoundationSha256 {
  return `sha256:${bytesToHex(sha256(utf8ToBytes(value)))}`;
}

function addIssue(
  context: z.core.$RefinementCtx,
  path: readonly (string | number)[],
  message: string,
): void {
  context.addIssue({ code: "custom", path: [...path], message, input: undefined });
}

export const FoundationFutureV11FounderAuthorizationReviewCoreSchema = z.object({
  schema: z.literal("lifecycle.founder-authorization-review.v1"),
  targetId: FoundationOpaqueIdSchema,
  storeId: FoundationOpaqueIdSchema,
  processId: FoundationOpaqueIdSchema,
  operation: FoundationFutureV11AuthorizationReviewOperationSchema,
  decision: z.enum(["admit", "readmit", "accept", "no-ship"]),
  consequence: FoundationPlainTextSchema,
  semanticMarkdown: FoundationFutureV11NormalizedSemanticMarkdownSchema,
  semanticDigest: FoundationSha256Schema,
  journalHead: z.object({
    sequence: FoundationPositiveSafeIntegerSchema,
    digest: FoundationSha256Schema,
  }).strict(),
  reducerFactsDigest: FoundationSha256Schema,
  repository: FoundationFutureV11FounderDecisionRepositoryBasisSchema,
  selectedControl: z.array(FoundationFutureV11FounderDecisionControlBindingSchema).max(4_096),
  coordinates: z.object({
    qualification: z.literal("lifecycle.foundation.1.0.0-rc.11"),
    repository: z.literal("lifecycle.repository.v16"),
    provider: z.literal("lifecycle.provider-adapter.v6"),
    authoritySubject: z.literal("lifecycle.founder-decision-subject.v3"),
    transactionRules: z.literal("lifecycle.delivery-transaction-rules.v1"),
  }).strict(),
  authority: z.object({
    principalId: FoundationOpaqueIdSchema,
    keyId: FoundationOpaqueIdSchema,
    algorithm: z.literal("ed25519"),
  }).strict(),
  candidateDisposition: z.enum(["not-applicable", "no-candidate", "abandon"]),
  authorizationReviewDigest: FoundationSha256Schema,
}).strict().superRefine((value, context) => {
  const relationCounts = Object.freeze({
    boundary: countRelation(value.selectedControl, "selects-boundary"),
    baseline: countRelation(value.selectedControl, "selects-baseline-receipt"),
    predecessor: countRelation(value.selectedControl, "continues-from-boundary"),
    condition: countRelation(value.selectedControl, "resolves"),
    candidate: countRelation(value.selectedControl, "selects-candidate"),
    seal: countRelation(value.selectedControl, "selects-seal"),
    evidence: countRelation(value.selectedControl, "selects-evidence"),
  });

  for (let index = 1; index < value.selectedControl.length; index += 1) {
    if (bindingKey(value.selectedControl[index - 1]!) >= bindingKey(value.selectedControl[index]!)) {
      addIssue(context, ["selectedControl", index], "Selected Control bindings must be unique and canonically ordered");
      break;
    }
  }
  if (relationCounts.boundary > 1) {
    addIssue(context, ["selectedControl"], "Authorization review selects at most one Work Boundary");
  }

  const decisionMatchesOperation =
    (value.operation === "delivery.admit" && (value.decision === "admit" || value.decision === "readmit")) ||
    (value.operation === "delivery.accept" && value.decision === "accept") ||
    (value.operation === "delivery.no-ship" && value.decision === "no-ship");
  if (!decisionMatchesOperation) {
    addIssue(context, ["decision"], "Authorization operation and Founder Decision variant disagree");
  }
  if (value.consequence !== FOUNDER_DECISION_CONSEQUENCES[value.decision]) {
    addIssue(context, ["consequence"], "Authorization consequence does not match the Founder Decision variant");
  }
  if (value.semanticDigest !== digestUtf8(value.semanticMarkdown)) {
    addIssue(context, ["semanticDigest"], "Semantic digest does not reproduce the exact Markdown bytes");
  }

  if (value.decision === "admit") {
    if (
      relationCounts.boundary !== 1 || relationCounts.baseline < 1 ||
      relationCounts.predecessor !== 0 || relationCounts.condition !== 0 ||
      relationCounts.candidate !== 0 || relationCounts.seal !== 0 || relationCounts.evidence !== 0
    ) {
      addIssue(context, ["selectedControl"], "Initial admission requires its Boundary and complete baseline Receipt set only");
    }
  } else if (value.decision === "readmit") {
    if (
      relationCounts.boundary !== 1 || relationCounts.baseline < 1 ||
      relationCounts.predecessor !== 1 || relationCounts.condition !== 1 ||
      relationCounts.candidate !== 1 || relationCounts.seal !== 0 || relationCounts.evidence !== 0
    ) {
      addIssue(context, ["selectedControl"], "Readmission requires successor, predecessor, condition, Candidate, and baseline Receipts");
    }
  } else if (value.decision === "accept") {
    if (
      relationCounts.boundary !== 1 || relationCounts.baseline !== 0 ||
      relationCounts.predecessor !== 0 || relationCounts.condition !== 0 ||
      relationCounts.candidate !== 1 || relationCounts.seal !== 1 || relationCounts.evidence !== 1
    ) {
      addIssue(context, ["selectedControl"], "Acceptance requires exactly one Boundary, Candidate, Seal, and Evidence selection");
    }
  } else {
    if (
      relationCounts.baseline !== 0 || relationCounts.predecessor !== 0 ||
      relationCounts.condition > 1 || relationCounts.candidate > 1 ||
      relationCounts.seal !== 0 || relationCounts.evidence !== 0
    ) {
      addIssue(context, ["selectedControl"], "No-ship selects only its optional Boundary, Material Condition, and Candidate");
    }
    if (relationCounts.boundary === 0 && value.selectedControl.length !== 0) {
      addIssue(context, ["selectedControl"], "Only early no-ship may omit a Work Boundary, and it has no later Control subjects");
    }
  }

  const expectedDisposition = value.decision !== "no-ship"
    ? "not-applicable"
    : relationCounts.candidate === 0 ? "no-candidate" : "abandon";
  if (value.candidateDisposition !== expectedDisposition) {
    addIssue(context, ["candidateDisposition"], "Candidate disposition does not match the exact Founder Decision selection");
  }

  const { authorizationReviewDigest, ...reviewBody } = value;
  if (authorizationReviewDigest !== digestFoundationCanonical(reviewBody)) {
    addIssue(context, ["authorizationReviewDigest"], "Authorization review digest does not reproduce the exact review body");
  }
});

export const FoundationFutureV11AuthorizationReviewResultSchema = z.object({
  schema: z.literal("lifecycle.founder-authorization-review-inspection.v1"),
  generation: FoundationDeliveryGenerationSchema,
  review: FoundationFutureV11FounderAuthorizationReviewCoreSchema,
}).strict().superRefine((value, context) => {
  if (value.generation.storeId !== value.review.storeId) {
    addIssue(context, ["generation", "storeId"], "Authorization review and Delivery generation use different Stores");
  }
  if (value.generation.processId !== value.review.processId) {
    addIssue(context, ["generation", "processId"], "Authorization review and Delivery generation use different Processes");
  }
  if (
    value.generation.journal.eventCount !== value.review.journalHead.sequence ||
    value.generation.journal.headSequence !== value.review.journalHead.sequence ||
    value.generation.journal.headDigest !== value.review.journalHead.digest
  ) {
    addIssue(context, ["generation", "journal"], "Authorization review and Delivery generation use different Journal heads");
  }
});

export type FoundationFutureV11FounderAuthorizationReviewCore = z.output<
  typeof FoundationFutureV11FounderAuthorizationReviewCoreSchema
>;
export type FoundationFutureV11AuthorizationReviewSelector = z.output<
  typeof FoundationFutureV11AuthorizationReviewSelectorSchema
>;
export type FoundationFutureV11AuthorizationReviewResult = z.output<
  typeof FoundationFutureV11AuthorizationReviewResultSchema
>;
