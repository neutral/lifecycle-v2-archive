import type { FoundationRepositorySnapshot } from "../repository/types.js";
import { parseFoundationIntegrationAssessmentPayloadV1, resolveCandidateIntegrationProvenanceV1 } from "./integration-assessment.js";
import { FoundationError } from "../error.js";
import {
  canonicalJson,
  digestCanonical,
  type Sha256,
} from "../validation/canonical.js";
import { compareCodePoints, sortUniqueCodePoints } from "../validation/ordering.js";
import { assertDeliveryControlRecordPolicy } from "./kind-registry.js";
import { compileControlRecordRevision, controlIdentifier } from "./model.js";
import { assertDeliveryControlRecordPayload } from "./payload-registry.js";
import type { ControlRecordStore } from "./store.js";
import type {
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordEvent,
  ControlRecordRelationship,
  ControlRecordRelationshipTarget,
  ControlRecordRevision,
} from "./types.js";

export type WorkBoundaryOperation =
  | "delivery.prepare"
  | "delivery.revise"
  | "delivery.reaffirm";

type WorkBoundaryRecordKind =
  | "director-brief"
  | "agent-work-product"
  | "execution-receipt"
  | "work-boundary"
  | "material-condition"
  | "agent-attempt"
  | "candidate-revision"
  | "candidate-seal";

export type WorkBoundaryReference<
  Kind extends WorkBoundaryRecordKind,
> = Readonly<{
  kind: Kind;
  id: string;
  revision: number;
  digest: Sha256;
}>;

export type WorkBoundaryRepositoryBasis = Readonly<{
  productBaseCommit: string;
  productBaseTree: string;
  productStateDigest: Sha256;
  atlasStateDigest: Sha256;
  atlasResolutionDigest: Sha256;
  atlasNormalizedModelDigest: Sha256;
  atlasResourceBindingsDigest: Sha256;
  repositoryContractDigest: Sha256;
  knowledgeSetDigest: Sha256;
  repositorySnapshotDigest: Sha256;
}>;

export type WorkBoundaryKnowledgeFact = Readonly<{
  id: string;
  revision: number;
  sourceDigest: Sha256;
  semanticDigest: Sha256;
}>;

export type WorkBoundaryDisciplineRegistryFact = Readonly<{
  digest: Sha256;
  adoptions: readonly WorkBoundaryKnowledgeFact[];
  workTypes: readonly Readonly<{ id: string; disciplineIds: readonly string[] }>[];
}>;

export type WorkBoundaryExternalSourceFact = Readonly<{
  ownerKind: string;
  ownerId: string;
  sourceId: string;
  revision: string | null;
  digest: Sha256;
  citationDigest: Sha256;
}>;

export type WorkBoundaryProfileFact = Readonly<{
  id: string;
  digest: Sha256;
}>;

export type WorkBoundaryProjectionProfileFact = WorkBoundaryProfileFact & Readonly<{
  semanticProfile: "execution-standard-v1" | "execution-large-v1";
}>;

export type WorkBoundaryCheckBindingFact = Readonly<{
  id: string;
  checkKnowledgeId: string;
  digest: Sha256;
  implementationDigest: Sha256;
}>;

export type WorkBoundaryCompilerFact = Readonly<{
  profileId: string;
  profileDigest: Sha256;
  implementationId: string;
  implementationDigest: Sha256;
}>;

