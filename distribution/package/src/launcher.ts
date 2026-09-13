import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  accessSync,
  chmodSync,
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  opendirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
  type BigIntStats,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import {
  delimiter,
  dirname,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  canonicalManifestBytes,
  type DistributionArchitecture,
  type DistributionExecutionPlatformSelection,
  type DistributionManifest,
  type DistributionPlatformSelection,
  platformSelection,
  RUNTIME_INVOCATION_PROTOCOL,
} from "./manifest.js";
import {
  HEARTBEAT_INTERVAL_MS,
  INVOCATION_LABEL_PREFIX,
  MISSED_HEARTBEAT_LIMIT,
  mountArgument,
  RUNTIME_INVOCATION_MASK_TMPFS_BYTES,
  RUNTIME_TMPFS_BYTES,
  signalExitCode,
  stateRootDigest,
  updateRuntimeInvocationHeartbeat,
  writeRuntimeInvocationSupport,
} from "./invocation-support.js";
import type {
  DockerBoundary,
  DockerPlatform,
  HostInstallation,
  InstallationConfig,
  PreparedInvocation,
} from "./launcher-context.js";

export type DistributionCommand = "lifecycle";

const CONFIG_SCHEMA = "lifecycle.distribution-installation-config.private.v1";
const MAXIMUM_COMMAND_OUTPUT_BYTES = 1024 * 1024;
const MINIMUM_DOCKER_API_VERSION = Object.freeze([1n, 48n] as const);
const OPAQUE_SELECTION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const CONTAINER_ID = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const SOURCE_REVISION = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u;
const TARGET_ACTIONS = new Set([
  "accept",
  "admit",
  "continue",
  "diff",
  "evaluate",
  "export",
  "inbox",
  "initialize",
  "inspect",
  "no-ship",
  "prepare",
  "reaffirm",
  "recover",
  "revise",
  "status",
  "validate",
  "watch",
]);
const FILE_OPTIONS = new Set(["--authority-secret-file", "--input"]);
const DOCKER_DISCOVERY_ENVIRONMENT_NAMES = [
  "DOCKER_CONFIG",
  "DOCKER_CONTEXT",
  "DOCKER_HOST",
  "HOME",
  "LANG",
  "LC_ALL",
  "PATH",
  "TMPDIR",
  "TZ",
] as const;
const DOCKER_COMMAND_ENVIRONMENT_NAMES = [
  "LANG",
  "LC_ALL",
  "PATH",
  "TMPDIR",
  "TZ",
] as const;
const RESERVED_RUNTIME_MOUNT_TARGETS = [
  "/bin",
  "/dev",
  "/etc",
  "/lib",
  "/lib64",
  "/opt/lifecycle",
  "/opt/lifecycle-distribution",
  "/proc",
  "/run/lifecycle/docker.sock",
  "/run/lifecycle-invocation",
  "/sbin",
  "/sys",
  "/tmp",
  "/usr",
  "/var/lib/lifecycle",
] as const;
const DESCENDANT_MOUNTS_ALLOWED = new Set(["/tmp"]);

export class DistributionLauncherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DistributionLauncherError";
  }
}

function fail(message: string): never {
  throw new DistributionLauncherError(message);
}

export function assertDistributionHostPlatform(
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform !== "darwin" && platform !== "linux") {
    fail("this distribution supports only macOS and Linux hosts");
  }
}

function safeMessage(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu, "�").slice(0, 8_192);
}

function within(parent: string, child: string): boolean {
  const displacement = relative(parent, child);
  return displacement === "" || (
    displacement !== ".." && !displacement.startsWith(`..${sep}`) && !isAbsolute(displacement)
  );
}

function exactPath(value: string, label: string): string {
  const path = resolve(value);
  if (!isAbsolute(path) || normalize(path) !== path || path === parse(path).root ||
      path.endsWith(sep) || path.includes(",") || path.includes('"') ||
      /[\u0000-\u001f\u007f-\u009f]/u.test(path)) {
    fail(`${label} must be one normalized non-root path without control characters, commas, or double quotes`);
  }
  return path;
}

function exactDirectory(value: string, label: string, requireOwner = true): string {
  const path = exactPath(value, label);
  let state;
  let physical;
  try {
    state = lstatSync(path, { bigint: true });
    physical = realpathSync(path);
    accessSync(path, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK);
  } catch {
    fail(`${label} is unavailable to the invoking user`);
  }
  if (!state.isDirectory() || state.isSymbolicLink() || physical !== path) {
    fail(`${label} must be one canonical physical directory`);
  }
  const uid = process.getuid?.();
  if (requireOwner && uid !== undefined && state.uid !== BigInt(uid)) {
    fail(`${label} must be owned by the invoking user`);
  }
  if (requireOwner && (state.mode & 0o077n) !== 0n) {
    fail(`${label} must not grant group or other access`);
  }
  return path;
}

function ensurePrivateDirectory(path: string, label: string): string {
  const selected = exactPath(path, label);
  const existed = existsSync(selected);
  try {
    mkdirSync(selected, { mode: 0o700, recursive: true });
    if (!existed) chmodSync(selected, 0o700);
  } catch {
    fail(`${label} could not be created`);
  }
  const physical = exactDirectory(selected, label);
  const state = lstatSync(physical);
  if ((state.mode & 0o077) !== 0) fail(`${label} must not grant group or other access`);
  return physical;
}

function exactRegularFile(value: string, label: string): string {
  const path = exactPath(value, label);
  let state;
  let physical;
  try {
    state = lstatSync(path, { bigint: true });
    physical = realpathSync(path);
    accessSync(path, fsConstants.R_OK);
  } catch {
    fail(`${label} is unavailable`);
  }
  if (!state.isFile() || state.isSymbolicLink() || physical !== path) {
    fail(`${label} must be one canonical regular file`);
  }
  return path;
}

function defaultMachineHome(environment: NodeJS.ProcessEnv): string {
  const selected = environment.LIFECYCLE_MACHINE_HOME;
  if (selected !== undefined && selected.length > 0) {
    if (!isAbsolute(selected)) fail("LIFECYCLE_MACHINE_HOME must be one absolute path");
    return exactPath(selected, "Lifecycle machine home");
  }
  const stateHome = environment.XDG_STATE_HOME;
  if (stateHome !== undefined && stateHome.length > 0) {
    if (!isAbsolute(stateHome)) fail("XDG_STATE_HOME must be one absolute path");
    return exactPath(join(stateHome, "lifecycle"), "Lifecycle machine home");
  }
  return exactPath(join(homedir(), ".local", "state", "lifecycle"), "Lifecycle machine home");
}

