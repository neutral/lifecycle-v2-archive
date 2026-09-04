import {
  FOUNDATION_ATTEMPT_VIEW_PROFILE_ID,
  FOUNDATION_ATTEMPT_VIEW_SCHEMA,
  FOUNDATION_DELIVERY_REDUCER_ID,
} from "@neutral/lifecycle-protocol";
import { FoundationError } from "../error.js";
import {
  DELIVERY_EVENT_KINDS,
  type DeliveryEventKind,
} from "../process/delivery-event-registry.js";
import {
  composeDeliveryStoreDisposition,
  reduceDeliveryEvents,
  type ReducedDeliveryState,
} from "../process/delivery-reducer.js";
import {
  DELIVERY_OPERATIONS,
} from "../process/operation-registry.js";
import type {
  DeliveryCandidateCondition,
  DeliveryOperation,
  DeliveryStanding,
} from "../process/delivery-state.js";
import { foundationDockerExecutionBackendProfileV1 } from "../execution/docker-profile-v1.js";
import { compileFoundationInstalledAgentExecutionPolicyV1 } from "../execution/installed-agent-runtime-v1.js";
import {
  canonicalJson,
  digestCanonical,
  type Sha256,
} from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import {
  executionReceiptSubmissionDiagnostic,
  type ExecutionReceiptSubmissionDiagnostic,
} from "./execution-receipt.js";
import type { DeliveryControlPhysicalDisposition } from "./public-view.js";
import type { ControlRecordStore } from "./store.js";
import type {
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordEvent,
  ControlRecordRelationshipTarget,
  ControlRecordRevision,
} from "./types.js";

export {
  FOUNDATION_ATTEMPT_VIEW_PROFILE_ID,
  FOUNDATION_ATTEMPT_VIEW_SCHEMA,
  FOUNDATION_DELIVERY_REDUCER_ID,
};

const ATTEMPT_VIEW_DIAGNOSTICS = Object.freeze([
  "lifecycle.attempt-view.binding",
  "lifecycle.attempt-view.stale",
  "lifecycle.attempt-view.obligation-missing",
  "lifecycle.attempt-view.provenance",
  "lifecycle.attempt-view.evidence-subject",
  "lifecycle.attempt-view.eligibility",
  "lifecycle.attempt-view.progress",
  "lifecycle.attempt-view.authority",
  "lifecycle.attempt-view.disclosure",
  "lifecycle.attempt-view.incomplete",
] as const);

const REDUCER_PROFILE = Object.freeze({
  id: FOUNDATION_DELIVERY_REDUCER_ID,
  digest: digestCanonical(Object.freeze({
    schema: "lifecycle.delivery-reducer-profile.v1",
    id: FOUNDATION_DELIVERY_REDUCER_ID,
    events: DELIVERY_EVENT_KINDS,
    operations: DELIVERY_OPERATIONS,
  })),
});

const VIEW_PROFILE = Object.freeze({
  id: FOUNDATION_ATTEMPT_VIEW_PROFILE_ID,
  digest: digestCanonical(Object.freeze({
    schema: "lifecycle.attempt-view-profile.v1",
    id: FOUNDATION_ATTEMPT_VIEW_PROFILE_ID,
    reducer: REDUCER_PROFILE,
    sections: Object.freeze([
      "attempt-contract",
      "provider-execution",
      "agent-semantics",
      "candidate-transition",
      "process-and-proof",
    ]),
    executionPresentation: "sanitized-agent-selection-v1",
    provenance: Object.freeze([
      "runtime-observed",
      "runtime-derived",
      "agent-proposed",
      "founder-supplied",
      "founder-authenticated",
    ]),
    diagnostics: ATTEMPT_VIEW_DIAGNOSTICS,
  })),
});

const ROLE_OPERATIONS = Object.freeze({
  reconnaissance: Object.freeze([
    "delivery.prepare",
    "delivery.revise",
    "delivery.reaffirm",
  ]),
  builder: Object.freeze(["delivery.continue"]),
  reviewer: Object.freeze(["delivery.evaluate"]),
} as const);

type AttemptRole = keyof typeof ROLE_OPERATIONS;

type FoundationAttemptViewExecutionSelection = Readonly<{
  backendProfile: Readonly<{
    profileId: "lifecycle.execution-backend-profile.docker-local.v1";
    profileDigest: Sha256;
    implementationDigest: Sha256;
  }>;
  image: Readonly<{ imageId: string; imageDigest: Sha256 }>;
  inputSet: Readonly<{
    profileId: "lifecycle.execution-input-set.v1";
    digest: Sha256;
  }>;
  network: Readonly<{
    agentProductNetwork: "none";
    separationRequired: true;
  }>;
  services: Readonly<{
    providerControlPlane: "fixed-service-channel";
  }>;
  effectiveLimits: Readonly<{
    wallTimeMilliseconds: number;
    processes: number;
    storageBytes: number;
    outputEntries: number;
    outputBytes: number;
    outputEntryBytes: number;
    events: number;
  }>;
}>;

type FoundationAttemptViewExecutionFacts = FoundationAttemptViewExecutionSelection & Readonly<{
  specificationDigest: Sha256;
  runnerDigest: Sha256;
  observationDigest: Sha256;
  outputManifest: Readonly<{
    availability: "retrieved" | "not-produced" | "unavailable";
    digest: Sha256 | null;
  }>;
}>;

export type FoundationAttemptViewReference<Kind extends string = string> = Readonly<{
  kind: Kind;
  id: string;
  revision: number;
  digest: Sha256;
}>;

export type FoundationAttemptViewSelection =
  | Readonly<{ kind: "attempt"; attemptId: string }>
  | Readonly<{ kind: "latest-attempt" }>;

export type FoundationAttemptViewDiagnostic = Readonly<{
  code: typeof ATTEMPT_VIEW_DIAGNOSTICS[number];
  stage: string;
  factsDigest: Sha256;
}>;

export type FoundationAttemptViewCheckReceipt = Readonly<{
  reference: FoundationAttemptViewReference<"check-receipt">;
  provenance: "runtime-observed";
  binding: ControlJsonObject;
  proofSubject:
    | FoundationAttemptViewReference<"work-boundary">
    | FoundationAttemptViewReference<"candidate-seal">;
  proofRequestDigest: Sha256;
  environment: ControlJsonObject;
  disposition: string;
  resultFacts: readonly ControlJsonValue[];
  reasonCode: string | null;
  execution: ControlJsonObject | null;
  subjectIntegrity: string;
  containment: ControlJsonObject;
  retirement: ControlJsonObject;
  limitations: readonly ControlJsonValue[];
}>;

export type FoundationAttemptViewCheck = Readonly<{
  selectionId: string;
  definitionId: string;
  definition: ControlJsonObject;
  bindingIds: readonly string[];
  modality: string;
  obligationIds: readonly string[];
  baselineRequired: boolean;
  finalRequired: boolean;
  baseline: FoundationAttemptViewCheckReceipt | null;
  final: FoundationAttemptViewCheckReceipt | null;
  freshExecutionRequired: boolean;
}>;

export type FoundationAttemptViewObligationStanding =
  | "not-evaluated"
  | "artifact-absent"
  | "artifact-present-uninspected"
  | "check-not-run"
  | "check-passed"
  | "check-failed"
  | "check-incomplete"
  | "review-pending"
  | "review-accepted"
  | "review-rejected"
  | "conflict"
  | "material-condition"
  | "satisfied-for-current-phase"
  | "inapplicable-by-boundary";

export type FoundationAttemptViewObligation = Readonly<{
  id: string;
  kind: string;
  statement: string;
  severity: string;
  sourceIds: readonly string[];
  artifactIds: readonly string[];
  propositionIds: readonly string[];
  checkSelectionIds: readonly string[];
  relatedAgentClaimIds: readonly string[];
  standing: FoundationAttemptViewObligationStanding;
  blocking: boolean;
  establishmentRoute:
    | "develop-or-evaluate"
    | "inspect-artifact"
    | "run-or-correct-check"
    | "complete-independent-review"
    | "correct-reviewed-result"
    | "resolve-boundary"
    | "none";
}>;

