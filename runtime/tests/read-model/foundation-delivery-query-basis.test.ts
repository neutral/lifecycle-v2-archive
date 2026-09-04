import assert from "node:assert/strict";
import test from "node:test";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import type { ControlJsonObject, ControlRecordRevision } from "../../src/foundation/control/types.js";
import { FoundationError } from "../../src/foundation/error.js";
import type { FoundationKnowledgeSet, FoundationKnowledgeSetResult } from "../../src/foundation/knowledge/types.js";
import {
  compileFoundationDeliveryQueryBasis,
  type FoundationDeliveryQueryBasisOwners,
  type FoundationDeliveryQueryRepositoryBasis,
} from "../../src/foundation/read-model/delivery-query-basis.js";
import type {
  FoundationLoadedRepositoryEpoch,
  FoundationLoadedRepositorySnapshot,
  FoundationRepositorySnapshot,
} from "../../src/foundation/repository/types.js";
import { digestCanonical, sha256Bytes, type Sha256 } from "../../src/foundation/validation/canonical.js";
import type { FoundationValidationResult } from "../../src/foundation/validation/result.js";

const TARGET = "delivery-query-basis-target";
const STORE = "delivery-query-basis-store";
const PROCESS = "delivery-query-basis-process";
const TARGET_PATH = "/private/delivery-query-basis-target";
const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);

function valueDigest(label: string): Sha256 {
  return sha256Bytes(`delivery-query-basis:${label}`);
}

const REPOSITORY_DIGESTS = Object.freeze({
  productStateDigest: valueDigest("product-state"),
  atlasStateDigest: valueDigest("atlas-state"),
  atlasResolutionDigest: valueDigest("atlas-resolution"),
  atlasNormalizedModelDigest: valueDigest("atlas-normalized-model"),
  atlasResourceBindingsDigest: valueDigest("atlas-resource-bindings"),
  repositoryContractDigest: valueDigest("repository-contract"),
  knowledgeSetDigest: valueDigest("knowledge-set"),
});

function snapshotDigest(
  value: Omit<FoundationRepositorySnapshot, "digest">,
): Sha256 {
  return digestCanonical(value);
}

function repositorySnapshot(
  overrides: Partial<FoundationRepositorySnapshot> = {},
): FoundationRepositorySnapshot {
  const { digest: suppliedDigest, ...subject } = {
    targetId: TARGET,
    commit: COMMIT,
    tree: TREE,
    objectFormat: "sha1" as const,
    contractDigest: REPOSITORY_DIGESTS.repositoryContractDigest,
    productStateDigest: REPOSITORY_DIGESTS.productStateDigest,
    atlasStateDigest: REPOSITORY_DIGESTS.atlasStateDigest,
    atlasResolutionDigest: REPOSITORY_DIGESTS.atlasResolutionDigest,
    atlasNormalizedModelDigest: REPOSITORY_DIGESTS.atlasNormalizedModelDigest,
    atlasResourceBindingsDigest: REPOSITORY_DIGESTS.atlasResourceBindingsDigest,
    knowledgeSetDigest: REPOSITORY_DIGESTS.knowledgeSetDigest,
    ...overrides,
  };
  return Object.freeze({
    ...subject,
    digest: suppliedDigest ?? snapshotDigest(subject as Omit<FoundationRepositorySnapshot, "digest">),
  }) as FoundationRepositorySnapshot;
}

const BASE_SNAPSHOT = repositorySnapshot();

function retainedBasis(
  overrides: Partial<FoundationDeliveryQueryRepositoryBasis> = {},
): FoundationDeliveryQueryRepositoryBasis {
  return Object.freeze({
    specificationRevision: "lifecycle.foundation.1.0.0-rc.10",
    repositoryContract: "lifecycle.repository.v15",
    providerAdapter: "lifecycle.provider-adapter.v6",
    productBaseCommit: COMMIT,
    productBaseTree: TREE,
    ...REPOSITORY_DIGESTS,
    repositorySnapshotDigest: BASE_SNAPSHOT.digest,
    ...overrides,
  });
}

function boundary(
  basis: Readonly<Record<string, unknown>> = retainedBasis(),
  overrides: Partial<ControlRecordRevision> = {},
): ControlRecordRevision {
  return Object.freeze({
    schema: "lifecycle.control-record-revision.v1",
    processId: PROCESS,
    recordId: "work-boundary-current",
    recordKind: "work-boundary",
    revision: 2,
    producer: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
    semanticAuthor: Object.freeze({ kind: "runtime", id: "foundation-runtime" }),
    semanticAuthority: "runtime-derived",
    createdAt: "2026-09-03T12:00:00.000Z",
    semanticMarkdown: "# Work Boundary\n",
    payload: Object.freeze({
      schema: "lifecycle.work-boundary-payload.v4",
      profileId: "lifecycle.work-boundary.foundation-v1",
      targetId: TARGET,
      basis: basis as ControlJsonObject,
    }),
    relationships: Object.freeze([]),
    digest: valueDigest("boundary"),
    ...overrides,
  }) as ControlRecordRevision;
}

