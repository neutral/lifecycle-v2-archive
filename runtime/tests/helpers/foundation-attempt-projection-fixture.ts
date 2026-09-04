import { FOUNDATION_SPECIFICATION_REVISION } from "../../src/foundation/constants.js";
import type { ControlJsonObject, ControlRecordRevision } from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import { FOUNDATION_ATLAS_SELECTION } from "../../src/foundation/atlas/selection.js";
import { buildTierTwoItem } from "../../src/foundation/projection/content.js";
import { FOUNDATION_PROJECTION_COMPILER_IDENTITY, FOUNDATION_PROJECTION_REACHABLE_CATEGORIES } from "../../src/foundation/projection/orientation.js";
import type {
  FoundationCompiledProjection,
  FoundationExecutionProjectionCore,
  FoundationKnowledgeProjection,
  FoundationOrientationProjectionCore,
  FoundationProjectionBasis,
  FoundationProjectionCacheKey,
  FoundationProjectionAtlasItem,
  FoundationProjectionOmission,
} from "../../src/foundation/projection/types.js";
import { verifyCompiledProjection } from "../../src/foundation/projection/verification.js";
import {
  defaultCapabilityProfiles,
  defaultProjectionProfiles,
} from "../../src/foundation/repository/contract.js";
import type {
  FoundationCapabilityProfile,
  FoundationProjectionProfile,
} from "../../src/foundation/repository/types.js";
import { canonicalJson, digestCanonical, selfDigest, sha256Bytes, type Sha256 } from "../../src/foundation/validation/canonical.js";

type FoundationAttemptProjectionBoundary = Readonly<{
  id: string;
  revision: number;
  digest: Sha256;
}>;

type FoundationAttemptProjectionEvidence = Readonly<{
  items: readonly Readonly<{ id: string }>[];
}>;

export type FoundationAttemptProjectionOrientationSubject = Readonly<{
  kind: "orientation";
  objective: string;
  objectiveDigest: Sha256;
  atlasStateDigest: Sha256;
  knowledgeObservationDigest: Sha256;
  knowledgeSetDigest: Sha256 | null;
  digest: Sha256;
}>;

export type FoundationAttemptProjectionBuilderSubject = Readonly<{
  kind: "builder";
  boundary: FoundationAttemptProjectionBoundary;
  candidate: Readonly<{
    baseCommit: string;
    revision: Readonly<{
      kind: "candidate-revision";
      id: string;
      revision: number;
      digest: Sha256;
    }>;
    currentDigest: Sha256;
    carrierManifestDigest: Sha256;
    sealedTree: null;
    sealDigest: null;
    diffDigest: null;
  }>;
  evidence: FoundationAttemptProjectionEvidence;
  digest: Sha256;
}>;

export type FoundationAttemptProjectionReviewerSubject = Readonly<{
  kind: "reviewer";
  boundary: FoundationAttemptProjectionBoundary;
  candidate: Readonly<{
    baseCommit: string;
    currentDigest: Sha256;
    sealedTree: string;
    sealDigest: Sha256;
    diffDigest: Sha256;
  }>;
  evidence: FoundationAttemptProjectionEvidence;
  propositionSetDigest: Sha256;
  digest: Sha256;
}>;

type FoundationAttemptProjectionAcceptanceSubject = Readonly<{
  kind: "acceptance-support";
  boundary: FoundationAttemptProjectionBoundary;
  digest: Sha256;
}>;

export type FoundationAttemptProjectionSubject =
  | FoundationAttemptProjectionOrientationSubject
  | FoundationAttemptProjectionBuilderSubject
  | FoundationAttemptProjectionReviewerSubject
  | FoundationAttemptProjectionAcceptanceSubject;

const TARGET_ID = "foundation-attempt-projection-fixture";
const ORIENTATION_COMMIT = "a".repeat(40);
const ORIENTATION_TREE = "b".repeat(40);

function digest(label: string): Sha256 {
  return sha256Bytes(`foundation-attempt-projection-fixture:${label}`);
}

