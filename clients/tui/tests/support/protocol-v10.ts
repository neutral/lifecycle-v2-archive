import {
  createFoundationRuntimeOperationRequest,
  createFoundationRuntimeOperationResult,
  FoundationAttemptViewSchema,
  FoundationControlRevisionSchema,
  FoundationDeliveryGenerationSchema,
  FoundationDeliveryInboxSchema,
  FoundationDeliveryViewSchema,
  FoundationRuntimeObservationSchema,
  selfDigestFoundationCarrier,
  type FoundationControlRecordKind,
  type FoundationControlRevision,
  type FoundationAttemptView,
  type FoundationDeliveryOperation,
  type FoundationDeliveryGeneration,
  type FoundationDeliveryInbox,
  type FoundationDeliveryState,
  type FoundationDeliveryView,
  type FoundationRepositoryAtlasObservation,
  type FoundationRuntimeObservation,
  type FoundationRuntimeOperationResult,
  type FoundationSha256,
} from "@neutral/lifecycle-protocol";
import type {
  FoundationAttemptViewResult,
  FoundationDeliveryViewResult,
  FoundationInboxOperationResult,
  FoundationPrepareResult,
  FoundationStatusResult,
} from "../../src/adapters/cli/transport.js";

export const TEST_OBSERVED_AT = "2026-08-29T18:00:00.000Z";
export const TEST_REPOSITORY_HEAD = "a".repeat(40);
export const TEST_DELIVERY_ID = "delivery-tui-v10";

export function testDigest(character: string): FoundationSha256 {
  return `sha256:${character.repeat(64)}` as FoundationSha256;
}

export function testAtlasObservation(): FoundationRepositoryAtlasObservation {
  return Object.freeze({
    selection: Object.freeze({
      release: "0.7.0",
      specificationRevision: "429fee62966f4d30e91ec2a15d27ecf353f5d68f",
      authoredFormat: 1,
      processorRevision: "746cbce73c51b28d617b96ca08f18d498ac749c4",
      validationProfile: "neutral.atlas-validator.resolved",
      validationResultSchema: "urn:atlas:schema:validation-result:1",
      normalizedModelSchema: "urn:atlas:schema:normalized:1",
      consumerProfile: "lifecycle.atlas-consumer.v1",
    }),
    processor: Object.freeze({
      id: "atlas-reference-validator",
      version: "0.7.0",
      implementationDigest: testDigest("6"),
    }),
    stateDigest: testDigest("3"),
    resolutionDigest: testDigest("7"),
    normalizedModelDigest: testDigest("8"),
    resourceBindingsDigest: testDigest("9"),
    complete: true,
    valid: true,
  });
}

export function testReference<Kind extends FoundationControlRecordKind>(kind: Kind, id: string, character: string): Readonly<{
  kind: Kind;
  id: string;
  revision: number;
  digest: FoundationSha256;
}> {
  return Object.freeze({ kind, id, revision: 1, digest: testDigest(character) });
}

export function testControlRevision(): FoundationControlRevision {
  const source = {
    schema: "lifecycle.control-record-revision.v1" as const,
    processId: TEST_DELIVERY_ID,
    recordId: "boundary-proposed-v10",
    recordKind: "work-boundary" as const,
    revision: 1,
    producer: { kind: "runtime" as const, id: "foundation-runtime-v10" },
    semanticAuthor: { kind: "founder" as const, id: "founder-test" },
    semanticAuthority: "founder-supplied" as const,
    createdAt: TEST_OBSERVED_AT,
    semanticMarkdown: "## Objective\n\nImplement the bounded target change.",
    payload: { objective: "Implement the bounded target change." },
    relationships: [],
  };
  return FoundationControlRevisionSchema.parse({
    ...source,
    digest: selfDigestFoundationCarrier(source),
  });
}

const operationsForStanding: Readonly<Record<FoundationDeliveryState["standing"], readonly FoundationDeliveryOperation[]>> = Object.freeze({
  framing: ["delivery.prepare"],
  "awaiting-admission": ["delivery.admit", "delivery.no-ship"],
  active: ["delivery.continue", "delivery.evaluate", "delivery.no-ship"],
  "boundary-paused": ["delivery.revise", "delivery.reaffirm", "delivery.no-ship"],
  "awaiting-readmission": ["delivery.admit", "delivery.no-ship"],
  "decision-ready": ["delivery.accept", "delivery.no-ship"],
  closed: [],
});

