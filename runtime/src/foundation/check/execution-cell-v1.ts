import { lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  openCandidateRevisionCarrier,
} from "../candidate/carrier-store.js";
import {
  parseCandidateRevisionCarrierManifest,
} from "../candidate/carrier-manifest.js";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
} from "../candidate/carrier-types.js";
import {
  buildCandidateRevisionCarrierPack,
  inspectCandidateRevisionCarrierClosure,
} from "../candidate/git-object-closure.js";
import type {
  CheckReceiptObservation,
  CheckReceiptRawMaterial,
  CheckReceiptResultFact,
} from "../control/check-receipt.js";
import type { ControlRecordStore } from "../control/store.js";
import type {
  ControlJsonObject,
  ControlJsonValue,
  ControlRecordRevision,
} from "../control/types.js";
import { FoundationError } from "../error.js";
import { FOUNDATION_DOCKER_CHECK_ENVIRONMENT_LIMITATION } from "./environment-requirements.js";
import {
  readWorkDelegationExecution,
  workDelegationCheckSelectionMatches,
  workDelegationCheckSlot,
} from "../control/work-delegation-execution.js";
import type {
  FoundationExecutionBackend,
} from "../execution/backend.js";
import {
  parseFoundationExecutionSpecification,
  type FoundationExecutionBackendProfileReferenceV1,
  type FoundationExecutionBackendProfileV1,
  type FoundationExecutionImageReferenceV1,
  type FoundationExecutionSpecificationV1,
} from "../execution/contracts.js";
import type {
  FoundationDockerInputSetTransportResolverV1,
  FoundationDockerInputSetTransportV1,
} from "../execution/docker-cli-engine-driver-v1.js";
import {
  compileFoundationExecutionInputSet,
  type FoundationExecutionInputEntryPlanV1,
  type FoundationExecutionInputResolverV1,
  type FoundationExecutionInputSetV1,
  type FoundationExecutionInputSubjectV1,
  type FoundationVerifiedExecutionInputEntryV1,
  type FoundationVerifiedExecutionInputSubjectV1,
} from "../execution/input-set.js";
import {
  FoundationExecutionOperationHostV1,
  type FoundationExecutionOperationCheckpointPersistenceV1,
} from "../execution/operation-host.js";
import type {
  FoundationExecutionOutputStoreV1,
} from "../execution/output-store-v1.js";
import type {
  FoundationExecutionReclamationLedgerV1,
} from "../execution/reclamation-ledger-v1.js";
import type {
  FoundationDockerExecutionBindingRegistryV1,
} from "../execution/docker-binding-registry-v1.js";
import type {
  FoundationValidatedExecutionOutputArtifactV1,
  FoundationValidatedExecutionOutputV1,
} from "../execution/output-validation.js";
import type { FoundationCheckBinding } from "../repository/types.js";
import { git } from "../repository/git.js";
import {
  canonicalJson,
  digestCanonical,
  selfDigest,
  sha256Bytes,
  type Sha256,
} from "../validation/canonical.js";

const CHECK_PROOF_SCHEMA = "lifecycle.check-cell-proof.v1" as const;
const CHECK_PROOF_PATH = "check-proof/result.json";
const CHECK_RAW_PATH = "raw-check-output/streams.json";
const CHECK_BINDING_PATH = "check/binding.json";
const CHECK_DEFINITION_PATH = "check/definition.json";
const CHECK_PROOF_SUBJECT_PATH = "check/proof-subject.json";
const CARRIER_MANIFEST_PATH = "candidate/carrier-manifest.json";
const CARRIER_ARTIFACT_PATH = "candidate/carrier.pack";
const PRODUCT_BASE_SUBJECT_PATH = "product-base/subject.json";
const PRODUCT_BASE_MANIFEST_PATH = "product-base/object-closure.json";
const PRODUCT_BASE_ARTIFACT_PATH = "product-base/object-closure.pack";
const MAXIMUM_CELL_STEPS = 100_000;
const MAXIMUM_PROOF_BYTES = 4 * 1024 * 1024;
const MAXIMUM_RAW_BYTES = 16 * 1024 * 1024;
const MAXIMUM_CHECK_CELL_STORAGE_BYTES = 256 * 1024 * 1024;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

export const FOUNDATION_CHECK_CELL_RUNNER_V1 = Object.freeze({
  id: "lifecycle.execution-cell-runner.v1",
  parserId: "lifecycle.check-cell-exit-code-parser.v1",
  parserDigest: digestCanonical(Object.freeze({
    schema: "lifecycle.check-cell-exit-code-parser-profile.v1",
    stateModel: "check-disposition-v2",
    proofSchema: CHECK_PROOF_SCHEMA,
    exitZero: "pass",
    exitNonzero: "fail",
    lifecycleFailure: "operational-error",
  })),
});

export type FoundationCheckCellImageV1 = FoundationExecutionImageReferenceV1 & Readonly<{
  runnerContractDigest: Sha256;
  runnerImplementationDigest: Sha256;
  toolInventoryDigest: Sha256;
}>;

export type FoundationCheckCellRuntimeV1 = Readonly<{
  backend: FoundationExecutionBackend;
  profile: FoundationExecutionBackendProfileV1;
  engineIdentityDigest: Sha256;
  bindingRegistry: FoundationDockerExecutionBindingRegistryV1;
  image: FoundationCheckCellImageV1;
  outputStore: FoundationExecutionOutputStoreV1;
  reclamation: FoundationExecutionReclamationLedgerV1;
  inputTransport: FoundationCheckCellInputTransportRegistryV1;
  clock: Readonly<{ now(): string }>;
  pollMilliseconds?: number;
}>;

type FoundationCheckCellOperationCommonInputV1 = Readonly<{
  machineHome: string;
  store: ControlRecordStore;
  activityId: string;
  selectionId: string;
  bindingId: string;
  binding: FoundationCheckBinding;
  definition: Readonly<{
    id: string;
    revision: number;
    sourceDigest: Sha256;
    semanticDigest: Sha256;
  }>;
  requestedConditions: readonly string[];
  proofSubject: ControlRecordRevision;
  persistence(
    specification: FoundationExecutionSpecificationV1,
    inputSet: FoundationExecutionInputSetV1,
  ): FoundationExecutionOperationCheckpointPersistenceV1;
}>;

export type FoundationCheckCellOperationRequestV1 = FoundationCheckCellOperationCommonInputV1 & (
  | Readonly<{
      phase: "baseline";
      candidate: null;
      productBase: Readonly<{
        repository: string;
        commit: string;
        tree: string;
      }>;
    }>
  | Readonly<{
      phase: "final";
      candidate: ControlRecordRevision;
      productBase: null;
    }>
);

export type FoundationCheckCellOperationInputV1 = FoundationCheckCellOperationRequestV1 & Readonly<{
  runtime: FoundationCheckCellRuntimeV1;
}>;

/** A Check owner requests exact work without receiving Backend capability. */
export type FoundationCheckCellOperatorV1 = Readonly<{
  operate(input: FoundationCheckCellOperationRequestV1): Promise<FoundationCheckCellOperationResultV1>;
  clock: Readonly<{ now(): string }>;
}>;

export type FoundationCheckCellOperationResultV1 = Readonly<{
  observation: CheckReceiptObservation;
  specification: FoundationExecutionSpecificationV1 | null;
  inputSet: FoundationExecutionInputSetV1 | null;
}>;

type InputBytes = Readonly<{
  path: string;
  purpose: FoundationExecutionInputEntryPlanV1["purpose"];
  mediaType: string;
  modeClass: "regular" | "executable";
  sourceSubjectDigest: Sha256;
  bytes: Uint8Array;
}>;

