import { FoundationError } from "../error.js";
import { parseCandidateRevisionCarrierManifest } from "../candidate/carrier-manifest.js";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
} from "../candidate/carrier-types.js";
import {
  canonicalJson,
  digestCanonical,
  sha256Bytes,
  type Sha256,
} from "../validation/canonical.js";
import { compareCodePoints, sortUniqueCodePoints } from "../validation/ordering.js";
import { foundationIntegrationValidationFactsDigestV1, parseFoundationIntegrationAssessmentPayloadV1 } from "./integration-assessment.js";
import { assertDeliveryControlRecordPolicy } from "./kind-registry.js";
import {
  compileControlRecordRevision,
  controlIdentifier,
} from "./model.js";
import { assertDeliveryControlRecordPayload } from "./payload-registry.js";
import {
  compileControlRecordFile,
  type ControlRecordStore,
} from "./store.js";
import type {
  ControlJsonObject,
  ControlRecordEvent,
  ControlRecordEventInput,
  ControlRecordFile,
  ControlRecordFileInput,
  ControlRecordRelationship,
  ControlRecordRevision,
  ControlRecordStoreAppend,
  ControlRecordStoreAppendResult,
} from "./types.js";

export type CandidateRevisionReference = Readonly<{
  kind: "candidate-revision";
  id: string;
  revision: number;
  digest: Sha256;
}>;

export type CandidateRevisionBoundaryReference = Readonly<{
  kind: "work-boundary";
  id: string;
  revision: number;
  digest: Sha256;
}>;

export type CandidateRevisionIntegrationReference = Readonly<{
  kind: "integration-assessment";
  id: string;
  revision: number;
  digest: Sha256;
}>;

export type CandidateRevisionAttemptReference = Readonly<{
  kind: "agent-attempt";
  id: string;
  revision: number;
  digest: Sha256;
}>;

export type CandidateChangedSubject = Readonly<{
  path: string;
  change: "added" | "modified" | "deleted" | "renamed" | "mode-changed" | "type-changed";
  beforeDigest: Sha256 | null;
  afterDigest: Sha256 | null;
}>;

/** One complete valid and reconstructible logical Candidate state. */
export type CandidateRevisionState = Readonly<{
  tree: string;
  candidateDigest: Sha256;
  productStateDigest: Sha256;
  knowledgeSetDigest: Sha256;
  diffDigest: Sha256;
  pathInventoryDigest: Sha256;
  artifactSetDigest: Sha256;
  descriptionCoverageDigest: Sha256;
  unchangedFromPredecessor: boolean;
  changedSubjects: readonly CandidateChangedSubject[];
}>;

export type CandidateRevisionCarrierVerification = Readonly<{
  /** SHA-256 of the exact canonical adjacent manifest bytes that were reopened. */
  manifestFileDigest: Sha256;
  /** Complete state independently reproduced from the reopened Carrier. */
  state: CandidateRevisionState;
  /** Exact implementation that independently reproduced the retained state. */
  observer: Readonly<{
    implementationId: string;
    implementationDigest: Sha256;
  }>;
}>;

/**
 * Runtime-injected physical proof boundary. The Control owner supplies bytes
 * but no expected Candidate facts, so the verifier cannot satisfy the seam by
 * echoing caller-selected state. Control never learns a Carrier Store path.
 *
 * The verifier closes over the exact admitted base, repository contract,
 * Atlas and Knowledge context, and predecessor selected by the Runtime. It
 * accepts no caller-supplied expected Candidate state and returns the complete
 * independently reproduced state and observer identity from a fresh Carrier
 * replay.
 */
export type CandidateRevisionCarrierVerifier = (
  input: Readonly<{
    manifestBytes: Uint8Array;
  }>,
) => Promise<CandidateRevisionCarrierVerification>;