export type TestDeliveryOptions = Readonly<{
  id?: string;
  standing?: FoundationDeliveryState["standing"];
  candidatePresent?: boolean;
  candidateCondition?: FoundationDeliveryState["candidateCondition"];
  eligibleOperations?: readonly FoundationDeliveryOperation[];
  activities?: FoundationDeliveryState["activities"];
  recovery?: FoundationDeliveryState["recovery"];
}>;

export function testDelivery(options: TestDeliveryOptions = {}): FoundationDeliveryState {
  const standing = options.standing ?? "framing";
  const hasActiveBoundary = !["framing", "awaiting-admission"].includes(standing);
  const hasCandidate = options.candidatePresent ?? hasActiveBoundary;
  const candidate = hasCandidate ? testReference("candidate-revision", "candidate-tui-v10", "7") : null;
  const candidateCondition = !hasCandidate
    ? "absent"
    : standing === "closed"
      ? "accepted"
      : standing === "decision-ready"
      ? "ready-for-decision"
      : standing === "boundary-paused" || standing === "awaiting-readmission"
        ? "paused-for-boundary"
        : standing === "active"
          ? "in-progress"
          : standing === "awaiting-admission"
            ? "absent"
            : "absent";
  return Object.freeze({
    schema: "lifecycle.delivery-reduction.v2",
    storeId: options.id ?? TEST_DELIVERY_ID,
    processId: options.id ?? TEST_DELIVERY_ID,
    standing,
    candidateCondition: options.candidateCondition ?? candidateCondition,
    activities: options.activities ?? [],
    recovery: options.recovery ?? null,
    subjects: Object.freeze({
      proposedBoundary: ["framing", "awaiting-admission"].includes(standing) ? testReference("work-boundary", "boundary-proposed-v10", "5") : null,
      activeBoundary: hasActiveBoundary ? testReference("work-boundary", "boundary-active-v10", "6") : null,
      candidate,
      materialCondition: standing === "boundary-paused" ? testReference("material-condition", "condition-tui-v10", "8") : null,
      seal: hasCandidate && ["decision-ready", "closed"].includes(standing) ? testReference("candidate-seal", "seal-tui-v10", "9") : null,
      evidence: hasCandidate && ["decision-ready", "closed"].includes(standing) ? testReference("evidence-packet", "evidence-tui-v10", "b") : null,
      closure: standing === "closed" ? testReference("closure", "closure-tui-v10", "c") : null,
    }),
    journal: Object.freeze({ eventCount: 1, headSequence: 1, headDigest: testDigest("d") }),
    storeDisposition: Object.freeze({ stage: standing === "closed" ? "sealed" : "active", integrity: "verified", sealSubjectDigest: standing === "closed" ? testDigest("e") : null, archiveManifestDigest: null }),
    eligibleOperations: [...(options.eligibleOperations ?? operationsForStanding[standing])],
  });
}

export type TestObservationOptions = Readonly<{
  targetId?: string | null;
  initialized?: boolean;
  delivery?: FoundationDeliveryState | null;
}>;

export function testObservation(options: TestObservationOptions = {}): FoundationRuntimeObservation {
  const initialized = options.initialized ?? true;
  return FoundationRuntimeObservationSchema.parse({
    schema: "lifecycle.foundation-runtime-observation.v10",
    observedAt: TEST_OBSERVED_AT,
    repository: {
      schema: "lifecycle.repository-observation.v10", initialized, valid: initialized,
      targetId: initialized ? (options.targetId ?? "target-tui-v10") : null,
      repositoryContract: initialized ? "lifecycle.repository.v15" : null,
      repositoryContractDigest: initialized ? testDigest("1") : null,
      headCommit: initialized ? TEST_REPOSITORY_HEAD : null, headTree: initialized ? "b".repeat(40) : null,
      productDigest: initialized ? testDigest("2") : null, atlas: initialized ? testAtlasObservation() : null,
      knowledgeDigest: initialized ? testDigest("4") : null, checkBindingsDigest: initialized ? testDigest("5") : null,
    },
    delivery: options.delivery === undefined ? testDelivery() : options.delivery,
  });
}

