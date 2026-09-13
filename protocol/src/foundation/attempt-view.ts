import { z } from "zod/v4";
import {
  FOUNDATION_ATTEMPT_VIEW_PROFILE_ID,
  FOUNDATION_ATTEMPT_VIEW_SCHEMA,
  FOUNDATION_DELIVERY_OPERATIONS,
  FOUNDATION_DELIVERY_REDUCER_ID,
  FoundationDeliveryOperationSchema,
  FoundationDeliveryRecoveryStepSchema,
  FoundationGitObjectSchema,
  FoundationJsonValueSchema,
  FoundationOpaqueIdSchema,
  FoundationPublicFactsSchema,
  FoundationSha256Schema,
  type FoundationControlRecordKind,
} from "./core.js";
import {
  FoundationPlainTextSchema,
  FoundationPositiveSafeIntegerSchema,
} from "./internal.js";
import { refineRecoveryPair } from "./recovery.js";

function attemptViewReference<Kind extends FoundationControlRecordKind>(kind: Kind) {
  return z.object({
    kind: z.literal(kind),
    id: FoundationOpaqueIdSchema,
    revision: FoundationPositiveSafeIntegerSchema,
    digest: FoundationSha256Schema,
  }).strict();
}

const FoundationAttemptViewAgentAttemptReferenceSchema = attemptViewReference("agent-attempt");
const FoundationAttemptViewBriefReferenceSchema = attemptViewReference("director-brief");
const FoundationAttemptViewWorkProductReferenceSchema = attemptViewReference("agent-work-product");
const FoundationAttemptViewReceiptReferenceSchema = attemptViewReference("execution-receipt");
const FoundationAttemptViewCandidateReferenceSchema = attemptViewReference("candidate-revision");
const FoundationAttemptViewBoundaryReferenceSchema = attemptViewReference("work-boundary");
const FoundationAttemptViewConditionReferenceSchema = attemptViewReference("material-condition");
const FoundationAttemptViewSealReferenceSchema = attemptViewReference("candidate-seal");
const FoundationAttemptViewCheckReceiptReferenceSchema = attemptViewReference("check-receipt");
const FoundationAttemptViewEvidenceReferenceSchema = attemptViewReference("evidence-packet");
const FoundationAttemptViewOperationSchema = z.enum([
  "delivery.prepare",
  "delivery.continue",
  "delivery.evaluate",
  "delivery.revise",
  "delivery.reaffirm",
]);

const FoundationAttemptViewCandidateBindingSchema = z.object({
  revision: FoundationAttemptViewCandidateReferenceSchema,
  carrierManifestDigest: FoundationSha256Schema,
}).strict();

const FoundationAttemptViewBackendProfileSchema = z.object({
  profileId: z.enum([
    "lifecycle.execution-backend-profile.docker-local.v1",
    "lifecycle.execution-backend-profile.fault-injection.v1",
  ]),
  profileDigest: FoundationSha256Schema,
  implementationDigest: FoundationSha256Schema,
}).strict();

const FoundationAttemptViewExecutionImageSchema = z.object({
  imageId: FoundationOpaqueIdSchema,
  imageDigest: FoundationSha256Schema,
}).strict();

const FoundationAttemptViewExecutionInputSetSchema = z.object({
  profileId: z.literal("lifecycle.execution-input-set.v2"),
  digest: FoundationSha256Schema,
}).strict();

const FoundationAttemptViewExecutionNetworkSchema = z.object({
  agentProductNetwork: z.enum(["none", "loopback", "bounded-egress"]),
  separationRequired: z.literal(true),
}).strict();

const FoundationAttemptViewExecutionServicesSchema = z.object({
  providerControlPlane: z.enum(["none", "fixed-service-channel"]),
}).strict();

