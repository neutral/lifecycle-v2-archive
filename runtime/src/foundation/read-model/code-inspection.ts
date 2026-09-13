import {
  FOUNDATION_CODE_CHANGED_PATH_LIMIT,
  FOUNDATION_CODE_EXACT_DIFF_MAXIMUM_BYTES,
  FOUNDATION_SOURCE_MAXIMUM_BYTES,
  digestFoundationInspectionCursor,
  FoundationCodeBasisSchema,
  FoundationCodeFileResultSchema,
  FoundationCodeIndexResultSchema,
  type FoundationCodeBasis,
  type FoundationCodeFileResult,
  type FoundationCodeFileRow,
  type FoundationCodeIndexResult,
  type FoundationContextInspectionSelector,
  type FoundationDeliveryState,
  type FoundationSourceReference,
  type FoundationCodeSelection,
  foundationContextSelectionOf,
} from "@neutral/lifecycle-protocol";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
} from "../candidate/carrier-types.js";
import {
  candidateRevisionCarrierVerificationParent,
  openCandidateRevisionCarrier,
} from "../candidate/carrier-store.js";
import {
  withVerifiedCandidateRevisionCarrierRepository,
  type FoundationCandidateRevisionCarrierClosureV1,
} from "../candidate/git-object-closure.js";
import type { CandidateChangedSubject, CandidateRevisionState } from "../control/candidate-revision.js";
import { resolveCandidateIntegrationProvenanceV1 } from "../control/integration-assessment.js";
import type { ControlRecordStore } from "../control/store.js";
import type { ControlJsonObject, ControlJsonValue, ControlRecordRevision } from "../control/types.js";
import { FoundationError } from "../error.js";
import {
  canonicalRepository,
  exactBlobSizes,
  exactTreeEntries,
  exactFileDifferenceBytes,
  objectBlobBytes,
  resolveGitObjectFormat,
} from "../repository/git.js";
import { openFoundationDeliveryGitSnapshotV1 } from "../repository/delivery-git-basis.js";
import type { FoundationGitTreeEntry, FoundationLoadedRepositorySnapshot } from "../repository/types.js";
import {
  digestCanonical,
  selfDigest,
  sha256Bytes,
  type Sha256,
} from "../validation/canonical.js";
import { compareCodePoints } from "../validation/ordering.js";
import { compileFoundationContextBasis } from "./context-basis.js";
import type { FoundationDeliveryQueryBasis } from "./delivery-query-basis.js";
import {
  compileFoundationSourceReference,
  sameFoundationSourceReference,
} from "./source-inspection.js";

type CodeIndexSelector = Extract<FoundationContextInspectionSelector, { kind: "code-index" }>;
type CodeFileSelector = Extract<FoundationContextInspectionSelector, { kind: "code-file" }>;
type CodeSubject = "candidate" | "decision";
type CandidateReference = Readonly<{
  kind: "candidate-revision";
  id: string;
  revision: number;
  digest: Sha256;
}>;
type SealReference = Readonly<{
  kind: "candidate-seal";
  id: string;
  revision: number;
  digest: Sha256;
}>;
type CodeAvailableResult = Extract<FoundationCodeFileResult, { status: "available" }>;
type CodeSourceDisposition = CodeAvailableResult["beforeSource"];
type CodeDifference = CodeAvailableResult["difference"];

type ExactCandidate = Readonly<{
  revision: ControlRecordRevision;
  reference: CandidateReference;
  seal: SealReference | null;
  baseCommit: string;
  state: CandidateRevisionState;
}>;

type CandidateCarrierManifestReference = Readonly<{
  digest: Sha256;
  byteLength: number;
  mediaType: typeof FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE;
  purpose: typeof FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE;
}>;

type FileObject = NonNullable<FoundationCodeFileRow["before"]>;
type FileFact = Readonly<{
  path: string;
  change: FoundationCodeFileRow["change"];
  before: FileObject | null;
  after: FileObject | null;
}>;

const UTF8 = new TextDecoder("utf-8", { fatal: true });

function fail(code: string, message: string, observedFacts: unknown = {}): never {
  throw new FoundationError(`lifecycle.context-inspection.code-${code}`, message, {
    observedFacts,
  });
}

function object(value: ControlJsonValue | undefined, label: string): ControlJsonObject {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    fail("subject-invalid", `${label} must be one exact object`);
  }
  return value as ControlJsonObject;
}

function string(value: ControlJsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail("subject-invalid", `${label} must be one exact nonempty string`);
  }
  return value;
}