export function testGeneration(
  state: FoundationDeliveryState = testDelivery(),
): FoundationDeliveryGeneration {
  const activity = state.activities.find(({ stage }) => stage !== "completed") ?? null;
  const activeOperation: FoundationDeliveryGeneration["activeOperation"] = activity === null
    ? null
    : {
        activityId: activity.id,
        operation: activity.operation,
        stage: state.recovery !== null
          ? "recovery"
          : activity.family === "transaction"
            ? "transaction"
            : activity.stage === "effect-intended"
              ? "provider-running"
              : activity.stage === "effect-observed"
                ? "semantic-result-observed"
                : activity.stage === "submitted" || activity.stage === "finalizing"
                  ? "completion"
                  : "attempt-preparation",
      };
  const source = {
    schema: "lifecycle.delivery-generation.v1" as const,
    storeId: state.storeId,
    processId: state.processId,
    journal: state.journal,
    storeDisposition: state.storeDisposition,
    repository: {
      headCommit: TEST_REPOSITORY_HEAD,
      headTree: "b".repeat(40),
      repositoryContractDigest: testDigest("1"),
    },
    activeOperation,
  };
  return FoundationDeliveryGenerationSchema.parse({
    ...source,
    digest: selfDigestFoundationCarrier(source),
  });
}

export function testDeliveryView(
  state: FoundationDeliveryState = testDelivery({ standing: "awaiting-admission" }),
): FoundationDeliveryView {
  const generation = testGeneration(state);
  const nextOperations = state.eligibleOperations.filter((operation): operation is
    "delivery.continue" | "delivery.evaluate" | "delivery.revise" | "delivery.reaffirm" => [
      "delivery.continue",
      "delivery.evaluate",
      "delivery.revise",
      "delivery.reaffirm",
    ].includes(operation));
  return FoundationDeliveryViewSchema.parse({
    schema: "lifecycle.delivery-view.v1",
    generation,
    state,
    currentSubjects: state.subjects,
    semantics: {
      outcome: {
        disposition: "bounded-plan",
        summary: "The target is understood and one bounded implementation route is ready.",
        uncertainty: "bounded",
      },
      claims: [{ id: "claim.route", statement: "The current route is bounded.", uncertainty: "bounded" }],
      proposedEffects: [{ id: "effect.route", statement: "Implement the admitted change.", uncertainty: "bounded" }],
      limitations: [{ id: "limitation.review", statement: "Independent evaluation remains required.", uncertainty: "bounded" }],
      requiredChecks: [{ selectionId: "check.test", statement: "Run the exact test selection.", status: "not-run" }],
      boundaryProposal: state.subjects.proposedBoundary === null ? null : {
        reference: state.subjects.proposedBoundary,
        proposalKind: "initial",
        objective: "Implement the bounded target change.",
      },
    },
    nextPass: nextOperations.map((operation) => ({
      operation,
      eligible: true,
      role: operation === "delivery.continue"
        ? "builder"
        : operation === "delivery.evaluate"
          ? "reviewer"
          : "reconnaissance",
      boundary: state.subjects.activeBoundary,
      candidate: state.subjects.candidate,
      consequence: `Run ${operation} against the exact current Delivery generation.`,
      investment: {
        freshness: "fresh-on-invocation",
        model: "gpt-5.6-codex",
        reasoning: "high",
        wallTimeMs: 120_000,
        maximumOutputBytes: 65_536,
      },
    })),
    decisionReadiness: {
      boundary: state.subjects.activeBoundary,
      candidate: state.subjects.candidate,
      changedSubjects: [],
      seal: state.subjects.seal,
      checks: [],
      reviewerFindings: [],
      uncertainty: "bounded",
      limitations: [],
      evidence: state.subjects.evidence,
      evidenceReadiness: state.standing === "decision-ready" ? "acceptance-ready" : null,
      terminalChoices: state.eligibleOperations.filter((operation) =>
        operation === "delivery.accept" || operation === "delivery.no-ship"),
    },
    activity: generation.activeOperation,
    controlFamilies: [],
  });
}

