import type {
  ExplorationCommand,
  ExplorationScenario,
  ExplorationSeed,
} from "./bounded-explorer.js";
import {
  admissionOracle,
  deliveryInvariants,
  noShipOracle,
  preparationOracle,
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
import type { Sha256 } from "../../../src/foundation/validation/canonical.js";

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
    "founder-brief-submitted",
    { activityId },
    brief,
    explicitFacts("founder-brief"),
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
    "founder-decision",
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
        resumesAt: "founder-decision-authenticated",
        exactEffectDigest: null,
      });
    },
    authenticate: (chain: EventChain) => {
      chain.append(
        "founder-decision-authenticated",
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
    candidate: admitted.candidate,
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
    "founder-brief-submitted",
    { activityId },
    brief,
    explicitFacts("founder-brief"),
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
      roleSemantics: Object.freeze({ role: "builder", proposal: "material-condition" }),
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
    "founder-brief-submitted",
    { activityId },
    brief,
    explicitFacts("founder-brief"),
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
    "founder-brief-submitted",
    { activityId },
    brief,
    explicitFacts("founder-brief"),
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
    "founder-brief-submitted",
    { activityId },
    brief,
    explicitFacts("founder-brief"),
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
    "founder-decision-authenticated",
    { activityId },
    decision,
    explicitFacts("founder-decision", { decision: "accept" }, [
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
      relationship("closes-with", "founder-decision", decision),
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
  return explicitFacts("founder-decision", { decision: "no-ship" }, [
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
    "founder-brief-submitted",
    { activityId: preparationActivityId },
    brief,
    explicitFacts("founder-brief"),
  );
  system.append("activity-started", {
    activityId: preparationActivityId,
    operation: "delivery.prepare",
  });
  system.append("agent-pre-intent-refused", {
    activityId: preparationActivityId,
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
    "founder-decision-authenticated",
    { activityId },
    decision,
    explicitFacts(
      "founder-decision",
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
    "founder-decision-authenticated",
    { activityId },
    decision,
    explicitFacts(
      "founder-decision",
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
    "founder-decision-authenticated",
    { activityId },
    decision,
    explicitFacts("founder-decision", { decision: "no-ship" }, [
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
        "founder-decision-authenticated",
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
            relationship("closes-with", "founder-decision", decision),
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
      "founder-brief-submitted",
      { activityId },
      subject(`brief-${activityId}-${suffix}`),
      explicitFacts("founder-brief"),
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
    "founder-brief-submitted",
    { activityId },
    subject(`brief-${suffix}`),
    explicitFacts("founder-brief"),
  );
  system.append("activity-started", { activityId, operation: "delivery.prepare" });
  system.append("agent-pre-intent-refused", {
    activityId,
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
    "founder-brief-submitted",
    { activityId },
    brief,
    explicitFacts("founder-brief"),
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
    "founder-brief-submitted",
    { activityId },
    brief,
    explicitFacts("founder-brief"),
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
    "founder-brief-submitted",
    { activityId: candidateSealActivityId },
    candidateSealBrief,
    explicitFacts("founder-brief"),
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
    "founder-brief-submitted",
    { activityId: evaluationChecksActivityId },
    evaluationChecksBrief,
    explicitFacts("founder-brief"),
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
    buildInitialAdmissionScenario(),
    buildNoCandidateNoShipScenario(),
    buildCandidatePresentNoShipScenario(),
    buildRouteOpeningScenario(),
    buildRecoveryProgressionScenario(),
  ]);
}
