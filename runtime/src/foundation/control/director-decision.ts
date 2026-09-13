import { FoundationSemanticMarkdownSchema } from "@neutral/lifecycle-protocol";
import { FoundationError } from "../error.js";
import type { ReducedDeliveryState } from "../process/delivery-reducer.js";
import { reduceDeliveryEvents } from "../process/delivery-reducer.js";
import { verifyFoundationSubject } from "../repository/authority.js";
import type { FoundationRepositoryContract, FoundationRepositorySnapshot } from "../repository/types.js";
import {
  canonicalJson,
  digestCanonical,
  sha256Bytes,
  type Sha256,
} from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import { assertFoundationSchema } from "../validation/schema-engine.js";
import { compileDeliveryActivityStartAppend } from "./activity.js";
import { verifyRetainedAcceptanceV7 } from "./evidence-packet.js";
import { resolveCandidateIntegrationProvenanceV1 } from "./integration-assessment.js";
import { assertDeliveryControlRecordPolicy } from "./kind-registry.js";
import {
  compileControlRecordRevision,
  controlIdentifier,
  controlTimestamp,
  normalizeSemanticMarkdown,
} from "./model.js";
import { assertDeliveryControlRecordPayload } from "./payload-registry.js";
import type { ControlRecordStore } from "./store.js";
import type {
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordEvent,
  ControlRecordRevision,
  ControlRecordRevisionInput,
  ControlRecordStoreAppend,
} from "./types.js";

const DIRECTOR_DECISION_PAYLOAD_SCHEMA_ID =
  "urn:lifecycle:schema:director-decision-payload:v5" as const;

export const DIRECTOR_DECISION_OPERATIONS = Object.freeze([
  "delivery.admit",
  "delivery.accept",
  "delivery.no-ship",
] as const);

export type DirectorDecisionOperation = typeof DIRECTOR_DECISION_OPERATIONS[number];
export type DirectorDecisionKind = "admit" | "readmit" | "accept" | "no-ship";

export type DirectorDecisionCoordinates = Readonly<{
  qualification: "lifecycle.foundation.1.0.0-rc.17";
  repository: "lifecycle.repository.v22";
  provider: "lifecycle.provider-adapter.v7";
  authoritySubject: "lifecycle.director-decision-subject.v4";
  transactionRules: "lifecycle.delivery-transaction-rules.v1";
}>;

export type DirectorDecisionRepositoryBasis = Readonly<{
  repositorySnapshotDigest: Sha256;
  canonicalCommit: string;
  canonicalTree: string;
  productStateDigest: Sha256;
  atlasStateDigest: Sha256;
  atlasResolutionDigest: Sha256;
  atlasNormalizedModelDigest: Sha256;
  atlasResourceBindingsDigest: Sha256;
  repositoryContractDigest: Sha256;
  knowledgeSetDigest: Sha256;
  checkBindingSetDigest: Sha256;
}>;

export type DirectorDecisionControlBinding = Readonly<{
  relation:
    | "selects-boundary"
    | "selects-baseline-receipt"
    | "continues-from-boundary"
    | "resolves"
    | "selects-candidate"
    | "selects-seal"
    | "selects-evidence";
  target: Readonly<{
    kind:
      | "work-boundary"
      | "check-receipt"
      | "material-condition"
      | "candidate-revision"
      | "candidate-seal"
      | "evidence-packet";
    id: string;
    revision: number;
    digest: Sha256;
  }>;
}>;

export type DirectorDecisionSubject = Readonly<{
  schema: "lifecycle.director-decision-subject.v4";
  targetId: string;
  storeId: string;
  processId: string;
  activityId: string;
  operation: DirectorDecisionOperation;
  decisionId: string;
  decision: DirectorDecisionKind;
  decisionSemanticDigest: Sha256;
  journalHead: Readonly<{ sequence: number; digest: Sha256 }>;
  reducerFactsDigest: Sha256;
  repository: DirectorDecisionRepositoryBasis;
  selectedControl: readonly DirectorDecisionControlBinding[];
  coordinates: DirectorDecisionCoordinates;
  principalId: string;
  keyId: string;
  algorithm: "ed25519";
  authorizedAt: string;
  expiresAt: string | null;
  nonce: string;
  candidateDisposition: "not-applicable" | "no-candidate" | "abandon";
}>;

/**
 * Deterministic, non-authorizing review of the exact consequence that a later
 * Director Decision subject can authenticate. Operation-instance identity,
 * authentication time, expiry, and nonce deliberately remain outside this
 * value and therefore outside its digest.
 */
export type AuthorizationReviewCore = Readonly<{
  schema: "lifecycle.authorization-review.v1";
  targetId: string;
  storeId: string;
  processId: string;
  operation: DirectorDecisionOperation;
  decision: DirectorDecisionKind;
  consequence: string;
  semanticMarkdown: string;
  semanticDigest: Sha256;
  journalHead: Readonly<{ sequence: number; digest: Sha256 }>;
  reducerFactsDigest: Sha256;
  repository: DirectorDecisionRepositoryBasis;
  selectedControl: readonly DirectorDecisionControlBinding[];
  coordinates: DirectorDecisionCoordinates;
  authority: Readonly<{
    principalId: string;
    keyId: string;
    algorithm: "ed25519";
  }>;
  candidateDisposition: DirectorDecisionSubject["candidateDisposition"];
  authorizationReviewDigest: Sha256;
}>;

/**
 * Invocation-private gate run over the exact non-authorizing review immediately
 * before the Director secret may authenticate it. Public review compilation does
 * not use this seam.
 */
export type AuthorizationReviewGate = (
  review: AuthorizationReviewCore,
) => void | Promise<void>;

export type DirectorDecisionAcceptanceBasis = ReturnType<typeof verifyRetainedAcceptanceV7>;

