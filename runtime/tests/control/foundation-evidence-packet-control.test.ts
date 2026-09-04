import assert from "node:assert/strict";
import test from "node:test";
import {
  retainEvidencePacket,
  type EvidencePacketObservation,
} from "../../src/foundation/control/evidence-packet.js";
import {
  compileControlRecordEvent,
  compileControlRecordRevision,
} from "../../src/foundation/control/model.js";
import { assertDeliveryControlRecordPayload } from "../../src/foundation/control/payload-registry.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlJsonObject,
  type ControlRecordEvent,
  type ControlRecordRelationship,
  type ControlRecordRevision,
  type ControlRecordStoreAppend,
  type ControlRecordStoreIdentity,
} from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import type { ReducedDeliveryState } from "../../src/foundation/process/delivery-reducer.js";
import { sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

const PROCESS = "delivery-evidence-packet";
const ACTIVITY = "activity-evaluate";
const CREATED = "2026-08-29T18:00:00.000Z";
const EVALUATED = "2026-08-29T18:00:10.000Z";
const RUNTIME = "foundation-runtime";

function digest(value: string) {
  return sha256Bytes(value);
}

const identity: ControlRecordStoreIdentity = Object.freeze({
  schema: CONTROL_RECORD_STORE_SCHEMA,
  storeId: "store-evidence-packet",
  targetId: "target-evidence-packet",
  processKind: "delivery",
  processId: PROCESS,
  createdAt: CREATED,
});

function relation(relation: string, target: ControlRecordRevision): ControlRecordRelationship {
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
  authority?: "agent-proposed" | "runtime-observed" | "runtime-derived";
}>): ControlRecordRevision {
  const authority = input.authority ?? "runtime-derived";
  return compileControlRecordRevision(PROCESS, {
    recordId: input.id,
    recordKind: input.kind,
    revision: 1,
    producer: { kind: "runtime", id: RUNTIME },
    semanticAuthor: authority === "agent-proposed"
      ? { kind: "agent", id: "reviewer-agent" }
      : { kind: "runtime", id: RUNTIME },
    semanticAuthority: authority,
    createdAt: CREATED,
    semanticMarkdown: `# ${input.kind}\n`,
    payload: input.payload,
    relationships: input.relationships ?? [],
  });
}

function boundaryRevision(): ControlRecordRevision {
  return revision({
    id: "work-boundary-evidence",
    kind: "work-boundary",
    payload: Object.freeze({
      schema: "lifecycle.work-boundary-payload.v4",
      mandate: Object.freeze({
        checks: Object.freeze([Object.freeze({
          id: "selection.check.evidence",
          definition: Object.freeze({
            id: "check.evidence",
            revision: 1,
            sourceDigest: digest("check-source"),
            semanticDigest: digest("check-semantics"),
          }),
          bindings: Object.freeze([Object.freeze({
            id: "binding.check.evidence",
            digest: digest("binding"),
            implementationDigest: digest("binding-implementation"),
          })]),
          modality: "precondition",
          baselineRequired: true,
          finalRequired: true,
          obligationIds: Object.freeze(["obligation.evidence"]),
          environmentRequirements: Object.freeze([]),
        })]),
        obligations: Object.freeze([Object.freeze({
          id: "obligation.evidence",
          severity: "required",
          requiredEvidenceArtifactIds: Object.freeze(["artifact.evidence"]),
          propositionIds: Object.freeze(["proposition.evidence"]),
        })]),
        artifacts: Object.freeze([Object.freeze({
          id: "artifact.evidence",
          path: "src/evidence.ts",
          mustChange: true,
          obligationIds: Object.freeze(["obligation.evidence"]),
        })]),
        acceptancePropositions: Object.freeze([Object.freeze({
          id: "proposition.evidence",
          obligationIds: Object.freeze(["obligation.evidence"]),
          allowNotApplicable: false,
          notApplicableCondition: null,
        })]),
      }),
    }),
  });
}

