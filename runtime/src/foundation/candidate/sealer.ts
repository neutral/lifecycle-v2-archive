import type {
  CandidateSealBoundaryReference,
  CandidateSealCandidateReference,
} from "../control/candidate-seal.js";
import { retainCandidateSeal } from "../control/candidate-seal.js";
import {
  FOUNDATION_WORK_BOUNDARY_PAYLOAD_SCHEMA,
} from "../constants.js";
import type { ControlRecordStore } from "../control/store.js";
import type {
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordEvent,
  ControlRecordRevision,
} from "../control/types.js";
import { FoundationError } from "../error.js";
import { expectedKnowledgeKind } from "../knowledge/records.js";
import {
  isDisciplineMaintenancePath,
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
import { compareCodePoints } from "../validation/ordering.js";
import {
  deriveCandidateRevisionCarrierAdmittedContext,
} from "./carrier-observation-context.js";
import {
  observeCandidateRevisionCarrierState,
} from "./carrier-state-observer.js";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
} from "./carrier-types.js";

const SEALER_PROFILE = Object.freeze({
  schema: "lifecycle.delivery-candidate-sealer-profile.v1" as const,
  id: "delivery-candidate-sealer-v1" as const,
  version: "1" as const,
  algorithms: Object.freeze([
    "store-derived-current-candidate-and-boundary",
    "exact-retained-carrier-manifest-reopen",
    "independent-work-boundary-context-reproduction",
    "exact-carrier-state-reobservation",
    "boundary-artifact-subtree-and-change-rule-validation",
    "protected-control-path-exclusion",
    "product-state-knowledge-and-description-reproduction",
    "immutable-git-tree-evaluation-subject",
  ]),
});

export const FOUNDATION_DELIVERY_CANDIDATE_SEALER_V1 = Object.freeze({
  id: SEALER_PROFILE.id,
  version: SEALER_PROFILE.version,
  implementationDigest: digestCanonical(SEALER_PROFILE),
  ruleSetId: "lifecycle.candidate-seal-rules.v1" as const,
  ruleSetDigest: digestCanonical({
    schema: "lifecycle.candidate-seal-rule-set.v1",
    exactCandidateRevision: true,
    exactActiveBoundary: true,
    everyChangedPathAuthorized: true,
    everyRequiredArtifactSatisfied: true,
    requiredArtifactDirectoriesBindDescendants: true,
    protectedControlPathsExcluded: true,
    atlasRootReadOnly: true,
    disciplineRootReadOnly: true,
  }),
});

type Artifact = Readonly<{
  id: string;
  path: string;
  role: string;
  mustChange: boolean;
}>;

