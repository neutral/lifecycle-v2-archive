import type { FoundationIntegrationConflictV1, FoundationIntegrationMergeRuleV1 } from "../candidate/integration-merge.js";
import { FoundationError } from "../error.js";
import type { FoundationRepositorySnapshot } from "../repository/types.js";
import { canonicalJson, digestCanonical, selfDigest, type Sha256 } from "../validation/canonical.js";
import { compareCodePoints, sortUniqueCodePoints } from "../validation/ordering.js";
import { assertFoundationSchema } from "../validation/schema-engine.js";
import { assertDeliveryControlRecordPolicy } from "./kind-registry.js";
import { compileControlRecordRevision, controlIdentifier } from "./model.js";
import type { ControlRecordStore } from "./store.js";
import type { ControlJsonObject, ControlRecordRevision, ControlRecordRelationshipTarget, ControlRecordStoreAppend } from "./types.js";

export const INTEGRATION_CONTEXT_SUBJECTS = Object.freeze([
  "repository-contract", "atlas", "discipline-registry", "knowledge-closure", "required-sources",
] as const);
export type FoundationIntegrationContextSubjectV1 = typeof INTEGRATION_CONTEXT_SUBJECTS[number];
export type FoundationIntegrationApplicabilityV1 = Readonly<{
  disposition: "unchanged" | "requires-readmission";
  changes: readonly Readonly<{ subject: FoundationIntegrationContextSubjectV1; admittedDigest: Sha256; parentDigest: Sha256 }>[];
}>;

/** The exact constructed result observed by A, independently reproduced by I. */
export function foundationIntegrationValidationFactsDigestV1(observation: Readonly<{
  manifestFileDigest: Sha256;
  state: unknown;
  observer: unknown;
}>): Sha256 {
  return digestCanonical({ schema: "lifecycle.integration-validation-facts.v1",
    manifestFileDigest: observation.manifestFileDigest, state: observation.state, observer: observation.observer });
}

export function foundationIntegratedCandidateFactsDigestV1(candidate: ControlRecordRevision): Sha256 {
  const manifest = candidate.payload.carrierManifest;
  if (candidate.recordKind !== "candidate-revision" || manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) fail("Integrated Candidate lacks an exact Carrier manifest");
  const descriptor = manifest as ControlJsonObject;
  if (typeof descriptor.digest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(descriptor.digest)) fail("Integrated Candidate lacks an exact Carrier manifest digest");
  return foundationIntegrationValidationFactsDigestV1({ manifestFileDigest: descriptor.digest as Sha256,
    state: candidate.payload.state, observer: candidate.payload.observer });
}
export type FoundationIntegrationAssessmentPayloadV1 = Readonly<{
  schema: "lifecycle.integration-assessment-payload.v1";
  profileId: "lifecycle.integration-assessment.foundation-v1";
  canonicalParent: FoundationRepositorySnapshot;
  mergeRule: FoundationIntegrationMergeRuleV1;
  outcome: "constructed" | "conflicted" | "invalid";
  conflicts: readonly FoundationIntegrationConflictV1[];
  validation: Readonly<{ complete: boolean; valid: boolean; diagnosticCodes: readonly string[]; factsDigest: Sha256 }>;
  contextualApplicability: FoundationIntegrationApplicabilityV1;
  assessedAt: string;
  limitations: readonly string[];
}>;

function fail(message: string): never {
  throw new FoundationError("lifecycle.integration.assessment-invalid", message);
}

function reference(revision: ControlRecordRevision): ControlRecordRelationshipTarget {
  return Object.freeze({ kind: revision.recordKind, id: revision.recordId, revision: revision.revision, digest: revision.digest });
}

function linked(revision: ControlRecordRevision, relation: string, kind: string): ControlRecordRelationshipTarget {
  const selected = revision.relationships.filter((item) => item.relation === relation);
  if (selected.length !== 1 || selected[0]!.target.kind !== kind) fail(`Integration provenance requires one ${relation} relationship to ${kind}`);
  return selected[0]!.target;
}

export type FoundationIntegrationRevisionLookupV1 = Readonly<{
  identity: Pick<ControlRecordStore["identity"], "targetId" | "storeId" | "processId">;
  getRevision: ControlRecordStore["getRevision"];
}>;

function retained(store: FoundationIntegrationRevisionLookupV1, subject: ControlRecordRelationshipTarget): ControlRecordRevision {
  const value = store.getRevision(subject.id, subject.revision);
  if (value === null || value.recordKind !== subject.kind || value.digest !== subject.digest || value.processId !== store.identity.processId) {
    fail("Integration provenance cannot resolve an exact retained subject in this Delivery");
  }
  return value;
}

