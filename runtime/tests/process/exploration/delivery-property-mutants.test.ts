import assert from "node:assert/strict";
import test from "node:test";

import { exploreScenario, type ExplorationClause, type ExplorationFinding } from "./bounded-explorer.js";
import {
  deliveryInvariants,
  type DeliveryObservation,
  type DeliveryOracleModel,
} from "./delivery-oracle.js";
import { deliveryProperties } from "./delivery-properties.js";
import { workDelegationFindings, workDelegationOracle } from "./delivery-work-delegation-oracle.js";
import {
  buildCandidatePresentNoShipScenario,
  buildInitialAdmissionScenario,
  buildIntegrationScenario,
  buildDeliveryContinuationScenarios,
  buildNoCandidateNoShipScenario,
  buildPreparationRecoveryScenario,
} from "./delivery-reducer-scenarios.js";

const selected = Object.freeze({
  id: "mutant-subject",
  revision: 1,
  digest: `sha256:${"0".repeat(64)}`,
});

const ACTIVE_OPERATIONS = Object.freeze([
  "delivery.continue",
  "delivery.evaluate",
  "delivery.no-ship",
]);
const FRESH_OPERATIONS = Object.freeze([
  "delivery.prepare",
  "delivery.no-ship",
]);
const RECOVER_ONLY = Object.freeze(["delivery.recover"]);

function subjects(
  changes: Partial<DeliveryObservation["subjects"]> = {},
): DeliveryObservation["subjects"] {
  return Object.freeze({
    integrationAssessment: null,
    proposedBoundary: null,
    activeBoundary: null,
    candidate: null,
    materialCondition: null,
    seal: null,
    evidence: null,
    closure: null,
    ...changes,
  });
}

function observation(
  changes: Partial<DeliveryObservation> = {},
): DeliveryObservation {
  return Object.freeze({
    standing: "framing",
    candidateCondition: "absent",
    activities: Object.freeze([]),
    subjects: subjects(),
    eligibleOperations: FRESH_OPERATIONS,
    journal: Object.freeze({ eventCount: 0 }),
    eventKinds: Object.freeze([]),
    ...changes,
  });
}

function profileModel(
  changes: Partial<NonNullable<DeliveryOracleModel["profile"]>> = {},
  modelChanges: Partial<Omit<DeliveryOracleModel, "profile">> = {},
): DeliveryOracleModel {
  return Object.freeze({
    kind: "progression",
    phase: "property-mutant",
    candidatePresent: false,
    ...modelChanges,
    profile: Object.freeze({
      standing: "framing",
      candidateCondition: "absent",
      recovery: null,
      activeActivityCount: 0,
      subjects: Object.freeze({
        integrationAssessment: false,
        proposedBoundary: false,
        activeBoundary: false,
        candidate: false,
        materialCondition: false,
        seal: false,
        evidence: false,
        closure: false,
      }),
      eligibleOperations: FRESH_OPERATIONS,
      ...changes,
    }),
  });
}

function activeActivity(
  recovery: DeliveryObservation["activities"][number]["recovery"],
  operation: DeliveryObservation["activities"][number]["operation"] = "delivery.prepare",
  stage: DeliveryObservation["activities"][number]["stage"] = "started",
): DeliveryObservation["activities"][number] {
  return Object.freeze({
    id: "mutant-activity",
    operation,
    family: "agent",
    stage,
    recovery,
  });
}

function findingCoordinates(
  findings: readonly ExplorationFinding[],
): readonly Readonly<{ id: string; propertyId: string }>[] {
  return findings.map((finding) => {
    assert.equal(typeof finding, "object");
    assert.notEqual(finding, null);
    const retained = finding as Readonly<Record<string, unknown>>;
    assert.equal(typeof retained.id, "string");
    assert.equal(typeof retained.propertyId, "string");
    return Object.freeze({
      id: retained.id as string,
      propertyId: retained.propertyId as string,
    });
  });
}

type InvariantMutant = Readonly<{
  name: string;
  property: ExplorationClause;
  findingId: string;
  input(): Readonly<{
    model: DeliveryOracleModel;
    observation: DeliveryObservation;
  }>;
}>;