type ProposalKind = "initial" | "revision" | "reaffirmation";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const GIT_OBJECT = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;
const SEMANTIC_REFUSAL_CODES = new Set([
  "lifecycle.control-work-boundary.basis",
  "lifecycle.control-work-boundary.citation",
  "lifecycle.control-work-boundary.resolution-kind",
  "lifecycle.control-work-boundary.semantic-coverage",
]);

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.control-work-boundary.${code}`, message);
}

/** DELIVERY requires a nonempty required Check set at each proof phase. */
export function missingWorkBoundaryRequiredCheckPhase(
  checks: readonly Readonly<{ baselineRequired: boolean; finalRequired: boolean }>[],
): "baseline" | "final" | null {
  if (!checks.some(({ baselineRequired }) => baselineRequired)) return "baseline";
  if (!checks.some(({ finalRequired }) => finalRequired)) return "final";
  return null;
}

/**
 * Identify a deterministic proposal refusal caused by the frozen semantics and
 * exact selected basis. Repeating compilation cannot change this outcome, so
 * Delivery completes the activity unsuccessfully instead of claiming recovery.
 */
export function isWorkBoundarySemanticRefusal(error: unknown): boolean {
  return error instanceof FoundationError && SEMANTIC_REFUSAL_CODES.has(error.code);
}

function object(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    fail("retained-fact", `${label} is not one exact object`);
  }
  return value as ControlJsonObject;
}

function objects(value: ControlJsonValue | undefined, label: string): readonly ControlJsonObject[] {
  if (!Array.isArray(value) || value.some((item) => item === null || typeof item !== "object" || Array.isArray(item))) {
    fail("retained-fact", `${label} is not one exact object array`);
  }
  return value as readonly ControlJsonObject[];
}

function string(value: ControlJsonValue | undefined, label: string): string {
  if (typeof value !== "string") fail("retained-fact", `${label} is not one exact string`);
  return value;
}

function boolean(value: ControlJsonValue | undefined, label: string): boolean {
  if (typeof value !== "boolean") fail("retained-fact", `${label} is not one exact boolean`);
  return value;
}

function digest(value: ControlJsonValue | undefined, label: string): Sha256 {
  const exact = string(value, label);
  if (!DIGEST.test(exact)) fail("retained-fact", `${label} is not one lowercase SHA-256 digest`);
  return exact as Sha256;
}

function nullableString(value: ControlJsonValue | undefined, label: string): string | null {
  if (value === null) return null;
  return string(value, label);
}

function stringSet(
  value: ControlJsonValue | undefined,
  label: string,
  minimum = 0,
): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    fail("retained-fact", `${label} is not one exact string set`);
  }
  const result = Object.freeze(sortUniqueCodePoints(value as string[]));
  if (result.length < minimum) fail("semantic-coverage", `${label} lacks required values`);
  return result;
}

function sortedObjectsById(
  values: readonly ControlJsonObject[],
  label: string,
): readonly ControlJsonObject[] {
  const normalized = values.map((value, index) => {
    const id = controlIdentifier(string(value.id, `${label}[${index}] identity`), `${label}[${index}] identity`);
    return Object.freeze({ ...value, id });
  }).sort((left, right) => compareCodePoints(String(left.id), String(right.id)));
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1]!.id === normalized[index]!.id) {
      fail("semantic-coverage", `${label} repeats identity ${String(normalized[index]!.id)}`);
    }
  }
  return Object.freeze(normalized);
}

function reference(revision: ControlRecordRevision): ControlRecordRelationshipTarget {
  return Object.freeze({
    kind: revision.recordKind,
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function sameReference(
  left: ControlRecordRelationshipTarget,
  right: ControlRecordRelationshipTarget,
): boolean {
  return left.kind === right.kind && left.id === right.id && left.revision === right.revision &&
    left.digest === right.digest;
}

function exactRevision<Kind extends WorkBoundaryRecordKind>(
  store: ControlRecordStore,
  selected: WorkBoundaryReference<Kind>,
  kind: Kind,
  label: string,
): ControlRecordRevision {
  if (selected.kind !== kind) fail("reference", `${label} has the wrong record kind`);
  const retained = store.getRevision(selected.id, selected.revision);
  if (retained === null || retained.recordKind !== kind || retained.digest !== selected.digest) {
    fail("reference", `${label} does not bind one exact retained ${kind} revision`);
  }
  assertDeliveryControlRecordPayload(retained);
  return retained;
}

function oneRelationship(
  revision: ControlRecordRevision,
  relation: string,
  kind: string,
): ControlRecordRelationshipTarget {
  const matches = revision.relationships.filter((item) => item.relation === relation);
  if (matches.length !== 1 || matches[0]!.target.kind !== kind) {
    fail("relationship", `${revision.recordKind} must bind exactly one ${relation} ${kind}`);
  }
  return matches[0]!.target;
}

function exactCurrentReference(
  observed: Readonly<{ id: string; revision: number; digest: Sha256 }> | null,
  selected: WorkBoundaryReference<"work-boundary" | "material-condition"> | null,
  label: string,
): void {
  if ((observed === null) !== (selected === null)) fail("state", `${label} selection differs from derived Delivery state`);
  if (observed !== null && selected !== null && !sameReference(
    { kind: selected.kind, ...observed },
    selected,
  )) fail("state", `${label} is not the exact current derived Delivery subject`);
}

function operationFacts(operation: WorkBoundaryOperation): Readonly<{
  proposalKind: ProposalKind;
  resolutionKind: "revise" | "reaffirm" | null;
}> {
  if (operation === "delivery.prepare") return Object.freeze({ proposalKind: "initial", resolutionKind: null });
  if (operation === "delivery.revise") return Object.freeze({ proposalKind: "revision", resolutionKind: "revise" });
  return Object.freeze({ proposalKind: "reaffirmation", resolutionKind: "reaffirm" });
}

function validateActivity(
  store: ControlRecordStore,
  activityId: string,
  operation: WorkBoundaryOperation,
): void {
  const matches = store.state().activities.filter(({ id }) => id === activityId);
  if (
    matches.length !== 1 || matches[0]!.operation !== operation || matches[0]!.family !== "agent" ||
    matches[0]!.stage !== "finalizing" || matches[0]!.recovery?.resumesAt !== "work-boundary-finalized"
  ) {
    fail("state", "Work Boundary compilation is not the exact derived finalization obligation");
  }
}

function retainedAttempt(
  store: ControlRecordStore,
  operation: WorkBoundaryOperation,
  activityId: string,
  brief: ControlRecordRevision,
  workProduct: ControlRecordRevision,
  receipt: ControlRecordRevision,
): ControlRecordRevision {
  const attemptTarget = oneRelationship(workProduct, "result-of", "agent-attempt");
  const attempt = store.getRevision(attemptTarget.id, attemptTarget.revision);
  if (attempt === null || attempt.recordKind !== "agent-attempt" || attempt.digest !== attemptTarget.digest) {
    fail("relationship", "Reconnaissance Work Product does not bind one exact retained Agent Attempt");
  }
  assertDeliveryControlRecordPayload(attempt);
  if (
    attempt.payload.activityId !== activityId || attempt.payload.operation !== operation ||
    attempt.payload.role !== "reconnaissance"
  ) fail("source", "Agent Attempt does not match the exact reconnaissance activity");
  if (!sameReference(oneRelationship(attempt, "uses-brief", "director-brief"), reference(brief))) {
    fail("relationship", "Reconnaissance Agent Attempt does not use the exact Director Brief");
  }
  if (!sameReference(oneRelationship(receipt, "observes-attempt", "agent-attempt"), reference(attempt))) {
    fail("relationship", "Execution Receipt does not observe the exact reconnaissance Agent Attempt");
  }
  if (!sameReference(oneRelationship(receipt, "observes-work-product", "agent-work-product"), reference(workProduct))) {
    fail("relationship", "Execution Receipt does not observe the exact reconnaissance Work Product");
  }
  const workspace = object(receipt.payload.workspace, "Execution Receipt workspace");
  const providerEffect = object(receipt.payload.providerEffect, "Execution Receipt provider effect");
  const execution = object(receipt.payload.execution, "Execution Receipt execution");
  const output = object(execution.output, "Execution Receipt output");
  const workProductBinding = object(receipt.payload.workProduct, "Execution Receipt Work Product");
  const containment = object(receipt.payload.containment, "Execution Receipt Containment");
  const retirement = object(receipt.payload.retirement, "Execution Receipt Retirement");
  if (
    receipt.payload.schema !== "lifecycle.execution-receipt-payload.v3" ||
    receipt.payload.activityId !== activityId || providerEffect.outcome !== "completed" ||
    receipt.payload.productiveExecutionStarted !== true || workspace.availability !== "available" ||
    workspace.parserDisposition !== "valid" || workspace.compilerDisposition !== "retained" ||
    workProductBinding.disposition !== "submitted" || output.availability !== "retrieved" ||
    containment.classification !== "contained" || retirement.classification !== "retired" ||
    workspace.parseResultDigest !== workProduct.payload.parseResultDigest ||
    workspace.fixedBindingSubjectDigest !== workProduct.payload.fixedBindingSubjectDigest
  ) fail("receipt", "Execution Receipt does not establish one complete valid reconnaissance submission");
  return attempt;
}

type WorkBoundaryCitations = Readonly<{
  bySubject: ReadonlyMap<string, readonly ControlJsonObject[]>;
  knowledgeSources: ReadonlySet<Sha256>;
}>;

function citationsBySubject(workProduct: ControlRecordRevision): WorkBoundaryCitations {
  const bySubject = new Map<string, ControlJsonObject[]>();
  const knowledgeSources = new Set<Sha256>();
  for (const citation of objects(workProduct.payload.citations, "Agent Work Product citations")) {
    const subjectId = string(citation.subjectId, "Agent Work Product citation subject identity");
    const current = bySubject.get(subjectId) ?? [];
    current.push(citation);
    bySubject.set(subjectId, current);
    if (citation.subjectKind === "knowledge") {
      knowledgeSources.add(digest(citation.subjectDigest, "Knowledge citation source digest"));
    }
  }
  return Object.freeze({ bySubject, knowledgeSources });
}

function exactCitation(
  citations: WorkBoundaryCitations,
  id: string,
  kind: "knowledge" | "source",
  expectedDigest: Sha256,
): void {
  // The Work Product compiler resolves occurrence handles against the frozen
  // citation registry. Trusted Knowledge source bytes bind the enduring id and
  // revision; a qualified occurrence handle need not repeat that id.
  const present = kind === "knowledge"
    ? citations.knowledgeSources.has(expectedDigest)
    : (citations.bySubject.get(id) ?? []).some((citation) =>
      citation.subjectKind === "source" && citation.subjectDigest === expectedDigest);
  if (!present) {
    fail("citation", `Selected ${kind} ${id} lacks an exact retained citation`);
  }
}

function normalizeMandate(input: Readonly<{
  workProduct: ControlRecordRevision;
  knowledge: readonly WorkBoundaryKnowledgeFact[];
  disciplineRegistry: WorkBoundaryDisciplineRegistryFact;
  externalSources: readonly WorkBoundaryExternalSourceFact[];
  capabilityProfile: WorkBoundaryProfileFact;
  projectionProfile: WorkBoundaryProjectionProfileFact;
  checkBindings: readonly WorkBoundaryCheckBindingFact[];
}>): Readonly<{
  knowledge: readonly ControlJsonObject[];
  disciplines: ControlJsonObject;
  externalSources: readonly ControlJsonObject[];
  capabilityProfile: ControlJsonObject;
  projectionProfile: ControlJsonObject;
  mandate: ControlJsonObject;
}> {
  if (
    input.workProduct.payload.role !== "reconnaissance" || input.workProduct.payload.disposition !== "complete"
  ) fail("semantic-coverage", "Work Boundary requires one complete reconnaissance Work Product");
  const semantics = object(input.workProduct.payload.roleSemantics, "Reconnaissance role semantics");
  if (semantics.role !== "reconnaissance" || semantics.proposal !== "work-boundary") {
    fail("semantic-coverage", "Reconnaissance Work Product does not propose one complete Work Boundary");
  }
  const source = object(semantics.workBoundary, "Reconnaissance Work Boundary semantics");
  const selectedKnowledgeIds = stringSet(source.selectedKnowledgeIds, "Selected Knowledge", 1);
  const selectedWorkTypeIds = stringSet(source.selectedWorkTypeIds, "Selected Discipline work types");
  const selectedSourceIds = stringSet(source.selectedSourceIds, "Selected external sources");
  const citations = citationsBySubject(input.workProduct);

  const knowledgeRegistry = new Map<string, WorkBoundaryKnowledgeFact>();
  for (const item of input.knowledge) {
    if (knowledgeRegistry.has(item.id)) fail("basis", `Knowledge basis repeats ${item.id}`);
    knowledgeRegistry.set(item.id, item);
  }
  const knowledge = selectedKnowledgeIds.map((id) => {
    const item = knowledgeRegistry.get(id);
    if (item === undefined) fail("basis", `Selected Knowledge ${id} is absent from the current Knowledge basis`);
    exactCitation(citations, id, "knowledge", item.sourceDigest);
    return Object.freeze({
      id: item.id,
      revision: item.revision,
      sourceDigest: item.sourceDigest,
      semanticDigest: item.semanticDigest,
    });
  });

  const workTypes = new Map(input.disciplineRegistry.workTypes.map((entry) => [entry.id, entry]));
  for (const id of selectedWorkTypeIds) {
    if (!workTypes.has(id)) fail("basis", `Selected Discipline work type ${id} is absent from the exact registry`);
  }
  const adopted = new Map(input.disciplineRegistry.adoptions.map((entry) => [entry.id, entry]));
  const disciplineRecords = knowledge.filter((entry) => adopted.has(String(entry.id)))
    .map((entry) => Object.freeze({ ...entry }));
  for (const entry of disciplineRecords) {
    const exact = adopted.get(String(entry.id))!;
    if (
      exact.revision !== entry.revision || exact.sourceDigest !== entry.sourceDigest ||
      exact.semanticDigest !== entry.semanticDigest
    ) fail("basis", `Selected Discipline ${String(entry.id)} differs from its exact registry adoption`);
  }
  for (const entry of knowledge) {
    if (String(entry.id).startsWith("discipline.") && !adopted.has(String(entry.id))) {
      fail("basis", `Selected Discipline ${String(entry.id)} is not adopted in the exact registry`);
    }
  }
  const disciplines: ControlJsonObject = Object.freeze({
    registryDigest: input.disciplineRegistry.digest,
    workTypeIds: selectedWorkTypeIds,
    records: Object.freeze(disciplineRecords),
  });

  const sourceRegistry = new Map<string, WorkBoundaryExternalSourceFact>();
  for (const item of input.externalSources) {
    if (sourceRegistry.has(item.sourceId)) fail("basis", `External-source basis repeats ${item.sourceId}`);
    sourceRegistry.set(item.sourceId, item);
  }
  const externalSources = selectedSourceIds.map((id) => {
    const item = sourceRegistry.get(id);
    if (item === undefined) fail("basis", `Selected external source ${id} is absent from the current basis`);
    exactCitation(citations, id, "source", item.citationDigest);
    return Object.freeze({
      ownerKind: item.ownerKind,
      ownerId: item.ownerId,
      sourceId: item.sourceId,
      revision: item.revision,
      digest: item.digest,
    });
  });

  const capabilityId = string(source.capabilityProfileId, "Selected Capability Profile");
  if (input.capabilityProfile.id !== capabilityId) {
    fail("basis", "Agent-selected Capability Profile is not the exact runtime-selected profile");
  }
  const semanticProjection = string(source.projectionProfile, "Selected Projection profile");
  if (input.projectionProfile.semanticProfile !== semanticProjection) {
    fail("basis", "Agent-selected Projection profile is not the exact runtime-selected profile");
  }

  const objectiveSource = object(source.objective, "Boundary objective");
  const directionSource = object(source.mandate, "Boundary direction");
  const objective: ControlJsonObject = Object.freeze({
    id: string(objectiveSource.id, "Boundary objective identity"),
    interpretation: string(objectiveSource.interpretation, "Boundary objective interpretation"),
    fragmentDigest: digest(objectiveSource.fragmentDigest, "Boundary objective fragment digest"),
  });
  const direction: ControlJsonObject = Object.freeze({
    id: string(directionSource.id, "Boundary direction identity"),
    selectedMeaning: string(directionSource.selectedMeaning, "Boundary selected meaning"),
    whyNow: string(directionSource.whyNow, "Boundary why-now"),
    included: stringSet(directionSource.included, "Boundary included outcomes", 1),
    excluded: stringSet(directionSource.excluded, "Boundary excluded outcomes"),
    authorityFacts: stringSet(directionSource.authorityFacts, "Boundary authority facts"),
    chosenTradeoffs: stringSet(directionSource.chosenTradeoffs, "Boundary tradeoffs"),
    assumptions: stringSet(directionSource.assumptions, "Boundary assumptions"),
    falsifiers: stringSet(directionSource.falsifiers, "Boundary falsifiers"),
    fragmentDigest: digest(directionSource.fragmentDigest, "Boundary direction fragment digest"),
  });

  const effects = sortedObjectsById(objects(source.effects, "Boundary effects").map((value) => Object.freeze({
    id: string(value.id, "Boundary Effect identity"),
    kind: string(value.kind, "Boundary Effect kind"),
    summary: string(value.summary, "Boundary Effect summary"),
    trigger: string(value.trigger, "Boundary Effect trigger"),
    target: string(value.target, "Boundary Effect target"),
    reversibility: string(value.reversibility, "Boundary Effect reversibility"),
    fragmentDigest: digest(value.fragmentDigest, "Boundary Effect fragment digest"),
  })), "Boundary effects");
  const risks = sortedObjectsById(objects(source.risks, "Boundary risks").map((value) => Object.freeze({
    id: string(value.id, "Boundary Risk identity"),
    statement: string(value.statement, "Boundary Risk statement"),
    effectIds: stringSet(value.effectIds, "Boundary Risk effects"),
    treatment: string(value.treatment, "Boundary Risk treatment"),
    evidenceArtifactIds: stringSet(value.evidenceArtifactIds, "Boundary Risk Evidence artifacts"),
    propositionIds: stringSet(value.propositionIds, "Boundary Risk propositions"),
    fragmentDigest: digest(value.fragmentDigest, "Boundary Risk fragment digest"),
  })), "Boundary risks");
  const obligations = sortedObjectsById(objects(source.obligations, "Boundary obligations").map((value) => Object.freeze({
    id: string(value.id, "Boundary Obligation identity"),
    kind: string(value.kind, "Boundary Obligation kind"),
    statement: string(value.statement, "Boundary Obligation statement"),
    sourceIds: stringSet(value.sourceIds, "Boundary Obligation sources"),
    requiredEvidenceArtifactIds: stringSet(value.requiredEvidenceArtifactIds, "Boundary Obligation Evidence artifacts"),
    severity: string(value.severity, "Boundary Obligation severity"),
    propositionIds: stringSet(value.propositionIds, "Boundary Obligation propositions"),
    fragmentDigest: digest(value.fragmentDigest, "Boundary Obligation fragment digest"),
  })), "Boundary obligations");
  const obligationSourceOwnerCounts = new Map<string, number>();
  for (const sourceId of [
    ...knowledge.map((value) => string(value.id, "Selected Knowledge identity")),
    ...externalSources.map((value) => string(value.sourceId, "Selected external source identity")),
    string(direction.id, "Boundary direction identity"),
  ]) {
    obligationSourceOwnerCounts.set(
      sourceId,
      (obligationSourceOwnerCounts.get(sourceId) ?? 0) + 1,
    );
  }
  for (const obligation of obligations) {
    for (const sourceId of obligation.sourceIds as readonly string[]) {
      if (obligationSourceOwnerCounts.get(sourceId) !== 1) {
        fail(
          "semantic-coverage",
          `Boundary Obligation ${String(obligation.id)} source ${sourceId} does not resolve exactly to selected Knowledge, a selected external source, or the fixed mandate`,
        );
      }
    }
  }
  const artifacts = sortedObjectsById(objects(source.artifacts, "Boundary artifacts").map((value) => Object.freeze({
    id: string(value.id, "Boundary Artifact identity"),
    path: string(value.path, "Boundary Artifact path"),
    role: string(value.role, "Boundary Artifact role"),
    mustChange: boolean(value.mustChange, "Boundary Artifact must-change"),
    obligationIds: stringSet(value.obligationIds, "Boundary Artifact obligations", 1),
    changeRule: string(value.changeRule, "Boundary Artifact change rule"),
    fragmentDigest: digest(value.fragmentDigest, "Boundary Artifact fragment digest"),
  })), "Boundary artifacts");

  const bindingRegistry = new Map<string, WorkBoundaryCheckBindingFact>();
  for (const binding of input.checkBindings) {
    if (bindingRegistry.has(binding.id)) fail("basis", `Check Binding basis repeats ${binding.id}`);
    bindingRegistry.set(binding.id, binding);
  }
  const byKnowledge = new Map(knowledge.map((value) => [String(value.id), value]));
  const checks = sortedObjectsById(objects(source.checks, "Boundary checks").map((value) => {
    const checkKnowledgeId = string(value.checkKnowledgeId, "Boundary Check Knowledge identity");
    const selectedDefinition = byKnowledge.get(checkKnowledgeId);
    if (selectedDefinition === undefined) fail("basis", `Boundary Check selects absent Knowledge ${checkKnowledgeId}`);
    const definition = Object.freeze({ ...selectedDefinition });
    const bindings = stringSet(value.bindingIds, "Boundary Check bindings", 1).map((id) => {
      const binding = bindingRegistry.get(id);
      if (binding === undefined || binding.checkKnowledgeId !== checkKnowledgeId) {
        fail("basis", `Boundary Check Binding ${id} does not bind exact Check Knowledge ${checkKnowledgeId}`);
      }
      return Object.freeze({
        id: binding.id,
        digest: binding.digest,
        implementationDigest: binding.implementationDigest,
      });
    });
    return Object.freeze({
      id: string(value.id, "Boundary Check identity"),
      definition,
      bindings: Object.freeze(bindings),
      modality: string(value.modality, "Boundary Check modality"),
      purpose: string(value.purpose, "Boundary Check purpose"),
      baselineRequired: boolean(value.baselineRequired, "Boundary Check baseline requirement"),
      finalRequired: boolean(value.finalRequired, "Boundary Check final requirement"),
      obligationIds: stringSet(value.obligationIds, "Boundary Check obligations", 1),
      environmentRequirements: stringSet(value.environmentRequirements, "Boundary Check environment requirements"),
      fragmentDigest: digest(value.fragmentDigest, "Boundary Check fragment digest"),
    });
  }), "Boundary checks");
  const missingCheckPhase = missingWorkBoundaryRequiredCheckPhase(checks.map((check) => ({
    baselineRequired: boolean(check.baselineRequired, "Boundary Check baseline requirement"),
    finalRequired: boolean(check.finalRequired, "Boundary Check final requirement"),
  })));
  if (missingCheckPhase !== null) {
    fail("semantic-coverage", `A Work Boundary requires at least one ${missingCheckPhase} Check`);
  }

  const propositions = sortedObjectsById(objects(source.propositions, "Boundary propositions").map((value) => Object.freeze({
    id: string(value.id, "Boundary Proposition identity"),
    claim: string(value.claim, "Boundary Proposition claim"),
    evidenceKinds: stringSet(value.evidenceKinds, "Boundary Proposition Evidence kinds", 1),
    evidenceArtifactIds: stringSet(value.evidenceArtifactIds, "Boundary Proposition Evidence artifacts"),
    obligationIds: stringSet(value.obligationIds, "Boundary Proposition obligations", 1),
    effectIds: stringSet(value.effectIds, "Boundary Proposition effects"),
    riskIds: stringSet(value.riskIds, "Boundary Proposition risks"),
    path: nullableString(value.path, "Boundary Proposition path"),
    checkId: nullableString(value.checkId, "Boundary Proposition Check"),
    allowNotApplicable: boolean(value.allowNotApplicable, "Boundary Proposition not-applicable permission"),
    notApplicableCondition: nullableString(value.notApplicableCondition, "Boundary Proposition not-applicable condition"),
    fragmentDigest: digest(value.fragmentDigest, "Boundary Proposition fragment digest"),
  })), "Boundary propositions");

  const mandate = Object.freeze({
    objective,
    direction,
    effects,
    risks,
    obligations,
    artifacts,
    checks,
    acceptancePropositions: propositions,
  });
  return Object.freeze({
    knowledge: Object.freeze(knowledge),
    disciplines,
    externalSources: Object.freeze(externalSources),
    capabilityProfile: Object.freeze({ id: input.capabilityProfile.id, digest: input.capabilityProfile.digest }),
    projectionProfile: Object.freeze({ id: input.projectionProfile.id, digest: input.projectionProfile.digest }),
    mandate,
  });
}

const COMPARED_FIELDS = Object.freeze([
  "knowledge",
  "disciplines",
  "externalSources",
  "capabilityProfile",
  "mandate/objective",
  "mandate/direction",
  "mandate/effects",
  "mandate/risks",
  "mandate/obligations",
  "mandate/artifacts",
  "mandate/checks",
  "mandate/acceptancePropositions",
] as const);

function comparedValue(payload: ControlJsonObject, field: typeof COMPARED_FIELDS[number]): ControlJsonValue {
  const selected = field.startsWith("mandate/")
    ? object(payload.mandate, "Work Boundary mandate")[field.slice("mandate/".length)] : payload[field];
  if (selected === undefined) fail("resolution-kind", `Work Boundary omits compared field ${field}`);
  return selected;
}

export function changedWorkBoundaryMandateFields(
  prior: ControlRecordRevision,
  next: ControlJsonObject,
): readonly string[] {
  const changed = COMPARED_FIELDS.filter((field) =>
    canonicalJson(comparedValue(prior.payload, field)) !== canonicalJson(comparedValue(next, field)))
    .map((field) => `/${field}`);
  return Object.freeze(changed);
}

function boundaryIdentity(store: ControlRecordStore): string {
  return `work-boundary-${digestCanonical({
    recordKind: "work-boundary",
    storeId: store.identity.storeId,
    processId: store.identity.processId,
  }).slice("sha256:".length)}`;
}

function eventIdentity(
  store: ControlRecordStore,
  activityId: string,
  revision: number,
): string {
  return `event-work-boundary-finalized-${digestCanonical({
    eventKind: "work-boundary-finalized",
    storeId: store.identity.storeId,
    processId: store.identity.processId,
    activityId,
    revision,
  }).slice("sha256:".length)}`;
}

function markdown(payload: ControlJsonObject): string {
  const mandate = object(payload.mandate, "Work Boundary mandate");
  const objective = object(mandate.objective, "Work Boundary objective");
  const direction = object(mandate.direction, "Work Boundary direction");
  const list = (heading: string, values: readonly ControlJsonObject[], field: string): string[] => [
    `## ${heading}`,
    "",
    ...values.flatMap((value) => [`- ${String(value.id)}: ${String(value[field])}`]),
    "",
  ];
  return [
    "# Work Boundary",
    "",
    `- Proposal: ${String(payload.proposalKind)}`,
    `- Target: ${String(payload.targetId)}`,
    `- Selected Knowledge: ${(payload.knowledge as readonly unknown[]).length}`,
    `- Selected Discipline: ${objects(object(payload.disciplines, "Work Boundary Disciplines").records, "Work Boundary Discipline records").length}`,
    "",
    "## Objective",
    "",
    String(objective.interpretation),
    "",
    "## Selected Meaning",
    "",
    String(direction.selectedMeaning),
    "",
    "## Why Now",
    "",
    String(direction.whyNow),
    "",
    ...list("Obligations", objects(mandate.obligations, "Work Boundary obligations"), "statement"),
    ...list("Required Artifacts", objects(mandate.artifacts, "Work Boundary artifacts"), "path"),
    ...list("Checks", objects(mandate.checks, "Work Boundary checks"), "purpose"),
    ...list("Acceptance Propositions", objects(mandate.acceptancePropositions, "Work Boundary propositions"), "claim"),
  ].join("\n");
}

