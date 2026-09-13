import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileControlRecordRevision, compileControlRecordEvent } from "../../src/foundation/control/model.js";
import { compileControlRecordFile, type ControlRecordStore } from "../../src/foundation/control/store.js";
import type { ControlJsonObject, ControlRecordRevision, ControlRecordFile } from "../../src/foundation/control/types.js";
import { compileFoundationBuilderRepairOutputV1, parseFoundationBuilderRepairOutputV1, readFoundationBuilderRepairOutputV1,
  selectFoundationBuilderRepairOutputV1, withFoundationBuilderRepairRepositoryV1, assertFoundationBuilderRepairMaterialsV1,
  FOUNDATION_BUILDER_REPAIR_OUTPUT_PURPOSE, FOUNDATION_BUILDER_REPAIR_OUTPUT_SCHEMA_ID } from "../../src/foundation/candidate/repair-output.js";
import { parseCandidateOutputRejectionV1 } from "../../src/foundation/candidate/carrier-state-observer.js";
import { publishCandidateRevisionCarrierFromGitTree } from "../../src/foundation/candidate/carrier-binding.js";
import { verifyCandidateCarriersForStoreArchive } from "../../src/foundation/candidate/carrier-archive-verifier.js";
import { FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE, FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE } from "../../src/foundation/candidate/carrier-types.js";
import { git, objectBlobBytes } from "../../src/foundation/repository/git.js";
import { canonicalJsonLine, digestCanonical, sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { validateFoundationSchema } from "../../src/foundation/validation/schema-engine.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";

const at = "2026-09-05T12:00:00.000Z";
const ref = (value: ControlRecordRevision) => ({ id: value.recordId, revision: value.revision, digest: value.digest });
const edge = (relation: string, value: ControlRecordRevision) => ({ relation, target: { kind: value.recordKind, ...ref(value) } });
function revision(kind: string, id: string, payload: ControlJsonObject, relationships: ControlRecordRevision["relationships"] = [], number = 1) {
  return compileControlRecordRevision("delivery.repair", { recordKind: kind, recordId: id, revision: number,
    semanticAuthority: "runtime-derived", producer: { kind: "runtime", id: "runtime" }, semanticAuthor: { kind: "runtime", id: "runtime" },
    createdAt: at, semanticMarkdown: `# ${kind}\n`, payload, relationships });
}

/** Exact typed Store inputs, with real immutable Git packs; legal Process trajectories are tested beside the operated owner. */
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-builder-repair-")));
  const home = join(root, "machine");
  const repository = join(root, "repository");
  await mkdir(home, { mode: 0o700 }); await mkdir(repository);
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.name", "Lifecycle Test"]);
  await git(repository, ["config", "user.email", "lifecycle@example.invalid"]);
  await mkdir(join(repository, "src"));
  await writeFile(join(repository, "src/code.ts"), "export const useful = 1;\n");
  await writeFile(join(repository, "src/_code.desc.md"), "Current Description bytes\n");
  await writeFile(join(repository, "src/removed.ts"), "export const removed = true;\n");
  await git(repository, ["add", "."]); await git(repository, ["commit", "-m", "Exact input tree"]);
  const commit = (await git(repository, ["rev-parse", "HEAD"])).stdout.trim();
  const currentTree = (await git(repository, ["rev-parse", "HEAD^{tree}"])).stdout.trim();
  const currentCarrier = await publishCandidateRevisionCarrierFromGitTree({ machineHome: home, repository, rootTree: currentTree });
  await writeFile(join(repository, "src/code.ts"), "export const useful = 2;\n");
  await writeFile(join(repository, "src/_code.desc.md"), "---\n{ unfinished\n---\n");
  await rm(join(repository, "src/removed.ts"));
  await git(repository, ["add", "-A"]);
  const rejectedTree = (await git(repository, ["write-tree"])).stdout.trim();
  const carrier = await publishCandidateRevisionCarrierFromGitTree({ machineHome: home, repository, rootTree: rejectedTree });
  const files = new Map<string, { descriptor: ControlRecordFile; bytes: Uint8Array }>();
  const currentFile = { bytes: currentCarrier.manifestBytes, purpose: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_PURPOSE,
    mediaType: FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE, createdAt: at };
  const currentDescriptor = compileControlRecordFile(currentFile);
  files.set(currentDescriptor.digest, { descriptor: currentDescriptor, bytes: currentFile.bytes });
  const boundary = revision("work-boundary", "boundary.repair", validDeliveryControlPayload("work-boundary"));
  const sampleCandidate = validDeliveryControlPayload("candidate-revision");
  const candidate = revision("candidate-revision", "candidate.repair", { ...sampleCandidate, candidateBaseCommit: commit,
    state: { ...(sampleCandidate.state as ControlJsonObject), tree: currentTree },
    carrierManifest: { digest: currentDescriptor.digest, byteLength: currentDescriptor.byteLength, mediaType: currentDescriptor.mediaType, purpose: currentDescriptor.purpose },
  }, [edge("governed-by", boundary)]);
  const attempt = revision("agent-attempt", "attempt.repair", { ...validDeliveryControlPayload("agent-attempt"), role: "builder" },
    [edge("uses-boundary", boundary), edge("uses-candidate", candidate)]);
  const records = new Map([boundary, candidate, attempt].map((value) => [`${value.recordId}\0${value.revision}`, value]));
  const events: ReturnType<typeof compileControlRecordEvent>[] = [];
  const store = {
    identity: { targetId: "target.repair", storeId: "store.repair", processId: "delivery.repair" },
    getRevision: (id: string, number: number) => records.get(`${id}\0${number}`) ?? null,
    listRetainedFiles: () => [...files.values()].map((file) => file.descriptor),
    readRetainedFile: async (digest: string) => files.get(digest) ?? null,
    listEvents: (after: number, limit: number) => events.filter((event) => event.sequence > after).slice(0, limit),
    listCurrentRevisions: (input: { recordKinds: string[]; afterRecordId?: string; limit: number }) => [...records.values()]
      .filter((value) => input.recordKinds.includes(value.recordKind) && (input.afterRecordId == null || value.recordId > input.afterRecordId) &&
        ![...records.values()].some((other) => other.recordId === value.recordId && other.revision > value.revision)).slice(0, input.limit),
    listRevisions: (input: { recordId: string; afterRevision: number; limit: number }) => [...records.values()]
      .filter((value) => value.recordId === input.recordId && value.revision > input.afterRevision).slice(0, input.limit),
  } as unknown as ControlRecordStore;
  const rejectionSubject = { schema: "lifecycle.candidate-output-rejection.v1", manifestFileDigest: sha256Bytes(carrier.manifestBytes),
    candidateTree: rejectedTree, applicationBaseCommit: commit, explanation: "Candidate Knowledge Set is invalid",
    knowledgeDiagnostic: { code: "lifecycle.knowledge.front-matter", locator: "src/_code.desc.md" },
    validationResultDigest: sha256Bytes("complete invalid Knowledge validation"), violationDigest: sha256Bytes("exact refusal") };
  const rejection = parseCandidateOutputRejectionV1({ ...rejectionSubject, digest: digestCanonical(rejectionSubject) });
  const materials = compileFoundationBuilderRepairOutputV1({ store, attempt, boundary, candidate, rejection, manifestBytes: carrier.manifestBytes, createdAt: at });
  for (const material of materials) {
    assert.equal(material.availability, "retained");
    if (material.availability === "retained") { const descriptor = compileControlRecordFile(material.file); files.set(descriptor.digest, { descriptor, bytes: material.file.bytes }); }
  }
  const receipt = revision("execution-receipt", "receipt.repair", { ...validDeliveryControlPayload("execution-receipt"), role: "builder",
    candidate: { input: { revision: { kind: "candidate-revision", ...ref(candidate) }, carrierManifestDigest: currentDescriptor.digest },
      successorDisposition: "invalid", successor: null, contentDisposition: null },
    rawMaterials: materials.map((material) => {
      assert.equal(material.availability, "retained");
      if (material.availability !== "retained") throw new Error("missing fixture material");
      const { digest, byteLength, purpose, mediaType } = compileControlRecordFile(material.file);
      return { availability: "retained", reference: { digest, byteLength, purpose, mediaType } };
    }),
  }, [edge("observes-attempt", attempt)]);
  records.set(`${receipt.recordId}\0${receipt.revision}`, receipt);
  for (const [index, eventKind] of ["execution-receipt-recorded", "activity-completed"].entries()) events.push(compileControlRecordEvent({
    storeId: store.identity.storeId, processId: store.identity.processId, sequence: index + 1, predecessorDigest: events.at(-1)?.digest ?? null,
    event: { eventId: `event.repair.${index}`, eventKind, occurredAt: at, actor: { kind: "runtime", id: "runtime" },
      ...(index === 0 ? { subject: { recordId: receipt.recordId, revision: receipt.revision, digest: receipt.digest } } : {}), payload: { activityId: "activity.repair" } },
  }));
  return { root, home, repository, store, files, records, events, boundary, candidate, attempt, receipt, materials, rejection, carrier };
}

