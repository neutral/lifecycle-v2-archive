import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  compileCandidateRevisionCarrierManifest,
} from "../../src/foundation/candidate/carrier-manifest.js";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
} from "../../src/foundation/candidate/carrier-types.js";
import type {
  FoundationPublishedCandidateOutputCarrierV1,
} from "../../src/foundation/candidate/candidate-output-carrier.js";
import {
  compileAgentAttemptAppend,
} from "../../src/foundation/control/agent-attempt.js";
import {
  retainCandidateRevision,
  type CandidateRevisionState,
} from "../../src/foundation/control/candidate-revision.js";
import {
  compileControlRecordRevision,
} from "../../src/foundation/control/model.js";
import {
  openControlRecordStore,
  type ControlRecordStore,
} from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlJsonObject,
  type ControlRecordOperationSupport,
  type ControlRecordRelationship,
  type ControlRecordRevision,
  type ControlRecordRevisionInput,
} from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import {
  compileFoundationExecutionRetrievalOutcome,
  type FoundationExecutionBackend,
  type FoundationExecutionHandle,
  type FoundationRetrievedExecutionOutputV1,
} from "../../src/foundation/execution/backend.js";
import type {
  FoundationExecutionOutputManifestEntryV1,
  FoundationExecutionSpecificationV1,
} from "../../src/foundation/execution/contracts.js";
import type {
  FoundationExecutionOperationCheckpointCoordinateV1,
  FoundationExecutionOperationCheckpointPersistenceV1,
  FoundationExecutionOperationCheckpointV1,
  FoundationRetainedExecutionOperationCheckpointV1,
} from "../../src/foundation/execution/operation-host.js";
import {
  createFoundationExecutionOutputStoreV1,
} from "../../src/foundation/execution/output-store-v1.js";
import {
  openFoundationExecutionReclamationLedgerV1,
} from "../../src/foundation/execution/reclamation-ledger-v1.js";
import {
  canonicalJson,
  canonicalJsonLine,
  digestCanonical,
  selfDigest,
  sha256Bytes,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";
import {
  compileFoundationAgentCellInputV1,
  compileFoundationAgentCellSpecificationV1,
  FOUNDATION_AGENT_EXECUTION_CELL_INPUT_V1,
  operateFoundationAgentCellV1,
  type FoundationAgentCellActivityOwnerV1,
  type FoundationAgentCellAttemptPreparationV1,
  type FoundationAgentCellImageV1,
  type FoundationAgentCellImmutableEntryV1,
  type FoundationAgentCellImmutableSubjectV1,
  type FoundationAgentCellInstalledInputsV1,
  type FoundationAgentCellPersistenceBindingV1,
  type FoundationCompiledAgentCellInputV1,
} from "../../src/foundation/attempt/execution-cell-v1.js";
import {
  FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1,
  observeFoundationAgentProviderTerminalCompletionV1,
  readFoundationAgentSemanticWorkspaceV1,
} from "../../src/util/agent-execution-cell-operation-v1.js";
import {
  digest,
  executionContractFixture,
} from "../support/execution-contract-fixture.js";
import {
  InMemoryExecutionBackendEngine,
} from "../support/in-memory-execution-backend.js";

const RUNTIME = "foundation-runtime";
const TARGET = "agent-cell-target";
const DELIVERY = "agent-cell-delivery";
const BASE_COMMIT = "a".repeat(40);
const SUPPORT_KIND = "agent-execution-cell-v1";
const SEMANTIC_BYTES = Uint8Array.from(Buffer.from(
  "# Builder Work Product\n\n## Outcome\n\nBounded work.\n",
  "utf8",
));
const CANDIDATE_BYTES = Uint8Array.from(Buffer.from("successor candidate\n", "utf8"));

function currentPayload(kind: RecordKind): ControlJsonObject {
  return JSON.parse(readFileSync(join(
    process.cwd(),
    "..",
    "spec-source",
    "examples",
    `${kind}-payload-structural-valid`,
    "subject.json",
  ), "utf8")) as ControlJsonObject;
}

type RecordKind =
  | "founder-brief"
  | "agent-attempt"
  | "agent-work-product"
  | "execution-receipt"
  | "work-boundary"
  | "founder-decision"
  | "check-receipt";

const RECORD_SEMANTICS = Object.freeze({
  "founder-brief": Object.freeze({ author: "founder", authority: "founder-supplied" }),
  "agent-attempt": Object.freeze({ author: "runtime", authority: "runtime-derived" }),
  "agent-work-product": Object.freeze({ author: "agent", authority: "agent-proposed" }),
  "execution-receipt": Object.freeze({ author: "runtime", authority: "runtime-observed" }),
  "work-boundary": Object.freeze({ author: "runtime", authority: "runtime-derived" }),
  "founder-decision": Object.freeze({ author: "founder", authority: "founder-authenticated" }),
  "check-receipt": Object.freeze({ author: "runtime", authority: "runtime-observed" }),
} as const);

function nowSequence(start = "2026-08-31T20:00:00.000Z"): () => string {
  let value = Date.parse(start);
  return () => new Date(value += 1_000).toISOString();
}

function operationClock(start = "2026-09-01T00:00:00.000Z") {
  let value = Date.parse(start);
  return Object.freeze({ now: () => new Date(value += 1).toISOString() });
}

function relationship(
  relation: string,
  revision: ControlRecordRevision,
): ControlRecordRelationship {
  return Object.freeze({
    relation,
    target: Object.freeze({
      kind: revision.recordKind,
      id: revision.recordId,
      revision: revision.revision,
      digest: revision.digest,
    }),
  });
}

function revisionInput(input: Readonly<{
  id: string;
  kind: RecordKind;
  createdAt: string;
  payload?: ControlJsonObject;
  relationships?: readonly ControlRecordRelationship[];
}>): ControlRecordRevisionInput {
  const semantics = RECORD_SEMANTICS[input.kind];
  return Object.freeze({
    recordId: input.id,
    recordKind: input.kind,
    revision: 1,
    producer: Object.freeze({ kind: "runtime" as const, id: RUNTIME }),
    semanticAuthor: Object.freeze({
      kind: semantics.author,
      id: `${semantics.author}-agent-cell-fixture`,
    }),
    semanticAuthority: semantics.authority,
    createdAt: input.createdAt,
    semanticMarkdown: `# ${input.kind}\n\nAgent Cell real-Store fixture.\n`,
    payload: input.payload ?? currentPayload(input.kind),
    relationships: Object.freeze([...(input.relationships ?? [])]),
  });
}

function appendRevision(input: Readonly<{
  store: ControlRecordStore;
  revision: ControlRecordRevisionInput;
  eventId: string;
  eventKind: string;
  activityId: string;
}>): ControlRecordRevision {
  const compiled = compileControlRecordRevision(
    input.store.identity.processId,
    input.revision,
  );
  const retained = input.store.append({
    revision: input.revision,
    event: Object.freeze({
      eventId: input.eventId,
      eventKind: input.eventKind,
      occurredAt: input.revision.createdAt,
      actor: Object.freeze({ kind: "runtime" as const, id: RUNTIME }),
      subject: Object.freeze({
        recordId: compiled.recordId,
        revision: compiled.revision,
        digest: compiled.digest,
      }),
      payload: Object.freeze({ activityId: input.activityId }),
    }),
  });
  assert(retained.revision !== null);
  return retained.revision;
}

function appendEvent(input: Readonly<{
  store: ControlRecordStore;
  eventId: string;
  eventKind: string;
  occurredAt: string;
  activityId: string;
  subject?: ControlRecordRevision;
  payload?: ControlJsonObject;
}>): void {
  input.store.append({ event: Object.freeze({
    eventId: input.eventId,
    eventKind: input.eventKind,
    occurredAt: input.occurredAt,
    actor: Object.freeze({ kind: "runtime" as const, id: RUNTIME }),
    subject: input.subject === undefined ? null : Object.freeze({
      recordId: input.subject.recordId,
      revision: input.subject.revision,
      digest: input.subject.digest,
    }),
    payload: Object.freeze({ activityId: input.activityId, ...(input.payload ?? {}) }),
  }) });
}

function candidateState(boundary: ControlRecordRevision): CandidateRevisionState {
  const basis = boundary.payload.basis as ControlJsonObject;
  const state = Object.freeze({
    tree: String(basis.productBaseTree),
    productStateDigest: basis.productStateDigest as Sha256,
    knowledgeSetDigest: basis.knowledgeSetDigest as Sha256,
    diffDigest: sha256Bytes(new Uint8Array()),
    pathInventoryDigest: digest("agent-cell-paths"),
    artifactSetDigest: basis.productStateDigest as Sha256,
    descriptionCoverageDigest: digest("agent-cell-description"),
    unchangedFromPredecessor: true,
    changedSubjects: Object.freeze([]),
  });
  return Object.freeze({
    ...state,
    candidateDigest: digestCanonical({
      schema: "lifecycle.delivery-candidate-state.v1",
      candidateBaseCommit: BASE_COMMIT,
      tree: state.tree,
      productStateDigest: state.productStateDigest,
      knowledgeSetDigest: state.knowledgeSetDigest,
      diffDigest: state.diffDigest,
      pathInventoryDigest: state.pathInventoryDigest,
      artifactSetDigest: state.artifactSetDigest,
      descriptionCoverageDigest: state.descriptionCoverageDigest,
      changedSubjects: state.changedSubjects,
    }),
  });
}

async function seedAdmittedStore(root: string): Promise<Readonly<{
  store: ControlRecordStore;
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
  carrierManifestBytes: Uint8Array;
  carrierArtifactBytes: Uint8Array;
}>> {
  const store = await openControlRecordStore({
    root,
    create: true,
    identity: Object.freeze({
      schema: CONTROL_RECORD_STORE_SCHEMA,
      storeId: "store-agent-execution-cell-v1",
      targetId: TARGET,
      processKind: "delivery" as const,
      processId: DELIVERY,
      createdAt: "2026-08-31T20:00:00.000Z",
    }),
  });
  const now = nowSequence();
  store.append({ event: Object.freeze({
    eventId: "event-delivery-created-agent-cell",
    eventKind: "delivery-created",
    occurredAt: now(),
    actor: Object.freeze({ kind: "runtime" as const, id: RUNTIME }),
    payload: Object.freeze({}),
  }) });

  const prepareId = "activity-prepare-agent-cell";
  const brief = appendRevision({
    store,
    revision: revisionInput({
      id: "brief-prepare-agent-cell",
      kind: "founder-brief",
      createdAt: now(),
    }),
    eventId: "event-brief-prepare-agent-cell",
    eventKind: "founder-brief-submitted",
    activityId: prepareId,
  });
  appendEvent({
    store,
    eventId: "event-start-prepare-agent-cell",
    eventKind: "activity-started",
    occurredAt: now(),
    activityId: prepareId,
    payload: Object.freeze({ operation: "delivery.prepare" }),
  });
  const rawAttempt = currentPayload("agent-attempt");
  const attempt = appendRevision({
    store,
    revision: revisionInput({
      id: "attempt-prepare-agent-cell",
      kind: "agent-attempt",
      createdAt: now(),
      payload: Object.freeze({
        ...rawAttempt,
        activityId: prepareId,
        operation: "delivery.prepare",
        role: "reconnaissance",
      }),
      relationships: Object.freeze([relationship("uses-brief", brief)]),
    }),
    eventId: "event-attempt-prepare-agent-cell",
    eventKind: "agent-attempt-prepared",
    activityId: prepareId,
  });
  const effectDigest = digest("agent-cell-prepare-effect");
  appendEvent({
    store,
    eventId: "event-intent-prepare-agent-cell",
    eventKind: "provider-effect-intended",
    occurredAt: now(),
    activityId: prepareId,
    subject: attempt,
    payload: Object.freeze({ effectDigest }),
  });
  appendEvent({
    store,
    eventId: "event-observed-prepare-agent-cell",
    eventKind: "provider-effect-observed",
    occurredAt: now(),
    activityId: prepareId,
    subject: attempt,
    payload: Object.freeze({ effectDigest, outcome: "completed" }),
  });
  const product = appendRevision({
    store,
    revision: revisionInput({
      id: "product-prepare-agent-cell",
      kind: "agent-work-product",
      createdAt: now(),
      relationships: Object.freeze([relationship("result-of", attempt)]),
    }),
    eventId: "event-product-prepare-agent-cell",
    eventKind: "agent-work-product-submitted",
    activityId: prepareId,
  });
  const receiptPayload = currentPayload("execution-receipt");
  appendRevision({
    store,
    revision: revisionInput({
      id: "receipt-prepare-agent-cell",
      kind: "execution-receipt",
      createdAt: now(),
      payload: Object.freeze({ ...receiptPayload, activityId: prepareId }),
      relationships: Object.freeze([
        relationship("observes-attempt", attempt),
        relationship("observes-work-product", product),
      ]),
    }),
    eventId: "event-receipt-prepare-agent-cell",
    eventKind: "execution-receipt-recorded",
    activityId: prepareId,
  });
  const rawBoundary = currentPayload("work-boundary");
  const rawBasis = rawBoundary.basis as ControlJsonObject;
  const boundary = appendRevision({
    store,
    revision: revisionInput({
      id: "boundary-agent-cell",
      kind: "work-boundary",
      createdAt: now(),
      payload: Object.freeze({
        ...rawBoundary,
        targetId: TARGET,
        basis: Object.freeze({
          ...rawBasis,
          productBaseCommit: BASE_COMMIT,
          productBaseTree: "b".repeat(40),
        }),
      }),
      relationships: Object.freeze([
        relationship("uses-brief", brief),
        relationship("proposed-from", product),
      ]),
    }),
    eventId: "event-boundary-agent-cell",
    eventKind: "work-boundary-finalized",
    activityId: prepareId,
  });
  const rawCheck = currentPayload("check-receipt");
  const baseline = appendRevision({
    store,
    revision: revisionInput({
      id: "baseline-agent-cell",
      kind: "check-receipt",
      createdAt: now(),
      payload: Object.freeze({ ...rawCheck, rawMaterials: Object.freeze([]) }),
      relationships: Object.freeze([relationship("checks-boundary", boundary)]),
    }),
    eventId: "event-baseline-agent-cell",
    eventKind: "check-receipt-recorded",
    activityId: prepareId,
  });
  appendEvent({
    store,
    eventId: "event-complete-prepare-agent-cell",
    eventKind: "activity-completed",
    occurredAt: now(),
    activityId: prepareId,
    payload: Object.freeze({ outcome: "completed" }),
  });

  const admitId = "activity-admit-agent-cell";
  appendEvent({
    store,
    eventId: "event-start-admit-agent-cell",
    eventKind: "activity-started",
    occurredAt: now(),
    activityId: admitId,
    payload: Object.freeze({ operation: "delivery.admit" }),
  });
  const rawDecision = currentPayload("founder-decision");
  const rawDecisionSubject = rawDecision.subject as ControlJsonObject;
  const decision = appendRevision({
    store,
    revision: revisionInput({
      id: "decision-admit-agent-cell",
      kind: "founder-decision",
      createdAt: now(),
      payload: Object.freeze({
        ...rawDecision,
        decision: "admit",
        subject: Object.freeze({
          ...rawDecisionSubject,
          operation: "delivery.admit",
          decision: "admit",
          candidateDisposition: "not-applicable",
        }),
      }),
      relationships: Object.freeze([
        relationship("selects-boundary", boundary),
        relationship("selects-baseline-receipt", baseline),
      ]),
    }),
    eventId: "event-decision-admit-agent-cell",
    eventKind: "founder-decision-authenticated",
    activityId: admitId,
  });
  const admissionEffect = digest("agent-cell-admission-effect");
  const admissionFacts = Object.freeze({
    schema: "lifecycle.admission-effect-observation-facts.v2",
    outcome: "applied",
    disposition: null,
    repositoryBasisDigest: digest("agent-cell-admission-repository-basis"),
  });
  appendEvent({
    store,
    eventId: "event-intent-admit-agent-cell",
    eventKind: "transaction-effect-intended",
    occurredAt: now(),
    activityId: admitId,
    subject: decision,
    payload: Object.freeze({ effectDigest: admissionEffect }),
  });
  appendEvent({
    store,
    eventId: "event-observed-admit-agent-cell",
    eventKind: "transaction-effect-observed",
    occurredAt: now(),
    activityId: admitId,
    subject: decision,
    payload: Object.freeze({
      effectDigest: admissionEffect,
      outcome: "applied",
      facts: admissionFacts,
      factsDigest: digestCanonical(admissionFacts),
    }),
  });
  const state = candidateState(boundary);
  const carrierArtifactBytes = Uint8Array.of(0x2a);
  const compiledCarrier = compileCandidateRevisionCarrierManifest({
    objectFormat: "sha1",
    rootTree: state.tree,
    objectInventory: Object.freeze([Object.freeze({
      objectId: state.tree,
      objectType: "tree" as const,
      byteLength: 36,
    })]),
    carrierArtifact: Object.freeze({
      format: "git-pack-v2" as const,
      byteLength: carrierArtifactBytes.byteLength,
      digest: sha256Bytes(carrierArtifactBytes),
    }),
    limits: FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
  });
  const candidate = (await retainCandidateRevision({
    store,
    activityId: admitId,
    observation: "initialization",
    candidateBaseCommit: BASE_COMMIT,
    carrierManifestBytes: compiledCarrier.manifestBytes,
    verifyCarrier: async ({ manifestBytes }) => Object.freeze({
      manifestFileDigest: sha256Bytes(manifestBytes),
      state,
      observer: Object.freeze({
        implementationId: "agent-cell-test-carrier-observer-v1",
        implementationDigest: digest("agent-cell-test-carrier-observer"),
      }),
    }),
    boundary: Object.freeze({
      kind: "work-boundary",
      id: boundary.recordId,
      revision: boundary.revision,
      digest: boundary.digest,
    }),
    predecessor: null,
    observedAt: now(),
    runtimeId: RUNTIME,
  })).revision;
  appendEvent({
    store,
    eventId: "event-complete-admit-agent-cell",
    eventKind: "activity-completed",
    occurredAt: now(),
    activityId: admitId,
    payload: Object.freeze({ outcome: "completed" }),
  });
  assert(store.state().eligibleOperations.includes("delivery.continue"));
  return Object.freeze({
    store,
    boundary,
    candidate,
    carrierManifestBytes: compiledCarrier.manifestBytes,
    carrierArtifactBytes,
  });
}

function jsonBytes(value: unknown): Uint8Array {
  return Uint8Array.from(Buffer.from(canonicalJson(value), "utf8"));
}

function immutableSubject(input: Readonly<{
  kind: FoundationAgentCellImmutableSubjectV1["subject"]["kind"];
  id: string;
  revision?: number | null;
  digest: Sha256;
  bytes?: Uint8Array;
  candidateBinding?: FoundationAgentCellImmutableSubjectV1["candidateBinding"];
}>): FoundationAgentCellImmutableSubjectV1 {
  return Object.freeze({
    subject: Object.freeze({
      kind: input.kind,
      id: input.id,
      revision: input.revision ?? null,
      digest: input.digest,
    }),
    bytes: Uint8Array.from(input.bytes ?? jsonBytes({ id: input.id })),
    candidateBinding: input.candidateBinding ?? null,
  });
}

function immutableEntry(input: Readonly<{
  path: string;
  purpose: FoundationAgentCellImmutableEntryV1["plan"]["purpose"];
  mediaType: string;
  modeClass: "regular" | "executable";
  sourceSubjectDigest: Sha256;
  bytes: Uint8Array;
}>): FoundationAgentCellImmutableEntryV1 {
  return Object.freeze({
    plan: Object.freeze({
      path: input.path,
      purpose: input.purpose,
      mediaType: input.mediaType,
      modeClass: input.modeClass,
      sourceSubjectDigest: input.sourceSubjectDigest,
    }),
    bytes: Uint8Array.from(input.bytes),
  });
}

function image(salt: string): FoundationAgentCellImageV1 {
  return Object.freeze({
    ...executionContractFixture(salt).image,
    runnerContractDigest: digest("agent-cell-runner-contract"),
    runnerImplementationDigest: digest("agent-cell-runner-implementation"),
    toolInventoryDigest: digest("agent-cell-tool-inventory"),
  });
}

type BuilderSelection = Readonly<{
  activityId: string;
  brief: ControlRecordRevision;
  roleSubject: ControlJsonObject;
  roleSubjectDigest: Sha256;
  projection: Readonly<{ id: string; profileId: string; digest: Sha256 }>;
  roleBrief: Readonly<{ id: string; digest: Sha256; bytes: Uint8Array }>;
  semanticTemplate: Readonly<{ id: string; digest: Sha256; bytes: Uint8Array }>;
  capability: Readonly<{
    profileId: string;
    profileDigest: Sha256;
    effectiveGrantDigest: Sha256;
  }>;
  investment: Readonly<{
    id: string;
    digest: Sha256;
    model: string;
    reasoning: string;
    wallTimeMs: number;
    limits: Readonly<{
      tokens: null;
      events: number;
      outputBytes: number;
      toolCalls: null;
      processes: number;
      storageBytes: number;
    }>;
    rationale: string;
  }>;
  provider: Readonly<{
    descriptorId: string;
    descriptorDigest: Sha256;
    executableIdentityClass: string;
    installedIdentityDigest: Sha256;
  }>;
  policies: Readonly<{
    cancellationPolicyDigest: Sha256;
    containmentPolicyDigest: Sha256;
    parentLossPolicyDigest: Sha256;
    retirementPolicyDigest: Sha256;
    recoveryPolicyDigest: Sha256;
  }>;
}>;

function openBuilderActivity(input: Readonly<{
  store: ControlRecordStore;
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
  salt: string;
}>): BuilderSelection {
  const now = nowSequence("2026-08-31T22:00:00.000Z");
  const activityId = `activity-continue-agent-cell-${input.salt}`;
  const brief = appendRevision({
    store: input.store,
    revision: revisionInput({
      id: `brief-continue-agent-cell-${input.salt}`,
      kind: "founder-brief",
      createdAt: now(),
    }),
    eventId: `event-brief-continue-agent-cell-${input.salt}`,
    eventKind: "founder-brief-submitted",
    activityId,
  });
  appendEvent({
    store: input.store,
    eventId: `event-start-continue-agent-cell-${input.salt}`,
    eventKind: "activity-started",
    occurredAt: now(),
    activityId,
    payload: Object.freeze({ operation: "delivery.continue" }),
  });
  const roleSubject = Object.freeze({
    schema: "lifecycle.builder-role-subject.test.v1",
    boundaryDigest: input.boundary.digest,
    candidateDigest: input.candidate.digest,
  });
  const investmentValue = Object.freeze({
    id: `investment-agent-cell-${input.salt}`,
    model: "gpt-5.6-sol",
    reasoning: "high",
    wallTimeMs: 30_000,
    limits: Object.freeze({
      tokens: null,
      events: 64,
      outputBytes: 64 * 1024,
      toolCalls: null,
      processes: 4,
      storageBytes: 1024 * 1024,
    }),
    rationale: "agent-cell-bounded-builder",
  });
  const roleBriefBytes = Uint8Array.from(Buffer.from("# Builder Role Brief\n\nBuild.\n", "utf8"));
  const templateBytes = Uint8Array.from(Buffer.from("# Builder Work Product\n\n## Outcome\n", "utf8"));
  return Object.freeze({
    activityId,
    brief,
    roleSubject,
    roleSubjectDigest: digestCanonical(roleSubject),
    projection: Object.freeze({
      id: `projection-agent-cell-${input.salt}`,
      profileId: "lifecycle.projection.builder.test.v1",
      digest: digest(`agent-cell-projection-${input.salt}`),
    }),
    roleBrief: Object.freeze({
      id: `role-brief-agent-cell-${input.salt}`,
      digest: sha256Bytes(roleBriefBytes),
      bytes: roleBriefBytes,
    }),
    semanticTemplate: Object.freeze({
      id: "lifecycle.agent-work-product.builder.test.v1",
      digest: sha256Bytes(templateBytes),
      bytes: templateBytes,
    }),
    capability: Object.freeze({
      profileId: "lifecycle.capability.builder.test.v1",
      profileDigest: digest(`agent-cell-capability-${input.salt}`),
      effectiveGrantDigest: digest(`agent-cell-grant-${input.salt}`),
    }),
    investment: Object.freeze({
      ...investmentValue,
      digest: digestCanonical(investmentValue),
    }),
    provider: Object.freeze({
      descriptorId: "lifecycle.provider.codex.test.v1",
      descriptorDigest: digest("agent-cell-provider-descriptor"),
      executableIdentityClass: "content-digest",
      installedIdentityDigest: digest("agent-cell-provider-executable"),
    }),
    policies: Object.freeze({
      cancellationPolicyDigest: digest("agent-cell-policy-cancellation"),
      containmentPolicyDigest: digest("agent-cell-policy-containment"),
      parentLossPolicyDigest: digest("agent-cell-policy-parent-loss"),
      retirementPolicyDigest: digest("agent-cell-policy-retirement"),
      recoveryPolicyDigest: digest("agent-cell-policy-recovery"),
    }),
  });
}

async function compileBuilderInput(input: Readonly<{
  store: ControlRecordStore;
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
  carrierManifestBytes: Uint8Array;
  carrierArtifactBytes: Uint8Array;
  selection: BuilderSelection;
  selectedImage: FoundationAgentCellImageV1;
  transformSubject?: (
    subject: FoundationAgentCellImmutableSubjectV1,
  ) => FoundationAgentCellImmutableSubjectV1;
}>): Promise<FoundationCompiledAgentCellInputV1> {
  const manifestDigest = sha256Bytes(input.carrierManifestBytes);
  const candidateStateValue = input.candidate.payload.state as ControlJsonObject;
  const subjects = Object.freeze([
    immutableSubject({
      kind: "projection",
      id: input.selection.projection.id,
      digest: input.selection.projection.digest,
      bytes: jsonBytes(input.selection.projection),
    }),
    immutableSubject({
      kind: "role-subject",
      id: `role-subject-${input.selection.activityId}`,
      digest: input.selection.roleSubjectDigest,
      bytes: jsonBytes(input.selection.roleSubject),
    }),
    immutableSubject({
      kind: "founder-direction",
      id: input.selection.brief.recordId,
      revision: input.selection.brief.revision,
      digest: input.selection.brief.digest,
      bytes: jsonBytes(input.selection.brief),
    }),
    immutableSubject({
      kind: "role-brief",
      id: input.selection.roleBrief.id,
      digest: input.selection.roleBrief.digest,
      bytes: input.selection.roleBrief.bytes,
    }),
    immutableSubject({
      kind: "semantic-template",
      id: input.selection.semanticTemplate.id,
      digest: input.selection.semanticTemplate.digest,
      bytes: input.selection.semanticTemplate.bytes,
    }),
    immutableSubject({
      kind: "capability-profile",
      id: input.selection.capability.profileId,
      digest: input.selection.capability.profileDigest,
    }),
    immutableSubject({
      kind: "provider-descriptor",
      id: input.selection.provider.descriptorId,
      digest: input.selection.provider.descriptorDigest,
    }),
    immutableSubject({
      kind: "investment",
      id: input.selection.investment.id,
      digest: input.selection.investment.digest,
      bytes: jsonBytes(input.selection.investment),
    }),
    ...Object.entries(input.selection.policies).map(([id, selectedDigest]) =>
      immutableSubject({
        kind: "policy",
        id,
        digest: selectedDigest,
      })),
    immutableSubject({
      kind: "runner",
      id: "lifecycle.execution-cell-runner.v1",
      digest: input.selectedImage.runnerContractDigest,
    }),
    immutableSubject({
      kind: "candidate-revision",
      id: input.candidate.recordId,
      revision: input.candidate.revision,
      digest: input.candidate.digest,
      bytes: jsonBytes(input.candidate),
      candidateBinding: Object.freeze({
        carrierManifestFileDigest: manifestDigest,
        rootTree: String(candidateStateValue.tree),
      }),
    }),
    immutableSubject({
      kind: "candidate-revision-carrier-manifest",
      id: `${input.candidate.recordId}-carrier-manifest`,
      digest: manifestDigest,
      bytes: input.carrierManifestBytes,
    }),
  ]);
  const entries = Object.freeze([
    immutableEntry({
      path: FOUNDATION_AGENT_EXECUTION_CELL_INPUT_V1.candidateManifestPath,
      purpose: "operation-input",
      mediaType: "application/json",
      modeClass: "regular",
      sourceSubjectDigest: manifestDigest,
      bytes: input.carrierManifestBytes,
    }),
    immutableEntry({
      path: FOUNDATION_AGENT_EXECUTION_CELL_INPUT_V1.candidateArtifactPath,
      purpose: "candidate-carrier-artifact",
      mediaType: "application/octet-stream",
      modeClass: "regular",
      sourceSubjectDigest: manifestDigest,
      bytes: input.carrierArtifactBytes,
    }),
    immutableEntry({
      path: FOUNDATION_AGENT_EXECUTION_CELL_INPUT_V1.roleBriefPath,
      purpose: "role-brief",
      mediaType: "text/markdown; charset=utf-8",
      modeClass: "regular",
      sourceSubjectDigest: input.selection.roleBrief.digest,
      bytes: input.selection.roleBrief.bytes,
    }),
    immutableEntry({
      path: FOUNDATION_AGENT_EXECUTION_CELL_INPUT_V1.semanticTemplatePath,
      purpose: "semantic-template",
      mediaType: "text/markdown; charset=utf-8",
      modeClass: "regular",
      sourceSubjectDigest: input.selection.semanticTemplate.digest,
      bytes: input.selection.semanticTemplate.bytes,
    }),
  ]);
  return await compileFoundationAgentCellInputV1({
    store: input.store,
    activityId: input.selection.activityId,
    role: "builder",
    ownerSubjectDigest: input.selection.roleSubjectDigest,
    inputMaterialDigest: digest(`agent-cell-input-material-${input.selection.activityId}`),
    subjects: input.transformSubject === undefined
      ? subjects
      : Object.freeze(subjects.map(input.transformSubject)),
    entries,
    runnerContractDigest: input.selectedImage.runnerContractDigest,
    toolInventoryDigest: input.selectedImage.toolInventoryDigest,
  });
}

function installedInputs(input: Readonly<{
  salt: string;
  image: FoundationAgentCellImageV1;
  selection: BuilderSelection;
  adapterDigest?: Sha256;
}>): FoundationAgentCellInstalledInputsV1 {
  const profile = executionContractFixture(input.salt).profile;
  return Object.freeze({
    profile,
    image: input.image,
    provider: input.selection.provider,
    adapterImplementationDigest: input.adapterDigest ?? digest("agent-cell-adapter"),
    environment: Object.freeze([]),
    capabilities: Object.freeze({
      temporaryWrites: true,
      subprocesses: "repository-toolchain" as const,
      externalEffects: false,
    }),
    networkPolicy: Object.freeze({
      agentProductNetwork: "none" as const,
      agentPolicyDigest: input.selection.policies.containmentPolicyDigest,
      providerControlPlane: "none" as const,
      providerPolicyDigest: null,
      separationRequired: true as const,
    }),
    credentialPolicy: Object.freeze({
      mode: "none" as const,
      bindings: Object.freeze([]),
      agentAccess: false as const,
      outputDisclosure: false as const,
    }),
  });
}

function compileAttempt(input: Readonly<{
  store: ControlRecordStore;
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
  selection: BuilderSelection;
  compiledInput: FoundationCompiledAgentCellInputV1;
  installed: FoundationAgentCellInstalledInputsV1;
}>): FoundationAgentCellAttemptPreparationV1 {
  return compileAgentAttemptAppend({
    store: input.store,
    activityId: input.selection.activityId,
    operation: "delivery.continue",
    role: "builder",
    createdAt: "2026-08-31T22:00:03.000Z",
    runtimeId: RUNTIME,
    projection: input.selection.projection,
    roleSubject: input.selection.roleSubject,
    capability: input.selection.capability,
    investment: input.selection.investment,
    provider: input.selection.provider,
    execution: Object.freeze({
      backendProfile: Object.freeze({
        profileId: input.installed.profile.profileId,
        profileDigest: input.installed.profile.digest,
        implementationDigest: input.installed.profile.implementation.implementationDigest,
      }),
      image: Object.freeze({
        imageId: input.installed.image.imageId,
        imageDigest: input.installed.image.imageDigest,
      }),
      inputSet: Object.freeze({
        profileId: "lifecycle.execution-input-set.v1" as const,
        digest: input.compiledInput.inputSet.digest,
      }),
    }),
    authoring: Object.freeze({
      roleBriefDigest: input.selection.roleBrief.digest,
      templateProfileId: input.selection.semanticTemplate.id,
      templateDigest: input.selection.semanticTemplate.digest,
      parserProfileId: "lifecycle.agent-work-product-parser.test.v1",
      parserProfileDigest: digest("agent-cell-parser"),
      compilerProfileId: "lifecycle.agent-work-product-compiler.test.v1",
      compilerProfileDigest: digest("agent-cell-compiler"),
      submissionPolicy: "explicit-or-clean-natural-completion" as const,
    }),
    input: Object.freeze({
      contentInventoryDigest: input.compiledInput.inputSet.contentInventoryDigest,
      inputMaterialDigest: input.compiledInput.inputSet.inputMaterialDigest,
      citationRegistryDigest: digest("agent-cell-citation-registry"),
      evidenceSetDigest: digest("agent-cell-evidence-set"),
      propositionSetDigest: null,
    }),
    executionPolicy: input.selection.policies,
    brief: Object.freeze({
      kind: "founder-brief" as const,
      id: input.selection.brief.recordId,
      revision: input.selection.brief.revision,
      digest: input.selection.brief.digest,
    }),
    boundary: Object.freeze({
      kind: "work-boundary" as const,
      id: input.boundary.recordId,
      revision: input.boundary.revision,
      digest: input.boundary.digest,
    }),
    candidate: Object.freeze({
      kind: "candidate-revision" as const,
      id: input.candidate.recordId,
      revision: input.candidate.revision,
      digest: input.candidate.digest,
    }),
  });
}

function testFailure(code: string, message: string): never {
  throw new FoundationError(`lifecycle.agent-cell-test.${code}`, message);
}

function supportPayload(input: Readonly<{
  binding: FoundationAgentCellPersistenceBindingV1;
  checkpoint: FoundationExecutionOperationCheckpointV1;
}>): ControlJsonObject {
  return JSON.parse(canonicalJson({
    schema: "lifecycle.agent-execution-cell-support.private.v1",
    binding: input.binding,
    checkpoint: input.checkpoint,
  })) as ControlJsonObject;
}

function retainedSupport(input: Readonly<{
  support: ControlRecordOperationSupport;
  binding: FoundationAgentCellPersistenceBindingV1;
}>): FoundationRetainedExecutionOperationCheckpointV1 {
  if (input.support.supportKind !== SUPPORT_KIND ||
      input.support.storeId !== input.binding.storeId ||
      input.support.processId !== input.binding.processId ||
      input.support.activityId !== input.binding.activityId ||
      input.support.payload.schema !==
        "lifecycle.agent-execution-cell-support.private.v1" ||
      canonicalJson(input.support.payload.binding) !== canonicalJson(input.binding)) {
    return testFailure("support-substitution", "Store support selected another Agent owner");
  }
  const checkpoint = input.support.payload.checkpoint as unknown as
    FoundationExecutionOperationCheckpointV1;
  if (checkpoint === null || typeof checkpoint !== "object" ||
      checkpoint.digest === undefined) {
    return testFailure("support-substitution", "Store support lacks one execution checkpoint");
  }
  return Object.freeze({
    coordinate: Object.freeze({
      revision: input.support.generation,
      checkpointDigest: checkpoint.digest,
      persistenceDigest: digestCanonical({
        bindingDigest: input.binding.digest,
        generation: input.support.generation,
        payloadDigest: input.support.payloadDigest,
      }),
    }),
    checkpoint,
  });
}

function assertExpectedSupport(input: Readonly<{
  current: ControlRecordOperationSupport | null;
  binding: FoundationAgentCellPersistenceBindingV1;
  expected: FoundationExecutionOperationCheckpointCoordinateV1 | null;
}>): void {
  const retained = input.current === null ? null : retainedSupport({
    support: input.current,
    binding: input.binding,
  });
  if (canonicalJson(retained?.coordinate ?? null) !== canonicalJson(input.expected)) {
    testFailure("support-cas", "Agent Activity owner received another support coordinate");
  }
}

function storeActivityOwner(store: ControlRecordStore): FoundationAgentCellActivityOwnerV1 {
  return Object.freeze({
    async read(binding) {
      const support = store.getOperationSupport(binding.activityId);
      return support === null ? null : retainedSupport({ support, binding });
    },
    async commitSupport(input) {
      if (input.binding.storeId !== store.identity.storeId ||
          input.binding.processId !== store.identity.processId) {
        return testFailure("owner", "Agent support owner is not the owning Store");
      }
      const current = store.getOperationSupport(input.binding.activityId);
      assertExpectedSupport({ current, binding: input.binding, expected: input.expected });
      const support = store.putOperationSupport({
        activityId: input.binding.activityId,
        supportKind: SUPPORT_KIND,
        payload: supportPayload(input),
        expected: current === null ? null : Object.freeze({
          generation: current.generation,
          payloadDigest: current.payloadDigest,
        }),
      });
      return retainedSupport({ support, binding: input.binding });
    },
    async ownerCommitDispatch(input) {
      if (canonicalJson(input.attempt.append) !== canonicalJson(input.appends[0]) ||
          input.attempt.revision.recordId !== input.binding.attempt.id ||
          input.attempt.revision.revision !== input.binding.attempt.revision ||
          input.attempt.revision.digest !== input.binding.attempt.digest) {
        return testFailure("owner", "Atomic ownerCommit received another Attempt");
      }
      const current = store.getOperationSupport(input.binding.activityId);
      assert(current !== null);
      assertExpectedSupport({ current, binding: input.binding, expected: input.expected });
      const committed = store.commitOperationBatch({
        supportMutations: Object.freeze([Object.freeze({
          action: "put" as const,
          value: Object.freeze({
            activityId: input.binding.activityId,
            supportKind: SUPPORT_KIND,
            payload: supportPayload(input),
            expected: Object.freeze({
              generation: current.generation,
              payloadDigest: current.payloadDigest,
            }),
          }),
        })]),
        appends: input.appends,
      });
      const support = committed.supportMutations[0]?.support;
      if (support === null || support === undefined || committed.appends.length !== 2) {
        return testFailure("owner", "Atomic ownerCommit did not retain both postconditions");
      }
      const appends = Object.freeze([
        committed.appends[0]!,
        committed.appends[1]!,
      ] as const);
      return Object.freeze({
        retained: retainedSupport({ support, binding: input.binding }),
        appends,
      });
    },
    async ownerCommitPreIntentRefusal(input) {
      const current = store.getOperationSupport(input.binding.activityId);
      assert(current !== null);
      assertExpectedSupport({ current, binding: input.binding, expected: input.expected });
      const committed = store.commitOperationBatch({
        supportMutations: Object.freeze([Object.freeze({
          action: "put" as const,
          value: Object.freeze({
            activityId: input.binding.activityId,
            supportKind: SUPPORT_KIND,
            payload: supportPayload(input),
            expected: Object.freeze({
              generation: current.generation,
              payloadDigest: current.payloadDigest,
            }),
          }),
        })]),
        appends: Object.freeze([input.append]),
      });
      const support = committed.supportMutations[0]?.support;
      const append = committed.appends[0];
      if (support === null || support === undefined || append === undefined ||
          committed.appends.length !== 1) {
        return testFailure("owner", "Atomic refusal did not retain both postconditions");
      }
      return Object.freeze({
        retained: retainedSupport({ support, binding: input.binding }),
        append,
      });
    },
  });
}

function providerResultBytes(input: Readonly<{
  specification: FoundationExecutionSpecificationV1;
  attemptDigest: Sha256;
  executableIdentity: Sha256;
}>): Uint8Array {
  if (input.specification.operation.kind !== "agent-attempt") {
    return testFailure("specification", "Agent provider result received a Check Specification");
  }
  const subject = Object.freeze({
    schema: "lifecycle.agent-execution-cell-provider-result.v1" as const,
    attemptDigest: input.attemptDigest,
    specificationDigest: input.specification.digest,
    providerDescriptorDigest: input.specification.operation.providerDescriptorDigest,
    adapterImplementationDigest: input.specification.operation.adapterImplementationDigest,
    preparedAt: "2026-09-01T00:00:00.010Z",
    startedAt: "2026-09-01T00:00:00.020Z",
    finishedAt: "2026-09-01T00:00:00.030Z",
    executableIdentity: input.executableIdentity,
    outcome: "natural-return" as const,
    stage: "evaluated" as const,
    productiveStarted: true,
    firstTrigger: "natural-return" as const,
    exitCode: 0,
    signal: null,
    sessionId: "agent-cell-test-session",
  });
  return Uint8Array.from(Buffer.from(
    canonicalJsonLine({ ...subject, digest: selfDigest(subject) }),
    "utf8",
  ));
}

function providerTerminalObservationBytes(input: Readonly<{
  specification: FoundationExecutionSpecificationV1;
  attemptDigest: Sha256;
  executableIdentity: Sha256;
  runnerImplementationDigest: Sha256;
}>): Uint8Array {
  if (input.specification.operation.kind !== "agent-attempt") {
    return testFailure("specification", "Agent terminal observation received a Check Specification");
  }
  const subject = Object.freeze({
    schema: "lifecycle.agent-execution-cell-provider-terminal-observation.private.v1" as const,
    attemptDigest: input.attemptDigest,
    specificationDigest: input.specification.digest,
    providerDescriptorDigest: input.specification.operation.providerDescriptorDigest,
    adapterImplementationDigest: input.specification.operation.adapterImplementationDigest,
    imageDigest: input.specification.image.imageDigest,
    runnerContractDigest: input.specification.runner.contractDigest,
    runnerImplementationDigest: input.runnerImplementationDigest,
    preparedAt: "2026-09-01T00:00:00.010Z",
    startedAt: "2026-09-01T00:00:00.020Z",
    finishedAt: "2026-09-01T00:00:00.030Z",
    executableIdentity: input.executableIdentity,
    outcome: "natural-return" as const,
    stage: "evaluated" as const,
    productiveStarted: true,
    firstTrigger: "natural-return" as const,
    exitCode: 0,
    signal: null,
    sessionId: "agent-cell-test-session",
  });
  return Uint8Array.from(Buffer.from(
    canonicalJsonLine({ ...subject, digest: selfDigest(subject) }),
    "utf8",
  ));
}

function providerPreflightFailureObservationBytes(input: Readonly<{
  specification: FoundationExecutionSpecificationV1;
  attemptDigest: Sha256;
  runnerImplementationDigest: Sha256;
}>): Uint8Array {
  if (input.specification.operation.kind !== "agent-attempt") {
    return testFailure("specification", "Agent terminal observation received a Check Specification");
  }
  const subject = Object.freeze({
    schema: "lifecycle.agent-execution-cell-provider-terminal-observation.private.v1" as const,
    attemptDigest: input.attemptDigest,
    specificationDigest: input.specification.digest,
    providerDescriptorDigest: input.specification.operation.providerDescriptorDigest,
    adapterImplementationDigest: input.specification.operation.adapterImplementationDigest,
    imageDigest: input.specification.image.imageDigest,
    runnerContractDigest: input.specification.runner.contractDigest,
    runnerImplementationDigest: input.runnerImplementationDigest,
    preparedAt: "2026-09-01T00:00:00.010Z",
    startedAt: null,
    finishedAt: "2026-09-01T00:00:00.030Z",
    executableIdentity: null,
    outcome: "runtime-failure" as const,
    stage: "preflight" as const,
    productiveStarted: false,
    firstTrigger: "runtime-failure" as const,
    exitCode: null,
    signal: null,
    sessionId: null,
  });
  return Uint8Array.from(Buffer.from(
    canonicalJsonLine({ ...subject, digest: selfDigest(subject) }),
    "utf8",
  ));
}

function executionOutput(input: Readonly<{
  specification: FoundationExecutionSpecificationV1;
  attemptDigest: Sha256;
  executableIdentity: Sha256;
  runnerImplementationDigest: Sha256;
  providerResultOverride?: Uint8Array | null;
  providerTerminalOverride?: Uint8Array | null;
  terminalOnly?: boolean;
}>): FoundationRetrievedExecutionOutputV1 {
  const values = [
    ...(input.providerTerminalOverride === null ? [] : [Object.freeze({
      path: FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.providerTerminalObservationPath,
      purpose: "operational-artifact" as const,
      mediaType:
        FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.providerTerminalObservationMediaType,
      modeClass: "regular" as const,
      bytes: input.providerTerminalOverride ?? providerTerminalObservationBytes(input),
    })]),
    ...(input.terminalOnly === true ? [] : [Object.freeze({
      path: FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.semanticWorkspacePath,
      purpose: "agent-work-product" as const,
      mediaType: FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.semanticWorkspaceMediaType,
      modeClass: "regular" as const,
      bytes: SEMANTIC_BYTES,
    }),
    Object.freeze({
      path: "candidate-output/product.txt",
      purpose: "candidate-output" as const,
      mediaType: "application/octet-stream",
      modeClass: "regular" as const,
      bytes: CANDIDATE_BYTES,
    })]),
    ...(input.terminalOnly === true || input.providerResultOverride === null ? [] : [Object.freeze({
      path: FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.providerResultPath,
      purpose: "raw-provider-output" as const,
      mediaType: FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.providerResultMediaType,
      modeClass: "regular" as const,
      bytes: input.providerResultOverride ?? providerResultBytes(input),
    })]),
  ].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const entries: readonly FoundationExecutionOutputManifestEntryV1[] = Object.freeze(
    values.map((value) => Object.freeze({
      path: value.path,
      entryKind: "file" as const,
      purpose: value.purpose,
      mediaType: value.mediaType,
      modeClass: value.modeClass,
      byteLength: value.bytes.byteLength,
      digest: sha256Bytes(value.bytes),
    })),
  );
  const aggregateByteLength = entries.reduce((sum, value) => sum + value.byteLength, 0);
  const manifestSubject = Object.freeze({
    schema: "lifecycle.execution-output-manifest.v1" as const,
    specificationDigest: input.specification.digest,
    inputSetDigest: input.specification.inputSet.digest,
    imageDigest: input.specification.image.imageDigest,
    outputContractDigest: input.specification.outputContract.digest,
    runnerDigest: input.specification.runner.contractDigest,
    completedAt: "2026-09-01T00:00:00.100Z",
    entries,
    entryCount: entries.length,
    aggregateByteLength,
    entryInventoryDigest: digestCanonical(entries),
  });
  return Object.freeze({
    manifest: Object.freeze({ ...manifestSubject, digest: selfDigest(manifestSubject) }),
    carrierByteLength: aggregateByteLength,
    async *entries() {
      for (let index = 0; index < entries.length; index += 1) {
        const descriptor = entries[index]!;
        const bytes = values[index]!.bytes;
        yield Object.freeze({
          path: descriptor.path,
          byteLength: descriptor.byteLength,
          digest: descriptor.digest,
          async *read() { yield Uint8Array.from(bytes); },
        });
      }
    },
  });
}

function backendProvidingOutput(input: Readonly<{
  engine: InMemoryExecutionBackendEngine;
  installed: FoundationAgentCellInstalledInputsV1;
  attempt: FoundationAgentCellAttemptPreparationV1;
  providerResultOverride?: Uint8Array | null;
  providerTerminalOverride?: Uint8Array | null;
  terminalOnly?: boolean;
}>): FoundationExecutionBackend {
  const delegate = input.engine.facade(input.installed.profile);
  let specification: FoundationExecutionSpecificationV1 | null = null;
  let supplied = false;
  return Object.freeze({
    profile: delegate.profile,
    async allocate(
      selected: FoundationExecutionSpecificationV1,
      allocationKey: Parameters<FoundationExecutionBackend["allocate"]>[1],
    ) {
      specification = selected;
      return await delegate.allocate(selected, allocationKey);
    },
    async dispatch(handle: FoundationExecutionHandle) {
      if (!supplied) {
        assert(specification !== null);
        await input.engine.provideOutput(specification, executionOutput({
          specification,
          attemptDigest: input.attempt.revision.digest,
          executableIdentity: input.installed.provider.installedIdentityDigest,
          runnerImplementationDigest: input.installed.image.runnerImplementationDigest,
          providerResultOverride: input.providerResultOverride,
          providerTerminalOverride: input.providerTerminalOverride,
          terminalOnly: input.terminalOnly,
        }));
        supplied = true;
      }
      return await delegate.dispatch(handle);
    },
    observe: delegate.observe.bind(delegate),
    cancel: delegate.cancel.bind(delegate),
    retrieve: delegate.retrieve.bind(delegate),
    createReclamationBinding: delegate.createReclamationBinding.bind(delegate),
    reclaim: delegate.reclaim.bind(delegate),
  });
}

function publishedCarrier(): FoundationPublishedCandidateOutputCarrierV1 {
  const manifestBytes = jsonBytes({ schema: "agent-cell-published-carrier.test.v1" });
  return Object.freeze({
    objectFormat: "sha1",
    rootTree: "2".repeat(40),
    manifestBytes,
    manifestDigest: sha256Bytes(manifestBytes),
    objectInventoryDigest: digest("agent-cell-published-object-inventory"),
    carrierArtifactDigest: digest("agent-cell-published-carrier-artifact"),
  });
}

type Fixture = {
  workspace: string;
  machineHome: string;
  storeRoot: string;
  store: ControlRecordStore;
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
  selection: BuilderSelection;
  compiledInput: FoundationCompiledAgentCellInputV1;
  installed: FoundationAgentCellInstalledInputsV1;
  attempt: FoundationAgentCellAttemptPreparationV1;
  reclamation: Awaited<ReturnType<typeof openFoundationExecutionReclamationLedgerV1>>;
  clock: ReturnType<typeof operationClock>;
};

async function fixture(t: TestContext, salt: string): Promise<Fixture> {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), `lifecycle-agent-cell-${salt}-`)));
  const machineHome = join(workspace, "machine");
  await mkdir(machineHome, { mode: 0o700 });
  const storeRoot = join(machineHome, "store");
  const seeded = await seedAdmittedStore(storeRoot);
  const selection = openBuilderActivity({
    store: seeded.store,
    boundary: seeded.boundary,
    candidate: seeded.candidate,
    salt,
  });
  const selectedImage = image(salt);
  const compiledInput = await compileBuilderInput({
    ...seeded,
    selection,
    selectedImage,
  });
  const installed = installedInputs({ salt, image: selectedImage, selection });
  const attempt = compileAttempt({
    ...seeded,
    selection,
    compiledInput,
    installed,
  });
  const reclamation = await openFoundationExecutionReclamationLedgerV1({
    machineHome,
    installationId: `installation-agent-cell-${salt}`,
    create: true,
    clock: operationClock("2026-08-31T23:59:59.990Z"),
  });
  const selected: Fixture = {
    workspace,
    machineHome,
    storeRoot,
    store: seeded.store,
    boundary: seeded.boundary,
    candidate: seeded.candidate,
    selection,
    compiledInput,
    installed,
    attempt,
    reclamation,
    clock: operationClock(),
  };
  t.after(async () => {
    try { selected.store.close(); } catch { /* already closed by recovery test */ }
    try { selected.reclamation.close(); } catch { /* exact cleanup is best effort in test */ }
    await rm(workspace, { recursive: true, force: true });
  });
  return selected;
}

