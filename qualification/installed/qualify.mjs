#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(import.meta.url);
const WORKSPACE = resolve(dirname(SCRIPT), "..", "..");
const MAXIMUM_CAPTURE_BYTES = 16 * 1024 * 1024;
const PACKAGE_NAME = "@neutral/lifecycle";
const PACKAGE_VERSION = "1.0.0";
const QUALIFICATION_PACKAGE_VERSION = "0.0.0-qualification";
const TARBALL_NAME = "neutral-lifecycle-0.0.0-qualification.tgz";
const RUNTIME_REPOSITORY = "ghcr.io/neutral/lifecycle-runtime";
const EXECUTION_REPOSITORY = "ghcr.io/neutral/lifecycle-execution";
const SOURCE_REVISION = "f".repeat(40);

const digest = (character) => `sha256:${character.repeat(64)}`;
const SYNTHETIC = Object.freeze({
  runtimeIndex: digest("1"),
  runtime: Object.freeze({
    amd64: Object.freeze({ configuration: digest("2") }),
    arm64: Object.freeze({ configuration: digest("4") }),
  }),
  executionIndex: digest("6"),
  execution: Object.freeze({
    amd64: Object.freeze({
      configuration: digest("7"),
      codex: digest("9"),
      tools: digest("a"),
    }),
    arm64: Object.freeze({
      configuration: digest("b"),
      codex: digest("d"),
      tools: digest("e"),
    }),
  }),
  runner: digest("0"),
  contract: digest("a"),
});

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalValue(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalValue);
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(canonicalValue(value), null, 2)}\n`, "utf8");
}

function syntheticManifest() {
  const platform = (architecture, values) => ({
    architecture,
    configurationDigest: values.configuration,
    os: "linux",
    variant: null,
  });
  const executionPlatform = (architecture, values) => ({
    architecture,
    codexExecutableDigest: values.codex,
    configurationDigest: values.configuration,
    os: "linux",
    toolInventoryDigest: values.tools,
    variant: null,
  });
  return {
    coordinates: {
      interfaceProtocol: "lifecycle.interface.foundation.v10",
      providerAdapter: "lifecycle.provider-adapter.v6",
      qualificationRevision: "lifecycle.foundation.1.0.0-rc.10",
      repositoryContract: "lifecycle.repository.v15",
      runtimeProtocol: "lifecycle.runtime.foundation.v10",
    },
    distribution: {
      nodeMinimum: "24.14.0",
      npmPackage: PACKAGE_NAME,
      runtimeInvocationProtocol: "lifecycle.runtime-invocation.private.v1",
      sourceRevision: SOURCE_REVISION,
      version: PACKAGE_VERSION,
    },
    images: {
      execution: {
        agentAdapterImplementationDigest: SYNTHETIC.runner,
        codexVersion: "0.151.0",
        imageId: "lifecycle-execution-synthetic-qualification",
        indexDigest: SYNTHETIC.executionIndex,
        nonRootUser: "65532:65532",
        platforms: [
          executionPlatform("amd64", SYNTHETIC.execution.amd64),
          executionPlatform("arm64", SYNTHETIC.execution.arm64),
        ],
        repository: EXECUTION_REPOSITORY,
        runnerContractDigest: SYNTHETIC.contract,
        runnerContractId: "lifecycle.execution-cell-runner.v1",
        runnerImplementationDigest: SYNTHETIC.runner,
      },
      runtime: {
        indexDigest: SYNTHETIC.runtimeIndex,
        platforms: [
          platform("amd64", SYNTHETIC.runtime.amd64),
          platform("arm64", SYNTHETIC.runtime.arm64),
        ],
        repository: RUNTIME_REPOSITORY,
      },
    },
    schema: "lifecycle.distribution-manifest.v1",
  };
}

function cleanEnvironment(overrides = {}) {
  const environment = {
    HOME: overrides.HOME ?? "/tmp",
    PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter),
  };
  for (const name of ["LANG", "LC_ALL", "LC_CTYPE", "TZ", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"]) {
    const value = process.env[name];
    if (typeof value === "string" && !value.includes("\0")) environment[name] = value;
  }
  return Object.assign(environment, overrides);
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? cleanEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let captureExceeded = false;
    let timedOut = false;
    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes <= MAXIMUM_CAPTURE_BYTES) stdout.push(Buffer.from(chunk));
      else {
        captureExceeded = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes <= MAXIMUM_CAPTURE_BYTES) stderr.push(Buffer.from(chunk));
      else {
        captureExceeded = true;
        child.kill("SIGKILL");
      }
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs ?? 120_000);
    timer.unref();
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectRun(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolveRun(Object.freeze({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        captureExceeded,
        timedOut,
      }));
    });
    options.onChild?.(child);
  });
}

function succeeded(result, label) {
  assert.equal(result.timedOut, false, `${label} timed out`);
  assert.equal(result.captureExceeded, false, `${label} exceeded its output bound`);
  assert.equal(result.signal, null, `${label} exited by ${result.signal}: ${result.stderr}`);
  assert.equal(result.code, 0, `${label} failed: ${result.stderr}`);
  return result;
}

async function waitFor(path, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await lstat(path);
      return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function exactNpmCli() {
  const candidates = [
    process.env.npm_execpath,
    resolve(dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ].filter((value) => typeof value === "string" && value.length > 0);
  for (const candidate of candidates) {
    try {
      const state = await lstat(candidate);
      if (state.isFile()) return realpath(candidate);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  throw new Error("Installed qualification cannot resolve npm's exact Node CLI");
}

async function readLog(path) {
  let bytes;
  try {
    bytes = await readFile(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  assert.ok(Buffer.byteLength(bytes) <= MAXIMUM_CAPTURE_BYTES, "fake Docker log exceeded its bound");
  return bytes.split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function dockerOperation(entry) {
  const args = entry.args;
  assert.equal(args[0], "--host", "every Docker operation must select the exact endpoint");
  return args.slice(2);
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  assert.notEqual(index, -1, `Docker invocation omitted ${name}`);
  assert.ok(args[index + 1], `Docker invocation omitted ${name}'s value`);
  return args[index + 1];
}