const FoundationAttemptViewExecutionLimitsSchema = z.object({
  wallTimeMilliseconds: FoundationPositiveSafeIntegerSchema,
  processes: FoundationPositiveSafeIntegerSchema,
  storageBytes: FoundationPositiveSafeIntegerSchema,
  outputEntries: FoundationPositiveSafeIntegerSchema,
  outputBytes: FoundationPositiveSafeIntegerSchema,
  outputEntryBytes: FoundationPositiveSafeIntegerSchema,
  events: FoundationPositiveSafeIntegerSchema,
}).strict();

const FoundationAttemptViewExecutionSelectionSchema = z.object({
  backendProfile: FoundationAttemptViewBackendProfileSchema,
  image: FoundationAttemptViewExecutionImageSchema,
  inputSet: FoundationAttemptViewExecutionInputSetSchema,
  network: FoundationAttemptViewExecutionNetworkSchema,
  services: FoundationAttemptViewExecutionServicesSchema,
  effectiveLimits: FoundationAttemptViewExecutionLimitsSchema,
}).strict();

const FoundationAttemptViewOutputManifestSchema = z.object({
  availability: z.enum(["retrieved", "not-produced", "unavailable"]),
  digest: FoundationSha256Schema.nullable(),
}).strict().superRefine((value, context) => {
  if ((value.availability === "retrieved") !== (value.digest !== null)) {
    context.addIssue({
      code: "custom",
      path: ["digest"],
      message: "Only retrieved execution output has an Output Manifest digest",
    });
  }
});

const FoundationAttemptViewAgentExecutionFactsSchema =
  FoundationAttemptViewExecutionSelectionSchema.extend({
    specificationDigest: FoundationSha256Schema,
    runnerDigest: FoundationSha256Schema,
    observationDigest: FoundationSha256Schema,
    outputManifest: FoundationAttemptViewOutputManifestSchema,
  }).strict();

const FoundationAttemptViewCheckExecutionFactsSchema = z.object({
  backendProfile: FoundationAttemptViewBackendProfileSchema,
  image: FoundationAttemptViewExecutionImageSchema,
  specificationDigest: FoundationSha256Schema,
  inputSet: FoundationAttemptViewExecutionInputSetSchema,
  runnerDigest: FoundationSha256Schema,
  observationDigest: FoundationSha256Schema,
  outputManifest: FoundationAttemptViewOutputManifestSchema,
}).strict();

const FoundationAttemptViewContainmentSchema = z.object({
  classification: z.enum(["contained", "not-required"]),
  factsDigest: FoundationSha256Schema.nullable(),
}).strict().superRefine((value, context) => {
  if ((value.classification === "contained") !== (value.factsDigest !== null)) {
    context.addIssue({
      code: "custom",
      path: ["factsDigest"],
      message: "Containment facts exist exactly when execution was contained",
    });
  }
});

const FoundationAttemptViewRetirementSchema = z.object({
  classification: z.enum(["retired", "not-required"]),
  factsDigest: FoundationSha256Schema.nullable(),
}).strict().superRefine((value, context) => {
  if ((value.classification === "retired") !== (value.factsDigest !== null)) {
    context.addIssue({
      code: "custom",
      path: ["factsDigest"],
      message: "Retirement facts exist exactly when execution was retired",
    });
  }
});

const FoundationAttemptViewDiagnosticSchema = z.object({
  code: z.enum([
    "lifecycle.attempt-view.binding",
    "lifecycle.attempt-view.stale",
    "lifecycle.attempt-view.obligation-missing",
    "lifecycle.attempt-view.provenance",
    "lifecycle.attempt-view.evidence-subject",
    "lifecycle.attempt-view.eligibility",
    "lifecycle.attempt-view.progress",
    "lifecycle.attempt-view.authority",
    "lifecycle.attempt-view.disclosure",
    "lifecycle.attempt-view.incomplete",
  ]),
  stage: FoundationOpaqueIdSchema,
  factsDigest: FoundationSha256Schema,
}).strict();