function installationPaths(environment: NodeJS.ProcessEnv, create: boolean): HostInstallation {
  const machineHome = defaultMachineHome(environment);
  const select = create ? ensurePrivateDirectory : exactDirectory;
  const selectedMachineHome = select(machineHome, "Lifecycle machine home");
  const distribution = select(join(selectedMachineHome, "distribution"), "Lifecycle distribution support");
  const dockerConfig = select(join(distribution, "docker-config"), "Lifecycle private Docker configuration");
  const runtimeHome = select(join(distribution, "runtime-home"), "Lifecycle Runtime home");
  const codexHome = select(join(selectedMachineHome, "codex-exec-home"), "Lifecycle Codex provider home");
  const invocationRoot = select(join(distribution, "invocations"), "Lifecycle invocation support");
  return Object.freeze({
    codexHome,
    dockerConfig,
    invocationRoot,
    machineHome: selectedMachineHome,
    runtimeHome,
  });
}

function installationConfigPath(installation: HostInstallation): string {
  return join(installation.machineHome, "distribution", "config.json");
}

function parseInstallationConfig(installation: HostInstallation): InstallationConfig {
  const path = exactRegularFile(installationConfigPath(installation), "Lifecycle distribution configuration");
  const state = lstatSync(path);
  if ((state.mode & 0o077) !== 0 || (process.getuid?.() !== undefined && state.uid !== process.getuid?.())) {
    fail("Lifecycle distribution configuration must be an owner-private file");
  }
  let value: unknown;
  const bytes = readFileSync(path);
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("Lifecycle distribution configuration is not JSON");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("Lifecycle distribution configuration must be one object");
  }
  const config = value as Record<string, unknown>;
  if (JSON.stringify(Object.keys(config).sort()) !== JSON.stringify(["model", "reasoning", "schema"]) ||
      config.schema !== CONFIG_SCHEMA || typeof config.model !== "string" ||
      typeof config.reasoning !== "string" || !OPAQUE_SELECTION.test(config.model) ||
      !OPAQUE_SELECTION.test(config.reasoning) ||
      !bytes.equals(canonicalManifestBytes(config))) {
    fail("Lifecycle distribution configuration has invalid or noncanonical content");
  }
  return Object.freeze({ model: config.model, reasoning: config.reasoning, schema: CONFIG_SCHEMA });
}

function writeInstallationConfig(installation: HostInstallation, config: InstallationConfig): void {
  const path = installationConfigPath(installation);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, canonicalManifestBytes(config), { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  } catch (error) {
    try { rmSync(temporary, { force: true }); } catch { /* Exact temporary support may be absent. */ }
    fail(`Lifecycle distribution configuration could not be committed: ${safeMessage(error)}`);
  }
}

function resolveExecutable(value: string, environment: NodeJS.ProcessEnv): string {
  const candidates = value.includes(sep)
    ? [value]
    : (environment.PATH ?? "").split(delimiter).filter(Boolean).map((entry) => join(entry, value));
  for (const candidate of candidates) {
    try {
      const path = realpathSync(candidate);
      const state = lstatSync(path);
      accessSync(path, fsConstants.X_OK);
      if (state.isFile() && !state.isSymbolicLink()) return exactPath(path, "Docker executable");
    } catch {
      // Continue to the next exact PATH entry.
    }
  }
  fail("Docker executable is unavailable");
}

function selectedEnvironment(
  environment: NodeJS.ProcessEnv,
  names: readonly string[],
): NodeJS.ProcessEnv {
  return Object.fromEntries(names.flatMap((name) => {
    const value = environment[name];
    return value === undefined || value.includes("\0") ? [] : [[name, value]];
  }));
}

function dockerDiscoveryEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return selectedEnvironment(environment, DOCKER_DISCOVERY_ENVIRONMENT_NAMES);
}

function dockerCommandEnvironment(
  environment: NodeJS.ProcessEnv,
  installation: Pick<HostInstallation, "dockerConfig" | "runtimeHome">,
): NodeJS.ProcessEnv {
  return Object.freeze({
    ...selectedEnvironment(environment, DOCKER_COMMAND_ENVIRONMENT_NAMES),
    DOCKER_CONFIG: installation.dockerConfig,
    HOME: installation.runtimeHome,
  });
}

function commandFailure(result: SpawnSyncReturns<Buffer>, label: string): never {
  const stderr = result.stderr?.toString("utf8") ?? "";
  fail(`${label} failed${stderr.length === 0 ? "" : `: ${safeMessage(stderr.trim())}`}`);
}

function createDockerBoundary(
  environment: NodeJS.ProcessEnv,
  installation: Pick<HostInstallation, "dockerConfig" | "runtimeHome">,
): DockerBoundary {
  const executable = resolveExecutable(environment.LIFECYCLE_DISTRIBUTION_DOCKER_PATH ?? "docker", environment);
  const discoveryEnvironment = dockerDiscoveryEnvironment(environment);
  const commandEnvironment = dockerCommandEnvironment(environment, installation);
  const direct = environment.LIFECYCLE_DISTRIBUTION_DOCKER_HOST ?? environment.DOCKER_HOST;
  let endpoint = direct;
  if (endpoint === undefined) {
    const result = spawnSync(executable, [
      "context",
      "inspect",
      "--format",
      "{{json .Endpoints.docker.Host}}",
    ], { encoding: null, env: discoveryEnvironment, maxBuffer: MAXIMUM_COMMAND_OUTPUT_BYTES, shell: false });
    if (result.status !== 0 || result.signal !== null) commandFailure(result, "Docker endpoint discovery");
    try {
      endpoint = JSON.parse(result.stdout.toString("utf8").trim()) as unknown as string;
    } catch {
      fail("Docker endpoint discovery returned invalid output");
    }
  }
  if (typeof endpoint !== "string" || !endpoint.startsWith("unix:///") ||
      endpoint.includes("\0") || /[\r\n]/u.test(endpoint)) {
    fail("Lifecycle requires one local Unix Docker endpoint");
  }
  const configuredSocketPath = endpoint.slice("unix://".length);
  let socketPath;
  let socketState;
  try {
    socketPath = realpathSync(configuredSocketPath);
    socketState = statSync(socketPath);
  } catch {
    fail("Docker Unix socket is unavailable");
  }
  if (!socketState.isSocket()) fail("Docker endpoint is not a Unix socket");
  const canonicalEndpoint = `unix://${socketPath}`;
  const run = (arguments_: readonly string[]) => spawnSync(executable, [...arguments_], {
    encoding: null,
    env: commandEnvironment,
    maxBuffer: MAXIMUM_COMMAND_OUTPUT_BYTES,
    shell: false,
  });
  return Object.freeze({
    endpoint: canonicalEndpoint,
    environment: commandEnvironment,
    executable,
    run,
    socketGid: socketState.gid,
    socketPath: exactPath(socketPath, "Docker Unix socket"),
  });
}

