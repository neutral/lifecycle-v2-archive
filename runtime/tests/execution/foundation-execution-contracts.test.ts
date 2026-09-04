import assert from "node:assert/strict";
import test from "node:test";
import { FoundationError } from "../../src/foundation/error.js";
import {
  compileExecutionReclamationBinding,
  compileExecutionReclamationObligation,
  compileExecutionReclamationObservation,
  parseExecutionReclamationObservation,
  privateFoundationExecutionHandle,
} from "../../src/foundation/execution/backend.js";
import {
  executionObservationEstablishesContainment,
  parseFoundationExecutionBackendProfile,
  parseFoundationExecutionObservation,
  parseFoundationExecutionSpecification,
  type FoundationExecutionObservationV1,
  type FoundationExecutionSpecificationV1,
} from "../../src/foundation/execution/contracts.js";
import {
  canonicalJson,
  selfDigest,
} from "../../src/foundation/validation/canonical.js";
import {
  builderExecutionContractFixture,
  digest,
  executionContractFixture,
} from "../support/execution-contract-fixture.js";

function withSelfDigest(value: Record<string, unknown>): Record<string, unknown> {
  const subject = { ...value };
  delete subject.digest;
  return { ...subject, digest: selfDigest(subject) };
}

function terminalObservation(
  specification: FoundationExecutionSpecificationV1,
  observationSequence: number,
): Record<string, unknown> {
  const subject = {
    schema: "lifecycle.execution-observation.v1",
    specificationDigest: specification.digest,
    backendProfile: specification.backendProfile,
    imageDigest: specification.image.imageDigest,
    inputSetDigest: specification.inputSet.digest,
    observationSequence,
    observedAt: `2026-09-01T00:00:${String(observationSequence).padStart(2, "0")}.000Z`,
    allocationState: "allocated",
    dispatchState: "terminal-observed",
    processState: "terminal",
    terminal: {
      finishedAt: "2026-09-01T00:00:00.000Z",
      reason: "exited",
      exitCode: 0,
      signal: null,
      runnerDisposition: "completed",
    },
    containmentFacts: {
      rootProcess: "terminal",
      descendants: "absent",
      writers: "absent",
      credentials: "not-injected",
      providerChannel: "not-granted",
      outputMutation: "impossible",
    },
    output: {
      disposition: "not-produced",
      manifestDigest: null,
      carrierByteLength: null,
    },
    resourceFacts: {
      wallTimeMilliseconds: 1,
      cpuTimeMilliseconds: 1,
      peakMemoryBytes: 1,
      storageBytes: 1,
      outputBytes: 0,
      eventCount: 1,
      limitBreaches: [],
    },
  };
  return { ...subject, digest: selfDigest(subject) };
}

function specificationSubject(
  specification: FoundationExecutionSpecificationV1,
): Record<string, unknown> {
  const subject = JSON.parse(canonicalJson(specification)) as Record<string, unknown>;
  delete subject.digest;
  return subject;
}

function refreshOutputContract(subject: Record<string, unknown>): void {
  const outputContract = subject.outputContract as Record<string, unknown>;
  delete outputContract.digest;
  outputContract.digest = selfDigest(outputContract);
}

function parseChangedSpecification(
  fixture: ReturnType<typeof executionContractFixture>,
  change: (subject: Record<string, unknown>) => void,
): FoundationExecutionSpecificationV1 {
  const subject = specificationSubject(fixture.specification);
  change(subject);
  return parseFoundationExecutionSpecification({
    value: { ...subject, digest: selfDigest(subject) },
    backendProfile: fixture.profile,
    image: fixture.image,
    inputSet: fixture.inputSet,
  });
}

function changedObservation(
  specification: FoundationExecutionSpecificationV1,
  observationSequence: number,
  change: (subject: Record<string, unknown>) => void,
): Record<string, unknown> {
  const subject = terminalObservation(specification, observationSequence);
  delete subject.digest;
  change(subject);
  return { ...subject, digest: selfDigest(subject) };
}

