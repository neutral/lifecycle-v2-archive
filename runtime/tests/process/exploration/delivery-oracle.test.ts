import assert from "node:assert/strict";
import test from "node:test";

import {
  deliveryInvariants,
  type DeliveryObservation,
  type DeliveryOracleModel,
} from "./delivery-oracle.js";
import {
  EventChain,
  reduceChain,
  subject,
} from "./delivery-reducer-fixture.js";
import { buildCandidatePresentNoShipScenario } from "./delivery-reducer-scenarios.js";

const selected = Object.freeze({
  id: "subject",
  revision: 1,
  digest: `sha256:${"0".repeat(64)}`,
});

function subjects(
  changes: Partial<DeliveryObservation["subjects"]> = {},
): DeliveryObservation["subjects"] {
  return {
    integrationAssessment: null,
    proposedBoundary: null,
    activeBoundary: null,
    candidate: null,
    materialCondition: null,
    seal: null,
    evidence: null,
    closure: null,
    ...changes,
  };
}

function observation(
  changes: Partial<DeliveryObservation> = {},
): DeliveryObservation {
  return {
    standing: "framing",
    candidateCondition: "absent",
    activities: [],
    subjects: subjects(),
    eligibleOperations: [],
    journal: { eventCount: 0 },
    eventKinds: [],
    ...changes,
  };
}

function findingIds(findings: readonly (string | Readonly<Record<string, unknown>>)[]): string[] {
  return findings.map((finding) => {
    assert.equal(typeof finding, "object");
    return (finding as Readonly<Record<string, unknown>>).id as string;
  }).sort();
}

test("the preparation oracle detects Candidate absence precedence", () => {
  const findings = deliveryInvariants({
    model: {
      kind: "preparation",
      phase: "started",
      candidatePresent: false,
    },
    observation: observation({
      candidateCondition: "terminal-recovery",
      activities: [{
        id: "prepare",
        operation: "delivery.prepare",
        family: "agent",
        stage: "started",
        recovery: {
          kind: "finalization",
          resumesAt: "agent-attempt-prepared",
          exactEffectDigest: null,
        },
      }],
      eligibleOperations: ["delivery.recover"],
      journal: { eventCount: 1 },
      eventKinds: ["activity-started"],
    }),
  });

  assert.deepEqual(findingIds(findings), ["candidate.absence-is-independent"]);
  assert.equal(
    (findings[0] as Readonly<Record<string, unknown>>).classification,
    "confirmed-normative-violation",
  );
});

function candidateNoShipObservation(
  changes: Partial<DeliveryObservation> = {},
): DeliveryObservation {
  return observation({
    standing: "active",
    candidateCondition: "terminal-recovery",
    activities: [{
      id: "no-ship",
      operation: "delivery.no-ship",
      family: "transaction",
      stage: "effect-intended",
      recovery: {
        kind: "transaction",
        resumesAt: "transaction-effect-observed",
        exactEffectDigest: `sha256:${"1".repeat(64)}`,
      },
    }],
    subjects: subjects({ activeBoundary: selected, candidate: selected }),
    eligibleOperations: ["delivery.recover"],
    journal: { eventCount: 1 },
    eventKinds: ["transaction-effect-intended"],
    ...changes,
  });
}

const candidateNoShipModel: DeliveryOracleModel = Object.freeze({
  kind: "no-ship",
  phase: "uncertain",
  candidatePresent: true,
  originStanding: "active",
  boundaryKind: "active",
  effectDigest: `sha256:${"1".repeat(64)}`,
});

test("a clean Candidate-present terminal phase satisfies its oracle", () => {
  assert.deepEqual(deliveryInvariants({
    model: candidateNoShipModel,
    observation: candidateNoShipObservation(),
  }), []);
});

test("terminal recovery and eligibility mutants are detected", () => {
  const base = candidateNoShipObservation();
  const activity = base.activities[0]!;
  const wrongRecovery = candidateNoShipObservation({
    activities: [{
      ...activity,
      recovery: {
        kind: "finalization",
        resumesAt: "activity-completed",
        exactEffectDigest: null,
      },
    }],
  });
  assert.ok(findingIds(deliveryInvariants({
    model: candidateNoShipModel,
    observation: wrongRecovery,
  })).includes("recovery.coordinate-differs-from-phase"));

  const wrongEligibility = candidateNoShipObservation({
    eligibleOperations: ["delivery.no-ship"],
  });
  assert.deepEqual(findingIds(deliveryInvariants({
    model: candidateNoShipModel,
    observation: wrongEligibility,
  })), [
    "eligibility.differs-from-scenario-oracle",
    "recovery.suppresses-other-operations",
  ]);
});