const FoundationAttemptViewCheckReceiptSchema = z.object({
  reference: FoundationAttemptViewCheckReceiptReferenceSchema,
  provenance: z.literal("runtime-observed"),
  binding: FoundationPublicFactsSchema,
  proofSubject: z.union([
    FoundationAttemptViewBoundaryReferenceSchema,
    FoundationAttemptViewSealReferenceSchema,
  ]),
  proofRequestDigest: FoundationSha256Schema,
  environment: FoundationPublicFactsSchema,
  disposition: z.enum(["pass", "fail", "indeterminate", "not-run", "unsupported", "operational-error"]),
  resultFacts: z.array(FoundationJsonValueSchema).max(256),
  reasonCode: FoundationOpaqueIdSchema.nullable(),
  execution: FoundationAttemptViewCheckExecutionFactsSchema.nullable(),
  subjectIntegrity: z.enum(["unchanged", "changed", "unverified"]),
  containment: FoundationAttemptViewContainmentSchema,
  retirement: FoundationAttemptViewRetirementSchema,
  limitations: z.array(FoundationJsonValueSchema).max(128),
}).strict().superRefine((value, context) => {
  const executionRequired = value.disposition === "pass" ||
    value.disposition === "fail" ||
    value.disposition === "indeterminate" ||
    value.disposition === "operational-error";
  if (executionRequired && value.execution === null) {
    context.addIssue({
      code: "custom",
      path: ["execution"],
      message: "This Check disposition requires execution facts",
    });
  }
  if (value.disposition === "not-run" && value.execution !== null) {
    context.addIssue({
      code: "custom",
      path: ["execution"],
      message: "A not-run Check cannot carry execution facts",
    });
  }
  const executionPresent = value.execution !== null;
  const expectedContainment = executionPresent ? "contained" : "not-required";
  if (value.containment.classification !== expectedContainment) {
    context.addIssue({
      code: "custom",
      path: ["containment", "classification"],
      message: "Check Containment must match whether execution occurred",
    });
  }
  const expectedRetirement = executionPresent ? "retired" : "not-required";
  if (value.retirement.classification !== expectedRetirement) {
    context.addIssue({
      code: "custom",
      path: ["retirement", "classification"],
      message: "Check Retirement must match whether execution occurred",
    });
  }
});

const FoundationAttemptViewCheckSchema = z.object({
  selectionId: FoundationOpaqueIdSchema,
  definitionId: FoundationOpaqueIdSchema,
  definition: FoundationPublicFactsSchema,
  bindingIds: z.array(FoundationOpaqueIdSchema).min(1).max(4_096),
  modality: z.enum(["precondition", "repair-target", "regression-guard", "postcondition", "diagnostic"]),
  obligationIds: z.array(FoundationOpaqueIdSchema).max(4_096),
  baselineRequired: z.boolean(),
  finalRequired: z.boolean(),
  baseline: FoundationAttemptViewCheckReceiptSchema.nullable(),
  final: FoundationAttemptViewCheckReceiptSchema.nullable(),
  freshExecutionRequired: z.boolean(),
}).strict();

const FoundationAttemptViewObligationStandingSchema = z.enum([
  "not-evaluated",
  "artifact-absent",
  "artifact-present-uninspected",
  "check-not-run",
  "check-passed",
  "check-failed",
  "check-incomplete",
  "review-pending",
  "review-accepted",
  "review-rejected",
  "conflict",
  "material-condition",
  "satisfied-for-current-phase",
  "inapplicable-by-boundary",
]);

const FoundationAttemptViewObligationSchema = z.object({
  id: FoundationOpaqueIdSchema,
  kind: FoundationOpaqueIdSchema,
  statement: FoundationPlainTextSchema,
  severity: z.enum(["required", "diagnostic"]),
  sourceIds: z.array(FoundationOpaqueIdSchema).max(4_096),
  artifactIds: z.array(FoundationOpaqueIdSchema).max(4_096),
  propositionIds: z.array(FoundationOpaqueIdSchema).max(4_096),
  checkSelectionIds: z.array(FoundationOpaqueIdSchema).max(4_096),
  relatedAgentClaimIds: z.array(FoundationOpaqueIdSchema).max(4_096),
  standing: FoundationAttemptViewObligationStandingSchema,
  blocking: z.boolean(),
  establishmentRoute: z.enum([
    "develop-or-evaluate",
    "inspect-artifact",
    "run-or-correct-check",
    "complete-independent-review",
    "correct-reviewed-result",
    "resolve-boundary",
    "none",
  ]),
}).strict();

