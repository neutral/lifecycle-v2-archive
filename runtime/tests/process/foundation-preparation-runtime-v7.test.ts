import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after, before } from "node:test";
import { createDeliveryControlRecordStore } from "../../src/foundation/control/delivery-custody.js";
import { compileControlRecordRevision } from "../../src/foundation/control/model.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import {
  CONTROL_RECORD_STORE_SCHEMA,
  type ControlRecordRevision,
} from "../../src/foundation/control/types.js";
import type { FoundationInstalledRuntimeConfigurationV7 } from "../../src/foundation/installed-configuration-v7.js";
import type {
  FoundationAgentOperationSupportV7,
  FoundationPreparationAgentOperationV7Input,
  FoundationPreparationAgentOperationV7Result,
} from "../../src/foundation/process/agent-operation-v7.js";
import {
  assertFoundationPreparationBasisV7,
  preflightFoundationPreparationBasisV7,
  type FoundationPreparationBasisV7,
} from "../../src/foundation/process/preparation-context-v7.js";
import {
  operateFoundationPreparationRuntimeV7,
  recoverFoundationPreparationRuntimeV7,
} from "../../src/foundation/process/preparation-runtime-v7.js";
import { git } from "../../src/foundation/repository/git.js";
import { initializeRepository } from "../../src/foundation/repository/initialize.js";
import { digestCanonical, sha256Bytes } from "../../src/foundation/validation/canonical.js";
import {
  FOUNDATION_GENERATED_PUBLICATION_DIGEST,
  FOUNDATION_GENERATED_SPECIFICATION_REVISION,
} from "../../src/foundation/validation/generated-schemas.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";
import { writeMinimalAtlas } from "../helpers/atlas-fixture.js";

const SECRET = "preparation-runtime-v7-secret-at-least-thirty-two-bytes";
const RUNTIME = "foundation-runtime";
const AGENT = "foundation-agent";
const CREATED = "2026-08-29T20:00:00.000Z";
const SUBMITTED = "2026-08-29T20:01:00.000Z";
const ATTEMPTED = "2026-08-29T20:02:00.000Z";

type Fixture = Readonly<{
  target: string;
  machineHome: string;
  basis: FoundationPreparationBasisV7;
}>;

let fixture: Fixture;

function configuration(
  machineHome: string,
  model = "gpt-foundation-current",
  reasoning = "high",
): FoundationInstalledRuntimeConfigurationV7 {
  return Object.freeze({
    machineHome,
    installationId: `installation.lifecycle.${"1".repeat(64)}`,
    codexHome: join(machineHome, "codex-home"),
    model,
    reasoning,
    specificationRevision: FOUNDATION_GENERATED_SPECIFICATION_REVISION,
    publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
  });
}

function result(activityId: string): FoundationPreparationAgentOperationV7Result {
  const reference = Object.freeze({ id: "fixture", revision: 1, digest: sha256Bytes("fixture") });
  return Object.freeze({
    activityId,
    operation: "delivery.prepare",
    outcome: "completed",
    attempt: reference,
    workProduct: reference,
    candidate: null,
    receipt: reference,
    controls: Object.freeze([]),
  });
}

before(async () => {
  const target = await mkdtemp(join(tmpdir(), "lifecycle-preparation-runtime-target-"));
  const machineHome = await mkdtemp(join(tmpdir(), "lifecycle-preparation-runtime-home-"));
  await git(target, ["init", "-b", "main"]);
  await git(target, ["config", "user.name", "Lifecycle Test"]);
  await git(target, ["config", "user.email", "lifecycle@example.invalid"]);
  await writeMinimalAtlas(target);
  await git(target, ["add", "--", "atlas"]);
  await git(target, ["commit", "-m", "Initialize target"]);
  await initializeRepository(target, {
    targetId: "preparation-runtime-v7-target",
    founderPrincipal: "founder-preparation-runtime",
    home: machineHome,
    authoritySecret: SECRET,
    publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
    stage: true,
  });
  await git(target, ["add", "--", "."]);
  await git(target, ["commit", "-m", "Attach Lifecycle"]);
  const basis = await preflightFoundationPreparationBasisV7({
    target,
    semanticMarkdown: "# Prepare delivery\n\nObserve the repository and propose a boundary.",
    observedAt: CREATED,
  });
  fixture = Object.freeze({ target, machineHome, basis });
});

after(async () => {
  await Promise.all([
    rm(fixture.target, { recursive: true, force: true }),
    rm(fixture.machineHome, { recursive: true, force: true }),
  ]);
});

test("preflight compiles one complete exact preparation basis before Store creation", () => {
  const basis = fixture.basis;
  assert.doesNotThrow(() => assertFoundationPreparationBasisV7(basis));
  assert.equal(basis.semanticMarkdown, "# Prepare delivery\n\nObserve the repository and propose a boundary.\n");
  assert.equal(basis.repositoryValidation.complete, true);
  assert.equal(basis.repositoryValidation.valid, true);
  assert.equal(basis.knowledge.manifest.complete, true);
  assert.equal(basis.knowledge.manifest.valid, true);
  assert.equal(basis.projection.manifest.class, "orientation");
  assert.equal(basis.projection.manifest.role, "reconnaissance");
  assert.equal(basis.projection.manifest.basis.requestDigest, basis.request.digest);
  assert.deepEqual(
    basis.providerCapability.externalEffects,
    basis.epoch.contract.capabilityProfiles[basis.epoch.contract.defaults.capabilityProfileId]!.externalEffects,
  );
  assert.equal(basis.providerInput.founderDirection.markdown, basis.semanticMarkdown);
});