const invariantMutants: readonly InvariantMutant[] = Object.freeze([
  Object.freeze({
    name: "a recovery label cannot hide an absent Candidate",
    property: deliveryProperties.candidateAbsence,
    findingId: "candidate.absence-is-independent",
    input: () => Object.freeze({
      model: profileModel(),
      observation: observation({ candidateCondition: "terminal-recovery" }),
    }),
  }),
  Object.freeze({
    name: "an existing Candidate cannot project the absent condition",
    property: deliveryProperties.candidateAbsence,
    findingId: "candidate.present-cannot-be-absent",
    input: () => Object.freeze({
      model: profileModel({
        standing: "active",
        candidateCondition: "absent",
        subjects: Object.freeze({ activeBoundary: true, candidate: true }),
        eligibleOperations: ACTIVE_OPERATIONS,
      }, { candidatePresent: true }),
      observation: observation({
        standing: "active",
        candidateCondition: "absent",
        subjects: subjects({ activeBoundary: selected, candidate: selected }),
        eligibleOperations: ACTIVE_OPERATIONS,
      }),
    }),
  }),
  Object.freeze({
    name: "pre-effect Candidate work cannot be collapsed into terminal recovery",
    property: deliveryProperties.candidateCondition,
    findingId: "candidate.condition-differs-from-phase",
    input: () => Object.freeze({
      model: profileModel({
        standing: "active",
        candidateCondition: "in-progress",
        recovery: "finalization/provider-effect-intended",
        activeActivityCount: 1,
        activeOperation: "delivery.continue",
        activeFamily: "agent",
        subjects: Object.freeze({ activeBoundary: true, candidate: true }),
        eligibleOperations: RECOVER_ONLY,
      }, { candidatePresent: true }),
      observation: observation({
        standing: "active",
        candidateCondition: "terminal-recovery",
        activities: Object.freeze([activeActivity(Object.freeze({
          kind: "finalization",
          resumesAt: "provider-effect-intended",
          exactEffectDigest: null,
        }), "delivery.continue", "prepared")]),
        subjects: subjects({ activeBoundary: selected, candidate: selected }),
        eligibleOperations: RECOVER_ONLY,
      }),
    }),
  }),
  Object.freeze({
    name: "active standing cannot exist without its governing Boundary",
    property: deliveryProperties.standingTopology,
    findingId: "standing.active-needs-boundary",
    input: () => Object.freeze({
      model: profileModel({
        standing: "active",
        subjects: Object.freeze({}),
        eligibleOperations: ACTIVE_OPERATIONS,
      }),
      observation: observation({
        standing: "active",
        eligibleOperations: ACTIVE_OPERATIONS,
      }),
    }),
  }),
  Object.freeze({
    name: "a Candidate cannot exist without an active Boundary",
    property: deliveryProperties.subjectTopology,
    findingId: "subjects.candidate-needs-active-boundary",
    input: () => Object.freeze({
      model: profileModel({
        candidateCondition: "ready-for-work",
        subjects: Object.freeze({ candidate: true }),
      }, { candidatePresent: true }),
      observation: observation({
        candidateCondition: "ready-for-work",
        subjects: subjects({ candidate: selected }),
      }),
    }),
  }),
  Object.freeze({
    name: "the active Activity stage cannot drift from its durable phase",
    property: deliveryProperties.activityTopology,
    findingId: "activities.stage-differs-from-phase",
    input: () => Object.freeze({
      model: profileModel({
        recovery: "finalization/agent-attempt-prepared",
        activeActivityCount: 1,
        activeOperation: "delivery.prepare",
        activeFamily: "agent",
        activeStage: "prepared",
        recoveryEffectBinding: "none",
        eligibleOperations: RECOVER_ONLY,
      }),
      observation: observation({
        activities: Object.freeze([activeActivity(Object.freeze({
          kind: "finalization",
          resumesAt: "agent-attempt-prepared",
          exactEffectDigest: null,
        }))]),
        eligibleOperations: RECOVER_ONLY,
      }),
    }),
  }),
  Object.freeze({
    name: "recovery must resume at the exact modeled coordinate",
    property: deliveryProperties.recoveryEligibility,
    findingId: "recovery.coordinate-differs-from-phase",
    input: () => Object.freeze({
      model: profileModel({
        recovery: "finalization/agent-attempt-prepared",
        activeActivityCount: 1,
        activeOperation: "delivery.prepare",
        activeFamily: "agent",
        eligibleOperations: RECOVER_ONLY,
      }),
      observation: observation({
        activities: Object.freeze([activeActivity(Object.freeze({
          kind: "finalization",
          resumesAt: "provider-effect-intended",
          exactEffectDigest: null,
        }))]),
        eligibleOperations: RECOVER_ONLY,
      }),
    }),
  }),
  Object.freeze({
    name: "provider recovery must retain the exact intended effect digest",
    property: deliveryProperties.recoveryEligibility,
    findingId: "recovery.effect-binding-differs-from-phase",
    input: () => Object.freeze({
      model: profileModel({
        standing: "active",
        candidateCondition: "terminal-recovery",
        recovery: "provider/provider-effect-observed",
        activeActivityCount: 1,
        activeOperation: "delivery.continue",
        activeFamily: "agent",
        activeStage: "effect-intended",
        recoveryEffectBinding: "model-effect",
        subjects: Object.freeze({ activeBoundary: true, candidate: true }),
        eligibleOperations: RECOVER_ONLY,
      }, {
        candidatePresent: true,
        effectDigest: `sha256:${"1".repeat(64)}`,
      }),
      observation: observation({
        standing: "active",
        candidateCondition: "terminal-recovery",
        activities: Object.freeze([activeActivity(Object.freeze({
          kind: "provider",
          resumesAt: "provider-effect-observed",
          exactEffectDigest: `sha256:${"2".repeat(64)}`,
        }), "delivery.continue", "effect-intended")]),
        subjects: subjects({ activeBoundary: selected, candidate: selected }),
        eligibleOperations: RECOVER_ONLY,
      }),
    }),
  }),
  Object.freeze({
    name: "the modeled active Activity cannot disappear",
    property: deliveryProperties.activityTopology,
    findingId: "activities.active-count-differs-from-phase",
    input: () => Object.freeze({
      model: profileModel({ activeActivityCount: 1 }),
      observation: observation(),
    }),
  }),
  Object.freeze({
    name: "a nonempty but incomplete operation set is rejected",
    property: deliveryProperties.operationEligibility,
    findingId: "eligibility.differs-from-scenario-oracle",
    input: () => Object.freeze({
      model: profileModel(),
      observation: observation({
        eligibleOperations: Object.freeze(["delivery.prepare"]),
      }),
    }),
  }),
  Object.freeze({
    name: "a nonterminal state cannot expose an empty operation set",
    property: deliveryProperties.nonterminalProgress,
    findingId: "progress.nonterminal-operation-sink",
    input: () => Object.freeze({
      model: profileModel({ eligibleOperations: Object.freeze([]) }),
      observation: observation({ eligibleOperations: Object.freeze([]) }),
    }),
  }),
  Object.freeze({
    name: "Closure must remain the final event",
    property: deliveryProperties.terminalOrdering,
    findingId: "closure.is-terminal",
    input: () => Object.freeze({
      model: profileModel({
        standing: "closed",
        subjects: Object.freeze({ closure: true }),
        eligibleOperations: Object.freeze([]),
      }),
      observation: observation({
        standing: "closed",
        subjects: subjects({ closure: selected }),
        eligibleOperations: Object.freeze([]),
        journal: Object.freeze({ eventCount: 1 }),
        eventKinds: Object.freeze(["activity-completed"]),
      }),
    }),
  }),
  Object.freeze({
    name: "Journal count cannot omit a retained event",
    property: deliveryProperties.journalCount,
    findingId: "journal.count-matches-history",
    input: () => Object.freeze({
      model: profileModel(),
      observation: observation({
        journal: Object.freeze({ eventCount: 0 }),
        eventKinds: Object.freeze(["delivery-created"]),
      }),
    }),
  }),
]);

