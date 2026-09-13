import type {
  ExplorationCommand,
  ExplorationScenario,
  ExplorationSeed,
} from "./bounded-explorer.js";
import {
  admissionOracle,
  integrationOracle,
  deliveryInvariants,
  noShipOracle,
  preparationOracle,
  preIntentRefusalOracle,
  projectionRefusalOracle,
  builderProjectionRefusalOracle,
  recoveryProgressionModels,
  recoveryProgressionOracle,
  routeOpeningModels,
  routeOpeningOracle,
  type DeliveryOracle,
  type DeliveryOracleModel,
} from "./delivery-oracle.js";
import {
  EventChain,
  admitSuccessful,
  integrateSuccessful,
  integrationAssessmentFacts,
  attemptFacts,
  boundaryFacts,
  candidateRevisionV2Payload,
  checkFacts,
  closurePayload,
  effect,
  normalizeReducerState,
  prepareSuccessful,
  reduceChain,
  relationship,
  subject,
  type RevisionFacts,
} from "./delivery-reducer-fixture.js";
import type {
  ControlJsonObject,
  ControlRecordEventSubject,
  ControlRecordRelationship,
} from "../../../src/foundation/control/types.js";
import { digestCanonical, type Sha256 } from "../../../src/foundation/validation/canonical.js";
import { deliveryProperties } from "./delivery-properties.js";
import { continuationFindings, continuationModel, type DeliveryContinuationGoal } from "./delivery-continuation-oracle.js";
import { workDelegationFindings, workDelegationOracle } from "./delivery-work-delegation-oracle.js";

function explicitFacts(
  recordKind: string,
  payload: ControlJsonObject = {},
  relationships: readonly ControlRecordRelationship[] = [],
): RevisionFacts {
  return Object.freeze({
    recordKind,
    payload: Object.freeze(payload),
    relationships: Object.freeze(relationships),
  });
}

function recoveryCoordinates(
  state: ReturnType<typeof reduceChain>,
): readonly string[] {
  return Object.freeze(state.activities.flatMap((activity) =>
    activity.recovery === null
      ? []
      : [`${activity.recovery.kind}/${activity.recovery.resumesAt}`]));
}

function semanticState(normalizedState: ReturnType<typeof normalizeReducerState>) {
  return Object.freeze({
    standing: normalizedState.standing,
    candidateCondition: normalizedState.candidateCondition,
    activities: Object.freeze(normalizedState.activities.map((activity) => Object.freeze({
      operation: activity.operation,
      family: activity.family,
      stage: activity.stage,
      recovery: activity.recovery,
    }))),
    subjects: Object.freeze(Object.fromEntries(
      Object.entries(normalizedState.subjects).map(([name, value]) => [name, value !== null]),
    )),
    eligibleOperations: normalizedState.eligibleOperations,
  });
}

export function observeDeliverySystem(system: EventChain, seedEventCount = 0) {
  const state = reduceChain(system);
  const normalizedState = normalizeReducerState(state);
  const eventKinds = system.events.map(({ eventKind }) => eventKind);
  return Object.freeze({
    ...normalizedState,
    delegation: state.delegation,
    normalizedState,
    normalizedSemantic: semanticState(normalizedState),
    journal: Object.freeze({ ...state.journal }),
    eventKinds: Object.freeze(eventKinds),
    seedEventKinds: Object.freeze(eventKinds.slice(0, seedEventCount)),
    generatedEventKinds: Object.freeze(eventKinds.slice(seedEventCount)),
    recoveryCoordinates: recoveryCoordinates(state),
  });
}

export type DeliverySystemObservation = ReturnType<typeof observeDeliverySystem>;

export function fingerprintDeliverySystem(system: EventChain) {
  return Object.freeze({
    storeId: system.storeId,
    processId: system.processId,
    events: Object.freeze(system.events.map((event) => event.digest)),
    revisions: Object.freeze([...system.revisions]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, revision]) => Object.freeze({ key, digest: revision.digest }))),
  });
}

type CommandHandler = (chain: EventChain) => void;

function bindCommands(
  oracle: DeliveryOracle,
  handlers: Readonly<Record<string, CommandHandler>>,
): readonly ExplorationCommand<EventChain, DeliveryOracleModel>[] {
  const expectedIds = new Set(oracle.commands.map(({ id }) => id));
  const extraIds = Object.keys(handlers).filter((id) => !expectedIds.has(id));
  if (extraIds.length > 0) {
    throw new TypeError(
      `Scenario ${oracle.id} has extra adapter commands ${extraIds.sort().join(", ")}`,
    );
  }
  return Object.freeze(oracle.commands.map((command) => {
    const apply = handlers[command.id];
    if (apply === undefined) {
      throw new TypeError(`Scenario ${oracle.id} omits adapter command ${command.id}`);
    }
    return Object.freeze({
      id: command.id,
      expectation: command.expectation,
      apply,
    });
  }));
}

type DeliveryScenario = ExplorationScenario<
  EventChain,
  DeliveryOracleModel,
  DeliverySystemObservation
>;

function scenarioWithSeeds(
  oracle: DeliveryOracle,
  seeds: readonly ExplorationSeed<EventChain, DeliveryOracleModel>[],
  commands: readonly ExplorationCommand<EventChain, DeliveryOracleModel>[],
): DeliveryScenario {
  const retainedSeeds = Object.freeze(seeds.map((seed) => Object.freeze({ ...seed })));
  const seedEventCounts = new Map<string, number>();
  for (const seed of retainedSeeds) {
    if (seedEventCounts.has(seed.system.processId)) {
      throw new TypeError(
        `Scenario ${oracle.id} repeats seed Process identity ${seed.system.processId}`,
      );
    }
    seedEventCounts.set(seed.system.processId, seed.system.events.length);
  }
  return Object.freeze({
    id: oracle.id,
    clauses: oracle.clauses,
    bounds: oracle.bounds,
    requiredCoverage: oracle.requiredCoverage,
    seeds: retainedSeeds,
    commands,
    observe(system: EventChain) {
      const seedEventCount = seedEventCounts.get(system.processId);
      if (seedEventCount === undefined) {
        throw new TypeError(
          `Scenario ${oracle.id} has no seed coordinate for ${system.processId}`,
        );
      }
      return observeDeliverySystem(system, seedEventCount);
    },
    invariants: ({ model, observation }) => deliveryInvariants({ model, observation }),
    fingerprint: fingerprintDeliverySystem,
  });
}

function scenario(
  oracle: DeliveryOracle,
  seedId: string,
  system: EventChain,
  commands: readonly ExplorationCommand<EventChain, DeliveryOracleModel>[],
): DeliveryScenario {
  return scenarioWithSeeds(
    oracle,
    [Object.freeze({ id: seedId, system, model: oracle.initialModel })],
    commands,
  );
}

export function buildPreparationRecoveryScenario(): DeliveryScenario {
  const oracle = preparationOracle;
  const system = new EventChain({
    storeId: "store-exploration-preparation",
    processId: "delivery-exploration-preparation",
  });
  const activityId = "prepare-exploration-recovery";
  const brief = subject("brief-exploration-recovery");

  system.append("delivery-created", {});
  system.append(
    "director-brief-submitted",
    { activityId },
    brief,
    explicitFacts("director-brief"),
  );
  system.append("activity-started", { activityId, operation: "delivery.prepare" });

  const commands = bindCommands(oracle, Object.freeze({
    "record-prepare-recovery": (chain: EventChain) => {
      chain.append("activity-recovery-recorded", {
        activityId,
        kind: "finalization",
        resumesAt: "agent-attempt-prepared",
        exactEffectDigest: null,
      });
    },
  }));

  return scenario(oracle, "preparation-started", system, commands);
}

function admissionDecisionFacts(
  prepared: ReturnType<typeof prepareSuccessful>,
): RevisionFacts {
  return explicitFacts(
    "director-decision",
    { decision: "admit" },
    [
      relationship("selects-boundary", "work-boundary", prepared.boundary),
      relationship(
        "selects-baseline-receipt",
        "check-receipt",
        prepared.baselineReceipt,
      ),
    ],
  );
}

export function buildInitialAdmissionScenario(): DeliveryScenario {
  const oracle = admissionOracle;
  const system = new EventChain({
    storeId: "store-exploration-admission",
    processId: "delivery-exploration-admission",
  });
  system.append("delivery-created", {});
  const prepared = prepareSuccessful(system, {
    activityId: "prepare-exploration-admission",
    suffix: "exploration-admission",
  });

  const activityId = "admit-exploration-initial";
  const decision = subject("decision-exploration-initial-admission");
  const transactionEffect = effect("exploration-initial-admission");
  const candidate = subject("candidate-exploration-initial", 1);
  system.append("activity-started", { activityId, operation: "delivery.admit" });

  const commands = bindCommands(oracle, Object.freeze({
    "record-decision-recovery": (chain: EventChain) => {
      chain.append("activity-recovery-recorded", {
        activityId,
        kind: "finalization",
        resumesAt: "director-decision-authenticated",
        exactEffectDigest: null,
      });
    },
    authenticate: (chain: EventChain) => {
      chain.append(
        "director-decision-authenticated",
        { activityId },
        decision,
        admissionDecisionFacts(prepared),
      );
    },
    "record-intent-recovery": (chain: EventChain) => {
      chain.append("activity-recovery-recorded", {
        activityId,
        kind: "finalization",
        resumesAt: "transaction-effect-intended",
        exactEffectDigest: null,
      });
    },
    intend: (chain: EventChain) => {
      chain.append(
        "transaction-effect-intended",
        { activityId, effectDigest: transactionEffect },
        decision,
        admissionDecisionFacts(prepared),
      );
    },
    "record-observation-recovery": (chain: EventChain) => {
      chain.append("activity-recovery-recorded", {
        activityId,
        kind: "transaction",
        resumesAt: "transaction-effect-observed",
        exactEffectDigest: transactionEffect,
      });
    },
    "observe-indeterminate": (chain: EventChain) => {
      chain.append(
        "transaction-effect-observed",
        { activityId, effectDigest: transactionEffect, outcome: "indeterminate" },
        decision,
        admissionDecisionFacts(prepared),
      );
    },
    "observe-applied": (chain: EventChain) => {
      chain.append(
        "transaction-effect-observed",
        { activityId, effectDigest: transactionEffect, outcome: "applied" },
        decision,
        admissionDecisionFacts(prepared),
      );
    },
    "observe-not-applied": (chain: EventChain) => {
      chain.append(
        "transaction-effect-observed",
        { activityId, effectDigest: transactionEffect, outcome: "not-applied" },
        decision,
        admissionDecisionFacts(prepared),
      );
    },
    "record-candidate-recovery": (chain: EventChain) => {
      chain.append("activity-recovery-recorded", {
        activityId,
        kind: "candidate-observation",
        resumesAt: "candidate-revision-observed",
        exactEffectDigest: null,
      });
    },
    "observe-candidate": (chain: EventChain) => {
      chain.append(
        "candidate-revision-observed",
        { activityId },
        candidate,
        explicitFacts(
          "candidate-revision",
          candidateRevisionV2Payload("initialization"),
          [relationship("governed-by", "work-boundary", prepared.boundary)],
        ),
      );
    },
    "record-completion-recovery": (chain: EventChain) => {
      chain.append("activity-recovery-recorded", {
        activityId,
        kind: "finalization",
        resumesAt: "activity-completed",
        exactEffectDigest: null,
      });
    },
    "complete-success": (chain: EventChain) => {
      chain.append("activity-completed", { activityId, outcome: "completed" });
    },
    "complete-failed": (chain: EventChain) => {
      chain.append("activity-completed", { activityId, outcome: "failed" });
    },
  }));

  return scenarioWithSeeds(
    oracle,
    [Object.freeze({
      id: "initial-admission-started",
      system,
      model: Object.freeze({ ...oracle.initialModel, effectDigest: transactionEffect }),
    })],
    commands,
  );
}