test("Receipt-bound repair reopens exact Product bytes, preserves deleted paths, and verifies archive custody", async (t) => {
  const value = await fixture(); t.after(async () => await rm(value.root, { recursive: true, force: true }));
  assertFoundationBuilderRepairMaterialsV1({ store: value.store, attempt: value.attempt, candidate: value.candidate,
    successorDisposition: "invalid", materials: value.materials });
  const repair = await selectFoundationBuilderRepairOutputV1(value);
  assert(repair !== null);
  assert.deepEqual(validateFoundationSchema(FOUNDATION_BUILDER_REPAIR_OUTPUT_SCHEMA_ID, repair.descriptor, "repair descriptor"), []);
  assert.equal(repair.descriptor.rejection.knowledgeDiagnostic?.locator, "src/_code.desc.md");
  const laterAttempt = revision("agent-attempt", "attempt.no-output", value.attempt.payload, value.attempt.relationships);
  const laterReceipt = revision("execution-receipt", "receipt.no-output", { ...value.receipt.payload,
    candidate: { ...(value.receipt.payload.candidate as ControlJsonObject), successorDisposition: "unavailable" }, rawMaterials: [],
  }, [edge("observes-attempt", laterAttempt)]);
  for (const retained of [laterAttempt, laterReceipt]) value.records.set(`${retained.recordId}\0${1}`, retained);
  for (const eventKind of ["execution-receipt-recorded", "activity-completed"]) value.events.push(compileControlRecordEvent({
    storeId: value.store.identity.storeId, processId: value.store.identity.processId,
    sequence: value.events.length + 1, predecessorDigest: value.events.at(-1)!.digest,
    event: { eventId: `event.no-output.${eventKind}`, eventKind, occurredAt: at, actor: { kind: "runtime", id: "runtime" },
      ...(eventKind === "execution-receipt-recorded" ? { subject: { recordId: laterReceipt.recordId, revision: 1, digest: laterReceipt.digest } } : {}),
      payload: { activityId: "activity.no-output" } },
  }));
  assert.equal((await selectFoundationBuilderRepairOutputV1(value))?.receipt.digest, repair.receipt.digest);
  await withFoundationBuilderRepairRepositoryV1({ machineHome: value.home, store: value.store, repair }, async (opened) => {
    assert(opened.currentEntries.some((entry) => entry.path === "src/removed.ts"));
    assert(!opened.closure.treeEntries.some((entry) => entry.path === "src/removed.ts"));
    const next = opened.closure.treeEntries.find((entry) => entry.path === "src/code.ts")!;
    assert.equal((await objectBlobBytes(opened.repository, next.objectId, 100)).toString(), "export const useful = 2;\n");
    const prior = opened.currentEntries.find((entry) => entry.path === "src/code.ts")!;
    assert.equal((await objectBlobBytes(opened.currentRepository, prior.objectId, 100)).toString(), "export const useful = 1;\n");
  });
  const archive = await verifyCandidateCarriersForStoreArchive({ machineHome: value.home, store: value.store });
  assert.equal(archive.candidateRevisionCount, 1);
  const first = value.materials.find((material) => material.availability === "retained" && material.file.purpose === FOUNDATION_BUILDER_REPAIR_OUTPUT_PURPOSE)!;
  assert(first.availability === "retained");
  assert.throws(() => parseFoundationBuilderRepairOutputV1(new Uint8Array(65_537)), /64KiB/);
  const substituted = { ...repair.descriptor, carrierManifest: { ...repair.descriptor.carrierManifest, mediaType: "application/json" } };
  assert.throws(() => parseFoundationBuilderRepairOutputV1(Buffer.from(canonicalJsonLine({ ...substituted,
    digest: digestCanonical(Object.fromEntries(Object.entries(substituted).filter(([key]) => key !== "digest"))) }))), /file reference/);
  for (const materials of [value.materials.slice(0, 1), [...value.materials, first]]) {
    assert.throws(() => assertFoundationBuilderRepairMaterialsV1({ store: value.store, attempt: value.attempt, candidate: value.candidate,
      successorDisposition: "invalid", materials }), /pair/);
  }
  assert.throws(() => assertFoundationBuilderRepairMaterialsV1({ store: value.store, attempt: { ...value.attempt, payload: { ...value.attempt.payload, role: "reviewer" } },
    candidate: value.candidate, successorDisposition: "invalid", materials: value.materials }), /builder/);
  const exact = value.files.get(repair.descriptor.carrierManifest.digest)!;
  value.files.delete(repair.descriptor.carrierManifest.digest);
  await assert.rejects(selectFoundationBuilderRepairOutputV1(value), { code: "lifecycle.candidate.repair-output-unavailable" });
  value.files.set(repair.descriptor.carrierManifest.digest, exact);
  assert(await readFoundationBuilderRepairOutputV1({ store: value.store, receipt: value.receipt }) !== null);
  const candidateFacts = value.receipt.payload.candidate as ControlJsonObject;
  const candidateInput = candidateFacts.input as ControlJsonObject;
  for (const input of [
    { ...candidateInput, revision: { kind: "candidate-revision", ...ref(value.candidate), digest: sha256Bytes("other Candidate") } },
    { ...candidateInput, carrierManifestDigest: sha256Bytes("other current manifest") },
  ]) {
    const substituted = revision("execution-receipt", value.receipt.recordId,
      { ...value.receipt.payload, candidate: { ...candidateFacts, input } }, value.receipt.relationships);
    value.records.set(`${substituted.recordId}\0${1}`, substituted);
    await assert.rejects(readFoundationBuilderRepairOutputV1({ store: value.store, receipt: substituted }),
      { code: "lifecycle.candidate.repair-output-invalid" });
  }
  value.records.set(`${value.receipt.recordId}\0${1}`, value.receipt);
  const currentDigest = (value.candidate.payload.carrierManifest as ControlJsonObject).digest as string;
  const currentFile = value.files.get(currentDigest)!;
  value.files.set(currentDigest, { ...currentFile, descriptor: { ...currentFile.descriptor, mediaType: "application/json" } });
  await assert.rejects(withFoundationBuilderRepairRepositoryV1({ machineHome: value.home, store: value.store, repair }, async () => undefined),
    { code: "lifecycle.candidate.repair-output-invalid" });
  value.files.set(currentDigest, currentFile);
});

