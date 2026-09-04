import { spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  accessSync,
  chmodSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  delimiter,
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

export type DistributionCommand = "lifecycle" | "lifecycle-tui";

const INVOCATION_LABEL_PREFIX = "io.lifecycle.runtime-invocation.private.v1";
const CONFIG_SCHEMA = "lifecycle.distribution-installation-config.private.v1";
const HEARTBEAT_INTERVAL_MS = 500;
const MISSED_HEARTBEAT_LIMIT = 10;
const RUNTIME_TMPFS_BYTES = 512 * 1024 * 1024;
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

type InstallationConfig = Readonly<{
  model: string;
  reasoning: string;
  schema: typeof CONFIG_SCHEMA;
}>;

type DockerPlatform = Readonly<{
  architecture: DistributionArchitecture;
  os: "linux";
}>;

type HostInstallation = Readonly<{
  codexHome: string;
  dockerConfig: string;
  invocationRoot: string;
  machineHome: string;
  runtimeHome: string;
}>;

type DockerBoundary = Readonly<{
  endpoint: string;
  environment: NodeJS.ProcessEnv;
  executable: string;
  run(arguments_: readonly string[]): SpawnSyncReturns<Buffer>;
  socketGid: number;
  socketPath: string;
}>;

type PreparedInvocation = Readonly<{
  arguments: readonly string[];
  mounts: readonly Readonly<{ source: string; target: string; readOnly: boolean }>[];
  target: string | null;
}>;

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
  installation: HostInstallation,
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
  installation: HostInstallation,
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

function targetGitMounts(target: string): readonly string[] {
  const dotGit = join(target, ".git");
  if (!existsSync(dotGit)) return Object.freeze([]);
  const state = lstatSync(dotGit);
  if (state.isDirectory() && !state.isSymbolicLink()) return Object.freeze([]);
  if (!state.isFile() || state.isSymbolicLink() || state.size > 8_192) {
    fail("target .git carrier is not one bounded regular file or directory");
  }
  const match = /^gitdir: ([^\0\r\n]+)\n?$/u.exec(readFileSync(dotGit, "utf8"));
  if (match === null) fail("target linked-worktree .git carrier is invalid");
  const gitDirectory = exactDirectory(resolve(target, match[1]!), "target Git administration directory", false);
  const reverseCarrier = join(gitDirectory, "gitdir");
  if (!existsSync(reverseCarrier)) {
    fail("target Git administration directory has no reverse worktree binding");
  }
  const reverseState = lstatSync(reverseCarrier);
  if (!reverseState.isFile() || reverseState.isSymbolicLink() || reverseState.size > 8_192) {
    fail("target Git reverse-worktree carrier is invalid");
  }
  const reverseValue = readFileSync(reverseCarrier, "utf8");
  if (!/^[^\0\r\n]+\n?$/u.test(reverseValue) ||
      resolve(gitDirectory, reverseValue.endsWith("\n") ? reverseValue.slice(0, -1) : reverseValue) !== dotGit) {
    fail("target Git administration directory does not bind back to the selected worktree");
  }
  const commonCarrier = join(gitDirectory, "commondir");
  const commonDirectory = existsSync(commonCarrier)
    ? (() => {
        const commonState = lstatSync(commonCarrier);
        if (!commonState.isFile() || commonState.isSymbolicLink() || commonState.size > 8_192) {
          fail("target Git common-directory carrier is invalid");
        }
        const value = readFileSync(commonCarrier, "utf8");
        if (!/^[^\0\r\n]+\n?$/u.test(value)) fail("target Git common-directory carrier is malformed");
        return exactDirectory(
          resolve(gitDirectory, value.endsWith("\n") ? value.slice(0, -1) : value),
          "target Git common directory",
          false,
        );
    })()
    : gitDirectory;
  if (within(target, gitDirectory) || within(target, commonDirectory) ||
      !within(commonDirectory, gitDirectory)) {
    fail("target Git administrative topology is not one exact external common-directory domain");
  }
  return Object.freeze([gitDirectory, commonDirectory]
    .filter((path, index, all) => !within(target, path) && all.indexOf(path) === index));
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
  let targetValue: string;
  if (command === "lifecycle") {
    const positionals = positionalIndexes(output);
    const action = positionals[0] === undefined ? null : output[positionals[0]]!;
    if (action === null || !TARGET_ACTIONS.has(action)) {
      return Object.freeze({ arguments: Object.freeze(output), mounts: Object.freeze([]), target: null });
    }
    const targetIndex = positionals[1];
    if (targetIndex === undefined) fail(`${action} requires one target repository path`);
    targetValue = output[targetIndex]!;
    output[targetIndex] = exactDirectory(realpathSync(resolve(cwd, targetValue)), "target repository", false);
  } else {
    let targetIndex = -1;
    for (let index = 0; index < output.length; index += 1) {
      if (output[index] === "--lifecycle") {
        fail("the distributed TUI cannot select another Lifecycle executable");
      }
      if (output[index] === "--target") {
        if (targetIndex !== -1 || output[index + 1] === undefined) fail("TUI target selection is invalid");
        targetIndex = index + 1;
        index += 1;
      }
    }
    targetValue = targetIndex === -1 ? cwd : output[targetIndex]!;
    const selected = exactDirectory(realpathSync(resolve(cwd, targetValue)), "target repository", false);
    if (targetIndex === -1) output.push("--target", selected);
    else output[targetIndex] = selected;
  }
  const target = command === "lifecycle"
    ? output[positionalIndexes(output)[1]!]!
    : output[output.indexOf("--target") + 1]!;
  const mountPaths = [target, ...targetGitMounts(target)];
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

function stateRootDigest(machineHome: string): string {
  return `sha256:${createHash("sha256").update(machineHome, "utf8").digest("hex")}`;
}

function mountArgument(source: string, target: string, readOnly: boolean): string {
  return `type=bind,src=${source},dst=${target}${readOnly ? ",readonly" : ""}`;
}

export function dockerTerminalArguments(
  command: DistributionCommand,
  stdinIsTty: boolean,
  stdoutIsTty: boolean,
): readonly string[] {
  return Object.freeze([
    "--interactive",
    ...(command === "lifecycle-tui" && stdinIsTty && stdoutIsTty ? ["--tty"] : []),
  ]);
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

function heartbeat(invocationDirectory: string, counter: number): void {
  const path = join(invocationDirectory, "heartbeat");
  const temporary = join(invocationDirectory, `.heartbeat.${randomUUID()}.tmp`);
  writeFileSync(temporary, `${counter}\n`, { flag: "wx", mode: 0o600 });
  renameSync(temporary, path);
}

function writeInvocation(invocationDirectory: string, invocationId: string): void {
  writeFileSync(join(invocationDirectory, "invocation.json"), canonicalManifestBytes({
    heartbeatFile: "/run/lifecycle-invocation/heartbeat",
    heartbeatIntervalMilliseconds: HEARTBEAT_INTERVAL_MS,
    invocationId,
    missedHeartbeatLimit: MISSED_HEARTBEAT_LIMIT,
    schema: RUNTIME_INVOCATION_PROTOCOL,
  }), { flag: "wx", mode: 0o600 });
  heartbeat(invocationDirectory, 0);
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

function signalExitCode(signal: NodeJS.Signals | null): number {
  return signal === "SIGHUP" ? 129 : signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1;
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
  writeInvocation(invocationDirectory, invocationId);
  const cidFile = join(invocationDirectory, "container-id");
  const uid = process.getuid();
  const gid = process.getgid();
  const runtimeArguments = [
    "--host", boundary.endpoint,
    "run",
    "--rm",
    "--init",
    ...dockerTerminalArguments(command, process.stdin.isTTY, process.stdout.isTTY),
    "--pull", "never",
    "--platform", `linux/${platform.architecture}`,
    "--name", `lifecycle-runtime-${invocationId}`,
    "--cidfile", cidFile,
    "--label", `${INVOCATION_LABEL_PREFIX}.protocol=${RUNTIME_INVOCATION_PROTOCOL}`,
    "--label", `${INVOCATION_LABEL_PREFIX}.invocation-id=${invocationId}`,
    "--label", `${INVOCATION_LABEL_PREFIX}.state-root-digest=${stateRootDigest(installation.machineHome)}`,
    "--label", `${INVOCATION_LABEL_PREFIX}.source-revision=${manifest.distribution.sourceRevision}`,
    "--read-only",
    "--network", "none",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--user", `${uid}:${gid}`,
    "--group-add", String(boundary.socketGid),
    "--tmpfs",
    `/tmp:rw,nosuid,nodev,noexec,size=${RUNTIME_TMPFS_BYTES},mode=0700,uid=${uid},gid=${gid}`,
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
    try { heartbeat(invocationDirectory, counter); } catch { /* The invocation may be completing. */ }
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