test("fresh owner consumes the preflight basis and delegates one common Agent Activity", async () => {
  const opened = await createDeliveryControlRecordStore({
    machineHome: fixture.machineHome,
    targetId: fixture.basis.epoch.contract.targetId,
    deliveryId: "preparation-runtime-v7-fresh",
    createdAt: CREATED,
    runtimeActorId: RUNTIME,
  });
  let request: FoundationPreparationAgentOperationV7Input | null = null;
  let epochGuarded = false;
  try {
    const selected = await operateFoundationPreparationRuntimeV7({
      store: opened.store,
      configuration: configuration(fixture.machineHome),
      activityId: "prepare-fresh",
      runtimeId: RUNTIME,
      agentId: AGENT,
      submittedAt: SUBMITTED,
      startedAt: SUBMITTED,
      attemptCreatedAt: ATTEMPTED,
      basis: fixture.basis,
    }, {
      boundaryFinalization: {
        machineHome: fixture.machineHome,
      },
      async assertEpochUnmoved(repository, epoch) {
        assert.equal(repository, fixture.basis.epoch.repository);
        assert.deepEqual(epoch, fixture.basis.epoch.epoch);
        epochGuarded = true;
      },
      async operateAgentActivity(input) {
        request = input;
        await input.revalidateBeforeIntent(Object.freeze({
          store: input.store,
          activityId: input.activityId,
          operation: "delivery.prepare",
          role: "reconnaissance",
          brief: null as unknown as ControlRecordRevision,
          boundary: null,
          candidate: null,
          seal: null,
          projection: input.projection,
        }));
        return result(input.activityId);
      },
    });
    assert.equal(selected.outcome, "completed");
    assert(request !== null);
    const captured = request as FoundationPreparationAgentOperationV7Input;
    assert.equal(captured.boundary, null);
    assert.equal(captured.candidate, null);
    assert.equal(captured.seal, null);
    assert.equal(captured.targetRepository, fixture.basis.epoch.repository);
    assert.equal(captured.opening.founderId, fixture.basis.epoch.contract.authority.principalId);
    assert.equal(captured.investment.rationale, "fresh-reconnaissance");
    assert.equal(captured.investment.model, "gpt-foundation-current");
    assert.equal(captured.providerInput, fixture.basis.providerInput);
    assert.equal(epochGuarded, true);
  } finally {
    opened.store.close();
  }
});

function retainedBrief(
  processId: string,
  basis: FoundationPreparationBasisV7,
  rawMarkdown: string,
): ControlRecordRevision {
  const source = validDeliveryControlPayload("founder-brief");
  return compileControlRecordRevision(processId, {
    recordId: "founder-brief-prepare-recovery",
    recordKind: "founder-brief",
    revision: 1,
    producer: Object.freeze({ kind: "runtime", id: RUNTIME }),
    semanticAuthor: Object.freeze({ kind: "founder", id: basis.epoch.contract.authority.principalId }),
    semanticAuthority: "founder-supplied",
    createdAt: SUBMITTED,
    semanticMarkdown: basis.semanticMarkdown,
    payload: Object.freeze({
      ...source,
      inputProfile: "delivery.prepare",
      templateProfileId: "founder-brief.direction-v1",
      semanticMarkdownDigest: sha256Bytes(basis.semanticMarkdown),
      submission: Object.freeze({
        rawDigest: sha256Bytes(rawMarkdown),
        rawByteLength: Buffer.byteLength(rawMarkdown, "utf8"),
        normalizedByteLength: Buffer.byteLength(basis.semanticMarkdown, "utf8"),
      }),
    }),
    relationships: Object.freeze([]),
  });
}