test("the proposed-Boundary retry destination is modeled independently", () => {
  const findings = deliveryInvariants({
    model: {
      kind: "no-ship",
      phase: "retryable",
      candidatePresent: false,
      originStanding: "awaiting-admission",
      boundaryKind: "proposed",
    },
    observation: observation({
      standing: "awaiting-admission",
      activities: [{
        id: "no-ship",
        operation: "delivery.no-ship",
        family: "transaction",
        stage: "completed",
        recovery: null,
      }],
      subjects: subjects({ proposedBoundary: selected }),
      eligibleOperations: ["delivery.no-ship", "delivery.admit"],
      journal: { eventCount: 1 },
      eventKinds: ["activity-completed"],
    }),
  });

  assert.deepEqual(findings, []);
});

test("Closure ordering mutants are detected", () => {
  const model: DeliveryOracleModel = {
    kind: "no-ship",
    phase: "closed",
    candidatePresent: true,
    originStanding: "active",
    boundaryKind: "active",
  };
  const closed = observation({
    standing: "closed",
    candidateCondition: "abandoned",
    activities: [{
      id: "no-ship",
      operation: "delivery.no-ship",
      family: "transaction",
      stage: "completed",
      recovery: null,
    }],
    subjects: subjects({
      activeBoundary: selected,
      candidate: selected,
      closure: selected,
    }),
    eligibleOperations: [],
    journal: { eventCount: 1 },
    eventKinds: ["closure-recorded"],
  });
  assert.deepEqual(deliveryInvariants({ model, observation: closed }), []);

  const mutated = { ...closed, eventKinds: ["activity-completed"] };
  assert.deepEqual(findingIds(deliveryInvariants({ model, observation: mutated })), [
    "closure.is-terminal",
  ]);
});

test("journal and subject-topology mutants are detected", () => {
  const model: DeliveryOracleModel = {
    kind: "no-ship",
    phase: "uncertain",
    candidatePresent: true,
    originStanding: "active",
    boundaryKind: "active",
    effectDigest: `sha256:${"1".repeat(64)}`,
  };
  const mutated = candidateNoShipObservation({
    subjects: subjects({ candidate: selected }),
    journal: { eventCount: 2 },
  });

  const ids = findingIds(deliveryInvariants({ model, observation: mutated }));
  assert.ok(ids.includes("journal.count-matches-history"));
  assert.ok(ids.includes("subjects.candidate-needs-active-boundary"));
});

test("the reducer fixture agrees on terminal sealability and preserves coded refusals", () => {
  const scenario = buildCandidatePresentNoShipScenario();
  const chain = scenario.seeds[0]!.system.fork();
  const apply = (commandId: string): void => {
    const command = scenario.commands.find(({ id }) => id === commandId);
    assert.notEqual(command, undefined);
    command!.apply(chain, [commandId]);
  };

  apply("observe-applied");
  apply("record-closure");
  const state = reduceChain(chain);
  assert.equal(state.standing, "closed");
  assert.equal(state.journal.headDigest, chain.events.at(-1)?.digest);

  apply("complete-failed");
  assert.throws(
    () => reduceChain(chain),
    (error: unknown) => {
      assert.equal(
        (error as { code?: string }).code,
        "lifecycle.delivery-reducer.terminal",
      );
      return true;
    },
  );
});

test("the reducer fixture fails as harness code when replay modes disagree", () => {
  const chain = new EventChain();
  chain.append("delivery-created", {});
  chain.append(
    "director-brief-submitted",
    { activityId: "prepare-nondeterministic-resolver" },
    subject("brief-nondeterministic-resolver"),
    { recordKind: "director-brief" },
  );
  const stableResolve = chain.resolveRevision;
  let resolutions = 0;
  Object.defineProperty(chain, "resolveRevision", {
    value: (selected: Parameters<typeof stableResolve>[0]) => {
      resolutions += 1;
      return resolutions === 1 ? stableResolve(selected) : null;
    },
  });

  assert.throws(
    () => reduceChain(chain),
    (error: unknown) => {
      assert.equal((error as { name?: string }).name, "DeliveryReducerFixtureError");
      assert.match(
        (error as { message?: string }).message ?? "",
        /reducer outcomes disagree/u,
      );
      assert.equal((error as { code?: string }).code, undefined);
      return true;
    },
  );
});