test("Execution contracts bind exact Profile, implementation, Image, Input Set, and Specification digests", () => {
  const fixture = executionContractFixture();
  assert(Object.isFrozen(fixture.profile));
  assert(Object.isFrozen(fixture.profile.engineContract));
  assert(Object.isFrozen(fixture.specification.owner));
  assert.equal(fixture.specification.backendProfile.profileDigest, fixture.profile.digest);

  assert.throws(
    () => parseFoundationExecutionBackendProfile({
      ...fixture.profile,
      digest: digest("substituted-profile-digest"),
    }),
    (error: unknown) => error instanceof FoundationError,
  );

  const substituted = JSON.parse(canonicalJson(fixture.specification)) as Record<string, unknown>;
  substituted.image = {
    imageId: fixture.image.imageId,
    imageDigest: digest("substituted-image"),
  };
  assert.throws(
    () => parseFoundationExecutionSpecification({
      value: withSelfDigest(substituted),
      backendProfile: fixture.profile,
      image: fixture.image,
      inputSet: fixture.inputSet,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.contract-invalid",
  );

  const overLimit = JSON.parse(canonicalJson(fixture.specification)) as Record<string, unknown>;
  overLimit.limits = {
    ...(overLimit.limits as Record<string, unknown>),
    outputBytes: fixture.profile.limits.maximumOutputBytes + 1,
  };
  assert.throws(
    () => parseFoundationExecutionSpecification({
      value: withSelfDigest(overLimit),
      backendProfile: fixture.profile,
      image: fixture.image,
      inputSet: fixture.inputSet,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.contract-invalid" &&
      error.message.includes("output bytes limit"),
  );
});

test("Execution Specifications reject cross-owner operations, capabilities, credentials, and outputs", () => {
  const fixture = executionContractFixture("semantic-specification");
  const invalidChanges: readonly ((subject: Record<string, unknown>) => void)[] = [
    (subject) => {
      (subject.runner as Record<string, unknown>).operationId = "agent-attempt.reviewer";
    },
    (subject) => {
      subject.environment = [{
        name: "PROVIDER_TOKEN",
        source: "credential-injection",
        bindingDigest: digest("credential-environment"),
      }];
    },
    (subject) => {
      const roots = (subject.outputContract as Record<string, unknown>)
        .declaredOutputRoots as Record<string, unknown>[];
      roots[0]!.purpose = "candidate-output";
      roots[0]!.required = true;
      refreshOutputContract(subject);
    },
    (subject) => {
      (subject.capabilities as Record<string, unknown>).candidateWrites = true;
      const roots = (subject.outputContract as Record<string, unknown>)
        .declaredOutputRoots as Record<string, unknown>[];
      roots[0]!.purpose = "candidate-output";
      roots[0]!.required = true;
      refreshOutputContract(subject);
    },
    (subject) => {
      const selectionId = "check-selection.semantic";
      subject.owner = {
        kind: "check",
        phase: "final",
        activityId: "activity.semantic-check",
        selectionId,
        ownerSubjectDigest: digest("check-owner"),
      };
      subject.operation = {
        kind: "check",
        phase: "final",
        selectionId: "check-selection.substituted",
        definitionDigest: digest("check-definition"),
        bindingDigest: digest("check-binding"),
        runnerImplementationDigest: digest("check-runner"),
        parserImplementationDigest: digest("check-parser"),
      };
      (subject.runner as Record<string, unknown>).operationId = "check.execute";
      const roots = (subject.outputContract as Record<string, unknown>)
        .declaredOutputRoots as Record<string, unknown>[];
      roots[0]!.purpose = "check-proof";
      refreshOutputContract(subject);
    },
    (subject) => {
      const selectionId = "check-selection.agent-output";
      subject.owner = {
        kind: "check",
        phase: "final",
        activityId: "activity.agent-output-check",
        selectionId,
        ownerSubjectDigest: digest("check-agent-output-owner"),
      };
      subject.operation = {
        kind: "check",
        phase: "final",
        selectionId,
        definitionDigest: digest("check-agent-output-definition"),
        bindingDigest: digest("check-agent-output-binding"),
        runnerImplementationDigest: digest("check-agent-output-runner"),
        parserImplementationDigest: digest("check-agent-output-parser"),
      };
      (subject.runner as Record<string, unknown>).operationId = "check.execute";
    },
    (subject) => {
      const selectionId = "check-selection.wrong-runner-operation";
      subject.owner = {
        kind: "check",
        phase: "final",
        activityId: "activity.wrong-runner-operation",
        selectionId,
        ownerSubjectDigest: digest("check-wrong-runner-owner"),
      };
      subject.operation = {
        kind: "check",
        phase: "final",
        selectionId,
        definitionDigest: digest("check-wrong-runner-definition"),
        bindingDigest: digest("check-wrong-runner-binding"),
        runnerImplementationDigest: digest("check-wrong-runner-runner"),
        parserImplementationDigest: digest("check-wrong-runner-parser"),
      };
      (subject.runner as Record<string, unknown>).operationId = "agent-attempt.reviewer";
      const roots = (subject.outputContract as Record<string, unknown>)
        .declaredOutputRoots as Record<string, unknown>[];
      roots[0]!.purpose = "check-proof";
      refreshOutputContract(subject);
    },
  ];

  for (const change of invalidChanges) {
    assert.throws(
      () => parseChangedSpecification(fixture, change),
      (error: unknown) => error instanceof FoundationError &&
        error.code === "lifecycle.execution.contract-invalid",
    );
  }

  const builder = parseChangedSpecification(fixture, (subject) => {
    (subject.operation as Record<string, unknown>).role = "builder";
    (subject.runner as Record<string, unknown>).operationId = "agent-attempt.builder";
    (subject.capabilities as Record<string, unknown>).candidateWrites = true;
    const roots = (subject.outputContract as Record<string, unknown>)
      .declaredOutputRoots as Record<string, unknown>[];
    roots[0]!.purpose = "candidate-output";
    roots[0]!.required = false;
    refreshOutputContract(subject);
  });
  assert.equal(builder.operation.kind, "agent-attempt");
  assert.equal(builder.capabilities.candidateWrites, true);

  const check = parseChangedSpecification(fixture, (subject) => {
    const selectionId = "check-selection.valid";
    subject.owner = {
      kind: "check",
      phase: "final",
      activityId: "activity.valid-check",
      selectionId,
      ownerSubjectDigest: digest("valid-check-owner"),
    };
    subject.operation = {
      kind: "check",
      phase: "final",
      selectionId,
      definitionDigest: digest("valid-check-definition"),
      bindingDigest: digest("valid-check-binding"),
      runnerImplementationDigest: digest("valid-check-runner"),
      parserImplementationDigest: digest("valid-check-parser"),
    };
    (subject.runner as Record<string, unknown>).operationId = "check.execute";
    const roots = (subject.outputContract as Record<string, unknown>)
      .declaredOutputRoots as Record<string, unknown>[];
    roots[0]!.purpose = "check-proof";
    refreshOutputContract(subject);
  });
  assert.equal(check.operation.kind, "check");
});

test("builder Execution Specifications bind one exact optional complete-tree Candidate root", () => {
  const fixture = builderExecutionContractFixture("builder-candidate-root");
  const roots = fixture.specification.outputContract.declaredOutputRoots;
  assert.equal(roots.length, 1);
  assert.deepEqual(roots[0], {
    path: "candidate-output",
    purpose: "candidate-output",
    required: false,
    allowedModeClasses: ["regular", "executable"],
    maximumEntries: fixture.specification.limits.outputEntries,
    maximumBytes: fixture.specification.limits.outputBytes,
  });

  const reconnaissance = executionContractFixture("builder-without-candidate-root");
  assert.throws(
    () => parseChangedSpecification(reconnaissance, (subject) => {
      (subject.operation as Record<string, unknown>).role = "builder";
      (subject.runner as Record<string, unknown>).operationId = "agent-attempt.builder";
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.contract-invalid" &&
      error.message.includes("Candidate writes exactly to a builder"),
  );

  assert.throws(
    () => parseChangedSpecification(fixture, (subject) => {
      const selected = (subject.outputContract as Record<string, unknown>)
        .declaredOutputRoots as Record<string, unknown>[];
      selected[0]!.required = true;
      refreshOutputContract(subject);
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.contract-invalid" &&
      error.message.includes("one exact optional complete-tree root"),
  );

  assert.throws(
    () => parseChangedSpecification(fixture, (subject) => {
      const selected = (subject.outputContract as Record<string, unknown>)
        .declaredOutputRoots as Record<string, unknown>[];
      selected.push({
        ...selected[0],
        path: "candidate-output-second",
      });
      refreshOutputContract(subject);
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.contract-invalid" &&
      error.message.includes("one exact optional complete-tree root"),
  );
});

test("Execution Observations bind one subject and increase monotonically without authority fields", () => {
  const fixture = executionContractFixture();
  const first = parseFoundationExecutionObservation({
    value: terminalObservation(fixture.specification, 1),
    specification: fixture.specification,
  });
  const second = parseFoundationExecutionObservation({
    value: terminalObservation(fixture.specification, 2),
    specification: fixture.specification,
    previous: first,
  });
  assert.equal(second.observationSequence, 2);

  assert.throws(
    () => parseFoundationExecutionObservation({
      value: terminalObservation(fixture.specification, 2),
      specification: fixture.specification,
      previous: second,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.contract-invalid",
  );

  const wrongSubject = terminalObservation(fixture.specification, 3);
  wrongSubject.specificationDigest = digest("another-specification");
  assert.throws(
    () => parseFoundationExecutionObservation({
      value: withSelfDigest(wrongSubject),
      specification: fixture.specification,
      previous: second,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.contract-invalid",
  );

  const authorityClaim = terminalObservation(fixture.specification, 3);
  authorityClaim.retirement = { decided: true };
  assert.throws(
    () => parseFoundationExecutionObservation({
      value: withSelfDigest(authorityClaim),
      specification: fixture.specification,
      previous: second,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.schema.invalid",
  );
});

test("Execution Observations reject contradictory direct state combinations", () => {
  const fixture = executionContractFixture("observation-combinations");
  const invalidChanges: readonly ((subject: Record<string, unknown>) => void)[] = [
    (subject) => {
      (subject.containmentFacts as Record<string, unknown>).rootProcess = "running";
    },
    (subject) => {
      subject.dispatchState = "accepted";
    },
    (subject) => {
      subject.processState = "running";
      subject.dispatchState = "start-observed";
      subject.terminal = null;
      (subject.containmentFacts as Record<string, unknown>).rootProcess = "running";
      subject.output = {
        disposition: "partial",
        manifestDigest: digest("unjoined-partial-manifest"),
        carrierByteLength: null,
      };
    },
    (subject) => {
      subject.processState = "not-started";
      subject.dispatchState = "start-observed";
      subject.terminal = null;
      (subject.containmentFacts as Record<string, unknown>).rootProcess = "not-started";
    },
    (subject) => {
      subject.output = {
        disposition: "partial",
        manifestDigest: digest("invalid-partial-manifest"),
        carrierByteLength: null,
      };
    },
    (subject) => {
      (subject.terminal as Record<string, unknown>).finishedAt = "2026-09-01T00:01:00.000Z";
    },
    (subject) => {
      (subject.containmentFacts as Record<string, unknown>).credentials = "revoked";
    },
    (subject) => {
      (subject.containmentFacts as Record<string, unknown>).providerChannel = "unreachable";
    },
  ];
  for (const [index, change] of invalidChanges.entries()) {
    assert.throws(
      () => parseFoundationExecutionObservation({
        value: changedObservation(fixture.specification, index + 1, change),
        specification: fixture.specification,
      }),
      (error: unknown) => error instanceof FoundationError &&
        error.code === "lifecycle.execution.contract-invalid",
    );
  }


  const runningWithClosedOutput = parseFoundationExecutionObservation({
    value: changedObservation(fixture.specification, 9, (subject) => {
      subject.processState = "running";
      subject.dispatchState = "start-observed";
      subject.terminal = null;
      (subject.containmentFacts as Record<string, unknown>).rootProcess = "running";
      subject.output = {
        disposition: "complete",
        manifestDigest: digest("closed-before-process-exit"),
        carrierByteLength: 10,
      };
    }),
    specification: fixture.specification,
  });
  assert.equal(runningWithClosedOutput.output.disposition, "complete");
  assert.equal(executionObservationEstablishesContainment(runningWithClosedOutput, true), false);
});

test("Execution Observation sequences never rewrite known dispatch, process, terminal, or complete-output facts", () => {
  const fixture = executionContractFixture("observation-sequence");
  const completeFirst = parseFoundationExecutionObservation({
    value: changedObservation(fixture.specification, 1, (subject) => {
      subject.output = {
        disposition: "complete",
        manifestDigest: digest("stable-manifest"),
        carrierByteLength: 64,
      };
    }),
    specification: fixture.specification,
  });

  const regressions: readonly ((subject: Record<string, unknown>) => void)[] = [
    (subject) => {
      subject.processState = "running";
      subject.dispatchState = "start-observed";
      subject.terminal = null;
      (subject.containmentFacts as Record<string, unknown>).rootProcess = "running";
      subject.output = { disposition: "not-produced", manifestDigest: null, carrierByteLength: null };
    },
    (subject) => {
      (subject.terminal as Record<string, unknown>).finishedAt = "2026-09-01T00:00:01.000Z";
      subject.output = {
        disposition: "complete",
        manifestDigest: digest("stable-manifest"),
        carrierByteLength: 64,
      };
    },
    (subject) => {
      subject.output = {
        disposition: "complete",
        manifestDigest: digest("substituted-manifest"),
        carrierByteLength: 64,
      };
    },
    (subject) => {
      subject.observedAt = "2026-09-01T00:00:00.000Z";
      subject.output = {
        disposition: "complete",
        manifestDigest: digest("stable-manifest"),
        carrierByteLength: 64,
      };
    },
  ];
  for (const [index, change] of regressions.entries()) {
    assert.throws(
      () => parseFoundationExecutionObservation({
        value: changedObservation(fixture.specification, index + 2, change),
        specification: fixture.specification,
        previous: completeFirst,
      }),
      (error: unknown) => error instanceof FoundationError &&
        error.code === "lifecycle.execution.contract-invalid",
    );
  }

  const unavailable = parseFoundationExecutionObservation({
    value: changedObservation(fixture.specification, 6, (subject) => {
      subject.allocationState = "unavailable";
      subject.containmentFacts = {
        rootProcess: "terminal",
        descendants: "unverified",
        writers: "unverified",
        credentials: "unverified",
        providerChannel: "unverified",
        outputMutation: "unverified",
      };
      subject.output = { disposition: "unavailable", manifestDigest: null, carrierByteLength: null };
    }),
    specification: fixture.specification,
    previous: completeFirst,
  });
  assert.equal(unavailable.processState, "terminal");
  assert.equal(executionObservationEstablishesContainment(unavailable, true), false);

  assert.throws(
    () => parseFoundationExecutionObservation({
      value: changedObservation(fixture.specification, 7, (subject) => {
        subject.dispatchState = "accepted";
        subject.processState = "not-started";
        subject.terminal = null;
        (subject.containmentFacts as Record<string, unknown>).rootProcess = "not-started";
      }),
      specification: fixture.specification,
      previous: unavailable,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.contract-invalid",
  );

  for (const [index, change] of ([
    (subject: Record<string, unknown>) => {
      (subject.containmentFacts as Record<string, unknown>).descendants = "present";
    },
    (subject: Record<string, unknown>) => {
      (subject.containmentFacts as Record<string, unknown>).writers = "present";
    },
    (subject: Record<string, unknown>) => {
      (subject.containmentFacts as Record<string, unknown>).credentials = "active";
    },
    (subject: Record<string, unknown>) => {
      (subject.containmentFacts as Record<string, unknown>).providerChannel = "reachable";
    },
    (subject: Record<string, unknown>) => {
      (subject.containmentFacts as Record<string, unknown>).outputMutation = "possible";
    },
  ] as const).entries()) {
    assert.throws(
      () => parseFoundationExecutionObservation({
        value: changedObservation(fixture.specification, 8 + index, change),
        specification: fixture.specification,
        previous: completeFirst,
      }),
      (error: unknown) => error instanceof FoundationError &&
        error.code === "lifecycle.execution.contract-invalid",
    );
  }

  const uncertainContainment = parseFoundationExecutionObservation({
    value: changedObservation(fixture.specification, 20, (subject) => {
      subject.containmentFacts = {
        rootProcess: "terminal",
        descendants: "unverified",
        writers: "unverified",
        credentials: "unverified",
        providerChannel: "unverified",
        outputMutation: "unverified",
      };
      subject.output = {
        disposition: "complete",
        manifestDigest: digest("stable-manifest"),
        carrierByteLength: 64,
      };
    }),
    specification: fixture.specification,
    previous: completeFirst,
  });
  assert.equal(executionObservationEstablishesContainment(uncertainContainment, true), false);
});

test("Containment requires complete direct facts and refuses absent or ambiguous post-dispatch state", () => {
  const fixture = executionContractFixture();
  const terminal = parseFoundationExecutionObservation({
    value: terminalObservation(fixture.specification, 1),
    specification: fixture.specification,
  });
  assert.equal(executionObservationEstablishesContainment(terminal, true), true);

  const directNotStarted = {
    ...terminal,
    dispatchState: "accepted",
    processState: "not-started",
    terminal: null,
    containmentFacts: {
      ...terminal.containmentFacts,
      rootProcess: "not-started",
      credentials: "not-injected",
      providerChannel: "not-granted",
    },
  } as FoundationExecutionObservationV1;
  assert.equal(executionObservationEstablishesContainment(directNotStarted, true), true);
  assert.equal(executionObservationEstablishesContainment(directNotStarted, false), false);

  const preDispatchNotStarted = {
    ...directNotStarted,
    dispatchState: "not-observed",
  } as FoundationExecutionObservationV1;
  assert.equal(executionObservationEstablishesContainment(preDispatchNotStarted, false), true);
  assert.equal(executionObservationEstablishesContainment(preDispatchNotStarted, true), true);

  const retainedPreDispatch = parseFoundationExecutionObservation({
    value: changedObservation(fixture.specification, 2, (subject) => {
      subject.dispatchState = "not-observed";
      subject.processState = "not-started";
      subject.terminal = null;
      subject.containmentFacts = {
        rootProcess: "not-started",
        descendants: "absent",
        writers: "absent",
        credentials: "not-injected",
        providerChannel: "not-granted",
        outputMutation: "impossible",
      };
    }),
    specification: fixture.specification,
  });
  const runningAfterDispatch = parseFoundationExecutionObservation({
    value: changedObservation(fixture.specification, 3, (subject) => {
      subject.dispatchState = "start-observed";
      subject.processState = "running";
      subject.terminal = null;
      subject.containmentFacts = {
        rootProcess: "running",
        descendants: "present",
        writers: "present",
        credentials: "not-injected",
        providerChannel: "not-granted",
        outputMutation: "possible",
      };
    }),
    specification: fixture.specification,
    previous: retainedPreDispatch,
  });
  assert.equal(runningAfterDispatch.processState, "running");

  const absentBeforeDispatch = parseFoundationExecutionObservation({
    value: changedObservation(fixture.specification, 4, (subject) => {
      subject.allocationState = "absent";
      subject.dispatchState = "not-observed";
      subject.processState = "not-observed";
      subject.terminal = null;
      subject.containmentFacts = {
        rootProcess: "unverified",
        descendants: "absent",
        writers: "absent",
        credentials: "not-injected",
        providerChannel: "not-granted",
        outputMutation: "impossible",
      };
      subject.output = {
        disposition: "not-produced",
        manifestDigest: null,
        carrierByteLength: null,
      };
    }),
    specification: fixture.specification,
    previous: retainedPreDispatch,
  });
  assert.equal(executionObservationEstablishesContainment(absentBeforeDispatch, false), true);
  assert.equal(executionObservationEstablishesContainment(absentBeforeDispatch, true), false);

  assert.equal(executionObservationEstablishesContainment({
    ...terminal,
    allocationState: "absent",
  }, true), false);
  assert.equal(executionObservationEstablishesContainment({
    ...terminal,
    allocationState: "ambiguous",
  }, true), false);
  assert.equal(executionObservationEstablishesContainment({
    ...terminal,
    containmentFacts: { ...terminal.containmentFacts, writers: "unverified" },
  }, true), false);
  assert.equal(executionObservationEstablishesContainment({
    ...terminal,
    observedAt: "2026-09-01T00:00:00.000Z",
    terminal: { ...terminal.terminal!, finishedAt: "2026-09-01T00:00:01.000Z" },
  }, true), false);
  assert.equal(executionObservationEstablishesContainment({
    ...terminal,
    output: {
      disposition: "partial",
      manifestDigest: digest("forged-partial-manifest"),
      carrierByteLength: null,
    },
  }, true), false);
});

test("Reclamation reports only one closed private result without becoming Delivery state", () => {
  const fixture = executionContractFixture("reclamation-results");
  const handle = privateFoundationExecutionHandle(`execution-handle-v1:${"a".repeat(64)}`);
  const retirementCheckpointDigest = digest("reclamation-retirement-checkpoint");
  const binding = compileExecutionReclamationBinding({
    specification: fixture.specification,
    handle,
    retirementCheckpointDigest,
    dispatchAuthorityConsumed: true,
    backendBinding: Object.freeze({
      schema: "lifecycle.execution-contract-test-reclamation-binding.private.v1",
      bindingDigest: digest("reclamation-binding"),
    }),
  });
  const obligation = compileExecutionReclamationObligation({
    specification: fixture.specification,
    handle,
    retirementCheckpointDigest,
    reclamationBinding: binding,
  });
  for (const disposition of ["reclaimed", "remaining", "integrity-refusal"] as const) {
    const observation = compileExecutionReclamationObservation({
      obligation,
      observedAt: "2026-09-01T00:00:00.000Z",
      disposition,
      factsDigest: digest(`reclamation-${disposition}`),
    });
    assert.deepEqual(
      parseExecutionReclamationObservation(observation, fixture.specification, obligation),
      observation,
    );
    assert.deepEqual(Object.keys(observation).sort(), [
      "digest",
      "disposition",
      "factsDigest",
      "obligationDigest",
      "observedAt",
      "schema",
      "specificationDigest",
    ]);
  }

  const substitutedRetirement = digest("substituted-retirement-checkpoint");
  const substitutedBinding = compileExecutionReclamationBinding({
    specification: fixture.specification,
    handle,
    retirementCheckpointDigest: substitutedRetirement,
    dispatchAuthorityConsumed: true,
    backendBinding: binding.backendBinding,
  });
  const substitutedObligation = compileExecutionReclamationObligation({
    specification: fixture.specification,
    handle,
    retirementCheckpointDigest: substitutedRetirement,
    reclamationBinding: substitutedBinding,
  });
  const observation = compileExecutionReclamationObservation({
    obligation,
    observedAt: "2026-09-01T00:00:00.000Z",
    disposition: "remaining",
    factsDigest: digest("reclamation-cross-obligation"),
  });
  assert.throws(
    () => parseExecutionReclamationObservation(
      observation,
      fixture.specification,
      substitutedObligation,
    ),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.execution.reclamation-invalid",
  );
});
