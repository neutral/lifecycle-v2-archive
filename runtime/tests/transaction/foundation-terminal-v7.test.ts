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
import { dirname, join } from "node:path";
import test from "node:test";
import {
  createFoundationRuntimeOperationRequest,
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
import { retainCandidateRevision } from "../../src/foundation/control/candidate-revision.js";
import {
  createDeliveryControlRecordStore,
  openDeliveryControlRecordStore,
} from "../../src/foundation/control/delivery-custody.js";
import { compileControlRecordRevision } from "../../src/foundation/control/model.js";
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
import { initializeRepository } from "../../src/foundation/repository/initialize.js";
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
  sha256Bytes,
  type Sha256,
} from "../../src/foundation/validation/canonical.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";
import { writeMinimalAtlas } from "../helpers/atlas-fixture.js";

const RUNTIME = "foundation-runtime";
const SECRET = "terminal-v7-authority-secret-with-sufficient-entropy";
const PUBLICATION = sha256Bytes("terminal-v7-publication");

function digest(value: string): Sha256 {
  return sha256Bytes(value);
}

async function write(root: string, path: string, contents: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), contents, "utf8");
}

function sourceDescription(): string {
  const frontMatter = {
    schema: "lifecycle.knowledge-record.v1",
    kind: "description",
    id: "description.terminal-v7-source",
    title: "Terminal v7 source",
    status: "current",
    revision: 1,
    supersedes: null,
    summary: "Own the governed source used by the terminal transaction fixture.",
    owners: ["founder:terminal-v7"],
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
  const contract = await initializeRepository(target, {
    targetId: `terminal-v7-target-${suffix}`,
    founderPrincipal: "founder:terminal-v7",
    home: authorityHome,
    authoritySecret: SECRET,
    publicationDigest: PUBLICATION,
    implementationRoots: ["src"],
    stage: true,
  });
  await write(target, "src/demo.ts", "export const terminal = 'base';\n");
  await write(target, "src/_source.desc.md", sourceDescription());
  await git(target, ["add", "--", "."]);
  await git(target, ["commit", "-m", "Create terminal base"]);
  const observation = await terminalObservation(target);
  assert.equal(observation.contract.digest, contract.digest);
  return Object.freeze({
    workspace,
    target,
    authorityHome,
    machineHome,
    contract,
    observation,
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
  author: "founder" | "agent" | "runtime";
  authority:
    | "founder-supplied"
    | "founder-authenticated"
    | "agent-proposed"
    | "runtime-derived"
    | "runtime-observed";
}>;

const SEMANTICS = Object.freeze({
  "founder-brief": Object.freeze({ author: "founder", authority: "founder-supplied" }),
  "agent-attempt": Object.freeze({ author: "runtime", authority: "runtime-derived" }),
  "agent-work-product": Object.freeze({ author: "agent", authority: "agent-proposed" }),
  "execution-receipt": Object.freeze({ author: "runtime", authority: "runtime-observed" }),
  "work-boundary": Object.freeze({ author: "runtime", authority: "runtime-derived" }),
  "founder-decision": Object.freeze({ author: "founder", authority: "founder-authenticated" }),
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
  return Object.freeze({
    recordId: input.id,
    recordKind: input.kind,
    revision: 1,
    producer: Object.freeze({ kind: "runtime" as const, id: RUNTIME }),
    semanticAuthor: Object.freeze({ kind: semantics.author, id: `${semantics.author}:terminal-v7` }),
    semanticAuthority: semantics.authority,
    createdAt: input.createdAt,
    semanticMarkdown: `# ${input.kind}\n\nTerminal v7 focused fixture.\n`,
    payload: input.payload ?? validDeliveryControlPayload(input.kind),
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

async function seedDecisionReady(
  fixture: RepositoryFixture,
  suffix: string,
  options: Readonly<{ preIntentRefusal?: boolean }> = {},
): Promise<DecisionFixture> {
  const deliveryId = `terminal-v7-delivery-${suffix}`;
  const store = await createStore(fixture, deliveryId);
  const nextTime = fixtureClock();
  const prepareId = `prepare-${suffix}`;
  const brief = appendRecord({
    store,
    revision: recordInput({
      store,
      id: `brief-${suffix}`,
      kind: "founder-brief",
      createdAt: nextTime(),
    }),
    eventKind: "founder-brief-submitted",
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
  const boundary = appendRecord({
    store,
    revision: recordInput({
      store,
      id: `boundary-${suffix}`,
      kind: "work-boundary",
      createdAt: nextTime(),
      payload: Object.freeze({
        ...boundaryPayload,
        targetId: fixture.contract.targetId,
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
  const checkPayload = validDeliveryControlPayload("check-receipt");
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
  const manualDecisionPayload = validDeliveryControlPayload("founder-decision");
  const manualDecisionSubject = manualDecisionPayload.subject as ControlJsonObject;
  const decision = appendRecord({
    store,
    revision: recordInput({
      store,
      id: `decision-admit-${suffix}`,
      kind: "founder-decision",
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
    eventKind: "founder-decision-authenticated",
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
        kind: "founder-brief",
        createdAt: nextTime(),
      }),
      eventKind: "founder-brief-submitted",
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
      kind: "founder-brief",
      createdAt: nextTime(),
    }),
    eventKind: "founder-brief-submitted",
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

  const evaluateId = `evaluate-${suffix}`;
  const reviewBrief = appendRecord({
    store,
    revision: recordInput({
      store,
      id: `brief-evaluate-${suffix}`,
      kind: "founder-brief",
      createdAt: nextTime(),
    }),
    eventKind: "founder-brief-submitted",
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
      relationships: Object.freeze([relationship("result-of", reviewAttempt)]),
    }),
    eventKind: "agent-work-product-submitted",
    eventId: `event-work-product-evaluate-${suffix}`,
    occurredAt: nextTime(),
    activityId: evaluateId,
  });
  const reviewReceipt = appendRecord({
    store,
    revision: recordInput({
      store,
      id: `receipt-evaluate-${suffix}`,
      kind: "execution-receipt",
      createdAt: nextTime(),
      payload: Object.freeze({ ...receiptPayload, activityId: evaluateId }),
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
  const evidencePayload = validDeliveryControlPayload("evidence-packet");
  appendRecord({
    store,
    revision: recordInput({
      store,
      id: `evidence-${suffix}`,
      kind: "evidence-packet",
      createdAt: nextTime(),
      payload: Object.freeze({ ...evidencePayload, readiness: "acceptance-ready" }),
      relationships: Object.freeze([
        relationship("governed-by", boundary),
        relationship("evaluates", candidateRevision),
        relationship("uses-seal", seal),
        relationship("uses-check", baseline),
        relationship("uses-check", final),
        relationship("uses-review", reviewProduct),
        relationship("uses-review-receipt", reviewReceipt),
      ]),
    }),
    eventKind: "evidence-packet-finalized",
    eventId: `event-evidence-${suffix}`,
    occurredAt: nextTime(),
    activityId: evaluateId,
  });
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
    const firstCarrierVerification = await verifyCandidateCarriersForStoreArchive({
      machineHome: fixture.machineHome,
      store: seeded.store,
    });
    const secondCarrierVerification = await verifyCandidateCarriersForStoreArchive({
      machineHome: fixture.machineHome,
      store: seeded.store,
    });
    assert.deepEqual(secondCarrierVerification, firstCarrierVerification);
    assert.equal(firstCarrierVerification.candidateRevisionCount, 2);
    await git(fixture.target, ["prune", "--expire=now"]);
    assert.notEqual((await git(fixture.target, [
      "rev-parse", "--verify", "--end-of-options", `${seeded.candidateState.tree}^{tree}`,
    ], { allowFailure: true })).exitCode, 0);
    await assert.rejects(acceptDeliveryV7({
      target: fixture.target,
      machineHome: fixture.machineHome,
      store: seeded.store,
      authorityHome: fixture.authorityHome,
      authoritySecret: SECRET,
      runtimeId: RUNTIME,
    }, terminalOptions(fixture, seeded.candidateState, {
      onStage: (stage) => {
        if (stage === "transaction-effect-intended") {
          throw new Error("terminal intent committed fault");
        }
      },
    })), /terminal intent committed fault/u);

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
    assert.equal(events.filter(({ eventKind }) => eventKind === "founder-decision-authenticated")
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

async function assertTerminalBranchLeaseRead(input: Readonly<{
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
  assert.equal(result.diagnostics.some(({ code }) =>
    code === "lifecycle.delivery.branch-lease-violation"), false);

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
  const leaseDiagnostic = moved.diagnostics.find(({ code }) =>
    code === "lifecycle.delivery.branch-lease-violation");
  assert.notEqual(leaseDiagnostic, undefined);
  assert.equal(leaseDiagnostic?.facts?.expectedCommit, input.expectedCommit);
  assert.equal(leaseDiagnostic?.facts?.expectedTree, input.expectedTree);
  assert.equal(leaseDiagnostic?.facts?.observedCommit, movedCommit);
  assert.equal(leaseDiagnostic?.facts?.observedTree, movedTree);
}

test("accepted Closure retains its canonical result as the branch lease until Store disposition", async () => {
  const fixture = await repositoryFixture("accepted-closed-read");
  let seeded: DecisionFixture | null = null;
  try {
    seeded = await seedDecisionReady(fixture, "accepted-closed-read");
    await assert.rejects(acceptDeliveryV7({
      target: fixture.target,
      machineHome: fixture.machineHome,
      store: seeded.store,
      authorityHome: fixture.authorityHome,
      authoritySecret: SECRET,
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
    assert.equal(result.diagnostics.some(({ code }) =>
      code === "lifecycle.delivery.branch-lease-violation"), false);

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
    const leaseDiagnostic = moved.diagnostics.find(({ code }) =>
      code === "lifecycle.delivery.branch-lease-violation");
    assert.notEqual(leaseDiagnostic, undefined);
    assert.equal(leaseDiagnostic?.facts?.expectedCommit, acceptedCommit);
    assert.equal(leaseDiagnostic?.facts?.observedCommit, movedCommit);
  } finally {
    try { seeded?.store.close(); } catch { /* terminal interruption retains Store custody */ }
    await rm(fixture.workspace, { recursive: true, force: true });
  }
});

test("no-ship Closure retains the admitted basis as the branch lease until Store disposition", async () => {
  const fixture = await repositoryFixture("no-ship-closed-read");
  let seeded: DecisionFixture | null = null;
  try {
    seeded = await seedDecisionReady(fixture, "no-ship-closed-read");
    await assert.rejects(noShipDeliveryV7({
      target: fixture.target,
      machineHome: fixture.machineHome,
      store: seeded.store,
      authorityHome: fixture.authorityHome,
      authoritySecret: SECRET,
      semanticMarkdown: "# Founder No-Ship Decision\n\nClose without integrating Candidate bytes.\n",
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

    await assertTerminalBranchLeaseRead({
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
  test(`${disposition} sealed Store retains its terminal branch lease until archive`, async () => {
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
          authoritySecret: SECRET,
          runtimeId: RUNTIME,
        }, terminalOptions(fixture, seeded.candidateState, interruptAtSeal)),
        /accepted Store retained before archive/u);
      } else {
        await assert.rejects(noShipDeliveryV7({
          target: fixture.target,
          machineHome: fixture.machineHome,
          store: seeded.store,
          authorityHome: fixture.authorityHome,
          authoritySecret: SECRET,
          semanticMarkdown: "# Founder No-Ship Decision\n\nClose without integrating Candidate bytes.\n",
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

      await assertTerminalBranchLeaseRead({
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
      authoritySecret: SECRET,
      semanticMarkdown: "# Founder No-Ship Decision\n\nClose without integration.\n",
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

test("acceptance refuses Atlas branch movement made after admission", async () => {
  const fixture = await repositoryFixture("accept-atlas-advance");
  let seeded: DecisionFixture | null = null;
  try {
    seeded = await seedDecisionReady(fixture, "accept-atlas-advance");
    const atlasPath = join(fixture.target, "atlas/maps/project/points/project-scope.md");
    await writeFile(
      atlasPath,
      `${await readFile(atlasPath, "utf8")}\nAtlas maintenance belongs after Closure.\n`,
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
      authoritySecret: SECRET,
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
      authoritySecret: SECRET,
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
      authoritySecret: SECRET,
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
      authoritySecret: SECRET,
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
        eventKind === "founder-decision-authenticated").filter(({ payload }) =>
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
      authoritySecret: SECRET,
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
      eventKind === "founder-decision-authenticated").filter(({ payload }) =>
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
      authoritySecret: SECRET,
      runtimeId: RUNTIME,
    }, terminalOptions(fixture, seeded.candidateState));
    assert.equal(refused.status, "failed");
    assert.equal(refused.transactionOutcome, "not-applied");
    assert.equal((await git(fixture.target, ["rev-parse", "HEAD"])).stdout.trim(), movedCommit);
    assert(seeded.store.listEvents(0, 10_000).length > beforeEvents);
    assert.equal(seeded.store.listEvents(0, 10_000).filter(({ eventKind, payload }) =>
      eventKind === "founder-decision-authenticated" &&
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
      authoritySecret: SECRET,
      semanticMarkdown: "# Founder No-Ship Decision\n\nClose without integrating Candidate bytes.\n",
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
    assert.equal(reopenedCarrierSet.candidateRevisionCount, 2);
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
      authoritySecret: SECRET,
      semanticMarkdown: "# Founder No-Ship Decision\n\nClose after pre-intent refusal.\n",
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
      eventKind === "founder-decision-authenticated" &&
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
      authoritySecret: SECRET,
      semanticMarkdown: "# Founder No-Ship Decision\n\nClose without integration.\n",
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
      authoritySecret: SECRET,
      semanticMarkdown: "# Founder No-Ship Decision\n\nClose without integration.\n",
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
      authoritySecret: SECRET,
      semanticMarkdown: "# Founder No-Ship Decision\n\nClose without integrating Candidate bytes.\n",
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