type ActiveDeliverySeed = Readonly<{
  system: EventChain;
  boundary: ControlRecordEventSubject;
  baselineReceipt: ControlRecordEventSubject;
  candidate: ControlRecordEventSubject;
}>;

type PausedDeliverySeed = ActiveDeliverySeed & Readonly<{
  condition: ControlRecordEventSubject;
}>;

type AwaitingReadmissionSeed = PausedDeliverySeed & Readonly<{
  proposedBoundary: ControlRecordEventSubject;
  proposedBaselineReceipt: ControlRecordEventSubject;
}>;

type DecisionReadySeed = ActiveDeliverySeed & Readonly<{
  seal: ControlRecordEventSubject;
  finalReceipt: ControlRecordEventSubject;
  reviewWorkProduct: ControlRecordEventSubject;
  reviewReceipt: ControlRecordEventSubject;
  evidence: ControlRecordEventSubject;
}>;

function seedActiveDelivery(suffix: string): ActiveDeliverySeed {
  const baseSuffix = `${suffix}-base`;
  const system = new EventChain({
    storeId: `store-${suffix}`,
    processId: `delivery-${suffix}`,
  });
  system.append("delivery-created", {});
  const prepared = prepareSuccessful(system, {
    activityId: `prepare-${baseSuffix}`,
    suffix: baseSuffix,
  });
  const admitted = admitSuccessful(system, prepared, {
    activityId: `admit-${baseSuffix}`,
    suffix: baseSuffix,
    candidate: subject(`candidate-${baseSuffix}`, 1),
  });
  return Object.freeze({
    system,
    boundary: prepared.boundary,
    baselineReceipt: prepared.baselineReceipt,
    candidate: integrateSuccessful(system, prepared.boundary, admitted.candidate).candidate,
  });
}

function materialConditionEvent(input: Readonly<{
  activityId: string;
  suffix: string;
  workProduct: ControlRecordEventSubject;
  receipt: ControlRecordEventSubject;
  candidate: ControlRecordEventSubject;
  boundary: ControlRecordEventSubject;
}>): Readonly<{
  condition: ControlRecordEventSubject;
  payload: ControlJsonObject;
  facts: RevisionFacts;
}> {
  const observedFactsDigest = effect(`material-condition-facts-${input.suffix}`);
  return Object.freeze({
    condition: subject(`condition-${input.suffix}`),
    payload: Object.freeze({
      sourceKind: "agent-proposal",
      activityId: input.activityId,
      observedFactsDigest,
    }),
    facts: explicitFacts(
      "material-condition",
      {
        conditionClass: "missing-required-source",
        source: Object.freeze({
          kind: "agent-proposal",
          conditionId: `condition.${input.suffix}`,
          fragmentDigest: effect(`material-condition-fragment-${input.suffix}`),
        }),
        observedFactsDigest,
      },
      [
        relationship("reported-by", "agent-work-product", input.workProduct),
        relationship("observed-in", "execution-receipt", input.receipt),
        relationship("freezes", "candidate-revision", input.candidate),
        relationship("governed-by", "work-boundary", input.boundary),
      ],
    ),
  });
}

function appendContinueThroughReceipt(
  active: ActiveDeliverySeed,
  suffix: string,
  proposal: "progress" | "material-condition" = "material-condition",
): Readonly<{
  activityId: string;
  attempt: ControlRecordEventSubject;
  workProduct: ControlRecordEventSubject;
  receipt: ControlRecordEventSubject;
  candidate: ControlRecordEventSubject;
}> {
  const { system, boundary } = active;
  const activityId = `continue-${suffix}`;
  const brief = subject(`brief-${suffix}`);
  const attempt = subject(`attempt-${suffix}`);
  const providerEffect = effect(`provider-${suffix}`);
  const workProduct = subject(`work-product-${suffix}`);
  const candidate = subject(active.candidate.recordId, active.candidate.revision + 1);
  const receipt = subject(`receipt-${suffix}`);
  system.append(
    "director-brief-submitted",
    { activityId },
    brief,
    explicitFacts("director-brief"),
  );
  system.append("activity-started", { activityId, operation: "delivery.continue" });
  system.append(
    "agent-attempt-prepared",
    { activityId },
    attempt,
    attemptFacts(brief, boundary, active.candidate),
  );
  system.append(
    "provider-effect-intended",
    { activityId, effectDigest: providerEffect },
    attempt,
  );
  system.append(
    "provider-effect-observed",
    { activityId, effectDigest: providerEffect, outcome: "completed" },
    attempt,
  );
  system.append(
    "agent-work-product-submitted",
    { activityId },
    workProduct,
    explicitFacts("agent-work-product", {
      roleSemantics: Object.freeze({ role: "builder", proposal }),
    }),
  );
  system.append(
    "candidate-revision-observed",
    { activityId },
    candidate,
    explicitFacts(
      "candidate-revision",
      candidateRevisionV2Payload("builder-successor"),
      [
        relationship("revises", "candidate-revision", active.candidate),
        relationship("governed-by", "work-boundary", boundary),
        relationship("result-of", "agent-attempt", attempt),
      ],
    ),
  );
  system.append(
    "execution-receipt-recorded",
    { activityId },
    receipt,
    explicitFacts("execution-receipt"),
  );
  return Object.freeze({ activityId, attempt, workProduct, receipt, candidate });
}

function pauseActiveDelivery(active: ActiveDeliverySeed, suffix: string): PausedDeliverySeed {
  const continued = appendContinueThroughReceipt(active, suffix);
  const conditionEvent = materialConditionEvent({
    activityId: continued.activityId,
    suffix,
    workProduct: continued.workProduct,
    receipt: continued.receipt,
    candidate: continued.candidate,
    boundary: active.boundary,
  });
  active.system.append(
    "material-condition-frozen",
    conditionEvent.payload,
    conditionEvent.condition,
    conditionEvent.facts,
  );
  active.system.append("activity-completed", {
    activityId: continued.activityId,
    outcome: "completed",
  });
  return Object.freeze({
    ...active,
    candidate: continued.candidate,
    condition: conditionEvent.condition,
  });
}

function resolvePausedBoundary(
  paused: PausedDeliverySeed,
  suffix: string,
): AwaitingReadmissionSeed {
  const { system } = paused;
  const activityId = `reaffirm-${suffix}`;
  const brief = subject(`brief-${suffix}`);
  const attempt = subject(`attempt-${suffix}`);
  const providerEffect = effect(`provider-${suffix}`);
  const workProduct = subject(`work-product-${suffix}`);
  const receipt = subject(`receipt-${suffix}`);
  const proposedBoundary = subject(paused.boundary.recordId, paused.boundary.revision + 1);
  const proposedBaselineReceipt = subject(`baseline-${suffix}`);
  system.append(
    "director-brief-submitted",
    { activityId },
    brief,
    explicitFacts("director-brief"),
  );
  system.append("activity-started", { activityId, operation: "delivery.reaffirm" });
  system.append(
    "agent-attempt-prepared",
    { activityId },
    attempt,
    attemptFacts(brief, paused.boundary, paused.candidate),
  );
  system.append(
    "provider-effect-intended",
    { activityId, effectDigest: providerEffect },
    attempt,
  );
  system.append(
    "provider-effect-observed",
    { activityId, effectDigest: providerEffect, outcome: "completed" },
    attempt,
  );
  system.append(
    "agent-work-product-submitted",
    { activityId },
    workProduct,
    explicitFacts("agent-work-product"),
  );
  system.append(
    "execution-receipt-recorded",
    { activityId },
    receipt,
    explicitFacts("execution-receipt"),
  );
  system.append(
    "work-boundary-finalized",
    { activityId },
    proposedBoundary,
    boundaryFacts(
      brief,
      workProduct,
      paused.boundary,
      paused.condition,
    ),
  );
  system.append(
    "check-receipt-recorded",
    { activityId },
    proposedBaselineReceipt,
    checkFacts(
      "baseline",
      "regression-guard",
      "pass",
      relationship("checks-boundary", "work-boundary", proposedBoundary),
    ),
  );
  system.append("activity-completed", { activityId, outcome: "completed" });
  return Object.freeze({
    ...paused,
    proposedBoundary,
    proposedBaselineReceipt,
  });
}

function appendEvaluationThroughReceipt(
  active: ActiveDeliverySeed,
  suffix: string,
): Omit<DecisionReadySeed, "evidence"> & Readonly<{ activityId: string }> {
  const { system } = active;
  const activityId = `evaluate-${suffix}`;
  const brief = subject(`brief-${suffix}`);
  const seal = subject(`seal-${suffix}`);
  const finalReceipt = subject(`final-check-${suffix}`);
  const attempt = subject(`attempt-${suffix}`);
  const providerEffect = effect(`provider-${suffix}`);
  const reviewWorkProduct = subject(`review-work-product-${suffix}`);
  const reviewReceipt = subject(`review-receipt-${suffix}`);
  system.append(
    "director-brief-submitted",
    { activityId },
    brief,
    explicitFacts("director-brief"),
  );
  system.append("activity-started", { activityId, operation: "delivery.evaluate" });
  system.append(
    "candidate-sealed",
    { activityId },
    seal,
    explicitFacts("candidate-seal", {}, [
      relationship("seals", "candidate-revision", active.candidate),
      relationship("governed-by", "work-boundary", active.boundary),
    ]),
  );
  system.append(
    "check-receipt-recorded",
    { activityId },
    finalReceipt,
    checkFacts(
      "final",
      "regression-guard",
      "pass",
      relationship("checks-seal", "candidate-seal", seal),
    ),
  );
  system.append(
    "agent-attempt-prepared",
    { activityId },
    attempt,
    attemptFacts(brief, active.boundary, active.candidate, seal),
  );
  system.append(
    "provider-effect-intended",
    { activityId, effectDigest: providerEffect },
    attempt,
  );
  system.append(
    "provider-effect-observed",
    { activityId, effectDigest: providerEffect, outcome: "completed" },
    attempt,
  );
  system.append(
    "agent-work-product-submitted",
    { activityId },
    reviewWorkProduct,
    explicitFacts("agent-work-product"),
  );
  system.append(
    "execution-receipt-recorded",
    { activityId },
    reviewReceipt,
    explicitFacts("execution-receipt"),
  );
  return Object.freeze({
    ...active,
    activityId,
    seal,
    finalReceipt,
    reviewWorkProduct,
    reviewReceipt,
  });
}

