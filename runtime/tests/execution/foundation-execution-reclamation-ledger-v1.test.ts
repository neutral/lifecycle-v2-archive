import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { FoundationError } from "../../src/foundation/error.js";
import {
  compileExecutionReclamationBinding,
  compileExecutionReclamationObligation,
  compileExecutionReclamationObservation,
  privateFoundationExecutionHandle,
  type FoundationExecutionHandle,
  type FoundationExecutionReclamationObservationV1,
} from "../../src/foundation/execution/backend.js";
import {
  parseFoundationExecutionSpecification,
  type FoundationExecutionSpecificationV1,
} from "../../src/foundation/execution/contracts.js";
import {
  foundationExecutionReclamationPreIntentRefusalSetDigestV1,
  foundationExecutionReclamationTerminalSubjectSetDigestV1,
  openFoundationExecutionReclamationLedgerV1,
  type FoundationExecutionReclamationHandoffInputV1,
  type FoundationExecutionReclamationLedgerClockV1,
  type FoundationExecutionReclamationLedgerV1,
  type FoundationExecutionReclamationPreIntentRefusalV1,
  type FoundationExecutionReclamationTerminalSubjectV1,
} from "../../src/foundation/execution/reclamation-ledger-v1.js";
import { selfDigest } from "../../src/foundation/validation/canonical.js";
import {
  digest,
  executionContractFixture,
} from "../support/execution-contract-fixture.js";

class TestClock implements FoundationExecutionReclamationLedgerClockV1 {
  #milliseconds: number;

  constructor(value = "2026-09-01T04:00:00.000Z") {
    this.#milliseconds = Date.parse(value);
  }