function operationInput(input: Readonly<{
  selected: Fixture;
  backend: FoundationExecutionBackend;
  semantic: "valid" | "invalid";
  owner?: FoundationAgentCellActivityOwnerV1;
  revalidateBeforeIntent?: Parameters<
    typeof operateFoundationAgentCellV1
  >[0]["revalidateBeforeIntent"];
  publishCandidateOutput?: NonNullable<
    Parameters<typeof operateFoundationAgentCellV1>[0]["runtime"]["publishCandidateOutput"]
  >;
  registerOperation?: Parameters<
    typeof operateFoundationAgentCellV1
  >[0]["runtime"]["registerOperation"];
}>): Parameters<typeof operateFoundationAgentCellV1>[0] {
  return Object.freeze({
    store: input.selected.store,
    activityId: input.selected.selection.activityId,
    attempt: input.selected.attempt,
    compiledInput: input.selected.compiledInput,
    installed: input.selected.installed,
    activityOwner: input.owner ?? storeActivityOwner(input.selected.store),
    revalidateBeforeIntent: input.revalidateBeforeIntent ?? (async () => undefined),
    validateSemanticOutput: async ({ artifact, specification }) => {
      const reopened = await readFoundationAgentSemanticWorkspaceV1({
        artifact,
        maximumBytes: specification.limits.outputEntryBytes,
      });
      assert.deepEqual(reopened.bytes, SEMANTIC_BYTES);
      return Object.freeze({ disposition: input.semantic });
    },
    runtime: Object.freeze({
      machineHome: input.selected.machineHome,
      backend: input.backend,
      registerOperation: input.registerOperation ?? (() => undefined),
      outputStore: createFoundationExecutionOutputStoreV1({
        machineHome: input.selected.machineHome,
      }),
      reclamation: input.selected.reclamation,
      clock: input.selected.clock,
      pollMilliseconds: 0,
      publishCandidateOutput: input.publishCandidateOutput ?? (async () => publishedCarrier()),
    }),
  });
}