type SubjectBytes = Readonly<{
  subject: FoundationExecutionInputSubjectV1;
  bytes: Uint8Array;
  candidateBinding: FoundationVerifiedExecutionInputSubjectV1["candidateBinding"];
}>;

type RetainedTransport = Readonly<{
  inputSet: FoundationExecutionInputSetV1;
  entries: readonly InputBytes[];
}>;

function fail(
  code: string,
  message: string,
  observedFacts: Readonly<Record<string, unknown>> = {},
): never {
  throw new FoundationError(`lifecycle.check-cell-v1.${code}`, message, { observedFacts });
}

function object(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || value === undefined || Array.isArray(value) || typeof value !== "object") {
    fail("retained-fact", `${label} must be one exact object`);
  }
  return value as ControlJsonObject;
}

function string(value: ControlJsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0) fail("retained-fact", `${label} must be text`);
  return value;
}

function digest(value: ControlJsonValue | undefined, label: string): Sha256 {
  const selected = string(value, label);
  if (!SHA256.test(selected)) fail("retained-fact", `${label} must be one SHA-256 digest`);
  return selected as Sha256;
}

function exactBytes(value: unknown): Uint8Array {
  return Uint8Array.from(Buffer.from(`${canonicalJson(value)}\n`, "utf8"));
}

function referenceBytes(revision: ControlRecordRevision): Uint8Array {
  return exactBytes(revision);
}

function relationship(
  revision: ControlRecordRevision,
  relation: string,
  kind: string,
): ControlRecordRevision["relationships"][number]["target"] {
  const matches = revision.relationships.filter((entry) => entry.relation === relation);
  if (matches.length !== 1 || matches[0]!.target.kind !== kind) {
    fail("relationship", `${revision.recordKind} must bind one exact ${relation} ${kind}`);
  }
  return matches[0]!.target;
}

function retainedTarget(
  store: ControlRecordStore,
  target: ControlRecordRevision["relationships"][number]["target"],
): ControlRecordRevision {
  const revision = store.getRevision(target.id, target.revision);
  if (revision === null || revision.recordKind !== target.kind || revision.digest !== target.digest) {
    fail("relationship", `Relationship does not resolve one exact ${target.kind}`);
  }
  return revision;
}

/**
 * Process-private logical-to-Docker transport registry. Recovery recompiles
 * and re-registers the same exact Input Set before the Backend is opened; no
 * physical Cell or host path enters the logical Input Set.
 */
export class FoundationCheckCellInputTransportRegistryV1
implements FoundationDockerInputSetTransportResolverV1 {
  readonly #values = new Map<Sha256, RetainedTransport>();

  register(inputSet: FoundationExecutionInputSetV1, entries: readonly InputBytes[]): void {
    const value = Object.freeze({
      inputSet,
      entries: Object.freeze(entries.map((entry) => Object.freeze({
        ...entry,
        bytes: Uint8Array.from(entry.bytes),
      }))),
    });
    const existing = this.#values.get(inputSet.digest);
    if (existing !== undefined && canonicalJson(existing.inputSet) !== canonicalJson(inputSet)) {
      fail("input-substitution", "Input transport registration substituted one retained digest");
    }
    this.#values.set(inputSet.digest, value);
  }

  async open(specification: FoundationExecutionSpecificationV1): Promise<FoundationDockerInputSetTransportV1> {
    const retained = this.#values.get(specification.inputSet.digest);
    if (retained === undefined || retained.inputSet.digest !== specification.inputSet.digest) {
      fail("input-unavailable", "Exact Check Input Set transport is not registered for recovery");
    }
    return Object.freeze({
      inputSet: retained.inputSet,
      inputSetDigest: retained.inputSet.digest,
      async *entries() {
        for (const entry of retained.entries) {
          const bytes = Uint8Array.from(entry.bytes);
          yield Object.freeze({
            path: entry.path,
            byteLength: bytes.byteLength,
            digest: sha256Bytes(bytes),
            modeClass: entry.modeClass,
            async *read() { yield Uint8Array.from(bytes); },
          });
        }
      },
    });
  }
}

function resolver(
  subjects: readonly SubjectBytes[],
  entries: readonly InputBytes[],
): FoundationExecutionInputResolverV1 {
  const subjectsByDigest = new Map(subjects.map((entry) => [entry.subject.digest, entry]));
  const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));
  return Object.freeze({
    async verifySubject(subject): Promise<FoundationVerifiedExecutionInputSubjectV1> {
      const retained = subjectsByDigest.get(subject.digest);
      if (retained === undefined || canonicalJson(retained.subject) !== canonicalJson(subject)) {
        fail("input-substitution", `Check Input Set substituted ${subject.kind}`);
      }
      const bytes = Uint8Array.from(retained.bytes);
      return Object.freeze({
        subject,
        immutable: true,
        byteLength: bytes.byteLength,
        bytesDigest: sha256Bytes(bytes),
        bytes,
        candidateBinding: retained.candidateBinding,
      });
    },
    async verifyEntry(plan): Promise<FoundationVerifiedExecutionInputEntryV1> {
      const retained = entriesByPath.get(plan.path);
      if (retained === undefined ||
          canonicalJson({
            path: retained.path,
            purpose: retained.purpose,
            mediaType: retained.mediaType,
            modeClass: retained.modeClass,
            sourceSubjectDigest: retained.sourceSubjectDigest,
          }) !== canonicalJson(plan)) {
        fail("input-substitution", `Check Input Set substituted entry ${plan.path}`);
      }
      const bytes = Uint8Array.from(retained.bytes);
      return Object.freeze({
        descriptor: Object.freeze({ ...plan, byteLength: bytes.byteLength, digest: sha256Bytes(bytes) }),
        immutable: true,
        bytes,
      });
    },
  });
}

