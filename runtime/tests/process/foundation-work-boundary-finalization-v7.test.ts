import assert from "node:assert/strict";
import test from "node:test";
import {
  compileControlRecordEvent,
  compileControlRecordRevision,
} from "../../src/foundation/control/model.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlJsonObject,
  type ControlRecordEvent,
  type ControlRecordRelationship,
  type ControlRecordRevision,
  type ControlRecordRevisionInput,
  type ControlRecordStoreAppend,
} from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import type {
  FoundationAgentRoleControlContextV7,
  FoundationAgentRoleCheckpointAdapterV7,
  FoundationPreparationAgentRoleControlContextV7,
} from "../../src/foundation/process/agent-operation-v7.js";
import type { ReducedDeliveryState } from "../../src/foundation/process/delivery-reducer.js";
import {
  finalizeFoundationInitialWorkBoundaryV7,
  finalizeFoundationWorkBoundaryResolutionV7,
  type FoundationWorkBoundaryFinalizationBasisV7,
  type FoundationWorkBoundaryFinalizationV7Options,
} from "../../src/foundation/process/work-boundary-finalization-v7.js";
import type { FoundationCheckBinding } from "../../src/foundation/repository/types.js";
import {
  digestCanonical,
  sha256Bytes,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";
import { minimalResolvedAtlas } from "../helpers/atlas-fixture.js";

const CREATED = "2026-08-29T21:00:00.000Z";
const RECORDED = "2026-08-29T21:00:03.000Z";
const TARGET = "target-work-boundary-finalization-v7";
const DELIVERY = "delivery-work-boundary-finalization-v7";
const RUNTIME = "foundation-runtime";
const FOUNDER = "founder.fixture";
const AGENT = "agent.fixture";
const ACTIVITY = "activity-resolution-v7";
const SELECTION = "selection.check.demo";
const BINDING = "binding.check.demo";
const CHECK_KNOWLEDGE = "check.demo";
const COMMIT = "b".repeat(40);
const TREE = "c".repeat(40);

function digest(value: string): Sha256 {
  return sha256Bytes(`foundation-work-boundary-finalization-v7:${value}`);
}

const binding: FoundationCheckBinding = Object.freeze({
  id: BINDING,
  checkIds: Object.freeze([CHECK_KNOWLEDGE]),
  subjectSelectors: Object.freeze([Object.freeze({ kind: "repository" as const, selector: "." })]),
  kind: "command",
  executable: Object.freeze({ relativeTo: "execution-image", path: "node" }),
  args: Object.freeze(["--version"]),
  cwd: ".",
  network: "none",
  timeoutMs: 1_000,
  allowedModalities: Object.freeze(["precondition" as const, "postcondition" as const]),
  capabilityProfileId: null,
  environment: Object.freeze({}),
  resultParser: Object.freeze({
    id: "exit-code-v1",
    stateModel: "check-disposition-v2",
    states: Object.freeze([
      "pass", "fail", "indeterminate", "not-run", "unsupported", "operational-error",
    ] as const),
  }),
  mutation: "forbidden",
  implementationDigest: "sha256:6666666666666666666666666666666666666666666666666666666666666666",
  limitations: Object.freeze([]),
  digest: "sha256:5555555555555555555555555555555555555555555555555555555555555555",
});

function target(revision: ControlRecordRevision) {
  return Object.freeze({
    kind: revision.recordKind,
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function stateReference(revision: ControlRecordRevision) {
  return Object.freeze({ id: revision.recordId, revision: revision.revision, digest: revision.digest });
}

function relationship(relation: string, revision: ControlRecordRevision): ControlRecordRelationship {
  return Object.freeze({ relation, target: target(revision) });
}

function revision(input: Readonly<{
  id: string;
  kind: string;
  number?: number;
  payload: ControlJsonObject;
  relationships?: readonly ControlRecordRelationship[];
  author?: "runtime" | "founder" | "agent";
  authority?: "runtime-derived" | "runtime-observed" | "founder-supplied" | "agent-proposed";
}>): ControlRecordRevision {
  const author = input.author ?? "runtime";
  return compileControlRecordRevision(DELIVERY, {
    recordId: input.id,
    recordKind: input.kind,
    revision: input.number ?? 1,
    producer: { kind: "runtime", id: RUNTIME },
    semanticAuthor: { kind: author, id: author === "runtime" ? RUNTIME : author === "founder" ? FOUNDER : AGENT },
    semanticAuthority: input.authority ?? "runtime-derived",
    createdAt: CREATED,
    semanticMarkdown: `# ${input.kind}\n`,
    payload: input.payload,
    relationships: input.relationships ?? [],
  });
}

type Operation = "delivery.revise" | "delivery.reaffirm";

function fixture(
  operation: Operation,
  options: Readonly<{
    baselineBindingIds?: readonly string[];
    baselineModality?: "precondition" | "postcondition";
  }> = {},
): Readonly<{
  store: ControlRecordStore;
  context: FoundationAgentRoleControlContextV7;
  basis: FoundationWorkBoundaryFinalizationBasisV7;
  activeBoundary: ControlRecordRevision;
  condition: ControlRecordRevision;
  candidate: ControlRecordRevision;
  append(append: ControlRecordStoreAppend): Readonly<{ revision: ControlRecordRevision | null; event: ControlRecordEvent }>;
  coordinate(): string;
}> {
  const identity = Object.freeze({
    schema: CONTROL_RECORD_STORE_SCHEMA,
    storeId: "store-work-boundary-finalization-v7",
    targetId: TARGET,
    processKind: "delivery" as const,
    processId: DELIVERY,
    createdAt: CREATED,
  });
  const boundaryPayload = validDeliveryControlPayload("work-boundary");
  const baselineModality = options.baselineModality ?? "postcondition";
  const boundaryMandate = boundaryPayload.mandate as ControlJsonObject;
  const activeBoundary = revision({
    id: "work-boundary-resolution-v7",
    kind: "work-boundary",
    payload: Object.freeze({
      ...boundaryPayload,
      targetId: TARGET,
      mandate: Object.freeze({
        ...boundaryMandate,
        checks: Object.freeze((boundaryMandate.checks as readonly ControlJsonObject[]).map(
          (check, index) => index === 0 ? Object.freeze({ ...check, modality: baselineModality }) : check,
        )),
      }),
    }),
  });
  const candidate = revision({
    id: "candidate-resolution-v7",
    kind: "candidate-revision",
    payload: validDeliveryControlPayload("candidate-revision"),
    relationships: Object.freeze([relationship("governed-by", activeBoundary)]),
    authority: "runtime-observed",
  });
  const condition = revision({
    id: "condition-resolution-v7",
    kind: "material-condition",
    payload: validDeliveryControlPayload("material-condition"),
    relationships: Object.freeze([
      relationship("freezes", candidate),
      relationship("governed-by", activeBoundary),
    ]),
  });
  const briefPayload = validDeliveryControlPayload("founder-brief");
  const brief = revision({
    id: "brief-resolution-v7",
    kind: "founder-brief",
    payload: Object.freeze({ ...briefPayload, inputProfile: operation }),
    author: "founder",
    authority: "founder-supplied",
  });
  const projectionDigest = digest("projection");
  const capabilityDigest = activeBoundary.payload.capabilityProfile as ControlJsonObject;
  const attemptPayload = validDeliveryControlPayload("agent-attempt");
  const attempt = revision({
    id: "attempt-resolution-v7",
    kind: "agent-attempt",
    payload: Object.freeze({
      ...attemptPayload,
      activityId: ACTIVITY,
      operation,
      role: "reconnaissance",
      projection: Object.freeze({
        id: "projection-resolution-v7",
        profileId: "orientation-standard-v1",
        digest: projectionDigest,
      }),
      capability: Object.freeze({
        ...(attemptPayload.capability as ControlJsonObject),
        profileId: String(capabilityDigest.id),
        profileDigest: capabilityDigest.digest!,
      }),
    }),
    relationships: Object.freeze([
      relationship("uses-brief", brief),
      relationship("uses-boundary", activeBoundary),
      relationship("uses-candidate", candidate),
    ]),
  });
  const workProduct = revision({
    id: "work-product-resolution-v7",
    kind: "agent-work-product",
    payload: Object.freeze({
      schema: "lifecycle.agent-work-product-payload.v2",
      role: "reconnaissance",
      roleSemantics: Object.freeze({
        workBoundary: Object.freeze({
          artifacts: Object.freeze([]),
          effects: Object.freeze([]),
          checks: Object.freeze([Object.freeze({
            id: SELECTION,
            checkKnowledgeId: CHECK_KNOWLEDGE,
            bindingIds: Object.freeze([...(options.baselineBindingIds ?? [BINDING])]),
            modality: baselineModality,
            baselineRequired: true,
          })]),
        }),
      }),
    }),
    relationships: Object.freeze([relationship("result-of", attempt)]),
    author: "agent",
    authority: "agent-proposed",
  });
  const receiptPayload = validDeliveryControlPayload("execution-receipt");
  const receipt = revision({
    id: "receipt-resolution-v7",
    kind: "execution-receipt",
    payload: Object.freeze({
      ...receiptPayload,
      activityId: ACTIVITY,
    }),
    relationships: Object.freeze([
      relationship("observes-attempt", attempt),
      relationship("observes-work-product", workProduct),
    ]),
    authority: "runtime-observed",
  });

  const revisions = new Map<string, ControlRecordRevision>();
  for (const selected of [activeBoundary, candidate, condition, brief, attempt, workProduct, receipt]) {
    revisions.set(`${selected.recordId}\0${selected.revision}`, selected);
  }
  const events: ControlRecordEvent[] = [];
  let predecessorDigest: Sha256 | null = null;
  let resumeAt = "work-boundary-finalized";
  const append = (input: ControlRecordStoreAppend) => {
    const retained = input.revision === undefined
      ? null
      : compileControlRecordRevision(DELIVERY, input.revision);
    if (retained !== null) revisions.set(`${retained.recordId}\0${retained.revision}`, retained);
    const event = compileControlRecordEvent({
      storeId: identity.storeId,
      processId: DELIVERY,
      sequence: events.length + 1,
      predecessorDigest,
      event: input.event,
    });
    predecessorDigest = event.digest;
    events.push(event);
    if (event.eventKind === "work-boundary-finalized") resumeAt = "baseline-checks";
    if (event.eventKind === "check-receipt-recorded") resumeAt = "activity-completed";
    return Object.freeze({ revision: retained, event });
  };
  const state = (): ReducedDeliveryState => Object.freeze({
    standing: "boundary-paused",
    candidateCondition: "paused-for-boundary",
    activities: Object.freeze([Object.freeze({
      id: ACTIVITY,
      operation,
      family: "agent" as const,
      stage: "finalizing" as const,
      recovery: Object.freeze({
        kind: "finalization" as const,
        resumesAt: resumeAt as "work-boundary-finalized" | "baseline-checks" | "activity-completed",
        exactEffectDigest: null,
      }),
    })]),
    subjects: Object.freeze({
      proposedBoundary: null,
      activeBoundary: stateReference(activeBoundary),
      candidate: stateReference(candidate),
      materialCondition: stateReference(condition),
      seal: null,
      evidence: null,
      closure: null,
    }),
    journal: Object.freeze({ eventCount: events.length, headDigest: predecessorDigest }),
    eligibleOperations: Object.freeze([]),
  });
  const store = {
    identity,
    paths: Object.freeze({ root: "/store", database: "/store/db", files: "/store/files", drafts: "/store/drafts" }),
    state,
    getRevision(recordId: string, selectedRevision: number) {
      return revisions.get(`${recordId}\0${selectedRevision}`) ?? null;
    },
    listEvents(afterSequence = 0, limit = 1_000) {
      return Object.freeze(events.filter(({ sequence }) => sequence > afterSequence).slice(0, limit));
    },
    append,
  } as unknown as ControlRecordStore;

  let checkpoint: ControlJsonObject | null = null;
  let generation = 1;
  let payloadDigest = digestCanonical(Object.freeze({ checkpoint }));
  type Step = Parameters<FoundationAgentRoleCheckpointAdapterV7["step"]>[0];
  const current = () => Object.freeze({
    coordinate: Object.freeze({ generation, payloadDigest }),
    checkpoint,
  });
  const support = Object.freeze({
    current,
    async step(update: Step) {
      assert.deepEqual(update.expected, { generation, payloadDigest });
      const retained = update.mode === "checkpoint" ? null : append(update.append);
      checkpoint = update.checkpoint;
      generation += 1;
      payloadDigest = digestCanonical(Object.freeze({ checkpoint }));
      return Object.freeze({ view: current(), append: retained, files: Object.freeze([]) });
    },
  }) as unknown as FoundationAgentRoleCheckpointAdapterV7;

  const contractDigest = digest("contract");
  const knowledgeDigest = digest("knowledge-set");
  const productDigest = digest("product-state");
  const atlasDigest = digest("atlas-state");
  const atlas = minimalResolvedAtlas(atlasDigest);
  const snapshotDigest = digest("snapshot");
  const executionProjectionDigest = digest("execution-projection");
  const basis = Object.freeze({
    snapshot: Object.freeze({
      repository: "/target",
      contract: Object.freeze({
        targetId: TARGET,
        digest: contractDigest,
        defaults: Object.freeze({ executionProjectionProfileId: "execution-standard-v1" }),
        projectionProfiles: Object.freeze({
          "execution-standard-v1": Object.freeze({ id: "execution-standard-v1", digest: executionProjectionDigest }),
        }),
        capabilityProfiles: Object.freeze({
          [String(capabilityDigest.id)]: Object.freeze({
            id: String(capabilityDigest.id),
            digest: capabilityDigest.digest,
          }),
        }),
        checkBindings: Object.freeze({ [BINDING]: binding }),
      }),
      snapshot: Object.freeze({
        targetId: TARGET,
        contractDigest,
        knowledgeSetDigest: knowledgeDigest,
        productStateDigest: productDigest,
        atlasStateDigest: atlasDigest,
        atlasResolutionDigest: atlas.resolution.digest,
        atlasNormalizedModelDigest: atlas.resolution.normalizedModelDigest,
        atlasResourceBindingsDigest: atlas.resolution.resourceBindingsDigest,
        digest: snapshotDigest,
      }),
      epoch: Object.freeze({ commit: COMMIT, tree: TREE }),
      productState: Object.freeze({ digest: productDigest }),
      atlasState: Object.freeze({ digest: atlasDigest }),
      atlas,
    }),
    knowledge: Object.freeze({
      repository: Object.freeze({
        contract: Object.freeze({ targetId: TARGET, digest: contractDigest }),
        commit: COMMIT,
        tree: TREE,
      }),
      manifest: Object.freeze({
        digest: knowledgeDigest,
        repository: Object.freeze({ contractDigest, commit: COMMIT, tree: TREE }),
        complete: true,
        valid: true,
      }),
      validation: Object.freeze({ complete: true, valid: true }),
      currentRecords: Object.freeze([Object.freeze({
        frontMatter: Object.freeze({ id: CHECK_KNOWLEDGE, revision: 1 }),
        sourceDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        semanticDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      })]),
    }),
    projection: Object.freeze({
      manifest: Object.freeze({
        class: "orientation",
        role: "reconnaissance",
        digest: projectionDigest,
        projectionId: "projection-resolution-v7",
        profile: "orientation-standard-v1",
        basis: Object.freeze({
          target: Object.freeze({ id: TARGET }),
          commit: COMMIT,
          tree: TREE,
          productStateDigest: productDigest,
          repositoryContractDigest: contractDigest,
          knowledgeSetDigest: knowledgeDigest,
          atlas: Object.freeze({
            stateDigest: atlasDigest,
            resolutionDigest: atlas.resolution.digest,
            normalizedModelDigest: atlas.resolution.normalizedModelDigest,
            resourceBindingsDigest: atlas.resolution.resourceBindingsDigest,
          }),
        }),
        sources: Object.freeze([]),
      }),
    }),
  }) as unknown as FoundationWorkBoundaryFinalizationBasisV7;

  return Object.freeze({
    store,
    context: Object.freeze({
      store,
      activityId: ACTIVITY,
      operation,
      role: "reconnaissance",
      brief,
      attempt,
      boundary: activeBoundary,
      attemptedCandidate: candidate,
      resultCandidate: candidate,
      seal: null,
      workProduct,
      receipt,
      support,
    }),
    basis,
    activeBoundary,
    condition,
    candidate,
    append,
    coordinate: () => resumeAt,
  });
}

function initialFixture(
  options: Readonly<{
    baselineBindingIds?: readonly string[];
    baselineModality?: "precondition" | "postcondition";
    effects?: readonly ControlJsonObject[];
    loseCheckReceiptReturnOnce?: boolean;
  }> = {},
): Readonly<{
  store: ControlRecordStore;
  context: FoundationPreparationAgentRoleControlContextV7;
  basis: FoundationWorkBoundaryFinalizationBasisV7;
  append(append: ControlRecordStoreAppend): Readonly<{
    revision: ControlRecordRevision | null;
    event: ControlRecordEvent;
  }>;
  coordinate(): string;
}> {
  const identity = Object.freeze({
    schema: CONTROL_RECORD_STORE_SCHEMA,
    storeId: "store-initial-work-boundary-finalization-v7",
    targetId: TARGET,
    processKind: "delivery" as const,
    processId: DELIVERY,
    createdAt: CREATED,
  });
  const briefPayload = validDeliveryControlPayload("founder-brief");
  const brief = revision({
    id: "brief-initial-v7",
    kind: "founder-brief",
    payload: Object.freeze({ ...briefPayload, inputProfile: "delivery.prepare" }),
    author: "founder",
    authority: "founder-supplied",
  });
  const projectionDigest = digest("initial-projection");
  const boundaryPayload = validDeliveryControlPayload("work-boundary");
  const capability = boundaryPayload.capabilityProfile as ControlJsonObject;
  const attemptPayload = validDeliveryControlPayload("agent-attempt");
  const attempt = revision({
    id: "attempt-initial-v7",
    kind: "agent-attempt",
    payload: Object.freeze({
      ...attemptPayload,
      activityId: ACTIVITY,
      operation: "delivery.prepare",
      role: "reconnaissance",
      projection: Object.freeze({
        id: "projection-initial-v7",
        profileId: "orientation-standard-v1",
        digest: projectionDigest,
      }),
      capability: Object.freeze({
        ...(attemptPayload.capability as ControlJsonObject),
        profileId: String(capability.id),
        profileDigest: capability.digest!,
      }),
    }),
    relationships: Object.freeze([relationship("uses-brief", brief)]),
  });
  const workProduct = revision({
    id: "work-product-initial-v7",
    kind: "agent-work-product",
    payload: Object.freeze({
      schema: "lifecycle.agent-work-product-payload.v2",
      role: "reconnaissance",
      roleSemantics: Object.freeze({
        workBoundary: Object.freeze({
          artifacts: Object.freeze([]),
          effects: Object.freeze([...(options.effects ?? [])]),
          checks: Object.freeze([Object.freeze({
            id: SELECTION,
            checkKnowledgeId: CHECK_KNOWLEDGE,
            bindingIds: Object.freeze([...(options.baselineBindingIds ?? [BINDING])]),
            modality: options.baselineModality ?? "postcondition",
            baselineRequired: true,
          })]),
        }),
      }),
    }),
    relationships: Object.freeze([relationship("result-of", attempt)]),
    author: "agent",
    authority: "agent-proposed",
  });
  const receiptPayload = validDeliveryControlPayload("execution-receipt");
  const receipt = revision({
    id: "receipt-initial-v7",
    kind: "execution-receipt",
    payload: Object.freeze({
      ...receiptPayload,
      activityId: ACTIVITY,
    }),
    relationships: Object.freeze([
      relationship("observes-attempt", attempt),
      relationship("observes-work-product", workProduct),
    ]),
    authority: "runtime-observed",
  });
  const revisions = new Map<string, ControlRecordRevision>();
  for (const selected of [brief, attempt, workProduct, receipt]) {
    revisions.set(`${selected.recordId}\0${selected.revision}`, selected);
  }
  const events: ControlRecordEvent[] = [];
  let predecessorDigest: Sha256 | null = null;
  let resumeAt = "work-boundary-finalized";
  const append = (input: ControlRecordStoreAppend) => {
    const retained = input.revision === undefined
      ? null
      : compileControlRecordRevision(DELIVERY, input.revision);
    if (retained !== null) revisions.set(`${retained.recordId}\0${retained.revision}`, retained);
    const event = compileControlRecordEvent({
      storeId: identity.storeId,
      processId: DELIVERY,
      sequence: events.length + 1,
      predecessorDigest,
      event: input.event,
    });
    predecessorDigest = event.digest;
    events.push(event);
    if (event.eventKind === "work-boundary-finalized") {
      if (retained === null || retained.recordKind !== "work-boundary") {
        throw new Error("Initial Work Boundary event must retain its exact revision");
      }
      resumeAt = "baseline-checks";
    }
    if (event.eventKind === "check-receipt-recorded") resumeAt = "activity-completed";
    return Object.freeze({ revision: retained, event });
  };
  const state = (): ReducedDeliveryState => Object.freeze({
    standing: "framing",
    candidateCondition: "absent",
    activities: Object.freeze([Object.freeze({
      id: ACTIVITY,
      operation: "delivery.prepare" as const,
      family: "agent" as const,
      stage: "finalizing" as const,
      recovery: Object.freeze({
        kind: "finalization" as const,
        resumesAt: resumeAt as "work-boundary-finalized" | "baseline-checks" | "activity-completed",
        exactEffectDigest: null,
      }),
    })]),
    subjects: Object.freeze({
      proposedBoundary: null,
      activeBoundary: null,
      candidate: null,
      materialCondition: null,
      seal: null,
      evidence: null,
      closure: null,
    }),
    journal: Object.freeze({ eventCount: events.length, headDigest: predecessorDigest }),
    eligibleOperations: Object.freeze([]),
  });
  const store = {
    identity,
    paths: Object.freeze({ root: "/store", database: "/store/db", files: "/store/files", drafts: "/store/drafts" }),
    state,
    getRevision(recordId: string, selectedRevision: number) {
      return revisions.get(`${recordId}\0${selectedRevision}`) ?? null;
    },
    listEvents(afterSequence = 0, limit = 1_000) {
      return Object.freeze(events.filter(({ sequence }) => sequence > afterSequence).slice(0, limit));
    },
    append,
  } as unknown as ControlRecordStore;

  const journalRevision = (eventKind: string, selected: ControlRecordRevision | null): void => {
    append(Object.freeze({
      event: Object.freeze({
        eventId: `event-initial-${eventKind}`,
        eventKind,
        occurredAt: CREATED,
        actor: Object.freeze({ kind: "runtime" as const, id: RUNTIME }),
        subject: selected === null
          ? null
          : Object.freeze({
              recordId: selected.recordId,
              revision: selected.revision,
              digest: selected.digest,
            }),
        payload: Object.freeze({ activityId: ACTIVITY }),
      }),
    }));
  };
  journalRevision("founder-brief-submitted", brief);
  journalRevision("activity-started", null);
  journalRevision("agent-attempt-prepared", attempt);
  journalRevision("agent-work-product-submitted", workProduct);
  journalRevision("execution-receipt-recorded", receipt);

  let checkpoint: ControlJsonObject | null = null;
  let generation = 1;
  let payloadDigest = digestCanonical(Object.freeze({ checkpoint }));
  let lostCheckReceiptReturn = false;
  type Step = Parameters<FoundationAgentRoleCheckpointAdapterV7["step"]>[0];
  const current = () => Object.freeze({
    coordinate: Object.freeze({ generation, payloadDigest }),
    checkpoint,
  });
  const support = Object.freeze({
    current,
    async step(update: Step) {
      assert.deepEqual(update.expected, { generation, payloadDigest });
      const retained = update.mode === "checkpoint" ? null : append(update.append);
      checkpoint = update.checkpoint;
      generation += 1;
      payloadDigest = digestCanonical(Object.freeze({ checkpoint }));
      if (
        options.loseCheckReceiptReturnOnce === true && !lostCheckReceiptReturn &&
        retained?.event.eventKind === "check-receipt-recorded"
      ) {
        lostCheckReceiptReturn = true;
        throw new Error("simulated lost Check Receipt append return");
      }
      return Object.freeze({ view: current(), append: retained, files: Object.freeze([]) });
    },
  }) as unknown as FoundationAgentRoleCheckpointAdapterV7;
  const contractDigest = digest("initial-contract");
  const knowledgeDigest = digest("initial-knowledge-set");
  const productDigest = digest("initial-product-state");
  const atlasDigest = digest("initial-atlas-state");
  const atlas = minimalResolvedAtlas(atlasDigest);
  const snapshotDigest = digest("initial-snapshot");
  const executionProjectionDigest = digest("initial-execution-projection");
  const basis = Object.freeze({
    snapshot: Object.freeze({
      repository: "/target",
      contract: Object.freeze({
        targetId: TARGET,
        digest: contractDigest,
        atlas: Object.freeze({ root: "atlas" }),
        defaults: Object.freeze({ executionProjectionProfileId: "execution-standard-v1" }),
        projectionProfiles: Object.freeze({
          "execution-standard-v1": Object.freeze({ id: "execution-standard-v1", digest: executionProjectionDigest }),
        }),
        capabilityProfiles: Object.freeze({
          [String(capability.id)]: Object.freeze({ id: String(capability.id), digest: capability.digest }),
        }),
        checkBindings: Object.freeze({ [BINDING]: binding }),
      }),
      snapshot: Object.freeze({
        targetId: TARGET,
        contractDigest,
        knowledgeSetDigest: knowledgeDigest,
        productStateDigest: productDigest,
        atlasStateDigest: atlasDigest,
        atlasResolutionDigest: atlas.resolution.digest,
        atlasNormalizedModelDigest: atlas.resolution.normalizedModelDigest,
        atlasResourceBindingsDigest: atlas.resolution.resourceBindingsDigest,
        digest: snapshotDigest,
      }),
      epoch: Object.freeze({ commit: COMMIT, tree: TREE }),
      productState: Object.freeze({ digest: productDigest }),
      atlasState: Object.freeze({ digest: atlasDigest }),
      atlas,
    }),
    knowledge: Object.freeze({
      repository: Object.freeze({
        contract: Object.freeze({ targetId: TARGET, digest: contractDigest }),
        commit: COMMIT,
        tree: TREE,
      }),
      manifest: Object.freeze({
        digest: knowledgeDigest,
        repository: Object.freeze({ contractDigest, commit: COMMIT, tree: TREE }),
        complete: true,
        valid: true,
      }),
      validation: Object.freeze({ complete: true, valid: true }),
      currentRecords: Object.freeze([Object.freeze({
        frontMatter: Object.freeze({ id: CHECK_KNOWLEDGE, revision: 1 }),
        sourceDigest: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
        semanticDigest: "sha256:2222222222222222222222222222222222222222222222222222222222222222",
      })]),
    }),
    projection: Object.freeze({
      manifest: Object.freeze({
        class: "orientation",
        role: "reconnaissance",
        digest: projectionDigest,
        projectionId: "projection-initial-v7",
        profile: "orientation-standard-v1",
        basis: Object.freeze({
          target: Object.freeze({ id: TARGET }),
          commit: COMMIT,
          tree: TREE,
          productStateDigest: productDigest,
          repositoryContractDigest: contractDigest,
          knowledgeSetDigest: knowledgeDigest,
          atlas: Object.freeze({
            stateDigest: atlasDigest,
            resolutionDigest: atlas.resolution.digest,
            normalizedModelDigest: atlas.resolution.normalizedModelDigest,
            resourceBindingsDigest: atlas.resolution.resourceBindingsDigest,
          }),
        }),
        sources: Object.freeze([]),
      }),
    }),
  }) as unknown as FoundationWorkBoundaryFinalizationBasisV7;
  return Object.freeze({
    store,
    context: Object.freeze({
      store,
      activityId: ACTIVITY,
      operation: "delivery.prepare",
      role: "reconnaissance",
      brief,
      attempt,
      boundary: null,
      attemptedCandidate: null,
      resultCandidate: null,
      seal: null,
      workProduct,
      receipt,
      support,
    }),
    basis,
    append,
    coordinate: () => resumeAt,
  });
}

type RetainerMode = "exact" | "changed-reaffirm" | "unchanged-revise";

function boundaryRetainer(
  selected: ReturnType<typeof fixture>,
  mode: RetainerMode,
): NonNullable<FoundationWorkBoundaryFinalizationV7Options["retainBoundary"]> {
  return (input) => {
    const priorMandate = selected.activeBoundary.payload.mandate as ControlJsonObject;
    const shouldChange = input.operation === "delivery.revise" && mode !== "unchanged-revise" ||
      mode === "changed-reaffirm";
    const mandate = shouldChange
      ? Object.freeze({
          ...priorMandate,
          objective: Object.freeze({
            ...(priorMandate.objective as ControlJsonObject),
            interpretation: "Resolve the exact changed Founder mandate.",
          }),
        })
      : priorMandate;
    const changed = shouldChange ? Object.freeze(["/mandate/objective"]) : Object.freeze([]);
    const payload: ControlJsonObject = Object.freeze({
      ...selected.activeBoundary.payload,
      proposalKind: input.operation === "delivery.revise" ? "revision" : "reaffirmation",
      basis: Object.freeze({
        specificationRevision: "lifecycle.foundation.1.0.0-rc.10",
        repositoryContract: "lifecycle.repository.v15",
        providerAdapter: "lifecycle.provider-adapter.v6",
        ...input.repository,
      }),
      knowledge: selected.activeBoundary.payload.knowledge!,
      externalSources: selected.activeBoundary.payload.externalSources!,
      capabilityProfile: Object.freeze({ ...input.capabilityProfile }),
      projectionProfile: Object.freeze({ ...input.projectionProfile }),
      mandate,
      resolution: Object.freeze({
        kind: input.operation === "delivery.revise" ? "revise" : "reaffirm",
        rationaleDigest: selected.context.brief.payload.semanticMarkdownDigest!,
        changedMandateFields: changed,
      }),
      compiler: Object.freeze({ ...input.compiler }),
    });
    const revisionInput: ControlRecordRevisionInput = Object.freeze({
      recordId: selected.activeBoundary.recordId,
      recordKind: "work-boundary",
      revision: 2,
      producer: Object.freeze({ kind: "runtime" as const, id: RUNTIME }),
      semanticAuthor: Object.freeze({ kind: "runtime" as const, id: RUNTIME }),
      semanticAuthority: "runtime-derived",
      createdAt: input.finalizedAt,
      semanticMarkdown: "# Resolved Work Boundary\n",
      payload,
      relationships: Object.freeze([
        Object.freeze({ relation: "uses-brief", target: input.founderBrief }),
        Object.freeze({ relation: "proposed-from", target: input.workProduct }),
        Object.freeze({ relation: "revises", target: input.activeBoundary! }),
        Object.freeze({ relation: "resolves", target: input.materialCondition! }),
      ]),
    });
    const compiled = compileControlRecordRevision(DELIVERY, revisionInput);
    const retained = selected.append(Object.freeze({
      revision: revisionInput,
      event: Object.freeze({
        eventId: `event-boundary-${input.operation}`,
        eventKind: "work-boundary-finalized",
        occurredAt: input.finalizedAt,
        actor: Object.freeze({ kind: "runtime" as const, id: RUNTIME }),
        subject: Object.freeze({
          recordId: compiled.recordId,
          revision: compiled.revision,
          digest: compiled.digest,
        }),
        payload: Object.freeze({ activityId: ACTIVITY }),
      }),
    }));
    assert(retained.revision !== null);
    return Object.freeze({ revision: retained.revision, event: retained.event });
  };
}

function initialBoundaryRetainer(
  selected: ReturnType<typeof initialFixture>,
  baselineModality: "precondition" | "postcondition" = "postcondition",
): NonNullable<FoundationWorkBoundaryFinalizationV7Options["retainBoundary"]> {
  return (input) => {
    assert.equal(input.operation, "delivery.prepare");
    assert.equal(input.activeBoundary, null);
    assert.equal(input.materialCondition, null);
    const template = validDeliveryControlPayload("work-boundary");
    const mandate = template.mandate as ControlJsonObject;
    const payload: ControlJsonObject = Object.freeze({
      ...template,
      targetId: TARGET,
      proposalKind: "initial",
      basis: Object.freeze({
        specificationRevision: "lifecycle.foundation.1.0.0-rc.10",
        repositoryContract: "lifecycle.repository.v15",
        providerAdapter: "lifecycle.provider-adapter.v6",
        ...input.repository,
      }),
      capabilityProfile: Object.freeze({ ...input.capabilityProfile }),
      projectionProfile: Object.freeze({ ...input.projectionProfile }),
      mandate: Object.freeze({
        ...mandate,
        checks: Object.freeze((mandate.checks as readonly ControlJsonObject[]).map(
          (check, index) => index === 0 ? Object.freeze({ ...check, modality: baselineModality }) : check,
        )),
      }),
      resolution: null,
      compiler: Object.freeze({ ...input.compiler }),
    });
    const revisionInput: ControlRecordRevisionInput = Object.freeze({
      recordId: "work-boundary-initial-v7",
      recordKind: "work-boundary",
      revision: 1,
      producer: Object.freeze({ kind: "runtime" as const, id: RUNTIME }),
      semanticAuthor: Object.freeze({ kind: "runtime" as const, id: RUNTIME }),
      semanticAuthority: "runtime-derived",
      createdAt: input.finalizedAt,
      semanticMarkdown: "# Initial Work Boundary\n",
      payload,
      relationships: Object.freeze([
        Object.freeze({ relation: "uses-brief", target: input.founderBrief }),
        Object.freeze({ relation: "proposed-from", target: input.workProduct }),
      ]),
    });
    const compiled = compileControlRecordRevision(DELIVERY, revisionInput);
    const retained = selected.append(Object.freeze({
      revision: revisionInput,
      event: Object.freeze({
        eventId: "event-boundary-delivery-prepare",
        eventKind: "work-boundary-finalized",
        occurredAt: input.finalizedAt,
        actor: Object.freeze({ kind: "runtime" as const, id: RUNTIME }),
        subject: Object.freeze({
          recordId: compiled.recordId,
          revision: compiled.revision,
          digest: compiled.digest,
        }),
        payload: Object.freeze({ activityId: ACTIVITY }),
      }),
    }));
    assert(retained.revision !== null);
    return Object.freeze({ revision: retained.revision, event: retained.event });
  };
}

function sharedCheckOptions(
  retainBoundary: NonNullable<FoundationWorkBoundaryFinalizationV7Options["retainBoundary"]>,
): FoundationWorkBoundaryFinalizationV7Options {
  return Object.freeze({
    machineHome: "/machine",
    now: () => RECORDED,
    retainBoundary,
    checkOperation: Object.freeze({ now: () => RECORDED }),
  });
}

function checkOptions(selected: ReturnType<typeof fixture>): FoundationWorkBoundaryFinalizationV7Options {
  return sharedCheckOptions(boundaryRetainer(selected, "exact"));
}

test("delivery.prepare finalizes and reuses one exact initial Boundary and baseline postcondition", async () => {
  const selected = initialFixture();
  const retain = initialBoundaryRetainer(selected);
  let retainCalls = 0;
  const options = sharedCheckOptions(
    (input) => {
      retainCalls += 1;
      return retain(input);
    },
  );
  const first = await finalizeFoundationInitialWorkBoundaryV7(
    selected.context,
    selected.basis,
    options,
  );
  assert.equal(first.outcome, "completed");
  assert.deepEqual(first.controls?.map(({ recordKind }) => recordKind), ["work-boundary", "check-receipt"]);
  assert.equal(first.controls?.[0]?.revision, 1);
  assert.equal(selected.coordinate(), "activity-completed");
  assert.equal(selected.store.state().subjects.activeBoundary, null);
  assert.equal(selected.store.state().subjects.candidate, null);
  assert.equal(selected.store.state().subjects.materialCondition, null);
  assert.equal(selected.store.state().subjects.proposedBoundary, null);

  const recovered = await finalizeFoundationInitialWorkBoundaryV7(
    selected.context,
    selected.basis,
    options,
  );
  assert.equal(recovered.outcome, "completed");
  assert.deepEqual(
    recovered.controls?.map(({ digest: selectedDigest }) => selectedDigest),
    first.controls?.map(({ digest: selectedDigest }) => selectedDigest),
  );
  assert.equal(retainCalls, 1);
});

test("delivery.prepare reconciles a retained baseline postcondition after its append return is lost", async () => {
  const selected = initialFixture({ loseCheckReceiptReturnOnce: true });
  const retain = initialBoundaryRetainer(selected);
  let retainCalls = 0;
  const options = sharedCheckOptions(
    (input) => {
      retainCalls += 1;
      return retain(input);
    },
  );

  await assert.rejects(
    finalizeFoundationInitialWorkBoundaryV7(selected.context, selected.basis, options),
    /simulated lost Check Receipt append return/u,
  );
  assert.equal(selected.coordinate(), "activity-completed");
  assert.equal(selected.context.support.current().checkpoint, null);

  const recovered = await finalizeFoundationInitialWorkBoundaryV7(
    selected.context,
    selected.basis,
    options,
  );
  assert.equal(recovered.outcome, "completed");
  assert.deepEqual(
    recovered.controls?.map(({ recordKind }) => recordKind),
    ["work-boundary", "check-receipt"],
  );
  assert.equal(selected.context.support.current().checkpoint, null);
  assert.equal(retainCalls, 1);
  assert.equal(
    selected.store.listEvents(0, 1_000)
      .filter(({ eventKind }) => eventKind === "check-receipt-recorded").length,
    1,
  );
});

test("delivery.prepare routes an executable baseline to the required installed Check Cell runtime", async () => {
  const selected = initialFixture({ baselineModality: "precondition" });
  await assert.rejects(
    finalizeFoundationInitialWorkBoundaryV7(
      selected.context,
      selected.basis,
      sharedCheckOptions(
        initialBoundaryRetainer(selected, "precondition"),
      ),
    ),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.check-operation-v7.execution-backend-unavailable",
  );
  assert.equal(selected.coordinate(), "baseline-checks");
});

test("delivery.prepare preflights exact baseline Binding cardinality before Boundary retention", async () => {
  for (const baselineBindingIds of [[], [BINDING, BINDING]] as const) {
    const selected = initialFixture({ baselineBindingIds });
    let retainCalls = 0;
    await assert.rejects(
      finalizeFoundationInitialWorkBoundaryV7(
        selected.context,
        selected.basis,
        sharedCheckOptions(
          (input) => {
            retainCalls += 1;
            return initialBoundaryRetainer(selected)(input);
          },
        ),
      ),
      (error: unknown) => error instanceof FoundationError &&
        error.code === "lifecycle.work-boundary-finalization-v7.check-binding",
    );
    assert.equal(retainCalls, 0);
    assert.equal(selected.coordinate(), "work-boundary-finalized");
  }
});

test("delivery.prepare refuses local effect scopes that contain or enter Atlas after lexical normalization", async () => {
  const prohibitedTargets = Object.freeze([
    ".",
    "./atlas/atlas.md",
    "x/../atlas",
    "atlas//maps/project",
    "atlas\\maps\\project",
    "atlas",
    "atlas/maps/project",
  ]);
  for (const kind of ["local-read", "local-write"] as const) {
    for (const target of prohibitedTargets) {
      const selected = initialFixture({
        effects: Object.freeze([Object.freeze({ kind, target })]),
      });
      await assert.rejects(
        finalizeFoundationInitialWorkBoundaryV7(
          selected.context,
          selected.basis,
          sharedCheckOptions(initialBoundaryRetainer(selected)),
        ),
        (error: unknown) => error instanceof FoundationError &&
          error.code === "lifecycle.atlas.candidate-mutation",
      );
      assert.equal(selected.coordinate(), "work-boundary-finalized");
    }
  }
});

test("delivery.prepare leaves safe sibling and non-local effect targets outside the Atlas path policy", async () => {
  for (const [kind, target] of [
    ["local-read", "src"],
    ["local-write", "src/generated"],
    ["network-request", "./atlas/atlas.md"],
  ] as const) {
    const selected = initialFixture({
      effects: Object.freeze([Object.freeze({ kind, target })]),
    });
    const result = await finalizeFoundationInitialWorkBoundaryV7(
      selected.context,
      selected.basis,
      sharedCheckOptions(initialBoundaryRetainer(selected)),
    );
    assert.equal(result.outcome, "completed");
  }
});

test("delivery.prepare refuses admitted subjects and a substituted reconnaissance basis", async () => {
  const selected = initialFixture();
  await assert.rejects(
    finalizeFoundationInitialWorkBoundaryV7(
      Object.freeze({
        ...selected.context,
        boundary: selected.context.brief,
      }) as unknown as FoundationPreparationAgentRoleControlContextV7,
      selected.basis,
      sharedCheckOptions(initialBoundaryRetainer(selected)),
    ),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.work-boundary-finalization-v7.initial-subject",
  );

  const basis = selected.basis as unknown as { projection: { manifest: ControlJsonObject } };
  const substituted = Object.freeze({
    ...selected.basis,
    projection: Object.freeze({
      ...basis.projection,
      manifest: Object.freeze({
        ...basis.projection.manifest,
        digest: digest("substituted-initial-projection"),
      }),
    }),
  }) as unknown as FoundationWorkBoundaryFinalizationBasisV7;
  await assert.rejects(
    finalizeFoundationInitialWorkBoundaryV7(
      selected.context,
      substituted,
      sharedCheckOptions(initialBoundaryRetainer(selected)),
    ),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.work-boundary-finalization-v7.basis-substitution",
  );
});

for (const operation of ["delivery.reaffirm", "delivery.revise"] as const) {
  test(`${operation} finalizes one exact successor Boundary, baseline postcondition, and unchanged Candidate`, async () => {
    const selected = fixture(operation);
    const result = await finalizeFoundationWorkBoundaryResolutionV7(
      selected.context,
      selected.basis,
      checkOptions(selected),
    );

    assert.equal(result.outcome, "completed");
    assert.deepEqual(result.controls?.map(({ recordKind }) => recordKind), ["work-boundary", "check-receipt"]);
    assert.equal(result.controls?.[0]?.revision, 2);
    assert.equal(selected.coordinate(), "activity-completed");
    assert.equal(selected.store.state().subjects.candidate?.digest, selected.candidate.digest);
    assert.equal(selected.store.state().subjects.activeBoundary?.digest, selected.activeBoundary.digest);
    assert.equal(selected.store.state().subjects.materialCondition?.digest, selected.condition.digest);
  });
}

test("Boundary finalization rejects reaffirm-change and revise-no-change mismatches", async () => {
  for (const [operation, mode] of [
    ["delivery.reaffirm", "changed-reaffirm"],
    ["delivery.revise", "unchanged-revise"],
  ] as const) {
    const selected = fixture(operation);
    const options = Object.freeze({
      ...checkOptions(selected),
      retainBoundary: boundaryRetainer(selected, mode),
    });
    await assert.rejects(
      finalizeFoundationWorkBoundaryResolutionV7(selected.context, selected.basis, options),
      (error: unknown) => error instanceof FoundationError &&
        error.code === "lifecycle.work-boundary-finalization-v7.boundary-reuse",
    );
    assert.equal(selected.coordinate(), "baseline-checks");
  }
});

test("Boundary finalization refuses caller-substituted retained subjects and Projection basis", async () => {
  const selected = fixture("delivery.reaffirm");
  const substitutedCandidate = Object.freeze({
    ...selected.context.resultCandidate,
    semanticMarkdown: "# substituted Candidate\n",
  });
  await assert.rejects(
    finalizeFoundationWorkBoundaryResolutionV7(
      Object.freeze({ ...selected.context, resultCandidate: substitutedCandidate }),
      selected.basis,
      checkOptions(selected),
    ),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.work-boundary-finalization-v7.substitution",
  );

  const basis = selected.basis as unknown as {
    projection: { manifest: ControlJsonObject };
  };
  const substitutedBasis = Object.freeze({
    ...selected.basis,
    projection: Object.freeze({
      ...basis.projection,
      manifest: Object.freeze({ ...basis.projection.manifest, digest: digest("substituted-projection") }),
    }),
  }) as unknown as FoundationWorkBoundaryFinalizationBasisV7;
  await assert.rejects(
    finalizeFoundationWorkBoundaryResolutionV7(
      selected.context,
      substitutedBasis,
      checkOptions(selected),
    ),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.work-boundary-finalization-v7.basis-substitution",
  );
});

test("Boundary baseline Binding cardinality is refused before successor retention", async () => {
  for (const baselineBindingIds of [[], [BINDING, BINDING]] as const) {
    const selected = fixture("delivery.reaffirm", { baselineBindingIds });
    let retainCalls = 0;
    await assert.rejects(
      finalizeFoundationWorkBoundaryResolutionV7(
        selected.context,
        selected.basis,
        Object.freeze({
          ...checkOptions(selected),
          retainBoundary: (input) => {
            retainCalls += 1;
            return boundaryRetainer(selected, "exact")(input);
          },
        }),
      ),
      (error: unknown) => error instanceof FoundationError &&
        error.code === "lifecycle.work-boundary-finalization-v7.check-binding",
    );
    assert.equal(retainCalls, 0);
    assert.equal(selected.coordinate(), "work-boundary-finalized");
  }
});
