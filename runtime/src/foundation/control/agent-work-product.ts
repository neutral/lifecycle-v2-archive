import { FoundationError } from "../error.js";
import { assertDeliveryControlRecordPolicy } from "./kind-registry.js";
import { compileControlRecordRevision, normalizeSemanticMarkdown } from "./model.js";
import type { ControlRecordStore } from "./store.js";
import type {
  ControlActor,
  ControlJsonObject,
  ControlRecordEvent,
  ControlRecordRevision,
} from "./types.js";
import { digestCanonical, sha256Bytes, type Sha256 } from "../validation/canonical.js";
import {
  AgentWorkProductSemanticError,
  agentWorkProductCompilationDigests,
  compileAgentWorkProductPayload,
  parseAgentWorkProductSemanticMarkdown,
  type AgentWorkProductCitationRegistryEntry,
  type AgentWorkProductFailureClassification,
  type AgentWorkProductFailurePhase,
  type AgentWorkProductPropositionSet,
  type AgentWorkProductSemanticObservation,
  type ParsedAgentWorkProduct,
} from "./agent-work-product-semantics.js";

export type AgentWorkProductSubmissionRejection = Readonly<{
  status: "rejected";
  error: AgentWorkProductSemanticError;
  classification: AgentWorkProductFailureClassification;
  phase: AgentWorkProductFailurePhase;
  observation: AgentWorkProductSemanticObservation;
  parseResultDigest: Sha256 | null;
  fixedBindingSubjectDigest: Sha256 | null;
}>;

export type AgentWorkProductSubmissionRetention = Readonly<{
  status: "retained";
  revision: ControlRecordRevision;
  event: ControlRecordEvent;
  rawDigest: Sha256;
  rawByteLength: number;
}>;

const MAXIMUM_DIRECT_SEMANTIC_BYTES = 1024 * 1024;

export type AgentWorkProductSemanticBytesInput = Readonly<{
  store: ControlRecordStore;
  activityId: string;
  editor: ControlActor;
  templateDigest: Sha256;
  semanticBytes: Uint8Array;
  attempt: Readonly<{
    id: string;
    revision: number;
    digest: Sha256;
  }>;
  citationRegistry: readonly AgentWorkProductCitationRegistryEntry[];
  propositionSet?: AgentWorkProductPropositionSet | null;
  submittedAt: string;
  runtimeId: string;
}>;

function rejection(
  error: unknown,
  observation: AgentWorkProductSemanticObservation,
  digests: Readonly<{
    parseResultDigest: Sha256 | null;
    fixedBindingSubjectDigest: Sha256 | null;
  }>,
): AgentWorkProductSubmissionRejection {
  if (!(error instanceof AgentWorkProductSemanticError)) throw error;
  return Object.freeze({
    status: "rejected",
    error,
    classification: error.classification,
    phase: error.phase,
    observation,
    ...digests,
  });
}

/**
 * Compile one exact semantic artifact already retrieved from a contained
 * Execution Cell. The immutable bytes are observed directly; the Runtime does
 * not recreate a provider-editable authoring directory in controller custody.
 */
