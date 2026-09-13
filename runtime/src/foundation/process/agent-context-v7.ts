import type { AgentWorkProductPropositionSet } from "../control/agent-work-product-semantics.js";
import type { ControlRecordStore } from "../control/store.js";
import type {
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordRelationshipTarget,
  ControlRecordRevision,
} from "../control/types.js";
import { FoundationError } from "../error.js";
import type { FoundationProjectionSourceItem } from "../projection/types.js";
import {
  canonicalJson,
  digestCanonical,
  type Sha256,
} from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";

const MAXIMUM_ITEMS = 4_096;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

export type FoundationAgentEvidenceSetItemV7 = Readonly<{
  id: string;
  kind: "check-receipt" | "agent-work-product";
  authorityClass: "runtime-observed" | "agent-proposed";
  digest: Sha256;
  subjectDigest: Sha256;
}>;

export type FoundationAgentEvidenceSetV7 = Readonly<{
  schema: "lifecycle.attempt-evidence-set.v3";
  items: readonly FoundationAgentEvidenceSetItemV7[];
}>;

export type FoundationAgentEvidenceSetCompilationV7 = Readonly<{
  subject: FoundationAgentEvidenceSetV7;
  digest: Sha256;
}>;

export type FoundationAgentPropositionSetCompilationV7 = Readonly<{
  subject: AgentWorkProductPropositionSet;
  digest: Sha256;
}>;

function fail(code: string, message: string): never {
  throw new FoundationError(`lifecycle.agent-context-v7.${code}`, message);
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

function text(value: ControlJsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    fail("retained-fact", `${label} must be bounded normalized text`);
  }
  return value;
}

function identifier(value: ControlJsonValue | undefined, label: string): string {
  const selected = text(value, label);
  if (!ID_PATTERN.test(selected) || Buffer.byteLength(selected, "utf8") > 512) {
    fail("retained-fact", `${label} must be one bounded opaque identity`);
  }
  return selected;
}

function nullableText(value: ControlJsonValue | undefined, label: string): string | null {
  return value === null ? null : text(value, label);
}

function boolean(value: ControlJsonValue | undefined, label: string): boolean {
  if (typeof value !== "boolean") fail("retained-fact", `${label} must be one exact boolean`);
  return value;
}

function exactStringSet(value: ControlJsonValue | undefined, label: string): readonly string[] {
  const selected = array(value, label).map((entry, index) => identifier(entry, `${label}[${index}]`));
  const ordered = [...selected].sort(compareCodePoints);
  if (
    new Set(selected).size !== selected.length ||
    selected.some((entry, index) => entry !== ordered[index])
  ) {
    fail("retained-fact", `${label} must already be sorted and unique`);
  }
  return Object.freeze(selected);
}

function exactRetainedRevision(
  store: ControlRecordStore,
  supplied: ControlRecordRevision,
  expectedKind: string,
  label: string,
): ControlRecordRevision {
  if (supplied.processId !== store.identity.processId || supplied.recordKind !== expectedKind) {
    fail("revision", `${label} is not one ${expectedKind} revision in this Delivery`);
  }
  const retained = store.getRevision(supplied.recordId, supplied.revision);
  if (
    retained === null || retained.recordKind !== expectedKind || retained.digest !== supplied.digest ||
    canonicalJson(retained) !== canonicalJson(supplied)
  ) {
    fail("revision", `${label} does not reproduce one exact retained revision`);
  }
  return retained;
}

function exactRelationship(
  revision: ControlRecordRevision,
  relations: readonly string[],
  targetKind: string,
  label: string,
): ControlRecordRelationshipTarget {
  const matches = revision.relationships.filter(({ relation }) => relations.includes(relation));
  if (matches.length !== 1 || matches[0]!.target.kind !== targetKind) {
    fail("relationship", `${label} must bind exactly one ${targetKind} subject`);
  }
  return matches[0]!.target;
}

function exactRelationshipTarget(
  store: ControlRecordStore,
  target: ControlRecordRelationshipTarget,
  expectedKind: string,
  label: string,
): ControlRecordRelationshipTarget {
  if (
    target.kind !== expectedKind || !SHA256_PATTERN.test(target.digest) ||
    !Number.isSafeInteger(target.revision) || target.revision < 1
  ) {
    fail("relationship", `${label} is not one exact ${expectedKind} reference`);
  }
  const retained = store.getRevision(target.id, target.revision);
  if (
    retained === null || retained.processId !== store.identity.processId ||
    retained.recordKind !== expectedKind || retained.digest !== target.digest
  ) {
    fail("relationship", `${label} does not resolve one exact retained ${expectedKind} revision`);
  }
  return Object.freeze({ ...target });
}

