import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  materializeCandidateRevisionCarrier,
  verifyCandidateRevisionCarrierMaterialization,
} from "../../src/foundation/candidate/carrier-materialization.js";
import {
  compileCandidateRevisionCarrierManifest,
  parseCandidateRevisionCarrierManifest,
} from "../../src/foundation/candidate/carrier-manifest.js";
import {
  openCandidateRevisionCarrier,
  prepareCandidateRevisionCarrier,
  publishCandidateRevisionCarrier,
} from "../../src/foundation/candidate/carrier-store.js";
import {
  FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
  FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
} from "../../src/foundation/candidate/carrier-types.js";
import { FoundationError } from "../../src/foundation/error.js";
import { git } from "../../src/foundation/repository/git.js";
import { canonicalJson } from "../../src/foundation/validation/canonical.js";

type Fixture = Readonly<{
  root: string;
  repository: string;
  machineHome: string;
  materializations: string;
  rootTree: string;
}>;

async function fixture(): Promise<Fixture> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-carrier-")));
  const repository = join(root, "target");
  const machineHome = join(root, "machine");
  const materializations = join(root, "cells");
  await mkdir(repository, { mode: 0o700 });
  await mkdir(machineHome, { mode: 0o700 });
  await mkdir(materializations, { mode: 0o700 });
  await chmod(machineHome, 0o700);
  await chmod(materializations, 0o700);
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["config", "user.name", "Lifecycle Test"]);
  await git(repository, ["config", "user.email", "lifecycle@example.invalid"]);
  await mkdir(join(repository, "nested"), { mode: 0o700 });
  await mkdir(join(repository, "bin"), { mode: 0o700 });
  await writeFile(join(repository, "product.txt"), "candidate\n", "utf8");
  await writeFile(join(repository, "nested", "binary.dat"), Buffer.from([0, 1, 2, 255]));
  await writeFile(join(repository, "empty.txt"), Buffer.alloc(0));
  await writeFile(join(repository, "bin", "tool"), "#!/bin/sh\nexit 0\n", "utf8");
  await chmod(join(repository, "bin", "tool"), 0o755);
  await git(repository, ["add", "--", "."]);
  const rootTree = (await git(repository, ["write-tree"])).stdout.trim();
  return Object.freeze({ root, repository, machineHome, materializations, rootTree });
}

async function published(value: Fixture) {
  const prepared = await prepareCandidateRevisionCarrier({
    machineHome: value.machineHome,
    repository: value.repository,
    rootTree: value.rootTree,
  });
  return await publishCandidateRevisionCarrier({
    machineHome: value.machineHome,
    prepared,
  });
}

