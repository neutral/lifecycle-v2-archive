import { contextInspectionSelection } from "../support/inspection-selection.js";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  FoundationDeliveryGenerationSchema,
  FoundationKnowledgeIndexSelectorSchema,
  FoundationKnowledgeRecordSelectorSchema,
} from "@neutral/lifecycle-protocol";
import {
  FOUNDATION_PROVIDER_PROTOCOL,
  FOUNDATION_REPOSITORY_SCHEMA,
  FOUNDATION_SPECIFICATION_REVISION,
  FOUNDATION_WORK_BOUNDARY_PAYLOAD_SCHEMA,
} from "../../src/foundation/constants.js";
import { compileControlRecordRevision } from "../../src/foundation/control/model.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import { loadKnowledgeSet } from "../../src/foundation/knowledge/knowledge-set.js";
import { parseKnowledgeRecord } from "../../src/foundation/knowledge/records.js";
import { compileFoundationContextBasis } from "../../src/foundation/read-model/context-basis.js";
import { compileFoundationDeliveryQueryBasis } from "../../src/foundation/read-model/delivery-query-basis.js";
import {
  compileFoundationKnowledgeIndex,
  compileFoundationKnowledgeRecord,
  resolveFoundationKnowledgeInspectionSource,
} from "../../src/foundation/read-model/knowledge-inspection.js";
import { compileFoundationSourceRange } from "../../src/foundation/read-model/source-inspection.js";
import { receiveFoundationAuthorityCredential } from "../../src/foundation/repository/authority.js";
import { git } from "../../src/foundation/repository/git.js";
import { initializeRepository } from "../../src/foundation/repository/initialize.js";
import { bindRepositorySnapshot, loadRepositoryEpoch } from "../../src/foundation/repository/snapshot.js";
import { canonicalPrettyJson, selfDigest, sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { FOUNDATION_GENERATED_PUBLICATION_DIGEST } from "../../src/foundation/validation/generated-schemas.js";
import { writeMinimalAtlas } from "../helpers/atlas-fixture.js";
import { validDeliveryControlPayload } from "../helpers/foundation-control-payload.js";
import { foundationDisciplineAdoptionFixture, TEST_DISCIPLINE_PATH } from "../helpers/foundation-discipline-fixture.js";

test("public Knowledge and Source inspection reopen an actual adopted Discipline and Registry from the exact historical basis", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-discipline-inspection-")));
  const home = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-discipline-inspection-home-")));
  const write = async (path: string, contents: string): Promise<void> => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents, "utf8");
  };
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Lifecycle Test"]);
  await git(root, ["config", "user.email", "lifecycle@example.invalid"]);
  await writeMinimalAtlas(root);
  await git(root, ["add", "--", "atlas"]);
  await git(root, ["commit", "-m", "Create target Atlas"]);
  const contract = await initializeRepository(root, {
    targetId: "discipline-inspection-target",
    home,
    authorityCredential: receiveFoundationAuthorityCredential("discipline-inspection-secret-at-least-thirty-two-bytes", "initialize"),
    publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
    implementationRoots: [],
    stage: true,
  });
  const adoption = foundationDisciplineAdoptionFixture(contract);
  await write(TEST_DISCIPLINE_PATH, adoption.document);
  await write(contract.knowledge.roots.disciplineRegistry, adoption.registryDocument);
  await git(root, ["add", "--", "records/disciplines"]);
  await git(root, ["commit", "-m", "Initialize and adopt exact publisher guidance"]);
  const epoch = await loadRepositoryEpoch(root);
  const knowledge = await loadKnowledgeSet(epoch);
  const repository = await bindRepositorySnapshot(epoch, knowledge);
  const snapshot = repository.snapshot;
  const processId = "discipline-inspection-process";
  const record = knowledge.index.currentByIdentity.get(adoption.record.frontMatter.id)!;
  const boundary = compileControlRecordRevision(processId, {
    recordId: "discipline-inspection-boundary", recordKind: "work-boundary", revision: 1,
    producer: { kind: "runtime", id: "foundation-runtime" },
    semanticAuthor: { kind: "runtime", id: "foundation-runtime" },
    semanticAuthority: "runtime-derived", createdAt: "2026-09-05T12:00:00.000Z", semanticMarkdown: "# Selected work\n",
    payload: {
      ...validDeliveryControlPayload("work-boundary"),
      schema: FOUNDATION_WORK_BOUNDARY_PAYLOAD_SCHEMA,
      profileId: "lifecycle.work-boundary.foundation-v3",
      targetId: contract.targetId,
      basis: {
        specificationRevision: FOUNDATION_SPECIFICATION_REVISION,
        repositoryContract: FOUNDATION_REPOSITORY_SCHEMA,
        providerAdapter: FOUNDATION_PROVIDER_PROTOCOL,
        productBaseCommit: snapshot.commit, productBaseTree: snapshot.tree,
        productStateDigest: snapshot.productStateDigest,
        atlasStateDigest: snapshot.atlasStateDigest,
        atlasResolutionDigest: snapshot.atlasResolutionDigest,
        atlasNormalizedModelDigest: snapshot.atlasNormalizedModelDigest,
        atlasResourceBindingsDigest: snapshot.atlasResourceBindingsDigest,
        repositoryContractDigest: snapshot.contractDigest,
        knowledgeSetDigest: snapshot.knowledgeSetDigest,
        repositorySnapshotDigest: snapshot.digest,
      },
      knowledge: [{ id: record.frontMatter.id, revision: record.frontMatter.revision, sourceDigest: record.sourceDigest, semanticDigest: record.semanticDigest }],
      disciplines: {
        registryDigest: adoption.registry.digest,
        workTypeIds: [adoption.registry.workTypes[0]!.id],
        records: [{ id: record.frontMatter.id, revision: record.frontMatter.revision, sourceDigest: record.sourceDigest, semanticDigest: record.semanticDigest }],
      },
    },
  });

  // Later repository maintenance is distinct from the retained historical query.
  const changedDocument = adoption.document.replaceAll("Prefer", "Use another review practice: prefer");
  const changedRecord = parseKnowledgeRecord({ path: TEST_DISCIPLINE_PATH, mode: "100644", objectId: "f".repeat(40), bytes: Buffer.from(changedDocument), contract });
  const changedRegistrySubject = {
    ...adoption.registry,
    adoptions: [{ ...adoption.registry.adoptions[0]!, sourceDigest: changedRecord.sourceDigest, semanticDigest: changedRecord.semanticDigest }],
    workTypes: [{ ...adoption.registry.workTypes[0]!, title: "Current maintenance group" }],
  };
  await write(TEST_DISCIPLINE_PATH, changedDocument);
  await write(contract.knowledge.roots.disciplineRegistry, canonicalPrettyJson({ ...changedRegistrySubject, digest: selfDigest(changedRegistrySubject) }));
  await git(root, ["add", "--", "records/disciplines"]);
  await git(root, ["commit", "-m", "Change current adopted guidance after selected epoch"]);
  const currentEpoch = await loadRepositoryEpoch(root);
  const currentKnowledge = await loadKnowledgeSet(currentEpoch);
  assert.notEqual(currentKnowledge.disciplineRegistry.digest, adoption.registry.digest);
  assert.notEqual(currentKnowledge.manifest.digest, knowledge.manifest.digest);

  // The Store-selection seam is a bounded fake; Git loading, Registry validation,
  // snapshot binding, inspection compilation, and public schemas are real owners.
  const activeBoundary = { id: boundary.recordId, revision: boundary.revision, digest: boundary.digest };
  const store = {
    identity: { targetId: contract.targetId, storeId: "discipline-inspection-store", processId },
    state: () => ({ subjects: { proposedBoundary: null, activeBoundary } }),
    getRevision: (id: string, revision: number) => id === boundary.recordId && revision === boundary.revision ? boundary : null,
  } as unknown as ControlRecordStore;
  const query = await compileFoundationDeliveryQueryBasis({ machineHome: home, target: root, store });
  assert.deepEqual(query.knowledge.disciplineRegistry, adoption.registry);
  assert.equal(query.knowledge.manifest.digest, knowledge.manifest.digest);
  assert.equal(query.repository.snapshot.digest, snapshot.digest);
  const generationSubject = {
    schema: "lifecycle.delivery-generation.v1" as const,
    storeId: store.identity.storeId, processId,
    journal: { eventCount: 1, headSequence: 1, headDigest: sha256Bytes("selected Boundary event") },
    storeDisposition: { stage: "active" as const, integrity: "verified" as const, sealSubjectDigest: null, archiveManifestDigest: null },
    repository: { headCommit: currentEpoch.epoch.commit, headTree: currentEpoch.epoch.tree, repositoryContractDigest: contract.digest },
    activeOperation: null,
  };
  const generation = FoundationDeliveryGenerationSchema.parse({ ...generationSubject, digest: selfDigest(generationSubject) });
  const basis = compileFoundationContextBasis(query, contextInspectionSelection(query, generation));
  const context = basis.selection;
  const index = compileFoundationKnowledgeIndex({ query, basis, selector: FoundationKnowledgeIndexSelectorSchema.parse({ kind: "knowledge-index", context, afterCursor: null, limit: 10 }) });
  assert.equal(index.records.length, 1);
  const row = index.records[0]!;
  assert.equal(row.reference.kind, "discipline");
  assert.equal(row.reference.sourceDigest, record.sourceDigest);
  assert.equal(row.selectedByBoundary, true);
  assert.deepEqual(row.owners, adoption.record.frontMatter.owners);
  const inspected = compileFoundationKnowledgeRecord({ query, basis, selector: FoundationKnowledgeRecordSelectorSchema.parse({ kind: "knowledge-record", context, reference: row.reference }) });
  assert.deepEqual(inspected.spec, record.frontMatter.spec);
  const content = resolveFoundationKnowledgeInspectionSource({ query, basis, reference: inspected.body });
  assert(content !== null);
  assert.equal(Buffer.from(content).toString("utf8"), record.bodyNormalized);
  assert.notEqual(Buffer.from(content).toString("utf8"), changedRecord.bodyNormalized);
  const source = compileFoundationSourceRange({ basis, selector: { reference: inspected.body, startByte: 0, maximumBytes: 4096 }, content });
  assert.equal(source.content, record.bodyNormalized);
  assert.equal(source.nextByte, null);
});
