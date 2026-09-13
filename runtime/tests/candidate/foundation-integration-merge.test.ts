import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { publishCandidateRevisionCarrierFromGitTree } from "../../src/foundation/candidate/carrier-binding.js";
import { importCandidateRevisionCarrierIntoRepository } from "../../src/foundation/candidate/carrier-import.js";
import { assertFoundationIntegrationGitVersionV1, constructFoundationIntegrationTreeV1, foundationIntegrationMergeRuleV1, parseFoundationIntegrationMergeOutputV1 } from "../../src/foundation/candidate/integration-merge.js";
import { FoundationError } from "../../src/foundation/error.js";
import { git } from "../../src/foundation/repository/git.js";

function parse(fields: readonly string[], exitCode = 1) {
  return parseFoundationIntegrationMergeOutputV1({
    bytes: Buffer.from([...fields, ""].join("\0")), exitCode, objectFormat: "sha1",
  });
}
const tree = "a".repeat(40);
const invalid = (error: unknown) => error instanceof FoundationError && error.code === "lifecycle.integration.merge-invalid";

test("integration refuses unsupported or malformed Git identities before selecting a merge rule", () => {
  // Finite boundary corpus: each feature introduction, the exact floor, newer
  // minor/major versions, vendor metadata, and malformed stable versions.
  for (const version of ["2.45.0", "2.45.1", "2.50.1 (Apple Git-155)", "2.100.0", "3.0.0"]) {
    assert.doesNotThrow(() => assertFoundationIntegrationGitVersionV1(`git version ${version}`), version);
  }
  for (const version of ["1.99.99", "2.39.5", "2.40.0", "2.43.0", "2.44.999", "2.45", "2.45.0-rc0", "02.45.0", "2.045.0", "2.45.00", "2.45.0\nother", "2.45.0\0", `2.45.0 ${"x".repeat(200)}`]) {
    assert.throws(() => assertFoundationIntegrationGitVersionV1(`git version ${version}`), invalid, version);
  }
  assert.throws(() => assertFoundationIntegrationGitVersionV1("2.45.0"), invalid);
});

test("integration parser treats exit status and structured conflict records as the observation", () => {
  assert.deepEqual(parse([tree, ""], 0), { outcome: "constructed", rootTree: tree, conflicts: [] });
  // A directory rename conflict can have no staged paths at all.
  assert.deepEqual(parse([tree, "", "2", "old/f", "new/f", "CONFLICT (directory rename suggested)", "opaque"]), {
    outcome: "conflicted", conflicts: [{ path: "new/f", kind: "rename" }, { path: "old/f", kind: "rename" }],
  });
  assert.deepEqual(parse([tree, "f", "", "1", "f", "Auto-merging", "opaque", "1", "f", "CONFLICT (contents)", "opaque"]), {
    outcome: "conflicted", conflicts: [{ path: "f", kind: "content" }],
  });
  const result = parse([tree, "f", "", "1", "f", "CONFLICT (future type)", "untrusted instruction"]);
  assert.deepEqual(result, { outcome: "conflicted", conflicts: [{ path: "f", kind: "unsupported" }] });
  assert.ok(!("rootTree" in result));
  assert.throws(() => parse([tree, ""], 1), invalid);
  assert.throws(() => parse([tree, "f", ""], 0), invalid);
  assert.throws(() => parse([tree, ""], 2), invalid);
});

test("integration parser rejects every truncated byte prefix and malformed count or path", () => {
  const complete = Buffer.from([tree, "f", "", "1", "f", "CONFLICT (contents)", "opaque", ""].join("\0"));
  // Finite mutation domain: all strict prefixes of one complete conflict frame.
  for (let length = 0; length < complete.length; length += 1) {
    assert.throws(() => parseFoundationIntegrationMergeOutputV1({ bytes: complete.subarray(0, length), exitCode: 1, objectFormat: "sha1" }), invalid, `prefix ${length}`);
  }
  for (const count of ["0", "-1", "01", "1000001", "2", "x"]) {
    assert.throws(() => parse([tree, "", count, "f", "CONFLICT (contents)", "opaque"]), invalid, count);
  }
  for (const badPath of ["../f", "/f", "a//f", "a\\f"]) {
    assert.throws(() => parse([tree, badPath, ""]), invalid, badPath);
  }
});

