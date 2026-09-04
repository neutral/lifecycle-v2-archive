import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  lstat,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  candidateRevisionCarrierVerifier,
  candidateRevisionCarrierVerifierFromWorkBoundary,
  publishCandidateRevisionCarrierFromGitTree,
} from "../../src/foundation/candidate/carrier-binding.js";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_STATE_OBSERVER_V1,
  observeCandidateRevisionCarrierState,
  type CandidateRevisionCarrierAdmittedContext,
  withCandidateRevisionCarrierStateRepository,
} from "../../src/foundation/candidate/carrier-state-observer.js";
import { openCandidateRevisionCarrier } from "../../src/foundation/candidate/carrier-store.js";
import type { ControlRecordStore } from "../../src/foundation/control/store.js";
import type { ControlRecordRevision } from "../../src/foundation/control/types.js";
import {
  FOUNDATION_PROVIDER_PROTOCOL,
  FOUNDATION_REPOSITORY_SCHEMA,
  FOUNDATION_SPECIFICATION_REVISION,
  FOUNDATION_WORK_BOUNDARY_PAYLOAD_SCHEMA,
} from "../../src/foundation/constants.js";
import { FoundationError } from "../../src/foundation/error.js";
import { loadKnowledgeSet } from "../../src/foundation/knowledge/knowledge-set.js";
import { git } from "../../src/foundation/repository/git.js";
import {
  FOUNDATION_REPOSITORY_CONTRACT_PATH,
} from "../../src/foundation/repository/contract.js";
import { initializeRepository } from "../../src/foundation/repository/initialize.js";
import {
  bindRepositorySnapshot,
  loadRepositoryEpoch,
} from "../../src/foundation/repository/snapshot.js";
import type {
  FoundationLoadedRepositoryEpoch,
  FoundationLoadedRepositorySnapshot,
} from "../../src/foundation/repository/types.js";
import {
  digestCanonical,
  sha256Bytes,
} from "../../src/foundation/validation/canonical.js";
import { writeMinimalAtlas } from "../helpers/atlas-fixture.js";

const SECRET = "carrier-state-observer-test-secret-at-least-thirty-two-bytes";
const PUBLICATION_DIGEST = sha256Bytes("carrier-state-observer-publication");

async function write(root: string, path: string, contents: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), contents, "utf8");
}

function description(): string {
  const frontMatter = {
    schema: "lifecycle.knowledge-record.v1",
    kind: "description",
    id: "description.carrier-state-observer",
    title: "Carrier state observer fixture",
    status: "current",
    revision: 1,
    supersedes: null,
    summary: "Own the complete Carrier-state observation fixture source tree.",
    owners: ["founder"],
    sources: [],
    relationships: [],
    conflicts: [],
    tags: [],
    spec: {
      responsibility: "Own the Carrier-state observation fixture source tree.",
      coverage: [{ path: "src", mode: "tree", role: "primary", exclude: [] }],
      behavior: ["exposes exact fixture values"],
      boundaries: ["contains no Delivery Control"],
      invariants: ["remains ordinary tracked source"],
      dependencies: [],
      failure: ["a Carrier-selected source path is missing or substituted"],
      rationale: ["one Description owns the small fixture tree"],
    },
  };
  return `---\n${JSON.stringify(frontMatter, null, 2)}\n---\n\n# Carrier state observer fixture\n\n## Responsibility\n\nOwn the source fixture.\n\n## Behavior\n\nExpose exact values.\n\n## Boundaries\n\nNo Delivery Control.\n\n## Rationale\n\nKeep the test bounded.\n`;
}

