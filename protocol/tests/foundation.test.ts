import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import {
  FOUNDATION_CONTROL_EVENT_KINDS,
  FOUNDATION_CONTROL_RECORD_KINDS,
  FOUNDATION_DELIVERY_OPERATIONS,
  FOUNDATION_DELIVERY_RECOVERY_STEPS,
  FOUNDATION_INTERFACE_PROTOCOL,
  FOUNDATION_RUNTIME_FACADE_SCHEMA,
  FOUNDATION_RUNTIME_OBSERVATION_SCHEMA,
  FOUNDATION_RUNTIME_OPERATION_KINDS,
  FOUNDATION_RUNTIME_PROTOCOL,
  FOUNDATION_RUNTIME_RESULT_SCHEMA,
  FOUNDATION_RUNTIME_VERSION_EXPECTATION,
  FoundationAttemptViewSchema,
  FoundationCliErrorSchema,
  FoundationControlEventSchema,
  FoundationControlRevisionSchema,
  FoundationDeliveryActivityPresentationSchema,
  FoundationDeliveryGenerationSchema,
  FoundationDeliveryStateSchema,
  FoundationDeliveryViewSchema,
  FoundationExportResultSchema,
  FoundationInspectionResultSchema,
  FoundationProtocolError,
  FoundationPublicFactsSchema,
  FoundationRepositoryAtlasObservationSchema,
  FoundationRepositoryObservationSchema,
  FoundationRuntimeVersionSchema,
  FoundationSubmissionDiagnosticSchema,
  canonicalFoundationJson,
  createFoundationRuntimeOperationRequest,
  createFoundationRuntimeOperationResult,
  digestFoundationCanonical,
  parseFoundationRuntimeOperationRequest,
  parseFoundationRuntimeOperationRequestJson,
  parseFoundationRuntimeOperationResult,
  parseFoundationRuntimeOperationResultForRequest,
  parseFoundationCliErrorJson,
  parseFoundationRuntimeVersionJson,
  selfDigestFoundationCarrier,
  serializeFoundationRuntimeOperationRequest,
  serializeFoundationRuntimeOperationResult,
  type FoundationChangeFacts,
  type FoundationRuntimeObservation,
} from "../src/foundation.js";

const sha = (character: string) => `sha256:${character.repeat(64)}` as const;
const commit = "a".repeat(40);
const observedAt = "2026-08-29T12:00:00.000Z";

function state() {
  return FoundationDeliveryStateSchema.parse({
    schema: "lifecycle.delivery-reduction.v2",
    storeId: "store.delivery-1",
    processId: "delivery-1",
    standing: "active",
    candidateCondition: "ready-for-work",
    activities: [],
    recovery: null,
    subjects: {
      proposedBoundary: null,
      activeBoundary: { kind: "work-boundary", id: "boundary-1", revision: 1, digest: sha("b") },
      candidate: { kind: "candidate-revision", id: "candidate-1", revision: 1, digest: sha("c") },
      materialCondition: null,
      seal: null,
      evidence: null,
      closure: null,
    },
    journal: { eventCount: 1, headSequence: 1, headDigest: sha("d") },
    storeDisposition: {
      stage: "active",
      integrity: "verified",
      sealSubjectDigest: null,
      archiveManifestDigest: null,
    },
    eligibleOperations: ["delivery.continue", "delivery.evaluate", "delivery.no-ship"],
  });
}

function observation(
  delivery: ReturnType<typeof state> | null = state(),
): FoundationRuntimeObservation {
  return {
    schema: FOUNDATION_RUNTIME_OBSERVATION_SCHEMA,
    observedAt,
    repository: {
      schema: "lifecycle.repository-observation.v10",
      initialized: true,
      valid: true,
      targetId: "target-1",
      repositoryContract: "lifecycle.repository.v15",
      repositoryContractDigest: sha("e"),
      headCommit: commit,
      headTree: commit,
      productDigest: sha("f"),
      atlas: {
        selection: {
          release: "0.7.0",
          specificationRevision: "429fee62966f4d30e91ec2a15d27ecf353f5d68f",
          authoredFormat: 1,
          processorRevision: "746cbce73c51b28d617b96ca08f18d498ac749c4",
          validationProfile: "neutral.atlas-validator.resolved",
          validationResultSchema: "urn:atlas:schema:validation-result:1",
          normalizedModelSchema: "urn:atlas:schema:normalized:1",
          consumerProfile: "lifecycle.atlas-consumer.v1",
        },
        processor: {
          id: "atlas-reference-validator",
          version: "0.7.0",
          implementationDigest: sha("0"),
        },
        stateDigest: sha("1"),
        resolutionDigest: sha("4"),
        normalizedModelDigest: sha("5"),
        resourceBindingsDigest: sha("6"),
        complete: true,
        valid: true,
      },
      knowledgeDigest: sha("2"),
      checkBindingsDigest: sha("3"),
    },
    delivery,
  };
}

function deliveryView(delivery = state()) {
  const generation = FoundationDeliveryGenerationSchema.parse({
    schema: "lifecycle.delivery-generation.v1",
    storeId: delivery.storeId,
    processId: delivery.processId,
    journal: delivery.journal,
    storeDisposition: delivery.storeDisposition,
    repository: {
      headCommit: commit,
      headTree: commit,
      repositoryContractDigest: sha("e"),
    },
    activeOperation: null,
    digest: sha("7"),
  });
  return FoundationDeliveryViewSchema.parse({
    schema: "lifecycle.delivery-view.v1",
    generation,
    state: delivery,
    currentSubjects: delivery.subjects,
    semantics: {
      outcome: { disposition: null, summary: null, uncertainty: null },
      claims: [],
      proposedEffects: [],
      limitations: [],
      requiredChecks: [],
      boundaryProposal: null,
    },
    nextPass: [{
      operation: "delivery.continue",
      eligible: true,
      role: "builder",
      boundary: delivery.subjects.activeBoundary,
      candidate: delivery.subjects.candidate,
      consequence: "Run one exact continuation.",
      investment: {
        freshness: "fresh-on-invocation",
        model: "model-test",
        reasoning: "reasoning-test",
        wallTimeMs: 30_000,
        maximumOutputBytes: 65_536,
      },
    }],
    decisionReadiness: {
      boundary: delivery.subjects.activeBoundary,
      candidate: delivery.subjects.candidate,
      changedSubjects: [],
      seal: delivery.subjects.seal,
      checks: [],
      reviewerFindings: [],
      uncertainty: null,
      limitations: [],
      evidence: delivery.subjects.evidence,
      evidenceReadiness: null,
      terminalChoices: delivery.eligibleOperations.filter((operation) =>
        operation === "delivery.accept" || operation === "delivery.no-ship"),
    },
    activity: null,
    controlFamilies: [],
  });
}

const unchanged: FoundationChangeFacts = {
  repository: { changed: false, beforeCommit: commit, afterCommit: commit },
  candidate: { changed: false, before: null, after: null },
  control: { advanced: false, beforeHead: null, afterHead: null },
};

function resealRuntimeResult<T extends Readonly<{ digest: string }>>(value: T) {
  const { digest: _digest, ...subject } = value;
  return {
    ...subject,
    digest: selfDigestFoundationCarrier(subject as Readonly<Record<string, unknown>>),
  };
}

function assertInvalidRuntimeResultAt(
  value: unknown,
  path: readonly (string | number)[],
): void {
  assert.throws(
    () => parseFoundationRuntimeOperationResult(value),
    (error) => {
      assert.ok(error instanceof FoundationProtocolError);
      assert.equal(error.code, "lifecycle.interface.result-invalid");
      assert.deepEqual(error.path, path);
      return true;
    },
  );
}

test("v10 exposes one closed compact operation surface", () => {
  assert.equal(FOUNDATION_INTERFACE_PROTOCOL, "lifecycle.interface.foundation.v10");
  assert.equal(FOUNDATION_RUNTIME_PROTOCOL, "lifecycle.runtime.foundation.v10");
  assert.equal(FOUNDATION_RUNTIME_FACADE_SCHEMA, "lifecycle.foundation-runtime-facade.v10");
  assert.equal(FOUNDATION_RUNTIME_RESULT_SCHEMA, "lifecycle.foundation-runtime-result.v10");
  assert.equal(FOUNDATION_RUNTIME_OBSERVATION_SCHEMA, "lifecycle.foundation-runtime-observation.v10");
  assert.deepEqual(FOUNDATION_DELIVERY_OPERATIONS, [
    "delivery.prepare", "delivery.admit", "delivery.continue", "delivery.evaluate",
    "delivery.revise", "delivery.reaffirm", "delivery.accept", "delivery.no-ship",
    "delivery.recover",
  ]);
  assert.deepEqual(FOUNDATION_RUNTIME_OPERATION_KINDS, [
    "repository.initialize", "repository.validate", "delivery.inbox", "delivery.status",
    ...FOUNDATION_DELIVERY_OPERATIONS, "delivery.inspect", "delivery.diff", "delivery.watch",
    "delivery.export",
  ]);
  assert.equal(FOUNDATION_CONTROL_RECORD_KINDS.length, 12);
  assert.equal(FOUNDATION_CONTROL_EVENT_KINDS.length, 22);
  assert.deepEqual(FOUNDATION_DELIVERY_RECOVERY_STEPS, [
    "candidate-sealed",
    "agent-attempt-prepared",
    "provider-effect-intended",
    "provider-effect-observed",
    "work-product-observation",
    "candidate-revision-observed",
    "execution-receipt-recorded",
    "work-boundary-finalized",
    "baseline-checks",
    "evaluation-checks",
    "activity-finalization",
    "activity-completed",
    "founder-decision-authenticated",
    "transaction-effect-intended",
    "transaction-effect-observed",
    "transaction-finalization",
    "store-seal",
    "store-archive",
  ]);
});

