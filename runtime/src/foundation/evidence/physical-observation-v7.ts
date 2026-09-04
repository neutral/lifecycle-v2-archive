import type {
  EvidencePacketArtifactObservation,
  EvidencePacketDescriptionObservation,
} from "../control/evidence-packet.js";
import type { ControlRecordStore } from "../control/store.js";
import type {
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordRelationshipTarget,
  ControlRecordRevision,
} from "../control/types.js";
import { FoundationError } from "../error.js";
import type {
  FoundationDescriptionSpec,
  FoundationKnowledgeRecord,
  FoundationKnowledgeSet,
} from "../knowledge/types.js";
import type {
  FoundationEvaluationObservationContextV7,
  FoundationEvaluationObservationOwnerV7,
  FoundationEvaluationPhysicalObservationV7,
} from "../process/evaluation-finalization-v7.js";
import type { FoundationReviewerProjectionObservation } from "../projection/execution.js";
import {
  pathWithin,
  productStateRole,
} from "../repository/product-state.js";
import type {
  FoundationGitTreeEntry,
  FoundationRepositoryContract,
} from "../repository/types.js";
import {
  canonicalJson,
  digestCanonical,
  type Sha256,
} from "../validation/canonical.js";
import { compareCodePoints, sortUniqueCodePoints } from "../validation/ordering.js";
import {
  deriveCandidateRevisionCarrierAdmittedContext,
} from "../candidate/carrier-observation-context.js";
import {
  type CandidateRevisionCarrierStateObservation,
  withCandidateRevisionCarrierStateRepository,
} from "../candidate/carrier-state-observer.js";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
} from "../candidate/carrier-types.js";
import { isProcessCancellationError } from "../../util/process.js";

const MAXIMUM_ARTIFACT_BYTES = 256 * 1024 * 1024;
const MAXIMUM_DIFF_BYTES = 256 * 1024 * 1024;
const MAXIMUM_CHANGED_SUBJECTS = 16_384;
const MAXIMUM_ARTIFACTS = 4_096;
const MAXIMUM_DESCRIPTION_SUBJECTS = 4_096;

const OBSERVER_PROFILE = Object.freeze({
  schema: "lifecycle.evidence-physical-observer-profile.v1" as const,
  id: "lifecycle-evidence-physical-observer-v7" as const,
  version: "1" as const,
  algorithms: Object.freeze([
    "store-derived-seal-candidate-and-boundary",
    "two-sided-retained-carrier-reopen",
    "independently-verified-sealed-carrier-reproduction",
    "candidate-knowledge-and-description-reproduction",
    "exact-base-to-candidate-diff-reproduction",
    "runtime-observed-artifact-and-coverage-compilation",
  ]),
  bounds: Object.freeze({
    maximumArtifactBytes: MAXIMUM_ARTIFACT_BYTES,
    maximumDiffBytes: MAXIMUM_DIFF_BYTES,
    maximumChangedSubjects: MAXIMUM_CHANGED_SUBJECTS,
    maximumArtifacts: MAXIMUM_ARTIFACTS,
    maximumDescriptionSubjects: MAXIMUM_DESCRIPTION_SUBJECTS,
  }),
});

export const FOUNDATION_EVIDENCE_PHYSICAL_OBSERVER_V7 = Object.freeze({
  id: OBSERVER_PROFILE.id,
  version: OBSERVER_PROFILE.version,
  implementationDigest: digestCanonical(OBSERVER_PROFILE),
});

export type FoundationEvaluationPhysicalObservationOwnerV7Input = Readonly<{
  machineHome: string;
  targetRepository: string;
  contract: FoundationRepositoryContract;
}>;

export type FoundationReviewerProjectionCandidateObservationV7Input =
  FoundationEvaluationPhysicalObservationOwnerV7Input & Readonly<{
    store: ControlRecordStore;
    boundary: ControlRecordRevision;
    candidateRevision: ControlRecordRevision;
    seal: ControlRecordRevision;
  }>;

