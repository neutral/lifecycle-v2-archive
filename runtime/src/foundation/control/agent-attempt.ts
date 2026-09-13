import { FoundationError } from "../error.js";
import { FOUNDATION_BUILDER_REPAIR_OUTPUT_PURPOSE, FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE } from "../candidate/carrier-types.js";
import type {
  FoundationExecutionBackendProfileReferenceV1,
  FoundationExecutionImageReferenceV1,
  FoundationExecutionInputSetReferenceV1,
} from "../execution/contracts.js";
import {
  digestCanonical,
  type Sha256,
} from "../validation/canonical.js";
import { sortUniqueCodePoints } from "../validation/ordering.js";
import { assertDeliveryControlRecordPolicy } from "./kind-registry.js";
import { compileControlRecordRevision, controlIdentifier } from "./model.js";
import { assertDeliveryControlRecordPayload } from "./payload-registry.js";
import type { ControlRecordStore } from "./store.js";
import type {
  ControlJsonObject,
  ControlRecordEvent,
  ControlRecordRelationship,
  ControlRecordRelationshipTarget,
  ControlRecordStoreAppend,
  ControlRecordRevision,
} from "./types.js";

export type AgentAttemptRole = "reconnaissance" | "builder" | "reviewer";
export type AgentAttemptOperation =
  | "delivery.prepare"
  | "delivery.continue"
  | "delivery.evaluate"
  | "delivery.revise"
  | "delivery.reaffirm";

export type AgentAttemptProjection = Readonly<{
  id: string;
  profileId: string;
  digest: Sha256;
}>;

export type AgentAttemptCapability = Readonly<{
  profileId: string;
  profileDigest: Sha256;
  effectiveGrantDigest: Sha256;
}>;

export type AgentAttemptInvestment = Readonly<{
  id: string;
  digest: Sha256;
  model: string;
  reasoning: string;
  wallTimeMs: number;
  limits: Readonly<{
    tokens: number | null;
    events: number | null;
    outputBytes: number | null;
    toolCalls: number | null;
    processes: number | null;
    storageBytes: number | null;
  }>;
  rationale: string;
}>;

export type AgentAttemptProvider = Readonly<{
  descriptorId: string;
  descriptorDigest: Sha256;
  executableIdentityClass: string;
  installedIdentityDigest: Sha256;
}>;

export type AgentAttemptExecution = Readonly<{
  backendProfile: FoundationExecutionBackendProfileReferenceV1;
  image: FoundationExecutionImageReferenceV1;
  /**
   * Reference to the already-compiled immutable Input Set. Builder, reviewer,
   * and boundary-resolution Attempts bind their exact Candidate Revision and
   * Carrier here. Initial preparation has no Candidate input.
   */
  inputSet: FoundationExecutionInputSetReferenceV1;
}>;

export type AgentAttemptExecutionPolicy = Readonly<{
  cancellationPolicyDigest: Sha256;
  containmentPolicyDigest: Sha256;
  parentLossPolicyDigest: Sha256;
  retirementPolicyDigest: Sha256;
  recoveryPolicyDigest: Sha256;
}>;

export type AgentAttemptAuthoring = Readonly<{
  roleBriefDigest: Sha256;
  templateProfileId: string;
  templateDigest: Sha256;
  parserProfileId: string;
  parserProfileDigest: Sha256;
  compilerProfileId: string;
  compilerProfileDigest: Sha256;
  submissionPolicy: "explicit" | "explicit-or-clean-natural-completion";
}>;

export type AgentAttemptInputFacts = Readonly<{
  contentInventoryDigest: Sha256;
  inputMaterialDigest: Sha256;
  citationRegistryDigest: Sha256;
  evidenceSetDigest: Sha256 | null;
  propositionSetDigest: Sha256 | null;
}>;

export type AgentAttemptReference = Readonly<{
  kind: "director-brief" | "work-boundary" | "candidate-revision" | "candidate-seal";
  id: string;
  revision: number;
  digest: Sha256;
}>;

function relationship(
  relation: "uses-brief" | "uses-boundary" | "uses-candidate" | "uses-seal",
  target: AgentAttemptReference,
): ControlRecordRelationship {
  return Object.freeze({
    relation,
    target: Object.freeze({ ...target }) as ControlRecordRelationshipTarget,
  });
}