function evidenceFacts(
  evaluated: Omit<DecisionReadySeed, "evidence">,
  readiness: "acceptance-ready" | "correctable" = "acceptance-ready",
): RevisionFacts {
  return explicitFacts(
    "evidence-packet",
    { readiness },
    [
      relationship("governed-by", "work-boundary", evaluated.boundary),
      relationship("evaluates", "candidate-revision", evaluated.candidate),
      relationship("uses-seal", "candidate-seal", evaluated.seal),
      relationship("uses-check", "check-receipt", evaluated.baselineReceipt),
      relationship("uses-check", "check-receipt", evaluated.finalReceipt),
      relationship("uses-review", "agent-work-product", evaluated.reviewWorkProduct),
      relationship(
        "uses-review-receipt",
        "execution-receipt",
        evaluated.reviewReceipt,
      ),
    ],
  );
}

function finishDecisionReady(
  evaluated: Omit<DecisionReadySeed, "evidence"> & Readonly<{ activityId: string }>,
  suffix: string,
  readiness: "acceptance-ready" | "correctable" = "acceptance-ready",
): DecisionReadySeed {
  const evidence = subject(`evidence-${suffix}`);
  evaluated.system.append(
    "evidence-packet-finalized",
    { activityId: evaluated.activityId },
    evidence,
    evidenceFacts(evaluated, readiness),
  );
  evaluated.system.append("activity-completed", {
    activityId: evaluated.activityId,
    outcome: "completed",
  });
  return Object.freeze({ ...evaluated, evidence });
}

function finishFailedEvaluation(
  active: ActiveDeliverySeed,
  suffix: string,
): ActiveDeliverySeed & Readonly<{ seal: ControlRecordEventSubject }> {
  const activityId = `evaluate-${suffix}`;
  const brief = subject(`brief-${suffix}`);
  const seal = subject(`seal-${suffix}`);
  const finalReceipt = subject(`final-check-${suffix}`);
  const attempt = subject(`attempt-${suffix}`);
  const providerEffect = effect(`provider-${suffix}`);
  const receipt = subject(`review-receipt-${suffix}`);
  active.system.append(
    "director-brief-submitted",
    { activityId },
    brief,
    explicitFacts("director-brief"),
  );
  active.system.append("activity-started", { activityId, operation: "delivery.evaluate" });
  active.system.append(
    "candidate-sealed",
    { activityId },
    seal,
    explicitFacts("candidate-seal", {}, [
      relationship("seals", "candidate-revision", active.candidate),
      relationship("governed-by", "work-boundary", active.boundary),
    ]),
  );
  active.system.append(
    "check-receipt-recorded",
    { activityId },
    finalReceipt,
    checkFacts(
      "final",
      "regression-guard",
      "pass",
      relationship("checks-seal", "candidate-seal", seal),
    ),
  );
  active.system.append(
    "agent-attempt-prepared",
    { activityId },
    attempt,
    attemptFacts(brief, active.boundary, active.candidate, seal),
  );
  active.system.append(
    "provider-effect-intended",
    { activityId, effectDigest: providerEffect },
    attempt,
  );
  active.system.append(
    "provider-effect-observed",
    { activityId, effectDigest: providerEffect, outcome: "failed" },
    attempt,
  );
  active.system.append(
    "agent-work-product-abandoned",
    { activityId },
    attempt,
  );
  active.system.append(
    "execution-receipt-recorded",
    { activityId },
    receipt,
    explicitFacts("execution-receipt"),
  );
  active.system.append("activity-completed", { activityId, outcome: "failed" });
  return Object.freeze({ ...active, seal });
}

function finishAccepted(decisionReady: DecisionReadySeed, suffix: string): EventChain {
  const activityId = `accept-${suffix}`;
  const decision = subject(`decision-${suffix}`);
  const transactionEffect = effect(`transaction-${suffix}`);
  decisionReady.system.append("activity-started", {
    activityId,
    operation: "delivery.accept",
  });
  decisionReady.system.append(
    "director-decision-authenticated",
    { activityId },
    decision,
    explicitFacts("director-decision", { decision: "accept" }, [
      relationship("selects-boundary", "work-boundary", decisionReady.boundary),
      relationship("selects-candidate", "candidate-revision", decisionReady.candidate),
      relationship("selects-seal", "candidate-seal", decisionReady.seal),
      relationship("selects-evidence", "evidence-packet", decisionReady.evidence),
    ]),
  );
  decisionReady.system.append(
    "transaction-effect-intended",
    { activityId, effectDigest: transactionEffect },
    decision,
  );
  decisionReady.system.append(
    "transaction-effect-observed",
    { activityId, effectDigest: transactionEffect, outcome: "applied" },
    decision,
  );
  decisionReady.system.append(
    "closure-recorded",
    { activityId },
    subject(`closure-${suffix}`),
    explicitFacts("closure", closurePayload("accepted", "integrated"), [
      relationship("closes-with", "director-decision", decision),
      relationship("governed-by", "work-boundary", decisionReady.boundary),
      relationship("accepts-candidate", "candidate-revision", decisionReady.candidate),
      relationship("accepts-evidence", "evidence-packet", decisionReady.evidence),
    ]),
  );
  return decisionReady.system;
}

type NoShipSeed = Readonly<{
  system: EventChain;
  activityId: string;
  decision: ControlRecordEventSubject;
  transactionEffect: Sha256;
  boundary: ControlRecordEventSubject | null;
  candidate: ControlRecordEventSubject | null;
  condition: ControlRecordEventSubject | null;
}>;

function noShipDecisionFacts(seed: NoShipSeed): RevisionFacts {
  return explicitFacts("director-decision", { decision: "no-ship" }, [
    ...(seed.boundary === null
      ? []
      : [relationship("selects-boundary", "work-boundary", seed.boundary)]),
    ...(seed.condition === null
      ? []
      : [relationship("resolves", "material-condition", seed.condition)]),
    ...(seed.candidate === null
      ? []
      : [relationship("selects-candidate", "candidate-revision", seed.candidate)]),
  ]);
}

function seedNoCandidateNoShip(): NoShipSeed {
  const system = new EventChain({
    storeId: "store-exploration-no-candidate-no-ship",
    processId: "delivery-exploration-no-candidate-no-ship",
  });
  const preparationActivityId = "prepare-exploration-no-candidate";
  const brief = subject("brief-exploration-no-candidate");
  system.append("delivery-created", {});
  system.append(
    "director-brief-submitted",
    { activityId: preparationActivityId },
    brief,
    explicitFacts("director-brief"),
  );
  system.append("activity-started", {
    activityId: preparationActivityId,
    operation: "delivery.prepare",
  });
  system.append("agent-pre-intent-refused", {
 resolution: "none",    activityId: preparationActivityId,
    diagnosticCode: "lifecycle.repository.epoch-moved",
    refusalFactsDigest: effect("exploration-pre-intent-refusal"),
  });
  system.append("activity-completed", {
    activityId: preparationActivityId,
    outcome: "abandoned",
  });

  const activityId = "no-ship-exploration-no-candidate";
  const decision = subject("decision-exploration-no-candidate-no-ship");
  const transactionEffect = effect("exploration-no-candidate-no-ship");
  system.append("activity-started", { activityId, operation: "delivery.no-ship" });
  return Object.freeze({
    system,
    activityId,
    decision,
    transactionEffect,
    boundary: null,
    candidate: null,
    condition: null,
  });
}

function seedProposedBoundaryNoShip(): NoShipSeed {
  const system = new EventChain({
    storeId: "store-exploration-proposed-boundary-no-ship",
    processId: "delivery-exploration-proposed-boundary-no-ship",
  });
  system.append("delivery-created", {});
  const prepared = prepareSuccessful(system, {
    activityId: "prepare-exploration-proposed-boundary",
    suffix: "exploration-proposed-boundary",
  });

  const activityId = "no-ship-exploration-proposed-boundary";
  const decision = subject("decision-exploration-proposed-boundary-no-ship");
  const transactionEffect = effect("exploration-proposed-boundary-no-ship");
  system.append("activity-started", { activityId, operation: "delivery.no-ship" });
  system.append(
    "director-decision-authenticated",
    { activityId },
    decision,
    explicitFacts(
      "director-decision",
      { decision: "no-ship" },
      [relationship("selects-boundary", "work-boundary", prepared.boundary)],
    ),
  );
  system.append(
    "transaction-effect-intended",
    { activityId, effectDigest: transactionEffect },
    decision,
  );
  return Object.freeze({
    system,
    activityId,
    decision,
    transactionEffect,
    boundary: prepared.boundary,
    candidate: null,
    condition: null,
  });
}

function seedCandidatePresentNoShip(): NoShipSeed {
  const system = new EventChain({
    storeId: "store-exploration-candidate-no-ship",
    processId: "delivery-exploration-candidate-no-ship",
  });
  system.append("delivery-created", {});
  const prepared = prepareSuccessful(system, {
    activityId: "prepare-exploration-candidate-no-ship",
    suffix: "exploration-candidate-no-ship",
  });
  const admitted = admitSuccessful(system, prepared, {
    activityId: "admit-exploration-candidate-no-ship",
    suffix: "exploration-candidate-no-ship",
    candidate: subject("candidate-exploration-no-ship", 1),
  });

  const activityId = "no-ship-exploration-candidate-present";
  const decision = subject("decision-exploration-candidate-no-ship");
  const transactionEffect = effect("exploration-candidate-no-ship");
  system.append("activity-started", { activityId, operation: "delivery.no-ship" });
  system.append(
    "director-decision-authenticated",
    { activityId },
    decision,
    explicitFacts(
      "director-decision",
      { decision: "no-ship" },
      [
        relationship("selects-boundary", "work-boundary", prepared.boundary),
        relationship("selects-candidate", "candidate-revision", admitted.candidate),
      ],
    ),
  );
  system.append(
    "transaction-effect-intended",
    { activityId, effectDigest: transactionEffect },
    decision,
  );
  return Object.freeze({
    system,
    activityId,
    decision,
    transactionEffect,
    boundary: prepared.boundary,
    candidate: admitted.candidate,
    condition: null,
  });
}

function seedNoShipFromCandidateOrigin(input: Readonly<{
  active: ActiveDeliverySeed;
  suffix: string;
  boundary: ControlRecordEventSubject;
  candidate: ControlRecordEventSubject;
  condition?: ControlRecordEventSubject;
}>): NoShipSeed {
  const activityId = `no-ship-${input.suffix}`;
  const decision = subject(`decision-${input.suffix}`);
  const transactionEffect = effect(input.suffix);
  input.active.system.append("activity-started", {
    activityId,
    operation: "delivery.no-ship",
  });
  input.active.system.append(
    "director-decision-authenticated",
    { activityId },
    decision,
    explicitFacts("director-decision", { decision: "no-ship" }, [
      relationship("selects-boundary", "work-boundary", input.boundary),
      ...(input.condition === undefined
        ? []
        : [relationship("resolves", "material-condition", input.condition)]),
      relationship("selects-candidate", "candidate-revision", input.candidate),
    ]),
  );
  input.active.system.append(
    "transaction-effect-intended",
    { activityId, effectDigest: transactionEffect },
    decision,
  );
  return Object.freeze({
    system: input.active.system,
    activityId,
    decision,
    transactionEffect,
    boundary: input.boundary,
    candidate: input.candidate,
    condition: input.condition ?? null,
  });
}