test("repository observation exposes only the exact complete resolved Atlas selection", () => {
  const repository = observation().repository;
  assert.ok(repository.atlas !== null);
  assert.deepEqual(
    FoundationRepositoryAtlasObservationSchema.parse(repository.atlas).selection,
    repository.atlas.selection,
  );
  assert.equal(FoundationRepositoryAtlasObservationSchema.safeParse({
    ...repository.atlas,
    selection: { ...repository.atlas.selection, release: "1.0.0" },
  }).success, false);
  assert.equal(FoundationRepositoryAtlasObservationSchema.safeParse({
    ...repository.atlas,
    complete: false,
  }).success, false);
  assert.equal(FoundationRepositoryAtlasObservationSchema.safeParse({
    ...repository.atlas,
    processor: { ...repository.atlas.processor, id: "another-processor" },
  }).success, false);
  const { atlas: _atlas, ...withoutAtlas } = repository;
  assert.equal(FoundationRepositoryObservationSchema.safeParse({
    ...withoutAtlas,
    atlasDigest: sha("1"),
  }).success, false);
});

test("strict version and CLI-error envelopes retain every v10 field", () => {
  const version = {
    ...FOUNDATION_RUNTIME_VERSION_EXPECTATION,
    publicationDigest: sha("a"),
    provider: {
      ...FOUNDATION_RUNTIME_VERSION_EXPECTATION.provider,
      defaultDescriptorDigest: sha("b"),
    },
  };
  assert.equal(version.specificationRevision, "lifecycle.foundation.1.0.0-rc.10");
  assert.equal(version.provider.defaultDescriptorId, "codex-exec-standard-v6");
  assert.equal(version.codex.executableRange, ">=0.151.0 <0.152.0");
  assert.equal(version.codex.generatedWith, "0.151.0");
  assert.equal(FoundationRuntimeVersionSchema.parse(version).runtimeProtocol, FOUNDATION_RUNTIME_PROTOCOL);
  assert.equal(parseFoundationRuntimeVersionJson(JSON.stringify(version)).provider.protocol, "lifecycle.provider-adapter.v6");
  assert.equal(FoundationRuntimeVersionSchema.safeParse({ ...version, codex: { ...version.codex, protocol: "wrong" } }).success, false);
  const error = {
    error: {
      code: "lifecycle.test.refusal", message: "Exact refusal.", retryable: false,
      repositoryChanged: false, operationalStateChanged: false,
      recoveryActions: [{ action: "inspect", detail: "Inspect the exact Delivery." }],
      observedFacts: { deliveryId: "delivery-1" },
      diagnostics: [{ code: "note" }],
    },
  };
  assert.equal(FoundationCliErrorSchema.parse(error).error.diagnostics?.[0]?.code, "note");
  assert.equal(parseFoundationCliErrorJson(JSON.stringify(error)).recoveryActions[0]?.action, "inspect");
  assert.equal(FoundationCliErrorSchema.safeParse({ error: { ...error.error, unknown: true } }).success, false);
});

test("prepare creates a Delivery while every later Delivery request selects one", () => {
  const prepare = createFoundationRuntimeOperationRequest({
    target: "/target",
    operation: "delivery.prepare",
    input: { semanticMarkdown: "# Frame\n\nBuild the exact feature.\n" },
  });
  assert.equal("deliveryId" in prepare, false);

  for (const request of [
    { operation: "delivery.status", input: null },
    { operation: "delivery.admit", input: null },
    { operation: "delivery.continue", input: { semanticMarkdown: "Continue.\n" } },
    { operation: "delivery.evaluate", input: { semanticMarkdown: "Evaluate.\n" } },
    { operation: "delivery.revise", input: { semanticMarkdown: "Revise.\n" } },
    { operation: "delivery.reaffirm", input: { semanticMarkdown: "Reaffirm.\n" } },
    { operation: "delivery.accept", input: null },
    {
      operation: "delivery.no-ship",
      input: { semanticMarkdown: "Do not ship.\n" },
    },
    { operation: "delivery.recover", input: null },
    { operation: "delivery.inspect", input: { kind: "summary" } },
    { operation: "delivery.diff", input: { subject: "candidate", maximumBytes: 65_536 } },
    { operation: "delivery.export", input: { format: "markdown", selection: { kind: "delivery" } } },
  ] as const) {
    const parsed = createFoundationRuntimeOperationRequest({ target: "/target", deliveryId: "delivery-1", ...request });
    assert.equal("deliveryId" in parsed ? parsed.deliveryId : null, "delivery-1");
    assert.throws(() => parseFoundationRuntimeOperationRequest({
      schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
      target: "/target",
      ...request,
    }), FoundationProtocolError);
  }
});

test("Inbox and watch carry exact scope while semantic mutations may bind one expected generation", () => {
  const generation = sha("7");
  const inbox = createFoundationRuntimeOperationRequest({
    target: "/target",
    operation: "delivery.inbox",
    input: { afterDeliveryId: null, limit: 50 },
  });
  assert.equal(inbox.operation, "delivery.inbox");

  const deliveryWatch = createFoundationRuntimeOperationRequest({
    target: "/target",
    deliveryId: "delivery-1",
    operation: "delivery.watch",
    input: { scope: "delivery", afterGeneration: generation, timeoutMs: 30_000 },
  });
  assert.equal(deliveryWatch.operation, "delivery.watch");
  assert.equal("deliveryId" in deliveryWatch ? deliveryWatch.deliveryId : null, "delivery-1");
  const inboxWatch = createFoundationRuntimeOperationRequest({
    target: "/target",
    deliveryId: null,
    operation: "delivery.watch",
    input: { scope: "inbox", afterGeneration: generation, timeoutMs: 0 },
  });
  assert.equal(inboxWatch.operation, "delivery.watch");
  assert.equal(inboxWatch.operation === "delivery.watch" ? inboxWatch.input.scope : null, "inbox");

  for (const invalid of [
    { deliveryId: null, scope: "delivery" },
    { deliveryId: "delivery-1", scope: "inbox" },
  ] as const) {
    assert.throws(() => createFoundationRuntimeOperationRequest({
      target: "/target",
      deliveryId: invalid.deliveryId,
      operation: "delivery.watch",
      input: { scope: invalid.scope, afterGeneration: null, timeoutMs: 0 },
    }), (error: unknown) => (
      error instanceof FoundationProtocolError && error.code === "lifecycle.interface.watch-scope"
    ));
  }

  for (const operation of ["delivery.continue", "delivery.evaluate", "delivery.revise", "delivery.reaffirm"] as const) {
    const request = createFoundationRuntimeOperationRequest({
      target: "/target",
      deliveryId: "delivery-1",
      operation,
      input: { semanticMarkdown: `${operation}.\n`, expectedGeneration: generation },
    });
    assert.equal(
      request.operation === "delivery.continue" ||
      request.operation === "delivery.evaluate" ||
      request.operation === "delivery.revise" ||
      request.operation === "delivery.reaffirm"
        ? request.input.expectedGeneration
        : null,
      generation,
    );
  }
});

test("mutation input carries semantic Markdown or null and never authority material", () => {
  assert.throws(() => parseFoundationRuntimeOperationRequest({
    schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
    target: "/target",
    operation: "delivery.prepare",
    input: { semanticMarkdown: "---\nidentity: agent\n---\n" },
  }), FoundationProtocolError);
  assert.throws(() => parseFoundationRuntimeOperationRequest({
    schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
    target: "/target",
    deliveryId: "delivery-1",
    operation: "delivery.admit",
    input: { authorityProof: "proof" },
  }), FoundationProtocolError);
  assert.throws(() => parseFoundationRuntimeOperationRequest({
    schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
    target: "/target",
    deliveryId: "delivery-1",
    operation: "delivery.accept",
    input: { authorityProof: "proof" },
  }), FoundationProtocolError);
  assert.throws(() => parseFoundationRuntimeOperationRequest({
    schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
    target: "/target",
    deliveryId: "delivery-1",
    operation: "delivery.no-ship",
    input: { semanticMarkdown: "Do not ship.\n", authorityProof: "proof" },
  }), FoundationProtocolError);
  assert.throws(() => parseFoundationRuntimeOperationRequest({
    schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
    target: "/target",
    deliveryId: "delivery-1",
    operation: "delivery.recover",
    input: { authorityProof: "new-proof" },
  }), FoundationProtocolError);
});