test("Candidate Revision Carrier compiles one deterministic exact Git closure", async (context) => {
  const value = await fixture();
  context.after(async () => rm(value.root, { recursive: true, force: true }));
  const firstPrepared = await prepareCandidateRevisionCarrier({
    machineHome: value.machineHome,
    repository: value.repository,
    rootTree: value.rootTree,
  });
  const secondPrepared = await prepareCandidateRevisionCarrier({
    machineHome: value.machineHome,
    repository: value.repository,
    rootTree: value.rootTree,
  });

  assert.equal(
    FOUNDATION_CANDIDATE_REVISION_CARRIER_MANIFEST_MEDIA_TYPE,
    "application/vnd.lifecycle.candidate-revision-carrier-manifest+json",
  );
  assert.equal(firstPrepared.manifest.rootTree, value.rootTree);
  assert.equal(
    firstPrepared.manifest.objectCount,
    firstPrepared.manifest.objectInventory.length,
  );
  assert.equal(
    firstPrepared.manifest.aggregateObjectBytes,
    firstPrepared.manifest.objectInventory.reduce((sum, object) => sum + object.byteLength, 0),
  );
  assert.deepEqual(firstPrepared.manifest, secondPrepared.manifest);
  assert.equal(
    Buffer.from(firstPrepared.manifestBytes).toString("utf8"),
    canonicalJson(firstPrepared.manifest),
  );
  assert.deepEqual(
    parseCandidateRevisionCarrierManifest(
      firstPrepared.manifestBytes,
      FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
    ),
    firstPrepared.manifest,
  );
  const serialized = Buffer.from(firstPrepared.manifestBytes).toString("utf8");
  assert(!serialized.includes(value.root));
  assert(!serialized.includes(value.repository));
  assert(!serialized.includes(value.machineHome));
  await assert.rejects(
    openCandidateRevisionCarrier({
      machineHome: value.machineHome,
      manifestBytes: firstPrepared.manifestBytes,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.candidate.carrier-unavailable",
  );

  const first = await publishCandidateRevisionCarrier({
    machineHome: value.machineHome,
    prepared: firstPrepared,
  });
  const firstRetryAfterMovedStaging = await publishCandidateRevisionCarrier({
    machineHome: value.machineHome,
    prepared: firstPrepared,
  });
  const second = await publishCandidateRevisionCarrier({
    machineHome: value.machineHome,
    prepared: secondPrepared,
  });
  assert.deepEqual(firstRetryAfterMovedStaging, first);
  assert.deepEqual(first, second);
  assert.deepEqual(Object.keys(first).sort(), ["manifest", "manifestBytes"]);
  assert.equal((await openCandidateRevisionCarrier({
    machineHome: value.machineHome,
    manifestBytes: first.manifestBytes,
  })).manifest.digest, first.manifest.digest);
});

test("Candidate Revision Carrier rejects links and every reachable empty tree", async (context) => {
  const value = await fixture();
  context.after(async () => rm(value.root, { recursive: true, force: true }));
  await rm(join(value.repository, "product.txt"));
  await symlink("empty.txt", join(value.repository, "product.txt"));
  await git(value.repository, ["add", "--", "product.txt"]);
  const linkedTree = (await git(value.repository, ["write-tree"])).stdout.trim();
  await assert.rejects(
    prepareCandidateRevisionCarrier({
      machineHome: value.machineHome,
      repository: value.repository,
      rootTree: linkedTree,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.candidate.carrier-invalid",
  );

  const emptyTree = (await git(value.repository, ["mktree"], { input: "" })).stdout.trim();
  const rootWithEmptyDirectory = (await git(value.repository, ["mktree"], {
    input: `040000 tree ${emptyTree}\tempty-directory\n`,
  })).stdout.trim();
  await assert.rejects(
    prepareCandidateRevisionCarrier({
      machineHome: value.machineHome,
      repository: value.repository,
      rootTree: rootWithEmptyDirectory,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.candidate.carrier-invalid" &&
      error.message.includes("empty reachable tree"),
  );
});

test("Candidate Revision Carrier manifest codec rejects a declared zero-byte tree", () => {
  const rootTree = "a".repeat(40);
  assert.throws(
    () => compileCandidateRevisionCarrierManifest({
      objectFormat: "sha1",
      rootTree,
      objectInventory: Object.freeze([Object.freeze({
        objectId: rootTree,
        objectType: "tree" as const,
        byteLength: 0,
      })]),
      carrierArtifact: Object.freeze({
        format: "git-pack-v2",
        byteLength: 1,
        digest: `sha256:${"b".repeat(64)}`,
      }),
      limits: FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.candidate.carrier-invalid" &&
      error.message.includes("empty tree object"),
  );
});

test("Candidate Revision Carrier refuses nested and symlink-aliased repository paths", async (context) => {
  const value = await fixture();
  context.after(async () => rm(value.root, { recursive: true, force: true }));
  await assert.rejects(
    prepareCandidateRevisionCarrier({
      machineHome: value.machineHome,
      repository: join(value.repository, "nested"),
      rootTree: value.rootTree,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.candidate.carrier-invalid" &&
      error.message.includes("exact Git worktree root"),
  );
  await assert.rejects(stat(join(value.machineHome, "candidate-revision-carriers")), {
    code: "ENOENT",
  });

  const alias = join(value.root, "target-alias");
  await symlink(value.repository, alias, "dir");
  await assert.rejects(
    prepareCandidateRevisionCarrier({
      machineHome: value.machineHome,
      repository: alias,
      rootTree: value.rootTree,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.candidate.carrier-invalid" &&
      error.message.includes("canonical physical directory"),
  );
  await assert.rejects(stat(join(value.machineHome, "candidate-revision-carriers")), {
    code: "ENOENT",
  });
});

test("Candidate Revision Carrier removes its exact staging root after post-creation failure", async (context) => {
  const value = await fixture();
  context.after(async () => rm(value.root, { recursive: true, force: true }));
  await assert.rejects(
    prepareCandidateRevisionCarrier({
      machineHome: value.machineHome,
      repository: value.repository,
      rootTree: value.rootTree,
      limits: Object.freeze({
        ...FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
        maximumCarrierArtifactBytes: 1,
      }),
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.candidate.carrier-invalid" &&
      error.message.includes("artifact is outside its byte bound"),
  );
  assert.deepEqual(
    await readdir(join(
      value.machineHome,
      "candidate-revision-carriers",
      "v1",
      "staging",
    )),
    [],
  );
});

test("Candidate Revision Carrier never chmods an unknown preexisting Store path", async (context) => {
  const value = await fixture();
  context.after(async () => rm(value.root, { recursive: true, force: true }));
  const unknown = join(value.root, "unknown-store-target");
  await mkdir(unknown, { mode: 0o751 });
  await chmod(unknown, 0o751);
  await symlink(unknown, join(value.machineHome, "candidate-revision-carriers"));

  await assert.rejects(
    prepareCandidateRevisionCarrier({
      machineHome: value.machineHome,
      repository: value.repository,
      rootTree: value.rootTree,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.candidate.carrier-invalid",
  );
  assert.equal((await stat(unknown)).mode & 0o7777, 0o751);
});

test("Candidate Revision Carrier materializes independent exact trees without Git state", async (context) => {
  const value = await fixture();
  context.after(async () => rm(value.root, { recursive: true, force: true }));
  const carrier = await published(value);
  const firstRoot = join(value.materializations, "attempt-one");
  const secondRoot = join(value.materializations, "attempt-two");
  const first = await materializeCandidateRevisionCarrier({
    machineHome: value.machineHome,
    manifestBytes: carrier.manifestBytes,
    destination: firstRoot,
  });
  assert.equal(first.rootTree, value.rootTree);
  assert.equal(first.fileCount, 4);
  assert.equal(await readFile(join(firstRoot, "product.txt"), "utf8"), "candidate\n");
  assert.deepEqual(await readFile(join(firstRoot, "nested", "binary.dat")), Buffer.from([0, 1, 2, 255]));
  assert.equal((await stat(join(firstRoot, "bin", "tool"))).mode & 0o7777, 0o755);
  await assert.rejects(stat(join(firstRoot, ".git")), { code: "ENOENT" });

  await writeFile(join(firstRoot, "product.txt"), "provisional mutation\n", "utf8");
  await materializeCandidateRevisionCarrier({
    machineHome: value.machineHome,
    manifestBytes: carrier.manifestBytes,
    destination: secondRoot,
  });
  assert.equal(await readFile(join(secondRoot, "product.txt"), "utf8"), "candidate\n");
  assert.equal(await readFile(join(firstRoot, "product.txt"), "utf8"), "provisional mutation\n");
  await assert.rejects(
    materializeCandidateRevisionCarrier({
      machineHome: value.machineHome,
      manifestBytes: carrier.manifestBytes,
      destination: secondRoot,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.candidate.materialization-invalid",
  );
});

test("Candidate materialization bounds physical enumeration before collecting extra entries", async (context) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-carrier-enumeration-")));
  context.after(async () => rm(root, { recursive: true, force: true }));
  await chmod(root, 0o700);
  await writeFile(join(root, "expected.txt"), "x", { mode: 0o644 });
  await writeFile(join(root, "extra.txt"), "y", { mode: 0o644 });

  await assert.rejects(
    verifyCandidateRevisionCarrierMaterialization({
      root,
      objectFormat: "sha1",
      treeEntries: Object.freeze([Object.freeze({
        path: "expected.txt",
        objectId: "a".repeat(40),
        mode: "100644" as const,
        byteLength: 1,
      })]),
      limits: Object.freeze({
        ...FOUNDATION_CANDIDATE_REVISION_CARRIER_LIMITS_V1,
        maximumTreeEntries: 1,
      }),
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.candidate.materialization-invalid" &&
      error.message.includes("Carrier-derived physical-entry bound"),
  );
});

test("Candidate Revision Carrier refuses noncanonical manifest and missing or changed Store bytes", async (context) => {
  const value = await fixture();
  context.after(async () => rm(value.root, { recursive: true, force: true }));
  const carrier = await published(value);
  await assert.rejects(
    openCandidateRevisionCarrier({
      machineHome: value.machineHome,
      manifestBytes: Buffer.from(`${Buffer.from(carrier.manifestBytes).toString("utf8")}\n`, "utf8"),
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.candidate.carrier-invalid",
  );

  const opened = await openCandidateRevisionCarrier({
    machineHome: value.machineHome,
    manifestBytes: carrier.manifestBytes,
  });
  await writeFile(opened.artifactPath, "not a Git pack", { mode: 0o600 });
  await chmod(opened.artifactPath, 0o600);
  await assert.rejects(
    openCandidateRevisionCarrier({
      machineHome: value.machineHome,
      manifestBytes: carrier.manifestBytes,
    }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.candidate.carrier-invalid",
  );
});
