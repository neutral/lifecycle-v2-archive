import { FoundationError } from "../error.js";
import type {
  ControlActorKind,
  ControlRecordRevision,
  ControlSemanticAuthority,
} from "./types.js";

export const DELIVERY_CONTROL_RECORD_KINDS = Object.freeze([
  "director-brief",
  "work-delegation",
  "agent-attempt",
  "agent-work-product",
  "execution-receipt",
  "candidate-revision",
  "integration-assessment",
  "work-boundary",
  "material-condition",
  "director-decision",
  "candidate-seal",
  "check-receipt",
  "evidence-packet",
  "closure",
] as const);

export type DeliveryControlRecordKind = typeof DELIVERY_CONTROL_RECORD_KINDS[number];

export type ControlRecordEditWindow =
  | "none"
  | "before-activity"
  | "provider-active"
  | "before-authentication";

export type ControlRecordEditor = "none" | "director" | "assigned-agent";

export type ControlRecordRelationshipPolicy = Readonly<{
  relation: string;
  targetKinds: readonly string[];
  minimum: number;
  maximum: number | null;
}>;

export type ControlRecordKindPolicy = Readonly<{
  kind: DeliveryControlRecordKind;
  payloadSchemaId: `urn:lifecycle:schema:${string}`;
  dossier: "frame" | "attempt" | "candidate" | "boundary" | "evidence" | "decision" | "closure";
  producer: ControlActorKind;
  semanticAuthor: ControlActorKind;
  semanticAuthority: ControlSemanticAuthority;
  editor: ControlRecordEditor;
  editWindow: ControlRecordEditWindow;
  revisionMode: "single" | "successive";
  finalizationEvent: string;
  retention: "archive-with-delivery";
  relationships: readonly ControlRecordRelationshipPolicy[];
}>;

const MANY = null;

