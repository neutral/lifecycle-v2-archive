import assert from "node:assert/strict";
import test from "node:test";
import {
  retainWorkBoundary,
  type WorkBoundaryExternalSourceFact,
  type WorkBoundaryOperation,
  type WorkBoundaryReference,
} from "../../src/foundation/control/work-boundary.js";
import {
  compileControlRecordEvent,
  compileControlRecordRevision,
} from "../../src/foundation/control/model.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlJsonObject,
  type ControlRecordRevision,
  type ControlRecordStoreAppend,
  type ControlRecordStoreIdentity,
} from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import type { ReducedDeliveryState } from "../../src/foundation/process/delivery-reducer.js";
import { sha256Bytes, type Sha256 } from "../../src/foundation/validation/canonical.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

const CREATED = "2026-08-29T19:00:00.000Z";
const PROCESS = "delivery-work-boundary-compiler";
const RUNTIME = "foundation-runtime";
const KNOWLEDGE_ID = "check.boundary-compiler";

function digest(value: string): Sha256 {
  return sha256Bytes(value);
}

const knowledge = Object.freeze({
  id: KNOWLEDGE_ID,
  revision: 3,
  sourceDigest: digest("check-source"),
  semanticDigest: digest("check-semantics"),
});

const identity: ControlRecordStoreIdentity = Object.freeze({
  schema: CONTROL_RECORD_STORE_SCHEMA,
  storeId: "store-work-boundary-compiler",
  targetId: "target-work-boundary-compiler",
  processKind: "delivery",
  processId: PROCESS,
  createdAt: CREATED,
});

type BoundaryTestRecordKind =
  | "founder-brief"
  | "agent-work-product"
  | "execution-receipt"
  | "work-boundary"
  | "material-condition";

function ref<Kind extends BoundaryTestRecordKind>(
  kind: Kind,
  revision: ControlRecordRevision,
): WorkBoundaryReference<Kind> {
  return Object.freeze({
    kind,
    id: revision.recordId,
    revision: revision.revision,
    digest: revision.digest,
  });
}

function compileRecord(input: Readonly<{
  id: string;
  kind: string;
  payload: ControlJsonObject;
  semanticAuthority?: "runtime-derived" | "runtime-observed" | "agent-proposed" | "founder-supplied";
  relationships?: readonly Readonly<{
    relation: string;
    target: Readonly<{ kind: string; id: string; revision: number; digest: Sha256 }>;
  }>[];
}>): ControlRecordRevision {
  const authority = input.semanticAuthority ?? "runtime-derived";
  const authorKind = authority === "agent-proposed" ? "agent" : authority === "founder-supplied" ? "founder" : "runtime";
  return compileControlRecordRevision(PROCESS, {
    recordId: input.id,
    recordKind: input.kind,
    revision: 1,
    producer: { kind: "runtime", id: RUNTIME },
    semanticAuthor: { kind: authorKind, id: `${authorKind}-boundary-compiler` },
    semanticAuthority: authority,
    createdAt: CREATED,
    semanticMarkdown: `# ${input.kind}\n`,
    payload: input.payload,
    relationships: input.relationships ?? [],
  });
}