export async function finalizeAgentWorkProductSemanticBytes(
  input: AgentWorkProductSemanticBytesInput,
): Promise<AgentWorkProductSubmissionRetention | AgentWorkProductSubmissionRejection> {
  if (
    input.editor.kind !== "agent" || !(input.semanticBytes instanceof Uint8Array) ||
    input.semanticBytes.byteLength < 1 ||
    input.semanticBytes.byteLength > MAXIMUM_DIRECT_SEMANTIC_BYTES ||
    !/^sha256:[a-f0-9]{64}$/u.test(input.templateDigest)
  ) {
    throw new FoundationError(
      "lifecycle.control-authoring.cell-binding",
      "Execution Cell semantic submission requires one bounded Agent-authored byte artifact and exact template digest",
    );
  }
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(input.semanticBytes);
  } catch {
    throw new FoundationError(
      "lifecycle.control-authoring.semantic-utf8",
      "Execution Cell semantic submission is not valid UTF-8",
    );
  }
  const semanticMarkdown = normalizeSemanticMarkdown(decoded);
  const observation = Object.freeze({
    activityId: input.activityId,
    editor: Object.freeze({ kind: "agent" as const, id: input.editor.id }),
    rawDigest: sha256Bytes(input.semanticBytes),
    rawByteLength: input.semanticBytes.byteLength,
    semanticMarkdown,
    semanticDigest: sha256Bytes(semanticMarkdown),
  });
  const attempt = input.store.getRevision(input.attempt.id, input.attempt.revision);
  if (attempt === null || attempt.recordKind !== "agent-attempt" || attempt.digest !== input.attempt.digest) {
    throw new FoundationError(
      "lifecycle.control-authoring.attempt-binding",
      "Execution Cell semantic submission does not bind one exact retained Agent Attempt revision",
    );
  }
  const role = attempt.payload.role;
  if (role !== "reconnaissance" && role !== "builder" && role !== "reviewer") {
    throw new FoundationError(
      "lifecycle.control-authoring.attempt-binding",
      "Execution Cell semantic submission resolves an unsupported Agent Attempt role",
    );
  }
  let parsed: ParsedAgentWorkProduct;
  try {
    parsed = parseAgentWorkProductSemanticMarkdown(role, observation.semanticMarkdown);
  } catch (error) {
    return rejection(error, observation, Object.freeze({
      parseResultDigest: null,
      fixedBindingSubjectDigest: null,
    }));
  }
  const compilerInput = Object.freeze({
    attempt,
    workspaceTemplateDigest: input.templateDigest,
    observation,
    parsed,
    citationRegistry: input.citationRegistry,
    propositionSet: input.propositionSet,
  });
  const compilationDigests = agentWorkProductCompilationDigests(compilerInput);
  let payload: ControlJsonObject;
  try {
    payload = compileAgentWorkProductPayload(compilerInput);
  } catch (error) {
    return rejection(error, observation, compilationDigests);
  }
  const identitySuffix = digestCanonical({
    recordKind: "agent-work-product",
    storeId: input.store.identity.storeId,
    processId: input.store.identity.processId,
    activityId: observation.activityId,
    attempt: input.attempt,
  }).slice("sha256:".length);
  const recordId = `agent-work-product-${identitySuffix}`;
  const revisionInput = Object.freeze({
    recordId,
    recordKind: "agent-work-product",
    revision: 1,
    producer: Object.freeze({ kind: "runtime" as const, id: input.runtimeId }),
    semanticAuthor: observation.editor,
    semanticAuthority: "agent-proposed" as const,
    createdAt: input.submittedAt,
    semanticMarkdown: parsed.normalizedMarkdown,
    payload,
    relationships: Object.freeze([Object.freeze({
      relation: "result-of",
      target: Object.freeze({
        kind: "agent-attempt",
        id: input.attempt.id,
        revision: input.attempt.revision,
        digest: input.attempt.digest,
      }),
    })]),
  });
  const compiled = compileControlRecordRevision(input.store.identity.processId, revisionInput);
  assertDeliveryControlRecordPolicy(compiled);
  const retained = input.store.append({
    revision: revisionInput,
    event: {
      eventId: `event-agent-work-product-submitted-${identitySuffix}`,
      eventKind: "agent-work-product-submitted",
      occurredAt: input.submittedAt,
      actor: { kind: "runtime", id: input.runtimeId },
      subject: {
        recordId: compiled.recordId,
        revision: compiled.revision,
        digest: compiled.digest,
      },
      payload: { activityId: observation.activityId },
    },
  });
  return Object.freeze({
    status: "retained" as const,
    revision: retained.revision!,
    event: retained.event,
    rawDigest: observation.rawDigest,
    rawByteLength: observation.rawByteLength,
  });
}
