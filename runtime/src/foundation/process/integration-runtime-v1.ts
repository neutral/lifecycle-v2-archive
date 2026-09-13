import { candidateRevisionCarrierVerifier, publishCandidateRevisionCarrierFromGitTree } from "../candidate/carrier-binding.js";
import { deriveCandidateRevisionCarrierAdmittedContext } from "../candidate/carrier-observation-context.js";
import { FOUNDATION_CANDIDATE_CARRIER_STATE_INVALID } from "../candidate/carrier-state-observer.js";
import { constructFoundationIntegrationTreeV1, foundationIntegrationMergeRuleV1, type FoundationIntegrationMergeRuleV1 } from "../candidate/integration-merge.js";
import { compileDeliveryActivityStartAppend } from "../control/activity.js";
import { prepareCandidateRevisionRetention, type CandidateRevisionCarrierVerification } from "../control/candidate-revision.js";
import { foundationIntegrationValidationFactsDigestV1, parseFoundationIntegrationAssessmentPayloadV1, prepareIntegrationAssessmentRetentionV1, type FoundationIntegrationAssessmentPayloadV1 } from "../control/integration-assessment.js";
import { prepareIntegrationMaterialConditionV1 } from "../control/material-condition.js";
import { controlIdentifier, controlTimestamp } from "../control/model.js";
import type { ControlRecordStore } from "../control/store.js";
import type { WorkDelegationReservation } from "../control/work-delegation.js";
import type { ControlJsonObject, ControlRecordRevision, ControlRecordRelationshipTarget } from "../control/types.js";
import { FoundationError } from "../error.js";
import { validateKnowledgeSet } from "../knowledge/knowledge-set.js";
import { compareFoundationIntegrationContextV1 } from "../projection/integration-context.js";
import { openFoundationDeliveryGitBasisV1, openFoundationDeliveryGitSnapshotV1, retainFoundationDeliveryGitCommitV1 } from "../repository/delivery-git-basis.js";
import { withTargetOperationLock } from "../repository/operation-lock.js";
import { bindRepositorySnapshot, loadRepositoryEpoch, loadRepositoryIdentityEpoch } from "../repository/snapshot.js";
import type { FoundationRepositorySnapshot } from "../repository/types.js";
import { canonicalJson, digestCanonical, selfDigest, type Sha256 } from "../validation/canonical.js";
import { assertFoundationSchema } from "../validation/schema-engine.js";
import { createFoundationActivityKernelCheckpointAdapterV7, finishFoundationActivityKernelV7, openFoundationActivityKernelV7, type FoundationActivityKernelStandardDefinitionV7 } from "./activity-kernel-v7.js";

const PLAN_SCHEMA = "lifecycle.integration-plan.private.v1" as const;
type IntegrationPlan = Readonly<{
  schema: typeof PLAN_SCHEMA;
  boundary: ControlRecordRelationshipTarget;
  sourceCandidate: ControlRecordRelationshipTarget;
  canonicalParent: FoundationRepositorySnapshot;
  mergeRule: FoundationIntegrationMergeRuleV1;
  runtimeId: string;
  startedAt: string;
}>;

export type FoundationIntegrationRuntimeV1Input = Readonly<{
  target: string;
  machineHome: string;
  store: ControlRecordStore;
  activityId: string;
  runtimeId: string;
  reservation?: WorkDelegationReservation;
}>;
export type FoundationIntegrationRuntimeV1Options = Readonly<{
  now?: () => string;
  /** Owner-local fault boundary, after the named facts are durable. */
  afterCheckpoint?: (checkpoint: "opened" | "assessed" | "candidate-selected") => void | Promise<void>;
}>;
export type FoundationIntegrationRuntimeV1Result = Readonly<{
  activityId: string;
  operation: "delivery.integrate";
  outcome: FoundationIntegrationAssessmentPayloadV1["outcome"];
  assessment: ControlRecordRelationshipTarget;
  candidate: ControlRecordRelationshipTarget;
}>;

