import type { ExecutionReceiptRawMaterial } from "../control/execution-receipt.js";
import { compileControlRecordFile, type ControlRecordStore } from "../control/store.js";
import type { ControlRecordRevision, ControlRecordFile } from "../control/types.js";
import { FoundationError } from "../error.js";
import { canonicalJson, canonicalJsonLine, digestCanonical, sha256Bytes, type Sha256 } from "../validation/canonical.js";
import { parseCandidateRevisionCarrierManifest } from "./carrier-manifest.js";
import { openCandidateRevisionCarrier, candidateRevisionCarrierVerificationParent } from "./carrier-store.js";
import { withVerifiedCandidateRevisionCarrierRepository,
  type FoundationCandidateRevisionCarrierClosureV1 } from "./git-object-closure.js";
import { FOUNDATION_BUILDER_REPAIR_OUTPUT_PURPOSE, FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1, FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE } from "./carrier-types.js";
import { parseCandidateOutputRejectionV1, type FoundationCandidateOutputRejectionV1 } from "./carrier-state-observer.js";
import { exactTreeEntries } from "../repository/git.js";
import type { FoundationGitTreeEntry } from "../repository/types.js";
import { changedWorkBoundaryMandateFields } from "../control/work-boundary.js";
import { controlIdentifier } from "../control/model.js";

export { FOUNDATION_BUILDER_REPAIR_OUTPUT_PURPOSE } from "./carrier-types.js";
export const FOUNDATION_BUILDER_REPAIR_MANIFEST_PURPOSE = FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE;
export const FOUNDATION_BUILDER_REPAIR_PURPOSES: readonly string[] = Object.freeze([
  FOUNDATION_BUILDER_REPAIR_OUTPUT_PURPOSE, FOUNDATION_BUILDER_REPAIR_MANIFEST_PURPOSE,
]);
export const FOUNDATION_BUILDER_REPAIR_OUTPUT_SCHEMA = "lifecycle.builder-repair-output.v1";
export const FOUNDATION_BUILDER_REPAIR_OUTPUT_SCHEMA_ID = "urn:lifecycle:schema:builder-repair-output:v1";
const MAXIMUM_DESCRIPTOR_BYTES = 64 * 1024;
const MAXIMUM_EVENTS = 100_000;
type Reference = Readonly<{ id: string; revision: number; digest: Sha256 }>;
type FileReference = Readonly<Pick<ControlRecordFile, "digest" | "byteLength" | "mediaType" | "purpose">>;

export type FoundationBuilderRepairOutputV1 = Readonly<{
  schema: typeof FOUNDATION_BUILDER_REPAIR_OUTPUT_SCHEMA;
  attempt: Reference;
  boundary: Reference;
  inputCandidate: Reference;
  rejection: FoundationCandidateOutputRejectionV1;
  carrierManifest: FileReference;
  digest: Sha256;
}>;
export type FoundationRetainedBuilderRepairOutputV1 = Readonly<{
  descriptor: FoundationBuilderRepairOutputV1;
  receipt: ControlRecordRevision;
  attempt: ControlRecordRevision;
  boundary: ControlRecordRevision;
  candidate: ControlRecordRevision;
  currentCandidate: ControlRecordRevision;
  currentBoundary: ControlRecordRevision;
  manifestBytes: Uint8Array;
}>;
export type FoundationBuilderRepairRepositoryV1 = Readonly<{
  retained: FoundationRetainedBuilderRepairOutputV1;
  repository: string;
  currentRepository: string;
  closure: FoundationCandidateRevisionCarrierClosureV1;
  currentEntries: readonly FoundationGitTreeEntry[];
}>;