function seedBoundaryPausedNoShip(): NoShipSeed {
  const active = seedActiveDelivery("exploration-boundary-paused-no-ship");
  const paused = pauseActiveDelivery(active, "exploration-boundary-paused-no-ship");
  return seedNoShipFromCandidateOrigin({
    active: paused,
    suffix: "exploration-boundary-paused-no-ship",
    boundary: paused.boundary,
    candidate: paused.candidate,
    condition: paused.condition,
  });
}

function seedAwaitingReadmissionNoShip(): NoShipSeed {
  const active = seedActiveDelivery("exploration-awaiting-readmission-no-ship");
  const paused = pauseActiveDelivery(
    active,
    "exploration-awaiting-readmission-no-ship-condition",
  );
  const awaiting = resolvePausedBoundary(
    paused,
    "exploration-awaiting-readmission-no-ship-resolution",
  );
  return seedNoShipFromCandidateOrigin({
    active: awaiting,
    suffix: "exploration-awaiting-readmission-no-ship",
    // No-ship selects the still-active predecessor while readmission is pending.
    boundary: awaiting.boundary,
    candidate: awaiting.candidate,
    condition: awaiting.condition,
  });
}

function seedDecisionReadyNoShip(): NoShipSeed {
  const active = seedActiveDelivery("exploration-decision-ready-no-ship");
  const evaluated = appendEvaluationThroughReceipt(
    active,
    "exploration-decision-ready-no-ship",
  );
  const decisionReady = finishDecisionReady(
    evaluated,
    "exploration-decision-ready-no-ship",
  );
  return seedNoShipFromCandidateOrigin({
    active: decisionReady,
    suffix: "exploration-decision-ready-no-ship",
    boundary: decisionReady.boundary,
    candidate: decisionReady.candidate,
  });
}

function noShipCommands(
  oracle: DeliveryOracle,
  seededValues: NoShipSeed | readonly NoShipSeed[],
): readonly ExplorationCommand<EventChain, DeliveryOracleModel>[] {
  const values = Array.isArray(seededValues) ? seededValues : [seededValues];
  const byProcess = new Map(values.map((seeded) => [seeded.system.processId, seeded]));
  const selected = (chain: EventChain): NoShipSeed => {
    const seeded = byProcess.get(chain.processId);
    if (seeded === undefined) {
      throw new TypeError(`No no-ship fixture for Process ${chain.processId}`);
    }
    return seeded;
  };
  return bindCommands(oracle, Object.freeze({
    authenticate: (chain: EventChain) => {
      const seeded = selected(chain);
      chain.append(
        "director-decision-authenticated",
        { activityId: seeded.activityId },
        seeded.decision,
        noShipDecisionFacts(seeded),
      );
    },
    intend: (chain: EventChain) => {
      const seeded = selected(chain);
      chain.append(
        "transaction-effect-intended",
        { activityId: seeded.activityId, effectDigest: seeded.transactionEffect },
        seeded.decision,
        noShipDecisionFacts(seeded),
      );
    },
    "record-transaction-recovery": (chain: EventChain) => {
      const { activityId, transactionEffect } = selected(chain);
      chain.append("activity-recovery-recorded", {
        activityId,
        kind: "transaction",
        resumesAt: "transaction-effect-observed",
        exactEffectDigest: transactionEffect,
      });
    },
    "observe-indeterminate": (chain: EventChain) => {
      const seeded = selected(chain);
      chain.append(
        "transaction-effect-observed",
        {
          activityId: seeded.activityId,
          effectDigest: seeded.transactionEffect,
          outcome: "indeterminate",
        },
        seeded.decision,
        noShipDecisionFacts(seeded),
      );
    },
    "observe-applied": (chain: EventChain) => {
      const seeded = selected(chain);
      chain.append(
        "transaction-effect-observed",
        {
          activityId: seeded.activityId,
          effectDigest: seeded.transactionEffect,
          outcome: "applied",
        },
        seeded.decision,
        noShipDecisionFacts(seeded),
      );
    },
    "observe-not-applied": (chain: EventChain) => {
      const seeded = selected(chain);
      chain.append(
        "transaction-effect-observed",
        {
          activityId: seeded.activityId,
          effectDigest: seeded.transactionEffect,
          outcome: "not-applied",
        },
        seeded.decision,
        noShipDecisionFacts(seeded),
      );
    },
    "record-finalization-recovery": (chain: EventChain) => {
      const { activityId } = selected(chain);
      chain.append("activity-recovery-recorded", {
        activityId,
        kind: "finalization",
        resumesAt: "transaction-finalization",
        exactEffectDigest: null,
      });
    },
    "record-completion-recovery": (chain: EventChain) => {
      const { activityId } = selected(chain);
      chain.append("activity-recovery-recorded", {
        activityId,
        kind: "finalization",
        resumesAt: "activity-completed",
        exactEffectDigest: null,
      });
    },
    "record-closure": (chain: EventChain) => {
      const { activityId, boundary, candidate, decision } = selected(chain);
      const closure = subject(candidate === null
        ? "closure-exploration-no-candidate-no-ship"
        : "closure-exploration-candidate-no-ship");
      chain.append(
        "closure-recorded",
        { activityId },
        closure,
        explicitFacts(
          "closure",
          closurePayload("no-ship", candidate === null ? "not-created" : "abandoned"),
          [
            relationship("closes-with", "director-decision", decision),
            ...(boundary === null
              ? []
              : [relationship("governed-by", "work-boundary", boundary)]),
            ...(candidate === null
              ? []
              : [relationship("abandons-candidate", "candidate-revision", candidate)]),
          ],
        ),
      );
    },
    "complete-failed": (chain: EventChain) => {
      const { activityId } = selected(chain);
      chain.append("activity-completed", { activityId, outcome: "failed" });
    },
  }));
}

export function buildNoCandidateNoShipScenario(): DeliveryScenario {
  const oracle = noShipOracle(false);
  const failedPreparation = seedNoCandidateNoShip();
  const proposedBoundary = seedProposedBoundaryNoShip();
  const seeded = Object.freeze([failedPreparation, proposedBoundary]);
  return scenarioWithSeeds(
    oracle,
    [
      Object.freeze({
        id: "failed-preparation-no-ship-started",
        system: failedPreparation.system,
        model: Object.freeze({
          ...oracle.initialModel,
          phase: "started",
          originStanding: "framing" as const,
          boundaryKind: "none" as const,
          effectDigest: failedPreparation.transactionEffect,
        }),
      }),
      Object.freeze({
        id: "proposed-boundary-no-ship-intended",
        system: proposedBoundary.system,
        model: Object.freeze({
          ...oracle.initialModel,
          originStanding: "awaiting-admission" as const,
          boundaryKind: "proposed" as const,
          effectDigest: proposedBoundary.transactionEffect,
        }),
      }),
    ],
    noShipCommands(oracle, seeded),
  );
}

export function buildCandidatePresentNoShipScenario(): DeliveryScenario {
  const oracle = noShipOracle(true);
  const active = seedCandidatePresentNoShip();
  const boundaryPaused = seedBoundaryPausedNoShip();
  const awaitingReadmission = seedAwaitingReadmissionNoShip();
  const decisionReady = seedDecisionReadyNoShip();
  const seeded = Object.freeze([
    active,
    boundaryPaused,
    awaitingReadmission,
    decisionReady,
  ]);
  return scenarioWithSeeds(
    oracle,
    [
      Object.freeze({
        id: "active-no-ship-intended",
        system: active.system,
        model: Object.freeze({
          ...oracle.initialModel,
          originStanding: "active" as const,
          boundaryKind: "active" as const,
          effectDigest: active.transactionEffect,
        }),
      }),
      Object.freeze({
        id: "boundary-paused-no-ship-intended",
        system: boundaryPaused.system,
        model: Object.freeze({
          ...oracle.initialModel,
          originStanding: "boundary-paused" as const,
          candidateIntegrated: true,
          boundaryKind: "active" as const,
          effectDigest: boundaryPaused.transactionEffect,
        }),
      }),
      Object.freeze({
        id: "awaiting-readmission-no-ship-intended",
        system: awaitingReadmission.system,
        model: Object.freeze({
          ...oracle.initialModel,
          originStanding: "awaiting-readmission" as const,
          candidateIntegrated: true,
          boundaryKind: "active-and-proposed" as const,
          effectDigest: awaitingReadmission.transactionEffect,
        }),
      }),
      Object.freeze({
        id: "decision-ready-no-ship-intended",
        system: decisionReady.system,
        model: Object.freeze({
          ...oracle.initialModel,
          originStanding: "decision-ready" as const,
          candidateIntegrated: true,
          boundaryKind: "active" as const,
          effectDigest: decisionReady.transactionEffect,
        }),
      }),
    ],
    noShipCommands(oracle, seeded),
  );
}

const ROUTE_ACTIVITY_FACTS = Object.freeze({
  "start-prepare": Object.freeze({
    activityId: "route-start-prepare",
    operation: "delivery.prepare",
    agent: true,
  }),
  "start-admit": Object.freeze({
    activityId: "route-start-admit",
    operation: "delivery.admit",
    agent: false,
  }),
  "start-continue": Object.freeze({
    activityId: "route-start-continue",
    operation: "delivery.continue",
    agent: true,
  }),
  "start-integrate": Object.freeze({
    activityId: "route-start-integrate", operation: "delivery.integrate", agent: false,
  }),
  "start-evaluate": Object.freeze({
    activityId: "route-start-evaluate",
    operation: "delivery.evaluate",
    agent: true,
  }),
  "start-revise": Object.freeze({
    activityId: "route-start-revise",
    operation: "delivery.revise",
    agent: true,
  }),
  "start-reaffirm": Object.freeze({
    activityId: "route-start-reaffirm",
    operation: "delivery.reaffirm",
    agent: true,
  }),
  "start-accept": Object.freeze({
    activityId: "route-start-accept",
    operation: "delivery.accept",
    agent: false,
  }),
  "start-no-ship": Object.freeze({
    activityId: "route-start-no-ship",
    operation: "delivery.no-ship",
    agent: false,
  }),
});

function planRouteAgentBriefs(system: EventChain, suffix: string): void {
  for (const { activityId, agent } of Object.values(ROUTE_ACTIVITY_FACTS)) {
    if (!agent) continue;
    system.append(
      "director-brief-submitted",
      { activityId },
      subject(`brief-${activityId}-${suffix}`),
      explicitFacts("director-brief"),
    );
  }
}

function seedFailedPreparationForRoute(suffix: string): EventChain {
  const system = new EventChain({
    storeId: `store-${suffix}`,
    processId: `delivery-${suffix}`,
  });
  const activityId = `prepare-${suffix}`;
  system.append("delivery-created", {});
  system.append(
    "director-brief-submitted",
    { activityId },
    subject(`brief-${suffix}`),
    explicitFacts("director-brief"),
  );
  system.append("activity-started", { activityId, operation: "delivery.prepare" });
  system.append("agent-pre-intent-refused", {
 resolution: "none",    activityId,
    diagnosticCode: "lifecycle.repository.epoch-moved",
    refusalFactsDigest: effect(`pre-intent-refusal-${suffix}`),
  });
  system.append("activity-completed", { activityId, outcome: "abandoned" });
  return system;
}