function relationships(input: Readonly<{
  brief: AgentAttemptReference;
  boundary?: AgentAttemptReference | null;
  candidate?: AgentAttemptReference | null;
  seal?: AgentAttemptReference | null;
}>): readonly ControlRecordRelationship[] {
  if (input.brief.kind !== "director-brief") {
    throw new FoundationError(
      "lifecycle.agent-attempt.brief",
      "Agent Attempt compilation requires one exact Director Brief reference",
    );
  }
  if (input.boundary !== undefined && input.boundary !== null && input.boundary.kind !== "work-boundary") {
    throw new FoundationError(
      "lifecycle.agent-attempt.boundary",
      "Agent Attempt Boundary selection must reference one Work Boundary revision",
    );
  }
  if (input.candidate !== undefined && input.candidate !== null && input.candidate.kind !== "candidate-revision") {
    throw new FoundationError(
      "lifecycle.agent-attempt.candidate",
      "Agent Attempt Candidate selection must reference one Candidate Revision",
    );
  }
  if (input.seal !== undefined && input.seal !== null && input.seal.kind !== "candidate-seal") {
    throw new FoundationError(
      "lifecycle.agent-attempt.seal",
      "Agent Attempt Seal selection must reference one Candidate Seal revision",
    );
  }
  return Object.freeze([
    relationship("uses-brief", input.brief),
    ...(input.boundary === undefined || input.boundary === null
      ? []
      : [relationship("uses-boundary", input.boundary)]),
    ...(input.candidate === undefined || input.candidate === null
      ? []
      : [relationship("uses-candidate", input.candidate)]),
    ...(input.seal === undefined || input.seal === null
      ? []
      : [relationship("uses-seal", input.seal)]),
  ]);
}

function semanticMarkdown(input: Readonly<{
  role: AgentAttemptRole;
  operation: AgentAttemptOperation;
  projection: AgentAttemptProjection;
  provider: AgentAttemptProvider;
}>): string {
  return [
    "# Agent Attempt",
    "",
    `- Role: ${input.role}`,
    `- Operation: ${input.operation}`,
    `- Projection: ${input.projection.id}`,
    `- Provider: ${input.provider.descriptorId}`,
    "",
    "This immutable Attempt defines one bounded provider invocation. Its Agent Work Product is retained separately.",
    "",
  ].join("\n");
}

export type RetainAgentAttemptInput = Readonly<{
  store: ControlRecordStore;
  activityId: string;
  operation: AgentAttemptOperation;
  role: AgentAttemptRole;
  createdAt: string;
  /** Exact reducer coordinate frozen by an atomic operation-opening checkpoint. */
  preDispatchStateDigest?: Sha256;
  runtimeId: string;
  projection: AgentAttemptProjection;
  roleSubject: ControlJsonObject;
  capability: AgentAttemptCapability;
  investment: AgentAttemptInvestment;
  provider: AgentAttemptProvider;
  execution: AgentAttemptExecution;
  authoring: AgentAttemptAuthoring;
  input: AgentAttemptInputFacts;
  executionPolicy: AgentAttemptExecutionPolicy;
  adjacentFilePurposes?: readonly string[];
  brief: AgentAttemptReference;
  boundary?: AgentAttemptReference | null;
  candidate?: AgentAttemptReference | null;
  seal?: AgentAttemptReference | null;
}>;