function fail(message: string): never { throw new FoundationError("lifecycle.candidate.repair-output-invalid", message); }
function unavailable(message: string): never { throw new FoundationError("lifecycle.candidate.repair-output-unavailable", message, { retryable: true }); }
function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      canonicalJson(Object.keys(value).sort()) !== canonicalJson([...keys].sort())) fail(`${label} must be one closed value`);
  return value as Record<string, unknown>;
}
function reference(value: unknown): Reference {
  const selected = object(value, ["id", "revision", "digest"], "Repair record reference");
  if (typeof selected.id !== "string" ||
      !Number.isSafeInteger(selected.revision) || Number(selected.revision) < 1 ||
      typeof selected.digest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(selected.digest)) fail("Repair reference is invalid");
  return Object.freeze({ id: controlIdentifier(selected.id, "Repair record identity"), revision: Number(selected.revision), digest: selected.digest as Sha256 });
}
function ref(record: ControlRecordRevision): Reference { return Object.freeze({ id: record.recordId, revision: record.revision, digest: record.digest }); }
function fileReference(value: unknown, purpose: string, maximumBytes: number): FileReference {
  const selected = object(value, ["digest", "byteLength", "mediaType", "purpose"], "Repair file reference");
  const mediaType = purpose === FOUNDATION_BUILDER_REPAIR_MANIFEST_PURPOSE ? FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE : "application/json";
  if (selected.purpose !== purpose || selected.mediaType !== mediaType ||
      !Number.isSafeInteger(selected.byteLength) || Number(selected.byteLength) < 1 || Number(selected.byteLength) > maximumBytes ||
      typeof selected.digest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(selected.digest)) fail("Repair file reference is invalid");
  return Object.freeze({ digest: selected.digest as Sha256, byteLength: Number(selected.byteLength), mediaType, purpose });
}

export function parseFoundationBuilderRepairOutputV1(bytes: Uint8Array): FoundationBuilderRepairOutputV1 {
  if (bytes.byteLength > MAXIMUM_DESCRIPTOR_BYTES) fail("Repair descriptor exceeds its 64KiB bound");
  let value: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    value = JSON.parse(text);
    if (canonicalJsonLine(value) !== text) fail("Repair descriptor bytes must be canonical JSON");
  } catch (error) {
    if (error instanceof FoundationError) throw error;
    fail("Repair descriptor is not exact UTF-8 JSON");
  }
  const selected = object(value, ["schema", "attempt", "boundary", "inputCandidate", "rejection", "carrierManifest", "digest"], "Repair descriptor");
  if (selected.schema !== FOUNDATION_BUILDER_REPAIR_OUTPUT_SCHEMA) fail("Repair descriptor uses another schema");
  const subject = Object.freeze({ schema: FOUNDATION_BUILDER_REPAIR_OUTPUT_SCHEMA,
    attempt: reference(selected.attempt), boundary: reference(selected.boundary), inputCandidate: reference(selected.inputCandidate),
    rejection: parseCandidateOutputRejectionV1(selected.rejection),
    carrierManifest: fileReference(selected.carrierManifest, FOUNDATION_BUILDER_REPAIR_MANIFEST_PURPOSE,
      FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1.maximumManifestBytes),
  });
  if (subject.rejection.manifestFileDigest !== subject.carrierManifest.digest || selected.digest !== digestCanonical(subject)) fail("Repair descriptor digest or rejected manifest differs");
  return Object.freeze({ ...subject, digest: digestCanonical(subject) });
}