export function buildRouteOpeningScenario(): DeliveryScenario {
  const oracle = routeOpeningOracle;

  const fresh = new EventChain({
    storeId: "store-route-framing-fresh",
    processId: "delivery-route-framing-fresh",
  });
  fresh.append("delivery-created", {});
  planRouteAgentBriefs(fresh, "framing-fresh");

  const preparedFraming = seedFailedPreparationForRoute("route-framing-after-preparation");
  planRouteAgentBriefs(preparedFraming, "framing-after-preparation");

  const awaitingAdmission = new EventChain({
    storeId: "store-route-awaiting-admission",
    processId: "delivery-route-awaiting-admission",
  });
  awaitingAdmission.append("delivery-created", {});
  prepareSuccessful(awaitingAdmission, {
    activityId: "prepare-route-awaiting-admission",
    suffix: "route-awaiting-admission",
  });
  planRouteAgentBriefs(awaitingAdmission, "awaiting-admission");

  const active = seedActiveDelivery("route-active");
  planRouteAgentBriefs(active.system, "active");

  const needsCorrection = finishDecisionReady(
    appendEvaluationThroughReceipt(
      seedActiveDelivery("route-active-needs-correction"),
      "route-active-needs-correction",
    ),
    "route-active-needs-correction",
    "correctable",
  );
  planRouteAgentBriefs(needsCorrection.system, "active-needs-correction");

  const sealedAfterFailedEvaluation = finishFailedEvaluation(
    seedActiveDelivery("route-active-sealed-after-failed-evaluation"),
    "route-active-sealed-after-failed-evaluation",
  );
  planRouteAgentBriefs(
    sealedAfterFailedEvaluation.system,
    "active-sealed-after-failed-evaluation",
  );

  const boundaryPaused = pauseActiveDelivery(
    seedActiveDelivery("route-boundary-paused"),
    "route-boundary-paused",
  );
  planRouteAgentBriefs(boundaryPaused.system, "boundary-paused");

  const awaitingReadmission = resolvePausedBoundary(
    pauseActiveDelivery(
      seedActiveDelivery("route-awaiting-readmission"),
      "route-awaiting-readmission-condition",
    ),
    "route-awaiting-readmission-resolution",
  );
  planRouteAgentBriefs(awaitingReadmission.system, "awaiting-readmission");

  const decisionReady = finishDecisionReady(
    appendEvaluationThroughReceipt(
      seedActiveDelivery("route-decision-ready"),
      "route-decision-ready",
    ),
    "route-decision-ready",
  );
  planRouteAgentBriefs(decisionReady.system, "decision-ready");

  const closed = finishAccepted(
    finishDecisionReady(
      appendEvaluationThroughReceipt(
        seedActiveDelivery("route-closed"),
        "route-closed-evaluation",
      ),
      "route-closed-evaluation",
    ),
    "route-closed",
  );

  const commands = bindCommands(oracle, Object.freeze(Object.fromEntries(
    Object.entries(ROUTE_ACTIVITY_FACTS).map(([id, facts]) => [
      id,
      (chain: EventChain) => {
        chain.append("activity-started", {
          activityId: facts.activityId,
          operation: facts.operation,
        });
      },
    ]),
  )));

  return scenarioWithSeeds(
    oracle,
    [
      Object.freeze({
        id: "framing-fresh",
        system: fresh,
        model: routeOpeningModels["framing-fresh"],
      }),
      Object.freeze({
        id: "framing-after-preparation",
        system: preparedFraming,
        model: routeOpeningModels["framing-after-preparation"],
      }),
      Object.freeze({
        id: "awaiting-admission",
        system: awaitingAdmission,
        model: routeOpeningModels["awaiting-admission"],
      }),
      Object.freeze({
        id: "active",
        system: active.system,
        model: routeOpeningModels.active,
      }),
      Object.freeze({
        id: "active-needs-correction",
        system: needsCorrection.system,
        model: routeOpeningModels["active-needs-correction"],
      }),
      Object.freeze({
        id: "active-sealed-after-failed-evaluation",
        system: sealedAfterFailedEvaluation.system,
        model: routeOpeningModels["active-sealed-after-failed-evaluation"],
      }),
      Object.freeze({
        id: "boundary-paused",
        system: boundaryPaused.system,
        model: routeOpeningModels["boundary-paused"],
      }),
      Object.freeze({
        id: "awaiting-readmission",
        system: awaitingReadmission.system,
        model: routeOpeningModels["awaiting-readmission"],
      }),
      Object.freeze({
        id: "decision-ready",
        system: decisionReady.system,
        model: routeOpeningModels["decision-ready"],
      }),
      Object.freeze({
        id: "closed",
        system: closed,
        model: routeOpeningModels.closed,
      }),
    ],
    commands,
  );
}

type RecoveryProgressionPhase = keyof typeof recoveryProgressionModels;

type RecoveryProgressionSeed = Readonly<{
  id: string;
  phase: RecoveryProgressionPhase;
  system: EventChain;
  effectDigest?: Sha256;
  advance(chain: EventChain): void;
}>;

function startContinueAttempt(
  active: ActiveDeliverySeed,
  suffix: string,
): Readonly<{
  activityId: string;
  brief: ControlRecordEventSubject;
  attempt: ControlRecordEventSubject;
  providerEffect: Sha256;
}> {
  const activityId = `continue-${suffix}`;
  const brief = subject(`brief-${suffix}`);
  const attempt = subject(`attempt-${suffix}`);
  const providerEffect = effect(`provider-${suffix}`);
  active.system.append(
    "director-brief-submitted",
    { activityId },
    brief,
    explicitFacts("director-brief"),
  );
  active.system.append("activity-started", {
    activityId,
    operation: "delivery.continue",
  });
  active.system.append(
    "agent-attempt-prepared",
    { activityId },
    attempt,
    attemptFacts(brief, active.boundary, active.candidate),
  );
  return Object.freeze({ activityId, brief, attempt, providerEffect });
}

function appendProviderIntent(
  system: EventChain,
  started: ReturnType<typeof startContinueAttempt>,
): void {
  system.append(
    "provider-effect-intended",
    { activityId: started.activityId, effectDigest: started.providerEffect },
    started.attempt,
  );
}

function appendProviderObservation(
  system: EventChain,
  started: ReturnType<typeof startContinueAttempt>,
  outcome: "completed" | "failed",
): void {
  system.append(
    "provider-effect-observed",
    {
      activityId: started.activityId,
      effectDigest: started.providerEffect,
      outcome,
    },
    started.attempt,
  );
}

type PreparationProgressionSeed = Readonly<{
  system: EventChain;
  activityId: string;
  brief: ControlRecordEventSubject;
  workProduct: ControlRecordEventSubject;
  receipt: ControlRecordEventSubject;
  boundary: ControlRecordEventSubject;
}>;

function seedPreparationProgression(
  suffix: string,
  through: "work-product" | "receipt" | "boundary",
): PreparationProgressionSeed {
  const system = new EventChain({
    storeId: `store-${suffix}`,
    processId: `delivery-${suffix}`,
  });
  const activityId = `prepare-${suffix}`;
  const brief = subject(`brief-${suffix}`);
  const attempt = subject(`attempt-${suffix}`);
  const providerEffect = effect(`provider-${suffix}`);
  const workProduct = subject(`work-product-${suffix}`);
  const receipt = subject(`receipt-${suffix}`);
  const boundary = subject(`boundary-${suffix}`);
  system.append("delivery-created", {});
  system.append(
    "director-brief-submitted",
    { activityId },
    brief,
    explicitFacts("director-brief"),
  );
  system.append("activity-started", { activityId, operation: "delivery.prepare" });
  system.append(
    "agent-attempt-prepared",
    { activityId },
    attempt,
    attemptFacts(brief),
  );
  system.append(
    "provider-effect-intended",
    { activityId, effectDigest: providerEffect },
    attempt,
  );
  system.append(
    "provider-effect-observed",
    { activityId, effectDigest: providerEffect, outcome: "completed" },
    attempt,
  );
  system.append(
    "agent-work-product-submitted",
    { activityId },
    workProduct,
    explicitFacts("agent-work-product"),
  );
  if (through === "receipt" || through === "boundary") {
    system.append(
      "execution-receipt-recorded",
      { activityId },
      receipt,
      explicitFacts("execution-receipt"),
    );
  }
  if (through === "boundary") {
    system.append(
      "work-boundary-finalized",
      { activityId },
      boundary,
      boundaryFacts(brief, workProduct),
    );
  }
  return Object.freeze({
    system,
    activityId,
    brief,
    workProduct,
    receipt,
    boundary,
  });
}