function signed<const Value extends Readonly<Record<string, unknown>>>(
  value: Value,
): Value & Readonly<{ digest: Sha256 }> {
  return Object.freeze({ ...value, digest: selfDigest(value as Record<string, unknown>) });
}

function assertSubjectDigest(subject: FoundationAttemptProjectionSubject): void {
  if (selfDigest(subject as unknown as Record<string, unknown>) !== subject.digest) {
    throw new TypeError("Foundation Agent Attempt fixture subject has an invalid self-digest");
  }
  if (subject.kind === "orientation" && sha256Bytes(Buffer.from(subject.objective, "utf8")) !== subject.objectiveDigest) {
    throw new TypeError("Foundation orientation fixture subject has an invalid objective digest");
  }
}

function selectedProfile(id: "orientation-standard-v1" | "execution-standard-v1"): FoundationProjectionProfile {
  const profile = defaultProjectionProfiles()[id];
  if (profile === undefined) throw new TypeError(`Foundation Projection profile ${id} is unavailable`);
  return profile;
}

function emptyOmission(profile: FoundationProjectionProfile): FoundationProjectionOmission {
  const emptyPair = (): Readonly<{ items: 0; bytes: 0 }> => Object.freeze({ items: 0, bytes: 0 });
  return Object.freeze({
    profile: profile.id,
    profileDigest: profile.digest,
    bounds: Object.freeze({
      maximumMandatoryItems: profile.maximumMandatoryItems,
      maximumMandatoryBytes: profile.maximumMandatoryBytes,
      maximumItemBytes: profile.maximumItemBytes,
      maximumReachableItems: profile.maximumReachableItems,
      maximumReachableBytes: profile.maximumReachableBytes,
      maximumSourceBytes: profile.maximumSourceBytes,
      maximumRelationshipDepth: profile.maximumRelationshipDepth,
    }),
    eligibleCategories: FOUNDATION_PROJECTION_REACHABLE_CATEGORIES,
    categories: Object.freeze(FOUNDATION_PROJECTION_REACHABLE_CATEGORIES.map((category) => Object.freeze({
      category,
      before: emptyPair(),
      after: emptyPair(),
      omitted: emptyPair(),
      omittedIds: Object.freeze([] as string[]),
      enumerationComplete: true as const,
    }))),
    policy: "category-code-point-prefix-v1",
    mandatoryOmissions: 0,
  });
}

function orientationCore(
  subject: FoundationAttemptProjectionOrientationSubject,
  capability: FoundationCapabilityProfile,
): FoundationOrientationProjectionCore {
  const knowledgeIndex = signed({ records: Object.freeze([]), relationships: Object.freeze([]) });
  const coverageIndex = signed({
    implementationRoots: Object.freeze([]),
    exemptions: Object.freeze([]),
    entries: Object.freeze([]),
    summary: Object.freeze({
      governedImplementationItems: 0,
      coveredItems: 0,
      missingItems: 0,
      ambiguousItems: 0,
      exemptionItems: 0,
    }),
  });
  const bindingIndex = signed({ entries: Object.freeze([]) });
  const capabilityIndex = signed({
    entries: Object.freeze([Object.freeze({
      id: capability.id,
      profile: capability,
      digest: capability.digest,
    })]),
  });
  const profileIndex = signed({ entries: Object.freeze(Object.values(defaultProjectionProfiles())) });
  const retrievalIndex = signed({ entries: Object.freeze([]) });
  const indexDigest = digestCanonical({
    knowledgeIndexDigest: knowledgeIndex.digest,
    coverageIndexDigest: coverageIndex.digest,
    bindingIndexDigest: bindingIndex.digest,
    capabilityIndexDigest: capabilityIndex.digest,
    profileIndexDigest: profileIndex.digest,
    retrievalIndexDigest: retrievalIndex.digest,
  });
  return Object.freeze({
    class: "orientation",
    objective: subject.objective,
    purpose: "Provide deterministic repository orientation for an Agent Attempt fixture.",
    conditions: Object.freeze([]),
    knowledgeIndex,
    coverageIndex,
    bindingIndex,
    capabilityIndex,
    profileIndex,
    retrievalIndex,
    indexDigest,
  });
}