function dockerResult(boundary: DockerBoundary, arguments_: readonly string[], label: string): string {
  const result = boundary.run(["--host", boundary.endpoint, ...arguments_]);
  if (result.status !== 0 || result.signal !== null) commandFailure(result, label);
  return result.stdout.toString("utf8");
}

function dockerPlatform(boundary: DockerBoundary): DockerPlatform {
  const versionOutput = dockerResult(
    boundary,
    ["version", "--format", "{{json .Server}}"],
    "Docker Engine version inspection",
  );
  let versionValue: unknown;
  try { versionValue = JSON.parse(versionOutput); } catch {
    fail("Docker Engine version inspection returned invalid JSON");
  }
  if (versionValue === null || typeof versionValue !== "object" || Array.isArray(versionValue)) {
    fail("Docker Engine version inspection returned an invalid object");
  }
  const version = versionValue as Record<string, unknown>;
  if (version.ApiVersion !== undefined && version.APIVersion !== undefined) {
    fail("Docker Engine version inspection returned ambiguous API versions");
  }
  const apiVersion = version.ApiVersion ?? version.APIVersion;
  const match = typeof apiVersion === "string"
    ? /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.exec(apiVersion)
    : null;
  if (match === null) fail("Docker Engine API version is invalid");
  const observed = Object.freeze([BigInt(match[1]!), BigInt(match[2]!)] as const);
  if (observed[0] < MINIMUM_DOCKER_API_VERSION[0] ||
      (observed[0] === MINIMUM_DOCKER_API_VERSION[0] &&
        observed[1] < MINIMUM_DOCKER_API_VERSION[1])) {
    fail("Docker Engine API version is older than required 1.48");
  }
  const output = dockerResult(boundary, ["info", "--format", "{{json .}}"], "Docker Engine inspection");
  let value: unknown;
  try { value = JSON.parse(output); } catch { fail("Docker Engine inspection returned invalid JSON"); }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("Docker Engine inspection returned an invalid object");
  }
  const info = value as Record<string, unknown>;
  if (info.OSType !== "linux") fail("Lifecycle requires a Linux-container Docker Engine");
  const architecture = info.Architecture === "x86_64" ? "amd64"
    : info.Architecture === "aarch64" ? "arm64" : info.Architecture;
  if (architecture !== "amd64" && architecture !== "arm64") {
    fail("Docker Engine architecture is not amd64 or arm64");
  }
  return Object.freeze({ architecture, os: "linux" });
}

function imageReference(
  image: Readonly<{ repository: string; indexDigest: `sha256:${string}` }>,
): string {
  return `${image.repository}@${image.indexDigest}`;
}

function imageInspection(boundary: DockerBoundary, reference: string): Record<string, unknown> {
  const output = dockerResult(
    boundary,
    ["image", "inspect", reference, "--format", "{{json .}}"],
    `Docker image inspection for ${reference}`,
  );
  let value: unknown;
  try { value = JSON.parse(output); } catch { fail("Docker image inspection returned invalid JSON"); }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail("Docker image inspection returned an invalid object");
  }
  return value as Record<string, unknown>;
}

function labels(value: Record<string, unknown>): Record<string, unknown> {
  const config = value.Config;
  if (config === null || typeof config !== "object" || Array.isArray(config)) {
    fail("Docker image inspection omitted configuration");
  }
  const selected = (config as Record<string, unknown>).Labels;
  if (selected === null || typeof selected !== "object" || Array.isArray(selected)) {
    fail("Docker image inspection omitted labels");
  }
  return selected as Record<string, unknown>;
}

function verifyImageIdentity(
  inspection: Record<string, unknown>,
  repository: string,
  indexDigest: string,
  platform: DistributionPlatformSelection,
): void {
  if (inspection.Id !== platform.configurationDigest || inspection.Os !== "linux" ||
      inspection.Architecture !== platform.architecture) {
    fail("installed image configuration or platform differs from the Distribution Manifest");
  }
  const repositoryDigests = inspection.RepoDigests;
  if (!Array.isArray(repositoryDigests) ||
      !repositoryDigests.some((value) => value === `${repository}@${indexDigest}`)) {
    fail("installed image is not bound to its selected GHCR acquisition digest");
  }
}

function verifyRuntimeImage(
  manifest: DistributionManifest,
  platform: DockerPlatform,
  boundary: DockerBoundary,
): void {
  const selected = platformSelection(manifest, "runtime", platform.architecture);
  const inspection = imageInspection(boundary, imageReference(manifest.images.runtime));
  verifyImageIdentity(
    inspection,
    manifest.images.runtime.repository,
    manifest.images.runtime.indexDigest,
    selected,
  );
  const imageLabels = labels(inspection);
  if (imageLabels["org.opencontainers.image.revision"] !== manifest.distribution.sourceRevision ||
      imageLabels["org.opencontainers.image.version"] !== manifest.distribution.version ||
      imageLabels["io.lifecycle.runtime-image.qualification-revision"] !==
        manifest.coordinates.qualificationRevision ||
      imageLabels["io.lifecycle.runtime-image.runtime-invocation-protocol"] !==
        manifest.distribution.runtimeInvocationProtocol) {
    fail("Runtime Image labels differ from the Distribution Manifest");
  }
}

function executionPlatform(
  manifest: DistributionManifest,
  architecture: DistributionArchitecture,
): DistributionExecutionPlatformSelection {
  const selected = manifest.images.execution.platforms.filter((entry) => entry.architecture === architecture);
  if (selected.length !== 1) fail(`Execution Image does not select linux/${architecture}`);
  return selected[0]!;
}