export function testInbox(
  state: FoundationDeliveryState = testDelivery({ standing: "awaiting-admission" }),
): FoundationDeliveryInbox {
  const generation = testGeneration(state);
  const source = {
    schema: "lifecycle.delivery-inbox.v1" as const,
    targetId: "target-tui-v10",
    rows: [{
      status: "available" as const,
      deliveryId: state.processId,
      label: "Bounded test Delivery",
      standing: state.standing,
      candidateCondition: state.candidateCondition,
      activity: null,
      attentionOwner: state.standing === "awaiting-admission" ? "founder" as const : "none" as const,
      evidenceReadiness: state.standing === "decision-ready" ? "acceptance-ready" as const : null,
      recoveryRequired: state.recovery !== null,
      latestMilestone: {
        sequence: 1,
        eventKind: "delivery-created",
        occurredAt: TEST_OBSERVED_AT,
        digest: testDigest("d"),
      },
      generation,
    }],
    nextAfterDeliveryId: null,
    generation: testDigest("e"),
  };
  return FoundationDeliveryInboxSchema.parse(source);
}

function result(operation: "delivery.status" | "delivery.prepare", observation: FoundationRuntimeObservation, deliveryId: string | null): FoundationRuntimeOperationResult {
  const request = operation === "delivery.status"
    ? createFoundationRuntimeOperationRequest({ target: "/placeholder", operation, deliveryId: deliveryId ?? TEST_DELIVERY_ID, input: null })
    : createFoundationRuntimeOperationRequest({ target: "/placeholder", operation, input: { semanticMarkdown: "# Complete fresh brief" } });
  return createFoundationRuntimeOperationResult({ request, observedAt: TEST_OBSERVED_AT, status: "completed", targetId: observation.repository.targetId, deliveryId, observation, changes: { repository: { changed: false, beforeCommit: null, afterCommit: null }, candidate: { changed: false, before: null, after: null }, control: { advanced: false, beforeHead: null, afterHead: null } } });
}

export function testStatusResult(options: Readonly<{ target?: string; deliveryId?: string; observation?: FoundationRuntimeObservation }> = {}): FoundationStatusResult {
  const observation = options.observation ?? testObservation();
  const deliveryId = options.deliveryId ?? observation.delivery?.processId ?? TEST_DELIVERY_ID;
  return result("delivery.status", observation, deliveryId);
}

export function testPrepareResult(options: Readonly<{ target?: string; input?: string; observation?: FoundationRuntimeObservation; deliveryId?: string }> = {}): FoundationPrepareResult {
  const observation = options.observation ?? testObservation({ delivery: testDelivery({ standing: "awaiting-admission" }) });
  return result("delivery.prepare", observation, options.deliveryId ?? observation.delivery?.processId ?? TEST_DELIVERY_ID);
}

export function testInboxResult(
  state: FoundationDeliveryState = testDelivery({ standing: "awaiting-admission" }),
): FoundationInboxOperationResult {
  const observation = testObservation({ delivery: null });
  const request = createFoundationRuntimeOperationRequest({
    target: "/placeholder",
    operation: "delivery.inbox",
    input: { afterDeliveryId: null, limit: 100 },
  });
  return createFoundationRuntimeOperationResult({
    request,
    observedAt: TEST_OBSERVED_AT,
    status: "completed",
    targetId: observation.repository.targetId,
    deliveryId: null,
    observation,
    changes: {
      repository: { changed: false, beforeCommit: null, afterCommit: null },
      candidate: { changed: false, before: null, after: null },
      control: { advanced: false, beforeHead: null, afterHead: null },
    },
    value: { kind: "inbox", view: testInbox(state) },
  });
}

export function testDeliveryViewResult(
  state: FoundationDeliveryState = testDelivery({ standing: "awaiting-admission" }),
): FoundationDeliveryViewResult {
  const observation = testObservation({ delivery: state });
  const request = createFoundationRuntimeOperationRequest({
    target: "/placeholder",
    deliveryId: state.processId,
    operation: "delivery.inspect",
    input: { kind: "delivery-view" },
  });
  return createFoundationRuntimeOperationResult({
    request,
    observedAt: TEST_OBSERVED_AT,
    status: "completed",
    targetId: observation.repository.targetId,
    deliveryId: state.processId,
    observation,
    changes: {
      repository: { changed: false, beforeCommit: null, afterCommit: null },
      candidate: { changed: false, before: null, after: null },
      control: { advanced: false, beforeHead: null, afterHead: null },
    },
    value: { kind: "delivery-view", view: testDeliveryView(state) },
  });
}