function semantics(
  selectedMeaning: string,
  checkRequirements: Readonly<{ baseline: boolean; final: boolean }> = {
    baseline: true,
    final: true,
  },
  obligationSourceIds: readonly string[] = [KNOWLEDGE_ID, "direction.boundary"],
  externalSource: WorkBoundaryExternalSourceFact | null = null,
): ControlJsonObject {
  return Object.freeze({
    role: "reconnaissance",
    proposal: "work-boundary",
    conditionIds: Object.freeze([]),
    decisionIds: Object.freeze(["proposition.boundary"]),
    effectIds: Object.freeze([]),
    workBoundary: Object.freeze({
      selectedKnowledgeIds: Object.freeze([KNOWLEDGE_ID]),
      selectedSourceIds: Object.freeze(externalSource === null ? [] : [externalSource.sourceId]),
      capabilityProfileId: "capability.builder-standard",
      projectionProfile: "execution-standard-v1",
      objective: Object.freeze({
        id: "objective.boundary",
        interpretation: "Compile one exact Work Boundary.",
        fragmentDigest: digest("objective"),
      }),
      mandate: Object.freeze({
        id: "direction.boundary",
        selectedMeaning,
        whyNow: "The Delivery needs one exact executable mandate.",
        included: Object.freeze(["Retain the complete typed proof plan."]),
        excluded: Object.freeze([]),
        authorityFacts: Object.freeze([]),
        chosenTradeoffs: Object.freeze([]),
        assumptions: Object.freeze([]),
        falsifiers: Object.freeze([]),
        fragmentDigest: digest(`direction:${selectedMeaning}`),
      }),
      effects: Object.freeze([]),
      risks: Object.freeze([]),
      obligations: Object.freeze([Object.freeze({
        id: "obligation.boundary",
        kind: "check",
        statement: "The exact compiler Check passes.",
        sourceIds: Object.freeze([...obligationSourceIds]),
        requiredEvidenceArtifactIds: Object.freeze(["artifact.boundary"]),
        severity: "required",
        propositionIds: Object.freeze(["proposition.boundary"]),
        fragmentDigest: digest("obligation"),
      })]),
      artifacts: Object.freeze([Object.freeze({
        id: "artifact.boundary",
        path: "runtime/src/foundation/control/work-boundary.ts",
        role: "code",
        mustChange: true,
        obligationIds: Object.freeze(["obligation.boundary"]),
        changeRule: "The runtime compiles the complete Work Boundary.",
        fragmentDigest: digest("artifact"),
      })]),
      checks: Object.freeze([Object.freeze({
        id: "check-selection.boundary",
        checkKnowledgeId: KNOWLEDGE_ID,
        bindingIds: Object.freeze(["binding.boundary", "binding.alpha"]),
        modality: "postcondition",
        purpose: "Prove deterministic Work Boundary compilation.",
        obligationIds: Object.freeze(["obligation.boundary"]),
        baselineRequired: checkRequirements.baseline,
        finalRequired: checkRequirements.final,
        environmentRequirements: Object.freeze(["node", "darwin"]),
        fragmentDigest: digest("check"),
      })]),
      propositions: Object.freeze([Object.freeze({
        id: "proposition.boundary",
        claim: "The exact Work Boundary is complete and reproducible.",
        evidenceKinds: Object.freeze(["check"]),
        evidenceArtifactIds: Object.freeze(["artifact.boundary"]),
        obligationIds: Object.freeze(["obligation.boundary"]),
        effectIds: Object.freeze([]),
        riskIds: Object.freeze([]),
        path: "runtime/src/foundation/control/work-boundary.ts",
        checkId: "check-selection.boundary",
        allowNotApplicable: false,
        notApplicableCondition: null,
        fragmentDigest: digest("proposition"),
      })]),
    }),
  });
}

function workProductPayload(
  selectedMeaning: string,
  checkRequirements?: Readonly<{ baseline: boolean; final: boolean }>,
  obligationSourceIds?: readonly string[],
  externalSource: WorkBoundaryExternalSourceFact | null = null,
): ControlJsonObject {
  const base = validDeliveryControlPayload("agent-work-product");
  return Object.freeze({
    ...base,
    profileId: "lifecycle.agent-work-product-body.reconnaissance.v2",
    role: "reconnaissance",
    disposition: "complete",
    claims: Object.freeze([Object.freeze({
      id: "claim.boundary-route",
      category: "route",
      state: "proposed",
      statement: "The exact Knowledge supports this Work Boundary.",
      knowledgeIds: Object.freeze([KNOWLEDGE_ID]),
      evidenceIds: Object.freeze([]),
      paths: Object.freeze([]),
      uncertainty: "none",
      fragmentDigest: digest("claim"),
    })]),
    citations: Object.freeze([Object.freeze({
      id: "citation.boundary-knowledge",
      subjectId: KNOWLEDGE_ID,
      subjectKind: "knowledge",
      subjectDigest: knowledge.semanticDigest,
      locator: `knowledge://${KNOWLEDGE_ID}`,
      authorityClass: "repository-authored",
      claimIds: Object.freeze(["claim.boundary-route"]),
      fragmentDigest: digest("citation"),
    }), ...(externalSource === null ? [] : [Object.freeze({
      id: "citation.boundary-source",
      subjectId: externalSource.sourceId,
      subjectKind: "source",
      subjectDigest: externalSource.citationDigest,
      locator: `source://${externalSource.sourceId}`,
      authorityClass: "repository-authored",
      claimIds: Object.freeze(["claim.boundary-route"]),
      fragmentDigest: digest("source-citation"),
    })])]),
    limitations: Object.freeze([]),
    noProductReason: null,
    roleSemantics: semantics(selectedMeaning, checkRequirements, obligationSourceIds, externalSource),
    body: Object.freeze({
      profileId: "lifecycle.agent-work-product-body.reconnaissance.v2",
      digest: digest(`body:${selectedMeaning}`),
      fragments: Object.freeze([]),
    }),
  });
}