type Fixture = Readonly<{
  root: string;
  target: string;
  machineHome: string;
  candidateSourceRoot: string;
  loaded: FoundationLoadedRepositoryEpoch;
  snapshot: FoundationLoadedRepositorySnapshot;
  admitted: CandidateRevisionCarrierAdmittedContext;
}>;

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "lifecycle-carrier-state-observer-"));
  const target = join(root, "target");
  const authorityHome = join(root, "authority");
  const machineHome = join(root, "machine");
  await mkdir(target, { mode: 0o700 });
  await mkdir(authorityHome, { mode: 0o700 });
  await mkdir(machineHome, { mode: 0o700 });
  await chmod(machineHome, 0o700);
  await git(target, ["init", "-b", "main"]);
  await git(target, ["config", "user.name", "Lifecycle Test"]);
  await git(target, ["config", "user.email", "lifecycle@example.invalid"]);
  await writeMinimalAtlas(target);
  await write(target, ".gitignore", "node_modules/\n");
  await git(target, ["add", "--", "atlas", ".gitignore"]);
  await git(target, ["commit", "-m", "Initialize target"]);
  await initializeRepository(target, {
    targetId: "carrier-state-observer-target",
    founderPrincipal: "founder",
    home: authorityHome,
    authoritySecret: SECRET,
    publicationDigest: PUBLICATION_DIGEST,
    implementationRoots: ["src"],
    stage: true,
  });
  await write(target, "src/current.ts", "export const current = 1;\n");
  await write(target, "src/remove.ts", "export const removed = true;\n");
  await write(target, "src/_source.desc.md", description());
  await git(target, ["add", "--", "."]);
  await git(target, ["commit", "-m", "Create governed Candidate base"]);
  const loaded = await loadRepositoryEpoch(target);
  const knowledge = await loadKnowledgeSet(loaded);
  const snapshot = await bindRepositorySnapshot(loaded, knowledge);
  const admitted: CandidateRevisionCarrierAdmittedContext = Object.freeze({
    repository: loaded.repository,
    contract: loaded.contract,
    epoch: loaded.epoch,
    productStateDigest: loaded.productState.digest,
    knowledgeSetDigest: snapshot.snapshot.knowledgeSetDigest,
    atlasState: loaded.atlasState,
    atlas: loaded.atlas,
  });
  const candidateSourceRoot = join(root, "candidate-source");
  await git(root, [
    "clone",
    "--no-local",
    "--no-hardlinks",
    target,
    candidateSourceRoot,
  ]);
  return Object.freeze({
    root,
    target,
    machineHome,
    candidateSourceRoot,
    loaded,
    snapshot,
    admitted,
  });
}

function retainedBoundary(value: Fixture): Readonly<{
  boundary: ControlRecordRevision;
  store: ControlRecordStore;
}> {
  const boundary = Object.freeze({
    recordId: "boundary-carrier-state-observer",
    recordKind: "work-boundary",
    revision: 1,
    digest: sha256Bytes("boundary-carrier-state-observer"),
    payload: Object.freeze({
      schema: FOUNDATION_WORK_BOUNDARY_PAYLOAD_SCHEMA,
      profileId: "lifecycle.work-boundary.foundation-v1",
      targetId: value.loaded.contract.targetId,
      basis: Object.freeze({
        specificationRevision: FOUNDATION_SPECIFICATION_REVISION,
        repositoryContract: FOUNDATION_REPOSITORY_SCHEMA,
        providerAdapter: FOUNDATION_PROVIDER_PROTOCOL,
        productBaseCommit: value.loaded.epoch.commit,
        productBaseTree: value.loaded.epoch.tree,
        productStateDigest: value.loaded.productState.digest,
        atlasStateDigest: value.loaded.atlasState.digest,
        atlasResolutionDigest: value.loaded.atlas.resolution.digest,
        atlasNormalizedModelDigest: value.loaded.atlas.resolution.normalizedModelDigest,
        atlasResourceBindingsDigest: value.loaded.atlas.resolution.resourceBindingsDigest,
        repositoryContractDigest: value.loaded.contract.digest,
        knowledgeSetDigest: value.snapshot.snapshot.knowledgeSetDigest,
        repositorySnapshotDigest: value.snapshot.snapshot.digest,
      }),
    }),
  }) as unknown as ControlRecordRevision;
  const store = Object.freeze({
    identity: Object.freeze({ targetId: value.loaded.contract.targetId }),
    getRevision: (recordId: string, revision: number) =>
      recordId === boundary.recordId && revision === boundary.revision
        ? boundary
        : null,
  }) as unknown as ControlRecordStore;
  return Object.freeze({ boundary, store });
}