  now(): string {
    return new Date(this.#milliseconds).toISOString();
  }

  advance(milliseconds: number): void {
    this.#milliseconds += milliseconds;
  }
}

function claimTokens() {
  let value = 0;
  return () => {
    value += 1;
    return `reclamation-claim-v1:${value.toString(16).padStart(64, "0")}`;
  };
}

function handle(value: number): FoundationExecutionHandle {
  return privateFoundationExecutionHandle(
    `execution-handle-v1:${value.toString(16).padStart(64, "0")}`,
  );
}

function reclamationBinding(input: Readonly<{
  specification: FoundationExecutionSpecificationV1;
  handle: FoundationExecutionHandle;
  retirementCheckpointDigest: ReturnType<typeof digest>;
  dispatchAuthorityConsumed: boolean;
  salt: string;
}>) {
  return compileExecutionReclamationBinding({
    ...input,
    backendBinding: Object.freeze({
      schema: "lifecycle.execution-test-ledger-binding.private.v1",
      physicalBindingDigest: digest(`physical-${input.salt}`),
    }),
  });
}

function handoff(
  salt: string,
  handleValue: number,
  input: Readonly<{
    storeId?: string;
    processId?: string;
    retirementDigest?: ReturnType<typeof digest>;
    retirementCheckpointDigest?: ReturnType<typeof digest>;
    dispatchAuthorityConsumed?: boolean;
    activityId?: string;
  }> = {},
): FoundationExecutionReclamationHandoffInputV1 {
  const fixture = executionContractFixture(salt);
  const { digest: _fixtureDigest, ...fixtureSubject } = fixture.specification;
  const specificationSubject = input.activityId === undefined
    ? fixtureSubject
    : Object.freeze({
        ...fixtureSubject,
        owner: Object.freeze({
          ...fixture.specification.owner,
          activityId: input.activityId,
        }),
      });
  const specification = parseFoundationExecutionSpecification({
    value: Object.freeze({
      ...specificationSubject,
      digest: selfDigest(specificationSubject as unknown as Record<string, unknown>),
    }),
    backendProfile: fixture.profile,
    image: fixture.image,
    inputSet: fixture.inputSet,
  });
  assert.equal(specification.owner.kind, "agent-attempt");
  const selectedHandle = handle(handleValue);
  const dispatchAuthorityConsumed = input.dispatchAuthorityConsumed ?? true;
  const retirementCheckpointDigest = input.retirementCheckpointDigest ??
    digest(`retirement-checkpoint-${salt}`);
  const selectedBinding = reclamationBinding({
    specification,
    handle: selectedHandle,
    retirementCheckpointDigest,
    dispatchAuthorityConsumed,
    salt,
  });
  return Object.freeze({
    owner: Object.freeze({
      storeId: input.storeId ?? `store.${salt}`,
      processId: input.processId ?? `delivery.${salt}`,
      activityId: specification.owner.activityId,
      kind: "agent-attempt" as const,
      subjectDigest: specification.owner.attempt.digest,
    }),
    specification,
    handle: selectedHandle,
    reclamationBinding: selectedBinding,
    obligation: compileExecutionReclamationObligation({
      specification,
      handle: selectedHandle,
      retirementCheckpointDigest,
      reclamationBinding: selectedBinding,
    }),
    retirementDigest: input.retirementDigest ?? digest(`retirement-${salt}`),
    dispatchAuthorityConsumed,
  });
}

function observation(
  input: FoundationExecutionReclamationHandoffInputV1,
  observedAt: string,
  disposition: FoundationExecutionReclamationObservationV1["disposition"],
): FoundationExecutionReclamationObservationV1 {
  return compileExecutionReclamationObservation({
    obligation: input.obligation,
    observedAt,
    disposition,
    factsDigest: digest(`${input.obligation.digest}-${disposition}-${observedAt}`),
  });
}

function terminalSubject(
  input: FoundationExecutionReclamationHandoffInputV1,
  index: number,
): FoundationExecutionReclamationTerminalSubjectV1 {
  return Object.freeze({
    receipt: Object.freeze({
      kind: input.owner.kind === "agent-attempt" ? "execution-receipt" : "check-receipt",
      id: `receipt.reclamation.${index}`,
      revision: 1,
      digest: digest(`receipt-reclamation-${index}`),
    }),
    owner: input.owner,
    retirementFactsDigest: input.retirementDigest,
  });
}

function preIntentRefusal(
  input: FoundationExecutionReclamationHandoffInputV1,
  index: number,
): FoundationExecutionReclamationPreIntentRefusalV1 {
  return Object.freeze({
    event: Object.freeze({
      sequence: index,
      eventId: `event.agent-pre-intent-refused.${index}`,
      digest: digest(`event-agent-pre-intent-refused-${index}`),
    }),
    activityId: input.owner.activityId,
  });
}

function code(expected: string): (error: unknown) => boolean {
  return (error: unknown): boolean => {
    assert(error instanceof FoundationError);
    assert.equal(error.code, `lifecycle.execution.reclamation-ledger-v1.${expected}`);
    return true;
  };
}

async function root(t: TestContext): Promise<string> {
  const created = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-reclamation-ledger-")));
  t.after(async () => {
    await rm(created, { recursive: true, force: true });
  });
  return created;
}

async function openLedger(input: Readonly<{
  root: string;
  clock: TestClock;
  tokens: () => string;
  create: boolean;
  installationId?: string;
}>): Promise<FoundationExecutionReclamationLedgerV1> {
  return openFoundationExecutionReclamationLedgerV1({
    machineHome: input.root,
    installationId: input.installationId ?? "installation.reclamation-test",
    create: input.create,
    clock: input.clock,
    createClaimToken: input.tokens,
  });
}

test("handoff is exact, restart-stable, and idempotent without losing its tombstone", async (t) => {
  const selectedRoot = await root(t);
  const clock = new TestClock();
  const tokens = claimTokens();
  let ledger = await openLedger({ root: selectedRoot, clock, tokens, create: true });
  const input = handoff("restart", 1);
  const accepted = ledger.accept(input);
  const initialSummary = ledger.summarizeProcess({
    storeId: input.owner.storeId,
    processId: input.owner.processId,
  });
  assert.equal(initialSummary.obligationCount, 1);
  assert.equal(initialSummary.pendingCount, 1);

  clock.advance(10_000);
  const replay = ledger.accept(input);
  assert.deepEqual(replay, accepted);
  assert.equal(replay.acceptedAt, "2026-09-01T04:00:00.000Z");
  ledger.close();

  ledger = await openLedger({ root: selectedRoot, clock, tokens, create: false });
  assert.equal(ledger.list().length, 1);
  assert.equal(
    ledger.summarizeProcess({
      storeId: input.owner.storeId,
      processId: input.owner.processId,
    }).obligationSetDigest,
    initialSummary.obligationSetDigest,
  );
  const claim = ledger.claimNext();
  assert.notEqual(claim, null);
  clock.advance(1);
  const result = observation(input, clock.now(), "reclaimed");
  const reclaimed = ledger.completeClaim({
    claim: claim!,
    observation: result,
  });
  assert.equal(reclaimed.state, "reclaimed");
  assert.deepEqual(ledger.completeClaim({ claim: claim!, observation: result }), reclaimed);
  ledger.close();

  ledger = await openLedger({ root: selectedRoot, clock, tokens, create: false });
  const retained = ledger.list();
  assert.equal(retained.length, 1);
  assert.equal(retained[0]!.obligationDigest, input.obligation.digest);
  assert.equal(retained[0]!.standing.state, "reclaimed");
  assert.equal(ledger.summarizeProcess({
    storeId: input.owner.storeId,
    processId: input.owner.processId,
  }).obligationSetDigest, initialSummary.obligationSetDigest);
  assert.equal(ledger.claimNext(), null);
  ledger.close();
});

test("handoff replay and uniqueness refuse owner, Handle, Specification, and Retirement substitution", async (t) => {
  const selectedRoot = await root(t);
  const clock = new TestClock();
  const tokens = claimTokens();
  const ledger = await openLedger({ root: selectedRoot, clock, tokens, create: true });
  const input = handoff("substitution", 2);
  ledger.accept(input);

  assert.throws(() => ledger.accept(Object.freeze({
    ...input,
    owner: Object.freeze({ ...input.owner, storeId: "store.another" }),
  })), code("handoff-substitution"));
  assert.throws(() => ledger.accept(Object.freeze({
    ...input,
    retirementDigest: digest("substituted-retirement"),
  })), code("handoff-substitution"));

  const sameSpecificationOtherHandle = Object.freeze({
    ...input,
    handle: handle(3),
  });
  const specificationDuplicateRetirement = digest("other-specification-retirement-checkpoint");
  const specificationDuplicateBinding = reclamationBinding({
    specification: input.specification,
    handle: sameSpecificationOtherHandle.handle,
    retirementCheckpointDigest: specificationDuplicateRetirement,
    dispatchAuthorityConsumed: input.dispatchAuthorityConsumed,
    salt: "other-specification",
  });
  const specificationDuplicate = Object.freeze({
    ...sameSpecificationOtherHandle,
    reclamationBinding: specificationDuplicateBinding,
    obligation: compileExecutionReclamationObligation({
      specification: input.specification,
      handle: sameSpecificationOtherHandle.handle,
      retirementCheckpointDigest: specificationDuplicateRetirement,
      reclamationBinding: specificationDuplicateBinding,
    }),
    retirementDigest: digest("other-specification-retirement"),
  });
  assert.throws(() => ledger.accept(specificationDuplicate), code("handoff-duplicate"));

  const otherHandleRetirement = digest("other-handle-retirement-checkpoint");
  const sameHandleOtherBinding = reclamationBinding({
    specification: input.specification,
    handle: input.handle,
    retirementCheckpointDigest: otherHandleRetirement,
    dispatchAuthorityConsumed: input.dispatchAuthorityConsumed,
    salt: "other-handle-retirement",
  });
  const sameHandleOtherRetirement = Object.freeze({
    ...input,
    reclamationBinding: sameHandleOtherBinding,
    obligation: compileExecutionReclamationObligation({
      specification: input.specification,
      handle: input.handle,
      retirementCheckpointDigest: otherHandleRetirement,
      reclamationBinding: sameHandleOtherBinding,
    }),
    retirementDigest: digest("other-handle-retirement"),
  });
  assert.throws(() => ledger.accept(sameHandleOtherRetirement), code("handoff-duplicate"));

  const otherSubjectSameHandle = handoff("other-handle-subject", 2);
  assert.throws(() => ledger.accept(otherSubjectSameHandle), code("handoff-duplicate"));

  const other = handoff("other-subject", 4, {
    storeId: input.owner.storeId,
    processId: input.owner.processId,
    retirementDigest: input.retirementDigest,
  });
  assert.throws(() => ledger.accept(other), code("handoff-duplicate"));
  ledger.close();
});

test("terminal verification binds exact Receipt, Activity, owner, and obligation sets", async (t) => {
  const selectedRoot = await root(t);
  const clock = new TestClock();
  const tokens = claimTokens();
  const ledger = await openLedger({ root: selectedRoot, clock, tokens, create: true });
  const storeId = "store.terminal-verification";
  const processId = "delivery.terminal-verification";
  const first = handoff("terminal-first", 30, { storeId, processId });
  const second = handoff("terminal-second", 31, { storeId, processId });
  ledger.accept(first);
  ledger.accept(second);
  const subjects = Object.freeze([
    terminalSubject(first, 1),
    terminalSubject(second, 2),
  ]);

  const verified = ledger.verifyTerminalSubjects({
    storeId,
    processId,
    subjects,
    preIntentRefusals: Object.freeze([]),
  });
  assert.deepEqual(Object.keys(verified).sort(), [
    "executionCount",
    "obligationCount",
    "obligationSetDigest",
    "preIntentRefusalCount",
    "preIntentRefusalSetDigest",
    "terminalExecutionSetDigest",
  ]);
  assert.equal(verified.executionCount, 2);
  assert.equal(verified.preIntentRefusalCount, 0);
  assert.equal(verified.obligationCount, 2);
  assert.equal(
    verified.terminalExecutionSetDigest,
    foundationExecutionReclamationTerminalSubjectSetDigestV1({
      storeId,
      processId,
      subjects,
    }),
  );
  assert.equal(
    foundationExecutionReclamationTerminalSubjectSetDigestV1({
      storeId,
      processId,
      subjects,
    }),
    foundationExecutionReclamationTerminalSubjectSetDigestV1({
      storeId,
      processId,
      subjects: Object.freeze(subjects.map((subject, index) => Object.freeze({
        ...subject,
        retirementFactsDigest: digest(`different-private-retirement-${index}`),
      }))),
    }),
  );
  assert.equal(
    verified.preIntentRefusalSetDigest,
    foundationExecutionReclamationPreIntentRefusalSetDigestV1({
      storeId,
      processId,
      preIntentRefusals: Object.freeze([]),
    }),
  );

  assert.throws(
    () => ledger.verifyTerminalSubjects({
      storeId,
      processId,
      subjects: Object.freeze([subjects[0]!]),
      preIntentRefusals: Object.freeze([]),
    }),
    code("terminal-subject-set"),
  );
  assert.throws(
    () => ledger.verifyTerminalSubjects({
      storeId,
      processId,
      subjects: Object.freeze([
        subjects[0]!,
        Object.freeze({
          ...subjects[1]!,
          owner: Object.freeze({
            ...subjects[1]!.owner,
            subjectDigest: digest("same-count-substituted-owner"),
          }),
        }),
      ]),
      preIntentRefusals: Object.freeze([]),
    }),
    code("terminal-subject-set"),
  );
  const extra = handoff("terminal-extra", 32, { storeId, processId });
  assert.throws(
    () => ledger.verifyTerminalSubjects({
      storeId,
      processId,
      subjects: Object.freeze([...subjects, terminalSubject(extra, 3)]),
      preIntentRefusals: Object.freeze([]),
    }),
    code("terminal-subject-set"),
  );
  ledger.close();
});

test("terminal verification reconciles one exact pre-intent refusal after Reclamation", async (t) => {
  const selectedRoot = await root(t);
  const clock = new TestClock();
  const tokens = claimTokens();
  const storeId = "store.pre-intent-terminal";
  const processId = "delivery.pre-intent-terminal";
  const receiptHandoff = handoff("pre-intent-receipt", 33, { storeId, processId });
  const refusedHandoff = handoff("pre-intent-refused", 34, {
    storeId,
    processId,
    dispatchAuthorityConsumed: false,
  });
  const receiptSubject = terminalSubject(receiptHandoff, 4);
  const refusal = preIntentRefusal(refusedHandoff, 5);
  let ledger = await openLedger({ root: selectedRoot, clock, tokens, create: true });
  ledger.accept(receiptHandoff);
  ledger.accept(refusedHandoff);

  const byObligation = new Map([
    [receiptHandoff.obligation.digest, receiptHandoff],
    [refusedHandoff.obligation.digest, refusedHandoff],
  ]);
  for (;;) {
    const claim = ledger.claimNext();
    if (claim === null) break;
    const selected = byObligation.get(claim.handoff.obligation.digest);
    assert.notEqual(selected, undefined);
    clock.advance(1);
    ledger.completeClaim({
      claim,
      observation: observation(selected!, clock.now(), "reclaimed"),
    });
  }
  assert.deepEqual(ledger.list().map(({ standing }) => standing.state), [
    "reclaimed",
    "reclaimed",
  ]);
  ledger.close();

  ledger = await openLedger({ root: selectedRoot, clock, tokens, create: false });
  const verified = ledger.verifyTerminalSubjects({
    storeId,
    processId,
    subjects: Object.freeze([receiptSubject]),
    preIntentRefusals: Object.freeze([refusal]),
  });
  assert.equal(verified.executionCount, 1);
  assert.equal(verified.preIntentRefusalCount, 1);
  assert.equal(verified.obligationCount, 2);
  assert.equal(
    verified.terminalExecutionSetDigest,
    foundationExecutionReclamationTerminalSubjectSetDigestV1({
      storeId,
      processId,
      subjects: Object.freeze([receiptSubject]),
    }),
  );
  assert.equal(
    verified.preIntentRefusalSetDigest,
    foundationExecutionReclamationPreIntentRefusalSetDigestV1({
      storeId,
      processId,
      preIntentRefusals: Object.freeze([refusal]),
    }),
  );
  assert.notEqual(
    verified.preIntentRefusalSetDigest,
    foundationExecutionReclamationPreIntentRefusalSetDigestV1({
      storeId,
      processId,
      preIntentRefusals: Object.freeze([Object.freeze({
        ...refusal,
        event: Object.freeze({
          ...refusal.event,
          digest: digest("substituted-refusal-event"),
        }),
      })]),
    }),
  );

  assert.throws(() => ledger.verifyTerminalSubjects({
    storeId,
    processId,
    subjects: Object.freeze([receiptSubject]),
    preIntentRefusals: Object.freeze([]),
  }), code("terminal-subject-set"));
  assert.throws(() => ledger.verifyTerminalSubjects({
    storeId,
    processId,
    subjects: Object.freeze([]),
    preIntentRefusals: Object.freeze([preIntentRefusal(receiptHandoff, 7)]),
  }), code("terminal-subject-set"));
  assert.throws(() => ledger.verifyTerminalSubjects({
    storeId,
    processId,
    subjects: Object.freeze([receiptSubject]),
    preIntentRefusals: Object.freeze([Object.freeze({
      ...refusal,
      activityId: "activity.substituted-refusal",
    })]),
  }), code("terminal-subject-set"));
  assert.throws(() => ledger.verifyTerminalSubjects({
    storeId,
    processId,
    subjects: Object.freeze([Object.freeze({
      ...receiptSubject,
      retirementFactsDigest: digest("substituted-receipt-retirement"),
    })]),
    preIntentRefusals: Object.freeze([refusal]),
  }), code("terminal-subject-set"));
  assert.throws(() => ledger.verifyTerminalSubjects({
    storeId,
    processId,
    subjects: Object.freeze([receiptSubject, terminalSubject(refusedHandoff, 6)]),
    preIntentRefusals: Object.freeze([]),
  }), code("terminal-subject-set"));
  assert.throws(() => ledger.verifyTerminalSubjects({
    storeId,
    processId,
    subjects: Object.freeze([receiptSubject]),
    preIntentRefusals: Object.freeze([
      refusal,
      Object.freeze({
        ...refusal,
        event: Object.freeze({ ...refusal.event, eventId: "event.another-refusal" }),
      }),
    ]),
  }), code("terminal-subject-set"));
  ledger.close();
});

test("a pre-intent refusal alone reconciles an undispatched Agent allocation without a Receipt", async (t) => {
  const selectedRoot = await root(t);
  const clock = new TestClock();
  const tokens = claimTokens();
  const storeId = "store.refusal-only";
  const processId = "delivery.refusal-only";
  const refusedHandoff = handoff("refusal-only", 35, {
    storeId,
    processId,
    dispatchAuthorityConsumed: false,
  });
  const refusal = preIntentRefusal(refusedHandoff, 8);
  const ledger = await openLedger({ root: selectedRoot, clock, tokens, create: true });
  ledger.accept(refusedHandoff);

  const verified = ledger.verifyTerminalSubjects({
    storeId,
    processId,
    subjects: Object.freeze([]),
    preIntentRefusals: Object.freeze([refusal]),
  });
  assert.equal(verified.executionCount, 0);
  assert.equal(verified.preIntentRefusalCount, 1);
  assert.equal(verified.obligationCount, 1);
  assert.equal(
    verified.terminalExecutionSetDigest,
    foundationExecutionReclamationTerminalSubjectSetDigestV1({
      storeId,
      processId,
      subjects: Object.freeze([]),
    }),
  );
  ledger.close();
});

test("one pre-intent refusal cannot reconcile two undispatched allocations for one Activity", async (t) => {
  const selectedRoot = await root(t);
  const clock = new TestClock();
  const tokens = claimTokens();
  const storeId = "store.duplicate-refusal-activity";
  const processId = "delivery.duplicate-refusal-activity";
  const activityId = "activity.duplicate-refusal-allocation";
  const first = handoff("duplicate-refusal-first", 36, {
    storeId,
    processId,
    activityId,
    dispatchAuthorityConsumed: false,
  });
  const second = handoff("duplicate-refusal-second", 37, {
    storeId,
    processId,
    activityId,
    dispatchAuthorityConsumed: false,
  });
  const ledger = await openLedger({ root: selectedRoot, clock, tokens, create: true });
  ledger.accept(first);
  ledger.accept(second);

  assert.throws(() => ledger.verifyTerminalSubjects({
    storeId,
    processId,
    subjects: Object.freeze([]),
    preIntentRefusals: Object.freeze([preIntentRefusal(first, 9)]),
  }), code("terminal-subject-set"));
  ledger.close();
});

test("a lost claim is inert until exact lease expiry and stale results cannot win", async (t) => {
  const selectedRoot = await root(t);
  const clock = new TestClock();
  const tokens = claimTokens();
  let ledger = await openLedger({ root: selectedRoot, clock, tokens, create: true });
  const input = handoff("lost-claim", 5);
  ledger.accept(input);
  const lost = ledger.claimNext(1_000);
  assert.notEqual(lost, null);
  ledger.close();

  ledger = await openLedger({ root: selectedRoot, clock, tokens, create: false });
  assert.equal(ledger.claimNext(1_000), null);
  clock.advance(1_000);
  const recovered = ledger.claimNext(1_000);
  assert.notEqual(recovered, null);
  assert.notEqual(recovered!.claimToken, lost!.claimToken);
  assert.equal(recovered!.standingGeneration, lost!.standingGeneration + 1);

  assert.throws(() => ledger.completeClaim({
    claim: lost!,
    observation: observation(input, clock.now(), "reclaimed"),
  }), code("claim-cas"));
  clock.advance(1);
  const completed = ledger.completeClaim({
    claim: recovered!,
    observation: observation(input, clock.now(), "reclaimed"),
  });
  assert.equal(completed.state, "reclaimed");
  assert.equal(completed.attemptCount, 2);
  ledger.close();
});

test("remaining releases bounded retry while reclaimed and integrity-refusal are terminal", async (t) => {
  const selectedRoot = await root(t);
  const clock = new TestClock();
  const tokens = claimTokens();
  const ledger = await openLedger({ root: selectedRoot, clock, tokens, create: true });
  const retrying = handoff("remaining", 6);
  ledger.accept(retrying);
  const first = ledger.claimNext(5_000);
  assert.notEqual(first, null);
  clock.advance(1);
  const remaining = ledger.completeClaim({
    claim: first!,
    observation: observation(retrying, clock.now(), "remaining"),
  });
  assert.equal(remaining.state, "pending");
  assert.equal(remaining.claimToken, null);
  assert.notEqual(remaining.nextAttemptAt, null);
  assert.equal(ledger.claimNext(), null);

  clock.advance(Date.parse(remaining.nextAttemptAt!) - Date.parse(clock.now()));
  const retry = ledger.claimNext();
  assert.notEqual(retry, null);
  clock.advance(1);
  const reclaimed = ledger.completeClaim({
    claim: retry!,
    observation: observation(retrying, clock.now(), "reclaimed"),
  });
  assert.equal(reclaimed.state, "reclaimed");

  clock.advance(1);
  const refusedInput = handoff("integrity-refusal", 7);
  ledger.accept(refusedInput);
  const refusalClaim = ledger.claimNext();
  assert.notEqual(refusalClaim, null);
  clock.advance(1);
  const refused = ledger.completeClaim({
    claim: refusalClaim!,
    observation: observation(refusedInput, clock.now(), "integrity-refusal"),
  });
  assert.equal(refused.state, "integrity-refusal");
  assert.equal(ledger.claimNext(), null);

  const retrySummary = ledger.summarizeProcess({
    storeId: retrying.owner.storeId,
    processId: retrying.owner.processId,
  });
  assert.equal(retrySummary.reclaimedCount, 1);
  const refusalSummary = ledger.summarizeProcess({
    storeId: refusedInput.owner.storeId,
    processId: refusedInput.owner.processId,
  });
  assert.equal(refusalSummary.integrityRefusalCount, 1);
  ledger.close();
});

test("runNext invokes physical Reclamation after releasing the SQLite write transaction", async (t) => {
  const selectedRoot = await root(t);
  const clock = new TestClock();
  const tokens = claimTokens();
  const ledger = await openLedger({ root: selectedRoot, clock, tokens, create: true });
  const input = handoff("outside-transaction", 8);
  ledger.accept(input);
  const result = await ledger.runNext({
    leaseMilliseconds: 5_000,
    async reclaim(retained) {
      const probe = new DatabaseSync(ledger.paths.database, { timeout: 0 });
      try {
        probe.exec("BEGIN IMMEDIATE; ROLLBACK;");
      } finally {
        probe.close();
      }
      assert.equal(retained.obligation.digest, input.obligation.digest);
      assert.deepEqual(retained.reclamationBinding, input.reclamationBinding);
      clock.advance(1);
      return observation(input, clock.now(), "reclaimed");
    },
  });
  assert.equal(result?.standing.state, "reclaimed");
  ledger.close();
});

test("the fixed private outstanding ceiling refuses before allocation and reclaimed rows release backpressure", async (t) => {
  const selectedRoot = await root(t);
  const clock = new TestClock();
  const tokens = claimTokens();
  const ledger = await openLedger({ root: selectedRoot, clock, tokens, create: true });
  assert.doesNotThrow(() => ledger.assertAllocationAvailable());

  for (let index = 0; index < 64; index += 1) {
    ledger.accept(handoff(`availability-${index}`, 100 + index));
  }
  assert.throws(
    () => ledger.assertAllocationAvailable(),
    (error: unknown): boolean => {
      assert(error instanceof FoundationError);
      assert.equal(
        error.code,
        "lifecycle.execution.reclamation-ledger-v1.allocation-unavailable",
      );
      assert.equal(error.retryable, true);
      assert.deepEqual(error.observedFacts, {
        outstandingCount: 64,
        outstandingCeiling: 64,
        retainedCount: 64,
        retainedCeiling: 10_000,
      });
      return true;
    },
  );

  const claim = ledger.claimNext();
  assert.notEqual(claim, null);
  clock.advance(1);
  ledger.completeClaim({
    claim: claim!,
    observation: observation(claim!.handoff, clock.now(), "reclaimed"),
  });
  assert.doesNotThrow(() => ledger.assertAllocationAvailable());
  ledger.close();
});

test("owned root entries and exact SQLite schema fail closed", async (t) => {
  const selectedRoot = await root(t);
  const clock = new TestClock();
  const tokens = claimTokens();
  let ledger = await openLedger({ root: selectedRoot, clock, tokens, create: true });
  const database = ledger.paths.database;
  const ledgerRoot = ledger.paths.root;
  ledger.close();

  await assert.rejects(
    openLedger({
      root: selectedRoot,
      clock,
      tokens,
      create: false,
      installationId: "installation.substituted",
    }),
    code("metadata"),
  );

  await writeFile(join(ledgerRoot, "foreign-entry"), "not owned\n", { mode: 0o600 });
  await assert.rejects(
    openLedger({ root: selectedRoot, clock, tokens, create: false }),
    code("physical-layout"),
  );
  await rm(join(ledgerRoot, "foreign-entry"));

  const tamper = new DatabaseSync(database);
  tamper.exec("CREATE TABLE injected (value TEXT) STRICT;");
  tamper.close();
  await assert.rejects(
    openLedger({ root: selectedRoot, clock, tokens, create: false }),
    code("database-schema"),
  );
});