function checkRevision(input: Readonly<{
  id: string;
  phase: "baseline" | "final";
  subject: ControlRecordRevision;
}>): ControlRecordRevision {
  return revision({
    id: input.id,
    kind: "check-receipt",
    authority: "runtime-observed",
    payload: Object.freeze({
      schema: "lifecycle.check-receipt-payload.v2",
      selectionId: "selection.check.evidence",
      definition: Object.freeze({
        id: "check.evidence",
        revision: 1,
        sourceDigest: digest("check-source"),
        semanticDigest: digest("check-semantics"),
      }),
      binding: Object.freeze({
        id: "binding.check.evidence",
        digest: digest("binding"),
        implementationDigest: digest("binding-implementation"),
      }),
      phase: input.phase,
      modality: "precondition",
      finishedAt: input.phase === "baseline"
        ? "2026-08-29T18:00:01.000Z"
        : "2026-08-29T18:00:08.000Z",
      environment: Object.freeze({ requested: Object.freeze([]) }),
      disposition: "pass",
    }),
    relationships: [relation(
      input.phase === "baseline" ? "checks-boundary" : "checks-seal",
      input.subject,
    )],
  });
}

function fixture(input: Readonly<{
  includeSealBinding?: boolean;
  includeFinalCheck?: boolean;
  inspectedSubjectIds?: readonly string[];
  materialCondition?: boolean;
}> = {}) {
  const boundary = boundaryRevision();
  const candidate = revision({
    id: "candidate-evidence",
    kind: "candidate-revision",
    authority: "runtime-observed",
    payload: validDeliveryControlPayload("candidate-revision"),
    relationships: [relation("governed-by", boundary)],
  });
  const seal = revision({
    id: "candidate-seal-evidence",
    kind: "candidate-seal",
    authority: "runtime-observed",
    payload: validDeliveryControlPayload("candidate-seal"),
    relationships: [relation("governed-by", boundary), relation("seals", candidate)],
  });
  const brief = revision({
    id: "founder-brief-evidence",
    kind: "founder-brief",
    payload: Object.freeze({ schema: "lifecycle.founder-brief-payload.v1" }),
  });
  const attempt = revision({
    id: "agent-attempt-review",
    kind: "agent-attempt",
    payload: Object.freeze({
      ...validDeliveryControlPayload("agent-attempt"),
      activityId: ACTIVITY,
      operation: "delivery.evaluate",
      role: "reviewer",
      projection: Object.freeze({ digest: digest("review-projection") }),
      capability: Object.freeze({ profileDigest: digest("review-capability") }),
      input: Object.freeze({
        evidenceSetDigest: digest("evidence-set"),
        propositionSetDigest: digest("proposition-set"),
      }),
    }),
    relationships: [
      relation("uses-brief", brief),
      relation("uses-boundary", boundary),
      relation("uses-candidate", candidate),
      ...(input.includeSealBinding === false ? [] : [relation("uses-seal", seal)]),
    ],
  });
  const finalCheck = checkRevision({ id: "check-receipt-final", phase: "final", subject: seal });
  const workProduct = revision({
    id: "agent-work-product-review",
    kind: "agent-work-product",
    authority: "agent-proposed",
    payload: Object.freeze({
      schema: "lifecycle.agent-work-product-payload.v2",
      role: "reviewer",
      uncertainty: Object.freeze({ level: "none" }),
      citations: Object.freeze([Object.freeze({
        id: "citation.final-check",
        subjectId: finalCheck.recordId,
      })]),
      roleSemantics: Object.freeze({
        role: "reviewer",
        judgments: Object.freeze([Object.freeze({
          id: "judgment.evidence",
          propositionId: "proposition.evidence",
          disposition: "accepted",
          citationIds: Object.freeze(["citation.final-check"]),
          inspectedSubjectIds: Object.freeze(input.inspectedSubjectIds ?? [finalCheck.recordId]),
          uncertainty: "none",
          limitationIds: Object.freeze([]),
          fragmentDigest: digest("review-fragment"),
        })]),
        mandateExcess: false,
        missingObligationIds: Object.freeze([]),
        conditions: Object.freeze([]),
      }),
    }),
    relationships: [relation("result-of", attempt)],
  });
  const executionReceipt = revision({
    id: "execution-receipt-review",
    kind: "execution-receipt",
    authority: "runtime-observed",
    payload: Object.freeze({
      ...validDeliveryControlPayload("execution-receipt"),
      activityId: ACTIVITY,
      productiveExecutionStarted: true,
      providerEffect: Object.freeze({ outcome: "completed" }),
      provider: Object.freeze({ sessionId: "provider-session-review" }),
      execution: Object.freeze({
        ...((validDeliveryControlPayload("execution-receipt").execution) as ControlJsonObject),
        output: Object.freeze({
          availability: "retrieved",
          carrierByteLength: 64,
          carrierDigest: digest("review-output-carrier"),
          manifestDigest: digest("review-output-manifest"),
        }),
      }),
      workspace: Object.freeze({
        availability: "available",
        parserDisposition: "valid",
        compilerDisposition: "retained",
        rawByteLength: 64,
        workspaceRawDigest: digest("review-workspace"),
        semanticMarkdownDigest: digest("review-semantic"),
        parseResultDigest: digest("review-parse"),
        failureFactsDigest: null,
        submissionDiagnostic: null,
        fixedBindingSubjectDigest: digest("review-bindings"),
      }),
      workProduct: Object.freeze({
        disposition: "submitted",
        reference: Object.freeze({
          kind: "agent-work-product",
          id: workProduct.recordId,
          revision: workProduct.revision,
          digest: workProduct.digest,
        }),
      }),
      candidate: Object.freeze({
        input: Object.freeze({
          revision: Object.freeze({
            kind: "candidate-revision",
            id: candidate.recordId,
            revision: candidate.revision,
            digest: candidate.digest,
          }),
          carrierManifestDigest: digest("candidate-carrier-manifest"),
        }),
        successorDisposition: null,
        successor: null,
        contentDisposition: null,
      }),
      containment: Object.freeze({ classification: "contained", factsDigest: digest("review-containment") }),
      retirement: Object.freeze({ classification: "retired", factsDigest: digest("review-retirement") }),
    }),
    relationships: [
      relation("observes-attempt", attempt),
      relation("observes-work-product", workProduct),
    ],
  });
  const baselineCheck = checkRevision({
    id: "check-receipt-baseline",
    phase: "baseline",
    subject: boundary,
  });
  const material = input.materialCondition === true
    ? revision({
      id: "material-condition-evidence",
      kind: "material-condition",
      payload: Object.freeze({
        schema: "lifecycle.material-condition-payload.v1",
        source: Object.freeze({
          kind: "agent-proposal",
          conditionId: "condition.material",
          fragmentDigest: digest("condition.material"),
        }),
        observedFactsDigest: digest("evidence-material-condition-facts"),
      }),
      relationships: [
        relation("reported-by", workProduct),
        relation("observed-in", executionReceipt),
        relation("freezes", candidate),
        relation("governed-by", boundary),
      ],
    })
    : null;
  const revisions = new Map<string, ControlRecordRevision>();
  for (const value of [boundary, candidate, seal, brief, attempt, finalCheck, workProduct, executionReceipt, baselineCheck, material]) {
    if (value !== null) revisions.set(`${value.recordId}\u0000${value.revision}`, value);
  }

  const eventInputs = [
    { kind: "delivery-created", activityId: null, subject: null as ControlRecordRevision | null },
    { kind: "check-receipt-recorded", activityId: "activity-prepare", subject: baselineCheck },
    { kind: "agent-attempt-prepared", activityId: ACTIVITY, subject: attempt },
    { kind: "agent-work-product-submitted", activityId: ACTIVITY, subject: workProduct },
    { kind: "execution-receipt-recorded", activityId: ACTIVITY, subject: executionReceipt },
    { kind: "candidate-sealed", activityId: ACTIVITY, subject: seal },
    ...(input.includeFinalCheck === false
      ? []
      : [{ kind: "check-receipt-recorded", activityId: ACTIVITY, subject: finalCheck }]),
    ...(material === null
      ? []
      : [{ kind: "material-condition-frozen", activityId: ACTIVITY, subject: material }]),
  ];
  const events: ControlRecordEvent[] = [];
  let predecessorDigest = null as ReturnType<typeof digest> | null;
  for (const [index, value] of eventInputs.entries()) {
    const event = compileControlRecordEvent({
      storeId: identity.storeId,
      processId: identity.processId,
      sequence: index + 1,
      predecessorDigest,
      event: {
        eventId: `event-${value.kind}-${index + 1}`,
        eventKind: value.kind,
        occurredAt: `2026-08-29T18:00:0${index}.000Z`,
        actor: { kind: "runtime", id: RUNTIME },
        subject: value.subject === null ? null : {
          recordId: value.subject.recordId,
          revision: value.subject.revision,
          digest: value.subject.digest,
        },
        payload: value.kind === "material-condition-frozen"
          ? {
              sourceKind: "agent-proposal",
              activityId: value.activityId,
              observedFactsDigest: value.subject!.payload.observedFactsDigest!,
            }
          : value.activityId === null ? {} : { activityId: value.activityId },
      },
    });
    predecessorDigest = event.digest;
    events.push(event);
  }
  const subjects = Object.freeze({
    proposedBoundary: null,
    activeBoundary: Object.freeze({ id: boundary.recordId, revision: 1, digest: boundary.digest }),
    candidate: Object.freeze({ id: candidate.recordId, revision: 1, digest: candidate.digest }),
    materialCondition: material === null ? null : Object.freeze({ id: material.recordId, revision: 1, digest: material.digest }),
    seal: Object.freeze({ id: seal.recordId, revision: 1, digest: seal.digest }),
    evidence: null,
    closure: null,
  });
  const state: ReducedDeliveryState = Object.freeze({
    standing: material === null ? "active" : "boundary-paused",
    candidateCondition: material === null ? "sealed-under-evaluation" : "paused-for-boundary",
    activities: Object.freeze([Object.freeze({
      id: ACTIVITY,
      operation: "delivery.evaluate" as const,
      family: "agent" as const,
      stage: "finalizing" as const,
      recovery: Object.freeze({
        kind: "finalization" as const,
        resumesAt: "activity-finalization" as const,
        exactEffectDigest: null,
      }),
    })]),
    subjects,
    journal: Object.freeze({
      eventCount: events.length,
      headDigest: events.at(-1)!.digest,
    }),
    eligibleOperations: Object.freeze(["delivery.recover"] as const),
  });
  const appended: ControlRecordStoreAppend[] = [];
  const store = {
    identity,
    state: () => state,
    listEvents(afterSequence = 0, limit = 10_000) {
      return events.filter(({ sequence }) => sequence > afterSequence).slice(0, limit);
    },
    getRevision(recordId: string, revisionNumber: number) {
      return revisions.get(`${recordId}\u0000${revisionNumber}`) ?? null;
    },
    append(value: ControlRecordStoreAppend) {
      appended.push(value);
      const retainedRevision = value.revision === undefined
        ? null
        : compileControlRecordRevision(identity.processId, value.revision);
      const event = compileControlRecordEvent({
        storeId: identity.storeId,
        processId: identity.processId,
        sequence: events.length + 1,
        predecessorDigest: events.at(-1)?.digest ?? null,
        event: value.event,
      });
      return Object.freeze({ revision: retainedRevision, event });
    },
  } as unknown as ControlRecordStore;
  return Object.freeze({ store, appended });
}