export function testAttemptView(): FoundationAttemptView {
  const attempt = Object.freeze({
    kind: "agent-attempt" as const,
    id: "attempt-tui-v10",
    revision: 1,
    digest: testDigest("6"),
  });
  const workProduct = testReference("agent-work-product", "work-product-tui-v10", "7");
  const receipt = testReference("execution-receipt", "receipt-tui-v10", "8");
  const brief = testReference("founder-brief", "brief-tui-v10", "9");
  const boundary = testReference("work-boundary", "boundary-proposed-v10", "5");
  const executionSelection = Object.freeze({
    backendProfile: Object.freeze({
      profileId: "lifecycle.execution-backend-profile.docker-local.v1" as const,
      profileDigest: testDigest("a"),
      implementationDigest: testDigest("b"),
    }),
    image: Object.freeze({ imageId: "execution-image-tui-v10", imageDigest: testDigest("c") }),
    inputSet: Object.freeze({ profileId: "lifecycle.execution-input-set.v1" as const, digest: testDigest("e") }),
    network: Object.freeze({ agentProductNetwork: "none" as const, separationRequired: true as const }),
    services: Object.freeze({ providerControlPlane: "fixed-service-channel" as const }),
    effectiveLimits: Object.freeze({
      wallTimeMilliseconds: 3_600_000,
      processes: 128,
      storageBytes: 1_073_741_824,
      outputEntries: 100_000,
      outputBytes: 1_048_576,
      outputEntryBytes: 1_048_576,
      events: 1_000_000,
    }),
  });
  const execution = Object.freeze({
    ...executionSelection,
    specificationDigest: testDigest("d"),
    runnerDigest: testDigest("f"),
    observationDigest: testDigest("0"),
    outputManifest: Object.freeze({ availability: "retrieved" as const, digest: testDigest("1") }),
  });
  const containment = Object.freeze({ classification: "contained" as const, factsDigest: testDigest("2") });
  const retirement = Object.freeze({ classification: "retired" as const, factsDigest: testDigest("3") });
  return FoundationAttemptViewSchema.parse({
    schema: "lifecycle.attempt-view.v1",
    complete: true,
    coordinate: Object.freeze({
      storeId: TEST_DELIVERY_ID,
      processId: TEST_DELIVERY_ID,
      journal: Object.freeze({ headSequence: 1, headDigest: testDigest("d") }),
      attempt,
      reducer: Object.freeze({ id: "lifecycle.delivery-reducer.foundation-v2", digest: testDigest("a") }),
      profile: Object.freeze({ id: "lifecycle.attempt-view.foundation-v1", digest: testDigest("b") }),
      currentBoundary: boundary,
      currentCandidate: null,
      activeActivity: null,
    }),
    attemptContract: Object.freeze({
      provenance: "runtime-derived",
      activityId: "activity-tui-v10",
      operation: "delivery.prepare",
      role: "reconnaissance",
      invocationId: "invocation-tui-v10",
      preDispatchStateDigest: testDigest("c"),
      brief,
      boundary: null,
      candidate: null,
      seal: null,
      projection: Object.freeze({ id: "projection-tui-v10", digest: testDigest("1") }),
      capability: Object.freeze({ profileId: "capability-tui-v10" }),
      investment: Object.freeze({ id: "investment-tui-v10" }),
      provider: Object.freeze({ adapter: "lifecycle.provider-adapter.v6" }),
      authoring: Object.freeze({ templateProfileId: "template-tui-v10" }),
      input: Object.freeze({ contentInventoryDigest: testDigest("2") }),
      execution: executionSelection,
    }),
    providerExecution: Object.freeze({
      provenance: "runtime-observed",
      receipt,
      effect: Object.freeze({ intended: true, observed: true, digest: testDigest("d"), outcome: "completed" }),
      productiveExecutionStarted: true,
      provider: Object.freeze({ terminalReason: "valid-submission" }),
      execution,
      containment,
      retirement,
    }),
    agentSemantics: Object.freeze({
      workProduct,
      provenance: "agent-proposed",
      disposition: "complete",
      summary: Object.freeze({
        text: "The target is understood and one bounded implementation route is ready for admission.",
        fragmentDigest: testDigest("5"),
      }),
      uncertainty: Object.freeze({ level: "bounded", itemIds: Object.freeze([]) }),
      claims: Object.freeze([]),
      citations: Object.freeze([]),
      limitations: Object.freeze([]),
      noProductReason: null,
      roleSemantics: Object.freeze({
        role: "reconnaissance",
        proposal: "work-boundary",
        conditionIds: Object.freeze([]),
        decisionIds: Object.freeze(["decision.route"]),
        effectIds: Object.freeze([]),
        workBoundary: Object.freeze({
          objective: Object.freeze({ interpretation: "Implement the bounded target change." }),
          obligations: Object.freeze([Object.freeze({ id: "obligation.route", statement: "Preserve exact behavior." })]),
        }),
      }),
      body: Object.freeze({ profileId: "lifecycle.agent-work-product-body.reconnaissance.v2", digest: testDigest("6"), fragments: Object.freeze([]) }),
      submissionDiagnostics: Object.freeze({
        parserDisposition: "valid",
        compilerDisposition: "retained",
        failureFactsDigest: null,
        diagnostic: null,
      }),
    }),
    candidateTransition: Object.freeze({
      role: "reconnaissance",
      observationProvenance: "runtime-observed",
      currentProvenance: "runtime-derived",
      input: null,
      successorDisposition: null,
      successor: null,
      current: null,
      candidateBaseCommit: null,
      contentDisposition: null,
      changedSubjects: Object.freeze([]),
      invalidatedSeal: null,
      invalidatedEvidence: null,
      failureFactsDigest: null,
      limitations: Object.freeze([]),
    }),
    processAndProof: Object.freeze({
      provenance: "runtime-derived",
      standing: "awaiting-admission",
      candidateCondition: "absent",
      proposedBoundary: boundary,
      activeBoundary: null,
      materialCondition: null,
      seal: null,
      evidence: null,
      checks: Object.freeze([]),
      obligations: Object.freeze([]),
      blockers: Object.freeze([]),
      eligibleOperations: Object.freeze(["delivery.admit", "delivery.no-ship"]),
    }),
    diagnostics: Object.freeze([]),
  });
}