function support(
  brief: ControlRecordRevision,
  rawMarkdown: string,
): FoundationAgentOperationSupportV7 {
  const retainedInvestmentValue = Object.freeze({
    id: "investment-prepare-recovery",
    model: "gpt-foundation-retained",
    reasoning: "xhigh",
    wallTimeMs: 30 * 60 * 1_000,
    limits: Object.freeze({
      tokens: null,
      events: 10_000,
      outputBytes: 1024 * 1024,
      toolCalls: null,
      processes: 64,
      storageBytes: 256 * 1024 * 1024,
    }),
    rationale: "fresh-reconnaissance",
  });
  const investment = Object.freeze({
    ...retainedInvestmentValue,
    digest: digestCanonical(retainedInvestmentValue),
  });
  const basis = fixture.basis;
  return Object.freeze({
    operation: "delivery.prepare",
    role: "reconnaissance",
    activityId: "prepare-recovery",
    stage: "activity-opened",
    coordinate: null,
    execution: null,
    brief: Object.freeze({ id: brief.recordId, revision: brief.revision, digest: brief.digest }),
    attempt: null,
    boundary: null,
    attemptedCandidate: null,
    seal: null,
    opening: Object.freeze({
      agentId: AGENT,
      runtimeId: RUNTIME,
      founderId: basis.epoch.contract.authority.principalId,
      submittedAt: SUBMITTED,
      startedAt: SUBMITTED,
      founderSubmissionRawDigest: sha256Bytes(rawMarkdown),
      founderSubmissionRawByteLength: Buffer.byteLength(rawMarkdown, "utf8"),
      founderSemanticDigest: sha256Bytes(basis.semanticMarkdown),
      founderSemanticByteLength: Buffer.byteLength(basis.semanticMarkdown, "utf8"),
      investment,
    }),
    plan: Object.freeze({
      attemptCreatedAt: ATTEMPTED,
      preDispatchStateDigest: sha256Bytes("pre-dispatch"),
      projection: Object.freeze({
        id: basis.projection.manifest.projectionId,
        class: "orientation",
        profileId: basis.projection.manifest.profile,
        digest: basis.projection.manifest.digest,
      }),
      roleSubjectDigest: digestCanonical(basis.roleSubject),
      capabilityProfile: basis.capabilityProfile,
      capabilityDigest: digestCanonical(basis.providerCapability),
      providerInput: Object.freeze({
        manifestDigest: basis.providerInput.manifestDigest,
        bundleDigest: basis.providerInput.bundleDigest,
        roleBriefDigest: basis.providerInput.roleBrief.digest,
        templateProfileId: basis.providerInput.semanticTemplate.profileId,
        templateDigest: basis.providerInput.semanticTemplate.digest,
        contentInventoryDigest: basis.providerInput.contentInventoryDigest,
        inputMaterialDigest: basis.providerInput.inputMaterialDigest,
        citationRegistryDigest: basis.providerInput.citationRegistryDigest,
        rootTokenSetDigest: basis.providerInput.rootTokenSetDigest,
      }),
      evidenceSetDigest: null,
      propositionSetDigest: null,
    }),
    promotedExecutionPlan: null,
    finalization: null,
    resultCandidate: null,
    receipt: null,
    roleCheckpoint: null,
  });
}

test("recovery rehydrates normalized Brief semantics and the retained immutable plan", async () => {
  const processId = "preparation-runtime-v7-recovery";
  const rawMarkdown = `  ${fixture.basis.semanticMarkdown}  `;
  const brief = retainedBrief(processId, fixture.basis, rawMarkdown);
  const revisions = new Map([[`${brief.recordId}\0${brief.revision}`, brief]]);
  const store = {
    identity: Object.freeze({
      schema: CONTROL_RECORD_STORE_SCHEMA,
      storeId: "store-preparation-runtime-v7-recovery",
      targetId: fixture.basis.epoch.contract.targetId,
      processKind: "delivery" as const,
      processId,
      createdAt: CREATED,
    }),
    getRevision(recordId: string, revision: number) {
      return revisions.get(`${recordId}\0${revision}`) ?? null;
    },
    state() {
      return Object.freeze({
        standing: "preparing" as const,
        candidateCondition: "none" as const,
        activities: Object.freeze([]),
        subjects: Object.freeze({
          proposedBoundary: null,
          activeBoundary: null,
          candidate: null,
          materialCondition: null,
          seal: null,
          evidence: null,
          closure: null,
        }),
        journal: Object.freeze({ eventCount: 0, headDigest: null }),
        eligibleOperations: Object.freeze([]),
      });
    },
  } as unknown as ControlRecordStore;
  const retained = support(brief, rawMarkdown);
  let preflightSemantic: string | null = null;
  let request: FoundationPreparationAgentOperationV7Input | null = null;
  const selected = await recoverFoundationPreparationRuntimeV7({
    target: fixture.target,
    store,
    configuration: configuration(fixture.machineHome, "new-default", "low"),
    activityId: retained.activityId,
    runtimeId: RUNTIME,
    observedAt: CREATED,
  }, {
    boundaryFinalization: {
      machineHome: fixture.machineHome,
    },
    inspectAgentActivity() { return retained; },
    async preflightBasis(input) {
      preflightSemantic = input.semanticMarkdown;
      assert.equal(input.target, fixture.target);
      return fixture.basis;
    },
    async recoverAgentActivity(input) {
      request = input;
      return result(input.activityId);
    },
  });
  assert.equal(selected.outcome, "completed");
  assert.equal(preflightSemantic, fixture.basis.semanticMarkdown);
  assert(request !== null);
  const captured = request as FoundationPreparationAgentOperationV7Input;
  assert.equal(captured.opening.semanticMarkdown, fixture.basis.semanticMarkdown);
  assert.equal(captured.opening.attemptCreatedAt, ATTEMPTED);
  assert.equal(captured.configuration.model, "gpt-foundation-retained");
  assert.equal(captured.configuration.reasoning, "xhigh");
  assert.equal(captured.investment, retained.opening.investment);
  assert.equal(captured.providerInput, fixture.basis.providerInput);
});