function assertScenarioOwns(
  property: ExplorationClause,
  clauses: readonly ExplorationClause[],
): void {
  assert.deepEqual(
    clauses.filter(({ id }) => id === property.id).map(({ id }) => id),
    [property.id],
  );
}

function assertCodedRefusal(
  expectedCode: string,
  operation: () => unknown,
): void {
  assert.throws(operation, (error: unknown) => {
    assert.equal((error as { name?: string }).name, "FoundationError");
    assert.equal((error as { code?: string }).code, expectedCode);
    return true;
  });
}

type RouteMutant = Readonly<{
  name: string;
  property: ExplorationClause;
  kill(): void;
}>;

const routeMutants: readonly RouteMutant[] = Object.freeze([
  Object.freeze({
    name: "resource permission retains Stop, exact subject, and lifetime charges",
    property: deliveryProperties.workDelegation,
    kill: () => {
      const model = { ...workDelegationOracle.initialModel, phase: "stopped" };
      const exact = { current: { reference: selected, stopped: true },
        charged: { operations: 0, agentAttempts: 0, reservedCellWallTimeMs: 0 } };
      assert.deepEqual(workDelegationFindings(model, exact, selected), []);
      for (const observed of [
        { ...exact, current: { ...exact.current, stopped: false } },
        { ...exact, current: { ...exact.current, reference: { ...selected, revision: 2 } } },
        { ...exact, charged: { ...exact.charged, operations: 1 } },
      ]) assert.equal(workDelegationFindings(model, observed, selected).length, 1);
    },
  }),
  Object.freeze({
    name: "retained Evidence cannot remain recover-only after its supplied completion response",
    property: deliveryProperties.boundedContinuation,
    kill: () => {
      const scenario = buildDeliveryContinuationScenarios().find(({ continuation }) =>
        continuation.course === "failed-provider-retained-candidate" && continuation.prefix === "lost-return-after-evidence")!;
      const report = exploreScenario({ ...scenario, commands: scenario.commands.map((command) => ({ ...command,
        apply() { /* Mutation: lose every completion response, retaining the recover-only prefix. */ },
      })) });
      assert.equal(report.maximumDepthReached, 1);
      assert.equal(report.transitions.expectationMismatches, 0);
      assert.ok(report.findings.some(({ finding }) => typeof finding === "object" &&
        finding.id === "continuation.productive-goal-not-reached"));
      assert.equal(report.findings.some(({ finding }) => typeof finding === "object" &&
        finding.propertyId === deliveryProperties.nonterminalProgress.id), false);
    },
  }),
  ...["no-ship-only", "missing-evidence"].map((mutation) => Object.freeze({
    name: `a ${mutation} observation cannot satisfy productive completion`,
    property: deliveryProperties.boundedContinuation,
    kill: () => {
      const scenario = buildDeliveryContinuationScenarios().find(({ continuation }) =>
        continuation.course === "conflicted-assessment-correction" && continuation.prefix === "lost-return-after-evidence")!;
      const report = exploreScenario({ ...scenario, observe(system) {
        const observed = scenario.observe(system);
        if (observed.standing !== "decision-ready") return observed;
        return { ...observed,
          ...(mutation === "no-ship-only" ? { eligibleOperations: ["delivery.no-ship"] }
            : { subjects: { ...observed.subjects, evidence: null } }),
        };
      } });
      assert.equal(report.transitions.expectationMismatches, 0);
      assert.ok(report.findings.some(({ finding }) => typeof finding === "object" &&
        finding.id === "continuation.productive-goal-not-reached"));
      assert.equal(report.findings.some(({ finding }) => typeof finding === "object" &&
        finding.propertyId === deliveryProperties.nonterminalProgress.id), false);
    },
  })),
  Object.freeze({
    name: "a required Condition cannot be skipped on the way to readmission",
    property: deliveryProperties.boundedContinuation,
    kill: () => {
      const scenario = buildDeliveryContinuationScenarios().find(({ continuation }) =>
        continuation.course === "builder-refusal-readmission" && continuation.prefix === "lost-return-after-required-refusal")!;
      const report = exploreScenario({ ...scenario, commands: scenario.commands.map((command) => ({ ...command,
        apply(system, trace) {
          if (trace.length !== 1) command.apply(system, trace);
        },
      })) });
      assert.ok(report.findings.some(({ finding }) => typeof finding === "object" &&
        finding.id === "continuation.response-not-retained"));
      assert.equal(report.transitions.expectationMismatches, 1);
      assert.deepEqual(report.refusalCodes.map(({ code }) => code), ["lifecycle.delivery-reducer.order"]);
      assert.deepEqual(report.coverage.requirements.missing.phases, ["productive-goal"]);
    },
  }),
  ...["candidate-wrong-parent", "candidate-wrong-observation"].map((mutationCommand) => Object.freeze({
    name: `integration refuses ${mutationCommand}`,
    property: deliveryProperties.integrationOrdering,
    kill: () => {
      const scenario = buildIntegrationScenario();
      assertScenarioOwns(deliveryProperties.integrationOrdering, scenario.clauses);
      const seed = scenario.seeds[0]!;
      const chain = seed.system.fork();
      let model = seed.model;
      for (const id of ["start", "assess-clean"]) {
        const command = scenario.commands.find((item) => item.id === id)!;
        const expected = command.expectation(model);
        assert.equal(expected.kind, "accepted");
        if (expected.kind !== "accepted") throw new TypeError("Integration mutation setup is not allowed");
        command.apply(chain, [id]);
        assert.doesNotThrow(() => scenario.observe(chain));
        model = expected.next;
      }
      const substitute = scenario.commands.find((item) => item.id === mutationCommand)!;
      assert.deepEqual(substitute.expectation(model), { kind: "refused", classes: ["lifecycle.delivery-reducer.reference"] });
      substitute.apply(chain, ["start", "assess-clean", mutationCommand]);
      assertCodedRefusal("lifecycle.delivery-reducer.reference", () => scenario.observe(chain));
    },
  })),
  Object.freeze({
    name: "preparation refuses a recovery record for the wrong durable step",
    property: deliveryProperties.preparationRecovery,
    kill: () => {
      const scenario = buildPreparationRecoveryScenario();
      assertScenarioOwns(deliveryProperties.preparationRecovery, scenario.clauses);
      const chain = scenario.seeds[0]!.system.fork();
      const opening = chain.events.find((event) =>
        event.eventKind === "activity-started" &&
        event.payload.operation === "delivery.prepare");
      const activityId = opening?.payload.activityId;
      if (typeof activityId !== "string") {
        throw new TypeError("Preparation mutant seed has no activity identity");
      }
      chain.append("activity-recovery-recorded", {
        activityId,
        kind: "finalization",
        resumesAt: "transaction-effect-intended",
        exactEffectDigest: null,
      });
      assertCodedRefusal(
        "lifecycle.delivery-reducer.recovery",
        () => scenario.observe(chain),
      );
    },
  }),
  Object.freeze({
    name: "admission refuses transaction intent before Director authority",
    property: deliveryProperties.initialAdmissionOrdering,
    kill: () => {
      const scenario = buildInitialAdmissionScenario();
      assertScenarioOwns(deliveryProperties.initialAdmissionOrdering, scenario.clauses);
      const seed = scenario.seeds[0]!;
      const command = scenario.commands.find(({ id }) => id === "intend");
      assert.notEqual(command, undefined);
      assert.deepEqual(command!.expectation(seed.model), {
        kind: "refused",
        classes: ["lifecycle.delivery-reducer.reference"],
      });
      const chain = seed.system.fork();
      command!.apply(chain, ["intend"]);
      assertCodedRefusal(
        "lifecycle.delivery-reducer.reference",
        () => scenario.observe(chain),
      );
    },
  }),
  Object.freeze({
    name: "no-ship refuses effect observation after authority but before intent",
    property: deliveryProperties.noShipOrdering,
    kill: () => {
      const scenario = buildNoCandidateNoShipScenario();
      assertScenarioOwns(deliveryProperties.noShipOrdering, scenario.clauses);
      const seed = scenario.seeds.find(({ id }) =>
        id === "failed-preparation-no-ship-started");
      assert.notEqual(seed, undefined);
      const authenticate = scenario.commands.find(({ id }) => id === "authenticate");
      const observe = scenario.commands.find(({ id }) => id === "observe-applied");
      assert.notEqual(authenticate, undefined);
      assert.notEqual(observe, undefined);

      const authorized = authenticate!.expectation(seed!.model);
      assert.equal(authorized.kind, "accepted");
      if (authorized.kind !== "accepted") {
        throw new TypeError("No-ship authority mutant did not reach its authorized phase");
      }
      assert.deepEqual(observe!.expectation(authorized.next), {
        kind: "refused",
        classes: ["lifecycle.delivery-reducer.reference"],
      });

      const chain = seed!.system.fork();
      authenticate!.apply(chain, ["authenticate"]);
      assert.doesNotThrow(() => scenario.observe(chain));
      observe!.apply(chain, ["authenticate", "observe-applied"]);
      assertCodedRefusal(
        "lifecycle.delivery-reducer.reference",
        () => scenario.observe(chain),
      );
    },
  }),
  Object.freeze({
    name: "no-ship refuses Closure before an applied transaction effect",
    property: deliveryProperties.noShipOrdering,
    kill: () => {
      const scenario = buildCandidatePresentNoShipScenario();
      assertScenarioOwns(deliveryProperties.noShipOrdering, scenario.clauses);
      const seed = scenario.seeds[0]!;
      const command = scenario.commands.find(({ id }) => id === "record-closure");
      assert.notEqual(command, undefined);
      assert.deepEqual(command!.expectation(seed.model), {
        kind: "refused",
        classes: ["lifecycle.delivery-reducer.order"],
      });
      const chain = seed.system.fork();
      command!.apply(chain, ["record-closure"]);
      assertCodedRefusal(
        "lifecycle.delivery-reducer.order",
        () => scenario.observe(chain),
      );
    },
  }),
]);