function evidenceItem(
  store: ControlRecordStore,
  supplied: ControlRecordRevision,
): FoundationAgentEvidenceSetItemV7 {
  if (supplied.recordKind === "agent-work-product") {
    const revision = exactRetainedRevision(store, supplied, "agent-work-product", "Agent Work Product Evidence");
    if (revision.payload.schema !== "lifecycle.agent-work-product-payload.v5") {
      fail("evidence", "Agent Work Product Evidence uses a non-current payload schema");
    }
    const target = exactRelationshipTarget(
      store,
      exactRelationship(revision, ["result-of"], "agent-attempt", "Agent Work Product Evidence"),
      "agent-attempt",
      "Agent Work Product Evidence subject",
    );
    return Object.freeze({
      id: revision.recordId,
      kind: "agent-work-product",
      authorityClass: "agent-proposed",
      digest: revision.digest,
      subjectDigest: digestCanonical(target),
    });
  }
  if (supplied.recordKind === "check-receipt") {
    const revision = exactRetainedRevision(store, supplied, "check-receipt", "Check Receipt Evidence");
    if (revision.payload.schema !== "lifecycle.check-receipt-payload.v3") {
      fail("evidence", "Check Receipt Evidence uses a non-current payload schema");
    }
    const boundaryTargets = revision.relationships.filter(({ relation }) => relation === "checks-boundary");
    const sealTargets = revision.relationships.filter(({ relation }) => relation === "checks-seal");
    if ((boundaryTargets.length === 1) === (sealTargets.length === 1)) {
      fail("relationship", "Check Receipt Evidence must bind exactly one Work Boundary or Candidate Seal");
    }
    if (boundaryTargets.length > 1 || sealTargets.length > 1) {
      fail("relationship", "Check Receipt Evidence repeats its exact proof subject");
    }
    const target = boundaryTargets.length === 1
      ? exactRelationshipTarget(
        store,
        boundaryTargets[0]!.target,
        "work-boundary",
        "Check Receipt Work Boundary subject",
      )
      : exactRelationshipTarget(
        store,
        sealTargets[0]!.target,
        "candidate-seal",
        "Check Receipt Candidate Seal subject",
      );
    return Object.freeze({
      id: revision.recordId,
      kind: "check-receipt",
      authorityClass: "runtime-observed",
      digest: revision.digest,
      subjectDigest: digestCanonical(target),
    });
  }
  return fail("evidence", "Attempt Evidence accepts only exact Check Receipt or Agent Work Product revisions");
}

/**
 * Derive the exact semantic Evidence subject bound into a builder or reviewer
 * Attempt. The caller selects applicable retained revisions; this owner proves
 * their Control identity, authority, and exact proof subject.
 */
export function compileFoundationAgentEvidenceSetV7(input: Readonly<{
  store: ControlRecordStore;
  revisions: readonly ControlRecordRevision[];
}>): FoundationAgentEvidenceSetCompilationV7 {
  if (input.revisions.length > MAXIMUM_ITEMS) {
    fail("bound", `Attempt Evidence exceeds the fixed ${MAXIMUM_ITEMS}-item runtime bound`);
  }
  const items = input.revisions.map((revision) => evidenceItem(input.store, revision))
    .sort((left, right) => compareCodePoints(left.id, right.id));
  if (new Set(items.map(({ id }) => id)).size !== items.length) {
    fail("evidence", "Attempt Evidence repeats one Control identity");
  }
  const subject: FoundationAgentEvidenceSetV7 = Object.freeze({
    schema: "lifecycle.attempt-evidence-set.v3",
    items: Object.freeze(items),
  });
  return Object.freeze({ subject, digest: digestCanonical(subject) });
}

/**
 * Derive Attempt Evidence directly from the exact sources selected by an
 * Execution Projection. Callers do not restate Evidence identities, authority,
 * or proof subjects: this owner resolves and proves the retained Control
 * revisions named by the Projection.
 */
