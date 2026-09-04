import assert from "node:assert/strict";
import test from "node:test";

import {
  BOUNDED_EXPLORATION_CONTRACT_VERSION,
  BOUNDED_EXPLORATION_REPORT_FORMAT,
  exploreScenario,
  stableJson,
  validateExplorationReport,
  type ExplorationCommand,
  type ExplorationScenario,
} from "./bounded-explorer.js";

interface MutableCounterSystem {
  value: number;
  fork(): MutableCounterSystem;
}

class CounterSystem implements MutableCounterSystem {
  constructor(public value = 0) {}

  fork(): MutableCounterSystem {
    return new CounterSystem(this.value);
  }
}

type CounterObservation = Readonly<{
  semantic: Readonly<{ value: number }>;
  eventKinds?: readonly string[];
  recoveryCoordinates?: readonly string[];
}>;

function codedRefusal(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

type CounterOverrides = Readonly<{
  id?: string;
  maxDepth?: number;
  system?: MutableCounterSystem;
  commands?: readonly ExplorationCommand<MutableCounterSystem, number>[];
  observe?: (system: MutableCounterSystem) => CounterObservation;
}>;

const COUNTER_PROPERTY = Object.freeze({
  id: "TEST.COUNTER.COHERENCE",
  owner: "runtime/tests/process/exploration/bounded-explorer.test.ts",
  classification: "test-only",
  statement: "The observed counter agrees with the independently tracked model.",
});

function counterScenario(
  overrides: CounterOverrides = {},
): ExplorationScenario<MutableCounterSystem, number, CounterObservation> {
  return {
    id: overrides.id ?? "engine-counter",
    clauses: [COUNTER_PROPERTY],
    bounds: {
      maxDepth: overrides.maxDepth ?? 2,
      maxNodes: 20,
      maxTransitions: 40,
    },
    seeds: [{ id: "zero", system: overrides.system ?? new CounterSystem(), model: 0 }],
    commands: overrides.commands ?? [
      {
        id: "increment",
        expectation(model) {
          return { kind: "accepted", next: model + 1 };
        },
        apply(system) {
          system.value += 1;
        },
      },
      {
        id: "refuse",
        expectation() {
          return { kind: "refused", classes: ["prototype.blocked"] };
        },
        apply() {
          throw codedRefusal("prototype.blocked");
        },
      },
    ],
    observe: overrides.observe ?? ((system) => ({
      semantic: { value: system.value },
      eventKinds: [],
      recoveryCoordinates: [],
    })),
    invariants({ model, observation }) {
      const findings: Array<Readonly<Record<string, unknown>>> = [];
      if (observation.semantic.value !== model) {
        findings.push({
          signature: "counter.model-divergence",
          propertyId: COUNTER_PROPERTY.id,
          expected: model,
          observed: observation.semantic.value,
        });
      }
      if (observation.semantic.value >= 2) {
        findings.push({
          signature: "counter.reaches-two",
          propertyId: COUNTER_PROPERTY.id,
          observed: observation.semantic.value,
        });
      }
      return findings;
    },
  };
}

test("stableJson recursively orders object keys", () => {
  assert.equal(
    stableJson({ z: [{ b: 2, a: 1 }], a: true }),
    '{"a":true,"z":[{"a":1,"b":2}]}',
  );
  assert.throws(() => stableJson({ value: undefined }), /cannot encode undefined/u);
  assert.throws(() => stableJson({ value: Number.NaN }), /finite numbers/u);
});

test("an explicit scenario contract version must match the engine", () => {
  assert.throws(
    () => exploreScenario({
      ...counterScenario({ id: "engine-contract-version" }),
      contractVersion: "lifecycle.bounded-exploration.contract.v2",
    }),
    /contractVersion must be lifecycle\.bounded-exploration\.contract\.v1/u,
  );
});

test("structured invariant findings require a declared property", () => {
  const base = counterScenario({ id: "engine-finding-traceability", maxDepth: 0 });
  assert.throws(
    () => exploreScenario({
      ...base,
      invariants() {
        return [{ signature: "missing-property" }];
      },
    }),
    /Structured invariant finding propertyId must be a non-empty string/u,
  );
  assert.throws(
    () => exploreScenario({
      ...base,
      invariants() {
        return [{
          signature: "undeclared-property",
          propertyId: "TEST.UNDECLARED",
        }];
      },
    }),
    /propertyId TEST\.UNDECLARED is not declared by scenario/u,
  );
});

test("exploration retains exact bounds and the shortest finding", () => {
  const report = exploreScenario(counterScenario());

  assert.equal(report.contractVersion, BOUNDED_EXPLORATION_CONTRACT_VERSION);
  assert.equal(report.reportFormat, BOUNDED_EXPLORATION_REPORT_FORMAT);
  assert.equal(validateExplorationReport(report), report);
  assert.deepEqual(report.transitions, {
    attempted: 4,
    accepted: 2,
    refused: 2,
    expectationMismatches: 0,
    oracleBlockedAccepted: 0,
    unclassifiedRefusalExpectations: 0,
  });
  assert.equal(report.dedupeMode, "none");
  assert.equal(report.frontier.depth, 2);
  assert.equal(report.frontier.nodes, 1);
  assert.equal(report.frontier.truncated, true);
  assert.equal(report.normalizedSemanticObservations.count, 3);
  assert.deepEqual(report.findings.map(({ signature, depth, trace }) => ({
    signature,
    depth,
    trace,
  })), [{
    signature: "counter.reaches-two",
    depth: 2,
    trace: ["increment", "increment"],
  }]);
  assert.deepEqual(report.refusalCodes.map(({ code, count }) => ({ code, count })), [{
    code: "prototype.blocked",
    count: 2,
  }]);
});

test("versioned report validation rejects incompatible and inconsistent reports", () => {
  const report = exploreScenario(counterScenario({ maxDepth: 1 }));
  assert.throws(
    () => validateExplorationReport({ ...report, reportFormat: "unknown.report.v2" }),
    /reportFormat must be lifecycle\.bounded-exploration\.report\.v1/u,
  );
  assert.throws(
    () => validateExplorationReport({
      ...report,
      transitions: { ...report.transitions, attempted: report.transitions.attempted + 1 },
    }),
    /attempted transitions must equal accepted plus refused/u,
  );
});

test("report validation rejects malformed refusal entries and refusal arithmetic", () => {
  const report = exploreScenario(counterScenario({ maxDepth: 1 }));
  const refusal = report.refusalCodes[0]!;
  assert.notEqual(refusal.shortest, null);

  assert.throws(
    () => validateExplorationReport({
      ...report,
      refusalCodes: [{
        ...refusal,
        shortest: { ...refusal.shortest!, seedId: "undeclared-seed" },
      }],
    }),
    /names undeclared seed undeclared-seed/u,
  );
  assert.throws(
    () => validateExplorationReport({
      ...report,
      refusalCodes: [{ ...refusal, count: refusal.count + 1 }],
    }),
    /refusal code counts are inconsistent with transitions/u,
  );
});

test("report validation rejects malformed depth entries and depth arithmetic", () => {
  const report = exploreScenario(counterScenario({ maxDepth: 1 }));
  const terminalDepth = report.depths[1]!;

  assert.throws(
    () => validateExplorationReport({
      ...report,
      depths: [report.depths[0], { ...terminalDepth, nodes: "one" }],
    }),
    /depth 1\.nodes must be a non-negative integer/u,
  );
  assert.throws(
    () => validateExplorationReport({
      ...report,
      depths: [report.depths[0], {
        ...terminalDepth,
        attempted: terminalDepth.attempted + 1,
        refused: terminalDepth.refused + 1,
      }],
    }),
    /attempts do not match expanded nodes/u,
  );
});

test("report validation rejects malformed normalized semantic witnesses", () => {
  const report = exploreScenario(counterScenario({ maxDepth: 1 }));
  const [first, ...remaining] = report.normalizedSemanticObservations.values;
  assert.ok(first);

  assert.throws(
    () => validateExplorationReport({
      ...report,
      normalizedSemanticObservations: {
        ...report.normalizedSemanticObservations,
        values: [{ ...first, semantic: { value: 99 } }, ...remaining],
      },
    }),
    /semantic observation .* has inconsistent signature/u,
  );
  assert.throws(
    () => validateExplorationReport({
      ...report,
      normalizedSemanticObservations: {
        ...report.normalizedSemanticObservations,
        values: [{ ...first, seedId: "undeclared-seed" }, ...remaining],
      },
    }),
    /names undeclared seed undeclared-seed/u,
  );

  const fabricated = {
    signature: stableJson({ value: 99 }),
    semantic: { value: 99 },
    seedId: "zero",
    depth: 1,
    trace: ["increment"],
  };
  assert.throws(
    () => validateExplorationReport({
      ...report,
      normalizedSemanticObservations: {
        count: report.normalizedSemanticObservations.count + 1,
        values: [...report.normalizedSemanticObservations.values, fabricated]
          .sort((left, right) => left.signature.localeCompare(right.signature)),
      },
    }),
    /semantic observations exceed actual observations/u,
  );
});

test("report validation rejects malformed coverage shape and missing-set arithmetic", () => {
  const report = exploreScenario(counterScenario({ maxDepth: 1 }));

  assert.throws(
    () => validateExplorationReport({
      ...report,
      coverage: {
        ...report.coverage,
        eventKinds: { ...report.coverage.eventKinds, all: "not-an-array" },
      },
    }),
    /coverage\.eventKinds\.all must be an array/u,
  );
  assert.throws(
    () => validateExplorationReport({
      ...report,
      coverage: {
        ...report.coverage,
        requirements: {
          declared: {
            ...report.coverage.requirements.declared,
            phases: ["unseen"],
          },
          missing: report.coverage.requirements.missing,
          satisfied: true,
        },
      },
    }),
    /missing phases is inconsistent with observed coverage/u,
  );
  assert.throws(
    () => validateExplorationReport({
      ...report,
      coverage: {
        ...report.coverage,
        eventKinds: {
          all: ["fabricated/event"],
          seed: [],
          generated: [],
        },
      },
    }),
    /all event coverage must equal seed\/generated coverage/u,
  );
  assert.throws(
    () => validateExplorationReport({
      ...report,
      coverage: {
        ...report.coverage,
        modelPhases: ["fabricated-a", "fabricated-b", "fabricated-c"],
      },
    }),
    /model phases exceed actual model observations/u,
  );
});

test("report validation rejects finding counts without witnesses", () => {
  const report = exploreScenario(counterScenario({
    id: "engine-finding-count-coherence",
    maxDepth: 1,
  }));
  assert.equal(report.findings.length, 0);

  assert.throws(
    () => validateExplorationReport({
      ...report,
      depths: report.depths.map((metric, index) => index === 1
        ? { ...metric, findings: 1 }
        : metric),
    }),
    /depth finding counts have no finding witnesses/u,
  );
});

test("an oracle-blocked accepted command is a transition finding", () => {
  const report = exploreScenario(counterScenario({
    id: "engine-transition-sensitivity",
    maxDepth: 1,
    commands: [{
      id: "badly-accepted",
      expectation() {
        return { kind: "refused", classes: null };
      },
      apply() {},
    }],
  }));

  assert.equal(report.transitions.expectationMismatches, 1);
  assert.equal(report.transitions.oracleBlockedAccepted, 1);
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0]?.source, "transition");
  assert.deepEqual(report.findings[0]?.trace, ["badly-accepted"]);
});