const SHA256 = /^sha256:[a-f0-9]{64}$/u;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.candidate-sealer.${code}`, message);
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

function integer(value: ControlJsonValue | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    fail("retained-fact", `${label} must be one positive safe integer`);
  }
  return value;
}

function reference<Kind extends "candidate-revision" | "work-boundary">(
  kind: Kind,
  revision: ControlRecordRevision,
): Readonly<{ kind: Kind; id: string; revision: number; digest: Sha256 }> {
  return Object.freeze({
    kind,
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function retainedCurrent(
  store: ControlRecordStore,
  kind: "candidate-revision" | "work-boundary",
): ControlRecordRevision {
  const selected = kind === "candidate-revision"
    ? store.state().subjects.candidate
    : store.state().subjects.activeBoundary;
  if (selected === null) fail("current-subject", `Candidate sealing requires one current ${kind}`);
  const revision = store.getRevision(selected.id, selected.revision);
  if (revision === null || revision.recordKind !== kind || revision.digest !== selected.digest) {
    fail("current-subject", `Current ${kind} does not resolve to one exact retained revision`);
  }
  return revision;
}

function candidateState(candidate: ControlRecordRevision): ControlJsonObject {
  if (
    candidate.payload.schema !== "lifecycle.candidate-revision-payload.v3"
  ) {
    fail("candidate-invalid", "Candidate sealing requires one exact reconstructible Candidate Revision");
  }
  const state = object(candidate.payload.state, "Candidate Revision state");
  for (const field of [
    "candidateDigest",
    "productStateDigest",
    "knowledgeSetDigest",
    "diffDigest",
    "pathInventoryDigest",
    "artifactSetDigest",
    "descriptionCoverageDigest",
  ]) {
    if (!SHA256.test(string(state[field], `Candidate Revision ${field}`))) {
      fail("candidate-state", `Candidate Revision ${field} must be one lowercase SHA-256 digest`);
    }
  }
  string(state.tree, "Candidate Revision tree");
  boolean(state.unchangedFromPredecessor, "Candidate predecessor comparison");
  array(state.changedSubjects, "Candidate changed subjects");
  return state;
}

function candidateObservation(
  candidate: ControlRecordRevision,
): "initialization" | "builder-successor" | "readmission-rebind" | "integration-successor" {
  const observation = string(
    candidate.payload.observation,
    "Candidate Revision observation",
  );
  if (
    observation !== "initialization" &&
    observation !== "builder-successor" &&
    observation !== "readmission-rebind" &&
    observation !== "integration-successor"
  ) {
    fail("candidate-invalid", "Candidate Revision has an unknown observation kind");
  }
  return observation;
}

function predecessorDigest(
  store: ControlRecordStore,
  candidate: ControlRecordRevision,
): Sha256 | null {
  const revisions = candidate.relationships.filter(({ relation }) => relation === "revises");
  if (candidate.revision === 1) {
    if (revisions.length !== 0) fail("candidate-succession", "Initial Candidate Revision cannot revise another revision");
    return null;
  }
  if (revisions.length !== 1 || revisions[0]!.target.kind !== "candidate-revision") {
    fail("candidate-succession", "Candidate successor must revise one exact Candidate Revision");
  }
  const target = revisions[0]!.target;
  const prior = store.getRevision(target.id, target.revision);
  if (prior === null || prior.recordKind !== "candidate-revision" || prior.digest !== target.digest) {
    fail("candidate-succession", "Candidate predecessor is not retained exactly");
  }
  const state = object(prior.payload.state, "Prior Candidate Revision state");
  const digest = string(state.candidateDigest, "Prior Candidate digest");
  if (!SHA256.test(digest)) fail("candidate-succession", "Prior Candidate digest is invalid");
  return digest as Sha256;
}

function artifacts(boundary: ControlRecordRevision): readonly Artifact[] {
  if (boundary.payload.schema !== FOUNDATION_WORK_BOUNDARY_PAYLOAD_SCHEMA) {
    fail("boundary", "Candidate sealing requires one Foundation Work Boundary");
  }
  const mandate = object(boundary.payload.mandate, "Work Boundary mandate");
  const values = array(mandate.artifacts, "Work Boundary artifacts");
  const byId = new Set<string>();
  const byPath = new Set<string>();
  const result = values.map((value) => {
    const artifact = object(value, "Work Boundary artifact");
    const selected = Object.freeze({
      id: string(artifact.id, "Work Boundary artifact identity"),
      path: string(artifact.path, "Work Boundary artifact path"),
      role: string(artifact.role, "Work Boundary artifact role"),
      mustChange: boolean(artifact.mustChange, "Work Boundary artifact change requirement"),
    });
    if (byId.has(selected.id) || byPath.has(selected.path)) {
      fail("boundary", "Work Boundary repeats an artifact identity or path");
    }
    byId.add(selected.id);
    byPath.add(selected.path);
    return selected;
  });
  return Object.freeze(result.sort((left, right) => compareCodePoints(left.id, right.id)));
}

type CarrierManifestReference = Readonly<{
  digest: Sha256;
  byteLength: number;
  mediaType: typeof FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE;
  purpose: typeof FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE;
}>;

function carrierManifestReference(candidate: ControlRecordRevision): CarrierManifestReference {
  const retained = object(
    candidate.payload.carrierManifest,
    "Candidate Revision Carrier manifest reference",
  );
  const digest = string(retained.digest, "Candidate Revision Carrier manifest digest");
  if (!SHA256.test(digest)) {
    fail("carrier-manifest", "Candidate Revision Carrier manifest digest is invalid");
  }
  const mediaType = string(
    retained.mediaType,
    "Candidate Revision Carrier manifest media type",
  );
  const purpose = string(
    retained.purpose,
    "Candidate Revision Carrier manifest purpose",
  );
  if (
    mediaType !== FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE ||
    purpose !== FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE
  ) {
    fail(
      "carrier-manifest",
      "Candidate Revision does not select the exact Carrier manifest descriptor profile",
    );
  }
  return Object.freeze({
    digest: digest as Sha256,
    byteLength: integer(
      retained.byteLength,
      "Candidate Revision Carrier manifest byte length",
    ),
    mediaType: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
    purpose: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
  });
}

function sameCarrierDescriptor(
  left: Readonly<{
    digest: Sha256;
    byteLength: number;
    mediaType: string;
    purpose: string;
  }>,
  right: CarrierManifestReference,
): boolean {
  return left.digest === right.digest &&
    left.byteLength === right.byteLength &&
    left.mediaType === right.mediaType &&
    left.purpose === right.purpose;
}

function protectedPath(contract: FoundationRepositoryContract, path: string): boolean {
  return path === ".lifecycle" || pathWithin(path, ".lifecycle") ||
    path === "records/control" || pathWithin(path, "records/control") ||
    path === contract.atlas.root || pathWithin(path, contract.atlas.root) ||
    isDisciplineMaintenancePath(contract, path);
}

function supportedArtifactEntry(entry: FoundationGitTreeEntry | undefined): boolean {
  return entry !== undefined && entry.type === "blob" &&
    (entry.mode === "100644" || entry.mode === "100755");
}

function supportedArtifacts(
  entries: readonly FoundationGitTreeEntry[],
  artifactsByPath: ReadonlyMap<string, Artifact>,
): ReadonlySet<string> {
  const observations = new Map<string, {
    exact: FoundationGitTreeEntry | undefined;
    descendantCount: number;
    descendantsSupported: boolean;
  }>();
  for (const artifact of artifactsByPath.values()) {
    observations.set(artifact.id, {
      exact: undefined,
      descendantCount: 0,
      descendantsSupported: true,
    });
  }
  for (const entry of entries) {
    const exact = artifactsByPath.get(entry.path);
    if (exact !== undefined) observations.get(exact.id)!.exact = entry;
    let candidate = entry.path;
    while (true) {
      const separator = candidate.lastIndexOf("/");
      if (separator < 0) break;
      candidate = candidate.slice(0, separator);
      const artifact = artifactsByPath.get(candidate);
      if (artifact !== undefined) {
        const observation = observations.get(artifact.id)!;
        observation.descendantCount += 1;
        observation.descendantsSupported &&= supportedArtifactEntry(entry);
      }
    }
  }
  return new Set([...artifactsByPath.values()]
    .filter((artifact) => {
      const observation = observations.get(artifact.id)!;
      return observation.exact === undefined
        ? observation.descendantCount > 0 && observation.descendantsSupported
        : supportedArtifactEntry(observation.exact);
    })
    .map(({ id }) => id));
}

function assertRole(
  contract: FoundationRepositoryContract,
  artifact: Artifact,
): void {
  if (isDisciplineMaintenancePath(contract, artifact.path)) {
    throw new FoundationError(
      "lifecycle.discipline.candidate-mutation",
      `Work Boundary artifact ${artifact.id} targets the read-only Discipline root`,
    );
  }
  const knowledge = expectedKnowledgeKind(artifact.path, contract);
  if (knowledge !== null && artifact.role !== knowledge) {
    fail("artifact-role", `Knowledge artifact ${artifact.id} must use role ${knowledge}`);
  }
  if (pathWithin(artifact.path, contract.atlas.root)) {
    throw new FoundationError(
      "lifecycle.atlas.candidate-mutation",
      `Work Boundary artifact ${artifact.id} targets the read-only Atlas root`,
    );
  }
  const productRole = productStateRole(contract, artifact.path);
  if (
    productRole === "governed-implementation" &&
    artifact.role !== "code" && artifact.role !== "test" && artifact.role !== "documentation"
  ) {
    fail("artifact-role", `Implementation artifact ${artifact.id} has incompatible role ${artifact.role}`);
  }
}

function changedPaths(state: ControlJsonObject): ReadonlySet<string> {
  const result = new Set<string>();
  for (const value of array(state.changedSubjects, "Candidate changed subjects")) {
    const subject = object(value, "Candidate changed subject");
    const path = string(subject.path, "Candidate changed path");
    if (result.has(path)) fail("candidate-state", `Candidate repeats changed path ${path}`);
    result.add(path);
  }
  return result;
}

function assertArtifactSet(input: Readonly<{
  contract: FoundationRepositoryContract;
  artifacts: readonly Artifact[];
  entries: readonly FoundationGitTreeEntry[];
  state: ControlJsonObject;
}>): void {
  const changed = changedPaths(input.state);
  const artifactsByPath = new Map(input.artifacts.map((artifact) => [artifact.path, artifact]));
  const supportedArtifactIds = supportedArtifacts(input.entries, artifactsByPath);
  const changedArtifactIds = new Set<string>();
  for (const path of changed) {
    if (protectedPath(input.contract, path)) {
      fail("control-exclusion", `Candidate changes protected Control path ${path}`);
    }
    let candidate = path;
    let writable = false;
    while (true) {
      const artifact = artifactsByPath.get(candidate);
      if (artifact !== undefined) {
        changedArtifactIds.add(artifact.id);
        writable ||= artifact.mustChange;
      }
      const separator = candidate.lastIndexOf("/");
      if (separator < 0) break;
      candidate = candidate.slice(0, separator);
    }
    if (!writable) {
      fail("path-unauthorized", `Changed path ${path} is not writable in the active Work Boundary`);
    }
  }
  for (const artifact of input.artifacts) {
    assertRole(input.contract, artifact);
    if (!supportedArtifactIds.has(artifact.id)) {
      fail("artifact-missing", `Required artifact ${artifact.id} is absent or unsupported`);
    }
    if (artifact.mustChange && !changedArtifactIds.has(artifact.id)) {
      fail("artifact-unchanged", `Required artifact ${artifact.id} did not change`);
    }
  }
}

export type SealDeliveryCandidateInput = Readonly<{
  store: ControlRecordStore;
  activityId: string;
  machineHome: string;
  targetRepository: string;
  contract: FoundationRepositoryContract;
  sealedAt: string;
  runtimeId: string;
  limitations?: readonly string[];
}>;

/**
 * Reopen and independently reproduce the exact current Candidate Revision from
 * its retained Carrier under the Store-derived active Work Boundary. The
 * immutable Carrier tree is the evaluation subject; no physical Candidate
 * allocation or second product object is required.
 */
export async function sealDeliveryCandidate(
  input: SealDeliveryCandidateInput,
): Promise<Readonly<{ revision: ControlRecordRevision; event: ControlRecordEvent }>> {
  const candidate = retainedCurrent(input.store, "candidate-revision");
  const boundary = retainedCurrent(input.store, "work-boundary");
  const state = candidateState(candidate);
  const observation = candidateObservation(candidate);
  const required = artifacts(boundary);
  const manifestReference = carrierManifestReference(candidate);
  const retainedManifest = await input.store.readRetainedFile(manifestReference.digest);
  if (
    retainedManifest === null ||
    !sameCarrierDescriptor(retainedManifest.descriptor, manifestReference)
  ) {
    fail(
      "carrier-manifest",
      "Current Candidate Revision Carrier manifest is not retained exactly",
    );
  }
  const admitted = await deriveCandidateRevisionCarrierAdmittedContext({
    machineHome: input.machineHome,
    repository: input.targetRepository,
    store: input.store,
    boundary,
    candidate,
  });
  if (
    string(candidate.payload.candidateBaseCommit, "Candidate immutable base commit") !==
      admitted.epoch.commit
  ) {
    fail(
      "candidate-base",
      "Current Candidate Revision does not bind its exact application base",
    );
  }
  if (
    input.contract.targetId !== input.store.identity.targetId ||
    canonicalJson(input.contract) !== canonicalJson(admitted.governing.contract)
  ) {
    fail(
      "contract",
      "Candidate sealing contract does not reproduce the admitted Work Boundary context",
    );
  }
  const predecessorCandidateDigest = predecessorDigest(input.store, candidate);
  const observed = await observeCandidateRevisionCarrierState({
    machineHome: input.machineHome,
    manifestBytes: retainedManifest.bytes,
    admitted,
    predecessor: predecessorCandidateDigest === null
      ? null
      : Object.freeze({ candidateDigest: predecessorCandidateDigest }),
  });
  if (observed.manifestFileDigest !== manifestReference.digest) {
    fail(
      "carrier-integrity",
      "Reopened Candidate Carrier does not bind the exact retained manifest bytes",
    );
  }
  let reproducedState = observed.state;
  if (observation === "readmission-rebind") {
    if (
      predecessorCandidateDigest === null ||
      observed.state.candidateDigest !== predecessorCandidateDigest
    ) {
      fail(
        "reobservation",
        "Readmission Carrier does not reproduce the byte-identical predecessor Candidate",
      );
    }

    // Readmission preserves the prior Revision state byte-for-byte. A fresh
    // replay necessarily observes equality with the immediate predecessor,
    // while the retained comparison fact describes the older transition that
    // originally created that state. Normalize only that historical fact;
    // every Carrier-derived value remains freshly reproduced below.
    reproducedState = Object.freeze({
      ...observed.state,
      unchangedFromPredecessor: boolean(
        state.unchangedFromPredecessor,
        "Candidate predecessor comparison",
      ),
    });
  }
  if (canonicalJson(reproducedState) !== canonicalJson(state)) {
    fail(
      "reobservation",
      "Candidate Carrier no longer reproduces the selected Candidate Revision",
    );
  }
  assertArtifactSet({
    contract: admitted.contract,
    artifacts: required,
    entries: observed.treeEntries,
    state,
  });

  return retainCandidateSeal({
    store: input.store,
    activityId: input.activityId,
    candidate: reference("candidate-revision", candidate) as CandidateSealCandidateReference,
    boundary: reference("work-boundary", boundary) as CandidateSealBoundaryReference,
    observation: Object.freeze({
      carrierIntegrity: "verified",
      carrierReconstruction: "verified",
      evaluationSubject: "established",
      candidateReobservation: "exact-match",
      untrackedProduct: "absent",
      controlExclusion: "verified",
      sealer: Object.freeze({
        implementationId: FOUNDATION_DELIVERY_CANDIDATE_SEALER_V1.id,
        implementationDigest: FOUNDATION_DELIVERY_CANDIDATE_SEALER_V1.implementationDigest,
        ruleSetId: FOUNDATION_DELIVERY_CANDIDATE_SEALER_V1.ruleSetId,
        ruleSetDigest: FOUNDATION_DELIVERY_CANDIDATE_SEALER_V1.ruleSetDigest,
      }),
      limitations: input.limitations ?? Object.freeze([]),
    }),
    sealedAt: input.sealedAt,
    runtimeId: input.runtimeId,
  });
}