function executionKnowledgeDigests(commit: string): Readonly<{
  observation: Sha256;
  set: Sha256;
}> {
  return Object.freeze({
    observation: digestCanonical({
      fixture: "foundation-attempt-projection-knowledge-observation-v1",
      commit,
    }),
    set: digestCanonical({
      fixture: "foundation-attempt-projection-knowledge-set-v1",
      commit,
    }),
  });
}

function executionCandidate(
  subject: FoundationAttemptProjectionBuilderSubject | FoundationAttemptProjectionReviewerSubject,
  reviewerSeal: ControlRecordRevision | undefined,
  reviewerCandidate: ControlRecordRevision | undefined,
): FoundationProjectionBasis["candidate"] {
  if (subject.kind === "builder") {
    if (subject.candidate.sealedTree !== null || subject.candidate.sealDigest !== null || subject.candidate.diffDigest !== null) {
      throw new TypeError("Foundation builder fixture subject cannot carry sealed Candidate facts");
    }
    return Object.freeze({
      baseCommit: subject.candidate.baseCommit,
      revision: subject.candidate.revision,
      stateDigest: subject.candidate.currentDigest,
      carrierManifestDigest: subject.candidate.carrierManifestDigest,
      sealedTree: null,
      seal: null,
    });
  }
  if (reviewerSeal === undefined || reviewerCandidate === undefined) {
    throw new TypeError("Foundation reviewer Projection fixture requires exact Candidate Seal and Candidate Revision Control values");
  }
  const state = reviewerCandidate.payload.state as ControlJsonObject | null;
  const carrierManifest = reviewerCandidate.payload.carrierManifest as ControlJsonObject | null;
  const sealedCandidate = reviewerSeal.relationships.filter(({ relation }) => relation === "seals");
  const sealBoundary = reviewerSeal.relationships.filter(({ relation }) => relation === "governed-by");
  const candidateBoundary = reviewerCandidate.relationships.filter(({ relation }) => relation === "governed-by");
  const exactReference = (
    value: Readonly<{ kind: string; id: string; revision: number; digest: Sha256 }> | undefined,
    expected: Readonly<{ kind: string; id: string; revision: number; digest: Sha256 }>,
  ): boolean => value !== undefined &&
    value.kind === expected.kind &&
    value.id === expected.id &&
    value.revision === expected.revision &&
    value.digest === expected.digest;
  const boundaryReference = Object.freeze({
    kind: "work-boundary",
    id: subject.boundary.id,
    revision: subject.boundary.revision,
    digest: subject.boundary.digest,
  });
  const candidateReference = Object.freeze({
    kind: "candidate-revision",
    id: reviewerCandidate.recordId,
    revision: reviewerCandidate.revision,
    digest: reviewerCandidate.digest,
  });
  if (reviewerSeal.recordKind !== "candidate-seal" ||
      reviewerSeal.revision !== 1 ||
      reviewerSeal.digest !== subject.candidate.sealDigest ||
      reviewerCandidate.recordKind !== "candidate-revision" ||
      reviewerSeal.processId !== reviewerCandidate.processId ||
      reviewerCandidate.payload.availability !== "available" ||
      state === null || Array.isArray(state) || typeof state !== "object" ||
      carrierManifest === null || Array.isArray(carrierManifest) || typeof carrierManifest !== "object" ||
      sealedCandidate.length !== 1 || !exactReference(sealedCandidate[0]?.target, candidateReference) ||
      sealBoundary.length !== 1 || !exactReference(sealBoundary[0]?.target, boundaryReference) ||
      candidateBoundary.length !== 1 || !exactReference(candidateBoundary[0]?.target, boundaryReference) ||
      reviewerCandidate.payload.candidateBaseCommit !== subject.candidate.baseCommit ||
      state.tree !== subject.candidate.sealedTree ||
      state.candidateDigest !== subject.candidate.currentDigest ||
      state.diffDigest !== subject.candidate.diffDigest) {
    throw new TypeError(
      "Foundation reviewer Projection fixture Control values do not bind the exact Work Boundary and Candidate facts",
    );
  }
  return Object.freeze({
    baseCommit: subject.candidate.baseCommit,
    revision: candidateReference,
    stateDigest: subject.candidate.currentDigest,
    carrierManifestDigest: carrierManifest.digest as Sha256,
    sealedTree: subject.candidate.sealedTree,
    seal: Object.freeze({
      kind: "candidate-seal" as const,
      id: reviewerSeal.recordId,
      revision: reviewerSeal.revision,
      digest: reviewerSeal.digest,
    }),
  });
}