function digest(value: ControlJsonValue | undefined, label: string): Sha256 {
  const selected = string(value, label);
  if (!/^sha256:[a-f0-9]{64}$/u.test(selected)) {
    fail("subject-invalid", `${label} must be one exact lowercase SHA-256 digest`);
  }
  return selected as Sha256;
}

function integer(value: ControlJsonValue | undefined, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail("subject-invalid", `${label} must be one nonnegative safe integer`);
  }
  return value;
}

function boolean(value: ControlJsonValue | undefined, label: string): boolean {
  if (typeof value !== "boolean") {
    fail("subject-invalid", `${label} must be one exact boolean`);
  }
  return value;
}

function exactRevision(
  store: ControlRecordStore,
  selected: FoundationDeliveryState["subjects"][keyof FoundationDeliveryState["subjects"]],
  kind: string,
): ControlRecordRevision | null {
  if (selected === null) return null;
  const revision = store.getRevision(selected.id, selected.revision);
  return revision !== null &&
      revision.processId === store.identity.processId &&
      revision.recordKind === kind &&
      revision.recordId === selected.id &&
      revision.revision === selected.revision &&
      revision.digest === selected.digest
    ? revision
    : null;
}

function candidateState(candidate: ControlRecordRevision): Readonly<{
  baseCommit: string;
  state: CandidateRevisionState;
}> {
  const state = object(candidate.payload.state, "Candidate Revision state");
  const subjects = state.changedSubjects;
  if (!Array.isArray(subjects) || subjects.length > FOUNDATION_CODE_CHANGED_PATH_LIMIT) {
    fail("subject-invalid", "Candidate Revision changed subjects exceed the closed Code inventory bound");
  }
  const changedSubjects = subjects.map((value, index): CandidateChangedSubject => {
    const subject = object(value, `Candidate changed subject ${index}`);
    const path = string(subject.path, `Candidate changed subject ${index} path`);
    const change = string(subject.change, `Candidate changed subject ${index} change`);
    if (![
      "added", "modified", "deleted", "mode-changed", "type-changed",
    ].includes(change)) {
      fail("subject-invalid", "Candidate Revision contains an unsupported changed-path disposition", {
        path,
        change,
      });
    }
    const beforeDigest = subject.beforeDigest === null
      ? null
      : digest(subject.beforeDigest, `Candidate changed subject ${index} before digest`);
    const afterDigest = subject.afterDigest === null
      ? null
      : digest(subject.afterDigest, `Candidate changed subject ${index} after digest`);
    return Object.freeze({
      path,
      change: change as CandidateChangedSubject["change"],
      beforeDigest,
      afterDigest,
    });
  });
  return Object.freeze({
    baseCommit: string(candidate.payload.candidateBaseCommit, "Candidate base commit"),
    state: Object.freeze({
      tree: string(state.tree, "Candidate tree"),
      candidateDigest: digest(state.candidateDigest, "Candidate digest"),
      productStateDigest: digest(state.productStateDigest, "Candidate Product State digest"),
      knowledgeSetDigest: digest(state.knowledgeSetDigest, "Candidate Knowledge Set digest"),
      diffDigest: digest(state.diffDigest, "Candidate difference digest"),
      pathInventoryDigest: digest(state.pathInventoryDigest, "Candidate path inventory digest"),
      artifactSetDigest: digest(state.artifactSetDigest, "Candidate artifact-set digest"),
      descriptionCoverageDigest: digest(
        state.descriptionCoverageDigest,
        "Candidate Description coverage digest",
      ),
      unchangedFromPredecessor: boolean(
        state.unchangedFromPredecessor,
        "Candidate unchanged-from-predecessor fact",
      ),
      changedSubjects: Object.freeze(changedSubjects),
    }),
  });
}