function verifyExecutionImage(
  manifest: DistributionManifest,
  platform: DockerPlatform,
  boundary: DockerBoundary,
): void {
  const image = manifest.images.execution;
  const selected = executionPlatform(manifest, platform.architecture);
  const inspection = imageInspection(boundary, imageReference(image));
  verifyImageIdentity(inspection, image.repository, image.indexDigest, selected);
  const config = inspection.Config as Record<string, unknown> | undefined;
  const imageLabels = labels(inspection);
  if (config?.User !== image.nonRootUser ||
      imageLabels["org.opencontainers.image.revision"] !== manifest.distribution.sourceRevision ||
      imageLabels["org.opencontainers.image.version"] !== manifest.distribution.version ||
      imageLabels["io.lifecycle.execution-image.v1.qualification-revision"] !==
        manifest.coordinates.qualificationRevision ||
      imageLabels["io.lifecycle.execution-image.v1.image-id"] !== image.imageId ||
      imageLabels["io.lifecycle.execution-image.v1.runner-contract-id"] !== image.runnerContractId ||
      imageLabels["io.lifecycle.execution-image.v1.runner-contract-digest"] !== image.runnerContractDigest ||
      imageLabels["io.lifecycle.execution-image.v1.runner-implementation-digest"] !==
        image.runnerImplementationDigest ||
      imageLabels["io.lifecycle.execution-image.v1.tool-inventory-digest"] !== selected.toolInventoryDigest ||
      imageLabels["io.lifecycle.execution-image.v1.codex-version"] !== image.codexVersion ||
      imageLabels["io.lifecycle.execution-image.v1.codex-executable-identity"] !==
        selected.codexExecutableDigest ||
      imageLabels["io.lifecycle.execution-image.v1.adapter-implementation-digest"] !==
        image.agentAdapterImplementationDigest) {
    fail("Execution Image labels differ from the Distribution Manifest");
  }
}

function pullImages(
  manifest: DistributionManifest,
  platform: DockerPlatform,
  boundary: DockerBoundary,
): void {
  for (const image of [manifest.images.runtime, manifest.images.execution]) {
    dockerResult(boundary, [
      "pull",
      "--platform",
      `${platform.os}/${platform.architecture}`,
      imageReference(image),
    ], `Exact ${image.repository} acquisition`);
  }
}

function verifyImages(
  manifest: DistributionManifest,
  platform: DockerPlatform,
  boundary: DockerBoundary,
): void {
  verifyRuntimeImage(manifest, platform, boundary);
  verifyExecutionImage(manifest, platform, boundary);
}

function setupSelections(arguments_: readonly string[]): Readonly<{ model: string; reasoning: string }> {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 1) {
    const name = arguments_[index]!;
    if (name !== "--model" && name !== "--reasoning") {
      fail("setup usage: lifecycle setup --model <id> --reasoning <id>");
    }
    const value = arguments_[index + 1];
    if (value === undefined || value.startsWith("--") || values.has(name) || !OPAQUE_SELECTION.test(value)) {
      fail("setup requires one bounded --model and one bounded --reasoning selection");
    }
    values.set(name, value);
    index += 1;
  }
  const model = values.get("--model");
  const reasoning = values.get("--reasoning");
  if (model === undefined || reasoning === undefined) {
    fail("setup usage: lifecycle setup --model <id> --reasoning <id>");
  }
  return Object.freeze({ model, reasoning });
}

function positionalIndexes(arguments_: readonly string[]): readonly number[] {
  const output: number[] = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    const value = arguments_[index]!;
    if (!value.startsWith("--")) {
      output.push(index);
      continue;
    }
    if (value === "--help" || value.includes("=")) continue;
    index += 1;
  }
  return output;
}

/** Physical preflight only; Runtime independently verifies Git's resolved directories. */
function assertIndependentTargetGit(target: string): void {
  const localEntry = (path: string, kind: "directory" | "file", required = false): void => {
    const absolute = join(target, path);
    let state;
    try { state = lstatSync(absolute); } catch (error) {
      if (!required && (error as NodeJS.ErrnoException).code === "ENOENT") return;
      fail(`target requires independent local Git metadata at ${path}`);
    }
    if (state.isSymbolicLink() ||
        (kind === "directory" ? !state.isDirectory() : !state.isFile() || state.nlink !== 1) ||
        realpathSync(absolute) !== absolute) {
      fail(`target requires independent local Git metadata at ${path}`);
    }
  };
  localEntry(".git", "directory", true);
  for (const path of [
    ".git/objects", ".git/objects/info", ".git/objects/pack",
    ".git/refs", ".git/refs/heads", ".git/refs/tags", ".git/reftable", ".git/info",
    ".git/logs", ".git/logs/refs", ".git/logs/refs/heads",
    ".git/worktrees",
  ]) localEntry(path, "directory");
  if (existsSync(join(target, ".git/worktrees"))) {
    const directory = opendirSync(join(target, ".git/worktrees"));
    try {
      if (directory.readSync() !== null) fail("target cannot share Git administration with registered linked worktrees");
    } finally { directory.closeSync(); }
  }
  for (const path of [".git/commondir", ".git/objects/info/alternates", ".git/objects/info/http-alternates"]) {
    try { lstatSync(join(target, path)); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      fail(`target Git metadata is unavailable at ${path}`);
    }
    fail(`target cannot use linked worktrees or alternate Git object stores: ${path}`);
  }
  for (const path of [".git/HEAD", ".git/config", ".git/index", ".git/packed-refs", ".git/shallow", ".git/info/grafts"]) {
    localEntry(path, "file");
  }
  let selected = "HEAD";
  const chain = new Set<string>();
  while (true) {
    if (chain.has(selected) || chain.size >= 64) fail("target Git symbolic reference chain is invalid");
    chain.add(selected);
    const carrier = join(target, ".git", selected);
    if (!existsSync(carrier)) break;
    if (lstatSync(carrier).size > 8_192) fail("target Git reference exceeds its physical preflight bound");
    const reference = /^ref: (refs\/[^\0\r\n]+)\n?$/u.exec(readFileSync(carrier, "utf8"))?.[1];
    if (reference === undefined) break;
    const segments = reference.split("/");
    if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
      fail("target Git HEAD has an invalid local reference");
    }
    for (let index = 1; index <= segments.length; index += 1) {
      const path = segments.slice(0, index).join("/");
      const kind = index === segments.length ? "file" : "directory";
      localEntry(`.git/${path}`, kind);
      localEntry(`.git/logs/${path}`, kind);
    }
    selected = reference;
  }
}

function absoluteInputFile(value: string, cwd: string, target: string): string {
  let selected;
  try { selected = realpathSync(resolve(cwd, value)); } catch { fail("Lifecycle input file is unavailable"); }
  const path = exactRegularFile(selected, "Lifecycle input file");
  if (within(target, path)) return path;
  return path;
}