function executionCore(
  subject: FoundationAttemptProjectionBuilderSubject | FoundationAttemptProjectionReviewerSubject,
  requestDigest: Sha256,
  capability: Readonly<{ profileId: string; profileDigest: Sha256 }>,
): FoundationExecutionProjectionCore {
  const suffix = subject.kind;
  return Object.freeze({
    class: "execution",
    objective: `Execute the exact ${suffix} fixture Projection.`,
    selectedMeaning: "The fixture Projection basis and core are the complete selected meaning.",
    included: Object.freeze([`boundary:${subject.boundary.id}`]),
    excluded: Object.freeze(["unadmitted work"]),
    assumptions: Object.freeze([]),
    falsifiers: Object.freeze(["the fixture Projection basis changes"]),
    obligations: Object.freeze([Object.freeze({
      id: `obligation.fixture.${suffix}`,
      kind: "acceptance" as const,
      statement: "Preserve the exact fixture Projection basis and core.",
      sourceIds: Object.freeze([]),
      requiredEvidenceIds: Object.freeze([]),
    })]),
    requiredArtifacts: Object.freeze([]),
    effects: Object.freeze([]),
    risks: Object.freeze([]),
    checks: Object.freeze([]),
    propositions: Object.freeze([Object.freeze({
      id: `proposition.fixture.${suffix}`,
      claim: "The exact fixture Projection basis and core are preserved.",
      evidenceKinds: Object.freeze(["analysis" as const]),
      evidenceIds: Object.freeze(subject.evidence.items.map(({ id }) => id)),
      obligationIds: Object.freeze([`obligation.fixture.${suffix}`]),
      effectIds: Object.freeze([]),
      riskIds: Object.freeze([]),
      path: null,
      checkId: null,
      allowNotApplicable: false,
      notApplicableCondition: null,
    })]),
    capability: Object.freeze({ ...capability }),
    capabilitySummary: "The fixture grants no capability and carries no mounted Projection bytes.",
    prohibitedEffects: Object.freeze(["unadmitted repository mutation"]),
    materialConditionPolicy: "Return a Material Condition if the exact fixture Projection cannot be preserved.",
    completionReturnRules: Object.freeze(["Return only against the exact fixture Projection."]),
    requestDigest,
    workBoundaryDigest: subject.boundary.digest,
  });
}

function objectFormat(commit: string): "sha1" | "sha256" {
  if (/^[a-f0-9]{40}$/u.test(commit)) return "sha1";
  if (/^[a-f0-9]{64}$/u.test(commit)) return "sha256";
  throw new TypeError("Foundation execution fixture subject has an invalid Candidate base commit");
}