function exactCodeSubject(input: Readonly<{
  store: ControlRecordStore;
  selection: FoundationCodeSelection;
  subject: CodeSubject;
}>): ExactCandidate | null {
  const selectedReference = input.selection.candidate;
  if (selectedReference === null) return null;
  const candidate = exactRevision(input.store, selectedReference, "candidate-revision");
  if (candidate === null) {
    fail("candidate-substituted", "Selected Candidate Revision is absent, corrupt, or substituted", {
      selectedReference,
    });
  }
  const reference: CandidateReference = Object.freeze({
    kind: "candidate-revision",
    id: selectedReference.id,
    revision: selectedReference.revision,
    digest: selectedReference.digest,
  });
  const parsed = candidateState(candidate);
  if (input.subject === "candidate") {
    return Object.freeze({ revision: candidate, reference, seal: null, ...parsed });
  }
  const selectedSeal = input.selection.seal;
  if (selectedSeal === null) {
    return Object.freeze({ revision: candidate, reference, seal: null, ...parsed });
  }
  const seal = exactRevision(input.store, selectedSeal, "candidate-seal");
  if (seal === null) {
    fail("seal-substituted", "Selected Candidate Seal is absent, corrupt, or substituted", {
      selectedSeal,
    });
  }
  const sealReference: SealReference = Object.freeze({
    kind: "candidate-seal",
    id: selectedSeal.id,
    revision: selectedSeal.revision,
    digest: selectedSeal.digest,
  });
  const sealRelationships = seal.relationships.filter(({ relation }) => relation === "seals");
  const sealedCandidate = sealRelationships[0]?.target ?? null;
  if (
    sealRelationships.length !== 1 || sealedCandidate === null ||
    sealedCandidate.kind !== "candidate-revision" ||
    sealedCandidate.id !== reference.id ||
    sealedCandidate.revision !== reference.revision ||
    sealedCandidate.digest !== reference.digest
  ) {
    fail("seal-substituted", "Selected Candidate Seal does not bind the exact selected Candidate", {
      candidate: reference,
      seal: sealReference,
    });
  }
  return Object.freeze({ revision: candidate, reference, seal: sealReference, ...parsed });
}

function unavailable(
  kind: "code-index" | "code-file",
  selection: FoundationCodeSelection,
  reason: "candidate-absent" | "decision-subject-unavailable" | "candidate-carrier-unavailable",
): FoundationCodeIndexResult | FoundationCodeFileResult {
  const value = Object.freeze({
    schema: kind === "code-index" ? "lifecycle.code-index.v1" : "lifecycle.code-file.v1",
    kind,
    status: "unavailable",
    selection,
    subject: selection.subject,
    candidate: selection.candidate,
    seal: selection.seal,
    reason,
  });
  return kind === "code-index"
    ? FoundationCodeIndexResultSchema.parse(value)
    : FoundationCodeFileResultSchema.parse(value);
}

function carrierManifestReference(candidate: ControlRecordRevision): CandidateCarrierManifestReference {
  const selected = object(candidate.payload.carrierManifest, "Candidate Carrier manifest reference");
  const reference = Object.freeze({
    digest: digest(selected.digest, "Candidate Carrier manifest digest"),
    byteLength: integer(selected.byteLength, "Candidate Carrier manifest byte length"),
    mediaType: selected.mediaType,
    purpose: selected.purpose,
  });
  if (
    reference.byteLength < 1 ||
    reference.mediaType !== FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE ||
    reference.purpose !== FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE
  ) fail("subject-invalid", "Candidate Revision has no exact Carrier manifest reference");
  return reference as CandidateCarrierManifestReference;
}

function governedBy(candidate: ControlRecordRevision, query: FoundationDeliveryQueryBasis): void {
  const boundaries = candidate.relationships.filter(({ relation }) => relation === "governed-by");
  if (
    query.boundaryRole !== "active" || boundaries.length !== 1 ||
    boundaries[0]!.target.kind !== "work-boundary" ||
    boundaries[0]!.target.id !== query.boundary.recordId ||
    boundaries[0]!.target.revision !== query.boundary.revision ||
    boundaries[0]!.target.digest !== query.boundary.digest
  ) {
    fail("boundary-substituted", "Code subject does not bind the exact active governing Work Boundary");
  }
}

/** W owns Context; the selected Candidate lineage owns the before side P. */
async function applicationSnapshot(input: Readonly<{
  machineHome: string;
  repository: string;
  store: ControlRecordStore;
  candidate: ExactCandidate;
  query: FoundationDeliveryQueryBasis;
}>): Promise<FoundationLoadedRepositorySnapshot> {
  const integration = resolveCandidateIntegrationProvenanceV1({ store: input.store, candidate: input.candidate.revision });
  const application = integration === null ? input.query.repository
    : (await openFoundationDeliveryGitSnapshotV1({ machineHome: input.machineHome, repository: input.repository,
        identity: input.store.identity, snapshot: integration.canonicalParent })).loaded;
  if (input.candidate.baseCommit !== application.epoch.commit ||
      (integration === null && (application.epoch.commit !== input.query.basis.productBaseCommit ||
        application.epoch.tree !== input.query.basis.productBaseTree))) {
    fail("boundary-substituted", "Candidate application base does not reproduce its exact retained lineage");
  }
  return application;
}