function receiptPayload(activityId: string, workProduct: ControlRecordRevision): ControlJsonObject {
  const base = validDeliveryControlPayload("execution-receipt");
  const provider = base.provider as ControlJsonObject;
  const execution = base.execution as ControlJsonObject;
  return Object.freeze({
    ...base,
    activityId,
    providerEffect: Object.freeze({ effectDigest: digest(`effect:${activityId}`), outcome: "completed" }),
    productiveExecutionStarted: true,
    inputBindings: Object.freeze({
      roleBriefDigest: digest(`role-brief:${activityId}`),
      contentInventoryDigest: digest(`content-inventory:${activityId}`),
      inputMaterialDigest: digest(`input-material:${activityId}`),
    }),
    provider: Object.freeze({
      ...provider,
      firstTrigger: "submission",
      terminalReason: "valid-submission",
      stage: "evaluated",
      startedAt: CREATED,
      finishedAt: CREATED,
      exitCode: 0,
    }),
    execution: Object.freeze({
      ...execution,
      output: Object.freeze({
        availability: "retrieved",
        carrierByteLength: 512,
        carrierDigest: digest(`output-carrier:${activityId}`),
        manifestDigest: digest(`output-manifest:${activityId}`),
      }),
    }),
    workspace: Object.freeze({
      availability: "available",
      rawByteLength: 512,
      workspaceRawDigest: digest(`workspace:${activityId}`),
      semanticMarkdownDigest: digest(`submitted-semantic:${activityId}`),
      parseResultDigest: workProduct.payload.parseResultDigest as Sha256,
      failureFactsDigest: null,
      submissionDiagnostic: null,
      fixedBindingSubjectDigest: workProduct.payload.fixedBindingSubjectDigest as Sha256,
      parserDisposition: "valid",
      compilerDisposition: "retained",
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
    containment: Object.freeze({
      classification: "contained",
      factsDigest: digest(`containment:${activityId}`),
      cancellationRequested: false,
      forced: false,
      parentLoss: "not-observed",
    }),
    retirement: Object.freeze({
      classification: "retired",
      factsDigest: digest(`retirement:${activityId}`),
      residualClass: "none",
      residualFactsDigest: null,
    }),
  });
}

type Fixture = ReturnType<typeof fakeStore>;

function fakeStore() {
  const revisions = new Map<string, ControlRecordRevision>();
  const appended: ControlRecordStoreAppend[] = [];
  let sequence = 0;
  let predecessorDigest: Sha256 | null = null;
  let currentState: ReducedDeliveryState;
  const emptySubjects = {
    proposedBoundary: null,
    activeBoundary: null,
    candidate: null,
    materialCondition: null,
    seal: null,
    evidence: null,
    closure: null,
  } as const;
  const setState = (input: Readonly<{
    activityId: string;
    operation: WorkBoundaryOperation;
    activeBoundary?: WorkBoundaryReference<"work-boundary"> | null;
    materialCondition?: WorkBoundaryReference<"material-condition"> | null;
  }>) => {
    currentState = Object.freeze({
      standing: input.operation === "delivery.prepare" ? "framing" : "boundary-paused",
      candidateCondition: input.operation === "delivery.prepare" ? "absent" : "paused-for-boundary",
      activities: Object.freeze([Object.freeze({
        id: input.activityId,
        operation: input.operation,
        family: "agent" as const,
        stage: "finalizing" as const,
        recovery: Object.freeze({
          kind: "finalization" as const,
          resumesAt: "work-boundary-finalized" as const,
          exactEffectDigest: null,
        }),
      })]),
      subjects: Object.freeze({
        ...emptySubjects,
        activeBoundary: input.activeBoundary === undefined || input.activeBoundary === null
          ? null
          : Object.freeze({
              id: input.activeBoundary.id,
              revision: input.activeBoundary.revision,
              digest: input.activeBoundary.digest,
            }),
        materialCondition: input.materialCondition === undefined || input.materialCondition === null
          ? null
          : Object.freeze({
              id: input.materialCondition.id,
              revision: input.materialCondition.revision,
              digest: input.materialCondition.digest,
            }),
      }),
      journal: Object.freeze({ eventCount: sequence, headDigest: predecessorDigest }),
      eligibleOperations: Object.freeze([]),
    });
  };
  setState({ activityId: "activity.prepare", operation: "delivery.prepare" });
  const store = {
    identity,
    state() {
      return currentState;
    },
    getRevision(recordId: string, revision: number) {
      return revisions.get(`${recordId}\u0000${revision}`) ?? null;
    },
    append(input: ControlRecordStoreAppend) {
      appended.push(input);
      const revision = input.revision === undefined
        ? null
        : compileControlRecordRevision(identity.processId, input.revision);
      if (revision !== null) revisions.set(`${revision.recordId}\u0000${revision.revision}`, revision);
      sequence += 1;
      const event = compileControlRecordEvent({
        storeId: identity.storeId,
        processId: identity.processId,
        sequence,
        predecessorDigest,
        event: input.event,
      });
      predecessorDigest = event.digest;
      return Object.freeze({ revision, event });
    },
  } as unknown as ControlRecordStore;
  return Object.freeze({ store, revisions, appended, setState });
}

function addReconnaissance(
  fixture: Fixture,
  activityId: string,
  operation: WorkBoundaryOperation,
  selectedMeaning: string,
  checkRequirements?: Readonly<{ baseline: boolean; final: boolean }>,
  obligationSourceIds?: readonly string[],
  externalSource: WorkBoundaryExternalSourceFact | null = null,
): Readonly<{
  founderBrief: WorkBoundaryReference<"founder-brief">;
  workProduct: WorkBoundaryReference<"agent-work-product">;
  executionReceipt: WorkBoundaryReference<"execution-receipt">;
  externalSources: readonly WorkBoundaryExternalSourceFact[];
}> {
  const briefPayload = Object.freeze({
    ...validDeliveryControlPayload("founder-brief"),
    inputProfile: operation,
    templateProfileId: operation === "delivery.prepare" ? "founder-brief.prepare-v1" : "founder-brief.resolution-v1",
    semanticMarkdownDigest: digest(`brief:${activityId}`),
  });
  const brief = compileRecord({
    id: `brief-${activityId}`,
    kind: "founder-brief",
    payload: briefPayload,
    semanticAuthority: "founder-supplied",
  });
  const attempt = compileRecord({
    id: `attempt-${activityId}`,
    kind: "agent-attempt",
    payload: Object.freeze({
      ...validDeliveryControlPayload("agent-attempt"),
      activityId,
      operation,
    }),
    relationships: [Object.freeze({ relation: "uses-brief", target: ref("founder-brief", brief) })],
  });
  const workProduct = compileRecord({
    id: `work-product-${activityId}`,
    kind: "agent-work-product",
    payload: workProductPayload(
      selectedMeaning,
      checkRequirements,
      obligationSourceIds,
      externalSource,
    ),
    semanticAuthority: "agent-proposed",
    relationships: [Object.freeze({ relation: "result-of", target: {
      kind: "agent-attempt",
      id: attempt.recordId,
      revision: attempt.revision,
      digest: attempt.digest,
    } })],
  });
  const receipt = compileRecord({
    id: `receipt-${activityId}`,
    kind: "execution-receipt",
    payload: receiptPayload(activityId, workProduct),
    semanticAuthority: "runtime-observed",
    relationships: [
      Object.freeze({ relation: "observes-attempt", target: {
        kind: "agent-attempt",
        id: attempt.recordId,
        revision: attempt.revision,
        digest: attempt.digest,
      } }),
      Object.freeze({ relation: "observes-work-product", target: {
        kind: "agent-work-product",
        id: workProduct.recordId,
        revision: workProduct.revision,
        digest: workProduct.digest,
      } }),
    ],
  });
  for (const revision of [brief, attempt, workProduct, receipt]) {
    fixture.revisions.set(`${revision.recordId}\u0000${revision.revision}`, revision);
  }
  return Object.freeze({
    founderBrief: ref("founder-brief", brief),
    workProduct: ref("agent-work-product", workProduct),
    executionReceipt: ref("execution-receipt", receipt),
    externalSources: Object.freeze(externalSource === null ? [] : [externalSource]),
  });
}

function retain(
  fixture: Fixture,
  activityId: string,
  operation: WorkBoundaryOperation,
  sources: ReturnType<typeof addReconnaissance>,
  resolution: Readonly<{
    activeBoundary?: WorkBoundaryReference<"work-boundary"> | null;
    materialCondition?: WorkBoundaryReference<"material-condition"> | null;
  }> | null = null,
) {
  return retainWorkBoundary({
    store: fixture.store,
    activityId,
    operation,
    ...sources,
    repository: {
      productBaseCommit: "a".repeat(40),
      productBaseTree: "b".repeat(40),
      productStateDigest: digest(`product:${activityId}`),
      atlasStateDigest: digest(`atlas:${activityId}`),
      atlasResolutionDigest: digest(`atlas-resolution:${activityId}`),
      atlasNormalizedModelDigest: digest(`atlas-normalized-model:${activityId}`),
      atlasResourceBindingsDigest: digest(`atlas-resource-bindings:${activityId}`),
      repositoryContractDigest: digest("repository-contract"),
      knowledgeSetDigest: digest("knowledge-set"),
      repositorySnapshotDigest: digest(`snapshot:${activityId}`),
    },
    knowledge: [knowledge],
    externalSources: sources.externalSources,
    capabilityProfile: { id: "capability.builder-standard", digest: digest("capability") },
    projectionProfile: {
      semanticProfile: "execution-standard-v1",
      id: "projection.execution-standard",
      digest: digest("projection"),
    },
    checkBindings: [
      { id: "binding.boundary", checkKnowledgeId: KNOWLEDGE_ID, digest: digest("binding-z"), implementationDigest: digest("implementation-z") },
      { id: "binding.alpha", checkKnowledgeId: KNOWLEDGE_ID, digest: digest("binding-a"), implementationDigest: digest("implementation-a") },
    ],
    compiler: {
      profileId: "compiler.work-boundary-v1",
      profileDigest: digest("compiler-profile"),
      implementationId: "runtime.work-boundary-compiler",
      implementationDigest: digest("compiler-implementation"),
    },
    activeBoundary: resolution?.activeBoundary ?? null,
    materialCondition: resolution?.materialCondition ?? null,
    finalizedAt: CREATED,
    runtimeId: RUNTIME,
  });
}

test("Work Boundary compiler owns identity, exact source joins, normalization, and atomic finalization", () => {
  const firstFixture = fakeStore();
  const firstSources = addReconnaissance(firstFixture, "activity.prepare", "delivery.prepare", "Compile one complete immutable mandate.");
  const first = retain(firstFixture, "activity.prepare", "delivery.prepare", firstSources);
  const secondFixture = fakeStore();
  const secondSources = addReconnaissance(secondFixture, "activity.prepare", "delivery.prepare", "Compile one complete immutable mandate.");
  const second = retain(secondFixture, "activity.prepare", "delivery.prepare", secondSources);

  assert.match(first.revision.recordId, /^work-boundary-[a-f0-9]{64}$/u);
  assert.equal(first.revision.recordId, second.revision.recordId);
  assert.equal(first.revision.digest, second.revision.digest);
  assert.equal(first.revision.revision, 1);
  assert.equal(first.revision.payload.proposalKind, "initial");
  assert.equal(first.revision.payload.resolution, null);
  assert.deepEqual(first.revision.relationships.map(({ relation }) => relation), ["proposed-from", "uses-brief"]);
  const checks = ((first.revision.payload.mandate as ControlJsonObject).checks as readonly ControlJsonObject[]);
  assert.deepEqual((checks[0]!.bindings as readonly ControlJsonObject[]).map(({ id }) => id), ["binding.alpha", "binding.boundary"]);
  assert.deepEqual(checks[0]!.environmentRequirements, ["darwin", "node"]);
  assert.match(first.revision.semanticMarkdown, /Compile one complete immutable mandate/u);
  assert.equal(first.event.eventKind, "work-boundary-finalized");
  assert.deepEqual(first.event.payload, { activityId: "activity.prepare" });
  assert.equal(firstFixture.appended.length, 1);
});

test("Work Boundary compiler requires a nonempty final evaluation Check set", () => {
  const fixture = fakeStore();
  const sources = addReconnaissance(
    fixture,
    "activity.prepare",
    "delivery.prepare",
    "Compile one complete immutable mandate.",
    { baseline: true, final: false },
  );

  assert.throws(
    () => retain(fixture, "activity.prepare", "delivery.prepare", sources),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.control-work-boundary.semantic-coverage",
  );
  assert.equal(fixture.appended.length, 0);
});

test("Work Boundary compiler refuses a non-mandate local obligation source", () => {
  const fixture = fakeStore();
  const sources = addReconnaissance(
    fixture,
    "activity.prepare",
    "delivery.prepare",
    "Compile one complete immutable mandate.",
    undefined,
    [KNOWLEDGE_ID, "objective.boundary"],
  );

  assert.throws(
    () => retain(fixture, "activity.prepare", "delivery.prepare", sources),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.control-work-boundary.semantic-coverage",
  );
  assert.equal(fixture.appended.length, 0);
});

test("Work Boundary compiler refuses an external-source identity that collides with the fixed mandate", () => {
  const fixture = fakeStore();
  const collision = Object.freeze({
    ownerKind: "source",
    ownerId: "source-owner.boundary",
    sourceId: "direction.boundary",
    revision: "revision-1",
    digest: digest("colliding-source"),
    citationDigest: digest("colliding-source-citation"),
  });
  const sources = addReconnaissance(
    fixture,
    "activity.prepare",
    "delivery.prepare",
    "Compile one complete immutable mandate.",
    undefined,
    [KNOWLEDGE_ID, "direction.boundary"],
    collision,
  );

  assert.throws(
    () => retain(fixture, "activity.prepare", "delivery.prepare", sources),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.control-work-boundary.semantic-coverage",
  );
  assert.equal(fixture.appended.length, 0);
});

test("Work Boundary succession derives revision versus reaffirmation from the complete mandate", () => {
  const fixture = fakeStore();
  const initialSources = addReconnaissance(fixture, "activity.prepare", "delivery.prepare", "Preserve the exact mandate.");
  const initial = retain(fixture, "activity.prepare", "delivery.prepare", initialSources);
  const activeBoundary = ref("work-boundary", initial.revision);
  const condition = compileRecord({
    id: "condition-boundary-resolution",
    kind: "material-condition",
    payload: validDeliveryControlPayload("material-condition"),
  });
  fixture.revisions.set(`${condition.recordId}\u0000${condition.revision}`, condition);
  const materialCondition = ref("material-condition", condition);

  fixture.setState({ activityId: "activity.reaffirm", operation: "delivery.reaffirm", activeBoundary, materialCondition });
  const reaffirmSources = addReconnaissance(fixture, "activity.reaffirm", "delivery.reaffirm", "Preserve the exact mandate.");
  const reaffirmed = retain(fixture, "activity.reaffirm", "delivery.reaffirm", reaffirmSources, { activeBoundary, materialCondition });
  assert.equal(reaffirmed.revision.recordId, initial.revision.recordId);
  assert.equal(reaffirmed.revision.revision, 2);
  assert.deepEqual(reaffirmed.revision.payload.resolution, {
    kind: "reaffirm",
    rationaleDigest: digest("brief:activity.reaffirm"),
    changedMandateFields: [],
  });
  assert.deepEqual(reaffirmed.revision.relationships.map(({ relation }) => relation), ["proposed-from", "resolves", "revises", "uses-brief"]);

  const changedFixture = fakeStore();
  const changedInitialSources = addReconnaissance(changedFixture, "activity.prepare", "delivery.prepare", "Preserve the exact mandate.");
  const changedInitial = retain(changedFixture, "activity.prepare", "delivery.prepare", changedInitialSources);
  const changedActive = ref("work-boundary", changedInitial.revision);
  changedFixture.revisions.set(`${condition.recordId}\u0000${condition.revision}`, condition);
  changedFixture.setState({ activityId: "activity.revise", operation: "delivery.revise", activeBoundary: changedActive, materialCondition });
  const reviseSources = addReconnaissance(changedFixture, "activity.revise", "delivery.revise", "Replace the mandate with the resolved direction.");
  const revised = retain(changedFixture, "activity.revise", "delivery.revise", reviseSources, {
    activeBoundary: changedActive,
    materialCondition,
  });
  assert.deepEqual((revised.revision.payload.resolution as ControlJsonObject).changedMandateFields, ["/mandate/direction"]);
});

test("Work Boundary compiler refuses a reaffirmation whose complete mandate changed", () => {
  const fixture = fakeStore();
  const initialSources = addReconnaissance(fixture, "activity.prepare", "delivery.prepare", "Preserve the exact mandate.");
  const initial = retain(fixture, "activity.prepare", "delivery.prepare", initialSources);
  const activeBoundary = ref("work-boundary", initial.revision);
  const condition = compileRecord({
    id: "condition-reaffirm-mismatch",
    kind: "material-condition",
    payload: validDeliveryControlPayload("material-condition"),
  });
  fixture.revisions.set(`${condition.recordId}\u0000${condition.revision}`, condition);
  const materialCondition = ref("material-condition", condition);
  fixture.setState({ activityId: "activity.reaffirm", operation: "delivery.reaffirm", activeBoundary, materialCondition });
  const sources = addReconnaissance(fixture, "activity.reaffirm", "delivery.reaffirm", "A changed mandate cannot be reaffirmed.");

  assert.throws(() => retain(fixture, "activity.reaffirm", "delivery.reaffirm", sources, {
    activeBoundary,
    materialCondition,
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-work-boundary.resolution-kind");
  assert.equal(fixture.appended.length, 1);
});

test("Work Boundary resolution requires both exact successor subjects", () => {
  const fixture = fakeStore();
  const initialSources = addReconnaissance(fixture, "activity.prepare", "delivery.prepare", "Preserve the exact mandate.");
  const initial = retain(fixture, "activity.prepare", "delivery.prepare", initialSources);
  const activeBoundary = ref("work-boundary", initial.revision);
  fixture.setState({ activityId: "activity.reaffirm", operation: "delivery.reaffirm", activeBoundary });
  const sources = addReconnaissance(fixture, "activity.reaffirm", "delivery.reaffirm", "Preserve the exact mandate.");

  assert.throws(() => retain(fixture, "activity.reaffirm", "delivery.reaffirm", sources, {
    activeBoundary,
  }), (error: unknown) => error instanceof FoundationError &&
    error.code === "lifecycle.control-work-boundary.succession");
  assert.equal(fixture.appended.length, 1);
});
