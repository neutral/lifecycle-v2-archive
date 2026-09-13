import { FoundationError } from "../error.js";
import {
  digestCanonical,
  type Sha256,
} from "../validation/canonical.js";
import { sortUniqueCodePoints } from "../validation/ordering.js";
import { assertDeliveryControlRecordPolicy } from "./kind-registry.js";
import {
  compileControlRecordRevision,
  controlIdentifier,
} from "./model.js";
import { assertDeliveryControlRecordPayload } from "./payload-registry.js";
import type { ControlRecordStore } from "./store.js";
import type {
  ControlJsonObject,
  ControlRecordEvent,
  ControlRecordRelationship,
  ControlRecordRevision,
} from "./types.js";

export type CandidateSealCandidateReference = Readonly<{
  kind: "candidate-revision";
  id: string;
  revision: number;
  digest: Sha256;
}>;

export type CandidateSealBoundaryReference = Readonly<{
  kind: "work-boundary";
  id: string;
  revision: number;
  digest: Sha256;
}>;

export type CandidateSealObservation = Readonly<{
  carrierIntegrity: "verified";
  carrierReconstruction: "verified";
  evaluationSubject: "established";
  candidateReobservation: "exact-match";
  untrackedProduct: "absent";
  controlExclusion: "verified";
  sealer: Readonly<{
    implementationId: string;
    implementationDigest: Sha256;
    ruleSetId: string;
    ruleSetDigest: Sha256;
  }>;
  limitations?: readonly string[];
}>;