/** Runtime-owned Product selection; no provider-authored descriptor enters this path. */
export function compileFoundationBuilderRepairOutputV1(input: Readonly<{
  store: ControlRecordStore;
  attempt: ControlRecordRevision; boundary: ControlRecordRevision; candidate: ControlRecordRevision;
  rejection: FoundationCandidateOutputRejectionV1; manifestBytes: Uint8Array; createdAt: string;
}>): readonly ExecutionReceiptRawMaterial[] {
  const manifest = parseCandidateRevisionCarrierManifest(input.manifestBytes, FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1);
  if (input.attempt.recordKind !== "agent-attempt" || input.attempt.payload.role !== "builder" ||
      input.boundary.recordKind !== "work-boundary" || input.candidate.recordKind !== "candidate-revision" ||
      input.rejection.candidateTree !== manifest.rootTree || input.rejection.manifestFileDigest !== sha256Bytes(input.manifestBytes) ||
      input.rejection.applicationBaseCommit !== input.candidate.payload.candidateBaseCommit) fail("Repair output does not bind its exact builder subjects");
  const existing = input.store.listRetainedFiles().find((file) => file.digest === sha256Bytes(input.manifestBytes));
  const manifestFile = Object.freeze({ bytes: Uint8Array.from(input.manifestBytes), mediaType: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
    purpose: FOUNDATION_BUILDER_REPAIR_MANIFEST_PURPOSE, createdAt: existing?.createdAt ?? input.createdAt });
  const { digest, byteLength, mediaType, purpose } = compileControlRecordFile(manifestFile);
  if (existing !== undefined && canonicalJson(existing) !== canonicalJson(compileControlRecordFile(manifestFile))) fail("Repair Carrier manifest conflicts with its retained content descriptor");
  const subject = Object.freeze({ schema: FOUNDATION_BUILDER_REPAIR_OUTPUT_SCHEMA,
    attempt: ref(input.attempt), boundary: ref(input.boundary), inputCandidate: ref(input.candidate),
    rejection: parseCandidateOutputRejectionV1(input.rejection), carrierManifest: Object.freeze({ digest, byteLength, mediaType, purpose }),
  });
  const bytes = Uint8Array.from(Buffer.from(canonicalJsonLine({ ...subject, digest: digestCanonical(subject) }), "utf8"));
  parseFoundationBuilderRepairOutputV1(bytes);
  return Object.freeze([
    Object.freeze({ availability: "retained" as const, file: Object.freeze({ bytes, mediaType: "application/json", purpose: FOUNDATION_BUILDER_REPAIR_OUTPUT_PURPOSE, createdAt: input.createdAt }) }),
    Object.freeze({ availability: "retained" as const, file: manifestFile }),
  ]);
}

function pairedReferences(receipt: ControlRecordRevision): readonly [FileReference, FileReference] | null {
  if (!Array.isArray(receipt.payload.rawMaterials)) fail("Repair Receipt lacks its exact raw-material inventory");
  const selected = receipt.payload.rawMaterials.filter((entry) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) fail("Repair raw-material entry is invalid");
    const item = entry as Record<string, unknown>;
    const purpose = item.availability === "retained" && item.reference !== null && typeof item.reference === "object"
      ? (item.reference as Record<string, unknown>).purpose : item.purpose;
    return FOUNDATION_BUILDER_REPAIR_PURPOSES.includes(String(purpose));
  });
  if (selected.length === 0) return null;
  if (receipt.recordKind !== "execution-receipt" || receipt.payload.role !== "builder" || selected.length !== 2) fail("Repair purposes require one exact builder pair");
  const entries = selected.map((entry) => object(entry, ["availability", "reference"], "Retained repair member"));
  if (entries.some((entry) => entry.availability !== "retained")) fail("A repair pair must be completely retained");
  const find = (purpose: string, maximumBytes: number) => {
    const matches = entries.filter((entry) => object(entry.reference, ["digest", "byteLength", "mediaType", "purpose"], "Repair file reference").purpose === purpose);
    if (matches.length !== 1) fail("Repair pair repeats or omits one purpose");
    return fileReference(matches[0]!.reference, purpose, maximumBytes);
  };
  return Object.freeze([find(FOUNDATION_BUILDER_REPAIR_OUTPUT_PURPOSE, MAXIMUM_DESCRIPTOR_BYTES),
    find(FOUNDATION_BUILDER_REPAIR_MANIFEST_PURPOSE, FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1.maximumManifestBytes)] as const);
}
async function exactFile(store: ControlRecordStore, reference: FileReference): Promise<Uint8Array> {
  let selected;
  try { selected = await store.readRetainedFile(reference.digest); } catch { unavailable("Exact Receipt-bound repair bytes could not be reopened"); }
  if (selected === null) unavailable("Exact Receipt-bound repair bytes are absent");
  if (selected.descriptor.digest !== reference.digest || selected.descriptor.byteLength !== reference.byteLength ||
      selected.bytes.byteLength !== reference.byteLength || sha256Bytes(selected.bytes) !== reference.digest ||
      selected.descriptor.purpose !== reference.purpose || selected.descriptor.mediaType !== reference.mediaType) fail("Receipt-bound repair file was substituted");
  return selected.bytes;
}
function exactRecord(store: ControlRecordStore, selected: Reference, kind: string): ControlRecordRevision {
  const record = store.getRevision(selected.id, selected.revision);
  if (record === null || record.recordKind !== kind || record.digest !== selected.digest || record.processId !== store.identity.processId) fail("Repair descriptor names an unavailable exact Control record");
  return record;
}
function relation(record: ControlRecordRevision, name: string, kind: string): Reference {
  const selected = record.relationships.filter((item) => item.relation === name && item.target.kind === kind);
  if (selected.length !== 1) fail("Repair provenance lacks one exact relationship");
  return reference({ id: selected[0]!.target.id, revision: selected[0]!.target.revision, digest: selected[0]!.target.digest });
}

