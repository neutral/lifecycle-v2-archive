import assert from "node:assert/strict";
import test from "node:test";
import { compileControlRecordRevision } from "../../src/foundation/control/model.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import type {
  ControlJsonObject,
  ControlRecordRelationship,
  ControlRecordRevision,
} from "../../src/foundation/control/types.js";
import type { FoundationInstalledRuntimeConfigurationV7 } from "../../src/foundation/installed-configuration-v7.js";
import { FoundationError } from "../../src/foundation/error.js";
import type {
  FoundationAgentOperationPreIntentContextV7,
  FoundationAgentOperationV7Input,
  FoundationAgentOperationV7Result,
  FoundationAgentRoleControlContextV7,
} from "../../src/foundation/process/agent-operation-v7.js";
import {
  operateFoundationCandidateAgentRuntimeV7,
  recoverFoundationCandidateAgentRuntimeV7,
  type FoundationCandidateAgentRuntimeOperationV7,
  type FoundationCandidateAgentRuntimeV7Options,
} from "../../src/foundation/process/candidate-agent-runtime-v7.js";
import type {
  FoundationBuilderAgentOperationContextV7,
  FoundationBoundaryResolutionAgentOperationContextV7,
  FoundationFreshAgentOperationContextV7,
  FoundationRetainedAgentOperationContextV7,
} from "../../src/foundation/process/operation-context-v7.js";
import type {
  FoundationLoadedRepositoryEpoch,
  FoundationRepositoryContract,
} from "../../src/foundation/repository/types.js";
import { sha256Bytes, type Sha256 } from "../../src/foundation/validation/canonical.js";
import { minimalAtlasRepositoryState } from "../helpers/atlas-fixture.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

const TARGET = "candidate-agent-runtime-v7-target";
const PROCESS = "candidate-agent-runtime-v7-delivery";
const CREATED = "2026-08-29T23:00:00.000Z";
const BASE = "a".repeat(40);
const TREE = "b".repeat(40);

function digest(label: string): Sha256 {
  return sha256Bytes(`candidate-agent-runtime-v7:${label}`);
}

function revision(input: Readonly<{
  id: string;
  kind: string;
  revision?: number;
  payload: ControlJsonObject;
  relationships?: readonly ControlRecordRelationship[];
}>): ControlRecordRevision {
  return compileControlRecordRevision(PROCESS, {
    recordId: input.id,
    recordKind: input.kind,
    revision: input.revision ?? 1,
    producer: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
    semanticAuthor: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
    semanticAuthority: "runtime-derived",
    createdAt: CREATED,
    semanticMarkdown: `# ${input.kind}\n`,
    payload: input.payload,
    relationships: input.relationships ?? Object.freeze([]),
  });
}

const contract = Object.freeze({
  targetId: TARGET,
  digest: digest("contract"),
}) as unknown as FoundationRepositoryContract;

const boundary = revision({
  id: "boundary-candidate-agent-runtime-v7",
  kind: "work-boundary",
  payload: Object.freeze({
    schema: "lifecycle.work-boundary-payload.v6",
    targetId: TARGET,
    basis: Object.freeze({ repositoryContractDigest: contract.digest }),
    mandate: Object.freeze({
      artifacts: Object.freeze([
        Object.freeze({ id: "artifact-z", path: "src/z.ts" }),
        Object.freeze({ id: "artifact-a", path: "src/a.ts" }),
      ]),
    }),
  }),
});

const candidatePayload = validDeliveryControlPayload("candidate-revision");
const candidate = revision({
  id: "candidate-candidate-agent-runtime-v7",
  kind: "candidate-revision",
  payload: Object.freeze({
    ...candidatePayload,
    observation: "initialization",
    candidateBaseCommit: BASE,
    state: Object.freeze({
      ...(candidatePayload.state as ControlJsonObject),
      tree: TREE,
      candidateDigest: digest("candidate-state"),
    }),
  }),
  relationships: Object.freeze([Object.freeze({
    relation: "governed-by",
    target: Object.freeze({
      kind: boundary.recordKind,
      id: boundary.recordId,
      revision: boundary.revision,
      digest: boundary.digest,
    }),
  })]),
});