function buildRecoveryProgressionSeeds(): readonly RecoveryProgressionSeed[] {
  const providerIntentActive = seedActiveDelivery("progression-provider-intent");
  const providerIntent = startContinueAttempt(
    providerIntentActive,
    "progression-provider-intent",
  );

  const providerObservationActive = seedActiveDelivery("progression-provider-observation");
  const providerObservation = startContinueAttempt(
    providerObservationActive,
    "progression-provider-observation",
  );
  appendProviderIntent(providerObservationActive.system, providerObservation);

  const workProductActive = seedActiveDelivery("progression-work-product-observation");
  const workProductObservation = startContinueAttempt(
    workProductActive,
    "progression-work-product-observation",
  );
  appendProviderIntent(workProductActive.system, workProductObservation);
  appendProviderObservation(workProductActive.system, workProductObservation, "failed");

  const candidateActive = seedActiveDelivery("progression-candidate-observation");
  const candidateObservation = startContinueAttempt(
    candidateActive,
    "progression-candidate-observation",
  );
  appendProviderIntent(candidateActive.system, candidateObservation);
  appendProviderObservation(candidateActive.system, candidateObservation, "completed");
  const candidateWorkProduct = subject("work-product-progression-candidate-observation");
  candidateActive.system.append(
    "agent-work-product-submitted",
    { activityId: candidateObservation.activityId },
    candidateWorkProduct,
    explicitFacts("agent-work-product", {
      roleSemantics: Object.freeze({ role: "builder", proposal: "progress" }),
    }),
  );
  const candidateSuccessor = subject(
    candidateActive.candidate.recordId,
    candidateActive.candidate.revision + 1,
  );

  const boundaryReceipt = seedPreparationProgression(
    "progression-boundary-receipt",
    "work-product",
  );
  const workBoundary = seedPreparationProgression(
    "progression-work-boundary",
    "receipt",
  );
  const baselineChecks = seedPreparationProgression(
    "progression-baseline-checks",
    "boundary",
  );

  const candidateSealActive = seedActiveDelivery("progression-candidate-seal");
  const candidateSealActivityId = "evaluate-progression-candidate-seal";
  const candidateSealBrief = subject("brief-progression-candidate-seal");
  const candidateSeal = subject("seal-progression-candidate-seal");
  candidateSealActive.system.append(
    "director-brief-submitted",
    { activityId: candidateSealActivityId },
    candidateSealBrief,
    explicitFacts("director-brief"),
  );
  candidateSealActive.system.append("activity-started", {
    activityId: candidateSealActivityId,
    operation: "delivery.evaluate",
  });

  const evaluationChecksActive = seedActiveDelivery("progression-evaluation-checks");
  const evaluationChecksActivityId = "evaluate-progression-evaluation-checks";
  const evaluationChecksBrief = subject("brief-progression-evaluation-checks");
  const evaluationChecksSeal = subject("seal-progression-evaluation-checks");
  const evaluationChecksReceipt = subject("final-check-progression-evaluation-checks");
  const evaluationChecksAttempt = subject("attempt-progression-evaluation-checks");
  evaluationChecksActive.system.append(
    "director-brief-submitted",
    { activityId: evaluationChecksActivityId },
    evaluationChecksBrief,
    explicitFacts("director-brief"),
  );
  evaluationChecksActive.system.append("activity-started", {
    activityId: evaluationChecksActivityId,
    operation: "delivery.evaluate",
  });
  evaluationChecksActive.system.append(
    "candidate-sealed",
    { activityId: evaluationChecksActivityId },
    evaluationChecksSeal,
    explicitFacts("candidate-seal", {}, [
      relationship("seals", "candidate-revision", evaluationChecksActive.candidate),
      relationship("governed-by", "work-boundary", evaluationChecksActive.boundary),
    ]),
  );
  evaluationChecksActive.system.append(
    "check-receipt-recorded",
    { activityId: evaluationChecksActivityId },
    evaluationChecksReceipt,
    checkFacts(
      "final",
      "regression-guard",
      "pass",
      relationship("checks-seal", "candidate-seal", evaluationChecksSeal),
    ),
  );

  const continueFinalizationActive = seedActiveDelivery("progression-continue-finalization");
  const continueFinalization = appendContinueThroughReceipt(
    continueFinalizationActive,
    "progression-continue-finalization",
  );
  const conditionEvent = materialConditionEvent({
    activityId: continueFinalization.activityId,
    suffix: "progression-continue-finalization",
    workProduct: continueFinalization.workProduct,
    receipt: continueFinalization.receipt,
    candidate: continueFinalization.candidate,
    boundary: continueFinalizationActive.boundary,
  });

  const evaluationFinalization = appendEvaluationThroughReceipt(
    seedActiveDelivery("progression-evaluation-finalization"),
    "progression-evaluation-finalization",
  );
  const evaluationEvidence = subject("evidence-progression-evaluation-finalization");

  return Object.freeze([
    Object.freeze({
      id: "provider-intent",
      phase: "provider-intent",
      system: providerIntentActive.system,
      effectDigest: providerIntent.providerEffect,
      advance(chain: EventChain) {
        appendProviderIntent(chain, providerIntent);
      },
    }),
    Object.freeze({
      id: "provider-observation",
      phase: "provider-observation",
      system: providerObservationActive.system,
      effectDigest: providerObservation.providerEffect,
      advance(chain: EventChain) {
        appendProviderObservation(chain, providerObservation, "failed");
      },
    }),
    Object.freeze({
      id: "work-product-observation",
      phase: "work-product-observation",
      system: workProductActive.system,
      effectDigest: workProductObservation.providerEffect,
      advance(chain: EventChain) {
        chain.append(
          "agent-work-product-abandoned",
          { activityId: workProductObservation.activityId },
          workProductObservation.attempt,
        );
      },
    }),
    Object.freeze({
      id: "candidate-observation",
      phase: "candidate-observation",
      system: candidateActive.system,
      advance(chain: EventChain) {
        chain.append(
          "candidate-revision-observed",
          { activityId: candidateObservation.activityId },
          candidateSuccessor,
          explicitFacts(
            "candidate-revision",
            candidateRevisionV2Payload("builder-successor"),
            [
              relationship("revises", "candidate-revision", candidateActive.candidate),
              relationship("governed-by", "work-boundary", candidateActive.boundary),
              relationship("result-of", "agent-attempt", candidateObservation.attempt),
            ],
          ),
        );
      },
    }),
    Object.freeze({
      id: "boundary-receipt",
      phase: "boundary-receipt",
      system: boundaryReceipt.system,
      advance(chain: EventChain) {
        chain.append(
          "execution-receipt-recorded",
          { activityId: boundaryReceipt.activityId },
          boundaryReceipt.receipt,
          explicitFacts("execution-receipt"),
        );
      },
    }),
    Object.freeze({
      id: "work-boundary",
      phase: "work-boundary",
      system: workBoundary.system,
      advance(chain: EventChain) {
        chain.append(
          "work-boundary-finalized",
          { activityId: workBoundary.activityId },
          workBoundary.boundary,
          boundaryFacts(workBoundary.brief, workBoundary.workProduct),
        );
      },
    }),
    Object.freeze({
      id: "baseline-checks",
      phase: "baseline-checks",
      system: baselineChecks.system,
      advance(chain: EventChain) {
        chain.append(
          "check-receipt-recorded",
          { activityId: baselineChecks.activityId },
          subject("baseline-check-progression-baseline-checks"),
          checkFacts(
            "baseline",
            "regression-guard",
            "pass",
            relationship("checks-boundary", "work-boundary", baselineChecks.boundary),
          ),
        );
      },
    }),
    Object.freeze({
      id: "candidate-seal",
      phase: "candidate-seal",
      system: candidateSealActive.system,
      advance(chain: EventChain) {
        chain.append(
          "candidate-sealed",
          { activityId: candidateSealActivityId },
          candidateSeal,
          explicitFacts("candidate-seal", {}, [
            relationship("seals", "candidate-revision", candidateSealActive.candidate),
            relationship("governed-by", "work-boundary", candidateSealActive.boundary),
          ]),
        );
      },
    }),
    Object.freeze({
      id: "evaluation-checks",
      phase: "evaluation-checks",
      system: evaluationChecksActive.system,
      advance(chain: EventChain) {
        chain.append(
          "agent-attempt-prepared",
          { activityId: evaluationChecksActivityId },
          evaluationChecksAttempt,
          attemptFacts(
            evaluationChecksBrief,
            evaluationChecksActive.boundary,
            evaluationChecksActive.candidate,
            evaluationChecksSeal,
          ),
        );
      },
    }),
    Object.freeze({
      id: "continue-finalization",
      phase: "continue-finalization",
      system: continueFinalizationActive.system,
      advance(chain: EventChain) {
        chain.append(
          "material-condition-frozen",
          conditionEvent.payload,
          conditionEvent.condition,
          conditionEvent.facts,
        );
      },
    }),
    Object.freeze({
      id: "evaluation-finalization",
      phase: "evaluation-finalization",
      system: evaluationFinalization.system,
      advance(chain: EventChain) {
        chain.append(
          "evidence-packet-finalized",
          { activityId: evaluationFinalization.activityId },
          evaluationEvidence,
          evidenceFacts(evaluationFinalization),
        );
      },
    }),
  ] satisfies readonly RecoveryProgressionSeed[]);
}

export function buildRecoveryProgressionScenario(): DeliveryScenario {
  const oracle = recoveryProgressionOracle;
  const progressionSeeds = buildRecoveryProgressionSeeds();
  const advances = new Map(progressionSeeds.map((seed) => [
    seed.system.processId,
    seed.advance,
  ]));
  const commands = bindCommands(oracle, Object.freeze({
    "advance-recovery": (chain: EventChain) => {
      const advance = advances.get(chain.processId);
      if (advance === undefined) {
        throw new TypeError(`No recovery progression for Process ${chain.processId}`);
      }
      advance(chain);
    },
  }));
  return scenarioWithSeeds(
    oracle,
    progressionSeeds.map((seed) => Object.freeze({
      id: seed.id,
      system: seed.system,
      model: Object.freeze({
        ...recoveryProgressionModels[seed.phase],
        effectDigest: seed.effectDigest,
      }),
    })),
    commands,
  );
}

export function buildDeliveryScenarios(): readonly DeliveryScenario[] {
  return Object.freeze([
    buildPreparationRecoveryScenario(),
    buildPreIntentRefusalRecoveryScenario(),
    buildInitialAdmissionScenario(),
    buildIntegrationScenario(),
    buildWorkDelegationScenario(),
    buildNoCandidateNoShipScenario(),
    buildCandidatePresentNoShipScenario(),
    buildRouteOpeningScenario(),
    buildRecoveryProgressionScenario(),
    buildProjectionRefusalScenario(),
    buildProjectionRefusalScenario("delivery.continue"),
    ...buildDeliveryContinuationScenarios(),
  ]);
}

export function buildWorkDelegationScenario(): DeliveryScenario {
  const system = new EventChain({ storeId: "store-bounded-delegation", processId: "delivery-bounded-delegation" });
  system.append("delivery-created", {});
  const prepared = prepareSuccessful(system, { suffix: "delegation" });
  const admitted = admitSuccessful(system, prepared, { suffix: "delegation" });
  const delegation = subject("delegation-bounded");
  const selectedReference = { id: delegation.recordId, revision: delegation.revision, digest: delegation.digest };
  const reference = (kind: string, selected: ControlRecordEventSubject) =>
    ({ kind, id: selected.recordId, revision: selected.revision, digest: selected.digest });
  // Exact normative fixed-policy bytes. The adapter uses canonicalization only;
  // the independent oracle does not import or consult the production policy.
  const policy = {
    id: "lifecycle.work-delegation.standard-v1",
    operations: ["delivery.continue", "delivery.evaluate", "delivery.integrate"],
    accounting: "delivery-lifetime-delegated-reservations-no-refunds",
    stop: "finish-reserved-operation", authority: "no-mandate-or-terminal-decision",
    continuation: "fresh-eligible-useful-work-after-settlement",
    maximumCellWallTimeMs: 86400000, maximumSlots: 4097,
  };
  const stop = {
    schema: "lifecycle.work-delegation-stop-request.v1",
    storeId: system.storeId, processId: system.processId,
    delegation: reference("work-delegation", delegation),
    requestedBy: "foundation-runtime", requestedAt: system.occurredAt,
  };
  const commands = bindCommands(workDelegationOracle, {
    set: (chain) => { chain.append("work-delegation-set", {}, delegation, {
      recordKind: "work-delegation",
      payload: {
        schema: "lifecycle.work-delegation.v2",
        boundary: reference("work-boundary", admitted.boundary),
        admission: reference("director-decision", admitted.decision), replaces: null,
        policy: { id: policy.id, digest: digestCanonical(policy) },
        allowedOperations: ["delivery.integrate"],
        directions: { continue: null, evaluate: null },
        agentSelections: { builder: null, reviewer: null },
        ceilings: { operations: 1, agentAttempts: 0, reservedCellWallTimeMs: 0 },
        expiresAt: null, stopPolicy: "finish-reserved-operation",
      },
      relationships: [relationship("uses-boundary", "work-boundary", admitted.boundary),
        relationship("uses-admission", "director-decision", admitted.decision)],
    }); },
    stop: (chain) => { chain.append("work-delegation-stopped", {
      requestDigest: digestCanonical(stop), requestedAt: stop.requestedAt, requestedBy: stop.requestedBy,
    }, delegation, { recordKind: "work-delegation" }); },
  });
  const scenario = scenarioWithSeeds(workDelegationOracle,
    [{ id: "admitted-settled-no-permission", system, model: workDelegationOracle.initialModel }], commands);
  return Object.freeze({ ...scenario,
    invariants: (input) => [...scenario.invariants(input),
      ...workDelegationFindings(input.model, input.observation.delegation, selectedReference)],
  });
}