export function assertFoundationBuilderRepairMaterialsV1(input: Readonly<{
  store: ControlRecordStore; attempt: ControlRecordRevision; candidate: ControlRecordRevision | null;
  successorDisposition: "promoted" | "invalid" | "unavailable" | "not-produced" | null;
  materials: readonly ExecutionReceiptRawMaterial[];
}>): void {
  const selected = input.materials.filter((material) => FOUNDATION_BUILDER_REPAIR_PURPOSES.includes(
    material.availability === "retained" ? material.file.purpose : material.purpose));
  if (selected.length === 0) return;
  if (input.attempt.payload.role !== "builder" || input.candidate === null || input.successorDisposition !== "invalid" ||
      selected.length !== 2 || selected.some((material) => material.availability !== "retained")) fail("Repair custody requires one complete invalid builder pair");
  const files = selected.flatMap((material) => material.availability === "retained" ? [material.file] : []);
  const descriptors = files.filter((file) => file.purpose === FOUNDATION_BUILDER_REPAIR_OUTPUT_PURPOSE);
  const manifests = files.filter((file) => file.purpose === FOUNDATION_BUILDER_REPAIR_MANIFEST_PURPOSE);
  if (descriptors.length !== 1 || manifests.length !== 1) fail("Repair custody repeats or omits one exact member");
  const descriptor = parseFoundationBuilderRepairOutputV1(descriptors[0]!.bytes);
  if (descriptors[0]!.mediaType !== "application/json" ||
      canonicalJson(descriptor.attempt) !== canonicalJson(ref(input.attempt)) ||
      canonicalJson(descriptor.inputCandidate) !== canonicalJson(ref(input.candidate)) ||
      canonicalJson(descriptor.boundary) !== canonicalJson(relation(input.attempt, "uses-boundary", "work-boundary")) ||
      canonicalJson(descriptor.inputCandidate) !== canonicalJson(relation(input.attempt, "uses-candidate", "candidate-revision"))) fail("Repair custody substituted its exact Attempt inputs");
  const { digest, byteLength, mediaType, purpose } = compileControlRecordFile(manifests[0]!);
  if (canonicalJson(descriptor.carrierManifest) !== canonicalJson({ digest, byteLength, mediaType, purpose })) fail("Repair custody substituted its exact paired Carrier manifest");
  const manifest = parseCandidateRevisionCarrierManifest(manifests[0]!.bytes, FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1);
  if (descriptor.rejection.candidateTree !== manifest.rootTree || descriptor.rejection.applicationBaseCommit !== input.candidate.payload.candidateBaseCommit) fail("Repair custody changed the rejected tree or application base");
}

