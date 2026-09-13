import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test, { type TestContext } from "node:test";
import { foundationDockerExecutionBackendProfileV1 } from "../../src/foundation/execution/docker-profile-v1.js";
import { canonicalJson, selfDigest, sha256Bytes } from "../../src/foundation/validation/canonical.js";
import { executionContractFixture } from "../support/execution-contract-fixture.js";

const execute = promisify(execFile);
const runner = fileURLToPath(new URL("../../src/util/execution-cell-runner-v1.js", import.meta.url));
const maximumBytes = 1024 * 1024;
const digest = (name: string) => sha256Bytes(`check-git-view:${name}`);
const bytes = (value: unknown) => Buffer.from(`${canonicalJson(value)}\n`);

// Real standalone runner, Git reconstruction, command, and raw proof/output.
// Synthetic exact protocol bytes select the canonical profile; no Docker,
// Runtime Check Receipt, containment, installed Image or live target is claimed.
async function fixture(t: TestContext, phase: "baseline" | "final", script: string,
  environment: Record<string, string> = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lifecycle-check-git-view-")));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  const input = join(root, "input");
  const output = join(root, "output");
  await mkdir(join(source, "atlas"), { recursive: true });
  await mkdir(join(input, ".lifecycle"), { recursive: true });
  await mkdir(output);
  const commandBytes = Buffer.from(`#!/bin/sh\nset -eu\n${script}\n`);
  await writeFile(join(source, "check.sh"), commandBytes, { mode: 0o755 });
  await writeFile(join(source, "atlas/atlas.md"), "Exact retained Atlas bytes.\n");
  const git = (args: string[], stdin?: string): Buffer => execFileSync("/usr/bin/git", args, {
    cwd: source, input: stdin, maxBuffer: maximumBytes,
    env: { PATH: "/usr/bin:/bin", HOME: root, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  git(["init", "--template=", "-b", "fixture"]);
  git(["add", "--", "."]);
  git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "Exact fixture source"]);
  const commit = git(["rev-parse", "HEAD"]).toString().trim();
  const tree = git(["rev-parse", "HEAD^{tree}"]).toString().trim();
  const expectedIndex = git(["ls-files", "--stage", "-z"]);
  const objects = [...new Set([tree, ...git(["ls-tree", "-r", "-t", tree]).toString().trim().split("\n")
    .map((line) => line.split(/[\t ]/u)[2]!)])].sort();
  const inventory = git(["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"], `${objects.join("\n")}\n`)
    .toString().trim().split("\n").map((line) => {
      const [objectId, objectType, byteLength] = line.split(" ");
      assert(objectType === "blob" || objectType === "tree");
      return { objectId, objectType, byteLength: Number(byteLength) };
    });
  const pack = git(["pack-objects", "--stdout", "--no-reuse-delta", "--no-reuse-object"], `${objects.join("\n")}\n`);
  const proofSubjectDigest = digest(`${phase}:proof-subject`);
  const productBase = { schema: "lifecycle.check-product-base.v1", proofSubjectDigest, objectFormat: "sha1", commit, tree };
  const productBaseBytes = bytes(productBase);
  const artifact = { format: "git-pack-v2", byteLength: pack.byteLength, digest: sha256Bytes(pack) };
  const manifestSubject = {
    schema: phase === "baseline" ? "lifecycle.check-product-base-object-closure.v1" : "lifecycle.candidate-revision-carrier-manifest.v1",
    rootTree: tree, objectFormat: "sha1", allowedTreeModes: ["040000", "100644", "100755"],
    objectCount: inventory.length, objectInventory: inventory, objectInventoryDigest: sha256Bytes(canonicalJson(inventory)),
    aggregateObjectBytes: inventory.reduce((sum, item) => sum + item.byteLength, 0),
    ...(phase === "baseline" ? { baseCommit: commit, productBaseDigest: sha256Bytes(productBaseBytes), artifact } : { carrierArtifact: artifact }),
  };
  const manifest = { ...manifestSubject, digest: selfDigest(manifestSubject) };
  const bindingSubject = {
    id: "binding.check-git-view", kind: "command", mutation: "forbidden", cwd: ".",
    executable: { relativeTo: "candidate", path: "check.sh" }, implementationDigest: sha256Bytes(commandBytes),
    args: [], environment, timeoutMs: 5000,
    resultParser: { id: "exit-code-v1", stateModel: "check-disposition-v2", states: ["pass", "fail", "indeterminate", "not-run", "unsupported", "operational-error"] },
  };
  const binding = { ...bindingSubject, digest: selfDigest(bindingSubject) };
  const definition = { id: "check.git-view", proposition: "The retained tree has its exact Git index." };
  const definitionDigest = sha256Bytes(canonicalJson(definition));
  const proofSubject = { kind: phase === "baseline" ? "work-boundary" : "candidate-seal", id: `subject.${phase}`, revision: 1, digest: proofSubjectDigest };
  const selectedRunnerDigest = digest("runner");
  const phaseSubjects = phase === "baseline"
    ? [{ kind: "product-base", digest: sha256Bytes(productBaseBytes) }, { kind: "product-base-object-closure-manifest", digest: manifest.digest }]
    : [{ kind: "candidate-revision", digest: digest("candidate") }, { kind: "candidate-revision-carrier-manifest", digest: manifest.digest }];
  const subjects = [...phaseSubjects, { kind: "check-binding", digest: binding.digest },
    { kind: "check-definition", digest: definitionDigest }, { kind: "check-proof-subject", digest: proofSubjectDigest },
    { kind: "runner", digest: selectedRunnerDigest }]
    .map((subject) => ({ ...subject, id: `fixture.${subject.kind}`, revision: 1 }))
    .sort((a, b) => a.kind < b.kind ? -1 : 1);
  const material = [
    { path: "check/binding.json", purpose: "check-input", sourceSubjectDigest: binding.digest, bytes: bytes(binding) },
    { path: "check/definition.json", purpose: "check-input", sourceSubjectDigest: definitionDigest, bytes: bytes(definition) },
    { path: "check/proof-subject.json", purpose: "check-input", sourceSubjectDigest: proofSubjectDigest, bytes: bytes(proofSubject) },
    ...(phase === "baseline" ? [
      { path: "product-base/subject.json", purpose: "check-input", sourceSubjectDigest: sha256Bytes(productBaseBytes), bytes: productBaseBytes },
      { path: "product-base/object-closure.json", purpose: "check-input", sourceSubjectDigest: manifest.digest, bytes: bytes(manifest) },
      { path: "product-base/object-closure.pack", purpose: "product-base-object-closure-artifact", sourceSubjectDigest: manifest.digest, bytes: pack },
    ] : [
      { path: "candidate/carrier-manifest.json", purpose: "check-input", sourceSubjectDigest: manifest.digest, bytes: bytes(manifest) },
      { path: "candidate/carrier.pack", purpose: "candidate-carrier-artifact", sourceSubjectDigest: manifest.digest, bytes: pack },
    ]),
  ].sort((a, b) => a.path < b.path ? -1 : 1);
  const entries = material.map(({ bytes: value, ...entry }) => ({ ...entry, mediaType: entry.path.endsWith(".pack") ? "application/vnd.git.pack" : "application/json",
    modeClass: "regular", byteLength: value.byteLength, digest: sha256Bytes(value) }));
  const owner = { kind: "check", activityId: "activity.git-view", selectionId: "git-view", phase, ownerSubjectDigest: proofSubjectDigest };
  const inputSubject = {
    schema: "lifecycle.execution-input-set.v2", owner, subjects, entries, entryCount: entries.length,
    aggregateByteLength: entries.reduce((sum, entry) => sum + entry.byteLength, 0),
    contentInventoryDigest: sha256Bytes(canonicalJson(entries)), inputMaterialDigest: digest(`${phase}:input`),
    runnerContractDigest: selectedRunnerDigest, toolInventoryDigest: digest("tools"),
  };
  const inputSet = { ...inputSubject, digest: selfDigest(inputSubject) };
  const template = executionContractFixture("check-git-view").specification;
  const { digest: _oldDigest, ...base } = template;
  const profile = foundationDockerExecutionBackendProfileV1();
  const outputContractSubject = {
    manifestProfile: "lifecycle.execution-output-manifest.v1", allowedModeClasses: ["regular", "executable"], extraEntriesAllowed: false,
    declaredOutputRoots: ["check-proof", "raw-check-output"].map((path) => ({ path, purpose: path, required: true,
      allowedModeClasses: ["regular"], maximumEntries: 1, maximumBytes })),
  };
  const specificationSubject = {
    ...base, owner,
    backendProfile: { profileId: profile.profileId, profileDigest: profile.digest, implementationDigest: profile.implementation.implementationDigest },
    inputSet: { profileId: inputSet.schema, digest: inputSet.digest },
    operation: { kind: "check", phase, selectionId: owner.selectionId, bindingDigest: binding.digest, definitionDigest,
      runnerImplementationDigest: digest("runner-executable"), parserImplementationDigest: digest("parser") },
    runner: { contractId: "lifecycle.execution-cell-runner.v1", contractDigest: selectedRunnerDigest,
      operationId: "check.execute", argumentsDigest: digest(`${phase}:arguments`) },
    limits: { ...base.limits, outputEntries: 3 },
    outputContract: { ...outputContractSubject, digest: selfDigest(outputContractSubject) },
  };
  const specification = { ...specificationSubject, digest: selfDigest(specificationSubject) };
  for (const entry of material) {
    await mkdir(dirname(join(input, entry.path)), { recursive: true });
    await writeFile(join(input, entry.path), entry.bytes, { mode: 0o400 });
  }
  await writeFile(join(input, ".lifecycle/input-set.json"), bytes(inputSet));
  await writeFile(join(input, ".lifecycle/specification.json"), bytes(specification));
  const run = async () => {
    const result = await execute(process.execPath, [runner, "execute", "--specification", join(input, ".lifecycle/specification.json"),
      "--input", input, "--output", output], { timeout: 15_000, maxBuffer: maximumBytes,
      env: { TMPDIR: root, HOME: root, PATH: "/usr/local/bin:/usr/bin:/bin" } });
    assert.equal(result.stderr, "");
    const proof = JSON.parse(await readFile(join(output, "check-proof/result.json"), "utf8"));
    const raw = JSON.parse(await readFile(join(output, "raw-check-output/streams.json"), "utf8"));
    assert.equal(proof.digest, selfDigest(proof));
    assert.equal(raw.schema, "lifecycle.check-cell-raw-streams.v1");
    return { proof, stdout: Buffer.from(raw.stdoutBase64, "base64"), stderr: Buffer.from(raw.stderrBase64, "base64") };
  };
  return { run, source, input, output, expectedIndex };
}

for (const phase of ["baseline", "final"] as const) {
  test(`${phase} Check reads its exact isolated Git tree/index without HEAD or product metadata`, async (t) => {
    const value = await fixture(t, phase, [
      "test ! -e .git",
      "git ls-files --stage -z",
      "git diff-files --quiet || { printf 'index does not match exact materialized files' >&2; exit 1; }",
      "if git rev-parse --verify HEAD >/dev/null 2>&1; then exit 81; fi",
    ].join("\n"));
    const observed = await value.run();
    assert.equal(observed.proof.exitCode, 0, observed.stderr.toString("utf8"));
    assert.equal(observed.proof.subjectIntegrity, "unchanged");
    assert.equal(observed.proof.subjectBeforeDigest, observed.proof.subjectAfterDigest);
    assert.deepEqual(observed.stdout, value.expectedIndex, "Git must select every exact source index entry and mode");
    assert.equal(observed.stderr.byteLength, 0);
  });
}

test("Check cannot hide index, configuration, object, pack, or product mutations behind exit zero", async (t) => {
  for (const [name, command] of [
    ["index", "git update-index --force-remove atlas/atlas.md"],
    ["configuration", "git config --local core.bare false"],
    ["object", "printf 'new private object' | git hash-object -w --stdin >/dev/null"],
    ["pack", 'printf X | dd of="$GIT_DIR/objects/pack/carrier.pack" bs=1 count=1 conv=notrunc 2>/dev/null'],
    ["product", "printf 'changed' > atlas/atlas.md"],
  ]) await t.test(name!, async (t) => {
    const value = await fixture(t, "final", `${command}\nexit 0`);
    const { proof } = await value.run();
    assert.equal(proof.exitCode, 0);
    assert.equal(proof.subjectIntegrity, "changed");
    assert.notEqual(proof.subjectBeforeDigest, proof.subjectAfterDigest);
  });
});

test("Check refuses aliased, executable, or unbounded private Git metadata", async (t) => {
  for (const [name, command, error] of [
    ["symlink", 'ln -s config "$GIT_DIR/alias"', /aliased, special, or executable metadata/u],
    ["root alias", 'mv "$GIT_DIR" "$GIT_DIR.original"; ln -s "$GIT_DIR.original" "$GIT_DIR"', /Check subject or private Git root was substituted/u],
    ["hardlink", 'ln "$GIT_DIR/config" "$GIT_DIR/alias"', /aliased, special, or executable metadata/u],
    ["executable", 'chmod +x "$GIT_DIR/config"', /aliased, special, or executable metadata/u],
    ["entries", 'i=0; while test "$i" -lt 65; do : > "$GIT_DIR/extra-$i"; i=$((i+1)); done', /entry bound/u],
    ["bytes", 'dd if=/dev/zero of="$GIT_DIR/extra" bs=1048576 count=1 2>/dev/null', /Check private Git metadata is not one bounded regular file/u],
  ] as const) await t.test(name, async (t) => {
    const value = await fixture(t, "baseline", command);
    await assert.rejects(value.run, error);
    await assert.rejects(readFile(join(value.output, "check-proof/result.json")), /ENOENT/u);
  });
});

test("Check refuses Binding overrides of its private Git environment before command dispatch", async (t) => {
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_COUNT"]) {
    await t.test(name, async (t) => {
      const value = await fixture(t, "baseline", "exit 91", { [name]: "/substituted" });
      await assert.rejects(value.run, /Check Binding environment is invalid or overrides a protected name/u);
      await assert.rejects(readFile(join(value.output, "check-proof/result.json")), /ENOENT/u);
    });
  }
});
