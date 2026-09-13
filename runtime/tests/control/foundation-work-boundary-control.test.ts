import { createEmptyDisciplineRegistry } from "../../src/foundation/knowledge/discipline-registry.js";
import { knowledgeOccurrenceItemId } from "../../src/foundation/knowledge/identity.js";
import assert from "node:assert/strict";
import test from "node:test";
import {
  retainWorkBoundary,
  resolveWorkBoundaryResolutionSnapshotV1,
  workBoundaryRepositoryBasisFromSnapshot,
  type WorkBoundaryRepositoryBasis,
  type WorkBoundaryExternalSourceFact,
  type WorkBoundaryKnowledgeFact,
  type WorkBoundaryOperation,
  type WorkBoundaryReference,
} from "../../src/foundation/control/work-boundary.js";
import {
  compileControlRecordEvent,
  compileControlRecordRevision,
} from "../../src/foundation/control/model.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import { foundationIntegrationValidationFactsDigestV1 } from "../../src/foundation/control/integration-assessment.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlJsonObject,
  type ControlRecordRevision,
  type ControlRecordStoreAppend,
  type ControlRecordStoreIdentity,
} from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import type { ReducedDeliveryState } from "../../src/foundation/process/delivery-reducer.js";
import { digestCanonical, selfDigest, sha256Bytes, type Sha256 } from "../../src/foundation/validation/canonical.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";
import { evidenceFixtureV7 } from "../helpers/evidence-fixture-v7.js";

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
  | "director-brief"
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
  revision?: number;
  payload: ControlJsonObject;
  semanticAuthority?: "runtime-derived" | "runtime-observed" | "agent-proposed" | "director-supplied";
  relationships?: readonly Readonly<{
    relation: string;
    target: Readonly<{ kind: string; id: string; revision: number; digest: Sha256 }>;
  }>[];
}>): ControlRecordRevision {
  const authority = input.semanticAuthority ?? "runtime-derived";
  const authorKind = authority === "agent-proposed" ? "agent" : authority === "director-supplied" ? "director" : "runtime";
  return compileControlRecordRevision(PROCESS, {
    recordId: input.id,
    recordKind: input.kind,
    revision: input.revision ?? 1,
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
  discipline: WorkBoundaryKnowledgeFact | null = null,
  projectionProfile = "execution-standard-v1",
): ControlJsonObject {
  return Object.freeze({
    role: "reconnaissance",
    proposal: "work-boundary",
    conditionIds: Object.freeze([]),
    decisionIds: Object.freeze(["proposition.boundary"]),
    effectIds: Object.freeze([]),
    workBoundary: Object.freeze({
      selectedKnowledgeIds: Object.freeze([KNOWLEDGE_ID, ...(discipline === null ? [] : [discipline.id])]),
      selectedWorkTypeIds: Object.freeze(discipline === null ? [] : ["go-development"]),
      selectedSourceIds: Object.freeze(externalSource === null ? [] : [externalSource.sourceId]),
      capabilityProfileId: "capability.builder-standard",
      projectionProfile,
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
  discipline: WorkBoundaryKnowledgeFact | null = null,
  projectionProfile = "execution-standard-v1",
  knowledgeCitation: Readonly<{ subjectId: string; subjectKind: "knowledge" | "source"; subjectDigest: Sha256 }> = {
    subjectId: KNOWLEDGE_ID, subjectKind: "knowledge", subjectDigest: knowledge.sourceDigest,
  },
): ControlJsonObject {
  const base = validDeliveryControlPayload("agent-work-product");
  return Object.freeze({
    ...base,
    profileId: "lifecycle.agent-work-product-body.reconnaissance.v4",
    role: "reconnaissance",
    disposition: "complete",
    claims: Object.freeze([Object.freeze({
      id: "claim.boundary-route",
      category: "route",
      state: "proposed",
      statement: "The exact Knowledge supports this Work Boundary.",
      knowledgeIds: Object.freeze([KNOWLEDGE_ID, ...(discipline === null ? [] : [discipline.id])]),
      evidenceIds: Object.freeze([]),
      paths: Object.freeze([]),
      uncertainty: "none",
      fragmentDigest: digest("claim"),
    })]),
    citations: Object.freeze([Object.freeze({
      id: "citation.boundary-knowledge",
      ...knowledgeCitation,
      locator: `knowledge://${KNOWLEDGE_ID}`,
      authorityClass: "repository-authored",
      claimIds: Object.freeze(["claim.boundary-route"]),
      fragmentDigest: digest("citation"),
    }), ...(discipline === null ? [] : [Object.freeze({
      id: "citation.boundary-discipline",
      subjectId: discipline.id,
      subjectKind: "knowledge",
      subjectDigest: discipline.sourceDigest,
      locator: `knowledge://${discipline.id}`,
      authorityClass: "repository-authored",
      claimIds: Object.freeze(["claim.boundary-route"]),
      fragmentDigest: digest("discipline-citation"),
    })]), ...(externalSource === null ? [] : [Object.freeze({
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
    roleSemantics: semantics(selectedMeaning, checkRequirements, obligationSourceIds, externalSource, discipline, projectionProfile),
    body: Object.freeze({
      profileId: "lifecycle.agent-work-product-body.reconnaissance.v4",
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
    integrationAssessment: null,
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
      delegation: { admission: null, current: null, charged: { operations: 0, agentAttempts: 0, reservedCellWallTimeMs: 0 } },
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
  discipline: WorkBoundaryKnowledgeFact | null = null,
  projectionProfile = "execution-standard-v1",
  knowledgeCitation?: Parameters<typeof workProductPayload>[6],
): Readonly<{
  discipline: WorkBoundaryKnowledgeFact | null;
  directorBrief: WorkBoundaryReference<"director-brief">;
  workProduct: WorkBoundaryReference<"agent-work-product">;
  executionReceipt: WorkBoundaryReference<"execution-receipt">;
  externalSources: readonly WorkBoundaryExternalSourceFact[];
}> {
  const briefPayload = Object.freeze({
    ...validDeliveryControlPayload("director-brief"),
    scope: { kind: "activity", activityId },
    inputProfile: operation,
    templateProfileId: operation === "delivery.prepare" ? "director-brief.prepare-v1" : "director-brief.resolution-v1",
    semanticMarkdownDigest: digest(`brief:${activityId}`),
  });
  const brief = compileRecord({
    id: `brief-${activityId}`,
    kind: "director-brief",
    payload: briefPayload,
    semanticAuthority: "director-supplied",
  });
  const attempt = compileRecord({
    id: `attempt-${activityId}`,
    kind: "agent-attempt",
    payload: Object.freeze({
      ...validDeliveryControlPayload("agent-attempt"),
      activityId,
      operation,
    }),
    relationships: [Object.freeze({ relation: "uses-brief", target: ref("director-brief", brief) })],
  });
  const workProduct = compileRecord({
    id: `work-product-${activityId}`,
    kind: "agent-work-product",
    payload: workProductPayload(
      selectedMeaning,
      checkRequirements,
      obligationSourceIds,
      externalSource,
      discipline,
      projectionProfile,
      knowledgeCitation,
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
    discipline,
    directorBrief: ref("director-brief", brief),
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
    repository?: WorkBoundaryRepositoryBasis;
    projectionProfile?: {semanticProfile:"execution-standard-v1" | "execution-large-v1";id:string;digest:Sha256};
  }> | null = null,
) {
  return retainWorkBoundary({
    store: fixture.store,
    activityId,
    operation,
    ...sources,
    repository: resolution?.repository ?? (resolution?.activeBoundary == null ? {
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
    } : (() => {
      const value = fixture.revisions.get(`${resolution.activeBoundary.id}\u0000${resolution.activeBoundary.revision}`)!;
      const { specificationRevision: _specification, repositoryContract: _contract, providerAdapter: _provider, ...basis } = value.payload.basis as ControlJsonObject;
      return basis as WorkBoundaryRepositoryBasis;
    })()),
    knowledge: [knowledge, ...(sources.discipline === null ? [] : [sources.discipline])],
    disciplineRegistry: sources.discipline === null ? createEmptyDisciplineRegistry() : {
      digest: digest("selected-discipline-registry"),
      adoptions: [{ ...sources.discipline }],
      workTypes: [{ id: "go-development", disciplineIds: [sources.discipline.id] }],
    },
    externalSources: sources.externalSources,
    capabilityProfile: { id: "capability.builder-standard", digest: digest("capability") },
    projectionProfile: resolution?.projectionProfile ?? {
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

test("Work Boundary Knowledge citations bind exact source bytes through aliases or qualified occurrences", () => {
  assert.notEqual(knowledge.sourceDigest, knowledge.semanticDigest);
  const qualified = knowledgeOccurrenceItemId({ basis: "base", ...knowledge });
  const cases = [
    { subjectId: KNOWLEDGE_ID, subjectKind: "knowledge", subjectDigest: knowledge.sourceDigest, valid: true },
    { subjectId: qualified, subjectKind: "knowledge", subjectDigest: knowledge.sourceDigest, valid: true },
    { subjectId: KNOWLEDGE_ID, subjectKind: "knowledge", subjectDigest: knowledge.semanticDigest, valid: false },
    { subjectId: qualified, subjectKind: "knowledge", subjectDigest: digest("another-record-source"), valid: false },
    { subjectId: qualified, subjectKind: "source", subjectDigest: knowledge.sourceDigest, valid: false },
  ] as const;
  for (const { valid, ...citation } of cases) {
    const fixture = fakeStore();
    const sources = addReconnaissance(fixture, "activity.prepare", "delivery.prepare", "Select exact Knowledge.",
      undefined, undefined, null, null, "execution-standard-v1", citation);
    if (valid) {
      const result = retain(fixture, "activity.prepare", "delivery.prepare", sources);
      assert.deepEqual(result.revision.payload.knowledge, [knowledge]);
    } else {
      assert.throws(() => retain(fixture, "activity.prepare", "delivery.prepare", sources),
        (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.control-work-boundary.citation");
      assert.equal(fixture.appended.length, 0);
    }
  }
});

test("Work Boundary retains exact advisory Discipline selection as independent JSON values", () => {
  const fixture = fakeStore();
  const discipline = Object.freeze({
    ...knowledge,
    id: "discipline.go-review",
    sourceDigest: digest("discipline-source"),
    semanticDigest: digest("discipline-semantics"),
  });
  const sources = addReconnaissance(fixture, "activity.prepare", "delivery.prepare", "Compile exact selected guidance.",
    undefined, undefined, null, discipline);
  const result = retain(fixture, "activity.prepare", "delivery.prepare", sources);
  const selected = result.revision.payload.disciplines as ControlJsonObject;
  assert.deepEqual(selected, {
    registryDigest: digest("selected-discipline-registry"), workTypeIds: ["go-development"], records: [discipline],
  });
  assert.deepEqual(result.revision.payload.knowledge, [knowledge, discipline]);
  const mandate = result.revision.payload.mandate as ControlJsonObject;
  assert.equal((mandate.obligations as readonly unknown[]).length, 1);
  assert.equal((mandate.checks as readonly unknown[]).length, 1);
  assert.equal((mandate.acceptancePropositions as readonly unknown[]).length, 1);
  assert.equal(result.event.eventKind, "work-boundary-finalized");
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
    relationships: [{ relation: "governed-by", target: activeBoundary }],
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

test("registered Projection capacity changes preserve reaffirmation of the exact product mandate", () => {
  const fixture = fakeStore();
  const initialSources = addReconnaissance(fixture,"activity.prepare","delivery.prepare","Preserve the exact mandate.");
  const initial = retain(fixture,"activity.prepare","delivery.prepare",initialSources);
  const activeBoundary = ref("work-boundary",initial.revision);
  const condition = compileRecord({id:"condition.projection-capacity",kind:"material-condition",
    payload:validDeliveryControlPayload("material-condition"),relationships:[{relation:"governed-by",target:activeBoundary}]});
  fixture.revisions.set(`${condition.recordId}\u0000${condition.revision}`,condition);
  const materialCondition = ref("material-condition",condition);
  fixture.setState({activityId:"activity.reaffirm",operation:"delivery.reaffirm",activeBoundary,materialCondition});
  const sources = addReconnaissance(fixture,"activity.reaffirm","delivery.reaffirm","Preserve the exact mandate.",
    undefined,undefined,null,null,"execution-large-v1");
  const projectionProfile = {semanticProfile:"execution-large-v1" as const,id:"projection.execution-large",digest:digest("large-projection")};
  const result = retain(fixture,"activity.reaffirm","delivery.reaffirm",sources,{activeBoundary,materialCondition,projectionProfile});
  assert.equal(result.revision.payload.proposalKind,"reaffirmation");
  assert.deepEqual(result.revision.payload.projectionProfile,{id:projectionProfile.id,digest:projectionProfile.digest});
  assert.deepEqual((result.revision.payload.resolution as ControlJsonObject).changedMandateFields,[]);
  assert.deepEqual(result.revision.payload.mandate,initial.revision.payload.mandate);
  assert.deepEqual(result.revision.payload.capabilityProfile,initial.revision.payload.capabilityProfile);
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
    relationships: [{ relation: "governed-by", target: activeBoundary }],
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

test("integration Condition selects exact P for reaffirmation without inventing changed product requirements", () => {
  const fixture = fakeStore();
  const sources = addReconnaissance(fixture, "activity.prepare", "delivery.prepare", "Preserve the exact mandate.");
  const initial = retain(fixture, "activity.prepare", "delivery.prepare", sources).revision;
  const activeBoundary = ref("work-boundary", initial);
  const oldBasis = initial.payload.basis as ControlJsonObject;
  const parentBody = {
    targetId: identity.targetId, commit: "c".repeat(40), tree: "d".repeat(40), objectFormat: "sha1" as const,
    contractDigest: oldBasis.repositoryContractDigest as Sha256,
    productStateDigest: digest("parent-product"), atlasStateDigest: digest("parent-atlas"),
    atlasResolutionDigest: digest("parent-resolution"), atlasNormalizedModelDigest: digest("parent-model"),
    atlasResourceBindingsDigest: digest("parent-resources"), knowledgeSetDigest: oldBasis.knowledgeSetDigest as Sha256,
  };
  const parent = Object.freeze({ ...parentBody, digest: selfDigest(parentBody) });
  const source = compileRecord({ id: "candidate-resolution", kind: "candidate-revision",
    semanticAuthority: "runtime-observed", payload: validDeliveryControlPayload("candidate-revision"),
    relationships: [{ relation: "governed-by", target: activeBoundary }] });
  const sourceRef = { kind: source.recordKind, id: source.recordId, revision: source.revision, digest: source.digest };
  const applicability = { disposition: "requires-readmission", changes: [{ subject: "atlas",
    admittedDigest: oldBasis.atlasStateDigest!, parentDigest: parent.atlasStateDigest }] };
  const assessment = compileRecord({ id: "integration-resolution", kind: "integration-assessment",
    semanticAuthority: "runtime-observed", payload: {
      schema: "lifecycle.integration-assessment-payload.v1", profileId: "lifecycle.integration-assessment.foundation-v1",
      canonicalParent: parent, mergeRule: { id: "lifecycle.integration.three-way.v2", implementationId: "fixture-merge", implementationDigest: digest("merge") },
      outcome: "constructed", conflicts: [], validation: { complete: true, valid: true, diagnosticCodes: [],
        factsDigest: foundationIntegrationValidationFactsDigestV1({
          manifestFileDigest: (source.payload.carrierManifest as ControlJsonObject).digest as Sha256,
          state: source.payload.state, observer: source.payload.observer,
        }) },
      contextualApplicability: applicability, assessedAt: CREATED, limitations: [],
    }, relationships: [{ relation: "governed-by", target: activeBoundary }, { relation: "integrates", target: sourceRef }] });
  const assessmentRef = { kind: assessment.recordKind, id: assessment.recordId, revision: assessment.revision, digest: assessment.digest };
  const integrated = compileRecord({ id: source.recordId, revision: 2, kind: "candidate-revision", semanticAuthority: "runtime-observed",
    payload: { ...source.payload, observation: "integration-successor", candidateBaseCommit: parent.commit },
    relationships: [{ relation: "governed-by", target: activeBoundary }, { relation: "revises", target: sourceRef },
      { relation: "integrated-from", target: assessmentRef }] });
  const condition = compileRecord({ id: "condition-integration-resolution", kind: "material-condition",
    semanticAuthority: "runtime-observed", payload: { ...validDeliveryControlPayload("material-condition"),
      conditionClass: "integration-context-change", source: { kind: "integration-assessment" }, observedFactsDigest: digestCanonical(applicability) },
    relationships: [{ relation: "governed-by", target: activeBoundary }, { relation: "reported-by", target: assessmentRef },
      { relation: "freezes", target: { kind: integrated.recordKind, id: integrated.recordId, revision: integrated.revision, digest: integrated.digest } }] });
  for (const record of [source, assessment, integrated, condition]) fixture.revisions.set(`${record.recordId}\u0000${record.revision}`, record);
  const materialCondition = ref("material-condition", condition);
  const selected = resolveWorkBoundaryResolutionSnapshotV1({ store: fixture.store, boundary: initial, materialCondition: condition });
  assert.deepEqual(selected, parent);
  fixture.setState({ activityId: "activity.reaffirm", operation: "delivery.reaffirm", activeBoundary, materialCondition });
  const reaffirmSources = addReconnaissance(fixture, "activity.reaffirm", "delivery.reaffirm", "Preserve the exact mandate.");
  assert.throws(() => retain(fixture, "activity.reaffirm", "delivery.reaffirm", reaffirmSources,
    { activeBoundary, materialCondition }), (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.control-work-boundary.basis",
  "An integration Condition cannot silently reuse W(B)");
  const result = retain(fixture, "activity.reaffirm", "delivery.reaffirm", reaffirmSources,
    { activeBoundary, materialCondition, repository: workBoundaryRepositoryBasisFromSnapshot(parent) });
  assert.equal((result.revision.payload.basis as ControlJsonObject).productBaseCommit, parent.commit);
  assert.deepEqual((result.revision.payload.resolution as ControlJsonObject).changedMandateFields, []);
  assert.equal((initial.payload.basis as ControlJsonObject).productBaseCommit, "a".repeat(40));
  const wrongCondition = compileRecord({ id: condition.recordId, kind: "material-condition", semanticAuthority: "runtime-observed",
    payload: { ...condition.payload, observedFactsDigest: digest("wrong-facts") }, relationships: condition.relationships });
  fixture.revisions.set(`${wrongCondition.recordId}\u0000${wrongCondition.revision}`, wrongCondition);
  assert.throws(() => resolveWorkBoundaryResolutionSnapshotV1({ store: fixture.store, boundary: initial, materialCondition: wrongCondition }),
    (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.control-work-boundary.basis");
});

function reviewerResolutionFixture(mode: "ordinary" | "mandate" | "baseline", mutation?: "seal" | "receipt" | "parent") {
  const fixture = evidenceFixtureV7({ materialCondition: true });
  const boundary = fixture.store.getRevision(fixture.selected.boundary.id, fixture.selected.boundary.revision)!;
  const replacements = new Map<string, ControlRecordRevision>();
  const records = ["integration-evidence", "candidate-evidence", "candidate-seal-evidence", "agent-attempt-review",
    "check-receipt-final", "agent-work-product-review", "execution-receipt-review", "material-condition-evidence"];
  for (const id of records) {
    const old = fixture.store.getRevision(id, id === "candidate-evidence" ? 2 : 1)!;
    let payload = old.payload;
    if (old.recordKind === "integration-assessment") {
      const parent = { ...(payload.canonicalParent as ControlJsonObject), commit: "e".repeat(40), tree: "f".repeat(40) };
      payload = { ...payload, canonicalParent: { ...parent, digest: selfDigest(parent) } };
    } else if (old.recordKind === "candidate-revision") {
      payload = { ...payload, candidateBaseCommit: mutation === "parent" ? "d".repeat(40) : "e".repeat(40) };
    } else if (old.recordKind === "agent-work-product") {
      const semantics = payload.roleSemantics as ControlJsonObject;
      payload = { ...payload, roleSemantics: { ...semantics,
        mandateApplicability: { ...(semantics.mandateApplicability as ControlJsonObject),
          disposition: mode === "mandate" ? "requires-readmission" : "applicable" },
        baselineApplicability: (semantics.baselineApplicability as readonly ControlJsonObject[]).map((item) => ({ ...item,
          disposition: mode === "baseline" ? "insufficient" : "applicable" })),
      } };
    }
    const relationships = old.relationships.map((edge) => {
      const replacement = replacements.get(edge.target.digest);
      let target = replacement === undefined ? edge.target : { kind: replacement.recordKind, id: replacement.recordId,
        revision: replacement.revision, digest: replacement.digest };
      if (mutation === "seal" && old.recordKind === "candidate-seal" && edge.relation === "seals") {
        const source = fixture.store.getRevision("candidate-evidence", 1)!;
        target = { kind: source.recordKind, id: source.recordId, revision: source.revision, digest: source.digest };
      }
      if (mutation === "receipt" && old.recordKind === "execution-receipt" && edge.relation === "observes-attempt") {
        const unrelated = fixture.store.getRevision("agent-attempt-prepare-evidence", 1)!;
        target = { kind: unrelated.recordKind, id: unrelated.recordId, revision: unrelated.revision, digest: unrelated.digest };
      }
      return { relation: edge.relation, target: { ...target } };
    });
    const next = compileControlRecordRevision(fixture.identity.processId, { ...old, payload, relationships });
    fixture.revisions.set(`${next.recordId}\0${next.revision}`, next);
    replacements.set(old.digest, next);
  }
  return { fixture, boundary, condition: fixture.store.getRevision("material-condition-evidence", 1)! };
}

for (const mode of ["mandate", "baseline"] as const) {
  test(`reviewer ${mode} applicability Condition selects exact retained P for new baselines`, () => {
    const { fixture, boundary, condition } = reviewerResolutionFixture(mode);
    const selected = resolveWorkBoundaryResolutionSnapshotV1({ store: fixture.store, boundary, materialCondition: condition });
    assert.equal(selected.commit, "e".repeat(40));
    assert.notEqual(selected.commit, (boundary.payload.basis as ControlJsonObject).productBaseCommit);
    assert.equal(((fixture.store.getRevision("integration-evidence", 1)!.payload.contextualApplicability) as ControlJsonObject).disposition, "unchanged",
      "Independent reviewer judgment can require P baselines despite an unchanged mechanical context comparison");
  });
}

test("ordinary reviewer Condition retains W(B), while applicability resolution rejects foreign existing joins", () => {
  const ordinary = reviewerResolutionFixture("ordinary");
  assert.equal(resolveWorkBoundaryResolutionSnapshotV1({ store: ordinary.fixture.store, boundary: ordinary.boundary,
    materialCondition: ordinary.condition }).commit, (ordinary.boundary.payload.basis as ControlJsonObject).productBaseCommit);
  for (const mutation of ["seal", "receipt", "parent"] as const) {
    const { fixture, boundary, condition } = reviewerResolutionFixture("baseline", mutation);
    assert.throws(() => resolveWorkBoundaryResolutionSnapshotV1({ store: fixture.store, boundary, materialCondition: condition }),
      (error: unknown) => error instanceof FoundationError && ["lifecycle.control-work-boundary.basis", "lifecycle.integration.assessment-invalid"].includes(error.code), mutation);
  }
});