export type FoundationAttemptView = Readonly<{
  schema: typeof FOUNDATION_ATTEMPT_VIEW_SCHEMA;
  complete: boolean;
  coordinate: Readonly<{
    storeId: string;
    processId: string;
    journal: Readonly<{ headSequence: number; headDigest: Sha256 }>;
    attempt: FoundationAttemptViewReference<"agent-attempt">;
    reducer: typeof REDUCER_PROFILE;
    profile: typeof VIEW_PROFILE;
    currentBoundary: FoundationAttemptViewReference<"work-boundary"> | null;
    currentCandidate: FoundationAttemptViewReference<"candidate-revision"> | null;
    activeActivity: Readonly<{
      id: string;
      operation: DeliveryOperation;
      stage: string;
      recovery: Readonly<{
        kind: string;
        resumesAt: string;
        exactEffectDigest: Sha256 | null;
      }> | null;
    }> | null;
  }>;
  attemptContract: Readonly<{
    provenance: "runtime-derived";
    activityId: string;
    operation: DeliveryOperation;
    role: AttemptRole;
    invocationId: string;
    preDispatchStateDigest: Sha256;
    brief: FoundationAttemptViewReference<"founder-brief">;
    boundary: FoundationAttemptViewReference<"work-boundary"> | null;
    candidate: FoundationAttemptViewReference<"candidate-revision"> | null;
    seal: FoundationAttemptViewReference<"candidate-seal"> | null;
    projection: ControlJsonObject;
    capability: ControlJsonObject;
    investment: ControlJsonObject;
    provider: ControlJsonObject;
    authoring: ControlJsonObject;
    input: ControlJsonObject;
    execution: FoundationAttemptViewExecutionSelection;
  }>;
  providerExecution: Readonly<{
    provenance: "runtime-observed";
    receipt: FoundationAttemptViewReference<"execution-receipt"> | null;
    effect: Readonly<{
      intended: boolean;
      observed: boolean;
      digest: Sha256 | null;
      outcome: "completed" | "failed" | "not-started" | null;
    }>;
    productiveExecutionStarted: boolean | null;
    provider: ControlJsonObject | null;
    execution: FoundationAttemptViewExecutionFacts | null;
    containment: ControlJsonObject | null;
    retirement: ControlJsonObject | null;
  }>;
  agentSemantics: Readonly<{
    workProduct: FoundationAttemptViewReference<"agent-work-product"> | null;
    provenance: "agent-proposed";
    disposition: string | null;
    summary: ControlJsonObject | null;
    uncertainty: ControlJsonObject | null;
    claims: readonly ControlJsonValue[];
    citations: readonly ControlJsonValue[];
    limitations: readonly ControlJsonValue[];
    noProductReason: string | null;
    roleSemantics: ControlJsonObject | null;
    body: ControlJsonObject | null;
    submissionDiagnostics: Readonly<{
      parserDisposition: string | null;
      compilerDisposition: string | null;
      failureFactsDigest: Sha256 | null;
      diagnostic: ExecutionReceiptSubmissionDiagnostic | null;
    }>;
  }>;
  candidateTransition: Readonly<{
    role: AttemptRole;
    observationProvenance: "runtime-observed";
    currentProvenance: "runtime-derived";
    input: Readonly<{
      revision: FoundationAttemptViewReference<"candidate-revision">;
      carrierManifestDigest: Sha256;
    }> | null;
    successorDisposition: "promoted" | "not-produced" | "unavailable" | "invalid" | null;
    successor: Readonly<{
      revision: FoundationAttemptViewReference<"candidate-revision">;
      carrierManifestDigest: Sha256;
    }> | null;
    current: Readonly<{
      revision: FoundationAttemptViewReference<"candidate-revision">;
      carrierManifestDigest: Sha256;
    }> | null;
    candidateBaseCommit: string | null;
    contentDisposition: "changed" | "unchanged" | null;
    changedSubjects: readonly ControlJsonValue[];
    invalidatedSeal: FoundationAttemptViewReference<"candidate-seal"> | null;
    invalidatedEvidence: FoundationAttemptViewReference<"evidence-packet"> | null;
    failureFactsDigest: Sha256 | null;
    limitations: readonly ControlJsonValue[];
  }>;
  processAndProof: Readonly<{
    provenance: "runtime-derived";
    standing: DeliveryStanding;
    candidateCondition: DeliveryCandidateCondition;
    proposedBoundary: FoundationAttemptViewReference<"work-boundary"> | null;
    activeBoundary: FoundationAttemptViewReference<"work-boundary"> | null;
    materialCondition: Readonly<{
      reference: FoundationAttemptViewReference<"material-condition">;
      conditionClass: string;
      blocking: boolean;
      limitations: readonly ControlJsonValue[];
    }> | null;
    seal: FoundationAttemptViewReference<"candidate-seal"> | null;
    evidence: Readonly<{
      reference: FoundationAttemptViewReference<"evidence-packet">;
      readiness: string;
      uncertainty: ControlJsonObject;
      propositionDecisions: readonly ControlJsonValue[];
      diagnostics: readonly ControlJsonValue[];
    }> | null;
    checks: readonly FoundationAttemptViewCheck[];
    obligations: readonly FoundationAttemptViewObligation[];
    blockers: readonly string[];
    eligibleOperations: readonly DeliveryOperation[];
  }>;
  diagnostics: readonly FoundationAttemptViewDiagnostic[];
}>;

type AttemptEvents = Readonly<{
  prepared: ControlRecordEvent;
  intended: ControlRecordEvent | null;
  observed: ControlRecordEvent | null;
  submitted: ControlRecordEvent | null;
  abandoned: ControlRecordEvent | null;
  candidate: ControlRecordEvent | null;
  receipt: ControlRecordEvent | null;
}>;

function fail(
  code: "binding" | "stale" | "obligation-missing" | "provenance" |
    "evidence-subject" | "eligibility" | "progress" | "authority" |
    "disclosure" | "incomplete",
  message: string,
): never {
  throw new FoundationError(`lifecycle.attempt-view.${code}`, message);
}

function objectValue(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("binding", `${label} must be one exact typed object`);
  }
  return value as ControlJsonObject;
}

function arrayValue(value: ControlJsonValue | undefined, label: string): readonly ControlJsonValue[] {
  if (!Array.isArray(value)) fail("binding", `${label} must be one exact typed array`);
  return value;
}

function stringValue(value: ControlJsonValue | undefined, label: string): string {
  if (typeof value !== "string") fail("binding", `${label} must be one exact string`);
  return value;
}

function booleanValue(value: ControlJsonValue | undefined, label: string): boolean {
  if (typeof value !== "boolean") fail("binding", `${label} must be one exact boolean`);
  return value;
}

function digestValue(value: ControlJsonValue | undefined, label: string): Sha256 {
  const digest = stringValue(value, label);
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) {
    fail("binding", `${label} must be one exact lowercase SHA-256 digest`);
  }
  return digest as Sha256;
}

function nullableDigest(value: ControlJsonValue | undefined, label: string): Sha256 | null {
  if (value === null) return null;
  return digestValue(value, label);
}

function stringArray(value: ControlJsonValue | undefined, label: string): readonly string[] {
  const values = arrayValue(value, label).map((entry) => stringValue(entry, label));
  if (new Set(values).size !== values.length) fail("binding", `${label} must be unique`);
  return Object.freeze([...values].sort(compareCodePoints));
}

function selectedExecutionLimit(
  value: ControlJsonValue | undefined,
  maximum: number,
  label: string,
): number {
  if (value === null) return maximum;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    fail("binding", `${label} is outside the installed Backend Profile`);
  }
  return value as number;
}

function attemptExecutionSelection(
  attempt: ControlRecordRevision,
): FoundationAttemptViewExecutionSelection {
  const installedProfile = foundationDockerExecutionBackendProfileV1();
  if (installedProfile.profileId !== "lifecycle.execution-backend-profile.docker-local.v1") {
    fail("provenance", "Installed production Backend Profile identity is unsupported");
  }
  const expectedBackendProfile = Object.freeze({
    profileId: "lifecycle.execution-backend-profile.docker-local.v1" as const,
    profileDigest: installedProfile.digest,
    implementationDigest: installedProfile.implementation.implementationDigest,
  });
  const execution = objectValue(attempt.payload.execution, "Agent Attempt execution selection");
  const backendProfile = objectValue(
    execution.backendProfile,
    "Agent Attempt Backend Profile selection",
  );
  const selectedBackendProfile = Object.freeze({
    profileId: stringValue(backendProfile.profileId, "Agent Attempt Backend Profile identity"),
    profileDigest: digestValue(backendProfile.profileDigest, "Agent Attempt Backend Profile digest"),
    implementationDigest: digestValue(
      backendProfile.implementationDigest,
      "Agent Attempt Backend implementation digest",
    ),
  });
  if (canonicalJson(selectedBackendProfile) !== canonicalJson(expectedBackendProfile)) {
    fail("provenance", "Agent Attempt does not select the installed production Backend Profile");
  }
  const image = objectValue(execution.image, "Agent Attempt Execution Image selection");
  const selectedImage = Object.freeze({
    imageId: stringValue(image.imageId, "Agent Attempt Execution Image identity"),
    imageDigest: digestValue(image.imageDigest, "Agent Attempt Execution Image digest"),
  });
  const inputSet = objectValue(execution.inputSet, "Agent Attempt Input Set selection");
  const inputSetProfileId = stringValue(inputSet.profileId, "Agent Attempt Input Set profile");
  if (inputSetProfileId !== "lifecycle.execution-input-set.v1") {
    fail("binding", "Agent Attempt does not select the Foundation Input Set profile");
  }
  const selectedInputSet = Object.freeze({
    profileId: inputSetProfileId,
    digest: digestValue(inputSet.digest, "Agent Attempt Input Set digest"),
  }) as FoundationAttemptViewExecutionSelection["inputSet"];

  const fixedPolicy = compileFoundationInstalledAgentExecutionPolicyV1();
  const selectedPolicy = objectValue(
    attempt.payload.executionPolicy,
    "Agent Attempt execution policy",
  );
  if (canonicalJson(selectedPolicy) !== canonicalJson(fixedPolicy.executionPolicy)) {
    fail("provenance", "Agent Attempt does not bind the installed execution-policy selection");
  }
  const containmentPolicy = fixedPolicy.subjects.find(
    ({ key }) => key === "containmentPolicyDigest",
  );
  if (
    containmentPolicy === undefined ||
    containmentPolicy.value.agentProductNetwork !== "none" ||
    containmentPolicy.value.providerControlPlane !== "fixed-service-channel" ||
    containmentPolicy.value.providerControlSeparation !== "required"
  ) {
    fail("provenance", "Installed execution policy cannot produce the sanitized network view");
  }

  const investment = objectValue(attempt.payload.investment, "Agent Attempt Investment");
  const investmentLimits = objectValue(investment.limits, "Agent Attempt Investment limits");
  const outputBytes = selectedExecutionLimit(
    investmentLimits.outputBytes,
    installedProfile.limits.maximumOutputBytes,
    "Agent output byte limit",
  );
  return Object.freeze({
    backendProfile: expectedBackendProfile,
    image: selectedImage,
    inputSet: selectedInputSet,
    network: Object.freeze({
      agentProductNetwork: "none" as const,
      separationRequired: true as const,
    }),
    services: Object.freeze({
      providerControlPlane: "fixed-service-channel" as const,
    }),
    effectiveLimits: Object.freeze({
      wallTimeMilliseconds: selectedExecutionLimit(
        investment.wallTimeMs,
        installedProfile.limits.maximumWallTimeMilliseconds,
        "Agent wall-time limit",
      ),
      processes: selectedExecutionLimit(
        investmentLimits.processes,
        installedProfile.limits.maximumProcesses,
        "Agent process limit",
      ),
      storageBytes: selectedExecutionLimit(
        investmentLimits.storageBytes,
        installedProfile.limits.maximumStorageBytes,
        "Agent storage limit",
      ),
      outputEntries: installedProfile.limits.maximumOutputEntries,
      outputBytes,
      outputEntryBytes: Math.min(
        outputBytes,
        installedProfile.limits.maximumOutputEntryBytes,
      ),
      events: selectedExecutionLimit(
        investmentLimits.events,
        installedProfile.limits.maximumEvents,
        "Agent event limit",
      ),
    }),
  });
}