function fail(message: string): never {
  throw new FoundationError("lifecycle.integration.assessment-invalid", message);
}
function exactMembers(value: unknown, members: readonly string[], label: string): asserts value is ControlJsonObject {
  if (value === null || Array.isArray(value) || typeof value !== "object" ||
    canonicalJson(Object.keys(value).sort()) !== canonicalJson([...members].sort())) fail(`${label} has an invalid exact shape`);
}
function reference<Kind extends string>(record: ControlRecordRevision, kind: Kind): Readonly<{kind: Kind; id: string; revision: number; digest: Sha256}> {
  if (record.recordKind !== kind) fail(`Integration requires one exact ${kind}`);
  return Object.freeze({ kind, id: record.recordId, revision: record.revision, digest: record.digest });
}
function retained(store: ControlRecordStore, subject: ControlRecordRelationshipTarget): ControlRecordRevision {
  const record = store.getRevision(subject.id, subject.revision);
  if (record === null || record.recordKind !== subject.kind || record.digest !== subject.digest || record.processId !== store.identity.processId) {
    fail("Integration input is not one exact retained Delivery subject");
  }
  return record;
}
function parsePlan(value: ControlJsonObject): IntegrationPlan {
  exactMembers(value, ["schema", "boundary", "sourceCandidate", "canonicalParent", "mergeRule", "runtimeId", "startedAt"], "Integration plan");
  if (value.schema !== PLAN_SCHEMA) fail("Integration plan schema is not selected");
  for (const [name, kind] of [["boundary", "work-boundary"], ["sourceCandidate", "candidate-revision"]] as const) {
    const subject = value[name];
    exactMembers(subject, ["kind", "id", "revision", "digest"], `Integration ${name}`);
    if (subject.kind !== kind || typeof subject.id !== "string" || !Number.isSafeInteger(subject.revision) ||
      (subject.revision as number) < 1 || typeof subject.digest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(subject.digest)) fail("Integration plan subject is invalid");
    controlIdentifier(subject.id, "Integration subject identity");
  }
  assertFoundationSchema("urn:lifecycle:schema:repository-snapshot:v1", value.canonicalParent, "Integration parent");
  const parent = value.canonicalParent as FoundationRepositorySnapshot;
  if (selfDigest(parent) !== parent.digest) fail("Integration plan parent digest is invalid");
  exactMembers(value.mergeRule, ["id", "implementationId", "implementationDigest"], "Integration merge rule");
  if (value.mergeRule.id !== "lifecycle.integration.three-way.v2" || typeof value.mergeRule.implementationId !== "string" ||
    typeof value.mergeRule.implementationDigest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value.mergeRule.implementationDigest)) fail("Integration rule selection is invalid");
  controlIdentifier(value.mergeRule.implementationId, "Integration implementation identity");
  if (typeof value.runtimeId !== "string" || typeof value.startedAt !== "string") fail("Integration opening is invalid");
  controlIdentifier(value.runtimeId, "Integration Runtime identity");
  controlTimestamp(value.startedAt, "Integration start time");
  return value as IntegrationPlan;
}
const DEFINITION_FACTS = Object.freeze({
  id: "lifecycle.integration-runtime.v1", plan: PLAN_SCHEMA, operation: "delivery.integrate",
  ordering: ["retain-exact-inputs", "assess", "retain-carrier", "select-candidate-and-condition-atomically", "complete"],
  replay: "same-source-parent-rule-and-observed-result",
});
export const FOUNDATION_INTEGRATION_RUNTIME_V1: FoundationActivityKernelStandardDefinitionV7<IntegrationPlan> = Object.freeze({
  id: DEFINITION_FACTS.id, digest: digestCanonical(DEFINITION_FACTS), operation: "delivery.integrate", terminal: false,
  parsePlan,
  parseCheckpoint() { return fail("Integration retains its immutable plan and authoritative records without a parallel result checkpoint"); },
});