async function compileBaselineInput(
  input: FoundationCheckCellOperationInputV1 & Readonly<{ phase: "baseline" }>,
): Promise<Readonly<{
  inputSet: FoundationExecutionInputSetV1;
  entries: readonly InputBytes[];
}>> {
  if (input.proofSubject.recordKind !== "work-boundary" ||
      input.proofSubject.payload.schema !== "lifecycle.work-boundary-payload.v6") {
    fail("product-base", "Baseline Check requires one exact Work Boundary with the selected v6 payload");
  }
  const retainedBoundary = input.store.getRevision(
    input.proofSubject.recordId,
    input.proofSubject.revision,
  );
  if (retainedBoundary === null || retainedBoundary.digest !== input.proofSubject.digest ||
      canonicalJson(retainedBoundary) !== canonicalJson(input.proofSubject)) {
    fail("product-base", "Baseline Check proof subject is not one exact retained Work Boundary");
  }
  const basis = object(input.proofSubject.payload.basis, "Work Boundary basis");
  const commit = string(basis.productBaseCommit, "Work Boundary product-base commit");
  const tree = string(basis.productBaseTree, "Work Boundary product-base tree");
  if (input.productBase.commit !== commit || input.productBase.tree !== tree) {
    fail("product-base", "Baseline Check product-base input differs from its exact Work Boundary");
  }
  const limits = Object.freeze({
    ...FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
    maximumAggregateObjectBytes: Math.min(
      FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1.maximumAggregateObjectBytes,
      MAXIMUM_CHECK_CELL_STORAGE_BYTES,
      input.runtime.profile.limits.maximumStorageBytes,
    ),
    maximumCarrierArtifactBytes: Math.min(
      FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1.maximumCarrierArtifactBytes,
      MAXIMUM_CHECK_CELL_STORAGE_BYTES,
      input.runtime.profile.limits.maximumStorageBytes,
    ),
  });
  const resolvedTree = await git(
    input.productBase.repository,
    ["rev-parse", "--verify", `${commit}^{tree}`],
    { allowFailure: true, timeoutMs: limits.commandTimeoutMs },
  );
  if (resolvedTree.exitCode !== 0 || resolvedTree.stdout.trim() !== tree) {
    fail("product-base", "Work Boundary product-base commit does not resolve its exact retained tree");
  }
  const closure = await inspectCandidateRevisionCarrierClosure({
    repository: input.productBase.repository,
    rootTree: tree,
    limits,
  });
  const productBaseValue = Object.freeze({
    schema: "lifecycle.check-product-base.v1" as const,
    proofSubjectDigest: input.proofSubject.digest,
    objectFormat: closure.objectFormat,
    commit,
    tree,
  });
  const productBaseBytes = exactBytes(productBaseValue);
  const productBaseDigest = sha256Bytes(productBaseBytes);
  const stagingRoot = await mkdtemp(join(tmpdir(), "lifecycle-check-product-base-"));
  let artifactBytes: Uint8Array;
  let manifestBytes: Uint8Array;
  let manifestDigest: Sha256;
  try {
    const prepared = await buildCandidateRevisionCarrierPack({
      repository: input.productBase.repository,
      stagingRoot,
      closure,
      limits,
    });
    artifactBytes = Uint8Array.from(await readFile(prepared.artifactPath));
    if (artifactBytes.byteLength !== prepared.artifact.byteLength ||
        sha256Bytes(artifactBytes) !== prepared.artifact.digest) {
      fail("product-base", "Product-base object-closure artifact changed after preparation");
    }
    const aggregateObjectBytes = closure.objectInventory.reduce((sum, entry) => {
      const result = sum + entry.byteLength;
      if (!Number.isSafeInteger(result)) fail("product-base", "Product-base object closure exceeds the safe-integer domain");
      return result;
    }, 0);
    const manifestSubject = Object.freeze({
      schema: "lifecycle.check-product-base-object-closure.v1" as const,
      productBaseDigest,
      objectFormat: closure.objectFormat,
      baseCommit: commit,
      rootTree: closure.rootTree,
      allowedTreeModes: Object.freeze(["040000", "100644", "100755"] as const),
      objectInventory: closure.objectInventory,
      objectCount: closure.objectInventory.length,
      aggregateObjectBytes,
      objectInventoryDigest: digestCanonical(closure.objectInventory),
      artifact: prepared.artifact,
    });
    const manifest = Object.freeze({ ...manifestSubject, digest: selfDigest(manifestSubject) });
    manifestBytes = exactBytes(manifest);
    manifestDigest = sha256Bytes(manifestBytes);
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
  const definitionValue = Object.freeze({ ...input.definition });
  const bindingValue = Object.freeze({ ...input.binding });
  const runnerValue = Object.freeze({
    schema: "lifecycle.execution-cell-runner-subject.v1",
    contractId: "lifecycle.execution-cell-runner.v1",
    contractDigest: input.runtime.image.runnerContractDigest,
    implementationDigest: input.runtime.image.runnerImplementationDigest,
    toolInventoryDigest: input.runtime.image.toolInventoryDigest,
  });
  const subjects: readonly SubjectBytes[] = Object.freeze([
    Object.freeze({
      subject: Object.freeze({
        kind: "product-base" as const,
        id: `${input.proofSubject.recordId}.product-base`,
        revision: input.proofSubject.revision,
        digest: productBaseDigest,
      }),
      bytes: productBaseBytes,
      candidateBinding: null,
    }),
    Object.freeze({
      subject: Object.freeze({
        kind: "product-base-object-closure-manifest" as const,
        id: `${input.proofSubject.recordId}.product-base-object-closure`,
        revision: input.proofSubject.revision,
        digest: manifestDigest,
      }),
      bytes: manifestBytes,
      candidateBinding: null,
    }),
    Object.freeze({
      subject: Object.freeze({
        kind: "check-definition" as const,
        id: input.definition.id,
        revision: input.definition.revision,
        digest: input.definition.semanticDigest,
      }),
      bytes: exactBytes(definitionValue),
      candidateBinding: null,
    }),
    Object.freeze({
      subject: Object.freeze({
        kind: "check-binding" as const,
        id: input.bindingId,
        revision: null,
        digest: input.binding.digest,
      }),
      bytes: exactBytes(bindingValue),
      candidateBinding: null,
    }),
    Object.freeze({
      subject: Object.freeze({
        kind: "check-proof-subject" as const,
        id: input.proofSubject.recordId,
        revision: input.proofSubject.revision,
        digest: input.proofSubject.digest,
      }),
      bytes: referenceBytes(input.proofSubject),
      candidateBinding: null,
    }),
    Object.freeze({
      subject: Object.freeze({
        kind: "runner" as const,
        id: FOUNDATION_CHECK_CELL_RUNNER_V1.id,
        revision: null,
        digest: input.runtime.image.runnerContractDigest,
      }),
      bytes: exactBytes(runnerValue),
      candidateBinding: null,
    }),
  ]);
  const entries: readonly InputBytes[] = Object.freeze([
    Object.freeze({
      path: PRODUCT_BASE_ARTIFACT_PATH,
      purpose: "product-base-object-closure-artifact" as const,
      mediaType: "application/vnd.git.pack",
      modeClass: "regular" as const,
      sourceSubjectDigest: manifestDigest,
      bytes: artifactBytes,
    }),
    Object.freeze({
      path: PRODUCT_BASE_MANIFEST_PATH,
      purpose: "check-input" as const,
      mediaType: "application/vnd.lifecycle.check-product-base-object-closure+json",
      modeClass: "regular" as const,
      sourceSubjectDigest: manifestDigest,
      bytes: manifestBytes,
    }),
    Object.freeze({
      path: PRODUCT_BASE_SUBJECT_PATH,
      purpose: "check-input" as const,
      mediaType: "application/vnd.lifecycle.check-product-base+json",
      modeClass: "regular" as const,
      sourceSubjectDigest: productBaseDigest,
      bytes: productBaseBytes,
    }),
    Object.freeze({
      path: CHECK_BINDING_PATH,
      purpose: "check-input" as const,
      mediaType: "application/json",
      modeClass: "regular" as const,
      sourceSubjectDigest: input.binding.digest,
      bytes: exactBytes(bindingValue),
    }),
    Object.freeze({
      path: CHECK_DEFINITION_PATH,
      purpose: "check-input" as const,
      mediaType: "application/json",
      modeClass: "regular" as const,
      sourceSubjectDigest: input.definition.semanticDigest,
      bytes: exactBytes(definitionValue),
    }),
    Object.freeze({
      path: CHECK_PROOF_SUBJECT_PATH,
      purpose: "check-input" as const,
      mediaType: "application/json",
      modeClass: "regular" as const,
      sourceSubjectDigest: input.proofSubject.digest,
      bytes: referenceBytes(input.proofSubject),
    }),
  ]);
  const inputSet = await compileFoundationExecutionInputSet({
    owner: Object.freeze({
      kind: "check",
      phase: "baseline",
      activityId: input.activityId,
      selectionId: input.selectionId,
      ownerSubjectDigest: input.proofSubject.digest,
    }),
    inputMaterialDigest: digestCanonical(Object.freeze({
      schema: "lifecycle.check-cell-input-material.v1",
      phase: "baseline",
      productBaseDigest,
      productBaseObjectClosureManifestDigest: manifestDigest,
      proofSubjectDigest: input.proofSubject.digest,
      definitionDigest: input.definition.semanticDigest,
      bindingDigest: input.binding.digest,
    })),
    subjects: subjects.map(({ subject }) => subject),
    entries: entries.map(({ bytes: _bytes, ...plan }) => plan),
    runnerContractDigest: input.runtime.image.runnerContractDigest,
    toolInventoryDigest: input.runtime.image.toolInventoryDigest,
    resolver: resolver(subjects, entries),
  });
  if (inputSet.aggregateByteLength > input.runtime.profile.limits.maximumStorageBytes) {
    fail("product-base", "Baseline Check Input Set exceeds the selected Backend storage limit");
  }
  input.runtime.inputTransport.register(inputSet, entries);
  return Object.freeze({ inputSet, entries });
}

async function compileInput(input: FoundationCheckCellOperationInputV1): Promise<Readonly<{
  inputSet: FoundationExecutionInputSetV1;
  entries: readonly InputBytes[];
}>> {
  if (input.phase === "baseline") return await compileBaselineInput(input);
  if (input.candidate.recordKind !== "candidate-revision" ||
      input.candidate.payload.schema !== "lifecycle.candidate-revision-payload.v3") {
    fail("candidate", "Final Check requires one exact Candidate Revision v3");
  }
  if (input.proofSubject.recordKind !== "candidate-seal" ||
      input.proofSubject.payload.schema !== "lifecycle.candidate-seal-payload.v2") {
    fail("candidate", "Final Check requires one exact Candidate Seal v2 proof subject");
  }
  const retainedProofSubject = input.store.getRevision(
    input.proofSubject.recordId,
    input.proofSubject.revision,
  );
  if (retainedProofSubject === null || retainedProofSubject.digest !== input.proofSubject.digest ||
      canonicalJson(retainedProofSubject) !== canonicalJson(input.proofSubject)) {
    fail("candidate", "Final Check proof subject is not one exact retained Candidate Seal");
  }
  const selectedCandidate = retainedTarget(
    input.store,
    relationship(input.proofSubject, "seals", "candidate-revision"),
  );
  if (selectedCandidate.digest !== input.candidate.digest ||
      canonicalJson(selectedCandidate) !== canonicalJson(input.candidate)) {
    fail("candidate", "Final Check Candidate differs from its exact retained Seal relationship");
  }
  const manifestReference = object(input.candidate.payload.carrierManifest, "Candidate Carrier manifest reference");
  const manifestDigest = digest(manifestReference.digest, "Candidate Carrier manifest digest");
  const retainedManifest = await input.store.readRetainedFile(manifestDigest);
  if (retainedManifest === null || retainedManifest.descriptor.digest !== manifestDigest) {
    fail("candidate", "Candidate Carrier manifest is unavailable from retained Control");
  }
  const opened = await openCandidateRevisionCarrier({
    machineHome: input.machineHome,
    manifestBytes: retainedManifest.bytes,
  });
  const manifest = parseCandidateRevisionCarrierManifest(
    retainedManifest.bytes,
    FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
  );
  const state = object(input.candidate.payload.state, "Candidate state");
  if (manifest.rootTree !== string(state.tree, "Candidate tree")) {
    fail("candidate", "Candidate Carrier root tree differs from retained Candidate state");
  }
  const maximumArtifactBytes = Math.min(
    MAXIMUM_CHECK_CELL_STORAGE_BYTES,
    input.runtime.profile.limits.maximumStorageBytes,
  );
  const artifactState = await lstat(opened.artifactPath);
  if (
    !artifactState.isFile() || artifactState.isSymbolicLink() ||
    artifactState.size !== manifest.carrierArtifact.byteLength ||
    artifactState.size > maximumArtifactBytes
  ) {
    fail("candidate", "Candidate Carrier artifact exceeds the bounded Check Cell storage profile");
  }
  const artifactBytes = Uint8Array.from(await readFile(opened.artifactPath));
  if (artifactBytes.byteLength !== manifest.carrierArtifact.byteLength ||
      sha256Bytes(artifactBytes) !== manifest.carrierArtifact.digest) {
    fail("candidate", "Candidate Carrier artifact changed after verified open");
  }
  const definitionValue = Object.freeze({ ...input.definition });
  const bindingValue = Object.freeze({ ...input.binding });
  const runnerValue = Object.freeze({
    schema: "lifecycle.execution-cell-runner-subject.v1",
    contractId: "lifecycle.execution-cell-runner.v1",
    contractDigest: input.runtime.image.runnerContractDigest,
    implementationDigest: input.runtime.image.runnerImplementationDigest,
    toolInventoryDigest: input.runtime.image.toolInventoryDigest,
  });
  const subjects: readonly SubjectBytes[] = Object.freeze([
    Object.freeze({
      subject: Object.freeze({
        kind: "candidate-revision" as const,
        id: input.candidate.recordId,
        revision: input.candidate.revision,
        digest: input.candidate.digest,
      }),
      bytes: referenceBytes(input.candidate),
      candidateBinding: Object.freeze({
        carrierManifestFileDigest: manifestDigest,
        rootTree: manifest.rootTree,
      }),
    }),
    Object.freeze({
      subject: Object.freeze({
        kind: "candidate-revision-carrier-manifest" as const,
        id: `${input.candidate.recordId}.carrier-manifest`,
        revision: input.candidate.revision,
        digest: manifestDigest,
      }),
      bytes: Uint8Array.from(retainedManifest.bytes),
      candidateBinding: null,
    }),
    Object.freeze({
      subject: Object.freeze({
        kind: "check-definition" as const,
        id: input.definition.id,
        revision: input.definition.revision,
        digest: input.definition.semanticDigest,
      }),
      bytes: exactBytes(definitionValue),
      candidateBinding: null,
    }),
    Object.freeze({
      subject: Object.freeze({
        kind: "check-binding" as const,
        id: input.bindingId,
        revision: null,
        digest: input.binding.digest,
      }),
      bytes: exactBytes(bindingValue),
      candidateBinding: null,
    }),
    Object.freeze({
      subject: Object.freeze({
        kind: "check-proof-subject" as const,
        id: input.proofSubject.recordId,
        revision: input.proofSubject.revision,
        digest: input.proofSubject.digest,
      }),
      bytes: referenceBytes(input.proofSubject),
      candidateBinding: null,
    }),
    Object.freeze({
      subject: Object.freeze({
        kind: "runner" as const,
        id: FOUNDATION_CHECK_CELL_RUNNER_V1.id,
        revision: null,
        digest: input.runtime.image.runnerContractDigest,
      }),
      bytes: exactBytes(runnerValue),
      candidateBinding: null,
    }),
  ]);
  const entries: readonly InputBytes[] = Object.freeze([
    Object.freeze({
      path: CARRIER_ARTIFACT_PATH,
      purpose: "candidate-carrier-artifact" as const,
      mediaType: "application/vnd.git.pack",
      modeClass: "regular" as const,
      sourceSubjectDigest: manifestDigest,
      bytes: artifactBytes,
    }),
    Object.freeze({
      path: CARRIER_MANIFEST_PATH,
      purpose: "check-input" as const,
      mediaType: "application/vnd.lifecycle.candidate-revision-carrier-manifest+json",
      modeClass: "regular" as const,
      sourceSubjectDigest: manifestDigest,
      bytes: Uint8Array.from(retainedManifest.bytes),
    }),
    Object.freeze({
      path: CHECK_BINDING_PATH,
      purpose: "check-input" as const,
      mediaType: "application/json",
      modeClass: "regular" as const,
      sourceSubjectDigest: input.binding.digest,
      bytes: exactBytes(bindingValue),
    }),
    Object.freeze({
      path: CHECK_DEFINITION_PATH,
      purpose: "check-input" as const,
      mediaType: "application/json",
      modeClass: "regular" as const,
      sourceSubjectDigest: input.definition.semanticDigest,
      bytes: exactBytes(definitionValue),
    }),
    Object.freeze({
      path: CHECK_PROOF_SUBJECT_PATH,
      purpose: "check-input" as const,
      mediaType: "application/json",
      modeClass: "regular" as const,
      sourceSubjectDigest: input.proofSubject.digest,
      bytes: referenceBytes(input.proofSubject),
    }),
  ]);
  const inputSet = await compileFoundationExecutionInputSet({
    owner: Object.freeze({
      kind: "check",
      phase: "final",
      activityId: input.activityId,
      selectionId: input.selectionId,
      ownerSubjectDigest: input.proofSubject.digest,
    }),
    inputMaterialDigest: digestCanonical(Object.freeze({
      schema: "lifecycle.check-cell-input-material.v1",
      phase: "final",
      candidateDigest: input.candidate.digest,
      proofSubjectDigest: input.proofSubject.digest,
      definitionDigest: input.definition.semanticDigest,
      bindingDigest: input.binding.digest,
    })),
    subjects: subjects.map(({ subject }) => subject),
    entries: entries.map(({ bytes: _bytes, ...plan }) => plan),
    runnerContractDigest: input.runtime.image.runnerContractDigest,
    toolInventoryDigest: input.runtime.image.toolInventoryDigest,
    resolver: resolver(subjects, entries),
  });
  input.runtime.inputTransport.register(inputSet, entries);
  return Object.freeze({ inputSet, entries });
}

/**
 * Pure resource projection from already selected Binding/Profile/Image facts.
 * Both pre-opening reservation and the actual Specification use this owner.
 * This does not establish installation availability or authorize allocation.
 */
export function compileFoundationCheckCellResourceSelectionV1(input: Readonly<{
  binding: FoundationCheckBinding;
  profile: FoundationExecutionBackendProfileV1;
  image: FoundationCheckCellImageV1;
}>): Readonly<{
  backendProfile: FoundationExecutionBackendProfileReferenceV1;
  image: FoundationExecutionImageReferenceV1;
  limits: FoundationExecutionSpecificationV1["limits"];
}> {
  const profile = input.profile;
  const limits = Object.freeze({
    wallTimeMilliseconds: Math.min(input.binding.timeoutMs + 30_000, profile.limits.maximumWallTimeMilliseconds),
    processes: Math.min(32, profile.limits.maximumProcesses),
    storageBytes: Math.min(MAXIMUM_CHECK_CELL_STORAGE_BYTES, profile.limits.maximumStorageBytes),
    outputEntries: Math.min(3, profile.limits.maximumOutputEntries),
    outputBytes: Math.min(32 * 1024 * 1024, profile.limits.maximumOutputBytes),
    outputEntryBytes: Math.min(16 * 1024 * 1024, profile.limits.maximumOutputEntryBytes),
    events: Math.min(128, profile.limits.maximumEvents),
  });
  return Object.freeze({
    backendProfile: Object.freeze({
      profileId: profile.profileId,
      profileDigest: profile.digest,
      implementationDigest: profile.implementation.implementationDigest,
    }),
    image: Object.freeze({ imageId: input.image.imageId, imageDigest: input.image.imageDigest }),
    limits,
  });
}

function compileSpecification(
  input: FoundationCheckCellOperationInputV1,
  inputSet: FoundationExecutionInputSetV1,
): FoundationExecutionSpecificationV1 {
  const profile = input.runtime.profile;
  const installedDockerProfile =
    profile.profileId === "lifecycle.execution-backend-profile.docker-local.v1" &&
    profile.backendKind === "docker-local" && profile.usage === "production";
  const deterministicTestProfile =
    profile.profileId === "lifecycle.execution-backend-profile.fault-injection.v1" &&
    profile.backendKind === "fault-injection" && profile.usage === "test-only";
  if (
    input.runtime.backend.profile.digest !== profile.digest ||
    !(installedDockerProfile || deterministicTestProfile)
  ) fail("backend", "Check requires the selected Docker or deterministic test Backend Profile");
  const resources = compileFoundationCheckCellResourceSelectionV1({ binding: input.binding, profile, image: input.runtime.image });
  const limits = resources.limits;
  const outputContractSubject = Object.freeze({
    manifestProfile: "lifecycle.execution-output-manifest.v1" as const,
    declaredOutputRoots: Object.freeze([
      Object.freeze({
        path: "check-proof",
        purpose: "check-proof" as const,
        required: true,
        allowedModeClasses: Object.freeze(["regular"] as const),
        maximumEntries: 1,
        maximumBytes: Math.min(MAXIMUM_PROOF_BYTES, limits.outputBytes),
      }),
      Object.freeze({
        path: "raw-check-output",
        purpose: "raw-check-output" as const,
        required: true,
        allowedModeClasses: Object.freeze(["regular"] as const),
        maximumEntries: 1,
        maximumBytes: Math.min(MAXIMUM_RAW_BYTES, limits.outputBytes),
      }),
    ]),
    allowedModeClasses: Object.freeze(["regular", "executable"] as const),
    extraEntriesAllowed: false as const,
  });
  const subject = Object.freeze({
    schema: "lifecycle.execution-specification.v1" as const,
    owner: Object.freeze({
      kind: "check" as const,
      activityId: input.activityId,
      selectionId: input.selectionId,
      phase: input.phase,
      ownerSubjectDigest: input.proofSubject.digest,
    }),
    backendProfile: resources.backendProfile,
    image: resources.image,
    inputSet: Object.freeze({
      profileId: "lifecycle.execution-input-set.v2" as const,
      digest: inputSet.digest,
    }),
    operation: Object.freeze({
      kind: "check" as const,
      phase: input.phase,
      selectionId: input.selectionId,
      definitionDigest: input.definition.semanticDigest,
      bindingDigest: input.binding.digest,
      runnerImplementationDigest: input.runtime.image.runnerImplementationDigest,
      parserImplementationDigest: FOUNDATION_CHECK_CELL_RUNNER_V1.parserDigest,
    }),
    runner: Object.freeze({
      contractId: "lifecycle.execution-cell-runner.v1" as const,
      contractDigest: input.runtime.image.runnerContractDigest,
      operationId: "check.execute",
      argumentsDigest: digestCanonical(Object.freeze({
        phase: input.phase,
        selectionId: input.selectionId,
        bindingId: input.bindingId,
        executable: input.binding.executable,
        args: input.binding.args,
        cwd: input.binding.cwd,
      })),
    }),
    environment: Object.freeze(Object.entries(input.binding.environment)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([name, value]) => Object.freeze({
        name,
        source: "input-set" as const,
        bindingDigest: digestCanonical(Object.freeze({ name, value })),
      }))),
    capabilities: Object.freeze({
      capabilityProfileDigest: digestCanonical(Object.freeze({
        schema: "lifecycle.check-cell-capability-profile.v1",
        bindingDigest: input.binding.digest,
        mutation: input.binding.mutation,
      })),
      candidateWrites: false as const,
      temporaryWrites: true as const,
      subprocesses: "repository-toolchain" as const,
      externalEffects: false as const,
      dockerDaemonAccess: false as const,
    }),
    networkPolicy: Object.freeze({
      agentProductNetwork: input.binding.network,
      agentPolicyDigest: digestCanonical(Object.freeze({
        schema: "lifecycle.check-cell-network-policy.v1",
        network: input.binding.network,
      })),
      providerControlPlane: "none" as const,
      providerPolicyDigest: null,
      separationRequired: true as const,
    }),
    credentialPolicy: Object.freeze({
      mode: "none" as const,
      bindings: Object.freeze([]),
      agentAccess: false as const,
      outputDisclosure: false as const,
    }),
    limits,
    outputContract: Object.freeze({
      ...outputContractSubject,
      digest: selfDigest(outputContractSubject),
    }),
    terminalPolicy: Object.freeze({
      directObservationRequired: true as const,
      containmentRequired: true as const,
      retrievalAfterContainment: true as const,
      retirementRequired: true as const,
      reclamation: "asynchronous-private" as const,
    }),
  });
  return parseFoundationExecutionSpecification({
    value: Object.freeze({ ...subject, digest: selfDigest(subject) }),
    backendProfile: profile,
    image: subject.image,
    inputSet: subject.inputSet,
  });
}