test("the wrong coded refusal class is a transition finding", () => {
  const report = exploreScenario(counterScenario({
    id: "engine-refusal-class-sensitivity",
    maxDepth: 1,
    commands: [{
      id: "wrong-refusal",
      expectation() {
        return { kind: "refused", classes: ["expected"] };
      },
      apply() {
        throw codedRefusal("prototype.actual");
      },
    }],
  }));

  assert.equal(report.transitions.expectationMismatches, 1);
  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0]?.source, "transition");
  assert.match(report.findings[0]?.signature ?? "", /refused:prototype\.actual$/u);
});

test("refusal expectations reject duplicate full codes", () => {
  assert.throws(
    () => exploreScenario(counterScenario({
      id: "engine-duplicate-refusal-class",
      maxDepth: 1,
      commands: [{
        id: "duplicate-refusal-class",
        expectation() {
          return {
            kind: "refused",
            classes: ["prototype.blocked", "prototype.blocked"],
          };
        },
        apply() {
          throw codedRefusal("prototype.blocked");
        },
      }],
    })),
    /must not repeat refusal classes/u,
  );
});

test("refusal classes match exact full codes rather than suffixes", () => {
  const report = exploreScenario(counterScenario({
    id: "engine-exact-refusal-class",
    maxDepth: 1,
    commands: [{
      id: "order-refusal",
      expectation() {
        return { kind: "refused", classes: ["order"] };
      },
      apply() {
        throw codedRefusal("lifecycle.delivery-reducer.order");
      },
    }],
  }));

  assert.equal(report.transitions.expectationMismatches, 1);
  assert.equal(report.findings.length, 1);
  assert.match(
    report.findings[0]?.signature ?? "",
    /refused:lifecycle\.delivery-reducer\.order$/u,
  );
});

