import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  assertDistributionHostPlatform,
  dockerTerminalArguments,
  prepareDraftInvocation,
  prepareRuntimeInvocation,
  runDistributionLauncher,
} from "../src/launcher.js";
import { canonicalManifestBytes, createDistributionManifestFromSelection } from "../src/manifest.js";
import { distributionSelectionFixture } from "./support.js";

test("runtime invocation maps target and explicit input without changing the command", async () => {
  const root = await (async () => {
    const value = await mkdtemp(join(tmpdir(), "lifecycle-launcher-paths-"));
    return (await import("node:fs/promises")).realpath(value);
  })();
  try {
    const target = join(root, "target");
    const input = join(root, "brief.md");
    await mkdir(join(target, ".git"), { recursive: true });
    await writeFile(input, "# Brief\n");
    const prepared = prepareRuntimeInvocation(
      "lifecycle",
      ["prepare", target, "--input", input, "--format", "json"],
      root,
    );
    assert.equal(prepared.target, target);
    assert.deepEqual(prepared.arguments, ["prepare", target, "--input", input, "--format", "json"]);
    assert.deepEqual(prepared.mounts.map(({ source, readOnly }) => ({ source, readOnly })), [
      { source: target, readOnly: false },
      { source: input, readOnly: true },
    ]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("local draft maps only explicit read-only files without target or Git custody", async () => {
  const root = await (await import("node:fs/promises")).realpath(await mkdtemp(join(tmpdir(), "lifecycle-draft-paths-")));
  try {
    const workspace = join(root, "workspace");
    await mkdir(join(workspace, "records"), { recursive: true });
    await mkdir(join(workspace, ".lifecycle"));
    await writeFile(join(workspace, ".lifecycle/repository.json"), "{}\n");
    await writeFile(join(workspace, "records/selected.md"), "selected\n");
    await writeFile(join(workspace, "records/unselected.md"), "unselected\n");
    const basis = join(root, "basis.json");
    await writeFile(basis, "{}\n");
    const knowledge = prepareDraftInvocation(["draft", "knowledge", workspace, "records/selected.md", "--format", "json"], root);
    assert.equal(knowledge.target, null);
    assert.deepEqual(knowledge.arguments, ["draft", "knowledge", "/lifecycle-draft/workspace", "records/selected.md", "--format", "json"]);
    assert.deepEqual(knowledge.mounts, [
      { source: join(workspace, "records/selected.md"), target: "/lifecycle-draft/workspace/records/selected.md", readOnly: true },
      { source: join(workspace, ".lifecycle/repository.json"), target: "/lifecycle-draft/workspace/.lifecycle/repository.json", readOnly: true },
    ]);
    const semantic = prepareDraftInvocation(["draft", "semantic", workspace, "records/selected.md", "--basis", basis], root);
    assert.deepEqual(semantic.mounts.map(({ source }) => source), [join(workspace, "records/selected.md"), basis]);
    assert.deepEqual(semantic.arguments, ["draft", "semantic", "/lifecycle-draft/workspace", "records/selected.md", "--basis", "/lifecycle-draft/semantic-basis.json"]);
    for (const args of [["draft", "forms"], ["draft", "forms", "knowledge"], ["help", "draft"], ["draft", "knowledge", "--help"]]) {
      assert.deepEqual(prepareDraftInvocation(args, "/unavailable"), { arguments: args, mounts: [], target: null });
    }
    assert.throws(() => prepareDraftInvocation(["draft", "knowledge", workspace, "../basis.json"], root), /normalized paths/u);
    assert.throws(() => prepareDraftInvocation(["draft", "semantic", workspace, "records/selected.md", "--basis", "basis.json"], root), /absolute file/u);
    assert.throws(() => prepareDraftInvocation(["draft", "knowledge", workspace, ...Array.from({ length: 1025 }, () => "records/selected.md")], root), /at most 1024/u);
    await symlink(join(workspace, "records/selected.md"), join(workspace, "records/linked.md"));
    assert.throws(() => prepareDraftInvocation(["draft", "knowledge", workspace, "records/linked.md"], root), /regular file/u);
    await chmod(join(workspace, "records/selected.md"), 0o755);
    assert.throws(() => prepareDraftInvocation(["draft", "knowledge", workspace, "records/selected.md"], root), /non-executable/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installed draft uses only the exact Runtime Image and disposable read-only support", async () => {
  const root = await (await import("node:fs/promises")).realpath(await mkdtemp(join(tmpdir(), "lifecycle-draft-launch-")));
  const server = createServer();
  try {
    const socket = join(root, "docker.sock");
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(socket, resolve); });
    const log = join(root, "docker-log.jsonl");
    const docker = join(root, "docker.mjs");
    const manifest = createDistributionManifestFromSelection(distributionSelectionFixture());
    const runtime = manifest.images.runtime;
    const runtimePlatform = runtime.platforms[0]!;
    const workspace = join(root, "workspace");
    await mkdir(join(workspace, ".lifecycle"), { recursive: true });
    await mkdir(join(workspace, "records"));
    await writeFile(join(workspace, ".lifecycle/repository.json"), "{}\n");
    await writeFile(join(workspace, "records/selected.md"), "original selected bytes\n");
    await writeFile(join(workspace, "records/unselected.md"), "not selected\n");
    const replacement = join(root, "replacement.md");
    await writeFile(replacement, "redirected bytes\n");
    const changeSource = join(root, "change-source");
    const snapshotLog = join(root, "snapshot.json");
    await writeFile(docker, `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args, home: process.env.HOME, config: process.env.DOCKER_CONFIG, machine: process.env.LIFECYCLE_MACHINE_HOME }) + "\\n");
if (args[2] === "version") {
  if (existsSync(${JSON.stringify(changeSource)})) {
    rmSync(${JSON.stringify(join(workspace, "records/selected.md"))});
    symlinkSync(${JSON.stringify(replacement)}, ${JSON.stringify(join(workspace, "records/selected.md"))});
  }
  process.stdout.write(JSON.stringify({ ApiVersion: "1.48" }));
}
else if (args[2] === "info") process.stdout.write(JSON.stringify({ Architecture: "amd64", OSType: "linux" }));
else if (args[2] === "image" && args[4] === ${JSON.stringify(`${runtime.repository}@${runtime.indexDigest}`)}) process.stdout.write(JSON.stringify({
  Id: ${JSON.stringify(runtimePlatform.configurationDigest)}, Os: "linux", Architecture: "amd64",
  RepoDigests: [${JSON.stringify(`${runtime.repository}@${runtime.indexDigest}`)}],
  Config: { Labels: {
    "org.opencontainers.image.revision": ${JSON.stringify(manifest.distribution.sourceRevision)},
    "org.opencontainers.image.version": "1.0.0",
    "io.lifecycle.runtime-image.qualification-revision": ${JSON.stringify(manifest.coordinates.qualificationRevision)},
    "io.lifecycle.runtime-image.runtime-invocation-protocol": "lifecycle.runtime-invocation.private.v1"
  } }
}));
else if (args[2] === "run") {
  if (args.includes("--mount")) {
    const mounted = args[args.indexOf("--mount") + 1];
    const source = mounted.split(",").find((part) => part.startsWith("src=")).slice(4);
    writeFileSync(${JSON.stringify(snapshotLog)}, JSON.stringify({
      mounted, source,
      selected: readFileSync(source + "/workspace/records/selected.md", "utf8"),
      files: readdirSync(source + "/workspace/records"),
      contract: readFileSync(source + "/workspace/.lifecycle/repository.json", "utf8"),
    }));
  }
  process.exit(17);
}
else process.exit(91);
`);
    await chmod(docker, 0o755);
    // This route must not open, repair, or create the selected machine home.
    const absentMachine = join(root, "absent-machine");
    assert.equal(await runDistributionLauncher("lifecycle", ["draft", "forms", "builder", "--format", "json"], manifest, {
      PATH: process.env.PATH,
      LIFECYCLE_DISTRIBUTION_DOCKER_PATH: docker,
      LIFECYCLE_DISTRIBUTION_DOCKER_HOST: `unix://${socket}`,
      LIFECYCLE_MACHINE_HOME: absentMachine,
    }), 17);
    const observations = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { args: string[]; home: string; config: string; machine?: string });
    assert.deepEqual(observations.map(({ args }) => args[2]), ["version", "info", "image", "run"]);
    const run = observations.at(-1)!;
    assert.equal(run.machine, undefined);
    assert.equal(run.args.includes("--mount"), false);
    assert.equal(run.args[run.args.indexOf("--network") + 1], "none");
    assert.equal(run.args[run.args.indexOf("--entrypoint") + 1], "/opt/lifecycle/bin/lifecycle");
    assert.deepEqual(run.args.slice(-6), [`${runtime.repository}@${runtime.indexDigest}`, "draft", "forms", "builder", "--format", "json"]);
    assert.equal(run.args.includes("--read-only"), true);
    assert.equal(run.args.includes("--rm"), true);
    await assert.rejects(stat(absentMachine), { code: "ENOENT" });
    await assert.rejects(stat(run.home), { code: "ENOENT" });
    await assert.rejects(stat(run.config), { code: "ENOENT" });
    await writeFile(changeSource, "replace the selected path during Docker inspection\n");
    assert.equal(await runDistributionLauncher("lifecycle", ["draft", "knowledge", workspace, "records/selected.md"], manifest, {
      PATH: process.env.PATH,
      LIFECYCLE_DISTRIBUTION_DOCKER_PATH: docker,
      LIFECYCLE_DISTRIBUTION_DOCKER_HOST: `unix://${socket}`,
      LIFECYCLE_MACHINE_HOME: absentMachine,
    }), 17);
    const snapshot = JSON.parse(await readFile(snapshotLog, "utf8")) as { mounted: string; source: string; selected: string; files: string[]; contract: string };
    assert.equal(snapshot.selected, "original selected bytes\n", "Docker must read the stable snapshot, not the redirected host pathname");
    assert.deepEqual(snapshot.files, ["selected.md"]);
    assert.equal(snapshot.contract, "{}\n");
    assert.match(snapshot.mounted, /readonly/u);
    await assert.rejects(stat(snapshot.source), { code: "ENOENT" });
    await assert.rejects(stat(absentMachine), { code: "ENOENT" });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime invocation refuses host mounts that overlap trusted image paths", async () => {
  const root = await (async () => {
    const value = await mkdtemp(join(tmpdir(), "lifecycle-launcher-reserved-"));
    return (await import("node:fs/promises")).realpath(value);
  })();
  try {
    const target = join(root, "target");
    await mkdir(join(target, ".git"), { recursive: true });
    assert.throws(
      () => prepareRuntimeInvocation("lifecycle", ["prepare", target, "--input", "/usr/bin/env"], root),
      /overlaps the reserved Runtime Image path \/usr/u,
    );
    const quotedTarget = join(root, 'target"quoted');
    await mkdir(join(quotedTarget, ".git"), { recursive: true });
    assert.throws(
      () => prepareRuntimeInvocation("lifecycle", ["validate", quotedTarget], root),
      /double quotes/u,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("distribution host selection admits only macOS and Linux", () => {
  assert.doesNotThrow(() => assertDistributionHostPlatform("darwin"));
  assert.doesNotThrow(() => assertDistributionHostPlatform("linux"));
  assert.throws(() => assertDistributionHostPlatform("freebsd"), /only macOS and Linux/u);
  assert.throws(() => assertDistributionHostPlatform("win32"), /only macOS and Linux/u);
});

test("help never selects or mounts an implicit target", () => {
  assert.deepEqual(prepareRuntimeInvocation("lifecycle", ["prepare", "--help"], "/unavailable"), {
    arguments: ["prepare", "--help"],
    mounts: [],
    target: null,
  });

});

test("CLI refuses linked targets instead of mounting shared Git administration", async () => {
  const root = await (async () => {
    const value = await mkdtemp(join(tmpdir(), "lifecycle-launcher-worktree-"));
    return (await import("node:fs/promises")).realpath(value);
  })();
  try {
    const target = join(root, "target");
    const common = join(root, "common.git");
    const administration = join(common, "worktrees", "target");
    await mkdir(target);
    await mkdir(administration, { recursive: true });
    await writeFile(join(target, ".git"), `gitdir: ${administration}\n`);
    await writeFile(join(administration, "gitdir"), `${join(target, ".git")}\n`);
    await writeFile(join(administration, "commondir"), "../..\n");
    for (const command of ["lifecycle"] as const) {
      const arguments_ = ["validate", target];
      assert.throws(
        () => prepareRuntimeInvocation(command, arguments_, root),
        /requires independent local Git metadata at \.git/u,
      );
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("launcher target preflight refuses alternates and selected-ref indirection", async () => {
  const root = await (await import("node:fs/promises")).realpath(
    await mkdtemp(join(tmpdir(), "lifecycle-launcher-independent-")),
  );
  try {
    const target = join(root, "target");
    await mkdir(join(target, ".git/objects/info"), { recursive: true });
    const prepare = () => prepareRuntimeInvocation("lifecycle", ["validate", target], root);
    assert.deepEqual(prepare().mounts.map(({ source }) => source), [target]);
    await mkdir(join(target, ".git/worktrees"));
    assert.deepEqual(prepare().mounts.map(({ source }) => source), [target]);
    await mkdir(join(target, ".git/worktrees/linked"));
    assert.throws(prepare, /cannot share Git administration with registered linked worktrees/u);
    await rm(join(target, ".git/worktrees/linked"), { recursive: true });
    for (const name of ["alternates", "http-alternates"]) {
      const marker = join(target, ".git/objects/info", name);
      await writeFile(marker, "");
      assert.throws(prepare, /cannot use linked worktrees or alternate Git object stores/u);
      await rm(marker);
    }
    await writeFile(join(target, ".git/commondir"), ".\n");
    assert.throws(prepare, /cannot use linked worktrees or alternate Git object stores/u);
    await rm(join(target, ".git/commondir"));
    await mkdir(join(target, ".git/refs/heads"), { recursive: true });
    await writeFile(join(target, ".git/HEAD"), "ref: refs/heads/main\n");
    const sharedRef = join(root, "shared-ref");
    await writeFile(sharedRef, `${"a".repeat(40)}\n`);
    await symlink(sharedRef, join(target, ".git/refs/heads/main"));
    assert.throws(prepare, /requires independent local Git metadata at \.git\/refs\/heads\/main/u);
    await rm(join(target, ".git/refs/heads/main"));
    await link(sharedRef, join(target, ".git/refs/heads/main"));
    assert.throws(prepare, /requires independent local Git metadata at \.git\/refs\/heads\/main/u);
    await rm(join(target, ".git/refs/heads/main"));
    await writeFile(join(target, ".git/refs/heads/main"), `${"a".repeat(40)}\n`);
    await writeFile(sharedRef, "ref: refs/heads/main\n");
    await symlink(sharedRef, join(target, ".git/refs/heads/alias"));
    await writeFile(join(target, ".git/HEAD"), "ref: refs/heads/alias\n");
    assert.throws(prepare, /requires independent local Git metadata at \.git\/refs\/heads\/alias/u);
    await rm(join(target, ".git/refs/heads/alias"));
    await writeFile(join(target, ".git/refs/heads/alias"), "ref: refs/heads/main\n");
    assert.deepEqual(prepare().mounts.map(({ source }) => source), [target]);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("CLI forwards stdin without allocating a TTY", () => {
  assert.deepEqual(dockerTerminalArguments(), ["--interactive"]);
});

test("setup creates exact private support and launch cleans stale and current invocation support", async () => {
  const root = await (async () => {
    const value = await mkdtemp("/tmp/lifecycle-dist-");
    return (await import("node:fs/promises")).realpath(value);
  })();
  const socket = join(root, "docker.sock");
  const socketAlias = join(root, "docker-alias.sock");
  const log = join(root, "docker-log.jsonl");
  const fakeDocker = join(root, "docker");
  const machineHome = join(root, "state");
  const privateDockerConfig = join(machineHome, "distribution", "docker-config");
  const privateDockerHome = join(machineHome, "distribution", "runtime-home");
  const manifest = createDistributionManifestFromSelection(distributionSelectionFixture());
  const runtime = manifest.images.runtime;
  const execution = manifest.images.execution;
  const runtimePlatform = runtime.platforms[0]!;
  const executionPlatform = execution.platforms[0]!;
  const staleId = "2".repeat(64);
  const staleInvocation = "00000000-0000-4000-8000-000000000001";
  const stalePresent = join(root, "stale-present");
  const stopMode = join(root, "stop-mode");
  const script = `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + "\\n");
if (process.env.DOCKER_CONFIG !== ${JSON.stringify(privateDockerConfig)} ||
    process.env.HOME !== ${JSON.stringify(privateDockerHome)}) process.exit(90);
if (args[2] === "version") {
  process.stdout.write(JSON.stringify({ ApiVersion: "1.48" }));
} else if (args.includes("info")) {
  process.stdout.write(JSON.stringify({ Architecture: "amd64", OSType: "linux" }));
} else if (args.includes("ps")) {
  if (existsSync(${JSON.stringify(stalePresent)})) process.stdout.write(${JSON.stringify(`${staleId}\n`)});
} else if (args.includes("container") && args.includes("inspect")) {
  process.stdout.write(JSON.stringify({
    Name: ${JSON.stringify(`/lifecycle-runtime-${staleInvocation}`)},
    Config: { Labels: {
      "io.lifecycle.runtime-invocation.private.v1.protocol": "lifecycle.runtime-invocation.private.v1",
      "io.lifecycle.runtime-invocation.private.v1.invocation-id": ${JSON.stringify(staleInvocation)},
      "io.lifecycle.runtime-invocation.private.v1.state-root-digest": "STATE_ROOT_DIGEST",
      "io.lifecycle.runtime-invocation.private.v1.source-revision": ${JSON.stringify("0".repeat(40))},
      "io.lifecycle.runtime-invocation.private.v1.role": "command-runtime"
    } },
    State: { Running: false }
  }));
} else if (args.includes("stop")) {
  if (readFileSync(${JSON.stringify(stopMode)}, "utf8") === "absent") {
    rmSync(${JSON.stringify(stalePresent)}, { force: true });
  }
  process.exit(1);
} else if (args.includes("rm") && args.includes("--force")) {
  rmSync(${JSON.stringify(stalePresent)}, { force: true });
  process.exit(1);
} else if (args.includes("image") && args.includes("inspect")) {
  const execution = args.some((value) => value.includes("lifecycle-execution"));
  process.stdout.write(JSON.stringify(execution ? {
    Id: ${JSON.stringify(executionPlatform.configurationDigest)}, Os: "linux", Architecture: "amd64",
    RepoDigests: [${JSON.stringify(`${execution.repository}@${execution.indexDigest}`)}],
    Config: { User: "65532:65532", Labels: {
      "org.opencontainers.image.revision": ${JSON.stringify(manifest.distribution.sourceRevision)},
      "org.opencontainers.image.version": "1.0.0",
      "io.lifecycle.execution-image.v1.qualification-revision": "lifecycle.foundation.1.0.0-rc.17",
      "io.lifecycle.execution-image.v1.image-id": ${JSON.stringify(execution.imageId)},
      "io.lifecycle.execution-image.v1.runner-contract-id": ${JSON.stringify(execution.runnerContractId)},
      "io.lifecycle.execution-image.v1.runner-contract-digest": ${JSON.stringify(execution.runnerContractDigest)},
      "io.lifecycle.execution-image.v1.runner-implementation-digest": ${JSON.stringify(execution.runnerImplementationDigest)},
      "io.lifecycle.execution-image.v1.tool-inventory-digest": ${JSON.stringify(executionPlatform.toolInventoryDigest)},
      "io.lifecycle.execution-image.v1.codex-version": ${JSON.stringify(execution.codexVersion)},
      "io.lifecycle.execution-image.v1.codex-executable-identity": ${JSON.stringify(executionPlatform.codexExecutableDigest)},
      "io.lifecycle.execution-image.v1.adapter-implementation-digest": ${JSON.stringify(execution.agentAdapterImplementationDigest)}
    } }
  } : {
    Id: ${JSON.stringify(runtimePlatform.configurationDigest)}, Os: "linux", Architecture: "amd64",
    RepoDigests: [${JSON.stringify(`${runtime.repository}@${runtime.indexDigest}`)}],
    Config: { Labels: {
      "org.opencontainers.image.revision": ${JSON.stringify(manifest.distribution.sourceRevision)},
      "org.opencontainers.image.version": "1.0.0",
      "io.lifecycle.runtime-image.qualification-revision": "lifecycle.foundation.1.0.0-rc.17",
      "io.lifecycle.runtime-image.runtime-invocation-protocol": "lifecycle.runtime-invocation.private.v1"
    } }
  }));
} else if (args.includes("run")) {
  const cid = args[args.indexOf("--cidfile") + 1];
  writeFileSync(cid, ${JSON.stringify(`${"3".repeat(64)}\n`)});
  process.exit(17);
}
`;
  await writeFile(fakeDocker, script);
  await chmod(fakeDocker, 0o755);
  await mkdir(join(root, ".docker"));
  await writeFile(join(root, ".docker", "config.json"), JSON.stringify({
    proxies: { default: { httpProxy: "http://credential@ambient.invalid" } },
  }));
  await writeFile(stalePresent, "present\n");
  await writeFile(stopMode, "absent");
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(socket, resolveListen);
  });
  await symlink(socket, socketAlias);
  const environment = {
    HOME: root,
    LIFECYCLE_DISTRIBUTION_DOCKER_HOST: `unix://${socketAlias}`,
    LIFECYCLE_DISTRIBUTION_DOCKER_PATH: fakeDocker,
    LIFECYCLE_MACHINE_HOME: machineHome,
    PATH: process.env.PATH,
  };
  try {
    assert.equal(await runDistributionLauncher(
      "lifecycle",
      ["setup", "--model", "model.test", "--reasoning", "high"],
      manifest,
      { ...environment, LIFECYCLE_MACHINE_HOME: "relative-state" },
    ), 2);
    assert.equal(await runDistributionLauncher(
      "lifecycle",
      ["setup", "--model", "model.test", "--reasoning", "high"],
      manifest,
      { ...environment, LIFECYCLE_MACHINE_HOME: undefined, XDG_STATE_HOME: "relative-state" },
    ), 2);
    assert.equal((await readFile(log, "utf8").catch(() => "")), "");
    assert.equal(await runDistributionLauncher(
      "lifecycle",
      ["setup", "--model", "model.test", "--reasoning", "high"],
      manifest,
      environment,
    ), 0);
    for (const directory of [
      join(machineHome, "codex-exec-home"),
      join(machineHome, "distribution", "docker-config"),
      join(machineHome, "distribution", "runtime-home"),
    ]) assert.equal((await readdir(directory)).length, 0);
    const config = await readFile(join(machineHome, "distribution", "config.json"), "utf8");
    assert.match(config, /"model": "model\.test"/u);

    const runtimeHome = join(machineHome, "distribution", "runtime-home");
    await chmod(runtimeHome, 0o770);
    assert.equal(await runDistributionLauncher("lifecycle", ["doctor"], manifest, environment), 2);
    await chmod(runtimeHome, 0o700);

    // Patch the fake prior-revision record with this state root's non-secret label.
    const stateDigest = `sha256:${(await import("node:crypto")).createHash("sha256")
      .update(machineHome, "utf8").digest("hex")}`;
    const updated = (await readFile(fakeDocker, "utf8")).replace("STATE_ROOT_DIGEST", stateDigest);
    await writeFile(fakeDocker, updated);
    await chmod(fakeDocker, 0o755);
    const staleDirectory = join(machineHome, "distribution", "invocations", staleInvocation);
    await mkdir(staleDirectory, { recursive: true, mode: 0o700 });
    await writeFile(join(staleDirectory, "heartbeat"), "0\n", { mode: 0o600 });
    await utimes(join(staleDirectory, "heartbeat"), new Date(0), new Date(0));

    assert.equal(await runDistributionLauncher("lifecycle", ["version"], manifest, environment), 17);
    assert.deepEqual(await readdir(join(machineHome, "distribution", "invocations")), []);
    const entries = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.ok(entries.every((args) => args[0] === "--host" && args[1] === `unix://${socket}`));
    const run = entries.find((args) => args.includes("run"));
    assert.ok(run.includes("--interactive"));
    assert.ok(!run.includes("--tty"));
    assert.ok(run.includes(`LIFECYCLE_EXECUTION_IMAGE_DIGEST=${executionPlatform.configurationDigest}`));
    assert.ok(!run.includes(`LIFECYCLE_EXECUTION_IMAGE_DIGEST=${execution.indexDigest}`));
    assert.ok(entries.some((args) => args.includes("stop") && args.includes(staleId)));
    assert.ok(!entries.some((args) => args.includes("rm") && args.includes("--force")));
    assert.ok(run.some((value: string) => value.includes("/tmp:rw,nosuid,nodev,noexec,size=536870912")));
    assert.ok(run.some((value: string) => value.includes(
      "/var/lib/lifecycle/distribution/invocations:rw,nosuid,nodev,noexec,size=1048576",
    )));
    assert.ok(run.includes(`type=bind,src=${socket},dst=/run/lifecycle/docker.sock`));

    // A failed stop with the exact container still present requires a forced
    // remove. A racing --rm disappearance after that failed remove is success
    // only after the exact final-absence observation.
    await writeFile(stalePresent, "present\n");
    await writeFile(stopMode, "force");
    await mkdir(staleDirectory, { recursive: true, mode: 0o700 });
    await writeFile(join(staleDirectory, "heartbeat"), "0\n", { mode: 0o600 });
    await utimes(join(staleDirectory, "heartbeat"), new Date(0), new Date(0));
    assert.equal(await runDistributionLauncher("lifecycle", ["version"], manifest, environment), 17);
    assert.deepEqual(await readdir(join(machineHome, "distribution", "invocations")), []);
    const afterForcedRemoval = (await readFile(log, "utf8")).trim().split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(afterForcedRemoval.some((args) => args.includes("rm") && args.includes("--force")));

    const compatibleDocker = await readFile(fakeDocker, "utf8");
    await writeFile(fakeDocker, compatibleDocker.replace('ApiVersion: "1.48"', 'ApiVersion: "1.47"'));
    await chmod(fakeDocker, 0o755);
    assert.equal(await runDistributionLauncher("lifecycle", ["doctor"], manifest, environment), 2);
    await writeFile(fakeDocker, compatibleDocker.replace('ApiVersion: "1.48"', 'ApiVersion: "1.48.0"'));
    await chmod(fakeDocker, 0o755);
    assert.equal(await runDistributionLauncher("lifecycle", ["doctor"], manifest, environment), 2);
    await writeFile(fakeDocker, compatibleDocker);
    await chmod(fakeDocker, 0o755);

    // Make stale discovery succeed while removing the Docker client before the
    // asynchronous launch. The exact invocation support must still disappear.
    const removable = (await readFile(fakeDocker, "utf8"))
      .replace(
        'import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";',
        'import { appendFileSync, existsSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";',
      )
      .replace(
        "const args = process.argv.slice(2);",
        'const args = process.argv.slice(2);\nif (args.includes("ps")) { unlinkSync(process.argv[1]); process.exit(0); }',
      );
    await writeFile(fakeDocker, removable);
    await chmod(fakeDocker, 0o755);
    assert.equal(await runDistributionLauncher("lifecycle", ["version"], manifest, environment), 1);
    assert.deepEqual(await readdir(join(machineHome, "distribution", "invocations")), []);
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    await rm(root, { force: true, recursive: true });
  }
});

test("Runtime supervisor contains the product process after launcher heartbeat loss", async () => {
  const root = await mkdtemp("/tmp/lifecycle-supervisor-");
  const invocationPath = join(root, "invocation.json");
  const heartbeatPath = join(root, "heartbeat");
  const markerPath = join(root, "child-events");
  const productPath = join(root, "lifecycle-product.mjs");
  const supervisorPath = join(root, "runtime-supervisor.mjs");
  try {
    await writeFile(productPath, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(${JSON.stringify(markerPath)}, "started\\n");
process.on("SIGTERM", () => {
  appendFileSync(${JSON.stringify(markerPath)}, "contained\\n");
  process.exit(143);
});
setInterval(() => {}, 1_000);
`);
    await chmod(productPath, 0o755);
    const source = await readFile(
      new URL("../../../runtime-image/runtime-supervisor.mjs", import.meta.url),
      "utf8",
    );
    const transformed = source
      .replace("const HEARTBEAT_INTERVAL_MS = 500;", "const HEARTBEAT_INTERVAL_MS = 100;")
      .replace("const MISSED_HEARTBEAT_LIMIT = 10;", "const MISSED_HEARTBEAT_LIMIT = 5;")
      .replace("const FORCE_DELAY_MS = 1_500;", "const FORCE_DELAY_MS = 200;")
      .replaceAll('"/run/lifecycle-invocation/invocation.json"', JSON.stringify(invocationPath))
      .replaceAll('"/run/lifecycle-invocation/heartbeat"', JSON.stringify(heartbeatPath))
      .replace('"/opt/lifecycle/bin/lifecycle"', JSON.stringify(productPath));
    assert.notEqual(transformed, source);
    await writeFile(supervisorPath, transformed);
    await writeFile(heartbeatPath, "0\n", { mode: 0o600 });
    await writeFile(invocationPath, canonicalManifestBytes({
      heartbeatFile: heartbeatPath,
      heartbeatIntervalMilliseconds: 100,
      invocationId: "00000000-0000-4000-8000-000000000002",
      missedHeartbeatLimit: 5,
      schema: "lifecycle.runtime-invocation.private.v1",
    }), { mode: 0o600 });

    const supervisor = spawn(process.execPath, [supervisorPath, "lifecycle"], {
      env: { ...process.env, LIFECYCLE_RUNTIME_INVOCATION_FILE: invocationPath },
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    supervisor.stderr.setEncoding("utf8");
    supervisor.stderr.on("data", (chunk: string) => { stderr += chunk; });
    const result = await new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>(
      (resolveResult, reject) => {
        const timeout = setTimeout(() => {
          supervisor.kill("SIGKILL");
          reject(new Error("Runtime supervisor did not contain its child after heartbeat loss"));
        }, 3_000);
        supervisor.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        supervisor.once("exit", (code, signal) => {
          clearTimeout(timeout);
          resolveResult(Object.freeze({ code, signal }));
        });
      },
    );
    assert.deepEqual(result, { code: 143, signal: null });
    assert.equal(stderr, "");
    assert.equal(await readFile(markerPath, "utf8"), "started\ncontained\n");
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("CLI bin gates Node before dynamically importing product code", async () => {
  for (const name of ["lifecycle.mjs"]) {
    const bin = new URL(`../../bin/${name}`, import.meta.url);
    const source = await readFile(bin, "utf8");
    assert.notEqual((await stat(bin)).mode & 0o111, 0);
    assert.ok(source.indexOf("process.versions.node") < source.indexOf("await import"));
    assert.doesNotMatch(source, /^import /mu);
    for (const version of ["24.13.99", "24.14.0-rc.1"]) {
      const result = spawnSync(process.execPath, ["--input-type=module", "--eval", `
Object.defineProperty(process.versions, "node", { configurable: true, value: ${JSON.stringify(version)} });
process.argv = [process.execPath, ${JSON.stringify(bin.pathname)}];
await import(${JSON.stringify(bin.href)});
`], { encoding: "utf8", shell: false });
      assert.equal(result.status, 1);
      assert.equal(result.stderr, "Lifecycle requires Node.js 24.14.0 or newer.\n");
    }
    const accepted = spawnSync(process.execPath, ["--input-type=module", "--eval", `
Object.defineProperty(process.versions, "node", { configurable: true, value: "24.14.0" });
process.argv = [process.execPath, ${JSON.stringify(bin.pathname)}];
await import(${JSON.stringify(bin.href)});
`], { encoding: "utf8", shell: false });
    assert.doesNotMatch(accepted.stderr, /requires Node\.js/u);
  }
});