function activityEvents(store: ControlRecordStore, activityId: string) {
  return store.listEvents(0, 10_000).filter((event) => event.payload.activityId === activityId);
}

test("Agent Input Set compilation is deterministic and pre-copy bounded", async (t) => {
  const selected = await fixture(t, "deterministic");
  const manifest = selected.compiledInput.transportEntries.find(
    ({ path }) => path === FOUNDATION_AGENT_EXECUTION_CELL_INPUT_V1.candidateManifestPath,
  );
  const artifact = selected.compiledInput.transportEntries.find(
    ({ path }) => path === FOUNDATION_AGENT_EXECUTION_CELL_INPUT_V1.candidateArtifactPath,
  );
  assert(manifest !== undefined && artifact !== undefined);
  const repeated = await compileBuilderInput({
    store: selected.store,
    boundary: selected.boundary,
    candidate: selected.candidate,
    carrierManifestBytes: manifest.bytes,
    carrierArtifactBytes: artifact.bytes,
    selection: selected.selection,
    selectedImage: selected.installed.image,
  });
  assert.equal(repeated.inputSet.digest, selected.compiledInput.inputSet.digest);
  assert.deepEqual(repeated.inputSet, selected.compiledInput.inputSet);
  assert.deepEqual(
    repeated.transportEntries.map(({ bytes: _bytes, ...entry }) => entry),
    selected.compiledInput.transportEntries.map(({ bytes: _bytes, ...entry }) => entry),
  );

  let suppliedByteReads = 0;
  const singleRead = await compileBuilderInput({
    store: selected.store,
    boundary: selected.boundary,
    candidate: selected.candidate,
    carrierManifestBytes: manifest.bytes,
    carrierArtifactBytes: artifact.bytes,
    selection: selected.selection,
    selectedImage: selected.installed.image,
    transformSubject(subject) {
      if (subject.subject.kind !== "projection") return subject;
      const bytes = subject.bytes;
      return Object.freeze({
        subject: subject.subject,
        get bytes() {
          suppliedByteReads += 1;
          if (suppliedByteReads > 1) throw new Error("Agent input bytes were read more than once");
          return bytes;
        },
        candidateBinding: subject.candidateBinding,
      });
    },
  });
  assert.equal(singleRead.inputSet.digest, selected.compiledInput.inputSet.digest);
  assert.equal(suppliedByteReads, 1);

  const excessive = Object.freeze(Array.from({ length: 65 }, (_, index) =>
    immutableSubject({
      kind: "policy",
      id: `excessive-policy-${index}`,
      digest: sha256Bytes(`excessive-policy-${index}`),
    })));
  await assert.rejects(compileFoundationAgentCellInputV1({
    store: selected.store,
    activityId: selected.selection.activityId,
    role: "builder",
    ownerSubjectDigest: selected.selection.roleSubjectDigest,
    inputMaterialDigest: digest("excessive-input-material"),
    subjects: excessive,
    entries: Object.freeze([immutableEntry({
      path: "bounded.txt",
      purpose: "operation-input",
      mediaType: "text/plain",
      modeClass: "regular",
      sourceSubjectDigest: excessive[0]!.subject.digest,
      bytes: Uint8Array.of(1),
    })]),
    runnerContractDigest: selected.installed.image.runnerContractDigest,
    toolInventoryDigest: selected.installed.image.toolInventoryDigest,
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.agent-execution-cell-v1.input-bound");
});

test("semantic invalidity does not suppress a valid builder successor Carrier", async (t) => {
  const selected = await fixture(t, "semantic-invalid-candidate-valid");
  selected.compiledInput = Object.freeze({
    ...selected.compiledInput,
    candidateObjectFormat: "sha256",
  }) as unknown as FoundationCompiledAgentCellInputV1;
  const engine = new InMemoryExecutionBackendEngine();
  let publications = 0;
  const registration: { value: Readonly<{
    specification: FoundationExecutionSpecificationV1;
    persistence: FoundationExecutionOperationCheckpointPersistenceV1;
  }> | null } = { value: null };
  const backend = backendProvidingOutput({
    engine,
    installed: selected.installed,
    attempt: selected.attempt,
  });
  const result = await operateFoundationAgentCellV1(operationInput({
    selected,
    backend,
    semantic: "invalid",
    registerOperation(value): void { registration.value = value; },
    publishCandidateOutput: async ({ objectFormat, candidateOutput }) => {
      publications += 1;
      assert.equal(objectFormat, "sha1");
      assert.equal(candidateOutput.entries[0]?.candidateRepositoryPath, "product.txt");
      return publishedCarrier();
    },
  }));
  assert.equal(result.terminal.outputValidation, "valid");
  assert.equal(result.semantic.disposition, "invalid");
  assert.equal(result.candidate.disposition, "valid");
  assert.notEqual(result.candidate.carrier, null);
  assert.equal(publications, 1);
  assert.equal(result.providerResult?.outcome, "natural-return");
  assert.equal(result.receiptFacts.provider?.executableIdentity,
    selected.installed.provider.installedIdentityDigest);
  assert.equal(engine.productiveStartCount(result.specification.digest), 1);
  assert.equal(registration.value?.specification.digest, result.specification.digest);
  assert.notEqual(
    await registration.value?.persistence.read(result.specification.digest),
    null,
  );
  const events = activityEvents(selected.store, selected.selection.activityId);
  assert.equal(events.filter(({ eventKind }) => eventKind === "agent-attempt-prepared").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "provider-effect-intended").length, 1);
  assert.deepEqual(
    events.filter(({ eventKind }) => eventKind === "provider-effect-intended")[0]?.payload,
    Object.freeze({
      activityId: selected.selection.activityId,
      effectDigest: result.specification.digest,
    }),
  );
  assert.equal(selected.reclamation.list().length, 1);
});

test("malformed provider result does not suppress semantic or Candidate validation", async (t) => {
  const selected = await fixture(t, "provider-invalid-independent-results");
  const engine = new InMemoryExecutionBackendEngine();
  let publications = 0;
  const result = await operateFoundationAgentCellV1(operationInput({
    selected,
    backend: backendProvidingOutput({
      engine,
      installed: selected.installed,
      attempt: selected.attempt,
      providerResultOverride: jsonBytes({ schema: "malformed-provider-result.test.v1" }),
    }),
    semantic: "valid",
    publishCandidateOutput: async ({ objectFormat }) => {
      publications += 1;
      assert.equal(objectFormat, "sha1");
      return publishedCarrier();
    },
  }));
  assert.equal(result.terminal.outputValidation, "valid");
  assert.equal(result.providerResult, null);
  assert.equal(result.receiptFacts.provider?.outcome, "natural-return");
  assert.equal(result.semantic.disposition, "valid");
  assert.notEqual(result.semantic.artifact, null);
  assert.equal(result.candidate.disposition, "valid");
  assert.notEqual(result.candidate.carrier, null);
  assert.equal(publications, 1);
  assert.equal(engine.productiveStartCount(result.specification.digest), 1);
});

test("missing raw provider result preserves trusted terminal Receipt facts", async (t) => {
  const selected = await fixture(t, "provider-missing-terminal-retained");
  const engine = new InMemoryExecutionBackendEngine();
  const result = await operateFoundationAgentCellV1(operationInput({
    selected,
    backend: backendProvidingOutput({
      engine,
      installed: selected.installed,
      attempt: selected.attempt,
      providerResultOverride: null,
    }),
    semantic: "valid",
    publishCandidateOutput: async () => publishedCarrier(),
  }));
  assert.equal(result.terminal.outputValidation, "valid");
  assert.equal(result.providerResult, null);
  assert.equal(result.receiptFacts.provider?.outcome, "natural-return");
  assert.equal(
    result.receiptFacts.provider?.executableIdentity,
    selected.installed.provider.installedIdentityDigest,
  );
  assert.equal(result.semantic.disposition, "valid");
  assert.equal(result.candidate.disposition, "valid");
  assert.equal(engine.productiveStartCount(result.specification.digest), 1);
});

test("preflight runner failure retains Specification-bound nonproductive Receipt facts", async (t) => {
  const selected = await fixture(t, "provider-preflight-terminal-only");
  const engine = new InMemoryExecutionBackendEngine();
  const result = await operateFoundationAgentCellV1(operationInput({
    selected,
    backend: backendProvidingOutput({
      engine,
      installed: selected.installed,
      attempt: selected.attempt,
      terminalOnly: true,
      providerTerminalOverride: providerPreflightFailureObservationBytes({
        specification: compileFoundationAgentCellSpecificationV1({
          store: selected.store,
          activityId: selected.selection.activityId,
          attempt: selected.attempt,
          compiledInput: selected.compiledInput,
          installed: selected.installed,
        }),
        attemptDigest: selected.attempt.revision.digest,
        runnerImplementationDigest: selected.installed.image.runnerImplementationDigest,
      }),
    }),
    semantic: "valid",
    publishCandidateOutput: async () => assert.fail("preflight failure cannot publish Candidate output"),
  }));
  assert.equal(result.terminal.outputValidation, "valid");
  assert.equal(result.providerResult, null);
  assert.equal(result.receiptFacts.provider?.outcome, "runtime-failure");
  assert.equal(result.receiptFacts.provider?.stage, "preflight");
  assert.equal(result.receiptFacts.provider?.productiveStarted, false);
  assert.equal(result.receiptFacts.provider?.executableIdentity, null);
  assert.equal(result.semantic.disposition, "not-produced");
  assert.equal(result.candidate.disposition, "invalid");
});

test("late output finalization failure preserves provider facts without provisional branches", async (t) => {
  const selected = await fixture(t, "provider-late-terminal-only");
  const engine = new InMemoryExecutionBackendEngine();
  const result = await operateFoundationAgentCellV1(operationInput({
    selected,
    backend: backendProvidingOutput({
      engine,
      installed: selected.installed,
      attempt: selected.attempt,
      terminalOnly: true,
    }),
    semantic: "valid",
    publishCandidateOutput: async () => assert.fail("terminal-only output cannot publish Candidate output"),
  }));
  assert.equal(result.terminal.outputValidation, "valid");
  assert.equal(result.providerResult, null);
  assert.equal(result.receiptFacts.provider?.outcome, "natural-return");
  assert.equal(result.receiptFacts.provider?.productiveStarted, true);
  assert.equal(
    result.receiptFacts.provider?.executableIdentity,
    selected.installed.provider.installedIdentityDigest,
  );
  assert.equal(result.semantic.disposition, "not-produced");
  assert.equal(result.candidate.disposition, "invalid");
});

test("post-dispatch output without the trusted terminal observation fails closed", async (t) => {
  const selected = await fixture(t, "provider-terminal-missing-refusal");
  const engine = new InMemoryExecutionBackendEngine();
  const operation = operationInput({
    selected,
    backend: backendProvidingOutput({
      engine,
      installed: selected.installed,
      attempt: selected.attempt,
      providerTerminalOverride: null,
    }),
    semantic: "valid",
    publishCandidateOutput: async () => publishedCarrier(),
  });
  await assert.rejects(operateFoundationAgentCellV1(operation), (error: unknown) =>
    error instanceof FoundationError &&
    error.code === "lifecycle.agent-execution-cell-v1.provider-terminal-observation");
  const support = selected.store.getOperationSupport(selected.selection.activityId);
  assert.notEqual(support, null);
  const checkpoint = support!.payload.checkpoint as unknown as
    FoundationExecutionOperationCheckpointV1;
  assert.equal(checkpoint.terminalCompletion?.disposition, "invalid");
  assert.notEqual(checkpoint.terminalCompletion?.failureFactsDigest, null);
  assert.equal(checkpoint.output?.validation, "invalid");
  assert.notEqual(checkpoint.retirement, null);
  assert.equal(
    checkpoint.retirement?.terminalCompletionDigest,
    checkpoint.terminalCompletion?.digest,
  );
  assert.equal(selected.reclamation.list().length, 1);
  assert.equal(engine.productiveStartCount(checkpoint.specificationDigest), 1);

  await assert.rejects(operateFoundationAgentCellV1(operation), (error: unknown) =>
    error instanceof FoundationError &&
    error.code === "lifecycle.agent-execution-cell-v1.provider-terminal-observation");
  assert.equal(selected.reclamation.list().length, 1);
  assert.equal(engine.productiveStartCount(checkpoint.specificationDigest), 1);
});

test("authoritative total output loss retires and hands off before provider-fact refusal", async (t) => {
  const selected = await fixture(t, "provider-output-lost-retirement");
  const engine = new InMemoryExecutionBackendEngine();
  const delegate = backendProvidingOutput({
    engine,
    installed: selected.installed,
    attempt: selected.attempt,
  });
  let specification: FoundationExecutionSpecificationV1 | null = null;
  let dispatches = 0;
  const backend: FoundationExecutionBackend = Object.freeze({
    profile: delegate.profile,
    async allocate(
      value: FoundationExecutionSpecificationV1,
      allocationKey: Parameters<FoundationExecutionBackend["allocate"]>[1],
    ) {
      specification = value;
      return await delegate.allocate(value, allocationKey);
    },
    async dispatch(handle: FoundationExecutionHandle) {
      dispatches += 1;
      return await delegate.dispatch(handle);
    },
    observe: delegate.observe.bind(delegate),
    cancel: delegate.cancel.bind(delegate),
    async retrieve(
      handle: FoundationExecutionHandle,
      observation: Parameters<FoundationExecutionBackend["retrieve"]>[1],
    ) {
      assert.notEqual(specification, null);
      return compileFoundationExecutionRetrievalOutcome({
        specification: specification!,
        handle,
        observation,
        disposition: "unavailable",
        unavailableReason: "lost",
      });
    },
    createReclamationBinding: delegate.createReclamationBinding.bind(delegate),
    reclaim: delegate.reclaim.bind(delegate),
  });
  const operation = operationInput({
    selected,
    backend,
    semantic: "valid",
    publishCandidateOutput: async () => assert.fail("Lost output cannot publish a Candidate"),
  });

  await assert.rejects(operateFoundationAgentCellV1(operation), (error: unknown) =>
    error instanceof FoundationError &&
    error.code === "lifecycle.agent-execution-cell-v1.provider-terminal-observation");
  const support = selected.store.getOperationSupport(selected.selection.activityId);
  assert.notEqual(support, null);
  const checkpoint = support!.payload.checkpoint as unknown as
    FoundationExecutionOperationCheckpointV1;
  assert.equal(checkpoint.output?.validation, "unavailable");
  assert.equal(checkpoint.terminalCompletion, null);
  assert.notEqual(checkpoint.retirement, null);
  assert.equal(checkpoint.retirement?.terminalCompletionDigest, null);
  assert.equal(selected.reclamation.list().length, 1);
  assert.equal(dispatches, 1);
  assert.equal(engine.productiveStartCount(checkpoint.specificationDigest), 1);

  await assert.rejects(operateFoundationAgentCellV1(operation), (error: unknown) =>
    error instanceof FoundationError &&
    error.code === "lifecycle.agent-execution-cell-v1.provider-terminal-observation");
  assert.equal(selected.reclamation.list().length, 1);
  assert.equal(dispatches, 1);
  assert.equal(engine.productiveStartCount(checkpoint.specificationDigest), 1);
});

test("malformed terminal bytes retain invalid outcome and retire without redispatch", async (t) => {
  const selected = await fixture(t, "provider-terminal-bytes-invalid-retirement");
  const engine = new InMemoryExecutionBackendEngine();
  const delegate = backendProvidingOutput({
    engine,
    installed: selected.installed,
    attempt: selected.attempt,
  });
  let dispatches = 0;
  const backend: FoundationExecutionBackend = Object.freeze({
    profile: delegate.profile,
    allocate: delegate.allocate.bind(delegate),
    async dispatch(handle: FoundationExecutionHandle) {
      dispatches += 1;
      return await delegate.dispatch(handle);
    },
    observe: delegate.observe.bind(delegate),
    cancel: delegate.cancel.bind(delegate),
    async retrieve(
      handle: FoundationExecutionHandle,
      observation: Parameters<FoundationExecutionBackend["retrieve"]>[1],
    ) {
      const retrieved = await delegate.retrieve(handle, observation);
      assert.equal(retrieved.disposition, "complete");
      const source = retrieved.output;
      return Object.freeze({
        ...retrieved,
        output: Object.freeze({
          manifest: source.manifest,
          carrierByteLength: source.carrierByteLength,
          async *entries() {
            for await (const reader of source.entries()) {
              if (reader.path !==
                  FOUNDATION_AGENT_EXECUTION_CELL_OPERATION_V1.providerTerminalObservationPath) {
                yield reader;
                continue;
              }
              yield Object.freeze({
                path: reader.path,
                byteLength: reader.byteLength,
                digest: reader.digest,
                async *read() {
                  yield new Uint8Array(0);
                  yield* reader.read();
                },
              });
            }
          },
        }),
      });
    },
    createReclamationBinding: delegate.createReclamationBinding.bind(delegate),
    reclaim: delegate.reclaim.bind(delegate),
  });
  const operation = operationInput({
    selected,
    backend,
    semantic: "valid",
    publishCandidateOutput: async () => assert.fail("Invalid terminal output cannot publish"),
  });

  await assert.rejects(operateFoundationAgentCellV1(operation), (error: unknown) =>
    error instanceof FoundationError &&
    error.code === "lifecycle.agent-execution-cell-v1.provider-terminal-observation");
  const support = selected.store.getOperationSupport(selected.selection.activityId);
  assert.notEqual(support, null);
  const checkpoint = support!.payload.checkpoint as unknown as
    FoundationExecutionOperationCheckpointV1;
  assert.equal(checkpoint.terminalCompletion?.disposition, "invalid");
  assert.notEqual(checkpoint.terminalCompletion?.failureFactsDigest, null);
  assert.equal(checkpoint.output?.validation, "invalid");
  assert.notEqual(checkpoint.retirement, null);
  assert.equal(selected.reclamation.list().length, 1);
  assert.equal(dispatches, 1);

  await assert.rejects(operateFoundationAgentCellV1(operation), (error: unknown) =>
    error instanceof FoundationError &&
    error.code === "lifecycle.agent-execution-cell-v1.provider-terminal-observation");
  assert.equal(selected.reclamation.list().length, 1);
  assert.equal(dispatches, 1);
});

test("terminal observation binds its single Manifest snapshot to the retained observation", async (t) => {
  const selected = await fixture(t, "provider-terminal-manifest-snapshot");
  const specification = compileFoundationAgentCellSpecificationV1({
    store: selected.store,
    activityId: selected.selection.activityId,
    attempt: selected.attempt,
    compiledInput: selected.compiledInput,
    installed: selected.installed,
  });
  const source = executionOutput({
    specification,
    attemptDigest: selected.attempt.revision.digest,
    executableIdentity: selected.installed.provider.installedIdentityDigest,
    runnerImplementationDigest: selected.installed.image.runnerImplementationDigest,
  });
  const firstManifest = source.manifest;
  const { digest: _firstDigest, ...changedManifestSubject } = firstManifest;
  const changedManifest = Object.freeze({
    ...changedManifestSubject,
    completedAt: "2026-09-01T00:00:00.101Z",
    digest: selfDigest({
      ...changedManifestSubject,
      completedAt: "2026-09-01T00:00:00.101Z",
    }),
  });
  let manifestReads = 0;
  const changingOutput: FoundationRetrievedExecutionOutputV1 = Object.freeze({
    get manifest() {
      manifestReads += 1;
      return manifestReads === 1 ? firstManifest : changedManifest;
    },
    carrierByteLength: source.carrierByteLength,
    entries: source.entries.bind(source),
  });
  const expectedManifestDigest = changingOutput.manifest.digest;

  await assert.rejects(observeFoundationAgentProviderTerminalCompletionV1({
    output: changingOutput,
    specification,
    expectedManifestDigest,
    attemptDigest: selected.attempt.revision.digest,
    executableIdentity: selected.installed.provider.installedIdentityDigest,
    runnerImplementationDigest: selected.installed.image.runnerImplementationDigest,
  }), (error: unknown) => error instanceof FoundationError &&
    error.code ===
      "lifecycle.agent-execution-cell-operation-v1.provider-terminal-observation");
  assert.equal(manifestReads, 2);
});

test("invalid authoring Carrier preserves terminal facts and recovers without redispatch", async (t) => {
  const selected = await fixture(t, "invalid-authoring-terminal-recovery");
  let engine = new InMemoryExecutionBackendEngine();
  let dispatchCalls = 0;
  let publications = 0;
  const counted = (
    delegate: FoundationExecutionBackend,
    injectInvalidCandidateChunk = false,
  ): FoundationExecutionBackend =>
    Object.freeze({
      profile: delegate.profile,
      allocate: delegate.allocate.bind(delegate),
      async dispatch(handle: FoundationExecutionHandle) {
        dispatchCalls += 1;
        return await delegate.dispatch(handle);
      },
      observe: delegate.observe.bind(delegate),
      cancel: delegate.cancel.bind(delegate),
      async retrieve(
        handle: Parameters<FoundationExecutionBackend["retrieve"]>[0],
        observation: Parameters<FoundationExecutionBackend["retrieve"]>[1],
      ) {
        const retrieved = await delegate.retrieve(handle, observation);
        if (!injectInvalidCandidateChunk || retrieved.disposition !== "complete") {
          return retrieved;
        }
        const source = retrieved.output;
        return Object.freeze({
          ...retrieved,
          output: Object.freeze({
            manifest: source.manifest,
            carrierByteLength: source.carrierByteLength,
            async *entries() {
              for await (const reader of source.entries()) {
                if (!reader.path.startsWith("candidate-output/")) {
                  yield reader;
                  continue;
                }
                yield Object.freeze({
                  path: reader.path,
                  byteLength: reader.byteLength,
                  digest: reader.digest,
                  async *read() {
                    yield new Uint8Array(0);
                    yield* reader.read();
                  },
                });
              }
            },
          }),
        });
      },
      createReclamationBinding: delegate.createReclamationBinding.bind(delegate),
      reclaim: delegate.reclaim.bind(delegate),
    });
  const first = await operateFoundationAgentCellV1(operationInput({
    selected,
    backend: counted(backendProvidingOutput({
      engine,
      installed: selected.installed,
      attempt: selected.attempt,
    }), true),
    semantic: "valid",
    publishCandidateOutput: async () => {
      publications += 1;
      return publishedCarrier();
    },
  }));
  assert.equal(first.terminal.outputValidation, "invalid");
  assert.equal(first.validatedOutput, null);
  assert.deepEqual(first.receiptFacts.execution.output, {
    availability: "unavailable",
    carrierByteLength: null,
    carrierDigest: null,
    manifestDigest: null,
  });
  assert.equal(first.receiptFacts.provider?.outcome, "natural-return");
  assert.equal(first.receiptFacts.provider?.stage, "evaluated");
  assert.equal(first.receiptFacts.provider?.productiveStarted, true);
  assert.equal(first.receiptFacts.provider?.exitCode, 0);
  assert.equal(first.receiptFacts.provider?.sessionId, "agent-cell-test-session");
  assert.equal(
    first.receiptFacts.provider?.executableIdentity,
    selected.installed.provider.installedIdentityDigest,
  );
  assert.equal(first.providerResult, null);
  assert.equal(first.semantic.disposition, "unavailable");
  assert.equal(first.candidate.disposition, "unavailable");
  assert.equal(first.candidate.carrier, null);
  assert.equal(publications, 0);
  assert.equal(dispatchCalls, 1);
  assert.equal(engine.productiveStartCount(first.specification.digest), 1);
  assert.equal(selected.reclamation.list().length, 1);
  const firstSupport = selected.store.getOperationSupport(selected.selection.activityId);
  assert(firstSupport !== null);
  const firstCheckpoint = firstSupport.payload.checkpoint as unknown as
    FoundationExecutionOperationCheckpointV1;
  assert.notEqual(firstCheckpoint.handle, null);
  assert.notEqual(firstCheckpoint.terminalCompletion, null);
  assert.equal(firstCheckpoint.output?.validation, "invalid");
  assert.notEqual(firstCheckpoint.output?.failureFactsDigest, null);
  assert.notEqual(firstCheckpoint.retirement, null);
  assert.equal(firstCheckpoint.retirement?.dispatchAuthorityConsumed, true);
  assert.equal(
    firstCheckpoint.retirement?.terminalCompletionDigest,
    firstCheckpoint.terminalCompletion?.digest,
  );

  const identity = selected.store.identity;
  selected.store.close();
  selected.store = await openControlRecordStore({
    root: selected.storeRoot,
    identity,
    create: false,
  });
  engine = InMemoryExecutionBackendEngine.reload(engine.snapshot(), selected.installed.profile);
  const recovered = await operateFoundationAgentCellV1(operationInput({
    selected,
    backend: counted(backendProvidingOutput({
      engine,
      installed: selected.installed,
      attempt: selected.attempt,
    })),
    semantic: "valid",
    publishCandidateOutput: async () => {
      publications += 1;
      return publishedCarrier();
    },
  }));
  assert.deepEqual(recovered.receiptFacts, first.receiptFacts);
  assert.deepEqual(recovered.terminal, first.terminal);
  assert.equal(dispatchCalls, 1);
  assert.equal(publications, 0);
  assert.equal(engine.productiveStartCount(first.specification.digest), 1);
  assert.equal(selected.reclamation.list().length, 1);
  const recoveredSupport = selected.store.getOperationSupport(selected.selection.activityId);
  assert(recoveredSupport !== null);
  const recoveredCheckpoint = recoveredSupport.payload.checkpoint as unknown as
    FoundationExecutionOperationCheckpointV1;
  assert.equal(recoveredCheckpoint.handle, firstCheckpoint.handle);
  assert.equal(
    recoveredCheckpoint.terminalCompletion?.digest,
    firstCheckpoint.terminalCompletion?.digest,
  );
  assert.equal(recoveredCheckpoint.output?.digest, firstCheckpoint.output?.digest);
  assert.equal(recoveredCheckpoint.retirement?.digest, firstCheckpoint.retirement?.digest);
  const events = activityEvents(selected.store, selected.selection.activityId);
  assert.equal(events.filter(({ eventKind }) => eventKind === "agent-attempt-prepared").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "provider-effect-intended").length, 1);
  const reclaimed = await selected.reclamation.runNext({
    reclaim: async (handoff) => await engine.facade(selected.installed.profile).reclaim(
      handoff.specification,
      handoff.reclamationBinding,
      handoff.obligation,
    ),
  });
  assert.equal(reclaimed?.standing.state, "reclaimed");
});

test("Candidate Carrier invalidity does not suppress a valid semantic Work Product", async (t) => {
  const selected = await fixture(t, "semantic-valid-candidate-invalid");
  const engine = new InMemoryExecutionBackendEngine();
  const backend = backendProvidingOutput({
    engine,
    installed: selected.installed,
    attempt: selected.attempt,
  });
  const result = await operateFoundationAgentCellV1(operationInput({
    selected,
    backend,
    semantic: "valid",
    publishCandidateOutput: async () => {
      throw new FoundationError(
        "lifecycle.candidate.output-carrier-invalid",
        "Injected invalid Candidate output",
      );
    },
  }));
  assert.equal(result.terminal.outputValidation, "valid");
  assert.equal(result.semantic.disposition, "valid");
  assert.notEqual(result.semantic.artifact, null);
  assert.equal(result.candidate.disposition, "invalid");
  assert.equal(result.candidate.carrier, null);
  assert.equal(result.receiptFacts.execution.specificationDigest, result.specification.digest);
  assert.equal(engine.productiveStartCount(result.specification.digest), 1);
});

test("lost pre-intent refusal response recovers the same inert Cell through Retirement", async (t) => {
  const selected = await fixture(t, "pre-intent-refusal-recovery");
  const engine = new InMemoryExecutionBackendEngine();
  const backend = backendProvidingOutput({
    engine,
    installed: selected.installed,
    attempt: selected.attempt,
  });
  const delegate = storeActivityOwner(selected.store);
  let lostResponse = false;
  let revalidations = 0;
  const owner: FoundationAgentCellActivityOwnerV1 = Object.freeze({
    read: delegate.read.bind(delegate),
    commitSupport: delegate.commitSupport.bind(delegate),
    ownerCommitDispatch: delegate.ownerCommitDispatch.bind(delegate),
    async ownerCommitPreIntentRefusal(input) {
      const result = await delegate.ownerCommitPreIntentRefusal(input);
      if (!lostResponse) {
        lostResponse = true;
        throw new Error("Injected lost atomic refusal response");
      }
      return result;
    },
  });
  const revalidateBeforeIntent = async (): Promise<void> => {
    revalidations += 1;
    throw new FoundationError(
      "lifecycle.agent-cell-test.pre-intent-drift",
      "Injected exact input drift at the last pre-intent boundary",
    );
  };
  await assert.rejects(operateFoundationAgentCellV1(operationInput({
    selected,
    backend,
    semantic: "valid",
    owner,
    revalidateBeforeIntent,
  })), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.execution.operation-host.persistence");
  const interrupted = selected.store.getOperationSupport(selected.selection.activityId);
  assert(interrupted !== null);
  const interruptedCheckpoint = interrupted.payload.checkpoint as unknown as
    FoundationExecutionOperationCheckpointV1;
  assert.notEqual(interruptedCheckpoint.handle, null);
  assert.equal(interruptedCheckpoint.dispatchAuthorityConsumedAt, null);
  assert.notEqual(interruptedCheckpoint.containmentRequestedAt, null);
  assert.notEqual(interruptedCheckpoint.containment, null);
  assert.equal(interruptedCheckpoint.output, null);
  assert.equal(interruptedCheckpoint.retirement, null);
  const handle = interruptedCheckpoint.handle;
  assert.equal(selected.store.getRevision(
    selected.attempt.revision.recordId,
    selected.attempt.revision.revision,
  ), null);
  assert.equal(selected.reclamation.list().length, 0);

  const result = await operateFoundationAgentCellV1(operationInput({
    selected,
    backend,
    semantic: "valid",
    owner,
    revalidateBeforeIntent,
  }));
  assert.equal(result.preIntentRefused, true);
  assert.equal(result.terminal.outputValidation, "not-applicable");
  assert.equal(result.providerResult, null);
  assert.equal(result.semantic.disposition, "unavailable");
  assert.equal(result.candidate.disposition, "unavailable");
  assert.equal(engine.productiveStartCount(result.specification.digest), 0);
  assert.equal(engine.snapshot().allocations.length, 1);
  assert.equal(revalidations, 1);
  const recovered = selected.store.getOperationSupport(selected.selection.activityId);
  assert(recovered !== null);
  const recoveredCheckpoint = recovered.payload.checkpoint as unknown as
    FoundationExecutionOperationCheckpointV1;
  assert.equal(recoveredCheckpoint.handle, handle);
  assert.notEqual(recoveredCheckpoint.retirement, null);
  assert.equal(recoveredCheckpoint.retirement?.dispatchAuthorityConsumed, false);
  const events = activityEvents(selected.store, selected.selection.activityId);
  assert.equal(events.filter(({ eventKind }) => eventKind === "agent-pre-intent-refused").length, 1);
  assert.equal(events.filter(({ eventKind }) => eventKind === "agent-attempt-prepared").length, 0);
  assert.equal(events.filter(({ eventKind }) => eventKind === "provider-effect-intended").length, 0);
  assert.equal(selected.reclamation.list().length, 1);
});

test("atomic ownerCommit is mandatory and retained support refuses an alternate Specification", async (t) => {
  const selected = await fixture(t, "atomic-owner");
  const engine = new InMemoryExecutionBackendEngine();
  const specification = compileFoundationAgentCellSpecificationV1({
    store: selected.store,
    activityId: selected.selection.activityId,
    attempt: selected.attempt,
    compiledInput: selected.compiledInput,
    installed: selected.installed,
  });
  const delegate = storeActivityOwner(selected.store);
  const refusingOwner: FoundationAgentCellActivityOwnerV1 = Object.freeze({
    read: delegate.read.bind(delegate),
    commitSupport: delegate.commitSupport.bind(delegate),
    async ownerCommitDispatch() {
      throw new Error("ownerCommit intentionally unavailable");
    },
    ownerCommitPreIntentRefusal: delegate.ownerCommitPreIntentRefusal.bind(delegate),
  });
  await assert.rejects(operateFoundationAgentCellV1(operationInput({
    selected,
    backend: backendProvidingOutput({
      engine,
      installed: selected.installed,
      attempt: selected.attempt,
    }),
    semantic: "valid",
    owner: refusingOwner,
  })), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.execution.operation-host.persistence");
  assert.equal(engine.productiveStartCount(specification.digest), 0);
  assert.equal(selected.store.getRevision(
    selected.attempt.revision.recordId,
    selected.attempt.revision.revision,
  ), null);
  assert.equal(activityEvents(selected.store, selected.selection.activityId).filter(
    ({ eventKind }) => eventKind === "provider-effect-intended",
  ).length, 0);
  const support = selected.store.getOperationSupport(selected.selection.activityId);
  assert(support !== null);
  const checkpoint = support.payload.checkpoint as unknown as
    FoundationExecutionOperationCheckpointV1;
  assert.notEqual(checkpoint.handle, null);
  assert.equal(checkpoint.dispatchAuthorityConsumedAt, null);

  const alternateInstalled = installedInputs({
    salt: "atomic-owner",
    image: selected.installed.image,
    selection: selected.selection,
    adapterDigest: digest("agent-cell-alternate-adapter"),
  });
  selected.installed = alternateInstalled;
  await assert.rejects(operateFoundationAgentCellV1(operationInput({
    selected,
    backend: backendProvidingOutput({
      engine,
      installed: alternateInstalled,
      attempt: selected.attempt,
    }),
    semantic: "valid",
  })), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.execution.operation-host.persistence");
  assert.equal(engine.snapshot().allocations.length, 1);
  assert.equal(engine.snapshot().allocations[0]?.productiveStarts, 0);
});

test("lost dispatch response recovers the same Handle and never redispatches", async (t) => {
  const selected = await fixture(t, "same-handle-recovery");
  let engine = new InMemoryExecutionBackendEngine();
  engine.armFault("dispatch-after-start-before-return");
  const specification = compileFoundationAgentCellSpecificationV1({
    store: selected.store,
    activityId: selected.selection.activityId,
    attempt: selected.attempt,
    compiledInput: selected.compiledInput,
    installed: selected.installed,
  });
  await assert.rejects(operateFoundationAgentCellV1(operationInput({
    selected,
    backend: backendProvidingOutput({
      engine,
      installed: selected.installed,
      attempt: selected.attempt,
    }),
    semantic: "valid",
  })), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.execution.operation-host.backend-interrupted");
  const interruptedSupport = selected.store.getOperationSupport(selected.selection.activityId);
  assert(interruptedSupport !== null);
  const interruptedCheckpoint = interruptedSupport.payload.checkpoint as unknown as
    FoundationExecutionOperationCheckpointV1;
  assert.notEqual(interruptedCheckpoint.handle, null);
  assert.notEqual(interruptedCheckpoint.dispatchAuthorityConsumedAt, null);
  const handle = interruptedCheckpoint.handle;
  const beforeEvents = activityEvents(selected.store, selected.selection.activityId);
  assert.equal(beforeEvents.filter(({ eventKind }) => eventKind === "agent-attempt-prepared").length, 1);
  assert.equal(beforeEvents.filter(({ eventKind }) => eventKind === "provider-effect-intended").length, 1);
  assert.equal(engine.productiveStartCount(specification.digest), 1);

  const identity = selected.store.identity;
  selected.store.close();
  selected.store = await openControlRecordStore({
    root: selected.storeRoot,
    identity,
    create: false,
  });
  engine = InMemoryExecutionBackendEngine.reload(engine.snapshot(), selected.installed.profile);
  const result = await operateFoundationAgentCellV1(operationInput({
    selected,
    backend: backendProvidingOutput({
      engine,
      installed: selected.installed,
      attempt: selected.attempt,
    }),
    semantic: "valid",
  }));
  const recoveredSupport = selected.store.getOperationSupport(selected.selection.activityId);
  assert(recoveredSupport !== null);
  const recoveredCheckpoint = recoveredSupport.payload.checkpoint as unknown as
    FoundationExecutionOperationCheckpointV1;
  assert.equal(recoveredCheckpoint.handle, handle);
  assert.equal(result.specification.digest, specification.digest);
  assert.equal(result.terminal.outputValidation, "valid");
  assert.equal(result.semantic.disposition, "valid");
  assert.equal(result.candidate.disposition, "valid");
  assert.equal(engine.productiveStartCount(specification.digest), 1);
  const afterEvents = activityEvents(selected.store, selected.selection.activityId);
  assert.equal(afterEvents.filter(({ eventKind }) => eventKind === "agent-attempt-prepared").length, 1);
  assert.equal(afterEvents.filter(({ eventKind }) => eventKind === "provider-effect-intended").length, 1);
  assert.equal(selected.reclamation.list().length, 1);
  const reclaimed = await selected.reclamation.runNext({
    reclaim: async (handoff) => await engine.facade(selected.installed.profile).reclaim(
      handoff.specification,
      handoff.reclamationBinding,
      handoff.obligation,
    ),
  });
  assert.equal(reclaimed?.standing.state, "reclaimed");
});

test("interruption after intent but before Backend entry finalizes the exact not-started Attempt", async (t) => {
  const selected = await fixture(t, "before-backend-entry");
  let engine = new InMemoryExecutionBackendEngine();
  const specification = compileFoundationAgentCellSpecificationV1({
    store: selected.store,
    activityId: selected.selection.activityId,
    attempt: selected.attempt,
    compiledInput: selected.compiledInput,
    installed: selected.installed,
  });
  let dispatchCalls = 0;
  const interruptedDelegate = engine.facade(selected.installed.profile);
  const interruptedBackend: FoundationExecutionBackend = Object.freeze({
    profile: interruptedDelegate.profile,
    allocate: interruptedDelegate.allocate.bind(interruptedDelegate),
    async dispatch() {
      dispatchCalls += 1;
      throw new Error("interrupted before Backend dispatch entry");
    },
    observe: interruptedDelegate.observe.bind(interruptedDelegate),
    cancel: interruptedDelegate.cancel.bind(interruptedDelegate),
    retrieve: interruptedDelegate.retrieve.bind(interruptedDelegate),
    createReclamationBinding: interruptedDelegate.createReclamationBinding.bind(interruptedDelegate),
    reclaim: interruptedDelegate.reclaim.bind(interruptedDelegate),
  });
  await assert.rejects(operateFoundationAgentCellV1(operationInput({
    selected,
    backend: interruptedBackend,
    semantic: "valid",
  })), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.execution.operation-host.backend-interrupted");
  const interruptedSupport = selected.store.getOperationSupport(selected.selection.activityId);
  assert(interruptedSupport !== null);
  const interruptedCheckpoint = interruptedSupport.payload.checkpoint as unknown as
    FoundationExecutionOperationCheckpointV1;
  assert.notEqual(interruptedCheckpoint.handle, null);
  assert.notEqual(interruptedCheckpoint.dispatchAuthorityConsumedAt, null);
  const handle = interruptedCheckpoint.handle;
  assert.equal(engine.productiveStartCount(specification.digest), 0);

  const identity = selected.store.identity;
  selected.store.close();
  selected.store = await openControlRecordStore({
    root: selected.storeRoot,
    identity,
    create: false,
  });
  engine = InMemoryExecutionBackendEngine.reload(engine.snapshot(), selected.installed.profile);
  const recoveredDelegate = engine.facade(selected.installed.profile);
  const recoveredBackend: FoundationExecutionBackend = Object.freeze({
    profile: recoveredDelegate.profile,
    allocate: recoveredDelegate.allocate.bind(recoveredDelegate),
    async dispatch(selectedHandle: FoundationExecutionHandle) {
      dispatchCalls += 1;
      return await recoveredDelegate.dispatch(selectedHandle);
    },
    observe: recoveredDelegate.observe.bind(recoveredDelegate),
    cancel: recoveredDelegate.cancel.bind(recoveredDelegate),
    retrieve: recoveredDelegate.retrieve.bind(recoveredDelegate),
    createReclamationBinding: recoveredDelegate.createReclamationBinding.bind(recoveredDelegate),
    reclaim: recoveredDelegate.reclaim.bind(recoveredDelegate),
  });
  const result = await operateFoundationAgentCellV1(operationInput({
    selected,
    backend: recoveredBackend,
    semantic: "valid",
  }));
  assert.equal(result.providerResult, null);
  assert.equal(result.receiptFacts.provider?.outcome, "runtime-failure");
  assert.equal(result.receiptFacts.provider?.stage, "dispatch");
  assert.equal(result.receiptFacts.provider?.productiveStarted, false);
  assert.equal(result.receiptFacts.provider?.executableIdentity, null);
  assert.equal(result.terminal.outputValidation, "not-applicable");
  assert.equal(result.semantic.disposition, "unavailable");
  assert.equal(result.candidate.disposition, "unavailable");
  assert.equal(dispatchCalls, 1);
  assert.equal(engine.productiveStartCount(specification.digest), 0);
  const recoveredSupport = selected.store.getOperationSupport(selected.selection.activityId);
  assert(recoveredSupport !== null);
  const recoveredCheckpoint = recoveredSupport.payload.checkpoint as unknown as
    FoundationExecutionOperationCheckpointV1;
  assert.equal(recoveredCheckpoint.handle, handle);
  assert.notEqual(recoveredCheckpoint.retirement, null);
  assert.equal(recoveredCheckpoint.retirement?.dispatchAuthorityConsumed, true);
  assert.equal(selected.reclamation.list().length, 1);
  const reclaimed = await selected.reclamation.runNext({
    reclaim: async (handoff) => await recoveredDelegate.reclaim(
      handoff.specification,
      handoff.reclamationBinding,
      handoff.obligation,
    ),
  });
  assert.equal(reclaimed?.standing.state, "reclaimed");
});

test("interruption after Backend dispatch acceptance but before provider start finalizes without redispatch", async (t) => {
  const selected = await fixture(t, "after-dispatch-before-start");
  let engine = new InMemoryExecutionBackendEngine();
  const specification = compileFoundationAgentCellSpecificationV1({
    store: selected.store,
    activityId: selected.selection.activityId,
    attempt: selected.attempt,
    compiledInput: selected.compiledInput,
    installed: selected.installed,
  });
  engine.armFault("dispatch-before-start");
  await assert.rejects(operateFoundationAgentCellV1(operationInput({
    selected,
    backend: engine.facade(selected.installed.profile),
    semantic: "valid",
  })), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.execution.operation-host.backend-interrupted");
  const interruptedSupport = selected.store.getOperationSupport(selected.selection.activityId);
  assert(interruptedSupport !== null);
  const interruptedCheckpoint = interruptedSupport.payload.checkpoint as unknown as
    FoundationExecutionOperationCheckpointV1;
  assert.notEqual(interruptedCheckpoint.handle, null);
  assert.notEqual(interruptedCheckpoint.dispatchAuthorityConsumedAt, null);
  const handle = interruptedCheckpoint.handle;
  const direct = await engine.facade(selected.installed.profile).observe(handle!);
  assert.equal(direct.dispatchState, "accepted");
  assert.equal(direct.processState, "not-started");
  assert.equal(engine.productiveStartCount(specification.digest), 0);

  const identity = selected.store.identity;
  selected.store.close();
  selected.store = await openControlRecordStore({
    root: selected.storeRoot,
    identity,
    create: false,
  });
  engine = InMemoryExecutionBackendEngine.reload(engine.snapshot(), selected.installed.profile);
  let dispatchCalls = 0;
  const delegate = engine.facade(selected.installed.profile);
  const recoveredBackend: FoundationExecutionBackend = Object.freeze({
    profile: delegate.profile,
    allocate: delegate.allocate.bind(delegate),
    async dispatch(selectedHandle: FoundationExecutionHandle) {
      dispatchCalls += 1;
      return await delegate.dispatch(selectedHandle);
    },
    observe: delegate.observe.bind(delegate),
    cancel: delegate.cancel.bind(delegate),
    retrieve: delegate.retrieve.bind(delegate),
    createReclamationBinding: delegate.createReclamationBinding.bind(delegate),
    reclaim: delegate.reclaim.bind(delegate),
  });
  const result = await operateFoundationAgentCellV1(operationInput({
    selected,
    backend: recoveredBackend,
    semantic: "valid",
  }));
  assert.equal(result.providerResult, null);
  assert.equal(result.receiptFacts.provider?.outcome, "runtime-failure");
  assert.equal(result.receiptFacts.provider?.stage, "dispatch");
  assert.equal(result.receiptFacts.provider?.productiveStarted, false);
  assert.equal(result.receiptFacts.provider?.executableIdentity, null);
  assert.equal(result.terminal.outputValidation, "not-applicable");
  assert.equal(result.semantic.disposition, "unavailable");
  assert.equal(result.candidate.disposition, "unavailable");
  assert.equal(dispatchCalls, 0);
  assert.equal(engine.productiveStartCount(specification.digest), 0);
  const recoveredSupport = selected.store.getOperationSupport(selected.selection.activityId);
  assert(recoveredSupport !== null);
  const recoveredCheckpoint = recoveredSupport.payload.checkpoint as unknown as
    FoundationExecutionOperationCheckpointV1;
  assert.equal(recoveredCheckpoint.handle, handle);
  assert.equal(recoveredCheckpoint.observation?.dispatchState, "accepted");
  assert.equal(recoveredCheckpoint.containment?.backendEffectObserved, true);
  assert.notEqual(recoveredCheckpoint.retirement, null);
  assert.equal(recoveredCheckpoint.retirement?.dispatchAuthorityConsumed, true);
  assert.equal(selected.reclamation.list().length, 1);
  const reclaimed = await selected.reclamation.runNext({
    reclaim: async (handoff) => await delegate.reclaim(
      handoff.specification,
      handoff.reclamationBinding,
      handoff.obligation,
    ),
  });
  assert.equal(reclaimed?.standing.state, "reclaimed");
});

test("parent loss is contained, retired, reclaimed, and never redispatched", async (t) => {
  const selected = await fixture(t, "parent-loss");
  const engine = new InMemoryExecutionBackendEngine();
  const specification = compileFoundationAgentCellSpecificationV1({
    store: selected.store,
    activityId: selected.selection.activityId,
    attempt: selected.attempt,
    compiledInput: selected.compiledInput,
    installed: selected.installed,
  });
  engine.holdOpen(specification.digest);
  const delegate = backendProvidingOutput({
    engine,
    installed: selected.installed,
    attempt: selected.attempt,
  });
  let dispatchCalls = 0;
  const backend: FoundationExecutionBackend = Object.freeze({
    profile: delegate.profile,
    allocate: delegate.allocate.bind(delegate),
    async dispatch(handle: FoundationExecutionHandle) {
      dispatchCalls += 1;
      const running = await delegate.dispatch(handle);
      assert.equal(running.processState, "running");
      engine.reportParentLoss(specification.digest);
      return running;
    },
    observe: delegate.observe.bind(delegate),
    cancel: delegate.cancel.bind(delegate),
    retrieve: delegate.retrieve.bind(delegate),
    createReclamationBinding: delegate.createReclamationBinding.bind(delegate),
    reclaim: delegate.reclaim.bind(delegate),
  });
  const input = operationInput({
    selected,
    backend,
    semantic: "valid",
  });
  const result = await operateFoundationAgentCellV1(input);
  const support = selected.store.getOperationSupport(selected.selection.activityId);
  assert(support !== null);
  const checkpoint = support.payload.checkpoint as unknown as
    FoundationExecutionOperationCheckpointV1;
  assert.equal(checkpoint.observation?.terminal?.reason, "parent-loss");
  assert.notEqual(checkpoint.containment, null);
  assert.notEqual(checkpoint.retirement, null);
  assert.equal(checkpoint.retirement?.dispatchAuthorityConsumed, true);
  assert.equal(result.receiptFacts.containment.parentLoss, "contained");
  assert.equal(result.receiptFacts.retirement.residualClass, "bounded-non-secret");
  assert.equal(result.terminal.outputValidation, "valid");
  assert.equal(engine.productiveStartCount(specification.digest), 1);
  assert.equal(dispatchCalls, 1);
  assert.equal(selected.reclamation.list().length, 1);

  const replayed = await operateFoundationAgentCellV1(input);
  assert.equal(replayed.receiptFacts.containment.parentLoss, "contained");
  assert.equal(replayed.terminal.retirementDigest, result.terminal.retirementDigest);
  assert.equal(dispatchCalls, 1);
  assert.equal(engine.productiveStartCount(specification.digest), 1);
  assert.equal(engine.snapshot().allocations.length, 1);

  const reclaimed = await selected.reclamation.runNext({
    reclaim: async (handoff) => await engine.facade(selected.installed.profile).reclaim(
      handoff.specification,
      handoff.reclamationBinding,
      handoff.obligation,
    ),
  });
  assert.equal(reclaimed?.standing.state, "reclaimed");
  assert.equal(selected.reclamation.summarizeProcess({
    storeId: selected.store.identity.storeId,
    processId: selected.store.identity.processId,
  }).reclaimedCount, 1);
});
