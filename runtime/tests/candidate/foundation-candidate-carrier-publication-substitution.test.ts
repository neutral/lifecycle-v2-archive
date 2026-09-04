import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  prepareCandidateRevisionCarrier,
  publishCandidateRevisionCarrier,
} from "../../src/foundation/candidate/carrier-store.js";
import { FoundationError } from "../../src/foundation/error.js";
import { git } from "../../src/foundation/repository/git.js";

test("Candidate Revision Carrier refuses and preserves a substituted idempotent staging pack", async (context) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-carrier-publication-substitution-")));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const repository = join(root, "target");
  const machineHome = join(root, "machine");
  await mkdir(repository, { mode: 0o700 });
  await mkdir(machineHome, { mode: 0o700 });
  await chmod(machineHome, 0o700);
  await git(repository, ["init", "-b", "main"]);
  await writeFile(join(repository, "product.txt"), "candidate\n", "utf8");
  await git(repository, ["add", "--", "."]);
  const rootTree = (await git(repository, ["write-tree"])).stdout.trim();

  const first = await prepareCandidateRevisionCarrier({
    machineHome,
    repository,
    rootTree,
  });
  const retry = await prepareCandidateRevisionCarrier({
    machineHome,
    repository,
    rootTree,
  });
  await publishCandidateRevisionCarrier({ machineHome, prepared: first });

  const substitutedBytes = Buffer.from("substituted staging pack\n", "utf8");
  await writeFile(retry.artifactPath, substitutedBytes);
  await assert.rejects(
    publishCandidateRevisionCarrier({ machineHome, prepared: retry }),
    (error: unknown) => error instanceof FoundationError &&
      error.code === "lifecycle.candidate.carrier-invalid" &&
      error.message.includes("artifact bytes do not match their manifest"),
  );

  assert.equal((await stat(retry.stagingRoot)).isDirectory(), true);
  assert.deepEqual(await readFile(retry.artifactPath), substitutedBytes);
});
