import { resolveCandidateIntegrationProvenanceV1 } from "../../src/foundation/control/integration-assessment.js";
import { compileFoundationReviewActivityOpeningV7, openFoundationReviewAgentActivityV7, settleFoundationUnallocatedReviewV7 } from "../../src/foundation/process/agent-operation-v7.js";
import { operateFoundationCandidateAgentRuntimeV7 } from "../../src/foundation/process/candidate-agent-runtime-v7.js";
import { FOUNDATION_SPECIFICATION_REVISION } from "../../src/foundation/constants.js";
import { installedHarness, type AgentCellFixtureOutputEntry } from "../support/agent-cell-runtime-fixture.js";
import { executionContractFixture } from "../support/execution-contract-fixture.js";
import { selectFoundationBuilderRepairOutputV1 } from "../../src/foundation/candidate/repair-output.js";
import { compileKnowledgeProjection } from "../../src/foundation/projection/compiler.js";
import { compileFoundationAgentInvestmentV7, compileFoundationExecutionProjectionRequestV7, compileFoundationFreshAgentOperationContextV7 } from "../../src/foundation/process/operation-context-v7.js";
import { mandatoryProjectionItemSizeErrorV1, bindFoundationMandatoryProjectionRefusalV1 } from "../../src/foundation/projection/mandatory-refusal.js";
import { receiveFoundationAuthorityCredential } from "../../src/foundation/repository/authority.js";
import assert from "node:assert/strict";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { withTargetOperationLock } from "../../src/foundation/repository/operation-lock.js";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  createFoundationRuntimeOperationRequest,
  FoundationControlEventSchema,
  type FoundationRuntimeStatusRequest,
} from "@neutral/lifecycle-protocol";
import {
  candidateRevisionCarrierVerifier,
  publishCandidateRevisionCarrierFromGitTree,
} from "../../src/foundation/candidate/carrier-binding.js";
import {
  importCandidateRevisionCarrierIntoRepository,
} from "../../src/foundation/candidate/carrier-import.js";
import {
  verifyCandidateCarriersForStoreArchive,
} from "../../src/foundation/candidate/carrier-archive-verifier.js";
import { openCandidateRevisionCarrier } from "../../src/foundation/candidate/carrier-store.js";
import {
  deriveCandidateRevisionCarrierAdmittedContext,
} from "../../src/foundation/candidate/carrier-observation-context.js";
import type { CandidateRevisionState } from "../../src/foundation/control/candidate-revision.js";
import { validateKnowledgeSet } from "../../src/foundation/knowledge/knowledge-set.js";
import { operateFoundationIntegrationRuntimeV1, recoverFoundationIntegrationRuntimeV1 } from "../../src/foundation/process/integration-runtime-v1.js";
import { retainCandidateRevision } from "../../src/foundation/control/candidate-revision.js";
import {
  createDeliveryControlRecordStore,
  openDeliveryControlRecordStore,
} from "../../src/foundation/control/delivery-custody.js";
import { compileControlRecordRevision } from "../../src/foundation/control/model.js";
import { compileDeliveryGeneration } from "../../src/foundation/control/delivery-view.js";
import { retainEvidencePacket } from "../../src/foundation/control/evidence-packet.js";
import { retainWorkBoundary, resolveWorkBoundaryResolutionSnapshotV1, workBoundaryRepositoryBasisFromSnapshot, type WorkBoundaryCompilerFact } from "../../src/foundation/control/work-boundary.js";
import { admitDeliveryV7 } from "../../src/foundation/transaction/admission-v7.js";
import { observeFoundationEvaluationEvidenceV7 } from "../../src/foundation/evidence/physical-observation-v7.js";
import { FOUNDATION_EVIDENCE_RULE_SET_V7, FOUNDATION_EVIDENCE_VALIDATOR_V7 } from "../../src/foundation/evidence/coordinates-v7.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import type {
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordRelationship,
  ControlRecordRevision,
  ControlRecordRevisionInput,
} from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import { git } from "../../src/foundation/repository/git.js";
import { commandCheckBinding, initializeRepository } from "../../src/foundation/repository/initialize.js";
import { createFoundationRuntimeReadSurface } from "../../src/foundation/runtime-read.js";
import {
  bindRepositorySnapshot,
  loadRepositoryEpoch,
} from "../../src/foundation/repository/snapshot.js";
import type { FoundationRepositoryContract } from "../../src/foundation/repository/types.js";
import {
  foundationExecutionReclamationPreIntentRefusalSetDigestV1,
  foundationExecutionReclamationTerminalSubjectSetDigestV1,
} from "../../src/foundation/execution/reclamation-ledger-v1.js";
import {
  acceptDeliveryV7,
  noShipDeliveryV7,
  recoverTerminalDeliveryV7,
  type FoundationTerminalRepositoryObservationV7,
  type FoundationTerminalV7Options,
} from "../../src/foundation/transaction/terminal-v7.js";
import {
  digestCanonical,
  canonicalJson,
  sha256Bytes,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";
import { FOUNDATION_GENERATED_PUBLICATION_DIGEST } from "../../src/foundation/validation/generated-schemas.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";
import { writeMinimalAtlas } from "../helpers/atlas-fixture.js";
import { reviewerEvidenceWorkProductPayloadV7, reviewerEvidenceReceiptPayloadV7 } from "../helpers/evidence-fixture-v7.js";

const RUNTIME = "foundation-runtime";
const SECRET = "terminal-v7-authority-secret-with-sufficient-entropy";
const PUBLICATION = FOUNDATION_GENERATED_PUBLICATION_DIGEST;

function digest(value: string): Sha256 {
  return sha256Bytes(value);
}

async function write(root: string, path: string, contents: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), contents, "utf8");
}

function sourceDescription(): string {
  const frontMatter = {
    schema: "lifecycle.knowledge-record.v2",
    kind: "description",
    id: "description.terminal-v7-source",
    title: "Terminal v7 source",
    status: "current",
    revision: 1,
    supersedes: null,
    summary: "Own the governed source used by the terminal transaction fixture.",
    owners: ["director:terminal-v7"],
    sources: [],
    relationships: [],
    conflicts: [],
    tags: [],
    spec: {
      responsibility: "Own the terminal transaction fixture source tree.",
      coverage: [{ path: "src", mode: "tree", role: "primary", exclude: [] }],
      behavior: ["exposes the exact terminal fixture value"],
      boundaries: ["contains no Delivery Control or Atlas authorship"],
      invariants: ["remains ordinary tracked product source"],
      dependencies: [],
      failure: ["the accepted source differs from the evidenced Candidate"],
      rationale: ["one Description owns the fixture's bounded source tree"],
    },
  };
  return `---\n${JSON.stringify(frontMatter, null, 2)}\n---\n\n# Terminal v7 source\n\n## Responsibility\n\nOwn the terminal fixture source.\n\n## Behavior\n\nExpose the accepted value.\n\n## Boundaries\n\nNo Delivery Control or Atlas authorship.\n\n## Rationale\n\nKeep the fixture bounded.\n`;
}

function sourceCheck(): string {
  const frontMatter = {
    schema: "lifecycle.knowledge-record.v2", kind: "check", id: "check.demo", title: "Terminal result Check",
    status: "current", revision: 1, supersedes: null, summary: "Observe the exact bounded terminal result.",
    owners: ["director:terminal-v7"], sources: [], relationships: [], conflicts: [], tags: [],
    spec: { proposition: "The exact source exposes the bounded result.", subjects: [{ kind: "candidate", selector: "src/demo.ts" }],
      evidenceKinds: ["command"], requiredBindings: ["binding.check.demo"],
      evaluation: { pass: "Expected result observed", fail: "Different result observed", indeterminate: "Observation unavailable", notRun: "Not executed" },
      limits: ["A fixture observation does not establish operated qualification"],
      freshness: { subjectBinding: "exact", maximumAgeMs: null, environmentBinding: "exact" }, falsifiers: ["Different result"] },
  };
  return `---\n${JSON.stringify(frontMatter, null, 2)}\n---\n\n# Terminal result Check\n\n` +
    ["Proposition", "Evaluation", "Evidence", "Limits"].map((section) => `## ${section}\n\n${section} for the bounded fixture.`).join("\n\n") + "\n";
}

function timeOwner(start = "2026-08-29T20:00:00.000Z"): () => string {
  let value = Date.parse(start);
  return () => new Date(value += 1_000).toISOString();
}

type RepositoryFixture = Readonly<{
  workspace: string;
  target: string;
  authorityHome: string;
  machineHome: string;
  contract: FoundationRepositoryContract;
  observation: FoundationTerminalRepositoryObservationV7;
  check: Readonly<{ id: string; revision: number; sourceDigest: Sha256; semanticDigest: Sha256 }>;
}>;

async function terminalObservation(
  target: string,
): Promise<FoundationTerminalRepositoryObservationV7> {
  const loaded = await loadRepositoryEpoch(target);
  const knowledge = await validateKnowledgeSet(loaded);
  assert.notEqual(knowledge.knowledgeSet, null, JSON.stringify(knowledge.validation.diagnostics));
  if (knowledge.knowledgeSet === null) throw new Error("Terminal fixture Knowledge is invalid");
  const bound = await bindRepositorySnapshot(loaded, knowledge.knowledgeSet);
  return Object.freeze({
    repository: bound.repository,
    contract: bound.contract,
    basis: Object.freeze({
      repositorySnapshotDigest: bound.snapshot.digest,
      canonicalCommit: bound.epoch.commit,
      canonicalTree: bound.epoch.tree,
      productStateDigest: bound.productState.digest,
      atlasStateDigest: bound.atlasState.digest,
      atlasResolutionDigest: bound.atlas.resolution.digest,
      atlasNormalizedModelDigest: bound.atlas.resolution.normalizedModelDigest,
      atlasResourceBindingsDigest: bound.atlas.resolution.resourceBindingsDigest,
      repositoryContractDigest: bound.contract.digest,
      knowledgeSetDigest: bound.snapshot.knowledgeSetDigest,
      checkBindingSetDigest: digestCanonical(bound.contract.checkBindings),
    }),
    ref: bound.epoch.ref,
    objectFormat: bound.epoch.objectFormat,
  });
}

async function repositoryFixture(suffix: string): Promise<RepositoryFixture> {
  const workspace = await realpath(await mkdtemp(join(
    tmpdir(),
    `lifecycle-terminal-v7-${suffix}-`,
  )));
  const target = join(workspace, "target");
  const authorityHome = join(workspace, "authority");
  const machineHome = join(workspace, "machine");
  await Promise.all([
    mkdir(target, { mode: 0o700 }),
    mkdir(authorityHome, { mode: 0o700 }),
    mkdir(machineHome, { mode: 0o700 }),
  ]);
  await chmod(machineHome, 0o700);
  await git(target, ["init", "-b", "main"]);
  await git(target, ["config", "user.name", "Lifecycle Test"]);
  await git(target, ["config", "user.email", "lifecycle@example.invalid"]);
  await writeMinimalAtlas(target);
  await git(target, ["add", "--", "atlas"]);
  await git(target, ["commit", "-m", "Initialize terminal target"]);
  const binding = commandCheckBinding({ id: "binding.check.demo", checkIds: ["check.demo"],
    subjectSelectors: [{ kind: "candidate", selector: "src/demo.ts" }],
    executable: { relativeTo: "execution-image", path: "usr/bin/true" } });
  const contract = await initializeRepository(target, {
    targetId: `terminal-v7-target-${suffix}`,
    directorPrincipal: "director:terminal-v7",
    home: authorityHome,
    authorityCredential: receiveFoundationAuthorityCredential(SECRET, "initialize"),
    publicationDigest: PUBLICATION,
    implementationRoots: ["src"],
    checkBindings: { [binding.id]: binding },
    stage: true,
  });
  await write(target, "src/demo.ts", "export const terminal = 'base';\n");
  await write(target, "src/_source.desc.md", sourceDescription());
  await write(target, "records/checks/demo.md", sourceCheck());
  await git(target, ["add", "--", "."]);
  await git(target, ["commit", "-m", "Create terminal base"]);
  const observation = await terminalObservation(target);
  assert.equal(observation.contract.digest, contract.digest);
  const knowledge = await validateKnowledgeSet(await loadRepositoryEpoch(target));
  const check = knowledge.knowledgeSet?.currentRecords.find(({ frontMatter }) => frontMatter.id === "check.demo");
  assert(check !== undefined);
  return Object.freeze({
    workspace,
    target,
    authorityHome,
    machineHome,
    contract,
    observation,
    check: { id: check.frontMatter.id, revision: check.frontMatter.revision, sourceDigest: check.sourceDigest, semanticDigest: check.semanticDigest },
  });
}

function relationship(
  relation: string,
  revision: ControlRecordRevision,
): ControlRecordRelationship {
  return Object.freeze({
    relation,
    target: Object.freeze({
      kind: revision.recordKind,
      id: revision.recordId,
      revision: revision.revision,
      digest: revision.digest,
    }),
  });
}

type SemanticAuthority = Readonly<{
  author: "director" | "agent" | "runtime";
  authority:
    | "director-supplied"
    | "director-authenticated"
    | "agent-proposed"
    | "runtime-derived"
    | "runtime-observed";
}>;

const SEMANTICS = Object.freeze({
  "director-brief": Object.freeze({ author: "director", authority: "director-supplied" }),
  "agent-attempt": Object.freeze({ author: "runtime", authority: "runtime-derived" }),
  "agent-work-product": Object.freeze({ author: "agent", authority: "agent-proposed" }),
  "execution-receipt": Object.freeze({ author: "runtime", authority: "runtime-observed" }),
  "work-boundary": Object.freeze({ author: "runtime", authority: "runtime-derived" }),
  "director-decision": Object.freeze({ author: "director", authority: "director-authenticated" }),
  "candidate-seal": Object.freeze({ author: "runtime", authority: "runtime-observed" }),
  "check-receipt": Object.freeze({ author: "runtime", authority: "runtime-observed" }),
  "evidence-packet": Object.freeze({ author: "runtime", authority: "runtime-derived" }),
} satisfies Readonly<Record<string, SemanticAuthority>>);

function recordInput(input: Readonly<{
  store: ControlRecordStore;
  id: string;
  kind: keyof typeof SEMANTICS;
  createdAt: string;
  payload?: ControlJsonObject;
  relationships?: readonly ControlRecordRelationship[];
}>): ControlRecordRevisionInput {
  const semantics = SEMANTICS[input.kind]!;
  const selectedPayload = input.payload ?? validDeliveryControlPayload(input.kind);
  const retirement = selectedPayload.retirement as ControlJsonObject | undefined;
  // Each seeded Receipt represents a distinct physical execution, even when
  // its structural template or proof subject is shared with another Receipt.
  const payload = (input.kind === "execution-receipt" || input.kind === "check-receipt") &&
    retirement?.classification === "retired"
    ? Object.freeze({
        ...selectedPayload,
        containment: Object.freeze({
          ...(selectedPayload.containment as ControlJsonObject),
          factsDigest: digest(`containment:${input.id}`),
        }),
        retirement: Object.freeze({ ...retirement, factsDigest: digest(`retirement:${input.id}`) }),
      })
    : selectedPayload;
  return Object.freeze({
    recordId: input.id,
    recordKind: input.kind,
    revision: 1,
    producer: Object.freeze({ kind: "runtime" as const, id: RUNTIME }),
    semanticAuthor: Object.freeze({ kind: semantics.author, id: `${semantics.author}:terminal-v7` }),
    semanticAuthority: semantics.authority,
    createdAt: input.createdAt,
    semanticMarkdown: `# ${input.kind}\n\nTerminal v7 focused fixture.\n`,
    payload,
    relationships: Object.freeze([...(input.relationships ?? [])]),
  });
}

function appendRecord(input: Readonly<{
  store: ControlRecordStore;
  revision: ControlRecordRevisionInput;
  eventKind: string;
  eventId: string;
  occurredAt: string;
  activityId: string;
}>): ControlRecordRevision {
  const compiled = compileControlRecordRevision(input.store.identity.processId, input.revision);
  const retained = input.store.append({
    revision: input.revision,
    event: Object.freeze({
      eventId: input.eventId,
      eventKind: input.eventKind,
      occurredAt: input.occurredAt,
      actor: Object.freeze({ kind: "runtime" as const, id: RUNTIME }),
      subject: Object.freeze({
        recordId: compiled.recordId,
        revision: compiled.revision,
        digest: compiled.digest,
      }),
      payload: Object.freeze({ activityId: input.activityId }),
    }),
  });
  assert(retained.revision !== null);
  return retained.revision;
}

function appendEvent(input: Readonly<{
  store: ControlRecordStore;
  eventId: string;
  eventKind: string;
  occurredAt: string;
  activityId: string;
  payload?: ControlJsonObject;
  subject?: ControlRecordRevision;
}>): void {
  input.store.append({ event: Object.freeze({
    eventId: input.eventId,
    eventKind: input.eventKind,
    occurredAt: input.occurredAt,
    actor: Object.freeze({ kind: "runtime" as const, id: RUNTIME }),
    subject: input.subject === undefined ? null : Object.freeze({
      recordId: input.subject.recordId,
      revision: input.subject.revision,
      digest: input.subject.digest,
    }),
    payload: Object.freeze({ activityId: input.activityId, ...(input.payload ?? {}) }),
  }) });
}

function fixtureClock(): () => string {
  let value = Date.parse("2026-08-29T12:00:00.000Z");
  return () => new Date(value += 1_000).toISOString();
}

async function createStore(fixture: RepositoryFixture, deliveryId: string): Promise<ControlRecordStore> {
  const opened = await createDeliveryControlRecordStore({
    machineHome: fixture.machineHome,
    targetId: fixture.contract.targetId,
    deliveryId,
    createdAt: "2026-08-29T12:00:00.000Z",
    runtimeActorId: RUNTIME,
  });
  return opened.store;
}

type DecisionFixture = Readonly<{
  store: ControlRecordStore;
  deliveryId: string;
  candidateRevision: ControlRecordRevision;
  candidateState: CandidateRevisionState;
}>;