async function publishIndexedCandidateTree(
  value: Fixture,
): Promise<Readonly<{ rootTree: string; manifestBytes: Uint8Array }>> {
  await git(value.candidateSourceRoot, ["add", "-A", "--", "."]);
  const rootTree = (await git(value.candidateSourceRoot, ["write-tree"]))
    .stdout.trim();
  const published = await publishCandidateRevisionCarrierFromGitTree({
    machineHome: value.machineHome,
    repository: value.candidateSourceRoot,
    rootTree,
  });
  return Object.freeze({ rootTree, manifestBytes: published.manifestBytes });
}

function assertLocatorFreeFailure(
  error: unknown,
  code: string,
  locators: readonly string[],
  failureClass = "foundation",
): boolean {
  assert(error instanceof FoundationError);
  assert.equal(error.code, code);
  const serialized = JSON.stringify(error.toJSON());
  for (const locator of locators) {
    assert.equal(
      serialized.includes(locator),
      false,
      `private locator must not enter the serialized failure: ${locator}`,
    );
  }
  assert.deepEqual(error.observedFacts, { failureClass });
  return true;
}

test("Carrier state observer independently reproduces the complete Candidate state", async (context) => {
  const value = await fixture();
  context.after(async () => await rm(value.root, { recursive: true, force: true }));
  const initialCarrier = await publishIndexedCandidateTree(value);
  const initial = await observeCandidateRevisionCarrierState({
    machineHome: value.machineHome,
    manifestBytes: initialCarrier.manifestBytes,
    admitted: value.admitted,
    predecessor: null,
  });
  await write(value.candidateSourceRoot, "src/current.ts", "export const current = 2;\n");
  await rm(join(value.candidateSourceRoot, "src/remove.ts"));
  await write(value.candidateSourceRoot, "src/added.ts", "export const added = true;\n");
  await write(value.candidateSourceRoot, "deliverable/report.txt", "bounded artifact\n");
  const carrier = await publishIndexedCandidateTree(value);

  await rm(value.candidateSourceRoot, { recursive: true, force: true });
  // The observer reopens the immutable admitted commit and must not sample
  // these live checkout bytes as Candidate input.
  await writeFile(
    join(value.target, "src/current.ts"),
    "export const uncommittedCanonicalValue = 99;\n",
    "utf8",
  );

  const first = await observeCandidateRevisionCarrierState({
    machineHome: value.machineHome,
    manifestBytes: carrier.manifestBytes,
    admitted: value.admitted,
    predecessor: Object.freeze({ candidateDigest: initial.state.candidateDigest }),
    evidence: Object.freeze({
      contentDigestPaths: Object.freeze(["deliverable/report.txt", "src/added.ts"]),
    }),
  });
  const second = await observeCandidateRevisionCarrierState({
    machineHome: value.machineHome,
    manifestBytes: carrier.manifestBytes,
    admitted: value.admitted,
    predecessor: Object.freeze({ candidateDigest: initial.state.candidateDigest }),
    evidence: Object.freeze({
      contentDigestPaths: Object.freeze(["deliverable/report.txt", "src/added.ts"]),
    }),
  });
  const verified = await candidateRevisionCarrierVerifier({
    machineHome: value.machineHome,
    admitted: value.admitted,
    predecessor: Object.freeze({ candidateDigest: initial.state.candidateDigest }),
  })({ manifestBytes: carrier.manifestBytes });
  const exactBoundary = retainedBoundary(value);
  const boundaryVerified = await (await candidateRevisionCarrierVerifierFromWorkBoundary({
    machineHome: value.machineHome,
    repository: value.target,
    store: exactBoundary.store,
    boundary: exactBoundary.boundary,
    predecessor: Object.freeze({ candidateDigest: initial.state.candidateDigest }),
  }))({ manifestBytes: carrier.manifestBytes });

  assert.equal(first.manifestFileDigest, sha256Bytes(carrier.manifestBytes));
  assert.equal(first.state.tree, carrier.rootTree);
  assert.equal(second.manifestFileDigest, first.manifestFileDigest);
  assert.deepEqual(second.state, first.state);
  assert.deepEqual(second.treeEntries, first.treeEntries);
  assert.notEqual(first.evidenceMaterial, undefined);
  assert.notEqual(second.evidenceMaterial, undefined);
  assert.deepEqual(
    second.evidenceMaterial!.baseTreeEntries,
    first.evidenceMaterial!.baseTreeEntries,
  );
  assert.equal(
    second.evidenceMaterial!.knowledge.manifest.digest,
    first.evidenceMaterial!.knowledge.manifest.digest,
  );
  assert.deepEqual(second.evidenceMaterial!.diff, first.evidenceMaterial!.diff);
  assert.deepEqual(
    second.evidenceMaterial!.contentDigests,
    first.evidenceMaterial!.contentDigests,
  );
  assert.deepEqual(first.evidenceMaterial!.contentDigests, [
    Object.freeze({
      path: "deliverable/report.txt",
      digest: sha256Bytes("bounded artifact\n"),
    }),
    Object.freeze({
      path: "src/added.ts",
      digest: sha256Bytes("export const added = true;\n"),
    }),
  ]);
  assert.equal(
    digestCanonical(first.treeEntries.map(({ path, mode, type, objectId }) =>
      Object.freeze({ path, mode, type, objectId }))),
    first.state.pathInventoryDigest,
  );
  assert(first.treeEntries.some(({ path }) => path === "deliverable/report.txt"));
  assert(first.treeEntries.some(({ path }) => path === "src/added.ts"));
  assert.equal(first.treeEntries.some(({ path }) => path === "src/remove.ts"), false);
  for (const value of [verified, boundaryVerified]) {
    assert.equal(value.manifestFileDigest, first.manifestFileDigest);
    assert.deepEqual(value.state, first.state);
    assert.deepEqual(value.observer, {
      implementationId: FOUNDATION_CANDIDATE_REVISION_CARRIER_STATE_OBSERVER_V1.id,
      implementationDigest:
        FOUNDATION_CANDIDATE_REVISION_CARRIER_STATE_OBSERVER_V1.implementationDigest,
    });
  }
  assert.equal(first.state.unchangedFromPredecessor, false);
  assert.deepEqual(first.state.changedSubjects.map(({ path, change }) => ({ path, change })), [
    { path: "deliverable/report.txt", change: "added" },
    { path: "src/added.ts", change: "added" },
    { path: "src/current.ts", change: "modified" },
    { path: "src/remove.ts", change: "deleted" },
  ]);
  assert.match(
    FOUNDATION_CANDIDATE_REVISION_CARRIER_STATE_OBSERVER_V1.implementationDigest,
    /^sha256:[a-f0-9]{64}$/u,
  );
  assert.equal(
    await readFile(join(value.target, "src/current.ts"), "utf8"),
    "export const uncommittedCanonicalValue = 99;\n",
  );
  assert.deepEqual(
    await readdir(join(
      value.machineHome,
      "candidate-revision-carriers",
      "v1",
      "verification",
    )),
    [],
    "fresh verification and materialization views must not become continuity",
  );
});