const store = Object.freeze({
  identity: Object.freeze({ targetId: TARGET, processId: PROCESS, storeId: "store-candidate-agent-runtime-v7" }),
  getRevision: () => null,
  getOperationSupport: () => null,
}) as unknown as ControlRecordStore;

const configuration = Object.freeze({
  machineHome: "/tmp/candidate-agent-runtime-v7-machine",
  installationId: `installation.lifecycle.${"1".repeat(64)}`,
  codexHome: "/tmp/codex-home",
  model: "installed-model",
  reasoning: "installed-reasoning",
  specificationRevision: "lifecycle.foundation.1.0.0-rc.17",
  publicationDigest: digest("publication"),
}) as FoundationInstalledRuntimeConfigurationV7;

const atlasFixture = minimalAtlasRepositoryState();
const epoch = Object.freeze({
  repository: "/tmp/candidate-agent-runtime-v7-target",
  contract,
  epoch: Object.freeze({ ref: "refs/heads/main", commit: BASE, tree: TREE, objectFormat: "sha1" }),
  treeEntries: atlasFixture.treeEntries,
  productState: Object.freeze({ entries: Object.freeze([]), digest: digest("product") }),
  atlasState: atlasFixture.atlasState,
  atlas: atlasFixture.atlas,
  worktree: Object.freeze({
    dirty: false,
    modified: Object.freeze([]),
    untracked: Object.freeze([]),
    ignored: Object.freeze([]),
  }),
}) as FoundationLoadedRepositoryEpoch;

function context(
  operation: FoundationCandidateAgentRuntimeOperationV7,
): FoundationFreshAgentOperationContextV7 {
  const common = Object.freeze({
    activityId: `activity-${operation.slice("delivery.".length)}`,
    semanticMarkdown: `# ${operation}\n`,
    boundary,
    candidate,
    attemptSeal: null,
    seal: null,
    epoch,
    projection: Object.freeze({
      manifest: Object.freeze({ digest: digest(`projection-${operation}`), basis: Object.freeze({}) }),
    }) as FoundationFreshAgentOperationContextV7["projection"],
    roleSubject: Object.freeze({ schema: "lifecycle.agent-role-subject.v3" }),
    capabilityProfile: Object.freeze({ id: "capability", digest: digest("capability") }),
    providerCapability: Object.freeze({}) as FoundationFreshAgentOperationContextV7["providerCapability"],
    providerInput: Object.freeze({
      contents: Object.freeze([Object.freeze({
        path: "role-brief.md",
        bytes: Uint8Array.from(Buffer.from("# Exact provider input\n", "utf8")),
      })]),
    }) as FoundationFreshAgentOperationContextV7["providerInput"],
    propositionSet: null,
    investment: Object.freeze({
      id: "investment",
      model: "funded-model",
      reasoning: "funded-reasoning",
      wallTimeMs: 1,
      limits: Object.freeze({
        tokens: null,
        events: 1,
        outputBytes: 1,
        toolCalls: null,
        processes: 1,
        storageBytes: 1,
      }),
      rationale: "test",
      digest: digest("investment"),
    }),
    rootTokenSetDigest: digest("root-tokens"),
  });
  if (operation === "delivery.continue") {
    return Object.freeze({
      ...common,
      operation,
      role: "builder",
      materialCondition: null,
      snapshot: Object.freeze({}) as FoundationBuilderAgentOperationContextV7["snapshot"],
      repositoryValidation: Object.freeze({}) as FoundationBuilderAgentOperationContextV7["repositoryValidation"],
      knowledge: Object.freeze({}) as FoundationBuilderAgentOperationContextV7["knowledge"],
      request: Object.freeze({ class: "execution" }) as FoundationBuilderAgentOperationContextV7["request"],
      subject: Object.freeze({}) as FoundationBuilderAgentOperationContextV7["subject"],
      evidenceSet: Object.freeze({ digest: digest("evidence") }) as FoundationBuilderAgentOperationContextV7["evidenceSet"],
    });
  }
  return Object.freeze({
    ...common,
    operation,
    role: "reconnaissance",
    materialCondition: revision({
      id: `condition-${operation.slice("delivery.".length)}`,
      kind: "material-condition",
      payload: Object.freeze({ schema: "lifecycle.material-condition-payload.v4" }),
    }),
    snapshot: null,
    repositoryValidation: null,
    knowledge: null,
    request: Object.freeze({ class: "orientation" }) as FoundationBoundaryResolutionAgentOperationContextV7["request"],
    subject: null,
    evidenceSet: null,
  });
}