export type CompiledDirectorDecisionOpening = Readonly<{
  /** Invocation-local semantic justification; never retained or serialized as authority. */
  acceptanceBasis: DirectorDecisionAcceptanceBasis | null;
  revision: ControlRecordRevision;
  revisionInput: ControlRecordRevisionInput;
  authorizationReview: AuthorizationReviewCore;
  subject: DirectorDecisionSubject;
  activityAppend: ControlRecordStoreAppend;
  decisionAppend: ControlRecordStoreAppend;
}>;

type StateReference = NonNullable<ReducedDeliveryState["subjects"]["candidate"]>;

type Selection = Readonly<{
  decision: DirectorDecisionKind;
  relationships: readonly DirectorDecisionControlBinding[];
  candidateDisposition: DirectorDecisionSubject["candidateDisposition"];
}>;

const DIGEST = /^sha256:[a-f0-9]{64}$/u;

const DIRECTOR_DECISION_COORDINATES: DirectorDecisionCoordinates = Object.freeze({
  qualification: "lifecycle.foundation.1.0.0-rc.17",
  repository: "lifecycle.repository.v22",
  provider: "lifecycle.provider-adapter.v7",
  authoritySubject: "lifecycle.director-decision-subject.v4",
  transactionRules: "lifecycle.delivery-transaction-rules.v1",
});