test("scoped Carrier state repository is removed on success and exact callback failure", async (context) => {
  const value = await fixture();
  context.after(async () => await rm(value.root, { recursive: true, force: true }));
  await write(value.candidateSourceRoot, "src/current.ts", "export const current = 2;\n");
  const carrier = await publishIndexedCandidateTree(value);
  const verificationRoot = join(
    value.machineHome,
    "candidate-revision-carriers",
    "v1",
    "verification",
  );

  let successRepository = "";
  const observedDigest = await withCandidateRevisionCarrierStateRepository({
    machineHome: value.machineHome,
    manifestBytes: carrier.manifestBytes,
    admitted: value.admitted,
    predecessor: null,
  }, async (repository, observation) => {
    successRepository = repository;
    assert.equal(
      (await git(repository, ["cat-file", "-t", observation.state.tree])).stdout.trim(),
      "tree",
    );
    assert((await readdir(verificationRoot)).length > 0);
    return observation.state.candidateDigest;
  });
  assert.match(observedDigest, /^sha256:[a-f0-9]{64}$/u);
  await assert.rejects(lstat(successRepository), { code: "ENOENT" });
  assert.deepEqual(await readdir(verificationRoot), []);

  const callbackFailure = new Error("exact scoped Carrier callback failure");
  let failedRepository = "";
  await assert.rejects(
    withCandidateRevisionCarrierStateRepository({
      machineHome: value.machineHome,
      manifestBytes: carrier.manifestBytes,
      admitted: value.admitted,
      predecessor: null,
    }, async (repository) => {
      failedRepository = repository;
      assert((await readdir(verificationRoot)).length > 0);
      throw callbackFailure;
    }),
    (error: unknown) => error === callbackFailure,
  );
  await assert.rejects(lstat(failedRepository), { code: "ENOENT" });
  assert.deepEqual(await readdir(verificationRoot), []);
});