export type CandidateRevisionRetentionInput = Readonly<{
  store: ControlRecordStore;
  activityId: string;
  observation: "initialization" | "builder-successor" | "readmission-rebind" | "integration-successor";
  candidateBaseCommit: string;
  carrierManifestBytes: Uint8Array;
  verifyCarrier: CandidateRevisionCarrierVerifier;
  limitations?: readonly string[];
  boundary: CandidateRevisionBoundaryReference;
  predecessor?: CandidateRevisionReference | null;
  builderAttempt?: CandidateRevisionAttemptReference | null;
  integrationAssessment?: CandidateRevisionIntegrationReference | null;
  observedAt: string;
  runtimeId: string;
}>;

/**
 * Exact persistence input plus independently compiled facts. Preparation reads
 * retained Control and Carrier state but does not append a file, revision, or
 * event. The caller may commit `files` and `append` through one owning atomic
 * Store or Activity-kernel file transaction.
 */
export type PreparedCandidateRevisionRetention = Readonly<{
  files: readonly [ControlRecordFileInput];
  append: ControlRecordStoreAppend;
  expected: Readonly<{
    revision: ControlRecordRevision;
    event: ControlRecordEventInput;
    carrierManifest: ControlRecordFile;
  }>;
}>;

export type CandidateRevisionRetentionCommitResult = Readonly<{
  append: ControlRecordStoreAppendResult | null;
  files: readonly ControlRecordFile[];
}>;

export type RetainedCandidateRevision = Readonly<{
  revision: ControlRecordRevision;
  event: ControlRecordEvent;
  carrierManifest: ControlRecordFile;
}>;