function outputManifestView(
  execution: ControlJsonObject,
  label: string,
): FoundationAttemptViewExecutionFacts["outputManifest"] {
  const output = objectValue(execution.output, `${label} output`);
  const availability = stringValue(output.availability, `${label} output availability`);
  if (availability === "retrieved") {
    return Object.freeze({
      availability,
      digest: digestValue(output.manifestDigest, `${label} Output Manifest digest`),
    });
  }
  if (availability === "not-produced" || availability === "unavailable") {
    if (output.manifestDigest !== null) {
      fail("binding", `${label} unavailable output cannot name an Output Manifest`);
    }
    return Object.freeze({ availability, digest: null });
  }
  fail("binding", `${label} has an unsupported output availability`);
}

function agentExecutionFacts(
  receipt: ControlRecordRevision,
  selected: FoundationAttemptViewExecutionSelection,
): FoundationAttemptViewExecutionFacts {
  const execution = objectValue(receipt.payload.execution, "Execution Receipt execution facts");
  const retainedBackendProfile = objectValue(
    execution.backendProfile,
    "Execution Receipt Backend Profile",
  );
  const retainedImage = objectValue(execution.image, "Execution Receipt Image");
  const retainedInputSet = objectValue(execution.inputSet, "Execution Receipt Input Set");
  if (
    canonicalJson(retainedBackendProfile) !== canonicalJson(selected.backendProfile) ||
    canonicalJson(retainedImage) !== canonicalJson(selected.image) ||
    canonicalJson(retainedInputSet) !== canonicalJson(selected.inputSet)
  ) {
    fail("binding", "Execution Receipt does not reproduce the exact Attempt execution selection");
  }
  return Object.freeze({
    ...selected,
    specificationDigest: digestValue(
      execution.specificationDigest,
      "Execution Receipt Specification digest",
    ),
    runnerDigest: digestValue(execution.runnerDigest, "Execution Receipt runner digest"),
    observationDigest: digestValue(
      execution.observationDigest,
      "Execution Receipt observation digest",
    ),
    outputManifest: outputManifestView(execution, "Execution Receipt"),
  });
}

function containedView(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  const retained = objectValue(value, label);
  if (retained.classification !== "contained") {
    fail("binding", `${label} is not contained`);
  }
  return Object.freeze({
    classification: "contained",
    factsDigest: digestValue(retained.factsDigest, `${label} facts digest`),
  });
}

function retiredView(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  const retained = objectValue(value, label);
  if (retained.classification !== "retired") {
    fail("binding", `${label} is not retired`);
  }
  return Object.freeze({
    classification: "retired",
    factsDigest: digestValue(retained.factsDigest, `${label} facts digest`),
  });
}

function checkTerminalView(
  value: ControlJsonValue | undefined,
  label: string,
  complete: "contained" | "retired",
): ControlJsonObject {
  const retained = objectValue(value, label);
  const classification = stringValue(retained.classification, `${label} classification`);
  if (classification === complete) {
    return Object.freeze({
      classification,
      factsDigest: digestValue(retained.factsDigest, `${label} facts digest`),
    });
  }
  if (classification === "not-required" && retained.factsDigest === null) {
    return Object.freeze({ classification, factsDigest: null });
  }
  fail("binding", `${label} has an inconsistent terminal classification`);
}

function checkExecutionView(
  value: ControlJsonValue | undefined,
  label: string,
): ControlJsonObject | null {
  const execution = objectValue(value, label);
  const allocation = stringValue(execution.allocation, `${label} allocation`);
  if (allocation === "not-allocated") return null;
  if (allocation !== "allocated") fail("binding", `${label} has an unsupported allocation state`);
  const backendProfile = objectValue(execution.backendProfile, `${label} Backend Profile`);
  const image = objectValue(execution.image, `${label} Image`);
  const inputSet = objectValue(execution.inputSet, `${label} Input Set`);
  const profileId = stringValue(backendProfile.profileId, `${label} Backend Profile identity`);
  if (
    profileId !== "lifecycle.execution-backend-profile.docker-local.v1" &&
    profileId !== "lifecycle.execution-backend-profile.fault-injection.v1"
  ) {
    fail("binding", `${label} has an unsupported Backend Profile identity`);
  }
  const inputSetProfile = stringValue(inputSet.profileId, `${label} Input Set profile`);
  if (inputSetProfile !== "lifecycle.execution-input-set.v1") {
    fail("binding", `${label} has an unsupported Input Set profile`);
  }
  return Object.freeze({
    backendProfile: Object.freeze({
      profileId,
      profileDigest: digestValue(backendProfile.profileDigest, `${label} Backend Profile digest`),
      implementationDigest: digestValue(
        backendProfile.implementationDigest,
        `${label} Backend implementation digest`,
      ),
    }),
    image: Object.freeze({
      imageId: stringValue(image.imageId, `${label} Image identity`),
      imageDigest: digestValue(image.imageDigest, `${label} Image digest`),
    }),
    specificationDigest: digestValue(
      execution.specificationDigest,
      `${label} Specification digest`,
    ),
    inputSet: Object.freeze({
      profileId: inputSetProfile,
      digest: digestValue(inputSet.digest, `${label} Input Set digest`),
    }),
    runnerDigest: digestValue(execution.runnerDigest, `${label} runner digest`),
    observationDigest: digestValue(
      execution.observationDigest,
      `${label} observation digest`,
    ),
    outputManifest: outputManifestView(execution, label),
  });
}

function reference<Kind extends string>(
  kind: Kind,
  target: Readonly<{ id: string; revision: number; digest: Sha256 }>,
): FoundationAttemptViewReference<Kind> {
  return Object.freeze({ kind, id: target.id, revision: target.revision, digest: target.digest });
}