/** Compile one exact Attempt append so operation support can commit beside it. */
export function compileAgentAttemptAppend(input: RetainAgentAttemptInput): Readonly<{
  append: ControlRecordStoreAppend;
  revision: ControlRecordRevision;
}> {
  const expectedRole: Readonly<Record<AgentAttemptOperation, AgentAttemptRole>> = Object.freeze({
    "delivery.prepare": "reconnaissance",
    "delivery.continue": "builder",
    "delivery.evaluate": "reviewer",
    "delivery.revise": "reconnaissance",
    "delivery.reaffirm": "reconnaissance",
  });
  if (expectedRole[input.operation] !== input.role) {
    throw new FoundationError(
      "lifecycle.agent-attempt.role",
      "Agent Attempt role does not match its exact Delivery operation",
    );
  }
  const repairPurposes = (input.adjacentFilePurposes ?? []).filter((purpose) =>
    purpose === FOUNDATION_BUILDER_REPAIR_OUTPUT_PURPOSE || purpose === FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE);
  if (repairPurposes.length > 0 && (input.role !== "builder" || repairPurposes.length !== 2 || new Set(repairPurposes).size !== 2)) {
    throw new FoundationError("lifecycle.agent-attempt.role", "Only a builder may declare one complete repair-output purpose pair");
  }
  const hasBoundary = input.boundary !== undefined && input.boundary !== null;
  const hasCandidate = input.candidate !== undefined && input.candidate !== null;
  const hasSeal = input.seal !== undefined && input.seal !== null;
  if (input.operation === "delivery.prepare") {
    if (hasBoundary || hasCandidate || hasSeal) {
      throw new FoundationError(
        "lifecycle.agent-attempt.subject",
        "Fresh preparation cannot bind an admitted Boundary, Candidate, or Candidate Seal",
      );
    }
  } else if (!hasBoundary || !hasCandidate || (input.role === "reviewer") !== hasSeal) {
    throw new FoundationError(
      "lifecycle.agent-attempt.subject",
      "Every admitted Attempt requires its exact Boundary and Candidate, and only review requires the exact Candidate Seal",
    );
  }
  const activityId = controlIdentifier(input.activityId, "Agent Attempt activity identity");
  const preDispatchStateDigest = input.preDispatchStateDigest ?? digestCanonical(input.store.state());
  if (!/^sha256:[a-f0-9]{64}$/u.test(preDispatchStateDigest)) {
    throw new FoundationError(
      "lifecycle.agent-attempt.pre-dispatch-state",
      "Agent Attempt pre-dispatch reducer coordinate must be one lowercase SHA-256 digest",
    );
  }
  const identitySuffix = digestCanonical({
    recordKind: "agent-attempt",
    storeId: input.store.identity.storeId,
    processId: input.store.identity.processId,
    activityId,
  }).slice("sha256:".length);
  const recordId = `agent-attempt-${identitySuffix}`;
  const invocationId = `provider-invocation-${identitySuffix}`;
  const payload = Object.freeze({
    schema: "lifecycle.agent-attempt-payload.v3",
    activityId,
    operation: input.operation,
    role: input.role,
    invocationId,
    preDispatchStateDigest,
    projection: Object.freeze({ ...input.projection }),
    roleSubjectDigest: digestCanonical(input.roleSubject),
    capability: Object.freeze({ ...input.capability }),
    investment: Object.freeze({
      ...input.investment,
      limits: Object.freeze({ ...input.investment.limits }),
    }),
    provider: Object.freeze({
      ...input.provider,
      adapter: "lifecycle.provider-adapter.v7",
    }),
    execution: Object.freeze({
      backendProfile: Object.freeze({ ...input.execution.backendProfile }),
      image: Object.freeze({ ...input.execution.image }),
      inputSet: Object.freeze({ ...input.execution.inputSet }),
    }),
    authoring: Object.freeze({ ...input.authoring }),
    input: Object.freeze({ ...input.input }),
    executionPolicy: Object.freeze({ ...input.executionPolicy }),
    adjacentFilePurposes: Object.freeze(sortUniqueCodePoints(input.adjacentFilePurposes ?? [])),
  });
  const revisionInput = Object.freeze({
    recordId,
    recordKind: "agent-attempt",
    revision: 1,
    producer: Object.freeze({ kind: "runtime" as const, id: input.runtimeId }),
    semanticAuthor: Object.freeze({ kind: "runtime" as const, id: input.runtimeId }),
    semanticAuthority: "runtime-derived" as const,
    createdAt: input.createdAt,
    semanticMarkdown: semanticMarkdown(input),
    payload,
    relationships: relationships(input),
  });
  const compiled = compileControlRecordRevision(input.store.identity.processId, revisionInput);
  assertDeliveryControlRecordPolicy(compiled);
  assertDeliveryControlRecordPayload(compiled);
  return Object.freeze({
    revision: compiled,
    append: Object.freeze({
      revision: revisionInput,
      event: Object.freeze({
        eventId: `event-agent-attempt-prepared-${identitySuffix}`,
        eventKind: "agent-attempt-prepared",
        occurredAt: input.createdAt,
        actor: Object.freeze({ kind: "runtime" as const, id: input.runtimeId }),
        subject: Object.freeze({
          recordId: compiled.recordId,
          revision: compiled.revision,
          digest: compiled.digest,
        }),
        payload: Object.freeze({ activityId }),
      }),
    }),
  });
}

export function retainAgentAttempt(input: RetainAgentAttemptInput): Readonly<{
  revision: ControlRecordRevision;
  event: ControlRecordEvent;
}> {
  const compiled = compileAgentAttemptAppend(input);
  const retained = input.store.append(compiled.append);
  return Object.freeze({ revision: retained.revision!, event: retained.event });
}