/** Select immutable governing context for one exact Material Condition resolution. */
export function resolveWorkBoundaryResolutionSnapshotV1(input: Readonly<{
  store: ControlRecordStore;
  boundary: ControlRecordRevision;
  materialCondition: ControlRecordRevision;
}>): FoundationRepositorySnapshot {
  const boundary = exactRevision(input.store, reference(input.boundary) as WorkBoundaryReference<"work-boundary">, "work-boundary", "Resolution Boundary");
  const condition = exactRevision(input.store, reference(input.materialCondition) as WorkBoundaryReference<"material-condition">, "material-condition", "Resolution Material Condition");
  if (!sameReference(oneRelationship(condition, "governed-by", "work-boundary"), reference(boundary))) {
    fail("basis", "Resolution Condition must be governed by its exact predecessor Boundary");
  }
  const source = object(condition.payload.source, "Material Condition source");
  if (source.kind === "integration-assessment") {
    const selected = oneRelationship(condition, "reported-by", "integration-assessment");
    const assessment = input.store.getRevision(selected.id, selected.revision);
    const frozen = oneRelationship(condition, "freezes", "candidate-revision");
    const candidate = input.store.getRevision(frozen.id, frozen.revision);
    if (assessment === null || assessment.recordKind !== "integration-assessment" || assessment.digest !== selected.digest ||
      candidate === null || candidate.recordKind !== "candidate-revision" || candidate.digest !== frozen.digest ||
      condition.relationships.some((item) => item.relation === "observed-in")) {
      fail("basis", "Integration resolution must bind one exact Assessment and frozen Candidate without an Agent Receipt");
    }
    const payload = parseFoundationIntegrationAssessmentPayloadV1(assessment.payload);
    const provenance = resolveCandidateIntegrationProvenanceV1({ store: input.store, candidate });
    if (payload.canonicalParent.targetId !== input.store.identity.targetId ||
      condition.payload.conditionClass !== "integration-context-change" || payload.outcome !== "constructed" ||
      payload.contextualApplicability.disposition !== "requires-readmission" ||
      condition.payload.observedFactsDigest !== digestCanonical(payload.contextualApplicability) ||
      candidate.payload.observation !== "integration-successor" || provenance === null ||
      !sameReference(reference(provenance.assessment), reference(assessment)) ||
      !sameReference(oneRelationship(assessment, "governed-by", "work-boundary"), reference(boundary))) {
      fail("basis", "Integration resolution does not reproduce its exact frozen context-change provenance");
    }
    return payload.canonicalParent;
  }
  if (source.kind === "projection-compilation") {
    const candidate = exactRevision(input.store, oneRelationship(condition, "freezes", "candidate-revision") as WorkBoundaryReference<"candidate-revision">,
      "candidate-revision", "Projection resolution Candidate");
    const seal = condition.relationships.some(({ relation }) => relation === "observed-in")
      ? exactRevision(input.store, oneRelationship(condition, "observed-in", "candidate-seal") as WorkBoundaryReference<"candidate-seal">,
        "candidate-seal", "Projection resolution Seal") : null;
    if (condition.payload.conditionClass !== "projection-closure-exceeded" ||
        condition.relationships.some(({ relation }) => relation === "reported-by") ||
        !sameReference(oneRelationship(candidate, "governed-by", "work-boundary"), reference(boundary)) ||
        (seal !== null && (!sameReference(oneRelationship(seal, "governed-by", "work-boundary"), reference(boundary)) ||
          !sameReference(oneRelationship(seal, "seals", "candidate-revision"), reference(candidate))))) {
      fail("basis", "Projection resolution must preserve its exact frozen Candidate, Seal, and governing Boundary");
    }
  } else if (source.kind !== "agent-proposal") fail("basis", "Resolution Condition has an unsupported context source");
  const report = condition.relationships.find((item) => item.relation === "reported-by");
  if (report?.target.kind === "agent-work-product") {
    const workProduct = exactRevision(input.store,
      oneRelationship(condition, "reported-by", "agent-work-product") as WorkBoundaryReference<"agent-work-product">,
      "agent-work-product", "Condition Work Product");
    if (workProduct.payload.role === "reviewer") {
      const semantics = object(workProduct.payload.roleSemantics, "Reviewer role semantics");
      const mandate = object(semantics.mandateApplicability, "Reviewer mandate applicability");
      const baselines = objects(semantics.baselineApplicability, "Reviewer baseline applicability");
      if (mandate.disposition === "requires-readmission" || baselines.some((item) => item.disposition === "insufficient")) {
        const resolve = <Kind extends WorkBoundaryRecordKind>(revision: ControlRecordRevision, relation: string, kind: Kind) =>
          exactRevision(input.store, oneRelationship(revision, relation, kind) as WorkBoundaryReference<Kind>, kind, `Reviewer resolution ${kind}`);
        const candidate = resolve(condition, "freezes", "candidate-revision");
        const attempt = resolve(workProduct, "result-of", "agent-attempt");
        const seal = resolve(attempt, "uses-seal", "candidate-seal");
        const receipt = resolve(condition, "observed-in", "execution-receipt");
        const matches = (record: ControlRecordRevision, relation: string, target: ControlRecordRevision) =>
          sameReference(oneRelationship(record, relation, target.recordKind), reference(target));
        if (attempt.payload.role !== "reviewer" || attempt.payload.operation !== "delivery.evaluate" ||
          receipt.payload.activityId !== attempt.payload.activityId ||
          !matches(attempt, "uses-boundary", boundary) || !matches(attempt, "uses-candidate", candidate) ||
          !matches(candidate, "governed-by", boundary) || !matches(seal, "seals", candidate) ||
          !matches(seal, "governed-by", boundary) || !matches(receipt, "observes-attempt", attempt) ||
          !matches(receipt, "observes-work-product", workProduct)) {
          fail("basis", "Reviewer resolution must preserve its exact Work Product, Receipt, Seal, Candidate, and governing Boundary");
        }
        const provenance = resolveCandidateIntegrationProvenanceV1({ store: input.store, candidate });
        if (provenance === null || provenance.canonicalParent.targetId !== input.store.identity.targetId) {
          fail("basis", "Reviewer applicability resolution requires the frozen Candidate's exact integration parent");
        }
        return provenance.canonicalParent;
      }
    }
  }
  const basis = object(boundary.payload.basis, "Resolution Work Boundary basis");
  const commit = string(basis.productBaseCommit, "Resolution Work Boundary commit");
  return Object.freeze({
    targetId: input.store.identity.targetId, commit, tree: string(basis.productBaseTree, "Resolution Work Boundary tree"),
    objectFormat: commit.length === 40 ? "sha1" : "sha256",
    contractDigest: digest(basis.repositoryContractDigest, "Resolution contract digest"),
    productStateDigest: digest(basis.productStateDigest, "Resolution Product State digest"),
    atlasStateDigest: digest(basis.atlasStateDigest, "Resolution Atlas State digest"),
    atlasResolutionDigest: digest(basis.atlasResolutionDigest, "Resolution Atlas Resolution digest"),
    atlasNormalizedModelDigest: digest(basis.atlasNormalizedModelDigest, "Resolution Atlas model digest"),
    atlasResourceBindingsDigest: digest(basis.atlasResourceBindingsDigest, "Resolution Atlas Resource digest"),
    knowledgeSetDigest: digest(basis.knowledgeSetDigest, "Resolution Knowledge Set digest"),
    digest: digest(basis.repositorySnapshotDigest, "Resolution repository Snapshot digest"),
  });
}

