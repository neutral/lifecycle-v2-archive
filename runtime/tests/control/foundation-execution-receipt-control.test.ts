import assert from "node:assert/strict";
import test from "node:test";
import {
  executionReceiptSubmissionDiagnostic,
  executionReceiptSubmissionDiagnosticForActivity,
  retainExecutionReceipt,
  type ExecutionReceiptExecutionFacts,
  type ExecutionReceiptProviderObservation,
  type ExecutionReceiptWorkspaceObservation,
} from "../../src/foundation/control/execution-receipt.js";
import {
  compileControlRecordEvent,
  compileControlRecordRevision,
} from "../../src/foundation/control/model.js";
import {
  compileControlRecordFile,
  type ControlRecordStore,
} from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlJsonObject,
  type ControlRecordEvent,
  type ControlRecordEventInput,
  type ControlRecordRevision,
  type ControlRecordRevisionInput,
  type ControlRecordStoreAppend,
  type ControlRecordStoreAppendWithFiles,
  type ControlRecordStoreIdentity,
} from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import {
  digestCanonical,
  sha256Bytes,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";

const CREATED = "2026-09-01T10:00:00.000Z";
const STARTED = "2026-09-01T10:00:01.000Z";
const FINISHED = "2026-09-01T10:00:02.000Z";
const RECORDED = "2026-09-01T10:00:03.000Z";
const RUNTIME = "foundation-runtime";

function digest(label: string): Sha256 {
  return sha256Bytes(label);
}

function reference(revision: ControlRecordRevision) {
  return Object.freeze({
    kind: revision.recordKind,
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function subject(revision: ControlRecordRevision) {
  return Object.freeze({
    recordId: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function revisionInput(input: Readonly<{
  id: string;
  kind: string;
  revision?: number;
  payload: ControlJsonObject;
  relationships?: ControlRecordRevisionInput["relationships"];
  semanticMarkdown?: string;
}>): ControlRecordRevisionInput {
  return Object.freeze({
    recordId: input.id,
    recordKind: input.kind,
    revision: input.revision ?? 1,
    producer: { kind: "runtime" as const, id: RUNTIME },
    semanticAuthor: input.kind === "agent-work-product"
      ? { kind: "agent" as const, id: "agent-one" }
      : { kind: "runtime" as const, id: RUNTIME },
    semanticAuthority: input.kind === "agent-work-product"
      ? "agent-proposed"
      : input.kind === "agent-attempt" ? "runtime-derived" : "runtime-observed",
    createdAt: CREATED,
    semanticMarkdown: input.semanticMarkdown ?? `# ${input.kind}\n`,
    payload: input.payload,
    relationships: input.relationships,
  });
}

function fakeStore(processId: string) {
  const identity: ControlRecordStoreIdentity = Object.freeze({
    schema: CONTROL_RECORD_STORE_SCHEMA,
    storeId: `store.${processId}`,
    targetId: "target.receipt",
    processKind: "delivery",
    processId,
    createdAt: CREATED,
  });
  const revisions = new Map<string, ControlRecordRevision>();
  const events: ControlRecordEvent[] = [];
  let predecessorDigest: Sha256 | null = null;
  let appendCalls = 0;
  const compileEvent = (event: ControlRecordEventInput): ControlRecordEvent => {
    const compiled = compileControlRecordEvent({
      storeId: identity.storeId,
      processId: identity.processId,
      sequence: events.length + 1,
      predecessorDigest,
      event,
    });
    predecessorDigest = compiled.digest;
    events.push(compiled);
    return compiled;
  };
  const retainRevision = (input: ControlRecordRevisionInput): ControlRecordRevision => {
    const revision = compileControlRecordRevision(identity.processId, input);
    revisions.set(`${revision.recordId}\u0000${revision.revision}`, revision);
    return revision;
  };
  const append = (input: ControlRecordStoreAppend) => {
    appendCalls += 1;
    const revision = input.revision === undefined ? null : retainRevision(input.revision);
    return Object.freeze({ revision, event: compileEvent(input.event) });
  };
  const store = {
    identity,
    getRevision(recordId: string, revision: number) {
      return revisions.get(`${recordId}\u0000${revision}`) ?? null;
    },
    listEvents(afterSequence = 0, limit = 1000) {
      return Object.freeze(events.filter(({ sequence }) => sequence > afterSequence).slice(0, limit));
    },
    listRetainedFiles() {
      return Object.freeze([]);
    },
    append,
    async appendWithFiles(input: ControlRecordStoreAppendWithFiles) {
      return Object.freeze({
        files: Object.freeze(input.files.map(compileControlRecordFile)),
        appends: Object.freeze(input.appends.map(append)),
      });
    },
  } as unknown as ControlRecordStore;
  return Object.freeze({ store, retainRevision, compileEvent, appendCalls: () => appendCalls });
}

const backendProfile = Object.freeze({
  profileId: "lifecycle.execution-backend-profile.fault-injection.v1" as const,
  profileDigest: digest("backend-profile"),
  implementationDigest: digest("backend-implementation"),
});
const image = Object.freeze({
  imageId: "lifecycle.execution-image.test.v1",
  imageDigest: digest("execution-image"),
});
const inputSet = Object.freeze({
  profileId: "lifecycle.execution-input-set.v2" as const,
  digest: digest("execution-input-set"),
});

function attemptPayload(
  role: "reconnaissance" | "builder" | "reviewer",
  activityId: string,
): ControlJsonObject {
  return Object.freeze({
    schema: "lifecycle.agent-attempt-payload.v3",
    activityId,
    operation: role === "builder"
      ? "delivery.continue"
      : role === "reviewer" ? "delivery.evaluate" : "delivery.prepare",
    role,
    invocationId: `invocation.${role}`,
    preDispatchStateDigest: digest(`pre-dispatch-${role}`),
    projection: Object.freeze({
      id: `projection.${role}`,
      profileId: `projection-${role}`,
      digest: digest(`projection-${role}`),
    }),
    roleSubjectDigest: digest(`role-subject-${role}`),
    capability: Object.freeze({
      profileId: `capability-${role}`,
      profileDigest: digest(`capability-${role}`),
      effectiveGrantDigest: digest(`effective-grant-${role}`),
    }),
    investment: Object.freeze({
      id: `investment.${role}`,
      digest: digest(`investment-${role}`),
      model: "gpt-5.6-sol",
      reasoning: "high",
      wallTimeMs: 60_000,
      limits: Object.freeze({
        tokens: null,
        events: 100,
        outputBytes: 1_048_576,
        toolCalls: null,
        processes: 8,
        storageBytes: 1_048_576,
      }),
      rationale: "fixture",
    }),
    provider: Object.freeze({
      descriptorId: "codex-exec-standard-v7",
      descriptorDigest: digest("provider-descriptor"),
      adapter: "lifecycle.provider-adapter.v7",
      executableIdentityClass: "oci-image-tool",
      installedIdentityDigest: digest("provider-executable"),
    }),
    execution: Object.freeze({ backendProfile, image, inputSet }),
    authoring: Object.freeze({
      roleBriefDigest: digest(`role-brief-${role}`),
      templateProfileId: `template-${role}`,
      templateDigest: digest(`template-${role}`),
      parserProfileId: "parser-v2",
      parserProfileDigest: digest("parser-v2"),
      compilerProfileId: "compiler-v2",
      compilerProfileDigest: digest("compiler-v2"),
      submissionPolicy: "explicit-or-clean-natural-completion",
    }),
    input: Object.freeze({
      contentInventoryDigest: digest(`content-inventory-${role}`),
      inputMaterialDigest: digest(`input-material-${role}`),
      citationRegistryDigest: digest(`citation-registry-${role}`),
      evidenceSetDigest: role === "reconnaissance" ? null : digest(`evidence-set-${role}`),
      propositionSetDigest: role === "reviewer" ? digest("propositions") : null,
    }),
    executionPolicy: Object.freeze({
      cancellationPolicyDigest: digest("cancellation-policy"),
      containmentPolicyDigest: digest("containment-policy"),
      parentLossPolicyDigest: digest("parent-loss-policy"),
      retirementPolicyDigest: digest("retirement-policy"),
      recoveryPolicyDigest: digest("recovery-policy"),
    }),
    adjacentFilePurposes: Object.freeze(["raw-provider-output"]),
  });
}

function candidatePayload(input: Readonly<{
  observation: "initialization" | "builder-successor";
  manifestDigest: Sha256;
  unchanged: boolean;
}>): ControlJsonObject {
  return Object.freeze({
    schema: "lifecycle.candidate-revision-payload.v3",
    profileId: "lifecycle.candidate-revision.observation.v2",
    observation: input.observation,
    candidateBaseCommit: "1111111111111111111111111111111111111111",
    carrierManifest: Object.freeze({
      digest: input.manifestDigest,
      byteLength: 100,
      mediaType: "application/vnd.lifecycle.candidate-revision-carrier-manifest+json",
      purpose: "candidate-revision-carrier-manifest",
    }),
    state: Object.freeze({
      tree: "2222222222222222222222222222222222222222",
      candidateDigest: digest(`candidate-${input.observation}`),
      productStateDigest: digest("product-state"),
      knowledgeSetDigest: digest("knowledge-set"),
      diffDigest: digest("diff"),
      pathInventoryDigest: digest("paths"),
      artifactSetDigest: digest("artifacts"),
      descriptionCoverageDigest: digest("coverage"),
      unchangedFromPredecessor: input.unchanged,
      changedSubjects: Object.freeze([]),
    }),
    observer: Object.freeze({
      implementationId: "runtime.foundation",
      implementationDigest: digest("runtime-implementation"),
    }),
    limitations: Object.freeze([]),
  });
}

type SeededActivity = ReturnType<typeof seedActivity>;

function seedActivity(input: Readonly<{
  role: "reconnaissance" | "builder" | "reviewer";
  operation?: "delivery.prepare" | "delivery.revise" | "delivery.reaffirm";
  inputCandidate?: boolean;
  candidateDigest?: Sha256;
  providerOutcome?: "completed" | "failed" | "not-started";
  workProduct?: boolean;
  successor?: boolean;
  unchanged?: boolean;
  successorResultOf?: boolean;
}>) {
  const role = input.role;
  const providerOutcome = input.providerOutcome ?? "completed";
  const fixture = fakeStore(`delivery.${role}.${digestCanonical(input).slice(-10)}`);
  const activityId = `activity.${role}.${digestCanonical(input).slice(-10)}`;
  const bindsCandidate = input.inputCandidate ?? (role !== "reconnaissance" ||
    input.operation === "delivery.revise" || input.operation === "delivery.reaffirm");
  const inputCandidate = bindsCandidate
    ? fixture.retainRevision(revisionInput({
        id: `candidate.${role}`,
        kind: "candidate-revision",
        payload: candidatePayload({
          observation: "initialization",
          manifestDigest: digest(`input-carrier-${role}`),
          unchanged: false,
        }),
      }))
    : null;
  const attempt = fixture.retainRevision(revisionInput({
    id: `attempt.${role}`,
    kind: "agent-attempt",
    payload: { ...attemptPayload(role, activityId), ...(input.operation === undefined ? {} : { operation: input.operation }) },
    relationships: inputCandidate === null ? [] : [{
      relation: "uses-candidate",
      target: { ...reference(inputCandidate), digest: input.candidateDigest ?? inputCandidate.digest },
    }],
  }));
  const effectDigest = digest(`effect-${role}`);
  const activityEvents: ControlRecordEventInput[] = [
    {
      eventId: `event.attempt.${role}`,
      eventKind: "agent-attempt-prepared",
      occurredAt: CREATED,
      actor: { kind: "runtime" as const, id: RUNTIME },
      subject: subject(attempt),
      payload: { activityId },
    },
    {
      eventId: `event.intent.${role}`,
      eventKind: "provider-effect-intended",
      occurredAt: CREATED,
      actor: { kind: "runtime" as const, id: RUNTIME },
      subject: subject(attempt),
      payload: { activityId, effectDigest },
    },
    {
      eventId: `event.observed.${role}`,
      eventKind: "provider-effect-observed",
      occurredAt: FINISHED,
      actor: { kind: "runtime" as const, id: RUNTIME },
      subject: subject(attempt),
      payload: { activityId, effectDigest, outcome: providerOutcome },
    },
  ];
  for (const event of activityEvents) fixture.compileEvent(event);

  const semanticMarkdown = "# agent-work-product\n";
  const parseResultDigest = digest(`parse-result-${role}`);
  const fixedBindingSubjectDigest = digest(`fixed-binding-${role}`);
  const workProduct = input.workProduct === true
    ? fixture.retainRevision(revisionInput({
        id: `work-product.${role}`,
        kind: "agent-work-product",
        semanticMarkdown,
        payload: Object.freeze({
          schema: "lifecycle.agent-work-product-payload.v5",
          role,
          body: Object.freeze({ digest: sha256Bytes(semanticMarkdown) }),
          parseResultDigest,
          fixedBindingSubjectDigest,
        }),
        relationships: [{ relation: "result-of", target: reference(attempt) }],
      }))
    : null;
  fixture.compileEvent({
    eventId: workProduct === null ? `event.abandoned.${role}` : `event.submitted.${role}`,
    eventKind: workProduct === null ? "agent-work-product-abandoned" : "agent-work-product-submitted",
    occurredAt: FINISHED,
    actor: { kind: "runtime", id: RUNTIME },
    subject: subject(workProduct ?? attempt),
    payload: { activityId },
  });

  const successor = role === "builder" && input.successor === true
    ? fixture.retainRevision(revisionInput({
        id: inputCandidate!.recordId,
        revision: 2,
        kind: "candidate-revision",
        payload: candidatePayload({
          observation: "builder-successor",
          manifestDigest: digest("successor-carrier"),
          unchanged: input.unchanged ?? false,
        }),
        relationships: [
          { relation: "revises", target: reference(inputCandidate!) },
          ...(input.successorResultOf === false
            ? []
            : [{ relation: "result-of", target: reference(attempt) }]),
        ],
      }))
    : null;
  if (successor !== null) {
    fixture.compileEvent({
      eventId: "event.candidate.builder",
      eventKind: "candidate-revision-observed",
      occurredAt: FINISHED,
      actor: { kind: "runtime", id: RUNTIME },
      subject: subject(successor),
      payload: { activityId },
    });
  }
  return Object.freeze({
    ...fixture,
    activityId,
    role,
    providerOutcome,
    attempt,
    inputCandidate,
    successor,
    workProduct,
    parseResultDigest,
    fixedBindingSubjectDigest,
  });
}

function provider(input: Partial<ExecutionReceiptProviderObservation> = {}): ExecutionReceiptProviderObservation {
  return Object.freeze({
    preparedAt: CREATED,
    startedAt: STARTED,
    finishedAt: FINISHED,
    executableIdentity: digest("provider-executable"),
    outcome: "natural-return",
    stage: "evaluated",
    productiveStarted: true,
    firstTrigger: "natural-return",
    exitCode: 0,
    signal: null,
    sessionId: "session.one",
    ...input,
  });
}

function output(
  availability: "retrieved" | "not-produced" | "unavailable",
): ExecutionReceiptExecutionFacts["output"] {
  return availability === "retrieved"
    ? Object.freeze({
        availability,
        carrierByteLength: 256,
        carrierDigest: digest("output-carrier"),
        manifestDigest: digest("output-manifest"),
      })
    : Object.freeze({
        availability,
        carrierByteLength: null,
        carrierDigest: null,
        manifestDigest: null,
      });
}

function execution(outputBinding: ExecutionReceiptExecutionFacts["output"]): ExecutionReceiptExecutionFacts {
  return Object.freeze({
    backendProfile,
    image,
    inputSet,
    specificationDigest: digest("execution-specification"),
    runnerDigest: digest("execution-runner"),
    observationDigest: digest("execution-observation"),
    output: outputBinding,
  });
}

function unavailableWorkspace(label: string): ExecutionReceiptWorkspaceObservation {
  return Object.freeze({
    availability: "unavailable",
    failureFactsDigest: digest(label),
    submissionDiagnostic: null,
  });
}

function retainedWorkspace(activity: SeededActivity): ExecutionReceiptWorkspaceObservation {
  return Object.freeze({
    availability: "available",
    rawByteLength: 100,
    workspaceRawDigest: digest(`workspace-${activity.role}`),
    semanticMarkdownDigest: sha256Bytes("# agent-work-product\n"),
    parseResultDigest: activity.parseResultDigest,
    failureFactsDigest: null,
    submissionDiagnostic: null,
    fixedBindingSubjectDigest: activity.fixedBindingSubjectDigest,
    parserDisposition: "valid",
    compilerDisposition: "retained",
  });
}

const containment = Object.freeze({
  factsDigest: digest("containment-facts"),
  cancellationRequested: false,
  forced: false,
  parentLoss: "not-observed" as const,
});
const retirement = Object.freeze({
  factsDigest: digest("retirement-facts"),
  residualClass: "none" as const,
  residualFactsDigest: null,
});
const runtime = Object.freeze({
  implementationId: "runtime.foundation",
  implementationDigest: digest("runtime-implementation"),
  ruleSetId: "attempt-rules-v6",
  ruleSetDigest: digest("attempt-rules-v6"),
});

type ReceiptInput = Parameters<typeof retainExecutionReceipt>[0];

function baseInput(activity: SeededActivity): ReceiptInput {
  const promoted = activity.successor !== null;
  return Object.freeze({
    store: activity.store,
    activityId: activity.activityId,
    provider: provider(),
    submissionTrigger: activity.workProduct === null ? null : "clean-natural-completion",
    execution: execution(output(promoted || activity.role !== "builder" ? "retrieved" : "not-produced")),
    workspace: activity.workProduct === null
      ? unavailableWorkspace(`workspace-${activity.role}`)
      : retainedWorkspace(activity),
    candidateSuccessorDisposition: activity.role === "builder"
      ? promoted ? "promoted" : "not-produced"
      : null,
    containment,
    retirement,
    runtime,
    recordedAt: RECORDED,
    runtimeId: RUNTIME,
  });
}

function retain(
  activity: SeededActivity,
  overrides: Partial<ReceiptInput> = {},
) {
  return retainExecutionReceipt(Object.freeze({ ...baseInput(activity), ...overrides }));
}

function allKeys(value: unknown, result = new Set<string>()): ReadonlySet<string> {
  if (value === null || typeof value !== "object") return result;
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, result);
    return result;
  }
  for (const [key, item] of Object.entries(value)) {
    result.add(key);
    allKeys(item, result);
  }
  return result;
}

test("Execution Receipt v3 derives stable execution, Work Product, Containment, and Retirement facts", async () => {
  const activity = seedActivity({ role: "reconnaissance", workProduct: true });
  const rawFile = Object.freeze({
    bytes: new TextEncoder().encode("bounded provider output"),
    mediaType: "application/json",
    purpose: "raw-provider-output",
    createdAt: FINISHED,
  });
  const retained = await retain(activity, {
    rawMaterials: [{ availability: "retained", file: rawFile }],
  });

  assert.equal(activity.appendCalls(), 1);
  assert.equal(retained.revision.payload.schema, "lifecycle.execution-receipt-payload.v3");
  assert.equal(retained.revision.payload.role, "reconnaissance");
  assert.deepEqual(retained.revision.relationships.map(({ relation }) => relation), [
    "observes-attempt",
    "observes-work-product",
  ]);
  assert.deepEqual(retained.revision.payload.execution, baseInput(activity).execution);
  assert.deepEqual(retained.revision.payload.workProduct, {
    disposition: "submitted",
    reference: reference(activity.workProduct!),
  });
  assert.deepEqual(retained.revision.payload.candidate, {
    input: null,
    successorDisposition: null,
    successor: null,
    contentDisposition: null,
  });
  assert.equal((retained.revision.payload.containment as ControlJsonObject).classification, "contained");
  assert.equal((retained.revision.payload.retirement as ControlJsonObject).classification, "retired");
  assert.match(retained.revision.semanticMarkdown, /Execution Containment: contained/u);
  assert.match(retained.revision.semanticMarkdown, /Execution Retirement: retired/u);

  const forbidden = [
    "handle",
    "allocationKey",
    "cellId",
    "containerId",
    "endpoint",
    "path",
    "reclamation",
    "cleanup",
  ];
  const keys = allKeys(retained.revision.payload);
  for (const key of forbidden) assert.equal(keys.has(key), false, key);
});

test("Promoted builder Receipt binds exact input and result-of successor Carriers", async () => {
  const activity = seedActivity({
    role: "builder",
    successor: true,
    unchanged: true,
  });
  const retained = await retain(activity);
  assert.deepEqual(retained.revision.relationships.map(({ relation }) => relation), [
    "observes-attempt",
    "observes-candidate",
  ]);
  const candidate = retained.revision.payload.candidate as ControlJsonObject;
  assert.equal(candidate.successorDisposition, "promoted");
  assert.equal(candidate.contentDisposition, "unchanged");
  assert.deepEqual(
    (candidate.input as ControlJsonObject).revision,
    reference(activity.inputCandidate!),
  );
  assert.equal(
    (candidate.input as ControlJsonObject).carrierManifestDigest,
    digest("input-carrier-builder"),
  );
  assert.deepEqual(
    (candidate.successor as ControlJsonObject).revision,
    reference(activity.successor!),
  );
  assert.equal(
    (candidate.successor as ControlJsonObject).carrierManifestDigest,
    digest("successor-carrier"),
  );
});

test("Builder Receipt finalizes without a successor for every exact non-promotion disposition", async () => {
  for (const disposition of ["not-produced", "unavailable", "invalid"] as const) {
    const activity = seedActivity({ role: "builder" });
    const availability = disposition === "invalid" ? "retrieved" : disposition;
    const retained = await retain(activity, {
      execution: execution(output(availability)),
      candidateSuccessorDisposition: disposition,
    });
    const candidate = retained.revision.payload.candidate as ControlJsonObject;
    assert.equal(candidate.successorDisposition, disposition);
    assert.equal(candidate.successor, null);
    assert.equal(candidate.contentDisposition, null);
    assert.deepEqual(
      retained.revision.relationships.map(({ relation }) => relation),
      ["observes-attempt"],
    );
    assert.deepEqual(
      (candidate.input as ControlJsonObject).revision,
      reference(activity.inputCandidate!),
    );
  }
});

test("Reviewer Receipt carries only the exact sealed Candidate input", async () => {
  const activity = seedActivity({ role: "reviewer" });
  const retained = await retain(activity);
  const candidate = retained.revision.payload.candidate as ControlJsonObject;
  assert.deepEqual((candidate.input as ControlJsonObject).revision, reference(activity.inputCandidate!));
  assert.equal(candidate.successorDisposition, null);
  assert.equal(candidate.successor, null);
  assert.equal(candidate.contentDisposition, null);
  assert.deepEqual(retained.revision.relationships.map(({ relation }) => relation), [
    "observes-attempt",
  ]);
});

test("Resolution Receipt preserves exact frozen Candidate input through its Attempt without claiming Candidate output", async () => {
  for (const operation of ["delivery.revise", "delivery.reaffirm"] as const) {
    const activity = seedActivity({ role: "reconnaissance", operation });
    const retained = await retain(activity);
    assert.deepEqual(activity.attempt.relationships.find(({ relation }) => relation === "uses-candidate")?.target,
      reference(activity.inputCandidate!));
    assert.deepEqual(retained.revision.relationships, [
      { relation: "observes-attempt", target: reference(activity.attempt) },
    ]);
    assert.deepEqual(retained.revision.payload.candidate, {
      input: null, successorDisposition: null, successor: null, contentDisposition: null,
    });
  }
});

test("Reconnaissance Receipt rejects initial Candidate input, missing or substituted resolution input, and Candidate output", async () => {
  for (const input of [
    { operation: "delivery.prepare", inputCandidate: true },
    { operation: "delivery.revise", inputCandidate: false },
    { operation: "delivery.reaffirm", candidateDigest: digest("substituted-frozen-candidate") },
  ] as const) {
    await assert.rejects(retain(seedActivity({ role: "reconnaissance", ...input })),
      (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.control-execution-receipt.relationship");
  }
  const observation = seedActivity({ role: "reconnaissance", operation: "delivery.revise" });
  observation.compileEvent({
    eventId: "event.invalid-resolution-candidate", eventKind: "candidate-revision-observed",
    occurredAt: FINISHED, actor: { kind: "runtime", id: RUNTIME },
    subject: subject(observation.inputCandidate!), payload: { activityId: observation.activityId },
  });
  await assert.rejects(retain(observation), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-execution-receipt.journal");
  await assert.rejects(retain(seedActivity({ role: "reconnaissance", operation: "delivery.reaffirm" }), {
    candidateSuccessorDisposition: "promoted",
  }), (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.control-execution-receipt.candidate");
});

test("Receipt compiler refuses substituted execution and Candidate successor facts", async () => {
  const withoutSuccessor = seedActivity({ role: "builder" });
  await assert.rejects(retain(withoutSuccessor, {
    execution: execution(output("retrieved")),
    candidateSuccessorDisposition: "promoted",
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-execution-receipt.candidate");

  const withSuccessor = seedActivity({ role: "builder", successor: true });
  await assert.rejects(retain(withSuccessor, {
    execution: execution(output("not-produced")),
    candidateSuccessorDisposition: "not-produced",
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-execution-receipt.candidate");

  await assert.rejects(retain(withoutSuccessor, {
    execution: execution(output("unavailable")),
    candidateSuccessorDisposition: "invalid",
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-execution-receipt.candidate");

  const missingOrigin = seedActivity({
    role: "builder",
    successor: true,
    successorResultOf: false,
  });
  await assert.rejects(retain(missingOrigin), (error: unknown) =>
    error instanceof FoundationError &&
    error.code === "lifecycle.control-execution-receipt.relationship");

  const substitutedExecution = execution(output("not-produced"));
  await assert.rejects(retain(withoutSuccessor, {
    execution: Object.freeze({
      ...substitutedExecution,
      image: Object.freeze({
        ...substitutedExecution.image,
        imageDigest: digest("substituted-image"),
      }),
    }),
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-execution-receipt.execution");
});

test("Receipt compiler refuses incomplete Containment and Retirement claims", async () => {
  const activity = seedActivity({ role: "reconnaissance" });
  await assert.rejects(retain(activity, {
    containment: Object.freeze({ ...containment, forced: true }),
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-execution-receipt.containment");
  await assert.rejects(retain(activity, {
    retirement: Object.freeze({
      ...retirement,
      residualFactsDigest: digest("unexpected-residual"),
    }),
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-execution-receipt.retirement");
});

test("Receipt diagnostic projection remains exact under v3 workspace facts", async () => {
  const activity = seedActivity({ role: "reconnaissance" });
  const failureFactsDigest = digest("invalid-workspace");
  const workspace: ExecutionReceiptWorkspaceObservation = Object.freeze({
    availability: "available",
    rawByteLength: 80,
    workspaceRawDigest: digest("invalid-workspace-raw"),
    semanticMarkdownDigest: digest("invalid-semantic"),
    parseResultDigest: null,
    failureFactsDigest,
    submissionDiagnostic: Object.freeze({
      code: "lifecycle.agent-work-product.invalid.title",
      stage: "template",
      factsDigest: failureFactsDigest,
    }),
    fixedBindingSubjectDigest: null,
    parserDisposition: "invalid",
    compilerDisposition: "not-run",
  });
  const retained = await retain(activity, { workspace });
  assert.deepEqual(executionReceiptSubmissionDiagnostic(retained.revision), {
    code: "lifecycle.agent-work-product.invalid.title",
    stage: "template",
    factsDigest: failureFactsDigest,
  });
  assert.deepEqual(
    executionReceiptSubmissionDiagnosticForActivity(activity.store, activity.activityId),
    executionReceiptSubmissionDiagnostic(retained.revision),
  );
});

test("Truthful not-started Receipt retains no invented input or output availability", async () => {
  const activity = seedActivity({
    role: "reconnaissance",
    providerOutcome: "not-started",
  });
  const retained = await retain(activity, {
    provider: provider({
      startedAt: null,
      finishedAt: null,
      executableIdentity: null,
      outcome: "capability-refusal",
      stage: "compatibility",
      productiveStarted: false,
      firstTrigger: "capability-refusal",
      exitCode: null,
      sessionId: null,
    }),
    execution: execution(output("not-produced")),
  });
  assert.deepEqual(retained.revision.payload.inputBindings, {
    roleBriefDigest: null,
    contentInventoryDigest: null,
    inputMaterialDigest: null,
  });
  assert.equal((retained.revision.payload.providerEffect as ControlJsonObject).outcome, "not-started");
  assert.equal((retained.revision.payload.provider as ControlJsonObject).terminalReason, "security-stop");
  assert.deepEqual((retained.revision.payload.execution as ControlJsonObject).output, output("not-produced"));
});