async function withCandidateRepository<T>(input: Readonly<{
  machineHome: string;
  repository: string;
  store: ControlRecordStore;
  candidate: ExactCandidate;
  baseTree: string;
  operation: (
    repository: string,
    closure: FoundationCandidateRevisionCarrierClosureV1,
  ) => Promise<T>;
}>): Promise<T> {
  const reference = carrierManifestReference(input.candidate.revision);
  const retained = await input.store.readRetainedFile(reference.digest);
  if (retained === null) {
    fail("carrier-unavailable", "Candidate Revision Carrier manifest is physically unavailable");
  }
  if (
    retained.descriptor.digest !== reference.digest ||
    retained.descriptor.byteLength !== reference.byteLength ||
    retained.descriptor.mediaType !== reference.mediaType ||
    retained.descriptor.purpose !== reference.purpose ||
    retained.bytes.byteLength !== reference.byteLength ||
    sha256Bytes(retained.bytes) !== reference.digest
  ) fail("carrier-invalid", "Candidate Revision Carrier manifest is corrupt or substituted");
  const source = await canonicalRepository(input.repository);
  const objectFormat = await resolveGitObjectFormat(source);
  const opened = await openCandidateRevisionCarrier({
    machineHome: input.machineHome,
    manifestBytes: retained.bytes,
  });
  if (
    opened.manifest.rootTree !== input.candidate.state.tree ||
    opened.manifest.objectFormat !== objectFormat
  ) fail("carrier-invalid", "Candidate Revision Carrier differs from its retained Candidate subject");
  const verificationParent = await candidateRevisionCarrierVerificationParent(input.machineHome);
  return await withVerifiedCandidateRevisionCarrierRepository({
    artifactPath: opened.artifactPath,
    manifest: opened.manifest,
    verificationParent,
    limits: FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
    comparisonBase: { repository: source, commit: input.candidate.baseCommit, tree: input.baseTree },
    operation: async (repository, closure) => {
      if (
        closure.rootTree !== input.candidate.state.tree ||
        closure.objectFormat !== objectFormat
      ) fail("carrier-invalid", "Verified Candidate Carrier selected another Git closure");
      return await input.operation(repository, closure);
    },
  });
}

function isCandidateCarrierPhysicallyUnavailable(error: unknown): boolean {
  return error instanceof FoundationError && (
    error.code === "lifecycle.context-inspection.code-carrier-unavailable" ||
    error.code === "lifecycle.candidate.carrier-unavailable"
  );
}

function entryChange(
  before: FoundationGitTreeEntry | null,
  after: FoundationGitTreeEntry | null,
): FoundationCodeFileRow["change"] | null {
  if (before === null) return after === null ? null : "added";
  if (after === null) return "deleted";
  if (before.type !== after.type) return "type-changed";
  if (before.mode !== after.mode) return "mode-changed";
  return before.objectId === after.objectId ? null : "modified";
}

function exactEntryMode(entry: FoundationGitTreeEntry): FileObject["mode"] {
  if (
    (entry.type === "blob" && ["100644", "100755", "120000"].includes(entry.mode)) ||
    (entry.type === "commit" && entry.mode === "160000")
  ) return entry.mode as FileObject["mode"];
  fail("carrier-invalid", "Candidate tree contains an unsupported Code object mode", {
    path: entry.path,
    mode: entry.mode,
    type: entry.type,
  });
}

function fileObject(
  entry: FoundationGitTreeEntry | null,
  retainedDigest: Sha256 | null,
  blobSizes: ReadonlyMap<string, number>,
): FileObject | null {
  if (entry === null) {
    if (retainedDigest !== null) fail("carrier-invalid", "Absent Code side retains a content digest");
    return null;
  }
  if (retainedDigest === null) fail("carrier-invalid", "Present Code side lacks its retained content digest");
  const mode = exactEntryMode(entry);
  if (entry.type === "commit") {
    const expected = digestCanonical({ mode: entry.mode, objectId: entry.objectId, type: entry.type });
    if (retainedDigest !== expected) {
      fail("carrier-invalid", "Candidate gitlink facts do not reproduce the retained content digest", {
        path: entry.path,
      });
    }
    return Object.freeze({
      type: "commit",
      mode: "160000",
      objectId: entry.objectId,
      digest: retainedDigest,
      byteLength: null,
    });
  }
  const byteLength = blobSizes.get(entry.objectId);
  if (byteLength === undefined) fail("carrier-invalid", "Candidate blob size inventory is incomplete");
  return Object.freeze({
    type: "blob",
    mode: mode as "100644" | "100755" | "120000",
    objectId: entry.objectId,
    digest: retainedDigest,
    byteLength,
  });
}

