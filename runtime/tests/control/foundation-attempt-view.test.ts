import assert from "node:assert/strict";
import test from "node:test";
import {
  FOUNDATION_ATTEMPT_VIEW_PROFILE_ID,
  FOUNDATION_ATTEMPT_VIEW_SCHEMA,
  FOUNDATION_DELIVERY_REDUCER_ID,
  compileFoundationAttemptView,
} from "../../src/foundation/control/attempt-view.js";
import { inspectDeliveryAttemptView } from "../../src/foundation/control/inspection.js";
import { assertDeliveryControlRecordPayload } from "../../src/foundation/control/payload-registry.js";
import { foundationDockerExecutionBackendProfileV1 } from "../../src/foundation/execution/docker-profile-v1.js";
import { compileFoundationInstalledAgentExecutionPolicyV1 } from "../../src/foundation/execution/installed-agent-policy-v1.js";
import {
  compileControlRecordEvent,
  compileControlRecordRevision,
} from "../../src/foundation/control/model.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlJsonObject,
  type ControlRecordEvent,
  type ControlRecordEventInput,
  type ControlRecordRevision,
  type ControlRecordRevisionInput,
  type ControlRecordStoreIdentity,
} from "../../src/foundation/control/types.js";
import { reduceDeliveryEvents } from "../../src/foundation/process/delivery-reducer.js";
import {
  canonicalJson,
  digestCanonical,
  sha256Bytes,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

const RUNTIME = "foundation-runtime";
const CREATED = "2026-08-29T21:00:00.000Z";
const ACTIVITY = "activity.prepare.attempt-view";

function digest(value: string): Sha256 {
  return sha256Bytes(`attempt-view:${value}`);
}

function currentAgentAttemptPayload(): ControlJsonObject {
  const payload = validDeliveryControlPayload("agent-attempt");
  const execution = payload.execution as ControlJsonObject;
  const profile = foundationDockerExecutionBackendProfileV1();
  return Object.freeze({
    ...payload,
    execution: Object.freeze({
      ...execution,
      backendProfile: Object.freeze({
        profileId: profile.profileId,
        profileDigest: profile.digest,
        implementationDigest: profile.implementation.implementationDigest,
      }),
    }),
    executionPolicy: compileFoundationInstalledAgentExecutionPolicyV1().executionPolicy,
  });
}

function reference(revision: ControlRecordRevision) {
  return Object.freeze({
    kind: revision.recordKind,
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function subject(revision: ControlRecordRevision) {
  return Object.freeze({
    recordId: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function fixture(complete: boolean, invalidSubmission = false, options: Readonly<{ baselinePostcondition?: boolean }> = {}) {
  const identity: ControlRecordStoreIdentity = Object.freeze({
    schema: CONTROL_RECORD_STORE_SCHEMA,
    storeId: "store-attempt-view",
    targetId: "target-attempt-view",
    processKind: "delivery",
    processId: "delivery-attempt-view",
    createdAt: CREATED,
  });
  const revisions = new Map<string, ControlRecordRevision>();
  const events: ControlRecordEvent[] = [];
  let predecessorDigest: Sha256 | null = null;
  let appendCalls = 0;

  const retain = (input: ControlRecordRevisionInput): ControlRecordRevision => {
    const revision = compileControlRecordRevision(identity.processId, input);
    revisions.set(`${revision.recordId}\u0000${revision.revision}`, revision);
    return revision;
  };
  const event = (input: ControlRecordEventInput): ControlRecordEvent => {
    const retained = compileControlRecordEvent({
      storeId: identity.storeId,
      processId: identity.processId,
      sequence: events.length + 1,
      predecessorDigest,
      event: input,
    });
    predecessorDigest = retained.digest;
    events.push(retained);
    return retained;
  };
  const record = (input: Readonly<{
    id: string;
    kind: string;
    payload: ControlJsonObject;
    semanticAuthority: ControlRecordRevisionInput["semanticAuthority"];
    semanticAuthor: ControlRecordRevisionInput["semanticAuthor"];
    relationships?: ControlRecordRevisionInput["relationships"];
  }>): ControlRecordRevision => retain({
    recordId: input.id,
    recordKind: input.kind,
    revision: 1,
    producer: { kind: "runtime", id: RUNTIME },
    semanticAuthor: input.semanticAuthor,
    semanticAuthority: input.semanticAuthority,
    createdAt: CREATED,
    semanticMarkdown: `# ${input.kind}\n\nExact ${input.kind} semantics.\n`,
    payload: input.payload,
    relationships: input.relationships ?? [],
  });

  event({
    eventId: "event.delivery-created.attempt-view",
    eventKind: "delivery-created",
    occurredAt: CREATED,
    actor: { kind: "runtime", id: RUNTIME },
    payload: {},
  });
  const brief = record({
    id: "brief.attempt-view",
    kind: "director-brief",
    payload: { ...validDeliveryControlPayload("director-brief"), scope: { kind: "activity", activityId: ACTIVITY } },
    semanticAuthority: "director-supplied",
    semanticAuthor: { kind: "director", id: "director-one" },
  });
  event({
    eventId: "event.brief.attempt-view",
    eventKind: "director-brief-submitted",
    occurredAt: "2026-08-29T21:00:01.000Z",
    actor: { kind: "runtime", id: RUNTIME },
    subject: subject(brief),
    payload: { activityId: ACTIVITY },
  });
  event({
    eventId: "event.activity-started.attempt-view",
    eventKind: "activity-started",
    occurredAt: "2026-08-29T21:00:02.000Z",
    actor: { kind: "runtime", id: RUNTIME },
    payload: { activityId: ACTIVITY, operation: "delivery.prepare" },
  });

  const attemptBase = currentAgentAttemptPayload();
  const attempt = record({
    id: "attempt.attempt-view",
    kind: "agent-attempt",
    payload: Object.freeze({
      ...attemptBase,
      activityId: ACTIVITY,
      operation: "delivery.prepare",
      role: "reconnaissance",
      invocationId: "invocation.attempt-view",
      preDispatchStateDigest: digest("pre-dispatch"),
    }),
    semanticAuthority: "runtime-derived",
    semanticAuthor: { kind: "runtime", id: RUNTIME },
    relationships: [{ relation: "uses-brief", target: reference(brief) }],
  });
  event({
    eventId: "event.attempt-prepared.attempt-view",
    eventKind: "agent-attempt-prepared",
    occurredAt: "2026-08-29T21:00:03.000Z",
    actor: { kind: "runtime", id: RUNTIME },
    subject: subject(attempt),
    payload: { activityId: ACTIVITY },
  });

  let workProduct: ControlRecordRevision | null = null;
  let receipt: ControlRecordRevision | null = null;
  let boundary: ControlRecordRevision | null = null;
  let check: ControlRecordRevision | null = null;
  if (complete) {
    const effectDigest = digest("provider-effect");
    event({
      eventId: "event.provider-intended.attempt-view",
      eventKind: "provider-effect-intended",
      occurredAt: "2026-08-29T21:00:04.000Z",
      actor: { kind: "runtime", id: RUNTIME },
      subject: subject(attempt),
      payload: { activityId: ACTIVITY, effectDigest },
    });
    event({
      eventId: "event.provider-observed.attempt-view",
      eventKind: "provider-effect-observed",
      occurredAt: "2026-08-29T21:00:05.000Z",
      actor: { kind: "runtime", id: RUNTIME },
      subject: subject(attempt),
      payload: { activityId: ACTIVITY, effectDigest, outcome: "completed" },
    });
    if (!invalidSubmission) {
      const workProductBase = validDeliveryControlPayload("agent-work-product");
      workProduct = record({
        id: "work-product.attempt-view",
        kind: "agent-work-product",
        payload: Object.freeze({
          ...workProductBase,
          profileId: "lifecycle.agent-work-product-body.reconnaissance.v4",
          role: "reconnaissance",
          disposition: "complete",
          claims: Object.freeze([Object.freeze({
            id: "claim.attempt-view",
            category: "route",
            state: "proposed",
            statement: "The selected Check supports the exact proposed Work Boundary.",
            knowledgeIds: Object.freeze(["check.demo"]),
            evidenceIds: Object.freeze(["artifact.1"]),
            paths: Object.freeze(["src/demo.ts"]),
            uncertainty: "none",
            fragmentDigest: digest("claim"),
          })]),
          citations: Object.freeze([]),
          limitations: Object.freeze([]),
          noProductReason: null,
          roleSemantics: Object.freeze({
            role: "reconnaissance",
            proposal: "work-boundary",
            conditionIds: Object.freeze([]),
            decisionIds: Object.freeze(["proposition.1"]),
            effectIds: Object.freeze([]),
            workBoundary: Object.freeze({ selectedKnowledgeIds: Object.freeze(["check.demo"]) }),
          }),
          body: Object.freeze({
            profileId: "lifecycle.agent-work-product-body.reconnaissance.v4",
            digest: digest("semantic-body"),
            fragments: Object.freeze([]),
          }),
        }),
        semanticAuthority: "agent-proposed",
        semanticAuthor: { kind: "agent", id: "reconnaissance-agent" },
        relationships: [{ relation: "result-of", target: reference(attempt) }],
      });
      event({
        eventId: "event.work-product.attempt-view",
        eventKind: "agent-work-product-submitted",
        occurredAt: "2026-08-29T21:00:06.000Z",
        actor: { kind: "runtime", id: RUNTIME },
        subject: subject(workProduct),
        payload: { activityId: ACTIVITY },
      });
    } else {
      event({
        eventId: "event.work-product-abandoned.attempt-view",
        eventKind: "agent-work-product-abandoned",
        occurredAt: "2026-08-29T21:00:06.000Z",
        actor: { kind: "runtime", id: RUNTIME },
        subject: subject(attempt),
        payload: { activityId: ACTIVITY },
      });
    }

    const submissionFailureDigest = digest("submission-failure");
    const receiptBase = validDeliveryControlPayload("execution-receipt");
    const provider = receiptBase.provider as ControlJsonObject;
    const receiptExecution = receiptBase.execution as ControlJsonObject;
    const attemptExecution = attempt.payload.execution as ControlJsonObject;
    receipt = record({
      id: "receipt.attempt-view",
      kind: "execution-receipt",
      payload: Object.freeze({
        ...receiptBase,
        activityId: ACTIVITY,
        providerEffect: Object.freeze({ effectDigest, outcome: "completed" }),
        execution: Object.freeze({
          ...receiptExecution,
          backendProfile: attemptExecution.backendProfile!,
          image: attemptExecution.image!,
          inputSet: attemptExecution.inputSet!,
          specificationDigest: effectDigest,
        }),
        productiveExecutionStarted: true,
        provider: Object.freeze({
          ...provider,
          firstTrigger: "submission",
          terminalReason: invalidSubmission ? "invalid-submission" : "valid-submission",
          stage: "evaluated",
          startedAt: "2026-08-29T21:00:04.000Z",
          finishedAt: "2026-08-29T21:00:05.000Z",
          exitCode: 0,
        }),
        workspace: Object.freeze({
          availability: "available",
          rawByteLength: 512,
          workspaceRawDigest: digest("workspace"),
          semanticMarkdownDigest: digest(invalidSubmission ? "invalid-semantic-body" : "semantic-body"),
          parseResultDigest: workProduct === null
            ? null
            : workProduct.payload.parseResultDigest ?? digest("parse-result"),
          failureFactsDigest: invalidSubmission ? submissionFailureDigest : null,
          submissionDiagnostic: invalidSubmission
            ? Object.freeze({
                code: "lifecycle.agent-work-product.invalid.title",
                stage: "template",
                factsDigest: submissionFailureDigest,
              })
            : null,
          fixedBindingSubjectDigest: workProduct === null
            ? null
            : workProduct.payload.fixedBindingSubjectDigest ?? digest("fixed-binding-subject"),
          parserDisposition: invalidSubmission ? "invalid" : "valid",
          compilerDisposition: invalidSubmission ? "not-run" : "retained",
        }),
      }),
      semanticAuthority: "runtime-observed",
      semanticAuthor: { kind: "runtime", id: RUNTIME },
      relationships: [
        { relation: "observes-attempt", target: reference(attempt) },
        ...(workProduct === null
          ? []
          : [{ relation: "observes-work-product", target: reference(workProduct) }]),
      ],
    });
    event({
      eventId: "event.receipt.attempt-view",
      eventKind: "execution-receipt-recorded",
      occurredAt: "2026-08-29T21:00:07.000Z",
      actor: { kind: "runtime", id: RUNTIME },
      subject: subject(receipt),
      payload: { activityId: ACTIVITY },
    });

    if (workProduct !== null) {
      const boundaryPayload = validDeliveryControlPayload("work-boundary");
      const boundaryMandate = boundaryPayload.mandate as ControlJsonObject;
      const originalCheck = (boundaryMandate.checks as readonly ControlJsonObject[])[0]!;
      const boundaryCheck: ControlJsonObject = options.baselinePostcondition
        ? Object.freeze({ ...originalCheck, modality: "postcondition" })
        : originalCheck;
      const boundaryBinding = (boundaryCheck.bindings as readonly ControlJsonObject[])[0]!;
      boundary = record({
        id: "boundary.attempt-view",
        kind: "work-boundary",
        payload: options.baselinePostcondition
          ? { ...boundaryPayload, mandate: { ...boundaryMandate, checks: [boundaryCheck] } }
          : boundaryPayload,
        semanticAuthority: "runtime-derived",
        semanticAuthor: { kind: "runtime", id: RUNTIME },
        relationships: [
          { relation: "uses-brief", target: reference(brief) },
          { relation: "proposed-from", target: reference(workProduct) },
        ],
      });
      event({
        eventId: "event.boundary.attempt-view",
        eventKind: "work-boundary-finalized",
        occurredAt: "2026-08-29T21:00:08.000Z",
        actor: { kind: "runtime", id: RUNTIME },
        subject: subject(boundary),
        payload: { activityId: ACTIVITY },
      });
      check = record({
        id: "check-receipt.attempt-view",
        kind: "check-receipt",
        payload: Object.freeze({
          ...validDeliveryControlPayload("check-receipt"),
          selectionId: boundaryCheck.id!,
          definition: boundaryCheck.definition!,
          binding: boundaryBinding,
          phase: "baseline",
          modality: boundaryCheck.modality!,
          ...(options.baselinePostcondition ? {
            disposition: "not-run", startedAt: null, finishedAt: null,
            reasonCode: "baseline-postcondition", notRunAuthorization: { kind: "baseline-postcondition" },
            operationalFailure: null, execution: { allocation: "not-allocated" },
            resultFacts: [{ name: "non-execution", value: "baseline-postcondition" }], rawMaterials: [],
            subjectIntegrity: "unverified",
            containment: { classification: "not-required", factsDigest: null },
            retirement: { classification: "not-required", factsDigest: null },
          } : {}),
        }),
        semanticAuthority: "runtime-observed",
        semanticAuthor: { kind: "runtime", id: RUNTIME },
        relationships: [{ relation: "checks-boundary", target: reference(boundary) }],
      });
      event({
        eventId: "event.check.attempt-view",
        eventKind: "check-receipt-recorded",
        occurredAt: "2026-08-29T21:00:09.000Z",
        actor: { kind: "runtime", id: RUNTIME },
        subject: subject(check),
        payload: { activityId: ACTIVITY },
      });
    }
    event({
      eventId: "event.activity-completed.attempt-view",
      eventKind: "activity-completed",
      occurredAt: "2026-08-29T21:00:10.000Z",
      actor: { kind: "runtime", id: RUNTIME },
      payload: { activityId: ACTIVITY, outcome: invalidSubmission ? "failed" : "completed" },
    });
  }

  const store = {
    identity,
    getRevision(recordId: string, revision: number) {
      return revisions.get(`${recordId}\u0000${revision}`) ?? null;
    },
    listEvents(afterSequence = 0, limit = 1_000) {
      return Object.freeze(events
        .filter(({ sequence }) => sequence > afterSequence)
        .slice(0, limit));
    },
    state() {
      return reduceDeliveryEvents(events, (eventSubject) =>
        revisions.get(`${eventSubject.recordId}\u0000${eventSubject.revision}`) ?? null);
    },
    getSeal() {
      return null;
    },
    append() {
      appendCalls += 1;
      throw new Error("Attempt View inspection must not append Control");
    },
  } as unknown as ControlRecordStore;
  return Object.freeze({
    store,
    attempt,
    workProduct,
    receipt,
    boundary,
    check,
    brief,
    event,
    record,
    appendCalls: () => appendCalls,
  });
}

function incompleteBuilderFixture() {
  const value = fixture(true);
  assert(value.boundary !== null);
  assert(value.check !== null);
  const admissionActivity = "activity.admit.attempt-view";
  const admissionDecision = value.record({
    id: "decision.admit.attempt-view",
    kind: "director-decision",
    payload: Object.freeze({
      ...validDeliveryControlPayload("director-decision"),
      decision: "admit",
    }),
    semanticAuthority: "director-authenticated",
    semanticAuthor: { kind: "director", id: "director-one" },
    relationships: [
      { relation: "selects-boundary", target: reference(value.boundary) },
      { relation: "selects-baseline-receipt", target: reference(value.check) },
    ],
  });
  value.event({
    eventId: "event.activity-started.admit.attempt-view",
    eventKind: "activity-started",
    occurredAt: "2026-08-29T21:00:11.000Z",
    actor: { kind: "runtime", id: RUNTIME },
    payload: { activityId: admissionActivity, operation: "delivery.admit" },
  });
  value.event({
    eventId: "event.decision.admit.attempt-view",
    eventKind: "director-decision-authenticated",
    occurredAt: "2026-08-29T21:00:12.000Z",
    actor: { kind: "runtime", id: RUNTIME },
    subject: subject(admissionDecision),
    payload: { activityId: admissionActivity },
  });
  const admissionEffectDigest = digest("admission-effect");
  value.event({
    eventId: "event.transaction-intended.admit.attempt-view",
    eventKind: "transaction-effect-intended",
    occurredAt: "2026-08-29T21:00:13.000Z",
    actor: { kind: "runtime", id: RUNTIME },
    subject: subject(admissionDecision),
    payload: { activityId: admissionActivity, effectDigest: admissionEffectDigest },
  });
  const admissionFacts = Object.freeze({
    schema: "lifecycle.admission-effect-observation-facts.v2",
    outcome: "applied",
    disposition: null,
    repositoryBasisDigest: digest("repository-basis"),
  });
  value.event({
    eventId: "event.transaction-observed.admit.attempt-view",
    eventKind: "transaction-effect-observed",
    occurredAt: "2026-08-29T21:00:14.000Z",
    actor: { kind: "runtime", id: RUNTIME },
    subject: subject(admissionDecision),
    payload: {
      activityId: admissionActivity,
      effectDigest: admissionEffectDigest,
      outcome: "applied",
      facts: admissionFacts,
      factsDigest: digestCanonical(admissionFacts),
    },
  });
  const candidate = value.record({
    id: "candidate.attempt-view",
    kind: "candidate-revision",
    payload: validDeliveryControlPayload("candidate-revision"),
    semanticAuthority: "runtime-observed",
    semanticAuthor: { kind: "runtime", id: RUNTIME },
    relationships: [{ relation: "governed-by", target: reference(value.boundary) }],
  });
  value.event({
    eventId: "event.candidate.admit.attempt-view",
    eventKind: "candidate-revision-observed",
    occurredAt: "2026-08-29T21:00:15.000Z",
    actor: { kind: "runtime", id: RUNTIME },
    subject: subject(candidate),
    payload: { activityId: admissionActivity },
  });
  value.event({
    eventId: "event.activity-completed.admit.attempt-view",
    eventKind: "activity-completed",
    occurredAt: "2026-08-29T21:00:16.000Z",
    actor: { kind: "runtime", id: RUNTIME },
    payload: { activityId: admissionActivity, outcome: "completed" },
  });

  const builderActivity = "activity.continue.attempt-view";
  const builderBrief = value.record({
    id: "brief.continue.attempt-view",
    kind: "director-brief",
    payload: { ...validDeliveryControlPayload("director-brief"), scope: { kind: "activity", activityId: builderActivity } },
    semanticAuthority: "director-supplied",
    semanticAuthor: { kind: "director", id: "director-one" },
  });
  value.event({
    eventId: "event.brief.continue.attempt-view",
    eventKind: "director-brief-submitted",
    occurredAt: "2026-08-29T21:00:17.000Z",
    actor: { kind: "runtime", id: RUNTIME },
    subject: subject(builderBrief),
    payload: { activityId: builderActivity },
  });
  value.event({
    eventId: "event.activity-started.continue.attempt-view",
    eventKind: "activity-started",
    occurredAt: "2026-08-29T21:00:18.000Z",
    actor: { kind: "runtime", id: RUNTIME },
    payload: { activityId: builderActivity, operation: "delivery.continue" },
  });
  const builderAttemptBase = currentAgentAttemptPayload();
  const builderAttempt = value.record({
    id: "attempt.continue.attempt-view",
    kind: "agent-attempt",
    payload: Object.freeze({
      ...builderAttemptBase,
      activityId: builderActivity,
      operation: "delivery.continue",
      role: "builder",
      invocationId: "invocation.continue.attempt-view",
      preDispatchStateDigest: digest("builder-pre-dispatch"),
    }),
    semanticAuthority: "runtime-derived",
    semanticAuthor: { kind: "runtime", id: RUNTIME },
    relationships: [
      { relation: "uses-brief", target: reference(builderBrief) },
      { relation: "uses-boundary", target: reference(value.boundary) },
      { relation: "uses-candidate", target: reference(candidate) },
    ],
  });
  value.event({
    eventId: "event.attempt-prepared.continue.attempt-view",
    eventKind: "agent-attempt-prepared",
    occurredAt: "2026-08-29T21:00:19.000Z",
    actor: { kind: "runtime", id: RUNTIME },
    subject: subject(builderAttempt),
    payload: { activityId: builderActivity },
  });
  return Object.freeze({ ...value, builderAttempt, candidate });
}

const ACTIVE = Object.freeze({
  disposition: "active" as const,
  archiveManifestDigest: null,
});

test("compiles one complete nonretained Attempt View from the exact Journal head", () => {
  const value = fixture(true);
  const exact = inspectDeliveryAttemptView(value.store, ACTIVE, {
    kind: "attempt",
    attemptId: value.attempt.recordId,
  });
  assert(exact !== null);
  assert.equal(exact.schema, FOUNDATION_ATTEMPT_VIEW_SCHEMA);
  assert.equal(exact.coordinate.profile.id, FOUNDATION_ATTEMPT_VIEW_PROFILE_ID);
  assert.equal(exact.coordinate.reducer.id, FOUNDATION_DELIVERY_REDUCER_ID);
  assert.equal(exact.complete, true);
  assert.equal(exact.attemptContract.role, "reconnaissance");
  assert.equal(exact.attemptContract.operation, "delivery.prepare");
  assert.equal(exact.attemptContract.provenance, "runtime-derived");
  assert.equal(
    exact.attemptContract.execution.backendProfile.profileId,
    "lifecycle.execution-backend-profile.docker-local.v1",
  );
  assert.equal(exact.attemptContract.execution.network.agentProductNetwork, "none");
  assert.equal(
    exact.attemptContract.execution.services.providerControlPlane,
    "fixed-service-channel",
  );
  assert.equal(exact.attemptContract.execution.effectiveLimits.wallTimeMilliseconds, 3_600_000);
  assert.equal(exact.attemptContract.execution.effectiveLimits.outputBytes, 1_048_576);
  assert.equal(exact.providerExecution.provenance, "runtime-observed");
  assert.equal(exact.providerExecution.effect.outcome, "completed");
  assert.equal(exact.providerExecution.receipt?.id, value.receipt?.recordId);
  assert.equal(
    exact.providerExecution.execution?.image.imageDigest,
    exact.attemptContract.execution.image.imageDigest,
  );
  assert.equal(exact.providerExecution.execution?.specificationDigest, digest("provider-effect"));
  assert.equal(exact.providerExecution.containment?.classification, "contained");
  assert.equal(exact.providerExecution.retirement?.classification, "retired");
  assert.equal(exact.agentSemantics.workProduct?.id, value.workProduct?.recordId);
  assert.equal(exact.agentSemantics.provenance, "agent-proposed");
  assert.equal(exact.candidateTransition.input, null);
  assert.equal(exact.candidateTransition.successorDisposition, null);
  assert.equal(exact.candidateTransition.successor, null);
  assert.equal(exact.coordinate.currentBoundary?.id, value.boundary?.recordId);
  assert.equal(exact.processAndProof.standing, "awaiting-admission");
  assert.equal(exact.processAndProof.provenance, "runtime-derived");
  assert.deepEqual(exact.processAndProof.eligibleOperations, [
    "delivery.admit",
    "delivery.no-ship",
  ]);
  assert.equal(exact.processAndProof.obligations.length, 1);
  assert.equal(exact.processAndProof.checks[0]?.baseline?.provenance, "runtime-observed");
  assert.equal(exact.processAndProof.checks[0]?.baseline?.proofSubject.kind, "work-boundary");
  assert.equal(exact.processAndProof.checks[0]?.baseline?.binding.id, "binding.check.demo");
  assert.equal(exact.processAndProof.obligations[0]?.standing, "satisfied-for-current-phase");
  assert.deepEqual(exact.processAndProof.obligations[0]?.relatedAgentClaimIds, [
    "claim.attempt-view",
  ]);
  assert.deepEqual(exact.processAndProof.blockers, []);
  assert.equal(value.appendCalls(), 0);

  const latest = compileFoundationAttemptView({
    store: value.store,
    physical: ACTIVE,
    selection: { kind: "latest-attempt" },
  });
  assert(latest !== null);
  assert.equal(canonicalJson(latest), canonicalJson(exact));
  assert.equal(value.appendCalls(), 0);
});

test("authorized baseline non-execution leaves final proof open without prescribing Check correction", () => {
  // This owner-adjacent retained-Control fixture exercises the read compiler,
  // not Check execution or installed qualification. The shared predicate's
  // semantic negatives remain beside Evidence assessment.
  const value = fixture(true, false, { baselinePostcondition: true });
  assert(value.check !== null && value.boundary !== null);
  assert.doesNotThrow(() => assertDeliveryControlRecordPayload(value.check!));
  const view = compileFoundationAttemptView({
    store: value.store, physical: ACTIVE, selection: { kind: "latest-attempt" },
  });
  assert(view !== null);
  const check = view.processAndProof.checks[0]!;
  assert.equal(check.modality, "postcondition");
  assert.equal(check.baselineRequired, true);
  assert.equal(check.finalRequired, true);
  assert.equal(check.baseline?.disposition, "not-run");
  assert.equal(check.baseline?.reference.digest, value.check.digest);
  assert.equal(check.baseline?.proofSubject.digest, value.boundary.digest);
  assert.equal(check.baseline?.reasonCode, "baseline-postcondition");
  assert.equal(check.baseline?.execution, null);
  assert.equal(check.final, null);
  assert.equal(check.freshExecutionRequired, true, "The baseline does not replace a final Check");
  assert.equal(view.processAndProof.obligations[0]?.standing, "satisfied-for-current-phase");
  assert.equal(view.processAndProof.obligations[0]?.establishmentRoute, "none");
  assert.equal(view.processAndProof.obligations[0]?.blocking, false);
  assert.equal(view.processAndProof.standing, "awaiting-admission");
  assert.deepEqual(view.processAndProof.eligibleOperations, ["delivery.admit", "delivery.no-ship"]);
  assert.deepEqual(view.processAndProof.blockers, []);
  assert.equal(Object.hasOwn(view, "authorizedBaselineReceiptDigests"), false);
  assert.equal(Object.hasOwn(view.processAndProof, "authorizedBaselineReceiptDigests"), false);
  assert.equal(Object.hasOwn(check, "authorizedBaselineReceiptDigests"), false);
  assert.equal(value.appendCalls(), 0);
});

test("returns an explicitly incomplete recovery view without manufacturing a Receipt", () => {
  const value = fixture(false);
  const view = compileFoundationAttemptView({
    store: value.store,
    physical: ACTIVE,
    selection: { kind: "latest-attempt" },
  });
  assert(view !== null);
  assert.equal(view.complete, false);
  assert.equal(view.providerExecution.receipt, null);
  assert.equal(
    view.attemptContract.execution.backendProfile.profileId,
    "lifecycle.execution-backend-profile.docker-local.v1",
  );
  assert.equal(view.attemptContract.execution.network.agentProductNetwork, "none");
  assert.equal(view.providerExecution.execution, null);
  assert.equal(view.agentSemantics.workProduct, null);
  assert.equal(view.coordinate.activeActivity?.recovery?.resumesAt, "provider-effect-intended");
  assert.deepEqual(view.processAndProof.eligibleOperations, ["delivery.recover"]);
  assert.deepEqual(view.processAndProof.obligations, []);
  assert.equal(view.diagnostics.length, 1);
  assert.equal(view.diagnostics[0]?.code, "lifecycle.attempt-view.incomplete");
  assert.equal(value.appendCalls(), 0);
});

test("keeps an interrupted builder transition null until one terminal Candidate disposition exists", () => {
  const value = incompleteBuilderFixture();
  const view = compileFoundationAttemptView({
    store: value.store,
    physical: ACTIVE,
    selection: { kind: "attempt", attemptId: value.builderAttempt.recordId },
  });
  assert(view !== null);
  assert.equal(view.complete, false);
  assert.equal(view.attemptContract.role, "builder");
  assert.equal(view.attemptContract.operation, "delivery.continue");
  assert.equal(view.providerExecution.receipt, null);
  assert.equal(view.candidateTransition.input?.revision.digest, value.candidate.digest);
  assert.equal(view.candidateTransition.successorDisposition, null);
  assert.equal(view.candidateTransition.successor, null);
  assert.equal(view.candidateTransition.current?.revision.digest, value.candidate.digest);
  assert.equal(view.coordinate.activeActivity?.recovery?.resumesAt, "provider-effect-intended");
  assert.deepEqual(view.processAndProof.eligibleOperations, ["delivery.recover"]);
  assert.equal(view.diagnostics.length, 1);
  assert.equal(view.diagnostics[0]?.code, "lifecycle.attempt-view.incomplete");
  assert.equal(value.appendCalls(), 0);
});

test("keeps a fully observed invalid submission complete with its exact nested diagnostic", () => {
  const value = fixture(true, true);
  const view = compileFoundationAttemptView({
    store: value.store,
    physical: ACTIVE,
    selection: { kind: "latest-attempt" },
  });
  assert(view !== null);
  assert.equal(view.complete, true);
  assert.equal(view.agentSemantics.workProduct, null);
  assert.deepEqual(view.agentSemantics.submissionDiagnostics, {
    parserDisposition: "invalid",
    compilerDisposition: "not-run",
    failureFactsDigest: digest("submission-failure"),
    diagnostic: {
      code: "lifecycle.agent-work-product.invalid.title",
      stage: "template",
      factsDigest: digest("submission-failure"),
    },
  });
  assert.deepEqual(view.diagnostics, []);
  assert.deepEqual(view.processAndProof.eligibleOperations, ["delivery.no-ship"]);
  assert.equal(value.appendCalls(), 0);
});

test("fails closed when an exact Attempt selection is unavailable", () => {
  const value = fixture(true);
  assert.throws(() => compileFoundationAttemptView({
    store: value.store,
    physical: ACTIVE,
    selection: { kind: "attempt", attemptId: "attempt.absent" },
  }), (error: unknown) => error instanceof Error &&
    error.message.includes("No exact Agent Attempt attempt.absent"));
  assert.equal(value.appendCalls(), 0);
});