export function buildIntegrationScenario(): DeliveryScenario {
  const system = new EventChain({ storeId: "store-exact-integration", processId: "delivery-exact-integration" });
  system.append("delivery-created", {});
  const prepared = prepareSuccessful(system, { suffix: "integration" });
  const admitted = admitSuccessful(system, prepared, { suffix: "integration" });
  const activityId = "integration-generated";
  const assessment = subject("assessment-generated");
  const candidate = subject(admitted.candidate.recordId, admitted.candidate.revision + 1);
  const parentCommit = "c".repeat(40);
  const contextFacts = integrationAssessmentFacts(admitted.boundary, admitted.candidate, "constructed", true, parentCommit);
  const assess = (outcome: "constructed" | "conflicted" | "invalid", contextChanged = false, wrongSource = false) => (chain: EventChain) => {
    chain.append("integration-assessed", { activityId }, assessment,
      integrationAssessmentFacts(admitted.boundary, wrongSource ? subject("wrong-source") : admitted.candidate, outcome, contextChanged, parentCommit));
  };
  const select = (fault?: "parent" | "source" | "boundary" | "observation") => (chain: EventChain) => {
    chain.append("candidate-revision-observed", { activityId }, candidate, {
      recordKind: "candidate-revision", payload: { ...candidateRevisionV2Payload("integration-successor"), candidateBaseCommit: fault === "parent" ? "d".repeat(40) : parentCommit,
        ...(fault === "observation" ? { observer: { implementationId: "substituted-observer", implementationDigest: effect("substituted-observer") } } : {}) },
      relationships: [relationship("governed-by", "work-boundary", fault === "boundary" ? subject("wrong-boundary") : admitted.boundary),
        relationship("revises", "candidate-revision", fault === "source" ? subject("wrong-source") : admitted.candidate),
        relationship("integrated-from", "integration-assessment", assessment)],
    });
  };
  const commands = bindCommands(integrationOracle, {
    start: (chain) => { chain.append("activity-started", { activityId, operation: "delivery.integrate" }); },
    "assess-clean": assess("constructed"), "assess-context": assess("constructed", true),
    "assess-conflict": assess("conflicted"), "assess-invalid": assess("invalid"), "assess-wrong-source": assess("constructed", false, true),
    candidate: select(), "candidate-wrong-parent": select("parent"), "candidate-wrong-source": select("source"), "candidate-wrong-boundary": select("boundary"),
    "candidate-wrong-observation": select("observation"),
    condition: (chain) => {
      const observedFactsDigest = digestCanonical(contextFacts.payload!.contextualApplicability);
      chain.append("material-condition-frozen", { activityId, sourceKind: "integration-assessment", observedFactsDigest }, subject("integration-condition"), {
        recordKind: "material-condition", payload: { conditionClass: "integration-context-change", source: { kind: "integration-assessment" }, observedFactsDigest },
        relationships: [relationship("reported-by", "integration-assessment", assessment), relationship("freezes", "candidate-revision", candidate),
          relationship("governed-by", "work-boundary", admitted.boundary)],
      });
    },
    complete: (chain) => { chain.append("activity-completed", { activityId, outcome: "completed" }); },
  });
  return scenario(integrationOracle, "initial-candidate-before-integration", system, commands);
}

export function buildPreIntentRefusalRecoveryScenario(): DeliveryScenario {
  const system = new EventChain({
    storeId: "store-pre-intent-refusal-recovery",
    processId: "delivery-pre-intent-refusal-recovery",
  });
  const activityId = "prepare-pre-intent-refusal-recovery";
  const brief = subject("brief-pre-intent-refusal-recovery");
  const attempt = subject("attempt-pre-intent-refusal-recovery");
  const effectDigest = effect("pre-intent-refusal-recovery");
  const oracle: DeliveryOracle = Object.freeze({
    ...preIntentRefusalOracle,
    initialModel: Object.freeze({ ...preIntentRefusalOracle.initialModel, effectDigest }),
  });
  system.append("delivery-created", {});
  system.append("director-brief-submitted", { activityId }, brief, explicitFacts("director-brief"));
  system.append("activity-started", { activityId, operation: "delivery.prepare" });
  const refusal = Object.freeze({
    activityId,
    resolution: "none",
    diagnosticCode: "lifecycle.agent-execution-cell-v1.pre-intent-contained",
    refusalFactsDigest: effect("contained-pre-intent-refusal"),
  });
  const commands = bindCommands(oracle, {
    recover: (chain) => {
      const contains = (kind: string) => chain.events.some((event) =>
        event.eventKind === kind && event.payload.activityId === activityId);
      const intended = contains("provider-effect-intended");
      chain.append("activity-recovery-recorded", {
        activityId,
        kind: intended ? "provider" : "finalization",
        resumesAt: intended ? "provider-effect-observed" : contains("agent-pre-intent-refused")
          ? "activity-completed" : contains("agent-attempt-prepared")
            ? "provider-effect-intended" : "agent-attempt-prepared",
        exactEffectDigest: intended ? effectDigest : null,
      });
    },
    "recover-wrong-step": (chain) => {
      chain.append("activity-recovery-recorded", {
        activityId, kind: "finalization", resumesAt: "work-product-observation", exactEffectDigest: null,
      });
    },
    "refuse-none": (chain) => { chain.append("agent-pre-intent-refused", refusal); },
    "refuse-with-subject": (chain) => { chain.append("agent-pre-intent-refused", refusal, brief); },
    "prepare-attempt": (chain) => {
      chain.append("agent-attempt-prepared", { activityId }, attempt, attemptFacts(brief));
    },
    "intend-provider": (chain) => {
      chain.append("provider-effect-intended", { activityId, effectDigest }, attempt, attemptFacts(brief));
    },
    "complete-abandoned": (chain) => { chain.append("activity-completed", { activityId, outcome: "abandoned" }); },
    "complete-failed": (chain) => { chain.append("activity-completed", { activityId, outcome: "failed" }); },
    "complete-success": (chain) => { chain.append("activity-completed", { activityId, outcome: "completed" }); },
  });
  return scenario(oracle, "opened-preparation-with-no-attempt-or-intent", system, commands);
}

export function buildProjectionRefusalScenario(operation: "delivery.continue" | "delivery.evaluate" = "delivery.evaluate"): DeliveryScenario {
  const reviewer = operation === "delivery.evaluate";
  const oracle = reviewer ? projectionRefusalOracle : builderProjectionRefusalOracle;
  const active = seedActiveDelivery("projection-refusal");
  const { system, boundary, candidate } = active;
  const activityId = "evaluation-projection-refusal";
  const seal = subject("seal-projection-refusal");
  const brief = subject("brief-projection-refusal");
  const factsDigest = effect("measured-projection-refusal");
  system.append("director-brief-submitted", { activityId }, brief, explicitFacts("director-brief"));
  system.append("activity-started", { activityId, operation });
  if (reviewer) {
    system.append("candidate-sealed", { activityId }, seal, explicitFacts("candidate-seal", {}, [
    relationship("seals", "candidate-revision", candidate), relationship("governed-by", "work-boundary", boundary),
  ]));
  system.append("check-receipt-recorded", { activityId }, subject("final-check-projection-refusal"),
    checkFacts("final", "regression-guard", "pass", relationship("checks-seal", "candidate-seal", seal)));
  }
  const freeze = (fault?: "candidate" | "facts") => (chain: EventChain) => {
    const refusal = [...chain.events].reverse().find((event) => event.eventKind === "agent-pre-intent-refused");
    const source = { kind: "projection-compilation", requestDigest: effect("projection-request"),
      profile: { id: "projection.bounded", digest: effect("projection-profile") },
      mandatoryFacts: { mandatoryItems: 2, mandatoryBytes: 300, sourceBytes: 0,
        maximumMandatoryItems: 1, maximumMandatoryBytes: 200, maximumItemBytes: 200, maximumSourceBytes: 200, oversized: [] },
      refusalFactsDigest: factsDigest };
    const target = fault === "candidate" ? subject("wrong-projection-candidate") : candidate;
    const relationships = [relationship("governed-by", "work-boundary", boundary),
      relationship("freezes", "candidate-revision", target), ...(reviewer ? [relationship("observed-in", "candidate-seal", seal)] : [])];
    // The adapter constructs the declared wire facts; the independent oracle
    // above decides legality without importing their production owner.
    const observedFactsDigest = fault === "facts" ? effect("wrong-projection-facts") : digestCanonical({
      schema: "lifecycle.projection-condition-observed-facts.v1", activityId,
      boundary: relationships[0]!.target, candidate: relationships[1]!.target, seal: reviewer ? relationships[2]!.target : null,
      refusalEvent: { sequence: refusal?.sequence ?? 1, digest: refusal?.digest ?? effect("absent-refusal") }, source,
    });
    chain.append("material-condition-frozen", { activityId, sourceKind: "projection-compilation", observedFactsDigest },
      subject("projection-condition"), explicitFacts("material-condition", {
        conditionClass: "projection-closure-exceeded", source, observedFactsDigest,
      }, relationships));
  };
  const commands = bindCommands(oracle, {
    refuse: (chain) => { chain.append("agent-pre-intent-refused", { resolution: "projection-condition-required", activityId,
      diagnosticCode: "lifecycle.projection.mandatory-too-large", refusalFactsDigest: factsDigest }); },
    freeze: freeze(), "freeze-wrong-candidate": freeze("candidate"), "freeze-wrong-facts": freeze("facts"),
    complete: (chain) => { chain.append("activity-completed", { activityId, outcome: "abandoned" }); },
    recover: (chain) => {
      const frozen = chain.events.some((event) => event.eventKind === "material-condition-frozen" && event.payload.activityId === activityId);
      const refused = chain.events.some((event) => event.eventKind === "agent-pre-intent-refused" && event.payload.activityId === activityId);
      chain.append("activity-recovery-recorded", { activityId, kind: "finalization", exactEffectDigest: null,
        resumesAt: frozen ? "activity-completed" : refused ? "activity-finalization" : reviewer ? "evaluation-checks" : "agent-attempt-prepared" });
    },
  });
  return scenario(oracle, reviewer ? "sealed-result-before-reviewer-allocation" : "candidate-before-builder-allocation", system, commands);
}

type ContinuationCourse = Readonly<{
  id: string;
  system: EventChain;
  goal: DeliveryContinuationGoal;
  prefixes: readonly Readonly<{ id: string; eventCount: number }>[];
}>;

export type DeliveryContinuationScenario = DeliveryScenario & Readonly<{
  continuation: Readonly<{
    course: string;
    prefix: string;
    retainedEventCount: number;
    responseCount: number;
    goal: DeliveryContinuationGoal;
  }>;
}>;

function exactGoalSubject(selected: ControlRecordEventSubject) {
  return Object.freeze({ id: selected.recordId, revision: selected.revision, digest: selected.digest });
}