function epoch(): FoundationLoadedRepositoryEpoch {
  return Object.freeze({
    repository: TARGET_PATH,
    contract: Object.freeze({
      targetId: TARGET,
      digest: REPOSITORY_DIGESTS.repositoryContractDigest,
    }),
    epoch: Object.freeze({
      ref: "refs/heads/main",
      commit: COMMIT,
      tree: TREE,
      objectFormat: "sha1",
    }),
    treeEntries: Object.freeze([]),
    productState: Object.freeze({
      entries: Object.freeze([]),
      digest: REPOSITORY_DIGESTS.productStateDigest,
    }),
    atlasState: Object.freeze({
      entries: Object.freeze([]),
      digest: REPOSITORY_DIGESTS.atlasStateDigest,
    }),
    atlas: Object.freeze({
      resolution: Object.freeze({
        digest: REPOSITORY_DIGESTS.atlasResolutionDigest,
        normalizedModelDigest: REPOSITORY_DIGESTS.atlasNormalizedModelDigest,
        resourceBindingsDigest: REPOSITORY_DIGESTS.atlasResourceBindingsDigest,
      }),
    }),
    worktree: Object.freeze({
      dirty: false,
      modified: Object.freeze([]),
      untracked: Object.freeze([]),
      ignored: Object.freeze([]),
    }),
  }) as unknown as FoundationLoadedRepositoryEpoch;
}

function validKnowledge(loaded: FoundationLoadedRepositoryEpoch): FoundationKnowledgeSet {
  const validation = Object.freeze({
    complete: true,
    valid: true,
    digest: valueDigest("knowledge-validation"),
  }) as FoundationValidationResult;
  const repository = Object.freeze({
    targetId: TARGET,
    commit: COMMIT,
    tree: TREE,
    objectFormat: "sha1" as const,
    contractDigest: REPOSITORY_DIGESTS.repositoryContractDigest,
    productStateDigest: REPOSITORY_DIGESTS.productStateDigest,
    atlasStateDigest: REPOSITORY_DIGESTS.atlasStateDigest,
    atlasResolutionDigest: REPOSITORY_DIGESTS.atlasResolutionDigest,
    atlasNormalizedModelDigest: REPOSITORY_DIGESTS.atlasNormalizedModelDigest,
    atlasResourceBindingsDigest: REPOSITORY_DIGESTS.atlasResourceBindingsDigest,
  });
  return Object.freeze({
    repository: Object.freeze({
      path: loaded.repository,
      contract: loaded.contract,
      commit: loaded.epoch.commit,
      tree: loaded.epoch.tree,
      objectFormat: loaded.epoch.objectFormat,
      productStateDigest: loaded.productState.digest,
      atlasStateDigest: loaded.atlasState.digest,
      atlasResolutionDigest: loaded.atlas.resolution.digest,
      atlasNormalizedModelDigest: loaded.atlas.resolution.normalizedModelDigest,
      atlasResourceBindingsDigest: loaded.atlas.resolution.resourceBindingsDigest,
    }),
    records: Object.freeze([]),
    currentRecords: Object.freeze([]),
    historicalRecords: Object.freeze([]),
    relationships: Object.freeze([]),
    coverage: Object.freeze([]),
    exemptions: Object.freeze([]),
    bindings: Object.freeze([]),
    sources: Object.freeze([]),
    conflicts: Object.freeze([]),
    validation,
    manifest: Object.freeze({
      repository,
      complete: true,
      valid: true,
      digest: REPOSITORY_DIGESTS.knowledgeSetDigest,
    }),
    index: Object.freeze({}),
  }) as unknown as FoundationKnowledgeSet;
}

type Fixture = Readonly<{
  boundary: ControlRecordRevision;
  loaded: FoundationLoadedRepositoryEpoch;
  knowledge: FoundationKnowledgeSet;
  snapshot: FoundationLoadedRepositorySnapshot;
}>;

function fixture(options: Readonly<{
  basis?: Readonly<Record<string, unknown>>;
  boundary?: ControlRecordRevision;
  snapshot?: FoundationRepositorySnapshot;
}> = {}): Fixture {
  const loaded = epoch();
  const knowledge = validKnowledge(loaded);
  return Object.freeze({
    boundary: options.boundary ?? boundary(options.basis),
    loaded,
    knowledge,
    snapshot: Object.freeze({
      ...loaded,
      snapshot: options.snapshot ?? BASE_SNAPSHOT,
    }),
  });
}