const DIRECTOR_DECISION_CONSEQUENCES: Readonly<Record<DirectorDecisionKind, string>> =
  Object.freeze({
    admit: "Establish the selected Work Boundary as the active mandate for this Delivery.",
    readmit:
      "Replace the active Work Boundary with the selected successor and continue the exact retained Candidate.",
    accept:
      "Apply the selected sealed and evidenced Candidate to canonical Product State and close the Delivery.",
    "no-ship": "Close the Delivery without changing canonical Product State.",
  });

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.control-director-decision.${code}`, message);
}

function object(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
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
  if (!DIGEST.test(selected)) fail("retained-fact", `${label} must be one lowercase SHA-256 digest`);
  return selected as Sha256;
}

function exactOperation(value: string): DirectorDecisionOperation {
  if (!DIRECTOR_DECISION_OPERATIONS.includes(value as DirectorDecisionOperation)) {
    fail("operation", "Director Decision requires one exact authority-bearing Delivery operation");
  }
  return value as DirectorDecisionOperation;
}

function semanticMarkdown(value: string): Readonly<{ markdown: string; digest: Sha256 }> {
  const parsed = FoundationSemanticMarkdownSchema.safeParse(value);
  if (!parsed.success) {
    fail("semantic-markdown", "Director Decision semantics must be exact body-only public Markdown");
  }
  const markdown = normalizeSemanticMarkdown(parsed.data);
  return Object.freeze({ markdown, digest: sha256Bytes(markdown) });
}

function allEvents(store: ControlRecordStore): readonly ControlRecordEvent[] {
  const events: ControlRecordEvent[] = [];
  let cursor = 0;
  for (;;) {
    const page = store.listEvents(cursor, 10_000);
    events.push(...page);
    if (page.length < 10_000) return Object.freeze(events);
    cursor = page.at(-1)!.sequence;
    if (events.length > 100_000) fail("journal", "Director Decision Journal lookup exceeds its fixed bound");
  }
}

function exactRevision(
  store: ControlRecordStore,
  selected: StateReference,
  kind: DirectorDecisionControlBinding["target"]["kind"],
  label: string,
): ControlRecordRevision {
  const revision = store.getRevision(selected.id, selected.revision);
  if (revision === null || revision.recordKind !== kind || revision.digest !== selected.digest) {
    fail("selected-control", `${label} does not resolve to one exact retained ${kind} revision`);
  }
  assertDeliveryControlRecordPayload(revision);
  return revision;
}

function target(revision: ControlRecordRevision): DirectorDecisionControlBinding["target"] {
  return Object.freeze({
    kind: revision.recordKind as DirectorDecisionControlBinding["target"]["kind"],
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function binding(
  relation: DirectorDecisionControlBinding["relation"],
  revision: ControlRecordRevision,
): DirectorDecisionControlBinding {
  return Object.freeze({ relation, target: target(revision) });
}

function bindingOrder(
  left: DirectorDecisionControlBinding,
  right: DirectorDecisionControlBinding,
): number {
  return compareCodePoints(
    `${left.relation}\u0000${left.target.kind}\u0000${left.target.id}\u0000${left.target.revision}\u0000${left.target.digest}`,
    `${right.relation}\u0000${right.target.kind}\u0000${right.target.id}\u0000${right.target.revision}\u0000${right.target.digest}`,
  );
}

function canonicalBindings(
  values: readonly DirectorDecisionControlBinding[],
): readonly DirectorDecisionControlBinding[] {
  const sorted = [...values].sort(bindingOrder).map((value) => Object.freeze({
    relation: value.relation,
    target: Object.freeze({ ...value.target }),
  }));
  for (let index = 1; index < sorted.length; index += 1) {
    if (bindingOrder(sorted[index - 1]!, sorted[index]!) === 0) {
      fail("selected-control", "Director Decision selected Control bindings must be unique");
    }
  }
  return Object.freeze(sorted);
}

function sameReference(
  left: Readonly<{ id: string; revision: number; digest: Sha256 }>,
  right: StateReference,
): boolean {
  return left.id === right.id && left.revision === right.revision && left.digest === right.digest;
}

function exactRelationship(
  revision: ControlRecordRevision,
  relation: string,
  kind: string,
  expected: StateReference,
  label: string,
): void {
  const matches = revision.relationships.filter((value) => value.relation === relation);
  if (
    matches.length !== 1 || matches[0]!.target.kind !== kind ||
    !sameReference(matches[0]!.target, expected)
  ) {
    fail("boundary-succession", `${label} must bind one exact ${relation} ${kind}`);
  }
}

function legalBaselineReceipt(modality: string, disposition: string): boolean {
  switch (modality) {
    case "precondition":
    case "regression-guard":
      return disposition === "pass";
    case "repair-target":
      return disposition === "pass" || disposition === "fail";
    case "postcondition":
      return disposition === "not-run";
    case "diagnostic":
      return [
        "pass", "fail", "indeterminate", "not-run", "unsupported", "operational-error",
      ].includes(disposition);
    default:
      return false;
  }
}

function baselineReceipts(
  store: ControlRecordStore,
  events: readonly ControlRecordEvent[],
  boundary: ControlRecordRevision,
): readonly ControlRecordRevision[] {
  const boundaryEvents = events.filter((event) =>
    event.eventKind === "work-boundary-finalized" && event.subject !== null &&
    event.subject.recordId === boundary.recordId && event.subject.revision === boundary.revision &&
    event.subject.digest === boundary.digest);
  if (boundaryEvents.length !== 1) {
    fail("baseline", "Director admission requires one exact Work Boundary finalization event");
  }
  const activityId = string(boundaryEvents[0]!.payload.activityId, "Work Boundary activity identity");
  const mandate = object(boundary.payload.mandate, "Work Boundary mandate");
  const expected = new Map<string, string>();
  for (const value of array(mandate.checks, "Work Boundary Check selections")) {
    const check = object(value, "Work Boundary Check selection");
    const selectionId = controlIdentifier(
      string(check.id, "Work Boundary Check selection identity"),
      "Work Boundary Check selection identity",
    );
    if (expected.has(selectionId)) fail("baseline", "Work Boundary repeats a Check selection identity");
    if (boolean(check.baselineRequired, "Work Boundary baseline requirement")) {
      expected.set(selectionId, string(check.modality, "Work Boundary Check modality"));
    }
  }
  if (expected.size === 0) fail("baseline", "Director admission requires at least one baseline Check Receipt");

  const receipts: ControlRecordRevision[] = [];
  const received = new Set<string>();
  for (const event of events) {
    if (event.eventKind !== "check-receipt-recorded" || event.payload.activityId !== activityId) continue;
    if (event.subject === null) fail("baseline", "Baseline Check Receipt event omits its exact subject");
    const receipt = store.getRevision(event.subject.recordId, event.subject.revision);
    if (receipt === null || receipt.recordKind !== "check-receipt" || receipt.digest !== event.subject.digest) {
      fail("baseline", "Baseline Check Receipt does not resolve exactly");
    }
    assertDeliveryControlRecordPayload(receipt);
    const selectionId = controlIdentifier(
      string(receipt.payload.selectionId, "Check Receipt selection identity"),
      "Check Receipt selection identity",
    );
    const modality = string(receipt.payload.modality, "Check Receipt modality");
    const disposition = string(receipt.payload.disposition, "Check Receipt disposition");
    const checksBoundary = receipt.relationships.filter((value) =>
      value.relation === "checks-boundary" && value.target.kind === "work-boundary");
    if (
      receipt.payload.phase !== "baseline" || received.has(selectionId) ||
      expected.get(selectionId) !== modality || !legalBaselineReceipt(modality, disposition) ||
      checksBoundary.length !== 1 || !sameReference(checksBoundary[0]!.target, {
        id: boundary.recordId,
        revision: boundary.revision,
        digest: boundary.digest,
      })
    ) {
      fail("baseline", "Director admission requires every-and-only complete legal baseline Check Receipts");
    }
    received.add(selectionId);
    receipts.push(receipt);
  }
  if (receipts.length !== expected.size || [...expected].some(([selectionId]) => !received.has(selectionId))) {
    fail("baseline", "Director admission baseline Check Receipt set is incomplete");
  }
  return Object.freeze(receipts.sort((left, right) => compareCodePoints(
    `${left.recordId}\u0000${left.revision}\u0000${left.digest}`,
    `${right.recordId}\u0000${right.revision}\u0000${right.digest}`,
  )));
}

function currentEstablishedBoundary(
  store: ControlRecordStore,
  state: ReducedDeliveryState,
  events: readonly ControlRecordEvent[],
): ControlRecordRevision | null {
  const current = state.subjects.activeBoundary ?? state.subjects.proposedBoundary;
  if (current !== null) return exactRevision(store, current, "work-boundary", "Current Work Boundary");
  const finalized = [...events].reverse().find((event) => event.eventKind === "work-boundary-finalized");
  if (finalized === undefined) return null;
  if (finalized.subject === null) fail("selected-control", "Finalized Work Boundary event omits its subject");
  return exactRevision(store, {
    id: finalized.subject.recordId,
    revision: finalized.subject.revision,
    digest: finalized.subject.digest,
  }, "work-boundary", "Latest finalized Work Boundary");
}

function selectionFor(
  store: ControlRecordStore,
  state: ReducedDeliveryState,
  events: readonly ControlRecordEvent[],
  operation: DirectorDecisionOperation,
): Selection {
  let decision: DirectorDecisionKind;
  if (operation === "delivery.admit") {
    decision = state.standing === "awaiting-admission"
      ? "admit"
      : state.standing === "awaiting-readmission"
        ? "readmit"
        : fail("standing", "Admission authentication requires one admission-ready Delivery");
  } else if (operation === "delivery.accept") {
    if (state.standing !== "decision-ready") {
      fail("standing", "Acceptance authentication requires one decision-ready Delivery");
    }
    decision = "accept";
  } else {
    if (state.standing === "closed") fail("standing", "A closed Delivery cannot be no-shipped again");
    decision = "no-ship";
  }

  const relationships: DirectorDecisionControlBinding[] = [];
  if (decision === "admit" || decision === "readmit") {
    const proposed = state.subjects.proposedBoundary;
    if (proposed === null) fail("boundary", "Admission has no exact proposed Work Boundary");
    const boundary = exactRevision(store, proposed, "work-boundary", "Proposed Work Boundary");
    relationships.push(binding("selects-boundary", boundary));
    relationships.push(...baselineReceipts(store, events, boundary).map((receipt) =>
      binding("selects-baseline-receipt", receipt)));
    if (decision === "readmit") {
      const active = state.subjects.activeBoundary;
      const condition = state.subjects.materialCondition;
      const candidate = state.subjects.candidate;
      if (active === null || condition === null || candidate === null) {
        fail("readmission", "Readmission requires predecessor Boundary, Material Condition, and continuing Candidate");
      }
      const predecessor = exactRevision(store, active, "work-boundary", "Active predecessor Work Boundary");
      const retainedCondition = exactRevision(store, condition, "material-condition", "Material Condition");
      const retainedCandidate = exactRevision(store, candidate, "candidate-revision", "Continuing Candidate Revision");
      if (boundary.recordId !== predecessor.recordId || boundary.revision !== predecessor.revision + 1) {
        fail("boundary-succession", "Readmission successor must advance the exact active Boundary by one revision");
      }
      exactRelationship(boundary, "revises", "work-boundary", active, "Readmission successor");
      exactRelationship(boundary, "resolves", "material-condition", condition, "Readmission successor");
      const integration = resolveCandidateIntegrationProvenanceV1({ store, candidate: retainedCandidate });
      const applicationBase = integration?.canonicalParent.commit ??
        object(predecessor.payload.basis, "Predecessor Work Boundary basis").productBaseCommit;
      if (retainedCandidate.payload.schema !== "lifecycle.candidate-revision-payload.v3" ||
        retainedCandidate.payload.candidateBaseCommit !== applicationBase) {
        fail("candidate", "Readmission requires the exact continuing Candidate on its retained application base");
      }
      exactRelationship(retainedCandidate, "governed-by", "work-boundary", active, "Continuing Candidate");
      relationships.push(
        binding("continues-from-boundary", predecessor),
        binding("resolves", retainedCondition),
        binding("selects-candidate", retainedCandidate),
      );
    }
  } else if (decision === "accept") {
    const active = state.subjects.activeBoundary;
    const candidate = state.subjects.candidate;
    const seal = state.subjects.seal;
    const evidence = state.subjects.evidence;
    if (active === null || candidate === null || seal === null || evidence === null) {
      fail("subject", "Acceptance requires Boundary, Candidate, Seal, and Evidence");
    }
    relationships.push(
      binding("selects-boundary", exactRevision(store, active, "work-boundary", "Active Work Boundary")),
      binding("selects-candidate", exactRevision(store, candidate, "candidate-revision", "Candidate Revision")),
      binding("selects-seal", exactRevision(store, seal, "candidate-seal", "Candidate Seal")),
      binding("selects-evidence", exactRevision(store, evidence, "evidence-packet", "Evidence Packet")),
    );
  } else {
    const boundary = currentEstablishedBoundary(store, state, events);
    if (boundary !== null) relationships.push(binding("selects-boundary", boundary));
    if (state.subjects.materialCondition !== null) {
      relationships.push(binding("resolves", exactRevision(
        store, state.subjects.materialCondition, "material-condition", "Material Condition",
      )));
    }
    if (state.subjects.candidate !== null) {
      relationships.push(binding("selects-candidate", exactRevision(
        store, state.subjects.candidate, "candidate-revision", "Candidate Revision",
      )));
    }
  }

  return Object.freeze({
    decision,
    relationships: canonicalBindings(relationships),
    candidateDisposition: decision !== "no-ship"
      ? "not-applicable"
      : state.subjects.candidate === null ? "no-candidate" : "abandon",
  });
}

function assertRepositoryMatchesBoundary(
  selected: Selection,
  store: ControlRecordStore,
  repository: DirectorDecisionRepositoryBasis,
): void {
  const selectedBoundary = selected.relationships.find(({ relation }) => relation === "selects-boundary");
  if (selectedBoundary === undefined) {
    if (selected.decision === "admit" || selected.decision === "readmit") {
      fail("boundary", "Admission selection omits the proposed Boundary");
    }
    return;
  }
  const boundary = exactRevision(store, selectedBoundary.target, "work-boundary", "Proposed Work Boundary");
  const basis = object(boundary.payload.basis, "Work Boundary basis");
  if (
    boundary.payload.targetId !== store.identity.targetId ||
    basis.specificationRevision !== "lifecycle.foundation.1.0.0-rc.17" ||
    basis.repositoryContract !== "lifecycle.repository.v22" ||
    basis.providerAdapter !== "lifecycle.provider-adapter.v7"
  ) {
    fail("boundary", "Director Decision selected Boundary does not retain the exact target and Foundation coordinates");
  }
  // Acceptance selects the integrated Candidate's parent P. W retains its own
  // governing B; the pure verifier joins that mandate to exact integration.
  if (selected.decision === "accept") return;
  if (
    basis.atlasStateDigest !== repository.atlasStateDigest ||
    basis.atlasResolutionDigest !== repository.atlasResolutionDigest ||
    basis.atlasNormalizedModelDigest !== repository.atlasNormalizedModelDigest ||
    basis.atlasResourceBindingsDigest !== repository.atlasResourceBindingsDigest
  ) {
    throw new FoundationError("lifecycle.control-director-decision.atlas-basis-mismatch", "Director Decision historical repository basis does not reproduce the selected Work Boundary Atlas basis", {
      observedFacts: {
        boundaryStateDigest: basis.atlasStateDigest,
        observedStateDigest: repository.atlasStateDigest,
        boundaryResolutionDigest: basis.atlasResolutionDigest,
        observedResolutionDigest: repository.atlasResolutionDigest,
        boundaryNormalizedModelDigest: basis.atlasNormalizedModelDigest,
        observedNormalizedModelDigest: repository.atlasNormalizedModelDigest,
        boundaryResourceBindingsDigest: basis.atlasResourceBindingsDigest,
        observedResourceBindingsDigest: repository.atlasResourceBindingsDigest,
      },
    });
  }
  if (
    basis.repositorySnapshotDigest !== repository.repositorySnapshotDigest ||
    basis.productBaseCommit !== repository.canonicalCommit ||
    basis.productBaseTree !== repository.canonicalTree ||
    basis.productStateDigest !== repository.productStateDigest ||
    basis.repositoryContractDigest !== repository.repositoryContractDigest ||
    basis.knowledgeSetDigest !== repository.knowledgeSetDigest
  ) {
    fail("repository", "Director Decision repository and selected Work Boundary do not share one exact basis");
  }
}

/** Project a retained exact parent Snapshot into the authenticated repository role. */
export function directorDecisionRepositoryBasisFromSnapshot(
  snapshot: FoundationRepositorySnapshot,
  contract: FoundationRepositoryContract,
): DirectorDecisionRepositoryBasis {
  if (snapshot.targetId !== contract.targetId || snapshot.contractDigest !== contract.digest) {
    fail("repository", "Integration parent Snapshot and authority contract differ");
  }
  return Object.freeze({
    repositorySnapshotDigest: snapshot.digest,
    canonicalCommit: snapshot.commit,
    canonicalTree: snapshot.tree,
    productStateDigest: snapshot.productStateDigest,
    atlasStateDigest: snapshot.atlasStateDigest,
    atlasResolutionDigest: snapshot.atlasResolutionDigest,
    atlasNormalizedModelDigest: snapshot.atlasNormalizedModelDigest,
    atlasResourceBindingsDigest: snapshot.atlasResourceBindingsDigest,
    repositoryContractDigest: snapshot.contractDigest,
    knowledgeSetDigest: snapshot.knowledgeSetDigest,
    checkBindingSetDigest: digestCanonical(contract.checkBindings),
  });
}

function historicalTerminalRepositoryBasis(
  selection: Selection,
  store: ControlRecordStore,
  repository: DirectorDecisionRepositoryBasis,
  contract: FoundationRepositoryContract,
): DirectorDecisionRepositoryBasis {
  if (!(selection.decision === "accept" || selection.decision === "no-ship")) {
    return Object.freeze({ ...repository });
  }
  if (selection.decision === "accept") {
    const selected = selection.relationships.find(({ relation }) => relation === "selects-candidate");
    if (selected === undefined) fail("candidate", "Acceptance requires its exact integrated Candidate");
    const candidate = exactRevision(store, selected.target, "candidate-revision", "Integrated Candidate");
    const integration = resolveCandidateIntegrationProvenanceV1({ store, candidate });
    if (integration === null) fail("integration", "Acceptance requires explicit integration provenance, including when its parent equals the admitted base");
    return directorDecisionRepositoryBasisFromSnapshot(integration.canonicalParent, contract);
  }
  const selectedBoundary = selection.relationships.find(({ relation }) =>
    relation === "selects-boundary");
  if (selectedBoundary === undefined) {
    return Object.freeze({ ...repository });
  }
  const boundary = exactRevision(
    store,
    selectedBoundary.target,
    "work-boundary",
    "Terminal Work Boundary",
  );
  const basis = object(boundary.payload.basis, "Terminal Work Boundary basis");
  return Object.freeze({
    repositorySnapshotDigest: digest(
      basis.repositorySnapshotDigest,
      "No-ship historical repository Snapshot digest",
    ),
    canonicalCommit: string(
      basis.productBaseCommit,
      "No-ship historical canonical commit",
    ),
    canonicalTree: string(
      basis.productBaseTree,
      "No-ship historical canonical tree",
    ),
    productStateDigest: digest(
      basis.productStateDigest,
      "No-ship historical Product State digest",
    ),
    atlasStateDigest: digest(
      basis.atlasStateDigest,
      "No-ship historical Atlas State digest",
    ),
    atlasResolutionDigest: digest(
      basis.atlasResolutionDigest,
      "No-ship historical Atlas Resolution digest",
    ),
    atlasNormalizedModelDigest: digest(
      basis.atlasNormalizedModelDigest,
      "No-ship historical Atlas normalized-model digest",
    ),
    atlasResourceBindingsDigest: digest(
      basis.atlasResourceBindingsDigest,
      "No-ship historical Atlas Resource bindings digest",
    ),
    repositoryContractDigest: digest(
      basis.repositoryContractDigest,
      "No-ship historical repository contract digest",
    ),
    knowledgeSetDigest: digest(
      basis.knowledgeSetDigest,
      "No-ship historical Knowledge Set digest",
    ),
    checkBindingSetDigest: digestCanonical(contract.checkBindings),
  });
}

function identities(
  store: ControlRecordStore,
  activityId: string,
): Readonly<{ recordId: string; eventId: string }> {
  const suffix = digestCanonical({
    recordKind: "director-decision",
    storeId: store.identity.storeId,
    processId: store.identity.processId,
    activityId,
  }).slice("sha256:".length);
  return Object.freeze({
    recordId: `director-decision-${suffix}`,
    eventId: `event-director-decision-authenticated-${suffix}`,
  });
}

function exactTimes(input: Readonly<{
  priorOccurredAt: string;
  startedAt: string;
  authorizedAt: string;
  expiresAt: string | null;
  verifiedAt: string;
}>): Readonly<{
  startedAt: string;
  authorizedAt: string;
  expiresAt: string | null;
  verifiedAt: string;
}> {
  const priorOccurredAt = controlTimestamp(input.priorOccurredAt, "Director Decision Journal-head time");
  const startedAt = controlTimestamp(input.startedAt, "Transaction activity start time");
  const authorizedAt = controlTimestamp(input.authorizedAt, "Director authorization time");
  const expiresAt = input.expiresAt === null
    ? null
    : controlTimestamp(input.expiresAt, "Director authorization expiry");
  const verifiedAt = controlTimestamp(input.verifiedAt, "Director signature verification time");
  if (
    Date.parse(startedAt) < Date.parse(priorOccurredAt) ||
    Date.parse(authorizedAt) < Date.parse(startedAt) ||
    Date.parse(verifiedAt) < Date.parse(authorizedAt)
  ) {
    fail("authorization-time", "Director Decision opening times must follow the exact Journal-head basis");
  }
  if (expiresAt !== null && (
    Date.parse(expiresAt) <= Date.parse(authorizedAt) ||
    Date.parse(verifiedAt) > Date.parse(expiresAt)
  )) {
    fail("expiry", "Director authority must expire after authorization and remain current through verification");
  }
  return Object.freeze({ startedAt, authorizedAt, expiresAt, verifiedAt });
}

type AuthorizationReviewInput = Readonly<{
  store: ControlRecordStore;
  operation: DirectorDecisionOperation;
  semanticMarkdown: string;
  repository: DirectorDecisionRepositoryBasis;
  contract: FoundationRepositoryContract;
}>;

function assertReviewRepository(
  input: Pick<AuthorizationReviewInput, "store" | "repository" | "contract">,
): void {
  if (
    input.contract.targetId !== input.store.identity.targetId ||
    input.repository.repositoryContractDigest !== input.contract.digest
  ) {
    fail("repository", "Director Decision repository and trust root do not match the exact Store target");
  }
}

function verifyAcceptanceForState(input: Readonly<{
  store: ControlRecordStore;
  state: ReducedDeliveryState;
  parentCommit: string;
  directorDecisionSubject?: DirectorDecisionSubject;
}>): DirectorDecisionAcceptanceBasis {
  const evidence = input.state.subjects.evidence;
  if (evidence === null) fail("subject", "Acceptance requires one exact Evidence Packet");
  return verifyRetainedAcceptanceV7({
    store: input.store,
    packet: exactRevision(input.store, evidence, "evidence-packet", "Evidence Packet"),
    current: {
      boundary: input.state.subjects.activeBoundary,
      candidate: input.state.subjects.candidate,
      seal: input.state.subjects.seal,
      evidence,
      materialCondition: input.state.subjects.materialCondition,
    },
    parentCommit: input.parentCommit,
    ...(input.directorDecisionSubject === undefined ? {} : {
      directorDecisionSubject: input.directorDecisionSubject,
    }),
  });
}

function compileAuthorizationReviewFromBasis(input: Readonly<{
  store: ControlRecordStore;
  operation: DirectorDecisionOperation;
  semanticMarkdown: string;
  repository: DirectorDecisionRepositoryBasis;
  contract: FoundationRepositoryContract;
  state: ReducedDeliveryState;
  events: readonly ControlRecordEvent[];
  prior: ControlRecordEvent;
}>): AuthorizationReviewCore {
  const selection = selectionFor(input.store, input.state, input.events, input.operation);
  const repository = historicalTerminalRepositoryBasis(
    selection,
    input.store,
    input.repository,
    input.contract,
  );
  assertRepositoryMatchesBoundary(selection, input.store, repository);
  if (selection.decision === "accept") {
    verifyAcceptanceForState({
      store: input.store,
      state: input.state,
      parentCommit: repository.canonicalCommit,
    });
  }
  const semantic = semanticMarkdown(input.semanticMarkdown);
  const reviewBody = Object.freeze({
    schema: "lifecycle.authorization-review.v1" as const,
    targetId: input.store.identity.targetId,
    storeId: input.store.identity.storeId,
    processId: input.store.identity.processId,
    operation: input.operation,
    decision: selection.decision,
    consequence: DIRECTOR_DECISION_CONSEQUENCES[selection.decision],
    semanticMarkdown: semantic.markdown,
    semanticDigest: semantic.digest,
    journalHead: Object.freeze({ sequence: input.events.length, digest: input.prior.digest }),
    reducerFactsDigest: digestCanonical(input.state),
    repository,
    selectedControl: selection.relationships,
    coordinates: DIRECTOR_DECISION_COORDINATES,
    authority: Object.freeze({
      principalId: input.contract.authority.principalId,
      keyId: input.contract.authority.keyId,
      algorithm: "ed25519" as const,
    }),
    candidateDisposition: selection.candidateDisposition,
  });
  return Object.freeze({
    ...reviewBody,
    authorizationReviewDigest: digestCanonical(reviewBody),
  });
}

/**
 * Compile the exact, deterministic consequence a Director can review before
 * any operation instance or authentication mechanics exist. This function
 * reads but never mutates the Store and creates no authority.
 */
export function compileAuthorizationReviewCore(
  input: AuthorizationReviewInput,
): AuthorizationReviewCore {
  const operation = exactOperation(input.operation);
  const state = input.store.state();
  const events = allEvents(input.store);
  const prior = events.at(-1);
  if (
    prior === undefined || state.journal.eventCount !== events.length ||
    state.journal.headDigest !== prior.digest || !state.eligibleOperations.includes(operation)
  ) {
    fail("activity", "Director Decision requires one exact current eligible review basis");
  }
  assertReviewRepository(input);
  const review = compileAuthorizationReviewFromBasis({
    ...input,
    operation,
    state,
    events,
    prior,
  });
  const current = input.store.state();
  if (
    current.journal.eventCount !== state.journal.eventCount ||
    current.journal.headDigest !== state.journal.headDigest ||
    digestCanonical(current) !== digestCanonical(state)
  ) {
    fail("stale-review", "Director authorization review basis changed during compilation");
  }
  return review;
}

function projectDirectorDecisionSubject(
  review: AuthorizationReviewCore,
  mechanics: Readonly<{
    activityId: string;
    decisionId: string;
    authorizedAt: string;
    expiresAt: string | null;
    nonce: string;
  }>,
): DirectorDecisionSubject {
  return Object.freeze({
    schema: "lifecycle.director-decision-subject.v4",
    targetId: review.targetId,
    storeId: review.storeId,
    processId: review.processId,
    activityId: mechanics.activityId,
    operation: review.operation,
    decisionId: mechanics.decisionId,
    decision: review.decision,
    decisionSemanticDigest: review.semanticDigest,
    journalHead: review.journalHead,
    reducerFactsDigest: review.reducerFactsDigest,
    repository: review.repository,
    selectedControl: review.selectedControl,
    coordinates: review.coordinates,
    principalId: review.authority.principalId,
    keyId: review.authority.keyId,
    algorithm: review.authority.algorithm,
    authorizedAt: mechanics.authorizedAt,
    expiresAt: mechanics.expiresAt,
    nonce: mechanics.nonce,
    candidateDisposition: review.candidateDisposition,
  });
}

/**
 * Compile one signed transaction opening without mutating the Store. The
 * caller must commit the returned activity and Decision appends together with
 * exact operation support in one ControlRecordStore.commitOperationBatch.
 */
export async function compileDirectorDecisionOpening(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  operation: DirectorDecisionOperation;
  semanticMarkdown: string;
  repository: DirectorDecisionRepositoryBasis;
  contract: FoundationRepositoryContract;
  authenticateSubject(subject: DirectorDecisionSubject): Promise<Readonly<{
    subjectDigest: Sha256;
    signature: `ed25519:${string}`;
  }>>;
  startedAt: string;
  authorizedAt: string;
  expiresAt: string | null;
  nonce: string;
  verifiedAt: string;
  runtimeId: string;
  beforeAuthenticate?: AuthorizationReviewGate;
}>): Promise<CompiledDirectorDecisionOpening> {
  const activityId = controlIdentifier(input.activityId, "Director Decision activity identity");
  const operation = exactOperation(input.operation);
  const state = input.store.state();
  const events = allEvents(input.store);
  const prior = events.at(-1);
  if (
    prior === undefined || state.journal.eventCount !== events.length ||
    state.journal.headDigest !== prior.digest || !state.eligibleOperations.includes(operation) ||
    state.activities.some(({ id }) => id === activityId)
  ) {
    fail("activity", "Director Decision requires one exact fresh eligible transaction opening");
  }
  assertReviewRepository(input);
  const authorizationReview = compileAuthorizationReviewFromBasis({
    store: input.store,
    operation,
    semanticMarkdown: input.semanticMarkdown,
    repository: input.repository,
    contract: input.contract,
    state,
    events,
    prior,
  });
  await input.beforeAuthenticate?.(authorizationReview);
  const time = exactTimes({ priorOccurredAt: prior.occurredAt, ...input });
  const nonce = controlIdentifier(input.nonce, "Director Decision nonce");
  const runtimeId = controlIdentifier(input.runtimeId, "Director Decision runtime identity");
  const owned = identities(input.store, activityId);
  const subject = projectDirectorDecisionSubject(authorizationReview, {
    activityId,
    decisionId: owned.recordId,
    authorizedAt: time.authorizedAt,
    expiresAt: time.expiresAt,
    nonce,
  });
  const acceptanceBasis = subject.decision === "accept"
    ? verifyAcceptanceForState({
      store: input.store,
      state: input.store.state(),
      parentCommit: subject.repository.canonicalCommit,
      directorDecisionSubject: subject,
    }) : null;
  const authentication = await input.authenticateSubject(subject);
  verifyFoundationSubject({
    contract: input.contract,
    subject,
    subjectDigest: authentication.subjectDigest,
    signature: authentication.signature,
  });
  const current = input.store.state();
  if (
    current.journal.eventCount !== state.journal.eventCount ||
    current.journal.headDigest !== state.journal.headDigest ||
    digestCanonical(current) !== digestCanonical(state)
  ) {
    fail("stale-subject", "Director Decision basis changed before signed opening compilation completed");
  }
  const payload: ControlJsonObject = Object.freeze({
    schema: "lifecycle.director-decision-payload.v5",
    profileId: "lifecycle.director-decision.foundation-v1",
    decision: authorizationReview.decision,
    semanticDigest: authorizationReview.semanticDigest,
    subject,
    subjectDigest: authentication.subjectDigest,
    authentication: Object.freeze({
      principalId: input.contract.authority.principalId,
      keyId: input.contract.authority.keyId,
      algorithm: "ed25519",
      signature: authentication.signature,
      verifiedAt: time.verifiedAt,
    }),
  });
  assertFoundationSchema(DIRECTOR_DECISION_PAYLOAD_SCHEMA_ID, payload, "director-decision-payload.json");
  const revisionInput: ControlRecordRevisionInput = Object.freeze({
    recordId: owned.recordId,
    recordKind: "director-decision",
    revision: 1,
    producer: Object.freeze({ kind: "runtime", id: runtimeId }),
    semanticAuthor: Object.freeze({ kind: "director", id: input.contract.authority.principalId }),
    semanticAuthority: "director-authenticated",
    createdAt: time.verifiedAt,
    semanticMarkdown: authorizationReview.semanticMarkdown,
    payload,
    relationships: authorizationReview.selectedControl,
  });
  const revision = compileControlRecordRevision(input.store.identity.processId, revisionInput);
  assertDeliveryControlRecordPolicy(revision);
  const activityAppend = compileDeliveryActivityStartAppend({
    store: input.store,
    activityId,
    operation,
    startedAt: time.startedAt,
    runtimeId,
  });
  const decisionAppend: ControlRecordStoreAppend = Object.freeze({
    revision: revisionInput,
    event: Object.freeze({
      eventId: owned.eventId,
      eventKind: "director-decision-authenticated",
      occurredAt: time.verifiedAt,
      actor: Object.freeze({ kind: "runtime", id: runtimeId }),
      subject: Object.freeze({
        recordId: revision.recordId,
        revision: revision.revision,
        digest: revision.digest,
      }),
      payload: Object.freeze({ activityId }),
    }),
  });
  return Object.freeze({
    revision,
    revisionInput,
    acceptanceBasis,
    authorizationReview,
    subject,
    activityAppend,
    decisionAppend,
  });
}

function subjectFromPayload(revision: ControlRecordRevision): DirectorDecisionSubject {
  return object(revision.payload.subject, "Director Decision subject") as unknown as DirectorDecisionSubject;
}

/** Reverify one retained Decision from its exact signed historical basis. */
export function verifyRetainedDirectorDecision(input: Readonly<{
  store: ControlRecordStore;
  activityId: string;
  contract: FoundationRepositoryContract;
}>): Readonly<{
  revision: ControlRecordRevision;
  subject: DirectorDecisionSubject;
  historicalState: ReducedDeliveryState;
  acceptanceBasis: DirectorDecisionAcceptanceBasis | null;
}> {
  const activityId = controlIdentifier(input.activityId, "Director Decision activity identity");
  const events = allEvents(input.store);
  const decisionEvents = events.filter((event) =>
    event.eventKind === "director-decision-authenticated" && event.payload.activityId === activityId);
  if (decisionEvents.length !== 1 || decisionEvents[0]!.subject === null) {
    fail("decision", "Recovery requires one exact retained Director Decision event");
  }
  const event = decisionEvents[0]!;
  const revision = input.store.getRevision(event.subject!.recordId, event.subject!.revision);
  if (
    revision === null || revision.recordKind !== "director-decision" ||
    revision.digest !== event.subject!.digest
  ) {
    fail("decision", "Retained Director Decision does not resolve exactly");
  }
  assertDeliveryControlRecordPayload(revision);
  const subject = subjectFromPayload(revision);
  const operation = exactOperation(string(subject.operation, "Director Decision operation"));
  const authentication = object(revision.payload.authentication, "Director Decision authentication");
  const subjectDigest = digest(revision.payload.subjectDigest, "Director Decision subject digest");
  const signature = string(authentication.signature, "Director Decision signature") as `ed25519:${string}`;
  if (
    revision.payload.decision !== subject.decision ||
    revision.payload.semanticDigest !== subject.decisionSemanticDigest ||
    sha256Bytes(revision.semanticMarkdown) !== subject.decisionSemanticDigest ||
    subject.activityId !== activityId || subject.decisionId !== revision.recordId ||
    subject.targetId !== input.store.identity.targetId ||
    subject.storeId !== input.store.identity.storeId ||
    subject.processId !== input.store.identity.processId ||
    subject.principalId !== authentication.principalId ||
    subject.keyId !== authentication.keyId ||
    subject.algorithm !== authentication.algorithm ||
    subject.principalId !== input.contract.authority.principalId ||
    subject.keyId !== input.contract.authority.keyId ||
    subject.repository.repositoryContractDigest !== input.contract.digest ||
    input.contract.targetId !== subject.targetId ||
    subject.coordinates.qualification !== "lifecycle.foundation.1.0.0-rc.17" ||
    subject.coordinates.repository !== "lifecycle.repository.v22" ||
    subject.coordinates.provider !== "lifecycle.provider-adapter.v7" ||
    subject.coordinates.authoritySubject !== "lifecycle.director-decision-subject.v4" ||
    subject.coordinates.transactionRules !== "lifecycle.delivery-transaction-rules.v1"
  ) {
    fail("subject", "Retained Director Decision top-level facts do not equal its signed semantic subject");
  }
  verifyFoundationSubject({ contract: input.contract, subject, subjectDigest, signature });

  const selectedControl = canonicalBindings(subject.selectedControl);
  const retainedRelationships = canonicalBindings(
    revision.relationships as DirectorDecisionControlBinding[],
  );
  if (
    canonicalJson(subject.selectedControl) !== canonicalJson(selectedControl) ||
    canonicalJson(selectedControl) !== canonicalJson(retainedRelationships)
  ) {
    fail("selected-control", "Retained Director Decision relationships differ from signed selected Control roles");
  }
  for (const selected of selectedControl) {
    const resolved = input.store.getRevision(selected.target.id, selected.target.revision);
    if (
      resolved === null || resolved.recordKind !== selected.target.kind ||
      resolved.digest !== selected.target.digest
    ) {
      fail("selected-control", "Retained Director Decision selected Control subject does not resolve exactly");
    }
    assertDeliveryControlRecordPayload(resolved);
  }

  if (
    !Number.isSafeInteger(subject.journalHead.sequence) || subject.journalHead.sequence < 1 ||
    !DIGEST.test(subject.journalHead.digest) || subject.journalHead.sequence + 2 !== event.sequence
  ) {
    fail("journal", "Director Decision does not bind one exact historical Journal head");
  }
  const historicalEvents = events.slice(0, subject.journalHead.sequence);
  const historicalHead = historicalEvents.at(-1);
  const opening = events[subject.journalHead.sequence];
  if (
    historicalEvents.length !== subject.journalHead.sequence ||
    historicalHead?.digest !== subject.journalHead.digest ||
    opening?.eventKind !== "activity-started" || opening.payload.activityId !== activityId ||
    opening.payload.operation !== operation || event.sequence !== opening.sequence + 1
  ) {
    fail("journal", "Director Decision opening does not follow its exact signed Journal head");
  }
  const historicalState = reduceDeliveryEvents(historicalEvents, (selected) =>
    input.store.getRevision(selected.recordId, selected.revision));
  if (digestCanonical(historicalState) !== subject.reducerFactsDigest) {
    fail("reducer", "Director Decision signed reducer facts do not reproduce from its historical Journal prefix");
  }
  const expected = selectionFor(input.store, historicalState, historicalEvents, operation);
  const expectedRepository = historicalTerminalRepositoryBasis(
    expected,
    input.store,
    subject.repository,
    input.contract,
  );
  assertRepositoryMatchesBoundary(expected, input.store, subject.repository);
  if (
    expected.decision !== subject.decision ||
    expected.candidateDisposition !== subject.candidateDisposition ||
    canonicalJson(expectedRepository) !== canonicalJson(subject.repository) ||
    canonicalJson(expected.relationships) !== canonicalJson(selectedControl)
  ) {
    fail("selected-control", "Director Decision signed Control roles differ from its exact historical subjects");
  }
  const acceptanceBasis = subject.decision === "accept"
    ? verifyAcceptanceForState({
      store: input.store,
      state: historicalState,
      parentCommit: subject.repository.canonicalCommit,
      directorDecisionSubject: subject,
    }) : null;
  return Object.freeze({ revision, subject, historicalState, acceptanceBasis });
}