function revisionReference<Kind extends string>(
  revision: ControlRecordRevision,
  kind: Kind,
): FoundationAttemptViewReference<Kind> {
  if (revision.recordKind !== kind) {
    fail("binding", `Expected ${kind}, received ${revision.recordKind}`);
  }
  return reference(kind, {
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function exactRevision(
  store: ControlRecordStore,
  target: Readonly<{ id: string; revision: number; digest: Sha256 }>,
  kind: string,
): ControlRecordRevision {
  const revision = store.getRevision(target.id, target.revision);
  if (
    revision === null || revision.processId !== store.identity.processId ||
    revision.recordKind !== kind || revision.digest !== target.digest
  ) {
    fail("binding", `Attempt View cannot resolve the exact ${kind} revision`);
  }
  return revision;
}

function exactEventRevision(
  store: ControlRecordStore,
  event: ControlRecordEvent,
  kind: string,
): ControlRecordRevision {
  if (event.subject === null) fail("binding", `${event.eventKind} has no exact record subject`);
  return exactRevision(store, {
    id: event.subject.recordId,
    revision: event.subject.revision,
    digest: event.subject.digest,
  }, kind);
}

function relationship(
  revision: ControlRecordRevision,
  relation: string,
  kind: string,
  required: boolean,
): ControlRecordRelationshipTarget | null {
  const matches = revision.relationships.filter((entry) => entry.relation === relation);
  if (matches.length > 1 || (required && matches.length !== 1)) {
    fail("binding", `${revision.recordKind} ${revision.recordId} has invalid ${relation} cardinality`);
  }
  const target = matches[0]?.target ?? null;
  if (target !== null && target.kind !== kind) {
    fail("binding", `${revision.recordKind} ${revision.recordId} ${relation} does not select ${kind}`);
  }
  return target;
}

function sameTarget(
  left: Readonly<{ id: string; revision: number; digest: Sha256 }> | null,
  right: Readonly<{ id: string; revision: number; digest: Sha256 }> | null,
): boolean {
  return left === null || right === null
    ? left === right
    : left.id === right.id && left.revision === right.revision && left.digest === right.digest;
}

function sameEventSubject(
  event: ControlRecordEvent,
  revision: ControlRecordRevision,
): boolean {
  return event.subject !== null && event.subject.recordId === revision.recordId &&
    event.subject.revision === revision.revision && event.subject.digest === revision.digest;
}

function eventActivityId(event: ControlRecordEvent): string | null {
  const value = event.payload.activityId;
  return typeof value === "string" ? value : null;
}

function oneEvent(
  events: readonly ControlRecordEvent[],
  kind: DeliveryEventKind,
  activityId: string,
): ControlRecordEvent | null {
  const matches = events.filter((event) =>
    event.eventKind === kind && eventActivityId(event) === activityId);
  if (matches.length > 1) fail("binding", `Activity ${activityId} repeats ${kind}`);
  return matches[0] ?? null;
}

function readJournal(store: ControlRecordStore): readonly ControlRecordEvent[] {
  const events: ControlRecordEvent[] = [];
  let after = 0;
  for (;;) {
    const page = store.listEvents(after, 1_000);
    if (page.length === 0) break;
    events.push(...page);
    after = page.at(-1)!.sequence;
    if (events.length > 100_000) fail("incomplete", "Attempt View exceeds the Journal bound");
    if (page.length < 1_000) break;
  }
  return Object.freeze(events);
}

function physicalReduction(
  store: ControlRecordStore,
  physical: DeliveryControlPhysicalDisposition,
  events: readonly ControlRecordEvent[],
): ReducedDeliveryState {
  const replay = reduceDeliveryEvents(events, (subject) =>
    store.getRevision(subject.recordId, subject.revision));
  const retained = store.state();
  if (canonicalJson(replay) !== canonicalJson(retained)) {
    fail("stale", "Retained Delivery replay changed while the Attempt View was compiled");
  }
  const seal = store.getSeal();
  if (physical.disposition === "archived") {
    if (seal === null || physical.archiveManifestDigest === null) {
      fail("binding", "Archived Attempt View requires exact seal and archive facts");
    }
    return composeDeliveryStoreDisposition(replay, "archived-verified");
  }
  if (physical.archiveManifestDigest !== null) {
    fail("binding", "Active Attempt View cannot carry an archive manifest digest");
  }
  return composeDeliveryStoreDisposition(
    replay,
    seal === null ? "active-unsealed" : "sealed-unarchived",
  );
}

function reductionBeforeEvent(
  store: ControlRecordStore,
  events: readonly ControlRecordEvent[],
  event: ControlRecordEvent | null,
): ReducedDeliveryState | null {
  if (event === null) return null;
  return reduceDeliveryEvents(
    events.filter(({ sequence }) => sequence < event.sequence),
    (subject) => store.getRevision(subject.recordId, subject.revision),
  );
}

function selectAttempt(
  store: ControlRecordStore,
  events: readonly ControlRecordEvent[],
  selection: FoundationAttemptViewSelection,
): Readonly<{ revision: ControlRecordRevision; prepared: ControlRecordEvent }> | null {
  const prepared = events.filter(({ eventKind }) => eventKind === "agent-attempt-prepared");
  const selected = selection.kind === "latest-attempt"
    ? prepared.at(-1) ?? null
    : prepared.find((event) => event.subject?.recordId === selection.attemptId) ?? null;
  if (selected === null) {
    if (selection.kind === "latest-attempt") return null;
    fail("binding", `No exact Agent Attempt ${selection.attemptId} exists at this Journal head`);
  }
  const revision = exactEventRevision(store, selected, "agent-attempt");
  if (selection.kind === "attempt" && revision.recordId !== selection.attemptId) {
    fail("binding", "Attempt inspection selected a different retained identity");
  }
  return Object.freeze({ revision, prepared: selected });
}

function attemptEvents(
  events: readonly ControlRecordEvent[],
  prepared: ControlRecordEvent,
): AttemptEvents {
  const activityId = eventActivityId(prepared);
  if (activityId === null) fail("binding", "Prepared Attempt event omits its activity identity");
  return Object.freeze({
    prepared,
    intended: oneEvent(events, "provider-effect-intended", activityId),
    observed: oneEvent(events, "provider-effect-observed", activityId),
    submitted: oneEvent(events, "agent-work-product-submitted", activityId),
    abandoned: oneEvent(events, "agent-work-product-abandoned", activityId),
    candidate: oneEvent(events, "candidate-revision-observed", activityId),
    receipt: oneEvent(events, "execution-receipt-recorded", activityId),
  });
}

function typedRole(value: ControlJsonValue | undefined): AttemptRole {
  const role = stringValue(value, "Agent Attempt role");
  if (!(role in ROLE_OPERATIONS)) fail("binding", `Unsupported Agent Attempt role ${role}`);
  return role as AttemptRole;
}

function typedOperation(value: ControlJsonValue | undefined, role: AttemptRole): DeliveryOperation {
  const operation = stringValue(value, "Agent Attempt operation") as DeliveryOperation;
  if (!DELIVERY_OPERATIONS.includes(operation) ||
      !(ROLE_OPERATIONS[role] as readonly string[]).includes(operation)) {
    fail("binding", `Agent Attempt role ${role} cannot own ${operation}`);
  }
  return operation;
}

function assertAttemptSubjectShape(input: Readonly<{
  operation: DeliveryOperation;
  role: AttemptRole;
  boundary: ControlRecordRelationshipTarget | null;
  candidate: ControlRecordRelationshipTarget | null;
  seal: ControlRecordRelationshipTarget | null;
}>): void {
  if (input.operation === "delivery.prepare") {
    if (input.boundary !== null || input.candidate !== null || input.seal !== null) {
      fail("binding", "Fresh preparation cannot bind a Boundary, Candidate, or Seal");
    }
    return;
  }
  if (input.boundary === null || input.candidate === null) {
    fail("binding", "Every admitted Agent Attempt requires its exact Boundary and Candidate");
  }
  if ((input.role === "reviewer") !== (input.seal !== null)) {
    fail("binding", "Only review requires one exact Candidate Seal");
  }
}

function eventEffectDigest(event: ControlRecordEvent | null): Sha256 | null {
  return event === null ? null : digestValue(event.payload.effectDigest, `${event.eventKind} effect`);
}

function receiptRelationship(
  revision: ControlRecordRevision,
  relation: string,
  kind: string,
): ControlRecordRelationshipTarget | null {
  return relationship(revision, relation, kind, relation === "observes-attempt");
}

function candidateViewBinding(
  revision: ControlRecordRevision,
): NonNullable<FoundationAttemptView["candidateTransition"]["input"]> {
  if (
    revision.recordKind !== "candidate-revision" ||
    revision.payload.schema !== "lifecycle.candidate-revision-payload.v2"
  ) {
    fail("binding", "Attempt View Candidate binding requires one Candidate Revision v2");
  }
  const carrier = objectValue(
    revision.payload.carrierManifest,
    "Candidate Revision Carrier manifest",
  );
  return Object.freeze({
    revision: revisionReference(revision, "candidate-revision"),
    carrierManifestDigest: digestValue(
      carrier.digest,
      "Candidate Revision Carrier manifest digest",
    ),
  });
}

function candidateView(input: Readonly<{
  store: ControlRecordStore;
  role: AttemptRole;
  attemptCandidate: ControlRecordRelationshipTarget | null;
  event: ControlRecordEvent | null;
  receipt: ControlRecordRevision | null;
  current: ReducedDeliveryState["subjects"]["candidate"];
  invalidatedSeal: ReducedDeliveryState["subjects"]["seal"];
  invalidatedEvidence: ReducedDeliveryState["subjects"]["evidence"];
}>): FoundationAttemptView["candidateTransition"] {
  if (input.role !== "builder" && input.event !== null) {
    fail("binding", "Only a builder Attempt can create a Candidate successor");
  }
  const successorTarget = input.event === null
    ? null
    : revisionReference(
        exactEventRevision(input.store, input.event, "candidate-revision"),
        "candidate-revision",
      );
  const receiptSuccessor = input.receipt === null
    ? null
    : receiptRelationship(input.receipt, "observes-candidate", "candidate-revision");
  if (input.receipt !== null && !sameTarget(successorTarget, receiptSuccessor)) {
    fail("binding", "Execution Receipt does not bind the exact Candidate successor observation");
  }
  const inputCandidate = input.attemptCandidate === null
    ? null
    : exactRevision(input.store, input.attemptCandidate, "candidate-revision");
  const successor = successorTarget === null
    ? null
    : exactRevision(input.store, successorTarget, "candidate-revision");
  if (input.role === "builder" && successor !== null) {
    const predecessor = relationship(successor, "revises", "candidate-revision", true)!;
    if (!sameTarget(predecessor, input.attemptCandidate)) {
      fail("binding", "Builder Candidate successor does not revise the exact input Candidate");
    }
  }
  const expectedInput = inputCandidate === null ? null : candidateViewBinding(inputCandidate);
  const expectedSuccessor = successor === null ? null : candidateViewBinding(successor);
  const receiptCandidate = input.receipt === null
    ? null
    : objectValue(input.receipt.payload.candidate, "Execution Receipt Candidate transition");
  let successorDisposition:
    "promoted" | "not-produced" | "unavailable" | "invalid" | null = null;
  let contentDisposition: "changed" | "unchanged" | null = null;
  if (receiptCandidate !== null) {
    const candidateInput = receiptCandidate.input === null
      ? null
      : objectValue(receiptCandidate.input, "Execution Receipt Candidate input");
    if (canonicalJson(candidateInput) !== canonicalJson(expectedInput)) {
      fail("binding", "Execution Receipt Candidate input differs from the exact Attempt input");
    }
    if (receiptCandidate.successorDisposition !== null) {
      const disposition = stringValue(
        receiptCandidate.successorDisposition,
        "Execution Receipt Candidate successor disposition",
      );
      if (!( ["promoted", "not-produced", "unavailable", "invalid"] as const)
        .includes(disposition as NonNullable<typeof successorDisposition>)) {
        fail("binding", "Execution Receipt Candidate successor disposition is unsupported");
      }
      successorDisposition = disposition as NonNullable<typeof successorDisposition>;
    }
    const receiptSuccessorBinding = receiptCandidate.successor === null
      ? null
      : objectValue(receiptCandidate.successor, "Execution Receipt Candidate successor");
    if (canonicalJson(receiptSuccessorBinding) !== canonicalJson(expectedSuccessor)) {
      fail("binding", "Execution Receipt Candidate successor differs from its exact observation");
    }
    if (receiptCandidate.contentDisposition !== null) {
      const disposition = stringValue(
        receiptCandidate.contentDisposition,
        "Execution Receipt Candidate content disposition",
      );
      if (disposition !== "changed" && disposition !== "unchanged") {
        fail("binding", "Execution Receipt Candidate content disposition is unsupported");
      }
      contentDisposition = disposition;
    }
  }
  if (input.role !== "builder" && successorDisposition !== null) {
    fail("binding", "Only a builder Attempt can retain a Candidate successor disposition");
  }
  if (input.role === "builder" && input.receipt !== null && successorDisposition === null) {
    fail("binding", "A completed builder Receipt requires one Candidate successor disposition");
  }
  if (
    input.receipt !== null &&
    (successorDisposition === "promoted") !== (successor !== null)
  ) {
    fail("binding", "Only a promoted Candidate disposition can bind one successor Revision");
  }
  const visibleSuccessor = successorDisposition === "promoted" ? successor : null;
  const successorState = visibleSuccessor === null
    ? null
    : objectValue(visibleSuccessor.payload.state, "Candidate successor state");
  const expectedContentDisposition = successorState === null
    ? null
    : booleanValue(
        successorState.unchangedFromPredecessor,
        "Candidate successor predecessor equality",
      )
      ? "unchanged" as const
      : "changed" as const;
  if (contentDisposition !== expectedContentDisposition) {
    fail("binding", "Execution Receipt content disposition differs from the exact successor state");
  }
  const current = input.current === null
    ? null
    : exactRevision(input.store, input.current, "candidate-revision");
  return Object.freeze({
    role: input.role,
    observationProvenance: "runtime-observed",
    currentProvenance: "runtime-derived",
    input: expectedInput,
    successorDisposition,
    successor: successorDisposition === "promoted" ? expectedSuccessor : null,
    current: current === null ? null : candidateViewBinding(current),
    candidateBaseCommit: inputCandidate === null
      ? null
      : stringValue(inputCandidate.payload.candidateBaseCommit, "Candidate immutable base"),
    contentDisposition,
    changedSubjects: successorState === null
      ? Object.freeze([])
      : arrayValue(successorState.changedSubjects, "Candidate changed subjects"),
    invalidatedSeal: visibleSuccessor === null || input.invalidatedSeal === null
      ? null
      : reference("candidate-seal", input.invalidatedSeal),
    invalidatedEvidence: visibleSuccessor === null || input.invalidatedEvidence === null
      ? null
      : reference("evidence-packet", input.invalidatedEvidence),
    failureFactsDigest: null,
    limitations: visibleSuccessor === null
      ? Object.freeze([])
      : arrayValue(visibleSuccessor.payload.limitations, "Candidate limitations"),
  });
}

function currentRevision<Kind extends string>(
  store: ControlRecordStore,
  kind: Kind,
  value: Readonly<{ id: string; revision: number; digest: Sha256 }> | null,
): ControlRecordRevision | null {
  return value === null ? null : exactRevision(store, value, kind);
}

function allFinalizedRevisions(
  store: ControlRecordStore,
  events: readonly ControlRecordEvent[],
  eventKind: DeliveryEventKind,
  recordKind: string,
): readonly ControlRecordRevision[] {
  return Object.freeze(events
    .filter((event) => event.eventKind === eventKind)
    .map((event) => exactEventRevision(store, event, recordKind)));
}

function receiptForSubject(
  revision: ControlRecordRevision,
  relation: "checks-boundary" | "checks-seal",
  target: ControlRecordRelationshipTarget,
): boolean {
  const selected = relationship(
    revision,
    relation,
    relation === "checks-boundary" ? "work-boundary" : "candidate-seal",
    false,
  );
  return sameTarget(selected, target);
}

function oneCheckReceipt(
  receipts: readonly ControlRecordRevision[],
  selectionId: string,
  phase: "baseline" | "final",
): ControlRecordRevision | null {
  const matches = receipts.filter((revision) =>
    revision.payload.selectionId === selectionId && revision.payload.phase === phase);
  if (matches.length > 1) {
    fail("evidence-subject", `Check ${selectionId} has more than one ${phase} Receipt at the exact subject`);
  }
  return matches[0] ?? null;
}

function projectedCheckReceipt(
  revision: ControlRecordRevision | null,
  selection: ControlJsonObject,
  phase: "baseline" | "final",
  proofSubject:
    | FoundationAttemptViewReference<"work-boundary">
    | FoundationAttemptViewReference<"candidate-seal">,
): FoundationAttemptViewCheckReceipt | null {
  if (revision === null) return null;
  const selectionId = stringValue(selection.id, "Work Boundary Check identity");
  const definition = objectValue(selection.definition, `Check ${selectionId} definition`);
  const binding = objectValue(revision.payload.binding, `Check ${selectionId} Receipt Binding`);
  const allowedBindings = arrayValue(selection.bindings, `Check ${selectionId} Bindings`)
    .map((value) => objectValue(value, `Check ${selectionId} Binding`));
  if (
    revision.payload.selectionId !== selectionId || revision.payload.phase !== phase ||
    revision.payload.modality !== selection.modality ||
    canonicalJson(revision.payload.definition) !== canonicalJson(definition) ||
    !allowedBindings.some((value) => canonicalJson(value) === canonicalJson(binding))
  ) {
    fail("evidence-subject", `Check ${selectionId} ${phase} Receipt differs from its exact selection`);
  }
  const reasonCode = revision.payload.reasonCode;
  if (reasonCode !== null && typeof reasonCode !== "string") {
    fail("evidence-subject", `Check ${selectionId} ${phase} Receipt has an invalid reason code`);
  }
  return Object.freeze({
    reference: revisionReference(revision, "check-receipt"),
    provenance: "runtime-observed",
    binding,
    proofSubject,
    proofRequestDigest: digestValue(
      revision.payload.proofRequestDigest,
      `Check ${selectionId} proof request`,
    ),
    environment: objectValue(revision.payload.environment, `Check ${selectionId} environment`),
    disposition: stringValue(revision.payload.disposition, "Check disposition"),
    resultFacts: arrayValue(revision.payload.resultFacts, `Check ${selectionId} result facts`),
    reasonCode,
    execution: checkExecutionView(revision.payload.execution, `Check ${selectionId} execution`),
    subjectIntegrity: stringValue(
      revision.payload.subjectIntegrity,
      `Check ${selectionId} subject integrity`,
    ),
    containment: checkTerminalView(
      revision.payload.containment,
      `Check ${selectionId} containment`,
      "contained",
    ),
    retirement: checkTerminalView(
      revision.payload.retirement,
      `Check ${selectionId} retirement`,
      "retired",
    ),
    limitations: arrayValue(revision.payload.limitations, "Check limitations"),
  });
}

function checkDispositionIncomplete(disposition: string): boolean {
  return ["indeterminate", "not-run", "unsupported", "operational-error"].includes(disposition);
}

function checkViews(input: Readonly<{
  boundary: ControlRecordRevision | null;
  seal: ControlRecordRevision | null;
  receipts: readonly ControlRecordRevision[];
}>): readonly FoundationAttemptViewCheck[] {
  if (input.boundary === null) return Object.freeze([]);
  const mandate = objectValue(input.boundary.payload.mandate, "Work Boundary mandate");
  const selections = arrayValue(mandate.checks, "Work Boundary Checks");
  const boundaryTarget = revisionReference(input.boundary, "work-boundary");
  const sealTarget = input.seal === null ? null : revisionReference(input.seal, "candidate-seal");
  const baselineReceipts = input.receipts.filter((receipt) =>
    receiptForSubject(receipt, "checks-boundary", boundaryTarget));
  const finalReceipts = sealTarget === null
    ? Object.freeze([] as ControlRecordRevision[])
    : input.receipts.filter((receipt) => receiptForSubject(receipt, "checks-seal", sealTarget));
  const views = selections.map((value) => {
    const selection = objectValue(value, "Work Boundary Check selection");
    const selectionId = stringValue(selection.id, "Work Boundary Check identity");
    const definition = objectValue(selection.definition, `Check ${selectionId} definition`);
    const baselineRequired = booleanValue(selection.baselineRequired, `Check ${selectionId} baseline requirement`);
    const finalRequired = booleanValue(selection.finalRequired, `Check ${selectionId} final requirement`);
    const baseline = oneCheckReceipt(baselineReceipts, selectionId, "baseline");
    const final = oneCheckReceipt(finalReceipts, selectionId, "final");
    const bindingIds = stringArray(
      Object.freeze(arrayValue(selection.bindings, `Check ${selectionId} Bindings`)
        .map((value) => stringValue(
          objectValue(value, `Check ${selectionId} Binding`).id,
          `Check ${selectionId} Binding identity`,
        ))),
      `Check ${selectionId} Binding identities`,
    );
    const projectedFinal = sealTarget === null
      ? null
      : projectedCheckReceipt(final, selection, "final", sealTarget);
    return Object.freeze({
      selectionId,
      definitionId: stringValue(definition.id, `Check ${selectionId} Definition identity`),
      definition,
      bindingIds,
      modality: stringValue(selection.modality, `Check ${selectionId} modality`),
      obligationIds: stringArray(selection.obligationIds, `Check ${selectionId} obligation identities`),
      baselineRequired,
      finalRequired,
      baseline: projectedCheckReceipt(baseline, selection, "baseline", boundaryTarget),
      final: projectedFinal,
      freshExecutionRequired: finalRequired &&
        (projectedFinal === null || projectedFinal.disposition !== "pass"),
    });
  });
  return Object.freeze([...views].sort((left, right) =>
    compareCodePoints(left.selectionId, right.selectionId)));
}

function relatedClaimIds(input: Readonly<{
  claims: readonly ControlJsonValue[];
  sourceIds: readonly string[];
  artifactIds: readonly string[];
  artifactPaths: readonly string[];
}>): readonly string[] {
  const sourceIds = new Set(input.sourceIds);
  const artifactIds = new Set(input.artifactIds);
  const artifactPaths = new Set(input.artifactPaths);
  const related: string[] = [];
  for (const value of input.claims) {
    const claim = objectValue(value, "Agent Work Product Claim");
    const sharedSource = stringArray(claim.knowledgeIds, "Claim Knowledge identities")
      .some((id) => sourceIds.has(id));
    const sharedEvidence = stringArray(claim.evidenceIds, "Claim Evidence identities")
      .some((id) => artifactIds.has(id));
    const sharedPath = stringArray(claim.paths, "Claim paths")
      .some((path) => artifactPaths.has(path));
    if (sharedSource || sharedEvidence || sharedPath) {
      related.push(stringValue(claim.id, "Agent Claim identity"));
    }
  }
  return Object.freeze([...new Set(related)].sort(compareCodePoints));
}

function evidenceObligationMap(evidence: ControlRecordRevision | null): ReadonlyMap<string, ControlJsonObject> {
  if (evidence === null) return new Map();
  const result = new Map<string, ControlJsonObject>();
  for (const value of arrayValue(evidence.payload.obligations, "Evidence obligation ledger")) {
    const entry = objectValue(value, "Evidence obligation entry");
    const id = stringValue(entry.obligationId, "Evidence obligation identity");
    if (result.has(id)) fail("obligation-missing", `Evidence repeats obligation ${id}`);
    result.set(id, entry);
  }
  return result;
}

function evidenceArtifactState(
  evidence: ControlRecordRevision | null,
  obligationId: string,
): "absent" | "present-uninspected" | null {
  if (evidence === null) return null;
  for (const value of arrayValue(evidence.payload.artifacts, "Evidence artifact ledger")) {
    const artifact = objectValue(value, "Evidence artifact entry");
    if (!stringArray(artifact.obligationIds, "Evidence artifact obligations").includes(obligationId)) continue;
    if (artifact.existence === "absent") return "absent";
    if (artifact.existence === "present" &&
        (artifact.schemaValidation === "indeterminate" || artifact.semanticValidation === "indeterminate")) {
      return "present-uninspected";
    }
  }
  return null;
}

function standingFromChecks(input: Readonly<{
  checks: readonly FoundationAttemptViewCheck[];
  seal: ControlRecordRevision | null;
}>): FoundationAttemptViewObligationStanding {
  if (input.checks.length === 0) return "not-evaluated";
  const final = input.checks.filter(({ finalRequired }) => finalRequired);
  if (input.seal !== null && final.length > 0) {
    if (final.some(({ final: receipt }) => receipt?.disposition === "fail")) return "check-failed";
    if (final.some(({ final: receipt }) => receipt !== null && checkDispositionIncomplete(receipt.disposition))) {
      return "check-incomplete";
    }
    if (final.some(({ final: receipt }) => receipt === null)) return "check-not-run";
    if (final.every(({ final: receipt }) => receipt?.disposition === "pass")) return "review-pending";
  }
  const baseline = input.checks.filter(({ baselineRequired }) => baselineRequired);
  if (baseline.some(({ baseline: receipt }) => receipt?.disposition === "fail")) return "check-failed";
  if (baseline.some(({ baseline: receipt }) => receipt !== null && checkDispositionIncomplete(receipt.disposition))) {
    return "check-incomplete";
  }
  if (baseline.some(({ baseline: receipt }) => receipt === null)) return "check-not-run";
  if (baseline.length > 0) return "satisfied-for-current-phase";
  return "not-evaluated";
}

function evidenceStanding(
  state: string,
): FoundationAttemptViewObligationStanding {
  switch (state) {
    case "satisfied": return "review-accepted";
    case "failed": return "review-rejected";
    case "not-applicable": return "inapplicable-by-boundary";
    case "missing": return "artifact-absent";
    case "indeterminate":
    case "stale":
    case "unsupported": return "check-incomplete";
    default: fail("obligation-missing", `Evidence obligation has unsupported state ${state}`);
  }
}

function establishmentRoute(
  standing: FoundationAttemptViewObligationStanding,
): FoundationAttemptViewObligation["establishmentRoute"] {
  switch (standing) {
    case "material-condition": return "resolve-boundary";
    case "artifact-absent": return "develop-or-evaluate";
    case "artifact-present-uninspected": return "inspect-artifact";
    case "check-not-run":
    case "check-failed":
    case "check-incomplete": return "run-or-correct-check";
    case "review-pending": return "complete-independent-review";
    case "review-rejected": return "correct-reviewed-result";
    case "not-evaluated":
    case "conflict": return "develop-or-evaluate";
    case "check-passed":
    case "review-accepted":
    case "satisfied-for-current-phase":
    case "inapplicable-by-boundary": return "none";
  }
}

function conditionFalsifiers(
  store: ControlRecordStore,
  material: ControlRecordRevision | null,
): ReadonlySet<string> {
  if (material === null) return new Set();
  const source = objectValue(material.payload.source, "Material Condition source");
  if (source.kind !== "agent-proposal") {
    fail("binding", "Material Condition has an unsupported source kind");
  }
  const workProductTarget = relationship(material, "reported-by", "agent-work-product", true)!;
  const workProduct = exactRevision(store, workProductTarget, "agent-work-product");
  const roleSemantics = objectValue(workProduct.payload.roleSemantics, "Material Condition source semantics");
  const values = arrayValue(roleSemantics.conditions, "Material Condition source proposals");
  const sourceConditionId = stringValue(source.conditionId, "Material Condition source identity");
  const proposal = values
    .map((value) => objectValue(value, "Material Condition proposal"))
    .find((value) => value.id === sourceConditionId);
  if (proposal === undefined) fail("binding", "Material Condition source proposal is unavailable");
  return new Set(stringArray(proposal.falsifiedMandateIds, "Material Condition falsified mandate identities"));
}

function obligationViews(input: Readonly<{
  store: ControlRecordStore;
  boundary: ControlRecordRevision | null;
  material: ControlRecordRevision | null;
  seal: ControlRecordRevision | null;
  evidence: ControlRecordRevision | null;
  checks: readonly FoundationAttemptViewCheck[];
  claims: readonly ControlJsonValue[];
}>): readonly FoundationAttemptViewObligation[] {
  if (input.boundary === null) return Object.freeze([]);
  const mandate = objectValue(input.boundary.payload.mandate, "Work Boundary mandate");
  const obligations = arrayValue(mandate.obligations, "Work Boundary obligations");
  const artifacts = arrayValue(mandate.artifacts, "Work Boundary artifacts")
    .map((value) => objectValue(value, "Work Boundary artifact"));
  const evidence = evidenceObligationMap(input.evidence);
  if (input.evidence !== null && evidence.size !== obligations.length) {
    fail("obligation-missing", "Evidence does not cover every active Work Boundary obligation");
  }
  const falsifiers = conditionFalsifiers(input.store, input.material);
  const views = obligations.map((value) => {
    const obligation = objectValue(value, "Work Boundary obligation");
    const id = stringValue(obligation.id, "Work Boundary obligation identity");
    const sourceIds = stringArray(obligation.sourceIds, `Obligation ${id} sources`);
    const artifactIds = stringArray(
      obligation.requiredEvidenceArtifactIds,
      `Obligation ${id} artifacts`,
    );
    const propositionIds = stringArray(obligation.propositionIds, `Obligation ${id} propositions`);
    const obligationArtifacts = artifacts.filter((artifact) =>
      stringArray(artifact.obligationIds, "Artifact obligation identities").includes(id));
    const artifactPaths = obligationArtifacts.map((artifact) =>
      stringValue(artifact.path, "Boundary artifact path"));
    const checks = input.checks.filter(({ obligationIds }) => obligationIds.includes(id));
    const evidenceEntry = evidence.get(id) ?? null;
    if (input.evidence !== null && evidenceEntry === null) {
      fail("obligation-missing", `Evidence omits active obligation ${id}`);
    }
    const artifactState = evidenceArtifactState(input.evidence, id);
    let standing = evidenceEntry === null
      ? standingFromChecks({ checks, seal: input.seal })
      : evidenceStanding(stringValue(evidenceEntry.state, `Evidence obligation ${id} state`));
    if (artifactState === "absent") standing = "artifact-absent";
    else if (artifactState === "present-uninspected") standing = "artifact-present-uninspected";
    if (falsifiers.has(id)) standing = "material-condition";
    const severity = stringValue(obligation.severity, `Obligation ${id} severity`);
    const blocking = severity === "required" &&
      !["review-accepted", "satisfied-for-current-phase", "inapplicable-by-boundary"]
        .includes(standing);
    return Object.freeze({
      id,
      kind: stringValue(obligation.kind, `Obligation ${id} kind`),
      statement: stringValue(obligation.statement, `Obligation ${id} statement`),
      severity,
      sourceIds,
      artifactIds,
      propositionIds,
      checkSelectionIds: Object.freeze(checks.map(({ selectionId }) => selectionId).sort(compareCodePoints)),
      relatedAgentClaimIds: relatedClaimIds({
        claims: input.claims,
        sourceIds,
        artifactIds,
        artifactPaths,
      }),
      standing,
      blocking,
      establishmentRoute: establishmentRoute(standing),
    });
  });
  return Object.freeze([...views].sort((left, right) => compareCodePoints(left.id, right.id)));
}

function currentMaterial(
  revision: ControlRecordRevision | null,
): FoundationAttemptView["processAndProof"]["materialCondition"] {
  if (revision === null) return null;
  return Object.freeze({
    reference: revisionReference(revision, "material-condition"),
    conditionClass: stringValue(revision.payload.conditionClass, "Material Condition class"),
    blocking: booleanValue(revision.payload.blocking, "Material Condition blocking fact"),
    limitations: arrayValue(revision.payload.limitations, "Material Condition limitations"),
  });
}

function currentEvidence(
  revision: ControlRecordRevision | null,
): FoundationAttemptView["processAndProof"]["evidence"] {
  if (revision === null) return null;
  return Object.freeze({
    reference: revisionReference(revision, "evidence-packet"),
    readiness: stringValue(revision.payload.readiness, "Evidence readiness"),
    uncertainty: objectValue(revision.payload.uncertainty, "Evidence uncertainty"),
    propositionDecisions: arrayValue(
      revision.payload.propositionDecisions,
      "Evidence proposition decisions",
    ),
    diagnostics: arrayValue(revision.payload.diagnostics, "Evidence diagnostics"),
  });
}

function incompleteDiagnostic(
  activityId: string,
  missing: readonly string[],
): FoundationAttemptViewDiagnostic {
  return Object.freeze({
    code: "lifecycle.attempt-view.incomplete",
    stage: "attempt-view-v1",
    factsDigest: digestCanonical(Object.freeze({
      schema: "lifecycle.attempt-view-incomplete-facts.v1",
      activityId,
      missing: Object.freeze([...missing].sort(compareCodePoints)),
    })),
  });
}

function providerExecution(input: Readonly<{
  store: ControlRecordStore;
  events: AttemptEvents;
  attempt: ControlRecordRevision;
  activityId: string;
  workProduct: ControlRecordRevision | null;
  candidate: ControlRecordRevision | null;
  role: AttemptRole;
  selectedExecution: FoundationAttemptViewExecutionSelection;
}>): Readonly<{
  view: FoundationAttemptView["providerExecution"];
  receipt: ControlRecordRevision | null;
}> {
  const intendedDigest = eventEffectDigest(input.events.intended);
  const observedDigest = eventEffectDigest(input.events.observed);
  if (observedDigest !== null && intendedDigest !== observedDigest) {
    fail("binding", "Provider observation does not bind the exact intended effect");
  }
  const observedOutcome = input.events.observed === null
    ? null
    : stringValue(input.events.observed.payload.outcome, "Provider effect outcome") as
      "completed" | "failed" | "not-started";
  if (observedOutcome !== null && !["completed", "failed", "not-started"].includes(observedOutcome)) {
    fail("binding", "Provider effect has an unsupported outcome");
  }
  const receipt = input.events.receipt === null
    ? null
    : exactEventRevision(input.store, input.events.receipt, "execution-receipt");
  if (receipt !== null) {
    const observesAttempt = receiptRelationship(receipt, "observes-attempt", "agent-attempt");
    if (!sameTarget(observesAttempt, revisionReference(input.attempt, "agent-attempt"))) {
      fail("binding", "Execution Receipt does not observe the selected Agent Attempt");
    }
    const observesWorkProduct = receiptRelationship(
      receipt,
      "observes-work-product",
      "agent-work-product",
    );
    const selectedWorkProduct = input.workProduct === null
      ? null
      : revisionReference(input.workProduct, "agent-work-product");
    if (!sameTarget(observesWorkProduct, selectedWorkProduct)) {
      fail("binding", "Execution Receipt does not bind the exact Work Product disposition");
    }
    if (stringValue(receipt.payload.activityId, "Execution Receipt activity") !== input.activityId) {
      fail("binding", "Execution Receipt belongs to another Delivery activity");
    }
    const providerEffect = objectValue(receipt.payload.providerEffect, "Execution Receipt provider effect");
    if (
      observedDigest === null ||
      digestValue(providerEffect.effectDigest, "Execution Receipt effect digest") !== observedDigest ||
      stringValue(providerEffect.outcome, "Execution Receipt effect outcome") !== observedOutcome
    ) {
      fail("binding", "Execution Receipt does not reproduce the exact provider observation");
    }
  }
  return Object.freeze({
    receipt,
    view: Object.freeze({
      provenance: "runtime-observed",
      receipt: receipt === null ? null : revisionReference(receipt, "execution-receipt"),
      effect: Object.freeze({
        intended: input.events.intended !== null,
        observed: input.events.observed !== null,
        digest: observedDigest ?? intendedDigest,
        outcome: observedOutcome,
      }),
      productiveExecutionStarted: receipt === null
        ? null
        : booleanValue(receipt.payload.productiveExecutionStarted, "Productive execution fact"),
      provider: receipt === null
        ? null
        : objectValue(receipt.payload.provider, "Execution provider observation"),
      execution: receipt === null
        ? null
        : agentExecutionFacts(receipt, input.selectedExecution),
      containment: receipt === null
        ? null
        : containedView(receipt.payload.containment, "Execution containment"),
      retirement: receipt === null
        ? null
        : retiredView(receipt.payload.retirement, "Execution retirement"),
    }),
  });
}

function agentSemantics(
  workProduct: ControlRecordRevision | null,
  receipt: ControlRecordRevision | null,
): FoundationAttemptView["agentSemantics"] {
  const workspace = receipt === null
    ? null
    : objectValue(receipt.payload.workspace, "Execution Receipt workspace");
  return Object.freeze({
    workProduct: workProduct === null
      ? null
      : revisionReference(workProduct, "agent-work-product"),
    provenance: "agent-proposed",
    disposition: workProduct === null
      ? null
      : stringValue(workProduct.payload.disposition, "Agent semantic disposition"),
    summary: workProduct === null
      ? null
      : objectValue(workProduct.payload.summary, "Agent semantic summary"),
    uncertainty: workProduct === null
      ? null
      : objectValue(workProduct.payload.uncertainty, "Agent semantic uncertainty"),
    claims: workProduct === null
      ? Object.freeze([])
      : arrayValue(workProduct.payload.claims, "Agent semantic Claims"),
    citations: workProduct === null
      ? Object.freeze([])
      : arrayValue(workProduct.payload.citations, "Agent semantic Citations"),
    limitations: workProduct === null
      ? Object.freeze([])
      : arrayValue(workProduct.payload.limitations, "Agent semantic Limitations"),
    noProductReason: workProduct === null || workProduct.payload.noProductReason === null
      ? null
      : stringValue(workProduct.payload.noProductReason, "Agent no-product reason"),
    roleSemantics: workProduct === null
      ? null
      : objectValue(workProduct.payload.roleSemantics, "Agent role semantics"),
    body: workProduct === null
      ? null
      : objectValue(workProduct.payload.body, "Agent semantic body binding"),
    submissionDiagnostics: Object.freeze({
      parserDisposition: workspace === null
        ? null
        : stringValue(workspace.parserDisposition, "Parser disposition"),
      compilerDisposition: workspace === null
        ? null
        : stringValue(workspace.compilerDisposition, "Compiler disposition"),
      failureFactsDigest: workspace === null
        ? null
        : nullableDigest(workspace.failureFactsDigest, "Submission failure facts"),
      diagnostic: receipt === null
        ? null
        : executionReceiptSubmissionDiagnostic(receipt),
    }),
  });
}

/**
 * Compile one disposable Attempt View from an exact Agent Attempt and one
 * coherent validated Journal head. The function performs no Store mutation.
 */
export function compileFoundationAttemptView(input: Readonly<{
  store: ControlRecordStore;
  physical: DeliveryControlPhysicalDisposition;
  selection: FoundationAttemptViewSelection;
}>): FoundationAttemptView | null {
  const events = readJournal(input.store);
  const before = physicalReduction(input.store, input.physical, events);
  if (
    before.journal.eventCount !== events.length ||
    before.journal.eventCount === 0 ||
    before.journal.headDigest !== events.at(-1)?.digest
  ) {
    fail("stale", "Attempt View Journal coordinate is incomplete or stale");
  }
  const selected = selectAttempt(input.store, events, input.selection);
  if (selected === null) return null;
  const activityEvents = attemptEvents(events, selected.prepared);
  const activityId = stringValue(selected.revision.payload.activityId, "Agent Attempt activity");
  if (eventActivityId(selected.prepared) !== activityId) {
    fail("binding", "Agent Attempt revision and prepared event name different activities");
  }
  const role = typedRole(selected.revision.payload.role);
  const operation = typedOperation(selected.revision.payload.operation, role);
  const selectedExecution = attemptExecutionSelection(selected.revision);
  const activity = before.activities.find(({ id }) => id === activityId);
  if (activity === undefined || activity.operation !== operation || activity.family !== "agent") {
    fail("binding", "Agent Attempt does not join its exact reducer activity");
  }
  const briefTarget = relationship(selected.revision, "uses-brief", "founder-brief", true)!;
  exactRevision(input.store, briefTarget, "founder-brief");
  const boundaryTarget = relationship(selected.revision, "uses-boundary", "work-boundary", false);
  const candidateTarget = relationship(selected.revision, "uses-candidate", "candidate-revision", false);
  const sealTarget = relationship(selected.revision, "uses-seal", "candidate-seal", false);
  assertAttemptSubjectShape({
    operation,
    role,
    boundary: boundaryTarget,
    candidate: candidateTarget,
    seal: sealTarget,
  });
  if (boundaryTarget !== null) exactRevision(input.store, boundaryTarget, "work-boundary");
  if (candidateTarget !== null) exactRevision(input.store, candidateTarget, "candidate-revision");
  if (sealTarget !== null) exactRevision(input.store, sealTarget, "candidate-seal");

  if (activityEvents.submitted !== null && activityEvents.abandoned !== null) {
    fail("binding", "Agent Attempt cannot both submit and abandon its Work Product");
  }
  if (activityEvents.intended !== null &&
      !sameEventSubject(activityEvents.intended, selected.revision)) {
    fail("binding", "Provider effect intent does not bind the selected Agent Attempt");
  }
  if (activityEvents.observed !== null &&
      !sameEventSubject(activityEvents.observed, selected.revision)) {
    fail("binding", "Provider effect observation does not bind the selected Agent Attempt");
  }
  if (activityEvents.abandoned !== null &&
      !sameEventSubject(activityEvents.abandoned, selected.revision)) {
    fail("binding", "Work Product abandonment does not bind the selected Agent Attempt");
  }
  const workProduct = activityEvents.submitted === null
    ? null
    : exactEventRevision(input.store, activityEvents.submitted, "agent-work-product");
  if (workProduct !== null) {
    if (workProduct.semanticAuthority !== "agent-proposed") {
      fail("provenance", "Agent Work Product is not represented as agent-proposed semantics");
    }
    const resultOf = relationship(workProduct, "result-of", "agent-attempt", true)!;
    if (!sameTarget(resultOf, revisionReference(selected.revision, "agent-attempt"))) {
      fail("binding", "Agent Work Product does not result from the selected Attempt");
    }
    if (stringValue(workProduct.payload.role, "Agent Work Product role") !== role) {
      fail("binding", "Agent Work Product role differs from the selected Attempt");
    }
  }
  const observedCandidate = activityEvents.candidate === null
    ? role === "reviewer" && candidateTarget !== null
      ? exactRevision(input.store, candidateTarget, "candidate-revision")
      : null
    : exactEventRevision(input.store, activityEvents.candidate, "candidate-revision");
  const execution = providerExecution({
    store: input.store,
    events: activityEvents,
    attempt: selected.revision,
    activityId,
    workProduct,
    candidate: observedCandidate,
    role,
    selectedExecution,
  });
  const semantics = agentSemantics(workProduct, execution.receipt);
  const beforeCandidateObservation = role === "builder"
    ? reductionBeforeEvent(input.store, events, activityEvents.candidate)
    : null;
  const candidate = candidateView({
    store: input.store,
    role,
    attemptCandidate: candidateTarget,
    event: activityEvents.candidate,
    receipt: execution.receipt,
    current: before.subjects.candidate,
    invalidatedSeal: beforeCandidateObservation?.subjects.seal ?? null,
    invalidatedEvidence: beforeCandidateObservation?.subjects.evidence ?? null,
  });

  const boundarySubject = before.subjects.activeBoundary ?? before.subjects.proposedBoundary;
  const boundary = currentRevision(input.store, "work-boundary", boundarySubject);
  const material = currentRevision(input.store, "material-condition", before.subjects.materialCondition);
  const seal = currentRevision(input.store, "candidate-seal", before.subjects.seal);
  const evidence = currentRevision(input.store, "evidence-packet", before.subjects.evidence);
  const receipts = allFinalizedRevisions(
    input.store,
    events,
    "check-receipt-recorded",
    "check-receipt",
  );
  const checks = checkViews({ boundary, seal, receipts });
  const obligations = obligationViews({
    store: input.store,
    boundary,
    material,
    seal,
    evidence,
    checks,
    claims: semantics.claims,
  });
  const active = before.activities.filter(({ stage }) => stage !== "completed");
  if (active.length > 1) fail("binding", "Attempt View found more than one active Delivery activity");
  const activeActivity = active[0] ?? null;
  if (before.eligibleOperations.some((operationValue) =>
    !DELIVERY_OPERATIONS.includes(operationValue))) {
    fail("eligibility", "Attempt View contains an operation outside the installed reducer registry");
  }
  const missing: string[] = [];
  if (activityEvents.intended === null) missing.push("provider-effect-intent");
  if (activityEvents.observed === null) missing.push("provider-effect-observation");
  if (activityEvents.submitted === null && activityEvents.abandoned === null) {
    missing.push("work-product-disposition");
  }
  if (
    role === "builder" && execution.receipt === null &&
    activityEvents.candidate === null
  ) {
    missing.push("candidate-observation");
  }
  if (execution.receipt === null) missing.push("execution-receipt");
  const diagnostics = missing.length === 0
    ? Object.freeze([])
    : Object.freeze([incompleteDiagnostic(activityId, missing)]);
  const blockers = Object.freeze(obligations
    .filter(({ blocking }) => blocking)
    .map(({ id }) => id)
    .sort(compareCodePoints));

  const result: FoundationAttemptView = Object.freeze({
    schema: FOUNDATION_ATTEMPT_VIEW_SCHEMA,
    complete: diagnostics.length === 0,
    coordinate: Object.freeze({
      storeId: input.store.identity.storeId,
      processId: input.store.identity.processId,
      journal: Object.freeze({
        headSequence: events.at(-1)!.sequence,
        headDigest: events.at(-1)!.digest,
      }),
      attempt: revisionReference(selected.revision, "agent-attempt"),
      reducer: REDUCER_PROFILE,
      profile: VIEW_PROFILE,
      currentBoundary: boundary === null
        ? null
        : revisionReference(boundary, "work-boundary"),
      currentCandidate: before.subjects.candidate === null
        ? null
        : reference("candidate-revision", before.subjects.candidate),
      activeActivity: activeActivity === null
        ? null
        : Object.freeze({
            id: activeActivity.id,
            operation: activeActivity.operation,
            stage: activeActivity.stage,
            recovery: activeActivity.recovery === null
              ? null
              : Object.freeze({ ...activeActivity.recovery }),
          }),
    }),
    attemptContract: Object.freeze({
      provenance: "runtime-derived",
      activityId,
      operation,
      role,
      invocationId: stringValue(selected.revision.payload.invocationId, "Agent invocation identity"),
      preDispatchStateDigest: digestValue(
        selected.revision.payload.preDispatchStateDigest,
        "Agent pre-dispatch state digest",
      ),
      brief: reference("founder-brief", briefTarget),
      boundary: boundaryTarget === null ? null : reference("work-boundary", boundaryTarget),
      candidate: candidateTarget === null ? null : reference("candidate-revision", candidateTarget),
      seal: sealTarget === null ? null : reference("candidate-seal", sealTarget),
      projection: objectValue(selected.revision.payload.projection, "Agent Projection binding"),
      capability: objectValue(selected.revision.payload.capability, "Agent capability binding"),
      investment: objectValue(selected.revision.payload.investment, "Agent Investment"),
      provider: objectValue(selected.revision.payload.provider, "Agent provider binding"),
      authoring: objectValue(selected.revision.payload.authoring, "Agent authoring contract"),
      input: objectValue(selected.revision.payload.input, "Agent input binding"),
      execution: selectedExecution,
    }),
    providerExecution: execution.view,
    agentSemantics: semantics,
    candidateTransition: candidate,
    processAndProof: Object.freeze({
      provenance: "runtime-derived",
      standing: before.standing,
      candidateCondition: before.candidateCondition,
      proposedBoundary: before.subjects.proposedBoundary === null
        ? null
        : reference("work-boundary", before.subjects.proposedBoundary),
      activeBoundary: before.subjects.activeBoundary === null
        ? null
        : reference("work-boundary", before.subjects.activeBoundary),
      materialCondition: currentMaterial(material),
      seal: seal === null ? null : revisionReference(seal, "candidate-seal"),
      evidence: currentEvidence(evidence),
      checks,
      obligations,
      blockers,
      eligibleOperations: Object.freeze([...before.eligibleOperations]),
    }),
    diagnostics,
  });

  const afterEvents = readJournal(input.store);
  const after = physicalReduction(input.store, input.physical, afterEvents);
  if (
    canonicalJson(before) !== canonicalJson(after) ||
    events.length !== afterEvents.length ||
    events.at(-1)?.digest !== afterEvents.at(-1)?.digest
  ) {
    fail("stale", "Control Store changed before Attempt View compilation completed");
  }
  return result;
}
