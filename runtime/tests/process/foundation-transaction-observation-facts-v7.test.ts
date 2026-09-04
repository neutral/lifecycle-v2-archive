import assert from "node:assert/strict";
import test from "node:test";
import type { ControlJsonObject } from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import {
  FOUNDATION_ADMISSION_TRANSACTION_OBSERVATION_FACTS_V1,
  FOUNDATION_TERMINAL_ACCEPTANCE_OBSERVATION_FACTS_V1,
  FOUNDATION_TERMINAL_DETACHED_OBSERVATION_FACTS_V1,
  FOUNDATION_TERMINAL_FAILURE_OBSERVATION_FACTS_V1,
  FOUNDATION_TERMINAL_REPOSITORY_OBSERVATION_FACTS_V1,
  assertFoundationTransactionObservationFactsV7,
  parseFoundationTransactionObservationFactsV7,
} from "../../src/foundation/process/transaction-observation-facts-v7.js";
import {
  digestCanonical,
  sha256Bytes,
} from "../../src/foundation/validation/canonical.js";

const BASIS = sha256Bytes("repository-basis");
const OBSERVED = sha256Bytes("observed-facts");

function admission(overrides: ControlJsonObject = Object.freeze({})): ControlJsonObject {
  return Object.freeze({
    schema: FOUNDATION_ADMISSION_TRANSACTION_OBSERVATION_FACTS_V1,
    outcome: "applied",
    disposition: null,
    repositoryBasisDigest: BASIS,
    ...overrides,
  });
}

function retained(
  operation: "delivery.admit" | "delivery.accept" | "delivery.no-ship",
  decisionKind: "admit" | "readmit" | "accept" | "no-ship",
  outcome: "applied" | "not-applied" | "indeterminate",
  facts: ControlJsonObject,
): void {
  assertFoundationTransactionObservationFactsV7({
    operation,
    decisionKind,
    outcome,
    facts,
    factsDigest: digestCanonical(facts),
  });
}

function rejects(code: string, callback: () => unknown): void {
  assert.throws(callback, (error: unknown) =>
    error instanceof FoundationError &&
    error.code === `lifecycle.transaction-observation-facts-v7.${code}`);
}

test("Admission observation facts enforce their semantic outcome combinations", () => {
  retained("delivery.admit", "admit", "applied", admission());
  retained("delivery.admit", "readmit", "indeterminate", admission({
    outcome: "indeterminate",
    repositoryBasisDigest: null,
  }));
  retained("delivery.admit", "readmit", "not-applied", admission({
    outcome: "not-applied",
    disposition: Object.freeze({
      outcome: "not-applied",
      reason: "candidate-continuity-mismatch",
      observedFactsDigest: OBSERVED,
    }),
  }));

  rejects("outcome", () => retained("delivery.admit", "admit", "not-applied", admission({
    outcome: "not-applied",
  })));
  rejects("outcome", () => retained("delivery.admit", "admit", "applied", admission({
    repositoryBasisDigest: null,
  })));
  rejects("outcome", () => retained("delivery.admit", "readmit", "not-applied", admission({
    outcome: "not-applied",
    disposition: Object.freeze({
      outcome: "not-applied",
      reason: "repository-basis-mismatch",
      observedFactsDigest: OBSERVED,
    }),
  })));
  rejects("decision", () => retained("delivery.admit", "admit", "not-applied", admission({
    outcome: "not-applied",
    disposition: Object.freeze({
      outcome: "not-applied",
      reason: "candidate-continuity-mismatch",
      observedFactsDigest: OBSERVED,
    }),
  })));
  rejects("shape", () => parseFoundationTransactionObservationFactsV7(admission({
    candidateCustody: null,
  })));
});

test("Terminal observation facts are closed, operation-compatible, and bounded", () => {
  const repository = Object.freeze({
    schema: FOUNDATION_TERMINAL_REPOSITORY_OBSERVATION_FACTS_V1,
    ref: "refs/heads/main",
    commit: "b".repeat(40),
    tree: "c".repeat(40),
    objectFormat: "sha1",
  });
  const acceptance = Object.freeze({
    ...repository,
    schema: FOUNDATION_TERMINAL_ACCEPTANCE_OBSERVATION_FACTS_V1,
    canonicalResultDigest: sha256Bytes("canonical-result"),
  });
  retained("delivery.accept", "accept", "applied", acceptance);
  rejects("operation", () => retained("delivery.admit", "admit", "applied", repository));

  const detached = Object.freeze({
    schema: FOUNDATION_TERMINAL_DETACHED_OBSERVATION_FACTS_V1,
    attached: Object.freeze({
      ref: "refs/heads/main",
      commit: "b".repeat(40),
      tree: "c".repeat(40),
      objectFormat: "sha1",
    }),
    canonicalRef: "refs/heads/main",
    canonicalCommit: "d".repeat(40),
    canonicalTree: "e".repeat(40),
  });
  retained("delivery.accept", "accept", "not-applied", detached);
  rejects("outcome", () => retained("delivery.accept", "accept", "applied", detached));

  const failure = Object.freeze({
    schema: FOUNDATION_TERMINAL_FAILURE_OBSERVATION_FACTS_V1,
    stage: "acceptance-effect",
    code: "repository-observation-failed",
  });
  retained("delivery.accept", "accept", "indeterminate", failure);
  rejects("outcome", () => retained("delivery.accept", "accept", "not-applied", failure));
  rejects("operation", () => retained(
    "delivery.no-ship", "no-ship", "indeterminate", failure));

  rejects("git-ref", () => parseFoundationTransactionObservationFactsV7({
    ...repository,
    ref: `refs/heads/${"a".repeat(502)}`,
  }));
  rejects("shape", () => parseFoundationTransactionObservationFactsV7({
    ...repository,
    repositoryRoot: "/private/repository",
  }));
  rejects("git-object-format", () => parseFoundationTransactionObservationFactsV7({
    ...repository,
    commit: "a".repeat(64),
  }));
  rejects("git-object-format", () => parseFoundationTransactionObservationFactsV7({
    ...detached,
    attached: Object.freeze({
      ...detached.attached,
      objectFormat: "sha256",
    }),
    canonicalCommit: "d".repeat(64),
    canonicalTree: "e".repeat(64),
  }));
  rejects("git-object-format", () => parseFoundationTransactionObservationFactsV7({
    ...detached,
    canonicalCommit: "d".repeat(64),
  }));
});

test("retained observation facts reject byte mutation independently of shape", () => {
  const facts = admission();
  assert.throws(() => assertFoundationTransactionObservationFactsV7({
    operation: "delivery.admit",
    decisionKind: "admit",
    outcome: "applied",
    facts: Object.freeze({ ...facts, repositoryBasisDigest: OBSERVED }),
    factsDigest: digestCanonical(facts),
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.transaction-observation-facts-v7.digest-mismatch");
});