function assertUnreservedMountTargets(paths: readonly string[]): void {
  for (const path of paths) {
    for (const reserved of RESERVED_RUNTIME_MOUNT_TARGETS) {
      if (within(path, reserved) ||
          (!DESCENDANT_MOUNTS_ALLOWED.has(reserved) && within(reserved, path))) {
        fail(`host path ${path} overlaps the reserved Runtime Image path ${reserved}`);
      }
    }
  }
}

export function prepareRuntimeInvocation(
  command: DistributionCommand,
  arguments_: readonly string[],
  cwd: string,
): PreparedInvocation {
  const output = [...arguments_];
  if (output.includes("--help") || output.includes("-h")) {
    return Object.freeze({ arguments: Object.freeze(output), mounts: Object.freeze([]), target: null });
  }
  if (command !== "lifecycle") fail("entrypoint is not the selected Lifecycle CLI");
  const positionals = positionalIndexes(output);
  const action = positionals[0] === undefined ? null : output[positionals[0]]!;
  if (action === null || !TARGET_ACTIONS.has(action)) {
    return Object.freeze({ arguments: Object.freeze(output), mounts: Object.freeze([]), target: null });
  }
  const targetIndex = positionals[1];
  if (targetIndex === undefined) fail(`${action} requires one target repository path`);
  const targetValue = output[targetIndex]!;
  const target = exactDirectory(realpathSync(resolve(cwd, targetValue)), "target repository", false);
  output[targetIndex] = target;
  assertIndependentTargetGit(target);
  const mountPaths = [target];
  if (command === "lifecycle") {
    for (let index = 0; index < output.length; index += 1) {
      const argument = output[index]!;
      const equal = [...FILE_OPTIONS].find((name) => argument.startsWith(`${name}=`));
      if (equal !== undefined) {
        const path = absoluteInputFile(argument.slice(equal.length + 1), cwd, target);
        output[index] = `${equal}=${path}`;
        if (!within(target, path)) mountPaths.push(path);
      } else if (FILE_OPTIONS.has(argument)) {
        const value = output[index + 1];
        if (value === undefined) fail(`${argument} requires a file`);
        const path = absoluteInputFile(value, cwd, target);
        output[index + 1] = path;
        if (!within(target, path)) mountPaths.push(path);
        index += 1;
      }
    }
  }
  const unique = mountPaths.filter((path, index, all) => all.indexOf(path) === index);
  assertUnreservedMountTargets(unique);
  return Object.freeze({
    arguments: Object.freeze(output),
    mounts: Object.freeze(unique.map((path) => Object.freeze({
      readOnly: path !== target && lstatSync(path).isFile(),
      source: path,
      target: path,
    }))),
    target,
  });
}

/** Map only explicitly selected local files; this route never selects a target. */
export function prepareDraftInvocation(arguments_: readonly string[], cwd: string): PreparedInvocation {
  const output = [...arguments_];
  if (output.includes("--help") || output.includes("-h") ||
      (output.length === 2 && output[0] === "help" && output[1] === "draft")) {
    return Object.freeze({ arguments: Object.freeze(output), mounts: Object.freeze([]), target: null });
  }
  if (output[0] !== "draft") fail("local drafting requires the draft command");
  const positions: number[] = [];
  const options = new Map<string, number>();
  for (let index = 1; index < output.length; index += 1) {
    const value = output[index]!;
    if (!value.startsWith("--")) { positions.push(index); continue; }
    if ((value !== "--format" && value !== "--basis") || options.has(value) ||
        output[index + 1] === undefined || output[index + 1]!.startsWith("--")) {
      fail("draft accepts only explicit local selections, --basis FILE, and --format human|json");
    }
    options.set(value, ++index);
  }
  const formatIndex = options.get("--format");
  if (formatIndex !== undefined && !["human", "json"].includes(output[formatIndex]!)) {
    fail("draft --format must be human or json");
  }
  const action = positions[0] === undefined ? undefined : output[positions[0]];
  if (action === "forms") {
    if (positions.length > 2 || options.has("--basis")) fail("draft forms accepts at most one form and --format");
    return Object.freeze({ arguments: Object.freeze(output), mounts: Object.freeze([]), target: null });
  }
  if ((action !== "knowledge" && action !== "semantic") || positions.length < 3 ||
      (action === "knowledge" && options.has("--basis")) ||
      (action === "semantic" && (positions.length !== 3 || !options.has("--basis")))) {
    fail("use lifecycle help draft for exact local file selection syntax");
  }
  // Bound host mount construction independently of Runtime byte/semantic limits.
  if (positions.length - 2 > 1_024) fail("draft accepts at most 1024 explicit file selections");
  const workspaceIndex = positions[1]!;
  let workspace: string;
  try {
    workspace = exactPath(realpathSync(resolve(cwd, output[workspaceIndex]!)), "draft workspace");
    if (!lstatSync(workspace).isDirectory()) fail("draft workspace must be a directory");
    accessSync(workspace, fsConstants.R_OK | fsConstants.X_OK);
  } catch { fail("the explicitly selected draft workspace is unavailable"); }
  const mounts = new Map<string, PreparedInvocation["mounts"][number]>();
  const containerRoot = "/lifecycle-draft/workspace";
  const addFile = (source: string, target: string): void => {
    const path = exactRegularFile(source, "selected draft input");
    const state = lstatSync(path);
    if (state.nlink !== 1 || (state.mode & 0o111) !== 0) fail("draft inputs must be non-executable regular files without links");
    mounts.set(target, Object.freeze({ source: path, target, readOnly: true }));
  };
  for (const index of positions.slice(2)) {
    const path = output[index]!;
    if (isAbsolute(path) || path.includes("\\") || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
      fail("draft file selections must be normalized paths relative to the explicit workspace");
    }
    addFile(join(workspace, path), `${containerRoot}/${path}`);
  }
  if (action === "knowledge") addFile(join(workspace, ".lifecycle/repository.json"), `${containerRoot}/.lifecycle/repository.json`);
  const basisIndex = options.get("--basis");
  if (basisIndex !== undefined) {
    if (!isAbsolute(output[basisIndex]!)) fail("draft semantic --basis requires one absolute file");
    addFile(output[basisIndex]!, "/lifecycle-draft/semantic-basis.json");
    output[basisIndex] = "/lifecycle-draft/semantic-basis.json";
  }
  output[workspaceIndex] = containerRoot;
  return Object.freeze({ arguments: Object.freeze(output), mounts: Object.freeze([...mounts.values()]), target: null });
}