async function seedCandidateReady(
  fixture: RepositoryFixture,
  suffix: string,
  options: Readonly<{ preIntentRefusal?: boolean; projectionRefusal?: boolean }> = {},
) {
  const deliveryId = `terminal-v7-delivery-${suffix}`;
  const store = await createStore(fixture, deliveryId);
  const nextTime = fixtureClock();
  const prepareId = `prepare-${suffix}`;
  const brief = appendRecord({
    store,
    revision: recordInput({
      store,
      id: `brief-${suffix}`,
      kind: "director-brief",
      payload: { ...validDeliveryControlPayload("director-brief"), scope: { kind: "activity", activityId: prepareId } },
      createdAt: nextTime(),
    }),
    eventKind: "director-brief-submitted",
    eventId: `event-brief-${suffix}`,
    occurredAt: nextTime(),
    activityId: prepareId,
  });
  appendEvent({
    store,
    eventId: `event-start-prepare-${suffix}`,
    eventKind: "activity-started",
    occurredAt: nextTime(),
    activityId: prepareId,
    payload: Object.freeze({ operation: "delivery.prepare" }),
  });
  const attemptPayload = validDeliveryControlPayload("agent-attempt");
  const attempt = appendRecord({
    store,
    revision: recordInput({
      store,
      id: `attempt-prepare-${suffix}`,
      kind: "agent-attempt",
      createdAt: nextTime(),
      payload: Object.freeze({
        ...attemptPayload,
        activityId: prepareId,
        operation: "delivery.prepare",
        role: "reconnaissance",
      }),
      relationships: Object.freeze([relationship("uses-brief", brief)]),
    }),
    eventKind: "agent-attempt-prepared",
    eventId: `event-attempt-prepare-${suffix}`,
    occurredAt: nextTime(),
    activityId: prepareId,
  });
  const prepareEffect = digest(`prepare-effect-${suffix}`);
  appendEvent({
    store,
    eventId: `event-intent-prepare-${suffix}`,
    eventKind: "provider-effect-intended",
    occurredAt: nextTime(),
    activityId: prepareId,
    subject: attempt,
    payload: Object.freeze({ effectDigest: prepareEffect }),
  });
  appendEvent({
    store,
    eventId: `event-observe-prepare-${suffix}`,
    eventKind: "provider-effect-observed",
    occurredAt: nextTime(),
    activityId: prepareId,
    subject: attempt,
    payload: Object.freeze({ effectDigest: prepareEffect, outcome: "completed" }),
  });
  const workProduct = appendRecord({
    store,
    revision: recordInput({
      store,
      id: `work-product-prepare-${suffix}`,
      kind: "agent-work-product",
      createdAt: nextTime(),
      relationships: Object.freeze([relationship("result-of", attempt)]),
    }),
    eventKind: "agent-work-product-submitted",
    eventId: `event-work-product-prepare-${suffix}`,
    occurredAt: nextTime(),
    activityId: prepareId,
  });
  const receiptPayload = validDeliveryControlPayload("execution-receipt");
  appendRecord({
    store,
    revision: recordInput({
      store,
      id: `receipt-prepare-${suffix}`,
      kind: "execution-receipt",
      createdAt: nextTime(),
      payload: Object.freeze({ ...receiptPayload, activityId: prepareId }),
      relationships: Object.freeze([
        relationship("observes-attempt", attempt),
        relationship("observes-work-product", workProduct),
      ]),
    }),
    eventKind: "execution-receipt-recorded",
    eventId: `event-receipt-prepare-${suffix}`,
    occurredAt: nextTime(),
    activityId: prepareId,
  });
  const boundaryPayload = validDeliveryControlPayload("work-boundary");
  const boundaryBasis = boundaryPayload.basis as ControlJsonObject;
  const observedBasis = fixture.observation.basis;
  const mandate = boundaryPayload.mandate as ControlJsonObject;
  const selectedBinding = fixture.contract.checkBindings["binding.check.demo"]!;
  const capability = fixture.contract.capabilityProfiles[fixture.contract.defaults.capabilityProfileId]!;
  const projection = fixture.contract.projectionProfiles[fixture.contract.defaults.executionProjectionProfileId]!;
  const boundary = appendRecord({
    store,
    revision: recordInput({
      store,
      id: options.projectionRefusal ? `work-boundary-${digestCanonical({ recordKind: "work-boundary", storeId: store.identity.storeId, processId: store.identity.processId }).slice("sha256:".length)}` : `boundary-${suffix}`,
      kind: "work-boundary",
      createdAt: nextTime(),
      payload: Object.freeze({
        ...boundaryPayload,
        targetId: fixture.contract.targetId,
        knowledge: [{ ...fixture.check }],
        disciplines: { registryDigest: (await validateKnowledgeSet(await loadRepositoryEpoch(fixture.target))).knowledgeSet!.disciplineRegistry.digest, workTypeIds: [], records: [] },
        capabilityProfile: { id: capability.id, digest: capability.digest },
        projectionProfile: { id: projection.id, digest: projection.digest },
        mandate: { ...mandate, checks: (mandate.checks as readonly ControlJsonObject[]).map((check) => ({ ...check,
          definition: { ...fixture.check }, bindings: [{ id: selectedBinding.id, digest: selectedBinding.digest,
            implementationDigest: selectedBinding.implementationDigest }] })) },
        basis: Object.freeze({
          ...boundaryBasis,
          productBaseCommit: observedBasis.canonicalCommit,
          productBaseTree: observedBasis.canonicalTree,
          productStateDigest: observedBasis.productStateDigest,
          atlasStateDigest: observedBasis.atlasStateDigest,
          atlasResolutionDigest: observedBasis.atlasResolutionDigest,
          atlasNormalizedModelDigest: observedBasis.atlasNormalizedModelDigest,
          atlasResourceBindingsDigest: observedBasis.atlasResourceBindingsDigest,
          repositoryContractDigest: observedBasis.repositoryContractDigest,
          knowledgeSetDigest: observedBasis.knowledgeSetDigest,
          repositorySnapshotDigest: observedBasis.repositorySnapshotDigest,
        }),
      }),
      relationships: Object.freeze([
        relationship("uses-brief", brief),
        relationship("proposed-from", workProduct),
      ]),
    }),
    eventKind: "work-boundary-finalized",
    eventId: `event-boundary-${suffix}`,
    occurredAt: nextTime(),
    activityId: prepareId,
  });
  const selectedCheck = ((boundary.payload.mandate as ControlJsonObject).checks as readonly ControlJsonObject[])[0]!;
  const checkPayload = Object.freeze({
    ...validDeliveryControlPayload("check-receipt"),
    definition: selectedCheck.definition!,
    binding: (selectedCheck.bindings as readonly ControlJsonObject[])[0]!,
  });
  const baseline = appendRecord({
    store,
    revision: recordInput({
      store,
      id: `check-baseline-${suffix}`,
      kind: "check-receipt",
      createdAt: nextTime(),
      payload: Object.freeze({ ...checkPayload, rawMaterials: Object.freeze([]) }),
      relationships: Object.freeze([relationship("checks-boundary", boundary)]),
    }),
    eventKind: "check-receipt-recorded",
    eventId: `event-check-baseline-${suffix}`,
    occurredAt: nextTime(),
    activityId: prepareId,
  });
  appendEvent({
    store,
    eventId: `event-complete-prepare-${suffix}`,
    eventKind: "activity-completed",
    occurredAt: nextTime(),
    activityId: prepareId,
    payload: Object.freeze({ outcome: "completed" }),
  });

  const admitId = `admit-${suffix}`;
  appendEvent({
    store,
    eventId: `event-start-admit-${suffix}`,
    eventKind: "activity-started",
    occurredAt: nextTime(),
    activityId: admitId,
    payload: Object.freeze({ operation: "delivery.admit" }),
  });
  const manualDecisionPayload = validDeliveryControlPayload("director-decision");
  const manualDecisionSubject = manualDecisionPayload.subject as ControlJsonObject;
  const decision = appendRecord({
    store,
    revision: recordInput({
      store,
      id: `decision-admit-${suffix}`,
      kind: "director-decision",
      createdAt: nextTime(),
      payload: Object.freeze({
        ...manualDecisionPayload,
        decision: "admit",
        subject: Object.freeze({
          ...manualDecisionSubject,
          operation: "delivery.admit",
          decision: "admit",
          candidateDisposition: "not-applicable",
        }),
      }),
      relationships: Object.freeze([
        relationship("selects-boundary", boundary),
        relationship("selects-baseline-receipt", baseline),
      ]),
    }),
    eventKind: "director-decision-authenticated",
    eventId: `event-decision-admit-${suffix}`,
    occurredAt: nextTime(),
    activityId: admitId,
  });
  const admissionEffect = digest(`admission-effect-${suffix}`);
  const admissionFacts = Object.freeze({
    schema: "lifecycle.admission-effect-observation-facts.v2",
    outcome: "applied",
    disposition: null,
    repositoryBasisDigest: digestCanonical(fixture.observation.basis),
  });
  appendEvent({
    store,
    eventId: `event-intent-admit-${suffix}`,
    eventKind: "transaction-effect-intended",
    occurredAt: nextTime(),
    activityId: admitId,
    subject: decision,
    payload: Object.freeze({ effectDigest: admissionEffect }),
  });
  appendEvent({
    store,
    eventId: `event-observe-admit-${suffix}`,
    eventKind: "transaction-effect-observed",
    occurredAt: nextTime(),
    activityId: admitId,
    subject: decision,
    payload: Object.freeze({
      effectDigest: admissionEffect,
      outcome: "applied",
      facts: admissionFacts,
      factsDigest: digestCanonical(admissionFacts),
    }),
  });

  const initialCarrier = await publishCandidateRevisionCarrierFromGitTree({
    machineHome: fixture.machineHome,
    repository: fixture.target,
    rootTree: fixture.observation.basis.canonicalTree,
  });
  const admittedCarrierContext = await deriveCandidateRevisionCarrierAdmittedContext({
    machineHome: fixture.machineHome,
    repository: fixture.target,
    store,
    boundary,
  });
  const initialCandidateRevision = (await retainCandidateRevision({
    store,
    activityId: admitId,
    observation: "initialization",
    candidateBaseCommit: fixture.observation.basis.canonicalCommit,
    carrierManifestBytes: initialCarrier.manifestBytes,
    verifyCarrier: candidateRevisionCarrierVerifier({
      machineHome: fixture.machineHome,
      admitted: admittedCarrierContext,
      predecessor: null,
    }),
    boundary: Object.freeze({
      kind: "work-boundary",
      id: boundary.recordId,
      revision: boundary.revision,
      digest: boundary.digest,
    }),
    predecessor: null,
    observedAt: nextTime(),
    runtimeId: RUNTIME,
  })).revision;
  const initialCandidateState = initialCandidateRevision.payload.state as
    unknown as CandidateRevisionState;
  appendEvent({
    store,
    eventId: `event-complete-admit-${suffix}`,
    eventKind: "activity-completed",
    occurredAt: nextTime(),
    activityId: admitId,
    payload: Object.freeze({ outcome: "completed" }),
  });

  if (options.preIntentRefusal === true) {
    const refusedId = `continue-refused-${suffix}`;
    appendRecord({
      store,
      revision: recordInput({
        store,
        id: `brief-continue-refused-${suffix}`,
        kind: "director-brief",
        payload: { ...validDeliveryControlPayload("director-brief"), scope: { kind: "activity", activityId: refusedId } },
        createdAt: nextTime(),
      }),
      eventKind: "director-brief-submitted",
      eventId: `event-brief-continue-refused-${suffix}`,
      occurredAt: nextTime(),
      activityId: refusedId,
    });
    appendEvent({
      store,
      eventId: `event-start-continue-refused-${suffix}`,
      eventKind: "activity-started",
      occurredAt: nextTime(),
      activityId: refusedId,
      payload: Object.freeze({ operation: "delivery.continue" }),
    });
    appendEvent({
      store,
      eventId: `event-pre-intent-refused-${suffix}`,
      eventKind: "agent-pre-intent-refused",
      occurredAt: nextTime(),
      activityId: refusedId,
      payload: Object.freeze({
        diagnosticCode: "agent-input-changed",
        resolution: "none",
        refusalFactsDigest: digest(`pre-intent-refusal-${suffix}`),
      }),
    });
    appendEvent({
      store,
      eventId: `event-complete-continue-refused-${suffix}`,
      eventKind: "activity-completed",
      occurredAt: nextTime(),
      activityId: refusedId,
      payload: Object.freeze({ outcome: "abandoned" }),
    });
  }

  const continueId = `continue-${suffix}`;
  const builderBrief = appendRecord({
    store,
    revision: recordInput({
      store,
      id: `brief-continue-${suffix}`,
      kind: "director-brief",
      payload: { ...validDeliveryControlPayload("director-brief"), scope: { kind: "activity", activityId: continueId } },
      createdAt: nextTime(),
    }),
    eventKind: "director-brief-submitted",
    eventId: `event-brief-continue-${suffix}`,
    occurredAt: nextTime(),
    activityId: continueId,
  });
  appendEvent({
    store,
    eventId: `event-start-continue-${suffix}`,
    eventKind: "activity-started",
    occurredAt: nextTime(),
    activityId: continueId,
    payload: Object.freeze({ operation: "delivery.continue" }),
  });
  const builderAttempt = appendRecord({
    store,
    revision: recordInput({
      store,
      id: `attempt-continue-${suffix}`,
      kind: "agent-attempt",
      createdAt: nextTime(),
      payload: Object.freeze({
        ...attemptPayload,
        activityId: continueId,
        operation: "delivery.continue",
        role: "builder",
        input: Object.freeze({
          ...(attemptPayload.input as ControlJsonObject),
          evidenceSetDigest: digest(`builder-evidence-set-${suffix}`),
        }),
      }),
      relationships: Object.freeze([
        relationship("uses-brief", builderBrief),
        relationship("uses-boundary", boundary),
        relationship("uses-candidate", initialCandidateRevision),
      ]),
    }),
    eventKind: "agent-attempt-prepared",
    eventId: `event-attempt-continue-${suffix}`,
    occurredAt: nextTime(),
    activityId: continueId,
  });
  const continueEffect = digest(`continue-effect-${suffix}`);
  appendEvent({
    store,
    eventId: `event-intent-continue-${suffix}`,
    eventKind: "provider-effect-intended",
    occurredAt: nextTime(),
    activityId: continueId,
    subject: builderAttempt,
    payload: Object.freeze({ effectDigest: continueEffect }),
  });
  const builderRepository = join(fixture.workspace, `builder-materialization-${suffix}`);
  await git(fixture.workspace, [
    "clone",
    "--no-local",
    "--no-hardlinks",
    fixture.target,
    builderRepository,
  ]);
  await write(builderRepository, "src/demo.ts", "export const terminal = 'accepted';\n");
  await git(builderRepository, ["add", "-A", "--", "."]);
  appendEvent({
    store,
    eventId: `event-observe-continue-${suffix}`,
    eventKind: "provider-effect-observed",
    occurredAt: nextTime(),
    activityId: continueId,
    subject: builderAttempt,
    payload: Object.freeze({ effectDigest: continueEffect, outcome: "completed" }),
  });
  const builderWorkProductPayload = validDeliveryControlPayload("agent-work-product");
  const builderWorkProduct = appendRecord({
    store,
    revision: recordInput({
      store,
      id: `work-product-continue-${suffix}`,
      kind: "agent-work-product",
      createdAt: nextTime(),
      payload: Object.freeze({
        ...builderWorkProductPayload,
        disposition: "partial",
        roleSemantics: Object.freeze({
          ...(builderWorkProductPayload.roleSemantics as ControlJsonObject),
          proposal: "progress",
          conditions: Object.freeze([]),
        }),
      }),
      relationships: Object.freeze([relationship("result-of", builderAttempt)]),
    }),
    eventKind: "agent-work-product-submitted",
    eventId: `event-work-product-continue-${suffix}`,
    occurredAt: nextTime(),
    activityId: continueId,
  });
  const successorTree = (await git(builderRepository, ["write-tree"])).stdout.trim();
  const carrier = await publishCandidateRevisionCarrierFromGitTree({
    machineHome: fixture.machineHome,
    repository: builderRepository,
    rootTree: successorTree,
  });
  const predecessor = Object.freeze({
    kind: "candidate-revision" as const,
    id: initialCandidateRevision.recordId,
    revision: initialCandidateRevision.revision,
    digest: initialCandidateRevision.digest,
  });
  const candidateRevision = (await retainCandidateRevision({
    store,
    activityId: continueId,
    observation: "builder-successor",
    candidateBaseCommit: fixture.observation.basis.canonicalCommit,
    carrierManifestBytes: carrier.manifestBytes,
    verifyCarrier: candidateRevisionCarrierVerifier({
      machineHome: fixture.machineHome,
      admitted: admittedCarrierContext,
      predecessor: Object.freeze({
        candidateDigest: initialCandidateState.candidateDigest,
      }),
    }),
    boundary: Object.freeze({
      kind: "work-boundary",
      id: boundary.recordId,
      revision: boundary.revision,
      digest: boundary.digest,
    }),
    predecessor,
    builderAttempt: Object.freeze({
      kind: "agent-attempt",
      id: builderAttempt.recordId,
      revision: builderAttempt.revision,
      digest: builderAttempt.digest,
    }),
    observedAt: nextTime(),
    runtimeId: RUNTIME,
  })).revision;
  const candidateState = candidateRevision.payload.state as unknown as CandidateRevisionState;
  await rm(builderRepository, { recursive: true, force: true });
  await assert.rejects(lstat(builderRepository), (error: unknown) =>
    (error as NodeJS.ErrnoException).code === "ENOENT");
  appendRecord({
    store,
    revision: recordInput({
      store,
      id: `receipt-continue-${suffix}`,
      kind: "execution-receipt",
      createdAt: nextTime(),
      payload: Object.freeze({ ...receiptPayload, activityId: continueId }),
      relationships: Object.freeze([
        relationship("observes-attempt", builderAttempt),
        relationship("observes-work-product", builderWorkProduct),
        relationship("observes-candidate", candidateRevision),
      ]),
    }),
    eventKind: "execution-receipt-recorded",
    eventId: `event-receipt-continue-${suffix}`,
    occurredAt: nextTime(),
    activityId: continueId,
  });
  appendEvent({
    store,
    eventId: `event-complete-continue-${suffix}`,
    eventKind: "activity-completed",
    occurredAt: nextTime(),
    activityId: continueId,
    payload: Object.freeze({ outcome: "completed" }),
  });

  return Object.freeze({ store, deliveryId, candidateRevision, candidateState, boundary, baseline, nextTime, attemptPayload, checkPayload });
}