function result(operation: FoundationCandidateAgentRuntimeOperationV7): FoundationAgentOperationV7Result {
  const ref = Object.freeze({ id: "ref", revision: 1, digest: digest("result-ref") });
  return Object.freeze({
    activityId: `activity-${operation.slice("delivery.".length)}`,
    operation,
    outcome: "completed",
    attempt: ref,
    workProduct: ref,
    candidate: ref,
    receipt: ref,
    controls: Object.freeze([]),
  });
}

function preIntent(
  request: FoundationAgentOperationV7Input,
): FoundationAgentOperationPreIntentContextV7 {
  return Object.freeze({
    store,
    activityId: request.activityId,
    operation: request.operation,
    role: request.operation === "delivery.continue" ? "builder" : "reconnaissance",
    brief: revision({ id: `brief-${request.activityId}`, kind: "director-brief", payload: Object.freeze({}) }),
    boundary: request.boundary,
    candidate: request.candidate,
    seal: null,
    projection: request.projection,
  });
}

function roleContext(request: FoundationAgentOperationV7Input): FoundationAgentRoleControlContextV7 {
  const common = Object.freeze({
    store,
    activityId: request.activityId,
    brief: preIntent(request).brief,
    attempt: revision({ id: `attempt-${request.activityId}`, kind: "agent-attempt", payload: Object.freeze({}) }),
    boundary: request.boundary,
    attemptedCandidate: request.candidate,
    resultCandidate: request.candidate,
    workProduct: null,
    receipt: revision({ id: `receipt-${request.activityId}`, kind: "execution-receipt", payload: Object.freeze({}) }),
    support: Object.freeze({}) as FoundationAgentRoleControlContextV7["support"],
  });
  if (request.operation === "delivery.continue") return Object.freeze({...common,operation:"delivery.continue",role:"builder",seal:null});
  assert.ok(request.operation === "delivery.revise" || request.operation === "delivery.reaffirm");
  return Object.freeze({...common,operation:request.operation,role:"reconnaissance",seal:null});
}

function retainedContext(
  fresh: FoundationFreshAgentOperationContextV7,
  boundaryResolutionBasis: FoundationRetainedAgentOperationContextV7["boundaryResolutionBasis"] = null,
): FoundationRetainedAgentOperationContextV7 {
  return Object.freeze({
    ...fresh,
    configuration,
    opening: Object.freeze({
      agentId: "agent",
      runtimeId: "runtime",
      directorId: "director",
      submittedAt: CREATED,
      startedAt: CREATED,
      attemptCreatedAt: CREATED,
    }),
    brief: revision({ id: `brief-${fresh.activityId}`, kind: "director-brief", payload: Object.freeze({}) }),
    attempt: null,
    boundaryResolutionBasis,
  }) as FoundationRetainedAgentOperationContextV7;
}

function independentlyClonedProviderInput(
  value: FoundationFreshAgentOperationContextV7["providerInput"],
): FoundationFreshAgentOperationContextV7["providerInput"] {
  return Object.freeze({
    ...value,
    contents: Object.freeze(value.contents.map((entry) => Object.freeze({
      ...entry,
      bytes: Uint8Array.from(entry.bytes),
    }))),
  });
}