test("semantic stutters remain separate nodes when deduplication is disabled", () => {
  const report = exploreScenario(counterScenario({
    id: "engine-stutter",
    maxDepth: 3,
    commands: [{
      id: "stutter",
      expectation(model) {
        return { kind: "accepted", next: model };
      },
      apply() {},
    }],
  }));

  assert.equal(report.transitions.accepted, 3);
  assert.equal(report.normalizedSemanticObservations.count, 1);
  assert.deepEqual(report.depths.map(({ nodes }) => nodes), [1, 1, 1, 1]);
  assert.equal(report.frontier.nodes, 1);
});

test("a child fork may not mutate its parent", () => {
  class SharedCounterSystem implements MutableCounterSystem {
    constructor(private readonly box = { value: 0 }) {}

    get value(): number {
      return this.box.value;
    }

    set value(value: number) {
      this.box.value = value;
    }

    fork(): MutableCounterSystem {
      return new SharedCounterSystem(this.box);
    }
  }

  const scenario = counterScenario({
    id: "engine-fork-independence",
    maxDepth: 1,
    system: new SharedCounterSystem(),
    commands: [{
      id: "mutate-shared-box",
      expectation(model) {
        return { kind: "accepted", next: model + 1 };
      },
      apply(system) {
        system.value += 1;
      },
    }],
  });

  assert.throws(
    () => exploreScenario(scenario),
    /allowed child mutation to change its parent/u,
  );
});

