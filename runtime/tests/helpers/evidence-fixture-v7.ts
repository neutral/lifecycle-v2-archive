import { FOUNDATION_EVIDENCE_RULE_SET_V7, FOUNDATION_EVIDENCE_VALIDATOR_V7 } from "../../src/foundation/evidence/coordinates-v7.js";
import { foundationIntegrationValidationFactsDigestV1 } from "../../src/foundation/control/integration-assessment.js";
import {
  type EvidencePacketObservation,
} from "../../src/foundation/control/evidence-packet.js";
import {
  compileControlRecordEvent,
  compileControlRecordRevision,
} from "../../src/foundation/control/model.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlJsonObject,
  type ControlRecordEvent,
  type ControlRecordRelationship,
  type ControlRecordRevision,
  type ControlRecordStoreAppend,
  type ControlRecordStoreIdentity,
} from "../../src/foundation/control/types.js";
import type { ReducedDeliveryState } from "../../src/foundation/process/delivery-reducer.js";
import { selfDigest, sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

const PROCESS = "delivery-evidence-packet";
const ACTIVITY = "activity-evaluate";
const CREATED = "2026-08-29T18:00:00.000Z";
const EVALUATED = "2026-08-29T18:00:20.000Z";
const RUNTIME = "foundation-runtime";

function digest(value: string) {
  return sha256Bytes(value);
}

const identity: ControlRecordStoreIdentity = Object.freeze({
  schema: CONTROL_RECORD_STORE_SCHEMA,
  storeId: "store-evidence-packet",
  targetId: "target-evidence-packet",
  processKind: "delivery",
  processId: PROCESS,
  createdAt: CREATED,
});

function relation(relation: string, target: ControlRecordRevision): ControlRecordRelationship {
  return Object.freeze({
    relation,
    target: Object.freeze({
      kind: target.recordKind,
      id: target.recordId,
      revision: target.revision,
      digest: target.digest,
    }),
  });
}

function revision(input: Readonly<{
  id: string;
  kind: string;
  revision?: number;
  payload: ControlJsonObject;
  relationships?: readonly ControlRecordRelationship[];
  authority?: "agent-proposed" | "runtime-observed" | "runtime-derived" | "director-supplied";
}>): ControlRecordRevision {
  const authority = input.authority ?? "runtime-derived";
  return compileControlRecordRevision(PROCESS, {
    recordId: input.id,
    recordKind: input.kind,
    revision: input.revision ?? 1,
    producer: { kind: "runtime", id: RUNTIME },
    semanticAuthor: authority === "agent-proposed"
      ? { kind: "agent", id: "reviewer-agent" }
      : authority === "director-supplied" ? { kind: "director", id: "director:evidence" }
      : { kind: "runtime", id: RUNTIME },
    semanticAuthority: authority,
    createdAt: CREATED,
    semanticMarkdown: `# ${input.kind}\n`,
    payload: input.payload,
    relationships: input.relationships ?? [],
  });
}

function boundaryRevision(brief: ControlRecordRevision, proposal: ControlRecordRevision, basis?: ControlJsonObject): ControlRecordRevision {
  const sample = validDeliveryControlPayload("work-boundary");
  const mandate = sample.mandate as ControlJsonObject;
  return revision({
    id: "work-boundary-evidence",
    kind: "work-boundary",
    payload: Object.freeze({
      ...sample,
      targetId: identity.targetId,
      basis: Object.freeze({ ...(sample.basis as ControlJsonObject), ...basis }),
      mandate: Object.freeze({
        ...mandate,
        checks: Object.freeze([Object.freeze({
          ...((mandate.checks as readonly ControlJsonObject[])[0]!),
          id: "selection.check.evidence",
          definition: Object.freeze({
            id: "check.evidence",
            revision: 1,
            sourceDigest: digest("check-source"),
            semanticDigest: digest("check-semantics"),
          }),
          bindings: Object.freeze([Object.freeze({
            id: "binding.check.evidence",
            digest: digest("binding"),
            implementationDigest: digest("binding-implementation"),
          })]),
          modality: "precondition",
          baselineRequired: true,
          finalRequired: true,
          obligationIds: Object.freeze(["obligation.evidence"]),
          environmentRequirements: Object.freeze([]),
        })]),
        obligations: Object.freeze([Object.freeze({
          ...((mandate.obligations as readonly ControlJsonObject[])[0]!),
          id: "obligation.evidence",
          severity: "required",
          requiredEvidenceArtifactIds: Object.freeze(["artifact.evidence"]),
          propositionIds: Object.freeze(["proposition.evidence"]),
        })]),
        artifacts: Object.freeze([Object.freeze({
          ...((mandate.artifacts as readonly ControlJsonObject[])[0]!),
          id: "artifact.evidence",
          path: "src/evidence.ts",
          mustChange: true,
          obligationIds: Object.freeze(["obligation.evidence"]),
        })]),
        acceptancePropositions: Object.freeze([Object.freeze({
          ...((mandate.acceptancePropositions as readonly ControlJsonObject[])[0]!),
          id: "proposition.evidence",
          evidenceArtifactIds: Object.freeze(["artifact.evidence"]),
          path: "src/evidence.ts",
          checkId: "selection.check.evidence",
          obligationIds: Object.freeze(["obligation.evidence"]),
          allowNotApplicable: false,
          notApplicableCondition: null,
        })]),
      }),
    }),
    relationships: [relation("uses-brief", brief), relation("proposed-from", proposal)],
  });
}

function checkRevision(input: Readonly<{
  id: string;
  phase: "baseline" | "final";
  subject: ControlRecordRevision;
}>): ControlRecordRevision {
  return revision({
    id: input.id,
    kind: "check-receipt",
    authority: "runtime-observed",
    payload: Object.freeze({
      ...validDeliveryControlPayload("check-receipt"),
      selectionId: "selection.check.evidence",
      definition: Object.freeze({
        id: "check.evidence",
        revision: 1,
        sourceDigest: digest("check-source"),
        semanticDigest: digest("check-semantics"),
      }),
      binding: Object.freeze({
        id: "binding.check.evidence",
        digest: digest("binding"),
        implementationDigest: digest("binding-implementation"),
      }),
      phase: input.phase,
      modality: "precondition",
      finishedAt: input.phase === "baseline"
        ? "2026-08-29T18:00:01.000Z"
        : "2026-08-29T18:00:04.000Z",
      environment: Object.freeze({
        ...(validDeliveryControlPayload("check-receipt").environment as ControlJsonObject),
        requested: Object.freeze([]),
      }),
      disposition: "pass",
    }),
    relationships: [relation(
      input.phase === "baseline" ? "checks-boundary" : "checks-seal",
      input.subject,
    )],
  });
}

export function reviewerEvidenceWorkProductPayloadV7(input: Readonly<{
  finalCheck: ControlRecordRevision;
  baselineChecks?: readonly ControlRecordRevision[];
  propositionId: string;
  inspectedSubjectIds?: readonly string[] | undefined;
  materialReview?: "mandate" | "baseline" | undefined;
}>): ControlJsonObject {
  const sample = validDeliveryControlPayload("agent-work-product");
  const profileId = "lifecycle.agent-work-product-body.reviewer.v4";
  return Object.freeze({
    ...sample,
    profileId,
    role: "reviewer",
    disposition: "complete",
    uncertainty: Object.freeze({ level: "none", fragmentDigest: digest("review-uncertainty") }),
    citations: Object.freeze([...(input.baselineChecks ?? []).map((receipt) => Object.freeze({
      id: `citation.${receipt.recordId}`, subjectId: receipt.recordId, subjectKind: "evidence",
      subjectDigest: receipt.digest, locator: `control:${receipt.recordId}`, authorityClass: "runtime-observed",
      claimIds: Object.freeze(["judgment.evidence"]), fragmentDigest: digest(`baseline-citation:${receipt.recordId}`),
    })), Object.freeze({
      id: "citation.final-check",
      subjectId: input.finalCheck.recordId,
      subjectKind: "evidence",
      subjectDigest: input.finalCheck.digest,
      locator: `control:${input.finalCheck.recordId}`,
      authorityClass: "runtime-observed",
      claimIds: Object.freeze(["judgment.evidence"]),
      fragmentDigest: digest("review-citation"),
    })]),
    roleSemantics: Object.freeze({
      role: "reviewer",
      judgments: Object.freeze([Object.freeze({
        id: "judgment.evidence",
        propositionId: input.propositionId,
        disposition: "accepted",
        citationIds: Object.freeze(["citation.final-check"]),
        inspectedSubjectIds: Object.freeze(input.inspectedSubjectIds ?? [input.finalCheck.recordId]),
        rationale: "The exact final Check supports the selected proposition.",
        uncertainty: "none",
        limitationIds: Object.freeze([]),
        fragmentDigest: digest("review-fragment"),
      })]),
      mandateApplicability: Object.freeze({ disposition: input.materialReview === "mandate" ? "requires-readmission" : "applicable", rationale: "The mandate remains applicable to the exact integration parent and result.",
        citationIds: Object.freeze(["citation.final-check"]), fragmentDigest: digest("mandate-applicability") }),
      baselineApplicability: Object.freeze((input.baselineChecks ?? []).map((receipt) => Object.freeze({
        receiptId: receipt.recordId, disposition: input.materialReview === "baseline" ? "insufficient" : "applicable", rationale: "This exact original baseline remains sufficient for the parent and result.",
        citationIds: Object.freeze([`citation.${receipt.recordId}`]), fragmentDigest: digest(`baseline-applicability:${receipt.recordId}`),
      }))),
      mandateExcess: false,
      missingObligationIds: Object.freeze([]),
      conditions: Object.freeze(input.materialReview === undefined ? [] : [Object.freeze({
        id:"condition.material", conditionClass:"assurance-conflict", statement:"The selected integration needs Director-governed assurance resolution.",
        falsifiedMandateIds:[],knowledgeIds:[],directorJudgmentRequired:true,fragmentDigest:digest("condition.material"),
      })]),
    }),
    body: Object.freeze({
      profileId,
      digest: digest("review-body"),
      fragments: Object.freeze([...(input.materialReview === undefined ? [] : [Object.freeze({id:"condition.material",kind:"condition",anchor:"material-condition",digest:digest("condition.material")})]),Object.freeze({
        id: "judgment.evidence",
        kind: "review",
        anchor: "review-evidence",
        digest: digest("review-fragment"),
      })]),
    }),
  });
}

export function reviewerEvidenceReceiptPayloadV7(input: Readonly<{
  activityId: string;
  attempt: ControlRecordRevision;
  candidate: ControlRecordRevision;
  workProduct: ControlRecordRevision;
  effectDigest?: ReturnType<typeof digest>;
  sessionId?: string | null;
}>): ControlJsonObject {
  const sample = validDeliveryControlPayload("execution-receipt");
  const attemptProvider = input.attempt.payload.provider as ControlJsonObject;
  const attemptInput = input.attempt.payload.input as ControlJsonObject;
  const exact = (value: ControlRecordRevision) => Object.freeze({
    kind: value.recordKind,
    id: value.recordId,
    revision: value.revision,
    digest: value.digest,
  });
  return Object.freeze({
    ...sample,
    activityId: input.activityId,
    role: "reviewer",
    productiveExecutionStarted: true,
    inputBindings: Object.freeze({
      roleBriefDigest: (input.attempt.payload.authoring as ControlJsonObject).roleBriefDigest!,
      contentInventoryDigest: attemptInput.contentInventoryDigest!,
      inputMaterialDigest: attemptInput.inputMaterialDigest!,
    }),
    providerEffect: Object.freeze({
      ...(sample.providerEffect as ControlJsonObject),
      effectDigest: input.effectDigest ?? digest("review-provider-effect"),
      outcome: "completed",
    }),
    provider: Object.freeze({
      ...(sample.provider as ControlJsonObject),
      descriptorId: attemptProvider.descriptorId!,
      descriptorDigest: attemptProvider.descriptorDigest!,
      adapter: attemptProvider.adapter!,
      installedIdentityDigest: attemptProvider.installedIdentityDigest!,
      observedExecutableIdentity: attemptProvider.installedIdentityDigest!,
      model: (input.attempt.payload.investment as ControlJsonObject).model!,
      sessionId: input.sessionId === undefined ? "provider-session-review" : input.sessionId,
      firstTrigger: "natural",
      terminalReason: "natural-completion",
      stage: "evaluated",
      startedAt: input.attempt.createdAt,
      finishedAt: input.workProduct.createdAt,
      exitCode: 0,
      signal: null,
    }),
    execution: Object.freeze({
      ...(sample.execution as ControlJsonObject),
      ...(input.attempt.payload.execution as ControlJsonObject),
      output: Object.freeze({
        availability: "retrieved",
        carrierByteLength: 64,
        carrierDigest: digest("review-output-carrier"),
        manifestDigest: digest("review-output-manifest"),
      }),
    }),
    workspace: Object.freeze({
      availability: "available",
      parserDisposition: "valid",
      compilerDisposition: "retained",
      rawByteLength: 64,
      workspaceRawDigest: digest("review-workspace"),
      semanticMarkdownDigest: digest("review-semantic"),
      parseResultDigest: digest("review-parse"),
      failureFactsDigest: null,
      submissionDiagnostic: null,
      fixedBindingSubjectDigest: digest("review-bindings"),
    }),
    workProduct: Object.freeze({ disposition: "submitted", reference: exact(input.workProduct) }),
    candidate: Object.freeze({
      input: Object.freeze({
        revision: exact(input.candidate),
        carrierManifestDigest: (input.candidate.payload.carrierManifest as ControlJsonObject).digest!,
      }),
      successorDisposition: null,
      successor: null,
      contentDisposition: null,
    }),
  });
}

export function evidenceFixtureV7(input: Readonly<{
  reviewerSession?: string | null;
  includeSealBinding?: boolean;
  includeFinalCheck?: boolean;
  inspectedSubjectIds?: readonly string[];
  materialCondition?: boolean;
  materialReview?: "mandate" | "baseline";
  boundaryBasis?: ControlJsonObject;
  integrationParentTargetId?: string;
  integrationCandidatePayload?: ControlJsonObject;
}> = {}) {
  const brief = revision({
    id: "director-brief-evidence",
    kind: "director-brief",
    authority: "director-supplied",
    payload: { ...validDeliveryControlPayload("director-brief"), scope: { kind: "activity", activityId: "activity-prepare" } },
  });
  const preparationAttempt = revision({
    id: "agent-attempt-prepare-evidence",
    kind: "agent-attempt",
    payload: validDeliveryControlPayload("agent-attempt"),
    relationships: [relation("uses-brief", brief)],
  });
  const preparationProduct = revision({
    id: "agent-work-product-prepare-evidence",
    kind: "agent-work-product",
    authority: "agent-proposed",
    payload: validDeliveryControlPayload("agent-work-product"),
    relationships: [relation("result-of", preparationAttempt)],
  });
  const boundary = boundaryRevision(brief, preparationProduct, input.boundaryBasis);
  const sourceCandidate = revision({
    id: "candidate-evidence",
    kind: "candidate-revision",
    authority: "runtime-observed",
    payload: Object.freeze({
      ...validDeliveryControlPayload("candidate-revision"),
      candidateBaseCommit: (boundary.payload.basis as ControlJsonObject).productBaseCommit!,
    }),
    relationships: [relation("governed-by", boundary)],
  });
  const basis = boundary.payload.basis as ControlJsonObject;
  const parentBasis = Object.freeze({ targetId: input.integrationParentTargetId ?? identity.targetId, commit: basis.productBaseCommit!, tree: basis.productBaseTree!,
    objectFormat: String(basis.productBaseCommit).length === 64 ? "sha256" : "sha1", contractDigest: basis.repositoryContractDigest!,
    productStateDigest: basis.productStateDigest!, atlasStateDigest: basis.atlasStateDigest!,
    atlasResolutionDigest: basis.atlasResolutionDigest!, atlasNormalizedModelDigest: basis.atlasNormalizedModelDigest!,
    atlasResourceBindingsDigest: basis.atlasResourceBindingsDigest!, knowledgeSetDigest: basis.knowledgeSetDigest! });
  const assessment = revision({ id: "integration-evidence", kind: "integration-assessment", authority: "runtime-observed",
    payload: Object.freeze({ schema: "lifecycle.integration-assessment-payload.v1", profileId: "lifecycle.integration-assessment.foundation-v1",
      canonicalParent: Object.freeze({ ...parentBasis, digest: selfDigest(parentBasis) }),
      mergeRule: Object.freeze({ id: "lifecycle.integration.three-way.v2", implementationId: "lifecycle.integration.git-merge-tree.v1", implementationDigest: digest("merge-rule") }),
      outcome: "constructed", conflicts: Object.freeze([]),
      validation: Object.freeze({ complete: true, valid: true, diagnosticCodes: Object.freeze([]),
        factsDigest: foundationIntegrationValidationFactsDigestV1({
          manifestFileDigest: (sourceCandidate.payload.carrierManifest as ControlJsonObject).digest as `sha256:${string}`,
          state: sourceCandidate.payload.state, observer: sourceCandidate.payload.observer }) }),
      contextualApplicability: Object.freeze({ disposition: "unchanged", changes: Object.freeze([]) }), assessedAt: CREATED, limitations: Object.freeze([]) }),
    relationships: [relation("governed-by", boundary), relation("integrates", sourceCandidate)],
  });
  const candidate = revision({ id: sourceCandidate.recordId, kind: "candidate-revision", revision: 2, authority: "runtime-observed",
    payload: Object.freeze({ ...sourceCandidate.payload, ...input.integrationCandidatePayload, observation: "integration-successor" }),
    relationships: [relation("governed-by", boundary), relation("revises", sourceCandidate), relation("integrated-from", assessment)],
  });
  const seal = revision({
    id: "candidate-seal-evidence",
    kind: "candidate-seal",
    authority: "runtime-observed",
    payload: validDeliveryControlPayload("candidate-seal"),
    relationships: [relation("governed-by", boundary), relation("seals", candidate)],
  });
  const attempt = revision({
    id: "agent-attempt-review",
    kind: "agent-attempt",
    payload: Object.freeze({
      ...validDeliveryControlPayload("agent-attempt"),
      activityId: ACTIVITY,
      operation: "delivery.evaluate",
      role: "reviewer",
      projection: Object.freeze({
        ...(validDeliveryControlPayload("agent-attempt").projection as ControlJsonObject),
        digest: digest("review-projection"),
      }),
      capability: Object.freeze({
        ...(validDeliveryControlPayload("agent-attempt").capability as ControlJsonObject),
        profileDigest: digest("review-capability"),
      }),
      input: Object.freeze({
        ...(validDeliveryControlPayload("agent-attempt").input as ControlJsonObject),
        evidenceSetDigest: digest("evidence-set"),
        propositionSetDigest: digest("proposition-set"),
      }),
    }),
    relationships: [
      relation("uses-brief", brief),
      relation("uses-boundary", boundary),
      relation("uses-candidate", candidate),
      ...(input.includeSealBinding === false ? [] : [relation("uses-seal", seal)]),
    ],
  });
  const finalCheck = checkRevision({ id: "check-receipt-final", phase: "final", subject: seal });
  const baselineCheck = checkRevision({
    id: "check-receipt-baseline",
    phase: "baseline",
    subject: boundary,
  });
  const workProduct = revision({
    id: "agent-work-product-review",
    kind: "agent-work-product",
    authority: "agent-proposed",
    payload: reviewerEvidenceWorkProductPayloadV7({
      finalCheck,
      baselineChecks: [baselineCheck],
      propositionId: "proposition.evidence",
      inspectedSubjectIds: input.inspectedSubjectIds,
      materialReview: input.materialReview,
    }),
    relationships: [relation("result-of", attempt)],
  });
  const executionReceipt = revision({
    id: "execution-receipt-review",
    kind: "execution-receipt",
    authority: "runtime-observed",
    payload: reviewerEvidenceReceiptPayloadV7({
      sessionId: input.reviewerSession,
      activityId: ACTIVITY,
      attempt,
      candidate,
      workProduct,
    }),
    relationships: [
      relation("observes-attempt", attempt),
      relation("observes-work-product", workProduct),
    ],
  });
  const material = input.materialCondition === true
    ? revision({
      id: "material-condition-evidence",
      kind: "material-condition",
      payload: Object.freeze({
        ...validDeliveryControlPayload("material-condition"),
        source: Object.freeze({
          kind: "agent-proposal",
          conditionId: "condition.material",
          fragmentDigest: digest("condition.material"),
        }),
        observedFactsDigest: digest("evidence-material-condition-facts"),
      }),
      relationships: [
        relation("reported-by", workProduct),
        relation("observed-in", executionReceipt),
        relation("freezes", candidate),
        relation("governed-by", boundary),
      ],
    })
    : null;
  const revisions = new Map<string, ControlRecordRevision>();
  for (const value of [boundary, sourceCandidate, assessment, candidate, seal, brief, preparationAttempt, preparationProduct, attempt, finalCheck, workProduct, executionReceipt, baselineCheck, material]) {
    if (value !== null) revisions.set(`${value.recordId}\u0000${value.revision}`, value);
  }

  const reviewEffect = digest("review-provider-effect");
  const eventInputs = [
    { kind: "delivery-created", activityId: null, subject: null as ControlRecordRevision | null },
    { kind: "check-receipt-recorded", activityId: "activity-prepare", subject: baselineCheck },
    { kind: "activity-started", activityId: ACTIVITY, subject: null },
    { kind: "candidate-sealed", activityId: ACTIVITY, subject: seal },
    ...(input.includeFinalCheck === false
      ? []
      : [{ kind: "check-receipt-recorded", activityId: ACTIVITY, subject: finalCheck }]),
    { kind: "agent-attempt-prepared", activityId: ACTIVITY, subject: attempt },
    { kind: "provider-effect-intended", activityId: ACTIVITY, subject: attempt },
    { kind: "provider-effect-observed", activityId: ACTIVITY, subject: attempt },
    { kind: "agent-work-product-submitted", activityId: ACTIVITY, subject: workProduct },
    { kind: "execution-receipt-recorded", activityId: ACTIVITY, subject: executionReceipt },
    ...(material === null
      ? []
      : [{ kind: "material-condition-frozen", activityId: ACTIVITY, subject: material }]),
  ];
  const events: ControlRecordEvent[] = [];
  let predecessorDigest = null as ReturnType<typeof digest> | null;
  for (const [index, value] of eventInputs.entries()) {
    const event = compileControlRecordEvent({
      storeId: identity.storeId,
      processId: identity.processId,
      sequence: index + 1,
      predecessorDigest,
      event: {
        eventId: `event-${value.kind}-${index + 1}`,
        eventKind: value.kind,
        occurredAt: new Date(Date.parse(CREATED) + index * 1_000).toISOString(),
        actor: { kind: "runtime", id: RUNTIME },
        subject: value.subject === null ? null : {
          recordId: value.subject.recordId,
          revision: value.subject.revision,
          digest: value.subject.digest,
        },
        payload: value.kind === "material-condition-frozen"
          ? {
              sourceKind: "agent-proposal",
              activityId: value.activityId,
              observedFactsDigest: value.subject!.payload.observedFactsDigest!,
            }
                    : value.kind === "activity-started"
            ? { activityId: value.activityId, operation: "delivery.evaluate" }
            : value.kind === "provider-effect-intended"
              ? { activityId: value.activityId, effectDigest: reviewEffect }
              : value.kind === "provider-effect-observed"
                ? { activityId: value.activityId, effectDigest: reviewEffect, outcome: "completed" }
                : value.activityId === null ? {} : { activityId: value.activityId },
      },
    });
    predecessorDigest = event.digest;
    events.push(event);
  }
  const subjects = Object.freeze({
    integrationAssessment: Object.freeze({ id: assessment.recordId, revision: assessment.revision, digest: assessment.digest }),
    proposedBoundary: null,
    activeBoundary: Object.freeze({ id: boundary.recordId, revision: 1, digest: boundary.digest }),
    candidate: Object.freeze({ id: candidate.recordId, revision: candidate.revision, digest: candidate.digest }),
    materialCondition: material === null ? null : Object.freeze({ id: material.recordId, revision: 1, digest: material.digest }),
    seal: Object.freeze({ id: seal.recordId, revision: 1, digest: seal.digest }),
    evidence: null,
    closure: null,
  });
  const state: ReducedDeliveryState = Object.freeze({
    standing: material === null ? "active" : "boundary-paused",
    candidateCondition: material === null ? "sealed-under-evaluation" : "paused-for-boundary",
    activities: Object.freeze([Object.freeze({
      id: ACTIVITY,
      operation: "delivery.evaluate" as const,
      family: "agent" as const,
      stage: "finalizing" as const,
      recovery: Object.freeze({
        kind: "finalization" as const,
        resumesAt: "activity-finalization" as const,
        exactEffectDigest: null,
      }),
    })]),
    subjects,
    delegation: { admission: null, current: null, charged: { operations: 0, agentAttempts: 0, reservedCellWallTimeMs: 0 } },
    journal: Object.freeze({
      eventCount: events.length,
      headDigest: events.at(-1)!.digest,
    }),
    eligibleOperations: Object.freeze(["delivery.recover"] as const),
  });
  const appended: ControlRecordStoreAppend[] = [];
  let currentState = state;
  const store = {
    identity,
    state: () => currentState,
    listEvents(afterSequence = 0, limit = 10_000) {
      return events.filter(({ sequence }) => sequence > afterSequence).slice(0, limit);
    },
    getRevision(recordId: string, revisionNumber: number) {
      return revisions.get(`${recordId}\u0000${revisionNumber}`) ?? null;
    },
    append(value: ControlRecordStoreAppend) {
      appended.push(value);
      const retainedRevision = value.revision === undefined
        ? null
        : compileControlRecordRevision(identity.processId, value.revision);
      const event = compileControlRecordEvent({
        storeId: identity.storeId,
        processId: identity.processId,
        sequence: events.length + 1,
        predecessorDigest: events.at(-1)?.digest ?? null,
        event: value.event,
      });
      if (retainedRevision !== null) {
        revisions.set(`${retainedRevision.recordId}\u0000${retainedRevision.revision}`, retainedRevision);
      }
      events.push(event);
      currentState = Object.freeze({
        ...currentState,
        ...(event.eventKind === "activity-completed" ? {
          standing: currentState.subjects.materialCondition === null ? "decision-ready" as const : "boundary-paused" as const,
          candidateCondition: currentState.subjects.materialCondition === null ? "ready-for-decision" as const : "paused-for-boundary" as const,
          activities: Object.freeze([]),
          eligibleOperations: Object.freeze(["delivery.accept", "delivery.no-ship"] as const),
        } : {}),
        subjects: Object.freeze({
          ...currentState.subjects,
          ...(retainedRevision?.recordKind === "material-condition" ? {materialCondition:Object.freeze({id:retainedRevision.recordId,revision:retainedRevision.revision,digest:retainedRevision.digest})} : {}),
          ...(retainedRevision?.recordKind === "evidence-packet" ? { evidence: Object.freeze({
            id: retainedRevision.recordId,
            revision: retainedRevision.revision,
            digest: retainedRevision.digest,
          }) } : {}),
        }),
        journal: Object.freeze({ eventCount: events.length, headDigest: event.digest }),
      });
      return Object.freeze({ revision: retainedRevision, event });
    },
  } as unknown as ControlRecordStore;
  const completeEvaluation = () => store.append({ event: {
    eventId: "event-evaluation-completed",
    eventKind: "activity-completed",
    occurredAt: "2026-08-29T18:00:21.000Z",
    actor: { kind: "runtime", id: RUNTIME },
    subject: null,
    payload: { activityId: ACTIVITY, outcome: "completed" },
  } });
  return Object.freeze({ store, appended, events, revisions, completeEvaluation, selected: { boundary: subjects.activeBoundary!, candidate: subjects.candidate!, seal: subjects.seal!, materialCondition: subjects.materialCondition }, identity, activityId: ACTIVITY });
}

export const EVIDENCE_OBSERVATION_V7: EvidencePacketObservation = Object.freeze({
  evaluatedAt: EVALUATED,
  artifacts: Object.freeze([Object.freeze({
    artifactId: "artifact.evidence",
    fileKind: "file",
    existence: "present",
    change: "modified",
    contentDigest: digest("artifact-content"),
    manifestDigest: null,
    schemaValidation: "not-required",
    semanticValidation: "valid",
  })]),
  descriptionCoverage: Object.freeze([]),
  reviewerSubjectDisposition: "exact-read-only",
  ruleSet: FOUNDATION_EVIDENCE_RULE_SET_V7,
  validator: FOUNDATION_EVIDENCE_VALIDATOR_V7,
});