type Calls = {
  load: number;
  knowledge: number;
  bind: number;
};

function owners(
  selected: Fixture,
  calls: Calls,
  options: Readonly<{
    knowledgeResult?: FoundationKnowledgeSetResult;
  }> = {},
): FoundationDeliveryQueryBasisOwners {
  return Object.freeze({
    loadRepositoryEpochAtCommit: async (target, commit) => {
      calls.load += 1;
      assert.equal(target, TARGET_PATH);
      assert.equal(
        commit,
        (selected.boundary.payload.basis as Readonly<Record<string, unknown>>).productBaseCommit,
      );
      return selected.loaded;
    },
    validateKnowledgeSet: async (loaded) => {
      calls.knowledge += 1;
      assert.equal(loaded, selected.loaded);
      return options.knowledgeResult ?? Object.freeze({
        validation: selected.knowledge.validation,
        observation: selected.knowledge,
        knowledgeSet: selected.knowledge,
      });
    },
    bindHistoricalRepositorySnapshot: async (loaded, knowledge) => {
      calls.bind += 1;
      assert.equal(loaded, selected.loaded);
      assert.equal(knowledge, selected.knowledge);
      return selected.snapshot;
    },
  });
}

function store(
  selected: ControlRecordRevision | null,
  options: Readonly<{
    active?: ControlRecordRevision | null;
    retained?: ControlRecordRevision | null;
  }> = {},
): ControlRecordStore {
  const reference = (value: ControlRecordRevision | null) => value === null ? null : Object.freeze({
    id: value.recordId,
    revision: value.revision,
    digest: value.digest,
  });
  const active = options.active ?? null;
  return {
    identity: Object.freeze({ storeId: STORE, processId: PROCESS, targetId: TARGET }),
    state: () => ({
      subjects: Object.freeze({
        proposedBoundary: reference(selected),
        activeBoundary: reference(active),
      }),
    }),
    getRevision: () => options.retained === undefined ? selected ?? active : options.retained,
  } as unknown as ControlRecordStore;
}

async function rejectsCode(action: () => Promise<unknown>, suffix: string): Promise<void> {
  await assert.rejects(action, (error: unknown) => (
    error instanceof FoundationError && error.code === `lifecycle.delivery-query-basis.${suffix}`
  ));
}

test("query basis selects the proposed Work Boundary before the active boundary and reopens only its historical basis", async () => {
  const selected = fixture();
  const active = boundary(retainedBasis(), {
    recordId: "work-boundary-active",
    revision: 1,
    digest: valueDigest("active-boundary"),
  });
  const calls = { load: 0, knowledge: 0, bind: 0 };
  const result = await compileFoundationDeliveryQueryBasis({
    target: TARGET_PATH,
    store: store(selected.boundary, { active }),
    owners: owners(selected, calls),
  });
  assert.equal(result.boundaryRole, "proposed");
  assert.equal(result.boundary, selected.boundary);
  assert.equal(result.knowledge, selected.knowledge);
  assert.equal(result.repository.snapshot, selected.snapshot.snapshot);
  assert.deepEqual(calls, { load: 1, knowledge: 1, bind: 1 });
});

test("query basis falls back to the active Work Boundary when no proposal is pending", async () => {
  const selected = fixture();
  const calls = { load: 0, knowledge: 0, bind: 0 };
  const result = await compileFoundationDeliveryQueryBasis({
    target: TARGET_PATH,
    store: store(null, { active: selected.boundary }),
    owners: owners(selected, calls),
  });
  assert.equal(result.boundaryRole, "active");
  assert.equal(result.boundary, selected.boundary);
  assert.deepEqual(calls, { load: 1, knowledge: 1, bind: 1 });
});

test("query basis refuses an absent or substituted current Work Boundary before physical loading", async () => {
  const selected = fixture();
  const calls = { load: 0, knowledge: 0, bind: 0 };
  await rejectsCode(() => compileFoundationDeliveryQueryBasis({
    target: TARGET_PATH,
    store: store(null),
    owners: owners(selected, calls),
  }), "boundary-absent");
  await rejectsCode(() => compileFoundationDeliveryQueryBasis({
    target: TARGET_PATH,
    store: store(selected.boundary, { retained: null }),
    owners: owners(selected, calls),
  }), "boundary-substituted");
  await rejectsCode(() => compileFoundationDeliveryQueryBasis({
    target: TARGET_PATH,
    store: store(selected.boundary, {
      retained: boundary(retainedBasis(), { digest: valueDigest("substituted-boundary") }),
    }),
    owners: owners(selected, calls),
  }), "boundary-substituted");
  const wrongTarget = boundary(retainedBasis(), {
    payload: Object.freeze({
      ...selected.boundary.payload,
      targetId: "another-target",
    }),
  });
  await rejectsCode(() => compileFoundationDeliveryQueryBasis({
    target: TARGET_PATH,
    store: store(wrongTarget),
    owners: owners(selected, calls),
  }), "boundary-substituted");
  assert.deepEqual(calls, { load: 0, knowledge: 0, bind: 0 });
});