/** Reopens a retained pair and verifies its original exact provenance, independent of currentness. */
export async function readFoundationBuilderRepairOutputV1(input: Readonly<{
  store: ControlRecordStore; receipt: ControlRecordRevision;
}>): Promise<FoundationRetainedBuilderRepairOutputV1 | null> {
  const exact = exactRecord(input.store, ref(input.receipt), "execution-receipt");
  if (canonicalJson(exact) !== canonicalJson(input.receipt)) fail("Repair Receipt differs from its exact retained revision");
  const pair = pairedReferences(input.receipt);
  if (pair === null) return null;
  const descriptor = parseFoundationBuilderRepairOutputV1(await exactFile(input.store, pair[0]));
  if (canonicalJson(descriptor.carrierManifest) !== canonicalJson(pair[1])) fail("Repair descriptor does not select the Receipt's exact paired manifest");
  const manifestBytes = await exactFile(input.store, pair[1]);
  const manifest = parseCandidateRevisionCarrierManifest(manifestBytes, FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1);
  const attempt = exactRecord(input.store, descriptor.attempt, "agent-attempt");
  const boundary = exactRecord(input.store, descriptor.boundary, "work-boundary");
  const candidate = exactRecord(input.store, descriptor.inputCandidate, "candidate-revision");
  const candidateFacts = object(input.receipt.payload.candidate,
    ["input", "successorDisposition", "successor", "contentDisposition"], "Repair Receipt Candidate facts");
  const candidateInput = object(candidateFacts.input, ["revision", "carrierManifestDigest"], "Repair Receipt Candidate input");
  const candidateManifest = fileReference(candidate.payload.carrierManifest, FOUNDATION_BUILDER_REPAIR_MANIFEST_PURPOSE,
    FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1.maximumManifestBytes);
  if (attempt.payload.role !== "builder" || manifest.rootTree !== descriptor.rejection.candidateTree ||
      candidate.payload.candidateBaseCommit !== descriptor.rejection.applicationBaseCommit ||
      canonicalJson(candidateInput.revision) !== canonicalJson({ kind: "candidate-revision", ...descriptor.inputCandidate }) ||
      candidateInput.carrierManifestDigest !== candidateManifest.digest ||
      canonicalJson(relation(input.receipt, "observes-attempt", "agent-attempt")) !== canonicalJson(descriptor.attempt) ||
      canonicalJson(relation(attempt, "uses-boundary", "work-boundary")) !== canonicalJson(descriptor.boundary) ||
      canonicalJson(relation(attempt, "uses-candidate", "candidate-revision")) !== canonicalJson(descriptor.inputCandidate) ||
      candidateFacts.successorDisposition !== "invalid" || candidateFacts.successor !== null) fail("Repair output does not match exact failed builder provenance");
  return Object.freeze({ descriptor, receipt: input.receipt, attempt, boundary, candidate,
    currentBoundary: boundary, currentCandidate: candidate, manifestBytes });
}

function repairContinuation(input: Readonly<{ store: ControlRecordStore; original: Readonly<{ inputCandidate: Reference; boundary: Reference }>;
  boundary: ControlRecordRevision; candidate: ControlRecordRevision }>): boolean {
  let candidate = exactRecord(input.store, ref(input.candidate), "candidate-revision");
  let boundary = exactRecord(input.store, ref(input.boundary), "work-boundary");
  for (let steps = 0; steps < 25_000; steps += 1) {
    if (canonicalJson(ref(candidate)) === canonicalJson(input.original.inputCandidate)) {
      return canonicalJson(ref(boundary)) === canonicalJson(input.original.boundary);
    }
    if (candidate.payload.observation !== "readmission-rebind") return false;
    const prior = exactRecord(input.store, relation(candidate, "revises", "candidate-revision"), "candidate-revision");
    const priorBoundary = exactRecord(input.store, relation(prior, "governed-by", "work-boundary"), "work-boundary");
    if (candidate.recordId !== prior.recordId || candidate.revision !== prior.revision + 1 ||
        boundary.recordId !== priorBoundary.recordId || boundary.revision !== priorBoundary.revision + 1 ||
        canonicalJson(candidate.payload.state) !== canonicalJson(prior.payload.state) ||
        canonicalJson(candidate.payload.carrierManifest) !== canonicalJson(prior.payload.carrierManifest) ||
        candidate.payload.candidateBaseCommit !== prior.payload.candidateBaseCommit ||
        canonicalJson(relation(candidate, "governed-by", "work-boundary")) !== canonicalJson(ref(boundary)) ||
        canonicalJson(relation(boundary, "revises", "work-boundary")) !== canonicalJson(ref(priorBoundary))) fail("Repair readmission lineage is not byte-identical and exact");
    const resolution = boundary.payload.resolution;
    if (resolution === null || typeof resolution !== "object" || Array.isArray(resolution) || (resolution as Record<string, unknown>).kind !== "reaffirm" ||
        changedWorkBoundaryMandateFields(priorBoundary, boundary.payload).length !== 0 ||
        canonicalJson(boundary.payload.basis) !== canonicalJson(priorBoundary.payload.basis)) return false;
    candidate = prior; boundary = priorBoundary;
  }
  fail("Repair readmission lineage exceeds its complete retained revision bound");
}