const POLICIES = Object.freeze({
  "director-brief": Object.freeze({
    kind: "director-brief",
    payloadSchemaId: "urn:lifecycle:schema:director-brief-payload:v2",
    dossier: "frame",
    producer: "runtime",
    semanticAuthor: "director",
    semanticAuthority: "director-supplied",
    editor: "director",
    editWindow: "before-activity",
    revisionMode: "single",
    finalizationEvent: "director-brief-submitted",
    retention: "archive-with-delivery",
    relationships: Object.freeze([]),
  }),
  "work-delegation": Object.freeze({
    kind: "work-delegation",
    payloadSchemaId: "urn:lifecycle:schema:work-delegation-payload:v2",
    dossier: "attempt",
    producer: "runtime",
    semanticAuthor: "director",
    semanticAuthority: "director-supplied",
    editor: "director",
    editWindow: "before-activity",
    revisionMode: "successive",
    finalizationEvent: "work-delegation-set",
    retention: "archive-with-delivery",
    relationships: Object.freeze([
      { relation: "uses-boundary", targetKinds: ["work-boundary"], minimum: 1, maximum: 1 },
      { relation: "uses-admission", targetKinds: ["director-decision"], minimum: 1, maximum: 1 },
      { relation: "uses-brief", targetKinds: ["director-brief"], minimum: 0, maximum: 2 },
      { relation: "revises", targetKinds: ["work-delegation"], minimum: 0, maximum: 1 },
    ]),
  }),
  "agent-attempt": Object.freeze({
    kind: "agent-attempt",
    payloadSchemaId: "urn:lifecycle:schema:agent-attempt-payload:v3",
    dossier: "attempt",
    producer: "runtime",
    semanticAuthor: "runtime",
    semanticAuthority: "runtime-derived",
    editor: "none",
    editWindow: "none",
    revisionMode: "single",
    finalizationEvent: "agent-attempt-prepared",
    retention: "archive-with-delivery",
    relationships: Object.freeze([
      { relation: "uses-brief", targetKinds: ["director-brief"], minimum: 1, maximum: 1 },
      { relation: "uses-boundary", targetKinds: ["work-boundary"], minimum: 0, maximum: 1 },
      { relation: "uses-candidate", targetKinds: ["candidate-revision"], minimum: 0, maximum: 1 },
      { relation: "uses-seal", targetKinds: ["candidate-seal"], minimum: 0, maximum: 1 },
    ]),
  }),
  "agent-work-product": Object.freeze({
    kind: "agent-work-product",
    payloadSchemaId: "urn:lifecycle:schema:agent-work-product-payload:v5",
    dossier: "attempt",
    producer: "runtime",
    semanticAuthor: "agent",
    semanticAuthority: "agent-proposed",
    editor: "assigned-agent",
    editWindow: "provider-active",
    revisionMode: "single",
    finalizationEvent: "agent-work-product-submitted",
    retention: "archive-with-delivery",
    relationships: Object.freeze([
      { relation: "result-of", targetKinds: ["agent-attempt"], minimum: 1, maximum: 1 },
    ]),
  }),
  "execution-receipt": Object.freeze({
    kind: "execution-receipt",
    payloadSchemaId: "urn:lifecycle:schema:execution-receipt-payload:v3",
    dossier: "attempt",
    producer: "runtime",
    semanticAuthor: "runtime",
    semanticAuthority: "runtime-observed",
    editor: "none",
    editWindow: "none",
    revisionMode: "single",
    finalizationEvent: "execution-receipt-recorded",
    retention: "archive-with-delivery",
    relationships: Object.freeze([
      { relation: "observes-attempt", targetKinds: ["agent-attempt"], minimum: 1, maximum: 1 },
      { relation: "observes-work-product", targetKinds: ["agent-work-product"], minimum: 0, maximum: 1 },
      { relation: "observes-candidate", targetKinds: ["candidate-revision"], minimum: 0, maximum: 1 },
    ]),
  }),
  "candidate-revision": Object.freeze({
    kind: "candidate-revision",
    payloadSchemaId: "urn:lifecycle:schema:candidate-revision-payload:v3",
    dossier: "candidate",
    producer: "runtime",
    semanticAuthor: "runtime",
    semanticAuthority: "runtime-observed",
    editor: "none",
    editWindow: "none",
    revisionMode: "successive",
    finalizationEvent: "candidate-revision-observed",
    retention: "archive-with-delivery",
    relationships: Object.freeze([
      { relation: "revises", targetKinds: ["candidate-revision"], minimum: 0, maximum: 1 },
      { relation: "governed-by", targetKinds: ["work-boundary"], minimum: 1, maximum: 1 },
      { relation: "result-of", targetKinds: ["agent-attempt"], minimum: 0, maximum: 1 },
      { relation: "integrated-from", targetKinds: ["integration-assessment"], minimum: 0, maximum: 1 },
    ]),
  }),
  "integration-assessment": Object.freeze({
    kind: "integration-assessment",
    payloadSchemaId: "urn:lifecycle:schema:integration-assessment-payload:v1",
    dossier: "candidate",
    producer: "runtime",
    semanticAuthor: "runtime",
    semanticAuthority: "runtime-observed",
    editor: "none",
    editWindow: "none",
    revisionMode: "single",
    finalizationEvent: "integration-assessed",
    retention: "archive-with-delivery",
    relationships: Object.freeze([
      { relation: "governed-by", targetKinds: ["work-boundary"], minimum: 1, maximum: 1 },
      { relation: "integrates", targetKinds: ["candidate-revision"], minimum: 1, maximum: 1 },
    ]),
  }),
  "work-boundary": Object.freeze({
    kind: "work-boundary",
    payloadSchemaId: "urn:lifecycle:schema:work-boundary-payload:v6",
    dossier: "boundary",
    producer: "runtime",
    semanticAuthor: "runtime",
    semanticAuthority: "runtime-derived",
    editor: "none",
    editWindow: "none",
    revisionMode: "successive",
    finalizationEvent: "work-boundary-finalized",
    retention: "archive-with-delivery",
    relationships: Object.freeze([
      { relation: "uses-brief", targetKinds: ["director-brief"], minimum: 1, maximum: 1 },
      { relation: "proposed-from", targetKinds: ["agent-work-product"], minimum: 1, maximum: 1 },
      { relation: "revises", targetKinds: ["work-boundary"], minimum: 0, maximum: 1 },
      { relation: "resolves", targetKinds: ["material-condition"], minimum: 0, maximum: 1 },
    ]),
  }),
  "material-condition": Object.freeze({
    kind: "material-condition",
    payloadSchemaId: "urn:lifecycle:schema:material-condition-payload:v4",
    dossier: "boundary",
    producer: "runtime",
    semanticAuthor: "runtime",
    semanticAuthority: "runtime-derived",
    editor: "none",
    editWindow: "none",
    revisionMode: "single",
    finalizationEvent: "material-condition-frozen",
    retention: "archive-with-delivery",
    relationships: Object.freeze([
      { relation: "reported-by", targetKinds: ["agent-work-product", "integration-assessment"], minimum: 0, maximum: 1 },
      { relation: "observed-in", targetKinds: ["execution-receipt", "candidate-seal"], minimum: 0, maximum: 1 },
      { relation: "freezes", targetKinds: ["candidate-revision"], minimum: 1, maximum: 1 },
      { relation: "governed-by", targetKinds: ["work-boundary"], minimum: 1, maximum: 1 },
    ]),
  }),
  "director-decision": Object.freeze({
    kind: "director-decision",
    payloadSchemaId: "urn:lifecycle:schema:director-decision-payload:v5",
    dossier: "decision",
    producer: "runtime",
    semanticAuthor: "director",
    semanticAuthority: "director-authenticated",
    editor: "director",
    editWindow: "before-authentication",
    revisionMode: "single",
    finalizationEvent: "director-decision-authenticated",
    retention: "archive-with-delivery",
    relationships: Object.freeze([
      { relation: "selects-boundary", targetKinds: ["work-boundary"], minimum: 0, maximum: 1 },
      { relation: "selects-baseline-receipt", targetKinds: ["check-receipt"], minimum: 0, maximum: MANY },
      { relation: "continues-from-boundary", targetKinds: ["work-boundary"], minimum: 0, maximum: 1 },
      { relation: "resolves", targetKinds: ["material-condition"], minimum: 0, maximum: 1 },
      { relation: "selects-candidate", targetKinds: ["candidate-revision"], minimum: 0, maximum: 1 },
      { relation: "selects-seal", targetKinds: ["candidate-seal"], minimum: 0, maximum: 1 },
      { relation: "selects-evidence", targetKinds: ["evidence-packet"], minimum: 0, maximum: 1 },
    ]),
  }),
  "candidate-seal": Object.freeze({
    kind: "candidate-seal",
    payloadSchemaId: "urn:lifecycle:schema:candidate-seal-payload:v2",
    dossier: "evidence",
    producer: "runtime",
    semanticAuthor: "runtime",
    semanticAuthority: "runtime-observed",
    editor: "none",
    editWindow: "none",
    revisionMode: "single",
    finalizationEvent: "candidate-sealed",
    retention: "archive-with-delivery",
    relationships: Object.freeze([
      { relation: "seals", targetKinds: ["candidate-revision"], minimum: 1, maximum: 1 },
      { relation: "governed-by", targetKinds: ["work-boundary"], minimum: 1, maximum: 1 },
    ]),
  }),
  "check-receipt": Object.freeze({
    kind: "check-receipt",
    payloadSchemaId: "urn:lifecycle:schema:check-receipt-payload:v3",
    dossier: "evidence",
    producer: "runtime",
    semanticAuthor: "runtime",
    semanticAuthority: "runtime-observed",
    editor: "none",
    editWindow: "none",
    revisionMode: "single",
    finalizationEvent: "check-receipt-recorded",
    retention: "archive-with-delivery",
    relationships: Object.freeze([
      { relation: "checks-boundary", targetKinds: ["work-boundary"], minimum: 0, maximum: 1 },
      { relation: "checks-seal", targetKinds: ["candidate-seal"], minimum: 0, maximum: 1 },
    ]),
  }),
  "evidence-packet": Object.freeze({
    kind: "evidence-packet",
    payloadSchemaId: "urn:lifecycle:schema:evidence-packet-payload:v2",
    dossier: "evidence",
    producer: "runtime",
    semanticAuthor: "runtime",
    semanticAuthority: "runtime-derived",
    editor: "none",
    editWindow: "none",
    revisionMode: "single",
    finalizationEvent: "evidence-packet-finalized",
    retention: "archive-with-delivery",
    relationships: Object.freeze([
      { relation: "governed-by", targetKinds: ["work-boundary"], minimum: 1, maximum: 1 },
      { relation: "evaluates", targetKinds: ["candidate-revision"], minimum: 1, maximum: 1 },
      { relation: "uses-seal", targetKinds: ["candidate-seal"], minimum: 1, maximum: 1 },
      { relation: "uses-check", targetKinds: ["check-receipt"], minimum: 0, maximum: MANY },
      { relation: "uses-review", targetKinds: ["agent-work-product"], minimum: 1, maximum: 1 },
      { relation: "uses-review-receipt", targetKinds: ["execution-receipt"], minimum: 1, maximum: 1 },
    ]),
  }),
  "closure": Object.freeze({
    kind: "closure",
    payloadSchemaId: "urn:lifecycle:schema:closure-payload:v6",
    dossier: "closure",
    producer: "runtime",
    semanticAuthor: "runtime",
    semanticAuthority: "runtime-derived",
    editor: "none",
    editWindow: "none",
    revisionMode: "single",
    finalizationEvent: "closure-recorded",
    retention: "archive-with-delivery",
    relationships: Object.freeze([
      { relation: "closes-with", targetKinds: ["director-decision"], minimum: 1, maximum: 1 },
      { relation: "governed-by", targetKinds: ["work-boundary"], minimum: 0, maximum: 1 },
      { relation: "accepts-candidate", targetKinds: ["candidate-revision"], minimum: 0, maximum: 1 },
      { relation: "accepts-evidence", targetKinds: ["evidence-packet"], minimum: 0, maximum: 1 },
      { relation: "abandons-candidate", targetKinds: ["candidate-revision"], minimum: 0, maximum: 1 },
    ]),
  }),
} satisfies Readonly<Record<DeliveryControlRecordKind, ControlRecordKindPolicy>>);