async function selectParent(input: FoundationIntegrationRuntimeV1Input): Promise<FoundationRepositorySnapshot> {
  // Only observation and durable input custody hold the canonical lock. Context
  // compilation, merge, and the whole remaining Delivery execute independently.
  const repository = await withTargetOperationLock(input.target, "delivery-integration-parent", async () => {
    const current = await loadRepositoryIdentityEpoch(input.target);
    if (current.contract.targetId !== input.store.identity.targetId) fail("Integration parent belongs to another Target");
    return await retainFoundationDeliveryGitCommitV1({ machineHome: input.machineHome, repository: current.repository,
      identity: input.store.identity, commit: current.epoch.commit, tree: current.epoch.tree,
      canonicalBranch: current.contract.canonicalBranch });
  });
  const epoch = await loadRepositoryEpoch(repository);
  const result = await validateKnowledgeSet(epoch);
  if (result.knowledgeSet === null || !result.validation.complete || !result.validation.valid) {
    fail("Integration requires one complete valid selected canonical parent Snapshot");
  }
  return (await bindRepositorySnapshot(epoch, result.knowledgeSet)).snapshot;
}

async function reproduce(input: FoundationIntegrationRuntimeV1Input, plan: IntegrationPlan, assessedAt: string) {
  const boundary = retained(input.store, plan.boundary);
  const source = retained(input.store, plan.sourceCandidate);
  const admitted = await openFoundationDeliveryGitBasisV1({ machineHome: input.machineHome, repository: input.target, store: input.store, boundary });
  const parent = await openFoundationDeliveryGitSnapshotV1({ machineHome: input.machineHome, repository: input.target, identity: input.store.identity, snapshot: plan.canonicalParent });
  const sourceContext = await deriveCandidateRevisionCarrierAdmittedContext({ machineHome: input.machineHome, repository: input.target, store: input.store, boundary, candidate: source });
  const contextualApplicability = compareFoundationIntegrationContextV1({ boundary, admitted, parent });
  const manifest = source.payload.carrierManifest as ControlJsonObject;
  if (manifest === null || typeof manifest !== "object" || typeof manifest.digest !== "string") fail("Integration source lacks its exact Carrier manifest");
  const retainedManifest = await input.store.readRetainedFile(manifest.digest as Sha256);
  if (retainedManifest === null || ["digest", "byteLength", "mediaType", "purpose"].some((key) => retainedManifest.descriptor[key as "digest" | "byteLength" | "mediaType" | "purpose"] !== manifest[key])) fail("Integration source Carrier manifest does not reopen exactly");
  const baseCarrier = await publishCandidateRevisionCarrierFromGitTree({ machineHome: input.machineHome, repository: sourceContext.repository, rootTree: sourceContext.epoch.tree });
  const parentCarrier = await publishCandidateRevisionCarrierFromGitTree({ machineHome: input.machineHome, repository: parent.repository, rootTree: parent.loaded.epoch.tree });
  const merged = await constructFoundationIntegrationTreeV1({ machineHome: input.machineHome, baseManifestBytes: baseCarrier.manifestBytes,
    candidateManifestBytes: retainedManifest.bytes, parentManifestBytes: parentCarrier.manifestBytes, mergeRule: plan.mergeRule });
  let outcome: FoundationIntegrationAssessmentPayloadV1["outcome"] = merged.outcome;
  let observation: CandidateRevisionCarrierVerification | null = null;
  let validation: FoundationIntegrationAssessmentPayloadV1["validation"];
  const predecessor = { candidateDigest: (source.payload.state as ControlJsonObject).candidateDigest as Sha256 };
  const application = await deriveCandidateRevisionCarrierAdmittedContext({ machineHome: input.machineHome, repository: input.target,
    store: input.store, boundary, integrationParent: plan.canonicalParent });
  const verifyCarrier = candidateRevisionCarrierVerifier({ machineHome: input.machineHome, admitted: application, predecessor });
  if (merged.outcome === "constructed") {
    try {
      observation = await verifyCarrier({ manifestBytes: merged.manifestBytes });
      validation = Object.freeze({ complete: true, valid: true, diagnosticCodes: [], factsDigest: foundationIntegrationValidationFactsDigestV1(observation) });
    } catch (error) {
      // Missing custody, interruption, and I/O never become a conclusive invalid
      // result. Only the physical observer's owned content refusal does.
      if (!(error instanceof FoundationError) || error.code !== FOUNDATION_CANDIDATE_CARRIER_STATE_INVALID) throw error;
      outcome = "invalid";
      validation = Object.freeze({ complete: true, valid: false, diagnosticCodes: [error.code],
        factsDigest: digestCanonical({ schema: "lifecycle.integration-validation-refusal.v1", rootTree: merged.rootTree, diagnosticCode: error.code }) });
    }
  } else {
    validation = Object.freeze({ complete: false, valid: false, diagnosticCodes: [],
      factsDigest: digestCanonical({ schema: "lifecycle.integration-conflict-facts.v1", conflicts: merged.conflicts }) });
  }
  const payload = parseFoundationIntegrationAssessmentPayloadV1({ schema: "lifecycle.integration-assessment-payload.v1",
    profileId: "lifecycle.integration-assessment.foundation-v1", canonicalParent: plan.canonicalParent, mergeRule: plan.mergeRule,
    outcome, conflicts: merged.conflicts, validation, contextualApplicability, assessedAt, limitations: [] });
  return { payload, source, boundary, merged, verifyCarrier, observation };
}