async function seedDecisionReady(
  fixture: RepositoryFixture,
  suffix: string,
  options: Readonly<{ preIntentRefusal?: boolean; advanceParent?: boolean; projectionRefusal?: boolean }> = {},
): Promise<DecisionFixture> {
  const selected = await seedCandidateReady(fixture, suffix, options);
  const { store, deliveryId, boundary, baseline, nextTime, attemptPayload, checkPayload } = selected;
  if (options.advanceParent) {
    await write(fixture.target, "upstream.txt", "Independent canonical work before this Delivery integrates.\n");
    await git(fixture.target, ["add", "--", "upstream.txt"]);
    await git(fixture.target, ["commit", "-m", "Advance selected integration parent"]);
  }
  const integrated = await operateFoundationIntegrationRuntimeV1({ target: fixture.target, machineHome: fixture.machineHome,
    store, activityId: `integrate-${suffix}`, runtimeId: RUNTIME }, { now: nextTime });
  assert.equal(integrated.outcome, "constructed");
  const candidateRevision = store.getRevision(integrated.candidate.id, integrated.candidate.revision);
  if (candidateRevision === null) throw new Error("Integration fixture lost its retained Candidate");
  const candidateState = candidateRevision.payload.state as unknown as CandidateRevisionState;

  const evaluateId = `evaluate-${suffix}`;
  let reviewBrief: ControlRecordRevision;
  if (options.projectionRefusal) {
    const opening = compileFoundationReviewActivityOpeningV7({
      store, activityId: evaluateId, runtimeId: RUNTIME, agentId: "agent:projection-review",
      opening: { semanticMarkdown: "# Review exact Candidate\n", submittedAt: nextTime(), startedAt: nextTime(), directorId: fixture.contract.authority.principalId },
      boundary, candidate: candidateRevision,
      investment: compileFoundationAgentInvestmentV7({ store, activityId: evaluateId, operation: "delivery.evaluate", configuration: { model: "test-reviewer", reasoning: "high" } }),
    });
    openFoundationReviewAgentActivityV7(store, evaluateId, opening);
    reviewBrief = opening.opening.revision;
  } else {
  reviewBrief = appendRecord({
    store,
    revision: recordInput({
      store,
      id: `brief-evaluate-${suffix}`,
      kind: "director-brief",
      payload: { ...validDeliveryControlPayload("director-brief"), scope: { kind: "activity", activityId: evaluateId } },
      createdAt: nextTime(),
    }),
    eventKind: "director-brief-submitted",
    eventId: `event-brief-evaluate-${suffix}`,
    occurredAt: nextTime(),
    activityId: evaluateId,
  });
  appendEvent({
    store,
    eventId: `event-start-evaluate-${suffix}`,
    eventKind: "activity-started",
    occurredAt: nextTime(),
    activityId: evaluateId,
    payload: Object.freeze({ operation: "delivery.evaluate" }),
  });
  }
  const seal = appendRecord({
    store,
    revision: recordInput({
      store,
      id: `seal-${suffix}`,
      kind: "candidate-seal",
      createdAt: nextTime(),
      relationships: Object.freeze([
        relationship("seals", candidateRevision),
        relationship("governed-by", boundary),
      ]),
    }),
    eventKind: "candidate-sealed",
    eventId: `event-seal-${suffix}`,
    occurredAt: nextTime(),
    activityId: evaluateId,
  });
  const final = appendRecord({
    store,
    revision: recordInput({
      store,
      id: `check-final-${suffix}`,
      kind: "check-receipt",
      createdAt: nextTime(),
      payload: Object.freeze({
        ...checkPayload,
        phase: "final",
        rawMaterials: Object.freeze([]),
      }),
      relationships: Object.freeze([relationship("checks-seal", seal)]),
    }),
    eventKind: "check-receipt-recorded",
    eventId: `event-check-final-${suffix}`,
    occurredAt: nextTime(),
    activityId: evaluateId,
  });
  if (options.projectionRefusal) {
    const loaded = await loadRepositoryEpoch(fixture.target);
    const knowledge = (await validateKnowledgeSet(loaded)).knowledgeSet;
    assert(knowledge !== null);
    const snapshot = await bindRepositorySnapshot(loaded, knowledge);
    const request = compileFoundationExecutionProjectionRequestV7({ snapshot,
      repositoryValidation: { complete: true, valid: true, digest: digest("fixture-validation") } as never,
      knowledge, boundary, candidate: candidateRevision, seal, role: "reviewer",
      integration: resolveCandidateIntegrationProvenanceV1({ store, candidate: candidateRevision }),
    });
    const witness = mandatoryProjectionItemSizeErrorV1({ profile: request.profile, category: "implementation",
      id: "source.too-large", locator: "src/too-large.ts", objectId: "a".repeat(40), observedBytes: request.profile.maximumItemBytes + 1 });
    const refusal = bindFoundationMandatoryProjectionRefusalV1(witness, request);
    assert(refusal !== null);
    const appendBatch = store.appendBatch.bind(store);
    let refusedBatches = 0;
    store.appendBatch = (appends) => {
      const retained = appendBatch(appends);
      if (appends.some(({ event }) => event.eventKind === "agent-pre-intent-refused")) {
        refusedBatches += 1;
        throw new Error("lost return after refusal and Condition commit");
      }
      return retained;
    };
    assert.throws(() => settleFoundationUnallocatedReviewV7({ store, activityId: evaluateId, runtimeId: RUNTIME, refusal, now: nextTime }), /lost return/);
    assert.equal(store.state().activities.find(({ id }) => id === evaluateId)?.recovery?.resumesAt, "activity-completed");
    store.appendBatch = appendBatch;
    assert.throws(() => settleFoundationUnallocatedReviewV7({ store, activityId: evaluateId, runtimeId: RUNTIME, refusal: null, now: nextTime }), /requires boundary resolution/);
    assert.equal(refusedBatches, 1);
    assert.equal(store.getOperationSupport(evaluateId), null);
    assert.equal(store.state().standing, "boundary-paused");
    return Object.freeze({ store, deliveryId, candidateRevision, candidateState });
  }
  const reviewAttempt = appendRecord({
    store,
    revision: recordInput({
      store,
      id: `attempt-evaluate-${suffix}`,
      kind: "agent-attempt",
      createdAt: nextTime(),
      payload: Object.freeze({
        ...attemptPayload,
        activityId: evaluateId,
        operation: "delivery.evaluate",
        role: "reviewer",
        input: Object.freeze({
          ...(attemptPayload.input as ControlJsonObject),
          evidenceSetDigest: digest(`evidence-set-${suffix}`),
          propositionSetDigest: digest(`proposition-set-${suffix}`),
        }),
      }),
      relationships: Object.freeze([
        relationship("uses-brief", reviewBrief),
        relationship("uses-boundary", boundary),
        relationship("uses-candidate", candidateRevision),
        relationship("uses-seal", seal),
      ]),
    }),
    eventKind: "agent-attempt-prepared",
    eventId: `event-attempt-evaluate-${suffix}`,
    occurredAt: nextTime(),
    activityId: evaluateId,
  });
  const reviewEffect = digest(`review-effect-${suffix}`);
  appendEvent({
    store,
    eventId: `event-intent-review-${suffix}`,
    eventKind: "provider-effect-intended",
    occurredAt: nextTime(),
    activityId: evaluateId,
    subject: reviewAttempt,
    payload: Object.freeze({ effectDigest: reviewEffect }),
  });
  appendEvent({
    store,
    eventId: `event-observe-review-${suffix}`,
    eventKind: "provider-effect-observed",
    occurredAt: nextTime(),
    activityId: evaluateId,
    subject: reviewAttempt,
    payload: Object.freeze({ effectDigest: reviewEffect, outcome: "completed" }),
  });
  const reviewProduct = appendRecord({
    store,
    revision: recordInput({
      store,
      id: `work-product-evaluate-${suffix}`,
      kind: "agent-work-product",
      createdAt: nextTime(),
      payload: reviewerEvidenceWorkProductPayloadV7({ finalCheck: final, baselineChecks: [baseline], propositionId: "proposition.1" }),
      relationships: Object.freeze([relationship("result-of", reviewAttempt)]),
    }),
    eventKind: "agent-work-product-submitted",
    eventId: `event-work-product-evaluate-${suffix}`,
    occurredAt: nextTime(),
    activityId: evaluateId,
  });
  appendRecord({
    store,
    revision: recordInput({
      store,
      id: `receipt-evaluate-${suffix}`,
      kind: "execution-receipt",
      createdAt: nextTime(),
      payload: reviewerEvidenceReceiptPayloadV7({ activityId: evaluateId, attempt: reviewAttempt, candidate: candidateRevision, workProduct: reviewProduct, effectDigest: reviewEffect }),
      relationships: Object.freeze([
        relationship("observes-attempt", reviewAttempt),
        relationship("observes-work-product", reviewProduct),
      ]),
    }),
    eventKind: "execution-receipt-recorded",
    eventId: `event-receipt-evaluate-${suffix}`,
    occurredAt: nextTime(),
    activityId: evaluateId,
  });
  const physical = await observeFoundationEvaluationEvidenceV7({
    store,
    boundary,
    candidate: candidateRevision,
    seal,
    machineHome: fixture.machineHome,
    targetRepository: fixture.target,
    contract: fixture.contract,
  });
  const evidence = retainEvidencePacket({
    store,
    activityId: evaluateId,
    runtimeId: RUNTIME,
    observation: {
      ...physical,
      evaluatedAt: nextTime(),
      ruleSet: FOUNDATION_EVIDENCE_RULE_SET_V7,
      validator: FOUNDATION_EVIDENCE_VALIDATOR_V7,
    },
  });
  assert.equal(evidence.revision.payload.readiness, "acceptance-ready");
  appendEvent({
    store,
    eventId: `event-complete-evaluate-${suffix}`,
    eventKind: "activity-completed",
    occurredAt: nextTime(),
    activityId: evaluateId,
    payload: Object.freeze({ outcome: "completed" }),
  });
  assert.equal(store.state().standing, "decision-ready");
  return Object.freeze({ store, deliveryId, candidateRevision, candidateState });
}

function terminalOptions(
  fixture: RepositoryFixture,
  _candidateState?: CandidateRevisionState,
  overrides: Partial<FoundationTerminalV7Options> = {},
): FoundationTerminalV7Options {
  return Object.freeze({
    now: timeOwner(),
    observeRepository: async () => fixture.observation,
    observeReclamationHandoff: async ({
      storeId,
      processId,
      subjects,
      preIntentRefusals,
    }) =>
      Object.freeze({
        terminalExecutionSetDigest:
          foundationExecutionReclamationTerminalSubjectSetDigestV1({
            storeId,
            processId,
            subjects,
          }),
        executionCount: subjects.length,
        preIntentRefusalSetDigest:
          foundationExecutionReclamationPreIntentRefusalSetDigestV1({
            storeId,
            processId,
            preIntentRefusals,
          }),
        preIntentRefusalCount: preIntentRefusals.length,
        obligationSetDigest: digestCanonical({
          schema: "lifecycle.execution-reclamation-obligation-set.private.v1",
          storeId,
          processId,
          obligationDigests: Object.freeze(Array.from(
            { length: subjects.length + preIntentRefusals.length },
            (_, index) => digest(`terminal-reclamation-${processId}-${index}`),
          )),
        }),
        obligationCount: subjects.length + preIntentRefusals.length,
      }),
    ...overrides,
  });
}

async function carrierArtifactPath(
  fixture: RepositoryFixture,
  store: ControlRecordStore,
  revision: ControlRecordRevision,
): Promise<string> {
  const reference = revision.payload.carrierManifest as ControlJsonObject;
  assert.equal(typeof reference.digest, "string");
  const retained = await store.readRetainedFile(reference.digest as Sha256);
  assert.notEqual(retained, null);
  return (await openCandidateRevisionCarrier({
    machineHome: fixture.machineHome,
    manifestBytes: retained!.bytes,
  })).artifactPath;
}

function historicalCandidateRevision(
  store: ControlRecordStore,
  current: ControlRecordRevision,
): ControlRecordRevision {
  const predecessor = current.relationships.find(({ relation }) => relation === "revises");
  assert.notEqual(predecessor, undefined);
  const revision = store.getRevision(
    predecessor!.target.id,
    predecessor!.target.revision,
  );
  assert.notEqual(revision, null);
  assert.equal(revision!.digest, predecessor!.target.digest);
  assert.equal(revision!.recordKind, "candidate-revision");
  return revision!;
}