test("fresh correction reopens the exact Candidate while a prior Process Seal is not an Attempt binding", async () => {
  const fresh = Object.freeze({
    ...context("delivery.continue"),
    seal: revision({
      id: "seal-before-correction",
      kind: "candidate-seal",
      payload: validDeliveryControlPayload("candidate-seal"),
    }),
  });
  let retainedCompilations = 0;
  let finalized = 0;
  const options: FoundationCandidateAgentRuntimeV7Options = {
    compileFreshContext: (async () => fresh) as typeof options.compileFreshContext,
    compileRetainedContext: (async () => {
      retainedCompilations += 1;
      return Object.freeze({
        ...retainedContext(fresh),
        providerInput: independentlyClonedProviderInput(fresh.providerInput),
      });
    }) as typeof options.compileRetainedContext,
    finalizeCandidate: (async (input) => {
      finalized += 1;
      assert.equal(input.runtimeId, "runtime-fresh");
      return Object.freeze({ outcome: "completed", controls: Object.freeze([]) });
    }) as typeof options.finalizeCandidate,
    operateAgent: (async (request: FoundationAgentOperationV7Input) => {
      assert.equal(request.configuration, configuration);
      assert.equal(request.targetRepository, epoch.repository);
      assert.equal(request.seal, null, "The prior evaluation Seal does not bind the builder Attempt");
      await request.revalidateBeforeIntent(preIntent(request));
      await request.finalizeRoleControl(roleContext(request));
      return result("delivery.continue");
    }) as typeof options.operateAgent,
  };
  const actual = await operateFoundationCandidateAgentRuntimeV7({
    target: epoch.repository,
    store,
    configuration,
    activityId: fresh.activityId,
    operation: "delivery.continue",
    runtimeId: "runtime-fresh",
    agentId: "agent-fresh",
    opening: Object.freeze({
      semanticMarkdown: fresh.semanticMarkdown,
      submittedAt: CREATED,
      startedAt: CREATED,
      attemptCreatedAt: CREATED,
      directorId: "director",
    }),
  }, options);
  assert.equal(actual.operation, "delivery.continue");
  assert.equal(retainedCompilations, 1);
  assert.equal(finalized, 1);
});

test("unavailable or lookalike diagnostic failures cannot manufacture a builder Condition", async () => {
  for (const error of [new Error("temporarily unavailable context"),
    new FoundationError("lifecycle.projection.mandatory-too-large", "a matching diagnostic is not an owned measurement")]) {
    await assert.rejects(operateFoundationCandidateAgentRuntimeV7({ target: epoch.repository, store, configuration,
      activityId: "builder-context-refusal", operation: "delivery.continue", runtimeId: "runtime-fresh", agentId: "agent-fresh",
      opening: { semanticMarkdown: "# Continue\n", submittedAt: CREATED, startedAt: CREATED, attemptCreatedAt: CREATED, directorId: "director" },
    }, { compileFreshContext: async () => { throw error; },
      operateAgent: async () => assert.fail("unavailable context must not open or allocate an Agent") }), (observed) => observed === error);
  }
});

test("pre-intent uses the compiled Atlas context without reobserving canonical Atlas", async () => {
  const fresh = context("delivery.continue");
  const options: FoundationCandidateAgentRuntimeV7Options = {
    compileFreshContext: (async () => fresh) as typeof options.compileFreshContext,
    compileRetainedContext: (async () => retainedContext(fresh)) as typeof options.compileRetainedContext,
    operateAgent: (async (request: FoundationAgentOperationV7Input) => {
      assert.equal(request.targetRepository, epoch.repository);
      await request.revalidateBeforeIntent(preIntent(request));
      return result("delivery.continue");
    }) as typeof options.operateAgent,
  };
  const actual = await operateFoundationCandidateAgentRuntimeV7({
    target: epoch.repository,
    store,
    configuration,
    activityId: fresh.activityId,
    operation: "delivery.continue",
    runtimeId: "runtime",
    agentId: "agent",
    opening: Object.freeze({
      semanticMarkdown: fresh.semanticMarkdown,
      submittedAt: CREATED,
      startedAt: CREATED,
      attemptCreatedAt: CREATED,
      directorId: "director",
    }),
  }, options);
  assert.equal(actual.operation, "delivery.continue");
});