/** The latest completed repair pair remains useful while its exact W/C lineage governs. */
export async function selectFoundationBuilderRepairOutputV1(input: Readonly<{
  store: ControlRecordStore; boundary: ControlRecordRevision; candidate: ControlRecordRevision;
}>): Promise<FoundationRetainedBuilderRepairOutputV1 | null> {
  const events = [];
  let after = 0;
  for (;;) {
    const page = input.store.listEvents(after, 10_000); events.push(...page);
    if (events.length > MAXIMUM_EVENTS) fail("Repair selection exceeds the complete Journal bound");
    if (page.length < 10_000) break;
    after = page.at(-1)!.sequence ?? after;
  }
  const receiptEvents = new Map<unknown, (typeof events)[number]>();
  for (const event of events) {
    if (event.eventKind === "execution-receipt-recorded" && !receiptEvents.has(event.payload.activityId)) {
      receiptEvents.set(event.payload.activityId, event);
    }
  }
  for (const event of [...events].reverse()) {
    if (event.eventKind !== "activity-completed") continue;
    const activityId = event.payload.activityId;
    const receiptEvent = receiptEvents.get(activityId);
    if (receiptEvent?.subject === null || receiptEvent?.subject === undefined) continue;
    const receipt = input.store.getRevision(receiptEvent.subject.recordId, receiptEvent.subject.revision);
    if (receipt === null || receipt.digest !== receiptEvent.subject.digest) fail("Repair selection lost an exact retained Receipt");
    if (receipt.payload.role !== "builder") continue;
    if (pairedReferences(receipt) === null) continue;
    // Currentness is a Control relationship fact. Expired repair files need not
    // be available to compile unrelated later work; archive custody still verifies them.
    const attempt = exactRecord(input.store, relation(receipt, "observes-attempt", "agent-attempt"), "agent-attempt");
    const original = Object.freeze({ inputCandidate: relation(attempt, "uses-candidate", "candidate-revision"),
      boundary: relation(attempt, "uses-boundary", "work-boundary") });
    if (!repairContinuation({ ...input, original })) return null;
    const repair = await readFoundationBuilderRepairOutputV1({ store: input.store, receipt });
    if (repair === null) return null;
    return Object.freeze({ ...repair, currentCandidate: input.candidate, currentBoundary: input.boundary });
  }
  return null;
}

export async function withFoundationBuilderRepairRepositoryV1<T>(input: Readonly<{
  machineHome: string; store: ControlRecordStore; repair: FoundationRetainedBuilderRepairOutputV1;
}>, operation: (input: FoundationBuilderRepairRepositoryV1) => Promise<T>): Promise<T> {
  const opened = await openCandidateRevisionCarrier({ machineHome: input.machineHome, manifestBytes: input.repair.manifestBytes });
  const currentReference = fileReference(input.repair.currentCandidate.payload.carrierManifest,
    FOUNDATION_BUILDER_REPAIR_MANIFEST_PURPOSE, FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1.maximumManifestBytes);
  const currentBytes = await exactFile(input.store, currentReference);
  const current = await openCandidateRevisionCarrier({ machineHome: input.machineHome, manifestBytes: currentBytes });
  if (current.manifest.rootTree !== (input.repair.currentCandidate.payload.state as Record<string, unknown>).tree ||
      current.manifest.objectFormat !== opened.manifest.objectFormat) fail("Current repair comparison tree differs from its selected Candidate");
  return await withVerifiedCandidateRevisionCarrierRepository({ artifactPath: opened.artifactPath, manifest: opened.manifest,
    verificationParent: await candidateRevisionCarrierVerificationParent(input.machineHome), limits: FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
    operation: async (repository, closure) => await withVerifiedCandidateRevisionCarrierRepository({
      artifactPath: current.artifactPath, manifest: current.manifest,
      verificationParent: await candidateRevisionCarrierVerificationParent(input.machineHome), limits: FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
      operation: async (currentRepository, currentClosure) => {
        const currentEntries = await exactTreeEntries(currentRepository, currentClosure.rootTree, currentClosure.objectFormat);
        return await operation(Object.freeze({ retained: input.repair, repository, currentRepository, closure, currentEntries }));
      },
    }),
  });
}