async function artifactBytes(
  artifact: FoundationValidatedExecutionOutputArtifactV1,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (artifact.byteLength > maximumBytes) fail("output", `Output ${artifact.path} exceeds its owner bound`);
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of artifact.read()) {
    length += chunk.byteLength;
    if (length > artifact.byteLength || length > maximumBytes) fail("output", `Output ${artifact.path} changed while reopened`);
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Uint8Array.from(Buffer.concat(chunks));
  if (bytes.byteLength !== artifact.byteLength || sha256Bytes(bytes) !== artifact.digest) {
    fail("output", `Output ${artifact.path} failed its retained byte binding`);
  }
  return bytes;
}

function proofObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("proof", "Check proof is not an object");
  return value as Record<string, unknown>;
}

type ParsedCheckCellOutput = Readonly<{
  proof: Readonly<{
    digest: Sha256;
    startedAt: string;
    finishedAt: string;
    exitCode: number | null;
    signal: string | null;
    timedOut: boolean;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
    parserDisposition: "passed" | "failed";
    subjectIntegrity: "unchanged" | "changed";
    resultFacts: readonly CheckReceiptResultFact[];
  }>;
  rawBytes: Uint8Array;
}>;

function exactCanonicalTime(value: unknown, label: string): string {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) ||
      new Date(value).toISOString() !== value) {
    fail("proof", `${label} is not one canonical UTC time`);
  }
  return value;
}