export function parseFoundationIntegrationAssessmentPayloadV1(value: unknown): FoundationIntegrationAssessmentPayloadV1 {
  assertFoundationSchema("urn:lifecycle:schema:integration-assessment-payload:v1", value, "Integration Assessment payload");
  const payload = value as FoundationIntegrationAssessmentPayloadV1;
  if (selfDigest(payload.canonicalParent) !== payload.canonicalParent.digest) fail("Integration parent Snapshot does not reproduce its exact digest");
  const canonicalConflicts = [...payload.conflicts].sort((left, right) => compareCodePoints(left.path, right.path) || compareCodePoints(left.kind, right.kind));
  if (canonicalJson(canonicalConflicts) !== canonicalJson(payload.conflicts)) fail("Integration conflict facts are not canonically ordered");
  if (canonicalJson(sortUniqueCodePoints(payload.validation.diagnosticCodes)) !== canonicalJson(payload.validation.diagnosticCodes)) {
    fail("Integration validation diagnostics are not canonically ordered and unique");
  }
  const changes = payload.contextualApplicability.changes;
  if (changes.some((change, index) => change.admittedDigest === change.parentDigest || (index > 0 &&
    INTEGRATION_CONTEXT_SUBJECTS.indexOf(changes[index - 1]!.subject) >= INTEGRATION_CONTEXT_SUBJECTS.indexOf(change.subject)))) {
    fail("Integration contextual changes must be distinct, ordered, unequal exact comparisons");
  }
  if (payload.outcome === "invalid" && payload.validation.complete && payload.validation.valid) {
    fail("Invalid integration cannot report complete valid physical validation");
  }
  return payload;
}

/** Compile exact Runtime observations; this function neither merges nor selects a Candidate. */
export function prepareIntegrationAssessmentRetentionV1(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  boundary: ControlRecordRevision;
  sourceCandidate: ControlRecordRevision;
  payload: FoundationIntegrationAssessmentPayloadV1;
  runtimeId: string;
}>): Readonly<{ append: ControlRecordStoreAppend; revision: ControlRecordRevision }> {
  controlIdentifier(input.activityId, "Integration Activity identity");
  const boundary = retained(input.store, reference(input.boundary));
  const source = retained(input.store, reference(input.sourceCandidate));
  if (boundary.recordKind !== "work-boundary" || source.recordKind !== "candidate-revision" ||
    canonicalJson(linked(source, "governed-by", "work-boundary")) !== canonicalJson(reference(boundary))) {
    fail("Integration Assessment must bind one Candidate under its exact governing Work Boundary");
  }
  const payload = parseFoundationIntegrationAssessmentPayloadV1(input.payload);
  if (payload.canonicalParent.targetId !== input.store.identity.targetId) fail("Integration parent belongs to another Target");
  const id = digestCanonical({ storeId: input.store.identity.storeId, processId: input.store.identity.processId, activityId: input.activityId }).slice(7);
  const proposed = Object.freeze({
    recordId: `integration-${id}`, recordKind: "integration-assessment", revision: 1,
    producer: Object.freeze({ kind: "runtime" as const, id: input.runtimeId }),
    semanticAuthor: Object.freeze({ kind: "runtime" as const, id: input.runtimeId }),
    semanticAuthority: "runtime-observed" as const,
    createdAt: payload.assessedAt,
    semanticMarkdown: ["# Integration Assessment", "", `- Outcome: ${payload.outcome}`, `- Selected canonical parent: ${payload.canonicalParent.commit}`, `- Context: ${payload.contextualApplicability.disposition}`, ""].join("\n"),
    payload,
    relationships: Object.freeze([
      Object.freeze({ relation: "governed-by", target: reference(boundary) }),
      Object.freeze({ relation: "integrates", target: reference(source) }),
    ]),
  });
  const revision = compileControlRecordRevision(input.store.identity.processId, proposed);
  assertDeliveryControlRecordPolicy(revision);
  return Object.freeze({ revision, append: Object.freeze({ revision: proposed, event: Object.freeze({
    eventId: `event-integration-assessed-${id}`, eventKind: "integration-assessed", occurredAt: payload.assessedAt,
    actor: Object.freeze({ kind: "runtime" as const, id: input.runtimeId }),
    subject: Object.freeze({ recordId: revision.recordId, revision: revision.revision, digest: revision.digest }),
    payload: Object.freeze({ activityId: input.activityId }),
  }) }) });
}

export type FoundationCandidateIntegrationProvenanceV1 = Readonly<{
  assessment: ControlRecordRevision;
  sourceCandidate: ControlRecordRevision;
  canonicalParent: FoundationRepositorySnapshot;
}>;

export type FoundationFailedIntegrationCorrectionV1 = Readonly<{
  assessment: ControlRecordRevision;
  sourceCandidate: ControlRecordRevision;
  canonicalParent: FoundationRepositorySnapshot;
  /** Current Candidate first, exact failed source last; only ordinary correction successors intervene. */
  candidateLineage: readonly ControlRecordRevision[];
}>;