async function writeFakeDocker(
  path,
  logPath,
  signalReadyPath,
  mismatchPath,
  socketPath,
  manifest,
  architecture,
) {
  const selectedRuntime = manifest.images.runtime.platforms.find((entry) => entry.architecture === architecture);
  const selectedExecution = manifest.images.execution.platforms.find((entry) => entry.architecture === architecture);
  const runtimeReference = `${RUNTIME_REPOSITORY}@${manifest.images.runtime.indexDigest}`;
  const executionReference = `${EXECUTION_REPOSITORY}@${manifest.images.execution.indexDigest}`;
  const runtimeInspection = {
    Architecture: architecture,
    Config: {
      Labels: {
        "io.lifecycle.runtime-image.qualification-revision": manifest.coordinates.qualificationRevision,
        "io.lifecycle.runtime-image.runtime-invocation-protocol":
          manifest.distribution.runtimeInvocationProtocol,
        "org.opencontainers.image.revision": manifest.distribution.sourceRevision,
        "org.opencontainers.image.version": manifest.distribution.version,
      },
    },
    Id: selectedRuntime.configurationDigest,
    Os: "linux",
    RepoDigests: [runtimeReference],
  };
  const executionInspection = {
    Architecture: architecture,
    Config: {
      Labels: {
        "io.lifecycle.execution-image.v1.adapter-implementation-digest":
          manifest.images.execution.agentAdapterImplementationDigest,
        "io.lifecycle.execution-image.v1.codex-executable-identity":
          selectedExecution.codexExecutableDigest,
        "io.lifecycle.execution-image.v1.codex-version": manifest.images.execution.codexVersion,
        "io.lifecycle.execution-image.v1.image-id": manifest.images.execution.imageId,
        "io.lifecycle.execution-image.v1.qualification-revision":
          manifest.coordinates.qualificationRevision,
        "io.lifecycle.execution-image.v1.runner-contract-digest":
          manifest.images.execution.runnerContractDigest,
        "io.lifecycle.execution-image.v1.runner-contract-id":
          manifest.images.execution.runnerContractId,
        "io.lifecycle.execution-image.v1.runner-implementation-digest":
          manifest.images.execution.runnerImplementationDigest,
        "io.lifecycle.execution-image.v1.tool-inventory-digest": selectedExecution.toolInventoryDigest,
        "org.opencontainers.image.revision": manifest.distribution.sourceRevision,
        "org.opencontainers.image.version": manifest.distribution.version,
      },
      User: manifest.images.execution.nonRootUser,
    },
    Id: selectedExecution.configurationDigest,
    Os: "linux",
    RepoDigests: [executionReference],
  };
  const source = `#!${process.execPath}
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
const logPath = ${JSON.stringify(logPath)};
const signalReadyPath = ${JSON.stringify(signalReadyPath)};
const mismatchPath = ${JSON.stringify(mismatchPath)};
const expectedSocket = ${JSON.stringify(`unix://${socketPath}`)};
const runtimeReference = ${JSON.stringify(runtimeReference)};
const executionReference = ${JSON.stringify(executionReference)};
const runtimeInspection = ${JSON.stringify(runtimeInspection)};
const executionInspection = ${JSON.stringify(executionInspection)};
const args = process.argv.slice(2);
appendFileSync(logPath, JSON.stringify({ args }) + "\\n", { mode: 0o600 });
if (args[0] !== "--host" || args[1] !== expectedSocket) process.exit(91);
const operation = args.slice(2);
if (operation[0] === "version") {
  process.stdout.write(JSON.stringify({ ApiVersion: "1.48" }));
} else if (operation[0] === "info") {
  process.stdout.write(JSON.stringify({ Architecture: ${JSON.stringify(architecture === "amd64" ? "x86_64" : "aarch64")}, OSType: "linux" }));
} else if (operation[0] === "pull") {
  if (![runtimeReference, executionReference].includes(operation.at(-1))) process.exit(92);
} else if (operation[0] === "image" && operation[1] === "inspect") {
  if (operation[2] === runtimeReference) {
    if (existsSync(mismatchPath)) {
      runtimeInspection.Config.Labels["org.opencontainers.image.revision"] = "0".repeat(40);
    }
    process.stdout.write(JSON.stringify(runtimeInspection));
  }
  else if (operation[2] === executionReference) process.stdout.write(JSON.stringify(executionInspection));
  else process.exit(93);
} else if (operation[0] === "ps") {
  process.stdout.write("");
} else if (operation[0] === "run") {
  const cidfile = operation[operation.indexOf("--cidfile") + 1];
  writeFileSync(cidfile, "c".repeat(64) + "\\n", { mode: 0o600 });
  const imageIndex = operation.indexOf(runtimeReference);
  if (imageIndex === -1) process.exit(94);
  const command = operation[imageIndex + 1];
  const forwarded = operation.slice(imageIndex + 2);
  if (forwarded[0] === "signal-test") {
    writeFileSync(signalReadyPath, "ready\\n", { mode: 0o600 });
    for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"]) {
      process.on(signal, () => {
        appendFileSync(logPath, JSON.stringify({ forwardedSignal: signal }) + "\\n");
        process.exit(signal === "SIGHUP" ? 129 : signal === "SIGINT" ? 130 : 143);
      });
    }
    setInterval(() => {}, 1_000);
  } else if (forwarded[0] === "exit-37") {
    process.exit(37);
  } else {
    process.stdout.write("synthetic-runtime:" + command + ":" + JSON.stringify(forwarded) + "\\n");
  }
} else {
  process.exit(95);
}
`;
  await writeFile(path, source, { flag: "wx", mode: 0o700 });
  await chmod(path, 0o700);
}

function assertPackageInventory(paths) {
  assert.deepEqual(paths, [
    "package/README.md",
    "package/bin/lifecycle-tui.mjs",
    "package/bin/lifecycle.mjs",
    "package/dist/src/launcher.d.ts",
    "package/dist/src/launcher.js",
    "package/dist/src/main.d.ts",
    "package/dist/src/main.js",
    "package/dist/src/manifest.d.ts",
    "package/dist/src/manifest.js",
    "package/manifest/distribution-manifest.json",
    "package/manifest/distribution-manifest.sha256",
    "package/package.json",
  ]);
  for (const path of paths) {
    assert.equal(path.includes("/src/"), path.startsWith("package/dist/src/"), `${path} exposes source`);
    assert.ok(!/(?:^|\/)(?:tests?|runtime|protocol|clients|node_modules)(?:\/|$)/u.test(path), `${path} exposes an internal owner`);
    assert.ok(!/\.map$/u.test(path), `${path} exposes a source map`);
    assert.ok(!/(?<!\.d)\.(?:ts|tsx)$/u.test(path), `${path} exposes authoring source`);
  }
}

async function assertInstalledContent(packageRoot, manifest) {
  const metadata = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  assert.equal(metadata.name, PACKAGE_NAME);
  assert.equal(metadata.version, QUALIFICATION_PACKAGE_VERSION);
  assert.deepEqual(metadata.bin, {
    lifecycle: "bin/lifecycle.mjs",
    "lifecycle-tui": "bin/lifecycle-tui.mjs",
  });
  assert.equal("scripts" in metadata, false, "published metadata must have no npm lifecycle scripts");
  assert.equal("dependencies" in metadata, false, "launcher package must have no installed dependencies");
  assert.equal("devDependencies" in metadata, false, "launcher package must not publish build dependencies");
  assert.equal(metadata.private, true, "qualification package must be mechanically unpublishable");
  assert.equal(
    metadata.lifecycleQualificationOnly,
    true,
    "qualification package must carry its explicit non-release discriminator",
  );

  const installedManifest = await readFile(join(packageRoot, "manifest", "distribution-manifest.json"));
  assert.ok(installedManifest.equals(canonicalBytes(manifest)), "installed manifest changed from packed bytes");
  assert.equal(
    (await readFile(join(packageRoot, "manifest", "distribution-manifest.sha256"), "utf8")),
    `${sha256(installedManifest)}\n`,
  );

  const sensitive = [
    /-----BEGIN [^-\n]*PRIVATE KEY-----/u,
    /(?:^|[^A-Za-z0-9])sk-[A-Za-z0-9_-]{20,}/u,
    /\/Users\/[^/\s]+\//u,
    /\/home\/[^/\s]+\//u,
  ];
  const files = [
    "README.md",
    "bin/lifecycle.mjs",
    "bin/lifecycle-tui.mjs",
    "dist/src/launcher.d.ts",
    "dist/src/launcher.js",
    "dist/src/main.d.ts",
    "dist/src/main.js",
    "dist/src/manifest.d.ts",
    "dist/src/manifest.js",
    "manifest/distribution-manifest.json",
    "manifest/distribution-manifest.sha256",
    "package.json",
  ];
  let total = 0;
  for (const path of files) {
    const bytes = await readFile(join(packageRoot, path));
    total += bytes.byteLength;
    assert.ok(bytes.byteLength <= 256 * 1024, `${path} exceeds its package-entry bound`);
    const text = bytes.toString("utf8");
    for (const pattern of sensitive) assert.equal(pattern.test(text), false, `${path} contains sensitive material`);
  }
  assert.ok(total <= 512 * 1024, "installed launcher content exceeds its aggregate bound");
}

function assertSetupOperations(operations, manifest, architecture) {
  assert.deepEqual(operations.map((entry) => dockerOperation(entry).slice(0, 2)), [
    ["version", "--format"],
    ["info", "--format"],
    ["pull", "--platform"],
    ["pull", "--platform"],
    ["image", "inspect"],
    ["image", "inspect"],
  ]);
  const pulls = operations.map(dockerOperation).filter((args) => args[0] === "pull");
  assert.deepEqual(pulls, [
    ["pull", "--platform", `linux/${architecture}`, `${RUNTIME_REPOSITORY}@${manifest.images.runtime.indexDigest}`],
    ["pull", "--platform", `linux/${architecture}`, `${EXECUTION_REPOSITORY}@${manifest.images.execution.indexDigest}`],
  ]);
}

function assertRuntimeRun(entry, fixture) {
  const args = dockerOperation(entry);
  assert.equal(args[0], "run");
  for (const flag of ["--rm", "--init", "--read-only"]) assert.ok(args.includes(flag), `Runtime omitted ${flag}`);
  assert.equal(optionValue(args, "--pull"), "never");
  assert.equal(optionValue(args, "--network"), "none");
  assert.equal(optionValue(args, "--cap-drop"), "ALL");
  assert.equal(optionValue(args, "--security-opt"), "no-new-privileges");
  assert.equal(optionValue(args, "--workdir"), fixture.target);
  assert.equal(optionValue(args, "--platform"), `linux/${fixture.architecture}`);
  assert.equal(
    args.includes(`${RUNTIME_REPOSITORY}@${fixture.manifest.images.runtime.indexDigest}`),
    true,
    "Runtime was not selected by its index digest",
  );
  const mounts = args.flatMap((value, index) => value === "--mount" ? [args[index + 1]] : []);
  for (const required of [
    `type=bind,src=${fixture.machineHome},dst=/var/lib/lifecycle`,
    `type=bind,src=${fixture.socketPath},dst=/run/lifecycle/docker.sock`,
    `type=bind,src=${fixture.target},dst=${fixture.target}`,
    `type=bind,src=${fixture.input},dst=${fixture.input},readonly`,
    `type=bind,src=${fixture.authority},dst=${fixture.authority},readonly`,
  ]) assert.ok(mounts.includes(required), `Runtime mount set omitted ${required}`);
  assert.ok(mounts.some((value) => value.endsWith(",dst=/run/lifecycle-invocation,readonly")));

  const environment = new Map(args.flatMap((value, index) => value === "--env"
    ? [[args[index + 1].slice(0, args[index + 1].indexOf("=")), args[index + 1].slice(args[index + 1].indexOf("=") + 1)]]
    : []));
  const execution = fixture.manifest.images.execution;
  const platform = execution.platforms.find((entry) => entry.architecture === fixture.architecture);
  assert.equal(environment.get("LIFECYCLE_DOCKER_HOST"), "unix:///run/lifecycle/docker.sock");
  assert.equal(environment.get("LIFECYCLE_DOCKER_PATH"), "/usr/bin/docker");
  assert.equal(environment.get("LIFECYCLE_MACHINE_HOME"), "/var/lib/lifecycle");
  assert.equal(environment.get("LIFECYCLE_FOUNDATION_PROVIDER_MODEL"), "synthetic-model");
  assert.equal(environment.get("LIFECYCLE_FOUNDATION_PROVIDER_REASONING"), "high");
  assert.equal(environment.get("LIFECYCLE_EXECUTION_IMAGE_DIGEST"), platform.configurationDigest);
  assert.equal(environment.get("LIFECYCLE_EXECUTION_CODEX_EXECUTABLE_IDENTITY"), platform.codexExecutableDigest);
  assert.equal(environment.get("LIFECYCLE_EXECUTION_TOOL_INVENTORY_DIGEST"), platform.toolInventoryDigest);

  const imageIndex = args.indexOf(`${RUNTIME_REPOSITORY}@${fixture.manifest.images.runtime.indexDigest}`);
  assert.deepEqual(args.slice(imageIndex + 1), [
    "lifecycle",
    "initialize",
    fixture.target,
    "--input",
    fixture.input,
    "--authority-secret-file",
    fixture.authority,
  ]);
}

async function main() {
  const root = await realpath(await mkdtemp(join("/tmp", "lifecycle-dist-")));
  const packageDestination = join(root, "packed");
  const install = join(root, "install");
  const packCache = join(root, "pack-cache");
  const cache = join(root, "npm-cache");
  const home = join(root, "home");
  const machineHome = join(root, "machine-home");
  const target = join(root, "target");
  const carriers = join(root, "carriers");
  const socketPath = join(root, "docker.sock");
  const dockerPath = join(root, "fake-docker.mjs");
  const dockerLog = join(root, "docker-log.jsonl");
  const signalReady = join(root, "signal-ready");
  const imageMismatch = join(root, "image-mismatch");
  const manifestPath = join(root, "distribution-manifest.json");
  const input = join(carriers, "input.json");
  const authority = join(carriers, "authority-secret");
  let socketServer;
  try {
    await Promise.all([
      mkdir(packageDestination, { mode: 0o700 }),
      mkdir(install, { mode: 0o700 }),
      mkdir(packCache, { mode: 0o700 }),
      mkdir(cache, { mode: 0o700 }),
      mkdir(home, { mode: 0o700 }),
      mkdir(target, { mode: 0o700 }),
      mkdir(carriers, { mode: 0o700 }),
    ]);
    const manifest = syntheticManifest();
    await Promise.all([
      writeFile(manifestPath, canonicalBytes(manifest), { flag: "wx", mode: 0o600 }),
      writeFile(input, "{}\n", { flag: "wx", mode: 0o600 }),
      writeFile(authority, "synthetic-private-authority\n", { flag: "wx", mode: 0o600 }),
      writeFile(join(install, "package.json"), "{\"private\":true}\n", { flag: "wx", mode: 0o600 }),
    ]);

    const architecture = process.arch === "x64" ? "amd64" : process.arch === "arm64" ? "arm64" : null;
    assert.notEqual(architecture, null, `installed qualification does not support ${process.arch}`);
    socketServer = createServer((connection) => connection.destroy());
    await new Promise((resolveListen, rejectListen) => {
      socketServer.once("error", rejectListen);
      socketServer.listen(socketPath, resolveListen);
    });
    await writeFakeDocker(
      dockerPath,
      dockerLog,
      signalReady,
      imageMismatch,
      socketPath,
      manifest,
      architecture,
    );

    const environment = cleanEnvironment({
      HOME: home,
      LIFECYCLE_DISTRIBUTION_DOCKER_HOST: `unix://${socketPath}`,
      LIFECYCLE_DISTRIBUTION_DOCKER_PATH: dockerPath,
      LIFECYCLE_MACHINE_HOME: machineHome,
      npm_config_audit: "false",
      npm_config_cache: cache,
      npm_config_fund: "false",
      npm_config_ignore_scripts: "false",
      npm_config_offline: "true",
      npm_config_update_notifier: "false",
    });
    const packEnvironment = { ...environment, npm_config_cache: packCache };

    const pack = succeeded(await run(process.execPath, [
      join(WORKSPACE, "distribution", "scripts", "pack-qualification-fixture.mjs"),
      "--manifest", manifestPath,
      "--destination", packageDestination,
    ], { cwd: WORKSPACE, env: packEnvironment }), "distribution package assembly");
    const packLines = pack.stdout.trim().split("\n").filter(Boolean);
    const packResult = JSON.parse(packLines.at(-1));
    assert.equal(packResult.manifestDigest, sha256(canonicalBytes(manifest)));
    const entries = await readdir(packageDestination);
    assert.deepEqual(entries, [TARBALL_NAME], "assembly must emit exactly one non-release qualification tarball");
    const tarball = join(packageDestination, TARBALL_NAME);
    assert.ok((await stat(tarball)).size <= 512 * 1024, "launcher tarball exceeds its size bound");

    const inventory = succeeded(await run("/usr/bin/tar", ["-tzf", tarball], { env: environment }), "tarball inventory")
      .stdout.split("\n").filter((path) => path.length > 0 && !path.endsWith("/")).sort();
    assertPackageInventory(inventory);

    const npmCli = await exactNpmCli();
    assert.deepEqual(await readdir(cache), [], "cold-install npm cache was not initially empty");
    succeeded(await run(process.execPath, [npmCli, "install", "--global", "--prefix", install, "--offline", "--no-audit", "--no-fund", tarball], {
      cwd: install,
      env: environment,
    }), "cold offline launcher install");
    const packageRoot = join(install, "lib", "node_modules", "@neutral", "lifecycle");
    await assertInstalledContent(packageRoot, manifest);
    assert.equal(
      await readdir(join(install, "lib", "node_modules", "@neutral")).then((values) => values.join(",")),
      "lifecycle",
    );

    const lifecycle = join(install, "bin", "lifecycle");
    const tui = join(install, "bin", "lifecycle-tui");
    const beforeSetup = await readLog(dockerLog);
    assert.equal(beforeSetup.length, 0, "packing and installation must not execute Docker or npm lifecycle effects");

    const setup = succeeded(await run(lifecycle, ["setup", "--model", "synthetic-model", "--reasoning", "high"], {
      cwd: root,
      env: environment,
    }), "installed setup");
    assert.equal(setup.stdout, `Lifecycle ${PACKAGE_VERSION} is installed for linux/${architecture}.\n`);
    const afterSetup = await readLog(dockerLog);
    assertSetupOperations(afterSetup, manifest, architecture);

    const configPath = join(machineHome, "distribution", "config.json");
    const config = await readFile(configPath, "utf8");
    assert.equal(config, `${JSON.stringify({ model: "synthetic-model", reasoning: "high", schema: "lifecycle.distribution-installation-config.private.v1" }, null, 2)}\n`);
    assert.equal((await lstat(configPath)).mode & 0o777, 0o600);
    for (const path of [
      machineHome,
      join(machineHome, "distribution"),
      join(machineHome, "distribution", "docker-config"),
      join(machineHome, "distribution", "runtime-home"),
      join(machineHome, "distribution", "invocations"),
      join(machineHome, "codex-exec-home"),
    ]) {
      assert.equal((await lstat(path)).mode & 0o777, 0o700, `${path} is not owner-private`);
    }

    const doctorStart = afterSetup.length;
    const doctor = succeeded(await run(lifecycle, ["doctor"], { cwd: root, env: environment }), "installed doctor");
    assert.equal(doctor.stdout, `Lifecycle ${PACKAGE_VERSION} distribution is ready for linux/${architecture}.\n`);
    const afterDoctor = await readLog(dockerLog);
    const doctorOperations = afterDoctor.slice(doctorStart).map(dockerOperation);
    assert.deepEqual(doctorOperations.map((args) => args.slice(0, 2)), [
      ["version", "--format"],
      ["info", "--format"],
      ["image", "inspect"],
      ["image", "inspect"],
    ]);
    assert.equal(doctorOperations.some((args) => args[0] === "pull"), false, "doctor must not pull images");

    await writeFile(imageMismatch, "mismatch\n", { flag: "wx", mode: 0o600 });
    const mismatchedDoctor = await run(lifecycle, ["doctor"], { cwd: root, env: environment });
    assert.equal(mismatchedDoctor.signal, null);
    assert.equal(mismatchedDoctor.code, 2, "doctor accepted a substituted Runtime Image label");
    assert.equal(mismatchedDoctor.stdout, "");
    assert.match(mismatchedDoctor.stderr, /Runtime Image labels differ from the Distribution Manifest/u);
    await rm(imageMismatch);

    const initialize = succeeded(await run(lifecycle, [
      "initialize",
      target,
      "--input",
      input,
      "--authority-secret-file",
      authority,
    ], { cwd: root, env: environment }), "Runtime argument forwarding");
    assert.equal(initialize.stdout, `synthetic-runtime:lifecycle:[\"initialize\",\"${target}\",\"--input\",\"${input}\",\"--authority-secret-file\",\"${authority}\"]\n`);
    const afterInitialize = await readLog(dockerLog);
    const initializeRun = afterInitialize.slice(afterDoctor.length).find((entry) => dockerOperation(entry)[0] === "run");
    assert.ok(initializeRun, "installed launcher did not start the Runtime");
    assertRuntimeRun(initializeRun, { architecture, authority, input, machineHome, manifest, socketPath, target });

    for (const [label, executable, arguments_, expected] of [
      ["Runtime help", lifecycle, ["--help"], "synthetic-runtime:lifecycle:[\"--help\"]\n"],
      ["Runtime version", lifecycle, ["version"], "synthetic-runtime:lifecycle:[\"version\"]\n"],
      ["TUI forwarding", tui, ["--target", target], `synthetic-runtime:lifecycle-tui:[\"--target\",\"${target}\"]\n`],
    ]) {
      const result = succeeded(await run(executable, arguments_, { cwd: root, env: environment }), label);
      assert.equal(result.stdout, expected);
    }

    const exit = await run(lifecycle, ["exit-37"], { cwd: root, env: environment });
    assert.equal(exit.signal, null);
    assert.equal(exit.code, 37, "Runtime exit status was not forwarded");

    let signalChild;
    const signalled = run(lifecycle, ["signal-test"], {
      cwd: root,
      env: environment,
      timeoutMs: 20_000,
      onChild: (child) => { signalChild = child; },
    });
    await waitFor(signalReady);
    signalChild.kill("SIGTERM");
    const signalResult = await signalled;
    assert.equal(signalResult.signal, null);
    assert.equal(signalResult.code, 143, "Runtime signal exit status was not forwarded");
    assert.ok((await readLog(dockerLog)).some((entry) => entry.forwardedSignal === "SIGTERM"), "SIGTERM did not reach the Runtime transport");

    const completeLog = await readLog(dockerLog);
    const pulls = completeLog.filter((entry) => entry.args && dockerOperation(entry)[0] === "pull");
    assert.equal(pulls.length, 2, "normal invocation implicitly pulled an image");
    for (const runEntry of completeLog.filter((entry) => entry.args && dockerOperation(entry)[0] === "run")) {
      assert.equal(optionValue(dockerOperation(runEntry), "--pull"), "never");
    }

    process.stdout.write(`${JSON.stringify({
      evidenceLimit: "synthetic launcher boundary only; no GHCR, Docker daemon, Runtime Image, Execution Image, Execution Cell, provider, publication, or conformance evidence",
      manifestDigest: sha256(canonicalBytes(manifest)),
      packageFixture: `${PACKAGE_NAME}@${QUALIFICATION_PACKAGE_VERSION}`,
      selectedDistribution: `${PACKAGE_NAME}@${PACKAGE_VERSION}`,
      passed: true,
    })}\n`);
  } finally {
    if (socketServer !== undefined) {
      await new Promise((resolveClose) => socketServer.close(resolveClose));
    }
    await rm(root, { force: true, recursive: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