export function workBoundaryRepositoryBasisFromSnapshot(snapshot: FoundationRepositorySnapshot): WorkBoundaryRepositoryBasis {
  return Object.freeze({ productBaseCommit: snapshot.commit, productBaseTree: snapshot.tree,
    productStateDigest: snapshot.productStateDigest, atlasStateDigest: snapshot.atlasStateDigest,
    atlasResolutionDigest: snapshot.atlasResolutionDigest, atlasNormalizedModelDigest: snapshot.atlasNormalizedModelDigest,
    atlasResourceBindingsDigest: snapshot.atlasResourceBindingsDigest, repositoryContractDigest: snapshot.contractDigest,
    knowledgeSetDigest: snapshot.knowledgeSetDigest, repositorySnapshotDigest: snapshot.digest });
}

/**
 * Compile and atomically retain one complete immutable Work Boundary revision
 * from exact retained reconnaissance semantics and current runtime facts.
 */
export function retainWorkBoundary(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  operation: WorkBoundaryOperation;
  directorBrief: WorkBoundaryReference<"director-brief">;
  workProduct: WorkBoundaryReference<"agent-work-product">;
  executionReceipt: WorkBoundaryReference<"execution-receipt">;
  repository: WorkBoundaryRepositoryBasis;
  knowledge: readonly WorkBoundaryKnowledgeFact[];
  disciplineRegistry: WorkBoundaryDisciplineRegistryFact;
  externalSources: readonly WorkBoundaryExternalSourceFact[];
  capabilityProfile: WorkBoundaryProfileFact;
  projectionProfile: WorkBoundaryProjectionProfileFact;
  checkBindings: readonly WorkBoundaryCheckBindingFact[];
  compiler: WorkBoundaryCompilerFact;
  activeBoundary?: WorkBoundaryReference<"work-boundary"> | null;
  materialCondition?: WorkBoundaryReference<"material-condition"> | null;
  finalizedAt: string;
  runtimeId: string;
}>): Readonly<{ revision: ControlRecordRevision; event: ControlRecordEvent }> {
  const activityId = controlIdentifier(input.activityId, "Work Boundary activity identity");
  const operation = operationFacts(input.operation);
  validateActivity(input.store, activityId, input.operation);
  const brief = exactRevision(input.store, input.directorBrief, "director-brief", "Director Brief");
  const workProduct = exactRevision(input.store, input.workProduct, "agent-work-product", "Agent Work Product");
  const receipt = exactRevision(input.store, input.executionReceipt, "execution-receipt", "Execution Receipt");
  if (brief.payload.inputProfile !== input.operation) {
    fail("source", "Director Brief does not fund the exact Work Boundary operation");
  }
  retainedAttempt(input.store, input.operation, activityId, brief, workProduct, receipt);

  const activeInput = input.activeBoundary ?? null;
  const conditionInput = input.materialCondition ?? null;
  const state = input.store.state();
  exactCurrentReference(state.subjects.activeBoundary, activeInput, "Active Work Boundary");
  exactCurrentReference(state.subjects.materialCondition, conditionInput, "Material Condition");
  if (operation.proposalKind === "initial") {
    if (activeInput !== null || conditionInput !== null) {
      fail("succession", "An initial Work Boundary cannot bind a predecessor or Material Condition");
    }
  } else if (activeInput === null || conditionInput === null) {
    fail("succession", "A resolved Work Boundary requires both the active predecessor and Material Condition");
  }

  const active = activeInput === null
    ? null
    : exactRevision(input.store, activeInput, "work-boundary", "Active Work Boundary");
  if (active !== null && active.recordId !== boundaryIdentity(input.store)) {
    fail("succession", "Active Work Boundary does not have the deterministic Delivery Boundary identity");
  }
  if (conditionInput !== null && active !== null) {
    const condition = exactRevision(input.store, conditionInput, "material-condition", "Material Condition");
    const expected = workBoundaryRepositoryBasisFromSnapshot(resolveWorkBoundaryResolutionSnapshotV1({
      store: input.store, boundary: active, materialCondition: condition,
    }));
    if (canonicalJson(input.repository) !== canonicalJson(expected)) {
      fail("basis", "Resolved Boundary must retain the exact context selected by its Material Condition");
    }
  }
  if (!GIT_OBJECT.test(input.repository.productBaseCommit) || !GIT_OBJECT.test(input.repository.productBaseTree)) {
    fail("basis", "Work Boundary product base commit and tree must be exact Git object identities");
  }

  const normalized = normalizeMandate({
    workProduct,
    knowledge: input.knowledge,
    disciplineRegistry: input.disciplineRegistry,
    externalSources: input.externalSources,
    capabilityProfile: input.capabilityProfile,
    projectionProfile: input.projectionProfile,
    checkBindings: input.checkBindings,
  });
  const basis: ControlJsonObject = Object.freeze({
    specificationRevision: "lifecycle.foundation.1.0.0-rc.17",
    repositoryContract: "lifecycle.repository.v22",
    providerAdapter: "lifecycle.provider-adapter.v7",
    ...input.repository,
  });
  const prospective: ControlJsonObject = Object.freeze({
    knowledge: normalized.knowledge,
    disciplines: normalized.disciplines,
    externalSources: normalized.externalSources,
    capabilityProfile: normalized.capabilityProfile,
    mandate: normalized.mandate,
  });
  const changed = active === null ? Object.freeze([]) : changedWorkBoundaryMandateFields(active, prospective);
  if (
    (operation.proposalKind === "revision" && changed.length === 0) ||
    (operation.proposalKind === "reaffirmation" && changed.length !== 0)
  ) fail("resolution-kind", `${operation.proposalKind} disagrees with the complete derived mandate change set`);
  const resolution = operation.resolutionKind === null
    ? null
    : Object.freeze({
        kind: operation.resolutionKind,
        rationaleDigest: digest(brief.payload.semanticMarkdownDigest, "Director resolution rationale digest"),
        changedMandateFields: changed,
      });
  const payload: ControlJsonObject = Object.freeze({
    schema: "lifecycle.work-boundary-payload.v6",
    profileId: "lifecycle.work-boundary.foundation-v3",
    targetId: input.store.identity.targetId,
    proposalKind: operation.proposalKind,
    basis,
    knowledge: normalized.knowledge,
    disciplines: normalized.disciplines,
    externalSources: normalized.externalSources,
    capabilityProfile: normalized.capabilityProfile,
    projectionProfile: normalized.projectionProfile,
    mandate: normalized.mandate,
    resolution,
    compiler: Object.freeze({ ...input.compiler }),
  });
  const recordId = active?.recordId ?? boundaryIdentity(input.store);
  const revisionNumber = active === null ? 1 : active.revision + 1;
  const relationships: readonly ControlRecordRelationship[] = Object.freeze([
    Object.freeze({ relation: "uses-brief", target: reference(brief) }),
    Object.freeze({ relation: "proposed-from", target: reference(workProduct) }),
    ...(active === null ? [] : [Object.freeze({ relation: "revises", target: reference(active) })]),
    ...(conditionInput === null ? [] : [Object.freeze({ relation: "resolves", target: conditionInput })]),
  ]);
  const revisionInput = Object.freeze({
    recordId,
    recordKind: "work-boundary",
    revision: revisionNumber,
    producer: Object.freeze({ kind: "runtime" as const, id: input.runtimeId }),
    semanticAuthor: Object.freeze({ kind: "runtime" as const, id: input.runtimeId }),
    semanticAuthority: "runtime-derived" as const,
    createdAt: input.finalizedAt,
    semanticMarkdown: markdown(payload),
    payload,
    relationships,
  });
  const compiled = compileControlRecordRevision(input.store.identity.processId, revisionInput);
  assertDeliveryControlRecordPolicy(compiled);
  assertDeliveryControlRecordPayload(compiled);
  const retained = input.store.append({
    revision: revisionInput,
    event: {
      eventId: eventIdentity(input.store, activityId, revisionNumber),
      eventKind: "work-boundary-finalized",
      occurredAt: input.finalizedAt,
      actor: { kind: "runtime", id: input.runtimeId },
      subject: { recordId: compiled.recordId, revision: compiled.revision, digest: compiled.digest },
      payload: { activityId },
    },
  });
  if (retained.revision === null) fail("retention", "Work Boundary finalization did not retain its exact revision");
  return Object.freeze({ revision: retained.revision, event: retained.event });
}