test("Repair context follows only exact unchanged reaffirmation rebinds and expires on mandate or Product succession", async (t) => {
  const value = await fixture(); t.after(async () => await rm(value.root, { recursive: true, force: true }));
  const nextBoundary = revision("work-boundary", value.boundary.recordId, { ...value.boundary.payload,
    proposalKind: "reaffirmation", resolution: { kind: "reaffirm", rationaleDigest: sha256Bytes("larger profile"), changedMandateFields: [] },
    projectionProfile: { id: "execution-larger", digest: sha256Bytes("larger profile") },
  }, [edge("revises", value.boundary)], 2);
  const nextCandidate = revision("candidate-revision", value.candidate.recordId, { ...value.candidate.payload, observation: "readmission-rebind" },
    [edge("revises", value.candidate), edge("governed-by", nextBoundary)], 2);
  value.records.set(`${nextBoundary.recordId}\0${2}`, nextBoundary);
  value.records.set(`${nextCandidate.recordId}\0${2}`, nextCandidate);
  const repair = await selectFoundationBuilderRepairOutputV1({ store: value.store, boundary: nextBoundary, candidate: nextCandidate });
  assert(repair !== null); assert.deepEqual(repair.descriptor.boundary, ref(value.boundary));
  assert.equal(repair.currentBoundary.digest, nextBoundary.digest);
  for (const field of ["capabilityProfile", "mandate"] as const) {
    const payload = field === "capabilityProfile" ? { ...nextBoundary.payload, capabilityProfile: { id: "other", digest: sha256Bytes("other capability") } }
      : { ...nextBoundary.payload, mandate: { ...(nextBoundary.payload.mandate as ControlJsonObject), effects: ["new effect"] } };
    const changed = revision("work-boundary", nextBoundary.recordId, payload, nextBoundary.relationships, 2);
    const rebound = revision("candidate-revision", nextCandidate.recordId, nextCandidate.payload,
      [edge("revises", value.candidate), edge("governed-by", changed)], 2);
    value.records.set(`${changed.recordId}\0${2}`, changed); value.records.set(`${rebound.recordId}\0${2}`, rebound);
    const missing = value.files.get(value.rejection.manifestFileDigest)!;
    value.files.delete(value.rejection.manifestFileDigest);
    assert.equal(await selectFoundationBuilderRepairOutputV1({ store: value.store, boundary: changed, candidate: rebound }), null);
    value.files.set(value.rejection.manifestFileDigest, missing);
  }
  value.records.set(`${nextBoundary.recordId}\0${2}`, nextBoundary); value.records.set(`${nextCandidate.recordId}\0${2}`, nextCandidate);
  const ordinary = revision("candidate-revision", value.candidate.recordId, { ...value.candidate.payload, observation: "builder-successor" },
    [edge("revises", value.candidate), edge("governed-by", value.boundary)], 2);
  value.records.set(`${ordinary.recordId}\0${2}`, ordinary);
  const missing = value.files.get(value.rejection.manifestFileDigest)!;
  value.files.delete(value.rejection.manifestFileDigest);
  assert.equal(await selectFoundationBuilderRepairOutputV1({ store: value.store, boundary: value.boundary, candidate: ordinary }), null);
  value.files.set(value.rejection.manifestFileDigest, missing);
  value.records.set(`${nextCandidate.recordId}\0${2}`, nextCandidate); value.records.delete(`${value.candidate.recordId}\0${1}`);
  await assert.rejects(selectFoundationBuilderRepairOutputV1({ store: value.store, boundary: nextBoundary, candidate: nextCandidate }), { code: "lifecycle.candidate.repair-output-invalid" });
});