const observation: EvidencePacketObservation = Object.freeze({
  evaluatedAt: EVALUATED,
  artifacts: Object.freeze([Object.freeze({
    artifactId: "artifact.evidence",
    fileKind: "file",
    existence: "present",
    change: "modified",
    contentDigest: digest("artifact-content"),
    manifestDigest: null,
    schemaValidation: "not-required",
    semanticValidation: "valid",
    state: "satisfied",
  })]),
  descriptionCoverage: Object.freeze([]),
  reviewerSubjectDisposition: "exact-read-only",
  ruleSet: Object.freeze({ id: "rules.evidence", digest: digest("evidence-rules") }),
  validator: Object.freeze({ id: "runtime.evidence-validator", digest: digest("evidence-validator") }),
});

test("Evidence Packet compiler derives the complete exact evaluation join and readiness", () => {
  const firstFixture = fixture();
  const first = retainEvidencePacket({
    store: firstFixture.store,
    activityId: ACTIVITY,
    observation,
    runtimeId: RUNTIME,
  });
  const second = retainEvidencePacket({
    store: fixture().store,
    activityId: ACTIVITY,
    observation,
    runtimeId: RUNTIME,
  });

  assert.equal(first.revision.recordKind, "evidence-packet");
  assert.equal(first.revision.semanticAuthority, "runtime-derived");
  assert.equal(first.revision.payload.readiness, "acceptance-ready");
  assert.equal(first.revision.recordId, second.revision.recordId);
  assert.equal(first.revision.digest, second.revision.digest);
  assert.equal(first.event.eventId, second.event.eventId);
  assert.equal(first.event.eventKind, "evidence-packet-finalized");
  assert.deepEqual(first.event.payload, { activityId: ACTIVITY });
  assert.deepEqual(
    first.revision.relationships.map(({ relation }) => relation),
    ["evaluates", "governed-by", "uses-check", "uses-check", "uses-review", "uses-review-receipt", "uses-seal"],
  );
  assert.equal((first.revision.payload.receiptUse as readonly unknown[]).length, 2);
  assert.equal((first.revision.payload.propositionDecisions as readonly unknown[]).length, 1);
  assert.equal((first.revision.payload.obligations as readonly ControlJsonObject[])[0]!.state, "satisfied");
  assert.equal(firstFixture.appended.length, 1);
  assertDeliveryControlRecordPayload(first.revision);
});