function exactCanonicalJsonBytes(bytes: Uint8Array, value: unknown, label: string): void {
  if (!Buffer.from(bytes).equals(Buffer.from(`${canonicalJson(value)}\n`, "utf8"))) {
    fail("proof", `${label} is not canonical JSON`);
  }
}

async function parseCheckCellOutput(
  output: FoundationValidatedExecutionOutputV1,
): Promise<ParsedCheckCellOutput> {
  const proofArtifacts = output.artifacts.filter(({ purpose }) => purpose === "check-proof");
  const rawArtifacts = output.artifacts.filter(({ purpose }) => purpose === "raw-check-output");
  if (output.artifacts.length !== 2 || proofArtifacts.length !== 1 ||
      proofArtifacts[0]!.path !== CHECK_PROOF_PATH || rawArtifacts.length !== 1 ||
      rawArtifacts[0]!.path !== CHECK_RAW_PATH) {
    fail("proof", "Check output does not contain the exact fixed proof and raw stream artifacts");
  }
  const proofBytes = await artifactBytes(proofArtifacts[0]!, MAXIMUM_PROOF_BYTES);
  let proof: Record<string, unknown>;
  try { proof = proofObject(JSON.parse(Buffer.from(proofBytes).toString("utf8"))); }
  catch { fail("proof", "Check proof is not exact JSON"); }
  exactCanonicalJsonBytes(proofBytes, proof, "Check proof");
  if (canonicalJson(Object.keys(proof).sort()) !== canonicalJson([
    "digest",
    "exitCode",
    "finishedAt",
    "parserDisposition",
    "parserId",
    "resultFacts",
    "schema",
    "signal",
    "startedAt",
    "stderrTruncated",
    "stdoutTruncated",
    "subjectAfterDigest",
    "subjectBeforeDigest",
    "subjectIntegrity",
    "timedOut",
  ].sort())) fail("proof", "Check proof does not have its exact closed shape");
  const startedAt = exactCanonicalTime(proof.startedAt, "Check proof start");
  const finishedAt = exactCanonicalTime(proof.finishedAt, "Check proof finish");
  const exitCode = proof.exitCode;
  const signal = proof.signal;
  if (proof.schema !== CHECK_PROOF_SCHEMA || proof.digest !== selfDigest(proof as never) ||
      finishedAt < startedAt ||
      !(exitCode === null || (Number.isSafeInteger(exitCode) && Number(exitCode) >= 0 && Number(exitCode) <= 255)) ||
      !(signal === null || (typeof signal === "string" && /^SIG[A-Z0-9]+$/u.test(signal))) ||
      typeof proof.timedOut !== "boolean" || typeof proof.stdoutTruncated !== "boolean" ||
      typeof proof.stderrTruncated !== "boolean" || proof.parserId !== "exit-code-v1" ||
      !(proof.parserDisposition === "passed" || proof.parserDisposition === "failed") ||
      !(proof.subjectIntegrity === "unchanged" || proof.subjectIntegrity === "changed") ||
      !SHA256.test(String(proof.subjectBeforeDigest)) || !SHA256.test(String(proof.subjectAfterDigest)) ||
      !Array.isArray(proof.resultFacts) || proof.resultFacts.length !== 1) {
    fail("proof", "Check proof failed its exact fixed schema");
  }
  const resultFact = proofObject(proof.resultFacts[0]);
  if (canonicalJson(Object.keys(resultFact).sort()) !== canonicalJson(["name", "value"]) ||
      resultFact.name !== "exit-code" || resultFact.value !== exitCode) {
    fail("proof", "Check proof did not derive the exact exit-code fact");
  }
  const successfulParsing = signal === null && proof.timedOut === false &&
    proof.stdoutTruncated === false && proof.stderrTruncated === false && exitCode !== null;
  if ((proof.parserDisposition === "passed") !== successfulParsing ||
      (proof.subjectIntegrity === "unchanged") !==
        (proof.subjectBeforeDigest === proof.subjectAfterDigest)) {
    fail("proof", "Check proof derived facts are internally inconsistent");
  }
  const rawBytes = await artifactBytes(rawArtifacts[0]!, MAXIMUM_RAW_BYTES);
  let raw: Record<string, unknown>;
  try { raw = proofObject(JSON.parse(Buffer.from(rawBytes).toString("utf8"))); }
  catch { fail("proof", "Raw Check output is not exact JSON"); }
  exactCanonicalJsonBytes(rawBytes, raw, "Raw Check output");
  if (canonicalJson(Object.keys(raw).sort()) !==
      canonicalJson(["schema", "stderrBase64", "stdoutBase64"]) ||
      raw.schema !== "lifecycle.check-cell-raw-streams.v1" ||
      typeof raw.stdoutBase64 !== "string" || typeof raw.stderrBase64 !== "string" ||
      Buffer.from(raw.stdoutBase64, "base64").toString("base64") !== raw.stdoutBase64 ||
      Buffer.from(raw.stderrBase64, "base64").toString("base64") !== raw.stderrBase64) {
    fail("proof", "Raw Check output failed its exact fixed schema");
  }
  return Object.freeze({
    proof: Object.freeze({
      digest: proof.digest as Sha256,
      startedAt,
      finishedAt,
      exitCode: exitCode as number | null,
      signal: signal as string | null,
      timedOut: proof.timedOut,
      stdoutTruncated: proof.stdoutTruncated,
      stderrTruncated: proof.stderrTruncated,
      parserDisposition: proof.parserDisposition,
      subjectIntegrity: proof.subjectIntegrity,
      resultFacts: Object.freeze([Object.freeze({ name: "exit-code", value: exitCode as number | null })]),
    }),
    rawBytes,
  });
}