async function deriveFileFacts(input: Readonly<{
  repository: string;
  candidate: ExactCandidate;
  application: FoundationLoadedRepositorySnapshot;
}>): Promise<readonly FileFact[]> {
  const beforeEntries = new Map(input.application.treeEntries.map((entry) => [entry.path, entry]));
  const afterEntries = new Map((await exactTreeEntries(
    input.repository,
    input.candidate.state.tree,
    input.application.epoch.objectFormat,
  )).map((entry) => [entry.path, entry]));
  const paths = [...new Set([...beforeEntries.keys(), ...afterEntries.keys()])].sort(compareCodePoints);
  const changes = paths.flatMap((path) => {
    const before = beforeEntries.get(path) ?? null;
    const after = afterEntries.get(path) ?? null;
    const change = entryChange(before, after);
    return change === null ? [] : [Object.freeze({ path, change, before, after })];
  });
  if (changes.length > FOUNDATION_CODE_CHANGED_PATH_LIMIT) {
    fail("carrier-invalid", "Candidate changed-path inventory exceeds the closed Code bound", {
      changedPathCount: changes.length,
      maximumChangedPaths: FOUNDATION_CODE_CHANGED_PATH_LIMIT,
    });
  }
  const retained = new Map(input.candidate.state.changedSubjects.map((subject) => [subject.path, subject]));
  if (retained.size !== changes.length) {
    fail("carrier-invalid", "Candidate tree does not reproduce its retained changed-path inventory", {
      observed: changes.length,
      retained: retained.size,
    });
  }
  const blobIds = changes.flatMap(({ before, after }) => [before, after])
    .filter((entry): entry is FoundationGitTreeEntry => entry?.type === "blob")
    .map(({ objectId }) => objectId);
  const blobSizes = await exactBlobSizes(input.repository, blobIds);
  const facts = changes.map(({ path, change, before, after }): FileFact => {
    const subject = retained.get(path);
    if (subject === undefined || subject.change !== change) {
      fail("carrier-invalid", "Candidate tree change does not reproduce its retained path fact", {
        path,
        observed: change,
        retained: subject?.change ?? null,
      });
    }
    return Object.freeze({
      path,
      change,
      before: fileObject(before, subject.beforeDigest, blobSizes),
      after: fileObject(after, subject.afterDigest, blobSizes),
    });
  });
  return Object.freeze(facts);
}

function codeBasis(input: Readonly<{
  query: FoundationDeliveryQueryBasis;
  application: FoundationLoadedRepositorySnapshot;
  selection: FoundationCodeSelection;
  candidate: ExactCandidate;
  subject: CodeSubject;
  changedPathCount: number;
}>): FoundationCodeBasis {
  governedBy(input.candidate.revision, input.query);
  if (
    input.candidate.baseCommit !== input.application.epoch.commit
  ) fail("boundary-substituted", "Candidate base does not reproduce its exact application parent");
  const subject = Object.freeze({
    schema: "lifecycle.code-basis.v2" as const,
    selection: input.selection,
    context: compileFoundationContextBasis(input.query, foundationContextSelectionOf(input.selection)),
    subject: input.subject,
    candidate: input.candidate.reference,
    seal: input.candidate.seal,
    before: Object.freeze({
      commit: input.application.epoch.commit,
      tree: input.application.epoch.tree,
    }),
    after: Object.freeze({
      tree: input.candidate.state.tree,
      candidateDigest: input.candidate.state.candidateDigest,
      pathInventoryDigest: input.candidate.state.pathInventoryDigest,
    }),
    difference: Object.freeze({
      digest: input.candidate.state.diffDigest,
      changedPathCount: input.changedPathCount,
    }),
  });
  return Object.freeze({ ...subject, digest: selfDigest(subject) });
}

function rowCursor(basis: FoundationCodeBasis, fact: FileFact): Sha256 {
  return digestFoundationInspectionCursor({
    basisDigest: basis.digest,
    collection: "code-files",
    key: Object.freeze({
      path: fact.path,
      change: fact.change,
      beforeObjectId: fact.before?.objectId ?? null,
      afterObjectId: fact.after?.objectId ?? null,
    }),
  });
}

function row(basis: FoundationCodeBasis, fact: FileFact): FoundationCodeFileRow {
  return Object.freeze({
    cursor: rowCursor(basis, fact),
    path: fact.path,
    change: fact.change,
    before: fact.before,
    after: fact.after,
  });
}