function assessmentForActivity(input: FoundationIntegrationRuntimeV1Input): ControlRecordRevision {
  // The deterministic identity is the Assessment owner's identity, resolved
  // through this Activity's exact Journal event rather than a latest pointer.
  let cursor = 0;
  for (let count = 0; count < 100_000;) {
    const events = input.store.listEvents(cursor, 1000);
    for (const event of events) {
      if (event.eventKind === "integration-assessed" && event.payload.activityId === input.activityId && event.subject !== null) {
        return retained(input.store, { kind: "integration-assessment", id: event.subject.recordId, revision: event.subject.revision, digest: event.subject.digest });
      }
    }
    if (events.length < 1000) break;
    count += events.length;
    cursor = events.at(-1)!.sequence;
  }
  return fail("Integration Activity has no exact retained Assessment event");
}

async function advance(input: FoundationIntegrationRuntimeV1Input, options: FoundationIntegrationRuntimeV1Options): Promise<FoundationIntegrationRuntimeV1Result> {
  const adapter = createFoundationActivityKernelCheckpointAdapterV7({ store: input.store, activityId: input.activityId, definition: FOUNDATION_INTEGRATION_RUNTIME_V1 });
  let current = adapter.current();
  const plan = current.envelope.plan.value;
  if (input.runtimeId !== plan.runtimeId || plan.canonicalParent.targetId !== input.store.identity.targetId) fail("Integration recovery changed its exact Runtime or Target");
  const now = options.now ?? (() => new Date().toISOString());
  if (current.recovery.resumesAt === "integration-assessed") {
    const result = await reproduce(input, plan, controlTimestamp(now(), "Integration assessment time"));
    const prepared = prepareIntegrationAssessmentRetentionV1({ store: input.store, activityId: input.activityId,
      boundary: result.boundary, sourceCandidate: result.source, payload: result.payload, runtimeId: plan.runtimeId });
    adapter.commit({ mode: "append", expected: current.coordinate, checkpoint: null, append: prepared.append });
    await options.afterCheckpoint?.("assessed");
    current = adapter.current();
  }
  const assessment = assessmentForActivity(input);
  const payload = parseFoundationIntegrationAssessmentPayloadV1(assessment.payload);
  if (current.recovery.resumesAt === "candidate-revision-observed") {
    // A has no parallel Candidate state. Reproduce its exact inputs and physical
    // facts before selecting I; canonical HEAD is deliberately never reread.
    const result = await reproduce(input, plan, payload.assessedAt);
    if (canonicalJson(result.payload) !== canonicalJson(payload) || result.merged.outcome !== "constructed" || result.observation === null) {
      fail("Integration recovery does not reproduce the retained Assessment facts");
    }
    const prepared = await prepareCandidateRevisionRetention({ store: input.store, activityId: input.activityId,
      observation: "integration-successor", candidateBaseCommit: plan.canonicalParent.commit,
      carrierManifestBytes: result.merged.manifestBytes, verifyCarrier: result.verifyCarrier,
      boundary: reference(result.boundary, "work-boundary"), predecessor: reference(result.source, "candidate-revision"),
      integrationAssessment: reference(assessment, "integration-assessment"), observedAt: payload.assessedAt, runtimeId: plan.runtimeId });
    const condition = payload.contextualApplicability.disposition === "requires-readmission"
      ? prepareIntegrationMaterialConditionV1({ store: input.store, activityId: input.activityId, assessment, candidate: prepared.expected.revision,
          runtime: { implementationId: FOUNDATION_INTEGRATION_RUNTIME_V1.id, implementationDigest: FOUNDATION_INTEGRATION_RUNTIME_V1.digest },
          frozenAt: payload.assessedAt, runtimeId: plan.runtimeId }) : null;
    await adapter.commitWithFiles({ expected: current.coordinate, checkpoint: null, append: prepared.append, files: prepared.files,
      ...(condition === null ? {} : { followingAppends: [condition.append] }) });
    await options.afterCheckpoint?.("candidate-selected");
    current = adapter.current();
  }
  if (current.recovery.resumesAt !== "activity-completed") fail("Integration has an unsupported retained recovery obligation");
  finishFoundationActivityKernelV7({ store: input.store, activityId: input.activityId, definition: FOUNDATION_INTEGRATION_RUNTIME_V1,
    runtimeId: plan.runtimeId, outcome: "completed", sampleCompletedAt: now });
  const selected = input.store.state().subjects.candidate;
  if (selected === null) fail("Completed integration lost the continuing Candidate");
  return Object.freeze({ activityId: input.activityId, operation: "delivery.integrate", outcome: payload.outcome,
    assessment: reference(assessment, "integration-assessment"), candidate: { kind: "candidate-revision", ...selected } });
}