async function observationFromValidOutput(input: Readonly<{
  operation: FoundationCheckCellOperationInputV1;
  specification: FoundationExecutionSpecificationV1;
  inputSet: FoundationExecutionInputSetV1;
  output: FoundationValidatedExecutionOutputV1;
  containmentDigest: Sha256;
  retirementDigest: Sha256;
  observationDigest: Sha256;
}>): Promise<CheckReceiptObservation> {
  const parsed = await parseCheckCellOutput(input.output);
  const proof = parsed.proof;
  const rawBytes = parsed.rawBytes;
  const rawMaterials: readonly CheckReceiptRawMaterial[] = Object.freeze([Object.freeze({
    availability: "retained" as const,
    file: Object.freeze({
      bytes: rawBytes,
      mediaType: "application/json",
      purpose: "raw-check-output",
      createdAt: proof.finishedAt,
    }),
  })]);
  const parserPassed = proof.parserDisposition === "passed";
  const lifecycleFailure = !parserPassed || proof.subjectIntegrity === "changed" ||
    proof.timedOut || proof.signal !== null || proof.stdoutTruncated || proof.stderrTruncated;
  const disposition = lifecycleFailure
    ? "operational-error" as const
    : proof.exitCode === 0 ? "pass" as const : "fail" as const;
  const failureFacts = lifecycleFailure
    ? digestCanonical(Object.freeze({
        schema: "lifecycle.check-cell-operational-failure.v1",
        proofDigest: proof.digest,
        observationDigest: input.observationDigest,
      }))
    : null;
  const carrierDigest = digestCanonical(Object.freeze({
    schema: "lifecycle.execution-output-carrier-binding.v1",
    manifestDigest: input.output.manifest.digest,
    carrierByteLength: input.output.carrierByteLength,
    entries: input.output.artifacts.map(({ read: _read, ...artifact }) => artifact),
  }));
  return Object.freeze({
    startedAt: proof.startedAt,
    finishedAt: proof.finishedAt,
    environment: Object.freeze({
      identityDigest: digestCanonical(Object.freeze({
        schema: "lifecycle.check-cell-environment.v1",
        profileDigest: input.specification.backendProfile.profileDigest,
        imageDigest: input.specification.image.imageDigest,
        inputSetDigest: input.inputSet.digest,
        networkPolicyDigest: input.specification.networkPolicy.agentPolicyDigest,
        environment: input.specification.environment,
      })),
      runtimeEnforced: Object.freeze([
        "proof-subject-read-only-input",
        "descendant-containment",
        "protected-environment",
      ]),
      directorManaged: Object.freeze([]),
    }),
    disposition,
    resultFacts: proof.resultFacts,
    reasonCode: lifecycleFailure ? "check-cell-operational-error" : null,
    notRunAuthorization: null,
    operationalFailure: failureFacts === null ? null : Object.freeze({
      stage: "execution",
      code: "check-cell-lifecycle-failure",
      factsDigest: failureFacts,
    }),
    execution: Object.freeze({
      allocation: "allocated" as const,
      backendProfile: input.specification.backendProfile,
      image: input.specification.image,
      inputSet: input.specification.inputSet,
      specificationDigest: input.specification.digest,
      runnerDigest: input.specification.runner.contractDigest,
      observationDigest: input.observationDigest,
      output: Object.freeze({
        availability: "retrieved" as const,
        carrierByteLength: input.output.carrierByteLength,
        carrierDigest,
        manifestDigest: input.output.manifest.digest,
      }),
      exitCode: proof.exitCode,
      signal: proof.signal,
      timedOut: proof.timedOut,
      parserDisposition: parserPassed ? "passed" as const : "failed" as const,
    }),
    rawMaterials,
    subjectIntegrity: proof.subjectIntegrity,
    containment: Object.freeze({ classification: "contained" as const, factsDigest: input.containmentDigest }),
    retirement: Object.freeze({ classification: "retired" as const, factsDigest: input.retirementDigest }),
    runner: Object.freeze({
      id: FOUNDATION_CHECK_CELL_RUNNER_V1.id,
      digest: input.specification.runner.contractDigest,
    }),
    parser: Object.freeze({
      id: FOUNDATION_CHECK_CELL_RUNNER_V1.parserId,
      digest: FOUNDATION_CHECK_CELL_RUNNER_V1.parserDigest,
    }),
    limitations: Object.freeze([]),
  });
}