function selectedCandidate(input: Readonly<{
  store: ControlRecordStore;
  selection: FoundationCodeSelection;
  subject: CodeSubject;
}>): Readonly<{
  candidate: ExactCandidate | null;
  unavailableReason: "candidate-absent" | "decision-subject-unavailable" | null;
}> {
  const candidate = exactCodeSubject(input);
  if (candidate === null) {
    return Object.freeze({ candidate: null, unavailableReason: "candidate-absent" });
  }
  if (input.subject === "decision" && candidate.seal === null) {
    return Object.freeze({ candidate, unavailableReason: "decision-subject-unavailable" });
  }
  return Object.freeze({ candidate, unavailableReason: null });
}

async function exactFileFacts(input: Readonly<{
  machineHome: string;
  repository: string;
  store: ControlRecordStore;
  candidate: ExactCandidate;
  application: FoundationLoadedRepositorySnapshot;
}>): Promise<readonly FileFact[] | null> {
  try {
    return await withCandidateRepository({
      machineHome: input.machineHome,
      repository: input.application.repository,
      store: input.store,
      candidate: input.candidate,
      baseTree: input.application.epoch.tree,
      operation: async (repository) => await deriveFileFacts({
        repository,
        candidate: input.candidate,
        application: input.application,
      }),
    });
  } catch (error) {
    if (isCandidateCarrierPhysicallyUnavailable(error)) return null;
    throw error;
  }
}

export async function compileFoundationCodeIndex(input: Readonly<{
  machineHome: string;
  repository: string;
  store: ControlRecordStore;
  query: FoundationDeliveryQueryBasis | null;
  selector: CodeIndexSelector;
}>): Promise<FoundationCodeIndexResult> {
  const selected = selectedCandidate({
    store: input.store,
    selection: input.selector.selection,
    subject: input.selector.subject,
  });
  if (selected.unavailableReason !== null || selected.candidate === null) {
    return unavailable(
      "code-index",
      input.selector.selection,
      selected.unavailableReason ?? "candidate-absent",
    ) as FoundationCodeIndexResult;
  }
  if (input.query === null) {
    fail("boundary-absent", "Available Code requires the Candidate's exact active governing Context basis");
  }
  governedBy(selected.candidate.revision, input.query);
  const application = await applicationSnapshot({ ...input, candidate: selected.candidate, query: input.query });
  const facts = await exactFileFacts({ ...input, candidate: selected.candidate, application });
  if (facts === null) {
    return unavailable(
      "code-index",
      input.selector.selection,
      "candidate-carrier-unavailable",
    ) as FoundationCodeIndexResult;
  }
  const basis = FoundationCodeBasisSchema.parse(codeBasis({
    query: input.query,
    application,
    selection: input.selector.selection,
    candidate: selected.candidate,
    subject: input.selector.subject,
    changedPathCount: facts.length,
  }));
  let start = 0;
  if (input.selector.afterCursor !== null) {
    const index = facts.findIndex((fact) => rowCursor(basis, fact) === input.selector.afterCursor);
    if (index < 0) {
      fail("cursor-substituted", "Code continuation is not a member of the exact Code basis", {
        afterCursor: input.selector.afterCursor,
        basisDigest: basis.digest,
      });
    }
    start = index + 1;
  }
  const selectedFacts = facts.slice(start, start + input.selector.limit);
  const rows = Object.freeze(selectedFacts.map((fact) => row(basis, fact)));
  return FoundationCodeIndexResultSchema.parse(Object.freeze({
    schema: "lifecycle.code-index.v1",
    kind: "code-index",
    status: "available",
    basis,
    files: rows,
    nextAfterCursor: start + selectedFacts.length < facts.length
      ? rows.at(-1)?.cursor ?? null
      : null,
  }));
}

function sourceSubject(input: Readonly<{
  basis: FoundationCodeBasis;
  file: FileFact;
  side: "before" | "after";
  object: FileObject;
}>): FoundationSourceReference["subject"] {
  if (input.side === "after") return input.basis.candidate;
  return Object.freeze({
    kind: "repository-blob" as const,
    id: input.object.objectId,
    digest: digestCanonical({
      repositorySnapshotDigest: input.basis.context.repository.repositorySnapshotDigest,
      applicationBaseCommit: input.basis.before.commit,
      applicationBaseTree: input.basis.before.tree,
      path: input.file.path,
      type: input.object.type,
      mode: input.object.mode,
      objectId: input.object.objectId,
    }),
  });
}