test("query basis parses the retained repository basis as one closed current-coordinate object", async () => {
  const variants: Readonly<Record<string, unknown>>[] = [
    { ...retainedBasis(), unsupported: "field" },
    Object.fromEntries(Object.entries(retainedBasis()).filter(([key]) => key !== "productBaseTree")),
    { ...retainedBasis(), specificationRevision: "lifecycle.foundation.1.0.0-rc.9" },
    { ...retainedBasis(), repositoryContract: "lifecycle.repository.v14" },
    { ...retainedBasis(), providerAdapter: "lifecycle.provider-adapter.v5" },
    { ...retainedBasis(), productBaseCommit: "not-a-git-object" },
    { ...retainedBasis(), productStateDigest: "not-a-digest" },
  ];
  for (const basis of variants) {
    const selected = fixture({ basis });
    const calls = { load: 0, knowledge: 0, bind: 0 };
    await rejectsCode(() => compileFoundationDeliveryQueryBasis({
      target: TARGET_PATH,
      store: store(selected.boundary),
      owners: owners(selected, calls),
    }), "basis-invalid");
    assert.deepEqual(calls, { load: 0, knowledge: 0, bind: 0 });
  }
});

test("query basis compares every retained repository identity and digest", async () => {
  const variants = Object.freeze([
    ["productBaseCommit", "c".repeat(40), "repository-basis-mismatch"],
    ["productBaseTree", "d".repeat(40), "repository-basis-mismatch"],
    ["productStateDigest", valueDigest("other-product-state"), "repository-basis-mismatch"],
    ["atlasStateDigest", valueDigest("other-atlas-state"), "repository-basis-mismatch"],
    ["atlasResolutionDigest", valueDigest("other-atlas-resolution"), "repository-basis-mismatch"],
    ["atlasNormalizedModelDigest", valueDigest("other-atlas-model"), "repository-basis-mismatch"],
    ["atlasResourceBindingsDigest", valueDigest("other-atlas-bindings"), "repository-basis-mismatch"],
    ["repositoryContractDigest", valueDigest("other-contract"), "repository-basis-mismatch"],
    ["knowledgeSetDigest", valueDigest("other-knowledge"), "knowledge-basis-mismatch"],
    ["repositorySnapshotDigest", valueDigest("other-snapshot"), "snapshot-basis-mismatch"],
  ] as const);
  for (const [field, value, code] of variants) {
    const selected = fixture({ basis: retainedBasis({ [field]: value }) });
    const calls = { load: 0, knowledge: 0, bind: 0 };
    await rejectsCode(() => compileFoundationDeliveryQueryBasis({
      target: TARGET_PATH,
      store: store(selected.boundary),
      owners: owners(selected, calls),
    }), code);
  }
});

test("query basis refuses invalid reproduced Knowledge before snapshot binding", async () => {
  const selected = fixture();
  const calls = { load: 0, knowledge: 0, bind: 0 };
  const invalidValidation = Object.freeze({
    complete: true,
    valid: false,
    digest: valueDigest("invalid-knowledge"),
  }) as FoundationValidationResult;
  await rejectsCode(() => compileFoundationDeliveryQueryBasis({
    target: TARGET_PATH,
    store: store(selected.boundary),
    owners: owners(selected, calls, {
      knowledgeResult: Object.freeze({
        validation: invalidValidation,
        observation: selected.knowledge,
        knowledgeSet: null,
      }),
    }),
  }), "knowledge-invalid");
  assert.deepEqual(calls, { load: 1, knowledge: 1, bind: 0 });
});

test("query basis refuses a substituted bound Repository Snapshot even when its digest is internally valid", async () => {
  const substituted = repositorySnapshot({
    productStateDigest: valueDigest("substituted-snapshot-product-state"),
  });
  const selected = fixture({ snapshot: substituted });
  const calls = { load: 0, knowledge: 0, bind: 0 };
  await rejectsCode(() => compileFoundationDeliveryQueryBasis({
    target: TARGET_PATH,
    store: store(selected.boundary),
    owners: owners(selected, calls),
  }), "snapshot-basis-mismatch");
  assert.deepEqual(calls, { load: 1, knowledge: 1, bind: 1 });
});