function unavailableObservation(input: Readonly<{
  operation: FoundationCheckCellOperationInputV1;
  specification: FoundationExecutionSpecificationV1;
  inputSet: FoundationExecutionInputSetV1;
  validation: "invalid" | "unavailable" | "not-applicable";
  containmentDigest: Sha256;
  retirementDigest: Sha256;
  observationDigest: Sha256;
  manifestDigest: Sha256 | null;
}>): CheckReceiptObservation {
  const factsDigest = digestCanonical(Object.freeze({
    schema: "lifecycle.check-cell-output-failure.v1",
    specificationDigest: input.specification.digest,
    validation: input.validation,
    observationDigest: input.observationDigest,
  }));
  return Object.freeze({
    startedAt: null,
    finishedAt: null,
    environment: Object.freeze({
      identityDigest: digestCanonical(Object.freeze({
        schema: "lifecycle.check-cell-environment.v1",
        profileDigest: input.specification.backendProfile.profileDigest,
        imageDigest: input.specification.image.imageDigest,
        inputSetDigest: input.inputSet.digest,
      })),
      runtimeEnforced: Object.freeze([
        "proof-subject-read-only-input",
        "descendant-containment",
        "protected-environment",
      ]),
      directorManaged: Object.freeze([]),
    }),
    disposition: "operational-error",
    resultFacts: Object.freeze([
      Object.freeze({ name: "execution-output-validation", value: input.validation }),
    ]),
    reasonCode: "check-cell-output-unavailable",
    notRunAuthorization: null,
    operationalFailure: Object.freeze({
      stage: "output",
      code: `check-cell-output-${input.validation}`,
      factsDigest,
    }),
    execution: Object.freeze({
      allocation: "allocated" as const,
      backendProfile: input.specification.backendProfile,
      image: input.specification.image,
      inputSet: input.specification.inputSet,
      specificationDigest: input.specification.digest,
      runnerDigest: input.specification.runner.contractDigest,
      observationDigest: input.observationDigest,
      output: Object.freeze({
        availability: input.validation === "not-applicable" ? "not-produced" as const : "unavailable" as const,
        carrierByteLength: null,
        carrierDigest: null,
        manifestDigest: null,
      }),
      exitCode: null,
      signal: null,
      timedOut: false,
      parserDisposition: "not-run" as const,
    }),
    rawMaterials: Object.freeze([]),
    subjectIntegrity: "unverified",
    containment: Object.freeze({ classification: "contained" as const, factsDigest: input.containmentDigest }),
    retirement: Object.freeze({ classification: "retired" as const, factsDigest: input.retirementDigest }),
    runner: Object.freeze({ id: FOUNDATION_CHECK_CELL_RUNNER_V1.id, digest: input.specification.runner.contractDigest }),
    parser: Object.freeze({ id: FOUNDATION_CHECK_CELL_RUNNER_V1.parserId, digest: FOUNDATION_CHECK_CELL_RUNNER_V1.parserDigest }),
    limitations: Object.freeze(["The contained Cell did not return one valid Check proof Output Carrier."]),
  });
}

export function unsupportedCheckCellObservation(
  requestedConditions: readonly string[],
  runnerContractDigest: Sha256,
): CheckReceiptObservation {
  const factsDigest = digestCanonical(Object.freeze({
    schema: "lifecycle.check-cell-unsupported-environment.v1",
    requestedConditions,
  }));
  return Object.freeze({
    startedAt: null,
    finishedAt: null,
    environment: Object.freeze({
      identityDigest: factsDigest,
      runtimeEnforced: Object.freeze([]),
      directorManaged: Object.freeze([...requestedConditions]),
    }),
    disposition: "unsupported",
    resultFacts: Object.freeze([Object.freeze({ name: "environment-requirements-supported", value: false })]),
    reasonCode: "check-environment-unsupported",
    notRunAuthorization: null,
    operationalFailure: null,
    execution: Object.freeze({ allocation: "not-allocated" as const }),
    rawMaterials: Object.freeze([]),
    subjectIntegrity: "unverified",
    containment: Object.freeze({ classification: "not-required" as const, factsDigest: null }),
    retirement: Object.freeze({ classification: "not-required" as const, factsDigest: null }),
    runner: Object.freeze({ id: FOUNDATION_CHECK_CELL_RUNNER_V1.id, digest: runnerContractDigest }),
    parser: Object.freeze({ id: FOUNDATION_CHECK_CELL_RUNNER_V1.parserId, digest: FOUNDATION_CHECK_CELL_RUNNER_V1.parserDigest }),
    limitations: Object.freeze([FOUNDATION_DOCKER_CHECK_ENVIRONMENT_LIMITATION]),
  });
}