test("Evidence Packet compiler refuses a reviewer Attempt without the exact Seal binding", () => {
  const value = fixture({ includeSealBinding: false });
  assert.throws(
    () => retainEvidencePacket({ store: value.store, activityId: ACTIVITY, observation, runtimeId: RUNTIME }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.control-evidence-packet.relationship",
  );
  assert.equal(value.appended.length, 0);
});

test("Evidence Packet compiler independently rederives inspected subjects from citations", () => {
  const value = fixture({ inspectedSubjectIds: ["candidate-evidence"] });
  assert.throws(
    () => retainEvidencePacket({ store: value.store, activityId: ACTIVITY, observation, runtimeId: RUNTIME }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.control-evidence-packet.review",
  );
  assert.equal(value.appended.length, 0);
});

test("Evidence Packet compiler retains incomplete Check coverage as correctable truth", () => {
  const value = retainEvidencePacket({
    store: fixture({ includeFinalCheck: false }).store,
    activityId: ACTIVITY,
    observation,
    runtimeId: RUNTIME,
  });
  assert.equal(value.revision.payload.readiness, "correctable");
  const receiptUse = value.revision.payload.receiptUse as readonly ControlJsonObject[];
  const missing = receiptUse.find((entry) => entry.phase === "final");
  assert.equal(missing?.use, "missing");
  assert.equal(missing?.receiptId, null);
});

test("Evidence Packet compiler derives revision-required only from retained material truth", () => {
  const value = retainEvidencePacket({
    store: fixture({ materialCondition: true }).store,
    activityId: ACTIVITY,
    observation,
    runtimeId: RUNTIME,
  });
  assert.equal(value.revision.payload.readiness, "revision-required");
});