/** Requires the caller's per-Delivery operation lock; never holds a Delivery-long canonical lease. */
export async function operateFoundationIntegrationRuntimeV1(input: FoundationIntegrationRuntimeV1Input, options: FoundationIntegrationRuntimeV1Options = {}): Promise<FoundationIntegrationRuntimeV1Result> {
  const state = input.store.state();
  if (!state.eligibleOperations.includes("delivery.integrate") || state.subjects.activeBoundary === null || state.subjects.candidate === null) fail("Integration is not eligible for the exact current Delivery");
  const boundary = retained(input.store, { kind: "work-boundary", ...state.subjects.activeBoundary });
  // Pin governing history before the live parent is observed, then retain P
  // before publishing any Activity that depends on it.
  await openFoundationDeliveryGitBasisV1({ machineHome: input.machineHome, repository: input.target, store: input.store, boundary });
  const canonicalParent = await selectParent(input);
  const startedAt = controlTimestamp((options.now ?? (() => new Date().toISOString()))(), "Integration start time");
  const plan: IntegrationPlan = Object.freeze({ schema: PLAN_SCHEMA, boundary: reference(boundary, "work-boundary"),
    sourceCandidate: { kind: "candidate-revision", ...state.subjects.candidate }, canonicalParent,
    mergeRule: await foundationIntegrationMergeRuleV1(), runtimeId: controlIdentifier(input.runtimeId, "Integration Runtime identity"), startedAt });
  openFoundationActivityKernelV7({ store: input.store, activityId: input.activityId, definition: FOUNDATION_INTEGRATION_RUNTIME_V1, plan,
    appends: [compileDeliveryActivityStartAppend({ store: input.store, activityId: input.activityId, operation: "delivery.integrate", startedAt, runtimeId: input.runtimeId,
      ...(input.reservation === undefined ? {} : { reservation: input.reservation }) })] });
  await options.afterCheckpoint?.("opened");
  return await advance(input, options);
}

/** Resume exact retained B/C/P and rule. A new current parent requires a new Activity. */
export async function recoverFoundationIntegrationRuntimeV1(input: FoundationIntegrationRuntimeV1Input, options: FoundationIntegrationRuntimeV1Options = {}): Promise<FoundationIntegrationRuntimeV1Result> {
  return await advance(input, options);
}