const mutationCases = Object.freeze([...invariantMutants, ...routeMutants]);

test("the mutation catalogue covers every exported Delivery property at least once", () => {
  const exportedIds = Object.values(deliveryProperties).map(({ id }) => id).sort();
  const mutantIds = mutationCases.map(({ property }) => property.id).sort();
  assert.equal(new Set(exportedIds).size, exportedIds.length);
  assert.deepEqual([...new Set(mutantIds)].sort(), exportedIds);
});

for (const mutant of invariantMutants) {
  test(`${mutant.property.id} mutant: ${mutant.name}`, () => {
    const findings = deliveryInvariants(mutant.input());
    assert.deepEqual(findingCoordinates(findings), [{
      id: mutant.findingId,
      propertyId: mutant.property.id,
    }]);
  });
}

for (const mutant of routeMutants) {
  test(`${mutant.property.id} mutant: ${mutant.name}`, mutant.kill);
}

test("every declared continuation prefix has its own finite completion obligation", () => {
  const scenarios = buildDeliveryContinuationScenarios();
  const counts = new Map<string, number>();
  for (const scenario of scenarios) {
    counts.set(scenario.continuation.course, (counts.get(scenario.continuation.course) ?? 0) + 1);
    assert.equal(scenario.seeds.length, 1);
    assert.equal(scenario.seeds[0]!.id, scenario.continuation.prefix);
    assert.notEqual(scenario.seeds[0]!.model.phase, "productive-goal");
    assert.deepEqual(scenario.commands.map(({ id }) => id), ["supply-next-response"]);
    assert.deepEqual(scenario.requiredCoverage?.phases, ["productive-goal"]);
    assert.deepEqual(scenario.bounds, { maxDepth: scenario.continuation.responseCount,
      maxNodes: scenario.continuation.responseCount + 1, maxTransitions: scenario.continuation.responseCount });
    assertScenarioOwns(deliveryProperties.boundedContinuation, scenario.clauses);
  }
  assert.deepEqual(Object.fromEntries(counts), {
    "failed-provider-retained-candidate": 5,
    "conflicted-assessment-correction": 5,
    "builder-refusal-readmission": 7,
    "reviewer-refusal-readmission": 7,
  });
  assert.equal(new Set(scenarios.map(({ id }) => id)).size, 24);
});