test("fresh revise recompiles an own-activity-excluding retained basis for shared finalization", async () => {
  const fresh = context("delivery.revise");
  const resolutionBasis = Object.freeze({
    snapshot: Object.freeze({}) as NonNullable<FoundationRetainedAgentOperationContextV7["boundaryResolutionBasis"]>["snapshot"],
    knowledge: Object.freeze({}) as NonNullable<FoundationRetainedAgentOperationContextV7["boundaryResolutionBasis"]>["knowledge"],
    projection: fresh.projection,
  });
  let retainedCompilations = 0;
  let finalized = 0;
  const retained = Object.freeze({
    ...fresh,
    configuration,
    opening: Object.freeze({
      agentId: "agent",
      runtimeId: "runtime",
      directorId: "director",
      submittedAt: CREATED,
      startedAt: CREATED,
      attemptCreatedAt: CREATED,
    }),
    brief: revision({ id: "brief-revise", kind: "director-brief", payload: Object.freeze({}) }),
    attempt: null,
    boundaryResolutionBasis: resolutionBasis,
  }) as FoundationRetainedAgentOperationContextV7;
  const options: FoundationCandidateAgentRuntimeV7Options = {
    compileFreshContext: (async () => fresh) as typeof options.compileFreshContext,
    compileRetainedContext: (async () => {
      retainedCompilations += 1;
      return retained;
    }) as typeof options.compileRetainedContext,
    finalizeBoundary: (async (_role, basis, finalization) => {
      finalized += 1;
      assert.equal(basis, resolutionBasis);
      assert.equal(finalization.machineHome, configuration.machineHome);
      return Object.freeze({ outcome: "completed", controls: Object.freeze([]) });
    }) as typeof options.finalizeBoundary,
    operateAgent: (async (request: FoundationAgentOperationV7Input) => {
      assert.equal(request.targetRepository, epoch.repository);
      await request.revalidateBeforeIntent(preIntent(request));
      await request.finalizeRoleControl(roleContext(request));
      return result("delivery.revise");
    }) as typeof options.operateAgent,
  };
  await operateFoundationCandidateAgentRuntimeV7({
    target: epoch.repository,
    store,
    configuration,
    activityId: fresh.activityId,
    operation: "delivery.revise",
    runtimeId: "runtime",
    agentId: "agent",
    opening: Object.freeze({
      semanticMarkdown: fresh.semanticMarkdown,
      submittedAt: CREATED,
      startedAt: CREATED,
      attemptCreatedAt: CREATED,
      directorId: "director",
    }),
  }, options);
  assert.equal(retainedCompilations, 2);
  assert.equal(finalized, 1);
});

test("reaffirm recovery uses retained identities, semantics, and funded provider configuration", async () => {
  const base = context("delivery.reaffirm");
  const effectiveConfiguration = Object.freeze({
    ...configuration,
    model: "retained-model",
    reasoning: "retained-reasoning",
  });
  const retained = Object.freeze({
    ...base,
    configuration: effectiveConfiguration,
    semanticMarkdown: "# Retained semantics\n",
    opening: Object.freeze({
      agentId: "retained-agent",
      runtimeId: "retained-runtime",
      directorId: "retained-director",
      submittedAt: "2026-08-29T23:01:00.000Z",
      startedAt: "2026-08-29T23:02:00.000Z",
      attemptCreatedAt: "2026-08-29T23:03:00.000Z",
    }),
    brief: revision({ id: "brief-reaffirm", kind: "director-brief", payload: Object.freeze({}) }),
    attempt: revision({ id: "attempt-reaffirm", kind: "agent-attempt", payload: Object.freeze({}) }),
    boundaryResolutionBasis: Object.freeze({
      snapshot: Object.freeze({}),
      knowledge: Object.freeze({}),
      projection: base.projection,
    }),
  }) as unknown as FoundationRetainedAgentOperationContextV7;
  let compilations = 0;
  const options: FoundationCandidateAgentRuntimeV7Options = {
    compileRetainedContext: (async () => {
      compilations += 1;
      return retained;
    }) as typeof options.compileRetainedContext,
    finalizeBoundary: (async () =>
      Object.freeze({ outcome: "completed", controls: Object.freeze([]) })) as typeof options.finalizeBoundary,
    recoverAgent: (async (request: FoundationAgentOperationV7Input) => {
      assert.equal(request.configuration, effectiveConfiguration);
      assert.equal(request.runtimeId, "retained-runtime");
      assert.equal(request.agentId, "retained-agent");
      assert.equal(request.opening.semanticMarkdown, retained.semanticMarkdown);
      assert.equal(request.opening.attemptCreatedAt, retained.opening.attemptCreatedAt);
      await request.revalidateBeforeIntent(preIntent(request));
      await request.finalizeRoleControl(roleContext(request));
      return result("delivery.reaffirm");
    }) as typeof options.recoverAgent,
  };
  const actual = await recoverFoundationCandidateAgentRuntimeV7({
    target: epoch.repository,
    store,
    configuration,
    activityId: retained.activityId,
    operation: "delivery.reaffirm",
  }, options);
  assert.equal(actual.operation, "delivery.reaffirm");
  assert.equal(compilations, 3);
});

