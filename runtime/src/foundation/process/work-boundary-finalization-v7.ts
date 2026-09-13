import { posix } from "node:path";
import {
  type CheckReceiptDisposition,
} from "../control/check-receipt.js";
import { FOUNDATION_RUNTIME_PROTOCOL } from "../constants.js";
import { controlTimestamp } from "../control/model.js";
import type { ControlRecordStore } from "../control/store.js";
import type {
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordEvent,
  ControlRecordRelationshipTarget,
  ControlRecordRevision,
} from "../control/types.js";
import {
  isWorkBoundarySemanticRefusal,
  missingWorkBoundaryRequiredCheckPhase,
  retainWorkBoundary,
  changedWorkBoundaryMandateFields,
  resolveWorkBoundaryResolutionSnapshotV1,
  workBoundaryRepositoryBasisFromSnapshot,
  type WorkBoundaryCheckBindingFact,
  type WorkBoundaryCompilerFact,
  type WorkBoundaryDisciplineRegistryFact,
  type WorkBoundaryExternalSourceFact,
  type WorkBoundaryKnowledgeFact,
  type WorkBoundaryReference,
  type WorkBoundaryRepositoryBasis,
} from "../control/work-boundary.js";
import { FoundationError } from "../error.js";
import type { FoundationCheckCellOperatorV1 } from "../check/execution-cell-v1.js";
import type { FoundationKnowledgeSet } from "../knowledge/types.js";
import type { FoundationCompiledProjection } from "../projection/types.js";
import type {
  FoundationCheckBinding,
  FoundationLoadedRepositorySnapshot,
} from "../repository/types.js";
import { isDisciplineMaintenancePath, pathWithin } from "../repository/product-state.js";
import {
  canonicalJson,
  digestCanonical,
  type Sha256,
} from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import {
  type FoundationAgentRoleControlContextV7,
  type FoundationAgentRoleControlResultV7,
  type FoundationPreparationAgentRoleControlContextV7,
} from "./agent-operation-v7.js";
import {
  narrowFoundationActivityChildCheckpointAdapterV7,
} from "./activity-child-checkpoint-v7.js";
import {
  operateFoundationCheckV7,
  parseFoundationCheckOperationCheckpointV7,
  type FoundationOperateCheckV7Options,
} from "./check-operation-v7.js";

const MAXIMUM_JOURNAL_EVENTS = 100_000;
const MAXIMUM_BASELINE_CHECKS = 4_096;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

const WORK_BOUNDARY_COMPILER: WorkBoundaryCompilerFact = Object.freeze({
  profileId: "lifecycle.work-boundary-compiler.foundation-v3",
  profileDigest: digestCanonical(Object.freeze({
    id: "lifecycle.work-boundary-compiler.foundation-v3",
    input: "agent-work-product-payload-v4",
    output: "lifecycle.work-boundary-payload.v6",
  })),
  implementationId: "lifecycle-runtime-work-boundary-compiler-v2",
  implementationDigest: digestCanonical(Object.freeze({
    id: "lifecycle-runtime-work-boundary-compiler-v2",
    runtimeProtocol: FOUNDATION_RUNTIME_PROTOCOL,
  })),
});

type ResolutionOperation = "delivery.revise" | "delivery.reaffirm";
type BoundaryOperation = "delivery.prepare" | ResolutionOperation;

type BoundaryFinalizationContext = Readonly<{
  store: ControlRecordStore;
  activityId: string;
  brief: ControlRecordRevision;
  attempt: ControlRecordRevision;
  workProduct: ControlRecordRevision | null;
  receipt: ControlRecordRevision;
  support: FoundationAgentRoleControlContextV7["support"];
}>;

export type FoundationWorkBoundaryFinalizationBasisV7 = Readonly<{
  snapshot: FoundationLoadedRepositorySnapshot;
  knowledge: FoundationKnowledgeSet;
  projection: FoundationCompiledProjection;
}>;

type BoundaryRetainer = typeof retainWorkBoundary;

export type FoundationWorkBoundaryFinalizationV7Options = Readonly<{
  machineHome: string;
  checkCellOperator?: FoundationCheckCellOperatorV1;
  now?: () => string;
  retainBoundary?: BoundaryRetainer;
  checkOperation?: FoundationOperateCheckV7Options;
}>;

type BaselineSelection = Readonly<{
  selectionId: string;
  bindingId: string;
  binding: FoundationCheckBinding;
}>;

function fail(
  code: string,
  message: string,
  observedFacts: Readonly<Record<string, unknown>> = {},
): never {
  throw new FoundationError(`lifecycle.work-boundary-finalization-v7.${code}`, message, {
    observedFacts,
  });
}

function object(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== "object") {
    fail("retained-fact", `${label} must be one exact object`);
  }
  return value as ControlJsonObject;
}

function array(value: ControlJsonValue | undefined, label: string): readonly ControlJsonValue[] {
  if (!Array.isArray(value)) fail("retained-fact", `${label} must be one exact array`);
  return value;
}

function string(value: ControlJsonValue | undefined, label: string): string {
  if (typeof value !== "string") fail("retained-fact", `${label} must be one exact string`);
  return value;
}

function boolean(value: ControlJsonValue | undefined, label: string): boolean {
  if (typeof value !== "boolean") fail("retained-fact", `${label} must be one exact boolean`);
  return value;
}

function digest(value: ControlJsonValue | undefined, label: string): Sha256 {
  const selected = string(value, label);
  if (!SHA256_PATTERN.test(selected)) fail("retained-fact", `${label} must be one lowercase SHA-256 digest`);
  return selected as Sha256;
}