/** Snapshot selected bytes before Docker observes them; no target semantics live here. */
function snapshotDraftInputs(prepared: PreparedInvocation, temporary: string): PreparedInvocation["mounts"] {
  if (prepared.mounts.length === 0) return Object.freeze([]);
  const root = ensurePrivateDirectory(join(temporary, "inputs"), "local draft input snapshot");
  // Independent transport ceilings encompass the Runtime's local read profiles.
  const maximumFileBytes = 256 * 1024 * 1024;
  const maximumTotalBytes = 512 * 1024 * 1024;
  let total = 0;
  const same = (left: BigIntStats, right: BigIntStats): boolean =>
    left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mode === right.mode && left.nlink === right.nlink &&
    left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
  for (const mount of prepared.mounts) {
    const directories: { path: string; state: BigIntStats }[] = [];
    let parent = dirname(mount.source);
    for (;;) {
      const state = lstatSync(parent, { bigint: true });
      if (!state.isDirectory() || state.isSymbolicLink()) fail("selected draft input directories changed; retry the explicit selection");
      directories.push({ path: parent, state });
      const next = dirname(parent);
      if (next === parent) break;
      parent = next;
    }
    const before = lstatSync(mount.source, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || (before.mode & 0o111n) !== 0n) {
      fail("selected draft input must remain one non-executable regular file without links");
    }
    if (before.size > BigInt(maximumFileBytes) || before.size + BigInt(total) > BigInt(maximumTotalBytes)) {
      fail("selected draft input exceeds the bounded local launch snapshot");
    }
    const destination = join(root, relative("/lifecycle-draft", mount.target));
    mkdirSync(dirname(destination), { mode: 0o700, recursive: true });
    const source = openSync(mount.source, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
    try {
      if (!same(before, fstatSync(source, { bigint: true }))) fail("selected draft input changed before snapshot; retry the explicit selection");
      const output = openSync(destination, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL, 0o600);
      let observed = 0;
      try {
        const buffer = Buffer.alloc(64 * 1024);
        for (;;) {
          const count = readSync(source, buffer, 0, buffer.byteLength, observed);
          if (count === 0) break;
          observed += count;
          if (observed > maximumFileBytes || total + observed > maximumTotalBytes) fail("selected draft input exceeds the bounded local launch snapshot");
          let written = 0;
          while (written < count) written += writeSync(output, buffer, written, count - written);
        }
      } finally { closeSync(output); }
      if (BigInt(observed) !== before.size || !same(before, fstatSync(source, { bigint: true })) ||
          !same(before, lstatSync(mount.source, { bigint: true })) || realpathSync(mount.source) !== mount.source) {
        fail("selected draft input changed during snapshot; retry the explicit selection");
      }
      for (const directory of directories) {
        const current = lstatSync(directory.path, { bigint: true });
        if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== directory.state.dev || current.ino !== directory.state.ino) {
          fail("selected draft input directory changed during snapshot; retry the explicit selection");
        }
      }
      total += observed;
    } finally { closeSync(source); }
  }
  return Object.freeze([Object.freeze({ source: root, target: "/lifecycle-draft", readOnly: true })]);
}