export function compileFoundationAgentEvidenceSetFromProjectionSourcesV7(input: Readonly<{
  store: ControlRecordStore;
  sources: readonly FoundationProjectionSourceItem[];
}>): FoundationAgentEvidenceSetCompilationV7 {
  const selected = input.sources.filter(({ semantic }) => semantic.class === "evidence");
  if (selected.length > MAXIMUM_ITEMS) {
    fail("bound", `Attempt Evidence exceeds the fixed ${MAXIMUM_ITEMS}-item runtime bound`);
  }
  const revisions: ControlRecordRevision[] = [];
  const identities = new Set<string>();
  for (const source of selected) {
    const kind = source.semantic.evidenceKind;
    if (kind !== "check-receipt" && kind !== "agent-work-product") {
      fail("projection-evidence", "Execution Projection contains a non-Control Evidence source");
    }
    const id = source.semantic.subjectId;
    if (identities.has(id)) {
      fail("projection-evidence", "Execution Projection repeats one Evidence Control identity");
    }
    identities.add(id);
    const revision = input.store.getRevision(id, 1);
    const expectedAuthority = kind === "check-receipt"
      ? "runtime-authenticated-fact"
      : "agent-proposed-claim";
    if (
      revision === null || revision.processId !== input.store.identity.processId ||
      revision.recordKind !== kind || revision.revision !== 1 ||
      revision.digest !== source.digest || revision.digest !== source.revision ||
      revision.digest !== source.semantic.subjectDigest ||
      source.authority !== expectedAuthority ||
      source.reference !== `evidence:${kind}:${id}`
    ) {
      fail(
        "projection-evidence",
        `Execution Projection Evidence ${id} does not resolve one exact retained ${kind} revision`,
      );
    }
    revisions.push(revision);
  }
  return compileFoundationAgentEvidenceSetV7({
    store: input.store,
    revisions: Object.freeze(revisions),
  });
}

function proposition(value: ControlJsonValue, index: number): AgentWorkProductPropositionSet["propositions"][number] {
  const source = object(value, `Work Boundary proposition[${index}]`);
  return Object.freeze({
    id: identifier(source.id, `Work Boundary proposition[${index}] identity`),
    claim: text(source.claim, `Work Boundary proposition[${index}] claim`),
    evidenceKinds: exactStringSet(source.evidenceKinds, `Work Boundary proposition[${index}] Evidence kinds`),
    evidenceIds: exactStringSet(
      source.evidenceArtifactIds,
      `Work Boundary proposition[${index}] Evidence identities`,
    ),
    obligationIds: exactStringSet(source.obligationIds, `Work Boundary proposition[${index}] obligations`),
    effectIds: exactStringSet(source.effectIds, `Work Boundary proposition[${index}] effects`),
    riskIds: exactStringSet(source.riskIds, `Work Boundary proposition[${index}] risks`),
    path: nullableText(source.path, `Work Boundary proposition[${index}] path`),
    checkId: source.checkId === null
      ? null
      : identifier(source.checkId, `Work Boundary proposition[${index}] Check identity`),
    allowNotApplicable: boolean(
      source.allowNotApplicable,
      `Work Boundary proposition[${index}] not-applicable permission`,
    ),
    notApplicableCondition: nullableText(
      source.notApplicableCondition,
      `Work Boundary proposition[${index}] not-applicable condition`,
    ),
  });
}

/** Derive the complete reviewer proposition subject from the active Boundary. */
export function compileFoundationReviewerPropositionSetV7(input: Readonly<{
  store: ControlRecordStore;
  boundary: ControlRecordRevision;
}>): FoundationAgentPropositionSetCompilationV7 {
  const boundary = exactRetainedRevision(input.store, input.boundary, "work-boundary", "Reviewer Work Boundary");
  const current = input.store.state().subjects.activeBoundary;
  if (
    current === null || current.id !== boundary.recordId ||
    current.revision !== boundary.revision || current.digest !== boundary.digest
  ) {
    fail("boundary", "Reviewer proposition compilation requires the exact active Work Boundary");
  }
  if (boundary.payload.schema !== "lifecycle.work-boundary-payload.v6") {
    fail("boundary", "Reviewer Work Boundary uses a non-current payload schema");
  }
  const mandate = object(boundary.payload.mandate, "Work Boundary mandate");
  const source = array(mandate.acceptancePropositions, "Work Boundary acceptance propositions");
  if (source.length > MAXIMUM_ITEMS) {
    fail("bound", `Reviewer propositions exceed the fixed ${MAXIMUM_ITEMS}-item runtime bound`);
  }
  const propositions = source.map(proposition)
    .sort((left, right) => compareCodePoints(left.id, right.id));
  if (new Set(propositions.map(({ id }) => id)).size !== propositions.length) {
    fail("proposition", "Reviewer proposition set repeats one identity");
  }
  const subject: AgentWorkProductPropositionSet = Object.freeze({
    schema: "lifecycle.proposition-set.v3",
    propositions: Object.freeze(propositions),
  });
  return Object.freeze({ subject, digest: digestCanonical(subject) });
}