function completeProjection(options: Readonly<{
  subject: FoundationAttemptProjectionSubject;
  profile: FoundationProjectionProfile;
  basis: FoundationProjectionBasis;
  core: FoundationOrientationProjectionCore | FoundationExecutionProjectionCore;
  requestSubjectDigest: Sha256;
}>): FoundationCompiledProjection {
  const coreBytes = Buffer.byteLength(canonicalJson(options.core), "utf8");
  const zero = Object.freeze({ items: 0, bytes: 0 });
  const normalizedAtlas = Object.freeze({
    atlas: Object.freeze({
      id: "target",
      title: "Target Atlas",
      summary: "Exact current Atlas context for the Projection fixture.",
    }),
    relatedMaps: Object.freeze([]),
  });
  const atlasText = canonicalJson(normalizedAtlas);
  const atlasBytes = Buffer.byteLength(atlasText, "utf8");
  const atlasContentDigest = sha256Bytes(Buffer.from(atlasText, "utf8"));
  const atlasItem: FoundationProjectionAtlasItem = buildTierTwoItem({
    id: `atlas.atlas.${digestCanonical(normalizedAtlas).slice("sha256:".length)}`,
    unitKind: "atlas" as const,
    unitId: "target",
    atlasId: "target",
    mapId: null,
    pointId: null,
    recordKind: null,
    sourcePath: "atlas/atlas.md",
    normalizedDigest: digestCanonical(normalizedAtlas),
    inclusionReasons: Object.freeze(["complete-normalized-atlas-root"]),
    presentationHint: "json" as const,
    content: Object.freeze({
      mode: "inline" as const,
      mediaType: "application/json",
      encoding: "utf-8" as const,
      text: atlasText,
      byteLength: atlasBytes,
      digest: atlasContentDigest,
    }),
    useLimit: "Atlas is read-only informational context and grants no product authority or mutation capability.",
  });
  const atlas = Object.freeze([atlasItem]);
  const atlasPair = Object.freeze({ items: atlas.length, bytes: atlasBytes });
  const manifestBase = {
    schema: "lifecycle.knowledge-projection.v4" as const,
    projectionId: `projection:${digestCanonical({
      compilerDigest: FOUNDATION_PROJECTION_COMPILER_IDENTITY.digest,
      requestDigest: options.basis.requestDigest,
    }).slice("sha256:".length)}`,
    class: options.subject.kind === "orientation" ? "orientation" as const : "execution" as const,
    role: options.subject.kind === "orientation" ? "reconnaissance" as const : options.subject.kind,
    profile: options.profile.id as "orientation-standard-v1" | "execution-standard-v1",
    profileDigest: options.profile.digest,
    compiler: FOUNDATION_PROJECTION_COMPILER_IDENTITY,
    specificationRevision: FOUNDATION_SPECIFICATION_REVISION,
    basis: options.basis,
    core: options.core,
    atlas,
    mandatory: Object.freeze([]),
    implementation: Object.freeze([]),
    bindings: Object.freeze([]),
    sources: Object.freeze([]),
    reachable: Object.freeze([]),
    conflicts: Object.freeze([]),
    unresolved: Object.freeze([]),
    omission: emptyOmission(options.profile),
    counts: Object.freeze({
      coreBytes,
      atlas: atlasPair,
      mandatory: zero,
      implementation: zero,
      bindings: zero,
      sources: zero,
      reachable: zero,
      conflicts: 0,
      unresolved: 0,
      totalBytes: coreBytes + atlasBytes,
    }),
  };
  const manifest = Object.freeze({
    ...manifestBase,
    digest: selfDigest(manifestBase as unknown as Record<string, unknown>),
  }) as FoundationKnowledgeProjection;
  const cacheBase = {
    specificationRevision: FOUNDATION_SPECIFICATION_REVISION,
    compilerDigest: FOUNDATION_PROJECTION_COMPILER_IDENTITY.digest,
    class: manifest.class,
    role: manifest.role,
    profile: manifest.profile,
    basis: manifest.basis,
    profileBoundsDigest: manifest.profileDigest,
    requestSubjectDigest: options.requestSubjectDigest,
    retrievalPolicyDigest: digestCanonical({
      externalLocal: "denied",
      network: "denied",
      authoritySubjectDigest: null,
      sources: [],
    }),
  };
  const cacheKey = Object.freeze({ ...cacheBase, digest: digestCanonical(cacheBase) }) as FoundationProjectionCacheKey;
  const projection: FoundationCompiledProjection = Object.freeze({
    manifest,
    inventory: Object.freeze([]),
    cacheKey,
  });
  verifyCompiledProjection(projection);
  return projection;
}

/**
 * Builds one deterministic, schema-valid Projection fixture from which tests
 * independently derive the public Agent Attempt subject.
 */