async function launchDraft(
  arguments_: readonly string[],
  manifest: DistributionManifest,
  environment: NodeJS.ProcessEnv,
): Promise<number> {
  const prepared = prepareDraftInvocation(arguments_, process.cwd());
  const uid = process.getuid?.();
  const gid = process.getgid?.();
  if (uid === undefined || gid === undefined) fail("local drafting requires one Unix user identity");
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), "lifecycle-draft-launch-")));
  const handlers: { signal: NodeJS.Signals; handler: () => void }[] = [];
  try {
    const mounts = snapshotDraftInputs(prepared, temporary);
    // Docker discovery uses its existing owner; command configuration is empty
    // and disposable, without opening Lifecycle installation or provider state.
    const boundary = createDockerBoundary(environment, {
      dockerConfig: ensurePrivateDirectory(join(temporary, "docker-config"), "local draft Docker configuration"),
      runtimeHome: temporary,
    });
    const platform = dockerPlatform(boundary);
    verifyRuntimeImage(manifest, platform, boundary);
    const child = spawn(boundary.executable, [
      "--host", boundary.endpoint, "run", "--rm", "--init", "--pull", "never",
      "--platform", `linux/${platform.architecture}`, "--read-only", "--network", "none",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--user", `${uid}:${gid}`,
      "--tmpfs", `/tmp:rw,nosuid,nodev,noexec,size=${RUNTIME_TMPFS_BYTES},mode=0700,uid=${uid},gid=${gid}`,
      ...mounts.flatMap((mount) => ["--mount", mountArgument(mount.source, mount.target, true)]),
      "--env", "HOME=/tmp", "--workdir", "/opt/lifecycle",
      "--entrypoint", "/opt/lifecycle/bin/lifecycle",
      imageReference(manifest.images.runtime), ...prepared.arguments,
    ], { env: boundary.environment, shell: false, stdio: ["ignore", "inherit", "inherit"] });
    for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"] as const) {
      const handler = (): void => { try { child.kill(signal); } catch { /* The local command may already be terminal. */ } };
      handlers.push({ signal, handler });
      process.on(signal, handler);
    }
    const result = await new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>((resolveResult, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolveResult({ code, signal }));
    });
    return result.code ?? signalExitCode(result.signal);
  } finally {
    for (const { signal, handler } of handlers) process.removeListener(signal, handler);
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function dockerTerminalArguments(): readonly string[] {
  return Object.freeze(["--interactive"]);
}

function runtimeEnvironmentArguments(
  manifest: DistributionManifest,
  config: InstallationConfig,
  platform: DockerPlatform,
): readonly string[] {
  const execution = manifest.images.execution;
  const selected = executionPlatform(manifest, platform.architecture);
  const values: Readonly<Record<string, string>> = Object.freeze({
    HOME: "/var/lib/lifecycle/distribution/runtime-home",
    LIFECYCLE_DOCKER_CONFIG: "/var/lib/lifecycle/distribution/docker-config",
    LIFECYCLE_DOCKER_HOST: "unix:///run/lifecycle/docker.sock",
    LIFECYCLE_DOCKER_PATH: "/usr/bin/docker",
    LIFECYCLE_EXECUTION_AGENT_ADAPTER_IMPLEMENTATION_DIGEST:
      execution.agentAdapterImplementationDigest,
    LIFECYCLE_EXECUTION_CODEX_EXECUTABLE_IDENTITY: selected.codexExecutableDigest,
    LIFECYCLE_EXECUTION_CODEX_VERSION: execution.codexVersion,
    LIFECYCLE_EXECUTION_IMAGE_ARCHITECTURE: selected.architecture,
    // The current installed Runtime contract selects Docker's immutable local
    // configuration identity here. GHCR acquisition remains separately bound
    // by repository@indexDigest and verified before the Runtime is started.
    LIFECYCLE_EXECUTION_IMAGE_DIGEST: selected.configurationDigest,
    LIFECYCLE_EXECUTION_IMAGE_ID: execution.imageId,
    LIFECYCLE_EXECUTION_RUNNER_CONTRACT_DIGEST: execution.runnerContractDigest,
    LIFECYCLE_EXECUTION_RUNNER_IMPLEMENTATION_DIGEST: execution.runnerImplementationDigest,
    LIFECYCLE_EXECUTION_TOOL_INVENTORY_DIGEST: selected.toolInventoryDigest,
    LIFECYCLE_FOUNDATION_PROVIDER_MODEL: config.model,
    LIFECYCLE_FOUNDATION_PROVIDER_REASONING: config.reasoning,
    LIFECYCLE_MACHINE_HOME: "/var/lib/lifecycle",
    LIFECYCLE_RUNTIME_INVOCATION_FILE: "/run/lifecycle-invocation/invocation.json",
    TMPDIR: "/tmp",
  });
  return Object.freeze(Object.entries(values).flatMap(([name, value]) => ["--env", `${name}=${value}`]));
}

function recoverStaleInvocations(
  installation: HostInstallation,
  boundary: DockerBoundary,
): void {
  const selectedRoot = stateRootDigest(installation.machineHome);
  const retainedInvocations = new Set<string>();
  const output = dockerResult(boundary, [
    "ps",
    "--all",
    "--no-trunc",
    "--filter",
    `label=${INVOCATION_LABEL_PREFIX}.protocol=${RUNTIME_INVOCATION_PROTOCOL}`,
    "--filter",
    `label=${INVOCATION_LABEL_PREFIX}.state-root-digest=${selectedRoot}`,
    "--filter",
    `label=${INVOCATION_LABEL_PREFIX}.role=command-runtime`,
    "--format",
    "{{.ID}}",
  ], "stale Runtime invocation discovery");
  for (const containerId of output.split("\n").filter(Boolean)) {
    if (!CONTAINER_ID.test(containerId)) fail("stale Runtime discovery returned an invalid container identity");
    const inspectionOutput = dockerResult(
      boundary,
      ["container", "inspect", containerId, "--format", "{{json .}}"],
      "stale Runtime invocation inspection",
    );
    let inspection: unknown;
    try { inspection = JSON.parse(inspectionOutput); } catch { fail("stale Runtime inspection returned invalid JSON"); }
    if (inspection === null || typeof inspection !== "object" || Array.isArray(inspection)) {
      fail("stale Runtime inspection returned an invalid object");
    }
    const record = inspection as Record<string, unknown>;
    const config = record.Config as Record<string, unknown> | undefined;
    const selectedLabels = config?.Labels as Record<string, unknown> | undefined;
    const invocationId = selectedLabels?.[`${INVOCATION_LABEL_PREFIX}.invocation-id`];
    const sourceRevision = selectedLabels?.[`${INVOCATION_LABEL_PREFIX}.source-revision`];
    if (typeof invocationId !== "string" || !UUID.test(invocationId) ||
        selectedLabels?.[`${INVOCATION_LABEL_PREFIX}.state-root-digest`] !== selectedRoot ||
        selectedLabels?.[`${INVOCATION_LABEL_PREFIX}.role`] !== "command-runtime" ||
        typeof sourceRevision !== "string" || !SOURCE_REVISION.test(sourceRevision) ||
        record.Name !== `/lifecycle-runtime-${invocationId}`) {
      fail("stale Runtime invocation labels are incomplete or substituted");
    }
    retainedInvocations.add(invocationId);
    const state = record.State as Record<string, unknown> | undefined;
    const heartbeatPath = join(installation.invocationRoot, invocationId, "heartbeat");
    try {
      const age = Date.now() - statSync(heartbeatPath).mtimeMs;
      if (state?.Running === true && age >= 0 &&
          age < HEARTBEAT_INTERVAL_MS * MISSED_HEARTBEAT_LIMIT * 2) continue;
    } catch {
      // Missing support makes the owned invocation stale.
    }
    const present = (): boolean => {
      const observed = dockerResult(boundary, [
        "ps",
        "--all",
        "--no-trunc",
        "--filter",
        `id=${containerId}`,
        "--format",
        "{{.ID}}",
      ], "stale Runtime terminal observation").split("\n").filter(Boolean);
      if (observed.some((identity) => !CONTAINER_ID.test(identity) || identity !== containerId) ||
          observed.length > 1) {
        fail("stale Runtime terminal observation returned a substituted container identity");
      }
      return observed.length === 1;
    };
    boundary.run(["--host", boundary.endpoint, "stop", "--time", "3", containerId]);
    if (present()) {
      const remove = boundary.run(["--host", boundary.endpoint, "rm", "--force", containerId]);
      if (present()) {
        if (remove.status !== 0 || remove.signal !== null) commandFailure(remove, "stale Runtime removal");
        fail("stale Runtime remained after forced removal");
      }
    }
    rmSync(join(installation.invocationRoot, invocationId), { force: true, recursive: true });
    retainedInvocations.delete(invocationId);
  }
  for (const entry of readdirSync(installation.invocationRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !UUID.test(entry.name)) {
      fail("Lifecycle invocation support contains an unrecognized entry");
    }
    if (retainedInvocations.has(entry.name)) continue;
    const directory = join(installation.invocationRoot, entry.name);
    try {
      const age = Date.now() - statSync(join(directory, "heartbeat")).mtimeMs;
      if (age >= 0 && age < HEARTBEAT_INTERVAL_MS * MISSED_HEARTBEAT_LIMIT * 2) continue;
    } catch {
      // A missing heartbeat cannot identify a live launcher.
    }
    rmSync(directory, { force: true, recursive: true });
  }
}

async function launchRuntime(
  command: DistributionCommand,
  arguments_: readonly string[],
  manifest: DistributionManifest,
  environment: NodeJS.ProcessEnv,
): Promise<number> {
  if (process.getuid === undefined || process.getgid === undefined) {
    fail("this distribution requires one Unix user identity");
  }
  const installation = installationPaths(environment, false);
  const config = parseInstallationConfig(installation);
  const boundary = createDockerBoundary(environment, installation);
  const platform = dockerPlatform(boundary);
  verifyImages(manifest, platform, boundary);
  recoverStaleInvocations(installation, boundary);
  const prepared = prepareRuntimeInvocation(command, arguments_, process.cwd());
  if (prepared.mounts.some(({ source }) =>
    within(source, installation.machineHome) || within(installation.machineHome, source))) {
    fail("Lifecycle machine home and invocation host mounts must be physically disjoint");
  }

  const invocationId = randomUUID();
  const invocationDirectory = ensurePrivateDirectory(
    join(installation.invocationRoot, invocationId),
    "Lifecycle invocation directory",
  );
  writeRuntimeInvocationSupport(invocationDirectory, invocationId);
  const cidFile = join(invocationDirectory, "container-id");
  const uid = process.getuid();
  const gid = process.getgid();
  const runtimeArguments = [
    "--host", boundary.endpoint,
    "run",
    "--rm",
    "--init",
    ...dockerTerminalArguments(),
    "--pull", "never",
    "--platform", `linux/${platform.architecture}`,
    "--name", `lifecycle-runtime-${invocationId}`,
    "--cidfile", cidFile,
    "--label", `${INVOCATION_LABEL_PREFIX}.protocol=${RUNTIME_INVOCATION_PROTOCOL}`,
    "--label", `${INVOCATION_LABEL_PREFIX}.invocation-id=${invocationId}`,
    "--label", `${INVOCATION_LABEL_PREFIX}.state-root-digest=${stateRootDigest(installation.machineHome)}`,
    "--label", `${INVOCATION_LABEL_PREFIX}.source-revision=${manifest.distribution.sourceRevision}`,
    "--label", `${INVOCATION_LABEL_PREFIX}.role=command-runtime`,
    "--read-only",
    "--network", "none",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--user", `${uid}:${gid}`,
    "--group-add", String(boundary.socketGid),
    "--tmpfs",
    `/tmp:rw,nosuid,nodev,noexec,size=${RUNTIME_TMPFS_BYTES},mode=0700,uid=${uid},gid=${gid}`,
    "--tmpfs",
    `/var/lib/lifecycle/distribution/invocations:rw,nosuid,nodev,noexec,size=${RUNTIME_INVOCATION_MASK_TMPFS_BYTES},mode=0700,uid=${uid},gid=${gid}`,
    "--mount", mountArgument(installation.machineHome, "/var/lib/lifecycle", false),
    "--mount", mountArgument(invocationDirectory, "/run/lifecycle-invocation", true),
    "--mount", mountArgument(boundary.socketPath, "/run/lifecycle/docker.sock", false),
    ...prepared.mounts.flatMap((mount) => [
      "--mount",
      mountArgument(mount.source, mount.target, mount.readOnly),
    ]),
    ...runtimeEnvironmentArguments(manifest, config, platform),
    "--workdir", prepared.target ?? "/opt/lifecycle",
    imageReference(manifest.images.runtime),
    command,
    ...prepared.arguments,
  ];

  let counter = 0;
  const timer = setInterval(() => {
    counter += 1;
    try { updateRuntimeInvocationHeartbeat(invocationDirectory, counter); } catch {
      /* The invocation may be completing. */
    }
  }, HEARTBEAT_INTERVAL_MS);
  timer.unref();

  const signals = ["SIGHUP", "SIGINT", "SIGTERM"] as const;
  const handlers: { signal: typeof signals[number]; handler: () => void }[] = [];
  try {
    const child = spawn(boundary.executable, runtimeArguments, {
      env: boundary.environment,
      shell: false,
      stdio: "inherit",
    });
    handlers.push(...signals.map((signal) => ({ signal, handler: () => {
      try { child.kill(signal); } catch { /* Docker client may already be terminal. */ }
    } })));
    for (const { signal, handler } of handlers) process.on(signal, handler);
    const result = await new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>(
      (resolveResult, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolveResult(Object.freeze({ code, signal })));
      },
    );
    if (existsSync(cidFile)) {
      const id = readFileSync(cidFile, "utf8").trim();
      if (!CONTAINER_ID.test(id)) fail("Docker cidfile did not bind one exact invocation container");
    }
    return result.code ?? signalExitCode(result.signal);
  } finally {
    clearInterval(timer);
    for (const { signal, handler } of handlers) process.removeListener(signal, handler);
    rmSync(invocationDirectory, { force: true, recursive: true });
  }
}