type SealReference = CandidateSealCandidateReference | CandidateSealBoundaryReference;

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SINGLE_LINE_PATTERN = /^[^\u0000-\u001f\u007f-\u009f\u2028\u2029]+$/u;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.control-candidate-seal.${code}`, message);
}

function sameReference(
  left: Readonly<{ id: string; revision: number; digest: Sha256 }> | null,
  right: Readonly<{ id: string; revision: number; digest: Sha256 }>,
): boolean {
  return left !== null &&
    left.id === right.id &&
    left.revision === right.revision &&
    left.digest === right.digest;
}

function exactReference<const Kind extends SealReference["kind"]>(
  value: Readonly<{
    kind: Kind;
    id: string;
    revision: number;
    digest: Sha256;
  }>,
  expectedKind: Kind,
  label: string,
): Readonly<{
  kind: Kind;
  id: string;
  revision: number;
  digest: Sha256;
}> {
  if (value.kind !== expectedKind) {
    fail("reference", `${label} must select one exact ${expectedKind} revision`);
  }
  const id = controlIdentifier(value.id, `${label} identity`);
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
    fail("reference", `${label} revision must be one positive safe integer`);
  }
  if (!SHA256_PATTERN.test(value.digest)) {
    fail("reference", `${label} digest must be one lowercase SHA-256 digest`);
  }
  return Object.freeze({
    kind: expectedKind,
    id,
    revision: value.revision,
    digest: value.digest,
  });
}

function exactRetainedRevision(
  store: ControlRecordStore,
  reference: SealReference,
  label: string,
): ControlRecordRevision {
  const retained = store.getRevision(reference.id, reference.revision);
  if (
    retained === null ||
    retained.recordKind !== reference.kind ||
    retained.digest !== reference.digest
  ) {
    fail("retained-subject", `${label} does not resolve to one exact retained revision`);
  }
  return retained;
}

function assertCandidateReconstructible(candidate: ControlRecordRevision): void {
  if (
    candidate.payload.schema !== "lifecycle.candidate-revision-payload.v3" ||
    candidate.payload.state === null ||
    Array.isArray(candidate.payload.state) ||
    typeof candidate.payload.state !== "object"
  ) {
    fail(
      "candidate-invalid",
      "Candidate sealing requires one exact retained reconstructible Candidate Revision",
    );
  }
}

function assertCandidateBoundary(
  candidate: ControlRecordRevision,
  boundary: CandidateSealBoundaryReference,
): void {
  const governedBy = candidate.relationships.filter(({ relation }) => relation === "governed-by");
  if (
    governedBy.length !== 1 ||
    governedBy[0]!.target.kind !== "work-boundary" ||
    !sameReference(governedBy[0]!.target, boundary)
  ) {
    fail(
      "candidate-boundary",
      "Candidate Revision does not bind the exact active Work Boundary selected for sealing",
    );
  }
}

function boundedLimitations(values: readonly string[]): readonly string[] {
  if (values.length > 128) {
    fail("limitations", "Candidate Seal limitations exceed the bounded profile");
  }
  const normalized = values.map((value) => {
    if (
      typeof value !== "string" ||
      value.length < 1 ||
      value.length > 1_024 ||
      !SINGLE_LINE_PATTERN.test(value)
    ) {
      fail("limitations", "Each Candidate Seal limitation must be one bounded printable line");
    }
    return value;
  });
  return Object.freeze(sortUniqueCodePoints(normalized));
}

function exactDigest(value: Sha256, label: string): Sha256 {
  if (!SHA256_PATTERN.test(value)) {
    fail("sealer", `${label} must be one lowercase SHA-256 digest`);
  }
  return value;
}

function normalizedObservation(observation: CandidateSealObservation): Readonly<{
  payload: ControlJsonObject;
  limitations: readonly string[];
}> {
  if (
    observation.carrierIntegrity !== "verified" ||
    observation.carrierReconstruction !== "verified" ||
    observation.evaluationSubject !== "established" ||
    observation.candidateReobservation !== "exact-match" ||
    observation.untrackedProduct !== "absent" ||
    observation.controlExclusion !== "verified"
  ) {
    fail(
      "observation",
      "Candidate Seal compilation requires every Carrier and evaluation-subject invariant to be established",
    );
  }
  const limitations = boundedLimitations(observation.limitations ?? []);
  const sealer = Object.freeze({
    implementationId: controlIdentifier(
      observation.sealer.implementationId,
      "Candidate sealer implementation identity",
    ),
    implementationDigest: exactDigest(
      observation.sealer.implementationDigest,
      "Candidate sealer implementation digest",
    ),
    ruleSetId: controlIdentifier(observation.sealer.ruleSetId, "Candidate sealer rule-set identity"),
    ruleSetDigest: exactDigest(
      observation.sealer.ruleSetDigest,
      "Candidate sealer rule-set digest",
    ),
  });
  if (sealer.implementationId.length > 160 || sealer.ruleSetId.length > 160) {
    fail("sealer", "Candidate sealer identities exceed the Control payload profile");
  }
  return Object.freeze({
    payload: Object.freeze({
      schema: "lifecycle.candidate-seal-payload.v2",
      profileId: "lifecycle.candidate-seal.foundation-v1",
      carrierIntegrity: observation.carrierIntegrity,
      carrierReconstruction: observation.carrierReconstruction,
      evaluationSubject: observation.evaluationSubject,
      candidateReobservation: observation.candidateReobservation,
      untrackedProduct: observation.untrackedProduct,
      controlExclusion: observation.controlExclusion,
      sealer,
      limitations,
    }),
    limitations,
  });
}

function relationship(
  relation: "seals" | "governed-by",
  target: SealReference,
): ControlRecordRelationship {
  return Object.freeze({
    relation,
    target: Object.freeze({ ...target }),
  });
}

function identities(store: ControlRecordStore, activityId: string): Readonly<{
  recordId: string;
  eventId: string;
}> {
  const suffix = digestCanonical({
    recordKind: "candidate-seal",
    storeId: store.identity.storeId,
    processId: store.identity.processId,
    activityId,
  }).slice("sha256:".length);
  return Object.freeze({
    recordId: `candidate-seal-${suffix}`,
    eventId: `event-candidate-sealed-${suffix}`,
  });
}

function semanticMarkdown(input: Readonly<{
  candidate: CandidateSealCandidateReference;
  boundary: CandidateSealBoundaryReference;
  observation: CandidateSealObservation;
  limitations: readonly string[];
}>): string {
  const lines = [
    "# Candidate Seal",
    "",
    `- Candidate Revision: ${input.candidate.id} revision ${input.candidate.revision}`,
    `- Active Work Boundary: ${input.boundary.id} revision ${input.boundary.revision}`,
    `- Carrier integrity: ${input.observation.carrierIntegrity}`,
    `- Carrier reconstruction: ${input.observation.carrierReconstruction}`,
    `- Evaluation subject: ${input.observation.evaluationSubject}`,
    `- Candidate reobservation: ${input.observation.candidateReobservation}`,
    `- Untracked product: ${input.observation.untrackedProduct}`,
    `- Control exclusion: ${input.observation.controlExclusion}`,
    `- Sealer: ${input.observation.sealer.implementationId}`,
  ];
  if (input.limitations.length > 0) {
    lines.push("", "## Limitations", "", ...input.limitations.map((value) => `- ${value}`));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Compile and atomically retain one runtime-authenticated fact that freezes
 * the exact current Candidate Revision under its exact active Work Boundary.
 * The Seal does not create or replace a Candidate identity.
 */
export function retainCandidateSeal(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  candidate: CandidateSealCandidateReference;
  boundary: CandidateSealBoundaryReference;
  observation: CandidateSealObservation;
  sealedAt: string;
  runtimeId: string;
}>): Readonly<{
  revision: ControlRecordRevision;
  event: ControlRecordEvent;
}> {
  const activityId = controlIdentifier(input.activityId, "Candidate Seal activity identity");
  const candidate = exactReference(input.candidate, "candidate-revision", "Candidate Revision");
  const boundary = exactReference(input.boundary, "work-boundary", "Active Work Boundary");
  const state = input.store.state();
  if (!sameReference(state.subjects.candidate, candidate)) {
    fail("candidate-current", "Candidate Seal does not select the exact current Candidate Revision");
  }
  if (!sameReference(state.subjects.activeBoundary, boundary)) {
    fail("boundary-current", "Candidate Seal does not select the exact active Work Boundary");
  }
  const activity = state.activities.find(({ id }) => id === activityId);
  if (
    activity === undefined ||
    activity.operation !== "delivery.evaluate" ||
    activity.family !== "agent" ||
    activity.stage === "completed"
  ) {
    fail("activity", "Candidate Seal requires the exact active evaluation activity");
  }
  const retainedCandidate = exactRetainedRevision(input.store, candidate, "Candidate Revision");
  exactRetainedRevision(input.store, boundary, "Active Work Boundary");
  assertCandidateReconstructible(retainedCandidate);
  assertCandidateBoundary(retainedCandidate, boundary);

  const observation = normalizedObservation(input.observation);
  const ownedIdentities = identities(input.store, activityId);
  const relationships = Object.freeze([
    relationship("seals", candidate),
    relationship("governed-by", boundary),
  ]);
  const revisionInput = Object.freeze({
    recordId: ownedIdentities.recordId,
    recordKind: "candidate-seal",
    revision: 1,
    producer: Object.freeze({ kind: "runtime" as const, id: input.runtimeId }),
    semanticAuthor: Object.freeze({ kind: "runtime" as const, id: input.runtimeId }),
    semanticAuthority: "runtime-observed" as const,
    createdAt: input.sealedAt,
    semanticMarkdown: semanticMarkdown({
      candidate,
      boundary,
      observation: input.observation,
      limitations: observation.limitations,
    }),
    payload: observation.payload,
    relationships,
  });
  const compiled = compileControlRecordRevision(input.store.identity.processId, revisionInput);
  assertDeliveryControlRecordPolicy(compiled);
  assertDeliveryControlRecordPayload(compiled);
  const retained = input.store.append({
    revision: revisionInput,
    event: {
      eventId: ownedIdentities.eventId,
      eventKind: "candidate-sealed",
      occurredAt: input.sealedAt,
      actor: { kind: "runtime", id: input.runtimeId },
      subject: {
        recordId: compiled.recordId,
        revision: compiled.revision,
        digest: compiled.digest,
      },
      payload: { activityId },
    },
  });
  if (retained.revision === null) {
    fail("retention", "Candidate sealing did not retain its exact revision");
  }
  return Object.freeze({ revision: retained.revision, event: retained.event });
}