test("Carrier state observer refuses substituted admitted context", async (context) => {
  const value = await fixture();
  context.after(async () => await rm(value.root, { recursive: true, force: true }));
  const carrier = await publishIndexedCandidateTree(value);
  const exactBoundary = retainedBoundary(value);
  const forgedBoundary = Object.freeze({
    ...exactBoundary.boundary,
    payload: Object.freeze({
      ...exactBoundary.boundary.payload,
      basis: Object.freeze({
        ...(exactBoundary.boundary.payload.basis as Readonly<Record<string, unknown>>),
        knowledgeSetDigest: sha256Bytes("forged Work Boundary Knowledge Set"),
      }),
    }),
  }) as ControlRecordRevision;

  await assert.rejects(
    candidateRevisionCarrierVerifierFromWorkBoundary({
      machineHome: value.machineHome,
      repository: value.target,
      store: exactBoundary.store,
      boundary: forgedBoundary,
      predecessor: null,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.candidate.carrier-admitted-context-invalid" &&
      error.message.includes("exact retained Work Boundary"),
  );

  await assert.rejects(
    observeCandidateRevisionCarrierState({
      machineHome: value.machineHome,
      manifestBytes: carrier.manifestBytes,
      admitted: Object.freeze({
        ...value.admitted,
        knowledgeSetDigest: sha256Bytes("different admitted Knowledge Set"),
      }),
      predecessor: null,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.candidate.carrier-state-invalid" &&
      error.message.includes("Knowledge Set"),
  );

  await assert.rejects(
    observeCandidateRevisionCarrierState({
      machineHome: value.machineHome,
      manifestBytes: carrier.manifestBytes,
      admitted: Object.freeze({
        ...value.admitted,
        epoch: Object.freeze({
          ...value.admitted.epoch,
          tree: carrier.rootTree === value.admitted.epoch.tree
            ? "0".repeat(value.admitted.epoch.objectFormat === "sha1" ? 40 : 64)
            : carrier.rootTree,
        }),
      }),
      predecessor: null,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.candidate.carrier-state-invalid" &&
      error.message.includes("base commit and tree"),
  );
});

test("Carrier admitted-context replay distinguishes absent and failed Store reads from invalid retained bytes", async (context) => {
  const value = await fixture();
  context.after(async () => await rm(value.root, { recursive: true, force: true }));
  const retained = retainedBoundary(value);
  const absentStore = Object.freeze({
    identity: retained.store.identity,
    getRevision: () => null,
  }) as unknown as ControlRecordStore;
  await assert.rejects(
    candidateRevisionCarrierVerifierFromWorkBoundary({
      machineHome: value.machineHome,
      repository: value.target,
      store: absentStore,
      boundary: retained.boundary,
      predecessor: null,
    }),
    (error: unknown) => assertLocatorFreeFailure(
      error,
      "lifecycle.candidate.carrier-admitted-context-unavailable",
      [value.root, value.target, value.machineHome],
    ),
  );

  const failedStore = Object.freeze({
    identity: retained.store.identity,
    getRevision: () => {
      throw Object.assign(
        new Error(`private Store failure at ${value.root}`),
        { code: "EIO" },
      );
    },
  }) as unknown as ControlRecordStore;
  await assert.rejects(
    candidateRevisionCarrierVerifierFromWorkBoundary({
      machineHome: value.machineHome,
      repository: value.target,
      store: failedStore,
      boundary: retained.boundary,
      predecessor: null,
    }),
    (error: unknown) => assertLocatorFreeFailure(
      error,
      "lifecycle.candidate.carrier-admitted-context-incomplete",
      [value.root, value.target, value.machineHome],
      "filesystem",
    ),
  );
});

test("Carrier state replay distinguishes corrupt exact bytes from unavailable Store bytes", async (context) => {
  for (const selected of ["corrupt", "absent"] as const) {
    await context.test(selected, async () => {
      const value = await fixture();
      try {
        const { manifestBytes } = await publishIndexedCandidateTree(value);
        const opened = await openCandidateRevisionCarrier({
          machineHome: value.machineHome,
          manifestBytes,
        });
        if (selected === "corrupt") {
          await writeFile(opened.artifactPath, "corrupt Carrier bytes", "utf8");
        } else {
          await rm(dirname(opened.artifactPath), { recursive: true, force: true });
        }
        await assert.rejects(
          observeCandidateRevisionCarrierState({
            machineHome: value.machineHome,
            manifestBytes,
            admitted: value.admitted,
            predecessor: null,
          }),
          (error: unknown) => {
            assert(error instanceof FoundationError);
            assert.equal(
              error.code,
              selected === "corrupt"
                ? "lifecycle.candidate.carrier-state-invalid"
                : "lifecycle.candidate.carrier-state-unavailable",
            );
            const serialized = JSON.stringify(error.toJSON());
            for (const locator of [value.root, value.target, value.machineHome]) {
              assert.equal(serialized.includes(locator), false);
            }
            if (selected === "corrupt") {
              assert.deepEqual(error.observedFacts, {
                failureCode: "lifecycle.candidate.carrier-invalid",
              });
            } else {
              assert.deepEqual(error.observedFacts, { failureClass: "foundation" });
            }
            return true;
          },
        );
      } finally {
        await rm(value.root, { recursive: true, force: true });
      }
    });
  }
});

test("Carrier state observer rejects a Carrier that changes admitted Atlas bytes", async (context) => {
  const value = await fixture();
  context.after(async () => await rm(value.root, { recursive: true, force: true }));
  const atlasPath = join(value.candidateSourceRoot, value.loaded.contract.atlas.entrypoint);
  await writeFile(
    atlasPath,
    `${await readFile(atlasPath, "utf8")}\n<!-- Candidate mutation -->\n`,
    "utf8",
  );
  await git(value.candidateSourceRoot, ["add", "--", value.loaded.contract.atlas.entrypoint]);
  const changedTree = (await git(value.candidateSourceRoot, ["write-tree"])).stdout.trim();
  const carrier = await publishCandidateRevisionCarrierFromGitTree({
    machineHome: value.machineHome,
    repository: value.candidateSourceRoot,
    rootTree: changedTree,
  });

  await assert.rejects(
    observeCandidateRevisionCarrierState({
      machineHome: value.machineHome,
      manifestBytes: carrier.manifestBytes,
      admitted: value.admitted,
      predecessor: null,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.candidate.carrier-state-invalid" &&
      error.message.includes("Atlas"),
  );
});

test("Carrier state observer rejects every Repository Contract substitution", async (context) => {
  const variants = [
    {
      label: "content",
      mutate: async (value: Fixture): Promise<void> => {
        const path = join(
          value.candidateSourceRoot,
          FOUNDATION_REPOSITORY_CONTRACT_PATH,
        );
        await writeFile(
          path,
          `${await readFile(path, "utf8")}\n`,
          "utf8",
        );
        await git(value.candidateSourceRoot, [
          "add",
          "--",
          FOUNDATION_REPOSITORY_CONTRACT_PATH,
        ]);
      },
    },
    {
      label: "mode",
      mutate: async (value: Fixture): Promise<void> => {
        const path = join(
          value.candidateSourceRoot,
          FOUNDATION_REPOSITORY_CONTRACT_PATH,
        );
        await chmod(path, 0o755);
        await git(value.candidateSourceRoot, [
          "add",
          "--",
          FOUNDATION_REPOSITORY_CONTRACT_PATH,
        ]);
      },
    },
    {
      label: "type",
      mutate: async (value: Fixture): Promise<void> => {
        const path = join(
          value.candidateSourceRoot,
          FOUNDATION_REPOSITORY_CONTRACT_PATH,
        );
        await rm(path);
        await mkdir(path);
        await writeFile(join(path, "substituted.json"), "{}\n", "utf8");
        await git(value.candidateSourceRoot, [
          "add",
          "-A",
          "--",
          FOUNDATION_REPOSITORY_CONTRACT_PATH,
        ]);
      },
    },
    {
      label: "deletion",
      mutate: async (value: Fixture): Promise<void> => {
        await rm(join(
          value.candidateSourceRoot,
          FOUNDATION_REPOSITORY_CONTRACT_PATH,
        ));
        await git(value.candidateSourceRoot, [
          "add",
          "-u",
          "--",
          FOUNDATION_REPOSITORY_CONTRACT_PATH,
        ]);
      },
    },
  ] as const;

  for (const variant of variants) {
    await context.test(variant.label, async () => {
      const value = await fixture();
      try {
        await variant.mutate(value);
        const { manifestBytes } = await publishIndexedCandidateTree(value);
        await assert.rejects(
          observeCandidateRevisionCarrierState({
            machineHome: value.machineHome,
            manifestBytes,
            admitted: value.admitted,
            predecessor: null,
          }),
          (error: unknown) => error instanceof FoundationError &&
            error.code === "lifecycle.candidate.carrier-state-invalid" &&
            error.message.includes("Repository Contract"),
        );
      } finally {
        await rm(value.root, { recursive: true, force: true });
      }
    });
  }
});

test("Carrier context and replay failures do not disclose private locators", async (context) => {
  const value = await fixture();
  context.after(async () => await rm(value.root, { recursive: true, force: true }));
  const carrier = await publishIndexedCandidateTree(value);
  const boundary = retainedBoundary(value);
  const verificationRoot = join(
    value.machineHome,
    "candidate-revision-carriers",
    "v1",
    "verification",
  );
  await chmod(verificationRoot, 0o755);
  try {
    await assert.rejects(
      candidateRevisionCarrierVerifierFromWorkBoundary({
        machineHome: value.machineHome,
        repository: value.target,
        store: boundary.store,
        boundary: boundary.boundary,
        predecessor: null,
      }),
      (error: unknown) => assertLocatorFreeFailure(
        error,
        "lifecycle.candidate.carrier-admitted-context-incomplete",
        [value.root, value.target, value.machineHome, verificationRoot],
      ),
    );
  } finally {
    await chmod(verificationRoot, 0o700);
  }

  const privateRepositoryLocator = join(
    value.root,
    "private-repository-locator",
  );
  await assert.rejects(
    observeCandidateRevisionCarrierState({
      machineHome: value.machineHome,
      manifestBytes: carrier.manifestBytes,
      admitted: Object.freeze({
        ...value.admitted,
        repository: privateRepositoryLocator,
      }),
      predecessor: null,
    }),
    (error: unknown) => assertLocatorFreeFailure(
      error,
      "lifecycle.candidate.carrier-state-observation-incomplete",
      [
        value.root,
        value.target,
        value.machineHome,
        privateRepositoryLocator,
      ],
    ),
  );
});