async function sourceDisposition(input: Readonly<{
  repository: string;
  basis: FoundationCodeBasis;
  file: FileFact;
  side: "before" | "after";
}>): Promise<CodeSourceDisposition> {
  const selected = input.file[input.side];
  if (selected === null) return Object.freeze({ status: "absent", reference: null });
  if (
    selected.type !== "blob" ||
    (selected.mode !== "100644" && selected.mode !== "100755")
  ) return Object.freeze({ status: "unsupported", reference: null });
  if (selected.byteLength > FOUNDATION_SOURCE_MAXIMUM_BYTES) {
    return Object.freeze({ status: "oversized", reference: null });
  }
  const bytes = await objectBlobBytes(
    input.repository,
    selected.objectId,
    FOUNDATION_SOURCE_MAXIMUM_BYTES,
  );
  if (
    bytes.byteLength !== selected.byteLength ||
    sha256Bytes(bytes) !== selected.digest
  ) fail("carrier-invalid", "Code source bytes do not reproduce their exact changed-path object", {
    path: input.file.path,
    side: input.side,
  });
  try {
    UTF8.decode(bytes);
  } catch {
    return Object.freeze({ status: "binary", reference: null });
  }
  return Object.freeze({
    status: "available",
    reference: compileFoundationSourceReference({
      basis: input.basis.context,
      selection: input.basis.selection,
      sourceKind: input.side === "before" ? "canonical-blob" : "candidate-blob",
      subject: sourceSubject({ ...input, object: selected }),
      label: input.file.path,
      path: input.file.path,
      mediaType: "plain",
      content: bytes,
    }),
  });
}

function utf8Prefix(bytes: Uint8Array, maximumBytes: number): Readonly<{
  bytes: Uint8Array;
  content: string;
}> | null {
  let end = Math.min(bytes.byteLength, maximumBytes);
  while (end >= 0) {
    try {
      const content = UTF8.decode(bytes.subarray(0, end));
      return Object.freeze({ bytes: bytes.subarray(0, end), content });
    } catch {
      end -= 1;
    }
  }
  return null;
}

async function fileDifference(input: Readonly<{
  repository: string;
  candidate: ExactCandidate;
  file: FileFact;
  maximumBytes: number;
}>): Promise<CodeDifference> {
  const result = await exactFileDifferenceBytes({
    repository: input.repository,
    before: input.candidate.baseCommit,
    after: input.candidate.state.tree,
    path: input.file.path,
    maximumBytes: FOUNDATION_CODE_EXACT_DIFF_MAXIMUM_BYTES,
  });
  if (
    result.exitCode !== 0 || result.timedOut || result.stdoutTruncated ||
    result.stdout.byteLength < 1 ||
    result.stdout.byteLength > FOUNDATION_CODE_EXACT_DIFF_MAXIMUM_BYTES
  ) {
    return Object.freeze({
      profile: "lifecycle.code-file-unified-diff.v1",
      disposition: "unavailable",
      exactDigest: null,
      exactByteLength: null,
      returnedDigest: null,
      returnedByteLength: 0,
      truncated: false,
      content: null,
      reason: "difference-unavailable",
    });
  }
  const prefix = utf8Prefix(result.stdout, input.maximumBytes);
  if (prefix === null || prefix.bytes.byteLength < 1) {
    return Object.freeze({
      profile: "lifecycle.code-file-unified-diff.v1",
      disposition: "unavailable",
      exactDigest: null,
      exactByteLength: null,
      returnedDigest: null,
      returnedByteLength: 0,
      truncated: false,
      content: null,
      reason: "difference-unavailable",
    });
  }
  return Object.freeze({
    profile: "lifecycle.code-file-unified-diff.v1",
    disposition: "available",
    exactDigest: sha256Bytes(result.stdout),
    exactByteLength: result.stdout.byteLength,
    returnedDigest: sha256Bytes(prefix.bytes),
    returnedByteLength: prefix.bytes.byteLength,
    truncated: prefix.bytes.byteLength < result.stdout.byteLength,
    content: prefix.content,
    reason: null,
  });
}