export function deliveryControlRecordPolicies(): readonly ControlRecordKindPolicy[] {
  return DELIVERY_CONTROL_RECORD_KINDS.map((kind) => POLICIES[kind]);
}

export function deliveryControlRecordPolicy(kind: string): ControlRecordKindPolicy {
  if (!DELIVERY_CONTROL_RECORD_KINDS.includes(kind as DeliveryControlRecordKind)) {
    throw new FoundationError(
      "lifecycle.control-record-policy.kind",
      `Unsupported Delivery Control record kind ${kind}`,
    );
  }
  return POLICIES[kind as DeliveryControlRecordKind];
}

export function assertDeliveryControlRecordPolicy(revision: ControlRecordRevision): void {
  const policy = deliveryControlRecordPolicy(revision.recordKind);
  if (revision.producer.kind !== policy.producer) {
    throw new FoundationError(
      "lifecycle.control-record-policy.producer",
      `${revision.recordKind} must be produced by ${policy.producer}`,
    );
  }
  if (revision.semanticAuthority !== policy.semanticAuthority) {
    throw new FoundationError(
      "lifecycle.control-record-policy.semantic-authority",
      `${revision.recordKind} must preserve ${policy.semanticAuthority} as its record-level semantic authority`,
    );
  }
  if (revision.semanticAuthor.kind !== policy.semanticAuthor) {
    throw new FoundationError(
      "lifecycle.control-record-policy.semantic-author",
      `${revision.recordKind} semantics must be authored by ${policy.semanticAuthor}`,
    );
  }
  if (policy.revisionMode === "single" && revision.revision !== 1) {
    throw new FoundationError(
      "lifecycle.control-record-policy.revision",
      `${revision.recordKind} is a single-revision Control family`,
    );
  }
  if (revision.recordKind === "material-condition") {
    const source = revision.payload.source;
    const sourceKind = source !== null && typeof source === "object" && "kind" in source ? source.kind : undefined;
    const reported = revision.relationships.filter(({ relation }) => relation === "reported-by");
    const observed = revision.relationships.filter(({ relation }) => relation === "observed-in");
    const valid = sourceKind === "projection-compilation"
      ? reported.length === 0 && observed.length <= 1 && observed.every(({ target }) => target.kind === "candidate-seal")
      : sourceKind === "integration-assessment"
        ? reported.length === 1 && reported[0]!.target.kind === "integration-assessment" && observed.length === 0
        : sourceKind === "agent-proposal"
          ? reported.length === 1 && reported[0]!.target.kind === "agent-work-product" && observed.length === 1 && observed[0]!.target.kind === "execution-receipt"
          : true; // Payload validation owns an absent or unsupported source discriminator.
    if (!valid) throw new FoundationError("lifecycle.control-record-policy.relationship-cardinality",
      "Material Condition relationships do not match their exact source kind");
  }
  const counts = new Map<string, number>();
  for (const relationship of revision.relationships) {
    const relationshipPolicy = policy.relationships.find((candidate) =>
      candidate.relation === relationship.relation);
    if (relationshipPolicy === undefined) {
      throw new FoundationError(
        "lifecycle.control-record-policy.relationship",
        `${revision.recordKind} cannot carry relationship ${relationship.relation}`,
      );
    }
    if (!relationshipPolicy.targetKinds.includes(relationship.target.kind)) {
      throw new FoundationError(
        "lifecycle.control-record-policy.relationship-target",
        `${revision.recordKind} relationship ${relationship.relation} cannot target ${relationship.target.kind}`,
      );
    }
    counts.set(relationship.relation, (counts.get(relationship.relation) ?? 0) + 1);
  }
  for (const relationshipPolicy of policy.relationships) {
    const count = counts.get(relationshipPolicy.relation) ?? 0;
    if (
      count < relationshipPolicy.minimum ||
      (relationshipPolicy.maximum !== null && count > relationshipPolicy.maximum)
    ) {
      throw new FoundationError(
        "lifecycle.control-record-policy.relationship-cardinality",
        `${revision.recordKind} relationship ${relationshipPolicy.relation} has invalid cardinality`,
        { observedFacts: { count, minimum: relationshipPolicy.minimum, maximum: relationshipPolicy.maximum } },
      );
    }
  }
}