test("requests are strict, canonical, digestible, and duplicate-key safe", () => {
  const request = createFoundationRuntimeOperationRequest({
    target: "/target", deliveryId: "delivery-1", operation: "delivery.status", input: null,
  });
  assert.equal(serializeFoundationRuntimeOperationRequest(request), `${canonicalFoundationJson(request)}\n`);
  assert.match(digestFoundationCanonical(request), /^sha256:[a-f0-9]{64}$/u);
  assert.throws(
    () => parseFoundationRuntimeOperationRequestJson(
      '{"schema":"lifecycle.foundation-runtime-facade.v10","target":"/target","target":"/other","operation":"repository.validate","input":null}',
    ),
    FoundationProtocolError,
  );
});

test("portable canonical digests match Node SHA-256 exactly", () => {
  const values = [
    null,
    "",
    "Lifecycle · 候補 · 🚀",
    { z: [true, false, null, -0, 42.5], a: "ordered by code point" },
    { body: "x".repeat(1_048_576) },
  ] as const;
  for (const value of values) {
    const canonical = canonicalFoundationJson(value);
    const expected = `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
    assert.equal(digestFoundationCanonical(value), expected);
  }
});

test("Control events retain exact logical identities and self-digests", () => {
  const source = {
    schema: "lifecycle.control-record-event.v2" as const,
    storeId: "store.delivery-1",
    processId: "delivery-1",
    sequence: 1,
    eventId: "event-1",
    eventKind: "delivery-created" as const,
    occurredAt: observedAt,
    actor: { kind: "runtime" as const, id: "runtime-1" },
    subject: null,
    payload: {},
    predecessorDigest: null,
  };
  const event = FoundationControlEventSchema.parse({ ...source, digest: selfDigestFoundationCarrier(source) });
  assert.equal(event.eventKind, "delivery-created");
  assert.throws(() => FoundationControlEventSchema.parse({ ...event, sequence: 2 }), /digest mismatch|predecessor/u);
  assert.equal(FoundationControlEventSchema.safeParse({
    ...event,
    schema: "lifecycle.control-record-event.v1",
  }).success, false);

  const retiredAtlasDrift = {
    ...source,
    eventId: "event-retired-atlas-drift",
    eventKind: "material-condition-frozen" as const,
    subject: { recordId: "condition-retired-atlas-drift", revision: 1, digest: sha("a") },
    payload: {
      sourceKind: "runtime-atlas-drift",
      activityId: null,
      observedFactsDigest: sha("b"),
    },
  };
  assert.equal(FoundationControlEventSchema.safeParse({
    ...retiredAtlasDrift,
    digest: selfDigestFoundationCarrier(retiredAtlasDrift),
  }).success, false);

  const transactionFacts = {
    schema: "lifecycle.admission-effect-observation-facts.v2" as const,
    outcome: "applied" as const,
    disposition: null,
    repositoryBasisDigest: sha("2"),
  };
  const transactionObservation = {
    ...source,
    sequence: 2,
    eventId: "event-transaction-observation-1",
    eventKind: "transaction-effect-observed" as const,
    subject: { recordId: "decision-1", revision: 1, digest: sha("e") },
    payload: {
      activityId: "activity-1",
      effectDigest: sha("f"),
      outcome: "applied" as const,
      facts: transactionFacts,
      factsDigest: digestFoundationCanonical(transactionFacts),
    },
    predecessorDigest: event.digest,
  };
  const retainedObservation = FoundationControlEventSchema.parse({
    ...transactionObservation,
    digest: selfDigestFoundationCarrier(transactionObservation),
  });
  assert.equal(
    (retainedObservation.payload as { factsDigest: string }).factsDigest,
    digestFoundationCanonical(transactionFacts),
  );
  const custodyFacts = {
    ...transactionFacts,
    candidateCustody: { physicalIdentityDigest: sha("0") },
  };
  const custodyObservation = {
    ...transactionObservation,
    payload: {
      ...transactionObservation.payload,
      facts: custodyFacts,
      factsDigest: digestFoundationCanonical(custodyFacts),
    },
  };
  assert.equal(FoundationControlEventSchema.safeParse({
    ...custodyObservation,
    digest: selfDigestFoundationCarrier(custodyObservation),
  }).success, false);
  const acceptanceFacts = {
    schema: "lifecycle.terminal-acceptance-effect-observation.v1" as const,
    ref: "refs/heads/main",
    commit: "a".repeat(40),
    tree: "b".repeat(40),
    objectFormat: "sha1" as const,
    canonicalResultDigest: sha("1"),
  };
  const acceptanceObservation = {
    ...transactionObservation,
    eventId: "event-terminal-acceptance-observation",
    payload: {
      ...transactionObservation.payload,
      facts: acceptanceFacts,
      factsDigest: digestFoundationCanonical(acceptanceFacts),
    },
  };
  assert.equal(FoundationControlEventSchema.safeParse({
    ...acceptanceObservation,
    digest: selfDigestFoundationCarrier(acceptanceObservation),
  }).success, true);
  const acceptanceFactsWithoutResultDigest = {
    schema: "lifecycle.terminal-acceptance-effect-observation.v1" as const,
    ref: "refs/heads/main",
    commit: "a".repeat(40),
    tree: "b".repeat(40),
    objectFormat: "sha1" as const,
  };
  const acceptanceWithoutResultDigest = {
    ...transactionObservation,
    eventId: "event-terminal-acceptance-observation-missing-result-digest",
    payload: {
      ...transactionObservation.payload,
      facts: acceptanceFactsWithoutResultDigest,
      factsDigest: digestFoundationCanonical(acceptanceFactsWithoutResultDigest),
    },
  };
  assert.equal(FoundationControlEventSchema.safeParse({
    ...acceptanceWithoutResultDigest,
    digest: selfDigestFoundationCarrier(acceptanceWithoutResultDigest),
  }).success, false);
  const { factsDigest: _omitted, ...incompletePayload } = transactionObservation.payload;
  const incompleteObservation = { ...transactionObservation, payload: incompletePayload };
  assert.equal(FoundationControlEventSchema.safeParse({
    ...incompleteObservation,
    digest: selfDigestFoundationCarrier(incompleteObservation),
  }).success, false);
  const { facts: _missingFacts, ...payloadWithoutFacts } = transactionObservation.payload;
  const observationWithoutFacts = { ...transactionObservation, payload: payloadWithoutFacts };
  assert.equal(FoundationControlEventSchema.safeParse({
    ...observationWithoutFacts,
    digest: selfDigestFoundationCarrier(observationWithoutFacts),
  }).success, false);
  const mutatedFacts = { ...transactionFacts, repositoryBasisDigest: sha("3") };
  const mismatchedObservation = {
    ...transactionObservation,
    payload: { ...transactionObservation.payload, facts: mutatedFacts },
  };
  assert.equal(FoundationControlEventSchema.safeParse({
    ...mismatchedObservation,
    digest: selfDigestFoundationCarrier(mismatchedObservation),
  }).success, false);
  const determinateWithoutBasisFacts = {
    ...transactionFacts,
    repositoryBasisDigest: null,
  };
  const determinateWithoutBasis = {
    ...transactionObservation,
    payload: {
      ...transactionObservation.payload,
      facts: determinateWithoutBasisFacts,
      factsDigest: digestFoundationCanonical(determinateWithoutBasisFacts),
    },
  };
  assert.equal(FoundationControlEventSchema.safeParse({
    ...determinateWithoutBasis,
    digest: selfDigestFoundationCarrier(determinateWithoutBasis),
  }).success, false);
  const mismatchedAdmissionBasisFacts = {
    ...transactionFacts,
    outcome: "not-applied" as const,
    disposition: {
      outcome: "not-applied" as const,
      reason: "repository-basis-mismatch" as const,
      observedFactsDigest: sha("3"),
    },
  };
  const mismatchedAdmissionBasis = {
    ...transactionObservation,
    payload: {
      ...transactionObservation.payload,
      outcome: "not-applied" as const,
      facts: mismatchedAdmissionBasisFacts,
      factsDigest: digestFoundationCanonical(mismatchedAdmissionBasisFacts),
    },
  };
  assert.equal(FoundationControlEventSchema.safeParse({
    ...mismatchedAdmissionBasis,
    digest: selfDigestFoundationCarrier(mismatchedAdmissionBasis),
  }).success, false);
  const unboundedTerminalFacts = {
    schema: "lifecycle.terminal-repository-effect-observation.v1" as const,
    ref: `refs/heads/${"a".repeat(502)}`,
    commit: "a".repeat(40),
    tree: "b".repeat(40),
    objectFormat: "sha1" as const,
  };
  const unboundedTerminalObservation = {
    ...transactionObservation,
    payload: {
      ...transactionObservation.payload,
      facts: unboundedTerminalFacts,
      factsDigest: digestFoundationCanonical(unboundedTerminalFacts),
    },
  };
  assert.equal(FoundationControlEventSchema.safeParse({
    ...unboundedTerminalObservation,
    digest: selfDigestFoundationCarrier(unboundedTerminalObservation),
  }).success, false);
  for (const formatMismatchFacts of [
    {
      schema: "lifecycle.terminal-repository-effect-observation.v1" as const,
      ref: "refs/heads/main",
      commit: "a".repeat(64),
      tree: "b".repeat(40),
      objectFormat: "sha1" as const,
    },
    {
      schema: "lifecycle.terminal-detached-canonical-effect-observation.v1" as const,
      attached: {
        ref: "refs/heads/main",
        commit: "a".repeat(40),
        tree: "b".repeat(40),
        objectFormat: "sha256" as const,
      },
      canonicalRef: "refs/heads/main",
      canonicalCommit: "c".repeat(64),
      canonicalTree: "d".repeat(64),
    },
  ]) {
    const formatMismatch = {
      ...transactionObservation,
      payload: {
        ...transactionObservation.payload,
        outcome: "not-applied" as const,
        facts: formatMismatchFacts,
        factsDigest: digestFoundationCanonical(formatMismatchFacts),
      },
    };
    assert.equal(FoundationControlEventSchema.safeParse({
      ...formatMismatch,
      digest: selfDigestFoundationCarrier(formatMismatch),
    }).success, false);
  }
});

test("Control revisions expose semantic records without physical custody", () => {
  const source = {
    schema: "lifecycle.control-record-revision.v1" as const,
    processId: "delivery-1",
    recordId: "brief-1",
    recordKind: "founder-brief" as const,
    revision: 1,
    producer: { kind: "runtime" as const, id: "runtime-1" },
    semanticAuthor: { kind: "founder" as const, id: "founder-1" },
    semanticAuthority: "founder-supplied" as const,
    createdAt: observedAt,
    semanticMarkdown: "# Frame\n\nBuild the feature.\n",
    payload: { operation: "delivery.prepare" },
    relationships: [],
  };
  const record = FoundationControlRevisionSchema.parse({ ...source, digest: selfDigestFoundationCarrier(source) });
  assert.equal(record.recordKind, "founder-brief");
  assert.equal(FoundationPublicFactsSchema.safeParse({ authorityProof: "signature-bytes" }).success, false);
  assert.equal(FoundationPublicFactsSchema.safeParse({ databasePath: "/private/store.sqlite" }).success, false);
  assert.equal(FoundationPublicFactsSchema.safeParse({ nested: { providerBytes: "opaque" } }).success, false);
  for (const facts of [
    { nested: { allocation_key: "private-allocation" } },
    { nested: { "CELL-ID": "private-cell" } },
    { nested: { execution_cell_id: "private-cell" } },
    { nested: { backend_endpoint: "private-backend" } },
    { nested: { backendLocator: "private-backend" } },
    { nested: { backendUrl: "private-backend" } },
    { nested: { candidateCustody: { physicalIdentityDigest: sha("0") } } },
    { nested: { credentialFile: "/private/credential" } },
    { nested: { credentialEndpoint: "private-credential" } },
    { nested: { authToken: "private-token" } },
    { nested: { authorityFile: "/private/authority" } },
    { nested: { codexHome: "/private/codex" } },
    { nested: { dockerConfig: "/private/docker-config" } },
    { nested: { docker_socket: "/private/docker.sock" } },
    { nested: { dockerHost: "private-docker" } },
    { nested: { containerRuntimeId: "private-container" } },
    { nested: { containerEngineId: "private-engine" } },
    { nested: { engineEndpoint: "private-engine" } },
    { nested: { environmentValue: "private-environment" } },
    { nested: { executionHandle: "private-handle" } },
    { nested: { materialization: { root: "private" } } },
    { nested: { machineHome: "/private/machine" } },
    { nested: { outputCarrierCoordinate: "private-output" } },
    { nested: { providerToken: "private-provider-token" } },
    { nested: { "Reclamation-State": "pending" } },
    { nested: { transactionLocator: "private-transaction" } },
    { nested: { supportCoordinateDigest: sha("1") } },
  ]) {
    assert.equal(FoundationPublicFactsSchema.safeParse(facts).success, false);
  }
  assert.equal(FoundationPublicFactsSchema.safeParse({
    execution: {
      backendProfile: {
        profileId: "lifecycle.execution-backend-profile.docker-local.v1",
        profileDigest: sha("1"),
      },
      imageDigest: sha("2"),
      specificationDigest: sha("3"),
      inputSetDigest: sha("4"),
      outputManifestDigest: sha("5"),
      containment: "contained",
      retirement: "retired",
    },
  }).success, true);
  assert.equal(FoundationDeliveryActivityPresentationSchema.safeParse({
    activityId: "activity-1",
    operation: "delivery.continue",
    stage: "provider-running",
  }).success, true);
  assert.equal(FoundationDeliveryActivityPresentationSchema.safeParse({
    activityId: "activity-1",
    operation: "delivery.continue",
    stage: "provider-running",
    supportCoordinateDigest: sha("6"),
  }).success, false);
});

test("Delivery generation is an opaque staleness token without private support fields", () => {
  const delivery = state();
  const subject = {
    schema: "lifecycle.delivery-generation.v1" as const,
    storeId: delivery.storeId,
    processId: delivery.processId,
    journal: delivery.journal,
    storeDisposition: delivery.storeDisposition,
    repository: {
      headCommit: commit,
      headTree: commit,
      repositoryContractDigest: sha("e"),
    },
    activeOperation: {
      activityId: "activity-1",
      operation: "delivery.continue" as const,
      stage: "provider-running" as const,
    },
  };
  const opaqueToken = sha("7");
  assert.equal(
    FoundationDeliveryGenerationSchema.parse({ ...subject, digest: opaqueToken }).digest,
    opaqueToken,
  );
  assert.notEqual(opaqueToken, selfDigestFoundationCarrier(subject));
  assert.equal(FoundationDeliveryGenerationSchema.safeParse({
    ...subject,
    supportCoordinateDigest: sha("8"),
    digest: opaqueToken,
  }).success, false);
  assert.equal(FoundationDeliveryGenerationSchema.safeParse({
    ...subject,
    operationSupport: { generation: 2, payloadDigest: sha("9") },
    digest: opaqueToken,
  }).success, false);
  assert.equal(FoundationDeliveryGenerationSchema.safeParse({
    ...subject,
    digest: "not-a-token",
  }).success, false);
});

test("Delivery View refuses substituted duplicate coordinates", () => {
  const delivery = state();
  const view = deliveryView(delivery);
  const fabricatedActivity = {
    activityId: "activity-substituted",
    operation: "delivery.continue" as const,
    stage: "recovery" as const,
  };

  const substitutions = [
    { ...view, generation: { ...view.generation, storeId: "store-substituted" } },
    { ...view, generation: { ...view.generation, processId: "delivery-substituted" } },
    {
      ...view,
      generation: {
        ...view.generation,
        journal: { eventCount: 2, headSequence: 2, headDigest: sha("8") },
      },
    },
    {
      ...view,
      generation: {
        ...view.generation,
        storeDisposition: { ...view.generation.storeDisposition, stage: "sealed" as const },
      },
    },
    {
      ...view,
      currentSubjects: { ...view.currentSubjects, candidate: null },
    },
    {
      ...view,
      activity: fabricatedActivity,
    },
    {
      ...view,
      generation: { ...view.generation, activeOperation: fabricatedActivity },
      activity: fabricatedActivity,
    },
    {
      ...view,
      nextPass: [{ ...view.nextPass[0]!, eligible: false }],
    },
    {
      ...view,
      nextPass: [view.nextPass[0]!, view.nextPass[0]!],
    },
    {
      ...view,
      nextPass: [{ ...view.nextPass[0]!, boundary: null }],
    },
    {
      ...view,
      nextPass: [{ ...view.nextPass[0]!, candidate: null }],
    },
    {
      ...view,
      nextPass: [{ ...view.nextPass[0]!, role: "reviewer" as const }],
    },
    {
      ...view,
      decisionReadiness: { ...view.decisionReadiness, boundary: null },
    },
    {
      ...view,
      decisionReadiness: { ...view.decisionReadiness, candidate: null },
    },
    {
      ...view,
      decisionReadiness: { ...view.decisionReadiness, terminalChoices: ["delivery.accept" as const] },
    },
  ];
  for (const substituted of substitutions) {
    assert.equal(FoundationDeliveryViewSchema.safeParse(substituted).success, false);
  }
});

test("Delivery View binds one real unresolved activity and its recovery presentation", () => {
  const delivery = FoundationDeliveryStateSchema.parse({
    ...state(),
    candidateCondition: "in-progress",
    activities: [{
      id: "activity-current",
      operation: "delivery.continue",
      family: "agent",
      stage: "prepared",
    }],
    recovery: {
      scope: "activity",
      activityId: "activity-current",
      kind: "finalization",
      resumesAt: "provider-effect-intended",
      exactEffectDigest: null,
    },
    eligibleOperations: ["delivery.recover"],
  });
  const base = deliveryView(state());
  const activity = {
    activityId: "activity-current",
    operation: "delivery.continue" as const,
    stage: "recovery" as const,
  };
  const parsed = FoundationDeliveryViewSchema.parse({
    ...base,
    state: delivery,
    currentSubjects: delivery.subjects,
    generation: {
      ...base.generation,
      journal: delivery.journal,
      storeDisposition: delivery.storeDisposition,
      activeOperation: activity,
    },
    activity,
    nextPass: [{ ...base.nextPass[0]!, eligible: false }],
    decisionReadiness: { ...base.decisionReadiness, terminalChoices: [] },
  });
  assert.deepEqual(parsed.activity, activity);
});

test("Attempt View exposes stable execution facts without a second workflow", () => {
  const attempt = { kind: "agent-attempt", id: "attempt-1", revision: 1, digest: sha("1") } as const;
  const receipt = { kind: "execution-receipt", id: "receipt-1", revision: 1, digest: sha("2") } as const;
  const brief = { kind: "founder-brief", id: "brief-1", revision: 1, digest: sha("3") } as const;
  const boundary = { kind: "work-boundary", id: "boundary-1", revision: 1, digest: sha("4") } as const;
  const executionSelection = {
    backendProfile: {
      profileId: "lifecycle.execution-backend-profile.docker-local.v1",
      profileDigest: sha("5"),
      implementationDigest: sha("6"),
    },
    image: { imageId: "image-1", imageDigest: sha("7") },
    inputSet: { profileId: "lifecycle.execution-input-set.v1", digest: sha("9") },
    network: { agentProductNetwork: "none", separationRequired: true },
    services: { providerControlPlane: "fixed-service-channel" },
    effectiveLimits: {
      wallTimeMilliseconds: 30_000,
      processes: 4,
      storageBytes: 1_048_576,
      outputEntries: 128,
      outputBytes: 65_536,
      outputEntryBytes: 65_536,
      events: 50,
    },
  } as const;
  const execution = {
    ...executionSelection,
    specificationDigest: sha("8"),
    runnerDigest: sha("a"),
    observationDigest: sha("b"),
    outputManifest: { availability: "retrieved", digest: sha("c") },
  } as const;
  const checkExecution = {
    backendProfile: executionSelection.backendProfile,
    image: executionSelection.image,
    specificationDigest: sha("8"),
    inputSet: executionSelection.inputSet,
    runnerDigest: sha("a"),
    observationDigest: sha("b"),
    outputManifest: { availability: "retrieved", digest: sha("c") },
  } as const;
  const containment = { classification: "contained", factsDigest: sha("d") } as const;
  const retirement = { classification: "retired", factsDigest: sha("e") } as const;
  const checkReceipt = {
    reference: { kind: "check-receipt", id: "check-receipt-1", revision: 1, digest: sha("f") },
    provenance: "runtime-observed",
    binding: { id: "binding-1", digest: sha("0") },
    proofSubject: boundary,
    proofRequestDigest: sha("1"),
    environment: { identityDigest: sha("2") },
    disposition: "pass",
    resultFacts: [],
    reasonCode: null,
    execution: checkExecution,
    subjectIntegrity: "unchanged",
    containment,
    retirement,
    limitations: [],
  } as const;
  const view = {
    schema: "lifecycle.attempt-view.v1",
    complete: true,
    coordinate: {
      storeId: "store.delivery-1",
      processId: "delivery-1",
      journal: { headSequence: 1, headDigest: sha("3") },
      attempt,
      reducer: { id: "lifecycle.delivery-reducer.foundation-v2", digest: sha("4") },
      profile: { id: "lifecycle.attempt-view.foundation-v1", digest: sha("5") },
      currentBoundary: boundary,
      currentCandidate: null,
      activeActivity: null,
    },
    attemptContract: {
      provenance: "runtime-derived",
      activityId: "activity-1",
      operation: "delivery.prepare",
      role: "reconnaissance",
      invocationId: "invocation-1",
      preDispatchStateDigest: sha("6"),
      brief,
      boundary: null,
      candidate: null,
      seal: null,
      projection: { digest: sha("7") },
      capability: { profileId: "capability-1" },
      investment: { id: "investment-1" },
      provider: { adapter: "lifecycle.provider-adapter.v6" },
      authoring: { profileId: "authoring-1" },
      input: { contentInventoryDigest: sha("8") },
      execution: executionSelection,
    },
    providerExecution: {
      provenance: "runtime-observed",
      receipt,
      effect: { intended: true, observed: true, digest: sha("8"), outcome: "completed" },
      productiveExecutionStarted: true,
      provider: { terminalReason: "valid-submission" },
      execution,
      containment,
      retirement,
    },
    agentSemantics: {
      workProduct: null,
      provenance: "agent-proposed",
      disposition: null,
      summary: null,
      uncertainty: null,
      claims: [],
      citations: [],
      limitations: [],
      noProductReason: "No semantic product was submitted.",
      roleSemantics: null,
      body: null,
      submissionDiagnostics: {
        parserDisposition: "not-run",
        compilerDisposition: "not-run",
        failureFactsDigest: null,
        diagnostic: null,
      },
    },
    candidateTransition: {
      role: "reconnaissance",
      observationProvenance: "runtime-observed",
      currentProvenance: "runtime-derived",
      input: null,
      successorDisposition: null,
      successor: null,
      current: null,
      candidateBaseCommit: null,
      contentDisposition: null,
      changedSubjects: [],
      invalidatedSeal: null,
      invalidatedEvidence: null,
      failureFactsDigest: null,
      limitations: [],
    },
    processAndProof: {
      provenance: "runtime-derived",
      standing: "awaiting-admission",
      candidateCondition: "absent",
      proposedBoundary: boundary,
      activeBoundary: null,
      materialCondition: null,
      seal: null,
      evidence: null,
      checks: [{
        selectionId: "check-1",
        definitionId: "definition-1",
        definition: { digest: sha("a") },
        bindingIds: ["binding-1"],
        modality: "precondition",
        obligationIds: [],
        baselineRequired: true,
        finalRequired: false,
        baseline: checkReceipt,
        final: null,
        freshExecutionRequired: false,
      }],
      obligations: [],
      blockers: [],
      eligibleOperations: ["delivery.admit", "delivery.no-ship"],
    },
    diagnostics: [],
  } as const;

  const parsed = FoundationAttemptViewSchema.parse(view);
  assert.equal(parsed.attemptContract.execution.network.agentProductNetwork, "none");
  assert.equal(parsed.attemptContract.execution.services.providerControlPlane, "fixed-service-channel");
  assert.equal(parsed.attemptContract.execution.effectiveLimits.wallTimeMilliseconds, 30_000);
  assert.equal(parsed.providerExecution.execution?.outputManifest.digest, sha("c"));
  assert.equal(parsed.processAndProof.checks[0]?.baseline?.retirement.classification, "retired");
  const incompleteBuilder = {
    ...view,
    complete: false,
    attemptContract: {
      ...view.attemptContract,
      operation: "delivery.continue",
      role: "builder",
    },
    candidateTransition: {
      ...view.candidateTransition,
      role: "builder",
      successorDisposition: null,
    },
    diagnostics: [{
      code: "lifecycle.attempt-view.incomplete",
      stage: "candidate-observation",
      factsDigest: sha("d"),
    }],
  } as const;
  assert.equal(FoundationAttemptViewSchema.safeParse(incompleteBuilder).success, true);
  assert.equal(FoundationAttemptViewSchema.safeParse({
    ...incompleteBuilder,
    complete: true,
    diagnostics: [],
  }).success, false);
  assert.equal(FoundationAttemptViewSchema.safeParse({
    ...view,
    providerExecution: {
      ...view.providerExecution,
      execution: {
        ...view.providerExecution.execution,
        effectiveLimits: {
          ...view.providerExecution.execution.effectiveLimits,
          processes: 5,
        },
      },
    },
  }).success, false);
  for (const privateField of ["handle", "endpoint", "credential", "reclamationCoordinate"] as const) {
    assert.equal(FoundationAttemptViewSchema.safeParse({
      ...view,
      attemptContract: {
        ...view.attemptContract,
        execution: { ...view.attemptContract.execution, [privateField]: "private" },
      },
    }).success, false);
  }
  const pendingExecution = {
    ...view,
    providerExecution: {
      provenance: "runtime-observed" as const,
      receipt: null,
      effect: { intended: true, observed: false, digest: sha("8"), outcome: null },
      productiveExecutionStarted: null,
      provider: null,
      execution: null,
      containment: null,
      retirement: null,
    },
  };
  assert.equal(FoundationAttemptViewSchema.safeParse(pendingExecution).success, true);
  for (const effect of [
    { intended: false, observed: true, digest: sha("8"), outcome: "completed" },
    { intended: true, observed: false, digest: sha("8"), outcome: "completed" },
    { intended: false, observed: false, digest: null, outcome: "failed" },
    { intended: false, observed: false, digest: sha("8"), outcome: null },
  ] as const) {
    assert.equal(FoundationAttemptViewSchema.safeParse({
      ...pendingExecution,
      providerExecution: { ...pendingExecution.providerExecution, effect },
    }).success, false);
  }
  assert.equal(FoundationAttemptViewSchema.safeParse({
    ...pendingExecution,
    providerExecution: {
      ...pendingExecution.providerExecution,
      execution: view.providerExecution.execution,
    },
  }).success, false);
  assert.equal(FoundationAttemptViewSchema.safeParse({
    ...incompleteBuilder,
    complete: true,
    candidateTransition: {
      ...incompleteBuilder.candidateTransition,
      successorDisposition: "not-produced",
    },
    diagnostics: [],
  }).success, true);
  const withBaseline = (baseline: unknown) => ({
    ...view,
    processAndProof: {
      ...view.processAndProof,
      checks: [{ ...view.processAndProof.checks[0], baseline }],
    },
  });
  const unsupportedBeforeAllocation = {
    ...checkReceipt,
    disposition: "unsupported",
    reasonCode: "execution.unsupported",
    execution: null,
    subjectIntegrity: "unverified",
    containment: { classification: "not-required", factsDigest: null },
    retirement: { classification: "not-required", factsDigest: null },
  } as const;
  const unsupportedAfterAllocation = {
    ...checkReceipt,
    disposition: "unsupported",
    reasonCode: "execution.unsupported",
  } as const;
  assert.equal(FoundationAttemptViewSchema.safeParse(
    withBaseline(unsupportedBeforeAllocation),
  ).success, true);
  assert.equal(FoundationAttemptViewSchema.safeParse(
    withBaseline(unsupportedAfterAllocation),
  ).success, true);
  assert.equal(FoundationAttemptViewSchema.safeParse(withBaseline({
    ...unsupportedAfterAllocation,
    containment: { classification: "not-required", factsDigest: null },
    retirement: { classification: "not-required", factsDigest: null },
  })).success, false);
  assert.equal(FoundationAttemptViewSchema.safeParse({
    ...view,
    providerExecution: {
      ...view.providerExecution,
      execution: { ...view.providerExecution.execution, cellId: "private-cell" },
    },
  }).success, false);
  assert.equal(FoundationAttemptViewSchema.safeParse({
    ...view,
    providerExecution: {
      ...view.providerExecution,
      execution: {
        ...view.providerExecution.execution,
        outputManifest: { availability: "retrieved", digest: null },
      },
    },
  }).success, false);
  for (const retiredField of ["materialization", "workspace", "cleanup"] as const) {
    assert.equal(FoundationAttemptViewSchema.safeParse({
      ...view,
      providerExecution: {
        ...view.providerExecution,
        [retiredField]: { complete: true },
      },
    }).success, false);
  }
});

test("submission diagnostics expose only exact code, stage, and facts digest", () => {
  const diagnostic = FoundationSubmissionDiagnosticSchema.parse({
    code: "lifecycle.agent-work-product.invalid.title",
    stage: "template",
    factsDigest: sha("7"),
  });
  assert.deepEqual(diagnostic, {
    code: "lifecycle.agent-work-product.invalid.title",
    stage: "template",
    factsDigest: sha("7"),
  });
  assert.equal(FoundationSubmissionDiagnosticSchema.safeParse({
    ...diagnostic,
    stage: "provider",
  }).success, false);
  assert.equal(FoundationSubmissionDiagnosticSchema.safeParse({
    ...diagnostic,
    message: "private parser text",
  }).success, false);
});

test("Delivery state keeps orthogonal standing, Candidate, recovery, and archive facts", () => {
  const parsed = state();
  assert.equal(parsed.standing, "active");
  assert.equal(parsed.candidateCondition, "ready-for-work");
  assert.deepEqual(parsed.eligibleOperations, ["delivery.continue", "delivery.evaluate", "delivery.no-ship"]);
  assert.throws(() => FoundationDeliveryStateSchema.parse({
    ...parsed,
    eligibleOperations: ["delivery.continue", "delivery.continue"],
  }));
  assert.equal(FoundationDeliveryStateSchema.safeParse({
    ...parsed,
    standing: "closed",
    candidateCondition: "abandoned",
    eligibleOperations: [],
  }).success, true);
  assert.equal(FoundationDeliveryStateSchema.safeParse({
    ...parsed,
    standing: "closed",
    candidateCondition: "disposed",
    eligibleOperations: [],
  }).success, false);
  assert.equal(FoundationDeliveryStateSchema.safeParse({
    ...parsed,
    recovery: {
      scope: "activity",
      activityId: "activity-one",
      kind: "finalization",
      resumesAt: "candidate-sealed",
      exactEffectDigest: null,
    },
  }).success, true);
  assert.equal(FoundationDeliveryStateSchema.safeParse({
    ...parsed,
    recovery: {
      scope: "activity",
      activityId: "activity-one",
      kind: "provider",
      resumesAt: "provider-effect-observed",
      exactEffectDigest: sha("9"),
    },
  }).success, true);
  assert.equal(FoundationDeliveryStateSchema.safeParse({
    ...parsed,
    recovery: {
      scope: "activity",
      activityId: "activity-one",
      kind: "candidate-observation",
      resumesAt: "work-product-observation",
      exactEffectDigest: null,
    },
  }).success, false);
  assert.equal(FoundationDeliveryStateSchema.safeParse({
    ...parsed,
    recovery: {
      scope: "store-disposition",
      activityId: "activity-one",
      kind: "finalization",
      resumesAt: "store-seal",
      exactEffectDigest: null,
    },
  }).success, false);

  const appliedAdmission = FoundationDeliveryStateSchema.parse({
    ...parsed,
    candidateCondition: "absent",
    activities: [{
      id: "admit-awaiting-candidate",
      operation: "delivery.admit",
      family: "transaction",
      stage: "effect-observed",
    }],
    recovery: {
      scope: "activity",
      activityId: "admit-awaiting-candidate",
      kind: "candidate-observation",
      resumesAt: "candidate-revision-observed",
      exactEffectDigest: null,
    },
    subjects: { ...parsed.subjects, candidate: null },
    eligibleOperations: ["delivery.recover"],
  });
  assert.equal(appliedAdmission.standing, "active");
  assert.equal(appliedAdmission.subjects.candidate, null);

  const inProgress = FoundationDeliveryStateSchema.parse({
    ...parsed,
    candidateCondition: "in-progress",
    activities: [{
      id: "continue-prepared",
      operation: "delivery.continue",
      family: "agent",
      stage: "prepared",
    }],
    recovery: {
      scope: "activity",
      activityId: "continue-prepared",
      kind: "finalization",
      resumesAt: "provider-effect-intended",
      exactEffectDigest: null,
    },
    eligibleOperations: ["delivery.recover"],
  });
  assert.equal(inProgress.candidateCondition, "in-progress");
  assert.equal(inProgress.recovery?.resumesAt, "provider-effect-intended");

  for (const terminalCandidate of ["accepted", "abandoned", "absent"] as const) {
    const terminal = FoundationDeliveryStateSchema.parse({
      ...parsed,
      standing: "closed",
      candidateCondition: terminalCandidate,
      recovery: {
        scope: "store-disposition",
        activityId: null,
        kind: "finalization",
        resumesAt: "store-seal",
        exactEffectDigest: null,
      },
      subjects: {
        ...parsed.subjects,
        candidate: terminalCandidate === "absent" ? null : parsed.subjects.candidate,
        closure: { kind: "closure", id: "closure-1", revision: 1, digest: sha("8") },
      },
      storeDisposition: {
        stage: "closure-recorded",
        integrity: "verified",
        sealSubjectDigest: null,
        archiveManifestDigest: null,
      },
      eligibleOperations: ["delivery.recover"],
    });
    assert.equal(terminal.standing, "closed");
    assert.equal(terminal.candidateCondition, terminalCandidate);
  }
});

test("inspect and export are bounded read-only projections", () => {
  const inspect = createFoundationRuntimeOperationRequest({
    target: "/target",
    deliveryId: "delivery-1",
    operation: "delivery.inspect",
    input: { kind: "events", afterSequence: 0, limit: 50 },
  });
  assert.equal(inspect.operation, "delivery.inspect");
  assert.throws(() => parseFoundationRuntimeOperationRequest({
    schema: FOUNDATION_RUNTIME_FACADE_SCHEMA,
    target: "/target",
    deliveryId: "delivery-1",
    operation: "delivery.inspect",
    input: { kind: "events", afterSequence: 0, limit: 501 },
  }), FoundationProtocolError);
  const latestAttempt = createFoundationRuntimeOperationRequest({
    target: "/target",
    deliveryId: "delivery-1",
    operation: "delivery.inspect",
    input: { kind: "attempt-view", selection: { kind: "latest-attempt" } },
  });
  assert.deepEqual(latestAttempt.input, {
    kind: "attempt-view",
    selection: { kind: "latest-attempt" },
  });
  const emptyAttemptView = FoundationInspectionResultSchema.parse({
    kind: "attempt-view",
    view: null,
  });
  assert.equal(emptyAttemptView.kind, "attempt-view");
  assert.equal(emptyAttemptView.kind === "attempt-view" ? emptyAttemptView.view : undefined, null);
  assert.throws(() => parseFoundationRuntimeOperationRequest({
    ...latestAttempt,
    input: {
      kind: "attempt-view",
      selection: { kind: "attempt", attemptId: "attempt-1", latest: true },
    },
  }), FoundationProtocolError);

  const content = "# Delivery delivery-1\n";
  const bytes = new TextEncoder().encode(content);
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  assert.equal(FoundationExportResultSchema.parse({
    format: "markdown",
    mediaType: "text/markdown",
    byteLength: bytes.byteLength,
    digest,
    content,
  }).content, content);
});

test("results center observations, exact Control changes, and diagnostics", () => {
  const request = createFoundationRuntimeOperationRequest({
    target: "/target", deliveryId: "delivery-1", operation: "delivery.status", input: null,
  });
  const result = createFoundationRuntimeOperationResult({
    request,
    observedAt,
    status: "completed",
    targetId: "target-1",
    deliveryId: "delivery-1",
    observation: observation(),
    changes: unchanged,
  });
  assert.equal(parseFoundationRuntimeOperationResultForRequest(result, request).deliveryId, "delivery-1");
  assert.equal(JSON.parse(serializeFoundationRuntimeOperationResult(result)).interfaceProtocol, FOUNDATION_INTERFACE_PROTOCOL);
  assert.throws(() => parseFoundationRuntimeOperationResultForRequest(result, {
    ...request,
    deliveryId: "delivery-2",
  }), FoundationProtocolError);
});

test("result envelopes refuse recomputed-digest coordinate substitution", () => {
  const request = createFoundationRuntimeOperationRequest({
    target: "/target", deliveryId: "delivery-1", operation: "delivery.status", input: null,
  });
  const result = createFoundationRuntimeOperationResult({
    request,
    observedAt,
    status: "completed",
    targetId: "target-1",
    deliveryId: "delivery-1",
    observation: observation(),
    changes: unchanged,
  });
  const substitutions = [
    {
      value: resealRuntimeResult({ ...result, observedAt: "2026-08-29T12:00:01.000Z" }),
      path: ["observation", "observedAt"],
    },
    {
      value: resealRuntimeResult({ ...result, targetId: "target-substituted" }),
      path: ["observation", "repository", "targetId"],
    },
    {
      value: resealRuntimeResult({ ...result, deliveryId: "delivery-substituted" }),
      path: ["observation", "delivery", "processId"],
    },
  ];
  for (const substituted of substitutions) {
    assertInvalidRuntimeResultAt(substituted.value, substituted.path);
  }
});

test("completed Delivery View refuses a self-consistent view from another coordinate", () => {
  const selected = state();
  const request = createFoundationRuntimeOperationRequest({
    target: "/target",
    deliveryId: selected.processId,
    operation: "delivery.inspect",
    input: { kind: "delivery-view" },
  });
  const result = createFoundationRuntimeOperationResult({
    request,
    observedAt,
    status: "completed",
    targetId: "target-1",
    deliveryId: selected.processId,
    observation: observation(selected),
    changes: unchanged,
    value: { kind: "delivery-view", view: deliveryView(selected) },
  });

  const anotherDelivery = FoundationDeliveryStateSchema.parse({
    ...selected,
    storeId: "store.delivery-substituted",
    processId: "delivery-substituted",
  });
  const substitutedDelivery = resealRuntimeResult({
    ...result,
    value: { kind: "delivery-view" as const, view: deliveryView(anotherDelivery) },
  });
  assertInvalidRuntimeResultAt(substitutedDelivery, ["value", "view", "state"]);

  const selectedView = deliveryView(selected);
  const substitutedRepository = FoundationDeliveryViewSchema.parse({
    ...selectedView,
    generation: {
      ...selectedView.generation,
      repository: {
        ...selectedView.generation.repository,
        headCommit: "b".repeat(40),
      },
    },
  });
  const mixedRepository = resealRuntimeResult({
    ...result,
    value: { kind: "delivery-view" as const, view: substitutedRepository },
  });
  assertInvalidRuntimeResultAt(
    mixedRepository,
    ["value", "view", "generation", "repository"],
  );
});

test("completed read results answer the exact requested selector", () => {
  const makeResult = (
    request: ReturnType<typeof createFoundationRuntimeOperationRequest>,
    value: Parameters<typeof createFoundationRuntimeOperationResult>[0]["value"],
  ) => createFoundationRuntimeOperationResult({
    request,
    observedAt,
    status: "completed",
    targetId: "target-1",
    deliveryId: "deliveryId" in request ? request.deliveryId : null,
    observation: observation("deliveryId" in request && request.deliveryId !== null ? state() : null),
    changes: unchanged,
    value,
  });
  const record = (recordId: string) => {
    const source = {
      schema: "lifecycle.control-record-revision.v1" as const,
      processId: "delivery-1",
      recordId,
      recordKind: "founder-brief" as const,
      revision: 1,
      producer: { kind: "runtime" as const, id: "runtime-1" },
      semanticAuthor: { kind: "founder" as const, id: "founder-1" },
      semanticAuthority: "founder-supplied" as const,
      createdAt: observedAt,
      semanticMarkdown: "# Frame\n\nBuild it.\n",
      payload: { operation: "delivery.prepare" },
      relationships: [],
    };
    return FoundationControlRevisionSchema.parse({
      ...source,
      digest: selfDigestFoundationCarrier(source),
    });
  };
  const generation = deliveryView().generation;
  const mismatches: Array<Readonly<{
    request: ReturnType<typeof createFoundationRuntimeOperationRequest>;
    result: ReturnType<typeof createFoundationRuntimeOperationResult>;
  }>> = [];

  const summaryRequest = createFoundationRuntimeOperationRequest({
    target: "/target", deliveryId: "delivery-1", operation: "delivery.inspect",
    input: { kind: "summary" },
  });
  mismatches.push({ request: summaryRequest, result: makeResult(summaryRequest, { kind: "events", events: [], nextAfterSequence: null }) });

  const dossierRequest = createFoundationRuntimeOperationRequest({
    target: "/target", deliveryId: "delivery-1", operation: "delivery.inspect",
    input: { kind: "dossier", dossier: "frame", afterRecordId: null, limit: 10 },
  });
  mismatches.push({ request: dossierRequest, result: makeResult(dossierRequest, { kind: "dossier", dossier: "attempt", records: [], nextAfterRecordId: null }) });

  const expectedRecord = record("brief-expected");
  const recordRequest = createFoundationRuntimeOperationRequest({
    target: "/target", deliveryId: "delivery-1", operation: "delivery.inspect",
    input: {
      kind: "record",
      reference: {
        kind: expectedRecord.recordKind,
        id: expectedRecord.recordId,
        revision: expectedRecord.revision,
        digest: expectedRecord.digest,
      },
    },
  });
  mismatches.push({ request: recordRequest, result: makeResult(recordRequest, { kind: "record", record: record("brief-other") }) });

  const attemptRequest = createFoundationRuntimeOperationRequest({
    target: "/target", deliveryId: "delivery-1", operation: "delivery.inspect",
    input: { kind: "attempt-view", selection: { kind: "attempt", attemptId: "attempt-expected" } },
  });
  mismatches.push({ request: attemptRequest, result: makeResult(attemptRequest, { kind: "attempt-view", view: null }) });

  const familyRequest = createFoundationRuntimeOperationRequest({
    target: "/target", deliveryId: "delivery-1", operation: "delivery.inspect",
    input: { kind: "family", recordKind: "founder-brief", afterRecordId: null, limit: 10 },
  });
  mismatches.push({ request: familyRequest, result: makeResult(familyRequest, { kind: "family", generation, recordKind: "agent-attempt", records: [], nextAfterRecordId: null }) });

  const revisionsRequest = createFoundationRuntimeOperationRequest({
    target: "/target", deliveryId: "delivery-1", operation: "delivery.inspect",
    input: { kind: "revisions", recordId: "brief-expected", afterRevision: 0, limit: 10 },
  });
  mismatches.push({ request: revisionsRequest, result: makeResult(revisionsRequest, { kind: "revisions", generation, recordId: "brief-other", records: [], nextAfterRevision: null }) });

  const diffRequest = createFoundationRuntimeOperationRequest({
    target: "/target", deliveryId: "delivery-1", operation: "delivery.diff",
    input: { subject: "candidate", maximumBytes: 65_536 },
  });
  mismatches.push({
    request: diffRequest,
    result: makeResult(diffRequest, {
      kind: "diff",
      view: {
        schema: "lifecycle.delivery-diff.v1",
        generation,
        subject: "decision",
        currentness: "unavailable",
        candidate: state().subjects.candidate,
        seal: null,
        baseCommit: null,
        tree: null,
        exactDiffDigest: null,
        contentDigest: null,
        byteLength: 0,
        truncated: false,
        content: null,
        unavailableReason: "Difference unavailable.",
      },
    }),
  });

  const watchRequest = createFoundationRuntimeOperationRequest({
    target: "/target", deliveryId: "delivery-1", operation: "delivery.watch",
    input: { scope: "delivery", afterGeneration: null, timeoutMs: 0 },
  });
  const inbox = {
    schema: "lifecycle.delivery-inbox.v1" as const,
    targetId: "target-1",
    rows: [],
    nextAfterDeliveryId: null,
    generation: sha("9"),
  };
  mismatches.push({
    request: watchRequest,
    result: makeResult(watchRequest, {
      kind: "watch",
      scope: "inbox",
      changed: true,
      generation: inbox.generation,
      inbox,
      delivery: null,
    }),
  });

  for (const mismatch of mismatches) {
    assert.throws(
      () => parseFoundationRuntimeOperationResultForRequest(mismatch.result, mismatch.request),
      (error) => error instanceof FoundationProtocolError &&
        error.code === "lifecycle.interface.request-result-selection",
    );
  }
});

test("completed read models cannot mix Delivery or repository generations", () => {
  const selected = state();
  const anotherDelivery = FoundationDeliveryStateSchema.parse({
    ...selected,
    storeId: "store.delivery-other",
    processId: "delivery-other",
  });
  const makeResult = (
    request: ReturnType<typeof createFoundationRuntimeOperationRequest>,
    value: Parameters<typeof createFoundationRuntimeOperationResult>[0]["value"],
  ) => createFoundationRuntimeOperationResult({
    request,
    observedAt,
    status: "completed",
    targetId: "target-1",
    deliveryId: "deliveryId" in request ? request.deliveryId : null,
    observation: observation(selected),
    changes: unchanged,
    value,
  });

  const summaryRequest = createFoundationRuntimeOperationRequest({
    target: "/target", deliveryId: selected.processId, operation: "delivery.inspect",
    input: { kind: "summary" },
  });
  const summary = makeResult(summaryRequest, { kind: "summary", state: selected });
  assertInvalidRuntimeResultAt(resealRuntimeResult({
    ...summary,
    value: { kind: "summary" as const, state: anotherDelivery },
  }), ["value", "state"]);

  const familiesRequest = createFoundationRuntimeOperationRequest({
    target: "/target", deliveryId: selected.processId, operation: "delivery.inspect",
    input: { kind: "families" },
  });
  const generation = deliveryView(selected).generation;
  const families = makeResult(familiesRequest, { kind: "families", generation, families: [] });
  assertInvalidRuntimeResultAt(resealRuntimeResult({
    ...families,
    value: {
      kind: "families" as const,
      generation: {
        ...generation,
        repository: { ...generation.repository, headTree: "b".repeat(40) },
      },
      families: [],
    },
  }), ["value", "generation", "repository"]);

  const diffRequest = createFoundationRuntimeOperationRequest({
    target: "/target", deliveryId: selected.processId, operation: "delivery.diff",
    input: { subject: "candidate", maximumBytes: 65_536 },
  });
  const diffValue = {
    kind: "diff" as const,
    view: {
      schema: "lifecycle.delivery-diff.v1" as const,
      generation,
      subject: "candidate" as const,
      currentness: "unavailable" as const,
      candidate: selected.subjects.candidate,
      seal: selected.subjects.seal,
      baseCommit: null,
      tree: null,
      exactDiffDigest: null,
      contentDigest: null,
      byteLength: 0,
      truncated: false,
      content: null,
      unavailableReason: "Difference unavailable.",
    },
  };
  const diff = makeResult(diffRequest, diffValue);
  assertInvalidRuntimeResultAt(resealRuntimeResult({
    ...diff,
    value: {
      ...diffValue,
      view: { ...diffValue.view, candidate: { ...selected.subjects.candidate!, id: "candidate-other" } },
    },
  }), ["value", "view", "candidate"]);

  const watchRequest = createFoundationRuntimeOperationRequest({
    target: "/target", deliveryId: selected.processId, operation: "delivery.watch",
    input: { scope: "delivery", afterGeneration: null, timeoutMs: 0 },
  });
  const selectedView = deliveryView(selected);
  const watch = makeResult(watchRequest, {
    kind: "watch",
    scope: "delivery",
    changed: true,
    generation: selectedView.generation.digest,
    inbox: null,
    delivery: selectedView,
  });
  assertInvalidRuntimeResultAt(resealRuntimeResult({
    ...watch,
    value: {
      kind: "watch" as const,
      scope: "delivery" as const,
      changed: true,
      generation: sha("8"),
      inbox: null,
      delivery: selectedView,
    },
  }), ["value", "generation"]);
  assertInvalidRuntimeResultAt(resealRuntimeResult({
    ...watch,
    value: {
      kind: "watch" as const,
      scope: "delivery" as const,
      changed: true,
      generation: deliveryView(anotherDelivery).generation.digest,
      inbox: null,
      delivery: deliveryView(anotherDelivery),
    },
  }), ["value", "delivery", "state"]);
});

test("completed preparation returns its newly created Delivery identity", () => {
  const request = createFoundationRuntimeOperationRequest({
    target: "/target",
    operation: "delivery.prepare",
    input: { semanticMarkdown: "# Frame\n\nBuild it.\n" },
  });
  const result = createFoundationRuntimeOperationResult({
    request,
    observedAt,
    status: "completed",
    targetId: "target-1",
    deliveryId: "delivery-1",
    observation: observation(),
    changes: unchanged,
  });
  assert.equal(parseFoundationRuntimeOperationResultForRequest(result, request).deliveryId, "delivery-1");
  const withoutDelivery = { ...result, deliveryId: null };
  const { digest: _oldDigest, ...subject } = withoutDelivery;
  assert.throws(() => parseFoundationRuntimeOperationResultForRequest(
    { ...subject, digest: selfDigestFoundationCarrier(subject) },
    request,
  ), FoundationProtocolError);
});

test("the v10 source has no predecessor protocol coordinates or retired public carriers", async () => {
  const moduleRoot = new URL("../../src/foundation/", import.meta.url);
  const moduleNames = (await readdir(moduleRoot))
    .filter((name) => name.endsWith(".ts"))
    .sort();
  const source = [
    await readFile(new URL("../../src/foundation.ts", import.meta.url), "utf8"),
    ...await Promise.all(moduleNames.map(async (name) =>
      await readFile(new URL(name, moduleRoot), "utf8"))),
  ].join("\n");
  const forbidden = [
    ["foundation", "v5"].join("."),
    ["foundation", "v8"].join("."),
    ["foundation", "v9"].join("."),
    ["repository", "v13"].join("."),
    ["repository", "v14"].join("."),
    ["provider-adapter", "v4"].join("."),
    ["provider-adapter", "v5"].join("."),
    ["delivery-reducer", "foundation-v1"].join("."),
    ["dis", "posed"].join(""),
    ["select", "no", "ship"].join("-"),
    ["authorize", "no", "ship"].join("-"),
    ["Role", "Result"].join(" "),
    ["Attempt", "Assessment"].join(" "),
    ["Control", "Index"].join(" "),
    ["protected", "process", "ref"].join("-"),
    ["acceptance", "support"].join("-"),
  ];
  for (const value of forbidden) assert.equal(source.includes(value), false, value);
});