export const FoundationSubmissionDiagnosticSchema = z.object({
  code: FoundationOpaqueIdSchema,
  stage: z.enum(["syntax", "template", "semantic", "compiler"]),
  factsDigest: FoundationSha256Schema,
}).strict();

const FoundationAttemptViewSubmissionDiagnosticsSchema = z.object({
  parserDisposition: z.enum(["valid", "invalid", "not-run"]).nullable(),
  compilerDisposition: z.enum(["retained", "invalid-result", "runtime-failure", "not-run"]).nullable(),
  failureFactsDigest: FoundationSha256Schema.nullable(),
  diagnostic: FoundationSubmissionDiagnosticSchema.nullable(),
}).strict().superRefine((value, context) => {
  const diagnostic = value.diagnostic;
  if (value.parserDisposition === null || value.compilerDisposition === null) {
    if (
      value.parserDisposition !== null || value.compilerDisposition !== null ||
      value.failureFactsDigest !== null || diagnostic !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["diagnostic"],
        message: "Absent Receipt dispositions cannot carry submission failure facts",
      });
    }
    return;
  }
  if (value.parserDisposition === "not-run" && value.compilerDisposition === "not-run") {
    if (diagnostic !== null) {
      context.addIssue({
        code: "custom",
        path: ["diagnostic"],
        message: "A parser that did not run cannot carry a semantic submission diagnostic",
      });
    }
    return;
  }
  if (value.parserDisposition === "invalid" && value.compilerDisposition === "not-run") {
    if (
      diagnostic === null || diagnostic.factsDigest !== value.failureFactsDigest ||
      !diagnostic.code.startsWith("lifecycle.agent-work-product.invalid.") ||
      diagnostic.stage === "compiler"
    ) {
      context.addIssue({
        code: "custom",
        path: ["diagnostic"],
        message: "Invalid parser disposition requires its exact bounded diagnostic",
      });
    }
    return;
  }
  if (value.parserDisposition === "valid" && value.compilerDisposition === "retained") {
    if (value.failureFactsDigest !== null || diagnostic !== null) {
      context.addIssue({
        code: "custom",
        path: ["diagnostic"],
        message: "Retained compilation cannot carry submission failure facts",
      });
    }
    return;
  }
  if (value.parserDisposition === "valid" && value.compilerDisposition === "invalid-result") {
    if (
      diagnostic === null || diagnostic.factsDigest !== value.failureFactsDigest ||
      !diagnostic.code.startsWith("lifecycle.agent-work-product.invalid.") ||
      !(diagnostic.stage === "semantic" || diagnostic.stage === "compiler")
    ) {
      context.addIssue({
        code: "custom",
        path: ["diagnostic"],
        message: "Invalid compiler result requires its exact bounded diagnostic",
      });
    }
    return;
  }
  if (value.parserDisposition === "valid" && value.compilerDisposition === "runtime-failure") {
    if (
      diagnostic === null || diagnostic.factsDigest !== value.failureFactsDigest ||
      !diagnostic.code.startsWith("lifecycle.agent-work-product.runtime.") ||
      diagnostic.stage !== "compiler"
    ) {
      context.addIssue({
        code: "custom",
        path: ["diagnostic"],
        message: "Runtime compiler failure requires its exact bounded diagnostic",
      });
    }
    return;
  }
  context.addIssue({
    code: "custom",
    path: ["parserDisposition"],
    message: "Parser and compiler dispositions are inconsistent",
  });
});