test("integration conflict facts use scalar-value ordering across BMP and supplementary paths", () => {
  assert.deepEqual(parse([tree, "", "2", "\u{10000}.txt", "\uE000.txt", "CONFLICT (contents)", "opaque"]), {
    outcome: "conflicted",
    conflicts: [{ path: "\uE000.txt", kind: "content" }, { path: "\u{10000}.txt", kind: "content" }],
  });
});

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-integration-merge-")));
  const repository = join(root, "source");
  const machineHome = join(root, "machine");
  await mkdir(repository, { mode: 0o700 });
  await mkdir(machineHome, { mode: 0o700 });
  await git(repository, ["init", "--template=", "-b", "main"]);
  await git(repository, ["config", "user.name", "Lifecycle Test"]);
  await git(repository, ["config", "user.email", "lifecycle@example.invalid"]);
  const capture = async (content: string, upstream = "base\n") => {
    await writeFile(join(repository, "product.txt"), content);
    await writeFile(join(repository, "upstream.txt"), upstream);
    await git(repository, ["add", "--", "."]);
    const rootTree = (await git(repository, ["write-tree"])).stdout.trim();
    return await publishCandidateRevisionCarrierFromGitTree({ machineHome, repository, rootTree });
  };
  return { root, repository, machineHome, capture };
}

test("integration retains an exact independent three-way result without changing source refs, index, or worktree", async (context) => {
  const value = await fixture();
  context.after(async () => rm(value.root, { recursive: true, force: true }));
  const base = await value.capture("base\n");
  const candidate = await value.capture("delivery\n");
  const parent = await value.capture("base\n", "canonical advance\n");
  await git(value.repository, ["commit", "-m", "current canonical"]);
  const head = (await git(value.repository, ["rev-parse", "HEAD"])).stdout;
  const index = await readFile(join(value.repository, ".git", "index"));
  // Repository-authored configuration is not copied into integration custody.
  await git(value.repository, ["config", "merge.default", "sentinel"]);
  await git(value.repository, ["config", "merge.sentinel.driver", "false"]);
  const request = {
    machineHome: value.machineHome,
    baseManifestBytes: base.manifestBytes, candidateManifestBytes: candidate.manifestBytes, parentManifestBytes: parent.manifestBytes,
    mergeRule: await foundationIntegrationMergeRuleV1(),
  };
  const result = await constructFoundationIntegrationTreeV1(request);
  assert.equal(result.outcome, "constructed");
  if (result.outcome !== "constructed") assert.fail("expected a result Carrier");
  assert.deepEqual(await constructFoundationIntegrationTreeV1(request), result);
  assert.equal((await git(value.repository, ["rev-parse", "HEAD"])).stdout, head);
  assert.deepEqual(await readFile(join(value.repository, ".git", "index")), index);
  assert.equal(await readFile(join(value.repository, "product.txt"), "utf8"), "base\n");
  const inspection = join(value.root, "inspection");
  await mkdir(inspection, { mode: 0o700 });
  await git(inspection, ["init", "--template=", "-b", "inspect"]);
  await importCandidateRevisionCarrierIntoRepository({ machineHome: value.machineHome, manifestBytes: result.manifestBytes, repository: inspection, expectedRootTree: result.rootTree });
  assert.equal((await git(inspection, ["show", `${result.rootTree}:product.txt`])).stdout, "delivery\n");
  assert.equal((await git(inspection, ["show", `${result.rootTree}:upstream.txt`])).stdout, "canonical advance\n");
  assert.equal((await stat(join(inspection, ".git"))).isDirectory(), true);
  await assert.rejects(constructFoundationIntegrationTreeV1({ ...request, mergeRule: { ...request.mergeRule, implementationDigest: `sha256:${"f".repeat(64)}` } }), invalid);
});

test("a real content conflict exposes exact paths and never returns a Candidate Carrier", async (context) => {
  const value = await fixture();
  context.after(async () => rm(value.root, { recursive: true, force: true }));
  const base = await value.capture("base\n");
  const candidate = await value.capture("delivery\n");
  const parent = await value.capture("canonical\n");
  const result = await constructFoundationIntegrationTreeV1({
    machineHome: value.machineHome,
    baseManifestBytes: base.manifestBytes, candidateManifestBytes: candidate.manifestBytes, parentManifestBytes: parent.manifestBytes,
    mergeRule: await foundationIntegrationMergeRuleV1(),
  });
  assert.deepEqual(result, { outcome: "conflicted", conflicts: [{ path: "product.txt", kind: "content" }] });
});