test("pre-intent subject substitution is rejected before retained Candidate reopening", async () => {
  const fresh = context("delivery.continue");
  let retainedCompilations = 0;
  const substitute = revision({
    id: "candidate-substitute",
    kind: "candidate-revision",
    payload: candidate.payload,
    relationships: candidate.relationships,
  });
  const options: FoundationCandidateAgentRuntimeV7Options = {
    compileFreshContext: (async () => fresh) as typeof options.compileFreshContext,
    compileRetainedContext: (async () => {
      retainedCompilations += 1;
      return retainedContext(fresh);
    }) as typeof options.compileRetainedContext,
    operateAgent: (async (request: FoundationAgentOperationV7Input) => {
      await request.revalidateBeforeIntent(Object.freeze({
        ...preIntent(request),
        candidate: substitute,
      }));
      return result("delivery.continue");
    }) as typeof options.operateAgent,
  };
  await assert.rejects(
    operateFoundationCandidateAgentRuntimeV7({
      target: epoch.repository,
      store,
      configuration,
      activityId: fresh.activityId,
      operation: "delivery.continue",
      runtimeId: "runtime",
      agentId: "agent",
      opening: Object.freeze({
        semanticMarkdown: fresh.semanticMarkdown,
        submittedAt: CREATED,
        startedAt: CREATED,
        attemptCreatedAt: CREATED,
        directorId: "director",
      }),
    }, options),
    /pre-intent subjects differ/u,
  );
  assert.equal(retainedCompilations, 0);
});

test("pre-intent revalidation rejects substituted Provider Input bytes", async () => {
  const fresh = context("delivery.continue");
  const original = fresh.providerInput.contents[0];
  assert.ok(original);
  const substitutedProviderInput = Object.freeze({
    ...fresh.providerInput,
    contents: Object.freeze([Object.freeze({
      ...original,
      bytes: Uint8Array.from(Buffer.from("# Substituted provider input\n", "utf8")),
    })]),
  });
  const options: FoundationCandidateAgentRuntimeV7Options = {
    compileFreshContext: (async () => fresh) as typeof options.compileFreshContext,
    compileRetainedContext: (async () => Object.freeze({
      ...retainedContext(fresh),
      providerInput: substitutedProviderInput,
    })) as typeof options.compileRetainedContext,
    operateAgent: (async (request: FoundationAgentOperationV7Input) => {
      await request.revalidateBeforeIntent(preIntent(request));
      return result("delivery.continue");
    }) as typeof options.operateAgent,
  };
  await assert.rejects(
    operateFoundationCandidateAgentRuntimeV7({
      target: epoch.repository,
      store,
      configuration,
      activityId: fresh.activityId,
      operation: "delivery.continue",
      runtimeId: "runtime",
      agentId: "agent",
      opening: Object.freeze({
        semanticMarkdown: fresh.semanticMarkdown,
        submittedAt: CREATED,
        startedAt: CREATED,
        attemptCreatedAt: CREATED,
        directorId: "director",
      }),
    }, options),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.candidate-agent-runtime-v7.pre-intent-substitution",
  );
});