test("reports are deterministic and expose missing required coverage", () => {
  const base = counterScenario({ id: "engine-determinism" });
  const scenario = {
    ...base,
    requiredCoverage: {
      phases: ["unseen"],
      acceptedCommands: ["increment", "refuse"],
      eventKinds: [
        "missing/event",
        "missing/seed-event",
        "missing/generated-event",
      ],
      seedEventKinds: ["missing/seed-event"],
      generatedEventKinds: ["missing/generated-event"],
      recoveryCoordinates: ["missing/recovery"],
    },
  };
  const first = exploreScenario(scenario);
  const second = exploreScenario(scenario);

  assert.equal(stableJson(first), stableJson(second));
  assert.equal(first.coverage.requirements.satisfied, false);
  assert.deepEqual(first.coverage.requirements.missing, {
    phases: ["unseen"],
    acceptedCommands: ["refuse"],
    eventKinds: [
      "missing/event",
      "missing/generated-event",
      "missing/seed-event",
    ],
    seedEventKinds: ["missing/seed-event"],
    generatedEventKinds: ["missing/generated-event"],
    recoveryCoordinates: ["missing/recovery"],
  });
});

test("required coverage identities must be unique", () => {
  assert.throws(
    () => exploreScenario({
      ...counterScenario({ id: "engine-duplicate-coverage" }),
      requiredCoverage: { eventKinds: ["event", "event"] },
    }),
    /requiredCoverage\.eventKinds must not contain duplicates/u,
  );
});

test("required coverage references only declared commands and event kinds", () => {
  assert.throws(
    () => exploreScenario({
      ...counterScenario({ id: "engine-unknown-covered-command" }),
      requiredCoverage: { acceptedCommands: ["missing"] },
    }),
    /acceptedCommands names undeclared command missing/u,
  );
  assert.throws(
    () => exploreScenario({
      ...counterScenario({ id: "engine-unscoped-seed-event" }),
      requiredCoverage: {
        eventKinds: ["declared"],
        seedEventKinds: ["not-declared"],
      },
    }),
    /seedEventKinds names not-declared outside eventKinds/u,
  );
});

test("hard node and transition ceilings fail instead of silently truncating", () => {
  assert.throws(
    () => exploreScenario({
      ...counterScenario({ id: "engine-node-ceiling", maxDepth: 1 }),
      bounds: { maxDepth: 1, maxNodes: 1, maxTransitions: 10 },
    }),
    /exceeded bounds\.maxNodes/u,
  );
  assert.throws(
    () => exploreScenario({
      ...counterScenario({ id: "engine-transition-ceiling", maxDepth: 1 }),
      bounds: { maxDepth: 1, maxNodes: 10, maxTransitions: 1 },
    }),
    /exceeded bounds\.maxTransitions/u,
  );
});
