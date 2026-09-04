import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  captureRepositoryPhysicalIdentity,
  verifyRepositoryPhysicalIdentity,
} from "../../src/foundation/repository/physical-identity.js";

test("repository physical identity binds the repository and Git common-directory nodes", async (context) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-physical-target-")));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const repository = join(root, "target");
  const gitCommonDirectory = join(repository, ".git");
  await mkdir(gitCommonDirectory, { recursive: true });

  const identity = captureRepositoryPhysicalIdentity({ repository, gitCommonDirectory });
  assert.equal(verifyRepositoryPhysicalIdentity(identity).digest, identity.digest);
  assert.notEqual(identity.subject.repository.inode, "");
  assert.notEqual(identity.subject.gitCommonDirectory.inode, "");
  assert(!JSON.stringify({ physicalIdentityDigest: identity.digest }).includes(repository));
});

test("repository physical identity rejects same-path directory replacement", async (context) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-physical-target-replaced-")));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const repository = join(root, "target");
  const gitCommonDirectory = join(root, "common-git");
  await mkdir(repository);
  await mkdir(gitCommonDirectory);
  const identity = captureRepositoryPhysicalIdentity({ repository, gitCommonDirectory });

  const displaced = join(root, "displaced-target");
  await rename(repository, displaced);
  await mkdir(repository);
  assert.throws(
    () => verifyRepositoryPhysicalIdentity(identity),
    /physical target changed identity/u,
  );
});

test("repository physical identity rejects symlink aliases", async (context) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-physical-target-symlink-")));
  context.after(async () => await rm(root, { recursive: true, force: true }));
  const repository = join(root, "target");
  const gitCommonDirectory = join(root, "common-git");
  await mkdir(repository);
  await mkdir(gitCommonDirectory);
  const alias = join(root, "target-alias");
  const { symlink } = await import("node:fs/promises");
  await symlink(repository, alias, "dir");

  assert.throws(
    () => captureRepositoryPhysicalIdentity({ repository: alias, gitCommonDirectory }),
    /physical directory/u,
  );
});