export async function runDistributionLauncher(
  command: DistributionCommand,
  arguments_: readonly string[],
  manifest: DistributionManifest,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  try {
    assertDistributionHostPlatform();
    if (command === "lifecycle" && (arguments_[0] === "draft" ||
        (arguments_[0] === "help" && arguments_[1] === "draft"))) {
      return await launchDraft(arguments_, manifest, environment);
    }
    if (command === "lifecycle" && arguments_[0] === "setup") {
      const selection = setupSelections(arguments_.slice(1));
      const installation = installationPaths(environment, true);
      const boundary = createDockerBoundary(environment, installation);
      const platform = dockerPlatform(boundary);
      pullImages(manifest, platform, boundary);
      verifyImages(manifest, platform, boundary);
      writeInstallationConfig(installation, Object.freeze({ ...selection, schema: CONFIG_SCHEMA }));
      process.stdout.write(
        `Lifecycle ${manifest.distribution.version} is installed for linux/${platform.architecture}.\n`,
      );
      return 0;
    }
    if (command === "lifecycle" && arguments_[0] === "doctor") {
      if (arguments_.length !== 1) fail("doctor accepts no options");
      const installation = installationPaths(environment, false);
      parseInstallationConfig(installation);
      const boundary = createDockerBoundary(environment, installation);
      const platform = dockerPlatform(boundary);
      verifyImages(manifest, platform, boundary);
      process.stdout.write(
        `Lifecycle ${manifest.distribution.version} distribution is ready for linux/${platform.architecture}.\n`,
      );
      return 0;
    }
    return await launchRuntime(command, arguments_, manifest, environment);
  } catch (error) {
    process.stderr.write(`Lifecycle distribution failed: ${safeMessage(error)}\n`);
    return error instanceof DistributionLauncherError ? 2 : 1;
  }
}