/** Operate one exact baseline or final Check through the generic host and durable ledger. */
export async function operateFoundationCheckCellV1(
  input: FoundationCheckCellOperationInputV1,
): Promise<FoundationCheckCellOperationResultV1> {
  if (input.requestedConditions.length > 0) {
    return Object.freeze({
      observation: unsupportedCheckCellObservation(
        input.requestedConditions,
        input.runtime.image.runnerContractDigest,
      ),
      specification: null,
      inputSet: null,
    });
  }
  const compiled = await compileInput(input);
  const specification = compileSpecification(input, compiled.inputSet);
  const execution = readWorkDelegationExecution({ store: input.store, activityId: input.activityId });
  const reservedSlot = workDelegationCheckSlot(execution, input.selectionId, input.phase);
  const assertReservedSelection = () => {
    if (reservedSlot !== null && !workDelegationCheckSelectionMatches(reservedSlot, { request: input, resources: specification })) {
      fail("work-delegation-binding", "Check execution differs from its exact retained Activity resource reservation");
    }
  };
  // Recheck historical resources on every invocation, including recovery, before
  // selecting or changing checkpoint custody. Current allowance is not charged again.
  assertReservedSelection();
  const checkpoints = input.persistence(specification, compiled.inputSet);
  const releaseBinding = input.runtime.bindingRegistry.register({
    specification,
    engineIdentityDigest: input.runtime.engineIdentityDigest,
    persistence: checkpoints,
  });
  try {
    const host = new FoundationExecutionOperationHostV1({
      backend: input.runtime.backend,
      checkpoints,
      clock: input.runtime.clock,
      outputStore: input.runtime.outputStore,
      validateOwnerOutput: async ({ specification: selected, output }) => {
        if (selected.digest !== specification.digest) {
          fail("proof", "Check output validator received another Execution Specification");
        }
        try {
          await parseCheckCellOutput(output);
          return Object.freeze({ disposition: "valid" as const });
        } catch (error) {
          if (error instanceof FoundationError &&
              error.code === "lifecycle.check-cell-v1.proof") {
            return Object.freeze({ disposition: "invalid" as const });
          }
          throw error;
        }
      },
    });
    let validatedOutput: FoundationValidatedExecutionOutputV1 | null = null;
    const pollMilliseconds = input.runtime.pollMilliseconds ?? 100;
    if (!Number.isSafeInteger(pollMilliseconds) || pollMilliseconds < 0 || pollMilliseconds > 60_000) {
      fail("poll-bound", "Check Cell polling interval is outside its fixed bound");
    }
    const effectivePollMilliseconds = Math.max(1, pollMilliseconds);
    const activeStepBound = Math.min(
      MAXIMUM_CELL_STEPS - 1_024,
      Math.ceil(specification.limits.wallTimeMilliseconds / effectivePollMilliseconds) + 16,
    );
    const totalStepBound = activeStepBound + 1_024;
    let openedAtMilliseconds: number | null = null;
    for (let step = 0; step < totalStepBound; step += 1) {
      const before = await host.read(specification);
      if (before !== null && openedAtMilliseconds === null) {
        openedAtMilliseconds = Date.parse(before.checkpoint.openedAt);
        if (!Number.isFinite(openedAtMilliseconds)) {
          fail("clock", "Retained Check Cell opening time is invalid");
        }
      }
      if (before !== null && before.checkpoint.handle === null) {
        // This check is intentionally adjacent to the only host step that may
        // allocate. It grants no reservation and retains no policy state.
        assertReservedSelection();
        input.runtime.reclamation.assertAllocationAvailable();
      }
      let deadlineReached = step >= activeStepBound;
      if (!deadlineReached && openedAtMilliseconds !== null) {
        const sampled = input.runtime.clock.now();
        const sampledMilliseconds = Date.parse(sampled);
        if (!Number.isFinite(sampledMilliseconds) || new Date(sampledMilliseconds).toISOString() !== sampled) {
          fail("clock", "Check Cell recovery clock is invalid");
        }
        deadlineReached = sampledMilliseconds - openedAtMilliseconds >=
          specification.limits.wallTimeMilliseconds;
      }
      const advanced = await host.advance({
        specification,
        runnerDigest: input.runtime.image.runnerContractDigest,
        requestContainment: deadlineReached,
      });
      const checkpoint = advanced.retained.checkpoint;
      if (advanced.validatedOutput !== null) validatedOutput = advanced.validatedOutput;
      if (checkpoint.output !== null) break;
      if (pollMilliseconds !== 0) {
        await delay(pollMilliseconds);
      }
    }
    let current = await host.read(specification);
    if (current === null || current.checkpoint.output === null || current.checkpoint.containment === null ||
        current.checkpoint.observation === null || current.checkpoint.handle === null) {
      fail("recovery-bound", "Check Cell did not reach final contained output within its bounded recovery loop");
    }
    if (current.checkpoint.output.validation === "valid" && validatedOutput === null) {
      validatedOutput = (await host.advance({
        specification,
        runnerDigest: input.runtime.image.runnerContractDigest,
      })).validatedOutput;
    }
    current = await host.retire(specification);
    const checkpoint = current.checkpoint;
    if (checkpoint.retirement === null || checkpoint.handle === null || checkpoint.containment === null ||
        checkpoint.output === null || checkpoint.observation === null) {
      fail("retirement", "Check Cell did not retain exact Retirement facts");
    }
    input.runtime.reclamation.accept({
      owner: Object.freeze({
        storeId: input.store.identity.storeId,
        processId: input.store.identity.processId,
        activityId: input.activityId,
        kind: "check",
        subjectDigest: input.proofSubject.digest,
      }),
      specification,
      handle: checkpoint.handle,
      reclamationBinding: checkpoint.retirement.reclamationBinding,
      obligation: checkpoint.retirement.reclamationObligation,
      retirementDigest: checkpoint.retirement.digest,
      dispatchAuthorityConsumed: checkpoint.retirement.dispatchAuthorityConsumed,
    });
    if (validatedOutput === null && checkpoint.output.validation === "valid") {
      fail("output", "Validated Check output could not be reopened after Retirement");
    }
    const observation = validatedOutput === null
      ? unavailableObservation({
          operation: input,
          specification,
          inputSet: compiled.inputSet,
          validation: checkpoint.output.validation as "invalid" | "unavailable" | "not-applicable",
          containmentDigest: checkpoint.containment.digest,
          retirementDigest: checkpoint.retirement.digest,
          observationDigest: checkpoint.observation.digest,
          manifestDigest: checkpoint.output.manifestDigest,
        })
      : await observationFromValidOutput({
          operation: input,
          specification,
          inputSet: compiled.inputSet,
          output: validatedOutput,
          containmentDigest: checkpoint.containment.digest,
          retirementDigest: checkpoint.retirement.digest,
          observationDigest: checkpoint.observation.digest,
        });
    return Object.freeze({ observation, specification, inputSet: compiled.inputSet });
  } finally {
    // The Activity may reuse its child slot for another Check after this
    // invocation returns. Recovery registers its retained exact checkpoint anew;
    // completed Reclamation handoffs retain their independent immutable facts.
    releaseBinding();
  }
}