type CandidateAvailableState = Readonly<{
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

type CandidateChangedSubject = Readonly<{
  path: string;
  change: "added" | "modified" | "deleted" | "renamed" | "mode-changed" | "type-changed";
  beforeDigest: Sha256 | null;
  afterDigest: Sha256 | null;
}>;

type BoundaryArtifact = Readonly<{
  id: string;
  path: string;
  role: string;
  mustChange: boolean;
  obligationIds: readonly string[];
}>;

type ExactSubjects = Readonly<{
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
  seal: ControlRecordRevision;
  candidateObservation: "initialization" | "builder-successor" | "readmission-rebind";
  state: CandidateAvailableState;
  artifacts: readonly BoundaryArtifact[];
  predecessorCandidateDigest: Sha256 | null;
}>;

type ImmutableCandidateMaterial = Readonly<{
  baseTreeEntries: readonly FoundationGitTreeEntry[];
  treeEntries: readonly FoundationGitTreeEntry[];
  knowledge: FoundationKnowledgeSet;
  diff: Readonly<{ digest: Sha256; bytes: Uint8Array }>;
  changedSubjects: readonly CandidateChangedSubject[];
  contentDigests: ReadonlyMap<string, Sha256>;
}>;

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const GIT_OBJECT = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.evidence-physical-observation-v7.${code}`, message);
}

function object(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== "object") {
    fail("retained-fact", `${label} must be one exact retained object`);
  }
  return value as ControlJsonObject;
}

function array(value: ControlJsonValue | undefined, label: string): readonly ControlJsonValue[] {
  if (!Array.isArray(value)) fail("retained-fact", `${label} must be one exact retained array`);
  return value;
}

function string(value: ControlJsonValue | undefined, label: string): string {
  if (typeof value !== "string") fail("retained-fact", `${label} must be one exact retained string`);
  return value;
}

function boolean(value: ControlJsonValue | undefined, label: string): boolean {
  if (typeof value !== "boolean") fail("retained-fact", `${label} must be one exact retained boolean`);
  return value;
}

function positiveInteger(value: ControlJsonValue | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    fail("retained-fact", `${label} must be one positive safe integer`);
  }
  return value;
}

function digest(value: ControlJsonValue | undefined, label: string): Sha256 {
  const selected = string(value, label);
  if (!DIGEST.test(selected)) fail("retained-fact", `${label} must be one lowercase SHA-256 digest`);
  return selected as Sha256;
}

function nullableDigest(value: ControlJsonValue | undefined, label: string): Sha256 | null {
  return value === null ? null : digest(value, label);
}

function exactRetained(
  store: ControlRecordStore,
  supplied: ControlRecordRevision,
  kind: string,
  label: string,
): ControlRecordRevision {
  const retained = store.getRevision(supplied.recordId, supplied.revision);
  if (
    retained === null || retained.recordKind !== kind || retained.digest !== supplied.digest ||
    retained.processId !== store.identity.processId || canonicalJson(retained) !== canonicalJson(supplied)
  ) {
    fail("subject", `${label} does not reproduce one exact retained ${kind} revision`);
  }
  return retained;
}

function sameReference(
  left: Readonly<{ id: string; revision: number; digest: Sha256 }> | ControlRecordRelationshipTarget,
  right: ControlRecordRevision,
): boolean {
  return left.id === right.recordId && left.revision === right.revision && left.digest === right.digest;
}

function oneRelationship(
  revision: ControlRecordRevision,
  relation: string,
  kind: string,
): ControlRecordRelationshipTarget {
  const selected = revision.relationships.filter(({ relation: candidate }) => candidate === relation);
  if (selected.length !== 1 || selected[0]!.target.kind !== kind) {
    fail("relationship", `${revision.recordKind} lacks its exact ${relation} ${kind} relationship`);
  }
  return selected[0]!.target;
}

function candidateState(candidate: ControlRecordRevision): CandidateAvailableState {
  if (
    candidate.payload.schema !== "lifecycle.candidate-revision-payload.v2"
  ) fail("candidate", "Physical Evidence requires one exact reconstructible Candidate Revision");
  const value = object(candidate.payload.state, "Candidate Revision state");
  const tree = string(value.tree, "Candidate tree");
  if (!GIT_OBJECT.test(tree)) fail("candidate", "Candidate tree identity is invalid");
  const changedSubjects = Object.freeze(array(value.changedSubjects, "Candidate changed subjects").map((item) => {
    const changed = object(item, "Candidate changed subject");
    const change = string(changed.change, "Candidate change kind") as CandidateChangedSubject["change"];
    if (!(["added", "modified", "deleted", "renamed", "mode-changed", "type-changed"] as const).includes(change)) {
      fail("candidate", "Candidate changed subject has an unsupported change kind");
    }
    return Object.freeze({
      path: string(changed.path, "Candidate changed path"),
      change,
      beforeDigest: nullableDigest(changed.beforeDigest, "Candidate before digest"),
      afterDigest: nullableDigest(changed.afterDigest, "Candidate after digest"),
    });
  }));
  if (changedSubjects.length > MAXIMUM_CHANGED_SUBJECTS) {
    fail("bound", "Candidate changed subjects exceed the Evidence observer profile");
  }
  return Object.freeze({
    tree,
    candidateDigest: digest(value.candidateDigest, "Candidate digest"),
    productStateDigest: digest(value.productStateDigest, "Candidate Product State digest"),
    knowledgeSetDigest: digest(value.knowledgeSetDigest, "Candidate Knowledge Set digest"),
    diffDigest: digest(value.diffDigest, "Candidate diff digest"),
    pathInventoryDigest: digest(value.pathInventoryDigest, "Candidate path inventory digest"),
    artifactSetDigest: digest(value.artifactSetDigest, "Candidate artifact-set digest"),
    descriptionCoverageDigest: digest(
      value.descriptionCoverageDigest,
      "Candidate Description-coverage digest",
    ),
    unchangedFromPredecessor: boolean(
      value.unchangedFromPredecessor,
      "Candidate predecessor comparison",
    ),
    changedSubjects,
  });
}

function candidateObservation(
  candidate: ControlRecordRevision,
): ExactSubjects["candidateObservation"] {
  const observation = string(
    candidate.payload.observation,
    "Candidate Revision observation",
  );
  if (
    observation !== "initialization" &&
    observation !== "builder-successor" &&
    observation !== "readmission-rebind"
  ) fail("candidate", "Candidate Revision has an unknown observation kind");
  return observation;
}

type CandidateCarrierManifestReference = Readonly<{
  digest: Sha256;
  byteLength: number;
  mediaType: typeof FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE;
  purpose: typeof FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE;
}>;

function candidateCarrierManifestReference(
  candidate: ControlRecordRevision,
): CandidateCarrierManifestReference {
  const selected = object(
    candidate.payload.carrierManifest,
    "Candidate Revision Carrier manifest reference",
  );
  if (
    Object.keys(selected).sort().join("\u0000") !==
      ["byteLength", "digest", "mediaType", "purpose"].sort().join("\u0000") ||
    selected.mediaType !== FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE ||
    selected.purpose !== FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE
  ) {
    fail("carrier", "Candidate Revision does not select one exact Carrier manifest descriptor");
  }
  return Object.freeze({
    digest: digest(selected.digest, "Candidate Revision Carrier manifest digest"),
    byteLength: positiveInteger(
      selected.byteLength,
      "Candidate Revision Carrier manifest byte length",
    ),
    mediaType: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
    purpose: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
  });
}

function boundaryArtifacts(boundary: ControlRecordRevision): readonly BoundaryArtifact[] {
  if (boundary.payload.schema !== "lifecycle.work-boundary-payload.v4") {
    fail("boundary", "Physical Evidence requires one Foundation Work Boundary");
  }
  const mandate = object(boundary.payload.mandate, "Work Boundary mandate");
  const values = array(mandate.artifacts, "Work Boundary artifacts");
  if (values.length > MAXIMUM_ARTIFACTS) fail("bound", "Work Boundary artifacts exceed the Evidence profile");
  const byId = new Set<string>();
  const byPath = new Set<string>();
  const artifacts = values.map((value) => {
    const artifact = object(value, "Work Boundary artifact");
    const selected = Object.freeze({
      id: string(artifact.id, "Work Boundary artifact identity"),
      path: string(artifact.path, "Work Boundary artifact path"),
      role: string(artifact.role, "Work Boundary artifact role"),
      mustChange: boolean(artifact.mustChange, "Work Boundary artifact change requirement"),
      obligationIds: Object.freeze(sortUniqueCodePoints(array(
        artifact.obligationIds,
        "Work Boundary artifact obligations",
      ).map((item) => string(item, "Work Boundary artifact obligation")))),
    });
    if (byId.has(selected.id) || byPath.has(selected.path)) {
      fail("boundary", "Work Boundary repeats an artifact identity or path");
    }
    byId.add(selected.id);
    byPath.add(selected.path);
    return selected;
  });
  return Object.freeze(artifacts.sort((left, right) => compareCodePoints(left.id, right.id)));
}

function predecessorCandidateDigest(
  store: ControlRecordStore,
  candidate: ControlRecordRevision,
): Sha256 | null {
  const selected = candidate.relationships.filter(({ relation }) => relation === "revises");
  if (selected.length === 0) return null;
  if (selected.length !== 1 || selected[0]!.target.kind !== "candidate-revision") {
    fail("candidate", "Candidate predecessor relationship is invalid");
  }
  const target = selected[0]!.target;
  const predecessor = store.getRevision(target.id, target.revision);
  if (
    predecessor === null || predecessor.recordKind !== "candidate-revision" ||
    predecessor.digest !== target.digest
  ) fail("candidate", "Candidate predecessor does not resolve exactly");
  return digest(object(predecessor.payload.state, "Candidate predecessor state").candidateDigest, "Candidate predecessor digest");
}

function exactSubjects(input: FoundationReviewerProjectionCandidateObservationV7Input): ExactSubjects {
  const boundary = exactRetained(input.store, input.boundary, "work-boundary", "Active Work Boundary");
  const candidate = exactRetained(
    input.store,
    input.candidateRevision,
    "candidate-revision",
    "Candidate Revision",
  );
  const seal = exactRetained(input.store, input.seal, "candidate-seal", "Candidate Seal");
  if (
    input.store.identity.targetId !== input.contract.targetId
  ) fail("target", "Candidate, repository contract, and Control Store identities differ");
  const state = input.store.state();
  if (
    state.subjects.activeBoundary === null || state.subjects.candidate === null ||
    state.subjects.seal === null || !sameReference(state.subjects.activeBoundary, boundary) ||
    !sameReference(state.subjects.candidate, candidate) || !sameReference(state.subjects.seal, seal)
  ) fail("standing", "Physical observation does not select the exact current evaluation subjects");
  if (
    !sameReference(oneRelationship(candidate, "governed-by", "work-boundary"), boundary) ||
    !sameReference(oneRelationship(seal, "seals", "candidate-revision"), candidate) ||
    !sameReference(oneRelationship(seal, "governed-by", "work-boundary"), boundary)
  ) fail("relationship", "Candidate Seal closure does not bind the exact evaluation subjects");
  if (
    seal.payload.schema !== "lifecycle.candidate-seal-payload.v2" ||
    seal.payload.carrierIntegrity !== "verified" ||
    seal.payload.carrierReconstruction !== "verified" ||
    seal.payload.evaluationSubject !== "established" ||
    seal.payload.candidateReobservation !== "exact-match" || seal.payload.untrackedProduct !== "absent" ||
    seal.payload.controlExclusion !== "verified"
  ) fail("seal", "Candidate Seal does not establish every required physical invariant");
  return Object.freeze({
    boundary,
    candidate,
    seal,
    candidateObservation: candidateObservation(candidate),
    state: candidateState(candidate),
    artifacts: boundaryArtifacts(boundary),
    predecessorCandidateDigest: predecessorCandidateDigest(input.store, candidate),
  });
}

function normalizedObservedState(
  subjects: ExactSubjects,
  observed: CandidateRevisionCarrierStateObservation,
): CandidateRevisionCarrierStateObservation["state"] {
  if (subjects.candidateObservation !== "readmission-rebind") return observed.state;
  if (
    subjects.predecessorCandidateDigest === null ||
    observed.state.candidateDigest !== subjects.predecessorCandidateDigest
  ) {
    fail(
      "carrier-mismatch",
      "Readmission Carrier does not reproduce the byte-identical predecessor Candidate",
    );
  }
  return Object.freeze({
    ...observed.state,
    unchangedFromPredecessor: subjects.state.unchangedFromPredecessor,
  });
}

type RetainedCarrierRepositoryOperation<T> = (
  repository: string,
  observation: CandidateRevisionCarrierStateObservation,
) => Promise<T>;

async function withRetainedCarrierRepository<T>(input: Readonly<{
  physical: FoundationEvaluationPhysicalObservationOwnerV7Input;
  store: ControlRecordStore;
  subjects: ExactSubjects;
  includeArtifactContent: boolean;
}>, operation: RetainedCarrierRepositoryOperation<T>): Promise<T> {
  const reference = candidateCarrierManifestReference(input.subjects.candidate);
  const retained = await input.store.readRetainedFile(reference.digest);
  if (
    retained === null || retained.bytes.byteLength !== reference.byteLength ||
    retained.descriptor.digest !== reference.digest ||
    retained.descriptor.byteLength !== reference.byteLength ||
    retained.descriptor.mediaType !== reference.mediaType ||
    retained.descriptor.purpose !== reference.purpose
  ) {
    fail("carrier", "Sealed Candidate Carrier manifest is unavailable or substituted");
  }
  const admitted = await deriveCandidateRevisionCarrierAdmittedContext({
    machineHome: input.physical.machineHome,
    repository: input.physical.targetRepository,
    store: input.store,
    boundary: input.subjects.boundary,
  });
  if (canonicalJson(admitted.contract) !== canonicalJson(input.physical.contract)) {
    fail("contract", "Evidence contract does not reproduce the admitted Work Boundary context");
  }
  if (
    input.subjects.candidate.payload.candidateBaseCommit !== admitted.epoch.commit
  ) {
    fail("candidate", "Sealed Candidate immutable base differs from its admitted context");
  }
  return await withCandidateRevisionCarrierStateRepository({
    machineHome: input.physical.machineHome,
    manifestBytes: retained.bytes,
    admitted,
    predecessor: input.subjects.predecessorCandidateDigest === null
      ? null
      : Object.freeze({
          candidateDigest: input.subjects.predecessorCandidateDigest,
        }),
    ...(input.includeArtifactContent
      ? {
          evidence: Object.freeze({
            contentDigestPaths: Object.freeze(
              input.subjects.artifacts.map(({ path }) => path),
            ),
          }),
        }
      : {}),
  }, async (repository, observed) => {
    if (
      observed.manifestFileDigest !== reference.digest ||
      canonicalJson(normalizedObservedState(input.subjects, observed)) !==
        canonicalJson(input.subjects.state)
    ) {
      fail("carrier-mismatch", "Sealed Candidate Carrier does not reproduce its retained state");
    }
    return await operation(repository, observed);
  });
}

async function retainedCarrierObservation(input: Readonly<{
  physical: FoundationEvaluationPhysicalObservationOwnerV7Input;
  store: ControlRecordStore;
  subjects: ExactSubjects;
  includeArtifactContent: boolean;
}>): Promise<CandidateRevisionCarrierStateObservation> {
  return await withRetainedCarrierRepository(
    input,
    async (_repository, observation) => observation,
  );
}

function immutableCandidateMaterial(
  observation: CandidateRevisionCarrierStateObservation,
): ImmutableCandidateMaterial {
  const evidence = observation.evidenceMaterial;
  if (evidence === undefined) {
    fail("carrier-material", "Candidate Carrier observation omitted requested Evidence material");
  }
  return Object.freeze({
    baseTreeEntries: evidence.baseTreeEntries,
    treeEntries: observation.treeEntries,
    knowledge: evidence.knowledge,
    diff: evidence.diff,
    changedSubjects: observation.state.changedSubjects,
    contentDigests: new Map(
      evidence.contentDigests.map(({ path, digest: contentDigest }) =>
        [path, contentDigest] as const),
    ),
  });
}

function sameCarrierObservation(
  left: CandidateRevisionCarrierStateObservation,
  right: CandidateRevisionCarrierStateObservation,
): boolean {
  return left.manifestFileDigest === right.manifestFileDigest &&
    canonicalJson(left.state) === canonicalJson(right.state) &&
    canonicalJson(left.treeEntries) === canonicalJson(right.treeEntries);
}

function knowledgeRole(role: string): role is "behavior" | "assurance" | "blueprint" | "description" | "check" {
  return role === "behavior" || role === "assurance" || role === "blueprint" ||
    role === "description" || role === "check";
}

type ArtifactNode = Readonly<{
  entry: FoundationGitTreeEntry | undefined;
  descendants: readonly FoundationGitTreeEntry[];
  fileKind: EvidencePacketArtifactObservation["fileKind"];
}>;

function artifactNode(
  entries: readonly FoundationGitTreeEntry[],
  artifactPath: string,
): ArtifactNode {
  const entry = entries.find(({ path }) => path === artifactPath);
  const descendants = Object.freeze(entries.filter(({ path }) =>
    path !== artifactPath && pathWithin(path, artifactPath)));
  return Object.freeze({
    entry,
    descendants,
    fileKind: descendants.length > 0 && entry === undefined
      ? "directory"
      : entry === undefined
        ? "absent"
        : entry.type === "commit"
          ? "submodule"
          : entry.mode === "120000"
            ? "symlink"
            : "file",
  });
}

function artifactChange(
  artifact: BoundaryArtifact,
  before: ArtifactNode,
  after: ArtifactNode,
  changed: ReadonlyMap<string, CandidateChangedSubject>,
): EvidencePacketArtifactObservation["change"] {
  if (before.fileKind === "absent" && after.fileKind !== "absent") return "added";
  if (before.fileKind !== "absent" && after.fileKind === "absent") return "deleted";
  if (before.fileKind === "absent") return "unchanged";
  if (before.fileKind !== after.fileKind) return "modified";
  return [...changed.keys()].some((path) => pathWithin(path, artifact.path))
    ? "modified"
    : "unchanged";
}

async function artifactObservations(input: Readonly<{
  subjects: ExactSubjects;
  material: ImmutableCandidateMaterial;
}>): Promise<readonly EvidencePacketArtifactObservation[]> {
  const entries = new Map(input.material.treeEntries.map((entry) => [entry.path, entry]));
  const changed = new Map(input.material.changedSubjects.map((subject) => [subject.path, subject]));
  const values: EvidencePacketArtifactObservation[] = [];
  for (const artifact of input.subjects.artifacts) {
    const before = artifactNode(input.material.baseTreeEntries, artifact.path);
    const after = artifactNode(input.material.treeEntries, artifact.path);
    const entry = entries.get(artifact.path);
    const fileKind = after.fileKind;
    const existence = fileKind === "absent" ? "absent" as const : "present" as const;
    const contentDigest = fileKind === "directory" || entry === undefined
      ? null
      : input.material.contentDigests.get(artifact.path) ?? null;
    if (fileKind === "file" && contentDigest === null) {
      fail(
        "carrier-content",
        `Candidate Carrier did not reproduce content bytes for artifact ${artifact.id}`,
      );
    }
    const manifestDigest = fileKind === "directory"
      ? digestCanonical(after.descendants.map(({ path, mode, type, objectId }) => Object.freeze({
          path: path.slice(artifact.path.length + 1),
          mode,
          type,
          objectId,
        })))
      : null;
    const record = knowledgeRole(artifact.role)
      ? input.material.knowledge.currentRecords.find(({ path }) => path === artifact.path)
      : undefined;
    const schemaValidation = knowledgeRole(artifact.role)
      ? record === undefined ? "invalid" as const : "valid" as const
      : "not-required" as const;
    const semanticValidation = knowledgeRole(artifact.role)
      ? record?.frontMatter.kind === artifact.role ? "valid" as const : "invalid" as const
      : "not-required" as const;
    const change = artifactChange(artifact, before, after, changed);
    const supportedArtifact = fileKind === "file" || fileKind === "directory";
    const requiredChange = !artifact.mustChange || change === "added" || change === "modified";
    const state = existence === "present" && supportedArtifact && requiredChange &&
        schemaValidation !== "invalid" && semanticValidation !== "invalid"
      ? "satisfied" as const
      : "failed" as const;
    values.push(Object.freeze({
      artifactId: artifact.id,
      fileKind,
      existence,
      change,
      contentDigest,
      manifestDigest,
      schemaValidation,
      semanticValidation,
      limitationIds: Object.freeze([]),
      state,
    }));
  }
  return Object.freeze(values.sort((left, right) => compareCodePoints(left.artifactId, right.artifactId)));
}

function descriptionRecords(knowledge: FoundationKnowledgeSet): readonly FoundationKnowledgeRecord[] {
  return Object.freeze(knowledge.currentRecords
    .filter(({ frontMatter }) => frontMatter.kind === "description")
    .sort((left, right) => compareCodePoints(left.frontMatter.id, right.frontMatter.id)));
}

function selectorMatches(path: string, selector: FoundationDescriptionSpec["coverage"][number]): boolean {
  if (selector.mode === "file") return path === selector.path;
  if (!pathWithin(path, selector.path) || path === selector.path) return false;
  return !selector.exclude.some((excluded) => pathWithin(path, excluded));
}

function selectorIdentity(
  record: FoundationKnowledgeRecord,
  selector: FoundationDescriptionSpec["coverage"][number],
): string {
  return `description-selector.${digestCanonical({
    descriptionId: record.frontMatter.id,
    descriptionRevision: record.frontMatter.revision,
    selectorPath: selector.path,
    selectorMode: selector.mode,
    selectorRole: selector.role,
    selectorExclude: selector.exclude,
  }).slice("sha256:".length)}`;
}

function descriptionObservations(input: Readonly<{
  physical: FoundationEvaluationPhysicalObservationOwnerV7Input;
  subjects: ExactSubjects;
  material: ImmutableCandidateMaterial;
}>): readonly EvidencePacketDescriptionObservation[] {
  const governed = input.material.treeEntries.filter(({ path }) =>
    productStateRole(input.physical.contract, path) === "governed-implementation");
  if (governed.length > MAXIMUM_DESCRIPTION_SUBJECTS) {
    fail("bound", "Governed Description subjects exceed the Evidence profile");
  }
  const descriptions = descriptionRecords(input.material.knowledge);
  const selectors = descriptions.flatMap((record) =>
    (record.frontMatter.spec as FoundationDescriptionSpec).coverage.map((selector) => Object.freeze({
      record,
      selector,
    })));
  const changed = new Set(input.material.changedSubjects.map(({ path }) => path));
  const values = governed.map((entry): EvidencePacketDescriptionObservation => {
    const exempt = input.physical.contract.productState.coverageExemptions.some(({ path }) =>
      pathWithin(entry.path, path));
    const owners = selectors.filter(({ selector }) => selectorMatches(entry.path, selector));
    const ownership: EvidencePacketDescriptionObservation["ownership"] = exempt
      ? "excluded"
      : owners.length === 0
        ? "missing"
        : owners.length === 1
          ? "exact"
          : "ambiguous";
    const owner = owners.length === 1 ? owners[0]! : null;
    const descriptionChange = owners.length === 0
      ? "absent" as const
      : owners.some(({ record }) => changed.has(record.path))
        ? "changed" as const
        : "unchanged" as const;
    const obligationIds = sortUniqueCodePoints(input.subjects.artifacts
      .filter(({ path }) => pathWithin(entry.path, path))
      .flatMap((artifact) => artifact.obligationIds));
    return Object.freeze({
      path: entry.path,
      descriptionId: owner?.record.frontMatter.id ?? null,
      selector: owner === null ? null : selectorIdentity(owner.record, owner.selector),
      ownership,
      implementationChange: changed.has(entry.path) ? "changed" : "unchanged",
      descriptionChange,
      exclusionChange: "none",
      obligationIds: Object.freeze(obligationIds),
      state: ownership === "exact"
        ? "satisfied"
        : ownership === "excluded" ? "not-applicable" : "failed",
    });
  });
  return Object.freeze(values.sort((left, right) => compareCodePoints(left.path, right.path)));
}

function publicFailure(stage: string, error: unknown): never {
  if (isProcessCancellationError(error)) throw error;
  if (
    error instanceof FoundationError &&
    error.code.startsWith("lifecycle.evidence-physical-observation-v7.")
  ) throw error;
  const causeCode = error instanceof FoundationError ? error.code : "unexpected-observation-failure";
  throw new FoundationError(
    `lifecycle.evidence-physical-observation-v7.${stage}`,
    "Exact physical Candidate observation failed before any Evidence fact was returned",
    {
      observedFacts: {
        stage,
        causeCode,
        causeFactsDigest: digestCanonical({ stage, causeCode }),
      },
    },
  );
}

class FoundationReviewerProjectionCandidateRepositoryOperationError {
  constructor(readonly cause: unknown) {}
}

function reviewerProjectionObservation(
  subjects: ExactSubjects,
  material: ImmutableCandidateMaterial,
): FoundationReviewerProjectionObservation {
  return Object.freeze({
    seal: subjects.seal,
    candidate: subjects.candidate,
    treeEntries: material.treeEntries,
    knowledge: material.knowledge,
    diff: material.diff,
  });
}

/**
 * Reproduce the exact sealed Candidate material required by reviewer
 * Projection. The retained manifest and complete Carrier are independently
 * reopened before and after material compilation; no provider can be
 * dispatched from a stale or cache-only subject.
 */
export async function withFoundationReviewerProjectionCandidateRepositoryV7<T>(
  input: FoundationReviewerProjectionCandidateObservationV7Input,
  operation: (
    repository: string,
    observation: FoundationReviewerProjectionObservation,
  ) => Promise<T>,
): Promise<T> {
  try {
    const headBefore = input.store.state().journal.headDigest;
    const subjects = exactSubjects(input);
    const scoped = await withRetainedCarrierRepository({
      physical: input,
      store: input.store,
      subjects,
      includeArtifactContent: true,
    }, async (repository, before) => {
      const observation = reviewerProjectionObservation(
        subjects,
        immutableCandidateMaterial(before),
      );
      try {
        return Object.freeze({
          before,
          result: await operation(repository, observation),
        });
      } catch (error) {
        throw new FoundationReviewerProjectionCandidateRepositoryOperationError(
          error,
        );
      }
    });
    const after = await retainedCarrierObservation({
      physical: input,
      store: input.store,
      subjects,
      includeArtifactContent: false,
    });
    if (
      !sameCarrierObservation(scoped.before, after) ||
      input.store.state().journal.headDigest !== headBefore
    ) {
      fail(
        "reviewer-precondition",
        "Reviewer Projection Carrier or Control subjects changed during physical observation",
      );
    }
    return scoped.result;
  } catch (error) {
    if (
      error instanceof
        FoundationReviewerProjectionCandidateRepositoryOperationError
    ) {
      throw error.cause;
    }
    publicFailure("reviewer-projection", error);
  }
}

export async function observeFoundationReviewerProjectionCandidateV7(
  input: FoundationReviewerProjectionCandidateObservationV7Input,
): Promise<FoundationReviewerProjectionObservation> {
  return await withFoundationReviewerProjectionCandidateRepositoryV7(
    input,
    async (_repository, observation) => observation,
  );
}

/**
 * Observe only the physical facts that a retained Control join cannot supply.
 * Artifact and Description facts come from the immutable sealed Carrier. The
 * reviewer-subject disposition comes from two independent complete Carrier
 * reopens surrounding that compilation and cannot be supplied by Agent prose.
 */
export async function observeFoundationEvaluationEvidenceV7(
  input: FoundationEvaluationObservationContextV7 & FoundationEvaluationPhysicalObservationOwnerV7Input,
): Promise<FoundationEvaluationPhysicalObservationV7> {
  try {
    const headBefore = input.store.state().journal.headDigest;
    const subjects = exactSubjects({
      store: input.store,
      boundary: input.boundary,
      candidateRevision: input.candidate,
      seal: input.seal,
      machineHome: input.machineHome,
      targetRepository: input.targetRepository,
      contract: input.contract,
    });
    const before = await retainedCarrierObservation({
      physical: input,
      store: input.store,
      subjects,
      includeArtifactContent: true,
    });
    const material = immutableCandidateMaterial(before);
    const artifacts = await artifactObservations({ subjects, material });
    const descriptionCoverage = descriptionObservations({ physical: input, subjects, material });
    const after = await retainedCarrierObservation({
      physical: input,
      store: input.store,
      subjects,
      includeArtifactContent: false,
    });
    if (
      !sameCarrierObservation(before, after) ||
      input.store.state().journal.headDigest !== headBefore
    ) {
      fail(
        "journal-race",
        "Evaluation Carrier or Control subjects changed during physical Evidence observation",
      );
    }
    return Object.freeze({
      artifacts,
      descriptionCoverage,
      reviewerSubjectDisposition: "exact-read-only",
    });
  } catch (error) {
    publicFailure("evaluation", error);
  }
}

/** Bind the exact Carrier Store and admitted repository context to Evidence. */
export function createFoundationEvaluationEvidenceObservationOwnerV7(
  input: FoundationEvaluationPhysicalObservationOwnerV7Input,
): FoundationEvaluationObservationOwnerV7 {
  return async (context) => await observeFoundationEvaluationEvidenceV7({ ...context, ...input });
}