function appendReadmission(resolved: AwaitingReadmissionSeed, suffix: string): ActiveDeliverySeed {
  const { system } = resolved;
  const activityId = `readmit-${suffix}`;
  const decision = subject(`decision-${activityId}`);
  const transactionEffect = effect(activityId);
  const candidate = subject(resolved.candidate.recordId, resolved.candidate.revision + 1);
  const retainedCandidate = system.resolveRevision(resolved.candidate);
  if (retainedCandidate === null) throw new TypeError("Readmission fixture lost its exact continuing Candidate");
  system.append("activity-started", { activityId, operation: "delivery.admit" });
  system.append("director-decision-authenticated", { activityId }, decision, explicitFacts("director-decision", {
    decision: "readmit",
  }, [
    relationship("selects-boundary", "work-boundary", resolved.proposedBoundary),
    relationship("selects-baseline-receipt", "check-receipt", resolved.proposedBaselineReceipt),
    relationship("continues-from-boundary", "work-boundary", resolved.boundary),
    relationship("resolves", "material-condition", resolved.condition),
    relationship("selects-candidate", "candidate-revision", resolved.candidate),
  ]));
  system.append("transaction-effect-intended", { activityId, effectDigest: transactionEffect }, decision);
  system.append("transaction-effect-observed", { activityId, effectDigest: transactionEffect, outcome: "applied" }, decision);
  system.append("candidate-revision-observed", { activityId }, candidate, explicitFacts("candidate-revision",
    { ...retainedCandidate.payload, observation: "readmission-rebind" }, [
      relationship("revises", "candidate-revision", resolved.candidate),
      relationship("governed-by", "work-boundary", resolved.proposedBoundary),
    ]));
  system.append("activity-completed", { activityId, outcome: "completed" });
  return Object.freeze({ system, boundary: resolved.proposedBoundary,
    baselineReceipt: resolved.proposedBaselineReceipt, candidate });
}

/** An authored finite response course, not an implementation-selected route. */
function finishProductiveContinuation(active: ActiveDeliverySeed, suffix: string) {
  const corrected = appendContinueThroughReceipt(active, `correction-${suffix}`, "progress");
  active.system.append("activity-completed", { activityId: corrected.activityId, outcome: "completed" });
  const integrated = integrateSuccessful(active.system, active.boundary, corrected.candidate);
  const evaluated = finishDecisionReady(appendEvaluationThroughReceipt({ ...active, candidate: integrated.candidate },
    `renewed-${suffix}`), `renewed-${suffix}`);
  return Object.freeze({
    goal: Object.freeze({ boundary: exactGoalSubject(active.boundary), assessment: exactGoalSubject(integrated.assessment), candidate: exactGoalSubject(integrated.candidate),
      seal: exactGoalSubject(evaluated.seal), evidence: exactGoalSubject(evaluated.evidence) }),
    correctionActivityId: corrected.activityId,
    integrationActivityId: `integrate-${corrected.candidate.recordId}-${corrected.candidate.revision}`,
  });
}

function eventCoordinate(system: EventChain, eventKind: string, activityId: string): number {
  const matching = system.events.filter((event) => event.eventKind === eventKind && event.payload.activityId === activityId);
  if (matching.length !== 1) throw new TypeError(`Continuation must name one ${eventKind} for ${activityId}`);
  return matching[0]!.sequence;
}

function refusalContinuationCourse(operation: "delivery.continue" | "delivery.evaluate"): ContinuationCourse {
  const id = operation === "delivery.continue" ? "builder-refusal-readmission" : "reviewer-refusal-readmission";
  const opening = buildProjectionRefusalScenario(operation);
  const system = opening.seeds[0]!.system.fork();
  const retained = system.events.length;
  // These three declared responses reuse the mechanical fixture for the exact
  // owner-issued refusal; no Runtime eligibility chooses or skips a response.
  for (const commandId of ["refuse", "freeze", "complete"]) {
    opening.commands.find(({ id: command }) => command === commandId)!.apply(system, []);
  }
  const paused: PausedDeliverySeed = {
    system, boundary: subject("boundary-projection-refusal-base"),
    baselineReceipt: subject("baseline-check-projection-refusal-base"),
    candidate: subject("candidate-projection-refusal-base", 2), condition: subject("projection-condition"),
  };
  const resolved = resolvePausedBoundary(paused, id);
  const readmitted = appendReadmission(resolved, id);
  const completed = finishProductiveContinuation(readmitted, id);
  return Object.freeze({ id, system, goal: completed.goal, prefixes: Object.freeze([
    { id: "unallocated-opening", eventCount: retained },
    { id: "lost-return-after-required-refusal", eventCount: retained + 1 },
    { id: "lost-return-after-condition", eventCount: retained + 2 },
    { id: "lost-return-after-resolution", eventCount: eventCoordinate(system, "work-boundary-finalized", `reaffirm-${id}`) },
    { id: "lost-return-after-applied-readmission", eventCount: eventCoordinate(system, "transaction-effect-observed", `readmit-${id}`) },
    { id: "lost-return-after-correction-intent", eventCount: eventCoordinate(system, "provider-effect-intended", completed.correctionActivityId) },
    { id: "lost-return-after-evidence", eventCount: eventCoordinate(system, "evidence-packet-finalized", `evaluate-renewed-${id}`) },
  ]) });
}

function failedProviderContinuationCourse(): ContinuationCourse {
  const id = "failed-provider-retained-candidate";
  const active = seedActiveDelivery(id);
  const { system } = active;
  const started = startContinueAttempt(active, id);
  appendProviderIntent(system, started);
  const retained = system.events.length;
  appendProviderObservation(system, started, "failed");
  system.append("agent-work-product-abandoned", { activityId: started.activityId }, started.attempt);
  const candidate = subject(active.candidate.recordId, active.candidate.revision + 1);
  system.append("candidate-revision-observed", { activityId: started.activityId }, candidate, explicitFacts("candidate-revision",
    candidateRevisionV2Payload("builder-successor"), [
      relationship("revises", "candidate-revision", active.candidate),
      relationship("governed-by", "work-boundary", active.boundary),
      relationship("result-of", "agent-attempt", started.attempt),
    ]));
  system.append("execution-receipt-recorded", { activityId: started.activityId }, subject(`receipt-${id}`), explicitFacts("execution-receipt"));
  system.append("activity-completed", { activityId: started.activityId, outcome: "failed" });
  const completed = finishProductiveContinuation({ ...active, candidate }, id);
  return Object.freeze({ id, system, goal: completed.goal, prefixes: Object.freeze([
    { id: "pending-provider-observation", eventCount: retained },
    { id: "lost-return-after-failed-provider", eventCount: retained + 1 },
    { id: "lost-return-after-retained-candidate", eventCount: retained + 3 },
    { id: "lost-return-after-correction-intent", eventCount: eventCoordinate(system, "provider-effect-intended", completed.correctionActivityId) },
    { id: "lost-return-after-evidence", eventCount: eventCoordinate(system, "evidence-packet-finalized", `evaluate-renewed-${id}`) },
  ]) });
}

function conflictedIntegrationContinuationCourse(): ContinuationCourse {
  const id = "conflicted-assessment-correction";
  const active = seedActiveDelivery(id);
  const { system } = active;
  const activityId = `failed-integrate-${id}`;
  system.append("activity-started", { activityId, operation: "delivery.integrate" });
  const retained = system.events.length;
  system.append("integration-assessed", { activityId }, subject(`failed-assessment-${id}`),
    integrationAssessmentFacts(active.boundary, active.candidate, "conflicted"));
  system.append("activity-completed", { activityId, outcome: "completed" });
  const completed = finishProductiveContinuation(active, id);
  return Object.freeze({ id, system, goal: completed.goal, prefixes: Object.freeze([
    { id: "pending-conflict-assessment", eventCount: retained },
    { id: "lost-return-after-conflicted-assessment", eventCount: retained + 1 },
    { id: "lost-return-after-correction-intent", eventCount: eventCoordinate(system, "provider-effect-intended", completed.correctionActivityId) },
    { id: "lost-return-after-integration-candidate", eventCount: eventCoordinate(system, "candidate-revision-observed", completed.integrationActivityId) },
    { id: "lost-return-after-evidence", eventCount: eventCoordinate(system, "evidence-packet-finalized", `evaluate-renewed-${id}`) },
  ]) });
}

function retainedPrefix(course: ContinuationCourse, eventCount: number): EventChain {
  const prefix = new EventChain({ storeId: course.system.storeId, processId: course.system.processId,
    occurredAt: course.system.occurredAt });
  for (const event of course.system.events.slice(0, eventCount)) {
    const revision = event.subject === null ? null : course.system.resolveRevision(event.subject);
    prefix.append(event.eventKind, event.payload, event.subject, revision ?? {});
  }
  return prefix;
}

/**
 * Each retained prefix gets its own scenario and required goal. Aggregate phase
 * coverage cannot let a successful prefix discharge a different obligation.
 * A lost return is represented by replaying that exact prefix with no cached
 * reducer result, then supplying only its remaining responses. It is not a
 * process crash, Control Store, provider dispatch or physical-custody test.
 */
export function buildDeliveryContinuationScenarios(): readonly DeliveryContinuationScenario[] {
  const courses = [failedProviderContinuationCourse(), conflictedIntegrationContinuationCourse(),
    refusalContinuationCourse("delivery.continue"), refusalContinuationCourse("delivery.evaluate")];
  return Object.freeze(courses.flatMap((course) => course.prefixes.map((prefix) => {
    const responses = course.system.events.slice(prefix.eventCount);
    const responseCount = responses.length;
    if (responseCount === 0) throw new TypeError("A continuation seed must retain an unfinished obligation");
    const id = `delivery-continuation/${course.id}/${prefix.id}`;
    const system = retainedPrefix(course, prefix.eventCount);
    return Object.freeze({
      id,
      clauses: Object.freeze([deliveryProperties.boundedContinuation, deliveryProperties.nonterminalProgress]),
      bounds: Object.freeze({ maxDepth: responseCount, maxNodes: responseCount + 1, maxTransitions: responseCount }),
      requiredCoverage: Object.freeze({ phases: Object.freeze(["productive-goal"]),
        acceptedCommands: Object.freeze(["supply-next-response"]),
        eventKinds: Object.freeze([...new Set(course.system.events.map(({ eventKind }) => eventKind))]),
        generatedEventKinds: Object.freeze([...new Set(responses.map(({ eventKind }) => eventKind))]) }),
      seeds: Object.freeze([{ id: prefix.id, system, model: continuationModel(0, responseCount) }]),
      commands: Object.freeze([{
        id: "supply-next-response",
        expectation(model: DeliveryOracleModel) {
          const completed = Number(model.phase.slice("response-".length));
          if (!Number.isSafeInteger(completed) || completed < 0 || completed >= responseCount) {
            throw new TypeError("Continuation response requested outside its exact finite horizon");
          }
          return Object.freeze({ kind: "accepted" as const, next: continuationModel(completed + 1, responseCount) });
        },
        apply(chain: EventChain, trace: readonly string[]) {
          const event = responses[trace.length - 1];
          if (event === undefined) throw new TypeError("Continuation has no response at this coordinate");
          const revision = event.subject === null ? null : course.system.resolveRevision(event.subject);
          chain.append(event.eventKind, event.payload, event.subject, revision ?? {});
        },
      }]),
      observe: (chain: EventChain) => observeDeliverySystem(chain, prefix.eventCount),
      invariants: ({ model, observation, trace }: Readonly<{ model: DeliveryOracleModel; observation: DeliverySystemObservation; trace: readonly string[] }>) =>
        continuationFindings({ model, observation, completedResponses: trace.length,
          expectedEventKinds: course.system.events.slice(0, prefix.eventCount + trace.length).map(({ eventKind }) => eventKind), goal: course.goal }),
      fingerprint: fingerprintDeliverySystem,
      continuation: Object.freeze({ course: course.id, prefix: prefix.id, retainedEventCount: prefix.eventCount, responseCount, goal: course.goal }),
    });
  })));
}