export async function compileFoundationCodeFile(input: Readonly<{
  machineHome: string;
  repository: string;
  store: ControlRecordStore;
  query: FoundationDeliveryQueryBasis | null;
  selector: CodeFileSelector;
}>): Promise<FoundationCodeFileResult> {
  const selected = selectedCandidate({
    store: input.store,
    selection: input.selector.selection,
    subject: input.selector.subject,
  });
  if (selected.unavailableReason !== null || selected.candidate === null) {
    return unavailable(
      "code-file",
      input.selector.selection,
      selected.unavailableReason ?? "candidate-absent",
    ) as FoundationCodeFileResult;
  }
  if (input.query === null) {
    fail("boundary-absent", "Available Code requires the Candidate's exact active governing Context basis");
  }
  const candidate = selected.candidate;
  const query = input.query;
  governedBy(candidate.revision, query);
  const application = await applicationSnapshot({ ...input, candidate, query });
  try {
    return await withCandidateRepository({
      machineHome: input.machineHome,
      repository: application.repository,
      store: input.store,
      candidate,
      baseTree: application.epoch.tree,
      operation: async (repository) => {
        const facts = await deriveFileFacts({ repository, candidate, application });
        const basis = FoundationCodeBasisSchema.parse(codeBasis({
          query,
          application,
          selection: input.selector.selection,
          candidate,
          subject: input.selector.subject,
          changedPathCount: facts.length,
        }));
        const fact = facts.find((value) => rowCursor(basis, value) === input.selector.fileCursor);
        if (fact === undefined) {
          fail("cursor-substituted", "Code file cursor is not a member of the exact Code basis", {
            fileCursor: input.selector.fileCursor,
            basisDigest: basis.digest,
          });
        }
        return FoundationCodeFileResultSchema.parse(Object.freeze({
          schema: "lifecycle.code-file.v1",
          kind: "code-file",
          status: "available",
          basis,
          file: row(basis, fact),
          beforeSource: await sourceDisposition({ repository, basis, file: fact, side: "before" }),
          afterSource: await sourceDisposition({ repository, basis, file: fact, side: "after" }),
          difference: await fileDifference({
            repository,
            candidate,
            file: fact,
            maximumBytes: input.selector.maximumDiffBytes,
          }),
        }));
      },
    });
  } catch (error) {
    if (!isCandidateCarrierPhysicallyUnavailable(error)) throw error;
    return unavailable(
      "code-file",
      input.selector.selection,
      "candidate-carrier-unavailable",
    ) as FoundationCodeFileResult;
  }
}

/** Reopen one exact Runtime-issued canonical or Candidate Code source. */
export async function resolveFoundationCodeInspectionSource(input: Readonly<{
  machineHome: string;
  repository: string;
  store: ControlRecordStore;
  query: FoundationDeliveryQueryBasis;
  reference: FoundationSourceReference;
}>): Promise<Uint8Array | null> {
  if (
    input.reference.sourceKind !== "canonical-blob" &&
    input.reference.sourceKind !== "candidate-blob"
  ) return null;
  if (input.reference.selection.schema !== "lifecycle.code-selection.v1") return null;
  const selection = input.reference.selection;
  const selected = selectedCandidate({
    store: input.store,
    selection,
    subject: selection.subject,
  });
  if (selected.candidate === null || selected.unavailableReason !== null) return null;
  const candidate = selected.candidate;
  governedBy(candidate.revision, input.query);
  const application = await applicationSnapshot({ ...input, candidate, query: input.query });
  try {
    return await withCandidateRepository({
      machineHome: input.machineHome,
      repository: application.repository,
      store: input.store,
      candidate,
      baseTree: application.epoch.tree,
      operation: async (repository) => {
        const facts = await deriveFileFacts({ repository, candidate, application });
        const basis = FoundationCodeBasisSchema.parse(codeBasis({
          query: input.query,
          application,
          selection,
          candidate,
          subject: selection.subject,
          changedPathCount: facts.length,
        }));
        const side = input.reference.sourceKind === "canonical-blob" ? "before" : "after";
        const fact = facts.find(({ path }) => path === input.reference.path);
        const object = fact?.[side] ?? null;
        if (
          fact === undefined || object === null || object.type !== "blob" ||
          (object.mode !== "100644" && object.mode !== "100755") ||
          object.byteLength > FOUNDATION_SOURCE_MAXIMUM_BYTES
        ) return null;
        const disposition = await sourceDisposition({ repository, basis, file: fact, side });
        if (
          disposition.status !== "available" ||
          !sameFoundationSourceReference(disposition.reference, input.reference)
        ) return null;
        return await objectBlobBytes(
          repository,
          object.objectId,
          FOUNDATION_SOURCE_MAXIMUM_BYTES,
        );
      },
    });
  } catch (error) {
    if (isCandidateCarrierPhysicallyUnavailable(error)) return null;
    throw error;
  }
}