export function foundationAttemptProjectionFixture(
  subject: FoundationAttemptProjectionSubject,
  options: Readonly<{
    reviewerSeal?: ControlRecordRevision;
    reviewerCandidate?: ControlRecordRevision;
    capability?: Readonly<{ profileId: string; profileDigest: Sha256 }>;
    orientationRepository?: Readonly<{
      commit: string;
      tree: string;
      objectFormat: "sha1" | "sha256";
      repositoryEpochDigest: Sha256;
      productStateDigest: Sha256;
      repositoryContractDigest: Sha256;
      atlasResolutionDigest?: Sha256;
      atlasNormalizedModelDigest?: Sha256;
      atlasResourceBindingsDigest?: Sha256;
    }>;
    executionRepository?: Readonly<{
      tree: string;
      objectFormat: "sha1" | "sha256";
      repositoryEpochDigest: Sha256;
      productStateDigest: Sha256;
      repositoryContractDigest: Sha256;
      repositorySnapshotDigest: Sha256;
      repositoryValidationDigest: Sha256;
      atlasStateDigest: Sha256;
      atlasResolutionDigest?: Sha256;
      atlasNormalizedModelDigest?: Sha256;
      atlasResourceBindingsDigest?: Sha256;
      knowledgeObservationDigest: Sha256;
      knowledgeSetDigest: Sha256;
      knowledgeValidationDigest: Sha256;
    }>;
  }> = {},
): FoundationCompiledProjection {
  assertSubjectDigest(subject);
  if (subject.kind === "acceptance-support") {
    throw new FoundationError(
      "lifecycle.attempt.acceptance-unavailable",
      "Acceptance-support Projection fixtures are unavailable because Execution Projection v1 carries no exact Evidence Packet identity or eligible-operation set",
    );
  }
  if (subject.kind === "orientation") {
    const profile = selectedProfile("orientation-standard-v1");
    const defaultCapability = defaultCapabilityProfiles()["local-development-v1"]!;
    const capabilityBinding = options.capability ?? Object.freeze({
      profileId: defaultCapability.id,
      profileDigest: defaultCapability.digest,
    });
    const capability = defaultCapabilityProfiles()[capabilityBinding.profileId];
    if (capability === undefined || capability.digest !== capabilityBinding.profileDigest) {
      throw new TypeError("Foundation Orientation Projection fixture requires one exact default Capability Profile");
    }
    const requestDigest = digestCanonical({
      fixture: "foundation-attempt-projection-request-v1",
      class: "orientation",
      subjectDigest: subject.digest,
    });
    const orientationRepository = options.orientationRepository ?? Object.freeze({
      commit: ORIENTATION_COMMIT,
      tree: ORIENTATION_TREE,
      objectFormat: "sha1" as const,
      repositoryEpochDigest: digest("orientation-repository-epoch"),
      productStateDigest: digest("orientation-product-state"),
      repositoryContractDigest: digest("orientation-repository-contract"),
      atlasResolutionDigest: digest("orientation-atlas-resolution"),
      atlasNormalizedModelDigest: digest("orientation-atlas-normalized-model"),
      atlasResourceBindingsDigest: digest("orientation-atlas-resource-bindings"),
    });
    const basis: FoundationProjectionBasis = Object.freeze({
      requestDigest,
      target: Object.freeze({ id: TARGET_ID, generation: 1 }),
      commit: orientationRepository.commit,
      tree: orientationRepository.tree,
      objectFormat: orientationRepository.objectFormat,
      repositoryEpochDigest: orientationRepository.repositoryEpochDigest,
      productStateDigest: orientationRepository.productStateDigest,
      repositoryContractDigest: orientationRepository.repositoryContractDigest,
      repositorySnapshotDigest: null,
      repositoryValidationDigest: null,
      atlas: Object.freeze({
        root: "atlas",
        entrypoint: "atlas/atlas.md",
        specificationRevision: FOUNDATION_ATLAS_SELECTION.specificationRevision,
        processorRevision: FOUNDATION_ATLAS_SELECTION.processorRevision,
        stateDigest: subject.atlasStateDigest,
        resolutionDigest: orientationRepository.atlasResolutionDigest ?? digest("orientation-atlas-resolution"),
        normalizedModelDigest: orientationRepository.atlasNormalizedModelDigest ?? digest("orientation-atlas-normalized-model"),
        resourceBindingsDigest: orientationRepository.atlasResourceBindingsDigest ?? digest("orientation-atlas-resource-bindings"),
        complete: true,
        valid: true,
      }),
      knowledgeObservationDigest: subject.knowledgeObservationDigest,
      knowledgeSetDigest: subject.knowledgeSetDigest,
      knowledgeValidationDigest: digestCanonical({
        observationDigest: subject.knowledgeObservationDigest,
        knowledgeSetDigest: subject.knowledgeSetDigest,
      }),
      workBoundary: null,
      candidate: null,
    });
    return completeProjection({
      subject,
      profile,
      basis,
      core: orientationCore(subject, capability),
      requestSubjectDigest: subject.objectiveDigest,
    });
  }

  const profile = selectedProfile("execution-standard-v1");
  const requestDigest = digestCanonical({
    fixture: "foundation-attempt-projection-request-v1",
    class: "execution",
    role: subject.kind,
    subjectDigest: subject.digest,
  });
  const commit = subject.candidate.baseCommit;
  const knowledge = executionKnowledgeDigests(commit);
  const knowledgeObservationDigest = options.executionRepository?.knowledgeObservationDigest ?? knowledge.observation;
  const knowledgeSetDigest = options.executionRepository?.knowledgeSetDigest ?? knowledge.set;
  const format = options.executionRepository?.objectFormat ?? objectFormat(commit);
  const candidate = executionCandidate(
    subject,
    options.reviewerSeal,
    options.reviewerCandidate,
  );
  const basis: FoundationProjectionBasis = Object.freeze({
    requestDigest,
    target: Object.freeze({ id: TARGET_ID, generation: 1 }),
    commit,
    tree: options.executionRepository?.tree ?? (format === "sha1" ? "b".repeat(40) : "b".repeat(64)),
    objectFormat: format,
    repositoryEpochDigest: options.executionRepository?.repositoryEpochDigest ??
      digestCanonical({ commit, format, subjectDigest: subject.digest }),
    productStateDigest: options.executionRepository?.productStateDigest ??
      digestCanonical({ kind: "fixture-product-state", commit }),
    repositoryContractDigest: options.executionRepository?.repositoryContractDigest ??
      digest("execution-repository-contract"),
    repositorySnapshotDigest: options.executionRepository?.repositorySnapshotDigest ??
      digestCanonical({ kind: "fixture-repository-snapshot", commit }),
    repositoryValidationDigest: options.executionRepository?.repositoryValidationDigest ??
      digestCanonical({ kind: "fixture-repository-validation", commit }),
    atlas: Object.freeze({
      root: "atlas",
      entrypoint: "atlas/atlas.md",
      specificationRevision: FOUNDATION_ATLAS_SELECTION.specificationRevision,
      processorRevision: FOUNDATION_ATLAS_SELECTION.processorRevision,
      stateDigest: options.executionRepository?.atlasStateDigest ??
        digestCanonical({ kind: "fixture-atlas-state", commit }),
      resolutionDigest: options.executionRepository?.atlasResolutionDigest ??
        digestCanonical({ kind: "fixture-atlas-resolution", commit }),
      normalizedModelDigest: options.executionRepository?.atlasNormalizedModelDigest ??
        digestCanonical({ kind: "fixture-atlas-normalized-model", commit }),
      resourceBindingsDigest: options.executionRepository?.atlasResourceBindingsDigest ??
        digestCanonical({ kind: "fixture-atlas-resource-bindings", commit }),
      complete: true,
      valid: true,
    }),
    knowledgeObservationDigest,
    knowledgeSetDigest,
    knowledgeValidationDigest: options.executionRepository?.knowledgeValidationDigest ??
      digestCanonical({ knowledgeObservationDigest, knowledgeSetDigest }),
    workBoundary: Object.freeze({
      kind: "work-boundary" as const,
      id: subject.boundary.id,
      revision: subject.boundary.revision,
      digest: subject.boundary.digest,
    }),
    candidate,
  });
  return completeProjection({
    subject,
    profile,
    basis,
    core: executionCore(subject, requestDigest, options.capability ?? Object.freeze({
      profileId: "unbound-fixture-profile",
      profileDigest: digest("unbound-fixture-profile"),
    })),
    requestSubjectDigest: subject.digest,
  });
}