function exactReference(revision: ControlRecordRevision): ControlRecordRelationshipTarget {
  return Object.freeze({
    kind: revision.recordKind,
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function sameReference(
  left: Readonly<{ id: string; revision: number; digest: Sha256 }> | null,
  right: ControlRecordRevision,
): boolean {
  return left !== null && left.id === right.recordId && left.revision === right.revision &&
    left.digest === right.digest;
}

function exactRetainedRevision(
  store: ControlRecordStore,
  supplied: ControlRecordRevision,
  expectedKind: string,
  label: string,
): ControlRecordRevision {
  if (supplied.processId !== store.identity.processId || supplied.recordKind !== expectedKind) {
    fail("substitution", `${label} is not one ${expectedKind} revision in this Delivery`);
  }
  const retained = store.getRevision(supplied.recordId, supplied.revision);
  if (
    retained === null || retained.recordKind !== expectedKind || retained.digest !== supplied.digest ||
    canonicalJson(retained) !== canonicalJson(supplied)
  ) {
    fail("substitution", `${label} does not reproduce one exact retained ${expectedKind} revision`);
  }
  return retained;
}

function relationship(
  revision: ControlRecordRevision,
  relation: string,
  expectedKind: string,
  label: string,
): ControlRecordRelationshipTarget {
  const matches = revision.relationships.filter((value) => value.relation === relation);
  if (matches.length !== 1 || matches[0]!.target.kind !== expectedKind) {
    fail("relationship", `${label} must bind exactly one ${relation} ${expectedKind}`);
  }
  return matches[0]!.target;
}

function noRelationship(revision: ControlRecordRevision, relation: string, label: string): void {
  if (revision.relationships.some((value) => value.relation === relation)) {
    fail("relationship", `${label} must not bind ${relation}`);
  }
}

function assertRelationship(
  revision: ControlRecordRevision,
  relation: string,
  target: ControlRecordRevision,
  label: string,
): void {
  if (canonicalJson(relationship(revision, relation, target.recordKind, label)) !== canonicalJson(exactReference(target))) {
    fail("relationship", `${label} does not bind its exact retained ${target.recordKind} subject`);
  }
}

function allEvents(store: ControlRecordStore): readonly ControlRecordEvent[] {
  const events: ControlRecordEvent[] = [];
  let cursor = 0;
  for (;;) {
    const page = store.listEvents(cursor, 10_000);
    events.push(...page);
    if (events.length > MAXIMUM_JOURNAL_EVENTS) {
      fail("journal-bound", `Boundary finalization exceeds the ${MAXIMUM_JOURNAL_EVENTS}-event Journal bound`);
    }
    if (page.length < 10_000) return Object.freeze(events);
    cursor = page.at(-1)!.sequence;
  }
}

function activityEvents(store: ControlRecordStore, activityId: string): readonly ControlRecordEvent[] {
  return Object.freeze(allEvents(store).filter((event) => event.payload.activityId === activityId));
}

function exactEventSubject(
  store: ControlRecordStore,
  event: ControlRecordEvent,
  expectedKind: string,
  label: string,
): ControlRecordRevision {
  if (event.subject === null) fail("journal", `${label} has no exact record subject`);
  const revision = store.getRevision(event.subject.recordId, event.subject.revision);
  if (
    revision === null || revision.recordKind !== expectedKind ||
    revision.digest !== event.subject.digest
  ) {
    fail("journal", `${label} does not resolve one exact retained ${expectedKind} revision`);
  }
  return revision;
}

function oneActivitySubject(
  store: ControlRecordStore,
  events: readonly ControlRecordEvent[],
  eventKind: string,
  expectedKind: string,
): ControlRecordRevision | null {
  const matches = events.filter((event) => event.eventKind === eventKind);
  if (matches.length > 1) fail("journal", `Boundary activity repeats ${eventKind}`);
  return matches.length === 0
    ? null
    : exactEventSubject(store, matches[0]!, expectedKind, eventKind);
}

function assertActivitySubject(
  store: ControlRecordStore,
  events: readonly ControlRecordEvent[],
  eventKind: string,
  expected: ControlRecordRevision,
): void {
  const retained = oneActivitySubject(store, events, eventKind, expected.recordKind);
  if (retained === null || canonicalJson(retained) !== canonicalJson(expected)) {
    fail("journal", `${eventKind} does not bind its exact retained ${expected.recordKind}`);
  }
}

function runtimeId(receipt: ControlRecordRevision): string {
  if (
    receipt.producer.kind !== "runtime" || receipt.semanticAuthor.kind !== "runtime" ||
    receipt.producer.id !== receipt.semanticAuthor.id || receipt.semanticAuthority !== "runtime-observed"
  ) {
    fail("runtime-owner", "Execution Receipt does not identify one exact runtime producer");
  }
  return receipt.producer.id;
}

function validateResolutionContext(
  input: FoundationAgentRoleControlContextV7,
): Readonly<{
  operation: ResolutionOperation;
  condition: ControlRecordRevision;
  workProduct: ControlRecordRevision | null;
  runtimeId: string;
}> {
  if (
    input.operation !== "delivery.revise" && input.operation !== "delivery.reaffirm"
  ) fail("operation", "Work Boundary finalization accepts only revise or reaffirm");
  const operation = input.operation as ResolutionOperation;
  if (input.role !== "reconnaissance" || input.seal !== null) {
    fail("role", "Boundary resolution requires reconnaissance without a Candidate Seal");
  }

  const brief = exactRetainedRevision(input.store, input.brief, "director-brief", "Director Brief");
  const attempt = exactRetainedRevision(input.store, input.attempt, "agent-attempt", "Agent Attempt");
  const boundary = exactRetainedRevision(input.store, input.boundary, "work-boundary", "Active Work Boundary");
  const attemptedCandidate = exactRetainedRevision(
    input.store,
    input.attemptedCandidate,
    "candidate-revision",
    "Attempted Candidate Revision",
  );
  const resultCandidate = exactRetainedRevision(
    input.store,
    input.resultCandidate,
    "candidate-revision",
    "Result Candidate Revision",
  );
  const receipt = exactRetainedRevision(input.store, input.receipt, "execution-receipt", "Execution Receipt");
  const workProduct = input.workProduct === null
    ? null
    : exactRetainedRevision(input.store, input.workProduct, "agent-work-product", "Agent Work Product");

  if (attemptedCandidate.digest !== resultCandidate.digest || canonicalJson(attemptedCandidate) !== canonicalJson(resultCandidate)) {
    fail("candidate-continuity", "Boundary resolution cannot replace or mutate the continuing Candidate Revision");
  }
  const state = input.store.state();
  if (!sameReference(state.subjects.activeBoundary, boundary)) {
    fail("currentness", "Finalizer Boundary is not the exact active Work Boundary");
  }
  if (!sameReference(state.subjects.candidate, attemptedCandidate)) {
    fail("currentness", "Finalizer Candidate is not the exact current Candidate Revision");
  }
  if (state.subjects.materialCondition === null) {
    fail("currentness", "Boundary resolution requires the exact current Material Condition");
  }
  const condition = input.store.getRevision(
    state.subjects.materialCondition.id,
    state.subjects.materialCondition.revision,
  );
  if (
    condition === null || condition.recordKind !== "material-condition" ||
    condition.digest !== state.subjects.materialCondition.digest
  ) fail("currentness", "Current Material Condition does not resolve one exact retained revision");

  const activity = state.activities.find(({ id }) => id === input.activityId);
  if (
    activity === undefined || activity.family !== "agent" || activity.operation !== operation ||
    activity.stage !== "finalizing" || activity.recovery?.kind !== "finalization" ||
    !["work-boundary-finalized", "baseline-checks", "activity-completed"].includes(
      activity.recovery.resumesAt,
    )
  ) {
    fail("coordinate", "Boundary finalization is not at one exact recoverable resolution coordinate");
  }
  if (brief.payload.inputProfile !== operation || attempt.payload.activityId !== input.activityId ||
    attempt.payload.operation !== operation || attempt.payload.role !== "reconnaissance") {
    fail("activity-binding", "Retained Brief and Attempt do not belong to the exact resolution activity");
  }
  assertRelationship(attempt, "uses-brief", brief, "Resolution Agent Attempt");
  assertRelationship(attempt, "uses-boundary", boundary, "Resolution Agent Attempt");
  assertRelationship(attempt, "uses-candidate", attemptedCandidate, "Resolution Agent Attempt");
  noRelationship(attempt, "uses-seal", "Resolution Agent Attempt");
  assertRelationship(attemptedCandidate, "governed-by", boundary, "Continuing Candidate Revision");
  assertRelationship(condition, "freezes", attemptedCandidate, "Current Material Condition");
  assertRelationship(condition, "governed-by", boundary, "Current Material Condition");
  assertRelationship(receipt, "observes-attempt", attempt, "Resolution Execution Receipt");
  noRelationship(receipt, "observes-candidate", "Resolution Execution Receipt");
  if (receipt.payload.activityId !== input.activityId) {
    fail("activity-binding", "Execution Receipt does not belong to the exact resolution activity");
  }
  const candidate = object(receipt.payload.candidate, "Resolution Execution Receipt Candidate facts");
  if (
    candidate.input !== null || candidate.successorDisposition !== null ||
    candidate.successor !== null || candidate.contentDisposition !== null
  ) {
    fail("candidate-continuity", "Resolution Execution Receipt cannot claim a new Candidate Revision");
  }
  if (workProduct === null) {
    noRelationship(receipt, "observes-work-product", "Resolution Execution Receipt");
  } else {
    if (workProduct.payload.role !== "reconnaissance") {
      fail("role", "Boundary resolution Work Product must be reconnaissance semantics");
    }
    assertRelationship(workProduct, "result-of", attempt, "Resolution Agent Work Product");
    assertRelationship(receipt, "observes-work-product", workProduct, "Resolution Execution Receipt");
  }
  return Object.freeze({ operation, condition, workProduct, runtimeId: runtimeId(receipt) });
}

function validateInitialContext(
  input: FoundationPreparationAgentRoleControlContextV7,
): Readonly<{
  workProduct: ControlRecordRevision | null;
  runtimeId: string;
}> {
  if (
    input.operation !== "delivery.prepare" || input.role !== "reconnaissance" ||
    input.boundary !== null || input.attemptedCandidate !== null ||
    input.resultCandidate !== null || input.seal !== null
  ) {
    fail(
      "initial-subject",
      "Initial Work Boundary finalization requires reconnaissance without Boundary, Candidate, or Seal input",
    );
  }
  const brief = exactRetainedRevision(input.store, input.brief, "director-brief", "Initial Director Brief");
  const attempt = exactRetainedRevision(input.store, input.attempt, "agent-attempt", "Initial Agent Attempt");
  const receipt = exactRetainedRevision(
    input.store,
    input.receipt,
    "execution-receipt",
    "Initial Execution Receipt",
  );
  const workProduct = input.workProduct === null
    ? null
    : exactRetainedRevision(
        input.store,
        input.workProduct,
        "agent-work-product",
        "Initial Agent Work Product",
      );
  const state = input.store.state();
  if (
    state.subjects.activeBoundary !== null || state.subjects.candidate !== null ||
    state.subjects.materialCondition !== null || state.subjects.seal !== null ||
    state.subjects.evidence !== null
  ) {
    fail(
      "initial-subject",
      "Initial Work Boundary finalization cannot inherit admitted or evaluated Delivery subjects",
    );
  }
  const activity = state.activities.find(({ id }) => id === input.activityId);
  if (
    activity === undefined || activity.family !== "agent" ||
    activity.operation !== "delivery.prepare" || activity.stage !== "finalizing" ||
    activity.recovery?.kind !== "finalization" ||
    !["work-boundary-finalized", "baseline-checks", "activity-completed"].includes(
      activity.recovery.resumesAt,
    )
  ) {
    fail("coordinate", "Initial Work Boundary finalization is not at one exact recoverable coordinate");
  }
  if (
    brief.payload.inputProfile !== "delivery.prepare" ||
    attempt.payload.activityId !== input.activityId ||
    attempt.payload.operation !== "delivery.prepare" || attempt.payload.role !== "reconnaissance"
  ) {
    fail("activity-binding", "Initial Brief and Attempt do not belong to the exact preparation activity");
  }
  assertRelationship(attempt, "uses-brief", brief, "Initial Agent Attempt");
  noRelationship(attempt, "uses-boundary", "Initial Agent Attempt");
  noRelationship(attempt, "uses-candidate", "Initial Agent Attempt");
  noRelationship(attempt, "uses-seal", "Initial Agent Attempt");
  assertRelationship(receipt, "observes-attempt", attempt, "Initial Execution Receipt");
  noRelationship(receipt, "observes-candidate", "Initial Execution Receipt");
  if (receipt.payload.activityId !== input.activityId) {
    fail("activity-binding", "Initial Execution Receipt does not belong to the exact preparation activity");
  }
  const candidate = object(receipt.payload.candidate, "Initial Execution Receipt Candidate facts");
  if (
    candidate.input !== null || candidate.successorDisposition !== null ||
    candidate.successor !== null || candidate.contentDisposition !== null
  ) {
    fail("initial-subject", "Initial Execution Receipt cannot claim a Candidate Revision");
  }
  if (workProduct === null) {
    noRelationship(receipt, "observes-work-product", "Initial Execution Receipt");
    if (activity.recovery.resumesAt !== "activity-completed") {
      fail("coordinate", "Preparation without a Work Product must be ready for failed completion");
    }
  } else {
    if (workProduct.payload.role !== "reconnaissance") {
      fail("role", "Initial Work Product must contain reconnaissance semantics");
    }
    assertRelationship(workProduct, "result-of", attempt, "Initial Agent Work Product");
    assertRelationship(receipt, "observes-work-product", workProduct, "Initial Execution Receipt");
  }
  const events = activityEvents(input.store, input.activityId);
  assertActivitySubject(input.store, events, "director-brief-submitted", brief);
  assertActivitySubject(input.store, events, "agent-attempt-prepared", attempt);
  assertActivitySubject(input.store, events, "execution-receipt-recorded", receipt);
  if (workProduct !== null) {
    assertActivitySubject(input.store, events, "agent-work-product-submitted", workProduct);
  }
  return Object.freeze({ workProduct, runtimeId: runtimeId(receipt) });
}

function exactBasis(
  store: ControlRecordStore,
  attempt: ControlRecordRevision,
  input: FoundationWorkBoundaryFinalizationBasisV7,
): Readonly<{
  repository: WorkBoundaryRepositoryBasis;
  knowledge: readonly WorkBoundaryKnowledgeFact[];
  disciplineRegistry: WorkBoundaryDisciplineRegistryFact;
  externalSources: readonly WorkBoundaryExternalSourceFact[];
}> {
  const { snapshot, knowledge, projection } = input;
  if (
    snapshot.contract.targetId !== store.identity.targetId || snapshot.snapshot.targetId !== store.identity.targetId ||
    knowledge.repository.contract.targetId !== store.identity.targetId
  ) fail("basis-substitution", "Boundary finalization basis belongs to a different target");
  if (
    snapshot.contract.digest !== snapshot.snapshot.contractDigest ||
    knowledge.repository.contract.digest !== snapshot.contract.digest ||
    knowledge.repository.commit !== snapshot.epoch.commit || knowledge.repository.tree !== snapshot.epoch.tree ||
    knowledge.manifest.digest !== snapshot.snapshot.knowledgeSetDigest ||
    knowledge.manifest.repository.contractDigest !== snapshot.contract.digest ||
    knowledge.manifest.repository.commit !== snapshot.epoch.commit ||
    knowledge.manifest.repository.tree !== snapshot.epoch.tree ||
    !knowledge.validation.complete || !knowledge.validation.valid ||
    !knowledge.manifest.complete || !knowledge.manifest.valid
  ) fail("basis-substitution", "Boundary repository and Knowledge observations do not form one exact valid snapshot");

  const attemptProjection = object(attempt.payload.projection, "Reconnaissance Agent Attempt Projection");
  if (
    projection.manifest.class !== "orientation" || projection.manifest.role !== "reconnaissance" ||
    projection.manifest.digest !== digest(attemptProjection.digest, "Attempt Projection digest") ||
    projection.manifest.projectionId !== string(attemptProjection.id, "Attempt Projection identity") ||
    projection.manifest.profile !== string(attemptProjection.profileId, "Attempt Projection profile") ||
    projection.manifest.basis.target.id !== store.identity.targetId ||
    projection.manifest.basis.commit !== snapshot.epoch.commit ||
    projection.manifest.basis.tree !== snapshot.epoch.tree ||
    projection.manifest.basis.productStateDigest !== snapshot.productState.digest ||
    projection.manifest.basis.repositoryContractDigest !== snapshot.contract.digest ||
    projection.manifest.basis.knowledgeSetDigest !== snapshot.snapshot.knowledgeSetDigest ||
    projection.manifest.basis.atlas.stateDigest !== snapshot.atlasState.digest ||
    projection.manifest.basis.atlas.resolutionDigest !== snapshot.atlas.resolution.digest ||
    projection.manifest.basis.atlas.normalizedModelDigest !== snapshot.atlas.resolution.normalizedModelDigest ||
    projection.manifest.basis.atlas.resourceBindingsDigest !== snapshot.atlas.resolution.resourceBindingsDigest
  ) fail("basis-substitution", "Reconnaissance Projection does not reproduce the exact retained Attempt and snapshot basis");

  const repository: WorkBoundaryRepositoryBasis = Object.freeze({
    productBaseCommit: snapshot.epoch.commit,
    productBaseTree: snapshot.epoch.tree,
    productStateDigest: snapshot.snapshot.productStateDigest,
    atlasStateDigest: snapshot.snapshot.atlasStateDigest,
    atlasResolutionDigest: snapshot.snapshot.atlasResolutionDigest,
    atlasNormalizedModelDigest: snapshot.snapshot.atlasNormalizedModelDigest,
    atlasResourceBindingsDigest: snapshot.snapshot.atlasResourceBindingsDigest,
    repositoryContractDigest: snapshot.snapshot.contractDigest,
    knowledgeSetDigest: snapshot.snapshot.knowledgeSetDigest,
    repositorySnapshotDigest: snapshot.snapshot.digest,
  });
  const knowledgeFacts = Object.freeze(knowledge.currentRecords.map((record) => Object.freeze({
    id: record.frontMatter.id,
    revision: record.frontMatter.revision,
    sourceDigest: record.sourceDigest,
    semanticDigest: record.semanticDigest,
  })));
  const disciplineRegistry: WorkBoundaryDisciplineRegistryFact = Object.freeze({
    digest: knowledge.disciplineRegistry.digest,
    adoptions: Object.freeze(knowledge.disciplineRegistry.adoptions.map((entry) => Object.freeze({
      id: entry.id,
      revision: entry.revision,
      sourceDigest: entry.sourceDigest,
      semanticDigest: entry.semanticDigest,
    }))),
    workTypes: Object.freeze(knowledge.disciplineRegistry.workTypes.map((entry) => Object.freeze({
      id: entry.id,
      disciplineIds: Object.freeze([...entry.disciplineIds]),
    }))),
  });
  const externalSources = Object.freeze(projection.manifest.sources
    .filter(({ semantic }) => semantic.class === "source")
    .map((source) => Object.freeze({
      ownerKind: source.authority,
      ownerId: source.id,
      sourceId: source.semantic.subjectId,
      revision: source.revision,
      digest: source.digest,
      citationDigest: source.semantic.subjectDigest,
    })));
  return Object.freeze({ repository, knowledge: knowledgeFacts, disciplineRegistry, externalSources });
}

function selectedCheckBindingFacts(
  workProduct: ControlRecordRevision,
  bindings: Readonly<Record<string, FoundationCheckBinding>>,
): readonly WorkBoundaryCheckBindingFact[] {
  const semantics = object(workProduct.payload.roleSemantics, "Reconnaissance Work Product role semantics");
  const boundary = object(semantics.workBoundary, "Reconnaissance Work Product Boundary semantics");
  const selected = new Map<string, WorkBoundaryCheckBindingFact>();
  for (const value of array(boundary.checks, "Reconnaissance Work Product Boundary Checks")) {
    const check = object(value, "Reconnaissance Work Product Boundary Check");
    const checkKnowledgeId = string(check.checkKnowledgeId, "Boundary Check Knowledge identity");
    for (const rawId of array(check.bindingIds, "Boundary Check Binding identities")) {
      const bindingId = string(rawId, "Boundary Check Binding identity");
      const binding = bindings[bindingId];
      if (binding === undefined || binding.id !== bindingId || !binding.checkIds.includes(checkKnowledgeId)) {
        fail("check-binding", `Selected Check Binding ${bindingId} does not bind ${checkKnowledgeId}`);
      }
      const fact = Object.freeze({
        id: binding.id,
        checkKnowledgeId,
        digest: binding.digest,
        implementationDigest: binding.implementationDigest,
      });
      const prior = selected.get(bindingId);
      if (prior !== undefined && prior.checkKnowledgeId !== checkKnowledgeId) {
        fail("check-binding", `Check Binding ${bindingId} is selected for conflicting Check definitions`);
      }
      selected.set(bindingId, fact);
    }
  }
  return Object.freeze([...selected.values()].sort((left, right) => compareCodePoints(left.id, right.id)));
}

function assertAtlasReadOnlyWorkProduct(
  workProduct: ControlRecordRevision,
  contract: FoundationLoadedRepositorySnapshot["contract"],
): void {
  const semantics = object(workProduct.payload.roleSemantics, "Reconnaissance Work Product role semantics");
  const boundary = object(semantics.workBoundary, "Reconnaissance Work Product Boundary semantics");
  for (const value of array(boundary.artifacts, "Reconnaissance Work Product Boundary Artifacts")) {
    const artifact = object(value, "Reconnaissance Work Product Boundary Artifact");
    const path = string(artifact.path, "Boundary Artifact path");
    if (isDisciplineMaintenancePath(contract, path) || pathWithin(contract.knowledge.roots.discipline, path)) {
      throw new FoundationError(
        "lifecycle.discipline.candidate-mutation",
        "A Work Boundary cannot select adopted Discipline content or its Registry as an Artifact",
      );
    }
    if (path === contract.atlas.root || path.startsWith(`${contract.atlas.root}/`)) {
      throw new FoundationError(
        "lifecycle.atlas.candidate-mutation",
        "A Work Boundary cannot select any path under the separately maintained Atlas root",
      );
    }
  }
  for (const value of array(boundary.effects, "Reconnaissance Work Product Boundary Effects")) {
    const effect = object(value, "Reconnaissance Work Product Boundary Effect");
    const kind = string(effect.kind, "Boundary Effect kind");
    const target = string(effect.target, "Boundary Effect target");
    // Local effect targets denote repository path scopes. Compare their
    // portable lexical form in both directions: selecting Atlas, anything
    // below it, or a containing scope such as `.` all selects Atlas. This
    // comparison is deliberately limited to local effects; other target kinds
    // remain opaque text.
    const localTarget = kind === "local-read" || kind === "local-write"
      ? posix.normalize(target.replaceAll("\\", "/"))
      : null;
    const localSelectsDiscipline = localTarget !== null && (
      localTarget === "." || localTarget === ".." || localTarget.startsWith("../") ||
      (!posix.isAbsolute(localTarget) && (
        isDisciplineMaintenancePath(contract, localTarget) ||
        pathWithin(contract.knowledge.roots.discipline, localTarget)
      ))
    );
    const localSelectsAtlas = localTarget !== null && (
      localTarget === "." ||
      localTarget === ".." ||
      localTarget.startsWith("../") ||
      (!posix.isAbsolute(localTarget) && (
        pathWithin(localTarget, contract.atlas.root) ||
        pathWithin(contract.atlas.root, localTarget)
      ))
    );
    const opaqueNamesAtlas = localTarget === null && (
      target === contract.atlas.root || target.startsWith(`${contract.atlas.root}/`)
    );
    if (localSelectsAtlas || opaqueNamesAtlas) {
      throw new FoundationError(
        "lifecycle.atlas.candidate-mutation",
        "A Work Boundary cannot direct an effect at the separately maintained Atlas root",
      );
    }
    if (localSelectsDiscipline || (localTarget === null && isDisciplineMaintenancePath(contract, target))) {
      throw new FoundationError(
        "lifecycle.discipline.candidate-mutation",
        "A Work Boundary cannot direct an effect at adopted Discipline content or its Registry",
      );
    }
  }
}

function preflightBaselineSelections(
  workProduct: ControlRecordRevision,
  bindings: Readonly<Record<string, FoundationCheckBinding>>,
): void {
  const semantics = object(workProduct.payload.roleSemantics, "Reconnaissance Work Product role semantics");
  const boundary = object(semantics.workBoundary, "Reconnaissance Work Product Boundary semantics");
  const checks = array(boundary.checks, "Reconnaissance Work Product Boundary Checks")
    .map((value) => object(value, "Reconnaissance Work Product Boundary Check"));
  const missingPhase = missingWorkBoundaryRequiredCheckPhase(checks.map((check) => ({
    baselineRequired: boolean(check.baselineRequired, "Boundary Check baseline requirement"),
    finalRequired: boolean(check.finalRequired, "Boundary Check final requirement"),
  })));
  if (missingPhase !== null) fail("baseline-check", `Boundary semantics propose no required ${missingPhase} Check`);
  const selectionIds = new Set<string>();
  let count = 0;
  for (const check of checks) {
    if (!boolean(check.baselineRequired, "Boundary Check baseline requirement")) continue;
    count += 1;
    const selectionId = string(check.id, "Boundary baseline Check identity");
    if (selectionIds.has(selectionId)) {
      fail("baseline-check", "Boundary semantics repeat one baseline Check selection");
    }
    selectionIds.add(selectionId);
    const bindingIds = array(check.bindingIds, "Boundary baseline Check Binding identities");
    if (bindingIds.length !== 1) {
      fail("check-binding", "Each proposed baseline Check requires exactly one installed Binding");
    }
    const bindingId = string(bindingIds[0], "Boundary baseline Check Binding identity");
    const binding = bindings[bindingId];
    const checkKnowledgeId = string(check.checkKnowledgeId, "Boundary Check Knowledge identity");
    const modality = string(check.modality, "Boundary baseline Check modality") as
      FoundationCheckBinding["allowedModalities"][number];
    if (
      binding === undefined || binding.id !== bindingId ||
      !binding.checkIds.includes(checkKnowledgeId) ||
      !binding.allowedModalities.includes(modality)
    ) {
      fail(
        "check-binding",
        `Proposed baseline Check ${selectionId} is incompatible with installed Binding ${bindingId}`,
      );
    }
  }
  if (count > MAXIMUM_BASELINE_CHECKS) {
    fail("baseline-check", `Boundary semantics exceed the ${MAXIMUM_BASELINE_CHECKS}-Check baseline bound`);
  }
}

function isPreRetentionBoundarySemanticRefusal(error: unknown): boolean {
  return isWorkBoundarySemanticRefusal(error) || error instanceof FoundationError && [
    "lifecycle.work-boundary-finalization-v7.baseline-check",
    "lifecycle.work-boundary-finalization-v7.check-binding",
    "lifecycle.atlas.candidate-mutation",
    "lifecycle.discipline.candidate-mutation",
  ].includes(error.code);
}

function boundaryReference<Kind extends "director-brief" | "agent-work-product" | "execution-receipt" | "work-boundary" | "material-condition">(
  kind: Kind,
  revision: ControlRecordRevision,
): WorkBoundaryReference<Kind> {
  if (revision.recordKind !== kind) fail("reference", `Expected one ${kind} revision`);
  return Object.freeze({ kind, id: revision.recordId, revision: revision.revision, digest: revision.digest });
}


function exactBoundaryBasis(input: Readonly<{
  boundary: ControlRecordRevision;
  repository: WorkBoundaryRepositoryBasis;
  contract: FoundationLoadedRepositorySnapshot["contract"];
  label: string;
}>): void {
  const basis = object(input.boundary.payload.basis, `${input.label} basis`);
  for (const [key, value] of Object.entries(input.repository)) {
    if (basis[key] !== value) fail("boundary-reuse", `${input.label} changes exact basis field ${key}`);
  }
  const capability = object(input.boundary.payload.capabilityProfile, `${input.label} Capability Profile`);
  const selectedCapability = input.contract.capabilityProfiles[string(capability.id, "Boundary Capability identity")];
  if (selectedCapability === undefined || selectedCapability.digest !== capability.digest) {
    fail("boundary-reuse", `${input.label} selects a foreign Capability Profile`);
  }
  const projection = object(input.boundary.payload.projectionProfile, `${input.label} Projection Profile`);
  const selectedProjection = input.contract.projectionProfiles[string(projection.id, "Boundary Projection identity")];
  if (selectedProjection === undefined || selectedProjection.digest !== projection.digest) {
    fail("boundary-reuse", `${input.label} selects a foreign Projection Profile`);
  }
  if (canonicalJson(input.boundary.payload.compiler) !== canonicalJson(WORK_BOUNDARY_COMPILER)) {
    fail("boundary-reuse", `${input.label} changes the selected compiler identity`);
  }
}

function exactInitialBoundaryReuse(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  boundary: ControlRecordRevision;
  brief: ControlRecordRevision;
  workProduct: ControlRecordRevision;
  repository: WorkBoundaryRepositoryBasis;
  contract: FoundationLoadedRepositorySnapshot["contract"];
}>): void {
  if (
    input.boundary.payload.schema !== "lifecycle.work-boundary-payload.v6" ||
    input.boundary.payload.targetId !== input.store.identity.targetId ||
    input.boundary.revision !== 1 || input.boundary.payload.proposalKind !== "initial" ||
    input.boundary.payload.resolution !== null || input.boundary.relationships.length !== 2
  ) {
    fail("boundary-reuse", "Retained initial Boundary is not one exact initial proposal");
  }
  assertRelationship(input.boundary, "uses-brief", input.brief, "Initial Work Boundary");
  assertRelationship(input.boundary, "proposed-from", input.workProduct, "Initial Work Boundary");
  noRelationship(input.boundary, "revises", "Initial Work Boundary");
  noRelationship(input.boundary, "resolves", "Initial Work Boundary");
  const retained = oneActivitySubject(
    input.store,
    activityEvents(input.store, input.activityId),
    "work-boundary-finalized",
    "work-boundary",
  );
  if (retained === null || canonicalJson(retained) !== canonicalJson(input.boundary)) {
    fail("boundary-reuse", "Retained initial Boundary is not the exact Activity proposal");
  }
  exactBoundaryBasis({
    boundary: input.boundary,
    repository: input.repository,
    contract: input.contract,
    label: "Retained initial Boundary",
  });
}

function exactBoundaryReuse(input: Readonly<{
  boundary: ControlRecordRevision;
  operation: ResolutionOperation;
  brief: ControlRecordRevision;
  workProduct: ControlRecordRevision;
  predecessor: ControlRecordRevision;
  condition: ControlRecordRevision;
  repository: WorkBoundaryRepositoryBasis;
  contract: FoundationLoadedRepositorySnapshot["contract"];
}>): void {
  if (
    input.boundary.payload.schema !== "lifecycle.work-boundary-payload.v6" ||
    input.boundary.payload.targetId !== input.predecessor.payload.targetId ||
    input.boundary.recordId !== input.predecessor.recordId ||
    input.boundary.revision !== input.predecessor.revision + 1 ||
    input.boundary.payload.proposalKind !== (input.operation === "delivery.revise" ? "revision" : "reaffirmation")
  ) fail("boundary-reuse", "Retained successor Boundary does not advance the exact active predecessor");
  assertRelationship(input.boundary, "uses-brief", input.brief, "Successor Work Boundary");
  assertRelationship(input.boundary, "proposed-from", input.workProduct, "Successor Work Boundary");
  assertRelationship(input.boundary, "revises", input.predecessor, "Successor Work Boundary");
  assertRelationship(input.boundary, "resolves", input.condition, "Successor Work Boundary");
  const resolution = object(input.boundary.payload.resolution, "Retained successor Boundary resolution");
  if (resolution.kind !== (input.operation === "delivery.revise" ? "revise" : "reaffirm")) {
    fail("boundary-reuse", "Retained successor Boundary has the wrong resolution kind");
  }
  const changed = array(resolution.changedMandateFields, "Retained successor Boundary change set");
  const exactChanged = changedWorkBoundaryMandateFields(input.predecessor, input.boundary.payload);
  if (
    canonicalJson(changed) !== canonicalJson(exactChanged) ||
    (input.operation === "delivery.revise") !== (exactChanged.length > 0)
  ) {
    fail("boundary-reuse", "Retained successor Boundary disagrees with its complete derived mandate change set");
  }
  exactBoundaryBasis({
    boundary: input.boundary,
    repository: input.repository,
    contract: input.contract,
    label: "Retained successor Boundary",
  });
}

function baselineSelections(
  boundary: ControlRecordRevision,
  bindings: Readonly<Record<string, FoundationCheckBinding>>,
): readonly BaselineSelection[] {
  const mandate = object(boundary.payload.mandate, "Work Boundary mandate");
  const checks = array(mandate.checks, "Work Boundary Checks")
    .map((value) => object(value, "Work Boundary Check"));
  const missingPhase = missingWorkBoundaryRequiredCheckPhase(checks.map((check) => ({
    baselineRequired: boolean(check.baselineRequired, "Work Boundary baseline requirement"),
    finalRequired: boolean(check.finalRequired, "Work Boundary final requirement"),
  })));
  if (missingPhase !== null) fail("baseline-check", `Work Boundary has no required ${missingPhase} Check`);
  const selected: BaselineSelection[] = [];
  for (const check of checks) {
    if (!boolean(check.baselineRequired, "Work Boundary baseline requirement")) continue;
    const selectedBindings = array(check.bindings, "Work Boundary Check Bindings");
    if (selectedBindings.length !== 1) {
      fail("check-binding", "Each baseline Check selection requires exactly one installed Binding");
    }
    const bindingFact = object(selectedBindings[0], "Work Boundary Check Binding");
    const bindingId = string(bindingFact.id, "Work Boundary Check Binding identity");
    const binding = bindings[bindingId];
    if (
      binding === undefined || binding.id !== bindingId || binding.digest !== bindingFact.digest ||
      binding.implementationDigest !== bindingFact.implementationDigest
    ) fail("check-binding", `Baseline Check Binding ${bindingId} differs from the exact repository contract`);
    selected.push(Object.freeze({
      selectionId: string(check.id, "Work Boundary Check identity"),
      bindingId,
      binding,
    }));
  }
  if (selected.length > MAXIMUM_BASELINE_CHECKS) {
    fail("baseline-check", `Work Boundary exceeds the ${MAXIMUM_BASELINE_CHECKS}-Check bound`);
  }
  if (new Set(selected.map(({ selectionId }) => selectionId)).size !== selected.length) {
    fail("baseline-check", "Work Boundary repeats one baseline Check selection");
  }
  return Object.freeze(selected);
}

function validateBaselineReceipt(
  revision: ControlRecordRevision,
  boundary: ControlRecordRevision,
  selection: BaselineSelection,
): void {
  if (
    revision.recordKind !== "check-receipt" || revision.payload.phase !== "baseline" ||
    revision.payload.selectionId !== selection.selectionId
  ) fail("check-reuse", "Retained baseline Check Receipt has a foreign phase or selection");
  const binding = object(revision.payload.binding, "Retained baseline Check Binding");
  if (
    binding.id !== selection.bindingId || binding.digest !== selection.binding.digest ||
    binding.implementationDigest !== selection.binding.implementationDigest
  ) fail("check-reuse", "Retained baseline Check Receipt changes its exact Binding");
  assertRelationship(revision, "checks-boundary", boundary, "Retained baseline Check Receipt");
}

function legalBaselineReceipt(revision: ControlRecordRevision): boolean {
  const modality = string(revision.payload.modality, "Baseline Check modality");
  const disposition = string(revision.payload.disposition, "Baseline Check disposition") as CheckReceiptDisposition;
  switch (modality) {
    case "precondition":
    case "regression-guard":
      return disposition === "pass";
    case "repair-target":
      return disposition === "pass" || disposition === "fail";
    case "postcondition":
      return disposition === "not-run";
    case "diagnostic":
      return true;
    default:
      return fail("check-modality", `Unsupported baseline Check modality ${modality}`);
  }
}

function exactNow(now: () => string, label: string): string {
  return controlTimestamp(now(), label);
}

async function finalizeFoundationWorkBoundaryV7(
  context: BoundaryFinalizationContext,
  basis: FoundationWorkBoundaryFinalizationBasisV7,
  options: FoundationWorkBoundaryFinalizationV7Options,
  selected: Readonly<{
    operation: BoundaryOperation;
    workProduct: ControlRecordRevision | null;
    runtimeId: string;
    activeBoundary: ControlRecordRevision | null;
    materialCondition: ControlRecordRevision | null;
    validateReuse(
      boundary: ControlRecordRevision,
      repository: WorkBoundaryRepositoryBasis,
      contract: FoundationLoadedRepositorySnapshot["contract"],
    ): void;
  }>,
): Promise<FoundationAgentRoleControlResultV7> {
  if (selected.workProduct === null) {
    const activity = context.store.state().activities.find(({ id }) => id === context.activityId);
    if (
      activity?.stage !== "finalizing" || activity.recovery?.kind !== "finalization" ||
      activity.recovery.resumesAt !== "activity-completed"
    ) fail("coordinate", "Missing Work Product is not ready for exact failed completion");
    return Object.freeze({ outcome: "failed" });
  }
  const workProduct = selected.workProduct;
  const exact = exactBasis(context.store, context.attempt, basis);
  const proposal = object(object(workProduct.payload.roleSemantics, "Reconnaissance role semantics").workBoundary,
    "Proposed Work Boundary context policy");
  const executionProfileId = string(proposal.projectionProfile, "Proposed execution Projection profile");
  if (executionProfileId !== "execution-standard-v1" && executionProfileId !== "execution-large-v1") {
    return Object.freeze({ outcome: "failed" });
  }
  const executionProfile = basis.snapshot.contract.projectionProfiles[executionProfileId];
  if (executionProfile === undefined || executionProfile.id !== executionProfileId) {
    return Object.freeze({ outcome: "failed" });
  }
  const capability = object(context.attempt.payload.capability, "Reconnaissance Agent Attempt Capability");
  const capabilityId = string(capability.profileId, "Reconnaissance Agent Attempt Capability identity");
  const integrationResolution = selected.activeBoundary !== null &&
    object(selected.activeBoundary.payload.basis, "Admitted Work Boundary basis").repositorySnapshotDigest !== basis.snapshot.snapshot.digest;
  if (integrationResolution) {
    if (selected.activeBoundary === null) fail("capability", "Integration resolution requires an admitted Capability");
    const admitted = object(selected.activeBoundary.payload.capabilityProfile, "Admitted Capability Profile");
    if (admitted.id !== capabilityId || admitted.digest !== capability.profileDigest) {
      fail("capability", "Resolution Attempt must retain the exact admitted Capability grant");
    }
  }
  const proposedCapabilityId = integrationResolution ? basis.snapshot.contract.defaults.capabilityProfileId : capabilityId;
  const capabilityProfile = basis.snapshot.contract.capabilityProfiles[proposedCapabilityId];
  if (capabilityProfile === undefined || capabilityProfile.id !== proposedCapabilityId ||
    !integrationResolution && capabilityProfile.digest !== capability.profileDigest) {
    fail("capability", "Proposed Work Boundary Capability differs from its selected repository contract");
  }
  const now = options.now ?? (() => new Date().toISOString());
  const events = activityEvents(context.store, context.activityId);
  const retainedBoundary = oneActivitySubject(
    context.store,
    events,
    "work-boundary-finalized",
    "work-boundary",
  );
  let boundary = retainedBoundary;
  if (boundary === null) {
    try {
      // Frozen proposal defects cannot become recoverable physical obligations.
      // Preserve the Work Product and Receipt, then complete this Activity as failed.
      assertAtlasReadOnlyWorkProduct(workProduct, basis.snapshot.contract);
      const checkBindings = selectedCheckBindingFacts(workProduct, basis.snapshot.contract.checkBindings);
      preflightBaselineSelections(workProduct, basis.snapshot.contract.checkBindings);
      boundary = (options.retainBoundary ?? retainWorkBoundary)({
        store: context.store,
        activityId: context.activityId,
        operation: selected.operation,
        directorBrief: boundaryReference("director-brief", context.brief),
        workProduct: boundaryReference("agent-work-product", workProduct),
        executionReceipt: boundaryReference("execution-receipt", context.receipt),
        repository: exact.repository,
        knowledge: exact.knowledge,
        disciplineRegistry: exact.disciplineRegistry,
        externalSources: exact.externalSources,
        capabilityProfile: { id: capabilityProfile.id, digest: capabilityProfile.digest },
        projectionProfile: {
          id: executionProfile.id,
          digest: executionProfile.digest,
          semanticProfile: executionProfileId,
        },
        checkBindings,
        compiler: WORK_BOUNDARY_COMPILER,
        activeBoundary: selected.activeBoundary === null
          ? null
          : boundaryReference("work-boundary", selected.activeBoundary),
        materialCondition: selected.materialCondition === null
          ? null
          : boundaryReference("material-condition", selected.materialCondition),
        finalizedAt: exactNow(
          now,
          selected.operation === "delivery.prepare"
            ? "Initial Work Boundary finalization time"
            : "Successor Work Boundary finalization time",
        ),
        runtimeId: selected.runtimeId,
      }).revision;
    } catch (error) {
      if (isPreRetentionBoundarySemanticRefusal(error) && !activityEvents(context.store, context.activityId)
        .some(({ eventKind }) => eventKind === "work-boundary-finalized")) {
        return Object.freeze({ outcome: "failed" });
      }
      throw error;
    }
  }
  selected.validateReuse(boundary, exact.repository, basis.snapshot.contract);

  const selections = baselineSelections(boundary, basis.snapshot.contract.checkBindings);
  const bySelection = new Map(selections.map((selection) => [selection.selectionId, selection]));
  const retainedChecks = activityEvents(context.store, context.activityId)
    .filter((event) => event.eventKind === "check-receipt-recorded")
    .map((event) => exactEventSubject(context.store, event, "check-receipt", "Baseline Check Receipt"));
  const retainedBySelection = new Map<string, ControlRecordRevision>();
  for (const receipt of retainedChecks) {
    const selectionId = string(receipt.payload.selectionId, "Retained baseline Check selection");
    const selection = bySelection.get(selectionId);
    if (selection === undefined || retainedBySelection.has(selectionId)) {
      fail("check-reuse", "Retained baseline Check inventory is extra or duplicated");
    }
    validateBaselineReceipt(receipt, boundary, selection);
    retainedBySelection.set(selectionId, receipt);
  }

  const controls: ControlRecordRevision[] = [boundary];
  const checkSupport = narrowFoundationActivityChildCheckpointAdapterV7({
    adapter: context.support,
    parse: parseFoundationCheckOperationCheckpointV7,
  });
  const operateSelection = async (selection: BaselineSelection): Promise<ControlRecordRevision> =>
    await operateFoundationCheckV7({
      target: basis.snapshot.repository,
      machineHome: options.machineHome,
      store: context.store,
      activityId: context.activityId,
      boundary,
      selectionId: selection.selectionId,
      bindingId: selection.bindingId,
      binding: selection.binding,
      runtimeId: selected.runtimeId,
      support: checkSupport,
      cellOperator: options.checkCellOperator,
    }, options.checkOperation);
  for (const selection of selections) {
    const retained = retainedBySelection.get(selection.selectionId);
    if (retained !== undefined) {
      controls.push(retained);
      continue;
    }
    const current = context.store.state().activities.find(({ id }) => id === context.activityId);
    if (
      current?.stage !== "finalizing" || current.recovery?.kind !== "finalization" ||
      current.recovery.resumesAt !== "baseline-checks"
    ) fail("coordinate", "Missing baseline Check is not the exact next finalization obligation");
    const retainedCheck = await operateSelection(selection);
    validateBaselineReceipt(retainedCheck, boundary, selection);
    controls.push(retainedCheck);
  }

  const completedCoordinate = context.store.state().activities.find(({ id }) => id === context.activityId);
  if (
    completedCoordinate?.stage !== "finalizing" ||
    completedCoordinate.recovery?.kind !== "finalization" ||
    completedCoordinate.recovery.resumesAt !== "activity-completed"
  ) fail("coordinate", "Complete baseline set did not reach the exact activity-completion boundary");
  const checkReceipts = controls.slice(1);
  return Object.freeze({
    outcome: checkReceipts.every(legalBaselineReceipt) ? "completed" : "failed",
    controls: Object.freeze(controls),
  });
}

/**
 * Finalize the semantic result of fresh preparation. No admitted Boundary,
 * Candidate, Seal, or Material Condition may enter this path. The complete
 * initial Boundary and every required baseline Check remain exact, reusable
 * Control facts across recovery.
 */
export async function finalizeFoundationInitialWorkBoundaryV7(
  context: FoundationPreparationAgentRoleControlContextV7,
  basis: FoundationWorkBoundaryFinalizationBasisV7,
  options: FoundationWorkBoundaryFinalizationV7Options,
): Promise<FoundationAgentRoleControlResultV7> {
  const validated = validateInitialContext(context);
  return finalizeFoundationWorkBoundaryV7(context, basis, options, {
    operation: "delivery.prepare",
    workProduct: validated.workProduct,
    runtimeId: validated.runtimeId,
    activeBoundary: null,
    materialCondition: null,
    validateReuse(boundary, repository, contract) {
      if (validated.workProduct === null) {
        fail("boundary-reuse", "Preparation without a Work Product cannot retain a Work Boundary");
      }
      exactInitialBoundaryReuse({
        store: context.store,
        activityId: context.activityId,
        boundary,
        brief: context.brief,
        workProduct: validated.workProduct,
        repository,
        contract,
      });
    },
  });
}

/**
 * Finalize one revise or reaffirm role after its exact terminal Receipt.
 * Initial and successor semantics remain separate even though exact basis,
 * retention, baseline execution, and recovery reuse share one implementation.
 */
export async function finalizeFoundationWorkBoundaryResolutionV7(
  context: FoundationAgentRoleControlContextV7,
  basis: FoundationWorkBoundaryFinalizationBasisV7,
  options: FoundationWorkBoundaryFinalizationV7Options,
): Promise<FoundationAgentRoleControlResultV7> {
  const validated = validateResolutionContext(context);
  const selectedSnapshot = resolveWorkBoundaryResolutionSnapshotV1({
    store: context.store, boundary: context.boundary, materialCondition: validated.condition,
  });
  if (canonicalJson(workBoundaryRepositoryBasisFromSnapshot(basis.snapshot.snapshot)) !==
    canonicalJson(workBoundaryRepositoryBasisFromSnapshot(selectedSnapshot))) {
    fail("basis-substitution", "Boundary resolution must compile the exact context selected by its Material Condition");
  }
  return finalizeFoundationWorkBoundaryV7(context, basis, options, {
    operation: validated.operation,
    workProduct: validated.workProduct,
    runtimeId: validated.runtimeId,
    activeBoundary: context.boundary,
    materialCondition: validated.condition,
    validateReuse(boundary, repository, contract) {
      if (validated.workProduct === null) {
        fail("boundary-reuse", "Boundary resolution without a Work Product cannot retain a successor");
      }
      exactBoundaryReuse({
        boundary,
        operation: validated.operation,
        brief: context.brief,
        workProduct: validated.workProduct,
        predecessor: context.boundary,
        condition: validated.condition,
        repository,
        contract,
      });
    },
  });
}