export function testBuilderAttemptView(): FoundationAttemptView {
  const view = testAttemptView();
  const inputRevision = testReference("candidate-revision", "candidate-input-tui-v10", "4");
  const successorRevision = testReference("candidate-revision", "candidate-successor-tui-v10", "5");
  const input = Object.freeze({
    revision: inputRevision,
    carrierManifestDigest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  });
  const successor = Object.freeze({ revision: successorRevision, carrierManifestDigest: testDigest("7") });
  return FoundationAttemptViewSchema.parse({
    ...view,
    coordinate: {
      ...view.coordinate,
      currentCandidate: successorRevision,
    },
    attemptContract: {
      ...view.attemptContract,
      operation: "delivery.continue",
      role: "builder",
      boundary: view.processAndProof.proposedBoundary,
      candidate: input,
    },
    agentSemantics: {
      ...view.agentSemantics,
      roleSemantics: { role: "builder", proposal: "candidate-successor" },
    },
    candidateTransition: {
      ...view.candidateTransition,
      role: "builder",
      input,
      successorDisposition: "promoted",
      successor,
      current: successor,
      candidateBaseCommit: TEST_REPOSITORY_HEAD,
      contentDisposition: "changed",
    },
    processAndProof: {
      ...view.processAndProof,
      standing: "active",
      candidateCondition: "ready-for-work",
      proposedBoundary: null,
      activeBoundary: view.processAndProof.proposedBoundary,
      eligibleOperations: ["delivery.continue", "delivery.evaluate", "delivery.no-ship"],
    },
  });
}

export function testAttemptViewResult(options: Readonly<{
  empty?: boolean;
  observation?: FoundationRuntimeObservation;
}> = {}): FoundationAttemptViewResult {
  const observation = options.observation ?? testObservation({
    delivery: testDelivery({
      standing: options.empty === true ? "framing" : "awaiting-admission",
    }),
  });
  const deliveryId = observation.delivery?.processId ?? TEST_DELIVERY_ID;
  const request = createFoundationRuntimeOperationRequest({
    target: "/placeholder",
    deliveryId,
    operation: "delivery.inspect",
    input: { kind: "attempt-view", selection: { kind: "latest-attempt" } },
  });
  return createFoundationRuntimeOperationResult({
    request,
    observedAt: TEST_OBSERVED_AT,
    status: "completed",
    targetId: observation.repository.targetId,
    deliveryId,
    observation,
    changes: {
      repository: { changed: false, beforeCommit: null, afterCommit: null },
      candidate: { changed: false, before: null, after: null },
      control: { advanced: false, beforeHead: null, afterHead: null },
    },
    value: { kind: "attempt-view", view: options.empty === true ? null : testAttemptView() },
  });
}