type CandidateRelationshipReference =
  | CandidateRevisionReference
  | CandidateRevisionBoundaryReference
  | CandidateRevisionAttemptReference
  | CandidateRevisionIntegrationReference;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.control-candidate-revision.${code}`, message);
}

function relationship(
  relation: "revises" | "governed-by" | "result-of" | "integrated-from",
  target: CandidateRelationshipReference,
): ControlRecordRelationship {
  return Object.freeze({
    relation,
    target: Object.freeze({
      kind: target.kind,
      id: target.id,
      revision: target.revision,
      digest: target.digest,
    }),
  });
}

function candidateIdentity(store: ControlRecordStore): string {
  const suffix = digestCanonical({
    recordKind: "candidate-revision",
    storeId: store.identity.storeId,
    processId: store.identity.processId,
  }).slice("sha256:".length);
  return `candidate-${suffix}`;
}

function eventIdentity(store: ControlRecordStore, activityId: string): string {
  const suffix = digestCanonical({
    eventKind: "candidate-revision-observed",
    storeId: store.identity.storeId,
    processId: store.identity.processId,
    activityId,
  }).slice("sha256:".length);
  return `event-candidate-revision-observed-${suffix}`;
}

function normalizedState(state: CandidateRevisionState): CandidateRevisionState {
  const paths = new Set<string>();
  const changedSubjects = [...state.changedSubjects].sort((left, right) =>
    compareCodePoints(
      `${left.path}\u0000${left.change}\u0000${left.beforeDigest ?? ""}\u0000${left.afterDigest ?? ""}`,
      `${right.path}\u0000${right.change}\u0000${right.beforeDigest ?? ""}\u0000${right.afterDigest ?? ""}`,
    ));
  for (const subject of changedSubjects) {
    if (paths.has(subject.path)) {
      fail("changed-subject", "Candidate Revision cannot report one changed path more than once");
    }
    paths.add(subject.path);
    const validDigestShape = subject.change === "added"
      ? subject.beforeDigest === null && subject.afterDigest !== null
      : subject.change === "deleted"
        ? subject.beforeDigest !== null && subject.afterDigest === null
        : subject.beforeDigest !== null && subject.afterDigest !== null;
    if (!validDigestShape) {
      fail(
        "changed-subject",
        "Candidate Revision changed-subject digests do not match the reported change kind",
      );
    }
  }
  return Object.freeze({
    ...state,
    changedSubjects: Object.freeze(changedSubjects.map((subject) => Object.freeze({ ...subject }))),
  });
}

function normalizedRetentionState(input: Readonly<{
  observation: "initialization" | "builder-successor" | "readmission-rebind" | "integration-successor";
  reproduced: CandidateRevisionState;
  predecessor: ControlRecordRevision | null;
}>): CandidateRevisionState {
  const reproduced = normalizedState(input.reproduced);
  if (input.observation !== "readmission-rebind") return reproduced;
  if (input.predecessor === null) {
    fail("predecessor", "Candidate readmission rebind has no exact retained predecessor state");
  }
  const predecessorState = jsonObject(
    input.predecessor.payload.state,
    "predecessor state",
  );
  if (typeof predecessorState.unchangedFromPredecessor !== "boolean") {
    fail(
      "predecessor",
      "Candidate readmission predecessor lacks its exact retained comparison fact",
    );
  }

  // A readmission rebind preserves the prior Revision's complete state
  // byte-for-byte. The fresh Carrier replay necessarily observes that its
  // content equals the immediately preceding Revision, but that newly sampled
  // comparison is not allowed to rewrite the retained historical state fact.
  // All Carrier-derived fields remain independently reproduced and are
  // compared against the predecessor below.
  return Object.freeze({
    ...reproduced,
    unchangedFromPredecessor: predecessorState.unchangedFromPredecessor,
  });
}

function candidateStateDigest(
  candidateBaseCommit: string,
  state: CandidateRevisionState,
): Sha256 {
  return digestCanonical({
    schema: "lifecycle.delivery-candidate-state.v1",
    candidateBaseCommit,
    tree: state.tree,
    productStateDigest: state.productStateDigest,
    knowledgeSetDigest: state.knowledgeSetDigest,
    diffDigest: state.diffDigest,
    pathInventoryDigest: state.pathInventoryDigest,
    artifactSetDigest: state.artifactSetDigest,
    descriptionCoverageDigest: state.descriptionCoverageDigest,
    changedSubjects: state.changedSubjects,
  });
}

type CandidateBoundaryBasis = Readonly<{
  productBaseCommit: string;
  productBaseTree: string;
  productStateDigest: Sha256;
  knowledgeSetDigest: Sha256;
}>;

function jsonObject(value: unknown, label: string): ControlJsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("boundary", `Candidate Work Boundary ${label} is not one exact object`);
  }
  return value as ControlJsonObject;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") {
    fail("boundary", `Candidate Work Boundary ${label} is not one exact string`);
  }
  return value;
}

function digestValue(value: unknown, label: string): Sha256 {
  const selected = stringValue(value, label);
  if (!/^sha256:[a-f0-9]{64}$/u.test(selected)) {
    fail("boundary", `Candidate Work Boundary ${label} is not one lowercase SHA-256 digest`);
  }
  return selected as Sha256;
}

function boundaryBasis(
  store: ControlRecordStore,
  boundary: CandidateRevisionBoundaryReference,
): CandidateBoundaryBasis {
  const retained = store.getRevision(boundary.id, boundary.revision);
  if (
    retained === null ||
    retained.recordKind !== "work-boundary" ||
    retained.digest !== boundary.digest
  ) {
    fail("boundary", "Candidate Revision does not bind one exact retained Work Boundary");
  }
  const basis = jsonObject(retained.payload.basis, "basis");
  return Object.freeze({
    productBaseCommit: stringValue(basis.productBaseCommit, "product-base commit"),
    productBaseTree: stringValue(basis.productBaseTree, "product-base tree"),
    productStateDigest: digestValue(
      basis.productStateDigest,
      "Product State digest",
    ),
    knowledgeSetDigest: digestValue(
      basis.knowledgeSetDigest,
      "Knowledge Set digest",
    ),
  });
}

function assertLocallyReproducibleState(input: Readonly<{
  observation: "initialization" | "builder-successor" | "readmission-rebind" | "integration-successor";
  candidateBaseCommit: string;
  state: CandidateRevisionState;
  basis: CandidateBoundaryBasis;
  predecessor: ControlRecordRevision | null;
}>): void {
  if (input.observation === "initialization" && input.candidateBaseCommit !== input.basis.productBaseCommit) {
    fail("base", "Candidate Revision base commit does not match its exact Work Boundary");
  }
  if (input.state.productStateDigest !== input.state.artifactSetDigest) {
    fail(
      "artifact-set",
      "Candidate Product State and artifact-set digests do not reproduce the same exact entries",
    );
  }
  if (input.state.candidateDigest !== candidateStateDigest(input.candidateBaseCommit, input.state)) {
    fail(
      "state-digest",
      "Candidate digest does not reproduce its complete normalized Candidate state",
    );
  }

  if (input.observation === "initialization") {
    if (
      input.state.tree !== input.basis.productBaseTree ||
      input.state.productStateDigest !== input.basis.productStateDigest ||
      input.state.knowledgeSetDigest !== input.basis.knowledgeSetDigest ||
      input.state.diffDigest !== sha256Bytes(new Uint8Array()) ||
      !input.state.unchangedFromPredecessor ||
      input.state.changedSubjects.length !== 0
    ) {
      fail(
        "initial-state",
        "Candidate initialization does not reproduce the exact unchanged Work Boundary product base",
      );
    }
    return;
  }

  if (input.predecessor === null) {
    fail("predecessor", "Candidate successor has no exact retained predecessor state");
  }
  const predecessorState = jsonObject(input.predecessor.payload.state, "predecessor state");
  const predecessorCandidateDigest = stringValue(
    predecessorState.candidateDigest,
    "predecessor Candidate digest",
  );
  if (
    input.observation === "builder-successor" &&
    input.state.unchangedFromPredecessor !==
      (input.state.candidateDigest === predecessorCandidateDigest)
  ) {
    fail(
      "predecessor-comparison",
      "Candidate successor does not reproduce its exact predecessor comparison",
    );
  }
}

function candidateCarrierManifestFile(input: Readonly<{
  store: ControlRecordStore;
  bytes: Uint8Array;
  observedAt: string;
}>): Readonly<{
  file: ControlRecordFileInput;
  descriptor: ControlRecordFile;
}> {
  const proposed: ControlRecordFileInput = Object.freeze({
    bytes: input.bytes,
    mediaType: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
    purpose: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
    createdAt: input.observedAt,
  });
  const proposedDescriptor = compileControlRecordFile(proposed);
  const existing = input.store.listRetainedFiles().find(
    ({ digest }) => digest === proposedDescriptor.digest,
  );
  if (existing === undefined) {
    return Object.freeze({ file: proposed, descriptor: proposedDescriptor });
  }
  if (
    existing.byteLength !== proposedDescriptor.byteLength ||
    existing.mediaType !== proposedDescriptor.mediaType ||
    existing.purpose !== proposedDescriptor.purpose
  ) {
    fail(
      "carrier-manifest",
      "Candidate Carrier manifest bytes conflict with an existing adjacent-file descriptor",
    );
  }
  const file: ControlRecordFileInput = Object.freeze({
    ...proposed,
    createdAt: existing.createdAt,
  });
  const descriptor = compileControlRecordFile(file);
  if (canonicalJson(descriptor) !== canonicalJson(existing)) {
    fail(
      "carrier-manifest",
      "Candidate Carrier manifest does not reproduce its existing adjacent-file descriptor",
    );
  }
  return Object.freeze({ file, descriptor });
}

function semanticMarkdown(input: Readonly<{
  observation: "initialization" | "builder-successor" | "readmission-rebind" | "integration-successor";
  candidateBaseCommit: string;
  carrierManifestDigest: Sha256;
  state: ControlJsonObject;
}>): string {
  return [
    "# Candidate Revision",
    "",
    `- Observation: ${input.observation}`,
    `- Immutable base: ${input.candidateBaseCommit}`,
    `- Candidate tree: ${String(input.state.tree)}`,
    `- Candidate digest: ${String(input.state.candidateDigest)}`,
    `- Carrier manifest: ${input.carrierManifestDigest}`,
    `- Changed subjects: ${(input.state.changedSubjects as readonly unknown[]).length}`,
    "",
  ].join("\n");
}

function assertObservationRelationships(input: Readonly<{
  observation: "initialization" | "builder-successor" | "readmission-rebind" | "integration-successor";
  predecessor: CandidateRevisionReference | null;
  builderAttempt: CandidateRevisionAttemptReference | null;
}>): void {
  if (input.observation === "initialization") {
    if (input.predecessor !== null || input.builderAttempt !== null) {
      fail("succession", "Candidate initialization cannot bind a predecessor or builder Attempt");
    }
    return;
  }
  if (input.predecessor === null) {
    fail("succession", "Every Candidate successor must bind one exact predecessor");
  }
  if ((input.observation === "builder-successor") !== (input.builderAttempt !== null)) {
    fail(
      "builder-attempt",
      "A builder successor requires one exact builder Attempt and every other observation forbids it",
    );
  }
}

/**
 * Prepare one complete Candidate Revision without persisting it. The injected
 * verifier independently reopens the exact manifest-selected Carrier and
 * proves its root tree before exact file, append, and expected compiled facts
 * are returned to the owning atomic commit boundary.
 */
export async function prepareCandidateRevisionRetention(
  input: CandidateRevisionRetentionInput,
): Promise<PreparedCandidateRevisionRetention> {
  const activityId = controlIdentifier(input.activityId, "Candidate observation activity identity");
  const predecessor = input.predecessor ?? null;
  const builderAttempt = input.builderAttempt ?? null;
  const integrationAssessment = input.integrationAssessment ?? null;
  let integrationFactsDigest: Sha256 | null = null;
  if ((input.observation === "integration-successor") !== (integrationAssessment !== null)) {
    fail("integration", "Only an integration successor must bind one exact Integration Assessment");
  }
  assertObservationRelationships({
    observation: input.observation,
    predecessor,
    builderAttempt,
  });

  const recordId = predecessor?.id ?? candidateIdentity(input.store);
  const revision = predecessor === null ? 1 : predecessor.revision + 1;
  let retainedPredecessor: ControlRecordRevision | null = null;
  if (predecessor !== null) {
    retainedPredecessor = input.store.getRevision(predecessor.id, predecessor.revision);
    if (
      retainedPredecessor === null ||
      retainedPredecessor.recordKind !== "candidate-revision" ||
      retainedPredecessor.digest !== predecessor.digest
    ) {
      fail("predecessor", "Candidate successor does not bind one exact retained predecessor");
    }
    if (input.observation !== "integration-successor" && retainedPredecessor.payload.candidateBaseCommit !== input.candidateBaseCommit) {
      fail("base", "Candidate succession cannot change its immutable base commit");
    }
  }

  if (integrationAssessment !== null) {
    const assessment = input.store.getRevision(integrationAssessment.id, integrationAssessment.revision);
    if (assessment === null || assessment.recordKind !== "integration-assessment" || assessment.digest !== integrationAssessment.digest) {
      fail("integration", "Candidate successor does not bind an exact retained Integration Assessment");
    }
    const assessmentPayload = parseFoundationIntegrationAssessmentPayloadV1(assessment.payload);
    integrationFactsDigest = assessmentPayload.validation.factsDigest;
    const integrates = assessment.relationships.filter(({ relation }) => relation === "integrates");
    const governedBy = assessment.relationships.filter(({ relation }) => relation === "governed-by");
    if (assessmentPayload.outcome !== "constructed" || assessmentPayload.canonicalParent.commit !== input.candidateBaseCommit ||
      integrates.length !== 1 || canonicalJson(integrates[0]!.target) !== canonicalJson(predecessor) ||
      governedBy.length !== 1 || canonicalJson(governedBy[0]!.target) !== canonicalJson(input.boundary)) {
      fail("integration", "Candidate integration must reproduce its exact constructed Assessment, source, parent, and Boundary");
    }
  }

  const manifestBytes = Uint8Array.from(input.carrierManifestBytes);
  let parsedManifest;
  try {
    parsedManifest = parseCandidateRevisionCarrierManifest(
      manifestBytes,
      FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
    );
  } catch {
    fail(
      "carrier-manifest",
      "Candidate Carrier manifest bytes do not encode one exact canonical Candidate Revision Carrier manifest",
    );
  }
  const carrier = candidateCarrierManifestFile({
    store: input.store,
    bytes: manifestBytes,
    observedAt: input.observedAt,
  });
  const carrierFile = carrier.file;
  const carrierManifest = carrier.descriptor;
  const carrierReference: ControlJsonObject = Object.freeze({
    digest: carrierManifest.digest,
    byteLength: carrierManifest.byteLength,
    mediaType: carrierManifest.mediaType,
    purpose: carrierManifest.purpose,
  });

  const verificationBytes = Uint8Array.from(manifestBytes);
  const verification = await input.verifyCarrier(Object.freeze({
    manifestBytes: verificationBytes,
  }));
  if (
    compileControlRecordFile({ ...carrierFile, bytes: verificationBytes }).digest !== carrierManifest.digest ||
    verification.manifestFileDigest !== carrierManifest.digest
  ) {
    fail("carrier-manifest", "Candidate Carrier verifier did not reopen the exact manifest bytes");
  }
  const state = normalizedRetentionState({
    observation: input.observation,
    reproduced: verification.state,
    predecessor: retainedPredecessor,
  });
  if (integrationFactsDigest !== null && integrationFactsDigest !== foundationIntegrationValidationFactsDigestV1({
    manifestFileDigest: carrierManifest.digest, state, observer: verification.observer,
  })) fail("integration", "Candidate integration does not reproduce its Assessment's exact constructed observation");
  if (parsedManifest.rootTree !== state.tree) {
    fail(
      "carrier-subject",
      "Candidate Carrier manifest root tree does not bind the exact reproduced Candidate state",
    );
  }
  assertLocallyReproducibleState({
    observation: input.observation,
    candidateBaseCommit: input.candidateBaseCommit,
    state,
    basis: boundaryBasis(input.store, input.boundary),
    predecessor: retainedPredecessor,
  });

  if (input.observation === "readmission-rebind") {
    if (
      retainedPredecessor === null ||
      canonicalJson(state) !== canonicalJson(retainedPredecessor.payload.state) ||
      canonicalJson(carrierReference) !== canonicalJson(retainedPredecessor.payload.carrierManifest)
    ) {
      fail(
        "rebind",
        "Candidate readmission rebind requires byte-identical state and Carrier binding from its predecessor",
      );
    }
    const priorBoundary = retainedPredecessor.relationships.filter(
      ({ relation }) => relation === "governed-by",
    );
    if (
      priorBoundary.length !== 1 ||
      canonicalJson(priorBoundary[0]!.target) === canonicalJson(input.boundary)
    ) {
      fail(
        "rebind-boundary",
        "Candidate readmission rebind requires one different successor Work Boundary",
      );
    }
  }

  const payload: ControlJsonObject = Object.freeze({
    schema: "lifecycle.candidate-revision-payload.v3",
    profileId: "lifecycle.candidate-revision.observation.v2",
    observation: input.observation,
    candidateBaseCommit: input.candidateBaseCommit,
    carrierManifest: carrierReference,
    state,
    observer: Object.freeze({ ...verification.observer }),
    limitations: Object.freeze(sortUniqueCodePoints(input.limitations ?? [])),
  });
  const relationships = Object.freeze([
    ...(predecessor === null ? [] : [relationship("revises", predecessor)]),
    relationship("governed-by", input.boundary),
    ...(builderAttempt === null ? [] : [relationship("result-of", builderAttempt)]),
    ...(integrationAssessment === null ? [] : [relationship("integrated-from", integrationAssessment)]),
  ]);
  const revisionInput = Object.freeze({
    recordId,
    recordKind: "candidate-revision",
    revision,
    producer: Object.freeze({ kind: "runtime" as const, id: input.runtimeId }),
    semanticAuthor: Object.freeze({ kind: "runtime" as const, id: input.runtimeId }),
    semanticAuthority: "runtime-observed" as const,
    createdAt: input.observedAt,
    semanticMarkdown: semanticMarkdown({
      observation: input.observation,
      candidateBaseCommit: input.candidateBaseCommit,
      carrierManifestDigest: carrierManifest.digest,
      state,
    }),
    payload,
    relationships,
  });
  const compiled = compileControlRecordRevision(input.store.identity.processId, revisionInput);
  assertDeliveryControlRecordPolicy(compiled);
  assertDeliveryControlRecordPayload(compiled);
  const event: ControlRecordEventInput = Object.freeze({
    eventId: eventIdentity(input.store, activityId),
    eventKind: "candidate-revision-observed",
    occurredAt: input.observedAt,
    actor: Object.freeze({ kind: "runtime", id: input.runtimeId }),
    subject: Object.freeze({
      recordId: compiled.recordId,
      revision: compiled.revision,
      digest: compiled.digest,
    }),
    payload: Object.freeze({ activityId }),
  });
  const append: ControlRecordStoreAppend = Object.freeze({
    revision: revisionInput,
    event,
  });
  return Object.freeze({
    files: Object.freeze([carrierFile]) as readonly [ControlRecordFileInput],
    append,
    expected: Object.freeze({
      revision: compiled,
      event,
      carrierManifest,
    }),
  });
}

function eventInputProjection(event: ControlRecordEvent): ControlRecordEventInput {
  return Object.freeze({
    eventId: event.eventId,
    eventKind: event.eventKind,
    occurredAt: event.occurredAt,
    actor: event.actor,
    subject: event.subject,
    payload: event.payload,
  });
}

/**
 * Prove that an owning atomic commit retained exactly the values compiled by
 * Candidate preparation. This finalizer is deliberately independent of the
 * commit mechanism: the Process owner may use the Activity kernel's
 * `commitWithFiles`, while the Candidate owner continues to own the exact
 * revision, event, and adjacent-manifest comparison.
 */
export function finalizeCandidateRevisionRetention(
  prepared: PreparedCandidateRevisionRetention,
  committed: CandidateRevisionRetentionCommitResult,
): RetainedCandidateRevision {
  if (committed.append === null || committed.files.length !== 1) {
    fail("retention", "Candidate observation did not retain one exact prepared append and file");
  }
  if (committed.append.revision === null) {
    fail("retention", "Candidate observation did not retain its exact revision");
  }
  if (
    canonicalJson(committed.append.revision) !== canonicalJson(prepared.expected.revision) ||
    canonicalJson(eventInputProjection(committed.append.event)) !==
      canonicalJson(prepared.expected.event) ||
    canonicalJson(committed.files[0]) !== canonicalJson(prepared.expected.carrierManifest)
  ) {
    fail("retention", "Candidate observation did not retain its exact prepared facts");
  }
  return Object.freeze({
    revision: committed.append.revision,
    event: committed.append.event,
    carrierManifest: prepared.expected.carrierManifest,
  });
}

/**
 * Direct Store helper for isolated Control construction. Process-owned
 * promotion commits the same prepared values through its Activity checkpoint
 * so the Candidate event, adjacent Carrier manifest, and recovery support are
 * one durability boundary.
 */
export async function retainCandidateRevision(
  input: CandidateRevisionRetentionInput,
): Promise<RetainedCandidateRevision> {
  const prepared = await prepareCandidateRevisionRetention(input);
  const committed = await input.store.appendWithFiles({
    files: prepared.files,
    appends: Object.freeze([prepared.append]),
  });
  if (committed.appends.length !== 1) {
    fail("retention", "Candidate observation did not retain one exact prepared append and file");
  }
  return finalizeCandidateRevisionRetention(prepared, {
    append: committed.appends[0] ?? null,
    files: committed.files,
  });
}