test("acceptance imports its retained Carrier without Candidate custody and closes with terminal facts", async () => {
  const fixture = await repositoryFixture("accept");
  let seeded: DecisionFixture | null = null;
  try {
    seeded = await seedDecisionReady(fixture, "accept");
    const generationInput = {
      store: seeded.store,
      physical: { disposition: "active" as const, archiveManifestDigest: null },
      repository: {
        headCommit: fixture.observation.basis.canonicalCommit,
        headTree: fixture.observation.basis.canonicalTree,
        repositoryContractDigest: fixture.observation.basis.repositoryContractDigest,
      },
    };
    const admittedGeneration = compileDeliveryGeneration(generationInput);
    const movedGeneration = compileDeliveryGeneration({
      ...generationInput,
      repository: { ...generationInput.repository, headCommit: "c".repeat(40), headTree: "d".repeat(40) },
    });
    assert.deepEqual(movedGeneration, admittedGeneration,
      "Unrelated canonical movement must not stale the exact admitted Delivery's semantic draft");
    const firstCarrierVerification = await verifyCandidateCarriersForStoreArchive({
      machineHome: fixture.machineHome,
      store: seeded.store,
    });
    const secondCarrierVerification = await verifyCandidateCarriersForStoreArchive({
      machineHome: fixture.machineHome,
      store: seeded.store,
    });
    assert.deepEqual(secondCarrierVerification, firstCarrierVerification);
    assert.equal(firstCarrierVerification.candidateRevisionCount, 3);
    await git(fixture.target, ["prune", "--expire=now"]);
    assert.notEqual((await git(fixture.target, [
      "rev-parse", "--verify", "--end-of-options", `${seeded.candidateState.tree}^{tree}`,
    ], { allowFailure: true })).exitCode, 0);
    await assert.rejects(acceptDeliveryV7({
      target: fixture.target,
      machineHome: fixture.machineHome,
      store: seeded.store,
      authorityHome: fixture.authorityHome,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
      runtimeId: RUNTIME,
    }, terminalOptions(fixture, seeded.candidateState, {
      onStage: (stage) => {
        if (stage === "opening-committed") {
          throw new Error("terminal opening committed fault");
        }
      },
    })), /terminal opening committed fault/u);

    const activity = seeded.store.state().activities.find((value) =>
      value.operation === "delivery.accept" && value.stage !== "completed");
    assert(activity !== undefined);
    assert.equal(
      (await git(fixture.target, ["rev-parse", "HEAD^{tree}"])).stdout.trim(),
      fixture.observation.basis.canonicalTree,
    );
    await assert.rejects(recoverTerminalDeliveryV7({
      target: fixture.target,
      machineHome: fixture.machineHome,
      store: seeded.store,
      runtimeId: RUNTIME,
      activityId: activity.id,
    }, terminalOptions(fixture, seeded.candidateState, {
      now: timeOwner("2026-08-29T20:30:00.000Z"),
      onStage: (stage) => {
        if (stage === "transaction-effect-observed") {
          throw new Error("terminal observation committed fault");
        }
      },
    })), /terminal observation committed fault/u);

    const support = seeded.store.getOperationSupport(activity.id);
    assert(support !== null);
    const checkpointBinding = support.payload.checkpoint as ControlJsonObject;
    const checkpoint = checkpointBinding.value as ControlJsonObject;
    assert.equal(checkpoint.schema, "lifecycle.runtime-terminal-checkpoint.v4");
    assert.notEqual(checkpoint.acceptance, null);
    assert.equal("times" in checkpoint, false);
    assert.equal("effectObservations" in checkpoint, false);
    const substitutedPayload = structuredClone(support.payload) as Record<string, ControlJsonValue>;
    const retainedAcceptance = checkpoint.acceptance as ControlJsonObject;
    const substitutedCheckpoint = Object.freeze({
      ...checkpoint,
      acceptance: Object.freeze({
        ...retainedAcceptance,
        commit: "f".repeat(40),
      }),
    });
    substitutedPayload.checkpoint = Object.freeze({
      value: substitutedCheckpoint,
      digest: digestCanonical(substitutedCheckpoint),
    });
    const substitutedSupport = seeded.store.putOperationSupport({
      activityId: activity.id,
      supportKind: support.supportKind,
      payload: substitutedPayload,
      expected: { generation: support.generation, payloadDigest: support.payloadDigest },
    });
    await assert.rejects(recoverTerminalDeliveryV7({
      target: fixture.target,
      machineHome: fixture.machineHome,
      store: seeded.store,
      runtimeId: RUNTIME,
      activityId: activity.id,
    }, terminalOptions(fixture, seeded.candidateState, {
      now: timeOwner("2026-08-29T20:45:00.000Z"),
    })), (error: unknown) =>
      error instanceof FoundationError &&
      error.code === "lifecycle.terminal-v7.support-substitution");
    seeded.store.putOperationSupport({
      activityId: activity.id,
      supportKind: support.supportKind,
      payload: support.payload,
      expected: {
        generation: substitutedSupport.generation,
        payloadDigest: substitutedSupport.payloadDigest,
      },
    });
    const retainedSupport = JSON.stringify(support.payload);
    for (const forbidden of [
      fixture.target,
      fixture.machineHome,
      fixture.authorityHome,
      SECRET,
    ]) assert.equal(retainedSupport.includes(forbidden), false);
    const integratedCommit = (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim();
    assert.equal(
      (await git(fixture.target, ["rev-parse", "HEAD^{tree}"])).stdout.trim(),
      seeded.candidateState.tree,
    );
    await git(fixture.target, [
      "read-tree", "-u", "-m",
      fixture.observation.basis.canonicalCommit,
      integratedCommit,
    ]);
    await write(
      fixture.target,
      "post-acceptance.txt",
      "External movement after the applied acceptance observation.\n",
    );
    await git(fixture.target, ["add", "--", "post-acceptance.txt"]);
    await git(fixture.target, ["commit", "-m", "Move branch after applied acceptance"]);
    const postAcceptanceCommit = (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim();

    const recovered = await recoverTerminalDeliveryV7({
      target: fixture.target,
      machineHome: fixture.machineHome,
      store: seeded.store,
      runtimeId: RUNTIME,
      activityId: activity.id,
    }, terminalOptions(fixture, seeded.candidateState, {
      now: timeOwner("2026-08-29T21:00:00.000Z"),
    }));
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.transactionOutcome, "applied");
    assert.equal(recovered.canonicalCommit, integratedCommit);
    assert.equal(
      (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim(),
      postAcceptanceCommit,
    );
    assert(recovered.closure !== null);
    assert(recovered.archiveManifestDigest !== null);
    assert.equal(await readFile(join(fixture.target, "src/demo.ts"), "utf8"),
      "export const terminal = 'accepted';\n");

    const archived = await openDeliveryControlRecordStore({
      machineHome: fixture.machineHome,
      targetId: fixture.contract.targetId,
      deliveryId: seeded.deliveryId,
    });
    assert.equal(archived.disposition, "archived");
    assert(archived.store.getSeal() !== null);
    assert.equal(archived.store.getOperationSupport(activity.id), null);
    const events = archived.store.listEvents(0, 10_000);
    assert.equal(events.at(-1)?.eventKind, "closure-recorded");
    assert.equal(events.filter(({ eventKind }) => eventKind === "director-decision-authenticated")
      .filter(({ payload }) => payload.activityId === activity.id).length, 1);
    assert.equal(events.filter(({ eventKind }) => eventKind === "transaction-effect-intended")
      .filter(({ payload }) => payload.activityId === activity.id).length, 1);
    const closureReference = archived.store.state().subjects.closure;
    assert(closureReference !== null);
    const closure = archived.store.getRevision(closureReference.id, closureReference.revision);
    const canonical = closure?.payload.canonicalResult as ControlJsonObject;
    assert.deepEqual(Object.keys(canonical).sort(), [
      "candidateDigest",
      "commit",
      "knowledgeSetDigest",
      "parentCommit",
      "parentTree",
      "productStateDigest",
      "tree",
    ]);
    assert.equal(canonical.parentCommit, fixture.observation.basis.canonicalCommit);
    assert.equal(canonical.parentTree, fixture.observation.basis.canonicalTree);
    assert.equal(canonical.commit, integratedCommit);
    assert.equal(canonical.tree, seeded.candidateState.tree);
    assert.equal(canonical.candidateDigest, seeded.candidateState.candidateDigest);
    assert.equal(canonical.productStateDigest, seeded.candidateState.productStateDigest);
    assert.equal(canonical.knowledgeSetDigest, seeded.candidateState.knowledgeSetDigest);
    assert.equal(closure?.payload.candidateTreatment, "integrated");
    const terminalExecutions = closure?.payload.terminalExecutions as ControlJsonObject;
    const reclamationHandoff = closure?.payload.reclamationHandoff as ControlJsonObject;
    assert.equal(terminalExecutions.executionCount, 5);
    assert.equal((terminalExecutions.containment as ControlJsonObject).classification, "complete");
    assert.equal((terminalExecutions.retirement as ControlJsonObject).classification, "complete");
    assert.equal(reclamationHandoff.obligationCount, 5);
    const appliedObservation = events.find(({ eventKind, payload }) =>
      eventKind === "transaction-effect-observed" && payload.outcome === "applied" &&
      payload.activityId === activity.id);
    assert.equal(
      (appliedObservation?.payload.facts as ControlJsonObject).canonicalResultDigest,
      digestCanonical(canonical),
    );
    archived.store.close();
  } finally {
    try { seeded?.store.close(); } catch { /* terminal success transfers Store custody */ }
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

async function assertTerminalReadAfterCanonicalMovement(input: Readonly<{
  fixture: RepositoryFixture;
  deliveryId: string;
  expectedCommit: string;
  expectedTree: string;
  candidateCondition: "accepted" | "abandoned";
  storeStage: "closure-recorded" | "sealed";
  movementSuffix: string;
}>): Promise<void> {
  const surface = createFoundationRuntimeReadSurface({
    machineHome: input.fixture.machineHome,
    now: () => "2026-08-29T22:00:00.000Z",
  });
  const statusRequest = createFoundationRuntimeOperationRequest({
    target: input.fixture.target,
    deliveryId: input.deliveryId,
    operation: "delivery.status",
    input: null,
  }) as FoundationRuntimeStatusRequest;
  const result = await surface.execute(statusRequest);

  assert.equal(result.status, "completed");
  assert.equal(result.observation.repository.headCommit, input.expectedCommit);
  assert.equal(result.observation.repository.headTree, input.expectedTree);
  assert.equal(result.observation.delivery?.standing, "closed");
  assert.equal(result.observation.delivery?.candidateCondition, input.candidateCondition);
  assert.equal(result.observation.delivery?.storeDisposition.stage, input.storeStage);
  assert.equal(result.observation.delivery?.recovery?.scope, "store-disposition");

  const path = `src/post-terminal-movement-${input.movementSuffix}.ts`;
  await write(
    input.fixture.target,
    path,
    `export const postTerminalMovement = '${input.movementSuffix}';\n`,
  );
  await git(input.fixture.target, ["add", "--", path]);
  await git(input.fixture.target, [
    "commit", "-m", `Move branch after ${input.storeStage} ${input.movementSuffix}`,
  ]);
  const movedCommit = (await git(input.fixture.target, ["rev-parse", "HEAD"])).stdout.trim();
  const movedTree = (await git(input.fixture.target, ["rev-parse", "HEAD^{tree}"])).stdout.trim();
  assert.notEqual(movedCommit, input.expectedCommit);
  assert.notEqual(movedTree, input.expectedTree);

  const moved = await surface.execute(statusRequest);
  assert.equal(moved.status, "completed");
  assert.equal(moved.observation.repository.headCommit, movedCommit);
  assert.equal(moved.observation.repository.headTree, movedTree);
  assert.deepEqual(moved.diagnostics, result.diagnostics);
  assert.deepEqual(moved.observation.delivery, result.observation.delivery);
}

test("accepted Closure remains exact after canonical movement before Store disposition", async () => {
  const fixture = await repositoryFixture("accepted-closed-read");
  let seeded: DecisionFixture | null = null;
  try {
    seeded = await seedDecisionReady(fixture, "accepted-closed-read");
    await assert.rejects(acceptDeliveryV7({
      target: fixture.target,
      machineHome: fixture.machineHome,
      store: seeded.store,
      authorityHome: fixture.authorityHome,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
      runtimeId: RUNTIME,
    }, terminalOptions(fixture, seeded.candidateState, {
      onStage: (stage) => {
        if (stage === "closure-recorded") {
          throw new Error("accepted Closure retained before Store disposition");
        }
      },
    })), /accepted Closure retained before Store disposition/u);

    assert.equal(seeded.store.state().standing, "closed");
    assert.equal(seeded.store.getSeal(), null);
    const acceptedCommit = (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim();
    assert.notEqual(acceptedCommit, fixture.observation.basis.canonicalCommit);
    assert.equal(
      (await git(fixture.target, ["rev-parse", "HEAD^{tree}"])).stdout.trim(),
      seeded.candidateState.tree,
    );
    assert.equal(
      (await git(fixture.target, ["status", "--porcelain=v1", "--untracked-files=all"]))
        .stdout.trim(),
      "",
    );
    seeded.store.close();

    const surface = createFoundationRuntimeReadSurface({
      machineHome: fixture.machineHome,
      now: () => "2026-08-29T22:00:00.000Z",
    });
    const statusRequest = createFoundationRuntimeOperationRequest({
      target: fixture.target,
      deliveryId: seeded.deliveryId,
      operation: "delivery.status",
      input: null,
    }) as FoundationRuntimeStatusRequest;
    const result = await surface.execute(statusRequest);

    assert.equal(result.status, "completed");
    assert.equal(result.observation.repository.headCommit, acceptedCommit);
    assert.equal(result.observation.delivery?.standing, "closed");
    assert.equal(result.observation.delivery?.candidateCondition, "accepted");
    assert.equal(result.observation.delivery?.storeDisposition.stage, "closure-recorded");
    assert.equal(result.observation.delivery?.recovery?.scope, "store-disposition");

    await write(
      fixture.target,
      "src/post-closure-movement.ts",
      "export const postClosureMovement = true;\n",
    );
    await git(fixture.target, ["add", "--", "src/post-closure-movement.ts"]);
    await git(fixture.target, ["commit", "-m", "Move branch before Store disposition"]);
    const movedCommit = (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim();
    assert.notEqual(movedCommit, acceptedCommit);
    const moved = await surface.execute(statusRequest);
    assert.equal(moved.status, "completed");
    assert.equal(moved.observation.repository.headCommit, movedCommit);
    assert.deepEqual(moved.diagnostics, result.diagnostics);
    assert.deepEqual(moved.observation.delivery, result.observation.delivery);
  } finally {
    try { seeded?.store.close(); } catch { /* terminal interruption retains Store custody */ }
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test("no-ship Closure remains exact after canonical movement before Store disposition", async () => {
  const fixture = await repositoryFixture("no-ship-closed-read");
  let seeded: DecisionFixture | null = null;
  try {
    seeded = await seedDecisionReady(fixture, "no-ship-closed-read");
    await assert.rejects(noShipDeliveryV7({
      target: fixture.target,
      machineHome: fixture.machineHome,
      store: seeded.store,
      authorityHome: fixture.authorityHome,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
      semanticMarkdown: "# Director No-Ship Decision\n\nClose without integrating Candidate bytes.\n",
      runtimeId: RUNTIME,
    }, terminalOptions(fixture, undefined, {
      onStage: (stage) => {
        if (stage === "closure-recorded") {
          throw new Error("no-ship Closure retained before Store disposition");
        }
      },
    })), /no-ship Closure retained before Store disposition/u);

    assert.equal(seeded.store.state().standing, "closed");
    assert.equal(seeded.store.getSeal(), null);
    assert.equal(
      (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim(),
      fixture.observation.basis.canonicalCommit,
    );
    assert.equal(
      (await git(fixture.target, ["rev-parse", "HEAD^{tree}"])).stdout.trim(),
      fixture.observation.basis.canonicalTree,
    );
    seeded.store.close();

    await assertTerminalReadAfterCanonicalMovement({
      fixture,
      deliveryId: seeded.deliveryId,
      expectedCommit: fixture.observation.basis.canonicalCommit,
      expectedTree: fixture.observation.basis.canonicalTree,
      candidateCondition: "abandoned",
      storeStage: "closure-recorded",
      movementSuffix: "no-ship-closure",
    });
  } finally {
    try { seeded?.store.close(); } catch { /* terminal interruption retains Store custody */ }
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

for (const disposition of ["accepted", "no-ship"] as const) {
  test(`${disposition} sealed Store remains exact after canonical movement before archive`, async () => {
    const fixture = await repositoryFixture(`${disposition}-sealed-read`);
    let seeded: DecisionFixture | null = null;
    try {
      seeded = await seedDecisionReady(fixture, `${disposition}-sealed-read`);
      const interruptAtSeal = {
        onStage: (stage: Parameters<NonNullable<FoundationTerminalV7Options["onStage"]>>[0]) => {
          if (stage === "store-sealed") {
            throw new Error(`${disposition} Store retained before archive`);
          }
        },
      };
      if (disposition === "accepted") {
        await assert.rejects(acceptDeliveryV7({
          target: fixture.target,
          machineHome: fixture.machineHome,
          store: seeded.store,
          authorityHome: fixture.authorityHome,
          authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
          runtimeId: RUNTIME,
        }, terminalOptions(fixture, seeded.candidateState, interruptAtSeal)),
        /accepted Store retained before archive/u);
      } else {
        await assert.rejects(noShipDeliveryV7({
          target: fixture.target,
          machineHome: fixture.machineHome,
          store: seeded.store,
          authorityHome: fixture.authorityHome,
          authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
          semanticMarkdown: "# Director No-Ship Decision\n\nClose without integrating Candidate bytes.\n",
          runtimeId: RUNTIME,
        }, terminalOptions(fixture, undefined, interruptAtSeal)),
        /no-ship Store retained before archive/u);
      }

      assert.equal(seeded.store.state().standing, "closed");
      assert.notEqual(seeded.store.getSeal(), null);
      const expectedCommit = disposition === "accepted"
        ? (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim()
        : fixture.observation.basis.canonicalCommit;
      const expectedTree = disposition === "accepted"
        ? seeded.candidateState.tree
        : fixture.observation.basis.canonicalTree;
      assert.equal(
        (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim(),
        expectedCommit,
      );
      assert.equal(
        (await git(fixture.target, ["rev-parse", "HEAD^{tree}"])).stdout.trim(),
        expectedTree,
      );
      seeded.store.close();

      await assertTerminalReadAfterCanonicalMovement({
        fixture,
        deliveryId: seeded.deliveryId,
        expectedCommit,
        expectedTree,
        candidateCondition: disposition === "accepted" ? "accepted" : "abandoned",
        storeStage: "sealed",
        movementSuffix: `${disposition}-sealed`,
      });
    } finally {
      try { seeded?.store.close(); } catch { /* terminal interruption retains Store custody */ }
      await rm(fixture.workspace, { recursive: true, force: true });
    }
  });
}

test("terminal rejects a same-count Reclamation substitution before Closure", async () => {
  const fixture = await repositoryFixture("reclamation-substitution");
  let seeded: DecisionFixture | null = null;
  try {
    seeded = await seedDecisionReady(fixture, "reclamation-substitution");
    await assert.rejects(noShipDeliveryV7({
      target: fixture.target,
      machineHome: fixture.machineHome,
      store: seeded.store,
      authorityHome: fixture.authorityHome,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
      semanticMarkdown: "# Director No-Ship Decision\n\nClose without integration.\n",
      runtimeId: RUNTIME,
    }, terminalOptions(fixture, undefined, {
      observeReclamationHandoff: async ({
        storeId,
        processId,
        subjects,
        preIntentRefusals,
      }) => {
        const substituted = Object.freeze(subjects.map((subject, index) => index === 0
          ? Object.freeze({
              ...subject,
              owner: Object.freeze({
                ...subject.owner,
                subjectDigest: digest("substituted-terminal-ledger-owner"),
              }),
            })
          : subject));
        return Object.freeze({
          terminalExecutionSetDigest:
            foundationExecutionReclamationTerminalSubjectSetDigestV1({
              storeId,
              processId,
              subjects: substituted,
            }),
          executionCount: subjects.length,
          preIntentRefusalSetDigest:
            foundationExecutionReclamationPreIntentRefusalSetDigestV1({
              storeId,
              processId,
              preIntentRefusals,
            }),
          preIntentRefusalCount: preIntentRefusals.length,
          obligationSetDigest: digest("same-count-substituted-obligation-set"),
          obligationCount: subjects.length + preIntentRefusals.length,
        });
      },
    })), (error: unknown) =>
      error instanceof FoundationError &&
      error.code === "lifecycle.terminal-v7.reclamation-handoff");
    assert.equal(seeded.store.state().subjects.closure, null);
  } finally {
    seeded?.store.close();
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test("acceptance refuses Atlas movement after selection of the exact evaluated parent", async () => {
  const fixture = await repositoryFixture("accept-atlas-advance");
  let seeded: DecisionFixture | null = null;
  try {
    seeded = await seedDecisionReady(fixture, "accept-atlas-advance");
    const atlasPath = join(fixture.target, "atlas/maps/project/points/project-scope.md");
    await writeFile(
      atlasPath,
      `${await readFile(atlasPath, "utf8")}\nSeparately Director-directed Atlas maintenance advances canonical state.\n`,
      "utf8",
    );
    await git(fixture.target, ["add", "--", "atlas"]);
    await git(fixture.target, ["commit", "-m", "Move Atlas during active Delivery"]);
    const movedCommit = (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim();

    const refused = await acceptDeliveryV7({
      target: fixture.target,
      machineHome: fixture.machineHome,
      store: seeded.store,
      authorityHome: fixture.authorityHome,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
      runtimeId: RUNTIME,
    }, terminalOptions(fixture, seeded.candidateState));
    assert.equal(refused.status, "failed");
    assert.equal(refused.transactionOutcome, "not-applied");
    assert.equal(refused.canonicalCommit, null);
    assert.equal((await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim(), movedCommit);
    assert.equal(seeded.store.state().subjects.closure, null);
    assert.equal(seeded.store.state().standing, "decision-ready");
    const observation = [...seeded.store.listEvents(0, 10_000)].reverse().find(
      ({ eventKind, payload }) =>
        eventKind === "transaction-effect-observed" && payload.activityId === refused.activityId,
    );
    assert.equal(
      (observation?.payload.facts as ControlJsonObject).schema,
      "lifecycle.terminal-repository-effect-observation.v1",
    );
    assert.equal((observation?.payload.facts as ControlJsonObject).commit, movedCommit);
  } finally {
    seeded?.store.close();
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test("acceptance refuses untracked non-authoritative checkout content", async () => {
  const fixture = await repositoryFixture("accept-dirty-checkout");
  let seeded: DecisionFixture | null = null;
  try {
    seeded = await seedDecisionReady(fixture, "accept-dirty-checkout");
    await writeFile(
      join(fixture.target, "untracked-local-note.txt"),
      "Untracked content outside every authoritative root.\n",
      "utf8",
    );

    const refused = await acceptDeliveryV7({
      target: fixture.target,
      machineHome: fixture.machineHome,
      store: seeded.store,
      authorityHome: fixture.authorityHome,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
      runtimeId: RUNTIME,
    }, terminalOptions(fixture, seeded.candidateState));
    assert.equal(refused.status, "failed");
    assert.equal(refused.transactionOutcome, "not-applied");
    assert.equal(refused.canonicalCommit, null);
    assert.equal(
      (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim(),
      fixture.observation.basis.canonicalCommit,
    );
    assert.equal(seeded.store.state().subjects.closure, null);
  } finally {
    seeded?.store.close();
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test("acceptance refuses an Atlas-only compare-and-swap race", async () => {
  const fixture = await repositoryFixture("accept-atlas-cas-race");
  let seeded: DecisionFixture | null = null;
  try {
    seeded = await seedDecisionReady(fixture, "accept-atlas-cas-race");
    const atlasPath = join(fixture.target, "atlas/maps/project/points/project-scope.md");
    const admittedAtlas = await readFile(atlasPath, "utf8");
    let intentRetained = false;
    let raced = false;
    let atlasCommit = "";
    const refused = await acceptDeliveryV7({
      target: fixture.target,
      machineHome: fixture.machineHome,
      store: seeded.store,
      authorityHome: fixture.authorityHome,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
      runtimeId: RUNTIME,
    }, terminalOptions(fixture, seeded.candidateState, {
      onStage: (stage) => {
        if (stage === "transaction-effect-intended") intentRetained = true;
      },
      importCandidateCarrier: async (input) => {
        const imported = await importCandidateRevisionCarrierIntoRepository(input);
        if (intentRetained && !raced) {
          raced = true;
          await writeFile(
            atlasPath,
            `${admittedAtlas}\nAtlas raced the exact acceptance CAS.\n`,
            "utf8",
          );
          await git(fixture.target, ["add", "--", "atlas"]);
          await git(fixture.target, ["commit", "-m", "Race acceptance with Atlas"]);
          atlasCommit = (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim();
        }
        return imported;
      },
    }));
    assert.equal(refused.status, "failed");
    assert.equal(refused.transactionOutcome, "not-applied");
    assert.equal(refused.canonicalCommit, null);
    assert.equal((await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim(), atlasCommit);
    assert.equal(seeded.store.state().subjects.closure, null);
    const observations = seeded.store.listEvents(0, 10_000).filter(({ eventKind, payload }) =>
      eventKind === "transaction-effect-observed" && payload.activityId === refused.activityId);
    assert.equal(observations.length, 1);
    assert.equal(
      (observations[0]?.payload.facts as ControlJsonObject).schema,
      "lifecycle.terminal-repository-effect-observation.v1",
    );
    assert.equal((observations[0]?.payload.facts as ControlJsonObject).commit, atlasCommit);
  } finally {
    seeded?.store.close();
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test("acceptance independently rechecks retained semantics and physical Carrier facts after intent before import", async () => {
  for (const changed of ["packet", "carrier"] as const) {
    const fixture = await repositoryFixture(`accept-reverify-${changed}`);
    let seeded: DecisionFixture | null = null;
    try {
      seeded = await seedDecisionReady(fixture, `accept-reverify-${changed}`);
      const originalStore = seeded.store;
      let intentRetained = false;
      let importCalls = 0;
      const store = new Proxy(originalStore, {
        get(target, key) {
          if (key === "getRevision") return (recordId: string, revision: number) => {
            const selected = target.getRevision(recordId, revision);
            if (changed !== "packet" || !intentRetained || selected?.recordKind !== "evidence-packet") return selected;
            return Object.freeze({
              ...selected,
              payload: Object.freeze({
                ...selected.payload,
                uncertainty: Object.freeze({
                  ...(selected.payload.uncertainty as ControlJsonObject),
                  level: "unknown",
                }),
              }),
            });
          };
          const value = Reflect.get(target, key, target) as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const artifactPath = await carrierArtifactPath(fixture, originalStore, seeded.candidateRevision);
      const refused = await acceptDeliveryV7({
        target: fixture.target,
        machineHome: fixture.machineHome,
        store,
        authorityHome: fixture.authorityHome,
        authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
        runtimeId: RUNTIME,
      }, terminalOptions(fixture, seeded.candidateState, {
        onStage: async (stage) => {
          if (stage !== "transaction-effect-intended") return;
          intentRetained = true;
          if (changed === "carrier") await rm(artifactPath);
        },
        importCandidateCarrier: async (input) => {
          importCalls += 1;
          return await importCandidateRevisionCarrierIntoRepository(input);
        },
      }));
      assert.equal(intentRetained, true, changed);
      assert.equal(refused.status, "failed", changed);
      assert.equal(refused.transactionOutcome, "not-applied", changed);
      assert.equal(importCalls, 0, `${changed} changed before any Candidate import`);
      assert.equal((await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim(), fixture.observation.basis.canonicalCommit);
      assert.equal(originalStore.state().subjects.closure, null);
      const terminalEvents = originalStore.listEvents(0, 10_000).filter(({ payload }) => payload.activityId === refused.activityId);
      for (const kind of ["director-decision-authenticated", "transaction-effect-intended", "transaction-effect-observed"]) {
        assert.equal(terminalEvents.filter(({ eventKind }) => eventKind === kind).length, 1, `${changed}: ${kind}`);
      }
    } finally {
      seeded?.store.close();
      await rm(fixture.workspace, { recursive: true, force: true });
    }
  }
});

test("acceptance refuses non-Atlas canonical movement made after retained intent", async () => {
  const fixture = await repositoryFixture("accept-product-after-intent");
  let seeded: DecisionFixture | null = null;
  try {
    seeded = await seedDecisionReady(fixture, "accept-product-after-intent");
    let advanced = false;
    const refused = await acceptDeliveryV7({
      target: fixture.target,
      machineHome: fixture.machineHome,
      store: seeded.store,
      authorityHome: fixture.authorityHome,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
      runtimeId: RUNTIME,
    }, terminalOptions(fixture, seeded.candidateState, {
      onStage: async (stage) => {
        if (stage !== "transaction-effect-intended" || advanced) return;
        advanced = true;
        await write(fixture.target, "src/external-after-intent.ts", "export const external = true;\n");
        await git(fixture.target, ["add", "--", "src/external-after-intent.ts"]);
        await git(fixture.target, ["commit", "-m", "Advance product after acceptance intent"]);
      },
    }));
    assert.equal(refused.status, "failed");
    assert.equal(refused.transactionOutcome, "not-applied");
    assert.equal(seeded.store.state().subjects.closure, null);
    assert.equal(
      seeded.store.listEvents(0, 10_000).filter(({ eventKind }) =>
        eventKind === "director-decision-authenticated").filter(({ payload }) =>
        payload.activityId === refused.activityId).length,
      1,
    );
  } finally {
    try { seeded?.store.close(); } catch { /* Store may already be closed */ }
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test("acceptance treats an invalid-Atlas compare-and-swap race as branch movement", async () => {
  const fixture = await repositoryFixture("accept-invalid-atlas-after-intent");
  let seeded: DecisionFixture | null = null;
  try {
    seeded = await seedDecisionReady(fixture, "accept-invalid-atlas-after-intent");
    const atlasPath = join(fixture.target, "atlas/atlas.md");
    let intentRetained = false;
    let advanced = false;
    let movedCommit = "";
    const refused = await acceptDeliveryV7({
      target: fixture.target,
      machineHome: fixture.machineHome,
      store: seeded.store,
      authorityHome: fixture.authorityHome,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
      runtimeId: RUNTIME,
    }, terminalOptions(fixture, seeded.candidateState, {
      onStage: (stage) => {
        if (stage === "transaction-effect-intended") intentRetained = true;
      },
      importCandidateCarrier: async (input) => {
        const imported = await importCandidateRevisionCarrierIntoRepository(input);
        if (intentRetained && !advanced) {
          advanced = true;
          await writeFile(atlasPath, "invalid Atlas\n", "utf8");
          await git(fixture.target, ["add", "--", "atlas/atlas.md"]);
          await git(fixture.target, ["commit", "-m", "Race acceptance with invalid Atlas"]);
          movedCommit = (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim();
        }
        return imported;
      },
    }));
    assert.equal(refused.status, "failed");
    assert.equal(refused.transactionOutcome, "not-applied");
    assert.equal(refused.canonicalCommit, null);
    assert.equal(seeded.store.state().subjects.closure, null);
    const observations = seeded.store.listEvents(0, 10_000).filter(({ eventKind, payload }) =>
      eventKind === "transaction-effect-observed" && payload.activityId === refused.activityId);
    assert.equal(observations.length, 1);
    assert.deepEqual(observations[0]?.payload.facts, Object.freeze({
      schema: "lifecycle.terminal-repository-effect-observation.v1",
      ref: "refs/heads/main",
      commit: movedCommit,
      tree: (await git(fixture.target, ["rev-parse", "HEAD^{tree}"])).stdout.trim(),
      objectFormat: "sha1",
    }));
    assert.equal(seeded.store.listEvents(0, 10_000).filter(({ eventKind }) =>
      eventKind === "director-decision-authenticated").filter(({ payload }) =>
      payload.activityId === refused.activityId).length, 1);
  } finally {
    seeded?.store.close();
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test("acceptance authenticates its historical subject then refuses current non-Atlas movement", async () => {
  const fixture = await repositoryFixture("accept-product-movement");
  let seeded: DecisionFixture | null = null;
  try {
    seeded = await seedDecisionReady(fixture, "accept-product-movement");
    await write(fixture.target, "src/external.ts", "export const external = true;\n");
    await git(fixture.target, ["add", "--", "src/external.ts"]);
    await git(fixture.target, ["commit", "-m", "Advance canonical product state"]);
    const movedCommit = (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim();
    const beforeEvents = seeded.store.listEvents(0, 10_000).length;

    const refused = await acceptDeliveryV7({
      target: fixture.target,
      machineHome: fixture.machineHome,
      store: seeded.store,
      authorityHome: fixture.authorityHome,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
      runtimeId: RUNTIME,
    }, terminalOptions(fixture, seeded.candidateState));
    assert.equal(refused.status, "failed");
    assert.equal(refused.transactionOutcome, "not-applied");
    assert.equal((await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim(), movedCommit);
    assert(seeded.store.listEvents(0, 10_000).length > beforeEvents);
    assert.equal(seeded.store.listEvents(0, 10_000).filter(({ eventKind, payload }) =>
      eventKind === "director-decision-authenticated" &&
      payload.activityId === refused.activityId).length, 1);
    assert.equal(seeded.store.state().subjects.closure, null);
    assert.equal(seeded.store.state().standing, "decision-ready");
  } finally {
    seeded?.store.close();
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test("no-ship observes exact non-integration and archives with Closure as the final event", async () => {
  const fixture = await repositoryFixture("no-ship");
  let seeded: DecisionFixture | null = null;
  const before = (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim();
  try {
    seeded = await seedDecisionReady(fixture, "no-ship");
    const retainedCarrierSet = await verifyCandidateCarriersForStoreArchive({
      machineHome: fixture.machineHome,
      store: seeded.store,
    });
    const closed = await noShipDeliveryV7({
      target: fixture.target,
      machineHome: fixture.machineHome,
      store: seeded.store,
      authorityHome: fixture.authorityHome,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
      semanticMarkdown: "# Director No-Ship Decision\n\nClose without integrating Candidate bytes.\n",
      runtimeId: RUNTIME,
    }, terminalOptions(fixture));
    assert.equal(closed.status, "completed");
    assert.equal(closed.decisionKind, "no-ship");
    assert.equal(closed.canonicalCommit, null);
    assert.equal((await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim(), before);

    const archived = await openDeliveryControlRecordStore({
      machineHome: fixture.machineHome,
      targetId: fixture.contract.targetId,
      deliveryId: seeded.deliveryId,
    });
    const reopenedCarrierSet = await verifyCandidateCarriersForStoreArchive({
      machineHome: fixture.machineHome,
      store: archived.store,
    });
    assert.deepEqual(reopenedCarrierSet, retainedCarrierSet);
    assert.equal(reopenedCarrierSet.candidateRevisionCount, 3);
    const events = archived.store.listEvents(0, 10_000);
    assert.equal(events.at(-1)?.eventKind, "closure-recorded");
    assert.equal(events.some(({ eventKind, payload }) =>
      eventKind === "activity-completed" && payload.activityId === closed.activityId), false);
    const closure = archived.store.getRevision(
      archived.store.state().subjects.closure!.id,
      archived.store.state().subjects.closure!.revision,
    );
    assert.equal(closure?.payload.disposition, "no-ship");
    assert.equal(closure?.payload.candidateTreatment, "abandoned");
    assert.equal(closure?.payload.nonIntegrationVerified, true);
    archived.store.close();
  } finally {
    try { seeded?.store.close(); } catch { /* terminal success transfers Store custody */ }
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test("terminal recovery reconciles an undispatched pre-intent allocation without another no-ship", async () => {
  const fixture = await repositoryFixture("no-ship-pre-intent-recovery");
  let seeded: DecisionFixture | null = null;
  let recoveryStore: ControlRecordStore | null = null;
  try {
    seeded = await seedDecisionReady(
      fixture,
      "no-ship-pre-intent-recovery",
      Object.freeze({ preIntentRefusal: true }),
    );
    const terminalClock = timeOwner();
    const recoveryOptions = terminalOptions(
      fixture,
      undefined,
      Object.freeze({ now: terminalClock }),
    );
    const observeExactHandoff = recoveryOptions.observeReclamationHandoff!;
    let refusedSelector: ControlJsonValue | null = null;
    await assert.rejects(noShipDeliveryV7({
      target: fixture.target,
      machineHome: fixture.machineHome,
      store: seeded.store,
      authorityHome: fixture.authorityHome,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
      semanticMarkdown: "# Director No-Ship Decision\n\nClose after pre-intent refusal.\n",
      runtimeId: RUNTIME,
    }, terminalOptions(fixture, undefined, {
      now: terminalClock,
      observeReclamationHandoff: async (input) => {
        assert.equal(input.preIntentRefusals.length, 1);
        refusedSelector = input.preIntentRefusals[0] as unknown as ControlJsonValue;
        const exact = await observeExactHandoff(input);
        return Object.freeze({
          ...exact,
          preIntentRefusalSetDigest: digest("substituted-pre-intent-refusal-set"),
        });
      },
    })), (error: unknown) =>
      error instanceof FoundationError &&
      error.code === "lifecycle.terminal-v7.reclamation-handoff");
    assert.notEqual(refusedSelector, null);
    assert.equal(seeded.store.state().subjects.closure, null);
    seeded.store.close();
    const reopened = await openDeliveryControlRecordStore({
      machineHome: fixture.machineHome,
      targetId: fixture.contract.targetId,
      deliveryId: seeded.deliveryId,
    });
    recoveryStore = reopened.store;
    const terminalActivities = recoveryStore.state().activities.filter(({ operation }) =>
      operation === "delivery.no-ship"
    );
    assert.equal(terminalActivities.length, 1);
    const terminalActivityId = terminalActivities[0]!.id;

    const recovered = await recoverTerminalDeliveryV7({
      target: fixture.target,
      machineHome: fixture.machineHome,
      store: recoveryStore,
      runtimeId: RUNTIME,
      activityId: terminalActivityId,
    }, recoveryOptions);
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.activityId, terminalActivityId);

    const archived = await openDeliveryControlRecordStore({
      machineHome: fixture.machineHome,
      targetId: fixture.contract.targetId,
      deliveryId: seeded.deliveryId,
    });
    const events = archived.store.listEvents(0, 10_000);
    const refusal = events.filter(({ eventKind }) =>
      eventKind === "agent-pre-intent-refused"
    );
    assert.equal(refusal.length, 1);
    assert.deepEqual(refusedSelector, Object.freeze({
      event: Object.freeze({
        sequence: refusal[0]!.sequence,
        eventId: refusal[0]!.eventId,
        digest: refusal[0]!.digest,
      }),
      activityId: refusal[0]!.payload.activityId,
    }));
    const refusedActivityId = refusal[0]!.payload.activityId;
    assert.equal(events.some(({ eventKind, payload }) =>
      payload.activityId === refusedActivityId &&
      (eventKind === "agent-attempt-prepared" ||
        eventKind === "provider-effect-intended" ||
        eventKind === "execution-receipt-recorded")), false);
    assert.equal(events.filter(({ eventKind, payload }) =>
      eventKind === "director-decision-authenticated" &&
      payload.activityId === terminalActivityId).length, 1);
    assert.equal(events.filter(({ eventKind, payload }) =>
      eventKind === "transaction-effect-intended" &&
      payload.activityId === terminalActivityId).length, 1);
    assert.equal(events.filter(({ eventKind, payload }) =>
      eventKind === "transaction-effect-observed" &&
      payload.activityId === terminalActivityId).length, 1);
    assert.equal(events.filter(({ eventKind }) => eventKind === "closure-recorded").length, 1);
    const closureReference = archived.store.state().subjects.closure;
    assert.notEqual(closureReference, null);
    const closure = archived.store.getRevision(
      closureReference!.id,
      closureReference!.revision,
    );
    const terminalExecutions = closure!.payload.terminalExecutions as ControlJsonObject;
    const handoff = closure!.payload.reclamationHandoff as ControlJsonObject;
    assert.equal(terminalExecutions.executionCount, 5);
    assert.equal(handoff.obligationCount, 6);
    archived.store.close();
  } finally {
    try { recoveryStore?.close(); } catch { /* terminal success transfers Store custody */ }
    try { seeded?.store.close(); } catch { /* terminal success transfers Store custody */ }
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test("no-ship refuses a missing historical Candidate Revision Carrier before Closure", async () => {
  const fixture = await repositoryFixture("no-ship-missing-historical-carrier");
  let seeded: DecisionFixture | null = null;
  try {
    seeded = await seedDecisionReady(fixture, "no-ship-missing-historical-carrier");
    const historical = historicalCandidateRevision(seeded.store, seeded.candidateRevision);
    await rm(await carrierArtifactPath(fixture, seeded.store, historical));

    await assert.rejects(noShipDeliveryV7({
      target: fixture.target,
      machineHome: fixture.machineHome,
      store: seeded.store,
      authorityHome: fixture.authorityHome,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
      semanticMarkdown: "# Director No-Ship Decision\n\nClose without integration.\n",
      runtimeId: RUNTIME,
    }, terminalOptions(fixture)), (error: unknown) =>
      error instanceof FoundationError &&
      error.code === "lifecycle.candidate.carrier-archive-verification");
    assert.equal(seeded.store.state().subjects.closure, null);
  } finally {
    seeded?.store.close();
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test("post-Closure recovery refuses a corrupt Candidate Carrier before Store sealing", async () => {
  const fixture = await repositoryFixture("post-closure-corrupt-carrier");
  let seeded: DecisionFixture | null = null;
  try {
    seeded = await seedDecisionReady(fixture, "post-closure-corrupt-carrier");
    const artifactPath = await carrierArtifactPath(
      fixture,
      seeded.store,
      seeded.candidateRevision,
    );
    await assert.rejects(noShipDeliveryV7({
      target: fixture.target,
      machineHome: fixture.machineHome,
      store: seeded.store,
      authorityHome: fixture.authorityHome,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
      semanticMarkdown: "# Director No-Ship Decision\n\nClose without integration.\n",
      runtimeId: RUNTIME,
    }, terminalOptions(fixture, undefined, {
      onStage: async (stage) => {
        if (stage !== "closure-recorded") return;
        await writeFile(artifactPath, "corrupt Candidate Carrier bytes\n", "utf8");
        throw new Error("fault after Closure before sealing");
      },
    })), /fault after Closure before sealing/u);
    const closure = seeded.store.state().subjects.closure;
    assert.notEqual(closure, null);
    assert.equal(seeded.store.getSeal(), null);

    await assert.rejects(recoverTerminalDeliveryV7({
      target: fixture.target,
      machineHome: fixture.machineHome,
      store: seeded.store,
      runtimeId: RUNTIME,
    }, terminalOptions(fixture)), (error: unknown) =>
      error instanceof FoundationError &&
      error.code === "lifecycle.candidate.carrier-archive-verification");
    assert.equal(seeded.store.getSeal(), null);
  } finally {
    seeded?.store.close();
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test("no-ship remains applied across external movement and recovers terminal finalization", async () => {
  const fixture = await repositoryFixture("no-ship-not-applied");
  let seeded: DecisionFixture | null = null;
  let movedCommit = "";
  try {
    seeded = await seedDecisionReady(fixture, "no-ship");
    await assert.rejects(noShipDeliveryV7({
      target: fixture.target,
      machineHome: fixture.machineHome,
      store: seeded.store,
      authorityHome: fixture.authorityHome,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
      semanticMarkdown: "# Director No-Ship Decision\n\nClose without integrating Candidate bytes.\n",
      runtimeId: RUNTIME,
    }, terminalOptions(fixture, undefined, {
      onStage: async (stage) => {
        if (stage === "transaction-effect-intended") {
          await write(fixture.target, "post-authority-movement.txt", "changed after authority\n");
          await git(fixture.target, ["add", "post-authority-movement.txt"]);
          await git(fixture.target, ["commit", "-m", "change canonical basis"]);
          movedCommit = (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim();
        }
        if (stage === "transaction-effect-observed") {
          throw new Error("terminal applied non-integration observation retained");
        }
      },
    })), /terminal applied non-integration observation retained/u);
    const activity = seeded.store.state().activities.find((value) =>
      value.operation === "delivery.no-ship" && value.stage !== "completed");
    assert(activity !== undefined);
    assert.equal(activity.recovery?.resumesAt, "transaction-finalization");
    assert.notEqual(seeded.store.getOperationSupport(activity.id), null);

    const recovered = await recoverTerminalDeliveryV7({
      target: fixture.target,
      machineHome: fixture.machineHome,
      store: seeded.store,
      runtimeId: RUNTIME,
      activityId: activity.id,
    }, terminalOptions(fixture, undefined, {
      now: timeOwner("2026-08-29T22:00:00.000Z"),
    }));
    assert.equal(recovered.status, "completed");
    assert.equal(recovered.transactionOutcome, "applied");
    assert.notEqual(recovered.closure, null);
    assert.notEqual(recovered.archiveManifestDigest, null);
    assert.equal((await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim(), movedCommit);
    assert.equal(await readFile(join(fixture.target, "post-authority-movement.txt"), "utf8"),
      "changed after authority\n");
  } finally {
    try { seeded?.store.close(); } catch { /* Store may already be closed */ }
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test("acceptance recovery preserves exact success after forward movement and uncertainty after lost history", async () => {
  for (const scenario of ["forward", "rewritten", "pruned", "intent-only"] as const) {
    const fixture = await repositoryFixture(`history-${scenario}`);
    let seeded: DecisionFixture | null = null;
    let reopened: ControlRecordStore | null = null;
    try {
      seeded = await seedDecisionReady(fixture, `history-${scenario}`);
      await assert.rejects(acceptDeliveryV7({
        target: fixture.target, machineHome: fixture.machineHome, store: seeded.store,
        authorityHome: fixture.authorityHome,
        authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"), runtimeId: RUNTIME,
      }, terminalOptions(fixture, seeded.candidateState, {
        onStage: (stage) => {
          if (stage === (scenario === "intent-only" ? "transaction-effect-intended" : "canonical-effect-applied")) {
            throw new Error("interrupt before retaining effect observation");
          }
        },
      })), /interrupt before retaining effect observation/u);
      const activity = seeded.store.state().activities.find((item) => item.operation === "delivery.accept");
      assert(activity !== undefined);
      assert.equal(seeded.store.listEvents(0, 10_000).some((event) =>
        event.eventKind === "transaction-effect-observed" && event.payload.activityId === activity.id), false);
      const acceptedCommit = (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim();
      if (scenario === "forward") {
        await write(fixture.target, "later.txt", "A later independent canonical commit.\n");
        await git(fixture.target, ["add", "--", "later.txt"]);
        await git(fixture.target, ["commit", "-m", "Advance after unobserved acceptance"]);
      } else if (scenario !== "intent-only") {
        assert.notEqual(acceptedCommit, fixture.observation.basis.canonicalCommit);
        await git(fixture.target, ["reset", "--hard", fixture.observation.basis.canonicalCommit]);
        if (scenario === "pruned") {
          await git(fixture.target, ["reflog", "expire", "--expire=now", "--all"]);
          await git(fixture.target, ["prune", "--expire=now"]);
          assert.notEqual((await git(fixture.target, ["cat-file", "-e", acceptedCommit], { allowFailure: true })).exitCode, 0);
        } else {
          assert.equal((await git(fixture.target, ["cat-file", "-e", acceptedCommit], { allowFailure: true })).exitCode, 0,
            "Object existence alone cannot prove canonical application");
        }
      }
      const tip = (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim();
      const tipTree = (await git(fixture.target, ["rev-parse", "HEAD^{tree}"])).stdout.trim();
      seeded.store.close();
      reopened = (await openDeliveryControlRecordStore({ machineHome: fixture.machineHome,
        targetId: fixture.contract.targetId, deliveryId: seeded.deliveryId })).store;
      const recovered = await recoverTerminalDeliveryV7({ target: fixture.target, machineHome: fixture.machineHome,
        store: reopened, runtimeId: RUNTIME, activityId: activity.id }, terminalOptions(fixture, seeded.candidateState, {
        now: timeOwner("2026-08-29T21:00:00.000Z"),
      }));
      assert.equal((await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim(), tip, scenario);
      if (scenario === "forward") {
        assert.equal(recovered.status, "completed");
        assert.equal(recovered.canonicalCommit, acceptedCommit);
        assert.equal(recovered.transactionOutcome, "applied");
        reopened = (await openDeliveryControlRecordStore({ machineHome: fixture.machineHome,
          targetId: fixture.contract.targetId, deliveryId: seeded.deliveryId })).store;
        const observed = reopened.listEvents(0, 10_000).find((event) =>
          event.eventKind === "transaction-effect-observed" && event.payload.activityId === activity.id);
        const facts = observed?.payload.facts as ControlJsonObject;
        assert.equal(facts.commit, acceptedCommit);
        assert.equal(facts.recognition, "ancestor");
        assert.deepEqual(facts.observedTip, { commit: tip, tree: tipTree });
      } else {
        assert.equal(recovered.status, "recovery-required", scenario);
        assert.equal(recovered.transactionOutcome, "indeterminate", scenario);
        assert.equal(recovered.closure, null, scenario);
        assert.equal(reopened.state().subjects.closure, null, scenario);
        assert.equal(tip, fixture.observation.basis.canonicalCommit, scenario);
      }
    } finally {
      try { reopened?.close(); } catch { /* completed acceptance transfers Store custody */ }
      try { seeded?.store.close(); } catch { /* reopened or archived above */ }
      await rm(fixture.workspace, { recursive: true, force: true });
    }
  }
});

test("Director acceptance binds the integrated parent while preserving the original governing Boundary", async () => {
  const fixture = await repositoryFixture("integrated-parent");
  let seeded: DecisionFixture | null = null;
  let archived: ControlRecordStore | null = null;
  try {
    seeded = await seedDecisionReady(fixture, "integrated-parent", { advanceParent: true });
    const parent = (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim();
    assert.notEqual(parent, fixture.observation.basis.canonicalCommit);
    assert.equal(seeded.candidateRevision.payload.candidateBaseCommit, parent);
    let reviewedParent: string | null = null;
    const accepted = await acceptDeliveryV7({ target: fixture.target, machineHome: fixture.machineHome,
      store: seeded.store, authorityHome: fixture.authorityHome,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"), runtimeId: RUNTIME,
    }, terminalOptions(fixture, seeded.candidateState, {
      beforeAuthenticate: (review) => { reviewedParent = review.repository.canonicalCommit; },
    }));
    assert.equal(accepted.status, "completed");
    assert.equal(reviewedParent, parent);
    assert.equal((await git(fixture.target, ["rev-parse", "HEAD^"])).stdout.trim(), parent);
    assert.equal(await readFile(join(fixture.target, "upstream.txt"), "utf8"),
      "Independent canonical work before this Delivery integrates.\n");
    archived = (await openDeliveryControlRecordStore({ machineHome: fixture.machineHome,
      targetId: fixture.contract.targetId, deliveryId: seeded.deliveryId })).store;
    const closure = archived.getRevision(accepted.closure!.id, accepted.closure!.revision)!;
    assert.equal((closure.payload.canonicalResult as ControlJsonObject).parentCommit, parent);
    const governed = seeded.candidateRevision.relationships.find((item) => item.relation === "governed-by")!;
    const boundary = archived.getRevision(governed.target.id, governed.target.revision)!;
    assert.equal((boundary.payload.basis as ControlJsonObject).productBaseCommit, fixture.observation.basis.canonicalCommit);
    const acceptance = archived.getRevision(accepted.decision.id, accepted.decision.revision)!;
    assert.equal(((acceptance.payload.subject as ControlJsonObject).repository as ControlJsonObject).canonicalCommit, parent);
  } finally {
    try { archived?.close(); } catch { /* terminal success transfers Store custody */ }
    try { seeded?.store.close(); } catch { /* terminal success transfers Store custody */ }
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

async function advanceIntegrationParent(fixture: RepositoryFixture, kind: "clean" | "conflict" | "context" | "discovery"): Promise<string> {
  if (kind === "discovery") {
    const path = "atlas/atlas.md";
    const original = await readFile(join(fixture.target, path), "utf8");
    const close = original.indexOf("\n---", 4);
    const header = JSON.parse(original.slice(4, close));
    await write(fixture.target, path, `---\n${JSON.stringify({ ...header,
      resources: [{ id: "unselected", uri: "sources/unselected.md", title: "Unselected discovery Resource" }],
    }, null, 2)}${original.slice(close)}`);
    await write(fixture.target, "atlas/sources/unselected.md", "Independent unselected Resource bytes.\n");
    const point = "atlas/maps/project/points/project-scope.md";
    await write(fixture.target, point, `${await readFile(join(fixture.target, point), "utf8")}\nUnselected Point maintenance.\n`);
    await git(fixture.target, ["add", "--", "atlas"]);
  }
  const path = kind === "conflict" ? "src/demo.ts" : kind === "context"
    ? "atlas/atlas.md" : "upstream.txt";
  const content = kind === "context" ? `${await readFile(join(fixture.target, path), "utf8")}\nIndependent Director context maintenance.\n`
    : kind === "conflict" ? "export const terminal = 'canonical-conflict';\n" : "Independent canonical contribution.\n";
  await write(fixture.target, path, content);
  await git(fixture.target, ["add", "--", path]);
  await git(fixture.target, ["commit", "-m", `Select ${kind} integration parent`]);
  return (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim();
}

async function inspectIntegratedFiles(fixture: RepositoryFixture, store: ControlRecordStore, candidate: ControlRecordRevision) {
  const inspection = join(fixture.workspace, "integration-inspection");
  await mkdir(inspection);
  await git(inspection, ["init", "-b", "inspect"]);
  const descriptor = candidate.payload.carrierManifest as ControlJsonObject;
  const manifest = await store.readRetainedFile(descriptor.digest as Sha256);
  assert(manifest !== null);
  const state = candidate.payload.state as ControlJsonObject;
  await importCandidateRevisionCarrierIntoRepository({ machineHome: fixture.machineHome, repository: inspection,
    manifestBytes: manifest.bytes, expectedRootTree: String(state.tree) });
  return {
    contribution: (await git(inspection, ["show", `${String(state.tree)}:src/demo.ts`])).stdout,
    upstream: await git(inspection, ["show", `${String(state.tree)}:upstream.txt`], { allowFailure: true }),
    later: await git(inspection, ["show", `${String(state.tree)}:later.txt`], { allowFailure: true }),
    unselectedResource: await git(inspection, ["show", `${String(state.tree)}:atlas/sources/unselected.md`], { allowFailure: true }),
  };
}

for (const scenario of ["clean", "conflict", "context", "discovery"] as const) {
  test(`integration owner retains the exact ${scenario} result against current P without moving canonical`, async () => {
    const fixture = await repositoryFixture(`integration-${scenario}`);
    let selected: Awaited<ReturnType<typeof seedCandidateReady>> | null = null;
    try {
      selected = await seedCandidateReady(fixture, `integration-${scenario}`);
      const source = selected.candidateRevision;
      const parent = await advanceIntegrationParent(fixture, scenario);
      assert.notEqual(parent, fixture.observation.basis.canonicalCommit);
      const result = await operateFoundationIntegrationRuntimeV1({ target: fixture.target, machineHome: fixture.machineHome,
        store: selected.store, activityId: `integration-real-${scenario}`, runtimeId: RUNTIME }, { now: selected.nextTime });
      assert.equal((await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim(), parent);
      assert.equal(result.outcome, scenario === "conflict" ? "conflicted" : "constructed");
      const assessment = selected.store.getRevision(result.assessment.id, result.assessment.revision)!;
      assert.equal((assessment.payload.canonicalParent as ControlJsonObject).commit, parent);
      assert.deepEqual(assessment.relationships.find(({ relation }) => relation === "integrates")?.target,
        relationship("integrates", source).target);
      assert.equal(selected.store.state().subjects.activeBoundary?.digest, selected.boundary.digest);
      if (scenario === "conflict") {
        assert.equal(result.candidate.digest, source.digest);
        assert.equal(selected.store.state().subjects.materialCondition, null);
        assert((assessment.payload.conflicts as readonly ControlJsonValue[]).length > 0);
        assert.equal(selected.store.state().eligibleOperations.includes("delivery.continue"), true);
        assert.equal(selected.store.state().eligibleOperations.includes("delivery.integrate"), true);
        // Continue from the retained C/W and actually consume the failed P bytes
        // supplied by the installed correction Projection before constructing C'.
        const activityId = "continue-after-conflict";
        const context = await compileFoundationFreshAgentOperationContextV7({target:fixture.target,store:selected.store,activityId,
          operation:"delivery.continue",semanticMarkdown:"# Continue\n\nResolve the retained integration conflict and preserve the local contribution.\n",
          configuration:{machineHome:fixture.machineHome,installationId:"test-installation",model:"test",reasoning:"high",
            specificationRevision:FOUNDATION_SPECIFICATION_REVISION,publicationDigest:fixture.contract.specification.publicationDigest}}, {
          compileKnowledgeProjection: async (input) => {
            const compiled = await compileKnowledgeProjection(input);
            assert.equal(compiled.validation.valid, true, JSON.stringify(compiled.validation.diagnostics));
            return compiled;
          },
        });
        assert.equal(context.role,"builder");
        assert.equal(context.request.repository.commit,fixture.observation.basis.canonicalCommit);
        const correctionSources = context.projection.manifest.sources.filter(({reference}) => reference.startsWith("candidate:integration-correction:"));
        const correctionBytes = (reference:string) => {
          const content = correctionSources.find((item) => item.reference === reference)!.content;
          if (content.mode !== "mounted") assert.fail("Correction context must supply exact mounted inputs");
          const entry = context.projection.inventory.find(({path}) => path === content.path)!;
          return Buffer.from(entry.bytes,"base64").toString("utf8");
        };
        const pathFacts = JSON.parse(correctionBytes("candidate:integration-correction:parent-paths")) as {
          completeConflictPaths:boolean; entries:{path:string;sourceReference:string}[];
        };
        assert.equal(pathFacts.completeConflictPaths,true);
        const conflictedPath = pathFacts.entries.find(({path}) => path === "src/demo.ts")!;
        const parentBytes = correctionBytes(conflictedPath.sourceReference);
        assert.equal(parentBytes,"export const terminal = 'canonical-conflict';\n");
        const store = selected.store;
        const nextTime = selected.nextTime;
        const reference = (value: ControlRecordRevision) => ({id:value.recordId,revision:value.revision,digest:value.digest});
        const brief = appendRecord({store,activityId,eventId:"brief-after-conflict",eventKind:"director-brief-submitted",occurredAt:nextTime(),
          revision:recordInput({store,id:"brief-after-conflict",kind:"director-brief",createdAt:nextTime(),
            payload:{...validDeliveryControlPayload("director-brief"),scope:{kind:"activity",activityId}}})});
        appendEvent({store,activityId,eventId:"started-after-conflict",eventKind:"activity-started",occurredAt:nextTime(),payload:{operation:"delivery.continue"}});
        const attempt = appendRecord({store,activityId,eventId:"attempt-after-conflict",eventKind:"agent-attempt-prepared",occurredAt:nextTime(),
          revision:recordInput({store,id:"attempt-after-conflict",kind:"agent-attempt",createdAt:nextTime(),
            payload:{...selected.attemptPayload,activityId,operation:"delivery.continue",role:"builder",
              input:{...selected.attemptPayload.input as ControlJsonObject,evidenceSetDigest:context.evidenceSet.digest}},
            relationships:[relationship("uses-brief",brief),relationship("uses-boundary",selected.boundary),relationship("uses-candidate",source)]})});
        const effectDigest = digest("correction-effect");
        appendEvent({store,activityId,eventId:"intended-after-conflict",eventKind:"provider-effect-intended",occurredAt:nextTime(),subject:attempt,payload:{effectDigest}});
        const correctionRepository = join(fixture.workspace,"integration-correction");
        await mkdir(correctionRepository);
        await git(correctionRepository,["init","-b","correction"]);
        const sourceManifest = await store.readRetainedFile((source.payload.carrierManifest as ControlJsonObject).digest as Sha256);
        assert(sourceManifest !== null);
        const sourceState = source.payload.state as unknown as CandidateRevisionState;
        await importCandidateRevisionCarrierIntoRepository({machineHome:fixture.machineHome,repository:correctionRepository,
          manifestBytes:sourceManifest.bytes,expectedRootTree:sourceState.tree});
        await git(correctionRepository,["read-tree","--reset","-u",sourceState.tree]);
        await write(correctionRepository,"src/demo.ts",parentBytes);
        await write(correctionRepository,"src/conflict-correction.ts","export const preservedContribution = 'accepted';\n");
        await git(correctionRepository,["add","-A","--","."]);
        appendEvent({store,activityId,eventId:"observed-after-conflict",eventKind:"provider-effect-observed",occurredAt:nextTime(),subject:attempt,payload:{effectDigest,outcome:"completed"}});
        const productTemplate = validDeliveryControlPayload("agent-work-product");
        const workProduct = appendRecord({store,activityId,eventId:"product-after-conflict",eventKind:"agent-work-product-submitted",occurredAt:nextTime(),
          revision:recordInput({store,id:"product-after-conflict",kind:"agent-work-product",createdAt:nextTime(),
            payload:{...productTemplate,disposition:"partial",roleSemantics:{...productTemplate.roleSemantics as ControlJsonObject,proposal:"progress",conditions:[]}},
            relationships:[relationship("result-of",attempt)]})});
        const tree = (await git(correctionRepository,["write-tree"])).stdout.trim();
        const carrier = await publishCandidateRevisionCarrierFromGitTree({machineHome:fixture.machineHome,repository:correctionRepository,rootTree:tree});
        const admitted = await deriveCandidateRevisionCarrierAdmittedContext({machineHome:fixture.machineHome,repository:fixture.target,
          store,boundary:selected.boundary,candidate:source});
        const corrected = (await retainCandidateRevision({store,activityId,observation:"builder-successor",
          candidateBaseCommit:String(source.payload.candidateBaseCommit),carrierManifestBytes:carrier.manifestBytes,
          verifyCarrier:candidateRevisionCarrierVerifier({machineHome:fixture.machineHome,admitted,predecessor:{candidateDigest:sourceState.candidateDigest}}),
          boundary:{kind:"work-boundary",...reference(selected.boundary)},predecessor:{kind:"candidate-revision",...reference(source)},
          builderAttempt:{kind:"agent-attempt",...reference(attempt)},observedAt:nextTime(),runtimeId:RUNTIME})).revision;
        appendRecord({store,activityId,eventId:"receipt-after-conflict",eventKind:"execution-receipt-recorded",occurredAt:nextTime(),
          revision:recordInput({store,id:"receipt-after-conflict",kind:"execution-receipt",createdAt:nextTime(),
            payload:{...validDeliveryControlPayload("execution-receipt"),activityId},
            relationships:[relationship("observes-attempt",attempt),relationship("observes-work-product",workProduct),relationship("observes-candidate",corrected)]})});
        appendEvent({store,activityId,eventId:"completed-after-conflict",eventKind:"activity-completed",occurredAt:nextTime(),payload:{outcome:"completed"}});
        assert.equal(corrected.recordId,source.recordId);
        assert.equal(corrected.revision,source.revision+1);
        assert.equal(corrected.payload.candidateBaseCommit,source.payload.candidateBaseCommit);
        const reintegrated = await operateFoundationIntegrationRuntimeV1({target:fixture.target,machineHome:fixture.machineHome,store,
          activityId:"integrate-after-correction",runtimeId:RUNTIME},{now:nextTime});
        assert.equal(reintegrated.outcome,"constructed");
        const integrated = store.getRevision(reintegrated.candidate.id,reintegrated.candidate.revision)!;
        assert.equal(integrated.payload.candidateBaseCommit,parent);
        assert.deepEqual(integrated.relationships.find(({relation}) => relation === "revises")!.target,relationship("revises",corrected).target);
        assert.equal(store.state().subjects.activeBoundary!.digest,selected.boundary.digest);
        assert.equal(store.state().subjects.materialCondition,null);
        const integratedState = integrated.payload.state as ControlJsonObject;
        const integratedManifest = await store.readRetainedFile((integrated.payload.carrierManifest as ControlJsonObject).digest as Sha256);
        assert(integratedManifest !== null);
        await importCandidateRevisionCarrierIntoRepository({machineHome:fixture.machineHome,repository:correctionRepository,
          manifestBytes:integratedManifest.bytes,expectedRootTree:String(integratedState.tree)});
        assert.equal((await git(correctionRepository,["show",`${String(integratedState.tree)}:src/demo.ts`])).stdout,parentBytes);
        assert.equal((await git(correctionRepository,["show",`${String(integratedState.tree)}:src/conflict-correction.ts`])).stdout,
          "export const preservedContribution = 'accepted';\n");
        assert.equal((await git(fixture.target,["rev-parse","HEAD"])).stdout.trim(),parent);
      } else {
        const candidate = selected.store.getRevision(result.candidate.id, result.candidate.revision)!;
        assert.equal(candidate.recordId, source.recordId);
        assert.equal(candidate.revision, source.revision + 1);
        assert.equal(candidate.payload.observation, "integration-successor");
        assert.equal(candidate.payload.candidateBaseCommit, parent);
        assert.deepEqual(candidate.relationships.find(({ relation }) => relation === "revises")?.target,
          relationship("revises", source).target);
        if (scenario === "context") {
          const conditionRef = selected.store.state().subjects.materialCondition;
          assert(conditionRef !== null);
          const condition = selected.store.getRevision(conditionRef.id, conditionRef.revision)!;
          assert.equal(condition.payload.conditionClass, "integration-context-change");
          assert.deepEqual(condition.payload.source, { kind: "integration-assessment" });
          assert.deepEqual(condition.relationships.find(({ relation }) => relation === "freezes")?.target,
            relationship("freezes", candidate).target);
          assert.equal(selected.store.state().candidateCondition, "paused-for-boundary");
          assert.equal(resolveWorkBoundaryResolutionSnapshotV1({ store: selected.store, boundary: selected.boundary,
            materialCondition: condition }).commit, parent);
        } else {
          assert.deepEqual(assessment.payload.contextualApplicability, { disposition: "unchanged", changes: [] });
          assert.equal(selected.store.state().subjects.materialCondition, null);
          assert.equal(selected.store.state().eligibleOperations.includes("delivery.evaluate"), true);
          const files = await inspectIntegratedFiles(fixture, selected.store, candidate);
          assert.equal(files.contribution, "export const terminal = 'accepted';\n");
          assert.equal(files.upstream.stdout, "Independent canonical contribution.\n");
          if (scenario === "discovery") {
            const canonicalContext = await loadRepositoryEpoch(fixture.target);
            assert.notEqual(canonicalContext.atlasState.digest, fixture.observation.basis.atlasStateDigest);
            assert.notEqual(canonicalContext.atlas.resolution.normalizedModelDigest, fixture.observation.basis.atlasNormalizedModelDigest);
            assert.equal(canonicalContext.atlas.resolution.resourceBindings.find(({ resourceId }) => resourceId === "unselected")?.disposition, "resolved");
            assert.equal(files.unselectedResource.stdout, "Independent unselected Resource bytes.\n");
          }
        }
      }
    } finally {
      selected?.store.close();
      await rm(fixture.workspace, { recursive: true, force: true });
    }
  });
}

for (const checkpoint of ["opened", "assessed", "candidate-selected"] as const) {
  test(`integration recovery after ${checkpoint} retains P and C despite later canonical movement`, async () => {
    const fixture = await repositoryFixture(`integration-recover-${checkpoint}`);
    let selected: Awaited<ReturnType<typeof seedCandidateReady>> | null = null;
    let reopened: ControlRecordStore | null = null;
    try {
      selected = await seedCandidateReady(fixture, `integration-recover-${checkpoint}`);
      const parent = await advanceIntegrationParent(fixture, checkpoint === "candidate-selected" ? "context" : "clean");
      const activityId = `integration-recover-${checkpoint}`;
      await assert.rejects(operateFoundationIntegrationRuntimeV1({ target: fixture.target, machineHome: fixture.machineHome,
        store: selected.store, activityId, runtimeId: RUNTIME }, { now: selected.nextTime,
        afterCheckpoint: (stage) => {
          if (stage !== checkpoint) return;
          if (stage === "candidate-selected") {
            assert.equal(selected!.store.state().subjects.candidate?.revision, selected!.candidateRevision.revision + 1);
            assert.notEqual(selected!.store.state().subjects.materialCondition, null,
              "I and its required Material Condition must become observable atomically");
          }
          throw new Error(`interrupt ${checkpoint}`);
        },
      }), new RegExp(`interrupt ${checkpoint}`));
      const retainedAssessment = selected.store.state().subjects.integrationAssessment;
      const retainedCondition = selected.store.state().subjects.materialCondition;
      await write(fixture.target, "later.txt", "Unrelated canonical movement after integration opening.\n");
      await git(fixture.target, ["add", "--", "later.txt"]);
      await git(fixture.target, ["commit", "-m", "Move canonical during interrupted integration"]);
      const tip = (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim();
      selected.store.close();
      reopened = (await openDeliveryControlRecordStore({ machineHome: fixture.machineHome,
        targetId: fixture.contract.targetId, deliveryId: selected.deliveryId })).store;
      const result = await recoverFoundationIntegrationRuntimeV1({ target: fixture.target, machineHome: fixture.machineHome,
        store: reopened, activityId, runtimeId: RUNTIME }, { now: selected.nextTime });
      assert.equal(result.outcome, "constructed");
      const assessment = reopened.getRevision(result.assessment.id, result.assessment.revision)!;
      const candidate = reopened.getRevision(result.candidate.id, result.candidate.revision)!;
      assert.equal((assessment.payload.canonicalParent as ControlJsonObject).commit, parent);
      assert.equal(candidate.payload.candidateBaseCommit, parent);
      assert.equal(candidate.revision, selected.candidateRevision.revision + 1);
      assert.equal((await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim(), tip);
      const events = reopened.listEvents(0, 10_000).filter((event) => event.payload.activityId === activityId);
      assert.equal(events.filter((event) => event.eventKind === "integration-assessed").length, 1);
      assert.equal(events.filter((event) => event.eventKind === "candidate-revision-observed").length, 1);
      if (retainedAssessment !== null) assert.equal(assessment.digest, retainedAssessment.digest);
      if (checkpoint === "candidate-selected") {
        assert.deepEqual(reopened.state().subjects.materialCondition, retainedCondition);
        assert.equal(events.filter((event) => event.eventKind === "material-condition-frozen").length, 1);
      }
      const files = await inspectIntegratedFiles(fixture, reopened, candidate);
      assert.equal(files.contribution, "export const terminal = 'accepted';\n");
      assert.notEqual(files.later.exitCode, 0, "Recovery must not import a later canonical contribution into retained I(P)");
      if (checkpoint !== "candidate-selected") assert.equal(files.upstream.stdout, "Independent canonical contribution.\n");
    } finally {
      reopened?.close();
      try { selected?.store.close(); } catch { /* reopened above */ }
      await rm(fixture.workspace, { recursive: true, force: true });
    }
  });
}

test("a conclusive Git prepare refusal after the last parent observation permits fresh integration", async () => {
  const fixture = await repositoryFixture("late-cas-refusal");
  let seeded: DecisionFixture | null = null;
  try {
    seeded = await seedDecisionReady(fixture, "late-cas-refusal");
    let raced = false;
    let movedCommit: string | null = null;
    const result = await acceptDeliveryV7({ target: fixture.target, machineHome: fixture.machineHome,
      store: seeded.store, authorityHome: fixture.authorityHome,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"), runtimeId: RUNTIME,
    }, terminalOptions(fixture, seeded.candidateState, { onStage: async (stage) => {
      if (stage !== "canonical-effect-ready") return;
      assert.equal(raced, false);
      raced = true;
      await write(fixture.target, "late-race.txt", "Canonical moved immediately before Git acquired its ref lock.\n");
      await git(fixture.target, ["add", "--", "late-race.txt"]);
      await git(fixture.target, ["commit", "-m", "Win the late acceptance CAS race"]);
      movedCommit = (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim();
    } }));
    assert.equal(raced, true);
    assert.equal(result.status, "failed");
    assert.equal(result.transactionOutcome, "not-applied");
    assert.equal(result.closure, null);
    assert.equal((await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim(), movedCommit);
    assert.equal(await readFile(join(fixture.target, "src/demo.ts"), "utf8"), "export const terminal = 'base';\n");
    assert.equal(seeded.store.state().subjects.candidate?.digest, seeded.candidateRevision.digest);
    assert.equal(seeded.store.state().eligibleOperations.includes("delivery.integrate"), true);
  } finally {
    seeded?.store.close();
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test("acceptance prepares physical proof outside the target lock and rechecks a concurrent publication", async () => {
  const fixture = await repositoryFixture("proof-lock-scope");
  let seeded: DecisionFixture | null = null;
  try {
    seeded = await seedDecisionReady(fixture, "proof-lock-scope");
    let targetLockHeld = false;
    let retainedFileReads = 0;
    let imported = false;
    let competingCommit: string | null = null;
    let reachedCas = false;
    const readRetainedFile = seeded.store.readRetainedFile.bind(seeded.store);
    seeded.store.readRetainedFile = async (digest) => {
      assert.equal(targetLockHeld, false, "Retained Carrier and Evidence material must be read outside the target lock");
      retainedFileReads += 1;
      return readRetainedFile(digest);
    };
    const result = await acceptDeliveryV7({ target: fixture.target, machineHome: fixture.machineHome,
      store: seeded.store, authorityHome: fixture.authorityHome,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"), runtimeId: RUNTIME,
    }, terminalOptions(fixture, seeded.candidateState, {
      withTargetLock: async (target, operation, action) => withTargetOperationLock(target, operation, async () => {
        assert.equal(targetLockHeld, false);
        targetLockHeld = true;
        try { return await action(); } finally { targetLockHeld = false; }
      }),
      importCandidateCarrier: async (input) => {
        assert.equal(targetLockHeld, false, "Immutable object import must not exclude another Delivery's publication");
        assert.equal(imported, false);
        imported = true;
        await withTargetOperationLock(fixture.target, "competing-publication", async () => {
          await write(fixture.target, "concurrent.txt", "Independent canonical work during acceptance preparation.\n");
          await git(fixture.target, ["add", "--", "concurrent.txt"]);
          await git(fixture.target, ["commit", "-m", "Publish while another Delivery prepares proof"]);
          competingCommit = (await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim();
        });
        return importCandidateRevisionCarrierIntoRepository(input);
      },
      onStage: (stage) => { if (stage === "canonical-effect-ready") reachedCas = true; },
    }));
    assert.equal(imported, true);
    assert(retainedFileReads > 0);
    assert.notEqual(competingCommit, null);
    assert.equal(reachedCas, false, "The fresh parent recheck must refuse before CAS");
    assert.equal(result.status, "failed");
    assert.equal(result.transactionOutcome, "not-applied");
    assert.equal(result.closure, null);
    assert.equal((await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim(), competingCommit);
    assert.equal(seeded.store.state().eligibleOperations.includes("delivery.integrate"), true);
  } finally {
    try { seeded?.store.close(); } catch { /* terminal can transfer Store custody */ }
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test("two admitted Deliveries retain separate Stores while one publishes and the other reintegrates", async () => {
  const fixture = await repositoryFixture("two-deliveries");
  let first: DecisionFixture | null = null;
  let second: DecisionFixture | null = null;
  try {
    first = await seedDecisionReady(fixture, "two-deliveries-a");
    second = await seedDecisionReady(fixture, "two-deliveries-b");
    assert.notEqual(first.store.identity.storeId, second.store.identity.storeId);
    assert.notEqual(first.deliveryId, second.deliveryId);
    assert.equal(first.store.state().standing, "decision-ready");
    assert.equal(second.store.state().standing, "decision-ready");
    const originalBoundary = second.store.state().subjects.activeBoundary!;
    const originalCandidate = second.store.state().subjects.candidate!;
    const before = second.store.state().journal;
    const accepted = await acceptDeliveryV7({ target: fixture.target, machineHome: fixture.machineHome,
      store: first.store, authorityHome: fixture.authorityHome,
      authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"), runtimeId: RUNTIME,
    }, terminalOptions(fixture, first.candidateState));
    assert.equal(accepted.status, "completed");
    assert.notEqual(accepted.canonicalCommit, null);
    assert.deepEqual(second.store.state().journal, before, "Another Delivery's publication must not advance this Journal");
    assert.deepEqual(second.store.state().subjects.candidate, originalCandidate);
    const integrated = await operateFoundationIntegrationRuntimeV1({ target: fixture.target,
      machineHome: fixture.machineHome, store: second.store, activityId: "integration-after-other-delivery", runtimeId: RUNTIME,
    }, { now: timeOwner("2026-08-30T00:00:00.000Z") });
    assert.equal(integrated.outcome, "constructed");
    const assessment = second.store.getRevision(integrated.assessment.id, integrated.assessment.revision)!;
    const candidate = second.store.getRevision(integrated.candidate.id, integrated.candidate.revision)!;
    assert.equal((assessment.payload.canonicalParent as ControlJsonObject).commit, accepted.canonicalCommit);
    assert.equal(candidate.payload.candidateBaseCommit, accepted.canonicalCommit);
    assert.equal(candidate.recordId, originalCandidate.id);
    assert.equal(candidate.revision, originalCandidate.revision + 1);
    assert.deepEqual(second.store.state().subjects.activeBoundary, originalBoundary);
    const boundary = second.store.getRevision(originalBoundary.id, originalBoundary.revision)!;
    assert.equal((boundary.payload.basis as ControlJsonObject).productBaseCommit, fixture.observation.basis.canonicalCommit);
    assert.equal((await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim(), accepted.canonicalCommit);
  } finally {
    try { first?.store.close(); } catch { /* acceptance transfers first Store custody */ }
    try { second?.store.close(); } catch { /* retained second Store remains local */ }
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});


// Agent output and Check observations are supplied fixtures. Context compilation,
// Boundary retention, authenticated readmission, Carrier verification, integration,
// reducer progression, and terminal accounting use their actual owners.
async function resolveMeasuredConditionAndIntegrate(fixture: RepositoryFixture, store: ControlRecordStore, suffix: string): Promise<void> {
  const nextTime = timeOwner("2026-08-30T12:00:00.000Z");
  const boundaryRef = store.state().subjects.activeBoundary!;
  const conditionRef = store.state().subjects.materialCondition!;
  const candidateRef = store.state().subjects.candidate!;
  const boundary = store.getRevision(boundaryRef.id, boundaryRef.revision)!;
  const condition = store.getRevision(conditionRef.id, conditionRef.revision)!;
  const refusalEvents = store.listEvents(0, 1000).filter((event) => event.eventKind === "agent-pre-intent-refused" && event.payload.resolution === "projection-condition-required");
  assert.equal(refusalEvents.length, 1);
  assert.deepEqual(FoundationControlEventSchema.parse(refusalEvents[0]), refusalEvents[0], "The public read contract accepts the actual durable refusal");
  const conditionEvents = store.listEvents(0, 1000).filter((event) => event.eventKind === "material-condition-frozen" && event.subject?.digest === condition.digest);
  assert.equal(conditionEvents.length, 1);
  assert.equal(conditionEvents[0]!.payload.sourceKind, "projection-compilation");
  assert.deepEqual(FoundationControlEventSchema.parse(conditionEvents[0]), conditionEvents[0], "The public read contract accepts the actual frozen Projection Condition");
  const candidate = store.getRevision(candidateRef.id, candidateRef.revision)!;
  const activityId = `resolution-after-${suffix}`;
  const semanticMarkdown = "# Reaffirm the mandate\n\nSelect the permitted larger Projection capacity and preserve the product mandate.\n";
  const configuration = { machineHome: fixture.machineHome, installationId: "test-installation", model: "test", reasoning: "high",
    specificationRevision: FOUNDATION_SPECIFICATION_REVISION, publicationDigest: fixture.contract.specification.publicationDigest };
  const context = await compileFoundationFreshAgentOperationContextV7({ target: fixture.target, store, activityId,
    operation: "delivery.reaffirm", semanticMarkdown, configuration });
  assert.equal(context.operation, "delivery.reaffirm");
  if (context.role !== "reconnaissance") throw new Error("Expected exact Boundary-resolution context");
  assert.equal(context.request.class, "orientation");
  assert.equal("snapshot" in context.epoch, false, "Resolution compiles an Epoch-based Orientation");
  assert.equal(context.providerCapability.candidateWrites, false);
  assert.equal(context.materialCondition.digest, condition.digest);
  assert.equal(context.candidate.digest, candidate.digest);
  assert.match(context.request.subject.objective, /projection-compilation/);
  assert(context.knowledge !== null);
  const basis = { snapshot: await bindRepositorySnapshot(context.epoch, context.knowledge), knowledge: context.knowledge };
  assert.equal(basis.snapshot.snapshot.digest, (boundary.payload.basis as ControlJsonObject).repositorySnapshotDigest);
  const large = basis.snapshot.contract.projectionProfiles["execution-large-v1"]!;
  assert(large !== undefined);
  const oldProfile = basis.snapshot.contract.projectionProfiles[String((boundary.payload.projectionProfile as ControlJsonObject).id)]!;
  assert(large.maximumItemBytes > oldProfile.maximumItemBytes);
  const brief = appendRecord({ store, revision: { ...recordInput({ store, id: `brief-${activityId}`, kind: "director-brief", createdAt: nextTime() }),
    semanticMarkdown, payload: { ...validDeliveryControlPayload("director-brief"), scope: { kind: "activity", activityId }, inputProfile: "delivery.reaffirm",
      templateProfileId: "director-brief.resolution-v1", semanticMarkdownDigest: sha256Bytes(semanticMarkdown) } },
    eventKind: "director-brief-submitted", eventId: `brief-event-${activityId}`, occurredAt: nextTime(), activityId });
  appendEvent({ store, activityId, eventId: `start-${activityId}`, eventKind: "activity-started", occurredAt: nextTime(), payload: { operation: "delivery.reaffirm" } });
  const attempt = appendRecord({ store, revision: recordInput({ store, id: `attempt-${activityId}`, kind: "agent-attempt", createdAt: nextTime(),
    payload: { ...validDeliveryControlPayload("agent-attempt"), activityId, operation: "delivery.reaffirm", role: "reconnaissance" },
    relationships: [relationship("uses-brief", brief), relationship("uses-boundary", boundary), relationship("uses-candidate", candidate)] }),
    eventKind: "agent-attempt-prepared", eventId: `prepared-${activityId}`, occurredAt: nextTime(), activityId });
  const effectDigest = digest(`effect-${activityId}`);
  appendEvent({ store, activityId, eventId: `intended-${activityId}`, eventKind: "provider-effect-intended", occurredAt: nextTime(), subject: attempt, payload: { effectDigest } });
  appendEvent({ store, activityId, eventId: `observed-${activityId}`, eventKind: "provider-effect-observed", occurredAt: nextTime(), subject: attempt, payload: { effectDigest, outcome: "completed" } });
  const mandate = boundary.payload.mandate as ControlJsonObject;
  const baseProduct = validDeliveryControlPayload("agent-work-product");
  const workProduct = appendRecord({ store, revision: recordInput({ store, id: `product-${activityId}`, kind: "agent-work-product", createdAt: nextTime(),
    payload: { ...baseProduct, profileId: "lifecycle.agent-work-product-body.reconnaissance.v4", role: "reconnaissance", disposition: "complete",
      claims: [{ id: "claim.same-mandate", category: "route", state: "proposed", statement: "The unchanged mandate can use the registered larger Projection profile.",
        knowledgeIds: [fixture.check.id], evidenceIds: [], paths: [], uncertainty: "none", fragmentDigest: digest("resolution-claim") }],
      citations: [{ id: "citation.selected-check", subjectId: fixture.check.id, subjectKind: "knowledge", subjectDigest: fixture.check.sourceDigest,
        locator: `knowledge://${fixture.check.id}`, authorityClass: "repository-authored", claimIds: ["claim.same-mandate"], fragmentDigest: digest("resolution-citation") }],
      body: { profileId: "lifecycle.agent-work-product-body.reconnaissance.v4", digest: digest("resolution-body"), fragments: [] },
      roleSemantics: { role: "reconnaissance", proposal: "work-boundary", conditionIds: [condition.recordId], decisionIds: ["proposition.1"], effectIds: [],
        workBoundary: { selectedKnowledgeIds: [fixture.check.id], selectedWorkTypeIds: [], selectedSourceIds: [],
          capabilityProfileId: (boundary.payload.capabilityProfile as ControlJsonObject).id!, projectionProfile: "execution-large-v1",
          objective: mandate.objective!, mandate: mandate.direction!, effects: mandate.effects!, risks: mandate.risks!, obligations: mandate.obligations!, artifacts: mandate.artifacts!,
          checks: (mandate.checks as readonly ControlJsonObject[]).map(({ definition, bindings, ...check }) => ({ ...check,
            checkKnowledgeId: (definition as ControlJsonObject).id!, bindingIds: (bindings as readonly ControlJsonObject[]).map(({ id }) => id!) })),
          propositions: mandate.acceptancePropositions! } } }, relationships: [relationship("result-of", attempt)] }),
    eventKind: "agent-work-product-submitted", eventId: `submitted-${activityId}`, occurredAt: nextTime(), activityId });
  const baseReceipt = validDeliveryControlPayload("execution-receipt");
  const receipt = appendRecord({ store, revision: recordInput({ store, id: `receipt-${activityId}`, kind: "execution-receipt", createdAt: nextTime(),
    payload: { ...baseReceipt, activityId, role: "reconnaissance", providerEffect: { effectDigest, outcome: "completed" },
      productiveExecutionStarted: true,
      inputBindings: { roleBriefDigest: digest("resolution-role"), contentInventoryDigest: digest("resolution-inventory"), inputMaterialDigest: digest("resolution-input") },
      provider: { ...(baseReceipt.provider as ControlJsonObject), firstTrigger: "submission", terminalReason: "valid-submission", stage: "evaluated", startedAt: nextTime(), finishedAt: nextTime(), exitCode: 0 },
      execution: { ...(baseReceipt.execution as ControlJsonObject), output: { availability: "retrieved", carrierByteLength: 512,
        carrierDigest: digest("resolution-output"), manifestDigest: digest("resolution-output-manifest") } },
      candidate: { ...(baseReceipt.candidate as ControlJsonObject), successorDisposition: null },
      workspace: { availability: "available", rawByteLength: 512, workspaceRawDigest: digest("resolution-workspace"),
        semanticMarkdownDigest: digest("resolution-semantic"), failureFactsDigest: null, submissionDiagnostic: null,
        parserDisposition: "valid", compilerDisposition: "retained", parseResultDigest: workProduct.payload.parseResultDigest!,
        fixedBindingSubjectDigest: workProduct.payload.fixedBindingSubjectDigest! },
      workProduct: { disposition: "submitted", reference: relationship("observes-work-product", workProduct).target } },
    relationships: [relationship("observes-attempt", attempt), relationship("observes-work-product", workProduct)] }),
    eventKind: "execution-receipt-recorded", eventId: `received-${activityId}`, occurredAt: nextTime(), activityId });
  const ref = <Kind extends "director-brief" | "agent-work-product" | "execution-receipt" | "work-boundary" | "material-condition">(kind: Kind, record: ControlRecordRevision) =>
    ({ kind, id: record.recordId, revision: record.revision, digest: record.digest });
  const selectedBinding = fixture.contract.checkBindings["binding.check.demo"]!;
  const successor = retainWorkBoundary({ store, activityId, operation: "delivery.reaffirm",
    directorBrief: ref("director-brief", brief), workProduct: ref("agent-work-product", workProduct), executionReceipt: ref("execution-receipt", receipt),
    repository: workBoundaryRepositoryBasisFromSnapshot(basis.snapshot.snapshot), knowledge: [fixture.check],
    disciplineRegistry: { digest: basis.knowledge.disciplineRegistry.digest, adoptions: [], workTypes: [] }, externalSources: [],
    capabilityProfile: boundary.payload.capabilityProfile as { id: string; digest: Sha256 },
    projectionProfile: { id: large.id, digest: large.digest, semanticProfile: "execution-large-v1" },
    checkBindings: [{ id: selectedBinding.id, checkKnowledgeId: fixture.check.id, digest: selectedBinding.digest, implementationDigest: selectedBinding.implementationDigest }],
    compiler: boundary.payload.compiler as WorkBoundaryCompilerFact, activeBoundary: ref("work-boundary", boundary), materialCondition: ref("material-condition", condition),
    finalizedAt: nextTime(), runtimeId: RUNTIME }).revision;
  assert.deepEqual(successor.payload.mandate, boundary.payload.mandate);
  assert.deepEqual((successor.payload.resolution as ControlJsonObject).changedMandateFields, []);
  assert.deepEqual(successor.payload.projectionProfile, { id: large.id, digest: large.digest });
  const priorBaseline = store.listEvents(0, 1000).find((event) => event.eventKind === "check-receipt-recorded")!.subject!;
  const baselinePayload = store.getRevision(priorBaseline.recordId, priorBaseline.revision)!.payload;
  appendRecord({ store, revision: recordInput({ store, id: `baseline-${activityId}`, kind: "check-receipt", createdAt: nextTime(), payload: baselinePayload,
    relationships: [relationship("checks-boundary", successor)] }), eventKind: "check-receipt-recorded", eventId: `checked-${activityId}`, occurredAt: nextTime(), activityId });
  appendEvent({ store, activityId, eventId: `completed-${activityId}`, eventKind: "activity-completed", occurredAt: nextTime(), payload: { outcome: "completed" } });
  assert.equal(store.state().standing, "awaiting-readmission");
  const readmitted = await admitDeliveryV7({ target: fixture.target, machineHome: fixture.machineHome, store, authorityHome: fixture.authorityHome,
    authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"), runtimeId: RUNTIME }, { now: nextTime });
  assert.equal(readmitted.status, "completed");
  assert.equal(readmitted.decisionKind, "readmit");
  const rebound = store.getRevision(readmitted.candidate!.id, readmitted.candidate!.revision)!;
  assert.equal(rebound.payload.observation, "readmission-rebind");
  assert.deepEqual(rebound.payload.state, candidate.payload.state);
  assert.deepEqual(rebound.payload.carrierManifest, candidate.payload.carrierManifest);
  assert.equal(store.state().subjects.materialCondition, null);
  const nextContext = await compileFoundationFreshAgentOperationContextV7({ target: fixture.target, store,
    activityId: `next-builder-${suffix}`, operation: "delivery.continue", semanticMarkdown: "# Continue the admitted work\n", configuration });
  assert.equal(nextContext.request.profile.id, "execution-large-v1");
  assert.equal(nextContext.boundary.digest, successor.digest);
  const integrated = await operateFoundationIntegrationRuntimeV1({ target: fixture.target, machineHome: fixture.machineHome, store,
    activityId: `integration-after-resolution-${suffix}`, runtimeId: RUNTIME }, { now: nextTime });
  assert.equal(integrated.outcome, "constructed");
  assert.equal(integrated.candidate.revision, rebound.revision + 1);
  assert.equal(store.state().activities.find(({ id }) => id === `integration-after-resolution-${suffix}`)?.stage, "completed");
  const integrationEvents = store.listEvents(0, 1000).filter((event) => event.eventKind === "integration-assessed" && event.payload.activityId === `integration-after-resolution-${suffix}`);
  assert.equal(integrationEvents.length, 1);
  assert.equal(integrationEvents[0]!.subject?.digest, integrated.assessment.digest);
  assert.deepEqual(FoundationControlEventSchema.parse(integrationEvents[0]), integrationEvents[0], "The public read contract accepts the actual subsequent integration");
}

test("an unallocated reviewer Condition resolves, readmits and progresses before truthful no-ship", async () => {
  const fixture = await repositoryFixture("no-ship-unallocated-projection");
  let seeded: DecisionFixture | null = null;
  try {
    seeded = await seedDecisionReady(fixture, "no-ship-unallocated-projection", { projectionRefusal: true });
    await resolveMeasuredConditionAndIntegrate(fixture, seeded.store, "reviewer");
    const selected = terminalOptions(fixture, undefined, { now: timeOwner("2026-08-31T12:00:00.000Z") });
    const observe = selected.observeReclamationHandoff!;
    const closed = await noShipDeliveryV7({ target: fixture.target, machineHome: fixture.machineHome, store: seeded.store,
      authorityHome: fixture.authorityHome, authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
      semanticMarkdown: "# No ship\n\nClose this frozen Candidate.\n", runtimeId: RUNTIME,
    }, { ...selected, observeReclamationHandoff: async (input) => {
      assert.equal(input.preIntentRefusals.length, 0);
      assert.equal(input.subjects.length, 6);
      return await observe(input);
    } });
    assert.equal(closed.status, "completed");
    const archived = await openDeliveryControlRecordStore({ machineHome: fixture.machineHome, targetId: fixture.contract.targetId, deliveryId: seeded.deliveryId });
    try {
      const ref = archived.store.state().subjects.closure!;
      const closure = archived.store.getRevision(ref.id, ref.revision)!;
      assert.equal((closure.payload.terminalExecutions as ControlJsonObject).executionCount, 6);
      assert.equal((closure.payload.reclamationHandoff as ControlJsonObject).obligationCount, 6);
    } finally { archived.store.close(); }
  } finally { seeded?.store.close(); await rm(fixture.workspace, { recursive: true, force: true }); }
});

for (const lostReturn of [false, true]) test(`an unallocated builder Condition is atomic and closes without a fabricated handoff (lost return ${lostReturn})`, async () => {
  const fixture = await repositoryFixture(`builder-refusal-${lostReturn}`);
  let seeded: Awaited<ReturnType<typeof seedCandidateReady>> | null = null;
  try {
    seeded = await seedCandidateReady(fixture, `builder-refusal-${lostReturn}`, { projectionRefusal: true });
    const { store, boundary, candidateRevision, nextTime } = seeded;
    const loaded = await loadRepositoryEpoch(fixture.target);
    const knowledge = (await validateKnowledgeSet(loaded)).knowledgeSet;
    assert(knowledge !== null);
    const snapshot = await bindRepositorySnapshot(loaded, knowledge);
    const request = compileFoundationExecutionProjectionRequestV7({ snapshot,
      repositoryValidation: { complete: true, valid: true, digest: digest("builder-fixture-validation") } as never,
      knowledge, boundary, candidate: candidateRevision, seal: null, role: "builder", integration: null });
    const error = mandatoryProjectionItemSizeErrorV1({ profile: request.profile, category: "source", id: "conflict.parent.file",
      locator: "src/demo.ts", objectId: "a".repeat(40), observedBytes: request.profile.maximumItemBytes + 1 });
    assert(bindFoundationMandatoryProjectionRefusalV1(error, request) !== null);
    const before = store.state().journal.eventCount;
    const appendBatch = store.appendBatch.bind(store);
    let batches = 0;
    store.appendBatch = (appends) => {
      batches += 1;
      assert.deepEqual(appends.map(({ event }) => event.eventKind), ["director-brief-submitted", "activity-started", "agent-pre-intent-refused", "material-condition-frozen", "activity-completed"]);
      const result = appendBatch(appends);
      if (lostReturn) throw new Error("lost builder refusal commit return");
      return result;
    };
    const activityId = `builder-refused-${lostReturn}`;
    await assert.rejects(operateFoundationCandidateAgentRuntimeV7({ target: fixture.target, store, activityId,
      operation: "delivery.continue", runtimeId: RUNTIME, agentId: "unallocated-builder",
      configuration: { machineHome: fixture.machineHome, installationId: "test-installation", model: "test", reasoning: "high",
        specificationRevision: FOUNDATION_SPECIFICATION_REVISION, publicationDigest: fixture.contract.specification.publicationDigest },
      opening: { directorId: fixture.contract.authority.principalId, semanticMarkdown: "# Correct the failed integration\n",
        submittedAt: nextTime(), startedAt: nextTime(), attemptCreatedAt: nextTime() },
    }, { compileFreshContext: async () => { throw error; }, operateAgent: async () => assert.fail("Refused context cannot allocate an Agent"),
      agentOperation: { now: nextTime } }), lostReturn ? /lost builder refusal/ : /requires boundary resolution/);
    store.appendBatch = appendBatch;
    assert.equal(batches, 1);
    assert.equal(store.state().journal.eventCount, before + 5);
    assert.equal(store.state().activities.find(({ id }) => id === activityId)?.stage, "completed");
    assert.equal(store.hasRetainedOperationSupport(activityId), false);
    assert.equal(store.state().standing, "boundary-paused");
    assert.equal(store.state().eligibleOperations.includes("delivery.revise"), true);
    assert.equal(store.state().eligibleOperations.includes("delivery.reaffirm"), true);
    const conditionRef = store.state().subjects.materialCondition!;
    const condition = store.getRevision(conditionRef.id, conditionRef.revision)!;
    assert.deepEqual(condition.relationships.map(({ relation }) => relation).sort(), ["freezes", "governed-by"]);
    await resolveMeasuredConditionAndIntegrate(fixture, store, `builder-${lostReturn}`);
    const selected = terminalOptions(fixture, undefined, { now: timeOwner("2026-08-31T12:00:00.000Z") });
    const observe = selected.observeReclamationHandoff!;
    const closed = await noShipDeliveryV7({ target: fixture.target, machineHome: fixture.machineHome, store,
      authorityHome: fixture.authorityHome, authorityCredential: receiveFoundationAuthorityCredential(SECRET, "director-decision"),
      semanticMarkdown: "# No ship\n\nClose the frozen Candidate.\n", runtimeId: RUNTIME }, {
      ...selected, observeReclamationHandoff: async (input) => {
        assert.equal(input.preIntentRefusals.length, 0);
        assert.equal(input.subjects.length, 5);
        return await observe(input);
      },
    });
    assert.equal(closed.status, "completed");
  } finally { seeded?.store.close(); await rm(fixture.workspace, { recursive: true, force: true }); }
});

test("a contained invalid builder Output supplies read-only repair context and the next Attempt promotes corrected Candidate bytes", async () => {
  const fixture = await repositoryFixture("builder-output-repair");
  let seeded: Awaited<ReturnType<typeof seedCandidateReady>> | null = null;
  try {
    seeded = await seedCandidateReady(fixture, "builder-output-repair");
    const { store, boundary, candidateRevision } = seeded;
    const original = store.state().subjects.candidate!;
    const originalState = candidateRevision.payload.state as unknown as CandidateRevisionState;
    const originalManifest = (candidateRevision.payload.carrierManifest as ControlJsonObject).digest as Sha256;
    const rawManifest = await store.readRetainedFile(originalManifest);
    assert(rawManifest !== null);
    const work = join(fixture.workspace, "builder-output");
    await git(fixture.workspace, ["clone", "--no-local", "--no-hardlinks", fixture.target, work]);
    await importCandidateRevisionCarrierIntoRepository({ machineHome: fixture.machineHome, manifestBytes: rawManifest.bytes,
      repository: work, expectedRootTree: originalState.tree });
    await git(work, ["read-tree", originalState.tree]);
    await git(work, ["checkout-index", "-a", "-f"]);
    const malformed = "---\n{malformed-description\n---\n\n# Preserve this repairable partial output\n";
    await write(work, "src/_source.desc.md", malformed);
    await write(work, "src/demo.ts", "export const terminal = 'partial-repair';\n");
    await git(work, ["add", "-A", "--", "."]);
    const failedTree = (await git(work, ["write-tree"])).stdout.trim();
    const output = async (): Promise<readonly AgentCellFixtureOutputEntry[]> => {
      const entries = (await git(work, ["ls-files", "--stage", "-z"])).stdout.split("\0").filter(Boolean);
      return Promise.all(entries.map(async (entry) => {
        const [metadata, path] = entry.split("\t");
        assert(path !== undefined);
        const mode = metadata!.split(" ")[0];
        assert(mode === "100644" || mode === "100755");
        return { path: `candidate-output/${path}`, purpose: "candidate-output" as const, mediaType: "application/octet-stream",
          modeClass: mode === "100755" ? "executable" as const : "regular" as const, bytes: Uint8Array.from(await readFile(join(work, path))) };
      }));
    };
    const now = timeOwner("2026-09-01T00:00:00.000Z");
    const installedImage = executionContractFixture("agent-operation-v7").image;
    const cellDigest = (label: string) => sha256Bytes(`foundation-agent-operation-v7:${label}`);
    const configuration = { machineHome: fixture.machineHome, installationId: "installation-agent-operation-v7", model: "test-builder", reasoning: "high",
      specificationRevision: FOUNDATION_SPECIFICATION_REVISION, publicationDigest: fixture.contract.specification.publicationDigest,
      execution: { image: { ...installedImage, immutableReference: `${installedImage.imageId}@${installedImage.imageDigest}`,
        configurationDigest: cellDigest("image-configuration"), platform: { os: "linux" as const, architecture: "amd64" as const, variant: null },
        nonRootUser: "65532:65532", runnerContractId: "lifecycle.execution-cell-runner.v1" as const,
        runnerContractDigest: cellDigest("runner-contract"), runnerImplementationDigest: cellDigest("runner-implementation"), toolInventoryDigest: cellDigest("tool-inventory"),
        agentProvider: { codexVersion: "0.153.4", executableIdentity: cellDigest("agent-executable"), adapterImplementationDigest: cellDigest("runner-implementation") } } } };
    const invoke = async (activityId: string, entries: readonly AgentCellFixtureOutputEntry[]) => {
      const harness = installedHarness({ machineHome: fixture.machineHome, now, outputEntries: entries,
        backendLimits: { maximumWallTimeMilliseconds: 30 * 60 * 1000, maximumProcesses: 128, maximumStorageBytes: 256 * 1024 * 1024,
          maximumOutputEntries: 10000, maximumOutputBytes: 256 * 1024 * 1024, maximumOutputEntryBytes: 1024 * 1024, maximumEvents: 10000 } });
      const result = await operateFoundationCandidateAgentRuntimeV7({ target: fixture.target, store, configuration, activityId,
        operation: "delivery.continue", runtimeId: RUNTIME, agentId: "agent:builder-repair", opening: {
          directorId: fixture.contract.authority.principalId, semanticMarkdown: "# Continue\n\nRepair the exact Candidate within the admitted mandate.\n",
          submittedAt: now(), startedAt: now(), attemptCreatedAt: now() } }, { agentOperation: harness.options });
      assert.equal(harness.dispatchCount(), 1);
      assert.equal(store.state().activities.find(({ id }) => id === activityId)?.stage, "completed");
      const receipt = store.getRevision(result.receipt.id, result.receipt.revision)!;
      assert.equal((receipt.payload.providerEffect as ControlJsonObject).outcome, "completed");
      assert.equal((receipt.payload.containment as ControlJsonObject).classification, "contained");
      assert.equal((receipt.payload.retirement as ControlJsonObject).classification, "retired");
      return { result, receipt };
    };
    const firstEntries = await output();
    assert(firstEntries.some(({ bytes }) => bytes.byteLength === 0), "Complete Candidate output preserves empty tracked files");
    const first = await invoke("invalid-builder-output", firstEntries);
    assert.equal(first.result.outcome, "failed");
    assert.equal((first.receipt.payload.candidate as ControlJsonObject).successorDisposition, "invalid");
    assert.equal((first.receipt.payload.candidate as ControlJsonObject).successor, null);
    assert.deepEqual(store.state().subjects.candidate, original);
    assert.equal(store.state().subjects.materialCondition, null);
    const repair = await selectFoundationBuilderRepairOutputV1({ store, boundary, candidate: candidateRevision });
    assert(repair !== null);
    assert.equal(repair.receipt.digest, first.receipt.digest);
    assert.equal(repair.descriptor.rejection.candidateTree, failedTree);
    const nextContext = await compileFoundationFreshAgentOperationContextV7({ target: fixture.target, store, configuration,
      activityId: "corrected-builder-output", operation: "delivery.continue", semanticMarkdown: "# Correct retained output\n" });
    const repairSources = nextContext.projection.manifest.sources.filter(({ reference }) => reference.startsWith("candidate:builder-repair:"));
    assert.equal(repairSources.length, 3, "Only the exact repair inventory and two changed Product files are supplied");
    assert.equal(repairSources.filter(({ authority }) => authority === "runtime-authenticated-fact").length, 1);
    const bytes = repairSources.map((source) => {
      assert.equal(source.semantic.class, source.authority === "runtime-authenticated-fact" ? "candidate" : "source");
      if (source.semantic.class === "source") assert.equal(source.authority, "informational-source");
      assert.match(source.useLimit!, /Read-only unselected Product output/);
      assert.equal(source.content.mode, "mounted");
      if (source.content.mode !== "mounted") throw new Error("Expected mounted exact repair bytes");
      assert.equal(source.content.readOnly, true);
      const path = source.content.path;
      return Buffer.from(nextContext.projection.inventory.find((entry) => entry.path === path)!.bytes, "base64").toString("utf8");
    });
    assert(bytes.includes(malformed));
    assert(bytes.includes("export const terminal = 'partial-repair';\n"));
    assert.equal(nextContext.candidate.digest, candidateRevision.digest, "Failed output never becomes the writable Candidate basis");
    assert.equal(nextContext.boundary.digest, boundary.digest);
    assert.equal(canonicalJson(nextContext.capabilityProfile), canonicalJson(boundary.payload.capabilityProfile));
    await write(work, "src/_source.desc.md", sourceDescription());
    await write(work, "src/demo.ts", "export const terminal = 'corrected-repair';\n");
    await git(work, ["add", "-A", "--", "."]);
    const correctedTree = (await git(work, ["write-tree"])).stdout.trim();
    const second = await invoke("corrected-builder-output", await output());
    // Missing semantic Markdown remains failed, independently of useful validated progress.
    assert.equal(second.result.outcome, "failed");
    assert.equal((second.receipt.payload.candidate as ControlJsonObject).successorDisposition, "promoted");
    const current = store.state().subjects.candidate!;
    assert.equal(current.id, original.id);
    assert.equal(current.revision, original.revision + 1);
    const promoted = store.getRevision(current.id, current.revision)!;
    assert.equal((promoted.payload.state as ControlJsonObject).tree, correctedTree);
    assert.notEqual(correctedTree, failedTree);
    assert.equal(await selectFoundationBuilderRepairOutputV1({ store, boundary, candidate: promoted }), null);
    const retainedManifest = await store.readRetainedFile((promoted.payload.carrierManifest as ControlJsonObject).digest as Sha256);
    assert(retainedManifest !== null);
    const reopened = await openCandidateRevisionCarrier({ machineHome: fixture.machineHome, manifestBytes: retainedManifest.bytes });
    assert.equal(reopened.manifest.rootTree, correctedTree);
  } finally { seeded?.store.close(); await rm(fixture.workspace, { recursive: true, force: true }); }
});
