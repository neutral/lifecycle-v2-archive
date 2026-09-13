import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { FoundationError } from "../../src/foundation/error.js";
import { receiveFoundationAuthorityCredential } from "../../src/foundation/repository/authority.js";
import { attachRepository, loadRepositoryContract } from "../../src/foundation/repository/contract.js";
import { canonicalRepository, git } from "../../src/foundation/repository/git.js";
import { assertIndependentGitRepository } from "../../src/foundation/repository/independent-git.js";
import { initializeRepository } from "../../src/foundation/repository/initialize.js";
import {
  loadRepositoryEpoch,
  loadRepositoryEpochAtCommit,
  loadRepositoryIdentityEpoch,
} from "../../src/foundation/repository/snapshot.js";
import { FOUNDATION_GENERATED_PUBLICATION_DIGEST } from "../../src/foundation/validation/generated-schemas.js";
import { writeMinimalAtlas } from "../helpers/atlas-fixture.js";

async function fixture(t: TestContext): Promise<Readonly<{ root: string; target: string; home: string }>> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-independent-git-")));
  t.after(async () => { await rm(root, { recursive: true, force: true }); });
  const target = join(root, "target");
  await mkdir(target);
  await git(target, ["init", "-b", "main"]);
  await git(target, ["config", "user.name", "Lifecycle Test"]);
  await git(target, ["config", "user.email", "lifecycle@example.invalid"]);
  await writeFile(join(target, "product.txt"), "exact independent product\n");
  await git(target, ["add", "--", "product.txt"]);
  await git(target, ["commit", "-m", "Create independent target"]);
  return Object.freeze({ root, target, home: join(root, "machine") });
}

function initialize(target: string, home: string) {
  return initializeRepository(target, {
    home,
    targetId: "independent-target",
    authorityCredential: receiveFoundationAuthorityCredential(
      "independent-repository-test-credential-only",
      "initialize",
    ),
    publicationDigest: FOUNDATION_GENERATED_PUBLICATION_DIGEST,
  });
}

function independenceFailure(error: unknown): boolean {
  return error instanceof FoundationError && error.code === "lifecycle.repository.physical" &&
    error.message.includes("independent repository");
}

test("an ordinary independent target initializes and reopens through every target owner", async (t) => {
  const { target, home } = await fixture(t);
  await writeMinimalAtlas(target);
  await git(target, ["add", "--", "atlas"]);
  await git(target, ["commit", "-m", "Author target Atlas"]);
  await assertIndependentGitRepository(target);
  const contract = await initialize(target, home);
  await git(target, ["commit", "-m", "Initialize Lifecycle target"]);
  const commit = (await git(target, ["rev-parse", "HEAD"])).stdout.trim();
  assert.equal((await attachRepository(target)).contract.digest, contract.digest);
  assert.equal((await loadRepositoryContract(target)).contract.digest, contract.digest);
  assert.equal((await loadRepositoryIdentityEpoch(target)).epoch.commit, commit);
  assert.equal((await loadRepositoryEpoch(target)).epoch.commit, commit);
  assert.equal((await loadRepositoryEpochAtCommit(target, commit)).epoch.commit, commit);
});

test("linked source worktrees remain discoverable but cannot initialize or reopen as Lifecycle targets", async (t) => {
  const { root, target, home } = await fixture(t);
  const linked = join(root, "linked");
  await git(target, ["worktree", "add", "-b", "linked-source", linked, "HEAD"]);
  const commit = (await git(target, ["rev-parse", "HEAD"])).stdout.trim();
  assert.equal(await canonicalRepository(linked), linked);
  // The primary checkout also shares its mutable administration with linked.
  await assert.rejects(assertIndependentGitRepository(target), independenceFailure);
  await assert.rejects(initialize(target, home), independenceFailure);
  for (const open of [
    () => assertIndependentGitRepository(linked),
    () => initialize(linked, home),
    () => attachRepository(linked),
    () => loadRepositoryContract(linked),
    () => loadRepositoryIdentityEpoch(linked),
    () => loadRepositoryEpoch(linked),
    () => loadRepositoryEpochAtCommit(linked, commit),
  ]) await assert.rejects(open, independenceFailure);
  await assert.rejects(readFile(join(linked, ".lifecycle/repository.json")), { code: "ENOENT" });
  await assert.rejects(realpath(home), { code: "ENOENT" });
  await git(target, ["worktree", "remove", linked]);
  await mkdir(join(target, ".git/worktrees"), { recursive: true });
  await assertIndependentGitRepository(target);
});

test("alternate object-store markers refuse before initialization or current-target reads", async (t) => {
  const { target, home } = await fixture(t);
  for (const marker of ["alternates", "http-alternates"]) {
    const path = join(target, ".git/objects/info", marker);
    // Even an empty marker selects the prohibited topology; existing objects
    // remain readable so the refusal cannot be explained by missing history.
    await writeFile(path, "");
    assert.equal(await canonicalRepository(target), target);
    await assert.rejects(assertIndependentGitRepository(target), independenceFailure);
    await assert.rejects(initialize(target, home), independenceFailure);
    await assert.rejects(loadRepositoryIdentityEpoch(target), independenceFailure);
    await rm(path);
    await assertIndependentGitRepository(target);
  }
});

test("Git metadata and selected refs cannot redirect to another physical owner", async (t) => {
  const { root, target } = await fixture(t);
  const selectedRef = join(target, ".git/refs/heads/main");
  const refBytes = await readFile(selectedRef);
  const sharedRef = join(root, "shared-ref");
  await writeFile(sharedRef, refBytes);
  await rm(selectedRef);
  await symlink(sharedRef, selectedRef);
  await assert.rejects(assertIndependentGitRepository(target), independenceFailure);
  await rm(selectedRef);
  await link(sharedRef, selectedRef);
  await assert.rejects(assertIndependentGitRepository(target), independenceFailure);
  await rm(selectedRef);
  await writeFile(selectedRef, refBytes);
  await assertIndependentGitRepository(target);

  const alias = join(target, ".git/refs/heads/alias");
  await writeFile(sharedRef, "ref: refs/heads/main\n");
  await symlink(sharedRef, alias);
  await writeFile(join(target, ".git/HEAD"), "ref: refs/heads/alias\n");
  assert.equal((await git(target, ["symbolic-ref", "HEAD"])).stdout.trim(), "refs/heads/main");
  await assert.rejects(assertIndependentGitRepository(target), independenceFailure);
  await rm(alias);
  await writeFile(alias, "ref: refs/heads/main\n");
  await assertIndependentGitRepository(target);
  await writeFile(join(target, ".git/HEAD"), "ref: refs/heads/main\n");

  const commonMarker = join(target, ".git/commondir");
  await writeFile(commonMarker, ".\n");
  await assert.rejects(assertIndependentGitRepository(target), independenceFailure);
  await rm(commonMarker);

  const packedRefs = join(target, ".git/packed-refs");
  await symlink(sharedRef, packedRefs);
  await assert.rejects(assertIndependentGitRepository(target), independenceFailure);
});
