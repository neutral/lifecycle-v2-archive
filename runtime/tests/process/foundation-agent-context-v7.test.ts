import assert from "node:assert/strict";
import test from "node:test";
import { compileControlRecordRevision } from "../../src/foundation/control/model.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlJsonObject,
  type ControlRecordRelationship,
  type ControlRecordRevision,
} from "../../src/foundation/control/types.js";
import {
  compileFoundationAgentEvidenceSetFromProjectionSourcesV7,
  compileFoundationAgentEvidenceSetV7,
  compileFoundationReviewerPropositionSetV7,
} from "../../src/foundation/process/agent-context-v7.js";
import type { FoundationProjectionSourceItem } from "../../src/foundation/projection/types.js";
import { digestCanonical, sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

const PROCESS = "delivery-agent-context-v7";
const CREATED = "2026-08-29T18:00:00.000Z";

function relationship(relation: string, target: ControlRecordRevision): ControlRecordRelationship {
  return Object.freeze({
    relation,
    target: Object.freeze({
      kind: target.recordKind,
      id: target.recordId,
      revision: target.revision,
      digest: target.digest,
    }),
  });
}

function revision(input: Readonly<{
  id: string;
  kind: string;
  payload: ControlJsonObject;
  relationships?: readonly ControlRecordRelationship[];
  authority?: "runtime-derived" | "runtime-observed" | "agent-proposed";
}>): ControlRecordRevision {
  const authority = input.authority ?? "runtime-derived";
  return compileControlRecordRevision(PROCESS, {
    recordId: input.id,
    recordKind: input.kind,
    revision: 1,
    producer: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
    semanticAuthor: authority === "agent-proposed"
      ? Object.freeze({ kind: "agent", id: "agent-reviewer" })
      : Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
    semanticAuthority: authority,
    createdAt: CREATED,
    semanticMarkdown: `# ${input.kind}\n`,
    payload: input.payload,
    relationships: input.relationships ?? Object.freeze([]),
  });
}

function boundary(): ControlRecordRevision {
  const payload = validDeliveryControlPayload("work-boundary");
  const mandate = payload.mandate as ControlJsonObject;
  return revision({
    id: "work-boundary-agent-context",
    kind: "work-boundary",
    payload: Object.freeze({
      ...payload,
      mandate: Object.freeze({
        ...mandate,
        acceptancePropositions: Object.freeze([
          Object.freeze({
            id: "proposition.alpha",
            claim: "The exact result satisfies alpha.",
            evidenceKinds: Object.freeze(["artifact", "check"]),
            evidenceArtifactIds: Object.freeze(["artifact.alpha"]),
            obligationIds: Object.freeze(["obligation.alpha"]),
            effectIds: Object.freeze([]),
            riskIds: Object.freeze(["risk.alpha"]),
            path: "src/alpha.ts",
            checkId: "check.alpha",
            allowNotApplicable: false,
            notApplicableCondition: null,
            fragmentDigest: sha256Bytes("fragment-alpha"),
          }),
          Object.freeze({
            id: "proposition.zeta",
            claim: "The exact result satisfies zeta.",
            evidenceKinds: Object.freeze(["analysis"]),
            evidenceArtifactIds: Object.freeze([]),
            obligationIds: Object.freeze(["obligation.zeta"]),
            effectIds: Object.freeze(["effect.zeta"]),
            riskIds: Object.freeze([]),
            path: null,
            checkId: null,
            allowNotApplicable: true,
            notApplicableCondition: "The admitted platform excludes zeta.",
            fragmentDigest: sha256Bytes("fragment-zeta"),
          }),
        ]),
      }),
    }),
  });
}

function storeFor(revisions: readonly ControlRecordRevision[], active: ControlRecordRevision): ControlRecordStore {
  const retained = new Map(revisions.map((value) => [`${value.recordId}\0${value.revision}`, value]));
  return {
    identity: Object.freeze({
      schema: CONTROL_RECORD_STORE_SCHEMA,
      storeId: "store-agent-context-v7",
      targetId: "target-agent-context-v7",
      processKind: "delivery",
      processId: PROCESS,
      createdAt: CREATED,
    }),
    getRevision(recordId: string, selectedRevision: number): ControlRecordRevision | null {
      return retained.get(`${recordId}\0${selectedRevision}`) ?? null;
    },
    state() {
      return Object.freeze({
        standing: "active" as const,
        candidateCondition: "ready-for-work" as const,
        activities: Object.freeze([]),
        subjects: Object.freeze({
          integrationAssessment: null,
          proposedBoundary: null,
          activeBoundary: Object.freeze({
            id: active.recordId,
            revision: active.revision,
            digest: active.digest,
          }),
          candidate: null,
          materialCondition: null,
          seal: null,
          evidence: null,
          closure: null,
        }),
        delegation: { admission: null, current: null, charged: { operations: 0, agentAttempts: 0, reservedCellWallTimeMs: 0 } },
        journal: Object.freeze({ eventCount: 0, headDigest: null }),
        eligibleOperations: Object.freeze([]),
      });
    },
  } as unknown as ControlRecordStore;
}

function projectionEvidenceSource(
  selected: ControlRecordRevision,
  overrides: Partial<FoundationProjectionSourceItem> = {},
): FoundationProjectionSourceItem {
  const kind = selected.recordKind as "check-receipt" | "agent-work-product";
  return Object.freeze({
    id: `source-${selected.recordId}`,
    itemDigest: sha256Bytes(`source-${selected.recordId}`),
    reference: `evidence:${kind}:${selected.recordId}`,
    revision: selected.digest,
    digest: selected.digest,
    authority: kind === "check-receipt" ? "runtime-authenticated-fact" : "agent-proposed-claim",
    semantic: Object.freeze({
      class: "evidence",
      subjectId: selected.recordId,
      subjectDigest: selected.digest,
      evidenceKind: kind,
    }),
    inclusionReasons: Object.freeze(["test-evidence-selection"]),
    presentationHint: "markdown",
    content: Object.freeze({
      mode: "inline",
      mediaType: "text/markdown",
      encoding: "utf-8",
      text: selected.semanticMarkdown,
      byteLength: Buffer.byteLength(selected.semanticMarkdown, "utf8"),
      digest: sha256Bytes(selected.semanticMarkdown),
    }),
    useLimit: null,
    ...overrides,
  });
}

test("agent context derives sorted exact Evidence bindings and their proof subjects", () => {
  const selectedBoundary = boundary();
  const attempt = revision({
    id: "agent-attempt-evidence",
    kind: "agent-attempt",
    payload: validDeliveryControlPayload("agent-attempt"),
  });
  const seal = revision({
    id: "candidate-seal-evidence",
    kind: "candidate-seal",
    payload: validDeliveryControlPayload("candidate-seal"),
  });
  const workProduct = revision({
    id: "agent-work-product-zeta",
    kind: "agent-work-product",
    authority: "agent-proposed",
    payload: Object.freeze({ schema: "lifecycle.agent-work-product-payload.v5" }),
    relationships: Object.freeze([relationship("result-of", attempt)]),
  });
  const receipt = revision({
    id: "check-receipt-alpha",
    kind: "check-receipt",
    authority: "runtime-observed",
    payload: validDeliveryControlPayload("check-receipt"),
    relationships: Object.freeze([relationship("checks-seal", seal)]),
  });
  const store = storeFor([selectedBoundary, attempt, seal, workProduct, receipt], selectedBoundary);

  const compiled = compileFoundationAgentEvidenceSetV7({
    store,
    revisions: Object.freeze([workProduct, receipt]),
  });
  assert.deepEqual(compiled.subject.items.map(({ id }) => id), [
    "agent-work-product-zeta",
    "check-receipt-alpha",
  ]);
  assert.deepEqual(compiled.subject.items.map(({ authorityClass }) => authorityClass), [
    "agent-proposed",
    "runtime-observed",
  ]);
  assert.equal(
    compiled.subject.items[0]!.subjectDigest,
    digestCanonical(relationship("result-of", attempt).target),
  );
  assert.equal(
    compiled.subject.items[1]!.subjectDigest,
    digestCanonical(relationship("checks-seal", seal).target),
  );
  assert.equal(compiled.digest, digestCanonical(compiled.subject));

  const empty = compileFoundationAgentEvidenceSetV7({ store, revisions: Object.freeze([]) });
  assert.deepEqual(empty.subject.items, []);
  assert.equal(empty.digest, digestCanonical(empty.subject));
});

test("agent context derives Evidence from exact Execution Projection sources", () => {
  const selectedBoundary = boundary();
  const attempt = revision({
    id: "agent-attempt-projected-evidence",
    kind: "agent-attempt",
    payload: validDeliveryControlPayload("agent-attempt"),
  });
  const workProduct = revision({
    id: "agent-work-product-projected-evidence",
    kind: "agent-work-product",
    authority: "agent-proposed",
    payload: Object.freeze({ schema: "lifecycle.agent-work-product-payload.v5" }),
    relationships: Object.freeze([relationship("result-of", attempt)]),
  });
  const store = storeFor([selectedBoundary, attempt, workProduct], selectedBoundary);
  const source = projectionEvidenceSource(workProduct);

  const compiled = compileFoundationAgentEvidenceSetFromProjectionSourcesV7({
    store,
    sources: Object.freeze([source]),
  });
  assert.deepEqual(compiled.subject.items.map(({ id }) => id), [workProduct.recordId]);

  assert.throws(
    () => compileFoundationAgentEvidenceSetFromProjectionSourcesV7({
      store,
      sources: Object.freeze([Object.freeze({
        ...source,
        semantic: Object.freeze({ ...source.semantic, subjectDigest: sha256Bytes("substituted") }),
      })]),
    }),
    /does not resolve one exact retained agent-work-product revision/u,
  );
  assert.throws(
    () => compileFoundationAgentEvidenceSetFromProjectionSourcesV7({
      store,
      sources: Object.freeze([source, source]),
    }),
    /repeats one Evidence Control identity/u,
  );
});

test("agent context derives the complete proposition set from the active Boundary", () => {
  const selectedBoundary = boundary();
  const store = storeFor([selectedBoundary], selectedBoundary);
  const compiled = compileFoundationReviewerPropositionSetV7({
    store,
    boundary: selectedBoundary,
  });

  assert.deepEqual(compiled.subject.propositions.map(({ id }) => id), [
    "proposition.alpha",
    "proposition.zeta",
  ]);
  assert.deepEqual(compiled.subject.propositions[0], {
    id: "proposition.alpha",
    claim: "The exact result satisfies alpha.",
    evidenceKinds: ["artifact", "check"],
    evidenceIds: ["artifact.alpha"],
    obligationIds: ["obligation.alpha"],
    effectIds: [],
    riskIds: ["risk.alpha"],
    path: "src/alpha.ts",
    checkId: "check.alpha",
    allowNotApplicable: false,
    notApplicableCondition: null,
  });
  assert.equal(compiled.digest, digestCanonical(compiled.subject));
});

test("agent context refuses substituted evidence and a noncurrent proposition source", () => {
  const selectedBoundary = boundary();
  const attempt = revision({
    id: "agent-attempt-substitution",
    kind: "agent-attempt",
    payload: validDeliveryControlPayload("agent-attempt"),
  });
  const workProduct = revision({
    id: "agent-work-product-substitution",
    kind: "agent-work-product",
    authority: "agent-proposed",
    payload: Object.freeze({ schema: "lifecycle.agent-work-product-payload.v5" }),
    relationships: Object.freeze([relationship("result-of", attempt)]),
  });
  const store = storeFor([selectedBoundary, attempt, workProduct], selectedBoundary);
  const substituted = Object.freeze({
    ...workProduct,
    semanticMarkdown: "# substituted\n",
  });
  assert.throws(
    () => compileFoundationAgentEvidenceSetV7({ store, revisions: Object.freeze([substituted]) }),
    /exact retained revision/u,
  );
  assert.throws(
    () => compileFoundationAgentEvidenceSetV7({ store, revisions: Object.freeze([workProduct, workProduct]) }),
    /repeats one Control identity/u,
  );

  const successor = revision({
    id: "work-boundary-agent-context-successor",
    kind: "work-boundary",
    payload: selectedBoundary.payload,
  });
  const noncurrentStore = storeFor([selectedBoundary], successor);
  assert.throws(
    () => compileFoundationReviewerPropositionSetV7({ store: noncurrentStore, boundary: selectedBoundary }),
    /exact active Work Boundary/u,
  );
});