/** Failed construction remains correction context while its source advances under the same mandate. */
export function resolveFailedIntegrationCorrectionV1(input: Readonly<{
  store: FoundationIntegrationRevisionLookupV1;
  assessment: ControlRecordRelationshipTarget | null;
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
}>): FoundationFailedIntegrationCorrectionV1 | null {
  if (input.assessment === null) return null;
  const assessment = retained(input.store, input.assessment);
  if (assessment.recordKind !== "integration-assessment") fail("Failed integration context requires an Assessment");
  const payload = parseFoundationIntegrationAssessmentPayloadV1(assessment.payload);
  if (payload.outcome === "constructed") return null;
  const boundary = retained(input.store, reference(input.boundary));
  if (boundary.recordKind !== "work-boundary") fail("Failed integration context requires a Work Boundary");
  if (canonicalJson(linked(assessment, "governed-by", "work-boundary")) !== canonicalJson(reference(boundary))) return null;
  if (payload.canonicalParent.targetId !== input.store.identity.targetId) fail("Failed integration parent belongs to another Target");
  const sourceCandidate = retained(input.store, linked(assessment, "integrates", "candidate-revision"));
  let candidate = retained(input.store, reference(input.candidate));
  const candidateLineage: ControlRecordRevision[] = [];
  while (true) {
    if (candidate.recordKind !== "candidate-revision" || candidate.recordId !== sourceCandidate.recordId ||
        canonicalJson(linked(candidate, "governed-by", "work-boundary")) !== canonicalJson(reference(boundary))) {
      fail("Failed integration correction must preserve its exact Candidate identity and governing Work Boundary");
    }
    candidateLineage.push(candidate);
    if (candidate.digest === sourceCandidate.digest && candidate.revision === sourceCandidate.revision) break;
    if (candidate.revision <= sourceCandidate.revision || candidateLineage.length > 1_000_000 ||
        candidate.payload.observation !== "builder-successor" || candidate.relationships.some(({ relation }) => relation === "integrated-from")) {
      fail("Failed integration context is not an ancestor of ordinary Candidate correction");
    }
    const predecessor = retained(input.store, linked(candidate, "revises", "candidate-revision"));
    if (predecessor.revision + 1 !== candidate.revision || predecessor.recordId !== candidate.recordId ||
        predecessor.payload.candidateBaseCommit !== candidate.payload.candidateBaseCommit) {
      fail("Failed integration correction lineage must preserve exact successive revisions and application base");
    }
    candidate = predecessor;
  }
  return Object.freeze({ assessment, sourceCandidate, canonicalParent: payload.canonicalParent,
    candidateLineage: Object.freeze(candidateLineage) });
}

/** Resolve the current revision's integration, never an unrelated latest assessment. */
export function resolveCandidateIntegrationProvenanceV1(input: Readonly<{
  store: FoundationIntegrationRevisionLookupV1;
  candidate: ControlRecordRevision;
}>): FoundationCandidateIntegrationProvenanceV1 | null {
  let candidate = retained(input.store, reference(input.candidate));
  const visited = new Set<string>();
  while (true) {
    if (candidate.recordKind !== "candidate-revision" || visited.has(candidate.digest)) fail("Candidate integration lineage is invalid or cyclic");
    visited.add(candidate.digest);
    if (visited.size > 1_000_000) fail("Candidate integration lineage exceeds its observation bound");
    if (candidate.payload.observation === "initialization") {
      if (candidate.relationships.some((item) => item.relation === "revises" || item.relation === "integrated-from")) fail("Initial Candidate cannot claim integration ancestry");
      return null;
    }
    const predecessor = retained(input.store, linked(candidate, "revises", "candidate-revision"));
    if (predecessor.recordId !== candidate.recordId || predecessor.revision + 1 !== candidate.revision) fail("Integration lineage must preserve exact successive Candidate identity");
    if (candidate.payload.observation === "integration-successor") {
      const assessment = retained(input.store, linked(candidate, "integrated-from", "integration-assessment"));
      const payload = parseFoundationIntegrationAssessmentPayloadV1(assessment.payload);
      if (payload.canonicalParent.targetId !== input.store.identity.targetId) fail("Integration parent belongs to another Target");
      if (payload.validation.factsDigest !== foundationIntegratedCandidateFactsDigestV1(candidate)) fail("Integrated Candidate does not reproduce its Assessment's exact constructed observation");
      if (payload.outcome !== "constructed" || payload.canonicalParent.commit !== candidate.payload.candidateBaseCommit ||
        canonicalJson(linked(assessment, "integrates", "candidate-revision")) !== canonicalJson(reference(predecessor)) ||
        canonicalJson(linked(assessment, "governed-by", "work-boundary")) !== canonicalJson(linked(candidate, "governed-by", "work-boundary"))) {
        fail("Candidate integration successor does not reproduce its exact source, governing Boundary, and parent");
      }
      return Object.freeze({ assessment, sourceCandidate: predecessor, canonicalParent: payload.canonicalParent });
    }
    if ((candidate.payload.observation !== "builder-successor" && candidate.payload.observation !== "readmission-rebind") ||
      candidate.relationships.some((item) => item.relation === "integrated-from") || candidate.payload.candidateBaseCommit !== predecessor.payload.candidateBaseCommit) {
      fail("Only an explicit integration successor may change a Candidate application base");
    }
    candidate = predecessor;
  }
}