export const FoundationAttemptViewSchema = z.object({
  schema: z.literal(FOUNDATION_ATTEMPT_VIEW_SCHEMA),
  complete: z.boolean(),
  coordinate: z.object({
    storeId: FoundationOpaqueIdSchema,
    processId: FoundationOpaqueIdSchema,
    journal: z.object({
      headSequence: FoundationPositiveSafeIntegerSchema.max(100_000),
      headDigest: FoundationSha256Schema,
    }).strict(),
    attempt: FoundationAttemptViewAgentAttemptReferenceSchema,
    reducer: z.object({
      id: z.literal(FOUNDATION_DELIVERY_REDUCER_ID),
      digest: FoundationSha256Schema,
    }).strict(),
    profile: z.object({
      id: z.literal(FOUNDATION_ATTEMPT_VIEW_PROFILE_ID),
      digest: FoundationSha256Schema,
    }).strict(),
    currentBoundary: FoundationAttemptViewBoundaryReferenceSchema.nullable(),
    currentCandidate: FoundationAttemptViewCandidateReferenceSchema.nullable(),
    activeActivity: z.object({
      id: FoundationOpaqueIdSchema,
      operation: FoundationDeliveryOperationSchema,
      stage: z.enum(["started", "prepared", "effect-intended", "effect-observed", "submitted", "finalizing", "completed"]),
      recovery: z.object({
        kind: z.enum(["provider", "candidate-observation", "transaction", "finalization"]),
        resumesAt: FoundationDeliveryRecoveryStepSchema,
        exactEffectDigest: FoundationSha256Schema.nullable(),
      }).strict().superRefine(refineRecoveryPair).nullable(),
    }).strict().nullable(),
  }).strict(),
  attemptContract: z.object({
    provenance: z.literal("runtime-derived"),
    activityId: FoundationOpaqueIdSchema,
    operation: FoundationAttemptViewOperationSchema,
    role: z.enum(["reconnaissance", "builder", "reviewer"]),
    invocationId: FoundationOpaqueIdSchema,
    preDispatchStateDigest: FoundationSha256Schema,
    brief: FoundationAttemptViewBriefReferenceSchema,
    boundary: FoundationAttemptViewBoundaryReferenceSchema.nullable(),
    candidate: FoundationAttemptViewCandidateBindingSchema.nullable(),
    seal: FoundationAttemptViewSealReferenceSchema.nullable(),
    projection: FoundationPublicFactsSchema,
    capability: FoundationPublicFactsSchema,
    investment: FoundationPublicFactsSchema,
    provider: FoundationPublicFactsSchema,
    authoring: FoundationPublicFactsSchema,
    input: FoundationPublicFactsSchema,
    execution: FoundationAttemptViewExecutionSelectionSchema,
  }).strict(),
  providerExecution: z.object({
    provenance: z.literal("runtime-observed"),
    receipt: FoundationAttemptViewReceiptReferenceSchema.nullable(),
    effect: z.object({
      intended: z.boolean(),
      observed: z.boolean(),
      digest: FoundationSha256Schema.nullable(),
      outcome: z.enum(["completed", "failed", "not-started"]).nullable(),
    }).strict(),
    productiveExecutionStarted: z.boolean().nullable(),
    provider: FoundationPublicFactsSchema.nullable(),
    execution: FoundationAttemptViewAgentExecutionFactsSchema.nullable(),
    containment: FoundationAttemptViewContainmentSchema.nullable(),
    retirement: FoundationAttemptViewRetirementSchema.nullable(),
  }).strict().superRefine((value, context) => {
    const finalized = value.receipt !== null;
    if (value.effect.observed && !value.effect.intended) {
      context.addIssue({
        code: "custom",
        path: ["effect", "observed"],
        message: "A provider effect cannot be observed before its exact intent",
      });
    }
    if (value.effect.intended !== (value.effect.digest !== null)) {
      context.addIssue({
        code: "custom",
        path: ["effect", "digest"],
        message: "Provider effect intent requires exactly one effect digest",
      });
    }
    if (value.effect.observed !== (value.effect.outcome !== null)) {
      context.addIssue({
        code: "custom",
        path: ["effect", "outcome"],
        message: "Provider effect outcome exists exactly when the effect was observed",
      });
    }
    if ((finalized || value.execution !== null) &&
        (!value.effect.intended || !value.effect.observed ||
          value.effect.digest === null || value.effect.outcome === null)) {
      context.addIssue({
        code: "custom",
        path: ["effect"],
        message: "Retained execution facts require one exact intended and observed provider effect",
      });
    }
    for (const [field, present] of [
      ["productiveExecutionStarted", value.productiveExecutionStarted !== null],
      ["provider", value.provider !== null],
      ["execution", value.execution !== null],
      ["containment", value.containment !== null],
      ["retirement", value.retirement !== null],
    ] as const) {
      if (finalized && !present) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "A retained Execution Receipt requires complete public execution facts",
        });
      }
      if (!finalized && present) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "Receipt-derived execution facts require their exact retained Execution Receipt",
        });
      }
    }
    if (value.containment !== null && value.containment.classification !== "contained") {
      context.addIssue({
        code: "custom",
        path: ["containment", "classification"],
        message: "A retained Execution Receipt requires Containment",
      });
    }
    if (value.retirement !== null && value.retirement.classification !== "retired") {
      context.addIssue({
        code: "custom",
        path: ["retirement", "classification"],
        message: "A retained Execution Receipt requires Retirement",
      });
    }
  }),
  agentSemantics: z.object({
    workProduct: FoundationAttemptViewWorkProductReferenceSchema.nullable(),
    provenance: z.literal("agent-proposed"),
    disposition: FoundationOpaqueIdSchema.nullable(),
    summary: FoundationPublicFactsSchema.nullable(),
    uncertainty: FoundationPublicFactsSchema.nullable(),
    claims: z.array(FoundationJsonValueSchema).max(16_384),
    citations: z.array(FoundationJsonValueSchema).max(16_384),
    limitations: z.array(FoundationJsonValueSchema).max(16_384),
    noProductReason: FoundationPlainTextSchema.nullable(),
    roleSemantics: FoundationPublicFactsSchema.nullable(),
    body: FoundationPublicFactsSchema.nullable(),
    submissionDiagnostics: FoundationAttemptViewSubmissionDiagnosticsSchema,
  }).strict(),
  candidateTransition: z.object({
    role: z.enum(["reconnaissance", "builder", "reviewer"]),
    observationProvenance: z.literal("runtime-observed"),
    currentProvenance: z.literal("runtime-derived"),
    input: FoundationAttemptViewCandidateBindingSchema.nullable(),
    successorDisposition: z.enum(["promoted", "not-produced", "unavailable", "invalid"]).nullable(),
    successor: FoundationAttemptViewCandidateBindingSchema.nullable(),
    current: FoundationAttemptViewCandidateBindingSchema.nullable(),
    candidateBaseCommit: FoundationGitObjectSchema.nullable(),
    contentDisposition: z.enum(["changed", "unchanged"]).nullable(),
    changedSubjects: z.array(FoundationJsonValueSchema).max(16_384),
    invalidatedSeal: FoundationAttemptViewSealReferenceSchema.nullable(),
    invalidatedEvidence: FoundationAttemptViewEvidenceReferenceSchema.nullable(),
    failureFactsDigest: FoundationSha256Schema.nullable(),
    limitations: z.array(FoundationJsonValueSchema).max(128),
  }).strict().superRefine((value, context) => {
    if (value.role !== "builder" && value.successorDisposition !== null) {
      context.addIssue({
        code: "custom",
        path: ["successorDisposition"],
        message: "Only a builder Attempt can have a Candidate successor disposition",
      });
    }
    const promoted = value.successorDisposition === "promoted";
    if (promoted !== (value.successor !== null)) {
      context.addIssue({
        code: "custom",
        path: ["successor"],
        message: "Only a promoted Candidate successor has a binding",
      });
    }
    if (promoted !== (value.contentDisposition !== null)) {
      context.addIssue({
        code: "custom",
        path: ["contentDisposition"],
        message: "Only a promoted Candidate successor has a content disposition",
      });
    }
    if (!promoted && value.changedSubjects.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["changedSubjects"],
        message: "Changed subjects require a promoted Candidate successor",
      });
    }
  }),
  processAndProof: z.object({
    provenance: z.literal("runtime-derived"),
    standing: z.enum(["framing", "awaiting-admission", "active", "boundary-paused", "awaiting-readmission", "decision-ready", "closed"]),
    candidateCondition: z.enum(["absent", "ready-for-work", "in-progress", "needs-correction", "paused-for-boundary", "sealed-under-evaluation", "ready-for-decision", "terminal-recovery", "accepted", "abandoned"]),
    proposedBoundary: FoundationAttemptViewBoundaryReferenceSchema.nullable(),
    activeBoundary: FoundationAttemptViewBoundaryReferenceSchema.nullable(),
    materialCondition: z.object({
      reference: FoundationAttemptViewConditionReferenceSchema,
      conditionClass: FoundationOpaqueIdSchema,
      blocking: z.boolean(),
      limitations: z.array(FoundationJsonValueSchema).max(128),
    }).strict().nullable(),
    seal: FoundationAttemptViewSealReferenceSchema.nullable(),
    evidence: z.object({
      reference: FoundationAttemptViewEvidenceReferenceSchema,
      readiness: z.enum(["acceptance-ready", "correctable", "revision-required", "no-ship-recommended"]),
      uncertainty: FoundationPublicFactsSchema,
      propositionDecisions: z.array(FoundationJsonValueSchema).max(4_096),
      diagnostics: z.array(FoundationJsonValueSchema).max(1_024),
    }).strict().nullable(),
    checks: z.array(FoundationAttemptViewCheckSchema).max(4_096),
    obligations: z.array(FoundationAttemptViewObligationSchema).max(4_096),
    blockers: z.array(FoundationOpaqueIdSchema).max(4_096),
    eligibleOperations: z.array(FoundationDeliveryOperationSchema).max(FOUNDATION_DELIVERY_OPERATIONS.length),
  }).strict(),
  diagnostics: z.array(FoundationAttemptViewDiagnosticSchema).max(1_024),
}).strict().superRefine((value, context) => {
  if (value.complete !== (value.diagnostics.length === 0)) {
    context.addIssue({
      code: "custom",
      path: ["complete"],
      message: "Attempt View completeness must match its exact diagnostics",
    });
  }
  const expectedRole = value.attemptContract.operation === "delivery.continue"
    ? "builder"
    : value.attemptContract.operation === "delivery.evaluate"
      ? "reviewer"
      : "reconnaissance";
  if (value.attemptContract.role !== expectedRole ||
      value.candidateTransition.role !== value.attemptContract.role) {
    context.addIssue({
      code: "custom",
      path: ["attemptContract", "role"],
      message: "Attempt View role must match its exact operation and Candidate transition",
    });
  }
  if (
    value.complete && value.candidateTransition.role === "builder" &&
    value.candidateTransition.successorDisposition === null
  ) {
    context.addIssue({
      code: "custom",
      path: ["candidateTransition", "successorDisposition"],
      message: "A complete builder Attempt View requires one terminal Candidate successor disposition",
    });
  }
  const observedExecution = value.providerExecution.execution;
  if (observedExecution !== null) {
    const selectedExecution = value.attemptContract.execution;
    for (const field of [
      "backendProfile",
      "image",
      "inputSet",
      "network",
      "services",
      "effectiveLimits",
    ] as const) {
      if (JSON.stringify(observedExecution[field]) !== JSON.stringify(selectedExecution[field])) {
        context.addIssue({
          code: "custom",
          path: ["providerExecution", "execution", field],
          message: "Observed execution must reproduce the exact sanitized Attempt selection",
        });
      }
    }
    if (value.providerExecution.effect.digest !== observedExecution.specificationDigest) {
      context.addIssue({
        code: "custom",
        path: ["providerExecution", "execution", "specificationDigest"],
        message: "Observed execution must bind the exact provider effect Specification",
      });
    }
  }
});

export type FoundationAttemptView = z.output<typeof FoundationAttemptViewSchema>;
